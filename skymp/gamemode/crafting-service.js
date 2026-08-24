/**
 * crafting-service.js
 * Sistema de Crafting Modular (Fase Beta).
 *
 * Funciona 100% server-side:
 * - O cliente envia a intenção pela interação `[E]` de uma estação cadastrada.
 * - O servidor consome os ingredientes e entrega o resultado numa transação só.
 *
 * ⚠️ **O que este cabeçalho afirmava e não era verdade.** Até 13/08/2026 esta
 * lista dizia *"o servidor valida ingredientes, station proximity e perks"*.
 * Ingrediente sim, pelo `FOR UPDATE`. **Proximidade de estação: nunca** — o
 * `craftItem` sequer carregava a estação, então `/craft` funcionava do outro
 * lado do mapa. **Perk: nunca** — `requires_perk` é lido em `listRecipes` e
 * nunca comparado com nada.
 *
 * Desde a migration v28, a entrada do jogador passa exclusivamente pelo
 * Interaction Framework: o servidor resolve o FormDesc em
 * `crafting_stations`, valida a distância física e deriva o `station_type`.
 * `requires_perk` continua deliberadamente sem uso; profissão/rank é o gate
 * adotado. Ver `docs/gameplay/CRAFTING_SYSTEM.md`.
 *
 * Registrado em `core/module-registry.js` como módulo `crafting` (fase `lab`,
 * `ENABLE_CRAFTING_SERVICE`, nasce desligado). A migração abaixo era de
 * segurança interna e ficou separada da decisão de reativar de propósito — a
 * mistura das duas é o erro que a Fase 2 do QA_REPORT existe pra não repetir.
 * Ver docs/technical/PARKED_SERVICES_DECISION.md §7.2 para o histórico.
 *
 * ─── Gate de profissão (20/08/2026) ─────────────────────────────────────────
 *
 * `crafting_recipes.required_profession`/`required_rank`
 * (migration-v23-crafting-profession-gate.sql) são checados dentro de
 * `craftItem()`, no mesmo desenho que `resource_nodes.required_profession` já
 * usa contra `profession-service.js`. NULL continua liberado pra qualquer
 * personagem — nenhuma receita hoje tem o campo preenchido, então isto não
 * muda comportamento sozinho; é a staff que passa a poder amarrar uma receita
 * a `blacksmith`, `smelter`, `tanner`, `enchanter` ou `cook` via `/addrecipe`.
 * `requires_perk` continua sem uso — não é este o campo que este gate lê.
 *
 * ─── Assinatura do Artesão (22/08/2026) ─────────────────────────────────────
 *
 * Ver docs/design/MAKERS_MARK.md. Artesão com rank >=
 * `crafting.signatureMinRank` pode gravar uma dedicatória em
 * `crafted_item_signatures` (migration-v24) ao craftar uma receita presa a
 * profissão. **Não é a mesma transação do `inventory.exchange`** — decisão
 * deliberada, não descuido: `exchange()` (core/inventory.js) não expõe gancho
 * de escrita externa, e estender esse arquivo (usado por trade/depot/
 * market-stall/crafting) só a favor desta feature seria risco desproporcional
 * ao ganho. A assinatura é metadado de flavor — não move ouro nem item — então
 * uma falha isolada no `INSERT` fica só no log, sem exploit e sem perda de
 * patrimônio, ao contrário do que valeria para uma transferência de item de
 * verdade (ver `recordCraftSignature` abaixo).
 *
 * ─── Por que este arquivo mudou ──────────────────────────────────────────────
 *
 * O `craftItem` anunciava `// 4. Consome ingredientes (transação segura: tudo
 * ou nada)` e não era nenhuma das duas coisas. Era um laço de
 * `inventoryService.removeItem()` independentes seguido de um `giveItem()`, e
 * cada uma dessas funções **abre a própria transação** no transaction-service.
 * Uma receita de três ingredientes eram quatro transações separadas: se a
 * segunda falhasse, a primeira já tinha commitado, o jogador perdia o
 * ingrediente e não recebia nada.
 *
 * É `economy-service.transfer` (`removeGold` seguido de `addGold`, sem
 * transação) com outro substantivo — o mesmo defeito que motivou apagar aquele
 * arquivo, transposto de ouro para item.
 *
 * A Fase 3 (07/08/2026) juntou tudo numa transação pelas primitivas `tx.*`. Em
 * 13/08/2026 o mesmo fluxo passou a ser **uma chamada** de
 * `core/inventory.exchange`, com duas pernas: o consumo (personagem →
 * `system:consume`) e a entrega (`system:craft` → personagem). O ganho sobre a
 * versão anterior não é atomicidade — aquela já estava certa — e sim que o
 * outro lado de cada movimento passa a ter nome no razão, e que a chave de
 * idempotência deixou de ser inútil (ver o passo 4 do `craftItem`).
 */

const crypto = require('crypto');
const db = require('./database');
const commands = require('./commands');
const inventory = require('./core/inventory');
const professionService = require('./profession-service');
const serverOptions = require('./core/server-options');
const interactionRegistry = require('./core/interaction-registry');
const physicalAnchorRegistry = require('./core/physical-anchor-registry');
const MODULE = 'crafting';

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * Grava a Assinatura do Artesão (docs/design/MAKERS_MARK.md). Chamada DEPOIS
 * do `inventory.exchange` já ter commitado — não é a mesma transação (ver o
 * cabeçalho deste arquivo). Uma falha aqui não desfaz o craft: o jogador já
 * recebeu o item, só não fica registrado quem assinou.
 */
async function recordCraftSignature({ baseId, recipeId, makerCharacterId, ownerCharacterId, signatureText }) {
  try {
    await db.query(
      `INSERT INTO crafted_item_signatures
        (id, base_id, recipe_id, maker_character_id, owner_character_id, signature_text, crafted_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [uuid(), baseId, recipeId, makerCharacterId, ownerCharacterId, signatureText]
    );
  } catch (err) {
    console.error(`[crafting] falha ao gravar assinatura (recipe=${recipeId} maker=${makerCharacterId}):`, err.message);
  }
}

// Tipos de estação aceitos em `crafting_stations` (objetos reais do Skyrim).
const STATION_TYPES = ['forge', 'cooking_pot', 'tanning_rack', 'alchemy_lab', 'enchanting_table'];

async function resolveStation(formId) {
  if (!Number.isSafeInteger(formId) || formId <= 0) return null;
  if (typeof mp === 'undefined' || typeof mp.getDescFromId !== 'function') return null;
  const rows = await db.query(
    'SELECT station_type FROM crafting_stations WHERE form_desc = ? AND enabled = 1',
    [mp.getDescFromId(formId)]
  );
  return rows.length > 0 && STATION_TYPES.includes(rows[0].station_type)
    ? rows[0].station_type
    : null;
}

async function listStationFormDescs() {
  const rows = await db.query(
    'SELECT form_desc FROM crafting_stations WHERE enabled = 1 ORDER BY form_desc'
  );
  return rows.map((row) => row.form_desc).filter((value) => typeof value === 'string' && value.includes(':'));
}

function registerPhysicalAnchors() {
  physicalAnchorRegistry.register({
    targetType: interactionRegistry.TARGET_TYPES.OBJECT,
    list: async () => {
      if (typeof mp === 'undefined' || typeof mp.getIdFromDesc !== 'function') return [];
      return (await listStationFormDescs())
        .map((formDesc) => mp.getIdFromDesc(formDesc))
        .filter((targetId) => Number.isSafeInteger(targetId) && targetId > 0)
        .map((targetId) => ({ targetId }));
    }
  });
}

function registerInteractions() {
  const common = {
    module: MODULE,
    target: interactionRegistry.TARGET_TYPES.OBJECT,
    section: 'crafting',
    distance: serverOptions.get('crafting.maxDistance'),
    canSee: async (ctx) => Boolean(await resolveStation(ctx.target.formId))
  };

  interactionRegistry.register({
    ...common,
    id: 'crafting.recipes',
    label: 'Ver receitas',
    audit: interactionRegistry.AUDIT_LEVELS.TRACE,
    execute: async (ctx) => {
      const stationType = await resolveStation(ctx.target.formId);
      if (!stationType) return { message: 'Estação indisponível.' };
      const recipes = await listRecipes(ctx.actorId, stationType);
      return { message: recipes.length > 0 ? `${recipes.length} receita(s) disponível(is).` : 'Nenhuma receita disponível.' };
    }
  });

  interactionRegistry.register({
    ...common,
    id: 'crafting.craft',
    label: 'Criar item',
    audit: interactionRegistry.AUDIT_LEVELS.ECONOMY,
    idempotent: true,
    schema: {
      recipeId: { type: 'int', label: 'Receita', min: 1 },
      signatureText: { type: 'string', label: 'Dedicatória', max: 64, required: false }
    },
    execute: async (ctx) => {
      const stationType = await resolveStation(ctx.target.formId);
      if (!stationType) return { message: 'Estação indisponível.' };
      const ok = await craftItem(ctx.actorId, ctx.characterId, ctx.data.recipeId, {
        stationType,
        signatureText: ctx.data.signatureText,
        requestId: ctx.requestId
      });
      return { message: ok ? 'Item criado.' : 'Não foi possível criar o item.' };
    }
  });
}

/**
 * Lista as receitas disponíveis para um tipo de estação.
 */
async function listRecipes(actorId, stationType) {
  if (!STATION_TYPES.includes(stationType)) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Tipo de estação inválido.']);
    return [];
  }

  const recipes = await db.query(
    'SELECT id, name, result_base_id, result_count, requires_perk FROM crafting_recipes WHERE station_type = ?',
    [stationType]
  );

  if (recipes.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Nenhuma receita disponível em ${stationType}.`]);
    return [];
  }

  const summary = recipes.map(r => `[${r.id}] ${r.name}`).join(' | ');
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [summary]);
  return recipes;
}

/**
 * Executa um craft. A chamada de jogador vem da interação física; chamadas
 * internas/testes ainda podem fornecer opts diretamente.
 *
 * @param {number} actorId
 * @param {number} characterId
 * @param {number|string} recipeId
 * @param {object} [opts]
 * @param {string} [opts.stationType]    estação resolvida pelo servidor
 * @param {string} [opts.requestId]      chave de idempotência vinda de quem pediu
 * @param {string} [opts.signatureText]  dedicatória para a Assinatura do Artesão
 *   (docs/design/MAKERS_MARK.md); só é gravada se a receita tiver
 *   `required_profession` e o rank do personagem alcançar
 *   `crafting.signatureMinRank`. Silenciosamente ignorada, sem falhar o
 *   craft, quando o rank não alcança.
 */
async function craftItem(actorId, characterId, recipeId, opts = {}) {
  // 1. Carrega a receita
  const recipeRows = await db.query('SELECT * FROM crafting_recipes WHERE id = ?', [recipeId]);
  if (recipeRows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Receita não encontrada.']);
    return false;
  }
  const recipe = recipeRows[0];

  // 2. A estação resolvida no alvo físico precisa ser a da receita. A distância
  // é revalidada pelo Interaction Framework antes de `execute`; esta segunda
  // checagem impede usar uma receita de forge num tanning_rack válido.
  if (opts.stationType && opts.stationType !== recipe.station_type) {
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
        `Esta receita e feita em: ${recipe.station_type}.`
      ]);
    }
    return false;
  }

  // 2.5. Gate de profissão/rank — checado de verdade, ao contrário de
  // `requires_perk` (ver o cabeçalho deste arquivo). NULL = receita livre.
  if (recipe.required_profession) {
    const tem = await professionService.hasProfession(characterId, recipe.required_profession);
    if (!tem) {
      if (typeof mp !== 'undefined') {
        mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
          `Você precisa ser ${recipe.required_profession} para fazer isso.`
        ]);
      }
      return false;
    }
    if (recipe.required_rank !== null && recipe.required_rank !== undefined) {
      const estado = await professionService.getProfessionState(characterId, recipe.required_profession);
      if (!estado || estado.rank < recipe.required_rank) {
        if (typeof mp !== 'undefined') {
          mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
            `Seu rank de ${recipe.required_profession} ainda não é suficiente para esta receita.`
          ]);
        }
        return false;
      }
    }
  }

  // 3. Carrega os ingredientes
  const ingredients = await db.query('SELECT base_id, count FROM crafting_ingredients WHERE recipe_id = ?', [recipeId]);
  if (ingredients.length === 0) {
    // Receita sem ingrediente cadastrado criaria item do nada. `addRecipe` e
    // `addIngredient` sao dois comandos separados, entao a janela entre os dois
    // existe de verdade — e um craft nela seria duplicacao de item pela staff.
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Receita incompleta: nenhum ingrediente cadastrado.']);
    return false;
  }

  // 4. A chave de idempotencia.
  //
  // Ela continha `Date.now()`, e por isso nunca deduplicou nada: dois `/craft`
  // seguidos produziam duas chaves diferentes, o `UNIQUE` nao era violado e o
  // craft acontecia duas vezes — enquanto o comentario ali afirmava o
  // contrario (auditoria §5). Uma chave de idempotencia vem de QUEM PEDE, ou
  // de um estado estavel. Nunca do relogio de quem executa.
  const requestId = opts.requestId || inventory.newRequestId(`craft.${characterId}.${recipeId}`);

  // 5. Consome ingredientes e entrega o resultado — UMA transacao, duas pernas.
  //
  // A checagem de estoque nao precisa de passo proprio: o `applyStackDelta` le
  // com `FOR UPDATE` e lanca se faltar, o que e estritamente melhor que o
  // `hasItem` que existia antes. Aquele lia fora da transacao, entao entre a
  // checagem e o consumo o item podia ter saido por outro caminho (venda em
  // barraca, /removeitem da staff) e o craft consumia o que nao existia mais.
  //
  // As duas pernas nomeiam a contraparte `system`: o ingrediente vai para o
  // nada e o resultado vem do nada. E o que faz a soma dos deltas do razao
  // fechar em zero por `transfer_id`, e o que torna respondivel a pergunta
  // "de onde saiu este item?" que a auditoria §2 nao conseguia responder.
  const resultado = await inventory.exchange({
    legs: [
      {
        from: inventory.character(characterId, actorId),
        to: inventory.system(inventory.SYSTEM_SOURCES.CONSUME),
        items: ingredients.map(ing => ({ baseId: ing.base_id, quantity: ing.count }))
      },
      {
        from: inventory.system(inventory.SYSTEM_SOURCES.CRAFT),
        to: inventory.character(characterId, actorId),
        items: [{ baseId: recipe.result_base_id, quantity: recipe.result_count }]
      }
    ],
    reason: 'craft',
    module: MODULE,
    requestId
  });

  if (!resultado.ok) {
    console.error(`[crafting] Craft falhou (char=${characterId} recipe=${recipeId}): ${resultado.code} ${resultado.reason}`);
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Craft cancelado: ${resultado.reason}`]);
    }
    return false;
  }

  if (resultado.duplicate) {
    // Reenvio do mesmo pedido. Nao craftou de novo, e dizer "voce criou" seria
    // mentir sobre um item que o jogador ja tem.
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Este craft ja havia sido concluido.']);
    }
    return true;
  }

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
      `✓ Você criou: ${recipe.name} (x${recipe.result_count}).`
    ]);
  }

  // XP só quando a receita tem profissão dona — craft livre não progride
  // profissão nenhuma, pelo mesmo motivo que `mining-service` só concede XP
  // de `miner`.
  if (recipe.required_profession) {
    const xpPorCraft = serverOptions.get('crafting.xpPerCraft');
    if (xpPorCraft > 0) {
      await professionService.addProfessionXp({
        characterId,
        professionCode: recipe.required_profession,
        amount: xpPorCraft,
        context: 'craft'
      });
    }
  }

  // Assinatura do Artesão — ver o cabeçalho deste arquivo e
  // docs/design/MAKERS_MARK.md. Só faz sentido para receita com dono
  // (sem `required_profession` não há profissão pra checar rank contra).
  if (recipe.required_profession && opts.signatureText) {
    const estado = await professionService.getProfessionState(characterId, recipe.required_profession);
    const minRank = serverOptions.get('crafting.signatureMinRank');
    if (estado && estado.rank >= minRank) {
      const texto = String(opts.signatureText).trim().slice(0, 64);
      await recordCraftSignature({
        baseId: recipe.result_base_id,
        recipeId: recipe.id,
        makerCharacterId: characterId,
        ownerCharacterId: characterId,
        signatureText: texto || null
      });
      if (typeof mp !== 'undefined') {
        mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['✓ Trabalho assinado.']);
      }
    } else if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
        `Seu rank de ${recipe.required_profession} ainda não permite assinar este trabalho.`
      ]);
    }
  }

  commands.broadcastProximityMessage(actorId, `* Trabalha com habilidade na estação.`, 500);
  console.log(`[crafting] Char ${characterId} crafted recipe ${recipeId}: ${recipe.name}`);
  return true;
}

/**
 * Staff: Adiciona uma nova receita ao banco.
 * /addrecipe [station] [resultBaseId] [resultCount] [name]
 *
 * `requiredProfession`/`requiredRank` são opcionais — receita sem eles fica
 * livre para qualquer personagem, o mesmo default de `resource_nodes`.
 */
async function addRecipe(actorId, stationType, resultBaseId, resultCount, name, requiredProfession = null, requiredRank = null) {
  const adminService = require('./admin-service');
  if (!adminService.hasPermission(actorId, 'manage_recipes')) return null;

  const res = await db.query(
    `INSERT INTO crafting_recipes
      (name, station_type, result_base_id, result_count, required_profession, required_rank)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, stationType, resultBaseId, resultCount, requiredProfession, requiredRank]
  );
  const recipeId = res.insertId;

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Receita criada com ID ${recipeId}: ${name}`]);
  }
  console.log(`[crafting] Recipe ${recipeId} added by actor ${actorId.toString(16)}: ${name}`);
  return recipeId;
}

/**
 * Staff: Adiciona um ingrediente a uma receita.
 * /addingredient [recipeId] [baseId] [count]
 */
async function addIngredient(actorId, recipeId, baseId, count) {
  const adminService = require('./admin-service');
  if (!adminService.hasPermission(actorId, 'manage_recipes')) return;

  await db.query(
    'INSERT INTO crafting_ingredients (recipe_id, base_id, count) VALUES (?, ?, ?)',
    [recipeId, baseId, count]
  );
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Ingrediente 0x${baseId.toString(16)} x${count} adicionado à receita ${recipeId}.`]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Assinaturas para a Revista Institucional — mesmo padrão de
// `crime-service.getStolenInstancesHeldBy`: resolve o nome do artesão aqui,
// nunca devolve um characterId cru pra UI formatar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assinaturas de itens que `characterId` recebeu ao craftar, com o nome do
 * artesão já resolvido. Ver a ressalva no cabeçalho deste arquivo e em
 * `migration-v24-crafted-item-signatures.sql`: `owner_character_id` não é
 * atualizado em troca/venda, então isto reflete quem RECEBEU no craft, não
 * necessariamente quem tem o item agora.
 *
 * @param {number} characterId
 * @returns {Promise<Array<{baseId:number, signatureText:string|null, makerName:string}>>}
 */
async function getSignaturesHeldBy(characterId) {
  if (!Number.isSafeInteger(characterId) || characterId <= 0) return [];

  const rows = await db.query(
    `SELECT cis.base_id, cis.signature_text, c.first_name, c.last_name
       FROM crafted_item_signatures cis
       JOIN characters c ON c.id = cis.maker_character_id
      WHERE cis.owner_character_id = ?
      ORDER BY cis.crafted_at DESC
      LIMIT 20`,
    [characterId]
  );

  return rows.map((row) => ({
    baseId: Number(row.base_id),
    signatureText: row.signature_text || null,
    makerName: `${row.first_name} ${row.last_name}`.trim()
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Comandos administrativos. Crafting do jogador só passa pela interação em
// estação física; os antigos `/craft` e `/receitas` contornavam proximidade.
// ─────────────────────────────────────────────────────────────────────────────

function commandDefs() {
  return [
    {
      name: '/addrecipe',
      description: '[Staff] Cria uma receita (opcionalmente presa a uma profissão/rank)',
      usage: '/addrecipe <estacao> <resultBaseId> <resultCount> <nome> [profissao] [rank]',
      handler: async (actorId, args) => {
        const partes = String(args || '').trim().split(/\s+/);
        const [stationType, resultBaseIdRaw, resultCountRaw, ...resto] = partes;
        const resultBaseId = Number.parseInt(resultBaseIdRaw, 16);
        const resultCount = Number.parseInt(resultCountRaw, 10);
        if (!STATION_TYPES.includes(stationType) || !Number.isSafeInteger(resultBaseId) || !Number.isSafeInteger(resultCount) || resto.length === 0) {
          if (typeof mp !== 'undefined') {
            mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
              'Uso: /addrecipe <estacao> <resultBaseId hex> <resultCount> <nome> [profissao] [rank]'
            ]);
          }
          return;
        }
        // O nome pode ter espaço; profissão/rank, se vierem, são as duas
        // últimas palavras — heurística aceitável porque nome de receita não
        // termina com um rank numérico isolado.
        let name = resto.join(' ');
        let requiredProfession = null;
        let requiredRank = null;
        const possivelRank = Number.parseInt(resto[resto.length - 1], 10);
        if (resto.length >= 2 && Number.isSafeInteger(possivelRank)) {
          requiredRank = possivelRank;
          requiredProfession = resto[resto.length - 2];
          name = resto.slice(0, -2).join(' ');
        }
        if (!name) name = resto.join(' ');

        await addRecipe(actorId, stationType, resultBaseId, resultCount, name, requiredProfession, requiredRank);
      }
    },
    {
      name: '/addingredient',
      description: '[Staff] Adiciona um ingrediente a uma receita',
      usage: '/addingredient <recipeId> <baseId hex> <count>',
      handler: async (actorId, args) => {
        const [recipeIdRaw, baseIdRaw, countRaw] = String(args || '').trim().split(/\s+/);
        const recipeId = Number.parseInt(recipeIdRaw, 10);
        const baseId = Number.parseInt(baseIdRaw, 16);
        const count = Number.parseInt(countRaw, 10);
        if (!Number.isSafeInteger(recipeId) || !Number.isSafeInteger(baseId) || !Number.isSafeInteger(count)) {
          if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Uso: /addingredient <recipeId> <baseId hex> <count>']);
          return;
        }
        await addIngredient(actorId, recipeId, baseId, count);
      }
    }
  ];
}

module.exports = {
  listRecipes,
  craftItem,
  addRecipe,
  addIngredient,
  getSignaturesHeldBy,
  resolveStation,
  listStationFormDescs,
  registerPhysicalAnchors,
  registerInteractions,
  commandDefs,
  STATION_TYPES
};

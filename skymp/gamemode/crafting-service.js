/**
 * crafting-service.js
 * Sistema de Crafting Modular (Fase Beta).
 *
 * Funciona 100% server-side:
 * - O cliente envia a intenção de craftar (/craft [recipeId]).
 * - O servidor consome os ingredientes e entrega o resultado numa transação só.
 *
 * ⚠️ **O que este cabeçalho afirmava e não era verdade.** Até 13/08/2026 esta
 * lista dizia *"o servidor valida ingredientes, station proximity e perks"*.
 * Ingrediente sim, pelo `FOR UPDATE`. **Proximidade de estação: nunca** — o
 * `craftItem` sequer carregava a estação, então `/craft` funcionava do outro
 * lado do mapa. **Perk: nunca** — `requires_perk` é lido em `listRecipes` e
 * nunca comparado com nada.
 *
 * Hoje o `craftItem` confere que a estação **declarada** é a da receita, que é
 * uma regra de verdade e não é proximidade. Perk e proximidade continuam sem
 * validação, e agora estão escritos como ausentes em vez de anunciados como
 * presentes. Ver `docs/research/INVENTORY_TRADE_CRAFTING_AUDIT.md` §11 e
 * `docs/gameplay/CRAFTING_SYSTEM.md` §5.
 *
 * ⚠️ PARKED: não é registrado no `core/module-registry.js` e não roda em
 * produção. A migração abaixo é de segurança interna — reativar é outra
 * decisão, e misturar as duas é o erro que a Fase 2 do QA_REPORT existe pra
 * não repetir. Ver docs/technical/PARKED_SERVICES_DECISION.md §7.2.
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

const db = require('./database');
const commands = require('./commands');
const inventory = require('./core/inventory');
const MODULE = 'crafting';

// Tipos de estação e seus formDescs (objetos de referência do Skyrim)
// Esses IDs são verificados por proximidade (futuro: mp.get distance)
const STATION_TYPES = ['forge', 'cooking_pot', 'tanning_rack', 'alchemy_lab', 'enchanting_table'];

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
 * Executa um craft. /craft [recipeId] [estacao].
 *
 * @param {number} actorId
 * @param {number} characterId
 * @param {number|string} recipeId
 * @param {object} [opts]
 * @param {string} [opts.stationType] estação em que o jogador diz estar
 * @param {string} [opts.requestId]   chave de idempotência vinda de quem pediu
 */
async function craftItem(actorId, characterId, recipeId, opts = {}) {
  // 1. Carrega a receita
  const recipeRows = await db.query('SELECT * FROM crafting_recipes WHERE id = ?', [recipeId]);
  if (recipeRows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Receita não encontrada.']);
    return false;
  }
  const recipe = recipeRows[0];

  // 2. A estacao declarada precisa ser a da receita.
  //
  // Isto NAO e proximidade: o servidor nao sabe onde estao as forjas do mundo,
  // e nenhuma tabela guarda isso. O que esta checagem impede e forjar uma
  // espada no caldeirao de cozinha — e ela existe agora porque o cabecalho
  // deste arquivo afirmava, desde julho, que o servidor validava "station
  // proximity", e nada no `craftItem` chegava perto de fazer isso
  // (auditoria §11). Proximidade real depende do resolvedor de alvo `object`,
  // que o Interaction Framework ainda nao tem — ver
  // docs/gameplay/CRAFTING_SYSTEM.md §5.
  if (opts.stationType && opts.stationType !== recipe.station_type) {
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
        `Esta receita e feita em: ${recipe.station_type}.`
      ]);
    }
    return false;
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

  commands.broadcastProximityMessage(actorId, `* Trabalha com habilidade na estação.`, 500);
  console.log(`[crafting] Char ${characterId} crafted recipe ${recipeId}: ${recipe.name}`);
  return true;
}

/**
 * Staff: Adiciona uma nova receita ao banco.
 * /addrecipe [station] [resultBaseId] [resultCount] [name]
 */
async function addRecipe(actorId, stationType, resultBaseId, resultCount, name) {
  const adminService = require('./admin-service');
  if (!adminService.hasPermission(actorId, 'manage_recipes')) return null;

  const res = await db.query(
    'INSERT INTO crafting_recipes (name, station_type, result_base_id, result_count) VALUES (?, ?, ?, ?)',
    [name, stationType, resultBaseId, resultCount]
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

module.exports = {
  listRecipes,
  craftItem,
  addRecipe,
  addIngredient
};

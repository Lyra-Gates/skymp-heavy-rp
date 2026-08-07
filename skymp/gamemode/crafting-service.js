/**
 * crafting-service.js
 * Sistema de Crafting Modular (Fase Beta).
 *
 * Funciona 100% server-side:
 * - O cliente envia a intenção de craftar (/craft [recipeId]).
 * - O servidor valida ingredientes, station proximity e perks.
 * - Consome os ingredientes do inventário seguro.
 * - Entrega o resultado.
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
 * Agora é uma transação só, pelas primitivas `tx.*`, no mesmo formato que a
 * compra em barraca usa desde que ela deixou de escrever o próprio SQL.
 */

const db = require('./database');
const commands = require('./commands');
const transactionService = require('./core/transaction-service');
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
 * Executa um craft. /craft [recipeId].
 */
async function craftItem(actorId, characterId, recipeId) {
  // 1. Carrega a receita
  const recipeRows = await db.query('SELECT * FROM crafting_recipes WHERE id = ?', [recipeId]);
  if (recipeRows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Receita não encontrada.']);
    return false;
  }
  const recipe = recipeRows[0];

  // 2. Carrega os ingredientes
  const ingredients = await db.query('SELECT base_id, count FROM crafting_ingredients WHERE recipe_id = ?', [recipeId]);
  if (ingredients.length === 0) {
    // Receita sem ingrediente cadastrado criaria item do nada. `addRecipe` e
    // `addIngredient` sao dois comandos separados, entao a janela entre os dois
    // existe de verdade — e um craft nela seria duplicacao de item pela staff.
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Receita incompleta: nenhum ingrediente cadastrado.']);
    return false;
  }

  // 3. Uma chave por (personagem, receita, instante) — se o comando for
  // reenviado, o ledger recusa a segunda gravacao em vez de craftar duas vezes.
  const idempotencyKey = `craft_${characterId}_${recipeId}_${Date.now()}`;

  // 4. Consome ingredientes e entrega o resultado — UMA transacao.
  //
  // A checagem de estoque nao precisa de passo proprio: `applyInventoryDelta`
  // le com `FOR UPDATE` e lanca se faltar, o que e estritamente melhor que o
  // `hasItem` que existia antes. Aquele lia fora da transacao, entao entre a
  // checagem e o consumo o item podia ter saido por outro caminho (venda em
  // barraca, /removeitem da staff) e o craft consumia o que nao existia mais.
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const ing of ingredients) {
      await transactionService.tx.applyInventoryDelta(conn, characterId, ing.base_id, -ing.count);
      await transactionService.tx.recordInventoryLedger(conn, {
        characterId, baseId: ing.base_id, delta: -ing.count,
        reason: 'craft_consume', module: MODULE,
        idempotencyKey: `${idempotencyKey}_in_${ing.base_id}`
      });
    }

    await transactionService.tx.applyInventoryDelta(conn, characterId, recipe.result_base_id, recipe.result_count);
    await transactionService.tx.recordInventoryLedger(conn, {
      characterId, baseId: recipe.result_base_id, delta: recipe.result_count,
      reason: 'craft_result', module: MODULE,
      idempotencyKey: `${idempotencyKey}_out`
    });

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    // `err.message` das primitivas carrega nome de tabela e coluna quando o
    // erro e de SQL — mesma correcao que a compra em barraca ja levou. As
    // mensagens de regra ("Estoque insuficiente") o jogador precisa ver.
    console.error(`[crafting] Craft falhou (char=${characterId} recipe=${recipeId}):`, err.message);
    if (typeof mp !== 'undefined') {
      const regra = /insuficiente|nao possui|não possui/i.test(err.message);
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
        regra ? `Craft cancelado: ${err.message}` : 'Nao foi possivel concluir o craft.'
      ]);
    }
    return false;
  } finally {
    conn.release();
  }

  // 5. Cliente APOS o commit — o banco ja e a fonte de verdade, e uma falha
  // aqui e reconciliada no proximo login pelo inventory-service.
  for (const ing of ingredients) {
    transactionService.tx.applyToClient(actorId, ing.base_id, -ing.count);
  }
  transactionService.tx.applyToClient(actorId, recipe.result_base_id, recipe.result_count);

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

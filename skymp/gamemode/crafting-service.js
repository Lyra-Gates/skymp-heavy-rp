/**
 * crafting-service.js
 * Sistema de Crafting Modular (Fase Beta).
 *
 * Funciona 100% server-side:
 * - O cliente envia a intenção de craftar (/craft [recipeId]).
 * - O servidor valida ingredientes, station proximity e perks.
 * - Consome os ingredientes do inventário seguro.
 * - Entrega o resultado.
 */

const db = require('./database');
const commands = require('./commands');

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
  const inventoryService = require('./inventory-service');

  // 1. Carrega a receita
  const recipeRows = await db.query('SELECT * FROM crafting_recipes WHERE id = ?', [recipeId]);
  if (recipeRows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Receita não encontrada.']);
    return false;
  }
  const recipe = recipeRows[0];

  // 2. Carrega os ingredientes
  const ingredients = await db.query('SELECT base_id, count FROM crafting_ingredients WHERE recipe_id = ?', [recipeId]);

  // 3. Verifica se tem todos os ingredientes
  for (const ing of ingredients) {
    const has = await inventoryService.hasItem(characterId, ing.base_id, ing.count);
    if (!has) {
      if (typeof mp !== 'undefined') {
        mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
          `Ingrediente faltando: 0x${ing.base_id.toString(16)} (x${ing.count}).`
        ]);
      }
      return false;
    }
  }

  // 4. Consome ingredientes (transação segura: tudo ou nada)
  for (const ing of ingredients) {
    const removed = await inventoryService.removeItem(actorId, characterId, ing.base_id, ing.count);
    if (!removed) {
      if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Erro ao consumir ingredientes. Craft cancelado.']);
      return false;
    }
  }

  // 5. Entrega o resultado
  await inventoryService.giveItem(actorId, characterId, recipe.result_base_id, recipe.result_count);

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
  if (!adminService.hasPermission(actorId, 20)) return null;

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
  if (!adminService.hasPermission(actorId, 20)) return;

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

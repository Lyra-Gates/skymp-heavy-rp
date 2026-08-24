/**
 * crafting-service.test.js — CHARACTERIZATION TESTS
 *
 * Congela o comportamento REAL de crafting-service.js hoje, antes da primeira
 * migração arquitetural deste domínio (ver docs/research/
 * WORK_ECOSYSTEM_DECISION_SUMMARY.md, "Next Implementation Task").
 *
 * Além dos contratos legados ainda válidos, cobre a entrada autoritativa por
 * estação física: o cliente escolhe a receita, mas alvo e station_type são
 * resolvidos pelo servidor a partir de `crafting_stations`.
 *
 * `crafting-service.js` usa `require()` direto (sem injeção de dependência),
 * então `./database`, `./commands`, `./core/inventory`, `./profession-service`,
 * `./core/server-options` e `./admin-service` são interceptados via
 * `Module._load`, no mesmo padrão de mining-service.test.js/jobs-service.test.js.
 *
 * Executa com: node --test crafting-service.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const { describe, it, after } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — objetos únicos e estáveis (crafting-service.js guarda a referência
// do `require()` de topo de arquivo).
// ─────────────────────────────────────────────────────────────────────────────

const notifications = [];
const broadcasts = [];
const exchangeCalls = [];
const addXpCalls = [];

let recipesById = new Map();       // id -> row de crafting_recipes (ou undefined)
let recipesByStation = new Map();  // station_type -> [rows]
let ingredientsByRecipe = new Map(); // recipeId -> [{base_id, count}]
let insertedRecipes = [];
let insertedIngredients = [];
let exchangeResult = { ok: true };
let hasProfessionImpl = async () => true;
let getProfessionStateImpl = async () => ({ rank: 0 });
let xpPerCraft = 0;
let signatureMinRank = 2;
let insertedSignatures = [];
let hasPermissionImpl = () => true;
let characters = new Map();
let stationsByFormDesc = new Map();

const dbMock = {
  query: async (sql, params = []) => {
    if (/SELECT \* FROM crafting_recipes WHERE id = \?/i.test(sql)) {
      const row = recipesById.get(params[0]);
      return row ? [{ ...row }] : [];
    }
    if (/SELECT id, name, result_base_id, result_count, requires_perk FROM crafting_recipes WHERE station_type = \?/i.test(sql)) {
      return (recipesByStation.get(params[0]) || []).map((r) => ({ ...r }));
    }
    if (/SELECT base_id, count FROM crafting_ingredients WHERE recipe_id = \?/i.test(sql)) {
      return (ingredientsByRecipe.get(params[0]) || []).map((i) => ({ ...i }));
    }
    if (/SELECT station_type FROM crafting_stations WHERE form_desc = \? AND enabled = 1/i.test(sql)) {
      const stationType = stationsByFormDesc.get(params[0]);
      return stationType ? [{ station_type: stationType }] : [];
    }
    if (/SELECT form_desc FROM crafting_stations WHERE enabled = 1 ORDER BY form_desc/i.test(sql)) {
      return [...stationsByFormDesc.keys()].map((form_desc) => ({ form_desc }));
    }
    if (/INSERT INTO crafting_recipes/i.test(sql)) {
      const insertId = 1000 + insertedRecipes.length;
      insertedRecipes.push({ params, insertId });
      return { insertId, affectedRows: 1 };
    }
    if (/INSERT INTO crafting_ingredients/i.test(sql)) {
      insertedIngredients.push({ params });
      return { insertId: 2000 + insertedIngredients.length, affectedRows: 1 };
    }
    if (/INSERT INTO crafted_item_signatures/i.test(sql)) {
      insertedSignatures.push({ params });
      return { insertId: 3000 + insertedSignatures.length, affectedRows: 1 };
    }
    throw new Error(`SQL inesperado (dbMock.query): ${sql}`);
  }
};

const commandsMock = {
  getActiveCharacterData: (actorId) => characters.get(actorId) || null,
  broadcastProximityMessage: (actorId, message, radius) => { broadcasts.push({ actorId, message, radius }); }
};

const inventoryMock = {
  character: (characterId, actorId) => ({ type: 'character', ref: String(characterId), characterId, actorId }),
  system: (source) => ({ type: 'system', ref: source }),
  SYSTEM_SOURCES: { CONSUME: 'consume', CRAFT: 'craft' },
  newRequestId: (prefix) => `${prefix}:auto`,
  exchange: async (opts) => { exchangeCalls.push(opts); return exchangeResult; }
};

const professionServiceMock = {
  hasProfession: async (characterId, code) => hasProfessionImpl(characterId, code),
  getProfessionState: async (characterId, code) => getProfessionStateImpl(characterId, code),
  addProfessionXp: async (opts) => { addXpCalls.push(opts); return { ok: true }; }
};

const serverOptionsMock = {
  get: (key) => {
    if (key === 'crafting.xpPerCraft') return xpPerCraft;
    if (key === 'crafting.signatureMinRank') return signatureMinRank;
    if (key === 'crafting.maxDistance') return 211;
    return undefined;
  }
};

const adminServiceMock = {
  hasPermission: (actorId, perm) => hasPermissionImpl(actorId, perm)
};

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './database' || request.endsWith('/database')) return dbMock;
  if (request === './commands' || request.endsWith('/commands')) return commandsMock;
  if (request === './core/inventory' || request.endsWith('/core/inventory')) return inventoryMock;
  if (request === './profession-service' || request.endsWith('/profession-service')) return professionServiceMock;
  if (request === './core/server-options' || request.endsWith('/core/server-options')) return serverOptionsMock;
  if (request === './admin-service' || request.endsWith('/admin-service')) return adminServiceMock;
  return originalLoad.apply(this, arguments);
};

const crafting = require('./crafting-service');
const interactionRegistry = require('./core/interaction-registry');
const physicalAnchorRegistry = require('./core/physical-anchor-registry');

after(() => {
  Module._load = originalLoad;
  delete global.mp;
});

global.mp = {
  getDescFromId: (formId) => formId === 0xabc123 ? 'abc123:Skyrim.esm' : '',
  getIdFromDesc: (formDesc) => formDesc === 'abc123:Skyrim.esm' ? 0xabc123 : 0,
  callPapyrusFunction: (kind, className, fn, self, args) => {
    if (className === 'Debug' && fn === 'notification') notifications.push({ text: args[0] });
    return null;
  }
};

const ACTOR = 0x100;
const CHAR_A = 42;
const RECIPE_ID = 7;
const STATION_FORM_ID = 0xabc123;
const STATION_FORM_DESC = 'abc123:Skyrim.esm';

function baseRecipe(overrides = {}) {
  return {
    id: RECIPE_ID,
    name: 'Espada de Ferro',
    station_type: 'forge',
    result_base_id: 0x0001397D,
    result_count: 1,
    requires_perk: null,
    required_profession: null,
    required_rank: null,
    ...overrides
  };
}

function resetState(overrides = {}) {
  notifications.length = 0;
  broadcasts.length = 0;
  exchangeCalls.length = 0;
  addXpCalls.length = 0;
  insertedRecipes = [];
  insertedIngredients = [];
  insertedSignatures = [];
  characters = new Map([[ACTOR, { characterId: CHAR_A }]]);
  exchangeResult = { ok: true };
  hasProfessionImpl = async () => true;
  getProfessionStateImpl = async () => ({ rank: 0 });
  xpPerCraft = 0;
  signatureMinRank = 2;
  hasPermissionImpl = () => true;
  stationsByFormDesc = new Map([[STATION_FORM_DESC, 'forge']]);
  interactionRegistry._reset();
  physicalAnchorRegistry._reset();

  const recipe = baseRecipe(overrides.recipe || {});
  recipesById = new Map([[recipe.id, recipe]]);
  recipesByStation = new Map([[recipe.station_type, [recipe]]]);
  ingredientsByRecipe = new Map([
    [recipe.id, overrides.ingredients !== undefined ? overrides.ingredients : [{ base_id: 0x0005ACE4, count: 2 }]]
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// listRecipes — receita inexistente / existente / listagem
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — listRecipes [CURRENT CONTRACT]', () => {
  it('station_type inválido: devolve [] e notifica, não consulta o banco', async () => {
    resetState();
    const r = await crafting.listRecipes(ACTOR, 'padaria_inexistente');
    assert.deepEqual(r, []);
    assert.ok(notifications.some((n) => n.text === 'Tipo de estação inválido.'));
  });

  it('station_type válido sem receita cadastrada: devolve [] e notifica', async () => {
    resetState({ ingredients: [] });
    recipesByStation.set('forge', []); // esvazia a estação
    const r = await crafting.listRecipes(ACTOR, 'forge');
    assert.deepEqual(r, []);
    assert.ok(notifications.some((n) => n.text === 'Nenhuma receita disponível em forge.'));
  });

  it('lista as receitas cadastradas para a estação', async () => {
    resetState();
    const r = await crafting.listRecipes(ACTOR, 'forge');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, RECIPE_ID);
  });

  it('[LEGACY / KNOWN GAP] não existe estado "habilitada/desabilitada" — não há coluna nem checagem disso em crafting_recipes (schema.sql confirma: id, name, station_type, result_base_id, result_count, requires_perk, created_at)', async () => {
    resetState();
    const r = await crafting.listRecipes(ACTOR, 'forge');
    assert.ok(!('enabled' in r[0]) && !('disabled' in r[0]) && !('active' in r[0]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Receita inexistente em craftItem
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — craftItem: receita [CURRENT CONTRACT]', () => {
  it('recipeId inexistente: devolve false, notifica, não chama inventory.exchange', async () => {
    resetState();
    const ok = await crafting.craftItem(ACTOR, CHAR_A, 999, {});
    assert.equal(ok, false);
    assert.equal(exchangeCalls.length, 0);
    assert.ok(notifications.some((n) => n.text === 'Receita não encontrada.'));
  });

  it('receita sem ingrediente cadastrado: devolve false, não chama exchange — recusa criar item do nada', async () => {
    resetState({ ingredients: [] });
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, false);
    assert.equal(exchangeCalls.length, 0);
    assert.ok(notifications.some((n) => n.text === 'Receita incompleta: nenhum ingrediente cadastrado.'));
  });

  it('receita válida com ingredientes: chama inventory.exchange exatamente uma vez', async () => {
    resetState();
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true);
    assert.equal(exchangeCalls.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// station_type — comparação de string, NÃO proximidade física
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — station_type [CURRENT CONTRACT + LEGACY / KNOWN GAP]', () => {
  it('station declarada bate com a da receita: prossegue', async () => {
    resetState();
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { stationType: 'forge' });
    assert.equal(ok, true);
  });

  it('station declarada diferente da receita: recusa antes de tocar inventory.exchange', async () => {
    resetState();
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { stationType: 'cooking_pot' });
    assert.equal(ok, false);
    assert.equal(exchangeCalls.length, 0);
    assert.ok(notifications.some((n) => n.text === 'Esta receita e feita em: forge.'));
  });

  it('station ausente (opts.stationType undefined): craftItem NÃO recusa — a checagem só roda se `opts.stationType` vier preenchido', async () => {
    resetState();
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true, 'sem stationType no opts, craftItem não tem como comparar e deixa passar');
    assert.equal(exchangeCalls.length, 1);
  });

  it('station_type_check_does_not_validate_world_distance_current_behavior [LEGACY / KNOWN GAP]: mesma station declarada de qualquer distância passa — craftItem nunca lê posição do ator nem do objeto da estação', async () => {
    resetState();
    // Nenhum mock de posição/distância existe neste arquivo de teste. Se
    // craftItem checasse proximidade real, precisaria consultar algo como
    // mp.get(actorId,'locationalData') ou o Interaction Framework — nenhum
    // dos dois é chamado aqui, e o craft ainda assim é aceito.
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { stationType: 'forge' });
    assert.equal(ok, true, 'a "estação" verificada é só um rótulo declarado pelo cliente, não uma posição no mundo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requires_perk — campo morto, confirmado
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — requires_perk [LEGACY / KNOWN GAP]', () => {
  it('requires_perk_is_not_enforced_current_behavior: preencher requires_perk não muda o resultado de craftItem()', async () => {
    resetState({ recipe: { requires_perk: 'PerkQueNinguemTem' } });
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true, 'craftItem() nunca lê requires_perk — nenhum personagem "tem" ou "não tem" o perk aqui, e o craft sempre passa por esse campo');
    assert.equal(exchangeCalls.length, 1);
  });

  it('requires_perk null e requires_perk preenchido produzem exatamente o mesmo resultado — prova de que o campo não participa da decisão', async () => {
    resetState({ recipe: { requires_perk: null } });
    const semPerk = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});

    resetState({ recipe: { requires_perk: 'Craftmanship' } });
    const comPerk = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});

    assert.equal(semPerk, comPerk);
    assert.equal(semPerk, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profession gate — required_profession
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — required_profession [CURRENT CONTRACT]', () => {
  it('required_profession null: não bloqueia, não consulta profession-service.hasProfession', async () => {
    resetState({ recipe: { required_profession: null } });
    let consultado = false;
    hasProfessionImpl = async () => { consultado = true; return true; };
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true);
    assert.equal(consultado, false, 'com required_profession null, craftItem não deveria nem perguntar');
  });

  it('required_profession preenchido, personagem TEM a profissão: permite', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    hasProfessionImpl = async (characterId, code) => characterId === CHAR_A && code === 'blacksmith';
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true);
  });

  it('required_profession preenchido, personagem SEM a profissão: bloqueia antes de tocar inventory.exchange', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    hasProfessionImpl = async () => false;
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, false);
    assert.equal(exchangeCalls.length, 0);
    assert.ok(notifications.some((n) => n.text === 'Você precisa ser blacksmith para fazer isso.'));
  });

  it('personagem "sem profissão nenhuma" é modelado exatamente como hasProfession() devolvendo false — não existe estado terceiro no craftItem', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    hasProfessionImpl = async () => false; // é assim que profession-service real reporta "nunca teve"
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, false);
  });

  it('profissão suspensa: comportamento real depende só do que hasProfession() devolve — craftItem não sabe distinguir suspensa de revogada, só chama hasProfession()', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    // hasProfession() real (profession-service.js) devolve false para status
    // suspended/revoked — craftItem herda esse comportamento sem lógica própria.
    hasProfessionImpl = async () => false;
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, false, 'craftItem trata suspensa igual a inexistente, porque hasProfession() já resolve isso antes de responder');
  });

  it('profissão revogada: mesmo comportamento — craftItem não distingue', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    hasProfessionImpl = async () => false;
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rank gate — required_rank
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — required_rank [CURRENT CONTRACT]', () => {
  it('required_rank null/undefined: não checa rank mesmo com profissão exigida', async () => {
    resetState({ recipe: { required_profession: 'blacksmith', required_rank: null } });
    hasProfessionImpl = async () => true;
    let consultouRank = false;
    getProfessionStateImpl = async () => { consultouRank = true; return { rank: 0 }; };
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true);
    assert.equal(consultouRank, false, 'required_rank null não deveria consultar getProfessionState');
  });

  it('rank exatamente no mínimo exigido: permite (comparação é >=)', async () => {
    resetState({ recipe: { required_profession: 'blacksmith', required_rank: 3 } });
    hasProfessionImpl = async () => true;
    getProfessionStateImpl = async () => ({ rank: 3 });
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true);
  });

  it('rank abaixo do mínimo: bloqueia antes de tocar inventory.exchange', async () => {
    resetState({ recipe: { required_profession: 'blacksmith', required_rank: 3 } });
    hasProfessionImpl = async () => true;
    getProfessionStateImpl = async () => ({ rank: 2 });
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, false);
    assert.equal(exchangeCalls.length, 0);
    assert.ok(notifications.some((n) => n.text === 'Seu rank de blacksmith ainda não é suficiente para esta receita.'));
  });

  it('rank acima do mínimo: permite', async () => {
    resetState({ recipe: { required_profession: 'blacksmith', required_rank: 3 } });
    hasProfessionImpl = async () => true;
    getProfessionStateImpl = async () => ({ rank: 9 });
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true);
  });

  it('getProfessionState devolve null (nunca teve a profissão, apesar de hasProfession improvável mockado true): bloqueia — craftItem trata rank ausente como insuficiente', async () => {
    resetState({ recipe: { required_profession: 'blacksmith', required_rank: 1 } });
    hasProfessionImpl = async () => true;
    getProfessionStateImpl = async () => null;
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, false, 'estado==null faz `!estado` ser true, então bloqueia mesmo sem comparar números');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inventory Framework — atomicidade observável
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — Inventory Framework / atomicidade [CURRENT CONTRACT]', () => {
  it('usa core/inventory.exchange com DUAS pernas: personagem→system(consume) e system(craft)→personagem, na MESMA chamada', async () => {
    resetState({ ingredients: [{ base_id: 0x0005ACE4, count: 2 }, { base_id: 0x0005ADE5, count: 1 }] });
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});

    assert.equal(exchangeCalls.length, 1, 'consumo de ingredientes e entrega do resultado são UMA chamada lógica, não duas');
    const { legs } = exchangeCalls[0];
    assert.equal(legs.length, 2);

    const consumo = legs[0];
    assert.equal(consumo.from.type, 'character');
    assert.equal(consumo.from.characterId, CHAR_A);
    assert.equal(consumo.to.ref, 'consume');
    assert.deepEqual(consumo.items, [{ baseId: 0x0005ACE4, quantity: 2 }, { baseId: 0x0005ADE5, quantity: 1 }]);

    const entrega = legs[1];
    assert.equal(entrega.from.ref, 'craft');
    assert.equal(entrega.to.type, 'character');
    assert.equal(entrega.to.characterId, CHAR_A);
    assert.deepEqual(entrega.items, [{ baseId: 0x0001397D, quantity: 1 }]);
  });

  it('exchange recebe reason=craft, module=crafting e um requestId', async () => {
    resetState();
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    const call = exchangeCalls[0];
    assert.equal(call.reason, 'craft');
    assert.equal(call.module, 'crafting');
    assert.equal(typeof call.requestId, 'string');
  });

  it('opts.requestId explícito é repassado sem alteração — não gera um novo', async () => {
    resetState();
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { requestId: 'meu-id-fixo' });
    assert.equal(exchangeCalls[0].requestId, 'meu-id-fixo');
  });

  it('exchange falha (ok:false): não entrega produto, retorna false, notifica com o motivo', async () => {
    resetState();
    exchangeResult = { ok: false, code: 'insufficient_stock', reason: 'ingrediente insuficiente' };
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, false);
    assert.ok(notifications.some((n) => n.text === 'Craft cancelado: ingrediente insuficiente'));
  });

  it('exchange devolve duplicate:true (reenvio do mesmo requestId): devolve true SEM craftar de novo, avisa que já foi concluído', async () => {
    resetState();
    exchangeResult = { ok: true, duplicate: true };
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true, 'idempotência reporta sucesso, não erro');
    assert.ok(notifications.some((n) => n.text === 'Este craft ja havia sido concluido.'));
    assert.ok(!notifications.some((n) => n.text.includes('Você criou')), 'não anuncia criação de novo em reenvio idempotente');
  });

  it('exchange falha: XP não é creditado', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    xpPerCraft = 5;
    exchangeResult = { ok: false, code: 'insufficient_stock', reason: 'sem ingrediente' };
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(addXpCalls.length, 0, 'craft que não aconteceu não deveria progredir profissão nenhuma');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ordem: validação/gate ANTES da mutação de inventário
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — ordem de execução [CURRENT CONTRACT]', () => {
  it('receita inexistente nunca chega a chamar exchange (validação antes de mutação)', async () => {
    resetState();
    await crafting.craftItem(ACTOR, CHAR_A, 12345, {});
    assert.equal(exchangeCalls.length, 0);
  });

  it('station incorreta nunca chega a chamar exchange', async () => {
    resetState();
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { stationType: 'alchemy_lab' });
    assert.equal(exchangeCalls.length, 0);
  });

  it('gate de profissão/rank roda ANTES de exchange — bloqueado por profissão nunca consome ingrediente nem entrega produto', async () => {
    resetState({ recipe: { required_profession: 'blacksmith', required_rank: 5 } });
    hasProfessionImpl = async () => false;
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(exchangeCalls.length, 0, 'profession gate está ANTES da mutação de inventário — nunca depois');
  });

  it('gate de rank roda ANTES de exchange — rank insuficiente nunca consome ingrediente', async () => {
    resetState({ recipe: { required_profession: 'blacksmith', required_rank: 5 } });
    hasProfessionImpl = async () => true;
    getProfessionStateImpl = async () => ({ rank: 1 });
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(exchangeCalls.length, 0);
  });

  it('receita sem ingrediente cadastrado nunca chega a chamar exchange (mesmo com profissão/station corretas)', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' }, ingredients: [] });
    hasProfessionImpl = async () => true;
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { stationType: 'forge' });
    assert.equal(exchangeCalls.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// XP — só quando a receita tem required_profession
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — XP [CURRENT CONTRACT]', () => {
  it('receita sem required_profession: craft livre não credita XP, mesmo com xpPerCraft > 0', async () => {
    resetState({ recipe: { required_profession: null } });
    xpPerCraft = 10;
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(addXpCalls.length, 0);
  });

  it('receita com required_profession e xpPerCraft > 0: credita XP daquela profissão', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    hasProfessionImpl = async () => true;
    xpPerCraft = 10;
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(addXpCalls.length, 1);
    assert.equal(addXpCalls[0].characterId, CHAR_A);
    assert.equal(addXpCalls[0].professionCode, 'blacksmith');
    assert.equal(addXpCalls[0].amount, 10);
    assert.equal(addXpCalls[0].context, 'craft');
  });

  it('receita com required_profession mas xpPerCraft == 0: não credita XP', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    hasProfessionImpl = async () => true;
    xpPerCraft = 0;
    await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(addXpCalls.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assinatura do Artesão — docs/design/MAKERS_MARK.md
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — Assinatura do Artesão [CURRENT CONTRACT]', () => {
  it('sem opts.signatureText: não grava nada, mesmo com rank suficiente', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    getProfessionStateImpl = async () => ({ rank: 3 });
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, {});
    assert.equal(ok, true);
    assert.equal(insertedSignatures.length, 0);
  });

  it('receita sem required_profession: não grava, mesmo com signatureText — não há profissão pra checar rank contra', async () => {
    resetState({ recipe: { required_profession: null } });
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { signatureText: 'Para Lydia' });
    assert.equal(ok, true);
    assert.equal(insertedSignatures.length, 0);
  });

  it('rank abaixo de signatureMinRank: craft completa, mas assinatura é recusada e o jogador é avisado', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    getProfessionStateImpl = async () => ({ rank: 1 });
    signatureMinRank = 2;
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { signatureText: 'Para Lydia' });
    assert.equal(ok, true, 'rank insuficiente não desfaz o craft, só a assinatura');
    assert.equal(insertedSignatures.length, 0);
    assert.ok(notifications.some((n) => /ainda não permite assinar/.test(n.text)));
  });

  it('rank suficiente: grava a assinatura com maker/owner = quem craftou e a dedicatória truncada', async () => {
    resetState({ recipe: { required_profession: 'blacksmith', result_base_id: 0xABCDEF } });
    getProfessionStateImpl = async () => ({ rank: 2 });
    signatureMinRank = 2;
    const dedicatoriaLonga = 'x'.repeat(100);
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { signatureText: dedicatoriaLonga });
    assert.equal(ok, true);
    assert.equal(insertedSignatures.length, 1);
    const [, baseId, recipeId, makerCharacterId, ownerCharacterId, signatureText] = insertedSignatures[0].params;
    assert.equal(baseId, 0xABCDEF);
    assert.equal(recipeId, RECIPE_ID);
    assert.equal(makerCharacterId, CHAR_A);
    assert.equal(ownerCharacterId, CHAR_A);
    assert.equal(signatureText.length, 64, 'dedicatória truncada em 64 caracteres');
    assert.ok(notifications.some((n) => n.text === '✓ Trabalho assinado.'));
  });

  it('resultado.duplicate (reenvio idempotente): não tenta gravar assinatura de novo', async () => {
    resetState({ recipe: { required_profession: 'blacksmith' } });
    getProfessionStateImpl = async () => ({ rank: 2 });
    exchangeResult = { ok: true, duplicate: true };
    const ok = await crafting.craftItem(ACTOR, CHAR_A, RECIPE_ID, { signatureText: 'Para Lydia' });
    assert.equal(ok, true);
    assert.equal(insertedSignatures.length, 0, 'craftItem retorna antes de chegar no bloco de assinatura em reenvio');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Estações físicas — alvo e station_type são sempre resolvidos no servidor
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — estações físicas autoritativas', () => {
  it('resolve somente FormDesc habilitado e tipo de estação conhecido', async () => {
    resetState();
    assert.equal(await crafting.resolveStation(STATION_FORM_ID), 'forge');
    assert.equal(await crafting.resolveStation(123), null);
    stationsByFormDesc.set(STATION_FORM_DESC, 'tipo_forjado');
    assert.equal(await crafting.resolveStation(STATION_FORM_ID), null);
  });

  it('publica a estação como âncora de objeto para o prompt [E]', async () => {
    resetState();
    crafting.registerPhysicalAnchors();
    assert.deepEqual(await physicalAnchorRegistry.listAll(), [{
      targetId: STATION_FORM_ID,
      targetType: interactionRegistry.TARGET_TYPES.OBJECT
    }]);
  });

  it('registra receitas/craft com alcance físico e idempotência', () => {
    resetState();
    crafting.registerInteractions();
    const recipes = interactionRegistry.get('crafting.recipes');
    const craft = interactionRegistry.get('crafting.craft');
    assert.equal(recipes.target, interactionRegistry.TARGET_TYPES.OBJECT);
    assert.equal(recipes.distance, 211);
    assert.equal(craft.distance, 211);
    assert.equal(craft.idempotent, true);
    assert.deepEqual(Object.keys(craft.schema), ['recipeId', 'signatureText']);
  });

  it('não mostra ações para objeto não cadastrado', async () => {
    resetState();
    crafting.registerInteractions();
    const craft = interactionRegistry.get('crafting.craft');
    assert.equal(await craft.canSee({ target: { formId: STATION_FORM_ID } }), true);
    assert.equal(await craft.canSee({ target: { formId: 123 } }), false);
  });

  it('craft usa estação resolvida e requestId do pipeline, sem aceitar station_type do cliente', async () => {
    resetState();
    crafting.registerInteractions();
    const craft = interactionRegistry.get('crafting.craft');
    const result = await craft.execute({
      actorId: ACTOR,
      characterId: CHAR_A,
      target: { formId: STATION_FORM_ID },
      data: { recipeId: RECIPE_ID, signatureText: '' },
      requestId: 'interaction:craft:123'
    });
    assert.deepEqual(result, { message: 'Item criado.' });
    assert.equal(exchangeCalls.length, 1);
    assert.equal(exchangeCalls[0].requestId, 'interaction:craft:123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addRecipe / addIngredient — gate de permissão de staff
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — addRecipe/addIngredient [CURRENT CONTRACT]', () => {
  it('addRecipe sem permissão manage_recipes: devolve null, não insere nada', async () => {
    resetState();
    hasPermissionImpl = () => false;
    const id = await crafting.addRecipe(ACTOR, 'forge', 0x123, 1, 'Machado');
    assert.equal(id, null);
    assert.equal(insertedRecipes.length, 0);
  });

  it('addRecipe com permissão: insere e devolve o insertId', async () => {
    resetState();
    hasPermissionImpl = () => true;
    const id = await crafting.addRecipe(ACTOR, 'forge', 0x123, 1, 'Machado', 'blacksmith', 2);
    assert.equal(typeof id, 'number');
    assert.equal(insertedRecipes.length, 1);
    assert.deepEqual(insertedRecipes[0].params, ['Machado', 'forge', 0x123, 1, 'blacksmith', 2]);
  });

  it('addIngredient sem permissão: não insere', async () => {
    resetState();
    hasPermissionImpl = () => false;
    await crafting.addIngredient(ACTOR, RECIPE_ID, 0x456, 3);
    assert.equal(insertedIngredients.length, 0);
  });

  it('addIngredient com permissão: insere recipeId/baseId/count', async () => {
    resetState();
    hasPermissionImpl = () => true;
    await crafting.addIngredient(ACTOR, RECIPE_ID, 0x456, 3);
    assert.equal(insertedIngredients.length, 1);
    assert.deepEqual(insertedIngredients[0].params, [RECIPE_ID, 0x456, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// commandDefs — CURRENT CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('crafting-service — commandDefs [CURRENT CONTRACT]', () => {
  it('expõe somente comandos administrativos; crafting do jogador exige estação física', () => {
    const nomes = crafting.commandDefs().map((d) => d.name);
    assert.deepEqual(nomes.sort(), ['/addingredient', '/addrecipe']);
    assert.equal(new Set(nomes).size, nomes.length);
    assert.ok(!nomes.includes('/craft'));
    assert.ok(!nomes.includes('/receitas'));
  });
});

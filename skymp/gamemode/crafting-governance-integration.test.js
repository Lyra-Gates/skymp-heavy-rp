/**
 * crafting-governance-integration.test.js
 *
 * Assinatura do Artesão (docs/design/MAKERS_MARK.md): valida o fluxo
 * completo atravessando dois módulos de verdade (crafting-service.js +
 * governance-service.js), sem stub de domínio nenhum — só o banco é falso.
 * Mesma técnica de `crime-governance-integration.test.js`: monkey-patch de
 * `Module._load` para `./database`, porque nenhum dos dois arquivos aceita
 * injeção de dependência para `db`.
 *
 * Fluxo: Ferreiro rank 2 craft com dedicatória -> assinatura gravada ->
 * Guarda revista o Ferreiro -> revista mostra a assinatura, sem o snapshot de
 * crime interferir (módulo `crime` desligado neste teste).
 *
 * Também exercita `migration-v24-crafted-item-signatures.sql`: o teste de
 * craft abaixo confere que a linha inserida tem os campos que
 * `governance.showInventorySnapshot`/`craftingService.getSignaturesHeldBy`
 * leem de volta.
 *
 * Executa com: node --test crafting-governance-integration.test.js
 */

'use strict';

const assert = require('assert');
const { describe, it, before, after } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────
// Estado do banco falso, compartilhado por crafting-service, governance-service,
// profession-service, transaction-service e inventory (todos requerem
// `./database` ou `../database`, que resolvem pro mesmo arquivo).
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  characterInventory: {}, // `${characterId}:${baseId}` -> count
  characters: new Map(), // characterId -> {account_id, first_name, last_name}
  characterProfessions: new Map(), // `${characterId}:${code}` -> row
  craftingRecipes: new Map(), // id -> row
  craftingIngredients: new Map(), // recipeId -> [{base_id, count}]
  craftedSignatures: [],
  guardMemberships: new Map(), // characterId -> {permissions: Set, onDuty: boolean}
  warrants: [],
  guardSearches: [],
  nextWarrantId: 1,
  nextSearchId: 1
};

function invKey(characterId, baseId) { return `${characterId}:${baseId}`; }
function profKey(characterId, code) { return `${characterId}:${code}`; }

function seedCharacter(characterId, accountId, firstName, lastName) {
  state.characters.set(characterId, { account_id: accountId, first_name: firstName, last_name: lastName });
}

function grantGuard(characterId, permissions, onDuty = true) {
  state.guardMemberships.set(characterId, { permissions: new Set(permissions), onDuty });
}

/** Mesma forma que `pool.execute` devolveria: `[rowsOuHeader, fields]`. */
async function dispatch(sql, params = []) {
  // ── pilhas (character_inventory) — mesmo contrato de transaction-service.tx.applyStackDelta ──
  const stackSelect = /SELECT count FROM character_inventory WHERE character_id = \? AND base_id = \? FOR UPDATE/i.exec(sql);
  if (stackSelect) {
    const count = state.characterInventory[invKey(params[0], params[1])];
    return [count === undefined ? [] : [{ count }]];
  }
  if (/UPDATE character_inventory SET count = count \+ \? WHERE character_id = \? AND base_id = \?/i.test(sql)) {
    const key = invKey(params[1], params[2]);
    state.characterInventory[key] = (state.characterInventory[key] || 0) + params[0];
    return [{ affectedRows: 1 }];
  }
  if (/INSERT INTO character_inventory \(character_id, base_id, count\) VALUES \(\?, \?, \?\)/i.test(sql)) {
    state.characterInventory[invKey(params[0], params[1])] = params[2];
    return [{ affectedRows: 1, insertId: 1 }];
  }
  if (/UPDATE character_inventory SET count = \? WHERE character_id = \? AND base_id = \?/i.test(sql)) {
    state.characterInventory[invKey(params[1], params[2])] = params[0];
    return [{ affectedRows: 1 }];
  }
  if (/DELETE FROM character_inventory WHERE character_id = \? AND base_id = \?/i.test(sql)) {
    delete state.characterInventory[invKey(params[0], params[1])];
    return [{ affectedRows: 1 }];
  }

  // ── inventory_transactions / idempotência (transaction-service.recordInventoryLedger
  // e o replay-guard do core/inventory.js exchange(), que usa outra coluna) ──
  if (/SELECT transaction_id FROM inventory_transactions WHERE idempotency_key = \?/i.test(sql)) return [[]];
  if (/SELECT transfer_id FROM inventory_transactions WHERE idempotency_key = \? FOR UPDATE/i.test(sql)) return [[]];
  if (/INSERT INTO inventory_transactions/i.test(sql)) return [{ affectedRows: 1, insertId: 1 }];

  // ── crafting_recipes / crafting_ingredients (crafting-service.craftItem) ──
  if (/SELECT \* FROM crafting_recipes WHERE id = \?/i.test(sql)) {
    const row = state.craftingRecipes.get(params[0]);
    return [row ? [{ ...row }] : []];
  }
  if (/SELECT base_id, count FROM crafting_ingredients WHERE recipe_id = \?/i.test(sql)) {
    return [(state.craftingIngredients.get(params[0]) || []).map((i) => ({ ...i }))];
  }

  // ── character_professions (profession-service.getProfessionState) ─────────
  if (/FROM character_professions WHERE character_id = \? AND profession_code = \?/i.test(sql)) {
    const row = state.characterProfessions.get(profKey(params[0], params[1]));
    return [row ? [{ ...row }] : []];
  }

  // ── crafted_item_signatures (crafting-service.recordCraftSignature) ───────
  if (/INSERT INTO crafted_item_signatures/i.test(sql)) {
    const [id, baseId, recipeId, makerCharacterId, ownerCharacterId, signatureText] = params;
    state.craftedSignatures.push({ id, base_id: baseId, recipe_id: recipeId, maker_character_id: makerCharacterId, owner_character_id: ownerCharacterId, signature_text: signatureText });
    return [{ affectedRows: 1 }];
  }
  if (/SELECT cis\.base_id, cis\.signature_text, c\.first_name, c\.last_name\s+FROM crafted_item_signatures cis\s+JOIN characters c ON c\.id = cis\.maker_character_id\s+WHERE cis\.owner_character_id = \?/i.test(sql)) {
    const rows = [];
    for (const row of state.craftedSignatures) {
      if (row.owner_character_id === params[0]) {
        const maker = state.characters.get(row.maker_character_id);
        rows.push({ base_id: row.base_id, signature_text: row.signature_text, first_name: maker.first_name, last_name: maker.last_name });
      }
    }
    return [rows];
  }

  // ── audit_logs (admin-service.auditLog) ─────────────────────────────────────
  if (/INSERT INTO audit_logs/i.test(sql)) return [{ affectedRows: 1, insertId: 1 }];

  // ── governance_memberships (hasPermission) ─────────────────────────────────
  if (/FROM governance_memberships gm[\s\S]*governance_role_permissions grp[\s\S]*grp\.permission = \?/i.test(sql)) {
    const [characterId, permission] = params;
    const membership = state.guardMemberships.get(characterId);
    const requiresDuty = /gm\.on_duty = 1/i.test(sql);
    if (membership && membership.permissions.has(permission) && (!requiresDuty || membership.onDuty)) {
      return [[{ role_name: 'guard', weight: 50, on_duty: membership.onDuty ? 1 : 0 }]];
    }
    return [[]];
  }

  // ── warrants ────────────────────────────────────────────────────────────────
  if (/INSERT INTO warrants \(target_character_id, issued_by_character_id, severity, reason, scope_type, scope_id\)/i.test(sql)) {
    const id = state.nextWarrantId++;
    state.warrants.push({ id, target_character_id: params[0], severity: params[1] ?? params[2], status: 'active' });
    return [{ affectedRows: 1, insertId: id }];
  }
  if (/SELECT \* FROM warrants\s+WHERE target_character_id = \? AND status = 'active'/i.test(sql)) {
    const found = state.warrants.filter((w) => w.target_character_id === params[0] && w.status === 'active');
    return [found.length > 0 ? [found[found.length - 1]] : []];
  }

  // ── guard_searches ──────────────────────────────────────────────────────────
  if (/INSERT INTO guard_searches/i.test(sql)) {
    const id = state.nextSearchId++;
    state.guardSearches.push({ id, target_character_id: params[0], officer_character_id: params[1], forced: params[3], status: params[4] });
    return [{ affectedRows: 1, insertId: id }];
  }
  if (/UPDATE guard_searches SET result_snapshot = \? WHERE id = \?/i.test(sql)) {
    return [{ affectedRows: 1 }];
  }

  // ── snapshot de inventário (governance-service.showInventorySnapshot) ───────
  if (/SELECT base_id, count FROM character_inventory WHERE character_id = \? AND count > 0/i.test(sql)) {
    const characterId = params[0];
    const rows = [];
    for (const [key, count] of Object.entries(state.characterInventory)) {
      const [ownerId, baseId] = key.split(':').map(Number);
      if (ownerId === characterId) rows.push({ base_id: baseId, count });
    }
    return [rows];
  }

  // ── character_known_identities (commands.registerActiveCharacter carrega no
  // login; irrelevante pra este fluxo, so silencia o log de erro) ────────────
  if (/FROM character_known_identities/i.test(sql)) return [[]];

  throw new Error(`SQL inesperado no fake de integracao: ${sql}`);
}

const conn = {
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {},
  query: (sql, params) => dispatch(sql, params)
};

const fakeDb = {
  getConnection: async () => conn,
  query: async (sql, params) => {
    const [rows] = await dispatch(sql, params);
    return rows;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Monkey-patch de `./database` ANTES de requerer os módulos de domínio —
// mesma técnica de crime-governance-integration.test.js.
// ─────────────────────────────────────────────────────────────────────────────

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database') {
    return fakeDb;
  }
  return originalLoad.apply(this, arguments);
};

const commands = require('./commands');
const moduleRegistry = require('./core/module-registry');
const craftingService = require('./crafting-service');
const governance = require('./governance-service');

Module._load = originalLoad;

// Mock mínimo do runtime `mp`: `set` pra capturar notificações (o que
// `commands.sendNotification` de verdade chama), `callPapyrusFunction` captura
// as notificações de `crafting-service` (que usa o Papyrus direto, não
// `commands.sendNotification`).
const notifications = []; // {actorId, message}
const positions = new Map(); // actorId -> {pos, cell}

global.mp = {
  get: (actorId, prop) => {
    if (prop !== 'locationalData' && prop !== 'pos') return null;
    const p = positions.get(actorId);
    if (!p) return null;
    return { pos: p.pos, cellOrWorldDesc: p.cell };
  },
  set: (actorId, prop, value) => {
    if (prop === 'browserModal' && value && value.data) {
      notifications.push({ actorId, message: value.data.message });
    }
  },
  getDescFromId: (id) => `desc-${id}`,
  callPapyrusFunction: (kind, className, fn, self, args) => {
    if (className === 'Debug' && fn === 'notification') {
      // crafting-service não sabe o actorId "oficial" de quem recebe — é
      // sempre o `actorId` que craftItem recebeu, capturado no closure do
      // teste via ARTESAO_ACTOR abaixo (único ator craftando neste fluxo).
      notifications.push({ actorId: ARTESAO_ACTOR, message: args[0] });
    }
    return null;
  }
};

after(() => {
  delete global.mp;
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ARTESAO_ACTOR = 0xff00c001;
const ARTESAO_CHAR = 601;
const OFFICER_ACTOR = 0xff00c002;
const OFFICER_CHAR = 602;
const RECIPE_ID = 42;
const RESULT_BASE_ID = 0x2400;
const INGREDIENT_BASE_ID = 0x2401;

before(async () => {
  commands.registerActiveCharacter(ARTESAO_ACTOR, { id: ARTESAO_CHAR, first_name: 'Joao', last_name: 'Ferreiro' }, 1, 1);
  commands.registerActiveCharacter(OFFICER_ACTOR, { id: OFFICER_CHAR, first_name: 'Guarda', last_name: 'Leal' }, 2, 2);

  seedCharacter(ARTESAO_CHAR, 1, 'Joao', 'Ferreiro');
  seedCharacter(OFFICER_CHAR, 2, 'Guarda', 'Leal');

  grantGuard(OFFICER_CHAR, ['guard_warrant', 'guard_search'], true);

  positions.set(ARTESAO_ACTOR, { pos: [0, 0, 0], cell: 'whiterun' });
  positions.set(OFFICER_ACTOR, { pos: [10, 0, 0], cell: 'whiterun' });

  state.craftingRecipes.set(RECIPE_ID, {
    id: RECIPE_ID, name: 'Espada Longa', station_type: 'forge',
    result_base_id: RESULT_BASE_ID, result_count: 1,
    required_profession: 'blacksmith', required_rank: null
  });
  state.craftingIngredients.set(RECIPE_ID, [{ base_id: INGREDIENT_BASE_ID, count: 2 }]);
  state.characterInventory[invKey(ARTESAO_CHAR, INGREDIENT_BASE_ID)] = 5;

  state.characterProfessions.set(profKey(ARTESAO_CHAR, 'blacksmith'), {
    character_id: ARTESAO_CHAR, profession_code: 'blacksmith', status: 'active', rank: 2, xp: 0
  });

  // Registra 'crafting' como ativo no module-registry real (singleton do
  // processo) — sem isto, `moduleRegistry.isEnabled('crafting')` recusaria a
  // revista, e o gate de profissão em si não depende do registry (checa
  // profession-service direto). 'crime' fica de fora de propósito: prova que
  // a seção de assinatura aparece sem depender do módulo de crime.
  moduleRegistry.register({
    id: 'crafting',
    enabledBy: 'CRAFTING_INTEGRATION_TEST_FLAG',
    phase: 'lab',
    initialize: async () => {}
  });
  process.env.CRAFTING_INTEGRATION_TEST_FLAG = 'true';
  await moduleRegistry.bootAll();
});

describe('Fluxo Assinatura do Artesão: craft assinado -> revista mostra autoria', () => {
  it('rank 2 (>= signatureMinRank default) craft com dedicatória: grava a assinatura', async () => {
    const ok = await craftingService.craftItem(ARTESAO_ACTOR, ARTESAO_CHAR, RECIPE_ID, {
      stationType: 'forge',
      signatureText: 'Para Lydia, com honra'
    });

    assert.strictEqual(ok, true, 'craft deveria ter sucedido');
    assert.strictEqual(state.craftedSignatures.length, 1, 'deveria ter gravado exatamente uma assinatura');
    const assinatura = state.craftedSignatures[0];
    assert.strictEqual(assinatura.base_id, RESULT_BASE_ID);
    assert.strictEqual(assinatura.maker_character_id, ARTESAO_CHAR);
    assert.strictEqual(assinatura.owner_character_id, ARTESAO_CHAR);
    assert.strictEqual(assinatura.signature_text, 'Para Lydia, com honra');
  });

  it('a guarda revista o artesão e vê a assinatura (autoria, não culpa)', async () => {
    notifications.length = 0;

    await governance.issueWarrant(OFFICER_ACTOR, ARTESAO_ACTOR, 'minor', 'checagem de rotina');
    await governance.requestSearch(OFFICER_ACTOR, ARTESAO_ACTOR, 'revista de rotina');

    const signatureMsg = notifications.find((n) => n.actorId === OFFICER_ACTOR && /Assinatura/.test(n.message));
    assert.ok(signatureMsg, 'guarda deveria ter recebido uma notificação de assinatura');
    assert.match(signatureMsg.message, /Joao Ferreiro/, 'mensagem deve nomear o artesão');
    assert.match(signatureMsg.message, /Para Lydia, com honra/, 'mensagem deve trazer a dedicatória');
  });
});

// `moduleRegistry.isEnabled` é decidido uma única vez em `bootAll()` (lê
// `process.env` só no boot, não em cada chamada — ver core/module-registry.js
// linha 270) — não dá pra alternar em runtime dentro deste processo de teste
// pra provar "módulo desligado = revista sem a seção extra". O guard
// (`if (!moduleRegistry.isEnabled('crafting')) return;` no topo de
// `notifyMakerSignatures`) NÃO tem teste próprio hoje — mesma lacuna que já
// existe para o guard equivalente de `notifyStolenProvenance` (crime), não
// uma introduzida por esta tarefa.

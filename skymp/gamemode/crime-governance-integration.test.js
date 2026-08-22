/**
 * crime-governance-integration.test.js
 *
 * Tarefa 13 §6: valida o fluxo completo atravessando dois módulos de
 * verdade (core/crime-service.js + governance-service.js), sem stub de
 * domínio nenhum — só o banco é falso (mesma técnica de
 * `governance-service.hardening.test.js`: monkey-patch de `Module._load`
 * para `./database`, porque nenhum dos dois arquivos aceita injeção de
 * dependência para `db`).
 *
 * Fluxo: Alvo rende-se -> Ladrão rouba -> Item vira 'hot' -> Guarda revista
 * (e aprende a proveniência) -> Guarda confisca (item perde 'hot', mantém
 * 'stolen').
 *
 * Também exercita `migration-v22-crime-interactions.sql` (ALTER TABLE
 * `confiscations` ADD COLUMN `item_instance_id`): o teste de confisco abaixo
 * afirma que a linha inserida carrega esse vínculo.
 *
 * Executa com: node --test crime-governance-integration.test.js
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { describe, it, before, after } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────
// Estado do banco falso, compartilhado por crime-service, governance-service,
// transaction-service e inventory-service (todos requerem `./database` ou
// `../database`, que resolvem pro mesmo arquivo).
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  characterInventory: {}, // `${characterId}:${baseId}` -> count
  itemInstances: new Map(), // id -> row
  characters: new Map(), // characterId -> {account_id, first_name, last_name}
  warrants: [],
  guardSearches: [],
  confiscations: [],
  guardMemberships: new Map(), // characterId -> {permissions: Set, onDuty: boolean}
  nextWarrantId: 1,
  nextSearchId: 1,
  nextConfiscationId: 1
};

function invKey(characterId, baseId) { return `${characterId}:${baseId}`; }

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

  // ── inventory_transactions / idempotência (transaction-service) ───────────
  if (/SELECT transaction_id FROM inventory_transactions WHERE idempotency_key = \?/i.test(sql)) return [[]];
  if (/INSERT INTO inventory_transactions/i.test(sql)) return [{ affectedRows: 1 }];

  // ── characters.account_id (crime-service._resolveAccountId) ────────────────
  if (/SELECT account_id FROM characters WHERE id = \?/i.test(sql)) {
    const char = state.characters.get(params[0]);
    return [char === undefined ? [] : [{ account_id: char.account_id }]];
  }

  // ── audit_logs (admin-service.auditLog E crime-service._recordCrimeAudit) ──
  if (/INSERT INTO audit_logs/i.test(sql)) return [{ affectedRows: 1, insertId: 1 }];

  // ── item_instances (crime-service.markItemStolen) ──────────────────────────
  if (/SELECT id, provenance_data FROM item_instances\s+WHERE base_id = \? AND current_owner_id = \? AND status IN \('hot', 'stolen'\) FOR UPDATE/i.test(sql)) {
    for (const row of state.itemInstances.values()) {
      if (row.base_id === params[0] && row.current_owner_id === params[1] && (row.status === 'hot' || row.status === 'stolen')) {
        return [[{ id: row.id, provenance_data: JSON.stringify(row.provenance_data || []) }]];
      }
    }
    return [[]];
  }
  if (/INSERT INTO item_instances/i.test(sql)) {
    const [id, baseId, originalOwnerId, currentOwnerId, holdId, provenanceJson] = params;
    state.itemInstances.set(id, {
      id, base_id: baseId, original_owner_id: originalOwnerId, current_owner_id: currentOwnerId,
      status: 'hot', last_hold_id: holdId, provenance_data: JSON.parse(provenanceJson)
    });
    return [{ affectedRows: 1 }];
  }

  // ── item_instances (crime-service.markItemConfiscated) ──────────────────────
  if (/SELECT id, status FROM item_instances\s+WHERE current_owner_id = \? AND base_id = \? AND status IN \('hot', 'stolen'\) FOR UPDATE/i.test(sql)) {
    for (const row of state.itemInstances.values()) {
      if (row.current_owner_id === params[0] && row.base_id === params[1] && (row.status === 'hot' || row.status === 'stolen')) {
        return [[{ id: row.id, status: row.status }]];
      }
    }
    return [[]];
  }
  if (/UPDATE item_instances SET status = 'stolen' WHERE id = \?/i.test(sql)) {
    const row = state.itemInstances.get(params[0]);
    if (row) row.status = 'stolen';
    return [{ affectedRows: 1 }];
  }

  // ── proveniência (crime-service.getStolenInstancesHeldBy) ───────────────────
  if (/SELECT ii\.id, ii\.base_id, ii\.status, ii\.original_owner_id, c\.first_name, c\.last_name\s+FROM item_instances ii\s+JOIN characters c ON c\.id = ii\.original_owner_id\s+WHERE ii\.current_owner_id = \? AND ii\.status IN \('hot', 'stolen'\)/i.test(sql)) {
    const rows = [];
    for (const row of state.itemInstances.values()) {
      if (row.current_owner_id === params[0] && (row.status === 'hot' || row.status === 'stolen')) {
        const owner = state.characters.get(row.original_owner_id);
        rows.push({
          id: row.id, base_id: row.base_id, status: row.status, original_owner_id: row.original_owner_id,
          first_name: owner.first_name, last_name: owner.last_name
        });
      }
    }
    return [rows];
  }

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

  // ── confiscations ────────────────────────────────────────────────────────────
  if (/INSERT INTO confiscations/i.test(sql)) {
    const id = state.nextConfiscationId++;
    state.confiscations.push({
      id, target_character_id: params[0], officer_character_id: params[1],
      base_id: params[2], count: params[3], reason: params[4], item_instance_id: params[5]
    });
    return [{ affectedRows: 1, insertId: id }];
  }

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
// mesma técnica de governance-service.hardening.test.js.
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
const characterState = require('./core/character-state');
const moduleRegistry = require('./core/module-registry');
const crimeService = require('./core/crime-service');
const governance = require('./governance-service');

Module._load = originalLoad;

// Mock mínimo do runtime `mp`: `get` para assertRange, `set` pra capturar
// notificações (é o que `commands.sendNotification` de verdade chama —
// `mp.set(actorId, 'browserModal', {data:{message}})`), `callPapyrusFunction`
// no-op (aplicação no cliente e animação de rendição, nenhuma das duas é o
// que este teste verifica).
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
  callPapyrusFunction: () => null
};

after(() => {
  delete global.mp;
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const VICTIM_ACTOR = 0xff00b001;
const VICTIM_CHAR = 501;
const THIEF_ACTOR = 0xff00b002;
const THIEF_CHAR = 502;
const OFFICER_ACTOR = 0xff00b003;
const OFFICER_CHAR = 503;
const RING = 0x1390; // qualquer FormID positivo

before(async () => {
  commands.registerActiveCharacter(VICTIM_ACTOR, { id: VICTIM_CHAR, first_name: 'Balgruuf', last_name: 'Pedra-Cinzenta' }, 1, 1);
  commands.registerActiveCharacter(THIEF_ACTOR, { id: THIEF_CHAR, first_name: 'Ladra', last_name: 'Da Sombra' }, 2, 2);
  commands.registerActiveCharacter(OFFICER_ACTOR, { id: OFFICER_CHAR, first_name: 'Guarda', last_name: 'Leal' }, 3, 3);

  seedCharacter(VICTIM_CHAR, 1, 'Balgruuf', 'Pedra-Cinzenta');
  seedCharacter(THIEF_CHAR, 2, 'Ladra', 'Da Sombra');
  seedCharacter(OFFICER_CHAR, 3, 'Guarda', 'Leal');

  grantGuard(OFFICER_CHAR, ['guard_warrant', 'guard_search', 'guard_confiscate'], true);

  positions.set(VICTIM_ACTOR, { pos: [0, 0, 0], cell: 'whiterun' });
  positions.set(THIEF_ACTOR, { pos: [10, 0, 0], cell: 'whiterun' });
  positions.set(OFFICER_ACTOR, { pos: [15, 0, 0], cell: 'whiterun' });

  state.characterInventory[invKey(VICTIM_CHAR, RING)] = 1;

  // Registra 'crime' como ativo no module-registry real (singleton do
  // processo) — sem isto, `_isModuleEnabled` recusaria tudo com
  // 'module_disabled'. Nenhuma dependência de 'interaction' aqui: este teste
  // chama as funções de domínio direto, não o Interaction Framework.
  moduleRegistry.register({
    id: 'crime',
    enabledBy: 'CRIME_INTEGRATION_TEST_FLAG',
    phase: 'lab',
    initialize: async () => {}
  });
  process.env.CRIME_INTEGRATION_TEST_FLAG = 'true';
  await moduleRegistry.bootAll();
});

describe('Fluxo Tarefa 13: rendição -> roubo -> revista -> confisco', () => {
  it('o alvo rendido pode ser roubado', async () => {
    assert.strictEqual(moduleRegistry.isEnabled('crime'), true, 'pre-condicao: modulo crime deveria estar ativo');

    characterState.set(VICTIM_CHAR, characterState.STATES.SURRENDERED, {});
    assert.strictEqual(
      crimeService._isRobbable(VICTIM_CHAR, { characterState }),
      true,
      'alvo rendido deveria ser roubavel'
    );
  });

  it('o roubo transfere o item e cria a instancia hot', async () => {
    const result = await crimeService.markItemStolen({
      victimActorId: VICTIM_ACTOR, victimCharacterId: VICTIM_CHAR,
      thiefActorId: THIEF_ACTOR, thiefCharacterId: THIEF_CHAR,
      baseId: RING, holdId: 'whiterun'
    });

    assert.strictEqual(result.ok, true, `roubo deveria ter sucedido: ${JSON.stringify(result)}`);
    assert.strictEqual(state.characterInventory[invKey(VICTIM_CHAR, RING)], undefined, 'vitima perdeu o item');
    assert.strictEqual(state.characterInventory[invKey(THIEF_CHAR, RING)], 1, 'ladrao ficou com o item');

    const instance = state.itemInstances.get(result.data.instanceId);
    assert.strictEqual(instance.status, 'hot', 'item recem-roubado deve estar hot');
    assert.strictEqual(instance.original_owner_id, VICTIM_CHAR);
  });

  it('a guarda revista o ladrao e aprende a proveniencia (nome, nao veredito)', async () => {
    notifications.length = 0;

    // Mandado forca a revista sem exigir consentimento — simplifica o teste
    // sem tocar no fluxo de /searchaccept, que já tem cobertura própria.
    await governance.issueWarrant(OFFICER_ACTOR, THIEF_ACTOR, 'minor', 'suspeita de roubo');
    await governance.requestSearch(OFFICER_ACTOR, THIEF_ACTOR, 'revista de rotina');

    const provenanceMsg = notifications.find((n) => n.actorId === OFFICER_ACTOR && /Proveniencia/.test(n.message));
    assert.ok(provenanceMsg, 'guarda deveria ter recebido uma notificacao de proveniencia');
    assert.match(provenanceMsg.message, /Balgruuf Pedra-Cinzenta/, 'mensagem deve nomear o dono original, nao rotular o ladrao');
    assert.doesNotMatch(provenanceMsg.message, /ladr[aã]o/i, 'a UI nao deve emitir veredito ("ele e ladrao") — so o fato de proveniencia');
  });

  it('a guarda confisca: item perde hot mas continua stolen', async () => {
    const instanceId = [...state.itemInstances.values()][0].id;

    await governance.confiscateItem(OFFICER_ACTOR, THIEF_ACTOR, RING, 1, 'evidencia de roubo');

    assert.strictEqual(state.characterInventory[invKey(THIEF_CHAR, RING)], undefined, 'item confiscado sai do inventario do ladrao');

    const instance = state.itemInstances.get(instanceId);
    assert.strictEqual(instance.status, 'stolen', 'mutacao: confisco nao pode voltar o item pra clean sozinho, nem deixa-lo hot');

    const confiscation = state.confiscations.find((c) => c.base_id === RING);
    assert.ok(confiscation, 'linha de confiscations deveria existir');
    assert.strictEqual(confiscation.item_instance_id, instanceId, 'evidencia deve linkar de volta pra item_instances');
  });
});

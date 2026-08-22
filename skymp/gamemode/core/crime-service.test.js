/**
 * core/crime-service.test.js
 *
 * Cobre o estado criado por `migration-v21-crime-provenance.sql`
 * (item_instances, session_crime_alerts, audit_logs.is_crime) e os três
 * requisitos centrais do brief da Tarefa 12: (1) marcar roubo e transferir
 * posse na MESMA transação, (2) proveniência sobrevive a refurto sem perder o
 * dono original, (3) anti-combat-log resolve por retorno OU por restituição
 * via depot-service, nunca sem gravar nada.
 *
 * Executa com: node --test core/crime-service.test.js
 */

'use strict';

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

const crimeService = require('./crime-service');

const VICTIM = 101;
const THIEF = 102;
const OTHER_THIEF = 103;
const WHITERUN = 'whiterun';
const RING = 0x139; // qualquer FormID, só precisa ser positivo

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

function makeHarness(options = {}) {
  const state = {
    characterInventory: { ...(options.characterInventory || {}) }, // `${characterId}:${baseId}` -> count
    characterAccounts: { ...(options.characterAccounts || {}) }, // characterId -> accountId
    characters: new Map(Object.entries(options.characters || {}).map(([id, v]) => [Number(id), v])), // characterId -> {firstName, lastName}
    itemInstances: new Map(Object.entries(options.itemInstances || {})), // id -> row
    sessionAlerts: [], // { id, character_id, item_instance_id, disconnected_at_ago_minutes, resolved }
    auditLogs: [],
    depots: new Map(Object.entries(options.depots || {})), // `${characterId}:${holdId}` -> {id, capacity}
    depotInventory: new Map(),
    nextDepotId: 1,
    nextAlertId: 1
  };

  function invKey(characterId, baseId) { return `${characterId}:${baseId}`; }
  function depotKey(characterId, holdId) { return `${characterId}:${holdId}`; }
  function depotInvKey(depotId, baseId) { return `${depotId}:${baseId}`; }

  function applyStackDelta(store, key, delta) {
    const current = store[key] || 0;
    const next = current + delta;
    if (next < 0) throw new Error(`Estoque insuficiente para ${key}`);
    if (next === 0) delete store[key];
    else store[key] = next;
  }

  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, params = []) => {
      if (options.failOn && new RegExp(options.failOn, 'i').test(sql)) {
        throw new Error('conexao com o banco caiu');
      }

      // ── pilhas genéricas (character_inventory / depot_inventory), mesmo
      // contrato de transaction-service.tx.applyStackDelta ──────────────────
      const stackSelect = /SELECT count FROM (character_inventory|depot_inventory) WHERE (character_id|depot_id) = \? AND base_id = \? FOR UPDATE/i.exec(sql);
      if (stackSelect) {
        const table = stackSelect[1];
        const key = table === 'character_inventory' ? invKey(params[0], params[1]) : depotInvKey(params[0], params[1]);
        const store = table === 'character_inventory' ? state.characterInventory : Object.fromEntries(state.depotInventory);
        const count = store[key];
        return [count === undefined ? [] : [{ count }]];
      }
      const stackUpdateAdd = /UPDATE (character_inventory|depot_inventory) SET count = count \+ \? WHERE (character_id|depot_id) = \? AND base_id = \?/i.exec(sql);
      if (stackUpdateAdd) {
        const table = stackUpdateAdd[1];
        const key = table === 'character_inventory' ? invKey(params[1], params[2]) : depotInvKey(params[1], params[2]);
        const store = table === 'character_inventory' ? state.characterInventory : state.depotInventory;
        if (table === 'character_inventory') applyStackDelta(state.characterInventory, key, params[0]);
        else state.depotInventory.set(key, (state.depotInventory.get(key) || 0) + params[0]);
        return [{ affectedRows: 1 }];
      }
      const stackInsert = /INSERT INTO (character_inventory|depot_inventory) \((character_id|depot_id), base_id, count\) VALUES \(\?, \?, \?\)/i.exec(sql);
      if (stackInsert) {
        const table = stackInsert[1];
        const key = table === 'character_inventory' ? invKey(params[0], params[1]) : depotInvKey(params[0], params[1]);
        if (table === 'character_inventory') state.characterInventory[key] = params[2];
        else state.depotInventory.set(key, params[2]);
        return [{ affectedRows: 1, insertId: 1 }];
      }
      const stackSet = /UPDATE (character_inventory|depot_inventory) SET count = \? WHERE (character_id|depot_id) = \? AND base_id = \?/i.exec(sql);
      if (stackSet) {
        const table = stackSet[1];
        const key = table === 'character_inventory' ? invKey(params[1], params[2]) : depotInvKey(params[1], params[2]);
        if (table === 'character_inventory') state.characterInventory[key] = params[0];
        else state.depotInventory.set(key, params[0]);
        return [{ affectedRows: 1 }];
      }
      const stackDelete = /DELETE FROM (character_inventory|depot_inventory) WHERE (character_id|depot_id) = \? AND base_id = \?/i.exec(sql);
      if (stackDelete) {
        const table = stackDelete[1];
        const key = table === 'character_inventory' ? invKey(params[0], params[1]) : depotInvKey(params[0], params[1]);
        if (table === 'character_inventory') delete state.characterInventory[key];
        else state.depotInventory.delete(key);
        return [{ affectedRows: 1 }];
      }

      // ── character_depots (subconjunto usado pela restituição) ─────────────
      if (/SELECT id FROM character_depots WHERE id = \? FOR UPDATE/i.test(sql)) {
        for (const depot of state.depots.values()) {
          if (depot.id === params[0]) return [[{ id: depot.id }]];
        }
        return [[]];
      }
      if (/SELECT id, capacity FROM character_depots WHERE character_id = \? AND hold_id = \? FOR UPDATE/i.test(sql)) {
        const found = state.depots.get(depotKey(params[0], params[1]));
        return [found ? [{ id: found.id, capacity: found.capacity }] : []];
      }
      if (/INSERT INTO character_depots/i.test(sql)) {
        const id = state.nextDepotId++;
        state.depots.set(depotKey(params[0], params[1]), { id, capacity: params[2] });
        return [{ affectedRows: 1, insertId: id }];
      }

      // ── inventory_transactions (ledger de transaction-service.tx.recordInventoryLedger) ──
      if (/INSERT INTO inventory_transactions/i.test(sql)) {
        return [{ affectedRows: 1 }];
      }

      // ── characters.account_id (resolução de audit_logs) ────────────────────
      if (/SELECT account_id FROM characters WHERE id = \?/i.test(sql)) {
        const accountId = state.characterAccounts[params[0]];
        return [accountId === undefined ? [] : [{ account_id: accountId }]];
      }

      // ── audit_logs ──────────────────────────────────────────────────────────
      if (/INSERT INTO audit_logs/i.test(sql)) {
        // `is_crime` e literal `1` no SQL (nao placeholder) — so 5 `?` na query.
        state.auditLogs.push({
          action: params[0], actorAccountId: params[1], targetAccountId: params[2],
          details: params[3] ? JSON.parse(params[3]) : null, isCrime: 1, itemInstanceId: params[4]
        });
        return [{ affectedRows: 1, insertId: state.auditLogs.length }];
      }

      // ── item_instances ──────────────────────────────────────────────────────
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
          status: 'hot', stolen_at_ago_minutes: 0, last_hold_id: holdId, provenance_data: JSON.parse(provenanceJson)
        });
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE item_instances\s+SET current_owner_id = \?, status = 'hot', stolen_at = NOW\(\), last_hold_id = \?, provenance_data = \?\s+WHERE id = \?/i.test(sql)) {
        const [currentOwnerId, holdId, provenanceJson, id] = params;
        const row = state.itemInstances.get(id);
        row.current_owner_id = currentOwnerId;
        row.status = 'hot';
        row.stolen_at_ago_minutes = 0;
        row.last_hold_id = holdId;
        row.provenance_data = JSON.parse(provenanceJson);
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE item_instances SET current_owner_id = \?, status = 'clean' WHERE id = \?/i.test(sql)) {
        const row = state.itemInstances.get(params[1]);
        row.current_owner_id = params[0];
        row.status = 'clean';
        return [{ affectedRows: 1 }];
      }

      // ── item_instances (markItemConfiscated) ────────────────────────────────
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

      throw new Error(`SQL inesperado no harness (conn): ${sql}`);
    }
  };

  const db = {
    getConnection: async () => conn,
    query: async (sql, params = []) => {
      if (options.failOn && new RegExp(options.failOn, 'i').test(sql)) {
        throw new Error('conexao com o banco caiu');
      }

      if (/SELECT id FROM item_instances WHERE current_owner_id = \? AND status = 'hot'/i.test(sql)) {
        const rows = [];
        for (const row of state.itemInstances.values()) {
          if (row.current_owner_id === params[0] && row.status === 'hot') rows.push({ id: row.id });
        }
        return rows;
      }
      if (/INSERT INTO session_crime_alerts \(character_id, item_instance_id\) VALUES \(\?, \?\)/i.test(sql)) {
        state.sessionAlerts.push({
          id: state.nextAlertId++, character_id: params[0], item_instance_id: params[1],
          disconnected_at_ago_minutes: 0, resolved: 0
        });
        return { affectedRows: 1 };
      }
      if (/SELECT last_hold_id FROM item_instances WHERE id = \?/i.test(sql)) {
        const row = state.itemInstances.get(params[0]);
        return row ? [{ last_hold_id: row.last_hold_id }] : [];
      }
      if (/UPDATE item_instances SET status = 'stolen'\s+WHERE status = 'hot' AND stolen_at <= NOW\(\) - INTERVAL \? MINUTE/i.test(sql)) {
        let affectedRows = 0;
        for (const row of state.itemInstances.values()) {
          if (row.status === 'hot' && row.stolen_at_ago_minutes >= params[0]) {
            row.status = 'stolen';
            affectedRows += 1;
          }
        }
        return { affectedRows };
      }
      if (/FROM session_crime_alerts sca\s+JOIN item_instances ii ON ii\.id = sca\.item_instance_id\s+WHERE sca\.resolved = 0 AND sca\.disconnected_at <= NOW\(\) - INTERVAL \? MINUTE/i.test(sql)) {
        const rows = [];
        for (const alert of state.sessionAlerts) {
          if (alert.resolved === 0 && alert.disconnected_at_ago_minutes >= params[0]) {
            const item = state.itemInstances.get(alert.item_instance_id);
            rows.push({
              alert_id: alert.id, character_id: alert.character_id, item_instance_id: alert.item_instance_id,
              base_id: item.base_id, original_owner_id: item.original_owner_id
            });
          }
        }
        return rows;
      }
      if (/UPDATE session_crime_alerts SET resolved = 1, resolved_at = NOW\(\) WHERE id = \?/i.test(sql)) {
        const alert = state.sessionAlerts.find((a) => a.id === params[0]);
        if (alert) alert.resolved = 1;
        return { affectedRows: 1 };
      }
      if (/SELECT \* FROM item_instances WHERE id = \?/i.test(sql)) {
        const row = state.itemInstances.get(params[0]);
        return row ? [row] : [];
      }
      if (/SELECT ii\.id, ii\.base_id, ii\.status, ii\.original_owner_id, c\.first_name, c\.last_name/i.test(sql)) {
        const rows = [];
        for (const row of state.itemInstances.values()) {
          if (row.current_owner_id === params[0] && (row.status === 'hot' || row.status === 'stolen')) {
            const owner = state.characters.get(row.original_owner_id) || { firstName: '???', lastName: '???' };
            rows.push({
              id: row.id, base_id: row.base_id, status: row.status, original_owner_id: row.original_owner_id,
              first_name: owner.firstName, last_name: owner.lastName
            });
          }
        }
        return rows;
      }

      const [rows] = await conn.query(sql, params);
      return rows;
    }
  };

  const moduleRegistryFake = {
    isEnabled: (id) => {
      if (id === 'depot') return options.depotEnabled !== false;
      return options.crimeEnabled !== false;
    }
  };
  const serverOptionsFake = {
    get: (key) => {
      if (key === 'crime.hotItemWindowMinutes') return options.hotWindowMinutes ?? 30;
      if (key === 'crime.combatLogGraceMinutes') return options.graceMinutes ?? 15;
      if (key === 'crime.sweepIntervalSeconds') return options.sweepIntervalSeconds ?? 60;
      throw new Error(`server-options desconhecida no harness: ${key}`);
    }
  };
  const depotFake = {
    getOrCreateDepot: async (characterId, holdId) => {
      const key = depotKey(characterId, holdId);
      let depot = state.depots.get(key);
      if (!depot) {
        depot = { id: state.nextDepotId++, capacity: 500 };
        state.depots.set(key, depot);
      }
      return depot;
    }
  };
  const commandsFake = {
    getActiveActorByCharacterId: (characterId) => (options.onlineCharacterIds || []).includes(characterId) ? 0xdead : null,
    broadcastProximityMessage: () => {}
  };
  const txFake = require('./transaction-service').tx;

  const characterStates = new Map(Object.entries(options.characterStates || {}).map(([id, v]) => [Number(id), v]));
  const characterStateFake = {
    STATES: require('./character-state').STATES,
    is: (characterId, states) => {
      const current = characterStates.get(characterId) || 'NORMAL';
      return Array.isArray(states) ? states.includes(current) : current === states;
    },
    set: (characterId, newState) => characterStates.set(characterId, newState)
  };

  return {
    state,
    characterStates,
    dependencies: {
      db, moduleRegistry: moduleRegistryFake, serverOptions: serverOptionsFake,
      tx: txFake, depot: depotFake, commands: commandsFake, characterState: characterStateFake,
      logger: options.debug ? console : { log: () => {}, error: () => {} }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// markItemStolen — atomicidade e proveniência
// ─────────────────────────────────────────────────────────────────────────────

describe('markItemStolen', () => {
  it('move 1 unidade da vitima pro ladrao e cria a instancia hot com proveniencia', async () => {
    const h = makeHarness({
      characterInventory: { [`${VICTIM}:${RING}`]: 1 },
      characterAccounts: { [VICTIM]: 9001, [THIEF]: 9002 }
    });

    const result = await crimeService.markItemStolen(
      { victimCharacterId: VICTIM, thiefCharacterId: THIEF, baseId: RING, holdId: WHITERUN },
      h.dependencies
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(h.state.characterInventory[`${VICTIM}:${RING}`], undefined, 'vitima nao pode mais ter o item');
    assert.strictEqual(h.state.characterInventory[`${THIEF}:${RING}`], 1, 'ladrao deve ter recebido o item');

    const instance = h.state.itemInstances.get(result.data.instanceId);
    assert.strictEqual(instance.status, 'hot');
    assert.strictEqual(instance.original_owner_id, VICTIM);
    assert.strictEqual(instance.current_owner_id, THIEF);
    assert.strictEqual(instance.last_hold_id, WHITERUN);
    assert.deepStrictEqual(instance.provenance_data.map((p) => p.ownerId), [VICTIM, THIEF]);
  });

  it('grava audit_logs com is_crime=1 e o account_id resolvido de cada personagem', async () => {
    const h = makeHarness({
      characterInventory: { [`${VICTIM}:${RING}`]: 1 },
      characterAccounts: { [VICTIM]: 9001, [THIEF]: 9002 }
    });

    await crimeService.markItemStolen(
      { victimCharacterId: VICTIM, thiefCharacterId: THIEF, baseId: RING, holdId: WHITERUN },
      h.dependencies
    );

    assert.strictEqual(h.state.auditLogs.length, 1);
    const log = h.state.auditLogs[0];
    assert.strictEqual(log.action, 'crime.item_theft');
    assert.strictEqual(log.isCrime, 1, 'is_crime precisa ser 1 (mutacao: is_crime=0 esconderia o roubo do log de investigacao)');
    assert.strictEqual(log.actorAccountId, 9002, 'ator e o ladrao');
    assert.strictEqual(log.targetAccountId, 9001, 'alvo e a vitima');
  });

  it('refurto atualiza a MESMA instancia e preserva original_owner_id', async () => {
    const h = makeHarness({
      characterInventory: { [`${VICTIM}:${RING}`]: 1 },
      characterAccounts: { [VICTIM]: 1, [THIEF]: 2, [OTHER_THIEF]: 3 }
    });

    const first = await crimeService.markItemStolen(
      { victimCharacterId: VICTIM, thiefCharacterId: THIEF, baseId: RING, holdId: WHITERUN },
      h.dependencies
    );

    const second = await crimeService.markItemStolen(
      { victimCharacterId: THIEF, thiefCharacterId: OTHER_THIEF, baseId: RING, holdId: WHITERUN },
      h.dependencies
    );

    assert.strictEqual(second.data.instanceId, first.data.instanceId, 'mutacao: refurto criando uma segunda linha perderia o dono original');
    const instance = h.state.itemInstances.get(first.data.instanceId);
    assert.strictEqual(instance.original_owner_id, VICTIM, 'dono original nao pode mudar num refurto');
    assert.strictEqual(instance.current_owner_id, OTHER_THIEF);
    assert.deepStrictEqual(instance.provenance_data.map((p) => p.ownerId), [VICTIM, THIEF, OTHER_THIEF]);
  });

  it('recusa self_theft sem escrever nada', async () => {
    const h = makeHarness({ characterInventory: { [`${VICTIM}:${RING}`]: 1 } });
    const result = await crimeService.markItemStolen(
      { victimCharacterId: VICTIM, thiefCharacterId: VICTIM, baseId: RING, holdId: WHITERUN },
      h.dependencies
    );
    assert.deepStrictEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'self_theft' });
    assert.strictEqual(h.state.itemInstances.size, 0);
  });

  it('recusa module_disabled', async () => {
    const h = makeHarness({ crimeEnabled: false, characterInventory: { [`${VICTIM}:${RING}`]: 1 } });
    const result = await crimeService.markItemStolen(
      { victimCharacterId: VICTIM, thiefCharacterId: THIEF, baseId: RING, holdId: WHITERUN },
      h.dependencies
    );
    assert.deepStrictEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'module_disabled' });
  });

  it('falha (ok:false) sem criar instancia quando a vitima nao tem o item de verdade', async () => {
    const h = makeHarness({ characterInventory: {} });
    const result = await crimeService.markItemStolen(
      { victimCharacterId: VICTIM, thiefCharacterId: THIEF, baseId: RING, holdId: WHITERUN },
      h.dependencies
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(h.state.itemInstances.size, 0, 'mutacao: nao pode existir instancia de um roubo que nao aconteceu');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onCharacterDisconnected — anti-combat-log, criação do alerta
// ─────────────────────────────────────────────────────────────────────────────

describe('onCharacterDisconnected', () => {
  it('cria um session_crime_alert por item hot que o personagem carregava', async () => {
    const h = makeHarness({
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot', stolen_at_ago_minutes: 1 }
      }
    });

    await crimeService.onCharacterDisconnected(0xdead, { characterId: THIEF }, h.dependencies);

    assert.strictEqual(h.state.sessionAlerts.length, 1);
    assert.strictEqual(h.state.sessionAlerts[0].character_id, THIEF);
    assert.strictEqual(h.state.sessionAlerts[0].item_instance_id, 'inst-1');
  });

  it('nao cria alerta para item ja esfriado (status stolen, nao hot)', async () => {
    const h = makeHarness({
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'stolen', stolen_at_ago_minutes: 40 }
      }
    });

    await crimeService.onCharacterDisconnected(0xdead, { characterId: THIEF }, h.dependencies);

    assert.strictEqual(h.state.sessionAlerts.length, 0, 'mutacao: alertar por item ja resfriado gastaria restituicao com um roubo antigo, nao um combat-log');
  });

  it('ignora character.id (campo errado) e so le character.characterId', async () => {
    const h = makeHarness({
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot', stolen_at_ago_minutes: 1 }
      }
    });

    // `commands.js` passa `{characterId, firstName, ...}` aos assinantes de
    // onCharacterRemoved — nunca `.id`. Um objeto com `.id` e sem
    // `.characterId` precisa ser tratado como "sem personagem", não explodir.
    await crimeService.onCharacterDisconnected(0xdead, { id: THIEF }, h.dependencies);

    assert.strictEqual(h.state.sessionAlerts.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sweep — hot -> stolen, resolução por retorno, restituição
// ─────────────────────────────────────────────────────────────────────────────

describe('sweep', () => {
  it('esfria hot -> stolen depois da janela configurada, e nao antes', async () => {
    const h = makeHarness({
      hotWindowMinutes: 30,
      itemInstances: {
        'velho': { id: 'velho', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot', stolen_at_ago_minutes: 31 },
        'novo': { id: 'novo', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot', stolen_at_ago_minutes: 5 }
      }
    });

    const result = await crimeService.sweep(h.dependencies);

    assert.strictEqual(result.cooled, 1);
    assert.strictEqual(h.state.itemInstances.get('velho').status, 'stolen');
    assert.strictEqual(h.state.itemInstances.get('novo').status, 'hot', 'mutacao: esfriar cedo demais apagaria o sinal de "roubo recente" para a revista de guarda');
  });

  it('resolve o alerta sem restituir quando o personagem ja esta online de novo', async () => {
    const h = makeHarness({
      graceMinutes: 15,
      onlineCharacterIds: [THIEF],
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot', stolen_at_ago_minutes: 1, last_hold_id: WHITERUN }
      }
    });
    h.state.sessionAlerts.push({ id: 1, character_id: THIEF, item_instance_id: 'inst-1', disconnected_at_ago_minutes: 20, resolved: 0 });

    const result = await crimeService.sweep(h.dependencies);

    assert.strictEqual(result.restituted, 0);
    assert.strictEqual(h.state.sessionAlerts[0].resolved, 1);
    assert.strictEqual(h.state.itemInstances.get('inst-1').current_owner_id, THIEF, 'jogador que voltou fica com o item — sem restituicao');
  });

  it('restitui via depot quando a graca passou e o personagem segue offline', async () => {
    const h = makeHarness({
      graceMinutes: 15,
      onlineCharacterIds: [],
      characterInventory: { [`${THIEF}:${RING}`]: 1 },
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot', stolen_at_ago_minutes: 1, last_hold_id: WHITERUN }
      }
    });
    h.state.sessionAlerts.push({ id: 1, character_id: THIEF, item_instance_id: 'inst-1', disconnected_at_ago_minutes: 20, resolved: 0 });

    const result = await crimeService.sweep(h.dependencies);

    assert.strictEqual(result.restituted, 1);
    assert.strictEqual(h.state.sessionAlerts[0].resolved, 1);
    assert.strictEqual(h.state.characterInventory[`${THIEF}:${RING}`], undefined, 'item tem que sair do ladrao offline');
    const depot = h.state.depots.get(`${VICTIM}:${WHITERUN}`);
    assert.strictEqual(h.state.depotInventory.get(`${depot.id}:${RING}`), 1, 'item tem que entrar no deposito do dono original');
    const instance = h.state.itemInstances.get('inst-1');
    assert.strictEqual(instance.current_owner_id, VICTIM);
    assert.strictEqual(instance.status, 'clean');
  });

  it('deixa o alerta pendente (nao resolvido) quando o modulo depot esta desligado', async () => {
    const h = makeHarness({
      graceMinutes: 15,
      onlineCharacterIds: [],
      depotEnabled: false,
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot', stolen_at_ago_minutes: 1, last_hold_id: WHITERUN }
      }
    });
    h.state.sessionAlerts.push({ id: 1, character_id: THIEF, item_instance_id: 'inst-1', disconnected_at_ago_minutes: 20, resolved: 0 });

    const result = await crimeService.sweep(h.dependencies);

    assert.strictEqual(result.restituted, 0);
    assert.strictEqual(result.pending, 1);
    assert.strictEqual(h.state.sessionAlerts[0].resolved, 0, 'mutacao: resolver sem depot perderia o item para sempre, sem restituicao e sem retentativa');
  });

  it('module_disabled devolve zeros sem tocar nada', async () => {
    const h = makeHarness({ crimeEnabled: false });
    const result = await crimeService.sweep(h.dependencies);
    assert.deepStrictEqual(result, { cooled: 0, restituted: 0, pending: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStolenInstancesHeldBy — proveniência para a Revista Institucional (Tarefa 13)
// ─────────────────────────────────────────────────────────────────────────────

describe('getStolenInstancesHeldBy', () => {
  it('resolve original_owner_id para o NOME do personagem, nunca o id cru', async () => {
    const h = makeHarness({
      characters: { [VICTIM]: { firstName: 'Balgruuf', lastName: 'Pedra-Cinzenta' } },
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot' }
      }
    });

    const found = await crimeService.getStolenInstancesHeldBy(THIEF, h.dependencies);

    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].originalOwnerName, 'Balgruuf Pedra-Cinzenta');
    assert.strictEqual(found[0].status, 'hot');
  });

  it('ignora itens clean — proveniencia limpa nao aparece na revista', async () => {
    const h = makeHarness({
      characters: { [VICTIM]: { firstName: 'Balgruuf', lastName: 'Pedra-Cinzenta' } },
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'clean' }
      }
    });

    const found = await crimeService.getStolenInstancesHeldBy(THIEF, h.dependencies);

    assert.deepStrictEqual(found, [], 'mutacao: mostrar item clean na revista acusaria quem ja nao carrega proveniencia suja');
  });

  it('devolve lista vazia pra quem nao carrega nada suspeito', async () => {
    const h = makeHarness();
    const found = await crimeService.getStolenInstancesHeldBy(THIEF, h.dependencies);
    assert.deepStrictEqual(found, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markItemConfiscated — Lógica de Evidência (Tarefa 13, §4)
// ─────────────────────────────────────────────────────────────────────────────

describe('markItemConfiscated', () => {
  it('rebaixa hot -> stolen (perde a marca de "roubo recente", mas continua sujo)', async () => {
    const h = makeHarness({
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'hot' }
      }
    });

    const result = await crimeService.markItemConfiscated({ characterId: THIEF, baseId: RING }, h.dependencies);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(h.state.itemInstances.get('inst-1').status, 'stolen', 'mutacao: confisco nao pode voltar clean nem deixar hot');
  });

  it('idempotente: confiscar um item ja stolen continua stolen', async () => {
    const h = makeHarness({
      itemInstances: {
        'inst-1': { id: 'inst-1', base_id: RING, original_owner_id: VICTIM, current_owner_id: THIEF, status: 'stolen' }
      }
    });

    const result = await crimeService.markItemConfiscated({ characterId: THIEF, baseId: RING }, h.dependencies);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(h.state.itemInstances.get('inst-1').status, 'stolen');
  });

  it('no_instance quando o item confiscado nunca foi roubado — nao e erro', async () => {
    const h = makeHarness();
    const result = await crimeService.markItemConfiscated({ characterId: THIEF, baseId: RING }, h.dependencies);
    assert.deepStrictEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'no_instance' });
  });

  it('module_disabled quando o modulo crime esta desligado', async () => {
    const h = makeHarness({ crimeEnabled: false });
    const result = await crimeService.markItemConfiscated({ characterId: THIEF, baseId: RING }, h.dependencies);
    assert.deepStrictEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'module_disabled' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// crime.surrender / crime.rob — Interaction Framework (Tarefa 13, §1)
// ─────────────────────────────────────────────────────────────────────────────

describe('_isRobbable', () => {
  it('rendido, algemado e abatido sao roubaveis; NORMAL nao e', async () => {
    const h = makeHarness({
      characterStates: { [VICTIM]: 'SURRENDERED', [OTHER_THIEF]: 'RESTRAINED', [THIEF]: 'NORMAL' }
    });
    assert.strictEqual(crimeService._isRobbable(VICTIM, h.dependencies), true);
    assert.strictEqual(crimeService._isRobbable(OTHER_THIEF, h.dependencies), true);
    assert.strictEqual(crimeService._isRobbable(THIEF, h.dependencies), false, 'mutacao: roubar alvo NORMAL e RDM, nao deveria passar');
  });
});

describe('registerInteractions', () => {
  const interactionRegistry = require('./interaction-registry');
  beforeEach(() => interactionRegistry._reset());

  it('registra crime.surrender (SELF) e crime.rob (PLAYER) com o alcance certo', () => {
    crimeService.registerInteractions();

    const surrender = interactionRegistry.get('crime.surrender');
    assert.ok(surrender, 'crime.surrender deveria estar registrado');
    assert.strictEqual(surrender.target, interactionRegistry.TARGET_TYPES.SELF);

    const rob = interactionRegistry.get('crime.rob');
    assert.ok(rob, 'crime.rob deveria estar registrado');
    assert.strictEqual(rob.target, interactionRegistry.TARGET_TYPES.PLAYER);
    assert.strictEqual(rob.distance, crimeService.ROB_RANGE);
  });

  it('crime.rob so aparece/executa contra alvo rendido ou incapacitado', async () => {
    const h = makeHarness({ characterStates: { [VICTIM]: 'NORMAL' } });
    crimeService.registerInteractions(h.dependencies);
    const rob = interactionRegistry.get('crime.rob');

    const ctx = { target: { characterId: VICTIM } };
    const canSee = await rob.canSee(ctx);
    assert.strictEqual(Boolean(canSee), false, 'alvo NORMAL nao pode nem aparecer no menu de roubo');

    h.characterStates.set(VICTIM, 'SURRENDERED');
    const canSeeAgora = await rob.canSee(ctx);
    assert.strictEqual(Boolean(canSeeAgora), true, 'alvo rendido deveria liberar a acao no menu');
  });

  it('crime.rob.execute chama markItemStolen e lanca se o alvo deixou de ser roubavel entre canSee e execute', async () => {
    const h = makeHarness({
      characterStates: { [VICTIM]: 'NORMAL' },
      characterInventory: { [`${VICTIM}:${RING}`]: 1 }
    });
    crimeService.registerInteractions(h.dependencies);
    const rob = interactionRegistry.get('crime.rob');

    const ctx = {
      actorId: 0xdead1, characterId: THIEF,
      target: { actorId: 0xdead2, characterId: VICTIM },
      data: { baseId: RING, holdId: WHITERUN }
    };

    await assert.rejects(() => rob.execute(ctx), /rendido nem incapacitado/);
    assert.strictEqual(h.state.characterInventory[`${VICTIM}:${RING}`], 1, 'nada deveria ter sido movido');
  });
});

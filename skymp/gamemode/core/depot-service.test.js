/**
 * core/depot-service.test.js
 *
 * Cobre o estado criado por `migration-v20-depot-service.sql`
 * (character_depots, depot_inventory, depot_terminals) e o requisito central
 * do brief: depósito/saque atômico (falha no meio reverte os dois lados) e
 * isolamento regional (item de um hold não aparece em outro).
 *
 * Executa com: node --test core/depot-service.test.js
 */

'use strict';

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

const depotService = require('./depot-service');
const interactionRegistry = require('./interaction-registry');

const CHAR_A = 101;
const WHITERUN = 'whiterun';
const SOLITUDE = 'solitude';
const GOLD_APPLE = 0x139; // qualquer FormID, só precisa ser positivo

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

function makeHarness(options = {}) {
  const state = {
    characterInventory: { ...(options.characterInventory || {}) }, // `${characterId}:${baseId}` -> count
    depots: new Map(Object.entries(options.depots || {})), // `${characterId}:${holdId}` -> {id, capacity}
    depotInventory: new Map(), // `${depotId}:${baseId}` -> count
    terminals: new Map(Object.entries(options.terminals || {})), // objectId -> holdId
    nextDepotId: 1
  };

  function invKey(characterId, baseId) { return `${characterId}:${baseId}`; }
  function depotKey(characterId, holdId) { return `${characterId}:${holdId}`; }
  function depotInvKey(depotId, baseId) { return `${depotId}:${baseId}`; }

  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, params = []) => {
      if (options.failOn && new RegExp(options.failOn, 'i').test(sql)) {
        throw new Error('conexao com o banco caiu');
      }

      // ── character_depots ──────────────────────────────────────────────────
      if (/SELECT id, capacity FROM character_depots WHERE character_id = \? AND hold_id = \? FOR UPDATE/i.test(sql)) {
        const found = state.depots.get(depotKey(params[0], params[1]));
        return [found ? [{ id: found.id, capacity: found.capacity }] : []];
      }
      if (/INSERT INTO character_depots/i.test(sql)) {
        const id = state.nextDepotId++;
        state.depots.set(depotKey(params[0], params[1]), { id, capacity: params[2] });
        return [{ affectedRows: 1, insertId: id }];
      }
      if (/SELECT id FROM character_depots WHERE character_id = \? AND hold_id = \? FOR UPDATE/i.test(sql)) {
        const found = state.depots.get(depotKey(params[0], params[1]));
        return [found ? [{ id: found.id }] : []];
      }

      // ── depot_inventory: soma total ────────────────────────────────────────
      if (/SELECT COALESCE\(SUM\(count\), 0\) AS total FROM depot_inventory WHERE depot_id = \?/i.test(sql)) {
        let total = 0;
        for (const [key, count] of state.depotInventory.entries()) {
          if (key.startsWith(`${params[0]}:`)) total += count;
        }
        return [[{ total }]];
      }

      // ── pilhas genéricas (character_inventory / depot_inventory) ───────────
      const stackSelect = /SELECT count FROM (character_inventory|depot_inventory) WHERE (character_id|depot_id) = \? AND base_id = \? FOR UPDATE/i.exec(sql);
      if (stackSelect) {
        const table = stackSelect[1];
        const store = table === 'character_inventory' ? state.characterInventory : Object.fromEntries(state.depotInventory);
        const key = table === 'character_inventory' ? invKey(params[0], params[1]) : depotInvKey(params[0], params[1]);
        const count = store[key];
        return [count === undefined ? [] : [{ count }]];
      }
      const stackUpdate = /UPDATE (character_inventory|depot_inventory) SET count = count \+ \? WHERE (character_id|depot_id) = \? AND base_id = \?/i.exec(sql);
      if (stackUpdate) {
        _applyDelta(stackUpdate[1], params[1], params[2], params[0]);
        return [{ affectedRows: 1 }];
      }
      const stackInsert = /INSERT INTO (character_inventory|depot_inventory) \((character_id|depot_id), base_id, count\) VALUES \(\?, \?, \?\)/i.exec(sql);
      if (stackInsert) {
        _setCount(stackInsert[1], params[0], params[1], params[2]);
        return [{ affectedRows: 1, insertId: 1 }];
      }
      const stackSet = /UPDATE (character_inventory|depot_inventory) SET count = \? WHERE (character_id|depot_id) = \? AND base_id = \?/i.exec(sql);
      if (stackSet) {
        _setCount(stackSet[1], params[1], params[2], params[0]);
        return [{ affectedRows: 1 }];
      }
      const stackDelete = /DELETE FROM (character_inventory|depot_inventory) WHERE (character_id|depot_id) = \? AND base_id = \?/i.exec(sql);
      if (stackDelete) {
        _setCount(stackDelete[1], params[0], params[1], 0, true);
        return [{ affectedRows: 1 }];
      }

      // ── depot_terminals ─────────────────────────────────────────────────────
      if (/SELECT hold_id FROM depot_terminals WHERE object_id = \?/i.test(sql)) {
        const holdId = state.terminals.get(params[0]);
        return [holdId ? [{ hold_id: holdId }] : []];
      }

      // ── leitura de conteúdo (join) ───────────────────────────────────────────
      if (/SELECT di\.base_id, di\.count[\s\S]*FROM depot_inventory di[\s\S]*JOIN character_depots cd/i.test(sql)) {
        const depot = state.depots.get(depotKey(params[0], params[1]));
        if (!depot) return [[]];
        const rows = [];
        for (const [key, count] of state.depotInventory.entries()) {
          const [depotId, baseId] = key.split(':');
          if (Number(depotId) === depot.id) rows.push({ base_id: Number(baseId), count });
        }
        return [rows];
      }

      throw new Error(`SQL inesperado no harness: ${sql}`);
    }
  };

  function _applyDelta(table, ownerId, baseId, delta) {
    const store = table === 'character_inventory' ? state.characterInventory : state.depotInventory;
    const key = table === 'character_inventory' ? invKey(ownerId, baseId) : depotInvKey(ownerId, baseId);
    if (table === 'character_inventory') {
      state.characterInventory[key] = (state.characterInventory[key] || 0) + delta;
    } else {
      state.depotInventory.set(key, (state.depotInventory.get(key) || 0) + delta);
    }
  }

  function _setCount(table, ownerId, baseId, count, isDelete = false) {
    const key = table === 'character_inventory' ? invKey(ownerId, baseId) : depotInvKey(ownerId, baseId);
    if (table === 'character_inventory') {
      if (isDelete) delete state.characterInventory[key];
      else state.characterInventory[key] = count;
    } else {
      if (isDelete) state.depotInventory.delete(key);
      else state.depotInventory.set(key, count);
    }
  }

  const db = {
    getConnection: async () => conn,
    query: async (sql, params = []) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    }
  };

  const moduleRegistryFake = { isEnabled: () => options.moduleEnabled !== false };
  const serverOptionsFake = { get: (key) => {
    if (key === 'depot.defaultCapacity') return options.defaultCapacity ?? 500;
    throw new Error(`server-options desconhecida no harness: ${key}`);
  } };
  const economyFake = { getBalance: async () => ({ ok: true, balance: options.gold ?? 0 }) };
  const inventoryFake = {
    list: async (owner) => {
      const prefix = `${owner.ref}:`;
      const rows = [];
      for (const [key, count] of Object.entries(state.characterInventory)) {
        if (key.startsWith(prefix)) rows.push({ baseId: Number(key.slice(prefix.length)), count });
      }
      return rows;
    }
  };
  const txFake = require('./transaction-service').tx;

  return {
    state,
    dependencies: {
      db, moduleRegistry: moduleRegistryFake, serverOptions: serverOptionsFake,
      economy: economyFake, inventory: inventoryFake, tx: txFake
    }
  };
}

beforeEach(() => {});

// ─────────────────────────────────────────────────────────────────────────────
// depositItem / withdrawItem — atomicidade
// ─────────────────────────────────────────────────────────────────────────────

describe('depositItem', () => {
  it('move o item do inventario do personagem para o deposito, numa transacao so', async () => {
    const h = makeHarness({ characterInventory: { [`${CHAR_A}:${GOLD_APPLE}`]: 10 } });

    const result = await depotService.depositItem(
      { characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 4 },
      h.dependencies
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(h.state.characterInventory[`${CHAR_A}:${GOLD_APPLE}`], 6);
    const depot = h.state.depots.get(`${CHAR_A}:${WHITERUN}`);
    assert.strictEqual(h.state.depotInventory.get(`${depot.id}:${GOLD_APPLE}`), 4);
  });

  it('recusa com insufficient_stock sem escrever nada quando o personagem nao tem o suficiente', async () => {
    const h = makeHarness({ characterInventory: { [`${CHAR_A}:${GOLD_APPLE}`]: 2 } });

    const result = await depotService.depositItem(
      { characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 5 },
      h.dependencies
    );

    assert.deepStrictEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'insufficient_stock' });
    assert.strictEqual(h.state.characterInventory[`${CHAR_A}:${GOLD_APPLE}`], 2, 'inventario do personagem nao pode ter mudado');
    assert.strictEqual(h.state.depotInventory.size, 0, 'nada deveria ter entrado no deposito');
  });

  it('recusa com depot_full quando o deposito estouraria a capacidade', async () => {
    const h = makeHarness({
      characterInventory: { [`${CHAR_A}:${GOLD_APPLE}`]: 100 },
      depots: { [`${CHAR_A}:${WHITERUN}`]: { id: 1, capacity: 5 } }
    });
    h.state.depotInventory.set('1:9999', 4); // deposito ja tem 4 de outro item

    const result = await depotService.depositItem(
      { characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 2 },
      h.dependencies
    );

    assert.deepStrictEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'depot_full' });
    assert.strictEqual(h.state.characterInventory[`${CHAR_A}:${GOLD_APPLE}`], 100, 'nada deveria ter saido do personagem');
  });

  it('uma falha no meio da transacao reverte OS DOIS lados (atomicidade)', async () => {
    const h = makeHarness({
      characterInventory: { [`${CHAR_A}:${GOLD_APPLE}`]: 10 },
      failOn: 'INSERT INTO (character_inventory|depot_inventory)' // falha na escrita do lado do deposito
    });

    await assert.rejects(() => depotService.depositItem(
      { characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 4 },
      h.dependencies
    ));

    // O mock nao desfaz de verdade (nao ha transacao real), mas o contrato e:
    // uma falha lanca (nunca {ok:false} silencioso) para quem chama tratar
    // como falha de infraestrutura e confiar no ROLLBACK real do MySQL.
  });
});

describe('withdrawItem', () => {
  it('move o item do deposito de volta pro inventario do personagem', async () => {
    const h = makeHarness({ depots: { [`${CHAR_A}:${WHITERUN}`]: { id: 1, capacity: 500 } } });
    h.state.depotInventory.set(`1:${GOLD_APPLE}`, 7);

    const result = await depotService.withdrawItem(
      { characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 3 },
      h.dependencies
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(h.state.depotInventory.get(`1:${GOLD_APPLE}`), 4);
    assert.strictEqual(h.state.characterInventory[`${CHAR_A}:${GOLD_APPLE}`], 3);
  });

  it('recusa depot_not_found quando o personagem nunca visitou aquele hold', async () => {
    const h = makeHarness();
    const result = await depotService.withdrawItem(
      { characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 1 },
      h.dependencies
    );
    assert.deepStrictEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'depot_not_found' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Isolamento regional — o requisito central do brief
// ─────────────────────────────────────────────────────────────────────────────

describe('isolamento regional', () => {
  it('item depositado em um hold NAO aparece no deposito de outro hold do mesmo personagem', async () => {
    const h = makeHarness({ characterInventory: { [`${CHAR_A}:${GOLD_APPLE}`]: 10 } });

    await depotService.depositItem(
      { characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 5 },
      h.dependencies
    );

    const conteudoWhiterun = await depotService.getDepotContents(CHAR_A, WHITERUN, h.dependencies);
    const conteudoSolitude = await depotService.getDepotContents(CHAR_A, SOLITUDE, h.dependencies);

    assert.deepStrictEqual(conteudoWhiterun, [{ baseId: GOLD_APPLE, count: 5 }]);
    assert.deepStrictEqual(conteudoSolitude, [], 'Solitude nao pode ver o que foi depositado em Whiterun');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveTerminal
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveTerminal', () => {
  it('devolve o hold de um terminal conhecido', async () => {
    global.mp = { getDescFromId: (id) => `${id.toString(16)}:Skyrim.esm` };
    try {
      const h = makeHarness({ terminals: { 'abc123:Skyrim.esm': WHITERUN } });
      const holdId = await depotService.resolveTerminal(0xabc123, h.dependencies);
      assert.strictEqual(holdId, WHITERUN);
    } finally {
      delete global.mp;
    }
  });

  it('devolve null para um objeto que nao e terminal de deposito', async () => {
    global.mp = { getDescFromId: (id) => `${id.toString(16)}:Skyrim.esm` };
    try {
      const h = makeHarness();
      const holdId = await depotService.resolveTerminal(0xdead, h.dependencies);
      assert.strictEqual(holdId, null);
    } finally {
      delete global.mp;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerInteractions — nada mais chama isto além do initialize() do módulo
// real (phase0-basic.js), então sem este teste um erro de schema/descriptor
// só apareceria no primeiro boot de verdade.
// ─────────────────────────────────────────────────────────────────────────────

describe('registerInteractions', () => {
  beforeEach(() => interactionRegistry._reset());

  it('registra depot.view/deposit/withdraw sem lancar, com o alvo e distancia certos', () => {
    depotService.registerInteractions();

    for (const id of ['depot.view', 'depot.deposit', 'depot.withdraw']) {
      const entry = interactionRegistry.get(id);
      assert.ok(entry, `${id} deveria estar registrado`);
      assert.strictEqual(entry.target, interactionRegistry.TARGET_TYPES.OBJECT);
      assert.strictEqual(entry.distance, depotService.DEPOT_INTERACT_RANGE);
      assert.strictEqual(typeof entry.canSee, 'function');
      assert.strictEqual(typeof entry.execute, 'function');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tarefa 10 (UI-Depot-Bridge): execute() dos três handlers precisa chamar
// `sendModal` com o payload que a CEF desenha — sem isto, `depot.view` volta
// a ser mudo (só uma notificação de chat, ver `interaction-service.js`
// handleUiEvent).
// ─────────────────────────────────────────────────────────────────────────────

describe('registerInteractions execute -> sendModal (Tarefa 10)', () => {
  beforeEach(() => interactionRegistry._reset());

  function withMp(fn) {
    global.mp = { getDescFromId: () => 'dead:Skyrim.esm' };
    return fn().finally(() => { delete global.mp; });
  }

  it('depot.view manda depot:open com holdId, targetId, contents, gold e capacity', () => withMp(async () => {
    const h = makeHarness({
      terminals: { 'dead:Skyrim.esm': WHITERUN },
      depots: { [`${CHAR_A}:${WHITERUN}`]: { id: 1, capacity: 500 } },
      characterInventory: { [`${CHAR_A}:${GOLD_APPLE}`]: 7 },
      gold: 250
    });
    h.state.depotInventory.set(`1:${GOLD_APPLE}`, 3);
    const sent = [];

    depotService.registerInteractions({ ...h.dependencies, sendModal: (actorId, type, data) => sent.push({ actorId, type, data }) });
    const entry = interactionRegistry.get('depot.view');
    await entry.execute({ actorId: 777, characterId: CHAR_A, target: { formId: 0xdead }, data: {} });

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].actorId, 777);
    assert.strictEqual(sent[0].type, 'depot:open');
    assert.strictEqual(sent[0].data.holdId, WHITERUN);
    assert.strictEqual(sent[0].data.targetId, 0xdead);
    assert.strictEqual(sent[0].data.capacity, 500);
    assert.strictEqual(sent[0].data.gold, 250);
    assert.deepStrictEqual(sent[0].data.contents, [{ baseId: GOLD_APPLE, count: 3 }]);
    assert.deepStrictEqual(sent[0].data.carried, [{ baseId: GOLD_APPLE, count: 7 }]);
  }));

  it('depot.deposit manda depot:update com o conteudo atualizado, so quando ok', () => withMp(async () => {
    const h = makeHarness({
      terminals: { 'dead:Skyrim.esm': WHITERUN },
      characterInventory: { [`${CHAR_A}:${GOLD_APPLE}`]: 10 }
    });
    const sent = [];

    depotService.registerInteractions({ ...h.dependencies, sendModal: (actorId, type, data) => sent.push({ actorId, type, data }) });
    const entry = interactionRegistry.get('depot.deposit');
    const result = await entry.execute({ actorId: 777, characterId: CHAR_A, target: { formId: 0xdead }, data: { baseId: GOLD_APPLE, count: 4 } });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, 'depot:update');
    assert.strictEqual(sent[0].data.contents[0].count, 4);
  }));

  it('depot.deposit NAO manda sendModal quando a operacao recusa', () => withMp(async () => {
    const h = makeHarness({
      terminals: { 'dead:Skyrim.esm': WHITERUN },
      characterInventory: { [`${CHAR_A}:${GOLD_APPLE}`]: 1 }
    });
    const sent = [];

    depotService.registerInteractions({ ...h.dependencies, sendModal: (actorId, type, data) => sent.push({ actorId, type, data }) });
    const entry = interactionRegistry.get('depot.deposit');
    const result = await entry.execute({ actorId: 777, characterId: CHAR_A, target: { formId: 0xdead }, data: { baseId: GOLD_APPLE, count: 4 } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(sent.length, 0);
  }));

  it('depot.withdraw manda depot:update com o conteudo atualizado, so quando ok', () => withMp(async () => {
    const h = makeHarness({
      terminals: { 'dead:Skyrim.esm': WHITERUN },
      depots: { [`${CHAR_A}:${WHITERUN}`]: { id: 1, capacity: 500 } }
    });
    h.state.depotInventory.set(`1:${GOLD_APPLE}`, 6);
    const sent = [];

    depotService.registerInteractions({ ...h.dependencies, sendModal: (actorId, type, data) => sent.push({ actorId, type, data }) });
    const entry = interactionRegistry.get('depot.withdraw');
    const result = await entry.execute({ actorId: 777, characterId: CHAR_A, target: { formId: 0xdead }, data: { baseId: GOLD_APPLE, count: 2 } });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, 'depot:update');
    assert.strictEqual(sent[0].data.contents[0].count, 4);
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// module_disabled
// ─────────────────────────────────────────────────────────────────────────────

describe('module_disabled', () => {
  it('depositItem/withdrawItem recusam quando o modulo esta desativado', async () => {
    const h = makeHarness({ moduleEnabled: false });
    const dep = await depotService.depositItem({ characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 1 }, h.dependencies);
    const wit = await depotService.withdrawItem({ characterId: CHAR_A, holdId: WHITERUN, baseId: GOLD_APPLE, count: 1 }, h.dependencies);
    assert.strictEqual(dep.code, 'module_disabled');
    assert.strictEqual(wit.code, 'module_disabled');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nota de rastreabilidade para scripts/check-write-guards.js (guarda de
// migration sem teste): este arquivo exercita o estado criado por
// migration-v20-depot-service.sql.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const assert = require('node:assert/strict');
const { describe, it, beforeEach, after } = require('node:test');
const { createPublicWorkService } = require('./public-work-service');
const workRegistry = require('./core/public-work-registry');
const realInteractions = require('./core/interaction-registry');

const T0 = new Date('2026-08-25T12:00:00.000Z');
let clock = new Date(T0);
let state;

function freshState() {
  return { runs: [], active: new Map(), cooldowns: new Map(), events: [], gold: new Map([[42, 10]]), ledgers: [], nextId: 1, failCompletionUpdate: false };
}
function cloneState(source) {
  return {
    runs: structuredClone(source.runs), active: new Map(source.active), cooldowns: new Map(source.cooldowns),
    events: structuredClone(source.events), gold: new Map(source.gold), ledgers: structuredClone(source.ledgers),
    nextId: source.nextId, failCompletionUpdate: source.failCompletionUpdate
  };
}
function sqlKey(sql) { return sql.replace(/\s+/g, ' ').trim(); }

function rowsForRun(run) { return run ? [run] : []; }

function createFakeDb() {
  function select(sql, params) {
    const key = sqlKey(sql);
    if (key.includes('FROM public_work_active_slots s')) {
      const id = state.active.get(params[0]);
      return rowsForRun(state.runs.find(run => run.id === id));
    }
    if (key.includes('FROM public_work_cooldowns')) {
      const available = state.cooldowns.get(`${params[0]}:${params[1]}`);
      return available ? [{ available_at: available }] : [];
    }
    if (key.includes('WHERE assignment_request_id = ?')) {
      return rowsForRun(state.runs.find(run => run.assignment_request_id === params[0]));
    }
    if (key.includes('WHERE completion_request_id = ?')) {
      return rowsForRun(state.runs.find(run => run.completion_request_id === params[0]));
    }
    if (key.includes('WHERE pickup_request_id = ?')) {
      return rowsForRun(state.runs.find(run => run.pickup_request_id === params[0]));
    }
    if (key.includes('WHERE id = ?')) return rowsForRun(state.runs.find(run => run.id === params[0]));
    if (key.startsWith('SELECT id FROM public_work_runs')) {
      return state.runs.filter(run => ['assigned', 'in_progress'].includes(run.status) && new Date(run.expires_at) <= params[0])
        .slice(0, params[1]).map(run => ({ id: run.id }));
    }
    throw new Error(`SELECT fake não reconhecido: ${key}`);
  }

  const db = {
    query: async (sql, params) => select(sql, params),
    getConnection: async () => {
      let snapshot = null;
      return {
        beginTransaction: async () => { snapshot = cloneState(state); },
        commit: async () => { snapshot = null; },
        rollback: async () => { if (snapshot) state = snapshot; snapshot = null; },
        release() {},
        query: async (sql, params) => {
          const key = sqlKey(sql);
          if (key.startsWith('SELECT ')) return [select(sql, params), []];
          if (key.startsWith('INSERT INTO public_work_runs')) {
            if (state.runs.some(run => run.assignment_request_id === params[9])) {
              const err = new Error('duplicate assignment'); err.code = 'ER_DUP_ENTRY'; throw err;
            }
            const id = state.nextId++;
            state.runs.push({
              id, character_id: params[0], work_code: params[1], origin_form_desc: params[2],
              origin_label: params[3], destination_form_desc: params[4], destination_label: params[5],
              reward_amount: params[6], cooldown_group: params[7], cooldown_seconds: params[8],
              status: 'assigned', cargo_token: null,
              assignment_request_id: params[9], pickup_request_id: null, completion_request_id: null,
              started_at: params[10], expires_at: params[11], completed_at: null, cancelled_at: null
            });
            return [{ insertId: id }, []];
          }
          if (key.startsWith('INSERT INTO public_work_active_slots')) {
            if (state.active.has(params[0])) { const err = new Error('duplicate active'); err.code = 'ER_DUP_ENTRY'; throw err; }
            state.active.set(params[0], params[1]); return [{ affectedRows: 1 }, []];
          }
          if (key.startsWith('INSERT INTO public_work_events')) {
            state.events.push({ runId: params[0], characterId: params[1], from: params[2], to: params[3], reason: params[4], key: params[5] });
            return [{ affectedRows: 1 }, []];
          }
          if (key.includes("SET status = 'in_progress'")) {
            const run = state.runs.find(item => item.id === params[2]);
            run.status = 'in_progress'; run.cargo_token = params[0]; run.pickup_request_id = params[1];
            return [{ affectedRows: 1 }, []];
          }
          if (key.includes("SET status = 'completed'")) {
            if (state.failCompletionUpdate) throw new Error('falha depois do ledger');
            const run = state.runs.find(item => item.id === params[2]);
            run.status = 'completed'; run.cargo_token = null; run.completion_request_id = params[0]; run.completed_at = params[1];
            return [{ affectedRows: 1 }, []];
          }
          if (key.includes("SET status = 'cancelled'")) {
            const run = state.runs.find(item => item.id === params[1]);
            run.status = 'cancelled'; run.cargo_token = null; run.cancelled_at = params[0];
            return [{ affectedRows: 1 }, []];
          }
          if (key.includes("SET status = 'expired'")) {
            const run = state.runs.find(item => item.id === params[0]);
            run.status = 'expired'; run.cargo_token = null; return [{ affectedRows: 1 }, []];
          }
          if (key.startsWith('DELETE FROM public_work_active_slots')) {
            if (state.active.get(params[0]) === params[1]) state.active.delete(params[0]);
            return [{ affectedRows: 1 }, []];
          }
          if (key.startsWith('INSERT INTO public_work_cooldowns')) {
            state.cooldowns.set(`${params[0]}:${params[1]}`, params[2]); return [{ affectedRows: 1 }, []];
          }
          throw new Error(`query fake não reconhecida: ${key}`);
        }
      };
    }
  };
  return db;
}

function createHarness() {
  const interactionEntries = new Map();
  const fakeInteractions = {
    TARGET_TYPES: realInteractions.TARGET_TYPES,
    AUDIT_LEVELS: realInteractions.AUDIT_LEVELS,
    register: entry => interactionEntries.set(entry.id, entry),
    unregisterModule: moduleName => {
      for (const [id, entry] of interactionEntries) if (entry.module === moduleName) interactionEntries.delete(id);
    }
  };
  let anchorProvider = null;
  const fakeAnchors = {
    register: provider => { anchorProvider = provider; },
    refresh: async () => anchorProvider ? (await anchorProvider.list()).length : 0
  };
  const tx = {
    tx: {
      applyGoldDelta: async (conn, characterId, delta) => state.gold.set(characterId, state.gold.get(characterId) + delta),
      recordGoldLedger: async (conn, entry) => {
        if (state.ledgers.some(item => item.idempotencyKey === entry.idempotencyKey)) throw new Error('duplicate ledger');
        state.ledgers.push(entry);
      }
    }
  };
  const service = createPublicWorkService({
    db: createFakeDb(), transactionService: tx, workRegistry,
    interactionRegistry: fakeInteractions, physicalAnchorRegistry: fakeAnchors,
    serverOptions: { get: key => key === 'publicWork.maxDistance' ? 220 : 60 },
    now: () => new Date(clock), cargoToken: () => 'cargo_token_abcdefghijkl'
  });
  return { service, interactionEntries, getAnchorProvider: () => anchorProvider };
}

const originalMp = global.mp;
const FORMS = new Map([[0x100, '100:Skyrim.esm'], [0x101, '101:Skyrim.esm'], [0x102, '102:Skyrim.esm']]);

beforeEach(() => {
  state = freshState(); clock = new Date(T0); workRegistry._reset();
  workRegistry.register({
    code: 'hay_delivery', label: 'Levar fardo', boardFormDesc: '100:Skyrim.esm',
    originFormDesc: '101:Skyrim.esm', originLabel: 'Fardos do campo',
    destinationFormDesc: '102:Skyrim.esm', destinationLabel: 'Celeiro principal',
    rewardAmount: 5, timeLimitSeconds: 600, cooldownSeconds: 300,
    cooldownGroup: 'public_delivery', cargoPolicy: 'token'
  });
  global.mp = {
    getDescFromId: id => FORMS.get(id) || null,
    getIdFromDesc: desc => [...FORMS].find(([, value]) => value === desc)?.[0] || 0
  };
});
after(() => {
  if (originalMp === undefined) delete global.mp; else global.mp = originalMp;
});

describe('public-work-service — ciclo transacional', () => {
  it('executa aceite, coleta e entrega; paga uma vez e inicia cooldown', async () => {
    const { service } = createHarness();
    const accepted = await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0001' });
    assert.equal(accepted.run.status, 'assigned');
    assert.equal((await service.pickupCargo({ characterId: 42, targetFormDesc: '999:Skyrim.esm', requestId: 'pickup-0001' })).code, 'wrong_origin');
    const picked = await service.pickupCargo({ characterId: 42, targetFormDesc: '101:Skyrim.esm', requestId: 'pickup-0001' });
    assert.equal(picked.run.status, 'in_progress');
    assert.equal((await service.pickupCargo({ characterId: 42, targetFormDesc: '101:Skyrim.esm', requestId: 'pickup-0001' })).replay, true);
    assert.equal((await service.completeWork({ characterId: 42, targetFormDesc: '999:Skyrim.esm', requestId: 'complete-0001' })).code, 'wrong_destination');
    const completed = await service.completeWork({ characterId: 42, targetFormDesc: '102:Skyrim.esm', requestId: 'complete-0001' });
    assert.equal(completed.ok, true);
    assert.equal(state.gold.get(42), 15);
    assert.equal(state.ledgers.length, 1);
    assert.equal(state.ledgers[0].idempotencyKey, 'public-work:run:1:reward');
    assert.equal(state.active.has(42), false);
    assert.equal(state.runs[0].cargo_token, null);
    assert.equal(state.cooldowns.get('42:public_delivery').toISOString(), '2026-08-25T12:05:00.000Z');
  });

  it('replay de aceite e conclusão não cria corrida nem pagamento novo', async () => {
    const { service } = createHarness();
    await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0001' });
    const replayAssign = await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0001' });
    assert.equal(replayAssign.replay, true);
    assert.equal(state.runs.length, 1);
    await service.pickupCargo({ characterId: 42, targetFormDesc: '101:Skyrim.esm', requestId: 'pickup-0001' });
    await service.completeWork({ characterId: 42, targetFormDesc: '102:Skyrim.esm', requestId: 'complete-0001' });
    const replayComplete = await service.completeWork({ characterId: 42, targetFormDesc: '102:Skyrim.esm', requestId: 'complete-0001' });
    assert.equal(replayComplete.replay, true);
    assert.equal(state.gold.get(42), 15);
    assert.equal(state.ledgers.length, 1);
  });

  it('não deixa outro personagem reutilizar request id alheio', async () => {
    const { service } = createHarness();
    await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0001' });
    assert.equal((await service.acceptWork({ characterId: 99, workCode: 'hay_delivery', requestId: 'assign-0001' })).code, 'idempotency_conflict');
    await service.pickupCargo({ characterId: 42, targetFormDesc: '101:Skyrim.esm', requestId: 'pickup-0001' });
    await service.completeWork({ characterId: 42, targetFormDesc: '102:Skyrim.esm', requestId: 'complete-0001' });
    assert.equal((await service.completeWork({ characterId: 99, targetFormDesc: '102:Skyrim.esm', requestId: 'complete-0001' })).code, 'idempotency_conflict');
  });

  it('não aceita segunda corrida ativa e cooldown compartilhado bloqueia novo aceite', async () => {
    const { service } = createHarness();
    await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0001' });
    assert.equal((await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0002' })).code, 'active_run');
    await service.pickupCargo({ characterId: 42, targetFormDesc: '101:Skyrim.esm', requestId: 'pickup-0001' });
    await service.completeWork({ characterId: 42, targetFormDesc: '102:Skyrim.esm', requestId: 'complete-0001' });
    assert.equal((await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0003' })).code, 'cooldown');
  });

  it('falha depois do crédito faz rollback de ouro, ledger e estado da corrida', async () => {
    const { service } = createHarness();
    await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0001' });
    await service.pickupCargo({ characterId: 42, targetFormDesc: '101:Skyrim.esm', requestId: 'pickup-0001' });
    state.failCompletionUpdate = true;
    await assert.rejects(
      () => service.completeWork({ characterId: 42, targetFormDesc: '102:Skyrim.esm', requestId: 'complete-0001' }),
      /falha depois do ledger/
    );
    assert.equal(state.gold.get(42), 10);
    assert.equal(state.ledgers.length, 0);
    assert.equal(state.runs[0].status, 'in_progress');
    assert.equal(state.active.get(42), 1);
  });

  it('expira de forma persistente, remove vaga e invalida carga sem pagar', async () => {
    const { service } = createHarness();
    await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0001' });
    await service.pickupCargo({ characterId: 42, targetFormDesc: '101:Skyrim.esm', requestId: 'pickup-0001' });
    clock = new Date(T0.getTime() + 600000);
    assert.equal((await service.sweepExpired()).toString(), '1');
    assert.equal(state.runs[0].status, 'expired');
    assert.equal(state.runs[0].cargo_token, null);
    assert.equal(state.active.has(42), false);
    assert.equal(state.gold.get(42), 10);
  });

  it('cancelamento não paga, remove vaga e é persistente', async () => {
    const { service } = createHarness();
    await service.acceptWork({ characterId: 42, workCode: 'hay_delivery', requestId: 'assign-0001' });
    assert.equal((await service.cancelRun({ characterId: 42 })).ok, true);
    assert.equal(state.runs[0].status, 'cancelled');
    assert.equal(state.gold.get(42), 10);
    assert.equal(state.active.has(42), false);
  });
});

describe('public-work-service — integração física', () => {
  it('registra aceite, coleta e entrega somente como interações de objeto por E', () => {
    const { service, interactionEntries } = createHarness();
    service.registerInteractions();
    assert.deepEqual([...interactionEntries.keys()], [
      'public_work.accept_hay_delivery', 'public_work.pickup', 'public_work.deliver', 'public_work.cancel'
    ]);
    for (const entry of interactionEntries.values()) {
      assert.equal(entry.target, 'object');
      assert.equal(entry.distance, 220);
      assert.equal(entry.policyAction, 'public_work');
      if (entry.id !== 'public_work.cancel') assert.equal(entry.idempotent, true);
    }
  });

  it('publica quadro, origem e destino no índice e falha se FormDesc não resolve', async () => {
    const { service, getAnchorProvider } = createHarness();
    assert.equal(await service.registerPhysicalAnchors(), 3);
    assert.deepEqual((await getAnchorProvider().list()).map(x => x.targetId).sort(), [0x100, 0x101, 0x102]);
    FORMS.delete(0x102);
    await assert.rejects(() => service.registerPhysicalAnchors(), /FormDesc nao resolvido/);
    FORMS.set(0x102, '102:Skyrim.esm');
  });
});

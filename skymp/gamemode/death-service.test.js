/**
 * death-service.test.js
 *
 * Testes do fluxo de morte com consequência real: DOWNED → socorro OU
 * bleed-out (penalidade + contexto de morte pra staff) → respawn.
 *
 * Executa com: node --test death-service.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────
// Mock do banco de dados (compartilhado por death-service e core/transaction-service,
// que também é carregado através do mesmo Module._load abaixo)
// ─────────────────────────────────────────────────────────────────────────────

let mockGold = {}; // characterId -> gold
const auditEntries = [];
const goldLedger = [];

function makeConn() {
  return {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, params = []) => {
      if (/SELECT gold FROM characters/i.test(sql)) {
        return [[{ gold: mockGold[params[0]] || 0 }]];
      }
      if (/UPDATE characters SET gold = gold \+/i.test(sql)) {
        mockGold[params[1]] = (mockGold[params[1]] || 0) + params[0];
        return [[{}]];
      }
      if (/INSERT INTO gold_transactions/i.test(sql)) {
        goldLedger.push(params);
        return [[{}]];
      }
      return [[]];
    }
  };
}

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database' || request === '../database') {
    return {
      query: async (sql, params = []) => {
        if (/SELECT gold FROM characters/i.test(sql)) {
          return [{ gold: mockGold[params[0]] || 0 }];
        }
        if (/INSERT INTO audit_logs/i.test(sql)) {
          auditEntries.push(params);
          return [{}];
        }
        return [];
      },
      getConnection: async () => makeConn(),
      init: () => {}
    };
  }
  return originalLoad.apply(this, arguments);
};

// Mock mínimo do runtime `mp` — só o suficiente pra executeRespawn/rescueTarget rodarem.
const mpState = { values: new Map() };
global.mp = {
  get: (actorId, prop) => mpState.values.get(`${actorId}:${prop}`) ?? null,
  set: (actorId, prop, value) => mpState.values.set(`${actorId}:${prop}`, value),
  getDescFromId: (actorId) => `desc-${actorId}`,
  callPapyrusFunction: () => null
};

function setPos(actorId, pos, cell = 'whiterun') {
  mpState.values.set(`${actorId}:locationalData`, { pos, cellOrWorldDesc: cell });
  mpState.values.set(`${actorId}:type`, 'MpActor');
}

function setNeighbors(actorId, neighborIds) {
  mpState.values.set(`${actorId}:neighbors`, neighborIds);
}

const commands = require('./commands');
const characterState = require('./core/character-state');
const { STATES } = characterState;
const deathService = require('./death-service');

Module._load = originalLoad;

after(() => {
  delete global.mp;
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const VICTIM_ACTOR_ID = 0xff00d001;
const VICTIM_CHARACTER_ID = 8001;
const RESCUER_ACTOR_ID = 0xff00d002;
const RESCUER_CHARACTER_ID = 8002;

describe('death-service', () => {
  beforeEach(() => {
    commands.registerActiveCharacter(VICTIM_ACTOR_ID, { id: VICTIM_CHARACTER_ID, first_name: 'Vitima', last_name: 'Um' }, 1, 1);
    commands.registerActiveCharacter(RESCUER_ACTOR_ID, { id: RESCUER_CHARACTER_ID, first_name: 'Socorrista', last_name: 'Dois' }, 2, 2);
    characterState.set(VICTIM_CHARACTER_ID, STATES.NORMAL, {});
    characterState.set(RESCUER_CHARACTER_ID, STATES.NORMAL, {});
    setPos(VICTIM_ACTOR_ID, [0, 0, 0]);
    setPos(RESCUER_ACTOR_ID, [10, 0, 0]);
    setNeighbors(VICTIM_ACTOR_ID, [RESCUER_ACTOR_ID]);
    mockGold = { [VICTIM_CHARACTER_ID]: 500 };
    auditEntries.length = 0;
    goldLedger.length = 0;
    deathService._downedPlayers.clear();
  });

  it('handlePlayerDowned coloca o personagem em DOWNED', async () => {
    await deathService._handlePlayerDowned(VICTIM_ACTOR_ID);
    assert.strictEqual(characterState.get(VICTIM_CHARACTER_ID), STATES.DOWNED);
    assert.strictEqual(deathService.isDowned(VICTIM_CHARACTER_ID), true);
  });

  it('handlePlayerDowned ignora quedas repetidas do mesmo personagem já DOWNED', async () => {
    await deathService._handlePlayerDowned(VICTIM_ACTOR_ID);
    const firstEntry = deathService._downedPlayers.get(VICTIM_CHARACTER_ID);
    await deathService._handlePlayerDowned(VICTIM_ACTOR_ID);
    const secondEntry = deathService._downedPlayers.get(VICTIM_CHARACTER_ID);
    assert.strictEqual(firstEntry, secondEntry, 'não deveria recriar o timer de bleed-out');
  });

  describe('rescueTarget', () => {
    it('estabiliza o alvo DOWNED dentro de alcance e cancela o bleed-out', async () => {
      await deathService._handlePlayerDowned(VICTIM_ACTOR_ID);
      await deathService.rescueTarget(RESCUER_ACTOR_ID, VICTIM_ACTOR_ID);

      assert.strictEqual(characterState.get(VICTIM_CHARACTER_ID), STATES.NORMAL);
      assert.strictEqual(deathService.isDowned(VICTIM_CHARACTER_ID), false);
    });

    it('não faz nada se o alvo não está DOWNED', async () => {
      await deathService.rescueTarget(RESCUER_ACTOR_ID, VICTIM_ACTOR_ID);
      assert.strictEqual(characterState.get(VICTIM_CHARACTER_ID), STATES.NORMAL);
    });

    it('bloqueia socorro fora de alcance', async () => {
      await deathService._handlePlayerDowned(VICTIM_ACTOR_ID);
      setPos(RESCUER_ACTOR_ID, [50000, 0, 0]);

      await deathService.rescueTarget(RESCUER_ACTOR_ID, VICTIM_ACTOR_ID);

      assert.strictEqual(characterState.get(VICTIM_CHARACTER_ID), STATES.DOWNED, 'socorro fora de alcance não deveria estabilizar');
      assert.strictEqual(deathService.isDowned(VICTIM_CHARACTER_ID), true);
    });

    it('impede socorrer a si mesmo', async () => {
      await deathService._handlePlayerDowned(VICTIM_ACTOR_ID);
      await deathService.rescueTarget(VICTIM_ACTOR_ID, VICTIM_ACTOR_ID);
      assert.strictEqual(deathService.isDowned(VICTIM_CHARACTER_ID), true);
    });
  });

  describe('bleedOut', () => {
    it('aplica a penalidade de morte, registra contexto e transiciona pra DEAD', async () => {
      await deathService._handlePlayerDowned(VICTIM_ACTOR_ID);
      const penalty = await deathService.bleedOut(VICTIM_ACTOR_ID, VICTIM_CHARACTER_ID);

      assert.strictEqual(characterState.get(VICTIM_CHARACTER_ID), STATES.DEAD);
      assert.ok(penalty > 0, 'deveria ter aplicado alguma penalidade');
      assert.strictEqual(mockGold[VICTIM_CHARACTER_ID], 500 - penalty);
      assert.strictEqual(deathService.isDowned(VICTIM_CHARACTER_ID), false);

      const contextEntry = auditEntries.find(p => p[0] === 'death:context');
      assert.ok(contextEntry, 'deveria ter registrado o contexto de morte em audit_logs');
      const details = JSON.parse(contextEntry[3]);
      assert.strictEqual(details.characterId, VICTIM_CHARACTER_ID);
      assert.strictEqual(details.cause, 'bleed_out');
      assert.ok(details.nearby.some(n => n.characterId === RESCUER_CHARACTER_ID), 'socorrista próximo deveria aparecer no contexto');
    });

    it('penalidade nunca deixa o saldo negativo (usa min(gold, penalidade))', async () => {
      mockGold[VICTIM_CHARACTER_ID] = 10; // menor que DEATH_PENALTY_COINS (50)
      const penalty = await deathService.bleedOut(VICTIM_ACTOR_ID, VICTIM_CHARACTER_ID);
      assert.strictEqual(penalty, 10);
      assert.strictEqual(mockGold[VICTIM_CHARACTER_ID], 0);
    });
  });

  describe('executeRespawn', () => {
    it('volta o personagem pra NORMAL após a penalidade', async () => {
      characterState.set(VICTIM_CHARACTER_ID, STATES.DEAD, {});
      await deathService.executeRespawn(VICTIM_ACTOR_ID, VICTIM_CHARACTER_ID, 50);
      assert.strictEqual(characterState.get(VICTIM_CHARACTER_ID), STATES.NORMAL);
    });
  });
});

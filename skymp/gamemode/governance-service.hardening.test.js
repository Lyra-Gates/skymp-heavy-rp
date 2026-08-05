/**
 * governance-service.hardening.test.js
 *
 * Testes de regressão para os fixes de segurança aplicados em governance-service.js:
 *   - assertRange agora é checado em fineTarget/confiscateItem/issueWarrant
 *     (antes, um guarda podia agir contra qualquer alvo online em qualquer
 *     lugar do mapa).
 *   - hasPermission agora exige gm.on_duty = 1 para permissões de guarda
 *     (antes, "sair de serviço" era cosmético).
 *
 * Usa issueWarrant como caso de teste (não toca ouro/inventário, só
 * governance_memberships + warrants + audit_logs — superfície de mock menor).
 *
 * Executa com: node --test governance-service.hardening.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────
// Estado do mock
// ─────────────────────────────────────────────────────────────────────────────

// Config do "cargo" do oficial: qual characterId tem qual permissão, e se está on_duty.
let membership = { characterId: null, permission: null, onDuty: true };

// Posições simuladas dos atores (pra assertRange calcular distância).
const positions = new Map(); // actorId -> { pos: [x,y,z], cell: 'x' }

const insertedWarrants = [];

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database') {
    return {
      query: async (sql, params = []) => {
        if (/FROM governance_memberships/i.test(sql) && /governance_role_permissions/i.test(sql)) {
          const [characterId, permission] = params;
          const requiresDuty = /on_duty\s*=\s*1/i.test(sql);
          if (
            membership.characterId === characterId &&
            membership.permission === permission &&
            (!requiresDuty || membership.onDuty)
          ) {
            return [{ role_name: 'guard', weight: 50, on_duty: membership.onDuty ? 1 : 0 }];
          }
          return [];
        }
        if (/INSERT INTO warrants/i.test(sql)) {
          insertedWarrants.push(params);
          return [{ insertId: insertedWarrants.length }];
        }
        if (/INSERT INTO audit_logs/i.test(sql)) return [{}];
        return [];
      },
      init: () => {}
    };
  }
  return originalLoad.apply(this, arguments);
};

// Mock mínimo do runtime `mp` — só o suficiente pra assertRange/notify funcionarem.
global.mp = {
  get: (actorId, prop) => {
    if (prop !== 'locationalData' && prop !== 'pos') return null;
    const p = positions.get(actorId);
    if (!p) return null;
    return { pos: p.pos, cellOrWorldDesc: p.cell };
  },
  getDescFromId: (actorId) => `desc-${actorId}`,
  callPapyrusFunction: () => null,
  set: () => {}
};

const commands = require('./commands');
const governance = require('./governance-service');

Module._load = originalLoad;

after(() => {
  delete global.mp;
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const OFFICER_ACTOR_ID = 0xff000a01;
const OFFICER_CHARACTER_ID = 9001;
const TARGET_ACTOR_ID = 0xff000a02;
const TARGET_CHARACTER_ID = 9002;

function setNear() {
  positions.set(OFFICER_ACTOR_ID, { pos: [0, 0, 0], cell: 'whiterun' });
  positions.set(TARGET_ACTOR_ID, { pos: [10, 0, 0], cell: 'whiterun' });
}

function setFar() {
  positions.set(OFFICER_ACTOR_ID, { pos: [0, 0, 0], cell: 'whiterun' });
  positions.set(TARGET_ACTOR_ID, { pos: [50000, 0, 0], cell: 'whiterun' });
}

describe('governance-service — hardening (range + on_duty)', () => {
  beforeEach(() => {
    commands.registerActiveCharacter(OFFICER_ACTOR_ID, { id: OFFICER_CHARACTER_ID, first_name: 'Guarda', last_name: 'Um' }, 1, 1);
    commands.registerActiveCharacter(TARGET_ACTOR_ID, { id: TARGET_CHARACTER_ID, first_name: 'Alvo', last_name: 'Dois' }, 2, 2);
    membership = { characterId: OFFICER_CHARACTER_ID, permission: 'guard_warrant', onDuty: true };
    insertedWarrants.length = 0;
    setNear();
  });

  it('permite issueWarrant quando o oficial está em serviço e no alcance', async () => {
    await governance.issueWarrant(OFFICER_ACTOR_ID, TARGET_ACTOR_ID, 'minor', 'teste');
    assert.strictEqual(insertedWarrants.length, 1, 'mandado deveria ter sido registrado');
  });

  it('bloqueia issueWarrant quando o alvo está fora de alcance (regressão: antes não checava distância)', async () => {
    setFar();
    await governance.issueWarrant(OFFICER_ACTOR_ID, TARGET_ACTOR_ID, 'minor', 'teste');
    assert.strictEqual(insertedWarrants.length, 0, 'mandado NAO deveria ter sido registrado — alvo fora de alcance');
  });

  it('bloqueia issueWarrant quando o guarda está fora de serviço (regressão: on_duty era cosmético)', async () => {
    membership.onDuty = false;
    await governance.issueWarrant(OFFICER_ACTOR_ID, TARGET_ACTOR_ID, 'minor', 'teste');
    assert.strictEqual(insertedWarrants.length, 0, 'mandado NAO deveria ter sido registrado — guarda fora de servico');
  });

  it('bloqueia issueWarrant quando o ator não tem a permissão guard_warrant', async () => {
    membership.permission = 'guard_fine'; // permissao errada
    await governance.issueWarrant(OFFICER_ACTOR_ID, TARGET_ACTOR_ID, 'minor', 'teste');
    assert.strictEqual(insertedWarrants.length, 0);
  });
});

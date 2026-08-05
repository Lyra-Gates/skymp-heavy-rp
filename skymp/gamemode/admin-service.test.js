/**
 * admin-service.test.js
 *
 * Testes de retireCharacter (soft-delete de personagem via staff) —
 * garante que a permissão é exigida, que o motivo é obrigatório, que o
 * status vira 'retired' (nunca DELETE) e que fica registrado em audit_logs.
 *
 * Executa com: node --test admin-service.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

const characterUpdates = [];
const auditEntries = [];
let staffRoleRow = null; // { role: 'admin' } ou null (sem cargo)

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database') {
    return {
      query: async (sql, params = []) => {
        if (/SELECT role FROM staff_roles/i.test(sql)) {
          return staffRoleRow ? [staffRoleRow] : [];
        }
        if (/UPDATE characters SET status/i.test(sql)) {
          characterUpdates.push({ status: params[0], characterId: params[1] });
          return {};
        }
        if (/INSERT INTO audit_logs/i.test(sql)) {
          auditEntries.push(params);
          return {};
        }
        return [];
      },
      init: () => {}
    };
  }
  return originalLoad.apply(this, arguments);
};

const commands = require('./commands');
const admin = require('./admin-service');

Module._load = originalLoad;

const STAFF_ACTOR_ID = 0xff00a001;
const STAFF_ACCOUNT_ID = 1;
const TARGET_ACTOR_ID = 0xff00a002;
const TARGET_CHARACTER_ID = 9101;
const TARGET_ACCOUNT_ID = 2;

describe('admin-service — retireCharacter (soft-delete)', () => {
  beforeEach(async () => {
    characterUpdates.length = 0;
    auditEntries.length = 0;
    staffRoleRow = { role: 'admin' };

    commands.registerActiveCharacter(STAFF_ACTOR_ID, { id: 5000, first_name: 'Staff', last_name: 'Um' }, STAFF_ACCOUNT_ID, 1);
    commands.registerActiveCharacter(TARGET_ACTOR_ID, { id: TARGET_CHARACTER_ID, first_name: 'Alvo', last_name: 'Dois' }, TARGET_ACCOUNT_ID, 2);
    admin.removeStaffRole(STAFF_ACTOR_ID);
    await admin.registerStaffRole(STAFF_ACTOR_ID, STAFF_ACCOUNT_ID);
  });

  it('recusa sem a permissão retire_character', async () => {
    admin.removeStaffRole(STAFF_ACTOR_ID);
    staffRoleRow = { role: 'moderator' }; // moderador não tem retire_character
    await admin.registerStaffRole(STAFF_ACTOR_ID, STAFF_ACCOUNT_ID);

    await admin.retireCharacter(STAFF_ACTOR_ID, TARGET_ACTOR_ID, 'teste');

    assert.strictEqual(characterUpdates.length, 0);
  });

  it('recusa sem motivo', async () => {
    await admin.retireCharacter(STAFF_ACTOR_ID, TARGET_ACTOR_ID, '');
    assert.strictEqual(characterUpdates.length, 0);
  });

  it('marca o personagem como retired e registra auditoria com admin', async () => {
    await admin.retireCharacter(STAFF_ACTOR_ID, TARGET_ACTOR_ID, 'RDM comprovado por evidência de staff');

    assert.strictEqual(characterUpdates.length, 1);
    assert.strictEqual(characterUpdates[0].status, 'retired');
    assert.strictEqual(characterUpdates[0].characterId, TARGET_CHARACTER_ID);

    const entry = auditEntries.find(p => p[0] === 'staff:retireCharacter');
    assert.ok(entry, 'deveria ter gravado staff:retireCharacter em audit_logs');
    assert.ok(entry[3].includes('RDM comprovado'), 'motivo deveria estar nos detalhes do audit log');
  });

  it('nunca usa DELETE — só UPDATE de status', async () => {
    await admin.retireCharacter(STAFF_ACTOR_ID, TARGET_ACTOR_ID, 'teste');
    // A própria query mockada só reconhece UPDATE; se o código tentasse
    // DELETE, characterUpdates continuaria vazio e o teste de status falharia.
    assert.strictEqual(characterUpdates[0].status, 'retired');
  });
});

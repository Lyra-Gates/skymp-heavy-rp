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

/**
 * Guarda de argumento do hasPermission.
 *
 * Doze chamadas nos módulos PARKED passam nível numérico (`hasPermission(id, 20)`),
 * herança de um modelo antigo. Como `permissions` é um Set de strings,
 * `Set.has(20)` sempre foi `false` — negava tudo caladamente. Estes testes
 * garantem que o resultado seguro (negar) continua, mas agora com registro.
 */
describe('admin-service — hasPermission valida o argumento', () => {
  const ACTOR = 0xff000abc;
  let loggedErrors;
  const originalError = console.error;

  beforeEach(async () => {
    staffRoleRow = { role: 'owner' };
    await admin.registerStaffRole(ACTOR, 1);
    loggedErrors = [];
    console.error = (...args) => loggedErrors.push(args.join(' '));
  });

  const restore = () => { console.error = originalError; };

  it('nega e registra quando recebe nível numérico legado', () => {
    const allowed = admin.hasPermission(ACTOR, 20);
    restore();
    assert.strictEqual(allowed, false, 'nível numérico nunca deveria conceder acesso');
    assert.ok(
      loggedErrors.some(l => l.includes('em vez de um nome de permissão')),
      'a chamada errada precisa aparecer no log, não sumir'
    );
  });

  it('nega e registra quando recebe permissão inexistente', () => {
    const allowed = admin.hasPermission(ACTOR, 'manage_factions');
    restore();
    assert.strictEqual(allowed, false);
    assert.ok(
      loggedErrors.some(l => l.includes('desconhecida')),
      'permissão que nenhum cargo concede é uma porta que nunca abre — precisa avisar'
    );
  });

  it('continua concedendo permissão válida do cargo, sem ruído no log', () => {
    const allowed = admin.hasPermission(ACTOR, 'retire_character');
    restore();
    assert.strictEqual(allowed, true, 'owner tem retire_character');
    assert.strictEqual(loggedErrors.length, 0, 'caminho feliz não deveria logar erro');
  });

  it('nega permissão válida que o cargo não tem', async () => {
    staffRoleRow = { role: 'moderator' };
    await admin.registerStaffRole(ACTOR, 1);
    const allowed = admin.hasPermission(ACTOR, 'retire_character');
    restore();
    assert.strictEqual(allowed, false, 'moderador não pode aposentar personagem');
  });
});

/**
 * O cargo de staff vive num cache chaveado por actorId — e o SkyMP reaproveita
 * actorId entre sessões. `registerStaffRole` só roda no login (whitelist.js),
 * então nada reescreve a entrada quando o slot muda de dono: um jogador comum
 * que entrasse no actorId de um admin que saiu herdava o cargo inteiro.
 *
 * O teste é de sessão, não de permissão: o cargo está correto nos dois momentos.
 * O que se verifica é que a desconexão limpa o cache — por isso ele chama
 * `commands.removeActiveCharacter`, que é o caminho real da desconexão em
 * `phase0-basic.js`, e não `admin.removeStaffRole` direto (que só provaria que
 * a função existe, que era exatamente o estado anterior: exportada, testada e
 * nunca chamada em produção).
 */
describe('admin-service — cargo não sobrevive à desconexão', () => {
  const SAINDO_ACTOR_ID = 0xff00a003;
  const CONTA_DO_ADMIN = 77;

  beforeEach(async () => {
    staffRoleRow = { role: 'owner' };
    commands.registerActiveCharacter(
      SAINDO_ACTOR_ID,
      { id: 7700, first_name: 'Admin', last_name: 'Saindo' },
      CONTA_DO_ADMIN,
      3
    );
    admin.removeStaffRole(SAINDO_ACTOR_ID);
    await admin.registerStaffRole(SAINDO_ACTOR_ID, CONTA_DO_ADMIN);
  });

  it('o cargo vale enquanto o jogador está conectado', () => {
    assert.strictEqual(admin.getRole(SAINDO_ACTOR_ID), 'owner');
    assert.strictEqual(admin.hasPermission(SAINDO_ACTOR_ID, 'retire_character'), true);
  });

  it('removeActiveCharacter limpa o cargo do actorId', () => {
    commands.removeActiveCharacter(SAINDO_ACTOR_ID);

    assert.strictEqual(
      admin.getRole(SAINDO_ACTOR_ID), null,
      'o cargo continuou no cache depois da desconexão'
    );
  });

  it('quem herda o actorId depois não herda a permissão junto', () => {
    commands.removeActiveCharacter(SAINDO_ACTOR_ID);

    // Mesmo actorId, outra pessoa: conta sem cargo nenhum em staff_roles.
    staffRoleRow = null;
    commands.registerActiveCharacter(
      SAINDO_ACTOR_ID,
      { id: 8800, first_name: 'Jogador', last_name: 'Comum' },
      99,
      4
    );

    for (const permissao of ['kick', 'ban', 'set_gold', 'retire_character']) {
      assert.strictEqual(
        admin.hasPermission(SAINDO_ACTOR_ID, permissao), false,
        `jogador comum herdou '${permissao}' do admin que ocupava este actorId antes`
      );
    }
  });
});

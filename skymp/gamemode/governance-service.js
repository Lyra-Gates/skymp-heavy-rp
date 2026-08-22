/**
 * governance-service.js
 *
 * Sistema IC de governo, faccoes, cidades e guarda.
 *
 * Principios:
 * - O client apenas pede uma acao. Toda permissao, distancia, estado e pena
 *   sao calculados no servidor.
 * - Staff pode operar o sistema para administracao, mas guardas IC usam cargos
 *   e permissoes de cidade/reino/faccao.
 * - Todas as acoes fortes geram audit_logs e registros de dominio.
 */

const db = require('./database');
const admin = require('./admin-service');
const commands = require('./commands');
const inventory = require('./inventory-service');
const characterState = require('./core/character-state');
const actionPolicy = require('./core/action-policy');
const panelRefreshBus = require('./core/panel-refresh-bus');
const moduleRegistry = require('./core/module-registry');
const interactionRegistry = require('./core/interaction-registry');
// `core/transaction-service` saiu daqui em 13/08/2026: a multa era o único uso,
// e ela passou a chamar o `economy-service`, que é a porta do dinheiro. Ver
// ADR 004 §2.3 — módulo de domínio não fala com as primitivas do motor.
const economyService = require('./core/economy-service');
const debtService = require('./debt-service');
const rangeUtils = require('./core/range-utils');
const { actorRef } = require('./core/papyrus');
// Tarefa 13: a Revista Institucional aprende a reconhecer proveniencia suja, e
// o confisco aprende a rebaixar 'hot' -> 'stolen'. `crime` e modulo `lab`
// (pode estar desligado); toda chamada abaixo passa por
// `moduleRegistry.isEnabled('crime')` antes de usar isto, entao a governanca
// nunca fica bloqueada por um modulo que o servidor optou por nao ligar.
// `confiscations` (INSERT abaixo) e tabela deste arquivo desde
// migration-v3-governance.sql — migration-v22-crime-interactions.sql so
// acrescentou a coluna `item_instance_id`.
const crimeService = require('./core/crime-service');
const craftingService = require('./crafting-service');

const { STATES } = characterState;

const MODULE = 'governance';
const DEFAULT_RANGE = 450;
const SEARCH_RANGE = 350;
const ESCORT_RANGE = 650;
const MAX_UI_REASON_LENGTH = 256;

const SCOPE = Object.freeze({
  REALM: 'realm',
  CITY: 'city',
  FACTION: 'faction'
});

const PERMISSIONS = Object.freeze({
  MANAGE_REALM: 'manage_realm',
  MANAGE_CITY: 'manage_city',
  MANAGE_FACTION: 'manage_faction',
  MANAGE_RANKS: 'manage_ranks',
  INVITE_MEMBER: 'invite_member',
  REMOVE_MEMBER: 'remove_member',
  PROMOTE_MEMBER: 'promote_member',
  MANAGE_TREASURY: 'manage_treasury',
  MANAGE_TAXES: 'manage_taxes',
  MANAGE_SHOPS: 'manage_shops',
  MANAGE_EVENTS: 'manage_events',
  GUARD_DUTY: 'guard_duty',
  GUARD_SEARCH: 'guard_search',
  GUARD_DETAIN: 'guard_detain',
  GUARD_ARREST: 'guard_arrest',
  GUARD_FINE: 'guard_fine',
  GUARD_WARRANT: 'guard_warrant',
  GUARD_CONFISCATE: 'guard_confiscate',
  GUARD_RELEASE: 'guard_release',
  VIEW_RECORDS: 'view_records',
  STALL_INSPECT: 'stall_inspect',
  STALL_SUSPEND: 'stall_suspend',
  STALL_CONFISCATE: 'stall_confiscate',
  STALL_ISSUE_LICENSE: 'stall_issue_license',
  STALL_COLLECT_TAX: 'stall_collect_tax'
});

const DEFAULT_ROLES = [
  {
    name: 'leader',
    label: 'Lider',
    weight: 100,
    permissions: Object.values(PERMISSIONS)
  },
  {
    name: 'officer',
    label: 'Oficial',
    weight: 70,
    permissions: [
      PERMISSIONS.INVITE_MEMBER,
      PERMISSIONS.REMOVE_MEMBER,
      PERMISSIONS.PROMOTE_MEMBER,
      PERMISSIONS.MANAGE_TREASURY,
      PERMISSIONS.GUARD_DUTY,
      PERMISSIONS.GUARD_SEARCH,
      PERMISSIONS.GUARD_DETAIN,
      PERMISSIONS.GUARD_ARREST,
      PERMISSIONS.GUARD_FINE,
      PERMISSIONS.GUARD_WARRANT,
      PERMISSIONS.GUARD_CONFISCATE,
      PERMISSIONS.GUARD_RELEASE,
      PERMISSIONS.VIEW_RECORDS,
      PERMISSIONS.STALL_INSPECT,
      PERMISSIONS.STALL_SUSPEND,
      PERMISSIONS.STALL_CONFISCATE,
      PERMISSIONS.STALL_ISSUE_LICENSE,
      PERMISSIONS.STALL_COLLECT_TAX
    ]
  },
  {
    name: 'guard',
    label: 'Guarda',
    weight: 50,
    permissions: [
      PERMISSIONS.GUARD_DUTY,
      PERMISSIONS.GUARD_SEARCH,
      PERMISSIONS.GUARD_DETAIN,
      PERMISSIONS.GUARD_ARREST,
      PERMISSIONS.GUARD_FINE,
      PERMISSIONS.GUARD_CONFISCATE,
      PERMISSIONS.VIEW_RECORDS,
      PERMISSIONS.STALL_INSPECT,
      PERMISSIONS.STALL_SUSPEND,
      PERMISSIONS.STALL_CONFISCATE
    ]
  },
  {
    name: 'member',
    label: 'Membro',
    weight: 10,
    permissions: []
  }
];

let initialized = false;
let sentenceTimer = null;

function notify(actorId, message) {
  commands.sendNotification(actorId, message);
}

/*
 * O caminho legado de interacao foi REMOVIDO em 13/08/2026.
 *
 * Viviam aqui `isValidUiAction`, `validateUiInteractionPayload`,
 * `getInteractionActions`, `handleInteractionAction`, `handleUiEvent` e
 * `sendBrowserModal` - um menu de interacao completo dentro do modulo de
 * governo. O fluxo estava certo (servidor monta, cliente escolhe, servidor
 * revalida); o lugar, nao.
 *
 * O que saiu com eles:
 *
 *   - o `require('./market-stalls-service')` por nome fixo dentro de uma funcao
 *     de dominio, num modulo que ja declarava `dependencies: ['governance']` -
 *     a seta apontava para os dois lados;
 *   - a regex `/^(guard|stall|npc)\.[a-z_]+$/`, que era o vocabulario de acoes
 *     do servidor inteiro e matava `identity.introduce` e `medical.help` antes
 *     de chegarem a qualquer lugar;
 *   - um `validateUiInteractionPayload` que crescia com o servidor inteiro:
 *     schema de multa, de prisao, de confisco e de compra de barraca num
 *     encadeamento de `if`;
 *   - um `requestId` validado no formato e descartado, entao duplo clique em
 *     "Aplicar multa" cobrava duas vezes;
 *   - um `notify(actorId, safeJson(sections))` que despejava a lista de
 *     autorizacao no chat do jogador, alem do modal.
 *
 * O que ficou: as funcoes de dominio (`stopTarget`, `fineTarget`,
 * `arrestTarget`, ...), intactas, e `registerGuardInteractions()`, que as
 * declara no `core/interaction-registry.js`. Cada uma continua revalidando
 * permissao e alcance por conta propria - redundante de proposito, para o dia
 * em que alguem as chamar por outro caminho.
 *
 * Ver `docs/research/CORE_FRAMEWORK_AUDIT.md` 6 e
 * `docs/technical/ADR_002_INTERACTION_FRAMEWORK.md`.
 */

function getCharacter(actorId) {
  return commands.getActiveCharacterData(actorId);
}

function parseActorId(raw) {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : NaN;
  }
  if (typeof raw !== 'string') return NaN;

  const clean = raw.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,8}$/i.test(clean)) return NaN;

  return Number.parseInt(clean, 16);
}

function parsePositiveInt(raw, fallback = 0) {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function assertRange(sourceActorId, targetActorId, maxRange = DEFAULT_RANGE) {
  return rangeUtils.assertRange(sourceActorId, targetActorId, maxRange);
}

async function audit(actorActorId, targetActorId, action, details) {
  const actor = getCharacter(actorActorId);
  const target = targetActorId ? getCharacter(targetActorId) : null;
  await admin.auditLog(actor?.accountId || null, target?.accountId || null, `${MODULE}:${action}`, details || null);
}

function isStaffGovernor(actorId) {
  return admin.hasPermission(actorId, 'manage_staff');
}

async function ensureDefaultRoles(scopeType, scopeId) {
  for (const role of DEFAULT_ROLES) {
    const result = await db.query(
      `INSERT IGNORE INTO governance_roles (scope_type, scope_id, name, label, weight)
       VALUES (?, ?, ?, ?, ?)`,
      [scopeType, String(scopeId), role.name, role.label, role.weight]
    );

    let roleId = result.insertId;
    if (!roleId) {
      const rows = await db.query(
        'SELECT id FROM governance_roles WHERE scope_type = ? AND scope_id = ? AND name = ?',
        [scopeType, String(scopeId), role.name]
      );
      roleId = rows[0]?.id;
    }

    if (!roleId) continue;
    for (const permission of role.permissions) {
      await db.query(
        'INSERT IGNORE INTO governance_role_permissions (role_id, permission) VALUES (?, ?)',
        [roleId, permission]
      );
    }
  }
}

async function getRole(scopeType, scopeId, roleName) {
  const rows = await db.query(
    'SELECT * FROM governance_roles WHERE scope_type = ? AND scope_id = ? AND name = ? LIMIT 1',
    [scopeType, String(scopeId), roleName]
  );
  return rows[0] || null;
}

async function ensureDefaultRolesForExistingScopes() {
  const realms = await db.query('SELECT id FROM realms').catch(() => []);
  for (const realm of realms) {
    await ensureDefaultRoles(SCOPE.REALM, realm.id);
  }

  const cities = await db.query('SELECT id FROM cities').catch(() => []);
  for (const city of cities) {
    await ensureDefaultRoles(SCOPE.CITY, city.id);
  }

  const factions = await db.query('SELECT id FROM factions').catch(() => []);
  for (const faction of factions) {
    await ensureDefaultRoles(SCOPE.FACTION, faction.id);
  }
}

async function getMembership(characterId, scopeType, scopeId, queryable = db) {
  const rows = await queryable.query(
    `SELECT gm.*, gr.name AS role_name, gr.weight
     FROM governance_memberships gm
     INNER JOIN governance_roles gr ON gr.id = gm.role_id
     WHERE gm.character_id = ? AND gm.scope_type = ? AND gm.scope_id = ? AND gm.status = 'active'
     LIMIT 1`,
    [characterId, scopeType, String(scopeId)]
  );
  return rows[0] || null;
}

// Permissoes de guarda que exigem estar em servico (gm.on_duty = 1). GUARD_DUTY
// fica de fora de propósito — é o próprio toggle de entrar/sair de serviço.
const GUARD_DUTY_REQUIRED = new Set([
  PERMISSIONS.GUARD_SEARCH,
  PERMISSIONS.GUARD_DETAIN,
  PERMISSIONS.GUARD_ARREST,
  PERMISSIONS.GUARD_FINE,
  PERMISSIONS.GUARD_WARRANT,
  PERMISSIONS.GUARD_CONFISCATE,
  PERMISSIONS.GUARD_RELEASE
]);

async function hasPermission(actorId, permission, context = {}) {
  if (isStaffGovernor(actorId)) {
    return { allowed: true, source: 'staff' };
  }

  const actor = getCharacter(actorId);
  if (!actor) return { allowed: false, reason: 'Personagem nao carregado.' };

  const params = [actor.characterId, permission];
  let scopeFilter = '';
  if (context.scopeType && context.scopeId) {
    scopeFilter = 'AND gm.scope_type = ? AND gm.scope_id = ?';
    params.push(context.scopeType, String(context.scopeId));
  }
  const dutyFilter = GUARD_DUTY_REQUIRED.has(permission) ? 'AND gm.on_duty = 1' : '';

  const rows = await db.query(
    `SELECT gm.*, gr.name AS role_name, gr.weight
     FROM governance_memberships gm
     INNER JOIN governance_roles gr ON gr.id = gm.role_id
     INNER JOIN governance_role_permissions grp ON grp.role_id = gr.id
     WHERE gm.character_id = ?
       AND gm.status = 'active'
       AND grp.permission = ?
       ${scopeFilter}
       ${dutyFilter}
     ORDER BY gr.weight DESC
     LIMIT 1`,
    params
  );

  if (rows.length === 0) {
    const reason = GUARD_DUTY_REQUIRED.has(permission)
      ? 'Sem permissao IC para esta acao (ou voce esta fora de servico).'
      : 'Sem permissao IC para esta acao.';
    return { allowed: false, reason };
  }

  return { allowed: true, source: rows[0] };
}

async function requirePermission(actorId, permission, context = {}) {
  const check = await hasPermission(actorId, permission, context);
  if (!check.allowed) {
    notify(actorId, check.reason);
    return null;
  }
  return check;
}

async function createRealm(actorId, realmId, name) {
  if (!await requirePermission(actorId, PERMISSIONS.MANAGE_REALM)) return;
  if (!realmId || !name) {
    notify(actorId, 'Uso: /realmcreate <id> <nome>');
    return;
  }
  const actor = getCharacter(actorId);
  await db.query(
    `INSERT INTO realms (id, name, ruler_character_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [realmId, name, actor?.characterId || null]
  );
  await ensureDefaultRoles(SCOPE.REALM, realmId);
  if (actor) await addMembershipInternal(actor.characterId, SCOPE.REALM, realmId, 'leader', actor.characterId);
  await audit(actorId, null, 'realm:create', `realm=${realmId} name=${name}`);
  notify(actorId, `Reino registrado: ${name}.`);
}

async function createCity(actorId, cityId, realmId, holdId, name) {
  if (!await requirePermission(actorId, PERMISSIONS.MANAGE_CITY)) return;
  if (!cityId || !realmId || !holdId || !name) {
    notify(actorId, 'Uso: /citycreate <id> <realmId> <holdId> <nome>');
    return;
  }
  const actor = getCharacter(actorId);
  await db.query(
    `INSERT INTO cities (id, realm_id, hold_id, name, governor_character_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE realm_id = VALUES(realm_id), hold_id = VALUES(hold_id), name = VALUES(name)`,
    [cityId, realmId, holdId, name, actor?.characterId || null]
  );
  await ensureDefaultRoles(SCOPE.CITY, cityId);
  if (actor) await addMembershipInternal(actor.characterId, SCOPE.CITY, cityId, 'leader', actor.characterId);
  await audit(actorId, null, 'city:create', `city=${cityId} realm=${realmId} hold=${holdId} name=${name}`);
  notify(actorId, `Cidade registrada: ${name}.`);
}

async function createFaction(actorId, tag, name) {
  if (!await requirePermission(actorId, PERMISSIONS.MANAGE_FACTION)) return;
  if (!tag || !name) {
    notify(actorId, 'Uso: /govfcreate <tag> <nome>');
    return;
  }
  const actor = getCharacter(actorId);
  const result = await db.query(
    `INSERT INTO factions (tag, name, leader_character_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [tag, name, actor?.characterId || null]
  );
  const factionId = result.insertId || (await db.query('SELECT id FROM factions WHERE tag = ?', [tag]))[0]?.id;
  if (!factionId) {
    notify(actorId, 'Nao foi possivel criar a faccao.');
    return;
  }
  await ensureDefaultRoles(SCOPE.FACTION, factionId);
  if (actor) await addMembershipInternal(actor.characterId, SCOPE.FACTION, factionId, 'leader', actor.characterId);
  await audit(actorId, null, 'faction:create', `faction=${factionId} tag=${tag} name=${name}`);
  notify(actorId, `Faccao registrada: ${tag} ${name}.`);
}

async function addMembershipInternal(characterId, scopeType, scopeId, roleName, grantedByCharacterId) {
  await ensureDefaultRoles(scopeType, scopeId);
  const role = await getRole(scopeType, scopeId, roleName);
  if (!role) throw new Error(`Cargo inexistente: ${roleName}`);
  await db.query(
    `INSERT INTO governance_memberships (character_id, scope_type, scope_id, role_id, granted_by_character_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), status = 'active', granted_by_character_id = VALUES(granted_by_character_id)`,
    [characterId, scopeType, String(scopeId), role.id, grantedByCharacterId || null]
  );
}

async function addMember(actorId, targetActorId, scopeType, scopeId, roleName = 'member') {
  if (!await requirePermission(actorId, PERMISSIONS.INVITE_MEMBER, { scopeType, scopeId })) return;
  const actor = getCharacter(actorId);
  const target = getCharacter(targetActorId);
  if (!target) {
    notify(actorId, 'Alvo nao encontrado ou personagem nao carregado.');
    return;
  }
  await addMembershipInternal(target.characterId, scopeType, scopeId, roleName, actor?.characterId || null);
  await audit(actorId, targetActorId, 'member:add', `scope=${scopeType}:${scopeId} role=${roleName}`);
  notify(actorId, 'Membro adicionado.');
  notify(targetActorId, `Voce recebeu um cargo em ${scopeType}:${scopeId}.`);
}

async function setDuty(actorId, enabled) {
  const actor = getCharacter(actorId);
  if (!actor) return;
  const permission = await hasPermission(actorId, PERMISSIONS.GUARD_DUTY);
  if (!permission.allowed) {
    notify(actorId, 'Voce nao possui cargo de guarda.');
    return;
  }
  await db.query(
    `UPDATE governance_memberships gm
     INNER JOIN governance_roles gr ON gr.id = gm.role_id
     INNER JOIN governance_role_permissions grp ON grp.role_id = gr.id
     SET gm.on_duty = ?
     WHERE gm.character_id = ? AND gm.status = 'active' AND grp.permission = ?`,
    [enabled ? 1 : 0, actor.characterId, PERMISSIONS.GUARD_DUTY]
  );
  await audit(actorId, null, enabled ? 'guard:duty_on' : 'guard:duty_off', null);
  notify(actorId, enabled ? 'Servico de guarda iniciado.' : 'Servico de guarda encerrado.');
}

async function stopTarget(officerActorId, targetActorId, reason = 'abordagem') {
  if (!await requirePermission(officerActorId, PERMISSIONS.GUARD_DETAIN)) return;
  const range = assertRange(officerActorId, targetActorId, DEFAULT_RANGE);
  if (!range.ok) {
    notify(officerActorId, range.reason);
    return;
  }
  const officer = getCharacter(officerActorId);
  const target = getCharacter(targetActorId);
  if (!officer || !target) return;

  await db.query(
    `INSERT INTO guard_detentions (target_character_id, officer_character_id, status, reason)
     VALUES (?, ?, 'stopped', ?)`,
    [target.characterId, officer.characterId, reason]
  );
  characterState.set(target.characterId, STATES.IN_DIALOG, { reason: 'guard_stop', officerCharacterId: officer.characterId });
  await audit(officerActorId, targetActorId, 'guard:stop', reason);
  notify(officerActorId, 'Alvo abordado.');
  notify(targetActorId, `Voce foi abordado pela guarda. Motivo: ${reason}`);
  commands.broadcastProximityMessage(officerActorId, '* Faz uma abordagem oficial da guarda.', 600);
}

async function detainTarget(officerActorId, targetActorId, reason = 'detencao preventiva') {
  if (!await requirePermission(officerActorId, PERMISSIONS.GUARD_DETAIN)) return;
  const range = assertRange(officerActorId, targetActorId, DEFAULT_RANGE);
  if (!range.ok) {
    notify(officerActorId, range.reason);
    return;
  }
  const officer = getCharacter(officerActorId);
  const target = getCharacter(targetActorId);
  if (!officer || !target) return;

  await db.query(
    `INSERT INTO guard_detentions (target_character_id, officer_character_id, status, reason)
     VALUES (?, ?, 'detained', ?)`,
    [target.characterId, officer.characterId, reason]
  );
  characterState.set(target.characterId, STATES.RESTRAINED, { reason, officerCharacterId: officer.characterId });
  await db.query(
    `INSERT INTO character_restraints (character_id, restrained_by_character_id, type)
     VALUES (?, ?, 'guard_detention')
     ON DUPLICATE KEY UPDATE restrained_by_character_id = VALUES(restrained_by_character_id), type = VALUES(type), applied_at = NOW()`,
    [target.characterId, officer.characterId]
  );
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', actorRef(targetActorId), ['SpeedMult', 0]);
  }
  await audit(officerActorId, targetActorId, 'guard:detain', reason);
  notify(officerActorId, 'Alvo detido.');
  notify(targetActorId, `Voce foi detido pela guarda. Motivo: ${reason}`);
}

async function releaseTarget(officerActorId, targetActorId, reason = 'liberado') {
  if (!await requirePermission(officerActorId, PERMISSIONS.GUARD_RELEASE)) return;
  const officer = getCharacter(officerActorId);
  const target = getCharacter(targetActorId);
  if (!officer || !target) return;

  await db.query(
    `UPDATE guard_detentions
     SET status = 'released', released_at = NOW()
     WHERE target_character_id = ? AND status IN ('stopped', 'detained', 'escorted')`,
    [target.characterId]
  );
  await db.query('DELETE FROM character_restraints WHERE character_id = ?', [target.characterId]);
  characterState.set(target.characterId, STATES.NORMAL, {});
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', actorRef(targetActorId), ['SpeedMult', 100]);
  }
  await audit(officerActorId, targetActorId, 'guard:release', reason);
  notify(officerActorId, 'Alvo liberado.');
  notify(targetActorId, 'Voce foi liberado pela guarda.');
}

async function hasActiveWarrant(characterId) {
  const rows = await db.query(
    `SELECT * FROM warrants
     WHERE target_character_id = ? AND status = 'active'
     ORDER BY severity DESC, created_at DESC
     LIMIT 1`,
    [characterId]
  );
  return rows[0] || null;
}

async function requestSearch(officerActorId, targetActorId, reason = 'revista') {
  if (!await requirePermission(officerActorId, PERMISSIONS.GUARD_SEARCH)) return;
  const range = assertRange(officerActorId, targetActorId, SEARCH_RANGE);
  if (!range.ok) {
    notify(officerActorId, range.reason);
    return;
  }
  const officer = getCharacter(officerActorId);
  const target = getCharacter(targetActorId);
  if (!officer || !target) return;

  const warrant = await hasActiveWarrant(target.characterId);
  const forced = Boolean(warrant);
  const result = await db.query(
    `INSERT INTO guard_searches (target_character_id, officer_character_id, reason, forced, status)
     VALUES (?, ?, ?, ?, ?)`,
    [target.characterId, officer.characterId, reason, forced ? 1 : 0, forced ? 'approved' : 'pending']
  );

  await audit(officerActorId, targetActorId, forced ? 'guard:search_forced' : 'guard:search_request', `searchId=${result.insertId} reason=${reason}`);
  if (forced) {
    await showInventorySnapshot(officerActorId, targetActorId, result.insertId);
    return;
  }

  notify(officerActorId, 'Revista solicitada. Aguarde consentimento ou use mandado.');
  notify(targetActorId, `Guarda solicita revista. Use /searchaccept ${result.insertId} ou /searchdeny ${result.insertId}.`);
}

async function approveSearch(targetActorId, searchId, approved) {
  const target = getCharacter(targetActorId);
  if (!target) return;
  const rows = await db.query(
    `SELECT * FROM guard_searches
     WHERE id = ? AND target_character_id = ? AND status = 'pending'
     LIMIT 1`,
    [searchId, target.characterId]
  );
  const search = rows[0];
  if (!search) {
    notify(targetActorId, 'Solicitacao de revista nao encontrada.');
    return;
  }
  await db.query('UPDATE guard_searches SET status = ?, responded_at = NOW() WHERE id = ?', [approved ? 'approved' : 'denied', searchId]);
  if (!approved) {
    notify(targetActorId, 'Voce recusou a revista.');
    await audit(targetActorId, null, 'guard:search_denied', `searchId=${searchId}`);
    return;
  }

  const officerActorId = findActorByCharacterId(search.officer_character_id);
  if (officerActorId) {
    await showInventorySnapshot(officerActorId, targetActorId, searchId);
  }
  notify(targetActorId, 'Voce aceitou a revista.');
}

function findActorByCharacterId(characterId) {
  return commands.getActiveActorByCharacterId(characterId);
}

async function showInventorySnapshot(officerActorId, targetActorId, searchId) {
  const target = getCharacter(targetActorId);
  if (!target) return;
  const rows = await db.query(
    'SELECT base_id, count FROM character_inventory WHERE character_id = ? AND count > 0 ORDER BY base_id LIMIT 40',
    [target.characterId]
  );
  const snapshot = rows.map(r => `0x${Number(r.base_id).toString(16)}x${r.count}`).join(', ') || 'sem itens registrados';
  await db.query('UPDATE guard_searches SET result_snapshot = ? WHERE id = ?', [snapshot, searchId]);
  notify(officerActorId, `Inventario do alvo: ${snapshot}`);
  await notifyStolenProvenance(officerActorId, target.characterId);
  await notifyMakerSignatures(officerActorId, target.characterId);
}

/**
 * Revista Institucional (Tarefa 13, §2/§3): depois do snapshot comum, avisa o
 * guarda sobre qualquer item de proveniência suja (`hot`/`stolen`) que o alvo
 * carrega — com o NOME do dono original, nunca um veredito do servidor
 * ("ele é ladrão"). Quem decide o que fazer com a informação é o jogador.
 *
 * `crime` é módulo `lab`: se estiver desligado, a revista continua
 * funcionando exatamente como antes desta tarefa — só sem a seção extra.
 */
async function notifyStolenProvenance(officerActorId, targetCharacterId) {
  if (!moduleRegistry.isEnabled('crime')) return;
  let stolenItems;
  try {
    stolenItems = await crimeService.getStolenInstancesHeldBy(targetCharacterId);
  } catch (err) {
    console.error('[governance] falha ao consultar proveniencia na revista:', err.message);
    return;
  }
  if (!stolenItems || stolenItems.length === 0) return;

  for (const item of stolenItems) {
    notify(
      officerActorId,
      `[Proveniencia] 0x${item.baseId.toString(16)} (${item.status}) — Este item pertence a ${item.originalOwnerName}!`
    );
  }
}

/**
 * Assinatura do Artesão (docs/design/MAKERS_MARK.md): depois do snapshot
 * comum, avisa o guarda sobre itens que o alvo carrega com dedicatória de
 * artesão conhecida — mesmo padrão de `notifyStolenProvenance`, canal
 * separado (autoria não é culpa).
 *
 * `crafting` é módulo `lab`: se estiver desligado, a revista continua
 * funcionando exatamente como antes desta tarefa — só sem a seção extra.
 */
async function notifyMakerSignatures(officerActorId, targetCharacterId) {
  if (!moduleRegistry.isEnabled('crafting')) return;
  let signatures;
  try {
    signatures = await craftingService.getSignaturesHeldBy(targetCharacterId);
  } catch (err) {
    console.error('[governance] falha ao consultar assinaturas na revista:', err.message);
    return;
  }
  if (!signatures || signatures.length === 0) return;

  for (const item of signatures) {
    const dedicatoria = item.signatureText ? `"${item.signatureText}"` : '(sem dedicatoria)';
    notify(
      officerActorId,
      `[Assinatura] 0x${item.baseId.toString(16)} — trabalho de ${item.makerName} ${dedicatoria}`
    );
  }
}

async function issueWarrant(officerActorId, targetActorId, severity, reason) {
  if (!await requirePermission(officerActorId, PERMISSIONS.GUARD_WARRANT)) return;
  const range = assertRange(officerActorId, targetActorId, DEFAULT_RANGE);
  if (!range.ok) {
    notify(officerActorId, range.reason);
    return;
  }
  const officer = getCharacter(officerActorId);
  const target = getCharacter(targetActorId);
  if (!officer || !target) return;
  const normalizedSeverity = ['minor', 'serious', 'major', 'capital'].includes(severity) ? severity : 'serious';
  await db.query(
    `INSERT INTO warrants (target_character_id, issued_by_character_id, severity, reason, scope_type, scope_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [target.characterId, officer.characterId, normalizedSeverity, reason || 'Mandado emitido pela guarda', SCOPE.CITY, 'global']
  );
  await audit(officerActorId, targetActorId, 'guard:warrant', `severity=${normalizedSeverity} reason=${reason}`);
  notify(officerActorId, 'Mandado emitido.');
  notify(targetActorId, 'Um mandado foi emitido contra voce.');
  panelRefreshBus.requestRefresh(targetActorId, 'governance');
}

/**
 * Para onde vai o ouro da multa.
 *
 * A instituição que deu ao guarda o poder de multar é a que recebe: o `source`
 * devolvido por `hasPermission` é a linha de `governance_memberships` que
 * autorizou a ação, e `scope_type`/`scope_id` dela mapeiam direto nos titulares
 * `city`, `realm` e `faction` do `core/economy-service.js`.
 *
 * O caso `staff` não tem escopo — um governador de staff age sem cargo IC. Ali
 * o ouro é **destruído**, contra `system:staff_fine`. Isso é o que já acontecia
 * para *todas* as multas antes desta mudança (`removeGold` sem contraparte
 * nenhuma); a diferença é que agora está declarado e tem linha de ledger, em
 * vez de o septim sumir sem registro.
 */
function fineCreditor(permissionSource) {
  const membership = permissionSource;
  if (!membership || membership === 'staff') {
    return { type: 'system', ref: 'staff_fine' };
  }
  if (!membership.scope_type || !membership.scope_id) {
    return { type: 'system', ref: 'staff_fine' };
  }
  return { type: membership.scope_type, ref: String(membership.scope_id) };
}

/**
 * Multa da guarda.
 *
 * ─── O que mudou, e por que ────────────────────────────────────────────────
 *
 * A versão anterior era o Achado 8 de `ECONOMY_FRAMEWORK_AUDIT.md`:
 *
 *   1. **Não era atômica.** `removeGold` commitava sozinho e o `INSERT INTO
 *      fines` era outra transação. Um crash entre as duas deixava o jogador
 *      pago e sem registro de multa.
 *   2. **`false` significava três coisas.** `removeGold` devolvia `false` tanto
 *      para "não tem ouro" quanto para "o banco caiu". Como o ramo `!paid`
 *      emite **mandado de prisão**, um timeout de rede produzia um mandado
 *      contra alguém que tinha o dinheiro — material de cena Heavy RP nascido
 *      de infraestrutura.
 *   3. **A "dívida" não era dívida.** A linha `fines.status = 'unpaid'` não
 *      tinha caminho de pagamento, credor, amortização nem quitação, e o texto
 *      dizia ao jogador que era dívida.
 *
 * Agora: uma transação só; o `economy-service` distingue recusa de falha (falha
 * **lança** e cai no `catch`, sem multa e sem mandado); e a inadimplência abre
 * uma dívida de verdade no `debt-service`, com credor institucional.
 */
async function fineTarget(officerActorId, targetActorId, amount, reason = 'multa') {
  const permissao = await requirePermission(officerActorId, PERMISSIONS.GUARD_FINE);
  if (!permissao) return;
  const range = assertRange(officerActorId, targetActorId, DEFAULT_RANGE);
  if (!range.ok) {
    notify(officerActorId, range.reason);
    return;
  }
  const officer = getCharacter(officerActorId);
  const target = getCharacter(targetActorId);
  if (!officer || !target) return;
  const fine = parsePositiveInt(amount, 0);
  if (fine <= 0) {
    notify(officerActorId, 'Valor de multa invalido.');
    return;
  }

  const creditor = fineCreditor(permissao.source);
  const requestKey = `fine-${officer.characterId}-${target.characterId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let paid = false;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const cobranca = await economyService.transferInTransaction(conn, {
      from: { type: 'character', ref: target.characterId },
      to: creditor,
      amount: fine,
      reason: 'guard_fine',
      module: MODULE,
      actorCharacterId: officer.characterId,
      idempotencyKey: requestKey
    });

    // `insufficient_funds` é a única recusa que vira dívida: é o caso de RP.
    // Qualquer outro código é erro de programação ou de dado (conta inexistente,
    // valor inválido) e não pode virar multa nem mandado.
    if (!cobranca.ok && cobranca.code !== 'insufficient_funds') {
      await conn.rollback();
      console.error(`[governance] multa recusada (${cobranca.code}) officer=${officer.characterId} alvo=${target.characterId}`);
      notify(officerActorId, 'Nao foi possivel registrar a multa.');
      return;
    }
    paid = cobranca.ok === true;

    await conn.query(
      `INSERT INTO fines (target_character_id, officer_character_id, amount, reason, status, paid_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [target.characterId, officer.characterId, fine, reason, paid ? 'paid' : 'unpaid', paid ? new Date() : null]
    );

    if (!paid) {
      await debtService.open({
        debtorCharacterId: target.characterId,
        creditor,
        amount: fine,
        reason: `Multa nao paga: ${reason}`.slice(0, 255),
        originType: 'fine',
        originRef: String(officer.characterId),
        idempotencyKey: `${requestKey}~debt`
      }, { conn });

      await conn.query(
        `INSERT INTO warrants (target_character_id, issued_by_character_id, severity, reason, scope_type, scope_id)
         VALUES (?, ?, 'minor', ?, ?, ?)`,
        [target.characterId, officer.characterId, `Multa nao paga: ${reason}`, SCOPE.CITY, 'global']
      );
    }

    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* preserva o erro original */ }
    // Falha de infraestrutura NAO vira multa, NAO vira divida e NAO vira
    // mandado. É o inverso exato do comportamento antigo.
    console.error(`[governance] multa falhou (officer=${officer.characterId} alvo=${target.characterId}):`, err.message);
    notify(officerActorId, 'Nao foi possivel registrar a multa. Nada foi alterado.');
    return;
  } finally {
    conn.release();
  }

  await audit(officerActorId, targetActorId, 'guard:fine', `amount=${fine} reason=${reason} paid=${paid} creditor=${creditor.type}:${creditor.ref}`);
  notify(officerActorId, paid ? 'Multa paga e registrada.' : 'Multa registrada como divida; mandado menor criado.');
  notify(targetActorId, paid ? `Voce pagou multa de ${fine} septims.` : `Multa de ${fine} septims registrada como divida.`);
  panelRefreshBus.requestRefresh(targetActorId, 'governance');
  panelRefreshBus.requestRefresh(targetActorId, 'status');
}

async function confiscateItem(officerActorId, targetActorId, baseId, count, reason = 'confisco') {
  if (!await requirePermission(officerActorId, PERMISSIONS.GUARD_CONFISCATE)) return;
  const range = assertRange(officerActorId, targetActorId, DEFAULT_RANGE);
  if (!range.ok) {
    notify(officerActorId, range.reason);
    return;
  }
  const officer = getCharacter(officerActorId);
  const target = getCharacter(targetActorId);
  if (!officer || !target) return;
  const itemId = Number.parseInt(String(baseId), String(baseId).startsWith('0x') ? 16 : 10);
  const amount = parsePositiveInt(count, 1);
  if (!Number.isFinite(itemId)) {
    notify(officerActorId, 'Item invalido.');
    return;
  }
  const removed = await inventory.removeItem(targetActorId, target.characterId, itemId, amount, 'guard_confiscate', MODULE);
  if (!removed) {
    notify(officerActorId, 'O alvo nao possui esse item em quantidade suficiente no banco.');
    return;
  }

  // Evidencia (Tarefa 13, §4): se este item era uma instancia rastreada
  // (roubado), ela perde 'hot' mas continua 'stolen' — nunca vira 'clean' por
  // confisco sozinho. A maioria dos confiscos e de item comum, sem instancia
  // nenhuma (`no_instance`), e isso nao e erro.
  let itemInstanceId = null;
  if (moduleRegistry.isEnabled('crime')) {
    try {
      const marked = await crimeService.markItemConfiscated({ characterId: target.characterId, baseId: itemId });
      if (marked.ok) itemInstanceId = marked.data.instanceId;
    } catch (err) {
      console.error('[governance] falha ao marcar instancia confiscada:', err.message);
    }
  }

  await db.query(
    `INSERT INTO confiscations (target_character_id, officer_character_id, base_id, count, reason, item_instance_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [target.characterId, officer.characterId, itemId, amount, reason, itemInstanceId]
  );
  await audit(officerActorId, targetActorId, 'guard:confiscate', `baseId=0x${itemId.toString(16)} count=${amount} reason=${reason}`);
  notify(officerActorId, 'Item confiscado e registrado como evidencia.');
  notify(targetActorId, 'Um item foi confiscado pela guarda.');
}

async function arrestTarget(officerActorId, targetActorId, sentenceMinutes, crimeSummary) {
  if (!await requirePermission(officerActorId, PERMISSIONS.GUARD_ARREST)) return;
  const range = assertRange(officerActorId, targetActorId, ESCORT_RANGE);
  if (!range.ok) {
    notify(officerActorId, range.reason);
    return;
  }
  const officer = getCharacter(officerActorId);
  const target = getCharacter(targetActorId);
  if (!officer || !target) return;

  const warrant = await hasActiveWarrant(target.characterId);
  const detentions = await db.query(
    `SELECT id FROM guard_detentions
     WHERE target_character_id = ? AND status IN ('stopped', 'detained', 'escorted')
     ORDER BY created_at DESC LIMIT 1`,
    [target.characterId]
  );
  if (!warrant && detentions.length === 0) {
    notify(officerActorId, 'Prenda apenas alvo detido ou com mandado ativo.');
    return;
  }

  const minutes = Math.min(parsePositiveInt(sentenceMinutes, 10), 180);
  const crime = crimeSummary || warrant?.reason || 'Crime nao especificado';
  const prison = await getDefaultPrison();

  await db.query(
    `INSERT INTO prison_records (character_id, arrested_by_character_id, crime_summary, sentence_minutes, cell_id)
     VALUES (?, ?, ?, ?, ?)`,
    [target.characterId, officer.characterId, crime, minutes, prison.cellId]
  );
  await db.query(
    `INSERT INTO custody_records (target_character_id, officer_character_id, status, sentence_minutes, crime_summary)
     VALUES (?, ?, 'jailed', ?, ?)`,
    [target.characterId, officer.characterId, minutes, crime]
  );
  await db.query('UPDATE warrants SET status = ? WHERE target_character_id = ? AND status = ?', ['served', target.characterId, 'active']);
  await db.query('DELETE FROM character_restraints WHERE character_id = ?', [target.characterId]);
  characterState.set(target.characterId, STATES.IMPRISONED, { sentenceMinutes: minutes, crimeSummary: crime });

  if (typeof mp !== 'undefined') {
    mp.set(targetActorId, 'locationalData', {
      pos: prison.pos,
      rot: [0, 0, 0],
      cellOrWorldDesc: prison.cellId
    });
    mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', actorRef(targetActorId), ['SpeedMult', 100]);
  }

  await audit(officerActorId, targetActorId, 'guard:arrest', `sentence=${minutes} crime=${crime}`);
  notify(officerActorId, 'Prisao registrada.');
  notify(targetActorId, `Voce foi preso por ${minutes} minutos. Crime: ${crime}`);
  panelRefreshBus.requestRefresh(targetActorId, 'governance');
  panelRefreshBus.requestRefresh(targetActorId, 'status');
}

async function getDefaultPrison() {
  const rows = await db.query(
    `SELECT prison_cell_id, prison_pos_x, prison_pos_y, prison_pos_z
     FROM cities
     WHERE prison_cell_id IS NOT NULL
     ORDER BY id
     LIMIT 1`
  );
  if (rows.length === 0) {
    return { cellId: '0x162e2', pos: [35, -165, -189] };
  }
  return {
    cellId: rows[0].prison_cell_id,
    pos: [rows[0].prison_pos_x || 35, rows[0].prison_pos_y || -165, rows[0].prison_pos_z || -189]
  };
}

async function releaseExpiredPrisoners() {
  const rows = await db.query(
    `SELECT id, character_id, sentence_minutes, arrested_at
     FROM prison_records
     WHERE status = 'active'`
  );
  for (const row of rows) {
    const elapsed = Math.floor((Date.now() - new Date(row.arrested_at).getTime()) / 60000);
    await db.query('UPDATE prison_records SET time_served_minutes = ? WHERE id = ?', [elapsed, row.id]);
    if (elapsed < row.sentence_minutes) continue;
    await db.query('UPDATE prison_records SET status = ?, released_at = NOW() WHERE id = ?', ['released', row.id]);
    await db.query(
      `UPDATE custody_records SET status = 'released', released_at = NOW()
       WHERE target_character_id = ? AND status = 'jailed'`,
      [row.character_id]
    );

    // Sem isso o jogador fica permanentemente IMPRISONED na memória (character-state
    // é um cache separado do DB) mesmo com a pena já expirada no banco — bloqueado por
    // core/action-policy.js até reconectar. Libera o estado e a velocidade se online.
    characterState.set(row.character_id, STATES.NORMAL, {});
    const releasedActorId = commands.getActiveActorByCharacterId(row.character_id);
    if (releasedActorId) {
      if (typeof mp !== 'undefined') {
        mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', actorRef(releasedActorId), ['SpeedMult', 100]);
      }
      notify(releasedActorId, 'Voce cumpriu sua pena e foi libertado.');
      panelRefreshBus.requestRefresh(releasedActorId, 'status');
    }
  }
}


async function showCriminalRecord(actorId, targetActorId) {
  if (!await requirePermission(actorId, PERMISSIONS.VIEW_RECORDS)) return;
  const target = getCharacter(targetActorId);
  if (!target) return;
  const records = await db.query(
    `SELECT crime, bounty, hold, resolved, created_at
     FROM criminal_records
     WHERE character_id = ?
     ORDER BY created_at DESC LIMIT 8`,
    [target.characterId]
  );
  const warrants = await db.query(
    `SELECT severity, reason, status
     FROM warrants
     WHERE target_character_id = ?
     ORDER BY created_at DESC LIMIT 5`,
    [target.characterId]
  );
  const summary = [
    ...records.map(r => `[${r.resolved ? 'resolvido' : 'ativo'}] ${r.crime} ${r.bounty}g ${r.hold}`),
    ...warrants.map(w => `[mandado:${w.status}] ${w.severity} ${w.reason}`)
  ].join(' | ') || 'Ficha limpa.';
  notify(actorId, summary);
}

/**
 * Resumo de governança do próprio personagem, para o painel do jogador.
 * Não altera nenhum estado — apenas leitura.
 * @param {number} actorId
 * @returns {Promise<object|null>}
 */
async function getMyGovernanceSummary(actorId) {
  const character = getCharacter(actorId);
  if (!character) return null;

  const [memberships, warrant, recentFines, recentCrimes] = await Promise.all([
    db.query(
      `SELECT gm.scope_type, gm.scope_id, gm.on_duty, gr.name AS role_name, gr.label, gr.weight
       FROM governance_memberships gm
       INNER JOIN governance_roles gr ON gr.id = gm.role_id
       WHERE gm.character_id = ? AND gm.status = 'active'
       ORDER BY gr.weight DESC`,
      [character.characterId]
    ).catch(() => []),
    hasActiveWarrant(character.characterId),
    db.query(
      `SELECT amount, reason, created_at FROM fines WHERE target_character_id = ? ORDER BY created_at DESC LIMIT 5`,
      [character.characterId]
    ).catch(() => []),
    db.query(
      `SELECT crime, bounty, hold, resolved, created_at FROM criminal_records WHERE character_id = ? ORDER BY created_at DESC LIMIT 5`,
      [character.characterId]
    ).catch(() => [])
  ]);

  return {
    memberships: memberships.map(m => ({
      scopeType: m.scope_type,
      scopeId: m.scope_id,
      role: m.role_name,
      label: m.label,
      onDuty: Boolean(m.on_duty)
    })),
    activeWarrant: warrant ? { severity: warrant.severity, reason: warrant.reason, status: warrant.status } : null,
    recentFines: recentFines.map(f => ({ amount: f.amount, reason: f.reason, at: f.created_at })),
    recentCrimes: recentCrimes.map(c => ({
      crime: c.crime, bounty: c.bounty, hold: c.hold, resolved: Boolean(c.resolved), at: c.created_at
    }))
  };
}

async function setTax(actorId, scopeType, scopeId, rateRaw) {
  if (!await requirePermission(actorId, PERMISSIONS.MANAGE_TAXES, { scopeType, scopeId })) return;
  const rate = Number.parseFloat(rateRaw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.35) {
    notify(actorId, 'Imposto invalido. Use valor entre 0 e 0.35.');
    return;
  }
  if (scopeType === SCOPE.CITY) {
    await db.query('UPDATE cities SET tax_rate = ? WHERE id = ?', [rate, scopeId]);
  } else if (scopeType === SCOPE.REALM) {
    await db.query('UPDATE realms SET tax_rate = ? WHERE id = ?', [rate, scopeId]);
  } else {
    notify(actorId, 'Impostos so existem em cidade ou reino.');
    return;
  }
  await audit(actorId, null, 'tax:set', `scope=${scopeType}:${scopeId} rate=${rate}`);
  notify(actorId, 'Imposto atualizado.');
}

async function registerShop(actorId, cityId, shopId, name, ownerActorRaw) {
  if (!await requirePermission(actorId, PERMISSIONS.MANAGE_SHOPS, { scopeType: SCOPE.CITY, scopeId: cityId })) return;
  const ownerActorId = ownerActorRaw ? parseActorId(ownerActorRaw) : actorId;
  const owner = getCharacter(ownerActorId);
  if (!owner) {
    notify(actorId, 'Dono da loja nao encontrado.');
    return;
  }
  await db.query(
    `INSERT INTO shops (id, city_id, owner_character_id, name, status)
     VALUES (?, ?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE city_id = VALUES(city_id), owner_character_id = VALUES(owner_character_id), name = VALUES(name)`,
    [shopId, cityId, owner.characterId, name]
  );
  await audit(actorId, ownerActorId, 'shop:register', `shop=${shopId} city=${cityId} name=${name}`);
  notify(actorId, 'Loja registrada.');
}

async function createEvent(actorId, scopeType, scopeId, eventType, title) {
  if (!await requirePermission(actorId, PERMISSIONS.MANAGE_EVENTS, { scopeType, scopeId })) return;
  await db.query(
    `INSERT INTO governance_events (scope_type, scope_id, event_type, title, status, created_by_character_id)
     VALUES (?, ?, ?, ?, 'scheduled', ?)`,
    [scopeType, String(scopeId), eventType, title, getCharacter(actorId)?.characterId || null]
  );
  await audit(actorId, null, 'event:create', `scope=${scopeType}:${scopeId} type=${eventType} title=${title}`);
  notify(actorId, 'Evento registrado.');
}

function commandDefs() {
  return [
    {
      name: '/realmcreate',
      description: '[Gov] Cria reino',
      usage: '/realmcreate <id> <nome>',
      handler: (actorId, args) => {
        const [id, ...name] = args.split(' ');
        createRealm(actorId, id, name.join(' '));
      }
    },
    {
      name: '/citycreate',
      description: '[Gov] Cria cidade',
      usage: '/citycreate <id> <realmId> <holdId> <nome>',
      handler: (actorId, args) => {
        const [id, realmId, holdId, ...name] = args.split(' ');
        createCity(actorId, id, realmId, holdId, name.join(' '));
      }
    },
    {
      name: '/govfcreate',
      description: '[Gov] Cria faccao',
      usage: '/govfcreate <tag> <nome>',
      handler: (actorId, args) => {
        const [tag, ...name] = args.split(' ');
        createFaction(actorId, tag, name.join(' '));
      }
    },
    {
      name: '/govadd',
      description: '[Gov] Adiciona membro a escopo',
      usage: '/govadd <actorId> <realm|city|faction> <scopeId> <role>',
      handler: (actorId, args) => {
        const [target, scopeType, scopeId, roleName = 'member'] = args.split(' ');
        addMember(actorId, parseActorId(target), scopeType, scopeId, roleName);
      }
    },
    {
      name: ['/guardduty', '/servico'],
      description: '[Guarda] Liga/desliga servico',
      usage: '/guardduty on|off',
      handler: (actorId, args) => setDuty(actorId, String(args).trim().toLowerCase() !== 'off')
    },
    {
      name: '/guardstop',
      description: '[Guarda] Aborda jogador',
      usage: '/guardstop <actorId> <motivo>',
      handler: (actorId, args) => {
        const [target, ...reason] = args.split(' ');
        stopTarget(actorId, parseActorId(target), reason.join(' ') || 'abordagem');
      }
    },
    {
      name: '/detain',
      description: '[Guarda] Detem jogador',
      usage: '/detain <actorId> <motivo>',
      handler: (actorId, args) => {
        const [target, ...reason] = args.split(' ');
        detainTarget(actorId, parseActorId(target), reason.join(' ') || 'detencao');
      }
    },
    {
      name: '/release',
      description: '[Guarda] Libera jogador',
      usage: '/release <actorId>',
      handler: (actorId, args) => releaseTarget(actorId, parseActorId(args.trim()))
    },
    {
      name: '/search',
      description: '[Guarda] Solicita ou executa revista',
      usage: '/search <actorId> <motivo>',
      handler: (actorId, args) => {
        const [target, ...reason] = args.split(' ');
        requestSearch(actorId, parseActorId(target), reason.join(' ') || 'revista');
      }
    },
    {
      name: '/searchaccept',
      description: 'Aceita revista',
      usage: '/searchaccept <id>',
      handler: (actorId, args) => approveSearch(actorId, parsePositiveInt(args, 0), true)
    },
    {
      name: '/searchdeny',
      description: 'Recusa revista',
      usage: '/searchdeny <id>',
      handler: (actorId, args) => approveSearch(actorId, parsePositiveInt(args, 0), false)
    },
    {
      name: '/warrant',
      description: '[Guarda] Emite mandado',
      usage: '/warrant <actorId> <minor|serious|major|capital> <motivo>',
      handler: (actorId, args) => {
        const [target, severity, ...reason] = args.split(' ');
        issueWarrant(actorId, parseActorId(target), severity, reason.join(' '));
      }
    },
    {
      name: '/fine',
      description: '[Guarda] Aplica multa',
      usage: '/fine <actorId> <valor> <motivo>',
      handler: (actorId, args) => {
        const [target, amount, ...reason] = args.split(' ');
        fineTarget(actorId, parseActorId(target), amount, reason.join(' ') || 'multa');
      }
    },
    {
      name: '/arrest',
      description: '[Guarda] Prende jogador',
      usage: '/arrest <actorId> <minutos> <crime>',
      handler: (actorId, args) => {
        const [target, minutes, ...crime] = args.split(' ');
        arrestTarget(actorId, parseActorId(target), minutes, crime.join(' ') || 'crime');
      }
    },
    {
      name: '/confiscate',
      description: '[Guarda] Confisca item',
      usage: '/confiscate <actorId> <baseId> <count> <motivo>',
      handler: (actorId, args) => {
        const [target, baseId, count, ...reason] = args.split(' ');
        confiscateItem(actorId, parseActorId(target), baseId, count, reason.join(' ') || 'confisco');
      }
    },
    {
      name: '/record',
      description: '[Guarda] Ve ficha criminal',
      usage: '/record <actorId>',
      handler: (actorId, args) => showCriminalRecord(actorId, parseActorId(args.trim()))
    },
    {
      name: '/taxset',
      description: '[Gov] Define imposto',
      usage: '/taxset <realm|city> <scopeId> <rate>',
      handler: (actorId, args) => {
        const [scopeType, scopeId, rate] = args.split(' ');
        setTax(actorId, scopeType, scopeId, rate);
      }
    },
    {
      name: '/shopregister',
      description: '[Gov] Registra loja',
      usage: '/shopregister <cityId> <shopId> <ownerActorId> <nome>',
      handler: (actorId, args) => {
        const [cityId, shopId, ownerActor, ...name] = args.split(' ');
        registerShop(actorId, cityId, shopId, name.join(' '), ownerActor);
      }
    },
    {
      name: '/govevent',
      description: '[Gov] Cria evento',
      usage: '/govevent <realm|city|faction> <scopeId> <type> <titulo>',
      handler: (actorId, args) => {
        const [scopeType, scopeId, type, ...title] = args.split(' ');
        createEvent(actorId, scopeType, scopeId, type, title.join(' '));
      }
    }
  ];
}

/**
 * Declara as ações da guarda no Interaction Framework.
 *
 * ─── Por que isto vive aqui, e não no core ──────────────────────────────────
 *
 * Antes, para uma barraca aparecer no menu de interação, este arquivo precisava
 * `require('./market-stalls-service')` por nome fixo dentro de
 * `getInteractionActions` — e `market-stalls` já declara `dependencies:
 * ['governance']` no registry, então a seta apontava para os dois lados. A
 * governança tinha virado o lugar onde todo módulo com menu de interação
 * precisava se anunciar (`CORE_FRAMEWORK_AUDIT.md` §6.1).
 *
 * Aqui a governança declara **só o que é dela**. Barraca é do
 * `market-stalls-service`; `identity.introduce` será do módulo de identidade.
 * Ninguém mais edita este arquivo para existir num menu.
 *
 * ─── O que muda em relação ao caminho antigo, e o que não muda ──────────────
 *
 * **Não muda a autoridade.** Cada `execute` abaixo chama a mesma função de
 * domínio de sempre (`stopTarget`, `fineTarget`, …), e cada uma delas
 * revalida permissão e alcance por conta própria. Isso é redundante de
 * propósito: se um dia alguém chamar `fineTarget` por um caminho que não seja
 * este, a checagem continua lá.
 *
 * **Muda a distância no `canSee`.** O menu antigo listava por permissão e mais
 * nada, então um guarda via "Prender" no menu de alguém do outro lado do mapa e
 * só descobria a recusa ao clicar. `distance` no descritor faz o pipeline
 * medir antes de mostrar.
 *
 * **Muda a idempotência de multa e confisco.** As duas movem ouro ou item e
 * eram vulneráveis a duplo clique — o `requestId` era validado no formato e
 * jogado fora (§6.4 da auditoria). `idempotent: true` liga a deduplicação.
 */
function registerGuardInteractions() {
  // Reinicializar o serviço re-declara o conjunto **deste** módulo, em vez de
  // colidir com o que ele mesmo registrou antes. Ids de outro módulo continuam
  // protegidos: `unregisterModule` só remove os próprios.
  interactionRegistry.unregisterModule(MODULE);

  /** `canSee` de uma ação de guarda: o cargo IC decide, não o staff tier. */
  const podeGuarda = permission => async ctx => {
    const check = await hasPermission(ctx.actorId, permission);
    return { allowed: check.allowed, reason: check.reason || 'Voce nao tem autorizacao para isso.' };
  };

  const motivo = (label, placeholder) => ({
    reason: { type: 'string', label, max: MAX_UI_REASON_LENGTH, placeholder }
  });

  const acoes = [
    {
      id: 'law.stop', label: 'Abordar', order: 10, distance: DEFAULT_RANGE,
      permission: PERMISSIONS.GUARD_DETAIN, audit: 'SECURITY',
      schema: motivo('Motivo', 'Ex: verificacao de identidade'),
      execute: ctx => stopTarget(ctx.actorId, ctx.target.actorId, ctx.data.reason || 'abordagem')
    },
    {
      id: 'law.search', label: 'Revistar', order: 20, distance: SEARCH_RANGE,
      permission: PERMISSIONS.GUARD_SEARCH, audit: 'SECURITY',
      schema: motivo('Motivo', 'Ex: suspeita de contrabando'),
      execute: ctx => requestSearch(ctx.actorId, ctx.target.actorId, ctx.data.reason || 'revista')
    },
    {
      id: 'law.records', label: 'Ver ficha', order: 30, distance: DEFAULT_RANGE,
      permission: PERMISSIONS.VIEW_RECORDS, audit: 'SECURITY',
      execute: ctx => showCriminalRecord(ctx.actorId, ctx.target.actorId)
    },
    {
      id: 'law.fine', label: 'Aplicar multa', order: 40, distance: DEFAULT_RANGE,
      permission: PERMISSIONS.GUARD_FINE, audit: 'ECONOMY', idempotent: true,
      schema: {
        amount: { type: 'int', label: 'Valor', min: 1, max: 100000, required: true, placeholder: '150' },
        ...motivo('Motivo', 'Ex: desordem publica')
      },
      execute: ctx => fineTarget(ctx.actorId, ctx.target.actorId, ctx.data.amount, ctx.data.reason || 'multa')
    },
    {
      id: 'law.detain', label: 'Deter', order: 50, distance: DEFAULT_RANGE,
      permission: PERMISSIONS.GUARD_DETAIN, audit: 'SECURITY',
      schema: motivo('Motivo', 'Ex: resistencia a abordagem'),
      execute: ctx => detainTarget(ctx.actorId, ctx.target.actorId, ctx.data.reason || 'detencao')
    },
    {
      // O alcance é o de escolta, não o de abordagem: prender exige estar do
      // lado, e `arrestTarget` já usava `ESCORT_RANGE` internamente. O menu
      // antigo mostrava a ação com o alcance de todas as outras.
      id: 'law.arrest', label: 'Prender', order: 60, distance: ESCORT_RANGE,
      permission: PERMISSIONS.GUARD_ARREST, audit: 'SECURITY', idempotent: true,
      schema: {
        sentenceMinutes: { type: 'int', label: 'Pena em minutos', min: 1, max: 180, default: 10 },
        ...motivo('Crime', 'Ex: roubo e resistencia')
      },
      execute: ctx => arrestTarget(ctx.actorId, ctx.target.actorId, ctx.data.sentenceMinutes, ctx.data.reason || 'prisao')
    },
    {
      id: 'law.confiscate', label: 'Confiscar item', order: 70, distance: DEFAULT_RANGE,
      permission: PERMISSIONS.GUARD_CONFISCATE, audit: 'ECONOMY', idempotent: true,
      schema: {
        baseId: { type: 'formid', label: 'FormID do item', required: true, placeholder: '0x0000000F' },
        count: { type: 'int', label: 'Quantidade', min: 1, default: 1 },
        ...motivo('Motivo', 'Ex: item ilegal')
      },
      execute: ctx => confiscateItem(ctx.actorId, ctx.target.actorId, ctx.data.baseId, ctx.data.count, ctx.data.reason || 'confisco')
    },
    {
      id: 'law.release', label: 'Liberar', order: 80, distance: DEFAULT_RANGE,
      permission: PERMISSIONS.GUARD_RELEASE, audit: 'SECURITY',
      schema: motivo('Motivo', 'Ex: sem irregularidades'),
      execute: ctx => releaseTarget(ctx.actorId, ctx.target.actorId, ctx.data.reason || 'liberado')
    }
  ];

  for (const acao of acoes) {
    interactionRegistry.register({
      module: MODULE,
      target: interactionRegistry.TARGET_TYPES.PLAYER,
      section: 'guarda',
      // A permissão fica no `canSee` e NÃO em `descriptor.permission`: aquele
      // campo cai no verificador injetado no core, que consulta `admin-service`
      // (staff tier). Cargo de guarda depende de escopo e de plantão, e quem
      // sabe disso é este arquivo.
      canSee: podeGuarda(acao.permission),
      ...acao,
      permission: undefined
    });
  }
}

async function initGovernanceService() {
  actionPolicy.registerAction('guard_stop', ['gameplay'], 'Abordar pela guarda');
  actionPolicy.registerAction('guard_search', ['gameplay'], 'Revistar pela guarda');
  actionPolicy.registerAction('guard_detain', ['gameplay'], 'Deter pela guarda');
  actionPolicy.registerAction('guard_arrest', ['gameplay'], 'Prender pela guarda');
  actionPolicy.registerAction('governance_manage', ['gameplay'], 'Gerenciar governo');
  registerGuardInteractions();
  await ensureDefaultRolesForExistingScopes();
  initialized = true;
  if (!sentenceTimer) {
    sentenceTimer = setInterval(() => {
      releaseExpiredPrisoners().catch(err => console.error('[governance] sentence tick failed:', err.message));
    }, 60 * 1000);
  }
  await releaseExpiredPrisoners();
  console.log('[governance] Governance service initialized.');
}

function shutdownGovernanceService() {
  if (sentenceTimer) clearInterval(sentenceTimer);
  sentenceTimer = null;
  initialized = false;
}

module.exports = {
  SCOPE,
  PERMISSIONS,
  commandDefs,
  initGovernanceService,
  shutdownGovernanceService,
  getMyGovernanceSummary,
  getMembership,
  hasPermission,
  createRealm,
  createCity,
  createFaction,
  addMember,
  setDuty,
  stopTarget,
  detainTarget,
  releaseTarget,
  requestSearch,
  approveSearch,
  issueWarrant,
  fineTarget,
  confiscateItem,
  arrestTarget,
  setTax,
  registerShop,
  createEvent
};

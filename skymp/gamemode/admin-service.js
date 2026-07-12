/**
 * admin-service.js
 * Comandos de Staff com auditoria obrigatória.
 *
 * IMPORTANTE: A autoridade de staff é derivada EXCLUSIVAMENTE da tabela `staff_roles`.
 * O campo `vip_level` em `accounts` é SOMENTE para monetização (VIP/Apoiador).
 * NUNCA usar vip_level como critério de permissão administrativa.
 */
const db = require('./database');
const commands = require('./commands');

// Roles e permissões por nível
const ROLE_PERMISSIONS = {
  moderator: ['kick', 'teleport', 'view_audit', 'manage_whitelist'],
  admin:     ['kick', 'teleport', 'view_audit', 'manage_whitelist', 'ban', 'add_item', 'set_gold'],
  owner:     ['kick', 'teleport', 'view_audit', 'manage_whitelist', 'ban', 'add_item', 'set_gold', 'manage_staff']
};

// Cache em memória: actorId → { role, permissions: Set<string> }
// Carregado na whitelist a partir da tabela staff_roles (não de vip_level)
const staffCache = new Map();

/**
 * Carrega o cargo de staff de uma conta a partir do banco.
 * Chamado no login pelo whitelist.js.
 *
 * @param {number} actorId
 * @param {number} accountId - ID da conta (não o vip_level!)
 */
async function registerStaffRole(actorId, accountId) {
  try {
    const rows = await db.query(
      `SELECT role FROM staff_roles WHERE account_id = ?`,
      [accountId]
    );

    if (rows.length === 0) {
      // Conta não tem cargo de staff
      return;
    }

    const role = rows[0].role;
    const permissions = new Set(ROLE_PERMISSIONS[role] || []);
    staffCache.set(actorId, { role, permissions });
    console.log(`[admin] Actor ${actorId.toString(16)} registrado como staff (role: ${role}, permissões: ${[...permissions].join(', ')})`);
  } catch (err) {
    console.error(`[admin] Erro ao carregar cargo de staff para account ${accountId}:`, err.message);
  }
}

/**
 * Remove o cache de staff ao desconectar.
 * @param {number} actorId
 */
function removeStaffRole(actorId) {
  staffCache.delete(actorId);
}

/**
 * Verifica se um ator tem uma permissão específica.
 * @param {number} actorId
 * @param {string} permission - 'kick', 'ban', 'teleport', 'add_item', 'set_gold', etc.
 * @returns {boolean}
 */
function hasPermission(actorId, permission) {
  const staff = staffCache.get(actorId);
  if (!staff) return false;
  return staff.permissions.has(permission);
}

/**
 * Retorna o cargo de staff de um ator, ou null se não for staff.
 * @param {number} actorId
 * @returns {string|null}
 */
function getRole(actorId) {
  const staff = staffCache.get(actorId);
  return staff ? staff.role : null;
}

/**
 * Registra uma ação de staff no audit_log.
 */
async function auditLog(actorAccountId, targetAccountId, action, details) {
  try {
    await db.query(
      'INSERT INTO audit_logs (action, actor_account_id, target_account_id, details) VALUES (?, ?, ?, ?)',
      [action, actorAccountId, targetAccountId || null, details || null]
    );
  } catch (err) {
    console.error('[admin] Failed to write audit_log:', err.message);
  }
}

/**
 * /anim [actorId] [animName] - Reproduz animação em ator (para eventos RP)
 * Permissão: 'teleport' (nível moderador+)
 */
async function playAnimation(actorId, targetActorId, animName) {
  if (!hasPermission(actorId, 'teleport')) {
    sendDenied(actorId);
    return;
  }
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('method', 'Actor', 'PlayIdle', targetActorId, [animName]);
  }
  const charData = commands.getActiveCharacterData(actorId);
  const targetData = commands.getActiveCharacterData(targetActorId);
  await auditLog(
    charData?.accountId, targetData?.accountId,
    'staff:playAnimation',
    `role=${getRole(actorId)} anim=${animName} target=${targetActorId.toString(16)}`
  );
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) played animation '${animName}' on ${targetActorId.toString(16)}`);
}

/**
 * /additem [actorId] [baseId] [count] - Entrega item a jogador (eventos, testes)
 * Permissão: 'add_item' (nível admin+)
 */
async function giveItemAdmin(actorId, targetActorId, baseId, count) {
  if (!hasPermission(actorId, 'add_item')) {
    sendDenied(actorId);
    return;
  }
  const transactionService = require('./core/transaction-service');
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) {
    sendDenied(actorId);
    return;
  }

  const success = await transactionService.giveItem({
    actorId: targetActorId,
    characterId: targetChar.characterId,
    baseId,
    count,
    reason: 'admin_give',
    module: 'admin'
  });

  if (!success) {
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['[Staff] Falha ao entregar item.']);
    }
    return;
  }

  const charData = commands.getActiveCharacterData(actorId);
  await auditLog(
    charData?.accountId, targetChar.accountId,
    'staff:addItem',
    `role=${getRole(actorId)} baseId=0x${baseId.toString(16)} count=${count}`
  );
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) gave 0x${baseId.toString(16)} x${count} to ${targetActorId.toString(16)}`);
}

/**
 * /tp [actorId] - Teleporta para jogador
 * Permissão: 'teleport'
 */
async function teleportTo(actorId, targetActorId) {
  if (!hasPermission(actorId, 'teleport')) {
    sendDenied(actorId);
    return;
  }
  if (typeof mp !== 'undefined') {
    const targetPos = mp.get(targetActorId, 'locationalData');
    if (targetPos) {
      mp.set(actorId, 'locationalData', targetPos);
    }
  }
  const charData = commands.getActiveCharacterData(actorId);
  await auditLog(charData?.accountId, null, 'staff:teleport', `role=${getRole(actorId)} target=${targetActorId.toString(16)}`);
}

/**
 * /kick [actorId] [motivo] - Expulsa jogador com motivo e audit
 * Permissão: 'kick'
 */
async function kickPlayer(actorId, targetActorId, reason) {
  if (!hasPermission(actorId, 'kick')) {
    sendDenied(actorId);
    return;
  }
  const charData = commands.getActiveCharacterData(actorId);
  const targetData = commands.getActiveCharacterData(targetActorId);
  await auditLog(charData?.accountId, targetData?.accountId, 'staff:kick', `role=${getRole(actorId)} reason=${reason}`);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você foi expulso: ${reason}`]);
    setTimeout(() => {
      if (typeof mp !== 'undefined') mp.kick(targetActorId);
    }, 3000);
  }
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) kicked ${targetActorId.toString(16)}: ${reason}`);
}

/**
 * /setgold [actorId] [valor] - Define ouro de um jogador
 * Permissão: 'set_gold' (nível admin+)
 */
async function setGold(actorId, targetActorId, amount) {
  if (!hasPermission(actorId, 'set_gold')) {
    sendDenied(actorId);
    return;
  }
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  await db.query('UPDATE characters SET gold = ? WHERE id = ?', [amount, targetChar.characterId]);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`[Staff] Ouro definido para ${amount} Septims.`]);
  }
  const charData = commands.getActiveCharacterData(actorId);
  await auditLog(charData?.accountId, targetChar.accountId, 'staff:setGold', `role=${getRole(actorId)} amount=${amount}`);
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) set gold=${amount} for char ${targetChar.characterId}`);
}

function sendDenied(actorId) {
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['[Staff] Permissão negada.']);
  }
}

module.exports = {
  registerStaffRole,
  removeStaffRole,
  hasPermission,
  getRole,
  auditLog,
  playAnimation,
  giveItemAdmin,
  teleportTo,
  kickPlayer,
  setGold
};

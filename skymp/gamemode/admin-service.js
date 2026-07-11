/**
 * admin-service.js
 * Comandos de Staff com auditoria obrigatoria.
 * Toda acao registra no audit_log do banco de dados.
 */
const db = require('./database');
const commands = require('./commands');

// Roles autorizadas (salvas no campo vip_level da conta)
// 0: Jogador | 10: Moderador | 20: Admin | 30: Owner
const ROLE_MOD   = 10;
const ROLE_ADMIN = 20;
const ROLE_OWNER = 30;

// Cache de roles em memoria (carregadas na whitelist no login)
const staffRoles = new Map(); // actorId -> vip_level

function registerStaffRole(actorId, vipLevel) {
  if (vipLevel >= ROLE_MOD) {
    staffRoles.set(actorId, vipLevel);
    console.log(`[admin] Actor ${actorId.toString(16)} registrado como staff (role: ${vipLevel})`);
  }
}

function removeStaffRole(actorId) {
  staffRoles.delete(actorId);
}

function hasPermission(actorId, requiredRole) {
  return (staffRoles.get(actorId) || 0) >= requiredRole;
}

/**
 * Registra uma acao de staff no audit_log.
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
 * /anim [actorId] [animName] - Reproduz animacao em ator (para eventos RP)
 */
async function playAnimation(actorId, targetActorId, animName) {
  if (!hasPermission(actorId, ROLE_MOD)) {
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
    `anim=${animName} target=${targetActorId.toString(16)}`
  );
  console.log(`[admin] ${actorId.toString(16)} played animation '${animName}' on ${targetActorId.toString(16)}`);
}

/**
 * /additem [actorId] [baseId] [count] - Entrega item a jogador (eventos, testes)
 */
async function giveItemAdmin(actorId, targetActorId, baseId, count) {
  if (!hasPermission(actorId, ROLE_ADMIN)) {
    sendDenied(actorId);
    return;
  }
  const inventoryService = require('./inventory-service');
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  await inventoryService.giveItem(targetActorId, targetChar.characterId, baseId, count);
  const charData = commands.getActiveCharacterData(actorId);
  await auditLog(
    charData?.accountId, targetChar.accountId,
    'staff:addItem',
    `baseId=0x${baseId.toString(16)} count=${count}`
  );
  console.log(`[admin] ${actorId.toString(16)} gave 0x${baseId.toString(16)} x${count} to ${targetActorId.toString(16)}`);
}

/**
 * /tp [actorId] - Teleporta para jogador
 */
async function teleportTo(actorId, targetActorId) {
  if (!hasPermission(actorId, ROLE_MOD)) {
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
  await auditLog(charData?.accountId, null, 'staff:teleport', `target=${targetActorId.toString(16)}`);
}

/**
 * /kick [actorId] [motivo] - Expulsa jogador com motivo e audit
 */
async function kickPlayer(actorId, targetActorId, reason) {
  if (!hasPermission(actorId, ROLE_MOD)) {
    sendDenied(actorId);
    return;
  }
  const charData = commands.getActiveCharacterData(actorId);
  const targetData = commands.getActiveCharacterData(targetActorId);
  await auditLog(charData?.accountId, targetData?.accountId, 'staff:kick', reason);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você foi expulso: ${reason}`]);
    setTimeout(() => {
      if (typeof mp !== 'undefined') mp.kick(targetActorId);
    }, 3000);
  }
  console.log(`[admin] ${actorId.toString(16)} kicked ${targetActorId.toString(16)}: ${reason}`);
}

/**
 * /setgold [actorId] [valor] - Define ouro de um jogador (OWNER only)
 */
async function setGold(actorId, targetActorId, amount) {
  if (!hasPermission(actorId, ROLE_OWNER)) {
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
  await auditLog(charData?.accountId, targetChar.accountId, 'staff:setGold', `amount=${amount}`);
  console.log(`[admin] ${actorId.toString(16)} set gold=${amount} for char ${targetChar.characterId}`);
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
  auditLog,
  playAnimation,
  giveItemAdmin,
  teleportTo,
  kickPlayer,
  setGold
};

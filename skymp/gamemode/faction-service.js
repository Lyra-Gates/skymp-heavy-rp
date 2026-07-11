/**
 * faction-service.js
 * Sistema de Facções e Territórios (Fase Beta).
 *
 * Funcionalidades:
 * - Criação e gerenciamento de facções por staff.
 * - Entrada/saída de personagens em facções.
 * - Ranks dentro da facção (recruit, member, officer, leader).
 * - Tag da facção exibida no chat.
 * - Tesouro de facção (doações, impostos de Hold).
 */

const db = require('./database');
const admin = require('./admin-service');
const commands = require('./commands');

// Cache: characterId -> { factionId, tag, rank, name }
const memberCache = new Map();

async function loadMemberCache() {
  const rows = await db.query(
    `SELECT fm.character_id, fm.faction_id, fm.rank, f.tag, f.name, f.color_hex
     FROM faction_members fm INNER JOIN factions f ON f.id = fm.faction_id`
  );
  memberCache.clear();
  for (const r of rows) {
    memberCache.set(r.character_id, { factionId: r.faction_id, tag: r.tag, rank: r.rank, name: r.name, color: r.color_hex });
  }
  console.log(`[faction] Cache loaded: ${rows.length} members.`);
}

// Inicializa e recarga a cada 10 min
async function initFactionService() {
  await loadMemberCache();
  setInterval(loadMemberCache, 10 * 60 * 1000);
  console.log('[faction] Faction service initialized.');
}

/**
 * Retorna o tag de facção para uso no chat.
 * Ex: "[GUARDIA] Thorin diz: ..."
 */
function getFactionTag(characterId) {
  const f = memberCache.get(characterId);
  return f ? f.tag : null;
}

// ── Comandos de Jogador ───────────────────────────────────────────────────────

/**
 * /factions — Lista todas as facções ativas.
 */
async function listFactions(actorId) {
  const rows = await db.query('SELECT tag, name FROM factions ORDER BY name');
  if (rows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Nenhuma facção registrada.']);
    return;
  }
  const summary = rows.map(r => `${r.tag} ${r.name}`).join(' | ');
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [summary]);
}

/**
 * /factioninfo — Exibe sua própria facção.
 */
function showMyFaction(actorId, characterId) {
  const f = memberCache.get(characterId);
  if (!f) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não pertence a nenhuma facção.']);
    return;
  }
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Facção: ${f.tag} ${f.name} | Rank: ${f.rank}`]);
  }
}

/**
 * /fdonar [valor] — Doa ouro ao tesouro da facção.
 */
async function donate(actorId, characterId, amount) {
  const f = memberCache.get(characterId);
  if (!f) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não pertence a nenhuma facção.']);
    return;
  }
  const economy = require('./economy-service');
  const paid = await economy.removeGold(characterId, amount);
  if (!paid) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Ouro insuficiente.']);
    return;
  }
  await db.query('UPDATE factions SET treasury = treasury + ? WHERE id = ?', [amount, f.factionId]);
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você doou ${amount}g ao tesouro de ${f.name}.`]);
  commands.broadcastProximityMessage(actorId, `* Deposita algumas moedas na caixa da guilda.`, 400);
}

// ── Comandos de Staff ──────────────────────────────────────────────────────────

/**
 * /createfaction [tag] [name] — Cria uma nova facção.
 */
async function createFaction(actorId, tag, name) {
  if (!admin.hasPermission(actorId, 20)) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['[Staff] Permissão negada.']);
    return;
  }
  try {
    const res = await db.query('INSERT INTO factions (tag, name) VALUES (?, ?)', [tag, name]);
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Facção criada: ${tag} ${name} (ID: ${res.insertId})`]);
    console.log(`[faction] Created faction ${res.insertId}: ${tag} ${name}`);
    const ch = commands.getActiveCharacterData(actorId);
    await admin.auditLog(ch?.accountId, null, 'faction:create', `tag=${tag} name=${name}`);
  } catch {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Tag de facção já existe.']);
  }
}

/**
 * /addfmember [actorId] [factionId] [rank] — Adiciona membro.
 */
async function addMember(actorId, targetActorId, factionId, rank = 'recruit') {
  if (!admin.hasPermission(actorId, 10)) return;

  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  await db.query(
    'INSERT IGNORE INTO faction_members (faction_id, character_id, rank) VALUES (?, ?, ?)',
    [factionId, targetChar.characterId, rank]
  );
  await loadMemberCache();

  const f = memberCache.get(targetChar.characterId);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Bem-vindo à ${f?.name || 'facção'}!`]);
  }

  const ch = commands.getActiveCharacterData(actorId);
  await admin.auditLog(ch?.accountId, targetChar.accountId, 'faction:addMember', `factionId=${factionId} rank=${rank}`);
  console.log(`[faction] Char ${targetChar.characterId} added to faction ${factionId} as ${rank}`);
}

/**
 * /removefmember [actorId] — Remove membro da facção.
 */
async function removeMember(actorId, targetActorId) {
  if (!admin.hasPermission(actorId, 10)) return;
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  await db.query('DELETE FROM faction_members WHERE character_id = ?', [targetChar.characterId]);
  memberCache.delete(targetChar.characterId);

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você foi removido da facção.']);
  }
  const ch = commands.getActiveCharacterData(actorId);
  await admin.auditLog(ch?.accountId, targetChar.accountId, 'faction:removeMember', null);
}

/**
 * /setfhold [factionId] [holdId] — Atribui controle de um Hold a uma facção.
 */
async function setHoldControl(actorId, factionId, holdId) {
  if (!admin.hasPermission(actorId, 20)) return;
  await db.query('UPDATE holds SET ruling_faction_id = ? WHERE id = ?', [factionId, holdId]);
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Facção ${factionId} agora controla ${holdId}.`]);
  const ch = commands.getActiveCharacterData(actorId);
  await admin.auditLog(ch?.accountId, null, 'faction:setHold', `factionId=${factionId} holdId=${holdId}`);
}

module.exports = {
  initFactionService,
  getFactionTag,
  listFactions,
  showMyFaction,
  donate,
  createFaction,
  addMember,
  removeMember,
  setHoldControl
};

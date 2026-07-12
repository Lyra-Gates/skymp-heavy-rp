/**
 * disguise-service.js
 * Sistema de Disfarces e Identidades Falsas.
 *
 * Mecânicas de RP:
 * - Um personagem pode ter um disfarce salvo no banco (/createdisguise).
 * - Ao ativar (/disguise), seu nome no chat é substituído pelo nome falso.
 * - Outros jogadores podem tentar detectar (/detect [actorId]) via rolagem vs DC.
 * - DC de detecção é configurável (padrão 15/20).
 * - Toda detecção bem-sucedida revela o nome real no audit log e avisa o detectado.
 * - Staff sempre vê o nome real (flag `isStaff`).
 */

const db = require('./database');
const admin = require('./admin-service');
const commands = require('./commands');

// Cache ativo: characterId -> { fakeId, fakeName, fakeFactionTag, dc }
const activeDisguises = new Map();

/**
 * Retorna o nome público de um personagem (real ou disfarçado).
 */
function getPublicName(characterId, observerCharacterId) {
  // Staff sempre vê o nome real
  const obsData = [...Array.from(activeDisguises.keys())].find(id => id === observerCharacterId);
  // Para simplificar, staff bypass é feito no commands.js pela role

  const disguise = activeDisguises.get(characterId);
  if (disguise) return disguise.fakeName;
  return null; // null = usar nome real
}

/**
 * /createdisguise [nome falso] — Cria/salva um disfarce.
 */
async function createDisguise(actorId, characterId, fakeName) {
  if (!fakeName || fakeName.trim().length < 2) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Nome do disfarce inválido.']);
    return;
  }
  await db.query(
    `INSERT INTO disguises (character_id, fake_name, detection_roll)
     VALUES (?, ?, 15)
     ON DUPLICATE KEY UPDATE fake_name=VALUES(fake_name)`,
    [characterId, fakeName.substring(0, 64)]
  );
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Disfarce criado: "${fakeName}". Use /disguise para ativar.`]);
  }
}

/**
 * /disguise — Ativa o disfarce salvo.
 */
async function activateDisguise(actorId, characterId) {
  const rows = await db.query('SELECT * FROM disguises WHERE character_id = ?', [characterId]);
  if (rows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não possui um disfarce. Use /createdisguise [nome].']);
    return;
  }
  const d = rows[0];
  activeDisguises.set(characterId, { fakeId: d.id, fakeName: d.fake_name, dc: d.detection_roll });
  await db.query('UPDATE disguises SET is_active=1 WHERE character_id=?', [characterId]);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`* Você assume a identidade de "${d.fake_name}".`]);
  }
  commands.broadcastProximityMessage(actorId, `* Ajusta seu capuz e muda de postura.`, 400);
  console.log(`[disguise] Char ${characterId} disguised as "${d.fake_name}"`);
}

/**
 * /undisguise — Remove o disfarce ativo.
 */
async function deactivateDisguise(actorId, characterId) {
  const had = activeDisguises.has(characterId);
  activeDisguises.delete(characterId);
  await db.query('UPDATE disguises SET is_active=0 WHERE character_id=?', [characterId]);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [had ? '* Você remove o disfarce.' : 'Você não está disfarçado.']);
  }
  if (had) commands.broadcastProximityMessage(actorId, `* Remove o capuz, revelando seu rosto.`, 400);
}

/**
 * /detect [actorId] — Tenta detectar o disfarce de outro jogador.
 * Rolagem automática no servidor (d20 vs DC).
 */
async function detectDisguise(actorId, observerCharacterId, targetActorId) {
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  const disguise = activeDisguises.get(targetChar.characterId);
  if (!disguise) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Esta pessoa não parece estar disfarçada.']);
    return;
  }

  // Rolagem d20 no servidor
  const roll = Math.floor(Math.random() * 20) + 1;
  const success = roll >= disguise.dc;
  const obsCharData = commands.getActiveCharacterData(actorId);

  if (success) {
    // Revela o nome real
    const realData = commands.getActiveCharacterData(targetActorId);
    const realName = realData ? `${realData.firstName || ''} ${realData.lastName || ''}`.trim() : 'Desconhecido';
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
        `[Percepção ${roll}/${disguise.dc}] ✓ Você percebe que "${disguise.fakeName}" é na verdade ${realName}!`
      ]);
    }
    // Avisa o disfarçado que foi detectado
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['* Alguém parece ter percebido seu disfarce...']);
    }
    // Audit
    await admin.auditLog(obsCharData?.accountId, targetChar.accountId, 'disguise:detected', `roll=${roll} dc=${disguise.dc}`);
  } else {
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
        `[Percepção ${roll}/${disguise.dc}] ✗ Você não consegue identificar nada suspeito.`
      ]);
    }
  }
}

/**
 * Staff: /revealid [actorId] — Sempre revela a identidade real.
 */
function staffReveal(actorId, targetActorId) {
  if (!admin.hasPermission(actorId, 10)) return;
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;
  const d = activeDisguises.get(targetChar.characterId);
  const charData = commands.getActiveCharacterData(actorId);
  const msg = d
    ? `[Staff] "${d.fakeName}" é na verdade ${charData?.firstName || ''} ${charData?.lastName || ''}.`
    : '[Staff] Este personagem não está disfarçado.';
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [msg]);
}

/**
 * Retorna se um personagem está disfarçado (para uso no chat).
 */
function isDisguised(characterId) { return activeDisguises.has(characterId); }
function getDisguiseName(characterId) { return activeDisguises.get(characterId)?.fakeName || null; }

module.exports = { createDisguise, activateDisguise, deactivateDisguise, detectDisguise, staffReveal, isDisguised, getDisguiseName };

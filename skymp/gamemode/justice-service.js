/**
 * justice-service.js
 * Sistema de Algemas, Prisao e Ficha Criminal.
 *
 * Regras de Design:
 * - Toda acao de guardia/staff eh registrada no audit_log.
 * - Pena de prisao eh baseada em MINUTOS IN-GAME, nao reais.
 * - Personagem algemado nao pode usar comandos de acao (coleta, comercio).
 * - Evasao de prisao (logoff durante pena) aumenta a ficha criminal.
 */

const db = require('./database');
const admin = require('./admin-service');
const commands = require('./commands');

// Holds do jogo com suas respectivas prisoes (cellId do SkyMP)
const HOLD_PRISONS = {
  whiterun:  { cellId: '0x1A26F', pos: [-138, 46, -113] },   // Whiterun Jail
  solitude:  { cellId: '0x1699C', pos: [  12, 15,   -1] },   // Castle Dour Dungeon
  riften:    { cellId: '0x16BCF', pos: [  10, -5,  -10] },   // Riften Jail
  windhelm:  { cellId: '0x1A268', pos: [ -80, 10,   -5] },   // Windhelm Jail
};

// Cache em memoria: characterId -> { actorId, sentence, startTime, hold }
const activePrisoners = new Map();
// Cache em memoria: characterId -> { actorId, restrainedBy }
const restrainedPlayers = new Map();

// Timer principal de progressao de penas (tick a cada 60s)
let sentenceTimer = null;

function startJusticeService() {
  if (sentenceTimer) return;
  sentenceTimer = setInterval(tickSentences, 60 * 1000);
  console.log('[justice] Justice service started (sentence ticker active).');
}

/**
 * Processa o tempo de pena a cada minuto.
 * Se a pena terminou, libera o personagem automaticamente.
 */
async function tickSentences() {
  for (const [charId, prisoner] of activePrisoners.entries()) {
    const elapsed = Math.floor((Date.now() - prisoner.startTime) / 60000);
    await db.query(
      'UPDATE prison_records SET time_served_minutes = ? WHERE character_id = ? AND status = ?',
      [elapsed, charId, 'active']
    );

    if (elapsed >= prisoner.sentenceMinutes) {
      await releasePrisoner(prisoner.actorId, charId, 'time_served');
    }
  }
}

// ─── ALGEMAS ─────────────────────────────────────────────────────────────────

/**
 * /restrain [actorId] — Algema um jogador.
 * Requer permissao de Moderador ou personagem com cargo de Guardia (futuro).
 */
async function restrain(officerActorId, targetActorId) {
  if (!admin.hasPermission(officerActorId, 10)) {
    // Verificacao futura: cargo IC de Guardia
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Apenas guardias podem algemar.']);
    return;
  }

  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  if (restrainedPlayers.has(targetChar.characterId)) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Este jogador ja esta algemado.']);
    return;
  }

  // Registra no banco
  await db.query(
    'INSERT INTO character_restraints (character_id, restrained_by_character_id, type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE restrained_by_character_id=VALUES(restrained_by_character_id), applied_at=NOW()',
    [targetChar.characterId, commands.getActiveCharacterData(officerActorId)?.characterId, 'handcuffs']
  );
  restrainedPlayers.set(targetChar.characterId, { actorId: targetActorId, restrainedBy: officerActorId });

  // Efeito visual: paralisa o movimento (SpeedMult = 0)
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', targetActorId, ['SpeedMult', 0]);
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['* Voce foi algemado.']);
  }

  commands.broadcastProximityMessage(officerActorId, `* Algema ${getCharName(targetActorId)}.`, 800);

  const offChar = commands.getActiveCharacterData(officerActorId);
  await admin.auditLog(offChar?.accountId, targetChar.accountId, 'justice:restrain', 'handcuffs');
  console.log(`[justice] Actor ${officerActorId.toString(16)} restrained ${targetActorId.toString(16)}`);
}

/**
 * /unrestrain [actorId] — Retira as algemas.
 */
async function unrestrain(officerActorId, targetActorId) {
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  await db.query('DELETE FROM character_restraints WHERE character_id = ?', [targetChar.characterId]);
  restrainedPlayers.delete(targetChar.characterId);

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', targetActorId, ['SpeedMult', 100]);
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['* As algemas foram retiradas.']);
  }

  const offChar = commands.getActiveCharacterData(officerActorId);
  await admin.auditLog(offChar?.accountId, targetChar.accountId, 'justice:unrestrain', null);
  console.log(`[justice] Actor ${officerActorId.toString(16)} unrestrained ${targetActorId.toString(16)}`);
}

// ─── PRISAO ──────────────────────────────────────────────────────────────────

/**
 * /arrest [actorId] [minutos] [crime] — Prende um jogador algemado.
 */
async function arrest(officerActorId, targetActorId, sentenceMinutes, crimeSummary) {
  if (!admin.hasPermission(officerActorId, 10)) return;

  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  const hold = 'whiterun'; // Futuro: detectar Hold atual
  const prison = HOLD_PRISONS[hold];

  // Garante que as algemas sejam removidas antes do encarceramento
  await unrestrain(officerActorId, targetActorId);

  // Grava no banco
  const result = await db.query(
    'INSERT INTO prison_records (character_id, arrested_by_character_id, crime_summary, sentence_minutes, cell_id) VALUES (?, ?, ?, ?, ?)',
    [targetChar.characterId, commands.getActiveCharacterData(officerActorId)?.characterId, crimeSummary, sentenceMinutes, prison.cellId]
  );

  // Cache em memoria para o ticker
  activePrisoners.set(targetChar.characterId, {
    actorId: targetActorId,
    sentenceMinutes,
    startTime: Date.now(),
    hold,
    recordId: result.insertId
  });

  // Teleporta para a prisao
  if (typeof mp !== 'undefined') {
    mp.set(targetActorId, 'locationalData', {
      pos: prison.pos,
      rot: [0, 0, 0],
      cellOrWorldDesc: prison.cellId
    });
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
      `Voce foi preso por: ${crimeSummary}. Pena: ${sentenceMinutes} min.`
    ]);
  }

  commands.broadcastProximityMessage(officerActorId, `* Conduz ${getCharName(targetActorId)} sob custódia.`, 1200);

  const offChar = commands.getActiveCharacterData(officerActorId);
  await admin.auditLog(offChar?.accountId, targetChar.accountId, 'justice:arrest', `crime=${crimeSummary} sentence=${sentenceMinutes}min`);
  console.log(`[justice] Char ${targetChar.characterId} arrested for ${sentenceMinutes}min: ${crimeSummary}`);
}

/**
 * Libera um prisioneiro e teleporta de volta para a cidade.
 */
async function releasePrisoner(actorId, characterId, reason = 'manual') {
  await db.query(
    'UPDATE prison_records SET status = ?, released_at = NOW() WHERE character_id = ? AND status = ?',
    ['released', characterId, 'active']
  );
  activePrisoners.delete(characterId);

  // Teleporta para o spawn default (Templo de Kynareth)
  if (typeof mp !== 'undefined' && actorId) {
    mp.set(actorId, 'locationalData', {
      pos: [35, -165, -189],
      rot: [0, 0, 180],
      cellOrWorldDesc: '0x162e2'
    });
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Voce cumpriu sua pena e foi libertado.']);
  }
  console.log(`[justice] Char ${characterId} released. Reason: ${reason}`);
}

/**
 * /setbounty [actorId] [valor] [crime] — Adiciona uma recompensa na ficha do personagem.
 */
async function setBounty(officerActorId, targetActorId, bounty, crime) {
  if (!admin.hasPermission(officerActorId, 10)) return;

  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  await db.query(
    'INSERT INTO criminal_records (character_id, crime, bounty, hold, witness_character_id) VALUES (?, ?, ?, ?, ?)',
    [targetChar.characterId, crime, bounty, 'whiterun', commands.getActiveCharacterData(officerActorId)?.characterId]
  );

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
      `[Guarda] Uma recompensa de ${bounty} Septims foi registrada em seu nome.`
    ]);
  }

  const offChar = commands.getActiveCharacterData(officerActorId);
  await admin.auditLog(offChar?.accountId, targetChar.accountId, 'justice:setBounty', `crime=${crime} bounty=${bounty}`);
  console.log(`[justice] Bounty ${bounty} set on char ${targetChar.characterId}: ${crime}`);
}

/**
 * /criminal [actorId] — Exibe a ficha criminal de um personagem.
 */
async function showCriminalRecord(actorId, targetActorId) {
  if (!admin.hasPermission(actorId, 10)) return;

  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  const records = await db.query(
    'SELECT crime, bounty, hold, resolved, created_at FROM criminal_records WHERE character_id = ? ORDER BY created_at DESC LIMIT 10',
    [targetChar.characterId]
  );

  if (records.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Ficha criminal limpa.']);
    return;
  }

  const summary = records.map(r => `[${r.resolved ? 'RESOLVIDO' : 'ATIVO'}] ${r.crime} (${r.bounty}g - ${r.hold})`).join(' | ');
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [summary]);
}

/**
 * Verifica se um personagem esta algemado (para bloquear acoes).
 */
function isRestrained(characterId) {
  return restrainedPlayers.has(characterId);
}

/**
 * Verifica se um personagem esta preso.
 */
function isImprisoned(characterId) {
  return activePrisoners.has(characterId);
}

/**
 * Restaura prisioneiros ativos do banco ao reiniciar o servidor.
 */
async function restoreActivePrisoners() {
  const rows = await db.query(
    'SELECT pr.character_id, pr.sentence_minutes, pr.time_served_minutes, pr.cell_id, pr.arrested_at FROM prison_records pr WHERE pr.status = ?',
    ['active']
  );
  for (const row of rows) {
    const elapsed = Math.floor((Date.now() - new Date(row.arrested_at).getTime()) / 60000);
    if (elapsed >= row.sentence_minutes) {
      // Pena ja deveria ter terminado — libera sem actorId (offline)
      await db.query('UPDATE prison_records SET status=?, released_at=NOW() WHERE character_id=? AND status=?', ['released', row.character_id, 'active']);
    } else {
      activePrisoners.set(row.character_id, {
        actorId: null, // Sera atualizado no login
        sentenceMinutes: row.sentence_minutes,
        startTime: Date.now() - (elapsed * 60000),
        hold: 'whiterun'
      });
    }
  }
  console.log(`[justice] Restored ${activePrisoners.size} active prisoner(s) from DB.`);
}

function getCharName(actorId) {
  const d = commands.getActiveCharacterData(actorId);
  return d ? `${d.firstName} ${d.lastName}` : `0x${actorId.toString(16)}`;
}

module.exports = {
  startJusticeService,
  restoreActivePrisoners,
  restrain,
  unrestrain,
  arrest,
  releasePrisoner,
  setBounty,
  showCriminalRecord,
  isRestrained,
  isImprisoned
};

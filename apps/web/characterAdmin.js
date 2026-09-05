'use strict';

class AdminActionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'AdminActionError';
    this.statusCode = statusCode;
  }
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AdminActionError(400, `${label} invalide.`);
  }
  return id;
}

function cleanReason(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 512) || null;
}

async function inTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* préserver l'erreur initiale */ }
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteWhitelistApplication({ pool, applicationId, moderatorAccountId, reason }) {
  const id = positiveId(applicationId, 'Candidature');
  const moderatorId = positiveId(moderatorAccountId, 'Compte staff');
  const resetReason = cleanReason(reason);

  return inTransaction(pool, async (connection) => {
    const [rows] = await connection.execute(
      `SELECT wa.id, wa.account_id, wa.status, d.discord_id
         FROM whitelist_applications wa
         LEFT JOIN discord_identities d ON d.account_id = wa.account_id
        WHERE wa.id = ?
        FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) throw new AdminActionError(404, 'Candidature introuvable.');
    // La fiche de personnage reste archée pour conserver l'audit et les
    // relations historiques, mais elle ne pourra plus être réapprouvée par
    // erreur lors de l'envoi de la nouvelle candidature.
    await connection.execute(
      `UPDATE characters
          SET status = 'retired'
        WHERE account_id = ? AND status <> 'retired'`,
      [rows[0].account_id]
    );
    await connection.execute(
      'DELETE FROM whitelist_applications WHERE id = ?',
      [id]
    );
    await connection.execute(
      `INSERT INTO audit_logs (action, actor_account_id, target_account_id, details)
       VALUES ('whitelist:delete', ?, ?, ?)`,
      [moderatorId, rows[0].account_id, resetReason]
    );

    return {
      applicationId: id,
      accountId: rows[0].account_id,
      discordId: rows[0].discord_id || null,
      reason: resetReason
    };
  });
}

async function queueCharacterRecreation({ pool, characterId, moderatorAccountId, reason }) {
  const id = positiveId(characterId, 'Personnage');
  const moderatorId = positiveId(moderatorAccountId, 'Compte staff');
  const resetReason = cleanReason(reason);

  return inTransaction(pool, async (connection) => {
    const [rows] = await connection.execute(
      `SELECT c.id, c.account_id, c.first_name, c.last_name, c.status, d.discord_id
         FROM characters c
         LEFT JOIN discord_identities d ON d.account_id = c.account_id
        WHERE c.id = ?
        FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) throw new AdminActionError(404, 'Personnage introuvable.');
    if (rows[0].status !== 'approved') {
      throw new AdminActionError(409, 'Seul un personnage approuvé peut être recréé.');
    }

    await connection.execute(
      `UPDATE characters SET status = 'retired' WHERE id = ? AND status = 'approved'`,
      [id]
    );

    // Une nouvelle ligne évite d'effacer les journaux et relations historiques
    // de l'ancien personnage. Les champs de jeu absents de cette liste reprennent
    // leurs valeurs par défaut : inventaire vide, zéro or, position de départ et
    // aucun preset d'apparence.
    const [inserted] = await connection.execute(
      `INSERT INTO characters
         (account_id, first_name, last_name, biography, motivations, weaknesses,
          social_ties, needs_extra_review, extra_review_notes, status)
       SELECT account_id, first_name, last_name, biography, motivations, weaknesses,
              social_ties, needs_extra_review, extra_review_notes, 'approved'
         FROM characters
        WHERE id = ?`,
      [id]
    );
    const newCharacterId = Number(inserted.insertId);
    if (!Number.isSafeInteger(newCharacterId) || newCharacterId <= 0) {
      throw new Error('La création de la nouvelle fiche personnage a échoué.');
    }

    await connection.execute(
      `INSERT INTO character_recreation_requests
         (account_id, previous_character_id, new_character_id, requested_by_account_id, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [rows[0].account_id, id, newCharacterId, moderatorId]
    );

    const details = JSON.stringify({
      previousCharacterId: id,
      newCharacterId,
      reason: resetReason
    });
    await connection.execute(
      `INSERT INTO audit_logs (action, actor_account_id, target_account_id, details)
       VALUES ('character:recreate', ?, ?, ?)`,
      [moderatorId, rows[0].account_id, details]
    );

    return {
      previousCharacterId: id,
      newCharacterId,
      accountId: rows[0].account_id,
      discordId: rows[0].discord_id || null,
      displayName: `${rows[0].first_name} ${rows[0].last_name}`.trim(),
      reason: resetReason
    };
  });
}

module.exports = {
  AdminActionError,
  cleanReason,
  deleteWhitelistApplication,
  queueCharacterRecreation
};

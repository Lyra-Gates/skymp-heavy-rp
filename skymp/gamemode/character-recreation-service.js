'use strict';

/**
 * Consomme une demande de recréation au moment où SkyMP a rattaché l'acteur
 * persistant au profil. L'ancien acteur est détruit une seule fois ; à la
 * connexion suivante, le Spawn officiel ne le retrouve plus, crée un acteur
 * vierge et ouvre automatiquement le RaceMenu.
 */
async function processCharacterRecreation({ db, mp, logger = console, userId, accountId, characterId, actorId }) {
  if (!db || typeof db.query !== 'function') throw new Error('[character-recreation] db invalide');
  if (!mp || typeof mp.destroyActor !== 'function' || typeof mp.kick !== 'function') {
    throw new Error('[character-recreation] mp invalide');
  }

  const rows = await db.query(
    `SELECT id, status, target_actor_id
       FROM character_recreation_requests
      WHERE account_id = ? AND new_character_id = ?
        AND status IN ('pending', 'processing')
      ORDER BY id DESC
      LIMIT 1`,
    [accountId, characterId]
  );
  if (rows.length === 0) return { blockLogin: false, completed: false };

  const request = rows[0];
  const hasTarget = request.target_actor_id !== null && request.target_actor_id !== undefined;
  const sameActor = hasTarget && String(request.target_actor_id) === String(actorId);

  // L'ancien acteur a déjà été détruit : SkyMP vient d'en créer un nouveau.
  // Ne surtout pas détruire ce nouvel acteur, sinon le joueur bouclerait.
  if (request.status === 'processing' && hasTarget && !sameActor) {
    await db.query(
      `UPDATE character_recreation_requests
          SET status = 'applied', applied_at = NOW(), last_error = NULL
        WHERE id = ? AND status = 'processing'`,
      [request.id]
    );
    logger.log(`[character-recreation] Demande ${request.id} terminée avec le nouvel acteur ${actorId.toString(16)}.`);
    return { blockLogin: false, completed: true };
  }

  if (request.status === 'pending' || !hasTarget) {
    const claimed = await db.query(
      `UPDATE character_recreation_requests
          SET status = 'processing', target_actor_id = ?, processing_at = NOW(), last_error = NULL
        WHERE id = ? AND status IN ('pending', 'processing')`,
      [actorId, request.id]
    );
    if (claimed && claimed.affectedRows === 0) {
      mp.kick(userId);
      return { blockLogin: true, completed: false };
    }
  }

  try {
    mp.destroyActor(actorId);
  } catch (error) {
    await db.query(
      `UPDATE character_recreation_requests
          SET status = 'pending', target_actor_id = NULL, processing_at = NULL,
              last_error = ?
        WHERE id = ?`,
      [String(error && error.message || error).slice(0, 512), request.id]
    );
    throw error;
  }

  try {
    mp.kick(userId);
  } catch (error) {
    logger.error(`[character-recreation] Acteur détruit, mais kick impossible pour user ${userId}:`, error.message);
  }
  logger.log(`[character-recreation] Ancien acteur ${actorId.toString(16)} détruit pour la demande ${request.id}.`);
  return { blockLogin: true, completed: false };
}

module.exports = { processCharacterRecreation };

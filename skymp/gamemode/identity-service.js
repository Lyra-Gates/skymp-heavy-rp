const db = require('./database');

const UNKNOWN_NAME = 'Desconhecido';
const MAX_ALIAS_LENGTH = 64;

const knownByObserver = new Map();

function getCharacterFullName(character) {
  if (!character) return UNKNOWN_NAME;
  const firstName = character.firstName || character.first_name || '';
  const lastName = character.lastName || character.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || UNKNOWN_NAME;
}

function sanitizeDisplayName(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ALIAS_LENGTH);
}

function ensureObserverCache(observerCharacterId) {
  if (!knownByObserver.has(observerCharacterId)) {
    knownByObserver.set(observerCharacterId, new Map());
  }
  return knownByObserver.get(observerCharacterId);
}

function cacheKnownIdentity(observerCharacterId, targetCharacterId, displayName, source) {
  if (!observerCharacterId || !targetCharacterId) return;
  const cleanName = sanitizeDisplayName(displayName);
  if (!cleanName) return;
  ensureObserverCache(observerCharacterId).set(targetCharacterId, {
    displayName: cleanName,
    source: source || 'introduced'
  });
}

async function loadKnownIdentities(observerCharacterId) {
  if (!observerCharacterId) return;
  try {
    const rows = await db.query(
      `SELECT target_character_id, display_name, source
       FROM character_known_identities
       WHERE observer_character_id = ?`,
      [observerCharacterId]
    );
    const cache = new Map();
    for (const row of rows) {
      cache.set(row.target_character_id, {
        displayName: row.display_name,
        source: row.source
      });
    }
    knownByObserver.set(observerCharacterId, cache);
  } catch (err) {
    console.error('[identity] Failed to load known identities:', err.message);
  }
}

function forgetKnownIdentities(observerCharacterId) {
  knownByObserver.delete(observerCharacterId);
}

function getKnownDisplayName(observerCharacterId, targetCharacterId) {
  const known = knownByObserver.get(observerCharacterId);
  if (!known) return null;
  return known.get(targetCharacterId) || null;
}

function getDisplayName(observerCharacter, targetCharacter) {
  if (!targetCharacter) return UNKNOWN_NAME;
  if (observerCharacter && observerCharacter.characterId === targetCharacter.characterId) {
    return getCharacterFullName(targetCharacter);
  }

  const known = observerCharacter
    ? getKnownDisplayName(observerCharacter.characterId, targetCharacter.characterId)
    : null;

  return known ? known.displayName : UNKNOWN_NAME;
}

async function upsertKnownIdentity(observerCharacterId, targetCharacterId, displayName, source) {
  const cleanName = sanitizeDisplayName(displayName);
  if (!observerCharacterId || !targetCharacterId || !cleanName) {
    throw new Error('Invalid identity relationship');
  }

  cacheKnownIdentity(observerCharacterId, targetCharacterId, cleanName, source);

  await db.query(
    `INSERT INTO character_known_identities
       (observer_character_id, target_character_id, display_name, source)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       source = VALUES(source),
       updated_at = CURRENT_TIMESTAMP`,
    [observerCharacterId, targetCharacterId, cleanName, source || 'introduced']
  );
}

async function auditIdentityEvent(actorAccountId, targetAccountId, action, details) {
  try {
    await db.query(
      'INSERT INTO audit_logs (action, actor_account_id, target_account_id, details) VALUES (?, ?, ?, ?)',
      [action, actorAccountId || null, targetAccountId || null, details || null]
    );
  } catch (err) {
    console.log(`[identity-audit] ${action}: ${details || ''}`);
  }
}

module.exports = {
  UNKNOWN_NAME,
  getCharacterFullName,
  sanitizeDisplayName,
  cacheKnownIdentity,
  loadKnownIdentities,
  forgetKnownIdentities,
  getDisplayName,
  upsertKnownIdentity,
  auditIdentityEvent
};

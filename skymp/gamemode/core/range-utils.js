/**
 * core/range-utils.js
 *
 * Utilitários de distância/alcance compartilhados entre serviços que precisam
 * validar proximidade entre dois atores (governance-service, death-service, ...).
 * Extraído de governance-service.js pra não duplicar a mesma lógica em cada
 * novo sistema que precisa de "alvo tem que estar perto".
 */

function getLoc(actorId) {
  if (typeof mp === 'undefined') return null;
  return mp.get(actorId, 'locationalData') || mp.get(actorId, 'pos') || null;
}

function getCell(loc) {
  if (!loc) return null;
  return loc.cellOrWorldDesc || loc.cellOrWorldSpaceId || loc.cellId || loc.worldOrCell || loc.worldOrCellDesc || null;
}

function getPos(loc) {
  if (!loc) return null;
  return loc.pos || (Array.isArray(loc) ? loc : null);
}

function distanceBetween(a, b) {
  const la = getLoc(a);
  const lb = getLoc(b);
  if (!la || !lb) return null;

  const ca = getCell(la);
  const cb = getCell(lb);
  if (ca && cb && ca !== cb) return Infinity;

  const pa = getPos(la);
  const pb = getPos(lb);
  if (!pa || !pb) return null;

  const dx = pa[0] - pb[0];
  const dy = pa[1] - pb[1];
  const dz = pa[2] - pb[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * @param {number} sourceActorId
 * @param {number} targetActorId
 * @param {number} maxRange
 * @returns {{ok: boolean, reason?: string}}
 */
function assertRange(sourceActorId, targetActorId, maxRange) {
  if (typeof mp === 'undefined') return { ok: true };
  const distance = distanceBetween(sourceActorId, targetActorId);
  if (distance === null) return { ok: false, reason: 'Nao foi possivel validar proximidade.' };
  if (distance > maxRange) return { ok: false, reason: 'Alvo fora de alcance.' };
  return { ok: true };
}

module.exports = { getLoc, getCell, getPos, distanceBetween, assertRange };

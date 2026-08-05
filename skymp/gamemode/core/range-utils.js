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

/**
 * Lista atores próximos de actorId dentro de maxRange, na mesma célula.
 * Usado pra montar contexto de evidência (ex: quem estava por perto na
 * hora de uma morte ou de um pico de dano) — não é rastreamento contínuo,
 * só um snapshot no momento da chamada.
 * @param {number} actorId
 * @param {number} maxRange
 * @returns {{actorId: number, distance: number}[]}
 */
function nearbyActors(actorId, maxRange) {
  if (typeof mp === 'undefined') return [];
  const results = [];
  try {
    const neighbors = mp.get(actorId, 'neighbors') || [];
    const loc = getLoc(actorId);
    const pos = getPos(loc);
    const cell = getCell(loc);
    if (!pos) return [];

    for (const neighborId of neighbors) {
      if (neighborId === actorId) continue;
      if (mp.get(neighborId, 'type') !== 'MpActor') continue;

      const nLoc = getLoc(neighborId);
      const nPos = getPos(nLoc);
      if (!nPos) continue;
      const nCell = getCell(nLoc);
      if (cell && nCell && cell !== nCell) continue;

      const dx = pos[0] - nPos[0];
      const dy = pos[1] - nPos[1];
      const dz = pos[2] - nPos[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance <= maxRange) results.push({ actorId: neighborId, distance });
    }
  } catch (err) {
    console.error('[range-utils] Falha ao calcular vizinhos:', err.message);
  }
  return results;
}

module.exports = { getLoc, getCell, getPos, distanceBetween, assertRange, nearbyActors };

/** Máquina de estados pura das execuções de Trabalho Público. */
'use strict';

const STATUSES = Object.freeze({
  ASSIGNED: 'assigned', IN_PROGRESS: 'in_progress', COMPLETED: 'completed',
  CANCELLED: 'cancelled', EXPIRED: 'expired'
});
const TERMINAL = new Set([STATUSES.COMPLETED, STATUSES.CANCELLED, STATUSES.EXPIRED]);
const REQUEST_ID_SHAPE = /^[A-Za-z0-9_:.-]{8,96}$/;
const CARGO_TOKEN_SHAPE = /^[A-Za-z0-9_-]{24,96}$/;

function _fail(code) { return { ok: false, code }; }
function _validDate(value) { return value instanceof Date && Number.isFinite(value.getTime()); }
function _validRequestId(value) { return typeof value === 'string' && REQUEST_ID_SHAPE.test(value); }

function createAssignedRun({ id, characterId, definition, requestId, now = new Date() }) {
  if (!_validRequestId(requestId)) return _fail('invalid_request_id');
  if (!Number.isSafeInteger(characterId) || characterId <= 0) return _fail('invalid_character');
  if (!definition || typeof definition.code !== 'string') return _fail('invalid_definition');
  if (!_validDate(now)) return _fail('invalid_time');
  return { ok: true, run: {
    id, characterId, workCode: definition.code,
    originFormDesc: definition.originFormDesc, originLabel: definition.originLabel,
    destinationFormDesc: definition.destinationFormDesc, destinationLabel: definition.destinationLabel,
    rewardAmount: definition.rewardAmount, cooldownGroup: definition.cooldownGroup,
    status: STATUSES.ASSIGNED, cargoToken: null,
    assignmentRequestId: requestId, pickupRequestId: null, completionRequestId: null,
    startedAt: new Date(now),
    expiresAt: new Date(now.getTime() + definition.timeLimitSeconds * 1000),
    completedAt: null, cancelledAt: null
  } };
}

function pickup(run, { requestId, cargoToken, now = new Date() }) {
  if (!_validRequestId(requestId)) return _fail('invalid_request_id');
  if (run.status === STATUSES.IN_PROGRESS && run.pickupRequestId === requestId) return { ok: true, replay: true, run };
  if (run.status !== STATUSES.ASSIGNED) return _fail(TERMINAL.has(run.status) ? 'terminal_run' : 'invalid_transition');
  if (!_validDate(now) || now >= run.expiresAt) return _fail('expired');
  if (typeof cargoToken !== 'string' || !CARGO_TOKEN_SHAPE.test(cargoToken)) return _fail('invalid_cargo_token');
  return { ok: true, replay: false, run: { ...run, status: STATUSES.IN_PROGRESS, cargoToken, pickupRequestId: requestId } };
}

function complete(run, { requestId, cargoToken, now = new Date() }) {
  if (!_validRequestId(requestId)) return _fail('invalid_request_id');
  if (run.status === STATUSES.COMPLETED && run.completionRequestId === requestId) return { ok: true, replay: true, run };
  if (run.status !== STATUSES.IN_PROGRESS) return _fail(TERMINAL.has(run.status) ? 'terminal_run' : 'invalid_transition');
  if (!_validDate(now) || now >= run.expiresAt) return _fail('expired');
  if (!cargoToken || cargoToken !== run.cargoToken) return _fail('cargo_mismatch');
  return { ok: true, replay: false, run: {
    ...run, status: STATUSES.COMPLETED, cargoToken: null,
    completionRequestId: requestId, completedAt: new Date(now)
  } };
}

function cancel(run, { now = new Date() } = {}) {
  if (TERMINAL.has(run.status)) return _fail('terminal_run');
  if (!_validDate(now)) return _fail('invalid_time');
  return { ok: true, run: { ...run, status: STATUSES.CANCELLED, cargoToken: null, cancelledAt: new Date(now) } };
}

function expire(run, { now = new Date() } = {}) {
  if (TERMINAL.has(run.status)) return _fail('terminal_run');
  if (!_validDate(now) || now < run.expiresAt) return _fail('not_expired');
  return { ok: true, run: { ...run, status: STATUSES.EXPIRED, cargoToken: null } };
}

module.exports = { STATUSES, TERMINAL, createAssignedRun, pickup, complete, cancel, expire };

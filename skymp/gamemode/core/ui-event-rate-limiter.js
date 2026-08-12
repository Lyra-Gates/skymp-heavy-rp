/**
 * Contador por emissor e tipo de evento da CEF.
 *
 * Por padrao ele apenas mede: o limite fica desligado ate existirem metricas de
 * uma sessao real. Quando a operacao definir os dois valores de ambiente, o
 * mesmo componente passa a rejeitar de forma deterministica e auditavel.
 */

const DEFAULT_WINDOW_MS = 60_000;

function positiveIntegerOr(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * @param {{windowMs?: number, maxEvents?: number, now?: () => number}} [options]
 */
function createUiEventRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  maxEvents = 0,
  now = Date.now
} = {}) {
  const resolvedWindowMs = positiveIntegerOr(windowMs, DEFAULT_WINDOW_MS);
  const resolvedMaxEvents = Number.isSafeInteger(maxEvents) && maxEvents > 0 ? maxEvents : 0;
  const buckets = new Map();
  const metrics = { observed: 0, rejected: 0, byType: new Map() };

  function observe(actorId, type) {
    const timestamp = now();
    const key = `${actorId}:${type}`;
    let bucket = buckets.get(key);
    if (!bucket || timestamp - bucket.startedAt >= resolvedWindowMs) {
      bucket = { startedAt: timestamp, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count++;
    metrics.observed++;
    metrics.byType.set(type, (metrics.byType.get(type) || 0) + 1);

    const allowed = resolvedMaxEvents === 0 || bucket.count <= resolvedMaxEvents;
    if (!allowed) metrics.rejected++;
    return { allowed, count: bucket.count, limit: resolvedMaxEvents };
  }

  function snapshot() {
    return {
      enforcementEnabled: resolvedMaxEvents > 0,
      windowMs: resolvedWindowMs,
      maxEvents: resolvedMaxEvents,
      observed: metrics.observed,
      rejected: metrics.rejected,
      byType: Object.fromEntries(metrics.byType)
    };
  }

  return { observe, snapshot };
}

module.exports = { createUiEventRateLimiter, DEFAULT_WINDOW_MS };

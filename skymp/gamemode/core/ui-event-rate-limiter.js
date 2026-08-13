/**
 * Contador por emissor e tipo de evento da CEF.
 *
 * Por padrao ele apenas mede: o limite fica desligado ate existirem metricas de
 * uma sessao real. Quando a operacao definir os dois valores de ambiente, o
 * mesmo componente passa a rejeitar de forma deterministica e auditavel.
 *
 * ─── Política por tipo (13/08/2026) ─────────────────────────────────────────
 *
 * O teto global continua sendo o padrão, e continua desligado. O que passou a
 * existir é a possibilidade de um tipo ter o seu.
 *
 * O caso que forçou isso são os dois eventos do Interaction Framework, que têm
 * perfis opostos: `interaction:query` acontece toda vez que alguém mira em
 * alguém — dezenas por minuto, barato, sem efeito colateral —, e
 * `interaction:execute` move ouro e inventário — unidades por minuto, caro,
 * irreversível. Um teto único ou estrangula a consulta ou libera a execução.
 *
 * A política é **opcional e por tipo**: sem entrada no mapa, o tipo cai no
 * comportamento global de sempre. Isso mantém a disciplina que este arquivo já
 * tinha — medir antes de limitar — para todo tipo que ainda não foi medido.
 */

const DEFAULT_WINDOW_MS = 60_000;

function positiveIntegerOr(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function positiveIntegerOrZero(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * @param {{
 *   windowMs?: number,
 *   maxEvents?: number,
 *   policies?: Record<string, {maxEvents?: number, windowMs?: number}>,
 *   now?: () => number
 * }} [options]
 */
function createUiEventRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  maxEvents = 0,
  policies = {},
  now = Date.now
} = {}) {
  const resolvedWindowMs = positiveIntegerOr(windowMs, DEFAULT_WINDOW_MS);
  const resolvedMaxEvents = positiveIntegerOrZero(maxEvents);

  // Resolvida uma vez no construtor, e não a cada evento: o caminho quente é
  // uma leitura de `Map`, não uma reinterpretação de configuração.
  /** @type {Map<string, {maxEvents: number, windowMs: number}>} */
  const resolvedPolicies = new Map();
  for (const [type, policy] of Object.entries(policies || {})) {
    resolvedPolicies.set(type, {
      maxEvents: policy && policy.maxEvents !== undefined
        ? positiveIntegerOrZero(policy.maxEvents)
        : resolvedMaxEvents,
      windowMs: policy && policy.windowMs !== undefined
        ? positiveIntegerOr(policy.windowMs, resolvedWindowMs)
        : resolvedWindowMs
    });
  }

  const buckets = new Map();
  const metrics = { observed: 0, rejected: 0, byType: new Map(), rejectedByType: new Map() };

  function policyFor(type) {
    return resolvedPolicies.get(type) || { maxEvents: resolvedMaxEvents, windowMs: resolvedWindowMs };
  }

  function observe(actorId, type) {
    const timestamp = now();
    const policy = policyFor(type);
    const key = `${actorId}:${type}`;
    let bucket = buckets.get(key);
    if (!bucket || timestamp - bucket.startedAt >= policy.windowMs) {
      bucket = { startedAt: timestamp, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count++;
    metrics.observed++;
    metrics.byType.set(type, (metrics.byType.get(type) || 0) + 1);

    const allowed = policy.maxEvents === 0 || bucket.count <= policy.maxEvents;
    if (!allowed) {
      metrics.rejected++;
      metrics.rejectedByType.set(type, (metrics.rejectedByType.get(type) || 0) + 1);
    }
    return { allowed, count: bucket.count, limit: policy.maxEvents, windowMs: policy.windowMs };
  }

  function snapshot() {
    return {
      enforcementEnabled: resolvedMaxEvents > 0 ||
        Array.from(resolvedPolicies.values()).some(p => p.maxEvents > 0),
      windowMs: resolvedWindowMs,
      maxEvents: resolvedMaxEvents,
      policies: Object.fromEntries(resolvedPolicies),
      observed: metrics.observed,
      rejected: metrics.rejected,
      byType: Object.fromEntries(metrics.byType),
      rejectedByType: Object.fromEntries(metrics.rejectedByType)
    };
  }

  return { observe, snapshot };
}

module.exports = { createUiEventRateLimiter, DEFAULT_WINDOW_MS };

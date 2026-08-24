'use strict';

const crypto = require('crypto');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const DURATION_BUCKETS_MS = [10, 50, 100, 250, 500, 1_000, 5_000];
const MAX_SERIES = 256;

function emptyDuration() {
  return { count: 0, sumMs: 0, maxMs: 0, buckets: Object.fromEntries(DURATION_BUCKETS_MS.map(v => [`le_${v}`, 0])) };
}

function observeDuration(metric, durationMs) {
  const value = Math.max(0, Number(durationMs) || 0);
  metric.count++;
  metric.sumMs += value;
  metric.maxMs = Math.max(metric.maxMs, value);
  for (const boundary of DURATION_BUCKETS_MS) {
    if (value <= boundary) metric.buckets[`le_${boundary}`]++;
  }
}

function createRuntimeMetrics({
  service,
  now = Date.now,
  monotonicNow = () => Number(process.hrtime.bigint()) / 1e6,
  memoryUsage = process.memoryUsage,
  cpuUsage = process.cpuUsage,
  randomUUID = crypto.randomUUID
} = {}) {
  if (typeof service !== 'string' || !service.trim()) throw new Error('service must be set');

  const startedAtMs = now();
  const requests = new Map();
  const db = { success: emptyDuration(), error: emptyDuration() };
  const rejections = new Map();

  function boundedKey(map, key) {
    if (map.has(key) || map.size < MAX_SERIES) return key;
    return 'other';
  }

  function recordRequest(method, route, statusCode, durationMs) {
    const statusClass = `${Math.floor(Number(statusCode) / 100)}xx`;
    const rawKey = `${String(method || 'UNKNOWN').toUpperCase()} ${String(route || 'unmatched')} ${statusClass}`;
    const key = boundedKey(requests, rawKey);
    if (!requests.has(key)) requests.set(key, emptyDuration());
    observeDuration(requests.get(key), durationMs);
  }

  function recordRejection(reason) {
    const safeReason = /^[a-z0-9_:-]{1,64}$/.test(String(reason)) ? String(reason) : 'other';
    const key = boundedKey(rejections, safeReason);
    rejections.set(key, (rejections.get(key) || 0) + 1);
  }

  async function timeDb(fn) {
    const started = monotonicNow();
    try {
      const result = await fn();
      observeDuration(db.success, monotonicNow() - started);
      return result;
    } catch (err) {
      observeDuration(db.error, monotonicNow() - started);
      throw err;
    }
  }

  function middleware(req, res, next) {
    const incoming = req.get && req.get('X-Request-Id');
    const requestId = REQUEST_ID_PATTERN.test(String(incoming || '')) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const started = monotonicNow();
    res.once('finish', () => {
      const routePath = req.route && req.route.path ? req.route.path : 'unmatched';
      const route = `${req.baseUrl || ''}${Array.isArray(routePath) ? routePath.join('|') : routePath}`;
      recordRequest(req.method, route, res.statusCode, monotonicNow() - started);
    });
    next();
  }

  function snapshot() {
    const memory = memoryUsage();
    const cpu = cpuUsage();
    return {
      service,
      startedAt: new Date(startedAtMs).toISOString(),
      uptimeSeconds: Math.max(0, Math.floor((now() - startedAtMs) / 1000)),
      process: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system
      },
      requests: Object.fromEntries([...requests.entries()].sort(([a], [b]) => a.localeCompare(b))),
      db,
      rejections: Object.fromEntries([...rejections.entries()].sort(([a], [b]) => a.localeCompare(b)))
    };
  }

  return { middleware, recordRequest, recordRejection, timeDb, snapshot };
}

module.exports = { createRuntimeMetrics, DURATION_BUCKETS_MS, MAX_SERIES, REQUEST_ID_PATTERN };

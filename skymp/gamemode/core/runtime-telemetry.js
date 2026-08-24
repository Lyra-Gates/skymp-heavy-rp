'use strict';

const DEFAULT_INTERVAL_MS = 60_000;

function createRuntimeTelemetry({
  connectionMonitor,
  uiEventRateLimiter,
  moduleRegistry,
  processApi = process,
  logger = console,
  intervalMs = DEFAULT_INTERVAL_MS
}) {
  if (!connectionMonitor || typeof connectionMonitor.snapshot !== 'function') throw new Error('connectionMonitor invalido');
  if (!uiEventRateLimiter || typeof uiEventRateLimiter.snapshot !== 'function') throw new Error('uiEventRateLimiter invalido');
  if (!moduleRegistry || typeof moduleRegistry.healthCheckAll !== 'function') throw new Error('moduleRegistry invalido');
  let timer = null;

  function snapshot() {
    const memory = processApi.memoryUsage();
    const cpu = processApi.cpuUsage();
    const modules = moduleRegistry.healthCheckAll().map(entry => ({ id: entry.id, healthy: entry.healthy === true }));
    return {
      connections: connectionMonitor.snapshot(),
      uiEvents: uiEventRateLimiter.snapshot(),
      modules,
      process: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system
      }
    };
  }

  function emit() {
    const value = snapshot();
    logger.log('[phase0] runtime metrics:', JSON.stringify(value));
    return value;
  }

  function start() {
    if (timer) return timer;
    timer = setInterval(emit, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { snapshot, emit, start, stop };
}

module.exports = { createRuntimeTelemetry, DEFAULT_INTERVAL_MS };

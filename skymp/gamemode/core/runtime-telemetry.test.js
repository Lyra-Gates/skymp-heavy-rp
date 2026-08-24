const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createRuntimeTelemetry } = require('./runtime-telemetry');

describe('runtime telemetry', () => {
  it('agrega somente métricas sem identificadores ou texto de erro', () => {
    const logs = [];
    const telemetry = createRuntimeTelemetry({
      connectionMonitor: { snapshot: () => ({ active: 2, totals: { connections: 3 } }) },
      uiEventRateLimiter: { snapshot: () => ({ observed: 10, rejected: 1 }) },
      moduleRegistry: {
        healthCheckAll: () => [
          { id: 'economy', healthy: true },
          { id: 'secret-module', healthy: false, error: 'DB_PASS=never-log-this' }
        ]
      },
      processApi: {
        memoryUsage: () => ({ rss: 1, heapUsed: 2, external: 3 }),
        cpuUsage: () => ({ user: 4, system: 5 })
      },
      logger: { log: (...args) => logs.push(args) }
    });
    const snapshot = telemetry.emit();
    assert.equal(snapshot.connections.active, 2);
    assert.deepEqual(snapshot.modules[1], { id: 'secret-module', healthy: false });
    assert.doesNotMatch(JSON.stringify(snapshot), /never-log-this|DB_PASS/);
    assert.equal(logs.length, 1);
  });

  it('valida dependências para não criar telemetria silenciosamente vazia', () => {
    assert.throws(() => createRuntimeTelemetry({}), /connectionMonitor/);
  });
});

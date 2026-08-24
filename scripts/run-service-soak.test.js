'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { parseArgs, probe, runSoak } = require('./run-service-soak');

describe('run-service-soak', () => {
  it('valida limites, protocolo e remove credenciais da URL', () => {
    const options = parseArgs(['--url', 'http://user:pass@localhost:3001/health', '--workers', '2']);
    assert.deepEqual(options.urls, ['http://localhost:3001/health']);
    assert.equal(options.workers, 2);
    assert.throws(() => parseArgs(['--url', 'file:///tmp/x']), /Protocolo não permitido/);
    assert.throws(() => parseArgs(['--url', 'http://localhost', '--workers', '0']), /entre 1 e 100/);
  });

  it('agrega sucesso sem armazenar corpo, IP, token ou requestId', async () => {
    const stats = {
      url: 'http://localhost/health', requests: 0, successes: 0, failures: 0, timeouts: 0,
      statusClasses: {}, errors: {}, latencyBuckets: { 25: 0, 50: 0, 100: 0, 250: 0, 500: 0, 1000: 0, 2500: 0, 5000: 0, Infinity: 0 },
      latencyTotalMs: 0, latencyMaxMs: 0
    };
    let cancelled = false;
    await probe(stats.url, 500, stats, async () => ({
      ok: true, status: 200, body: { cancel: async () => { cancelled = true; } }
    }));
    assert.equal(stats.requests, 1);
    assert.equal(stats.successes, 1);
    assert.equal(cancelled, true);
    assert.ok(!JSON.stringify(stats).includes('x-request-id'));
  });

  it('falha o gate quando a taxa de erro excede o limite', async () => {
    let clock = 0;
    const report = await runSoak({
      urls: ['http://localhost/health'], durationSeconds: 1, workers: 1,
      intervalMs: 100, timeoutMs: 100, maxErrorRate: 0, output: null
    }, {
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      fetchImpl: async () => { clock += 1; return { ok: false, status: 503, body: { cancel: async () => {} } }; }
    });
    assert.equal(report.passed, false);
    assert.equal(report.targets[0].requests, 10);
    assert.equal(report.targets[0].failures, 10);
    assert.equal(report.targets[0].statusClasses['5xx'], 10);
  });
});

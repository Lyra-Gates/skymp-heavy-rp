const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { describe, it } = require('node:test');
const { createRuntimeMetrics, MAX_SERIES } = require('./runtimeMetrics');

function fixture() {
  let wall = Date.parse('2026-08-24T12:00:00Z');
  let monotonic = 100;
  const metrics = createRuntimeMetrics({
    service: 'test',
    now: () => wall,
    monotonicNow: () => monotonic,
    memoryUsage: () => ({ rss: 10, heapUsed: 20, external: 30 }),
    cpuUsage: () => ({ user: 40, system: 50 }),
    randomUUID: () => 'generated-request-id'
  });
  return { metrics, advance: ms => { wall += ms; monotonic += ms; } };
}

describe('runtime metrics', () => {
  it('mede rota normalizada, classe de status e propaga request id válido', () => {
    const { metrics, advance } = fixture();
    const req = { method: 'GET', baseUrl: '', route: null, get: () => 'request-1234' };
    const res = new EventEmitter();
    res.statusCode = 204;
    res.setHeader = (name, value) => { res.headers = { [name]: value }; };

    metrics.middleware(req, res, () => {});
    req.route = { path: '/users/:id' };
    advance(12);
    res.emit('finish');

    assert.equal(req.requestId, 'request-1234');
    assert.equal(res.headers['X-Request-Id'], 'request-1234');
    assert.equal(metrics.snapshot().requests['GET /users/:id 2xx'].count, 1);
  });

  it('não aceita request id arbitrário e não cria série por URL concreta', () => {
    const { metrics } = fixture();
    const req = { method: 'GET', url: '/users/secret-person', get: () => 'inválido com espaço' };
    const res = new EventEmitter();
    res.statusCode = 404;
    res.setHeader = () => {};
    metrics.middleware(req, res, () => {});
    res.emit('finish');
    assert.equal(req.requestId, 'generated-request-id');
    assert.ok(metrics.snapshot().requests['GET unmatched 4xx']);
  });

  it('mede sucesso e erro de banco sem registrar SQL ou parâmetros', async () => {
    const { metrics, advance } = fixture();
    await metrics.timeDb(async () => { advance(7); return 42; });
    await assert.rejects(metrics.timeDb(async () => { advance(11); throw new Error('DB_PASS=secret'); }));
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.db.success.count, 1);
    assert.equal(snapshot.db.error.count, 1);
    assert.doesNotMatch(JSON.stringify(snapshot), /secret|DB_PASS/);
  });

  it('limita cardinalidade de séries e sanitiza motivos', () => {
    const { metrics } = fixture();
    for (let i = 0; i < MAX_SERIES + 20; i++) metrics.recordRequest('GET', `/route-${i}`, 200, 1);
    metrics.recordRejection('invalid_ticket');
    metrics.recordRejection('account:123 private text');
    const snapshot = metrics.snapshot();
    assert.ok(Object.keys(snapshot.requests).length <= MAX_SERIES + 1);
    assert.deepEqual(snapshot.rejections, { invalid_ticket: 1, other: 1 });
  });
});

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createUiEventRateLimiter } = require('./ui-event-rate-limiter');

describe('ui-event-rate-limiter', () => {
  it('mede todos os eventos sem limitar enquanto nao houver configuracao operacional', () => {
    const limiter = createUiEventRateLimiter({ now: () => 1000 });
    assert.equal(limiter.observe(1, 'panel:refresh:status').allowed, true);
    assert.equal(limiter.observe(1, 'panel:refresh:status').allowed, true);
    assert.deepEqual(limiter.snapshot(), {
      enforcementEnabled: false,
      windowMs: 60_000,
      maxEvents: 0,
      observed: 2,
      rejected: 0,
      byType: { 'panel:refresh:status': 2 }
    });
  });

  it('aplica o limite configurado por actorId e type, sem misturar jogadores', () => {
    let timestamp = 1000;
    const limiter = createUiEventRateLimiter({ windowMs: 100, maxEvents: 2, now: () => timestamp });
    assert.equal(limiter.observe(1, 'panel:open').allowed, true);
    assert.equal(limiter.observe(1, 'panel:open').allowed, true);
    assert.equal(limiter.observe(1, 'panel:open').allowed, false);
    assert.equal(limiter.observe(2, 'panel:open').allowed, true);
    timestamp += 100;
    assert.equal(limiter.observe(1, 'panel:open').allowed, true);
    assert.equal(limiter.snapshot().rejected, 1);
  });
});

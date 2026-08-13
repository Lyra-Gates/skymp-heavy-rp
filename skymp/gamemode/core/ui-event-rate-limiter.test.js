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
      policies: {},
      observed: 2,
      rejected: 0,
      byType: { 'panel:refresh:status': 2 },
      rejectedByType: {}
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

  // A política por tipo nasceu para os dois eventos do Interaction Framework:
  // `interaction:query` acontece a cada mira (barato, sem efeito colateral) e
  // `interaction:execute` move ouro (caro, irreversível). Um teto único ou
  // estrangula o primeiro ou libera o segundo.
  it('aplica politica por tipo sem afetar os tipos sem politica', () => {
    const limiter = createUiEventRateLimiter({
      windowMs: 1000,
      maxEvents: 0, // global desligado, como em producao hoje
      policies: { 'interaction:execute': { maxEvents: 2 } },
      now: () => 1000
    });

    assert.equal(limiter.observe(1, 'interaction:execute').allowed, true);
    assert.equal(limiter.observe(1, 'interaction:execute').allowed, true);
    assert.equal(limiter.observe(1, 'interaction:execute').allowed, false);

    // Sem politica propria: continua no comportamento global (medir, nao limitar).
    for (let i = 0; i < 50; i++) {
      assert.equal(limiter.observe(1, 'interaction:query').allowed, true);
    }

    const snapshot = limiter.snapshot();
    assert.equal(snapshot.enforcementEnabled, true, 'uma politica com teto liga a fiscalizacao');
    assert.deepEqual(snapshot.rejectedByType, { 'interaction:execute': 1 });
  });

  it('politica por tipo tem janela propria', () => {
    let timestamp = 0;
    const limiter = createUiEventRateLimiter({
      windowMs: 60_000,
      maxEvents: 1,
      policies: { 'interaction:query': { maxEvents: 1, windowMs: 10 } },
      now: () => timestamp
    });

    assert.equal(limiter.observe(1, 'interaction:query').allowed, true);
    assert.equal(limiter.observe(1, 'interaction:query').allowed, false);
    timestamp += 10; // a janela curta do tipo virou
    assert.equal(limiter.observe(1, 'interaction:query').allowed, true);

    // O tipo sem politica continua na janela global de 60s.
    assert.equal(limiter.observe(1, 'panel:open').allowed, true);
    assert.equal(limiter.observe(1, 'panel:open').allowed, false);
  });
});

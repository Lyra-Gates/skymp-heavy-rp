const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createMemoryRateLimiter } = require('./rateLimiter');

describe('memory rate limiter', () => {
    it('permite ate o limite e bloqueia sem prolongar a janela', () => {
        let timestamp = 1_000;
        const limiter = createMemoryRateLimiter({ now: () => timestamp });

        assert.equal(limiter.isRateLimited('ip:1', 2, 100), false);
        assert.equal(limiter.isRateLimited('ip:1', 2, 100), false);
        assert.equal(limiter.isRateLimited('ip:1', 2, 100), true);
        timestamp += 100;
        assert.equal(limiter.isRateLimited('ip:1', 2, 100), false);
    });

    it('mantem quantidade de buckets limitada sob chaves adversariais', () => {
        const limiter = createMemoryRateLimiter({ maxBuckets: 3, now: () => 1_000 });
        for (let i = 0; i < 100; i++) limiter.isRateLimited(`ip:${i}`, 1, 60_000);
        assert.equal(limiter.size(), 3);
    });

    it('uma origem bloqueada nao cria entradas adicionais', () => {
        const limiter = createMemoryRateLimiter({ now: () => 1_000 });
        for (let i = 0; i < 100_000; i++) limiter.isRateLimited('ip:1', 1, 60_000);
        assert.equal(limiter.size(), 1);
    });
});

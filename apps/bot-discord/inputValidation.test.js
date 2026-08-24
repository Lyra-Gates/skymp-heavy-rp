const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { isDiscordSnowflake } = require('./inputValidation');

describe('Discord input validation', () => {
    it('aceita snowflakes decimais dentro do tamanho suportado', () => {
        assert.equal(isDiscordSnowflake('12345678901234567'), true);
        assert.equal(isDiscordSnowflake('12345678901234567890'), true);
    });

    it('rejeita tipos, caracteres e tamanhos inválidos', () => {
        for (const value of [null, 123, '', '1234567890123456', '123456789012345678901', '1234567890123456a']) {
            assert.equal(isDiscordSnowflake(value), false, String(value));
        }
    });
});

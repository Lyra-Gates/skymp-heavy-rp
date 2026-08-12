const test = require('node:test');
const assert = require('node:assert/strict');
const { generate, hash, parse, redact } = require('./opaque-credential');

test('opaque credential — gera 256 bits opacos com tipo e audience esperados', () => {
  const token = generate('game_session', (size) => Buffer.alloc(size, 7));
  assert.match(token, /^hrp_gs_v1_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(parse(token), {
    version: 1,
    kind: 'game_session',
    audience: 'skymp:master-api',
    reusable: true
  });
});

test('opaque credential — tipos têm prefixes e capabilities separados', () => {
  assert.equal(parse(generate('launch_grant')).kind, 'launch_grant');
  assert.equal(parse(generate('queue_grant')).audience, 'game-api:poll');
  assert.equal(parse(generate('game_session')).reusable, true);
});

test('opaque credential — rejeita antes do banco formato, versão e tipo inválidos', () => {
  for (const token of [null, '', 'hrp_xx_v1_A'.repeat(20), 'hrp_lg_v2_' + 'A'.repeat(43),
    'hrp_lg_v1_' + 'A'.repeat(42), 'hrp_lg_v1_' + 'ç'.repeat(43)]) {
    assert.equal(parse(token), null);
  }
});

test('opaque credential — hash é determinístico, hexadecimal e não contém token', () => {
  const token = generate('launch_grant', (size) => Buffer.alloc(size, 3));
  const digest = hash(token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, hash(token));
  assert.equal(digest.includes(token), false);
  assert.throws(() => hash('malformado'), /malformada/);
});

test('opaque credential — redaction cobre segredos aninhados sem mutar entrada', () => {
  const input = {
    accountId: 42,
    session: 'secret-a',
    nested: { masterKey: 'secret-b', value: 7 },
    list: [{ authorization: 'secret-c', ok: true }]
  };
  const clean = redact(input);
  assert.deepEqual(clean, {
    accountId: 42,
    session: '[REDACTED]',
    nested: { masterKey: '[REDACTED]', value: 7 },
    list: [{ authorization: '[REDACTED]', ok: true }]
  });
  assert.equal(input.session, 'secret-a');
});


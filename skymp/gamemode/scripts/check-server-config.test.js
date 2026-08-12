const test = require('node:test');
const assert = require('node:assert/strict');
const { validateServerConfig } = require('./check-server-config');

function valid(overrides = {}) {
  return {
    offlineMode: false,
    master: 'https://master.example.invalid',
    masterKey: 'a'.repeat(48),
    listenHost: '0.0.0.0',
    isPapyrusHotReloadEnabled: false,
    ...overrides
  };
}

test('config doctor — aprova configuração de produção segura', () => {
  assert.deepEqual(validateServerConfig(valid(), { environment: 'production' }), []);
});

test('config doctor — reprova offlineMode fora do local', () => {
  const findings = validateServerConfig(valid({ offlineMode: true }), { environment: 'staging' });
  assert.ok(findings.some((f) => f.code === 'AUTH_OFFLINE_MODE' && f.level === 'ERROR'));
});

test('config doctor — local pode usar offline mode, mas não masterKey fraca', () => {
  assert.equal(validateServerConfig(valid({ offlineMode: true }), { environment: 'local' }).length, 0);
  assert.ok(validateServerConfig(valid({ offlineMode: true, masterKey: 'short' }), { environment: 'local' })
    .some((f) => f.code === 'AUTH_MASTER_KEY_WEAK'));
});

test('config doctor — produção exige TLS, master e sem placeholder', () => {
  const findings = validateServerConfig(valid({ master: 'http://127.0.0.1:3001', masterKey: 'replace-with-production-master-key' }),
    { environment: 'production' });
  assert.ok(findings.some((f) => f.code === 'AUTH_MASTER_TLS'));
  assert.ok(findings.some((f) => f.code === 'AUTH_MASTER_KEY_PLACEHOLDER'));
});

test('config doctor — hot reload é fail-closed em produção', () => {
  const findings = validateServerConfig(valid({ isPapyrusHotReloadEnabled: true }), { environment: 'production' });
  assert.ok(findings.some((f) => f.code === 'DEBUG_HOT_RELOAD'));
});

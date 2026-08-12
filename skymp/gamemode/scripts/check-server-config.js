const fs = require('fs');
const path = require('path');

const PLACEHOLDER = /replace[-_ ]?with|changeme|example|your[-_ ]|<.+>/i;

function validateServerConfig(config, options = {}) {
  const environment = options.environment || 'production';
  const findings = [];
  const error = (code, message) => findings.push({ level: 'ERROR', code, message });
  const warn = (code, message) => findings.push({ level: 'WARN', code, message });

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    error('CONFIG_INVALID', 'configuração deve ser um objeto JSON');
    return findings;
  }
  if (environment !== 'local' && config.offlineMode !== false) {
    error('AUTH_OFFLINE_MODE', 'offlineMode deve ser false fora do laboratório local');
  }
  if (environment !== 'local' && (!config.master || typeof config.master !== 'string')) {
    error('AUTH_MASTER_MISSING', 'Master API é obrigatória fora do laboratório local');
  }
  if (environment === 'production' && typeof config.master === 'string' && !config.master.startsWith('https://')) {
    error('AUTH_MASTER_TLS', 'Master API de produção deve usar HTTPS');
  }
  if (typeof config.masterKey !== 'string' || config.masterKey.length < 32) {
    error('AUTH_MASTER_KEY_WEAK', 'masterKey deve ter pelo menos 32 caracteres');
  } else if (PLACEHOLDER.test(config.masterKey)) {
    error('AUTH_MASTER_KEY_PLACEHOLDER', 'masterKey ainda contém placeholder');
  }
  if (environment === 'production' && config.isPapyrusHotReloadEnabled === true) {
    error('DEBUG_HOT_RELOAD', 'Papyrus hot reload não pode ficar ativo em produção');
  }
  if (environment === 'production' && ['127.0.0.1', 'localhost'].includes(config.listenHost)) {
    warn('NETWORK_LOOPBACK', 'listenHost de produção está limitado ao loopback');
  }
  return findings;
}

function main(argv = process.argv.slice(2)) {
  const fileArg = argv.find((arg) => !arg.startsWith('--'));
  const envArg = argv.find((arg) => arg.startsWith('--environment='));
  if (!fileArg) {
    console.error('Uso: node check-server-config.js <server-settings.json> --environment=local|staging|production');
    return 2;
  }
  const environment = envArg ? envArg.split('=')[1] : 'production';
  const resolved = path.resolve(fileArg);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    console.error(`[config-doctor] CONFIG_READ: ${err.message}`);
    return 2;
  }
  const findings = validateServerConfig(config, { environment });
  for (const finding of findings) console.error(`[config-doctor] ${finding.level} ${finding.code}: ${finding.message}`);
  if (findings.some((finding) => finding.level === 'ERROR')) return 1;
  console.log(`[config-doctor] OK: ${resolved} (${environment})`);
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { main, validateServerConfig };

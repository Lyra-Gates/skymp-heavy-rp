#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const values = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function isPlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || normalized.includes('seu_')
    || normalized.includes('seu-usuario')
    || normalized.includes('changeme')
    || normalized.includes('change_me')
    || normalized.includes('dummy')
    || /^<.*>$/.test(normalized);
}

function auditProductionConfig(configs, { skipDb = false } = {}) {
  const issues = [];
  const add = (service, key, reason) => issues.push({ service, key, reason });
  const required = (service, env, key) => {
    if (isPlaceholder(env[key])) add(service, key, 'ausente ou placeholder');
  };
  const secret = (service, env, key) => {
    required(service, env, key);
    if (env[key] && env[key].length < 32) add(service, key, 'precisa ter pelo menos 32 caracteres');
  };
  const https = (service, env, key) => {
    required(service, env, key);
    if (env[key] && !String(env[key]).startsWith('https://')) add(service, key, 'precisa usar HTTPS em produção');
  };

  const web = configs.web || {};
  const gameApi = configs.gameApi || {};
  const bot = configs.bot || {};
  const launcher = configs.launcher || {};

  secret('web', web, 'SESSION_SECRET');
  secret('web', web, 'INTERNAL_API_SECRET');
  secret('web', web, 'MASTER_KEY');
  required('web', web, 'DISCORD_CLIENT_ID');
  required('web', web, 'DISCORD_CLIENT_SECRET');
  https('web', web, 'PANEL_PUBLIC_URL');
  https('web', web, 'DISCORD_CALLBACK_URL');
  if (web.NODE_ENV !== 'production') add('web', 'NODE_ENV', 'precisa ser production');
  if (web.TRUST_PROXY !== 'true') add('web', 'TRUST_PROXY', 'precisa ser true atrás do proxy público');

  secret('game-api', gameApi, 'INTERNAL_API_SECRET');
  required('game-api', gameApi, 'GAME_API_BIND_HOST');
  required('game-api', gameApi, 'MODS_MANIFEST_PATH');

  secret('bot', bot, 'INTERNAL_API_SECRET');
  required('bot', bot, 'DISCORD_BOT_TOKEN');
  required('bot', bot, 'DISCORD_CLIENT_ID');
  required('bot', bot, 'GUILD_ID');
  required('bot', bot, 'WHITELIST_ROLE_ID');

  required('launcher', launcher, 'VITE_SERVER_IP');
  required('launcher', launcher, 'VITE_DISCORD_CLIENT_ID');
  required('launcher', launcher, 'VITE_GITHUB_DIST_REPO');
  https('launcher', launcher, 'VITE_PANEL_URL');

  if (!skipDb) {
    for (const [service, env] of [['web', web], ['game-api', gameApi]]) {
      for (const key of ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME']) required(service, env, key);
    }
  }

  const internalSecrets = [web.INTERNAL_API_SECRET, gameApi.INTERNAL_API_SECRET, bot.INTERNAL_API_SECRET]
    .filter(value => !isPlaceholder(value));
  if (internalSecrets.length === 3 && new Set(internalSecrets).size !== 1) {
    add('cross-service', 'INTERNAL_API_SECRET', 'precisa ser o mesmo no painel, Game API e bot');
  }

  return issues;
}

function parseArgs(argv) {
  const args = { skipDb: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--skip-db') args.skipDb = true;
    else if (argv[index].startsWith('--')) args[argv[index].slice(2)] = argv[++index];
  }
  return args;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseEnv(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const locations = {
    web: path.resolve(args.web || path.join(root, 'apps', 'web', '.env')),
    gameApi: path.resolve(args['game-api'] || path.join(root, 'apps', 'game-api', '.env')),
    bot: path.resolve(args.bot || path.join(root, 'apps', 'bot-discord', '.env')),
    launcher: path.resolve(args.launcher || path.join(root, 'apps', 'launcher', '.env'))
  };
  const configs = {};
  let missing = false;
  for (const [service, location] of Object.entries(locations)) {
    configs[service] = readEnvFile(location);
    if (!configs[service]) {
      console.error(`[FALHA] ${service}: arquivo de ambiente ausente (${location})`);
      missing = true;
      configs[service] = {};
    }
  }

  const issues = auditProductionConfig(configs, { skipDb: args.skipDb });
  for (const issue of issues) {
    console.error(`[FALHA] ${issue.service}.${issue.key}: ${issue.reason}`);
  }
  if (missing || issues.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`[OK] configuracao de producao aprovada${args.skipDb ? ' (campos de banco ignorados)' : ''}.`);
}

if (require.main === module) main();

module.exports = { parseEnv, isPlaceholder, auditProductionConfig };

'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { parseEnv, isPlaceholder, auditProductionConfig } = require('./check-production-config');

const SECRET = 'a'.repeat(40);

function validConfigs() {
  return {
    web: {
      SESSION_SECRET: SECRET,
      INTERNAL_API_SECRET: SECRET,
      MASTER_KEY: 'b'.repeat(40),
      DISCORD_CLIENT_ID: '123456789012345678',
      DISCORD_CLIENT_SECRET: 'discord-secret-real',
      PANEL_PUBLIC_URL: 'https://rp.example.org',
      DISCORD_CALLBACK_URL: 'https://rp.example.org/api/auth/discord/callback',
      NODE_ENV: 'production',
      TRUST_PROXY: 'true'
    },
    gameApi: {
      INTERNAL_API_SECRET: SECRET,
      GAME_API_BIND_HOST: '0.0.0.0',
      MODS_MANIFEST_PATH: './mods.json'
    },
    bot: {
      INTERNAL_API_SECRET: SECRET,
      DISCORD_BOT_TOKEN: 'token-real',
      DISCORD_CLIENT_ID: '123456789012345678',
      GUILD_ID: '123456789012345678',
      WHITELIST_ROLE_ID: '123456789012345678'
    },
    launcher: {
      VITE_SERVER_IP: '203.0.113.10',
      VITE_DISCORD_CLIENT_ID: '123456789012345678',
      VITE_GITHUB_DIST_REPO: 'owner/distribution',
      VITE_PANEL_URL: 'https://rp.example.org'
    }
  };
}

describe('parser de .env', () => {
  test('ignora comentários e remove aspas externas', () => {
    assert.deepEqual(parseEnv('# x\nA=1\nB="dois"\nC=\'tres\''), { A: '1', B: 'dois', C: 'tres' });
  });

  test('reconhece placeholders sem imprimir valores', () => {
    assert.equal(isPlaceholder('SEU_CLIENT_ID_AQUI'), true);
    assert.equal(isPlaceholder('owner/repo'), false);
  });
});

describe('auditoria de produção', () => {
  test('aprova configuração coerente sem banco', () => {
    assert.deepEqual(auditProductionConfig(validConfigs(), { skipDb: true }), []);
  });

  test('reprova HTTP público, segredo curto e ambiente de desenvolvimento', () => {
    const configs = validConfigs();
    configs.web.PANEL_PUBLIC_URL = 'http://localhost:3001';
    configs.web.SESSION_SECRET = 'curto';
    configs.web.NODE_ENV = 'development';
    const issues = auditProductionConfig(configs, { skipDb: true });
    assert.ok(issues.some(issue => issue.key === 'PANEL_PUBLIC_URL'));
    assert.ok(issues.some(issue => issue.key === 'SESSION_SECRET'));
    assert.ok(issues.some(issue => issue.key === 'NODE_ENV'));
  });

  test('reprova segredo interno divergente entre serviços', () => {
    const configs = validConfigs();
    configs.bot.INTERNAL_API_SECRET = 'c'.repeat(40);
    assert.ok(auditProductionConfig(configs, { skipDb: true }).some(issue => issue.service === 'cross-service'));
  });

  test('campos de banco só são exigidos sem --skip-db', () => {
    assert.ok(auditProductionConfig(validConfigs()).some(issue => issue.key === 'DB_HOST'));
    assert.ok(!auditProductionConfig(validConfigs(), { skipDb: true }).some(issue => issue.key === 'DB_HOST'));
  });
});

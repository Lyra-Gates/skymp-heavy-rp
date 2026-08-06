/**
 * Testes do registro de slash commands.
 *
 * Não tocam a API do Discord: cobrem a validação de ambiente e o contrato de
 * retorno, que é o que decide se uma falha derruba o bot ou só loga.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { deployCommands, collectCommands } = require('./deploy-commands');

const ENV_KEYS = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'GUILD_ID'];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('collectCommands', () => {
  test('devolve os comandos de voz em formato serializado', () => {
    const commands = collectCommands();
    assert.ok(commands.length >= 2);
    const names = commands.map((c) => c.name);
    assert.ok(names.includes('voz-criar'));
    assert.ok(names.includes('voz-fechar'));
  });

  test('todo comando tem nome e descrição', () => {
    for (const c of collectCommands()) {
      assert.ok(c.name, 'comando sem nome');
      assert.ok(c.description, `comando ${c.name} sem descrição`);
    }
  });
});

describe('deployCommands — ambiente incompleto', () => {
  // No boot, faltar configuração não pode derrubar o bot: o sync de whitelist
  // é a função crítica e funciona sem os comandos de voz.
  test('sem env, devolve erro em vez de lançar', async () => {
    const result = await deployCommands();
    assert.equal(result.ok, false);
    assert.match(result.error, /DISCORD_BOT_TOKEN/);
  });

  test('lista TODAS as variáveis faltando, não só a primeira', async () => {
    const result = await deployCommands();
    assert.match(result.error, /DISCORD_BOT_TOKEN/);
    assert.match(result.error, /DISCORD_CLIENT_ID/);
    assert.match(result.error, /GUILD_ID/);
  });

  test('aponta só o que falta quando o resto está presente', async () => {
    process.env.DISCORD_BOT_TOKEN = 'x';
    process.env.DISCORD_CLIENT_ID = 'y';
    const result = await deployCommands();
    assert.equal(result.ok, false);
    assert.match(result.error, /GUILD_ID/);
    assert.ok(!result.error.includes('DISCORD_BOT_TOKEN'), 'não deveria acusar o que está configurado');
  });

  // No uso standalone queremos exit code != 0, então ali sim precisa lançar.
  test('throwOnError faz lançar', async () => {
    await assert.rejects(() => deployCommands({ throwOnError: true }), /faltando no \.env/);
  });
});

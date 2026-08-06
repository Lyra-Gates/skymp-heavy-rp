/**
 * deploy-commands.js
 *
 * Registra os slash commands do bot na guild configurada.
 *
 * Roda automaticamente no boot do bot (`index.js`) — antes era só manual, e
 * nada avisava quando alguém esquecia: o comando simplesmente não aparecia no
 * Discord, sem erro em lugar nenhum. Continua funcionando standalone:
 *
 *   npm run deploy-commands
 *
 * Comandos de guild (não globais) propagam quase instantaneamente — melhor
 * pra um bot de servidor único como este, em vez de comandos globais que
 * levam até 1h pra propagar.
 */
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const voiceChannels = require('./voiceChannels');

/** Fonte única da lista de comandos. Novo módulo de comando entra aqui. */
function collectCommands() {
  return [...voiceChannels.commands].map((c) => c.toJSON());
}

/**
 * Registra os comandos na guild.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.throwOnError] `true` no uso standalone (queremos
 *   exit code != 0); `false` no boot, onde uma falha de registro não deve
 *   derrubar o bot inteiro — sync de whitelist é mais importante que os
 *   comandos de voz, e continua funcionando sem eles.
 * @returns {Promise<{ok: boolean, count?: number, error?: string}>}
 */
async function deployCommands(opts = {}) {
  const { throwOnError = false } = opts;

  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  const missing = [];
  if (!token) missing.push('DISCORD_BOT_TOKEN');
  if (!clientId) missing.push('DISCORD_CLIENT_ID');
  if (!guildId) missing.push('GUILD_ID');

  if (missing.length > 0) {
    const error = `faltando no .env: ${missing.join(', ')}`;
    if (throwOnError) throw new Error(error);
    return { ok: false, error };
  }

  const commands = collectCommands();
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    return { ok: true, count: commands.length };
  } catch (err) {
    if (throwOnError) throw err;
    return { ok: false, error: err.message };
  }
}

module.exports = { deployCommands, collectCommands };

// Execução direta (`node deploy-commands.js`).
if (require.main === module) {
  (async () => {
    try {
      const commands = collectCommands();
      console.log(`[deploy-commands] Registrando ${commands.length} comando(s) na guild ${process.env.GUILD_ID}...`);
      const result = await deployCommands({ throwOnError: true });
      console.log(`[deploy-commands] ${result.count} comando(s) registrado(s) com sucesso.`);
    } catch (err) {
      console.error('[deploy-commands] Falha ao registrar comandos:', err.message);
      process.exit(1);
    }
  })();
}

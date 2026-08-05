/**
 * deploy-commands.js
 *
 * Registra os slash commands do bot na guild configurada. Rodar manualmente
 * sempre que os comandos mudarem:
 *
 *   node deploy-commands.js
 *
 * Comandos de guild (não globais) propagam quase instantaneamente — melhor
 * pra um bot de servidor único como este, em vez de comandos globais que
 * levam até 1h pra propagar.
 */
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const voiceChannels = require('./voiceChannels');

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('[deploy-commands] DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID e GUILD_ID são obrigatórios no .env');
  process.exit(1);
}

const commands = [...voiceChannels.commands].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`[deploy-commands] Registrando ${commands.length} comando(s) na guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('[deploy-commands] Comandos registrados com sucesso.');
  } catch (err) {
    console.error('[deploy-commands] Falha ao registrar comandos:', err);
    process.exit(1);
  }
})();

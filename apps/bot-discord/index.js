require('dotenv').config();
const crypto = require('crypto');
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const app = express();
const voiceChannels = require('./voiceChannels');

app.use(express.json());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates]
});

const GUILD_ID = process.env.GUILD_ID;
const WHITELIST_ROLE_ID = process.env.WHITELIST_ROLE_ID;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const VOICE_CATEGORY_ID = process.env.VOICE_CATEGORY_ID;

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} must be set`);
    }
    return value;
}

requireEnv('DISCORD_BOT_TOKEN');
requireEnv('GUILD_ID');
requireEnv('WHITELIST_ROLE_ID');
requireEnv('INTERNAL_API_SECRET');

client.once('ready', () => {
    console.log(`[discord-bot] Bot logado como ${client.user.tag}`);
});

// Canais de voz temporários (/voz-criar, /voz-fechar) — ver voiceChannels.js.
// Comandos precisam ser registrados separadamente com `node deploy-commands.js`.
client.on('interactionCreate', async (interaction) => {
    try {
        await voiceChannels.handleInteraction(interaction, {
            staffRoleId: STAFF_ROLE_ID,
            voiceCategoryId: VOICE_CATEGORY_ID
        });
    } catch (err) {
        console.error('[discord-bot] Erro ao processar interação:', err.message);
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    voiceChannels.handleVoiceStateUpdate(oldState, newState);
});

// ── Rate limiting simples (janela deslizante em memória) ────────────────────
const rateLimitBuckets = new Map();
function isRateLimited(key, maxRequests, windowMs) {
    const now = Date.now();
    const timestamps = (rateLimitBuckets.get(key) || []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    rateLimitBuckets.set(key, timestamps);
    return timestamps.length > maxRequests;
}

// Comparação em tempo constante para evitar timing attacks no secret interno
function isValidInternalSecret(provided) {
    if (typeof provided !== 'string' || !provided) return false;
    const expected = Buffer.from(INTERNAL_API_SECRET);
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

// Endpoint para receber webhook do Painel Web
app.post('/api/sync-role', async (req, res) => {
    const { discord_id, status } = req.body;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (isRateLimited(`sync-role:${ip}`, 20, 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests' });
    }

    if (!isValidInternalSecret(req.get('X-Internal-Secret'))) {
        console.warn(`[discord-bot] Tentativa de acesso não autorizada a /api/sync-role de ${ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!discord_id) return res.status(400).json({ error: 'Missing discord_id' });
    if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (!GUILD_ID || !WHITELIST_ROLE_ID) return res.status(500).json({ error: 'GUILD_ID or WHITELIST_ROLE_ID not configured' });
    
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discord_id).catch(() => null);
        
        if (!member) {
            console.log(`[discord-bot] Membro ${discord_id} não encontrado na guild.`);
            return res.status(404).json({ error: 'Member not found in guild' });
        }
        
        if (status === 'approved') {
            await member.roles.add(WHITELIST_ROLE_ID);
            console.log(`[discord-bot] Cargo adicionado para ${discord_id}`);
        } else if (status === 'rejected' || status === 'pending') {
            await member.roles.remove(WHITELIST_ROLE_ID);
            console.log(`[discord-bot] Cargo removido para ${discord_id}`);
        }
        
        res.json({ ok: true });
    } catch (err) {
        console.error(`[discord-bot] Erro ao sincronizar:`, err);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

const PORT = process.env.PORT || 3002;
const HOST = '127.0.0.1'; // API interna: nunca expor em todas as interfaces
app.listen(PORT, HOST, () => {
    console.log(`[discord-bot] API interna rodando em http://${HOST}:${PORT}`);
});

client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error("[discord-bot] Falha ao logar no Discord. Verifique o DISCORD_BOT_TOKEN no arquivo .env");
});

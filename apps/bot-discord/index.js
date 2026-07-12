require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const app = express();

app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const GUILD_ID = process.env.GUILD_ID;
const WHITELIST_ROLE_ID = process.env.WHITELIST_ROLE_ID;

client.once('ready', () => {
    console.log(`[discord-bot] Bot logado como ${client.user.tag}`);
});

// Endpoint para receber webhook do Painel Web
app.post('/api/sync-role', async (req, res) => {
    const { discord_id, status } = req.body;
    
    if (!discord_id) return res.status(400).json({ error: 'Missing discord_id' });
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
        } else if (status === 'rejected') {
            await member.roles.remove(WHITELIST_ROLE_ID);
            console.log(`[discord-bot] Cargo removido para ${discord_id}`);
        }
        
        res.json({ ok: true });
    } catch (err) {
        console.error(`[discord-bot] Erro ao sincronizar:`, err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`[discord-bot] API interna rodando na porta ${PORT}`);
});

client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error("[discord-bot] Falha ao logar no Discord. Verifique o DISCORD_BOT_TOKEN no arquivo .env");
});

/**
 * apps/game-api — API do servidor de jogo (porta 7758)
 *
 * O launcher já chamava estes endpoints desde sempre; o serviço é que não
 * existia. Enquanto isso, `verify-mods` sempre falhava com "servidor offline" e
 * a fila nunca respondia — ou seja, a verificação de paridade de modpack, que é
 * a base da regra de Autoridade do Servidor, nunca chegou a rodar.
 *
 * Endpoints públicos (chamados pelo launcher do jogador):
 *   GET  /mods.json             → manifesto de paridade { mods, loadOrder }
 *   POST /api/queue/join        → { ticket } → entra na fila
 *   GET  /api/queue/status      → posição ou ticket de sessão
 *   GET  /health                → diagnóstico
 *
 * Endpoints internos (X-Internal-Secret, chamados pelo gamemode):
 *   POST /internal/session/resolve   → valida ticket de sessão e marca conectado
 *   POST /internal/session/release   → libera o slot na desconexão
 *
 * Por que a fila não aceita `discordId` direto: `discordId` é público. O
 * launcher apresenta um ticket emitido pelo painel (que é quem tem o client
 * secret do Discord e portanto é o único capaz de provar que aquele Discord
 * autenticou de fato). Ver migration-v6-launch-tickets.sql.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');

const { createQueue } = require('./queue');
const { createManifestLoader } = require('./modsManifest');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

const PORT = parseInt(process.env.GAME_API_PORT || '7758', 10);
const HOST = process.env.GAME_API_BIND_HOST || '0.0.0.0';
const MANIFEST_PATH = process.env.MODS_MANIFEST_PATH || path.join(__dirname, 'mods.json');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

const INTERNAL_API_SECRET = requireEnv('INTERNAL_API_SECRET');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'skymp_rp',
  waitForConnections: true,
  connectionLimit: 5
});

const db = async (sql, params = []) => {
  const [rows] = await pool.execute(sql, params);
  return rows;
};

const manifestLoader = createManifestLoader(MANIFEST_PATH);
const queue = createQueue({ capacity: parseInt(process.env.QUEUE_CAPACITY || '40', 10) });

const makeSessionTicket = () => crypto.randomBytes(32).toString('hex');

// Quanto tempo a sessão de jogo vale. Precisa cobrir uma sessão inteira, com
// folga pra reconectar depois de um crash — o servidor de jogo consulta o
// master a cada conexão.
const GAME_SESSION_TTL_SECONDS = parseInt(process.env.GAME_SESSION_TTL_SECONDS || String(12 * 60 * 60), 10);

/**
 * Grava a sessão que o servidor de jogo vai resolver contra o master API
 * (`apps/web`, `GET /api/servers/:masterKey/sessions/:session`).
 *
 * É este registro que faz o `profileId` deixar de ser uma declaração do
 * cliente: o SkyMP com `offlineMode: false` não lê o `profileId` do
 * `skymp_config.json`, ele pergunta ao master quem é o dono da sessão.
 *
 * Guardamos só o hash — se o banco vazar, as sessões em voo não viram
 * credencial. Mesmo critério de `launch_tickets`.
 */
async function persistGameSession(token, accountId, discordId) {
  await db(
    `INSERT INTO game_sessions (token_hash, account_id, discord_id, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [hashTicket(token), accountId, discordId, GAME_SESSION_TTL_SECONDS]
  );
}

/**
 * Persiste a sessão de quem acabou de ser admitido.
 *
 * A fila é síncrona e em memória (pra ser testável sem banco), então a
 * gravação acontece aqui, depois. Se falhar, a admissão é desfeita: entrar na
 * fila e receber um ticket que o servidor de jogo vai recusar seria pior que
 * um erro honesto — o jogador ficaria olhando o Skyrim não conectar sem
 * entender por quê.
 */
async function persistAdmission(result, identity) {
  if (result.status !== 'success' || !result.ticket) return result;
  try {
    await persistGameSession(result.ticket, identity.accountId, identity.discordId);
    return result;
  } catch (err) {
    console.error('[game-api] Falha ao gravar game_session:', err.message);
    queue.release(identity.accountId, makeSessionTicket);
    return { status: 'error', message: 'session_persist_failed' };
  }
}

// ── Rate limiting (janela deslizante em memória) ────────────────────────────
const rateLimitBuckets = new Map();
function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(key) || []).filter((t) => now - t < windowMs);
  timestamps.push(now);
  rateLimitBuckets.set(key, timestamps);
  return timestamps.length > maxRequests;
}

function isValidInternalSecret(provided) {
  if (typeof provided !== 'string' || !provided) return false;
  const expected = Buffer.from(INTERNAL_API_SECRET);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function requireInternal(req, res, next) {
  if (!isValidInternalSecret(req.get('X-Internal-Secret'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function hashTicket(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Valida e consome um ticket de lançamento emitido pelo painel.
 *
 * O UPDATE condicional é o que garante uso único sob concorrência: dois
 * pedidos simultâneos com o mesmo ticket disputam a mesma linha e só um deles
 * vê `affectedRows === 1`. Checar-e-depois-marcar em dois passos deixaria uma
 * janela pra ambos passarem.
 */
async function consumeLaunchTicket(token) {
  if (typeof token !== 'string' || token.length < 32) return null;

  const tokenHash = hashTicket(token);
  const [result] = await pool.execute(
    `UPDATE launch_tickets SET consumed_at = NOW()
     WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );
  if (result.affectedRows !== 1) return null;

  const rows = await db('SELECT account_id, discord_id FROM launch_tickets WHERE token_hash = ?', [tokenHash]);
  if (rows.length === 0) return null;
  return { accountId: rows[0].account_id, discordId: rows[0].discord_id };
}

/**
 * Confere que a conta continua elegível a entrar. O ticket prova *quem* é a
 * pessoa; isto prova que ela ainda *pode* jogar — uma conta pode ter sido
 * banida entre o login no launcher e a entrada na fila.
 */
async function isEligible(accountId) {
  const rows = await db(
    `SELECT a.status,
            (SELECT COUNT(*) FROM whitelist_applications w
              WHERE w.account_id = a.id AND w.status = 'approved') AS approved_apps,
            (SELECT COUNT(*) FROM characters c
              WHERE c.account_id = a.id AND c.status = 'approved') AS approved_chars
     FROM accounts a WHERE a.id = ?`,
    [accountId]
  );
  if (rows.length === 0) return { ok: false, reason: 'account_not_found' };
  if (rows[0].status !== 'active') return { ok: false, reason: 'account_not_active' };
  if (Number(rows[0].approved_apps) === 0) return { ok: false, reason: 'not_whitelisted' };
  if (Number(rows[0].approved_chars) === 0) return { ok: false, reason: 'no_approved_character' };
  return { ok: true };
}

// ── Paridade de modpack ─────────────────────────────────────────────────────

app.get('/mods.json', (req, res) => {
  const result = manifestLoader.load();
  if (!result.ok) {
    // 503 e não 200-com-lista-vazia: uma lista vazia passaria na verificação do
    // launcher e deixaria qualquer modpack entrar.
    console.error(`[game-api] Manifesto indisponivel: ${result.reason} (${MANIFEST_PATH})`);
    return res.status(503).json({ error: 'Manifesto de mods indisponivel no servidor.' });
  }
  res.json(result.manifest);
});

// ── Fila ────────────────────────────────────────────────────────────────────

app.post('/api/queue/join', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(`queue-join:${ip}`, 20, 60 * 1000)) {
    return res.status(429).json({ status: 'error', message: 'rate_limited' });
  }

  try {
    const identity = await consumeLaunchTicket((req.body || {}).ticket);
    if (!identity) return res.status(401).json({ status: 'error', message: 'invalid_ticket' });

    const eligible = await isEligible(identity.accountId);
    if (!eligible.ok) return res.status(403).json({ status: 'error', message: eligible.reason });

    const result = await persistAdmission(
      queue.join(identity.accountId, identity.discordId, makeSessionTicket),
      identity
    );

    // O launcher precisa reconsultar a fila, e o ticket de lançamento acabou de
    // ser consumido — então devolvemos um ticket novo pro polling seguinte.
    if (result.status === 'queued') {
      result.pollTicket = await issuePollTicket(identity.accountId, identity.discordId, ip);
    }

    res.json(result);
  } catch (err) {
    console.error('[game-api] /api/queue/join', err);
    res.status(500).json({ status: 'error', message: 'internal_error' });
  }
});

app.get('/api/queue/status', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(`queue-status:${ip}`, 120, 60 * 1000)) {
    return res.status(429).json({ status: 'error', message: 'rate_limited' });
  }

  try {
    const identity = await consumeLaunchTicket(req.query.ticket);
    if (!identity) return res.status(401).json({ status: 'error', message: 'invalid_ticket' });

    const result = await persistAdmission(
      queue.status(identity.accountId, makeSessionTicket),
      identity
    );
    if (result.status === 'queued') {
      result.pollTicket = await issuePollTicket(identity.accountId, identity.discordId, ip);
    }
    res.json(result);
  } catch (err) {
    console.error('[game-api] /api/queue/status', err);
    res.status(500).json({ status: 'error', message: 'internal_error' });
  }
});

/**
 * Emite o ticket da próxima consulta. Mantém a propriedade de uso único (um
 * ticket capturado não serve pra nada, porque já foi gasto) sem obrigar o
 * jogador a refazer o login do Discord a cada 5 segundos de polling.
 */
async function issuePollTicket(accountId, discordId, ip) {
  const token = crypto.randomBytes(32).toString('hex');
  await db(
    `INSERT INTO launch_tickets (token_hash, account_id, discord_id, expires_at, issued_ip)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 300 SECOND), ?)`,
    [hashTicket(token), accountId, discordId, ip || null]
  );
  return token;
}

// ── Endpoints internos (gamemode) ───────────────────────────────────────────

app.post('/internal/session/resolve', requireInternal, (req, res) => {
  const entry = queue.resolveSessionTicket((req.body || {}).ticket);
  if (!entry) return res.status(404).json({ ok: false, error: 'unknown_session' });
  queue.markConnected(entry.accountId);
  res.json({ ok: true, accountId: entry.accountId, discordId: entry.discordId });
});

app.post('/internal/session/release', requireInternal, (req, res) => {
  const accountId = Number((req.body || {}).accountId);
  if (!Number.isInteger(accountId)) return res.status(400).json({ ok: false, error: 'invalid_account_id' });
  const released = queue.release(accountId, makeSessionTicket);
  res.json({ ok: true, released });
});

// ── Diagnóstico ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  const manifest = manifestLoader.load();
  res.json({
    ok: manifest.ok,
    manifest: manifest.ok
      ? { mods: manifest.manifest.mods.length, plugins: manifest.manifest.loadOrder.length }
      : { error: manifest.reason },
    queue: queue.snapshot()
  });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`[game-api] Rodando em http://${HOST}:${PORT}`);
    const manifest = manifestLoader.load();
    if (!manifest.ok) {
      console.warn(`[game-api] ATENCAO: manifesto de mods indisponivel (${manifest.reason}).`);
      console.warn('[game-api] Gere com: node scripts/generate-mods-manifest.js <caminho-do-Data>');
      console.warn('[game-api] Ate la, /mods.json responde 503 e nenhum jogador consegue entrar.');
    } else {
      console.log(`[game-api] Manifesto: ${manifest.manifest.mods.length} arquivos, ${manifest.manifest.loadOrder.length} plugins.`);
    }
  });
}

module.exports = { app, queue, consumeLaunchTicket, isEligible };

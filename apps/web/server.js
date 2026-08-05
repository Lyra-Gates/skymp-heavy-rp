const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../skymp/gamemode/.env') });
const express = require('express');
const session = require('express-session');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app  = express();
const PORT = process.env.PANEL_PORT || 3001;
const INTERNAL_API_SECRET = requireEnv('INTERNAL_API_SECRET');
const CRASH_REPORT_DIR = path.join(__dirname, 'crash-reports');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

// ── DB Pool ────────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     process.env.DB_PORT     || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASS     || '',
  database: process.env.DB_NAME     || 'skymp_rp',
  waitForConnections: true,
  connectionLimit: 5
});

const db = async (sql, params = []) => {
  const [rows] = await pool.execute(sql, params);
  return rows;
};

const fsp = fs.promises;

async function ensureCrashReportDir() {
  await fsp.mkdir(CRASH_REPORT_DIR, { recursive: true });
}

// ── Rate limiting simples (janela deslizante em memória) ────────────────────
const rateLimitBuckets = new Map();
function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(key) || []).filter((t) => now - t < windowMs);
  timestamps.push(now);
  rateLimitBuckets.set(key, timestamps);
  return timestamps.length > maxRequests;
}

function sanitizeCrashText(value, maxLength) {
  return String(value || '').replace(/\0/g, '').slice(0, maxLength);
}

function normalizeCrashReport(body) {
  const crashes = Array.isArray(body.crashes) ? body.crashes.slice(0, 3) : [];
  return {
    id: `${Date.now()}-${crypto.randomUUID()}`,
    receivedAt: new Date().toISOString(),
    discordId: sanitizeCrashText(body.discordId, 64) || null,
    username: sanitizeCrashText(body.username, 120) || null,
    clientVersion: sanitizeCrashText(body.clientVersion, 80) || null,
    launcherVersion: sanitizeCrashText(body.launcherVersion, 80) || null,
    crashes: crashes.map((crash) => ({
      filename: sanitizeCrashText(crash.filename || crash.name, 160).replace(/[\\/:*?"<>|]/g, '_') || 'crash.log',
      mtime: Number(crash.mtime) || null,
      content: sanitizeCrashText(crash.content, 65000)
    })).filter((crash) => crash.content.length > 0)
  };
}

// ── Middleware ─────────────────────────────────────────────────────────────
if (process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(cors({ origin: `http://localhost:${PORT}`, credentials: true }));
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: requireEnv('SESSION_SECRET'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8h
  }
}));

// ── Auth via Discord OAuth ───────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: requireEnv('DISCORD_CLIENT_ID'),
    clientSecret: requireEnv('DISCORD_CLIENT_SECRET'),
    callbackURL: process.env.DISCORD_CALLBACK_URL || `http://localhost:${PORT}/api/auth/discord/callback`,
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const rows = await db('SELECT account_id FROM discord_identities WHERE discord_id = ?', [profile.id]);
        let accountId;
        if (rows.length === 0) {
            const [accRes] = await pool.execute('INSERT INTO accounts (status) VALUES (?)', ['active']);
            accountId = accRes.insertId;
            await pool.execute('INSERT INTO discord_identities (discord_id, account_id, username, avatar) VALUES (?, ?, ?, ?)', [profile.id, accountId, profile.username, profile.avatar || '']);
        } else {
            accountId = rows[0].account_id;
            await pool.execute('UPDATE discord_identities SET username = ?, avatar = ? WHERE discord_id = ?', [profile.username, profile.avatar || '', profile.id]);
        }
        
        return done(null, { id: profile.id, username: profile.username, avatar: profile.avatar, accountId });
    } catch(err) {
        return done(err, null);
    }
}));

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Não autenticado' });
}

// A autoridade de staff é derivada EXCLUSIVAMENTE da tabela `staff_roles`.
// O campo `vip_level` em `accounts` é SOMENTE para monetização (VIP/Apoiador).
// NUNCA usar vip_level como critério de permissão administrativa.
async function requireStaff(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
  try {
    const rows = await db('SELECT role FROM staff_roles WHERE account_id = ? LIMIT 1', [req.user.accountId]);
    if (rows.length === 0) return res.status(403).json({ error: 'Acesso staff negado' });
    req.staff = { role: rows[0].role };
    return next();
  } catch (err) {
    console.error('[requireStaff]', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

app.get('/api/auth/discord', passport.authenticate('discord'));
app.get('/api/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/?error=auth_failed'
}), (req, res) => {
    res.redirect('/');
});

app.post('/api/auth/logout', (req, res) => {
  req.logout((err) => {
    if(err) { console.error('[logout]', err); return res.status(500).json({ error: 'Erro interno do servidor' }); }
    req.session.destroy(() => res.json({ ok: true }));
  });
});

// Rotas do Jogador Público
app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const appRows = await db('SELECT * FROM whitelist_applications WHERE account_id = ? ORDER BY id DESC LIMIT 1', [req.user.accountId]);
        const application = appRows.length > 0 ? appRows[0] : null;
        res.json({
            user: req.user,
            application
        });
    } catch (err) { console.error('[/api/me]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

app.post('/api/apply', requireAuth, async (req, res) => {
    const { first_name, last_name, biography } = req.body;
    try {
        const existing = await db('SELECT status FROM whitelist_applications WHERE account_id = ? ORDER BY id DESC LIMIT 1', [req.user.accountId]);
        if (existing.length > 0 && (existing[0].status === 'pending' || existing[0].status === 'approved')) {
            return res.status(400).json({ error: 'Você já possui uma aplicação pendente ou aprovada.' });
        }

        const [charRes] = await pool.execute(
            'INSERT INTO characters (account_id, first_name, last_name, biography, status) VALUES (?, ?, ?, ?, ?)',
            [req.user.accountId, first_name, last_name, biography, 'pending']
        );

        await pool.execute(
            'INSERT INTO whitelist_applications (account_id, status) VALUES (?, ?)',
            [req.user.accountId, 'pending']
        );

        res.json({ ok: true });
    } catch (err) { console.error('[/api/apply]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// ── API: Dashboard ─────────────────────────────────────────────────────────
app.get('/api/dashboard', requireStaff, async (req, res) => {
  try {
    const [accounts]    = await pool.execute('SELECT COUNT(*) as c FROM accounts');
    const [chars]       = await pool.execute('SELECT COUNT(*) as c FROM characters');
    const [pending]     = await pool.execute("SELECT COUNT(*) as c FROM whitelist_applications WHERE status='pending'");
    const [auditToday]  = await pool.execute("SELECT COUNT(*) as c FROM audit_logs WHERE DATE(created_at)=CURDATE()");
    const [prisoners]   = await pool.execute("SELECT COUNT(*) as c FROM prison_records WHERE status='active'");
    const [factions]    = await pool.execute('SELECT COUNT(*) as c FROM factions');
    res.json({
      accounts:    accounts[0].c,
      characters:  chars[0].c,
      pending:     pending[0].c,
      auditToday:  auditToday[0].c,
      prisoners:   prisoners[0].c,
      factions:    factions[0].c
    });
  } catch (err) { console.error('[/api/dashboard]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// ── API: Whitelist ─────────────────────────────────────────────────────────
app.get('/api/whitelist', requireStaff, async (req, res) => {
  try {
    const rows = await db(
      `SELECT wa.id, wa.status, wa.created_at, wa.reviewer_notes,
              d.username as discord_name, d.discord_id,
              c.first_name, c.last_name
       FROM whitelist_applications wa
       LEFT JOIN accounts a ON a.id = wa.account_id
       LEFT JOIN discord_identities d ON d.account_id = a.id
       LEFT JOIN characters c ON c.account_id = a.id
       ORDER BY wa.status='pending' DESC, wa.created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) { console.error('[/api/whitelist GET]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

app.patch('/api/whitelist/:id', requireStaff, async (req, res) => {
  const { status, reviewer_notes } = req.body;
  const validStatuses = ['approved', 'rejected', 'pending'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    await db(
      'UPDATE whitelist_applications SET status=?, reviewer_notes=?, reviewed_at=NOW() WHERE id=?',
      [status, reviewer_notes || null, req.params.id]
    );
    
    // Buscar o discord_id e account_id relacionados para notificar o bot e auditar
    const idRows = await db(
      `SELECT d.discord_id, a.id as account_id FROM discord_identities d
       INNER JOIN accounts a ON a.id = d.account_id
       INNER JOIN whitelist_applications wa ON wa.account_id = a.id
       WHERE wa.id=?`, [req.params.id]
    );

    // Se aprovado, aprova também o personagem
    if (status === 'approved') {
      await db(
        `UPDATE characters c
         INNER JOIN accounts a ON a.id = c.account_id
         INNER JOIN whitelist_applications wa ON wa.account_id = a.id
         SET c.status='approved'
         WHERE wa.id=?`, [req.params.id]
      );
    }

    // Auditoria: registra quem revisou a aplicação de whitelist
    const auditAction = status === 'approved' ? 'whitelist:approve'
      : status === 'rejected' ? 'whitelist:reject'
      : 'whitelist:reset';
    await db(
      'INSERT INTO audit_logs (action, actor_account_id, target_account_id, details) VALUES (?, ?, ?, ?)',
      [auditAction, req.user.accountId, idRows.length > 0 ? idRows[0].account_id : null, reviewer_notes || null]
    );

    // Sincronizar com o Bot do Discord
    if (idRows.length > 0) {
        try {
            await fetch('http://localhost:3002/api/sync-role', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Secret': INTERNAL_API_SECRET
                },
                body: JSON.stringify({ discord_id: idRows[0].discord_id, status })
            });
        } catch (e) {
            console.error('[web] Falha ao notificar o Bot do Discord:', e.message);
        }
    }

    res.json({ ok: true });
  } catch (err) { console.error('[/api/whitelist PATCH]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// ── API: Personagens ───────────────────────────────────────────────────────
app.get('/api/characters', requireStaff, async (req, res) => {
  try {
    const search = req.query.q ? `%${req.query.q}%` : '%';
    const rows = await db(
      `SELECT c.id, c.first_name, c.last_name, c.status, c.gold, c.created_at,
              d.username as discord_name
       FROM characters c
       LEFT JOIN accounts a ON a.id = c.account_id
       LEFT JOIN discord_identities d ON d.account_id = a.id
       WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR d.username LIKE ?
       ORDER BY c.created_at DESC LIMIT 50`,
      [search, search, search]
    );
    res.json(rows);
  } catch (err) { console.error('[/api/characters]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// ── API: Audit Logs ────────────────────────────────────────────────────────
app.get('/api/audit', requireStaff, async (req, res) => {
  try {
    const rows = await db(
      `SELECT al.id, al.action, al.details, al.created_at,
              da.username as actor_name, dt.username as target_name
       FROM audit_logs al
       LEFT JOIN accounts a1 ON a1.id = al.actor_account_id
       LEFT JOIN discord_identities da ON da.account_id = a1.id
       LEFT JOIN accounts a2 ON a2.id = al.target_account_id
       LEFT JOIN discord_identities dt ON dt.account_id = a2.id
       ORDER BY al.created_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { console.error('[/api/audit]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// ── API: Economia / Holds ──────────────────────────────────────────────────
app.get('/api/economy/holds', requireStaff, async (req, res) => {
  try {
    const rows = await db(
      `SELECT h.id, h.name, h.tax_rate, h.treasury,
              f.tag as faction_tag, f.name as faction_name
       FROM holds h
       LEFT JOIN factions f ON f.id = h.ruling_faction_id
       ORDER BY h.name`
    );
    res.json(rows);
  } catch (err) { console.error('[/api/economy/holds]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

app.get('/api/economy/top-gold', requireStaff, async (req, res) => {
  try {
    const rows = await db(
      `SELECT c.first_name, c.last_name, c.gold, d.username
       FROM characters c
       LEFT JOIN accounts a ON a.id = c.account_id
       LEFT JOIN discord_identities d ON d.account_id = a.id
       ORDER BY c.gold DESC LIMIT 10`
    );
    res.json(rows);
  } catch (err) { console.error('[/api/economy/top-gold]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// ── API: Fichas Criminais ──────────────────────────────────────────────────
app.get('/api/criminal', requireStaff, async (req, res) => {
  try {
    const rows = await db(
      `SELECT cr.id, cr.crime, cr.bounty, cr.hold, cr.resolved, cr.created_at,
              c.first_name, c.last_name
       FROM criminal_records cr
       INNER JOIN characters c ON c.id = cr.character_id
       ORDER BY cr.resolved ASC, cr.created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) { console.error('[/api/criminal]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// ── API: Facções ───────────────────────────────────────────────────────────
app.get('/api/factions', requireStaff, async (req, res) => {
  try {
    const rows = await db(
      `SELECT f.id, f.tag, f.name, f.treasury, f.color_hex, f.created_at,
              COUNT(fm.id) as member_count
       FROM factions f
       LEFT JOIN faction_members fm ON fm.faction_id = f.id
       GROUP BY f.id ORDER BY member_count DESC`
    );
    res.json(rows);
  } catch (err) { console.error('[/api/factions]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// ── API: Presos Ativos ─────────────────────────────────────────────────────
app.get('/api/prison', requireStaff, async (req, res) => {
  try {
    const rows = await db(
      `SELECT pr.id, pr.sentence_minutes, pr.time_served_minutes, pr.crime_summary,
              pr.status, pr.arrested_at,
              c.first_name, c.last_name
       FROM prison_records pr
       INNER JOIN characters c ON c.id = pr.character_id
       WHERE pr.status='active'
       ORDER BY pr.arrested_at DESC`
    );
    res.json(rows);
  } catch (err) { console.error('[/api/prison]', err); res.status(500).json({ error: 'Erro interno do servidor' }); }
});

// API: Crash reports do launcher
const CRASH_REPORT_MAX_BYTES = 256 * 1024;
app.post('/api/crashes/client', async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (isRateLimited(`crashes:${ip}`, 10, 60 * 1000)) {
      return res.status(429).json({ ok: false, error: 'Muitas requisições, tente novamente mais tarde.' });
    }

    const contentLength = Number(req.get('content-length') || 0);
    if (contentLength > CRASH_REPORT_MAX_BYTES) {
      return res.status(413).json({ ok: false, error: 'Payload muito grande' });
    }

    const report = normalizeCrashReport(req.body || {});
    if (report.crashes.length === 0) return res.status(400).json({ ok: false, error: 'Nenhum crash valido recebido' });

    await ensureCrashReportDir();
    const filePath = path.join(CRASH_REPORT_DIR, `${report.id}.json`);
    await fsp.writeFile(filePath, JSON.stringify(report, null, 2));

    res.json({ ok: true, id: report.id, received: report.crashes.length });
  } catch (err) {
    console.error('[/api/crashes/client]', err);
    res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
  }
});

app.get('/api/crashes', requireStaff, async (req, res) => {
  try {
    await ensureCrashReportDir();
    const names = (await fsp.readdir(CRASH_REPORT_DIR)).filter((name) => name.endsWith('.json'));

    const reports = [];
    for (const name of names) {
      const fullPath = path.join(CRASH_REPORT_DIR, name);
      try {
        const raw = JSON.parse(await fsp.readFile(fullPath, 'utf8'));
        reports.push({
          id: raw.id,
          receivedAt: raw.receivedAt,
          discordId: raw.discordId,
          username: raw.username,
          clientVersion: raw.clientVersion,
          launcherVersion: raw.launcherVersion,
          files: Array.isArray(raw.crashes) ? raw.crashes.map((crash) => ({
            filename: crash.filename,
            mtime: crash.mtime,
            bytes: String(crash.content || '').length
          })) : []
        });
      } catch (fileErr) {
        console.error(`[/api/crashes] Arquivo corrompido ignorado: ${name}`, fileErr.message);
      }
    }

    reports.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    res.json(reports.slice(0, 100));
  } catch (err) {
    console.error('[/api/crashes]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── API: Launcher Manifesto ──────────────────────────────────────────────────
app.get('/api/launcher/manifest', (req, res) => {
    // Retorna o manifesto contendo a versão mínima requerida do cliente e arquivos
    res.json({
        version: "1.0.0-beta",
        files: [
            {
                path: "Data/SkyMP.esp",
                hash: "dummy_hash_for_testing",
                url: "http://localhost:3001/download/SkyMP.esp" // Fake url for testing
            }
        ]
    });
});

// ── Catch-all: SPA ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[staff-panel] Painel rodando em http://localhost:${PORT}`);
});

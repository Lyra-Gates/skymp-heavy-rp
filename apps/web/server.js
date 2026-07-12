require('dotenv').config({ path: '../../skymp/gamemode/.env' });
const express = require('express');
const session = require('express-session');
const mysql   = require('mysql2/promise');
const path    = require('path');
const cors    = require('cors');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app  = express();
const PORT = process.env.PANEL_PORT || 3001;

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

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: `http://localhost:${PORT}`, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: requireEnv('SESSION_SECRET'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 } // 8h
}));

// ── Auth via Discord OAuth ───────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID || 'dummy_client_id',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || 'dummy_secret',
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3001/api/auth/discord/callback',
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let [rows] = await db('SELECT account_id FROM discord_identities WHERE discord_id = ?', [profile.id]);
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

function requireStaff(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ error: 'Não autenticado' });
  // TODO: Integrar verificação real de cargos staff via DB ou Discord
  return next(); 
}

app.get('/api/auth/discord', passport.authenticate('discord'));
app.get('/api/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/?error=auth_failed'
}), (req, res) => {
    res.redirect('/');
});

app.post('/api/auth/logout', (req, res) => {
  req.logout((err) => {
    if(err) return res.status(500).json({ error: err.message });
    req.session.destroy(() => res.json({ ok: true }));
  });
});

// Rotas do Jogador Público
app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const [appRows] = await db('SELECT * FROM whitelist_applications WHERE account_id = ? ORDER BY id DESC LIMIT 1', [req.user.accountId]);
        const application = appRows.length > 0 ? appRows[0] : null;
        res.json({
            user: req.user,
            application
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/apply', requireAuth, async (req, res) => {
    const { first_name, last_name, biography } = req.body;
    try {
        const [existing] = await db('SELECT status FROM whitelist_applications WHERE account_id = ? ORDER BY id DESC LIMIT 1', [req.user.accountId]);
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    
    // Buscar o discord_id relacionado para notificar o bot
    const [idRows] = await db(
      `SELECT d.discord_id FROM discord_identities d
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
    
    // Sincronizar com o Bot do Discord
    if (idRows.length > 0) {
        try {
            await fetch('http://localhost:3002/api/sync-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discord_id: idRows[0].discord_id, status })
            });
        } catch (e) {
            console.error('[web] Falha ao notificar o Bot do Discord:', e.message);
        }
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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

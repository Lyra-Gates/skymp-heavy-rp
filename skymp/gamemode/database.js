const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

let pool = null;

function init() {
  if (pool) return pool;

  try {
    const configPath = path.resolve(__dirname, '../config/database.local.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`Database config file not found at: ${configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    pool = mysql.createPool({
      host: config.host || '127.0.0.1',
      port: config.port || 3306,
      user: config.user || 'root',
      password: config.password || '',
      database: config.database || 'skymp_rp',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    console.log('[database] MySQL connection pool initialized successfully');
    return pool;
  } catch (err) {
    console.error('[database] Failed to initialize MySQL pool:', err.message);
    throw err;
  }
}

async function query(sql, params) {
  if (!pool) {
    init();
  }
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function getConnection() {
  if (!pool) {
    init();
  }
  return pool.getConnection();
}

module.exports = {
  init,
  query,
  getConnection,
  getPool: () => pool
};

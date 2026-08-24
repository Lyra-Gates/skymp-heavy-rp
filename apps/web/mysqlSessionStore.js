'use strict';

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_PRUNE_INTERVAL_MS = 15 * 60 * 1000;

function expiryFor(sessionData, now, defaultTtlMs) {
  const cookie = sessionData && sessionData.cookie;
  if (cookie && cookie.expires) {
    const expires = new Date(cookie.expires);
    if (Number.isFinite(expires.getTime())) return expires;
  }
  if (cookie && Number.isFinite(Number(cookie.maxAge)) && Number(cookie.maxAge) > 0) {
    return new Date(now() + Number(cookie.maxAge));
  }
  return new Date(now() + defaultTtlMs);
}

/**
 * Store MariaDB sem dependência adicional. Recebe o módulo express-session e
 * um executor para continuar testável sem abrir socket de banco.
 */
function createMysqlSessionStore(sessionModule, {
  execute,
  now = Date.now,
  defaultTtlMs = DEFAULT_TTL_MS,
  pruneIntervalMs = DEFAULT_PRUNE_INTERVAL_MS
} = {}) {
  if (!sessionModule || typeof sessionModule.Store !== 'function') throw new Error('express-session Store is required');
  if (typeof execute !== 'function') throw new Error('execute is required');

  class MysqlSessionStore extends sessionModule.Store {
    constructor() {
      super();
      this.pruneTimer = null;
      if (pruneIntervalMs > 0) {
        this.pruneTimer = setInterval(() => {
          this.pruneExpired().catch(err => this.emit('disconnect', err));
        }, pruneIntervalMs);
        if (typeof this.pruneTimer.unref === 'function') this.pruneTimer.unref();
      }
    }

    get(sid, callback) {
      execute(
        'SELECT data_json FROM web_sessions WHERE session_id = ? AND expires_at > ? LIMIT 1',
        [sid, new Date(now())]
      ).then(([rows]) => {
        if (!rows || rows.length === 0) return callback(null, null);
        try {
          return callback(null, JSON.parse(rows[0].data_json));
        } catch (err) {
          return callback(err);
        }
      }, callback);
    }

    set(sid, sessionData, callback = () => {}) {
      let serialized;
      try {
        serialized = JSON.stringify(sessionData);
      } catch (err) {
        callback(err);
        return;
      }
      execute(
        `INSERT INTO web_sessions (session_id, data_json, expires_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), expires_at = VALUES(expires_at)`,
        [sid, serialized, expiryFor(sessionData, now, defaultTtlMs)]
      ).then(() => callback(null), callback);
    }

    destroy(sid, callback = () => {}) {
      execute('DELETE FROM web_sessions WHERE session_id = ?', [sid])
        .then(() => callback(null), callback);
    }

    touch(sid, sessionData, callback = () => {}) {
      execute(
        'UPDATE web_sessions SET expires_at = ? WHERE session_id = ?',
        [expiryFor(sessionData, now, defaultTtlMs), sid]
      ).then(() => callback(null), callback);
    }

    async pruneExpired() {
      const [result] = await execute('DELETE FROM web_sessions WHERE expires_at <= ?', [new Date(now())]);
      return Number(result && result.affectedRows) || 0;
    }

    close() {
      if (this.pruneTimer) clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  return new MysqlSessionStore();
}

module.exports = {
  createMysqlSessionStore,
  expiryFor,
  DEFAULT_TTL_MS,
  DEFAULT_PRUNE_INTERVAL_MS
};

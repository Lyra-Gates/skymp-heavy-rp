const crypto = require('crypto');

const VERSION = 1;
const RANDOM_BYTES = 32;
const MAX_TOKEN_LENGTH = 128;
const KINDS = Object.freeze({
  launch_grant: Object.freeze({ prefix: 'lg', audience: 'game-api:queue', reusable: false }),
  queue_grant: Object.freeze({ prefix: 'qg', audience: 'game-api:poll', reusable: false }),
  game_session: Object.freeze({ prefix: 'gs', audience: 'skymp:master-api', reusable: true })
});
/** @type {Map<string, keyof typeof KINDS>} */
const PREFIX_TO_KIND = new Map(Object.entries(KINDS).map(([kind, spec]) =>
  [spec.prefix, /** @type {keyof typeof KINDS} */ (kind)]));
const TOKEN_PATTERN = /^hrp_(lg|qg|gs)_v1_([A-Za-z0-9_-]{43})$/;
const SECRET_KEY_PATTERN = /ticket|token|session|authorization|masterkey|secret|credential/i;

function generate(kind, randomBytes = crypto.randomBytes) {
  const spec = KINDS[kind];
  if (!spec) throw new TypeError(`credential kind desconhecido: ${kind}`);
  const entropy = randomBytes(RANDOM_BYTES);
  if (!Buffer.isBuffer(entropy) || entropy.length !== RANDOM_BYTES) {
    throw new Error(`random source deve devolver ${RANDOM_BYTES} bytes`);
  }
  return `hrp_${spec.prefix}_v${VERSION}_${entropy.toString('base64url')}`;
}

function parse(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const kind = PREFIX_TO_KIND.get(match[1]);
  if (!kind) return null;
  const spec = KINDS[kind];
  return { version: VERSION, kind, audience: spec.audience, reusable: spec.reusable };
}

function hash(token) {
  if (!parse(token)) throw new TypeError('credential opaca malformada');
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function redact(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    clean[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(entry, seen);
  }
  seen.delete(value);
  return clean;
}

module.exports = {
  KINDS,
  MAX_TOKEN_LENGTH,
  RANDOM_BYTES,
  VERSION,
  generate,
  hash,
  parse,
  redact
};

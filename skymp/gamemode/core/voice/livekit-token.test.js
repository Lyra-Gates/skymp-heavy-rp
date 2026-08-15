/**
 * Testes do emissor de access token do LiveKit.
 *
 * Estes testes provam FORMATO e INVARIANTES de segurança. Eles NÃO provam que
 * o `livekit-server` aceita o token — nenhum teste unitário pode provar isso,
 * porque a autoridade sobre o formato é o servidor, não a nossa leitura da
 * documentação dele. Essa prova é do spike (`spikes/skyvoice-livekit/`), que
 * sobe o binário oficial e conecta de verdade.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const lk = require('./livekit-token');

const KEY = 'test_api_key';
const SECRET = 'test_api_secret_0123456789abcdef';

function decodeHeader(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

test('emite um JWT de três partes com header HS256', () => {
  const token = lk.mintAccessToken({
    apiKey: KEY, apiSecret: SECRET, room: 'sala', identity: 'actor-1-aa'
  });
  assert.strictEqual(token.split('.').length, 3);
  assert.deepStrictEqual(decodeHeader(token), { alg: 'HS256', typ: 'JWT' });
});

test('a assinatura é HMAC-SHA256 do header.payload com o secret', () => {
  const token = lk.mintAccessToken({
    apiKey: KEY, apiSecret: SECRET, room: 'sala', identity: 'actor-1-aa'
  });
  const [h, p, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  assert.strictEqual(sig, expected);
});

test('um secret diferente produz assinatura diferente — o secret é o que autentica', () => {
  const args = { apiKey: KEY, room: 'sala', identity: 'actor-1-aa', now: 1_000_000_000_000 };
  const a = lk.mintAccessToken({ ...args, apiSecret: SECRET });
  const b = lk.mintAccessToken({ ...args, apiSecret: 'outro_secret' });
  // `jti` é aleatório, então compare só a assinatura sobre payloads distintos:
  assert.notStrictEqual(a.split('.')[2], b.split('.')[2]);
});

test('o token prende a UMA sala — roomJoin sem room seria um curinga', () => {
  const token = lk.mintAccessToken({
    apiKey: KEY, apiSecret: SECRET, room: 'cena-voz-1', identity: 'actor-1-aa'
  });
  const payload = lk.decodePayloadUnsafe(token);
  assert.strictEqual(payload.video.roomJoin, true);
  assert.strictEqual(payload.video.room, 'cena-voz-1');
});

test('direitos de operador são negados explicitamente', () => {
  const payload = lk.decodePayloadUnsafe(lk.mintAccessToken({
    apiKey: KEY, apiSecret: SECRET, room: 'sala', identity: 'actor-1-aa'
  }));
  for (const right of ['roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'canPublishData']) {
    assert.strictEqual(payload.video[right], false, `${right} deveria ser false`);
  }
});

test('só microfone: a câmera é negada pelo próprio servidor, não pela UI', () => {
  const payload = lk.decodePayloadUnsafe(lk.mintAccessToken({
    apiKey: KEY, apiSecret: SECRET, room: 'sala', identity: 'actor-1-aa'
  }));
  assert.deepStrictEqual(payload.video.canPublishSources, ['microphone']);
});

test('o secret nunca aparece no token', () => {
  const token = lk.mintAccessToken({
    apiKey: KEY, apiSecret: SECRET, room: 'sala', identity: 'actor-1-aa'
  });
  assert.ok(!token.includes(SECRET));
  // E nem em base64 dentro de alguma parte decodificável.
  const payload = JSON.stringify(lk.decodePayloadUnsafe(token));
  assert.ok(!payload.includes(SECRET));
  // O apiKey aparece (é o `iss`, e precisa aparecer — é como o servidor
  // descobre qual secret usar para verificar). Isso é público por construção.
  assert.strictEqual(lk.decodePayloadUnsafe(token).iss, KEY);
});

test('expira, e a validade é curta', () => {
  const now = 1_700_000_000_000;
  const payload = lk.decodePayloadUnsafe(lk.mintAccessToken({
    apiKey: KEY, apiSecret: SECRET, room: 'sala', identity: 'actor-1-aa', now
  }));
  const nowSec = Math.floor(now / 1000);
  assert.strictEqual(payload.exp, nowSec + lk.DEFAULT_TTL_SECONDS);
  assert.ok(payload.exp - nowSec <= 600, 'TTL deve ser curto (crachá, não sessão)');
  assert.ok(payload.nbf <= nowSec, 'nbf deve tolerar folga de relógio');
});

test('insumo faltando falha alto, aqui, e não como "voz não conecta" lá na frente', () => {
  const ok = { apiKey: KEY, apiSecret: SECRET, room: 'sala', identity: 'actor-1-aa' };
  for (const missing of ['apiKey', 'apiSecret', 'room', 'identity']) {
    assert.throws(
      () => lk.mintAccessToken({ ...ok, [missing]: undefined }),
      new RegExp(missing),
      `deveria recusar ${missing} ausente`
    );
  }
});

test('identidade vem do actorId e é única por tentativa de conexão', () => {
  const a = lk.participantIdentity(0xff000a12);
  const b = lk.participantIdentity(0xff000a12);
  assert.notStrictEqual(a, b, 'duas conexões do mesmo ator não podem colidir');
  assert.strictEqual(lk.actorIdFromIdentity(a), 0xff000a12);
  assert.strictEqual(lk.actorIdFromIdentity(b), 0xff000a12);
});

test('identidade não reconhecida devolve null em vez de adivinhar', () => {
  for (const bad of ['', 'bob', 'actor-', 'actor-x-aa', 'actor-1', null, undefined, 42]) {
    assert.strictEqual(lk.actorIdFromIdentity(/** @type {any} */ (bad)), null);
  }
});

test('canPublish=false emite um token de só-ouvir', () => {
  const payload = lk.decodePayloadUnsafe(lk.mintAccessToken({
    apiKey: KEY, apiSecret: SECRET, room: 'sala', identity: 'actor-1-aa', canPublish: false
  }));
  assert.strictEqual(payload.video.canPublish, false);
  assert.strictEqual(payload.video.canSubscribe, true);
});

/**
 * Testes da costura VoiceEndpoint / VOICE_BACKEND.
 *
 * O que estes testes travam é a propriedade que dá sentido ao módulo: o resto
 * do sistema decide o que fazer olhando **capacidade de transporte**, nunca a
 * identidade do endpoint. Se alguém um dia trocar `relaysAudioThroughGameServer`
 * por um `if (endpoint.id === 'legacy-relay')`, os testes de baixo continuam
 * passando — mas o de "capacidade, não identidade" quebra, que é o ponto.
 */

const test = require('node:test');
const assert = require('node:assert');

const ve = require('./voice-endpoint');

test('VOICE_BACKEND ausente cai em legacy — migração não começa ligada', () => {
  assert.strictEqual(ve.resolveBackend({}), 'legacy');
  assert.strictEqual(ve.resolveBackend({ VOICE_BACKEND: '' }), 'legacy');
});

test('VOICE_BACKEND=livekit seleciona os dois endpoints LiveKit', () => {
  const ids = ve.activeEndpoints({ VOICE_BACKEND: 'livekit' }).map((e) => e.id);
  assert.deepStrictEqual(ids.sort(), ['cef-livekit', 'native-livekit']);
});

test('VOICE_BACKEND=legacy seleciona só o relay atual', () => {
  const ids = ve.activeEndpoints({ VOICE_BACKEND: 'legacy' }).map((e) => e.id);
  assert.deepStrictEqual(ids, ['legacy-relay']);
});

test('valor desconhecido cai no padrão E avisa — erro de digitação não passa calado', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    assert.strictEqual(ve.resolveBackend({ VOICE_BACKEND: 'livekt' }), 'legacy');
  } finally {
    console.warn = originalWarn;
  }
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /livekt/);
});

test('a flag é lida por chamada, não capturada no load', () => {
  const env = { VOICE_BACKEND: 'legacy' };
  assert.strictEqual(ve.resolveBackend(env), 'legacy');
  env.VOICE_BACKEND = 'livekit';
  assert.strictEqual(ve.resolveBackend(env), 'livekit');
});

test('só o backend legado carrega áudio dentro do processo do jogo', () => {
  assert.strictEqual(ve.relaysAudioThroughGameServer({ VOICE_BACKEND: 'legacy' }), true);
  assert.strictEqual(ve.relaysAudioThroughGameServer({ VOICE_BACKEND: 'livekit' }), false);
});

test('a decisão do resto do sistema é por capacidade, não por identidade', () => {
  // Esta é a propriedade que a abstração existe para garantir: os DOIS
  // endpoints LiveKit — um que captura na CEF, outro no helper nativo —
  // respondem igual à única pergunta que o serviço de voz faz. Se um dia eles
  // divergirem aqui, quem chama vai precisar saber qual é qual, e a costura
  // terá vazado.
  assert.strictEqual(
    ve.CEF_LIVEKIT.carriesAudioThroughGameServer,
    ve.NATIVE_LIVEKIT.carriesAudioThroughGameServer,
    'os endpoints LiveKit devem ser indistinguíveis no transporte'
  );
  assert.strictEqual(ve.CEF_LIVEKIT.transport, ve.NATIVE_LIVEKIT.transport);

  // E diferem exatamente onde devem: no local da captura.
  assert.notStrictEqual(ve.CEF_LIVEKIT.capturesAt, ve.NATIVE_LIVEKIT.capturesAt);
});

test('nenhum endpoint LiveKit se declara implementado ainda', () => {
  // Trava a honestidade do descritor. Marcar `implemented: true` sem ter
  // capturado áudio é o defeito que a auditoria inteira existe para não repetir.
  assert.strictEqual(ve.CEF_LIVEKIT.implemented, false);
  assert.strictEqual(ve.NATIVE_LIVEKIT.implemented, false);
  assert.strictEqual(ve.LEGACY_RELAY.implemented, true);
  assert.strictEqual(ve.hasUnimplementedEndpoint({ VOICE_BACKEND: 'livekit' }), true);
  assert.strictEqual(ve.hasUnimplementedEndpoint({ VOICE_BACKEND: 'legacy' }), false);
});

test('o Plano B não depende de build de client — é isso que o faz plano B', () => {
  assert.strictEqual(ve.NATIVE_LIVEKIT.requiresClientPatch, false);
  assert.strictEqual(ve.CEF_LIVEKIT.requiresClientPatch, true);
});

test('describeBackend resume sem mentir sobre prontidão', () => {
  const d = ve.describeBackend({ VOICE_BACKEND: 'livekit' });
  assert.strictEqual(d.backend, 'livekit');
  assert.strictEqual(d.ready, false);
  assert.strictEqual(d.relaysAudioThroughGameServer, false);

  const legacy = ve.describeBackend({ VOICE_BACKEND: 'legacy' });
  assert.strictEqual(legacy.ready, true);
});

test('os descritores são congelados — ninguém muda o contrato em runtime', () => {
  // Asserção sobre o EFEITO, não sobre o lançamento: este arquivo é CommonJS
  // sem `'use strict'`, e em modo solto a escrita num objeto congelado falha em
  // silêncio em vez de lançar. Testar o throw passaria a impressão de proteção
  // e mediria o modo do arquivo de teste, não o congelamento do descritor.
  assert.ok(Object.isFrozen(ve.LEGACY_RELAY));
  assert.ok(Object.isFrozen(ve.ENDPOINTS));
  assert.ok(Object.isFrozen(ve.BACKENDS));

  ve.LEGACY_RELAY.implemented = false;
  assert.strictEqual(ve.LEGACY_RELAY.implemented, true, 'a escrita não pode pegar');
});

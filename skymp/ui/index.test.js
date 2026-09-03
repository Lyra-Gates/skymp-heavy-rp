'use strict';

/**
 * Caracterização estática de `index.html` — não roda dentro do CEF (não há
 * runner pra isso neste projeto), só confirma que o arquivo continua com a
 * sequência de bootstrap de auth que a evidência de 27/08/2026 exige: ver o
 * comentário acima do bloco em `index.html` pra fonte (bundle oficial do
 * skymp5-client + `skymp5-client.log` real, ambos fora deste repositório).
 *
 * Se este teste quebrar porque alguém removeu ou reordenou o `sendMessage`,
 * é sinal de que a regressão do AUTH bloqueador (connections.total: 0)
 * provavelmente volta.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const HTML_PATH = path.join(__dirname, 'index.html');

test('index.html manda front-loaded antes de authAttemptEvent, dentro do jogo', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  const frontLoadedIdx = html.indexOf("sendMessage('front-loaded')");
  const authAttemptIdx = html.indexOf("sendMessage('authAttemptEvent')");
  const delayedIdx = html.indexOf('setTimeout(() => {', frontLoadedIdx);

  assert.notStrictEqual(frontLoadedIdx, -1,
    "front-loaded precisa ser mandado -- e o primeiro sinal que o AuthService " +
    "nativo espera antes de sequer considerar authNeeded (ver comentario).");
  assert.notStrictEqual(authAttemptIdx, -1,
    'authAttemptEvent continua sendo mandado por precaucao.');
  assert.ok(frontLoadedIdx < authAttemptIdx,
    'front-loaded precisa vir ANTES de authAttemptEvent, nunca depois.');
  assert.ok(delayedIdx > frontLoadedIdx && delayedIdx < authAttemptIdx,
    'authAttemptEvent precisa esperar o AuthService carregar o ticket.');
});

test('index.html so dispara isso dentro do jogo (RODANDO_FORA_DO_JOGO=false), nunca no mock', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  const guardIdx = html.indexOf('if (!RODANDO_FORA_DO_JOGO) {');
  const frontLoadedIdx = html.indexOf("sendMessage('front-loaded')");

  assert.notStrictEqual(guardIdx, -1, 'guarda RODANDO_FORA_DO_JOGO precisa existir.');
  assert.ok(guardIdx !== -1 && frontLoadedIdx > guardIdx,
    'o disparo de front-loaded precisa estar dentro do bloco !RODANDO_FORA_DO_JOGO, ' +
    'senão o mock de fora do jogo tambem dispara (mesma classe de bug corrigida em 23/08).');
});

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const HTML_PATH = path.join(__dirname, 'index.html');

function readHtml() {
  return fs.readFileSync(HTML_PATH, 'utf8');
}

test('index.html cria o contrato widgets antes de front-loaded', () => {
  const html = readHtml();
  const widgetsIdx = html.indexOf('bridge.widgets = {');
  const wrapperIdx = html.indexOf('bridge.widgets.set = widgets => {');
  const frontLoadedIdx = html.indexOf("bridge.sendMessage('front-loaded')");

  assert.notStrictEqual(widgetsIdx, -1, 'o contrato widgets precisa existir.');
  assert.notStrictEqual(wrapperIdx, -1, 'widgets.set precisa ser observado.');
  assert.notStrictEqual(frontLoadedIdx, -1, 'front-loaded precisa ser enviado.');
  assert.ok(widgetsIdx < wrapperIdx && wrapperIdx < frontLoadedIdx,
    'widgets precisa estar pronto antes de front-loaded.');

  const contract = html.slice(widgetsIdx, wrapperIdx);
  for (const method of ['get:', 'set:', 'addListener:', 'removeListener:']) {
    assert.ok(contract.includes(method), `metodo oficial ausente: ${method}`);
  }
});

test('authAttemptEvent espera o formulario oficial e dispara uma vez', () => {
  const html = readHtml();
  const readyIdx = html.indexOf("widget.type === 'form' && widget.id === 1");
  const onceIdx = html.indexOf('if (authPronta && !authAttemptEnviado)');
  const markedIdx = html.indexOf('authAttemptEnviado = true;', onceIdx);
  const sendIdx = html.indexOf("bridge.sendMessage('authAttemptEvent')", onceIdx);

  assert.notStrictEqual(readyIdx, -1, 'o loginWidget oficial precisa ser reconhecido.');
  assert.ok(readyIdx < onceIdx && onceIdx < markedIdx && markedIdx < sendIdx,
    'authAttemptEvent deve esperar o loginWidget e ser marcado como enviado.');
  assert.ok(
    html.includes("setTimeout(() => bridge.sendMessage('authAttemptEvent'), 0);"),
    'o envio precisa ocorrer depois que widgets.set terminar.'
  );
  assert.ok(!html.includes('}, 1000);'),
    'o antigo atraso arbitrario de um segundo nao deve continuar.');
});

test('bootstrap de autenticacao fica restrito ao jogo', () => {
  const html = readHtml();
  const guardIdx = html.indexOf('if (!RODANDO_FORA_DO_JOGO) {');
  const widgetsIdx = html.indexOf('bridge.widgets = {');
  const frontLoadedIdx = html.indexOf("bridge.sendMessage('front-loaded')");

  assert.notStrictEqual(guardIdx, -1, 'a protecao RODANDO_FORA_DO_JOGO precisa existir.');
  assert.ok(guardIdx < widgetsIdx && guardIdx < frontLoadedIdx,
    'o bootstrap nao pode executar no mock usado fora do jogo.');
});
/**
 * core/player-shortcuts-service.test.js
 *
 * O que estes testes provam: todo personagem ativo recebe o sinal de pronto
 * exatamente uma vez (não a cada tick), quem sai da lista de ativos libera o
 * `actorId` pra receber de novo se voltar, e o snippet de cliente cita o
 * scan code de F2 e o nome de função certo pra CEF reconhecer.
 *
 * O que eles NÃO provam: que `ctx.sp.on('keyPress', ...)` dispara em jogo,
 * nem que F2 é mesmo o scan code 60 dentro do Skyrim Platform real — mesma
 * ressalva de toda a família de labs deste projeto (ver cabeçalho do
 * arquivo testado).
 *
 * Executa com: node --test core/player-shortcuts-service.test.js
 */

'use strict';

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

let atoresAtivos = [];

const Module = require('module');
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === './commands' || request.endsWith('/commands')) {
    return { listActiveActorIds: () => [...atoresAtivos] };
  }
  return originalLoad.apply(this, arguments);
};

const shortcuts = require('./player-shortcuts-service');

const propertyEscrita = new Map();

global.mp = {
  set: (actorId, propName, valor) => {
    if (propName === shortcuts.PROPERTY) propertyEscrita.set(actorId, valor);
  }
};

after(() => {
  Module._load = originalLoad;
  delete global.mp;
});

const ATOR_A = 0xff00f001;
const ATOR_B = 0xff00f002;

beforeEach(() => {
  atoresAtivos = [];
  propertyEscrita.clear();
  shortcuts._jaEnviado.clear();
});

describe('player-shortcuts-service', () => {
  it('envia o sinal de pronto pra todo ator ativo', async () => {
    atoresAtivos = [ATOR_A, ATOR_B];
    await shortcuts.tick();
    assert.ok(propertyEscrita.has(ATOR_A));
    assert.ok(propertyEscrita.has(ATOR_B));
  });

  it('não reenvia num segundo tick pro mesmo ator', async () => {
    atoresAtivos = [ATOR_A];
    await shortcuts.tick();
    propertyEscrita.clear();
    await shortcuts.tick();
    assert.ok(!propertyEscrita.has(ATOR_A), 'não deveria reenviar sem mudança');
  });

  it('libera o ator quando ele sai da lista de ativos, e reenvia se ele voltar', async () => {
    atoresAtivos = [ATOR_A];
    await shortcuts.tick();
    propertyEscrita.clear();

    atoresAtivos = [];
    await shortcuts.tick();

    atoresAtivos = [ATOR_A];
    await shortcuts.tick();
    assert.ok(propertyEscrita.has(ATOR_A), 'deveria reenviar pro ator que voltou');
  });

  it('não escreve nada quando `mp` não está definido', async () => {
    const mpReal = global.mp;
    delete global.mp;
    atoresAtivos = [ATOR_A];
    await assert.doesNotReject(() => shortcuts.tick());
    global.mp = mpReal;
  });

  it('o snippet de cliente cita o scan code de F2 e a função de callback certa', () => {
    assert.ok(shortcuts.SNIPPET_DO_CLIENTE.includes(`key !== ${shortcuts.SCAN_CODE_F2}`));
    assert.ok(shortcuts.SNIPPET_DO_CLIENTE.includes('window.handlePlayerShortcutKey'));
    assert.ok(shortcuts.SNIPPET_DO_CLIENTE.includes('"panel:open"'));
  });

  it('o snippet registra o listener de tecla uma única vez (guarda em ctx.state)', () => {
    assert.ok(shortcuts.SNIPPET_DO_CLIENTE.includes('registrouTecla'));
  });
});

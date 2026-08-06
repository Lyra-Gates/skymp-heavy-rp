/**
 * papyrus.test.js
 *
 * Guarda o formato do `self` das chamadas Papyrus.
 *
 * Contexto: até 05/08/2026 o gamemode misturava duas formas — objeto
 * `{type,desc}` em 2 arquivos e FormID cru em 22 pontos. Os nove testes
 * oficiais do SkyMP (`misc/tests/` upstream) usam exclusivamente a forma de
 * objeto, inclusive para argumentos.
 *
 * A suíte passava com as duas formas porque o `mp` mockado aceita qualquer
 * coisa — foi exatamente por isso que a divergência sobreviveu tanto tempo.
 * Este arquivo existe pra fechar essa porta: agora existe teste que olha o
 * ARGUMENTO, não só o resultado.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const papyrusCalls = [];
const originalMp = global.mp;

global.mp = {
  getDescFromId: (formId) => `${formId.toString(16)}:Skyrim.esm`,
  callPapyrusFunction: (callType, className, fnName, self, args) => {
    papyrusCalls.push({ callType, className, fnName, self, args });
    return null;
  }
};

const { actorRef, baseRef } = require('./papyrus');

after(() => {
  if (originalMp === undefined) delete global.mp;
  else global.mp = originalMp;
});

beforeEach(() => { papyrusCalls.length = 0; });

describe('actorRef / baseRef', () => {
  test('actorRef produz { type: "form", desc }', () => {
    assert.deepEqual(actorRef(0xff000000), { type: 'form', desc: 'ff000000:Skyrim.esm' });
  });

  test('baseRef produz { type: "espm", desc }', () => {
    // A distinção aparece nos testes oficiais: o ator é `form`, o Gold001 que
    // se adiciona ao inventário dele é `espm`.
    assert.deepEqual(baseRef(0xf), { type: 'espm', desc: 'f:Skyrim.esm' });
  });

  test('nunca devolve número cru', () => {
    const ref = actorRef(0x14);
    assert.equal(typeof ref, 'object');
    assert.notEqual(typeof ref, 'number');
  });
});

describe('transaction-service manda objeto, não FormID', () => {
  // O caso que mais importa: se a forma crua não funciona, o banco registrava
  // a transação e o item nunca chegava no inventário do jogador.
  const transactionService = require('./transaction-service');

  test('AddItem recebe self como objeto', () => {
    transactionService._applyToClient(0xff000abc, 0xf, 10);

    assert.equal(papyrusCalls.length, 1);
    const call = papyrusCalls[0];
    assert.equal(call.fnName, 'AddItem');
    assert.equal(typeof call.self, 'object', 'self precisa ser objeto, não o FormID');
    assert.equal(call.self.type, 'form');
    assert.equal(call.self.desc, 'ff000abc:Skyrim.esm');
  });

  test('RemoveItem recebe self como objeto', () => {
    transactionService._applyToClient(0xff000abc, 0xf, -3);

    assert.equal(papyrusCalls.length, 1);
    const call = papyrusCalls[0];
    assert.equal(call.fnName, 'RemoveItem');
    assert.equal(typeof call.self, 'object');
    assert.equal(call.self.type, 'form');
  });
});

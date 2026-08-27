'use strict';

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const A = 0xff00e001;
const B_MAIS_PERTO = 0xff00e002;
const C_SOB_A_MIRA = 0xff00e003;
const PEDRA = 0x000abc12;

const personagens = new Map([[A, { characterId: 1 }], [B_MAIS_PERTO, { characterId: 2 }], [C_SOB_A_MIRA, { characterId: 3 }]]);
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '../commands' || request.endsWith('/commands')) {
    return { getCharacterData: actorId => personagens.get(actorId) || null };
  }
  return originalLoad.apply(this, arguments);
};

const prompt = require('./interaction-prompt-service');
const physicalAnchorRegistry = require('./physical-anchor-registry');
const properties = [];
const modals = [];

global.mp = {
  set: (actorId, property, value) => properties.push({ actorId, property, value }),
  makeEventSource: () => {}
};

after(() => {
  Module._load = originalLoad;
  delete global.mp;
});

function result(targetType, targetId, actions = [{ action: 'x', label: 'Interagir' }]) {
  return {
    ok: true,
    targetType,
    target: { type: targetType, id: `${targetType}:${targetId}` },
    sections: actions.length ? [{ id: 'teste', actions }] : []
  };
}

beforeEach(() => {
  properties.length = 0;
  modals.length = 0;
  prompt._generationByActor.clear();
  prompt._lastPayloadByActor.clear();
  prompt._lastTargetEventAt.clear();
  physicalAnchorRegistry._reset();
});

describe('aquisição de alvo exato', () => {
  it('usa C sob a mira, mesmo que B seja o ator mais próximo', async () => {
    const calls = [];
    prompt.configure({
      interactionService: {
        peek: async (actorId, request) => {
          calls.push(request);
          return result(request.targetType, request.targetId, [{ action: 'social', label: 'Falar' }]);
        }
      },
      sendModal: (actorId, type, data) => modals.push({ actorId, type, data })
    });

    await prompt.handleClientEvent(A, { kind: 'target', targetFormId: C_SOB_A_MIRA, targetType: 'object' });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].targetId, C_SOB_A_MIRA);
    assert.strictEqual(calls[0].targetType, 'player');
    assert.strictEqual(properties.at(-1).value.targetId, C_SOB_A_MIRA);
    assert.notStrictEqual(properties.at(-1).value.targetId, B_MAIS_PERTO);
  });

  it('ignora targetType do cliente e classifica pedra como object no servidor', async () => {
    let received;
    prompt.configure({
      interactionService: {
        peek: async (actorId, request) => {
          received = request;
          return result('object', request.targetId, [{ action: 'mining.mine', label: 'Minerar' }]);
        }
      },
      sendModal: () => {}
    });

    await prompt.handleClientEvent(A, { kind: 'target', targetFormId: PEDRA, targetType: 'player' });
    assert.deepStrictEqual(received, { targetType: 'object', targetId: PEDRA });
    assert.strictEqual(properties.at(-1).value.label, 'Minerar');
  });

  it('não mostra prompt quando resolução/canSee não oferece ação', async () => {
    prompt.configure({
      interactionService: { peek: async () => result('object', PEDRA, []) },
      sendModal: () => {}
    });
    await prompt.handleClientEvent(A, { kind: 'target', targetFormId: PEDRA });
    assert.strictEqual(properties.at(-1).value.targetId, null);
  });

  it('resposta async antiga não substitui a mira mais recente', async () => {
    let releaseOld;
    const old = new Promise(resolve => { releaseOld = resolve; });
    prompt.configure({
      interactionService: {
        peek: async (actorId, request) => {
          if (request.targetId === B_MAIS_PERTO) await old;
          return result('player', request.targetId, [{ action: 'x', label: 'Falar' }]);
        }
      },
      sendModal: () => {}
    });

    const first = prompt.handleClientEvent(A, { kind: 'target', targetFormId: B_MAIS_PERTO });
    prompt._lastTargetEventAt.clear(); // simula o próximo evento aceito pelo throttle
    await prompt.handleClientEvent(A, { kind: 'target', targetFormId: C_SOB_A_MIRA });
    releaseOld();
    await first;

    assert.strictEqual(properties.at(-1).value.targetId, C_SOB_A_MIRA);
  });

  it('E abre o menu vinculado ao FormID exato já validado', async () => {
    let queryCalls = 0;
    prompt.configure({
      interactionService: {
        query: async (actorId, request) => {
          queryCalls += 1;
          return result('object', request.targetId, [{ action: 'mining.mine', label: 'Minerar' }]);
        }
      },
      sendModal: (actorId, type, data) => modals.push({ actorId, type, data })
    });
    await prompt.handleClientEvent(A, { kind: 'inspect', targetFormId: PEDRA });
    assert.strictEqual(queryCalls, 1);
    assert.deepStrictEqual(modals, [{
      actorId: A,
      type: 'interaction:open',
      data: {
        targetActorId: PEDRA,
        targetType: 'object',
        sections: [{ id: 'teste', actions: [{ action: 'mining.mine', label: 'Minerar' }] }]
      }
    }]);
  });
});

describe('contrato do snippet de cliente', () => {
  it('usa evento de crosshair para prompt, sem capturar E nem fazer polling', () => {
    assert.match(prompt.SNIPPET_DA_FONTE, /Game\.getCurrentCrosshairRef/);
    assert.match(prompt.SNIPPET_DA_FONTE, /getFormIdInServerFormat/);
    assert.match(prompt.SNIPPET_DA_FONTE, /crosshairRefChanged/);
    assert.match(prompt.SNIPPET_DA_FONTE, /once\('update'/);
    assert.doesNotMatch(prompt.SNIPPET_DA_FONTE, /buttonEvent/);
    assert.doesNotMatch(prompt.SNIPPET_DA_FONTE, /keyPress/);
    assert.doesNotMatch(prompt.SNIPPET_DA_FONTE, /lastPollAt|TARGET_POLL_MS|setInterval/);
  });
});

describe('ativação nativa', () => {
  it('consome somente anchor conhecido e consulta o alvo exato de forma assíncrona', async () => {
    physicalAnchorRegistry.register({ targetType: 'object', list: async () => [{ targetId: PEDRA }] });
    await physicalAnchorRegistry.refresh();
    let received = null;
    prompt.configure({
      interactionService: {
        query: async (actorId, request) => {
          received = { actorId, request };
          return result('object', request.targetId, [{ action: 'mining.mine', label: 'Minerar' }]);
        }
      },
      sendModal: (actorId, type, data) => modals.push({ actorId, type, data })
    });

    assert.strictEqual(prompt.handleNativeActivation(PEDRA, A), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(received, { actorId: A, request: { targetType: 'object', targetId: PEDRA } });
    assert.strictEqual(modals.length, 1);
  });

  it('não bloqueia ativação vanilla de objeto desconhecido', () => {
    assert.strictEqual(prompt.handleNativeActivation(0x123456, A), undefined);
  });
});

describe('ciclo de vida por actorId', () => {
  it('limpa caches e a property para o próximo ocupante do slot', () => {
    prompt._generationByActor.set(A, 3);
    prompt._lastPayloadByActor.set(A, '{"targetId":1}');
    prompt._lastTargetEventAt.set(A, Date.now());

    prompt.clearActor(A);

    assert.strictEqual(prompt._generationByActor.has(A), false);
    assert.strictEqual(prompt._lastPayloadByActor.has(A), false);
    assert.strictEqual(prompt._lastTargetEventAt.has(A), false);
    assert.strictEqual(properties.at(-1).value.targetId, null);
  });
});

/**
 * core/interaction-prompt-service.test.js
 *
 * O que estes testes provam: que o servidor escolhe o alvo certo (ator mais
 * próximo dentro do alcance) e computa o rótulo certo (uma ação = o label
 * dela; mais de uma = "Interagir"; zero = sem prompt) — POR OBSERVADOR, sem
 * gastar o rate limit de `interaction:query`.
 *
 * O que eles NÃO provam: que `mp.get(actorId, 'neighbors')` responde o que
 * `range-utils.nearbyActors` assume, nem que o prompt aparece na tela. Mesma
 * ressalva de toda a família de labs deste projeto — ver o cabeçalho de
 * `interaction-prompt-service.js`.
 *
 * Executa com: node --test core/interaction-prompt-service.test.js
 */

'use strict';

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const OBSERVADOR = 0xff00e001;
const PERTO = 0xff00e002;
const MAIS_PERTO = 0xff00e003;
const LONGE = 0xff00e004;

let atoresAtivos = [];
let posicoes = {};
let vizinhosDe = {};

const Module = require('module');
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === './commands' || request.endsWith('/commands')) {
    return { listActiveActorIds: () => [...atoresAtivos] };
  }
  return originalLoad.apply(this, arguments);
};

const prompt = require('./interaction-prompt-service');
const registry = require('./interaction-registry');
const anchorRegistry = require('./physical-anchor-registry');
const { TARGET_TYPES } = registry;

const TERMINAL_DEPOT = 0xff00e010;

const propertyEscrita = new Map();

global.mp = {
  get: (actorId, prop) => {
    if (prop === 'locationalData') return posicoes[actorId];
    if (prop === 'neighbors') return vizinhosDe[actorId] || [];
    if (prop === 'type') return 'MpActor';
    return undefined;
  },
  set: (actorId, propName, valor) => {
    if (propName === prompt.PROPERTY) propertyEscrita.set(actorId, valor);
  }
};

after(() => {
  Module._load = originalLoad;
  delete global.mp;
});

const CELULA = '3c:Skyrim.esm';

function cenarioPadrao() {
  atoresAtivos = [OBSERVADOR, PERTO, MAIS_PERTO, LONGE];
  posicoes = {
    [OBSERVADOR]: { pos: [0, 0, 0], cellOrWorldDesc: CELULA },
    [PERTO]: { pos: [300, 0, 0], cellOrWorldDesc: CELULA },
    [MAIS_PERTO]: { pos: [100, 0, 0], cellOrWorldDesc: CELULA },
    [LONGE]: { pos: [prompt.ALCANCE + 500, 0, 0], cellOrWorldDesc: CELULA }
  };
  vizinhosDe = { [OBSERVADOR]: [PERTO, MAIS_PERTO, LONGE] };
  propertyEscrita.clear();
  prompt._ultimoEnvio.clear();
  anchorRegistry._reset();
  prompt._limparCacheDeAncoras();
}

// ─────────────────────────────────────────────────────────────────────────────
// escolherAlvo — proximidade, não raycast (ver cabeçalho do módulo)
// ─────────────────────────────────────────────────────────────────────────────

describe('escolherAlvo', () => {
  beforeEach(cenarioPadrao);

  it('escolhe o ator ativo mais próximo dentro do alcance', () => {
    assert.strictEqual(prompt.escolherAlvo(OBSERVADOR), MAIS_PERTO);
  });

  it('devolve null sem ninguém por perto', () => {
    vizinhosDe[OBSERVADOR] = [LONGE];
    assert.strictEqual(prompt.escolherAlvo(OBSERVADOR), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rotuloParaAlvo — 0 ações = sem prompt; 1 = o label dela; 2+ = "Interagir"
// ─────────────────────────────────────────────────────────────────────────────

describe('rotuloParaAlvo', () => {
  beforeEach(() => {
    registry._reset();
    cenarioPadrao();
  });

  it('null quando nao ha nenhuma acao visivel', async () => {
    const fakeService = { peek: async () => ({ ok: true, sections: [] }) };
    prompt.configure({ interactionService: fakeService });

    const r = await prompt.rotuloParaAlvo(OBSERVADOR, MAIS_PERTO);
    assert.strictEqual(r, null);
  });

  it('usa o label da unica acao quando so ha uma', async () => {
    const fakeService = {
      peek: async () => ({
        ok: true,
        sections: [{ id: 'social', actions: [{ action: 'social.apresentar', label: 'Apresentar-se' }] }]
      })
    };
    prompt.configure({ interactionService: fakeService });

    const r = await prompt.rotuloParaAlvo(OBSERVADOR, MAIS_PERTO);
    assert.deepStrictEqual(r, { label: 'Apresentar-se', count: 1 });
  });

  it("vira 'Interagir' quando ha mais de uma acao, mesmo em secoes diferentes", async () => {
    const fakeService = {
      peek: async () => ({
        ok: true,
        sections: [
          { id: 'social', actions: [{ action: 'social.apresentar', label: 'Apresentar-se' }] },
          { id: 'trade', actions: [{ action: 'trade.request', label: 'Propor troca' }] }
        ]
      })
    };
    prompt.configure({ interactionService: fakeService });

    const r = await prompt.rotuloParaAlvo(OBSERVADOR, MAIS_PERTO);
    assert.deepStrictEqual(r, { label: 'Interagir', count: 2 });
  });

  it('null quando peek recusa (ex: rate limit de outro tipo, alvo invalido)', async () => {
    const fakeService = { peek: async () => ({ ok: false, stage: 'target', reason: 'nao' }) };
    prompt.configure({ interactionService: fakeService });

    const r = await prompt.rotuloParaAlvo(OBSERVADOR, MAIS_PERTO);
    assert.strictEqual(r, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tick — o que de fato é escrito na property, por observador
// ─────────────────────────────────────────────────────────────────────────────

describe('tick', () => {
  beforeEach(cenarioPadrao);

  it('sem interactionService configurado, nao escreve nada (nao lanca)', async () => {
    prompt.configure({ interactionService: null });
    await prompt.tick();
    assert.strictEqual(propertyEscrita.size, 0);
  });

  it('escreve targetId+label do alvo mais proximo quando ha uma acao', async () => {
    prompt.configure({
      interactionService: {
        peek: async (actorId, req) => {
          if (req.targetId !== MAIS_PERTO) return { ok: true, sections: [] };
          return { ok: true, sections: [{ id: 'social', actions: [{ action: 'x', label: 'Falar' }] }] };
        }
      }
    });

    await prompt.tick();

    const escrito = propertyEscrita.get(OBSERVADOR);
    assert.ok(escrito, 'deveria ter escrito a property do observador');
    assert.strictEqual(escrito.targetId, MAIS_PERTO);
    assert.strictEqual(escrito.targetType, TARGET_TYPES.PLAYER);
    assert.strictEqual(escrito.label, 'Falar');
  });

  it('escreve targetId:null quando ninguem por perto tem acao disponivel', async () => {
    prompt.configure({ interactionService: { peek: async () => ({ ok: true, sections: [] }) } });

    await prompt.tick();

    const escrito = propertyEscrita.get(OBSERVADOR);
    assert.ok(escrito);
    assert.strictEqual(escrito.targetId, null);
  });

  it('nao reescreve a property quando o payload nao mudou entre dois ticks (diffing)', async () => {
    prompt.configure({ interactionService: { peek: async () => ({ ok: true, sections: [] }) } });

    await prompt.tick();
    propertyEscrita.clear();
    await prompt.tick();

    assert.strictEqual(propertyEscrita.size, 0, 'segundo tick identico ao primeiro nao deveria escrever de novo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hibrido: ator (proximidade) vs ancora fisica (Depot etc.) — desempate por
// distancia, ver cabecalho do modulo pra por que nao ha vetor de visao.
// ─────────────────────────────────────────────────────────────────────────────

describe('tick — hibrido ator + ancora fisica (Depot)', () => {
  beforeEach(cenarioPadrao);

  function fakeServiceComRotulos(rotulos) {
    return {
      peek: async (actorId, req) => {
        const label = rotulos[req.targetId];
        if (!label) return { ok: true, sections: [] };
        return { ok: true, sections: [{ id: 'x', actions: [{ action: 'x', label }] }] };
      }
    };
  }

  it('ancora fisica dentro do alcance vence quando nao ha ator perto', async () => {
    posicoes[TERMINAL_DEPOT] = { pos: [50, 0, 0], cellOrWorldDesc: CELULA };
    vizinhosDe[OBSERVADOR] = []; // nenhum ator por perto nesta rodada
    anchorRegistry.register({ targetType: 'object', list: async () => [{ targetId: TERMINAL_DEPOT }] });

    prompt.configure({ interactionService: fakeServiceComRotulos({ [TERMINAL_DEPOT]: 'Ver deposito' }) });
    await prompt.tick();

    const escrito = propertyEscrita.get(OBSERVADOR);
    assert.strictEqual(escrito.targetId, TERMINAL_DEPOT);
    assert.strictEqual(escrito.targetType, 'object');
    assert.strictEqual(escrito.label, 'Ver deposito');
  });

  it('ancora fora do alcance nao compete, mesmo registrada', async () => {
    posicoes[TERMINAL_DEPOT] = { pos: [prompt.ALCANCE + 999, 0, 0], cellOrWorldDesc: CELULA };
    anchorRegistry.register({ targetType: 'object', list: async () => [{ targetId: TERMINAL_DEPOT }] });

    prompt.configure({ interactionService: fakeServiceComRotulos({ [TERMINAL_DEPOT]: 'Ver deposito' }) });
    await prompt.tick();

    const escrito = propertyEscrita.get(OBSERVADOR);
    assert.notStrictEqual(escrito.targetId, TERMINAL_DEPOT);
  });

  it('desempate por distancia: a ancora mais perto que o ator mais perto vence', async () => {
    // MAIS_PERTO (ator) esta a 100 unidades; o terminal, a 40.
    posicoes[TERMINAL_DEPOT] = { pos: [40, 0, 0], cellOrWorldDesc: CELULA };
    anchorRegistry.register({ targetType: 'object', list: async () => [{ targetId: TERMINAL_DEPOT }] });

    prompt.configure({
      interactionService: fakeServiceComRotulos({ [TERMINAL_DEPOT]: 'Ver deposito', [MAIS_PERTO]: 'Falar' })
    });
    await prompt.tick();

    assert.strictEqual(propertyEscrita.get(OBSERVADOR).targetId, TERMINAL_DEPOT);
  });

  it('desempate por distancia: o ator mais perto que a ancora vence', async () => {
    // MAIS_PERTO (ator) a 100 unidades; o terminal, mais longe, a 250.
    posicoes[TERMINAL_DEPOT] = { pos: [250, 0, 0], cellOrWorldDesc: CELULA };
    anchorRegistry.register({ targetType: 'object', list: async () => [{ targetId: TERMINAL_DEPOT }] });

    prompt.configure({
      interactionService: fakeServiceComRotulos({ [TERMINAL_DEPOT]: 'Ver deposito', [MAIS_PERTO]: 'Falar' })
    });
    await prompt.tick();

    assert.strictEqual(propertyEscrita.get(OBSERVADOR).targetId, MAIS_PERTO);
  });

  it('a lista de ancoras e cacheada — um segundo provider registrado so entra apos o TTL', async () => {
    posicoes[TERMINAL_DEPOT] = { pos: [50, 0, 0], cellOrWorldDesc: CELULA };
    vizinhosDe[OBSERVADOR] = [];
    prompt.configure({ interactionService: fakeServiceComRotulos({ [TERMINAL_DEPOT]: 'Ver deposito' }) });

    await prompt.tick(); // aquece o cache vazio (nenhum provider registrado ainda)
    anchorRegistry.register({ targetType: 'object', list: async () => [{ targetId: TERMINAL_DEPOT }] });
    propertyEscrita.clear();
    prompt._ultimoEnvio.clear();
    await prompt.tick(); // ainda dentro do TTL — cache antigo, sem o provider novo

    const escrito = propertyEscrita.get(OBSERVADOR);
    assert.strictEqual(escrito.targetId, null, 'cache nao deveria ter sido reconsultado antes do TTL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SELF como fallback (objetivo 3) — sem ator nem ancora por perto, o proprio
// jogador vira o candidato, pra o prompt [E] abrir o /painel via
// character-dashboard-bridge.js.
// ─────────────────────────────────────────────────────────────────────────────

describe('tick — SELF como fallback (objetivo 3)', () => {
  beforeEach(cenarioPadrao);

  it('sem ator nem ancora por perto, o candidato vira o proprio observador (SELF)', async () => {
    vizinhosDe[OBSERVADOR] = [];
    let targetTypeRecebido = null;
    prompt.configure({
      interactionService: {
        peek: async (actorId, req) => {
          targetTypeRecebido = req.targetType;
          if (req.targetType !== TARGET_TYPES.SELF) return { ok: true, sections: [] };
          return { ok: true, sections: [{ id: 'self', actions: [{ action: 'character.dashboard', label: 'Ver personagem' }] }] };
        }
      }
    });

    await prompt.tick();

    const escrito = propertyEscrita.get(OBSERVADOR);
    assert.strictEqual(escrito.targetId, OBSERVADOR);
    assert.strictEqual(escrito.targetType, TARGET_TYPES.SELF);
    assert.strictEqual(escrito.label, 'Ver personagem');
    assert.strictEqual(targetTypeRecebido, TARGET_TYPES.SELF);
  });

  it('ator real por perto continua vencendo de SELF, mesmo como fallback disponivel', async () => {
    prompt.configure({
      interactionService: {
        peek: async (actorId, req) => {
          if (req.targetId === MAIS_PERTO) return { ok: true, sections: [{ id: 'x', actions: [{ action: 'x', label: 'Falar' }] }] };
          return { ok: true, sections: [{ id: 'self', actions: [{ action: 'character.dashboard', label: 'Ver personagem' }] }] };
        }
      }
    });

    await prompt.tick();

    assert.strictEqual(propertyEscrita.get(OBSERVADOR).targetId, MAIS_PERTO);
  });
});

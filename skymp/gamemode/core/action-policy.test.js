/**
 * core/action-policy.test.js
 *
 * Testes automatizados para action-policy + character-state.
 * Executa com: node --test core/action-policy.test.js
 *
 * Testa que a política central de ações bloqueia corretamente
 * ações em estados inválidos.
 */

const assert = require('assert');
const { describe, it, before, beforeEach, after } = require('node:test');

// Mock do banco para character-state (estados duráveis)
const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../database' || request === './database' || request.endsWith('/database')) {
    return {
      query: async () => [] // Sem estados duráveis no banco para testes
    };
  }
  return originalLoad.apply(this, arguments);
};

const characterState = require('./character-state');
const actionPolicy = require('./action-policy');
const { STATES } = characterState;

Module._load = originalLoad;

// ─────────────────────────────────────────────────────────────────────────────
// Testes
// ─────────────────────────────────────────────────────────────────────────────

describe('action-policy', () => {
  const CHAR_ID = 999;

  beforeEach(() => {
    // Resetar para NORMAL antes de cada teste
    characterState.set(CHAR_ID, STATES.NORMAL, {});
  });

  describe('Estado NORMAL', () => {
    it('deve permitir qualquer ação registrada', () => {
      const actions = ['woodcutting', 'fishing', 'mining', 'craft', 'trade', 'speak', 'public_work'];
      for (const action of actions) {
        const { allowed } = actionPolicy.canPerform(CHAR_ID, action);
        assert.ok(allowed, `NORMAL deve permitir '${action}'`);
      }
    });
  });

  describe('Estado RESTRAINED', () => {
    beforeEach(() => {
      characterState.set(CHAR_ID, STATES.RESTRAINED, { type: 'handcuffs' });
    });

    it('deve bloquear coleta (woodcutting)', () => {
      const { allowed, reason } = actionPolicy.canPerform(CHAR_ID, 'woodcutting');
      assert.strictEqual(allowed, false, 'RESTRAINED deve bloquear woodcutting');
      assert.ok(reason.length > 0, 'Deve fornecer motivo');
    });

    it('deve bloquear pesca (fishing)', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'fishing');
      assert.strictEqual(allowed, false, 'RESTRAINED deve bloquear fishing');
    });

    it('deve bloquear mineração (mining)', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'mining');
      assert.strictEqual(allowed, false, 'RESTRAINED deve bloquear mining');
    });

    it('deve bloquear trade', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'trade');
      assert.strictEqual(allowed, false, 'RESTRAINED deve bloquear trade');
    });
  });

  describe('Estado IMPRISONED', () => {
    beforeEach(() => {
      characterState.set(CHAR_ID, STATES.IMPRISONED, { prison_record_id: 1 });
    });

    it('deve bloquear venda (sell)', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'sell');
      assert.strictEqual(allowed, false, 'IMPRISONED deve bloquear sell');
    });

    it('deve bloquear trade', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'trade');
      assert.strictEqual(allowed, false, 'IMPRISONED deve bloquear trade');
    });

    it('deve bloquear coleta (woodcutting)', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'woodcutting');
      assert.strictEqual(allowed, false, 'IMPRISONED deve bloquear woodcutting');
    });
  });

  describe('Estado IN_TRADE', () => {
    beforeEach(() => {
      characterState.set(CHAR_ID, STATES.IN_TRADE, { partner_id: 42 });
    });

    it('deve bloquear coleta durante trade', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'woodcutting');
      assert.strictEqual(allowed, false, 'IN_TRADE deve bloquear woodcutting');
    });

    it('deve bloquear mineração durante trade', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'mining');
      assert.strictEqual(allowed, false, 'IN_TRADE deve bloquear mining');
    });
  });

  describe('Estado BUSY', () => {
    beforeEach(() => {
      characterState.set(CHAR_ID, STATES.BUSY, { activity: 'woodcutting' });
    });

    it('deve bloquear nova coleta enquanto ocupado', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'fishing');
      assert.strictEqual(allowed, false, 'BUSY deve bloquear fishing');
    });

    it('deve bloquear crafting enquanto ocupado', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'craft');
      assert.strictEqual(allowed, false, 'BUSY deve bloquear craft');
    });

    it('deve bloquear trabalho público enquanto ocupado', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'public_work');
      assert.strictEqual(allowed, false, 'BUSY deve bloquear public_work');
    });
  });

  describe('Estado DOWNED', () => {
    beforeEach(() => {
      characterState.set(CHAR_ID, STATES.DOWNED, {});
    });

    it('deve bloquear fala (speak) quando abatido', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'speak');
      assert.strictEqual(allowed, false, 'DOWNED deve bloquear speak');
    });

    it('deve bloquear toda ação de gameplay', () => {
      const { allowed } = actionPolicy.canPerform(CHAR_ID, 'woodcutting');
      assert.strictEqual(allowed, false, 'DOWNED deve bloquear woodcutting');
    });
  });

  describe('Ação desconhecida', () => {
    it('deve bloquear ação não registrada por segurança', () => {
      const { allowed, reason } = actionPolicy.canPerform(CHAR_ID, 'acao_inexistente_xyz');
      assert.strictEqual(allowed, false, 'Ação desconhecida deve ser bloqueada');
      assert.ok(reason.includes('desconhecida'), 'Mensagem deve mencionar "desconhecida"');
    });
  });
});

console.log('[test] action-policy tests registrados.');

/**
 * A segunda dimensão da política: **lugar**.
 *
 * Até 06/08/2026 a action-policy só sabia bloquear por estado do personagem
 * (algemado, abatido, preso). Zona segura veio do Red House
 * (`REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1) e usa o `context` que a
 * `canPerform` já declarava como "para validações futuras".
 *
 * O ponto mais importante daqui é a compatibilidade: quem chama sem
 * `context.actorId` — que é todo chamador existente — não pode ver diferença
 * nenhuma. Uma regressão aqui ligaria zona segura no servidor inteiro sem
 * ninguém pedir.
 */
describe('action-policy — bloqueio por lugar', () => {
  const safeZones = require('./safe-zones');

  const DENTRO = 0xff00aa01;
  const FORA = 0xff00aa02;
  const CHAR = 8801;
  const CELULA = '0xsafe';

  const posicoes = new Map();
  const mpOriginal = global.mp;

  before(() => {
    global.mp = {
      get: (actorId, prop) => (prop === 'locationalData' ? posicoes.get(actorId) || null : null)
    };
  });

  after(() => {
    safeZones._setZones([]);
    if (mpOriginal === undefined) delete global.mp;
    else global.mp = mpOriginal;
  });

  beforeEach(() => {
    posicoes.clear();
    posicoes.set(DENTRO, { pos: [0, 0, 0], cellOrWorldDesc: CELULA });
    posicoes.set(FORA, { pos: [0, 0, 0], cellOrWorldDesc: '0xoutra' });
    characterState.set(CHAR, STATES.NORMAL, {});
    safeZones._setZones([
      { id: 'templo', label: 'Templo de Kynareth', cellId: CELULA, pos: null, radius: null, blocks: ['gather'] }
    ]);
  });

  it('sem context.actorId, nada muda — é o caminho de todo chamador atual', () => {
    const r = actionPolicy.canPerform(CHAR, 'woodcutting');
    assert.strictEqual(r.allowed, true, 'quem não informa onde está não pode ser barrado por lugar');
  });

  it('com actorId dentro da zona, a categoria proibida barra', () => {
    const r = actionPolicy.canPerform(CHAR, 'woodcutting', { actorId: DENTRO });
    assert.strictEqual(r.allowed, false);
    assert.match(r.reason, /Templo de Kynareth/, 'a mensagem precisa dizer onde');
  });

  it('a mesma ação passa fora da zona', () => {
    assert.strictEqual(actionPolicy.canPerform(CHAR, 'woodcutting', { actorId: FORA }).allowed, true);
  });

  it('categoria não listada pela zona continua liberada lá dentro', () => {
    // A zona proíbe 'gather'; 'speak' é 'speak_rp'.
    assert.strictEqual(actionPolicy.canPerform(CHAR, 'speak', { actorId: DENTRO }).allowed, true);
  });

  it('estado vem antes de lugar na mensagem', () => {
    // Algemado DENTRO de uma zona segura: a explicação útil é a algema.
    characterState.set(CHAR, STATES.RESTRAINED, {});
    const r = actionPolicy.canPerform(CHAR, 'woodcutting', { actorId: DENTRO });
    assert.strictEqual(r.allowed, false);
    assert.match(r.reason, /algemado/i, 'estado explica melhor que lugar quando os dois valem');
  });

  it('alvo protegido barra quem age de fora, e a mensagem diz de quem é a proteção', () => {
    const r = actionPolicy.canPerform(CHAR, 'woodcutting', { actorId: FORA, targetActorId: DENTRO });
    assert.strictEqual(r.allowed, false);
    assert.match(r.reason, /alvo/i, 'sem isso a mensagem diria "você está em zona segura", que parece bug');
  });

  it('agressor protegido não age sobre quem está fora', () => {
    const r = actionPolicy.canPerform(CHAR, 'woodcutting', { actorId: DENTRO, targetActorId: FORA });
    assert.strictEqual(r.allowed, false);
    assert.match(r.reason, /Você está/i);
  });

  it('sem zona configurada, informar actorId não muda nada', () => {
    safeZones._setZones([]);
    assert.strictEqual(actionPolicy.canPerform(CHAR, 'woodcutting', { actorId: DENTRO }).allowed, true);
  });
});

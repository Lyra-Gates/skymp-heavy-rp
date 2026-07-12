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
const { describe, it, beforeEach } = require('node:test');

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
      const actions = ['woodcutting', 'fishing', 'mining', 'craft', 'trade', 'speak'];
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

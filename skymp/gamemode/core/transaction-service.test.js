/**
 * core/transaction-service.test.js
 *
 * Testes automatizados para o transaction-service.
 * Executa com: node --test core/transaction-service.test.js
 *
 * Usa mock do banco de dados — não requer MariaDB rodando.
 */

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────
// Mock do banco de dados
// ─────────────────────────────────────────────────────────────────────────────

// Estado compartilhado do mock BD
let mockInventory = {};    // { characterId_baseId: count }
let mockGold = {};         // { characterId: gold }
let mockLedger = [];       // Array de transações
let mockIdempotency = new Set(); // Chaves de idempotência usadas

function mockDb() {
  return {
    query: async (sql, params) => {
      const s = sql.trim().toUpperCase();

      // Verificação de idempotência
      if (s.startsWith('SELECT TRANSACTION_ID FROM INVENTORY_TRANSACTIONS WHERE IDEMPOTENCY_KEY')) {
        const key = params[0];
        if (mockIdempotency.has(key)) return [{ transaction_id: 'existing' }];
        return [];
      }
      if (s.includes('UNION SELECT TRANSACTION_ID FROM GOLD_TRANSACTIONS')) {
        // A query usa dois params iguais (mesmo key para ambas as tabelas)
        const key = params[0];
        if (mockIdempotency.has(key)) return [{ transaction_id: 'existing' }];
        return [];
      }

      // SELECT inventário
      if (s.startsWith('SELECT COUNT FROM CHARACTER_INVENTORY')) {
        const charId = params[0], baseId = params[1];
        const k = `${charId}_${baseId}`;
        if (mockInventory[k] !== undefined) return [{ count: mockInventory[k] }];
        return [];
      }

      // SELECT ouro
      if (s.startsWith('SELECT GOLD FROM CHARACTERS')) {
        const charId = params[0];
        return [{ gold: mockGold[charId] || 0 }];
      }

      return [];
    },
    getConnection: async () => {
      // Conexão com transação simulada
      const ops = [];
      return {
        beginTransaction: async () => {},
        commit: async () => {
          // Aplicar todas as ops do batch
          for (const op of ops) op();
        },
        rollback: async () => { ops.length = 0; },
        release: () => {},
        query: async (sql, params) => {
          const s = sql.trim().toUpperCase();

          if (s.startsWith('INSERT INTO INVENTORY_TRANSACTIONS')) {
            const key = params[6]; // idempotency_key
            ops.push(() => {
              mockLedger.push({ type: 'inventory', params });
              if (key) mockIdempotency.add(key);
            });
            return [{}];
          }

          if (s.startsWith('INSERT INTO GOLD_TRANSACTIONS')) {
            const key = params[5];
            ops.push(() => {
              mockLedger.push({ type: 'gold', params });
              if (key) mockIdempotency.add(key);
            });
            return [{}];
          }

          if (s.startsWith('SELECT COUNT FROM CHARACTER_INVENTORY')) {
            const charId = params[0], baseId = params[1];
            const k = `${charId}_${baseId}`;
            if (mockInventory[k] !== undefined) return [[{ count: mockInventory[k] }]];
            return [[]];
          }

          if (s.startsWith('UPDATE CHARACTER_INVENTORY SET COUNT = COUNT +')) {
            ops.push(() => {
              const k = `${params[1]}_${params[2]}`;
              mockInventory[k] = (mockInventory[k] || 0) + params[0];
            });
            return [[{}]];
          }

          if (s.startsWith('INSERT INTO CHARACTER_INVENTORY')) {
            ops.push(() => {
              const k = `${params[0]}_${params[1]}`;
              mockInventory[k] = params[2];
            });
            return [[{}]];
          }

          if (s.startsWith('UPDATE CHARACTER_INVENTORY SET COUNT = ?')) {
            ops.push(() => {
              const k = `${params[1]}_${params[2]}`;
              mockInventory[k] = params[0];
            });
            return [[{}]];
          }

          if (s.startsWith('DELETE FROM CHARACTER_INVENTORY')) {
            ops.push(() => {
              const k = `${params[0]}_${params[1]}`;
              delete mockInventory[k];
            });
            return [[{}]];
          }

          if (s.startsWith('SELECT GOLD FROM CHARACTERS')) {
            return [[{ gold: mockGold[params[0]] || 0 }]];
          }

          if (s.startsWith('UPDATE CHARACTERS SET GOLD = GOLD +')) {
            ops.push(() => {
              mockGold[params[1]] = (mockGold[params[1]] || 0) + params[0];
            });
            return [[{}]];
          }

          return [[]];
        }
      };
    }
  };
}

// Injetar mock antes de importar o módulo
const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../database' || request === './database' || request.endsWith('/database')) {
    return mockDb();
  }
  return originalLoad.apply(this, arguments);
};

const transactionService = require('./transaction-service');

// Restaurar require original
Module._load = originalLoad;

// ─────────────────────────────────────────────────────────────────────────────
// Testes
// ─────────────────────────────────────────────────────────────────────────────

describe('transaction-service', () => {
  beforeEach(() => {
    // Limpar estado do mock entre testes
    mockInventory = {};
    mockGold = {};
    mockLedger = [];
    mockIdempotency = new Set();
  });

  describe('giveItem', () => {
    it('deve adicionar item ao inventário e registrar no ledger', async () => {
      const ok = await transactionService.giveItem({
        actorId: null,
        characterId: 1,
        baseId: 0x1c,
        count: 5,
        reason: 'test',
        module: 'test'
      });

      assert.strictEqual(ok, true, 'giveItem deve retornar true');
      assert.strictEqual(mockInventory['1_28'], 5, 'Inventário deve ter 5 unidades');
      assert.ok(mockLedger.some(l => l.type === 'inventory'), 'Deve ter entrada no ledger');
    });

    it('deve acumular itens ao chamar giveItem várias vezes', async () => {
      await transactionService.giveItem({ actorId: null, characterId: 1, baseId: 0x1c, count: 3, reason: 'test', module: 'test' });
      await transactionService.giveItem({ actorId: null, characterId: 1, baseId: 0x1c, count: 7, reason: 'test', module: 'test' });
      
      assert.strictEqual(mockInventory['1_28'], 10, 'Inventário deve acumular 10 unidades');
    });

    it('deve ignorar segunda chamada com mesmo idempotency_key', async () => {
      const key = 'test-idempotent-001';
      await transactionService.giveItem({ actorId: null, characterId: 1, baseId: 0x1c, count: 5, reason: 'test', module: 'test', idempotencyKey: key });
      await transactionService.giveItem({ actorId: null, characterId: 1, baseId: 0x1c, count: 5, reason: 'test', module: 'test', idempotencyKey: key });
      
      // Apenas a primeira entrega deve contar
      assert.strictEqual(mockInventory['1_28'], 5, 'Idempotência: deve ter apenas 5 unidades');
    });
  });

  describe('removeItem', () => {
    it('deve remover item existente', async () => {
      // Setup: inventário com 10 unidades
      mockInventory['1_28'] = 10;

      const ok = await transactionService.removeItem({
        actorId: null,
        characterId: 1,
        baseId: 0x1c,
        count: 3,
        reason: 'test',
        module: 'test'
      });

      assert.strictEqual(ok, true, 'removeItem deve retornar true');
      assert.strictEqual(mockInventory['1_28'], 7, 'Inventário deve ter 7 unidades');
    });

    it('deve retornar false ao tentar remover mais do que existe', async () => {
      mockInventory['1_28'] = 2;

      const ok = await transactionService.removeItem({
        actorId: null,
        characterId: 1,
        baseId: 0x1c,
        count: 5,
        reason: 'test',
        module: 'test'
      });

      assert.strictEqual(ok, false, 'Deve retornar false com estoque insuficiente');
      assert.strictEqual(mockInventory['1_28'], 2, 'Inventário não deve ser alterado em falha');
    });

    it('deve retornar false ao tentar remover item inexistente', async () => {
      const ok = await transactionService.removeItem({
        actorId: null,
        characterId: 1,
        baseId: 0x99,
        count: 1,
        reason: 'test',
        module: 'test'
      });

      assert.strictEqual(ok, false, 'Deve retornar false para item inexistente');
    });
  });

  describe('hasItem', () => {
    it('deve retornar true quando personagem tem item suficiente', async () => {
      mockInventory['1_28'] = 5;
      const result = await transactionService.hasItem(1, 0x1c, 3);
      assert.strictEqual(result, true);
    });

    it('deve retornar false quando personagem não tem item suficiente', async () => {
      mockInventory['1_28'] = 1;
      const result = await transactionService.hasItem(1, 0x1c, 3);
      assert.strictEqual(result, false);
    });
  });
});

console.log('[test] transaction-service tests registrados.');

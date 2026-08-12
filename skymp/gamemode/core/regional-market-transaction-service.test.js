const assert = require('assert');
const { describe, it } = require('node:test');
const market = require('./regional-market-transaction-service');

function harness(options = {}) {
  const state = { events: [], marketStock: options.stock ?? 10, holdTreasury: 0, replay: options.replay || null };
  const conn = {
    beginTransaction: async () => state.events.push('begin'),
    commit: async () => state.events.push('commit'),
    rollback: async () => state.events.push('rollback'),
    release: () => state.events.push('release'),
    query: async (sql, params = []) => {
      if (/SELECT id, tax_rate FROM holds/i.test(sql)) return [[{ id: 'whiterun', tax_rate: 0.1 }]];
      if (/SELECT hold_id, base_id, buy_price, sell_price, stock FROM market_prices/i.test(sql)) {
        return [options.noMarket ? [] : [{ hold_id: 'whiterun', base_id: 99, buy_price: 10, sell_price: 7, stock: state.marketStock }]];
      }
      if (/FROM regional_market_transactions WHERE idempotency_key/i.test(sql)) return [state.replay ? [state.replay] : []];
      if (/UPDATE market_prices SET stock = stock -/i.test(sql)) { state.marketStock -= params[0]; state.events.push('stock-minus'); return [{ affectedRows: 1 }]; }
      if (/UPDATE holds SET treasury = treasury \+/i.test(sql)) { state.holdTreasury += params[0]; state.events.push('tax'); return [{ affectedRows: 1 }]; }
      if (/INSERT INTO market_prices/i.test(sql)) { state.events.push('stock-plus'); return [{ affectedRows: 1 }]; }
      if (/INSERT INTO regional_market_transactions/i.test(sql)) { state.events.push('market-ledger'); return [{ affectedRows: 1 }]; }
      throw new Error(`SQL inesperado: ${sql}`);
    }
  };
  const tx = {
    applyGoldDelta: async (_conn, _char, delta) => { if (options.failGold) throw new Error('ouro insuficiente'); state.events.push(`gold:${delta}`); },
    applyInventoryDelta: async (_conn, _char, _base, delta) => { if (options.failInventory) throw new Error('item insuficiente'); state.events.push(`inventory:${delta}`); },
    recordGoldLedger: async () => state.events.push('gold-ledger'),
    recordInventoryLedger: async () => state.events.push('inventory-ledger'),
    applyToClient: (_actor, _base, delta) => state.events.push(`client:${delta}`)
  };
  return { state, deps: { db: { getConnection: async () => conn }, tx } };
}

const request = (extra = {}) => ({ actorId: 500, characterId: 101, holdId: 'whiterun', baseId: 99, count: 2, idempotencyKey: 'regional-market-0001', ...extra });

describe('regional-market-transaction-service', () => {
  it('compra estoque, ouro e inventario no mesmo commit e só então atualiza o cliente', async () => {
    const h = harness();
    const result = await market.buy(request(), h.deps);
    assert.deepStrictEqual({ ok: result.ok, replayed: result.replayed, gross: result.gross }, { ok: true, replayed: false, gross: 50 });
    assert.strictEqual(h.state.marketStock, 8);
    assert.deepStrictEqual(h.state.events, ['begin', 'gold:-50', 'inventory:2', 'stock-minus', 'gold-ledger', 'inventory-ledger', 'market-ledger', 'commit', 'client:2', 'release']);
  });

  it('faz rollback de uma compra se o debito de ouro falhar', async () => {
    const h = harness({ failGold: true });
    await assert.rejects(market.buy(request(), h.deps), /ouro insuficiente/);
    assert.deepStrictEqual(h.state.events, ['begin', 'rollback', 'release']);
  });

  it('venda move item, ouro, imposto, estoque e ledger no mesmo commit', async () => {
    const h = harness({ stock: 50 });
    const result = await market.sell(request({ idempotencyKey: 'regional-market-0002' }), h.deps);
    assert.deepStrictEqual({ ok: result.ok, gross: result.gross, tax: result.tax, net: result.net }, { ok: true, gross: 8, tax: 1, net: 7 });
    assert.strictEqual(h.state.holdTreasury, 1);
    assert.deepStrictEqual(h.state.events, ['begin', 'inventory:-2', 'gold:7', 'tax', 'stock-plus', 'inventory-ledger', 'gold-ledger', 'market-ledger', 'commit', 'client:-2', 'release']);
  });

  it('replay retorna o registro e não exige estoque atual nem move saldo', async () => {
    const h = harness({ stock: 0, replay: { transaction_id: 'old', direction: 'buy', unit_price: 14, gross_amount: 28, tax_amount: 0 } });
    const result = await market.buy(request({ idempotencyKey: 'regional-market-0003' }), h.deps);
    assert.deepStrictEqual(result, { ok: true, replayed: true, transactionId: 'old', unitPrice: 14, gross: 28, tax: 0 });
    assert.deepStrictEqual(h.state.events, ['begin', 'commit', 'release']);
  });

  it('recusa requestId que nao deixa espaco para as chaves dos ledgers', async () => {
    const h = harness();
    const result = await market.buy(request({ idempotencyKey: 'x'.repeat(49) }), h.deps);
    assert.deepStrictEqual(result, { ok: false, code: 'invalid_idempotency_key' });
    assert.deepStrictEqual(h.state.events, []);
  });
});

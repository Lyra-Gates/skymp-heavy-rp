const assert = require('assert');
const { describe, it } = require('node:test');
const treasury = require('./institutional-treasury-service');

function makeHarness(options = {}) {
  const state = {
    holdTreasury: options.holdTreasury ?? 100,
    factionTreasury: options.factionTreasury ?? 20,
    events: [],
    ledger: options.existing ? [{ transfer_id: 'old-transfer', faction_id: 7, amount: 25 }] : []
  };
  const conn = {
    beginTransaction: async () => state.events.push('begin'),
    commit: async () => state.events.push('commit'),
    rollback: async () => state.events.push('rollback'),
    release: () => state.events.push('release'),
    query: async (sql, params = []) => {
      if (/SELECT id, treasury, ruling_faction_id FROM holds/i.test(sql)) {
        return [[{ id: 'whiterun', treasury: state.holdTreasury, ruling_faction_id: options.rulingFactionId ?? 7 }]];
      }
      if (/FROM institutional_treasury_transactions WHERE idempotency_key/i.test(sql)) {
        return [[...state.ledger]];
      }
      if (/UPDATE holds SET treasury = treasury -/i.test(sql)) {
        const amount = params[0];
        if (state.holdTreasury < amount) return [{ affectedRows: 0 }];
        state.holdTreasury -= amount;
        state.events.push('debit');
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE factions SET treasury = treasury \+/i.test(sql)) {
        if (options.missingFaction) return [{ affectedRows: 0 }];
        state.factionTreasury += params[0];
        state.events.push('credit');
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO institutional_treasury_transactions/i.test(sql)) {
        if (options.failLedger) throw new Error('ledger indisponivel');
        state.ledger.push({ transfer_id: params[0], faction_id: params[4], amount: params[5] });
        state.events.push('ledger');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    }
  };
  return {
    state,
    dependencies: {
      db: { getConnection: async () => conn },
      governance: {
        getMembership: async (_characterId, _scope, _scopeId, queryable) => {
          assert.strictEqual(queryable, conn, 'a autorizacao deve usar a conexao da transacao');
          return options.membership === undefined ? { role_name: 'leader' } : options.membership;
        }
      }
    }
  };
}

describe('institutional-treasury-service', () => {
  it('debita, credita e registra ledger em uma unica transacao', async () => {
    const harness = makeHarness();
    const result = await treasury.transferHoldTreasury({
      characterId: 101,
      holdId: 'whiterun',
      amount: 30,
      idempotencyKey: 'hold-withdraw-0001'
    }, harness.dependencies);

    assert.deepStrictEqual(
      { ok: result.ok, replayed: result.replayed, factionId: result.factionId, amount: result.amount },
      { ok: true, replayed: false, factionId: 7, amount: 30 }
    );
    assert.strictEqual(harness.state.holdTreasury, 70);
    assert.strictEqual(harness.state.factionTreasury, 50);
    assert.deepStrictEqual(harness.state.events, ['begin', 'debit', 'credit', 'ledger', 'commit', 'release']);
  });

  it('nao debita quando o tesouro ficou insuficiente sob a trava', async () => {
    const harness = makeHarness({ holdTreasury: 20 });
    const result = await treasury.transferHoldTreasury({
      characterId: 101,
      holdId: 'whiterun',
      amount: 30,
      idempotencyKey: 'hold-withdraw-0002'
    }, harness.dependencies);

    assert.deepStrictEqual(result, { ok: false, code: 'insufficient_treasury', treasury: 20 });
    assert.strictEqual(harness.state.holdTreasury, 20);
    assert.strictEqual(harness.state.factionTreasury, 20);
    assert.ok(!harness.state.events.includes('credit'));
    assert.ok(!harness.state.events.includes('ledger'));
    assert.ok(harness.state.events.includes('commit'));
  });

  it('replay da mesma chave nao move ouro pela segunda vez', async () => {
    const harness = makeHarness({ existing: true });
    const result = await treasury.transferHoldTreasury({
      characterId: 101,
      holdId: 'whiterun',
      amount: 25,
      idempotencyKey: 'hold-withdraw-0003'
    }, harness.dependencies);

    assert.deepStrictEqual(result, { ok: true, replayed: true, transferId: 'old-transfer', factionId: 7, amount: 25 });
    assert.strictEqual(harness.state.holdTreasury, 100);
    assert.strictEqual(harness.state.factionTreasury, 20);
    assert.ok(!harness.state.events.includes('debit'));
  });

  it('faz rollback se o credito institucional falhar depois do debito', async () => {
    const harness = makeHarness({ missingFaction: true });
    await assert.rejects(
      treasury.transferHoldTreasury({
        characterId: 101,
        holdId: 'whiterun',
        amount: 30,
        idempotencyKey: 'hold-withdraw-0004'
      }, harness.dependencies),
      /Faccao regente/
    );
    assert.ok(harness.state.events.includes('debit'));
    assert.ok(harness.state.events.includes('rollback'));
    assert.ok(!harness.state.events.includes('ledger'));
    assert.strictEqual(harness.state.events.at(-1), 'release');
  });

  it('recusa quantidade frouxa antes de abrir conexao', async () => {
    const harness = makeHarness();
    const result = await treasury.transferHoldTreasury({
      characterId: 101,
      holdId: 'whiterun',
      amount: '30gold',
      idempotencyKey: 'hold-withdraw-0005'
    }, harness.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'invalid_amount' });
    assert.deepStrictEqual(harness.state.events, []);
  });
});

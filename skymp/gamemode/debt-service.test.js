/**
 * debt-service.test.js
 *
 * O que estes testes travam:
 *
 *   1. **Abrir dívida não move septim.** Dívida é o registro de que o dinheiro
 *      NÃO se moveu.
 *   2. **`remaining` só cai porque houve pagamento ou perdão.** Nunca por
 *      dedução automática — é a rejeição do ADR 004 §4.4, e o teste
 *      correspondente é o que impede alguém de "melhorar" o serviço
 *      transformando-o em confisco.
 *   3. **O septim se move ANTES do abatimento.** Se a ordem inverter, uma falha
 *      no pagamento deixa a dívida menor sem ninguém ter recebido.
 *   4. **`defaulted` é rótulo, não confisco.**
 *   5. **A mesma origem não vira duas dívidas.**
 *
 * Executa com: node --test debt-service.test.js
 */

const assert = require('assert');
const { describe, it } = require('node:test');
const debts = require('./debt-service');
const economyService = require('./core/economy-service');

const DEVEDOR = 41;
const CREDOR = 52;

function makeHarness(options = {}) {
  const state = {
    debts: new Map(),
    payments: [],
    gold: { [DEVEDOR]: 500, [CREDOR]: 0, ...(options.gold || {}) },
    treasury: { 'city:whiterun': 0 },
    transferencias: [],
    nextDebtId: 1,
    rolledBack: false
  };

  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => { state.rolledBack = true; },
    release: () => {},
    query: async (sql, params = []) => {
      if (options.failOn && new RegExp(options.failOn, 'i').test(sql)) {
        throw new Error('conexao com o banco caiu');
      }
      if (/FROM debts WHERE id = \? FOR UPDATE/i.test(sql)) {
        const found = state.debts.get(params[0]);
        return [found ? [{ ...found }] : []];
      }
      if (/FROM debts WHERE idempotency_key = \? FOR UPDATE/i.test(sql)) {
        const found = [...state.debts.values()].find(d => d.idempotency_key === params[0]);
        return [found ? [{ id: found.id, remaining: found.remaining, status: found.status }] : []];
      }
      if (/FROM debt_payments WHERE idempotency_key = \? FOR UPDATE/i.test(sql)) {
        const found = state.payments.find(p => p.idempotencyKey === params[0]);
        return [found ? [{ id: 1, debt_id: found.debtId, amount: found.amount, kind: found.kind }] : []];
      }
      if (/INSERT INTO debts/i.test(sql)) {
        const id = state.nextDebtId++;
        state.debts.set(id, {
          id, debtor_character_id: params[0], creditor_type: params[1], creditor_ref: params[2],
          principal: params[3], remaining: params[4], reason: params[5],
          origin_type: params[6], origin_ref: params[7], status: params[8], idempotency_key: params[9]
        });
        return [{ insertId: id }];
      }
      if (/UPDATE debts SET remaining = remaining - \?/i.test(sql)) {
        const debt = state.debts.get(params[3]);
        if (!debt || debt.remaining < params[4]) return [{ affectedRows: 0 }];
        debt.remaining -= params[0];
        debt.status = params[1];
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE debts SET status = \?/i.test(sql)) {
        const debt = state.debts.get(params[1]);
        if (!debt || debt.status !== params[2]) return [{ affectedRows: 0 }];
        debt.status = params[0];
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO debt_payments/i.test(sql)) {
        state.payments.push({
          debtId: params[0], amount: params[1], transferId: params[2],
          kind: params[3], actor: params[4], idempotencyKey: params[5]
        });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    }
  };

  const economy = {
    normalizeAmount: economyService.normalizeAmount,
    normalizeIdempotencyKey: economyService.normalizeIdempotencyKey,
    normalizeAccount: economyService.normalizeAccount,
    SYSTEM_TYPE: economyService.SYSTEM_TYPE,
    transferInTransaction: async (_conn, request) => {
      if (options.failTransfer) return { ok: false, code: 'insufficient_funds', balance: 0 };
      const origem = state.gold[request.from.ref] || 0;
      if (origem < request.amount) return { ok: false, code: 'insufficient_funds', balance: origem };
      state.gold[request.from.ref] = origem - request.amount;
      if (request.to.type === 'character') {
        state.gold[request.to.ref] = (state.gold[request.to.ref] || 0) + request.amount;
      } else {
        const chave = `${request.to.type}:${request.to.ref}`;
        state.treasury[chave] = (state.treasury[chave] || 0) + request.amount;
      }
      state.transferencias.push({ de: request.from.ref, para: request.to.ref, valor: request.amount });
      return { ok: true, replayed: false, transferId: `t-${state.transferencias.length}`, amount: request.amount };
    }
  };

  return {
    state,
    dependencies: {
      db: {
        getConnection: async () => conn,
        query: async (sql, params = []) => {
          const [rows] = await conn.query(sql, params);
          return rows;
        }
      },
      economy
    }
  };
}

function abrir(h, extra = {}) {
  return debts.open({
    debtorCharacterId: DEVEDOR,
    creditor: { type: 'character', ref: CREDOR },
    amount: 300,
    reason: 'Multa nao paga da guarda de Whiterun',
    originType: 'fine',
    originRef: '77',
    idempotencyKey: 'divida-0001',
    ...extra
  }, h.dependencies);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('debt — abertura', () => {
  it('registra sem mover septim nenhum', async () => {
    const h = makeHarness();
    const result = await abrir(h);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.remaining, 300);
    assert.strictEqual(h.state.gold[DEVEDOR], 500, 'abrir divida NAO cobra');
    assert.strictEqual(h.state.gold[CREDOR], 0, 'e NAO paga');
    assert.strictEqual(h.state.transferencias.length, 0);

    const divida = h.state.debts.get(result.debtId);
    assert.strictEqual(divida.principal, 300);
    assert.strictEqual(divida.status, 'active');
    assert.strictEqual(divida.origin_type, 'fine');
    assert.strictEqual(divida.origin_ref, '77');
  });

  it('a mesma origem nao vira duas dividas', async () => {
    const h = makeHarness();
    const primeira = await abrir(h);
    const segunda = await abrir(h);

    assert.strictEqual(segunda.ok, true);
    assert.strictEqual(segunda.replayed, true);
    assert.strictEqual(segunda.debtId, primeira.debtId);
    assert.strictEqual(h.state.debts.size, 1);
  });

  it('recusa divida consigo mesmo', async () => {
    const h = makeHarness();
    const result = await abrir(h, { creditor: { type: 'character', ref: DEVEDOR } });
    assert.deepStrictEqual(result, { ok: false, code: 'self_debt' });
  });

  it('recusa credor system — ninguem deve ao vazio', async () => {
    const h = makeHarness();
    const result = await abrir(h, { creditor: { type: 'system', ref: 'treasury' } });
    assert.deepStrictEqual(result, { ok: false, code: 'invalid_creditor' });
  });

  it('aceita credor institucional', async () => {
    const h = makeHarness();
    const result = await abrir(h, { creditor: { type: 'city', ref: 'whiterun' } });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(h.state.debts.get(result.debtId).creditor_type, 'city');
  });
});

describe('debt — pagamento', () => {
  it('move o septim e abate o saldo devedor', async () => {
    const h = makeHarness();
    const divida = await abrir(h);

    const result = await debts.pay({
      debtId: divida.debtId, amount: 100, idempotencyKey: 'pag-0001'
    }, h.dependencies);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.remaining, 200);
    assert.strictEqual(h.state.gold[DEVEDOR], 400);
    assert.strictEqual(h.state.gold[CREDOR], 100);
    assert.strictEqual(h.state.debts.get(divida.debtId).status, 'active', 'parcial nao fecha');
    // O `transfer_id` é o que prova que a dívida caiu porque septim mudou de
    // dono, e não porque alguém editou `remaining`.
    assert.ok(h.state.payments[0].transferId, 'todo pagamento aponta para a transferencia');
  });

  it('quitar zera e fecha', async () => {
    const h = makeHarness();
    const divida = await abrir(h);
    const result = await debts.pay({
      debtId: divida.debtId, amount: 300, idempotencyKey: 'pag-0002'
    }, h.dependencies);

    assert.strictEqual(result.remaining, 0);
    assert.strictEqual(result.status, 'paid');
    assert.strictEqual(h.state.debts.get(divida.debtId).status, 'paid');
  });

  it('se a transferencia falha, o saldo devedor NAO cai', async () => {
    // A ordem é o ponto: septim primeiro, abatimento depois. Mutação que
    // reprova aqui: abater antes de chamar a economia.
    const h = makeHarness({ failTransfer: true });
    const divida = await abrir(h);
    const result = await debts.pay({
      debtId: divida.debtId, amount: 100, idempotencyKey: 'pag-0003'
    }, h.dependencies);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'insufficient_funds');
    assert.strictEqual(h.state.debts.get(divida.debtId).remaining, 300, 'divida intacta');
    assert.strictEqual(h.state.payments.length, 0, 'e sem linha de pagamento');
  });

  it('recusa pagar mais do que se deve', async () => {
    const h = makeHarness();
    const divida = await abrir(h);
    const result = await debts.pay({
      debtId: divida.debtId, amount: 400, idempotencyKey: 'pag-0004'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'amount_exceeds_remaining', remaining: 300 });
    assert.strictEqual(h.state.gold[DEVEDOR], 500);
  });

  it('reenviar o MESMO pagamento nao cobra duas vezes', async () => {
    const h = makeHarness();
    const divida = await abrir(h);
    const chave = 'pag-mesmo-01';
    await debts.pay({ debtId: divida.debtId, amount: 100, idempotencyKey: chave }, h.dependencies);
    const repetido = await debts.pay({ debtId: divida.debtId, amount: 100, idempotencyKey: chave }, h.dependencies);

    assert.strictEqual(repetido.ok, true);
    assert.strictEqual(repetido.replayed, true);
    assert.strictEqual(h.state.gold[DEVEDOR], 400, 'cobrado uma vez so');
    assert.strictEqual(h.state.debts.get(divida.debtId).remaining, 200);
  });

  it('nao paga divida ja quitada', async () => {
    const h = makeHarness();
    const divida = await abrir(h);
    await debts.pay({ debtId: divida.debtId, amount: 300, idempotencyKey: 'pag-0005' }, h.dependencies);
    const result = await debts.pay({ debtId: divida.debtId, amount: 10, idempotencyKey: 'pag-0006' }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'debt_closed', status: 'paid' });
  });
});

describe('debt — perdao', () => {
  it('zera sem mover septim', async () => {
    const h = makeHarness();
    const divida = await abrir(h);
    const result = await debts.forgive({
      debtId: divida.debtId, actorCharacterId: CREDOR, idempotencyKey: 'perdao-0001'
    }, h.dependencies);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.remaining, 0);
    assert.strictEqual(result.status, 'forgiven');
    assert.strictEqual(h.state.gold[DEVEDOR], 500, 'perdao nao cobra nada');
    assert.strictEqual(h.state.gold[CREDOR], 0, 'e ninguem recebe');
    assert.strictEqual(h.state.payments[0].kind, 'forgiveness');
    assert.strictEqual(h.state.payments[0].transferId, null,
      'perdao nao tem transferencia — e o que distingue dele de pagamento no historico');
  });

  it('perdao parcial deixa a divida viva', async () => {
    const h = makeHarness();
    const divida = await abrir(h);
    const result = await debts.forgive({
      debtId: divida.debtId, amount: 100, actorCharacterId: CREDOR, idempotencyKey: 'perdao-0002'
    }, h.dependencies);
    assert.strictEqual(result.remaining, 200);
    assert.strictEqual(h.state.debts.get(divida.debtId).status, 'active');
  });
});

describe('debt — inadimplencia e rotulo', () => {
  it('marcar defaulted nao move nada e nao bloqueia pagamento', async () => {
    const h = makeHarness();
    const divida = await abrir(h);
    const marcada = await debts.markDefaulted({ debtId: divida.debtId }, h.dependencies);

    assert.strictEqual(marcada.ok, true);
    assert.strictEqual(h.state.gold[DEVEDOR], 500, 'inadimplencia NAO confisca');
    assert.strictEqual(h.state.transferencias.length, 0);

    // E o devedor ainda pode quitar — `defaulted` é rótulo, não porta fechada.
    const pago = await debts.pay({
      debtId: divida.debtId, amount: 300, idempotencyKey: 'pag-apos-default'
    }, h.dependencies);
    assert.strictEqual(pago.ok, true);
    assert.strictEqual(h.state.debts.get(divida.debtId).status, 'paid');
  });
});

describe('debt — falha de infraestrutura', () => {
  it('lanca e da rollback em vez de devolver {ok:false}', async () => {
    const h = makeHarness({ failOn: 'INSERT INTO debt_payments' });
    const divida = await abrir(h);
    await assert.rejects(
      debts.pay({ debtId: divida.debtId, amount: 100, idempotencyKey: 'pag-infra' }, h.dependencies),
      /banco caiu/
    );
    assert.strictEqual(h.state.rolledBack, true);
  });
});

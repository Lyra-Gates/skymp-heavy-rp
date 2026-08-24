/**
 * contracts-service.test.js
 *
 * O que estes testes travam:
 *
 *   1. **Escrow no post.** Sem saldo, não sobra contrato — nunca um contrato
 *      publicado que ninguém pode pagar.
 *   2. **Expiração não toca trabalho entregue.** É o exploit óbvio (deixar
 *      vencer depois de receber) e a defesa é uma lista de estados, não um
 *      comentário.
 *   3. **Ninguém recebe duas vezes.** Acerto repetido é replay, acerto de
 *      contrato já fechado é recusa.
 *   4. **Autor certo em cada transição.** O criador não aceita o próprio
 *      contrato; o trabalhador não se paga.
 *   5. **`disputed` não move dinheiro.**
 *
 * Executa com: node --test contracts-service.test.js
 *
 * `contracts-service.js` faz `require('./commands')` para os comandos de chat
 * (`commandDefs()`), mesmo módulo pesado que jobs-service.test.js/
 * trade-service.test.js/crafting-service.test.js já interceptam via
 * `Module._load` — sem isso este arquivo carregaria a cadeia real
 * (identity-service, rp-chat-service, command-registry, inventory-service)
 * só para testar as funções puras abaixo, que nunca chamam `commandDefs()`.
 */

const assert = require('assert');
const { describe, it } = require('node:test');

const Module = require('module');
const commandsMock = {
  getActiveCharacterData: () => null,
  sendNotification: () => {}
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './commands' || request.endsWith('/commands')) return commandsMock;
  return originalLoad.apply(this, arguments);
};

const contracts = require('./contracts-service');
Module._load = originalLoad;

const CRIADOR = 11;
const TRABALHADOR = 22;
const OUTRO = 33;

// ─────────────────────────────────────────────────────────────────────────────
// Harness: banco em memória com o pouco de SQL que o serviço usa
// ─────────────────────────────────────────────────────────────────────────────

function makeHarness(options = {}) {
  const state = {
    contracts: new Map(),
    events: [],
    escrows: new Map(),
    gold: { [CRIADOR]: 1000, [TRABALHADOR]: 0, [OUTRO]: 0, ...(options.gold || {}) },
    nextContractId: 1,
    transacoes: []
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
      if (/FROM contracts WHERE id = \? FOR UPDATE/i.test(sql)) {
        const found = state.contracts.get(params[0]);
        return [found ? [{ ...found }] : []];
      }
      if (/FROM contract_events WHERE idempotency_key = \? FOR UPDATE/i.test(sql)) {
        const found = state.events.find(e => e.idempotencyKey === params[0]);
        return [found ? [{ contract_id: found.contractId, from_status: found.from, to_status: found.to }] : []];
      }
      if (/INSERT INTO contracts/i.test(sql)) {
        const id = state.nextContractId++;
        state.contracts.set(id, {
          id, creator_character_id: params[0], accepted_by_character_id: null,
          title: params[1], description: params[2], category: params[3],
          reward: params[4], escrow_id: params[5], status: params[6],
          expires_at: params[7], review_until: null, closed_at: null
        });
        return [{ insertId: id }];
      }
      if (/INSERT INTO contract_events/i.test(sql)) {
        if (params[5] && state.events.some(e => e.idempotencyKey === params[5])) {
          const err = new Error('Duplicate entry'); err.code = 'ER_DUP_ENTRY'; throw err;
        }
        state.events.push({
          contractId: params[0], from: params[1], to: params[2],
          actor: params[3], reason: params[4], idempotencyKey: params[5]
        });
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE contracts SET/i.test(sql)) {
        // O último par de params é sempre (id, statusEsperado).
        const id = params[params.length - 2];
        const esperado = params[params.length - 1];
        const contrato = state.contracts.get(id);
        if (!contrato || contrato.status !== esperado) return [{ affectedRows: 0 }];
        contrato.status = params[0];
        // As colunas do patch vêm na ordem em que o serviço as montou; o mock
        // não precisa saber quais são, só que o status mudou. As duas que os
        // testes leem são preenchidas por inferência do estado alvo.
        if (params[0] === 'accepted') contrato.accepted_by_character_id = params[1];
        if (params[0] === 'delivered') { contrato.delivered_at = params[1]; contrato.review_until = params[2]; }
        if (['settled', 'cancelled', 'expired'].includes(params[0])) contrato.closed_at = params[1];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    }
  };

  // Economia falsa, com a MESMA semântica de resultado do serviço real:
  // recusa devolve {ok:false, code}, infra lança.
  const economy = {
    normalizeAmount: require('./core/economy-service').normalizeAmount,
    normalizeIdempotencyKey: require('./core/economy-service').normalizeIdempotencyKey,
    normalizeAccount: require('./core/economy-service').normalizeAccount,
    SYSTEM_TYPE: 'system',
    openEscrowInTransaction: async (_conn, request) => {
      const saldo = state.gold[request.funder.ref] || 0;
      if (saldo < request.amount) return { ok: false, code: 'insufficient_funds', balance: saldo };
      const escrowId = `escrow-${state.escrows.size + 1}`;
      state.gold[request.funder.ref] = saldo - request.amount;
      state.escrows.set(escrowId, { balance: request.amount, status: 'held', funder: request.funder.ref });
      state.transacoes.push({ tipo: 'escrow_fund', de: request.funder.ref, valor: request.amount });
      return { ok: true, replayed: false, escrowId, amount: request.amount };
    },
    closeEscrowInTransaction: async (_conn, request) => {
      const escrow = state.escrows.get(request.escrowId);
      if (!escrow) return { ok: false, code: 'escrow_not_found' };
      if (escrow.status !== 'held') return { ok: false, code: 'escrow_not_held', status: escrow.status };
      const valor = escrow.balance;
      escrow.balance = 0;
      escrow.status = String(request.beneficiary.ref) === String(escrow.funder) ? 'refunded' : 'released';
      state.gold[request.beneficiary.ref] = (state.gold[request.beneficiary.ref] || 0) + valor;
      state.transacoes.push({ tipo: 'escrow_close', para: request.beneficiary.ref, valor });
      return { ok: true, replayed: false, amount: valor, transferId: `t-${state.transacoes.length}` };
    }
  };

  return {
    state,
    dependencies: {
      db: {
        getConnection: async () => conn,
        query: async (sql, params = []) => {
          if (/FROM contracts\s+WHERE status IN/i.test(sql)) {
            const [, , limite] = params;
            return [...state.contracts.values()]
              .filter(c => ['open', 'accepted'].includes(c.status)
                && c.expires_at && new Date(c.expires_at).getTime() <= new Date(limite).getTime())
              .map(c => ({ id: c.id }));
          }
          if (/FROM contracts\s+WHERE status = \? AND review_until/i.test(sql)) {
            return [...state.contracts.values()]
              .filter(c => c.status === 'delivered'
                && c.review_until && new Date(c.review_until).getTime() <= new Date(params[1]).getTime())
              .map(c => ({ id: c.id }));
          }
          const [rows] = await conn.query(sql, params);
          return rows;
        }
      },
      economy,
      now: options.now
    }
  };
}

async function contratoAceito(h, extra = {}) {
  const criado = await contracts.create({
    creatorCharacterId: CRIADOR, title: 'Escoltar caravana', category: 'caravan',
    reward: 300, idempotencyKey: 'contrato-0001', ...extra
  }, h.dependencies);
  await contracts.accept({
    contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'aceite-0001'
  }, h.dependencies);
  return criado;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('contracts — criacao com escrow no post', () => {
  it('trava a recompensa no momento da publicacao', async () => {
    const h = makeHarness();
    const result = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Escoltar caravana',
      category: 'caravan', reward: 300, idempotencyKey: 'contrato-0001'
    }, h.dependencies);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(h.state.gold[CRIADOR], 700, 'o ouro sai na criacao, nao na entrega');
    assert.strictEqual(h.state.escrows.get(result.escrowId).balance, 300);
    assert.strictEqual(h.state.contracts.get(result.contractId).status, 'open');
    assert.deepStrictEqual(
      h.state.events.map(e => [e.from, e.to]),
      [[null, 'open']]
    );
  });

  it('sem saldo nao sobra contrato — fail-closed', async () => {
    const h = makeHarness({ gold: { [CRIADOR]: 50 } });
    const result = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Contrato caro',
      reward: 5000, idempotencyKey: 'contrato-0002'
    }, h.dependencies);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'insufficient_funds');
    assert.strictEqual(h.state.contracts.size, 0, 'nenhum contrato publicado');
    assert.strictEqual(h.state.gold[CRIADOR], 50);
  });

  it('recusa categoria fora da lista', async () => {
    const h = makeHarness();
    const result = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Servico', category: 'assassinato_de_staff',
      reward: 10, idempotencyKey: 'contrato-0003'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'invalid_category' });
  });

  it('repetir a criacao com a mesma chave nao publica dois contratos', async () => {
    const h = makeHarness();
    const primeiro = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Escoltar', reward: 100, idempotencyKey: 'contrato-0004'
    }, h.dependencies);
    const segundo = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Escoltar', reward: 100, idempotencyKey: 'contrato-0004'
    }, h.dependencies);

    assert.strictEqual(segundo.ok, true);
    assert.strictEqual(segundo.replayed, true);
    assert.strictEqual(segundo.contractId, primeiro.contractId);
    assert.strictEqual(h.state.contracts.size, 1);
    assert.strictEqual(h.state.gold[CRIADOR], 900, 'e nao trava a recompensa duas vezes');
  });
});

describe('contracts — aceite e entrega', () => {
  it('o criador nao pode aceitar o proprio contrato', async () => {
    const h = makeHarness();
    const criado = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Servico', reward: 100, idempotencyKey: 'contrato-0005'
    }, h.dependencies);
    const result = await contracts.accept({
      contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: 'aceite-x1'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'creator_cannot_accept' });
  });

  it('um segundo trabalhador nao rouba um contrato ja aceito', async () => {
    const h = makeHarness();
    const criado = await contratoAceito(h);
    const result = await contracts.accept({
      contractId: criado.contractId, actorCharacterId: OUTRO, idempotencyKey: 'aceite-x2'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'invalid_status', status: 'accepted' });
    assert.strictEqual(h.state.contracts.get(criado.contractId).accepted_by_character_id, TRABALHADOR);
  });

  it('so quem aceitou declara entrega', async () => {
    const h = makeHarness();
    const criado = await contratoAceito(h);
    const result = await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: OUTRO, idempotencyKey: 'entrega-x1'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'not_the_worker' });
  });
});

describe('contracts — acerto', () => {
  it('paga exatamente a recompensa ao trabalhador e fecha o escrow', async () => {
    const h = makeHarness();
    const criado = await contratoAceito(h);
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0001'
    }, h.dependencies);

    const result = await contracts.settle({
      contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: 'acerto-0001'
    }, h.dependencies);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.amount, 300);
    assert.strictEqual(h.state.gold[TRABALHADOR], 300);
    assert.strictEqual(h.state.gold[CRIADOR], 700, 'o criador nao paga duas vezes');
    assert.strictEqual(h.state.contracts.get(criado.contractId).status, 'settled');
    assert.strictEqual(h.state.escrows.get(criado.escrowId).status, 'released');
  });

  it('o trabalhador nao pode se pagar', async () => {
    const h = makeHarness();
    const criado = await contratoAceito(h);
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0002'
    }, h.dependencies);

    const result = await contracts.settle({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'acerto-x1'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'not_the_creator' });
    assert.strictEqual(h.state.gold[TRABALHADOR], 0);
  });

  it('acertar duas vezes com chaves diferentes e recusado', async () => {
    const h = makeHarness();
    const criado = await contratoAceito(h);
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0003'
    }, h.dependencies);
    await contracts.settle({
      contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: 'acerto-r1'
    }, h.dependencies);

    const segundo = await contracts.settle({
      contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: 'acerto-r2'
    }, h.dependencies);

    assert.deepStrictEqual(segundo, { ok: false, code: 'invalid_status', status: 'settled' });
    assert.strictEqual(h.state.gold[TRABALHADOR], 300, 'pago uma vez so');
  });

  it('reenviar o MESMO acerto devolve replay, nao erro', async () => {
    const h = makeHarness();
    const criado = await contratoAceito(h);
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0004'
    }, h.dependencies);

    const chave = 'acerto-mesmo-1';
    await contracts.settle({ contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: chave }, h.dependencies);
    const repetido = await contracts.settle({ contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: chave }, h.dependencies);

    assert.strictEqual(repetido.ok, true);
    assert.strictEqual(repetido.replayed, true);
    assert.strictEqual(h.state.gold[TRABALHADOR], 300);
  });
});

describe('contracts — cancelamento', () => {
  it('devolve o escrow ao criador enquanto aberto', async () => {
    const h = makeHarness();
    const criado = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Servico', reward: 250, idempotencyKey: 'contrato-0006'
    }, h.dependencies);

    const result = await contracts.cancel({
      contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: 'cancel-0001'
    }, h.dependencies);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(h.state.gold[CRIADOR], 1000, 'devolveu tudo');
    assert.strictEqual(h.state.escrows.get(criado.escrowId).status, 'refunded');
  });

  it('nao cancela depois de aceito — o trabalhador ja se comprometeu', async () => {
    const h = makeHarness();
    const criado = await contratoAceito(h);
    const result = await contracts.cancel({
      contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: 'cancel-x1'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'invalid_status', status: 'accepted' });
    assert.strictEqual(h.state.gold[CRIADOR], 700, 'o escrow continua travado');
  });

  it('so o criador cancela', async () => {
    const h = makeHarness();
    const criado = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Servico', reward: 250, idempotencyKey: 'contrato-0007'
    }, h.dependencies);
    const result = await contracts.cancel({
      contractId: criado.contractId, actorCharacterId: OUTRO, idempotencyKey: 'cancel-x2'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'not_the_creator' });
  });
});

describe('contracts — expiracao NUNCA toca trabalho entregue', () => {
  it('expira aberto e devolve ao criador', async () => {
    let agora = 1_000_000;
    const h = makeHarness({ now: () => agora });
    const criado = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Servico', reward: 200,
      expiresInMs: 60_000, idempotencyKey: 'contrato-0008'
    }, h.dependencies);

    agora += 120_000;
    const varrida = await contracts.sweepExpired(h.dependencies);

    assert.strictEqual(varrida.processed.length, 1);
    assert.strictEqual(h.state.contracts.get(criado.contractId).status, 'expired');
    assert.strictEqual(h.state.gold[CRIADOR], 1000);
  });

  it('NAO expira contrato ja entregue, mesmo com o prazo vencido', async () => {
    // Este é o teste que impede o exploit: receber o trabalho, deixar o relógio
    // correr e reaver o ouro. Mutação que reprova aqui: acrescentar
    // `STATUS.DELIVERED` a `EXPIRABLE`.
    let agora = 1_000_000;
    const h = makeHarness({ now: () => agora });
    const criado = await contratoAceito(h, { expiresInMs: 60_000 });
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0005'
    }, h.dependencies);

    agora += 999_999;
    const varrida = await contracts.sweepExpired(h.dependencies);

    assert.strictEqual(varrida.processed.length, 0, 'a varredura nem enxerga um contrato entregue');
    assert.strictEqual(h.state.contracts.get(criado.contractId).status, 'delivered');
    assert.strictEqual(h.state.gold[CRIADOR], 700, 'o criador NAO recupera o ouro do trabalho feito');

    const direto = await contracts.expire({
      contractId: criado.contractId, idempotencyKey: 'expira-forcada-1'
    }, h.dependencies);
    assert.deepStrictEqual(direto, { ok: false, code: 'not_expirable', status: 'delivered' });
  });

  it('nao expira antes da hora', async () => {
    let agora = 1_000_000;
    const h = makeHarness({ now: () => agora });
    const criado = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Servico', reward: 200,
      expiresInMs: 600_000, idempotencyKey: 'contrato-0009'
    }, h.dependencies);

    agora += 60_000;
    const result = await contracts.expire({
      contractId: criado.contractId, idempotencyKey: 'expira-cedo-1'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'not_yet_expired' });
  });

  it('contrato sem prazo nunca expira', async () => {
    let agora = 1_000_000;
    const h = makeHarness({ now: () => agora });
    const criado = await contracts.create({
      creatorCharacterId: CRIADOR, title: 'Servico eterno', reward: 200, idempotencyKey: 'contrato-0010'
    }, h.dependencies);
    agora += 10 ** 9;
    const result = await contracts.expire({
      contractId: criado.contractId, idempotencyKey: 'expira-sem-prazo'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'not_yet_expired' });
  });
});

describe('contracts — janela de revisao e disputa', () => {
  it('acerta sozinho depois da janela de revisao', async () => {
    let agora = 1_000_000;
    const h = makeHarness({ now: () => agora });
    const criado = await contratoAceito(h);
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0006'
    }, h.dependencies);

    agora += contracts.REVIEW_WINDOW_MS + 1;
    await contracts.sweepReviewed(h.dependencies);

    assert.strictEqual(h.state.contracts.get(criado.contractId).status, 'settled');
    assert.strictEqual(h.state.gold[TRABALHADOR], 300,
      'sem isto, um criador que some deixa o trabalhador com o ouro travado para sempre');
  });

  it('nao acerta sozinho dentro da janela', async () => {
    let agora = 1_000_000;
    const h = makeHarness({ now: () => agora });
    const criado = await contratoAceito(h);
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0007'
    }, h.dependencies);

    agora += 1000;
    await contracts.sweepReviewed(h.dependencies);
    assert.strictEqual(h.state.contracts.get(criado.contractId).status, 'delivered');
    assert.strictEqual(h.state.gold[TRABALHADOR], 0);
  });

  it('disputa trava tudo: ninguem recebe e a varredura nao decide', async () => {
    let agora = 1_000_000;
    const h = makeHarness({ now: () => agora });
    const criado = await contratoAceito(h);
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0008'
    }, h.dependencies);
    const disputa = await contracts.dispute({
      contractId: criado.contractId, actorCharacterId: CRIADOR, idempotencyKey: 'disputa-0001'
    }, h.dependencies);

    assert.strictEqual(disputa.ok, true);
    agora += contracts.REVIEW_WINDOW_MS * 10;
    await contracts.sweepReviewed(h.dependencies);
    await contracts.sweepExpired(h.dependencies);

    assert.strictEqual(h.state.contracts.get(criado.contractId).status, 'disputed');
    assert.strictEqual(h.state.escrows.get(criado.escrowId).balance, 300, 'o escrow continua travado');
    assert.strictEqual(h.state.gold[TRABALHADOR], 0);
    assert.strictEqual(h.state.gold[CRIADOR], 700);
  });

  it('so o criador disputa', async () => {
    const h = makeHarness();
    const criado = await contratoAceito(h);
    await contracts.deliver({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'entrega-0009'
    }, h.dependencies);
    const result = await contracts.dispute({
      contractId: criado.contractId, actorCharacterId: TRABALHADOR, idempotencyKey: 'disputa-x1'
    }, h.dependencies);
    assert.deepStrictEqual(result, { ok: false, code: 'not_the_creator' });
  });
});

describe('contracts — falha de infraestrutura', () => {
  it('lanca e da rollback em vez de devolver {ok:false}', async () => {
    const h = makeHarness({ failOn: 'INSERT INTO contract_events' });
    await assert.rejects(
      contracts.create({
        creatorCharacterId: CRIADOR, title: 'Servico', reward: 100, idempotencyKey: 'contrato-infra'
      }, h.dependencies),
      /banco caiu/
    );
    assert.strictEqual(h.state.rolledBack, true);
  });
});

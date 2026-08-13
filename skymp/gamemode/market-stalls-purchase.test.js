/**
 * market-stalls-purchase.test.js
 *
 * `buyItem` é o caminho de dinheiro mais movimentado do gamemode ativo — move
 * ouro de duas pessoas, cobra imposto de cidade, baixa estoque e entrega item —
 * e não tinha **nenhum** teste de comportamento. O único que existia conferia
 * que a função estava exportada.
 *
 * O que estes testes travam:
 *
 *   1. **Uma transação só.** Estoque, ouro, imposto e inventário commitam
 *      juntos. Se alguém trocar as primitivas `tx.*` pelas funções públicas do
 *      transaction-service (que abrem a própria transação), a compra vira
 *      várias transações independentes e uma falha no meio deixa o comprador
 *      sem ouro e sem item.
 *   2. **Ledger obrigatório.** Saldo que muda sem linha em `gold_transactions`
 *      é ouro sem rastro — o mesmo defeito que o `/setgold` tinha.
 *   3. **Erro interno não vai pra tela do jogador.**
 *
 * Executa com: node --test market-stalls-purchase.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');


const COMPRADOR_ACTOR = 0xff00c001;
const COMPRADOR_CHAR = 9001;
const VENDEDOR_CHAR = 9002;
const STALL_ID = 77;
const ITEM_ID = 501;
const BASE_ID = 0x1234;
const CIDADE = 'whiterun';

// Estado observável
let saldos = {};
let eventos = [];        // 'begin' | 'commit' | 'rollback'
let ledgerOuro = [];     // INSERT INTO gold_transactions
let ledgerItem = [];     // INSERT INTO inventory_transactions
let vendas = [];         // INSERT INTO market_stall_sales
let tesouro = [];        // UPDATE cities SET treasury
let notificacoes = [];
let erroForcado = null;  // injeta falha de infraestrutura
let itemDoBanco = null;

function novaConexao() {
  return {
    beginTransaction: async () => { eventos.push('begin'); },
    commit: async () => { eventos.push('commit'); },
    rollback: async () => { eventos.push('rollback'); },
    release: () => {},
    query: async (sql, params = []) => {
      if (erroForcado && new RegExp(erroForcado.quando, 'i').test(sql)) {
        throw new Error(erroForcado.mensagem);
      }

      if (/FROM market_stall_items msi[\s\S]*INNER JOIN market_stalls/i.test(sql)) {
        return [itemDoBanco ? [itemDoBanco] : []];
      }
      // `SELECT gold AS balance` é a trava canônica do `core/economy-service`
      // (ela existe para ordenar os locks); `SELECT gold` é a do
      // `transaction-service`, que aplica o delta. As duas leem a mesma linha.
      if (/SELECT gold(?: AS balance)? FROM characters WHERE id = \? FOR UPDATE/i.test(sql)) {
        const id = params[0];
        return [saldos[id] === undefined ? [] : [{ gold: saldos[id], balance: saldos[id] }]];
      }
      if (/UPDATE characters SET gold = gold \+ \?/i.test(sql)) {
        saldos[params[1]] = (saldos[params[1]] || 0) + params[0];
        return [{}];
      }
      if (/SELECT treasury AS balance FROM cities WHERE id = \? FOR UPDATE/i.test(sql)) {
        return [[{ balance: tesouro.reduce((soma, t) => soma + (t.cidade === params[0] ? t.valor : 0), 0) }]];
      }
      if (/FROM gold_transactions WHERE idempotency_key = \? FOR UPDATE/i.test(sql)) {
        return [[]];
      }
      if (/SELECT count FROM character_inventory/i.test(sql)) return [[]];
      if (/INSERT INTO character_inventory/i.test(sql)) return [{}];
      if (/FROM market_stall_sales WHERE idempotency_key = \? FOR UPDATE/i.test(sql)) {
        const sale = vendas.find(venda => venda.requestId === params[0]);
        return [sale ? [{ id: sale.id, stall_id: sale.stallId, buyer_character_id: sale.comprador, count: 1, unit_price: PRECO, tax_amount: sale.imposto }] : []];
      }
      if (/UPDATE cities SET treasury = treasury \+ \?/i.test(sql)) {
        tesouro.push({ valor: params[0], cidade: params[1] });
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO gold_transactions/i.test(sql)) {
        // Posições mudaram na migration v15: o razão de ouro passou a nomear os
        // dois lados do movimento, como o de item já fazia desde a v14.
        // (transaction_id, character_id, owner_type, owner_ref,
        //  counterparty_type, counterparty_ref, transfer_id, actor_character_id,
        //  delta, reason, module, idempotency_key)
        ledgerOuro.push({ characterId: params[1], delta: params[8], reason: params[9] });
        return [{}];
      }
      if (/INSERT INTO inventory_transactions/i.test(sql)) {
        // Posições mudaram na migration v14: o razão passou a nomear os dois
        // lados do movimento (owner_*/counterparty_*/transfer_id) entre o
        // `character_id` e o `base_id`.
        // (transaction_id, character_id, owner_type, owner_ref,
        //  counterparty_type, counterparty_ref, transfer_id,
        //  base_id, delta, reason, module, idempotency_key)
        ledgerItem.push({
          characterId: params[1], ownerType: params[2], ownerRef: params[3],
          counterpartyType: params[4], counterpartyRef: params[5],
          baseId: params[7], delta: params[8], reason: params[9]
        });
        return [{}];
      }
      if (/INSERT INTO market_stall_sales/i.test(sql)) {
        vendas.push({ id: vendas.length + 1, stallId: params[0], vendedor: params[1], comprador: params[2], imposto: params[6], requestId: params[8] });
        return [{}];
      }
      return [[]];
    }
  };
}

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database' || request === '../database') {
    return {
      init: () => {},
      query: async () => [],
      getConnection: async () => novaConexao()
    };
  }
  if (request === './commands' || request.endsWith('/commands')) {
    return {
      sendNotification: (actorId, message) => notificacoes.push({ actorId, message }),
      getActiveCharacterData: (actorId) =>
        actorId === COMPRADOR_ACTOR ? { characterId: COMPRADOR_CHAR, accountId: 1 } : null,
      getActiveActorByCharacterId: () => null,
      broadcastProximityMessage: () => {}
    };
  }
  return originalLoad.apply(this, arguments);
};

const marketStalls = require('./market-stalls-service');

after(() => {
  marketStalls.shutdownMarketStallsService();
  Module._load = originalLoad;
});

const PRECO = 100;

beforeEach(async () => {
  // O ciclo shutdown+init faz duas coisas necessárias aqui: registra
  // `stall_buy` na action-policy (sem isso `canPerform` recusa com "ação
  // desconhecida" e a compra nem chega no banco) e zera o rate limit de 2s por
  // personagem — que senão faria todo teste depois do primeiro ser engolido
  // pelo cooldown, dando falha idêntica à de uma regra de negócio.
  marketStalls.shutdownMarketStallsService();
  await marketStalls.initMarketStallsService();

  saldos = { [COMPRADOR_CHAR]: 1000, [VENDEDOR_CHAR]: 0 };
  eventos = [];
  ledgerOuro = [];
  ledgerItem = [];
  vendas = [];
  tesouro = [];
  notificacoes = [];
  erroForcado = null;
  itemDoBanco = {
    id: ITEM_ID, base_id: BASE_ID, count: 5, price: PRECO, status: 'listed',
    owner_character_id: VENDEDOR_CHAR, city_id: CIDADE, tax_rate: 0.1, stall_status: 'active'
  };
});

describe('buyItem — tudo numa transacao so', () => {
  it('abre uma transacao e commita uma vez', async () => {
    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 2);

    assert.deepEqual(
      eventos, ['begin', 'commit'],
      'estoque, ouro, imposto e inventario precisam commitar juntos — varias transacoes ' +
      'deixariam o comprador sem ouro e sem item numa falha no meio'
    );
  });

  it('debita o comprador e credita o vendedor descontando o imposto', async () => {
    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 2);

    const total = PRECO * 2;          // 200
    const imposto = Math.floor(total * 0.1); // 20

    assert.equal(saldos[COMPRADOR_CHAR], 1000 - total, 'comprador deveria pagar o total');
    assert.equal(saldos[VENDEDOR_CHAR], total - imposto, 'vendedor recebe o total menos o imposto');
    assert.deepEqual(tesouro, [{ valor: imposto, cidade: CIDADE }]);
  });

  it('registra o pagamento E o imposto no ledger', async () => {
    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 2);

    // Eram 2 linhas até 13/08/2026: comprador `-200` e vendedor `+180`. O
    // imposto de 20 entrava em `cities.treasury` com `UPDATE` solto e não
    // aparecia em lugar nenhum do ledger — Achado 2 de
    // `ECONOMY_FRAMEWORK_AUDIT.md`. Agora são quatro, e a soma fecha em zero.
    assert.equal(ledgerOuro.length, 4, 'pagamento (2 pernas) + imposto (2 pernas)');
    assert.equal(
      ledgerOuro.reduce((soma, l) => soma + l.delta, 0), 0,
      'a soma dos deltas de uma venda inteira tem que dar zero — nenhum septim entra ou sai do mundo numa compra'
    );

    const compra = ledgerOuro.find(l => l.characterId === COMPRADOR_CHAR);
    const venda = ledgerOuro.find(l => l.characterId === VENDEDOR_CHAR && l.delta > 0);
    const impostoPago = ledgerOuro.find(l => l.characterId === VENDEDOR_CHAR && l.delta < 0);
    const impostoRecebido = ledgerOuro.find(l => l.characterId === null);

    assert.equal(compra.delta, -200, 'saldo que muda sem linha no ledger e ouro sem rastro');
    assert.equal(compra.reason, 'stall_purchase');
    assert.equal(venda.delta, 200, 'o vendedor ganha o total cheio e paga o imposto separado');
    assert.equal(impostoPago.delta, -20);
    assert.ok(impostoRecebido, 'o tesouro da cidade precisa da propria linha');
    assert.equal(impostoRecebido.delta, 20);
    assert.equal(impostoRecebido.reason, 'stall_tax');
    // As duas pernas de uma transferência compartilham o `reason`, porque são o
    // mesmo evento. Antes eram `stall_purchase` e `stall_sale` — dois nomes
    // para um fato, e nada dizendo que eram o mesmo. Quem é comprador e quem é
    // vendedor agora está no sinal do delta e em `owner`/`counterparty`.
    assert.equal(venda.reason, 'stall_purchase');
  });

  it('registra o item entregue no ledger de inventario', async () => {
    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 2);

    assert.equal(ledgerItem.length, 1);
    assert.equal(ledgerItem[0].characterId, COMPRADOR_CHAR);
    assert.equal(ledgerItem[0].baseId, BASE_ID);
    assert.equal(ledgerItem[0].delta, 2);
  });

  it('grava a venda no historico do mercado', async () => {
    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 2);

    assert.equal(vendas.length, 1);
    assert.equal(vendas[0].comprador, COMPRADOR_CHAR);
    assert.equal(vendas[0].vendedor, VENDEDOR_CHAR);
    assert.equal(vendas[0].imposto, 20, 'o historico do mercado guarda o imposto alem do ledger');
  });

  it('repete o mesmo requestId sem cobrar, entregar ou registrar uma segunda vez', async () => {
    const requestId = 'stall-buy-request-0001';
    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 2, requestId);
    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 2, requestId);

    assert.deepEqual(eventos, ['begin', 'commit', 'begin', 'commit']);
    assert.equal(saldos[COMPRADOR_CHAR], 800);
    assert.equal(saldos[VENDEDOR_CHAR], 180);
    assert.equal(ledgerOuro.length, 4, 'o replay nao grava um segundo conjunto de pernas');
    assert.equal(ledgerItem.length, 1);
    assert.equal(vendas.length, 1);
    assert.ok(notificacoes.some(n => /ja havia sido confirmada/i.test(n.message)));
  });
});

describe('buyItem — recusa sem deixar rastro parcial', () => {
  it('ouro insuficiente da rollback e nao move nada', async () => {
    saldos[COMPRADOR_CHAR] = 50; // precisa de 200

    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 2);

    assert.ok(eventos.includes('rollback'), 'deveria desfazer');
    assert.ok(!eventos.includes('commit'), 'nao pode commitar compra sem pagamento');
    assert.equal(ledgerOuro.length, 0, 'ledger nao registra o que nao aconteceu');
    assert.equal(saldos[VENDEDOR_CHAR], 0, 'vendedor nao pode ser creditado');
    assert.ok(
      notificacoes.some(n => /insuficiente/i.test(n.message)),
      'o comprador precisa saber que o ouro nao bastou'
    );
  });

  it('comprar da propria barraca e recusado', async () => {
    itemDoBanco.owner_character_id = COMPRADOR_CHAR;

    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 1);

    assert.ok(eventos.includes('rollback'));
    assert.equal(ledgerOuro.length, 0);
    assert.ok(notificacoes.some(n => /propria barraca/i.test(n.message)));
  });

  it('item indisponivel (barraca suspensa) e recusado', async () => {
    itemDoBanco.stall_status = 'suspended';

    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 1);

    assert.ok(eventos.includes('rollback'));
    assert.equal(saldos[COMPRADOR_CHAR], 1000, 'saldo intocado');
  });

  it('quantidade maior que o estoque e recusada', async () => {
    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 99);

    assert.ok(eventos.includes('rollback'));
    assert.equal(ledgerOuro.length, 0);
  });
});

describe('buyItem — erro interno nao vaza pro jogador', () => {
  it('falha de SQL vira mensagem generica, com o detalhe so no log', async () => {
    erroForcado = {
      quando: 'INSERT INTO market_stall_sales',
      mensagem: "Table 'skymp_rp.market_stall_sales' doesn't exist"
    };

    await marketStalls.buyItem(COMPRADOR_ACTOR, STALL_ID, ITEM_ID, 1);

    assert.ok(eventos.includes('rollback'));
    const paraOJogador = notificacoes.map(n => n.message).join(' ');
    assert.ok(
      !/Table|skymp_rp|doesn't exist/i.test(paraOJogador),
      'nome de tabela e coluna nao podem chegar na tela de quem clicou em comprar'
    );
    assert.ok(/nao foi possivel/i.test(paraOJogador), 'ainda assim o jogador precisa saber que falhou');
  });
});

/**
 * trade-service.test.js
 *
 * A troca, exercitada pela porta que o jogador usa — `requestTrade`,
 * `acceptTrade`, `addItem`, `confirmTrade` — contra o mesmo banco em memória do
 * `core/inventory.test.js`.
 *
 * ─── O que estes testes existem para pegar ──────────────────────────────────
 *
 * Troca player-to-player é uma superfície de exploit conhecida, e o
 * `PARKED_SERVICES_DECISION.md` §6 já listava as perguntas antes de qualquer
 * linha ter sido escrita: quem confirma primeiro, o que acontece se um
 * desconecta no meio, o que acontece se a oferta muda depois da confirmação.
 *
 * Cada uma dessas virou um caso aqui. O caso do §10 do pedido — *"mudança em
 * qualquer oferta invalida confirmação anterior"* — é o mais importante do
 * arquivo: sem ele existe o golpe de trocar a oferta entre a confirmação do
 * outro e a sua.
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');

// ─────────────────────────────────────────────────────────────────────────────
// Banco em memória (mesmo roteador do core/inventory.test.js)
// ─────────────────────────────────────────────────────────────────────────────

let estoque = {};
let ledger = [];
let notificacoes = [];
let personagens = {};   // actorId -> { characterId, ... }

function chave(dono, baseId) { return `character_inventory:${dono}:${baseId}`; }

function responder(sql, params = []) {
  if (/SELECT transfer_id FROM inventory_transactions WHERE idempotency_key/i.test(sql)) {
    const achado = ledger.find(l => l.idempotencyKey === params[0]);
    return achado ? [{ transfer_id: achado.transferId }] : [];
  }
  if (/SELECT base_id, count FROM character_inventory/i.test(sql)) {
    const prefixo = `character_inventory:${params[0]}:`;
    return Object.entries(estoque)
      .filter(([k]) => k.startsWith(prefixo))
      .map(([k, count]) => ({ base_id: Number(k.slice(prefixo.length)), count }));
  }
  if (/SELECT count FROM character_inventory/i.test(sql)) {
    const atual = estoque[chave(params[0], params[1])];
    return atual === undefined ? [] : [{ count: atual }];
  }
  if (/INSERT INTO character_inventory/i.test(sql)) {
    estoque[chave(params[0], params[1])] = params[2];
    return [{}];
  }
  if (/UPDATE character_inventory SET count = count \+ \?/i.test(sql)) {
    estoque[chave(params[1], params[2])] += params[0];
    return [{}];
  }
  if (/UPDATE character_inventory SET count = \?/i.test(sql)) {
    estoque[chave(params[1], params[2])] = params[0];
    return [{}];
  }
  if (/DELETE FROM character_inventory/i.test(sql)) {
    delete estoque[chave(params[0], params[1])];
    return [{}];
  }
  if (/INSERT INTO inventory_transactions/i.test(sql)) {
    ledger.push({
      characterId: params[1], ownerType: params[2], ownerRef: params[3],
      transferId: params[6], baseId: params[7], delta: params[8],
      reason: params[9], idempotencyKey: params[11]
    });
    return [{}];
  }
  return [];
}

function novaConexao() {
  let snapEstoque = null;
  let snapLedger = null;
  return {
    beginTransaction: async () => { snapEstoque = { ...estoque }; snapLedger = [...ledger]; },
    commit: async () => {},
    rollback: async () => {
      if (snapEstoque) estoque = snapEstoque;
      if (snapLedger) ledger = snapLedger;
    },
    release: () => {},
    query: async (sql, params = []) => [responder(sql, params)]
  };
}

const commandsMock = {
  sendNotification: (actorId, message) => notificacoes.push({ actorId, message }),
  getActiveCharacterData: (actorId) => personagens[actorId] || null,
  getCharacterData: (actorId) => personagens[actorId] || null,
  broadcastProximityMessage: () => {},
  onCharacterRemoved: () => () => {}
};

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith('/database') || request === './database' || request === '../database') {
    return {
      init: () => {},
      close: async () => {},
      query: async (sql, params = []) => responder(sql, params),
      getConnection: async () => novaConexao()
    };
  }
  if (request === './commands' || request.endsWith('/commands')) return commandsMock;
  return originalLoad.apply(this, arguments);
};

// Sem `mp`: `range-utils.assertRange` devolve `{ok: true, unverified: true}` e
// `espm.pareceItem` responde `ok`. É o que permite exercitar a troca fora do
// jogo — e é também a razão de os casos de distância abaixo mexerem em `mp`
// explicitamente em vez de confiar no padrão.
const trade = require('./trade-service');
const inventory = require('./core/inventory');
const interactionRegistry = require('./core/interaction-registry');

Module._load = originalLoad;

const A_ATOR = 0x100, A_CHAR = 1;
const B_ATOR = 0x200, B_CHAR = 2;
const ESPADA = 0x12eb7;
const POCAO = 0x3eadd;

beforeEach(() => {
  estoque = {};
  ledger = [];
  notificacoes = [];
  personagens = {
    [A_ATOR]: { characterId: A_CHAR, accountId: 10, firstName: 'A', lastName: 'Um' },
    [B_ATOR]: { characterId: B_CHAR, accountId: 20, firstName: 'B', lastName: 'Dois' }
  };
  trade.sweep();
  interactionRegistry._reset();
});

after(() => { trade.sweep(); });

function darItem(characterId, baseId, count) {
  estoque[chave(characterId, baseId)] = count;
}
function itemDe(characterId, baseId) {
  return estoque[chave(characterId, baseId)] || 0;
}
function ultimaMensagem(actorId) {
  const minhas = notificacoes.filter(n => n.actorId === actorId);
  return minhas.length ? minhas.at(-1).message : null;
}

/** Leva a sessão até `ACTIVE` com as ofertas dadas. */
async function abrirTroca({ ofertaA = [], ofertaB = [] } = {}) {
  trade.requestTrade(A_ATOR, B_ATOR);
  trade.acceptTrade(B_ATOR);
  for (const [baseId, qtd] of ofertaA) await trade.addItem(A_ATOR, baseId, qtd);
  for (const [baseId, qtd] of ofertaB) await trade.addItem(B_ATOR, baseId, qtd);
  return trade._sessionOf(A_ATOR);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('convite', () => {
  it('cria a sessao em REQUESTED e indexa os dois lados', () => {
    assert.strictEqual(trade.requestTrade(A_ATOR, B_ATOR), true);
    const s = trade._sessionOf(A_ATOR);
    assert.strictEqual(s.state, trade.STATES.REQUESTED);
    assert.strictEqual(trade._sessionOf(B_ATOR), s, 'os dois lados veem a mesma sessao');
  });

  it('recusa alvo que nao existe, alvo igual a si mesmo e alvo invalido', () => {
    assert.strictEqual(trade.requestTrade(A_ATOR, 0x999), false);
    assert.strictEqual(trade.requestTrade(A_ATOR, A_ATOR), false);
    assert.strictEqual(trade.requestTrade(A_ATOR, -1), false);
  });

  it('recusa quem ja esta numa troca, dos dois lados', () => {
    trade.requestTrade(A_ATOR, B_ATOR);
    personagens[0x300] = { characterId: 3, accountId: 30, firstName: 'C', lastName: 'Tres' };

    assert.strictEqual(trade.requestTrade(A_ATOR, 0x300), false, 'quem convidou ja esta ocupado');
    assert.strictEqual(trade.requestTrade(0x300, B_ATOR), false, 'quem foi convidado ja esta ocupado');
  });

  it('quem convidou nao aceita o proprio convite', () => {
    trade.requestTrade(A_ATOR, B_ATOR);
    assert.strictEqual(trade.acceptTrade(A_ATOR), false);
    assert.strictEqual(trade._sessionOf(A_ATOR).state, trade.STATES.REQUESTED);
  });

  it('o convite expira antes da sessao', () => {
    trade.requestTrade(A_ATOR, B_ATOR);
    const s = trade._sessionOf(A_ATOR);
    s.touchedAt = Date.now() - trade.INVITE_TTL_MS - 1;

    assert.strictEqual(trade._sessionOf(A_ATOR), null, 'convite parado morre');
    assert.strictEqual(trade._sessionOf(B_ATOR), null);
  });
});

describe('oferta', () => {
  it('recusa ofertar mais do que se tem', async () => {
    darItem(A_CHAR, ESPADA, 1);
    await abrirTroca();

    assert.strictEqual(await trade.addItem(A_ATOR, ESPADA, 3), false);
    assert.match(ultimaMensagem(A_ATOR), /tem 1/);
  });

  it('quantidade negativa remove da propria oferta, nao cria divida', async () => {
    darItem(A_CHAR, ESPADA, 5);
    await abrirTroca({ ofertaA: [[ESPADA, 3]] });

    assert.strictEqual(await trade.addItem(A_ATOR, ESPADA, -1), true);
    assert.strictEqual(trade._sessionOf(A_ATOR).a.items.get(ESPADA), 2);

    assert.strictEqual(await trade.addItem(A_ATOR, ESPADA, -9), false, 'nao da pra retirar o que nao ofertou');
    assert.strictEqual(trade._sessionOf(A_ATOR).a.items.get(ESPADA), 2);
  });

  it('recusa item fora da troca aberta', async () => {
    darItem(A_CHAR, ESPADA, 5);
    trade.requestTrade(A_ATOR, B_ATOR);   // ainda REQUESTED
    assert.strictEqual(await trade.addItem(A_ATOR, ESPADA, 1), false);
  });

  it('respeita o teto de tipos de item por lado', async () => {
    await abrirTroca();
    for (let i = 0; i < trade.MAX_ITEMS_PER_SIDE + 2; i++) darItem(A_CHAR, 1000 + i, 1);

    for (let i = 0; i < trade.MAX_ITEMS_PER_SIDE; i++) {
      assert.strictEqual(await trade.addItem(A_ATOR, 1000 + i, 1), true, `item ${i} deveria caber`);
    }
    assert.strictEqual(await trade.addItem(A_ATOR, 9999, 1), false);
  });
});

describe('confirmacao — a regra do §10', () => {
  it('mudar a oferta derruba as duas confirmacoes', async () => {
    darItem(A_CHAR, ESPADA, 1);
    darItem(B_CHAR, POCAO, 5);
    const s = await abrirTroca({ ofertaA: [[ESPADA, 1]], ofertaB: [[POCAO, 5]] });

    await trade.confirmTrade(A_ATOR);
    assert.strictEqual(s.a.confirmedVersion, s.version);

    // B mexe na oferta DEPOIS de A confirmar. Este é o golpe: sem a regra, o
    // próximo confirm de B fecharia um negócio que A nunca viu.
    await trade.addItem(B_ATOR, POCAO, -4);

    assert.strictEqual(s.a.confirmedVersion, null, 'a confirmacao de A tem que cair');
    assert.strictEqual(s.b.confirmedVersion, null);
    assert.strictEqual(itemDe(A_CHAR, ESPADA), 1, 'nada pode ter sido movido');
  });

  it('a versao sobe a cada mudanca de oferta', async () => {
    darItem(A_CHAR, ESPADA, 3);
    const s = await abrirTroca();
    const v0 = s.version;
    await trade.addItem(A_ATOR, ESPADA, 1);
    await trade.addItem(A_ATOR, ESPADA, 1);
    assert.strictEqual(s.version, v0 + 2);
  });

  it('recusa fechar troca vazia', async () => {
    await abrirTroca();
    assert.strictEqual(await trade.confirmTrade(A_ATOR), false);
  });

  it('so o segundo confirm dispara o commit', async () => {
    darItem(A_CHAR, ESPADA, 1);
    await abrirTroca({ ofertaA: [[ESPADA, 1]] });

    await trade.confirmTrade(A_ATOR);
    assert.strictEqual(itemDe(B_CHAR, ESPADA), 0, 'um confirm nao move nada');

    await trade.confirmTrade(B_ATOR);
    assert.strictEqual(itemDe(B_CHAR, ESPADA), 1);
  });
});

describe('commit', () => {
  it('move os dois lados e encerra a sessao', async () => {
    darItem(A_CHAR, ESPADA, 1);
    darItem(B_CHAR, POCAO, 5);
    await abrirTroca({ ofertaA: [[ESPADA, 1]], ofertaB: [[POCAO, 3]] });

    await trade.confirmTrade(A_ATOR);
    assert.strictEqual(await trade.confirmTrade(B_ATOR), true);

    assert.strictEqual(itemDe(A_CHAR, ESPADA), 0);
    assert.strictEqual(itemDe(B_CHAR, ESPADA), 1);
    assert.strictEqual(itemDe(A_CHAR, POCAO), 3);
    assert.strictEqual(itemDe(B_CHAR, POCAO), 2);

    assert.strictEqual(trade._sessionOf(A_ATOR), null, 'a sessao some depois de fechar');
    assert.strictEqual(trade._sessionOf(B_ATOR), null);
  });

  it('a troca conserva item: soma dos deltas por transferencia e zero', async () => {
    darItem(A_CHAR, ESPADA, 1);
    darItem(B_CHAR, POCAO, 3);
    await abrirTroca({ ofertaA: [[ESPADA, 1]], ofertaB: [[POCAO, 3]] });
    await trade.confirmTrade(A_ATOR);
    await trade.confirmTrade(B_ATOR);

    const porTransferencia = {};
    for (const l of ledger) porTransferencia[l.transferId] = (porTransferencia[l.transferId] || 0) + l.delta;
    for (const [id, soma] of Object.entries(porTransferencia)) {
      assert.strictEqual(soma, 0, `transfer ${id} nao fecha`);
    }
    assert.strictEqual(ledger.length, 4, 'duas pernas x duas pontas');
  });

  it('quem vendeu o item entre a confirmacao e o fechamento nao doa nada', async () => {
    // O caso "mesmo item vendido e trocado" do §9 do pedido. A revalidacao que
    // pega isto e o FOR UPDATE dentro da transacao — nenhuma checagem feita na
    // hora de ofertar poderia.
    darItem(A_CHAR, ESPADA, 1);
    darItem(B_CHAR, POCAO, 3);
    await abrirTroca({ ofertaA: [[ESPADA, 1]], ofertaB: [[POCAO, 3]] });

    await trade.confirmTrade(A_ATOR);
    delete estoque[chave(A_CHAR, ESPADA)];   // vendeu na barraca nesse meio-tempo

    assert.strictEqual(await trade.confirmTrade(B_ATOR), false);
    assert.strictEqual(itemDe(A_CHAR, POCAO), 0, 'B nao pode ter doado a pocao');
    assert.strictEqual(itemDe(B_CHAR, POCAO), 3);
    assert.strictEqual(trade._sessionOf(A_ATOR), null, 'a sessao e encerrada, nao deixada pendurada');
  });

  it('quem saiu no meio cancela a troca em vez de fechar sozinho', async () => {
    darItem(A_CHAR, ESPADA, 1);
    await abrirTroca({ ofertaA: [[ESPADA, 1]] });
    await trade.confirmTrade(A_ATOR);

    delete personagens[A_ATOR];  // A caiu

    assert.strictEqual(await trade.confirmTrade(B_ATOR), false);
    assert.strictEqual(itemDe(B_CHAR, ESPADA), 0);
  });

  it('trocar de personagem no mesmo ator invalida a troca', async () => {
    darItem(A_CHAR, ESPADA, 1);
    await abrirTroca({ ofertaA: [[ESPADA, 1]] });
    await trade.confirmTrade(A_ATOR);

    personagens[A_ATOR] = { characterId: 77, accountId: 10, firstName: 'A', lastName: 'Outro' };

    assert.strictEqual(await trade.confirmTrade(B_ATOR), false);
    assert.strictEqual(itemDe(77, ESPADA), 0);
  });

  it('afastar-se antes do fechamento cancela', async () => {
    darItem(A_CHAR, ESPADA, 1);
    await abrirTroca({ ofertaA: [[ESPADA, 1]] });
    await trade.confirmTrade(A_ATOR);

    // `mp` presente com posicoes distantes: agora `assertRange` mede de verdade.
    global.mp = {
      get: (actorId, prop) => prop === 'locationalData'
        ? { cellOrWorldDesc: '162e2:Skyrim.esm', pos: actorId === A_ATOR ? [0, 0, 0] : [99999, 0, 0] }
        : null,
      callPapyrusFunction: () => null,
      set: () => {},
      getDescFromId: (id) => `desc-${id}`
    };
    try {
      assert.strictEqual(await trade.confirmTrade(B_ATOR), false);
      assert.strictEqual(itemDe(B_CHAR, ESPADA), 0);
    } finally {
      delete global.mp;
    }
  });
});

describe('cancelamento, desconexao e expiracao', () => {
  it('cancelar solta os dois lados', async () => {
    await abrirTroca();
    assert.strictEqual(trade.cancelTrade(A_ATOR), true);
    assert.strictEqual(trade._sessionOf(A_ATOR), null);
    assert.strictEqual(trade._sessionOf(B_ATOR), null);
  });

  it('desconexao cancela e avisa quem ficou — sem nada a devolver', async () => {
    darItem(A_CHAR, ESPADA, 1);
    await abrirTroca({ ofertaA: [[ESPADA, 1]] });

    trade.onDisconnect(A_ATOR);

    assert.strictEqual(trade._sessionOf(B_ATOR), null);
    assert.match(ultimaMensagem(B_ATOR), /saiu/i);
    // A oferta era intencao em memoria: o item nunca esteve em custodia, entao
    // nao existe estado orfao para recuperar.
    assert.strictEqual(itemDe(A_CHAR, ESPADA), 1);
    assert.strictEqual(ledger.length, 0);
  });

  it('sessao parada expira e libera os dois para negociar de novo', async () => {
    const s = await abrirTroca();
    s.touchedAt = Date.now() - trade.SESSION_TTL_MS - 1;

    assert.strictEqual(trade._sessionOf(A_ATOR), null);
    assert.strictEqual(trade.requestTrade(A_ATOR, B_ATOR), true, 'os dois tem que voltar a ficar livres');
  });

  it('sweep encerra tudo — e o shutdown do modulo depende disso', async () => {
    await abrirTroca();
    trade.sweep();
    assert.strictEqual(trade._sessions.size, 0);
    assert.strictEqual(trade._sessionOf(A_ATOR), null);
  });
});

describe('interacao registrada', () => {
  it('some do menu de quem ja esta numa troca', async () => {
    trade.registerInteractions();
    const acao = interactionRegistry.get('trade.request');
    assert.ok(acao, 'trade.request precisa existir no registro');

    const ctx = { actorId: A_ATOR, target: { actorId: B_ATOR } };
    assert.strictEqual(await acao.canSee(ctx), true);

    trade.requestTrade(A_ATOR, B_ATOR);
    assert.strictEqual(await acao.canSee(ctx), false);
  });

  it('e TRACE: propor negocio nao enche a tabela de auditoria', () => {
    trade.registerInteractions();
    assert.strictEqual(
      interactionRegistry.get('trade.request').audit,
      interactionRegistry.AUDIT_LEVELS.TRACE
    );
  });
});

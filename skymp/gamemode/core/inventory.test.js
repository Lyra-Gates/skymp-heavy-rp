/**
 * core/inventory.test.js
 *
 * O Inventory Framework, exercitado contra um banco em memória que responde
 * SQL por expressão regular — o mesmo padrão de `parked-services-ledger.test.js`
 * e `market-stalls-purchase.test.js`.
 *
 * ─── O que estes testes afirmam, e por que nesta forma ──────────────────────
 *
 * A afirmação central não é "a função devolveu true". É **a conservação**: para
 * todo `transfer_id`, a soma dos `delta` gravados no razão é zero, e a soma dos
 * deltas de um dono bate com o que o estoque dele fez de fato.
 *
 * Isso é deliberado e vem do `conferirOuroFecha` da Fase 3: uma checagem de
 * `resultado.ok` passa em qualquer implementação que devolva `true`; a soma só
 * fecha se o item tiver mesmo saído de um lugar e entrado em outro. Se alguém
 * criar um caminho novo que move item sem gravar as duas pernas, estes testes
 * reprovam sem saber que aquele caminho existe.
 */

const { test, describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');

// ─────────────────────────────────────────────────────────────────────────────
// Banco em memória
// ─────────────────────────────────────────────────────────────────────────────

let estoque = {};        // `${tabela}:${dono}:${baseId}` -> count
let ledger = [];         // linhas de inventory_transactions
let containers = new Set();
let eventos = [];        // 'begin' | 'commit' | 'rollback'
let erroForcado = null;  // { quando: regex, mensagem }
let clienteAplicado = []; // AddItem/RemoveItem que chegaram no cliente

function chave(tabela, dono, baseId) {
  return `${tabela}:${dono}:${baseId}`;
}

function responder(sql, params = []) {
  if (erroForcado && new RegExp(erroForcado.quando, 'i').test(sql)) {
    throw new Error(erroForcado.mensagem);
  }

  // Replay: a âncora de idempotência, conferida DENTRO da transação.
  if (/SELECT transfer_id FROM inventory_transactions WHERE idempotency_key/i.test(sql)) {
    const achado = ledger.find(l => l.idempotencyKey === params[0]);
    return achado ? [{ transfer_id: achado.transferId }] : [];
  }
  if (/SELECT id FROM containers WHERE id = \?/i.test(sql)) {
    return containers.has(Number(params[0])) ? [{ id: Number(params[0]) }] : [];
  }

  for (const tabela of ['character_inventory', 'container_inventory']) {
    if (new RegExp(`SELECT count FROM ${tabela}`, 'i').test(sql)) {
      const atual = estoque[chave(tabela, params[0], params[1])];
      return atual === undefined ? [] : [{ count: atual }];
    }
    if (new RegExp(`INSERT INTO ${tabela}`, 'i').test(sql)) {
      estoque[chave(tabela, params[0], params[1])] = params[2];
      return [{}];
    }
    if (new RegExp(`UPDATE ${tabela} SET count = count \\+ \\?`, 'i').test(sql)) {
      estoque[chave(tabela, params[1], params[2])] += params[0];
      return [{}];
    }
    if (new RegExp(`UPDATE ${tabela} SET count = \\?`, 'i').test(sql)) {
      estoque[chave(tabela, params[1], params[2])] = params[0];
      return [{}];
    }
    if (new RegExp(`DELETE FROM ${tabela}`, 'i').test(sql)) {
      delete estoque[chave(tabela, params[0], params[1])];
      return [{}];
    }
  }

  if (/INSERT INTO inventory_transactions/i.test(sql)) {
    ledger.push({
      transactionId: params[0], characterId: params[1],
      ownerType: params[2], ownerRef: params[3],
      counterpartyType: params[4], counterpartyRef: params[5],
      transferId: params[6], baseId: params[7], delta: params[8],
      reason: params[9], module: params[10], idempotencyKey: params[11]
    });
    return [{}];
  }

  return [];
}

/**
 * A conexão simula a atomicidade que importa aqui: o `rollback` desfaz o que
 * este teste consegue observar (estoque e razão). Sem isso, um `exchange` que
 * falha no meio deixaria escrita parcial no mock e o teste passaria por engano
 * exatamente no caso que ele existe para pegar.
 */
function novaConexao() {
  let snapshotEstoque = null;
  let snapshotLedger = null;
  return {
    beginTransaction: async () => {
      eventos.push('begin');
      snapshotEstoque = { ...estoque };
      snapshotLedger = [...ledger];
    },
    commit: async () => { eventos.push('commit'); },
    rollback: async () => {
      eventos.push('rollback');
      if (snapshotEstoque) estoque = snapshotEstoque;
      if (snapshotLedger) ledger = snapshotLedger;
    },
    release: () => {},
    query: async (sql, params = []) => [responder(sql, params)]
  };
}

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith('/database') || request === '../database' || request === './database') {
    return {
      init: () => {},
      close: async () => {},
      query: async (sql, params = []) => responder(sql, params),
      getConnection: async () => novaConexao()
    };
  }
  return originalLoad.apply(this, arguments);
};

global.mp = {
  callPapyrusFunction: (tipo, classe, funcao, self, args = []) => {
    if (funcao === 'AddItem') clienteAplicado.push({ baseId: args[0], delta: args[1] });
    if (funcao === 'RemoveItem') clienteAplicado.push({ baseId: args[0], delta: -args[1] });
    return null;
  },
  get: () => null,
  set: () => {},
  getDescFromId: (actorId) => `desc-${actorId}`
  // Sem `lookupEspmRecordById`: `core/espm.pareceItem` responde `ok` quando não
  // sabe, e é isso que permite exercitar o framework fora do jogo.
};

const inventory = require('./inventory');
const ownerLib = require('./inventory-owner');

Module._load = originalLoad;

after(() => { delete global.mp; });

beforeEach(() => {
  estoque = {};
  ledger = [];
  containers = new Set([1, 2]);
  eventos = [];
  erroForcado = null;
  clienteAplicado = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de afirmação
// ─────────────────────────────────────────────────────────────────────────────

function darItem(characterId, baseId, count) {
  estoque[chave('character_inventory', characterId, baseId)] = count;
}
function itemDo(characterId, baseId) {
  return estoque[chave('character_inventory', characterId, baseId)] || 0;
}
function itemDoBau(containerId, baseId) {
  return estoque[chave('container_inventory', containerId, baseId)] || 0;
}

/**
 * A afirmação central: toda transferência conserva item.
 *
 * Para cada `transfer_id`, a soma dos deltas tem que ser zero. Um caminho que
 * grave só uma perna — que é o defeito que o razão tinha antes da v14 — faz
 * esta soma dar diferente de zero e reprova.
 */
function conferirConservacao() {
  const porTransferencia = {};
  for (const linha of ledger) {
    porTransferencia[linha.transferId] = (porTransferencia[linha.transferId] || 0) + linha.delta;
  }
  for (const [id, soma] of Object.entries(porTransferencia)) {
    assert.strictEqual(soma, 0, `transfer ${id}: a soma dos deltas deveria ser 0, foi ${soma}`);
  }
}

const REQ = 'req.teste.0001';

// ─────────────────────────────────────────────────────────────────────────────

describe('core/inventory-owner — vocabulário', () => {
  it('recusa tipo de dono desconhecido', () => {
    assert.throws(() => ownerLib.owner('dragao', 1), /tipo de dono desconhecido/);
  });

  it('recusa origem de sistema fora da lista fechada', () => {
    // A lista fechada é o que torna "que caminhos criam item?" respondível por
    // leitura. Um rótulo novo é decisão de economia, não string solta.
    assert.throws(() => ownerLib.system('presente_de_natal'), /origem de sistema desconhecida/);
    assert.doesNotThrow(() => ownerLib.system('craft'));
  });

  it('recusa ref vazio, negativo e longo demais', () => {
    assert.throws(() => ownerLib.character(0), /ref invalido/);
    assert.throws(() => ownerLib.character(-5), /ref invalido/);
    assert.throws(() => ownerLib.owner('container', 'x'.repeat(65)), /ref invalido/);
  });

  it('ref é sempre string, mesmo vindo número', () => {
    assert.strictEqual(ownerLib.character(42).ref, '42');
    assert.strictEqual(ownerLib.character(42).characterId, 42);
  });

  it('isSame compara tipo e ref, não identidade de objeto', () => {
    assert.ok(ownerLib.isSame(ownerLib.character(7), ownerLib.character(7, 999)));
    assert.ok(!ownerLib.isSame(ownerLib.character(7), ownerLib.container(7)));
  });
});

describe('validação de entrada (§19 do pedido)', () => {
  const casos = [
    ['quantidade negativa', { baseId: 10, quantity: -5 }, 'INVALID_QUANTITY'],
    ['quantidade zero', { baseId: 10, quantity: 0 }, 'INVALID_QUANTITY'],
    ['quantidade NaN', { baseId: 10, quantity: NaN }, 'INVALID_QUANTITY'],
    ['quantidade Infinity', { baseId: 10, quantity: Infinity }, 'INVALID_QUANTITY'],
    ['quantidade fracionária', { baseId: 10, quantity: 1.5 }, 'INVALID_QUANTITY'],
    ['quantidade acima do teto', { baseId: 10, quantity: 2_000_000 }, 'INVALID_QUANTITY'],
    ['baseId zero', { baseId: 0, quantity: 1 }, 'INVALID_ITEM'],
    ['baseId negativo', { baseId: -1, quantity: 1 }, 'INVALID_ITEM'],
    ['baseId NaN', { baseId: NaN, quantity: 1 }, 'INVALID_ITEM'],
    ['baseId string', { baseId: '0x10', quantity: 1 }, 'INVALID_ITEM'],
    ['item nulo', null, 'INVALID_ITEM']
  ];

  for (const [nome, item, codigo] of casos) {
    it(`recusa ${nome} sem tocar no banco`, async () => {
      darItem(1, 10, 100);
      const r = await inventory.transfer({
        from: inventory.character(1), to: inventory.character(2),
        items: [item], reason: 'teste', module: 'teste', requestId: REQ
      });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, codigo);
      // Nem transação foi aberta: recusa barata é recusa antes do pool.
      assert.deepStrictEqual(eventos, []);
      assert.strictEqual(ledger.length, 0);
    });
  }

  it('recusa requestId ausente, curto ou com caractere estranho', async () => {
    for (const id of [undefined, 'curto', 'com espaço aqui', 'a'.repeat(97)]) {
      const r = await inventory.transfer({
        from: inventory.character(1), to: inventory.character(2),
        items: [{ baseId: 10, quantity: 1 }], reason: 'teste', module: 'teste', requestId: id
      });
      assert.strictEqual(r.ok, false, `deveria recusar requestId ${JSON.stringify(id)}`);
      assert.strictEqual(r.code, 'INVALID_REQUEST_ID');
    }
  });

  it('recusa origem igual ao destino', async () => {
    const r = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(1),
      items: [{ baseId: 10, quantity: 1 }], reason: 'teste', module: 'teste', requestId: REQ
    });
    assert.strictEqual(r.code, 'SAME_OWNER');
  });

  it('recusa dono de tipo sem adaptador, fechado e por nome', async () => {
    const r = await inventory.transfer({
      from: inventory.character(1), to: ownerLib.owner('faction', 3),
      items: [{ baseId: 10, quantity: 1 }], reason: 'teste', module: 'teste', requestId: REQ
    });
    assert.strictEqual(r.code, 'NO_ADAPTER');
    assert.deepStrictEqual(eventos, []);
  });

  it('soma quantidades do mesmo item em vez de travar contra si mesmo', async () => {
    darItem(1, 10, 10);
    const r = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(2),
      items: [{ baseId: 10, quantity: 2 }, { baseId: 10, quantity: 3 }],
      reason: 'teste', module: 'teste', requestId: REQ
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(itemDo(1, 10), 5);
    assert.strictEqual(itemDo(2, 10), 5);
  });
});

describe('transferência entre personagens', () => {
  it('move o item, grava as duas pernas e conserva', async () => {
    darItem(1, 10, 7);

    const r = await inventory.transfer({
      from: inventory.character(1, 0x100), to: inventory.character(2, 0x200),
      items: [{ baseId: 10, quantity: 3 }], reason: 'trade', module: 'trade', requestId: REQ
    });

    assert.strictEqual(r.ok, true);
    assert.strictEqual(itemDo(1, 10), 4);
    assert.strictEqual(itemDo(2, 10), 3);
    assert.strictEqual(ledger.length, 2, 'duas pernas: a saída e a entrada');
    conferirConservacao();

    // A contraparte é o que a auditoria §2 dizia ser impossível registrar.
    const saida = ledger.find(l => l.delta < 0);
    assert.strictEqual(saida.ownerType, 'character');
    assert.strictEqual(saida.ownerRef, '1');
    assert.strictEqual(saida.counterpartyType, 'character');
    assert.strictEqual(saida.counterpartyRef, '2');
    assert.strictEqual(saida.transferId, r.transferId);
  });

  it('projeta no cliente só depois do commit, e só para quem tem ator', async () => {
    darItem(1, 10, 7);
    await inventory.transfer({
      from: inventory.character(1, 0x100), to: inventory.character(2), // 2 offline
      items: [{ baseId: 10, quantity: 3 }], reason: 'trade', module: 'trade', requestId: REQ
    });

    assert.strictEqual(eventos.at(-1), 'commit');
    assert.deepStrictEqual(clienteAplicado, [{ baseId: 10, delta: -3 }]);
  });

  it('recusa por estoque insuficiente sem mover nada', async () => {
    darItem(1, 10, 2);
    const r = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(2),
      items: [{ baseId: 10, quantity: 5 }], reason: 'trade', module: 'trade', requestId: REQ
    });

    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /insuficiente/i);
    assert.strictEqual(itemDo(1, 10), 2);
    assert.strictEqual(itemDo(2, 10), 0);
    assert.strictEqual(ledger.length, 0);
    assert.strictEqual(eventos.at(-1), 'rollback');
  });

  it('mensagem de erro de SQL não chega ao jogador', async () => {
    darItem(1, 10, 5);
    erroForcado = { quando: 'INSERT INTO inventory_transactions', mensagem: "Unknown column 'foo' in 'field list'" };

    const r = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(2),
      items: [{ baseId: 10, quantity: 1 }], reason: 'trade', module: 'trade', requestId: REQ
    });

    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'DB');
    assert.ok(!/Unknown column/.test(r.reason), 'nome de coluna não pode vazar para a tela');
  });
});

describe('containers', () => {
  it('depósito e retirada usam a mesma API e conservam', async () => {
    darItem(1, 10, 5);

    await inventory.transfer({
      from: inventory.character(1, 0x100), to: inventory.container(1),
      items: [{ baseId: 10, quantity: 5 }], reason: 'container_deposit', module: 'housing', requestId: 'dep.00000001'
    });
    assert.strictEqual(itemDo(1, 10), 0);
    assert.strictEqual(itemDoBau(1, 10), 5);

    await inventory.transfer({
      from: inventory.container(1), to: inventory.character(1, 0x100),
      items: [{ baseId: 10, quantity: 2 }], reason: 'container_withdraw', module: 'housing', requestId: 'ret.00000001'
    });
    assert.strictEqual(itemDo(1, 10), 2);
    assert.strictEqual(itemDoBau(1, 10), 3);
    conferirConservacao();
  });

  it('recusa container que não existe, dentro da transação', async () => {
    darItem(1, 10, 5);
    const r = await inventory.transfer({
      from: inventory.character(1), to: inventory.container(999),
      items: [{ baseId: 10, quantity: 1 }], reason: 'container_deposit', module: 'housing', requestId: REQ
    });

    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'OWNER_NOT_FOUND');
    assert.strictEqual(itemDo(1, 10), 5, 'nada pode sair quando o destino não existe');
    assert.strictEqual(eventos.at(-1), 'rollback');
  });
});

describe('criação e destruição (dono system)', () => {
  it('mint cria item e deixa rastro do lado do nada', async () => {
    const r = await inventory.mint({
      to: inventory.character(1, 0x100), items: [{ baseId: 10, quantity: 4 }],
      source: inventory.SYSTEM_SOURCES.GATHER, reason: 'woodcutting', module: 'jobs', requestId: REQ
    });

    assert.strictEqual(r.ok, true);
    assert.strictEqual(itemDo(1, 10), 4);
    assert.strictEqual(ledger.length, 2);
    conferirConservacao();

    const doNada = ledger.find(l => l.ownerType === 'system');
    assert.strictEqual(doNada.ownerRef, 'gather');
    assert.strictEqual(doNada.delta, -4, 'o nada "perde" o que o mundo entrega');
  });

  it('burn destrói item e também conserva', async () => {
    darItem(1, 10, 4);
    await inventory.burn({
      from: inventory.character(1, 0x100), items: [{ baseId: 10, quantity: 4 }],
      source: inventory.SYSTEM_SOURCES.DESTROY, reason: 'contraband', module: 'governance', requestId: REQ
    });
    assert.strictEqual(itemDo(1, 10), 0);
    conferirConservacao();
  });
});

describe('idempotência (§9 do pedido)', () => {
  it('duplo clique: a segunda chamada devolve o resultado da primeira', async () => {
    darItem(1, 10, 5);

    const primeira = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(2),
      items: [{ baseId: 10, quantity: 2 }], reason: 'trade', module: 'trade', requestId: REQ
    });
    const segunda = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(2),
      items: [{ baseId: 10, quantity: 2 }], reason: 'trade', module: 'trade', requestId: REQ
    });

    assert.strictEqual(primeira.duplicate, false);
    assert.strictEqual(segunda.duplicate, true);
    assert.strictEqual(segunda.transferId, primeira.transferId);
    assert.strictEqual(itemDo(1, 10), 3, 'o item só pode ter saído uma vez');
    assert.strictEqual(itemDo(2, 10), 2);
    assert.strictEqual(ledger.length, 2);
  });

  it('requestIds diferentes são pedidos diferentes', async () => {
    darItem(1, 10, 5);
    for (const id of ['req.aaaa0001', 'req.aaaa0002']) {
      await inventory.transfer({
        from: inventory.character(1), to: inventory.character(2),
        items: [{ baseId: 10, quantity: 2 }], reason: 'trade', module: 'trade', requestId: id
      });
    }
    assert.strictEqual(itemDo(2, 10), 4);
  });

  it('recusa não consome o requestId — o retry corrigido funciona', async () => {
    // Mesma regra do §7 do Interaction Framework, uma camada abaixo: um pedido
    // que foi recusado não pode queimar a chave, senão a correção é recusada
    // como duplicata.
    darItem(1, 10, 1);

    const recusada = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(2),
      items: [{ baseId: 10, quantity: 9 }], reason: 'trade', module: 'trade', requestId: REQ
    });
    assert.strictEqual(recusada.ok, false);

    const corrigida = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(2),
      items: [{ baseId: 10, quantity: 1 }], reason: 'trade', module: 'trade', requestId: REQ
    });
    assert.strictEqual(corrigida.ok, true);
    assert.strictEqual(corrigida.duplicate, false);
  });
});

describe('exchange: várias pernas numa transação', () => {
  it('troca cruzada move os dois lados ou nenhum', async () => {
    darItem(1, 10, 3);
    darItem(2, 20, 5);

    const r = await inventory.exchange({
      legs: [
        { from: inventory.character(1, 0x100), to: inventory.character(2, 0x200), items: [{ baseId: 10, quantity: 3 }] },
        { from: inventory.character(2, 0x200), to: inventory.character(1, 0x100), items: [{ baseId: 20, quantity: 5 }] }
      ],
      reason: 'trade', module: 'trade', requestId: REQ
    });

    assert.strictEqual(r.ok, true);
    assert.strictEqual(itemDo(1, 10), 0);
    assert.strictEqual(itemDo(2, 10), 3);
    assert.strictEqual(itemDo(1, 20), 5);
    assert.strictEqual(itemDo(2, 20), 0);
    assert.strictEqual(ledger.length, 4);
    conferirConservacao();
  });

  it('a segunda perna falhando desfaz a primeira', async () => {
    // É o defeito que motivou o arquivo inteiro, na sua forma mais direta: se
    // isto passasse, a troca seria doação.
    darItem(1, 10, 3);
    darItem(2, 20, 1);   // não tem os 5 que oferece

    const r = await inventory.exchange({
      legs: [
        { from: inventory.character(1), to: inventory.character(2), items: [{ baseId: 10, quantity: 3 }] },
        { from: inventory.character(2), to: inventory.character(1), items: [{ baseId: 20, quantity: 5 }] }
      ],
      reason: 'trade', module: 'trade', requestId: REQ
    });

    assert.strictEqual(r.ok, false);
    assert.strictEqual(itemDo(1, 10), 3, 'o lado que tinha o item não pode ter doado');
    assert.strictEqual(itemDo(2, 10), 0);
    assert.strictEqual(ledger.length, 0);
  });

  it('craft: consumo e resultado commitam juntos', async () => {
    darItem(1, 10, 2);
    darItem(1, 11, 1);

    const r = await inventory.exchange({
      legs: [
        {
          from: inventory.character(1, 0x100), to: inventory.system('consume'),
          items: [{ baseId: 10, quantity: 2 }, { baseId: 11, quantity: 1 }]
        },
        {
          from: inventory.system('craft'), to: inventory.character(1, 0x100),
          items: [{ baseId: 99, quantity: 1 }]
        }
      ],
      reason: 'craft', module: 'crafting', requestId: REQ
    });

    assert.strictEqual(r.ok, true);
    assert.strictEqual(itemDo(1, 10), 0);
    assert.strictEqual(itemDo(1, 11), 0);
    assert.strictEqual(itemDo(1, 99), 1);
    conferirConservacao();
  });

  it('craft sem ingrediente não entrega o resultado', async () => {
    darItem(1, 10, 1); // precisa de 2

    const r = await inventory.exchange({
      legs: [
        { from: inventory.character(1), to: inventory.system('consume'), items: [{ baseId: 10, quantity: 2 }] },
        { from: inventory.system('craft'), to: inventory.character(1), items: [{ baseId: 99, quantity: 1 }] }
      ],
      reason: 'craft', module: 'crafting', requestId: REQ
    });

    assert.strictEqual(r.ok, false);
    assert.strictEqual(itemDo(1, 99), 0, 'item do nada é a pior falha possível aqui');
    assert.strictEqual(itemDo(1, 10), 1);
  });

  it('o mesmo item nos dois lados vira um delta por dono', async () => {
    // A troca "3 poções minhas pelas suas 5 poções" existe e é boba, mas é ela
    // que quebraria uma implementação ingênua: dois locks para a mesma linha
    // dentro da mesma transação.
    darItem(1, 10, 3);
    darItem(2, 10, 5);

    const r = await inventory.exchange({
      legs: [
        { from: inventory.character(1), to: inventory.character(2), items: [{ baseId: 10, quantity: 3 }] },
        { from: inventory.character(2), to: inventory.character(1), items: [{ baseId: 10, quantity: 5 }] }
      ],
      reason: 'trade', module: 'trade', requestId: REQ
    });

    assert.strictEqual(r.ok, true);
    assert.strictEqual(itemDo(1, 10), 5);
    assert.strictEqual(itemDo(2, 10), 3);
    // Quatro linhas de razão (as duas ofertas, dos dois lados) para dois
    // deltas de estoque: o razão conta o que foi combinado, não o que o banco
    // fez de atalho.
    assert.strictEqual(ledger.length, 4);
    conferirConservacao();
  });

  it('recusa mais pernas ou mais itens que o teto', async () => {
    const muitas = Array.from({ length: inventory.MAX_LEGS + 1 }, () => ({
      from: inventory.character(1), to: inventory.character(2), items: [{ baseId: 10, quantity: 1 }]
    }));
    const r = await inventory.exchange({ legs: muitas, reason: 'trade', module: 'trade', requestId: REQ });
    assert.strictEqual(r.code, 'TOO_MANY');

    const muitosItens = Array.from({ length: inventory.MAX_ITEMS_PER_TRANSFER + 1 }, (_, i) => ({
      baseId: 100 + i, quantity: 1
    }));
    const r2 = await inventory.transfer({
      from: inventory.character(1), to: inventory.character(2),
      items: muitosItens, reason: 'trade', module: 'trade', requestId: REQ
    });
    assert.strictEqual(r2.code, 'TOO_MANY');
  });
});

describe('a primitiva de pilha valida o que o wrapper validava (auditoria §6)', () => {
  const transactionService = require('./transaction-service');
  const conexaoFalsa = { query: async () => [[]] };

  for (const [nome, delta] of [['NaN', NaN], ['zero', 0], ['Infinity', Infinity], ['fracionário', 1.5]]) {
    it(`recusa delta ${nome}`, async () => {
      await assert.rejects(
        () => transactionService.tx.applyStackDelta(conexaoFalsa, 'character_inventory', 1, 10, delta),
        /delta invalido/
      );
    });
  }

  it('recusa baseId não numérico sem estourar no caminho de erro', async () => {
    // O caminho antigo fazia `baseId.toString(16)` dentro do `catch` e virava
    // um TypeError que escondia a causa real.
    await assert.rejects(
      () => transactionService.tx.applyStackDelta(conexaoFalsa, 'character_inventory', 1, 'abc', -1),
      /baseId invalido/
    );
  });

  it('recusa tabela fora da lista fechada', async () => {
    await assert.rejects(
      () => transactionService.tx.applyStackDelta(conexaoFalsa, 'characters; DROP TABLE x', 1, 10, 1),
      /tabela de pilha desconhecida/
    );
  });

  it('recusa estouro de pilha em vez de saturar em silêncio', async () => {
    darItem(1, 10, transactionService.tx.MAX_STACK_COUNT - 1);
    const r = await inventory.mint({
      to: inventory.character(1), items: [{ baseId: 10, quantity: 1000 }],
      source: 'staff', reason: 'admin_give', module: 'admin', requestId: REQ
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /Pilha cheia/);
  });
});

describe('extrato', () => {
  it('history responde "de onde veio" para qualquer dono', async () => {
    darItem(1, 10, 5);
    await inventory.transfer({
      from: inventory.character(1), to: inventory.container(1),
      items: [{ baseId: 10, quantity: 5 }], reason: 'container_deposit', module: 'housing', requestId: REQ
    });

    const doBau = ledger.filter(l => l.ownerType === 'container' && l.ownerRef === '1');
    assert.strictEqual(doBau.length, 1);
    assert.strictEqual(doBau[0].counterpartyType, 'character');
    assert.strictEqual(doBau[0].counterpartyRef, '1');
    assert.strictEqual(doBau[0].characterId, null, 'dono não-personagem não preenche character_id');
  });
});

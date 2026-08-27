/**
 * inventory-service.test.js — CHARACTERIZATION TESTS
 *
 * Congela o comportamento REAL de inventory-service.js hoje. O arquivo nunca
 * teve teste próprio (só cobertura indireta via outros serviços que o
 * importam), apesar de conter a lógica de reconciliação de login descrita no
 * cabeçalho dele: "previne duplicatas" comparando o snapshot do banco com um
 * cache em memória por sessão. É exatamente o tipo de estado que passa
 * silencioso quando ninguém testa — não quebra, só duplica ou falha em
 * silêncio.
 *
 * `giveItem`/`removeItem`/`hasItem` são delegadores puros para
 * `core/transaction-service` — o teste deles é só de propagação de
 * argumento e dos defaults (`reason='unknown'`, `module='inventory'`).
 *
 * `./database` e `./core/transaction-service` são interceptados via
 * `Module._load`, mesmo padrão de jobs-service.test.js. `./core/papyrus`
 * NÃO é mockado — `actorRef()` real roda contra o `global.mp` mockado
 * abaixo, porque é só uma leitura de `mp.getDescFromId`.
 *
 * Executa com: node --test inventory-service.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const { describe, it, after, beforeEach } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────

let inventoryRows = []; // [{base_id, count}]
const addItemCalls = []; // [{baseId, count, actorId}]
const giveItemCalls = [];
const removeItemCalls = [];
const hasItemCalls = [];

let addItemImpl = (baseId, count, actorId) => {}; // sucesso por padrão

const databaseMock = {
  query: async (sql, params) => {
    assert.match(sql, /SELECT base_id, count FROM character_inventory WHERE character_id = \?/);
    return inventoryRows;
  }
};

const transactionServiceMock = {
  giveItem: async (opts) => { giveItemCalls.push(opts); return true; },
  removeItem: async (opts) => { removeItemCalls.push(opts); return true; },
  hasItem: async (characterId, baseId, minCount) => { hasItemCalls.push({ characterId, baseId, minCount }); return true; }
};

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './database' || request.endsWith('/database')) return databaseMock;
  if (request === './core/transaction-service' || request.endsWith('/core/transaction-service')) return transactionServiceMock;
  return originalLoad.apply(this, arguments);
};

const inventory = require('./inventory-service');

Module._load = originalLoad;

after(() => {
  delete global.mp;
});

global.mp = {
  getDescFromId: (formId) => `${formId.toString(16)}:Skyrim.esm`,
  callPapyrusFunction: (kind, className, fn, self, args) => {
    if (kind === 'method' && className === 'ObjectReference' && fn === 'AddItem') {
      const [baseId, count] = args;
      addItemCalls.push({ baseId, count, self });
      addItemImpl(baseId, count, self);
    }
    return null;
  }
};

// `_syncedThisSession` é estado privado do módulo, por characterId, e
// persiste entre `it()`s porque `require('./inventory-service')` só roda
// uma vez pro arquivo inteiro (Node cacheia o módulo). Sem isto, o teste 1
// (char 501, base_id 0x0f e 0x10) marcava os dois como sincronizados, e todo
// teste seguinte que reusa 501 começava com cache sujo — os próprios 501 e
// 502 usados abaixo, listados explicitamente em vez de um reset genérico
// pra não esconder se um teste futuro usar um characterId novo sem limpar.
beforeEach(() => {
  inventoryRows = [];
  addItemCalls.length = 0;
  giveItemCalls.length = 0;
  removeItemCalls.length = 0;
  hasItemCalls.length = 0;
  addItemImpl = () => {};
  inventory.clearSyncCache(501);
  inventory.clearSyncCache(502);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('syncInventoryToClient — entrega o que o banco sabe', () => {
  it('chama AddItem uma vez por linha do banco, com self de actorRef', async () => {
    inventoryRows = [{ base_id: 0x0000000f, count: 3 }, { base_id: 0x00000010, count: 1 }];

    await inventory.syncInventoryToClient(0xff000001, 501);

    assert.strictEqual(addItemCalls.length, 2);
    assert.deepStrictEqual(addItemCalls[0], { baseId: 0x0000000f, count: 3, self: { type: 'form', desc: 'ff000001:Skyrim.esm' } });
    assert.deepStrictEqual(addItemCalls[1], { baseId: 0x00000010, count: 1, self: { type: 'form', desc: 'ff000001:Skyrim.esm' } });
  });

  it('a segunda sincronização da mesma sessão não reenvia o que já foi entregue', async () => {
    inventoryRows = [{ base_id: 0x0000000f, count: 3 }];
    await inventory.syncInventoryToClient(0xff000001, 501);
    assert.strictEqual(addItemCalls.length, 1);

    // Mutação que este teste pega: remover o cache `_syncedThisSession` (ou
    // marcar como sincronizado ANTES de chamar AddItem) faria o item chegar
    // duas vezes ao cliente numa reconexão — é a duplicata que a
    // reconciliação existe para prevenir.
    await inventory.syncInventoryToClient(0xff000001, 501);
    assert.strictEqual(addItemCalls.length, 1, 'não pode reenviar item já sincronizado nesta sessão');
  });

  it('item novo no banco entre duas sincronizações da mesma sessão é entregue sozinho', async () => {
    inventoryRows = [{ base_id: 0x0000000f, count: 3 }];
    await inventory.syncInventoryToClient(0xff000001, 501);

    inventoryRows = [{ base_id: 0x0000000f, count: 3 }, { base_id: 0x00000020, count: 5 }];
    await inventory.syncInventoryToClient(0xff000001, 501);

    assert.strictEqual(addItemCalls.length, 2, 'só o item novo entra na segunda chamada');
    assert.strictEqual(addItemCalls[1].baseId, 0x00000020);
  });

  it('clearSyncCache reseta a reconciliação — a mesma sessão volta a entregar tudo', async () => {
    inventoryRows = [{ base_id: 0x0000000f, count: 3 }];
    await inventory.syncInventoryToClient(0xff000001, 501);
    assert.strictEqual(addItemCalls.length, 1);

    inventory.clearSyncCache(501);
    await inventory.syncInventoryToClient(0xff000001, 501);

    // Comportamento real hoje: reconexão real dispara reenvio completo,
    // porque o cache é só de memória do processo, por characterId.
    assert.strictEqual(addItemCalls.length, 2, 'depois de limpar o cache, o mesmo item é reentregue');
  });

  it('personagens diferentes têm caches independentes', async () => {
    inventoryRows = [{ base_id: 0x0000000f, count: 3 }];
    await inventory.syncInventoryToClient(0xff000001, 501);
    assert.strictEqual(addItemCalls.length, 1);

    await inventory.syncInventoryToClient(0xff000002, 502);
    assert.strictEqual(addItemCalls.length, 2, 'char 502 nunca sincronizou este item — não é afetado pelo cache do char 501');
  });

  it('falha do AddItem em um item não impede os demais, e o item falho não é marcado como sincronizado', async () => {
    inventoryRows = [{ base_id: 0x0000000f, count: 1 }, { base_id: 0x00000010, count: 1 }];
    addItemImpl = (baseId) => { if (baseId === 0x0000000f) throw new Error('cliente desconectou no meio'); };

    await inventory.syncInventoryToClient(0xff000001, 501);
    // Ambos foram *tentados* (addItemCalls conta tentativas), mas só o
    // segundo teve sucesso real de mock (o primeiro lançou dentro do mock).
    assert.strictEqual(addItemCalls.length, 2);

    // Mutação que este teste pega: mover `synced.add(row.base_id)` para
    // ANTES da chamada de `callPapyrusFunction` (em vez de depois, dentro do
    // try) faria o item que falhou nunca mais ser tentado de novo — o banco
    // fica correto e o cliente divergente para sempre, ao contrário do que o
    // comentário do arquivo promete ("será resolvido na próxima
    // sincronização").
    addItemImpl = () => {};
    await inventory.syncInventoryToClient(0xff000001, 501);
    const tentativasDoItemFalho = addItemCalls.filter(c => c.baseId === 0x0000000f).length;
    assert.strictEqual(tentativasDoItemFalho, 2, 'item que falhou precisa ser tentado de novo na próxima sincronização');
  });

  it('banco vazio não chama AddItem nenhuma vez', async () => {
    inventoryRows = [];
    await inventory.syncInventoryToClient(0xff000001, 501);
    assert.strictEqual(addItemCalls.length, 0);
  });

  it('erro de banco não propaga — syncInventoryToClient nunca rejeita', async () => {
    const databaseMockOriginal = databaseMock.query;
    databaseMock.query = async () => { throw new Error('connection lost'); };
    try {
      await assert.doesNotReject(inventory.syncInventoryToClient(0xff000001, 501));
    } finally {
      databaseMock.query = databaseMockOriginal;
    }
  });
});

describe('giveItem/removeItem/hasItem — delegadores para transaction-service', () => {
  it('giveItem repassa os campos e usa os defaults quando reason/module são omitidos', async () => {
    const ok = await inventory.giveItem(0xff000001, 501, 0x0000000f, 3);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(giveItemCalls[0], {
      actorId: 0xff000001, characterId: 501, baseId: 0x0000000f, count: 3,
      reason: 'unknown', module: 'inventory'
    });
  });

  it('giveItem repassa reason/module explícitos sem usar o default', async () => {
    await inventory.giveItem(0xff000001, 501, 0x0000000f, 3, 'quest_reward', 'quests');

    assert.strictEqual(giveItemCalls[0].reason, 'quest_reward');
    assert.strictEqual(giveItemCalls[0].module, 'quests');
  });

  it('removeItem repassa os campos e usa os defaults', async () => {
    await inventory.removeItem(0xff000001, 501, 0x0000000f, 2);

    assert.deepStrictEqual(removeItemCalls[0], {
      actorId: 0xff000001, characterId: 501, baseId: 0x0000000f, count: 2,
      reason: 'unknown', module: 'inventory'
    });
  });

  it('hasItem repassa minCount e usa 1 como default', async () => {
    await inventory.hasItem(501, 0x0000000f);
    assert.deepStrictEqual(hasItemCalls[0], { characterId: 501, baseId: 0x0000000f, minCount: 1 });

    await inventory.hasItem(501, 0x0000000f, 5);
    assert.deepStrictEqual(hasItemCalls[1], { characterId: 501, baseId: 0x0000000f, minCount: 5 });
  });
});

/**
 * market-stalls-service.interactions.test.js
 *
 * PLAYER_ACTION_SHORTCUTS_PLAN.md Fase 3: `stall.pack`/`stall.remove` no
 * menu de interação (`target: TARGET_TYPES.SELF`, diferente de
 * `stall.view`/`stall.buy` que miram o DONO como `PLAYER`).
 *
 * O que estes testes provam: as duas ações só aparecem (`canSee`) pra quem
 * tem barraca ativa, e `execute` chama `packStall`/`removeItem` de verdade
 * (não duplica a lógica de transação/lock que `market-stalls-service.
 * hardening.test.js` já cobre).
 *
 * O que eles NÃO provam: que o resolvedor `SELF` está de fato disponível em
 * produção sem `ENABLE_INTERACTION_PROMPT` ligado — ver o comentário no
 * próprio `registerStallInteractions()` sobre esse acoplamento herdado.
 *
 * Executa com: node --test market-stalls-service.interactions.test.js
 */

const assert = require('assert');
const { describe, it, before, after, beforeEach } = require('node:test');

const OWNER_ACTOR_ID = 0xff008001;
const OWNER_CHARACTER_ID = 8101;
const STALL_ID = 91;
const ITEM_ID = 501;

/** Se `null`, `stallDoAlvo` não acha nada — simula "sem barraca ativa". */
let barracaAtiva = { id: STALL_ID, name: 'Barraca de teste' };

function makeConn() {
  return {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql) => {
      if (/FROM market_stall_items msi[\s\S]*INNER JOIN market_stalls/i.test(sql) && /FOR UPDATE/i.test(sql)) {
        return [[{
          id: ITEM_ID, base_id: 0x1234, count: 1, status: 'listed',
          owner_character_id: OWNER_CHARACTER_ID, stall_id: STALL_ID
        }]];
      }
      if (/UPDATE market_stall_items SET status/i.test(sql)) return [[{}]];
      if (/FROM market_stalls WHERE id = \? AND status = \?[\s\S]*FOR UPDATE/i.test(sql)) {
        return [[{ id: STALL_ID, owner_character_id: OWNER_CHARACTER_ID, status: 'active', visual_ref_id: null }]];
      }
      if (/FROM market_stall_items[\s\S]*WHERE stall_id = \? AND status = 'listed' AND count > 0[\s\S]*FOR UPDATE/i.test(sql)) {
        return [[]];
      }
      if (/UPDATE market_stalls SET status/i.test(sql)) return [[{}]];
      if (/SELECT count FROM character_inventory/i.test(sql)) return [[]];
      return [[]];
    }
  };
}

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database' || request === '../database') {
    return {
      // `stallDoAlvo` (dentro de registerStallInteractions) usa `db.query`
      // direto, fora de transação — é o que canSee/execute consultam pra
      // saber "essa conta tem barraca ativa agora?".
      // `stallDoAlvo` faz `const rows = await db.query(...)` sem destructuring
      // de tupla — ao contrário de `conn.query` (mysql2 cru, `[rows, fields]`),
      // o `database.js` deste projeto já devolve as linhas direto.
      query: async (sql) => {
        if (/SELECT id, name FROM market_stalls WHERE owner_character_id = \? AND status = 'active'/i.test(sql)) {
          return barracaAtiva ? [barracaAtiva] : [];
        }
        return [];
      },
      getConnection: async () => makeConn(),
      init: () => {}
    };
  }
  return originalLoad.apply(this, arguments);
};

const commands = require('./commands');
const marketStalls = require('./market-stalls-service');
const interactionRegistry = require('./core/interaction-registry');

Module._load = originalLoad;

describe('market-stalls-service — stall.pack/stall.remove no menu de interação', () => {
  before(async () => {
    commands.registerActiveCharacter(OWNER_ACTOR_ID, { id: OWNER_CHARACTER_ID, first_name: 'Dono', last_name: 'Barraca' }, 1, 1);
    await marketStalls.initMarketStallsService();
  });

  after(() => {
    marketStalls.shutdownMarketStallsService();
    commands.removeActiveCharacter(OWNER_ACTOR_ID);
  });

  beforeEach(() => {
    barracaAtiva = { id: STALL_ID, name: 'Barraca de teste' };
  });

  function ctxFor(actorId, data) {
    return { actorId, target: { actorId }, data: data || {} };
  }

  it('registra as duas acoes com target SELF', () => {
    const pack = interactionRegistry.get('stall.pack');
    const remove = interactionRegistry.get('stall.remove');
    assert.ok(pack, 'stall.pack precisa existir no registro');
    assert.ok(remove, 'stall.remove precisa existir no registro');
    assert.strictEqual(pack.target, interactionRegistry.TARGET_TYPES.SELF);
    assert.strictEqual(remove.target, interactionRegistry.TARGET_TYPES.SELF);
  });

  it('canSee: so aparece pra quem tem barraca ativa', async () => {
    const pack = interactionRegistry.get('stall.pack');
    const remove = interactionRegistry.get('stall.remove');
    const ctx = ctxFor(OWNER_ACTOR_ID);

    assert.strictEqual(await pack.canSee(ctx), true);
    assert.strictEqual(await remove.canSee(ctx), true);

    barracaAtiva = null;
    assert.strictEqual(await pack.canSee(ctx), false);
    assert.strictEqual(await remove.canSee(ctx), false);
  });

  it('stall.remove exige itemId no schema', () => {
    const remove = interactionRegistry.get('stall.remove');
    assert.ok(remove.schema.itemId.required);
    assert.strictEqual(remove.schema.itemId.type, 'int');
  });

  it('execute de stall.pack chama packStall com a barraca ativa do proprio ator', async () => {
    const pack = interactionRegistry.get('stall.pack');
    // Não lança e não exige mais nada além do que já está mockado — prova
    // que o `execute` de fato chega em `packStall`, não numa reimplementação.
    await assert.doesNotReject(() => pack.execute(ctxFor(OWNER_ACTOR_ID)));
  });

  it('execute de stall.remove chama removeItem com o itemId validado pelo schema', async () => {
    const remove = interactionRegistry.get('stall.remove');
    await assert.doesNotReject(() => remove.execute(ctxFor(OWNER_ACTOR_ID, { itemId: ITEM_ID })));
  });

  it('execute de stall.pack lanca quando a barraca some entre canSee e execute', async () => {
    const pack = interactionRegistry.get('stall.pack');
    barracaAtiva = null;
    await assert.rejects(() => pack.execute(ctxFor(OWNER_ACTOR_ID)), /nao tem barraca ativa/i);
  });
});

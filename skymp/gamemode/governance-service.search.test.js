/**
 * governance-service.search.test.js
 *
 * PLAYER_ACTION_SHORTCUTS_PLAN.md Fase 5: o pedido de revista (`requestSearch`)
 * agora dispara, além da notificação de texto que já existia, um modal de
 * escolha (`commands.sendChoice` → `browserModal` tipo `'choice'`) — e a
 * resposta por botão (`search:accept`/`search:deny`) chega de volta por
 * `governance.handleUiEvent`, chamando o MESMO `approveSearch` que
 * `/searchaccept`/`/searchdeny` já chamavam.
 *
 * Mock no mesmo padrão de `governance-service.hardening.test.js` (permissão
 * via `governance_memberships`, sem tocar MySQL de verdade).
 *
 * Executa com: node --test governance-service.search.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

let membership = { characterId: null, permission: null, onDuty: true };
const positions = new Map();

/** id crescente -> linha de guard_searches, simulando a tabela real. */
let searches = new Map();
let nextSearchId = 1;

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database') {
    return {
      query: async (sql, params = []) => {
        if (/FROM governance_memberships/i.test(sql) && /governance_role_permissions/i.test(sql)) {
          const [characterId, permission] = params;
          const requiresDuty = /on_duty\s*=\s*1/i.test(sql);
          if (
            membership.characterId === characterId &&
            membership.permission === permission &&
            (!requiresDuty || membership.onDuty)
          ) {
            return [{ role_name: 'guard', weight: 50, on_duty: membership.onDuty ? 1 : 0 }];
          }
          return [];
        }
        if (/FROM warrants/i.test(sql)) return []; // nunca forçado nestes testes
        // `database.js` já devolve o `result` do driver sem tupla — INSERT
        // resolve pro OkPacket direto (`result.insertId`), não `[rows]`. Mesmo
        // achado que `market-stalls-service.interactions.test.js` já documentou
        // pra SELECT; aqui é a mesma regra do lado do INSERT.
        if (/INSERT INTO guard_searches/i.test(sql)) {
          const [targetCharacterId, officerCharacterId, reason, forced, status] = params;
          const id = nextSearchId++;
          searches.set(id, { id, target_character_id: targetCharacterId, officer_character_id: officerCharacterId, reason, forced, status });
          return { insertId: id };
        }
        if (/FROM guard_searches\s+WHERE id = \? AND target_character_id = \? AND status = 'pending'/i.test(sql)) {
          const [id, targetCharacterId] = params;
          const row = searches.get(id);
          return (row && row.target_character_id === targetCharacterId && row.status === 'pending') ? [row] : [];
        }
        if (/UPDATE guard_searches SET status/i.test(sql)) {
          const [status, id] = params;
          const row = searches.get(id);
          if (row) row.status = status;
          return {};
        }
        if (/character_inventory/i.test(sql)) return [];
        if (/INSERT INTO audit_logs/i.test(sql)) return {};
        return [];
      },
      init: () => {}
    };
  }
  return originalLoad.apply(this, arguments);
};

const mpCalls = [];
global.mp = {
  get: (actorId, prop) => {
    if (prop !== 'locationalData' && prop !== 'pos') return null;
    const p = positions.get(actorId);
    if (!p) return null;
    return { pos: p.pos, cellOrWorldDesc: p.cell };
  },
  getDescFromId: (actorId) => `desc-${actorId}`,
  callPapyrusFunction: () => null,
  set: (actorId, propName, value) => { mpCalls.push({ actorId, propName, value }); }
};

const commands = require('./commands');
const governance = require('./governance-service');

Module._load = originalLoad;

after(() => { delete global.mp; });

const OFFICER_ACTOR_ID = 0xff000b01;
const OFFICER_CHARACTER_ID = 9101;
const TARGET_ACTOR_ID = 0xff000b02;
const TARGET_CHARACTER_ID = 9102;

function setNear() {
  positions.set(OFFICER_ACTOR_ID, { pos: [0, 0, 0], cell: 'whiterun' });
  positions.set(TARGET_ACTOR_ID, { pos: [10, 0, 0], cell: 'whiterun' });
}

/** Última mensagem `browserModal` do tipo `choice` mandada a um actorId. */
function lastChoice(actorId) {
  const calls = mpCalls.filter(c => c.actorId === actorId && c.propName === 'browserModal' && c.value.type === 'choice');
  return calls.length ? calls.at(-1).value.data : null;
}

describe('governance-service — modal de escolha da revista (Fase 5)', () => {
  beforeEach(() => {
    membership = { characterId: OFFICER_CHARACTER_ID, permission: 'guard_search', onDuty: true };
    searches = new Map();
    nextSearchId = 1;
    mpCalls.length = 0;
    setNear();
    commands.registerActiveCharacter(OFFICER_ACTOR_ID, { id: OFFICER_CHARACTER_ID, first_name: 'Guarda', last_name: 'Um' }, 1, 1);
    commands.registerActiveCharacter(TARGET_ACTOR_ID, { id: TARGET_CHARACTER_ID, first_name: 'Alvo', last_name: 'Dois' }, 2, 2);
  });

  it('requestSearch (nao forcada) manda um browserModal tipo choice pro alvo', async () => {
    await governance.requestSearch(OFFICER_ACTOR_ID, TARGET_ACTOR_ID, 'suspeita de furto');

    const choice = lastChoice(TARGET_ACTOR_ID);
    assert.ok(choice, 'deveria ter mandado um modal de escolha');
    assert.strictEqual(choice.acceptEvent, 'search:accept');
    assert.strictEqual(choice.denyEvent, 'search:deny');
    assert.strictEqual(choice.eventData.searchId, 1);
    assert.match(choice.message, /suspeita de furto/);
  });

  it('handleUiEvent search:accept chama approveSearch(true) — o mesmo caminho de /searchaccept', async () => {
    await governance.requestSearch(OFFICER_ACTOR_ID, TARGET_ACTOR_ID, 'revista de rotina');
    const { searchId } = lastChoice(TARGET_ACTOR_ID).eventData;

    const handled = await governance.handleUiEvent(TARGET_ACTOR_ID, { type: 'search:accept', data: { searchId } });
    assert.strictEqual(handled, true);
    assert.strictEqual(searches.get(searchId).status, 'approved');
  });

  it('handleUiEvent search:deny chama approveSearch(false)', async () => {
    await governance.requestSearch(OFFICER_ACTOR_ID, TARGET_ACTOR_ID, 'revista de rotina');
    const { searchId } = lastChoice(TARGET_ACTOR_ID).eventData;

    const handled = await governance.handleUiEvent(TARGET_ACTOR_ID, { type: 'search:deny', data: { searchId } });
    assert.strictEqual(handled, true);
    assert.strictEqual(searches.get(searchId).status, 'denied');
  });

  it('ignora search:accept sem searchId valido, sem lancar', async () => {
    await assert.doesNotReject(async () => {
      assert.strictEqual(await governance.handleUiEvent(TARGET_ACTOR_ID, { type: 'search:accept', data: {} }), true);
      assert.strictEqual(await governance.handleUiEvent(TARGET_ACTOR_ID, { type: 'search:accept', data: { searchId: -1 } }), true);
      assert.strictEqual(await governance.handleUiEvent(TARGET_ACTOR_ID, { type: 'search:accept' }), true);
    });
  });

  it('devolve false pra tipo de evento fora do prefixo search', async () => {
    assert.strictEqual(await governance.handleUiEvent(TARGET_ACTOR_ID, { type: 'panel:open' }), false);
    assert.strictEqual(await governance.handleUiEvent(TARGET_ACTOR_ID, null), false);
  });

  it('nao deixa alguem responder o pedido de revista de outra pessoa (approveSearch ja filtra por target_character_id)', async () => {
    await governance.requestSearch(OFFICER_ACTOR_ID, TARGET_ACTOR_ID, 'revista de rotina');
    const { searchId } = lastChoice(TARGET_ACTOR_ID).eventData;

    // OFFICER tenta responder o proprio pedido que ele mesmo abriu contra o alvo.
    await governance.handleUiEvent(OFFICER_ACTOR_ID, { type: 'search:accept', data: { searchId } });
    assert.strictEqual(searches.get(searchId).status, 'pending', 'so o alvo pode responder');
  });
});

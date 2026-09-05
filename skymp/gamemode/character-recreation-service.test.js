'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { processCharacterRecreation } = require('./character-recreation-service');

function setup(request) {
  const queries = [];
  const destroyed = [];
  const kicked = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/^SELECT id, status, target_actor_id/.test(sql.trim())) return request ? [request] : [];
      return { affectedRows: 1 };
    }
  };
  const mp = {
    destroyActor: id => destroyed.push(id),
    kick: id => kicked.push(id)
  };
  return { db, mp, queries, destroyed, kicked };
}

test('sans demande, la connexion continue sans toucher à l’acteur', async () => {
  const state = setup(null);
  const result = await processCharacterRecreation({
    ...state, userId: 3, accountId: 42, characterId: 9, actorId: 0xff000001
  });
  assert.deepEqual(result, { blockLogin: false, completed: false });
  assert.deepEqual(state.destroyed, []);
  assert.deepEqual(state.kicked, []);
});

test('une demande en attente détruit l’ancien acteur puis interrompt cette connexion', async () => {
  const state = setup({ id: 5, status: 'pending', target_actor_id: null });
  const result = await processCharacterRecreation({
    ...state, userId: 3, accountId: 42, characterId: 9, actorId: 0xff000001
  });

  assert.equal(result.blockLogin, true);
  assert.deepEqual(state.destroyed, [0xff000001]);
  assert.deepEqual(state.kicked, [3]);
  assert.ok(state.queries.some(x => /SET status = 'processing', target_actor_id/.test(x.sql)));
});

test('un nouvel actorId termine la demande sans détruire le nouvel acteur', async () => {
  const state = setup({ id: 5, status: 'processing', target_actor_id: 0xff000001 });
  const result = await processCharacterRecreation({
    ...state, userId: 3, accountId: 42, characterId: 9, actorId: 0xff000002
  });

  assert.deepEqual(result, { blockLogin: false, completed: true });
  assert.deepEqual(state.destroyed, []);
  assert.deepEqual(state.kicked, []);
  assert.ok(state.queries.some(x => /SET status = 'applied'/.test(x.sql)));
});

test('un échec destroyActor remet la demande en attente pour réessayer', async () => {
  const state = setup({ id: 5, status: 'pending', target_actor_id: null });
  state.mp.destroyActor = () => { throw new Error('native failure'); };

  await assert.rejects(
    processCharacterRecreation({
      ...state, userId: 3, accountId: 42, characterId: 9, actorId: 0xff000001
    }),
    /native failure/
  );
  assert.ok(state.queries.some(x => /SET status = 'pending', target_actor_id = NULL/.test(x.sql)));
  assert.deepEqual(state.kicked, []);
});

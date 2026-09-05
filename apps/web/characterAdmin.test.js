'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const {
  AdminActionError,
  resetWhitelistApplication,
  queueCharacterRecreation
} = require('./characterAdmin');

function fakePool(handler) {
  const log = [];
  const connection = {
    beginTransaction: async () => log.push({ action: 'begin' }),
    commit: async () => log.push({ action: 'commit' }),
    rollback: async () => log.push({ action: 'rollback' }),
    release: () => log.push({ action: 'release' }),
    execute: async (sql, params = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      log.push({ action: 'execute', sql: normalized, params });
      return [await handler(normalized, params), []];
    }
  };
  return { pool: { getConnection: async () => connection }, log };
}

describe('réinitialisation de candidature', () => {
  test('repasse la candidature et le personnage en attente dans une transaction', async () => {
    const state = fakePool((sql) => {
      if (sql.startsWith('SELECT wa.id')) {
        return [{ id: 9, account_id: 42, status: 'approved', discord_id: '123' }];
      }
      return { affectedRows: 1 };
    });

    const result = await resetWhitelistApplication({
      pool: state.pool,
      applicationId: 9,
      moderatorAccountId: 7,
      reason: 'Nouvel examen demandé'
    });

    assert.equal(result.accountId, 42);
    assert.deepEqual(state.log.filter(x => x.action !== 'execute').map(x => x.action),
      ['begin', 'commit', 'release']);
    assert.ok(state.log.some(x => /SET status = 'pending'.*reviewed_at = NULL/.test(x.sql)));
    assert.ok(state.log.some(x => /UPDATE characters SET status = 'pending'/.test(x.sql)));
    assert.ok(state.log.some(x => /VALUES \('whitelist:reset'/.test(x.sql)));
  });

  test('refuse une candidature déjà en attente et annule la transaction', async () => {
    const state = fakePool((sql) => sql.startsWith('SELECT wa.id')
      ? [{ id: 9, account_id: 42, status: 'pending' }]
      : { affectedRows: 1 });

    await assert.rejects(
      resetWhitelistApplication({ pool: state.pool, applicationId: 9, moderatorAccountId: 7 }),
      error => error instanceof AdminActionError && error.statusCode === 409
    );
    assert.deepEqual(state.log.filter(x => x.action !== 'execute').map(x => x.action),
      ['begin', 'rollback', 'release']);
  });
});

describe('recréation de personnage', () => {
  test('archive l’ancien personnage et crée une fiche vierge sans effacer l’historique', async () => {
    const state = fakePool((sql) => {
      if (sql.startsWith('SELECT c.id')) {
        return [{
          id: 12, account_id: 42, first_name: 'Alvara', last_name: 'Dawnmere',
          status: 'approved', discord_id: '123'
        }];
      }
      if (sql.startsWith('INSERT INTO characters')) return { insertId: 99, affectedRows: 1 };
      return { affectedRows: 1 };
    });

    const result = await queueCharacterRecreation({
      pool: state.pool,
      characterId: 12,
      moderatorAccountId: 7,
      reason: 'Repartir de zéro'
    });

    assert.equal(result.newCharacterId, 99);
    assert.ok(state.log.some(x => /UPDATE characters SET status = 'retired'/.test(x.sql)));
    const clone = state.log.find(x => x.action === 'execute' && x.sql.startsWith('INSERT INTO characters'));
    assert.ok(clone, 'une nouvelle fiche doit être créée');
    assert.doesNotMatch(clone.sql, /racemenu_presets|gold|pos_x|cell_id/,
      'les données de jeu de l’ancien personnage ne doivent pas être copiées');
    assert.ok(state.log.some(x => /INSERT INTO character_recreation_requests/.test(x.sql)));
    assert.ok(state.log.some(x => /VALUES \('character:recreate'/.test(x.sql)));
    assert.deepEqual(state.log.filter(x => x.action !== 'execute').map(x => x.action),
      ['begin', 'commit', 'release']);
  });

  test('refuse de recréer un personnage déjà retiré', async () => {
    const state = fakePool((sql) => sql.startsWith('SELECT c.id')
      ? [{ id: 12, account_id: 42, first_name: 'A', last_name: 'B', status: 'retired' }]
      : { affectedRows: 1 });

    await assert.rejects(
      queueCharacterRecreation({ pool: state.pool, characterId: 12, moderatorAccountId: 7 }),
      error => error instanceof AdminActionError && error.statusCode === 409
    );
    assert.ok(state.log.some(x => x.action === 'rollback'));
  });
});

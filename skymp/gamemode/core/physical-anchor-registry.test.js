/**
 * core/physical-anchor-registry.test.js
 * Executa com: node --test core/physical-anchor-registry.test.js
 */

'use strict';

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

const registry = require('./physical-anchor-registry');

describe('physical-anchor-registry', () => {
  beforeEach(() => registry._reset());

  it('recusa provider sem targetType ou sem list()', () => {
    assert.throws(() => registry.register({ list: async () => [] }));
    assert.throws(() => registry.register({ targetType: 'object' }));
  });

  it('listAll achata as ancoras de todos os providers, com o targetType de cada um', async () => {
    registry.register({ targetType: 'object', list: async () => [{ targetId: 0x111 }, { targetId: 0x222 }] });
    registry.register({ targetType: 'door', list: async () => [{ targetId: 0x333 }] });

    const todas = await registry.listAll();
    assert.deepStrictEqual(
      todas.sort((a, b) => a.targetId - b.targetId),
      [
        { targetId: 0x111, targetType: 'object' },
        { targetId: 0x222, targetType: 'object' },
        { targetId: 0x333, targetType: 'door' }
      ]
    );
  });

  it('descarta ancoras com targetId invalido, sem lancar', async () => {
    registry.register({ targetType: 'object', list: async () => [{ targetId: 0x111 }, { targetId: NaN }, null, {}] });
    const todas = await registry.listAll();
    assert.deepStrictEqual(todas, [{ targetId: 0x111, targetType: 'object' }]);
  });

  it('um provider que lanca nao derruba os outros', async () => {
    registry.register({ targetType: 'object', list: async () => { throw new Error('banco caiu'); } });
    registry.register({ targetType: 'door', list: async () => [{ targetId: 0x999 }] });

    const todas = await registry.listAll();
    assert.deepStrictEqual(todas, [{ targetId: 0x999, targetType: 'door' }]);
  });
});

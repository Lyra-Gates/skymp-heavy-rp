'use strict';

const assert = require('node:assert/strict');
const { describe, it, beforeEach } = require('node:test');
const registry = require('./public-work-registry');

const valid = (overrides = {}) => ({
  code: 'hay_delivery', label: 'Levar fardo ao celeiro',
  boardFormDesc: '100:Skyrim.esm', originFormDesc: '101:Skyrim.esm', originLabel: 'Fardos do campo',
  destinationFormDesc: '102:Skyrim.esm', destinationLabel: 'Celeiro principal',
  rewardAmount: 5, timeLimitSeconds: 900, cooldownSeconds: 600,
  cooldownGroup: 'public_delivery', cargoPolicy: 'token', ...overrides
});

describe('public-work-registry', () => {
  beforeEach(() => registry._reset());

  it('registra e devolve definição executável imutável', () => {
    const definition = registry.register(valid());
    assert.equal(registry.get('hay_delivery'), definition);
    assert.equal(Object.isFrozen(definition), true);
    assert.deepEqual(registry.listByBoard('100:Skyrim.esm'), [definition]);
  });

  it('recusa duplicata', () => {
    registry.register(valid());
    assert.throws(() => registry.register(valid()), /registrado duas vezes/);
  });

  it('recusa rota sem três FormDesc reais', () => {
    for (const field of ['boardFormDesc', 'originFormDesc', 'destinationFormDesc']) {
      assert.throws(() => registry.register(valid({ [field]: 'TODO' })), new RegExp(field));
    }
  });

  it('recusa recompensa, prazo e cooldown não positivos', () => {
    assert.throws(() => registry.register(valid({ rewardAmount: 0 })), /rewardAmount/);
    assert.throws(() => registry.register(valid({ timeLimitSeconds: -1 })), /timeLimitSeconds/);
    assert.throws(() => registry.register(valid({ cooldownSeconds: 0 })), /cooldownSeconds/);
  });

  it('recusa origem igual ao destino e política de carga desconhecida', () => {
    assert.throws(() => registry.register(valid({ destinationFormDesc: '101:Skyrim.esm' })), /mesma origem/);
    assert.throws(() => registry.register(valid({ cargoPolicy: 'client_item' })), /cargoPolicy/);
  });
});

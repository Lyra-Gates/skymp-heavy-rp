'use strict';

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const originalMp = global.mp;
global.mp = {};
const events = require('./activation-events');

beforeEach(() => events._resetForTest());
after(() => {
  events._resetForTest();
  if (originalMp === undefined) delete global.mp;
  else global.mp = originalMp;
});

describe('activation-events', () => {
  it('entrega target e caster a todos os assinantes', () => {
    const calls = [];
    events.subscribe('a', (target, caster) => calls.push(['a', target, caster]));
    events.subscribe('b', (target, caster) => calls.push(['b', target, caster]));
    assert.strictEqual(global.mp.onActivate(0x123, 0xff000001), undefined);
    assert.deepStrictEqual(calls, [
      ['a', 0x123, 0xff000001],
      ['b', 0x123, 0xff000001]
    ]);
  });

  it('agrega false sem impedir os assinantes seguintes', () => {
    const calls = [];
    events.subscribe('consumer', () => { calls.push('consumer'); return false; });
    events.subscribe('observer', () => calls.push('observer'));
    assert.strictEqual(global.mp.onActivate(1, 2), false);
    assert.deepStrictEqual(calls, ['consumer', 'observer']);
  });

  it('somente false booleano consome a ativacao', () => {
    for (const value of [undefined, null, 0, '', true]) {
      events._resetForTest();
      events.subscribe(`value-${String(value)}`, () => value);
      assert.strictEqual(global.mp.onActivate(1, 2), undefined);
    }
  });

  it('isola falha e nao bloqueia vanilla por acidente', () => {
    const calls = [];
    const realError = console.error;
    console.error = () => {};
    try {
      events.subscribe('broken', () => { throw new Error('boom'); });
      events.subscribe('healthy', () => calls.push('healthy'));
      assert.strictEqual(global.mp.onActivate(1, 2), undefined);
    } finally {
      console.error = realError;
    }
    assert.deepStrictEqual(calls, ['healthy']);
  });

  it('recusa nome, handler e duplicata invalidos', () => {
    assert.throws(() => events.subscribe('', () => {}), /nome nao-vazio/);
    assert.throws(() => events.subscribe('x', null), /exige funcao/);
    events.subscribe('same', () => {});
    assert.throws(() => events.subscribe('same', () => {}), /ja esta inscrito/);
  });

  it('falha fechado se outro modulo ja tomou mp.onActivate', () => {
    global.mp.onActivate = () => {};
    assert.throws(() => events.subscribe('late', () => {}), /handler direto/);
  });

  it('unsubscribe remove somente o assinante pedido', () => {
    const calls = [];
    events.subscribe('gone', () => calls.push('gone'));
    events.subscribe('kept', () => calls.push('kept'));
    assert.strictEqual(events.unsubscribe('gone'), true);
    global.mp.onActivate(1, 2);
    assert.deepStrictEqual(calls, ['kept']);
    assert.deepStrictEqual(events.subscriberNames(), ['kept']);
  });
});


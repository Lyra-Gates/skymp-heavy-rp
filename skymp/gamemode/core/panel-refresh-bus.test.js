/**
 * core/panel-refresh-bus.test.js
 * Executa com: node --test core/panel-refresh-bus.test.js
 */

const assert = require('assert');
const { describe, it, afterEach } = require('node:test');

const panelRefreshBus = require('./panel-refresh-bus');

describe('panel-refresh-bus', () => {
  const registered = [];
  afterEach(() => {
    for (const handler of registered.splice(0)) panelRefreshBus.offRefresh(handler);
  });

  it('notifica handlers registrados com actorId e canal', () => {
    const calls = [];
    const handler = (actorId, channel) => calls.push([actorId, channel]);
    registered.push(handler);
    panelRefreshBus.onRefresh(handler);

    panelRefreshBus.requestRefresh(123, 'governance');

    assert.deepStrictEqual(calls, [[123, 'governance']]);
  });

  it('ignora canais desconhecidos silenciosamente', () => {
    const calls = [];
    const handler = (...args) => calls.push(args);
    registered.push(handler);
    panelRefreshBus.onRefresh(handler);

    panelRefreshBus.requestRefresh(1, 'not-a-real-channel');

    assert.deepStrictEqual(calls, []);
  });

  it('offRefresh remove o handler', () => {
    const calls = [];
    const handler = (...args) => calls.push(args);
    panelRefreshBus.onRefresh(handler);
    panelRefreshBus.offRefresh(handler);

    panelRefreshBus.requestRefresh(1, 'status');

    assert.deepStrictEqual(calls, []);
  });

  it('não lança se não houver nenhum handler registrado', () => {
    assert.doesNotThrow(() => panelRefreshBus.requestRefresh(1, 'economy'));
  });
});

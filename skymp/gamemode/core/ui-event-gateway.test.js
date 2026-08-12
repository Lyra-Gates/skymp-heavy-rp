const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createUiEventGateway, installUiEventGateway } = require('./ui-event-gateway');

function setup({ valid = true, dispatch } = {}) {
  const calls = [];
  const logs = [];
  const router = {
    isValidEventEnvelope: () => valid,
    dispatch: dispatch || (async () => { calls.push('dispatch'); })
  };
  const gateway = createUiEventGateway({
    uiEventRouter: router,
    handleChatInput: (actorId, text) => calls.push(['chat', actorId, text]),
    logger: {
      log: (...args) => logs.push(['log', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args])
    }
  });
  return { gateway, calls, logs };
}

describe('ui-event-gateway', () => {
  it('recusa envelope invalido antes de rotear ou chamar chat', () => {
    const { gateway, calls, logs } = setup({ valid: false });
    assert.equal(gateway(0xff000001, null), false);
    assert.deepEqual(calls, []);
    assert.equal(logs[0][0], 'warn');
  });

  it('roteia um evento valido, preserva chat e redige seu payload nos logs', async () => {
    const { gateway, calls, logs } = setup();
    assert.equal(gateway(0xff000001, { type: 'cef::chat:send', data: 'segredo-do-jogador' }), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['dispatch', ['chat', 0xff000001, 'segredo-do-jogador']]);
    assert.ok(logs[0].join(' ').includes('type=cef::chat:send data=string'));
    assert.ok(!logs[0].join(' ').includes('segredo-do-jogador'));
  });

  it('erro assincrono do roteador e registrado sem lancar no callback SkyMP', async () => {
    const { gateway, logs } = setup({ dispatch: async () => { throw new Error('router boom'); } });
    assert.equal(gateway(0xff000001, { type: 'panel:open' }), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(logs.some(entry => entry[0] === 'error' && entry.join(' ').includes('router boom')));
  });

  it('falha sincrona de chat nao escapa do callback SkyMP', () => {
    const router = { isValidEventEnvelope: () => true, dispatch: async () => {} };
    const errors = [];
    const gateway = createUiEventGateway({
      uiEventRouter: router,
      handleChatInput: () => { throw new Error('chat boom'); },
      logger: { log: () => {}, warn: () => {}, error: (...args) => errors.push(args) }
    });
    assert.equal(gateway(1, { type: 'cef::chat:send', data: 'ola' }), false);
    assert.ok(errors[0].join(' ').includes('chat boom'));
  });

  it('atribui o callback ao mock da API mp e preserva a recusa na fronteira', () => {
    const mp = {};
    const { calls } = setup({ valid: false });
    const gateway = installUiEventGateway(mp, {
      uiEventRouter: { isValidEventEnvelope: () => false, dispatch: async () => {} },
      handleChatInput: () => calls.push('chat'),
      logger: { log: () => {}, warn: () => {}, error: () => {} }
    });
    assert.equal(mp.onUiEvent, gateway);
    assert.equal(mp.onUiEvent(1, null), false);
    assert.deepEqual(calls, []);
  });

  it('interrompe o despacho quando o limitador configurado recusa o evento', () => {
    const { calls, logs } = setup();
    const limitedGateway = createUiEventGateway({
      uiEventRouter: { isValidEventEnvelope: () => true, dispatch: async () => calls.push('dispatch') },
      handleChatInput: () => calls.push('chat'),
      rateLimiter: { observe: () => ({ allowed: false }) },
      logger: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: () => {} }
    });
    assert.equal(limitedGateway(1, { type: 'panel:open' }), false);
    assert.deepEqual(calls, []);
    assert.ok(logs[0].join(' ').includes('rate limited'));
  });
});

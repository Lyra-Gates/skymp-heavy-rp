/**
 * core/ui-event-router.test.js
 *
 * Testes automatizados para o roteador central de eventos de UI.
 * Executa com: node --test core/ui-event-router.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, afterEach } = require('node:test');

const uiEventRouter = require('./ui-event-router');

describe('ui-event-router', () => {
  afterEach(() => {
    for (const prefix of uiEventRouter.list()) uiEventRouter.unregister(prefix);
  });

  it('dispatches para o handler cujo prefixo bate com uiEvent.type', async () => {
    const calls = [];
    uiEventRouter.register('governance', async (actorId, uiEvent) => {
      calls.push(['governance', actorId, uiEvent.type]);
      return true;
    });

    const handled = await uiEventRouter.dispatch(123, { type: 'governance:interaction:actions' });

    assert.strictEqual(handled, true);
    assert.deepStrictEqual(calls, [['governance', 123, 'governance:interaction:actions']]);
  });

  // Substitui o teste do "fallback multi-módulo" removido em 13/08/2026. O
  // comportamento antigo entregava TODO evento a TODO handler registrado, então
  // `panel` via o payload de `governance:*` e vice-versa — ver o cabeçalho de
  // `ui-event-router.js` e `CORE_FRAMEWORK_AUDIT.md` §3.
  it('entrega o evento SOMENTE ao handler do prefixo', async () => {
    const calls = [];
    uiEventRouter.register('governance', async () => { calls.push('governance'); return true; });
    uiEventRouter.register('panel', async () => { calls.push('panel'); return false; });

    await uiEventRouter.dispatch(1, { type: 'governance:interaction:actions' });

    assert.deepStrictEqual(calls, ['governance']);
  });

  it('não entrega a ninguém quando nenhum prefixo bate', async () => {
    const calls = [];
    uiEventRouter.register('governance', async () => { calls.push('governance'); return true; });

    const handled = await uiEventRouter.dispatch(1, { type: 'interaction:query' });

    assert.strictEqual(handled, false);
    assert.deepStrictEqual(calls, []);
  });

  it('retorna false quando nenhum handler trata o evento', async () => {
    uiEventRouter.register('panel', async () => false);
    const handled = await uiEventRouter.dispatch(1, { type: 'panel:open' });
    assert.strictEqual(handled, false);
  });

  it('retorna false e não lança para uiEvent inválido', async () => {
    assert.strictEqual(await uiEventRouter.dispatch(1, null), false);
    assert.strictEqual(await uiEventRouter.dispatch(1, {}), false);
    assert.strictEqual(await uiEventRouter.dispatch(1, { type: 42 }), false);
  });

  it('não propaga exceção do handler — devolve false e não contamina os outros', async () => {
    const calls = [];
    uiEventRouter.register('governance', async () => { throw new Error('boom'); });
    uiEventRouter.register('panel', async () => { calls.push('panel'); return true; });

    const handled = await uiEventRouter.dispatch(1, { type: 'governance:x' });

    assert.strictEqual(handled, false);
    // `panel` não é chamado como consolo: o evento era da governança.
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(await uiEventRouter.dispatch(1, { type: 'panel:open' }), true);
    assert.deepStrictEqual(calls, ['panel']);
  });

  it('unregister remove o handler do despacho', async () => {
    let called = false;
    uiEventRouter.register('panel', async () => { called = true; return true; });
    uiEventRouter.unregister('panel');

    const handled = await uiEventRouter.dispatch(1, { type: 'panel:open' });

    assert.strictEqual(called, false);
    assert.strictEqual(handled, false);
  });

  it('list() reflete os prefixos atualmente registrados', () => {
    uiEventRouter.register('governance', async () => true);
    uiEventRouter.register('panel', async () => true);
    assert.deepStrictEqual(uiEventRouter.list().sort(), ['governance', 'panel']);
  });

  it('register exige prefixo e handler função', () => {
    assert.throws(() => uiEventRouter.register('', async () => true));
    assert.throws(() => uiEventRouter.register('panel', 'not-a-function'));
  });

  it('recusa envelope array, type vazio e type excessivamente longo', async () => {
    assert.strictEqual(uiEventRouter.isValidEventEnvelope([]), false);
    assert.strictEqual(uiEventRouter.isValidEventEnvelope({ type: '' }), false);
    assert.strictEqual(uiEventRouter.isValidEventEnvelope({ type: 'x'.repeat(129) }), false);
    assert.strictEqual(uiEventRouter.isValidEventEnvelope({ type: 'panel:open' }), true);
  });
});

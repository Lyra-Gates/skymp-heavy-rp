const test = require('node:test');
const assert = require('node:assert/strict');

const governance = require('./governance-service');

test('governance command definitions are unique and usable by module registry', () => {
  const defs = governance.commandDefs();
  assert.ok(defs.length >= 15);

  const seen = new Set();
  for (const def of defs) {
    const names = Array.isArray(def.name) ? def.name : [def.name];
    assert.equal(typeof def.handler, 'function');
    assert.ok(def.description);
    assert.ok(def.usage);

    for (const name of names) {
      assert.ok(name.startsWith('/'));
      assert.equal(seen.has(name), false, `duplicate command: ${name}`);
      seen.add(name);
    }
  }
});

test('interaction actions are empty when actor or target has no active character', async () => {
  const result = await governance.getInteractionActions(0xff000001, 0xff000002);
  assert.deepEqual(result, { sections: [] });
});

test('interaction action malformada e recusada antes de tocar em estado de gameplay', async () => {
  await assert.doesNotReject(() => governance.handleInteractionAction(0xff000001, null, {}));
  await assert.doesNotReject(() => governance.handleInteractionAction(0xff000001, 'guard.stop', []));
  await assert.doesNotReject(() => governance.handleInteractionAction(0xff000001, 'guard.stop:extra', {}));
});

test('schema de interacao CEF rejeita campos tipados de forma permissiva', () => {
  assert.deepEqual(
    governance.validateUiInteractionPayload('guard.fine', { targetActorId: '0xff000001', amount: '12g' }),
    { ok: false, message: 'Valor de multa invalido.' }
  );
  assert.deepEqual(
    governance.validateUiInteractionPayload('guard.arrest', { targetActorId: '0xff000001', sentenceMinutes: 1.5 }),
    { ok: false, message: 'Tempo de prisao invalido.' }
  );
  assert.deepEqual(
    governance.validateUiInteractionPayload('guard.stop', { targetActorId: '0xff000001', reason: 'x'.repeat(257) }),
    { ok: false, message: 'Motivo invalido.' }
  );
});

test('schema de interacao CEF aceita payload minimo de acao de guarda', () => {
  assert.deepEqual(
    governance.validateUiInteractionPayload('guard.stop', { targetActorId: '0xff000001', reason: 'abordagem' }),
    { ok: true, targetActorId: 0xff000001 }
  );
});

test('schema de interacao CEF exige item valido e requestId bem formado na compra de barraca', () => {
  assert.deepEqual(
    governance.validateUiInteractionPayload('stall.buy', { targetActorId: '0xff000001', itemId: '5g' }),
    { ok: false, message: 'Item de barraca invalido.' }
  );
  assert.deepEqual(
    governance.validateUiInteractionPayload('stall.buy', { targetActorId: '0xff000001', itemId: 5, requestId: 'curto' }),
    { ok: false, message: 'Solicitacao invalida.' }
  );
  assert.deepEqual(
    governance.validateUiInteractionPayload('stall.buy', { targetActorId: '0xff000001', itemId: 5, count: 2, requestId: 'stall-buy-request-0001' }),
    { ok: true, targetActorId: 0xff000001 }
  );
});

/**
 * core/character-dashboard-bridge.test.js
 *
 * Prova o que este arquivo promete: SELF resolve pra quem pediu (não pra
 * ninguém mais), sem checagem de distância, e `character.dashboard.execute`
 * chama `openPanel` — nada de UI nova, nada de dado lido aqui.
 *
 * Executa com: node --test core/character-dashboard-bridge.test.js
 */

'use strict';

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

const interactionRegistry = require('./interaction-registry');
const { createTargetResolvers } = require('./interaction-targets');
const bridge = require('./character-dashboard-bridge');

const { TARGET_TYPES } = interactionRegistry;
const ATOR = 0x100;
const OUTRO_ATOR = 0x200;

describe('character-dashboard-bridge', () => {
  beforeEach(() => interactionRegistry._reset());

  it('recusa registrar sem targets ou sem openPanel', () => {
    assert.throws(() => bridge.registerInteractions({ openPanel: () => {} }));
    const targets = createTargetResolvers({ getCharacter: () => null });
    assert.throws(() => bridge.registerInteractions({ targets }));
  });

  it('o resolvedor SELF devolve sempre quem pediu, nunca outro ator', () => {
    const targets = createTargetResolvers({ getCharacter: () => null });
    bridge.registerInteractions({ targets, openPanel: () => {} });

    const resolvido = targets.resolve(TARGET_TYPES.SELF, /* rawTargetId irrelevante */ OUTRO_ATOR, ATOR);
    assert.strictEqual(resolvido.ok, true);
    assert.strictEqual(resolvido.target.actorId, ATOR, 'SELF ignora o rawTargetId — o alvo e sempre quem pediu');
    assert.strictEqual(typeof resolvido.target.assertRange, 'undefined', 'sem assertRange, distancia nunca e checada pra SELF');
  });

  it("'character.dashboard' esta registrado com target SELF e chama openPanel(actorId)", async () => {
    const targets = createTargetResolvers({ getCharacter: () => null });
    const chamadasOpenPanel = [];
    bridge.registerInteractions({ targets, openPanel: (actorId) => chamadasOpenPanel.push(actorId) });

    const entry = interactionRegistry.get('character.dashboard');
    assert.ok(entry);
    assert.strictEqual(entry.target, TARGET_TYPES.SELF);

    const resultado = await entry.execute({ actorId: ATOR });
    assert.deepStrictEqual(chamadasOpenPanel, [ATOR]);
    assert.strictEqual(resultado.message, null, 'sem mensagem de chat — quem abre e mp.set(browserVisible), nao notify');
  });
});

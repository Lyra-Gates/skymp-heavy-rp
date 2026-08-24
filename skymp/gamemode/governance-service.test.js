const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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

test('default prison uses the canonical spawn FormDesc', () => {
  const source = fs.readFileSync(require.resolve('./governance-service'), 'utf8');
  assert.match(source, /cellId: '162e2:Skyrim\.esm'/);
  assert.doesNotMatch(source, /cellId: '0x162e2'/);
});

/*
 * Os cinco testes do caminho legado de interacao sairam em 13/08/2026, junto
 * com o codigo que eles cobriam: `getInteractionActions`,
 * `handleInteractionAction` e `validateUiInteractionPayload`.
 *
 * O que eles verificavam continua verificado, e melhor, em
 * `core/interaction-service.test.js` e `core/interaction-registry.test.js`:
 *
 *   | O que o teste antigo travava            | Onde esta agora                          |
 *   |-----------------------------------------|------------------------------------------|
 *   | acao malformada nao toca gameplay       | `ação desconhecida e ação indisponível    |
 *   |                                         |  dão a MESMA resposta`                    |
 *   | `amount: '12g'` recusado                | `int: recusa notação científica, espaço,  |
 *   |                                         |  decimal e zero à esquerda`               |
 *   | `sentenceMinutes: 1.5` recusado         | idem                                      |
 *   | motivo longo demais recusado            | `string: apara, exige mínimo e tem teto`  |
 *   | `requestId` curto recusado              | `ação idempotente exige requestId com     |
 *   |                                         |  formato mínimo`                          |
 *
 * A diferenca que importa: o `requestId` agora e USADO. O teste antigo
 * verificava o formato de um campo que a governanca validava e jogava fora — o
 * novo verifica que o duplo clique cobra uma vez so.
 */

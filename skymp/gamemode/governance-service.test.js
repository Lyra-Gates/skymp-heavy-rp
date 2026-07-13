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

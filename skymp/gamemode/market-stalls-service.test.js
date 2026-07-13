const test = require('node:test');
const assert = require('node:assert/strict');

const marketStalls = require('./market-stalls-service');

// ─────────────────────────────────────────────────────────────────────────────
// Testes existentes
// ─────────────────────────────────────────────────────────────────────────────

test('market stalls command definitions are unique', () => {
  const defs = marketStalls.commandDefs();
  assert.ok(defs.length >= 10);

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

test('market stalls init and shutdown toggles service state', async () => {
  await marketStalls.initMarketStallsService();
  assert.equal(marketStalls.isInitialized(), true);
  marketStalls.shutdownMarketStallsService();
  assert.equal(marketStalls.isInitialized(), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Testes de exports e contrato
// ─────────────────────────────────────────────────────────────────────────────

test('module exports all required functions', () => {
  const requiredExports = [
    'PERMISSIONS',
    'commandDefs',
    'initMarketStallsService',
    'shutdownMarketStallsService',
    'placeStall',
    'packStall',
    'addItem',
    'removeItem',
    'listStalls',
    'listItems',
    'buyItem',
    'issueLicense',
    'inspectStall',
    'suspendStall',
    'confiscateItem',
    'expireStalls',
    'isInitialized'
  ];

  for (const name of requiredExports) {
    assert.ok(
      marketStalls[name] !== undefined,
      `missing export: ${name}`
    );
  }
});

test('PERMISSIONS are frozen and complete', () => {
  const perms = marketStalls.PERMISSIONS;
  assert.ok(Object.isFrozen(perms), 'PERMISSIONS should be frozen');

  const required = [
    'STALL_INSPECT',
    'STALL_SUSPEND',
    'STALL_CONFISCATE',
    'STALL_ISSUE_LICENSE',
    'STALL_COLLECT_TAX'
  ];

  for (const key of required) {
    assert.ok(perms[key], `missing permission: ${key}`);
    assert.equal(typeof perms[key], 'string');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Testes de comandos (contrato, nao funcionalidade com BD)
// ─────────────────────────────────────────────────────────────────────────────

test('all handlers accept actorId and args', () => {
  const defs = marketStalls.commandDefs();
  for (const def of defs) {
    assert.equal(typeof def.handler, 'function', `${def.name} handler must be a function`);
    // Handlers devem aceitar pelo menos 1 parametro (actorId)
    assert.ok(def.handler.length >= 1, `${def.name} handler must accept at least actorId`);
  }
});

test('command definitions include stall management commands', () => {
  const defs = marketStalls.commandDefs();
  const names = defs.map(d => d.name);

  const requiredCommands = [
    '/stallplace',
    '/stallpack',
    '/stalladd',
    '/stallremove',
    '/stalls',
    '/stallitems',
    '/stallbuy',
    '/stalllicense',
    '/stallinspect',
    '/stallsuspend',
    '/stallconfiscate'
  ];

  for (const cmd of requiredCommands) {
    assert.ok(names.includes(cmd), `missing command: ${cmd}`);
  }
});

test('command usages match expected patterns', () => {
  const defs = marketStalls.commandDefs();
  for (const def of defs) {
    // Usage deve comecar com o nome do comando
    const cmdName = Array.isArray(def.name) ? def.name[0] : def.name;
    assert.ok(
      def.usage.startsWith(cmdName),
      `${cmdName} usage '${def.usage}' should start with command name`
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Testes de shutdown e cleanup
// ─────────────────────────────────────────────────────────────────────────────

test('shutdown clears timers and state', async () => {
  await marketStalls.initMarketStallsService();
  assert.equal(marketStalls.isInitialized(), true);

  marketStalls.shutdownMarketStallsService();
  assert.equal(marketStalls.isInitialized(), false);

  // Iniciar novamente deve funcionar sem erro (timers anteriores limpos)
  await marketStalls.initMarketStallsService();
  assert.equal(marketStalls.isInitialized(), true);

  marketStalls.shutdownMarketStallsService();
  assert.equal(marketStalls.isInitialized(), false);
});

test('expireStalls is exported and callable', () => {
  assert.equal(typeof marketStalls.expireStalls, 'function');
});

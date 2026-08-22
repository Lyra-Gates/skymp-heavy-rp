/**
 * core/command-registry.test.js
 *
 * Cobre só o que a Tarefa 11 (Legacy Command Cleanup) mudou: `hidden` e o
 * filtro `playerFacing` de `list()`. O resto do arquivo (register/dispatch/
 * unregister) não tinha teste antes desta tarefa — gap pré-existente, não
 * escopo daqui.
 *
 * Executa com: node --test core/command-registry.test.js
 */

'use strict';

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

const commandRegistry = require('./command-registry');

function limpar() {
  for (const entry of commandRegistry.list()) commandRegistry.unregister(entry.command);
}

describe('command-registry — hidden e list(playerFacing)', () => {
  beforeEach(limpar);

  it('sem opts.hidden, o comando aparece em list() e em list({playerFacing:true})', () => {
    commandRegistry.register('/status', () => {}, { module: 'core' });

    assert.strictEqual(commandRegistry.list().find((c) => c.command === '/status').hidden, false);
    assert.ok(commandRegistry.list({ playerFacing: true }).some((c) => c.command === '/status'));
  });

  it('com hidden:true, o comando some de list({playerFacing:true}) mas continua em list() e continua despachavel', () => {
    let chamou = false;
    commandRegistry.register('/apresentar', () => { chamou = true; }, { module: 'identity', hidden: true });

    assert.strictEqual(commandRegistry.list().find((c) => c.command === '/apresentar').hidden, true);
    assert.strictEqual(commandRegistry.list({ playerFacing: true }).some((c) => c.command === '/apresentar'), false);

    const despachado = commandRegistry.dispatch(1, '/apresentar', '');
    assert.strictEqual(despachado, true, 'comando escondido continua funcional, so nao aparece na lista');
    assert.strictEqual(chamou, true);
  });
});

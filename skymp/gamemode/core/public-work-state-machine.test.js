'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const machine = require('./public-work-state-machine');

const T0 = new Date('2026-08-25T12:00:00.000Z');
const definition = {
  code: 'hay_delivery', originFormDesc: '101:Skyrim.esm', originLabel: 'Fardos do campo',
  destinationFormDesc: '102:Skyrim.esm', destinationLabel: 'Celeiro principal',
  rewardAmount: 5, cooldownGroup: 'public_delivery', timeLimitSeconds: 600
};
const REQUEST_ASSIGN = 'assign-0001';
const REQUEST_PICKUP = 'pickup-0001';
const REQUEST_COMPLETE = 'complete-0001';
const TOKEN = 'cargo_token_abcdefghijkl';

function assigned() {
  return machine.createAssignedRun({ id: 7, characterId: 42, definition, requestId: REQUEST_ASSIGN, now: T0 }).run;
}

describe('public-work-state-machine', () => {
  it('cria snapshot assigned com prazo e recompensa do servidor', () => {
    const result = machine.createAssignedRun({ id: 7, characterId: 42, definition, requestId: REQUEST_ASSIGN, now: T0 });
    assert.equal(result.ok, true);
    assert.equal(result.run.status, 'assigned');
    assert.equal(result.run.rewardAmount, 5);
    assert.equal(result.run.expiresAt.toISOString(), '2026-08-25T12:10:00.000Z');
  });

  it('faz assigned → in_progress → completed e invalida a carga', () => {
    const picked = machine.pickup(assigned(), { requestId: REQUEST_PICKUP, cargoToken: TOKEN, now: new Date(T0.getTime() + 1000) });
    assert.equal(picked.run.status, 'in_progress');
    const completed = machine.complete(picked.run, { requestId: REQUEST_COMPLETE, cargoToken: TOKEN, now: new Date(T0.getTime() + 2000) });
    assert.equal(completed.run.status, 'completed');
    assert.equal(completed.run.cargoToken, null);
  });

  it('retry com o mesmo request id é replay sem nova transição', () => {
    const picked = machine.pickup(assigned(), { requestId: REQUEST_PICKUP, cargoToken: TOKEN, now: new Date(T0.getTime() + 1000) });
    assert.equal(machine.pickup(picked.run, { requestId: REQUEST_PICKUP, cargoToken: TOKEN }).replay, true);
    const completed = machine.complete(picked.run, { requestId: REQUEST_COMPLETE, cargoToken: TOKEN, now: new Date(T0.getTime() + 2000) });
    assert.equal(machine.complete(completed.run, { requestId: REQUEST_COMPLETE, cargoToken: TOKEN }).replay, true);
  });

  it('recusa entrega sem carga correspondente', () => {
    const picked = machine.pickup(assigned(), { requestId: REQUEST_PICKUP, cargoToken: TOKEN, now: new Date(T0.getTime() + 1000) }).run;
    assert.equal(machine.complete(picked, { requestId: REQUEST_COMPLETE, cargoToken: 'outra_carga_abcdefghijkl', now: new Date(T0.getTime() + 2000) }).code, 'cargo_mismatch');
  });

  it('recusa coleta/conclusão vencidas e só expira após o prazo', () => {
    const run = assigned();
    assert.equal(machine.pickup(run, { requestId: REQUEST_PICKUP, cargoToken: TOKEN, now: run.expiresAt }).code, 'expired');
    assert.equal(machine.expire(run, { now: new Date(run.expiresAt.getTime() - 1) }).code, 'not_expired');
    assert.equal(machine.expire(run, { now: run.expiresAt }).run.status, 'expired');
  });

  it('cancelamento é terminal e nunca preserva carga', () => {
    const picked = machine.pickup(assigned(), { requestId: REQUEST_PICKUP, cargoToken: TOKEN, now: new Date(T0.getTime() + 1000) }).run;
    const cancelled = machine.cancel(picked, { now: new Date(T0.getTime() + 2000) });
    assert.equal(cancelled.run.status, 'cancelled');
    assert.equal(cancelled.run.cargoToken, null);
    assert.equal(machine.complete(cancelled.run, { requestId: REQUEST_COMPLETE, cargoToken: TOKEN }).code, 'terminal_run');
  });
});

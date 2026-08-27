const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createConnectionMonitor } = require('./connection-monitor');

function deferred() {
  /** @type {(value: boolean) => void} */
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

function setup({ checkWhitelist } = {}) {
  let connected = false;
  let actorId;
  let profileAvailable = true;
  const cleanupCalls = [];
  const checks = [];
  const kicks = [];
  const logs = [];
  const monitor = createConnectionMonitor({
    mp: {
      isConnected: () => connected,
      getUserActor: () => actorId,
      getActorsByProfileId: profileId => profileId === 7 && profileAvailable && actorId ? [actorId] : [],
      kick: userId => kicks.push(userId)
    },
    whitelist: {
      checkWhitelist: checkWhitelist || ((userId, profileId, resolvedActorId) => {
        checks.push([userId, profileId, resolvedActorId]);
        return true;
      })
    },
    commands: { removeActiveCharacter: id => cleanupCalls.push(['character', id]) },
    playerPanel: { cleanup: id => cleanupCalls.push(['panel', id]) },
    logger: {
      log: (...args) => logs.push(['log', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args])
    },
    maxUserId: 1,
    maxProfileId: 10,
    intervalMs: 10
  });

  return {
    monitor, checks, cleanupCalls, kicks, logs,
    setConnected: value => { connected = value; },
    setActorId: value => { actorId = value; },
    setProfileAvailable: value => { profileAvailable = value; }
  };
}

describe('connection-monitor', () => {
  it('tenta de novo quando o ator ou o profile ainda nao foram publicados pela engine', async () => {
    const state = setup();
    state.setConnected(true);

    state.monitor.tick();
    assert.deepEqual(state.checks, []);

    state.setActorId(0xff000001);
    state.setProfileAvailable(false);
    state.monitor.tick();
    assert.deepEqual(state.checks, []);
    assert.equal(state.logs.filter(entry => entry[0] === 'warn').length, 1);

    state.setProfileAvailable(true);
    state.monitor.tick();
    await flush();
    assert.deepEqual(state.checks, [[1, 7, 0xff000001]]);
  });

  it('invalida uma resposta de whitelist antiga apos desconexao e reconexao', async () => {
    const pending = [];
    const state = setup({
      checkWhitelist: (userId, profileId, actorId) => {
        const result = deferred();
        pending.push({ userId, profileId, actorId, result });
        return result.promise;
      }
    });
    state.setConnected(true);
    state.setActorId(0xff000001);
    state.monitor.tick();
    assert.equal(pending.length, 1);

    state.setConnected(false);
    state.monitor.tick();
    assert.deepEqual(state.cleanupCalls, [['character', 0xff000001], ['panel', 0xff000001]]);

    state.setConnected(true);
    state.setActorId(0xff000002);
    state.monitor.tick();
    assert.equal(pending.length, 2);

    pending[0].result.resolve(false);
    await flush();
    assert.deepEqual(state.cleanupCalls, [['character', 0xff000001], ['panel', 0xff000001]]);
    assert.equal(state.monitor.sessions.get(1).actorId, 0xff000002);
    assert.deepEqual(state.kicks, []);

    pending[1].result.resolve(true);
    await flush();
    assert.equal(state.monitor.sessions.get(1).approved, true);
  });

  it('limpa uma recusa apenas uma vez e espera a desconexao real', async () => {
    const state = setup({ checkWhitelist: () => false });
    state.setConnected(true);
    state.setActorId(0xff000001);
    state.monitor.tick();
    await flush();
    assert.deepEqual(state.cleanupCalls, [['character', 0xff000001], ['panel', 0xff000001]]);

    state.monitor.tick();
    assert.deepEqual(state.cleanupCalls, [['character', 0xff000001], ['panel', 0xff000001]]);
    assert.deepEqual(state.kicks, []);
  });

  it('expõe métricas agregadas de conexão e polling sem IDs', async () => {
    const state = setup({ checkWhitelist: () => true });
    state.setConnected(true);
    state.setActorId(0xff000001);
    state.monitor.tick();
    await flush();
    state.monitor.tick();
    state.setConnected(false);
    state.monitor.tick();

    const snapshot = state.monitor.snapshot();
    assert.deepEqual({ ...snapshot, totals: { ...snapshot.totals, maxTickMs: 0 } }, {
      active: 0,
      states: { pending: 0, approved: 0, rejected: 0 },
      totals: { connections: 1, disconnections: 1, approved: 1, rejected: 0, ticks: 3, maxTickMs: 0 },
      pollingIntervalMs: 10
    });
    assert.ok(Number.isFinite(snapshot.totals.maxTickMs));
    assert.ok(snapshot.totals.maxTickMs >= 0);
  });

  it('DOCUMENTA (não corrige) um risco: mp.isConnected() piscando false por um tick derruba um jogador que nunca desconectou', async () => {
    // Achado em revisão de código de 27/08/2026, não confirmado em runtime real
    // — ver docs/operations/ALPHA_0_RUNTIME_VALIDATION.md. tick() não distingue
    // "desconectou de verdade" de "a engine relatou false por um poll só" (lag,
    // jitter de rede). Se isso acontecer de verdade, o jogador é limpo
    // (removeActiveCharacter + playerPanel.cleanup) e, no tick seguinte, entra
    // como conexão NOVA — reverificação de whitelist do zero, sessão/painel
    // resetados, ainda que ele nunca tenha saído do jogo.
    const state = setup({ checkWhitelist: () => true });
    state.setConnected(true);
    state.setActorId(0xff000001);
    state.monitor.tick();
    await flush();
    assert.deepEqual(state.cleanupCalls, [], 'conectado e aprovado: nenhuma limpeza ainda');

    // Um poll só reportando false já é suficiente para derrubar a sessão —
    // não há debounce nem confirmação em ticks consecutivos.
    state.setConnected(false);
    state.monitor.tick();
    assert.deepEqual(state.cleanupCalls, [['character', 0xff000001], ['panel', 0xff000001]],
      'um unico tick com isConnected=false já dispara limpeza completa, sem confirmar de novo');

    // Se a engine "voltar a mentir a verdade" no tick seguinte, o jogador nunca
    // percebeu nada — mas foi tratado como reconexão do zero.
    state.setConnected(true);
    state.monitor.tick();
    await flush();
    assert.equal(state.monitor.snapshot().totals.connections, 2,
      'oscilação de 1 tick conta como duas conexões e uma desconexão pra um jogador que nunca saiu');
  });
});

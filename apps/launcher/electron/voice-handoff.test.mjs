import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceHandoffServer } from './voice-handoff.mjs';
import { iniciarVoiceHelper, killVoiceHelper } from './voice-process.mjs';

async function withServer(onHandoff, fn) {
  const srv = createVoiceHandoffServer({ onHandoff, port: 0 });
  const addr = await srv.listen();
  const url = `http://127.0.0.1:${addr.port}/voice-handoff`;
  try {
    return await fn({ srv, url });
  } finally {
    await srv.close();
  }
}

const VALID = {
  actorId: 0xff000a12,
  ticket: '753f03d8fa3c944a4c7b1dff7e7a08fb',
  host: '127.0.0.1',
  port: 7778
};

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

test('desarmado: POST valido responde 409 e nao chama onHandoff', async () => {
  let chamou = false;
  await withServer(async () => { chamou = true; return {}; }, async ({ url }) => {
    const r = await post(url, VALID);
    assert.equal(r.status, 409);
    assert.equal(chamou, false);
  });
});

test('armado: POST valido chama onHandoff com o corpo normalizado e devolve pid', async () => {
  let recebido = null;
  await withServer(async (h) => { recebido = h; return { pid: 4242 }; }, async ({ srv, url }) => {
    srv.arm();
    const r = await post(url, VALID);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, pid: 4242 });
    assert.deepEqual(recebido, VALID);
  });
});

test('armado: ticket fora do formato hex -> 400, sem spawn', async () => {
  let chamou = false;
  await withServer(async () => { chamou = true; return {}; }, async ({ srv, url }) => {
    srv.arm();
    const r = await post(url, { ...VALID, ticket: 'nao-e-hex; rm -rf /' });
    assert.equal(r.status, 400);
    assert.equal(chamou, false);
  });
});

test('armado: actorId ausente -> 400', async () => {
  await withServer(async () => ({}), async ({ srv, url }) => {
    srv.arm();
    const r = await post(url, { ticket: VALID.ticket });
    assert.equal(r.status, 400);
  });
});

test('armado: JSON invalido -> 400', async () => {
  await withServer(async () => ({}), async ({ srv, url }) => {
    srv.arm();
    const r = await post(url, '{ not json');
    assert.equal(r.status, 400);
  });
});

test('armado: corpo gigante -> 413', async () => {
  await withServer(async () => ({}), async ({ srv, url }) => {
    srv.arm();
    const r = await post(url, JSON.stringify({ ...VALID, pad: 'x'.repeat(5000) }));
    assert.equal(r.status, 413);
  });
});

test('armado: host/port ausentes caem no default 127.0.0.1:7778', async () => {
  let h = null;
  await withServer(async (x) => { h = x; return {}; }, async ({ srv, url }) => {
    srv.arm();
    await post(url, { actorId: VALID.actorId, ticket: VALID.ticket });
    assert.equal(h.host, '127.0.0.1');
    assert.equal(h.port, 7778);
  });
});

test('disarm() volta a recusar', async () => {
  await withServer(async () => ({ pid: 1 }), async ({ srv, url }) => {
    srv.arm();
    assert.equal((await post(url, VALID)).status, 200);
    srv.disarm();
    assert.equal((await post(url, VALID)).status, 409);
  });
});

test('GET / e outros metodos -> 404', async () => {
  await withServer(async () => ({}), async ({ srv, url }) => {
    srv.arm();
    assert.equal((await fetch(url.replace('/voice-handoff', '/'))).status, 404);
    assert.equal((await fetch(url)).status, 404); // GET no path certo
  });
});

test('onHandoff que lanca -> 500', async () => {
  await withServer(async () => { throw new Error('spawn boom'); }, async ({ srv, url }) => {
    srv.arm();
    const r = await post(url, VALID);
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /spawn boom/);
  });
});

// ─── voice-process: spawn via stub ───

test('iniciarVoiceHelper resolve com pid quando o processo confirma', async () => {
  const fake = fakeChild();
  const p = iniciarVoiceHelper('vh.exe', ['--actor-id', '0x1'], '/game', {
    spawnImpl: () => { queueMicrotask(() => fake.emit('spawn')); return fake; }
  });
  assert.deepEqual(await p, { pid: 1234 });
  killVoiceHelper();
});

test('iniciarVoiceHelper rejeita quando o spawn falha', async () => {
  const fake = fakeChild();
  const p = iniciarVoiceHelper('vh.exe', [], '/game', {
    spawnImpl: () => { queueMicrotask(() => fake.emit('error', new Error('ENOENT'))); return fake; }
  });
  await assert.rejects(p, /ENOENT/);
});

function fakeChild() {
  const listeners = {};
  return {
    pid: 1234,
    exitCode: null,
    killed: false,
    once(ev, fn) { (listeners[ev] ||= []).push(fn); },
    removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    emit(ev, ...a) { (listeners[ev] || []).forEach((f) => f(...a)); },
    kill() { this.killed = true; }
  };
}

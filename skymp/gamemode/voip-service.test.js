/**
 * voip-service.test.js
 *
 * Testes do handshake por ticket do voip-service — a correção do bug de
 * spoofing de actorId (antes, {type:'auth', actorId} era aceito sem nenhuma
 * verificação). Usa um servidor real em porta efêmera (port:0) via o próprio
 * pacote `ws`, já dependência do projeto — não mocka a rede, exercita o
 * handshake de verdade.
 *
 * Executa com: node --test voip-service.test.js
 */

const assert = require('assert');
const { describe, it, before, after, beforeEach } = require('node:test');
const WebSocket = require('ws');

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database') {
    return { query: async () => [], init: () => {} };
  }
  return originalLoad.apply(this, arguments);
};

const commands = require('./commands');
const voip = require('./voip-service');

Module._load = originalLoad;

const ACTOR_ID = 0xff00b001;
let port;

function connect() {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    ws.once('error', reject);
  });
}

function waitForClose(ws) {
  return new Promise((resolve) => ws.once('close', resolve));
}

describe('voip-service — handshake por ticket', () => {
  before(async () => {
    commands.registerActiveCharacter(ACTOR_ID, { id: 501, first_name: 'Jorah', last_name: 'Ferreiro' }, 1, 1);
    voip.startVoipServer(0, '127.0.0.1');
    // O bind é assíncrono (evento 'listening') — getListeningPort() só resolve depois disso.
    for (let i = 0; i < 50 && !voip.getListeningPort(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    port = voip.getListeningPort();
    assert.ok(port > 0, 'servidor deveria estar escutando numa porta efêmera');
  });

  after(() => {
    voip.stopVoipServer();
    commands.removeActiveCharacter(ACTOR_ID);
  });

  beforeEach(() => {
    voip._pendingTickets.clear();
  });

  it('recusa auth sem ticket e fecha a conexão', async () => {
    const ws = connect();
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'auth', actorId: ACTOR_ID }));

    const reply = await waitForMessage(ws);
    assert.strictEqual(reply.type, 'auth_failed');
    await waitForClose(ws);
  });

  it('recusa auth com ticket errado', async () => {
    voip.issueTicket(ACTOR_ID);
    const ws = connect();
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'auth', actorId: ACTOR_ID, ticket: 'ticket-forjado' }));

    const reply = await waitForMessage(ws);
    assert.strictEqual(reply.type, 'auth_failed');
    ws.close();
  });

  it('recusa auth reivindicando o actorId de outra pessoa (o bug original)', async () => {
    const ticketDoOutro = voip.issueTicket(0xff00b002); // ticket emitido pra OUTRO actorId
    const ws = connect();
    await new Promise((resolve) => ws.once('open', resolve));
    // Ataque: tenta se autenticar como ACTOR_ID usando o ticket de outra pessoa.
    ws.send(JSON.stringify({ type: 'auth', actorId: ACTOR_ID, ticket: ticketDoOutro }));

    const reply = await waitForMessage(ws);
    assert.strictEqual(reply.type, 'auth_failed');
    ws.close();
  });

  it('aceita auth com ticket válido emitido pra aquele actorId', async () => {
    const ticket = voip.issueTicket(ACTOR_ID);
    const ws = connect();
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'auth', actorId: ACTOR_ID, ticket }));

    const reply = await waitForMessage(ws);
    assert.strictEqual(reply.type, 'auth_ok');
    assert.strictEqual(reply.actorId, ACTOR_ID);
    assert.ok(voip.getConnectedVoipActors().includes(ACTOR_ID));
    ws.close();
  });

  it('ticket é de uso único — replay do mesmo ticket falha', async () => {
    const ticket = voip.issueTicket(ACTOR_ID);

    const ws1 = connect();
    await new Promise((resolve) => ws1.once('open', resolve));
    ws1.send(JSON.stringify({ type: 'auth', actorId: ACTOR_ID, ticket }));
    const reply1 = await waitForMessage(ws1);
    assert.strictEqual(reply1.type, 'auth_ok');
    ws1.close();

    const ws2 = connect();
    await new Promise((resolve) => ws2.once('open', resolve));
    ws2.send(JSON.stringify({ type: 'auth', actorId: ACTOR_ID, ticket }));
    const reply2 = await waitForMessage(ws2);
    assert.strictEqual(reply2.type, 'auth_failed', 'reusar o mesmo ticket deveria falhar');
    ws2.close();
  });

  it('_consumeTicket rejeita ticket expirado', () => {
    voip._pendingTickets.set(ACTOR_ID, { token: 'abc', expiresAt: Date.now() - 1000 });
    assert.strictEqual(voip._consumeTicket(ACTOR_ID, 'abc'), false);
  });

  it('_consumeTicket aceita ticket válido dentro do TTL', () => {
    voip._pendingTickets.set(ACTOR_ID, { token: 'abc', expiresAt: Date.now() + 10000 });
    assert.strictEqual(voip._consumeTicket(ACTOR_ID, 'abc'), true);
  });
});

describe('voip-service — comando /voz', () => {
  it('requestVoiceConnection não lança sem personagem ativo', () => {
    assert.doesNotThrow(() => voip.requestVoiceConnection(0xdeadbeef));
  });

  it('commandDefs registra /voz e /voice', () => {
    const defs = voip.commandDefs();
    const def = defs.find(d => Array.isArray(d.name) && d.name.includes('/voz'));
    assert.ok(def, '/voz deveria estar registrado');
    assert.ok(def.name.includes('/voice'));
    assert.strictEqual(typeof def.handler, 'function');
  });
});

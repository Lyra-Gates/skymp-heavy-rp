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
const { VOICE_RANGES } = require('./core/proximity-ranges');

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

/**
 * Relay de `audio_frame` — o caminho novo, que substitui o WebRTC P2P (bloqueado
 * pela CEF do lado da captura). Aqui `mp` precisa ser mockado: a proximidade lê
 * `mp.get(actorId, 'locationalData')`, e sem posição não há audiência nenhuma.
 *
 * O tick é chamado à mão em vez de esperar o timer de 2s — um teste que dorme
 * dois segundos por caso não é um teste, é um castigo.
 */
describe('voip-service — relay de audio_frame por proximidade', () => {
  const SPEAKER = 0xff00c001;
  const NEAR = 0xff00c002;
  const FAR = 0xff00c003;

  const RANGE = VOICE_RANGES.normal;
  const positions = new Map();

  // 2560 chars = exatamente um quadro de 20ms (1920 bytes) em base64.
  const FRAME = 'A'.repeat(2560);

  let relayPort;

  before(async () => {
    global.mp = {
      get: (actorId, prop) => {
        if (prop !== 'locationalData') return null;
        const pos = positions.get(actorId);
        return pos ? { pos } : null;
      }
    };

    voip.startVoipServer(0, '127.0.0.1');
    for (let i = 0; i < 50 && !voip.getListeningPort(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    relayPort = voip.getListeningPort();
    assert.ok(relayPort > 0);
  });

  after(() => {
    voip.stopVoipServer();
    delete global.mp;
  });

  beforeEach(() => {
    positions.clear();
    voip._pendingTickets.clear();
    voip._audienceByActor.clear();
  });

  /** Conecta, autentica com ticket válido e devolve um socket que acumula mensagens. */
  async function connectAuthed(actorId) {
    const ticket = voip.issueTicket(actorId);
    const ws = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    ws.received = [];
    ws.on('message', (raw) => ws.received.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'auth', actorId, ticket }));
    await waitFor(ws, 'auth_ok');
    return ws;
  }

  /**
   * Espera uma mensagem de um tipo específico. Filtrar por tipo não é preciosismo:
   * o ticker de 2s pode injetar um `proximity_update` no meio, e um `once('message')`
   * cru pegaria essa mensagem e o teste falharia por motivo errado.
   */
  function waitFor(ws, type, timeoutMs = 1000) {
    const already = ws.received.find((m) => m.type === type);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando '${type}'`)), timeoutMs);
      const onMessage = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type !== type) return;
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      };
      ws.on('message', onMessage);
    });
  }

  /** Dá tempo do servidor processar e (não) entregar antes de afirmar ausência. */
  function settle() {
    return new Promise((resolve) => setTimeout(resolve, 120));
  }

  it('retransmite o frame para quem está em alcance', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [RANGE * 0.5, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);
    voip.tickProximity();

    speaker.send(JSON.stringify({ type: 'audio_frame', seq: 7, data: FRAME }));
    const got = await waitFor(near, 'audio_frame');

    assert.strictEqual(got.fromActorId, SPEAKER);
    assert.strictEqual(got.seq, 7);
    assert.strictEqual(got.data, FRAME, 'o servidor não deve tocar nos bytes de áudio');

    speaker.close();
    near.close();
  });

  it('o volume retransmitido é o mesmo que calcVolume daria para aquele par', async () => {
    const dist = RANGE * 0.25;
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [dist, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);
    voip.tickProximity();

    speaker.send(JSON.stringify({ type: 'audio_frame', data: FRAME }));
    const got = await waitFor(near, 'audio_frame');

    assert.strictEqual(got.volume, voip.calcVolume(dist, RANGE));
    assert.ok(Math.abs(got.volume - 0.75) < 1e-9, `volume esperado ~0.75, veio ${got.volume}`);

    // E precisa bater com o que o proximity_update manda pro ganho do WebRTC —
    // se os dois caminhos discordassem, a mesma pessoa soaria em dois volumes
    // diferentes dependendo de qual transporte a entregou.
    const prox = await waitFor(near, 'proximity_update', 2500);
    const peer = prox.peers.find((p) => p.actorId === SPEAKER);
    assert.ok(peer, 'o locutor deveria aparecer no proximity_update do ouvinte');
    assert.strictEqual(peer.volume, got.volume);

    speaker.close();
    near.close();
  });

  it('NÃO retransmite para quem está fora do alcance', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(FAR, [RANGE * 1.5, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const far = await connectAuthed(FAR);
    voip.tickProximity();

    speaker.send(JSON.stringify({ type: 'audio_frame', data: FRAME }));
    await settle();

    assert.strictEqual(
      far.received.filter((m) => m.type === 'audio_frame').length, 0,
      'quem está fora do alcance não deveria receber nada'
    );

    speaker.close();
    far.close();
  });

  it('entrega ao que está perto e não ao que está longe, no mesmo frame', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [RANGE * 0.5, 0, 0]);
    positions.set(FAR, [RANGE * 2, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);
    const far = await connectAuthed(FAR);
    voip.tickProximity();

    speaker.send(JSON.stringify({ type: 'audio_frame', data: FRAME }));
    await waitFor(near, 'audio_frame');
    await settle();

    assert.strictEqual(far.received.filter((m) => m.type === 'audio_frame').length, 0);

    speaker.close();
    near.close();
    far.close();
  });

  it('o locutor não recebe o próprio frame de volta', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [RANGE * 0.5, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);
    voip.tickProximity();

    speaker.send(JSON.stringify({ type: 'audio_frame', data: FRAME }));
    await waitFor(near, 'audio_frame');
    await settle();

    assert.strictEqual(
      speaker.received.filter((m) => m.type === 'audio_frame').length, 0,
      'ouvir a si mesmo com atraso de rede é eco, não voz'
    );

    speaker.close();
    near.close();
  });

  it('descarta frame de conexão não autenticada', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [RANGE * 0.5, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);
    voip.tickProximity();

    // Terceira conexão, sem auth: manda frame se passando pelo locutor.
    const anon = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise((resolve) => anon.once('open', resolve));
    anon.send(JSON.stringify({ type: 'audio_frame', fromActorId: SPEAKER, data: FRAME }));
    await settle();

    assert.strictEqual(
      near.received.filter((m) => m.type === 'audio_frame').length, 0,
      'sem ticket não se injeta áudio na cena de ninguém'
    );

    anon.close();
    speaker.close();
    near.close();
  });

  it('descarta frame acima do teto de tamanho', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [RANGE * 0.5, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);
    voip.tickProximity();

    speaker.send(JSON.stringify({
      type: 'audio_frame',
      data: 'A'.repeat(voip.MAX_AUDIO_FRAME_B64 + 1)
    }));
    await settle();

    assert.strictEqual(
      near.received.filter((m) => m.type === 'audio_frame').length, 0,
      'frame acima do teto seria amplificado pelo relay para todos em alcance'
    );

    // E o socket continua vivo: descartar o frame não é motivo pra derrubar a voz.
    speaker.send(JSON.stringify({ type: 'audio_frame', data: FRAME }));
    await waitFor(near, 'audio_frame');

    speaker.close();
    near.close();
  });

  it('locutor mutado não é retransmitido', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [RANGE * 0.5, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);
    speaker.send(JSON.stringify({ type: 'mute', muted: true }));
    await settle();
    voip.tickProximity();

    speaker.send(JSON.stringify({ type: 'audio_frame', data: FRAME }));
    await settle();

    assert.strictEqual(near.received.filter((m) => m.type === 'audio_frame').length, 0);

    speaker.close();
    near.close();
  });

  it('sem tick não há audiência — frame que chega antes do primeiro tick não vaza', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [RANGE * 0.5, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);
    // De propósito: nenhum tickProximity() aqui.

    speaker.send(JSON.stringify({ type: 'audio_frame', data: FRAME }));
    await settle();

    assert.strictEqual(near.received.filter((m) => m.type === 'audio_frame').length, 0);

    speaker.close();
    near.close();
  });

  it('sinalização WebRTC continua sendo repassada — a Fase 1 adiciona, não substitui', async () => {
    positions.set(SPEAKER, [0, 0, 0]);
    positions.set(NEAR, [RANGE * 0.5, 0, 0]);

    const speaker = await connectAuthed(SPEAKER);
    const near = await connectAuthed(NEAR);

    speaker.send(JSON.stringify({ type: 'offer', targetActorId: NEAR, sdp: 'v=0 fake' }));
    const offer = await waitFor(near, 'offer');

    assert.strictEqual(offer.fromActorId, SPEAKER);
    assert.strictEqual(offer.sdp, 'v=0 fake');

    speaker.close();
    near.close();
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

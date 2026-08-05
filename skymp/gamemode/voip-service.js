/**
 * voip-service.js
 * Servidor de Sinalização WebRTC para VOIP por Proximidade.
 *
 * Arquitetura:
 * - Um WebSocketServer (porta 7778, bind local por padrão) recebe conexoes dos clientes CEF.
 * - Cada cliente se autentica enviando { type: 'auth', actorId, ticket }. O ticket é um
 *   token de uso único e curta duração emitido pelo servidor (issueTicket) quando o
 *   jogador roda /voz — sem isso, qualquer processo que conecte no WebSocket local
 *   poderia reivindicar o actorId de outro jogador e sequestrar o slot de voz dele.
 * - O servidor calcula a distancia entre atores a cada 2 segundos.
 * - Com base na distancia, envia { type: 'proximity', peerId, volume } ao cliente.
 * - Os clientes usam essa informacao para ajustar o GainNode do WebRTC AudioContext.
 * - Para estabelecer chamadas P2P, o servidor repassa offer/answer/ice entre pares.
 */

const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const commands = require('./commands');

const VOIP_PORT = Number.parseInt(process.env.VOIP_PORT, 10) || 7778;
const VOIP_BIND_HOST = process.env.VOIP_BIND_HOST || '127.0.0.1';
const VOIP_PUBLIC_HOST = process.env.VOIP_PUBLIC_HOST || '127.0.0.1';

// Mapa de clientes conectados: actorId -> { ws, actorId }
const voipClients = new Map();

// Tickets pendentes emitidos por /voz: actorId -> { token, expiresAt }
const _pendingTickets = new Map();
const TICKET_TTL_MS = 30 * 1000;

// Distancias de voz — derivadas dos raios do chat em core/proximity-ranges.js,
// pra que falar e escrever cheguem exatamente nas mesmas pessoas.
const { VOICE_RANGES } = require('./core/proximity-ranges');

let wss = null;
let _proximityTimer = null;

/**
 * Emite um ticket de uso único para um actorId poder se autenticar no VOIP.
 * Chamado pelo comando /voz — nunca client-initiated.
 * @param {number} actorId
 * @returns {string} token
 */
function issueTicket(actorId) {
  const token = crypto.randomBytes(16).toString('hex');
  _pendingTickets.set(actorId, { token, expiresAt: Date.now() + TICKET_TTL_MS });
  return token;
}

function _consumeTicket(actorId, token) {
  const pending = _pendingTickets.get(actorId);
  if (!pending) return false;
  _pendingTickets.delete(actorId); // uso único, válido ou não
  if (pending.expiresAt < Date.now()) return false;
  if (pending.token !== token) return false;
  return true;
}

function startVoipServer(port = VOIP_PORT, host = VOIP_BIND_HOST) {
  if (wss) return;

  wss = new WebSocketServer({ port, host });

  wss.on('listening', () => {
    console.log(`[voip] WebSocket signaling server listening on ws://${host}:${port}`);
  });

  wss.on('connection', (ws) => {
    let clientActorId = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'auth': {
          // Cliente se registra com seu actorId — exige ticket válido emitido por /voz.
          const claimedActorId = parseInt(msg.actorId);
          if (!Number.isFinite(claimedActorId) || !_consumeTicket(claimedActorId, msg.ticket)) {
            console.log(`[voip] Auth rejeitada (ticket inválido/expirado) para actorId ${msg.actorId}.`);
            ws.send(JSON.stringify({ type: 'auth_failed' }));
            ws.close();
            return;
          }
          clientActorId = claimedActorId;
          voipClients.set(clientActorId, { ws, actorId: clientActorId, voiceMode: 'normal' });
          console.log(`[voip] Actor 0x${clientActorId.toString(16)} connected to VOIP.`);
          ws.send(JSON.stringify({ type: 'auth_ok', actorId: clientActorId }));
          break;
        }

        case 'voice_mode':
          // Cliente altera seu modo de voz (normal/whisper/shout)
          if (clientActorId && voipClients.has(clientActorId)) {
            voipClients.get(clientActorId).voiceMode = msg.mode || 'normal';
          }
          break;

        case 'offer':
        case 'answer':
        case 'ice':
          // Repassa sinalizacao WebRTC para o peer alvo
          if (msg.targetActorId) {
            const target = voipClients.get(parseInt(msg.targetActorId));
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(JSON.stringify({
                ...msg,
                fromActorId: clientActorId
              }));
            }
          }
          break;

        case 'mute':
          // Jogador solicita mute de si mesmo
          if (clientActorId && voipClients.has(clientActorId)) {
            voipClients.get(clientActorId).muted = msg.muted === true;
            console.log(`[voip] Actor 0x${clientActorId.toString(16)} mute=${msg.muted}`);
          }
          break;
      }
    });

    ws.on('close', () => {
      if (clientActorId) {
        voipClients.delete(clientActorId);
        // Notifica todos os pares que o jogador saiu
        broadcast({ type: 'peer_left', actorId: clientActorId }, clientActorId);
        console.log(`[voip] Actor 0x${clientActorId.toString(16)} disconnected from VOIP.`);
      }
    });

    ws.on('error', (err) => {
      console.error('[voip] WebSocket error:', err.message);
    });
  });

  // Ticker de proximidade: a cada 2s calcula volumes para todos os pares.
  // unref: um ticker pendente não deve impedir o processo (ou os testes) de encerrar.
  _proximityTimer = setInterval(() => tickProximity(), 2000);
  if (typeof _proximityTimer.unref === 'function') _proximityTimer.unref();

  console.log('[voip] VOIP service initialized.');
}

/**
 * Calcula a distancia 3D entre dois atores e envia os volumes ajustados.
 */
function tickProximity() {
  if (typeof mp === 'undefined') return;

  const clientList = [...voipClients.values()];

  for (const client of clientList) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (client.muted) continue;

    let posA;
    try {
      const locA = mp.get(client.actorId, 'locationalData');
      if (!locA) continue;
      posA = locA.pos;
    } catch { continue; }

    const proximityData = [];

    for (const peer of clientList) {
      if (peer.actorId === client.actorId) continue;
      if (peer.muted) continue;

      let posB;
      try {
        const locB = mp.get(peer.actorId, 'locationalData');
        if (!locB) continue;
        posB = locB.pos;
      } catch { continue; }

      const dist = distance3D(posA, posB);
      const range = VOICE_RANGES[peer.voiceMode || 'normal'];
      const volume = calcVolume(dist, range);

      if (volume > 0) {
        proximityData.push({ actorId: peer.actorId, volume, dist: Math.round(dist) });
      }
    }

    // Envia o mapa de volume para o cliente
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: 'proximity_update', peers: proximityData }));
    }
  }
}

/**
 * Calcula o volume (0.0 ~ 1.0) com base na distancia e no alcance.
 */
function calcVolume(dist, maxRange) {
  if (dist >= maxRange) return 0;
  // Queda linear com minimo de 0.05 para quem esta muito perto
  return Math.max(0, Math.min(1, 1 - (dist / maxRange)));
}

function distance3D(a, b) {
  return Math.sqrt(
    Math.pow(a[0] - b[0], 2) +
    Math.pow(a[1] - b[1], 2) +
    Math.pow(a[2] - b[2], 2)
  );
}

function broadcast(msg, excludeActorId) {
  const raw = JSON.stringify(msg);
  for (const [id, client] of voipClients.entries()) {
    if (id !== excludeActorId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  }
}

/**
 * Retorna todos os atores conectados ao VOIP (para debug).
 */
function getConnectedVoipActors() {
  return [...voipClients.keys()];
}

/**
 * Porta em que o servidor está realmente escutando — útil em testes que
 * sobem o servidor em port:0 (porta efêmera escolhida pelo SO).
 * @returns {number|null}
 */
function getListeningPort() {
  if (!wss) return null;
  const addr = wss.address(); // null até o bind assíncrono terminar (evento 'listening')
  return addr ? addr.port : null;
}

/**
 * Encerra o servidor de sinalização (usado por testes; não há caminho de
 * shutdown em produção hoje, o módulo não declara shutdown no module-registry).
 */
function stopVoipServer() {
  if (_proximityTimer) clearInterval(_proximityTimer);
  _proximityTimer = null;
  if (!wss) return;
  wss.close();
  wss = null;
}

/**
 * Comando /voz: opt-in explícito — voz por proximidade não é forçada em todo
 * mundo (ver SKYMP_RP_DEVELOPMENT_PLAN.md, "Se voice chat é obrigatório" segue
 * uma decisão em aberto). Emite um ticket e empurra pro cliente via a property
 * SkyMP voipTicket (mesmo padrão comprovado de browserModal/panelData).
 */
function requestVoiceConnection(actorId) {
  const character = commands.getActiveCharacterData(actorId);
  if (!character) {
    commands.sendNotification(actorId, 'Seu personagem ainda nao esta carregado.');
    return;
  }

  const ticket = issueTicket(actorId);

  if (typeof mp === 'undefined') return;
  try {
    mp.set(actorId, 'voipTicket', {
      actorId,
      ticket,
      host: VOIP_PUBLIC_HOST,
      port: VOIP_PORT,
      sentAt: Date.now()
    });
  } catch (err) {
    console.error('[voip] Falha ao enviar ticket de voz:', err.message);
  }
}

function commandDefs() {
  return [
    {
      name: ['/voz', '/voice'],
      description: 'Conecta ao chat de voz por proximidade (opt-in)',
      usage: '/voz',
      handler: (actorId) => requestVoiceConnection(actorId)
    }
  ];
}

module.exports = {
  commandDefs,
  startVoipServer,
  stopVoipServer,
  getConnectedVoipActors,
  getListeningPort,
  issueTicket,
  requestVoiceConnection,
  // Exposto só pra testes
  _consumeTicket,
  _pendingTickets
};

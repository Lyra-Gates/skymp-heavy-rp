/**
 * voip-service.js
 * Servidor de Sinalização WebRTC para VOIP por Proximidade.
 *
 * Arquitetura:
 * - Um WebSocketServer (porta 7778) recebe conexoes dos clientes CEF.
 * - Cada cliente se autentica enviando { type: 'auth', actorId }.
 * - O servidor calcula a distancia entre atores a cada 2 segundos.
 * - Com base na distancia, envia { type: 'proximity', peerId, volume } ao cliente.
 * - Os clientes usam essa informacao para ajustar o GainNode do WebRTC AudioContext.
 * - Para estabelecer chamadas P2P, o servidor repassa offer/answer/ice entre pares.
 */

const { WebSocketServer, WebSocket } = require('ws');

// Mapa de clientes conectados: actorId -> { ws, actorId }
const voipClients = new Map();

// Distancias de voz (em unidades SkyMP)
const VOICE_RANGES = {
  whisper: 200,    // Sussurro
  normal:  1200,   // Conversa normal
  shout:   3000,   // Grito
};

let wss = null;

function startVoipServer(port = 7778) {
  if (wss) return;

  wss = new WebSocketServer({ port });

  wss.on('listening', () => {
    console.log(`[voip] WebSocket signaling server listening on ws://127.0.0.1:${port}`);
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
        case 'auth':
          // Cliente se registra com seu actorId
          clientActorId = parseInt(msg.actorId);
          voipClients.set(clientActorId, { ws, actorId: clientActorId, voiceMode: 'normal' });
          console.log(`[voip] Actor 0x${clientActorId.toString(16)} connected to VOIP.`);
          ws.send(JSON.stringify({ type: 'auth_ok', actorId: clientActorId }));
          break;

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

  // Ticker de proximidade: a cada 2s calcula volumes para todos os pares
  setInterval(() => tickProximity(), 2000);

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

module.exports = { startVoipServer, getConnectedVoipActors };

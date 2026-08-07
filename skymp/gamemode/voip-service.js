/**
 * voip-service.js
 * VOIP por proximidade: sinalização WebRTC (caminho antigo) + relay de áudio (caminho novo).
 *
 * Arquitetura:
 * - Um WebSocketServer (porta 7778, bind local por padrão) recebe conexoes dos clientes CEF.
 * - Cada cliente se autentica enviando { type: 'auth', actorId, ticket }. O ticket é um
 *   token de uso único e curta duração emitido pelo servidor (issueTicket) quando o
 *   jogador roda /voz — sem isso, qualquer processo que conecte no WebSocket local
 *   poderia reivindicar o actorId de outro jogador e sequestrar o slot de voz dele.
 * - O servidor calcula a distancia entre atores a cada 2 segundos.
 * - Com base na distancia, envia { type: 'proximity_update', peers: [...] } ao cliente.
 *
 * Dois caminhos convivem aqui de propósito, e a Fase 2 remove o primeiro:
 *
 * 1. WebRTC P2P (offer/answer/ice). O servidor só repassa sinalização; o áudio vai
 *    direto entre os clientes, e o `index.html` ajusta o GainNode com o
 *    `proximity_update`. É o que roda no client SkyMP oficial — e é o caminho que
 *    *não funciona*, porque a captura (`getUserMedia`) é bloqueada no CEF embutido.
 *
 * 2. Relay pelo servidor (`audio_frame`). Um helper nativo fora do CEF captura o
 *    microfone via WASAPI e manda os frames por este mesmo WebSocket; o servidor
 *    retransmite pra quem está em alcance, com o volume já calculado. O navegador
 *    do jogo só *toca* — tocar nunca foi bloqueado pela CEF, só a captura era.
 *    Ver `docs/technical/VOICE_NATIVE_HELPER.md`.
 *
 * Por que relay e não P2P: reverter a flag do Chromium que libera o microfone é
 * um caminho descartado (`docs/technical/VOICE_CLIENT_PATCH.md`) — a remoção foi
 * deliberada na SkyrimPlatform 2.1, e reabri-la exporia o microfone do jogador a
 * qualquer servidor SkyMP que ele conectasse depois, não só a este. De quebra, o
 * relay resolve NAT/CGNAT: dois jogadores em redes residenciais distintas não
 * fecham conexão direta, mas os dois alcançam o servidor.
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

/**
 * Formato do áudio no fio (Fase 1): PCM cru, 16-bit little-endian, mono, 48kHz,
 * quadros de 20ms (960 amostras = 1920 bytes → 2560 chars em base64).
 *
 * O servidor não decodifica nem transcodifica nada — ele é um relay burro que
 * anexa o volume e repassa os bytes. Estas constantes existem só pra derivar o
 * teto de tamanho abaixo e pra que helper, servidor e UI citem a mesma fonte.
 * Ver `docs/technical/VOICE_NATIVE_HELPER.md` §2 pro porquê de PCM antes de Opus.
 */
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 1;
const AUDIO_FRAME_MS = 20;

/**
 * Teto do payload base64 de um `audio_frame`, em caracteres.
 *
 * Um `audio_frame` é o único ponto onde um cliente autenticado faz o servidor
 * escrever dados controlados por ele nos sockets de *outros* jogadores. Sem
 * teto, um helper com bug (ou um cliente hostil que passou pelo ticket) manda um
 * frame de megabytes e o servidor o multiplica por todo mundo em alcance —
 * amplificação, e a memória que estoura é a do servidor, não a de quem mandou.
 *
 * 8192 dá folga de 3x sobre o quadro nominal de 20ms: quadros de até 60ms passam
 * (o helper pode agrupar sob carga), qualquer coisa acima disso é bug ou abuso.
 */
const MAX_AUDIO_FRAME_B64 = 8192;

let wss = null;
let _proximityTimer = null;

/**
 * Audiência por locutor, recalculada a cada `tickProximity()`:
 *   actorId do locutor -> [{ actorId: ouvinte, volume }]
 *
 * É a transposta do que o tick já calculava e jogava fora. A proximidade custa
 * O(n²) de distância 3D; um frame chega a 50/s por locutor, então recalcular por
 * frame seria pagar esse O(n²) cinquenta vezes por segundo por pessoa falando.
 * O relay só consulta esta tabela.
 *
 * O preço é que a audiência tem até 2s de idade: quem sai do alcance continua
 * ouvindo até o próximo tick. Não é uma imprecisão nova — o `proximity_update`
 * que ajusta o ganho do WebRTC sempre teve exatamente a mesma defasagem; o relay
 * herda a propriedade em vez de introduzi-la.
 */
const _audienceByActor = new Map();

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

        case 'audio_frame': {
          // Caminho novo: o helper nativo manda PCM capturado fora do CEF e o
          // servidor retransmite pra quem está em alcance. Só para autenticados
          // — sem isso, uma conexão anônima injetaria áudio na cena de todo
          // mundo, que é o mesmo furo que o ticket fechou no `auth`.
          if (clientActorId === null) break;
          if (typeof msg.data !== 'string') break;
          if (msg.data.length > MAX_AUDIO_FRAME_B64) {
            const client = voipClients.get(clientActorId);
            // Loga uma vez por conexão: o descarte é barato, o log em 50Hz não.
            if (client && !client.oversizedFrameLogged) {
              client.oversizedFrameLogged = true;
              console.warn(
                `[voip] Actor 0x${clientActorId.toString(16)} mandou audio_frame de ` +
                `${msg.data.length} chars (teto ${MAX_AUDIO_FRAME_B64}); descartando.`
              );
            }
            break;
          }
          relayAudioFrame(clientActorId, msg);
          break;
        }

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
 * Calcula a distancia 3D entre dois atores, envia os volumes ajustados e
 * reconstrói a audiência de cada locutor (usada pelo relay de `audio_frame`).
 */
function tickProximity() {
  // Zera antes de qualquer saída: sem posição não há proximidade, e sem
  // proximidade nada deve ser retransmitido. Uma audiência velha sobrevivendo a
  // um tick que falhou faria o relay continuar entregando com base em onde as
  // pessoas estavam, não onde estão.
  _audienceByActor.clear();

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

        // Mesmo par, visto do outro lado: `peer` fala, `client` ouve naquele
        // volume. É exatamente o número que o `proximity_update` manda pro
        // ganho do WebRTC — os dois caminhos ficam obrigados a concordar
        // porque leem a mesma conta, não uma cópia dela.
        let audience = _audienceByActor.get(peer.actorId);
        if (!audience) {
          audience = [];
          _audienceByActor.set(peer.actorId, audience);
        }
        audience.push({ actorId: client.actorId, volume });
      }
    }

    // Envia o mapa de volume para o cliente
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: 'proximity_update', peers: proximityData }));
    }
  }
}

/**
 * Retransmite um `audio_frame` para quem está em alcance do locutor, anexando o
 * volume que aquele ouvinte específico deve aplicar.
 *
 * O servidor não olha dentro de `data` — não decodifica, não mistura, não
 * transcodifica. Mixagem no servidor economizaria banda de descida, mas exigiria
 * decodificar e somar N fluxos por ouvinte a cada 20ms; para uma prova de
 * conceito isso é trocar um problema provado por um não provado. Ver
 * `docs/technical/VOICE_NATIVE_HELPER.md` §5.
 *
 * @param {number} fromActorId locutor já autenticado
 * @param {object} msg mensagem recebida (usa-se apenas `seq` e `data`)
 * @returns {number} quantos ouvintes receberam — usado por teste e log
 */
function relayAudioFrame(fromActorId, msg) {
  const audience = _audienceByActor.get(fromActorId);
  if (!audience || audience.length === 0) return 0;

  let delivered = 0;
  for (const listener of audience) {
    const client = voipClients.get(listener.actorId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) continue;

    // Serializado por ouvinte porque o `volume` muda por ouvinte. Custa uma
    // cópia do payload por destinatário; com PCM cru isso é ~2,5KB cada. Está
    // registrado como item da Fase 2 (com Opus o payload cai ~30x, e aí o
    // desperdício deixa de importar).
    client.ws.send(JSON.stringify({
      type: 'audio_frame',
      fromActorId,
      volume: listener.volume,
      seq: msg.seq,
      data: msg.data
    }));
    delivered++;
  }
  return delivered;
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
  _audienceByActor.clear();
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
  // Formato do áudio no fio — o helper nativo e a UI precisam concordar com isto.
  AUDIO_SAMPLE_RATE,
  AUDIO_CHANNELS,
  AUDIO_FRAME_MS,
  MAX_AUDIO_FRAME_B64,
  // `tickProximity` é chamado pelo ticker de 2s em produção; exposto porque o
  // teste do relay precisa de um tick determinístico em vez de esperar o timer.
  tickProximity,
  calcVolume,
  // Exposto só pra testes
  _consumeTicket,
  _pendingTickets,
  _audienceByActor
};

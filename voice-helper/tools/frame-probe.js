#!/usr/bin/env node
/**
 * frame-probe.js — fala o mesmo protocolo do helper nativo, em Node.
 *
 * Existe porque o helper em C++ e o relay do servidor falham de formas
 * diferentes, e depurar os dois ao mesmo tempo é como o projeto acabou com um
 * VOIP que nunca produziu áudio. Esta sonda isola as metades: se ela envia e o
 * navegador toca, o problema (quando houver) está na captura WASAPI, não no
 * transporte, no relay ou na reprodução.
 *
 * Foi o que validou o servidor e a UI na Fase 1 — ver
 * docs/technical/VOICE_NATIVE_HELPER.md §7.
 *
 * NÃO substitui o helper: não captura microfone nenhum, gera um tom sintético.
 *
 * Uso:
 *   node frame-probe.js --actor-id 0xFF000A12 --ticket <token> [--host h] [--port p]
 *                       [--freq 440] [--seconds 10]
 *   node frame-probe.js --listen --actor-id 0xFF000A13 --ticket <token>
 */

// `ws` é resolvido a partir do gamemode, onde ele já é dependência declarada.
// Um `node_modules` próprio aqui seria uma segunda cópia da mesma biblioteca
// podendo divergir de versão justamente no componente que testa o protocolo.
const path = require('path');
const { createRequire } = require('module');
const gamemodeRequire = createRequire(
  path.resolve(__dirname, '..', '..', 'skymp', 'gamemode', 'package.json')
);
const WebSocket = gamemodeRequire('ws');

// Tem que bater com AUDIO_* em voip-service.js e com o main.cpp do helper.
const SAMPLE_RATE = 48000;
const FRAME_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE / 1000) * FRAME_MS; // 960

function parseArgs(argv) {
  const opt = {
    host: '127.0.0.1', port: 7778, freq: 440, seconds: 0,
    listen: false, actorId: null, ticket: null, amplitude: 0.3
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--listen') opt.listen = true;
    else if (a === '--actor-id') opt.actorId = Number.parseInt(argv[++i], 0) || Number(argv[i]);
    else if (a === '--ticket') opt.ticket = argv[++i];
    else if (a === '--host') opt.host = argv[++i];
    else if (a === '--port') opt.port = Number.parseInt(argv[++i], 10);
    else if (a === '--freq') opt.freq = Number.parseFloat(argv[++i]);
    else if (a === '--seconds') opt.seconds = Number.parseFloat(argv[++i]);
    else if (a === '--amplitude') opt.amplitude = Number.parseFloat(argv[++i]);
    else { console.error(`argumento desconhecido: ${a}`); process.exit(2); }
  }
  if (!Number.isFinite(opt.actorId) || !opt.ticket) {
    console.error('faltou --actor-id e/ou --ticket. Ver o cabeçalho deste arquivo.');
    process.exit(2);
  }
  return opt;
}

/** Um quadro de 20ms de senoide, PCM 16-bit LE mono, contínuo entre quadros. */
function makeToneFrame(phase, freq, amplitude) {
  const buf = Buffer.allocUnsafe(SAMPLES_PER_FRAME * 2);
  const step = (2 * Math.PI * freq) / SAMPLE_RATE;
  for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
    // A fase continua de um quadro pro outro de propósito: reiniciar em zero a
    // cada 20ms produziria um clique de 50Hz que mascararia problema de jitter.
    const v = Math.sin(phase + i * step) * amplitude;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  return { buf, phase: (phase + SAMPLES_PER_FRAME * step) % (2 * Math.PI) };
}

const opt = parseArgs(process.argv);
const url = `ws://${opt.host}:${opt.port}`;
const ws = new WebSocket(url);

let timer = null;
let sent = 0;
let phase = 0;

ws.on('open', () => {
  console.log(`[probe] conectado em ${url}; autenticando como 0x${opt.actorId.toString(16)}`);
  ws.send(JSON.stringify({ type: 'auth', actorId: opt.actorId, ticket: opt.ticket }));
});

const received = new Map(); // fromActorId -> { frames, bytes, volumes:Set }

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === 'auth_ok') {
    console.log('[probe] autenticado.');
    if (opt.listen) { console.log('[probe] modo escuta; aguardando audio_frame.'); return; }
    startSending();
    return;
  }

  if (msg.type === 'auth_failed') {
    console.error('[probe] auth recusada — ticket expirado (30s), já usado, ou de outro ator.');
    process.exit(1);
  }

  if (msg.type === 'audio_frame') {
    let s = received.get(msg.fromActorId);
    if (!s) { s = { frames: 0, bytes: 0, volumes: new Set() }; received.set(msg.fromActorId, s); }
    s.frames++;
    s.bytes += Buffer.from(msg.data, 'base64').length;
    s.volumes.add(msg.volume);
    if (s.frames === 1 || s.frames % 50 === 0) {
      console.log(`[probe] <- 0x${msg.fromActorId.toString(16)}: ${s.frames} quadros, ` +
                  `${s.bytes} bytes, volumes ${[...s.volumes].join(',')}`);
    }
    return;
  }

  if (msg.type === 'proximity_update') {
    console.log(`[probe] proximity_update: ${JSON.stringify(msg.peers)}`);
  }
});

function startSending() {
  const started = Date.now();
  console.log(`[probe] enviando tom de ${opt.freq}Hz, quadros de ${FRAME_MS}ms.`);
  timer = setInterval(() => {
    const t = makeToneFrame(phase, opt.freq, opt.amplitude);
    phase = t.phase;
    ws.send(JSON.stringify({ type: 'audio_frame', seq: sent, data: t.buf.toString('base64') }));
    sent++;
    if (sent % 50 === 0) console.log(`[probe] -> ${sent} quadros enviados (${sent * FRAME_MS / 1000}s)`);
    if (opt.seconds > 0 && Date.now() - started >= opt.seconds * 1000) shutdown();
  }, FRAME_MS);
}

function shutdown() {
  if (timer) clearInterval(timer);
  console.log(`[probe] fim. enviados=${sent}`);
  for (const [id, s] of received) {
    console.log(`[probe] recebidos de 0x${id.toString(16)}: ${s.frames} quadros, ${s.bytes} bytes`);
  }
  ws.close();
  setTimeout(() => process.exit(0), 100);
}

ws.on('error', (err) => { console.error('[probe] erro:', err.message); process.exit(1); });
ws.on('close', () => { console.log('[probe] socket fechado.'); if (timer) clearInterval(timer); });
process.on('SIGINT', shutdown);

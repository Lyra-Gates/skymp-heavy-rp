#!/usr/bin/env node
/**
 * SPIKE SkyVoice/LiveKit — prova de transporte, não implementação de voz.
 *
 * ## O que este programa prova, e o que ele não pode provar
 *
 * Ele sobe dois participantes contra um `livekit-server` **real**, publica um
 * sinal conhecido de um lado e mede o que sai do outro. Isso prova o caminho
 * `A → SFU → B` com tokens emitidos pelo nosso próprio código.
 *
 * Ele **não** prova que a voz sai inteligível, porque nenhum programa prova
 * isso: inteligibilidade é um julgamento humano, não uma medida. Ver
 * `VOICE_NATIVE_HELPER.md` §8.2 — a mesma limitação do caminho legado, pelo
 * mesmo motivo, e ela não desaparece por trocarmos de transporte.
 *
 * Ele também **não** usa Skyrim, nem CEF, nem o `voice-helper`. Os dois
 * participantes são processos Node. O que está sob teste é o transporte e o
 * contrato de token — as duas coisas que precisavam de resposta antes de
 * escolher entre o Plano A (CEF) e o Plano B (nativo), e que são idênticas nos
 * dois planos.
 *
 * ## Como rodar
 *
 *   1. suba o livekit-server (ver README.md deste diretório)
 *   2. LIVEKIT_URL=ws://127.0.0.1:7880 \
 *      LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... node spike.js
 */

'use strict';

const path = require('path');
const {
  Room, RoomEvent, AudioSource, AudioStream, AudioFrame,
  LocalAudioTrack, LocalVideoTrack, VideoSource,
  TrackPublishOptions, TrackSource
} = require('@livekit/rtc-node');

// O token vem do MESMO módulo que o gamemode usa. Se o spike tivesse o próprio
// emissor, ele provaria que *um* emissor funciona — e não é isso que precisa de
// prova; é o nosso.
const lkToken = require(
  path.join(__dirname, '..', '..', 'skymp', 'gamemode', 'core', 'voice', 'livekit-token')
);

const URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const ROOM = process.env.LIVEKIT_ROOM || `skyvoice-spike-${Date.now()}`;

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE / 1000) * FRAME_MS; // 960 — o mesmo do legado
const TONE_HZ = 440;
const TONE_AMPLITUDE = 0.3;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === true ? 'PASS' : ok === false ? 'FALHOU' : 'N/D';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * SÓ PARA O CONTROLE DA §6 — emite um token SEM `canPublishSources`.
 *
 * Existe para provar que a recusa de câmera vem da permissão e não do
 * `VideoSource`. Deliberadamente **não** mora em
 * `core/voice/livekit-token.js`: um emissor permissivo em código de produção é
 * uma porta esperando alguém chamá-la por engano. Aqui ele é um instrumento de
 * medição, e o arquivo inteiro é um spike.
 */
function mintPermissiveTokenForControl(room) {
  const crypto = require('crypto');
  const b64 = (b) => Buffer.from(b).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: API_KEY, sub: `control-${crypto.randomBytes(3).toString('hex')}`,
    nbf: now - 10, exp: now + 360, jti: crypto.randomBytes(8).toString('hex'),
    video: { roomJoin: true, room, canPublish: true, canSubscribe: true }
  };
  const si = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
  return `${si}.${b64(crypto.createHmac('sha256', API_SECRET).update(si).digest())}`;
}

/** Tom de 440Hz em PCM s16 mono 48k — sinal conhecido, verificável por conta. */
function makeToneFrame(phaseStart) {
  const data = new Int16Array(SAMPLES_PER_FRAME);
  let phase = phaseStart;
  const step = (2 * Math.PI * TONE_HZ) / SAMPLE_RATE;
  for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
    data[i] = Math.round(Math.sin(phase) * TONE_AMPLITUDE * 32767);
    phase += step;
  }
  return { frame: new AudioFrame(data, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME), phase };
}

/** Energia RMS de um bloco de amostras s16, normalizada para 0..1. */
function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Energia do sinal em `hz` por correlação (Goertzel simplificado).
 * Serve para separar "chegou o nosso tom" de "chegou algum ruído".
 */
function energyAt(samples, hz) {
  let re = 0, im = 0;
  const step = (2 * Math.PI * hz) / SAMPLE_RATE;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    re += v * Math.cos(step * i);
    im += v * Math.sin(step * i);
  }
  return Math.sqrt(re * re + im * im) / samples.length;
}

/** Coletor de áudio recebido: acumula amostras e conta quadros. */
function collectAudio(track, sink) {
  const stream = new AudioStream(track);
  (async () => {
    try {
      for await (const frame of stream) {
        sink.frames++;
        const d = frame.data;
        for (let i = 0; i < d.length; i++) sink.samples.push(d[i]);
        if (sink.samples.length > SAMPLE_RATE * 5) {
          sink.samples.splice(0, sink.samples.length - SAMPLE_RATE * 5);
        }
      }
    } catch { /* stream encerrado com a sala */ }
  })();
  return stream;
}

async function main() {
  console.log('SPIKE SkyVoice/LiveKit');
  console.log(`  servidor : ${URL}`);
  console.log(`  sala     : ${ROOM}\n`);

  if (!API_KEY || !API_SECRET) {
    console.error('LIVEKIT_API_KEY e LIVEKIT_API_SECRET são obrigatórios.');
    process.exit(2);
  }

  const ACTOR_A = 0xff000a01;
  const ACTOR_B = 0xff000b02;

  const identityA = lkToken.participantIdentity(ACTOR_A);
  const identityB = lkToken.participantIdentity(ACTOR_B);

  const tokenA = lkToken.mintAccessToken({
    apiKey: API_KEY, apiSecret: API_SECRET, room: ROOM,
    identity: identityA, name: 'Cliente A'
  });
  const tokenB = lkToken.mintAccessToken({
    apiKey: API_KEY, apiSecret: API_SECRET, room: ROOM,
    identity: identityB, name: 'Cliente B'
  });

  // ── 1. Nenhum API secret no cliente ────────────────────────────────────────
  console.log('1. Token e segredo');
  record(
    'nenhum API secret dentro do token',
    !tokenA.includes(API_SECRET) && !tokenB.includes(API_SECRET),
    'o cliente recebe a assinatura, nunca a chave que assina'
  );
  const payloadA = lkToken.decodePayloadUnsafe(tokenA);
  record('token preso a UMA sala', payloadA.video.room === ROOM, `room=${payloadA.video.room}`);
  record(
    'token só permite publicar microfone',
    JSON.stringify(payloadA.video.canPublishSources) === JSON.stringify(['microphone']),
    'câmera negada na camada do token'
  );

  // ── 2. Dois clientes, autenticação real ────────────────────────────────────
  console.log('\n2. Conexão de dois clientes');
  const roomA = new Room();
  const roomB = new Room();

  const heardOnB = { frames: 0, samples: [] };
  let trackSubscribedOnB = false;
  let mutedSeenOnB = false;
  let unmutedSeenOnB = false;

  roomB.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    trackSubscribedOnB = true;
    const actor = lkToken.actorIdFromIdentity(participant.identity);
    console.log(`     B assinou faixa de ${participant.identity} (actorId=${actor})`);
    collectAudio(track, heardOnB);
  });
  roomB.on(RoomEvent.TrackMuted, () => { mutedSeenOnB = true; });
  roomB.on(RoomEvent.TrackUnmuted, () => { unmutedSeenOnB = true; });

  let qualitySeen = null;
  roomB.on(RoomEvent.ConnectionQualityChanged, (q) => { qualitySeen = q; });

  await roomA.connect(URL, tokenA, { autoSubscribe: true, dynacast: false });
  record('cliente A autenticado pelo livekit-server', true, `identity=${identityA}`);

  await roomB.connect(URL, tokenB, { autoSubscribe: true, dynacast: false });
  record('cliente B autenticado pelo livekit-server', true, `identity=${identityB}`);

  // ── 3. Token inválido é recusado ───────────────────────────────────────────
  console.log('\n3. Token forjado');
  const forged = lkToken.mintAccessToken({
    apiKey: API_KEY, apiSecret: 'secret_errado_forjado', room: ROOM,
    identity: lkToken.participantIdentity(0xdeadbeef)
  });
  let forgedRejected = false;
  const roomForged = new Room();
  try {
    await roomForged.connect(URL, forged, { autoSubscribe: false });
    await roomForged.disconnect();
  } catch (err) {
    forgedRejected = true;
    record('token assinado com secret errado é recusado', true, String(err.message).slice(0, 60));
  }
  if (!forgedRejected) record('token assinado com secret errado é recusado', false, 'ACEITOU — furo grave');

  // ── 4. Publicar áudio de A ─────────────────────────────────────────────────
  console.log('\n4. Áudio A → SFU → B');
  const source = new AudioSource(SAMPLE_RATE, CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('mic-a', source);
  const opts = new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE });
  const publication = await roomA.localParticipant.publishTrack(track, opts);
  record('A publicou faixa de microfone', Boolean(publication), `sid=${publication.sid}`);

  // A bomba de quadros tem um interruptor de PTT separado do de encerramento.
  // É a distinção que importa: soltar o PTT **para de capturar**, não desfaz a
  // publicação — refazer a faixa a cada sílaba custaria uma renegociação com o
  // SFU por aperto de tecla.
  let phase = 0;
  let pushing = true;
  let pttDown = true;
  const pump = (async () => {
    while (pushing) {
      const t = makeToneFrame(phase);
      phase = t.phase;
      if (pttDown) {
        await source.captureFrame(t.frame);
      } else {
        // Silêncio real no lugar do tom: o Opus com DTX para de transmitir
        // sozinho quando a entrada é silêncio, que é exatamente o que um PTT
        // solto deve produzir no fio.
        const quiet = new Int16Array(SAMPLES_PER_FRAME);
        await source.captureFrame(
          new AudioFrame(quiet, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME)
        );
      }
    }
  })();

  await sleep(3000);

  record('B assinou a faixa de A', trackSubscribedOnB);
  record('B recebeu quadros de áudio', heardOnB.frames > 0, `${heardOnB.frames} quadros`);

  const heardSamples = heardOnB.samples.slice(-SAMPLE_RATE);
  const heardRms = rms(heardSamples);
  const e440 = energyAt(heardSamples, TONE_HZ);
  const e1000 = energyAt(heardSamples, 1000);
  const ratio = e1000 > 0 ? e440 / e1000 : Infinity;

  record(
    'o sinal recebido tem energia',
    heardRms > 0.01,
    `RMS ${heardRms.toFixed(4)} (teórico ${(TONE_AMPLITUDE / Math.SQRT2).toFixed(4)} antes do Opus)`
  );
  record(
    'a energia está em 440Hz, não espalhada',
    ratio > 10,
    `440Hz/1000Hz = ${ratio.toFixed(1)}x`
  );

  // ── 5. PTT e mute ──────────────────────────────────────────────────────────
  console.log('\n5. PTT e mute');
  // Nota de SDK, registrada porque é fácil concluir errado: o `@livekit/rtc-node`
  // expõe `publication.muted` apenas como leitura — não há `mute()`. Mutar pelo
  // lado que publica é API do SDK **JS de navegador**
  // (`localParticipant.setMicrophoneEnabled(false)`) e do servidor
  // (`MutePublishedTrack`). Não é uma limitação do LiveKit; é da superfície
  // deste SDK, e por isso o PTT aqui é provado pela primitiva que existe nos
  // dois mundos: parar de capturar.
  pttDown = false;
  await sleep(1500);
  heardOnB.samples.length = 0;
  await sleep(1500);
  const pttUpRms = rms(heardOnB.samples.slice(-SAMPLE_RATE));
  record(
    'PTT solto: o sinal em B vai a silêncio',
    pttUpRms < 0.01,
    `RMS ${pttUpRms.toFixed(5)}`
  );

  pttDown = true;
  await sleep(1500);
  const pttDownRms = rms(heardOnB.samples.slice(-SAMPLE_RATE / 2));
  record('PTT apertado: o sinal volta', pttDownRms > 0.01, `RMS ${pttDownRms.toFixed(4)}`);

  // Mute duro = retirar a publicação. B deve deixar de ter faixa nenhuma, não
  // apenas deixar de ouvir — é a diferença entre "não estou falando" e "não
  // tenho microfone nesta cena".
  let unsubscribedOnB = false;
  roomB.on(RoomEvent.TrackUnsubscribed, () => { unsubscribedOnB = true; });
  await roomA.localParticipant.unpublishTrack(publication.sid);
  await sleep(1500);
  record('mute duro (unpublish) remove a faixa em B', unsubscribedOnB);
  record(
    'eventos de mute do SDK observados',
    mutedSeenOnB || unmutedSeenOnB || unsubscribedOnB,
    'rtc-node não emite TrackMuted sem mute do publicador'
  );

  // ── 6. Câmera bloqueada ────────────────────────────────────────────────────
  console.log('\n6. Câmera');
  // O token declara `canPublishSources: ['microphone']`. A prova é o servidor
  // recusar, não a UI deixar de pedir — quem depende da boa vontade do cliente
  // não tem restrição, tem convenção.
  //
  // ATENÇÃO ao formato da recusa: o LiveKit **não** devolve erro de permissão.
  // Ele ignora a publicação e o cliente estoura por timeout (~10s). Um timeout
  // sozinho é evidência ambígua — poderia ser o `VideoSource` sem quadros, e
  // não a permissão. Por isso o controle abaixo é parte do teste, e não uma
  // conferência que alguém fez uma vez e jogou fora.
  const tryPublishCamera = async (label, token) => {
    const room = new Room();
    await room.connect(URL, token, { autoSubscribe: false, dynacast: false });
    const vsource = new VideoSource(320, 240);
    const vtrack = LocalVideoTrack.createVideoTrack(`cam-${label}`, vsource);
    const t0 = Date.now();
    try {
      const pub = await room.localParticipant.publishTrack(
        vtrack, new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA })
      );
      await room.disconnect();
      return { published: true, ms: Date.now() - t0, detail: `sid=${pub.sid}` };
    } catch (err) {
      await room.disconnect().catch(() => {});
      return { published: false, ms: Date.now() - t0, detail: String(err.message).slice(0, 50) };
    }
  };

  const restricted = await tryPublishCamera('restrito', lkToken.mintAccessToken({
    apiKey: API_KEY, apiSecret: API_SECRET, room: ROOM,
    identity: lkToken.participantIdentity(0xff00ca01)
  }));
  // Controle: token idêntico, exceto por não restringir `canPublishSources`.
  // Se ESTE também falhasse, o teste de cima não estaria medindo permissão.
  const control = await tryPublishCamera('controle', mintPermissiveTokenForControl(ROOM));

  record(
    'token restrito não consegue publicar câmera',
    restricted.published === false,
    `${restricted.detail} (${restricted.ms}ms)`
  );
  record(
    'CONTROLE: o mesmo publish passa sem a restrição',
    control.published === true,
    control.published
      ? `publicou em ${control.ms}ms — logo a recusa acima é da permissão`
      : 'controle também falhou: o teste acima NÃO prova permissão'
  );

  // ── 7. Reconexão ───────────────────────────────────────────────────────────
  console.log('\n7. Reconexão');
  pushing = false;
  await pump.catch(() => {});
  await roomA.disconnect();
  await sleep(1000);

  const roomA2 = new Room();
  const identityA2 = lkToken.participantIdentity(ACTOR_A);
  const tokenA2 = lkToken.mintAccessToken({
    apiKey: API_KEY, apiSecret: API_SECRET, room: ROOM,
    identity: identityA2, name: 'Cliente A'
  });
  await roomA2.connect(URL, tokenA2, { autoSubscribe: true, dynacast: false });

  const source2 = new AudioSource(SAMPLE_RATE, CHANNELS);
  const track2 = LocalAudioTrack.createAudioTrack('mic-a2', source2);
  await roomA2.localParticipant.publishTrack(
    track2, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })
  );

  heardOnB.samples.length = 0;
  const framesBeforeRejoin = heardOnB.frames;

  let phase2 = 0;
  let pushing2 = true;
  const pump2 = (async () => {
    while (pushing2) {
      const t = makeToneFrame(phase2);
      phase2 = t.phase;
      await source2.captureFrame(t.frame);
    }
  })();

  await sleep(3000);
  const rejoinRms = rms(heardOnB.samples.slice(-SAMPLE_RATE));
  record(
    'A volta com token novo e B volta a ouvir',
    heardOnB.frames > framesBeforeRejoin && rejoinRms > 0.01,
    `RMS ${rejoinRms.toFixed(4)}, +${heardOnB.frames - framesBeforeRejoin} quadros`
  );
  record(
    'a identidade da reconexão é nova',
    identityA2 !== identityA,
    'evita que a reentrada derrube a própria sessão anterior'
  );
  record('actorId sobrevive à troca de identidade',
    lkToken.actorIdFromIdentity(identityA2) === ACTOR_A,
    `${lkToken.actorIdFromIdentity(identityA2)} === ${ACTOR_A}`);

  record('qualidade de conexão reportada pelo SFU', qualitySeen !== null,
    qualitySeen !== null ? `valor=${qualitySeen}` : 'nenhum evento observado');

  // ── 8. LiveKit fora do ar ──────────────────────────────────────────────────
  console.log('\n8. LiveKit indisponível');
  // A pergunta é se a falha é *capturável*. Um transporte que derruba o
  // processo levaria o servidor de jogo junto — e o jogo tem que continuar
  // quando a voz cai, não o contrário.
  let deadHandled = false;
  let deadDetail = '';
  const roomDead = new Room();
  try {
    const deadToken = lkToken.mintAccessToken({
      apiKey: API_KEY, apiSecret: API_SECRET, room: ROOM,
      identity: lkToken.participantIdentity(0xff00dead)
    });
    await roomDead.connect('ws://127.0.0.1:1', deadToken, { autoSubscribe: false });
  } catch (err) {
    deadHandled = true;
    deadDetail = String(err.message).slice(0, 60);
  }
  record('servidor inalcançável falha de forma capturável', deadHandled, deadDetail);

  // ── encerramento ───────────────────────────────────────────────────────────
  pushing2 = false;
  await pump2.catch(() => {});
  await roomA2.disconnect();
  await roomB.disconnect();

  console.log('\n─────────────────────────────────────────');
  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false).length;
  console.log(`${pass} passaram, ${fail} falharam, ${results.length} verificações`);
  console.log('\nNÃO PROVADO por este spike (exige pessoa/jogo, não código):');
  console.log('  - voz inteligível ao ouvido humano');
  console.log('  - dois clientes Skyrim reais');
  console.log('  - captura pela CEF ou pelo voice-helper');
  console.log('  - origem não autorizada sem acesso ao microfone (é do CefPermissionHandler)');
  console.log('  - rede real: latência, perda e jitter fora de 127.0.0.1');

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSPIKE ABORTADO:', err);
  process.exit(1);
});

/**
 * core/voice/voice-endpoint.js
 *
 * VoiceEndpoint — **quem captura o microfone, e nada além disso.**
 *
 * ## O problema que esta abstração existe para resolver
 *
 * Hoje o projeto tem um caminho de voz só, e ele sabe demais sobre si mesmo: o
 * `voip-service.js` conhece o formato PCM no fio, o papel `sender`, o teto de
 * base64 e o relay por WebSocket. Nada disso é *regra de voz* — é detalhe de
 * **como aquele microfone específico chega até o servidor**.
 *
 * A migração para LiveKit troca exatamente esse detalhe, e ele pode ser trocado
 * de duas formas que ainda não dá para escolher entre si com dados:
 *
 *   - **CEF**: `getUserMedia` dentro da UI do jogo, publicando com o SDK JS do
 *     LiveKit. Depende de o client expor um `CefPermissionHandler` seguro —
 *     tecnicamente possível na CEF 108 que o SkyMP usa (auditoria §5), mas
 *     exige um build de client nosso.
 *   - **Nativo**: WASAPI no `voice-helper/`, publicando com o SDK C++ do
 *     LiveKit. Não depende de patch de client nenhum, e é o Plano B se o
 *     caminho CEF não fechar com segurança.
 *
 * Se o resto do sistema perguntar "é CEF ou é nativo?", cada resposta nova
 * espalha um `if` por mais um arquivo, e a decisão entre A e B vira uma
 * refatoração em vez de uma troca de configuração. Este módulo é a costura que
 * impede isso: o resto do sistema pergunta **capacidades**, nunca **identidade**.
 *
 * ## O que continua sendo do SkyMP, e não do endpoint
 *
 * O endpoint diz de onde vêm os bytes do microfone. Ele **não** decide:
 *
 *   - quem ouve quem (proximidade — `voip-service.tickProximity`);
 *   - com que volume (mesma conta, mesma tabela `VOICE_RANGES`);
 *   - se a pessoa está muda (`muted`, que é do ator);
 *   - o alcance do modo de voz (`voiceMode`).
 *
 * Isso é regra de mundo, é autoridade do servidor de jogo, e não muda quando o
 * transporte muda. O LiveKit transporta; o SkyMP manda. Ver
 * `docs/technical/SKYVOICE_LIVEKIT_AUDIT.md` §7.
 *
 * ## Estado
 *
 * Isto é **andaime de migração**, declarado agora para que a decisão CEF-vs-
 * nativo não precise ser tomada antes da hora. Só `legacy-relay` tem
 * implementação de verdade hoje; os dois endpoints LiveKit descrevem o contrato
 * que a implementação terá que cumprir, e são exercitados pelo spike em
 * `spikes/skyvoice-livekit/`. Nada aqui captura áudio sozinho.
 */

/**
 * Como o áudio chega do microfone de uma pessoa até o resto do mundo.
 * @typedef {'ws-pcm-relay'|'livekit-sfu'} VoiceTransport
 */

/**
 * Onde o microfone é aberto.
 * @typedef {'cef'|'native-helper'} VoiceCaptureSite
 */

/**
 * Descritor de um endpoint de voz.
 *
 * É deliberadamente um objeto de dados congelado, e não uma classe com métodos
 * a sobrescrever. Um endpoint não *faz* nada aqui — ele **declara** o que exige
 * e o que oferece, e quem age (o serviço de voz, o emissor de token, o
 * launcher) lê essa declaração. Herança daria a cada endpoint um lugar para
 * esconder comportamento, que é justamente o que esta costura quer evitar.
 *
 * @typedef {object} VoiceEndpoint
 * @property {string} id
 * @property {VoiceTransport} transport
 * @property {VoiceCaptureSite} capturesAt
 * @property {boolean} requiresClientPatch    exige build de client nosso?
 * @property {boolean} requiresExternalProcess exige processo fora do jogo?
 * @property {boolean} carriesAudioThroughGameServer  o áudio passa pelo servidor de jogo?
 * @property {boolean} implemented            existe implementação hoje?
 * @property {string} rationale               por que este endpoint existe
 */

/**
 * O caminho atual: helper nativo → WebSocket → `voip-service` → UI.
 *
 * `carriesAudioThroughGameServer: true` é a propriedade que o resto do sistema
 * realmente precisa saber sobre ele, e é a que dói: o processo Node do gamemode
 * multiplica cada quadro pela audiência. É o custo registrado no
 * `TASK_005_VOIP_CAPACITY_AND_SECURITY.md`, e é o motivo de existir migração.
 */
const LEGACY_RELAY = Object.freeze({
  id: 'legacy-relay',
  transport: 'ws-pcm-relay',
  capturesAt: 'native-helper',
  requiresClientPatch: false,
  requiresExternalProcess: true,
  carriesAudioThroughGameServer: true,
  implemented: true,
  rationale:
    'Caminho provado até o transporte (VOICE_NATIVE_HELPER.md §7/§8.4). ' +
    'Não escala: PCM cru re-serializado por ouvinte, dentro do processo do jogo.'
});

/**
 * Plano A: captura na UI do jogo, dentro da CEF, publicando no LiveKit.
 *
 * `requiresClientPatch: true` é a única razão de este não ser obviamente o
 * escolhido. A CEF 108 do SkyMP **tem** a API para conceder microfone com
 * escopo (`CefPermissionHandler::OnRequestMediaAccessPermission`, verificado na
 * auditoria §5), mas o `OverlayClient` do client oficial não a implementa — e
 * sem implementá-la o padrão do runtime alloy é negar. Usar isto exige
 * distribuir um client nosso.
 *
 * Não confundir com o patch descartado do `VOICE_CLIENT_PATCH.md`: aquele ligava
 * flags globais de linha de comando que liberam microfone **e câmera** para
 * **qualquer origem**. Este endpoint pressupõe o contrário — um handler que
 * responde origem por origem e só concede `AUDIO_CAPTURE`.
 */
const CEF_LIVEKIT = Object.freeze({
  id: 'cef-livekit',
  transport: 'livekit-sfu',
  capturesAt: 'cef',
  requiresClientPatch: true,
  requiresExternalProcess: false,
  carriesAudioThroughGameServer: false,
  implemented: false,
  rationale:
    'Sem processo extra para o jogador. Exige CefPermissionHandler com escopo ' +
    'de origem e só AUDIO_CAPTURE, num build de client nosso.'
});

/**
 * Plano B: WASAPI no `voice-helper/`, publicando com o SDK C++ do LiveKit.
 *
 * Existe porque o Plano A depende de um build de client, e um plano que depende
 * de uma coisa que ainda não temos não é um plano — é uma aposta. Este reusa o
 * `voice-helper/` que já compila e já capturou áudio real (VOICE_NATIVE_HELPER
 * §8.4): o que muda é para onde os quadros vão, não como são capturados.
 *
 * É também o motivo de o `voice-helper/` não ser apagado nesta migração.
 */
const NATIVE_LIVEKIT = Object.freeze({
  id: 'native-livekit',
  transport: 'livekit-sfu',
  capturesAt: 'native-helper',
  requiresClientPatch: false,
  requiresExternalProcess: true,
  carriesAudioThroughGameServer: false,
  implemented: false,
  rationale:
    'Não depende de build de client. Reaproveita a captura WASAPI já provada ' +
    'do voice-helper, trocando o destino dos quadros para o SDK C++ do LiveKit.'
});

const ENDPOINTS = Object.freeze({
  [LEGACY_RELAY.id]: LEGACY_RELAY,
  [CEF_LIVEKIT.id]: CEF_LIVEKIT,
  [NATIVE_LIVEKIT.id]: NATIVE_LIVEKIT
});

/** Backends de voz selecionáveis por `VOICE_BACKEND`. */
const BACKENDS = Object.freeze({
  legacy: Object.freeze({
    id: 'legacy',
    endpoints: Object.freeze([LEGACY_RELAY.id])
  }),
  livekit: Object.freeze({
    id: 'livekit',
    // Os dois endpoints LiveKit convivem de propósito: a sala é a mesma e o
    // transporte é o mesmo, então um jogador com client patchado e outro com
    // helper nativo se ouvem sem que nenhum dos dois saiba do outro. É essa
    // propriedade que permite migrar sem um corte — e é ela que se perderia se
    // o resto do sistema perguntasse "CEF ou nativo?".
    endpoints: Object.freeze([CEF_LIVEKIT.id, NATIVE_LIVEKIT.id])
  })
});

const DEFAULT_BACKEND = 'legacy';

/**
 * Backend de voz em vigor, lido de `VOICE_BACKEND`.
 *
 * **Padrão `legacy`, e a leitura é por chamada.** O padrão é o caminho que já
 * existe porque uma migração que começa ligada não é uma migração, é uma troca:
 * quem não configurou nada continua exatamente onde estava. E ler por chamada,
 * em vez de uma vez no load, é o mesmo motivo do `VOIP_DEBUG_EXPOSE_TICKET` —
 * uma flag que só muda reiniciando o servidor é uma flag que alguém deixa no
 * estado errado para não ter que reiniciar de novo.
 *
 * Valor desconhecido cai no padrão **e avisa**. Cair calado faria um erro de
 * digitação (`VOICE_BACKEND=livekt`) rodar o servidor inteiro no backend antigo
 * com todo mundo achando que migrou.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'legacy'|'livekit'}
 */
function resolveBackend(env = process.env) {
  const raw = env.VOICE_BACKEND;
  if (raw === undefined || raw === '') return DEFAULT_BACKEND;
  if (Object.prototype.hasOwnProperty.call(BACKENDS, raw)) {
    return /** @type {'legacy'|'livekit'} */ (raw);
  }
  console.warn(
    `[voice] VOICE_BACKEND='${raw}' não é um backend conhecido ` +
    `(${Object.keys(BACKENDS).join(', ')}); usando '${DEFAULT_BACKEND}'.`
  );
  return DEFAULT_BACKEND;
}

/**
 * Os endpoints admitidos pelo backend em vigor.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {VoiceEndpoint[]}
 */
function activeEndpoints(env = process.env) {
  return BACKENDS[resolveBackend(env)].endpoints.map((id) => ENDPOINTS[id]);
}

/**
 * True quando o áudio ainda passa dentro do processo do servidor de jogo.
 *
 * Esta é a **única** pergunta que o `voip-service` precisa fazer para saber se
 * deve se comportar como relay, e ela é sobre uma propriedade do transporte —
 * não sobre qual endpoint está ativo. É essa diferença que mantém a decisão
 * CEF-vs-nativo fora do resto do código.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function relaysAudioThroughGameServer(env = process.env) {
  return activeEndpoints(env).some((e) => e.carriesAudioThroughGameServer);
}

/**
 * True quando algum endpoint ativo ainda não tem implementação.
 *
 * Existe para o boot poder dizer isso em voz alta. Ligar `VOICE_BACKEND=livekit`
 * hoje é pedir um caminho que ainda não captura áudio; o servidor deve subir
 * assim mesmo (é o que torna o spike possível) e deve ser explícito sobre o que
 * a pessoa acabou de ligar.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function hasUnimplementedEndpoint(env = process.env) {
  return activeEndpoints(env).some((e) => !e.implemented);
}

/**
 * Resumo legível do estado da voz, para o log de boot e diagnóstico.
 * @param {NodeJS.ProcessEnv} [env]
 */
function describeBackend(env = process.env) {
  const backend = resolveBackend(env);
  const endpoints = activeEndpoints(env);
  return {
    backend,
    endpoints: endpoints.map((e) => e.id),
    relaysAudioThroughGameServer: relaysAudioThroughGameServer(env),
    ready: endpoints.every((e) => e.implemented)
  };
}

module.exports = {
  LEGACY_RELAY,
  CEF_LIVEKIT,
  NATIVE_LIVEKIT,
  ENDPOINTS,
  BACKENDS,
  DEFAULT_BACKEND,
  resolveBackend,
  activeEndpoints,
  relaysAudioThroughGameServer,
  hasUnimplementedEndpoint,
  describeBackend
};

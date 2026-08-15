/**
 * core/voice/livekit-token.js
 *
 * Emissão de access token do LiveKit — SEMPRE no servidor, nunca no cliente.
 *
 * ## Por que este arquivo existe e por que ele é pequeno
 *
 * Um access token do LiveKit é um JWT HS256 comum: header, payload e uma
 * assinatura HMAC-SHA256 feita com o **API secret**. Não há nada de proprietário
 * no formato — o que existe de proprietário é o *conteúdo* do claim `video`.
 *
 * Por isso não puxamos `livekit-server-sdk`. Assinar um JWT HS256 é uma chamada
 * de `crypto.createHmac`, e o gamemode roda dentro do Node embutido pelo SkyMP,
 * onde cada dependência nova é uma dependência que alguém precisa auditar,
 * empacotar e atualizar. O mesmo raciocínio que fez o `voice-helper/src/main.cpp`
 * escrever base64 à mão em vez de arrastar mais uma port do vcpkg.
 *
 * O preço dessa escolha é que o formato do claim `video` é responsabilidade
 * nossa. Ele está travado por teste contra um `livekit-server` **real** — ver
 * `spikes/skyvoice-livekit/`, que sobe o servidor oficial e confirma que o token
 * emitido aqui é aceito. Um token que "parece certo" e é recusado pelo servidor
 * seria exatamente o tipo de defeito que compilar não pega.
 *
 * ## A regra que não pode ser quebrada
 *
 * **O API secret nunca sai deste processo.** Ele entra por `LIVEKIT_API_SECRET`,
 * é usado para assinar, e o que viaja para o cliente é o JWT — que já é o
 * resultado da assinatura, não o insumo dela. Um cliente com o secret pode
 * forjar qualquer identidade em qualquer sala; um cliente com um JWT pode
 * apenas ser quem o servidor disse que ele é, até o token expirar.
 *
 * Isto espelha o que o `voip-service.issueTicket` já fazia no caminho legado: o
 * servidor emite, o cliente apresenta. A diferença é só o formato do papel.
 *
 * ## O que o token NÃO decide
 *
 * O token concede *acesso ao transporte*. Ele não diz quem ouve quem — isso é
 * proximidade, é regra de mundo, e é do SkyMP (`voip-service.tickProximity`).
 * Ver `docs/technical/SKYVOICE_LIVEKIT_AUDIT.md` §7.
 */

const crypto = require('crypto');

/**
 * Vida útil do token, em segundos.
 *
 * Curto de propósito: o token é um crachá de entrada, não uma sessão. O cliente
 * o usa para abrir a conexão e o LiveKit mantém a sessão viva depois disso —
 * `exp` não derruba quem já está dentro, só impede uma entrada nova. Seis
 * minutos dão folga para o handshake e para uma reconexão imediata sem manter
 * um crachá válido esquecido em disco ou em log.
 *
 * Reconexão longa (cabo caiu, jogador voltou dez minutos depois) pede um token
 * novo, e pedir é barato: é o mesmo caminho do `/voz`.
 */
const DEFAULT_TTL_SECONDS = 360;

/** Folga de relógio aceita para trás no `nbf`. */
const CLOCK_SKEW_SECONDS = 10;

function _b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Identidade do participante no LiveKit.
 *
 * **Sempre derivada do actorId pelo servidor, nunca escolhida pelo cliente.** A
 * identidade é o que o LiveKit repete para todos os outros participantes na
 * sala; se o cliente pudesse escolhê-la, ele escolheria a de outra pessoa, e
 * todo mundo veria a voz dele rotulada com o nome alheio. É o mesmo furo que o
 * ticket de uso único fecha no `auth` do caminho legado, e fecha aqui pelo mesmo
 * motivo: quem afirma a identidade é quem já sabe quem você é.
 *
 * O sufixo de sessão existe porque o LiveKit trata identidade como chave única
 * na sala — um segundo participante com a mesma identidade **derruba o
 * primeiro**. Sem o sufixo, uma reconexão rápida (antes de o servidor perceber
 * que a anterior morreu) expulsaria a própria conexão que está entrando.
 *
 * @param {number} actorId
 * @param {string} [sessionNonce] identificador curto desta tentativa de conexão
 * @returns {string}
 */
function participantIdentity(actorId, sessionNonce) {
  const nonce = sessionNonce || crypto.randomBytes(4).toString('hex');
  return `actor-${actorId}-${nonce}`;
}

/**
 * Extrai o actorId de uma identidade emitida por `participantIdentity`.
 *
 * Existe para o lado que **recebe**: ao ver um participante na sala, o cliente
 * precisa saber a que ator aquela voz pertence para aplicar o ganho de
 * proximidade que o SkyMP mandou. Devolve `null` para qualquer coisa que não
 * tenha o formato — uma identidade que não reconhecemos não é um ator nosso, e
 * adivinhar seria pior do que admitir que não sabemos.
 *
 * @param {string} identity
 * @returns {number|null}
 */
function actorIdFromIdentity(identity) {
  if (typeof identity !== 'string') return null;
  const m = /^actor-(\d+)-[0-9a-f]+$/.exec(identity);
  if (!m) return null;
  const actorId = Number.parseInt(m[1], 10);
  return Number.isFinite(actorId) ? actorId : null;
}

/**
 * Monta e assina um access token do LiveKit.
 *
 * @param {object} opts
 * @param {string} opts.apiKey            LIVEKIT_API_KEY
 * @param {string} opts.apiSecret         LIVEKIT_API_SECRET — nunca sai daqui
 * @param {string} opts.room              sala (uma por cena de voz)
 * @param {string} opts.identity          identidade — use `participantIdentity`
 * @param {string} [opts.name]            nome exibível (personagem)
 * @param {boolean} [opts.canPublish]     pode falar (padrão: true)
 * @param {boolean} [opts.canSubscribe]   pode ouvir (padrão: true)
 * @param {number} [opts.ttlSeconds]
 * @param {number} [opts.now]             injetável por teste
 * @returns {string} JWT compacto
 */
function mintAccessToken(opts) {
  const {
    apiKey,
    apiSecret,
    room,
    identity,
    name,
    canPublish = true,
    canSubscribe = true,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    now = Date.now()
  } = opts || {};

  // Falhar alto e cedo. Um token assinado com secret vazio é aceito por
  // `createHmac` sem reclamar e recusado pelo servidor lá na frente, longe
  // daqui — o erro apareceria como "voz não conecta", que é o sintoma mais
  // caro de diagnosticar.
  if (!apiKey) throw new Error('[livekit-token] apiKey ausente');
  if (!apiSecret) throw new Error('[livekit-token] apiSecret ausente');
  if (!room) throw new Error('[livekit-token] room ausente');
  if (!identity) throw new Error('[livekit-token] identity ausente');

  const nowSec = Math.floor(now / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };

  const payload = {
    iss: apiKey,               // quem emitiu — o LiveKit acha o secret por aqui
    sub: identity,             // o LiveKit lê a identidade do `sub`
    nbf: nowSec - CLOCK_SKEW_SECONDS,
    exp: nowSec + ttlSeconds,
    jti: crypto.randomBytes(8).toString('hex'),
    ...(name ? { name } : {}),
    video: {
      // `roomJoin` + `room` prendem o token a UMA sala. Sem `room`, um token
      // vazado entra em qualquer cena de voz do servidor.
      roomJoin: true,
      room,
      canPublish,
      canSubscribe,

      // Negados explicitamente, e não por omissão. São os direitos que
      // transformariam um jogador em operador da sala: `roomAdmin` mexe em
      // quem está dentro, `roomCreate` cria salas fora do controle do
      // gamemode, `canPublishData` abre um canal de mensagens entre clientes
      // que o SkyMP não vê — e o SkyMP é quem manda nas regras do mundo.
      // Escrever `false` em vez de omitir é para que uma leitura do token
      // responda a pergunta, em vez de exigir que alguém saiba o padrão.
      canPublishData: false,
      canUpdateOwnMetadata: false,
      roomAdmin: false,
      roomCreate: false,
      roomList: false,
      roomRecord: false,

      // Só áudio. Um cliente com este token que tente publicar vídeo é
      // recusado pelo próprio servidor, não pela boa vontade da UI — a câmera
      // fica bloqueada em duas camadas independentes (aqui e no
      // CefPermissionHandler; ver a auditoria §5 e §8).
      canPublishSources: ['microphone']
    }
  };

  const signingInput = `${_b64url(JSON.stringify(header))}.${_b64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', apiSecret).update(signingInput).digest();

  return `${signingInput}.${_b64url(signature)}`;
}

/**
 * Decodifica o payload de um token SEM verificar a assinatura.
 *
 * Para teste e diagnóstico apenas. Não use isto para tomar decisão de
 * autorização: quem verifica assinatura de token do LiveKit é o
 * `livekit-server`, e reimplementar essa verificação aqui criaria uma segunda
 * opinião sobre quem tem acesso — duas autoridades sobre a mesma pergunta é o
 * mesmo defeito que a tabela de raios duplicada de `proximity-ranges.js`.
 *
 * @param {string} token
 * @returns {object|null}
 */
function decodePayloadUnsafe(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  mintAccessToken,
  participantIdentity,
  actorIdFromIdentity,
  decodePayloadUnsafe,
  DEFAULT_TTL_SECONDS
};

/**
 * core/proximity-ranges.js
 *
 * Fonte única dos raios de proximidade (em unidades do Skyrim).
 *
 * Antes desta consolidação existiam três tabelas de raio que discordavam entre
 * si e nenhuma delas era autoridade sobre as outras:
 *
 *   - `rp-chat-service.js`  → whisper 450, say 1200, emote 1500, ooc 2000, shout 3500
 *   - `voip-service.js`     → whisper 200, normal 1200, shout 3000
 *   - `server-options.*.json` → whisperRange 350, localRange 1400, shoutRange 3000
 *
 * O efeito prático era um bug de RP silencioso: um jogador dentro do alcance do
 * sussurro escrito ficava fora do alcance do sussurro falado, e vice-versa —
 * então o mesmo gesto de "chegar perto pra falar baixo" funcionava ou não
 * dependendo do canal que a pessoa escolhesse.
 *
 * A tabela abaixo é a que vale. Os valores vieram do `rp-chat-service.js`, que
 * é o único dos três que estava de fato em uso e com testes.
 *
 * IMPORTANTE: os três raios de chat vêm do `server-options.<env>.json` — mexer
 * no JSON altera o jogo. É `core/server-options.js` que o lê, valida e aplica
 * os defaults; `emote` e `ooc` continuam derivados aqui, de propósito (ver a
 * nota logo abaixo).
 *
 * Até 06/08/2026 este cabeçalho dizia o contrário — que o JSON não era lido por
 * ninguém e que se devia "mexer aqui". Era verdade quando o `QA_REPORT_2026-08`
 * registrou o achado, e deixou de ser quando o `core/server-options.js` nasceu;
 * o comentário ficou. Um comentário obsoleto sobre configuração é a mesma
 * classe de defeito que a configuração que ninguém lê: nos dois casos alguém
 * edita um lugar e o jogo não muda. Só que este mandava editar o lugar errado.
 */

const serverOptions = require('./server-options');

// Três raios vêm de `chat.*` no server-options; `emote` e `ooc` são derivados.
// Derivar em vez de configurar é deliberado: são canais de apoio, e a relação
// entre eles e a fala normal ("emote alcança um pouco mais porque ação é
// visual", "OOC alcança mais porque é suporte, não cena") é uma decisão de
// design do servidor, não um botão que cada operador deveria mexer sozinho.
const say = serverOptions.get('chat.localRange');

const RANGES = Object.freeze({
  /** Sussurro: precisa estar praticamente encostado. */
  whisper: serverOptions.get('chat.whisperRange'),
  /** Fala normal (`/falar`, e a voz por proximidade em modo normal). */
  say,
  /** Emotes (`/me`, `/do`): um pouco mais largo que a fala, porque ação é visual. */
  emote: Math.round((say * 5) / 4),
  /** OOC: mais largo de propósito, é canal de suporte e não de cena. */
  ooc: Math.round((say * 5) / 3),
  /** Grito: o mais largo, mas ainda longe de ser global. */
  shout: serverOptions.get('chat.shoutRange')
});

/**
 * Raios de voz, por modo. Espelham os do chat de propósito — `normal` é o
 * mesmo alcance de `say` pra que falar e escrever cheguem nas mesmas pessoas.
 * `emote` e `ooc` não existem em voz (não se emota por microfone).
 */
const VOICE_RANGES = Object.freeze({
  whisper: RANGES.whisper,
  normal: RANGES.say,
  shout: RANGES.shout
});

module.exports = { RANGES, VOICE_RANGES };

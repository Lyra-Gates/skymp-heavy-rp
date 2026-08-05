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
 * IMPORTANTE: `server-options.*.json` NÃO é lido por nenhum código do gamemode
 * (ver docs/technical/QA_REPORT_2026-08.md). Enquanto isso não mudar, mexer no
 * JSON não altera nada em jogo — mexa aqui.
 */

const RANGES = Object.freeze({
  /** Sussurro: precisa estar praticamente encostado. */
  whisper: 450,
  /** Fala normal (`/falar`, e a voz por proximidade em modo normal). */
  say: 1200,
  /** Emotes (`/me`, `/do`): um pouco mais largo que a fala, porque ação é visual. */
  emote: 1500,
  /** OOC: mais largo de propósito, é canal de suporte e não de cena. */
  ooc: 2000,
  /** Grito: o mais largo, mas ainda longe de ser global. */
  shout: 3500
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

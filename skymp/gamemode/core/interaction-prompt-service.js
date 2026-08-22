/**
 * core/interaction-prompt-service.js
 *
 * Tarefa 11 (Contextual Action Label — o prompt `[E]`), V1.
 *
 * ─── Por que não é raycast ──────────────────────────────────────────────────
 *
 * O brief original pedia "raycast" pra saber quando o jogador está OLHANDO
 * pra um alvo. Isso não existe neste projeto: `docs/research/
 * SKYMP_ARCHITECTURE_PATTERNS.md` lista `Camera`/`Input`/raycast como
 * "extensões de API nativa" que exigem fork do SkyMP — trabalho de engenharia
 * de cliente C++, não desta tarefa. Decisão tomada com o dono do produto:
 * fallback por PROXIMIDADE, o mesmo padrão que `nametag-service.js` já usa
 * pra escolher "a pessoa mais próxima" — não "a pessoa que você está
 * encarando".
 *
 * ─── Ator por proximidade real, objeto por âncora conhecida ─────────────────
 *
 * Não existe em nenhum lugar do projeto (nem no SkyMP) uma função "liste
 * objetos interativos perto do ponto X" — sem fork, o motor não expõe isso.
 * O que existe são tabelas pequenas e curadas por staff de âncoras físicas
 * JÁ CONHECIDAS (`depot_terminals` é a primeira). `core/physical-anchor-
 * registry.js` é o ponto onde um módulo desses (Depot, e no futuro outros)
 * se anuncia; este arquivo pergunta a ele "quais âncoras existem", filtra
 * por distância do mesmo jeito que filtra atores, e o objeto mais próximo
 * compete com o ator mais próximo pelo único prompt da tela — vence quem
 * estiver mais perto (sem vetor de visão: o motor não expõe "pra onde o
 * jogador olha" sem raycast, mesma ressalva do parágrafo anterior).
 *
 * ─── Por que `peek`, não `query` ────────────────────────────────────────────
 *
 * `interaction-service.js query()` tem rate limit embutido (o mesmo que a
 * CEF consome de verdade ao abrir o menu). Rodar isto num tick de servidor a
 * cada 2s por jogador ativo, se passasse por `query()`, gastaria o MESMO
 * orçamento — e um jogador que abrisse o menu de verdade logo depois do tick
 * poderia ser recusado por um limite que ele nunca tocou. `peek()` faz o
 * mesmo cálculo sem consumir aquele orçamento — ver `interaction-service.js`.
 *
 * ─── Cadência ────────────────────────────────────────────────────────────
 *
 * 2s, o mesmo tick de `nametag-service.js` e da voz — mesma classe de custo
 * (O(n) por tick, `range-utils.nearbyActors` usando `neighbors` nativo, sem
 * consulta a banco). Ao contrário da nametag, este prompt NÃO precisa de
 * projeção mundo→tela por quadro: é um rótulo fixo no centro da tela, então
 * o `updateOwner` da property (registrado em `phase0-basic.js`, mesmo padrão
 * de `browserModal`/`panelData`/`voipTicket`) já é solução completa — sem
 * laço `ctx.sp.on('update', ...)` nenhum.
 *
 * ⚠️ NÃO VALIDADO EM JOGO — mesma ressalva de toda a família de labs deste
 * projeto. `range-utils.nearbyActors` depende de `mp.get(actorId,
 * 'neighbors')`, que este arquivo nunca chamou de verdade contra um servidor
 * SkyMP real.
 */

'use strict';

const commands = require('./commands');
const rangeUtils = require('./range-utils');
const { RANGES } = require('./proximity-ranges');
const { TARGET_TYPES } = require('./interaction-registry');
const physicalAnchorRegistry = require('./physical-anchor-registry');

/** Property por onde o alvo e o rótulo chegam ao cliente. */
const PROPERTY = 'interactionPrompt';

/**
 * O trecho que roda NO CLIENTE, dentro do Skyrim Platform — mesmo mecanismo
 * de `nametag-service.js` (string avaliada por `updateOwner`, `ctx.state`
 * persiste entre chamadas). Duas responsabilidades:
 *
 *   1. Repassar `ctx.value` pra CEF (`window.handleInteractionPrompt`) —
 *      igual a `browserModal`/`panelData`/`voipTicket`.
 *   2. Registrar UMA VEZ (guarda em `ctx.state`, mesmo padrão da nametag) um
 *      listener de tecla — objetivo 2 do brief ("ao apertar E, abra o
 *      menu"). Tecla E = scan code DirectInput 18 (0x12).
 *
 * ⚠️ `ctx.sp.on('keyPress', ...)` é documentado pelo SkyMP/Skyrim Platform,
 * mas este projeto NUNCA chamou — mesma classe de suposição não verificada
 * que `worldPointToScreenPoint` é pra nametag (ver o cabeçalho dela). Se o
 * nome do evento ou o scan code estiverem errados, o sintoma é "o prompt
 * aparece mas E não faz nada" — só uma sessão real fecha isso.
 */
const SNIPPET_DO_CLIENTE = `
  ctx.state.interactionPrompt = ctx.state.interactionPrompt || { registrouTecla: false, ultimo: { targetId: null } };
  var ip = ctx.state.interactionPrompt;
  ip.ultimo = ctx.value || { targetId: null };

  var mandarPraTela = function (nomeDaFuncao, payload) {
    if (!ctx.sp || !ctx.sp.browser || !ctx.sp.browser.executeJavaScript) return;
    ctx.sp.browser.executeJavaScript(
      'window.' + nomeDaFuncao + ' && window.' + nomeDaFuncao + '(' + JSON.stringify(payload) + ')'
    );
  };

  mandarPraTela('handleInteractionPrompt', ip.ultimo);

  if (!ip.registrouTecla && ctx.sp && typeof ctx.sp.on === 'function') {
    ip.registrouTecla = true;
    ctx.sp.on('keyPress', function (key) {
      if (key !== 18) return; // E
      if (!ip.ultimo || ip.ultimo.targetId === null || ip.ultimo.targetId === undefined) return;
      mandarPraTela('handleInteractionPromptKey', ip.ultimo);
    });
  }
`;

/** Tick do servidor — mesmo motivo e mesmo valor de `nametag-service.js`. */
const INTERVALO_DO_TICK_MS = 2000;

/**
 * Alcance do prompt. Mesmo critério de `nametag-service.js`: o raio de fala
 * normal (`core/proximity-ranges.js`) é "esta cena" — quem está fora dele não
 * é candidato a interação contextual iminente.
 */
const ALCANCE = RANGES.say;

let _timer = null;

/** Injetado em `configure()` — a instância real vive em `phase0-basic.js`. */
let _interactionService = null;

/** actorId do observador → último payload enviado (JSON), para diffing. */
const _ultimoEnvio = new Map();

/**
 * Cache das âncoras físicas (`depot_terminals` e futuros providers). Elas
 * são curadas por staff, não mudam em velocidade de gameplay — TTL alto de
 * propósito, pra não bater `physical-anchor-registry.listAll()` (que pode
 * envolver uma query por provider) a cada tick de cada jogador.
 */
const ANCORA_CACHE_TTL_MS = 30000;
let _ancorasCache = { at: 0, valor: [] };

async function _obterAncoras() {
  const agora = Date.now();
  if (agora - _ancorasCache.at < ANCORA_CACHE_TTL_MS) return _ancorasCache.valor;
  _ancorasCache = { at: agora, valor: await physicalAnchorRegistry.listAll() };
  return _ancorasCache.valor;
}

/** Só para teste — força o próximo tick a reconsultar o registry. */
function _limparCacheDeAncoras() {
  _ancorasCache = { at: 0, valor: [] };
}

/**
 * Recebe a instância do Interaction Framework já pronta. Não pode ser um
 * `require` direto porque `interaction-service.js` é uma FACTORY
 * (`createInteractionService`) — quem monta a instância real é
 * `phase0-basic.js`, e este módulo não pode montar uma segunda.
 * @param {{interactionService: {peek: Function}}} deps
 */
function configure(deps) {
  _interactionService = (deps && deps.interactionService) || null;
}

/**
 * Ator ativo mais próximo de `observadorActorId`, dentro do alcance e na
 * mesma célula (`range-utils.nearbyActors` já garante os dois).
 * @param {number} observadorActorId
 * @returns {{targetId: number, targetType: string, distance: number}|null}
 */
function _melhorAtor(observadorActorId) {
  const vizinhos = rangeUtils.nearbyActors(observadorActorId, ALCANCE);
  if (vizinhos.length === 0) return null;
  let melhor = vizinhos[0];
  for (const v of vizinhos) {
    if (v.distance < melhor.distance) melhor = v;
  }
  return { targetId: melhor.actorId, targetType: TARGET_TYPES.PLAYER, distance: melhor.distance };
}

/** Compat: só o `targetId`, como antes desta versão cobrir objetos também. */
function escolherAlvo(observadorActorId) {
  const m = _melhorAtor(observadorActorId);
  return m ? m.targetId : null;
}

/**
 * Âncora física mais próxima dentro do alcance, dentre as que
 * `physical-anchor-registry.js` conhece (Depot etc.). Pré-filtro por
 * distância crua (`range-utils.distanceBetween`, sem tocar `canSee`/banco) —
 * a confirmação de verdade (o terminal ainda existe, o alvo é válido)
 * acontece depois, em `peek()`.
 * @param {number} observadorActorId
 * @param {Array<{targetId: number, targetType: string}>} ancoras
 * @returns {{targetId: number, targetType: string, distance: number}|null}
 */
function _melhorAncora(observadorActorId, ancoras) {
  let melhor = null;
  for (const ancora of ancoras) {
    const distancia = rangeUtils.distanceBetween(observadorActorId, ancora.targetId);
    if (distancia === null || distancia > ALCANCE) continue;
    if (!melhor || distancia < melhor.distance) {
      melhor = { targetId: ancora.targetId, targetType: ancora.targetType, distance: distancia };
    }
  }
  return melhor;
}

/**
 * O único candidato que vira prompt: ator mais próximo VERSUS âncora mais
 * próxima, desempate por distância crua. Sem vetor de visão — ver o
 * cabeçalho do arquivo pra por quê.
 */
function _melhorCandidato(observadorActorId, ancoras) {
  const ator = _melhorAtor(observadorActorId);
  const ancora = _melhorAncora(observadorActorId, ancoras);
  if (ator && ancora) return ancora.distance <= ator.distance ? ancora : ator;
  if (ator) return ator;
  if (ancora) return ancora;
  // Objetivo 3: sem ninguém e sem âncora por perto, o próprio jogador é o
  // fallback — `character-dashboard-bridge.js` registra `TARGET_TYPES.SELF`
  // sem `assertRange`, então está sempre "ao alcance" de si mesmo.
  return { targetId: observadorActorId, targetType: TARGET_TYPES.SELF, distance: 0 };
}

/**
 * `[E] <label da única ação>` quando há uma só; `[E] Interagir` quando há
 * mais de uma — regra explícita do brief (objetivo 2, "Action Menu").
 * `null` quando não há nenhuma ação visível pra esse par observador/alvo
 * (o prompt não aparece nesse caso).
 * @param {number} observadorActorId
 * @param {number} alvoId
 * @param {string} [targetType] `TARGET_TYPES.PLAYER` por padrão — objeto
 *   (Depot etc.) passa o próprio tipo da âncora.
 * @returns {Promise<{label: string, count: number}|null>}
 */
async function rotuloParaAlvo(observadorActorId, alvoId, targetType = TARGET_TYPES.PLAYER) {
  if (!_interactionService) return null;
  const resultado = await _interactionService.peek(observadorActorId, {
    targetType,
    targetId: alvoId
  });
  if (!resultado.ok) return null;

  const acoes = resultado.sections.flatMap((s) => s.actions);
  if (acoes.length === 0) return null;
  return { label: acoes.length === 1 ? acoes[0].label : 'Interagir', count: acoes.length };
}

/**
 * Um tick: escolhe o melhor candidato (ator OU âncora física) de cada
 * observador ativo, calcula o rótulo e empurra a property de quem mudou.
 * Exportada crua (sem passar por `setInterval`) pelo mesmo motivo de
 * `nametag-service.js`: teste determinístico.
 */
async function tick() {
  if (typeof mp === 'undefined' || !_interactionService) return;

  const ancoras = await _obterAncoras();
  const presentes = new Set(commands.listActiveActorIds());
  for (const actorId of _ultimoEnvio.keys()) {
    if (!presentes.has(actorId)) _ultimoEnvio.delete(actorId);
  }

  for (const observadorActorId of presentes) {
    const candidato = _melhorCandidato(observadorActorId, ancoras);
    let payload = { targetId: null };

    if (candidato) {
      const info = await rotuloParaAlvo(observadorActorId, candidato.targetId, candidato.targetType);
      if (info) {
        payload = { targetId: candidato.targetId, targetType: candidato.targetType, label: info.label };
      }
    }

    // Mesmo motivo do player-panel/nametag: reenviar "continua sem alvo" ou
    // "continua com o mesmo rótulo" a cada 2s por jogador é tráfego que não
    // muda nada na tela.
    const serializado = JSON.stringify(payload);
    if (_ultimoEnvio.get(observadorActorId) === serializado) continue;
    _ultimoEnvio.set(observadorActorId, serializado);

    try {
      mp.set(observadorActorId, PROPERTY, { ...payload, sentAt: Date.now() });
    } catch (err) {
      console.error(`[interaction-prompt] Falha ao enviar prompt para 0x${observadorActorId.toString(16)}:`, err.message);
    }
  }
}

function initInteractionPromptService() {
  if (_timer) return;
  _timer = setInterval(() => {
    tick().catch((err) => console.error('[interaction-prompt] Falha no tick:', err.message));
  }, INTERVALO_DO_TICK_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
  console.log('[interaction-prompt] V1 ativa (ator + ancora fisica por proximidade, sem raycast). NAO validado em jogo — ver cabecalho do arquivo.');
}

function shutdownInteractionPromptService() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _ultimoEnvio.clear();
  _limparCacheDeAncoras();
}

module.exports = {
  PROPERTY,
  SNIPPET_DO_CLIENTE,
  INTERVALO_DO_TICK_MS,
  ALCANCE,
  configure,
  escolherAlvo,
  rotuloParaAlvo,
  tick,
  initInteractionPromptService,
  shutdownInteractionPromptService,
  _ultimoEnvio,
  _limparCacheDeAncoras
};

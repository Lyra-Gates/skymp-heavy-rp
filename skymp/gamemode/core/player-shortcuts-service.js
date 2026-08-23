/**
 * core/player-shortcuts-service.js
 *
 * Tecla `F2` pra abrir o `/painel` sem digitar — mesmo objetivo do prompt
 * `[E]` (Tarefa 11), aplicado a uma ação que já existe (`panel:open`, ver
 * `player-panel-service.js`) e não depende de alvo nenhum.
 *
 * ─── Por que um módulo próprio, e não dentro de `interaction-prompt` ───────
 *
 * `interaction-prompt-service.js` já prova o padrão "registra `keyPress`
 * uma vez, via guarda em `ctx.state`" — mas está atrás de
 * `ENABLE_INTERACTION_PROMPT`. Amarrar `F2` a essa flag faria abrir o
 * painel depender de um lab que não tem nada a ver com ele. Este módulo
 * reusa o MESMO padrão (tick de presença + guarda em `ctx.state`), com sua
 * própria flag.
 *
 * ─── Por que ainda existe um tick, se o alvo nunca muda ────────────────────
 *
 * Ao contrário do prompt `[E]` (cujo payload muda a cada 2s conforme o
 * jogador anda), aqui o "payload" é sempre o mesmo — só existe pra dar ao
 * cliente UM `mp.set` que dispare o `updateOwner` e registre o listener de
 * tecla. `commands.listActiveActorIds()` garante que todo personagem ativo
 * recebe esse envio uma vez; o diffing (`_ultimoEnvio`, mesmo mecanismo do
 * prompt `[E]`) garante que não é reenviado a cada tick depois disso.
 *
 * ⚠️ NÃo VALIDADO EM JOGO — mesma ressalva de toda a família de labs deste
 * projeto. `ctx.sp.on('keyPress', ...)` é o mesmo mecanismo do `[E]`
 * (nunca confirmado contra um servidor SkyMP real); o scan code de `F2`
 * (`60`, 0x3C) é uma leitura de tabela DirectInput, não um teste.
 */

'use strict';

const commands = require('../commands');

/** Property por onde o "sinal de pronto" chega ao cliente. */
const PROPERTY = 'playerShortcuts';

/** F2 = scan code DirectInput 60 (0x3C). Ver ressalva no cabeçalho. */
const SCAN_CODE_F2 = 60;

/**
 * Roda no cliente, dentro do Skyrim Platform. Só tem uma responsabilidade:
 * registrar (uma vez, guarda em `ctx.state`, mesmo padrão de
 * `interaction-prompt-service.js`) o listener de `F2` que pede ao servidor
 * pra abrir o painel — via o MESMO caminho que qualquer clique de UI já usa
 * (`window.skyrimPlatform.sendMessage`, ver `core/ui-event-gateway.js`),
 * não um caminho novo.
 */
const SNIPPET_DO_CLIENTE = `
  ctx.state.playerShortcuts = ctx.state.playerShortcuts || { registrouTecla: false };
  var psc = ctx.state.playerShortcuts;

  if (!psc.registrouTecla && ctx.sp && typeof ctx.sp.on === 'function') {
    psc.registrouTecla = true;
    ctx.sp.on('keyPress', function (key) {
      if (key !== ${SCAN_CODE_F2}) return; // F2
      if (!ctx.sp.browser || !ctx.sp.browser.executeJavaScript) return;
      ctx.sp.browser.executeJavaScript('window.handlePlayerShortcutKey && window.handlePlayerShortcutKey("panel:open")');
    });
  }
`;

/** Mesmo intervalo do prompt `[E]` e da nametag — não é tempo crítico aqui. */
const INTERVALO_DO_TICK_MS = 2000;

let _timer = null;

/** actorId -> já recebeu o sinal de pronto (evita reenviar a cada tick). */
const _jaEnviado = new Set();

async function tick() {
  if (typeof mp === 'undefined') return;

  const presentes = new Set(commands.listActiveActorIds());
  for (const actorId of _jaEnviado) {
    if (!presentes.has(actorId)) _jaEnviado.delete(actorId);
  }

  for (const actorId of presentes) {
    if (_jaEnviado.has(actorId)) continue;
    _jaEnviado.add(actorId);
    try {
      mp.set(actorId, PROPERTY, { sentAt: Date.now() });
    } catch (err) {
      console.error(`[player-shortcuts] Falha ao enviar sinal para 0x${actorId.toString(16)}:`, err.message);
    }
  }
}

function initPlayerShortcutsService() {
  if (_timer) return;
  _timer = setInterval(() => {
    tick().catch((err) => console.error('[player-shortcuts] Falha no tick:', err.message));
  }, INTERVALO_DO_TICK_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
  console.log('[player-shortcuts] F2 abre o /painel. NAO validado em jogo — ver cabecalho do arquivo.');
}

function shutdownPlayerShortcutsService() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _jaEnviado.clear();
}

module.exports = {
  PROPERTY,
  SNIPPET_DO_CLIENTE,
  SCAN_CODE_F2,
  INTERVALO_DO_TICK_MS,
  tick,
  initPlayerShortcutsService,
  shutdownPlayerShortcutsService,
  _jaEnviado
};

/**
 * core/ui-event-router.js
 *
 * Roteamento centralizado de eventos vindos da UI (CEF) para os módulos.
 * Substitui o hardcode de `mp.onUiEvent` chamando um único módulo.
 *
 * Cada módulo registra um prefixo (a parte do uiEvent.type antes do primeiro ':'),
 * ex: 'governance:interaction:actions' → prefixo 'governance'.
 *
 * Uso:
 *   uiEventRouter.register('governance', governance.handleUiEvent);
 *   uiEventRouter.register('panel', playerPanel.handleUiEvent);
 *   ...
 *   uiEventRouter.dispatch(actorId, uiEvent); // despacha para todos os handlers registrados
 *
 * Um handler retorna true se tratou o evento. dispatch() chama TODOS os handlers
 * registrados (não para no primeiro match) para preservar o comportamento atual,
 * onde múltiplos módulos podem reagir ao mesmo evento.
 */

// Mapa de prefixo → handler(actorId, uiEvent) => boolean | Promise<boolean>
const _handlers = new Map();

/**
 * Registra um handler para um prefixo de evento.
 * @param {string} prefix - Prefixo do uiEvent.type (ex: 'governance', 'panel')
 * @param {Function} handler - async (actorId, uiEvent) => boolean
 */
function register(prefix, handler) {
  if (!prefix) throw new Error('[ui-event-router] Handler sem prefixo');
  if (typeof handler !== 'function') throw new Error(`[ui-event-router] Handler '${prefix}' inválido`);
  _handlers.set(prefix, handler);
}

/**
 * Remove um handler registrado.
 * @param {string} prefix
 */
function unregister(prefix) {
  _handlers.delete(prefix);
}

/**
 * Despacha um uiEvent para o handler cujo prefixo bate com uiEvent.type.
 * Se nenhum prefixo específico bater, tenta todos os handlers registrados
 * (compatibilidade com módulos que escutam múltiplos namespaces).
 *
 * @param {number} actorId
 * @param {object} uiEvent - { type: string, data?: object }
 * @returns {Promise<boolean>} true se algum handler tratou o evento
 */
async function dispatch(actorId, uiEvent) {
  if (!uiEvent || typeof uiEvent.type !== 'string') return false;

  const prefix = uiEvent.type.split(':')[0];
  const targeted = _handlers.get(prefix);

  let handled = false;

  if (targeted) {
    try {
      handled = Boolean(await targeted(actorId, uiEvent)) || handled;
    } catch (err) {
      console.error(`[ui-event-router] Erro no handler '${prefix}':`, err.message);
    }
  }

  // Fallback: alguns eventos (ex: governance:interaction:*) já eram tratados
  // por handlers que não seguem estritamente o prefixo do próprio módulo.
  // Chama os demais handlers registrados também, ignorando erros.
  for (const [otherPrefix, handler] of _handlers.entries()) {
    if (otherPrefix === prefix) continue;
    try {
      const result = await handler(actorId, uiEvent);
      handled = Boolean(result) || handled;
    } catch (err) {
      console.error(`[ui-event-router] Erro no handler '${otherPrefix}':`, err.message);
    }
  }

  return handled;
}

function list() {
  return Array.from(_handlers.keys());
}

module.exports = { register, unregister, dispatch, list };

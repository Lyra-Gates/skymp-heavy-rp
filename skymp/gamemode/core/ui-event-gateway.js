/**
 * Ponte testavel entre o callback global `mp.onUiEvent` e o gamemode.
 *
 * SkyMP exige a atribuicao de uma funcao global, mas a regra de fronteira CEF
 * precisa ser exercitada sem subir o processo do jogo. Este modulo nao conhece
 * `mp`, banco ou gameplay: recebe as dependencias e devolve o callback.
 */

/**
 * @param {{
 *   uiEventRouter: {isValidEventEnvelope: Function, dispatch: Function},
 *   handleChatInput: Function,
 *   rateLimiter?: {observe: Function},
 *   logger?: Pick<Console, 'log'|'warn'|'error'>
 * }} dependencies
 * @returns {(actorId: number, uiEvent: unknown) => boolean}
 */
function createUiEventGateway({ uiEventRouter, handleChatInput, rateLimiter, logger = console }) {
  if (!uiEventRouter || typeof uiEventRouter.isValidEventEnvelope !== 'function' || typeof uiEventRouter.dispatch !== 'function') {
    throw new Error('[ui-event-gateway] uiEventRouter invalido');
  }
  if (typeof handleChatInput !== 'function') {
    throw new Error('[ui-event-gateway] handleChatInput invalido');
  }
  if (rateLimiter && typeof rateLimiter.observe !== 'function') {
    throw new Error('[ui-event-gateway] rateLimiter invalido');
  }

  return (actorId, uiEvent) => {
    try {
      if (!uiEventRouter.isValidEventEnvelope(uiEvent)) {
        logger.warn(`[phase0] Ignoring malformed UI event from ${actorId.toString(16)}`);
        return false;
      }

      /** @type {{type: string, data?: unknown}} */
      const event = /** @type {any} */ (uiEvent);

      if (rateLimiter) {
        const result = rateLimiter.observe(actorId, event.type);
        if (!result || result.allowed !== true) {
          logger.warn(`[phase0] UI event rate limited from ${actorId.toString(16)}: type=${event.type}`);
          return false;
        }
      }

      // Nunca registrar o payload bruto: ele e controlado pelo cliente e pode
      // conter texto privado ou dados que nao sao necessarios para diagnostico.
      logger.log(
        `[phase0] onUiEvent callback from ${actorId.toString(16)}: ` +
        `type=${event.type} data=${describeEventData(event.data)}`
      );
      Promise.resolve(uiEventRouter.dispatch(actorId, event)).catch(err =>
        logger.error('[phase0] ui-event-router dispatch failed:', err.message)
      );

      if (event.type === 'cef::chat:send') {
        handleChatInput(actorId, event.data);
      }
      return true;
    } catch (err) {
      logger.error('[phase0] Error in onUiEvent:', err.message);
      return false;
    }
  };
}

/**
 * Atribui o unico callback global aceito pelo SkyMP, mantendo a criacao do
 * gateway testavel sem precisar carregar o bootstrap inteiro.
 * @param {{onUiEvent?: Function}} mpApi
 * @param {Parameters<typeof createUiEventGateway>[0]} dependencies
 */
function installUiEventGateway(mpApi, dependencies) {
  if (!mpApi || typeof mpApi !== 'object') throw new Error('[ui-event-gateway] mp invalido');
  const gateway = createUiEventGateway(dependencies);
  mpApi.onUiEvent = gateway;
  return gateway;
}

/**
 * Devolve somente a categoria de um payload recebido da UI, sem vazar seu
 * conteudo nos logs do servidor.
 * @param {unknown} data
 * @returns {string}
 */
function describeEventData(data) {
  if (data === undefined) return 'absent';
  if (data === null) return 'null';
  if (Array.isArray(data)) return 'array';
  return typeof data;
}

module.exports = { createUiEventGateway, installUiEventGateway };

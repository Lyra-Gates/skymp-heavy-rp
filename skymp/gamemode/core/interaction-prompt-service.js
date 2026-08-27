/**
 * core/interaction-prompt-service.js
 *
 * Aquisição compartilhada de alvo físico para o Interaction Framework.
 *
 * O cliente informa somente o FormID que está sob a mira. O servidor escolhe
 * o tipo, resolve o alvo e calcula as ações disponíveis. Proximidade continua
 * sendo validada pelo `interaction-service`, mas nunca escolhe o alvo.
 *
 * Esta implementação foi desenhada após estudar o subsistema público de
 * interações do Vengeful Realms. Ela não copia o patch: preserva nosso
 * registry, nossos resolvedores, o gateway CEF e o pipeline query/execute.
 *
 * O prompt reage a `crosshairRefChanged`; não consulta a mira continuamente.
 * A execução usa exclusivamente o `mp.onActivate` nativo através do barramento
 * compartilhado. O snippet não captura E e não concorre com o Skyrim.
 */

'use strict';

const commands = require('../commands');
const { TARGET_TYPES } = require('./interaction-registry');
const { parseFormId } = require('./interaction-targets');
const activationEvents = require('./activation-events');
const physicalAnchorRegistry = require('./physical-anchor-registry');

const PROPERTY = 'interactionPrompt';
const EVENT_SOURCE = '_interactionExactTarget';
const SERVER_TARGET_THROTTLE_MS = 75;

/** A property apenas transporta a decisão do servidor para a CEF. */
const SNIPPET_DO_CLIENTE = `
  if (ctx.sp && ctx.sp.browser && ctx.sp.browser.executeJavaScript) {
    const payload = JSON.stringify(ctx.value || { targetId: null });
    ctx.sp.browser.executeJavaScript(
      'window.handleInteractionPrompt && window.handleInteractionPrompt(' + payload + ')'
    );
  }
`;

/**
 * Executa no Skyrim Platform por jogador. Lê a mira tanto para atualizar o
 * prompt quanto no instante do E. O segundo read evita executar com o alvo que
 * estava sob a mira no tick anterior.
 */
const SNIPPET_DA_FONTE = `
  if (!ctx.state.interactionExactTarget) {
    ctx.state.interactionExactTarget = {
      lastTarget: 0
    };
  }
  const state = ctx.state.interactionExactTarget;

  const nativeMenusToBlock = [
    'BarterMenu', 'Book Menu', 'Console', 'ContainerMenu', 'Crafting Menu',
    'Dialogue Menu', 'FavoritesMenu', 'GiftMenu', 'InventoryMenu',
    'Journal Menu', 'Loading Menu', 'Lockpicking Menu', 'MagicMenu',
    'MapMenu', 'RaceSex Menu', 'Sleep/Wait Menu', 'StatsMenu',
    'Training Menu', 'TweenMenu'
  ];

  const isBlocked = () => {
    try { if (ctx.sp.Ui.isTextInputEnabled()) return true; } catch (_) {}
    for (const menu of nativeMenusToBlock) {
      try { if (ctx.sp.Ui.isMenuOpen(menu)) return true; } catch (_) {}
    }
    return false;
  };

  const exactTarget = () => {
    let refr = null;
    try { refr = ctx.sp.Game.getCurrentCrosshairRef(); } catch (_) { return 0; }
    if (!refr || typeof refr.getFormID !== 'function') return 0;
    try { return ctx.getFormIdInServerFormat(refr.getFormID()) || 0; }
    catch (_) { return 0; }
  };

  const sendPromptTarget = (targetFormId) => {
    if ((targetFormId || 0) === state.lastTarget) return;
    state.lastTarget = targetFormId || 0;
    ctx.sendEvent({ kind: targetFormId ? 'target' : 'clear', targetFormId: targetFormId || 0 });
  };

  const refreshCurrentTarget = () => {
    if (isBlocked()) {
      sendPromptTarget(0);
      return;
    }
    sendPromptTarget(exactTarget());
  };

  // O evento não garante snapshot da mira que já existia na instalação.
  ctx.sp.once('update', refreshCurrentTarget);

  ctx.sp.on('crosshairRefChanged', (event) => {
    if (isBlocked()) return sendPromptTarget(0);
    const refr = event && event.reference;
    if (!refr || typeof refr.getFormID !== 'function') return sendPromptTarget(0);
    try { sendPromptTarget(ctx.getFormIdInServerFormat(refr.getFormID()) || 0); }
    catch (_) { sendPromptTarget(0); }
  });

  ctx.sp.on('menuOpen', () => sendPromptTarget(0));
  ctx.sp.on('menuClose', () => ctx.sp.once('update', refreshCurrentTarget));

`;

let _interactionService = null;
let _sendModal = null;
let _initialized = false;
let _unsubscribeCharacterRemoved = null;
const ACTIVATION_SUBSCRIBER = 'interaction-prompt';

/** Geração por ator impede resposta async antiga de substituir a mira atual. */
const _generationByActor = new Map();
const _lastPayloadByActor = new Map();
const _lastTargetEventAt = new Map();

function configure(deps) {
  _interactionService = deps && deps.interactionService || null;
  _sendModal = deps && deps.sendModal || null;
}

function _nextGeneration(actorId) {
  const next = (_generationByActor.get(actorId) || 0) + 1;
  _generationByActor.set(actorId, next);
  return next;
}

function _actions(result) {
  if (!result || !result.ok || !Array.isArray(result.sections)) return [];
  return result.sections.flatMap(section => Array.isArray(section.actions) ? section.actions : []);
}

/**
 * O tipo não vem do cliente. Um FormID de personagem carregado só pode seguir
 * pelo resolvedor `player`; todo o restante é sondado como `object` e somente
 * sobrevive se alguma interação registrada passar por resolução/canSee.
 */
async function resolveExactTarget(actorId, rawTargetId, options = {}) {
  if (!_interactionService) return null;
  const targetId = parseFormId(rawTargetId);
  if (targetId === null || targetId === actorId) return null;

  const targetType = commands.getCharacterData(targetId)
    ? TARGET_TYPES.PLAYER
    : TARGET_TYPES.OBJECT;
  const method = options.consumeRateLimit ? 'query' : 'peek';
  const result = await _interactionService[method](actorId, { targetType, targetId });
  const actions = _actions(result);
  if (actions.length === 0) return null;

  return {
    targetId,
    targetType,
    label: actions.length === 1 ? actions[0].label : 'Interagir',
    count: actions.length,
    sections: result.sections
  };
}

function _publish(actorId, payload) {
  if (typeof mp === 'undefined') return;
  const comparable = JSON.stringify(payload);
  if (_lastPayloadByActor.get(actorId) === comparable) return;
  _lastPayloadByActor.set(actorId, comparable);
  mp.set(actorId, PROPERTY, { ...payload, sentAt: Date.now() });
}

async function handleClientEvent(actorId, payload) {
  if (!payload || typeof payload !== 'object') return;

  if (payload.kind === 'clear') {
    _nextGeneration(actorId);
    _publish(actorId, { targetId: null });
    return;
  }

  if (payload.kind === 'target') {
    const now = Date.now();
    const previousAt = _lastTargetEventAt.get(actorId) || 0;
    if (now - previousAt < SERVER_TARGET_THROTTLE_MS) return;
    _lastTargetEventAt.set(actorId, now);
    const generation = _nextGeneration(actorId);
    const exact = await resolveExactTarget(actorId, payload.targetFormId);
    if (_generationByActor.get(actorId) !== generation) return;
    _publish(actorId, exact ? {
      targetId: exact.targetId,
      targetType: exact.targetType,
      label: exact.label,
      count: exact.count
    } : { targetId: null });
    return;
  }

  if (payload.kind === 'inspect') {
    // Evento de cliente precisa consumir o rate limit de query. O snapshot de
    // ações segue no modal para a CEF não disparar uma segunda consulta.
    const exact = await resolveExactTarget(actorId, payload.targetFormId, { consumeRateLimit: true });
    if (!exact || typeof _sendModal !== 'function') return;
    _sendModal(actorId, 'interaction:open', {
      targetActorId: exact.targetId,
      targetType: exact.targetType,
      sections: exact.sections
    });
  }
}

/**
 * Decide sincronamente se a ativação pertence ao framework e agenda a
 * resolução autoritativa. Nunca bloqueia portas/objetos vanilla desconhecidos.
 */
function handleNativeActivation(targetId, casterId) {
  const parsedTarget = parseFormId(targetId);
  const parsedCaster = parseFormId(casterId);
  if (parsedTarget === null || parsedCaster === null || parsedTarget === parsedCaster) return undefined;

  const knownPlayer = Boolean(commands.getCharacterData(parsedTarget));
  if (!knownPlayer && !physicalAnchorRegistry.has(parsedTarget)) return undefined;

  handleClientEvent(parsedCaster, { kind: 'inspect', targetFormId: parsedTarget }).catch(err => {
    console.error('[interaction-prompt] ativacao nativa falhou:', err.message);
  });
  return false;
}

function clearActor(actorId) {
  _generationByActor.delete(actorId);
  _lastPayloadByActor.delete(actorId);
  _lastTargetEventAt.delete(actorId);
  if (typeof mp !== 'undefined') {
    try { mp.set(actorId, PROPERTY, { targetId: null, sentAt: Date.now() }); }
    catch (_) {}
  }
}

function initInteractionPromptService() {
  if (_initialized) return;
  if (typeof mp === 'undefined' || typeof mp.makeEventSource !== 'function') {
    throw new Error('[interaction-prompt] mp.makeEventSource indisponivel');
  }
  if (!_interactionService || typeof _sendModal !== 'function') {
    throw new Error('[interaction-prompt] dependencias nao configuradas');
  }

  mp.makeEventSource(EVENT_SOURCE, SNIPPET_DA_FONTE);
  mp[EVENT_SOURCE] = (actorId, payload) => {
    handleClientEvent(actorId, payload).catch(err => {
      console.error('[interaction-prompt] evento de alvo exato falhou:', err.message);
    });
  };
  activationEvents.subscribe(ACTIVATION_SUBSCRIBER, handleNativeActivation);
  if (typeof commands.onCharacterRemoved === 'function') {
    _unsubscribeCharacterRemoved = commands.onCharacterRemoved(clearActor);
  }
  _initialized = true;
  console.log('[interaction-prompt] alvo exato por crosshair + E ativo em LAB; validacao in-game pendente.');
}

function shutdownInteractionPromptService() {
  if (typeof mp !== 'undefined' && _initialized) mp[EVENT_SOURCE] = () => {};
  if (_unsubscribeCharacterRemoved) _unsubscribeCharacterRemoved();
  _unsubscribeCharacterRemoved = null;
  activationEvents.unsubscribe(ACTIVATION_SUBSCRIBER);
  _initialized = false;
  _generationByActor.clear();
  _lastPayloadByActor.clear();
  _lastTargetEventAt.clear();
}

module.exports = {
  PROPERTY,
  EVENT_SOURCE,
  SERVER_TARGET_THROTTLE_MS,
  SNIPPET_DO_CLIENTE,
  SNIPPET_DA_FONTE,
  configure,
  resolveExactTarget,
  handleClientEvent,
  handleNativeActivation,
  clearActor,
  initInteractionPromptService,
  shutdownInteractionPromptService,
  _generationByActor,
  _lastPayloadByActor,
  _lastTargetEventAt
};

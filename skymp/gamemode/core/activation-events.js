/**
 * Dono único de `mp.onActivate`, com múltiplos assinantes nomeados.
 *
 * O hook do SkyMP é síncrono: somente o booleano exato `false` bloqueia o
 * processamento vanilla. Assinantes que precisam de banco devem decidir em
 * O(1) se reconhecem o FormID, iniciar o trabalho assíncrono por conta própria
 * e retornar `false` imediatamente quando consumirem a ativação.
 */
'use strict';

const _subscribers = new Map();
let _hookInstalled = false;

function _dispatch(targetId, casterId) {
  let consumed = false;
  for (const [name, handler] of _subscribers) {
    try {
      if (handler(targetId, casterId) === false) consumed = true;
    } catch (err) {
      console.error(
        `[activation-events] Assinante '${name}' lancou em onActivate: ${err.message}. ` +
        'Os demais assinantes continuam e a excecao NAO bloqueia a ativacao vanilla.'
      );
    }
  }
  return consumed ? false : undefined;
}

function _installHook() {
  if (_hookInstalled || typeof mp === 'undefined') return;
  if (typeof mp.onActivate === 'function') {
    throw new Error(
      '[activation-events] mp.onActivate ja possui handler direto. ' +
      'Migre o consumidor para activationEvents.subscribe(<nome>, fn).'
    );
  }
  mp.onActivate = (targetId, casterId) => _dispatch(targetId, casterId);
  _hookInstalled = true;
}

function subscribe(name, handler) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('[activation-events] subscribe exige nome nao-vazio');
  }
  if (typeof handler !== 'function') {
    throw new Error(`[activation-events] subscribe('${name}') exige funcao`);
  }
  if (_subscribers.has(name)) {
    throw new Error(`[activation-events] '${name}' ja esta inscrito em onActivate`);
  }
  _subscribers.set(name, handler);
  _installHook();
}

function unsubscribe(name) { return _subscribers.delete(name); }
function subscriberNames() { return [..._subscribers.keys()]; }

function _resetForTest() {
  _subscribers.clear();
  _hookInstalled = false;
  if (typeof mp !== 'undefined') delete mp.onActivate;
}

module.exports = { subscribe, unsubscribe, subscriberNames, _dispatch, _resetForTest };


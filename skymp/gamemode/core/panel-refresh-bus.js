/**
 * core/panel-refresh-bus.js
 *
 * Barramento de eventos desacoplado para "algo mudou, o Painel do Jogador
 * de tal ator deveria se atualizar". Existe para evitar dependência circular
 * entre player-panel-service.js (que já depende de governance-service.js e
 * market-stalls-service.js para montar snapshots) e esses mesmos serviços
 * (que agora precisam avisar quando uma ação deles afeta um jogador).
 *
 * Uso:
 *   const panelRefreshBus = require('./core/panel-refresh-bus');
 *
 *   // em qualquer serviço, após uma ação que muda o estado de um jogador:
 *   panelRefreshBus.requestRefresh(targetActorId, 'governance');
 *
 *   // no player-panel-service, uma única vez em initPlayerPanelService():
 *   panelRefreshBus.onRefresh((actorId, channel) => { ... });
 */

const { EventEmitter } = require('events');

const CHANNELS = new Set(['status', 'governance', 'economy', 'social']);

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

/**
 * Pede que o painel de um ator seja atualizado num canal específico.
 * Não faz nada se não houver nenhum listener registrado (ex: módulo
 * player-panel desabilitado) nem se o canal for desconhecido.
 * @param {number} actorId
 * @param {'status'|'governance'|'economy'|'social'} channel
 */
function requestRefresh(actorId, channel) {
  if (!CHANNELS.has(channel)) return;
  emitter.emit('refresh', actorId, channel);
}

/**
 * Registra um handler chamado a cada requestRefresh().
 * @param {(actorId: number, channel: string) => void} handler
 */
function onRefresh(handler) {
  emitter.on('refresh', handler);
}

/**
 * Remove um handler registrado com onRefresh().
 * @param {(actorId: number, channel: string) => void} handler
 */
function offRefresh(handler) {
  emitter.off('refresh', handler);
}

module.exports = { CHANNELS, requestRefresh, onRefresh, offRefresh };

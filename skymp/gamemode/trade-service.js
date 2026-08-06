const db = require('./database');
const inventory = require('./inventory-service');
const commands = require('./commands');

// Armazena sessoes ativas. Chave: actorId do iniciador.
const activeTrades = new Map();

function getTradeSession(actorId) {
  for (const [initiatorId, session] of activeTrades.entries()) {
    if (initiatorId === actorId || session.targetId === actorId) {
      return session;
    }
  }
  return null;
}

// Inicia um convite de troca (/trade [actorId])
function requestTrade(sourceActorId, sourceCharId, targetActorHex) {
  if (getTradeSession(sourceActorId)) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você já está em uma troca.']);
    return;
  }

  const targetActorId = parseInt(targetActorHex, 16);
  if (isNaN(targetActorId) || targetActorId === sourceActorId) return;

  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  if (getTradeSession(targetActorId)) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Este jogador já está em uma troca.']);
    return;
  }

  // Cria a sessao pendente
  activeTrades.set(sourceActorId, {
    initiatorId: sourceActorId,
    initiatorCharId: sourceCharId,
    targetId: targetActorId,
    targetCharId: targetChar.characterId,
    status: 'pending'
  });

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Convite de troca enviado.']);
    // Fake context for target
    commands.broadcastProximityMessage(sourceActorId, `* Oferece um acordo para a pessoa à frente.`, 500);
  }
  console.log(`[trade-service] Trade requested: ${sourceCharId} -> ${targetChar.characterId}`);
}

// Aceita o convite (/tradeaccept)
function acceptTrade(targetActorId) {
  let session = null;
  for (const [initId, s] of activeTrades.entries()) {
    if (s.targetId === targetActorId && s.status === 'pending') {
      session = s;
      break;
    }
  }

  if (!session) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Nenhum convite de troca pendente.']);
    return;
  }

  session.status = 'active';
  
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Troca iniciada! (UI CEF em breve)']);
    // No futuro: mp.triggerClient(session.initiatorId, 'showTradeUI');
  }
}

function cancelTrade(actorId) {
  const session = getTradeSession(actorId);
  if (session) {
    activeTrades.delete(session.initiatorId);
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['A troca foi cancelada.']);
    }
  }
}

module.exports = {
  requestTrade,
  acceptTrade,
  cancelTrade
};

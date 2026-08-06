// PARKED — ver docs/technical/PARKED_SERVICES_DECISION.md §6.
//
// Este servico nao mexe em ouro nem em item: ele so negocia o *convite* de
// troca e guarda a sessao em memoria. A transferencia em si nunca foi
// escrita — e quando for, o caminho obrigatorio e
// `core/transaction-service.transfer()`, que move item e ouro dos dois lados
// numa transacao so. Nao replicar a movimentacao aqui.
//
// `db` e `inventory-service` estavam importados e nunca usados desde o commit
// original. Ficavam sugerindo que a persistencia ja existia — e o proximo a
// mexer aqui comecaria escrevendo `db.query` em vez de chamar o
// transaction-service, que e exatamente o erro que o `economy-service`
// apagado cometia.
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

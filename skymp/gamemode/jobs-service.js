const commands = require('./commands');

// IDs Base de itens do Skyrim
const ITEM_FIREWOOD = 0x00033760; // Lenha
const ITEM_WOODCUTTER_AXE = 0x0002F2F4; // Machado de Lenhador

// Previne spam mantendo controle de quem esta coletando
const activeGatherers = new Set();

function chopWood(actorId) {
  if (typeof mp === 'undefined') return;

  if (activeGatherers.has(actorId)) {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você já está ocupado fazendo algo.']);
    return;
  }

  // Opcionalmente: Checar pelo servidor se o jogador tem o machado
  const hasItem = mp.callPapyrusFunction('method', 'Actor', 'GetItemCount', actorId, [ITEM_WOODCUTTER_AXE]);
  if (hasItem <= 0) {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você precisa de um Machado de Lenhador.']);
    return;
  }

  activeGatherers.add(actorId);

  // RP Action
  commands.broadcastProximityMessage(actorId, `* Começa a cortar lenha energicamente.`, 1500);

  // Toca a animacao do Skyrim (se disponivel no ator)
  // mp.callPapyrusFunction('global', 'Debug', 'SendAnimationEvent', actorId, ['WoodChopping']);
  
  mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Cortando lenha... aguarde.']);

  // Timer de 10 segundos canalizando
  setTimeout(() => {
    activeGatherers.delete(actorId);
    
    // Verifica se ele ainda esta conectado
    if (!mp.get(actorId, 'isDead')) { // Simulacao de checagem
      const woodAmount = Math.floor(Math.random() * 3) + 1; // 1 a 3 madeiras
      
      // Entrega o item via papyrus
      mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorId, [ITEM_FIREWOOD, woodAmount, false]);
      
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você coletou ${woodAmount}x Lenha.`]);
      console.log(`[jobs-service] Actor ${actorId.toString(16)} successfully chopped ${woodAmount} wood.`);
    }
  }, 10000);
}

module.exports = {
  chopWood
};

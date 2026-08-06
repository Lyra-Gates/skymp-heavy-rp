const commands = require('./commands');
const { actorRef } = require('./core/papyrus');

// IDs Base de itens do Skyrim
const ITEM_FIREWOOD = 0x00033760; // Lenha
const ITEM_WOODCUTTER_AXE = 0x0002F2F4; // Machado de Lenhador

const ITEM_PICKAXE = 0x000E3C16; // Picareta
const ITEM_IRON_ORE = 0x00071CF3;
const ITEM_CORUNDUM_ORE = 0x0005ACDB;
const ITEM_EBONY_ORE = 0x0005ACDC;

const ITEM_FISHING_ROD = 0x00044E20; // TODO: Substituir pelo ID correto do mod
const FISH_SALMON = 0x00065C34;
const FISH_RIVER_BETTY = 0x00106E1A;
const FISH_SPADETAIL = 0x00106E19;

// Previne spam mantendo controle de quem esta coletando
const activeGatherers = new Set();

function chopWood(actorId) {
  if (typeof mp === 'undefined') return;

  if (activeGatherers.has(actorId)) {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você já está ocupado fazendo algo.']);
    return;
  }

  // Opcionalmente: Checar pelo servidor se o jogador tem o machado
  const hasItem = mp.callPapyrusFunction('method', 'Actor', 'GetItemCount', actorRef(actorId), [ITEM_WOODCUTTER_AXE]);
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
      mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorRef(actorId), [ITEM_FIREWOOD, woodAmount, false]);
      
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você coletou ${woodAmount}x Lenha.`]);
      console.log(`[jobs-service] Actor ${actorId.toString(16)} successfully chopped ${woodAmount} wood.`);
    }
  }, 10000);
}

function mineOre(actorId) {
  if (typeof mp === 'undefined') return;

  if (activeGatherers.has(actorId)) {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você já está ocupado fazendo algo.']);
    return;
  }

  const hasItem = mp.callPapyrusFunction('method', 'Actor', 'GetItemCount', actorRef(actorId), [ITEM_PICKAXE]);
  if (hasItem <= 0) {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você precisa de uma Picareta.']);
    return;
  }

  activeGatherers.add(actorId);
  commands.broadcastProximityMessage(actorId, `* Começa a bater a picareta contra a rocha vigorosamente.`, 1500);
  mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Minerando... aguarde 15 segundos.']);
  
  setTimeout(() => {
    activeGatherers.delete(actorId);
    
    if (!mp.get(actorId, 'isDead')) {
      const chance = Math.random();
      let oreItem = ITEM_IRON_ORE;
      let oreName = "Minério de Ferro";
      
      if (chance > 0.9) {
          oreItem = ITEM_EBONY_ORE;
          oreName = "Minério de Ébano";
      } else if (chance > 0.6) {
          oreItem = ITEM_CORUNDUM_ORE;
          oreName = "Minério de Corundum";
      }

      const amount = Math.floor(Math.random() * 2) + 1; 
      
      mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorRef(actorId), [oreItem, amount, false]);
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você extraiu ${amount}x ${oreName}.`]);
      console.log(`[jobs-service] Actor ${actorId.toString(16)} successfully mined ${amount}x ${oreItem.toString(16)}.`);
    }
  }, 15000);
}

function catchFish(actorId) {
  if (typeof mp === 'undefined') return;

  if (activeGatherers.has(actorId)) {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você já está ocupado fazendo algo.']);
    return;
  }

  // TODO: Descomentar quando o ITEM_FISHING_ROD for configurado corretamente
  // const hasItem = mp.callPapyrusFunction('method', 'Actor', 'GetItemCount', actorRef(actorId), [ITEM_FISHING_ROD]);
  // if (hasItem <= 0) {
  //   mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você precisa de uma Vara de Pescar.']);
  //   return;
  // }

  activeGatherers.add(actorId);
  commands.broadcastProximityMessage(actorId, `* Lança a linha na água e aguarda pacientemente.`, 1500);
  mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Pescando... aguarde 20 segundos.']);
  
  setTimeout(() => {
    activeGatherers.delete(actorId);
    
    if (!mp.get(actorId, 'isDead')) {
      const chance = Math.random();
      let fishItem = null;
      let fishName = "";
      
      if (chance > 0.8) {
          fishItem = FISH_RIVER_BETTY;
          fishName = "River Betty";
      } else if (chance > 0.5) {
          fishItem = FISH_SPADETAIL;
          fishName = "Cyrodilic Spadetail";
      } else if (chance > 0.2) {
          fishItem = FISH_SALMON;
          fishName = "Carne de Salmão";
      }

      if (fishItem) {
          mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorRef(actorId), [fishItem, 1, false]);
          mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você pescou: ${fishName}.`]);
          console.log(`[jobs-service] Actor ${actorId.toString(16)} successfully caught fish ${fishItem.toString(16)}.`);
      } else {
          mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`O peixe escapou!`]);
          commands.broadcastProximityMessage(actorId, `* Puxa a vara de pescar vazia com frustração.`, 1000);
      }
    }
  }, 20000);
}

module.exports = {
  chopWood,
  mineOre,
  catchFish
};

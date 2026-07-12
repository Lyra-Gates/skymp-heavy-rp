const db = require('./database');
const { createRpChatService } = require('./rp-chat-service');

// Cache em memoria dos personagens ativos no servidor
// Chave: actorId (number), Valor: { firstName, lastName, accountId, profileId }
const activeCharacters = new Map();

function registerActiveCharacter(actorId, character, accountId, profileId) {
  activeCharacters.set(actorId, {
    characterId: character.id,
    firstName: character.first_name,
    lastName: character.last_name,
    accountId: accountId,
    profileId: profileId
  });
  console.log(`[commands] Cached character name for actor ${actorId.toString(16)}: ${character.first_name} ${character.last_name}`);
}

function getActiveCharacterData(actorId) {
  return activeCharacters.get(actorId) || null;
}

function removeActiveCharacter(actorId) {
  if (activeCharacters.has(actorId)) {
    const char = activeCharacters.get(actorId);
    console.log(`[commands] Removed cached character for actor ${actorId.toString(16)}: ${char.firstName} ${char.lastName}`);
    activeCharacters.delete(actorId);
  }
}

function getCharacterName(actorId) {
  if (activeCharacters.has(actorId)) {
    const char = activeCharacters.get(actorId);
    return `${char.firstName} ${char.lastName}`;
  }
  return `Player_${actorId.toString(16)}`;
}

async function logRpChatEvent(event) {
  const details = JSON.stringify({
    type: event.type,
    actorId: `0x${event.actorId.toString(16)}`,
    characterId: event.characterId || null,
    message: event.message,
    radius: event.radius
  });

  try {
    await db.query(
      'INSERT INTO audit_logs (action, actor_account_id, target_account_id, details) VALUES (?, ?, ?, ?)',
      [`rp_chat:${event.type}`, event.accountId || null, null, details]
    );
  } catch (err) {
    console.log(`[rp-chat-log] ${details}`);
  }
}

// Envia uma notificacao vanilla do Skyrim na tela do jogador
function sendNotification(actorId, message) {
  if (typeof mp === 'undefined') return;
  try {
    const actorDesc = { type: 'form', desc: mp.getDescFromId(actorId) };
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [message]);
  } catch (err) {
    console.error(`[commands] Failed to send notification to actor ${actorId.toString(16)}:`, err.message);
  }
}

// Transmite a mensagem para o autor e vizinhos dentro de um raio de proximidade (padrao: 1500 unidades Skyrim ~ 20 metros)
function broadcastProximityMessage(sourceActorId, message, radius = 1500) {
  console.log(`[chat-log] Broadcast: "${message}"`);
  
  // 1. Mostrar para o proprio autor
  sendNotification(sourceActorId, message);

  if (typeof mp === 'undefined') return;

  // 2. Mostrar para os vizinhos
  try {
    const neighbors = mp.get(sourceActorId, 'neighbors') || [];
    const sourceLoc = mp.get(sourceActorId, 'locationalData');
    if (!sourceLoc || !sourceLoc.pos) return;
    
    const sourcePos = sourceLoc.pos;
    const sourceCell = sourceLoc.cellOrWorldSpaceId || sourceLoc.cellId || sourceLoc.worldOrCell;

    for (const neighborId of neighbors) {
      if (mp.get(neighborId, 'type') === 'MpActor' && neighborId !== sourceActorId) {
        const neighborLoc = mp.get(neighborId, 'locationalData');
        if (neighborLoc && neighborLoc.pos) {
          const neighborCell = neighborLoc.cellOrWorldSpaceId || neighborLoc.cellId || neighborLoc.worldOrCell;
          if (sourceCell && neighborCell && sourceCell !== neighborCell) {
            continue;
          }

          const neighborPos = neighborLoc.pos;
          
          // Distancia Euclidiana 3D
          const dx = sourcePos[0] - neighborPos[0];
          const dy = sourcePos[1] - neighborPos[1];
          const dz = sourcePos[2] - neighborPos[2];
          const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
          
          if (distance <= radius) {
            sendNotification(neighborId, message);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[commands] Failed to broadcast message:`, err.message);
  }
}

const rpChat = createRpChatService({
  getCharacterName,
  getCharacterData: getActiveCharacterData,
  sendNotification,
  broadcastProximityMessage,
  logEvent: logRpChatEvent
});

// Tratamento de mensagens digitadas no chat
function handleChatInput(actorId, text) {
  if (!text || typeof text !== 'string') return;

  if (rpChat.handleChatInput(actorId, text)) {
    return;
  }

  // Se comecar com "/", trata-se de um comando
  if (text.startsWith('/')) {
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
      case '/chopwood':
        const jobs = require('./jobs-service');
        jobs.chopWood(actorId);
        break;

      case '/mineore':
        require('./jobs-service').mineOre(actorId);
        break;

      case '/fish':
        require('./jobs-service').catchFish(actorId);
        break;

      case '/sellwood':
        const charDataForSell = getActiveCharacterData(actorId);
        if (charDataForSell) {
          const economy = require('./economy-service');
          economy.sellWood(actorId, charDataForSell.characterId);
        }
        break;

      case '/pay':
        const charDataForPay = getActiveCharacterData(actorId);
        if (charDataForPay) {
          const partsPay = args.split(' ');
          if (partsPay.length === 2) {
            const economy = require('./economy-service');
            economy.payPlayer(actorId, charDataForPay.characterId, partsPay[0], partsPay[1]);
          } else {
            sendNotification(actorId, 'Uso: /pay <id_jogador> <valor>');
          }
        }
        break;

      case '/balance':
        const charDataForBal = getActiveCharacterData(actorId);
        if (charDataForBal) {
          const economy = require('./economy-service');
          economy.getGold(charDataForBal.characterId).then(g => {
            sendNotification(actorId, `Ouro: ${g} Septims`);
          });
        }
        break;

      case '/trade':
        const charDataForTrade = getActiveCharacterData(actorId);
        if (charDataForTrade && args) {
          const trade = require('./trade-service');
          trade.requestTrade(actorId, charDataForTrade.characterId, args);
        }
        break;

      case '/tradeaccept':
        require('./trade-service').acceptTrade(actorId);
        break;
        
      case '/tradecancel':
        require('./trade-service').cancelTrade(actorId);
        break;

      // --- Comandos de Staff ---
      case '/anim':
        if (args) {
          const partsAnim = args.split(' ');
          const admin = require('./admin-service');
          admin.playAnimation(actorId, parseInt(partsAnim[0], 16), partsAnim[1] || 'IdleStop');
        }
        break;

      case '/additem':
        if (args) {
          const partsAdd = args.split(' ');
          require('./admin-service').giveItemAdmin(actorId, parseInt(partsAdd[0], 16), parseInt(partsAdd[1], 16), parseInt(partsAdd[2]) || 1);
        }
        break;

      case '/tp':
        if (args) {
          require('./admin-service').teleportTo(actorId, parseInt(args, 16));
        }
        break;

      case '/kick':
        if (args) {
          const partsKick = args.split(' ');
          const reason = partsKick.slice(1).join(' ') || 'Sem motivo';
          require('./admin-service').kickPlayer(actorId, parseInt(partsKick[0], 16), reason);
        }
        break;

      case '/setgold':
        if (args) {
          const partsSg = args.split(' ');
          require('./admin-service').setGold(actorId, parseInt(partsSg[0], 16), parseInt(partsSg[1]));
        }
        break;

      // --- Comandos de Habitacao ---
      case '/buyhouse':
        if (args) {
          const charDataHouse = getActiveCharacterData(actorId);
          if (charDataHouse) require('./housing-service').buyProperty(actorId, charDataHouse.characterId, parseInt(args));
        }
        break;

      case '/invitehouse':
        if (args) {
          const partsInv = args.split(' ');
          const charDataInv = getActiveCharacterData(actorId);
          const targetDataInv = getActiveCharacterData(parseInt(partsInv[0], 16));
          if (charDataInv && targetDataInv) {
            require('./housing-service').inviteToProperty(charDataInv.characterId, targetDataInv.characterId, parseInt(partsInv[1]));
          }
        }
        break;

      // --- Comandos de Justica ---
      case '/restrain':
        if (args) require('./justice-service').restrain(actorId, parseInt(args, 16));
        break;

      case '/unrestrain':
        if (args) require('./justice-service').unrestrain(actorId, parseInt(args, 16));
        break;

      case '/arrest':
        if (args) {
          const partsArr = args.split(' ');
          const targetAct = parseInt(partsArr[0], 16);
          const sentence  = parseInt(partsArr[1]) || 10;
          const crime     = partsArr.slice(2).join(' ') || 'Perturbacao da Ordem';
          require('./justice-service').arrest(actorId, targetAct, sentence, crime);
        }
        break;

      case '/release':
        if (args) {
          const tRelease = parseInt(args, 16);
          const charRel  = getActiveCharacterData(tRelease);
          if (charRel) require('./justice-service').releasePrisoner(tRelease, charRel.characterId, 'staff_release');
        }
        break;

      case '/setbounty':
        if (args) {
          const partsBounty = args.split(' ');
          const tBounty     = parseInt(partsBounty[0], 16);
          const amount      = parseInt(partsBounty[1]) || 0;
          const crime       = partsBounty.slice(2).join(' ') || 'Crime';
          require('./justice-service').setBounty(actorId, tBounty, amount, crime);
        }
        break;

      case '/criminal':
        if (args) require('./justice-service').showCriminalRecord(actorId, parseInt(args, 16));
        break;

      // ── Fase Beta: Sobrevivência ──────────────────────────────────────────
      case '/survival':
        const survChar = getActiveCharacterData(actorId);
        if (survChar) require('./survival-service').showSurvival(actorId, survChar.characterId);
        break;

      case '/eat':
        if (args) {
          const eatChar = getActiveCharacterData(actorId);
          if (eatChar) require('./survival-service').eatItem(actorId, eatChar.characterId, parseInt(args, 16));
        }
        break;

      case '/drink':
        if (args) {
          const drinkChar = getActiveCharacterData(actorId);
          if (drinkChar) require('./survival-service').drinkItem(actorId, drinkChar.characterId, parseInt(args, 16));
        }
        break;

      case '/sleep':
        const sleepChar = getActiveCharacterData(actorId);
        if (sleepChar) require('./survival-service').sleep(actorId, sleepChar.characterId);
        break;

      // ── Fase Beta: Economia Regional ──────────────────────────────────────
      case '/sell':
        if (args) {
          const sellChar = getActiveCharacterData(actorId);
          const sellParts = args.split(' ');
          if (sellChar) require('./economy-regional').sellToMarket(actorId, sellChar.characterId, parseInt(sellParts[0], 16), parseInt(sellParts[1]) || 1);
        }
        break;

      case '/buy':
        if (args) {
          const buyChar = getActiveCharacterData(actorId);
          const buyParts = args.split(' ');
          if (buyChar) require('./economy-regional').buyFromMarket(actorId, buyChar.characterId, parseInt(buyParts[0], 16), parseInt(buyParts[1]) || 1);
        }
        break;

      case '/market':
        const mkChar = getActiveCharacterData(actorId);
        if (mkChar) require('./economy-regional').showMarketInfo(actorId, mkChar.characterId);
        break;

      case '/holdwithdraw':
        if (args) {
          const hwChar = getActiveCharacterData(actorId);
          if (hwChar) require('./economy-regional').withdrawHoldTreasury(actorId, hwChar.characterId, parseInt(args));
        }
        break;

      case '/settax':
        if (args) {
          const taxParts = args.split(' ');
          require('./economy-regional').setTaxRate(actorId, taxParts[0], parseFloat(taxParts[1]) || 0.05);
        }
        break;

      // ── Fase Beta: Crafting ───────────────────────────────────────────────
      case '/craft':
      case '/forge':
      case '/smelt':
        if (args) {
          const craftChar = getActiveCharacterData(actorId);
          if (craftChar) require('./crafting-service').craftItem(actorId, craftChar.characterId, parseInt(args));
        }
        break;

      case '/recipes':
        if (args) require('./crafting-service').listRecipes(actorId, args.trim());
        break;

      // ── Fase Beta: Facções ────────────────────────────────────────────────
      case '/factions':
        require('./faction-service').listFactions(actorId);
        break;

      case '/factioninfo':
        const fiChar = getActiveCharacterData(actorId);
        if (fiChar) require('./faction-service').showMyFaction(actorId, fiChar.characterId);
        break;

      case '/fdonar':
        if (args) {
          const fdChar = getActiveCharacterData(actorId);
          if (fdChar) require('./faction-service').donate(actorId, fdChar.characterId, parseInt(args));
        }
        break;

      case '/fwithdraw':
        if (args) {
          const fwChar = getActiveCharacterData(actorId);
          if (fwChar) require('./faction-service').withdrawFaction(actorId, fwChar.characterId, parseInt(args));
        }
        break;

      case '/createfaction':
        if (args) {
          const cfParts = args.split(' ');
          require('./faction-service').createFaction(actorId, cfParts[0], cfParts.slice(1).join(' '));
        }
        break;

      case '/addfmember':
        if (args) {
          const afParts = args.split(' ');
          require('./faction-service').addMember(actorId, parseInt(afParts[0], 16), parseInt(afParts[1]), afParts[2] || 'recruit');
        }
        break;

      case '/removefmember':
        if (args) require('./faction-service').removeMember(actorId, parseInt(args, 16));
        break;

      case '/setfhold':
        if (args) {
          const sfhParts = args.split(' ');
          require('./faction-service').setHoldControl(actorId, parseInt(sfhParts[0]), sfhParts[1]);
        }
        break;

      default:
        sendNotification(actorId, `Comando desconhecido: ${command}`);
        break;
    }

  } else {
    // Chat padrao (Falar na taverna/local)
    const charName = getCharacterName(actorId);
    broadcastProximityMessage(actorId, `${charName} diz: ${text}`, 1200);
  }
}

module.exports = {
  registerActiveCharacter,
  removeActiveCharacter,
  getActiveCharacterData,
  handleChatInput,
  broadcastProximityMessage
};

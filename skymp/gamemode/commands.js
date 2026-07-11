const whitelist = require('./whitelist');

// Cache em memoria dos personagens ativos no servidor
// Chave: actorId (number), Valor: { firstName, lastName, accountId, profileId }
const activeCharacters = new Map();

function registerActiveCharacter(actorId, character, accountId, profileId) {
  activeCharacters.set(actorId, {
    firstName: character.first_name,
    lastName: character.last_name,
    accountId: accountId,
    profileId: profileId
  });
  console.log(`[commands] Cached character name for actor ${actorId.toString(16)}: ${character.first_name} ${character.last_name}`);
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

    for (const neighborId of neighbors) {
      if (mp.get(neighborId, 'type') === 'MpActor' && neighborId !== sourceActorId) {
        const neighborLoc = mp.get(neighborId, 'locationalData');
        if (neighborLoc && neighborLoc.pos) {
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

// Tratamento de mensagens digitadas no chat
function handleChatInput(actorId, text) {
  if (!text || typeof text !== 'string') return;
  
  const charName = getCharacterName(actorId);

  // Se comecar com "/", trata-se de um comando
  if (text.startsWith('/')) {
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
      case '/me':
        if (!args) {
          sendNotification(actorId, 'Uso correto: /me <acao>');
          return;
        }
        broadcastProximityMessage(actorId, `* ${charName} ${args}`, 1500);
        break;

      case '/do':
        if (!args) {
          sendNotification(actorId, 'Uso correto: /do <descricao>');
          return;
        }
        broadcastProximityMessage(actorId, `* ${args} (( ${charName} ))`, 1500);
        break;

      case '/ooc':
        if (!args) {
          sendNotification(actorId, 'Uso correto: /ooc <mensagem>');
          return;
        }
        broadcastProximityMessage(actorId, `(( OOC: ${charName}: ${args} ))`, 2000);
        break;

      case '/roll':
        let max = 20;
        if (args) {
          const parsed = parseInt(args);
          if (!isNaN(parsed) && parsed > 0) {
            max = parsed;
          }
        }
        const rollResult = Math.floor(Math.random() * max) + 1;
        broadcastProximityMessage(actorId, `* ${charName} rolou um dado d${max} e tirou: ${rollResult}`, 1500);
        break;

      default:
        sendNotification(actorId, `Comando desconhecido: ${command}`);
        break;
    }
  } else {
    // Chat padrao (Falar na taverna/local)
    broadcastProximityMessage(actorId, `${charName} diz: ${text}`, 1200);
  }
}

module.exports = {
  registerActiveCharacter,
  removeActiveCharacter,
  handleChatInput,
  handleChatInput
};

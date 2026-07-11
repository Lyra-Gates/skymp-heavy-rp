const db = require('./database');
const inventoryService = require('./inventory-service');
const commands = require('./commands');

const ITEM_FIREWOOD = 0x00033760;
const FIREWOOD_PRICE = 5; // 5 Septims por lenha

async function getGold(characterId) {
  const rows = await db.query('SELECT gold FROM characters WHERE id = ?', [characterId]);
  return rows.length > 0 ? rows[0].gold : 0;
}

async function addGold(characterId, amount) {
  if (amount <= 0) return false;
  await db.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [amount, characterId]);
  return true;
}

async function removeGold(characterId, amount) {
  if (amount <= 0) return false;
  const current = await getGold(characterId);
  if (current < amount) return false;

  await db.query('UPDATE characters SET gold = gold - ? WHERE id = ?', [amount, characterId]);
  return true;
}

// Comando: /sellwood
async function sellWood(actorId, characterId) {
  // Verifica quantas lenhas o jogador tem no banco
  const rows = await db.query('SELECT count FROM character_inventory WHERE character_id = ? AND base_id = ?', [characterId, ITEM_FIREWOOD]);
  if (rows.length === 0 || rows[0].count <= 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não tem lenha para vender.']);
    return;
  }

  const amountToSell = rows[0].count;
  const totalReward = amountToSell * FIREWOOD_PRICE;

  // Remove do inventário seguro
  const removed = await inventoryService.removeItem(actorId, characterId, ITEM_FIREWOOD, amountToSell);
  if (removed) {
    await addGold(characterId, totalReward);
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você vendeu ${amountToSell} lenhas por ${totalReward} Ouros.`]);
    }
    console.log(`[economy-service] Character ${characterId} sold ${amountToSell} wood for ${totalReward} gold.`);
  }
}

// Comando: /pay [ActorId_Alvo] [Valor]
async function payPlayer(sourceActorId, sourceCharId, targetActorHex, amountStr) {
  const amount = parseInt(amountStr);
  if (isNaN(amount) || amount <= 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Uso: /pay <id_jogador> <valor>']);
    return;
  }

  // Identifica o target
  const targetActorId = parseInt(targetActorHex, 16);
  if (isNaN(targetActorId) || targetActorId === sourceActorId) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Jogador inválido.']);
    return;
  }

  // Verifica se o alvo esta ativo pegando o character_id dele
  // O commands.js tem o registro dos chars ativos! Porem economy requer commands. 
  // No commands.js adicionaremos uma funcao getCharacterIdFromActor(actorId)
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Jogador não encontrado próximo.']);
    return;
  }

  // Faz a transacao
  const removed = await removeGold(sourceCharId, amount);
  if (!removed) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não tem ouro suficiente.']);
    return;
  }

  await addGold(targetChar.characterId, amount);

  // Notifica ambos
  commands.broadcastProximityMessage(sourceActorId, `* Entrega algumas moedas para a pessoa à frente.`, 500);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você pagou ${amount} Ouro.`]);
  }
  
  // Notifica o recebedor diretamente
  if (typeof mp !== 'undefined') {
    // Isso eh executado no contexto do target
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você recebeu ${amount} Ouro.`]);
  }
  console.log(`[economy-service] Char ${sourceCharId} paid ${amount} gold to Char ${targetChar.characterId}.`);
}

module.exports = {
  getGold,
  addGold,
  removeGold,
  sellWood,
  payPlayer
};

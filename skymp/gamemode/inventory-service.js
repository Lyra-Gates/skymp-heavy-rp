const db = require('./database');

// Sincroniza o inventário do banco de dados para o cliente
async function syncInventoryToClient(actorId, characterId) {
  try {
    // 1. Remove tudo (opcional, pode ser perigoso com itens essenciais, no MVP removeremos apenas os itens farmáveis se necessário)
    // No MVP Server-Authoritative, assumimos que o banco dita as posses do jogador
    const rows = await db.query('SELECT base_id, count FROM character_inventory WHERE character_id = ?', [characterId]);
    
    // Adiciona os itens nativamente
    for (const row of rows) {
      if (typeof mp !== 'undefined') {
        mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorId, [row.base_id, row.count, true]);
      }
    }
    console.log(`[inventory-service] Synced ${rows.length} item types for character ${characterId}`);
  } catch (err) {
    console.error(`[inventory-service] Error syncing inventory for char ${characterId}:`, err.message);
  }
}

// Entrega um item de forma segura (Atualiza DB + Cliente)
async function giveItem(actorId, characterId, baseId, count) {
  try {
    // 1. Atualiza Banco
    const exist = await db.query('SELECT count FROM character_inventory WHERE character_id = ? AND base_id = ?', [characterId, baseId]);
    if (exist.length > 0) {
      await db.query('UPDATE character_inventory SET count = count + ? WHERE character_id = ? AND base_id = ?', [count, characterId, baseId]);
    } else {
      await db.query('INSERT INTO character_inventory (character_id, base_id, count) VALUES (?, ?, ?)', [characterId, baseId, count]);
    }

    // 2. Entrega no Cliente
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorId, [baseId, count, false]);
    }
    return true;
  } catch (err) {
    console.error(`[inventory-service] Failed to give item ${baseId} to ${characterId}:`, err.message);
    return false;
  }
}

// Remove um item de forma segura
async function removeItem(actorId, characterId, baseId, count) {
  try {
    const exist = await db.query('SELECT count FROM character_inventory WHERE character_id = ? AND base_id = ?', [characterId, baseId]);
    if (exist.length === 0 || exist[0].count < count) return false;

    const newCount = exist[0].count - count;
    if (newCount <= 0) {
      await db.query('DELETE FROM character_inventory WHERE character_id = ? AND base_id = ?', [characterId, baseId]);
    } else {
      await db.query('UPDATE character_inventory SET count = ? WHERE character_id = ? AND base_id = ?', [newCount, characterId, baseId]);
    }

    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('method', 'ObjectReference', 'RemoveItem', actorId, [baseId, count, true, null]);
    }
    return true;
  } catch (err) {
    console.error(`[inventory-service] Failed to remove item ${baseId} from ${characterId}:`, err.message);
    return false;
  }
}

// Verifica se possui item
async function hasItem(characterId, baseId, minCount = 1) {
  const rows = await db.query('SELECT count FROM character_inventory WHERE character_id = ? AND base_id = ?', [characterId, baseId]);
  return (rows.length > 0 && rows[0].count >= minCount);
}

module.exports = {
  syncInventoryToClient,
  giveItem,
  removeItem,
  hasItem
};

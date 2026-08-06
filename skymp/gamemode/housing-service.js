const db = require('./database');
// Ver nota em economy-regional.js: ouro so pelo transaction-service.
const transactionService = require('./core/transaction-service');
const commands = require('./commands');

// Cache de containers abertos para evitar conflitos concorrentes
// Chave: objectId (formDesc), Valor: { characterId, openedAt }
const openContainers = new Map();

/**
 * Verifica se um personagem tem acesso a um container.
 * Retorna o container do banco ou null se nao tiver acesso.
 */
async function getContainerAccess(objectId, characterId) {
  const rows = await db.query('SELECT * FROM containers WHERE object_id = ?', [objectId]);
  if (rows.length === 0) {
    // Container nao registrado: qualquer um pode abrir (mundo aberto)
    return { isPublic: true };
  }

  const container = rows[0];

  // Dono tem acesso total
  if (container.owner_character_id === characterId) {
    return { ...container, isOwner: true };
  }

  // Verifica se eh convidado da propriedade associada
  const propRows = await db.query(
    `SELECT p.id FROM properties p
     INNER JOIN property_guests pg ON pg.property_id = p.id
     WHERE p.container_id = ? AND pg.guest_character_id = ?`,
    [container.id, characterId]
  );
  if (propRows.length > 0) {
    return { ...container, isGuest: true };
  }

  return null; // Sem acesso
}

/**
 * Tenta abrir um container. Intercepta a ativacao da porta/bau no servidor.
 */
async function openContainer(actorId, characterId, objectId) {
  try {
    const access = await getContainerAccess(objectId, characterId);
    if (!access) {
      if (typeof mp !== 'undefined') {
        mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Trancado. Você não tem permissão para abrir isto.']);
      }
      return false;
    }

    if (openContainers.has(objectId)) {
      if (typeof mp !== 'undefined') {
        mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Este container já está sendo usado por outra pessoa.']);
      }
      return false;
    }

    openContainers.set(objectId, { characterId, actorId, openedAt: Date.now() });
    console.log(`[housing] Char ${characterId} opened container ${objectId}`);

    // Injeta os itens do container na tela (UI futura ou abertura nativa)
    await syncContainerToClient(actorId, objectId);
    return true;
  } catch (err) {
    console.error(`[housing] Error opening container ${objectId}:`, err.message);
    return false;
  }
}

/**
 * Sincroniza o conteudo do container para a UI do cliente.
 */
async function syncContainerToClient(actorId, objectId) {
  const rows = await db.query(
    `SELECT ci.base_id, ci.count FROM container_inventory ci
     INNER JOIN containers c ON c.id = ci.container_id
     WHERE c.object_id = ?`,
    [objectId]
  );
  // Por ora: notifica o jogador com a contagem de itens
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Container: ${total} item(s).`]);
  }
  // No futuro: envia para a UI CEF via mp.triggerClient(actorId, 'openContainer', rows)
  console.log(`[housing] Synced container ${objectId} for actor ${actorId}: ${rows.length} item types`);
}

/**
 * Fecha o container liberando o lock.
 */
function closeContainer(objectId) {
  if (openContainers.has(objectId)) {
    openContainers.delete(objectId);
    console.log(`[housing] Container ${objectId} closed.`);
  }
}

/**
 * Transfere item do personagem para um container (depositar).
 */
async function depositItem(actorId, characterId, objectId, baseId, count) {
  const session = openContainers.get(objectId);
  if (!session || session.characterId !== characterId) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você precisa abrir o container primeiro.']);
    return false;
  }

  // Garante que o container exista no banco
  let cRows = await db.query('SELECT id FROM containers WHERE object_id = ?', [objectId]);
  if (cRows.length === 0) {
    await db.query('INSERT INTO containers (object_id, owner_character_id) VALUES (?, ?)', [objectId, characterId]);
    cRows = await db.query('SELECT id FROM containers WHERE object_id = ?', [objectId]);
  }
  const containerId = cRows[0].id;

  // Remove do inventário do personagem
  const inventoryService = require('./inventory-service');
  const removed = await inventoryService.removeItem(actorId, characterId, baseId, count);
  if (!removed) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não tem este item.']);
    return false;
  }

  // Adiciona ao container
  const exist = await db.query('SELECT count FROM container_inventory WHERE container_id = ? AND base_id = ?', [containerId, baseId]);
  if (exist.length > 0) {
    await db.query('UPDATE container_inventory SET count = count + ? WHERE container_id = ? AND base_id = ?', [count, containerId, baseId]);
  } else {
    await db.query('INSERT INTO container_inventory (container_id, base_id, count) VALUES (?, ?, ?)', [containerId, baseId, count]);
  }

  console.log(`[housing] Char ${characterId} deposited ${count}x${baseId} into ${objectId}`);
  return true;
}

/**
 * Compra uma propriedade listada para venda.
 */
async function buyProperty(actorId, characterId, propertyId) {
  const propRows = await db.query('SELECT * FROM properties WHERE id = ? AND is_for_sale = 1 AND owner_character_id IS NULL', [propertyId]);
  if (propRows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Esta propriedade não está à venda.']);
    return false;
  }

  const prop = propRows[0];
  const paid = await transactionService.removeGold({ characterId, amount: prop.price_gold, reason: 'property_purchase', module: 'housing' });
  if (!paid) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Ouro insuficiente. Preço: ${prop.price_gold} Septims.`]);
    return false;
  }

  await db.query('UPDATE properties SET owner_character_id = ?, is_for_sale = 0 WHERE id = ?', [characterId, propertyId]);
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você comprou "${prop.name}" por ${prop.price_gold} Septims!`]);
  console.log(`[housing] Char ${characterId} bought property ${propertyId} for ${prop.price_gold} gold.`);
  return true;
}

/**
 * Convida um personagem para uma propriedade.
 */
async function inviteToProperty(ownerCharId, targetCharId, propertyId) {
  const propRows = await db.query('SELECT id FROM properties WHERE id = ? AND owner_character_id = ?', [propertyId, ownerCharId]);
  if (propRows.length === 0) {
    return false;
  }

  await db.query(
    'INSERT IGNORE INTO property_guests (property_id, guest_character_id) VALUES (?, ?)',
    [propertyId, targetCharId]
  );
  console.log(`[housing] Char ${ownerCharId} invited Char ${targetCharId} to property ${propertyId}`);
  return true;
}

module.exports = {
  openContainer,
  closeContainer,
  depositItem,
  buyProperty,
  inviteToProperty,
  getContainerAccess
};

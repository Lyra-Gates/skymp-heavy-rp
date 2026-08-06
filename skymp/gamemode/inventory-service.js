/**
 * inventory-service.js
 *
 * Serviço de inventário com reconciliação para prevenir duplicatas.
 *
 * IMPORTANTE: Este serviço NÃO modifica o banco diretamente.
 * Toda mudança de item usa core/transaction-service para garantir
 * atomicidade e rastreabilidade no ledger.
 *
 * Reconciliação:
 * - No login, o servidor lê o snapshot do banco (character_inventory)
 * - Compara com o que foi entregue nessa sessão (flag em memória)
 * - Só chama AddItem para itens ainda não sincronizados
 * - Divergências são logadas para revisão manual
 */

const db = require('./database');
const transactionService = require('./core/transaction-service');
const { actorRef } = require('./core/papyrus');

// Cache de itens já sincronizados nessa sessão: characterId → Set<baseId>
// Reset automático na desconexão (cleanup via removeActiveCharacter)
const _syncedThisSession = new Map();

/**
 * Sincroniza o inventário do banco de dados para o cliente.
 * Usa reconciliação para prevenir duplicatas em reconexões.
 *
 * @param {number} actorId
 * @param {number} characterId
 */
async function syncInventoryToClient(actorId, characterId) {
  try {
    const rows = await db.query(
      'SELECT base_id, count FROM character_inventory WHERE character_id = ?',
      [characterId]
    );

    // Inicializar set de sincronizados para essa sessão
    if (!_syncedThisSession.has(characterId)) {
      _syncedThisSession.set(characterId, new Set());
    }
    const synced = _syncedThisSession.get(characterId);

    let syncedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      if (synced.has(row.base_id)) {
        // Já foi entregue nessa sessão — pular para prevenir duplicata
        skippedCount++;
        continue;
      }

      if (typeof mp !== 'undefined') {
        try {
          mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorRef(actorId), [row.base_id, row.count, true]);
          synced.add(row.base_id);
          syncedCount++;
        } catch (clientErr) {
          // Falha no cliente: BD está correto, cliente pode ficar divergente
          // Será resolvido na próxima sincronização ou reconexão
          console.error(`[inventory] Aviso: falha ao sincronizar item 0x${row.base_id.toString(16)} para actor ${actorId.toString(16)}:`, clientErr.message);
        }
      } else {
        // Sem runtime mp (ambiente de teste) — apenas marcar como sincronizado
        synced.add(row.base_id);
        syncedCount++;
      }
    }

    console.log(`[inventory] Sync para char ${characterId}: ${syncedCount} itens entregues, ${skippedCount} já sincronizados (total no BD: ${rows.length})`);
    
    if (skippedCount > 0) {
      console.log(`[inventory] Reconciliação: ${skippedCount} itens pulados por já estarem na sessão (previne duplicatas)`);
    }

  } catch (err) {
    console.error(`[inventory] Erro ao sincronizar inventário para char ${characterId}:`, err.message);
  }
}

/**
 * Limpa o cache de sincronização ao desconectar.
 * @param {number} characterId
 */
function clearSyncCache(characterId) {
  _syncedThisSession.delete(characterId);
}

/**
 * Concede um item ao personagem (usa transaction-service).
 * Wrapper de conveniência para código legado que chama inventory-service diretamente.
 *
 * @param {number} actorId
 * @param {number} characterId
 * @param {number} baseId
 * @param {number} count
 * @param {string} [reason]
 * @param {string} [module]
 * @returns {Promise<boolean>}
 */
async function giveItem(actorId, characterId, baseId, count, reason = 'unknown', module = 'inventory') {
  return transactionService.giveItem({ actorId, characterId, baseId, count, reason, module });
}

/**
 * Remove um item do personagem (usa transaction-service).
 *
 * @param {number} actorId
 * @param {number} characterId
 * @param {number} baseId
 * @param {number} count
 * @param {string} [reason]
 * @param {string} [module]
 * @returns {Promise<boolean>}
 */
async function removeItem(actorId, characterId, baseId, count, reason = 'unknown', module = 'inventory') {
  return transactionService.removeItem({ actorId, characterId, baseId, count, reason, module });
}

/**
 * Verifica se o personagem possui quantidade suficiente de item.
 * Usa o banco como fonte de verdade.
 *
 * @param {number} characterId
 * @param {number} baseId
 * @param {number} [minCount]
 * @returns {Promise<boolean>}
 */
async function hasItem(characterId, baseId, minCount = 1) {
  return transactionService.hasItem(characterId, baseId, minCount);
}

module.exports = {
  syncInventoryToClient,
  clearSyncCache,
  giveItem,
  removeItem,
  hasItem
};

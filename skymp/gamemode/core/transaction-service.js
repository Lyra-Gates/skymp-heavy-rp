/**
 * core/transaction-service.js
 *
 * Serviço de transações atômicas para inventário e ouro.
 * TODA mudança de item ou ouro de personagem DEVE passar por aqui.
 *
 * Garante:
 * - Consistência: BD e cliente sempre em sincronia dentro de uma transação
 * - Atomicidade: BEGIN/COMMIT/ROLLBACK via mysql2
 * - Auditoria: ledger em inventory_transactions e gold_transactions
 * - Idempotência: idempotency_key previne duplicatas em retries
 */

const db = require('../database');
const crypto = require('crypto');
const { actorRef } = require('./papyrus');

/**
 * Gera um UUID v4 simples usando o módulo nativo crypto.
 */
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * Registra uma transação de item no ledger.
 * @param {object} conn - Conexão com transação ativa
 * @param {object} opts
 * @param {number} opts.characterId
 * @param {number} opts.baseId
 * @param {number} opts.delta - positivo = ganhou, negativo = perdeu
 * @param {string} opts.reason
 * @param {string} opts.module
 * @param {string|null} opts.idempotencyKey
 */
async function _recordInventoryLedger(conn, opts) {
  const txId = uuid();
  await conn.query(
    `INSERT INTO inventory_transactions
      (transaction_id, character_id, base_id, delta, reason, module, idempotency_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'committed')`,
    [txId, opts.characterId, opts.baseId, opts.delta, opts.reason, opts.module, opts.idempotencyKey || null]
  );
  return txId;
}

/**
 * Registra uma transação de ouro no ledger.
 */
async function _recordGoldLedger(conn, opts) {
  const txId = uuid();
  await conn.query(
    `INSERT INTO gold_transactions
      (transaction_id, character_id, delta, reason, module, idempotency_key, status)
     VALUES (?, ?, ?, ?, ?, ?, 'committed')`,
    [txId, opts.characterId, opts.delta, opts.reason, opts.module, opts.idempotencyKey || null]
  );
  return txId;
}

/**
 * Atualiza character_inventory dentro de uma transação ativa.
 * Não cria nem destrói a transação, apenas executa queries.
 */
async function _applyInventoryDelta(conn, characterId, baseId, delta) {
  // FOR UPDATE trava a linha (ou o gap, se ainda não existir) dentro da transação
  // ativa em conn — uma segunda chamada concorrente pra mesma (characterId, baseId)
  // bloqueia aqui até o commit/rollback da primeira, em vez de ler o mesmo valor
  // obsoleto e sobrescrever (o bug original permitia duplicar/perder itens quando
  // duas operações rodavam em paralelo, ex: stall_add + stall_pack).
  const [rows] = await conn.query(
    'SELECT count FROM character_inventory WHERE character_id = ? AND base_id = ? FOR UPDATE',
    [characterId, baseId]
  );

  if (delta > 0) {
    // Adiciona itens
    if (rows.length > 0) {
      await conn.query(
        'UPDATE character_inventory SET count = count + ? WHERE character_id = ? AND base_id = ?',
        [delta, characterId, baseId]
      );
    } else {
      await conn.query(
        'INSERT INTO character_inventory (character_id, base_id, count) VALUES (?, ?, ?)',
        [characterId, baseId, delta]
      );
    }
  } else {
    // Remove itens (delta é negativo)
    if (rows.length === 0) throw new Error(`Personagem ${characterId} não possui item 0x${baseId.toString(16)}`);
    const currentCount = rows[0].count;
    const remove = Math.abs(delta);
    if (currentCount < remove) throw new Error(`Estoque insuficiente: tem ${currentCount}, precisa ${remove}`);
    const newCount = currentCount - remove;
    if (newCount <= 0) {
      await conn.query('DELETE FROM character_inventory WHERE character_id = ? AND base_id = ?', [characterId, baseId]);
    } else {
      await conn.query('UPDATE character_inventory SET count = ? WHERE character_id = ? AND base_id = ?', [newCount, characterId, baseId]);
    }
  }
}

/**
 * Atualiza o ouro do personagem dentro de uma transação ativa.
 */
async function _applyGoldDelta(conn, characterId, delta) {
  if (delta < 0) {
    // FOR UPDATE serializa débitos concorrentes do mesmo personagem — sem isso,
    // duas remoções simultâneas podem ambas ler o saldo antigo, ambas passar na
    // checagem de saldo suficiente, e o UPDATE relativo (gold = gold + ?) deixar
    // o saldo negativo mesmo assim.
    const [rows] = await conn.query('SELECT gold FROM characters WHERE id = ? FOR UPDATE', [characterId]);
    if (rows.length === 0) throw new Error(`Personagem ${characterId} não encontrado`);
    if (rows[0].gold + delta < 0) throw new Error(`Ouro insuficiente: tem ${rows[0].gold}, precisa ${Math.abs(delta)}`);
  }
  await conn.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [delta, characterId]);
}

/**
 * Aplica a mudança no cliente SkyMP (sem transação BD, apenas side-effect).
 * Chamado APÓS o COMMIT para garantir que o BD é a fonte de verdade.
 * Em caso de falha, o item está no BD mas não no cliente → será corrigido na reconciliação.
 */
function _applyToClient(actorId, baseId, delta) {
  if (typeof mp === 'undefined') return;
  try {
    if (delta > 0) {
      mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorRef(actorId), [baseId, delta, true]);
    } else {
      mp.callPapyrusFunction('method', 'ObjectReference', 'RemoveItem', actorRef(actorId), [baseId, Math.abs(delta), true, null]);
    }
  } catch (err) {
    // Log sem throw: BD já está correto. Reconciliação cuidará do cliente na próxima reconexão.
    console.error(`[transaction] Aviso: falha ao aplicar item 0x${baseId.toString(16)} no cliente ${actorId ? actorId.toString(16) : '?'}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API Pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Concede um item ao personagem (BD + cliente + ledger).
 *
 * @param {object} opts
 * @param {number} opts.actorId      - Actor SkyMP (para aplicar no cliente)
 * @param {number} opts.characterId  - ID do personagem no banco
 * @param {number} opts.baseId       - FormID nativo do Skyrim
 * @param {number} opts.count        - Quantidade a conceder (positivo)
 * @param {string} opts.reason       - Motivo (ex: 'admin_give', 'woodcutting')
 * @param {string} opts.module       - Módulo de origem (ex: 'admin', 'jobs')
 * @param {string} [opts.idempotencyKey] - Chave única para prevenir duplicatas
 * @returns {Promise<boolean>}
 */
async function giveItem(opts) {
  const { actorId, characterId, baseId, count, reason, module: mod, idempotencyKey } = opts;
  if (count <= 0) throw new Error('count deve ser positivo');

  // Verificação de idempotência antes da transação
  if (idempotencyKey) {
    const existing = await db.query(
      'SELECT transaction_id FROM inventory_transactions WHERE idempotency_key = ?',
      [idempotencyKey]
    );
    if (existing.length > 0) {
      console.log(`[transaction] giveItem idempotent skip: key=${idempotencyKey}`);
      return true;
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await _applyInventoryDelta(conn, characterId, baseId, count);
    await _recordInventoryLedger(conn, { characterId, baseId, delta: count, reason, module: mod, idempotencyKey });
    await conn.commit();
    _applyToClient(actorId, baseId, count);
    console.log(`[transaction] giveItem: char=${characterId} item=0x${baseId.toString(16)} x${count} (${reason})`);
    return true;
  } catch (err) {
    await conn.rollback();
    console.error(`[transaction] giveItem falhou: char=${characterId} item=0x${baseId.toString(16)}:`, err.message);
    return false;
  } finally {
    conn.release();
  }
}

/**
 * Remove um item do personagem (BD + cliente + ledger).
 *
 * @param {object} opts
 * @param {number} opts.actorId
 * @param {number} opts.characterId
 * @param {number} opts.baseId
 * @param {number} opts.count
 * @param {string} opts.reason
 * @param {string} opts.module
 * @param {string} [opts.idempotencyKey]
 * @returns {Promise<boolean>}
 */
async function removeItem(opts) {
  const { actorId, characterId, baseId, count, reason, module: mod, idempotencyKey } = opts;
  if (count <= 0) throw new Error('count deve ser positivo');

  if (idempotencyKey) {
    const existing = await db.query(
      'SELECT transaction_id FROM inventory_transactions WHERE idempotency_key = ?',
      [idempotencyKey]
    );
    if (existing.length > 0) {
      console.log(`[transaction] removeItem idempotent skip: key=${idempotencyKey}`);
      return true;
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await _applyInventoryDelta(conn, characterId, baseId, -count);
    await _recordInventoryLedger(conn, { characterId, baseId, delta: -count, reason, module: mod, idempotencyKey });
    await conn.commit();
    _applyToClient(actorId, baseId, -count);
    console.log(`[transaction] removeItem: char=${characterId} item=0x${baseId.toString(16)} x${count} (${reason})`);
    return true;
  } catch (err) {
    await conn.rollback();
    console.error(`[transaction] removeItem falhou: char=${characterId} item=0x${baseId.toString(16)}:`, err.message);
    return false;
  } finally {
    conn.release();
  }
}

/**
 * Transferência atômica de item + ouro entre dois personagens (para trade).
 * Executa tudo em uma única transação: BD é a fonte de verdade.
 *
 * @param {object} opts
 * @param {number} opts.fromActorId
 * @param {number} opts.fromCharacterId
 * @param {number} opts.toActorId
 * @param {number} opts.toCharacterId
 * @param {number} opts.baseId         - Item a transferir (0 se só ouro)
 * @param {number} opts.itemCount      - Quantidade do item
 * @param {number} opts.goldAmount     - Ouro a transferir (0 se só item)
 * @param {string} opts.reason
 * @param {string} opts.module
 * @param {string} [opts.idempotencyKey]
 * @returns {Promise<boolean>}
 */
async function transfer(opts) {
  const {
    fromActorId, fromCharacterId,
    toActorId, toCharacterId,
    baseId, itemCount = 0,
    goldAmount = 0,
    reason, module: mod, idempotencyKey
  } = opts;

  if (idempotencyKey) {
    const existing = await db.query(
      'SELECT transaction_id FROM inventory_transactions WHERE idempotency_key = ? UNION SELECT transaction_id FROM gold_transactions WHERE idempotency_key = ?',
      [idempotencyKey, idempotencyKey]
    );
    if (existing.length > 0) {
      console.log(`[transaction] transfer idempotent skip: key=${idempotencyKey}`);
      return true;
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    if (itemCount > 0 && baseId > 0) {
      await _applyInventoryDelta(conn, fromCharacterId, baseId, -itemCount);
      await _applyInventoryDelta(conn, toCharacterId, baseId, itemCount);
      const itemKey = idempotencyKey ? `${idempotencyKey}_item` : null;
      await _recordInventoryLedger(conn, { characterId: fromCharacterId, baseId, delta: -itemCount, reason, module: mod, idempotencyKey: itemKey ? `${itemKey}_from` : null });
      await _recordInventoryLedger(conn, { characterId: toCharacterId, baseId, delta: itemCount, reason, module: mod, idempotencyKey: itemKey ? `${itemKey}_to` : null });
    }

    if (goldAmount > 0) {
      await _applyGoldDelta(conn, fromCharacterId, -goldAmount);
      await _applyGoldDelta(conn, toCharacterId, goldAmount);
      const goldKey = idempotencyKey ? `${idempotencyKey}_gold` : null;
      await _recordGoldLedger(conn, { characterId: fromCharacterId, delta: -goldAmount, reason, module: mod, idempotencyKey: goldKey ? `${goldKey}_from` : null });
      await _recordGoldLedger(conn, { characterId: toCharacterId, delta: goldAmount, reason, module: mod, idempotencyKey: goldKey ? `${goldKey}_to` : null });
    }

    await conn.commit();

    // Aplicar no cliente após COMMIT
    if (itemCount > 0 && baseId > 0) {
      _applyToClient(fromActorId, baseId, -itemCount);
      _applyToClient(toActorId, baseId, itemCount);
    }

    console.log(`[transaction] transfer: char=${fromCharacterId}→${toCharacterId} item=0x${(baseId||0).toString(16)} x${itemCount} gold=${goldAmount} (${reason})`);
    return true;
  } catch (err) {
    await conn.rollback();
    console.error(`[transaction] transfer falhou:`, err.message);
    return false;
  } finally {
    conn.release();
  }
}

/**
 * Concede ouro a um personagem (BD + ledger), atômico via _applyGoldDelta.
 * @param {object} opts
 * @param {number} opts.characterId
 * @param {number} opts.amount - positivo
 * @param {string} opts.reason
 * @param {string} opts.module
 * @param {string} [opts.idempotencyKey]
 * @returns {Promise<boolean>}
 */
async function addGold(opts) {
  const { characterId, amount, reason, module: mod, idempotencyKey } = opts;
  if (amount <= 0) throw new Error('amount deve ser positivo');

  if (idempotencyKey) {
    const existing = await db.query('SELECT transaction_id FROM gold_transactions WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing.length > 0) {
      console.log(`[transaction] addGold idempotent skip: key=${idempotencyKey}`);
      return true;
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await _applyGoldDelta(conn, characterId, amount);
    await _recordGoldLedger(conn, { characterId, delta: amount, reason, module: mod, idempotencyKey });
    await conn.commit();
    console.log(`[transaction] addGold: char=${characterId} +${amount}g (${reason})`);
    return true;
  } catch (err) {
    await conn.rollback();
    console.error(`[transaction] addGold falhou: char=${characterId}:`, err.message);
    return false;
  } finally {
    conn.release();
  }
}

/**
 * Remove ouro de um personagem (BD + ledger), atômico via _applyGoldDelta —
 * rejeita (retorna false) se o saldo for insuficiente, sem deixar o saldo negativo
 * mesmo sob concorrência (a linha é travada com FOR UPDATE dentro da transação).
 * @param {object} opts
 * @param {number} opts.characterId
 * @param {number} opts.amount - positivo
 * @param {string} opts.reason
 * @param {string} opts.module
 * @param {string} [opts.idempotencyKey]
 * @returns {Promise<boolean>}
 */
async function removeGold(opts) {
  const { characterId, amount, reason, module: mod, idempotencyKey } = opts;
  if (amount <= 0) throw new Error('amount deve ser positivo');

  if (idempotencyKey) {
    const existing = await db.query('SELECT transaction_id FROM gold_transactions WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing.length > 0) {
      console.log(`[transaction] removeGold idempotent skip: key=${idempotencyKey}`);
      return true;
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await _applyGoldDelta(conn, characterId, -amount);
    await _recordGoldLedger(conn, { characterId, delta: -amount, reason, module: mod, idempotencyKey });
    await conn.commit();
    console.log(`[transaction] removeGold: char=${characterId} -${amount}g (${reason})`);
    return true;
  } catch (err) {
    await conn.rollback();
    console.error(`[transaction] removeGold falhou (provavel saldo insuficiente): char=${characterId}:`, err.message);
    return false;
  } finally {
    conn.release();
  }
}

/**
 * Verifica se o personagem possui quantidade suficiente de item.
 * Usa o banco como fonte de verdade (não o inventário do cliente).
 */
async function hasItem(characterId, baseId, minCount = 1) {
  const rows = await db.query(
    'SELECT count FROM character_inventory WHERE character_id = ? AND base_id = ?',
    [characterId, baseId]
  );
  return rows.length > 0 && rows[0].count >= minCount;
}

/**
 * Retorna o ouro atual do personagem.
 */
async function getGold(characterId) {
  const rows = await db.query('SELECT gold FROM characters WHERE id = ?', [characterId]);
  return rows.length > 0 ? rows[0].gold : 0;
}

module.exports = {
  giveItem, removeItem, transfer, hasItem, getGold, addGold, removeGold,

  /**
   * Primitivas que participam de uma transação **do chamador**.
   *
   * ─── Por que isto é exportado ─────────────────────────────────────────────
   *
   * As funções públicas acima abrem a própria conexão e a própria transação.
   * Isso é o certo pra quase tudo, e errado pra uma operação que precisa
   * commitar junto com outra coisa: a compra em barraca move ouro, baixa
   * estoque, credita o vendedor, cobra imposto da cidade e entrega o item —
   * ou tudo acontece, ou nada acontece. Chamar `removeGold()` seguido de
   * `giveItem()` ali seriam duas transações independentes, e uma falha no meio
   * deixaria o comprador sem ouro e sem item.
   *
   * Antes desta exportação o `market-stalls-service` resolvia isso escrevendo
   * o próprio SQL de ouro e de inventário dentro da transação dele — atômico e
   * com ledger, mas era uma segunda implementação de "como mexer em ouro",
   * fora do arquivo que existe pra ser a única. O `FOR UPDATE` do saldo e a
   * proteção contra saldo negativo estavam duplicados; qualquer correção aqui
   * não alcançava lá.
   *
   * ─── Contrato ────────────────────────────────────────────────────────────
   *
   * - Quem chama **abre, commita e faz rollback** da transação. Estas funções
   *   não fazem nenhuma das três.
   * - Elas lançam em caso de regra violada (saldo insuficiente, estoque
   *   insuficiente). O `rollback` é responsabilidade do chamador.
   * - `applyGoldDelta` e `applyInventoryDelta` trancam a linha com `FOR UPDATE`
   *   antes de ler, então duas operações concorrentes no mesmo personagem
   *   serializam em vez de ambas lerem o valor obsoleto.
   * - Mudança de saldo ou de item **sem** o `record*Ledger` correspondente é
   *   ouro ou item sem rastro. Sempre chame os dois.
   * - `applyToClient` é a **única** que roda depois do `commit`, nunca dentro
   *   da transação: o banco é a fonte de verdade, e o cliente é reconciliado
   *   no login se essa chamada falhar.
   *
   * Use as funções públicas sempre que a operação for isolada; use estas só
   * quando ela precisar commitar junto com outra coisa.
   */
  tx: {
    applyGoldDelta: _applyGoldDelta,
    applyInventoryDelta: _applyInventoryDelta,
    recordGoldLedger: _recordGoldLedger,
    recordInventoryLedger: _recordInventoryLedger,
    // Exportada quando o `crafting-service` migrou: ele precisava entregar o
    // resultado no cliente depois do commit, e as três cópias que já existiam
    // desse mesmo `AddItem`/`RemoveItem` (aqui, no `market-stalls-service` e no
    // `inventory-service`) mostraram que a quarta era o caminho errado. É a
    // mesma função que `giveItem`/`removeItem` já usavam por dentro — o que
    // muda é só quem pode chamá-la.
    applyToClient: _applyToClient
  },

  // Exposto só pra teste: garante que o `self` do Papyrus vai como objeto
  // `{type,desc}` e não como FormID cru (ver core/papyrus.js).
  _applyToClient
};

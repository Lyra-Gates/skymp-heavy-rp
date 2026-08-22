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
 * @param {number|null} opts.characterId
 * @param {number} opts.baseId
 * @param {number} opts.delta - positivo = ganhou, negativo = perdeu
 * @param {string} opts.reason
 * @param {string} opts.module
 * @param {string|null} [opts.idempotencyKey]
 * @param {string} [opts.ownerType] - padrão `character` (migration v14)
 * @param {string|number} [opts.ownerRef] - padrão o próprio `characterId`
 * @param {string} [opts.counterpartyType] - o outro lado do movimento
 * @param {string|number} [opts.counterpartyRef]
 * @param {string} [opts.transferId] - UUID compartilhado pelas pernas da mesma transferência
 */
async function _recordInventoryLedger(conn, opts) {
  const txId = uuid();

  // `owner_*` e `counterparty_*` entraram na migration v14 (Inventory
  // Framework). Quem não passa nada continua gravando exatamente a linha de
  // antes: dono `character`, ref igual ao `character_id`, contraparte nula.
  // É o que mantém `giveItem`/`removeItem` e os chamadores das primitivas
  // inalterados enquanto o `core/inventory.js` nomeia os dois lados.
  const ownerType = opts.ownerType || 'character';
  const ownerRef = opts.ownerRef !== undefined && opts.ownerRef !== null
    ? String(opts.ownerRef)
    : String(opts.characterId);

  await conn.query(
    `INSERT INTO inventory_transactions
      (transaction_id, character_id, owner_type, owner_ref,
       counterparty_type, counterparty_ref, transfer_id,
       base_id, delta, reason, module, idempotency_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed')`,
    [
      txId,
      opts.characterId === undefined ? null : opts.characterId,
      ownerType, ownerRef,
      opts.counterpartyType || null, opts.counterpartyRef || null,
      opts.transferId || null,
      opts.baseId, opts.delta, opts.reason, opts.module, opts.idempotencyKey || null
    ]
  );
  return txId;
}

/**
 * Registra uma transação de ouro no ledger.
 *
 * `owner_*` e `counterparty_*` entraram na migration v15 (Economy Framework),
 * com exatamente a forma que a v14 deu ao ledger de item e pelo mesmo motivo:
 * uma venda gravava `-100` no comprador e `+95` no vendedor sem nada ligando as
 * duas linhas (`ECONOMY_FRAMEWORK_AUDIT.md` Achado 1).
 *
 * Quem não passa nada continua gravando exatamente a linha de antes: titular
 * `character`, ref igual ao `character_id`, contraparte nula. É o que mantém
 * `addGold`/`removeGold` e os chamadores das primitivas inalterados enquanto o
 * `core/economy-service.js` nomeia os dois lados.
 *
 * @param {object} conn conexão com transação ativa
 * @param {object} opts
 * @param {number|null} [opts.characterId] preenchido quando o titular é personagem
 * @param {number} opts.delta positivo credita, negativo debita
 * @param {string} opts.reason
 * @param {string} opts.module
 * @param {string} [opts.idempotencyKey]
 * @param {string} [opts.ownerType] padrão `character`
 * @param {string|number} [opts.ownerRef] padrão o próprio `characterId`
 * @param {string} [opts.counterpartyType] o outro lado do movimento
 * @param {string|number} [opts.counterpartyRef]
 * @param {string} [opts.transferId] UUID compartilhado pelas pernas da mesma transferência
 * @param {number} [opts.actorCharacterId] quem pediu o movimento, se não for o titular
 */
async function _recordGoldLedger(conn, opts) {
  const txId = uuid();
  const ownerType = opts.ownerType || 'character';
  const ownerRef = opts.ownerRef !== undefined && opts.ownerRef !== null
    ? String(opts.ownerRef)
    : String(opts.characterId);

  await conn.query(
    `INSERT INTO gold_transactions
      (transaction_id, character_id, owner_type, owner_ref,
       counterparty_type, counterparty_ref, transfer_id, actor_character_id,
       delta, reason, module, idempotency_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed')`,
    [
      txId,
      opts.characterId === undefined ? null : opts.characterId,
      ownerType, ownerRef,
      opts.counterpartyType || null,
      opts.counterpartyRef === undefined || opts.counterpartyRef === null ? null : String(opts.counterpartyRef),
      opts.transferId || null,
      Number.isSafeInteger(opts.actorCharacterId) && opts.actorCharacterId > 0 ? opts.actorCharacterId : null,
      opts.delta, opts.reason, opts.module, opts.idempotencyKey || null
    ]
  );
  return txId;
}

/**
 * Tabelas de pilha `(dono, base_id, count)` que este arquivo sabe escrever.
 *
 * ─── Por que é uma lista fechada, e não um parâmetro ────────────────────────
 *
 * `_applyStackDelta` monta SQL com o nome da tabela e da coluna interpolados —
 * um placeholder `?` não funciona para identificador. Uma lista fechada aqui é
 * o que torna essa interpolação segura por construção: nenhum nome vindo de
 * módulo, de configuração ou de payload chega ao SQL. Um dono novo entra
 * editando este objeto, sob revisão, que é o mesmo critério da lista de origens
 * do `core/inventory-owner.js`.
 *
 * `market_stall_items` **não está aqui de propósito**: ela carrega preço,
 * rótulo e status por anúncio, então não é uma pilha. Ver
 * `docs/research/INVENTORY_TRADE_CRAFTING_AUDIT.md` §1.1.
 */
const STACK_TABLES = Object.freeze({
  character_inventory: 'character_id',
  container_inventory: 'container_id',
  // Depot Service (migration-v20-depot-service.sql): armazém regional, mesma
  // forma (dono, base_id, count) das duas tabelas acima. Depósito/saque
  // atômico é duas chamadas de `applyStackDelta` (character_inventory +
  // depot_inventory) na mesma transação do chamador — ver core/depot-service.js.
  depot_inventory: 'depot_id'
});

/**
 * O maior valor que cabe em `count INT` do MySQL.
 *
 * A guarda existe porque `UPDATE ... SET count = count + ?` no modo não-estrito
 * satura silenciosamente em vez de falhar: um jogador com 2.147.483.000 flechas
 * recebendo mais 1.000 ficaria com 2.147.483.647, e a diferença viraria item
 * destruído sem nenhuma linha explicando. Melhor recusar a operação.
 */
const MAX_STACK_COUNT = 2147483647;

/**
 * Atualiza uma tabela de pilha dentro de uma transação **do chamador**.
 * Não cria nem destrói a transação, apenas executa queries.
 *
 * Generalizada em 13/08/2026: era `character_inventory` fixa, e o
 * `core/inventory.js` precisa da mesma semântica (o `FOR UPDATE`, a recusa por
 * estoque insuficiente, o `DELETE` quando zera) para container. Duas cópias
 * disso é o defeito que a exportação das primitivas `tx.*` existe para não ter.
 *
 * ─── Validação ─────────────────────────────────────────────────────────────
 *
 * Ela é nova e é o §6 da auditoria: as funções públicas (`giveItem`,
 * `removeItem`) checavam `count <= 0`, e esta primitiva — que é a exportada,
 * usada direto por crafting e barraca — não checava nada. `delta = NaN` caía no
 * ramo de remoção, passava pela comparação (`x < NaN` é sempre `false`) e
 * escrevia `count = NaN`.
 *
 * @param {object} conn conexão com transação ativa
 * @param {string} table uma chave de `STACK_TABLES`
 * @param {number} ownerId valor da coluna de dono
 * @param {number} baseId FormID
 * @param {number} delta positivo credita, negativo debita; zero é recusado
 */
async function _applyStackDelta(conn, table, ownerId, baseId, delta) {
  const ownerColumn = STACK_TABLES[table];
  if (!ownerColumn) {
    throw new Error(`[transaction] tabela de pilha desconhecida: ${JSON.stringify(table)}`);
  }
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    throw new Error(`[transaction] dono invalido em ${table}: ${JSON.stringify(ownerId)}`);
  }
  if (!Number.isSafeInteger(baseId) || baseId <= 0) {
    throw new Error(`[transaction] baseId invalido: ${JSON.stringify(baseId)}`);
  }
  // `delta = 0` é recusado, não ignorado: ele chegaria aqui vindo de um cálculo
  // que deu errado em algum lugar, e gravar uma linha de ledger com delta zero
  // esconderia esse erro atrás de uma operação "bem-sucedida".
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new Error(`[transaction] delta invalido para 0x${Number(baseId).toString(16)}: ${JSON.stringify(delta)}`);
  }

  // FOR UPDATE trava a linha (ou o gap, se ainda não existir) dentro da transação
  // ativa em conn — uma segunda chamada concorrente pra mesma (dono, base_id)
  // bloqueia aqui até o commit/rollback da primeira, em vez de ler o mesmo valor
  // obsoleto e sobrescrever (o bug original permitia duplicar/perder itens quando
  // duas operações rodavam em paralelo, ex: stall_add + stall_pack).
  const [rows] = await conn.query(
    `SELECT count FROM ${table} WHERE ${ownerColumn} = ? AND base_id = ? FOR UPDATE`,
    [ownerId, baseId]
  );

  if (delta > 0) {
    const atual = rows.length > 0 ? Number(rows[0].count) : 0;
    if (atual + delta > MAX_STACK_COUNT) {
      throw new Error(`Pilha cheia: ${atual} + ${delta} passa do limite de ${MAX_STACK_COUNT}`);
    }
    if (rows.length > 0) {
      await conn.query(
        `UPDATE ${table} SET count = count + ? WHERE ${ownerColumn} = ? AND base_id = ?`,
        [delta, ownerId, baseId]
      );
    } else {
      await conn.query(
        `INSERT INTO ${table} (${ownerColumn}, base_id, count) VALUES (?, ?, ?)`,
        [ownerId, baseId, delta]
      );
    }
  } else {
    // Remove itens (delta é negativo)
    if (rows.length === 0) {
      throw new Error(`Dono ${ownerId} não possui item 0x${baseId.toString(16)}`);
    }
    const currentCount = Number(rows[0].count);
    const remove = Math.abs(delta);
    if (currentCount < remove) throw new Error(`Estoque insuficiente: tem ${currentCount}, precisa ${remove}`);
    const newCount = currentCount - remove;
    if (newCount <= 0) {
      await conn.query(`DELETE FROM ${table} WHERE ${ownerColumn} = ? AND base_id = ?`, [ownerId, baseId]);
    } else {
      await conn.query(
        `UPDATE ${table} SET count = ? WHERE ${ownerColumn} = ? AND base_id = ?`,
        [newCount, ownerId, baseId]
      );
    }
  }
}

/**
 * Atualiza `character_inventory` dentro de uma transação ativa.
 * Continua sendo o nome que crafting e barraca chamam; hoje é um apelido de
 * `_applyStackDelta` com a tabela do personagem.
 */
async function _applyInventoryDelta(conn, characterId, baseId, delta) {
  return _applyStackDelta(conn, 'character_inventory', characterId, baseId, delta);
}

/**
 * O maior valor que cabe em `characters.gold INT` do MySQL.
 *
 * Existe pelo mesmo motivo que `MAX_STACK_COUNT`: `gold = gold + ?` no modo
 * não-estrito satura em silêncio em vez de falhar, e a diferença vira
 * patrimônio destruído sem nenhuma linha explicando. A assimetria — teto para
 * item, nenhum para ouro — era o Achado 4 de `ECONOMY_FRAMEWORK_AUDIT.md`.
 */
const MAX_GOLD = 2147483647;

/**
 * Atualiza o ouro do personagem dentro de uma transação **do chamador**.
 *
 * ─── Validação ──────────────────────────────────────────────────────────────
 *
 * Ela é nova e é o Achado 3 da auditoria de economia — o mesmo defeito que o §6
 * da auditoria de inventário corrigiu para item e não propagou para dinheiro. A
 * versão anterior não validava nada: `delta = NaN` caía fora do ramo de débito
 * (`NaN < 0` é `false`), chegava ao `UPDATE` e gravava `gold = gold + NaN`, que
 * o MySQL não-estrito grava como `0` — **o patrimônio do jogador zerava em
 * silêncio**. É a mesma classe do bug que o `/setgold` já teve.
 *
 * `delta = 0` é recusado, não ignorado, pela mesma razão do caminho de item:
 * ele chegaria aqui vindo de um cálculo que deu errado, e gravar uma linha de
 * ledger com delta zero esconderia esse erro atrás de uma operação
 * "bem-sucedida".
 *
 * ─── Por que o SELECT agora acontece nos dois sentidos ──────────────────────
 *
 * Antes, só o débito lia a linha. O crédito ia direto ao `UPDATE`, o que tinha
 * três consequências: creditar um personagem inexistente afetava 0 linhas sem
 * ninguém checar, não havia como recusar estouro do `INT`, e a ordem em que as
 * linhas eram travadas dependia do sentido da operação — que é o que produz o
 * deadlock de compra cruzada (Achado 10). Ler sempre custa uma query e resolve
 * os três; a ordenação canônica de travas fica a cargo do `economy-service`.
 */
async function _applyGoldDelta(conn, characterId, delta) {
  if (!Number.isSafeInteger(characterId) || characterId <= 0) {
    throw new Error(`[transaction] personagem invalido para ouro: ${JSON.stringify(characterId)}`);
  }
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new Error(`[transaction] delta de ouro invalido: ${JSON.stringify(delta)}`);
  }

  // FOR UPDATE serializa operações concorrentes do mesmo personagem — sem isso,
  // duas remoções simultâneas podem ambas ler o saldo antigo, ambas passar na
  // checagem de saldo suficiente, e o UPDATE relativo (gold = gold + ?) deixar
  // o saldo negativo mesmo assim.
  const [rows] = await conn.query('SELECT gold FROM characters WHERE id = ? FOR UPDATE', [characterId]);
  if (rows.length === 0) throw new Error(`Personagem ${characterId} não encontrado`);
  const atual = Number(rows[0].gold);

  if (delta < 0) {
    if (atual + delta < 0) throw new Error(`Ouro insuficiente: tem ${atual}, precisa ${Math.abs(delta)}`);
  } else if (atual + delta > MAX_GOLD) {
    throw new Error(`Patrimonio cheio: ${atual} + ${delta} passa do limite de ${MAX_GOLD}`);
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
    // Generalização de `applyInventoryDelta` para qualquer tabela de
    // `STACK_TABLES`. Quem usa é `core/inventory.js`, que precisa da mesma
    // semântica de lock e de recusa para container.
    applyStackDelta: _applyStackDelta,
    STACK_TABLES,
    MAX_STACK_COUNT,
    MAX_GOLD,
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

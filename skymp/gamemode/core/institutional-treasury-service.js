/**
 * Movimentacoes entre tesouros institucionais.
 *
 * Ouro de Hold e de faccao nao pertence a um personagem, portanto nao deve
 * usar gold_transactions. Este servico cria sua propria fronteira atomica e
 * ledger, para que um debito nunca sobreviva sem o credito correspondente.
 */

const crypto = require('crypto');
const database = require('../database');
const governanceService = require('../governance-service');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function normalizePositiveAmount(value) {
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null;
  const amount = typeof value === 'string' ? Number(value) : value;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) return uuid();
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key.length >= 8 && key.length <= 64 ? key : null;
}

async function commitResult(conn, result) {
  await conn.commit();
  return result;
}

/**
 * Transfere tesouro de um Hold para sua faccao regente.
 *
 * @param {{characterId:number, holdId:string, amount:number|string, idempotencyKey?:string}} request
 * @param {{db?: typeof database, governance?: typeof governanceService}} [dependencies]
 */
async function transferHoldTreasury(request, dependencies = {}) {
  const db = dependencies.db || database;
  const governance = dependencies.governance || governanceService;
  const amount = normalizePositiveAmount(request?.amount);
  const idempotencyKey = normalizeIdempotencyKey(request?.idempotencyKey);

  if (!Number.isSafeInteger(request?.characterId) || request.characterId <= 0) {
    return { ok: false, code: 'invalid_character' };
  }
  if (typeof request?.holdId !== 'string' || request.holdId.length === 0 || request.holdId.length > 32) {
    return { ok: false, code: 'invalid_hold' };
  }
  if (!amount) return { ok: false, code: 'invalid_amount' };
  if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Todas as transferencias do mesmo Hold passam por esta trava. O cache nao
    // participa da decisao financeira: ele pode estar alguns minutos atrasado.
    const [holdRows] = await conn.query(
      'SELECT id, treasury, ruling_faction_id FROM holds WHERE id = ? FOR UPDATE',
      [request.holdId]
    );
    const hold = holdRows[0];
    if (!hold) {
      return await commitResult(conn, { ok: false, code: 'hold_not_found' });
    }

    // Repeticao da mesma requisicao devolve o resultado original sem mover ouro
    // novamente. Como o Hold ja esta travado, duas chamadas concorrentes tambem
    // se serializam neste ponto.
    const [existingRows] = await conn.query(
      'SELECT transfer_id, faction_id, amount FROM institutional_treasury_transactions WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    if (existingRows[0]) {
      return await commitResult(conn, {
        ok: true,
        replayed: true,
        transferId: existingRows[0].transfer_id,
        factionId: existingRows[0].faction_id,
        amount: existingRows[0].amount
      });
    }

    if (!hold.ruling_faction_id) {
      return await commitResult(conn, { ok: false, code: 'no_ruling_faction' });
    }

    // A mesma conexao le o cargo durante a transacao. Assim a autorizacao e os
    // saldos nao dependem de dois snapshots distintos do pool.
    const membership = await governance.getMembership(
      request.characterId,
      'faction',
      hold.ruling_faction_id,
      conn
    );
    if (!membership || membership.role_name !== 'leader') {
      return await commitResult(conn, { ok: false, code: 'not_ruling_leader' });
    }

    const [debit] = await conn.query(
      'UPDATE holds SET treasury = treasury - ? WHERE id = ? AND treasury >= ?',
      [amount, hold.id, amount]
    );
    if (debit.affectedRows !== 1) {
      return await commitResult(conn, { ok: false, code: 'insufficient_treasury', treasury: hold.treasury });
    }

    const [credit] = await conn.query(
      'UPDATE factions SET treasury = treasury + ? WHERE id = ?',
      [amount, hold.ruling_faction_id]
    );
    if (credit.affectedRows !== 1) {
      throw new Error(`Faccao regente ${hold.ruling_faction_id} nao existe para hold ${hold.id}`);
    }

    const transferId = uuid();
    await conn.query(
      `INSERT INTO institutional_treasury_transactions
        (transfer_id, idempotency_key, actor_character_id, hold_id, faction_id, amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [transferId, idempotencyKey, request.characterId, hold.id, hold.ruling_faction_id, amount]
    );

    return await commitResult(conn, {
      ok: true,
      replayed: false,
      transferId,
      factionId: hold.ruling_faction_id,
      amount
    });
  } catch (err) {
    try { await conn.rollback(); } catch { /* preserva o erro original */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  transferHoldTreasury,
  normalizePositiveAmount,
  normalizeIdempotencyKey
};

/** Transacoes atomicas do mercado regional (NPC). */

const crypto = require('crypto');
const database = require('../database');
const transactionService = require('./transaction-service');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function positiveInteger(value) {
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null;
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function idempotencyKey(value) {
  if (value === undefined || value === null) return uuid();
  if (typeof value !== 'string') return null;
  const key = value.trim();
  // Os ledgers de ouro e inventario usam sufixos distintos desta chave. O
  // limite deixa espaco para ambos dentro do VARCHAR(64) da tabela regional e
  // continua aceitando UUIDs e requestIds normais da UI.
  return key.length >= 8 && key.length <= 48 ? key : null;
}

function baseValue(entry) {
  return Number.isSafeInteger(entry?.buy_price) && entry.buy_price > 0 ? entry.buy_price : 15;
}

function buyPrice(stock, value) {
  let price = value * 1.8;
  if (stock <= 30) price *= 1.4;
  if (stock >= 70) price *= 0.8;
  return Math.max(1, Math.floor(price));
}

function sellPrice(stock, value) {
  let price = value * 0.4;
  if (stock >= 70) price *= 0.5;
  if (stock <= 30) price *= 1.5;
  return Math.max(1, Math.floor(price));
}

function validate(request) {
  const count = positiveInteger(request?.count);
  if (!Number.isSafeInteger(request?.characterId) || request.characterId <= 0) return { code: 'invalid_character' };
  if (!Number.isSafeInteger(request?.actorId) || request.actorId <= 0) return { code: 'invalid_actor' };
  if (typeof request?.holdId !== 'string' || request.holdId.length === 0 || request.holdId.length > 32) return { code: 'invalid_hold' };
  if (!Number.isSafeInteger(request?.baseId) || request.baseId <= 0) return { code: 'invalid_item' };
  // O estoque e limitado a 100; permitir uma quantidade maior nao tem caso de
  // uso e transforma um erro de UI em uma operacao desnecessariamente grande.
  if (!count || count > 100) return { code: 'invalid_count' };
  const key = idempotencyKey(request?.idempotencyKey);
  if (!key) return { code: 'invalid_idempotency_key' };
  return { count, key };
}

async function replay(conn, key) {
  const [rows] = await conn.query(
    `SELECT transaction_id, direction, unit_price, gross_amount, tax_amount
     FROM regional_market_transactions WHERE idempotency_key = ? LIMIT 1`,
    [key]
  );
  return rows[0] || null;
}

async function record(conn, values) {
  const transactionId = uuid();
  await conn.query(
    `INSERT INTO regional_market_transactions
      (transaction_id, idempotency_key, actor_character_id, hold_id, direction,
       base_id, count, unit_price, gross_amount, tax_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [transactionId, values.key, values.characterId, values.holdId, values.direction,
      values.baseId, values.count, values.unitPrice, values.gross, values.tax]
  );
  return transactionId;
}

async function buy(request, dependencies = {}) {
  const valid = validate(request);
  if (valid.code) return { ok: false, code: valid.code };
  const db = dependencies.db || database;
  const tx = dependencies.tx || transactionService.tx;
  const conn = await db.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();
    const [priceRows] = await conn.query(
      'SELECT hold_id, base_id, buy_price, sell_price, stock FROM market_prices WHERE hold_id = ? AND base_id = ? FOR UPDATE',
      [request.holdId, request.baseId]
    );
    const priceEntry = priceRows[0];
    const prior = await replay(conn, valid.key);
    if (prior) return await finish(conn, replayResult(prior), () => { committed = true; });
    if (!priceEntry || priceEntry.stock < valid.count) return await finish(conn, { ok: false, code: 'out_of_stock' }, () => { committed = true; });

    const unitPrice = buyPrice(priceEntry.stock, baseValue(priceEntry));
    const gross = unitPrice * valid.count;
    await tx.applyGoldDelta(conn, request.characterId, -gross);
    await tx.applyInventoryDelta(conn, request.characterId, request.baseId, valid.count);
    const [stockUpdate] = await conn.query(
      'UPDATE market_prices SET stock = stock - ? WHERE hold_id = ? AND base_id = ? AND stock >= ?',
      [valid.count, request.holdId, request.baseId, valid.count]
    );
    if (stockUpdate.affectedRows !== 1) throw new Error('Estoque regional mudou durante a compra');
    await tx.recordGoldLedger(conn, { characterId: request.characterId, delta: -gross, reason: 'regional_purchase', module: 'economy-regional', idempotencyKey: `${valid.key}:gold` });
    await tx.recordInventoryLedger(conn, { characterId: request.characterId, baseId: request.baseId, delta: valid.count, reason: 'regional_purchase', module: 'economy-regional', idempotencyKey: `${valid.key}:inventory` });
    const transactionId = await record(conn, { key: valid.key, characterId: request.characterId, holdId: request.holdId, direction: 'buy', baseId: request.baseId, count: valid.count, unitPrice, gross, tax: 0 });
    await conn.commit();
    committed = true;
    tx.applyToClient(request.actorId, request.baseId, valid.count);
    return { ok: true, replayed: false, transactionId, unitPrice, gross, tax: 0 };
  } catch (err) {
    if (!committed) await safeRollback(conn);
    throw err;
  } finally {
    conn.release();
  }
}

async function sell(request, dependencies = {}) {
  const valid = validate(request);
  if (valid.code) return { ok: false, code: valid.code };
  const db = dependencies.db || database;
  const tx = dependencies.tx || transactionService.tx;
  const conn = await db.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();
    const [holdRows] = await conn.query('SELECT id, tax_rate FROM holds WHERE id = ? FOR UPDATE', [request.holdId]);
    const hold = holdRows[0];
    if (!hold) return await finish(conn, { ok: false, code: 'hold_not_found' }, () => { committed = true; });
    const [priceRows] = await conn.query(
      'SELECT hold_id, base_id, buy_price, sell_price, stock FROM market_prices WHERE hold_id = ? AND base_id = ? FOR UPDATE',
      [request.holdId, request.baseId]
    );
    const priceEntry = priceRows[0];
    const prior = await replay(conn, valid.key);
    if (prior) return await finish(conn, replayResult(prior), () => { committed = true; });

    const stock = priceEntry ? priceEntry.stock : 50;
    const unitPrice = sellPrice(stock, baseValue(priceEntry));
    const gross = unitPrice * valid.count;
    const tax = Math.ceil(gross * Number(hold.tax_rate || 0));
    const net = gross - tax;
    await tx.applyInventoryDelta(conn, request.characterId, request.baseId, -valid.count);
    await tx.applyGoldDelta(conn, request.characterId, net);
    if (tax > 0) await conn.query('UPDATE holds SET treasury = treasury + ? WHERE id = ?', [tax, hold.id]);
    await conn.query(
      `INSERT INTO market_prices (hold_id, base_id, sell_price, buy_price, stock)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE stock = LEAST(stock + ?, 100), sell_price = VALUES(sell_price), buy_price = VALUES(buy_price)`,
      [request.holdId, request.baseId, unitPrice, buyPrice(stock, baseValue(priceEntry)), Math.min(100, 50 + valid.count), valid.count]
    );
    await tx.recordInventoryLedger(conn, { characterId: request.characterId, baseId: request.baseId, delta: -valid.count, reason: 'regional_sale', module: 'economy-regional', idempotencyKey: `${valid.key}:inventory` });
    await tx.recordGoldLedger(conn, { characterId: request.characterId, delta: net, reason: 'regional_sale', module: 'economy-regional', idempotencyKey: `${valid.key}:gold` });
    const transactionId = await record(conn, { key: valid.key, characterId: request.characterId, holdId: request.holdId, direction: 'sell', baseId: request.baseId, count: valid.count, unitPrice, gross, tax });
    await conn.commit();
    committed = true;
    tx.applyToClient(request.actorId, request.baseId, -valid.count);
    return { ok: true, replayed: false, transactionId, unitPrice, gross, tax, net };
  } catch (err) {
    if (!committed) await safeRollback(conn);
    throw err;
  } finally {
    conn.release();
  }
}

async function finish(conn, result, committed) {
  await conn.commit();
  committed();
  return result;
}

async function safeRollback(conn) {
  try { await conn.rollback(); } catch { /* preserva o erro original */ }
}

function replayResult(row) {
  return { ok: true, replayed: true, transactionId: row.transaction_id, unitPrice: row.unit_price, gross: row.gross_amount, tax: row.tax_amount };
}

module.exports = { buy, sell, buyPrice, sellPrice, positiveInteger, idempotencyKey };

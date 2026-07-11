/**
 * economy-regional.js
 * Economia Regional com Oferta, Demanda e Impostos por Hold (Fase Beta).
 *
 * Mecânica:
 * - Cada Hold tem preços de compra/venda independentes.
 * - Estoque (stock) cai quando jogadores vendem; sobe com tempo.
 * - Quando estoque está alto (saturado), o preço de venda cai (oferta>demanda).
 * - Quando estoque está baixo, o preço de venda sobe (demanda>oferta).
 * - Sobre toda transação, um imposto (tax_rate do Hold) vai ao tesouro regional.
 */

const db = require('./database');
const economy = require('./economy-service');
const admin = require('./admin-service');
const commands = require('./commands');

// Hold atual de cada personagem (será detectado por posição futuramente)
// Por ora, 'whiterun' como padrão
const characterHold = new Map(); // characterId -> holdId

// Cache dos preços (recarregado a cada 5min)
let pricesCache = {};
let holdCache   = {};

async function loadCache() {
  const holds = await db.query('SELECT * FROM holds');
  holdCache = {};
  for (const h of holds) holdCache[h.id] = h;

  const prices = await db.query('SELECT * FROM market_prices');
  pricesCache = {};
  for (const p of prices) {
    if (!pricesCache[p.hold_id]) pricesCache[p.hold_id] = {};
    pricesCache[p.hold_id][p.base_id] = p;
  }
  console.log(`[economy-regional] Cache loaded: ${holds.length} holds, ${prices.length} price entries.`);
}

setInterval(loadCache, 5 * 60 * 1000);

async function initRegionalEconomy() {
  await loadCache();
  // Ticker de restoque: a cada 15 minutos restaura 5% do estoque
  setInterval(restockTick, 15 * 60 * 1000);
  console.log('[economy-regional] Regional economy initialized.');
}

async function restockTick() {
  await db.query('UPDATE market_prices SET stock = LEAST(stock + 5, 100)');
  await loadCache();
}

/**
 * Retorna o preço de venda ajustado pela oferta atual do mercado.
 */
function getDynamicSellPrice(holdId, baseId, basePrice) {
  const entry = pricesCache[holdId]?.[baseId];
  if (!entry) return basePrice;

  const stock = entry.stock;
  // 0~30: preço alto (+30%). 31~70: normal. 71~100: baixo (-20%)
  if (stock <= 30) return Math.floor(basePrice * 1.3);
  if (stock >= 70) return Math.floor(basePrice * 0.8);
  return basePrice;
}

/**
 * /sell [baseId] [qty] — Vende item ao mercado regional do Hold atual.
 */
async function sellToMarket(actorId, characterId, baseId, qty = 1) {
  const holdId = characterHold.get(characterId) || 'whiterun';
  const hold   = holdCache[holdId];
  if (!hold) return;

  // Verifica inventário
  const inventoryService = require('./inventory-service');
  const has = await inventoryService.hasItem(characterId, baseId, qty);
  if (!has) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não tem itens suficientes.']);
    return;
  }

  // Calcula preço
  const baseSell = pricesCache[holdId]?.[baseId]?.sell_price || 5;
  const price    = getDynamicSellPrice(holdId, baseId, baseSell);
  const gross    = price * qty;
  const tax      = Math.ceil(gross * hold.tax_rate);
  const net      = gross - tax;

  // Executa transação
  await inventoryService.removeItem(actorId, characterId, baseId, qty);
  await economy.addGold(characterId, net);

  // Acumula imposto no tesouro do Hold
  await db.query('UPDATE holds SET treasury = treasury + ? WHERE id = ?', [tax, holdId]);

  // Reduz o estoque no mercado
  await db.query(
    'INSERT INTO market_prices (hold_id, base_id, sell_price, buy_price, stock) VALUES (?, ?, ?, ?, 95) ON DUPLICATE KEY UPDATE stock = GREATEST(stock - ?, 0)',
    [holdId, baseId, baseSell, Math.floor(baseSell * 1.4), qty]
  );

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
      `Vendeu ${qty}x item por ${net}g (imposto: ${tax}g para ${hold.name}).`
    ]);
  }
  console.log(`[economy-regional] Char ${characterId} sold ${qty}x 0x${baseId.toString(16)} for ${net}g (+${tax}g tax) in ${holdId}`);
}

/**
 * /buyitem [baseId] [qty] — Compra item do mercado regional.
 */
async function buyFromMarket(actorId, characterId, baseId, qty = 1) {
  const holdId = characterHold.get(characterId) || 'whiterun';
  const entry  = pricesCache[holdId]?.[baseId];
  if (!entry || entry.stock < qty) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Item indisponível neste mercado.']);
    return;
  }

  const totalCost = entry.buy_price * qty;
  const paid = await economy.removeGold(characterId, totalCost);
  if (!paid) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Ouro insuficiente. Necessário: ${totalCost}g.`]);
    return;
  }

  const inventoryService = require('./inventory-service');
  await inventoryService.giveItem(actorId, characterId, baseId, qty);
  await db.query('UPDATE market_prices SET stock = GREATEST(stock - ?, 0) WHERE hold_id=? AND base_id=?', [qty, holdId, baseId]);
  await loadCache();

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Comprou ${qty}x item por ${totalCost}g.`]);
  }
}

/**
 * /marketinfo — Exibe preços do mercado local do Hold atual.
 */
async function showMarketInfo(actorId, characterId) {
  const holdId = characterHold.get(characterId) || 'whiterun';
  const hold   = holdCache[holdId];
  if (!hold) return;

  const prices = Object.values(pricesCache[holdId] || {}).slice(0, 5);
  if (prices.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Mercado sem itens registrados.']);
    return;
  }

  const summary = prices.map(p => `0x${p.base_id.toString(16)}: compra=${p.buy_price}g, venda=${p.sell_price}g (${p.stock})`).join(' | ');
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`[${hold.name}] ${summary}`]);
}

/**
 * Atualiza o Hold atual de um personagem (chamado por detecção de posição).
 */
function setCharacterHold(characterId, holdId) {
  characterHold.set(characterId, holdId);
}

/**
 * Staff: /settax [holdId] [rate] — Define imposto de um Hold.
 */
async function setTaxRate(actorId, holdId, rate) {
  if (!admin.hasPermission(actorId, 20)) return;
  await db.query('UPDATE holds SET tax_rate = ? WHERE id = ?', [rate, holdId]);
  await loadCache();
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Imposto de ${holdId} definido para ${(rate * 100).toFixed(1)}%.`]);
  const ch = commands.getActiveCharacterData(actorId);
  await admin.auditLog(ch?.accountId, null, 'economy:setTax', `hold=${holdId} rate=${rate}`);
}

module.exports = {
  initRegionalEconomy,
  sellToMarket,
  buyFromMarket,
  showMarketInfo,
  setCharacterHold,
  setTaxRate
};

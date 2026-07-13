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

function getBaseValue(entry) {
  if (!entry) return 15; // default base value
  // Usamos o buy_price do DB como base
  return entry.buy_price || 15;
}

/**
 * Preco que o NPC paga ao jogador (Spread punitivo: 40% do base)
 */
function getDynamicSellPrice(stock, baseValue) {
  let price = baseValue * 0.4;
  if (stock >= 70) price *= 0.5; // Muito estoque = paga miseria
  if (stock <= 30) price *= 1.5; // Pouco estoque = paga um pouco melhor
  return Math.max(1, Math.floor(price));
}

/**
 * Preco que o NPC cobra do jogador (Spread punitivo: 180% do base)
 */
function getDynamicBuyPrice(stock, baseValue) {
  let price = baseValue * 1.8;
  if (stock <= 30) price *= 1.4; // Pouco estoque = cobra absurdo
  if (stock >= 70) price *= 0.8; // Muito estoque = cobra um pouco menos
  return Math.max(1, Math.floor(price));
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

  // Calcula preço punitivo
  const entry = pricesCache[holdId]?.[baseId];
  const baseValue = getBaseValue(entry);
  const currentStock = entry ? entry.stock : 50;
  const price = getDynamicSellPrice(currentStock, baseValue);

  const gross    = price * qty;
  const tax      = Math.ceil(gross * hold.tax_rate);
  const net      = gross - tax;

  // Executa transação
  await inventoryService.removeItem(actorId, characterId, baseId, qty);
  await economy.addGold(characterId, net);

  // Acumula imposto no tesouro do Hold
  await db.query('UPDATE holds SET treasury = treasury + ? WHERE id = ?', [tax, holdId]);

  // Aumenta o estoque no mercado
  await db.query(
    'INSERT INTO market_prices (hold_id, base_id, sell_price, buy_price, stock) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE stock = LEAST(stock + ?, 100)',
    [holdId, baseId, price, getDynamicBuyPrice(currentStock, baseValue), Math.min(100, 50 + qty), qty]
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

  const baseValue = getBaseValue(entry);
  const unitPrice = getDynamicBuyPrice(entry.stock, baseValue);
  const totalCost = unitPrice * qty;
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

  const summary = prices.map(p => {
    const base = getBaseValue(p);
    const buy = getDynamicBuyPrice(p.stock, base);
    const sell = getDynamicSellPrice(p.stock, base);
    return `0x${p.base_id.toString(16)}: compra=${buy}g, venda=${sell}g (estoque:${p.stock})`;
  }).join(' | ');
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`[${hold.name}] ${summary}`]);
}

/**
 * Atualiza o Hold atual de um personagem (chamado por detecção de posição).
 */
function setCharacterHold(characterId, holdId) {
  characterHold.set(characterId, holdId);
}

/**
 * Lord: /holdwithdraw [amount] - Saca impostos da cidade para o cofre da facção.
 */
async function withdrawHoldTreasury(actorId, characterId, amount) {
  const holdId = characterHold.get(characterId) || 'whiterun';
  const hold = holdCache[holdId];
  if (!hold) return;

  if (!hold.ruling_faction_id) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Esta cidade não tem um lorde.']);
    return;
  }

  const factionService = require('./faction-service');
  const factionInfo = factionService.getMemberFactionInfo(characterId);
  
  if (!factionInfo || factionInfo.factionId !== hold.ruling_faction_id || factionInfo.rank !== 'leader') {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Apenas o Lorde desta cidade pode sacar os impostos.']);
    return;
  }

  if (amount <= 0 || hold.treasury < amount) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Valor inválido. Tesouro local: ${hold.treasury}g.`]);
    return;
  }

  await db.query('UPDATE holds SET treasury = treasury - ? WHERE id = ?', [amount, holdId]);
  await db.query('UPDATE factions SET treasury = treasury + ? WHERE id = ?', [amount, factionInfo.factionId]);
  
  await loadCache();
  
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você transferiu ${amount}g da cidade para o cofre da facção.`]);
  console.log(`[economy-regional] Lord ${characterId} withdrew ${amount}g from ${holdId} to faction ${factionInfo.factionId}.`);
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

// ─────────────────────────────────────────────────────────────────────────────
// UI Interaction Hooks
// ─────────────────────────────────────────────────────────────────────────────

async function getInteractionSections(actorId, targetActorId) {
  // Apenas NPCs (nao-players) oferecem o mercado regional
  const commands = require('./commands');
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (targetChar) return []; // Se tem data, eh player

  const ch = commands.getActiveCharacterData(actorId);
  if (!ch) return [];

  const holdId = characterHold.get(ch.characterId) || 'whiterun';
  const hold = holdCache[holdId];
  const holdName = hold ? hold.name : 'Regional';

  return [{
    id: 'npc_market',
    label: `Mercado ${holdName}`,
    actions: [
      { action: 'npc.market_view', label: 'Ver Precos' },
      { action: 'npc.market_buy', label: 'Comprar Item' },
      { action: 'npc.market_sell', label: 'Vender Item' }
    ]
  }];
}

async function handleInteractionAction(actorId, action, payload = {}) {
  const ch = commands.getActiveCharacterData(actorId);
  if (!ch) return;

  const baseIdText = payload.baseId || '';
  const baseId = Number.parseInt(baseIdText, baseIdText.startsWith('0x') ? 16 : 10);
  const qty = Number.parseInt(payload.count) || 1;

  switch (action) {
    case 'npc.market_view':
      return showMarketInfo(actorId, ch.characterId);
    case 'npc.market_buy':
      if (!Number.isFinite(baseId)) {
        if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['ID Invalido.']);
        return;
      }
      return buyFromMarket(actorId, ch.characterId, baseId, qty);
    case 'npc.market_sell':
      if (!Number.isFinite(baseId)) {
        if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['ID Invalido.']);
        return;
      }
      return sellToMarket(actorId, ch.characterId, baseId, qty);
  }
}

module.exports = {
  initRegionalEconomy,
  sellToMarket,
  buyFromMarket,
  showMarketInfo,
  setCharacterHold,
  withdrawHoldTreasury,
  setTaxRate,
  getInteractionSections,
  handleInteractionAction
};

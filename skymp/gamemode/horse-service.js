/**
 * horse-service.js
 * Sistema de Cavalos Persistentes.
 *
 * O cavalo é um ator no mundo do Skyrim. Quando o servidor inicia,
 * os cavalos de jogadores são re-spawned na última posição salva.
 * A saúde e posição são persistidas a cada 30s (ticker).
 *
 * Mecânicas:
 * - /myhorse          → Mostra o status do cavalo
 * - /callhorse        → "Chama" o cavalo (teleporta perto do jogador)
 * - /namehorse [nome] → Renomeia o cavalo
 * - /sellhorse [actorId] [preço] → Coloca à venda para outro jogador
 * - /buyhorse [id]    → Compra cavalo listado
 */

const db = require('./database');
// Ver nota em economy-regional.js: ouro so pelo transaction-service.
const transactionService = require('./core/transaction-service');
const commands = require('./commands');

// FormIDs de raças de cavalos vanilla (Skyrim.esm)
const HORSE_BREEDS = {
  0x0010BF82: { name: 'Cavalo Baio',     base_price: 1000 },
  0x00012E49: { name: 'Cavalo Preto',    base_price: 1200 },
  0x0010BF83: { name: 'Cavalo Malhado',  base_price: 1100 },
  0x0010BF81: { name: 'Cavalo Palomino', base_price: 900  },
  0x0010BF84: { name: 'Cavalo Branco',   base_price: 1300 },
};

// Cache em memória: characterId -> { horseId, name, health, actorRefId }
const mountedHorses = new Map();

/**
 * Carrega o cavalo de um personagem ao logar.
 */
async function loadHorse(actorId, characterId) {
  const rows = await db.query(
    'SELECT * FROM horses WHERE owner_character_id = ? LIMIT 1',
    [characterId]
  );
  if (rows.length === 0) return;
  const horse = rows[0];
  mountedHorses.set(characterId, { horseId: horse.id, name: horse.name, health: horse.health, actorId });
  console.log(`[horse] Loaded horse "${horse.name}" for char ${characterId}`);
}

/**
 * Ticker: salva posição e saúde dos cavalos ativos a cada 30s.
 */
async function tickHorses() {
  for (const [charId, data] of mountedHorses.entries()) {
    // Atualiza no banco (posição seria detectada via mp.get no futuro)
    await db.query(
      'UPDATE horses SET health = ? WHERE id = ?',
      [data.health, data.horseId]
    );
  }
}

function startHorseService() {
  setInterval(tickHorses, 30 * 1000);
  console.log('[horse] Horse service started (30s persist tick).');
}

/**
 * /myhorse — Exibe status do cavalo.
 */
async function showHorse(actorId, characterId) {
  const rows = await db.query('SELECT * FROM horses WHERE owner_character_id = ?', [characterId]);
  if (rows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não possui um cavalo.']);
    return;
  }
  const h = rows[0];
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
      `🐴 ${h.name} | HP: ${Math.round(h.health)} | Bônus: +${h.speed_bonus.toFixed(0)}%${h.for_sale?' | À VENDA por '+h.sale_price+'g':''}`
    ]);
  }
}

/**
 * /callhorse — Teleporta o cavalo para junto do jogador.
 */
async function callHorse(actorId, characterId) {
  const rows = await db.query('SELECT id, name FROM horses WHERE owner_character_id = ?', [characterId]);
  if (rows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não possui um cavalo.']);
    return;
  }
  // O SkyMP ainda não suporta spawn dinâmico de NPCs acompanhantes —
  // por ora emitimos uma notificação narrativa e salvamos intenção.
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [
      `${rows[0].name} galopa em sua direção...`
    ]);
  }
  commands.broadcastProximityMessage(actorId, `* Assobia chamando seu cavalo.`, 800);
}

/**
 * /namehorse [nome] — Renomeia o cavalo.
 */
async function nameHorse(actorId, characterId, newName) {
  if (!newName || newName.length < 2) return;
  const res = await db.query(
    'UPDATE horses SET name = ? WHERE owner_character_id = ?',
    [newName.substring(0, 48), characterId]
  );
  if (res.affectedRows > 0) {
    const data = mountedHorses.get(characterId);
    if (data) data.name = newName;
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Seu cavalo agora se chama "${newName}".`]);
  } else {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não possui um cavalo.']);
  }
}

/**
 * /sellhorse [preço] — Coloca o cavalo à venda no mercado.
 */
async function listHorseForSale(actorId, characterId, price) {
  if (price <= 0) return;
  await db.query('UPDATE horses SET for_sale=1, sale_price=? WHERE owner_character_id=?', [price, characterId]);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Seu cavalo está à venda por ${price}g. Use /horselist para ver todos.`]);
  }
}

/**
 * /horselist — Lista cavalos à venda.
 */
async function listHorses(actorId) {
  const rows = await db.query(
    `SELECT h.id, h.name, h.sale_price, c.first_name, c.last_name
     FROM horses h INNER JOIN characters c ON c.id = h.owner_character_id
     WHERE h.for_sale = 1 LIMIT 10`
  );
  if (rows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Nenhum cavalo à venda no momento.']);
    return;
  }
  const summary = rows.map(h => `[ID:${h.id}] ${h.name} por ${h.sale_price}g (${h.first_name})`).join(' | ');
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [summary]);
}

/**
 * /buyhorse [id] — Compra um cavalo listado.
 */
async function buyHorse(actorId, characterId, horseId) {
  // Verifica se já possui cavalo
  const owned = await db.query('SELECT id FROM horses WHERE owner_character_id = ?', [characterId]);
  if (owned.length > 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você já possui um cavalo. Venda-o primeiro.']);
    return;
  }
  const rows = await db.query('SELECT * FROM horses WHERE id = ? AND for_sale = 1', [horseId]);
  if (rows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Cavalo não encontrado ou já vendido.']);
    return;
  }
  const horse = rows[0];
  const paid = await transactionService.removeGold({ characterId, amount: horse.sale_price, reason: 'horse_purchase', module: 'horse' });
  if (!paid) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Ouro insuficiente. Preço: ${horse.sale_price}g.`]);
    return;
  }
  // Transfere lucro ao antigo dono
  if (horse.owner_character_id) {
    await transactionService.addGold({ characterId: horse.owner_character_id, amount: horse.sale_price, reason: 'horse_sale', module: 'horse' });
  }
  await db.query('UPDATE horses SET owner_character_id=?, for_sale=0, sale_price=0 WHERE id=?', [characterId, horseId]);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você comprou "${horse.name}" por ${horse.sale_price}g!`]);
  }
  console.log(`[horse] Char ${characterId} bought horse ${horseId} for ${horse.sale_price}g`);
}

module.exports = { startHorseService, loadHorse, showHorse, callHorse, nameHorse, listHorseForSale, listHorses, buyHorse };

/**
 * market-stalls-service.js
 *
 * Barraquinhas de venda controladas pelo servidor.
 *
 * Fluxo:
 * - Dono monta uma barraca na posicao atual.
 * - Dono lista itens; o servidor remove do inventario persistente e move para o estoque da barraca.
 * - Comprador paga; o servidor calcula imposto, paga vendedor/cidade e entrega item.
 * - Guarda/fiscal pode inspecionar, suspender e confiscar via permissoes de governanca.
 *
 * Decisoes de design:
 * - Itens confiscados sao destruidos permanentemente (RP: contrabando e apreendido e destruido).
 *   Isso evita abuso por guardas transferindo itens para si. O log completo fica em market_stall_audit.
 * - Rate limiting em memoria previne spam de comandos (2s cooldown por jogador por acao).
 * - Auditoria dedicada em market_stall_audit (com stall_id) em vez de audit_logs generico.
 */

const db = require('./database');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const commands = require('./commands');
const inventory = require('./inventory-service');
const actionPolicy = require('./core/action-policy');
const admin = require('./admin-service');
const governance = require('./governance-service');
const { actorRef } = require('./core/papyrus');

const MODULE = 'market_stalls';
const MAX_STALLS_PER_CHARACTER = 2;
const MIN_STALL_DISTANCE = 250;
const DEFAULT_TAX_RATE = 0.05;
const MAX_PRICE = 1_000_000;
const RATE_LIMIT_MS = 2000;
const VISUAL_CONFIG_PATH = path.resolve(__dirname, '../config/market-stalls.visual.json');

const PERMISSIONS = Object.freeze({
  STALL_INSPECT: 'stall_inspect',
  STALL_SUSPEND: 'stall_suspend',
  STALL_CONFISCATE: 'stall_confiscate',
  STALL_ISSUE_LICENSE: 'stall_issue_license',
  STALL_COLLECT_TAX: 'stall_collect_tax'
});

let initialized = false;
let visualConfig = {
  enabled: false,
  defaultStallBaseId: null,
  fallbackDisplayName: 'Barraca de Comerciante',
  scale: 1.0
};

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting em memoria: characterId:action → timestamp do ultimo uso
// ─────────────────────────────────────────────────────────────────────────────
const _rateLimits = new Map();

/**
 * Verifica rate limit para um personagem + acao.
 * @param {number} characterId
 * @param {string} action
 * @returns {boolean} true se BLOQUEADO (rate limited)
 */
function isRateLimited(characterId, action) {
  const key = `${characterId}:${action}`;
  const now = Date.now();
  const last = _rateLimits.get(key) || 0;
  if (now - last < RATE_LIMIT_MS) {
    return true;
  }
  _rateLimits.set(key, now);
  return false;
}

/**
 * Limpa rate limits antigos (chamado periodicamente para evitar memory leak).
 */
function _cleanupRateLimits() {
  const cutoff = Date.now() - RATE_LIMIT_MS * 2;
  for (const [key, ts] of _rateLimits.entries()) {
    if (ts < cutoff) _rateLimits.delete(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function notify(actorId, message) {
  commands.sendNotification(actorId, message);
}

function getCharacter(actorId) {
  return commands.getActiveCharacterData(actorId);
}

function parseActorId(raw) {
  if (!raw) return NaN;
  const value = String(raw);
  return Number.parseInt(value.toLowerCase().startsWith('0x') ? value.slice(2) : value, 16);
}

function parseFormId(raw) {
  if (!raw) return NaN;
  const value = String(raw);
  return Number.parseInt(value.toLowerCase().startsWith('0x') ? value.slice(2) : value, 16);
}

function loadVisualConfig() {
  if (!fs.existsSync(VISUAL_CONFIG_PATH)) {
    return visualConfig;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(VISUAL_CONFIG_PATH, 'utf8'));
    visualConfig = {
      ...visualConfig,
      ...parsed
    };
  } catch (err) {
    console.error('[market-stalls] Failed to load visual config:', err.message);
  }
  return visualConfig;
}

function parseConfiguredFormId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const raw = String(value);
  return Number.parseInt(raw.toLowerCase().startsWith('0x') ? raw.slice(2) : raw, raw.toLowerCase().startsWith('0x') ? 16 : 10);
}

function parsePositiveInt(raw, fallback = 0) {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getLoc(actorId) {
  if (typeof mp === 'undefined') {
    return { pos: [0, 0, 0], cellId: 'test-cell', angleZ: 0 };
  }
  const loc = mp.get(actorId, 'locationalData') || {};
  const pos = loc.pos || [0, 0, 0];
  return {
    pos,
    cellId: loc.cellOrWorldDesc || loc.cellOrWorldSpaceId || loc.cellId || loc.worldOrCell || loc.worldOrCellDesc || 'unknown',
    angleZ: loc.rot?.[2] || loc.angleZ || 0
  };
}

function distance(a, b) {
  const dx = a.pos_x - b.pos_x;
  const dy = a.pos_y - b.pos_y;
  const dz = a.pos_z - b.pos_z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function addItemToClient(actorId, baseId, count) {
  if (typeof mp === 'undefined') return;
  try {
    mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', actorRef(actorId), [baseId, count, true]);
  } catch (err) {
    console.error(`[market-stalls] Failed to sync purchased item 0x${baseId.toString(16)}:`, err.message);
  }
}

async function spawnStallVisual(actorId, loc, name) {
  if (!visualConfig.enabled || typeof mp === 'undefined') {
    return null;
  }

  const baseId = parseConfiguredFormId(visualConfig.defaultStallBaseId);
  if (!Number.isFinite(baseId) || baseId <= 0) {
    console.warn('[market-stalls] Visual spawn enabled but defaultStallBaseId is not configured.');
    return null;
  }

  try {
    let refId = null;
    if (typeof mp.callPapyrusFunction === 'function') {
      const formToPlace = mp.callPapyrusFunction('global', 'Game', 'getFormEx', null, [baseId]);
      // O fallback anterior era `: actorId` — o FormID cru, que e exatamente a
      // forma que o achado 2.13 do QA_REPORT identificou como invalida. Cair
      // nela quando `getDescFromId` some e pior do que nao colocar a barraca:
      // a chamada nao lanca, o `placed` volta vazio, e o codigo abaixo so
      // registra "PlaceAtMe returned no reference" — um erro de contrato
      // disfarcado de falha de asset. Sem `getDescFromId` nao ha `self`
      // valido possivel, entao a saida honesta e desistir do visual.
      if (typeof mp.getDescFromId !== 'function') {
        console.warn('[market-stalls] Visual spawn indisponivel: mp.getDescFromId ausente, sem self valido pro Papyrus.');
        return null;
      }
      const placed = mp.callPapyrusFunction(
        'method',
        'ObjectReference',
        'PlaceAtMe',
        actorRef(actorId),
        [formToPlace, 1, true, false]
      );
      refId = placed?.desc && typeof mp.getIdFromDesc === 'function'
        ? mp.getIdFromDesc(placed.desc)
        : placed;
    } else if (typeof mp.place === 'function') {
      refId = mp.place(baseId);
    }

    if (!refId) {
      console.warn('[market-stalls] Visual spawn failed: PlaceAtMe returned no reference.');
      return null;
    }

    mp.set(refId, 'pos', loc.pos);
    mp.set(refId, 'worldOrCellDesc', loc.cellId);
    mp.set(refId, 'angle', [0, 0, loc.angleZ || 0]);
    if (visualConfig.scale && visualConfig.scale !== 1) {
      mp.set(refId, 'scale', visualConfig.scale);
    }
    if (name && typeof mp.set === 'function') {
      mp.set(refId, 'displayName', name || visualConfig.fallbackDisplayName);
    }
    return refId;
  } catch (err) {
    console.error('[market-stalls] Failed to spawn stall visual:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit — usa tabela dedicada market_stall_audit (com stall_id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra acao na tabela market_stall_audit.
 * Usa tabela dedicada em vez de audit_logs generico para permitir queries
 * por stall_id e manter o historico de barracas separado.
 *
 * @param {number|null} actorActorId - actorId do ator que executou a acao
 * @param {string} action - tipo da acao (ex: 'stall:place', 'stall:buy')
 * @param {string|null} details - detalhes em texto livre
 * @param {number|null} stallId - ID da barraca (quando aplicavel)
 */
async function audit(actorActorId, action, details, stallId = null) {
  const actor = getCharacter(actorActorId);
  try {
    await db.query(
      `INSERT INTO market_stall_audit (stall_id, actor_character_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [stallId, actor?.characterId || null, `${MODULE}:${action}`, details || null]
    );
  } catch (err) {
    // Fallback para audit_logs generico se market_stall_audit falhar
    console.error('[market-stalls] Failed to write market_stall_audit, falling back:', err.message);
    admin.auditLog(actor?.accountId || null, null, `${MODULE}:${action}`, details || null);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissoes e lookup de cidade
// ─────────────────────────────────────────────────────────────────────────────

async function hasStallPermission(actorId, permission, cityId = null) {
  if (admin.hasPermission(actorId, 'manage_staff')) return true;
  const context = cityId ? { scopeType: governance.SCOPE.CITY, scopeId: cityId } : {};
  const result = await governance.hasPermission(actorId, permission, context);
  return result.allowed;
}

async function getNearestCityId(loc) {
  if (!loc) {
    const rows = await db.query('SELECT id FROM cities ORDER BY id LIMIT 1');
    return rows[0]?.id || null;
  }
  const cities = await db.query(
    'SELECT id, pos_x, pos_y, pos_z, cell_id FROM cities WHERE pos_x IS NOT NULL'
  );
  if (cities.length === 0) {
    const fallback = await db.query('SELECT id FROM cities ORDER BY id LIMIT 1');
    return fallback[0]?.id || null;
  }
  // Priorizar mesma cell; senao, menor distancia euclidiana
  let best = null;
  let bestDist = Infinity;
  for (const city of cities) {
    const sameCellBonus = (city.cell_id && city.cell_id === loc.cellId) ? 0 : 50000;
    const d = Math.sqrt(
      Math.pow((city.pos_x || 0) - loc.pos[0], 2) +
      Math.pow((city.pos_y || 0) - loc.pos[1], 2) +
      Math.pow((city.pos_z || 0) - loc.pos[2], 2)
    ) + sameCellBonus;
    if (d < bestDist) {
      bestDist = d;
      best = city.id;
    }
  }
  return best;
}

async function getCityTaxRate(cityId) {
  if (!cityId) return DEFAULT_TAX_RATE;
  const rows = await db.query('SELECT tax_rate FROM cities WHERE id = ?', [cityId]);
  if (rows.length === 0) return DEFAULT_TAX_RATE;
  const rate = Number(rows[0].tax_rate);
  return Number.isFinite(rate) ? Math.max(0, Math.min(rate, 0.35)) : DEFAULT_TAX_RATE;
}

async function hasActiveLicense(characterId, cityId) {
  if (!cityId) return true;
  const rows = await db.query(
    `SELECT id FROM market_stall_licenses
     WHERE character_id = ?
       AND city_id = ?
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [characterId, cityId]
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validacao e colocacao de barraca (com transacao e FOR UPDATE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida e coloca barraca dentro de uma transacao para prevenir race conditions.
 * A contagem de barracas ativas usa FOR UPDATE para evitar que dois requests
 * simultaneos passem ambos na validacao.
 */
async function placeStall(actorId, name) {
  const character = getCharacter(actorId);
  if (!character) return;

  if (isRateLimited(character.characterId, 'stall_place')) {
    notify(actorId, 'Aguarde antes de usar este comando novamente.');
    return;
  }

  const title = String(name || '').trim().slice(0, 96);
  if (!title) {
    notify(actorId, 'Uso: /stallplace <nome>');
    return;
  }

  const action = actionPolicy.canPerform(character.characterId, 'stall_place');
  if (!action.allowed) {
    notify(actorId, action.reason || 'Acao bloqueada.');
    return;
  }

  const loc = getLoc(actorId);
  const cityId = await getNearestCityId(loc);
  const taxRate = await getCityTaxRate(cityId);

  // Transacao para prevenir race condition na contagem de barracas e distancia
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // FOR UPDATE na contagem para serializar requests do mesmo jogador
    const [active] = await conn.query(
      `SELECT COUNT(*) AS total FROM market_stalls
       WHERE owner_character_id = ? AND status = 'active'
       FOR UPDATE`,
      [character.characterId]
    );
    if ((active[0]?.total || 0) >= MAX_STALLS_PER_CHARACTER) {
      throw new Error('Voce ja possui o limite de barracas ativas.');
    }

    const license = await hasActiveLicense(character.characterId, cityId);
    if (cityId && !license) {
      throw new Error('Voce precisa de licenca ativa nessa cidade para montar barraca.');
    }

    // Verifica distancia de barracas na mesma cell
    const [nearby] = await conn.query(
      `SELECT id, pos_x, pos_y, pos_z FROM market_stalls
       WHERE status = 'active' AND cell_id = ?
       FOR UPDATE`,
      [loc.cellId]
    );
    for (const stall of nearby) {
      if (distance(stall, { pos_x: loc.pos[0], pos_y: loc.pos[1], pos_z: loc.pos[2] }) < MIN_STALL_DISTANCE) {
        throw new Error('Ha outra barraca muito proxima deste ponto.');
      }
    }

    const visualRefId = await spawnStallVisual(actorId, loc, title);
    const [result] = await conn.query(
      `INSERT INTO market_stalls
        (owner_character_id, city_id, name, status, pos_x, pos_y, pos_z, cell_id, heading, visual_ref_id, tax_rate)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      [character.characterId, cityId, title, loc.pos[0], loc.pos[1], loc.pos[2], loc.cellId, loc.angleZ, visualRefId, taxRate]
    );

    await conn.commit();
    await audit(actorId, 'stall:place', `stallId=${result.insertId} city=${cityId} name=${title}`, result.insertId);
    notify(actorId, `Barraca montada: ${title} (#${result.insertId}).`);
  } catch (err) {
    await conn.rollback();
    notify(actorId, err.message);
  } finally {
    conn.release();
  }
}

async function packStall(actorId, stallIdRaw) {
  const character = getCharacter(actorId);
  if (!character) return;

  if (isRateLimited(character.characterId, 'stall_pack')) {
    notify(actorId, 'Aguarde antes de usar este comando novamente.');
    return;
  }

  const stallId = parsePositiveInt(stallIdRaw, 0);

  // Trava a barraca e todos os itens listados numa unica transacao ANTES de
  // marcar qualquer coisa como removida — sem isso, packStall rodando junto
  // de removeItem/buyItem no mesmo item podia ler status='listed' duas vezes
  // e devolver/vender o mesmo item mais de uma vez (duplicacao de item).
  const conn = await db.getConnection();
  let stall = null;
  let items = [];
  try {
    await conn.beginTransaction();

    const [stallRows] = await conn.query('SELECT * FROM market_stalls WHERE id = ? AND status = ? FOR UPDATE', [stallId, 'active']);
    stall = stallRows[0];
    if (!stall) {
      await conn.rollback();
      notify(actorId, 'Barraca ativa nao encontrada.');
      return;
    }
    if (stall.owner_character_id !== character.characterId && !admin.hasPermission(actorId, 'manage_staff')) {
      await conn.rollback();
      notify(actorId, 'Apenas o dono pode recolher esta barraca.');
      return;
    }

    const [itemRows] = await conn.query(
      `SELECT id, base_id, count FROM market_stall_items
       WHERE stall_id = ? AND status = 'listed' AND count > 0
       FOR UPDATE`,
      [stallId]
    );
    items = itemRows;

    for (const item of items) {
      await conn.query('UPDATE market_stall_items SET status = ? WHERE id = ?', ['removed', item.id]);
    }
    await conn.query('UPDATE market_stalls SET status = ?, updated_at = NOW() WHERE id = ?', ['packed', stallId]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('[market-stalls] packStall transaction failed:', err.message);
    notify(actorId, 'Erro ao recolher barraca.');
    return;
  } finally {
    conn.release();
  }

  // Devolve os itens DEPOIS do commit — a barraca e os itens ja estao marcados
  // como recolhidos/removidos de forma atomica, entao nao ha mais janela pra
  // outra chamada concorrente reivindicar o mesmo item.
  for (const item of items) {
    await inventory.giveItem(actorId, character.characterId, item.base_id, item.count, 'stall_pack_return', MODULE);
  }
  if (typeof mp !== 'undefined' && stall.visual_ref_id) {
    try {
      mp.set(stall.visual_ref_id, 'isDisabled', true);
    } catch (err) {
      console.error('[market-stalls] Failed to disable stall visual:', err.message);
    }
  }
  await audit(actorId, 'stall:pack', `stallId=${stallId}`, stallId);
  notify(actorId, 'Barraca recolhida e estoque devolvido ao dono.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Gerenciamento de itens (com transacao para addItem)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista item na barraca. Usa transacao para garantir que a barraca esta ativa
 * e pertence ao jogador no momento da insercao (previne race condition).
 */
async function addItem(actorId, stallIdRaw, baseIdRaw, countRaw, priceRaw, labelParts) {
  const character = getCharacter(actorId);
  if (!character) return;

  if (isRateLimited(character.characterId, 'stall_add')) {
    notify(actorId, 'Aguarde antes de usar este comando novamente.');
    return;
  }

  const manageAction = actionPolicy.canPerform(character.characterId, 'stall_manage');
  if (!manageAction.allowed) {
    notify(actorId, manageAction.reason || 'Acao bloqueada.');
    return;
  }

  const stallId = parsePositiveInt(stallIdRaw, 0);
  const baseId = parseFormId(baseIdRaw);
  const count = parsePositiveInt(countRaw, 0);
  const price = parsePositiveInt(priceRaw, 0);
  const label = String(labelParts || '').trim().slice(0, 96) || null;

  if (!stallId || !Number.isFinite(baseId) || count <= 0 || price <= 0) {
    notify(actorId, 'Uso: /stalladd <stallId> <baseId> <count> <price> <rotulo>');
    return;
  }
  if (price > MAX_PRICE) {
    notify(actorId, `Preco maximo permitido: ${MAX_PRICE}g.`);
    return;
  }

  // Remover item do inventario ANTES da transacao de barraca
  // (inventory-service ja usa transaction-service internamente)
  const removed = await inventory.removeItem(actorId, character.characterId, baseId, count, 'stall_list_item', MODULE);
  if (!removed) {
    notify(actorId, 'Item insuficiente no inventario persistente.');
    return;
  }

  // Transacao para validar barraca e inserir item atomicamente
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, owner_character_id FROM market_stalls WHERE id = ? AND status = ? FOR UPDATE',
      [stallId, 'active']
    );
    const stall = rows[0];
    if (!stall || stall.owner_character_id !== character.characterId) {
      // Devolver item ao jogador se a barraca nao existe
      await conn.rollback();
      await inventory.giveItem(actorId, character.characterId, baseId, count, 'stall_list_revert', MODULE);
      notify(actorId, 'Barraca ativa nao encontrada ou voce nao e o dono.');
      conn.release();
      return;
    }

    await conn.query(
      `INSERT INTO market_stall_items (stall_id, base_id, count, price, label, status)
       VALUES (?, ?, ?, ?, ?, 'listed')`,
      [stallId, baseId, count, price, label]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    // Devolver item ao jogador em caso de erro
    await inventory.giveItem(actorId, character.characterId, baseId, count, 'stall_list_revert', MODULE);
    notify(actorId, 'Erro ao listar item. Itens devolvidos.');
    console.error('[market-stalls] addItem transaction failed:', err.message);
    conn.release();
    return;
  } finally {
    if (conn && typeof conn.release === 'function') conn.release();
  }

  await audit(actorId, 'stall:item_add', `stallId=${stallId} baseId=0x${baseId.toString(16)} count=${count} price=${price}`, stallId);
  notify(actorId, 'Item anunciado na barraca.');
}

async function removeItem(actorId, itemIdRaw) {
  const character = getCharacter(actorId);
  if (!character) return;

  if (isRateLimited(character.characterId, 'stall_remove')) {
    notify(actorId, 'Aguarde antes de usar este comando novamente.');
    return;
  }

  const manageAction = actionPolicy.canPerform(character.characterId, 'stall_manage');
  if (!manageAction.allowed) {
    notify(actorId, manageAction.reason || 'Acao bloqueada.');
    return;
  }

  const itemId = parsePositiveInt(itemIdRaw, 0);

  // Trava a linha do item ANTES de checar status='listed' — sem isso, removeItem
  // rodando junto de packStall/buyItem no mesmo item podia ambos ler 'listed' e
  // ambos devolver o item (duplicacao). Ver mesmo padrao em buyItem/packStall.
  const conn = await db.getConnection();
  let item = null;
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT msi.*, ms.owner_character_id, ms.id AS stall_id
       FROM market_stall_items msi
       INNER JOIN market_stalls ms ON ms.id = msi.stall_id
       WHERE msi.id = ? AND msi.status = 'listed'
       FOR UPDATE`,
      [itemId]
    );
    item = rows[0];
    if (!item || item.owner_character_id !== character.characterId) {
      await conn.rollback();
      notify(actorId, 'Item de barraca nao encontrado ou voce nao e o dono.');
      return;
    }

    await conn.query('UPDATE market_stall_items SET status = ? WHERE id = ?', ['removed', itemId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('[market-stalls] removeItem transaction failed:', err.message);
    notify(actorId, 'Erro ao remover item.');
    return;
  } finally {
    conn.release();
  }

  await inventory.giveItem(actorId, character.characterId, item.base_id, item.count, 'stall_unlist_item', MODULE);
  await audit(actorId, 'stall:item_remove', `itemId=${itemId}`, item.stall_id);
  notify(actorId, 'Item removido da barraca e devolvido.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Listagem
// ─────────────────────────────────────────────────────────────────────────────

async function listStalls(actorId) {
  const rows = await db.query(
    `SELECT ms.id, ms.name, ms.city_id, c.first_name, c.last_name,
            COUNT(msi.id) AS items
     FROM market_stalls ms
     INNER JOIN characters c ON c.id = ms.owner_character_id
     LEFT JOIN market_stall_items msi ON msi.stall_id = ms.id AND msi.status = 'listed' AND msi.count > 0
     WHERE ms.status = 'active'
     GROUP BY ms.id
     ORDER BY ms.updated_at DESC, ms.created_at DESC
     LIMIT 12`
  );
  if (rows.length === 0) {
    notify(actorId, 'Nenhuma barraca ativa.');
    return;
  }
  notify(actorId, rows.map(r => `#${r.id} ${r.name} (${r.items} itens)`).join(' | '));
}

async function listItems(actorId, stallIdRaw) {
  const stallId = parsePositiveInt(stallIdRaw, 0);
  const rows = await db.query(
    `SELECT id, base_id, count, price, label
     FROM market_stall_items
     WHERE stall_id = ? AND status = 'listed' AND count > 0
     ORDER BY id`,
    [stallId]
  );
  if (rows.length === 0) {
    notify(actorId, 'Barraca sem itens listados.');
    return;
  }
  notify(actorId, rows.map(r => `#${r.id} ${r.label || `0x${Number(r.base_id).toString(16)}`} x${r.count} ${r.price}g`).join(' | '));
}

// ─────────────────────────────────────────────────────────────────────────────
// Compra (refatorado com UUID consistente e idempotency)
// ─────────────────────────────────────────────────────────────────────────────

async function buyItem(actorId, stallIdRaw, itemIdRaw, countRaw) {
  const buyer = getCharacter(actorId);
  if (!buyer) return;

  if (isRateLimited(buyer.characterId, 'stall_buy')) {
    notify(actorId, 'Aguarde antes de usar este comando novamente.');
    return;
  }

  const buyAction = actionPolicy.canPerform(buyer.characterId, 'stall_buy');
  if (!buyAction.allowed) {
    notify(actorId, buyAction.reason || 'Acao bloqueada.');
    return;
  }

  const stallId = parsePositiveInt(stallIdRaw, 0);
  const itemId = parsePositiveInt(itemIdRaw, 0);
  const count = parsePositiveInt(countRaw, 1);
  const idempotencyKey = uuid();

  const conn = await db.getConnection();
  let itemForClient = null;
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT msi.*, ms.owner_character_id, ms.city_id, ms.tax_rate, ms.status AS stall_status
       FROM market_stall_items msi
       INNER JOIN market_stalls ms ON ms.id = msi.stall_id
       WHERE msi.id = ? AND msi.stall_id = ?
       FOR UPDATE`,
      [itemId, stallId]
    );
    const item = rows[0];
    if (!item || item.stall_status !== 'active' || item.status !== 'listed' || item.count < count) {
      throw new Error('Item indisponivel.');
    }
    if (item.owner_character_id === buyer.characterId) {
      throw new Error('Voce nao pode comprar da propria barraca.');
    }

    const total = item.price * count;
    const taxRate = Number.isFinite(Number(item.tax_rate)) ? Number(item.tax_rate) : DEFAULT_TAX_RATE;
    const taxAmount = Math.floor(total * taxRate);
    const sellerAmount = total - taxAmount;

    const [goldRows] = await conn.query('SELECT gold FROM characters WHERE id = ? FOR UPDATE', [buyer.characterId]);
    if (!goldRows[0] || goldRows[0].gold < total) {
      throw new Error('Ouro insuficiente.');
    }

    // Transferencia de ouro
    await conn.query('UPDATE characters SET gold = gold - ? WHERE id = ?', [total, buyer.characterId]);
    await conn.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [sellerAmount, item.owner_character_id]);
    if (taxAmount > 0 && item.city_id) {
      await conn.query('UPDATE cities SET treasury = treasury + ? WHERE id = ?', [taxAmount, item.city_id]);
    }

    // Atualizar estoque da barraca
    const remaining = item.count - count;
    await conn.query(
      'UPDATE market_stall_items SET count = ?, status = ? WHERE id = ?',
      [remaining, remaining > 0 ? 'listed' : 'sold', itemId]
    );

    // Atualizar inventario do comprador
    const [existingInv] = await conn.query(
      'SELECT id FROM character_inventory WHERE character_id = ? AND base_id = ?',
      [buyer.characterId, item.base_id]
    );
    if (existingInv.length > 0) {
      await conn.query(
        'UPDATE character_inventory SET count = count + ? WHERE character_id = ? AND base_id = ?',
        [count, buyer.characterId, item.base_id]
      );
    } else {
      await conn.query(
        'INSERT INTO character_inventory (character_id, base_id, count) VALUES (?, ?, ?)',
        [buyer.characterId, item.base_id, count]
      );
    }

    // Registro de venda
    await conn.query(
      `INSERT INTO market_stall_sales
        (stall_id, seller_character_id, buyer_character_id, base_id, count, unit_price, tax_amount, city_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [stallId, item.owner_character_id, buyer.characterId, item.base_id, count, item.price, taxAmount, item.city_id]
    );

    // Ledger de ouro com UUID consistente e idempotency key
    const buyerGoldTxId = uuid();
    const sellerGoldTxId = uuid();
    await conn.query(
      `INSERT INTO gold_transactions
        (transaction_id, character_id, delta, reason, module, idempotency_key, status)
       VALUES (?, ?, ?, 'stall_purchase', ?, ?, 'committed'),
              (?, ?, ?, 'stall_sale', ?, ?, 'committed')`,
      [buyerGoldTxId, buyer.characterId, -total, MODULE, `${idempotencyKey}_buy_gold`,
       sellerGoldTxId, item.owner_character_id, sellerAmount, MODULE, `${idempotencyKey}_sell_gold`]
    );

    // Ledger de inventario com UUID e idempotency key
    const invTxId = uuid();
    await conn.query(
      `INSERT INTO inventory_transactions
        (transaction_id, character_id, base_id, delta, reason, module, idempotency_key, status)
       VALUES (?, ?, ?, ?, 'stall_purchase', ?, ?, 'committed')`,
      [invTxId, buyer.characterId, item.base_id, count, MODULE, `${idempotencyKey}_buy_inv`]
    );

    await conn.commit();
    itemForClient = { baseId: item.base_id, count, total, taxAmount, sellerCharId: item.owner_character_id };
  } catch (err) {
    await conn.rollback();
    notify(actorId, err.message);
    return;
  } finally {
    conn.release();
  }

  // Aplicar no cliente APOS commit (BD e fonte de verdade)
  addItemToClient(actorId, itemForClient.baseId, itemForClient.count);
  await audit(actorId, 'stall:buy', `stallId=${stallId} itemId=${itemId} count=${count} total=${itemForClient.total} tax=${itemForClient.taxAmount} key=${idempotencyKey}`, stallId);
  notify(actorId, `Compra concluida por ${itemForClient.total}g.`);

  // Notificar o vendedor (se online)
  try {
    const sellerActorId = commands.getActiveActorByCharacterId(itemForClient.sellerCharId);
    if (sellerActorId) {
      notify(sellerActorId, `Vendido: x${count} por ${itemForClient.total}g (taxa: ${itemForClient.taxAmount}g).`);
    }
  } catch (_) { /* vendedor offline, ignora */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Licencas e fiscalizacao
// ─────────────────────────────────────────────────────────────────────────────

async function issueLicense(actorId, targetActorRaw, cityId, daysRaw) {
  if (!await hasStallPermission(actorId, PERMISSIONS.STALL_ISSUE_LICENSE, cityId)) {
    notify(actorId, 'Sem permissao para emitir licenca.');
    return;
  }
  const targetActorId = parseActorId(targetActorRaw);
  const target = getCharacter(targetActorId);
  const issuer = getCharacter(actorId);
  const days = Math.min(parsePositiveInt(daysRaw, 7), 90);
  if (!target || !cityId) {
    notify(actorId, 'Uso: /stalllicense <actorId> <cityId> <dias>');
    return;
  }

  await db.query(
    `INSERT INTO market_stall_licenses
      (character_id, city_id, license_type, status, expires_at, issued_by_character_id)
     VALUES (?, ?, 'street_vendor', 'active', DATE_ADD(NOW(), INTERVAL ? DAY), ?)`,
    [target.characterId, cityId, days, issuer?.characterId || null]
  );
  await audit(actorId, 'license:issue', `target=${target.characterId} city=${cityId} days=${days}`);
  notify(actorId, 'Licenca emitida.');
  notify(targetActorId, `Voce recebeu uma licenca de comerciante em ${cityId} por ${days} dias.`);
}

async function inspectStall(actorId, stallIdRaw) {
  const stallId = parsePositiveInt(stallIdRaw, 0);
  const rows = await db.query('SELECT * FROM market_stalls WHERE id = ?', [stallId]);
  const stall = rows[0];
  if (!stall) {
    notify(actorId, 'Barraca nao encontrada.');
    return;
  }
  if (!await hasStallPermission(actorId, PERMISSIONS.STALL_INSPECT, stall.city_id)) {
    notify(actorId, 'Sem permissao para fiscalizar barracas.');
    return;
  }

  const license = await hasActiveLicense(stall.owner_character_id, stall.city_id);
  const items = await db.query(
    `SELECT id, base_id, count, price, label FROM market_stall_items
     WHERE stall_id = ? AND status = 'listed'`,
    [stallId]
  );
  notify(actorId, `Barraca #${stall.id} ${stall.name} | status=${stall.status} | licenca=${license ? 'ativa' : 'ausente'} | itens=${items.length}`);
}

async function suspendStall(actorId, stallIdRaw, reason) {
  const stallId = parsePositiveInt(stallIdRaw, 0);
  const rows = await db.query('SELECT * FROM market_stalls WHERE id = ?', [stallId]);
  const stall = rows[0];
  if (!stall) {
    notify(actorId, 'Barraca nao encontrada.');
    return;
  }
  if (!await hasStallPermission(actorId, PERMISSIONS.STALL_SUSPEND, stall.city_id)) {
    notify(actorId, 'Sem permissao para suspender barracas.');
    return;
  }
  await db.query('UPDATE market_stalls SET status = ?, updated_at = NOW() WHERE id = ?', ['suspended', stallId]);
  await audit(actorId, 'stall:suspend', `stallId=${stallId} reason=${reason || 'sem motivo'}`, stallId);
  notify(actorId, 'Barraca suspensa.');
}

/**
 * Confisca item de barraca.
 * Design: itens confiscados sao DESTRUIDOS permanentemente (removidos da economia).
 * Isso e intencional para RP (contrabando apreendido e destruido) e seguranca
 * (guardas nao podem abusar para transferir itens para si mesmos).
 * O log completo em market_stall_audit + confiscations garante rastreabilidade.
 */
async function confiscateItem(actorId, itemIdRaw, reason) {
  const itemId = parsePositiveInt(itemIdRaw, 0);
  const rows = await db.query(
    `SELECT msi.*, ms.city_id, ms.owner_character_id, ms.id AS stall_id
     FROM market_stall_items msi
     INNER JOIN market_stalls ms ON ms.id = msi.stall_id
     WHERE msi.id = ? AND msi.status = 'listed'`,
    [itemId]
  );
  const item = rows[0];
  if (!item) {
    notify(actorId, 'Item nao encontrado.');
    return;
  }
  if (!await hasStallPermission(actorId, PERMISSIONS.STALL_CONFISCATE, item.city_id)) {
    notify(actorId, 'Sem permissao para confiscar.');
    return;
  }

  await db.query('UPDATE market_stall_items SET status = ? WHERE id = ?', ['confiscated', itemId]);
  await db.query(
    `INSERT INTO confiscations (target_character_id, officer_character_id, base_id, count, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [item.owner_character_id, getCharacter(actorId)?.characterId || null, item.base_id, item.count, reason || 'confisco de barraca']
  ).catch((err) => {
    console.error('[market-stalls] Failed to record confiscation:', err.message);
  });
  await audit(actorId, 'stall:item_confiscate', `itemId=${itemId} owner=${item.owner_character_id} baseId=0x${Number(item.base_id).toString(16)} count=${item.count} reason=${reason || 'sem motivo'}`, item.stall_id);
  notify(actorId, 'Item confiscado da barraca (destruido permanentemente).');
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiracao automatica de barracas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica e expira barracas cujo rent_paid_until ja passou.
 * Itens restantes sao devolvidos ao dono via inventario persistente.
 * Deve ser chamada periodicamente (ex: a cada 5 minutos via setInterval no init).
 *
 * @returns {Promise<number>} quantidade de barracas expiradas
 */
async function expireStalls() {
  const expired = await db.query(
    `SELECT id, owner_character_id, visual_ref_id FROM market_stalls
     WHERE status = 'active'
       AND rent_paid_until IS NOT NULL
       AND rent_paid_until < NOW()`
  );

  if (expired.length === 0) return 0;

  for (const stall of expired) {
    // Devolver itens ao dono
    const items = await db.query(
      `SELECT id, base_id, count FROM market_stall_items
       WHERE stall_id = ? AND status = 'listed' AND count > 0`,
      [stall.id]
    );

    const ownerActorId = commands.getActiveActorByCharacterId(stall.owner_character_id);

    for (const item of items) {
      // giveItem precisa de actorId; se o dono nao esta online, os itens ficam no BD
      // e serao sincronizados na proxima reconexao via reconciliacao
      await inventory.giveItem(ownerActorId || 0, stall.owner_character_id, item.base_id, item.count, 'stall_expire_return', MODULE);
      await db.query('UPDATE market_stall_items SET status = ? WHERE id = ?', ['removed', item.id]);
    }

    await db.query('UPDATE market_stalls SET status = ?, updated_at = NOW() WHERE id = ?', ['expired', stall.id]);

    // Desativar visual se existir
    if (typeof mp !== 'undefined' && stall.visual_ref_id) {
      try {
        mp.set(stall.visual_ref_id, 'isDisabled', true);
      } catch (err) {
        console.error('[market-stalls] Failed to disable expired stall visual:', err.message);
      }
    }

    // Notificar dono se online
    if (ownerActorId) {
      notify(ownerActorId, `Sua barraca #${stall.id} expirou. Itens devolvidos ao inventario.`);
    }

    await audit(0, 'stall:expire', `stallId=${stall.id} owner=${stall.owner_character_id} items=${items.length}`, stall.id);
    console.log(`[market-stalls] Stall #${stall.id} expired, ${items.length} items returned to owner ${stall.owner_character_id}.`);
  }

  return expired.length;
}

/**
 * Resumo de economia/mercado do próprio personagem, para o painel do jogador.
 * Não altera nenhum estado — apenas leitura.
 * @param {number} actorId
 * @returns {Promise<object|null>}
 */
async function getMyEconomySummary(actorId) {
  const character = getCharacter(actorId);
  if (!character) return null;

  const myStalls = await db.query(
    `SELECT ms.id, ms.name, ms.status, COUNT(msi.id) AS items
     FROM market_stalls ms
     LEFT JOIN market_stall_items msi ON msi.stall_id = ms.id AND msi.status = 'listed' AND msi.count > 0
     WHERE ms.owner_character_id = ? AND ms.status = 'active'
     GROUP BY ms.id
     ORDER BY ms.updated_at DESC`,
    [character.characterId]
  ).catch(() => []);

  let localTax = DEFAULT_TAX_RATE;
  try {
    const loc = getLoc(actorId);
    const cityId = await getNearestCityId(loc);
    localTax = await getCityTaxRate(cityId);
  } catch (err) {
    console.error('[market-stalls] Falha ao resolver imposto local para painel:', err.message);
  }

  return {
    stalls: myStalls.map(s => ({ id: s.id, name: s.name, status: s.status, items: Number(s.items) || 0 })),
    localTaxRate: localTax
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comandos
// ─────────────────────────────────────────────────────────────────────────────

function commandDefs() {
  return [
    {
      name: '/stallplace',
      description: '[Barraca] Monta uma barraca na posicao atual',
      usage: '/stallplace <nome>',
      handler: (actorId, args) => placeStall(actorId, args)
    },
    {
      name: '/stallpack',
      description: '[Barraca] Recolhe sua barraca ativa',
      usage: '/stallpack <stallId>',
      handler: (actorId, args) => packStall(actorId, args.trim())
    },
    {
      name: '/stalladd',
      description: '[Barraca] Anuncia item do inventario',
      usage: '/stalladd <stallId> <baseId> <count> <price> <rotulo>',
      handler: (actorId, args) => {
        const [stallId, baseId, count, price, ...label] = args.split(' ');
        addItem(actorId, stallId, baseId, count, price, label.join(' '));
      }
    },
    {
      name: '/stallremove',
      description: '[Barraca] Remove item anunciado',
      usage: '/stallremove <itemId>',
      handler: (actorId, args) => removeItem(actorId, args.trim())
    },
    {
      name: '/stalls',
      description: '[Barraca] Lista barracas ativas',
      usage: '/stalls',
      handler: (actorId) => listStalls(actorId)
    },
    {
      name: '/stallitems',
      description: '[Barraca] Lista itens de uma barraca',
      usage: '/stallitems <stallId>',
      handler: (actorId, args) => listItems(actorId, args.trim())
    },
    {
      name: '/stallbuy',
      description: '[Barraca] Compra item anunciado',
      usage: '/stallbuy <stallId> <itemId> <count>',
      handler: (actorId, args) => {
        const [stallId, itemId, count] = args.split(' ');
        buyItem(actorId, stallId, itemId, count);
      }
    },
    {
      name: '/stalllicense',
      description: '[Gov] Emite licenca de comerciante',
      usage: '/stalllicense <actorId> <cityId> <dias>',
      handler: (actorId, args) => {
        const [targetActor, cityId, days] = args.split(' ');
        issueLicense(actorId, targetActor, cityId, days);
      }
    },
    {
      name: '/stallinspect',
      description: '[Fiscal] Inspeciona barraca',
      usage: '/stallinspect <stallId>',
      handler: (actorId, args) => inspectStall(actorId, args.trim())
    },
    {
      name: '/stallsuspend',
      description: '[Fiscal] Suspende barraca',
      usage: '/stallsuspend <stallId> <motivo>',
      handler: (actorId, args) => {
        const [stallId, ...reason] = args.split(' ');
        suspendStall(actorId, stallId, reason.join(' '));
      }
    },
    {
      name: '/stallconfiscate',
      description: '[Fiscal] Confisca item de barraca',
      usage: '/stallconfiscate <itemId> <motivo>',
      handler: (actorId, args) => {
        const [itemId, ...reason] = args.split(' ');
        confiscateItem(actorId, itemId, reason.join(' '));
      }
    }
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// UI Interaction Hooks
// ─────────────────────────────────────────────────────────────────────────────

async function getInteractionSections(actorId, targetActorId) {
  const actor = getCharacter(actorId);
  const target = getCharacter(targetActorId);
  if (!actor || !target) return [];

  // Se o alvo for o proprio jogador, ele pode querer gerenciar
  const isSelf = (actorId === targetActorId);

  const rows = await db.query(
    `SELECT id, name FROM market_stalls WHERE owner_character_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
    [target.characterId]
  );
  if (rows.length === 0) return [];

  const stall = rows[0];
  const actions = [];

  if (isSelf) {
    actions.push({ action: 'stall.manage', label: 'Gerenciar' });
  } else {
    actions.push({ action: 'stall.view', label: 'Ver Vitrine' });
    actions.push({ action: 'stall.buy', label: 'Comprar Item' });
  }

  return [{
    id: 'market_stall',
    label: `Barraca: ${stall.name}`,
    actions
  }];
}

async function handleInteractionAction(actorId, action, payload = {}) {
  const targetActorRaw = payload.targetActorId || payload.target || payload.actorId;
  const targetActorId = Number.parseInt(String(targetActorRaw), String(targetActorRaw).startsWith('0x') ? 16 : 10);
  
  if (!Number.isFinite(targetActorId)) {
    notify(actorId, 'Alvo invalido.');
    return;
  }

  const target = getCharacter(targetActorId);
  if (!target) return;
  
  const rows = await db.query(
    `SELECT id FROM market_stalls WHERE owner_character_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
    [target.characterId]
  );
  if (rows.length === 0) {
    notify(actorId, 'Este alvo nao possui barraca ativa.');
    return;
  }
  const stallId = rows[0].id;

  switch (action) {
    case 'stall.view':
      return listItems(actorId, stallId);
    case 'stall.buy':
      return buyItem(actorId, stallId, payload.itemId, payload.count || 1);
    case 'stall.manage':
      if (payload.actionType === 'add') {
        return addItem(actorId, stallId, payload.baseId, payload.count, payload.price, payload.label || 'Mercadoria');
      } else if (payload.actionType === 'remove') {
        // removeItem espera o ID da listagem (market_stall_items.id), nao o baseId.
        return removeItem(actorId, payload.itemId);
      }
      return;
    default:
      notify(actorId, 'Acao de barraca desconhecida.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

let _expirationTimer = null;
let _rateLimitCleanupTimer = null;

async function initMarketStallsService() {
  loadVisualConfig();
  actionPolicy.registerAction('stall_place', ['gameplay'], 'Montar barraca');
  actionPolicy.registerAction('stall_manage', ['gameplay', 'trade'], 'Gerenciar barraca');
  actionPolicy.registerAction('stall_buy', ['gameplay', 'trade'], 'Comprar em barraca');

  // Verificacao periodica de barracas expiradas (5 minutos)
  _expirationTimer = setInterval(async () => {
    try {
      const count = await expireStalls();
      if (count > 0) {
        console.log(`[market-stalls] Expiration check: ${count} stalls expired.`);
      }
    } catch (err) {
      console.error('[market-stalls] Expiration check failed:', err.message);
    }
  }, 5 * 60 * 1000);

  // Limpeza periodica de rate limits antigos (30 segundos)
  _rateLimitCleanupTimer = setInterval(_cleanupRateLimits, 30_000);

  initialized = true;
  console.log('[market-stalls] Market stalls service initialized.');
}

function shutdownMarketStallsService() {
  if (_expirationTimer) { clearInterval(_expirationTimer); _expirationTimer = null; }
  if (_rateLimitCleanupTimer) { clearInterval(_rateLimitCleanupTimer); _rateLimitCleanupTimer = null; }
  _rateLimits.clear();
  initialized = false;
}

module.exports = {
  PERMISSIONS,
  commandDefs,
  initMarketStallsService,
  shutdownMarketStallsService,
  placeStall,
  packStall,
  addItem,
  removeItem,
  listStalls,
  listItems,
  getMyEconomySummary,
  buyItem,
  issueLicense,
  inspectStall,
  suspendStall,
  confiscateItem,
  expireStalls,
  getInteractionSections,
  handleInteractionAction,
  isInitialized: () => initialized
};

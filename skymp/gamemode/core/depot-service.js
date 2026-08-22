/**
 * core/depot-service.js
 *
 * Armazenamento regional de itens. Um depósito por (personagem, hold) —
 * itens guardados em Whiterun não aparecem em Solitude, porque são LINHAS
 * diferentes em `character_depots`, não um filtro sobre uma linha comum. Ver
 * `docs/technical/DEPOT_SERVICE_AUDIT.md` para os 15 pontos da §15.
 *
 * ─── O que este arquivo explicitamente NÃO faz ──────────────────────────────
 *
 * Nenhum ouro. `characters.gold` já é global por natureza (não existe "ouro
 * na mão" vs "ouro no banco" neste projeto — ver `core/economy-service.js`);
 * este arquivo só EXIBE o saldo existente (`getGoldBalance`), nunca cria uma
 * segunda reserva. Decisão tomada com o dono do produto antes de implementar.
 *
 * Nenhuma checagem de combate. O brief pedia "não pode usar em combate", mas
 * não existe sinal de combate ao vivo neste projeto: `core/hit-events.js` é
 * single-subscriber (já ocupado por `death-service.js`) e só informa DEPOIS
 * que o episódio fecha (10s de silêncio) — não serve como portão em tempo
 * real sem mexer em infra compartilhada de outro sistema. Adiado, e é um gap
 * conhecido, não esquecido — ver `DEPOT_SERVICE_AUDIT.md`.
 *
 * ─── Distância e alvo: primeiro consumidor real de TARGET_TYPES.OBJECT ──────
 *
 * `core/interaction-targets.js` já resolve um `MpObjectReference` qualquer do
 * mundo (nasceu para o Minerador). A distância é enforced automaticamente
 * pelo Interaction Framework via `entry.distance` + `target.assertRange()`
 * (`core/interaction-service.js`) — nenhuma checagem manual aqui. A mesma
 * ressalva que `interaction-targets.js` já registra vale para este arquivo:
 * `locationalData` contra um objeto comum é **assumido a partir da
 * documentação oficial do SkyMP, não validado em jogo**.
 *
 * ─── Atomicidade de depósito/saque ───────────────────────────────────────────
 *
 * Uma única transação, duas chamadas de `transactionService.tx.applyStackDelta`
 * (uma para `character_inventory`, uma para `depot_inventory`) — mesmo padrão
 * de `economy-service.transferInTransaction`. Falha em qualquer uma reverte as
 * duas. `depot_inventory` foi adicionada a `STACK_TABLES` em
 * `transaction-service.js` para isso funcionar; nenhuma lógica de transação
 * nova foi escrita — é reaproveitamento, não reimplementação.
 */

'use strict';

const database = require('../database');
const moduleRegistry = require('./module-registry');
const serverOptions = require('./server-options');
const transactionService = require('./transaction-service');
const economyService = require('./economy-service');
const interactionRegistry = require('./interaction-registry');
const inventory = require('./inventory');
const inventoryOwner = require('./inventory-owner');

const MODULE_ID = 'depot';

/**
 * "3 metros" (brief) convertido para unidades do Skyrim. Não existe
 * conversão metro→unidade em nenhum outro lugar do projeto — todos os raios
 * existentes (`proximity-ranges.js`, `RESCUE_RANGE`, `STALL_INTERACTION_RANGE`)
 * já nascem em unidades Skyrim. Uso a constante de modding amplamente
 * documentada (~70,5 unidades por metro): 3 * 70.5 ≈ 211. Constante simples
 * (não server-option) pelo mesmo critério de `RESCUE_RANGE` em
 * `death-service.js` — é geometria física do baú, não balanceamento de
 * gameplay.
 */
const DEPOT_INTERACT_RANGE = 211;

/** @param {object} dependencies */
function _deps(dependencies = {}) {
  return {
    db: dependencies.db || database,
    moduleRegistry: dependencies.moduleRegistry || moduleRegistry,
    serverOptions: dependencies.serverOptions || serverOptions,
    tx: dependencies.tx || transactionService.tx,
    economy: dependencies.economy || economyService,
    // `inventory.list` é o mesmo adaptador que `character_inventory` usa em
    // qualquer outro lugar do projeto (trade, loja) — nenhuma leitura nova.
    inventory: dependencies.inventory || inventory,
    logger: dependencies.logger || console,
    // No-op por padrão (ex: chamadas diretas em teste) — quem liga a CEF de
    // verdade é `phase0-basic.js`, via `registerInteractions({ sendModal })`.
    sendModal: dependencies.sendModal || (() => {})
  };
}

function _isModuleEnabled(deps) {
  return deps.moduleRegistry.isEnabled(MODULE_ID);
}

function _isPositiveInt(v) {
  return Number.isSafeInteger(v) && v > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Depósito (a linha em character_depots, não os itens dentro)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê e trava a linha do depósito dentro da transação do chamador. Cria com
 * `depot.defaultCapacity` se ainda não existir — só acontece na primeira vez
 * que o personagem visita aquele hold.
 * @param {object} conn conexão com transação ativa
 * @param {number} characterId
 * @param {string} holdId
 * @param {object} deps
 */
async function _lockOrCreateDepot(conn, characterId, holdId, deps) {
  const [rows] = await conn.query(
    'SELECT id, capacity FROM character_depots WHERE character_id = ? AND hold_id = ? FOR UPDATE',
    [characterId, holdId]
  );
  if (rows.length > 0) return { id: rows[0].id, capacity: Number(rows[0].capacity) };

  const capacity = deps.serverOptions.get('depot.defaultCapacity');
  const [result] = await conn.query(
    'INSERT INTO character_depots (character_id, hold_id, capacity) VALUES (?, ?, ?)',
    [characterId, holdId, capacity]
  );
  return { id: result.insertId, capacity };
}

/**
 * @param {number} characterId
 * @param {string} holdId
 * @param {object} [dependencies]
 */
async function getOrCreateDepot(characterId, holdId, dependencies = {}) {
  const deps = _deps(dependencies);
  const conn = await deps.db.getConnection();
  try {
    await conn.beginTransaction();
    const depot = await _lockOrCreateDepot(conn, characterId, holdId, deps);
    await conn.commit();
    return depot;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * @param {number} characterId
 * @param {string} holdId
 * @param {object} [dependencies]
 */
async function getDepotContents(characterId, holdId, dependencies = {}) {
  const deps = _deps(dependencies);
  const rows = await deps.db.query(
    `SELECT di.base_id, di.count
       FROM depot_inventory di
       JOIN character_depots cd ON cd.id = di.depot_id
      WHERE cd.character_id = ? AND cd.hold_id = ?
      ORDER BY di.base_id`,
    [characterId, holdId]
  );
  return rows.map((r) => ({ baseId: Number(r.base_id), count: Number(r.count) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Depósito / saque de item
// ─────────────────────────────────────────────────────────────────────────────

async function _currentStackCount(conn, table, ownerColumn, ownerId, baseId) {
  const [rows] = await conn.query(
    `SELECT count FROM ${table} WHERE ${ownerColumn} = ? AND base_id = ? FOR UPDATE`,
    [ownerId, baseId]
  );
  return rows.length > 0 ? Number(rows[0].count) : 0;
}

async function _depotTotalCount(conn, depotId) {
  const [rows] = await conn.query(
    'SELECT COALESCE(SUM(count), 0) AS total FROM depot_inventory WHERE depot_id = ?',
    [depotId]
  );
  return Number(rows[0].total);
}

/**
 * Move um item do inventário do personagem pro depósito da região.
 *
 * Recusa (`{ok:false, code}`) SEM escrever nada quando o personagem não tem
 * estoque suficiente ou o depósito estouraria `capacity` — mesmo critério de
 * `profession-service.grantProfession` contra `maxPerCharacter`: a checagem
 * acontece sob a MESMA trava que a escrita usaria, então não há corrida entre
 * "decidiu que cabe" e "escreveu".
 *
 * @param {object} opts
 * @param {number} opts.characterId
 * @param {string} opts.holdId
 * @param {number} opts.baseId
 * @param {number} opts.count
 * @param {object} [dependencies]
 */
async function depositItem(opts, dependencies = {}) {
  const deps = _deps(dependencies);
  const { characterId, holdId, baseId, count } = opts || {};

  if (!_isModuleEnabled(deps)) return { ok: false, code: 'module_disabled' };
  if (!_isPositiveInt(characterId)) return { ok: false, code: 'invalid_character' };
  if (typeof holdId !== 'string' || !holdId) return { ok: false, code: 'invalid_hold' };
  if (!_isPositiveInt(baseId)) return { ok: false, code: 'invalid_item' };
  if (!_isPositiveInt(count)) return { ok: false, code: 'invalid_count' };

  const conn = await deps.db.getConnection();
  try {
    await conn.beginTransaction();

    const depot = await _lockOrCreateDepot(conn, characterId, holdId, deps);

    const carried = await _currentStackCount(conn, 'character_inventory', 'character_id', characterId, baseId);
    if (carried < count) {
      await conn.rollback();
      return { ok: false, code: 'insufficient_stock', data: { carried, requested: count } };
    }

    const currentTotal = await _depotTotalCount(conn, depot.id);
    if (currentTotal + count > depot.capacity) {
      await conn.rollback();
      return { ok: false, code: 'depot_full', data: { capacity: depot.capacity, current: currentTotal } };
    }

    await deps.tx.applyStackDelta(conn, 'character_inventory', characterId, baseId, -count);
    await deps.tx.applyStackDelta(conn, 'depot_inventory', depot.id, baseId, count);

    await conn.commit();
    return { ok: true, data: { depotId: depot.id, baseId, count } };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Move um item do depósito da região de volta pro inventário do personagem.
 * Simétrico a `depositItem` — mesma transação única, mesma trava.
 * @param {object} opts
 * @param {number} opts.characterId
 * @param {string} opts.holdId
 * @param {number} opts.baseId
 * @param {number} opts.count
 * @param {object} [dependencies]
 */
async function withdrawItem(opts, dependencies = {}) {
  const deps = _deps(dependencies);
  const { characterId, holdId, baseId, count } = opts || {};

  if (!_isModuleEnabled(deps)) return { ok: false, code: 'module_disabled' };
  if (!_isPositiveInt(characterId)) return { ok: false, code: 'invalid_character' };
  if (typeof holdId !== 'string' || !holdId) return { ok: false, code: 'invalid_hold' };
  if (!_isPositiveInt(baseId)) return { ok: false, code: 'invalid_item' };
  if (!_isPositiveInt(count)) return { ok: false, code: 'invalid_count' };

  const conn = await deps.db.getConnection();
  try {
    await conn.beginTransaction();

    const [depotRows] = await conn.query(
      'SELECT id FROM character_depots WHERE character_id = ? AND hold_id = ? FOR UPDATE',
      [characterId, holdId]
    );
    if (depotRows.length === 0) {
      await conn.rollback();
      return { ok: false, code: 'depot_not_found' };
    }
    const depotId = depotRows[0].id;

    const stored = await _currentStackCount(conn, 'depot_inventory', 'depot_id', depotId, baseId);
    if (stored < count) {
      await conn.rollback();
      return { ok: false, code: 'insufficient_stock', data: { stored, requested: count } };
    }

    await deps.tx.applyStackDelta(conn, 'depot_inventory', depotId, baseId, -count);
    await deps.tx.applyStackDelta(conn, 'character_inventory', characterId, baseId, count);

    await conn.commit();
    return { ok: true, data: { depotId, baseId, count } };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ouro — só leitura do saldo global existente, nenhuma reserva nova
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number} characterId
 * @param {object} [dependencies]
 */
async function getGoldBalance(characterId, dependencies = {}) {
  const deps = _deps(dependencies);
  const result = await deps.economy.getBalance({ type: 'character', ref: characterId }, dependencies);
  return result.ok ? result.balance : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminais físicos — traduz FormID do objeto do mundo em hold
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number} objectFormId FormID resolvido pelo Interaction Framework
 *   (`ctx.target.formId`, `core/interaction-targets.js` TARGET_TYPES.OBJECT)
 * @param {object} [dependencies]
 * @returns {Promise<string|null>} hold_id, ou null se este objeto não é um terminal de depósito
 */
async function resolveTerminal(objectFormId, dependencies = {}) {
  const deps = _deps(dependencies);
  if (!_isPositiveInt(objectFormId)) return null;
  // O terminal é identificado por FormDesc (`"hex:Skyrim.esm"`), não pelo
  // FormID cru — mesma distinção que `containers.object_id` já usa. A tradução
  // FormID→FormDesc é a mesma que `core/papyrus.js` faz para o `self` de uma
  // chamada Papyrus: `mp.getDescFromId(formId)`.
  if (typeof mp === 'undefined' || typeof mp.getDescFromId !== 'function') return null;
  const objectId = mp.getDescFromId(objectFormId);
  const rows = await deps.db.query('SELECT hold_id FROM depot_terminals WHERE object_id = ?', [objectId]);
  return rows.length > 0 ? rows[0].hold_id : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction Framework — DEPOT_CHEST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monta o payload que a CEF usa pra desenhar o painel inteiro — mesma forma
 * na abertura (`depot:open`) e depois de cada depósito/saque (`depot:update`),
 * pra um único renderizador do lado do cliente servir os dois.
 * @param {number} characterId
 * @param {string} holdId
 * @param {object} deps
 */
async function _panelPayload(characterId, holdId, targetFormId, dependencies) {
  const deps = _deps(dependencies);
  const depot = await getOrCreateDepot(characterId, holdId, dependencies);
  const contents = await getDepotContents(characterId, holdId, dependencies);
  const carried = await deps.inventory.list(inventoryOwner.character(characterId));
  const gold = await getGoldBalance(characterId, dependencies);
  // `targetId` volta no payload pra CEF poder mandar `depot.deposit`/
  // `depot.withdraw` sem depender do estado do menu de interação genérico —
  // o painel do depósito é uma tela própria, não uma extensão dele.
  return { holdId, targetId: targetFormId, carried, contents, gold, capacity: depot.capacity };
}

/**
 * Registra as ações do depósito no Interaction Framework. Chamado do
 * `initialize()` do módulo — precisa do framework `interaction` já de pé, daí
 * `dependencies: ['interaction']` no `phase0-basic.js`.
 * @param {object} [dependencies] repassado a toda chamada de domínio — hoje só
 *   `sendModal` importa aqui (Tarefa 10: UI-Depot-Bridge), o resto vem do
 *   default de `_deps()`.
 */
function registerInteractions(dependencies = {}) {
  const deps = _deps(dependencies);
  const comum = {
    module: MODULE_ID,
    target: interactionRegistry.TARGET_TYPES.OBJECT,
    section: 'deposito',
    distance: DEPOT_INTERACT_RANGE,
    // O objeto só é um alvo válido de depósito se estiver em depot_terminals.
    // Um MpObjectReference qualquer (uma pedra, um NPC morto) nunca aparece
    // no menu de interação por este caminho.
    canSee: async (ctx) => Boolean(await resolveTerminal(ctx.target.formId, dependencies))
  };

  interactionRegistry.register({
    ...comum,
    id: 'depot.view',
    label: 'Ver depósito',
    order: 10,
    audit: interactionRegistry.AUDIT_LEVELS.TRACE,
    execute: async (ctx) => {
      const holdId = await resolveTerminal(ctx.target.formId, dependencies);
      if (!holdId) throw new Error('Este objeto nao e um terminal de deposito.');
      const payload = await _panelPayload(ctx.characterId, holdId, ctx.target.formId, dependencies);
      // A CEF ainda não desenha nada a partir do retorno de `execute` (vira só
      // uma notificação de chat — `interaction-service.js` handleUiEvent). O
      // canal que abre a tela de verdade é `sendModal`, mesmo usado por
      // `interaction:actions`.
      deps.sendModal(ctx.actorId, 'depot:open', payload);
      return { message: null };
    }
  });

  interactionRegistry.register({
    ...comum,
    id: 'depot.deposit',
    label: 'Depositar item',
    order: 20,
    audit: interactionRegistry.AUDIT_LEVELS.ECONOMY,
    schema: {
      baseId: { type: 'formid', label: 'Item', required: true },
      count: { type: 'int', label: 'Quantidade', min: 1, default: 1 }
    },
    execute: async (ctx) => {
      const holdId = await resolveTerminal(ctx.target.formId, dependencies);
      if (!holdId) throw new Error('Este objeto nao e um terminal de deposito.');
      const result = await depositItem(
        { characterId: ctx.characterId, holdId, baseId: ctx.data.baseId, count: ctx.data.count },
        dependencies
      );
      if (result.ok) {
        const payload = await _panelPayload(ctx.characterId, holdId, ctx.target.formId, dependencies);
        deps.sendModal(ctx.actorId, 'depot:update', payload);
      }
      return result;
    }
  });

  interactionRegistry.register({
    ...comum,
    id: 'depot.withdraw',
    label: 'Retirar item',
    order: 30,
    audit: interactionRegistry.AUDIT_LEVELS.ECONOMY,
    schema: {
      baseId: { type: 'formid', label: 'Item', required: true },
      count: { type: 'int', label: 'Quantidade', min: 1, default: 1 }
    },
    execute: async (ctx) => {
      const holdId = await resolveTerminal(ctx.target.formId, dependencies);
      if (!holdId) throw new Error('Este objeto nao e um terminal de deposito.');
      const result = await withdrawItem(
        { characterId: ctx.characterId, holdId, baseId: ctx.data.baseId, count: ctx.data.count },
        dependencies
      );
      if (result.ok) {
        const payload = await _panelPayload(ctx.characterId, holdId, ctx.target.formId, dependencies);
        deps.sendModal(ctx.actorId, 'depot:update', payload);
      }
      return result;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Comando de chat — fallback enquanto não houver UI CEF dedicada (brief §6)
// ─────────────────────────────────────────────────────────────────────────────

function commandDefs() {
  return [
    {
      name: '/depot',
      description: 'Ve o conteudo do deposito regional (precisa estar perto de um terminal)',
      usage: '/depot',
      handler: async (actorId) => {
        const commands = require('../commands');
        const personagem = commands.getActiveCharacterData(actorId);
        if (!personagem) return;
        commands.sendNotification(
          actorId,
          '[Deposito] Use o menu de interacao perto de um bau de deposito registrado.'
        );
      }
    }
  ];
}

module.exports = {
  MODULE_ID,
  DEPOT_INTERACT_RANGE,
  getOrCreateDepot,
  getDepotContents,
  depositItem,
  withdrawItem,
  getGoldBalance,
  resolveTerminal,
  registerInteractions,
  commandDefs
};

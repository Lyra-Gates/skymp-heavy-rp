/**
 * core/crime-service.js
 *
 * Fundação do Sistema de Crime e Proveniência (Tarefa 12). "Ladino" não é uma
 * profissão neste projeto — é uma identidade emergente das ações registradas
 * aqui. O pilar técnico é o inventário híbrido: um item comum continua
 * fungível em `character_inventory` (pilha por `base_id`); um item roubado sai
 * da pilha na hora do roubo e vira uma linha própria em `item_instances`, com
 * UUID e histórico de posse — ver `migration-v21-crime-provenance.sql`.
 *
 * ─── Escopo da fundação (Tarefa 12, 21/08/2026) ─────────────────────────────
 *
 * Migration + motor de regra (hot item, anti-combat-log, restituição) +
 * `audit_logs.is_crime`.
 *
 * ─── Escopo da Tarefa 13 (Interações Criminais e Autoridade de Guarda) ──────
 *
 * `crime.surrender` (SELF) e `crime.rob` (PLAYER) no Interaction Framework —
 * roubo só é permitido contra alvo rendido (`character-state.SURRENDERED`,
 * setado por `crime.surrender`) ou incapacitado (`RESTRAINED`/`DOWNED`, já
 * existentes). `getStolenInstancesHeldBy` resolve `original_owner_id` para
 * nome de personagem — é o que `governance-service.showInventorySnapshot`
 * chama para a Revista Institucional dizer "este anel pertence a
 * Balgruuf", nunca "ele é ladrão" (nenhum oráculo). `markItemConfiscated`
 * implementa a Lógica de Evidência: o item confiscado perde `hot` mas
 * continua `stolen` até ser restituído — nunca vira `clean` por confisco
 * sozinho.
 *
 * `governance-service.js` já tinha `requestSearch`/`approveSearch`/
 * `confiscateItem` e o cargo `guard` com `GUARD_SEARCH`/`GUARD_CONFISCATE` —
 * a autorização "só cargos aprovados disparam a revista" já existia antes
 * desta tarefa; o que faltava era a revista **saber sobre proveniência**.
 *
 * ─── Animação de rendição: gap conhecido ────────────────────────────────────
 *
 * Não existe `animation-service.js` neste projeto. `crime.surrender` reusa o
 * mesmo primitivo Papyrus que `admin-service.playAnimation` já usa
 * (`Actor.PlayIdle`), com um nome de idle que é **suposição, não validada em
 * jogo** — mesma ressalva de `core/interaction-targets.js` sobre
 * `locationalData`. A mudança de estado (`SURRENDERED`) é o que
 * `crime.rob` de fato verifica; a animação é só o sinal visual, best-effort
 * e nunca bloqueia a rendição se falhar.
 *
 * ─── Por que só item roubado vira instância (não "valor alto") ─────────────
 *
 * Decisão do dono do produto: instanciar por valor exigiria uma tabela de
 * preço por `base_id` confiável, que este projeto não tem hoje. Instanciação
 * lazy — só no momento do roubo — mantém todo item nunca roubado 100% na
 * pilha comum, com custo zero.
 *
 * ─── Atomicidade ─────────────────────────────────────────────────────────
 *
 * `markItemStolen` e a restituição usam as primitivas `tx.*` de
 * `transaction-service.js` (mesmo contrato que `depot-service.js` já segue):
 * uma única transação SQL move a posse física E marca a proveniência. Nunca
 * duas transações separadas para a mesma operação de roubo.
 *
 * ─── Restituição Técnica ────────────────────────────────────────────────────
 *
 * Reusa `core/depot-service.js` (decisão do dono do produto, 21/08/2026): o
 * item volta para o depósito do dono original no hold onde o roubo aconteceu
 * (`item_instances.last_hold_id`), não para um mecanismo de devolução novo.
 * Se o módulo `depot` estiver desligado, a restituição fica pendente e é
 * tentada de novo na próxima varredura — nunca falha o boot do `crime` por
 * causa disso (dependência opcional, não obrigatória).
 */

'use strict';

const crypto = require('crypto');
const database = require('../database');
const moduleRegistry = require('./module-registry');
const serverOptions = require('./server-options');
const transactionService = require('./transaction-service');
const depotService = require('./depot-service');
const commands = require('../commands');
const characterState = require('./character-state');
const interactionRegistry = require('./interaction-registry');
const { actorRef } = require('./papyrus');

const MODULE_ID = 'crime';

/** Estados de `item_instances.status`. */
const STATUS = Object.freeze({ HOT: 'hot', STOLEN: 'stolen', CLEAN: 'clean' });

/**
 * Alcance de `crime.rob` — roubo é contato próximo, não uma ação a
 * distância. Constante simples (geometria, não balanceamento), mesmo
 * critério de `DEPOT_INTERACT_RANGE` em `core/depot-service.js`.
 */
const ROB_RANGE = 150;

/**
 * [DOC] Nome de idle tocado em `crime.surrender`, via o mesmo primitivo que
 * `admin-service.playAnimation` usa (`Actor.PlayIdle`). Suposto a partir de
 * convenções comuns de idle vanilla de "mãos ao alto/rendição" — **não
 * validado em jogo neste projeto**. Nunca bloqueia a rendição se a chamada
 * falhar (ver `_applySurrenderAnimation`).
 */
const SURRENDER_IDLE = 'IdleHandsForward';

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/** @param {object} dependencies */
function _deps(dependencies = {}) {
  return {
    db: dependencies.db || database,
    moduleRegistry: dependencies.moduleRegistry || moduleRegistry,
    serverOptions: dependencies.serverOptions || serverOptions,
    tx: dependencies.tx || transactionService.tx,
    depot: dependencies.depot || depotService,
    commands: dependencies.commands || commands,
    characterState: dependencies.characterState || characterState,
    logger: dependencies.logger || console
  };
}

function _isModuleEnabled(deps) {
  return deps.moduleRegistry.isEnabled(MODULE_ID);
}

function _isPositiveInt(v) {
  return Number.isSafeInteger(v) && v > 0;
}

function _appendProvenance(existingJson, entry) {
  let list = [];
  if (existingJson) {
    // mysql2 já devolve JSON parseado quando a coluna é JSON; string é o caso
    // de teste com stub de banco puro.
    list = typeof existingJson === 'string' ? JSON.parse(existingJson) : existingJson;
  }
  return [...list, entry];
}

async function _resolveAccountId(conn, characterId) {
  if (!_isPositiveInt(characterId)) return null;
  const [rows] = await conn.query('SELECT account_id FROM characters WHERE id = ?', [characterId]);
  return rows.length > 0 ? rows[0].account_id : null;
}

/**
 * Grava em `audit_logs` com `is_crime=1`. Toda transferência de item
 * instanciado passa por aqui — objetivo 5 do brief. Roda dentro da MESMA
 * transação `conn` do movimento de posse, nunca depois do commit.
 */
async function _recordCrimeAudit(conn, { action, actorCharacterId, targetCharacterId, itemInstanceId, details }) {
  const actorAccountId = await _resolveAccountId(conn, actorCharacterId);
  const targetAccountId = await _resolveAccountId(conn, targetCharacterId);
  await conn.query(
    `INSERT INTO audit_logs (action, actor_account_id, target_account_id, details, is_crime, item_instance_id)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [action, actorAccountId, targetAccountId, details ? JSON.stringify(details) : null, itemInstanceId || null]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Roubo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca 1 unidade de `baseId` como roubada: transfere a posse física de
 * `victimCharacterId` para `thiefCharacterId` e cria (ou atualiza, em caso de
 * refurto) a linha de `item_instances` — tudo em uma única transação SQL.
 *
 * @param {object} opts
 * @param {number} [opts.victimActorId] Actor SkyMP da vítima, para aplicar no cliente
 * @param {number} opts.victimCharacterId
 * @param {number} [opts.thiefActorId] Actor SkyMP do ladrão, para aplicar no cliente
 * @param {number} opts.thiefCharacterId
 * @param {number} opts.baseId FormID nativo do item roubado
 * @param {string} opts.holdId Hold onde o roubo ocorreu (usado pela Restituição Técnica)
 * @param {string} [opts.reason] Motivo/contexto do roubo (padrão: 'crime_theft')
 * @param {object} [dependencies]
 */
async function markItemStolen(opts, dependencies = {}) {
  const deps = _deps(dependencies);
  const {
    victimActorId, victimCharacterId,
    thiefActorId, thiefCharacterId,
    baseId, holdId, reason = 'crime_theft'
  } = opts || {};

  if (!_isModuleEnabled(deps)) return { ok: false, code: 'module_disabled' };
  if (!_isPositiveInt(victimCharacterId)) return { ok: false, code: 'invalid_victim' };
  if (!_isPositiveInt(thiefCharacterId)) return { ok: false, code: 'invalid_thief' };
  if (victimCharacterId === thiefCharacterId) return { ok: false, code: 'self_theft' };
  if (!_isPositiveInt(baseId)) return { ok: false, code: 'invalid_item' };
  if (typeof holdId !== 'string' || !holdId) return { ok: false, code: 'invalid_hold' };

  const conn = await deps.db.getConnection();
  try {
    await conn.beginTransaction();

    // Mesma primitiva que qualquer outra transferência de item deste projeto
    // usa (`depot-service.depositItem`, `transfer` de trade) — nenhuma segunda
    // implementação de "como mexer em item". `applyStackDelta` já recusa (via
    // throw, capturado abaixo) se a vítima não tiver o item de verdade.
    await deps.tx.applyStackDelta(conn, 'character_inventory', victimCharacterId, baseId, -1);
    await deps.tx.applyStackDelta(conn, 'character_inventory', thiefCharacterId, baseId, 1);
    await deps.tx.recordInventoryLedger(conn, { characterId: victimCharacterId, baseId, delta: -1, reason, module: MODULE_ID });
    await deps.tx.recordInventoryLedger(conn, { characterId: thiefCharacterId, baseId, delta: 1, reason, module: MODULE_ID });

    // Refurto: o item já era uma instância rastreada (roubado de outro
    // ladrão). Atualiza a MESMA linha — `original_owner_id` nunca muda depois
    // da primeira vez que o item entra em `item_instances`, senão a
    // proveniência perde o dono legítimo original.
    const [existing] = await conn.query(
      `SELECT id, provenance_data FROM item_instances
        WHERE base_id = ? AND current_owner_id = ? AND status IN ('hot', 'stolen') FOR UPDATE`,
      [baseId, victimCharacterId]
    );

    let instanceId;
    const now = new Date();
    if (existing.length > 0) {
      instanceId = existing[0].id;
      const provenance = _appendProvenance(existing[0].provenance_data, { ownerId: thiefCharacterId, at: now.toISOString(), reason });
      await conn.query(
        `UPDATE item_instances
            SET current_owner_id = ?, status = 'hot', stolen_at = NOW(), last_hold_id = ?, provenance_data = ?
          WHERE id = ?`,
        [thiefCharacterId, holdId, JSON.stringify(provenance), instanceId]
      );
    } else {
      instanceId = uuid();
      let provenance = _appendProvenance(null, { ownerId: victimCharacterId, at: now.toISOString(), reason: 'original_owner' });
      provenance = _appendProvenance(provenance, { ownerId: thiefCharacterId, at: now.toISOString(), reason });
      await conn.query(
        `INSERT INTO item_instances
          (id, base_id, original_owner_id, current_owner_id, status, stolen_at, last_hold_id, provenance_data)
         VALUES (?, ?, ?, ?, 'hot', NOW(), ?, ?)`,
        [instanceId, baseId, victimCharacterId, thiefCharacterId, holdId, JSON.stringify(provenance)]
      );
    }

    await _recordCrimeAudit(conn, {
      action: 'crime.item_theft',
      actorCharacterId: thiefCharacterId,
      targetCharacterId: victimCharacterId,
      itemInstanceId: instanceId,
      details: { baseId, holdId, reason }
    });

    await conn.commit();

    deps.tx.applyToClient(victimActorId, baseId, -1);
    deps.tx.applyToClient(thiefActorId, baseId, 1);

    deps.logger.log(`[crime] roubo: item=0x${baseId.toString(16)} victima=${victimCharacterId} ladrao=${thiefCharacterId} instancia=${instanceId}`);
    return { ok: true, data: { instanceId } };
  } catch (err) {
    await conn.rollback();
    deps.logger.error('[crime] markItemStolen falhou:', err.message);
    return { ok: false, code: 'error', error: err.message };
  } finally {
    conn.release();
  }
}

/** Lê a instância ativa de um item, se houver. */
async function getInstance(instanceId, dependencies = {}) {
  const deps = _deps(dependencies);
  const rows = await deps.db.query('SELECT * FROM item_instances WHERE id = ?', [instanceId]);
  return rows.length > 0 ? rows[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proveniência para a Revista Institucional (Tarefa 13)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Itens que `characterId` carrega e que têm proveniência suja (`hot` ou
 * `stolen`), com o nome do dono original já resolvido — nunca um
 * `characterId` cru. É o que faz a UI de revista dizer "Este anel pertence a
 * Balgruuf Pedra-Cinzenta!" em vez de "ele é ladrão": o veredito é do
 * jogador que lê o nome, não do servidor rotulando ninguém.
 *
 * @param {number} characterId
 * @param {object} [dependencies]
 * @returns {Promise<Array<{instanceId:string, baseId:number, status:string, originalOwnerId:number, originalOwnerName:string}>>}
 */
async function getStolenInstancesHeldBy(characterId, dependencies = {}) {
  const deps = _deps(dependencies);
  if (!_isPositiveInt(characterId)) return [];

  const rows = await deps.db.query(
    `SELECT ii.id, ii.base_id, ii.status, ii.original_owner_id, c.first_name, c.last_name
       FROM item_instances ii
       JOIN characters c ON c.id = ii.original_owner_id
      WHERE ii.current_owner_id = ? AND ii.status IN ('hot', 'stolen')
      ORDER BY ii.base_id`,
    [characterId]
  );

  return rows.map((row) => ({
    instanceId: row.id,
    baseId: Number(row.base_id),
    status: row.status,
    originalOwnerId: row.original_owner_id,
    originalOwnerName: `${row.first_name} ${row.last_name}`.trim()
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidência: confisco (Tarefa 13)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca 1 instância confiscada: perde `hot` (deixa de contar como "roubo
 * recente" para fins de bounty/alerta) mas continua `stolen` — nunca vira
 * `clean` por confisco sozinho. Só a Restituição Técnica (`sweep`/
 * `_restitute`, de volta ao dono original) ou uma devolução equivalente pode
 * limpar a proveniência.
 *
 * Não move item nenhum: `governance-service.confiscateItem` já chamou
 * `inventory.removeItem` antes disso (é o que tira o item fisicamente do
 * personagem); aqui é só a atualização de metadados de proveniência. Não
 * grava em `confiscations` — essa tabela já existe desde
 * `migration-v3-governance.sql` e `governance-service.js` grava nela
 * diretamente; `migration-v22-crime-interactions.sql` só ADICIONA a coluna
 * `item_instance_id` a ela, pra ligar o registro de evidência de volta à
 * instância rastreada.
 *
 * @param {object} opts
 * @param {number} opts.characterId de quem o item foi confiscado
 * @param {number} opts.baseId
 * @param {object} [dependencies]
 */
async function markItemConfiscated(opts, dependencies = {}) {
  const deps = _deps(dependencies);
  const { characterId, baseId } = opts || {};

  if (!_isModuleEnabled(deps)) return { ok: false, code: 'module_disabled' };
  if (!_isPositiveInt(characterId) || !_isPositiveInt(baseId)) return { ok: false, code: 'invalid_input' };

  const conn = await deps.db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, status FROM item_instances
        WHERE current_owner_id = ? AND base_id = ? AND status IN ('hot', 'stolen') FOR UPDATE`,
      [characterId, baseId]
    );
    if (rows.length === 0) {
      await conn.rollback();
      // Não é erro: a maioria dos itens confiscados nunca foi roubada, e o
      // confisco comum (`governance-service.confiscateItem`) continua
      // funcionando sem instância nenhuma para atualizar.
      return { ok: false, code: 'no_instance' };
    }

    const instance = rows[0];
    if (instance.status === 'hot') {
      await conn.query(`UPDATE item_instances SET status = 'stolen' WHERE id = ?`, [instance.id]);
    }

    await _recordCrimeAudit(conn, {
      action: 'crime.item_confiscated',
      actorCharacterId: null,
      targetCharacterId: characterId,
      itemInstanceId: instance.id,
      details: { baseId }
    });

    await conn.commit();
    return { ok: true, data: { instanceId: instance.id } };
  } catch (err) {
    await conn.rollback();
    deps.logger.error('[crime] markItemConfiscated falhou:', err.message);
    return { ok: false, code: 'error', error: err.message };
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-Combat-Log
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assinante de `commands.onCharacterRemoved`. Cria um `session_crime_alert`
 * para cada item 'hot' que o personagem carregava ao desconectar — a
 * varredura (`sweep`) decide depois se ele voltou a tempo ou se o item é
 * restituído.
 *
 * @param {number} actorId
 * @param {{characterId: number}} character forma exata que `commands.js`
 *   passa aos assinantes de `onCharacterRemoved` (campo é `characterId`, não `id`)
 * @param {object} [dependencies]
 */
async function onCharacterDisconnected(actorId, character, dependencies = {}) {
  const deps = _deps(dependencies);
  if (!_isModuleEnabled(deps)) return;

  const characterId = character && character.characterId;
  if (!_isPositiveInt(characterId)) return;

  const hotItems = await deps.db.query(
    `SELECT id FROM item_instances WHERE current_owner_id = ? AND status = 'hot'`,
    [characterId]
  );
  for (const row of hotItems) {
    await deps.db.query(
      'INSERT INTO session_crime_alerts (character_id, item_instance_id) VALUES (?, ?)',
      [characterId, row.id]
    );
  }
  if (hotItems.length > 0) {
    deps.logger.log(`[crime] ${hotItems.length} alerta(s) de combat-log criado(s) ao desconectar personagem ${characterId}`);
  }
}

/**
 * Devolve 1 unidade de `alert.base_id` ao dono original via `depot-service`,
 * dentro de uma única transação junto com a atualização de `item_instances`.
 * @param {{character_id:number, base_id:number, item_instance_id:string, original_owner_id:number}} alert
 * @param {object} deps já resolvidos por `_deps`
 */
async function _restitute(alert, deps) {
  if (!deps.moduleRegistry.isEnabled('depot')) {
    return { ok: false, code: 'depot_disabled' };
  }

  const rows = await deps.db.query('SELECT last_hold_id FROM item_instances WHERE id = ?', [alert.item_instance_id]);
  const holdId = rows.length > 0 ? rows[0].last_hold_id : null;
  if (!holdId) return { ok: false, code: 'missing_hold' };

  // Garante que o depósito do dono original existe (abre a própria
  // transação curta, mesmo padrão que `depot-service.depositItem` já usa
  // internamente) antes de travar a linha na transação principal abaixo.
  const depot = await deps.depot.getOrCreateDepot(alert.original_owner_id, holdId, deps);

  const conn = await deps.db.getConnection();
  try {
    await conn.beginTransaction();

    const [depotRows] = await conn.query('SELECT id FROM character_depots WHERE id = ? FOR UPDATE', [depot.id]);
    if (depotRows.length === 0) {
      await conn.rollback();
      return { ok: false, code: 'depot_not_found' };
    }

    await deps.tx.applyStackDelta(conn, 'character_inventory', alert.character_id, alert.base_id, -1);
    await deps.tx.recordInventoryLedger(conn, { characterId: alert.character_id, baseId: alert.base_id, delta: -1, reason: 'crime_restitution', module: MODULE_ID });
    await deps.tx.applyStackDelta(conn, 'depot_inventory', depot.id, alert.base_id, 1);

    await conn.query(
      `UPDATE item_instances SET current_owner_id = ?, status = 'clean' WHERE id = ?`,
      [alert.original_owner_id, alert.item_instance_id]
    );

    await _recordCrimeAudit(conn, {
      action: 'crime.item_restitution',
      actorCharacterId: null,
      targetCharacterId: alert.original_owner_id,
      itemInstanceId: alert.item_instance_id,
      details: { baseId: alert.base_id, holdId, thiefCharacterId: alert.character_id }
    });

    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    return { ok: false, code: 'error', error: err.message };
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Varredura periódica
// ─────────────────────────────────────────────────────────────────────────────

/**
 * (1) Esfria item 'hot' para 'stolen' após `crime.hotItemWindowMinutes`.
 * (2) Resolve alertas de combat-log: se o personagem já está online de novo,
 *     resolve sem restituição; se a graça (`crime.combatLogGraceMinutes`)
 *     passou e ele segue offline, restitui via `depot-service`.
 *
 * Chamada por um `setInterval` próprio (ver `initSweepTimer`), nunca a partir
 * de um evento de jogo — mesmo idioma que `market-stalls-service.expireStalls`.
 */
async function sweep(dependencies = {}) {
  const deps = _deps(dependencies);
  if (!_isModuleEnabled(deps)) return { cooled: 0, restituted: 0, pending: 0 };

  const hotWindowMinutes = deps.serverOptions.get('crime.hotItemWindowMinutes');
  const graceMinutes = deps.serverOptions.get('crime.combatLogGraceMinutes');

  const cooledResult = await deps.db.query(
    `UPDATE item_instances SET status = 'stolen'
      WHERE status = 'hot' AND stolen_at <= NOW() - INTERVAL ? MINUTE`,
    [hotWindowMinutes]
  );
  const cooled = cooledResult.affectedRows || 0;

  const pendingAlerts = await deps.db.query(
    `SELECT sca.id AS alert_id, sca.character_id, sca.item_instance_id,
            ii.base_id, ii.original_owner_id
       FROM session_crime_alerts sca
       JOIN item_instances ii ON ii.id = sca.item_instance_id
      WHERE sca.resolved = 0 AND sca.disconnected_at <= NOW() - INTERVAL ? MINUTE`,
    [graceMinutes]
  );

  let restituted = 0;
  for (const alert of pendingAlerts) {
    // Jogador voltou antes desta varredura rodar: resolve sem restituição.
    if (deps.commands.getActiveActorByCharacterId(alert.character_id)) {
      await deps.db.query('UPDATE session_crime_alerts SET resolved = 1, resolved_at = NOW() WHERE id = ?', [alert.alert_id]);
      continue;
    }

    const result = await _restitute(alert, deps);
    if (result.ok) {
      restituted += 1;
      await deps.db.query('UPDATE session_crime_alerts SET resolved = 1, resolved_at = NOW() WHERE id = ?', [alert.alert_id]);
    } else {
      // Fica pendente (`resolved=0`) — tentado de novo na próxima varredura.
      // `depot_disabled` é o caso esperado se ninguém ligou ENABLE_DEPOT_SERVICE.
      deps.logger.error(`[crime] restituicao adiada para alerta ${alert.alert_id}: ${result.code}`);
    }
  }

  return { cooled, restituted, pending: pendingAlerts.length - restituted };
}

let _sweepTimer = null;

/** Inicia a varredura periódica. Chamado do `initialize()` do módulo. */
function initSweepTimer(dependencies = {}) {
  const deps = _deps(dependencies);
  const intervalSeconds = deps.serverOptions.get('crime.sweepIntervalSeconds');
  _sweepTimer = setInterval(async () => {
    try {
      const result = await sweep(dependencies);
      if (result.cooled > 0 || result.restituted > 0) {
        deps.logger.log(`[crime] varredura: ${result.cooled} esfriado(s), ${result.restituted} restituido(s), ${result.pending} pendente(s)`);
      }
    } catch (err) {
      deps.logger.error('[crime] varredura falhou:', err.message);
    }
  }, intervalSeconds * 1000);
}

/** Para a varredura periódica. Chamado do `shutdown()` do módulo. */
function stopSweepTimer() {
  if (_sweepTimer) {
    clearInterval(_sweepTimer);
    _sweepTimer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction Framework — crime.surrender / crime.rob (Tarefa 13)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Um alvo é roubável se está rendido (voluntário, `crime.surrender`) ou
 * incapacitado (`RESTRAINED` — algemado pela guarda, ou `DOWNED` — abatido em
 * combate). Nenhum dos dois é setado por este arquivo; `crime.rob` só lê.
 */
function _isRobbable(characterId, deps) {
  return deps.characterState.is(characterId, [
    deps.characterState.STATES.SURRENDERED,
    deps.characterState.STATES.RESTRAINED,
    deps.characterState.STATES.DOWNED
  ]);
}

/** Best-effort: nunca lança, nunca bloqueia a rendição. Ver nota [DOC] no cabeçalho. */
function _applySurrenderAnimation(actorId) {
  if (typeof mp === 'undefined') return;
  try {
    mp.callPapyrusFunction('method', 'Actor', 'PlayIdle', actorRef(actorId), [SURRENDER_IDLE]);
  } catch (err) {
    console.error('[crime] animacao de rendicao falhou (ignorado):', err.message);
  }
}

/**
 * Registra `crime.surrender` (SELF) e `crime.rob` (PLAYER) no Interaction
 * Framework. Chamado do `initialize()` do módulo — precisa do framework de
 * interação já de pé (`dependencies: ['interaction']` no `phase0-basic.js`,
 * mesmo padrão de `depot-service.registerInteractions`).
 *
 * O resolvedor de `TARGET_TYPES.SELF` já existe (registrado por
 * `core/character-dashboard-bridge.js`, Tarefa 11) — este arquivo não
 * registra um segundo, só declara mais uma interação contra o tipo.
 */
function registerInteractions(dependencies = {}) {
  const deps = _deps(dependencies);
  interactionRegistry.unregisterModule(MODULE_ID);

  interactionRegistry.register({
    id: 'crime.surrender',
    module: MODULE_ID,
    target: interactionRegistry.TARGET_TYPES.SELF,
    section: 'crime',
    label: 'Render-se',
    order: 10,
    audit: interactionRegistry.AUDIT_LEVELS.GAMEPLAY,
    execute: async (ctx) => {
      deps.characterState.set(ctx.characterId, deps.characterState.STATES.SURRENDERED, { at: Date.now() });
      _applySurrenderAnimation(ctx.actorId);
      deps.commands.broadcastProximityMessage(ctx.actorId, '* Levanta as maos e se rende.', 600);
      return { message: 'Voce se rendeu. Qualquer um por perto pode revistar ou roubar seus itens agora.' };
    }
  });

  interactionRegistry.register({
    id: 'crime.rob',
    module: MODULE_ID,
    target: interactionRegistry.TARGET_TYPES.PLAYER,
    section: 'crime',
    label: 'Roubar',
    order: 20,
    distance: ROB_RANGE,
    audit: interactionRegistry.AUDIT_LEVELS.SECURITY,
    schema: {
      baseId: { type: 'formid', label: 'Item', required: true, placeholder: '0x0000000F' },
      // Sem resolvedor de "hold pela posicao do jogador" neste projeto (ver
      // core/interaction-targets.js, cabecalho, sobre locationalData). O
      // cliente informa; usado só pela Restituicao Tecnica pra saber onde
      // devolver depois — nunca afeta o roubo em si.
      holdId: { type: 'string', label: 'Regiao atual', max: 64, default: 'unknown' }
    },
    // `canSee`/`canExecute` são o mesmo veredito: se o alvo não é roubável, a
    // ação nem aparece no menu. `execute` confere de novo (redundante de
    // propósito, mesmo critério do resto do pipeline).
    canSee: async (ctx) => _isRobbable(ctx.target.characterId, deps),
    canExecute: async (ctx) => {
      const robbable = _isRobbable(ctx.target.characterId, deps);
      return { allowed: robbable, reason: robbable ? '' : 'O alvo precisa estar rendido ou incapacitado.' };
    },
    execute: async (ctx) => {
      if (!_isRobbable(ctx.target.characterId, deps)) {
        throw new Error('Alvo nao esta rendido nem incapacitado.');
      }
      const result = await markItemStolen({
        victimActorId: ctx.target.actorId,
        victimCharacterId: ctx.target.characterId,
        thiefActorId: ctx.actorId,
        thiefCharacterId: ctx.characterId,
        baseId: ctx.data.baseId,
        holdId: ctx.data.holdId || 'unknown'
      }, dependencies);
      if (!result.ok) throw new Error('Nao foi possivel roubar este item.');
      return { message: 'Item roubado.', data: result.data };
    }
  });
}

module.exports = {
  MODULE_ID,
  STATUS,
  ROB_RANGE,
  markItemStolen,
  getInstance,
  getStolenInstancesHeldBy,
  markItemConfiscated,
  onCharacterDisconnected,
  sweep,
  initSweepTimer,
  stopSweepTimer,
  registerInteractions,

  // Exposto só para teste.
  _restitute,
  _isRobbable
};

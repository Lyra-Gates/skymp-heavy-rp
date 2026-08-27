/**
 * Trabalho Público: rotas físicas simples, persistentes e sem profissão.
 * Cliente escolhe uma ação; alvo, estado, carga, recompensa e relógio são do servidor.
 */
'use strict';

const crypto = require('crypto');
const database = require('./database');
const transactionService = require('./core/transaction-service');
const interactionRegistry = require('./core/interaction-registry');
const physicalAnchorRegistry = require('./core/physical-anchor-registry');
const publicWorkRegistry = require('./core/public-work-registry');
const publicWorkConfig = require('./core/public-work-config');
const stateMachine = require('./core/public-work-state-machine');
const serverOptions = require('./core/server-options');

const MODULE = 'public-work';
const TERMINAL = new Set(['completed', 'cancelled', 'expired']);

function createPublicWorkService(overrides = {}) {
  const db = overrides.db || database;
  const tx = overrides.transactionService || transactionService;
  const workRegistry = overrides.workRegistry || publicWorkRegistry;
  const interactions = overrides.interactionRegistry || interactionRegistry;
  const anchors = overrides.physicalAnchorRegistry || physicalAnchorRegistry;
  const options = overrides.serverOptions || serverOptions;
  const configLoader = overrides.configLoader || publicWorkConfig;
  const now = overrides.now || (() => new Date());
  const cargoToken = overrides.cargoToken || (() => crypto.randomBytes(24).toString('base64url'));
  let sweepTimer = null;
  const counters = { accepted: 0, pickedUp: 0, completed: 0, cancelled: 0, expired: 0, payments: 0 };

  function rowToRun(row) {
    if (!row) return null;
    return {
      id: Number(row.id), characterId: Number(row.character_id), workCode: row.work_code,
      originFormDesc: row.origin_form_desc, originLabel: row.origin_label,
      destinationFormDesc: row.destination_form_desc, destinationLabel: row.destination_label,
      rewardAmount: Number(row.reward_amount), cooldownGroup: row.cooldown_group,
      cooldownSeconds: Number(row.cooldown_seconds), status: row.status,
      cargoToken: row.cargo_token || null, assignmentRequestId: row.assignment_request_id,
      pickupRequestId: row.pickup_request_id || null,
      completionRequestId: row.completion_request_id || null,
      startedAt: new Date(row.started_at), expiresAt: new Date(row.expires_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null
    };
  }

  async function rollback(conn, result) {
    await conn.rollback();
    return result;
  }

  async function event(conn, runId, characterId, from, to, reason, key, at) {
    await conn.query(
      `INSERT INTO public_work_events
        (run_id, character_id, from_status, to_status, reason, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [runId, characterId, from, to, reason, key || null, at]
    );
  }

  async function getActiveRun(characterId, runner = db, lock = false) {
    const sql = `SELECT r.* FROM public_work_active_slots s
      JOIN public_work_runs r ON r.id = s.run_id
      WHERE s.character_id = ?${lock ? ' FOR UPDATE' : ''}`;
    const raw = await runner.query(sql, [characterId]);
    const rows = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw;
    return rowToRun(rows[0]);
  }

  async function canAccept(characterId, definition) {
    if (await getActiveRun(characterId)) return { ok: false, code: 'active_run' };
    const rows = await db.query(
      `SELECT available_at FROM public_work_cooldowns
       WHERE character_id = ? AND cooldown_group = ?`,
      [characterId, definition.cooldownGroup]
    );
    if (rows.length && now() < new Date(rows[0].available_at)) {
      return { ok: false, code: 'cooldown', availableAt: new Date(rows[0].available_at) };
    }
    return { ok: true };
  }

  async function acceptWork({ characterId, workCode, requestId }) {
    const definition = workRegistry.get(workCode);
    if (!definition) return { ok: false, code: 'unknown_work' };
    const timestamp = now();
    const built = stateMachine.createAssignedRun({ id: null, characterId, definition, requestId, now: timestamp });
    if (!built.ok) return built;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [replays] = await conn.query(
        'SELECT * FROM public_work_runs WHERE assignment_request_id = ? FOR UPDATE', [requestId]
      );
      if (replays.length) {
        if (Number(replays[0].character_id) !== characterId) return rollback(conn, { ok: false, code: 'idempotency_conflict' });
        return rollback(conn, { ok: true, replay: true, run: rowToRun(replays[0]) });
      }

      const active = await getActiveRun(characterId, conn, true);
      if (active) return rollback(conn, { ok: false, code: 'active_run', run: active });

      const [cooldowns] = await conn.query(
        `SELECT available_at FROM public_work_cooldowns
         WHERE character_id = ? AND cooldown_group = ? FOR UPDATE`,
        [characterId, definition.cooldownGroup]
      );
      if (cooldowns.length && timestamp < new Date(cooldowns[0].available_at)) {
        return rollback(conn, { ok: false, code: 'cooldown', availableAt: new Date(cooldowns[0].available_at) });
      }

      const run = built.run;
      const [inserted] = await conn.query(
        `INSERT INTO public_work_runs
          (character_id, work_code, origin_form_desc, origin_label, destination_form_desc, destination_label,
           reward_amount, cooldown_group, cooldown_seconds, status,
           assignment_request_id, started_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'assigned', ?, ?, ?)`,
        [characterId, run.workCode, run.originFormDesc, run.originLabel,
          run.destinationFormDesc, run.destinationLabel,
          run.rewardAmount, run.cooldownGroup, definition.cooldownSeconds,
          requestId, run.startedAt, run.expiresAt]
      );
      const runId = Number(inserted.insertId);
      await conn.query('INSERT INTO public_work_active_slots (character_id, run_id) VALUES (?, ?)', [characterId, runId]);
      await event(conn, runId, characterId, null, 'assigned', 'accepted', `public-work:assign:${requestId}`, timestamp);
      await conn.commit();
      counters.accepted += 1;
      return { ok: true, replay: false, run: { ...run, id: runId, cooldownSeconds: definition.cooldownSeconds } };
    } catch (err) {
      await conn.rollback();
      if (err && err.code === 'ER_DUP_ENTRY') {
        const rows = await db.query('SELECT * FROM public_work_runs WHERE assignment_request_id = ?', [requestId]);
        if (rows.length && Number(rows[0].character_id) === characterId) return { ok: true, replay: true, run: rowToRun(rows[0]) };
        if (rows.length) return { ok: false, code: 'idempotency_conflict' };
        return { ok: false, code: 'active_run' };
      }
      throw err;
    } finally { conn.release(); }
  }

  async function expireLocked(conn, run, timestamp, reason = 'deadline') {
    await conn.query(
      `UPDATE public_work_runs SET status = 'expired', cargo_token = NULL WHERE id = ?`, [run.id]
    );
    await conn.query('DELETE FROM public_work_active_slots WHERE character_id = ? AND run_id = ?', [run.characterId, run.id]);
    await event(conn, run.id, null, run.status, 'expired', reason, `public-work:expire:${run.id}`, timestamp);
  }

  async function pickupCargo({ characterId, targetFormDesc, requestId }) {
    const timestamp = now();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [requestReplays] = await conn.query(
        'SELECT * FROM public_work_runs WHERE pickup_request_id = ? FOR UPDATE', [requestId]
      );
      if (requestReplays.length) {
        if (Number(requestReplays[0].character_id) !== characterId) {
          return rollback(conn, { ok: false, code: 'idempotency_conflict' });
        }
        return rollback(conn, { ok: true, replay: true, run: rowToRun(requestReplays[0]) });
      }
      const run = await getActiveRun(characterId, conn, true);
      if (!run) return rollback(conn, { ok: false, code: 'no_active_run' });
      if (run.status === 'in_progress' && run.pickupRequestId === requestId) return rollback(conn, { ok: true, replay: true, run });
      if (timestamp >= run.expiresAt) {
        await expireLocked(conn, run, timestamp);
        await conn.commit();
        counters.expired += 1;
        return { ok: false, code: 'expired' };
      }
      if (run.status !== 'assigned') return rollback(conn, { ok: false, code: 'invalid_transition' });
      if (targetFormDesc !== run.originFormDesc) return rollback(conn, { ok: false, code: 'wrong_origin' });

      const token = cargoToken();
      const decision = stateMachine.pickup(run, { requestId, cargoToken: token, now: timestamp });
      if (!decision.ok) return rollback(conn, decision);
      await conn.query(
        `UPDATE public_work_runs
         SET status = 'in_progress', cargo_token = ?, pickup_request_id = ?
         WHERE id = ? AND status = 'assigned'`,
        [token, requestId, run.id]
      );
      await event(conn, run.id, characterId, 'assigned', 'in_progress', 'cargo_collected', `public-work:pickup:${requestId}`, timestamp);
      await conn.commit();
      counters.pickedUp += 1;
      return decision;
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  }

  async function completeWork({ characterId, targetFormDesc, requestId }) {
    const timestamp = now();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [replays] = await conn.query(
        'SELECT * FROM public_work_runs WHERE completion_request_id = ? FOR UPDATE', [requestId]
      );
      if (replays.length && replays[0].status === 'completed') {
        if (Number(replays[0].character_id) !== characterId) return rollback(conn, { ok: false, code: 'idempotency_conflict' });
        return rollback(conn, { ok: true, replay: true, run: rowToRun(replays[0]) });
      }
      const run = await getActiveRun(characterId, conn, true);
      if (!run) {
        const [lateReplays] = await conn.query(
          'SELECT * FROM public_work_runs WHERE completion_request_id = ? FOR UPDATE', [requestId]
        );
        if (lateReplays.length && Number(lateReplays[0].character_id) === characterId && lateReplays[0].status === 'completed') {
          return rollback(conn, { ok: true, replay: true, run: rowToRun(lateReplays[0]) });
        }
        return rollback(conn, { ok: false, code: lateReplays.length ? 'idempotency_conflict' : 'no_active_run' });
      }
      if (timestamp >= run.expiresAt) {
        await expireLocked(conn, run, timestamp);
        await conn.commit();
        counters.expired += 1;
        return { ok: false, code: 'expired' };
      }
      if (run.status !== 'in_progress') return rollback(conn, { ok: false, code: 'cargo_required' });
      if (targetFormDesc !== run.destinationFormDesc) return rollback(conn, { ok: false, code: 'wrong_destination' });

      const decision = stateMachine.complete(run, {
        requestId, cargoToken: run.cargoToken, now: timestamp
      });
      if (!decision.ok) return rollback(conn, decision);

      const ledgerKey = `public-work:run:${run.id}:reward`;
      await tx.tx.applyGoldDelta(conn, characterId, run.rewardAmount);
      await tx.tx.recordGoldLedger(conn, {
        characterId, delta: run.rewardAmount,
        reason: `public_work:${run.workCode}:run:${run.id}`,
        module: MODULE, idempotencyKey: ledgerKey,
        counterpartyType: 'system', counterpartyRef: 'public-work'
      });
      await conn.query(
        `UPDATE public_work_runs
         SET status = 'completed', cargo_token = NULL, completion_request_id = ?, completed_at = ?
         WHERE id = ? AND status = 'in_progress'`,
        [requestId, timestamp, run.id]
      );
      await conn.query('DELETE FROM public_work_active_slots WHERE character_id = ? AND run_id = ?', [characterId, run.id]);
      const availableAt = new Date(timestamp.getTime() + run.cooldownSeconds * 1000);
      await conn.query(
        `INSERT INTO public_work_cooldowns (character_id, cooldown_group, available_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE available_at = VALUES(available_at)`,
        [characterId, run.cooldownGroup, availableAt]
      );
      await event(conn, run.id, characterId, 'in_progress', 'completed', 'delivered', `public-work:complete:${requestId}`, timestamp);
      await conn.commit();
      counters.completed += 1;
      counters.payments += 1;
      return { ...decision, rewardAmount: run.rewardAmount, availableAt };
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  }

  async function cancelRun({ characterId }) {
    const timestamp = now();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const run = await getActiveRun(characterId, conn, true);
      if (!run) return rollback(conn, { ok: false, code: 'no_active_run' });
      if (TERMINAL.has(run.status)) return rollback(conn, { ok: false, code: 'terminal_run' });
      await conn.query(
        `UPDATE public_work_runs SET status = 'cancelled', cargo_token = NULL, cancelled_at = ? WHERE id = ?`,
        [timestamp, run.id]
      );
      await conn.query('DELETE FROM public_work_active_slots WHERE character_id = ? AND run_id = ?', [characterId, run.id]);
      await event(conn, run.id, characterId, run.status, 'cancelled', 'player_cancelled', null, timestamp);
      await conn.commit();
      counters.cancelled += 1;
      return { ok: true };
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  }

  async function expireRun(runId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT * FROM public_work_runs WHERE id = ? FOR UPDATE', [runId]);
      const run = rowToRun(rows[0]);
      if (!run || TERMINAL.has(run.status)) return rollback(conn, { ok: false, code: 'terminal_or_missing' });
      const timestamp = now();
      if (timestamp < run.expiresAt) return rollback(conn, { ok: false, code: 'not_expired' });
      await expireLocked(conn, run, timestamp, 'sweep');
      await conn.commit();
      counters.expired += 1;
      return { ok: true };
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  }

  async function sweepExpired(limit = 100) {
    const rows = await db.query(
      `SELECT id FROM public_work_runs
       WHERE status IN ('assigned', 'in_progress') AND expires_at <= ?
       ORDER BY expires_at LIMIT ?`,
      [now(), limit]
    );
    let expired = 0;
    for (const row of rows) {
      const result = await expireRun(Number(row.id));
      if (result.ok) expired += 1;
    }
    return expired;
  }

  function targetFormDesc(formId) {
    if (typeof mp === 'undefined' || typeof mp.getDescFromId !== 'function') return null;
    return mp.getDescFromId(formId) || null;
  }

  function message(code) {
    return ({
      active_run: 'Você já possui um trabalho público ativo.',
      cooldown: 'Você precisa aguardar antes de aceitar outro trabalho deste grupo.',
      no_active_run: 'Você não possui trabalho público ativo.',
      wrong_origin: 'Esta não é a origem atribuída à sua carga.',
      wrong_destination: 'Este não é o destino atribuído à sua carga.',
      cargo_required: 'Você precisa coletar a carga na origem primeiro.',
      expired: 'O prazo deste trabalho terminou.',
      unknown_work: 'Este trabalho não está disponível.',
      idempotency_conflict: 'Este identificador de ação pertence a outra operação.'
    })[code] || 'Não foi possível realizar esta ação agora.';
  }

  function registerInteractions() {
    const distance = options.get('publicWork.maxDistance');
    for (const definition of workRegistry.list()) {
      interactions.register({
        id: `public_work.accept_${definition.code}`, module: MODULE,
        target: interactions.TARGET_TYPES.OBJECT, section: 'Trabalhos públicos',
        label: definition.label, distance, idempotent: true,
        policyAction: 'public_work',
        audit: interactions.AUDIT_LEVELS.GAMEPLAY,
        canSee: async ctx => targetFormDesc(ctx.target.formId) === definition.boardFormDesc &&
          (await canAccept(ctx.characterId, definition)).ok,
        execute: async ctx => {
          if (targetFormDesc(ctx.target.formId) !== definition.boardFormDesc) return { message: message('unknown_work') };
          const result = await acceptWork({ characterId: ctx.characterId, workCode: definition.code, requestId: ctx.requestId });
          return { message: result.ok
            ? `Trabalho aceito. Vá até ${definition.originLabel}.`
            : message(result.code), data: result.ok ? { runId: result.run.id } : undefined };
        }
      });
    }

    interactions.register({
      id: 'public_work.pickup', module: MODULE, target: interactions.TARGET_TYPES.OBJECT,
      section: 'Trabalhos públicos', label: 'Coletar carga', distance, idempotent: true,
      policyAction: 'public_work',
      audit: interactions.AUDIT_LEVELS.GAMEPLAY,
      canSee: async ctx => {
        const run = await getActiveRun(ctx.characterId);
        return Boolean(run && run.status === 'assigned' && targetFormDesc(ctx.target.formId) === run.originFormDesc);
      },
      execute: async ctx => {
        const result = await pickupCargo({ characterId: ctx.characterId, targetFormDesc: targetFormDesc(ctx.target.formId), requestId: ctx.requestId });
        return { message: result.ok ? `Carga coletada. Entregue em ${result.run.destinationLabel}.` : message(result.code) };
      }
    });

    interactions.register({
      id: 'public_work.deliver', module: MODULE, target: interactions.TARGET_TYPES.OBJECT,
      section: 'Trabalhos públicos', label: 'Entregar carga', distance, idempotent: true,
      policyAction: 'public_work',
      audit: interactions.AUDIT_LEVELS.ECONOMY,
      canSee: async ctx => {
        const run = await getActiveRun(ctx.characterId);
        return Boolean(run && run.status === 'in_progress' && targetFormDesc(ctx.target.formId) === run.destinationFormDesc);
      },
      execute: async ctx => {
        const result = await completeWork({ characterId: ctx.characterId, targetFormDesc: targetFormDesc(ctx.target.formId), requestId: ctx.requestId });
        return { message: result.ok ? `Entrega concluída. Você recebeu ${result.rewardAmount || result.run.rewardAmount} septims.` : message(result.code) };
      }
    });

    interactions.register({
      id: 'public_work.cancel', module: MODULE, target: interactions.TARGET_TYPES.OBJECT,
      section: 'Trabalhos públicos', label: 'Cancelar trabalho atual', distance,
      policyAction: 'public_work',
      audit: interactions.AUDIT_LEVELS.GAMEPLAY,
      canSee: async ctx => {
        const formDesc = targetFormDesc(ctx.target.formId);
        const isBoard = workRegistry.list().some(definition => definition.boardFormDesc === formDesc);
        return isBoard && Boolean(await getActiveRun(ctx.characterId));
      },
      execute: async ctx => {
        const formDesc = targetFormDesc(ctx.target.formId);
        if (!workRegistry.list().some(definition => definition.boardFormDesc === formDesc)) {
          return { message: 'Aproxime-se de um quadro de trabalhos públicos.' };
        }
        const result = await cancelRun({ characterId: ctx.characterId });
        return { message: result.ok ? 'Trabalho público cancelado. A carga foi invalidada.' : message(result.code) };
      }
    });
  }

  async function registerPhysicalAnchors() {
    if (typeof mp === 'undefined' || typeof mp.getIdFromDesc !== 'function') {
      throw new Error('[public-work] mp.getIdFromDesc indisponivel');
    }
    const unique = new Set();
    for (const definition of workRegistry.list()) {
      unique.add(definition.boardFormDesc);
      unique.add(definition.originFormDesc);
      unique.add(definition.destinationFormDesc);
    }
    const resolved = [...unique].map(formDesc => ({ formDesc, targetId: mp.getIdFromDesc(formDesc) }));
    const invalid = resolved.filter(item => !Number.isSafeInteger(item.targetId) || item.targetId <= 0);
    if (invalid.length) throw new Error(`[public-work] FormDesc nao resolvido: ${invalid.map(x => x.formDesc).join(', ')}`);
    anchors.register({
      targetType: interactions.TARGET_TYPES.OBJECT,
      list: async () => resolved.map(({ targetId }) => ({ targetId }))
    });
    await anchors.refresh();
    return resolved.length;
  }

  async function initialize() {
    const loaded = configLoader.load({ registry: workRegistry });
    registerInteractions();
    const anchorCount = await registerPhysicalAnchors();
    const intervalMs = options.get('publicWork.sweepIntervalSeconds') * 1000;
    sweepTimer = setInterval(() => sweepExpired().catch(err => console.error('[public-work] sweep falhou:', err.message)), intervalMs);
    if (sweepTimer.unref) sweepTimer.unref();
    console.log(`[public-work] ${loaded.count} trabalho(s), ${anchorCount} anchor(s), fluxo por E ativo em LAB.`);
  }

  function shutdown() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
    interactions.unregisterModule(MODULE);
  }

  function metrics() { return { ...counters, activeDefinitions: workRegistry.list().length }; }
  function healthCheck() { return workRegistry.list().length > 0 && sweepTimer !== null; }

  return {
    rowToRun, getActiveRun, canAccept, acceptWork, pickupCargo, completeWork,
    cancelRun, expireRun, sweepExpired, registerInteractions,
    registerPhysicalAnchors, initialize, shutdown, targetFormDesc, metrics, healthCheck
  };
}

const service = createPublicWorkService();
module.exports = { MODULE, createPublicWorkService, ...service };

/**
 * Monitora o ciclo de conexao que a API atual do SkyMP expoe somente por
 * polling. A verificacao de whitelist e assincrona, portanto cada conexao tem
 * uma sessao propria: uma resposta antiga jamais pode limpar uma reconexao no
 * mesmo userId.
 */

const DEFAULT_MAX_USER_ID = 10;
const DEFAULT_MAX_PROFILE_ID = 50;
const DEFAULT_INTERVAL_MS = 2000;

/**
 * @param {number} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveIntegerOr(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * @param {{
 *   mp: {isConnected: Function, getUserActor: Function, getActorsByProfileId: Function, kick: Function},
 *   whitelist: {checkWhitelist: Function},
 *   commands: {removeActiveCharacter: Function},
 *   playerPanel: {cleanup: Function},
 *   logger?: Pick<Console, 'log'|'warn'|'error'>,
 *   maxUserId?: number,
 *   maxProfileId?: number,
 *   intervalMs?: number
 *   now?: () => number
 * }} dependencies
 */
function createConnectionMonitor({
  mp,
  whitelist,
  commands,
  playerPanel,
  logger = console,
  maxUserId = DEFAULT_MAX_USER_ID,
  maxProfileId = DEFAULT_MAX_PROFILE_ID,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now
}) {
  if (!mp || typeof mp.isConnected !== 'function' || typeof mp.getUserActor !== 'function' ||
    typeof mp.getActorsByProfileId !== 'function' || typeof mp.kick !== 'function') {
    throw new Error('[connection-monitor] mp invalido');
  }
  if (!whitelist || typeof whitelist.checkWhitelist !== 'function') {
    throw new Error('[connection-monitor] whitelist invalida');
  }
  if (!commands || typeof commands.removeActiveCharacter !== 'function') {
    throw new Error('[connection-monitor] commands invalido');
  }
  if (!playerPanel || typeof playerPanel.cleanup !== 'function') {
    throw new Error('[connection-monitor] playerPanel invalido');
  }

  const userLimit = positiveIntegerOr(maxUserId, DEFAULT_MAX_USER_ID);
  const profileLimit = positiveIntegerOr(maxProfileId, DEFAULT_MAX_PROFILE_ID);
  const pollingInterval = positiveIntegerOr(intervalMs, DEFAULT_INTERVAL_MS);
  /** @type {Map<number, {id: number, actorId: number|null, verificationPending: boolean, approved: boolean, rejected: boolean, cleaned: boolean, missingProfileReported: boolean}>} */
  const sessions = new Map();
  let nextSessionId = 1;
  let timer = null;
  const metrics = { connections: 0, disconnections: 0, approved: 0, rejected: 0, ticks: 0, maxTickMs: 0 };

  function findProfileId(actorId) {
    for (let profileId = 1; profileId <= profileLimit; profileId++) {
      const actors = mp.getActorsByProfileId(profileId);
      if (actors && actors.includes(actorId)) return profileId;
    }
    return null;
  }

  function isCurrent(userId, session) {
    return sessions.get(userId) === session;
  }

  function cleanup(userId, session, reason) {
    if (session.cleaned) return;
    session.cleaned = true;
    if (!session.actorId) return;

    try {
      commands.removeActiveCharacter(session.actorId);
      playerPanel.cleanup(session.actorId);
    } catch (err) {
      logger.error(`[phase0] Error cleaning up ${reason} user ${userId}:`, err.message);
    }
  }

  function reject(userId, session, reason, kick) {
    if (!isCurrent(userId, session) || session.rejected) return;
    session.rejected = true;
    metrics.rejected++;
    if (kick) {
      try {
        mp.kick(userId);
      } catch (err) {
        logger.error(`[phase0] Failed to kick user ${userId}:`, err.message);
      }
    }
    cleanup(userId, session, reason);
  }

  function verify(userId, session, profileId) {
    session.verificationPending = true;
    Promise.resolve(whitelist.checkWhitelist(userId, profileId, session.actorId))
      .then(allowed => {
        if (!isCurrent(userId, session)) return;
        session.verificationPending = false;
        if (allowed) {
          session.approved = true;
          metrics.approved++;
          logger.log(`[phase0] User ${userId} successfully approved by database check.`);
          return;
        }
        logger.log(`[phase0] User ${userId} was rejected by database check.`);
        // checkWhitelist ja solicita o kick nas recusas conhecidas. Aqui so
        // garantimos a limpeza local sem disparar uma segunda acao de rede.
        reject(userId, session, 'rejected', false);
      })
      .catch(err => {
        if (!isCurrent(userId, session)) return;
        session.verificationPending = false;
        logger.error(`[phase0] Error in async checkWhitelist for user ${userId}:`, err.message);
        reject(userId, session, 'failed whitelist', true);
      });
  }

  function processConnectedUser(userId, session) {
    if (session.rejected || session.approved || session.verificationPending) return;

    try {
      const actorId = mp.getUserActor(userId);
      if (!actorId) {
        // A engine pode anunciar a conexao antes de publicar o ator. Nao marcar
        // como concluido permite a proxima passada verificar o mesmo jogador.
        return;
      }
      session.actorId = actorId;
      const profileId = findProfileId(actorId);
      if (profileId === null) {
        if (!session.missingProfileReported) {
          session.missingProfileReported = true;
          logger.warn(`[phase0] User ${userId} actor ${actorId.toString(16)} has no associated profileId yet.`);
        }
        return;
      }

      session.missingProfileReported = false;
      logger.log(`[phase0] User ${userId} mapped to profileId: ${profileId}`);
      verify(userId, session, profileId);
    } catch (err) {
      logger.error(`[phase0] Error processing connection for user ${userId}:`, err.message);
      reject(userId, session, 'connection processing', true);
    }
  }

  function tick() {
    const startedAt = now();
    try {
      for (let userId = 1; userId <= userLimit; userId++) {
        const connected = mp.isConnected(userId);
        const session = sessions.get(userId);

        if (connected) {
          if (session) {
            processConnectedUser(userId, session);
            continue;
          }

          const newSession = {
            id: nextSessionId++, actorId: null, verificationPending: false,
            approved: false, rejected: false, cleaned: false, missingProfileReported: false
          };
          sessions.set(userId, newSession);
          metrics.connections++;
          logger.log(`[phase0] Connection detected! User ID: ${userId}, session: ${newSession.id}`);
          processConnectedUser(userId, newSession);
          continue;
        }

        if (session) {
          // Remover antes da limpeza invalida qualquer promise de whitelist ainda
          // em voo. Se o userId for reutilizado, ela nao alcanca a nova sessao.
          sessions.delete(userId);
          metrics.disconnections++;
          logger.log(`[phase0] Disconnection detected! User ID: ${userId}`);
          cleanup(userId, session, 'disconnected');
        }
      }
    } finally {
      metrics.ticks++;
      metrics.maxTickMs = Math.max(metrics.maxTickMs, Math.max(0, now() - startedAt));
    }
  }

  function snapshot() {
    const states = { pending: 0, approved: 0, rejected: 0 };
    for (const session of sessions.values()) {
      if (session.rejected) states.rejected++;
      else if (session.approved) states.approved++;
      else states.pending++;
    }
    return {
      active: sessions.size,
      states,
      totals: { ...metrics },
      pollingIntervalMs: pollingInterval
    };
  }

  function start() {
    if (timer) return timer;
    timer = setInterval(tick, pollingInterval);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { tick, start, stop, snapshot, sessions };
}

module.exports = {
  createConnectionMonitor,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_PROFILE_ID,
  DEFAULT_MAX_USER_ID
};

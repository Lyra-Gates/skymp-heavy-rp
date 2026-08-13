/**
 * contracts-service.js
 *
 * Contratos entre jogadores: alguém publica trabalho, alguém aceita, o servidor
 * move os septims e mantém o registro. Sem arbitragem automática, sem fila de
 * staff, sem NPC.
 *
 * ⚠️ PARKED: não é registrado no `core/module-registry.js` e não roda em
 * produção. Ele existe, é transacional e é testado — mas nada aqui foi visto
 * num servidor com gente dentro. Reativar é outra decisão, e depende da Fase 0
 * (`docs/technical/FASE_0_ROTEIRO.md`). Ver `PARKED_SERVICES_DECISION.md`.
 *
 * Desenho: `docs/gameplay/CONTRACTS.md`
 * Decisão de economia: `docs/technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md`
 * Origem do conceito: Mereth Roleplay — **sem licença e sem código público**,
 * então isto é reimplementação a partir da ideia publicada, não port
 * (`docs/research/SKYMP_ECOSYSTEM_DEEP_DIVE.md` §4).
 *
 * ─── A máquina ─────────────────────────────────────────────────────────────
 *
 *              ┌──────────► cancelled   (criador desiste; escrow devolvido)
 *              │
 *   open ──────┼──────────► expired     (prazo venceu; escrow devolvido)
 *     │        │
 *     ▼        │
 *   accepted ──┘──────────► expired     (prazo venceu; escrow devolvido)
 *     │
 *     ▼
 *   delivered ────────────► settled     (escrow → trabalhador)
 *     │
 *     └────────────────────► disputed   (escrow FICA travado; ninguém recebe)
 *
 * ─── As três regras que não se negociam ────────────────────────────────────
 *
 * 1. **Escrow trava no post.** `open` só existe com o valor já fora do bolso do
 *    criador. Uma falha na criação produz SEM CONTRATO, nunca um contrato que
 *    ninguém pode pagar.
 * 2. **Expiração nunca toca trabalho entregue.** `delivered` e `disputed` estão
 *    fora da varredura. Sem isso, deixar expirar depois de receber é o exploit.
 * 3. **`disputed` não decide nada.** O escrow fica travado e a staff resolve
 *    fora do automático. Consequência irreversível não se automatiza
 *    (briefing §11).
 */

const crypto = require('crypto');
const database = require('./database');
const economyService = require('./core/economy-service');

const MODULE = 'contracts';

/**
 * Categorias do briefing §9. A lista é aberta por edição, não por payload: um
 * `category` vindo da UI que não esteja aqui é recusado, porque ela vira
 * filtro de listagem e rótulo de RP, e um valor livre transforma a listagem em
 * lixo.
 *
 * Acrescentar uma categoria é **só** editar esta lista — o framework não
 * verifica o trabalho de nenhuma delas. Verificação por contagem de item existe
 * para entrega de item (`core/inventory.js`); "matou o bandido" e "escoltou a
 * caravana" são confirmação humana do criador, e fingir o contrário seria
 * prometer uma onisciência que o servidor não tem.
 */
const CATEGORIES = Object.freeze([
  'mercenary', 'caravan', 'delivery', 'bodyguard', 'crafting',
  'mining', 'harvest', 'hunt', 'arcane', 'investigation', 'generic'
]);

const STATUS = Object.freeze({
  OPEN: 'open',
  ACCEPTED: 'accepted',
  DELIVERED: 'delivered',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  DISPUTED: 'disputed'
});

/** Estados que a varredura de expiração pode tocar. Ver regra 2 do cabeçalho. */
const EXPIRABLE = Object.freeze([STATUS.OPEN, STATUS.ACCEPTED]);

/** Janela padrão entre `delivered` e o acerto automático. */
const REVIEW_WINDOW_MS = 48 * 60 * 60 * 1000;

const MIN_REWARD = 1;

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function positiveId(value) {
  const id = typeof value === 'string' ? Number(value) : value;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function normalizeKey(value) {
  return economyService.normalizeIdempotencyKey(value);
}

async function _safeRollback(conn) {
  try { await conn.rollback(); } catch { /* preserva o erro original */ }
}

async function _withTransaction(dependencies, fn) {
  const db = dependencies.db || database;
  const conn = await db.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    committed = true;
    return result;
  } catch (err) {
    if (!committed) await _safeRollback(conn);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Lê e trava o contrato. Tudo que muda estado passa por aqui primeiro — é a
 * trava que faz "aceitar" e "cancelar" simultâneos serializarem em vez de
 * ambos lerem `open`.
 */
async function _lockContract(conn, contractId) {
  const [rows] = await conn.query(
    `SELECT id, creator_character_id, accepted_by_character_id, reward, escrow_id,
            status, review_until, expires_at
       FROM contracts WHERE id = ? FOR UPDATE`,
    [contractId]
  );
  return rows[0] || null;
}

/**
 * Grava a transição. `idempotency_key` é UNIQUE, então o mesmo pedido reenviado
 * não gera dois eventos — e a consulta abaixo faz o replay devolver o resultado
 * original em vez de `invalid_status` (o Achado 7 da auditoria de economia).
 */
async function _recordEvent(conn, params) {
  await conn.query(
    `INSERT INTO contract_events
      (contract_id, from_status, to_status, actor_character_id, reason, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.contractId, params.from, params.to, params.actorCharacterId || null,
      params.reason || null, params.idempotencyKey || null]
  );
}

async function _findEventReplay(conn, idempotencyKey) {
  const [rows] = await conn.query(
    'SELECT contract_id, from_status, to_status FROM contract_events WHERE idempotency_key = ? FOR UPDATE',
    [idempotencyKey]
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Criação
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Publica um contrato. O escrow é financiado **antes** da linha em `contracts`
 * existir, na mesma transação: se o criador não tem o ouro, não sobra contrato.
 *
 * @param {object} request
 * @param {number} request.creatorCharacterId
 * @param {string} request.title
 * @param {string} [request.description]
 * @param {string} [request.category]
 * @param {number} request.reward septims travados no escrow
 * @param {number} [request.expiresInMs]
 * @param {string} [request.idempotencyKey]
 */
async function create(request, dependencies = {}) {
  const economy = dependencies.economy || economyService;
  const creatorCharacterId = positiveId(request?.creatorCharacterId);
  const title = normalizeText(request?.title, 96);
  const reward = economy.normalizeAmount(request?.reward);
  const idempotencyKey = normalizeKey(request?.idempotencyKey);
  const category = request?.category === undefined ? 'generic' : request.category;
  const description = request?.description === undefined || request.description === null
    ? null
    : normalizeText(request.description, 2000);

  if (!creatorCharacterId) return { ok: false, code: 'invalid_creator' };
  if (!title) return { ok: false, code: 'invalid_title' };
  if (!reward || reward < MIN_REWARD) return { ok: false, code: 'invalid_reward' };
  if (!CATEGORIES.includes(category)) return { ok: false, code: 'invalid_category' };
  if (request?.description !== undefined && request?.description !== null && !description) {
    return { ok: false, code: 'invalid_description' };
  }
  if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };

  const expiresInMs = request?.expiresInMs;
  if (expiresInMs !== undefined && (!Number.isSafeInteger(expiresInMs) || expiresInMs <= 0)) {
    return { ok: false, code: 'invalid_expiry' };
  }
  const now = dependencies.now ? dependencies.now() : Date.now();
  const expiresAt = expiresInMs ? new Date(now + expiresInMs) : null;

  return _withTransaction(dependencies, async conn => {
    // O evento de criação é gravado por último, então encontrá-lo prova que a
    // criação inteira commitou. É o mesmo marcador de replay que todas as
    // outras transições usam — um segundo mecanismo só para `create` seria
    // mais uma coisa capaz de discordar das demais.
    const prior = await _findEventReplay(conn, `${idempotencyKey}~open`);
    if (prior) {
      return { ok: true, replayed: true, contractId: prior.contract_id };
    }

    const escrow = await economy.openEscrowInTransaction(conn, {
      funder: { type: 'character', ref: creatorCharacterId },
      amount: reward,
      purpose: 'contract',
      reason: 'contract_escrow',
      module: MODULE,
      actorCharacterId: creatorCharacterId,
      idempotencyKey: `${idempotencyKey}~escrow`
    }, dependencies);

    // Fail-closed: o valor não travou, então não nasce contrato nenhum. É a
    // diferença entre "sem contrato" e "contrato que ninguém pode pagar".
    if (!escrow.ok) return escrow;

    const [insert] = await conn.query(
      `INSERT INTO contracts
        (creator_character_id, title, description, category, reward, escrow_id, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [creatorCharacterId, title, description, category, reward, escrow.escrowId, STATUS.OPEN, expiresAt]
    );
    const contractId = insert.insertId;

    await _recordEvent(conn, {
      contractId, from: null, to: STATUS.OPEN,
      actorCharacterId: creatorCharacterId,
      reason: 'created', idempotencyKey: `${idempotencyKey}~open`
    });

    return { ok: true, replayed: false, contractId, escrowId: escrow.escrowId, reward, expiresAt };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Transições que não mexem em dinheiro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fábrica das transições simples. Todas têm a mesma forma: trava o contrato,
 * checa replay, checa estado e autor, grava evento e atualiza a linha.
 *
 * Centralizar isso não é economia de digitação — é o que garante que nenhuma
 * transição esqueça o `FOR UPDATE` ou a checagem de replay, que são as duas
 * coisas cuja ausência não aparece em teste sequencial.
 */
function makeTransition(config) {
  return async function transition(request, dependencies = {}) {
    const contractId = positiveId(request?.contractId);
    const actorCharacterId = positiveId(request?.actorCharacterId);
    const idempotencyKey = normalizeKey(request?.idempotencyKey);

    if (!contractId) return { ok: false, code: 'invalid_contract' };
    if (!actorCharacterId) return { ok: false, code: 'invalid_actor' };
    if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };

    return _withTransaction(dependencies, async conn => {
      const contract = await _lockContract(conn, contractId);
      if (!contract) return { ok: false, code: 'contract_not_found' };

      const prior = await _findEventReplay(conn, idempotencyKey);
      if (prior) {
        return { ok: true, replayed: true, contractId, status: prior.to_status };
      }

      if (contract.status !== config.from) {
        return { ok: false, code: 'invalid_status', status: contract.status };
      }
      const denial = config.authorize(contract, actorCharacterId);
      if (denial) return { ok: false, code: denial };

      const now = dependencies.now ? dependencies.now() : Date.now();
      const patch = config.patch(contract, actorCharacterId, now);
      const columns = Object.keys(patch);
      const setClause = ['status = ?', ...columns.map(c => `${c} = ?`)].join(', ');
      // O `AND status = ?` é redundante com a checagem acima **sob a trava** — e
      // é de propósito: se alguém remover o `FOR UPDATE` de `_lockContract`, a
      // atualização passa a afetar 0 linhas em vez de sobrescrever a transição
      // de outra transação.
      await conn.query(
        `UPDATE contracts SET ${setClause} WHERE id = ? AND status = ?`,
        [config.to, ...columns.map(c => patch[c]), contractId, config.from]
      );

      await _recordEvent(conn, {
        contractId, from: config.from, to: config.to,
        actorCharacterId, reason: config.reason, idempotencyKey
      });

      return { ok: true, replayed: false, contractId, status: config.to };
    });
  };
}

/**
 * Aceitar. O criador não pode aceitar o próprio contrato — sem essa regra, o
 * contrato vira uma forma de mover ouro para si mesmo com um carimbo de
 * legitimidade, que é exatamente o que um sistema de lavagem procura.
 */
const accept = makeTransition({
  from: STATUS.OPEN,
  to: STATUS.ACCEPTED,
  reason: 'accepted',
  authorize: (contract, actor) => (contract.creator_character_id === actor ? 'creator_cannot_accept' : null),
  patch: (_contract, actor, now) => ({ accepted_by_character_id: actor, accepted_at: new Date(now) })
});

/**
 * Declarar entrega. Só quem aceitou. Abre a janela de revisão — passada ela sem
 * disputa, o acerto é automático.
 */
const deliver = makeTransition({
  from: STATUS.ACCEPTED,
  to: STATUS.DELIVERED,
  reason: 'delivered',
  authorize: (contract, actor) => (contract.accepted_by_character_id !== actor ? 'not_the_worker' : null),
  patch: (_contract, _actor, now) => ({
    delivered_at: new Date(now),
    review_until: new Date(now + REVIEW_WINDOW_MS)
  })
});

/**
 * Contestar a entrega. **Não decide nada**: o escrow continua travado e nenhum
 * dos dois recebe até alguém de fora resolver. É a única saída de `delivered`
 * que não move dinheiro, e é assim de propósito — automatizar "quem tem razão"
 * é a consequência irreversível que o briefing §11 proíbe.
 */
const dispute = makeTransition({
  from: STATUS.DELIVERED,
  to: STATUS.DISPUTED,
  reason: 'disputed',
  authorize: (contract, actor) => (contract.creator_character_id !== actor ? 'not_the_creator' : null),
  // Nada além do status muda: `closed_at` fica nulo porque o contrato **não**
  // fechou — o escrow continua travado esperando decisão humana.
  patch: () => ({})
});

// ─────────────────────────────────────────────────────────────────────────────
// Transições que movem dinheiro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fecha o contrato liberando o escrow. É o corpo comum de `settle`, `cancel` e
 * `expire` — os três são "muda o status e esvazia o escrow para alguém", e a
 * única diferença é quem recebe e a partir de qual estado.
 */
async function _closeWithEscrow(conn, params, dependencies) {
  const economy = dependencies.economy || economyService;
  const contract = params.contract;

  const released = await economy.closeEscrowInTransaction(conn, {
    escrowId: contract.escrow_id,
    beneficiary: { type: 'character', ref: params.beneficiaryCharacterId },
    reason: params.reason,
    module: MODULE,
    actorCharacterId: params.actorCharacterId,
    idempotencyKey: `${params.idempotencyKey}~escrow`
  }, dependencies);

  if (!released.ok) return released;

  const now = params.now;
  await conn.query(
    'UPDATE contracts SET status = ?, closed_at = ? WHERE id = ? AND status = ?',
    [params.to, new Date(now), contract.id, contract.status]
  );
  await _recordEvent(conn, {
    contractId: contract.id, from: contract.status, to: params.to,
    actorCharacterId: params.actorCharacterId,
    reason: params.reason, idempotencyKey: params.idempotencyKey
  });

  return {
    ok: true, replayed: false, contractId: contract.id, status: params.to,
    amount: released.amount, transferId: released.transferId
  };
}

/**
 * Acerto: o escrow vai para quem trabalhou.
 *
 * Quem pode pedir: o criador (a qualquer momento depois de `delivered`) ou o
 * servidor, pela varredura, depois da janela de revisão. O trabalhador **não**
 * pode se pagar — seria declarar entrega e sacar na mesma respiração.
 */
async function settle(request, dependencies = {}) {
  const contractId = positiveId(request?.contractId);
  const idempotencyKey = normalizeKey(request?.idempotencyKey);
  const bySweep = request?.bySweep === true;
  const actorCharacterId = bySweep ? null : positiveId(request?.actorCharacterId);

  if (!contractId) return { ok: false, code: 'invalid_contract' };
  if (!bySweep && !actorCharacterId) return { ok: false, code: 'invalid_actor' };
  if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };

  return _withTransaction(dependencies, async conn => {
    const contract = await _lockContract(conn, contractId);
    if (!contract) return { ok: false, code: 'contract_not_found' };

    const prior = await _findEventReplay(conn, idempotencyKey);
    if (prior) return { ok: true, replayed: true, contractId, status: prior.to_status };

    if (contract.status !== STATUS.DELIVERED) {
      return { ok: false, code: 'invalid_status', status: contract.status };
    }
    if (!bySweep && contract.creator_character_id !== actorCharacterId) {
      return { ok: false, code: 'not_the_creator' };
    }

    const now = dependencies.now ? dependencies.now() : Date.now();
    if (bySweep && contract.review_until && now < new Date(contract.review_until).getTime()) {
      return { ok: false, code: 'review_window_open' };
    }

    return _closeWithEscrow(conn, {
      contract, to: STATUS.SETTLED,
      beneficiaryCharacterId: contract.accepted_by_character_id,
      actorCharacterId, idempotencyKey, now,
      reason: 'contract_settlement'
    }, dependencies);
  });
}

/**
 * Cancelar. Só enquanto `open` — depois que alguém aceitou, cancelar
 * unilateralmente deixaria o trabalhador com trabalho feito e sem recurso. Um
 * contrato aceito que dá errado sai por `expired` (o prazo) ou por acordo fora
 * do sistema.
 */
async function cancel(request, dependencies = {}) {
  const contractId = positiveId(request?.contractId);
  const actorCharacterId = positiveId(request?.actorCharacterId);
  const idempotencyKey = normalizeKey(request?.idempotencyKey);

  if (!contractId) return { ok: false, code: 'invalid_contract' };
  if (!actorCharacterId) return { ok: false, code: 'invalid_actor' };
  if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };

  return _withTransaction(dependencies, async conn => {
    const contract = await _lockContract(conn, contractId);
    if (!contract) return { ok: false, code: 'contract_not_found' };

    const prior = await _findEventReplay(conn, idempotencyKey);
    if (prior) return { ok: true, replayed: true, contractId, status: prior.to_status };

    if (contract.status !== STATUS.OPEN) {
      return { ok: false, code: 'invalid_status', status: contract.status };
    }
    if (contract.creator_character_id !== actorCharacterId) {
      return { ok: false, code: 'not_the_creator' };
    }

    return _closeWithEscrow(conn, {
      contract, to: STATUS.CANCELLED,
      beneficiaryCharacterId: contract.creator_character_id,
      actorCharacterId, idempotencyKey,
      now: dependencies.now ? dependencies.now() : Date.now(),
      reason: 'contract_cancelled'
    }, dependencies);
  });
}

/**
 * Expira um contrato e devolve o escrow ao criador.
 *
 * ─── A regra que protege o trabalhador ─────────────────────────────────────
 *
 * `EXPIRABLE` não inclui `delivered` nem `disputed`. Sem isso, o criador que
 * recebeu o trabalho só precisa esperar o relógio para reaver o ouro — é o
 * exploit óbvio, e a defesa contra ele é uma lista, não um comentário.
 */
async function expire(request, dependencies = {}) {
  const contractId = positiveId(request?.contractId);
  const idempotencyKey = normalizeKey(request?.idempotencyKey);

  if (!contractId) return { ok: false, code: 'invalid_contract' };
  if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };

  return _withTransaction(dependencies, async conn => {
    const contract = await _lockContract(conn, contractId);
    if (!contract) return { ok: false, code: 'contract_not_found' };

    const prior = await _findEventReplay(conn, idempotencyKey);
    if (prior) return { ok: true, replayed: true, contractId, status: prior.to_status };

    if (!EXPIRABLE.includes(contract.status)) {
      return { ok: false, code: 'not_expirable', status: contract.status };
    }
    const now = dependencies.now ? dependencies.now() : Date.now();
    if (!contract.expires_at || now < new Date(contract.expires_at).getTime()) {
      return { ok: false, code: 'not_yet_expired' };
    }

    return _closeWithEscrow(conn, {
      contract, to: STATUS.EXPIRED,
      beneficiaryCharacterId: contract.creator_character_id,
      actorCharacterId: null, idempotencyKey, now,
      reason: 'contract_expired'
    }, dependencies);
  });
}

/**
 * Varredura. Uma transação por contrato de propósito: uma transação para todos
 * transformaria uma linha problemática em nenhuma expiração processada.
 */
async function sweepExpired(dependencies = {}) {
  const db = dependencies.db || database;
  const now = dependencies.now ? dependencies.now() : Date.now();
  const rows = await db.query(
    `SELECT id FROM contracts
      WHERE status IN (?, ?) AND expires_at IS NOT NULL AND expires_at <= ?
      ORDER BY expires_at LIMIT 100`,
    [STATUS.OPEN, STATUS.ACCEPTED, new Date(now)]
  );

  const processed = [];
  for (const row of rows) {
    // A chave deriva do contrato, então reexecutar a varredura no mesmo minuto
    // não expira duas vezes nem devolve o escrow duas vezes.
    const result = await expire({
      contractId: row.id,
      idempotencyKey: `sweep-expire-${row.id}`
    }, dependencies);
    processed.push({ contractId: row.id, ok: result.ok, code: result.code });
  }
  return { ok: true, processed };
}

/**
 * Acerto automático dos entregues cuja janela de revisão venceu sem disputa.
 * É o outro lado da varredura: sem ele, um criador que some deixa o trabalhador
 * com o ouro travado para sempre.
 */
async function sweepReviewed(dependencies = {}) {
  const db = dependencies.db || database;
  const now = dependencies.now ? dependencies.now() : Date.now();
  const rows = await db.query(
    `SELECT id FROM contracts
      WHERE status = ? AND review_until IS NOT NULL AND review_until <= ?
      ORDER BY review_until LIMIT 100`,
    [STATUS.DELIVERED, new Date(now)]
  );

  const processed = [];
  for (const row of rows) {
    const result = await settle({
      contractId: row.id,
      bySweep: true,
      idempotencyKey: `sweep-settle-${row.id}`
    }, dependencies);
    processed.push({ contractId: row.id, ok: result.ok, code: result.code });
  }
  return { ok: true, processed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura
// ─────────────────────────────────────────────────────────────────────────────

async function listOpen(dependencies = {}) {
  const db = dependencies.db || database;
  return db.query(
    `SELECT id, creator_character_id, title, category, reward, expires_at, created_at
       FROM contracts WHERE status = ? ORDER BY created_at DESC LIMIT 50`,
    [STATUS.OPEN]
  );
}

async function getContract(contractId, dependencies = {}) {
  const db = dependencies.db || database;
  const id = positiveId(contractId);
  if (!id) return null;
  const rows = await db.query('SELECT * FROM contracts WHERE id = ?', [id]);
  return rows[0] || null;
}

async function history(contractId, dependencies = {}) {
  const db = dependencies.db || database;
  const id = positiveId(contractId);
  if (!id) return [];
  return db.query(
    'SELECT from_status, to_status, actor_character_id, reason, created_at FROM contract_events WHERE contract_id = ? ORDER BY id',
    [id]
  );
}

module.exports = {
  create, accept, deliver, dispute, settle, cancel, expire,
  sweepExpired, sweepReviewed,
  listOpen, getContract, history,
  STATUS, CATEGORIES, EXPIRABLE, REVIEW_WINDOW_MS
};

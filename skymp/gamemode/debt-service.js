/**
 * debt-service.js
 *
 * Dívida como **registro selado e legível**, nunca como cobrança automática.
 *
 * ⚠️ PARKED: não é registrado no `core/module-registry.js` e não roda em
 * produção. Ver `PARKED_SERVICES_DECISION.md` e a Fase 0.
 *
 * Desenho: `docs/gameplay/DEBT_SYSTEM.md`
 * Decisão: `docs/technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md` §2.8 e §4.4
 * Conceito: Mereth Roleplay — sem licença e sem código público; reimplementado
 * a partir da ideia (`docs/research/SKYMP_ECOSYSTEM_DEEP_DIVE.md` §4).
 *
 * ─── O que este serviço NÃO faz, e por quê ──────────────────────────────────
 *
 * Ele **não** debita ninguém sozinho. Não vigia saldo, não confisca ouro que
 * entra, não bloqueia ação, não emite mandado, não aplica juros.
 *
 * A alternativa — abater a dívida no instante em que o devedor recebe ouro —
 * foi considerada e rejeitada no ADR 004 §4.4. Ela remove a cena: ninguém
 * precisa cobrar, então ninguém cobra, e o servidor vira o agiota no lugar do
 * outro jogador. Inadimplência precisa ser **material de RP** para guildas,
 * tribunais e crime (briefing §11), não trabalho de moderação.
 *
 * O que o serviço garante é o oposto: que a dívida exista de forma que qualquer
 * um possa ler, que o pagamento mova septims de verdade pelo `economy-service`,
 * e que `remaining` só caia porque houve pagamento ou perdão registrado.
 *
 * ─── Estados ────────────────────────────────────────────────────────────────
 *
 *   active ──► paid       (remaining chegou a zero por pagamento)
 *          ──► forgiven   (o credor abriu mão do saldo restante)
 *          ──► defaulted  (declarado inadimplente — é um RÓTULO, não um confisco)
 *
 * `defaulted` não move dinheiro e não é terminal para o pagamento: uma dívida
 * marcada como inadimplente ainda pode ser quitada, e voltar para `active` é
 * consequência de pagar, não uma transição separada.
 */

const database = require('./database');
const economyService = require('./core/economy-service');

const MODULE = 'debt';

const STATUS = Object.freeze({
  ACTIVE: 'active',
  PAID: 'paid',
  DEFAULTED: 'defaulted',
  FORGIVEN: 'forgiven'
});

/** Estados em que ainda se pode pagar. `paid` e `forgiven` estão fechados. */
const PAYABLE = Object.freeze([STATUS.ACTIVE, STATUS.DEFAULTED]);

const ORIGINS = Object.freeze(['fine', 'contract', 'rent', 'tax', 'manual']);

function positiveId(value) {
  const id = typeof value === 'string' ? Number(value) : value;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
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

async function _lockDebt(conn, debtId) {
  const [rows] = await conn.query(
    `SELECT id, debtor_character_id, creditor_type, creditor_ref,
            principal, remaining, status
       FROM debts WHERE id = ? FOR UPDATE`,
    [debtId]
  );
  return rows[0] || null;
}

async function _findPaymentReplay(conn, idempotencyKey) {
  const [rows] = await conn.query(
    'SELECT id, debt_id, amount, kind FROM debt_payments WHERE idempotency_key = ? FOR UPDATE',
    [idempotencyKey]
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Abertura
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra uma dívida. Não move dinheiro — dívida é o registro de que o
 * dinheiro **não** se moveu.
 *
 * `idempotencyKey` é obrigatória e UNIQUE porque a origem típica é um evento
 * repetível: a mesma multa reenviada não pode virar duas dívidas.
 *
 * @param {object} request
 * @param {number} request.debtorCharacterId
 * @param {{type:string, ref:string|number}} request.creditor
 * @param {number} request.amount
 * @param {string} request.reason
 * @param {string} [request.originType] fine, contract, rent, tax, manual
 * @param {string|number} [request.originRef]
 * @param {string} request.idempotencyKey
 */
async function open(request, dependencies = {}) {
  const economy = dependencies.economy || economyService;
  const debtorCharacterId = positiveId(request?.debtorCharacterId);
  const creditor = economy.normalizeAccount(request?.creditor);
  const amount = economy.normalizeAmount(request?.amount);
  const reason = normalizeText(request?.reason, 255);
  const idempotencyKey = economy.normalizeIdempotencyKey(request?.idempotencyKey);
  const originType = request?.originType === undefined ? 'manual' : request.originType;
  const originRef = request?.originRef === undefined || request.originRef === null
    ? null
    : String(request.originRef);

  if (!debtorCharacterId) return { ok: false, code: 'invalid_debtor' };
  if (!creditor || creditor.type === economy.SYSTEM_TYPE) return { ok: false, code: 'invalid_creditor' };
  if (!amount) return { ok: false, code: 'invalid_amount' };
  if (!reason) return { ok: false, code: 'invalid_reason' };
  if (!ORIGINS.includes(originType)) return { ok: false, code: 'invalid_origin' };
  if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };
  // Dever a si mesmo não é dívida, é erro de cálculo de quem chamou.
  if (creditor.type === 'character' && Number(creditor.ref) === debtorCharacterId) {
    return { ok: false, code: 'self_debt' };
  }

  const escrever = async conn => {
    const [existing] = await conn.query(
      'SELECT id, remaining, status FROM debts WHERE idempotency_key = ? FOR UPDATE',
      [idempotencyKey]
    );
    if (existing[0]) {
      return { ok: true, replayed: true, debtId: existing[0].id, remaining: Number(existing[0].remaining) };
    }

    const [insert] = await conn.query(
      `INSERT INTO debts
        (debtor_character_id, creditor_type, creditor_ref, principal, remaining,
         reason, origin_type, origin_ref, status, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [debtorCharacterId, creditor.type, creditor.ref, amount, amount,
        reason, originType, originRef, STATUS.ACTIVE, idempotencyKey]
    );

    return { ok: true, replayed: false, debtId: insert.insertId, remaining: amount };
  };

  // A variante em transação do chamador existe por um caso concreto: a multa da
  // guarda precisa gravar a cobrança, a linha em `fines` e a dívida **juntas**.
  // Abrir uma transação própria aqui faria um crash no meio deixar uma multa
  // sem a dívida que ela originou — que é a metade não corrigida do Achado 8.
  return dependencies.conn ? escrever(dependencies.conn) : _withTransaction(dependencies, escrever);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagamento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paga uma dívida, total ou parcialmente.
 *
 * O septim se move **primeiro**, pelo `economy-service`, e `remaining` só cai
 * depois — na mesma transação. A ordem é o ponto: se o abatimento viesse antes,
 * uma falha no pagamento deixaria a dívida menor sem ninguém ter recebido nada,
 * que é a mesma classe do bug da multa (`ECONOMY_FRAMEWORK_AUDIT.md` Achado 8).
 *
 * Pagamento parcial é permitido de propósito — "o trabalhador recebe o que
 * existe; o resto continua registrado" é o comportamento que transforma
 * inadimplência em cena em vez de bloqueio.
 */
async function pay(request, dependencies = {}) {
  const economy = dependencies.economy || economyService;
  const debtId = positiveId(request?.debtId);
  const amount = economy.normalizeAmount(request?.amount);
  const idempotencyKey = economy.normalizeIdempotencyKey(request?.idempotencyKey);
  const actorCharacterId = request?.actorCharacterId === undefined
    ? null
    : positiveId(request.actorCharacterId);

  if (!debtId) return { ok: false, code: 'invalid_debt' };
  if (!amount) return { ok: false, code: 'invalid_amount' };
  if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };

  return _withTransaction(dependencies, async conn => {
    const debt = await _lockDebt(conn, debtId);
    if (!debt) return { ok: false, code: 'debt_not_found' };

    const prior = await _findPaymentReplay(conn, idempotencyKey);
    if (prior) {
      return { ok: true, replayed: true, debtId, paid: Number(prior.amount), remaining: Number(debt.remaining) };
    }

    if (!PAYABLE.includes(debt.status)) {
      return { ok: false, code: 'debt_closed', status: debt.status };
    }
    const remaining = Number(debt.remaining);
    // Pagar mais do que se deve não é generosidade, é erro de UI: o excedente
    // não teria onde ser registrado e a dívida ficaria com `remaining` negativo,
    // que o CHECK do banco recusaria de qualquer forma.
    if (amount > remaining) return { ok: false, code: 'amount_exceeds_remaining', remaining };

    const moved = await economy.transferInTransaction(conn, {
      from: { type: 'character', ref: debt.debtor_character_id },
      to: { type: debt.creditor_type, ref: debt.creditor_ref },
      amount,
      reason: 'debt_payment',
      module: MODULE,
      actorCharacterId: actorCharacterId || debt.debtor_character_id,
      idempotencyKey: `${idempotencyKey}~pay`
    }, dependencies);
    if (!moved.ok) return moved;

    return _applyReduction(conn, {
      debt, amount, remaining, idempotencyKey, actorCharacterId,
      kind: 'payment', transferId: moved.transferId,
      closedStatus: STATUS.PAID
    });
  });
}

/**
 * Perdoa parte ou todo o saldo. Não move septim — o credor abre mão.
 *
 * Só o credor pode perdoar, e quando o credor é institucional (cidade, facção)
 * quem chama já resolveu a autorização: este arquivo não sabe quem manda numa
 * cidade, e duplicar essa regra aqui criaria dois lugares para mantê-la.
 */
async function forgive(request, dependencies = {}) {
  const economy = dependencies.economy || economyService;
  const debtId = positiveId(request?.debtId);
  const idempotencyKey = economy.normalizeIdempotencyKey(request?.idempotencyKey);
  const actorCharacterId = request?.actorCharacterId === undefined
    ? null
    : positiveId(request.actorCharacterId);

  if (!debtId) return { ok: false, code: 'invalid_debt' };
  if (!idempotencyKey) return { ok: false, code: 'invalid_idempotency_key' };

  return _withTransaction(dependencies, async conn => {
    const debt = await _lockDebt(conn, debtId);
    if (!debt) return { ok: false, code: 'debt_not_found' };

    const prior = await _findPaymentReplay(conn, idempotencyKey);
    if (prior) return { ok: true, replayed: true, debtId, remaining: Number(debt.remaining) };

    if (!PAYABLE.includes(debt.status)) return { ok: false, code: 'debt_closed', status: debt.status };

    const remaining = Number(debt.remaining);
    const amount = economy.normalizeAmount(request?.amount) || remaining;
    if (amount > remaining) return { ok: false, code: 'amount_exceeds_remaining', remaining };

    return _applyReduction(conn, {
      debt, amount, remaining, idempotencyKey, actorCharacterId,
      kind: 'forgiveness', transferId: null,
      closedStatus: STATUS.FORGIVEN
    });
  });
}

/**
 * Grava a amortização e fecha a dívida se ela zerou.
 *
 * `remaining = remaining - ?` sob a trava, com `AND remaining >= ?`: mesmo
 * padrão do débito de saldo. A guarda no `WHERE` é redundante com a checagem
 * feita acima, e existe para que um caminho futuro que esqueça a checagem
 * receba `affectedRows = 0` em vez de gravar dívida negativa.
 */
async function _applyReduction(conn, params) {
  const restante = params.remaining - params.amount;

  const [update] = await conn.query(
    `UPDATE debts SET remaining = remaining - ?, status = ?, closed_at = ?
      WHERE id = ? AND remaining >= ?`,
    [
      params.amount,
      restante === 0 ? params.closedStatus : params.debt.status,
      restante === 0 ? new Date() : null,
      params.debt.id,
      params.amount
    ]
  );
  if (update.affectedRows !== 1) {
    throw new Error(`[debt] amortizacao recusada para divida ${params.debt.id}`);
  }

  await conn.query(
    `INSERT INTO debt_payments (debt_id, amount, transfer_id, kind, actor_character_id, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.debt.id, params.amount, params.transferId, params.kind,
      params.actorCharacterId, params.idempotencyKey]
  );

  return {
    ok: true, replayed: false,
    debtId: params.debt.id,
    paid: params.amount,
    remaining: restante,
    status: restante === 0 ? params.closedStatus : params.debt.status,
    transferId: params.transferId
  };
}

/**
 * Marca inadimplência. **Rótulo, não confisco**: nenhum septim se move, nenhum
 * item é tomado, nenhuma ação do jogador é bloqueada. O que muda é que a
 * dívida passa a aparecer como `defaulted` para quem consultar — e o que se faz
 * com essa informação é papel de guilda, tribunal e jogador.
 */
async function markDefaulted(request, dependencies = {}) {
  const debtId = positiveId(request?.debtId);
  if (!debtId) return { ok: false, code: 'invalid_debt' };

  return _withTransaction(dependencies, async conn => {
    const debt = await _lockDebt(conn, debtId);
    if (!debt) return { ok: false, code: 'debt_not_found' };
    if (debt.status !== STATUS.ACTIVE) return { ok: false, code: 'invalid_status', status: debt.status };

    await conn.query('UPDATE debts SET status = ? WHERE id = ? AND status = ?',
      [STATUS.DEFAULTED, debtId, STATUS.ACTIVE]);
    return { ok: true, debtId, status: STATUS.DEFAULTED };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura — a parte que faz a dívida ser "legível por qualquer jogador"
// ─────────────────────────────────────────────────────────────────────────────

async function listByDebtor(debtorCharacterId, dependencies = {}) {
  const db = dependencies.db || database;
  const id = positiveId(debtorCharacterId);
  if (!id) return [];
  return db.query(
    `SELECT id, creditor_type, creditor_ref, principal, remaining, reason,
            origin_type, origin_ref, status, created_at
       FROM debts WHERE debtor_character_id = ? AND status IN (?, ?)
      ORDER BY created_at`,
    [id, STATUS.ACTIVE, STATUS.DEFAULTED]
  );
}

async function listByCreditor(creditor, dependencies = {}) {
  const economy = dependencies.economy || economyService;
  const db = dependencies.db || database;
  const account = economy.normalizeAccount(creditor);
  if (!account) return [];
  return db.query(
    `SELECT id, debtor_character_id, principal, remaining, reason, status, created_at
       FROM debts WHERE creditor_type = ? AND creditor_ref = ? AND status IN (?, ?)
      ORDER BY created_at`,
    [account.type, account.ref, STATUS.ACTIVE, STATUS.DEFAULTED]
  );
}

async function history(debtId, dependencies = {}) {
  const db = dependencies.db || database;
  const id = positiveId(debtId);
  if (!id) return [];
  return db.query(
    'SELECT amount, kind, transfer_id, actor_character_id, created_at FROM debt_payments WHERE debt_id = ? ORDER BY id',
    [id]
  );
}

module.exports = {
  open, pay, forgive, markDefaulted,
  listByDebtor, listByCreditor, history,
  STATUS, PAYABLE, ORIGINS
};

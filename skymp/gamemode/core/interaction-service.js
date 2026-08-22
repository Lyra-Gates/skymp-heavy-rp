/**
 * core/interaction-service.js
 *
 * O pipeline que separa "o cliente pediu" de "o servidor fez".
 *
 * ─── Fluxo, na ordem, e por que esta ordem ──────────────────────────────────
 *
 *   envelope → rate limit → ação conhecida → alvo → schema → permissão
 *            → política de ação (estado + zona) → distância
 *            → canSee → canExecute → deduplicação → execute → auditoria
 *
 * A ordem não é decorativa. Cada estágio é mais caro que o anterior, e cada um
 * só recebe entrada que o anterior já limpou:
 *
 *   - **rate limit antes de tudo** porque o objetivo dele é não pagar o resto;
 *   - **alvo antes de schema** porque um pedido sem alvo válido não tem contra
 *     o que validar payload, e porque resolver o alvo é o que transforma o
 *     `targetId` do cliente no registro que o servidor já tinha;
 *   - **permissão antes de política** porque "você não é guarda" é uma resposta
 *     melhor que "você está algemado" para quem não é guarda;
 *   - **política e distância antes de `canSee`** porque as duas são regras do
 *     core e o `canSee` é código de módulo: o barato e auditável roda primeiro;
 *   - **deduplicação depois de toda validação** porque um pedido que ia ser
 *     recusado não deve consumir o `requestId` — senão o retry legítimo, já
 *     corrigido, seria recusado como duplicata.
 *
 * ─── A regra que este arquivo existe para cumprir ───────────────────────────
 *
 * **`canSee` não autoriza nada.** Ele decide o que aparece num menu que foi
 * montado num instante anterior, na máquina de outra pessoa. Entre a montagem e
 * o clique o alvo pode ter andado, saído, sido preso ou vendido a barraca; o
 * jogador pode ter perdido o cargo. Por isso `execute` **refaz o pipeline
 * inteiro** — resolve o alvo de novo, checa permissão de novo, mede distância
 * de novo — e roda `canExecute` além de `canSee`.
 *
 * Isso é o §11 do pedido, e já era o comportamento da governança por
 * acidente de desenho (as funções de domínio revalidam sozinhas). Aqui vira
 * contrato: nenhuma interação precisa lembrar de revalidar, porque quem
 * revalida é o pipeline.
 *
 * ─── O que continua sendo responsabilidade de quem registra ─────────────────
 *
 * Atomicidade. O `execute` que move ouro e item chama o
 * `core/transaction-service.js` — este arquivo não abre transação e não sabe o
 * que é ouro. O pipeline garante que a chamada é legítima; o
 * `transaction-service` garante que ela é atômica e auditável.
 */

const { AUDIT_LEVELS } = require('./interaction-registry');

/** Estágios, na ordem. Usados no resultado e nos testes. */
const STAGES = Object.freeze({
  ENVELOPE: 'envelope',
  RATE_LIMIT: 'rate_limit',
  UNKNOWN_ACTION: 'unknown_action',
  TARGET: 'target',
  SCHEMA: 'schema',
  PERMISSION: 'permission',
  POLICY: 'policy',
  DISTANCE: 'distance',
  CAN_SEE: 'can_see',
  CAN_EXECUTE: 'can_execute',
  DUPLICATE: 'duplicate',
  EXECUTE: 'execute',
  DONE: 'done'
});

const DEFAULT_DEDUP_TTL_MS = 120_000;
const MIN_REQUEST_ID_LENGTH = 8;
const MAX_REQUEST_ID_LENGTH = 48;

/** Mensagem única para tudo que o jogador não deveria conseguir distinguir. */
const RECUSA_GENERICA = 'Acao indisponivel.';

/**
 * Normaliza o retorno de `canSee`/`canExecute`.
 * Aceita `true`, `false`, `{allowed}` e `{allowed, reason}` — as três formas que
 * um módulo escreve naturalmente.
 * @param {unknown} raw
 * @returns {{allowed: boolean, reason: string}}
 */
function normalizeVerdict(raw) {
  if (raw === true) return { allowed: true, reason: '' };
  if (raw === false || raw === undefined || raw === null) {
    return { allowed: false, reason: '' };
  }
  if (typeof raw === 'object') {
    const v = /** @type {any} */ (raw);
    return { allowed: Boolean(v.allowed), reason: typeof v.reason === 'string' ? v.reason : '' };
  }
  return { allowed: Boolean(raw), reason: '' };
}

/**
 * @param {object} deps
 * @param {object} deps.registry        - `core/interaction-registry`
 * @param {{resolve: Function}} deps.targets - de `createTargetResolvers`
 * @param {(actorId: number) => object|null|undefined} deps.getCharacter
 * @param {(actorId: number, permission: string, ctx: object) => Promise<{allowed: boolean, reason?: string}>} [deps.checkPermission]
 * @param {{canPerform: Function}} [deps.actionPolicy]
 * @param {{observe: Function}} [deps.rateLimiter]
 * @param {(entry: object) => void|Promise<void>} [deps.audit]
 * @param {(actorId: number, message: string) => void} [deps.notify]
 * @param {(actorId: number, type: string, data: object) => void} [deps.sendModal]
 * @param {() => number} [deps.now]
 * @param {number} [deps.dedupTtlMs]
 * @param {Pick<Console,'log'|'warn'|'error'>} [deps.logger]
 */
function createInteractionService({
  registry,
  targets,
  getCharacter,
  checkPermission,
  actionPolicy,
  rateLimiter,
  audit,
  notify = () => {},
  sendModal = () => {},
  now = Date.now,
  dedupTtlMs = DEFAULT_DEDUP_TTL_MS,
  logger = console
}) {
  if (!registry || typeof registry.get !== 'function' || typeof registry.listForTarget !== 'function') {
    throw new Error('[interaction-service] registry invalido');
  }
  if (!targets || typeof targets.resolve !== 'function') {
    throw new Error('[interaction-service] targets invalido');
  }
  if (typeof getCharacter !== 'function') {
    throw new Error('[interaction-service] getCharacter invalido');
  }

  /**
   * Pedidos já vistos, por `${actorId}:${requestId}`.
   *
   * Guarda o **resultado**, não só a marca. Um duplo clique não pode virar duas
   * multas, e também não deve virar uma multa e um erro: a segunda chamada
   * devolve o que a primeira devolveu, que é o que o jogador espera ver.
   *
   * Fica em memória de propósito. Uma tabela daria idempotência entre reinícios
   * do servidor, e o custo seria um `INSERT` no caminho quente de toda
   * interação — para proteger de um caso (duplo clique atravessando um restart)
   * que não acontece. A idempotência que **precisa** sobreviver a restart já
   * existe uma camada abaixo, por `idempotency_key` no `transaction-service`, e
   * é ela que protege ouro e item. Esta aqui protege contra duplo clique.
   *
   * @type {Map<string, {state: 'running'|'done', at: number, result?: object}>}
   */
  const seen = new Map();

  function sweepDedup(timestamp) {
    for (const [key, entry] of seen.entries()) {
      if (timestamp - entry.at >= dedupTtlMs) seen.delete(key);
    }
  }

  /**
   * @param {string} stage
   * @param {string} reason
   * @returns {{ok: false, stage: string, reason: string}}
   */
  function fail(stage, reason) {
    return { ok: false, stage, reason };
  }

  /**
   * Estágios 1 a 8 — tudo que vale igual para consultar e para executar.
   *
   * Devolve o contexto pronto (§12 do pedido) ou a recusa com o estágio em que
   * ela aconteceu. `execute` chama isto de novo, do zero: é o que garante que
   * uma opção vista há trinta segundos não vale nada por si só.
   *
   * @param {number} actorId
   * @param {object} entry            descritor da interação
   * @param {unknown} rawTargetId
   * @param {unknown} rawPayload
   * @param {{skipSchema?: boolean}} [options]
   */
  async function buildContext(actorId, entry, rawTargetId, rawPayload, options = {}) {
    const actor = getCharacter(actorId);
    if (!actor) return fail(STAGES.TARGET, 'Personagem nao carregado.');

    // ── Alvo ────────────────────────────────────────────────────────────────
    // Refeito a cada chamada, e é aqui que a desconexão do alvo entre a consulta
    // e o clique vira uma recusa limpa: `getCharacter` não responde mais por
    // quem saiu, então o alvo não resolve.
    const resolved = targets.resolve(entry.target, rawTargetId, actorId);
    if (!resolved.ok) return fail(STAGES.TARGET, resolved.reason);
    const target = resolved.target;

    // ── Schema ──────────────────────────────────────────────────────────────
    let data = {};
    if (!options.skipSchema) {
      const validated = registry.validatePayload(entry.schema, rawPayload);
      if (!validated.ok) return fail(STAGES.SCHEMA, validated.reason);
      data = validated.data;
    }

    // ── Permissão ───────────────────────────────────────────────────────────
    // A permissão é uma string opaca para este arquivo. Quem sabe o que
    // `guard.search` significa é o adaptador que o módulo injeta — governança
    // consulta cargo em `governance_memberships`, staff consulta
    // `admin-service`. O core não escolhe modelo de permissão para os módulos.
    let permission = null;
    if (entry.permission) {
      if (typeof checkPermission !== 'function') {
        logger.error(
          `[interaction-service] '${entry.id}' exige a permissao '${entry.permission}' ` +
          `e nenhum checkPermission foi injetado. Negando.`
        );
        return fail(STAGES.PERMISSION, RECUSA_GENERICA);
      }
      const verdict = await checkPermission(actorId, entry.permission, { target, interactionId: entry.id });
      const normalized = normalizeVerdict(verdict);
      if (!normalized.allowed) {
        return fail(STAGES.PERMISSION, normalized.reason || 'Voce nao tem autorizacao para isso.');
      }
      permission = normalized;
    }

    // ── Política de ação: estado do personagem + zona ───────────────────────
    if (entry.policyAction && actionPolicy) {
      const context = { actorId };
      if (target.actorId !== undefined) context.targetActorId = target.actorId;
      const verdict = actionPolicy.canPerform(actor.characterId, entry.policyAction, context);
      if (!verdict.allowed) return fail(STAGES.POLICY, verdict.reason);
    }

    // ── Distância ───────────────────────────────────────────────────────────
    // `unverified` distingue "medimos e está perto" de "não havia como medir"
    // (`mp` ausente — ver CORE_FRAMEWORK_AUDIT.md §5). O pipeline deixa passar
    // nos dois casos, como sempre deixou, mas só o primeiro vira "validado" no
    // log de auditoria.
    let distanceVerified = false;
    let distanceUnverified = false;
    if (entry.distance !== null && typeof target.assertRange === 'function') {
      const verdict = target.assertRange(actorId, entry.distance);
      if (!verdict.ok) return fail(STAGES.DISTANCE, verdict.reason || 'Alvo fora de alcance.');
      distanceUnverified = Boolean(verdict.unverified);
      distanceVerified = !distanceUnverified;
    }

    return {
      ok: true,
      ctx: {
        actorId,
        actor,
        characterId: actor.characterId,
        accountId: actor.accountId || null,
        target,
        interactionId: entry.id,
        module: entry.module,
        data,
        permission,
        distanceVerified,
        distanceUnverified,
        requestId: null
      }
    };
  }

  /**
   * Roda `canSee` (e, quando pedido, `canExecute`) com o contexto pronto.
   *
   * Um `canSee` que **lança** não vira "pode": vira "não pode", com log. Um
   * módulo com bug não pode abrir o menu de ninguém.
   */
  async function runGuard(entry, ctx, which) {
    const guard = entry[which];
    if (!guard) return { allowed: true, reason: '' };
    try {
      return normalizeVerdict(await guard(ctx));
    } catch (err) {
      logger.error(`[interaction-service] ${which} de '${entry.id}' lancou:`, err.message);
      return { allowed: false, reason: RECUSA_GENERICA };
    }
  }

  function checkRate(actorId, kind) {
    if (!rateLimiter) return true;
    const verdict = rateLimiter.observe(actorId, `interaction:${kind}`);
    return Boolean(verdict && verdict.allowed);
  }

  async function record(entry, ctx, outcome, detail) {
    if (entry.audit === AUDIT_LEVELS.TRACE || typeof audit !== 'function') return;
    try {
      await audit({
        level: entry.audit,
        interactionId: entry.id,
        module: entry.module,
        actorId: ctx.actorId,
        accountId: ctx.accountId,
        target: { type: ctx.target.type, id: ctx.target.id, accountId: ctx.target.accountId || null },
        outcome,
        detail: detail || null,
        distanceVerified: ctx.distanceVerified,
        requestId: ctx.requestId
      });
    } catch (err) {
      // Auditoria que falha não desfaz a ação: ela já aconteceu. Grita e segue.
      logger.error(`[interaction-service] auditoria de '${entry.id}' falhou:`, err.message);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // API pública
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * O que este ator pode ver no menu deste alvo, agora.
   *
   * Devolve **só rótulo, id e campos do formulário**. Nunca a permissão que
   * liberou a ação, nem o motivo pelo qual as outras sumiram: a lista de
   * ações é a resposta, e o raciocínio é do servidor.
   *
   * @param {number} actorId
   * @param {{targetType?: unknown, targetId?: unknown}} request
   */
  async function query(actorId, request) {
    if (!request || typeof request !== 'object') {
      return fail(STAGES.ENVELOPE, 'Pedido invalido.');
    }
    if (!checkRate(actorId, 'query')) {
      return fail(STAGES.RATE_LIMIT, 'Aguarde um instante.');
    }
    return _computeSections(actorId, request);
  }

  /**
   * O mesmo cálculo de `query`, sem o rate limit.
   *
   * Uso exclusivo de chamador INTERNO do servidor (ex: um tick periódico que
   * decide se mostra o prompt `[E]` — Tarefa 11), nunca de um evento vindo da
   * CEF. `interaction:query` da CEF sempre passa por `query()`, com o limite;
   * ligar isto num `ui-event-router` seria abrir uma segunda porta pro mesmo
   * cálculo sem o freio que a primeira tem.
   *
   * @param {number} actorId
   * @param {{targetType?: unknown, targetId?: unknown}} request
   */
  async function peek(actorId, request) {
    if (!request || typeof request !== 'object') {
      return fail(STAGES.ENVELOPE, 'Pedido invalido.');
    }
    return _computeSections(actorId, request);
  }

  async function _computeSections(actorId, request) {
    const targetType = typeof request.targetType === 'string' ? request.targetType : null;
    if (!targetType) return fail(STAGES.ENVELOPE, 'Tipo de alvo ausente.');

    const candidates = registry.listForTarget(targetType);
    if (candidates.length === 0) {
      return { ok: true, stage: STAGES.DONE, targetType, target: null, sections: [] };
    }

    /** @type {Map<string, {id: string, label: string, actions: object[]}>} */
    const sections = new Map();
    let resolvedTarget = null;

    for (const entry of candidates) {
      // O contexto é montado por interação, e não uma vez só, porque cada uma
      // tem a sua distância, a sua permissão e a sua política. Uma ação de
      // alcance 200 não pode aparecer só porque outra, de alcance 3000, coube.
      const built = await buildContext(actorId, entry, request.targetId, {}, { skipSchema: true });
      if (!built.ok) continue;

      resolvedTarget = built.ctx.target;
      const verdict = await runGuard(entry, built.ctx, 'canSee');
      if (!verdict.allowed) continue;

      if (!sections.has(entry.section)) {
        sections.set(entry.section, { id: entry.section, label: entry.section, actions: [] });
      }
      sections.get(entry.section).actions.push({
        action: entry.id,
        label: entry.label,
        fields: describeFields(entry.schema),
        // O cliente precisa saber se deve gerar um `requestId`; não precisa
        // saber a permissão, o alcance nem a classe de auditoria.
        requiresRequestId: entry.idempotent
      });
    }

    return {
      ok: true,
      stage: STAGES.DONE,
      targetType,
      target: resolvedTarget ? { type: resolvedTarget.type, id: resolvedTarget.id, label: resolvedTarget.label } : null,
      sections: Array.from(sections.values())
    };
  }

  /**
   * Executa uma ação escolhida no menu, revalidando tudo.
   *
   * @param {number} actorId
   * @param {{action?: unknown, targetType?: unknown, targetId?: unknown, requestId?: unknown, data?: unknown}} request
   */
  async function execute(actorId, request) {
    if (!request || typeof request !== 'object') {
      return fail(STAGES.ENVELOPE, 'Pedido invalido.');
    }
    if (!checkRate(actorId, 'execute')) {
      return fail(STAGES.RATE_LIMIT, 'Aguarde um instante antes de tentar de novo.');
    }

    const actionId = typeof request.action === 'string' ? request.action : null;
    const entry = actionId ? registry.get(actionId) : undefined;
    if (!entry) {
      // Mesma mensagem de uma ação que existe e não está disponível: dizer
      // "essa ação não existe" transforma o menu num oráculo de enumeração.
      logger.warn(`[interaction-service] acao desconhecida de 0x${actorId.toString(16)}: ${String(actionId)}`);
      return fail(STAGES.UNKNOWN_ACTION, RECUSA_GENERICA);
    }

    // O tipo de alvo vem do descritor, não do pedido. Aceitar o `targetType` do
    // cliente permitiria chamar uma ação de `player` declarando o alvo como
    // `container` e cair num resolvedor que não faz as recusas daquela ação.
    const built = await buildContext(actorId, entry, request.targetId, request.data ?? request);
    if (!built.ok) return built;
    const ctx = built.ctx;

    const podeVer = await runGuard(entry, ctx, 'canSee');
    if (!podeVer.allowed) return fail(STAGES.CAN_SEE, podeVer.reason || RECUSA_GENERICA);

    const podeExecutar = await runGuard(entry, ctx, 'canExecute');
    if (!podeExecutar.allowed) return fail(STAGES.CAN_EXECUTE, podeExecutar.reason || RECUSA_GENERICA);

    // ── Deduplicação ────────────────────────────────────────────────────────
    let dedupKey = null;
    if (entry.idempotent) {
      const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : '';
      if (requestId.length < MIN_REQUEST_ID_LENGTH || requestId.length > MAX_REQUEST_ID_LENGTH) {
        return fail(STAGES.DUPLICATE, 'Solicitacao invalida.');
      }
      ctx.requestId = requestId;
      dedupKey = `${actorId}:${requestId}`;

      const timestamp = now();
      sweepDedup(timestamp);
      const previous = seen.get(dedupKey);
      if (previous) {
        // `running` é o duplo clique de verdade: a primeira ainda não voltou.
        // `done` é o retry depois da resposta. Os dois devolvem sem executar.
        return previous.state === 'done' && previous.result
          ? { ...previous.result, duplicate: true }
          : fail(STAGES.DUPLICATE, 'Esta solicitacao ja esta sendo processada.');
      }
      seen.set(dedupKey, { state: 'running', at: timestamp });
    }

    // ── Execução ────────────────────────────────────────────────────────────
    try {
      const returned = await entry.execute(ctx);
      const result = {
        ok: true,
        stage: STAGES.DONE,
        interactionId: entry.id,
        message: returned && typeof returned === 'object' && typeof returned.message === 'string'
          ? returned.message
          : null,
        data: returned && typeof returned === 'object' && returned.data !== undefined ? returned.data : null
      };
      if (dedupKey) seen.set(dedupKey, { state: 'done', at: now(), result });
      await record(entry, ctx, 'ok', result.message);
      return result;
    } catch (err) {
      // O `requestId` é liberado numa falha: o pedido não aconteceu, e o retry
      // com o mesmo id é o comportamento correto do cliente.
      if (dedupKey) seen.delete(dedupKey);
      logger.error(`[interaction-service] '${entry.id}' falhou:`, err.message);
      await record(entry, ctx, 'error', err.message);
      return fail(STAGES.EXECUTE, 'Nao foi possivel concluir a acao.');
    }
  }

  /**
   * Ponte para o `core/ui-event-router.js`.
   *
   * Dois tipos, e só eles. `interaction:query` responde pelo `browserModal`;
   * `interaction:execute` responde por notificação, porque o resultado de uma
   * ação é uma frase, não uma tela.
   *
   * @param {number} actorId
   * @param {{type?: string, data?: unknown}} uiEvent
   * @returns {Promise<boolean>} true se o evento era deste módulo
   */
  async function handleUiEvent(actorId, uiEvent) {
    if (!uiEvent || typeof uiEvent !== 'object') return false;
    const type = uiEvent.type;
    if (type !== 'interaction:query' && type !== 'interaction:execute') return false;

    const data = uiEvent.data && typeof uiEvent.data === 'object' && !Array.isArray(uiEvent.data)
      ? /** @type {any} */ (uiEvent.data)
      : {};

    if (type === 'interaction:query') {
      const result = await query(actorId, data);
      if (!result.ok) {
        notify(actorId, /** @type {{reason: string}} */ (result).reason);
        return true;
      }
      // Só a lista vai para a tela. A versão anterior desta feature também
      // despejava o JSON das ações no chat (`CORE_FRAMEWORK_AUDIT.md` §6.7b);
      // aqui o canal é um só.
      sendModal(actorId, 'interaction:actions', {
        target: result.target,
        targetType: result.targetType,
        sections: result.sections
      });
      return true;
    }

    const result = await execute(actorId, data);
    if (!result.ok) {
      notify(actorId, result.reason);
    } else if (result.message) {
      notify(actorId, result.message);
    }
    return true;
  }

  /** Diagnóstico: quantos pedidos estão em memória de deduplicação. */
  function snapshot() {
    return { pendingRequests: seen.size, dedupTtlMs };
  }

  return { query, peek, execute, handleUiEvent, snapshot, STAGES };
}

/**
 * Traduz o `schema` do servidor no formulário que a CEF desenha.
 *
 * Existe para que o cliente **pare de manter a própria tabela de campos**
 * (`ACTION_CONFIG` em `ui/index.html`). Enquanto os dois lados declaram os
 * mesmos campos, o dia em que o servidor apertar um limite a UI continua
 * oferecendo o antigo — e o jogador descobre digitando.
 *
 * @param {Record<string, any>|null} schema
 */
function describeFields(schema) {
  if (!schema) return [];
  return Object.entries(schema).map(([name, spec]) => ({
    name,
    type: spec.type,
    label: spec.label || name,
    required: Boolean(spec.required),
    ...(spec.min !== undefined ? { min: spec.min } : {}),
    ...(spec.max !== undefined ? { max: spec.max } : {}),
    ...(spec.values ? { values: spec.values } : {}),
    ...(spec.placeholder ? { placeholder: spec.placeholder } : {})
  }));
}

module.exports = {
  createInteractionService,
  STAGES,
  DEFAULT_DEDUP_TTL_MS,
  normalizeVerdict,
  describeFields
};

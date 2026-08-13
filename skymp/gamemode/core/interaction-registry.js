/**
 * core/interaction-registry.js
 *
 * O catálogo de interações contextuais do servidor. Um módulo declara aqui o
 * que é possível fazer com um alvo; o `core/interaction-service.js` decide, a
 * cada pedido, se aquilo vale **agora**.
 *
 * ─── Por que isto existe, e o que ele substitui ─────────────────────────────
 *
 * O menu de interação já existia dentro do `governance-service.js`
 * (`getInteractionActions` / `handleInteractionAction`), e o **fluxo** dele
 * estava certo: o servidor monta a lista, o cliente escolhe, o servidor
 * revalida antes de executar. O que estava errado era onde ele morava.
 *
 * Para uma barraca aparecer no menu, a governança precisava
 * `require('./market-stalls-service')` por nome fixo, dentro de uma função de
 * domínio — e `market-stalls` já declara `dependencies: ['governance']` no
 * registry, então a seta apontava para os dois lados. O vocabulário de ações
 * era a regex `/^(guard|stall|npc)\.[a-z_]+$/` no core da governança: três
 * namespaces, e nenhum caminho para um quarto que não fosse editar aquele
 * arquivo. Detalhes em `docs/research/CORE_FRAMEWORK_AUDIT.md` §6.
 *
 * Aqui a seta se inverte. Quem tem uma ação a oferecer **registra**; ninguém
 * busca ninguém. `governance-service` deixa de conhecer `market-stalls`, e um
 * módulo futuro (`medical`, `carry`, `crafting`) passa a existir no menu sem
 * uma linha de mudança no core. É o §23 do pedido, e a razão de não haver
 * Service Locator neste projeto — ver
 * `docs/technical/ADR_002_INTERACTION_FRAMEWORK.md` §4.
 *
 * ─── O que este arquivo deliberadamente NÃO faz ─────────────────────────────
 *
 * Não toca `mp`, não abre banco, não conhece ator, personagem, distância nem
 * permissão. Ele guarda descritores e recusa os malformados. Toda decisão sobre
 * um pedido concreto é do `interaction-service`, que é onde a fronteira de
 * confiança fica. Isto é o mesmo motivo pelo qual `core/soul.js` é função pura:
 * a parte que dá para provar fora do servidor fica onde dá para provar.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de alvo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O que uma interação pode ter como alvo.
 *
 * **Só `PLAYER` tem resolvedor implementado hoje** (`core/interaction-targets.js`),
 * porque só ele tem consumidor. Os outros seis estão aqui como vocabulário
 * reservado: registrar uma interação contra um deles é aceito, e o pedido falha
 * no resolvedor com "tipo de alvo nao suportado" — falha fechada, nomeada e
 * visível, em vez de um `undefined` atravessando o pipeline.
 *
 * O critério é o mesmo que o cabeçalho do `module-registry` usou em 06/08/2026
 * para **não** construir distribuição de eventos de jogo: uma chave viva e seis
 * mortas seria abstração prematura; um vocabulário fechado com um resolvedor
 * registrável (`interactionTargets.registerResolver`) é ponto de extensão. O
 * dia em que `container` tiver dono, ele registra o resolvedor dele e nada aqui
 * muda.
 */
const TARGET_TYPES = Object.freeze({
  PLAYER: 'player',
  NPC: 'npc',
  OBJECT: 'object',
  CONTAINER: 'container',
  DOOR: 'door',
  PROPERTY: 'property',
  WORLD_POINT: 'world_point'
});

/** @type {Set<string>} */
const VALID_TARGET_TYPES = new Set(Object.values(TARGET_TYPES));

/**
 * Classes de auditoria. O §20 do pedido é explícito nos dois sentidos: ação
 * crítica gera registro, e o servidor não gera milhões de linhas inúteis.
 *
 * - `TRACE`    — nada é gravado. Consulta, leitura, abrir vitrine.
 * - `GAMEPLAY` — grava. Ação que muda o mundo de forma reversível.
 * - `SECURITY` — grava. Ação de um jogador **sobre outro** sem consentimento.
 * - `ADMIN`    — grava. Poder de staff.
 * - `ECONOMY`  — grava. Move ouro ou item.
 *
 * O padrão é `GAMEPLAY`: quem não escolheu, grava. Silêncio é opt-in.
 */
const AUDIT_LEVELS = Object.freeze({
  TRACE: 'TRACE',
  GAMEPLAY: 'GAMEPLAY',
  SECURITY: 'SECURITY',
  ADMIN: 'ADMIN',
  ECONOMY: 'ECONOMY'
});

/** @type {Set<string>} */
const VALID_AUDIT_LEVELS = new Set(Object.values(AUDIT_LEVELS));

/** `<modulo>.<acao>`, minúsculas. Substitui a regex de três namespaces fixos. */
const ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 48;

// ─────────────────────────────────────────────────────────────────────────────
// Validação de payload declarativa
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipos aceitos num `schema` de interação. Deliberadamente poucos: cada tipo
 * novo é uma forma nova de um payload de cliente atravessar a fronteira, e a
 * lista curta é o que torna a revisão possível.
 */
const FIELD_TYPES = new Set(['string', 'int', 'bool', 'enum', 'formid']);

/**
 * Um inteiro positivo escrito por quem controla o cliente.
 *
 * Recusa `"1e3"`, `" 1"`, `"01"`, `1.5`, `Infinity` e `"0x10"` — a mesma
 * disciplina do `isStrictPositiveInteger` da governança, que esta função
 * substitui. `Number("1e3")` é 1000 e `parseInt(" 1")` é 1: as duas formas
 * frouxas atravessariam uma validação ingênua de "dá pra converter".
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
function strictInteger(raw) {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) ? raw : null;
  }
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Um FormID do Skyrim, escrito em hexadecimal com ou sem `0x`.
 *
 * Separado de `int` porque o jogador digita `0x0000000F` no formulário e
 * `Number("0x0000000F")` é 15 — o que funciona, mas por acidente: a mesma
 * conversão aceitaria `0b1010` e `0o17`. Aqui a forma é conferida antes.
 *
 * Isto valida **digitação**, não existência: se o FormID aponta para um item de
 * verdade é pergunta do `core/espm.js`, que é quem tem os plugins carregados.
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
function strictFormId(raw) {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,8}$/i.test(clean)) return null;
  const parsed = Number.parseInt(clean, 16);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Confere um payload de cliente contra o `schema` declarado na interação.
 *
 * Devolve um objeto **novo**, com só os campos declarados e já convertidos —
 * nunca o payload original. É a diferença entre validar e sanear: se o
 * `execute` recebesse o objeto do cliente, um campo extra (`characterId`,
 * `price`, `allowed`) viajaria junto até alguém, um dia, lê-lo.
 *
 * @param {Record<string, object>|undefined} schema
 * @param {unknown} payload
 * @returns {{ok: true, data: Record<string, unknown>}|{ok: false, reason: string}}
 */
function validatePayload(schema, payload) {
  if (!schema || Object.keys(schema).length === 0) return { ok: true, data: {} };

  if (payload !== undefined && payload !== null &&
    (typeof payload !== 'object' || Array.isArray(payload))) {
    return { ok: false, reason: 'Dados da acao invalidos.' };
  }
  const source = /** @type {Record<string, unknown>} */ (payload || {});
  /** @type {Record<string, unknown>} */
  const data = {};

  for (const [name, rawSpec] of Object.entries(schema)) {
    const spec = /** @type {any} */ (rawSpec);
    const present = Object.hasOwn(source, name) && source[name] !== undefined && source[name] !== '';

    if (!present) {
      if (spec.required) return { ok: false, reason: `Campo obrigatorio ausente: ${name}.` };
      if (Object.hasOwn(spec, 'default')) data[name] = spec.default;
      continue;
    }

    const value = source[name];

    switch (spec.type) {
      case 'string': {
        if (typeof value !== 'string') return { ok: false, reason: `Campo ${name} deve ser texto.` };
        const trimmed = value.trim();
        if (spec.min !== undefined && trimmed.length < spec.min) {
          return { ok: false, reason: `Campo ${name} e curto demais.` };
        }
        // O teto existe em todo campo de texto, com ou sem `max` declarado: um
        // payload de CEF sem limite é memória do servidor controlada por quem
        // joga.
        const max = spec.max === undefined ? 240 : spec.max;
        if (trimmed.length > max) return { ok: false, reason: `Campo ${name} e longo demais.` };
        data[name] = trimmed;
        break;
      }
      case 'int': {
        const parsed = strictInteger(value);
        if (parsed === null) return { ok: false, reason: `Campo ${name} deve ser um numero inteiro.` };
        if (spec.min !== undefined && parsed < spec.min) {
          return { ok: false, reason: `Campo ${name} abaixo do minimo (${spec.min}).` };
        }
        if (spec.max !== undefined && parsed > spec.max) {
          return { ok: false, reason: `Campo ${name} acima do maximo (${spec.max}).` };
        }
        data[name] = parsed;
        break;
      }
      case 'formid': {
        const parsed = strictFormId(value);
        if (parsed === null) return { ok: false, reason: `Campo ${name} nao e um FormID valido.` };
        data[name] = parsed;
        break;
      }
      case 'bool': {
        if (typeof value === 'boolean') { data[name] = value; break; }
        if (value === 'true' || value === 'false') { data[name] = value === 'true'; break; }
        return { ok: false, reason: `Campo ${name} deve ser verdadeiro ou falso.` };
      }
      case 'enum': {
        if (typeof value !== 'string' || !spec.values.includes(value)) {
          return { ok: false, reason: `Campo ${name} tem valor invalido.` };
        }
        data[name] = value;
        break;
      }
      default:
        // Só acontece se `register` deixar passar um tipo novo — por isso ele
        // valida o schema no registro, e não aqui, com o jogador esperando.
        return { ok: false, reason: `Campo ${name} tem tipo desconhecido no servidor.` };
    }
  }

  return { ok: true, data };
}

/**
 * Confere o `schema` no momento do registro, e não no primeiro clique.
 *
 * Um `type` escrito errado num descritor é um erro de quem programa, e o lugar
 * de descobri-lo é o boot do servidor — não a tela de um jogador tentando
 * pagar uma multa. Mesma disciplina de `safe-zones.parseZones` e de
 * `admin-service.hasPermission`: configuração errada grita onde é lida.
 *
 * @param {string} interactionId
 * @param {unknown} schema
 */
function assertValidSchema(interactionId, schema) {
  if (schema === undefined) return;
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`[interaction-registry] '${interactionId}': schema deve ser um objeto`);
  }
  for (const [name, rawSpec] of Object.entries(schema)) {
    const spec = /** @type {any} */ (rawSpec);
    if (!spec || typeof spec !== 'object') {
      throw new Error(`[interaction-registry] '${interactionId}': campo '${name}' sem especificacao`);
    }
    if (!FIELD_TYPES.has(spec.type)) {
      throw new Error(
        `[interaction-registry] '${interactionId}': campo '${name}' tem tipo '${spec.type}'. ` +
        `Validos: ${[...FIELD_TYPES].join(', ')}`
      );
    }
    if (spec.type === 'enum' && (!Array.isArray(spec.values) || spec.values.length === 0)) {
      throw new Error(`[interaction-registry] '${interactionId}': campo enum '${name}' sem 'values'`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const _interactions = new Map();

/**
 * Registra uma interação.
 *
 * @param {object} descriptor
 * @param {string}   descriptor.id        - `<modulo>.<acao>`, ex: `law.search`
 * @param {string}   descriptor.module    - módulo dono (usado no desligamento)
 * @param {string}   descriptor.target    - um de `TARGET_TYPES`
 * @param {string}   descriptor.label     - texto do botão, já em português
 * @param {Function} descriptor.execute   - `async (ctx) => void`
 * @param {Function} [descriptor.canSee]     - `async (ctx) => boolean` — aparece no menu?
 * @param {Function} [descriptor.canExecute] - `async (ctx) => boolean|{allowed,reason}`
 * @param {string}   [descriptor.permission] - permissão consultada pelo adaptador do módulo
 * @param {number}   [descriptor.distance]   - alcance máximo em unidades do Skyrim
 * @param {string}   [descriptor.policyAction] - id de ação da `core/action-policy.js`
 * @param {object}   [descriptor.schema]     - campos aceitos no payload
 * @param {string}   [descriptor.audit]      - um de `AUDIT_LEVELS` (padrão `GAMEPLAY`)
 * @param {boolean}  [descriptor.idempotent] - exige `requestId` e deduplica (§19)
 * @param {number}   [descriptor.order]      - ordenação no menu (menor primeiro)
 * @param {string}   [descriptor.section]    - agrupamento no menu (padrão: o módulo)
 */
function register(descriptor) {
  const {
    id, module: moduleId, target, label,
    execute, canSee, canExecute,
    permission, distance, policyAction, schema,
    audit = AUDIT_LEVELS.GAMEPLAY,
    idempotent = false,
    order = 100,
    section
  } = descriptor || {};

  if (typeof id !== 'string' || !ID_PATTERN.test(id) || id.length > MAX_ID_LENGTH) {
    throw new Error(
      `[interaction-registry] id invalido: ${JSON.stringify(id)}. ` +
      `Esperado '<modulo>.<acao>' em minusculas, ex: 'law.search'`
    );
  }
  // Duplicata é erro, não aviso. O `command-registry` avisa e sobrescreve, e
  // aquilo é defensável para um comando de chat — quem digita vê o resultado na
  // hora. Aqui a ação sobrescrita continuaria **aparecendo no menu com o mesmo
  // rótulo** e executando o código de outro módulo. Duas ações com o mesmo id
  // é um bug de quem programa, e o boot é onde ele deve morrer.
  if (_interactions.has(id)) {
    const dono = _interactions.get(id).module;
    throw new Error(
      `[interaction-registry] '${id}' ja registrado pelo modulo '${dono}'. ` +
      `Ids duplicados sobrescreveriam a acao em silencio.`
    );
  }
  if (typeof moduleId !== 'string' || !moduleId) {
    throw new Error(`[interaction-registry] '${id}': sem 'module'`);
  }
  if (!VALID_TARGET_TYPES.has(target)) {
    throw new Error(
      `[interaction-registry] '${id}': target '${target}' desconhecido. ` +
      `Validos: ${[...VALID_TARGET_TYPES].join(', ')}`
    );
  }
  if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL_LENGTH) {
    throw new Error(`[interaction-registry] '${id}': label invalido`);
  }
  if (typeof execute !== 'function') {
    throw new Error(`[interaction-registry] '${id}': sem funcao execute`);
  }
  for (const [nome, fn] of [['canSee', canSee], ['canExecute', canExecute]]) {
    if (fn !== undefined && typeof fn !== 'function') {
      throw new Error(`[interaction-registry] '${id}': ${nome} deve ser funcao`);
    }
  }
  if (distance !== undefined && !(Number.isFinite(distance) && distance > 0)) {
    throw new Error(`[interaction-registry] '${id}': distance deve ser um numero positivo`);
  }
  if (!VALID_AUDIT_LEVELS.has(audit)) {
    throw new Error(
      `[interaction-registry] '${id}': audit '${audit}' desconhecido. ` +
      `Validos: ${[...VALID_AUDIT_LEVELS].join(', ')}`
    );
  }
  assertValidSchema(id, schema);

  _interactions.set(id, {
    id, module: moduleId, target, label,
    execute,
    canSee: canSee || null,
    canExecute: canExecute || null,
    permission: permission || null,
    distance: distance === undefined ? null : distance,
    policyAction: policyAction || null,
    schema: schema || null,
    audit,
    idempotent: Boolean(idempotent),
    order,
    section: section || moduleId
  });
}

/**
 * @param {string} id
 * @returns {object|undefined}
 */
function get(id) {
  return typeof id === 'string' ? _interactions.get(id) : undefined;
}

/**
 * Interações candidatas a um tipo de alvo, já na ordem do menu.
 *
 * "Candidatas" e não "disponíveis": aqui não há ator, alvo nem permissão. Quem
 * filtra por `canSee` é o `interaction-service`, com contexto na mão.
 *
 * @param {string} targetType
 * @returns {object[]}
 */
function listForTarget(targetType) {
  const found = [];
  for (const entry of _interactions.values()) {
    if (entry.target === targetType) found.push(entry);
  }
  return found.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

/**
 * Remove tudo que um módulo registrou.
 *
 * Chamado no `shutdown` do módulo, pelo mesmo motivo que o `module-registry`
 * remove os comandos: uma ação que continua no menu depois do módulo desligar
 * executa contra um serviço que não inicializou.
 *
 * @param {string} moduleId
 * @returns {number} quantas foram removidas
 */
function unregisterModule(moduleId) {
  let removed = 0;
  for (const [id, entry] of _interactions.entries()) {
    if (entry.module === moduleId) {
      _interactions.delete(id);
      removed++;
    }
  }
  return removed;
}

/** Todas as interações registradas, para diagnóstico e para a staff. */
function list() {
  return Array.from(_interactions.values()).map(entry => ({
    id: entry.id,
    module: entry.module,
    target: entry.target,
    label: entry.label,
    permission: entry.permission,
    distance: entry.distance,
    audit: entry.audit,
    idempotent: entry.idempotent
  }));
}

/** Só para teste: devolve o registro ao estado vazio entre casos. */
function _reset() {
  _interactions.clear();
}

module.exports = {
  TARGET_TYPES,
  AUDIT_LEVELS,
  FIELD_TYPES,
  register,
  get,
  listForTarget,
  unregisterModule,
  list,
  validatePayload,
  strictInteger,
  strictFormId,
  _reset
};

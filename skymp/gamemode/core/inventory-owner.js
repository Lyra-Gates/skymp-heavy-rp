/**
 * core/inventory-owner.js
 *
 * O vocabulário de "de quem é este item".
 *
 * ─── Por que isto existe ────────────────────────────────────────────────────
 *
 * Até 13/08/2026 o servidor tinha **uma** noção de dono de item: personagem.
 * `core/transaction-service.js` só aceita `characterId`, e o ledger
 * `inventory_transactions` tinha `character_id INT NOT NULL`.
 *
 * Toda vez que um item precisou ir para outro lugar — baú, barraca, receita —
 * quem precisou disso escreveu o outro lado à mão, fora da transação. Três
 * implementações independentes, com a mesma forma de defeito que já foi apagada
 * duas vezes neste projeto (`economy-service.transfer` e o `craftItem` pré-Fase
 * 3). Ver `docs/research/INVENTORY_TRADE_CRAFTING_AUDIT.md` §2 a §5.
 *
 * Este arquivo é a metade barata da correção: nomear o dono. A cara é o
 * `core/inventory-service.js`, que move item entre dois donos numa transação só.
 *
 * ─── O que este arquivo deliberadamente NÃO faz ─────────────────────────────
 *
 * Não toca `mp`, não abre banco, não sabe se o dono existe. É função pura sobre
 * strings e números, pelo mesmo motivo que `core/interaction-registry.js` e
 * `core/soul.js` são: a parte que dá para provar fora do servidor fica onde dá
 * para provar. Quem confere existência é o adaptador de armazenamento, dentro
 * da transação, onde a resposta ainda vale quando for usada.
 */

/**
 * Os sete tipos de dono.
 *
 * **Três têm adaptador de armazenamento hoje** (`character`, `container`,
 * `system`); os outros quatro são vocabulário reservado, e uma transferência
 * contra eles falha **fechada e por nome** no `inventory-service`.
 *
 * É o mesmo critério do `TARGET_TYPES` do Interaction Framework, pela mesma
 * razão: escrever adaptador para `corpse` hoje seria escrever contra uma tabela
 * que não existe e um consumidor que não existe. Um vocabulário fechado com
 * ponto de registro (`inventoryService.registerAdapter`) é extensão; quatro
 * adaptadores adivinhados são pior que a ausência, porque parecem prontos.
 *
 * - `CHARACTER` — inventário persistente do personagem (`character_inventory`).
 * - `CONTAINER` — baú registrado (`container_inventory`, chaveado por `containers.id`).
 * - `PROPERTY`  — reservado. Hoje uma propriedade **é** um container
 *                 (`properties.container_id`); vira tipo próprio quando tiver
 *                 estoque que não passe por baú.
 * - `FACTION`   — reservado. Não há tabela de patrimônio de facção em item;
 *                 `factions.treasury` é ouro, e o ADR daquele patrimônio não foi
 *                 escrito (ver `PARKED_SERVICES_DECISION.md` §7.6).
 * - `CORPSE`    — reservado. `corpse-probe.js` observa cadáver, não guarda item.
 * - `MARKET`    — reservado. `market_stall_items` **não é** uma pilha: carrega
 *                 preço, rótulo e status por anúncio. Forçá-la neste vocabulário
 *                 apagaria a diferença entre estoque e oferta.
 * - `SYSTEM`    — o nada. Item que entra vem do mundo (craft, coleta, staff);
 *                 item que sai é destruído (confisco, consumo). Não tem
 *                 armazenamento **de propósito** — ver §3 abaixo.
 */
const OWNER_TYPES = Object.freeze({
  CHARACTER: 'character',
  CONTAINER: 'container',
  PROPERTY: 'property',
  FACTION: 'faction',
  CORPSE: 'corpse',
  MARKET: 'market',
  SYSTEM: 'system'
});

/** @type {Set<string>} */
const VALID_OWNER_TYPES = new Set(Object.values(OWNER_TYPES));

/**
 * Rótulos de origem/destino aceitos para o dono `SYSTEM`.
 *
 * ─── Por que o `system` é uma lista fechada ─────────────────────────────────
 *
 * `transfer({ from: system(...), to: character(...) })` **cria item**. É o mesmo
 * poder que `transactionService.giveItem` já tinha, então nada de novo é
 * concedido — mas ali o poder estava escondido atrás de um nome que parecia
 * inofensivo, e aqui ele fica escrito na assinatura.
 *
 * A lista fechada faz duas coisas. Primeiro, um `ref` novo é uma decisão de
 * economia que passa por revisão de código, e não uma string digitada no meio de
 * um módulo. Segundo, ela torna a pergunta *"que caminhos criam item neste
 * servidor?"* respondível por leitura, que é exatamente a pergunta que a
 * auditoria §2 não conseguia responder.
 */
const SYSTEM_SOURCES = Object.freeze({
  /** Resultado de receita. Contrapartida: o consumo dos ingredientes. */
  CRAFT: 'craft',
  /** Consumo de ingrediente/recurso que deixa de existir. */
  CONSUME: 'consume',
  /** Coleta no mundo (lenha, minério, pesca). */
  GATHER: 'gather',
  /** Staff criando ou apagando item, sempre auditado. */
  STAFF: 'staff',
  /** Destruição por regra do jogo (confisco de contrabando). */
  DESTROY: 'destroy',
  /** Semente de teste e de seed. Nunca deve aparecer em produção. */
  SEED: 'seed'
});

/** @type {Set<string>} */
const VALID_SYSTEM_SOURCES = new Set(Object.values(SYSTEM_SOURCES));

/**
 * @typedef {object} InventoryOwner
 * @property {string} type        um de `OWNER_TYPES`
 * @property {string} ref         identificador dentro do tipo, **sempre string**
 * @property {number|null} characterId  preenchido só quando `type === 'character'`
 * @property {number|null} actorId      ator SkyMP, quando conhecido — só para projetar no cliente
 * @property {string} label       texto curto para log e auditoria
 */

/**
 * Um `ref` é sempre string no banco (`owner_ref VARCHAR(64)`), porque nem todo
 * tipo de dono tem id numérico. Aqui a conversão acontece num lugar só.
 *
 * Recusa `""`, `null`, `undefined`, `NaN`, `Infinity` e qualquer coisa acima de
 * 64 caracteres — o tamanho da coluna. Truncar silenciosamente faria dois donos
 * distintos virarem o mesmo `owner_ref`, que é a pior forma de errar aqui.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeRef(raw) {
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) return null;
    return String(raw);
  }
  if (typeof raw !== 'string') return null;
  const clean = raw.trim();
  if (!clean || clean.length > 64) return null;
  return clean;
}

/**
 * Monta um dono, validando tipo e `ref`.
 *
 * @param {string} type
 * @param {unknown} ref
 * @param {{actorId?: number|null, label?: string}} [opts]
 * @returns {InventoryOwner}
 * @throws quando o tipo é desconhecido ou o `ref` é inválido
 */
function owner(type, ref, opts = {}) {
  if (!VALID_OWNER_TYPES.has(type)) {
    throw new Error(
      `[inventory-owner] tipo de dono desconhecido: ${JSON.stringify(type)}. ` +
      `Validos: ${[...VALID_OWNER_TYPES].join(', ')}`
    );
  }

  const normalized = normalizeRef(ref);
  if (normalized === null) {
    throw new Error(`[inventory-owner] '${type}': ref invalido ${JSON.stringify(ref)}`);
  }

  if (type === OWNER_TYPES.SYSTEM && !VALID_SYSTEM_SOURCES.has(normalized)) {
    throw new Error(
      `[inventory-owner] origem de sistema desconhecida: '${normalized}'. ` +
      `Validas: ${[...VALID_SYSTEM_SOURCES].join(', ')}. ` +
      `Criar item por um rotulo novo e decisao de economia, nao de modulo.`
    );
  }

  const actorId = Number.isSafeInteger(opts.actorId) && Number(opts.actorId) > 0
    ? Number(opts.actorId)
    : null;

  return Object.freeze({
    type,
    ref: normalized,
    characterId: type === OWNER_TYPES.CHARACTER ? Number(normalized) : null,
    actorId,
    label: opts.label ? String(opts.label).slice(0, 96) : `${type}:${normalized}`
  });
}

/**
 * O dono é um personagem.
 *
 * `actorId` é **opcional e nunca é autoridade**: ele existe só para projetar a
 * mudança no cliente depois do commit. Um personagem offline transfere item do
 * mesmo jeito — é o que permite devolver estoque de barraca para quem não está
 * conectado, coisa que o `packStall` hoje não consegue fazer.
 *
 * @param {number} characterId
 * @param {number|null} [actorId]
 */
function character(characterId, actorId = null) {
  return owner(OWNER_TYPES.CHARACTER, characterId, { actorId, label: `char:${characterId}` });
}

/**
 * O dono é um baú registrado. `ref` é `containers.id`, **não** o `object_id`
 * (formDesc): o formDesc é o endereço no mundo e pode ser reapontado; o id é a
 * identidade do baú.
 *
 * @param {number} containerId
 * @param {string} [label]
 */
function container(containerId, label) {
  return owner(OWNER_TYPES.CONTAINER, containerId, { label: label || `bau:${containerId}` });
}

/**
 * O dono é o nada: item nasce aqui ou morre aqui.
 * @param {string} source um de `SYSTEM_SOURCES`
 */
function system(source) {
  return owner(OWNER_TYPES.SYSTEM, source, { label: `sistema:${source}` });
}

/**
 * Chave estável do dono, para lock ordenado, log e deduplicação.
 * @param {InventoryOwner} o
 * @returns {string}
 */
function key(o) {
  return `${o.type}:${o.ref}`;
}

/**
 * Dois donos são o mesmo?
 *
 * Usado para recusar transferência de alguém para si mesmo — que não é um erro
 * inofensivo: ela geraria duas linhas de ledger que se cancelam e, num caminho
 * com `FOR UPDATE`, poderia travar contra a própria transação.
 *
 * @param {InventoryOwner} a
 * @param {InventoryOwner} b
 */
function isSame(a, b) {
  return Boolean(a && b && a.type === b.type && a.ref === b.ref);
}

/**
 * `system` não guarda nada. Serve para o `inventory-service` saber que não
 * precisa de adaptador de armazenamento nem de lock para esta ponta.
 * @param {InventoryOwner} o
 */
function isVoid(o) {
  return Boolean(o) && o.type === OWNER_TYPES.SYSTEM;
}

module.exports = {
  OWNER_TYPES,
  SYSTEM_SOURCES,
  owner,
  character,
  container,
  system,
  key,
  isSame,
  isVoid,
  normalizeRef
};

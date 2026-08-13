/**
 * core/inventory.js — a API central de movimentação de item
 *
 * **Nenhum módulo de gameplay escreve em tabela de inventário.** Item se move
 * por `inventory.transfer()`, que valida, trava, move as duas pontas e grava o
 * razão numa transação só.
 *
 * ─── O problema que isto resolve ────────────────────────────────────────────
 *
 * `core/transaction-service.js` é bom e faz o que promete — mas só sabe falar
 * de **um** dono: personagem. Toda vez que um item precisou ir para outro lugar,
 * quem precisou disso escreveu o outro lado à mão:
 *
 *   - `housing-service.depositItem` — `removeItem()` (transação própria, já
 *     commitada) seguido de dois `db.query` soltos no container. Se o segundo
 *     falha, o item **sumiu**.
 *   - `market-stalls.addItem` — `removeItem()` commitado, depois uma segunda
 *     transação para o anúncio, com `giveItem()` compensatório no `catch`.
 *     Compensação só cobre falha que este processo chega a observar.
 *   - `market-stalls.packStall` — devolve N itens em N transações
 *     independentes, com os N já marcados `removed`.
 *
 * As três têm a forma do `economy-service.transfer` (`removeGold` seguido de
 * `addGold`, sem transação), que foi apagado em 06/08/2026, e a forma do
 * `craftItem` pré-Fase 3. Não é coincidência: é o que acontece quando a API só
 * sabe falar de um lado. Diagnóstico completo em
 * `docs/research/INVENTORY_TRADE_CRAFTING_AUDIT.md` §2 a §5.
 *
 * ─── O que este arquivo NÃO faz, e por quê ──────────────────────────────────
 *
 * - **Não mede distância.** Quem mede é o pipeline de interação
 *   (`core/interaction-service.js` §7 do fluxo), que já tem ator, alvo e
 *   `assertRange`. Medir aqui também significaria medir num momento diferente do
 *   que autorizou — duas respostas para a mesma pergunta. Quem chama revalida
 *   *imediatamente antes* de chamar; o `trade-service` faz isso.
 * - **Não checa permissão.** Mesma razão: permissão é do módulo que ofereceu a
 *   ação. Esta API é o notário, não o juiz.
 * - **Não fala com o cliente durante a transação.** `applyToClient` roda depois
 *   do `commit`, sempre — o banco é a fonte de verdade
 *   (`docs/technical/ADR_003_INVENTORY_SOURCE_OF_TRUTH.md`).
 */

const db = require('../database');
const crypto = require('crypto');
const transactionService = require('./transaction-service');
const espm = require('./espm');
const ownerLib = require('./inventory-owner');

const { OWNER_TYPES } = ownerLib;

// ─────────────────────────────────────────────────────────────────────────────
// Limites
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quantos `base_id` distintos uma transferência pode mover.
 *
 * Cada item gera duas linhas de razão e até dois locks, então o teto é o
 * orçamento de uma transação. 32 cobre com folga a maior troca plausível de
 * Heavy RP; uma "troca" de 500 itens é um script, não uma cena.
 */
const MAX_ITEMS_PER_TRANSFER = 32;

/** Teto por item numa única operação. Não é o teto da pilha (esse é do banco). */
const MAX_QUANTITY_PER_ITEM = 1_000_000;

/** `requestId`: 8 a 96, alfanumérico com `_ : . -`. Mesmo espírito do §7 do Interaction Framework. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_:.-]{8,96}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Adaptadores de armazenamento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Um adaptador diz **onde mora** o estoque de um tipo de dono. Ele não decide
 * nada: recebe uma conexão com transação já aberta e aplica o delta, ou lança.
 *
 * @typedef {object} StorageAdapter
 * @property {(conn: object, owner: object, baseId: number, delta: number) => Promise<void>} applyDelta
 * @property {(runner: object, owner: object) => Promise<Array<{baseId: number, count: number}>>} list
 * @property {(conn: object, owner: object) => Promise<boolean>} [assertOwner]
 */

/** @type {Map<string, StorageAdapter>} */
const _adapters = new Map();

/**
 * Personagem: `character_inventory`, escrito pela primitiva do
 * `transaction-service` — a mesma que `giveItem`/`removeItem` usam por dentro.
 * Não há segunda implementação de "como mexer no inventário de personagem".
 */
_adapters.set(OWNER_TYPES.CHARACTER, {
  applyDelta: (conn, owner, baseId, delta) =>
    transactionService.tx.applyStackDelta(conn, 'character_inventory', Number(owner.ref), baseId, delta),
  list: async (runner, owner) => {
    const rows = await runner.query(
      'SELECT base_id, count FROM character_inventory WHERE character_id = ? AND count > 0 ORDER BY base_id',
      [Number(owner.ref)]
    );
    return normalizeRows(rows);
  }
});

/**
 * Baú registrado: `container_inventory`, chaveado por `containers.id`.
 *
 * `assertOwner` existe porque um `containers.id` inventado passaria pela FK
 * apenas no `INSERT` — e o erro chegaria como falha de SQL crua, sem dizer que o
 * baú não existe. Conferir dentro da transação também impede a corrida "o baú
 * foi apagado entre a validação e a escrita".
 */
_adapters.set(OWNER_TYPES.CONTAINER, {
  applyDelta: (conn, owner, baseId, delta) =>
    transactionService.tx.applyStackDelta(conn, 'container_inventory', Number(owner.ref), baseId, delta),
  list: async (runner, owner) => {
    const rows = await runner.query(
      'SELECT base_id, count FROM container_inventory WHERE container_id = ? AND count > 0 ORDER BY base_id',
      [Number(owner.ref)]
    );
    return normalizeRows(rows);
  },
  assertOwner: async (conn, owner) => {
    const [rows] = await conn.query('SELECT id FROM containers WHERE id = ?', [Number(owner.ref)]);
    return rows.length > 0;
  }
});

/**
 * Registra o adaptador de um tipo de dono que ainda não tem.
 *
 * Chamado no `initialize()` de quem for dono daquele tipo, exatamente como
 * `interactionTargets.registerResolver`. O core não precisa saber que ele
 * existe, e um tipo sem adaptador falha fechado e por nome.
 *
 * @param {string} ownerType
 * @param {StorageAdapter} adapter
 */
function registerAdapter(ownerType, adapter) {
  if (!(/** @type {string[]} */ (Object.values(OWNER_TYPES))).includes(ownerType)) {
    throw new Error(`[inventory] tipo de dono desconhecido: ${JSON.stringify(ownerType)}`);
  }
  if (ownerType === OWNER_TYPES.SYSTEM) {
    throw new Error('[inventory] o dono `system` nao tem armazenamento por definicao');
  }
  if (!adapter || typeof adapter.applyDelta !== 'function' || typeof adapter.list !== 'function') {
    throw new Error(`[inventory] adaptador de '${ownerType}' precisa de applyDelta e list`);
  }
  if (_adapters.has(ownerType)) {
    throw new Error(`[inventory] '${ownerType}' ja tem adaptador`);
  }
  _adapters.set(ownerType, adapter);
}

/** Tipos que sabem guardar item hoje. `system` não entra: ele é o nada. */
function supportedOwnerTypes() {
  return [...Object.values(OWNER_TYPES)].filter(t => t === OWNER_TYPES.SYSTEM || _adapters.has(t));
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/** `mysql2` devolve `count` como número; um driver diferente devolveria string. */
function normalizeRows(rows) {
  return (rows || []).map(r => ({ baseId: Number(r.base_id), count: Number(r.count) }));
}

/**
 * Um `requestId` novo, para quem não recebeu um do cliente.
 *
 * O prefixo é do chamador e vai no log; o aleatório é o que torna a chave única.
 * Um `Date.now()` **não** serve — foi exatamente o defeito do `craftItem`
 * (auditoria §5): duas chamadas seguidas produziam chaves diferentes, e a
 * idempotência que o comentário prometia nunca existiu.
 *
 * @param {string} prefix
 */
function newRequestId(prefix = 'inv') {
  const limpo = String(prefix).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 24) || 'inv';
  return `${limpo}:${uuid().replace(/-/g, '').slice(0, 24)}`;
}

/**
 * Confere e normaliza a lista de itens.
 *
 * Soma quantidades do mesmo `base_id` em vez de recusar: `[{A,2},{A,3}]` é um
 * pedido legítimo de uma UI que somou duas pilhas, e mantê-los separados criaria
 * dois locks para a mesma linha dentro da mesma transação.
 *
 * @param {unknown} raw
 * @returns {{ok: boolean, code: string|null, reason: string|null, items: ItemPedido[]}}
 */
function normalizeItems(raw) {
  const recusar = (code, reason) => ({ ok: false, code, reason, items: [] });

  const lista = Array.isArray(raw) ? raw : [raw];
  if (lista.length === 0) {
    return recusar('EMPTY', 'Nenhum item na transferencia.');
  }
  if (lista.length > MAX_ITEMS_PER_TRANSFER) {
    return recusar('TOO_MANY', `Maximo de ${MAX_ITEMS_PER_TRANSFER} itens por transferencia.`);
  }

  /** @type {Map<number, number>} */
  const somados = new Map();

  for (const entrada of lista) {
    if (!entrada || typeof entrada !== 'object') {
      return recusar('INVALID_ITEM', 'Item malformado.');
    }
    const baseId = entrada.baseId;
    const quantity = entrada.quantity;

    // `Number.isSafeInteger` recusa NaN, Infinity, 1.5 e 1e400 de uma vez. É a
    // barreira que o §19 do pedido chama de "negative quantity, NaN, overflow".
    if (!Number.isSafeInteger(baseId) || baseId <= 0) {
      return recusar('INVALID_ITEM', 'FormID invalido.');
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return recusar('INVALID_QUANTITY', 'Quantidade invalida.');
    }
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      return recusar('INVALID_QUANTITY', `Quantidade acima do maximo (${MAX_QUANTITY_PER_ITEM}).`);
    }

    // `pareceItem` devolve `ok` quando não sabe (sem `mp`, servidor antigo). Só
    // nega quando a API respondeu e respondeu que aquele FormID não vai para
    // inventário. É diagnóstico de digitação, não autoridade — ver core/espm.js.
    const veredito = espm.pareceItem(baseId);
    if (!veredito.ok) {
      return recusar('UNKNOWN_FORMID', `Item invalido: ${veredito.motivo}.`);
    }

    const anterior = somados.get(baseId) || 0;
    if (anterior + quantity > MAX_QUANTITY_PER_ITEM) {
      return recusar('INVALID_QUANTITY', `Quantidade acima do maximo (${MAX_QUANTITY_PER_ITEM}).`);
    }
    somados.set(baseId, anterior + quantity);
  }

  const items = [...somados.entries()]
    .map(([baseId, quantity]) => ({ baseId, quantity }))
    .sort((a, b) => a.baseId - b.baseId);

  return { ok: true, code: null, reason: null, items };
}

/**
 * A chave de idempotência da **primeira** linha de razão da transferência.
 *
 * A âncora precisa ser determinística porque é ela que o replay procura, e
 * precisa ser única porque é ela que o `UNIQUE (idempotency_key)` protege. As
 * demais linhas ganham `#1`, `#2`, … pelo mesmo prefixo.
 *
 * @param {string} requestId
 * @param {number} indice
 */
function ledgerKey(requestId, indice) {
  return `${requestId}#${indice}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// A API
// ─────────────────────────────────────────────────────────────────────────────

/** Quantas pernas uma troca pode ter. Duas cobrem troca e craft; oito é folga. */
const MAX_LEGS = 8;

/**
 * @typedef {{baseId: number, quantity: number}} ItemPedido
 * @typedef {{from: object, to: object, items: ItemPedido[]}} PernaResolvida
 */

/**
 * O resultado de qualquer movimento, numa **forma só**.
 *
 * ─── Por que não é uma união discriminada ───────────────────────────────────
 *
 * `{ok: true, …} | {ok: false, code, reason}` seria a modelagem natural, e é a
 * que estava aqui primeiro. O `jsconfig.json` deste pacote roda com
 * `strictNullChecks: false` — deliberadamente, e a razão está escrita lá: o
 * código existente não foi escrito com tipos em mente, e ligar `strict` de uma
 * vez produziria centenas de erros que ninguém leria.
 *
 * Sem `strictNullChecks`, o TypeScript **não estreita** união por literal, então
 * todo `if (!r.ok) return r.reason` vira erro no `npm run typecheck` — no
 * chamador, não aqui. Uma API cujo uso correto acende o verificador de tipos é
 * uma API que ensina a ignorar o verificador.
 *
 * A forma única resolve sem mentir: os campos de falha são `null` no sucesso e
 * os de sucesso são vazios na falha. Quem consome lê `ok` e segue.
 *
 * @typedef {object} ResultadoDeInventario
 * @property {boolean} ok
 * @property {string|null} code        código estável para o chamador ramificar
 * @property {string|null} reason      frase que o jogador pode ver
 * @property {string|null} transferId  UUID que agrupa as pernas no razão
 * @property {boolean} duplicate       o pedido já tinha sido aplicado antes
 * @property {PernaResolvida[]} legs
 * @property {ItemPedido[]} items      atalho para a primeira perna
 */

/**
 * @param {string} code
 * @param {string} reason
 * @returns {ResultadoDeInventario}
 */
function falha(code, reason) {
  return { ok: false, code, reason, transferId: null, duplicate: false, legs: [], items: [] };
}

/**
 * @param {string} transferId
 * @param {boolean} duplicate
 * @param {PernaResolvida[]} legs
 * @returns {ResultadoDeInventario}
 */
function sucesso(transferId, duplicate, legs) {
  return {
    ok: true, code: null, reason: null,
    transferId, duplicate, legs,
    items: legs.length > 0 ? legs[0].items : []
  };
}

/**
 * Move item entre **vários pares** de donos, numa transação só.
 *
 * ─── Por que a primitiva é esta, e não `transfer` ───────────────────────────
 *
 * As duas operações que motivaram este arquivo têm mais de uma perna, em
 * direções diferentes:
 *
 *   - **Craft** consome ingredientes (personagem → `system:consume`) e entrega
 *     o resultado (`system:craft` → personagem). Duas chamadas de `transfer`
 *     seriam duas transações — exatamente o defeito que o `craftItem` levou até
 *     a Fase 3, com o jogador perdendo o ingrediente e não recebendo nada.
 *   - **Troca** move os itens de A para B *e* os de B para A. Se as duas pernas
 *     não commitam juntas, uma delas é doação.
 *
 * `transfer` continua existindo porque a maioria das chamadas tem uma perna só,
 * e é ela que se lê melhor no lugar de chamada.
 *
 * @param {object} opts
 * @param {Array<{from: object, to: object, items: any}>} opts.legs
 * @param {string} opts.reason    motivo curto, vai para o razão
 * @param {string} opts.module    módulo de origem
 * @param {string} opts.requestId chave de idempotência — **obrigatória**
 * @returns {Promise<ResultadoDeInventario>}
 */
async function exchange(opts) {
  const { legs: legsRaw, reason, module: mod, requestId } = opts || {};

  // ── Validação fora da transação ──────────────────────────────────────────
  // Tudo o que dá para recusar sem tocar no banco é recusado antes de pegar
  // conexão do pool. Um payload malformado não deve custar um `getConnection`.

  if (!Array.isArray(legsRaw) || legsRaw.length === 0) {
    return falha('EMPTY', 'Nenhuma perna na transferencia.');
  }
  if (legsRaw.length > MAX_LEGS) {
    return falha('TOO_MANY', `Maximo de ${MAX_LEGS} pernas por transferencia.`);
  }
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    return falha('INVALID_REQUEST_ID', 'Identificador de pedido invalido.');
  }
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 64) {
    return falha('INVALID_REASON', 'Motivo invalido.');
  }
  if (typeof mod !== 'string' || !mod.trim() || mod.length > 32) {
    return falha('INVALID_MODULE', 'Modulo invalido.');
  }

  /** @type {Array<{from: object, to: object, items: Array<{baseId:number, quantity:number}>}>} */
  const legs = [];
  let totalItens = 0;

  for (const bruta of legsRaw) {
    const from = bruta && bruta.from;
    const to = bruta && bruta.to;

    if (!from || !to || typeof from !== 'object' || typeof to !== 'object') {
      return falha('INVALID_OWNER', 'Dono de origem ou destino ausente.');
    }
    if (ownerLib.isSame(from, to)) {
      return falha('SAME_OWNER', 'Origem e destino sao o mesmo dono.');
    }
    for (const lado of [from, to]) {
      if (!ownerLib.isVoid(lado) && !_adapters.has(lado.type)) {
        // Mesma resposta do Interaction Framework para tipo de alvo sem
        // resolvedor: fechada, nomeada, sem ensinar a sondar o servidor.
        console.warn(`[inventory] sem adaptador para dono '${lado.type}'`);
        return falha('NO_ADAPTER', 'Tipo de dono nao suportado.');
      }
    }

    const normalizados = normalizeItems(bruta.items);
    if (!normalizados.ok) return falha(normalizados.code, normalizados.reason);

    totalItens += normalizados.items.length;
    if (totalItens > MAX_ITEMS_PER_TRANSFER) {
      return falha('TOO_MANY', `Maximo de ${MAX_ITEMS_PER_TRANSFER} itens por transferencia.`);
    }

    legs.push({ from, to, items: normalizados.items });
  }

  // ── Ordem global de lock ─────────────────────────────────────────────────
  //
  // Uma transferência A→B e outra B→A rodando ao mesmo tempo travariam em
  // ordem oposta e fariam deadlock. Ordenar as operações por (chave do dono,
  // base_id) dá a **toda** transferência do servidor a mesma ordem de aquisição
  // de lock, o que torna o ciclo impossível em vez de improvável.
  //
  // O `Map` acumula deltas do mesmo (dono, item) vindos de pernas diferentes:
  // uma troca em que os dois lados oferecem a mesma poção precisa de **um**
  // lock por lado, não de dois, senão a segunda espera a primeira dentro da
  // própria transação.
  /** @type {Map<string, {owner: object, baseId: number, delta: number}>} */
  const porLinha = new Map();
  for (const leg of legs) {
    for (const item of leg.items) {
      for (const [dono, delta] of [[leg.from, -item.quantity], [leg.to, item.quantity]]) {
        if (ownerLib.isVoid(dono)) continue;
        const chave = `${ownerLib.key(dono)}|${item.baseId}`;
        const existente = porLinha.get(chave);
        if (existente) existente.delta += delta;
        else porLinha.set(chave, { owner: dono, baseId: item.baseId, delta });
      }
    }
  }

  const operacoes = [...porLinha.values()]
    .filter(op => op.delta !== 0)
    .sort((a, b) => {
      const ka = ownerLib.key(a.owner);
      const kb = ownerLib.key(b.owner);
      return ka === kb ? a.baseId - b.baseId : ka.localeCompare(kb);
    });

  const transferId = uuid();
  const ancora = ledgerKey(requestId, 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── Replay DENTRO da transação ─────────────────────────────────────────
    //
    // Auditoria §7: `giveItem` e `removeItem` conferem a chave por `db.query`,
    // numa conexão diferente da que abre a transação. Duas chamadas
    // concorrentes com a mesma chave leem zero nas duas, ambas seguem, e o
    // `UNIQUE` mata a segunda no INSERT — o item não duplica, mas o retorno
    // vira `false`, e um chamador com compensação (o `addItem` da barraca)
    // devolveria item por uma operação que deu certo.
    //
    // Aqui o `SELECT ... FOR UPDATE` sobre a chave única segura o gap: a
    // segunda chamada **espera** a primeira e depois lê o resultado dela.
    // É o que o `findPurchaseReplay` da barraca já fazia.
    const [replay] = await conn.query(
      'SELECT transfer_id FROM inventory_transactions WHERE idempotency_key = ? FOR UPDATE',
      [ancora]
    );
    if (replay.length > 0) {
      await conn.commit();
      console.log(`[inventory] exchange replay: request=${requestId} transfer=${replay[0].transfer_id}`);
      return sucesso(replay[0].transfer_id, true, legs);
    }

    // Dono existe? Só para tipos que sabem responder. Dentro da transação, para
    // que a resposta ainda valha quando for usada.
    const jaConferidos = new Set();
    for (const leg of legs) {
      for (const lado of [leg.from, leg.to]) {
        if (ownerLib.isVoid(lado)) continue;
        const chave = ownerLib.key(lado);
        if (jaConferidos.has(chave)) continue;
        jaConferidos.add(chave);

        const adapter = _adapters.get(lado.type);
        if (typeof adapter.assertOwner === 'function') {
          const existe = await adapter.assertOwner(conn, lado);
          if (!existe) throw new RegraViolada(`Dono nao encontrado: ${lado.label}`, 'OWNER_NOT_FOUND');
        }
      }
    }

    for (const op of operacoes) {
      await _adapters.get(op.owner.type).applyDelta(conn, op.owner, op.baseId, op.delta);
    }

    // ── Razão: as duas pernas, sempre ──────────────────────────────────────
    //
    // Inclusive a perna `system`. Isso é o que dá ao razão o invariante que ele
    // não tinha: para qualquer `transfer_id`, a soma dos `delta` é zero. Sem a
    // perna do nada, criar e destruir item ficariam indistinguíveis de erro de
    // contabilidade.
    //
    // As linhas são por **perna declarada**, não por linha de banco tocada: uma
    // troca em que os dois lados oferecem a mesma poção mexe numa linha só de
    // cada lado (o `Map` acima somou), mas o razão precisa registrar as duas
    // ofertas, senão o extrato não conta o que aconteceu.
    let indice = 0;
    for (const leg of legs) {
      for (const item of leg.items) {
        for (const [dono, contraparte, delta] of [
          [leg.from, leg.to, -item.quantity],
          [leg.to, leg.from, item.quantity]
        ]) {
          await transactionService.tx.recordInventoryLedger(conn, {
            characterId: dono.type === OWNER_TYPES.CHARACTER ? Number(dono.ref) : null,
            ownerType: dono.type,
            ownerRef: dono.ref,
            counterpartyType: contraparte.type,
            counterpartyRef: contraparte.ref,
            transferId,
            baseId: item.baseId,
            delta,
            reason,
            module: mod,
            idempotencyKey: ledgerKey(requestId, indice++)
          });
        }
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();

    const regra = err instanceof RegraViolada
      || /insuficiente|nao possui|não possui|Pilha cheia|Dono nao encontrado/i.test(err.message);
    if (!regra) {
      // Erro de SQL carrega nome de tabela e coluna. Ele vai para o log, nunca
      // para a tela — mesma correção que a compra em barraca já levou.
      console.error(`[inventory] exchange falhou (${requestId}):`, err.message);
    }
    return falha(
      regra ? (err.code || 'INSUFFICIENT') : 'DB',
      regra ? err.message : 'Nao foi possivel concluir a operacao.'
    );
  } finally {
    conn.release();
  }

  // ── Depois do commit: o cliente ──────────────────────────────────────────
  //
  // O banco já é a fonte de verdade. Uma falha aqui deixa o cliente divergente
  // e é reconciliada no próximo login — nunca desfaz o que commitou.
  for (const leg of legs) {
    for (const item of leg.items) {
      if (leg.from.type === OWNER_TYPES.CHARACTER && leg.from.actorId) {
        transactionService.tx.applyToClient(leg.from.actorId, item.baseId, -item.quantity);
      }
      if (leg.to.type === OWNER_TYPES.CHARACTER && leg.to.actorId) {
        transactionService.tx.applyToClient(leg.to.actorId, item.baseId, item.quantity);
      }
    }
  }

  const resumo = legs.map(l => `${ownerLib.key(l.from)}->${ownerLib.key(l.to)}(${l.items.length})`).join(' ');
  console.log(`[inventory] exchange ${resumo} (${reason}) transfer=${transferId}`);
  return sucesso(transferId, false, legs);
}

/**
 * Move item entre dois donos. A forma de uma perna só do `exchange`, que é o
 * caso da grande maioria das chamadas.
 *
 * @param {object} opts
 * @param {object} opts.from   dono de origem (`core/inventory-owner.js`)
 * @param {object} opts.to     dono de destino
 * @param {Array<{baseId:number, quantity:number}>|{baseId:number, quantity:number}} opts.items
 * @param {string} opts.reason
 * @param {string} opts.module
 * @param {string} opts.requestId
 * @returns {Promise<ResultadoDeInventario>}
 */
function transfer({ from, to, items, reason, module: mod, requestId }) {
  return exchange({ legs: [{ from, to, items }], reason, module: mod, requestId });
}

/**
 * Erro de **regra**, que o jogador pode ver. Separado de erro de infraestrutura,
 * que ele não pode: a distinção existe desde a correção da compra em barraca, e
 * aqui ela ganha um tipo em vez de depender só de casar a mensagem.
 */
class RegraViolada extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = 'RegraViolada';
    this.code = code;
  }
}

/**
 * Cria item. Açúcar sobre `transfer` com origem `system`.
 * @param {{to: object, items: any, source: string, reason: string, module: string, requestId: string}} opts
 */
function mint({ to, items, source, reason, module: mod, requestId }) {
  return transfer({ from: ownerLib.system(source), to, items, reason, module: mod, requestId });
}

/**
 * Destrói item. Açúcar sobre `transfer` com destino `system`.
 * @param {{from: object, items: any, source: string, reason: string, module: string, requestId: string}} opts
 */
function burn({ from, items, source, reason, module: mod, requestId }) {
  return transfer({ from, to: ownerLib.system(source), items, reason, module: mod, requestId });
}

/**
 * Estoque de um item para um dono. Leitura sem transação — serve para montar
 * tela, **nunca** para decidir se a operação cabe: entre esta leitura e a
 * escrita o valor pode mudar, e quem garante é o `FOR UPDATE` do `applyDelta`.
 *
 * @param {object} owner
 * @param {number} baseId
 * @returns {Promise<number>}
 */
async function getStack(owner, baseId) {
  if (ownerLib.isVoid(owner)) return 0;
  const linhas = await list(owner);
  const achado = linhas.find(l => l.baseId === baseId);
  return achado ? achado.count : 0;
}

/**
 * Todo o estoque de um dono.
 * @param {object} owner
 * @returns {Promise<Array<{baseId:number, count:number}>>}
 */
async function list(owner) {
  if (!owner || ownerLib.isVoid(owner)) return [];
  const adapter = _adapters.get(owner.type);
  if (!adapter) return [];
  return adapter.list(db, owner);
}

/**
 * O extrato de um dono: as duas pontas de cada movimento que o tocou.
 *
 * É a query que a auditoria §2 dizia ser impossível — *"este item apareceu de
 * onde?"* — e que a `migration-v14` tornou possível ao dar nome ao outro lado.
 *
 * @param {object} owner
 * @param {number} [limit]
 */
async function history(owner, limit = 50) {
  const teto = Number.isSafeInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
  return db.query(
    `SELECT transaction_id, transfer_id, base_id, delta, reason, module,
            counterparty_type, counterparty_ref, created_at
       FROM inventory_transactions
      WHERE owner_type = ? AND owner_ref = ?
      ORDER BY created_at DESC, transaction_id DESC
      LIMIT ${teto}`,
    [owner.type, owner.ref]
  );
}

/** Só para teste: devolve o registro de adaptadores ao estado de fábrica. */
function _resetAdapters() {
  for (const tipo of [..._adapters.keys()]) {
    if (tipo !== OWNER_TYPES.CHARACTER && tipo !== OWNER_TYPES.CONTAINER) _adapters.delete(tipo);
  }
}

module.exports = {
  // vocabulário
  OWNER_TYPES,
  SYSTEM_SOURCES: ownerLib.SYSTEM_SOURCES,
  owner: ownerLib.owner,
  character: ownerLib.character,
  container: ownerLib.container,
  system: ownerLib.system,

  // movimento
  exchange,
  transfer,
  mint,
  burn,
  MAX_LEGS,

  // leitura
  getStack,
  list,
  history,

  // extensão
  registerAdapter,
  supportedOwnerTypes,

  // utilidades
  newRequestId,
  RegraViolada,
  MAX_ITEMS_PER_TRANSFER,
  MAX_QUANTITY_PER_ITEM,

  // teste
  _normalizeItems: normalizeItems,
  _resetAdapters
};

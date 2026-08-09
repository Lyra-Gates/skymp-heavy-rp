/**
 * core/death-events.js
 *
 * Dono único de `mp.onDeath`, com múltiplos assinantes nomeados.
 *
 * ─── Por que isto existe ─────────────────────────────────────────────────────
 *
 * Até 08/08/2026 o `death-service.js` fazia `mp.onDeath = (actorId, killerId) =>
 * {...}` — atribuição direta, e portanto **posse exclusiva**. Um segundo módulo
 * que precisasse do mesmo evento escreveria por cima, e a falha seria a pior
 * possível: a detecção de morte de jogador pelo caminho primário simplesmente
 * pararia, sem erro, sem log e sem crash. O polling de 2 s que o próprio
 * `death-service` mantém como rede de segurança disfarçaria o buraco com dois
 * segundos de atraso, que é justamente o intervalo pequeno o bastante para
 * ninguém desconfiar.
 *
 * `core/module-registry.js` já tinha escrito, em 06/08/2026, a condição exata
 * para reabrir o assunto de distribuição de eventos de jogo:
 *
 *   > "O gatilho para reabrir isto (…): um segundo módulo que precise de um
 *   > evento de jogo já capturado por outro."
 *
 * O `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.3 registra que mobs hostis é a
 * primeira coisa deste projeto a atender esse gatilho: quando o
 * `hunting-service` existir, ele vai precisar de `mp.onDeath` — o mesmo hook —
 * para um pipeline **separado** (§11.4: um lobo não tem `characterId`, não pode
 * ser socorrido e não pode ser aposentado).
 *
 * ─── Por que um barramento nomeado, e não `descriptor.on` no registry ────────
 *
 * A §7.3 daquele documento sugere `descriptor.on = { death: fn }` opcional no
 * `register()`. Este arquivo diverge, de propósito, por dois motivos:
 *
 *   1. **O registry não conhece `mp`.** Ele é ciclo de vida puro
 *      (`initialize`/`shutdown`/`healthCheck`) e não captura evento nenhum.
 *      Para despachar `onDeath` de lá, o `death-service` teria que chamar de
 *      volta para dentro do registry, que então chamaria os outros módulos —
 *      uma inversão de dependência para a qual não há necessidade hoje.
 *   2. **É o precedente da própria casa.** Quando um segundo consumidor apareceu
 *      de verdade — governança precisando avisar o painel —, a resposta foi
 *      `core/panel-refresh-bus.js`: um barramento pequeno e nomeado, não um canal
 *      genérico. O comentário do registry chama aquilo de "modelo se um terceiro
 *      caso aparecer", e este é o terceiro caso.
 *
 * O canal genérico continua não existindo, e continua não devendo existir até
 * que `onCellChange` (que hoje não tem nenhum consumidor) ganhe um.
 *
 * ─── O que este arquivo NÃO faz ──────────────────────────────────────────────
 *
 * Não filtra, não decide se o morto é jogador ou criatura, e não sabe o que é um
 * mob. Ele entrega `(actorId, killerId)` cru a quem assinou; cada assinante
 * decide em O(1) se o assunto é dele. Esse requisito é da §7.2 do documento de
 * mobs: com fauna ativa este hook passa a disparar constantemente, e **o caminho
 * de morte não pode tocar o banco antes de decidir que interessa**.
 *
 * ─── Procedência ─────────────────────────────────────────────────────────────
 *
 * `mp.onDeath(actorId, killerId)` é **[TESTE OFICIAL]** — `misc/tests/test_isdead.js`
 * upstream, tipado em `types/mp.d.ts`. **Nunca disparou numa sessão real deste
 * servidor** (Etapa 9 do `FASE_0_ROTEIRO.md`). Este barramento não muda isso:
 * ele garante que, quando disparar, chegue a todo mundo que pediu.
 */

// nome do assinante → handler
const _subscribers = new Map();

let _hookInstalled = false;

/**
 * Entrega o evento a cada assinante, isolando falhas.
 *
 * Um assinante que lança **não pode** impedir os outros de rodar: se o
 * `hunting-service` quebrar concedendo loot, a queda do jogador ainda precisa
 * virar DOWNED. É a mesma razão pela qual o `_dispatch` não usa `for...of` com
 * `await` — não há nada assíncrono aqui de propósito; quem precisa de banco
 * dispara a própria promise e trata o próprio erro.
 */
function _dispatch(actorId, killerId) {
  for (const [name, handler] of _subscribers) {
    try {
      handler(actorId, killerId);
    } catch (err) {
      console.error(
        `[death-events] Assinante '${name}' lancou em onDeath: ${err.message}. ` +
        `Os demais assinantes continuam.`
      );
    }
  }
}

/**
 * Instala o hook uma única vez. Idempotente.
 *
 * Chamado por `subscribe()`, não pelo boot: sem assinante não há motivo para
 * ocupar `mp.onDeath`, e o modo de falha aponta para o lado inerte.
 */
function _installHook() {
  if (_hookInstalled) return;
  if (typeof mp === 'undefined') return;

  // Se alguém já atribuiu direto, o barramento está prestes a fazer com o outro
  // exatamente o que existe para impedir. Não dá para recuperar o handler
  // anterior de forma segura (não sabemos o nome nem a ordem), então gritamos.
  if (typeof mp.onDeath === 'function') {
    console.error(
      '[death-events] mp.onDeath JA tinha uma funcao atribuida antes deste barramento. ' +
      'Alguem esta usando `mp.onDeath = ...` direto — o handler anterior sera perdido. ' +
      'Troque aquela atribuicao por deathEvents.subscribe(<nome>, fn).'
    );
  }

  mp.onDeath = (actorId, killerId) => _dispatch(actorId, killerId);
  _hookInstalled = true;
}

/**
 * Registra um consumidor de morte.
 *
 * @param {string} name    Nome do módulo, para o log de erro dizer quem quebrou
 * @param {(actorId: number, killerId: number) => void} handler
 *
 * Lança em nome duplicado de propósito. Registrar duas vezes é erro de
 * programação (um `initialize` chamado duas vezes, ou dois módulos com o mesmo
 * nome), e silenciar isso reintroduz o defeito que este arquivo remove: um
 * handler perdido sem ninguém saber. O `module-registry` captura a exceção,
 * marca o módulo como `FALHOU ao inicializar` e continua o boot — alto e
 * contido, que é o comportamento desejado.
 */
function subscribe(name, handler) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('[death-events] subscribe exige um nome nao-vazio');
  }
  if (typeof handler !== 'function') {
    throw new Error(`[death-events] subscribe('${name}') exige uma funcao`);
  }
  if (_subscribers.has(name)) {
    throw new Error(
      `[death-events] '${name}' ja esta inscrito em onDeath. ` +
      `Inscricao duplicada esconde um handler perdido — foi por isso que este barramento existe.`
    );
  }

  _subscribers.set(name, handler);
  _installHook();
}

/**
 * Remove um assinante. Usado no `shutdown()` dos módulos.
 * @param {string} name
 * @returns {boolean} se havia algo para remover
 */
function unsubscribe(name) {
  return _subscribers.delete(name);
}

/** Quem está escutando agora. Para diagnóstico e teste. */
function subscriberNames() {
  return [..._subscribers.keys()];
}

/**
 * Devolve o barramento ao estado de boot: sem assinantes e sem hook instalado.
 *
 * Existe só para teste, e por um motivo específico: como este módulo é um
 * singleton, um teste que rode depois de outro herda `_hookInstalled = true` e
 * nunca exercita a instalação do hook. É justamente na instalação que mora a
 * proteção contra `mp.onDeath = ...` direto, então sem isto a regressão mais
 * perigosa — o segundo módulo apagando o `death-service` — não é reproduzível.
 */
function _resetForTest() {
  _subscribers.clear();
  _hookInstalled = false;
  if (typeof mp !== 'undefined') delete mp.onDeath;
}

module.exports = {
  subscribe,
  unsubscribe,
  subscriberNames,
  // Exposto só para teste: permite exercitar o despacho sem depender de o mock
  // de `mp` ter sido instalado antes do require.
  _dispatch,
  _resetForTest
};

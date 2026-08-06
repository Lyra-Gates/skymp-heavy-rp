/**
 * core/papyrus.js
 *
 * Helpers para atravessar a ponte Papyrus.
 *
 * ─── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O parâmetro `self` de `mp.callPapyrusFunction('method', ...)` — e qualquer
 * argumento que seja uma referência de objeto — precisa ser um **objeto**
 * `{ type, desc }`, nunca o FormID numérico:
 *
 *     mp.callPapyrusFunction('method', 'Actor', 'Resurrect', actorRef(id), []);
 *
 * Isso não é preferência de estilo. Os nove testes oficiais do SkyMP
 * (`misc/tests/` no repositório upstream) usam **exclusivamente** essa forma,
 * inclusive para argumentos:
 *
 *     mp.callPapyrusFunction("method", "ObjectReference", "RemoveAllItems",
 *         { type: "form", desc: mp.getDescFromId(actorId1) },
 *         [{ type: "form", desc: mp.getDescFromId(actorId2) }, false, false]);
 *
 * Até 05/08/2026 este gamemode misturava as duas formas: 2 arquivos usavam
 * objeto e 22 pontos passavam o FormID cru. Como nada nunca foi testado em
 * jogo e a documentação oficial não fala do assunto, ficou anos sem ninguém
 * perceber — e a suíte de testes passava, porque o `mp` mockado aceita
 * qualquer coisa.
 *
 * O risco concreto era `core/transaction-service.js`: se a forma crua não
 * funciona, o banco registrava a transação e o item nunca chegava no
 * inventário do jogador.
 *
 * ─── `form` vs `espm` ────────────────────────────────────────────────────────
 *
 * `type: 'form'`  → referência que existe no mundo (um ator, um objeto colocado)
 * `type: 'espm'`  → registro base vindo de um plugin (o "molde" de um item)
 *
 * A distinção aparece nos testes oficiais: o ator é `form`, o Gold001 que se
 * adiciona ao inventário dele é `espm`.
 */

/**
 * Referência a algo que existe no mundo — ator ou objeto colocado.
 * É o que vai no `self` de toda chamada `'method'`.
 *
 * @param {number} formId
 * @returns {{type: 'form', desc: string}}
 */
function actorRef(formId) {
  return { type: 'form', desc: mp.getDescFromId(formId) };
}

/**
 * Referência a um registro base de plugin (baseId de item, NPC, etc).
 * Usado como *argumento*, não como `self`.
 *
 * @param {number} baseId
 * @returns {{type: 'espm', desc: string}}
 */
function baseRef(baseId) {
  return { type: 'espm', desc: mp.getDescFromId(baseId) };
}

module.exports = { actorRef, baseRef };

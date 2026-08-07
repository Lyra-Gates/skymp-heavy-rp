/**
 * core/espm.js — leitura dos records dos plugins carregados
 *
 * ─── De onde veio, e como o formato foi descoberto ──────────────────────────
 *
 * `mp.lookupEspmRecordById` apareceu no estudo do Red House
 * (`REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1) — o projeto sabia que ela existia
 * e nunca tinha visto o retorno dela.
 *
 * O formato abaixo **não foi inferido**: foi lido de um servidor real em
 * 06/08/2026, com uma sonda temporária apontada como gamemode. Isso importa
 * porque este projeto já pagou caro duas vezes por assumir formato de API —
 * as 22 chamadas Papyrus com `self` errado (QA 2.13) e o `require('dotenv')`
 * nu, que só apareceram quando algo rodou de verdade.
 *
 *     mp.lookupEspmRecordById(0x0000000f)
 *     // => { record: { id: 15, editorId: 'Gold001', type: 'MISC',
 *     //                flags: 0, fields: [ { type, data }, ... ] },
 *     //      fileIndex: ..., toGlobalRecordId: ... }
 *
 *     mp.lookupEspmRecordById(0x00000014)   // Player, que é referência
 *     // => {}                              ← sem `record`
 *
 *     mp.lookupEspmRecordById(0x7fffffff)   // não existe
 *     // => {}
 *
 * **`{}` é a resposta para "não existe como record de plugin".** Não lança, não
 * devolve null: devolve objeto vazio. É por isso que a checagem aqui é por
 * `r && r.record`, e não por truthiness do retorno — `{}` é truthy.
 *
 * ─── Cache ──────────────────────────────────────────────────────────────────
 *
 * O retorno traz **todos os fields do record em bytes** — um Gold001 já vem com
 * centenas de bytes de EDID, OBND, MODL, MODT. Chamar isso por operação de
 * inventário alocaria lixo à toa, e o dado é imutável enquanto o servidor roda:
 * a load order não muda em runtime.
 *
 * O cache guarda só o que interessa (`type` e `editorId`), não o record cru.
 */

/** baseId → { existe, type, editorId } */
const _cache = new Map();

/**
 * Records do Skyrim que fazem sentido dentro de um inventário.
 *
 * Deliberadamente uma lista de PERMISSÃO, não de bloqueio: um FormID digitado
 * errado cai em qualquer record do jogo — célula, quest, som, perk — e a
 * pergunta certa é "isto é um item?", não "isto é uma das coisas que eu me
 * lembrei de proibir".
 */
const TIPOS_DE_INVENTARIO = new Set([
  'WEAP', // arma
  'ARMO', // armadura e roupa
  'MISC', // diverso (ouro, minério, ossos)
  'ALCH', // poção e comida
  'AMMO', // flecha e virote
  'BOOK', // livro e pergaminho de feitiço
  'INGR', // ingrediente de alquimia
  'KEYM', // chave
  'SLGM', // pedra de alma
  'SCRL', // pergaminho
  'LIGH'  // tocha (é carregável)
]);

/**
 * @typedef {object} RecordConsultado
 * @property {boolean} existe
 * @property {string|null} type      tag de 4 letras do record (WEAP, ARMO, ...)
 * @property {string|null} editorId
 * @property {boolean} [indisponivel] a API não respondeu — "não sei", que é
 *   diferente de "não existe". Ver `pareceItem`.
 */

/**
 * Consulta o record de um FormID nos plugins carregados.
 *
 * @param {number} baseId
 * @returns {RecordConsultado}
 */
function lookup(baseId) {
  if (!Number.isFinite(baseId)) return { existe: false, type: null, editorId: null };

  const cacheado = _cache.get(baseId);
  if (cacheado) return cacheado;

  let resultado = { existe: false, type: null, editorId: null };

  if (typeof mp !== 'undefined' && typeof mp.lookupEspmRecordById === 'function') {
    try {
      const r = mp.lookupEspmRecordById(baseId);
      // `{}` quando nao existe — por isso `r.record` e nao `r`.
      if (r && r.record) {
        resultado = {
          existe: true,
          type: r.record.type || null,
          editorId: r.record.editorId || null
        };
      }
    } catch (err) {
      // Falha de leitura nao pode virar "o item nao existe", senao uma
      // instabilidade da API bloquearia operacao legitima. Fica desconhecido,
      // e quem chama decide (ver `pareceItem`).
      console.error(`[espm] Falha ao consultar 0x${baseId.toString(16)}:`, err.message);
      return { existe: false, type: null, editorId: null, indisponivel: true };
    }
  } else {
    // Sem `mp` (teste) ou sem a funcao (servidor antigo): nao da pra afirmar
    // nada. Marcado como indisponivel pra que a validacao nao vire bloqueio.
    return { existe: false, type: null, editorId: null, indisponivel: true };
  }

  _cache.set(baseId, resultado);
  return resultado;
}

/**
 * O FormID é um item que faz sentido num inventário?
 *
 * **Devolve `true` quando não dá pra saber.** Isso é deliberado: a função
 * existe pra pegar erro de digitação, não pra ser uma autoridade. Se a API não
 * estiver disponível — servidor antigo, ambiente de teste — bloquear seria
 * transformar uma melhoria de diagnóstico numa quebra de funcionalidade.
 *
 * O único caso em que nega é aquele em que tem certeza: a API respondeu, e
 * respondeu que aquele FormID não é um item.
 *
 * @param {number} baseId
 * @returns {{ok: boolean, motivo?: string, type?: string, editorId?: string}}
 */
function pareceItem(baseId) {
  const r = lookup(baseId);

  if (r.indisponivel) return { ok: true };

  if (!r.existe) {
    return {
      ok: false,
      motivo: `0x${Number(baseId).toString(16)} nao existe nos plugins carregados`
    };
  }

  if (!TIPOS_DE_INVENTARIO.has(r.type)) {
    return {
      ok: false,
      motivo: `0x${Number(baseId).toString(16)} e ${r.type}${r.editorId ? ` (${r.editorId})` : ''}, que nao vai pra inventario`,
      type: r.type,
      editorId: r.editorId
    };
  }

  return { ok: true, type: r.type, editorId: r.editorId };
}

/** Nome de editor do record, pra log e auditoria legíveis. */
function editorIdOf(baseId) {
  return lookup(baseId).editorId;
}

module.exports = {
  TIPOS_DE_INVENTARIO,
  lookup,
  pareceItem,
  editorIdOf,
  _limparCache: () => _cache.clear()
};

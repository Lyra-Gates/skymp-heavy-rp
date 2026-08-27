/**
 * core/physical-anchor-registry.js
 *
 * Tarefa 11 — a peça que faltava pro prompt `[E]` cobrir objetos (Depot),
 * não só atores. Mesmo espírito de `interaction-registry.js`: o core não
 * conhece Depot, Depot é quem se registra aqui.
 *
 * ─── Por que isto existe, e não uma varredura genérica de objetos ──────────
 *
 * Não existe em lugar nenhum do projeto (nem no SkyMP, verificado contra a
 * documentação oficial antes desta tarefa) uma função "liste objetos perto
 * do ponto X" — o motor não expõe isso sem fork. O que EXISTE são tabelas
 * pequenas, curadas por staff, de âncoras físicas conhecidas — `depot_
 * terminals` é a primeira. Este arquivo é o ponto único onde um módulo
 * desses se anuncia, pra `interaction-prompt-service.js` saber quem
 * perguntar, sem importar `depot-service.js` diretamente (o core não pode
 * conhecer um módulo lab por nome).
 *
 * ─── Contrato do provider ────────────────────────────────────────────────
 *
 * `{ targetType: string, list: () => Promise<Array<{targetId: number}>> }`
 *
 * `list()` devolve TODAS as âncoras daquele tipo — a filtragem por distância
 * é do chamador (`interaction-prompt-service.js`), porque só ele sabe de
 * quem está perguntando. `targetId` já precisa vir como FormID numérico
 * (resolvido de FormDesc por quem registrou — `mp.getIdFromDesc`), porque é
 * o formato que `interaction-service.peek`/`range-utils` esperam.
 */

'use strict';

/** @type {Array<{targetType: string, list: Function}>} */
const _providers = [];
let _snapshot = new Map();

/**
 * @param {{targetType: string, list: () => Promise<Array<{targetId: number}>>}} provider
 */
function register(provider) {
  if (!provider || typeof provider.list !== 'function' || typeof provider.targetType !== 'string') {
    throw new Error('[physical-anchor-registry] provider precisa de targetType (string) e list() (function).');
  }
  _providers.push(provider);
}

/**
 * Reconstrói o índice síncrono usado por `mp.onActivate`. O hook nativo não
 * pode esperar banco; por isso módulos carregam seus anchors no boot e a
 * ativação faz somente uma consulta O(1) neste snapshot.
 */
async function refresh() {
  const next = new Map();
  for (const anchor of await listAll()) {
    if (!next.has(anchor.targetId)) next.set(anchor.targetId, anchor.targetType);
  }
  _snapshot = next;
  return _snapshot.size;
}

function getTargetType(targetId) {
  return Number.isSafeInteger(targetId) ? (_snapshot.get(targetId) || null) : null;
}

function has(targetId) {
  return getTargetType(targetId) !== null;
}

/**
 * Todas as âncoras de todos os providers registrados, achatadas numa lista
 * só. Um provider que lança não derruba os outros — mesmo critério de
 * `canSee` em `interaction-service.js`: um módulo com bug não trava o resto.
 * @returns {Promise<Array<{targetId: number, targetType: string}>>}
 */
async function listAll() {
  const resultado = [];
  for (const provider of _providers) {
    try {
      const ancoras = await provider.list();
      for (const a of ancoras || []) {
        if (a && Number.isSafeInteger(a.targetId)) {
          resultado.push({ targetId: a.targetId, targetType: provider.targetType });
        }
      }
    } catch (err) {
      console.error(`[physical-anchor-registry] provider de '${provider.targetType}' falhou:`, err.message);
    }
  }
  return resultado;
}

/** Só para teste. */
function _reset() {
  _providers.length = 0;
  _snapshot = new Map();
}

module.exports = { register, listAll, refresh, getTargetType, has, _reset };

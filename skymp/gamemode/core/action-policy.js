/**
 * core/action-policy.js
 *
 * Política central de ações — a única fonte de verdade sobre
 * "quem pode fazer o quê em qual estado".
 *
 * TODA ação de gameplay DEVE ser validada aqui antes de executar.
 * Nenhum serviço individual deve implementar suas próprias verificações de estado.
 *
 * Uso:
 *   const { allowed, reason } = actionPolicy.canPerform(characterId, 'woodcutting');
 *   if (!allowed) { sendNotification(actorId, reason); return; }
 */

const characterState = require('./character-state');
// Toca `mp` (com guard) e le config de disco; por isso fica em modulo proprio
// em vez de dentro deste, que precisa continuar testavel sem servidor.
const safeZones = require('./safe-zones');
const { STATES } = characterState;

// ─────────────────────────────────────────────────────────────────────────────
// Definição das restrições por estado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapa de estados → lista de categorias de ação BLOQUEADAS naquele estado.
 * Uma ação pode pertencer a múltiplas categorias.
 */
const STATE_RESTRICTIONS = {
  [STATES.RESTRAINED]: {
    blocked: ['gameplay', 'combat', 'trade', 'craft', 'gather', 'move', 'use_item'],
    message: 'Você está algemado e não pode realizar essa ação.'
  },
  [STATES.IMPRISONED]: {
    blocked: ['trade', 'craft', 'gather', 'work', 'combat', 'move_world', 'sell'],
    message: 'Você está preso e não pode realizar essa ação.'
  },
  [STATES.DOWNED]: {
    blocked: ['gameplay', 'combat', 'trade', 'craft', 'gather', 'move', 'use_item', 'speak_rp'],
    message: 'Você está abatido e não pode agir. Aguarde socorro.'
  },
  [STATES.DEAD]: {
    blocked: ['gameplay', 'combat', 'trade', 'craft', 'gather', 'move', 'use_item', 'speak_rp'],
    message: 'Você está morto.'
  },
  [STATES.IN_TRADE]: {
    blocked: ['gather', 'work', 'craft', 'combat', 'move_world'],
    message: 'Você está em uma negociação. Cancele antes de realizar essa ação.'
  },
  [STATES.IN_CRAFT]: {
    blocked: ['gather', 'work', 'trade', 'combat', 'move_world'],
    message: 'Você está fabricando um item. Conclua ou cancele antes.'
  },
  [STATES.IN_DIALOG]: {
    blocked: ['gather', 'work', 'trade', 'craft', 'combat'],
    message: 'Você está em um diálogo. Conclua-o antes.'
  },
  [STATES.BUSY]: {
    blocked: ['gather', 'work', 'craft', 'trade', 'combat'],
    message: 'Você está ocupado com outra atividade.'
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Registro de ações
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registro central de ações e suas categorias.
 * Cada ação pertence a uma ou mais categorias usadas nas restrições acima.
 *
 * Estrutura: actionId → { categories: string[], label: string }
 */
const _actions = new Map();

/**
 * Registra uma ação na política.
 * Chamado pelos módulos ao se inicializar via module-registry.
 *
 * @param {string} actionId - Identificador único da ação (ex: 'woodcutting')
 * @param {string[]} categories - Categorias da ação (ex: ['gameplay', 'gather'])
 * @param {string} label - Nome legível para mensagens de erro
 */
function registerAction(actionId, categories, label) {
  _actions.set(actionId, { categories, label });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ações CORE pré-registradas (sempre disponíveis)
// ─────────────────────────────────────────────────────────────────────────────
registerAction('speak',       ['speak_rp'],           'Falar');
registerAction('whisper',     ['speak_rp'],           'Sussurrar');
registerAction('shout',       ['speak_rp'],           'Gritar');
registerAction('me',          ['speak_rp'],           '/me');
registerAction('do',          ['speak_rp'],           '/do');
registerAction('try',         ['speak_rp'],           '/try');
registerAction('introduce',   ['speak_rp'],           'Apresentar-se');
registerAction('alias',       ['speak_rp'],           'Dar apelido');
registerAction('woodcutting', ['gameplay', 'gather'], 'Cortar madeira');
registerAction('mining',      ['gameplay', 'gather'], 'Minerar');
registerAction('fishing',     ['gameplay', 'gather'], 'Pescar');
registerAction('craft',       ['gameplay', 'craft'],  'Fabricar');
registerAction('trade',       ['gameplay', 'trade'],  'Negociar');
registerAction('sell',        ['gameplay', 'sell'],   'Vender');
registerAction('buy',         ['gameplay', 'sell'],   'Comprar');
registerAction('move_world',  ['move', 'move_world'], 'Mover entre células');
registerAction('use_item',    ['use_item'],            'Usar item');
registerAction('eat',         ['use_item'],            'Comer');
registerAction('drink',       ['use_item'],            'Beber');
registerAction('sleep',       ['use_item'],            'Dormir');
registerAction('public_work', ['gameplay', 'work'],    'Trabalho público');

// ─────────────────────────────────────────────────────────────────────────────
// API Pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica se um personagem pode executar uma ação.
 *
 * Duas dimensões, nesta ordem:
 *
 *   1. **Estado** do personagem — algemado, abatido, preso. Sempre checado.
 *   2. **Lugar** onde ele está — zona segura. Só checado quando quem chama
 *      informa `context.actorId`, porque localização é do ator e esta função
 *      recebe `characterId`.
 *
 * O estado vem primeiro de propósito: "você está algemado" é uma explicação
 * melhor que "aqui é zona segura" para quem está algemado dentro de uma.
 *
 * @param {number} characterId
 * @param {string} actionId - ID da ação registrada
 * @param {object} [context]
 * @param {number} [context.actorId] - habilita a checagem de lugar
 * @param {number} [context.targetActorId] - checa os dois lados (ver safe-zones.blocksBetween)
 * @returns {{ allowed: boolean, reason: string }}
 */
function canPerform(characterId, actionId, context = {}) {
  const action = _actions.get(actionId);
  if (!action) {
    // Ação não registrada — bloquear por segurança
    return { allowed: false, reason: `Ação desconhecida: ${actionId}` };
  }

  const currentState = characterState.get(characterId);
  const restrictions = STATE_RESTRICTIONS[currentState];

  if (restrictions) {
    // Verificar se alguma categoria da ação está bloqueada pelo estado atual
    const isBlocked = action.categories.some(cat => restrictions.blocked.includes(cat));
    if (isBlocked) {
      return { allowed: false, reason: restrictions.message };
    }
  }

  // Lugar. Só entra quando o chamador passa o actorId — todos os chamadores
  // antigos continuam funcionando exatamente como antes, sem checagem de lugar.
  if (context.actorId !== undefined && context.actorId !== null) {
    for (const categoria of action.categories) {
      const veredito = context.targetActorId !== undefined && context.targetActorId !== null
        ? safeZones.blocksBetween(context.actorId, context.targetActorId, categoria)
        : safeZones.blocksCategory(context.actorId, categoria);

      if (veredito.blocked) {
        // A mensagem diz de quem é a proteção quando ela não é de quem agiu —
        // sem isso, atacar alguém protegido devolveria "você está em zona
        // segura", que é confuso e parece bug.
        const onde = veredito.zone.label;
        return {
          allowed: false,
          reason: veredito.side === 'target'
            ? `Seu alvo está sob proteção de ${onde}.`
            : `Você está em ${onde} e não pode fazer isso aqui.`
        };
      }
    }
  }

  return { allowed: true, reason: '' };
}

/**
 * Verifica uma ação e lança erro se não permitida.
 * Útil para código que prefere exceções.
 *
 * @param {number} characterId
 * @param {string} actionId
 * @param {object} [context]
 * @throws {Error} Se a ação não for permitida
 */
function assertCanPerform(characterId, actionId, context = {}) {
  const result = canPerform(characterId, actionId, context);
  if (!result.allowed) throw new Error(result.reason);
}

/**
 * Retorna todas as ações registradas (para debug/staff).
 */
function listActions() {
  return Array.from(_actions.entries()).map(([id, info]) => ({ id, ...info }));
}

module.exports = { canPerform, assertCanPerform, registerAction, listActions };

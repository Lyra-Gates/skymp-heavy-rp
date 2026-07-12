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
    blocked: ['trade', 'craft', 'gather', 'combat', 'move_world', 'sell'],
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
    blocked: ['gather', 'craft', 'combat', 'move_world'],
    message: 'Você está em uma negociação. Cancele antes de realizar essa ação.'
  },
  [STATES.IN_CRAFT]: {
    blocked: ['gather', 'trade', 'combat', 'move_world'],
    message: 'Você está fabricando um item. Conclua ou cancele antes.'
  },
  [STATES.IN_DIALOG]: {
    blocked: ['gather', 'trade', 'craft', 'combat'],
    message: 'Você está em um diálogo. Conclua-o antes.'
  },
  [STATES.BUSY]: {
    blocked: ['gather', 'craft', 'trade', 'combat'],
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

// ─────────────────────────────────────────────────────────────────────────────
// API Pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica se um personagem pode executar uma ação.
 *
 * @param {number} characterId
 * @param {string} actionId - ID da ação registrada
 * @param {object} [context] - Contexto adicional (localização, alvo, etc.) para validações futuras
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

/**
 * survival-service.js
 * Sistema de Sobrevivência Leve (Fase Beta).
 *
 * Princípios de Design (do backlog):
 * - NÃO punitivo. Fome/sede/fadiga criam CONTEXTO DE RP, não punição de gameplay.
 * - Penalidades são suaves: -10% de stamina regeneration, -5% carry weight, etc.
 * - O loop de tick roda a cada 5 minutos para reduzir os stats gradualmente.
 * - Alertas in-game com Notificação nativa do Skyrim para criar imersão.
 */

const db = require('./database');
const commands = require('./commands');

// Cache em memoria: characterId -> { hunger, thirst, fatigue, actorId }
const survivalCache = new Map();

// Taxas de decaimento por tick (5 minutos)
const DECAY = {
  hunger:  4.0,  // Perde 4% de fome por tick
  thirst:  6.0,  // Perde 6% de sede (mais urgente)
  fatigue: 3.0   // Perde 3% de energia
};

// Thresholds de alerta (%)
const ALERT = {
  hunger:  30,
  thirst:  25,
  fatigue: 20
};

let tickTimer = null;

function startSurvivalService() {
  if (tickTimer) return;
  tickTimer = setInterval(tickSurvival, 5 * 60 * 1000); // 5 min
  console.log('[survival] Survival service started (5min tick).');
}

/**
 * Carrega o estado de sobrevivencia de um personagem do banco para o cache.
 */
async function loadCharacter(actorId, characterId) {
  let rows = await db.query('SELECT * FROM character_survival WHERE character_id = ?', [characterId]);
  if (rows.length === 0) {
    await db.query('INSERT IGNORE INTO character_survival (character_id) VALUES (?)', [characterId]);
    rows = [{ character_id: characterId, hunger: 100, thirst: 100, fatigue: 100 }];
  }
  survivalCache.set(characterId, {
    actorId,
    hunger:  rows[0].hunger,
    thirst:  rows[0].thirst,
    fatigue: rows[0].fatigue
  });
  console.log(`[survival] Loaded survival for char ${characterId}: H=${rows[0].hunger} T=${rows[0].thirst} F=${rows[0].fatigue}`);
}

/**
 * Remove do cache ao deslogar (e persiste no banco).
 */
async function unloadCharacter(characterId) {
  const s = survivalCache.get(characterId);
  if (!s) return;
  await saveSurvival(characterId, s);
  survivalCache.delete(characterId);
}

/**
 * Tick: aplica decaimento e efeitos de jogo.
 */
async function tickSurvival() {
  for (const [charId, s] of survivalCache.entries()) {
    s.hunger  = Math.max(0, s.hunger  - DECAY.hunger);
    s.thirst  = Math.max(0, s.thirst  - DECAY.thirst);
    s.fatigue = Math.max(0, s.fatigue - DECAY.fatigue);

    // Aplica efeitos suaves no Papyrus
    if (typeof mp !== 'undefined' && s.actorId) {
      applyPenalties(s.actorId, s);
      sendAlerts(s.actorId, s);
    }

    // Persiste no banco a cada tick
    await saveSurvival(charId, s);
  }
}

/**
 * Aplica penalidades de atributo (suaves, não punitivas).
 */
function applyPenalties(actorId, s) {
  // Stamina regeneration reduzida pela fadiga
  const staminaMult = 0.5 + (s.fatigue / 200); // 50%~100%
  mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', actorId, ['StaminaRate', staminaMult * 5]);

  // Carry weight reduzida pela fome
  if (s.hunger < 20) {
    mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', actorId, ['CarryWeight', 200]);
  } else {
    mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', actorId, ['CarryWeight', 300]);
  }
}

/**
 * Envia alertas narrativos (em vez de HUD seco).
 */
function sendAlerts(actorId, s) {
  const msgs = [];
  if (s.hunger <= ALERT.hunger)  msgs.push('Seu estômago ronca. Você precisa comer.');
  if (s.thirst <= ALERT.thirst)  msgs.push('Sua boca está seca. Você precisa beber.');
  if (s.fatigue <= ALERT.fatigue) msgs.push('Seus olhos pesam. Você precisa descansar.');

  for (const msg of msgs) {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [msg]);
  }
}

async function saveSurvival(characterId, s) {
  await db.query(
    'UPDATE character_survival SET hunger=?, thirst=?, fatigue=? WHERE character_id=?',
    [Math.round(s.hunger * 10) / 10, Math.round(s.thirst * 10) / 10, Math.round(s.fatigue * 10) / 10, characterId]
  );
}

// ── Ações do Jogador ──────────────────────────────────────────────────────────

/**
 * Consumir comida: /eat [item_name] — Restaura fome.
 * BaseIDs de alimentos básicos (vanilla Skyrim).
 */
const FOOD_ITEMS = {
  0x00064B39: { name: 'Queijo',       hunger: 20, thirst: 5  },
  0x0007EC0B: { name: 'Pão',          hunger: 15, thirst: -5 },
  0x0009E1A2: { name: 'Torta',        hunger: 30, thirst: 5  },
  0x00033760: { name: 'Lenha', hunger: 0, thirst: 0 }  // Não comestível (proteção)
};

const DRINK_ITEMS = {
  0x0003E7A8: { name: 'Água',        thirst: 40, fatigue: 5  },
  0x0003A7A5: { name: 'Cerveja',     thirst: 20, fatigue: -10 }, // Cerveja cansa
  0x000B5D46: { name: 'Hydromel',    thirst: 25, fatigue: -5  }
};

async function eatItem(actorId, characterId, baseId) {
  const food = FOOD_ITEMS[baseId];
  if (!food || food.hunger === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não pode comer isto.']);
    return;
  }

  const inventoryService = require('./inventory-service');
  const has = await inventoryService.hasItem(characterId, baseId, 1);
  if (!has) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você não tem ${food.name}.`]);
    return;
  }

  await inventoryService.removeItem(actorId, characterId, baseId, 1);

  const s = survivalCache.get(characterId);
  if (s) {
    s.hunger  = Math.min(100, s.hunger  + food.hunger);
    s.thirst  = Math.min(100, s.thirst  + (food.thirst || 0));
    await saveSurvival(characterId, s);
  }

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você come ${food.name}. Sente-se um pouco melhor.`]);
  }
}

async function drinkItem(actorId, characterId, baseId) {
  const drink = DRINK_ITEMS[baseId];
  if (!drink) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você não pode beber isto.']);
    return;
  }

  const inventoryService = require('./inventory-service');
  const has = await inventoryService.hasItem(characterId, baseId, 1);
  if (!has) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você não tem ${drink.name}.`]);
    return;
  }

  await inventoryService.removeItem(actorId, characterId, baseId, 1);

  const s = survivalCache.get(characterId);
  if (s) {
    s.thirst  = Math.min(100, s.thirst  + drink.thirst);
    s.fatigue = Math.min(100, s.fatigue + (drink.fatigue || 0));
    await saveSurvival(characterId, s);
  }

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você bebe ${drink.name}.`]);
  }
}

/**
 * /sleep — Descansa (só em camas autorizadas no futuro, por ora qualquer interior).
 */
async function sleep(actorId, characterId) {
  const s = survivalCache.get(characterId);
  if (!s) return;

  // Recarrega fatigue completamente
  s.fatigue = 100;
  s.hunger  = Math.max(0, s.hunger - 10); // Dormir dá fome
  await saveSurvival(characterId, s);

  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você acorda descansado. Mas está com fome...']);
  }
  commands.broadcastProximityMessage(actorId, '* Deita e descansa por um momento.', 300);
}

/**
 * /survival — Exibe seu status atual.
 */
function showSurvival(actorId, characterId) {
  const s = survivalCache.get(characterId);
  if (!s) return;
  const msg = `Fome: ${Math.round(s.hunger)}% | Sede: ${Math.round(s.thirst)}% | Energia: ${Math.round(s.fatigue)}%`;
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [msg]);
}

module.exports = {
  startSurvivalService,
  loadCharacter,
  unloadCharacter,
  eatItem,
  drinkItem,
  sleep,
  showSurvival
};

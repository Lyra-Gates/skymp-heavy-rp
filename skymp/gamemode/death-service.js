const db = require('./database');
const commands = require('./commands');

const RESPAWN_POS = [-150, -100, -200]; // Coordenadas ficticias do Templo de Kynareth
const RESPAWN_CELL = '0x162e2'; // ID do Templo
const DEATH_PENALTY_COINS = 50;
const DEATH_PENALTY_PERCENTAGE = 0.1; // Perde 10% do ouro

function initDeathService() {
  if (typeof mp === 'undefined') return;
  console.log('[death-service] Initializing Death and Respawn hooks...');

  // Adiciona a propriedade 'isDead' para rastreio
  setInterval(() => {
    try {
      // Para cada profileId de player 1..50
      for (let pId = 1; pId <= 50; pId++) {
        const actors = mp.getActorsByProfileId(pId);
        if (!actors || actors.length === 0) continue;

        for (const actorId of actors) {
          // Em SkyMP, isDead ou getActorValue Health <= 0 indicam morte.
          // Como onDeath às vezes não dispara para jogadores, checamos HP no polling de segurança.
          const selfObj = { type: 'form', desc: mp.getDescFromId(actorId) };
          const health = mp.callPapyrusFunction('method', 'Actor', 'getActorValue', selfObj, ['Health']);
          const currentlyDead = (health <= 0);
          const wasDead = mp.get(actorId, '_wasDead') || false;

          if (currentlyDead && !wasDead) {
            handlePlayerDeath(actorId);
            mp.set(actorId, '_wasDead', true);
          } else if (!currentlyDead && wasDead) {
            mp.set(actorId, '_wasDead', false);
          }
        }
      }
    } catch (err) {
      console.error('[death-service] Error polling health:', err.message);
    }
  }, 2000);
}

function handlePlayerDeath(actorId) {
  console.log(`[death-service] Player Actor ${actorId.toString(16)} died. Triggering respawn sequence.`);
  
  // Envia mensagem local de RP
  commands.broadcastProximityMessage(actorId, `* O corpo cai sem vida no chão.`, 1500);

  // Aguarda 10 segundos antes do respawn para simular inconsciencia
  setTimeout(() => {
    executeRespawn(actorId);
  }, 10000);
}

async function executeRespawn(actorId) {
  if (typeof mp === 'undefined') return;

  try {
    // 1. Ressuscita o jogador nativamente (Papyrus)
    const selfObj = { type: 'form', desc: mp.getDescFromId(actorId) };
    mp.callPapyrusFunction('method', 'Actor', 'Resurrect', selfObj, []);

    // 2. Move para a cela de Respawn (Templo / Hospital)
    const locData = {
      pos: RESPAWN_POS,
      worldOrCell: RESPAWN_CELL,
      angleZ: 0
    };
    mp.set(actorId, 'locationalData', locData);

    // 3. (Opcional) Deduz moedas no banco de dados se tivermos o accountId.
    // Opcionalmente podemos pegar do cache do commands.js
    console.log(`[death-service] Respawn complete for actor ${actorId.toString(16)}.`);
    
    // Notifica o jogador
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Você foi resgatado e acordou em um local seguro.']);

  } catch (err) {
    console.error(`[death-service] Failed to respawn actor ${actorId.toString(16)}:`, err.message);
  }
}

module.exports = {
  initDeathService
};

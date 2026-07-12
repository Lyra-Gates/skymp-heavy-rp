const path = require('path');

// Como o SkyMP copia o arquivo de entrada para um diretorio temporario do Windows no boot,
// precisamos resolver o caminho original do gamemode de forma absoluta usando process.cwd().
const gamemodeDir = path.resolve(process.cwd(), '../gamemode');

const db            = require(path.join(gamemodeDir, 'database'));
const whitelist     = require(path.join(gamemodeDir, 'whitelist'));
const commands      = require(path.join(gamemodeDir, 'commands'));

console.log("[phase0] SkyMP Heavy RP gamemode loaded");

function envEnabled(name) {
  return process.env[name] === 'true';
}

// Inicializa o Pool do Banco de Dados e Serviços
try {
  db.init();
  console.log("[phase0] Database pool initialized");

  if (envEnabled('ENABLE_NPC_CLEANER')) {
    require(path.join(gamemodeDir, 'npc-cleaner')).startWorldCleaner();
  }
  if (envEnabled('ENABLE_DEATH_SERVICE')) {
    require(path.join(gamemodeDir, 'death-service')).initDeathService();
  }
  if (envEnabled('ENABLE_JUSTICE_SERVICE')) {
    const justiceService = require(path.join(gamemodeDir, 'justice-service'));
    justiceService.startJusticeService();
    justiceService.restoreActivePrisoners();
  }
  if (envEnabled('ENABLE_VOIP_SERVICE')) {
    require(path.join(gamemodeDir, 'voip-service')).startVoipServer(7778);
  }
  if (envEnabled('ENABLE_SURVIVAL_SERVICE')) {
    require(path.join(gamemodeDir, 'survival-service')).startSurvivalService();
  }
  if (envEnabled('ENABLE_REGIONAL_ECONOMY')) {
    require(path.join(gamemodeDir, 'economy-regional')).initRegionalEconomy();
  }
  if (envEnabled('ENABLE_FACTION_SERVICE')) {
    require(path.join(gamemodeDir, 'faction-service')).initFactionService();
  }
} catch (err) {
  console.error("[phase0] Fatal: Could not initialize database or services:", err.message);
}

// Hook de Evento do Chat (CEF uiEvent)
if (typeof mp !== "undefined") {
  console.log("[phase0] mp API available");

  // Registra as propriedades da interface CEF/Browser para o SkyMP
  mp.makeProperty('browserVisible', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: 'ctx.sp.browser.setVisible(ctx.value);',
    updateNeighbor: ''
  });
  mp.makeProperty('browserFocused', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: 'ctx.sp.browser.setFocused(ctx.value);',
    updateNeighbor: ''
  });
  mp.makeProperty('browserModal', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: '',
    updateNeighbor: ''
  });
  
  mp.onUiEvent = (pcFormId, uiEvent) => {
    try {
      console.log(`[phase0] onUiEvent callback from ${pcFormId.toString(16)}:`, uiEvent);
      if (uiEvent.type === 'cef::chat:send') {
        const text = uiEvent.data;
        commands.handleChatInput(pcFormId, text);
      }
    } catch (err) {
      console.error("[phase0] Error in onUiEvent:", err.message);
    }
  };
} else {
  console.log("[phase0] mp API not available");
}

const activeUsers = new Set();

// Polling de Conexões de Rede (2 em 2 segundos)
setInterval(() => {
  if (typeof mp === "undefined") return;

  for (let userId = 1; userId <= 10; userId++) {
    const connected = mp.isConnected(userId);
    if (connected && !activeUsers.has(userId)) {
      activeUsers.add(userId);
      console.log(`[phase0] Connection detected! User ID: ${userId}`);
      
      try {
        const actorId = mp.getUserActor(userId);
        console.log(`[phase0] User ${userId} actor:`, actorId ? actorId.toString(16) : 'none');
        
        if (actorId) {
          // Mapeia o actorId para o profileId do usuário
          let foundProfileId = -1;
          for (let pId = 1; pId <= 50; pId++) {
            const actors = mp.getActorsByProfileId(pId);
            if (actors && actors.includes(actorId)) {
              foundProfileId = pId;
              break;
            }
          }
          console.log(`[phase0] User ${userId} mapped to profileId: ${foundProfileId}`);
          
          if (foundProfileId !== -1) {
            // Executa verificação assíncrona no banco
            whitelist.checkWhitelist(userId, foundProfileId, actorId)
              .then((allowed) => {
                if (allowed) {
                  console.log(`[phase0] User ${userId} successfully approved by database check.`);
                } else {
                  console.log(`[phase0] User ${userId} was rejected and kicked by database check.`);
                  activeUsers.delete(userId);
                  commands.removeActiveCharacter(actorId);
                }
              })
              .catch((err) => {
                console.error(`[phase0] Error in async checkWhitelist for user ${userId}:`, err.message);
                if (typeof mp !== 'undefined') mp.kick(userId);
                activeUsers.delete(userId);
                commands.removeActiveCharacter(actorId);
              });
          } else {
            console.log(`[phase0] User ${userId} actor ${actorId.toString(16)} has no associated profileId in server registry.`);
          }
        }
      } catch (err) {
        console.error(`[phase0] Error processing connection for user ${userId}:`, err.message);
      }
    } else if (!connected && activeUsers.has(userId)) {
      activeUsers.delete(userId);
      console.log(`[phase0] Disconnection detected! User ID: ${userId}`);
      
      try {
        const actorId = mp.getUserActor(userId);
        if (actorId) {
          commands.removeActiveCharacter(actorId);
        }
      } catch (err) {
        // O ator pode já ter sido destruído na desconexão
      }
    }
  }
}, 2000);

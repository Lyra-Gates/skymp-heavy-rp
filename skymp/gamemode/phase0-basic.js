const path = require('path');

// Como o SkyMP copia o arquivo de entrada para um diretorio temporario do Windows no boot,
// precisamos resolver o caminho original do gamemode de forma absoluta usando process.cwd().
const gamemodeDir = path.resolve(process.cwd(), '../gamemode');

const db            = require(path.join(gamemodeDir, 'database'));
const whitelist     = require(path.join(gamemodeDir, 'whitelist'));
const commands      = require(path.join(gamemodeDir, 'commands'));
const deathService  = require(path.join(gamemodeDir, 'death-service'));
const npcCleaner    = require(path.join(gamemodeDir, 'npc-cleaner'));
const justiceService = require(path.join(gamemodeDir, 'justice-service'));
const voipService   = require(path.join(gamemodeDir, 'voip-service'));
// Fase Beta
const survivalService = require(path.join(gamemodeDir, 'survival-service'));
const regionalEconomy = require(path.join(gamemodeDir, 'economy-regional'));
const craftingService = require(path.join(gamemodeDir, 'crafting-service'));
const factionService  = require(path.join(gamemodeDir, 'faction-service'));

console.log("[phase1] SkyMP Heavy RP gamemode loaded");

// Inicializa o Pool do Banco de Dados e Serviços
try {
  db.init();
  deathService.initDeathService();
  npcCleaner.startWorldCleaner();
  justiceService.startJusticeService();
  justiceService.restoreActivePrisoners();
  voipService.startVoipServer(7778);
  survivalService.startSurvivalService();
  regionalEconomy.initRegionalEconomy();
  factionService.initFactionService();
} catch (err) {
  console.error("[phase1] Fatal: Could not initialize database or services:", err.message);
}

// Hook de Evento do Chat (CEF uiEvent)
if (typeof mp !== "undefined") {
  console.log("[phase1] mp API available");

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
      console.log(`[phase1] onUiEvent callback from ${pcFormId.toString(16)}:`, uiEvent);
      if (uiEvent.type === 'cef::chat:send') {
        const text = uiEvent.data;
        commands.handleChatInput(pcFormId, text);
      }
    } catch (err) {
      console.error("[phase1] Error in onUiEvent:", err.message);
    }
  };
} else {
  console.log("[phase1] mp API not available");
}

const activeUsers = new Set();

// Polling de Conexões de Rede (2 em 2 segundos)
setInterval(() => {
  if (typeof mp === "undefined") return;

  for (let userId = 1; userId <= 10; userId++) {
    const connected = mp.isConnected(userId);
    if (connected && !activeUsers.has(userId)) {
      activeUsers.add(userId);
      console.log(`[phase1] Connection detected! User ID: ${userId}`);
      
      try {
        const actorId = mp.getUserActor(userId);
        console.log(`[phase1] User ${userId} actor:`, actorId ? actorId.toString(16) : 'none');
        
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
          console.log(`[phase1] User ${userId} mapped to profileId: ${foundProfileId}`);
          
          if (foundProfileId !== -1) {
            // Executa verificação assíncrona no banco
            whitelist.checkWhitelist(userId, foundProfileId, actorId)
              .then((allowed) => {
                if (allowed) {
                  console.log(`[phase1] User ${userId} successfully approved by database check.`);
                } else {
                  console.log(`[phase1] User ${userId} was rejected and kicked by database check.`);
                  activeUsers.delete(userId);
                  commands.removeActiveCharacter(actorId);
                }
              })
              .catch((err) => {
                console.error(`[phase1] Error in async checkWhitelist for user ${userId}:`, err.message);
                if (typeof mp !== 'undefined') mp.kick(userId);
                activeUsers.delete(userId);
                commands.removeActiveCharacter(actorId);
              });
          } else {
            console.log(`[phase1] User ${userId} actor ${actorId.toString(16)} has no associated profileId in server registry.`);
          }
        }
      } catch (err) {
        console.error(`[phase1] Error processing connection for user ${userId}:`, err.message);
      }
    } else if (!connected && activeUsers.has(userId)) {
      activeUsers.delete(userId);
      console.log(`[phase1] Disconnection detected! User ID: ${userId}`);
      
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

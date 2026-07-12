const path = require('path');

// Como o SkyMP copia o arquivo de entrada para um diretorio temporario do Windows no boot,
// precisamos resolver o caminho original do gamemode de forma absoluta usando process.cwd().
const gamemodeDir = path.resolve(process.cwd(), '../gamemode');

const db            = require(path.join(gamemodeDir, 'database'));
const whitelist     = require(path.join(gamemodeDir, 'whitelist'));
const commands      = require(path.join(gamemodeDir, 'commands'));
const moduleRegistry = require(path.join(gamemodeDir, 'core', 'module-registry'));

console.log("[phase0] SkyMP Heavy RP gamemode loaded");

// ─────────────────────────────────────────────────────────────────────────────
// Registro de módulos
// Módulos CORE e LAB são registrados aqui.
// Módulos PARKED permanecem no disco mas não são registrados nem inicializados.
// ─────────────────────────────────────────────────────────────────────────────

// CORE: Limpeza de NPCs
moduleRegistry.register({
  id: 'npc-cleaner',
  enabledBy: 'ENABLE_NPC_CLEANER',
  phase: 'core',
  dependencies: [],
  commands: [],
  initialize: async () => {
    require(path.join(gamemodeDir, 'npc-cleaner')).startWorldCleaner();
  }
});

// LAB: Serviço de morte (aguardando reengenharia completa)
moduleRegistry.register({
  id: 'death',
  enabledBy: 'ENABLE_DEATH_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: [],
  initialize: async () => {
    require(path.join(gamemodeDir, 'death-service')).initDeathService();
  }
});

// PARKED — Os seguintes módulos NÃO são registrados até passarem por reengenharia:
// - justice-service   (ENABLE_JUSTICE_SERVICE)
// - voip-service      (ENABLE_VOIP_SERVICE)
// - survival-service  (ENABLE_SURVIVAL_SERVICE)
// - economy-regional  (ENABLE_REGIONAL_ECONOMY)
// - faction-service   (ENABLE_FACTION_SERVICE)
// - jobs-service      (ENABLE_WOODCUTTING / ENABLE_MINING / ENABLE_FISHING)
// - crafting-service  (ENABLE_CRAFTING)
// - housing-service   (ENABLE_HOUSING)
// - trade-service     (ENABLE_TRADE)
// - disguise-service  (ENABLE_DISGUISE)
// - horse-service     (ENABLE_HORSES)
//
// Para reativar um módulo, implemente o descriptor correto acima
// com initialize(), commands[], healthCheck() e dependencies[].

// ─────────────────────────────────────────────────────────────────────────────
// Inicialização do servidor
// ─────────────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    db.init();
    console.log("[phase0] Database pool initialized");

    // Inicializar módulos via registry (verifica env vars, resolve deps, registra comandos)
    await moduleRegistry.bootAll();

  } catch (err) {
    console.error("[phase0] Fatal: Could not initialize database or services:", err.message);
  }
}

boot();

// ─────────────────────────────────────────────────────────────────────────────
// Runtime SkyMP
// ─────────────────────────────────────────────────────────────────────────────

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

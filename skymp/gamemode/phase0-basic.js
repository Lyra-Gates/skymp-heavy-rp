const path = require('path');

// Como o SkyMP copia o arquivo de entrada para um diretorio temporario do Windows no boot,
// precisamos resolver o caminho original do gamemode de forma absoluta usando process.cwd().
const gamemodeDir = path.resolve(process.cwd(), '../gamemode');

const db            = require(path.join(gamemodeDir, 'database'));
const whitelist     = require(path.join(gamemodeDir, 'whitelist'));
const commands      = require(path.join(gamemodeDir, 'commands'));
const moduleRegistry = require(path.join(gamemodeDir, 'core', 'module-registry'));
const uiEventRouter  = require(path.join(gamemodeDir, 'core', 'ui-event-router'));
const serverOptions  = require(path.join(gamemodeDir, 'core', 'server-options'));
const governance    = require(path.join(gamemodeDir, 'governance-service'));
const marketStalls  = require(path.join(gamemodeDir, 'market-stalls-service'));
const playerPanel   = require(path.join(gamemodeDir, 'player-panel-service'));
const deathService  = require(path.join(gamemodeDir, 'death-service'));
const voipService   = require(path.join(gamemodeDir, 'voip-service'));

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

// LAB: Serviço de morte — DOWNED com janela de socorro, penalidade e respawn
moduleRegistry.register({
  id: 'death',
  enabledBy: 'ENABLE_DEATH_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: deathService.commandDefs(),
  initialize: async () => {
    deathService.initDeathService();
  }
});

moduleRegistry.register({
  id: 'governance',
  enabledBy: 'ENABLE_GOVERNANCE_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: governance.commandDefs(),
  initialize: async () => {
    await governance.initGovernanceService();
    uiEventRouter.register('governance', governance.handleUiEvent);
  },
  shutdown: async () => {
    uiEventRouter.unregister('governance');
    governance.shutdownGovernanceService();
  }
});

moduleRegistry.register({
  id: 'market-stalls',
  enabledBy: 'ENABLE_MARKET_STALLS_SERVICE',
  phase: 'lab',
  dependencies: ['governance'],
  commands: marketStalls.commandDefs(),
  initialize: async () => {
    await marketStalls.initMarketStallsService();
  },
  shutdown: async () => {
    marketStalls.shutdownMarketStallsService();
  }
});

// LAB: Painel do jogador (status, governança, economia, social)
moduleRegistry.register({
  id: 'player-panel',
  enabledBy: 'ENABLE_PLAYER_PANEL_SERVICE',
  phase: 'lab',
  dependencies: ['governance'],
  commands: playerPanel.commandDefs(),
  initialize: async () => {
    await playerPanel.initPlayerPanelService();
    uiEventRouter.register('panel', playerPanel.handleUiEvent);
  },
  shutdown: async () => {
    uiEventRouter.unregister('panel');
    playerPanel.shutdownPlayerPanelService();
  }
});

// LAB: Voz por proximidade (opt-in via /voz — ver voip-service.js)
moduleRegistry.register({
  id: 'voip',
  enabledBy: 'ENABLE_VOIP_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: voipService.commandDefs(),
  initialize: async () => {
    voipService.startVoipServer();
  }
});

// PARKED — Existem no disco e NÃO são registrados até passarem por reengenharia:
// - economy-regional  (ENABLE_REGIONAL_ECONOMY)
// - jobs-service      (ENABLE_WOODCUTTING / ENABLE_MINING / ENABLE_FISHING)
// - crafting-service  (ENABLE_CRAFTING)
// - housing-service   (ENABLE_HOUSING)
// - trade-service     (ENABLE_TRADE)
// - disguise-service  (ENABLE_DISGUISE)
// - horse-service     (ENABLE_HORSES)
//
// APAGADOS em 06/08/2026 (ver docs/technical/PARKED_SERVICES_DECISION.md):
// - economy-service   Mexia em ouro com UPDATE solto, sem transação nem ledger.
//                     `transfer` fazia removeGold + addGold sem transação: se a
//                     segunda falhasse, o ouro sumia. Seis módulos o importavam,
//                     então reativar qualquer um traria a economia insegura
//                     junto, contornando o core/transaction-service em silêncio.
//                     Os que ficaram foram migrados pro transaction-service.
// - justice-service   Cada função tinha equivalente melhor no governance-service
//                     (que tem alcance, plantão, auditoria e permissões nomeadas).
//                     Duas fontes de verdade sobre quem está preso é pior que uma.
// - faction-service   Mantinha uma segunda tabela de "quem pertence a qual facção
//                     com qual patente", concorrendo com governance_memberships.
//                     Facção é um ESCOPO da governança (scope_type='faction'), não
//                     um sistema paralelo.
// - survival-service  Mexia em ActorValue (StaminaRate/CarryWeight), que é
//                     exatamente o que o death-service lê pra detectar DOWNED.
//                     Precisa nascer depois do death-service estar validado.
//
// Para reativar um módulo, implemente o descriptor correto acima
// com initialize(), commands[], healthCheck() e dependencies[].

// ─────────────────────────────────────────────────────────────────────────────
// Inicialização do servidor
// ─────────────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    // Antes do banco: um valor de gameplay inválido aborta aqui, e é melhor
    // descobrir isso com o servidor ainda vazio.
    const options = serverOptions.load();
    console.log(`[phase0] server-options: ${options.usedFile ? options.path : 'nenhum arquivo, usando defaults'}`);
    for (const warning of options.warnings) {
      console.warn(`[phase0] server-options: ${warning}`);
    }

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
    updateOwner: `
      if (ctx.value && ctx.sp && ctx.sp.browser && ctx.sp.browser.executeJavaScript) {
        const payload = JSON.stringify(ctx.value);
        ctx.sp.browser.executeJavaScript('window.handleServerModal && window.handleServerModal(' + payload + ')');
      }
    `,
    updateNeighbor: ''
  });
  // Canal dedicado ao painel do jogador (não interfere no browserModal acima,
  // usado por modais pontuais como o menu de interação da governança).
  mp.makeProperty('panelData', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: `
      if (ctx.value && ctx.sp && ctx.sp.browser && ctx.sp.browser.executeJavaScript) {
        const payload = JSON.stringify(ctx.value);
        ctx.sp.browser.executeJavaScript('window.handlePanelData && window.handlePanelData(' + payload + ')');
      }
    `,
    updateNeighbor: ''
  });
  // Ticket de conexão de voz (emitido pelo comando /voz) — o cliente recebe
  // {actorId, ticket, host, port} e só então abre o WebSocket de sinalização.
  mp.makeProperty('voipTicket', {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: `
      if (ctx.value && ctx.sp && ctx.sp.browser && ctx.sp.browser.executeJavaScript) {
        const payload = JSON.stringify(ctx.value);
        ctx.sp.browser.executeJavaScript('window.handleVoipTicket && window.handleVoipTicket(' + payload + ')');
      }
    `,
    updateNeighbor: ''
  });

  mp.onUiEvent = (pcFormId, uiEvent) => {
    try {
      console.log(`[phase0] onUiEvent callback from ${pcFormId.toString(16)}:`, uiEvent);
      uiEventRouter.dispatch(pcFormId, uiEvent).catch(err =>
        console.error('[phase0] ui-event-router dispatch failed:', err.message)
      );
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
// Cache userId -> actorId enquanto conectado. Necessário porque no momento em
// que detectamos a desconexão (connected === false) o ator já foi destruído
// pela engine e mp.getUserActor(userId) normalmente falha/retorna nada —
// sem isso, removeActiveCharacter/playerPanel.cleanup nunca rodavam de fato.
const userActorMap = new Map();

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
          userActorMap.set(userId, actorId);

          if (foundProfileId !== -1) {
            // Executa verificação assíncrona no banco
            whitelist.checkWhitelist(userId, foundProfileId, actorId)
              .then((allowed) => {
                if (allowed) {
                  console.log(`[phase0] User ${userId} successfully approved by database check.`);
                } else {
                  console.log(`[phase0] User ${userId} was rejected and kicked by database check.`);
                  activeUsers.delete(userId);
                  userActorMap.delete(userId);
                  commands.removeActiveCharacter(actorId);
                  playerPanel.cleanup(actorId);
                }
              })
              .catch((err) => {
                console.error(`[phase0] Error in async checkWhitelist for user ${userId}:`, err.message);
                if (typeof mp !== 'undefined') mp.kick(userId);
                activeUsers.delete(userId);
                userActorMap.delete(userId);
                commands.removeActiveCharacter(actorId);
                playerPanel.cleanup(actorId);
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

      const actorId = userActorMap.get(userId);
      userActorMap.delete(userId);
      if (actorId) {
        try {
          commands.removeActiveCharacter(actorId);
          playerPanel.cleanup(actorId);
        } catch (err) {
          console.error(`[phase0] Error cleaning up disconnected user ${userId}:`, err.message);
        }
      }
    }
  }
}, 2000);

const path = require('path');

// Como o SkyMP copia o arquivo de entrada para um diretorio temporario do Windows no boot,
// precisamos resolver o caminho original do gamemode de forma absoluta usando process.cwd().
const gamemodeDir = path.resolve(process.cwd(), '../gamemode');

// ─────────────────────────────────────────────────────────────────────────────
// .env — PRECISA vir antes de qualquer outro require deste arquivo.
//
// Duas coisas leem process.env em tempo de *carregamento*, não de boot:
//   - core/module-registry.js decide o que ligar por process.env[ENABLE_*];
//   - core/server-options.js faz load() preguiçoso usando NODE_ENV, e
//     death-service/proximity-ranges chamam get() já no require.
// Carregar depois significaria ler o ambiente errado nos dois casos.
//
// Até 06/08/2026 NADA aqui carregava o arquivo: `dotenv` estava em
// dependencies, `.env.example` existia, CONTRIBUTING.md §1 e
// FASE_0_ROTEIRO.md mandavam preencher `skymp/gamemode/.env` — e quem lia
// esse arquivo era o `apps/web/server.js`, pra si mesmo. Resultado: todas as
// flags ENABLE_* chegavam indefinidas no registry e TODO módulo lab ficava
// desativado, sem erro nenhum. Ligar governança no .env simplesmente não
// fazia nada, e o log dizia "DESATIVADO (... =false ou não definido)".
//
// `quiet` evita o banner do dotenv no stdout do servidor; a ausência do
// arquivo não é erro (defaults valem), então o resultado não é checado.
//
// ⚠️ O caminho é ABSOLUTO, como todos os requires abaixo, e pelo mesmo motivo
// que o comentário no topo deste arquivo explica: o SkyMP copia ESTE arquivo
// para `%TEMP%\skymp5-server<random>\` e executa de lá. Um especificador nu
// (`require('dotenv')`) é resolvido a partir do diretório do arquivo em
// execução — o temp, que não tem `node_modules` — e o gamemode inteiro morre
// no boot com `Cannot find module 'dotenv'`.
//
// Isso aconteceu de verdade: a primeira versão desta linha usava a forma nua,
// passou nos 366 testes e no CI (que rodam a partir de `skymp/gamemode/`, onde
// a resolução funciona) e só apareceu ao subir o servidor pela primeira vez.
// É o exemplo mais limpo do que o cabeçalho do CI já dizia — "CI verde
// significa que não quebrou o que já era verificado, não que funciona em jogo".
//
// Nenhum outro require deste arquivo pode ser nu, pela mesma razão. Os módulos
// que ele carrega, sim: eles vivem em `skymp/gamemode/` e resolvem a partir de
// lá normalmente.
require(path.join(gamemodeDir, 'node_modules', 'dotenv'))
  .config({ path: path.join(gamemodeDir, '.env'), quiet: true });

const db            = require(path.join(gamemodeDir, 'database'));
const whitelist     = require(path.join(gamemodeDir, 'whitelist'));
const commands      = require(path.join(gamemodeDir, 'commands'));
const moduleRegistry = require(path.join(gamemodeDir, 'core', 'module-registry'));
const uiEventRouter  = require(path.join(gamemodeDir, 'core', 'ui-event-router'));
const { installUiEventGateway } = require(path.join(gamemodeDir, 'core', 'ui-event-gateway'));
const { createUiEventRateLimiter } = require(path.join(gamemodeDir, 'core', 'ui-event-rate-limiter'));
const { createConnectionMonitor } = require(path.join(gamemodeDir, 'core', 'connection-monitor'));
const serverOptions  = require(path.join(gamemodeDir, 'core', 'server-options'));
const governance    = require(path.join(gamemodeDir, 'governance-service'));
const marketStalls  = require(path.join(gamemodeDir, 'market-stalls-service'));
const playerPanel   = require(path.join(gamemodeDir, 'player-panel-service'));
const deathService  = require(path.join(gamemodeDir, 'death-service'));
const voipService   = require(path.join(gamemodeDir, 'voip-service'));
const soulService   = require(path.join(gamemodeDir, 'soul-service'));
const nametagService = require(path.join(gamemodeDir, 'nametag-service'));
const faunaCensus   = require(path.join(gamemodeDir, 'fauna-census'));
const corpseProbe   = require(path.join(gamemodeDir, 'corpse-probe'));

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

// LAB: Afinidade da Alma — sinais, marcas e árvore de transformação.
//
// Desligado por padrão, como todo lab. Duas coisas precisam estar no `.env`
// antes de ligar: `ENABLE_SOUL_SERVICE=true` e `SOUL_SECRET`. Sem o segredo o
// módulo **falha no boot de propósito** — derivar alma com segredo vazio deixaria
// qualquer pessoa recalcular a alma de qualquer personagem a partir da ficha, que
// é pública no painel, e o estrago seria permanente porque a alma é congelada no
// primeiro spawn.
//
// ⚠️ Confirmado por teste automatizado, não confirmado em sessão real — igual a
// hit-events/espm/safe-zones. O que só o cliente prova está na Etapa 9.4 do
// FASE_0_ROTEIRO.md e não foi executado.
moduleRegistry.register({
  id: 'soul',
  enabledBy: 'ENABLE_SOUL_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: soulService.commandDefs(),
  initialize: async () => {
    await soulService.initSoulService();
  },
  shutdown: async () => {
    soulService.shutdownSoulService();
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

// LAB: Nametag visual — PROVA DE CONCEITO, uma etiqueta (o mais próximo).
//
// ⚠️ Nunca apareceu na tela de ninguém. A projeção mundo→tela usa
// `worldPointToScreenPoint`, que é documentada pelo SkyMP mas que este projeto
// nunca chamou; a convenção dos eixos e o caso "alvo atrás da câmera" só uma
// sessão real resolve. Ler o cabeçalho de `nametag-service.js` §4 antes de
// tratar isto como pronto — a distância entre "o código calcula o nome certo" e
// "duas pessoas veem nomes diferentes na tela" é a mesma que separa
// hit-events/espm/safe-zones de validado.
moduleRegistry.register({
  id: 'nametag',
  enabledBy: 'ENABLE_NAMETAG_SERVICE',
  phase: 'lab',
  dependencies: [],
  commands: [],
  initialize: async () => {
    nametagService.initNametagService();
  },
  shutdown: async () => {
    nametagService.shutdownNametagService();
  }
});

// LAB: Instrumentos de observação da Fase 0 para a questão de mobs hostis.
//
// Não são mecânica e não viram mecânica. São as Peças 1 e 2 da §16 do
// `docs/technical/HOSTILE_MOB_ACTIVATION_DECISION.md`, cuja ordem é
// deliberadamente anti-intuitiva: **as duas primeiras peças não são a feature**,
// são as perguntas cuja resposta decide se a feature existe. Protocolo de uso em
// `docs/technical/FAUNA_CENSUS_PROTOCOL.md`.
//
// Ficam desligados por padrão como todo lab, e devem voltar a `false` ao fim da
// sessão de observação — não há motivo para um servidor em operação carregar um
// comando que escreve no inventário de um ator.
moduleRegistry.register({
  id: 'fauna-census',
  enabledBy: 'ENABLE_FAUNA_CENSUS',
  phase: 'lab',
  dependencies: [],
  commands: faunaCensus.commandDefs(),
  initialize: async () => {
    faunaCensus.initFaunaCensus();
  }
});

// ⚠️ Este ESCREVE: esvazia o inventário do ator sondado para provar que a
// escrita funciona, e restaura em seguida. Recusa qualquer ator de jogador, por
// duas checagens independentes. Flag própria, separada do censo de propósito —
// ligar a observação inofensiva não pode ligar a que mexe em inventário.
moduleRegistry.register({
  id: 'corpse-probe',
  enabledBy: 'ENABLE_CORPSE_PROBE',
  phase: 'lab',
  dependencies: [],
  commands: corpseProbe.commandDefs(),
  initialize: async () => {
    corpseProbe.initCorpseProbe();
  }
});

// PARKED — Existem no disco e NÃO são registrados até passarem por reengenharia:
// - economy-regional  (ENABLE_REGIONAL_ECONOMY)
// - jobs-service      (ENABLE_WOODCUTTING / ENABLE_MINING / ENABLE_FISHING)
// - crafting-service  (ENABLE_CRAFTING)
// - housing-service   (ENABLE_HOUSING)
// - trade-service     (ENABLE_TRADE)
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
// APAGADO em 06/08/2026, na reavaliação dos três "independentes":
// - disguise-service  Segunda autoridade sobre o nome que um observador vê, e
//                     com a chave errada: o identity-service resolve por
//                     (observador, alvo) e ele resolvia só por alvo, então o
//                     disfarce nem conseguia expressar o único caso que importa
//                     — parecer outra pessoa pra quem já te conhece. O lugar
//                     certo já existe: `character_known_identities.source`
//                     aceita 'disguise' e o painel já rotula "disfarce".
//                     Ver docs/technical/PARKED_SERVICES_DECISION.md §7.
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

  // Nametag: alvo + nome já resolvido pelo servidor. Diferente das quatro
  // properties acima, o snippet daqui não só repassa para a CEF — ele registra
  // um laço no evento `update` do jogo, porque a POSIÇÃO na tela é a única coisa
  // desta feature que o servidor não tem como saber. O texto continua vindo
  // pronto: o cliente nunca escolhe nome. Ver nametag-service.js §1 e §2.
  mp.makeProperty(nametagService.PROPERTY, {
    isVisibleByOwner: true,
    isVisibleByNeighbors: false,
    updateOwner: nametagService.SNIPPET_DO_CLIENTE,
    updateNeighbor: ''
  });

  const configuredRateLimit = Number(process.env.UI_EVENT_RATE_LIMIT_MAX_EVENTS);
  const configuredRateWindow = Number(process.env.UI_EVENT_RATE_LIMIT_WINDOW_MS);
  const uiEventRateLimiter = createUiEventRateLimiter({
    maxEvents: Number.isSafeInteger(configuredRateLimit) && configuredRateLimit > 0 ? configuredRateLimit : 0,
    windowMs: Number.isSafeInteger(configuredRateWindow) && configuredRateWindow > 0 ? configuredRateWindow : undefined
  });
  installUiEventGateway(mp, {
    uiEventRouter,
    handleChatInput: commands.handleChatInput,
    rateLimiter: uiEventRateLimiter
  });
  // Telemetria sem payload: fornece a base real para escolher um limite sem
  // registrar texto do jogador nem bloquear a UI antes da medicao.
  const uiEventMetricsTimer = setInterval(() => {
    const metrics = uiEventRateLimiter.snapshot();
    if (metrics.observed > 0 || metrics.rejected > 0) {
      console.log('[phase0] UI event metrics:', JSON.stringify(metrics));
    }
  }, 60_000);
  if (typeof uiEventMetricsTimer.unref === 'function') uiEventMetricsTimer.unref();
} else {
  console.log("[phase0] mp API not available");
}

// Polling de conexão (a API SkyMP ainda não expõe callback de login). O monitor
// protege contra respostas de whitelist de sessões antigas e espera o ator e o
// profile aparecerem em vez de abandonar uma conexão publicada cedo pela engine.
if (typeof mp !== 'undefined') {
  createConnectionMonitor({ mp, whitelist, commands, playerPanel }).start();
}

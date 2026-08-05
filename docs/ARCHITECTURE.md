# Arquitetura do Sistema (SkyMP Heavy RP)

O servidor de SkyMP Heavy RP opera utilizando uma arquitetura distribuída, separando os serviços críticos para garantir segurança, estabilidade e aderência rígida à regra de **Autoridade do Servidor**.

## 1. Topologia do Servidor

A infraestrutura é dividida nos seguintes módulos:

### 1.1 Banco de Dados (MariaDB/MySQL)
O **MariaDB** é a fonte absoluta de verdade. Todos os serviços se conectam a ele.
- **Tabelas Principais:** `characters`, `factions`, `houses`, `economy`, `crafting_recipes`, `crafting_ingredients`.
- **Regra Restrita:** Nenhuma alteração de estado no jogo (dinheiro, posições, itens) acontece sem ser gravada ou lida do MariaDB. O Node.js não confia em dados soltos na memória por períodos longos sem persistência.

### 1.2 Aplicativo Web e API (`apps/web`)
Desenvolvido em **Express.js / Node.js**.
- Fornece o Painel Web (Whitelist, Staff, perfis fora do jogo).
- Fornece os Endpoints da API para o **Launcher** (download de manifesto de mods, versões atualizadas, controle de acesso).
- Autenticação obrigatória utilizando `passport-discord`.
- Não confundir com o **Painel do Jogador in-game** (ver 1.4.2), que roda dentro do próprio HUD do SkyMP, não no navegador.

### 1.3 Bot do Discord (`apps/bot-discord`)
Desenvolvido em **discord.js**.
- Facilita o envio de logs do servidor para canais da moderação.
- Realiza a ponte entre a conta do Discord do usuário e o seu `profileId` no jogo.

### 1.4 Servidor Nativo SkyMP (Gamemode)
Localizado em `skymp/gamemode/`.
- Executado em Node.js usando as bibliotecas internas do SkyMP (`mp.events`, `mp.players`).
- Lida com o ciclo de vida do jogador: conexão, desconexão, spawn, combate, comandos de chat e persistência de itens em tempo real.
- Delega regras de negócios a serviços internos (`survival-service.js`, `economy-service.js`, `crafting-service.js`, `jobs-service.js`).
- Módulos são registrados e ligados/desligados via `core/module-registry.js` (flags `ENABLE_*` no `.env`), que também cuida de dependências entre módulos e do registro automático de comandos no `core/command-registry.js`.

#### 1.4.1 Bridge de UI (CEF)
A comunicação entre o gamemode e a UI CEF (`skymp/ui/`) usa duas properties SkyMP registradas em `phase0-basic.js`:
- **`browserModal`**: canal de modais pontuais (ex: menu de interação da governança). `updateOwner` executa `ctx.sp.browser.executeJavaScript('window.handleServerModal(...)')` no cliente.
- **`panelData`**: canal dedicado do Painel do Jogador, no formato `{ channel, data }` — o cliente despacha para `window.handlePanelData(...)` e cada aba (`status`, `governance`, `economy`, `social`) renderiza seu próprio bloco.

No sentido UI→servidor, `mp.onUiEvent` despacha todo evento através de `core/ui-event-router.js`, que roteia pelo prefixo do `uiEvent.type` (ex: `governance:*` → `governance-service.js`, `panel:*` → `player-panel-service.js`). Novos módulos que precisem de UI só chamam `uiEventRouter.register('<prefixo>', handler)` no seu `initialize()` — não é preciso editar `phase0-basic.js` para cada novo tipo de evento.

#### 1.4.2 Painel do Jogador (in-game)
`player-panel-service.js` — módulo `player-panel` (`ENABLE_PLAYER_PANEL_SERVICE`), ativado pelo comando `/painel`. Não duplica lógica de negócio: só agrega leituras de outros serviços já existentes.
- **Status**: vida/magicka/stamina lidas via `mp.callPapyrusFunction('method', 'Actor', 'getActorValue', ...)` (mesmo padrão de `death-service.js`), ouro via `core/transaction-service.js`, estado RP via `core/character-state.js`. Atualizado por polling de 2s enquanto o painel está aberto, só reenviando quando o valor muda.
- **Governança**: `governance-service.getMyGovernanceSummary()`.
- **Economia**: `market-stalls-service.getMyEconomySummary()`.
- **Social**: lista de `character_known_identities` do próprio personagem.
- UI em `skymp/ui/player-panel.css` / `player-panel.js`, com identidade visual espelhando o [Prisma UI](https://prismaui.dev) (glass card preto, glow violeta, chip de status, navegação em pílulas com runas Elder Futhark como ícone de cada aba).
- **Atualização proativa**: `core/panel-refresh-bus.js` é um `EventEmitter` desacoplado — `governance-service.js` chama `panelRefreshBus.requestRefresh(actorId, 'governance'|'status')` após multa, mandado ou prisão, e o `player-panel-service.js` (assinante único, registrado em `initPlayerPanelService`) reenvia a seção correspondente **só se o painel daquele jogador já estiver aberto**. Existe pra evitar que `governance-service.js` precise depender de `player-panel-service.js` (que já depende dele), sem forçar o painel a abrir sozinho na tela do jogador.
- **Ação direta na aba Social**: cada pessoa conhecida tem um botão "Apelidar" que abre um mini-formulário inline (`skymp/ui/player-panel.js`, `socialRow`/`bindSocialRenameHandlers`) e envia `panel:social:rename` com `{ targetCharacterId, alias }`. `player-panel-service.renameKnownPerson` chama `identity-service.upsertKnownIdentity` diretamente pelos characterIds — funciona mesmo com o alvo desconectado, já que `character_known_identities` não depende de um actorId ativo.

### 1.5 Launcher do Cliente (`apps/launcher`)
Desenvolvido em **Electron / React**.
- Lê o Manifesto da API Web e faz a validação criptográfica (Hashes) da *Load Order* do jogador.
- Garante que a versão dos ESMs, texturas aprovadas, e SKSE estejam idênticas à do servidor.

## 2. Fluxo de Decisão (A Regra de Ouro)

No nosso servidor, a autoridade nunca é delegada ao cliente.

**Exemplo de Fluxo (Pescaria ou Forja):**
1. O jogador (Cliente) aperta um botão para interagir.
2. O Gamemode (Servidor) recebe a requisição, checa se ele tem a vara/recurso e a habilidade necessária no Banco de Dados.
3. O Servidor altera o banco, salva o novo item.
4. O Servidor dispara o `mp.callPapyrusFunction` apenas para o cliente fazer a animação e receber o aviso visual de sucesso.
*(Se um mod local tentar pular a etapa 2, ele falha silenciosamente, protegendo a economia).*

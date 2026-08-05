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
- **Aplicação de personagem** (`/api/apply`, `apply.html`): além de nome/biografia, coleta `motivations`/`weaknesses`/`social_ties` (rubrica de whitelist Heavy RP — ver `SKYMP_RP_DEVELOPMENT_PLAN.md` 8.1). Uma heurística de palavras-chave (`detectsStrongConcept` em `server.js`) sinaliza `characters.needs_extra_review` pra conceitos fortes (nobreza, vampirismo, lycanthropia, Daedra, liderança de facção) — não é um gate automático, só um aviso pra staff prestar mais atenção na revisão; a staff pode anexar `extra_review_notes` pelo painel (`PATCH /api/whitelist/:id`). `skymp/gamemode/whitelist.js` lê `characters` com `ORDER BY id DESC LIMIT 1` ao liberar spawn.

### 1.3 Bot do Discord (`apps/bot-discord`)
Desenvolvido em **discord.js**.
- Realiza a ponte entre a conta do Discord do usuário e o seu `profileId` no jogo (`POST /api/sync-role`, chamado pelo painel web na aprovação/rejeição de whitelist).
- **Canais de voz temporários** (`voiceChannels.js`, comandos `/voz-criar <nome>` e `/voz-fechar`, staff-only): alternativa prática de voz enquanto o VOIP nativo in-game (`/voz`, ver 1.4.4) depende de um patch de client ainda não aplicado (`docs/technical/VOICE_CLIENT_PATCH.md`). Canal é apagado automaticamente ~30s depois de ficar vazio. Comandos precisam ser registrados manualmente com `npm run deploy-commands` sempre que mudarem.
- Envio de logs pra canais de moderação **não está implementado** — apesar de ter sido a intenção original documentada aqui, hoje o bot só expõe o endpoint interno de sync de cargo e os comandos de voz acima.

### 1.4 Servidor Nativo SkyMP (Gamemode)
Localizado em `skymp/gamemode/`.
- Executado em Node.js usando as bibliotecas internas do SkyMP (`mp.events`, `mp.players`).
- Lida com o ciclo de vida do jogador: conexão, desconexão, spawn, combate, comandos de chat e persistência de itens em tempo real.
- Delega regras de negócio aos serviços ativos hoje (`governance-service.js`, `market-stalls-service.js`, `death-service.js`, `player-panel-service.js`, `voip-service.js`). Vários outros serviços existem no disco (`survival-service.js`, `economy-service.js`, `crafting-service.js`, `jobs-service.js`, `faction-service.js`, `housing-service.js`, `horse-service.js`, `trade-service.js`, `disguise-service.js`, `justice-service.js`, `economy-regional.js`) mas estão **PARKED** — nunca registrados em `core/module-registry.js`, logo nunca rodam em produção (ver comentário em `phase0-basic.js`). `justice-service.js` em especial é uma implementação anterior e redundante de algemas/prisão, superseded por `governance-service.js`.
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

#### 1.4.3 Morte e Consequência (`death-service.js`)
Módulo `death` (`ENABLE_DEATH_SERVICE`), fase `lab`. Existe pra que "morrer" tenha peso mecânico e social, não seja um non-event — princípio central de Heavy RP do `SKYMP_RP_DEVELOPMENT_PLAN.md` (seção 8.1, "Morte e Consequências").
- HP≤0 (detectado por polling de 2s, mesmo padrão de antes) → `core/character-state.js` vira `DOWNED`, o que já bloqueia gameplay/combate/fala via `core/action-policy.js` sem trabalho extra.
- **Socorro**: `/socorrer <actorId>` (qualquer jogador, dentro de `RESCUE_RANGE`) cancela o sangramento e estabiliza o alvo de volta pra `NORMAL` com vida parcial (`STABILIZE_HEALTH`). Alcance validado por `core/range-utils.js` (extraído de `governance-service.js`, usado por ambos).
- **Bleed-out**: se ninguém socorre dentro de `BLEED_OUT_MS` (4min), o personagem vira `DEAD`, uma penalidade de ouro é aplicada via `core/transaction-service.removeGold` (atômico — nunca deixa saldo negativo), e só então o respawn acontece no ponto seguro de sempre.
- **Evidência anti-RDM**: no momento do bleed-out, `logDeathContext` grava em `audit_logs` (`action='death:context'`) um snapshot de quem estava por perto (mesmo raio de proximidade do chat `say`) — não é atribuição definitiva de "quem matou" (não há hook nativo confiável pra isso nesta base), mas dá à staff uma trilha real em vez de só a palavra dos jogadores.
- Cada transição (`DOWNED`/socorrido/penalizado/respawnado) chama `panelRefreshBus.requestRefresh(actorId, 'status')`, refletindo em tempo real no `/painel`.
- **Camada mínima de RP pro combate**: sem hook nativo confiável de "quem atacou quem" nesta base, então o escopo é evidência, não enforcement. `/iniciar <actorId> <motivo>` grava uma marcação explícita de abertura de conflito IC em `audit_logs` (`combat:initiate`). Em paralelo, o mesmo polling de HP que detecta `DOWNED` também roda `checkDamageSpike` a cada tick — uma queda de vida `>= DAMAGE_SPIKE_THRESHOLD` (heurística, 25 pontos) num único tick de 2s dispara `logDeathContext(..., 'damage_spike')`, criando um rastro de proximidade mesmo quando ninguém usa `/iniciar`. `core/range-utils.js` ganhou `nearbyActors()` pra não duplicar a lógica de varredura de vizinhos entre o contexto de morte e o de dano.

**Morte permanente (soft-delete):** `admin-service.retireCharacter(actorId, targetActorId, reason)`, comando `/permakill` (permissão `retire_character`, tiers `admin`/`owner` apenas — nunca moderador). Nunca faz `DELETE` — só `UPDATE characters SET status='retired'`, motivo obrigatório e audit log. `whitelist.js` só permite spawn com `status='approved'`, então um personagem `retired` nunca mais entra em jogo sem precisar de nenhuma outra mudança.

#### 1.4.4 Voz por Proximidade (`voip-service.js`)
Módulo `voip` (`ENABLE_VOIP_SERVICE`), fase `lab`. Sinalização WebRTC (offer/answer/ICE) por WebSocket próprio (porta `VOIP_PORT`, padrão 7778) — o áudio em si é P2P entre clientes depois do handshake, o servidor só troca a sinalização e calcula volume por distância a cada 2s (raios espelham os do `rp-chat-service.js`: sussurro 200, normal 1200, grito 3000).

**Antes desta revisão o recurso existia só no papel** — nada em `phase0-basic.js` chamava `startVoipServer()`, e o listener `mp.events.add('voip:connect', ...)` no cliente nunca disparava porque nenhum código do servidor faz `mp.trigger`/emit desse evento em lugar nenhum do gamemode. Não era um indicador visível quebrado (o chip de status é `display:none` até `setStatus()` rodar, e isso nunca acontecia) — a feature estava simplesmente ausente, silenciosamente.

- **Opt-in via `/voz`** (não é forçado — "se voice chat é obrigatório" segue como decisão em aberto no `SKYMP_RP_DEVELOPMENT_PLAN.md`, seção 13). O comando chama `requestVoiceConnection`, que emite um ticket de uso único (`issueTicket`, TTL de 30s) e empurra `{actorId, ticket, host, port}` pro cliente via a property `voipTicket` (mesmo padrão comprovado de `browserModal`/`panelData`).
- **Autenticação por ticket**: o handshake WebSocket (`{type:'auth', actorId, ticket}`) exige que o ticket bata com o que foi emitido pra aquele `actorId` — sem isso, qualquer processo que conectasse em `ws://127.0.0.1:7778` podia reivindicar o `actorId` de outro jogador e sequestrar o slot de voz dele. Ticket é consumido no primeiro uso (replay falha).
- **Host dinâmico**: como `skymp/ui/index.html` é um arquivo estático sem templating, ele não tem como saber o IP público do servidor sozinho — por isso o servidor manda `host`/`port` no próprio payload do ticket (`VOIP_PUBLIC_HOST`/`VOIP_PORT` no `.env`), em vez do cliente ter `ws://127.0.0.1:7778` fixo no código (o que só funcionava com jogador e servidor na mesma máquina).
- `VOIP_BIND_HOST` (padrão `127.0.0.1`) controla em quais interfaces o `WebSocketServer` escuta — não confundir com `VOIP_PUBLIC_HOST`, que é o que o cliente recebe pra conectar.

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

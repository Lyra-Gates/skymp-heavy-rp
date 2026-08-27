# Estado do Projeto — SkyMP Heavy RP

> Última unificação: 2026-08-22. Consolida PR #34 (Profissões), PR #44
> (Economia/Vault), PR #46 (Depot — recuperado de snapshot) e PR #45 (UX)
> em `main`, antes do início do módulo de Justiça.
>
> **Snapshot local vigente (26/08/2026):** [PRODUCTION_READINESS_ACTION_PLAN.md](docs/roadmap/PRODUCTION_READINESS_ACTION_PLAN.md)
> continua sendo a referência operacional. O gamemode possui **1.262 testes,
> todos aprovados**, migrations lineares até **v29**, **80 tabelas
> declaradas** e typecheck limpo. MariaDB e clientes reais não estavam
> disponíveis para homologação. O total agregado de testes de produto e os
> checks externos do snapshot de 24/08 não foram recalculados nesta revisão. O
> parecer de promoção permanece **NO-GO**; ver
> [PRODUCTION_BLOCKERS_2026-08-24.md](docs/operations/PRODUCTION_BLOCKERS_2026-08-24.md).

## O que o framework faz hoje

- **Identidade**: whitelist, aplicação de personagem, credenciais opacas
  (AUTH-003), identidades Discord, revelação de staff.
- **Governança**: cargos, permissões, facções, prisões/custódia, mandados,
  confiscos, multas — módulo `governance-service` + tabelas de
  `migration-v3-governance.sql`.
- **Economia**: ouro 100% virtual via `characters.gold`, ledger de
  transações, tesouraria institucional, mercado regional, dívidas,
  contratos, escrow, anti-cheat de ouro físico
  (`core/economy-physical-sync.js`), limite de auditoria de transação
  grande (`economy.largeTransactionThreshold`).
- **Profissões**: núcleo grant/revoke/rank/XP (`profession-service.js`),
  registry de 13 profissões — nenhuma tem gameplay própria ainda além do
  Minerador (consumidor de `core/profession-registry.js`).
- **Depot** *(recuperado nesta unificação — ver nota abaixo)*: armazenamento
  regional de itens por hold (`core/depot-service.js`), painel de UI
  (`ui/depot-panel.js`), sem reserva de ouro própria e sem checagem de
  combate (nenhum sinal de combate ao vivo existe no projeto).
- **Ambiente**: relógio autoritativo do servidor (GameTime/TimeScale),
  heartbeat de correção de deriva, persistência entre restarts
  (`environment-service.js`). Sem clima.
- **Persistência**: estado de célula / `/dropitem` (Tarefa 9, cell-persistence
  — já estava em `main` antes desta unificação).
- **UX / Interaction Hub** (Tarefa 11): prompt de interação `[E]`
  (`core/interaction-prompt-service.js`), ponte SELF → `/painel`
  (`character-dashboard-bridge.js`) e alvo exato por
  `Game.getCurrentCrosshairRef()` + `mp.onActivate`; sem fallback de
  proximidade. Continua sem homologação no cliente real.
- **Public Work**: domínio e fluxo genérico quadro→origem→destino,
  persistência/idempotência/cooldown/ledger e migration v29. O módulo está
  desligado localmente, sem rotas com FormDesc reais e sem validação MariaDB.
- **Voz**: SkyVoice, sinalização WebSocket, proximidade por célula.
- **Launcher / bootstrap de conexão**: configuração fail-closed dos dois
  contratos SkyMP, sessão opaca sem `profileId` declarado pelo cliente,
  destino direto com `server-info-ignore:true` e criação do SKSE por `spawn`
  confirmada por PID. Coberto por testes e build NSIS; homologação com dois
  clientes reais ainda pendente. Ver
  [ADR-012](docs/technical/ADR_012_LAUNCHER_CONNECTION_BOOTSTRAP.md).
- **Crime & Proveniência** *(adicionado depois desta unificação — ver §
  "O que veio depois" abaixo)*: `item_instances`, item "quente", revista
  institucional, restituição por combat-log.
- **Crafting com gate de profissão + Assinatura do Artesão** *(idem)*:
  `required_profession`/`required_rank` por receita, XP por craft, e a
  Assinatura do Artesão (`crafted_item_signatures`).

Todos os módulos acima nascem **desligados por padrão** (flags `ENABLE_*`
em `.env.example`) e entram na fase `lab` — nenhum populou tráfego real de
jogador ainda.

## Nota sobre o Depot

O Depot Service (Tarefas 9+10) não tinha PR aberta — existia só como commit
de auto-save nunca finalizado (`8e269dd`, "aguardando commit manual") na
branch `feat/depot-service`. Foi localizado durante esta unificação,
extraído como um commit revisável e mesclado via PR #46. O código é
completo e testado (15 testes), mas a integração com Profissões
**não existe ainda**.

## Próximo passo conhecido: ponte Depot ↔ Profissão

O objetivo "Ferreiro Rank 2 acessa depósito de minério raro" não está
implementado. `profession-service.js` e `depot-service.js` não se
referenciam hoje. Fica registrado aqui como trabalho futuro — não foi
implementado nesta unificação para não expandir escopo sem revisão
explícita.

## Débito técnico pré-existente — resolvido em 24/08/2026

Na unificação de 22/08, `node scripts/check-write-guards.js --all` reportava
14 ocorrências: 2 FormDesc com prefixo `0x` e 12 migrations antigas sem teste
que lesse o SQL. Esse registro é histórico. No snapshot vigente de 24/08, os
2 FormDesc e a cobertura das 13 migrations prioritárias foram corrigidos, e o
verificador passou a reportar **zero ocorrências**.

## Validação histórica desta unificação

No marco de 22/08, a validação era de **974 testes do gamemode**, 62 arquivos
de teste registrados e 68 tabelas com migrations lineares até v20. Esses
números preservam a evolução daquele merge; a baseline operacional vigente é
a do cabeçalho deste documento: **1.262 testes do gamemode, todos aprovados,
80 tabelas** e migrations até **v29**.
- Nenhum arquivo untracked/órfão fora do já esperado (`spikes/` já
  versionado; configs locais de `.claude/` fora deste merge).

## O que veio depois desta unificação (21-22/08/2026)

Dois módulos novos, cada um seguindo o mesmo padrão acima (`lab`, flag
própria, desligado por padrão):

- **Crime & Proveniência** (commit `fd68762`, Tarefas 12-13): `item_instances`
  rastreia posse de item roubado, com janela `hot` e restituição automática
  por combat-log; revista institucional da guarda revela o dono original.
  Ver [CRIME_SYSTEM_AUDIT.md](docs/technical/CRIME_SYSTEM_AUDIT.md).
- **Gate de profissão no crafting + Assinatura do Artesão** (commits `c7ddcd7`
  e `e777ede`): o gate `required_profession`/`required_rank` por receita
  existia pronto e testado numa branch órfã (`feat/crafting-profession-integration`,
  20/08) nunca mesclada — trazido em vez de reimplementado, migration
  renumerada de v20 para v23 para não colidir com Depot/Crime. Em cima disso,
  a Assinatura do Artesão (`crafted_item_signatures`, v24): artesão com rank
  suficiente assina o que craft, revista institucional mostra a autoria. Ver
  [MAKERS_MARK.md](docs/design/MAKERS_MARK.md) e
  [CRAFTING_SYSTEM.md](docs/gameplay/CRAFTING_SYSTEM.md).

Estado da suíte naquele marco intermediário: **1069 testes, 255 suítes, 0
falhas**; `check-schema-drift.js --list` seguia linear até v24, sem colisão.
Naquele momento, `check-write-guards.js --all` ainda encontrava as mesmas 14
ocorrências pré-existentes; elas foram resolvidas em 24/08, conforme o snapshot
vigente no cabeçalho.

- **Atalhos de teclado e menus de ação** (22/08/2026, mesmo padrão `lab`):
  substitui parte do fluxo "digite o comando" por tecla e botão, sem
  remover nenhum comando de texto (fallback continua funcionando).
  - **Voz por proximidade**: `Tab` cicla sussurro/normal/grito, `M` muta —
    ligando um backend que já existia mas cujo cliente estava morto (o
    modo de voz e o mute não tinham NENHUM caminho até 22/08, nem tecla
    nem botão). Indicador persistente na CEF. `/modovoz` e `/mutar` como
    fallback de texto. Ver
    [VOICE_MODE_KEY_AUDIT.md](docs/technical/VOICE_MODE_KEY_AUDIT.md).
  - **`F2`** abre o `/painel` (`core/player-shortcuts-service.js`, novo
    módulo `lab`, `ENABLE_PLAYER_SHORTCUTS`).
  - **Trade overlay consertada**: os três botões (aceitar/confirmar/
    cancelar) chamavam um evento sem nenhum listener server-side — agora
    ligados de verdade via `trade-service.js handleUiEvent`.
  - **`death.rescue`** (`/socorrer`) e **`stall.pack`/`stall.remove`**
    (`/stallpack`/`/stallremove`) entram no menu de interação `[E]` —
    o segundo usa `TARGET_TYPES.SELF` (dono agindo sobre a própria
    barraca), com um acoplamento documentado: o resolvedor `SELF` só
    existe atrás de `ENABLE_INTERACTION_PROMPT`, então `market-stalls`
    declara essa dependência como opcional, não obrigatória.
  - **`/profissoes` e `/alma` viram abas do `/painel`** — `soul-service.js`
    já tinha `buildPanelPayload`, só sem painel nenhum chamando.
  - **Modal de escolha** (`browserModal` tipo `'choice'`, novo em
    `commands.sendChoice`): pedido de revista chega com botões
    Aceitar/Recusar, não só texto — `/searchaccept`/`/searchdeny`
    continuam funcionando, o modal é um segundo caminho pro mesmo
    `approveSearch`.

  Nenhum item acima foi validado numa sessão de jogo real — mesma
  ressalva de todo módulo `lab` deste projeto; o que existe é teste
  automatizado (servidor) e, para as partes de CEF que a ferramenta de
  browser conseguiu carregar nesta sessão, verificação num navegador
  comum fora do SkyMP. Plano completo, decisões e o que ficou de fora
  em [PLAYER_ACTION_SHORTCUTS_PLAN.md](docs/technical/PLAYER_ACTION_SHORTCUTS_PLAN.md)
  e [PLAYER_SHORTCUTS_AUDIT.md](docs/technical/PLAYER_SHORTCUTS_AUDIT.md).

  Estado da suíte naquele marco intermediário: **1107 testes, 264 suítes, 0
  falhas**; o typecheck ainda preservava 4 erros pré-existentes. No snapshot
  vigente de 26/08, o gamemode possui **1.262 testes, todos aprovados**,
  e o typecheck do gamemode está limpo. O total agregado de produto não foi
  recalculado nesta revisão.

## Housekeeping de documentação (23/08/2026)

Sem mudança de código. Auditoria de ~150 arquivos `.md` do repositório (local
e branches remotas) achou banners de status desatualizados e conferiu contra
`phase0-basic.js`, não só contra outro documento:

- `docs/gameplay/CONTRACTS.md` e `docs/framework/MODULE_SYSTEM.md` ainda
  diziam PARKED para `jobs`, `crafting` e `trade` — os três têm descritor
  registrado (`moduleRegistry.register`) desde antes ou desde a reativação de
  20/08. PARKED de verdade hoje: `economy-regional`, `housing-service`,
  `horse-service` (commit `a4cb389`).
- Seis documentos de pesquisa de forks em `docs/research/` (três rodadas sobre
  conjuntos diferentes de projetos, não duplicatas) ganharam um índice único
  ([`SKYMP_FORK_RESEARCH_INDEX.md`](docs/research/SKYMP_FORK_RESEARCH_INDEX.md))
  e duas notas de correção onde um fato datado de 14/08 não tinha propagado
  para os documentos de 13/08 que ele corrigia (commit `531233c`).

## Voz nativa fora do CEF (27/08/2026)

O CEF do client recusa `getUserMedia`, então a captura de microfone saiu para um
executável separado, `voice-helper/` (a reprodução continua no navegador do
jogo). Estado atual, tudo em `main`:

- **Captura + relay** (`voice-helper.exe` ↔ `voip-service.js` ↔ `index.html`):
  WASAPI → PCM 20ms → servidor anexa volume por proximidade → CEF toca. Medido
  na bancada (mic real → ouvinte instrumentado), nunca ouvido por uma pessoa.
- **Supressão de ruído**: RNNoise no laço de envio (`--no-denoise` desliga).
- **Opus** no lugar do PCM cru (`codec:"opus"` por quadro, compat com PCM;
  `--pcm` volta ao cru). Decodificado na CEF via WebCodecs `AudioDecoder`.
- **Empacotamento**: `voice-helper.exe` entra no instalador do launcher como
  `resources/vendor/` (build estático `x64-windows-static`, um arquivo), copiado
  para `Data/Platform/` no JOGAR. Fail-open — a voz é opcional.
- **Handoff do ticket**: `/voz` → `senderTicket` na property `voipTicket` → a CEF
  faz POST em `127.0.0.1:19848` → o launcher sobe o helper. O andaime
  `VOIP_DEBUG_EXPOSE_TICKET` fica como fallback de bancada.

Detalhe completo e as verificações em
[`VOICE_NATIVE_HELPER.md`](docs/technical/VOICE_NATIVE_HELPER.md) §8.3–8.7.

### TODO — teste com 2–3 jogadores reais (bloqueia o fechamento desta trilha)

Nada abaixo dá pra verificar sem cliente Skyrim real; o que existe é teste
automatizado e verificação no Chromium do navegador do app (mesma base do CEF
108, mas não o build do SkyrimPlatform):

1. **Inteligibilidade** — alguém fala no microfone e outro jogador ouve voz
   reconhecível, não só "tem sinal" (passo 6 da etapa 8.2 do
   [`FASE_0_ROTEIRO.md`](docs/technical/FASE_0_ROTEIRO.md)).
2. **RNNoise no ouvido** — o ruído de teclado/ambiente de fato cai.
3. **Decode Opus no CEF real** — o `AudioDecoder` (WebCodecs) funciona no CEF do
   client, não só no navegador do app.
4. **`fetch` da CEF pro loopback** — o POST de `file://` para `127.0.0.1:19848`
   passa (PNA/CSP/sandbox do CEF). Se **não** passar, o handoff automático não
   funciona e o fallback `VOIP_DEBUG_EXPOSE_TICKET` **não pode ser removido**.
5. **Cadeia inteira** — `/voz` no jogo → launcher sobe o helper → jogador na
   cena ouve.

Quando (4) e a cadeia passarem, remover o scaffold `VOIP_DEBUG_EXPOSE_TICKET`
(`_exposeDebugTicket`, a flag, a §11 do doc de voz, os testes) — lista exata na
§11.

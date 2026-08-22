# Estado do Projeto — SkyMP Heavy RP

> Última unificação: 2026-08-22. Consolida PR #34 (Profissões), PR #44
> (Economia/Vault), PR #46 (Depot — recuperado de snapshot) e PR #45 (UX)
> em `main`, antes do início do módulo de Justiça.

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
  (`character-dashboard-bridge.js`), resolução por proximidade (não
  raycast — fora do escopo sem fork do SkyMP).
- **Voz**: SkyVoice, sinalização WebSocket, proximidade por célula.
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

## Débito técnico pré-existente (não introduzido por esta unificação)

`node scripts/check-write-guards.js --all` reporta 14 ocorrências, das
quais 2 bloqueariam escrita nova:
- `governance-service.js:857` e `whitelist.js:180` usam FormDesc com
  prefixo `0x` (forma incorreta — ver convenção no cabeçalho de
  `death-service.js`).
- 12 migrations antigas (v3 a v15) sem teste que leia o SQL. Nenhuma das
  migrations desta unificação (v18, v19, v20) está nessa lista — todas têm
  cobertura de teste.

## Validação desta unificação

- `npm test` (skymp/gamemode): **974 testes, 231 suítes, 0 falhas**.
- `check-test-registry.js`: 62 arquivos de teste, todos registrados, nenhum
  órfão.
- `check-schema-drift.js --list`: 68 tabelas, timeline de migrations linear
  (v2 → v20, sem colisão).
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

Estado da suíte depois dos dois: **1069 testes, 255 suítes, 0 falhas**;
`check-schema-drift.js --list` segue linear até v24, sem colisão.
`check-write-guards.js --all` continua nas mesmas 14 ocorrências
pré-existentes (2 bloqueariam escrita nova) — nenhuma nova introduzida.

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

  Estado da suíte depois: **1107 testes, 264 suítes, 0 falhas**; typecheck
  sem erro novo (mesmos 4 pré-existentes de antes desta rodada).

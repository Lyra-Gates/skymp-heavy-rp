# Matriz do ecossistema SkyMP

Data de corte: **2026-08-13**. Cobre os sete projetos de referência nomeados no briefing de pesquisa do ecossistema.

> **Coluna Heavy RP reconciliada contra `b7c929d` (13/08/2026, mesmo dia).** A matriz nasceu marcando Interaction e Contracts como `MISSING`; horas depois, três commits entregaram os frameworks de Interação, Inventário e Economia. As linhas afetadas foram corrigidas e trazem ✅ com a data. **As colunas dos projetos de referência não mudaram** — o que envelheceu foi o nosso lado, não a leitura deles.

> **Esta matriz não substitui [`SKYMP_FORKS_SYSTEM_MATRIX.md`](SKYMP_FORKS_SYSTEM_MATRIX.md).** Aquela cobre oito forks *diferentes* (SkyrimRoleplay/skyrp, enricomalta, F02K, NirnRP, theZebco, FusRoBra, DonAthelion, Pepsiplaya) e continua válida. As duas se somam; nenhum projeto aparece nas duas com veredito conflitante. Onde há sobreposição, esta matriz aponta para lá.

## Procedência: quanto cada coluna foi realmente verificada

A regra do projeto é marcar de onde vem cada afirmação. Sem isso, uma matriz cheia parece conhecimento e é chute.

| Projeto | Profundidade da verificação | O que isso significa |
|---|---|---|
| **Red House** | Leitura de código anterior, 434 linhas | [`REFERENCE_STUDY_SKYMP_RED_HOUSE.md`](../technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md) §4.1 é leitura de fonte |
| **Divine Comedy** | **Completa** — repositório inteiro lido (30 arquivos, 38 KB) | Afirmações são leitura de código |
| **Hijos de las Nieves** | **Completa no que importa** — diff commit a commit contra upstream | Só 7 commits próprios; todos inspecionados ⚠️ desatualizado, ver nota |
| **Mereth** | Documento de design lido; **código não é público** | O repositório é a wiki publicada, não a fonte |
| **Frostfall (TESV-RP)** | **Rasa** — árvore de arquivos + 1 módulo lido | 57 módulos listados, 1 verificado. Ver aviso abaixo |
| **Crows RP** | **Rasa** — árvore de arquivos + README + layout de infra | Nenhum arquivo de lógica lido |
| **Planet Nirn** | Linhagem e histórico de commits | Suficiente: o resultado é que não há o que ler |

> ⚠️ **A linha do Hijos está desatualizada.** [`SKYMP_FORK_DIFF_MATRIX.md`](SKYMP_FORK_DIFF_MATRIX.md) §1.2 (14/08) achou oito branches nunca mescladas com o conteúdo mais relevante para nós — "7 commits" cobre só a `main`.

> ⚠️ **Frostfall e Crows estão sub-pesquisados em relação ao seu valor aparente.** Frostfall tem 57 módulos de gameplay Heavy RP e é o acervo mais denso que o ecossistema tem; Crows tem a stack de operação mais completa. Nenhum dos dois foi lido a fundo. As linhas dessas colunas dizem **o que existe**, não **se é bom**. Aprofundar é a tarefa `RES-001` do roadmap.

## Licenças — barreira antes de qualquer reuso

A regra §14 do briefing: sem licença compatível, não se copia código. Reimplementar a partir do conceito é permitido.

| Projeto | Licença | O que podemos fazer |
|---|---|---|
| Red House | GPL-3.0 | Código reutilizável com atribuição; AGPL-3.0 nossa é compatível |
| Divine Comedy | MIT | Código reutilizável com atribuição; a mais permissiva do conjunto |
| Hijos de las Nieves | GPL-3.0 (declarada no README para conformidade) | Código reutilizável com atribuição |
| **Frostfall (TESV-RP)** | **Ausente** | ⛔ Todos os direitos reservados. **Só conceito.** Não copiar linha |
| **Crows RP** | **Ausente** | ⛔ Todos os direitos reservados. **Só conceito.** Não copiar linha |
| **Mereth** | **Ausente** | ⛔ Todos os direitos reservados. **Só conceito.** Não copiar linha |
| Planet Nirn | Herdada do upstream | Irrelevante: não há código próprio |

Três dos sete não têm licença. Não é detalhe: são justamente os que têm os sistemas que mais nos faltavam. **Tudo que vier deles precisa ser reimplementado a partir da ideia, com registro de origem** — foi exatamente o que aconteceu com contratos e dívida, reimplementados do conceito do Mereth sem uma linha copiada.

## Matriz

Legenda de estado: `ACTIVE` registrado e utilizável · `lab` registrado atrás de flag que nasce desligada · `PARTIAL` incompleto · `PARKED` existe mas não deve ser ligado · `WEAK` insuficiente · `MISSING` ausente · `DEAD` removido de propósito · `—` não existe no projeto · `?` não verificado.

Coluna Heavy RP vem do código em `skymp/gamemode/` no commit `b7c929d`. ⚠️ **O [`HEAVY_RP_GAP_ANALYSIS.md`](HEAVY_RP_GAP_ANALYSIS.md) é de 12/08 e está desatualizado** para inventário, economia, contratos, troca e interação — onde os dois divergirem, esta matriz é a mais nova.

`ACTIVE` aqui significa o mesmo que na auditoria anterior: código registrado e utilizável quando sua flag é deliberadamente ligada. **Nenhum destes sistemas rodou numa sessão com jogadores.**

| Sistema | Heavy RP | Red House | Divine Comedy | Crows | Frostfall | Planet Nirn | Mereth | Hijos | Recomendação |
|---|---|---|---|---|---|---|---|---|---|
| Core | ACTIVE | modules/ | mínimo | backend hexagonal | `index.js`+`bus.js` | — | ? | — | **KEEP** |
| Modules | ACTIVE (`module-registry`) | loader próprio | — | — | `bus.js` | — | — | — | **KEEP** |
| Events | ACTIVE (`ui-event-gateway`) | sim | hooks | — | `bus.js` | — | — | — | **KEEP** |
| Commands | ACTIVE (`command-registry`) | sim | — | — | `commands.js`+sugestões | — | — | — | **ADAPT** sugestão de comando |
| Identity | PARTIAL | — | — | — | `identityOverlay.js` | — | conexão = identidade | — | **KEEP** |
| Characters | PARTIAL | — | seleção + UI | `characters.py` | — | — | — | — | **ADAPT** |
| Inventory | **ACTIVE** (`core/inventory.js`, v14) | sim | — | domínio + adapters | `inventory.js` | — | contagem server-side | — | ✅ **feito 13/08** |
| Trade | **lab** (`ENABLE_TRADE_SERVICE`, nasce `false`) | **sim** | — | — | `commodityExchange.js` | — | escrow | — | ✅ **feito 13/08** |
| Crafting | PARKED (já sobre `core/inventory`) | **sim** | `recipes/`+doc | — | `crafting.js` | — | wiki | — | **REIMPLEMENT** |
| Economy | **ACTIVE** (`core/economy-service.js`, v15) | — | — | — | `economy.js`+`treasury.js` | — | **ledger + dívida** | — | ✅ **feito 13/08** |
| Contracts | **PARKED** (`contracts-service.js`, 7 estados) | — | — | — | `courier.js` | — | **completo** | — | ✅ **feito 13/08**, com divergência |
| Jobs | PARKED | — | mineração | — | `production.js`+`training.js` | — | contratos | — | **RESEARCH** |
| Factions | DEAD | — | — | RBAC | `factions.js`+`college.js` | — | — | — | **REIMPLEMENT** |
| Properties | PARKED (já sobre `core/inventory`) | — | — | — | `housing.js` | — | — | — | **ADAPT** (ver outra matriz) |
| Containers | **ACTIVE** (dono `container` na v14) | sim | — | — | `inventory.js` | — | — | — | ✅ **feito 13/08** |
| Interaction | **ACTIVE** (`core/interaction-*`, ADR-002) | **interactionMenu** | `onActivate` | — | `interactionState.js` | — | — | — | ✅ **feito 13/08** |
| Nametags | ACTIVE | — | — | — | `identityOverlay.js` | — | — | — | **KEEP** |
| Chat | ACTIVE | sim | — | — | `chat.js`+`chatLog.js` | — | — | — | **KEEP** |
| VOIP | PARTIAL (helper nativo) | — | — | — | — | — | — | **flags CEF + LiveKit** | **KEEP** — ver §Segurança |
| Combat | WEAK | — | — | `combat/` | `combat.js`+`pve.js` | — | — | — | **RESEARCH** |
| Death | ACTIVE | — | `onDeath`+UI | — | `captivity.js` | — | — | — | **KEEP** |
| Spawn | ACTIVE | — | **hook `onPlayerSpawn`** | — | — | — | — | — | **UPSTREAM** |
| NPC | WEAK | — | — | — | — | — | sem NPC por design | — | **RESEARCH** |
| Admin | ACTIVE | — | — | painel + elevação | `reports.js` | — | — | — | **ADAPT** |
| Permissions | ACTIVE | — | — | **RBAC + audit** | `permissions.js` | — | — | — | **ADAPT** ⭐ |
| Whitelist | ACTIVE | — | — | — | — | — | — | — | **KEEP** |
| Launcher | PARTIAL (Electron) | — | — | **C#/WPF + Velopack** | — | — | — | — | **ADAPT** (não portar) |
| Mod Sync | PARTIAL | — | `sync-client.mjs` | **ModSync + hash + canais** | `modSourceRegistry.js` | — | nada a instalar | — | **ADAPT** ⭐ |
| Backend | ACTIVE | — | — | FastAPI hexagonal | Express | — | — | — | **KEEP** |
| Database | ACTIVE (MariaDB) | — | — | Postgres + Redis | — | — | — | — | **KEEP** |
| Audit Logs | ACTIVE | — | — | `audit.py` | `auditLog.js` | — | notas de dívida | — | **KEEP** |
| Deploy | WEAK | — | — | **Docker Compose** | — | — | — | — | **ADAPT** |
| Monitoring | WEAK | — | — | métricas | `engineProbes.js` | — | — | — | **ADAPT** |
| CI/CD | PARTIAL | — | — | **Actions + Velopack** | — | — | — | build SP em CI | **ADAPT** |
| Patching | **ACTIVE** (`patches/` + validador na CI) | fork próprio | **`patches/` + README** | — | — | — | — | fork disciplinado | ✅ **feito 13/08** |
| SkyrimPlatform | consumidor | fork | 1 patch | — | — | espelho | — | **APIs de montaria** | **PORT** ⭐ |
| Papyrus | não usamos | **sim, pesado** | — | — | `papyrusBridge.js` | — | — | — | **REJECT** |

⭐ = maior valor. Detalhamento em [`SKYMP_ECOSYSTEM_DEEP_DIVE.md`](SKYMP_ECOSYSTEM_DEEP_DIVE.md).

## Os cinco achados que mudam decisão

1. **`SkyrimPlatform` de montaria (Hijos) — `PORT`.** `setMountedPairKinematicTransform(horse, rider, lease, serial, …)` e `setCharacterControllerCollisionProfile(actor, profile, lease)` resolvem exatamente o bloqueio que mantém `horse-service.js` em PARKED ("estado compartilhado e ownership não resolvidos"). E chegaram sozinhos ao padrão *lease + serial* que nossa auditoria já tinha recomendado. GPL-3.0, portável.

2. **Contratos (Mereth) — `REIMPLEMENT`. ✅ Feito no mesmo dia, e a implementação corrigiu a recomendação.** O desenho aqui saiu com **sete** estados, não oito: `contracts-service.js` derruba o `defaulted`, e a justificativa é boa. Com escrow travado no post, o ouro sai *antes* de o contrato existir — então não há como um contrato ficar impagável, e o estado deixa de poder acontecer. O Mereth precisa dele porque oferece contratos *unfunded*, onde o cliente paga na entrega; nós escolhemos só os funded. **A leitura de referência estava certa sobre o mecanismo e errada sobre o número de estados** — copiar os oito teria trazido um estado morto. Dívida saiu junto, em `debt-service.js`, como registro selado sem cobrança automática. Ambos `PARKED`.

3. **Interaction (Red House + Frostfall) — `REIMPLEMENT`. ✅ Feito no mesmo dia.** `core/interaction-registry.js`, `interaction-targets.js` e `interaction-service.js`, com [`ADR-002`](../technical/ADR_002_INTERACTION_FRAMEWORK.md). Módulos declaram as próprias ações e a governança deixou de conhecer o módulo de barracas. Só `player` tem resolvedor; os outros seis tipos de alvo são vocabulário reservado que falha fechado — pelo mesmo critério que esta matriz usa para marcar `?`: parecer pronto é pior que faltar.

4. **Índice de plugin (Divine Comedy) — já sabíamos, e sabíamos melhor.** Ver seção abaixo.

5. **Planet Nirn — `REJECT`.** Nenhum commit próprio; é `skyrim-roleplay/skymp` rebrandado, e esse já está pesquisado como "SkyrimRoleplay/skyrp" na outra matriz. A frente de pesquisa de "sync multiplayer" pedida no briefing não tem onde acontecer aqui.

## Onde nós estamos à frente

Registrar isso importa tanto quanto registrar lacuna — a regra §28 é não reescrever o que já é melhor.

- **Índice de plugin.** O Divine Comedy descobriu que o Skyrim AE carrega Creation Club sozinho, desalinha os índices entre cliente e servidor e quebra portas e records com `FromFormId failed due to invalid file index`. Nós já documentamos a mesma falha como **QA 2.15** em [`FASE_0_LOG_2026-08-06.md`](../roadmap/FASE_0_LOG_2026-08-06.md), com um diagnóstico mais preciso: *não dá erro nenhum — dá um baú com outra coisa dentro*. A solução deles (esvaziar `Skyrim.ccc`) é frágil pelo motivo que eles mesmos anotam: o Steam restaura o arquivo. A nossa (fixar cinco masters e verificar por hash) é melhor. **`KEEP`** — com uma ressalva real na seção seguinte.

- **Voz.** Os flags CEF do Hijos (`use-fake-ui-for-media-stream`, `auto-accept-camera-and-microphone-capture`, `allow-running-insecure-content`, `allow-file-access-from-files`) fazem o microfone funcionar dentro do overlay **removendo o consentimento e o isolamento de origem do Chromium**. Qualquer conteúdo carregado no overlay passa a poder capturar áudio em silêncio. Nossa escolha de tirar a captura do CEF e levar para WASAPI nativo evita essa classe inteira. **`KEEP`, e é uma validação independente da decisão** — mas o helper nativo continua sem prova de que alguém ouviu alguém ([`VOICE_NATIVE_HELPER.md`](../technical/VOICE_NATIVE_HELPER.md) §8.2).

- **Fronteira transacional.** Nenhum dos três projetos sem licença demonstra idempotência ou ledger append-only no que dá pra ver de fora. Nosso `transaction-service` e `institutional-treasury-service` já são mais rigorosos que qualquer coisa visível nas árvores deles. Mereth é a exceção conceitual — descreve escrow atômico —, mas o código não é público.

## O risco que o Divine Comedy expõe e que nós não cobrimos

Nossa mitigação de índice de plugin é *fixar cinco masters e verificar hash*. Ela é sólida para a Fase 0. Mas ela cobre **o que está em `Data/`**, e o achado deles é sobre **o que o jogo carrega sozinho, sem passar por `Data/`**.

`Skyrim.ccc` é lido pelo executável em runtime. Seu conteúdo varia conforme o conteúdo Creation Club que **aquela conta Steam possui** — não é o mesmo arquivo para dois testadores. Um verificador de manifesto que só olha `Data/` não vê isso. E `docs/MODPACK.md` planeja o modpack oficial *incluindo* Creation Club nos masters base, o que torna o problema pior e não melhor: passa a depender de todo jogador ter exatamente as mesmas licenças de CC.

Isso não é bug hoje — a Fase 0 exige os cinco masters e nada mais, e o `plugins.fase0.txt` diz isso em letras maiúsculas. É uma **armadilha para quando o modpack oficial for montado**, exatamente o momento em que `plugins.fase0.txt` "morre" segundo o próprio arquivo.

Encaminhamento: `MOD-005` no roadmap. Não é código para agora; é um requisito para o gate do modpack.

## Sistemas rejeitados

| Sistema | Origem | Por quê |
|---|---|---|
| Papyrus como camada de gameplay | Red House, Frostfall | Nosso gamemode resolve em JS server-authoritative. Papyrus roda no cliente: é superfície de trust que não precisamos abrir |
| Fork pesado do SkyMP | Planet Nirn, Red House | Custo de rebase permanente. Preferência: upstream → adapter → patch registrado |
| Flags CEF para microfone | Hijos | Remove consentimento e isolamento de origem. Helper nativo já resolve melhor |
| Mongo como persistência | (matriz anterior) | MariaDB é a fonte relacional oficial |
| Portar o launcher C#/WPF | Crows | Nosso launcher é Electron. Portar é reescrever; adaptar a arquitetura de ModSync não é |

## Fontes primárias

Consultadas em 2026-08-13 via GitHub API, autenticada.

- `miguelAngeloo/TheDivineComedy` — árvore completa, `patches/spawn.ts`, `patches/Skyrim.ccc.README.txt`, `README.md`, `sync-client.mjs`. Último push 2026-07-30.
- `hijosdelasnieves/hijosdelasnieves-RP` — histórico de commits e diffs de `a6b5bede`, `2e6c5163`, `151ba07f`, `601b51c2`, `8459f07b`. Último push 2026-07-29.
- `YimitKEQ/mereth-contracts` — `README.md` e o documento de design publicado em `yimitkeq.github.io/mereth-contracts`. Último push 2026-08-13.
- `qalamabdulkhaliq/TESV-RP` — árvore completa, `Frostfall-Server/gamemode/loadOrderGate.js`. Último push 2026-05-17.
- `LucasMagnoSP/Crows-RP` — árvore completa, `README.md`. Último push 2026-08-12.
- `Legacy7K/Planet-Nirn-RP` — linhagem de fork e histórico de commits. Último push 2026-06-09.
- `alekcey0211/red-house-public` — via estudo local anterior. Último push 2021-11-16.

Números de divergência e datas são snapshots e vão mudar.

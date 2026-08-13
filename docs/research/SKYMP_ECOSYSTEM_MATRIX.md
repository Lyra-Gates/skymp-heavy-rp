# Matriz do ecossistema SkyMP

Data de corte: **2026-08-13**. Cobre os sete projetos de referência nomeados no briefing de pesquisa do ecossistema.

> **Esta matriz não substitui [`SKYMP_FORKS_SYSTEM_MATRIX.md`](SKYMP_FORKS_SYSTEM_MATRIX.md).** Aquela cobre oito forks *diferentes* (SkyrimRoleplay/skyrp, enricomalta, F02K, NirnRP, theZebco, FusRoBra, DonAthelion, Pepsiplaya) e continua válida. As duas se somam; nenhum projeto aparece nas duas com veredito conflitante. Onde há sobreposição, esta matriz aponta para lá.

## Procedência: quanto cada coluna foi realmente verificada

A regra do projeto é marcar de onde vem cada afirmação. Sem isso, uma matriz cheia parece conhecimento e é chute.

| Projeto | Profundidade da verificação | O que isso significa |
|---|---|---|
| **Red House** | Leitura de código anterior, 434 linhas | [`REFERENCE_STUDY_SKYMP_RED_HOUSE.md`](../technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md) §4.1 é leitura de fonte |
| **Divine Comedy** | **Completa** — repositório inteiro lido (30 arquivos, 38 KB) | Afirmações são leitura de código |
| **Hijos de las Nieves** | **Completa no que importa** — diff commit a commit contra upstream | Só 7 commits próprios; todos inspecionados |
| **Mereth** | Documento de design lido; **código não é público** | O repositório é a wiki publicada, não a fonte |
| **Frostfall (TESV-RP)** | **Rasa** — árvore de arquivos + 1 módulo lido | 57 módulos listados, 1 verificado. Ver aviso abaixo |
| **Crows RP** | **Rasa** — árvore de arquivos + README + layout de infra | Nenhum arquivo de lógica lido |
| **Planet Nirn** | Linhagem e histórico de commits | Suficiente: o resultado é que não há o que ler |

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

Três dos sete não têm licença. Não é detalhe: são justamente os que têm os sistemas que mais nos faltam (contratos, economia regional, launcher). **Tudo que vier deles precisa ser reimplementado a partir da ideia, com registro de origem.**

## Matriz

Legenda de estado: `ACTIVE` registrado e utilizável · `PARTIAL` incompleto · `PARKED` existe mas não deve ser ligado · `WEAK` insuficiente · `MISSING` ausente · `DEAD` removido de propósito · `—` não existe no projeto · `?` não verificado.

Coluna Heavy RP vem de [`HEAVY_RP_GAP_ANALYSIS.md`](HEAVY_RP_GAP_ANALYSIS.md) e do código em `skymp/gamemode/`.

| Sistema | Heavy RP | Red House | Divine Comedy | Crows | Frostfall | Planet Nirn | Mereth | Hijos | Recomendação |
|---|---|---|---|---|---|---|---|---|---|
| Core | ACTIVE | modules/ | mínimo | backend hexagonal | `index.js`+`bus.js` | — | ? | — | **KEEP** |
| Modules | ACTIVE (`module-registry`) | loader próprio | — | — | `bus.js` | — | — | — | **KEEP** |
| Events | ACTIVE (`ui-event-gateway`) | sim | hooks | — | `bus.js` | — | — | — | **KEEP** |
| Commands | ACTIVE (`command-registry`) | sim | — | — | `commands.js`+sugestões | — | — | — | **ADAPT** sugestão de comando |
| Identity | PARTIAL | — | — | — | `identityOverlay.js` | — | conexão = identidade | — | **KEEP** |
| Characters | PARTIAL | — | seleção + UI | `characters.py` | — | — | — | — | **ADAPT** |
| Inventory | PARTIAL | sim | — | domínio + adapters | `inventory.js` | — | contagem server-side | — | **REIMPLEMENT** |
| Trade | PARKED | **sim** | — | — | `commodityExchange.js` | — | escrow | — | **REIMPLEMENT** |
| Crafting | PARKED | **sim** | `recipes/`+doc | — | `crafting.js` | — | wiki | — | **REIMPLEMENT** |
| Economy | PARTIAL | — | — | — | `economy.js`+`treasury.js` | — | **ledger + dívida** | — | **ADAPT** |
| Contracts | **MISSING** | — | — | — | `courier.js` | — | **completo** | — | **REIMPLEMENT** ⭐ |
| Jobs | PARKED | — | mineração | — | `production.js`+`training.js` | — | contratos | — | **RESEARCH** |
| Factions | DEAD | — | — | RBAC | `factions.js`+`college.js` | — | — | — | **REIMPLEMENT** |
| Properties | PARKED | — | — | — | `housing.js` | — | — | — | **ADAPT** (ver outra matriz) |
| Containers | PARTIAL | sim | — | — | `inventory.js` | — | — | — | **REIMPLEMENT** |
| Interaction | **MISSING** | **interactionMenu** | `onActivate` | — | `interactionState.js` | — | — | — | **REIMPLEMENT** ⭐ |
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
| Patching | **MISSING** | fork próprio | **`patches/` + README** | — | — | — | — | fork disciplinado | **ADAPT** ⭐ |
| SkyrimPlatform | consumidor | fork | 1 patch | — | — | espelho | — | **APIs de montaria** | **PORT** ⭐ |
| Papyrus | não usamos | **sim, pesado** | — | — | `papyrusBridge.js` | — | — | — | **REJECT** |

⭐ = maior valor. Detalhamento em [`SKYMP_ECOSYSTEM_DEEP_DIVE.md`](SKYMP_ECOSYSTEM_DEEP_DIVE.md).

## Os cinco achados que mudam decisão

1. **`SkyrimPlatform` de montaria (Hijos) — `PORT`.** `setMountedPairKinematicTransform(horse, rider, lease, serial, …)` e `setCharacterControllerCollisionProfile(actor, profile, lease)` resolvem exatamente o bloqueio que mantém `horse-service.js` em PARKED ("estado compartilhado e ownership não resolvidos"). E chegaram sozinhos ao padrão *lease + serial* que nossa auditoria já tinha recomendado. GPL-3.0, portável.

2. **Contratos (Mereth) — `REIMPLEMENT`.** É o único domínio da matriz onde estamos em `MISSING` e existe uma referência madura. Máquina de estados de oito estados, escrow atômico no post, e dívida como registro selado em vez de fila de staff. Sem licença: reimplementar do conceito.

3. **Interaction (Red House + Frostfall) — `REIMPLEMENT`.** Dois projetos independentes construíram menu de interação. Nós não temos nenhum, e é a fundação de §18 do briefing. Red House é GPL-3.0 e legível.

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

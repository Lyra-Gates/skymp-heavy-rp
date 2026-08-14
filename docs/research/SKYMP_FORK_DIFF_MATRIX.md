# Matriz de diff dos forks do SkyMP

Data: **2026-08-14**. Base de comparação: `skyrim-multiplayer/skymp@d85f18d8` (main, 06/08/2026).

Companheiro de [`SKYMP_ECOSYSTEM_MATRIX.md`](SKYMP_ECOSYSTEM_MATRIX.md) (licenças e profundidade de verificação) e [`SKYMP_ECOSYSTEM_DEEP_DIVE.md`](SKYMP_ECOSYSTEM_DEEP_DIVE.md) (leitura por projeto). **A diferença desta rodada é o método:** as anteriores leram árvores e READMEs; esta comparou commits pela API do GitHub e leu o fonte upstream em clone local.

Isso mudou duas conclusões que estavam registradas como fato.

---

## 1. As duas correções

### 1.1 O "fork do Red House" não tem nenhum commit próprio na `main`

`russo-2025/skymp` está **0 commits à frente e 1226 atrás** do upstream na branch `main`. Não é um fork mantido: é um espelho parado em 19/09/2022.

O trabalho do Red House existe, mas em **branches**, e nenhuma delas é a padrão. `RH` está 35 à frente / 1673 atrás; `RH-v3`, 12 à frente; `capi`, 19; `add-ui-api`, 14.

Quem apontar "o fork do Red House" pela URL padrão está apontando para upstream velho. Isso vale para o nosso próprio [`REFERENCE_STUDY_SKYMP_RED_HOUSE.md`](../technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md), que trata `skyrim-roleplay/skymp` como "fork atual usado como referência de core" — e esse repositório também está **0 à frente / 109 atrás**. Também é espelho.

### 1.2 O Hijos tem muito mais que sete commits

O deep dive de 13/08 registrou "7 commits próprios, todos na `main`". Está desatualizado: a `main` recebeu o merge do trabalho de montaria em 13/07 (`ff7c5868`), e há **oito branches** com trabalho que nunca foi para a `main` — e é nelas que estão as coisas mais interessantes para nós.

| Branch | À frente | O que traz de novo |
|---|---|---|
| `fix/cursor-hotspot-ultrawide-20260729` | 13 | Ponta atual. Cursor em ultrawide + recuperação de transição de menu Tween |
| `feature/vendor-real-previews-native` | 12 | `ItemPreviewApi.cpp/.h` — preview real de item renderizado para o CEF, lendo BSA |
| `fix/hdn-vanilla-authority-20260725` | 9 | `HdnVanillaMenuPolicy.cpp/.h` — autoridade *fail-closed* sobre menus vanilla |
| `fix/logger-native-bar-20260723` | 8 | Barra de tempo do logger renderizada nativamente, **com teste unitário** (`unit/HdnLoggerNativeBarModelTest.cpp`) |
| `fix/arcane-magic-input-gate-20260722` | 6 | Portão de input do menu de magia vanilla |
| `fix/mount-horse-only-rider-natural-20260720` | 4 | Postura natural do cavaleiro |
| `fix/mount-loadgame-lifecycle-20260719` | 3 | Ciclo de vida da montaria através de `loadGame` |
| `hdn/build-skyrim-platform` | 0 | Já mesclada |

As branches são cumulativas — a de cursor contém as anteriores. **A ponta real do projeto é `fix/cursor-hotspot-ultrawide-20260729`, não a `main`.**

---

## 2. A matriz

Campos conforme o briefing §4. `Ainda relevante` responde *contra `d85f18d8`*, não contra a data do fork.

| Projeto | Commit base | Subsistema alterado | Motivo | Ainda relevante | Equivalente upstream | Valor p/ Heavy RP | Risco |
|---|---|---|---|---|---|---|---|
| **Divine Comedy** | não declarado; diff manual de `spawn.ts` | `skymp5-server/ts/systems/spawn.ts` | Gamemode não decide onde o jogador nasce | **Sim** — não há hook em `d85f18d8` | Nenhum | **Baixo** — resolvemos por correção pós-spawn em `cd1fb6a` | Baixo. Patch pequeno e *upstreamable* |
| **Divine Comedy** | n/a (arquivo do jogo) | `Skyrim.ccc` esvaziado | CC ocupa índices 05–0E e desalinha plugin entre cliente e servidor | **Sim**, e o diagnóstico deles bate com o nosso fonte | Nenhum | **Alto como diagnóstico, zero como solução** | Alto. Reverte na verificação do Steam |
| **Divine Comedy** | n/a | `sync-client.mjs` | Copiar `client/src` por cima de `skymp5-client/src` | — | — | **`REJECT`** | Alto. Sobrescrita silenciosa, caminho absoluto da máquina do autor |
| **Hijos** `2e6c5163`, `151ba07f`, `601b51c2` | mesclados na `main` | `ObjectReferenceApi.cpp/.h` | Colisão e transform de par montado; perfil de colisão persistente | **Sim** | Nenhum | **Alto** — é o `native spike` que `horse-service.js` pede | Alto. ~700 linhas em character controller e Havok |
| **Hijos** `c893ab9d` | `fix/hdn-vanilla-authority-20260725` | `HdnVanillaMenuPolicy.cpp/.h`, `EventHandler.cpp` | Menus vanilla abrindo por cima da UI do servidor | **Sim** | Nenhum. Upstream só esconde o browser (`browserService.badMenus`) | **Alto** — mesmo problema do nosso menu de interação | Médio. Arquivo novo, pouco acoplamento |
| **Hijos** `e661ceee` | `feature/vendor-real-previews-native` | `ItemPreviewApi.cpp/.h`, leitura de BSA | CEF não consegue mostrar o item de verdade | **Sim** | Nenhum | **Médio** — vitrine de barraca e inventário | Médio. Lê BSA em runtime |
| **Hijos** `ea5134ce` + `HdnLoggerNativeBarModelTest.cpp` | `fix/logger-native-bar-20260723` | `DX11RenderHandler`, `unit/` | Diagnóstico de tempo sem depender do CEF | Sim | Nenhum | **Baixo**, mas é o único código do ecossistema com teste unitário de C++ de cliente | Baixo |
| **Hijos** `a6b5bede` (flags CEF) | `main` | `MyChromiumApp::OnBeforeCommandLineProcessing` | Sem UI para responder o diálogo de permissão de mídia | Sim para eles | Nenhum | **`REJECT`** — já registrado como `SEC-CEF-01` | **Alto.** Remove consentimento e isolamento de origem |
| **Hijos** `752ae63e`, `164e1b4c` | `main` | GitHub Actions do SkyrimPlatform | Build de ~40 min por execução | Sim | Nenhum | **Médio** — só importa se compilarmos o SP, e `MOUNT-001` exige isso | Baixo |
| **Red House** `RH` (35 commits, 2021-10) | ~1673 atrás | `server_guest_lib`, `skymp5-client/src/front`, `unit/` | Ver §4 | **Não** | — | **Baixo** | Alto. Reverte a autoridade de servidor |
| **Red House** `capi` (19), `add-ui-api` (14), `add-ultralight` (2) | 2021–2022 | API C, API de UI, Ultralight no lugar do CEF | Experimentos | **Não** | `sendCustomPacket`, CEF atual | Baixo | Alto. Abandonados |
| **skyrim-roleplay/skymp** | 0 à frente / 109 atrás | — | — | — | — | **Nenhum**. É espelho | — |
| **Planet Nirn** | fork de `skyrim-roleplay/skymp`, 1 commit próprio (`README`) | — | — | — | — | **Nenhum** | — |

---

## 3. The Divine Comedy — as cinco perguntas do briefing §5

O `patches/` deles tem três arquivos: `spawn.ts`, `Skyrim.ccc.original` e `Skyrim.ccc.README.txt`.

### `spawn.ts` — hook `onPlayerSpawn`

**Qual problema?** O gamemode não decide onde o jogador nasce.

**Por que o upstream não resolvia?** Porque não resolve. Verificado em `d85f18d8`: `Spawn.initAsync` sorteia um `startPoint` e chama `createActor` sem consultar o gamemode.

**A versão atual ainda tem o problema?** Sim — e a auditoria encontrou uma armadilha que ninguém tinha registrado. O sistema faz `ctx.gm.on("spawnAllowed", listenerFn)` **e também** `(ctx.svr as any)._onSpawnAllowed = listenerFn`. Como o gamemode recebe `mp === svr`, `mp._onSpawnAllowed` parece um ponto de extensão. **Não é:** o emitter guarda a referência da função, então sobrescrever a property não intercepta coisa alguma. Só serve para *chamar* o spawn, não para substituí-lo. Detalhe em [`SKYMP_INTEGRATION_AUDIT.md`](SKYMP_INTEGRATION_AUDIT.md) §3.1.

**Há issue/PR upstream?** Não encontrado.

**Dá para resolver externamente?** Sim, e já resolvemos: corrigir posição depois do spawn com `mp.set(actorId, 'pos' | 'worldOrCellDesc', …)`. Custa um frame de teleporte e não custa patch. É o que `cd1fb6a` fez.

**Veredito: `UPSTREAM` se algum dia precisarmos do hook de verdade; `KEEP` no que temos.**

### `Skyrim.ccc` — o diagnóstico que vale mais que o patch

O README deles nomeia o erro exato:

> "Those plugins occupied indices 05 to 0E and misaligned the plugin indices between client and server, causing the error `FromFormId failed due to invalid file index`."

Essa string existe no upstream, em `FormDesc.cpp`, dentro do `throw` de `FormDesc::FromFormId`. **O relato de campo deles e a leitura do nosso fonte se encontram na mesma linha de C++.** É a confirmação mais forte que esta rodada produziu, e ela vale para o nosso `MOD-005`.

Eles também dizem `~10 .esm + several .esl` — e o SkyMP não tem tratamento nenhum de `.esl`. Ver [`PLUGIN_LOAD_ORDER_STRATEGY.md`](../technical/PLUGIN_LOAD_ORDER_STRATEGY.md).

**A solução deles continua `REJECT`**, pelo motivo que eles mesmos escrevem: reverte quando o Steam verifica os arquivos. Isso é ambiente de jogo, não patch de código — e é justamente por isso que `patches/README.md` proíbe a categoria.

---

## 4. Red House — o fork que anda para trás

O briefing §7 pedia investigar o fork do Red House e **não considerar automaticamente válidas as alterações históricas**. A investigação encontrou algo mais forte que "desatualizado".

Dos 35 commits da branch `RH`, **treze são reverts de features do upstream**:

```
Revert "feat(skymp5-server): parse and handle hit events (#309)"
Revert "feat(skymp5-client): transfer hit event to server (#295)"
Revert "feat(skymp5-server): damage character's health on server by fixed value (#321)"
Revert "feat(skymp5-server): make damage weapon-dependent (#317)"
Revert "feat(skymp5-server): make unarmed damage race dependent (#318)"
Revert "feat(skymp5-server): check weapon radius availability (#319)"
Revert "feat(skymp5-client) add local damage resist (#325)"
Revert "fix(skymp5-server): take into account NPC_ offsets of Actor Values (#310)"
Revert "feat: binary format for UpdateMovement (#173)"
Revert "feat(skymp5-server): remove everything related to sqlite from codebase (#322)"
…
```

Isto é a camada de **combate autoritativo no servidor** sendo desfeita, em outubro de 2021, enquanto o upstream a construía.

Para um projeto cuja tese inteira é autoridade de servidor, adotar a direção do Red House não seria adotar um fork antigo — seria adotar a decisão oposta à nossa. O resto da branch é anti-cheat de cliente (`disable console`, `disable ctrl+prtScn`, `disable Mod Manager Menu` e `Creation Club Menu`), carregar `skymp5-client.js` do servidor, e APIs pequenas (`consoleMessage`, `QuitGame`, `SetFirstPersonFOV`, `SetWorldFOV`, `reloot`).

**O que sobrevive como ideia, não como código:**

- **Desligar o console e os menus de Mod Manager / Creation Club** é decisão de produto defensável num servidor RP, e hoje o upstream tem `enableConsoleCommandsForAll` cobrindo parte disso por configuração;
- **Carregar o script de cliente do servidor** virou, no upstream, o sistema de event source com verificação de assinatura — mais estreito e mais seguro que a versão deles.

**Veredito geral: `REJECT` para o fork. O [estudo de 2021](../technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md) continua valendo como leitura de gamemode RP; o fork em si, não.**

---

## 5. Hijos de las Nieves — separando o que a licença publica do que o servidor esconde

O briefing §6 pede separar *código publicado por exigência de licença* de *gameplay privado*. A separação é limpa e o próprio README declara: **o repositório contém apenas modificações de build do SkyrimPlatform; o gameplay é mantido separado e não é público.**

Confere. Todas as branches tocam exclusivamente `skyrim-platform/`, `savefile/` e `unit/`. Nenhuma toca `skymp5-server/ts` ou gamemode.

Isso torna o projeto o mais fácil de auditar do ecossistema — e o mais fácil de reusar, porque GPL-3.0 é compatível com nossa AGPL-3.0 para combinação, com atribuição e registro de origem.

### O achado novo: `HdnVanillaMenuPolicy`

`c893ab9d — feat(skyrim-platform): enforce fail-closed vanilla menu authority`.

O problema que ele resolve é o nosso. O upstream trata menus vanilla escondendo o browser quando um deles abre (`browserService.ts`, lista `badMenus` com quinze entradas). É reativo e é lista negra: **menu que não está na lista passa por cima da UI do servidor.** A resposta do Hijos é uma política de autoridade *fail-closed* — o oposto, e a mesma filosofia do nosso `server-options` e do nosso `interaction-registry`.

Nosso menu de interação em CEF é hoje, por admissão do próprio roadmap, *a maior superfície não exercitada do projeto*. Quando ele for a jogo, o conflito com menus vanilla é a primeira coisa que aparece. Existe código GPL-3.0 lido e formatado por outra equipe atacando exatamente isso.

**`RESEARCH` → `PORT` candidato. Vira `HDN-001`, depois da Fase 0 e depois de `MOUNT-001`** — as duas mexem nos mesmos arquivos (`EventHandler.cpp`, `SkyrimPlatform.cpp`), e portar as duas separadas duplicaria conflito.

### `ItemPreviewApi` — preview real de item no CEF

`e661ceee`, com dois commits de correção de build. Renderiza o item de verdade, lendo o BSA, e entrega ao CEF.

É o que faltaria para a vitrine de barraca de mercado e para um inventário que não seja lista de texto. **`RESEARCH`, sem prioridade** — é qualidade de vida, e a Fase 0 vem antes de tudo.

---

## 6. Licenciamento, com precisão que faltava

A leitura do clone corrige a formulação solta de "GPLv3/AGPLv3" que nossos documentos usam. O upstream declara **uma licença por subprojeto**:

| Subprojeto | Licença | O que isso permite |
|---|---|---|
| `skymp5-server` | **AGPL-3.0** | O que rodamos. Compatível com a nossa; obriga fonte disponível para uso em rede |
| `skymp5-client` | GPL-3.0 | |
| `skymp5-front` | GPL-3.0 | |
| `skyrim-platform` | GPL-3.0 | É a licença que rege os ports do Hijos |
| `libespm` | **MIT** | Parser de ESM/ESP. **Reusável sem copyleft** |
| `papyrus-vm` | **MIT** | VM Papyrus. **Reusável sem copyleft** |
| `skymp5-functions-lib` | **MIT** | |

`libespm` e `papyrus-vm` serem MIT é notícia nova e prática: se algum dia precisarmos de um parser de ESM ou de um interpretador Papyrus fora do servidor — por exemplo num validador de modpack do launcher — dá para usar o do SkyMP sem arrastar copyleft para o launcher.

O `LICENSE_AND_AFFILIATION_POLICY.md` precisa desta tabela.

---

## 7. E a mudança que ninguém tinha visto: agora existe um CAA

Em **18/07/2026**, o commit `8e1fecbd` (PR #2783) adicionou `CLA.md` ao upstream: um **Contributor Assignment Agreement** no modelo Harmony, assinado por bot de CLA no primeiro pull request.

Não é um CLA de licença. É **cessão de direito autoral** para a *Limited Liability Partnership "POSPELOV SOFT"*, BIN 230440011026, do Cazaquistão. A §2.3 permite à empresa relicenciar a contribuição sob **qualquer** licença — "copyleft, permissive, commercial, or proprietary" — desde que também a licencie sob a licença vigente na data da submissão.

Isso é anterior a toda a nossa pesquisa (05/08 e 13/08) e passou despercebido nas duas rodadas.

**Consequência direta para a política de patch:** o degrau "PR upstream" da escada deixou de ser gratuito. Continua sendo o degrau certo em muitos casos, mas agora é uma decisão com custo — e uma que a pessoa que abre o PR assina no próprio nome. Tratado em [`SKYMP_PATCH_POLICY.md`](../technical/SKYMP_PATCH_POLICY.md) §5.

---

## 8. O que esta rodada não mudou

O veredito de sempre: **não trocar de base, não importar fork inteiro.** Três rodadas de pesquisa, três vezes a mesma conclusão, agora por comparação de commits em vez de leitura de árvore.

O que mudou é o custo de descobrir isso de novo: nenhum. Os números de ahead/behind desta matriz são reproduzíveis num comando:

```bash
gh api "repos/skyrim-multiplayer/skymp/compare/main...russo-2025:RH" --jq '{ahead:.ahead_by,behind:.behind_by}'
```

E a lição de método, que é a mesma de duas rodadas atrás com outro nome: **branch padrão de fork não é o fork.** Duas das três referências que nossos documentos chamavam de "fork usado como base" são espelhos sem um commit próprio, e o projeto registrado com "sete commits" tem treze na `main` e mais treze numa branch que a `main` não vê.

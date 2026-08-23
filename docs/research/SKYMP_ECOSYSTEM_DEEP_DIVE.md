# Deep dive do ecossistema SkyMP

Data: **2026-08-13**. Companheiro de [`SKYMP_ECOSYSTEM_MATRIX.md`](SKYMP_ECOSYSTEM_MATRIX.md), que traz a matriz, as licenças e a profundidade de verificação de cada projeto. **Leia a tabela de procedência de lá antes de confiar em qualquer linha daqui.**

---

## 1. Sumário executivo

Sete projetos de referência foram examinados. Quatro nunca tinham sido pesquisados (Divine Comedy, Crows RP, Mereth, Hijos de las Nieves), um estava pesquisado sob outro nome, um se revelou vazio, e um já tinha estudo dedicado.

**O veredito não mudou:** não trocar de base, não importar fork inteiro. Isso já era a conclusão da [auditoria de forks de 12/08](SKYMP_FORK_RESEARCH_EXECUTIVE_SUMMARY.md) e nada nesta rodada a contradiz. O que mudou é que apareceram **quatro itens acionáveis** que aquela auditoria não tinha como ver.

| # | Achado | Origem | Classe | Estado |
|---|---|---|---|---|
| 1 | APIs nativas de par montado com *lease*/*serial* | Hijos de las Nieves | `PORT` | pendente — destrava `horse-service.js` |
| 2 | Máquina de estados de contrato com escrow e dívida | Mereth | `REIMPLEMENT` | ✅ **feito 13/08**, com sete estados e não oito |
| 3 | Menu de interação registrável por módulo | Red House + Frostfall | `REIMPLEMENT` | ✅ **feito 13/08** (`ADR-002`) |
| 4 | Disciplina de `patches/` versionada | Divine Comedy | `ADAPT` | ✅ **feito 13/08** |

E **dois resultados negativos que economizam trabalho**: Planet Nirn não tem código próprio, e os flags CEF do Hijos são uma regressão de segurança que já evitamos.

> **Três dos quatro foram implementados no mesmo dia — e um deles corrigiu a recomendação.** Este documento nasceu descrevendo Interaction e Contracts como `MISSING`. Horas depois, os commits `c442d9b`, `cdf680b` e `326e1be` entregaram os frameworks de Interação, Inventário e Economia, mais contratos e dívida. As seções abaixo foram reconciliadas contra `b7c929d`; **a leitura dos projetos de referência não mudou**, só o nosso lado. O achado nº 2 merece atenção: a implementação **divergiu de propósito** da referência, e estava certa — ver §4.

### O que este documento não muda

O bloqueio real do projeto continua sendo a Fase 0 — ninguém nunca conectou dois clientes. Nenhum achado desta pesquisa deve entrar na frente disso, e o roadmap ([`ECOSYSTEM_ADAPTATION_ROADMAP.md`](../roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md)) coloca todos eles em P1 ou depois, deliberadamente.

---

## 2. The Divine Comedy

**URL:** `github.com/miguelAngeloo/TheDivineComedy` · **Licença:** MIT · **Última atividade:** 2026-07-30 · **Tamanho:** 38 KB, 30 arquivos · **Verificação:** completa

**Arquitetura:** `gamemode/` (servidor, TypeScript, build por `build.mjs`), `client/src/` (copiado para dentro do `skymp5-client` por `sync-client.mjs` antes do build), `recipes/` (um `.esp`), `patches/` (mudanças no SkyMP), `docs/`.

### Sistemas encontrados

Poucos e rasos: seleção de personagem com UI, eventos `onActivate` / `onDeath` / `onDropItem` / `onRespawn`, templos, itens iniciais, mineração. É um projeto jovem — o valor dele não está no gameplay.

### Ideias úteis

**A disciplina de `patches/`.** É a única coisa no ecossistema inteiro que se parece com política de patch. Cada modificação ao SkyMP fica num diretório próprio, com um README que declara o que mudou, por que, e — o que quase ninguém escreve — **como a mudança se perde**:

> `spawn.ts` modificado — adicionado o hook `onPlayerSpawn` para o gamemode controlar o spawn. *Perdido num update/reclone do SkyMP.*

> `Skyrim.ccc` esvaziado — *reverte se o Steam verificar os arquivos do jogo.*

Declarar a condição de perda de um patch é exatamente o que o briefing §4C pede e o que nosso projeto não tem em lugar nenhum.

**O hook `onPlayerSpawn`.** O patch é pequeno e desenhado para ser inofensivo: se o gamemode expõe `onPlayerSpawn`, ele decide o spawn e o resto do código não roda; se não expõe, o comportamento antigo continua. Isso é um patch *upstreamable* — não muda comportamento de quem não usa.

### Código potencialmente reutilizável

MIT, então tudo é reutilizável com atribuição. Na prática, quase nada vale: o `spawn.ts` deles usa `discordRoleIds` e `findFormsByPropertyValue` de um jeito acoplado ao produto deles, e nosso spawn já foi consertado por outro caminho (commit `cd1fb6a`, respawn nativo e `cellId` de zona).

### Riscos

`sync-client.mjs` copia `client/src` **por cima** de `skymp5-client/src`, com um caminho absoluto hardcoded para a máquina do autor. É sobrescrita silenciosa de fonte upstream, sem registro do que foi sobrescrito. É o anti-padrão que o briefing §4C proíbe, e convive no mesmo repositório com o `patches/` bem-feito.

### Aplicação no Heavy RP

- **`ADAPT`** — a estrutura `patches/` com manifesto e condição de perda. Vira `PATCH-001` no roadmap.
- **`UPSTREAM`** — o `onPlayerSpawn` merece PR ao SkyMP em vez de patch local, se algum dia precisarmos dele.
- **`REJECT`** — `sync-client.mjs`.
- **`KEEP`** — nosso diagnóstico de índice de plugin já é superior; ver a ressalva `MOD-005` na matriz.

**Classificação geral: `ADAPT`** (processo, não código).

---

## 3. Hijos de las Nieves

**URL:** `github.com/hijosdelasnieves/hijosdelasnieves-RP` · **Licença:** GPL-3.0 (declarada no README para conformidade) · **Última atividade:** 2026-07-29 · **Verificação:** completa no que importa

É um fork do `skyrim-multiplayer/skymp` que, segundo o próprio README, contém **apenas modificações de build do SkyrimPlatform**. O gameplay é mantido separado e não é público. Isso torna o projeto fácil de auditar: são 7 commits próprios, todos prefixados `HDN` ou `fix(skyrim-platform)`.

> ⚠️ **Corrigido em 14/08/2026** por [`SKYMP_FORK_DIFF_MATRIX.md`](SKYMP_FORK_DIFF_MATRIX.md) §1.2: a contagem de "7 commits" cobre só a `main`. Há **oito branches** com trabalho que nunca foi mesclado — incluindo `HdnVanillaMenuPolicy` (autoridade fail-closed sobre menus vanilla) e `ItemPreviewApi` (preview real de item no CEF) — e é nelas que está o conteúdo mais relevante para o Heavy RP.

### O que eles realmente mudaram

| Commit | Mudança | Nosso interesse |
|---|---|---|
| `601b51c2`→`2e6c5163` | Colisão e transform de par montado | ⭐ **Alto** |
| `151ba07f`, `8459f07b` | Persistência de perfil de colisão do character controller | ⭐ **Alto** |
| `a6b5bede` | Flags CEF para `getUserMedia` | ⚠️ Rejeitar |
| `88e48c04`, `84049b85` | Spritefont de ícones (alto-falante/microfone) | Cosmético |
| `752ae63e`, `164e1b4c` | Cache e paralelismo de CI do SkyrimPlatform (~40 min/run) | Médio |

### A descoberta que importa

As APIs novas expostas ao TypeScript:

```ts
setMountedPairKinematicTransform(
  horseFormId, riderFormId,
  lease, serial,
  positionX, positionY, positionZ,
  angleX, angleY, angleZ,
  riderSeatHeight
): boolean
releaseMountedPairKinematicTransform(horseFormId, riderFormId, lease): void
setCharacterControllerCollisionProfile(actorFormId, profile, lease?): void
getCharacterControllerCollisionProfileState(actorFormId): number
```

Duas coisas merecem atenção.

**Primeira: os parâmetros `lease` e `serial`.** `lease` é posse temporária revogável do par cavalo/cavaleiro; `serial` ordena as atualizações e descarta as que chegam fora de ordem. Nossa auditoria de 12/08 recomendou, de forma independente, "padronizar estado compartilhado com revisão/sequence e snapshots de reconnect" ([exec summary](SKYMP_FORK_RESEARCH_EXECUTIVE_SUMMARY.md), mudança arquitetural 6). Eles chegaram na mesma forma resolvendo o caso concreto. **Convergência independente é o sinal mais forte que uma pesquisa comparativa produz** — é a diferença entre "parece boa ideia" e "duas equipes bateram no mesmo problema e saíram com a mesma peça".

**Segunda: é exatamente o nosso bloqueio.** O gap analysis marca `mounts WEAK — horse PARKED — shared state/ownership — native spike`. O "native spike" que o gate pede é precisamente o que esses commits são. Não precisamos descobrir se é possível; precisamos avaliar o código deles.

### Código potencialmente reutilizável

GPL-3.0 é compatível com nossa AGPL-3.0 para combinação. `ObjectReferenceApi.cpp` (+665/-28 somando os commits) e `ObjectReferenceApi.h` são portáveis **com atribuição e registro de origem**.

### Código incompatível e riscos

**Os flags CEF são `REJECT`, e vale explicar por quê.** O commit `a6b5bede` adiciona a `MyChromiumApp::OnBeforeCommandLineProcessing`:

```
enable-media-stream
auto-accept-camera-and-microphone-capture
use-fake-ui-for-media-stream
autoplay-policy=no-user-gesture-required
allow-running-insecure-content
allow-file-access-from-files
disable-features=MediaRouter,AudioServiceSandbox
```

O problema é a combinação. `auto-accept-camera-and-microphone-capture` e `use-fake-ui-for-media-stream` removem o consentimento; `allow-file-access-from-files` e `allow-running-insecure-content` removem o isolamento de origem; `AudioServiceSandbox` desligado remove o sandbox do processo de áudio. O resultado é um overlay onde **qualquer conteúdo carregado pode ligar o microfone sem que o jogador saiba, e exfiltrar por conteúdo inseguro**. Num servidor onde a UI carrega qualquer coisa vinda do servidor, isso é uma superfície séria.

Eles têm um motivo legítimo: o overlay é fullscreen e não há UI para responder ao diálogo de permissão do Chromium. A resposta deles foi remover o diálogo. A nossa — tirar a captura do CEF e usar WASAPI nativo, documentada em [`VOICE_NATIVE_HELPER.md`](../technical/VOICE_NATIVE_HELPER.md) — evita a classe inteira.

Registrar isso tem valor duplo: valida nossa arquitetura de voz por um caminho independente, e nos dá um caso concreto para o inventário de trust boundary.

Risco do port de montaria: são ~700 linhas de C++ mexendo em character controller e física do Havok. Fora do nosso `transaction-service`, é o código de maior risco de crash que já consideramos. Exige spike isolado, não integração direta.

### Aplicação no Heavy RP

- **`PORT`** — APIs de par montado, sob spike com critério de rollback. Vira `MOUNT-001`.
- **`REJECT`** — flags CEF, com a justificativa acima registrada.
- **`ADAPT`** — cache/paralelismo de CI do SkyrimPlatform, se algum dia compilarmos o SP.
- **`KEEP`** — nossa arquitetura de voz.

**Classificação geral: `PORT`.**

---

## 4. Mereth Roleplay — contratos

**URL:** `github.com/YimitKEQ/mereth-contracts` · **Site:** `mereth.net` · **Licença:** ⛔ ausente · **Última atividade:** 2026-08-13 · **Verificação:** documento de design; **o código não é público**

O repositório é a wiki publicada (HTML estático + um zip), não a fonte. O README declara: TypeScript contra a API de gamemode do SkyMP, server-authoritative, entregue em runtime — o jogador não instala nada.

### O sistema

> Um jogador publica trabalho, outro aceita, o servidor move os septims e mantém o registro. Sem arbitragem, sem fila de staff, sem NPCs.

Oito estados: `open` → `accepted` → `delivered` → `settled`, com `defaulted`, `rejected`, `expired` e `withdrawn` como saídas.

### Ideias úteis

**Escrow no post, não na entrega.** Contrato *funded* trava o ouro no momento da publicação. A justificativa deles é boa o bastante para citar: o servidor pega o dinheiro *antes* da promessa, então quando algo quebra você fica **sem contrato** em vez de **com um contrato que ninguém pode pagar**. Isso é a mesma filosofia fail-closed que nossas feature flags já seguem.

**Dívida como registro, não como fila de staff.** Quem não consegue pagar não gera ticket: gera uma nota de dívida selada, com os dois nomes e o contrato de origem, legível por qualquer jogador. O trabalhador recebe o que existe; o resto vira registro público. Isso transforma inadimplência em **material de RP** em vez de trabalho de moderação — e é exatamente o que o briefing §8 imaginou para tribunais, guildas e crime.

**Entrega verificada por contagem.** O servidor conta os itens saindo do trabalhador e entrando no cliente antes de registrar entrega. O cliente não afirma que entregou.

**Varredura de expiração que não rouba.** Trabalho já entregue não é tocado pela expiração. É a proteção contra o exploit óbvio: deixar expirar depois de receber.

**Janela de revisão de dois dias** antes do auto-settlement em contratos de serviço.

### Código potencialmente reutilizável

**Nenhum.** Não há código público, e não há licença. Mesmo que houvesse código, sem licença seria todos os direitos reservados.

### Riscos

Não podemos verificar nada. O documento descreve escrow atômico e entrega verificada, mas não vimos uma linha — não sabemos se há transação real, idempotência ou lock. **Tratar como especificação de produto bem escrita, não como implementação validada.**

### Aplicação no Heavy RP — ✅ feito em 13/08/2026, e a divergência é o mais interessante

Quando este documento foi escrito, `contracts` era `MISSING` e a recomendação era construir depois da economia transacional. Horas depois, `326e1be` entregou os três: `core/economy-service.js` (ativo), `contracts-service.js` e `debt-service.js` (ambos PARKED), com migration v15 e [`ADR-004`](../technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md).

Reimplementado do conceito, sem uma linha copiada — o que a ausência de licença do Mereth exigia.

**A implementação saiu com sete estados, não oito, e a recomendação daqui é que estava errada.**

O estado que caiu foi `defaulted`. O raciocínio: com escrow travado no post, o ouro sai **antes** de o contrato existir, então não há como um contrato ficar impagável — o estado não pode acontecer.

O Mereth precisa dele porque oferece **duas** modalidades: *funded*, com escrow no post, e *unfunded*, em que o cliente paga na entrega e pode não ter o dinheiro. `defaulted` e as notas de dívida existem para a segunda. Ao adotar só a modalidade funded, o estado morre junto.

**Este documento leu o mecanismo certo e a lista de estados errada.** A máquina de oito estados foi descrita aqui como se fosse uma peça só; ela é a união de dois modelos de pagamento. Copiar os oito teria trazido um estado inalcançável — o mesmo defeito que o `isSelf` do `market-stalls` tinha e que ninguém percebeu por meses.

Fica registrado como lição de método: **contar estados numa referência não é o mesmo que entender o que os produz.**

O que sobreviveu intacto da leitura:

- escrow trava no post, e falha na criação produz *sem contrato* em vez de contrato impagável;
- **expiração nunca toca trabalho entregue** — virou teste com o nome da regra, como recomendado;
- dívida é registro selado, nunca cobrança automática. O ADR-004 §4.4 registra que abater automático foi considerado e rejeitado por remover a cena e pôr o servidor no papel do agiota;
- `disputed` não decide nada: escrow fica travado e resolver é papel de gente.

**Classificação geral: `REIMPLEMENT` — concluído, com divergência justificada.**

---

## 5. TESV-RP / Frostfall

**URL:** `github.com/qalamabdulkhaliq/TESV-RP` · **Licença:** ⛔ ausente · **Última atividade:** 2026-05-17 · **Verificação:** ⚠️ **rasa** — árvore + 1 módulo

**Não é o mesmo projeto que o "SkyrimRoleplay/skyrp"** já pesquisado, apesar do nome parecido. É um projeto próprio, e é o acervo de gameplay Heavy RP mais denso do ecossistema.

**Arquitetura:** `Frostfall-Backend/` (Express: manifest, modlist, whitelist, master-api, métricas, dashboard, webhook, relay WS) e `Frostfall-Server/gamemode/` (57 módulos).

### Sistemas encontrados

A lista é o achado. Módulos que respondem a domínios onde estamos `MISSING`, `PARKED` ou `WEAK`:

`courier.js` · `commodityExchange.js` · `treasury.js` · `economy.js` · `production.js` · `productionActivation.js` · `training.js` · `skills.js` · `factions.js` · `college.js` · `housing.js` · `crafting.js` · `inventory.js` · `shop.js` · `store.js` · `medical.js` · `captivity.js` · `prison.js` · `bounty.js` · `combat.js` · `pve.js` · `magic.js` · `transport.js` · `hunger.js` · `interactionState.js` · `permissions.js` · `auditLog.js` · `loadOrderGate.js` · `espAssetRegistry.js` · `modSourceRegistry.js` · `papyrusBridge.js` · `engineProbes.js` · `worldStore.js`

### O único módulo que lemos

`loadOrderGate.js` é um **gate de boot**: analisa `loadOrder` e `archives` do server-settings e devolve `ok: false` com a lista de checagens bloqueantes se algo não bate. Verifica que os cinco masters vanilla são o prefixo canônico, que o plugin do manifesto está configurado *e presente*, que arquivos e assets soltos exigidos existem, e — o mais interessante — exige **evidência registrada de resolução de FormID** (`formResolution`), tratando "nenhuma evidência" como bloqueio, não como sucesso.

Isso é a mesma filosofia fail-closed do nosso `server-options`, aplicada ao problema de índice de plugin que o Divine Comedy também encontrou. **Três projetos, o mesmo bug.** É a falha estrutural do SkyMP com mods, e a melhor resposta vista até agora é um gate server-side que se recusa a subir.

Nós resolvemos por convenção e documentação (`plugins.fase0.txt`, hash no manifesto), não por gate de boot. A deles falha mais cedo e mais alto.

### Riscos

**Sem licença.** Todos os direitos reservados. Nada de copiar.

E o aviso honesto: **56 dos 57 módulos não foram lidos.** A lista acima diz o que existe, não se presta. Um arquivo chamado `treasury.js` pode ser um ledger transacional ou um `UPDATE ... SET gold = gold - X`. Não sabemos.

### Aplicação no Heavy RP

- **`RESEARCH`** — é a maior dívida de pesquisa que sobra. Vira `RES-001`, com prioridade em `courier.js`, `commodityExchange.js`, `treasury.js`, `interactionState.js` e `permissions.js`.
- **`ADAPT`** — o conceito de gate de load order server-side. Vira `MOD-006`.

**Classificação geral: `RESEARCH`** — não é veredito, é admissão de que não pesquisamos o suficiente.

---

## 6. Crows RP

**URL:** `github.com/LucasMagnoSP/Crows-RP` · **Licença:** ⛔ ausente · **Última atividade:** 2026-08-12 · **Verificação:** ⚠️ **rasa** — árvore + README

Monorepo de launcher + backend + integração SkyMP. É o projeto **mais ativo** do conjunto e o mais avançado em operação.

**Arquitetura:** launcher em **C#/WPF** com Velopack; backend em **Python/FastAPI** com separação hexagonal real (`domain/`, `adapters/`, `services/`, `schemas/`, `models/`); Postgres + Redis; Docker Compose com build do SkyMP para Linux em container; GitHub Actions para deploy e release.

### Ideias úteis

**Postgres e Redis não são publicados.** O README é explícito: só rede Docker. Parece óbvio e é o erro mais comum em deploy de servidor de jogo.

**ESMs ficam fora do Git e são copiados à mão.** `proprietary/skyrim-data/`. Fronteira legal correta, e a mesma que nossa política de licença já adota.

**Backend hexagonal com RBAC de verdade.** `domain/permissions.py`, `models/rbac.py`, `db/seed_rbac.py`, `services/authorization.py`, `services/admin_audit.py`, `services/admin_elevation.py`. Há um serviço dedicado de *elevação* de admin separado da autorização comum — é o padrão que o briefing §21 pede e que nosso `admin-service.js` não tem de forma explícita.

**Adapter de inventário com implementação falsa.** `adapters/inventory/{protocol,skymp,fake}.py`. Permite testar a lógica de inventário sem SkyMP. É exatamente a resposta ao nosso problema documentado de "quatro sistemas testados só com `mp` mockado" — eles tornaram o mock uma **fronteira arquitetural declarada** em vez de um artefato de teste.

**ModSync testado.** `ModSyncTests.cs`, `UpdateChannelTests.cs`, `VersionCompareTests.cs`, `ClientManifestValidator.cs`, `ModHashHelper.cs`, `ModVersionRange.cs`. Canais de update, faixas de versão de mod e validação de manifesto — todos com teste. É o mais próximo de `MOD-001..004` que o ecossistema tem.

**`SensitiveArgumentMasker.cs`** — mascarar argumento sensível na linha de comando do jogo. Detalhe pequeno e revelador: significa que eles passam credencial por argumento e sabem que isso vaza em process listing. Vale conferir se nosso launcher faz o mesmo.

### Código incompatível

Launcher em C#/WPF; o nosso é Electron. **Portar é reescrever.** O valor está na arquitetura de ModSync e na suíte de testes como especificação, não no código.

Backend em Python/FastAPI; o nosso é Node. Mesma conclusão.

### Riscos

**Sem licença.** Todos os direitos reservados — e o README chama o repositório de "monorepo privado" enquanto ele está público. Provavelmente não intencional. Motivo a mais para não copiar nada.

Nenhum arquivo de lógica foi lido. Tudo acima é inferência de nome de arquivo e README.

### Aplicação no Heavy RP

- **`ADAPT`** — separação de elevação de admin vs autorização (`RBAC-001`); adapter de inventário com fake declarado (`INV-001`); canais de update stable/beta/dev.
- **`RESEARCH`** — a suíte `ModSyncTests` como especificação para `MOD-001..004`.
- **`REJECT`** — portar launcher ou backend.
- **Verificação imediata:** conferir se nosso launcher passa credencial por argumento de linha de comando. Isso é uma pergunta sobre o **nosso** código, não sobre o deles, e é a única coisa aqui que não depende de pesquisa adicional.

**Classificação geral: `ADAPT`.**

---

## 7. Planet Nirn Roleplay

**URL:** `github.com/Legacy7K/Planet-Nirn-RP` · **Última atividade:** 2026-06-09 · **Verificação:** linhagem e histórico

Fork de `skyrim-roleplay/skymp`, que por sua vez é fork de `skyrim-multiplayer/skymp`.

**Não há código próprio.** O histórico recente é inteiramente upstream — PRs `#2578`, `#2615`, `#2623`, `#2626`, `#2632`, `#2633` do SkyMP oficial. O único commit próprio é `9e041881 Update README.md`.

O briefing pedia estudar aqui *appearance sync, equipment sync, inventory sync, container sync, PvP, PvE* e produzir uma matriz de sincronização. **Essa frente não tem onde acontecer neste repositório.** O que existe é upstream (já é nossa referência primária) ou vem do `skyrim-roleplay/skymp`, já pesquisado como "SkyrimRoleplay/skyrp" na [matriz de forks](SKYMP_FORKS_SYSTEM_MATRIX.md).

A matriz de sincronização continua sendo um documento que vale a pena — mas ela sai de leitura do upstream e de teste real, não daqui.

**Classificação geral: `REJECT`.**

---

## 8. Red House

Já estudado em [`REFERENCE_STUDY_SKYMP_RED_HOUSE.md`](../technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md) (434 linhas, §4.1 é leitura de fonte). Não repetido aqui.

O que esta rodada acrescenta: o `interactionMenu` do Red House deixou de ser referência isolada. Frostfall tem `interactionState.js` e Divine Comedy usa `onActivate`. **Três abordagens independentes para o mesmo problema**, o que moveu Interaction de "ideia do briefing" para lacuna confirmada por convergência — e ela foi fechada no mesmo dia por `c442d9b`.

A convergência foi o que justificou a prioridade. O desenho que saiu não copiou nenhuma das três: módulos declaram as próprias ações no `interaction-registry`, o servidor resolve o alvo e revalida tudo no `execute`, e `canSee` explicitamente **não autoriza nada** — decide um menu montado num instante anterior, na máquina de outra pessoa.

Red House continua GPL-3.0, parado em 2021, e continua sendo o código de interação mais legível disponível.

---

## 9. Comparação de arquitetura

Atualizada contra `b7c929d`. A coluna "veredito" mudou em quatro linhas no mesmo dia.

| Dimensão | Heavy RP | Melhor do ecossistema | Veredito |
|---|---|---|---|
| Autoridade do servidor | Explícita, fail-closed | Mereth (declarado) | **Nós** — os outros não provam |
| Fronteira transacional | razão de duas pernas, soma zero (v14/v15) | ninguém visível | **Nós**, e a distância aumentou |
| Gate de boot | `server-options` | Frostfall `loadOrderGate` | **Empate** — eles cobrem load order, nós não |
| Modularidade | `module-registry` com ordenação topológica | Red House `modules/` | **Nós** |
| Testabilidade sem jogo | mocks ad-hoc de `mp` | Crows: adapter + fake declarado | **Eles** |
| RBAC | `admin-service` + permissions | Crows: RBAC + elevação + audit | **Eles** |
| Distribuição | Electron + manifesto + gate de CC | Crows: Velopack + canais + testes | **Eles** |
| Política de patch | `patches/` + validador na CI | Divine Comedy `patches/` | **Empate** — e o nosso valida na CI |
| Voz | helper WASAPI nativo | Hijos: CEF (inseguro) | **Nós** |
| Interação | `core/interaction-*` + ADR-002 | Red House `interactionMenu` | **Nós** — só `player` resolvido, mas server-authoritative |
| Contratos | `contracts-service` (PARKED) | Mereth | **Empate no desenho** — eles têm jogadores, nós não |

Nós ganhamos onde o assunto é **rigor** e perdíamos onde o assunto é **alcance**. O dia 13/08 fechou boa parte da lacuna de alcance sem abrir mão do rigor: inventário e economia ganharam razão de duas pernas em que a soma dos deltas fecha em zero, que é mais forte do que qualquer coisa visível nas árvores dos outros.

**Mas a coluna que decide continua vazia.** Todo sistema novo tem a mesma advertência no CHANGELOG — *nada disto rodou numa sessão real*. O Mereth tem jogadores usando contratos; nós temos 784 testes e zero jogadores. Em desenho estamos à frente ou empatados em quase tudo; em evidência, atrás de todo projeto do ecossistema que tem gente conectada.

Isso não muda a estratégia — continua sendo adicionar domínios sobre as primitivas, não substituí-las. Reforça a prioridade: **a Fase 0 vale mais que qualquer item deste documento.**

---

## 10. Segurança

Achados desta rodada, para incorporação ao [`AUTH_001_TRUST_BOUNDARY_INVENTORY.md`](../technical/AUTH_001_TRUST_BOUNDARY_INVENTORY.md).

| ID | Achado | Origem | Severidade |
|---|---|---|---|
| `SEC-CEF-01` | Flags CEF de auto-aceite de mídia removem consentimento e isolamento de origem no overlay | Hijos (a evitar) | Alta — **não estamos expostos**; registrar como decisão |
| `SEC-ARG-01` | Credencial passada por argumento de linha de comando vaza em process listing | Crows (`SensitiveArgumentMasker`) | **Verificar no nosso launcher** |
| `SEC-CCC-01` | `Skyrim.ccc` carrega conteúdo variável por conta Steam, fora de `Data/`, invisível ao manifesto | Divine Comedy | Média — armadilha do modpack oficial |
| `SEC-ESCROW-01` | Escrow deve travar no post; expiração nunca toca entrega feita | Mereth | Invariante para `CONTRACT-001` |

`SEC-ARG-01` é o único que é uma pergunta sobre o nosso código e pode ser respondido sem mais pesquisa.

---

## 11. Licenciamento

Registro obrigatório pela §14 do briefing. Detalhe na [matriz](SKYMP_ECOSYSTEM_MATRIX.md#licenças--barreira-antes-de-qualquer-reuso).

Resumo: **três dos sete projetos não têm licença** — Frostfall, Crows e Mereth — e são justamente os que têm os sistemas que mais nos faltam. Tudo que vier deles é reimplementação a partir do conceito, com origem registrada. Red House (GPL-3.0), Divine Comedy (MIT) e Hijos (GPL-3.0) permitem reuso com atribuição, e todas são compatíveis com nossa AGPL-3.0.

---

## 12. Roadmap

Em [`ECOSYSTEM_ADAPTATION_ROADMAP.md`](../roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md).

# Roadmap de adaptação do ecossistema

Data: **2026-08-13**. Deriva de [`SKYMP_ECOSYSTEM_DEEP_DIVE.md`](../research/SKYMP_ECOSYSTEM_DEEP_DIVE.md) e [`SKYMP_ECOSYSTEM_MATRIX.md`](../research/SKYMP_ECOSYSTEM_MATRIX.md).

## Como este documento se encaixa

Já existem dois planos: [`FORK_RESEARCH_ROADMAP.md`](FORK_RESEARCH_ROADMAP.md) (20 tarefas AUTH/MOD/CHR/FAC/PROP/VOI/OPS da auditoria de 12/08) e a ordem de desbloqueio do [`HEAVY_RP_GAP_ANALYSIS.md`](../research/HEAVY_RP_GAP_ANALYSIS.md).

**Este roadmap não os substitui e não reordena nada deles.** Ele acrescenta as tarefas que a rodada de 13/08 produziu e as encaixa nas fases existentes. Onde uma tarefa nova depende de uma antiga, a dependência está declarada. Se este documento e o `FORK_RESEARCH_ROADMAP` discordarem sobre prioridade, o outro vence — ele nasceu de uma auditoria mais profunda do nosso próprio código.

## A regra que governa tudo abaixo

**Nada aqui entra na frente da Fase 0.** Quatro sistemas do gamemode foram testados só com `mp` mockado e ninguém nunca conectou dois clientes. Enquanto isso for verdade, toda tarefa deste roadmap é trabalho sobre uma fundação não verificada.

Isso não é formalidade. O maior achado desta pesquisa — as APIs de montaria do Hijos — é código C++ que mexe em física do Havok. Portar isso antes de saber se dois jogadores conseguem se ver é a definição de otimização prematura.

---

## P0 — Fase 0: teste real

Inalterado. Ver [`FASE_0_ROTEIRO.md`](../technical/FASE_0_ROTEIRO.md) e [`GUIA_SESSAO_DE_TESTE.md`](../technical/GUIA_SESSAO_DE_TESTE.md).

Esta pesquisa **não adiciona nenhuma tarefa em P0**, de propósito. A única coisa que ela contribui aqui é negativa: nada do que foi encontrado justifica adiar a sessão de teste.

---

## P1 — Core, plataforma e as dívidas que a pesquisa expôs

| ID | Tarefa | Origem | Classe | Estado |
|---|---|---|---|---|
| `SEC-QS-01` | Ticket de fila sai da query string; harness de teste HTTP para `game-api` | achado no **nosso** código | fix | ✅ **feito 13/08** |
| `PATCH-001` | Estrutura `patches/` com manifesto, motivo, commit upstream e condição de perda | Divine Comedy | ADAPT | ✅ **feito 13/08** |
| `MOD-005` | Paridade cobre o que o jogo carrega fora de `Data/` (`Skyrim.ccc`) | Divine Comedy | ADAPT | ✅ **detecção feita 13/08**; decisão de produto aberta |
| `MOD-006` | Gate de load order server-side que recusa boot sem evidência de resolução de FormID | Frostfall | ADAPT | pendente — depende de `MOD-005` |
| `RES-001` | Ler a fundo os 5 módulos prioritários do Frostfall | Frostfall | RESEARCH | pendente |
| `RES-002` | Ler a fundo `ModSyncTests` e o RBAC do Crows | Crows | RESEARCH | pendente |

### `SEC-QS-01` — feito em 13/08/2026

Achado durante esta pesquisa, ao verificar se estávamos expostos ao problema que o `SensitiveArgumentMasker.cs` do Crows revela.

**Não estamos expostos pelo caminho deles:** nosso launcher não passa credencial por argumento de linha de comando. O ticket vai para `clientSettings.gameData.launcherTicket` e `config.session`, em arquivo.

**Mas há uma inconsistência no nosso código.** Em `apps/launcher/electron/main.ts`, `join-queue` (linha ~804) manda o ticket no corpo de um POST; `poll-queue` (linha ~820) manda o mesmo ticket na **query string** de um GET. O servidor lê `req.query.ticket` em `apps/game-api/server.js:244`. São 14 linhas de distância tratando o mesmo segredo de dois jeitos.

Severidade honesta: **baixa a moderada**, e menor do que parece.

- O transporte já é `http://` puro, então a query string não acrescenta exposição no fio.
- Os tickets **rotacionam e são de uso único** — `consumeLaunchTicket` gasta, `issuePollTicket` emite o próximo. Um ticket que apareça num log de acesso provavelmente já foi consumido.
- A exposição real é log de servidor e de proxy, onde query string entra e corpo de POST não.

Vale corrigir mesmo assim, por três motivos: é barato, elimina uma inconsistência que convida a erro futuro, e nunca vai custar menos — não há launcher em produção porque a Fase 0 nunca rodou.

**O que foi feito.** A rota virou `POST /api/queue/status` lendo `(req.body || {}).ticket`; `req.query` é ignorado. `poll-queue` passou a usar `postJsonToUrl`, igual ao `join-queue`. `ARCHITECTURE.md` e as três traduções acompanharam o método.

Junto veio `apps/game-api/server.http.test.js`, **o primeiro teste em nível HTTP deste serviço** — a ausência dele é o que deixou o problema passar. Roda sem MariaDB porque `consumeLaunchTicket` recusa ticket ausente ou curto antes de tocar o banco.

Verificado por mutação, como a convenção do projeto exige: revertendo `app.post` para `app.get`, nove testes falham.

**O que continua sem cobertura:** o caminho feliz. Ticket válido, admissão e persistência de sessão exigem banco e seguem sem teste automatizado. Está declarado no rodapé do arquivo de teste.

Registrado como `AUTH-04b` em [`AUTH_001_TRUST_BOUNDARY_INVENTORY.md`](../technical/AUTH_001_TRUST_BOUNDARY_INVENTORY.md) — o `AUTH-04` já nomeava a classe "segredo em URL", mas registrava só a ocorrência do `masterKey`, que continua aberta como `AUTH-04a`.

### `PATCH-001` — política de patch antes do primeiro patch

Não temos nenhum patch ao SkyMP hoje, e é justamente por isso que a hora de definir a política é agora. Todo projeto do ecossistema que acabou com um fork pesado começou com um patch sem registro.

Formato, adaptado do Divine Comedy e do que a §4C do briefing pede:

```
patches/
├── README.md         política: quando patch, quando adapter, quando upstream
├── manifest.json     um registro por patch
└── <alvo>/<patch>.patch
```

Cada registro declara: commit upstream de base, motivo, arquivos, impacto, teste que prova que funciona, **condição de perda** (o que faz o patch sumir), estratégia de remoção, e se cabe PR upstream.

A "condição de perda" é a contribuição do Divine Comedy e o campo que ninguém escreve. Eles anotaram que `Skyrim.ccc` volta se o Steam verificar os arquivos e que o patch de `spawn.ts` some num reclone. Um patch cuja perda é silenciosa é pior que patch nenhum.

**Feito em 13/08/2026.** [`patches/`](../../patches/README.md) traz a política com a escada de decisão (SkyMP puro → adapter → PR upstream → patch → fork), o `manifest.json` — **vazio, que é o estado preferido** — e `validate.js`, sem dependências, com 38 testes. A CI roda no job `higiene`, sem `npm ci`.

Além de `loss_condition`, o validador exige justificativa quando `test` ou `upstream_pr` são `null`: patch sem teste e sem explicação é o que a §34 proíbe, e patch que deveria virar PR e nunca vira é um fork começando devagar.

### `MOD-005` — o buraco que o manifesto não vê

Nosso gate de paridade compara o que está em `Data/` contra o manifesto, por hash. `Skyrim.ccc` é lido pelo executável em runtime e **seu conteúdo varia conforme o conteúdo Creation Club que aquela conta Steam possui**. Dois testadores com licenças de CC diferentes carregam listas de plugin diferentes, e o primeiro byte de todo FormID é o índice dessa lista.

Não é bug hoje: `plugins.fase0.txt` exige cinco masters e nada mais, em letras maiúsculas. É armadilha para quando o modpack oficial for montado — e `docs/MODPACK.md` lista cinco plugins de Creation Club como masters obrigatórios, o que faria o modpack **depender de todo jogador ter as mesmas licenças de CC**.

**Detecção feita em 13/08/2026.** `parseCccTxt` e `analyzeCreationClub` em `apps/launcher/electron/parity.mjs`, puros e testáveis como o resto do módulo, ligados ao handler `analyze-plugins`. O `Skyrim.ccc` é lido da raiz do jogo, não de `Data/`.

A checagem é bidirecional, como o resto do módulo:

- CC que o jogador carrega e o servidor não declara → desloca índice;
- CC que o servidor exige e o jogador não carrega → falta record.

Entrada listada no `.ccc` mas sem arquivo em `Data/` **não** é acusada: o jogo não a carrega e nenhum índice se move. Tratá-la como problema reprovaria toda instalação que não comprou tudo.

**A decisão de produto continua aberta**, e detectar não é resolver — quem não tiver o conteúdo simplesmente não entra. As saídas são exigir CC e aceitar barrar quem não tem, ou remover as entradas 6 a 10 do modpack junto com os mods que dependem delas. A segunda parece mais barata. Registrado em [`MODPACK.md`](../MODPACK.md#masters-base).

---

## P2 — Interação e inventário

| ID | Tarefa | Origem | Classe | Depende de |
|---|---|---|---|---|
| `INT-001` | Interaction Registry: alvos, ações, permissão, resolução server-side | Red House + Frostfall | REIMPLEMENT | P0 |
| `INT-002` | Módulos registram ações; menu montado no servidor | Red House | REIMPLEMENT | `INT-001` |
| `INV-001` | Adapter de inventário com implementação falsa declarada | Crows | ADAPT | — |

`INT-001` é a lacuna confirmada por convergência: três projetos independentes construíram menu de interação, nós não temos nenhum. É a fundação da §18 do briefing e pré-requisito de trade, crafting, propriedades e crime.

Invariante desde o começo: **o cliente pede uma ação sobre um alvo; o servidor resolve o alvo por catálogo e distância observada, e decide.** O cliente nunca envia o alvo resolvido — é o blocker `PROP-01` da matriz de forks aplicado à interação inteira.

`INV-001` é a resposta ao nosso problema real de testar com `mp` mockado. O Crows transformou o mock numa **fronteira arquitetural declarada** (`adapters/inventory/{protocol,skymp,fake}`) em vez de um artefato de teste espalhado. Não depende da Fase 0 e melhora a confiança em tudo que vier depois.

---

## P3 — Economia e contratos

| ID | Tarefa | Origem | Classe | Depende de |
|---|---|---|---|---|
| `CONTRACT-001` | Máquina de 8 estados de contrato com escrow no post | Mereth | REIMPLEMENT | `ECON`, `INV-001` |
| `CONTRACT-002` | Nota de dívida selada e legível | Mereth | REIMPLEMENT | `CONTRACT-001` |

`contracts` é o domínio onde a distância entre nós e a melhor referência é maior — estamos em `MISSING`. Mas ele **depende** de inventário e economia transacionais, hoje PARKED sob o blocker `ECON-01`. Construir contratos antes disso é construir em cima do problema que os contratos expõem.

Invariantes que valem como teste desde já, mesmo antes da implementação:

- Escrow trava no post, não na entrega. Falha vira **sem contrato**, nunca contrato impagável.
- Expiração **nunca** toca trabalho já entregue.
- Entrega é contada pelo servidor, item a item. O cliente não afirma que entregou.
- Inadimplência vira registro, não fila de staff.

Reimplementação a partir do conceito: Mereth não tem licença nem código público.

---

## P4 — Launcher, mod sync e admin

| ID | Tarefa | Origem | Classe | Depende de |
|---|---|---|---|---|
| `RBAC-001` | Elevação de admin separada da autorização comum | Crows | ADAPT | `RES-002` |
| `MOD-007` | Canais stable/beta/development no launcher | Crows | ADAPT | `MOD-001..004` |

`RBAC-001` responde à §21 do briefing. Nosso `admin-service.js` tem permissões, mas não tem elevação explícita — o Crows separa `services/authorization.py` de `services/admin_elevation.py` e audita as duas. A distinção importa: autorização responde "pode?", elevação responde "assumiu o poder agora, e isso ficou registrado".

---

## P5 — Facções, profissões, propriedades

Sem tarefa nova desta rodada. `FAC-001..004` e `PROP-001..004` do `FORK_RESEARCH_ROADMAP` continuam sendo o plano, e a origem continua sendo SkyrimRoleplay.

`RES-001` pode acrescentar aqui: Frostfall tem `factions.js`, `college.js`, `housing.js` e `production.js`, nenhum lido.

---

## P6 — SkyMP e cliente

| ID | Tarefa | Origem | Classe | Depende de |
|---|---|---|---|---|
| `MOUNT-001` | Spike das APIs de par montado do Hijos | Hijos | PORT | P0, `PATCH-001` |
| `MOUNT-002` | Avaliar *lease*/*serial* como padrão geral de estado compartilhado | Hijos | ADAPT | `MOUNT-001` |

`MOUNT-001` é o achado técnico mais forte da pesquisa e está deliberadamente em P6.

O que ele destrava: `horse-service.js` está PARKED com o gate "shared state/ownership não resolvidos — native spike". Esses commits **são** o native spike que o gate pede. `setMountedPairKinematicTransform(horse, rider, lease, serial, …)` e `setCharacterControllerCollisionProfile(actor, profile, lease)` são GPL-3.0, compatíveis com nossa AGPL-3.0, portáveis com atribuição.

Por que não é mais cedo: são ~700 linhas de C++ mexendo em character controller e física do Havok. Fora do `transaction-service`, é o código de maior risco de crash que já consideramos. Exige spike isolado com critério de rollback, e exige `PATCH-001` primeiro — é exatamente o tipo de mudança que vira fork pesado se entrar sem registro.

`MOUNT-002` é a parte que pode valer mais que as montarias. O padrão *lease + serial* — posse temporária revogável, mais número de sequência que descarta atualização fora de ordem — é a mesma coisa que nossa auditoria de 12/08 recomendou de forma independente para estado compartilhado em geral. Duas equipes chegando na mesma peça por caminhos diferentes é o sinal mais forte que uma pesquisa comparativa produz. Vale avaliar como padrão para objetos, portas e containers, não só para cavalos.

---

## P7 — Observabilidade e escala

| ID | Tarefa | Origem | Classe |
|---|---|---|---|
| `OPS-002` | Postgres/Redis nunca publicados; só rede interna | Crows | ADAPT |
| `OPS-003` | Docker Compose com build reproduzível | Crows | RESEARCH |

Os cenários de escala (10/30/50/100/200 jogadores) continuam em [`HEAVY_RP_GAP_ANALYSIS.md`](../research/HEAVY_RP_GAP_ANALYSIS.md#cenários-obrigatórios-de-escala). Esta rodada não os altera.

---

## Rejeitado — e por quê

Registrar rejeição evita que a mesma ideia volte daqui a três meses sem o contexto.

| Item | Origem | Motivo |
|---|---|---|
| Flags CEF de auto-aceite de mídia | Hijos | Removem consentimento e isolamento de origem. Helper WASAPI nativo já resolve melhor |
| Portar launcher C#/WPF | Crows | Nosso launcher é Electron. Portar é reescrever; adaptar ModSync não é |
| Portar backend FastAPI | Crows | Nosso backend é Node. Mesma lógica |
| `sync-client.mjs` | Divine Comedy | Sobrescreve fonte upstream em silêncio, sem registro |
| Papyrus como camada de gameplay | Red House, Frostfall | Roda no cliente: superfície de trust que não precisamos abrir |
| Pesquisar Planet Nirn | Planet Nirn | Sem código próprio. É `skyrim-roleplay/skymp` rebrandado, já pesquisado |
| Esvaziar `Skyrim.ccc` | Divine Comedy | Reverte quando o Steam verifica. `MOD-005` ataca a causa |

---

## Ordem sugerida

```text
Fase 0  ─────────────────────────────────────────►  (bloqueia tudo)
   │
   ├─ ✅ feito       SEC-QS-01 · PATCH-001 · MOD-005 (detecção)
   │
   ├─ não bloqueado  RES-001 · RES-002 · INV-001
   │
   └─ depois da Fase 0
        MOD-006 → MOD-007
        INT-001 → INT-002 → (trade, crafting, propriedades)
        ECON → CONTRACT-001 → CONTRACT-002
        MOUNT-001 → MOUNT-002        (PATCH-001 já é pré-requisito atendido)
```

Três das tarefas não bloqueadas foram feitas em 13/08. Sobram `RES-001`, `RES-002` e `INV-001`, que podem andar em paralelo com a preparação da sessão de teste — nenhuma delas mexe em gameplay.

O que **não** foi implementado, e por quê:

| Tarefa | Por que não agora |
|---|---|
| `MOUNT-001` | ~700 linhas de C++ em física do Havok. Exige clonar o SkyrimPlatform, compilar e um spike com rollback. Não cabe junto de outras mudanças, e a Fase 0 vem antes |
| `CONTRACT-001/002` | Depende de economia e inventário transacionais, hoje PARKED sob `ECON-01`. Construir contratos antes disso é construir sobre o problema que eles expõem |
| `INT-001/002` | Domínio novo e fundação de trade, crafting e propriedades. Merece ADR antes de código, e validação na Fase 0 antes do ADR |
| `RBAC-001` | Depende de `RES-002`: não lemos uma linha do RBAC do Crows, só nomes de arquivo |
| `MOD-006/007` | Dependem da decisão de produto de `MOD-005` e de `MOD-001..004` |

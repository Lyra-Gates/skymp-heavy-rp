# Revisão: os sistemas que dependem de realidade compartilhada

Data: **09/08/2026**. Base: [`SKYMP_UPSTREAM_REFERENCE.md`](SKYMP_UPSTREAM_REFERENCE.md) §8,
levantada nesta mesma rodada.

Este projeto tem oito sistemas cuja suposição central é *"todo jogador vê ou sabe
a mesma coisa, resolvida de um lugar só"*. Todos foram construídos com uma
hipótese sobre como o SkyMP resolve estado compartilhado por baixo, e nenhuma
dessas hipóteses tinha sido conferida contra a arquitetura real — só contra o
comportamento observado em teste automatizado, que roda com `mp` **mockado**. Um
mock aceita qualquer payload; o addon nativo não.

Esta revisão cruza cada suposição com a arquitetura. **Nenhuma linha de código
mudou.**

## Como ler os vereditos

| | Significado |
|---|---|
| ✅ **Confirmado** | A suposição bate com o que se sabe da arquitetura real. |
| 🟡 **Provável, pendente de Fase 0** | A arquitetura sustenta a suposição; só jogador real fecha. É o resultado esperado da maioria. |
| 🔴 **Desalinhado** | A suposição não bate com o que a arquitetura faz. |
| ⚪ **Não verificável** | Nem a referência upstream nem o código local respondem. |

Procedência, como no resto do projeto: **`[DOC]`** é código-fonte primário lido;
**`[DEEPWIKI]`** é a wiki gerada, não conferida contra o código — evidência, não
veredito fechado. Nesta rodada a distinção pagou: a wiki **omite**
`locationalData` da lista de PropertyBindings, o que teria condenado três
serviços por engano. O código primário desmentiu (`§8.2` da referência).

---

## Tabela-resumo

| Sistema | Veredito | Em uma frase |
|---|---|---|
| `core/hit-events.js` | 🟡 | O caminho `makeEventSource` → `OnCustomEvent` existe e a assinatura bate; o `0x14` é convenção de cliente e só a Fase 0 fecha. |
| `core/safe-zones.js` | 🔴 | A leitura está certa, mas o `cellId` do exemplo (`"0x162e2"`) não é o formato `FormDesc` que o servidor devolve — a zona nunca casaria, e falharia **aberta**. |
| `identity-service` / `nametag-service` | 🟡 | A resolução de nome por observador é nossa e não depende do SkyMP; a projeção mundo→tela continua não observada. |
| `voip-service` | 🟡 | A única dependência real do SkyMP é a leitura de posição, e ela está correta; o resto do caminho de áudio é nosso. |
| `death-service` | 🔴 | Dois desalinhamentos independentes: o servidor **respawna sozinho em 25 s** e o payload do nosso respawn **lança**. |
| `market-stalls-service` / governança | 🟡 | Lê `cellOrWorldDesc` corretamente e compara célula com célula; sem formato de config envolvido. |
| `npc-cleaner.js` | ✅ | `baseDesc` no formato `"1a6a0:Skyrim.esm"` é **exatamente** o que `BaseDescBinding` devolve. |
| Escala de mob | ✅ (fechado em outro prompt) | Resolução de lista nivelada é do servidor, nível constante, resultado por ator. Não reaberto aqui. |

**Um achado é sistêmico e explica dois dos três 🔴:** o projeto trata identidade
de célula como *hexadecimal com prefixo `0x`*, e o SkyMP a trata como
**`FormDesc` em string** (`"162e2:Skyrim.esm"`). Ver §9.

---

## 1. `core/hit-events.js` — evidência de combate por proximidade

**Suposição do código.** Que `mp.makeEventSource(nome, snippet)` injeta JS no
cliente; que o servidor recebe em `mp[nome] = (pcFormId, evento) => {}` com o
evento já como objeto; que `0x14` é o FormID com que o cliente se refere a si
mesmo e o servidor precisa trocá-lo por `pcFormId`
([hit-events.js:138](../../skymp/gamemode/core/hit-events.js:138)); e que
`ctx.getFormIdInServerFormat()` é obrigatório porque os espaços de FormID de
cliente e servidor diferem.

**O que a arquitetura diz.**

- **[DOC]** `mp.makeEventSource` está registrado em `ScampServer.cpp`
  (referência §8.3). O mecanismo existe.
- **[DEEPWIKI]** (2.4.2) Eventos customizados chegam por `OnCustomEvent`
  (`ActionListener.cpp:15`) com `actorId`, `eventName` e `argsJson`. Isso casa
  com nossa assinatura `(pcFormId, evento)`.
- **[DOC]** `ScampServerListener.cpp:87-94` faz `JSON.parse` de **cada elemento**
  do array de argumentos antes de chamar o handler. Confirma que `evento` chega
  como objeto, não como string — nosso `evento.aggressor` funciona.
- **[DEEPWIKI]** (2.4.2) `SendToNeighbours` garante que o remetente é dono do
  ator que ele afirma controlar. Isso **reforça** a decisão de tratar o evento
  como evidência: o servidor valida a posse do ator, não a veracidade do golpe.

**Veredito: 🟡 Provável, pendente de Fase 0.**

O caminho está correto de ponta a ponta do lado do servidor. O que não fecha é o
`0x14`: ele é convenção do **Skyrim Platform no cliente**, e a wiki do servidor
não fala dele. A fonte continua sendo o Red House
(`REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1) — que é código real que rodou, mas
de 2021. O snippet nunca foi exercitado; só a Fase 0 fecha. Isso já estava
registrado em `ARCHITECTURE.md` §1.4.5 e continua exato.

---

## 2. `core/safe-zones.js` — bloqueio por célula/posição

**Suposição do código.** Que `mp.get(actorId, 'locationalData')` devolve célula e
posição; que `loc.pos` é um array de 3 números; e que a célula do ator pode ser
comparada por **igualdade de string** com o `cellId` escrito na config
([safe-zones.js:177-189](../../skymp/gamemode/core/safe-zones.js:177)).

**O que a arquitetura diz.** **[DOC]** `LocationalDataBinding.cpp` (referência
§8.4) devolve exatamente:

```js
{ cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [x,y,z], rot: [x,y,z] }
```

- A **leitura está certa**: `loc.cellOrWorldDesc` é o primeiro item da nossa
  cadeia defensiva, é string, e `loc.pos` é array de 3 — o `_distancia3D` e o
  raio funcionam. Os outros três nomes da cadeia (`cellOrWorldSpaceId`,
  `cellId`, `worldOrCell`) não existem: são código morto, mas inofensivo.
- **O formato do valor está errado.** **[DOC]** `FormDesc.cpp` (§8.5): a string
  canônica é hex **sem prefixo `0x`**, `:`, nome do arquivo. O exemplo em
  `skymp/config/safe-zones.example.json` traz `"cellId": "0x162e2"`.

`"0x162e2" !== "162e2:Skyrim.esm"` — a comparação de string nunca casa.

**Veredito: 🔴 Desalinhado.**

**Impacto prático.** Hoje é **latente**: `zones` nasce vazia e `enabled` é
`false`, então nada acontece — e é por isso que nenhum teste pegou. O problema é
o dia em que alguém preencher a config copiando o exemplo: a zona é aceita pelo
loader (o `cellId` é uma string não-vazia, que é tudo que ele valida), aparece
nos logs como carregada, e **nunca dispara**. Uma zona segura que falha assim
falha **aberta** — a proteção simplesmente não existe, sem erro em lugar nenhum.
É o modo de falha que o próprio cabeçalho do arquivo diz querer evitar:
*"config ausente não pode virar comportamento surpresa"*.

**Proposta (não implementada).**

1. Corrigir `safe-zones.example.json` para o formato `FormDesc`
   (`"162e2:Skyrim.esm"`) e documentar isso no `_sobre_area`.
2. Validar o formato no `loadZones()`: um `cellId` que case `/^0x/i` ou que não
   contenha `:` é quase certamente erro de digitação — recusar com log explícito,
   como já se faz com categoria desconhecida.
3. Alternativa mais robusta que não depende de o humano acertar o formato: aceitar
   FormID numérico na config e converter com **`mp.getDescFromId`** **[DOC]**
   (§8.3), que existe exatamente para isso.

---

## 3. `identity-service` / `nametag-service` — quem sabe o nome de quem

**Suposição do código.** Duas, separáveis:

1. **Resolução de nome** — que o servidor decide, por observador, qual nome cada
   pessoa vê (`identity.getDisplayName(observador, alvo)`), e que isso é estado
   do nosso banco, não do SkyMP.
2. **Projeção mundo→tela** — que `ctx.sp.worldPointToScreenPoint` é alcançável do
   snippet injetado via `makeProperty`/`updateOwner`; que
   `ctx.getFormIdInClientFormat` traduz o FormID de servidor; que os eixos vão de
   −1 a +1 com `y` positivo para cima
   ([nametag-service.js:209-229](../../skymp/gamemode/nametag-service.js:209)).

**O que a arquitetura diz.**

- **[DOC]** `mp.makeProperty` está registrado em `ScampServer.cpp` (§8.3) — o
  canal existe, e já é o mesmo comprovado de `browserModal`/`panelData`.
- **[DOC]** A escolha do alvo compara `_celula(loc)` **dos dois atores**, ambos
  vindos de `locationalData`. Como é célula contra célula (e não célula contra
  config), o formato `FormDesc` não atrapalha: strings iguais comparam iguais.
  **Este sistema não é atingido pelo achado da §9.**
- **[DEEPWIKI]** (2.5, 2.4.1) + **[DOC]** (`NeighborsBinding.cpp`,
  `ScampServer.cpp`) — o servidor **já mantém** a vizinhança por grid, exposta
  como property `neighbors`/`actorNeighbors` e como `mp.getNeighborsByPosition`.
  Nosso `tick()` varre `listActiveActorIds()` e faz O(n²) de distância 3D a cada
  2 s, reimplementando o que já existe.
- A projeção em si é **API de cliente** (Skyrim Platform). A wiki do servidor não
  a cobre.

**Veredito: 🟡 Provável, pendente de Fase 0.**

A parte que o servidor resolve está correta e não depende de nada que a
arquitetura contrarie. A parte de cliente permanece **⚪ dentro deste veredito**:
`worldPointToScreenPoint` nunca foi chamada, a convenção dos eixos não foi
verificada e o custo do `executeJavaScript` a 20 Hz não foi medido. Isso já está
registrado com o peso certo em `ARCHITECTURE.md` §1.4.8 e no cabeçalho §4 do
arquivo — esta revisão **não muda** aquele registro, confirma que ele é honesto.

**Nota, não achado.** O O(n²) manual não está errado — está caro à toa. Com
`mp.getNeighborsByPosition` ou a property `neighbors`, o mesmo tick sai do grid
do servidor. Vale considerar quando a POC virar feature, não antes: hoje o
gargalo desconhecido é a CEF, não a distância.

---

## 4. `voip-service` — volume por distância e retransmissão por proximidade

**Suposição do código.** Que `mp.get(actorId, 'locationalData')` dá posição
confiável a cada 2 s para calcular volume por distância
([voip-service.js:404](../../skymp/gamemode/voip-service.js:404)); e que a
retransmissão de `audio_frame` por proximidade pode se apoiar no resultado desse
mesmo tick.

**O que a arquitetura diz.** **[DOC]** A leitura de `locationalData` está
correta (§8.4) — mesma base do item 2, e aqui **sem** config envolvida, então
sem o problema de formato.

O resto do caminho — WebSocket próprio na 7778, ticket de uso único, helper
nativo capturando fora do CEF, servidor retransmitindo com volume anexado — **não
passa pelo SkyMP**. A arquitetura do upstream não sustenta nem contraria: ela
simplesmente não opina.

**Veredito: 🟡 Provável, pendente de Fase 0.**

A única dependência real de estado compartilhado do SkyMP é a posição, e ela está
certa. O que falta validar é o que já se sabia que faltava e não é assunto de
arquitetura: **ninguém ouviu áudio ainda** (`ARCHITECTURE.md` §1.4.4).

---

## 5. `death-service` — autoria de morte e resgate por proximidade

Este é o sistema onde a rodada se pagou. **Dois desalinhamentos independentes.**

### 5.1 O que está confirmado

**[DOC]** `gamemode_events/DeathEvent.cpp` (§8.6) confirma, exatamente como
`ARCHITECTURE.md` §1.4.3 descreve:

- O hook chama-se literalmente `"onDeath"`.
- Os argumentos são `[actorId, killerId]`, com **`killerId = 0`** quando não há
  autor — o nosso tratamento de "0 = sem autor" está certo.
- **[DOC]** `ScampServerListener.cpp:41-56` busca `mp.onDeath` como **property do
  objeto `mp`**. Ou seja: `mp.onDeath = handler` é a convenção correta, e a
  decisão do `core/death-events.js` de ser dono único do slot está bem fundada —
  o slot é mesmo exclusivo, e um segundo `mp.onDeath = ...` apagaria o primeiro
  em silêncio, exatamente como o cabeçalho daquele arquivo argumenta.

Isso tudo é ✅ dentro do sistema.

### 5.2 🔴 Achado A — o servidor respawna sozinho em 25 s

**Suposição do código.** Que, depois de `onDeath`, o personagem fica onde caiu e
sob nosso controle pelos 4 minutos de `BLEED_OUT_MS`, até alguém usar `/socorrer`
ou o bleed-out fechar.

**O que a arquitetura faz.** **[DOC]** `DeathEvent::OnFireSuccess` chama
**`actor->RespawnWithDelay()`**. **[DOC]** `GameModeEvent::Fire` só chama
`OnFireSuccess` se **nenhum** listener devolveu `false`. **[DOC]**
`ScampServerListener.cpp:105-111` fixa o contrato:

| `mp.onDeath` devolve | Efeito |
|---|---|
| `undefined` | não bloqueia → **respawn automático acontece** |
| `false` | bloqueia → sem respawn |
| lança | erro logado, **não bloqueia** |

Nosso handler é
`mp.onDeath = (actorId, killerId) => _dispatch(actorId, killerId)`
([death-events.js:112](../../skymp/gamemode/core/death-events.js:112)), e
`_dispatch` é um laço `for` sem `return`
([death-events.js:78-89](../../skymp/gamemode/core/death-events.js:78)) —
**devolve `undefined`**.

**[DOC]** `MpChangeForms.h:109`: `float spawnDelay = 25.0f`. E um `grep` por
`spawnDelay` no gamemode inteiro não devolve nada — nunca ajustamos.

**Impacto prático.** O jogador morre. Nosso estado vira `DOWNED` e abre a janela
de socorro de 4 minutos. **Aos 25 segundos o servidor ressuscita e teleporta o
personagem para o `spawnPoint`**, por conta própria, sem passar por
`executeRespawn`, sem penalidade de ouro, sem `characterState`, sem
`panelRefreshBus`. A pessoa levanta no meio do mundo enquanto a nossa máquina de
estado ainda a considera caída e aguardando resgate pelos 3,5 minutos restantes —
e `/socorrer` continua "funcionando" sobre alguém que já está de pé em outro
lugar.

Isto **derruba o desenho inteiro de morte com consequência**, que é o ponto
central de Heavy RP do `SKYMP_RP_DEVELOPMENT_PLAN.md` §8.1. E é invisível em
teste: o `mp` mockado não tem `DeathEvent`, não tem `spawnDelay` e nunca
respawna ninguém.

**Proposta (não implementada).** `_dispatch` precisa poder devolver `false`, e o
`death-service` precisa pedir isso. Duas decisões que **não** são minhas de
tomar:

1. **Bloquear sempre** (`return false` incondicional) e assumir 100% do ciclo de
   morte — coerente com o desenho atual, mas passa a ser nossa a
   responsabilidade de todo respawn, inclusive nos caminhos de erro.
2. **Bloquear e reprogramar** — devolver `false` e ajustar a property
   `spawnDelay` **[DOC]** para a janela que quisermos, deixando o servidor fazer
   o respawn no tempo certo.

A opção 1 é a que menos muda o código existente. A 2 é a que menos duplica
mecanismo do servidor. Registrado como decisão aberta, não resolvida aqui.

Há também um efeito de segunda ordem a considerar junto: `RespawnWithDelay` é
como o servidor devolve **qualquer** ator morto ao mundo. O `hunting-service`
previsto em `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.3 vai assinar o mesmo hook —
e um `return false` global mataria o respawn **dos mobs também**. O barramento
`death-events.js` vai precisar de uma política de agregação de retorno (bloqueia
se algum assinante pedir? só o dono do ator decide?), que hoje ele não tem.

### 5.3 🔴 Achado B — o payload do nosso respawn lança

**Suposição do código.** Que `mp.set(actorId, 'locationalData', {...})` aceita
`{ pos, worldOrCell, angleZ }`
([death-service.js:369-373](../../skymp/gamemode/death-service.js:369)).

**O que a arquitetura exige.** **[DOC]** `LocationalDataBinding::Set` (§8.4) lê
exatamente `cellOrWorldDesc` (string), `pos` (array) e `rot` (array), via
`NapiHelper::ExtractString` / `ExtractNiPoint3`, que **lançam** quando o valor
não é do tipo esperado (`NapiHelper.h:96,218`).

Nosso objeto não tem `cellOrWorldDesc` (tem `worldOrCell`) e não tem `rot` (tem
`angleZ`). `Get("cellOrWorldDesc")` devolve `undefined`, que não é string →
**`std::runtime_error`**.

E há um segundo erro embutido: `RESPAWN_CELL = '0x162e2'`
([death-service.js:36](../../skymp/gamemode/death-service.js:36)) não é
`FormDesc`. Mesmo com a chave certa, **[DOC]** `FormDesc::FromString("0x162e2")`
não encontra `:`, cai no ramo sem arquivo, e `ToFormId` resolve para
`0xff000000 + 0x162e2` — a faixa de forms **gerados pelo servidor**, não o Templo
de Kynareth. Ou seja: dois defeitos empilhados, e o segundo só apareceria depois
de consertar o primeiro.

**Impacto prático.** Em `executeRespawn`, a ordem é: `Resurrect` via Papyrus
(linha 367) → `mp.set` (linha 369, **lança**) → e as linhas 374 a 382 **nunca
rodam**. Resultado: o personagem é ressuscitado **onde caiu**, `_wasDead`
continua `true`, `characterState` nunca volta para `NORMAL`, o jogador não recebe
notificação e o painel não atualiza. O `catch` da linha 383 loga
`Failed to respawn actor` e o servidor segue.

Combinado com o Achado A, o comportamento real na Fase 0 seria: morrer → levantar
sozinho aos 25 s em outro lugar → e, se alguém chegasse a acionar o bleed-out,
uma segunda ressurreição no lugar errado com o estado travado.

**Proposta (não implementada).** Corrigir o payload para
`{ cellOrWorldDesc: "162e2:Skyrim.esm", pos: RESPAWN_POS, rot: [0,0,0] }` — ou,
preferível, derivar a string com **`mp.getDescFromId`** **[DOC]** em vez de
escrevê-la à mão, que é a mesma classe de erro que a §9 descreve. Confirmar o
`162e2` contra o ESM antes: o valor herdado nunca foi verificado in-game.

### Veredito do sistema: 🔴 Desalinhado (dois achados)

`mp.onDeath` e `killerId` estão ✅; o ciclo de vida em volta deles, não.

---

## 6. `market-stalls-service` / governança — ações condicionadas a proximidade

**Suposição do código.** Que dá para condicionar ação à célula e à distância
lendo `locationalData`, priorizando mesma célula e depois menor distância
euclidiana ([market-stalls-service.js:154-158](../../skymp/gamemode/market-stalls-service.js:154)).

**O que a arquitetura diz.** **[DOC]** A leitura está correta: a cadeia começa em
`loc.cellOrWorldDesc`, que é o campo real (§8.4). O `'unknown'` no fim da cadeia
é um fallback que nunca será alcançado, o que é o comportamento desejado.

Assim como no nametag, a comparação é **célula de ator contra célula de ator** —
nenhuma string de config entra na conta. Imune ao achado da §9.

**[DEEPWIKI]** (2.4.2) reforça de fora: o servidor já valida posse de ator em
`SendToNeighbours` antes de aceitar mudança de estado, então uma ação de mercado
condicionada a proximidade não está apoiada em posição que o cliente possa
inventar livremente — `MovementValidation::Validate` recusa teleporte impossível.

**Veredito: 🟡 Provável, pendente de Fase 0.**

Nada na arquitetura contraria. O que falta é o de sempre: ninguém executou uma
compra com duas pessoas conectadas. O `GOVERNANCE_MARKET_STALLS_TEST_PLAN.md` já
existe para isso.

---

## 7. `npc-cleaner.js` — curadoria por `baseDesc`

**Suposição do código.** Que `mp.get(npcActorId, 'baseDesc')` devolve uma
**string** no formato `"1a6a0:Skyrim.esm"`, comparável diretamente com a lista de
bloqueio da config; e que `mp.getActorsByProfileId(0)` enumera NPCs
([npc-cleaner.js:162-170](../../skymp/gamemode/npc-cleaner.js:162)).

**O que a arquitetura diz.**

- **[DOC]** `BaseDescBinding.cpp` devolve
  `FormDesc::FromFormId(refr.GetBaseId(), espmFiles).ToString()` — string, no
  formato `shortFormId` hex sem `0x` + `:` + arquivo. **[DOC]** `FormDesc.cpp`
  confirma o formato. `"1a6a0:Skyrim.esm"` é exatamente isso.
- **[DOC]** `getActorsByProfileId` está registrado em `ScampServer.cpp` (§8.3).

**Veredito: ✅ Confirmado.**

Vale registrar por que este acertou: o comentário em
[npc-cleaner.js:40](../../skymp/gamemode/npc-cleaner.js:40) mostra que a versão
anterior comparava `baseDesc` (string) com FormID numérico e que isso foi
corrigido deliberadamente. O `npc-policy.example.json` já traz o formato certo.
Foi o único sistema que enfrentou a questão do formato de `FormDesc` de frente —
e é justamente o que a §9 mostra que faltou nos outros dois.

---

## 8. Escala de mob — já fechado nesta rodada

Não reaberto. `HOSTILE_MOB_ACTIVATION_DECISION.md` (§7.4 e "Veredito primeiro",
09/08/2026) registra o resultado:

> a leitura do código do upstream mostrou que a resolução de lista nivelada é
> **do servidor**, com nível constante e resultado guardado por ator — o que
> aponta para a decisão desta rodada ser sustentável, sem fechá-la.

Ou seja: o medo de dois jogadores lado a lado verem o mesmo lobo com forças
diferentes **não se confirma** na arquitetura. Continua na lista do censo como
expectativa a confirmar, não como risco que derruba o desenho. Esta revisão não
acrescenta nada e não contradiz.

---

## 9. O achado sistêmico: identidade de célula não é hexadecimal

Dois dos três 🔴 têm a mesma raiz, e vale nomeá-la separada dos sistemas:

**O projeto trata identidade de célula como número hex com prefixo `0x`. O SkyMP
a trata como `FormDesc` serializado em string.**

| Onde | Escrito | Deveria ser |
|---|---|---|
| `death-service.js:36` | `RESPAWN_CELL = '0x162e2'` | `'162e2:Skyrim.esm'` |
| `safe-zones.example.json` | `"cellId": "0x162e2"` | `"162e2:Skyrim.esm"` |

Os dois vieram do mesmo valor herdado. E os dois falham **em silêncio**, que é o
que os torna caros: **[DOC]** `FormDesc::FromString` não valida — sem `:` ela
apenas resolve para outra faixa de FormID (§8.5). Não há exceção, não há log.

Onde a comparação é **ator contra ator** (nametag, market-stalls, voip) o formato
não importa, porque os dois lados vêm da mesma fonte. O erro só aparece quando
uma **string escrita por humano** entra na conta. Isso é uma regra útil para as
próximas features: *toda constante de célula ou de base escrita à mão é suspeita
até ser derivada de `mp.getDescFromId` ou conferida contra `FormDesc`.*

---

## O que isto muda para a Fase 0

**Cinco dos oito sistemas saíram sem achado** — `hit-events`, nametag/identidade,
voz, mercado/governança e escala de mob estão arquiteturalmente coerentes com a
plataforma real, e o `npc-cleaner` está ✅ confirmado. Para esses, a Fase 0 segue
como planejada: o que falta é a validação ao vivo que ela já existe para fazer, e
nada nesta revisão sugere que ela vá encontrar surpresa de arquitetura.

**Um sistema bloqueia parte da sessão: o `death-service`.**

Prioridade entre os 🔴:

1. **`death-service` Achado A (respawn automático em 25 s) — bloqueia.** Não
   adianta testar morte, socorro e bleed-out com o servidor ressuscitando o
   jogador aos 25 segundos por baixo. A etapa de morte do `FASE_0_ROTEIRO.md`
   mediria um comportamento que não é o desenhado, e o mais provável é que a
   sessão gastasse tempo de duas pessoas depurando "o socorro não funciona"
   quando o problema é outro. **Precisa de conserto antes da sessão**, e o
   conserto depende de uma decisão de desenho (bloquear sempre × reprogramar
   `spawnDelay`) que não é técnica.
2. **`death-service` Achado B (payload do respawn lança) — bloqueia junto.** É o
   mesmo teste, e consertar A sem B só troca o sintoma: o jogador ficaria caído
   até o bleed-out e então falharia o respawn. Os dois saem na mesma rodada de
   código, e o B é o mais barato dos dois.
3. **`safe-zones` (formato do `cellId`) — não bloqueia.** As zonas nascem vazias
   e desligadas; nada na Fase 0 depende delas. Vale corrigir o exemplo e a
   validação **antes de alguém preencher a config**, que é quando o defeito
   passaria a valer — mas isso pode acontecer depois da sessão sem custo.

**O resto da Fase 0 não muda.** Nenhum outro sistema precisa de atenção extra
durante a sessão por causa desta revisão; os pontos que já pediam observação
cuidadosa (o snippet de hit nunca ter rodado, a projeção da nametag nunca ter
sido chamada, ninguém ter ouvido áudio) continuam exatamente com o peso que
`ARCHITECTURE.md` §1.4.4, §1.4.5 e §1.4.8 já lhes davam. Esta revisão não os
agrava nem os alivia — confirma que aqueles registros são honestos.

**Um ganho colateral, para depois da Fase 0:** o servidor já mantém vizinhança
por grid e a expõe (`mp.getNeighborsByPosition`, properties `neighbors` /
`actorNeighbors` / `onlinePlayers`). Voz e nametag reimplementam isso em O(n²) a
cada 2 s. Não é defeito e não é urgente — é a peça óbvia a considerar quando
qualquer um dos dois sair de POC.

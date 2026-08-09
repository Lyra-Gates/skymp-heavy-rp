# Revisão: os sistemas que dependem de realidade compartilhada

Data: **09/08/2026**. Base: [`SKYMP_UPSTREAM_REFERENCE.md`](SKYMP_UPSTREAM_REFERENCE.md)
**§8 e §9**, levantadas nesta mesma rodada.

> **Segunda passagem.** A primeira versão deste documento (commit `7ef31fb`,
> 00:37) cruzou os sistemas contra a **§8** da referência. Às 04:34 a **§9**
> entrou — a varredura sistemática do DeepWiki, com um achado `[DOC]` verificado
> linha a linha. Ela **muda três vereditos** desta revisão, e o principal é
> justamente o sistema que a primeira passagem tinha liberado como 🟡. Reler a
> §1 e a §8 abaixo é o ponto desta atualização; o resto está mantido.

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
veredito fechado. Nesta rodada a distinção pagou duas vezes: a wiki **omite**
`locationalData` da lista de PropertyBindings, o que teria condenado três
serviços por engano (o código primário desmentiu, §8.2); e a wiki **afirma** que
só `connect`/`disconnect`/`packet` chegam ao JS, o que a §9.1 desmente com a
cadeia inteira lida no código.

---

## Tabela-resumo

| Sistema | Veredito | Em uma frase |
|---|---|---|
| `core/hit-events.js` | 🔴 | Existe um caminho nativo (`mp["onPapyrusEvent:OnHit"]`) com o agressor **já resolvido e validado pelo servidor**, e não o usamos — coletamos em paralelo a ele. |
| `core/safe-zones.js` | 🔴 | A leitura está certa, mas o `cellId` do exemplo (`"0x162e2"`) não é o formato `FormDesc` que o servidor devolve — a zona nunca casaria, e falharia **aberta**. |
| `identity-service` | ✅ | Resolução de nome por observador é 100% nossa, em banco; não há suposição sobre o SkyMP para conferir. |
| `nametag-service` | 🟡 | A projeção mundo→tela não é contrariada por nada; a wiki aponta um caminho mais barato (`SetTextRefr()`) que ninguém verificou. |
| `voip-service` | 🔴 | Calcula distância entre atores **sem comparar célula** — único dos três sistemas de proximidade que não faz isso. |
| `death-service` | 🔴 | Dois desalinhamentos independentes: o servidor **respawna sozinho em 25 s** e o payload do nosso respawn **lança**. |
| `market-stalls-service` / governança | 🟡 | Lê `cellOrWorldDesc` corretamente e compara célula com célula; duas properties de barraca ficam ⚪. |
| `npc-cleaner.js` | ✅ | `baseDesc` no formato `"1a6a0:Skyrim.esm"` é **exatamente** o que `BaseDescBinding` devolve. |
| Escala de mob | ⚪ | Metade `[DOC]` e fechada (lista nivelada é do servidor); a outra metade — se **estatística** escala por cliente — segue em aberto e é medição da Fase 0. |

**Um achado é sistêmico e explica dois dos 🔴:** o projeto trata identidade de
célula como *hexadecimal com prefixo `0x`*, e o SkyMP a trata como **`FormDesc`
em string** (`"162e2:Skyrim.esm"`). Ver §10.

**O que mudou da primeira passagem para esta:**

| Sistema | Antes (§8) | Agora (§8 + §9) | Por quê |
|---|---|---|---|
| `core/hit-events.js` | 🟡 | **🔴** | §9.1 `[DOC]`: o `OnHit` nativo chega ao gamemode e já resolve o `0x14` |
| `voip-service` | 🟡 | **🔴** | Leitura de código nesta passagem: `tickProximity` ignora a célula |
| Escala de mob | ✅ | **⚪** | §9.8 registra explicitamente que a wiki **não** responde a parte que importa |

---

## 1. `core/hit-events.js` — evidência de combate por proximidade

> **Este é o achado que a §9 trouxe, e ele inverte o veredito da primeira
> passagem.** Nada aqui diz que o sistema atual está quebrado. Diz que existe um
> caminho mais forte, disponível hoje, que não estamos usando.

**Suposição do código.** O cabeçalho de
[hit-events.js:15-21](../../skymp/gamemode/core/hit-events.js:15) e a
`ARCHITECTURE.md` §1.4.5 registram a premissa em texto: *"o SkyMP **recusou**
expor o pacote de hit ao gamemode (issue #1338) — o evento é reconstruído do lado
do cliente"*. Disso decorre tudo o mais: que `makeEventSource` é o único caminho
barato; que o snippet precisa capturar `ctx.sp.on('hit')` por conta própria; que
`0x14` é problema nosso para traduzir
([hit-events.js:138](../../skymp/gamemode/core/hit-events.js:138)); e que o
resultado é *"evidência, não enforcement"* porque vem cru do cliente.

**O que a arquitetura diz.**

- **`[DOC]`** (§9.1, cadeia lida arquivo por arquivo no upstream `main`) — não
  existe `mp.onHit`, **mas o evento chega assim mesmo**, por outro nome:

  ```js
  mp["onPapyrusEvent:OnHit"] = (
    targetFormId, akAggressor, akSource, akProjectile,
    abPowerAttack, abSneakAttack, abBashAttack, abHitBlocked
  ) => { /* ... */ };
  ```

  O caminho é `ActionListener::OnHit` → `SendPapyrusOnHitEvent` →
  `MpForm::SendPapyrusEvent` → `PapyrusEventEvent` (que prefixa
  `"onPapyrusEvent:"`) → `ScampServerListener::OnMpApiEvent`.
- **`[DOC]`** (§9.1, item 2 da cadeia) — **o servidor traduz o `0x14` sozinho**:
  `if (hitData.aggressor == 0x14) { aggressor = myActor; ... }`, e o mesmo para
  `target`. A tradução que fazemos à mão já vem feita.
- **`[DOC]`** (§9.1, itens 3 e 4) — antes de despachar, o servidor **já validou**:
  agressor pertence ao usuário (ou é o *hoster* registrado), mesma
  célula/worldspace, distância ≤ 4096 unidades, agressor não está morto, alcance
  de arma e cadência (`CanHit`).
- **`[DOC]`** (§9.1, item 11 / `PapyrusUtils.h:14-49`) — o agressor chega como
  `{ type: 'form', desc: '<FormDesc>' }`, que é **exatamente** o formato que
  `core/papyrus.js` (`actorRef`/`baseRef`) já usa.
- **`[DEEPWIKI]`** (§9.4, `hitService.ts:15-69`) — o cliente nativo manda `OnHit`
  como **RELIABLE** (ao contrário de movimento e vitais, que são UNRELIABLE), e
  **já filtra**: descarta golpe em objeto estático e só aceita atacante que seja
  o jogador local ou um NPC hospedado por ele.
- **`[DOC]`** — um `grep` por `onPapyrusEvent` no gamemode inteiro não devolve
  nada. Nem o `types/mp.d.ts` declara. Nunca usamos.

**Veredito: 🔴 Desalinhado.**

A premissa escrita no cabeçalho do arquivo — *"o dado não chega ao gamemode"* —
**é falsa**. "Não existe `mp.onHit`" é verdade e continua sendo; a conclusão
tirada dali não. A referência já registra a correção na própria §4, com o aviso
de que aquela seção estava parcialmente errada desde que foi escrita.

**Impacto prático.** Não é que o combate esteja quebrado hoje: o
`makeEventSource` continua sendo um caminho válido, e o sistema de episódios em
volta dele é nosso e não muda. O custo é outro, e tem três partes:

1. **Estamos coletando em paralelo a um canal que já existe.** O cliente nativo
   já captura, filtra e envia o golpe como RELIABLE. Nosso snippet injeta um
   segundo `ctx.sp.on('hit')` no mesmo loop de jogo para capturar o mesmo evento
   — trabalho duplicado na máquina do jogador, que é justamente onde o cabeçalho
   do arquivo diz querer ser econômico.
2. **A qualidade da evidência é menor do que precisaria ser.** Hoje aceitamos o
   que o snippet disser. Pelo caminho nativo, o servidor já teria descartado
   golpe de ator morto, de célula diferente, fora de alcance e fora de cadência
   **antes** de nos contar. Para arbitragem de RDM — que é o propósito declarado
   do módulo — isso é um degrau de confiabilidade a mais, de graça.
3. **O `0x14` deixa de ser risco.** Ele é hoje o único ponto do módulo cuja
   fonte é o Red House de 2021 e não documentação nossa, e a primeira passagem
   desta revisão o marcou como "só a Fase 0 fecha". Pelo caminho nativo a questão
   não existe.

**Os limites, para que a proposta não seja lida como maior do que é.**
**`[DOC]`** (§9.1): devolver `false` neste evento **não impede o dano** — só
impede o despacho para a VM Papyrus; `SendPapyrusOnHitEvent` descarta o retorno
de `Fire()` e o cálculo de dano roda em seguida. **Continua sendo observação, não
enforcement** — a decisão central do módulo (`ARCHITECTURE.md` §1.4.5) permanece
correta e não deve mudar. O evento também dispara **no alvo**, não no agressor. E
nada disto rodou neste servidor: é `[DOC]` de upstream, não observação nossa.

**Proposta (não implementada).**

1. Registrar `mp["onPapyrusEvent:OnHit"]` e alimentar o **mesmo** `registrarGolpe`
   que já existe, convertendo `akAggressor.desc` → FormID com
   **`mp.getIdFromDesc`** **`[DOC]`** (§8.3). A agregação em episódio, o descarte
   de dano em si mesmo e o teto por episódio não mudam uma linha — são a parte
   deste projeto e continuam valendo.
2. Manter os **dois caminhos ligados durante a Fase 0**, com origem marcada na
   linha de `audit_logs` (o campo `origem` já existe exatamente para isso). É a
   única forma barata de descobrir se os dois veem o mesmo golpe.
3. Só então decidir se o `makeEventSource` sai. Ele tem um dado que o caminho
   nativo pode não ter no mesmo formato (`isSneakAttack` etc. chegam como args
   Papyrus posicionais) — conferir antes de remover, não junto.

Isto **não** é para a rodada de código pré-Fase 0: ver a priorização em
"O que isto muda para a Fase 0".

---

## 2. `core/safe-zones.js` — bloqueio por célula/posição

**Suposição do código.** Que `mp.get(actorId, 'locationalData')` devolve célula e
posição; que `loc.pos` é um array de 3 números; e que a célula do ator pode ser
comparada por **igualdade de string** com o `cellId` escrito na config
([safe-zones.js:177-189](../../skymp/gamemode/core/safe-zones.js:177)).

**O que a arquitetura diz.** **`[DOC]`** `LocationalDataBinding.cpp` (referência
§8.4) devolve exatamente:

```js
{ cellOrWorldDesc: "1a26f:Skyrim.esm", pos: [x,y,z], rot: [x,y,z] }
```

- A **leitura está certa**: `loc.cellOrWorldDesc` é o primeiro item da nossa
  cadeia defensiva, é string, e `loc.pos` é array de 3 — o `_distancia3D` e o
  raio funcionam. Os outros três nomes da cadeia (`cellOrWorldSpaceId`,
  `cellId`, `worldOrCell`) não existem: são código morto, mas inofensivo.
- **O formato do valor está errado.** **`[DOC]`** `FormDesc.cpp` (§8.5): a string
  canônica é hex **sem prefixo `0x`**, `:`, nome do arquivo. O exemplo em
  `skymp/config/safe-zones.example.json` traz `"cellId": "0x162e2"`.

`"0x162e2" !== "162e2:Skyrim.esm"` — a comparação de string nunca casa.

**Veredito: 🔴 Desalinhado.**

**Impacto prático.** Hoje é **latente**, e por dois motivos independentes:
`zones` nasce vazia com `enabled` em `false`, e — confirmado por leitura nesta
passagem — **nenhum dos quatro chamadores de `actionPolicy.canPerform` informa
`context.actorId`**, então a dimensão de lugar nem é consultada. É por isso que
nenhum teste pegou, e a `ARCHITECTURE.md` §1.4.7 já registrava esse segundo fato.

O problema é o dia em que alguém preencher a config copiando o exemplo: a zona é
aceita pelo loader (o `cellId` é uma string não-vazia, que é tudo que ele valida),
aparece nos logs como carregada, e **nunca dispara**. Uma zona segura que falha
assim falha **aberta** — a proteção simplesmente não existe, sem erro em lugar
nenhum. É o modo de falha que o próprio cabeçalho do arquivo diz querer evitar:
*"config ausente não pode virar comportamento surpresa"*.

**Proposta (não implementada).**

1. Corrigir `safe-zones.example.json` para o formato `FormDesc`
   (`"162e2:Skyrim.esm"`) e documentar isso no `_sobre_area`.
2. Validar o formato no `loadZones()`: um `cellId` que case `/^0x/i` ou que não
   contenha `:` é quase certamente erro de digitação — recusar com log explícito,
   como já se faz com categoria desconhecida.
3. Alternativa mais robusta que não depende de o humano acertar o formato: aceitar
   FormID numérico na config e converter com **`mp.getDescFromId`** **`[DOC]`**
   (§8.3), que existe exatamente para isso.

---

## 3. `identity-service` — quem sabe o nome de quem

**Suposição do código.** Que o servidor decide, **por observador**, qual nome cada
pessoa vê (`identity.getDisplayName(observador, alvo)`), e que isso é estado do
nosso banco (`character_known_identities`), não do SkyMP.

**O que a arquitetura diz.** Nada — e isso é o resultado, não uma lacuna. Uma
leitura do arquivo inteiro confirma que **`identity-service.js` não toca `mp` em
lugar nenhum**: é `database.js`, um cache em `Map` por observador, e funções
puras de sanitização. Não há suposição sobre a arquitetura do SkyMP para
conferir, porque não há dependência dela.

**Veredito: ✅ Confirmado.**

O sistema é realidade compartilhada no sentido mais forte que este projeto tem:
resolvido num lugar só, do lado do servidor, a partir de estado persistido que o
cliente não pode tocar. É o único dos oito que não depende do SkyMP para ser
verdade — e por isso o único que a Fase 0 não precisa validar quanto ao
mecanismo, só quanto à experiência.

A `ARCHITECTURE.md` §1.4.8 registra corretamente que a parte **não** provada é a
exibição, não a resolução. Ela é o sistema seguinte.

---

## 4. `nametag-service` — a projeção mundo→tela

**Suposição do código.** Que `ctx.sp.worldPointToScreenPoint` é alcançável do
snippet injetado via `makeProperty`/`updateOwner`; que
`ctx.getFormIdInClientFormat` traduz o FormID de servidor; que os eixos vão de
−1 a +1 com `y` positivo para cima; e que **alguém precisa projetar mundo→tela a
cada quadro** para a etiqueta acompanhar o ator
([nametag-service.js:209-229](../../skymp/gamemode/nametag-service.js:209)).

**O que a arquitetura diz.**

- **`[DOC]`** `mp.makeProperty` está registrado em `ScampServer.cpp` (§8.3) — o
  canal existe, e já é o mesmo comprovado de `browserModal`/`panelData`.
- **`[DOC]`** A escolha do alvo compara `_celula(loc)` **dos dois atores**, ambos
  vindos de `locationalData`. Como é célula contra célula (e não célula contra
  config), o formato `FormDesc` não atrapalha: strings iguais comparam iguais.
  **Este sistema não é atingido pelo achado da §10.**
- **`[DEEPWIKI]`** (§9.6, `TextApi.cpp:8-181`) — a `TextApi` do SkyrimPlatform
  expõe **`SetTextRefr()`**, que *"prende o texto a uma referência do jogo, por
  FormId"*, com o desenho feito por overlay DirectX. Se isso funcionar como a
  wiki descreve, **a projeção manual é desnecessária**: o texto acompanharia o
  ator sozinho, sem `worldPointToScreenPoint`, sem laço a 20 Hz e sem travessia
  de CEF por atualização.
- ⚠️ **`[DEEPWIKI]`, e a wiki se contradiz aqui.** A página `3.1.2` afirma que as
  coordenadas de texto são **só de tela** e que world-space "não é especificado";
  a `3.1.1` documenta `SetTextRefr()`. A segunda é mais específica e
  provavelmente a certa, **mas nenhuma foi conferida no código**.
- **`[DEEPWIKI]`** (§9.6, `view/worldView.ts:71-85`) — **todos os `FormView` são
  destruídos quando o jogador troca de worldspace/célula.** Qualquer coisa presa a
  uma entidade renderizada morre na troca de célula e precisa ser recriada.

**Veredito: 🟡 Provável, pendente de Fase 0.**

A suposição central — *"o cliente consegue saber onde um ator aparece na tela"* —
não é contrariada por nada. `worldPointToScreenPoint` é `[DOC]` da documentação
oficial do SkyrimPlatform, citada no próprio cabeçalho do arquivo. O que
permanece **⚪ dentro deste veredito** é o que a `ARCHITECTURE.md` §1.4.8 e o §4
do cabeçalho já registram com o peso certo: a função nunca foi chamada, a
convenção dos eixos não foi verificada, ponto atrás da câmera é buraco conhecido
e o custo do `executeJavaScript` a 20 Hz não foi medido. Esta revisão **não muda**
aquele registro; confirma que ele é honesto.

**Duas notas, não achados:**

1. **`SetTextRefr()` é a primeira coisa a abrir quando a nametag voltar à mesa** —
   `TextApi.cpp:8-181`. É `[DEEPWIKI]`, então não derruba nem confirma o desenho
   atual; mas se a wiki estiver certa, o caminho que a POC escolheu é o mais caro
   dos dois, e o custo de descobrir isso agora é uma leitura de arquivo.
2. **A destruição de `FormView` na troca de célula já está coberta por acidente
   feliz.** O snippet resolve o form a cada tick com `getFormEx` e chama
   `esconder()` quando não acha ([nametag-service.js:205-207](../../skymp/gamemode/nametag-service.js:205)),
   então a etiqueta some sozinha em vez de ficar presa a uma referência morta.
   Vale saber que o comportamento é ciclo de vida da plataforma, não bug — para
   ninguém "consertar" isso depurando *"a etiqueta sumiu quando entrei na
   taverna"*.

**Nota herdada da primeira passagem, ainda válida.** O `tick()` varre
`listActiveActorIds()` e faz O(n²) de distância 3D a cada 2 s, enquanto o servidor
**já mantém** vizinhança por grid e a expõe (`mp.getNeighborsByPosition`,
properties `neighbors`/`actorNeighbors`) — **`[DOC]`** §8.2 e §8.3. Não está
errado, está caro à toa. Vale considerar quando a POC virar feature: hoje o
gargalo desconhecido é a CEF, não a distância.

---

## 5. `voip-service` — volume por distância e retransmissão por proximidade

> **Veredito revisto nesta passagem.** A primeira leitura confirmou que a
> **leitura** de `locationalData` está correta e parou aí. Uma leitura do
> `tickProximity` inteiro mostra o que falta depois dela.

**Suposição do código.** Que `mp.get(actorId, 'locationalData')` dá posição
confiável a cada 2 s para calcular volume por distância; e — implicitamente —
que **a distância euclidiana entre dois `pos` é uma medida de "estão perto um do
outro no mesmo lugar"**
([voip-service.js:404-421](../../skymp/gamemode/voip-service.js:404)).

**O que a arquitetura diz.** **`[DOC]`** (§8.4) `locationalData` devolve `pos`
**e** `cellOrWorldDesc`. Os dois campos vêm juntos, na mesma leitura, porque a
posição sozinha não identifica um lugar: cada célula de interior tem origem de
coordenadas própria, e worldspaces distintos são espaços distintos.

O `tickProximity` lê o objeto e guarda **só o `pos`**:

```js
const loc = mp.get(actorId, 'locationalData');
if (!loc) continue;
actors.push({ actorId, entry, pos: loc.pos });   // cellOrWorldDesc descartado
```

Depois compara `distance3D(client.pos, peer.pos)` contra `VOICE_RANGES` sem
nenhuma checagem de célula.

**Este é o único dos três sistemas de proximidade do projeto que faz isso**, e é
o que torna o achado sólido em vez de especulativo:

| Onde | Compara célula? |
|---|---|
| `core/range-utils.js:32` | Sim — `if (ca && cb && ca !== cb) return Infinity;` |
| `nametag-service.js:271` | Sim — pula candidato de célula diferente, com comentário explicando por quê |
| `voip-service.js:417` | **Não** |

**Veredito: 🔴 Desalinhado.**

**Impacto prático.** Dois jogadores em células diferentes com coordenadas
numericamente próximas ouvem um ao outro. O caso não é exótico: interiores do
Skyrim são construídos em torno da origem, então duas tavernas distintas — ou uma
taverna e uma masmorra — têm coordenadas na mesma vizinhança numérica. O efeito é
voz atravessando de um interior para outro, ou de um interior para o exterior,
sem que exista caminho entre eles.

E o efeito não para na voz: o mesmo `_audienceByActor` montado neste laço é o que
o helper nativo usa para **retransmitir `audio_frame`** por proximidade
(`ARCHITECTURE.md` §1.4.4). Um erro de audiência aqui é entrega de áudio a quem
não deveria receber, não só um ganho errado num slider.

Para um servidor de Heavy RP isso é exatamente a classe de falha que esta revisão
existe para achar: quebra a premissa de que *"o que eu ouço corresponde a onde eu
estou"*, que é realidade compartilhada no sentido mais literal.

Vale dizer o que **não** está errado: o resto do caminho de áudio — WebSocket na
7778, ticket de uso único, helper nativo capturando fora do CEF, retransmissão com
volume anexado — **não passa pelo SkyMP**, e a arquitetura do upstream nem
sustenta nem contraria. Aquilo continua 🟡 pelo motivo de sempre: **ninguém ouviu
áudio ainda**.

**Proposta (não implementada).** Guardar a célula junto com a posição no laço que
monta `actors`, e descartar o par quando divergirem — a mesma regra que
`range-utils.distanceBetween` já implementa e que o `nametag-service` já aplica.
Reaproveitar `rangeUtils.getCell(loc)` em vez de escrever uma quarta cadeia
defensiva de nomes de campo é o caminho mais barato e o que mantém a regra num
lugar só. É uma mudança pequena e contida no `tickProximity`.

---

## 6. `death-service` — autoria de morte e resgate por proximidade

Este é o sistema onde a rodada se pagou. **Dois desalinhamentos independentes.**

### 6.1 O que está confirmado

**`[DOC]`** `gamemode_events/DeathEvent.cpp` (§8.6) confirma, exatamente como
`ARCHITECTURE.md` §1.4.3 descreve:

- O hook chama-se literalmente `"onDeath"`.
- Os argumentos são `[actorId, killerId]`, com **`killerId = 0`** quando não há
  autor — o nosso tratamento de "0 = sem autor" está certo.
- **`[DOC]`** `ScampServerListener.cpp:41-56` busca `mp.onDeath` como **property
  do objeto `mp`**. Ou seja: `mp.onDeath = handler` é a convenção correta, e a
  decisão do `core/death-events.js` de ser dono único do slot está bem fundada —
  o slot é mesmo exclusivo, e um segundo `mp.onDeath = ...` apagaria o primeiro
  em silêncio, exatamente como o cabeçalho daquele arquivo argumenta.

A §9 acrescenta um reforço ao desenho, e vale registrar porque é raro: **`[DEEPWIKI]`**
(§9.4, `sendInputsService.ts:137-196`) mostra que `ChangeValues` — o pacote que
carrega HP — é enviado **só quando muda**, com piso de 2000 ms, e atrasa 500 ms
durante conjuração **exceto quando `health = 0`**. O upstream tratou morte como o
caso que não pode atrasar. Nossa arquitetura foi para o mesmo lado por conta
própria ao adotar `mp.onDeath` como gatilho primário.

O mesmo dado condena o caminho antigo com um número que ninguém tinha: **o
polling de 2 s lia um valor que também se atualiza a cada ~2 s**, então o atraso
real era o dobro do que supúnhamos. A rede de segurança é mais frouxa do que o
comentário em [death-service.js:159](../../skymp/gamemode/death-service.js:159)
dá a entender — o que importa para o Achado A abaixo.

Isso tudo é ✅ dentro do sistema.

### 6.2 🔴 Achado A — o servidor respawna sozinho em 25 s

**Suposição do código.** Que, depois de `onDeath`, o personagem fica onde caiu e
sob nosso controle pelos 4 minutos de `BLEED_OUT_MS`, até alguém usar `/socorrer`
ou o bleed-out fechar.

**O que a arquitetura faz.** **`[DOC]`** `DeathEvent::OnFireSuccess` chama
**`actor->RespawnWithDelay()`**. **`[DOC]`** `GameModeEvent::Fire` só chama
`OnFireSuccess` se **nenhum** listener devolveu `false`. **`[DOC]`**
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
**devolve `undefined`**. Os handlers dos assinantes também têm o retorno
descartado: `handler(actorId, killerId)` é chamado como statement.

**`[DOC]`** `MpChangeForms.h:109`: `float spawnDelay = 25.0f`. E um `grep` por
`spawnDelay` no gamemode inteiro não devolve nada — nunca ajustamos.

**A §9 acrescenta um segundo caminho para o mesmo efeito**, que a primeira
passagem não tinha: **`[DEEPWIKI]`** (§9.2, `PartOne.cpp:175-221`)
`PartOne::SetUserActor` **chama `RespawnWithDelay()` se o ator estiver morto**.
Ou seja, mesmo que o `DeathEvent` fosse bloqueado, um jogador que caísse e
reconectasse seria respawnado pelo próprio handshake. Bloquear o evento resolve o
caminho principal, não todos.

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
   `spawnDelay` **`[DOC]`** para a janela que quisermos, deixando o servidor fazer
   o respawn no tempo certo.

A opção 1 é a que menos muda o código existente. A 2 é a que menos duplica
mecanismo do servidor. Registrado como decisão aberta, não resolvida aqui.

Há também um efeito de segunda ordem a considerar junto: `RespawnWithDelay` é
como o servidor devolve **qualquer** ator morto ao mundo. O `hunting-service`
previsto em `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.3 vai assinar o mesmo hook —
e um `return false` global mataria o respawn **dos mobs também**. O barramento
`death-events.js` vai precisar de uma política de agregação de retorno (bloqueia
se algum assinante pedir? só o dono do ator decide?), que hoje ele não tem.

### 6.3 🔴 Achado B — o payload do nosso respawn lança

**Suposição do código.** Que `mp.set(actorId, 'locationalData', {...})` aceita
`{ pos, worldOrCell, angleZ }`
([death-service.js:369-373](../../skymp/gamemode/death-service.js:369)).

**O que a arquitetura exige.** **`[DOC]`** `LocationalDataBinding::Set` (§8.4) lê
exatamente `cellOrWorldDesc` (string), `pos` (array) e `rot` (array), via
`NapiHelper::ExtractString` / `ExtractNiPoint3`, que **lançam** quando o valor
não é do tipo esperado (`NapiHelper.h:96,218`).

Nosso objeto não tem `cellOrWorldDesc` (tem `worldOrCell`) e não tem `rot` (tem
`angleZ`). `Get("cellOrWorldDesc")` devolve `undefined`, que não é string →
**`std::runtime_error`**.

Dois agravantes que reforçam o veredito:

- **O projeto já sabe a forma certa em dois lugares.** `types/mp.d.ts:38-42`
  declara `LocationalData` como `{ pos, rot, cellOrWorldDesc }` — exatamente o
  que a §8.4 confirma —, e
  [governance-service.js:711-715](../../skymp/gamemode/governance-service.js:711)
  escreve o payload **correto** ao prender alguém. É o mesmo `mp.set` com a mesma
  property, com formas diferentes, no mesmo repositório. O `npm run typecheck` é
  informativo (`ARCHITECTURE.md` §1.4), então nunca reclamou.
- **`RESPAWN_CELL = '0x162e2'`**
  ([death-service.js:36](../../skymp/gamemode/death-service.js:36)) não é
  `FormDesc`. Mesmo com a chave certa, **`[DOC]`** `FormDesc::FromString("0x162e2")`
  não encontra `:`, cai no ramo sem arquivo, e `ToFormId` resolve para
  `0xff000000 + 0x162e2` — a faixa de forms **gerados pelo servidor**, não o
  Templo de Kynareth. Dois defeitos empilhados, e o segundo só apareceria depois
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
preferível, derivar a string com **`mp.getDescFromId`** **`[DOC]`** em vez de
escrevê-la à mão, que é a mesma classe de erro que a §10 descreve. Confirmar o
`162e2` contra o ESM antes: o valor herdado nunca foi verificado in-game.

### Veredito do sistema: 🔴 Desalinhado (dois achados)

`mp.onDeath` e `killerId` estão ✅; o ciclo de vida em volta deles, não.

---

## 7. `market-stalls-service` / governança — ações condicionadas a proximidade

**Suposição do código.** Que dá para condicionar ação à célula e à distância
lendo `locationalData`, priorizando mesma célula e depois menor distância
euclidiana ([market-stalls-service.js:154-158](../../skymp/gamemode/market-stalls-service.js:154)).

**O que a arquitetura diz.** **`[DOC]`** A leitura está correta: a cadeia começa em
`loc.cellOrWorldDesc`, que é o campo real (§8.4). O `'unknown'` no fim da cadeia
é um fallback que nunca será alcançado, o que é o comportamento desejado. A
governança valida alcance por `core/range-utils.js`, que **compara célula** — o
caminho certo, e o mesmo que falta no `voip-service` (§5).

**`[DEEPWIKI]`** (§8.7 / 2.4.2) reforça de fora: o servidor já valida posse de
ator em `SendToNeighbours` antes de aceitar mudança de estado, e
`MovementValidation::Validate` recusa teleporte impossível. Uma ação de mercado
condicionada a proximidade não está apoiada em posição que o cliente possa
inventar livremente.

**Veredito: 🟡 Provável, pendente de Fase 0.**

Nada na arquitetura contraria. O que falta é o de sempre: ninguém executou uma
compra com duas pessoas conectadas. O `GOVERNANCE_MARKET_STALLS_TEST_PLAN.md` já
existe para isso.

**Duas observações menores, nenhuma muda o veredito:**

1. **⚪ Duas properties da barraca não estão na lista de bindings padrão.**
   `spawnStallVisual` faz `mp.set(refId, 'scale', ...)` e
   `mp.set(refId, 'displayName', ...)`
   ([market-stalls-service.js:227-232](../../skymp/gamemode/market-stalls-service.js:227)).
   A lista real de `CreateStandardPropertyBindings()` — **`[DOC]`** §8.2 — traz
   `pos`, `angle` e `worldOrCellDesc` (as outras três usadas ali), mas **não**
   `scale` nem `displayName`. Não dá para concluir daí que falham: podem cair no
   caminho de property customizada (`DynamicFields`, §9.5) e simplesmente não
   produzir efeito visual, ou podem lançar. **Nem a referência nem o código local
   respondem** — fica ⚪, dentro de um sistema 🟡, e o barato é olhar no primeiro
   spawn de barraca da Fase 0 em vez de investigar agora.
2. **`getNearestCityId` compara coordenadas entre células**, com penalidade fixa
   de 50000 em vez de descarte
   ([market-stalls-service.js:296-301](../../skymp/gamemode/market-stalls-service.js:296)).
   É a mesma suposição que torna o `voip-service` 🔴, mas aqui o efeito é
   limitado: a pergunta é "qual cidade cobra imposto", a penalidade já empurra a
   mesma célula para a frente, e o pior caso é atribuição de jurisdição errada,
   não voz atravessando parede. Registrado como design a revisar, não como
   desalinhamento.

---

## 8. `npc-cleaner.js` — curadoria por `baseDesc`

**Suposição do código.** Que `mp.get(npcActorId, 'baseDesc')` devolve uma
**string** no formato `"1a6a0:Skyrim.esm"`, comparável diretamente com a lista de
bloqueio da config; e que `mp.getActorsByProfileId(0)` enumera NPCs
([npc-cleaner.js:162-170](../../skymp/gamemode/npc-cleaner.js:162)).

**O que a arquitetura diz.**

- **`[DOC]`** `BaseDescBinding.cpp` devolve
  `FormDesc::FromFormId(refr.GetBaseId(), espmFiles).ToString()` — string, no
  formato `shortFormId` hex sem `0x` + `:` + arquivo. **`[DOC]`** `FormDesc.cpp`
  confirma o formato. `"1a6a0:Skyrim.esm"` é exatamente isso.
- **`[DOC]`** `getActorsByProfileId` está registrado em `ScampServer.cpp` (§8.3).
- **`[DOC]`** `baseDesc` está na lista de bindings padrão (§8.2), então a leitura
  é servida do estado do servidor.

**Veredito: ✅ Confirmado.**

Vale registrar por que este acertou: o comentário em
[npc-cleaner.js:40](../../skymp/gamemode/npc-cleaner.js:40) mostra que a versão
anterior comparava `baseDesc` (string) com FormID numérico e que isso foi
corrigido deliberadamente. O `npc-policy.example.json` já traz o formato certo.
Foi o único sistema que enfrentou a questão do formato de `FormDesc` de frente —
e é justamente o que a §10 mostra que faltou nos outros dois.

O `safeRadius` se apoia em `rangeUtils.distanceBetween`, que compara célula e
devolve `Infinity` quando divergem — correto pela §8.4, e a mesma disciplina que
falta no `voip-service`.

---

## 9. Escala de mob — meia resposta, e a metade que falta é medição

> **Veredito revisto nesta passagem.** A primeira versão marcou ✅ citando o
> fechamento da lista nivelada. A §9.8 da referência mostra que isso responde
> menos da pergunta do que parecia.

**A investigação não foi reaberta**, como o plano manda. O que mudou é a leitura
do que ela fechou.

**O que está fechado, `[DOC]`.** `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.4(b)
registra, com arquivos e funções, que a **resolução de lista nivelada é do
servidor**, com nível constante e resultado guardado por ator. A §9.8 da
referência é explícita em pedir que ninguém refaça essa verificação.

**O que continua aberto.** A §9.8 da referência lista, entre as *"perguntas deste
projeto que a wiki inteira não respondeu"*:

> **Se estatística de NPC escala por nível do jogador no cliente.** O
> `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.4(c)(2) já registrava esse limite; a
> wiki não o toca. Segue em aberto.

São duas perguntas, e só a primeira foi fechada. *Qual* criatura a lista nivelada
produz é decisão do servidor; *quão forte* aquela criatura é na tela de cada
jogador não está respondido por nada que tenhamos lido.

E é a segunda que importa para realidade compartilhada. O
`FAUNA_CENSUS_PROTOCOL.md` (Passo 2) diz isso com todas as letras:

> Se o SkyMP herdar isso **por cliente**, dois jogadores lado a lado veem o mesmo
> lobo com forças diferentes — e "socorri você contra o urso" deixa de ser uma
> frase com sentido único. Isso não é balanceamento; é **realidade
> compartilhada**, que é pré-requisito de Heavy RP.

**Veredito: ⚪ Não verificável com o que temos.**

Não é um retrocesso: a pergunta já tem instrumento e protocolo (`/censofauna` +
`/censofauna alvo <actorId>`, com dois jogadores de níveis diferentes comparando
as duas telas). O que esta revisão corrige é o registro — marcar ✅ aqui daria a
impressão de que a arquitetura já garantiu o que ela não garante, e essa é
exatamente a classe de otimismo que o prompt desta rodada pede para evitar.

O comando sozinho não responde. **A comparação que decide é entre as duas telas**,
e ela é da Fase 0.

---

## 10. O achado sistêmico: identidade de célula não é hexadecimal

Dois dos 🔴 têm a mesma raiz, e vale nomeá-la separada dos sistemas:

**O projeto trata identidade de célula como número hex com prefixo `0x`. O SkyMP
a trata como `FormDesc` serializado em string.**

| Onde | Escrito | Deveria ser |
|---|---|---|
| `death-service.js:36` | `RESPAWN_CELL = '0x162e2'` | `'162e2:Skyrim.esm'` |
| `safe-zones.example.json` | `"cellId": "0x162e2"` | `"162e2:Skyrim.esm"` |

Os dois vieram do mesmo valor herdado. E os dois falham **em silêncio**, que é o
que os torna caros: **`[DOC]`** `FormDesc::FromString` não valida — sem `:` ela
apenas resolve para outra faixa de FormID (§8.5). Não há exceção, não há log.

Onde a comparação é **ator contra ator** (nametag, market-stalls, voz,
npc-cleaner) o formato não importa, porque os dois lados vêm da mesma fonte. O
erro só aparece quando uma **string escrita por humano** entra na conta. Isso é
uma regra útil para as próximas features: *toda constante de célula ou de base
escrita à mão é suspeita até ser derivada de `mp.getDescFromId` ou conferida
contra `FormDesc`.*

Nota de rodapé com a mesma forma, para quem for mexer em property privada:
**`[DEEPWIKI]`** (§9.5) diz que os prefixos de privacidade são `__p_` / `__pi_`;
a §2.6 da referência registra `private.`. **Os dois não podem estar certos e
nenhum foi lido no código.** Errar ali vaza para o cliente em silêncio — mesma
classe de falha, mesmo conselho: confira antes de confiar.

---

## O que isto muda para a Fase 0

**Quatro dos oito sistemas saíram sem achado.** `identity-service` e
`npc-cleaner` estão ✅ confirmados contra o código primário do upstream;
`nametag-service` e `market-stalls`/governança estão 🟡, que é o resultado
esperado e saudável — a arquitetura sustenta a suposição, e o que falta é a
validação ao vivo que a Fase 0 já existe para fazer. Para esses quatro, **nada
nesta revisão sugere que a sessão vá encontrar surpresa de arquitetura**, e o
roteiro segue como planejado.

**Um sistema bloqueia parte da sessão: o `death-service`.** Os outros dois 🔴 não
bloqueiam, por motivos diferentes.

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
3. **`voip-service` (distância sem célula) — não bloqueia, mas muda o que
   observar.** A voz já era 🟡 por um motivo maior (ninguém ouviu áudio ainda), e
   o roteiro não depende dela. Mas **se** a sessão chegar a produzir áudio, este
   defeito muda o que ela mede: um teste de "voz por proximidade funciona" feito
   inteiramente dentro de uma célula passaria sem revelar nada. Duas saídas, e
   qualquer uma serve: consertar antes (é uma mudança pequena e contida no
   `tickProximity`), ou incluir no roteiro o passo de **duas pessoas em interiores
   diferentes** e registrar o resultado. Não vale ir para a sessão sem escolher
   uma das duas.
4. **`safe-zones` (formato do `cellId`) — não bloqueia.** As zonas nascem vazias e
   desligadas, e nenhum chamador de `canPerform` informa `context.actorId`; nada
   na Fase 0 depende delas. Vale corrigir o exemplo e a validação **antes de
   alguém preencher a config**, que é quando o defeito passaria a valer — mas isso
   pode acontecer depois da sessão sem custo.
5. **`hit-events` (o `OnHit` nativo não usado) — não bloqueia, e não deve entrar
   antes da sessão.** É o achado mais interessante desta rodada e o que mais muda
   o desenho a médio prazo, mas o sistema atual **funciona como está** e a Fase 0
   precisa exercitar o que existe, não o que vai existir. Trocar o caminho de
   coleta agora substituiria um mecanismo não validado por outro mecanismo não
   validado, às vésperas da sessão que existe para validar. **A sessão deve rodar
   com o `makeEventSource` atual**; o caminho nativo entra depois, com os dois
   ligados em paralelo para comparação (§1). O que muda para a Fase 0 é só a
   expectativa: se o snippet não reportar nada, já sabemos qual é a segunda
   tentativa, e ela não custa mais uma rodada de pesquisa.

**Uma correção de registro, sem custo de sessão.** A escala de mob passou de ✅
para ⚪ (§9). Isso não acrescenta trabalho à Fase 0 — o Passo 2 do
`FAUNA_CENSUS_PROTOCOL.md` já estava no roteiro. Muda só a leitura de quem chegar
depois: aquele passo é **a pergunta**, não a confirmação de uma resposta que já
teríamos.

**O resto da Fase 0 não muda.** Os pontos que já pediam observação cuidadosa (o
snippet de hit nunca ter rodado, a projeção da nametag nunca ter sido chamada,
ninguém ter ouvido áudio) continuam exatamente com o peso que `ARCHITECTURE.md`
§1.4.4, §1.4.5 e §1.4.8 já lhes davam. Esta revisão não os agrava nem os alivia —
confirma que aqueles registros são honestos.

**Dois ganhos colaterais, para depois da Fase 0:**

- O servidor já mantém vizinhança por grid e a expõe
  (`mp.getNeighborsByPosition`, properties `neighbors` / `actorNeighbors` /
  `onlinePlayers`). Voz e nametag reimplementam isso em O(n²) a cada 2 s. Não é
  defeito e não é urgente — é a peça óbvia a considerar quando qualquer um dos
  dois sair de POC.
- **`[DEEPWIKI]`** (§9.5) — `consoleCommandsAllowed` é permissão **nativa, por
  ator, do lado do servidor**, e o `admin-service` não a usa. Vale conferir se ela
  está ligada por engano **antes do primeiro teste com gente de fora**. Não é
  achado desta revisão (não é realidade compartilhada), mas é barato e cai na
  mesma janela.

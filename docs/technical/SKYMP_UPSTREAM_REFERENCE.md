# SkyMP upstream: o que existe e o que dá pra aproveitar

***Português** · [English](SKYMP_UPSTREAM_REFERENCE.en.md) · [Русский](SKYMP_UPSTREAM_REFERENCE.ru.md) · [Español](SKYMP_UPSTREAM_REFERENCE.es.md)*

Levantamento feito em 05/08/2026 direto do repositório oficial (`github.com/skyrim-multiplayer/skymp`, C++, 313 estrelas, último push 25/07/2026).

O objetivo é que ninguém aqui reinvente o que o SkyMP já entrega — e que ninguém tente usar o que ele não entrega.

---

## 1. Onde está a documentação oficial

Não é o wiki do GitHub e não é o `README`: é a pasta **`docs/`** do repositório. Os arquivos que valem:

| Arquivo | Sobre |
|---|---|
| `docs_serverside_scripting_reference.md` | A API `mp` do gamemode |
| `docs_events_system.md` | `mp.makeEventSource` — eventos cliente→servidor |
| `docs_properties_system.md` | Properties e sincronização |
| `docs_clientside_scripting_reference.md` | O objeto `ctx` dentro dos snippets de cliente |
| `docs_onhit_and_damage.md` | Pacote OnHit e fórmula de dano |
| `docs_server_ports_usage.md` | Portas e ferramentas de debug |
| `docs_database_drivers.md` | `file`, `mongodb`, `zip` |
| `docs_server_configuration_reference.md` | `server-settings.json` |

Para ler sem clonar (o `raw.githubusercontent.com` dá 404 via ferramentas de fetch):

```bash
gh api repos/skyrim-multiplayer/skymp/contents/docs/docs_events_system.md --jq '.content' | base64 -d
```

---

## 2. A descoberta que mais muda nosso código: `mp.makeEventSource`

Hoje **três serviços nossos fazem polling de 2 em 2 segundos** — `death-service.js` (detecta HP≤0 e picos de dano), `player-panel-service.js` (vitais do painel) e `voip-service.js` (volume por distância). Isso foi escrito assumindo que não havia alternativa.

Há. `mp.makeEventSource(nome, corpoDaFuncao)` injeta um trecho de JS no cliente que roda no loop do jogo e chama `ctx.sendEvent()` quando quiser; o servidor recebe via `mp._nomeDoEvento = (pcFormId) => {}`.

```js
// Nome customizado TEM que começar com underscore.
mp.makeEventSource("_onLocalDeath", `
  ctx.sp.on("update", () => {
    const pl = ctx.sp.Game.getPlayer();
    const isDead = pl.getActorValuePercentage("health") === 0;
    if (ctx.state.wasDead !== isDead) {
      if (isDead) ctx.sendEvent();
      ctx.state.wasDead = isDead;
    }
  });
`);
mp._onLocalDeath = (pcFormId) => { /* ... */ };
```

Esse exemplo é literalmente o da documentação oficial — e é exatamente o caso do nosso `death-service`.

**O que isso resolveria:**
- Morte detectada no frame em que acontece, em vez de até 2s depois. Numa cena de RP, 2s de atraso pra entrar em `DOWNED` é a diferença entre a cena funcionar e não funcionar.
- Fim do `checkDamageSpike` como heurística: em vez de inferir dano por queda de HP entre ticks, o cliente reporta o evento.
- Custo de CPU do servidor deixa de crescer linearmente com o número de jogadores conectados.

**A ressalva honesta:** o snippet roda no cliente, que é território não confiável (ver `MODS_AND_GAMEMODE_CONTRACT.md`). Um evento vindo dali é uma *dica*, não uma prova — o servidor continua tendo que validar. Para morte isso é aceitável (o pior caso é alguém forjar a própria morte). Para conceder item ou ouro, não é.

---

## 2.5 A fonte que faltava: `misc/tests/` upstream

A documentação em `docs/` descreve cinco métodos de `mp`. A API real é muito maior, e o lugar onde ela aparece **executando** é a pasta `misc/tests/` do repositório upstream — nove testes de integração que rodam contra um servidor de verdade.

Isso os torna mais confiáveis que qualquer documentação: são código que precisa passar.

```bash
gh api repos/skyrim-multiplayer/skymp/contents/misc/tests --jq '.[].name'
```

### O que eles resolveram para nós

**1. O formato do `self` do Papyrus — resolvido.** Todos os nove testes usam `{ type: 'form', desc: mp.getDescFromId(id) }`, nunca o FormID cru, inclusive para *argumentos* que sejam referências:

```js
mp.callPapyrusFunction("method", "ObjectReference", "RemoveAllItems",
    { type: "form", desc: mp.getDescFromId(actorId1) },
    [{ type: "form", desc: mp.getDescFromId(actorId2) }, false, false]);
```

Este projeto tinha 22 chamadas passando o FormID cru. Foram todas convertidas — ver `core/papyrus.js` (`actorRef`/`baseRef`).

Também aparece a distinção `form` vs `espm`: o ator é `form`, o Gold001 que se adiciona ao inventário dele é `espm`.

**2. `mp.onDeath` existe e traz o assassino.**

```js
mp.onDeath = (actorId, killerId) => { /* killerId é 0 quando não há autor */ };
mp.onRespawn = (actorId) => {};
```

Nosso `death-service.js` faz polling de 2s lendo `getActorValue('Health')`, e a documentação de combate deste projeto chegou a registrar que "não há hook confiável de quem atacou quem". Para o momento da morte — que é o que importa no anti-RDM — **há**. Isso torna o `logDeathContext` por proximidade uma aproximação desnecessária.

**3. Outros hooks e chamadas confirmados por teste:**

| | |
|---|---|
| `mp.onActivate = (target, caster) => {}` | Alguém usou um objeto/ator |
| `mp["onPapyrusEvent:OnItemAdded"] = fn` | Evento Papyrus arbitrário, por nome |
| `mp.createActor(profileId, pos, angleZ, cellOrWorld)` | Criar ator pelo servidor |
| `mp.set(id, "isDead", true)` | Matar diretamente, sem Papyrus |
| `mp.set(id, "inventory", {entries:[{baseId,count}]})` | **Escrever o inventário inteiro de uma vez** |
| `mp.get(id, "inventory").entries` | Ler o inventário |
| `mp.set(id, "spawnDelay", 0)` | Controlar o atraso de respawn |
| `mp.get(id, "spawnPoint")` | Ponto de spawn de um ator colocado |

O par `get/set` de `inventory` é notável: hoje `inventory-service.js` sincroniza item por item via `AddItem`. Um `set` único seria mais simples e atômico do lado do cliente.

---

## 2.6 Identidade e login: como o SkyMP realmente resolve `profileId`

Fonte: `skymp5-server/ts/systems/login.ts` e `skymp5-server/ts/settings.ts`.

Isto responde a pergunta em aberto de "como o gamemode sabe quem é o jogador" — item 1.6 do nosso `QA_REPORT_2026-08.md`.

**Existem dois modos, e a diferença é tudo:**

**`offlineMode: true`** — o cliente manda `gameData.profileId` e o servidor **acredita**. É o modo de laboratório. Qualquer um edita o `skymp_config.json` e vira outra pessoa.

**`offlineMode: false`** (padrão) — o cliente manda `gameData.session`, e o servidor **resolve a sessão contra um master API**:

```
GET  {master}/api/servers/{masterKey}/sessions/{session}
  →  { user: { id: number, discordId: string } }
```

O `profileId` passa a vir do master, não do cliente. **É aqui que a identidade vira confiável.**

O `master` padrão é `https://gateway.skymp.net`, mas é só uma string em `server-settings.json`.

### O caminho para o nosso item 1.6

Nós já temos tudo que esse endpoint precisa: OAuth do Discord, whitelist, e a tabela `launch_tickets` criada na migration v6. **O `apps/web` pode ser o nosso master API** — é um endpoint só:

1. `apps/web` implementa `GET /api/servers/:masterKey/sessions/:session`, resolvendo o ticket para `{ user: { id: accountId, discordId } }`.
2. `server-settings.json` aponta `master` para o nosso painel e define `masterKey`.
3. `offlineMode: false`.
4. O launcher já grava `config.session` — passa a gravar o ticket que o painel emitiu.

Feito isso, `whitelist.js` para de confiar no `profileId` do cliente sem precisar de nenhuma mudança nele: o `profileId` que chega **já é** o `accountId` validado.

Isso é bem mais simples do que o `/internal/session/resolve` que construímos no `apps/game-api`, e usa o mecanismo que o SkyMP já tem em vez de um paralelo.

### `mp.onLoginAttempt`

O `login.ts` chama, se existir:

```js
mp.onLoginAttempt = (profileId) => boolean;  // false recusa a conexão
```

É o ponto correto para whitelist e ban — o cliente recebe `loginFailedBanned`. Hoje fazemos isso por polling de conexão + `mp.kick` depois do fato.

### `discordAuth` nativo no servidor

`server-settings.json` aceita:

```json
{
  "discordAuth": {
    "botToken": "...",
    "guilds": [{
      "guildId": "...",
      "banRoleId": "...",
      "hideIpRoleId": "...",
      "eventLogChannelId": "..."
    }]
  }
}
```

O servidor então, sozinho: exige que o jogador esteja no Discord, recusa quem tiver o cargo de ban, esconde o IP de quem tiver `hideIpRoleId`, e **posta os logins num canal**. Os cargos do Discord ficam disponíveis no gamemode via a property `private.discordRoles`.

Construímos parte disso no `apps/bot-discord`. Vale comparar antes de investir mais no nosso.

Nota: properties com prefixo `private.` não são visíveis pelo cliente.

---

## 2.7 Outros servidores RP em SkyMP

Encontrados por busca de código: `hijosdelasnieves/hijosdelasnieves-RP` (ativo em 29/07/2026), `reggiedroid/skymp-mop` (05/08/2026), `spike29011/Skymp-spike`.

Todos são cópias do upstream sem gamemode próprio publicado — o código de RP deles não está aberto. Servem como sinal de que o projeto tem outros servidores sérios em construção, não como fonte de solução.

O `sweettaffy-lib` (organização oficial) tem as **regras de RP** do servidor SweetTaffy em russo — útil como referência de design de regras, não de código.

---

## 3. Ferramentas de desenvolvimento que já existem e não usamos

Estas três são as que mais economizam tempo, e nenhuma exige escrever código:

### DevTools do Chromium na porta 9000
O navegador embutido expõe DevTools remoto. Abra **`localhost:9000`** no Chrome de verdade e você tem console, inspetor e breakpoints da nossa UI in-game.

Hoje `skymp/ui/index.html`, `player-panel.js` e `player-panel.css` são depurados **às cegas**. Isso muda com uma URL.

### Live reload da UI pela porta 1234
Se um WebPack dev server estiver rodando na porta 1234 na mesma máquina, o servidor SkyMP **faz proxy das requisições de UI pra ele**. Ou seja: dá pra iterar CSS e JS da UI sem reiniciar o servidor nem reconectar o cliente.

### Driver de banco `file` para teste
`databaseDriver: "file"` guarda o mundo num diretório, sem precisar de MongoDB. Já é o que nosso `server-settings.local.example.json` usa — vale saber que existe também `zip` (mesma coisa num arquivo só, prático pra snapshot antes de um teste destrutivo) e `mongodb` para produção.

---

## 4. Combate: correção de um entendimento anterior

Uma conclusão registrada antes neste projeto foi que "não existe hook confiável de quem atacou quem". Isso precisa de nuance:

**O pacote OnHit existe** e é rico (`docs_onhit_and_damage.md`):

```c++
uint32_t aggressor;   bool isBashAttack;   bool isHitBlocked;
bool isPowerAttack;   bool isSneakAttack;  uint32_t projectile;
uint32_t source;      uint32_t target;
```

O que **não** existe é exposição dele ao gamemode JS — a issue #1338 pediu isso e foi fechada como won't fix. O dado está no C++, não na nossa camada.

Duas saídas, ambas viáveis:
1. **`makeEventSource` no cliente**, escutando o evento de hit do Skyrim Platform e mandando `{aggressor, target}` pro servidor. Barato, e melhor que a proximidade que usamos hoje — mas continua sendo o cliente falando.
2. **`IDamageFormula` em C++** — o SkyMP expõe uma interface justamente pra servidores customizados redefinirem a fórmula de dano. É onde o dado é confiável de verdade, mas exige build C++ do servidor.

**Isto deixou de ser teoria.** O servidor RP Red House implementou a saída 1 e o código é público — ver `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` 4.1. Lá estão também os dois detalhes que custariam horas de depuração (o `0x14` do jogador local e a conversão obrigatória de FormID) e um aviso de performance que vale pra nós.

Enquanto nenhuma das duas for feita, o `/iniciar` + `checkDamageSpike` continua sendo o que temos: evidência por proximidade, não atribuição.

---

## 5. Cuidado com as portas

| Porta | Quem usa |
|---|---|
| 7777/UDP | SkyMP, sincronização (padrão) |
| 3000/HTTPS | UI do navegador embutido — **não configurável** |
| 9000 | DevTools do Chromium embutido |
| 1234 | WebPack dev server (live reload da UI) |
| 3001 | `apps/web` |
| 3002 | `apps/bot-discord` |
| 7758 | `apps/game-api` |
| 7778 | VOIP (`VOIP_PORT`) |

⚠️ **A porta de UI é `porta principal + 1` quando a principal é não-padrão.** Nosso `apps/launcher/.env.example` traz `VITE_SERVER_PORT=7757`, enquanto `skymp/config/server-settings.*.example.json` traz `"port": 7777`. Dois problemas nisso:

1. Os defaults **não batem** — o cliente tentaria 7757 enquanto o servidor escuta 7777.
2. Se alguém padronizar em 7757, a UI vai pra **7758 e colide com o `apps/game-api`**.

**Resolvido em 05/08/2026:** o launcher passou a usar 7777 (default e nos exemplos), alinhado com o `server-settings`. Fica o aviso no `.env.example`: mudar a porta principal pra um valor não-padrão desloca a UI e pode colidir com o `game-api`.

---

## 6. O que procuramos e não existe

- **Não há tipagem TypeScript pública da API `mp`.** O `skymp5-functions-lib` do upstream importa de um `src/` que não está no repositório — só o `index.ts` é público. Escrevemos a nossa em `skymp/gamemode/types/mp.d.ts`.
- **Nenhum outro servidor RP publicou seu gamemode.** Os três forks ativos encontrados são cópias do upstream sem código de RP aberto.
- **`skymp-ui-components`** (biblioteca de UI da org) está parada desde 2020. Não vale adotar.
- **`sweettaffy-lib`** é o conjunto de regras de RP do servidor SweetTaffy (em russo), não código — mas serve como referência de *design* de regras de servidor RP.
- **Releases**: a última é `sp-v2.6-beta`, de 2022. O projeto se desenvolve na branch `main`, não por release. Fixar em commit, não em tag.

---

## 7. Sugestão de aproveitamento, em ordem de custo-benefício

| | Ação | Esforço | Ganho |
|---|---|---|---|
| 1 | ✅ Alinhar as portas 7757/7777 nos exemplos | | Feito — era falha de conexão garantida |
| 2 | ✅ Escrever `types/mp.d.ts` | | Feito |
| 3 | ✅ Converter as 22 chamadas Papyrus pro formato de objeto | | Feito — ver 2.5 |
| 4 | Abrir `localhost:9000` na próxima sessão de teste da UI | Zero | Para de depurar UI às cegas |
| 5 | **Trocar o polling do `death-service` por `mp.onDeath`** | Horas | Morte no frame + `killerId` de graça. Substitui polling **e** a heurística de proximidade do anti-RDM |
| 6 | **`apps/web` vira o master API de sessão** (ver 2.6) | Um dia | Resolve o item 1.6 usando o mecanismo nativo, em vez do nosso `/internal/session/resolve` paralelo |
| 7 | `mp.onLoginAttempt` no lugar do polling de conexão + kick | Horas | Recusa no handshake, com mensagem correta pro cliente |
| 8 | Avaliar o `discordAuth` nativo antes de investir mais no bot | Horas | Ban por cargo, log de login e IP oculto sem código nosso |
| 9 | Subir o WebPack dev server na 1234 pro fluxo de UI | Um dia | Live reload da UI |

O item 4 vale fazer antes do teste in-game da Fase 1 (`QA_REPORT_2026-08.md`), porque afeta justamente esse teste. Os itens 5 a 8 mudam decisões de arquitetura que já tomamos — vale reler 2.5 e 2.6 antes de continuar construindo em cima delas.

---

## 8. Como o SkyMP resolve estado compartilhado

Levantamento de 09/08/2026, feito para dar base à
[`REVISAO_REALIDADE_COMPARTILHADA.md`](REVISAO_REALIDADE_COMPARTILHADA.md). Até
aqui este documento cobria a *API* do gamemode; esta seção cobre o **mecanismo
por baixo** — quem decide o que cada jogador vê, e em que formato o servidor
representa lugar e identidade de form.

### Disciplina de procedência

- **`[DOC]`** — lido no código-fonte primário do upstream (via
  `gh api repos/skyrim-multiplayer/skymp/contents/<caminho>`). É fato sobre o
  código na `main`.
- **`[DEEPWIKI]`** — vem da wiki gerada em `deepwiki.com`, **não** conferida
  contra o código. É evidência, não veredito: a wiki erra por omissão (ver 8.2).

### 8.1 O núcleo: `WorldState`, grid e vizinhança

**[DEEPWIKI]** ([2.5 World State Management](https://deepwiki.com/skyrim-multiplayer/skymp/2.5-world-state-management))
`WorldState` guarda todo form num `unordered_map<uint32_t, shared_ptr<MpForm>>`
(`LookupFormById`, `AddForm`, `DestroyForm`, em
`skymp5-server/cpp/server_guest_lib/WorldState.h`). O particionamento espacial é
um grid (`GridInfo` / `GridImpl<MpObjectReference*>`) consultado por
`GetNeighborsByPosition`. FormIDs `< 0xff000000` são de ESPM; `>= 0xff000000`
são gerados pelo servidor.

**[DEEPWIKI]** ([2.4.1](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference),
[2.4.2](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling))
"Vizinho" (*neighbour*) não é "quem está perto" em linha reta: é **quem está
inscrito nas atualizações daquele form**. `SendToNeighbours`
(`ActionListener.cpp:39-96`) primeiro valida que o remetente é dono do ator (ou
o *hoster* registrado em `worldState.hosters`) e só então retransmite. Entrar e
sair de grid gera inscrição/desinscrição — `PartOne::SetUserActor`
(`PartOne.cpp:175-221`) desinscreve o ator dos vizinhos e o tira do grid para
zerar a visibilidade.

**Consequência para nós:** o servidor **já mantém** a resposta de "quem vê quem".
`mp.getNeighborsByPosition` está exposto ao gamemode **[DOC]** — ver 8.3.

### 8.2 A wiki é incompleta: confira PropertyBindings no código

**[DEEPWIKI]** ([5.3](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system))
lista as bindings padrão e **não menciona `locationalData`**. Isso levantaria
uma falsa suspeita sobre três serviços nossos. O código primário desmente:

**[DOC]** `skymp5-server/cpp/addon/property_bindings/PropertyBindingFactory.cpp`
— o mapa real de `CreateStandardPropertyBindings()`:

```
actorNeighbors  angle       appearance   baseDesc     equipment
inventory       isDead      isDisabled   isOnline     isOpen
locationalData  neighbors   onlinePlayers percentages pos
profileId       spawnPoint  type         worldOrCellDesc  idx
consoleCommandsAllowed  spawnDelay  templateChain  lastAnimEvent
respawnPercentages
```

`neighbors`, `actorNeighbors` e `onlinePlayers` são **built-in** — a lista de
vizinhos vem pronta do servidor.

### 8.3 A superfície real da API `mp`

**[DOC]** `skymp5-server/cpp/addon/ScampServer.cpp:84-143` — os `InstanceMethod`
registrados. Confirmam o que já usamos (`get`, `set`, `makeProperty`,
`makeEventSource`, `callPapyrusFunction`, `lookupEspmRecordById`,
`getActorsByProfileId`, `kick`, `place`) e revelam três que não usamos:

| Método | Para que serve aqui |
|---|---|
| `getNeighborsByPosition` | Vizinhança pelo grid do servidor, em vez do nosso O(n²) |
| `getDescFromId` / `getIdFromDesc` | Converte FormID ↔ `FormDesc` **sem adivinhar formato** (ver 8.5) |
| `findFormsByPropertyValue` | Busca por valor de property |

### 8.4 `locationalData`: a forma exata, de ida e de volta

**[DOC]** `property_bindings/LocationalDataBinding.cpp`.

**Leitura** (`mp.get`) devolve exatamente três campos:

```js
{ cellOrWorldDesc: "1a26f:Skyrim.esm",  // string, FormDesc::ToString()
  pos: [x, y, z],                        // array de 3 números
  rot: [x, y, z] }                       // array de 3 números — chama-se `rot`
```

**Escrita** (`mp.set`) exige os **três** campos, com esses nomes exatos, e chama
`MpActor::Teleport`. Campo ausente ou de tipo errado **lança**:
`NapiHelper::ExtractString` joga se o valor não for string,
`ExtractNiPoint3` joga se não for array (`skymp5-server/cpp/addon/NapiHelper.h:96,218`).
E só vale para atores: *"mp.set can only change 'locationalData' for actors, not
for refrs"*.

### 8.5 `FormDesc`: lugar e base são **string**, não hexadecimal

**[DOC]** `skymp5-server/cpp/server_guest_lib/FormDesc.cpp`. `ToString()` usa o
formato `"%0x%c%s"` → `shortFormId` em hex **sem prefixo `0x`**, delimitador `:`,
nome do arquivo:

```
"1a26f:Skyrim.esm"        ← forma canônica
"162e2"                    ← sem arquivo: vira 0xff000000 + id em ToFormId()
```

`FromString` sem delimitador **não falha** — cai no ramo sem arquivo e resolve
para a faixa de forms gerados pelo servidor. **É por isso que um `"0x162e2"`
escrito à mão não dá erro: ele aponta silenciosamente para outro lugar.**

`baseDesc` usa a mesma representação: **[DOC]**
`BaseDescBinding.cpp` devolve `FormDesc::FromFormId(refr.GetBaseId(), espmFiles).ToString()`.

### 8.6 `mp.onDeath`: existe, e **respawna sozinho** se você não bloquear

**[DOC]** `server_guest_lib/gamemode_events/DeathEvent.cpp`:

- O nome do hook é literalmente `"onDeath"`; os argumentos são
  `[actorId, killerId]`, com `killerId = 0` quando não há autor.
- `OnFireSuccess` chama **`actor->RespawnWithDelay()`**.

**[DOC]** `gamemode_events/GameModeEvent.cpp` — `Fire()` só chama
`OnFireSuccess` se **nenhum** listener devolveu `false`; caso contrário chama
`OnFireBlocked` (que `DeathEvent` não sobrescreve, ou seja: sem respawn).

**[DOC]** `skymp5-server/cpp/addon/ScampServerListener.cpp:41-129` — o contrato do
valor de retorno do handler JS:

| O handler `mp.onDeath` devolve | Efeito |
|---|---|
| `undefined` | **não bloqueia** → respawn automático acontece |
| `false` | **bloqueia** → o servidor não respawna |
| lança exceção | erro logado, **não bloqueia** → respawn acontece |

**[DOC]** `server_guest_lib/MpChangeForms.h:109` — `float spawnDelay = 25.0f`. O
atraso padrão é **25 segundos**, e há a property `spawnDelay` para mudá-lo.

### 8.7 Validação de entrada do cliente que o servidor já faz

**[DEEPWIKI]** ([2.4.2](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling))
`ActionListener` valida antes de aceitar: `OnUpdateMovement` roda
`MovementValidation::Validate` contra teleporte impossível; `OnHit` checa
alcance de arma (`GetReach`, `fCombatDistance`), cadência (`CanHit`) e ator
morto; `OnChangeValues` corta regeneração impossível (`CropRegeneration`) e
reenvia correção. Custom events chegam por `OnCustomEvent` com
`actorId`, `eventName`, `argsJson`.

---

## Fontes

- [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp) — repositório oficial, pasta `docs/`
- [Game Mode Framework — DeepWiki](https://deepwiki.com/skyrim-multiplayer/skymp/5.1-game-mode-framework)
- **DeepWiki, páginas de arquitetura usadas na seção 8** — [1.2 System Architecture](https://deepwiki.com/skyrim-multiplayer/skymp/1.2-system-architecture-overview) · [2.3 PartOne e game loop](https://deepwiki.com/skyrim-multiplayer/skymp/2.3-partone-and-game-loop) · [2.4.1 MpActor/MpObjectReference](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference) · [2.4.2 ActionListener](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling) · [2.5 World State](https://deepwiki.com/skyrim-multiplayer/skymp/2.5-world-state-management) · [2.6 Networking](https://deepwiki.com/skyrim-multiplayer/skymp/2.6-networking-and-message-processing) · [5.3 Properties](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system)
- **Código primário citado como `[DOC]` na seção 8** — `PropertyBindingFactory.cpp`, `LocationalDataBinding.cpp`, `BaseDescBinding.cpp`, `NeighborsBinding.cpp`, `WorldOrCellDescBinding.cpp`, `FormDesc.cpp`/`.h`, `ScampServer.cpp`, `ScampServerListener.cpp`, `NapiHelper.h`, `MpChangeForms.h`, `MpActor.cpp`, `gamemode_events/DeathEvent.cpp`, `gamemode_events/GameModeEvent.cpp`
- [docs/docs_skyrim_platform.md](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/docs_skyrim_platform.md)
- [Issue #1338 — onHit para gamemode](https://github.com/skyrim-multiplayer/skymp/issues/1338) (fechada como won't fix)

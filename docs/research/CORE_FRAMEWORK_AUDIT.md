# Auditoria da Camada de Framework Central

**Data:** 13/08/2026 · **Branch:** `research/ecosystem-adaptation-2026-08-13`
**Método:** leitura do código em `skymp/gamemode/` como fonte de verdade. Onde o documento e o código discordaram, o código venceu e a divergência está registrada abaixo.

Esta auditoria precede a construção do Interaction Framework. Ela existe para responder uma pergunta antes de qualquer linha nova: **o que já resolve o problema, o que resolve parcialmente e o que está no caminho.**

---

## 0. Sumário dos veredictos

| Componente | Veredicto | Motivo em uma linha |
|---|---|---|
| `core/module-registry.js` | **EXTEND** | Ciclo de vida implícito e boot em ordem de inserção — dependência resolve por sorte |
| `core/command-registry.js` | **KEEP** | Pequeno, correto, com um comportamento de sobrescrita a documentar |
| `core/action-policy.js` | **KEEP** | Fonte única de "estado + lugar permitem?"; vira um estágio do pipeline, sem mudar |
| `core/transaction-service.js` | **KEEP** | Já é a fronteira transacional que o framework vai chamar; `tx.*` e idempotência prontos |
| `core/safe-zones.js` | **KEEP** | Regra dos dois lados correta; consumido via `action-policy`, não diretamente |
| `core/hit-events.js` | **KEEP** | Evidência, nunca autoridade — a decisão está certa e não muda |
| `core/range-utils.js` | **EXTEND** | `assertRange` correto, mas **retorna `{ok:true}` quando `mp` não existe** |
| `core/proximity-ranges.js` | **KEEP** | Fonte única de raio; o framework reusa, não cria tabela nova |
| `core/ui-event-gateway.js` | **KEEP** | Fronteira CEF correta e testável; o rate limiter injetado é o ponto de extensão |
| `core/ui-event-rate-limiter.js` | **EXTEND** | Política única por `(ator, tipo)`; não sabe distinguir `query` de `execute` |
| `core/ui-event-router.js` | **REFACTOR** | O *fallback* despacha **todo evento para todos os handlers** |
| `core/connection-monitor.js` | **KEEP** | Sessão por conexão e invalidação de resposta antiga estão corretas |
| `core/character-state.js` | **KEEP** | Consumido pela `action-policy`; sem mudança |
| `core/panel-refresh-bus.js` | **KEEP** | Precedente correto de barramento pequeno e nomeado |
| `admin-service.hasPermission` | **KEEP** | Permissão nomeada, desconhecida nega e grita |
| `governance.getInteractionActions` | **REPLACE** | É o proto-framework; `require` fixo de dois módulos dentro do core de outro |
| `governance.handleInteractionAction` | **REPLACE** | Roteador por `switch` com regex de prefixo `guard|stall|npc` no core |
| `governance.validateUiInteractionPayload` | **REPLACE** | Schema de todas as ações do servidor num `if` só, dentro da governança |
| Funções de domínio da governança (`stopTarget`, `fineTarget`, …) | **KEEP** | Revalidam permissão e alcance por conta própria — é o que salva o desenho atual |
| `market-stalls.getInteractionSections` | **EXTEND** | Correto, mas o ramo `isSelf` é **inalcançável** hoje |
| `ui/index.html` `DEFAULT_INTERACTION_SECTIONS` | **REMOVE** | Cliente inventa três ações; duas não existem no servidor |
| `governance:interaction:actions` → `notify(safeJson(...))` | **REMOVE** | Despeja o JSON de autorização no chat do jogador |

Nada aqui é refatorado por ser possível. Cada **REFACTOR/REPLACE/REMOVE** abaixo aponta um comportamento observável, não um gosto de arquitetura.

---

## 1. O que já existe e está certo

Vale dizer primeiro, porque muda o tamanho do trabalho: **este projeto não precisa de um framework de interação do zero.** Ele já tem, funcionando e testado:

- uma **fronteira CEF única** (`ui-event-gateway`) que valida envelope, mede volume e nunca registra payload bruto;
- uma **política central de ação** (`action-policy`) que já responde por estado *e* por lugar;
- uma **fronteira transacional** (`transaction-service`) com ledger, `FOR UPDATE` e idempotência por chave;
- **permissões nomeadas** em duas camadas (staff em `admin-service`, cargo de governança em `governance-service`), as duas negando por padrão em nome desconhecido;
- um **registro de módulos** com env flag, dependências e desligamento.

O Interaction Framework é a peça que **falta entre elas**, não uma que as substitui. Os veredictos KEEP acima são a maior parte da tabela de propósito.

---

## 2. `core/module-registry.js` — EXTEND

### 2.1 O boot resolve dependência em ordem de inserção

`bootAll()` percorre `_modules` (um `Map`, portanto ordem de inserção) e, para cada módulo, checa `mod.dependencies.filter(dep => !_active.has(dep))`. Um módulo só enxerga como satisfeita a dependência que **já foi inicializada numa iteração anterior**.

Hoje funciona porque `phase0-basic.js` registra `governance` antes de `market-stalls` e de `player-panel`. Nada garante isso: mover o bloco de registro de `market-stalls` vinte linhas para cima desliga o módulo com

```
market-stalls: FALHOU — dependências não ativas: governance
```

que é uma mensagem correta sobre um estado que não deveria existir. **Isto é a definição de dependência invisível que o §5 do pedido proíbe**, só que na camada de módulo em vez da de serviço.

Correção: ordenação topológica antes do laço, com ciclo detectado e reportado por nome.

### 2.2 Não há ciclo de vida observável

O descriptor tem `initialize`/`shutdown`/`healthCheck`; o estado é `_active: Set`. Só existem, na prática, dois estados: no conjunto ou fora dele. Um módulo que **falhou** em `initialize` é indistinguível de um **desligado por env flag** para qualquer código que pergunte — `isEnabled()` responde `false` para os dois.

Isso importa para o framework de interação: um módulo que registrou interações e depois falhou no `initialize` deixaria as interações registradas, visíveis no menu e executáveis contra um serviço que nunca inicializou.

Correção: estados explícitos (`REGISTERED → INITIALIZING → READY → RUNNING → STOPPING → STOPPED`, mais `FAILED`/`DISABLED`), consultáveis, com `list()` refletindo.

### 2.3 Faltam `version` e `optionalDependencies`

Ambos pedidos no §4 do prompt e ambos ausentes. `optionalDependencies` é a peça que falta para o caso real que já existe no código: `governance` **quer** consultar `economy-regional` se ele estiver ligado, e hoje resolve isso com `moduleRegistry.isEnabled('economy-regional')` + `require` dentro de um `try` (`governance-service.js:880`). Declarar isso no descriptor tira a decisão de dentro de uma função de domínio.

### 2.4 Não há teste

`core/module-registry.js` tem 245 linhas, decide o que roda no servidor, e não aparece na lista de 41 arquivos de teste do `package.json`. É o único componente do `core/` nessa situação. As três falhas acima seriam pegas por teste de ordenação, de estado e de dependência opcional.

---

## 3. `core/ui-event-router.js` — REFACTOR

O `dispatch` chama o handler do prefixo e depois, **incondicionalmente**, todos os outros:

```js
for (const [otherPrefix, handler] of _handlers.entries()) {
  if (otherPrefix === prefix) continue;
  const result = await handler(actorId, uiEvent);   // ← todo handler vê todo evento
}
```

O comentário explica a origem — eventos `governance:interaction:*` tratados por handlers que não seguem o próprio prefixo — e chama isso de compatibilidade. As consequências:

1. **Todo módulo com UI vê o payload de todo evento de UI de todo jogador.** `panel:social:rename` chega ao `governance-service`; `governance:interaction:execute` chega ao `player-panel-service`. Hoje os dois retornam `false` para o que não reconhecem, então nada acontece — a proteção é a boa educação de cada handler, não o roteador.
2. **O custo cresce com o número de módulos**, não com o número de eventos: cada evento de UI paga N `await` de handlers que vão recusá-lo.
3. **`handled` é a soma de todos**, então dois módulos podem tratar o mesmo evento sem que ninguém perceba.

O prefixo já resolve o roteamento hoje: `governance:*` → governance, `panel:*` → panel. O *fallback* protege um caso que não existe mais. **Não é uma falha de segurança em si** — nenhum handler atual age sobre evento de outro prefixo —, mas é a superfície onde a próxima vai nascer, e é exatamente o acoplamento que o §5 do pedido pede para eliminar.

Correção: entregar só ao handler do prefixo; manter o *fallback* atrás de um registro explícito (`registerFallback`) se algum caso real aparecer, com log quando um evento não encontrar dono.

---

## 4. `core/ui-event-rate-limiter.js` — EXTEND

A janela é por `(actorId, type)` com **um** `maxEvents` para o servidor inteiro, vindo de `UI_EVENT_RATE_LIMIT_MAX_EVENTS`, e desligado por padrão (`maxEvents = 0`) até haver medição — o que está correto e documentado.

O que falta para o §18 do pedido: `interaction:query` e `interaction:execute` têm perfis opostos. A consulta acontece toda vez que alguém mira em alguém (dezenas por minuto, barata, sem efeito colateral); a execução move ouro e inventário (unidades por minuto, cara, irreversível). Um teto único ou estrangula a consulta ou libera a execução.

Correção: política por tipo, com o valor global continuando como padrão. O componente já tem o formato certo — só falta o mapa.

---

## 5. `core/range-utils.js` — EXTEND (um caso de falha aberta)

```js
function assertRange(sourceActorId, targetActorId, maxRange) {
  if (typeof mp === 'undefined') return { ok: true };   // ←
```

Fora do servidor, **toda checagem de alcance passa**. Isso está certo para teste unitário — é o que permite exercitar `fineTarget` sem subir o jogo — e é o padrão do resto do projeto (`safe-zones.zoneOf` devolve `null`, `transaction-service._applyToClient` retorna cedo).

A diferença é o sentido da falha: `safe-zones` sem `mp` responde *"não há zona"* (não protege, e não pretendia); `assertRange` sem `mp` responde *"o alvo está perto"*, que é uma **afirmação positiva sobre o mundo**. Se algum dia um caminho de código rodar com `mp` indefinido em produção — um worker, um script de manutenção, um teste de integração mal isolado —, distância deixa de existir em silêncio.

Correção: manter o comportamento (mudá-lo quebraria dezenas de testes por motivo nenhum) e tornar explícito no resultado: `{ ok: true, unverified: true }`. O pipeline de interação registra `unverified` no log de auditoria em vez de tratar como verificado. Custo: uma chave; ganho: a diferença entre "validamos" e "não havia como validar" para de sumir.

---

## 6. O proto-framework dentro da governança — REPLACE

`governance-service.js` já implementa um menu de interação: `getInteractionActions` (o "canSee") e `handleInteractionAction` (o "canExecute + execute"). **É o desenho certo de fluxo** — e é por isso que a substituição preserva o miolo. O problema é onde ele mora e como se estende.

### 6.1 O core de um módulo importa dois outros por nome fixo

```js
const marketStalls = require('./market-stalls-service');            // linha 857
const economyRegional = require('./economy-regional');              // linha 882
```

Para adicionar uma ação de interação hoje, um módulo novo precisa **editar `governance-service.js`**. É exatamente o que o §23 do pedido diz que não pode acontecer. E a direção da dependência está invertida: `market-stalls` já depende de `governance` no `module-registry` (`dependencies: ['governance']`), e a governança volta a importá-lo dentro de uma função — um ciclo que só não quebra porque o `require` acontece em tempo de chamada, não de carga.

### 6.2 O vocabulário de ações é uma regex no core

```js
/^(guard|stall|npc)\.[a-z_]+$/
```

Três namespaces, fixos. `identity.introduce`, `medical.help`, `carry.request`, `law.search` — todo o §14 do pedido — são rejeitados por esta linha antes de chegar a qualquer lugar.

### 6.3 O schema de toda ação do servidor mora numa função

`validateUiInteractionPayload` valida `guard.fine`, `guard.arrest`, `guard.confiscate` e `stall.buy` num encadeamento de `if`. Está **correto** — cada checagem é boa, `isStrictPositiveInteger` recusa `"1e3"` e `" 1"`, o teto de `reason` existe. Mas é uma função que cresce com o servidor inteiro e mora no módulo de governança.

### 6.4 `requestId` é validado e nunca usado

```js
if (Object.hasOwn(data, 'requestId') && (typeof data.requestId !== 'string' || ...)) {
  return { ok: false, message: 'Solicitacao invalida.' };
}
```

O formato é conferido; o valor é descartado. Não há deduplicação, então **duplo clique em "Aplicar multa" cobra duas vezes**. A idempotência existe uma camada abaixo (`transaction-service` por `idempotencyKey`) e não é alimentada por aqui — nenhuma das funções de governança passa `idempotencyKey`. Este é o defeito mais caro do conjunto, e é o §19 do pedido.

### 6.5 `canSee` não checa distância

`getInteractionActions` monta a lista por permissão e nada mais. Um guarda vê "Prender" no menu de alguém do outro lado do mapa; a recusa vem só no `execute`, via `assertRange` dentro de `arrestTarget`. **Server authority está preservada** — este é o ponto que salva o desenho atual —, mas a UI promete o que o servidor vai recusar.

### 6.6 O alvo é sempre um jogador

`getCharacter(targetActorId)` em ambos os lados. Barraca é modelada como *"o jogador dono está aqui"*; o NPC de mercado, idem. Não há NPC, objeto, porta, contêiner nem ponto de mundo — o §9 inteiro do pedido não tem onde encaixar.

### 6.7 Dois defeitos observáveis, achados na leitura

**(a) O ramo `isSelf` da barraca é inalcançável.** `market-stalls.getInteractionSections` tem:

```js
const isSelf = (actorId === targetActorId);
if (isSelf) actions.push({ action: 'stall.manage', label: 'Gerenciar' });
```

mas quem o chama já saiu antes:

```js
// governance-service.js:851
if (!actor || !target || actorId === targetActorId) return { sections: [] };
```

`stall.manage` **nunca aparece no menu.** O comando de chat equivalente continua funcionando, então o efeito é uma feature de UI que ninguém consegue alcançar — não uma perda de dado.

**(b) A lista de autorização vai para o chat.** No `handleUiEvent`:

```js
sendBrowserModal(actorId, 'governance:interaction:actions', result);
notify(actorId, `Acoes disponiveis: ${safeJson(result.sections)}`);
```

O modal é o canal certo; o `notify` despeja o JSON das ações no `chat-log` do jogador. É resto de depuração, e contradiz a disciplina que o próprio `ui-event-gateway` documenta ("nunca registrar o payload bruto").

---

## 7. `ui/index.html` — REMOVE (`DEFAULT_INTERACTION_SECTIONS`)

O cliente mantém a própria lista de ações e a **funde** com a do servidor:

```js
function mergeInteractionSections(serverSections) {
  const result = DEFAULT_INTERACTION_SECTIONS.map(...)   // social.trade, social.group, social.introduce
```

Três ações que o servidor nunca autorizou aparecem em todo menu de interação. Elas submetem por comando de chat, então **a autoridade continua no servidor** — o `command-registry` é o portão real. O resultado prático:

| Ação no menu | Comando enviado | Existe no servidor? |
|---|---|---|
| Apresentar-se | `/apresentar <id>` | **Sim** (`commands.js:278`, módulo `identity`, fase `core`) |
| Trocar | `/trade <id>` | **Não** — `trade-service` está PARKED, o comando nunca foi registrado |
| Grupo | `/groupinvite <id>` | **Não** — não existe em lugar nenhum do gamemode |

Duas das três são botões mortos: o jogador clica, o comando não existe, e a resposta é a de comando desconhecido. Não é falha de segurança; é o menu prometendo mecânica que o servidor não tem, que é a pior coisa que um menu contextual pode fazer num servidor de RP.

Correção: a lista de ações passa a vir inteira do servidor. `identity.introduce` vira uma interação registrada de verdade pelo módulo `identity` — o que ela sempre deveria ter sido.

---

## 8. Divergências entre documentação e código

Registradas porque o pedido pediu para não presumir que os documentos refletem o código.

| Documento | Diz | Código |
|---|---|---|
| Prompt §3 e §24 | `docs/adr/` | **Não existe.** Os ADRs vivem em `docs/technical/ADR_*.md` (um só: `ADR_001`). Os novos seguem o diretório real. |
| `ARCHITECTURE.md` §1.4.1 | "`ui-event-router.js` roteia pelo prefixo do `uiEvent.type`" | Roteia pelo prefixo **e depois entrega a todos os outros handlers** (§3 acima). A frase descreve a intenção, não o comportamento. |
| `ARCHITECTURE.md` §1.4 | Lista o `module-registry` como quem "cuida de dependências entre módulos" | Cuida, mas em ordem de inserção (§2.1). |
| `CONSTITUICAO.md` A.1 | "273 testes verdes, zero sessões com jogador" | São 41 arquivos de teste hoje. **O segundo número continua zero** — nada abaixo foi validado em sessão real. |

---

## 9. O que esta auditoria decide sobre o trabalho seguinte

1. **Não há rewrite.** Dos 22 componentes, 12 são KEEP e 4 são EXTEND. O que é REPLACE é um bloco de ~130 linhas dentro de `governance-service.js`, e as funções de domínio que ele chama ficam intactas.
2. **O framework nasce de uma inversão, não de um service locator.** O acoplamento do §6.1 se resolve com os módulos *registrando* suas interações num registro central, não com a governança *buscando* serviços num localizador. Decisão registrada em `docs/technical/ADR_002_INTERACTION_FRAMEWORK.md`.
3. **`canSee` ganha distância; `canExecute` continua revalidando tudo.** O §11 do pedido já é o comportamento atual por acidente do desenho — vira contrato explícito e testado.
4. **`requestId` passa a valer** (§6.4), ligado à idempotência que o `transaction-service` já oferece.
5. **Tipos de alvo entram como arquitetura, não como código morto.** `PLAYER` é o único com resolvedor implementado, porque é o único com consumidor. Os outros são um ponto de extensão nomeado — o mesmo critério que o cabeçalho do `module-registry` usou para **não** construir distribuição de eventos de jogo em 06/08/2026.

---

## 10. Situação dos veredictos (13/08/2026, mesmo dia)

Todos os **REFACTOR, REPLACE e REMOVE** foram executados na mesma frente. Os **EXTEND** também.

| Veredicto | Componente | Feito |
|---|---|---|
| EXTEND | `module-registry` | ✅ ordenação topológica, estados, `version`, `optionalDependencies`, 19 testes |
| EXTEND | `range-utils` | ✅ `unverified` no retorno |
| EXTEND | `ui-event-rate-limiter` | ✅ política por tipo |
| EXTEND | `market-stalls.getInteractionSections` | ✅ substituída por `registerStallInteractions` (o ramo `isSelf` morto foi junto) |
| REFACTOR | `ui-event-router` | ✅ despacho só ao handler do prefixo |
| REPLACE | `governance.getInteractionActions` | ✅ removida |
| REPLACE | `governance.handleInteractionAction` | ✅ removida |
| REPLACE | `governance.validateUiInteractionPayload` | ✅ removida |
| REMOVE | `DEFAULT_INTERACTION_SECTIONS` | ✅ removida; `identity.introduce` virou interação registrada |
| REMOVE | `notify(safeJson(sections))` | ✅ removido com o `handleUiEvent` |

**Um item da §6 mudou de escopo ao ser executado.** `governance.handleUiEvent` e `sendBrowserModal` não estavam na tabela original — foram identificados como órfãos assim que os três REPLACE saíram, porque as únicas coisas que tratavam eram os dois eventos de interação. Saíram junto, e com eles o registro do prefixo `governance` no roteador: **a governança deixou de ter UI própria.**

**Uma dívida nova, criada por esta frente.** `economy-regional.js` (PARKED) tem `getInteractionSections` e `handleInteractionAction` que agora não têm chamador nenhum — quem as chamava era o caminho legado. Não foram removidas: o módulo inteiro está parado, e mexer nele é reengenharia, não limpeza. Quando ele voltar, volta registrando interações.

---

*Auditoria feita em 13/08/2026 contra o commit `bc59a33`. A §10 registra o que foi executado no mesmo dia. Reler antes de tratar qualquer veredicto como atual.*

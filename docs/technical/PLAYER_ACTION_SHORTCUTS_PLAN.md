# Plano — teclas e menus pra ações de jogador que hoje só existem como texto

Continuação de [`PLAYER_SHORTCUTS_AUDIT.md`](PLAYER_SHORTCUTS_AUDIT.md) (o
inventário) e [`VOICE_MODE_KEY_AUDIT.md`](VOICE_MODE_KEY_AUDIT.md) (a
primeira leva já implementada — `Tab`/`M`/`F2`). Este documento resposta ao
pedido: reconferir a varredura de comandos `/` e transformar os grupos
B/C/E/F daquele inventário num plano executável, em ordem.

## 0. Correções ao inventário anterior (a varredura pegou 2 erros)

Reconferi `commandRegistry.register(`/`name: [` nos 18 arquivos que
registram comando — mesmo conjunto de antes, nenhum arquivo novo. Mas ao
checar `interactionRegistry.register(` (o que já está no menu `[E]`) contra
o mesmo conjunto, dois itens do inventário anterior estavam errados:

- **`/trade` já está no menu `[E]`** — `trade.request`
  (`trade-service.js:486`, label "Propor negócio", `TARGET_TYPES.PLAYER`,
  `TRADE_RANGE`). Não é candidato, já existe.
- **`/stallbuy` (e ver vitrine) já está no menu `[E]`** — `stall.view`/
  `stall.buy` (`market-stalls-service.js:1323-1339`). Também já existe.

E um achado novo, mais sério que "falta um botão":

- **O `trade-overlay` inteiro é decorativo.** O botão "Fechar" chama
  `mp.trigger('cef::trade:cancel', {})` — e não existe NENHUM listener
  server-side pra `cef::trade:cancel` (grep limpo). Pior: o próprio
  `core/ui-event-gateway.js` documenta que `window.mp` **não é injetado**
  na CEF do SkyMP (só existe no painel administrativo separado,
  `skymp5-front`) — então essa chamada provavelmente nem executa, só
  falha em silêncio. O botão só esconde a `div`; aceitar, confirmar e
  cancelar dependem 100% de `/tradeaccept`, `/tradeconfirm`,
  `/tradecancel` digitados. Isto é maior que o item "E" do inventário
  anterior — não é "falta um botão simétrico", é "o botão que existe não
  faz nada".

## 1. Ordem proposta, por esforço crescente

Cada fase é independente — dá pra parar entre uma e outra sem deixar nada
pela metade. Ordenado por (a) o que já tem toda a lógica de servidor
pronta, só falta o fio até a tela, até (b) o que exige um padrão de UI que
ainda não existe no projeto.

### Fase 1 — Trade overlay: ligar de verdade (menor esforço, maior clareza) ✅ implementado (22/08)

`trade-service.js` ganhou `handleUiEvent`, registrado em `phase0-basic.js`
(`uiEventRouter.register('trade', ...)`); `index.html` troca
`mp.trigger('cef::trade:*')` por `sendUiEvent('trade:*', {})` e ganhou os
botões Aceitar/Confirmar (Cancelar já existia, renomeado de "Fechar" pra
não sugerir que é só fechar a tela). Aceitar/Confirmar não fecham a
overlay — a troca continua depois dos dois, e a UI ainda não renderiza o
estado da sessão pra saber quando fechar de verdade. 4 testes novos em
`trade-service.test.js` (`handleUiEvent`), 1086 testes do gamemode
passam. Verificado num navegador comum: os três botões mandam o payload
certo pelo canal real. Não validado dentro da CEF do SkyMP.


`acceptTrade`, `confirmTrade`, `cancelTrade` já existem como funções em
`trade-service.js` (usadas por `/tradeaccept`/`/tradeconfirm`/
`/tradecancel`). Falta só:

1. `trade-service.js`: um `handleUiEvent(actorId, uiEvent)` que faz
   `switch (uiEvent.type)` em `'trade:accept'`/`'trade:confirm'`/
   `'trade:cancel'` chamando as três funções — mesmo formato de
   `player-panel-service.js handleUiEvent`.
2. `phase0-basic.js`: `uiEventRouter.register('trade',
   tradeService.handleUiEvent)` — mesma linha que já existe pra `'panel'`
   e `'interaction'`.
3. `index.html`: trocar `mp.trigger('cef::trade:cancel', {})` por
   `sendUiEvent('trade:cancel', {})` (o canal que já funciona, provado
   pelo painel e pelo menu de interação), e acrescentar dois botões
   (Aceitar / Confirmar) que chamam `sendUiEvent('trade:accept', {})` /
   `sendUiEvent('trade:confirm', {})`.

Sem decisão de produto pendente — é consertar um caminho que já deveria
funcionar, não desenhar um novo.

### Fase 2 — `/socorrer` no menu `[E]` ✅ implementado (22/08)

Lido `interaction-registry.js`/`interaction-service.js` por completo antes
de codar (conforme prometido). Achado: `canSee(ctx) => boolean` já é
exatamente o mecanismo de "ação condicional ao estado do alvo" —
`trade.request` já usa isso pra sumir do menu de quem está numa troca.
Nada novo precisou entrar no framework.

`death.rescue` registrado com `canSee` checando `_downedPlayers.has(target
.characterId)`, `execute` chamando `rescueTarget` direto (que já revalida
tudo — auto-socorro, alcance, DOWNED — e já manda as próprias
notificações, por isso `execute` não retorna `message`). `dependencies:
['interaction']` no módulo `death`, mesma convenção de `trade`. 4 testes
novos (`death.rescue no menu de interação`), 1090 testes do gamemode
passam. Não validado em jogo.

Texto original do plano, mantido como registro de como cheguei lá:

Hoje `death-service.js` não registra nada em `interactionRegistry` (grep
confirma). Precisa de uma entrada nova, no mesmo padrão de
`trade.request`/`law.*`:

```js
interactionRegistry.register({
  id: 'death.rescue',
  module: 'death',
  target: interactionRegistry.TARGET_TYPES.PLAYER,
  label: 'Socorrer',
  section: 'social', // a decidir — ver nota abaixo
  distance: RESCUE_RANGE, // hoje só existe como constante dentro do commandDef de /socorrer
  policyAction: 'rescue',
  execute: (actorId, targetId) => stabilizeCharacter(targetId, actorId) // nome real a confirmar em death-service.js
});
```

**Decisão de produto pendente**: `law.*`/`trade.request` usam `condition`
implícita por distância só; `/socorrer` só faz sentido quando o alvo está
`DOWNED`. Preciso confirmar se `interactionRegistry` já suporta um filtro
por estado do alvo (não vi isso nos exemplos lidos) — se não suportar, a
ação aparece no menu mesmo pra quem não está caído, e o `execute` real
recusaria (mesma defesa em profundidade que o resto do framework já usa:
o menu sugere, o `execute` sempre revalida). Preciso ler
`interaction-registry.js`/`interaction-service.js` inteiros antes de
escrever isso — não vou assumir a API.

### Fase 3 — `/stallpack` e `/stallremove` no menu `[E]` ✅ implementado (22/08)

O texto original desta fase (abaixo, mantido como registro) estava
errado em dois pontos, corrigidos só ao ler o código de verdade:

1. **Não é `TARGET_TYPES.OBJECT`.** `stall.view`/`stall.buy` (já
   existentes) miram o **jogador dono** (`TARGET_TYPES.PLAYER`), não um
   objeto físico — o comentário no próprio `market-stalls-service.js`
   explica que não havia resolvedor de `object`/`container` quando aquilo
   foi escrito (13/08). `stall.pack`/`stall.remove` não têm uma segunda
   pessoa envolvida — é o dono agindo sobre a própria barraca — então o
   alvo certo é `TARGET_TYPES.SELF`, o mesmo vocabulário que
   `character.dashboard` já usa (`core/character-dashboard-bridge.js`,
   Tarefa 11). Nenhum `physical-anchor-registry` envolvido.
2. **Achado durante a implementação, não previsto no plano**: o
   resolvedor de `SELF` só é registrado quando o módulo
   `character-dashboard-bridge` inicializa — e esse módulo está atrás de
   `ENABLE_INTERACTION_PROMPT` (a flag do prompt `[E]`), não de uma flag
   própria. Declarar isso como `dependencies` obrigatória em
   `market-stalls` derrubaria o módulo INTEIRO (incluindo `/stallplace`,
   `/stallbuy`, tudo) pra quem roda barracas sem o prompt ligado — usei
   `optionalDependencies` em vez disso (`phase0-basic.js`), que só ordena
   o boot sem exigir. Sem essa flag, as duas ações ficam registradas mas
   inalcançáveis — falha nomeada no resolvedor, não um menu quebrado.
   Documentado no próprio código como acoplamento herdado, não
   introduzido por esta fase, e candidato a revisão futura (o resolvedor
   `SELF` provavelmente deveria nascer com o módulo `interaction` em vez
   do prompt).

6 testes novos (`market-stalls-service.interactions.test.js`, arquivo
próprio — `stall.view`/`stall.buy` também nunca tiveram teste de
interação, gap pré-existente não coberto aqui). 1096 testes do gamemode
passam. Não validado em jogo.

Texto original do plano:

Diferente de `stall.view`/`stall.buy` (cliente comprando de OUTRO
jogador), estas duas são o DONO gerenciando a própria barraca — o alvo é
`TARGET_TYPES.OBJECT` (a barraca), não `PLAYER`, no mesmo padrão de
`physical-anchor-registry` que o Depot já usa (ver
`UI_UX_INTERACTION_AUDIT.md` §9). Precisa registrar a barraca ativa como
âncora física quando ela é montada (`/stallplace`) e desregistrar quando
é recolhida — trabalho novo em `market-stalls-service.js`, não só
`interactionRegistry.register`.

### Fase 4 — `/profissoes` e `/alma` como abas do `/painel`

Sem alvo, sem toggle de estado — é leitura pura, mesmo formato de
`status`/`governance`/`economy`/`social` já em `player-panel-service.js`
(`switchTab`/`renderTab`). Duas abas novas, cada uma buscando dados de
`profession-service.js`/`soul-service.js` (que já expõem os dados via
`/profissoes`/`/alma` — é reaproveitar a leitura, não duplicá-la).

### Fase 5 — Notificação com 2 botões pra `/searchaccept`/`/searchdeny`

Maior esforço porque é um padrão de UI que **não existe ainda no
projeto**: uma notificação que chega de forma assíncrona (o pedido de
revista pode vir a qualquer momento, não é resposta a uma tecla) e
oferece uma escolha binária com timeout. O mais próximo que existe é o
toast de `sendNotification` (`browserModal` tipo `'toast'`) — que é
só-leitura, sem botão. Precisaria de um tipo de modal novo
(`browserModal` tipo `'choice'`?, ou canal próprio) — arquitetura a
desenhar antes de codar, não uma extensão direta de algo pronto como as
Fases 1-4.

## 2. O que eu ainda preciso ler antes de codar a Fase 2

Não vou inventar a forma de "ação condicional ao estado do alvo" —
`interaction-registry.js` e `interaction-service.js` completos precisam
ser lidos primeiro pra saber se esse conceito já existe (e como as ações
`law.*` escondem "Prender" de quem já está preso, se é que escondem) antes
de escrever a Fase 2 de verdade.

## 3. Recomendação de por onde começar

**Fase 1** — é a que corrige algo já quebrado (não uma feature nova), tem
zero decisão de produto em aberto, e reaproveita 100% do código de
servidor que já existe. Proponho começar por ela.

# UI/UX Interaction Hub — auditoria (§15 da Constituição)

Tarefa 11: unificar a experiência de interação em torno do teclado/mouse —
prompt contextual `[E]`, o mesmo menu de ações já existente aberto por tecla
em vez de só por clique, uma ponte `SELF` pro painel do jogador quando não
há ninguém por perto, e comandos legados marcados (não removidos) como
`hidden`. Peças novas: `core/interaction-prompt-service.js`,
`core/physical-anchor-registry.js`, `core/character-dashboard-bridge.js`,
`interaction-service.peek()`, `TARGET_TYPES.SELF`,
`skymp/ui/interaction-prompt.js`/`.css`, `hidden` em `command-registry.js`.

## Decisões que mudaram o brief original

Quatro premissas do brief não correspondiam ao estado real do repositório —
cada uma verificada contra a fonte antes de escrever código, não assumida:

- **Raycast**: o brief pedia o cliente saber quando o jogador está
  **olhando** pra um alvo. Verificado contra a documentação oficial do
  SkyMP/Skyrim Platform (`native.md`, `new_methods.md`, `features.md`) e
  contra a árvore de código-fonte (`skyrim-platform/src/platform_se/psc/` —
  só expõe `Actor, ActorBase, Cell, ColorForm, Enchantment, Form, HeadPart,
  ObjectReference, Potion, Race, TESModPlatform, WorldSpace`; nenhuma classe
  `Game`, nenhum crosshair). Confirma `docs/research/
  SKYMP_ARCHITECTURE_PATTERNS.md`: exigiria fork.
- **Pickup**: não existe `/pegaritem`, nem tabela de item-no-chão, nem
  resolvedor de alvo pra isso. Não é uma feature adiada — nunca foi
  construída.
- **`/pagar`, `/profissoes`, `/gestos`**: nenhum dos três existe como
  comando de chat. Só `/anim` é real, e não estava ligado a nenhuma ação do
  Interaction Framework.
- **"Character Dashboard" novo**: o brief pedia um componente de UI novo com
  abas de Identidade/Finanças/Profissões/Gestos. `player-panel-service.js` +
  `skymp/ui/player-panel.js`/`.css` **já são isso** — nome, ouro real
  (`transactionService.getGold`), social, governança, abas de verdade,
  aberto por `/painel`. Construído em vez de reaproveitado, seria duplicata.

Decisões tomadas com o dono do produto:
1. Fallback por **proximidade** (não raycast), cobrindo os dois tipos de
   alvo que o loop de gameplay já tem de verdade — atores (social) e
   âncoras físicas conhecidas (Depot, via `depot_terminals`). Pickup fica de
   fora até um sistema de item-no-chão existir.
2. Sem ator nem âncora por perto, o prompt `[E]` abre o **painel do jogador
   que já existe** (`TARGET_TYPES.SELF` → `character-dashboard-bridge.js` →
   `playerPanel.openPanel`) — zero UI nova, zero leitura de dado duplicada.
   Profissões/Gestos ficam fora até `feat/professions-foundation` (PR #34,
   não mergeada em `main`) e um allowlist de animação existirem de verdade.

## 1. Objetivo

Trocar `/comando` por `[E]` como o caminho principal de interação — o
jogador olha pra perto (por proximidade, não visão), vê o que pode fazer, e
faz com uma tecla, sem digitar.

## 2. Problema que resolve

Toda a Fase 0 até aqui construiu ações reais (Depósito, apresentação,
troca) atrás de um menu que só abre por clique num alvo já selecionado de
outro jeito, ou por comando de chat que ninguém descobre sozinho. Ninguém
solto no mundo sabe que pode interagir com nada sem ler documentação.

## 3. Problemas que cria

- **Um segundo caminho pro mesmo destino.** `interaction:query` agora tem
  dois chamadores (a CEF, com rate limit; o tick do prompt, via `peek()`,
  sem). Um bug em `peek()` que devolvesse ações que `query()` recusaria
  seria uma inconsistência silenciosa — mitigado por `peek` chamar o MESMO
  `_computeSections` interno, não uma cópia.
- **Cache de âncoras pode ficar 30s desatualizado.** Um terminal de Depot
  removido por um staff continua no prompt de quem já estava perto até o
  TTL vencer — `peek()` na hora de abrir o menu de verdade ainda recusa
  certo (a fonte de verdade nunca foi o cache), então o pior caso é um
  prompt fantasma que abre um menu vazio, não uma ação executada errada.
- **Um segundo alvo compete pelo único prompt da tela.** Ator e âncora
  física desempatam por distância crua, sem vetor de visão — um jogador
  parado entre um NPC e um baú vê o mais próximo, que pode não ser o que
  ele queria. Ver §12 (usabilidade) pra mitigação.

## 4. Exploits

- **Nenhum novo em cima do que `interaction-service.js` já fecha.**
  `peek()` e `query()` correm exatamente o mesmo `canSee`/`assertRange`/
  `buildContext` — um cliente não ganha nada mandando um `targetId`
  fabricado pro prompt, porque o prompt não decide, só sugere; o `execute()`
  de verdade sempre revalida do zero (mesma garantia que já existia).
- **Rate limit de `execute` continua intacto.** `peek()` só evita gastar o
  limite de `query`; o de `execute` (o que protege ouro/item de verdade) não
  foi tocado.
- **Tecla E fabricada.** Um cliente que chama `handleInteractionPromptKey`
  direto, sem o servidor ter mandado nenhum alvo, não ganha nada: sem
  `targetId`, a função não faz nada; com um `targetId` inventado, o
  `interaction:query`/`execute` que vem depois passa pelas MESMAS checagens
  de sempre.

## 5. Impacto econômico

Nenhum direto — o prompt não move ouro nem item, só abre o mesmo menu que já
existia. O caminho de dinheiro (Depot, troca) não mudou de regra, só de
atalho de teclado.

## 6. Impacto político / militar / religioso

Nenhum. Não há ação de staff, guarda ou clero neste trabalho — é
infraestrutura de UI em cima de ações que já existiam.

## 7. Impacto social

Positivo, se validado: interações sociais (apresentar-se, revistar) hoje
exigem que alguém já saiba o comando ou já tenha clicado em algo. Um prompt
visível baixa a barreira de quem é novo no servidor — mas só se o rótulo
"Interagir" (quando há mais de uma ação) não confundir sobre o QUE vai
acontecer antes de abrir o menu.

## 8. Impacto narrativo

Nenhum novo — o prompt não cria conteúdo, só expõe o que os sistemas
existentes (identidade, Depot) já ofereciam.

## 9. Impacto técnico

- `interaction-service.js` ganha `peek()` (mesmo cálculo de `query()`, sem
  rate limit) — refatorado pra `_computeSections` compartilhado, não
  duplicado.
- `core/interaction-prompt-service.js` (novo): tick de 2s, mesmo padrão de
  `nametag-service.js`. Ator via `range-utils.nearbyActors` (usa
  `mp.get(actorId,'neighbors')` nativo); objeto via
  `core/physical-anchor-registry.js` (novo) — um provider por módulo com
  âncora física conhecida (hoje nenhum registrado nesta branch; ver nota de
  integração abaixo).
- `command-registry.js` ganha `hidden`/`list({playerFacing})`. Não existe
  `/ajuda`/`/help` neste projeto ainda — a flag é plumbing pronta pra quando
  existir, não uma feature visível hoje.
- `interaction-registry.js` ganha `TARGET_TYPES.SELF`. `interaction-
  targets.js` recusa `self` deliberadamente no resolvedor de `player`
  (`targetActorId === actorId` → `null`, citando `CORE_FRAMEWORK_AUDIT.md`
  §6.7a: "interação consigo é painel, não menu contextual") — `SELF` é um
  vocabulário NOVO, registrado via `targets.registerResolver` por
  `character-dashboard-bridge.js`, não uma reinterpretação do resolvedor de
  `player`.
- `core/character-dashboard-bridge.js` (novo): resolvedor SELF + a
  interação `character.dashboard`, cujo `execute` só chama
  `playerPanel.openPanel(actorId)` — o mesmo código de `/painel`. Nenhuma
  leitura de dado neste arquivo.
- **Nota de integração entre branches**: `core/depot-service.js` vive em
  `feat/depot-service` (Tarefas 9-10), não nesta branch. Pra Depot aparecer
  de verdade no prompt `[E]`, falta registrar um provider — 6 linhas, a
  aplicar quando as branches se juntarem:
  ```js
  const physicalAnchorRegistry = require('./physical-anchor-registry');
  physicalAnchorRegistry.register({
    targetType: interactionRegistry.TARGET_TYPES.OBJECT,
    list: async () => {
      const rows = await database.query('SELECT object_id FROM depot_terminals');
      return rows
        .map((r) => ({ targetId: typeof mp !== 'undefined' ? mp.getIdFromDesc(r.object_id) : null }))
        .filter((a) => a.targetId !== null);
    }
  });
  ```
  E marcar `/depot` como `hidden: true` em `commandDefs()`.

## 10. Como gera histórias / como é abusado / como balancear

- **Gera histórias**: baixa a barreira de entrada pra interação social —
  ver §7.
- **Como é abusado**: ver §3-4 — nada novo além do que o Interaction
  Framework já fecha.
- **Como balancear**: `INTERVALO_DO_TICK_MS` (2s) e `ANCORA_CACHE_TTL_MS`
  (30s) são as duas perillas de custo — subir o tick por jogador ativo é o
  primeiro lugar a olhar se `range-utils.nearbyActors`/`peek()` pesarem numa
  sessão real.

## 11. Como integra ao mundo

`interaction-prompt` é módulo `lab`, `ENABLE_INTERACTION_PROMPT=false` por
padrão, como todo lab deste projeto. Não depende de `interaction` via
`dependencies: []` no `module-registry` — usa a instância já criada em
`phase0-basic.js` via `configure()`, não o grafo de dependências do
registry. `physical-anchor-registry` fica vazio até um módulo se registrar
(hoje, nenhum nesta branch — ver nota de integração em §9).
`character-dashboard-bridge` é `lab`, mesma flag `ENABLE_INTERACTION_PROMPT`
— a ponte SELF só faz sentido com o prompt ligado. `dependencies:
['interaction', 'player-panel']`: precisa dos dois de pé (o resolvedor SELF
e o `openPanel` que a ação chama).

## 12. Usabilidade — foco do brief

- **Contra spam de prompts**: só EXISTE um prompt na tela por vez — o
  `_melhorCandidato` escolhe um único vencedor (ator, âncora, ou SELF como
  último recurso — nunca uma lista, e nunca zero: SELF garante que sempre
  há UM candidato, mesmo sozinho no meio do nada). O diffing
  (`_ultimoEnvio`) garante que o cliente só recebe uma atualização de tela
  quando o texto de verdade muda, não a cada tick — sem isso, 1 escrita de
  `mp.set` a cada 2s por jogador ativo seria "spam" de rede, mesmo sem
  repintar nada. `[E] Ver personagem` sempre visível quando sozinho é
  decisão deliberada (objetivo 3), não vazamento do fallback — é o convite
  pro painel.
- **Contra atrapalhar a visão em combate**: o prompt é um rótulo pequeno,
  fixo, sem fundo opaco cobrindo o centro da tela (`interaction-prompt.css`
  — pílula discreta, `bottom: 14%`, fora do centro de mira). Ele NÃO
  desaparece sozinho num sinal de combate — porque, como já registrado na
  auditoria do Depot (`DEPOT_SERVICE_AUDIT.md` §3, branch `feat/depot-
  service`), não existe sinal de combate em tempo real neste projeto
  (`core/hit-events.js` só informa depois que o episódio fecha). Gap
  conhecido, herdado, não escondido: um jogador em combate perto de um NPC
  ou terminal continua vendo o prompt.
- **Contra o menu abrir sozinho durante um combate**: só abre por
  `handleInteractionPromptKey`, e só quando a tecla E é pressionada — nunca
  automático. O prompt sugere; o jogador decide.
- **Sem vetor de visão** (§3): o desempate ator-vs-âncora é só distância.
  Numa sala com um NPC e um baú próximos, o jogador pode precisar se
  aproximar mais de um dos dois pra "ganhar" o prompt que quer — atrito
  real, não crítico, resolvido com fork de raycast se algum dia acontecer.
- **Comandos legados continuam funcionando** (objetivo 4): `hidden: true`
  nunca desativa um handler, só tira da listagem `playerFacing`. Alguém com
  rede ruim ou fora de alcance de qualquer alvo (prompt não aparece) ainda
  consegue `/apresentar` de propósito.

## Confirmado por teste, não confirmado em sessão real

44 testes novos (`interaction-service.test.js` +3 peek, `interaction-
prompt-service.test.js` 20, `physical-anchor-registry.test.js` 4, `command-
registry.test.js` 2, `module-registry.test.js` +1, `character-dashboard-
bridge.test.js` 3, `interaction-registry.test.js` — 1 fixado, contava "sete"
fixo em vez do tamanho real do enum) provam a lógica de escolha de alvo,
cálculo de rótulo, cache, ocultação de comando e o resolvedor SELF contra
mundo mockado. `interaction-prompt.js`/`.css` foram verificados num
navegador comum servindo os arquivos estáticos — `window.handleServer
Modal`-style dispatch, tecla E abrindo o menu com o `targetType` certo
(inclusive `object`, pro Depot), tema visual — **não dentro da CEF real do
SkyMP**. `character-dashboard-bridge` não precisou de UI nova pra testar —
reaproveita `/painel`, que já tem sua própria suíte em `player-panel-
service.test.js`.

Não validado em jogo, mesma ressalva de toda a família de labs:
- `range-utils.nearbyActors` (`mp.get(actorId,'neighbors')`).
- `ctx.sp.on('keyPress', ...)` e o scan code 18 pra tecla E — documentado
  pelo SkyMP, nunca chamado por este projeto.
- `mp.getIdFromDesc` (necessário pro provider de Depot, nota §9) — a
  direção inversa de `mp.getDescFromId`, que já é usado e também nunca
  validado em jogo (`depot-service.js`).

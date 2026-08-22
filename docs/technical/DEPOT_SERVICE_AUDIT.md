# Depot Service Audit — armazenamento regional (§15 da Constituição)

Código: [`core/depot-service.js`](../../skymp/gamemode/core/depot-service.js),
migration [`migration-v20-depot-service.sql`](../../skymp/packages/database/migration-v20-depot-service.sql),
testes [`core/depot-service.test.js`](../../skymp/gamemode/core/depot-service.test.js).

Como em `ENVIRONMENT_AUDIT.md`/`ECONOMY_VAULT_AUDIT.md`, os 15 pontos vivem
neste documento, não no cabeçalho do código — precedente já estabelecido
nesta sessão.

## Decisões que mudaram o brief original

- **Migration v20, não v24.** A última no disco (`feat/professions-foundation`)
  era v18; a branch `feat/environment-economy-vault` (PR #44, não mesclada
  ainda) já reivindica v19. v20 evita colisão garantida — mas se a ordem de
  merge mudar, pode precisar renumeração manual na hora. Risco inerente a
  branches paralelas mexendo em migration.
- **`hold_id` reaproveita a tabela `holds` já existente** (`schema.sql`, com
  Whiterun/Solitude/Riften/etc. já listados), em vez de um `region_id` novo.
- **Ouro não ganhou reserva nova.** `characters.gold` já é global; o Depot só
  exibe o saldo via `economy-service.getBalance`. Decisão tomada com o dono
  do produto — ver §5.
- **Checagem de combate foi adiada.** `core/hit-events.js` é single-subscriber
  (já ocupado por `death-service.js`) e só informa depois que o episódio
  fecha (10s de silêncio) — não dá um portão em tempo real sem mexer em
  infra compartilhada. Decisão tomada com o dono do produto — ver §3.

## 1. Objetivo

Dar a personagens um lugar para guardar itens POR REGIÃO (hold), sem
depender de containers privados nem de carregar tudo o tempo todo — e sem
permitir que um item guardado numa cidade apareça em outra.

## 2. Problema que resolve

Hoje só existe `containers` (baú privado por personagem, sem noção de
região) e o inventário do próprio personagem. Nada modela "larguei minhas
armas em Whiterun porque vou viajar pra Solitude e não quero carregar peso".

## 3. Problemas que cria

- **Sem checagem de combate** (adiado, ver acima): um jogador em fuga durante
  um combate pode, em teoria, descarregar itens no depósito no meio da
  perseguição. Mitigação parcial: a distância de interação (~3m) já exige
  parar perto do baú, o que por si só é um risco em combate ativo — não é
  zero atrito, mas não é o gate explícito que o brief pediu.
- Sem limpeza de `depot_terminals` órfãos se um objeto físico for removido
  do mundo/mod atualizado — o terminal continuaria no banco apontando para
  um FormDesc que não existe mais. Não implementado nesta fase; mesmo tipo
  de dívida que outras tabelas de referência a objeto físico já têm.

## 4. Exploits

- **"Depósito infinito" via múltiplos holds**: um personagem pode ter um
  depósito por hold, cada um com sua própria `capacity` — não é um exploit,
  é o design (capacidade total = soma de N holds visitados), mas vale
  documentar que a capacidade REAL de armazenamento de um jogador escala
  com quantas cidades ele visita, não é um teto fixo por personagem.
  Mitigável ajustando `depot.defaultCapacity` para baixo se isso incomodar
  o balanceamento.
- **Duplicação via corrida** entre `depositItem` concorrente e outra
  operação no MESMO item (ex: uma venda em barraca ao mesmo tempo): fechado
  pelo mesmo `FOR UPDATE` que `transaction-service._applyStackDelta` já usa
  — as duas operações competem pela mesma linha de `character_inventory` e
  serializam. Nenhum teste de concorrência dedicado foi pedido para esta
  tarefa (diferente da Tarefa 7/Economy Vault); a garantia vem do primitivo
  já testado, não de código novo.
- **Item "sumindo" entre servidor e cliente**: como em qualquer operação de
  inventário deste projeto, o cliente NUNCA decide o resultado — o banco é
  commitado primeiro, o reflexo no cliente (se algum dia este serviço vier a
  precisar de um) seria best-effort pós-commit, mesmo padrão de
  `transaction-service._applyToClient`. Hoje `depositItem`/`withdrawItem` só
  mexem em linhas de banco (character_inventory/depot_inventory), sem
  aplicar nada ao lado do cliente — o inventário exibido ao jogador reflete
  o banco através do painel/UI, não de uma sincronização de item físico.

## 5. Impacto econômico

Nenhuma criação/destruição de valor: depositar/sacar item não move ouro, só
realoca onde o item "mora". A decisão de manter ouro fora do Depot (§ acima)
existe justamente para não abrir um segundo lugar onde inflação/duplicação
precisariam ser vigiadas — o dinheiro continua tendo uma porta só
(`economy-service.js`, ADR_004).

## 6. Impacto político / militar / religioso

Nenhum direto. Indireto: um hold poderia um dia cobrar "aluguel" pelo
depósito (não implementado) — ponto de extensão futuro para tesouraria de
hold, não coberto aqui.

## 7. Impacto social

Incentiva presença física em múltiplas cidades — quem guarda item em
Whiterun tem motivo de RP para voltar lá, ou para negociar a distância
("me vê aquele item que guardei aí?"). É o oposto de "carrego tudo sempre",
que empobrece a geografia do servidor.

## 8. Impacto narrativo

Cria gancho natural: contrabando regional (item "preso" numa cidade que o
personagem não pode visitar por motivo político/legal vira enredo), rotas
comerciais entre depósitos regionais.

## 9. Impacto técnico

- `transaction-service.js` ganha uma linha em `STACK_TABLES`
  (`depot_inventory`) — nenhuma lógica de transação nova, reaproveitamento
  puro de `tx.applyStackDelta`.
- Primeiro consumidor real de `TARGET_TYPES.OBJECT` além do Minerador — a
  ressalva de `core/interaction-targets.js` continua valendo: `locationalData`
  contra um objeto comum é **assumido a partir da documentação oficial do
  SkyMP, não validado em jogo**.
- Nenhuma mudança em `core/interaction-service.js`/`interaction-registry.js`
  — o Depot só CONSOME o framework existente (distance, canSee, schema,
  audit levels), não estende a forma dele.

## 10. Como gera histórias / como é abusado / como balancear

- **Gera histórias**: ver §7-8.
- **Como é abusado**: ver §3-4. O gap de combate é o mais concreto — se
  virar problema real em sessão, o próximo passo é o design alternativo já
  descartado nesta tarefa (mudar `hit-events.js` para multi-assinante e
  disparo por golpe, não só por fechamento de episódio).
- **Como balancear**: `depot.defaultCapacity` (`core/server-options.js`,
  default 500) é ajustável sem redeploy. `DEPOT_INTERACT_RANGE` (~211
  unidades, conversão aproximada de 3 metros — não há constante
  metro→unidade estabelecida neste projeto) é uma constante de código, não
  server-option, por ser geometria física do baú, não número de gameplay.

## 11. Como integra ao mundo

Depende de `interaction` (framework) já estar de pé — `phase0-basic.js`
declara `dependencies: ['interaction']`, mesmo padrão de `trade`. Nasce
`ENABLE_DEPOT_SERVICE=false`, como todo módulo `lab` deste projeto. Precisa
de `depot_terminals` populada manualmente pela staff (associar um
`MpObjectReference` físico a um `hold_id`) antes de qualquer jogador
conseguir interagir — não há UI de staff para isso nesta fase, é um INSERT
direto.

## 12. UI-Depot-Bridge — usabilidade (Tarefa 10)

Canal usado: o mesmo `sendModal`/`browserModal` que `interaction:actions` já
usa (`core/interaction-service.js`) — nenhum canal novo, nenhuma mudança na
CEF pra escutar um segundo protocolo. `depot.view` chama `sendModal(actorId,
'depot:open', payload)`; `depot.deposit`/`depot.withdraw`, quando `ok:true`,
chamam `sendModal(actorId, 'depot:update', payload)` pra reconciliar o
saldo/capacidade sem o jogador precisar fechar e reabrir. Ver `skymp/ui/
depot-panel.js` e `skymp/ui/depot-panel.css`.

- **Não bloqueia a visão em perigo**: o painel é um cartão centralizado de
  760px no máximo (`min(760px, calc(100vw - 48px))`), não um overlay de tela
  cheia — as bordas da tela (onde um inimigo se aproximando apareceria)
  continuam visíveis. Fundo do `<body>` é transparente (herdado do resto da
  CEF), então não há véu escurecendo o mundo atrás do painel.
- **Saída sempre à mão**: botão × e tecla Esc fecham o painel, mesmo padrão
  de `interaction-menu` — nenhum modo novo de fechar pra aprender.
- **`depot:update` nunca reabre sozinho**: se o jogador já fechou o painel
  (por exemplo, saiu correndo no meio de um saque lento), a atualização que
  chega depois é descartada (`state.open` checado em `DepotPanel.update`) —
  o painel não pula de volta na cara de quem decidiu fechar.
- **Gap conhecido, não escondido**: nada aqui fecha o painel sozinho quando o
  personagem entra em combate ou sofre dano. O mesmo gap já registrado em §3
  (nenhuma checagem de combate existe no projeto — `core/hit-events.js` só
  informa depois que o episódio fecha) se propaga pra UI: um terminal de
  depósito perto de uma zona perigosa pode prender a atenção do jogador numa
  tela sem aviso de ameaça. Mitigação real (fechar o painel num sinal de
  combate) fica pro dia em que `hit-events.js` virar multi-assinante — mesma
  dependência já citada em §10.
- **Item/nome cru**: linhas mostram `0x<hex>` do `baseId`, não um nome
  legível — não existe tabela FormID→nome em lugar nenhum da CEF hoje (nem
  `player-panel.js` nem `interaction-menu` resolvem isso). Não é regressão
  desta tarefa, é um gap que já existia em todo o resto da interface.

## Confirmado por teste, não confirmado em sessão real

Os 15 testes de `depot-service.test.js` (11 originais + 4 da Tarefa 10) provam
a lógica de depósito/saque/isolamento regional/capacidade e o disparo de
`sendModal` contra um banco mockado. `skymp/ui/depot-panel.js` foi verificado
num navegador comum servindo os arquivos estáticos (`window.handleServerModal
→ DepotPanel.open/update`, botões, barra de capacidade) — **não dentro da CEF
real do SkyMP**. Ninguém rodou isto num servidor SkyMP real. `resolveTerminal`/
o alvo `TARGET_TYPES.OBJECT` contra um objeto físico do mundo carregam a MESMA
ressalva que `core/interaction-targets.js` já registra para o Minerador:
assumido a partir da documentação oficial, nunca validado em jogo. O mesmo
vale para `window.skyrimPlatform.sendMessage`/`mp.set('browserModal', ...)`
— a ponte servidor→CEF que já existia para `interaction:actions` e que este
trabalho reaproveita, sem validação em cliente real.

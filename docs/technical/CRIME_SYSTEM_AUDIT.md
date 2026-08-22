# Crime System Audit — Crime e Proveniência (§15 da Constituição)

Código: [`core/crime-service.js`](../../skymp/gamemode/core/crime-service.js),
extensões em [`governance-service.js`](../../skymp/gamemode/governance-service.js)
(`showInventorySnapshot`/`notifyStolenProvenance`, `confiscateItem`).
Migrations: [`migration-v21-crime-provenance.sql`](../../skymp/packages/database/migration-v21-crime-provenance.sql)
(Tarefa 12 — `item_instances`, `session_crime_alerts`, `audit_logs.is_crime`) e
[`migration-v22-crime-interactions.sql`](../../skymp/packages/database/migration-v22-crime-interactions.sql)
(Tarefa 13 — `confiscations.item_instance_id`).
Testes: [`core/crime-service.test.js`](../../skymp/gamemode/core/crime-service.test.js),
[`crime-governance-integration.test.js`](../../skymp/gamemode/crime-governance-integration.test.js).

Como em `DEPOT_SERVICE_AUDIT.md`/`ENVIRONMENT_AUDIT.md`, os 15 pontos vivem
neste documento, não no cabeçalho do código. Cobre as duas entregas: Tarefa 12
(fundação — instância de item, hot item, anti-combat-log, restituição) e
Tarefa 13 (interações — rendição/roubo, revista institucional, confisco).

## Correção registrada durante a Tarefa 13

A migration `migration-v22-crime-interactions.sql` originalmente recriava a
tabela `confiscations` do zero, presumindo que ela não existia — presunção
**errada**: `confiscations` já existe desde `migration-v3-governance.sql`
(linha 132), e `governance-service.confiscateItem` já gravava nela. O erro só
apareceu porque uma varredura inicial (grep malformado) não encontrou o nome
na primeira tentativa. Corrigido antes de fechar a tarefa: a migration final
só faz `ALTER TABLE confiscations ADD COLUMN item_instance_id`. Registrado
aqui em vez de escondido porque é exatamente a classe de erro que
`check:schema:list` existe para pegar — ver `skymp-schema-nao-e-so-schema-sql`
na memória do projeto.

## 1. Objetivo

Fazer "roubar" ter consequência rastreável sem exigir um sistema de profissão
"Ladino". Um item roubado carrega, dali em diante, um UUID e um histórico de
posse (`item_instances`) — quem o possui, uma revista de guarda pode aprender
de quem era, mesmo que o item já tenha trocado de mãos várias vezes.

## 2. Problema que resolve

Sem isto, roubo era indistinguível de comércio: um item furtado e um item
comprado ocupavam a mesma linha (`character_inventory`), sem nenhum jeito de
provar proveniência. Um guarda revistando um suspeito só via "tem um anel",
nunca "este anel é do Balgruuf que foi roubado ontem".

## 3. Problemas que cria

- **Inventário deixa de ser 100% fungível** para o subconjunto de itens
  roubados: um item instanciado tem exatamente 1 unidade rastreada, e refurto
  precisa atualizar a MESMA linha (`item_instances`), não criar uma segunda —
  testado (`refurto atualiza a MESMA instancia e preserva original_owner_id`),
  mas é complexidade que não existia antes desta tarefa.
- **Duas fontes de estado por item**: a contagem em `character_inventory`
  (fungível) e o status em `item_instances` (proveniência) precisam
  concordar. Hoje eles concordam porque toda transição passa por
  `markItemStolen`/`markItemConfiscated`/`_restitute`, que sempre mexem nos
  dois na MESMA transação SQL — mas um código futuro que mexa em
  `character_inventory` diretamente (sem passar por `crime-service`) deixaria
  `item_instances` desatualizada em silêncio.
- **Anti-combat-log depende de um `setInterval`** (`sweep`, padrão
  `market-stalls-service.expireStalls`) — item roubado só é restituído na
  próxima varredura (`crime.sweepIntervalSeconds`, default 60s), não
  instantaneamente ao expirar a graça.

## 4. Exploits

- **Autorroubo para lavar proveniência**: um jogador poderia, em tese, pedir
  a um segundo personagem próprio para "confiscar" via revista fake — mas
  `governance.confiscateItem` exige `GUARD_CONFISCATE` de um cargo IC real
  (`hasPermission`, com `on_duty=1`), não uma ação de qualquer jogador contra
  si mesmo. Superfície de abuso é a mesma que qualquer poder de guarda já
  tinha antes desta tarefa (guarda corrupto/conluio) — não uma nova.
- **Roubo de alvo "rendido" à força**: `crime.surrender` é uma ação
  voluntária do próprio alvo (`TARGET_TYPES.SELF`) — ninguém pode forçar
  outro personagem a se render por este caminho. O outro gatilho de
  "roubável" é `RESTRAINED`/`DOWNED`, que já exigem uma ação anterior de
  quem algema (`GUARD_DETAIN`) ou de combate (`death-service`) — `crime.rob`
  não abre um vetor novo de forçar vulnerabilidade, só consome estados que já
  existiam.
- **Combat-log para "sumir" com item roubado**: é o vetor que a Tarefa 12
  já endereça (anti-combat-log + restituição). Contorno residual: se o
  ladrão ficar online até o item esfriar de `hot` para `stolen` (janela
  `crime.hotItemWindowMinutes`, default 30min) e SÓ ENTÃO deslogar, não há
  alerta de combat-log (`onCharacterDisconnected` só cria alerta para item
  `hot`) — o item fica `stolen` com o ladrão para sempre, a menos que uma
  revista de guarda o alcance primeiro. É uma escolha deliberada: a janela
  `hot` existe para dar tempo de reação de perseguição, não para tornar todo
  roubo eternamente reversível.
- **`holdId` de `crime.rob` vem do cliente**, sem resolvedor de "hold pela
  posição do jogador" (não existe neste projeto — ver §9). Um cliente
  malicioso poderia mandar um `holdId` errado; o pior caso é a Restituição
  Técnica devolver o item a um hold diferente do real (o dono original
  recupera o item, só que no depósito errado) — nunca perda de patrimônio,
  nunca criação de ouro/item.

## 5. Impacto econômico

Nenhuma criação/destruição de valor. Todo movimento de item passa por
`transaction-service.tx.applyStackDelta` (mesma primitiva de qualquer outra
transferência do projeto) — roubo, confisco e restituição são
redistribuições, nunca geração. O ledger (`inventory_transactions`) registra
as duas pernas de cada movimento, com `audit_logs.is_crime=1` adicional para
o que é especificamente crime — dois registros com propósitos diferentes
(fungível vs. proveniência), não duplicação.

## 6. Impacto político

O cargo `guard` (`governance-service.js`, já existente antes desta tarefa)
ganha uma ferramenta nova: a Revista Institucional agora informa
proveniência, não só a lista crua de itens. Isso desloca poder de fato para
quem já tinha `GUARD_SEARCH`/`GUARD_CONFISCATE` — nenhum cargo novo foi
criado, nenhuma permissão nova foi inventada.

## 7. Impacto militar

Nenhum direto. `RESTRAINED`/`DOWNED` como gatilhos de "roubável" significam
que o resultado de um combate (abater um oponente) ou de uma prisão
(algemar) agora também abre a possibilidade de saque pelo vencedor — não é
mecânica nova de combate, é consequência nova de um resultado que já existia.

## 8. Impacto religioso

Nenhum. Nenhuma facção/culto consultado por este sistema.

## 9. Impacto social

Alto, e é o ponto central do brief: "Ladino" vira identidade emergente de
quem rouba com frequência (o histórico fica em `item_instances.provenance_data`
e `audit_logs.is_crime`), não uma escolha de menu. Um personagem pode ser
"conhecido" como ladrão por RP acumulado (histórico de itens confiscados,
revistas anteriores), não por uma tag do sistema — nenhuma UI deste trabalho
rotula ninguém (ver §12/§13).

## 10. Impacto técnico

- `character-state.js` ganha `SURRENDERED` (estado de sessão, não durável —
  reseta ao desconectar, mesmo critério de `IN_TRADE`/`IN_CRAFT`).
- `crime-service.js` reusa três primitivas já existentes em vez de reimplementar:
  `transaction-service.tx.*` (movimento atômico de item), `depot-service`
  (restituição) e `TARGET_TYPES.SELF` (resolvedor já registrado por
  `character-dashboard-bridge.js`, Tarefa 11 — este trabalho não registra um
  segundo).
- **Animação de rendição é suposição não validada.** Não existe
  `animation-service.js` neste projeto (o brief presumia um que não foi
  construído em nenhuma tarefa anterior). `crime.surrender` reusa o mesmo
  primitivo Papyrus que `admin-service.playAnimation` já usa
  (`Actor.PlayIdle`) com um nome de idle (`IdleHandsForward`) que é
  **suposição, nunca confirmada em jogo** — mesma classe de ressalva que
  `core/interaction-targets.js` já registra para `locationalData`. A
  mudança de estado (`SURRENDERED`) é o que `crime.rob` de fato verifica; a
  animação é só o sinal visual e nunca bloqueia a rendição se falhar.
- **`holdId` não tem resolvedor de posição.** Nenhum código deste projeto
  traduz `locationalData`/célula do jogador em `hold_id` (ver §4). O campo é
  fornecido pelo cliente no schema de `crime.rob`, com default `'unknown'`.
  Gap conhecido, não escondido: o dia em que houver um resolvedor de
  hold-por-posição (para qualquer outro sistema), `crime-service.js` deveria
  passar a consultá-lo em vez de confiar no cliente.

## 11. Impacto narrativo

Alto. Prova de posse vira ferramenta de enredo: um PC pode reconhecer um
item de família confiscado de um estranho ("este anel era da minha avó!"),
uma investigação pode seguir a cadeia de proveniência (`provenance_data`)
para reconstruir por quantas mãos um item passou. Nenhuma dessas histórias é
gerada automaticamente pelo sistema — ele só torna a informação existente
pra quem quiser puxar o fio.

## 12. Como gera histórias

Este é o objetivo central pedido no brief (§ "Governança"). O mecanismo:
`getStolenInstancesHeldBy` devolve o NOME do dono original
(`originalOwnerName`), nunca um veredito ("ele é ladrão") — testado
explicitamente
(`crime-governance-integration.test.js`: "a mensagem deve nomear o dono
original... a UI não deve emitir veredito"). Isso muda o que uma revista
produz: em vez de uma acusação do sistema, produz um FATO
("este anel pertence a Balgruuf Pedra-Cinzenta") que o jogador do guarda
interpreta e age — pode prender, pode negociar, pode ignorar. A decisão
narrativa continua sendo do jogador, o sistema só entrega o dado verificável.

## 13. Como é abusado / como desencoraja RDM e Powergaming

- **RDM (Random Deathmatch) via `crime.rob`**: mitigado por construção —
  `crime.rob` só executa contra alvo `SURRENDERED`/`RESTRAINED`/`DOWNED`
  (`_isRobbable`, checado em `canSee`, `canExecute` E de novo dentro do
  `execute`, redundância deliberada — mesmo padrão do resto do Interaction
  Framework). Não existe caminho de roubar um alvo `NORMAL` sem que ELE
  tenha se rendido ou sido incapacitado por um sistema já existente
  (combate, algema). Um jogador não pode ser roubado "do nada".
- **Powergaming via roubo sem risco**: o item roubado carrega estado
  (`hot`) por uma janela configurável, durante a qual carregar o item é, em
  si, evidência (qualquer revista o revela). O ladrão não pode "esconder"
  proveniência lavando o item na hora — só o tempo (esfriar pra `stolen`,
  ainda sujo) ou uma revista/restituição resolve. Isso desencoraja roubo
  compulsivo sem plano de fuga/disfarce, porque o custo (ser pego com item
  quente) é maior logo depois do roubo.
- **Abuso de revista/confisco por guarda**: já mitigado pela infraestrutura
  de governança existente antes desta tarefa — `hasPermission` exige cargo
  real + `on_duty`, e toda ação de guarda já grava em `audit_logs`
  (`audit()` em `governance-service.js`). Esta tarefa não adiciona superfície
  nova de abuso de poder de guarda, só dados melhores para a mesma ação.

## 14. Como balancear

- `crime.hotItemWindowMinutes` (default 30) e `crime.combatLogGraceMinutes`
  (default 15) e `crime.sweepIntervalSeconds` (default 60) —
  `core/server-options.js`, ajustáveis sem redeploy.
- `ROB_RANGE` (150 unidades, `core/crime-service.js`) é constante de código,
  não server-option — geometria de contato próximo, mesmo critério de
  `DEPOT_INTERACT_RANGE`.
- Threshold de instanciação (decisão do dono do produto, Tarefa 12): só item
  roubado vira instância, nunca por valor. Ajustar isso pra incluir "valor
  alto" exigiria uma tabela de preço por `base_id` confiável, que não existe
  hoje — ver `core/crime-service.js`, cabeçalho.

## 15. Como integra ao mundo

Nasce com `ENABLE_CRIME_SYSTEM=false`, como todo módulo `lab` deste projeto.
Dependência OBRIGATÓRIA de `interaction` (precisa do framework de pé para
`crime.surrender`/`crime.rob` se registrarem); dependência OPCIONAL de
`depot` (restituição fica pendente, tentada de novo a cada varredura, se
`depot` estiver desligado — nunca impede o boot do `crime`). Não modifica
nenhum outro módulo `lab` além de acrescentar duas chamadas guardadas por
`moduleRegistry.isEnabled('crime')` em `governance-service.js` — um servidor
que nunca ligou `ENABLE_CRIME_SYSTEM` continua com a revista/confisco
funcionando exatamente como antes desta tarefa.

## Confirmado por teste, não confirmado em sessão real

25 testes em `core/crime-service.test.js` (unidade, banco mockado) + 4 em
`crime-governance-integration.test.js` (fluxo completo atravessando
`crime-service` + `governance-service` reais, só o banco é falso — mesma
técnica de `governance-service.hardening.test.js`) provam: rendição habilita
roubo, roubo transfere posse e cria/atualiza a instância na mesma transação,
refurto preserva o dono original, anti-combat-log resolve por retorno ou
restitui, revista aprende proveniência com nome (não veredito), confisco
rebaixa `hot`→`stolen` sem voltar a `clean`. Ninguém rodou isto num servidor
SkyMP real: a animação de rendição (§10) é suposição não validada, e
`TARGET_TYPES.PLAYER`/`SELF` contra atores de verdade carregam a mesma
ressalva que `core/interaction-targets.js` já registra para todo o resto do
Interaction Framework.

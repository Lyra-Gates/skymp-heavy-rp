# Ativação de Mobs Hostis — decisão

**Estado: ANÁLISE FECHADA, NADA IMPLEMENTADO.** Nenhuma linha de código foi
escrita nesta rodada, inclusive o campo de configuração que a Tarefa 3 do pedido
autorizava — ver §17, que explica por que não fazer era a decisão certa.

Análise conforme [`CONSTITUICAO.md`](../CONSTITUICAO.md) §15. Estende, e não
substitui, o [`NPC_POLICY_DECISION.md`](NPC_POLICY_DECISION.md): aquele documento
decidiu a política para NPCs em geral (Opção C — Vanilla Spawn Seletivo) e
deixou seis perguntas abertas na §5. Este responde a terceira delas —
*"Criaturas selvagens ficam ativas para caçadores?"* — e o formato segue o
[`SOUL_AFFINITY.md`](../design/SOUL_AFFINITY.md): os 15 pontos primeiro, o
desenho depois.

---

## Veredito primeiro

**Sim, criaturas hostis ficam ativas. Mas o pedido embute uma premissa falsa que
precisa cair antes de qualquer desenho: não existe nada para "ativar".**

O `npc-cleaner.js` hoje é inerte por construção — `blockedBaseDescs` está vazia,
e lista vazia significa "não remove nada". Ninguém nunca conectou (Fase 0). A
consequência é direta e nenhum documento deste repositório a registrou ainda:

> **O mundo provavelmente já está cheio de lobos, ursos e bandidos vanilla,
> ativos e hostis, agora.** Nunca desligamos nada. Nunca ninguém olhou.

Isso reordena a rodada inteira. "Reativação seletiva de spawn vanilla" descreve
um trabalho de *curadoria e governança de loot*, não de spawn. O primeiro passo
técnico não é escrever um ativador — é **olhar o mundo e contar o que já existe
lá**, que a Anexo A.1(b) da Constituição isenta do portão de 15 pontos porque é
validação do que já existe, não mecânica nova.

Três coisas mudam de forma em relação ao que o pedido presumia:

1. **Não há inversão do `npc-cleaner` a fazer.** `enable` só faz sentido para
   algo que nós desabilitamos. O ator vanilla já está lá, já é hostil, já ataca.
   Detalhado em §11.
2. **O gargalo real é o cadáver, não o spawn.** Loot vanilla nasce dentro do
   corpo, do lado do cliente, fora do `transaction-service` — o que é
   exatamente a fonte infinita que a §5 proíbe e a §11 impede. Se o servidor não
   conseguir controlar o inventário do cadáver, esta feature **não pode existir
   na forma pedida**. Detalhado em §10 e §16.
3. **Bandidos ficam fora da primeira rodada.** Não por lore — por economia e por
   papel social. Detalhado em §II.1.

E há uma pergunta técnica que ninguém deste projeto fez ainda e que decide se o
mundo é compartilhado ou não: **o Skyrim escala encontros ao nível do jogador. Se
o SkyMP herdar isso por cliente, dois jogadores lado a lado veem o mesmo lobo com
forças diferentes** — e realidade compartilhada é pré-requisito de Heavy RP, não
detalhe de balanceamento. §10.4.

---

# Parte I — Os 15 pontos

## 1. Objetivo

Dar ao mundo uma **fonte de acontecimento que não depende de pessoa nenhuma**.

O pedido veio como "vida ao mundo sem NPC interativo", e a formulação está
certa pelo motivo certo. NPC interativo — o que dá quest, o que vende, o que
conversa — é conteúdo autorado: alguém escreve, alguém mantém, e quando ninguém
escreve mais, ele para. Criatura hostil é o oposto: ela não tem roteiro, não tem
diálogo, não tem estado que a staff precise operar. Ela só **está lá**, e o fato
de estar lá muda o cálculo de todo mundo que passa por perto.

É o teste do Anexo A.2 da Constituição aplicado literalmente — *se a staff sumir
por uma semana, o mundo continua produzindo eventos?* Um urso na estrada de
Falkreath continua produzindo eventos no oitavo dia sem staff. É a mecânica mais
barata que este projeto tem disponível que passa nesse teste.

**Por que criatura hostil, e não outra coisa.** Havia três candidatos para
"encher o mundo sem NPC interativo":

| Candidato | Por que não é a resposta |
|---|---|
| Ambientação (fauna passiva, pássaros, cervos) | Não muda decisão nenhuma. Bonito e inerte — a §5 chama isso de sistema isolado. |
| Clima/eventos de mundo | É a §12, e é melhor. Mas exige o relógio fora do processo do Anexo A.6, que não existe. Caro, e depois. |
| **Criatura hostil** | Muda **rota, horário, companhia e equipamento** de quem joga. Custa quase nada porque já está no jogo base. |

O critério que separa os três é um só: **a mecânica altera uma decisão que o
jogador já tomava?** Só a terceira altera.

## 2. Problema que resolve

**2.1 — A estrada não custa nada.** Hoje ir de um Hold a outro é apertar W. Sem
risco de trânsito, não existe escolta, não existe caravana, não existe hora do
dia que importe, e não existe motivo para viajar acompanhado. O `economy-regional`
já modela preço por Hold e já supõe que mover mercadoria entre Holds é uma
atividade — mas **não existe nada que torne mover mercadoria difícil**, então a
diferença de preço regional é dinheiro de graça para quem tiver paciência.
Criatura hostil é o que transforma arbitragem regional em logística com risco.

**2.2 — A guarda só tem o jogador como inimigo.** O `governance-service` dá à
guarda prisão, fiança, mandado e registro criminal — tudo apontado para outros
jogadores. Um servidor onde o único trabalho do guarda é policiar gente faz do
guarda o antagonista estrutural da comunidade. Um mundo perigoso dá à guarda
trabalho que não é contra ninguém: patrulhar, escoltar, limpar uma trilha. Isso
é saúde de comunidade, não conteúdo.

**2.3 — A profissão de Caçador da Fase 4 não tem o que caçar.** O
`SKYMP_RP_DEVELOPMENT_PLAN.md` lista Caçador entre as profissões iniciais. Sem
criatura no mundo, "caçador" só pode ser implementado como um cronômetro que
paga — que é literalmente o "grind sem propósito" e o "dinheiro infinito" da §5.
Esta mecânica é o que permite que aquela profissão seja honesta.

**2.4 — Lugares não têm reputação.** Um mapa sem perigo é um mapa sem lugares —
só coordenadas. "Não passe do moinho depois do escurecer" é geografia com
significado, e ela nasce sozinha da primeira vez que alguém morre lá.

## 3. Problemas que cria

**3.1 🔴 Loot vanilla é uma torneira fora do ledger.** É o problema grave e está
em §10.2 e §16. Todo o resto é gerenciável; este é estrutural.

**3.2 🔴 O servidor não arbitra o combate — e agora o combate tem um terceiro
participante.** O `MODS_AND_GAMEMODE_CONTRACT` e o `core/hit-events.js` já
registram a regra dura: evento de combate vem do cliente e é *evidência, nunca
prova*. Enquanto o combate era só jogador-contra-jogador, isso era um problema de
arbitragem. Com mob no meio, vira um **vetor de lavagem de autoria**: o
`death-service` hoje comenta, textualmente, que "morte por NPC não é RDM". Um
lobo é, portanto, um álibi. §4.3.

**3.3 🟠 Zona segura não protege contra mob.** O `core/safe-zones.js` barra
*categorias de ação de jogador*. Ele não tem como barrar um urso, porque a IA do
urso roda no cliente e o servidor não aplica o dano dele. Uma "zona segura" com
um lobo dentro é uma zona segura que mente. §4.1.

**3.4 🟠 Morte por acidente ambiental num servidor com permadeath.** O
`rp.permadeathEnabled` existe e está desligado. Se um dia for ligado, um mob
tira do jogador um personagem de meses **sem cena, sem autor e sem processo** —
o que é a mesma família de problema que fez o conselho vetar a mordida com 70%
no `SOUL_AFFINITY.md` §3.1. Não é motivo para não ter mobs; é motivo para o
acoplamento entre as duas coisas ser decidido, não descoberto. §II.6.

**3.5 🟡 Frustração de logística.** Perder uma carga de peles para um urso a
duas células do destino é o tipo de perda que faz gente sair do servidor. O
`HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md` já rejeitou "loot total do corpo" por
esse motivo exato; a mesma lógica se aplica aqui e limita quão letal a primeira
versão pode ser.

**3.6 🟡 Densidade vanilla foi desenhada para um jogador.** O Skyrim povoa o
mundo para o Dovahkiin sozinho. Trinta pessoas na mesma estrada encontram o
mesmo urso trinta vezes por hora, ou nunca, dependendo do reset de célula — e
nenhum dos dois é o que queremos. É o problema que só o censo da §16 resolve.

## 4. Exploits

### 4.1 Kite de mob para dentro de zona segura ou de área de outros jogadores

**Funciona, e o servidor não tem como impedir.** Não há caminho técnico: o mob
segue o jogador porque a IA dele decidiu isso na máquina do jogador, e o
`safe-zones.js` não tem verbo para "impedir que aquele ator ande até aqui".

Três respostas, nenhuma delas "bloquear":

1. **Zona segura é lugar onde mob não entra por construção.** Interior de
   cidade, templo, taverna — células separadas, para onde criatura selvagem não
   navega no vanilla. A curadoria da §II.1 nunca inclui um record cujo território
   toque uma célula de zona segura. Isso é decisão de lista, não de código.
2. **Kite é ato, e ato tem rastro.** O `hit-events` já registra jogador→ator, e
   um ator não-jogador entra nesse registro como alvo com `characterId: null`.
   Um jogador que bateu num urso 20 segundos antes de o urso matar alguém está no
   `audit_logs`, sem código novo. §4.3 fecha isso.
3. **É crime tipificável, não bug.** Puxar fera para cima de terceiro é a versão
   ambiental do assassinato, e o `governance-service` já tem `criminal_records`
   com crime, fiança e Hold. Vira processo de guarda, que é história; não vira
   regra de servidor, que não é.

**O que não fazer:** inventar "raio anti-kite" ou teleporte de mob de volta. É
enforcement do que o servidor não controla, e o custo de errar (o mob some na
cara de todo mundo numa cena) é maior que o do abuso.

### 4.2 Farm de respawn previsível

**A resposta não é mexer no respawn — é que não existe o que farmar.**

Três camadas, nenhuma nova:

- **Sem ouro no loot, nunca.** A tabela da §II.4 tem material e só. Ouro de mob
  é a "dinheiro infinito" da §5, sem rodeio.
- **A economia já pune o volume.** O `economy-regional` faz o preço de venda
  cair conforme o estoque do Hold sobe. Trezentas peles de lobo em Whiterun
  valem menos que trinta, automaticamente, hoje, sem escrever nada. Este é o
  mecanismo §11-nativo: a escassez é o que dá valor, e destruí-la se pune
  sozinho.
- **O ledger é o teto.** `inventory_transactions` já grava `reason`, `module` e
  `idempotency_key`. Um teto de rendimento por personagem/tipo/janela é uma
  consulta ao ledger que já existe — nunca um contador em memória, que some no
  restart.

**O que fica sem resposta em v1:** o respawn vanilla é por reset de célula e não
está sob nosso controle. Ele é *previsível* e nós aceitamos isso, porque a
previsibilidade só vira exploit se o prêmio compensar — e com material de preço
elástico, não compensa. Se compensar, a correção é por **ausência de jogador**
(o mesmo `safeRadius` invertido), nunca por relógio: relógio é justamente o que
cria a rotação farmável.

### 4.3 Mob como álibi de RDM

O cenário: João quer matar Pedro. João puxa um urso para cima de Pedro, ou bate
em Pedro com o urso por perto. Pedro morre. `mp.onDeath` entrega
`killerId = <urso>`. O `death-service` registra um assassino sem `characterId`, e
o próprio comentário do arquivo diz que isso já é informação — *"morte por NPC não
é RDM"*.

**É o exploit mais perigoso da lista**, porque não é mecânico: é uma defesa
pronta e verossímil numa arbitragem.

**Mitigação, inteiramente com o que existe:** quando `killerId` resolve para um
ator sem personagem ativo, o registro de morte deixa de ser suficiente e passa a
exigir três coisas no mesmo `audit_logs`:

| Sinal | De onde vem hoje |
|---|---|
| Quem estava por perto | `logDeathContext` (já grava) |
| Quem bateu no morto pouco antes | `combat:episode` do `hit-events` (já grava) |
| **Quem bateu no mob pouco antes** | mesmo `combat:episode`, com `alvo = actorId do mob` — já é gravado e ninguém lê |

O terceiro é o que fecha o álibi, e ele **já está sendo coletado**. O que falta é
apenas a decisão de que "morte por mob" abre um registro enriquecido em vez de
encerrar a investigação. Nenhuma coleta nova, nenhum polling novo.

**Limite honesto:** isso continua sendo evidência de origem-cliente, e a
`CONTRIBUTING.md` §3.6 vale igual. Serve para a staff arbitrar; não serve para o
servidor punir sozinho, e não deve tentar.

### 4.4 Loot lavando origem de item

Duas direções, e a perigosa é a inversa da que o pedido supunha.

- **Loot como origem falsa** (dizer que um item duplicado "veio de um lobo").
  Fechado pela tabela fixa: se um `base_id` não está na tabela de nenhuma
  criatura, ele **não pode** entrar com `reason='hunt_loot'`. É invariante
  testável, e o teste vem antes do serviço.
- **O cadáver como origem nenhuma** — o caso real. Item retirado do corpo
  vanilla pelo cliente entra no inventário do jogador **sem passar pelo
  `transaction-service`**, portanto sem linha no ledger, sem `reason`, sem
  origem. Não é lavagem: é dinheiro sem cunhagem. É o §3.1, e é por isso que a
  §16 coloca a prova do cadáver antes de tudo.

### 4.5 Duplicação por evento de morte repetido

`mp.onDeath` nunca disparou numa sessão real deste servidor — o `death-service`
mantém polling justamente porque o hook não foi confirmado. Se ele disparar duas
vezes para o mesmo ator (ressurreição, sincronização, reconexão), o loot é
concedido duas vezes.

**Fechado de graça:** `idempotencyKey` do `transaction-service` derivada do
`actorId` do mob + do evento de morte. A segunda chamada vira um skip logado. O
mecanismo já existe e já é usado.

## 5. Impacto econômico

### 5.1 O caminho obrigatório

**Todo item de loot passa por `core/transaction-service.giveItem`.** Sem exceção
e sem caminho alternativo — é a mesma regra que apagou o `economy-service` e que
o `crafting-service`, o `market-stalls-service` e o `/additem` já cumprem. Cada
concessão carrega:

```
reason  = 'hunt_loot'
module  = 'hunting'
idempotencyKey = <actorId do mob>:<evento de morte>
```

e o `audit_logs` guarda, na mesma janela, qual `baseDesc` de criatura gerou
aquilo e quem matou (`killerId`). **"Nada nasce do nada"** da §11 passa a ser
verificável por consulta, e não por confiança: dá para perguntar ao banco quantas
peles de lobo existem no servidor e de quantos lobos elas vieram.

### 5.2 Reforça o caçador, não compete com ele

A distinção que faz a diferença: **o mob é a fonte bruta, o caçador é a cadeia.**

```
criatura morta → matéria bruta (pele crua, carne crua, osso)
   → curtidor / açougueiro / alquimista  ← aqui mora a profissão
      → couro, provisão, componente
         → ferreiro, taverna, alquimia
```

Se o lobo largasse couro pronto, o curtidor não existiria. Largando pele crua, a
§11 se cumpre sozinha — *toda cadeia tem gargalo* —, e o gargalo é uma pessoa,
que é o que Heavy RP quer. É o mesmo raciocínio que o `SOUL_AFFINITY.md` §3.4
usou para encantamento.

### 5.3 O que o loot nunca contém

| Nunca | Por quê |
|---|---|
| **Ouro** | §5, "dinheiro infinito". Direto. |
| **Arma e armadura** | Arsenal grátis mata o ferreiro antes de ele nascer. É metade do motivo de bandido ficar fora da v1 (§II.1). |
| **Item encantado ou pedra de alma** | A §10 da Constituição exige que encantado seja raro e tenha assinatura. Mob largando Soul Gem é a produção infinita que ela proíbe. |
| **Poção, pergaminho, receita** | Compete com alquimista e com o `crafting-service`. |
| **Qualquer `base_id` fora da tabela** | Invariante da §4.4. |

### 5.4 Risco econômico assumido

Material barato e abundante desvaloriza o trabalho de quem produz o mesmo
material por outro caminho. Não é hipotético: se pele de lobo vira comum, o
criador de gado (se um dia existir) nasce morto. **Mitigação:** o rendimento por
criatura é baixo e o teto por janela existe desde a v1 (§II.4). Preferimos errar
para o lado escasso — escassez a mais se corrige mexendo num número; inflação já
distribuída não se recolhe.

## 6. Impacto político, militar, religioso e social

### 6.1 A cadeia

A §12 exige que nada seja evento desconectado. A cadeia desta mecânica, aplicada
e não copiada:

> **Lobos ativos na trilha entre dois Holds** → mercador perde carga → mercador
> passa a contratar escolta → **escolta vira serviço pago entre jogadores**,
> sustentado sem staff → quem não paga escolta chega mais barato e às vezes não
> chega → o preço daquela mercadoria naquele Hold sobe (o `economy-regional` já
> faz isso) → moradores cobram do Jarl → **patrulhar custa do tesouro do Hold**,
> que sai do `tax_rate` que já existe → o Jarl escolhe entre subir imposto,
> desguarnecer outra estrada, ou não fazer nada → **cada uma das três escolhas
> cria um inimigo político diferente** → e o mercador que perdeu a carga vira
> financiador de quem se opõe ao Jarl.

Nada nessa cadeia precisa de staff, e cada elo já tem tabela ou serviço no
repositório.

### 6.2 Militar

**Guarda deixa de ser só polícia.** Ver §2.2. Além disso, "quantos guardas
patrulham a estrada" vira uma decisão com custo e consequência mensurável —
substrato para disputa de cargo que hoje é só conversa. E "o Hold consegue
defender a própria estrada?" é uma pergunta que a facção rival pode responder
por sabotagem: parar de patrulhar é uma arma.

### 6.3 Religioso — e a honestidade de dizer que é fraco

**Este é o eixo mais fraco dos quatro, e inventar força aqui seria desonesto.**
Um lobo não tem teologia.

O que existe de verdade é indireto e vale registrar sem inflar: o ponto de
respawn do servidor **já é o Templo de Kynareth** (`death-service`,
`RESPAWN_CELL = 0x162e2`). Num mundo sem perigo, aquele templo é cenário. Num
mundo com perigo, é o lugar por onde todo mundo passa depois de errar — e lugar
por onde todo mundo passa é onde instituição se constrói. O templo ganha
frequência, não doutrina; a doutrina é dos jogadores.

Hircine e a caça como devoção existem na lore e conversam com a afinidade
Bestial do `SOUL_AFFINITY.md`. **Ficam fora da v1 de propósito** — é conteúdo
narrativo, e a v1 é fauna, não religião.

### 6.4 Social

- **Empurra as pessoas a andarem juntas**, que é o loop central de Heavy RP e o
  mesmo efeito que o `SOUL_AFFINITY.md` §II.5 procura por outro caminho.
- **Cria hierarquia informal por competência**, não por cargo: quem conhece a
  trilha, quem sabe atravessar de noite.
- **Risco real, e não pequeno:** perigo ambiental empurra gente para o combate
  mecânico, e combate mecânico é o oposto do que Heavy RP vende. Se matar lobo
  virar o que se faz no servidor, a mecânica venceu o servidor. É o critério de
  abortar da §16.

## 7. Impacto técnico

O Anexo A.5 é o texto que este ponto tem que encarar: ator é caro, ida ao Papyrus
custa 13–35 ms, e já existem serviços a 2 s competindo pelo frame. Aplicado a
combate, e não a economia, o quadro é melhor do que o aviso sugere — e pior num
lugar que o aviso não previu.

### 7.1 Onde o custo *não* está

| Peça | Onde roda | Custo no nosso frame |
|---|---|---|
| Spawn da criatura | Motor do Skyrim, listas vanilla | **zero** — não spawnamos |
| IA de combate, perseguição, fuga | Cliente | **zero** |
| Cálculo de dano | Cliente | **zero** |
| Detecção de morte | `mp.onDeath`, hook do servidor | **zero de polling** — é evento |
| Concessão de loot | Node + MySQL, assíncrono | fora do caminho do frame |

**A conclusão de desenho, e ela é dura:** *ativação de mobs hostis não pode
adicionar nenhum timer novo.* Se o desenho da próxima rodada precisar de um
`setInterval`, o desenho está errado. A economia de NPC do Anexo A.5 precisava
simular; mob hostil não precisa — o jogo base já simula, e nós só escutamos o
final.

### 7.2 Onde o custo *está*, e o A.5 não previu

**Sincronização, não Papyrus.** Cada ator ativo é estado que o servidor
sincroniza com todo cliente por perto. Não paga 13–35 ms, mas paga banda e CPU de
sincronização, e **escala com densidade × jogadores**, que é justamente a
variável que ninguém mediu porque ninguém conectou. É a incógnita número um, e
o censo da §16 é o instrumento.

**`mp.onDeath` muda de regime.** Hoje o hook dispara raramente — só jogador
morre. Com fauna ativa, ele dispara constantemente. O handler atual chama
`commands.getActiveCharacterData(actorId)` e sai cedo quando não é jogador; isso
é barato **hoje**. Requisito duro para a próxima rodada: **o caminho de morte de
mob tem que ser O(1) e não pode tocar o banco antes de decidir que é um mob que
nos interessa.** Consulta ao banco em hook de alta frequência é o mesmo erro do
A.5 com outra roupa.

**O `npc-cleaner` é o único laço que escala com a quantidade de mob.** A
varredura é O(NPCs × jogadores) a cada 60 s. As distâncias são leitura de
property (cache do servidor, não Papyrus — o `safe-zones.js` documenta essa
distinção), então é CPU em Node e não ida ao motor. Ainda assim, se a lista de
bloqueio um dia for preenchida e o mundo tiver muito mais atores, este é o
arquivo que sente primeiro.

### 7.3 O segundo consumidor de `mp.onDeath` — e um gatilho já escrito

Hoje `death-service.initDeathService()` faz `mp.onDeath = ...`, o que é
**posse exclusiva do hook**. Um segundo consumidor sobrescreve o primeiro em
silêncio, e a falha é a pior possível: morte de jogador para de ser detectada
pelo caminho primário e ninguém percebe, porque o polling de rede de segurança
disfarça com dois segundos de atraso.

O `core/module-registry.js` já escreveu, em 06/08/2026, a condição exata para
reabrir esse assunto:

> *"O gatilho para reabrir isto (…): um segundo módulo que precise de um evento
> de jogo já capturado por outro."*

**Mobs hostis é a primeira coisa deste projeto que atende esse gatilho.** Quando
a implementação chegar, o desenho já está escrito lá: `descriptor.on = { death:
fn }` opcional no `register()`, despachado de onde o evento já é capturado. Não
é infraestrutura especulativa — é a condição prevista se realizando.

### 7.4 ⚠️ A pergunta que decide se o mundo é compartilhado

O Skyrim vanilla **escala encontros ao nível do jogador**. Um lobo perto de um
personagem novo e o "mesmo" lobo perto de um veterano não são a mesma criatura.

Se o SkyMP herdar isso por cliente, então dois jogadores lado a lado veem forças
diferentes no mesmo ator, e "socorri você contra o urso" deixa de ser uma frase
com sentido único. **Isso não é balanceamento; é realidade compartilhada, que é
pré-requisito de Heavy RP.**

Não sabemos a resposta. Ninguém deste projeto perguntou. É item de Fase 0 e está
na §16, e **se a resposta for "escala por cliente", a decisão desta rodada precisa
ser revista** — porque nesse caso escala uniforme não é uma escolha nossa, é uma
impossibilidade.

### 7.5 Procedência das APIs

Marcado no padrão do `types/mp.d.ts` (`CONTRIBUTING.md` §11):

| API | Procedência | Estado |
|---|---|---|
| `mp.onDeath(actorId, killerId)` | **[DOC]** — `misc/tests/test_isdead.js` upstream, tipado em `mp.d.ts` | Nunca disparou em sessão real deste servidor |
| `mp.getActorsByProfileId(0)` | **[USO]** — usado pelo `npc-cleaner` | Nunca rodou com jogador conectado |
| `mp.get(id,'inventory')` / `mp.set(id,'inventory',…)` | **[DOC]** — `SKYMP_UPSTREAM_REFERENCE.md` §2.5. **Não está no `mp.d.ts`** | Nunca exercitado. **É a incógnita que decide a feature** (§16) |
| `mp.createActor(profileId,…)` | **[DOC]** — mesma fonte, também ausente do `mp.d.ts` | Não usamos, e a v1 não usa: não spawnamos nada |

## 8. Impacto narrativo

O princípio máximo da §4 é *"como isso gera novas histórias?"*, e a resposta aqui
não é "dá o que fazer" — é mais específica e mais barata:

> **Perigo transforma coordenada em lugar, e lugar é o gerador de história mais
> barato que existe.**

Um mapa sem risco não tem lugares: tem pontos entre os quais se anda. Quando a
ponte ao norte mata alguém, ela vira "a ponte". Ninguém escreveu isso, ninguém
mantém, e continua verdade no oitavo dia sem staff. E o efeito é composto: cada
morte adiciona significado ao mesmo lugar, sem nenhum sistema de reputação de
território.

O segundo efeito: **o mob dá ao jogador uma desculpa para precisar de outro
jogador** sem que nada force cooperação. Contratar escolta, viajar em grupo,
esperar amanhecer — são decisões que o jogador toma sozinho e que produzem cena.

O terceiro, e é o mais valioso: **cria o fracasso sem culpado.** Todo drama que
este servidor pode produzir hoje tem um jogador do outro lado, o que significa
que todo fracasso é uma queixa em potencial. A carga perdida para um urso é a
primeira desgraça do servidor que não é culpa de ninguém — e desgraça sem
culpado é onde alianças nascem, porque não há ninguém para odiar.

## 9. Como gera histórias

- A estrada que ficou perigosa, e a rota alternativa que enriqueceu um vilarejo
  que ninguém visitava.
- O primeiro nome que o servidor inteiro sabe que morreu para um urso.
- O contrato de escolta que foi honrado; o que não foi.
- O caçador que abasteceu um Hold no inverno e cobrou caro por isso, e a
  discussão política sobre se aquilo foi comércio ou extorsão.
- O guarda que morreu patrulhando uma trilha que o Jarl mandou desguarnecer, e o
  que isso fez com a reputação do Jarl.
- O acampamento de bandidos que virou ponto de referência antes de virar alvo —
  quando entrar (§II.1).
- O grupo que descobriu que atravessar de noite é diferente, e vendeu essa
  informação.

## 10. Como é abusada

Consolidando a §4 e nomeando o que fica sem defesa:

| Abuso | Defesa | Suficiente? |
|---|---|---|
| Kite para zona segura | Curadoria de lista + registro + tipificação | **Parcial.** Não há bloqueio técnico e não deve haver. §4.1 |
| Kite como arma (RDM lavado) | `killerId` + episódios de hit contra o mob | **Boa, e já coletada.** Depende de a staff ler. §4.3 |
| Farm de material | Sem ouro + preço elástico + teto no ledger | **Boa**, e a maior parte já existe. §4.2 |
| Loot fora do ledger (cadáver vanilla) | **Nenhuma ainda** | 🔴 **É o bloqueador.** §16 |
| Loot com origem falsa | Tabela fixa como invariante testável | Boa. §4.4 |
| Duplicação por evento repetido | `idempotencyKey` | Boa, mecanismo existente. §4.5 |
| Mob puxado para dentro de cena de RP alheia | Nenhuma técnica | Regra de comunidade, não de código |

**A honestidade que a §17 exige:** a linha vermelha é a quarta, e ela não é um
detalhe de implementação. **Se o servidor não puder controlar o inventário do
cadáver, esta feature não existe na forma pedida** — ou o loot desaparece do
desenho (a mecânica vira ambientação perigosa e nada mais), ou a §11 é violada.
Não há terceira saída, e essa decisão pertence ao dono do projeto, não a esta
análise.

## 11. Como integra ao mundo — reaproveita o `npc-cleaner` ou é serviço novo?

**Reaproveita a configuração e a curadoria. Não reaproveita o serviço. E não
existe "ativador" para escrever.**

O mesmo padrão de raciocínio que eliminou o `disguise-service` por duplicar o
`identity-service` com a estrutura errada, aplicado aqui:

### 11.1 Por que inverter o `npc-cleaner` não produz nada

O `npc-cleaner` é um **supressor**: varre, compara com a lista de bloqueio, e
chama `disable` no que está longe de jogador. Inverter isso seria chamar `enable`
— e `enable` só tem sentido para algo que **nós** desabilitamos.

Não desabilitamos nada. `blockedBaseDescs` está vazia, e a lista vazia é inerte
por construção. **Os lobos vanilla já estão lá, já são hostis e já atacam.** Um
"ativador" seria um serviço que percorre o mundo chamando `enable` em atores que
nunca foram desligados: código que não faz nada, com um nome que promete que faz.

Isto é o oposto exato do defeito do `safeRadius` original — lá havia um comentário
descrevendo um recurso que não estava escrito; aqui haveria um recurso escrito
descrevendo um trabalho que não existe. Mesma classe de mentira, direção inversa.

### 11.2 O que de fato se compartilha: o vocabulário de curadoria

Isto sim é real, e é o motivo de a resposta não ser "serviço totalmente novo":

- **`baseDesc`, nunca FormID numérico** — `"1a6a0:Skyrim.esm"`. O contrato de
  FormID do `MODS_AND_GAMEMODE_CONTRACT.md` §3 vale igual, pelo mesmo motivo: o
  primeiro byte é índice de load order.
- **Lista vazia = inerte.** O modo de falha aponta para o lado seguro. É a mesma
  disciplina do `safe-zones.js`.
- **Proximidade de jogador** (`safeRadius` + `core/range-utils`) como primitiva
  de "não faça isso na cara de ninguém".
- **Um arquivo de política, não dois.** Duas listas de curadoria de NPC em
  arquivos diferentes acabam se contradizendo, e a contradição é silenciosa.
  Quando a lista de escopo de caça existir, ela mora em `npc-policy.json`, ao
  lado de `blockedBaseDescs`.

### 11.3 O que é serviço novo, e por quê

O que precisa ser escrito não é ativação — é **o que acontece quando um mob
morre**. Isso é um consumidor de `mp.onDeath`, não um varredor de mundo. Nada no
`npc-cleaner` se parece com isso: ele não escuta evento, não fala com o banco,
não conhece o `transaction-service` e não tem nada a ver com item. Enfiar
concessão de loot lá dentro acoplaria duas coisas cujo único parentesco é
"mexem com NPC".

Nome provisório: `hunting-service`. Módulo próprio, `enabledBy:
'ENABLE_HUNTING_SERVICE'`, fase `lab`, desligado por padrão — o padrão do
`module-registry` que o `soul-service` já segue.

### 11.4 Morte de mob passa pelo `death-service`?

**Não. Pipeline separado, mesmo hook.**

O `death-service` é inteiramente sobre a morte *do jogador*: `DOWNED`, janela de
socorro de quatro minutos, bleed-out, penalidade de ouro, permadeath, aposentar
personagem, evidência de RDM. Um lobo não tem `characterId`, não tem ouro, não
tem estado em `core/character-state.js`, não pode ser socorrido e não pode ser
aposentado. Passar mob por lá significaria uma guarda de nulo em cada uma dessas
etapas, dentro de um arquivo cujo assunto inteiro é outro — e é assim que um
serviço coeso vira um serviço "de morte em geral" que ninguém entende.

O que os dois compartilham é **a fonte**, não o processamento: `mp.onDeath`. A
integração correta é o despacho da §7.3.

### 11.5 Onde encosta no resto

| Sistema existente | Ligação |
|---|---|
| `core/transaction-service` | **Caminho único** de todo item de loot. Sem exceção |
| `inventory-service` | Reconciliação no login vale igual — loot é item como outro qualquer |
| `npc-policy.json` | Mesma curadoria, mesmo formato `baseDesc`, mesmo arquivo |
| `mp.onDeath` / `death-service` | Fonte compartilhada, pipelines separados (§11.4) |
| `core/hit-events.js` | Já coleta o golpe jogador→mob que fecha o álibi da §4.3 |
| `core/safe-zones.js` | Não protege contra mob (§3.3). Restringe a **lista**, não o comportamento |
| `economy-regional.js` | Absorve o material e pune o excesso sozinho (§4.2) |
| `governance-service` | Kite intencional é crime tipificável, com `criminal_records` |
| Profissão de Caçador (Fase 4) | Esta mecânica é o que a torna honesta (§2.3) |
| `SOUL_AFFINITY.md` | **Nenhuma ligação na v1**, e é decisão explícita — §II.4 |

## 12. Como balancear

Princípio: **errar para o lado escasso e para o lado ameno.** Densidade a menos
se corrige mexendo num número; um servidor que virou matadouro no primeiro mês
não se recupera mexendo em número nenhum.

| Eixo | v1 | Por quê |
|---|---|---|
| **Densidade** | Vanilla, intocada | Não sabemos o número real. O censo (§16) precede qualquer ajuste |
| **Nível** | Vanilla, sem escala nossa | §II.3 — e a incógnita da §7.4 pode tornar isso não-escolha |
| **Respawn** | Vanilla (reset de célula) | §II.2 — não temos o que respawnar |
| **Letalidade** | Vanilla, mediada pelo `death-service` | Já há socorro de 4 min e bleed-out. Mob não deve ter caminho de morte próprio |
| **Rendimento de loot** | Baixo, fixo, material puro, teto por janela | §II.4 |
| **Distância de cidade / zona segura** | Por curadoria de lista, não por raio | §4.1 — o raio é ilusão de controle |

**O botão que ficou de fora de propósito:** nenhum ajuste de dano, vida ou
resistência de criatura. O servidor não arbitra golpe (`MODS_AND_GAMEMODE_CONTRACT`,
e o `SOUL_AFFINITY.md` §7 já registrou o mesmo limite para afinidade marcial).
Mexer nisso exigiria plugin próprio, e plugin próprio não é conversa de v1.

## 13. Como integra ao mundo

Respondido em §11 (integração técnica) e §6 (integração ficcional). O resumo em
uma frase, que é o teste do Anexo A.2:

> A staff some por uma semana; os lobos continuam na estrada, as caravanas
> continuam contratando escolta, o preço continua subindo no Hold que perdeu a
> rota, e o Jarl continua sendo cobrado por isso.

## 14. Alternativas consideradas e recusadas

A §14 da Constituição exige o passo "criar alternativas · comparar · escolher",
e ele não pode ser implícito.

| Alternativa | Por que não |
|---|---|
| **Sistema de spawn customizado** (`mp.createActor` em pontos nossos) | Já recusado pela direção do projeto, e a análise concorda: paga custo de ator, exige um relógio que o Anexo A.6 diz que não deve viver aqui, e joga fora as listas de encontro e o balanceamento geográfico que a Bethesda já autorou |
| **Ambientação sem loot** (mob existe, nada cai) | Passa a §11 trivialmente e é bem mais barato. Recusado porque deixa a profissão de Caçador (§2.3) sem cadeia, e porque perigo sem retorno nenhum é só imposto sobre andar. **Mas é o plano B honesto se a prova do cadáver falhar** (§10) |
| **Loot por comando de RP** (`/esfolar` concede pelo servidor) | Sobrevive mesmo sem controle do cadáver — mas cria dois inventários de verdade (o do corpo e o nosso) e o jogador nota a diferença na primeira hora. Fica como plano C, e é o desenho a considerar se a §16 der resposta ruim |
| **Só criaturas passivas** (cervo, coelho) | Alimentaria a cadeia sem nenhum dos riscos. Recusado porque não altera decisão nenhuma (§1) — é o "sistema isolado" da §5 |

## 15. Estado de validação — o que desta análise é fato e o que é hipótese

A honestidade que o `SOUL_AFFINITY.md` §III.13 e o `hit-events.js` estabeleceram
como padrão da casa:

| Afirmação | Estado |
|---|---|
| `npc-cleaner` é inerte hoje | **Fato** — lido no código, `blockedBaseDescs` vazia |
| Loot deve passar pelo `transaction-service` | **Fato** — regra do projeto, sem exceção |
| `mp.onDeath` existe e traz `killerId` | **[DOC]** — nunca disparou aqui |
| `hit-events` já registra golpe contra ator sem personagem | **Provável** — o código não filtra por personagem, mas o snippet de cliente nunca rodou |
| **Criaturas hostis vanilla já estão ativas no mundo** | 🟡 **Hipótese.** É a inferência central deste documento e ela **não foi verificada** — é o item 1 da §16 |
| Servidor consegue controlar inventário de cadáver | 🔴 **Desconhecido.** É o item 2 da §16 |
| Encontros escalam por jogador ou por servidor | 🔴 **Desconhecido.** É o item 3 da §16, e pode invalidar a §II.3 |

---

# Parte II — Decisão de escopo

## II.1 Quais criaturas entram na primeira rodada

**Entram: fauna hostil comum.** Lobo, urso, skeever, mudcrab, lince, aranha
gigante — o que o vanilla já coloca na estrada e na floresta.

**Ficam de fora nesta rodada, com motivo:**

### Bandidos — fora, e não é por lore

Recusa deliberada, contrariando o exemplo que o pedido sugeria, por três razões
que se somam:

1. **O loot deles é exatamente o que a §5.3 proíbe.** Bandido carrega arma,
   armadura e ouro. Um acampamento é um arsenal grátis, e ferreiro e mercador
   morrem antes de nascer.
2. **Ele ocupa um papel que deveria ser de jogador.** O `NPC_POLICY_DECISION.md`
   §3 já decidiu remover NPC que "compete com papéis que deveriam ser de
   jogadores". Salteador de estrada é um dos papéis mais férteis que este
   servidor tem para oferecer, e preenchê-lo com IA é gastá-lo.
3. **Matar humanoide levanta a pergunta jurídica; matar lobo, não.** Bandido é
   gente. Executar gente na estrada aciona o `governance-service` — é crime, ou
   não é? Quem responde? Essa conversa é grande e não precisa entrar junto.

*Um lobo é clima. Um acampamento de bandidos é conteúdo.* A v1 quer clima.

### Draugr, Falmer, Dwemer, vampiros, aparições — **pergunta em aberto, não decidida aqui**

Não é chamada desta análise, conforme o próprio pedido. O que registro para quem
decidir:

- **Draugr** toca funerária e religião nórdica. Uma cripta ativa transforma cada
  túmulo do mapa em masmorra, e "masmorra" é uma decisão de gênero do servidor,
  não de curadoria.
- **Falmer** carrega a história Dwemer/Snow Elf e implica Blackreach e
  Dwemer ruins junto.
- **Vampiro e lobisomem** colidem de frente com o `SOUL_AFFINITY.md`, onde
  vampirismo é etapa 5 de uma trilha e o documento é explícito: *nunca liberar
  antes de consentimento e processo estarem implementados*. Criatura vampírica
  vanilla no mundo, mordendo jogador, atropela isso inteiro.
- **Dragão** fica fora e isto **é** decisão: dragão é evento de servidor, não
  ambiente. Ambiente é o que não precisa de ninguém; dragão precisa.

**Encaminhamento:** aprovação de staff/narrativa em rodada separada, depois que a
fauna provar que a mecânica se sustenta.

## II.2 Respawn: por tempo, por ausência, ou os dois?

**Nenhum dos dois na v1 — porque não temos o que respawnar.**

Não spawnamos nada, logo não há respawn nosso. O que existe é o reset de célula
do vanilla, e nós não o tocamos.

Isso é uma escolha, não uma omissão: acrescentar controle de respawn seria o
primeiro passo para o sistema de spawn customizado que a direção já recusou.

**Se a v1 mostrar que precisa de controle** — porque a densidade ficou errada ou
porque uma rotação farmável apareceu — a direção é **por ausência de jogador**, com
o mesmo `safeRadius` que o `npc-cleaner` já usa, e **nunca por relógio**. Relógio
é o que cria a rota farmável; ausência é o que impede que alguém veja algo
aparecer do nada, que é o motivo pelo qual o `safeRadius` existe.

## II.3 Nível e escala por região

**Uniforme na v1 — no sentido de "não mexemos".** O vanilla já entrega
diferenciação geográfica: um lobo perto de Riverwood e um urso perto de Falkreath
não são a mesma ameaça. Isso é balanceamento autorado, coerente com a lore, de
graça, e recusá-lo para escrever o nosso seria construir o sistema customizado
que já foi recusado.

⚠️ **Com a ressalva da §7.4, que pode anular esta decisão.** Se o SkyMP herdar a
escala vanilla **por jogador**, "uniforme" não é uma escolha nossa — é uma
impossibilidade, e o mundo deixa de ser compartilhado. Esta decisão está
condicionada à resposta do item 3 da §16.

## II.4 Como o loot é decidido

**Tabela fixa por tipo de criatura. Não puxa da Afinidade da Alma, e a recusa é
explícita.**

Três motivos, todos ancorados no que já foi decidido:

1. O `SOUL_AFFINITY.md` §III.14 **excluiu afinidade marcial do v1**, com o
   motivo exato que vale aqui: o combate é do cliente e o servidor não arbitra
   golpe. Loot de caça variando por alma seria afinidade marcial entrando pela
   porta dos fundos.
2. **Não existe atributo de sorte ou de raridade** nas quatro afinidades
   (arcana/divina/sombria/bestial) nem nos três traços (vontade/sensibilidade/
   estabilidade). Usar qualquer um deles para quantidade de loot seria dar-lhe um
   significado que o desenho fechado não lhe deu.
3. O pedido pediu explicitamente para não inventar um sistema de raridade novo se
   não for preciso. Não é preciso.

**Forma da tabela** (contrato, não implementação):

```
por baseDesc de criatura:
  itens: [{ baseId, min, max }]   // material bruto, só
  tetoPorJanela: n                // por personagem, por tipo, verificado no ledger
```

Regras que a tabela carrega:

- **Material bruto apenas.** Nunca ouro, arma, armadura, encantado, Soul Gem,
  poção ou receita (§5.3).
- **`baseId` fora da tabela não pode entrar com `reason='hunt_loot'`.** Invariante
  testável, e o teste vem antes do serviço (§4.4).
- **Rendimento pequeno.** Errar para o lado escasso (§12).
- **Teto verificado no ledger**, nunca em memória (§4.2).
- **Idempotência por morte** (§4.5).

**Para depois, e não agora:** a afinidade Bestial pode um dia dar *sinal
narrativo* na caça — no sentido do `SOUL_AFFINITY.md` §II.1, um sinal que o
personagem sente. Nunca quantidade. Fora da v1.

## II.5 Densidade e distância de área segura

Por curadoria de lista, não por raio: nenhum record cujo território toque uma
célula de zona segura entra na lista de escopo. O `safe-zones.js` não consegue
barrar mob (§3.3), e fingir que consegue é pior que não ter.

## II.6 Permadeath e morte por mob — condição registrada

Enquanto `rp.permadeathEnabled` estiver desligado, não há conflito. **Se algum
dia for ligado, a interação com morte por criatura precisa de decisão própria
antes** — perder um personagem de meses para um lobo, sem cena, sem autor e sem
processo, é a mesma família de problema que fez o conselho vetar a mordida com
70% no `SOUL_AFFINITY.md` §3.1. Não é motivo para não ter mobs. É motivo para as
duas coisas não se encontrarem por acidente.

---

# Parte III — Próximo passo técnico

## 16. O que implementar primeiro, e o que essa peça precisa provar

A ordem abaixo é deliberadamente anti-intuitiva: **as duas primeiras peças não
são a feature.** São as perguntas cuja resposta decide se a feature existe.

### Peça 1 — Censo de fauna (observação, não mecânica)

**O que é:** durante a Fase 0, com o servidor rodando e uma pessoa conectada, um
script somente-leitura que percorre `mp.getActorsByProfileId(0)`, lê `baseDesc` e
distância, e escreve um arquivo. Nenhum `disable`, nenhum `enable`, nenhuma
escrita, nenhum item.

**Não passa pelo portão da §15** — é validação do que já existe, isento pelo
Anexo A.1(b), a mesma isenção que permite a Fase 0 existir.

**O que precisa provar, e é o único trabalho desta peça:**

1. **Criaturas hostis vanilla já estão ativas?** É a hipótese central deste
   documento (§15) e ela não foi verificada. Se a resposta for não, todo o
   desenho muda de forma.
2. **Quais são os `baseDesc` reais?** Sem isso, nenhuma lista de curadoria pode
   ser escrita — e é exatamente por isso que a §4 do `NPC_POLICY_DECISION.md`
   está pendente desde 05/08. **Este censo desbloqueia aquela seção também.**
3. **Qual a densidade real perto de onde se joga?**
4. **⚠️ Encontros escalam por jogador?** (§7.4) Com dois clientes de níveis
   diferentes no mesmo lugar, o mesmo ator tem os mesmos valores? Esta é a
   pergunta cuja resposta pode anular a §II.3.

### Peça 2 — Prova do cadáver

**O que é:** matar um lobo com o servidor observando e responder uma pergunta.

**A pergunta:** o servidor consegue **ler e sobrescrever** o inventário de um
ator morto — `mp.get(id,'inventory')` e `mp.set(id,'inventory',{entries:[]})`
(§7.5, **[DOC]** e nunca exercitado)?

**Por que antes de tudo:** se a resposta for não, o cadáver vanilla é uma
torneira de item fora do ledger e a §11 da Constituição não tem como ser
cumprida. Não é um detalhe a resolver depois — é o que decide entre três
desenhos completamente diferentes:

| Resposta | Consequência |
|---|---|
| **Sim** | Desenho pedido: corpo esvaziado, loot concedido pelo `transaction-service`, origem rastreável |
| **Não** | Plano C da §14: loot por comando de RP (`/esfolar`), com o custo de dois inventários visíveis |
| **Não, e o corpo também não pode ser esvaziado** | Plano B: **a mecânica perde o loot inteiro** e vira ambientação perigosa. Ainda vale (§1, §6, §8), mas a profissão de Caçador volta à estaca zero |

**Isto é o que a primeira peça precisa provar antes de crescer.** Nenhuma linha
de `hunting-service` deve ser escrita antes desta resposta.

### Peça 3 — Curadoria, agora possível

Com o censo na mão, preencher em `npc-policy.json`: o que sai do mundo
(`blockedBaseDescs`, que já existe) e o que entra no escopo de caça (a lista
nova). **Só aqui** o campo de configuração faz sentido — ver §17.

### Peça 4 — `hunting-service`, mínimo

Consumidor de `mp.onDeath`; despacho resolvido no `module-registry` (§7.3);
tabela fixa; `transaction-service.giveItem` com `reason`/`module`/`idempotencyKey`;
`enabledBy: 'ENABLE_HUNTING_SERVICE'`, fase `lab`, desligado por padrão. Nenhum
timer novo (§7.1).

**Testes obrigatórios antes de ligar**, no padrão do `CONTRIBUTING.md` §6 —
verificar o argumento e o efeito, nunca só o retorno:

1. `baseId` fora da tabela **nunca** entra com `reason='hunt_loot'`.
2. Duas mortes do mesmo `actorId` com a mesma chave concedem **uma** vez.
3. O caminho de morte de mob **não toca o banco** antes de decidir que é um mob
   da tabela (§7.2).
4. Adicionar um consumidor de `mp.onDeath` **não silencia** o do
   `death-service` — o teste que protege a detecção de morte de jogador, e que
   deve ser escrito primeiro.
5. Nenhum caminho de item fora do `transaction-service`.
6. Teto por janela consultado no ledger, não em memória — sobrevive a restart.

### Critério de abortar

Registrado agora, para não ser negociado depois com o sistema já construído: **se
a caça virar a atividade central do servidor**, a mecânica venceu o servidor
(§6.4) e é revertida. É reversível de propósito — a lista de escopo esvaziada
devolve o mundo ao estado anterior, que é a mesma disciplina de modo de falha
que o `npc-cleaner` e o `safe-zones` já seguem.

## 17. Sobre a Tarefa 3 — o campo de configuração **não** foi adicionado

O pedido autorizava, condicionalmente, acrescentar um campo inerte ao schema de
`npc-policy.json`/`npc-policy.example.json` — algo como `activatedBaseDescs`.
**A condição não se cumpriu, e o campo não foi criado.** O motivo não é cautela
genérica; é específico e tem precedente neste repositório.

**1. O nome descreveria um trabalho que não existe.** "Ativado" implica que
alguma coisa ativa. Nada ativa (§11.1). Um campo chamado `activatedBaseDescs` num
arquivo lido por um serviço que só desativa é uma promessa falsa gravada em
config.

**2. É a repetição literal do defeito do `safeRadius`.** Aquele campo existiu no
config, com comentário descritivo, **sem nenhum leitor**, e a documentação do
`npc-cleaner` registra o diagnóstico: *"o comentário descrevia um recurso que não
estava escrito"*. Um segundo campo sem leitor, no mesmo arquivo, seria pagar o
mesmo preço de novo com o defeito já catalogado.

**3. Ele nasceria vazio e continuaria vazio, porque o dado não existe.** O
formato é `baseDesc`, e ninguém conhece os `baseDesc` reais deste mundo até o
censo da Peça 1 rodar. É a mesma razão pela qual a §4 do `NPC_POLICY_DECISION.md`
está pendente desde 05/08. Um segundo `[]` ao lado do `blockedBaseDescs` vazio não
adianta a curadoria em nada.

**4. O contrato de dados não precisa de código para existir.** É este documento —
§II.4 fixa a forma da tabela, §11.2 fixa o vocabulário, §II.1 fixa o escopo. Um
documento não engana ninguém sobre estar funcionando.

**O que fazer, e quando:** depois da Peça 1, acrescentar a `npc-policy.json` uma
lista de escopo de caça — sugestão de nome **`huntableBaseDescs`**, que diz o que
faz (estes records rendem loot governado) sem afirmar que algo é ligado —
**junto** com o leitor que a consome. Campo e leitor na mesma mudança, como o
`safeRadius` deveria ter nascido.

---

## Resumo executivo

| Pergunta | Resposta |
|---|---|
| Criaturas hostis ficam ativas? | **Sim** — e provavelmente já estão, sem que ninguém tenha olhado |
| Sistema novo de spawn? | **Não.** Não spawnamos nada na v1 |
| Inverter o `npc-cleaner`? | **Não.** Não há o que ativar. Compartilha config e curadoria, não lógica |
| Morte de mob pelo `death-service`? | **Não.** Pipeline separado, mesma fonte (`mp.onDeath`), despacho no `module-registry` |
| Loot existe? | **Sim, condicionado** à prova do cadáver (Peça 2). Sempre pelo `transaction-service` |
| Loot puxa da Afinidade da Alma? | **Não.** Tabela fixa por tipo |
| Bandidos na v1? | **Não** — loot proibido, papel que é de jogador, e crime que abre outra conversa |
| Draugr, Falmer, vampiro, dragão? | **Não decidido aqui.** Aprovação de narrativa/staff em rodada separada |
| Respawn e nível? | **Vanilla, intocados.** Condicionado à §7.4 |
| Primeiro passo? | **Censo de fauna e prova do cadáver.** Nenhum dos dois é a feature |
| Tarefa 3 executada? | **Não**, por §17 — registrada como passo depois do censo |

**Nada aqui está pronto para implementar. A Fase 0 continua sendo pré-requisito
de tudo,** e nesta mecânica ela não é só bloqueio de calendário: as duas
perguntas que decidem o desenho (o cadáver e a escala) só podem ser respondidas
com alguém conectado.

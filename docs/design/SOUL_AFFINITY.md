# Afinidade da Alma (Soul Affinity) — desenho fechado

**Proposta:** substituir Soul DNA por um sistema único de afinidades que explique magia, vampirismo, licantropia, bênçãos, maldições, corrupção, encantamento e linhagem nobre.

**Estado: DESENHO FECHADO.** Um veto e quatro condições, todos incorporados. Emendou a §8 da Constituição (v1.1). **Nada disto vira código antes da Fase 0** (teste in-game).

O documento tem três partes. A **Parte I** é a análise de 15 pontos exigida pela Constituição §15 — o que a proposta resolve e o que ela quebra. A **Parte II** é o desenho que sai dela: como o sistema vira jogo bom sem perder jogabilidade nem diversão. A **Parte III** é a especificação — valores, fórmula, schema, eventos e testes.

Se você só vai ler uma: **Parte II**. Ela contém a resposta; a I contém o porquê e a III contém o como.

Análise conforme [`CONSTITUICAO.md`](../CONSTITUICAO.md) §15.

---

## Veredito primeiro

A ideia central está certa e resolve um problema real do Skyrim: no vanilla, todo mundo aprende tudo, e isso é veneno para Heavy RP. Uma alma que muda **custo e risco** cria especialização sem classe fechada, e a **Árvore de Transformação** ("você não vira vampiro, você percorre um caminho") é a melhor ideia da proposta — resolve o estado binário e transforma maldição em trajetória.

Três coisas precisam mudar antes de existir:

1. **VETO: a rolagem de 70% de morte na mordida.** Detalhado em §3.1. Na forma proposta, ela transforma qualquer vampiro num botão de `/permakill` ambulante.
2. **"2 meses vs 2 anos" é uma classe fechada com outro nome.** §3.2.
3. **Número oculto que decide resultado é indistinguível de bug e de favorecimento da staff.** §4.2.

E uma adição do conselho que resolve o problema que você mesmo levantou ("nasce melhor não é divertido") na raiz: **nenhuma alma pode ser estritamente melhor que outra.** §14.

---

## 1. Objetivo

Que a progressão seja narrativa e não uma árvore de talentos: dois personagens percorrendo o mesmo caminho chegam a lugares diferentes por causa de quem são e do que escolheram.

## 2. Problema que resolve

- **O Skyrim é uma máquina de personagens idênticos.** Todo mundo vira arquimago, Companion, Lâmina e Ouvinte na mesma save. Isso apaga identidade, que é a moeda do Heavy RP.
- **Poder sem escassez.** Hoje qualquer um encanta, então encantador não é profissão — e a Constituição §11 exige que toda cadeia tenha gargalo.
- **Vampiro e lobisomem como buff.** A Constituição §9 já proíbe; faltava o mecanismo que torna a maldição rara e cara.
- **Casas Nobres sem identidade mecânica.** Hoje são tabela.

## 3. Problemas que a proposta cria

### 3.1 🔴 VETO — a mordida com 70% de morte

O cenário: personagem aprovado na whitelist, jogado por meses, com laços sociais e história. Entra numa cena, é mordido. O servidor rola. **70% das vezes o personagem morre — permanentemente, por dado, por causa da ação de outro jogador.**

Isso viola três coisas ao mesmo tempo:

- **`HEAVY_RP_RULES.md` §6 (powergaming):** "forçar outro personagem a aceitar consequências permanentes sem o processo exigido". A mordida faz exatamente isso, com o servidor como cúmplice.
- **Constituição §5:** escolha irreversível sem aviso.
- **Faz o vampiro injogável também.** Um vampiro que quer criar progênie mata 7 em cada 10 tentativas. Não dá para construir clã, e clã é a parte política que justifica vampirismo existir.

E cria um vetor de grief limpo: basta morder para permakillar, com a defesa pronta de "foi o dado".

**Alternativa:** a mordida **nunca resolve nada sozinha**. Ela inicia um processo — o primeiro passo da árvore, não um lance de moeda sobre a vida de alguém. Ver §14.2.

### 3.2 🔴 "2 meses vs 2 anos" é classe fechada disfarçada

Servidor de RP tem retenção medida em meses. Um caminho de 2 anos não é um caminho difícil: é uma porta fechada com placa de "aberta". A Constituição §5 proíbe classe fechada.

Pior: como o número é oculto, Pedro não sabe que escolheu um caminho de 2 anos. Ele só sente que o jogo não responde, e sai.

**Alternativa:** afinidade não muda **tempo até desbloquear**, muda **custo, risco e teto**. Pedro lança Fireball — mas precisa de mestre, componente, ritual mais longo, e falha mais. Ele chega. Chega mais caro e com mais cicatriz. Isso é Heavy RP; "espere dois anos" é ausência de jogo.

### 3.3 🟠 Reroll até tirar alma boa

Alma gerada na criação é engenharia-reversa pela comunidade em semanas. Whitelist + permadeath encarecem o reroll, mas isso é **contenção acidental** — e não protege o começo do servidor, quando ninguém tem apego a personagem.

**Alternativa em §14.1:** derivar a alma da ficha aprovada, não do acaso.

### 3.4 🟠 Monopólio por nascimento

Se encantador de verdade nasce pronto, o servidor pode acabar com um ou dois. Isso é escassez (bom, §11) até a pessoa parar de jogar — e aí uma indústria inteira morre com ela. Ponto único de falha que é uma **pessoa**.

**Mitigação:** afinidade é necessária para a **maestria**, não para a **prática**. Aprendiz com afinidade baixa produz peça comum; a peça excepcional exige o mestre. E mestre pode treinar — lentamente, transferindo técnica, não alma.

### 3.5 🟡 Linhagem nobre hereditária

Cria identidade política ótima. Mas mecanizar herança de sangue esbarra rápido em casamento como estatística e em exclusão por nascimento. Precisa ser **tendência**, nunca requisito de cargo, e a Casa precisa poder adotar, reconhecer bastardo e errar na sucessão — que é onde as histórias estão.

## 4. Exploits possíveis

### 4.1 Descoberta e otimização do oculto
A comunidade vai medir. Sempre mede. Em 3 meses existe uma planilha comunitária de "como saber sua afinidade em 20 minutos".

**Isso não é evitável — é gerenciável.** O sistema tem que continuar interessante **depois** de conhecido. Um sistema que só funciona enquanto é segredo já nasce com data de morte.

### 4.2 🔴 O oculto como escudo de acusação
Este é o risco de comunidade, e é mais perigoso que qualquer exploit mecânico.

Jogador falha cinco rituais seguidos. Ele não consegue distinguir entre: afinidade baixa, bug, e **a staff favorecendo um amigo**. Com o número invisível, a acusação de favorecimento é **infalsificável** — e servidor de RP morre disso, não de bug.

**Condição obrigatória:** toda rolagem grava em `audit_logs` as entradas, o resultado e a semente. Semente determinística derivada do personagem + do evento, de modo que a staff possa **reproduzir e provar** qualquer resultado contestado. O número segue oculto para o jogador; a auditoria não.

### 4.3 Grief por transformação forçada
Alterar permanentemente a alma de outro personagem sem consentimento é a versão sobrenatural do RDM. Precisa do mesmo processo que consequência permanente já exige.

### 4.4 Suicídio de personagem como reroll
Se a alma vier do acaso, matar o próprio personagem vira estratégia. Resolvido pela §14.1.

## 5. Impacto na economia

**Positivo e estrutural.** Encantamento deixa de ser produção infinita e vira cadeia com gargalo humano (§11): Soul Gems → encantador com afinidade → peça com assinatura e histórico. Cria mercado, cria fama, cria alvo de roubo, cria encomenda.

**Risco:** hiperinflação de preço em serviço de mestre único. Mitigado pela §3.4 (aprendiz produz o comum).

**Requisito duro:** tudo que gerar valor passa por `core/transaction-service`. Nenhum caminho novo de ouro ou item fora dele — foi assim que o `economy-service` foi apagado.

## 6. Impacto político

Alto e desejável. Se Casa A tende ao divino e Casa B ao marcial, a disputa por cargos ganha substrato. Um Jarl com afinidade sombria escondida é uma trama inteira.

**Cuidado:** afinidade **nunca** pode ser requisito de cargo público. No instante em que for, o jogo político vira consulta a uma tabela — e a política morre.

## 7. Impacto militar

Guerreiro lendário por afinidade marcial é bom. Mas o combate do SkyMP é do cliente, e o servidor não arbitra golpe (ver `MODS_AND_GAMEMODE_CONTRACT.md`). Afinidade marcial só pode agir onde o servidor manda: fadiga, ferimento, tempo de recuperação, capacidade de comando. **Nunca em dano por golpe.**

## 8. Impacto religioso

O melhor gerador de história da proposta: **o homem devoto que não tem afinidade divina.** Isso é drama puro, e a igreja como instituição ganha a pergunta "quem realmente foi tocado?".

**Condição:** a igreja não pode ter um detector. Se o templo mede afinidade, acabou o mistério e acabou a fé — vira exame de sangue.

## 9. Impacto social

Cria a hierarquia informal que Heavy RP precisa: quem é procurado por quê. Cria também preconceito jogável (§9 da Constituição já pede isso para vampiros).

**Risco real:** se afinidade se torna pública na prática — e vai se tornar, por reputação —, jogadores com "alma ruim" viram cidadãos de segunda **fora** do personagem. Isso é gestão de comunidade, não de código, e precisa estar nas regras antes do sistema existir.

## 10. Impacto técnico

- **Tabela nova** (`character_soul`), 8 atributos + histórico de mutação. Barato.
- **Toda alteração de alma é evento**, nunca escrita direta — a Constituição §13 exige event-driven, e aqui é o caso de uso perfeito.
- **Corrupção manifestada** (pesadelo, voz, mudança física): mensagem e animação o servidor faz hoje; **mudança física exige plugin nosso** — FormIDs estáveis, sem script, com a lógica em Node (o padrão já documentado em `MODS_AND_GAMEMODE_CONTRACT.md` §5).
- **A árvore é uma máquina de estados**, irmã de `core/character-state.js`. Módulo próprio, registrado no `module-registry`, atrás de flag.
- ⚠️ **Nada disto pode virar polling.** Já temos três serviços a cada 2 s e uma chamada Papyrus custa 13–35 ms.

## 11. Impacto narrativo

É o ponto mais forte. Substitui progressão por biografia: dois vampiros, mesmo caminho, um vira Lorde estável após anos de preparo e o outro enlouquece. Isso é a Constituição §4 sendo cumprida literalmente.

## 12. Como gera histórias

- O talentoso que **não quer** o dom — e é procurado por isso.
- O devoto sem afinidade divina que constrói a igreja assim mesmo.
- O mestre encantador cuja assinatura vale mais que a peça, e que é sequestrado por causa disso.
- A Casa Nobre que descobre que o herdeiro não tem o sangue.
- O primeiro vampiro do servidor, cujo nome todo mundo vai saber.
- O necromante que ainda parece gente — e o que já não parece.

## 13. Como pode ser abusada

Coberto em §3.1, §4.1–4.4. A mais grave é o **grief por transformação**, e a segunda é a **acusação infalsificável de favorecimento**.

## 14. Como balancear — as quatro condições

### 14.1 A alma vem da ficha, não do dado
Semente determinística derivada da aplicação de whitelist aprovada — que **já coleta `motivations`, `weaknesses` e `social_ties`** (migration v5, existe hoje). Mesma ficha, mesma alma.

Três ganhos de uma vez: acaba o reroll-farming; a ficha passa a **valer mecanicamente**, o que melhora a qualidade das aplicações; e a staff, que já revisa conceito, passa a revisar destino sem precisar de ferramenta nova.

### 14.2 Nenhum evento único decide um destino
A mordida não mata nem transforma: ela **infecta**, e infecção é o primeiro nó da árvore. O que vem depois é escolha, tempo, ritual e risco — com pontos de saída (cura é possível, cara e humilhante). Sem consentimento e sem processo, uma transformação não se completa.

### 14.3 Toda rolagem é auditável
Entradas, resultado e semente em `audit_logs`. Oculto para o jogador, reproduzível pela staff. Sem isso, o sistema é indefensável no primeiro conflito de comunidade.

### 14.4 🔑 Nenhuma alma é estritamente melhor — a condição que resolve tudo
Esta é a contribuição principal do conselho, e resolve na raiz o problema que você levantou ("nasce melhor não é divertido").

Se afinidade alta só dá vantagem, existe alma boa e alma ruim, e nascer é loteria. **Então afinidade alta tem que cobrar** — que é literalmente a Constituição §7:

| Afinidade alta | Ganho | Preço |
|---|---|---|
| **Arcana** | aprende barato, lança limpo | as coisas antigas notam quem brilha: mais exposição a corrupção e a atenção indesejada |
| **Divina** | proteção, cura, autoridade religiosa | obrigação — quebrar voto tem consequência mecânica, não só social |
| **Sombria** | poder proibido acessível | caçado; instituições reagem; o corpo cobra |
| **Bestial** | força, instinto, resistência | controle é mais difícil; a fera responde antes de você |
| **Vontade alta** | resiste, sustenta ritual | teimosia mecânica: mais difícil ser curado, convencido, salvo |
| **Estabilidade alta** | não enlouquece | menos sensível ao sobrenatural — não vê o que os frágeis veem |

Com isso, **não existe rolagem boa.** Existe rolagem *diferente*, cada uma com um jeito próprio de dar errado. E o jogador que descobrir a própria alma descobre um problema, não um prêmio — que é exatamente o tom Heavy RP.

## 15. Como integra ao resto do mundo

| Sistema existente | Ligação |
|---|---|
| Whitelist (`characters`, v5) | **É a fonte da semente** (§14.1) |
| `core/character-state.js` | A árvore é uma máquina de estados irmã |
| `core/action-policy.js` | Corrupção e transformação restringem ação pelo caminho que já existe |
| `identity-service` | Vampiro descoberto = identidade revelada; conecta ao disfarce |
| `governance-service` | Necromancia e vampirismo são **crimes tipificáveis** — a caçada vira processo, não linchamento |
| `death-service` | Permadeath é o gatilho de sucessão de Casa Nobre |
| `core/transaction-service` | Todo valor gerado por encantamento passa por aqui |
| Chancelaria Real | A igreja, a caçada e a Casa Nobre são instituições — o julgamento do vampiro é processo com prova |

---

# Parte II — A solução: como isso vira jogo bom

A Parte I diz o que não pode. Esta parte diz **o que fazemos**, e o critério é um só: um jogador que entra hoje precisa se divertir hoje.

## II.0 Os quatro assassinos de diversão

Todo sistema de alma oculta morre de uma destas quatro coisas. O desenho abaixo existe para matar as quatro.

| Assassino | Como aparece | Como matamos |
|---|---|---|
| **A porta fechada** | "você não pode fazer isso" | O dado **nunca** diz não. Diz *como* dá certo. §II.2 |
| **A espera** | "volte em dois anos" | Prazo medido em **sessões**, não em meses. §II.4 |
| **O silêncio** | "nada acontece, tente de novo" | Todo resultado produz ficção. §II.2 |
| **O invisível** | "não sei se isso está funcionando" | Sinais diegéticos desde a primeira sessão. §II.1 |

## II.1 A alma não tem números. Tem sinais.

Por dentro são 8 valores. **O jogador nunca interage com valor nenhum** — ele interage com *sinais*, que chegam como acontecimento:

> *As chamas te obedecem rápido demais.*
> *Cães rosnam quando você passa, e você não sabe por quê.*
> *Você não sonha. Nunca sonhou.*
> *O sacerdote te olha demais e não diz nada.*

**Todo personagem recebe o primeiro sinal na primeira sessão.** Não é poder — é identidade. O jogador sai da primeira sessão com algo verdadeiro sobre o personagem que ninguém escreveu na ficha, e que **já dá para interpretar imediatamente**.

Isso resolve o problema mais mortal de servidor de RP, que não é balanceamento: é a primeira hora ser vazia.

E resolve o "indistinguível de bug" (§4.2 da Parte I) pelo lado certo — o jogador sempre recebe algo que lê como intencional, porque é.

## II.2 O dado nunca diz não. Diz qual história você ganhou.

**Regra de ouro do sistema:** toda tentagem ligada à alma produz um destes quatro resultados. **Os quatro dão certo.**

| Resultado | O que acontece | Quem tira mais |
|---|---|---|
| **Limpo** | Funciona, sem custo extra | afinidade alta |
| **Caro** | Funciona, mas consome mais — componente, tempo, exaustão | meio-termo |
| **Complicado** | Funciona **e mais alguma coisa acontece** — um efeito colateral que é gancho de cena | afinidade baixa |
| **Marcado** | Funciona e **deixa uma marca permanente** no personagem | afinidade baixa, tentativa grande demais |

Nunca existe "falhou, tente de novo". Existe "funcionou, e agora tem isto".

**Exemplo.** Dois personagens encantam a mesma lâmina.

- *João (Arcana alta)* → **Limpo.** Lâmina encantada, bonita, funciona. Fim.
- *Pedro (Arcana baixa)* → **Marcado.** A lâmina funciona — e ficou fria demais, e a mão que a forjou não esquenta mais. Pedro agora tem uma cicatriz que outros personagens **veem**, uma lâmina com nome, e uma história.

Quem se divertiu mais? Essa é a pergunta que reorganiza o sistema inteiro.

## II.3 A estrada difícil produz o personagem melhor — e o sistema torna isso legível

Este é o giro que faz "tirar baixo" deixar de ser castigo.

> **Talento é mais rápido. Teimosia é mais marcante.**

O mago talentoso é elegante e eficiente. O mago que chegou lá **sem ter o dom** é coberto de marcas, tem uma reputação, e todo mundo no servidor sabe o preço que ele pagou. As duas fantasias são desejáveis — e a segunda gera mais história, que é o §4 da Constituição.

**As marcas são a progressão.** Não há nível. Há o que ficou em você:

- Marca **visível** — outros personagens podem ver, e isso conversa com `identity-service` (esconder marca é motivo real para capuz).
- Marca **sentida** — só você sabe, até alguém perceber.
- Marca **conhecida** — entrou na reputação; um sacerdote experiente reconhece o que te aconteceu.

Uma pessoa com muitas marcas é obviamente alguém que foi longe. Isso é status **narrativo**, não numérico — e não pode ser farmado, porque cada marca custou uma cena.

## II.4 Prazos em sessões, não em meses

| Marco | Quando | Depende de afinidade? |
|---|---|---|
| Primeiro sinal | sessão 1 | não |
| Primeira capacidade real | até ~5 sessões | **não** |
| Competência reconhecida | ~1 mês de jogo | pouco |
| Maestria | meses | **sim**, mais social que solitário |

**Ninguém espera para começar a jogar.** A afinidade muda o topo da curva e o *sabor* do caminho, nunca a entrada.

## II.5 A afinidade empurra você para outras pessoas

Aprender sozinho é onde a afinidade pesa mais. **Aprender com um mestre achata a diferença.**

Isso é deliberado e é o melhor efeito colateral do sistema: quem tirou baixo tem um **motivo mecânico para procurar gente** — e procurar gente é o loop central de Heavy RP. O sistema converte estatística oculta em vida social.

E cria papéis que se sustentam sozinhos: quem ensina vira importante sem precisar de cargo da staff.

## II.6 A mordida, refeita — três caminhos em vez de um dado

Substitui os 70% de morte:

**Mordida = infecção. Sempre sobrevivível. Sempre uma escolha.**

Abre uma janela (dias de jogo) em que o personagem sente a mudança e o jogador decide:

1. **Buscar cura** — cara, humilhante, exige terceiros. Cura de verdade, com preço.
2. **Esconder** — jogável e tenso: sede, sintomas, gente notando.
3. **Aceitar** — entra na árvore.

Três ramos jogáveis de um evento, contra zero ramos de "você morreu".

**E a raridade que você queria continua existindo — mas no lugar certo.** O "1% transformação perfeita" não é rolado na mordida: é **conquistado** pelo que o personagem fez durante a infecção. Quem se preparou, buscou mestre, conseguiu o ritual e resistiu chega estável. Quem só deixou acontecer vira o monstro caçado.

Raridade merecida vale mais que raridade sorteada — e ninguém perde um personagem de meses por causa de um número.

## II.7 Descobrir a própria alma é conteúdo

O jogador nunca vê número. Mas o **personagem** pode descobrir sua inclinação, em ficção: um mestre que avalia, um ritual, um vidente, um sonho depois de algo grande.

Isso transforma "informação oculta" em **destino de viagem**. E dá função a personagens que não lutam nem governam: quem lê almas é uma profissão.

## II.8 Nada disto exige staff

Sinais, resultados, marcas e progressão na árvore são calculados pelo servidor a partir de eventos que já existem (`audit_logs`, transações, estado de personagem). A staff arbitra conflito — não opera o sistema.

É o teste da Constituição §5, no Anexo A.2: *se a staff sumir por uma semana, o mundo continua produzindo eventos?* Aqui, continua.

---

# Parte III — Especificação final

Esta parte fecha o desenho. As decisões abaixo foram tomadas pelo conselho por necessidade técnica ou de jogabilidade e **alteram a proposta original** — cada alteração diz o porquê.

## III.1 Sete valores, não oito

A proposta original tinha oito. **Cortamos um e derivamos outro**, porque botão a mais não é profundidade — é impossibilidade de balancear e de comunicar.

**Quatro afinidades** — qual caminho é barato:

| | Domínio | Árvore |
|---|---|---|
| **Arcana** | magia estruturada, encantamento, alteração | Alteração → Ritual → Arquimago |
| **Divina** | bênção, cura, autoridade sagrada | Bênçãos → Milagres → Santo |
| **Sombria** | necromancia, vampirismo, pacto | Vampirismo → Necromancia → Lorde Vampiro |
| **Bestial** | licantropia, instinto, vínculo natural | Licantropia → Totens → Alfa → Lobo Ancestral |

**Três traços** — como você aguenta o custo:

| | O que faz |
|---|---|
| **Vontade** | resiste a ser mudado: por corrupção, por outro, por persuasão |
| **Sensibilidade** | percebe o sobrenatural — vê, ouve, sente o que não está lá para os outros |
| **Estabilidade** | mantém a integridade sob tensão |

**Cortado: "Resistência à Corrupção".** Sobrepunha-se a Vontade e Estabilidade. Vira **valor derivado** — `resistência = f(Vontade, Estabilidade)` — sem ocupar espaço próprio. Menos knobs, mesma expressividade.

**A tensão desenhada de propósito:** Sensibilidade alta + Estabilidade baixa é o vidente que está se desfazendo. Estabilidade alta + Sensibilidade baixa é quem nunca enlouquece e nunca vê nada. Nenhum dos dois é melhor.

## III.2 Orçamento fixo — a garantia mecânica de que nenhuma alma é melhor

A condição §14.4 não pode depender de boa vontade de quem escreve conteúdo. Ela vira **restrição do gerador**:

- As quatro afinidades dividem um **orçamento constante**.
- Os três traços dividem **outro orçamento constante**.

Consequência: Arcana alta **obriga** algo mais a ser baixo. Não existe alma completa, não existe alma vazia, e "rolar bem" deixa de significar coisa alguma.

**Bandas em vez de números.** Internamente 0–100; a resolução usa cinco bandas, e a distribuição concentra no meio:

`Surdo · Fraco · Comum · Forte · Raro`

Ninguém é nada. Quase ninguém é tudo.

## III.3 A semente vem da ficha

```
semente = HMAC(SEGREDO_SERVIDOR, character_id ‖ normalizar(motivations, weaknesses, social_ties))
```

Os três campos **já existem** (migration v5). Mesma ficha aprovada → mesma alma, sempre. Isso mata o reroll-farming e faz a aplicação de whitelist valer mecanicamente.

⚠️ **`SEGREDO_SERVIDOR` nunca sai do servidor.** Sem ele, qualquer um calcula a alma de qualquer personagem a partir da ficha pública — e o sistema inteiro deixa de ser oculto.

## III.4 Resolução — como sai Limpo, Caro, Complicado ou Marcado

```
peso = banda(afinidade_relevante)
     + circunstância      // mestre presente, componente certo, lugar consagrado, preparo
     − dificuldade        // do ato tentado
     − pressão            // ver III.5
```

O `peso` desloca a distribuição entre os quatro resultados. **Nenhum valor de `peso` produz falha** — pesos muito baixos concentram em Complicado e Marcado, que continuam sendo sucesso com história.

**Rolagem determinística e auditável:**

```
resultado = f(semente_da_alma, id_do_evento, tentativa_n)
```

Grava em `audit_logs` (`soul:resolve`) as entradas, o `peso`, o resultado e a semente do evento. Oculto para o jogador; **reproduzível pela staff**. É a condição §14.3, e sem ela o sistema é indefensável no primeiro conflito de comunidade.

## III.5 Pressão — o anti-spam que também é ficção

Sem isto, o exploit é óbvio: tentar cem vezes até sair Limpo.

Cada tentativa do mesmo ato numa janela **acumula pressão**, que empurra a distribuição para Complicado e Marcado. Insistir não converge para o sucesso limpo — **converge para marcas**.

É honesto com a ficção: quem força a mesma coisa muitas vezes acaba pagando por isso. E é anti-exploit sem precisar dizer "não".

## III.6 Marcas

```sql
character_marks (
  id, character_id,
  kind,                     -- 'fisica' | 'espiritual' | 'social'
  visibility,               -- 'visivel' | 'sentida' | 'conhecida'
  descriptor,               -- chave do texto; nunca texto livre do jogador
  origin_event_id,          -- rastro até o audit_log que a gerou
  created_at
)
```

- **`visivel`** — outros veem. Conversa com `identity-service`: esconder marca é motivo real para capuz.
- **`sentida`** — só o portador sabe, até alguém perceber.
- **`conhecida`** — entrou na reputação; quem entende do assunto reconhece.

**Marca nunca é removida.** No máximo é *coberta* — o que também é jogável, e caro.

## III.7 Sinais

```sql
character_signs (id, character_id, sign_key, revealed_at, source)
```

O primeiro é revelado no **primeiro spawn**, não por tempo de jogo — é o que garante que a primeira sessão não seja vazia. Os seguintes chegam por evento: algo que o personagem fez, viu ou sofreu.

Entrega pelo canal que **já existe**: property `panelData` + `core/panel-refresh-bus.js`. Nenhuma infraestrutura nova.

## III.8 A árvore é máquina de estados, irmã de `character-state`

```sql
character_paths (
  id, character_id,
  tree,                     -- 'arcana' | 'divina' | 'sombria' | 'bestial'
  node,                     -- nó atual
  entered_at, consented_at, -- consentimento explícito onde é irreversível
  metadata
)
```

**Separada de `core/character-state.js` de propósito.** Aquele trata estado imediato de gameplay (`NORMAL`/`DOWNED`/`IMPRISONED`), com ciclo de vida de segundos. Este é trajetória de meses. Misturar os dois acoplaria coisas com tempos de vida incompatíveis — a §13 da Constituição.

**`consented_at` é a implementação da condição §14.2:** nó irreversível não avança sem consentimento registrado. É também a resposta ao A.3 do Anexo (aviso antes do irreversível).

## III.9 Contrato de eventos

Tudo event-driven, **nada de polling** — já temos três serviços a 2 s e uma chamada Papyrus custa 13–35 ms.

| Evento emitido | Quem consome |
|---|---|
| `soul.resolved` | marcas, painel, auditoria |
| `soul.mark.created` | `identity-service` (se visível), painel |
| `soul.sign.revealed` | painel |
| `soul.path.advanced` | governança (crime tipificável), painel |
| `soul.infection.started` | painel, e abre a janela de escolha |

O `governance-service` escuta `soul.path.advanced` para tipificar necromancia e vampirismo como **crime** — o que transforma caçada em processo, e não em linchamento.

## III.10 O que o servidor não consegue fazer, e a consequência

Limite real do SkyMP, registrado antes que alguém desenhe em cima:

| Manifestação | Viável hoje? |
|---|---|
| Mensagem, sonho, voz, aviso | ✅ direto |
| Animação, efeito sonoro | ✅ Papyrus |
| Bloquear ação (corrupção, transformação) | ✅ `core/action-policy.js` |
| **Mudança física visível** | ❌ **exige plugin nosso** — `.esm` sem script, com FormIDs que controlamos, lógica em Node (padrão do `MODS_AND_GAMEMODE_CONTRACT.md` §5) |

Enquanto o plugin não existir, marca física é **descrita**, não renderizada. Funciona — Heavy RP vive de descrição — mas é uma limitação a assumir, não a esconder.

## III.11 Módulo e flag

`soul-service.js`, registrado no `core/module-registry.js`, `enabledBy: 'ENABLE_SOUL_SERVICE'`, fase `lab`, desligado por padrão. Dependências: nenhuma no v1 (a integração com governança entra depois, por evento).

## III.12 Testes obrigatórios antes de ligar

Seguindo o `CONTRIBUTING.md` §6 — verificar o **argumento e o efeito**, nunca só o retorno:

1. **Orçamento fixo é respeitado** em 10 000 almas geradas: nenhuma soma foge do orçamento.
2. **Distribuição concentra no meio**: `Comum` é a banda mais frequente; `Raro` é raro de verdade.
3. **Determinismo**: mesma ficha → mesma alma, entre execuções e entre processos.
4. **A resolução nunca falha**: em 10 000 resoluções com o pior `peso` possível, zero resultados fora dos quatro.
5. **Pressão empurra para marca**, nunca para Limpo — o teste do exploit de spam.
6. **Nó irreversível recusa avançar sem `consented_at`.**
7. **A semente não vaza**: nenhum payload de `panelData` contém número de afinidade. Este é o teste que protege o sistema inteiro; escrever primeiro.
8. **Marca visível respeita o firewall de identidade**: quem não conhece o portador não recebe descritor que revele nome civil.

## III.13 Fora do v1, deliberadamente

- **Linhagem nobre hereditária** — depende da árvore provada e toca sucessão, que hoje é staff-autorada.
- **Afinidade marcial** — o combate é do cliente; o servidor não arbitra golpe. Entra quando houver um caminho confiável, não antes.
- **Detector institucional de alma** — a igreja **não** pode ter exame de sangue espiritual. Mataria o mistério e a fé de uma vez.

---

## Proposta de implementação — em que ordem, e não agora

**Pré-requisito absoluto: Fase 0** (teste in-game). O projeto ainda não rodou uma sessão. Construir um sistema de alma sobre um gamemode não validado é construir no escuro.

Depois disso, a ordem que o conselho recomenda — cada etapa entrega história sozinha, nenhuma depende da seguinte para valer a pena:

1. **`character_soul` + semente pela ficha + o primeiro sinal.** A alma existe, é auditável, e já entrega o sinal da sessão 1 (§II.1) — que não depende de nenhuma mecânica pesada e sozinho já melhora a primeira hora de jogo. Nenhum efeito mecânico ainda: dá pra validar distribuição e leitura antes de qualquer consequência.
2. **Os quatro resultados (§II.2) em UMA coisa só — encantamento.** Limpo/Caro/Complicado/Marcado, com as primeiras marcas. Escopo pequeno, economia mensurável, primeira profissão de verdade — e valida o mecanismo central do sistema inteiro num lugar onde errar é barato.
3. **Corrupção**, ligada a necromancia. Aqui entra a manifestação narrativa (§10) e o plugin próprio.
4. **Árvore de Transformação**, começando por licantropia — mais simples que vampirismo, sem a política de clã.
5. **Vampirismo**, por último, porque é o que mais toca política, religião e grief.
6. **Linhagem nobre**, depois que a árvore provou funcionar.

**Nunca:** liberar a etapa 5 antes de a 14.2 (consentimento e processo) estar implementada e testada.

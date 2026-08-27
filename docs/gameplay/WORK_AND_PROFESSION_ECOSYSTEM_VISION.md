# Visão do Ecossistema de Trabalho, Profissões e Classes Profissionais

**Status:** visão de produto e orientação de equipe · **Data:** 25/08/2026 ·
**Conferido contra o código:** 26/08/2026 ·
**Decisões relacionadas:** [ADR 007](../technical/ADR_007_WORK_ECOSYSTEM_TAXONOMY.md),
[ADR 008](../technical/ADR_008_PROFESSION_SPECIALIZATION_BOUNDARY.md) e
[ADR 011](../technical/ADR_011_PUBLIC_WORK.md)

## A ideia em uma frase

O servidor deve permitir que qualquer personagem comece trabalhando, mas fazer
com que conhecimento, reputação, organização e relações entre jogadores sejam
necessários para prosperar.

O ecossistema foi pensado como uma trajetória possível, não como uma sequência
obrigatória:

```text
trabalho livre/público
        ↓
primeira renda + contato com o mundo
        ↓
profissão e domínio técnico
        ↓
especialização
        ↓
emprego, contratos e relações comerciais
        ↓
posição, negócio, guilda ou função institucional
```

Um personagem pode permanecer em qualquer camada, combinar caminhos ou mudar
de vida. O sistema cria oportunidades de interpretação; ele não escreve uma
biografia automática para o jogador.

## 1. Que mundo queremos produzir

Em muitos jogos, “trabalho” é apertar um botão até uma barra encher. Em nosso
Heavy RP, trabalho deve cumprir quatro funções ao mesmo tempo:

1. colocar pessoas em circulação pelo mundo;
2. gerar encontros e dependência entre personagens;
3. sustentar uma economia compreensível e auditável;
4. transformar escolhas profissionais em parte da identidade do personagem.

Isso significa que o objetivo não é permitir que cada jogador extraia,
transforme, venda e consuma tudo sozinho. O objetivo é formar cadeias:

```text
Minerador → Fundidor → Ferreiro → comerciante/cliente
Caçador → Curtidor → Ferreiro/alfaiate futuro → cliente
Fazendeiro → Cozinheiro/Taberneiro → viajantes
Mensageiro → negócios, instituições e personagens contratantes
Tratador de Cavalos → estábulo, viajantes e caravanas
```

Quanto mais o mundo depende de relações legítimas, mais histórias surgem:
escassez, negociação, dívida, parceria, concorrência, escolta, roubo, proteção,
prestígio e conflito político.

## 2. Empregos livres e trabalhos públicos: a porta de entrada

Chamamos de **trabalho público** a atividade simples oferecida pelo próprio
mundo e acessível a qualquer personagem. Na conversa cotidiana, a equipe pode
chamá-la de emprego livre, mas no código e nos documentos o nome canônico é
`Public Work`.

O jogador encontra um quadro, capataz ou ponto físico, aproxima-se e usa E. Ele
aceita uma tarefa objetiva, coleta uma carga ou inicia um serviço, vai até o
destino e conclui usando E novamente.

Exemplos planejados:

- entregar fardos entre um depósito e um celeiro;
- levar lenha já preparada até um ponto de abastecimento;
- transportar caixas para um armazém;
- abastecer um estábulo;
- levar uma carta lacrada;
- transportar provisões entre pontos públicos.

Essas atividades existem para dar ao recém-chegado:

- uma primeira fonte de septims;
- motivo para conhecer cidades e estradas;
- prática com interação física e inventário;
- oportunidade de encontrar profissionais, empregadores e outros viajantes;
- algo útil para fazer quando a economia entre jogadores estiver pouco ativa.

Trabalho público oferece um **piso econômico**, não uma carreira. Ele paga
menos que uma profissão produtiva, possui cooldown, não ocupa slot profissional
e não concede XP, rank, especialização nem recurso primário de profissão.

Uma entrega de lenha transporta uma carga preparada. Ela não corta árvores e
não substitui o Lenhador. Uma entrega de suprimentos não produz comida e não
substitui Fazendeiro, Cozinheiro ou Taberneiro.

## 3. Profissão: aquilo que o personagem sabe fazer

Profissão representa conhecimento técnico reconhecido e persistente. Ela
responde à pergunta:

> “Que atividade especializada este personagem está preparado para exercer?”

O personagem possui um número limitado de profissões ativas — hoje o padrão
planejado no core é três. Essa limitação não existe para punir experimentação;
ela existe para impedir autossuficiência total e preservar a necessidade de
troca.

Uma profissão pode ter:

- estado `active`, `suspended` ou `revoked`;
- rank técnico;
- XP acumulado;
- requisitos de ferramenta, estação ou local;
- acesso a nós, receitas ou ações específicas;
- especializações futuras;
- registro histórico, mesmo quando deixa de estar ativa.

Profissão não significa emprego. Um Ferreiro desempregado continua sabendo
forjar. Um personagem contratado por uma taverna não se torna Cozinheiro
automaticamente. Conhecimento e vínculo social são dimensões diferentes.

## 4. “Classe” não significa classe rígida de combate

Neste ecossistema, **profissão não é uma classe tradicional de RPG** como
guerreiro, mago ou ladrão. Escolher Minerador ou Ferreiro não bloqueia arma,
armadura, magia, raça ou estilo de interpretação.

Quando usamos a expressão “classe profissional”, estamos falando de uma
família econômica de conhecimentos:

- coleta;
- transformação e crafting;
- prestação de serviço;
- ocupação institucional.

As capacidades de combate, magia, condição sobrenatural e identidade narrativa
pertencem a outros sistemas. Isso evita que uma decisão econômica controle toda
a construção do personagem.

Também evita o extremo oposto: profissão não é apenas um título cosmético. Se
um recurso, receita ou serviço exige determinado conhecimento, o servidor deve
verificar a profissão ativa e o rank antes de autorizar a ação.

## 5. As classes profissionais planejadas

O catálogo atual possui treze profissões agrupadas em quatro classes. Estar no
catálogo não significa que todo gameplay correspondente já esteja pronto.

### 5.1 Coleta

Profissionais que obtêm recursos brutos do mundo.

| Profissão | Papel no ecossistema |
|---|---|
| Minerador | Extrai minério de veios físicos e alimenta fundição e forja. |
| Lenhador | Produz madeira e lenha profissional a partir de pontos próprios. |
| Caçador | Obtém carne, pele e outros recursos da fauna. |
| Fazendeiro | Produz alimentos e insumos agrícolas. |

Coleta profissional usa alvo físico, ferramenta, alcance, cooldown e estado do
recurso validados pelo servidor. Não é comando de chat e não é o mesmo estoque
usado por trabalhos públicos.

### 5.2 Transformação e crafting

Profissionais que convertem recursos em bens de maior valor.

| Profissão | Papel no ecossistema |
|---|---|
| Fundidor | Transforma minério em material utilizável. |
| Ferreiro | Produz armas, armaduras e outros bens de forja. |
| Curtidor | Processa peles e materiais animais. |
| Encantador | Aplica conhecimento arcano à produção de itens. |
| Cozinheiro | Converte ingredientes em alimentos e provisões. |

Uma receita pode exigir profissão e rank. Ferramenta, estação, ingredientes e
resultado são revalidados no servidor, e itens relevantes podem receber a
assinatura de seu artesão.

### 5.3 Serviços

Profissões cujo valor nasce principalmente do atendimento, da logística ou da
relação com outros personagens.

| Profissão | Papel no ecossistema |
|---|---|
| Tratador de Cavalos | Cuida de montarias e participa da operação de estábulos. |
| Taberneiro | Opera hospitalidade, abastecimento e atendimento de taverna. |
| Mensageiro | Transporta cartas, encomendas e comunicações confiáveis. |

Serviços não precisam fabricar um item para serem econômicos. Seu produto pode
ser disponibilidade, deslocamento, confiança, acesso ou conveniência.

### 5.4 Institucional

| Profissão | Papel no ecossistema |
|---|---|
| Guarda | Identidade ocupacional e conhecimento relacionado à função. |

`Guarda` no Profession Core é uma etiqueta profissional, não uma autorização.
Revistar, prender, multar ou confiscar exige vínculo e cargo válidos no sistema
de Governance. Assim, ninguém recebe poder institucional apenas porque possui
uma profissão cadastrada.

## 6. Especialização: como duas pessoas da mesma profissão se diferenciam

Especialização é um ramo de uma profissão já possuída. Ela responde:

> “Dentro desse conhecimento, em que este personagem decidiu se aprofundar?”

Exemplos conceituais futuros:

- Ferreiro → Armeiro ou Cuteleiro;
- Cozinheiro → Padeiro ou Cozinheiro de campanha;
- Caçador → Rastreador ou Coureiro especializado;
- Encantador → foco em armas, vestimentas ou utilidade.

Esses nomes são exemplos de direção, não catálogo aprovado para implementação.

A especialização pertence à linha da profissão pai. Ela não possui XP, rank ou
status próprios: herda a progressão e a disponibilidade da profissão. Se a
profissão for suspensa, a especialização permanece no histórico, mas não pode
ser usada. Isso elimina duas fontes de verdade disputando o mesmo progresso.

## 7. Emprego, posição e negócio

Depois de adquirir conhecimento, o personagem pode usá-lo de várias maneiras.
É aqui que entram três conceitos que não devem ser misturados com profissão.

### Employment — para quem trabalha

Employment é um vínculo continuado entre personagem e empregador. O empregador
pode ser um negócio, organização ou instituição.

Exemplos:

- um Cozinheiro empregado por uma taverna;
- um Tratador empregado por um estábulo;
- um Minerador contratado por uma companhia;
- um Mensageiro vinculado a uma casa comercial.

O emprego pode definir rotina, remuneração, deveres e regras internas, mas não
concede conhecimento técnico por si só.

### Position — qual lugar ocupa

Position é a função dentro daquele vínculo: aprendiz, trabalhador, supervisor,
gerente ou outra posição definida pela organização.

Posição não é rank profissional. Um Ferreiro tecnicamente experiente pode ser
um funcionário novo; um administrador de negócio pode não ser o melhor artesão
da equipe.

### Business — quem possui e administra

Business representa a entidade econômica: taverna, oficina, estábulo, companhia
de mineração, transportadora ou loja.

O negócio pode possuir:

- proprietário e administradores;
- tesouro e ledger;
- estoque, estações e propriedades;
- preços e ofertas;
- empregados e posições através de Employment;
- contratos com outros personagens ou organizações.

Business não deve guardar uma segunda lista independente de empregados. A
relação de trabalho possui uma única fonte de verdade em Employment.

Employment, Position e Business ainda são domínios planejados. Esta seção
define sua função para impedir que sejam improvisados dentro das tabelas de
profissão ou governança.

## 8. Contratos: trabalho criado por personagens

Contrato é uma obrigação pontual entre partes nomeadas. Diferentemente do
trabalho público, ele nasce de uma necessidade de jogador, negócio ou
organização.

Exemplos:

- escoltar uma caravana;
- produzir uma quantidade de armas;
- investigar um roubo;
- caçar determinado alvo;
- transportar uma encomenda privada;
- proteger uma pessoa durante um evento.

O criador deposita a recompensa em escrow. Outro personagem aceita, declara a
entrega e o criador confirma ou contesta. O sistema protege o dinheiro e o
histórico, mas não finge saber se uma interpretação subjetiva foi bem feita.

Um contrato pode exigir profissão quando seu objeto for técnico, mas aceitar
um contrato não concede aquela profissão.

## 9. Governance: autoridade não é profissão nem emprego privado

Governance representa facções, cargos e poderes institucionais. É a única
camada que pode conceder ações como prisão, multa, revista ou confisco.

Isso produz combinações coerentes:

- profissão Guarda sem cargo institucional: conhece a ocupação, mas não possui
  autoridade oficial;
- cargo institucional sem profissão Guarda: possível conforme a regra da
  facção, embora ela possa exigir a profissão como pré-requisito futuro;
- emprego privado de segurança: não permite usar poderes públicos;
- proprietário de negócio: controla sua empresa, não a lei da cidade.

## 10. Como as camadas se encontram no jogo

O mesmo quadro físico pode apresentar duas fontes de oportunidade:

```text
quadro da cidade
├─ trabalhos públicos padronizados pelo servidor
└─ contratos e missivas publicados por personagens
```

A interface pode ser compartilhada, mas as regras não:

| Atividade | Quem oferece | Quem pode fazer | Progressão | Recompensa |
|---|---|---|---|---|
| Trabalho público | servidor/mundo | qualquer personagem | nenhuma | emissão baixa e auditada |
| Ação profissional | mundo/economia | profissão e rank válidos | XP/rank profissional | recursos ou produtos |
| Contrato | parte nomeada | conforme termos | opcional, nunca implícita | escrow do contratante |
| Emprego | empregador | membro contratado | carreira social/posição | salário ou acordo futuro |
| Negócio | proprietário/administração | conforme função | crescimento da entidade | receita comercial |
| Ato institucional | facção/governo | cargo autorizado | hierarquia institucional | não é definida por Profession |

## 11. A jornada possível de um personagem

Uma personagem chega a Whiterun sem ofício. No quadro da cidade, aceita levar
fardos até um celeiro. Aprende como interagir com objetos, conhece a estrada e
recebe seus primeiros septims.

Durante as entregas, encontra uma companhia que precisa de minério. Decide
seguir Minerador, consegue uma picareta e passa a extrair de veios registrados.
O minério não vira espada sozinho: ela negocia com um Fundidor e depois com um
Ferreiro.

Com experiência, escolhe uma especialização futura. Pode continuar autônoma,
aceitar contratos de uma guilda ou ingressar formalmente numa companhia de
mineração. Dentro dela, pode começar como trabalhadora, tornar-se supervisora e
um dia abrir o próprio negócio.

Nada disso é uma missão linear obrigatória. Outro personagem pode viver de
contratos, administrar uma taverna, prestar serviços como Mensageiro ou usar
trabalhos públicos apenas em momentos de dificuldade.

## 12. Progressão e recompensa

O crescimento deve vir de atividades verificáveis, não de tempo online ou
comandos repetidos.

Princípios:

- trabalho público paga pouco e não progride profissão;
- atividade profissional concede valor econômico e pode conceder XP;
- rank representa domínio da profissão, não posição numa empresa;
- especialização diferencia o uso do conhecimento, sem criar uma segunda barra
  de XP;
- emprego e negócio geram progressão social e econômica, não conhecimento
  automático;
- contratos transferem valor já financiado, em vez de criar moeda;
- toda emissão, transferência ou destruição de valor passa pelos boundaries de
  economia e ledger;
- nenhuma barra ou timer do cliente prova conclusão.

O Profession Core já armazena XP e rank, mas a curva automática XP → rank ainda
não está definida. Até ela existir, a equipe não deve inventar números isolados
em cada profissão.

## 13. Interação física comum

Todo trabalho visível no mundo deve seguir a mesma linguagem:

```text
olhar para o alvo → prompt contextual → E → servidor valida → ação
```

Quadros, cargas, destinos, veios, estações e personagens usam o Interaction
Framework. O cliente informa intenção e alvo sob a mira; o servidor decide:

- se o alvo é o correto;
- se está na mesma célula e dentro do alcance;
- se a ação está disponível;
- se profissão, rank, ferramenta ou cargo são válidos;
- se cooldown e estado permitem continuar;
- o que será entregue ou pago.

Não haverá uma tecla ou comando diferente para cada profissão. A consistência
é parte do aprendizado do jogador e reduz protocolos duplicados no código.

## 14. Regras que protegem o ecossistema

1. Qualquer personagem pode trabalhar; nem qualquer personagem pode exercer
   conhecimento especializado.
2. Trabalho público nunca produz o recurso primário de uma profissão.
3. Profissão nunca significa vínculo empregatício automático.
4. Emprego nunca concede profissão automaticamente.
5. Posição numa empresa não é rank técnico.
6. Propriedade de negócio não concede autoridade pública.
7. Contrato não é trabalho público e não cria recompensa sem financiamento.
8. Cargo institucional pertence a Governance.
9. Cliente, animação e UI nunca são autoridade econômica.
10. Sistemas podem compartilhar interface e Interaction Framework, mas não
    tabelas, estados ou regras de domínio por conveniência.

## 15. Estado atual da implementação

| Camada | Estado atual |
|---|---|
| Profession Core | implementado e testado em LAB, desligado por padrão |
| Catálogo de 13 profissões | implementado |
| Minerador | código de gameplay em LAB; interação física aguarda homologação in-game |
| Fundidor e Curtidor | podem ser exigidos por receitas já integradas |
| Demais profissões | catálogo/progressão; loops próprios ainda não implementados |
| Specialization | decisão arquitetural aprovada; não implementada |
| Public Work | domínio e fluxo genérico implementados em LAB; flag local desligada, rotas reais e homologação pendentes |
| Contracts | serviço transacional em LAB; UI e homologação pendentes |
| Employment, Position e Business | taxonomia planejada; não implementados |
| Governance | domínio separado já existente; não deve ser absorvido por profissões |

O snapshot local desta revisão possui migration v29 e 80 tabelas declaradas. A
suíte do gamemode contém 1.262 testes: 1.261 passam e um falha porque a categoria
`work` ainda não foi adicionada à allowlist de Safe Zones. O Minerador também
precisa restringir `mining.mine` a nós `ORE`, exigir o prompt de interação como
dependência operacional e ser homologado dentro do jogo. Esses pontos impedem
tratar os loops como prontos para promoção, embora o código-base já exista.

## 16. Orientação final para a equipe

Ao propor uma nova atividade, a primeira pergunta não é “em qual arquivo de
jobs colocamos?”. As perguntas corretas são:

1. é algo que qualquer personagem pode fazer ou exige conhecimento?
2. é uma ação repetível do mundo, uma promessa pontual ou um vínculo contínuo?
3. quem financia a recompensa?
4. existe recurso criado, transformado ou apenas transportado?
5. há autoridade institucional envolvida?
6. qual domínio é dono do estado e da transação?

As respostas determinam se a atividade pertence a Public Work, Profession,
Contract, Employment, Business ou Governance. Preservar essa separação é o que
permitirá ampliar o servidor sem transformar toda nova ideia num `jobs-service`
genérico, difícil de balancear, proteger e manter.

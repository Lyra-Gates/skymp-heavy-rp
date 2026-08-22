# Assinatura do Artesão (Maker's Mark) — gamedesign

**Estado: IMPLEMENTADO (lab), 22/08/2026.** O Nível 1 deste documento (§4)
está no código: `crafted_item_signatures` (migration-v24), gate de rank em
`crafting-service.craftItem()`, revista institucional em
`governance-service.notifyMakerSignatures`. Como todo módulo `lab`, nasce
atrás de flag (`ENABLE_CRAFTING_SERVICE`) e **nunca rodou com jogador real**
— só teste automatizado contra banco falso, mesmo estado de Crime/Proveniência
e Depot. Nível 2 (§4, itens verdadeiramente não-fungíveis) continua proposta,
não recomendada.

Origem: pedido do dono do projeto em 22/08/2026, motivado pelo sistema de
Crime/Proveniência (`item_instances`, ver [CRIME_SYSTEM_AUDIT.md](../technical/CRIME_SYSTEM_AUDIT.md))
— itens roubados carregam proveniência de dono; a ideia complementar é itens
**criados** carregarem proveniência de autor.

## 0. O que mudou entre a proposta e a implementação

- **§6 apontava que o gate `required_profession`/`required_rank` não existia
  em `main`.** Investigando pra implementar, apareceu inteiro — testado, 606
  linhas — numa branch órfã (`feat/crafting-profession-integration`,
  20/08/2026) nunca mesclada. Foi trazido em vez de reimplementado; a
  migration que ele trazia (`v20`) foi renumerada para `v23` porque `main` já
  tinha `v20` (Depot) e `v21`/`v22` (Crime) quando o merge aconteceu. Ver o
  commit de merge e `docs/gameplay/PROFESSION_FRAMEWORK.md`.
- **`owner_character_id` não é mantido em sincronia com trade/venda/depósito**
  nesta rodada — nenhum desses três serviços escreve em
  `crafted_item_signatures`. A revista mostra "quem recebeu no craft", não
  necessariamente "quem tem o item agora". Registrado no comentário da coluna
  em `migration-v24-crafted-item-signatures.sql`.
- **Atomicidade**: a gravação da assinatura NÃO é a mesma transação do
  `inventory.exchange` do craft — decisão deliberada, ver o cabeçalho de
  `crafting-service.js` e §4 abaixo.
- Nenhuma receita de Ferreiro/Encantador/Cozinheiro existe ainda (§9,
  inalterado) — o teste de integração (`crafting-governance-integration.test.js`)
  usa uma receita fictícia de `blacksmith` porque nenhuma real está cadastrada
  em `seed-forging.sql`.

---

## 1. Objetivo

Um artesão com XP/rank suficiente pode marcar um item que fabrica com sua
assinatura (nome do artesão, ou nome customizado pedido por quem encomendou —
"para Lydia, de João Ferreiro"). Isso dá textura de RP old-school (ferreiros
que assinam trabalho) e cria um motivo econômico pra comprar de um artesão
reconhecido em vez do primeiro NPC/PC que aparece.

**Escopo confirmado com o dono do projeto**: não é exclusivo do Ferreiro —
qualquer profissão de `category: 'crafting'` no registry (`smelter`,
`blacksmith`, `tanner`, `enchanter`, `cook`) é candidata. O gate (rank mínimo)
é por profissão, não um caso especial de uma só.

## 2. Problema que resolve

Hoje, dois itens do mesmo `baseId` são idênticos em todo lugar do projeto —
inventário, barraca, depósito. Não existe reputação de artesão: o rank de
Ferreiro (quando tiver gameplay) afeta o que você pode craftar, nunca quem
sabe que craftou. "Comprar de um ferreiro bom" não é hoje distinguível de
"comprar de qualquer um".

## 3. Por que isto NÃO é barato — o achado principal desta análise

Antes de desenhar a API, three fatos do código atual mudam o formato da
proposta:

### 3.1 `character_inventory` é puramente fungível, sem exceção

`migration-v14-inventory-framework.sql` tem
`UNIQUE (owner, base_id)` — **uma linha por (personagem, item), só com
contagem**. Não existe, em lugar nenhum do projeto, uma unidade de item com
identidade própria dentro do inventário normal. Duas espadas de ferro do
mesmo dono são sempre "2", nunca "esta e aquela".

### 3.2 `item_instances` (crime) já resolveu um problema parecido — mas não do jeito que a intuição sugere

`markItemStolen` (`core/crime-service.js:178-261`) não marca **a unidade
física roubada**. Ele faz `UPDATE`/`INSERT` numa linha chaveada por
`(base_id, current_owner_id, status)` — ou seja, "este personagem tem, no
tipo de item X, uma unidade com proveniência suja", não "o terceiro item da
pilha é o roubado". Funciona para crime porque a pergunta que a revista
institucional faz é binária: *"algo neste tipo de item que você carrega é
roubado?"* — não importa qual das 3 espadas idênticas é a exata.

**Assinatura de artesão faz uma pergunta diferente**: não "este item é
suspeito", mas "qual DESTAS 3 espadas idênticas é a que o João assinou".
Duas espadas assinadas por dois artesãos diferentes, do mesmo `baseId`, na
mesma mochila, são o caso normal de uso — e o modelo atual de
`item_instances` não foi desenhado pra distinguir isso; ele foi desenhado
deliberadamente para NÃO precisar disso (ver `CRIME_SYSTEM_AUDIT.md` §3,
"Inventário deixa de ser 100% fungível para o subconjunto de itens
roubados" — o subconjunto é 1 flag por tipo, não N objetos rastreados).

### 3.3 O nome não aparece no jogo em si

`base_id` é um FormDesc do Skyrim (`"162e2:Skyrim.esm"`-style — ver a
convenção registrada em memória do projeto). O servidor não controla o nome
que o cliente Skyrim mostra pra aquele objeto — não existe, hoje, nenhum
mecanismo (client mod, UI CEF, injeção de nome) que troque "Espada de Ferro"
por "Espada de Ferro (assinada por João)" na tela do jogador. Isso só é
visível através de UI própria do projeto — exatamente como a revista
institucional de crime já faz (ela não muda o nome do item no HUD do Skyrim,
ela mostra a proveniência numa notificação/painel).

## 4. Design proposto — dois níveis, escopo crescente

### Nível 1 (recomendado para entregar primeiro): assinatura como metadado do tipo, não do objeto

Aceita a mesma simplificação que o crime já aceita. Uma tabela nova,
**desacoplada de `item_instances`** (crime é sobre culpa, isto é sobre
autoria — misturar as duas faria uma feature de crime carregar uma
responsabilidade que não é dela):

```sql
CREATE TABLE crafted_item_signatures (
  id              CHAR(36)     PRIMARY KEY,   -- uuid, mesmo padrão de item_instances.id
  base_id         BIGINT       NOT NULL,
  maker_character_id   INT     NOT NULL,
  owner_character_id   INT     NOT NULL,      -- quem tem hoje (igual a maker até vender/trocar)
  signature_text  VARCHAR(64)  NULL,           -- nome custom pedido pelo comprador; NULL = usa o nome do artesão
  crafted_at      DATETIME     NOT NULL,
  recipe_id       INT          NOT NULL,
  FOREIGN KEY (maker_character_id) REFERENCES characters(id),
  FOREIGN KEY (owner_character_id) REFERENCES characters(id),
  INDEX idx_signature_owner_base (owner_character_id, base_id)
);
```

Fluxo:

1. `craftItem` ganha `opts.signatureText` opcional.
2. Gate: só aceito se `professionService.getProfessionState(characterId, recipe.crafting_profession_code)`
   tiver `status === 'active'` **e** `rank >= profession.signatureMinRank`
   (novo `server-options`, sugestão: default = `Math.ceil(profession.maxRank / 2)` — rank 2 de 3, não o
   topo, pra não travar a feature atrás de um teto que hoje nem existe conteúdo pra alcançar).
3. Craft bem-sucedido com assinatura grava uma linha em
   `crafted_item_signatures`, na MESMA transação do `inventory.exchange`
   (mesmo padrão que `crime-service` já usa: proveniência e movimento de
   item não podem divergir).
4. Revista/inspeção (reuso do canal que `governance-service.showInventorySnapshot`
   já expõe para crime) passa a mostrar, por tipo de item que o alvo carrega,
   se há assinatura conhecida — igual à provenance de crime, mesmo canal de
   UI, dado diferente.
5. **Limitação assumida, documentada, igual à do crime**: se o personagem tem
   2 espadas de ferro, uma assinada e uma não (ou duas assinadas por
   artesãos diferentes), o sistema sabe que "existe pelo menos uma
   assinatura entre suas espadas de ferro", não qual unidade física é qual.
   Suficiente pra flavor de RP ("dizem que uma dessas é trabalho do
   Balgruuf"), insuficiente pra prova de posse individual peça-a-peça.

### Nível 2 (não recomendado agora): objetos verdadeiramente não-fungíveis

Faria `character_inventory` deixar de ser puramente uma contagem para itens
assinados — cada unidade assinada vira uma linha própria, fora do `count`
agregado, e teria que se propagar por **todo** consumidor de inventário:
`trade`, `market-stalls-service`, `depot-service`, `crime-service`. É a
mesma decisão que o próprio crime system evitou deliberadamente (ver §3.2) —
reabrir essa fronteira pra uma segunda feature multiplicaria o risco, não
dividiria. Só faz sentido se um dia o projeto decidir que "item único
rastreável fisicamente" é uma capacidade central (ex.: itens lendários,
relíquias de quest), e nesse caso a decisão certa é desenhar isso uma vez
para servir todos os casos, não uma vez por feature que pedir unicidade.

## 5. Preço de venda — não precisa de mecanismo novo

`market-stalls-service.addItem` já aceita um `price` arbitrário definido por
quem lista (`/stalladd <stallId> <baseId> <count> <price> <rotulo>`) — não
há motor de precificação automática por qualidade no projeto hoje. Um item
assinado por um artesão reconhecido **já pode** ser listado por mais gold
hoje, sem mudança nenhuma — é o jogador decidindo, e o mercado (outros
jogadores) decidindo se paga. A assinatura dá o jogador uma *razão in-game*
pra esse preço ser crível ("é do Balgruuf, ele é rank 3"), não um multiplicador
de sistema. **Não implementar** ajuste automático de preço por assinatura —
seria o motor decidindo valor de RP, papel que é do jogador.

Serviço por encomenda ("faça uma espada com o nome da minha esposa") é
puramente RP + o `signatureText` do Nível 1 — não precisa de mecanismo de
contrato novo; se crescer a ponto de precisar de fila/pagamento formal, o
Contract Framework (`docs/gameplay/CONTRACTS.md`) já existe pra isso e é
reuso, não feature nova.

## 6. Compatibilidade com sistemas atuais

| Sistema | Impacto |
|---|---|
| `profession-service.js` | Só leitura (`getProfessionState`) — nenhuma escrita nova. Precisa do rank/XP real ganhando xp por craft, que **ainda não existe** (`PROFESSION_FRAMEWORK.md` §11: "Curva de XP → level-up" não implementada). Sem isso, `signatureMinRank` só é alcançável por ajuste manual de staff (`profession.xp` capability) — aceitável para lançar em `lab`, mas registrar como dependência real. |
| `crafting-service.js` | Precisa do gate `required_profession`/`required_rank` por receita para sequer saber QUAL profissão craftou o item. **Este gate não existe em `main` hoje** — `PROFESSION_FRAMEWORK.md` §11 descreve uma `migration-v20-crafting-profession-gate.sql` que, checado agora, não existe: `v20` em `main` é `depot-service`, não crafting-gate. É a mesma advertência já registrada em memória do projeto ("main é subconjunto, não o estado mais avançado" — 3 migrations v20 concorrentes em branches não mescladas). **Pré-requisito real**: localizar/mesclar esse gate antes ou junto desta feature, senão "assinatura de Ferreiro" não sabe distinguir um craft de Ferreiro de um craft de qualquer personagem. |
| `item_instances` (crime) | Tabela irmã, não reuso direto — ver §4. Se o mesmo item depois for roubado, os dois sistemas convivem: `markItemStolen` continua sem saber de assinatura (não precisa saber), e a revista de guarda passaria a mostrar as duas informações lado a lado (proveniência de posse + autoria), de fontes diferentes. |
| `market-stalls-service.js` | Nenhuma mudança de schema necessária — preço já é livre (§5). |
| Contratos (`contracts-service.js`) | Reuso futuro opcional para encomendas formais — nenhuma dependência obrigatória agora. |
| Skyrim engine / nome do item | Sem mudança — nome visto no jogo continua o do `base_id`. Assinatura só existe nas UIs do próprio projeto. |

## 7. Exploits a considerar (mesmo formato do audit de crime)

- **Autoatribuição de assinatura sem craft real**: `signatureText` só pode ser
  gravado dentro da MESMA transação de um `inventory.exchange` bem-sucedido
  de `craftItem` — nunca uma escrita solta chamável por comando de jogador.
- **Falsificar autoria de artesão famoso**: `maker_character_id` vem sempre de
  `characterId` que efetivamente craftou (mesmo argumento de `craftItem`),
  nunca de texto livre do cliente — só o `signatureText` (a dedicatória) é
  livre, nunca o "assinado por". Sanitizar/limitar tamanho do `signatureText`
  (64 chars, sem controle de formatação) evita abuso de chat injection na
  revista/UI.
- **Reputação de artesão sendo usada para golpe** (vender item "assinado por
  fulano" que na verdade não é): resolvido por construção — a linha em
  `crafted_item_signatures` só existe se o craft realmente aconteceu por
  aquele personagem; não há caminho de escrita que permita "carimbar" um
  item já existente depois do fato.

## 8. Impacto econômico

Nenhuma criação de valor por si só — não altera `characters.gold`,
`transaction-service`, nem impostos. O efeito econômico é 100% emergente do
mercado (jogadores pagando mais por reputação), não um multiplicador de
sistema. Consistente com a linha do projeto de nunca deixar um sistema
"decidir" valor de RP por conta própria (mesmo princípio que manteve a
economia regional PARKED até reengenharia).

## 9. Pré-requisitos — estado em 22/08/2026

1. ✅ **Gate `required_profession`/`required_rank` em `crafting_recipes`** —
   trazido de `feat/crafting-profession-integration` para `main`
   (`migration-v23-crafting-profession-gate.sql`, ver §0).
2. ❌ **Pelo menos uma receita real de Ferreiro/Encantador/Cozinheiro** —
   continua sem existir. Fundidor e Curtidor são as únicas com
   `required_profession` preenchido em `seed-forging.sql`. Forjar uma receita
   de Ferreiro de verdade continua exigindo um `result_base_id` confirmado,
   não inventado — nenhum PR deste documento inventou um.
3. ✅ **XP por craft** (`addProfessionXp` dentro de `craftItem`) — veio
   junto com o item 1, via `crafting.xpPerCraft`.
4. ✅ **`crafted_item_signatures`** (Nível 1, §4) e o parâmetro
   `crafting.signatureMinRank` (default 2) — `migration-v24-crafted-item-signatures.sql`.

## 10. O que ficou pendente

- **Receita real de Ferreiro** (item 2 acima) — sem ela, a Assinatura do
  Artesão só é demonstrável hoje via Fundidor/Curtidor (que já têm
  `required_profession`) ou por teste de integração com receita fictícia
  (`crafting-governance-integration.test.js`).
- **`owner_character_id` não segue o item em trade/venda/depósito** (§0) —
  ligar isso exigiria tocar `trade-service.js`, `market-stalls-service.js` e
  `core/depot-service.js`, o mesmo "toque todo consumidor de inventário" que
  o Nível 2 (§4) já descartava como escopo desproporcional. Deixado como
  limitação conhecida, não como bug.
- **Nunca rodou com jogador real** — mesmo estado de todo módulo `lab` deste
  projeto.

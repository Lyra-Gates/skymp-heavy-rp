# Matriz de segurança da economia

**O que está travado por teste, o que está travado só pelo banco, e o que não
está travado.** As três colunas existem porque misturá-las é como um projeto
acha que está testado.

- Executar: `cd skymp/gamemode && npm test`
- Só a economia: `node --test core/economy-service.test.js contracts-service.test.js debt-service.test.js`
- Estado em 13/08/2026: **784 testes, 784 passando**, dos quais **68** são desta matriz.

Referências: [auditoria](../research/ECONOMY_FRAMEWORK_AUDIT.md) ·
[ADR 004](../technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md) ·
[framework](../framework/ECONOMY_FRAMEWORK.md)

---

## 0. A afirmação central

> Toda mudança de saldo do gamemode passa por `core/economy-service.js` ou por
> `core/transaction-service.js`, acontece dentro de uma transação, grava as duas
> pernas no ledger, e recusa em vez de falhar em silêncio.

Isso é verdade **para o código**, e foi verificado por mutação. Não é verdade
para o servidor rodando — nada aqui foi visto com gente dentro. A
[Fase 0](../technical/FASE_0_ROTEIRO.md) continua sendo o bloqueio real, e um
Economy Framework testado só com `mp` mockado e MySQL simulado é o quinto
sistema nessa condição.

---

## 1. Mutação: os testes reprovam quando o código piora?

Um teste que passa com o bug de volta não testa nada. Quatro mutações foram
aplicadas ao código real e revertidas depois:

| Mutação aplicada | Teste que reprovou | ✓ |
|---|---|---|
| Remover a ordenação canônica em `_lockPair` (voltar a travar "pagador, recebedor") | `trava sempre na mesma ordem, independente de quem paga` | ✅ |
| Remover a consulta de replay de dentro da transação | `repetir a mesma chave devolve o resultado original` + `a consulta de replay acontece DENTRO da transacao` | ✅ |
| Remover a guarda de estouro do `INT` no crédito | `recusa credito que estoura o INT do saldo` | ✅ |
| Acrescentar `delivered` a `EXPIRABLE` (deixar a expiração roubar trabalho entregue) | `NAO expira contrato ja entregue, mesmo com o prazo vencido` | ✅ |
| Remover a checagem `creator_cannot_accept` | `o criador nao pode aceitar o proprio contrato` | ✅ |

Cinco mutações, cinco reprovações, nenhum falso verde.

---

## 2. Os itens do briefing §13, um a um

| Ameaça | Onde é fechada | Teste | Estado |
|---|---|---|---|
| **negative values** | `normalizeAmount` recusa `≤ 0`; saldo checado sob `FOR UPDATE`; `WHERE ... + ? >= 0` no `UPDATE` de tesouro; `CHECK (balance >= 0)` no escrow | `recusa valor zero` · `recusa valor negativo` · `saldo insuficiente devolve code e nao move nada` | ✅ |
| **integer overflow** | `MAX_GOLD = 2147483647` recusa crédito que estouraria | `recusa valor acima do teto do INT` · `recusa credito que estoura o INT do saldo` | ✅ |
| **double spend** | `SELECT ... FOR UPDATE` antes de todo débito; checagem de saldo sob a trava | `saldo insuficiente devolve code e nao move nada` | ⚠️ lógica testada, concorrência não (§4.1) |
| **race** | travas em ordem canônica `type:ref` | `trava sempre na mesma ordem` | ⚠️ ordem testada, corrida não |
| **replay** | chave crua na perna de débito, `UNIQUE` + `FOR UPDATE` dentro da transação | `repetir a mesma chave devolve o resultado original` · `a consulta de replay acontece DENTRO da transacao` | ✅ |
| **fake contract** | `create` exige escrow financiado na mesma transação; categoria vem de lista fechada | `sem saldo nao sobra contrato — fail-closed` · `recusa categoria fora da lista` | ✅ |
| **fake completion** | só quem aceitou entrega; só o criador (ou a varredura) acerta | `so quem aceitou declara entrega` · `o trabalhador nao pode se pagar` | ✅ |
| **unauthorized cancellation** | só o criador, e só enquanto `open` | `so o criador cancela` · `nao cancela depois de aceito` | ✅ |
| **escrow duplicate release** | `status` sai de `held` sob a mesma trava; replay checado antes do status | `liberar duas vezes com chaves diferentes e recusado` · `reenviar a MESMA liberacao devolve replay` | ✅ |
| **disconnect** | banco é a fonte de verdade; cliente é tocado só depois do commit | (herdado do `transaction-service`) | ⚠️ §4.3 |
| **DB rollback** | falha de infraestrutura **lança**, nunca vira `ok:false` | `falha de infraestrutura LANCA — nao vira {ok:false}` (×3 serviços) | ✅ |

---

## 3. Os itens do briefing §16

### 3.1 `transfer`

| Cenário | Teste | ✓ |
|---|---|---|
| Move saldo dos dois lados | `move o saldo e grava as duas pernas com o mesmo transfer_id` | ✅ |
| As duas pernas compartilham `transfer_id` | idem | ✅ |
| Chave crua no débito, `#in` no crédito | idem | ✅ |
| Tesouro credita **com** ledger | `credita tesouro de cidade COM ledger dos dois lados (Achado 2)` | ✅ |
| `character_id` nulo para titular não-personagem | idem | ✅ |
| Ator registrado quando ≠ titular | `registra o ator quando quem pediu nao e o titular` | ✅ |
| Recusa transferência para si mesmo | `recusa transferencia para a propria conta` | ✅ |
| Recusa titular desconhecido | `recusa tipo de titular desconhecido` | ✅ |
| Recusa `system` sem rótulo legível | `recusa system sem rotulo legivel` | ✅ |
| Conta inexistente é recusa, não exceção | `conta inexistente e recusa, nao excecao` | ✅ |
| Valores inválidos (0, negativo, NaN, fracionário, string, acima do teto) | 6 testes | ✅ |

### 3.2 `double request`

| Cenário | Teste | ✓ |
|---|---|---|
| Segunda chamada com a mesma chave devolve `{ok:true, replayed:true}` | `repetir a mesma chave devolve o resultado original sem mover de novo` | ✅ |
| ...com o `transferId` original | idem | ✅ |
| ...sem cobrar de novo e sem gravar de novo | idem | ✅ |
| A consulta acontece depois do `beginTransaction` | `a consulta de replay acontece DENTRO da transacao` | ✅ |
| Replay de pagamento de dívida | `reenviar o MESMO pagamento nao cobra duas vezes` | ✅ |
| Replay de acerto de contrato | `reenviar o MESMO acerto devolve replay, nao erro` | ✅ |
| Replay de criação de contrato | `repetir a criacao com a mesma chave nao publica dois contratos` | ✅ |
| Replay de liberação de escrow | `reenviar a MESMA liberacao devolve replay, nao escrow_not_held` | ✅ |

### 3.3 `market sale`

| Cenário | Teste | Onde | ✓ |
|---|---|---|---|
| Estoque, ouro, imposto e inventário num commit só | `abre uma transacao e commita uma vez` | `market-stalls-purchase.test.js` | ✅ |
| Comprador paga o total, vendedor recebe líquido | `debita o comprador e credita o vendedor descontando o imposto` | idem | ✅ |
| **Imposto tem linha de ledger** (Achado 2) | `registra o pagamento E o imposto no ledger` | idem | ✅ |
| **A soma dos deltas de uma venda dá zero** | idem | idem | ✅ |
| Sem saldo → rollback, nada parcial | `recusa sem deixar rastro parcial` | idem | ✅ |
| Erro interno não vaza para a tela | idem | idem | ✅ |
| `requestId` repetido não cobra duas vezes | `repete o mesmo requestId sem cobrar...` | idem | ✅ |
| Mercado regional: compra/venda contra `system` | `compra estoque, ouro e inventario no mesmo commit` · `venda move item, ouro, imposto, estoque e ledger` | `core/regional-market-...test.js` | ✅ |

### 3.4 `contract` e `escrow`

| Cenário | Teste | ✓ |
|---|---|---|
| Escrow trava no post | `trava a recompensa no momento da publicacao` · `trava o valor no post` | ✅ |
| Sem saldo → **sem contrato** (fail-closed) | `sem saldo nao sobra contrato` · `nao abre escrow sem saldo` | ✅ |
| Acerto paga exatamente a recompensa | `paga exatamente a recompensa ao trabalhador e fecha o escrow` | ✅ |
| Criador não aceita o próprio contrato | `o criador nao pode aceitar o proprio contrato` | ✅ |
| Segundo trabalhador não rouba contrato aceito | `um segundo trabalhador nao rouba um contrato ja aceito` | ✅ |
| Trabalhador não se paga | `o trabalhador nao pode se pagar` | ✅ |
| Acerto duplo recusado | `acertar duas vezes com chaves diferentes e recusado` | ✅ |
| Devolução ao financiador marca `refunded` | `devolver ao financiador marca refunded, nao released` | ✅ |
| Propósito de escrow fora da lista | `recusa proposito fora da lista` | ✅ |

### 3.5 `cancel` e `expire`

| Cenário | Teste | ✓ |
|---|---|---|
| Cancelar devolve o escrow ao criador | `devolve o escrow ao criador enquanto aberto` | ✅ |
| Cancelar após aceite é recusado | `nao cancela depois de aceito` | ✅ |
| Só o criador cancela | `so o criador cancela` | ✅ |
| Expirar aberto devolve ao criador | `expira aberto e devolve ao criador` | ✅ |
| **Expiração NÃO toca trabalho entregue** | `NAO expira contrato ja entregue, mesmo com o prazo vencido` | ✅ |
| Não expira antes da hora | `nao expira antes da hora` | ✅ |
| Contrato sem prazo nunca expira | `contrato sem prazo nunca expira` | ✅ |
| Acerto automático após a janela | `acerta sozinho depois da janela de revisao` | ✅ |
| Não acerta dentro da janela | `nao acerta sozinho dentro da janela` | ✅ |
| Disputa trava tudo, varredura não decide | `disputa trava tudo: ninguem recebe e a varredura nao decide` | ✅ |
| Só o criador disputa | `so o criador disputa` | ✅ |

### 3.6 `debt`

| Cenário | Teste | ✓ |
|---|---|---|
| **Abrir dívida não move septim** | `registra sem mover septim nenhum` | ✅ |
| A mesma origem não vira duas dívidas | `a mesma origem nao vira duas dividas` | ✅ |
| Dívida consigo mesmo recusada | `recusa divida consigo mesmo` | ✅ |
| Credor `system` recusado | `recusa credor system — ninguem deve ao vazio` | ✅ |
| Credor institucional aceito | `aceita credor institucional` | ✅ |
| Pagamento move septim e abate | `move o septim e abate o saldo devedor` | ✅ |
| Quitação zera e fecha | `quitar zera e fecha` | ✅ |
| **Transferência falha → `remaining` NÃO cai** | `se a transferencia falha, o saldo devedor NAO cai` | ✅ |
| Pagar acima do saldo devedor recusado | `recusa pagar mais do que se deve` | ✅ |
| Dívida fechada não aceita pagamento | `nao paga divida ja quitada` | ✅ |
| Perdão zera sem mover septim | `zera sem mover septim` | ✅ |
| Perdão parcial deixa a dívida viva | `perdao parcial deixa a divida viva` | ✅ |
| **`defaulted` não confisca e não bloqueia** | `marcar defaulted nao move nada e nao bloqueia pagamento` | ✅ |

### 3.7 `admin adjustment`

| Cenário | Teste | ✓ |
|---|---|---|
| Crédito vem de `system:staff_adjust` | `credita contra system e deixa o ator no ledger` | ✅ |
| Débito vai para `system:staff_adjust` | `debita contra system quando o valor e negativo` | ✅ |
| Ator obrigatório | `exige ator — ajuste anonimo nao existe` | ✅ |
| `/setgold` passa pelo ledger, nunca por `UPDATE` solto | `setGold move ouro pelo ledger, nunca por UPDATE solto` (`permissions.behavior.test.js`) | ✅ |

### 3.8 `rollback`

| Cenário | Teste | ✓ |
|---|---|---|
| Falha na economia lança e dá rollback | `falha de infraestrutura LANCA — nao vira {ok:false}` | ✅ |
| Falha na criação de contrato lança e dá rollback | `lanca e da rollback em vez de devolver {ok:false}` | ✅ |
| Falha no pagamento de dívida lança e dá rollback | idem, `debt-service.test.js` | ✅ |
| Falha na compra em barraca dá rollback sem rastro | `recusa sem deixar rastro parcial` | ✅ |

### 3.9 `concurrent transactions`

**⚠️ Não coberto.** Ver §4.1.

---

## 4. O que **não** está coberto, e por quê

### 4.1 Concorrência real

Nenhum teste roda duas operações ao mesmo tempo contra um MySQL de verdade.

O que **está** verificado: que os `SELECT ... FOR UPDATE` são emitidos, que a
ordem das travas é canônica, que a consulta de replay acontece depois do
`beginTransaction`, e que o `UPDATE` de saldo repete a guarda no `WHERE`.

O que **não** está: que o InnoDB serializa como a lógica assume. Duas pessoas
aceitando o mesmo contrato no mesmo milissegundo, ou comprando da barraca uma da
outra simultaneamente, nunca foi observado — só raciocinado.

Fechar isso exige banco real e concorrência real, que é trabalho de Fase 0.

### 4.2 Concorrência entre `getGold` e o delta no `/setgold`

`admin-service.setGold` lê o saldo fora da transação e aplica um delta. Se o
saldo mudar entre as duas, o resultado é o valor pedido pela staff com um desvio
do tamanho da operação concorrente. Isso é **conhecido e aceito**, está
documentado no próprio arquivo, e o ledger mostra as duas linhas — a divergência
é visível em vez de silenciosa.

### 4.3 Reconciliação cliente ↔ servidor

`applyToClient` roda depois do commit e não é `await`ado por ninguém. Se falhar,
o banco está certo e o cliente não. A reconciliação de login existe para item;
ouro não tem espelho no cliente, então o problema é menor — mas nenhum teste
observa uma falha de `applyToClient` seguida de reconexão.

### 4.4 Reconciliação de saldo contra o ledger

`economy.reconcile()` existe e funciona. **Nada a executa periodicamente.** E ela
só é conclusiva para saldos que nasceram depois da v15: `characters.gold` tem
história anterior ao ledger e vai divergir por construção — por isso a função
devolve `ledgerSum` junto, e não só um veredito.

### 4.5 A migration v15

Não foi aplicada em banco nenhum. `npm run check:schema:list` confirma que as
cinco tabelas novas e as seis colunas novas são **declaradas**; que o `ALTER`
roda em MariaDB real, ninguém viu.

Duas armadilhas do `check-schema-drift.js` registradas no arquivo da migration:

1. `MODIFY COLUMN` não é lido — a nulabilidade de `gold_transactions.character_id`
   não aparece como drift se a migration não for aplicada. Conferir à mão.
2. **Um `;` dentro de um `COMMENT '...'` corta o corpo do `ALTER`** e faz as
   cláusulas `ADD INDEX` seguintes sumirem da declaração esperada, em silêncio.
   Isso aconteceu ao escrever esta v15 — três índices ficaram invisíveis até a
   causa ser encontrada. Nenhum `COMMENT` do arquivo usa ponto e vírgula.

### 4.6 Serviços PARKED com o padrão antigo

`housing-service.buyProperty` e `horse-service` ainda cobram numa transação e
entregam em outra
([Achado 9](../research/ECONOMY_FRAMEWORK_AUDIT.md#10-achado-9--compra-de-propriedade-cobra-antes-de-entregar)).
Eles não rodam, e `parked-services-ledger.test.js` garante que pelo menos passam
pelo `transaction-service` em vez de `UPDATE ... SET gold` solto. Migrar para o
`economy-service` está pendente, e **migrar não é reativar**.

### 4.7 `accounts.coins`

Fora de escopo por decisão de produto
([Achado 12](../research/ECONOMY_FRAMEWORK_AUDIT.md#13-achado-12--accountscoins-é-dinheiro-e-não-está-nesta-auditoria)).
Nenhum teste, porque nenhum código do gamemode toca a coluna — e a ausência de
caminho de conversão para septim é a coisa certa.

### 4.8 Uma sessão real

Zero. Nenhuma multa foi aplicada, nenhum contrato foi publicado, nenhum escrow
foi liberado num servidor com jogadores. É a mesma ressalva de toda matriz deste
repositório, e continua sendo a mais importante.

---

## 5. Como rodar

```bash
cd skymp/gamemode && npm test
```

Só a economia:

```bash
cd skymp/gamemode && node --test core/economy-service.test.js contracts-service.test.js debt-service.test.js core/transaction-service.test.js market-stalls-purchase.test.js core/regional-market-transaction-service.test.js
```

Conferir o schema declarado (não precisa de banco):

```bash
cd skymp/gamemode && npm run check:schema:list
```

Conferir contra um banco real:

```bash
cd skymp/gamemode && npm run check:schema
```

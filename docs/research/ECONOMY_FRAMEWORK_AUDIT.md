# Auditoria: economia, ledger e o que falta para contratos

**Data:** 2026-08-13
**Escopo:** todo caminho de dinheiro do gamemode — `characters.gold`, os quatro
tesouros institucionais, os três ledgers, e os doze chamadores que os movem.
**Método:** leitura do código de origem; nada aqui foi observado em servidor
rodando (ver [Fase 0](../technical/FASE_0_ROTEIRO.md)).
**Motivador:** o briefing de Economy Framework §2, e o `CONTRACT-001` do
[roadmap de adaptação](../roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md#p3--economia-e-contratos),
que depende de uma economia que ainda não sabe nomear as duas pontas de um
pagamento.

---

## 0. Resumo executivo

O `core/transaction-service.js` é bom no que ele decidiu ser: **ele protege o
patrimônio de um personagem**. Transação real, `SELECT ... FOR UPDATE` antes de
todo débito, ledger obrigatório, recusa de saldo negativo sob concorrência. Isso
é mais rigor do que qualquer fork do ecossistema demonstra
([matriz](SKYMP_ECOSYSTEM_MATRIX.md), §"Fronteira transacional"), e nada nesta
auditoria pede para desfazer.

O problema é o que ele decidiu **não** ser. Ele não é um serviço de economia; é
um serviço de saldo de personagem. E a diferença aparece exatamente onde o
briefing quer construir:

| O que o briefing quer | O que hoje impede |
|---|---|
| Ledger que responde "quem pagou quem" (§5) | `gold_transactions` grava uma perna por linha, sem contraparte e sem `transfer_id`. As duas pernas de uma venda são duas linhas que nada liga (**Achado 1**) |
| Tesouro dentro da mesma infraestrutura (§15) | Imposto de barraca e de mercado regional entra em `cities.treasury`/`holds.treasury` **sem nenhuma linha de ledger**. O dinheiro sai do ledger no instante em que vira imposto (**Achado 2**) |
| Idempotência obrigatória (§6) | A checagem de `transfer()` consulta uma chave que o próprio `transfer()` nunca grava — ela nunca casa. O que salva é a UNIQUE do banco, e o preço é o chamador receber `false` numa operação que deu certo (**Achados 5 e 7**) |
| Escrow que trava ouro (§8) | Não existe entidade capaz de *segurar* ouro. Ouro só existe em personagem ou em tesouro, e tesouro não tem serviço de crédito genérico (**Achado 11**) |
| `economy.adjust` auditável (§12) | `/setgold` já passa pelo ledger — este é o único item do briefing que já está feito, e foi feito pelo motivo certo |

Doze achados. Nenhum é uma vulnerabilidade de duplicação de ouro explorável hoje
— a UNIQUE do `idempotency_key` e o `FOR UPDATE` fecham os dois caminhos óbvios.
São, em ordem de importância: **um ledger que não fecha**, **quatro tesouros
fora dele**, e **um contrato de erro que confunde "recusado" com "quebrou"**.

O terceiro é o que mais dói no Heavy RP. Hoje, se o banco cair no meio de uma
multa, o jogador ganha um mandado de prisão por inadimplência que ele não
cometeu (**Achado 8**).

---

## 1. O inventário do dinheiro

### 1.1 Os saldos

Sete colunas guardam valor. Elas não têm nada em comum além do tipo.

| Onde | Coluna | Quem escreve | Tem ledger? |
|---|---|---|---|
| `characters` | `gold` | só `_applyGoldDelta` (`transaction-service.js:216`) | ✅ `gold_transactions` |
| `holds` | `treasury` | `regional-market...:150` (imposto), `institutional-treasury...:105` (saque) | ⚠️ só o saque |
| `factions` | `treasury` | `institutional-treasury-service.js:113` | ✅ `institutional_treasury_transactions` |
| `cities` | `treasury` | `market-stalls-service.js:863` (imposto) | ❌ nenhum |
| `realms` | `treasury` | ninguém | — (coluna morta) |
| `shops` | `tax_debt` | ninguém | — (coluna morta) |
| `accounts` | `coins` | fora do gamemode (loja) | ❌ — ver **Achado 12** |

O `characters.gold` é o único com a propriedade que o briefing §3 descreve:
saldo é snapshot, ledger é história, e a soma dos deltas reconstrói o snapshot.
Para os outros seis isso é falso ou não se aplica.

### 1.2 Os ledgers

Três tabelas, nenhuma delas parente da outra:

- **`gold_transactions`** (`schema.sql:386`) — `(transaction_id, character_id,
  delta, reason, module, idempotency_key, status, created_at)`. Uma perna por
  linha. Sem contraparte, sem `transfer_id`.
- **`inventory_transactions`** (`schema.sql:371` + [migration v14](../../skymp/packages/database/migration-v14-inventory-framework.sql))
  — a mesma forma, **mais** `owner_type`, `owner_ref`, `counterparty_type`,
  `counterparty_ref`, `transfer_id`. É o desenho que o ouro deveria ter e não
  tem. A v14 resolveu para item o problema que o **Achado 1** descreve para
  dinheiro.
- **`institutional_treasury_transactions`** ([v11](../../skymp/packages/database/migration-v11-institutional-treasury.sql))
  — cobre exatamente um movimento (Hold → facção regente) e nada mais.

Mais duas tabelas que são registro de negócio, não ledger: `market_stall_sales`
e `regional_market_transactions`. Elas guardam o `tax_amount`, e hoje são o
**único** rastro do imposto (**Achado 2**).

### 1.3 Quem move dinheiro

| Chamador | Caminho | Atômico com o resto da operação? |
|---|---|---|
| `market-stalls-service.buyItem` | `tx.applyGoldDelta` ×2 + SQL de imposto | ✅ sim, uma transação |
| `regional-market-transaction-service` | `tx.applyGoldDelta` + SQL de imposto | ✅ sim |
| `institutional-treasury-service` | SQL próprio, ledger próprio | ✅ sim |
| `admin-service.setGold` | `addGold`/`removeGold` | ✅ é uma perna só |
| `governance-service.fineTarget` | `removeGold` + `INSERT INTO fines` | ❌ **Achado 8** |
| `death-service` (penalidade) | `removeGold` | ✅ perna só — mas o ouro evapora |
| `whitelist.js` (ouro inicial) | `addGold` | ✅ |
| `horse-service` (PARKED) | `removeGold` + `addGold` | ❌ duas transações |
| `housing-service.buyProperty` (PARKED) | `removeGold` + `UPDATE properties` | ❌ **Achado 9** |

Nenhum módulo escreve `UPDATE characters SET gold` por fora — isso é verdade
hoje e está travado por teste (`parked-services-ledger.test.js:334`). É a única
regra do briefing §18 que já vale.

---

## 2. Achado 1 — o ledger de ouro não sabe dizer quem pagou quem

**Severidade: alta. É o achado que bloqueia contratos.**

Uma compra de 100g numa barraca com 5% de imposto grava três coisas:

```
gold_transactions: (uuid-A, comprador, -100, 'stall_purchase', 'market-stalls', 'req123_buy_gold')
gold_transactions: (uuid-B, vendedor,  +95, 'stall_sale',     'market-stalls', 'req123_sell_gold')
cities.treasury  += 5                                             ← sem linha nenhuma
```

Nada em `uuid-A` aponta para `uuid-B`. Para reconstruir "o comprador 7 pagou o
vendedor 12", é preciso adivinhar a partir de `reason`, `module` e proximidade
de `created_at` — ou percorrer o prefixo da `idempotency_key`, que é convenção
de string, não relação declarada.

Isso é o mesmo defeito que a [migration v14](../../skymp/packages/database/migration-v14-inventory-framework.sql)
consertou no ledger de item, com a mesma justificativa escrita lá: *"a outra
ponta não tinha como ser nomeada, e a soma dos deltas do servidor não batia com
nada"*. O ouro ficou de fora daquela rodada.

**Por que isso bloqueia contrato.** Um contrato com escrow tem quatro
movimentos: criador → escrow, escrow → trabalhador, escrow → criador (refund),
e escrow → tesouro (taxa, se houver). Se o ledger só sabe falar de personagem,
três desses quatro não têm onde ser gravados, e o quarto grava metade.

**Consequência prática hoje:** um extrato de jogador é possível
(`idx_gold_tx_char_date` serve bem). Uma investigação de staff do tipo "de onde
veio esse ouro" não é — ela para na primeira linha que diz apenas `+95,
stall_sale`.

---

## 3. Achado 2 — imposto sai do ledger no instante em que vira imposto

**Severidade: alta.**

Dois lugares creditam tesouro com SQL solto dentro de uma transação correta:

```js
// market-stalls-service.js:863
await conn.query('UPDATE cities SET treasury = treasury + ? WHERE id = ?', [taxAmount, item.city_id]);

// core/regional-market-transaction-service.js:150
if (tax > 0) await conn.query('UPDATE holds SET treasury = treasury + ? WHERE id = ?', [tax, hold.id]);
```

O comentário no `market-stalls-service` é honesto sobre o que está fazendo:

> *Tesouro de cidade nao e ouro de personagem: nao tem linha em
> `gold_transactions` nem passa pelo transaction-service, que e sobre patrimonio
> de personagem. O rastro dele e `market_stall_sales.tax_amount`.*

A frase está certa sobre o `transaction-service` e errada sobre o resultado. O
rastro existe, mas é **por venda**, não por tesouro. Consequências:

1. **`cities.treasury` não é auditável.** Não há query que reconstrua o saldo a
   partir de um histórico. Se ele divergir, não há como saber quando divergiu.
2. **Conservação não é verificável.** A soma dos deltas de `gold_transactions`
   numa venda é `-100 + 95 = -5`. Os 5 que faltam existem, mas em outra tabela,
   com outro esquema, e só para este tipo de venda.
3. **Um tesouro só tem entrada.** `cities.treasury` não tem *nenhum* caminho de
   saída no código. Ouro entra e fica. `holds.treasury` tem saída (o saque da
   v11) mas a entrada não tem ledger — então nem esse tem história completa.

O briefing §15 pede `Governance → Economy Transaction → Treasury → Ledger`.
Hoje o caminho é `Governance → SQL → Treasury`, sem a terceira e a quarta seta.

---

## 4. Achado 3 — a primitiva de ouro exportada não valida nada

**Severidade: média.** É o **§6 da [auditoria de inventário](INVENTORY_TRADE_CRAFTING_AUDIT.md#6-achado-6--a-primitiva-exportada-valida-menos-que-o-wrapper)
repetido para dinheiro**, e não corrigido junto.

```js
// core/transaction-service.js:216
async function _applyGoldDelta(conn, characterId, delta) {
  if (delta < 0) {
    const [rows] = await conn.query('SELECT gold FROM characters WHERE id = ? FOR UPDATE', [characterId]);
    if (rows.length === 0) throw new Error(...);
    if (rows[0].gold + delta < 0) throw new Error(...);
  }
  await conn.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [delta, characterId]);
}
```

Compare com `_applyStackDelta` (linha 140), que checa `Number.isSafeInteger` do
dono, do `baseId` e do delta, e recusa `delta === 0` explicitamente. O de ouro
não checa nada. Consequências, todas alcançáveis por quem chama `tx.applyGoldDelta`:

- **`delta = NaN`** → `NaN < 0` é `false`, o ramo de validação é pulado, e o
  `UPDATE` grava `gold = gold + NaN`. Em MySQL não-estrito isso vira `0`: o
  patrimônio do jogador é zerado em silêncio. É a mesma classe do bug que o
  `/setgold` já teve (`admin-service.js:355`, comentário).
- **`delta = 0`** → grava uma linha de ledger com delta zero, escondendo o
  cálculo errado que produziu o zero. O caminho de item recusa isso de propósito.
- **`characterId` inexistente com `delta > 0`** → o `UPDATE` afeta 0 linhas e
  ninguém checa `affectedRows`. Hoje a FK de `gold_transactions` derruba a
  transação logo depois, então o efeito é contido — mas só porque o chamador
  lembrou de gravar o ledger, que é convenção, não garantia.

As funções públicas (`addGold`, `removeGold`) validam `amount <= 0` e estão
protegidas. Quem usa as primitivas — barraca e mercado regional — não está.

---

## 5. Achado 4 — há teto para item e não há para ouro

**Severidade: baixa hoje, estrutural amanhã.**

`_applyStackDelta` tem `MAX_STACK_COUNT = 2147483647` e uma justificativa
escrita de por que a saturação silenciosa do `INT` é pior que a recusa. O ouro
usa o mesmo `INT` e não tem essa guarda.

Alcançar o teto exige um patrimônio de 2,1 bilhões de septims, o que não é um
caminho de exploração realista com o preço máximo de barraca em 1.000.000g
(`market-stalls-service.js:49`). Mas o argumento que motivou a guarda de item
vale igual aqui: **a diferença vira dinheiro destruído sem nenhuma linha
explicando**. E a assimetria é a evidência de que a decisão nunca foi tomada
para ouro — ela foi tomada para item e não propagada.

---

## 6. Achado 5 — a checagem de idempotência de `transfer()` nunca casa

**Severidade: média. Não duplica ouro; mente para o chamador.**

`transfer()` consulta a chave crua:

```js
// core/transaction-service.js:371
'SELECT transaction_id FROM inventory_transactions WHERE idempotency_key = ?
 UNION SELECT transaction_id FROM gold_transactions WHERE idempotency_key = ?',
[idempotencyKey, idempotencyKey]
```

E grava chaves **derivadas**:

```js
// linhas 389-399
const itemKey = `${idempotencyKey}_item`;   → grava `${itemKey}_from` e `${itemKey}_to`
const goldKey = `${idempotencyKey}_gold`;   → grava `${goldKey}_from` e `${goldKey}_to`
```

A chave crua nunca é gravada em lugar nenhum. O `SELECT` da linha 371 sempre
volta vazio, para qualquer chave, sempre. **A checagem é código morto.**

O que impede a duplicação é a `UNIQUE` de `idempotency_key` nas duas tabelas: o
segundo `transfer()` com a mesma chave viola a constraint, cai no `catch`, faz
`rollback` e retorna `false`. O ouro está seguro.

O preço é o contrato de retorno. O chamador que reenviou por timeout de rede
recebe `false` — o mesmo valor que significa "saldo insuficiente". Ele conclui
que a transferência falhou. Ela aconteceu. Ver **Achado 7**.

`giveItem`, `removeItem`, `addGold` e `removeGold` gravam a chave crua e a
checagem deles funciona — em sequência. Sob concorrência, ver o próximo achado.

---

## 7. Achado 6 — a idempotência está fora da transação (nas funções públicas)

**Severidade: média.** Já registrado como
[§7 da auditoria de inventário](INVENTORY_TRADE_CRAFTING_AUDIT.md#7-achado-7--a-checagem-de-idempotência-está-fora-da-transação);
repetido aqui porque o briefing §6 o torna requisito explícito, e porque a
comparação com os outros dois serviços é o achado de verdade.

```js
// core/transaction-service.js:270 — addGold/removeGold/giveItem/removeItem, todos iguais
if (idempotencyKey) {
  const existing = await db.query('SELECT ... WHERE idempotency_key = ?', [key]);  // ← conexão do pool
  if (existing.length > 0) return true;
}
const conn = await db.getConnection();   // ← outra conexão, outra transação
```

Duas chamadas concorrentes com a mesma chave: ambas leem vazio, ambas seguem.
A `UNIQUE` derruba a segunda. Resultado correto, mensagem errada (`false`).

**O contraste é o que importa.** Os dois serviços escritos depois fazem certo:

| Serviço | Onde consulta o replay | Resultado do replay |
|---|---|---|
| `transaction-service` (todos) | fora da transação, conexão do pool | `true` — ou `false`, quando a corrida perde |
| `market-stalls-service` | **dentro**, `conn`, com `FOR UPDATE` (`:122`) | `{ok:true, replayed:true, saleId}` |
| `regional-market-transaction-service` | **dentro**, `conn` (`:59`) | `{ok:true, replayed:true, transactionId, ...}` |
| `institutional-treasury-service` | **dentro**, `conn`, sob o lock do Hold (`:74`) | `{ok:true, replayed:true, transferId, ...}` |

Três serviços convergiram no padrão certo, incluindo o resultado tipado que
distingue replay de execução. O arquivo que existe para ser a única porta é o
único que não segue. **O padrão a adotar já está no repositório — só não está
onde deveria.**

---

## 8. Achado 7 — `false` significa três coisas diferentes

**Severidade: alta. É o achado com pior consequência de RP.**

`addGold`, `removeGold`, `giveItem`, `removeItem` e `transfer` retornam
`boolean`. `false` é devolvido para:

1. saldo/estoque insuficiente — **regra do jogo, decisão legítima**;
2. violação de `UNIQUE` por replay — **a operação já aconteceu**;
3. banco fora do ar, deadlock, timeout de pool — **nada aconteceu, e é falha de
   infraestrutura**.

O `catch` é o mesmo, o log é o mesmo, e o chamador não tem como separar. O
comentário do próprio arquivo assume o caso 1 (`"provavel saldo insuficiente"`,
linha 494) — "provável" é a palavra que admite o problema.

**Onde isso vira dano.** `governance-service.fineTarget:635`:

```js
const paid = await transactionService.removeGold({...});
await db.query('INSERT INTO fines (... status, paid_at) VALUES (?, ?, ?, ?, ?, ?)',
  [..., paid ? 'paid' : 'unpaid', paid ? new Date() : null]);
if (!paid) {
  await db.query('INSERT INTO warrants (...) VALUES (?, ?, "minor", ?, ?, ?)', ...);
}
```

Se o banco engasgar durante o `removeGold`, `paid` é `false`, e o jogador —
que tinha o ouro — recebe **uma multa registrada como dívida e um mandado de
prisão**. Num servidor Heavy RP, um mandado é material de cena: a guarda prende,
o tribunal julga, e a origem foi um timeout.

O caso 3 exige distinguir erro de recusa. Nenhuma quantidade de retry conserta
isso enquanto o retorno for `boolean`.

---

## 9. Achado 8 — a multa não é atômica, e a "dívida" que ela cria não é dívida

**Severidade: alta.** Mesmo trecho, outro defeito.

O `removeGold` abre e commita a própria transação. O `INSERT INTO fines` é uma
segunda transação. Entre as duas, tudo pode acontecer:

- crash entre elas → **o jogador pagou e não há registro de multa**. O ouro saiu
  com `reason = 'guard_fine:...'` no ledger, mas o processo de governança não
  sabe que a multa foi paga;
- `INSERT INTO fines` falha → mesma coisa, com log.

E a segunda metade: quando `paid = false`, a linha em `fines` com
`status = 'unpaid'` é chamada de dívida no texto que o jogador recebe
(*"Multa de N septims registrada como divida"*), mas **não é uma dívida**:

- não há caminho de pagamento posterior — nenhuma função lê `fines` com
  `status = 'unpaid'` para cobrar;
- não há credor: o ouro da multa paga **não vai para lugar nenhum**. É destruído
  (`removeGold` sem contraparte). A cidade que multou não fica mais rica;
- não há amortização parcial, nem juros, nem quitação, nem perdão.

O briefing §10 pede um `DEBT` real. Este é o registro que ele vai substituir, e
é útil saber que ele existe e o que ele promete sem cumprir.

Vale a mesma observação para o **`death-service:367`**: a penalidade de morte
destrói de 50g a 10% do patrimônio, sem contraparte. Isso pode ser uma decisão
de design (dreno monetário para conter inflação) — mas ela não está escrita em
lugar nenhum, e um dreno não declarado é indistinguível de ouro sumindo por bug.

---

## 10. Achado 9 — compra de propriedade cobra antes de entregar

**Severidade: média. Serviço PARKED, mas o padrão é o que importa.**

```js
// housing-service.js:268
const paid = await transactionService.removeGold({ characterId, amount: prop.price_gold, ... });
if (!paid) { ...; return false; }
await db.query('UPDATE properties SET owner_character_id = ?, is_for_sale = 0 WHERE id = ?', [characterId, propertyId]);
```

Duas transações. Se o `UPDATE` falhar, o jogador pagou pela casa e não a
recebeu, e não há compensação. Pior: o `SELECT` que verifica
`is_for_sale = 1 AND owner_character_id IS NULL` acontece **antes**, sem
`FOR UPDATE` — duas compras concorrentes da mesma casa passam as duas na
checagem, ambas cobram, e a segunda `UPDATE` sobrescreve a primeira. Um jogador
paga e outro fica com a casa.

`horse-service:164-171` tem a mesma forma (`removeGold` + `addGold` em
transações separadas): o comprador pode pagar sem o vendedor receber.

Ambos estão PARKED e fora do `module-registry` — não rodam. Registrado porque
**reativar sem reescrever é o erro**, e porque o
[PARKED_SERVICES_DECISION §7.3](../technical/PARKED_SERVICES_DECISION.md) já
estabelece que migrar ≠ reativar.

---

## 11. Achado 10 — dois débitos, duas ordens de trava

**Severidade: baixa (frequência), mas real.**

`transfer()` e `buyItem` travam duas linhas de `characters` em sequência, na
ordem em que os IDs aparecem no pedido:

```js
// market-stalls-service.js:856
await transactionService.tx.applyGoldDelta(conn, buyer.characterId, -total);      // trava o comprador
await transactionService.tx.applyGoldDelta(conn, item.owner_character_id, sellerAmount);  // trava o vendedor
```

Se o personagem 7 compra da barraca do 12 enquanto o 12 compra da barraca do 7,
uma transação trava `7→12` e a outra `12→7`. Deadlock do InnoDB. O detector
mata uma delas; o chamador recebe... `false` (**Achado 7**), e o jogador lê
"Nao foi possivel concluir a compra".

Nota: `applyGoldDelta` só trava quando o delta é negativo. O crédito do vendedor
não faz `SELECT ... FOR UPDATE`, mas o `UPDATE` pega lock de linha do mesmo
jeito — o deadlock continua possível.

A correção é conhecida e barata: **travar os saldos em ordem canônica** (menor
`characterId` primeiro), independente de quem paga.

---

## 12. Achado 11 — quatro tesouros, um serviço, e nenhum caminho genérico

**Severidade: alta para o que o briefing quer construir.**

`institutional-treasury-service.js` é bem escrito e resolve exatamente um caso:
Hold → facção regente, com autorização de líder lida **na mesma conexão** da
transação (linha 94, com o comentário certo sobre não confiar no cache). É o
padrão a seguir.

Mas ele é uma função, não um serviço de contas. Não existe:

- crédito de tesouro com ledger (é o **Achado 2**);
- transferência facção → personagem (pagar salário);
- transferência personagem → facção (contribuição, taxa de guilda);
- qualquer coisa que **segure** ouro sem dono — que é a definição de escrow.

O briefing §4 pergunta se vale abstrair `account (owner_type, owner_id, balance,
status)`. Esta auditoria acha que **sim, e mais barato do que parece** — mas a
justificativa e a alternativa rejeitada pertencem ao ADR, não à auditoria. Ver
[ADR 004](../technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md).

O dado que sustenta a resposta: das sete colunas de saldo da §1.1, **duas estão
mortas** (`realms.treasury`, `shops.tax_debt`), o que mostra que colunas de saldo
espalhadas por tabela de domínio é o padrão que já falhou uma vez neste
repositório sem ninguém notar.

---

## 13. Achado 12 — `accounts.coins` é dinheiro e não está nesta auditoria

**Severidade: informativa, e a decisão é de produto.**

`accounts.coins` são *"Moedas da loja virtual (adquiridas por doacao)"*
(`schema.sql:13`). É dinheiro real convertido em crédito. Ele:

- não passa por nenhum ledger;
- não é escrito por nenhum arquivo do gamemode (só `store_purchases` o
  referencia);
- não tem, hoje, nenhuma conversão para septims — **e essa ausência é a coisa
  certa**.

Registrado aqui por uma razão só: quando o Economy Framework existir, ele vai
parecer o lugar natural para "vender septims por coins". Isso é uma decisão de
monetização com implicações legais e de equilíbrio de servidor, não uma decisão
de arquitetura, e o framework **não deve** oferecer o caminho por padrão. Ver
[LICENSE_AND_AFFILIATION_POLICY](../technical/LICENSE_AND_AFFILIATION_POLICY.md).

---

## 14. O que o desenho atual acerta

Precisa estar escrito, porque a lista de achados dá a impressão errada.

1. **Uma porta para `characters.gold`.** `_applyGoldDelta` é a única função que
   escreve a coluna, e há teste travando isso
   (`parked-services-ledger.test.js:334`). Muitos projetos maiores não têm isso.
2. **`FOR UPDATE` antes de todo débito**, com o comentário explicando a corrida
   que ele fecha (linha 218). Isso já é a resposta ao "race" e ao "double spend"
   do briefing §13.
3. **Ledger obrigatório por convenção documentada** — o contrato das primitivas
   `tx.*` (linha 544) diz textualmente que saldo mudado sem ledger é "ouro sem
   rastro".
4. **Cliente depois do commit, sempre.** `applyToClient` nunca roda dentro da
   transação. O banco é a fonte de verdade e a reconciliação é no login.
5. **Autorização lida na conexão da transação** (`institutional-treasury:94`).
   Isso fecha a janela "era líder quando checou, não era quando debitou".
6. **`/setgold` já é `economy.adjust`.** O briefing §12 pede permissão, motivo,
   ator, alvo, valor e auditoria. `admin-service.setGold` faz os seis, com um
   comentário de 25 linhas explicando por que virou delta. Nada a fazer.
7. **Replay tipado nos três serviços novos.** `{ok, replayed, transactionId}` é
   o contrato de retorno certo, e ele já existe — só não no arquivo central.

---

## 15. O que contratos e dívida exigem e não existe

Levantado contra o briefing §7–§11, para o ADR e a implementação:

| Necessidade | Existe? | Bloqueado por |
|---|---|---|
| Segurar ouro fora de um personagem (escrow) | ❌ | Achado 11 |
| Nomear as duas pontas de um pagamento | ❌ | Achado 1 |
| Creditar tesouro com rastro | ❌ | Achado 2 |
| Distinguir "recusado" de "quebrou" | ❌ | Achado 7 |
| Idempotência que devolve o resultado original | ⚠️ existe em 3 serviços, não no central | Achado 6 |
| Máquina de estados com transição auditada | ❌ | — nada parecido no repositório |
| Registro de dívida com credor, saldo e amortização | ❌ | `fines.status='unpaid'` finge ser isso (Achado 8) |
| Expiração que não toca trabalho entregue | ❌ | — invariante já registrado no roadmap |

Nada disso depende de decisão de gameplay. São todos consequência da §1.

---

## 16. Migrations: estado

| Versão | Assunto | Relevância aqui |
|---|---|---|
| v9 | `characters.gold` em banco antigo | fundação |
| v11 | ledger Hold → facção | único ledger institucional |
| v12 | ledger do mercado regional | idempotência por `UNIQUE` |
| v13 | `market_stall_sales.idempotency_key` | idempotência por `UNIQUE` |
| v14 | ledger de item ganha dono e contraparte | **o desenho que o ouro precisa** |

Duas observações operacionais:

- `gold_transactions` e `inventory_transactions` nascem no `schema.sql` e não em
  migration — banco criado antes delas nunca as recebe por migração. O mesmo
  buraco que a v9 consertou para `characters.gold` continua aberto para os dois
  ledgers. Não é um achado de economia, é dívida do processo de schema, e o
  `check:schema:list` é quem pega.
- `MODIFY COLUMN` não é lido pelo `check-schema-drift.js` (a v14 registra isso).
  Qualquer migration de economia que dependa de mudança de nulabilidade precisa
  do mesmo aviso.

---

## 17. Conclusão

O `transaction-service` não precisa ser substituído. Ele precisa **parar de ser
o topo da pilha**.

O que esta auditoria conclui:

1. O ledger de ouro deve receber o mesmo tratamento que a v14 deu ao de item:
   contraparte nomeada e `transfer_id` ligando as pernas. Sem isso, contrato,
   escrow, salário e dívida não têm onde ser gravados.
2. Tesouro precisa ser um titular de saldo de primeira classe, não uma coluna
   numa tabela de domínio. Duas das quatro colunas de tesouro já morreram sem
   ninguém notar.
3. O contrato de retorno precisa distinguir recusa de falha. Enquanto for
   `boolean`, um timeout de banco continua produzindo mandado de prisão.
4. A idempotência precisa entrar na transação e devolver o resultado original —
   o padrão já está escrito em três serviços deste repositório.
5. Escrow no post, como o Mereth descreve e como o
   [roadmap](../roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md#p3--economia-e-contratos)
   já registrou como invariante. Falha vira *sem contrato*, nunca contrato
   impagável.

E o que ela **não** conclui: nada aqui foi visto rodando. Todos os achados vêm
de leitura de código, e a Fase 0 continua sendo o bloqueio real do projeto. Um
Economy Framework testado só com `mp` mockado é o quinto sistema nessa condição.

---

## 18. Referências

- [`INVENTORY_TRADE_CRAFTING_AUDIT.md`](INVENTORY_TRADE_CRAFTING_AUDIT.md) — a auditoria irmã; os Achados 3 e 6 daqui são os §6 e §7 de lá, para dinheiro
- [`ADR_003_INVENTORY_SOURCE_OF_TRUTH.md`](../technical/ADR_003_INVENTORY_SOURCE_OF_TRUTH.md) — a decisão equivalente para item
- [`SKYMP_ECOSYSTEM_DEEP_DIVE.md` §4](SKYMP_ECOSYSTEM_DEEP_DIVE.md) — Mereth: escrow no post, dívida como registro. **Sem licença, sem código público: conceito apenas**
- [`ECOSYSTEM_ADAPTATION_ROADMAP.md` §P3](../roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md) — `CONTRACT-001`, `CONTRACT-002` e o blocker `ECON-01`
- [`PARKED_SERVICES_DECISION.md`](../technical/PARKED_SERVICES_DECISION.md) — por que `housing` e `horse` não rodam

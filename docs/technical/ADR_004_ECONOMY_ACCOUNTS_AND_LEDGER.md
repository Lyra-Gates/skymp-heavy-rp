# ADR 004 — Conta econômica é uma referência resolvida, e o ledger de ouro é o de item

**Status:** aceito · **Data:** 2026-08-13
**Autores:** sessão de Economy Framework
**Substitui:** nada. **Complementa:** [ADR 003](ADR_003_INVENTORY_SOURCE_OF_TRUTH.md)
**Evidência:** [`ECONOMY_FRAMEWORK_AUDIT.md`](../research/ECONOMY_FRAMEWORK_AUDIT.md)

---

## 1. Contexto

A auditoria de economia encontrou doze achados. Três decidem esta ADR:

- **Achado 1** — `gold_transactions` grava uma perna por linha, sem contraparte
  e sem `transfer_id`. Não há como responder "quem pagou quem".
- **Achado 2** — imposto entra em `cities.treasury` e `holds.treasury` com SQL
  solto, sem nenhuma linha de ledger. O dinheiro sai da história no instante em
  que vira imposto.
- **Achado 11** — não existe entidade capaz de *segurar* ouro sem dono. Escrow,
  que o briefing §8 pede e o Mereth descreve, não tem onde morar.

E um dado que corta a discussão de abstração: das sete colunas de saldo do
projeto, **duas nunca receberam uma linha de código** (`realms.treasury`,
`shops.tax_debt`). Saldo espalhado por tabela de domínio já falhou aqui, em
silêncio, e ninguém notou.

O briefing pede explicitamente para **não** abstrair além do necessário: *"Não
implementar abstração excessiva se atual transaction service já resolve."* Esta
ADR leva isso a sério — e a leitura dela é que o `transaction-service` resolve
o saldo do personagem, e só ele.

---

## 2. Decisão

### 2.1 Conta é uma **referência** `(type, ref)`, não uma linha de saldo

Uma conta econômica é o par `(ownerType, ownerRef)`. O `economy-service` resolve
esse par para onde o saldo realmente mora. Não há tabela `accounts` com
`balance` duplicando valor que já existe.

| `ownerType` | `ownerRef` | Onde o saldo mora | Pode ficar negativo? |
|---|---|---|---|
| `character` | `characters.id` | `characters.gold` | ❌ nunca |
| `city` | `cities.id` | `cities.treasury` | ❌ nunca |
| `hold` | `holds.id` | `holds.treasury` | ❌ nunca |
| `faction` | `factions.id` | `factions.treasury` | ❌ nunca |
| `realm` | `realms.id` | `realms.treasury` | ❌ nunca |
| `escrow` | `economy_escrow.escrow_id` | `economy_escrow.balance` | ❌ nunca |
| `system` | rótulo do dreno/fonte | **nenhum** | — não tem saldo |

`system` é a única sem saldo, e isso é deliberado: é a fronteira declarada por
onde ouro entra e sai do mundo (ouro inicial de whitelist, penalidade de morte,
ajuste de staff, venda para NPC). Toda criação e destruição de septim tem uma
linha de ledger com `system` de um dos lados. **Nada de ouro sem origem.**

### 2.2 O ledger de ouro é o ledger de item, com o mesmo desenho

`gold_transactions` recebe, pela [migration v15](../../skymp/packages/database/migration-v15-economy-framework.sql),
exatamente as colunas que a [v14](../../skymp/packages/database/migration-v14-inventory-framework.sql)
deu a `inventory_transactions`:

```
owner_type, owner_ref, counterparty_type, counterparty_ref, transfer_id
```

e `character_id` passa a ser `NULL` quando o titular não é personagem — como lá.

Uma transferência grava **duas linhas** com o mesmo `transfer_id`: `-N` no
pagador, `+N` no recebedor. Uma reconciliação vira uma query:

```sql
SELECT SUM(delta) FROM gold_transactions
 WHERE owner_type = 'city' AND owner_ref = 'whiterun';   -- deve bater com cities.treasury
```

**Por que estender e não criar `economy_ledger`.** O briefing §14 proíbe ledger
paralelo incompatível, e a v14 já estabeleceu a forma no repositório. Duas
tabelas de ledger com esquemas quase iguais é o defeito que essa regra existe
para evitar. O custo é uma migration com backfill trivial (todo movimento
existente é `owner_type = 'character'`, `owner_ref = character_id`) — o mesmo
backfill que a v14 fez, pelo mesmo motivo.

### 2.3 Toda movimentação passa por `core/economy-service.js`

Ele é a única porta. As primitivas `tx.*` do `transaction-service` continuam
existindo e continuam sendo o motor do saldo de personagem — o `economy-service`
as usa. O que muda é quem pode chamá-las: **módulo de domínio chama
`economy-service`, nunca `tx.applyGoldDelta` direto.**

```
governance / market / contracts / jobs / housing
                    ↓
            core/economy-service.js        ← autorização de valor, idempotência,
                    ↓                        ordem de trava, ledger dos dois lados
   core/transaction-service.js  +  tesouros  +  economy_escrow
                    ↓
              characters.gold / *.treasury / economy_escrow.balance
```

### 2.4 O resultado é tipado, nunca `boolean`

`{ ok: true, replayed: false, transferId, ... }` ou
`{ ok: false, code: 'insufficient_funds' }`. **Falha de infraestrutura lança** —
ela não vira `ok: false`.

Isso responde ao Achado 7: hoje `false` significa "recusado", "já aconteceu" e
"o banco caiu", e é por isso que um timeout produz mandado de prisão
(`governance-service.fineTarget`). O padrão já existe em três serviços deste
repositório (`market-stalls`, `regional-market`, `institutional-treasury`); esta
ADR o torna a regra.

### 2.5 Idempotência é verificada **dentro** da transação e devolve o original

A chave é gravada crua em `gold_transactions.idempotency_key` na perna do
pagador, e consultada com `FOR UPDATE` dentro da mesma transação. Replay devolve
`{ ok: true, replayed: true, ...valores originais }`.

A `UNIQUE` do banco continua sendo a última linha de defesa, mas deixa de ser a
*única*: hoje ela é o que efetivamente impede duplicação, e o efeito colateral é
o chamador receber `false` numa operação que deu certo (Achados 5 e 6).

### 2.6 Travas em ordem canônica

Quando uma operação move saldo de duas contas, o serviço as trava ordenadas por
`(ownerType, ownerRef)` como string, sempre — não na ordem "pagador, recebedor".
Fecha o deadlock do Achado 10 (7 compra de 12 enquanto 12 compra de 7).

### 2.7 Escrow é uma conta, não um campo no contrato

`economy_escrow` guarda um saldo com dono declarado, propósito e status. O
contrato aponta para ele. Escrow existe **antes** de contrato existir, e serve a
qualquer coisa que precise travar valor (leilão, caução de aluguel, aposta).

Trava no **post**, não na entrega — a justificativa é do Mereth e está registrada
no [roadmap](../roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md#p3--economia-e-contratos):
o servidor pega o dinheiro antes da promessa, então uma falha produz **sem
contrato** em vez de **contrato que ninguém pode pagar**. É a mesma filosofia
fail-closed do `server-options`.

### 2.8 Dívida é registro, nunca dedução automática

O `debt-service` grava quem deve, a quem, quanto, por quê e o que já foi pago.
Ele **não** debita ninguém sozinho, não bloqueia ação e não cria mandado. Ver
[§3](#3-a-fronteira-que-esta-decisão-não-fecha).

---

## 3. A fronteira que esta decisão **não** fecha

Escrito porque a ADR 003 tem a mesma seção e pelo mesmo motivo: um ADR que só
lista vitórias é propaganda.

1. **`characters.gold` continua `INT`.** O teto de 2,1 bilhões vira recusa
   explícita (Achado 4), não um tipo maior. Trocar para `BIGINT` é migration de
   tabela quente sem caso de uso.
2. **Não há moeda além do septim.** `accounts.coins` (loja, dinheiro real)
   continua fora, de propósito — Achado 12. O `economy-service` **não** oferece
   caminho de conversão, e adicioná-lo é decisão de produto, não de arquitetura.
3. **`system` não é auditável por saldo.** Por definição ele não tem saldo, então
   `SUM(delta)` de `system` não bate com nada. O que ele dá é a lista completa de
   criação e destruição de ouro, que é o que faltava.
4. **Reconciliação não é automática.** A v15 torna a conferência *possível* com
   uma query. Nada roda essa query periodicamente ainda.
5. **Contrato não verifica trabalho.** A entrega de item é contada pelo servidor
   (`inventory`), mas "matou o bandido", "escoltou a caravana" e "investigou o
   sumiço" são confirmação humana do criador. O framework §9 é extensível, não
   onisciente.
6. **Nada disso rodou.** Fase 0 continua sendo o bloqueio real do projeto.
   Tudo aqui é testado com `mp` mockado e MySQL simulado, como o resto.

---

## 4. Alternativas consideradas

### 4.1 Tabela `economy_accounts` com `balance` para tudo

O desenho "livro-caixa" clássico: uma linha por conta, `characters.gold` vira
espelho ou é apagada.

**Rejeitada.** `characters.gold` é lido por login, painel, morte, barraca,
mercado, staff e três testes. Movê-lo é uma migration de risco alto para
comprar consistência de nome, não de comportamento. E a versão "espelho" é pior:
dois lugares com o mesmo saldo é a definição do bug que o ledger existe para
detectar.

O ganho real da tabela genérica — *poder criar titular que não é personagem nem
tesouro* — é obtido com `economy_escrow` sozinho, que é a única classe nova de
titular que temos.

### 4.2 Manter `boolean` e adicionar um `lastError` fora de banda

Menos invasivo: `removeGold` continua devolvendo `false`, e o chamador consulta
o motivo em outro lugar.

**Rejeitada.** Estado global entre chamadas assíncronas concorrentes é uma corrida
por construção. E não resolve o caso que motivou: `fineTarget` precisa da
distinção **na mesma expressão** onde decide emitir mandado.

### 4.3 Escrow como campo `escrow_amount` na linha do contrato

Mais simples: sem tabela nova.

**Rejeitada.** Amarra escrow a contrato. Caução de aluguel, leilão e aposta
precisam do mesmo mecanismo, e a alternativa seria três campos `*_amount` em
três tabelas com três implementações de "libera para quem". É o Achado 2
acontecendo de novo, com outro nome.

### 4.4 Dívida com cobrança automática (débito quando o saldo aparece)

Tentador: o devedor recebe ouro, o sistema abate a dívida.

**Rejeitada, e esta é a rejeição mais importante desta ADR.** O briefing §11 diz
que dívida deve gerar RP para guildas, tribunal, crime e política, e que
consequência irreversível não pode ser automática. Um sistema que confisca ouro
no instante em que ele entra:

- remove a cena — ninguém precisa cobrar, então ninguém cobra;
- torna o servidor o agiota, em vez do outro jogador;
- é irreversível e silencioso, que é a combinação que a
  [Constituição](../CONSTITUICAO.md) trata como falha grave.

Dívida é **registro selado e legível**. Cobrar é papel de jogador.

### 4.5 Ledger append-only imutável com `status` em vez de correção

Já é o que temos (`status = 'committed' | 'rolled_back'`) e continua.
Não se apaga linha de ledger. Estorno é uma nova transferência no sentido
contrário, com `reason` que a nomeia — nunca um `UPDATE`.

---

## 5. Consequências

### Boas

- "Quem pagou quem" vira uma query com `transfer_id` (Achado 1).
- Tesouro passa a ter história, e o saldo dele é conferível contra o ledger
  (Achado 2).
- Um timeout de banco deixa de virar mandado de prisão (Achado 7).
- Escrow existe, então contrato pode existir (Achado 11).
- Criação e destruição de ouro ficam listadas em vez de implícitas.
- Deadlock de compra cruzada some (Achado 10).

### Custos

- Uma tabela nova (`economy_escrow`), cinco colunas novas em `gold_transactions`,
  e uma indireção a mais entre módulo e saldo.
- Três módulos existentes mudam de chamador (`governance`, `market-stalls`,
  `regional-market`). Cada um é uma mudança pequena, mas são três.
- Um segundo arquivo `core/` que "sabe de dinheiro". O `transaction-service`
  deixa de ser o topo e vira o motor — quem ler só ele vai ter a impressão errada.
  Mitigado por comentário de cabeçalho nos dois arquivos.

### Riscos aceitos

- **`system` como saco sem fundo.** Nada impede um módulo de creditar 10⁹ de
  `system`. A defesa é o mesmo teto do Achado 4 mais o `reason` obrigatório —
  não uma cota. Cota exigiria política econômica que não temos.
- **A migration mexe numa tabela de ledger existente.** O backfill é o mesmo da
  v14 e é reversível por leitura (nada é apagado), mas `MODIFY COLUMN` não é
  visto pelo `check-schema-drift.js` — repetimos o aviso da v14 no arquivo.
- **`economy_escrow` pode vazar saldo** se um contrato for apagado sem liberar o
  escrow. Por isso a FK do contrato para o escrow é `RESTRICT`, e o status do
  escrow é conferido antes de qualquer transição terminal de contrato.

---

## 6. Como saber que esta decisão foi errada

Sinais concretos, para revisitar sem discussão de gosto:

1. **Se surgir um quinto tipo de titular com saldo próprio** (banco, guilda com
   cofre, empresa) e cada um exigir uma coluna `treasury` numa tabela nova — a
   §4.1 estava certa e a tabela genérica se paga.
2. **Se a conferência `SUM(delta)` vs. saldo divergir em produção** sem que a
   causa seja escrita por fora — a resolução por referência não está sendo
   respeitada, e o saldo precisa morar no mesmo lugar que a história.
3. **Se `economy-service` passar de ~500 linhas** com `switch (ownerType)` em
   cinco funções diferentes — a indireção virou o problema que veio resolver.
4. **Se escrow precisar de saldo parcial** (liberar 30% agora, 70% depois em
   marcos), `economy_escrow.balance` como número único fica apertado e vira
   linha de movimentação própria.

---

## 7. Referências

- [`ECONOMY_FRAMEWORK_AUDIT.md`](../research/ECONOMY_FRAMEWORK_AUDIT.md) — os doze achados
- [`ECONOMY_FRAMEWORK.md`](../framework/ECONOMY_FRAMEWORK.md) — como usar o que esta ADR decide
- [`ADR_003_INVENTORY_SOURCE_OF_TRUTH.md`](ADR_003_INVENTORY_SOURCE_OF_TRUTH.md) — a decisão irmã, para item
- [`CONTRACTS.md`](../gameplay/CONTRACTS.md) · [`DEBT_SYSTEM.md`](../gameplay/DEBT_SYSTEM.md)
- [`SKYMP_ECOSYSTEM_DEEP_DIVE.md` §4](../research/SKYMP_ECOSYSTEM_DEEP_DIVE.md) — Mereth. **Sem licença e sem código público: só o conceito foi usado**

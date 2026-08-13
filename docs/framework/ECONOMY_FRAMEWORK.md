# Economy Framework

**Como mexer em dinheiro no Heavy RP.** Se você está escrevendo um módulo que
cobra, paga, taxa, multa, recompensa ou trava valor, este documento é o contrato.

- Decisão: [ADR 004](../technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md)
- Evidência: [auditoria de economia](../research/ECONOMY_FRAMEWORK_AUDIT.md)
- Schema: [migration v15](../../skymp/packages/database/migration-v15-economy-framework.sql)
- Código: [`core/economy-service.js`](../../skymp/gamemode/core/economy-service.js)

---

## 1. A regra

> **Nenhum módulo altera saldo diretamente. Nem `characters.gold`, nem
> `cities.treasury`, nem `holds.treasury`, nem `factions.treasury`.**

Uma porta: `core/economy-service.js`.

```
governança · barraca · contratos · dívida · aluguel · trabalho · loja
                              │
                              ▼
                   core/economy-service.js
        (validação · idempotência · ordem de trava · ledger dos dois lados)
                              │
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
core/transaction-service   tesouros            economy_escrow
   characters.gold      *.treasury               balance
```

`core/transaction-service.js` continua existindo e continua sendo o **único**
arquivo que escreve `characters.gold`. Ele é o motor. As primitivas `tx.*` são
dele; módulo de domínio não as chama.

**Como saber que você está errado:** se o seu módulo tem `require` de
`core/transaction-service` para mexer em ouro, ou uma string `SET gold` /
`SET treasury`, está errado.

---

## 2. Conta é uma referência

Uma conta é o par `{ type, ref }`. O serviço resolve para onde o saldo mora.

| `type` | `ref` | Saldo real | Exemplo |
|---|---|---|---|
| `character` | `characters.id` | `characters.gold` | `{ type: 'character', ref: 7 }` |
| `city` | `cities.id` | `cities.treasury` | `{ type: 'city', ref: 'whiterun' }` |
| `hold` | `holds.id` | `holds.treasury` | `{ type: 'hold', ref: 'whiterun' }` |
| `faction` | `factions.id` | `factions.treasury` | `{ type: 'faction', ref: 3 }` |
| `realm` | `realms.id` | `realms.treasury` | `{ type: 'realm', ref: 'skyrim' }` |
| `escrow` | `economy_escrow.escrow_id` | `economy_escrow.balance` | `{ type: 'escrow', ref: uuid }` |
| `system` | rótulo | **nenhum** | `{ type: 'system', ref: 'death_penalty' }` |

### `system` é a fronteira do mundo

É por onde septim **entra e sai da economia**. Ele não tem saldo — de propósito.
Toda criação e destruição de dinheiro precisa de uma linha com `system` de um
dos lados, e o rótulo diz o quê:

| Rótulo | O que é |
|---|---|
| `whitelist_grant` | ouro inicial de personagem aprovado |
| `death_penalty` | dreno da penalidade de morte |
| `staff_adjust` | `economy.adjust` — staff criando ou destruindo |
| `regional_market` | compra e venda no mercado NPC |
| `staff_fine` | multa aplicada por governador de staff, sem instituição |

Rótulo novo entra por edição de código, sob revisão. `[a-z0-9_]{3,48}`.

> **Listar tudo que a economia criou ou destruiu hoje:**
> ```sql
> SELECT owner_ref, SUM(delta) FROM gold_transactions
>  WHERE owner_type = 'system' AND created_at >= CURDATE()
>  GROUP BY owner_ref;
> ```
> Isso era impossível antes da v15.

---

## 3. API

### Transferir

```js
const economy = require('./core/economy-service');

const resultado = await economy.transfer({
  from: { type: 'character', ref: compradorId },
  to:   { type: 'character', ref: vendedorId },
  amount: 250,
  reason: 'stall_purchase',          // ≤ 64 chars, vira coluna no ledger
  module: 'market-stalls',
  actorCharacterId: compradorId,     // quem PEDIU, se não for o titular
  idempotencyKey: requestId          // 8–96 chars
});
```

Quando a operação precisa commitar **junto com outra coisa** (baixar estoque,
entregar item, fechar contrato), use a variante em transação do chamador:

```js
const conn = await db.getConnection();
await conn.beginTransaction();
const resultado = await economy.transferInTransaction(conn, { ... });
// ... resto da operação ...
await conn.commit();
```

Quem chama `transferInTransaction` **abre, commita e faz rollback**. A função não
faz nenhuma das três.

### Escrow

```js
const escrow = await economy.openEscrow({
  funder: { type: 'character', ref: criadorId },
  amount: 500,
  purpose: 'contract',    // contract | auction | rent_deposit | wager
  reason: 'contract_escrow',
  module: 'contracts',
  idempotencyKey: chave
});
// → { ok: true, escrowId, amount, transferId }

await economy.closeEscrow({
  escrowId: escrow.escrowId,
  beneficiary: { type: 'character', ref: trabalhadorId },
  reason: 'contract_settlement',
  idempotencyKey: outraChave
});
// → { ok: true, amount, outcome: 'released' }   ('refunded' se voltar ao financiador)
```

### Ajuste de staff

```js
await economy.adjust({
  target: { type: 'character', ref: alvoId },
  amount: -500,                    // negativo debita
  reason: 'estorno_dupe',
  actorCharacterId: staffCharId,   // obrigatório
  idempotencyKey: chave
});
```

Este arquivo **não checa permissão** — quem chama já sabe qual é o cargo. O que
ele garante é que o ajuste é impossível de fazer sem rastro: o outro lado é
sempre `system:staff_adjust`, e o ator fica na coluna `actor_character_id`.

### Leitura

```js
await economy.getBalance({ type: 'city', ref: 'whiterun' });
// → { ok: true, balance: 1240 }

await economy.reconcile({ type: 'city', ref: 'whiterun' });
// → { ok: true, balance: 1240, ledgerSum: 1240, matches: true }
```

---

## 4. O contrato de retorno

**Este é o ponto mais importante do framework**, e a razão de ele existir.

```js
{ ok: true,  replayed: false, transferId, amount }   // aconteceu agora
{ ok: true,  replayed: true,  transferId, amount }   // já tinha acontecido
{ ok: false, code: 'insufficient_funds', balance }   // regra do jogo recusou
throw new Error(...)                                  // infraestrutura quebrou
```

Três estados distintos, e **falha de infraestrutura lança** — ela nunca vira
`ok: false`.

Por que isso importa: até 13/08/2026 `removeGold` devolvia `boolean`, e `false`
significava "não tem ouro", "já aconteceu" **e** "o banco caiu". O
`governance-service` lia esse `false` e emitia **mandado de prisão por
inadimplência** — então um timeout de rede produzia um mandado contra alguém que
tinha o dinheiro. Ver [Achado 7](../research/ECONOMY_FRAMEWORK_AUDIT.md#8-achado-7--false-significa-três-coisas-diferentes).

### Códigos de recusa

| Código | Significa |
|---|---|
| `insufficient_funds` | saldo não cobre (vem com `balance`) |
| `balance_overflow` | o destino estouraria o `INT` de saldo |
| `from_account_not_found` / `to_account_not_found` | titular não existe |
| `same_account` | origem igual ao destino |
| `invalid_amount` | zero, negativo, fracionário, NaN ou acima do teto |
| `invalid_from_account` / `invalid_to_account` | tipo desconhecido ou ref inválida |
| `invalid_reason` / `invalid_idempotency_key` | fora do formato |
| `escrow_not_found` / `escrow_not_held` / `escrow_empty` | estado de escrow |

Trate `insufficient_funds` como decisão de jogo. Trate qualquer outro código
como bug do seu módulo — ele significa que você montou o pedido errado.

---

## 5. Idempotência

Obrigatória. A chave é gravada **crua** na perna de débito de
`gold_transactions.idempotency_key` (`UNIQUE`), e consultada com `FOR UPDATE`
**dentro** da transação. Um reenvio devolve o resultado original.

```
requestId da UI  →  idempotencyKey
                    ├── perna de débito:  "req-abc123"
                    └── perna de crédito: "req-abc123#in"
```

Se sua operação faz mais de uma transferência, derive sufixos estáveis:

```js
idempotencyKey: `${requestId}_pay`   // pagamento
idempotencyKey: `${requestId}_tax`   // imposto
```

**Estáveis** é a palavra: `Date.now()` ou `Math.random()` no meio da chave
transforma um retry num segundo pagamento.

Quando o pedido não tem `requestId` (comando de chat, varredura de servidor),
gere um determinístico a partir do que identifica a operação —
`sweep-expire-${contractId}` é a chave da varredura de contratos, e é o que
impede a varredura de expirar duas vezes se rodar duas vezes no mesmo minuto.

---

## 6. O ledger

`gold_transactions` depois da v15:

| Coluna | Para quê |
|---|---|
| `transaction_id` | UUID da linha |
| `transfer_id` | **compartilhado pelas duas pernas** — é o que liga pagador e recebedor |
| `character_id` | preenchido quando o titular é personagem; `NULL` nos demais |
| `owner_type` / `owner_ref` | de quem é esta perna |
| `counterparty_type` / `counterparty_ref` | o outro lado |
| `actor_character_id` | quem pediu, quando não é o titular |
| `delta` | negativo debita, positivo credita |
| `reason` / `module` | o quê e de onde |
| `idempotency_key` | `UNIQUE`; crua na perna de débito |
| `status` | `committed` / `rolled_back` |

Consultas que a v15 tornou possíveis:

```sql
-- A operação inteira, dos dois lados
SELECT * FROM gold_transactions WHERE transfer_id = ?;

-- O saldo de um tesouro reconstruído a partir da história
SELECT SUM(delta) FROM gold_transactions WHERE owner_type='city' AND owner_ref='whiterun';

-- Tudo que uma staff moveu
SELECT * FROM gold_transactions WHERE actor_character_id = ? ORDER BY created_at DESC;
```

### Sobre "metadata segura" (briefing §5)

Não há coluna JSON livre, e é decisão, não esquecimento. Os campos que o
briefing pede — `from`, `to`, `type`, `reason`, `actor`, `timestamp` — todos
existem como **colunas tipadas e indexáveis**. Um blob de metadata livre seria
o lugar onde texto de jogador, nome de item e mensagem de erro acabam entrando
sem validação, e onde ninguém consegue consultar depois. Precisa de um campo
novo? Ele vira coluna, com migration e revisão.

---

## 7. Invariantes

Sete coisas que o serviço garante e que você não precisa reimplementar:

1. **Saldo nunca fica negativo.** Checado sob `FOR UPDATE`, e o `UPDATE` de
   tesouro repete a guarda no `WHERE` como segunda linha de defesa.
2. **Saldo nunca estoura o `INT`.** Crédito que passaria de `2147483647` é
   recusado com `balance_overflow` em vez de saturar em silêncio.
3. **Travas em ordem canônica** (`type:ref` ordenado), não "pagador primeiro" —
   é o que impede deadlock quando A compra de B enquanto B compra de A.
4. **Toda mudança de saldo tem linha de ledger.** Não há caminho que mude saldo
   sem gravar as duas pernas.
5. **Idempotência dentro da transação**, com replay tipado.
6. **Escrow libera uma vez.** `status` sai de `held` sob a mesma trava.
7. **Recusa ≠ falha.** Ver §4.

---

## 8. Como estender

### Um tipo novo de titular

Edite `ACCOUNT_KINDS` em `core/economy-service.js`. É uma lista fechada porque o
nome da tabela e da coluna são **interpolados no SQL** (um `?` não funciona para
identificador), e a lista fechada é o que torna isso seguro por construção.
Nenhum nome vindo de payload chega ao SQL.

O titular precisa de uma tabela com chave primária e uma coluna de saldo `INT`
não-negativa.

### Um propósito novo de escrow

Edite `ESCROW_PURPOSES`. Hoje: `contract`, `auction`, `rent_deposit`, `wager`.

### Um rótulo novo de `system`

Nenhuma lista — o formato é `[a-z0-9_]{3,48}`. Mas escolha um nome que responda
"de onde veio esse ouro" numa investigação. `mint` não responde;
`whitelist_grant` responde.

---

## 9. O que este framework **não** faz

Escrito porque um framework que só lista capacidades engana.

1. **Não checa permissão.** Quem pode multar, quem pode sacar do tesouro da
   facção e quem pode ajustar saldo é decisão dos módulos de governança e staff.
   Duplicar aqui criaria dois lugares para manter a mesma regra.
2. **Não converte moeda.** `accounts.coins` (loja, dinheiro real) está fora, de
   propósito, e adicionar o caminho é decisão de produto — ver
   [Achado 12](../research/ECONOMY_FRAMEWORK_AUDIT.md#13-achado-12--accountscoins-é-dinheiro-e-não-está-nesta-auditoria).
3. **Não faz reconciliação automática.** `reconcile()` existe e é uma query;
   nada a executa periodicamente ainda.
4. **Não impõe política econômica.** Não há cota de emissão, teto de dreno,
   inflação nem juros. `system` aceita qualquer valor com `reason` obrigatório.
5. **Não estorna.** Estorno é uma transferência nova no sentido contrário, com
   `reason` que a nomeia. Linha de ledger não se apaga e não se edita.
6. **Não rodou em servidor com gente dentro.** Tudo aqui é testado com MySQL
   simulado e `mp` mockado, como o resto do gamemode. A
   [Fase 0](../technical/FASE_0_ROTEIRO.md) continua sendo o bloqueio real.

---

## 10. Migração dos módulos existentes

Feito em 13/08/2026:

| Módulo | Antes | Agora |
|---|---|---|
| `governance-service.fineTarget` | `removeGold` + 2 queries soltas | uma transação; multa credita a instituição; inadimplência abre dívida real |
| `market-stalls-service.buyItem` | 2× `applyGoldDelta` + `UPDATE cities` solto | 2 transferências (pagamento e imposto), 4 pernas de ledger que somam zero |
| `regional-market-transaction-service` | `applyGoldDelta` + `UPDATE holds` solto | compra e venda contra `system:regional_market`; imposto é transferência |

Pendente, e registrado: `housing-service.buyProperty` e `horse-service` (ambos
PARKED) ainda cobram em uma transação e entregam em outra —
[Achado 9](../research/ECONOMY_FRAMEWORK_AUDIT.md#10-achado-9--compra-de-propriedade-cobra-antes-de-entregar).
Migrar **não** é reativar
([PARKED_SERVICES_DECISION](../technical/PARKED_SERVICES_DECISION.md)).

---

## 11. Ver também

- [`CONTRACTS.md`](../gameplay/CONTRACTS.md) — o primeiro consumidor do escrow
- [`DEBT_SYSTEM.md`](../gameplay/DEBT_SYSTEM.md) — dívida como registro
- [`ECONOMY_SECURITY_MATRIX.md`](../testing/ECONOMY_SECURITY_MATRIX.md) — o que está testado, e o que não está
- [`INVENTORY_FRAMEWORK.md`](INVENTORY_FRAMEWORK.md) — o equivalente para item

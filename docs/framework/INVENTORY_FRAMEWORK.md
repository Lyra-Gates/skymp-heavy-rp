# Inventory Framework

**Estado:** implementado, testado (70 testes novos, 6 mutações verificadas) e
**é o caminho obrigatório** para item que muda de dono. **Nunca rodou numa
sessão real** — mesmo peso que a frase tem no
[`INTERACTION_FRAMEWORK.md`](INTERACTION_FRAMEWORK.md).

Arquivos:

| Arquivo | Responsabilidade | Toca `mp`/banco? |
|---|---|---|
| [`core/inventory-owner.js`](../../skymp/gamemode/core/inventory-owner.js) | O vocabulário de "de quem é este item" | **Não** — função pura |
| [`core/inventory.js`](../../skymp/gamemode/core/inventory.js) | Move item entre donos, numa transação | Banco, por injeção do `transaction-service` |
| [`core/transaction-service.js`](../../skymp/gamemode/core/transaction-service.js) | Trava linha, recusa estoque insuficiente, grava razão | Sim — é o único que escreve pilha |

---

## 1. O problema

`core/transaction-service.js` faz o que promete: `BEGIN`, `SELECT … FOR UPDATE`,
razão, `idempotency_key`. **Mas ele só sabe falar de um dono: personagem.**

Toda vez que um item precisou ir para outro lugar, quem precisou disso escreveu
o outro lado à mão, fora da transação — três implementações, com a mesma forma
de defeito que já foi apagada duas vezes neste projeto. Diagnóstico completo em
[`INVENTORY_TRADE_CRAFTING_AUDIT.md`](../research/INVENTORY_TRADE_CRAFTING_AUDIT.md).

---

## 2. A regra central

> **O razão fecha em zero.**

Para todo `transfer_id`, a soma dos `delta` gravados é zero. Item não aparece e
não some: ele sai de um dono e entra em outro, e os dois lados deixam linha —
inclusive quando um dos lados é o nada.

É essa propriedade, e não o valor de retorno das funções, que os testes
afirmam. Uma checagem de `resultado.ok` passa em qualquer implementação que
devolva `true`; a soma só fecha se o item tiver mesmo se movido.

---

## 3. Qual API usar

| Situação | Use |
|---|---|
| Um dono só muda (dar/tirar de um personagem) | `transactionService.giveItem` / `removeItem` |
| **Dois donos** (troca, baú, barraca, craft) | `inventory.transfer` |
| Duas ou mais pernas que precisam commitar juntas | `inventory.exchange` |
| Item nasce ou morre | `inventory.mint` / `inventory.burn` |
| A operação precisa commitar junto com ouro | as primitivas `tx.*`, na sua transação |

A última linha é a compra em barraca, e continua sendo a forma certa para ela:
`market_stall_items` não é uma pilha (carrega preço, rótulo e status por
anúncio), então a barraca abre a própria transação e usa `tx.*` dentro dela.

---

## 4. O modelo de item

### 4.1 Pilha é o padrão

```
(dono, base_id, count)
```

`base_id` é o FormID nativo, **em decimal** no banco. Não há instância, não há
durabilidade, não há proveniência.

### 4.2 Instância: desenhada, não construída

O §5 do pedido pede o desenho e adverte contra transformar tudo em UUID. O
desenho é este:

```
ItemDefinition   base_id → { tipo, empilhável, precisa_instância }   (hoje: core/espm.js)
ItemInstance     uuid, definição, dono, metadata                     (não existe)
Stack            (dono, base_id, count)                              (é o que existe)
```

**Nenhuma definição opta por instância hoje**, e a tabela não foi criada. Três
razões, em ordem de peso:

1. **O Skyrim nativo não tem o conceito.** `AddItem(baseId, count)` é a única
   API de entrega. Uma instância no banco não teria como ser projetada no
   cliente — ela existiria só para o servidor, e o jogador veria uma espada
   igual a qualquer outra.
2. **Custa linha por unidade.** 400 flechas viram 400 linhas numa tabela lida no
   login de todo mundo.
3. **Nenhum sistema atual lê metadata.** Barraca, governança, craft e morte
   trabalham com pilha.

**O gatilho para construir**, para quem chegar aqui depois: o primeiro requisito
que precise distinguir duas unidades do mesmo `base_id` — durabilidade,
"esta espada foi forjada por Fulano", contrabando marcado. Aí a forma é uma
tabela `item_instances` e um `precisa_instância` na definição, com o adaptador
roteando por ela. Até lá, construir seria a abstração prematura que o
`module-registry` recusou em 06/08/2026, pelo mesmo argumento.

### 4.3 Metadata

O §6 do pedido lista durabilidade, qualidade, `craftedBy`, roubado, nome
customizado, origem, encantamento, série, expiração.

Todos dependem de instância (§4.2), **e nenhum é aceito do cliente**. Quando
existirem, nascem server-side: o `execute` de uma interação recebe `data` já
saneado pelo `schema`, e um campo não declarado não chega ao módulo — a regra do
[`INTERACTION_FRAMEWORK.md`](INTERACTION_FRAMEWORK.md) §5 vale aqui sem mudança.

---

## 5. Donos

```js
const inventory = require('./core/inventory');

inventory.character(characterId, actorId)   // actorId opcional: só projeta no cliente
inventory.container(containerId)            // containers.id, não o formDesc
inventory.system('craft')                   // o nada, com origem nomeada
```

Sete tipos, **três com armazenamento**:

| Tipo | Adaptador | Onde mora |
|---|---|---|
| `character` | sim | `character_inventory` |
| `container` | sim | `container_inventory` |
| `system` | — (é o nada) | só razão |
| `property` | **não** | hoje uma propriedade *é* um container |
| `faction` | **não** | não há tabela de item de facção |
| `corpse` | **não** | `corpse-probe` observa, não guarda |
| `market` | **não** | `market_stall_items` é oferta, não pilha |

Um pedido contra um tipo sem adaptador falha com *"Tipo de dono nao
suportado"* — fechado, nomeado, visível. É o mesmo critério dos seis tipos de
alvo sem resolvedor no Interaction Framework, pela mesma razão.

Para dar dono a um tipo, do `initialize()` do módulo:

```js
inventory.registerAdapter('corpse', {
  applyDelta: (conn, owner, baseId, delta) => /* … */,
  list: (runner, owner) => /* … */,
  assertOwner: (conn, owner) => /* … */    // opcional
});
```

O core não precisa saber que ele existe.

### `system` é uma lista fechada

`craft`, `consume`, `gather`, `staff`, `destroy`, `seed`. Um rótulo novo é
decisão de economia e passa por revisão de código — o que torna *"que caminhos
criam item neste servidor?"* respondível por leitura.

---

## 6. A API

```js
await inventory.transfer({
  from: inventory.character(12, 0x100),
  to:   inventory.container(3),
  items: [{ baseId: 0x12eb7, quantity: 1 }],
  reason: 'container_deposit',
  module: 'housing',
  requestId: inventory.newRequestId('deposit.12')
});
```

Várias pernas numa transação só:

```js
await inventory.exchange({
  legs: [
    { from: A, to: B, items: [/* … */] },
    { from: B, to: A, items: [/* … */] }
  ],
  reason: 'trade', module: 'trade', requestId: `${sessionId}.v${version}`
});
```

### O resultado tem forma única

```js
{ ok, code, reason, transferId, duplicate, legs, items }
```

Não é união discriminada de propósito: o `jsconfig.json` deste pacote roda com
`strictNullChecks: false` (deliberadamente — ligar `strict` produziria centenas
de erros no código existente), e sem ele o TypeScript não estreita
`{ok:true}|{ok:false}`. Uma API cujo uso correto acende o `npm run typecheck` é
uma API que ensina a ignorar o verificador.

`code` é estável e serve para ramificar: `INVALID_QUANTITY`, `INVALID_ITEM`,
`UNKNOWN_FORMID`, `INVALID_REQUEST_ID`, `SAME_OWNER`, `NO_ADAPTER`, `TOO_MANY`,
`EMPTY`, `OWNER_NOT_FOUND`, `INSUFFICIENT`, `DB`.

`reason` é a frase que o jogador pode ver. **Erro de banco nunca vira `reason`**
— vai para o log, e a tela recebe *"Nao foi possivel concluir a operacao."*.
Mesma correção que a compra em barraca já tinha levado.

---

## 7. O que o pipeline garante

### 7.1 Validação, antes de tocar no banco

`NaN`, `Infinity`, fracionário, negativo, zero, acima do teto, FormID
desconhecido, `requestId` malformado, origem igual ao destino, dono sem
adaptador. Nada disso custa uma conexão do pool.

`core/espm.pareceItem` responde **`ok` quando não sabe** (sem `mp`, servidor
antigo): é diagnóstico de digitação, não autoridade. Só nega quando a API
respondeu e respondeu que aquele FormID não vai para inventário.

### 7.2 Ordem global de lock

Uma transferência A→B e outra B→A ao mesmo tempo travariam em ordem oposta e
fariam deadlock. As operações são ordenadas por `(chave do dono, base_id)`, o
que dá a **toda** transferência do servidor a mesma ordem de aquisição — o ciclo
vira impossível em vez de improvável.

Deltas do mesmo `(dono, item)` vindos de pernas diferentes são somados antes:
uma troca em que os dois lados oferecem a mesma poção mexe numa linha por lado,
não em duas.

### 7.3 Idempotência que sobrevive a restart

`requestId` é **obrigatório**. A primeira linha de razão usa `requestId#0` como
âncora, e o replay é conferido **dentro** da transação com `FOR UPDATE`:

| Situação | Resposta |
|---|---|
| Primeira chamada | Executa |
| Segunda, com a mesma chave | `duplicate: true`, devolve o mesmo `transferId`, não executa |
| Duas concorrentes com a mesma chave | A segunda **espera** e lê o resultado da primeira |
| Recusa antes do commit | A chave **não é consumida** — o retry corrigido funciona |

A terceira linha é a correção do §7 da auditoria: `giveItem` conferia a chave
numa conexão diferente da que abria a transação, então a segunda chamada
recebia `false` — e um chamador com compensação devolveria item por uma
operação que tinha dado certo.

Isto é a camada que protege item. A dedup em memória do Interaction Framework
protege contra duplo clique e continua existindo; as duas resolvem coisas
diferentes.

### 7.4 O cliente vem depois do commit

Sempre. Uma falha em `AddItem`/`RemoveItem` deixa o cliente divergente e é
reconciliada no próximo login — nunca desfaz o que commitou.

---

## 8. O que este framework **não** faz

- **Não mede distância.** Quem mede é o pipeline de interação, que já tem ator,
  alvo e `assertRange`. Medir aqui seria medir num instante diferente do que
  autorizou. Quem chama revalida imediatamente antes — o `trade-service` faz.
- **Não checa permissão.** É do módulo que ofereceu a ação. Esta API é o
  notário, não o juiz.
- **Não move ouro.** Ouro é `core/transaction-service`. Expor "mexa em ouro
  também" numa API de item é como o `economy-service` começou.
- **Não impõe capacidade nem peso.** O contrato do adaptador tem o lugar,
  nenhum adaptador o implementa, e nenhuma coluna o suporta. Ausente, não
  simulado.
- **Não reconcilia o que o cliente tem e o banco não conhece.** É a fronteira do
  [`ADR_003`](../technical/ADR_003_INVENTORY_SOURCE_OF_TRUTH.md) §3, e ela
  continua aberta.

---

## 9. Quem já usa

| Chamador | O que mudou |
|---|---|
| `housing-service.depositItem` | Era `removeItem()` commitado + dois `db.query` soltos. Podia **destruir** item |
| `housing-service.withdrawItem` | **Não existia.** Um baú em que só se deposita não é um baú |
| `crafting-service.craftItem` | Consumo e resultado numa `exchange` de duas pernas; a chave de idempotência deixou de conter `Date.now()` |
| `trade-service` | Reescrito inteiro sobre `exchange` |
| `market-stalls.addItem` / `packStall` / `removeItem` | A perna do inventário entrou na transação da barraca (continuam usando `tx.*`, não `inventory`, porque a barraca não é pilha) |

---

## 10. Banco

`migration-v14-inventory-framework.sql`:

- `character_id` de `inventory_transactions` passa a aceitar `NULL`;
- entram `owner_type`, `owner_ref`, `counterparty_type`, `counterparty_ref`,
  `transfer_id` e dois índices;
- `container_inventory` ganha `UNIQUE (container_id, base_id)` — o invariante
  que o código assumia e que nada declarava. `character_inventory` **já
  tinha**, desde a `migration-v7-indexes.sql`;
- duplicatas preexistentes no baú são **somadas**, não descartadas: perder
  estoque de jogador numa migração é pior que a duplicata sendo consertada.

⚠️ `check-schema-drift.js` não reconhece `MODIFY COLUMN`. Um banco que pulou
esta migração não aparece como divergente; conferir à mão com
`SHOW COLUMNS FROM inventory_transactions LIKE 'character_id'`.

---

## 11. O que NÃO está feito

- **Quatro dos sete tipos de dono não têm adaptador.** Por escolha (§5).
- **Instância e metadata não existem.** Por escolha (§4.2).
- **Capacidade e peso não existem.**
- **Não há UI.** Nem de inventário, nem de baú, nem de troca — os comandos de
  chat são a interface inteira. O §18 do pedido (componentes reutilizáveis
  `InventoryView`/`ContainerView`/`TradeView`/`CraftingView`) não foi
  construído: construir quatro telas contra um servidor que nunca recebeu um
  jogador escolheria o desenho da UI antes de saber o que a cena precisa
  mostrar. O que existe do lado do servidor é o formato de dados —
  `inventory.list(owner)` devolve `[{baseId, count}]` para qualquer dono, que é
  o modelo único que as quatro telas compartilhariam.
- **`container` não tem resolvedor de alvo de interação.** Abrir baú continua
  sendo chamada direta do `housing-service`, que está PARKED.
- **Nada disto rodou numa sessão real.**

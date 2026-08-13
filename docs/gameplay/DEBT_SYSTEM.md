# Sistema de dívida

**Dívida é registro selado e legível — nunca cobrança automática.**

- Código: [`debt-service.js`](../../skymp/gamemode/debt-service.js)
- Decisão: [ADR 004 §2.8 e §4.4](../technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md)
- Economia: [`ECONOMY_FRAMEWORK.md`](../framework/ECONOMY_FRAMEWORK.md)
- Origem do conceito: Mereth Roleplay — **sem licença e sem código público**.
  Reimplementação a partir da ideia ([pesquisa](../research/SKYMP_ECOSYSTEM_DEEP_DIVE.md) §4).

> ⚠️ **PARKED.** Não está no `core/module-registry.js` e não roda. Ver
> [Fase 0](../technical/FASE_0_ROTEIRO.md) e
> [PARKED_SERVICES_DECISION](../technical/PARKED_SERVICES_DECISION.md).

---

## 1. A decisão que define tudo

O servidor **não** confisca ouro para pagar dívida. Não vigia saldo, não abate
quando o devedor recebe, não bloqueia ação, não emite mandado sozinho, não
cobra juros.

Isso não é uma limitação a ser corrigida depois. É a decisão.

**Por quê.** A alternativa — abater no instante em que o ouro entra na conta do
devedor — foi considerada e rejeitada na
[ADR 004 §4.4](../technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md#44-dívida-com-cobrança-automática-débito-quando-o-saldo-aparece). Ela:

- **remove a cena.** Ninguém precisa cobrar, então ninguém cobra. Some o agiota,
  some a ameaça, some o acordo na taverna, some a guilda que compra a dívida;
- **põe o servidor no papel do outro jogador.** Quem cobra passa a ser o
  sistema, não o credor;
- **é irreversível e silenciosa** — a combinação que a
  [Constituição](../CONSTITUICAO.md) trata como falha grave.

O briefing §11 pede que dívida gere RP para guildas, tribunais, crime e
política. Um confisco automático faz o oposto: transforma inadimplência em
processamento em lote.

**O que o serviço garante, então:** que a dívida exista de forma que qualquer um
possa ler, que pagamento mova septims de verdade pelo `economy-service`, e que
`remaining` só caia porque houve pagamento ou perdão registrado.

---

## 2. O que uma dívida guarda

| Campo | O quê |
|---|---|
| `debtor_character_id` | quem deve |
| `creditor_type` / `creditor_ref` | a quem — `character`, `city`, `hold`, `faction`, `realm` |
| `principal` | valor original. **Nunca muda.** |
| `remaining` | saldo devedor. Só cai por `debt_payments`. |
| `reason` | o texto que a cena vai ler |
| `origin_type` / `origin_ref` | `fine`, `contract`, `rent`, `tax`, `manual` + o id de origem |
| `status` | `active`, `paid`, `defaulted`, `forgiven` |

O credor usa o mesmo vocabulário de titular do ledger, então uma dívida com a
cidade de Whiterun (`city:whiterun`) e uma dívida com o personagem 52
(`character:52`) são a mesma estrutura — e o pagamento de ambas é a mesma
transferência.

`principal` separado de `remaining` é o que permite ler "devia 500, pagou 300,
faltam 200" em vez de só "faltam 200".

---

## 3. Estados

```
   active ──► paid       remaining chegou a zero por pagamento
          ──► forgiven   o credor abriu mão do saldo restante
          ──► defaulted  declarado inadimplente
```

`defaulted` é **rótulo, não confisco**. Nenhum septim se move, nenhum item é
tomado, nenhuma ação do jogador é bloqueada. O que muda é que a dívida aparece
como inadimplente para quem consultar — e o que se faz com essa informação é
papel de guilda, tribunal e jogador.

E `defaulted` **não fecha a porta**: uma dívida marcada como inadimplente ainda
pode ser quitada. Pagar é o que a fecha, e o estado final vira `paid`. Não há
transição "voltar para `active`" — pagar já é isso.

---

## 4. Operações

```js
const debts = require('./debt-service');

// Abrir — NÃO move septim. Dívida é o registro de que o dinheiro não se moveu.
await debts.open({
  debtorCharacterId: 41,
  creditor: { type: 'city', ref: 'whiterun' },
  amount: 300,
  reason: 'Multa nao paga da guarda de Whiterun',
  originType: 'fine',
  originRef: '77',
  idempotencyKey: chave        // obrigatória: a mesma multa não vira duas dívidas
});

// Pagar — total ou parcial. O septim se move PRIMEIRO.
await debts.pay({ debtId, amount: 100, idempotencyKey: chave });

// Perdoar — o credor abre mão. Não move septim.
await debts.forgive({ debtId, amount: 50, actorCharacterId: credorId, idempotencyKey: chave });

// Rotular
await debts.markDefaulted({ debtId });

// Ler — é o que faz a dívida ser "legível"
await debts.listByDebtor(characterId);
await debts.listByCreditor({ type: 'city', ref: 'whiterun' });
await debts.history(debtId);
```

### A ordem no pagamento é o ponto

O septim se move pelo `economy-service` **antes** de `remaining` cair, na mesma
transação. Se fosse ao contrário, uma falha no pagamento deixaria a dívida menor
sem ninguém ter recebido nada — que é exatamente a classe do
[Achado 8](../research/ECONOMY_FRAMEWORK_AUDIT.md#9-achado-8--a-multa-não-é-atômica-e-a-dívida-que-ela-cria-não-é-dívida),
o bug que este sistema veio consertar.

Cada linha de `debt_payments` carrega o `transfer_id` das duas pernas no ledger
de ouro. É o que prova que a dívida caiu porque septim mudou de dono, e não
porque alguém editou `remaining`. Perdão grava `transfer_id = NULL` e
`kind = 'forgiveness'` — a ausência de transferência é o que distingue os dois
no histórico.

**Pagamento parcial é permitido de propósito.** "O trabalhador recebe o que
existe; o resto continua registrado" é o comportamento que transforma
inadimplência em cena em vez de bloqueio.

---

## 5. De onde vem uma dívida hoje

Uma origem, ligada em 13/08/2026: **a multa da guarda**.

```
guarda multa 300 septims
        │
        ├── o alvo tem o ouro  →  transferência alvo → cidade, multa `paid`
        │
        └── não tem            →  multa `unpaid`
                                  + dívida `active` com credor = a instituição
                                  + mandado menor
```

Tudo numa transação só. E a mudança que mais importa: **falha de infraestrutura
não produz mais dívida nem mandado**. Antes, `removeGold` devolvia `false` tanto
para "não tem ouro" quanto para "o banco caiu", e o ramo `!paid` emitia mandado
de prisão — um timeout de rede virava material de cena contra alguém que tinha o
dinheiro. Agora só `insufficient_funds` chega ali; qualquer outra falha lança,
dá rollback e não deixa nada.

O credor é a instituição que deu ao guarda o poder de multar (a cidade, o reino
ou a facção do cargo dele). Quando quem multa é um governador de staff, sem
cargo IC, o ouro é destruído contra `system:staff_fine` — que é o que já
acontecia com *todas* as multas antes, só que agora declarado e com linha de
ledger.

`rent`, `tax` e `contract` estão na lista de origens e ainda não têm chamador.

---

## 6. Como isso vira RP

O serviço entrega dados; a cena é dos jogadores. O que os dados permitem:

- **Guilda de mercadores** consulta `listByCreditor` e sabe quem lhe deve.
- **Tribunal** lê `reason` e `origin_ref` e tem o caso documentado.
- **Cobrador** tem um alvo com valor exato e história de pagamentos parciais.
- **Crime** ganha motivo: dívida com nome, valor e credor conhecidos.
- **Política** ganha instrumento: perdoar a dívida de uma cidade inteira é uma
  decisão que o sistema suporta e registra.
- **Comprar dívida de terceiro** é `forgive` do credor antigo + `open` do novo,
  hoje feito à mão.

Nada disso é código. É o que o registro torna possível.

---

## 7. O que não existe

1. **Juros.** `principal` nunca muda. Juros exigiriam política econômica que não
   temos e um relógio que ninguém liga.
2. **Prazo.** Não há vencimento. `markDefaulted` é chamada por decisão, não por
   relógio.
3. **Transferência de titularidade.** Vender dívida a terceiro é `forgive` +
   `open`, sem vínculo entre as duas.
4. **Consequência automática.** Nenhuma dívida bloqueia comprar, entrar em
   cidade, usar barraca ou qualquer outra coisa. Por decisão (§1).
5. **Interface.** Sem comando e sem painel — o serviço tem API.
6. **Autorização de perdão.** O serviço não sabe quem manda numa cidade. Quem
   chama resolve; duplicar a regra criaria dois lugares para mantê-la.
7. **Nada rodou em servidor.** MySQL simulado, como o resto.

---

## 8. Segurança

Coberto por teste ([matriz](../testing/ECONOMY_SECURITY_MATRIX.md)): abertura
sem movimento de septim, origem repetida virando uma dívida só, dívida consigo
mesmo, credor `system` recusado, pagamento parcial e total, pagamento acima do
saldo devedor, replay de pagamento, pagamento de dívida fechada, perdão total e
parcial, `defaulted` sem confisco e quitação após `defaulted`, e falha de
infraestrutura no meio do pagamento.

A afirmação mais importante travada por teste é a §1: **abrir dívida não move
septim, e `defaulted` não confisca**. Quem "melhorar" o serviço transformando-o
em cobrança automática reprova esses dois testes.

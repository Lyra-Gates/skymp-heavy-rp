# Sistema de troca

**Estado:** implementado e testado (25 testes, 2 mutações verificadas).
Registrado no `module-registry` como `trade`, atrás de `ENABLE_TRADE_SERVICE`,
que nasce `false`. **Sem UI CEF** e **nunca rodou numa sessão real**.

Arquivo: [`trade-service.js`](../../skymp/gamemode/trade-service.js).

---

## 1. O que existia antes

90 linhas que negociavam o **convite** e guardavam `{initiatorId, targetId,
status}` num `Map`. O próprio cabeçalho dizia que a transferência "nunca foi
escrita" — e não havia oferta, confirmação, revalidação, transação, timeout nem
limpeza em desconexão. [Auditoria §12](../research/INVENTORY_TRADE_CRAFTING_AUDIT.md).

---

## 2. A regra que organiza o sistema

> **Confirmação é sobre uma oferta específica, não sobre a sessão.**

Toda mudança de oferta incrementa a `version` da sessão e **derruba as duas
confirmações**. Sem isso existe o golpe clássico: A confirma vendo a oferta X, B
troca a oferta por Y e confirma, e A fecha um negócio que nunca viu.

É a mesma disciplina do `canSee` do Interaction Framework — o que foi mostrado
num instante anterior não vale como autorização agora.

---

## 3. A máquina de estados

```
              /trade                /tradeaccept
   (nada) ─────────────► REQUESTED ──────────────► ACTIVE
                              │                      │  /tradeadd  (version++)
                              │ 45 s                 │  /tradeconfirm
                              ▼                      ▼
                           EXPIRED              [os dois confirmaram
                                                 a MESMA version]
                                                       │
                                                       ▼
                                                  COMMITTING
                                                       │
                              ┌────────────────────────┼─────────────────┐
                              ▼                        ▼                 ▼
                        revalidação falha         exchange falha     tudo ok
                              │                        │                 │
                              └──────► CANCELLED ◄─────┘                 ▼
                                                                    COMPLETED

  /tradecancel, desconexão  ──► CANCELLED        3 min sem toque ──► EXPIRED
```

`COMMITTING` não é decorativo: é ele que impede um segundo `/tradeconfirm`,
chegando enquanto a transação roda, de entrar no `exchange` de novo. A
idempotência do `core/inventory` já protegeria o **banco**; este estado protege
a **sessão**, que é memória, onde o `requestId` não alcança.

### Timeouts

| | Prazo | Por quê |
|---|---|---|
| Convite (`REQUESTED`) | 45 s | é um toque no ombro, não um compromisso |
| Sessão (`ACTIVE`) | 3 min sem toque | §12 do pedido: troca infinita não existe |

A expiração acontece **na leitura**, não num `setInterval`. Um timer teria que
ser desligado no `shutdown` e é mais uma coisa que sobrevive ao desligamento; a
expiração preguiçosa não tem ciclo de vida próprio. Para o desligamento existe
`sweep()`, que o `shutdown` do módulo chama.

---

## 4. O fechamento revalida tudo

| Revalidação | O que pode ter acontecido desde a confirmação |
|---|---|
| os dois ainda logados | um caiu |
| mesmo personagem no mesmo ator | um trocou de personagem |
| distância (`assertRange`) | um andou para longe |
| `actionPolicy.canPerform(…, 'trade')` | algemado, preso, abatido, morto, zona segura |
| **posse** | vendeu na barraca, largou, craftou com o item |

As quatro primeiras são do `commitTrade`. A quinta é do `FOR UPDATE` dentro do
`exchange`, e **só ela poderia ser** — nenhuma checagem feita na hora de ofertar
sobreviveria até o commit.

A política é consultada em vez de o serviço ler `character-state` direto: assim
os cinco estados e a zona segura valem aqui sem que este arquivo conheça
nenhum dos cinco.

---

## 5. O commit

Uma `inventory.exchange` com até duas pernas:

```js
inventory.exchange({
  legs: [
    { from: A, to: B, items: ofertaDeA },
    { from: B, to: A, items: ofertaDeB }
  ],
  reason: 'trade', module: 'trade',
  requestId: `${sessionId}.v${version}`
});
```

Ou as duas pernas commitam, ou nenhuma. Uma troca em que só uma perna commita é
doação — e é o caso que o teste *"a segunda perna falhando desfaz a primeira"*
existe para pegar.

A `version` entra na chave: um commit da v3 e um da v4 são pedidos diferentes e
nunca devem se deduplicar entre si.

---

## 6. Desconexão: não há nada a devolver

A oferta é **intenção em memória**. O item nunca sai do dono até o commit, então
uma sessão que morre — por desconexão, timeout ou restart do servidor — não
deixa item preso em lugar nenhum.

Isso é uma escolha, e a alternativa tem nome: **custódia**, em que a oferta é
depositada numa sessão. Custódia precisaria de tabela, de um caminho de
recuperação para item preso numa sessão que morreu com o processo, e de uma
resposta para "o servidor caiu com 40 trocas abertas". Foi recusada por isso.

O custo da escolha: a posse só é conferida de verdade no fechamento, então dá
para ofertar o que se está vendendo em paralelo. O resultado é a troca falhar
com *"Estoque insuficiente"*, não item duplicado — e o teste *"quem vendeu o
item entre a confirmação e o fechamento não doa nada"* afirma exatamente isso.

---

## 7. Ouro: possível, não feito

O §11 do pedido permite ouro na troca depois. Ele **não está implementado**.

Quando entrar, a forma é decidida: as primitivas
`transactionService.tx.applyGoldDelta` + `recordGoldLedger` **dentro da mesma
transação** do `exchange` — que hoje o `core/inventory.js` não expõe, de
propósito. Expor "mexa em ouro também" numa API de item é como o
`economy-service` começou, e ele foi apagado por isso.

O caminho concreto é o que a compra em barraca já faz: abrir a transação no
chamador e usar as primitivas dos dois assuntos dentro dela. Isso exige que o
`inventory.exchange` aceite participar de uma transação do chamador, que é a
mudança pendente.

---

## 8. Superfície

### Comandos

| Comando | O que faz |
|---|---|
| `/trade <actorId>` | Propõe (actorId em hexadecimal, com ou sem `0x`) |
| `/tradeaccept` | Aceita o convite pendente |
| `/tradeadd <baseId> <qtd>` | Adiciona à própria oferta; quantidade negativa remove |
| `/tradeconfirm` | Confirma a oferta **desta versão** |
| `/tradecancel` | Cancela |

### Interação

`trade.request` — "Propor negocio", alvo `player`, alcance de fala, auditoria
`TRACE`, não idempotente.

Só o **convite** é interação. O resto acontece dentro de uma sessão que já tem
os dois lados, e um menu contextual sobre outro jogador não é o lugar de
"adicionar item à minha oferta".

`canSee` some do menu de quem já está numa troca, dos dois lados: um botão que
só responde *"voce ja esta numa troca"* ensina o jogador a ignorar o menu.

---

## 9. Limites

| | Valor | Por quê |
|---|---|---|
| Tipos de item por lado | 12 | uma troca de 500 itens é script, não cena |
| Itens no total da transação | 32 (do `core/inventory`) | orçamento de uma transação |
| Alcance | o de fala (`proximity-ranges.RANGES.say`) | quem consegue conversar consegue negociar |

---

## 10. O que NÃO está feito

- **Não há UI CEF.** Os comandos de chat são a interface inteira. O Red House
  tem uma janela de troca (`front/src/features/systems/trade`) apontada em
  [`PARKED_SERVICES_DECISION.md`](../technical/PARKED_SERVICES_DECISION.md) §6
  como **lista de casos a cobrir**, não código a portar — e nada foi portado.
  As três decisões que aquele documento pede antes de abrir o repositório deles
  estão fechadas agora: commit duplo existe (§2), ouro passa pelo
  transaction-service (§7), e nenhuma linha foi copiada.
- **Ouro não entra na troca** (§7).
- **Não há histórico de trocas por jogador.** O razão tem tudo — `transfer_id`
  agrupa as pernas e `reason = 'trade'` as identifica —, mas nenhuma tela lê.
- **Nunca rodou numa sessão real.**

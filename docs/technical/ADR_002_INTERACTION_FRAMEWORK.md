# ADR 002 — Interaction Framework: inversão de registro, não Service Locator

**Status:** aceito · **Data:** 13/08/2026 · **Contexto:** PROMPT 2 (Core Framework, Module System e Interaction Framework)

> Este projeto guarda ADRs em `docs/technical/`, ao lado do [`ADR_001`](ADR_001_ONLINE_PROFILE_ID_IS_ACCOUNT_ID.md). O pedido mencionava `docs/adr/`, que não existe.

---

## 1. Contexto

O menu de interação contextual já existia dentro de `governance-service.js`, e o fluxo estava correto: o servidor monta a lista, o cliente escolhe, o servidor revalida antes de executar.

Três coisas não estavam:

1. Para uma barraca aparecer no menu, a governança fazia `require('./market-stalls-service')` por nome fixo dentro de uma função de domínio — e `market-stalls` já declarava `dependencies: ['governance']`. A seta apontava para os dois lados.
2. O vocabulário de ações era a regex `/^(guard|stall|npc)\.[a-z_]+$/` no core da governança. `identity.introduce`, `medical.help`, `law.search` morriam nela.
3. `requestId` era validado no formato e descartado. Duplo clique em "Aplicar multa" cobrava duas vezes.

Diagnóstico completo em [`CORE_FRAMEWORK_AUDIT.md`](../research/CORE_FRAMEWORK_AUDIT.md) §6.

---

## 2. Decisão

Um **Interaction Registry** central onde os módulos *registram* o que oferecem, e um **Interaction Service** que decide cada pedido por um pipeline fixo.

A inversão é o ponto: quem tem uma ação a oferecer registra; ninguém busca ninguém. `governance-service` deixou de conhecer `market-stalls`, e um módulo novo entra no menu sem tocar em nenhum arquivo do core.

---

## 3. Alternativas consideradas

### 3.1 Manter o menu na governança e adicionar um hook

Um array de callbacks que os módulos preenchem, mantendo `getInteractionActions` como orquestrador.

**Rejeitada.** Resolve o `require` fixo e nada mais: a regex de três namespaces, o schema de todas as ações num `if`, a ausência de distância no `canSee` e o `requestId` morto continuariam onde estavam. E deixaria o menu de interação do servidor inteiro dentro do módulo de governo — que não é o dono do conceito.

### 3.2 Cada módulo com o próprio menu, roteado por prefixo

`ui-event-router` já rotearia `medical:*` para o módulo médico, que montaria o próprio menu.

**Rejeitada.** É a arquitetura de hoje levada ao limite, e ela produz N implementações de validação de alvo, N de distância, N de deduplicação. A validação frouxa de uma delas viraria a porta de entrada. O pipeline existe justamente para que a checagem seja uma só.

### 3.3 Herdar o desenho do Red House

O sistema de módulos do Red House distribui eventos de jogo para quem quiser escutar, e o menu de interação é montado sobre isso.

**Rejeitada como base, aproveitada como referência.** A distribuição genérica de eventos foi avaliada em 06/08/2026 e recusada com um censo: **um** módulo escuta evento de jogo, e `onCellChange` não tem consumidor nenhum. Aquele raciocínio continua valendo e está no cabeçalho do `module-registry.js`.

A diferença de fundo é a mesma que separa `core/hit-events.js` da origem dele: **o Red House usa esses mecanismos como autoridade; aqui eles são evidência ou pedido, nunca fonte de verdade.**

---

## 4. Por que NÃO existe um Service Registry

O §6 do pedido perguntou explicitamente se `services.get('inventory')` deveria existir. **Não.**

### O problema não é encontrar serviços

O acoplamento real era `governance → market-stalls`, criado por `getInteractionActions` precisar montar seções que não eram dela. Um localizador trocaria `require('./market-stalls-service')` por `services.get('market-stalls')` — o mesmo acoplamento, com indireção a mais e a análise estática a menos.

**A inversão elimina a busca inteira.** Não há o que localizar: `market-stalls` registra `stall.view` e a governança nunca sabe que ele existe.

### Um localizador pioraria a testabilidade

O §6 pedia para não introduzir Service Locator se isso piorasse testabilidade. Aqui pioraria de forma concreta: os testes deste projeto isolam por `require` direto e mock de `mp`/banco. Um registro global viraria estado compartilhado entre casos — exatamente o problema que `interactionRegistry._reset()` e `moduleRegistry._reset()` precisaram resolver, e que só é gerenciável porque o escopo é uma coisa (interações), não todos os serviços do servidor.

### O que fica em cada lugar

| Precisa de | Como |
|---|---|
| Chamar um serviço concreto (transação, inventário) | `require` explícito, estático, analisável |
| Oferecer uma ação num menu sem que o core saiba | Registro no `interaction-registry` |
| Consultar um módulo que pode não estar ligado | `optionalDependencies` + `moduleRegistry.isEnabled()` |
| Injetar `mp`, banco, relógio, log | Injeção por construtor — padrão já em uso |

A injeção por construtor (`createInteractionService({...})`, `createConnectionMonitor({...})`, `createTargetResolvers({...})`) é a forma de DI que este projeto já adotou, e ela é o que torna o pipeline testável sem servidor. Não é preciso um contêiner para isso.

---

## 5. Consequências

### Boas

- Um módulo novo entra no menu sem tocar no core (§23 do pedido).
- A validação de alvo, distância, permissão, schema e deduplicação existe **uma vez**.
- `canSee` × `canExecute` virou contrato explícito e testado, em vez de comportamento acidental.
- Duplo clique deixou de cobrar duas vezes em multa, prisão, confisco e compra.
- O menu deixou de prometer o que o servidor recusaria: distância entrou no `canSee`.
- O ciclo de vida das ações é automático — inclusive para módulo que falha no meio do `initialize`.

### Custos

- Mais um conceito para quem chega: além de comando e evento de UI, existe interação.
- **A migração foi de uma vez, servidor e CEF na mesma frente.** Não houve período de convivência: o legado saiu no mesmo dia em que a UI passou a falar `interaction:*`. A alternativa — dois caminhos vivos até uma sessão real — foi descartada porque duas portas para "Aplicar multa" com regras de deduplicação diferentes é pior que uma porta não testada. O custo é que **um erro na CEF derruba o menu inteiro**, sem caminho de volta que não seja `git revert`.
- Uma interação registrada é código que só roda quando alguém aponta para alguém. **Nada disto foi exercitado numa sessão real.**

### Riscos aceitos

- **A dedup é em memória.** Perde-se num restart. Deliberado: a idempotência que precisa sobreviver a restart já existe por `idempotency_key` no `transaction-service`, e é ela que protege ouro e item.
- **Seis dos sete tipos de alvo não têm resolvedor.** Um pedido contra eles falha fechado e nomeado. Escrever os seis contra APIs `[DOC]` que este projeto nunca exercitou seria pior que a ausência, porque pareceria pronto.
- **`stall.manage` saiu do menu.** Dependia de alvo `self`, que o framework não permite — e já era inalcançável antes, por uma recusa da governança que a auditoria encontrou (§6.7a). O comando de chat continua.
- **`economy-regional` (PARKED) ficou com duas funções órfãs.** `getInteractionSections` e `handleInteractionAction` não têm mais chamador. Não foram removidas: o módulo está parado, e mexer nele é reengenharia, não limpeza.

---

## 6. Como saber que esta decisão foi errada

- Se, em três módulos novos, algum precisar editar `core/` para existir no menu, a inversão não pegou.
- Se `canSee` virar o lugar onde a autorização de fato mora — e `canExecute` ficar vazio —, a separação virou cerimônia e a regra do §2 do framework foi perdida.
- Se a dedup em memória causar cobrança dupla observada numa sessão real, ela precisa descer para o banco.
- Se o pipeline aparecer no orçamento de frame, o estágio caro precisa ser medido antes de otimizado — não o contrário.

---

## 7. Referências

- [`docs/research/CORE_FRAMEWORK_AUDIT.md`](../research/CORE_FRAMEWORK_AUDIT.md) — a auditoria que precedeu esta decisão
- [`docs/framework/INTERACTION_FRAMEWORK.md`](../framework/INTERACTION_FRAMEWORK.md) — o contrato de uso
- [`docs/framework/MODULE_SYSTEM.md`](../framework/MODULE_SYSTEM.md) — ciclo de vida e dependências
- [`docs/testing/INTERACTION_TEST_MATRIX.md`](../testing/INTERACTION_TEST_MATRIX.md) — o que está coberto e o que não está
- `CONTRIBUTING.md` §3.3 (módulo PARKED), §3.6 (evento de cliente é dica, não prova)
- `CONSTITUICAO.md` §13 (baixo acoplamento, módulos independentes), §16 (análise de código)

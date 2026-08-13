# Matriz de Testes — Interaction Framework e Module System

**Data:** 13/08/2026 · **Total:** 96 casos novos, 646 na suíte (5 do caminho legado saíram com ele) · `npm test` a partir de `skymp/gamemode/`

Arquivos:

| Arquivo | Casos | Cobre |
|---|---|---|
| [`core/interaction-registry.test.js`](../../skymp/gamemode/core/interaction-registry.test.js) | 23 | Registro, validação de descritor, saneamento de payload |
| [`core/interaction-service.test.js`](../../skymp/gamemode/core/interaction-service.test.js) | 50 | O pipeline inteiro |
| [`core/module-registry.test.js`](../../skymp/gamemode/core/module-registry.test.js) | 19 | Dependências, ciclo de vida, limpeza |
| [`identity-service.test.js`](../../skymp/gamemode/identity-service.test.js) | 4 | A interação `identity.introduce` |

---

## 1. A matriz do pedido (§21)

| # | Exigido | Onde | Situação |
|---|---|---|---|
| 1 | module dependencies | `module-registry.test.js` — *ordenação de dependências* (7 casos) | ✅ |
| 2 | module lifecycle | `module-registry.test.js` — *ciclo de vida* (8 casos) | ✅ |
| 3 | interaction registration | `interaction-registry.test.js` — *registro* (8 casos) | ✅ |
| 4 | duplicate action IDs | `interaction-registry.test.js` — *recusa id duplicado, nomeando o dono anterior* | ✅ |
| 5 | unknown target | `interaction-service.test.js` — *tipo de alvo sem resolvedor falha fechado* | ✅ |
| 6 | invalid target | `interaction-service.test.js` — *recusa alvo inexistente, mal formado e sem personagem* | ✅ |
| 7 | distance | `interaction-service.test.js` — *distância fora do alcance recusa* + *marca como NÃO verificada* | ✅ |
| 8 | permission | `interaction-service.test.js` — *nega quando negada* + *sem verificador injetado NEGA* | ✅ |
| 9 | canSee | `interaction-service.test.js` — *uma ação vista antes não vale nada se canSee mudar de ideia* | ✅ |
| 10 | canExecute | `interaction-service.test.js` — *canExecute nega o que canSee mostrou* | ✅ |
| 11 | event spoofing | `interaction-service.test.js` — *ignora targetType do cliente* + *campo não declarado não atravessa* | ✅ |
| 12 | rate limit | `interaction-service.test.js` (2) + `ui-event-rate-limiter.test.js` (2) | ✅ |
| 13 | duplicate request | `interaction-service.test.js` — *requestId, duplicata e replay* (9 casos) | ✅ |
| 14 | player disconnect | `interaction-service.test.js` — *ator que desconecta recusa antes de qualquer coisa* | ✅ |
| 15 | target disconnect | `interaction-service.test.js` — *alvo que desconecta entre a consulta e a execução* | ✅ |
| 16 | UI payload validation | `interaction-registry.test.js` — *validação de payload* (9 casos) | ✅ |

---

## 2. Os casos que vieram de defeitos reais

Estes não são cobertura de rotina. Cada um trava um comportamento que estava errado, ou quase.

| Caso | O que estava errado |
|---|---|
| *sobe o dependente mesmo quando registrado ANTES da dependência* | O boot resolvia dependência na ordem de inserção. `market-stalls` só subia porque `phase0-basic.js` registra `governance` primeiro. Mover o bloco o desligava. |
| *distingue DISABLED de FAILED, que isEnabled confunde* | Módulo desligado por flag e módulo que explodiu no boot respondiam a mesma coisa. Um é o estado normal de todo `lab`; o outro é incidente. |
| *remove as interações de um módulo que falha no meio do initialize* | Uma ação registrada antes da exceção ficaria no menu apontando para um serviço que nunca inicializou. |
| *duplo clique cobra UMA vez* | `requestId` era validado no formato e descartado. Duas multas por um clique duplo. |
| *recusa antes do execute NÃO consome o requestId* | O erro clássico da implementação ingênua: marcar o id antes de validar faz o retry corrigido ser recusado como duplicata. |
| *entrega o evento SOMENTE ao handler do prefixo* | O roteador entregava **todo evento a todo handler registrado**. `panel:social:rename` chegava à governança. |
| *ação desconhecida e ação indisponível dão a MESMA resposta* | Mensagens diferentes transformam o menu num oráculo de enumeração do servidor. |
| *guarda que lança vira NEGA, não vira passa* | Um `canSee` com bug não pode abrir o menu de ninguém. |
| *marca a distância como NÃO verificada quando não havia como medir* | `assertRange` sem `mp` devolvia `{ok: true}` — uma afirmação positiva sobre um mundo que ninguém mediu. |
| *aplica política por tipo sem afetar os tipos sem política* | Um teto único para `interaction:query` e `interaction:execute` estrangula o primeiro ou libera o segundo. |
| *int: recusa notação científica, espaço, decimal e zero à esquerda* | `Number("1e3")` é 1000 e `parseInt(" 1")` é 1. Uma validação de "dá pra converter" deixa os dois passarem. |
| *não confunde herança de protótipo com campo enviado* | `schema.toString` não pode ser satisfeito por `Object.prototype`. |
| *número é decimal e string é hexadecimal* | `"512"` é `0x512`, não 512. Trava a convenção que o menu já usa e que uma mudança inocente quebraria em silêncio. |

---

## 3. O que NÃO está coberto, e por quê

### 3.1 Nada rodou numa sessão real

**A lacuna que importa mais que todas as outras somadas.** Os 96 casos provam que o pipeline decide certo com `mp` mockado. Nenhum deles prova que:

- o `browserModal` com `type: 'interaction:actions'` chega à CEF e é renderizado;
- `mp.get(actorId, 'locationalData')` devolve o que `range-utils` espera, com dois clientes conectados;
- a distância medida em unidades do Skyrim corresponde ao que um jogador chama de "perto";
- dois jogadores clicando ao mesmo tempo na mesma barraca se comportam como o teste de concorrência descreve.

É o mesmo estado de `hit-events`, `espm`, `safe-zones`, da voz nativa e da etiqueta de identidade. `CONSTITUICAO.md` A.1 é explícito: *a pior falha possível aqui não é design ruim — é continuar produzindo documentação excelente de um mundo que não existe.*

Onde isso é resolvido: `FASE_0_ROTEIRO.md`.

### 3.2 A CEF — a lacuna que cresceu

`skymp/ui/index.html` não tem teste automatizado neste projeto, e em 13/08/2026 o bloco de interação dele foi **reescrito inteiro**: `interaction:query`/`interaction:execute` no lugar de `governance:interaction:*`, campos montados a partir do `schema` do servidor, `requestId` gerado no cliente, e a remoção de `ACTION_CONFIG`, `DEFAULT_INTERACTION_SECTIONS`, `mergeInteractionSections` e `sendChatCommand`.

O que foi verificado: `node --check` sobre o `<script>` extraído (sintaxe) e a ausência de referências órfãs por `grep`. **O que não foi verificado é tudo o mais** — nenhuma linha rodou dentro de um CEF. Especificamente sem prova:

- se `browserModal` com `type: 'interaction:actions'` chega e é despachado;
- se a projeção de `field.type` do servidor (`int`, `string`, `enum`, `bool`, `formid`) para inputs produz formulário usável;
- se `crypto.randomUUID` existe no CEF do SkyrimPlatform (há fallback, e ele também nunca rodou);
- se o descarte de resposta com alvo trocado dispara quando deveria.

Esta é hoje a maior superfície não exercitada do framework.

### 3.3 Os resolvedores de alvo que não existem

`npc`, `object`, `container`, `door`, `property`, `world_point`. O que **está** testado é que um pedido contra eles falha fechado, e que um resolvedor registrado por um módulo passa a funcionar sem tocar no core.

### 3.4 As funções de domínio chamadas pelo `execute`

`stopTarget`, `fineTarget`, `arrestTarget`, `buyItem` têm os próprios testes, em `governance-service.test.js` e `market-stalls-*.test.js`. A matriz aqui cobre **até** a chamada — o que está dentro dela é responsabilidade daquelas suítes.

### 3.5 Performance

Nenhuma medição. O §22 do pedido diz para medir antes de otimizar, e nada foi medido — nem o custo de montar um menu com N interações registradas, nem o `describeFields` por consulta, nem a varredura de deduplicação.

O que se sabe de graça: `query` monta o contexto **uma vez por interação candidata**, e não uma vez por menu, porque cada uma tem a própria distância e permissão. Com 10 interações registradas para `player`, uma consulta são 10 resoluções de alvo e até 10 consultas de permissão — e permissão de governança **vai ao banco**. Se a mira gerar consulta contínua, este é o primeiro lugar onde medir.

### 3.6 O caminho antigo — saiu, e os testes dele também

Cinco testes de `governance-service.test.js` foram removidos junto com o código que cobriam. A tabela de equivalência está no comentário que ficou no lugar deles, e o resumo é: tudo que eles travavam continua travado, em `core/interaction-service.test.js` e `core/interaction-registry.test.js`, **com uma diferença que importa** — o `requestId` agora é usado. O teste antigo verificava o formato de um campo que a governança validava e jogava fora; o novo verifica que o duplo clique cobra uma vez só.

---

## 4. Rodando

```bash
npm test
```

```bash
node --test core/interaction-service.test.js
```

```bash
npm run typecheck
```

O typecheck é informativo — o gamemode é JS puro carregado direto pelo SkyMP, sem passo de build. Erros vindos de `node_modules/ws` são ruído conhecido.

---

## 5. O aviso que o CI já carrega

> CI verde significa que não quebrou o que já era verificado, **não que funciona em jogo**.

Vale inteiro aqui, e mais depois de 13/08/2026: o caminho que os jogadores usariam foi **substituído** por outro que nunca rodou. 646 testes passam. Zero jogadores usaram isto.

# Atalhos de teclado para comandos de jogador — auditoria e inventário

Dois pedidos: (1) uma tecla pra abrir o `/painel` (F1 ou F2); (2) varrer os
outros comandos de jogador que hoje só existem como texto e apontar quais
merecem virar atalho. Usa a mesma arquitetura de tecla configurável definida
em [`VOICE_MODE_KEY_AUDIT.md`](VOICE_MODE_KEY_AUDIT.md) §14 (property por
conta, `ctx.sp.on('keyPress', ...)`) — este documento não repete aquela
análise, só a referencia.

## 1. `/painel` — F1 ou F2?

Nenhum dos dois colide com bind nativo conhecido do Skyrim vanilla (que usa
`F5`/`F9` pra quick save/load e `~` pro console — `F1`-`F4` ficam livres por
padrão). A diferença real é fora do jogo:

- **F1** é convencionalmente "ajuda" em quase todo software Windows, e
  overlays de terceiros (algumas versões de Steam, ferramentas de
  acessibilidade, software de captura) historicamente reservam `F1` pra si
  — não é um risco alto, mas é um risco a mais que `F2` não tem.
- **F2** não carrega esse hábito cultural — é a escolha mais neutra.

**Recomendação desta auditoria: `F2`.** Mesma ressalva de sempre: scan code
DirectInput de F2 é `60` (0x3C), nunca validado em jogo neste projeto —
mesma classe de suposição do `18` (E) e do `15` (Tab).

**Implementado (2026-08-22)**: `core/player-shortcuts-service.js` (lab,
`ENABLE_PLAYER_SHORTCUTS`) — não entrou na property configurável por conta
desenhada pro Tab (essa parte ainda não foi construída, ver
`VOICE_MODE_KEY_AUDIT.md` §14: ficou documentada, não implementada nesta
rodada); por ora `F2` é fixo, mesmo padrão de tick+guarda que
`interaction-prompt-service.js` já prova. `sendUiEvent('panel:open', {})`
na CEF reusa o MESMO canal que qualquer clique de UI já usa — nenhum
caminho novo servidor↔cliente. 1082 testes do gamemode passam, incluindo
os 7 novos deste módulo. Não validado em jogo.

## 2. Inventário — todo comando de jogador (não-staff/gov/guarda/fiscal)

Levantado direto do código (`commandDefs()`/`commandRegistry.register` de
cada serviço), não de memória. `[Staff]`/`[Gov]`/`[Guarda]`/`[Fiscal]` foram
excluídos — são ferramentas de papel/cargo, não UX geral de jogador.

| Comando | Args | Já tem caminho melhor? |
|---|---|---|
| `/painel` | nenhum | Resolvido nesta seção — F2 |
| `/apresentar` | `<actorId>` | **Sim** — já `hidden: true`, redundante com `identity.introduce` no menu `[E]` (Tarefa 11) |
| `/apelido` | `<actorId> <nome>` | Não — texto livre (nome) |
| `/socorrer` | `<actorId>` | Não, mas deveria — alvo por proximidade, sem texto; candidato natural ao menu `[E]` (ver §3) |
| `/iniciar` | `<actorId> <motivo>` | Não — texto livre (motivo), e é registro formal de evidência, não ação casual |
| `/tempo` | nenhum | Informacional puro — candidato a HUD passivo, não tecla |
| `/ondestou` | nenhum | Debug/spike (`fauna-census.js`), não é feature de jogador comum |
| `/receitas` | `<estacao>` | Provavelmente já coberto pelo menu `[E]` na estação (a confirmar) |
| `/craft` | `<recipeId> [estacao] [dedicatoria...]` | Não — texto livre (dedicatória) |
| `/alma` | nenhum | Sem args, informacional — candidato a virar aba do `/painel` (§3) |
| `/profissoes` | nenhum | Sem args, informacional — candidato a virar aba do `/painel` (§3) |
| `/trade` | `<actorId>` | **Correção (22/08, ver PLAYER_ACTION_SHORTCUTS_PLAN.md §0): já está no menu `[E]`** — `trade.request` em `trade-service.js:486`. A entrada anterior desta tabela estava errada. |
| `/tradeaccept` | nenhum | **Correção (22/08)**: o botão "Fechar" da overlay chama `mp.trigger('cef::trade:cancel', {})`, e **nada no servidor escuta `cef::trade:cancel`** — confirmado por grep, zero ocorrências fora de `index.html`. O botão só esconde a `div` na tela; não cancela nada de verdade. Os três (`aceitar`/`confirmar`/`cancelar`) dependem 100% do texto hoje. Ver plano em `PLAYER_ACTION_SHORTCUTS_PLAN.md` Fase 1. |
| `/tradeconfirm` | nenhum | Mesmo caso |
| `/tradecancel` | nenhum | Mesmo caso — inclusive o botão que parecia cobrir isso |
| `/tradeadd` | `<baseId> <qtd>` | Não — entrada numérica/id, é formulário |
| `/voz` | nenhum | Entrada única pro sistema de voz — fora de escopo aqui, já coberto por `VOICE_MODE_KEY_AUDIT.md` |
| `/stallplace` | `<nome>` | Não — texto livre |
| `/stallpack` | `<stallId>` | Alvo é a própria barraca ativa do jogador — candidato ao menu `[E]` perto dela |
| `/stalladd` | `<stallId> <baseId> <count> <price> <rotulo>` | Não — formulário completo |
| `/stallremove` | `<itemId>` | Alvo por proximidade/seleção — candidato ao menu `[E]` |
| `/stalls` | nenhum | Listagem — candidato a painel/UI, não tecla |
| `/stallitems` | `<stallId>` | Listagem de uma barraca — idem |
| `/stallbuy` | `<stallId> <itemId> <count>` | **Correção (22/08): já está no menu `[E]`** — `stall.view`/`stall.buy` em `market-stalls-service.js:1323-1339`. |
| `/searchaccept` | `<id>` | Sem texto — resposta binária a um pedido já recebido; forte candidato a UI de notificação com dois botões (aceitar/recusar), não tecla global |
| `/searchdeny` | `<id>` | Mesmo caso, par do anterior |
| `/depot` | nenhum | **Já documentado** em `UI_UX_INTERACTION_AUDIT.md` §9 — vira `hidden: true` assim que o provider de âncora física for registrado; o prompt `[E]` já cobre |
| `say`/`/me`/`/do`/`/ooc`/`/b`/`/s`/`/sussurrar`/`/g`/`/gritar` | texto livre | **Não** — são o próprio conteúdo da fala/ação IC, atalho não se aplica |
| `/roll`, `/try` | args de mecânica | Não — parâmetros variam por uso, não é um "ligar/desligar" |
| `/report` | texto livre | Não — descrição do problema é o ponto do comando |
| `/rphelp`, `/ajuda` | nenhum | Informacional; possível tecla de "ajuda" no futuro, mas sem urgência |

## 3. Recomendações agrupadas

**A — já resolvido, só falta constatar:** `/apresentar` (hidden) e `/depot`
(hidden pendente de integração, nota já registrada). Nenhuma ação nova
aqui.

**B — não merecem tecla própria; deveriam virar aba do `/painel`.**
`/profissoes` e `/alma` são leitura pura, sem alvo — exatamente o padrão
que `player-panel-service.js` já resolve (`status`/`governance`/`economy`/
`social`). Abrir uma tecla NOVA pra cada um infla o teclado sem necessidade
(o `[E]`, o `Tab` de voz e o `F2` do painel já são três teclas novas nesta
rodada) — a rota certa é adicionar abas `Profissões` e `Alma` ao painel que
o `F2` já abre, igual à ponte `SELF` que a Tarefa 11 já fez pra evitar UI
duplicada.

**C — candidatos reais ao menu de interação `[E]` contextual**, todos
já compartilham a mesma forma (alvo por proximidade, sem texto livre):
`/socorrer`, `/trade`, `/stallpack`, `/stallremove`. Isso é extensão
direta do padrão que a Tarefa 11 já validou pra Depot — não pede
arquitetura nova, só mais entradas no `physical-anchor-registry`/ação de
ator.

**D — ficam como comando de texto, sem alternativa melhor**: qualquer
coisa com texto livre real como argumento (`/apelido`, `/iniciar`,
`/craft` com dedicatória, `/stallplace`, `/stalladd`, e todo o chat IC).
Reduzir "digite o nome/motivo/preço" a uma tecla não existe — o teclado
*é* o formulário.

**E — achado fora do pedido original, vale um PR pequeno e separado**: o
`trade-overlay` já tem botão pra recusar mas não pra aceitar/confirmar —
inconsistência de UX que não precisa esperar nenhuma decisão de produto,
só replicar o padrão que `closeTrade()`/`cef::trade:cancel` já prova
(`acceptTrade()`/`cef::trade:accept`, `confirmTrade()`/
`cef::trade:confirm`).

**F — `/searchaccept`/`/searchdeny`**: mais que atalho de teclado, esse
par pede uma notificação com dois botões quando o pedido de revista chega
(o mesmo tipo de UI que faltaria pro convite de troca, se um dia o
convite de `/trade` também passasse a chegar como notificação em vez de
exigir que o alvo já saiba o comando). Fora do escopo desta rodada
(voz + `/painel`), registrado pra não se perder.

## 4. O que fica de fora deste documento

Comandos `[Staff]`/`[Gov]`/`[Guarda]`/`[Fiscal]` (governança, moderação,
fiscalização de barraca) não entram — são ferramentas de papel exercido
por poucas pessoas, não a UX geral que os pedidos desta conversa miravam.
Se algum dia isso mudar, é uma auditoria própria, com seus próprios riscos
de abuso de tecla (diferente de jogador comum: uma tecla de guarda
disparada por engano tem impacto de RP real).

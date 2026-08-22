# Controle de voz por teclado (modo + mute) — auditoria (§15 da Constituição)

Pedido: teclas de ação para trocar entre modos de voz (sussurro/normal/grito)
e um indicador de UI mostrando o estágio atual. Antes de decidir a forma,
esta auditoria confere o que já existe contra o que o pedido presume — mesma
disciplina do `UI_UX_INTERACTION_AUDIT.md` (Tarefa 11).

## 0. Achados que mudam o brief original

Quatro coisas que valia checar contra o código antes de desenhar qualquer
tecla nova:

- **O backend de modo de voz já existe e já é usado.** `voip-service.js`
  aceita `{ type: 'voice_mode', mode }` desde a introdução do relay,
  `VOICE_RANGES` (`core/proximity-ranges.js`) já define `whisper`/`normal`/
  `shout` com os MESMOS raios do chat de texto (`/s`, `/g`), e
  `tickProximity()` já lê `peer.entry.voiceMode` pra calcular o alcance de
  cada locutor (`voip-service.js:494`). Não é preciso inventar um raio novo
  nem um formato de mensagem novo — só um emissor real do lado do cliente.
- **O cliente já tem a função, mas ela é código morto.** `index.html` tem
  `setVoiceMode(mode)` (linha 1051) e um listener
  `mp.events.add('voip:setMode', ...)` (linha 1402) — mas **nada no
  gamemode jamais dispara esse evento**. Confirmado por grep: zero
  ocorrências de `voip:setMode` ou `voip:mute` fora de `index.html`. O
  mesmo vale pro mute: `toggleMute()` só é chamado pelo listener morto
  `voip:mute`. **Hoje, literalmente ninguém consegue mutar o próprio
  microfone ou trocar de modo de voz neste projeto.** Isso é maior que o
  pedido original — o pedido foi "tecla pra trocar modo", o achado é "não
  existe NENHUM caminho pra isso, nem tecla nem botão nem comando".
- **Não existe validação do valor de `mode` no servidor.** O handler de
  `voice_mode` (`voip-service.js:336`) aceita qualquer string e grava direto
  em `voipClients.get(actorId).voiceMode`. Um `mode` fora de
  `whisper|normal|shout` faz `VOICE_RANGES[mode]` valer `undefined`, e
  `calcVolume(dist, undefined)` devolve `NaN` — não é amplificação (o pior
  caso é `if (volume > 0)` recusar `NaN`, e o locutor fica silencioso pra
  todo mundo), mas é um estado inconsistente e não teria log nenhum hoje.
  Como este trabalho já vai tocar esse handler, faz sentido fechar isso no
  mesmo PR (allowlist de 3 valores).
- **Não existe nenhuma tecla de voz hoje, nem PTT.** A única tecla
  registrada via `ctx.sp.on('keyPress', ...)` no projeto inteiro é o `[E]`
  de interação (Tarefa 11, scan code 18) — documentado como **nunca
  validado em jogo**. Não há precedente funcionando de keybind neste
  projeto, só um precedente escrito.

## 1. Objetivo

Dar ao jogador dois controles imediatos sobre a própria voz — ciclar
sussurro/normal/grito e mutar/desmutar — por tecla, sem abrir menu, com um
indicador sempre visível de qual dos três modos está ativo e se o
microfone está mudo.

## 2. Problema que resolve

Dois, não um: (a) o pedido original — hoje falar baixo ou gritar por voz
não tem controle nenhum, só o modo `normal` implícito do `_entryFor()`; (b)
um problema mais grave que a auditoria descobriu — **não existe mute**.
Qualquer chat de voz multiplayer sem mute é uma lacuna básica, não um
detalhe de imersão.

## 3. Problemas que cria

- **Herda a mesma incerteza do `[E]`.** `ctx.sp.on('keyPress', ...)` nunca
  rodou contra um servidor SkyMP real neste projeto. Se o nome do evento ou
  o scan code estiverem errados, o sintoma é silencioso: o indicador nunca
  muda e ninguém sabe por quê. Isso já aconteceu de documentação — o prompt
  `[E]` está escrito e testado em navegador comum há [tempo], nunca em
  jogo.
- **Duas teclas novas competem por scan codes com o `[E]` e entre si.**
  Precisa decidir os três binds (ciclar modo, mutar, e se "ciclar" for uma
  tecla só, a direção é ambígua — ver §13).
- **Indicador persistente é mais permanente que o prompt `[E]`.** O prompt
  `[E]` só aparece quando há algo pra fazer; um indicador de "modo de voz +
  mute" ficaria na tela o tempo todo enquanto a voz estiver conectada — mal
  posicionado, vira poluição visual constante, não ocasional.
- **Allowlist de `mode` é uma mudança de comportamento, não só uma
  correção.** Um `mode` desconhecido hoje resulta em silêncio (§0); depois
  da allowlist, resulta em rejeição da mensagem — melhor, mas é uma
  mudança de contrato que vale registrar no commit.

## 4. Exploits

- **Nenhum novo em cima do que já existe.** O servidor já é quem decide
  alcance e volume a partir de `voiceMode`; o cliente só sugere, igual ao
  padrão já fechado pro prompt `[E]` (`peek`/`query` sempre revalidam). Uma
  tecla fabricada que manda `voice_mode`/`mute` direto no socket não ganha
  nada que `setVoiceMode()`/`toggleMute()` já não permitissem via console —
  o "furo" já existe hoje, atrás de uma função que nada chama.
- **Allowlist fecha o único item real** (§0, `mode` arbitrário → `NaN`).
  Baixa severidade (o pior efeito é a própria pessoa ficar inaudível), mas
  fica sem log e sem causa aparente até esta auditoria.
- **Sem rate limit no `voice_mode`/`mute` em si** — só `audio_frame` tem
  token bucket. Trocar de modo 1000x/s é barato (`Map.set`, sem I/O), então
  não abre um vetor de custo novo; registrado, não é bloqueador.
- **Mute mentiroso é um risco do transporte, não desta tarefa.** Um helper
  nativo modificado poderia ignorar o próprio `muted` e continuar mandando
  `audio_frame` mesmo com a UI mostrando mudo — mas isso já é verdade hoje
  (o `_entryFor` já teria esse campo), e esta tarefa não muda a superfície
  de confiança do helper. Fora de escopo, citado por completude.

## 5. Impacto econômico

Nenhum — não move ouro nem item.

## 6. Impacto político / militar / religioso

Pequeno mas real: sussurro e grito por voz têm uso direto em cenas de
facção (ordem de combate, conspiração em voz baixa) — o equivalente em
texto (`/s`, `/g`) já é usado assim. Nenhuma ação nova de staff/guarda.

## 7. Impacto social

Alto. Mutar o próprio microfone é o controle mais básico que falta num chat
de voz multiplayer — sem ele, qualquer ruído de fundo de um jogador
conectado é permanente até ele fechar a UI inteira ou sair de alcance de
todos. Resolver isso pesa mais no §15 do que a parte de sussurro/grito.

## 8. Impacto narrativo

Fecha uma assimetria: o texto já distingue sussurro/fala/grito
(`rp-chat-service.js`); a voz, que é o canal mais "presente" em cena, não
distinguia nada até agora.

## 9. Impacto técnico

- `voip-service.js`: allowlist de `mode` no handler `voice_mode` (§0);
  nenhuma mudança em `VOICE_RANGES`/`tickProximity` — já leem
  `entry.voiceMode` corretamente.
- `index.html`: `setVoiceMode`/`toggleMute` já existem — só precisam de um
  chamador real. Novo: indicador de HUD (modo + mute), no mesmo espírito
  visual do `#voip-status` que já existe (pílula pequena, fora do centro).
- Gamemode: um módulo novo (ou extensão do próprio `voip-service.js`) que
  registra `ctx.sp.on('keyPress', ...)` no client-side snippet — mesmo
  padrão de `interaction-prompt-service.js` (guarda em `ctx.state`, uma
  vez só). `voip` já é módulo `lab` sob `ENABLE_VOIP_SERVICE`
  (`phase0-basic.js:368`) — a tecla entra na mesma flag, não numa nova.
- **Fallback de comando de texto**, seguindo o precedente explícito do
  prompt `[E]` (§12 do audit da Tarefa 11: "comandos legados continuam
  funcionando"): `/mutar` e `/modovoz <sussurro|normal|grito>` como
  caminho que não depende de `keyPress` nunca ter sido validado. Diferença
  do padrão de `hidden`: aqui não há comando legado pra esconder — é um
  comando NOVO que nasce como o caminho comprovado, enquanto a tecla é o
  caminho não comprovado. Se a tecla falhar em jogo, o jogador não fica
  sem alternativa nenhuma.

## 10. Como gera histórias / como é abusado / como balancear

- **Gera histórias**: sussurro perto de um NPC/jogador específico, grito
  por socorro à distância — os mesmos usos já validados no chat de texto,
  agora disponíveis por voz de verdade.
- **Como é abusado**: nada além do que a ausência de mute já permite hoje
  (§7) — esta tarefa reduz abuso (dá controle), não cria um novo.
- **Como balancear**: nenhum parâmetro novo — os raios já são os do chat
  de texto, decisão de design já tomada em `proximity-ranges.js`.

## 11. Como integra ao mundo

Fica dentro do módulo `lab` `voip`, mesma flag `ENABLE_VOIP_SERVICE` — não
é uma feature nova precisando de flag própria, é o mesmo sistema de voz
ganhando os controles que sempre deveria ter tido. Sem dependência nova no
`module-registry`.

## 12. Confirmado por teste vs. não confirmado (antes de escrever código)

Confirmado por leitura de código (não por teste, ainda — nada foi
implementado):
- `VOICE_RANGES`, `tickProximity`, e o handler `voice_mode` já existem e
  já leem `entry.voiceMode` corretamente (`voip-service.js`).
- `setVoiceMode`/`toggleMute` existem no cliente e estão prontos pra
  receber um chamador real (`index.html:1042`, `:1051`).
- `voip:mute` e `voip:setMode` são 100% código morto — zero ocorrências no
  gamemode (grep, não suposição).
- `voice_mode` não valida `mode` — qualquer string passa; `NaN` é o
  resultado observável na conta de volume, verificado lendo `calcVolume`.

Não confirmado, mesma ressalva de toda a família de labs deste projeto:
- `ctx.sp.on('keyPress', ...)` funcionando em jogo real (herdado do
  prompt `[E]`, nunca fechado).
- Qual scan code fica livre pra "ciclar modo" e "mutar" sem colidir com
  binds nativos do Skyrim ou com o `[E]` — precisa decisão de produto
  antes de escolher um número, não uma suposição de engenharia.

## 13. Decisões — todas fechadas, implementação já entrou

1. **Ciclar com 1 tecla, decidido "o que for melhor pra experiência do
   jogador e acesso".** 1 tecla (mais simples de lembrar) venceu; `Tab`
   cicla `whisper→normal→shout→whisper...` em `handleVoiceCycleKey`
   (`index.html`) — a decisão de "qual é o próximo modo" mora na CEF, que
   já guarda `state.voiceMode`; o sandbox do Skyrim Platform só repassa a
   tecla apertada (`voip-service.js` `VOICE_CONTROL_KEYS_SNIPPET`).
2. **Teclas: `Tab` (scan 15) cicla modo; `M` (scan 50) muta/desmuta** —
   mesma ressalva de sempre (§0/§14): leitura de tabela DirectInput, não
   teste em jogo.
3. **Indicador fica sempre visível enquanto a voz está conectada** — não
   é notificação temporária. Decisão de acessibilidade: alguém que
   precise conferir visualmente se está mudo não pode depender de um
   toast que já sumiu. `#voice-mode-indicator` em `index.html`, mesma
   família visual do `#voip-status` já existente (pílula pequena, fora
   do centro de mira), abaixo dele — cor muda por modo, borda vermelha
   quando mudo.
4. **`/modovoz` e `/mutar` entraram junto com a tecla, no mesmo PR** —
   mesmo motivo do `[E]` ter mantido comandos antigos vivos. Limitação
   documentada no próprio código (`voip-service.js`,
   `VOICE_MODE_ALIASES`): o fallback de texto muda o estado que
   `tickProximity` usa pra decidir quem ouve quem (efeito real, igual à
   tecla), mas não sincroniza `state.voiceMode`/`state.muted` nem o
   indicador na CEF — não existe hoje canal servidor→CEF pra "estado
   corrente", só o handoff de conexão (`voipTicket`). Aceito como
   limitação conhecida, não escondida.

**Implementado** (2026-08-22): allowlist de `mode` em `voip-service.js`
(`VOICE_MODE_VALUES`), snippet de teclas (`VOICE_CONTROL_KEYS_SNIPPET`,
anexado ao `updateOwner` de `voipTicket` em `phase0-basic.js`),
indicador + handlers em `index.html`, comandos `/modovoz`/`/mutar`. 1082
testes do gamemode passam, incluindo os novos (allowlist via WebSocket
real, `/modovoz`/`/mutar` unitários). **Não validado em jogo** — mesma
ressalva de toda a família de labs deste projeto; o que foi verificado
foi lógica de servidor (testes automatizados) e o comportamento da CEF
num navegador comum (ciclar modo, mutar, indicador atualizando),
não dentro do Skyrim/SkyMP real.

## 14. Tecla configurável — onde ela mora (adendo, pedido do dono do produto)

O pedido foi "a tecla pode ser `Tab`, com opção de o jogador trocar, no
launcher ou em algum menu in-game — o que for melhor". A auditoria técnica
dessa escolha:

- **Por que não o launcher (Electron).** `apps/launcher` (ver
  `LAUNCHER_DISTRIBUTION.md`) hoje só cuida de distribuição de mods, fila
  de conexão e OAuth do Discord — não existe tela de configuração
  nenhuma, e mais importante: **o processo do launcher e o processo do
  jogo (Skyrim + Skyrim Platform) são coisas separadas.** Uma preferência
  salva no launcher precisaria de um mecanismo de handoff pra chegar até
  `ctx.sp.on('keyPress', ...)` — que roda dentro do sandbox do Skyrim
  Platform, não dentro do Electron nem dentro da CEF do jogo. Esse
  mecanismo não existe hoje e seria infraestrutura nova só pra isto.
- **Por que o painel do jogador (`/painel`, CEF) é o caminho que já
  existe.** `player-panel.js` já tem abas extensíveis
  (`status`/`governance`/`economy`/`social`, ver `switchTab`/`renderTab`
  em `skymp/ui/player-panel.js:80-97`) — uma aba **Configurações** nova
  segue exatamente o padrão que a Tarefa 11 já preferiu (reaproveitar em
  vez de duplicar UI, ver `UI_UX_INTERACTION_AUDIT.md` §0). É CEF, é o
  mesmo `sendUiEvent` que as outras abas já usam pra falar com o
  servidor.
- **O problema real, em qualquer um dos dois: onde a preferência mora
  fisicamente.** `ctx.sp.on('keyPress', ...)` roda no sandbox do Skyrim
  Platform, que **não é** o mesmo runtime da CEF (que teria
  `localStorage`) nem do launcher. Nenhum dos três hoje troca dado com os
  outros dois por preferência de jogador — só existe o caminho já
  comprovado nesta família de labs: servidor → property SkyMP (mesmo
  padrão de `browserModal`/`panelData`/`voipTicket`/`interactionPrompt`)
  → `ctx.state` no sandbox. Ou seja, salvar a tecla escolhida **não pode
  ficar só no navegador nem só no launcher** — precisa ida ao servidor
  (persistida por conta/personagem) pra voltar como property que o
  sandbox lê.
- **Decisão recomendada por esta auditoria**: aba **Configurações** no
  `/painel` existente → `sendUiEvent('panel:save:keybind', {action:
  'voiceMode', key: <scanCode>})` → servidor persiste (nova coluna/tabela
  pequena, por personagem — ainda a decidir se por conta ou por
  personagem) → servidor reenvia via property (mesmo mecanismo de
  `interactionPrompt`) → o snippet do sandbox compara `key` recebido em
  vez do `18`/`15` fixo. Fica de fora do launcher inteiramente — zero
  infraestrutura nova de handoff entre processos, só estende um padrão já
  testado.
- **Decidido pelo dono do produto: por conta, não por personagem.**
  `accounts.id` já é a identidade canônica em modo online
  (`ADR_001_ONLINE_PROFILE_ID_IS_ACCOUNT_ID.md`), e keybind é preferência
  de teclado da pessoa, não traço de personagem — ninguém deveria
  reconfigurar a tecla a cada personagem novo. A property que o servidor
  reenvia pro sandbox (§14) é resolvida no login a partir de
  `accounts.id`, antes mesmo de qualquer personagem estar carregado —
  mesmo momento em que outras coisas ligadas à conta (ex.: `vip_level`
  citado no ADR-001) já são lidas.
- **Ainda em aberto**: se vale a pena um segundo campo pra tecla de mutar
  já no mesmo formulário da aba Configurações, já que o Tab resolve só o
  ciclo de modo.

Com essas respostas, a implementação é mecânica: allowlist de `mode`,
chamador real de `setVoiceMode`/`toggleMute` a partir de `keyPress` (lendo
o scan code configurável, com `18`/`15` como default), indicador de HUD no
`index.html`, aba Configurações no `player-panel.js`, e os dois comandos
de texto em `commandDefs()`.

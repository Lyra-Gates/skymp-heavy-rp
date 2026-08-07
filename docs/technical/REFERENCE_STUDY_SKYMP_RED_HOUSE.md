# Estudo de Referencias - SkyMP, Keizaal e Red House

## 1. Fontes Estudadas

- Organizacao `skyrim-roleplay`: fork/organizacao ligada ao Keizaal Online.
- Repositorio `skyrim-roleplay/skymp`: fork atual do SkyMP usado como referencia de core.
- Repositorio `skyrim-roleplay/launcher`: publico, mas no momento contem apenas README minimo.
- Repositorio `alekcey0211/red-house-public`: build publica antiga do Red House, baseada em SkyMP.
- Pagina Nexus `Red House - Public Server Build (SkyMP)`: descricao publica, imagens e pacote historico.

## 2. Conclusao Geral

As referencias ajudam bastante, mas de formas diferentes:

- O fork atual do SkyMP ajuda a definir arquitetura, configuracao, portas, scripting, persistencia nativa e licenca.
- O Red House ajuda como estudo pratico de servidor RP antigo: estrutura de pastas, UI in-game, chat por proximidade, comandos, opcoes de servidor, spawn e pipeline de build.
- O launcher publico da organizacao `skyrim-roleplay` ainda nao serve como base tecnica, porque o repositorio publico contem pouco conteudo.

Para o nosso servidor Heavy RP, a melhor decisao e usar essas referencias como mapa, nao como copia direta. Red House e antigo e tem escolhas inseguras para producao publica, especialmente admin por senha e comandos perigosos expostos.

## 3. Achados do SkyMP Atual

### Configuracao

O servidor usa `server-settings.json` como fonte principal. A documentacao atual indica que CLI antiga nao e mais suportada para configuracao.

Campos importantes para o nosso plano:

- `name`: nome publicado.
- `masterKey`: chave usada com a Master API; cliente deve usar a mesma chave.
- `listenHost`: bind do trafego UDP principal.
- `uiListenHost`: bind do servidor HTTP/HTTPS usado pela UI.
- `port`: porta principal, normalmente UDP.
- `maxPlayers`: limite divulgado e aplicado.
- `dataDir`: pasta exposta para dados, UI e manifestos.
- `loadOrder`: ordem de `.esm` e `.esp`.
- `archives`: BSAs usados, especialmente para scripts Papyrus.
- `lang` e `locale`: idioma/localizacao.
- `offlineMode`: modo que permite cliente escolher profile id; nao deve ser usado em producao publica.
- `databaseDriver`: driver nativo do estado de mundo.
- `reloot` e `forbiddenReloot`: controle de reset de objetos.
- `gamemodePath`: caminho do gamemode.
- `startPoints`: pontos iniciais de spawn.
- `isPapyrusHotReloadEnabled`: util em desenvolvimento, perigoso em producao.

### Portas

O SkyMP usa mais de uma porta:

- Porta principal UDP, padrao `7777`.
- Porta de UI, padrao `3000` ou `port + 1` quando a porta principal muda.
- Webpack dev server em `1234` para desenvolvimento de UI.
- Chromium DevTools local em `9000` no cliente.

Impacto para o plano:

- A Fase 0 deve incluir teste de portas e firewall.
- Producao deve bloquear DevTools e dev server.
- Documentacao de infraestrutura precisa listar portas por ambiente.

### Persistencia

O SkyMP tem persistencia nativa de mundo e jogadores. Drivers vistos:

- `file`: padrao, salva em diretorio local.
- `zip`: salva em arquivo zip.
- `mongodb`: recomendado pela documentacao para servidores reais na internet.
- `migration`: migra de um driver para outro.

Impacto para o plano:

- PostgreSQL continua bom para whitelist, painel, staff, logs externos e economia web.
- O estado nativo do mundo SkyMP deve ser tratado separadamente.
- Precisamos decidir se o servidor usa MongoDB para estado SkyMP e PostgreSQL para plataforma RP, ou se simplificamos no MVP.

### Scripting

O servidor expoe o global `mp`.

Recursos importantes:

- `mp.makeProperty`: cria propriedades persistentes em atores e referencias.
- `mp.makeEventSource`: cria eventos customizados capturados do cliente.
- `mp.get` e `mp.set`: leem e alteram propriedades.
- Propriedades built-in modificaveis: `pos`, `angle`, `worldOrCellDesc`, `inventory`, `appearance`, `isOpen`, `isDisabled`.
- Propriedades readonly: `type`, `baseDesc`, `formDesc`, `equipment`, `isOnline`, `neighbors`.

Impacto para Heavy RP:

- Ferimentos, status de personagem, jail, flags de RP e estados visiveis podem ser modelados como propriedades.
- Eventos customizados podem capturar morte, interacoes e gatilhos de UI.
- Inventario e posicao precisam de regras server-side, porque sao superficies criticas de exploit.

### Licenca

SkyMP e distribuido principalmente sob GPLv3/AGPLv3. Mudancas distribuidas no software devem ter fonte disponibilizada conforme a licenca aplicavel.

Impacto:

- Qualquer fork/modificacao distribuida precisa de politica de codigo-fonte.
- O plano publico deve incluir aviso de nao afiliacao com Bethesda/ZeniMax.

## 4. Achados do Red House Public

### Estrutura

Pastas principais encontradas:

- `client`: client TypeScript.
- `front`: UI web/in-game.
- `server`: build pronta do servidor.
- `server-build`: codigo TypeScript do servidor.
- `modules`: sistema modular de scripts.
- `functions-lib`: biblioteca compartilhada de funcoes.
- `compiler`: Papyrus compiler e scripts.
- `parse-localization`: extracao/conversao de strings.
- `xelib`: tooling para ESP/localizacao.
- `docs`: admin, comandos, config e options.

Impacto:

- Nosso monorepo deve manter separacao clara entre `skymp/server`, `skymp/gamemode`, `apps/web`, `apps/launcher`, `packages/shared`, `packages/database` e `docs`.
- UI in-game deve ser tratada como app proprio, nao misturada com painel web da staff.

### Setup de Servidor

README do Red House orienta:

- Renomear `server-settings.example.json` para `server-settings.json`.
- Copiar `Skyrim.esm`, `Update.esm`, `Dawnguard.esm`, `HearthFires.esm`, `Dragonborn.esm` para o `data` do servidor.
- Extrair `scripts.zip` para `server/data/scripts`.
- Rodar `npm run server:start` ou `npm start` dentro de `server`.

Impacto:

- Nosso plano precisa ter checklist de arquivos oficiais do Skyrim.
- Scripts Papyrus e assets de UI devem ser versionados/empacotados com cuidado.

### Server Settings

Exemplo do Red House:

- `dataDir`: `data`.
- `loadOrder`: masters vanilla/DLC.
- `ip`: `127.0.0.1`.
- `port`: `10000`.
- `name`: nome do servidor.
- `maxPlayers`: `100`.
- `gamemodePath`: `gamemode.js`.
- `databaseDriver`: `file`.
- `locale`: `ru-RU`.
- `stringsPath`: `strings`.
- `isPapyrusHotReloadEnabled`: `true`.
- `isServerOptionsHotReloadEnabled`: `false`.
- `startPoints`: array de posicao/celula/angulo.

Impacto:

- Para producao, hot reload deve ser desligado.
- `startPoints` precisa virar politica de spawn inicial Heavy RP.
- `stringsPath` e localizacao importam se o servidor for portugues.

### Server Options

Red House adiciona `server-options.json` com:

- Nome exibido in-game.
- Debug Papyrus.
- Toggle de spawn vanilla.
- Tempos de respawn de jogador e NPC.
- Overrides de respawn por actor id.
- Multiplicadores de dano/stamina.
- Keybindings.
- Comandos bindados em teclas.
- Itens iniciais.
- `adminPassword`.

Impacto:

- Precisamos de um `server-options` nosso, mas com schema validado, sem senha admin simples e sem comandos perigosos por keybind em producao.
- Itens iniciais devem ser controlados por whitelist/personagem, nao por lista geral irrestrita.
- Respawn de NPC e vanilla spawn sao decisoes de design Heavy RP.

### Chat e UI

O Red House implementa chat via WebSocket e filtra mensagem por distancia e celula. No codigo lido:

- Token do browser e associado ao userId.
- Mensagens de chat sao enviadas para jogadores proximos.
- Existe canal non-RP com texto envolvido por `(( ... ))`.
- Distancia e celula determinam quem recebe chat IC.

Impacto:

- Chat local por proximidade e uma prioridade valida de MVP.
- Precisamos separar canais: IC local, sussurro, grito, OOC, staff, reports.
- O canal OOC deve ter rate limit e logs.

### Login e Spawn

O sistema Red House:

- Valida sessao via master server quando nao esta em modo local.
- Em modo local cria id fake para teste.
- Emite `spawnAllowed`.
- Reusa ator por profile id quando existe.
- Cria novo ator em `startPoints` e abre race menu quando nao existe.
- Desabilita ator no disconnect.

Impacto:

- Nosso fluxo deve ser: login -> identidade externa -> whitelist -> personagem aprovado -> spawn.
- Race menu nao deve ser liberado sem personagem aprovado em Heavy RP.
- Disconnect precisa preservar estado sem permitir abuso em combate.

### Comandos Admin

Red House documenta comandos como:

- `/adminlogin`.
- `/online`.
- `/anim`.
- `/addperk`.
- `/coc`.
- `/race`.
- `/additem`.
- `/kill`.
- `/killall`.
- `/killnpc`.
- `/thrownpc`.
- `/placeatme`.
- `/delete`.
- `/speedmult`.
- `/weaponspeedmult`.

Impacto:

- Esses comandos sao uteis em staging e eventos supervisionados.
- Em producao devem exigir permissoes por cargo, motivo obrigatorio e audit log.
- Comandos destrutivos devem ter confirmacao ou serem bloqueados fora de ambiente staff.

## 4.1 Leitura do código-fonte (06/08/2026)

A análise anterior (seção 4) olhou estrutura, config e comandos. Esta é a leitura do **código** de `alekcey0211/red-house-public` — especificamente `functions-lib/src/`, que é onde vive a lógica de jogo.

O repositório está parado desde 16/11/2021 e é baseado num SkyMP daquela época, então nada aqui deve ser tratado como API atual. O valor é de **projeto**: eles resolveram problemas que ainda estão abertos pra nós.

### O que a página do Nexus acrescenta

A build publicada (v1.1-pub, 11/07/2021, 23 endorsements, 358 downloads únicos) declara conter: sincronização de morte, **sincronização de dano**, chat de texto + comandos, infobar, **janela de troca**, menu de interação com jogador, animações, select box, request panel e HUD (logo, ID do jogador, contador de online). **Todas as interfaces em russo.**

Os autores convidam explicitamente ao reuso — *"You can take it as a basis for your development!"* — mas na mesma frase declaram: *"The server sources are distributed under the GPLv3 license."* O convite não dispensa a licença.

### ⚖️ Licença: GPL-3.0 — dá pra aproveitar código, com atribuição

O repositório é **GPL-3.0**, confirmado tanto pelo arquivo `LICENSE` quanto pela própria página do Nexus.

> **Correção de 06/08/2026.** Este parágrafo dizia "não dá pra copiar código" e que copiar "obrigaria a licenciar o nosso projeto sob GPL também". **As duas afirmações estavam erradas**, e a política do próprio projeto já dizia o contrário — ver [`LICENSE_AND_AFFILIATION_POLICY.md`](LICENSE_AND_AFFILIATION_POLICY.md) §4.
>
> Nosso projeto já é `AGPL-3.0-or-later`. A GPLv3 §13 permite explicitamente combinar obra coberta por ela com obra sob AGPLv3, e a AGPLv3 §13 é recíproca. Não há para onde "regredir": já estamos numa licença compatível e mais forte.
>
> O erro tinha custo real — ele empurrava para reescrever do zero coisas que dava para portar, o que é justamente o tempo que este estudo existe para economizar.

O que a licença **exige** ao trazer código de lá, conforme a §4 da política:

- **Registrar a origem** no cabeçalho do arquivo e no changelog: projeto, autor, licença, commit.
- **Manter os avisos de copyright** originais.
- O arquivo resultante fica sob GPL-3.0; o conjunto continua distribuído sob AGPL.

O que continua valendo: técnica e arquitetura não são protegidas por direito autoral, então **descrever** o que eles fazem — como faz o resto desta seção — não depende de licença nenhuma. E no caso do evento de hit a forma é praticamente ditada pela API do Skyrim Platform de qualquer jeito, então escrever do zero costuma ser mais rápido que atribuir.

A decisão passa a ser caso a caso, de engenharia e não de licença: portar com atribuição quando o código é substancial e testado; escrever do zero quando a API já dita a forma.

### O evento de hit existe, e eles o implementaram

O achado mais direto. `functions-lib/src/events/_onHit.ts` registra:

```
mp.makeEventSource('_onHit', <snippet de cliente>)
mp._onHit = (pcFormId, event) => { ... }
```

O snippet de cliente escuta `ctx.sp.on('hit', ...)` do Skyrim Platform e manda pro servidor `{ target, agressor, isPowerAttack, isSneakAttack, isBashAttack, isHitBlocked }`.

Isso confirma o que `SKYMP_UPSTREAM_REFERENCE.md` §2 dizia como teoria: **`makeEventSource` é o caminho para o evento de hit**. O `docs_onhit_and_damage.md` do SkyMP descreve o pacote no C++ e a issue #1338 recusou expor ao gamemode — mas dá pra reconstruir do lado do cliente, e alguém já fez.

Dois detalhes que economizariam horas de depuração:

- **`0x14` é o jogador local.** O cliente reporta `0x14` como FormID de si mesmo; o servidor precisa trocar por `pcFormId` antes de usar. Sem isso, todo hit do próprio jogador aponta pro form errado.
- **`ctx.getFormIdInServerFormat()` é obrigatório** no snippet. FormID do cliente e do servidor são espaços diferentes — mandar o número cru daria o objeto errado.

> ✅ **Implementado em 06/08/2026 — como evidência, não como enforcement.**
>
> `core/hit-events.js` registra o event source e agrega os golpes; o `death-service` grava o episódio em `audit_logs` (`action='combat:episode'`). Substitui o `checkDamageSpike`, que chamava de agressão qualquer queda de 25 de vida, não distinguia combate de queda de penhasco e não sabia quem bateu.
>
> **É aqui que nos separamos deles, e a diferença é deliberada.** O Red House recalcula o dano a partir deste evento e aplica no ActorValue. Nós não: quem manda o evento é a máquina do jogador, e o `CONTRIBUTING.md` §3.6 é explícito — evento de cliente é *"uma dica, não uma prova"*. Usar isso para decidir dano entregaria o combate a quem controla o cliente. A própria linha gravada diz de onde veio, para que ninguém a trate como prova numa arbitragem.
>
> **Agrega em episódio, não grava golpe a golpe.** Uma briga de trinta segundos gera dezenas de eventos; eles podiam tratar cada um isoladamente porque o uso era efêmero, o nosso é persistente. Uma linha dizendo "A bateu em B sete vezes, duas com power attack, ao longo de doze segundos" responde melhor à pergunta da staff do que sete linhas iguais — e não inutiliza a tabela.
>
> Os dois detalhes que eles deixaram registrados economizaram a depuração óbvia: `0x14` é o jogador local (o servidor troca pelo `pcFormId`, e há teste de mutação) e `ctx.getFormIdInServerFormat()` é obrigatório.
>
> **O que ainda não foi validado:** `mp.makeEventSource` foi confirmada num servidor real — existe, aceita o registro, e o boot loga `[hit-events] Evento de agressao registrado`. Mas **o snippet de cliente nunca rodou**: ele só executa quando alguém conecta. Isso é a Fase 0.

### Eles calculam dano no servidor

`hitSync` não só registra o hit: recalcula o dano e aplica. Lê a arma equipada (`baseDamage`, tipo), a armadura do alvo (`baseArmor`), aplica multiplicador de power/bash attack vindo do `server-options`, reduz 50% se o golpe foi bloqueado, e escreve o resultado no ActorValue de vida.

É a resposta à pergunta "dá pra ter fórmula de dano própria sem mexer em C++?". Dá — o `IDamageFormula` em C++ que o SkyMP oferece é o caminho limpo, mas o caminho em JS existe.

Para Heavy RP isso abre coisas que hoje não temos: dano diferenciado por tipo de arma, armadura importando de verdade, e sobretudo o item seguinte.

### `isInSafeLocation` — zonas seguras ✅ *mecanismo implementado em 06/08/2026*

Antes de aplicar dano, eles checam uma property `isInSafeLocation` no alvo **e** no agressor. Se qualquer um dos dois estiver numa zona segura, o dano não é aplicado — o evento ainda é registrado, mas não machuca.

É exatamente o que falta pra proteger área de spawn, taverna de RP passivo ou cidade sob trégua. Combina com a nossa `action-policy.js`: hoje bloqueamos ações por **estado do personagem**, isso bloquearia por **lugar**.

**O que foi feito:** `core/safe-zones.js` responde onde alguém está e o que aquele lugar proíbe; a `action-policy.canPerform` ganhou a segunda dimensão, usando o `context` que já estava lá declarado como "para validações futuras". Estado continua sendo checado antes de lugar — para quem está algemado dentro de uma zona segura, "você está algemado" é a explicação útil.

A regra dos dois lados veio junto e tem teste próprio: proteger só o alvo deixaria alguém atirar de dentro da zona para fora dela.

**O que deliberadamente não foi feito:** decidir quais zonas existem. `skymp/config/safe-zones.json` nasce vazio, e sem ele o módulo responde "não há zona nenhuma" — mesmo padrão do `npc-cleaner.js`, pelo mesmo motivo. Zona segura é mecânica de mundo, e a Constituição §15 pede as 15 perguntas antes. As quatro que mais mudam o desenho estão listadas no `safe-zones.example.json`; a mais importante é se cidade sob trégua deve ser zona segura ou acordo IC que a guarda faz cumprir — a segunda gera história, a primeira gera regra.

**Nenhum chamador atual passou a ser afetado.** A checagem de lugar só acontece quando quem chama informa `context.actorId`, e nenhum dos quatro chamadores existentes informa. Isso é coberto por teste: uma regressão aí ligaria zona segura no servidor inteiro sem ninguém pedir.

### ⚠️ O aviso de performance que veio de graça

O código deles está cheio de `// TODO: optimize` com o custo medido ao lado:

| Operação | Custo anotado por eles |
|---|---|
| `getEquipment(...)` | 13 ms |
| `av.set(target, 'health', 'damage', ...)` | 35 ms |
| `av.getMaximum(target, 'health')` | 15 ms |

São medições deles, em hardware e versão deles — mas a ordem de grandeza é o recado: **cada ida e volta ao Papyrus custa dezenas de milissegundos**, não microssegundos. Eles chegaram a instrumentar tudo com um `logExecuteTime` por handler.

Isso importa direto pra nós. O `death-service.js` varre até 50 profileIds a cada 2 segundos chamando `getActorValue('Health')` por ator. Se uma chamada custa ~15 ms, 40 jogadores conectados consomem ~600 ms de cada janela de 2 s — e o laço é síncrono. O polling não escala.

É mais um argumento pra migração que já começamos (`mp.onDeath` como gatilho primário, `SKYMP_UPSTREAM_REFERENCE.md` §2.5) e pra tirar o polling de vez assim que o hook for confirmado in-game.

**O `player-panel-service` foi o primeiro a ser corrigido** (06/08/2026), por não depender da Fase 0. Ele lia vida/magicka/stamina — **três** chamadas — para todo painel aberto a cada 2 s, inclusive o de quem estava na aba Social. Com 10 painéis abertos eram 30 chamadas por janela, ~450 ms gastos para atualizar um número que ninguém estava vendo. O diffing que já existia não ajudava: ele evita reenviar, não evita ler.

A informação para evitar isso já chegava e era descartada — a UI manda `panel:refresh:<aba>` a cada troca (`switchTab` em `skymp/ui/player-panel.js`). Hoje o laço só lê de quem está com a aba Status visível. Com metade dos painéis em outras abas, o custo cai pela metade; na prática cai mais, porque Status é a aba que se abre e as outras são onde se fica.

Este é o modelo do que o Red House nos dá de mais útil: não código, mas **a medição que justifica mexer** em algo que parecia funcionar bem.

### Outras coisas que aprendemos

- **`mp.lookupEspmRecordById(formId)`** — o servidor consegue ler registros dos plugins (dano base de arma, armadura, perks, raça). Não sabíamos que existia. Abre validação server-side de item usando o dado real do ESM em vez de tabela nossa.

  ✅ **Implementado em 06/08/2026, com o formato confirmado num servidor real.** O projeto sabia que a função existia e nunca tinha visto o retorno dela — escrever validação em cima de formato adivinhado seria repetir o erro que já custou caro duas vezes aqui (o `self` do Papyrus, o require nu de dotenv). Uma sonda temporária foi apontada como gamemode, o servidor subiu, e o log respondeu:

  ```
  mp.lookupEspmRecordById(0x0000000f)
  // { record: { id: 15, editorId: 'Gold001', type: 'MISC', flags: 0, fields: [...] },
  //   fileIndex, toGlobalRecordId }

  mp.lookupEspmRecordById(0x00000014)   // Player, que é referência
  // {}                                  ← sem `record`
  ```

  **O detalhe que uma implementação adivinhada erraria: FormID inválido devolve `{}`, e `{}` é truthy.** Checar `if (r)` faria o Player passar como item. A checagem correta é `r && r.record`, e há teste de mutação para isso.

  Virou `core/espm.js` (com cache — o retorno traz todos os fields em bytes, e a load order não muda em runtime) e está ligado nos dois pontos onde um `base_id` novo **entra** no sistema: `/additem` e o anúncio em barraca. Nos dois o valor vem digitado à mão em hexadecimal, e antes disto um dígito errado gravava `character_inventory` do mesmo jeito — o item nunca aparecia in-game, mas ocupava linha no banco e no ledger.

  A validação **deixa passar quando não dá pra saber**: ela existe para pegar erro de digitação, não para ser autoridade. Só nega quando a API respondeu e respondeu que aquele FormID não é item. A assinatura foi documentada em `types/mp.d.ts` como `[USO]`, com a procedência.
- **Módulos com hook `onHit`** — o sistema de módulos deles recebe eventos, não só `initialize`. O nosso `core/module-registry.js` só tem ciclo de vida; um dia pode valer distribuir eventos de jogo pra módulos ativos.

  ⏸️ **Avaliado em 06/08/2026 — adiado, com o gatilho de reabertura escrito.** O censo dos seis módulos registrados dá **um consumidor e um tipo de evento**: só o `death` escutaria `hit`, e nenhum dos outros cinco (`governance`, `market-stalls`, `player-panel`, `voip`, `npc-cleaner`) escutaria coisa alguma. Hoje `core/hit-events.js` entrega o episódio direto ao assinante que o `death-service` passa em `start(cb)`; um despacho genérico trocaria essa linha por um barramento que serve a um só.

  O precedente do projeto aponta na mesma direção: quando um segundo consumidor apareceu de verdade — governança precisando avisar o painel —, a resposta foi `core/panel-refresh-bus.js`, pequeno e nomeado, não um canal genérico no registry.

  **O gatilho para reabrir:** um segundo módulo que precise de um evento de jogo já capturado por outro. O desenho fica registrado em `core/module-registry.js` para não ser redescoberto do zero — `descriptor.on = { hit, cellChange }` opcional no `register()`, despachado de onde o evento já é capturado.
- **`onCellChange`** por `makeEventSource` — saber quando alguém troca de célula é a base de zonas seguras, territórios e presença.

  ❌ **Não implementado, e não é o que falta.** Zona segura saiu sem ele: `core/safe-zones.js` consulta `mp.get(actorId, 'locationalData')` sob demanda, que é leitura de property servida do cache do servidor e não paga os 13–35 ms de ida ao Papyrus. Território e presença estão em "Pós-Alfa" no `HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md` — construir o evento por causa deles seria infraestrutura antes das 15 perguntas da Constituição §15.
- **`server-options.json` era deles.** As opções do nosso `SERVER_OPTIONS_SCHEMA.md` (`isVanillaSpawn`, `SpawnTimeToRespawn`, `spawnTimeToRespawnNPC`) são as do Red House. Isso explica por que o schema descrevia coisas que o nosso código nunca implementou: foi copiado como intenção e nunca ligado. Ver `QA_REPORT_2026-08.md` 2.10 — hoje o `core/server-options.js` diz claramente o que está ligado e o que não está.

### O front-end deles não vale a pena

`front/src/features` tem `client/{animList, chat}`, `systems/{interactionMenu, trade}` e `crafts` — React + Redux, de 2021, em russo.

Comparando com o que já temos: chat de proximidade ✅, menu de interação ✅, e além disso um painel de 4 abas que eles não têm. O que eles têm e nós não é a **janela de troca** e a **lista de animações** — e o nosso `trade-service` está PARKED de qualquer forma.

Ou seja: adotar o front deles seria trocar o que temos por algo equivalente ou menor, em outra stack, noutro idioma, sob GPL. O valor do Red House está no servidor, não na interface.

#### Os dois itens avulsos, avaliados separadamente (06/08/2026)

Descartar o front inteiro não decide sozinho o destino das duas coisas que só eles têm. Avaliadas uma a uma:

**Janela de troca — adiada junto com o serviço, com ponteiro deixado.** O `trade-service.js` deste projeto está PARKED, e ler `front/src/features/systems/trade` só vale a pena no dia em que ele for reativado — antes disso é estudo de UI para um sistema que não existe. A nota ficou registrada em [`PARKED_SERVICES_DECISION.md`](PARKED_SERVICES_DECISION.md), na entrada do `trade-service`, para que quem reativar não comece do zero. **Nada foi portado.**

**Lista de animações — NÃO é coberta pelo Perfil 1, e a distinção importa.** A pergunta era se `front/src/features/client/animList` já está resolvido pelo modpack. Não está, e confundir os dois é fácil:

| | O que é | Onde está |
|---|---|---|
| **Perfil 1 (OAR, Nemesis)** | **Entrega e paridade do asset.** Garante que todo cliente tenha o mesmo behavior graph e os mesmos arquivos de animação — é a condição para que uma animação sequer possa ser tocada de forma idêntica em duas máquinas | `MODDING_GUIDELINES.md` §1 e Fase 1 |
| **`animList` deles** | **Seleção pelo jogador.** Uma tela que lista animações e deixa escolher qual tocar — emote | `front/src/features/client/animList`, mais o comando `/anim` |

São camadas diferentes: o Perfil 1 é o encanamento, o `animList` é a torneira. Ter Nemesis pré-gerado no modpack não dá ao jogador nenhuma forma de tocar um emote, e o roadmap já sabe disso — a **Fase 1 chama-se "Identidade e Emotes"** justamente porque emote é feature própria, não subproduto de instalar OAR.

E não é troca de animação de combate: o que o Red House faz ali é escolher uma animação para tocar em cena, não substituir a animação de ataque. Substituição de combate seria coisa de modpack (e cairia na blacklist de "Física e Animação Pesada"); emote é comando + UI.

**Veredicto: potencialmente valioso, mas não é "só UI" — e por isso não entra agora.** A regra da autoridade do servidor (`MODDING_GUIDELINES.md`) é explícita: o servidor decide *"qual animação de gameplay foi autorizada"*. Um emote precisa então de um caminho servidor→cliente (comando, validação de estado pela `action-policy` — quem está `DOWNED` ou algemado não dança —, e a chamada Papyrus que toca), além da lista curada de quais animações existem. Isso é uma feature da Fase 1 com as 15 perguntas da Constituição §15 pela frente, não um item de aproveitamento do Red House. O que o `animList` deles vale, quando essa hora chegar, é como referência da tela — o mesmo estatuto da janela de troca.

### O que NÃO copiar

A conclusão da seção 2 continua valendo, e o código reforça:

- **`adminPassword` em `server-options`** — autenticação de staff por senha em arquivo de configuração. Nós derivamos staff de `staff_roles` no banco, com auditoria. Não regredir.
- **`/killall`, `/killnpc`, `/delete`, `/placeatme` expostos no chat** — comandos destrutivos sem o gate de permissão nomeada que o nosso `admin-service` tem.
- **Cálculo de perk a cada hit** — eles mesmos deixaram desligado (`const calcPerks = false`) por custo. Se formos por esse caminho, o cache é obrigatório desde o começo.

## 5. Ajustes Recomendados no Nosso Plano

1. Separar banco de mundo SkyMP de banco da plataforma RP.
2. Adicionar MongoDB como opcao de persistencia nativa SkyMP.
3. Manter PostgreSQL para whitelist, painel, logs, economia RP e staff.
4. Criar `docs/technical/SKYMP_SERVER_SETUP.md` com checklist real de portas, `dataDir`, masters do Skyrim e scripts.
5. Criar schema de `server-options` proprio, com validacao e perfis por ambiente.
6. Adicionar regra: `offlineMode`, hot reload e admin por senha ficam proibidos em producao.
7. Priorizar chat local por proximidade no MVP.
8. Priorizar spawn controlado por personagem aprovado, nao apenas por profile id.
9. Adicionar auditoria obrigatoria para comandos de staff.
10. Adicionar politica de licenca GPL/AGPL e nao afiliacao.
11. Adicionar decisao tecnica sobre NPCs: vanilla spawn desligado, reduzido ou seletivo.
12. Adicionar fase de laboratorio Red House apenas para aprendizado, sem virar base de producao.

## 6. Decisao Recomendada

Usar o SkyMP atual como base tecnica e o Red House como referencia historica/pratica.

Nao devemos copiar a arquitetura Red House integralmente para producao Heavy RP. Ela prova que chat, spawn, UI e server-options funcionam, mas tambem mostra riscos que precisam ser corrigidos desde o inicio: admin por senha, comandos perigosos, hot reload e estado de producao baseado em arquivos sem governanca.

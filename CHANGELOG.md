# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento [SemVer](https://semver.org/lang/pt-BR/).

> **Sobre o `0.x`:** o projeto fica em versão zero enquanto **nada tiver sido validado numa sessão de jogo real**. Publicar `1.0.0` sem isso seria prometer estabilidade que não foi verificada. A `1.0.0` sai depois do teste in-game da Fase 1 — ver [QA_REPORT_2026-08.md](docs/technical/QA_REPORT_2026-08.md) §3.

---

## [Não lançado]

### Adicionado

- **Zonas seguras — a `action-policy` passa a bloquear por lugar, não só por estado.** Vem do Red House, que checa `isInSafeLocation` antes de aplicar dano ([REFERENCE_STUDY §4.1](docs/technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md)). `core/safe-zones.js` responde onde alguém está e o que aquele lugar proíbe; a `canPerform` ganhou a dimensão usando o `context` que já estava declarado como "para validações futuras".

  A **regra dos dois lados** veio junto e tem teste próprio: uma ação entre duas pessoas é barrada se qualquer uma estiver protegida, porque proteger só o alvo deixaria alguém atirar de dentro da zona para fora dela. Estado continua sendo checado antes de lugar — para quem está algemado dentro de uma zona segura, "você está algemado" é a explicação útil.

  **A lista de zonas nasce vazia.** Zona segura é mecânica de mundo, e a Constituição §15 pede as 15 perguntas antes; as quatro que mais mudam o desenho estão em `skymp/config/safe-zones.example.json`. O mecanismo está entregue, a política não — mesmo padrão do `npc-cleaner`. Nenhum chamador atual mudou de comportamento, e isso tem teste.

- **`--only-load-order` no gerador de manifesto**, para rodar a Fase 0 antes do modpack existir. Sem ele, gerar o `mods.json` de uma `Data/` de trabalho produz um manifesto que exige a máquina de quem gerou — o `compareMods` do launcher reprova todo arquivo que o cliente não tenha, então um testador com instalação limpa é barrado por um mod que não faz parte de nada. O gerador não tinha teste nenhum, sendo o que decide o contrato de FormID; ganhou 6.

### Corrigido

- **`characters.gold` não existia em banco migrado** (migration v9). A coluna está declarada no `schema.sql` e em nenhuma migration: banco novo funciona, e quem criou o banco antes dela e aplicou `v2`→`v8` em ordem, como o CONTRIBUTING manda, nunca a recebe. A v2 chega a criar a `gold_transactions` — o ledger da economia — sem garantir a coluna de saldo que esse ledger acompanha. Não quebra o boot: quebra na primeira operação de ouro, que é todo o `transaction-service`. Achado pelo `npm run check:schema` ao preparar a Fase 0, que é exatamente a classe de problema para a qual ele foi escrito.

- **Dois defeitos que só o primeiro boot real revelou.** O servidor SkyMP foi instalado e subiu com o gamemode pela primeira vez no projeto — quatro módulos ativos, 33 comandos, banco conectado.

  O primeiro: **`Cannot find module 'dotenv'`, e o gamemode não carregava**. O SkyMP copia o arquivo de entrada para `%TEMP%` e executa de lá — está escrito no topo do próprio arquivo, e é por isso que todos os requires dele usam caminho absoluto. O do dotenv, adicionado neste ciclo, era o único nu. Passou nos testes e no CI porque os dois rodam a partir de `skymp/gamemode/`. É o exemplo mais limpo do que o cabeçalho do `ci.yml` já avisava: *"CI verde significa que não quebrou o que já era verificado, não que funciona em jogo"*.

  O segundo: **nenhuma opção de gameplay era lida**. O `.env.example` definia `NODE_ENV=development`, o loader monta `server-options.<NODE_ENV>.json`, e o projeto só tem `local` e `production`.

- **`database.js` não tinha `close()`**, e o `verify-governance-market-stalls.js` já chamava `db.close()` atrás de um guard que nunca disparava. `RUN_DB_CHECK=1 npm run test:systems` imprimia "10/10 passaram" e ficava pendurado para sempre (exit 124 por timeout; agora exit 0). Num CI com banco, o job só terminaria no timeout e o relatório diria "cancelado".

### Otimizado

- **O painel só lê vitais de quem está olhando a aba Status.** O laço lia vida/magicka/stamina — três chamadas Papyrus — para todo painel aberto a cada 2 s, inclusive o de quem estava na aba Social. A 13–35 ms por ida ao Papyrus (medição do Red House), são ~450 ms de cada janela com 10 painéis, gastos atualizando um número que ninguém está vendo. O diffing que já existia não ajudava: ele evita reenviar, não evita ler.

  A informação para evitar isso já chegava e era descartada — a UI manda `panel:refresh:<aba>` a cada troca. Nenhuma mudança na UI. Os testes contam as chamadas Papyrus de um tick, que é a única forma de provar a economia: o comportamento visível não muda, então nenhum teste de resultado pegaria a regressão.

- **`core/soul.js` guardava dois caracteres invisíveis com significado.** O arquivo contava como binário para o `grep` e para o `file`, e a causa não era a que parecia: além da classe de marcas combinantes crua no `normalize()` (`U+0300`–`U+036F`), havia um **byte NUL** no separador do material assinado — `].join('<NUL>')`, que se lê na tela como `].join('')`.

  O NUL é uma escolha deliberada e correta: ele não sobrevive ao `normalize()`, então nenhum jogador consegue escrevê-lo na ficha. Com um separador digitável, mover uma letra de um campo para o seguinte (`'ab'+'c'` contra `'a'+'bc'`) assinaria o mesmo material, e duas fichas diferentes nasceriam com a mesma alma. O problema nunca foi a escolha — foi ela estar invisível: quem lesse a linha entenderia o oposto, e qualquer editor que limpe caracteres de controle ao salvar mudaria a semente de **toda alma já derivada**, sem erro nenhum aparecer.

  Os dois viraram escape (`'\u0000'` e `[\u0300-\u036f]`), com o separador em constante nomeada. Verificado que as sementes não mudaram: quatro almas derivadas antes e depois batem byte a byte, incluindo o par que testa a fronteira entre campos.

  Ganhou também um teste de valores dourados — a derivação é um formato de dados, não código livre: mexer em `normalize`, na ordem dos campos ou no separador reescreve a alma de todo personagem que já existe. Agora isso reprova em vez de acontecer em silêncio.

- **A compra em barraca tinha a própria implementação de "como mexer em ouro".** `buyItem` escrevia o SQL de saldo e de inventário à mão dentro da transação dele — atômico e com ledger, então não era inseguro, mas era uma segunda implementação fora do arquivo que existe pra ser a única. O `SELECT ... FOR UPDATE` do saldo e a guarda de saldo negativo estavam duplicados, e correção no `core/transaction-service` não alcançava a compra.

  Não dava pra resolver chamando as funções públicas do `transaction-service`: cada uma abre a própria transação, e a compra move ouro, baixa estoque, credita o vendedor, cobra imposto e entrega o item — ou tudo commita junto, ou o comprador fica sem ouro e sem item. As primitivas internas já recebiam a conexão como argumento; passaram a ser exportadas como `tx.*`, com o contrato explícito de que quem chama é dono da transação.

  Junto: `err.message` ia direto pro jogador no `catch`, inclusive quando era erro de SQL — nome de tabela e coluna na tela de quem clicou em comprar. As mensagens de regra continuam passando; o resto vira uma frase genérica e o detalhe fica no log.

  `buyItem` não tinha **nenhum** teste de comportamento — o único que existia conferia que a função estava exportada. Ganhou 10, verificados por mutação: remover um lançamento do ledger reprova, e trocar as primitivas pelas funções públicas (quebrando a transação única) reprova em três.

- **O `npc-cleaner` apagava o mundo, e implementava a opção que a decisão técnica rejeitou.** Ele varria `mp.getActorsByProfileId(0)` e chamava `disable` **e `delete`** em todo ator encontrado, pulando apenas os de uma allowlist — que estava vazia, com um comentário "adicione IDs base de mercadores essenciais aqui". Na prática: mercadores, guardas e NPCs de quest apagados a cada 60 segundos, e `delete` numa referência persistente não volta. O [NPC_POLICY_DECISION](docs/technical/NPC_POLICY_DECISION.md) avaliou três opções e escolheu a **C — Vanilla Spawn Seletivo**; o código implementava a B, rejeitada, na forma mais extrema.

  Três inversões: a lista virou **de bloqueio** (lista vazia agora remove nada em vez de tudo — o modo de falha aponta pro lado seguro), o `safeRadius` **passou a existir de verdade** (era declarado com o comentário "limpa apenas NPCs longe dos players" e nunca lido: o comentário descrevia um recurso que não estava escrito), e o `delete` saiu — só `disable`, que é reversível. A lista guarda `baseDesc` e não FormID numérico, porque o primeiro byte de um FormID é o índice de load order. Config em `skymp/config/npc-policy.json`, serviço inerte enquanto ela não for curada. 8 testes, onde antes não havia nenhum.

  Isto ficou mais urgente com a correção do `.env` abaixo: até ela, ligar `ENABLE_NPC_CLEANER=true` não fazia nada.

- **`/setgold` era o único caminho de dinheiro que escapava do ledger.** Fazia `UPDATE characters SET gold = ?` direto — sem transação e **sem linha em `gold_transactions`** —, que é exatamente o padrão que motivou apagar o `economy-service.js`. É também o comando que mais precisa de rastro: ouro que aparece na conta de um jogador sem origem registrada é indistinguível de duplicação por bug, e quem pode fazer isso é justamente a staff. O `audit_logs` guardava a intenção do comando; o saldo deixava de fechar com a soma do ledger.

  Passou pelo `core/transaction-service`: o valor absoluto vira leitura + delta, com `reason='staff_setgold'`. Junto veio um guard que faltava — `/setgold <id>` sem valor passava `NaN`, que o MySQL grava como `0`, então um erro de digitação zerava o patrimônio do jogador em silêncio.

  O teste da matriz de permissões aferia esse comando observando o `UPDATE` cru, ou seja, o próprio padrão proibido. A sonda passou a exigir que o ouro tenha se movido **e** que a movimentação tenha virado linha no ledger — mais forte que antes, e verificada por mutação.

- **O gamemode nunca carregou o próprio `.env` — nenhum módulo `lab` jamais subiu.** `dotenv` estava em `dependencies`, o `.env.example` existia, e tanto o [CONTRIBUTING](CONTRIBUTING.md) §1 quanto o [roteiro da Fase 0](docs/technical/FASE_0_ROTEIRO.md) mandavam preencher `skymp/gamemode/.env`. Nenhum arquivo do gamemode chamava `require('dotenv')`. Quem lia esse arquivo era o `apps/web/server.js`, para si mesmo — o que tornava a falha invisível: o arquivo existia, era lido por alguém, e mesmo assim as flags não chegavam. `module-registry.bootAll()` via `process.env[ENABLE_*]` sempre indefinido, então governança, barracas, morte, painel e VOIP ficavam desligados de forma permanente. Sem erro: o log dizia `DESATIVADO (... não definido)`, exatamente o que diria se a pessoa tivesse escolhido desligar.

  O check `flags de ambiente` dava `[PASS]` durante todo esse período porque só conferia que a string existia no `.env.example` — provava que alguém escreveu a linha, não que ligar a linha fazia algo. Foi substituído por um que verifica o carregamento **e a ordem** (o `.env` precisa vir antes do registry e do `server-options`, que leem o ambiente em tempo de require, não de boot).

- **Cargo de staff sobrevivia à desconexão e era herdado pelo próximo jogador.** `admin-service.removeStaffRole` existia, era exportada e tinha teste — e nenhum caminho de produção a chamava. O cache é chaveado por `actorId`, que o SkyMP reaproveita entre sessões, e `registerStaffRole` só roda no login: quem entrasse no `actorId` de um admin que saiu herdava `ban`, `set_gold` e `retire_character`. Não aparecia em nenhum teste de permissão porque o cargo estava correto nos dois momentos — o defeito era de sessão, não de autorização.

- **Módulo PARKED podia ser ligado por fora do `module-registry`.** O `governance-service` decidia se o `economy-regional` roda lendo `process.env.ENABLE_REGIONAL_ECONOMY` direto, em dois pontos: a flag no `.env` bastava para carregar e executar um módulo estacionado sem resolução de dependência, sem registro de comando e sem shutdown — o oposto do que o registry existe para garantir. Passou a usar `moduleRegistry.isEnabled()`. Nenhum módulo foi reativado.

- **Resíduos da forma antiga de chamada Papyrus** (achado 2.13). A conversão das 22 chamadas se manteve, mas o `market-stalls-service` tinha o FormID cru como *fallback* quando `mp.getDescFromId` some — caindo justamente na forma inválida, e de um jeito que culpa o asset no log em vez de acusar o contrato. Junto: `death-service` e `player-panel-service` construíam `{type,desc}` inline em vez de usar `actorRef()`, e o `jobs-service` guardava uma chamada comentada com a forma errada logo acima de um `TODO: Descomentar`. Agora há um guard estático que varre o gamemode inteiro, **PARKED incluído** — que é onde a forma antiga voltaria sem nenhum teste de comportamento perceber.

- **`.env.example` desalinhado em dois apps.** O do gamemode oferecia `ENABLE_JUSTICE_SERVICE`, `ENABLE_FACTION_SERVICE` e `ENABLE_SURVIVAL_SERVICE` — flags dos três serviços **apagados** em 06/08 — e omitia governança, barracas e painel, que existem. O do painel web não documentava `TRUST_PROXY`, `NODE_ENV` nem `LAUNCHER_REDIRECT_URIS`, todos lidos pelo `server.js`. `TRUST_PROXY` é o que mais custa em silêncio: sem ele atrás de um proxy reverso o Express enxerga o IP do proxy, e o rate limit passa a contar o mundo inteiro como um visitante só — continua "funcionando" sem proteger nada.

- **Cliente com plugin extra passava na verificação de paridade.** As duas checagens percorriam a lista do servidor perguntando "o jogador tem isto?"; nenhuma percorria a do jogador perguntando "o servidor conhece isto?". Um cliente com todos os mods certos, com o hash certo, **mais um `.esp` a mais**, era aprovado — e um plugin extra ocupa um índice na load order e desloca todos os seguintes, então o `base_id` gravado no banco passa a apontar para outro item na tela daquele jogador. Sem erro, sem log, sem crash: um baú com outra coisa dentro. Junto veio um segundo caso — load order ausente fazia a checagem comparar o jogador consigo mesmo e responder `ok`, que é a pior resposta possível porque parece aprovação. Ver QA 2.15.

### Adicionado

- **[Roteiro da Fase 0](docs/technical/FASE_0_ROTEIRO.md)** — o teste in-game passa a ser um procedimento de ~50 min com passos, o que observar, o que significa falhar, e um registro para preencher enquanto testa. O plano anterior era de 13/07 e cobria só governança e barracas; desde ele entraram morte, painel, VOIP, master API e fila.
- **Primeiros testes do launcher** (24) — ele tinha zero, e é o programa que todo jogador roda. A lógica de paridade saiu de dentro dos handlers `ipcMain` para `electron/parity.mjs`, sem `fs`, sem `http` e sem `electron`: as dependências de I/O entram como argumento, e o cabeçalho TES4 é testado com um plugin sintético de 60 bytes em vez de um `.esm` de 300 MB. O launcher entrou na matriz de testes do CI.

- **`core/soul.js` — a camada de domínio da Afinidade da Alma**, com 28 testes. Função pura: gerador com orçamento fixo, bandas, semente derivada da ficha e resolução em quatro resultados. Não depende da Fase 0 porque não toca no jogo — o serviço, que toca, continua bloqueado.

  O número que valida o desenho: **`surdo` com mestre e componente dá exatamente a mesma distribuição que `raro` sozinho** (25/40/25/10). A afinidade não fecha porta — ela decide de quanta gente você vai precisar.

- **[Afinidade da Alma](docs/design/SOUL_AFFINITY.md) — desenho fechado**, e a **Constituição vai a v1.1** (a §8 deixa de ser "Soul DNA"). Sistema único que explica magia, encantamento, corrupção, vampirismo, licantropia e linhagem. Três partes: análise de 15 pontos, o desenho que preserva a diversão, e a especificação.

  As decisões que fecharam o desenho: **o dado nunca diz não** (Limpo/Caro/Complicado/Marcado — os quatro dão certo); **nenhuma alma é estritamente melhor**, garantido por orçamento fixo no gerador e não por boa vontade; **a alma vem da ficha aprovada**, o que mata o reroll-farming e faz a aplicação de whitelist valer mecanicamente; **as marcas são a progressão** — não há nível, há o que ficou em você; e **prazo em sessões, não em meses**.

  Vetado: a mordida com 70% de morte, que transformaria qualquer vampiro num `/permakill` ambulante. No lugar, infecção com janela de escolha entre curar, esconder ou aceitar.

- **[CONSTITUICAO.md](docs/CONSTITUICAO.md) v1.0** — a constituição de design do projeto. Define que não estamos construindo um servidor, mas um mundo persistente capaz de produzir histórias por anos sem depender da staff; que toda mecânica responde "como isso gera histórias?" ou é descartada; e que todo poder cobra um preço. Vampirismo e licantropia são maldições com política e perseguição, nunca buffs. Nada de dinheiro, craft ou loot infinito.

  O **Anexo A** é parte do documento e registra as sete tensões que a própria constituição cria — entre elas: aplicar "nunca implementar primeiro" sem limite congelaria o teste in-game, que é o único bloqueio real do projeto; "sistema que depende da staff" lido ao pé da letra proibiria a whitelist; e uma economia de NPC conduzida por Papyrus não escala, dado o custo de 13–35 ms por chamada.

- **Verificação de drift de schema** (`npm run check:schema`) — as migrations `v2`–`v8` são aplicadas à mão e nada conferia que todas tinham sido aplicadas. Um banco meio-migrado não quebra o boot: o servidor sobe, o login passa, e só a query que toca a coluna faltante falha, às vezes semanas depois, numa cena, com ouro no meio. O check lê `schema.sql` + migrations como fonte da verdade e confronta com `information_schema`. Roda no `Start-AllServices.ps1` e, na forma `--list` (sem banco), no CI.
- **Teste de comportamento de permissão por cargo** (`permissions.behavior.test.js`) — matriz explícita de cargo × comando, chamando os handlers reais e olhando o efeito colateral, não o retorno. Pega as duas falhas que o teste unitário não pega: handler que esqueceu de chamar `hasPermission`, e cargo alargado em silêncio. Verificado por mutação: remover o gate do `/setgold` quebra o teste.
- **Testes do `identity-service`** — o sistema que sustenta o disfarce (o nome exibido depende de quem está olhando) não tinha teste nenhum. Fixa o contrato: desconhecido é "Desconhecido", conhecimento não é recíproco, e sem observador nunca se revela nome civil. Qualquer integração futura que vaze o registro civil falha aqui em vez de arruinar uma cena.
- **[OPERATIONS.md](docs/technical/OPERATIONS.md)** — runbook de operação: pré-boot, diagnóstico de schema, matriz de quem pode o quê, portas, segredos, e uma seção honesta do que ainda não é coberto.

Total de testes: 301 (218 gamemode + 40 web + 24 game-api + 19 bot) + 9 checks de sistema.

- **Documentos de entrada em russo e espanhol** — `README`, `CONTRIBUTING` e `SECURITY` agora existem em quatro idiomas (`.md`, `.en.md`, `.ru.md`, `.es.md`), com linha de troca de idioma no topo de cada um. Russo porque é a língua nativa da comunidade SkyMP: o upstream e o Red House são russos, e até aqui um dev russo caía num repositório que não sabia ler. Espanhol pelo alcance na América Latina, onde a comunidade de Skyrim é grande e o português já é vizinho.

A documentação técnica profunda continua **só em português**, por decisão registrada em `docs/README.md`: são muitos documentos que mudam com frequência, e tradução desatualizada é pior que tradução ausente.

---

## [0.1.0] — 2026-08-06

Primeira versão marcada. Consolida a auditoria completa do monorepo, a pesquisa no SkyMP upstream e a adoção de AGPL-3.0 como build pública.

### Adicionado

- **`apps/game-api`** (porta 7758) — o serviço que o launcher sempre chamou e que não existia. Serve `/mods.json` (paridade de modpack), fila de entrada com capacidade e expiração de reserva, e endpoints internos de sessão. Manifesto ausente responde 503, nunca lista vazia.
- **Master API de sessão** no `apps/web` (`GET /api/servers/:masterKey/sessions/:session`) — contrato nativo do SkyMP que tira a identidade das mãos do cliente. Com `offlineMode: false`, o `profileId` passa a vir do painel, que é quem autenticou o Discord.
- **Tipagem da API `mp`** (`skymp/gamemode/types/mp.d.ts`) — não existe typings públicos do SkyMP. Marca a procedência de cada assinatura (`[DOC]` vs `[USO]`).
- **`core/server-options.js`** — carrega, valida e aplica `server-options.json`, que antes era gerado e documentado mas nunca lido. Oito opções ligadas de verdade; valor inválido aborta o boot.
- **`core/papyrus.js`** — helpers `actorRef`/`baseRef` para o formato correto do `self` nas chamadas Papyrus.
- **`core/proximity-ranges.js`** — fonte única dos raios de chat e voz.
- **Autoria de morte** via `mp.onDeath(actorId, killerId)`, gravada em `audit_logs`. É atribuição, não a inferência por proximidade.
- **Morte permanente** opcional (`rp.permadeathEnabled`).
- **Ouro inicial** por personagem (`economy.startingGold`), concedido uma vez só via chave de idempotência.
- **Migrations v6, v7 e v8** — tickets de lançamento, índices das queries quentes, sessões de jogo.
- **Rotação de crash reports** por idade e por contagem.
- **CI no GitHub Actions** — 4 suítes, checks de sistema, typechecks, e higiene (nenhum `.env` ou asset da Bethesda versionado).
- **Documentação de contribuição**: `CONTRIBUTING`, `SECURITY`, `CHANGELOG`, índice em `docs/README.md`, templates de PR e issue — em português e inglês nos pontos de entrada.
- **`LICENSE`** (AGPL-3.0) — o projeto não tinha licença nenhuma, o que legalmente significava "todos os direitos reservados" e impedia a build pública.
- **Documentos novos**: contrato mods × gamemode, distribuição pelo launcher, referência do SkyMP upstream, guia da build pública, decisão sobre serviços PARKED, relatório de QA.

### Corrigido

- **Launcher não carregava configuração nenhuma.** Lia `process.env.VITE_*` sem nada colocar valores lá — login do Discord impossível, servidor sempre localhost, updater desligado. As sete variáveis do `.env.example` nunca tiveram efeito.
- **Client secret do Discord embutido no instalador.** A troca de token migrou para o painel; o launcher recebe só o perfil público.
- **Aprovar whitelist ressuscitava personagem `retired`**, desfazendo `/permakill`.
- **22 chamadas Papyrus com o argumento errado** — passavam FormID cru onde os testes oficiais do SkyMP usam objeto `{type, desc}`. A suíte passava porque o `mp` mockado aceita qualquer coisa.
- **Raios de chat e voz divergentes** — quem estava no alcance do sussurro escrito ficava fora do falado.
- **`.env` fora do `.gitignore`** em `apps/bot-discord` (onde vive o token do bot) e `apps/launcher`.
- **`electron/` nunca foi typechecked**; e `npm run build` rodava `tsc` num solution file que não checava projeto nenhum.
- **Porta do launcher** divergia da do servidor (7757 vs 7777).
- **`hasPermission` aceitava número em silêncio** — `Set.has(20)` num Set de strings sempre nega.
- **`DATE(created_at)=CURDATE()`** no dashboard impedia uso de índice.
- **CORS e callback do Discord** presos a `localhost`.
- **Endpoint de manifesto morto** com `dummy_hash_for_testing` no painel.
- **Validação de entrada** em `/api/apply`.

### Removido

- **`economy-service.js`** — mexia em ouro com `UPDATE` solto, sem transação nem ledger; o `transfer` podia fazer ouro sumir. Seis módulos o importavam. Os que ficaram foram migrados para `core/transaction-service`.
- **`justice-service.js`** — superseded pelo `governance-service`, que tem alcance, plantão, auditoria e permissões nomeadas.
- **`faction-service.js`** — mantinha um modelo de associação concorrente com `governance_memberships`. Facção é um escopo da governança.
- **`survival-service.js`** — mexia em `ActorValue`, que é o que o `death-service` lê para detectar `DOWNED`.
- **Documentos consumidos**: estudos de referência já absorvidos pelo backlog e pela arquitetura, snapshots de máquina, e um doc que argumentava sobre um endpoint que ninguém usava.

### Segurança

- Fila autenticada por ticket de uso único emitido pelo painel, em vez do `discordId` que o cliente informa.
- Tickets e sessões guardados como hash SHA-256 — vazamento do banco não vira credencial.
- `redirect_uri` do OAuth validado contra allowlist.
- Rate limiting nos endpoints públicos do painel e da API do jogo.

### Sabidamente não pronto

Listado aqui de propósito, porque uma build honesta sobre suas lacunas é mais útil que uma que promete demais:

- **Nada foi validado em jogo.** Todo o gamemode é verificado com `mp` mockado.
- **Instalador não assinado** — SmartScreen bloqueia.
- **`mods.json` precisa ser gerado** de uma pasta `Data/` real antes de qualquer jogador conseguir entrar.
- **Polling de 2s** ainda existe no `death-service` e no `player-panel-service` como rede de segurança, e é caro (cada chamada Papyrus custa dezenas de ms).
- **VOIP nativo** depende de um patch de client que não existe upstream; a alternativa são canais de voz do Discord.

[0.1.0]: https://github.com/vinicius3232/skymp-heavy-rp/releases/tag/v0.1.0

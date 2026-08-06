# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento [SemVer](https://semver.org/lang/pt-BR/).

> **Sobre o `0.x`:** o projeto fica em versão zero enquanto **nada tiver sido validado numa sessão de jogo real**. Publicar `1.0.0` sem isso seria prometer estabilidade que não foi verificada. A `1.0.0` sai depois do teste in-game da Fase 1 — ver [QA_REPORT_2026-08.md](docs/technical/QA_REPORT_2026-08.md) §3.

---

## [Não lançado]

### Corrigido

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

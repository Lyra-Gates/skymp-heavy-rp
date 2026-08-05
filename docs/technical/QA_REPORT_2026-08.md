# Relatório de QA e Plano de Melhorias — Agosto/2026

Varredura completa do monorepo: gamemode, painel web, bot do Discord, launcher, schema, scripts e documentação. Escrito depois de rodar os testes existentes, seguir cada caminho de configuração até a origem e conferir se o que a documentação afirma bate com o que o código faz.

**Método e limite:** tudo aqui foi verificado por leitura de código, execução de testes automatizados e checagem estática. **Nada foi validado numa sessão de jogo real** — nenhuma afirmação sobre comportamento in-game deve ser tomada como testada.

*Atualizado depois da primeira rodada de correções: os itens marcados "corrigido"/"resolvido" já estão no código; os marcados **ABERTO** continuam pendentes.*

---

## 1. Estado por componente

| Componente | Testes | Instalável | Estado real |
|---|---|---|---|
| `skymp/gamemode` | 105/105 ✅ + 9/9 checks de sistema | ✅ | **Maduro.** Melhor parte do projeto: transações atômicas, máquina de estado, registry de módulos, cobertura de teste real. |
| `apps/bot-discord` | 13/13 ✅ | ✅ | **Funcional**, escopo pequeno (sync de cargo + canais de voz temporários). |
| `apps/web` | 29/29 ✅ | ✅ | **Funcional.** Ganhou smoke tests nesta rodada. |
| `apps/launcher` | ❌ nenhum | ✅ | **Estava quebrado ponta a ponta** (ver 2.1); corrigido nesta rodada, mas sem validação em runtime. |
| `apps/game-api` | 24/24 ✅ | ✅ | **Novo.** Serve a porta 7758 que o launcher sempre chamou e que não existia. |
| Tipagem `mp` | `npm run typecheck` | — | `skymp/gamemode/types/mp.d.ts` tipa a API do SkyMP (não há typings públicos upstream). Informativo, não trava build nem teste. Achou 2.13 e 2.14 na primeira execução. |
| Schema / migrations | — | — | Consistente. Sem drift entre tabelas referenciadas e definidas. |

### O que efetivamente roda hoje

Cinco módulos registrados no `core/module-registry.js`, todos atrás de flag `ENABLE_*` e **todos desligados por padrão**: `npc-cleaner` (core), `death`, `governance`, `market-stalls`, `player-panel`, `voip` (lab).

Onze serviços existem no disco e **nunca são registrados** — `justice`, `survival`, `economy-regional`, `faction`, `jobs`, `crafting`, `housing`, `trade`, `disguise`, `horse`, `economy`. Isso está documentado e é intencional (PARKED), mas vale dizer em voz alta: **é a maior parte do código do gamemode em volume, e nada dela roda.**

---

## 2. Achados

### 2.1 🔴 Launcher não carregava configuração nenhuma — *corrigido*

`electron/main.ts` lia `process.env.VITE_DISCORD_CLIENT_ID`, `VITE_SERVER_IP`, `VITE_API_PORT`, `VITE_GITHUB_DIST_REPO`. **Nada colocava esses valores em `process.env`**: não havia `dotenv`, nem `loadEnv`, nem `define` no `vite.config.ts`. O Vite carrega `.env` para `import.meta.env` (renderer), não para o processo Node do main — e o app empacotado não tem `.env` do lado.

Consequência: todos caíam no fallback vazio/`127.0.0.1`. Login do Discord impossível (`client_id=''`), servidor sempre localhost, updater desligado. O `.env.example` documentava sete variáveis que nunca tiveram efeito.

**Corrigido:** `vite.config.ts` agora usa `loadEnv` + `define` pra substituir esses acessos em tempo de build, que é o único mecanismo que sobrevive ao empacotamento.

### 2.2 🔴 Client secret do Discord embutido no instalador — *corrigido*

`VITE_DISCORD_CLIENT_SECRET` era usado direto na troca de `code` por token dentro do launcher. Corrigir só o 2.1 teria **piorado** isso: o secret passaria a ser inlined no bundle e distribuído a todo jogador que baixasse o instalador.

**Corrigido:** a troca virou `POST /api/launcher/oauth/exchange` no painel web, que já guarda o secret. O launcher manda `{code, redirect_uri}` e recebe só o perfil público — nem o access token. O painel valida o `redirect_uri` contra allowlist, com rate limit.

### 2.3 🔴 Aprovar whitelist ressuscitava personagem morto permanentemente — *corrigido*

`PATCH /api/whitelist/:id` fazia `UPDATE characters SET status='approved'` juntando por conta, **sem filtrar por status**. Um jogador que levasse `/permakill` (`status='retired'`), criasse ficha nova e fosse aprovado tinha o personagem aposentado revertido para `approved` — desfazendo a consequência e apagando o efeito do audit log.

**Corrigido:** `AND c.status='pending'` no `UPDATE` (e no de `extra_review_notes`).

### 2.4 🟠 `.env` fora do `.gitignore` em dois apps — *corrigido*

`apps/web` e `skymp/gamemode` tinham `.gitignore` próprio cobrindo `.env`. **`apps/bot-discord` não tinha `.gitignore` nenhum** (é onde vive `DISCORD_BOT_TOKEN` e `INTERNAL_API_SECRET`) e `apps/launcher` ignorava `*.local` mas não `.env`. Nenhum `.env` real chegou a ser commitado, mas um `git add .` bastaria.

**Corrigido:** regra `.env` / `!.env.example` no `.gitignore` da raiz, cobrindo os quatro.

### 2.5 🟠 `electron/` nunca foi typechecked — *corrigido*

`tsconfig.node.json` incluía só `vite.config.ts`; `tsconfig.app.json`, só `src`. O `npm run build` roda `tsc`, mas `tsc` não olhava para o processo main — e o `vite-plugin-electron` usa esbuild, que transpila sem checar tipo. Erro de tipo em `main.ts` (1.200+ linhas, a parte mais complexa do launcher) ia direto pro instalador.

**Corrigido:** `electron` adicionado ao include. A checagem pegou um import morto na primeira execução.

### 2.6 🟠 Três tabelas de raio de proximidade divergentes — *corrigido*

`rp-chat-service.js` (450/1200/1500/2000/3500), `voip-service.js` (200/1200/3000) e `server-options.*.example.json` (350/1400/3000) discordavam. Efeito de RP: quem estava dentro do alcance do sussurro **escrito** ficava fora do sussurro **falado** — o mesmo gesto de chegar perto funcionava ou não dependendo do canal.

**Corrigido:** `core/proximity-ranges.js` como fonte única; chat, voz e o raio de evidência de morte derivam dela.

### 2.7 🟠 Endpoint de manifesto morto com hash falso — *corrigido*

`GET /api/launcher/manifest` no painel devolvia `hash: "dummy_hash_for_testing"` e uma URL fake. **Nenhum código o consumia** — o launcher usa GitHub Releases. Pior: `MANIFEST_VS_NEXUS_COLLECTIONS.md` argumentava a fundo sobre esse endpoint como se fosse o mecanismo real, e creditava SHA-256 a um caminho de código que usa MD5.

**Corrigido:** endpoint removido; a documentação foi reescrita como `LAUNCHER_DISTRIBUTION.md`, descrevendo os canais que existem de verdade.

### 2.8 🟠 `/api/apply` sem validação de entrada — *corrigido*

Aceitava nome vazio, biografia de um caractere ou texto maior que a coluna (virando 500 sem explicação). Os campos que a rubrica de whitelist trata como eliminatórios (motivações, fraquezas, laços sociais) eram `required` só no HTML — trivial de contornar.

**Corrigido:** validação server-side com mínimos e máximos por campo.

### 2.9 🔴 não existia servidor na porta 7758 — *resolvido, com uma ponta solta*

O launcher chama `http://<SERVER_IP>:7758/mods.json` (paridade de modpack) e `/api/queue/status` + `/api/queue/join` (fila). **Nenhum serviço deste repositório escuta nessa porta.**

Isso significa que a verificação de paridade de mods — a coisa que sustenta todo o contrato de FormID e a regra de autoridade do servidor — **nunca rodou**.

**Resolvido:** `apps/game-api` serve os três endpoints, com gerador de manifesto (`scripts/generate-mods-manifest.js`) e 24 testes. Detalhes em `LAUNCHER_DISTRIBUTION.md`. Junto veio 1.1b: a fila passou a exigir ticket emitido pelo painel em vez do `discordId` que o cliente informa.

**Ponta solta (🟠 ABERTO):** o gamemode ainda **não lê o ticket de sessão**. `whitelist.js` deriva a identidade do `profileId` que o cliente informa, e o `launcherTicket` que o launcher grava em `skymp_config.json` não é verificado por ninguém. Ou seja, a fila hoje controla *quantos* entram, não *quem* entra. `/internal/session/resolve` já existe pro gamemode fechar o laço — falta descobrir como o SkyMP expõe o ticket ao gamemode no momento da conexão, o que precisa de teste com servidor real.

### 2.10 🟡 **ABERTO** — `server-options.json` não é lido por ninguém

`Initialize-LocalConfig.ps1` gera o arquivo, `SERVER_OPTIONS_SCHEMA.md` documenta 112 linhas de opções, e **nenhum código lê**. Configuração que parece existir e não faz nada é pior que configuração ausente: alguém vai ajustar `permadeathEnabled` ou `startingGold` e concluir que o servidor está bugado.

**Mitigado nesta rodada:** aviso no topo do schema e chave `_aviso` nos exemplos. **A implementação continua pendente.**

### 2.11 🟡 `apps/web` sem dependências instaladas e sem testes — *resolvido*

`node_modules` ausente. `Start-AllServices.ps1` só checava a existência do `.env`, então o painel morria no `require('dotenv')` numa janela separada e a orquestração reportava sucesso. Era também o único serviço com lógica de negócio (autorização de staff, aprovação de whitelist, troca de OAuth) **sem nenhum teste**.

**Resolvido:** dependências instaladas; 29 smoke tests em `server.test.js` (guard de autenticação em 12 rotas, validação da ficha, allowlist de `redirect_uri`, hash do ticket); `Start-AllServices.ps1` agora pré-checa entrada, `.env` e `node_modules` de cada serviço e reporta o que não subiu em vez de mentir "concluída".

### 2.12 🟡 **ABERTO** — bot do Discord não registra comandos automaticamente

`/voz-criar` e `/voz-fechar` só existem depois de rodar `npm run deploy-commands` à mão. Não há nada que avise se isso foi esquecido; o comando simplesmente não aparece no Discord.

### 2.13 🔴 **ABERTO** — duas formas incompatíveis de chamar Papyrus, e ninguém sabe qual funciona

Achado ao tipar a API `mp` (`skymp/gamemode/types/mp.d.ts`). O parâmetro `self` de `mp.callPapyrusFunction('method', ...)` é passado de duas maneiras diferentes no mesmo código:

| Forma | Onde |
|---|---|
| `{ type: 'form', desc: mp.getDescFromId(actorId) }` | `death-service.js`, `player-panel-service.js` — **2 arquivos** |
| `actorId` cru (um `number`) | **22 pontos**, incluindo `core/transaction-service.js`, `inventory-service.js`, `npc-cleaner.js`, `governance-service.js`, `market-stalls-service.js` |

As duas nasceram no **mesmo commit** (`82625d2`, 11/07/2026): não houve migração de uma para outra, é inconsistência desde a origem. A documentação do SkyMP não especifica o formato, e nenhuma das duas foi exercitada em jogo.

**Por que isso é grave:** se só a forma de objeto for válida, 22 chamadas falham em silêncio — e entre elas está a entrega de item do `core/transaction-service.js`. O banco registraria a transação corretamente e o inventário do jogador ficaria vazio. O mesmo vale para remoção de NPC (`npc-cleaner`), sincronização de inventário no spawn (`inventory-service`) e as algemas da governança (`SetActorValue SpeedMult`).

**Deliberadamente não corrigido.** Trocar 22 chamadas com base em palpite pode quebrar código que funciona. A tipagem aceita as duas formas de propósito, com o aviso registrado no próprio `mp.d.ts`.

**É o item nº 1 a conferir no primeiro teste in-game** — e é barato conferir: entre um jogador e um `/additem`, dá para saber em minutos.

### 2.14 🟡 **ABERTO** — módulos PARKED chamam `hasPermission` com número

`admin-service.hasPermission(actorId, permission)` faz `staff.permissions.has(permission)`, onde `permissions` é um `Set` de **strings**. Doze chamadas passam um número (nível de staff: `10`, `20`):

`crafting-service` (2), `disguise-service` (1), `economy-regional` (1), `faction-service` (4), `justice-service` (4)

`Set.has(20)` num Set de strings é sempre `false`, então **toda** verificação de permissão nesses módulos nega sempre. Não há impacto hoje — os cinco estão PARKED — mas significa que eles estão mais quebrados do que "apenas não registrados": ligar a flag não os faria funcionar, apenas travaria toda ação de staff dentro deles.

Reforça o item 2.3 do plano (decidir o destino dos serviços PARKED): é dívida que não compila com a realidade atual do `admin-service`, não código pronto esperando uma flag.

---

## 3. Plano de melhorias

Ordenado por **o que desbloqueia o quê**. Os itens da Fase 1 são pré-requisito pra qualquer teste com jogadores reais.

### Fase 1 — Fechar o caminho até "dois jogadores conectados"

| # | Item | Por quê |
|---|---|---|
| 1.1 | ✅ **Feito** — `apps/game-api` serve `/mods.json`, `/api/queue/join` e `/api/queue/status` | |
| 1.1b | ✅ **Feito** — a fila exige ticket emitido pelo painel (`launch_tickets`, migration v6), de uso único e guardado como hash | |
| 1.2 | ✅ **Feito** — `apps/game-api/scripts/generate-mods-manifest.js` | |
| 1.3 | ✅ **Feito** — `Start-AllServices.ps1` pré-checa cada serviço e reporta o que não subiu | |
| 1.4 | ✅ **Feito** — 29 smoke tests em `apps/web/server.test.js` | |
| 1.5 | **Rodar o plano de teste in-game que já existe** (`GOVERNANCE_MARKET_STALLS_TEST_PLAN.md`) com as flags `ENABLE_*` ligadas | Todo o gamemode está verificado só por teste unitário com `mp` mockado. **É o próximo bloqueio real.** |
| 1.5a | **Primeiro teste do 1.5: resolver a ambiguidade do `self` do Papyrus (2.13).** Um `/additem` num jogador responde a pergunta | Decide se 22 chamadas funcionam ou falham em silêncio — incluindo a entrega de item do transaction-service. Barato de conferir, caro de ignorar. |
| 1.6 | **Gamemode passa a validar o ticket de sessão** via `POST /internal/session/resolve`, em vez de confiar no `profileId` do cliente | Sem isso a fila controla quantos entram, mas não quem. Precisa de servidor real pra descobrir como o SkyMP expõe o ticket na conexão. |

### Fase 2 — Tirar a configuração-fantasma do caminho

| # | Item | Por quê |
|---|---|---|
| 2.1 | **Carregar e validar `server-options.json` de verdade**, começando por `chat.*` (que já tem fonte única em `core/proximity-ranges.js`) e `rp.permadeathEnabled` | Resolve 2.10. Comece pequeno: um loader que valida e aplica dois blocos vale mais que um schema completo que ninguém lê. |
| 2.2 | **`deploy-commands` no boot do bot** (ou verificação que loga alto se divergir) | Resolve 2.12. |
| 2.3 | **Decidir sobre os 11 serviços PARKED**: reativar, reescrever ou apagar | São a maior parte do código do gamemode e nada roda. Cada um que fica é superfície de manutenção e confusão. `justice-service.js` em especial é redundante com `governance-service.js` — candidato claro a remoção. |
| 2.4 | **Limpar as 6 tabelas órfãs** do schema ou marcá-las como reservadas para módulo PARKED | Mesma razão: schema deve descrever o sistema, não uma intenção. |

### Fase 3 — Endurecer para produção

| # | Item | Por quê |
|---|---|---|
| 3.1 | **CORS e `DISCORD_CALLBACK_URL` configuráveis** no painel (hoje `http://localhost:${PORT}` fixo) | Quebra assim que sair da máquina de dev. |
| 3.2 | **Rotação/expiração de crash reports** (`apps/web/crash-reports/`) | Cresce sem limite; cada arquivo pode ter 64 KB de log por crash. |
| 3.3 | **Assinar o instalador do launcher** (as chaves já são lidas do ambiente pelo electron-builder) | Sem assinatura, SmartScreen bloqueia e jogador não instala. |
| 3.4 | **Índices no schema** para as queries de leitura mais quentes (`audit_logs` por data, `character_inventory` por `character_id`) | Só importa com carga real, mas é barato fazer antes. |

### Não fazer

- **Migrar os manifestos pra formato Nexus Collections.** Ver `LAUNCHER_DISTRIBUTION.md` §5 — Collections não garante paridade de load order, que é o motivo dos manifestos existirem.
- **Perseguir o VOIP nativo antes do resto.** Depende de um patch de client que não existe upstream (`VOICE_CLIENT_PATCH.md`) e já tem alternativa funcionando via canais de voz do Discord.
- **Reativar módulo PARKED sem passar pelo `module-registry`.** O registry é o que garante flag, dependência e cleanup de comando; contorná-lo devolve o projeto ao estado que gerou boa parte dos bugs já corrigidos.

---

## 4. O que este relatório não cobre

- **Comportamento em jogo.** Nenhum comando (`/painel`, `/socorrer`, `/iniciar`, `/permakill`, `/voz`) foi executado numa sessão real. Os testes usam `mp` mockado.
- **Interação real com a API do Discord.** O bot e a nova rota de OAuth não foram exercitados contra bot/guild reais.
- **Build empacotado do launcher.** A correção de `define` foi validada por typecheck, não por instalador gerado.
- **Carga.** Nenhuma medição com múltiplos jogadores, que é onde o polling de 2s do `death-service`/`player-panel`/`voip` tende a aparecer primeiro.

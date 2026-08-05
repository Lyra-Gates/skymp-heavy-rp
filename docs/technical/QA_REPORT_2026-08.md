# Relatório de QA e Plano de Melhorias — Agosto/2026

Varredura completa do monorepo: gamemode, painel web, bot do Discord, launcher, schema, scripts e documentação. Escrito depois de rodar os testes existentes, seguir cada caminho de configuração até a origem e conferir se o que a documentação afirma bate com o que o código faz.

**Método e limite:** tudo aqui foi verificado por leitura de código, execução de testes automatizados e checagem estática. **Nada foi validado numa sessão de jogo real** — nenhuma afirmação sobre comportamento in-game deve ser tomada como testada.

---

## 1. Estado por componente

| Componente | Testes | Instalável | Estado real |
|---|---|---|---|
| `skymp/gamemode` | 105/105 ✅ + 9/9 checks de sistema | ✅ | **Maduro.** Melhor parte do projeto: transações atômicas, máquina de estado, registry de módulos, cobertura de teste real. |
| `apps/bot-discord` | 13/13 ✅ | ✅ | **Funcional**, escopo pequeno (sync de cargo + canais de voz temporários). |
| `apps/web` | ❌ nenhum | ⚠️ `node_modules` ausente | **Funcional em código**, mas nunca exercitado por teste automatizado. |
| `apps/launcher` | ❌ nenhum | ✅ | **Estava quebrado ponta a ponta** (ver 2.1); corrigido nesta rodada, mas sem validação em runtime. |
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

### 2.9 🔴 **ABERTO** — não existe servidor na porta 7758

O launcher chama `http://<SERVER_IP>:7758/mods.json` (paridade de modpack) e `/api/queue/status` + `/api/queue/join` (fila). **Nenhum serviço deste repositório escuta nessa porta.**

Isso significa que a verificação de paridade de mods — a coisa que sustenta todo o contrato de FormID e a regra de autoridade do servidor — **nunca rodou**. É o maior buraco funcional aberto do projeto.

### 2.10 🟡 **ABERTO** — `server-options.json` não é lido por ninguém

`Initialize-LocalConfig.ps1` gera o arquivo, `SERVER_OPTIONS_SCHEMA.md` documenta 112 linhas de opções, e **nenhum código lê**. Configuração que parece existir e não faz nada é pior que configuração ausente: alguém vai ajustar `permadeathEnabled` ou `startingGold` e concluir que o servidor está bugado.

**Mitigado nesta rodada:** aviso no topo do schema e chave `_aviso` nos exemplos. **A implementação continua pendente.**

### 2.11 🟡 **ABERTO** — `apps/web` sem dependências instaladas e sem testes

`node_modules` ausente. `Start-AllServices.ps1` só checa a existência do `.env`, então o painel morre no `require('dotenv')` numa janela separada e a orquestração reporta sucesso. É também o único serviço com lógica de negócio (autorização de staff, aprovação de whitelist, troca de OAuth) **sem nenhum teste**.

### 2.12 🟡 **ABERTO** — bot do Discord não registra comandos automaticamente

`/voz-criar` e `/voz-fechar` só existem depois de rodar `npm run deploy-commands` à mão. Não há nada que avise se isso foi esquecido; o comando simplesmente não aparece no Discord.

---

## 3. Plano de melhorias

Ordenado por **o que desbloqueia o quê**. Os itens da Fase 1 são pré-requisito pra qualquer teste com jogadores reais.

### Fase 1 — Fechar o caminho até "dois jogadores conectados"

| # | Item | Por quê |
|---|---|---|
| 1.1 | **Construir o serviço da porta 7758** (`/mods.json`, `/api/queue/status`, `/api/queue/join`) | Sem ele a paridade de modpack nunca é verificada e a fila nunca responde. Bloqueia 2.9. |
| 1.1b | **Autenticar a fila de verdade.** Com a remoção do access token do launcher (2.2), `/api/queue/join` passou a mandar `{ discordId, password }` — e `discordId` é público, qualquer um pode alegar ser qualquer um. Como o serviço ainda não existe, o desenho correto é emitir um ticket curto no painel (que é quem autenticou o Discord) e a fila validar esse ticket | Se a fila nascer confiando no `discordId` do cliente, nasce com um bypass de whitelist. |
| 1.2 | **Gerar `mods.json` a partir da pasta `Data/` do servidor** (script que hasheia e emite `{mods, loadOrder}`) | O endpoint sem um gerador vira outro stub com hash falso. |
| 1.3 | **`npm ci` no `Start-AllServices.ps1`**, ou pelo menos falhar alto se faltar `node_modules` | Hoje a orquestração reporta sucesso com o painel morto. Resolve 2.11 (parte). |
| 1.4 | **Smoke test de `apps/web`** (`supertest`): auth exigida, staff exigida, `/api/apply` valida, aprovação não toca `retired` | É o serviço com mais regra de negócio e zero teste. Trava as correções 2.3 e 2.8. |
| 1.5 | **Rodar o plano de teste in-game que já existe** (`GOVERNANCE_MARKET_STALLS_TEST_PLAN.md`) com as flags `ENABLE_*` ligadas | Todo o gamemode está verificado só por teste unitário com `mp` mockado. |

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

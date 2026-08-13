# Auditoria de infraestrutura de plataforma

Data: **2026-08-13**. Cobre `apps/launcher`, `apps/game-api` e a parte de `apps/web` que serve o launcher (OAuth exchange, `launch_tickets`, master API de sessões).

Escopo declarado: o caminho **login → whitelist → launcher → update → mod sync → integridade → fila → ticket → sessão → SkyMP**. Não cobre gameplay, banco de dados de personagens nem o bot do Discord.

> **Estado do projeto, que governa toda recomendação abaixo:** ninguém nunca conectou dois clientes. A Fase 0 continua sendo o bloqueio real ([`FASE_0_ROTEIRO.md`](../technical/FASE_0_ROTEIRO.md)). Nenhum item desta auditoria entra na frente dela, e a §17 diz explicitamente o que **não** fazer agora.

---

## 1. Procedência: o que foi verificado, e como

A regra do projeto é marcar de onde vem cada afirmação. Sem isso, uma auditoria cheia parece conhecimento e é chute.

| Fonte | Profundidade | O que isso significa |
|---|---|---|
| `apps/launcher/electron/main.ts` (1225 linhas) | **Completa** — lido inteiro | Achados citam arquivo e linha |
| `apps/launcher/electron/parity.mjs`, `preload.ts` | **Completa** | Idem |
| `apps/launcher/src/pages/Home.tsx`, `Settings.tsx` | **Completa** no fluxo de jogar | Idem |
| `apps/game-api/` (server, queue, modsManifest, gerador, testes) | **Completa** | Idem |
| `apps/web/server.js` | **Parcial** — só master API, OAuth exchange e tickets | O resto do painel não foi auditado aqui |
| `skymp/packages/database/migration-v6`, `v8` | **Completa** | Idem |
| **Crows RP** | **Média** — README do repositório + `docs/MOD_SYNC_ARCHITECTURE.md` + `docs/MOD_SYNC_SECURITY.md` + listagem de `SkyrimRPLauncher.Tests/` | Sobe de "rasa" (matriz de 13/08) para "média". **Nenhum arquivo `.cs` foi lido** — as afirmações são sobre o que a documentação deles declara, não sobre o que o código faz |
| **TESV-RP / Frostfall** | **Rasa** — árvore + `OVH_DEPLOYMENT.md` | Resultado negativo relevante: ver §5.2 |
| **F02K/SkyMP-Launcher** | **Rasa** — README | Achado de licença e de formato relevante para a política de distribuição |

Isso fecha parcialmente a tarefa `RES-002` do [roadmap de adaptação](../roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md): a parte de ModSync foi aprofundada, o RBAC **não**.

---

## 2. O fluxo prometido e o fluxo que existe

O fluxo pedido:

```
Login → Whitelist → Launcher → Update → Mod Sync → Integrity → Queue → Ticket → Session → SkyMP
```

O que `Home.tsx:61-116` realmente executa quando o jogador clica em **JOGAR**:

```
getLauncherConfig → checkGamePath → ensureSkyrimIni(repairOnly)
                 → verifyMods → syncLoadorder → analyzePlugins
                 → joinQueue → [poll a cada 4 s] → launchGame
```

Duas etapas do fluxo desejado **não estão no caminho**:

- **Update** não é chamado. `checkClientUpdate`, `installClientUpdate`, `checkModsUpdate` e `installModsUpdate` existem no `main.ts` e no `preload.ts`, mas o único lugar do renderer que os invoca é a tela de Configurações (`Settings.tsx:95,113,128`). Um jogador que nunca abre Configurações joga com o cliente e o modpack que instalou no primeiro dia.
- **Repair** não existe em lugar nenhum. Não há handler, não há IPC, não há tela.

E há um terceiro problema, que é o que a §21 do briefing descreve: quando `verify-mods` reprova, `Home.tsx:84-87` escreve `Mods invalidos: <primeira mensagem>` e retorna. Não há botão, não há conserto, não há link. O jogador lê "O mod X esta modificado ou corrompido!" e não tem o que fazer dentro do launcher.

**Resumo honesto:** o launcher de hoje é um botão PLAY com uma verificação de paridade boa na frente. A verificação é o melhor pedaço do sistema e o beco sem saída é a consequência direta de ela não ter par — detecta e não conserta.

---

## 3. Achados

Severidade é sobre **o dia em que houver jogadores**, não sobre hoje. Hoje nada disso dói porque não há ninguém conectado.

### 3.1 Fluxo e interface

| ID | Achado | Evidência | Sev. |
|---|---|---|---|
| `PLAT-01` | Update fora do caminho de jogar | `Home.tsx:61-116` vs `Settings.tsx:95` | **Alta** |
| `PLAT-02` | Falha de paridade é beco sem saída: detecta e não conserta | `Home.tsx:84-87` | **Alta** |
| `PLAT-03` | "Status do Servidor: Online" é literal fixo no JSX, não consulta nada | `Home.tsx:156-160` | Média |
| `PLAT-04` | Não há máquina de estados: uma string `status` e um booleano `isPlaying` | `Home.tsx:15-16` | Média |
| `PLAT-05` | `verify-mods` devolve só a **primeira** divergência; a lista completa é descartada | `parity.mjs:113-123` | Média |

`PLAT-03` merece um parágrafo. A bolinha verde é desenhada com `backgroundColor: 'var(--success)'` e o texto "Online" é literal. Com o servidor caído, o launcher continua dizendo que está no ar, e o jogador só descobre o contrário quando a fila devolve `connection_failed`. Uma UI que afirma o que não verificou é pior que uma UI sem informação.

### 3.2 Manifesto e sincronização de mods

| ID | Achado | Evidência | Sev. |
|---|---|---|---|
| `PLAT-06` | `mods.json` não é versionado: sem `manifestVersion`, `channel` ou `build` | `modsManifest.js:20-28`, `mods.json` | **Alta** |
| `PLAT-07` | Zip slip: extração roda `tar -xf`/`Expand-Archive` direto sobre a pasta do jogo | `main.ts:506-521` | Média-alta |
| `PLAT-08` | Sem allowlist de host: `downloadToFile` exige HTTPS mas aceita qualquer host, inclusive por redirecionamento; `httpGetJson` aceita **HTTP** e redireciona pra qualquer host | `main.ts:427-431`, `455-472` | Média-alta |
| `PLAT-09` | Substituição não é atômica: sem staging, sem backup, sem quarentena | `main.ts:1127` | Média |
| `PLAT-10` | `verify-mods` lê o arquivo inteiro em memória pra hashear | `main.ts:904-908` | Média |
| `PLAT-11` | Arquivo extra em `Data/` passa: `compareMods` só percorre a lista do servidor | `parity.mjs:113-123` | Média |
| `PLAT-12` | `mods.json` publica `sourceDataDir` — o caminho da máquina de quem gerou | `generate-mods-manifest.js:179` | Baixa |
| `PLAT-27` | Manifesto **vazio é servido com 200**. A proteção que o cabeçalho do módulo promete está, na verdade, no cliente | `modsManifest.js:20-28` vs `parity.mjs:165-171` | **Alta** |

Sobre `PLAT-06`: hoje o launcher não tem como saber se entende o manifesto que recebeu. `isValidManifest` aceita qualquer objeto com `mods[]` e `loadOrder[]`. No dia em que o formato mudar, um launcher antigo lerá o manifesto novo, ignorará os campos que não conhece e **aprovará o jogador com base numa leitura parcial** — que é exatamente a classe de falha que o 503 do `/mods.json` existe pra impedir.

Sobre `PLAT-07`: o hash confere antes de extrair (isso está certo e é explícito em `main.ts:1121-1125`), mas a verificação prova que o ZIP é o ZIP esperado, não que o conteúdo dele é seguro. `tar` e `Expand-Archive` seguem `..` sem reclamar. A defesa hoje é inteiramente "o repositório de distribuição não foi comprometido". Crows trata isso como controle nomeado (`docs/MOD_SYNC_SECURITY.md`: bloqueio de `..`, caminho absoluto, symlink/junction, nome reservado e zip bomb).

Sobre `PLAT-10`: `sha256File` (`main.ts:496-504`) já usa stream. O `hashOf` de `verify-mods` usa `fs.readFileSync`. A assimetria parece acidental, e o custo é concreto: BSAs de Skyrim passam de 2 GB, e acima do limite de `Buffer` do Node isso lança uma exceção que chega ao jogador como `Mods invalidos: <mensagem de alocação>`.

Sobre `PLAT-11`: a direção que falta aqui é a mesma que `analyzePlugins` já corrigiu para plugins (`parity.mjs:199-211`). Para plugins, um extra é reprovado. Para BSA, não — e uma BSA extra pode sobrescrever assets de uma BSA legítima por precedência de carga.

Sobre `PLAT-27`, que apareceu ao escrever a matriz de teste e é o achado mais desconfortável desta auditoria: o cabeçalho de `modsManifest.js` declara, corretamente, que uma lista vazia *"passaria na verificação de paridade e deixaria qualquer modpack entrar, que é exatamente o oposto do que este arquivo existe pra impedir"*. Mas `isValidManifest({ mods: [], loadOrder: [] })` devolve **`true`** — `[].every()` é `true` — e `load()` não faz nenhuma checagem além dessa. O próprio teste registra o buraco sem fechá-lo: `modsManifest.test.js:33` se chama *"aceita manifesto vazio na forma, mas o loader trata o resto"*, e o loader não trata o resto.

O jogador **não** entra, e é importante ser exato sobre por quê: quem barra é `analyzePlugins`, que recusa `serverLoadOrder` vazia (`parity.mjs:165-171`), no **cliente**. Ou seja, a defesa contra o pior modo de falha deste subsistema está num processo que roda na máquina do jogador, enquanto o servidor responde 200 e o comentário no servidor diz que a defesa é dele. Correção: `load()` recusa `mods` ou `loadOrder` vazios, com `reason: 'manifest_empty'`, e o 503 volta a significar o que o documento diz que significa.

### 3.3 Fila, tickets e sessões

| ID | Achado | Evidência | Sev. |
|---|---|---|---|
| `PLAT-13` | Fila em memória, sessões no banco: reiniciar a `game-api` zera a ocupação sem invalidar sessão nenhuma | `queue.js:29-31` vs `game_sessions` | **Alta** |
| `PLAT-14` | `/internal/session/release` solta o slot e **não revoga a sessão**; `revoked_at` não é escrito por nenhuma linha do repositório | `server.js:301-306`, migration v8 | **Alta** |
| `PLAT-15` | Sem proteção de replay: o master resolve o mesmo token indefinidamente e só incrementa `resolve_count` | `apps/web/server.js:708-713` | Média |
| `PLAT-16` | `launch_tickets` cresce sem expurgo: uma linha por polling, a cada 4 s por jogador na fila | `server.js:282-290`, `Home.tsx:11` | Média |
| `PLAT-17` | `rateLimitBuckets` é um `Map` por IP que nunca é podado | `server.js:117-124` | Baixa |

`PLAT-13` é o mais grave dos três de fila. A `game-api` reinicia (deploy, crash, `pm2 restart`), `_admitted` volta vazio, e a capacidade recomeça do zero — enquanto todo mundo que já estava dentro continua com sessão válida por até 12 h. O servidor aceita `QUEUE_CAPACITY` jogadores novos **por cima** dos que já estão jogando. Nada acusa: `snapshot()` reporta a ocupação que a memória conhece, que é a errada.

`PLAT-14` combina mal com `PLAT-15`. Ao desconectar, o jogador libera o slot mas mantém um token de sessão que o master aceita quantas vezes quiserem, por até 12 h (`GAME_SESSION_TTL_SECONDS`). O `resolve_count` foi criado justamente pra detectar sessão compartilhada — e ninguém lê. Contar sem agir é diagnóstico, não controle.

`PLAT-16` tem número: 40 jogadores em fila por uma hora geram ~36 000 linhas em `launch_tickets`. A tabela tem índice único no hash e nenhum job de limpeza em lugar nenhum do repositório.

### 3.4 Operação

| ID | Achado | Evidência | Sev. |
|---|---|---|---|
| `PLAT-18` | Não existe `/ready`. `/health` mistura vida do processo com estado do manifesto e da fila, e **não toca o banco** | `server.js:310-319` | Média |
| `PLAT-19` | `/health` é público e devolve capacidade, ocupação, conectados e fila — e o launcher não usa | `server.js:310-319` | Média |
| `PLAT-20` | Não há como declarar manutenção | ausência | Média |
| `PLAT-21` | Não há canais: `DIST_REPO` único, URLs fixas em `releases/latest/...` e `releases/download/mods/...` | `main.ts:566-572` | Média |
| `PLAT-22` | Nenhuma pinagem reproduzível de versão (`SKYMP_COMMIT`, `HEAVY_RP_VERSION`, `MODPACK_VERSION`) | ausência | Média |
| `PLAT-23` | Nenhuma receita de deploy: sem Dockerfile, sem unit systemd, sem workflow de deploy | `git ls-files` | Baixa hoje |
| `PLAT-24` | Sem rollback | ausência | Baixa hoje |

`PLAT-18` importa mais do que parece: `/health` responde `ok` conforme o manifesto carrega, e o manifesto vem de disco. O banco — de que dependem `consumeLaunchTicket`, `isEligible` e `persistGameSession`, isto é, **a fila inteira** — nunca é testado. Um MySQL fora do ar deixa `/health` verde e todo jogador recebendo `internal_error`.

`PLAT-23` e `PLAT-24` estão marcados como baixos **hoje** de propósito. Ver §17.

### 3.5 Documentação que afirma o que o código não faz

Dois achados de [`docs/MODPACK.md`](../MODPACK.md) §"Notas". Ficam registrados aqui porque são exatamente a classe de problema que o commit `4a57a65` atacou em outro documento, e porque a política de distribuição depende de saber o que o launcher realmente faz.

| ID | Achado | Evidência | Sev. |
|---|---|---|---|
| `PLAT-25` | `MODPACK.md` afirma: *"O launcher move automaticamente para `Data\_disabledByLauncher\` qualquer mod fora da lista"*. **Não existe quarentena no código.** Nenhuma ocorrência de `_disabledByLauncher` em `apps/` | busca no repositório | **Alta** (documental) |
| `PLAT-26` | `MODPACK.md` afirma: *"O launcher detecta e bloqueia GOG e AE não-downgradeados"*. **Metade é verdade.** GOG é detectado (`main.ts:170-174`, via `Galaxy64.dll`/`goggame-*.info`); **build do Skyrim não é verificado em lugar nenhum** — não há leitura de versão do `SkyrimSE.exe` | `main.ts:164-176` | **Alta** (documental) |

Os dois têm o mesmo efeito prático: quem lê a documentação acha que existe uma barreira que não existe, e desenha o modpack contando com ela. `PLAT-26` é o pior dos dois, porque a compatibilidade "exclusivamente com Steam 1.6.1170" é a premissa de todo o resto do documento — e um jogador em AE não-downgradeado passa pelo `validateGamePath` sem nenhum aviso, para descobrir o problema como um crash de SKSE.

A correção de `PLAT-25` é escolher: ou implementar a quarentena (que a §10 desta auditoria já desenha, e que Crows também faz), ou corrigir o documento. A de `PLAT-26` é implementar a leitura de versão do executável — é barata e é justamente o tipo de checagem que a §4 do briefing quer no estado `CHECKING_MODPACK`.

---

## 4. O que já está certo

Vale registrar, porque uma auditoria que só lista defeito distorce a decisão de onde mexer.

- **Hash ausente aborta.** Tanto no cliente (`main.ts:1034-1037`) quanto por parte do modpack (`main.ts:1116-1119`). Um manifesto sem `sha256` faz o download falhar em vez de instalar sem verificar. Manifesto malformado é indistinguível de comprometido, e o código trata os dois igual.
- **Hash confere antes de extrair**, nunca depois (`main.ts:1121-1128`).
- **`/mods.json` responde 503 e nunca lista vazia** (`server.js:193-202`). Lista vazia passaria na verificação e deixaria qualquer modpack entrar.
- **Paridade bidirecional de load order**, incluindo Creation Club fora do `plugins.txt` (`parity.mjs:199-211`, `275-319`). É o pedaço mais rigoroso do sistema e não tem equivalente visível no ecossistema.
- **Ticket de uso único com rotação** e consumo atômico por `UPDATE` condicional (`server.js:153-167`). A propriedade de uso único sob concorrência está correta.
- **Só hash em repouso** para `launch_tickets` e `game_sessions`. Vazamento de banco não vira credencial.
- **Client secret do Discord fora do instalador** (`apps/web/server.js:758-822`), com allowlist de `redirect_uri`.
- **Janela de OAuth sem preload** (`main.ts:726-732`) e navegação travada na janela principal (`main.ts:84-103`). O endurecimento de IPC do Electron está feito.

---

## 5. Referências externas: classificação

Classes conforme o briefing: `ADAPT` (trazer a ideia e a forma), `REIMPLEMENT` (trazer só o conceito, escrever do zero), `IGNORE`.

> **Barreira de licença.** Crows RP **não tem licença** — todos os direitos reservados, conforme já registrado na [matriz do ecossistema](SKYMP_ECOSYSTEM_MATRIX.md). Nada de lá pode ser copiado. Tudo abaixo é conceito, e a origem fica registrada. F02K/SkyMP-Launcher é **MIT**, então dele *seria* possível reusar código com atribuição — mas é Electron/TypeScript como o nosso, o que torna a opção real e não teórica.

### 5.1 Crows RP (`LucasMagnoSP/Crows-RP`)

| Item | Classe | Motivo |
|---|---|---|
| Três canais de update independentes (`stable`/`beta`/`development`), com canal de mod separável do canal do app | **ADAPT** | Resolve `PLAT-21` e é a única forma de testar uma atualização antes de ela chegar em todo mundo. Ver §9 |
| Staging → backup → live com rollback e quarentena | **ADAPT** | Resolve `PLAT-09`. O padrão é independente de linguagem |
| Controles anti-zip-slip nomeados (`..`, caminho absoluto, symlink, nome reservado, zip bomb) | **ADAPT** | Resolve `PLAT-07`. É uma lista de verificação, não código |
| Allowlist de host do feed, com rejeição de redirecionamento pra host não autorizado | **ADAPT** | Resolve `PLAT-08` |
| SHA-256 obrigatório do ZIP **e de cada arquivo imutável** | **ADAPT** | Nós temos o primeiro, não o segundo. É o que habilita repair granular (§10) |
| `/health` e `/ready` separados | **ADAPT** | Resolve `PLAT-18` |
| `deploy/versions.env` com `SKYMP_COMMIT` e `SKYMP_BUILD_VERSION` | **ADAPT** | Resolve `PLAT-22` **e é barato hoje** — é um arquivo |
| Suíte de testes como especificação (`ModSyncTests`, `UpdateChannelTests`, `VersionCompareTests`) | **ADAPT** (como matriz, não como código) | Vira [`LAUNCHER_PLATFORM_TEST_MATRIX.md`](../testing/LAUNCHER_PLATFORM_TEST_MATRIX.md) |
| Ed25519 preparado e **não ativo** para assinar o manifesto | **REIMPLEMENT**, depois | Interessante e prematuro: assinar manifesto antes de existir modpack é cerimônia |
| Validação de DLL de plugin (x64, editor em allowlist, formato PE) sem executar | **REIMPLEMENT** | Boa ideia, escopo próprio, depende de existir modpack com DLL |
| Velopack | **IGNORE** | É o atualizador do .NET. Nosso launcher é Electron; o equivalente é `electron-updater`, e **nem esse cabe agora** (§9) |
| Launcher C#/WPF, backend Python/FastAPI, hexagonal | **IGNORE** | Portar é reescrever. Já era a conclusão da matriz de 13/08 e nada aqui a contradiz |
| Postgres/Redis só na rede Docker | **ADAPT** como princípio | Já é o que fazemos por firewall; registrar como regra explícita em `OPERATIONS.md` §5 |
| RBAC + elevação de admin + audit | **não avaliado aqui** | `RES-002` continua **parcialmente aberto** — nada de RBAC foi lido nesta rodada |

### 5.2 TESV-RP / Frostfall (`qalamabdulkhaliq/TESV-RP`)

**Resultado negativo, e ele economiza trabalho.** O repositório tem `Frostfall-Backend` e `Frostfall-Server` — **não tem launcher**. O `OVH_DEPLOYMENT.md` descreve Node instalado à mão, `npm ci`, `server-settings.json` a partir de um exemplo e "veja aparecer esta linha no log" como verificação de saúde. Sem gerenciador de processo, sem porta declarada, sem rollback.

Classe: **`IGNORE`** para tudo que se refere a launcher e deploy. O briefing pedia "estudar Crows/Frostfall" para produção; a verificação mostra que Frostfall **não é referência de produção**. A única coisa aproveitável já estava registrada: o `loadOrderGate` server-side, que é a tarefa `MOD-006` do roadmap e não pertence a esta auditoria.

### 5.3 F02K/SkyMP-Launcher

MIT, Electron/TypeScript, e com uma decisão de formato que é diretamente relevante à §9 do briefing: **o manifesto assinado deles nomeia um slug de Nexus Collection, revisão fixada, lista de plugins, load order e hashes — e exclui deliberadamente os arquivos**. A distribuição do conteúdo fica com o Nexus e com o Vortex, em sandbox; o launcher só verifica e faz hardlink a partir de um cache imutável por hash.

| Item | Classe | Motivo |
|---|---|---|
| Manifesto que carrega hash e ordem mas **não** carrega arquivo | **ADAPT** | É a resposta estrutural ao problema de redistribuição (§9). Ver [`MOD_DISTRIBUTION_POLICY.md`](../platform/MOD_DISTRIBUTION_POLICY.md) |
| Cache imutável indexado por hash + hardlink com fallback pra cópia | **ADAPT**, depois | Bom para repair e para múltiplos perfis; caro agora |
| Integração Vortex/Collections como instalador | **IGNORE** | Já decidido e registrado em [`LAUNCHER_DISTRIBUTION.md`](../technical/LAUNCHER_DISTRIBUTION.md) §5: Collection instalada "corretamente" em duas máquinas pode produzir load orders diferentes. **A decisão de não migrar continua de pé** — o que este achado muda é só a §9, sobre *distribuir bytes*, não sobre *resolver load order* |
| Directory auto-hospedado com Ed25519 e fingerprint SHA-256 fixável | **IGNORE** para nós | Resolve "descobrir servidores"; nós temos um servidor só |

---

## 6. Desenho: máquina de estados do launcher

Resolve `PLAT-04` e é pré-requisito de `PLAT-01` e `PLAT-02` — sem estados nomeados não há onde encaixar update nem repair.

```
                  ┌──────────┐
                  │ STARTING │
                  └────┬─────┘
                       ↓
              ┌─────────────────┐
              │ CHECKING_UPDATE │───falha rede──┐
              └────┬────────────┘               │
                   ↓                            │
             ┌───────────┐                      │
             │ UPDATING  │──falha hash/extração─┤
             └────┬──────┘                      │
                  ↓                             │
          ┌────────────────┐                    │
          │ AUTHENTICATING │──recusa/timeout────┤
          └────┬───────────┘                    │
               ↓                                │
       ┌───────────────────┐                    │
       │ CHECKING_MODPACK  │                    │
       └──┬──────────────┬─┘                    │
          │ ok           │ divergência          │
          ↓              ↓                      │
      ┌───────┐     ┌──────────┐                │
      │ READY │     │ REPAIRING│──irreparável───┤
      └──┬────┘←────└──────────┘                │
         ↓                                      │
    ┌────────┐                                  │
    │ QUEUED │──────────────┐                   │
    └───┬────┘              │                   │
        ↓                   │                   │
 ┌──────────────────┐       │                   │
 │ REQUESTING_TICKET│───────┤                   │
 └───┬──────────────┘       │                   │
     ↓                      ↓                   ↓
┌───────────┐          ┌────────────────────────────┐
│ LAUNCHING │          │           ERROR            │
└───────────┘          │ (código + ação + retry?)   │
                       └────────────────────────────┘
```

Regras que fazem a diferença entre isto e o `status: string` de hoje:

1. **`ERROR` nunca é terminal sem ação.** Todo estado de erro carrega três coisas: um código estável (`MODPACK_HASH_MISMATCH`, `BACKEND_UNREACHABLE`, `TICKET_EXPIRED`), uma frase para o jogador, e **qual botão aparece** — `Tentar de novo`, `Reparar`, `Abrir Configurações` ou `Copiar diagnóstico`. `PLAT-02` existe porque hoje esse terceiro campo não existe.
2. **`CHECKING_MODPACK` tem duas saídas, não uma.** A saída "divergência" vai para `REPAIRING`, não para `ERROR`. Essa aresta é a correção de `PLAT-02`.
3. **`QUEUED` é o único estado com polling.** Hoje o `setInterval` de `Home.tsx:32` roda mesmo enquanto o jogo está subindo; com estados, ele para ao sair de `QUEUED`.
4. **Nenhum estado é "carregando".** Cada um tem nome, e o nome vai para a tela. A §4 do briefing pede exatamente isso, e a razão prática é diagnóstico: "travou em `CHECKING_MODPACK`" é reportável; "travou carregando" não é.
5. **`REQUESTING_TICKET` é separado de `LAUNCHING`** porque o ticket expira. Um ticket obtido e não usado em segundos é a falha da §14, e ela precisa de um estado próprio para ser observável.

---

## 7. Desenho: manifesto de modpack v2

Resolve `PLAT-06`, `PLAT-11` e `PLAT-12`. Formato proposto:

```jsonc
{
  "manifestVersion": 2,          // inteiro; launcher que não conhece RECUSA, não ignora
  "channel": "stable",           // stable | beta | development
  "build": "2026.08.13+1",       // identidade do conjunto; é o que o servidor exige na conexão
  "generatedAt": "2026-08-13T20:00:00.000Z",
  "loadOrder": ["Skyrim.esm", "Update.esm", "..."],
  "extraFilePolicy": "reject",   // reject | warn | ignore — ver §11
  "files": [
    {
      "path": "Data/HeavyRP.esm",   // relativo à raiz do jogo, SEMPRE com barra normal
      "size": 12345678,
      "sha256": "…",
      "downloadUrl": "https://…",   // ausente = não redistribuível; ver política
      "required": true,
      "category": "plugin"          // plugin | archive | script | binary | config
    }
  ]
}
```

Diferenças que não são cosméticas:

- **`manifestVersion` é uma recusa, não um aviso.** Launcher que lê um `manifestVersion` maior que o que conhece entra em `ERROR` com código `MANIFEST_TOO_NEW` e a ação "atualizar o launcher". A alternativa — ignorar campos desconhecidos — é a que produz aprovação com base em leitura parcial.
- **`build` é o identificador que vai para o servidor.** Hoje a paridade é verificada só no cliente, e um launcher modificado pula a verificação inteira. Com `build`, o gate server-side de `MOD-006` tem o que exigir. Esta auditoria **não** implementa esse gate; só garante que o manifesto carregue o dado que ele vai precisar.
- **`path` substitui `filename`.** O formato atual só nomeia arquivos soltos em `Data/`; conteúdo de modpack vive em subpastas (`Data/SKSE/Plugins/…`, `Data/Scripts/…`). Regra de validação obrigatória, e ela é a defesa de `PLAT-07` no nível do formato:

  > `path` deve ser relativo, usar `/` como separador, e **não pode** conter `..`, começar com `/`, conter `:` (drive do Windows / ADS) nem casar com nome reservado do Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`). O launcher rejeita o manifesto inteiro se **qualquer** entrada violar — não a entrada, o manifesto. Um manifesto com uma entrada maliciosa não é um manifesto parcialmente bom.

- **`sha256` por arquivo, e não só do ZIP.** É o que habilita repair granular (§10). Continuamos aceitando MD5? **Não.** A justificativa de MD5 em `generate-mods-manifest.js:11-19` (velocidade, e o hash não é barreira criptográfica) é válida *hoje*, mas o v2 hasheia arquivo por arquivo justamente para permitir baixar só o que quebrou — e nesse ponto o hash passa a decidir qual byte substitui qual byte. Um SHA-256 por stream custa ~2× um MD5 por stream e elimina a discussão. **A migração de MD5 para SHA-256 é uma quebra de compatibilidade e por isso é `manifestVersion: 2`.**
- **`downloadUrl` opcional** é o que codifica a política de redistribuição. Ausente significa "este arquivo é verificado mas não distribuído por nós"; o launcher precisa então de instruções, não de um download. Detalhe em [`MOD_DISTRIBUTION_POLICY.md`](../platform/MOD_DISTRIBUTION_POLICY.md).
- **`extraFilePolicy` torna explícito o que hoje é acidental.** Ver §11.

### Compatibilidade

O v1 (`{ mods: [{filename, hash}], loadOrder }`) continua sendo servido enquanto houver launcher v1 em campo — o que hoje é zero, porque nunca houve distribuição. **A janela de fazer essa migração sem custo é agora**, e ela fecha no dia em que o primeiro jogador instalar o launcher.

---

## 8. Canais

`PLAT-21`. Proposta:

| Canal | Quem recebe | Regra |
|---|---|---|
| `stable` | jogadores | Só recebe o que passou por `beta` numa sessão real |
| `beta` | testadores declarados | Onde a Fase 0 acontece |
| `development` | quem desenvolve | Pode quebrar; ninguém mais aponta pra cá |

**Canal do launcher e canal do modpack são separados**, com o do modpack herdando o do launcher por padrão (é o que Crows faz, e a razão é concreta): dá para testar um modpack novo com o launcher estável, e testar um launcher novo com o modpack de produção. Sem essa separação, toda mudança de modpack exige uma versão de launcher, e o inverso também.

Implicação de formato: o `channel` está no manifesto (§7) **e** a URL do feed muda por canal. As duas coisas — a URL diz onde buscar, o campo diz o que se recebeu, e o launcher recusa quando divergem. Um manifesto de `development` servido na URL de `stable` é um erro de publicação, e é exatamente o tipo de erro que o campo pega.

---

## 9. Mod sync

O fluxo pedido pela §7 do briefing, com o que já existe marcado:

| Passo | Hoje | Falta |
|---|---|---|
| buscar manifesto | ✅ `httpGetJson` | allowlist de host (`PLAT-08`) |
| comparar com local | ⚠️ por carimbo de versão inteiro (`skymp_mods_version.txt`) | comparação por arquivo |
| hashear os obrigatórios | ⚠️ só em `verify-mods`, com MD5 e sem stream | stream + SHA-256 (`PLAT-10`) |
| baixar as diferenças | ⚠️ por *parte* de ZIP (`contentSig`), não por arquivo | granularidade de arquivo |
| arquivo temporário | ✅ `app.getPath('temp')` | — |
| verificar hash | ✅ antes de extrair, e ausência aborta | hash por arquivo extraído |
| substituição atômica | ❌ extrai direto sobre a pasta do jogo | staging → backup → live (`PLAT-09`) |
| validação final | ❌ | re-hash do que foi escrito |

**O que não muda:** nunca substituir antes de validar. Isso já está certo e não deve regredir na reescrita — é a linha `main.ts:1121-1125`.

**O que a granularidade por parte não resolve:** hoje, se um único arquivo corromper, a menor unidade de conserto é uma parte inteira do ZIP. Com hash por arquivo, a unidade é o arquivo. É a diferença entre um repair de 40 MB e um de 8 GB, e é a razão pela qual `PLAT-09` e o `sha256` por arquivo da §7 andam juntos.

---

## 10. Repair

Não existe (`PLAT-02`). Desenho:

**Detecta quatro classes:**

| Classe | Como | Ação |
|---|---|---|
| ausente | `path` do manifesto não existe no disco | baixar |
| corrompido | existe, `sha256` não confere | baixar por cima (via staging) |
| versão errada | carimbo local ≠ `build` do manifesto | sincronização normal, não repair |
| extra inesperado | arquivo em `Data/` que o manifesto não conhece | depende de `extraFilePolicy` (§11) |

**Regras:**

1. Repair **nunca apaga** — move para quarentena. É o que Crows faz e a razão é diagnóstico: um arquivo apagado não conta o que aconteceu. Quarentena com data e motivo conta.
2. Repair é **incremental por padrão** e tem um modo `--full` explícito. O `force` de hoje (`install-mods-update`, `main.ts:1074`) já é o modo full; falta o incremental.
3. Repair **não roda sozinho antes de perguntar** quando implica baixar mais que um limiar (proposta: 500 MB). Um jogador com internet limitada precisa saber antes, não depois.
4. O relatório de repair lista **todos** os arquivos, não o primeiro — a correção de `PLAT-05` no nível de dados.

---

## 11. Política de arquivo extra

`PLAT-11` e `PLAT-12`. Hoje o comportamento é inconsistente por acidente: plugin extra reprova (`parity.mjs:204-211`), arquivo extra não é sequer olhado.

Proposta — o manifesto declara, o launcher obedece:

| `extraFilePolicy` | Comportamento | Quando |
|---|---|---|
| `reject` | Qualquer arquivo em `Data/` fora do manifesto reprova | Modpack fechado, produção |
| `warn` | Reporta, não bloqueia | Fase 0 e teste, onde os testadores têm instalação própria |
| `ignore` | Só verifica o que o manifesto lista | Desenvolvimento |

**Plugins continuam sendo caso à parte, sempre `reject`**, independente da política — porque plugin extra desloca índice de load order e portanto quebra o contrato de FormID, o que nenhuma política de conveniência pode relaxar. Textura extra não desloca nada. A distinção já está implícita no gerador (`generate-mods-manifest.js:29-34`, que só hasheia plugins e BSAs); a política a torna explícita.

Isto **é uma decisão de produto pendente**, ligada ao `MOD-005` do roadmap ("decisão de produto aberta"). Esta auditoria propõe o mecanismo, não escolhe o valor padrão para produção.

---

## 12. Responsabilidades da `game-api`

A §10 do briefing pede a fronteira. Ela hoje está certa e vale registrar antes que se perca:

**Pode:** autenticação por ticket, elegibilidade/whitelist, fila, emissão de ticket de sessão, persistência de sessão, manifesto de mods, status do servidor.

**Não deve:** nada de gameplay. Nenhum estado de personagem, nenhum inventário, nenhuma economia. Esses vivem no gamemode, contra o banco, e a `game-api` não os enxerga — o que hoje é verdade e se prova pela lista de tabelas que ela toca: `launch_tickets`, `game_sessions`, `accounts`, `whitelist_applications`, `characters` (só `COUNT`).

A regra operacional: **a `game-api` decide quem entra; o gamemode decide o que acontece depois.** Um endpoint novo que precise saber o que o jogador tem no inventário está do lado errado da linha.

---

## 13. `/health` e `/ready`

`PLAT-18`, `PLAT-19`. Proposta de três endpoints com públicos diferentes:

| Endpoint | Público | Responde | Conteúdo |
|---|---|---|---|
| `GET /health` | orquestrador | 200 sempre que o processo responde | `{ ok: true, uptime, version }` |
| `GET /ready` | orquestrador | 200 só com **manifesto carregado E banco respondendo** | `{ ok, checks: { manifest, database } }` |
| `GET /status` | launcher, público | 200 | `{ state, players, capacity, queue, build, message }` |

Por que três e não dois: `/health` e `/ready` respondem a "posso mandar tráfego?" e podem ficar em `127.0.0.1`; `/status` responde a "o que mostro pro jogador?" e é público por natureza. Hoje `/health` faz os três papéis e não faz o do meio direito — não toca o banco, que é o que mais quebra.

**`/status` não expõe métrica sensível** (§12 do briefing): nada de IP, nada de `discordId`, nada de nome de conta, nada de estado interno da reserva. `players` e `queue` são contagens. `state` é um enum: `online`, `maintenance`, `starting`, `full`.

`PLAT-20` cai junto: `state: "maintenance"` mais `message` é o mecanismo, e a fonte pode ser tão simples quanto uma variável de ambiente ou a presença de um arquivo — não precisa de banco, e é melhor que não precise, porque manutenção costuma ser justamente quando o banco está fora.

---

## 14. Fila: o que testar

A §13 do briefing lista seis cenários. Estado de cobertura em `queue.test.js` (13 testes em 6 suítes, todos em memória — verificado com `node --test`):

| Cenário | Coberto | Observação |
|---|---|---|
| fila duplicada | ✅ | `join` repetido é idempotente por conta |
| múltiplas instâncias do launcher | ❌ | Não é um caso da fila, é um caso do **ticket**: dois launchers com o mesmo `auth.json` disputam o mesmo `launchTicket` de uso único. Um ganha, o outro recebe `invalid_ticket` e não sabe por quê |
| reserva expirada | ✅ | TTL de 3 min; quem conectou não perde por tempo |
| desconexão | ✅ | `release` promove o próximo |
| corrida de capacidade | ⚠️ | A fila é síncrona e monothread, então a corrida **não existe dentro dela**. A corrida real é `PLAT-13`: memória vs banco através de um restart |
| expiração de ticket | ⚠️ | Coberto no nível HTTP só pela recusa (`server.http.test.js`); o caminho feliz exige banco e segue sem teste |

A conclusão que interessa: **a fila em si está bem testada e o que falta está fora dela.** Os dois buracos reais são `PLAT-13` (persistência) e o caminho feliz de ticket, que precisa de banco. Detalhamento em [`LAUNCHER_PLATFORM_TEST_MATRIX.md`](../testing/LAUNCHER_PLATFORM_TEST_MATRIX.md).

---

## 15. Tickets e sessões

Os quatro requisitos da §14 do briefing, conferidos contra o código:

| Requisito | Estado |
|---|---|
| curta duração | ✅ 5 min (`apps/web/server.js:727`), 300 s no poll (`game-api/server.js:286`) |
| propósito único | ✅ `UPDATE` condicional com `affectedRows === 1` |
| opaco | ✅ 32 bytes de `crypto.randomBytes`, hash em repouso |
| emitido pelo servidor | ✅ só o painel emite o inicial; só a `game-api` emite os de poll |

Nada a corrigir aqui. **O problema está uma camada adiante**, em `game_sessions` (§3.3):

- `PLAT-14` — falta revogar no `release`. Correção: `/internal/session/release` escreve `revoked_at` para as sessões da conta. A coluna existe desde a v8 e nunca foi usada.
- `PLAT-15` — falta proteção de replay. A dificuldade é real e vale nomear: **sessão de jogo não pode ser de uso único**, porque o SkyMP resolve a cada conexão e um jogador que cai por crash precisa reconectar (está escrito na própria migration v8). Então a proteção não é "uma vez só", é uma das três: fixar a sessão ao IP na primeira resolução; recusar acima de um limiar de `resolve_count` em janela curta; ou revogar a anterior quando a mesma conta recebe sessão nova. **A terceira é a mais barata e a que menos quebra reconexão legítima** — e ela cai fora de graça junto com a correção de `PLAT-14`.

---

## 16. Segurança: inventário desta auditoria

Para incorporação ao [`AUTH_001_TRUST_BOUNDARY_INVENTORY.md`](../technical/AUTH_001_TRUST_BOUNDARY_INVENTORY.md).

| ID | Item | Estado |
|---|---|---|
| OAuth | Client secret fora do instalador, `redirect_uri` em allowlist, `state` verificado | ✅ correto |
| Tokens do launcher | Uso único, rotação, hash em repouso | ✅ correto |
| IPC do Electron | `contextIsolation` ligado, `nodeIntegration` desligado, janela de OAuth sem preload, `will-navigate` e `setWindowOpenHandler` travados | ✅ correto |
| URL remota | `downloadToFile` exige HTTPS | ⚠️ sem allowlist de host (`PLAT-08`) |
| Feed de update | `httpGetJson` aceita **HTTP** e segue redirecionamento pra qualquer host | ❌ `PLAT-08` |
| Path traversal (manifesto) | `compareMods` casa contra arquivos locais listados, então não há travessia por aí | ✅ hoje; o v2 com `path` **precisa** da validação da §7 |
| Zip slip | Nenhuma proteção na extração | ❌ `PLAT-07` |
| Bypass de checksum | Hash ausente aborta, hash confere antes de extrair | ✅ correto |
| Replay de sessão | Sem controle | ❌ `PLAT-15` |
| API em localhost | Callback de OAuth em `127.0.0.1:19847`, só durante o login, com `state` | ✅ correto |
| Segredos | `INTERNAL_API_SECRET` obrigatório via `requireEnv`, comparação em tempo constante; CI recusa `.env` versionado | ✅ correto |
| Credencial em linha de comando | Não fazemos (`SEC-ARG-01` já verificado em 13/08) | ✅ não estamos expostos |

---

## 17. Deploy, pinagem e rollback — e por que quase nada disto agora

A §16 do briefing diz: *"Não migrar infraestrutura apenas por estética."* Esta é a seção que leva isso a sério.

**O que fazer agora, porque é barato e ajuda a Fase 0:**

- **Fechar `PLAT-27`** — três linhas em `modsManifest.js`. É o item de melhor relação custo/gravidade da auditoria inteira, e a Fase 0 vai gerar manifestos à mão, que é exatamente quando um manifesto vazio aparece.
- **`deploy/versions.env`** com `SKYMP_COMMIT`, `HEAVY_RP_VERSION` e `MODPACK_VERSION`. É um arquivo de texto. Resolve `PLAT-22` e responde a pergunta que a Fase 0 vai fazer no primeiro problema: *"qual build era?"*. Sem isso, um bug reproduzido é um bug irreprodutível.
- **`/ready`** (`PLAT-18`) — cinco linhas, e transforma "por que todo mundo recebe `internal_error`" em uma resposta HTTP.
- **`/status`** (`PLAT-03`, `PLAT-19`, `PLAT-20`) — o launcher precisa dele para parar de mentir.

**O que não fazer agora:**

- **Docker.** Crows usa e faz sentido para eles: têm jogadores, têm runner self-hosted, têm Postgres e Redis para isolar. Nós temos uma máquina Windows, um MySQL, e zero sessões realizadas. Containerizar antes da Fase 0 acrescenta uma camada entre o desenvolvedor e o erro que ele está tentando reproduzir, e o erro que estamos tentando reproduzir é "dois clientes não se veem".
- **systemd.** É Linux; o ambiente atual é Windows com `Start-AllServices.ps1`. A migração é uma decisão de hospedagem, não de código.
- **Workflow de deploy.** Deploy automatizado para um servidor que ninguém acessa é cerimônia.
- **Rollback automático.** E aqui vale a advertência da §18 do briefing, que está certa: **nunca prometer rollback automático de migration irreversível.** Nossas migrations são `CREATE TABLE IF NOT EXISTS` e `ALTER`; um `ALTER` que remove coluna não volta sozinho. O que dá pra prometer honestamente é: *o código volta; o banco volta só se a migration daquela versão for reversível, e o registro precisa dizer quais são.*

**Ordem quando chegar a hora** (depois da Fase 0, não antes): pinagem → `/ready` → status → canais → staging/backup na instalação → só então empacotamento e deploy automatizado.

---

## 18. O que esta auditoria não faz

- **Não implementa nada.** Todos os achados estão descritos com arquivo e linha; nenhuma linha de código foi alterada.
- **Não fecha `RES-002`.** O RBAC do Crows continua sem leitura. Só a metade de ModSync foi feita.
- **Não decide o `extraFilePolicy` de produção** (§11) — é decisão de produto, ligada ao `MOD-005`.
- **Não decide o certificado de assinatura.** Continua em [`LAUNCHER_DISTRIBUTION.md`](../technical/LAUNCHER_DISTRIBUTION.md) §6.3, e continua sendo uma compra.
- **Não leu nenhum arquivo `.cs` do Crows.** As afirmações sobre eles são sobre a documentação que publicam. Onde este documento diz "Crows faz X", leia "a documentação do Crows declara X".
- **Não valida nada em sessão real.** Como todo o resto do repositório: nada disto rodou com jogadores, porque nunca houve jogadores.

---

## 19. Documentos irmãos

- [`docs/platform/MOD_DISTRIBUTION_POLICY.md`](../platform/MOD_DISTRIBUTION_POLICY.md) — o que pode e o que não pode ser redistribuído, e como o manifesto codifica isso.
- [`docs/testing/LAUNCHER_PLATFORM_TEST_MATRIX.md`](../testing/LAUNCHER_PLATFORM_TEST_MATRIX.md) — os cenários da §20 do briefing, com o que é automatizável e o que não é.
- [`docs/technical/LAUNCHER_DISTRIBUTION.md`](../technical/LAUNCHER_DISTRIBUTION.md) — o que o código faz **hoje**. Onde os dois divergirem, aquele descreve o presente e este propõe o futuro.

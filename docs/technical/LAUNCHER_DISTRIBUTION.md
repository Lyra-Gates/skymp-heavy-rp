# Distribuição e paridade de cliente pelo Launcher

Como o `apps/launcher` entrega o jogo e garante que todo jogador conectado tenha os mesmos bytes que o servidor espera. Este documento descreve **o que o código faz hoje**, e marca explicitamente o que ainda não tem servidor do outro lado.

---

## 1. Os quatro canais que o launcher usa

O launcher fala com quatro endereços diferentes. Confundi-los é a origem da maior parte da confusão sobre "de onde vem o modpack".

| Canal | Endereço | Serve pra | Existe hoje? |
|---|---|---|---|
| **Releases do GitHub** | `https://github.com/<VITE_GITHUB_DIST_REPO>/releases/...` | Baixar e atualizar o cliente SkyMP e o modpack | Depende de um repo de distribuição configurado |
| **API do servidor de jogo** | `http://<VITE_SERVER_IP>:<VITE_API_PORT>` (7758) | Paridade de mods (`/mods.json`), fila (`/api/queue/*`) | ✅ `apps/game-api` |
| **Painel web** | `<VITE_PANEL_URL>` (3001, `apps/web`) | Concluir o login do Discord, receber crash reports | ✅ |
| **Servidor de jogo** | `<VITE_SERVER_IP>:<VITE_SERVER_PORT>` (7777) | A sessão em si, via SKSE | ✅ (SkyMP) |

---

## 2. Atualização de cliente e de mods (GitHub Releases)

Dois manifestos separados, ambos em release do `VITE_GITHUB_DIST_REPO`:

- **Cliente** — `releases/latest/download/client-update.json`
  `{ clientVersion, downloadUrl, sha256, sizeBytes, notes }`
- **Modpack** — `releases/download/mods/mods-dist.json`
  `{ modsVersion, downloadUrl | parts[], sha256, contentSig, mandatory, sizeBytes }`

Regras que o código já aplica (`apps/launcher/electron/main.ts`):

- **Hash ausente aborta.** Tanto no cliente quanto em cada parte do modpack, um manifesto sem `sha256` faz o download falhar em vez de instalar sem verificação. Isso é deliberado: um manifesto malformado é indistinguível de um comprometido.
- **SHA-256 confere antes de extrair**, nunca depois.
- **Download em partes** com `contentSig` por parte, pra pular pedaços que não mudaram — o modpack é grande demais pra rebaixar inteiro a cada versão.
- **Carimbos locais** (`skymp_client_version.txt`, `skymp_mods_version.txt`, `skymp_mods_parts.json`) na pasta do jogo dizem o que está instalado sem precisar re-hashear tudo.

### Fontes de versão

Há três artefatos independentes: launcher, cliente SkyMP e modpack. A versão do launcher vem somente de `apps/launcher/package.json`; as versões exigidas do cliente e dos mods vêm dos respectivos manifestos de distribuição e são registradas nos carimbos locais. Antes de consumir um ticket da fila, o fluxo **JOGAR** compara o carimbo do cliente com `clientVersion` e falha fechado se o manifesto estiver indisponível ou houver atualização pendente. Exceção deliberada: sem `VITE_GITHUB_DIST_REPO` configurado, o gate é pulado em vez de bloquear — quem nunca configurou distribuição via GitHub Releases (dev local, fork em teste) não é punido pelo mesmo erro de quem configurou e a distribuição está fora do ar.

### UI CEF embutida e reparável

Os sete arquivos de `skymp/ui/` entram no instalador como `resources/skymp-ui`. Antes da validação de versão e antes da fila, o launcher compara SHA-256 arquivo a arquivo com `Data/Platform/UI` e copia somente os ausentes ou divergentes. Arquivos extras são preservados. **Configurações → Reparar Interface** executa a mesma operação manualmente. Um bundle interno sem `index.html` falha fechado.

## 3. Paridade em tempo de conexão — **falta o servidor**

Antes de jogar, o launcher roda dois passos:

1. **`verify-mods`** — baixa `http://<SERVER_IP>:<API_PORT>/mods.json`, no formato `{ hashAlgorithm: "sha256", mods: [{ filename, hash }], loadOrder: [...] }`, e compara o hash de cada arquivo correspondente em `Data/`. O hash SHA-256 é calculado por **stream** (`hashFileForManifest` em `electron/main.ts`), sem carregar mods grandes inteiros na memória. `compareMods` (`parity.mjs`) processa até quatro arquivos em paralelo por padrão, com concorrência limitada; manifesto sem algoritmo ou com algoritmo diferente é recusado explicitamente.
2. **`analyze-plugins`** — lê o header de cada `.esp`/`.esl`/`.esm`, confere que todo master existe localmente e aparece **antes** do dependente na ordem informada pelo servidor.

Os dois juntos é que fecham o contrato de FormID descrito em `docs/technical/MODS_AND_GAMEMODE_CONTRACT.md` seção 3: o (1) garante conteúdo igual, o (2) garante ordem igual.

Quem serve esses endpoints é o **`apps/game-api`**.

`GET /health` também é dele — devolve `{ ok, manifest, queue }`. Até 22/08/2026 não tinha consumidor: a tela inicial do launcher mostrava "Online" fixo no JSX, bolinha verde de mentira, sem chamada nenhuma por trás. `check-server-status` (IPC) consulta `/health` no carregamento da tela e a cada 15s; o botão JOGAR desabilita quando a resposta é offline.

### Gerando o `mods.json`

O manifesto não é gerado sob demanda — hashear dezenas de GB dentro de uma requisição HTTP seria lento e daria margem a servir um manifesto inconsistente enquanto alguém copia arquivos pra pasta. Gere offline, a partir da pasta `Data/` de referência do servidor:

```bash
cd apps/game-api && node scripts/generate-mods-manifest.js "D:/SteamLibrary/steamapps/common/Skyrim Special Edition/Data" --plugins-txt "%LOCALAPPDATA%/Skyrim Special Edition/plugins.txt"
```

`--plugins-txt` importa: sem ele o script infere a load order pela ordem alfabética do diretório, que **não** é a load order real do Skyrim. Serve pra teste local, mas em produção geraria um manifesto que reprova clientes corretos. O script avisa alto quando isso acontece.

Se o manifesto estiver ausente ou corrompido, `/mods.json` responde **503**, nunca uma lista vazia — lista vazia passaria na verificação de paridade do launcher e deixaria qualquer modpack entrar, que é o oposto do propósito.

### A fila

Capacidade fixa de slots (`QUEUE_CAPACITY`). Quem chega e encontra slot livre entra direto; quem não, fica numa fila FIFO e é promovido quando um slot vaga — por desconexão (o gamemode avisa em `/internal/session/release`) ou por **expiração de reserva**. A expiração é o que impede a fila de travar: sem ela, alguém que fecha o launcher depois de ser admitido seguraria o slot para sempre.

**A fila é autenticada por ticket, não por `discordId`.** `discordId` é público — mandá-lo como prova de identidade deixaria qualquer um entrar na fila no lugar de outro jogador. O ticket inicial é emitido pelo painel na troca de OAuth (seção 4), porque só o painel tem o client secret e portanto só ele pode provar que aquele Discord autenticou de fato. Cada consulta consome o ticket atual e recebe o próximo, então um ticket interceptado já está gasto quando chega em outras mãos.

## 4. Login

O launcher abre o consentimento do Discord, sobe um servidor de callback local em `127.0.0.1:19847` e recebe o `code`. **A troca do `code` por token acontece no painel web** (`POST /api/launcher/oauth/exchange` em `apps/web/server.js`), não no launcher.

O motivo é simples: tudo que é `VITE_*` é embutido no instalador em tempo de build, e o instalador é distribuído aos jogadores. Um client secret ali dentro pode ser extraído por qualquer pessoa que baixe o jogo. O launcher recebe de volta só o perfil público (`discordId`, `username`, `globalName`, `avatar`) — nem o access token, que ele não tem uso pra guardar.

O painel valida o `redirect_uri` contra uma allowlist (`LAUNCHER_REDIRECT_URIS`) pra que um `code` interceptado não possa ser trocado apontando pra um endereço de terceiro.

Junto com o perfil, o painel devolve um **`launchTicket`** (`launch_tickets`, migration v6) — de uso único, TTL de 5 min, guardado como hash SHA-256 pra que um vazamento do banco não vire credencial utilizável. É esse ticket que a fila exige.

### Sessão de launcher: ticket novo sem refazer o OAuth (22/08/2026)

O painel também devolve um **`sessionToken`** (`launcher_sessions`, migration v25) — multiuso, TTL de 30 dias, mesmo tratamento de hash SHA-256 do `launchTicket`. Resolve um buraco real: quando a fila admite direto (`status: 'success'`), o `apps/game-api` não emite `pollTicket` de reposição (só emite quando `status: 'queued'`) — então uma segunda tentativa de jogar na mesma sessão do launcher reenviava o `launchTicket` original, já consumido, e caía em `401 invalid_ticket`. A única saída antes disso era refazer o popup do Discord inteiro.

`POST /api/launcher/session/refresh-ticket` troca o `sessionToken` por um `launchTicket` novo, sem tocar no Discord. O launcher chama isso (`nextQueueTicket()` em `electron/main.ts`) antes de cada `join-queue`/`poll-queue` sempre que não há `pollTicket` fresco em memória. `POST /api/launcher/session/revoke` é chamado no logout, pra um `auth.json` roubado do disco parar de valer depois que o dono deslogou. Nenhum dos dois tokens (`launchTicket`, `sessionToken`) chega ao renderer — ficam só no `auth.json` do main process, mesmo tratamento que o `launchTicket` já tinha.

Achado ajudando um fork externo, que reportava "token error" e "preciso reiniciar o launcher toda vez que tento jogar de novo" — o restart não corrigia a causa raiz, só forçava um relogin que coincidentemente emitia um `launchTicket` novo.

**Quando mesmo a sessão está morta** (expirou, foi revogada, ou o painel recusa por qualquer motivo), `join-queue`/`poll-queue` acabam devolvendo `invalid_ticket`/`not_authenticated` de qualquer forma. Antes disso, `Home.tsx` mostrava esse código de erro cru na tela (`"Erro: invalid_ticket"`), sem indicar o que fazer. Agora esses dois casos disparam `handleSessionExpired()`: desloga localmente (`discordLogout`, que também revoga a sessão no painel) e volta pra tela de login com uma mensagem clara, em vez de deixar o jogador preso num botão JOGAR que nunca vai funcionar sem uma ação que a tela não sugeria.

### O que acontece com o ticket depois

O `launch-game` grava o ticket de sessão em `skymp_config.json` como `session`. Isso não é invenção nossa: é o campo que o servidor SkyMP lê quando `offlineMode: false`. Ele então resolve a sessão contra o master API — que passou a ser o nosso próprio painel (`ARCHITECTURE.md` 1.2.1) — e o `id` que voltar vira o `profileId` do gamemode.

É esse desvio que tira a identidade das mãos do cliente. Com `offlineMode: true`, o cliente declararia o próprio `profileId` no mesmo arquivo e o servidor acreditaria.

Cadeia completa: **Discord** → painel (`launch_tickets`) → fila (`game_sessions`) → `skymp_config.json` → servidor SkyMP → master API → `profileId`.

---

## 5. Por que não usamos o formato de Nexus Collections

Nexus Collections é o formato JSON de modlist usado pelo Vortex. Curadores de mod já conhecem a ferramenta, então a pergunta volta sempre. A resposta é que os dois resolvem problemas diferentes:

| | Nexus Collections | Nossos manifestos |
|---|---|---|
| Público | Um jogador instalando mods na própria máquina | Um servidor garantindo paridade entre clientes |
| Unidade | IDs de mod do Nexus + regras de load order (LOOT) | Arquivo + hash + URL |
| Verificação | Nenhuma — o Vortex instala, não confere se o resultado bate com o de outro jogador | Hash obrigatório; ausência aborta |
| Quem decide a versão | O curador, offline, sem coordenação com um servidor rodando | O nosso servidor, a mesma fonte de verdade da whitelist |
| Load order | Resolvida localmente por LOOT, pode variar entre máquinas | Fixa, ditada pelo servidor |

O ponto decisivo é a última linha. Uma Collection instalada "corretamente" em duas máquinas pode produzir load orders diferentes — e pelo contrato de FormID isso já é o bastante pra que o mesmo `base_id` no banco vire itens diferentes na tela de cada jogador.

**Ainda assim aproveitamos o ecossistema Nexus:** nada impede a staff usar Vortex/Collections como ferramenta de trabalho pra montar e testar a modlist antes de gerar o manifesto final — é um passo manual de conveniência, não uma integração. E a política de licenciamento (`docs/technical/LICENSE_AND_AFFILIATION_POLICY.md`) já exige verificar permissão de redistribuição mod a mod, exatamente como o Nexus exige pra Collections públicas: o processo de compliance é o mesmo, só o formato de saída muda.

**Decisão:** manter manifestos próprios. Não migrar.

---

## 6. Assinatura do instalador

**Estado: configurado e nunca executado com certificado.** O `electron-builder.json` e o workflow existem; **nenhum instalador assinado foi gerado**, porque não há certificado. O que falta é uma compra e uma decisão de quem opera o servidor — não é código.

Sem assinatura o SmartScreen mostra *"O Windows protegeu o computador"* e esconde o botão de executar atrás de "Mais informações". O launcher é a única porta de entrada do servidor, então "o jogador não instala" significa "o jogador não joga". É o item 3.3 do [QA_REPORT](QA_REPORT_2026-08.md).

### 6.1 Como está configurado

O certificado **não fica no repositório e não fica no `electron-builder.json`**. O electron-builder lê duas variáveis do ambiente por conta própria:

| Variável | O que é |
|---|---|
| `CSC_LINK` | caminho para o `.pfx` **ou** o conteúdo dele em base64 |
| `CSC_KEY_PASSWORD` | senha do `.pfx` |

O que está declarado no `electron-builder.json` é só o que não é segredo:

```json
"signtoolOptions": {
  "timeStampServer": "http://timestamp.digicert.com",
  "rfc3161TimeStampServer": "http://timestamp.digicert.com",
  "signingHashAlgorithms": ["sha256"]
}
```

**O carimbo de tempo não é detalhe.** Sem ele, todo instalador já distribuído vira "assinatura inválida" no dia em que o certificado vencer — inclusive os que os jogadores baixaram meses antes. Com carimbo, a assinatura continua válida porque o Windows consegue provar que ela foi feita enquanto o certificado valia.

> ⚠️ O `electron-builder.json` **não aceita comentário**, nem no formato `"//chave"` que o `package.json` usa neste repositório: o schema declara `additionalProperties: false` e o build falha na validação. Toda explicação de configuração de build mora aqui.

**Sem `CSC_LINK`, o build continua funcionando** e gera o instalador não assinado, com aviso no log. Isso é deliberado: contribuidor e build local não podem depender de um certificado que só quem opera o servidor tem.

### 6.2 O workflow

`.github/workflows/release-launcher.yml`, em `windows-latest` (o `signtool` é do Windows). Dispara por tag `launcher-v*` ou à mão pela aba Actions.

Ele avisa em alto e bom som se o build vai sair assinado, constrói, e então **verifica de verdade** — `Get-AuthenticodeSignature` precisa devolver `Valid` **e** um carimbo de tempo. Se havia certificado e a assinatura não colou, o job falha: um instalador não assinado saindo de um build que deveria assinar é pior que um build quebrado, porque parece que deu certo.

Os segredos esperados no repositório são `WINDOWS_CSC_LINK` e `WINDOWS_CSC_KEY_PASSWORD`.

### 6.3 O que falta, e é decisão humana

**1. Escolher e comprar o certificado.** Três caminhos, e eles não são equivalentes:

| Opção | Custo anual aproximado | SmartScreen | Observação |
|---|---|---|---|
| **OV** (Organization Validation) | US$ 200–400 | Reputação construída ao longo de downloads — **o aviso continua aparecendo no começo** | Desde 2023 exige armazenamento em token físico ou HSM, o que complica CI |
| **EV** (Extended Validation) | US$ 300–600 | Reputação **imediata** | Token físico obrigatório; assinar em CI exige HSM na nuvem |
| **Azure Trusted Signing** | ~US$ 10/mês | Reputação imediata (certificado emitido pela Microsoft) | Nasceu para este caso: sem `.pfx`, sem token, integra com CI. Exige entidade verificada com 3+ anos |

Para um servidor mantido por uma pessoa, o **Azure Trusted Signing** é o caminho que faz mais sentido — é o único dos três que não exige um token USB plugado numa máquina para assinar. O `electron-builder` 26 já o suporta por `win.azureSignOptions`, e trocar para ele significa mexer no `electron-builder.json` e nos segredos, não no workflow.

**Este documento não decide qual comprar.** A escolha depende de a pessoa ter CNPJ com a idade que a Microsoft exige, e de quanto o projeto quer gastar por ano.

**2. Confirmar o SmartScreen na mão.** Isto **não é automatizável** e não está no workflow. Reputação de SmartScreen é construída pela Microsoft ao longo de downloads reais; a única verificação possível é:

1. Baixar o instalador pelo navegador (não `curl` — o SmartScreen reage à marca de origem que o navegador grava no arquivo).
2. Numa máquina Windows limpa, que nunca viu este instalador.
3. Executar e anotar exatamente o que aparece: nada, "Mais informações", ou bloqueio.

Registre o resultado aqui quando acontecer. Enquanto esta seção não tiver esse registro, o item 3.3 do QA continua **aberto**, mesmo com o workflow verde — pela mesma razão que vale para o resto do projeto: *build verde significa que não quebrou o que já era verificado, não que funciona na mão do jogador.*

---

## 7. Empacotamento: por que os arquivos do Electron são `.mjs` (22/08/2026)

`apps/launcher/package.json` tem `"type": "module"` — o `apps/launcher/electron/main.ts` usa `import`, e `parity.mjs` é ESM de propósito (ver o próprio arquivo). Isso funciona sozinho pro `npm start` em dev (`electron .` lê `dist-electron/main.js` e o interpreta como ESM porque o `package.json` diz `"type": "module"`, e `__dirname` vira `path.dirname(fileURLToPath(import.meta.url))` no lugar do global de CommonJS — ver o comentário em `main.ts`).

**Não é suficiente pro build empacotado.** O `electron-builder` não lê o `"type"` do `package.json` real — ele lê `extraMetadata.main` do `electron-builder.json`, que sobrescreve o manifesto do app empacotado. Antes desta correção, isso apontava pra um `main.js` cujo conteúdo era ESM mas cujo nome não dizia isso pra nada dentro do processo de empacotamento/ASAR — o instalador gerado falhava ao abrir com "entry file not found", procurando o arquivo pelo nome errado dentro do arquivo empacotado.

A correção, achada e testada por um fork externo, depois verificada aqui com `npm run build` de ponta a ponta:

- `vite.config.ts`: `rollupOptions.output.entryFileNames: '[name].mjs'` no build do `main` e do `preload` — os arquivos saem como `main.mjs`/`preload.mjs`, não `main.js`/`preload.js`. O conteúdo não muda, só o nome.
- `package.json`: `"main": "dist-electron/main.mjs"`.
- `electron-builder.json`: `extraMetadata.main: "dist-electron/main.mjs"`.
- `main.ts`: `preload: path.join(__dirname, 'preload.mjs')`.

**Efeito colateral que também precisou de correção:** com o preload em `.mjs`, o sandbox padrão do Electron pra scripts de preload tinha uma aresta mal resolvida — o arquivo carregava sem erro, mas `contextBridge.exposeInMainWorld` nunca rodava, e o renderer via `window.electronAPI === undefined`. `sandbox: false` na `BrowserWindow` principal resolve. `contextIsolation` continua `true` — é essa flag que isola o preload do conteúdo da página; o sandbox é uma camada a mais especificamente sobre chamadas de sistema do próprio preload, e o preload aqui é código nosso, não conteúdo de terceiro carregado na janela.

**Tentativa de evitar o `sandbox: false` (revertida):** dava pra manter o sandbox ligado se o preload saísse em CommonJS em vez de ESM — o `.mjs` é a causa da aresta mal resolvida, não o sandbox em si. Na prática não funcionou: `vite-plugin-electron` nesta versão mira Vite 8/Rolldown e lê `build.rolldownOptions`, não `build.rollupOptions` — `format: 'cjs'` passado por `rollupOptions.output` era silenciosamente ignorado, e o arquivo saía com extensão `.cjs` mas conteúdo ESM (`import`/`export`) de verdade por dentro, o que quebraria ao carregar (pior que o estado anterior). Testado com `npm run build` e revertido antes de commitar. Se alguém quiser tentar de novo: a via certa provavelmente passa por `build.rolldownOptions` diretamente, ou por atualizar o `vite-plugin-electron` pra uma versão com suporte mais claro a isso — não foi investigado a fundo.

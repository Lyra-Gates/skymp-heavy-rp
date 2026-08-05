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
| **Servidor de jogo** | `<VITE_SERVER_IP>:<VITE_SERVER_PORT>` (7757) | A sessão em si, via SKSE | ✅ (SkyMP) |

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

## 3. Paridade em tempo de conexão — **falta o servidor**

Antes de jogar, o launcher roda dois passos:

1. **`verify-mods`** — baixa `http://<SERVER_IP>:<API_PORT>/mods.json`, no formato `{ mods: [{ filename, hash }], loadOrder: [...] }`, e compara o hash de cada arquivo correspondente em `Data/`. **Este passo usa MD5**, não SHA-256 — é uma checagem de integridade/paridade, não uma barreira criptográfica, e é diferente do SHA-256 usado no download (seção 2).
2. **`analyze-plugins`** — lê o header de cada `.esp`/`.esl`/`.esm`, confere que todo master existe localmente e aparece **antes** do dependente na ordem informada pelo servidor.

Os dois juntos é que fecham o contrato de FormID descrito em `docs/technical/MODS_AND_GAMEMODE_CONTRACT.md` seção 3: o (1) garante conteúdo igual, o (2) garante ordem igual.

Quem serve esses endpoints é o **`apps/game-api`**.

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

> ⚠️ **Ponta ainda solta:** o `launch-game` grava o ticket de sessão em `skymp_config.json`, mas o **gamemode nunca o lê** — `whitelist.js` confia no `profileId` que o cliente informa. Enquanto isso não mudar, a fila controla *quantos* entram, não *quem* entra. O `apps/game-api` já expõe `/internal/session/resolve` pro gamemode fechar esse laço.

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

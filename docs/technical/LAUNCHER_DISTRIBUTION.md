# Distribuição e paridade de cliente pelo Launcher

Como o `apps/launcher` entrega o jogo e garante que todo jogador conectado tenha os mesmos bytes que o servidor espera. Este documento descreve **o que o código faz hoje**, e marca explicitamente o que ainda não tem servidor do outro lado.

---

## 1. Os quatro canais que o launcher usa

O launcher fala com quatro endereços diferentes. Confundi-los é a origem da maior parte da confusão sobre "de onde vem o modpack".

| Canal | Endereço | Serve pra | Existe hoje? |
|---|---|---|---|
| **Releases do GitHub** | `https://github.com/<VITE_GITHUB_DIST_REPO>/releases/...` | Baixar e atualizar o cliente SkyMP e o modpack | Depende de um repo de distribuição configurado |
| **API do servidor de jogo** | `http://<VITE_SERVER_IP>:<VITE_API_PORT>` (7758) | Paridade de mods (`/mods.json`), fila (`/api/queue/*`) | ❌ **Nenhum serviço deste repositório escuta nessa porta** |
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

> ⚠️ **Nada neste repositório serve `/mods.json` nem `/api/queue/status` na porta 7758.** Hoje `verify-mods` sempre retorna *"Servidor pode estar offline"* e a fila nunca responde. Construir esse serviço é pré-requisito pra qualquer teste com mais de um jogador — está no plano de melhorias (`docs/technical/QA_REPORT_2026-08.md`).

## 4. Login

O launcher abre o consentimento do Discord, sobe um servidor de callback local em `127.0.0.1:19847` e recebe o `code`. **A troca do `code` por token acontece no painel web** (`POST /api/launcher/oauth/exchange` em `apps/web/server.js`), não no launcher.

O motivo é simples: tudo que é `VITE_*` é embutido no instalador em tempo de build, e o instalador é distribuído aos jogadores. Um client secret ali dentro pode ser extraído por qualquer pessoa que baixe o jogo. O launcher recebe de volta só o perfil público (`discordId`, `username`, `globalName`, `avatar`) — nem o access token, que ele não tem uso pra guardar.

O painel valida o `redirect_uri` contra uma allowlist (`LAUNCHER_REDIRECT_URIS`) pra que um `code` interceptado não possa ser trocado apontando pra um endereço de terceiro.

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

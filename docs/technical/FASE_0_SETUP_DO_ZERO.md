# Fase 0 — setup do zero (guia + problemas conhecidos)

***Português** · [English](FASE_0_SETUP_DO_ZERO.en.md)*

Não existe README na raiz do repo. Este documento é o roteiro completo de
onboarding, criado em 21/08/2026 depois de acompanhar ao vivo um fork externo
subindo o projeto pela primeira vez — cada item da seção de problemas
conhecidos veio de um erro real, não de suposição.

Devs humanos: siga a checklist. Agentes: os mesmos passos valem quando alguém
pedir para "subir o servidor" ou "configurar o projeto" pela primeira vez —
ver também `.agents/skills/run-server/SKILL.md`.

## 0. Pré-requisitos
- Node.js instalado
- MariaDB/MySQL rodando
- Skyrim SE/AE + SKSE, para testar o cliente depois

## 1. Dependências
Não é um monorepo com workspace único — cada app tem seu próprio
`package.json`, `npm ci` precisa rodar em cada um:
```
cd apps\web        ; npm ci
cd apps\game-api    ; npm ci
cd apps\bot-discord ; npm ci
cd apps\launcher    ; npm ci
cd skymp\gamemode   ; npm ci
```

## 2. Banco de dados
1. Criar um schema no MariaDB (ex: `skymp_rp`).
2. Rodar `skymp\packages\database\schema.sql` primeiro.
3. Rodar cada `migration-v*.sql` da mesma pasta, **em ordem numérica**:
   `schema.sql` sozinho não é o schema completo, as migrations somam por cima.
4. Conferir com `npm run check:schema` (dentro de `skymp\gamemode`) — compara
   o banco real contra o que as migrations esperam.

## 3. Arquivos `.env` — copiar todo `.env.example` para `.env`
```
apps\web\.env.example         -> apps\web\.env
apps\game-api\.env.example    -> apps\game-api\.env
apps\bot-discord\.env.example -> apps\bot-discord\.env
apps\launcher\.env.example    -> apps\launcher\.env
skymp\gamemode\.env.example   -> skymp\gamemode\.env
```
- `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASS`/`DB_NAME` idênticos em
  `apps\web\.env` e `apps\game-api\.env`, batendo com o schema do passo 2.
- Gerar cada segredo (`SESSION_SECRET`, `INTERNAL_API_SECRET`, `MASTER_KEY`,
  `SOUL_SECRET` se for usar) com:
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  Um valor por segredo, nunca reaproveitar.
- `INTERNAL_API_SECRET` precisa ser o **mesmo valor** em `apps\web`,
  `apps\game-api` e `apps\bot-discord`.

## 4. Config JSON do gamemode (não é `.env`)
Da raiz do repo:
```
.\scripts\phase0\Initialize-LocalConfig.ps1
```
Cria `skymp\config\server-settings.local.json` e
`skymp\config\server-options.local.json` a partir dos `.example` (só se ainda
não existirem).

Criar também `skymp\config\database.local.json` (copiar de
`database.local.example.json`). **Atenção**: esse nome é fixo no código
(`skymp\gamemode\database.js` lê literalmente `database.local.json`,
independente de ambiente) — não renomeie para `.production.json` esperando
que seja lido automaticamente, mesmo num servidor público de verdade.

Em `server-settings.local.json`, `masterKey` precisa ser um valor aleatório
**idêntico** ao `MASTER_KEY` de `apps\web\.env`.

## 5. Assets do Skyrim
O servidor precisa dos masters do jogo em `skymp\data\`. Não copie na mão —
use o script, que confirma o tamanho de cada arquivo copiado:
```
.\scripts\phase0\Prepare-SkyMPDataDir.ps1 -SkyrimDataPath "D:\...\Skyrim Special Edition\Data" -CopyMasters
```
Copia `Skyrim.esm`, `Update.esm`, `Dawnguard.esm`, `HearthFires.esm`,
`Dragonborn.esm`. Ver seção de troubleshooting se algum desses vier corrompido.

## 6. Binário do servidor SkyMP
Este repo não compila o servidor nativo — baixe o artefato `server-dist` do
workflow **"PR Windows Flatrim (AE/SE)"** do `skyrim-multiplayer/skymp` (ou de
uma release) e extraia em:
```
skymp\artifacts\server-dist
```
Depois, da raiz do repo:
```
.\scripts\phase0\Install-SkyMPServerArtifact.ps1
```
Deve terminar com `Installed server artifact into ...`.

## 7. Discord
- Developer Portal → aba **Bot**: token vai em `DISCORD_BOT_TOKEN` (sem
  aspas, sem espaço/quebra de linha sobrando).
- Mesma aba: ligar **"Server Members Intent"** em Privileged Gateway Intents
  — o bot pede `GuildMembers`, sem isso o login falha (e o código só mostra
  uma mensagem genérica, não o motivo real).
- "Application ID" = "Client ID" (mesmo valor) → `DISCORD_CLIENT_ID`
  (apps\web, apps\bot-discord) e `VITE_DISCORD_CLIENT_ID` (apps\launcher).

## 8. Túnel/domínio público
Em `apps\web\.env`:
- `PANEL_PUBLIC_URL=https://dominio.com,https://www.dominio.com` (sem barra
  no final de cada domínio)
- `TRUST_PROXY=true` (obrigatório atrás de qualquer proxy/túnel — sem isso o
  rate limiter enxerga o IP do túnel pra todo jogador e para de proteger
  qualquer coisa)
- `NODE_ENV=production` quando for pra valer (liga cookie `secure`)

Só o painel web precisa passar pelo túnel. O cliente Skyrim conecta direto no
servidor de jogo (porta 7777) por IP, sem passar pelo Cloudflare.

## 9. Manifesto de mods
```
cd apps\game-api
node scripts\generate-mods-manifest.js "<pasta Data do servidor>" --plugins-txt "<plugins.txt>"
```
Sem isso `/mods.json` responde 503 e nenhum jogador passa da verificação de
paridade.

## 10. Subir tudo
Da raiz do repo:
```
.\scripts\phase0\Start-AllServices.ps1
```
Sinais de sucesso no log do servidor SkyMP:
- `Using data dir`
- `[phase0] SkyMP Heavy RP gamemode loaded`
- `Server resources folder is listening on 3000`
- porta `7777` (UDP) escutando

## 11. Launcher
`apps\launcher\.env`:
- `VITE_SERVER_IP`/`VITE_SERVER_PORT` batendo com `port` de
  `server-settings.local.json` (7777 por padrão).
- `VITE_PANEL_URL` = URL do painel (pelo túnel, ou `http://127.0.0.1:3001`
  pra testar local primeiro).

---

## Problemas conhecidos e como resolver

### "Missing local settings" mesmo com o arquivo existindo
Era um bug real em `Install-SkyMPServerArtifact.ps1`: o script resolvia
caminhos relativos ao diretório de trabalho (`Resolve-Path "."`) em vez do
próprio local do script, então rodá-lo de dentro de `scripts\phase0` (ou via
"Run with PowerShell" no Explorer) apontava pro lugar errado.
**Corrigido em 21/08/2026** — o script agora se ancora em `$PSScriptRoot`,
igual o `Initialize-LocalConfig.ps1`, e funciona de qualquer diretório.

### `Error: <Arquivo>.esm doesn't have TES4 record`
O arquivo em `skymp\data\` está corrompido ou não é o plugin de verdade — todo
ESM/ESP válido começa com um registro `TES4`. As causas mais comuns em
Windows:
- **Placeholder de sync na nuvem**: se a instalação do Skyrim está sob
  OneDrive/Dropbox com "Files On-Demand", o Explorer mostra o arquivo mas ele
  pode ser um stub de 0 bytes até ser aberto — arrastar copia o stub.
  Solução: usar `Prepare-SkyMPDataDir.ps1 -CopyMasters`, que imprime o
  tamanho de cada arquivo copiado — confira contra o tamanho real (Hearthfires
  tem ~3,8–3,9 MB).
- **Mod Organizer 2**: arrastar da view virtual do MO2 em vez da pasta real
  `Skyrim Special Edition\Data` pode copiar uma junction/atalho quebrado.
  Aponte `-SkyrimDataPath` para a pasta real do jogo, não para a pasta de
  mods do MO2.

### `database.js` sempre lê `database.local.json`
Não é um bug, é intencional pelo código atual, mas contraintuitivo: mesmo em
produção o arquivo de credenciais do MariaDB do gamemode precisa se chamar
exatamente `database.local.json` — o nome está hardcoded em
`skymp\gamemode\database.js`. `database.staging.json`/`database.production.json`
existem como convenção de `.gitignore` mas não são lidos por nenhum código
hoje.

### `server-settings.json` não segue `NODE_ENV`, mas `server-options.json` segue
Dois sistemas de config diferentes, comportamento diferente:
- `server-options.<NODE_ENV>.json` (regras de gameplay) honra `NODE_ENV` de
  `skymp\gamemode\.env` de verdade.
- `server-settings.json` (porta, master, load order) não tem pipeline
  automatizado de staging/produção neste repo — `Install-SkyMPServerArtifact.ps1`
  sempre copia `server-settings.local.json`. Os arquivos `.staging.example.json`
  existem como template pra adaptar manualmente, não como algo que o boot
  escolhe sozinho.

### Bot do Discord falha ao logar sem dizer por quê
`apps\bot-discord\index.js` captura o erro de login mas não imprime
`err.message` — só mostra uma dica genérica sobre o token. Causa mais comum:
"Server Members Intent" não habilitado no Developer Portal (o bot pede
`GuildMembers`, que é privilegiado). Outras causas: aspas/espaço sobrando no
`.env`, ou token trocado por engano pelo Client Secret.

### Rate limiter "funciona" mas não protege ninguém atrás do túnel
Sem `TRUST_PROXY=true`, o Express enxerga o IP do Cloudflare Tunnel em vez do
IP do jogador — o rate limit continua respondendo normalmente, só que conta o
mundo inteiro como um único visitante.

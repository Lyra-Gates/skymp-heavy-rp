# Auditoria - app_extracted Launcher

Data: 2026-07-13

Origem analisada:

```text
C:\Users\Vinicius\Downloads\app_extracted\app_extracted
```

## Resumo

O material extraido e um launcher Electron/React buildado para SkyMP, versao `1.0.47`, com foco em autenticar via Discord, validar modpack, sincronizar load order, aplicar updates de cliente/mods, iniciar SKSE e reportar crashes.

Ele e util como referencia operacional para o nosso `apps/launcher`, mas nao deve ser copiado direto. O arquivo `electron/main.js` contem endpoints, IPs, segredo OAuth e webhook hardcoded.

## O que vale aproveitar

### Prioridade alta

1. Atualizador de cliente SkyMP
   - Baixa manifesto `client-update.json`.
   - Verifica SHA256.
   - Extrai ZIP na pasta do jogo.
   - Diferencia pacote completo de delta de codigo.
   - Mata `SkyrimPlatformCEF.exe.hidden` antes de sobrescrever arquivos.

2. Atualizador de modpack em partes
   - Usa release/tag separada para mods.
   - Suporta `manifest.parts`.
   - Usa `contentSig` por parte para pular downloads que nao mudaram.
   - Muito relevante para modpack grande, especialmente com assets/meshes/textures.

3. Verificacao e sincronizacao de load order
   - Le `Data/*.esp/*.esl/*.esm`.
   - Escreve `%LOCALAPPDATA%\Skyrim Special Edition\plugins.txt`.
   - Alinha cliente com `mods.json` do servidor.

4. Reparador de INI
   - Garante `Documents\My Games\Skyrim Special Edition\Skyrim.ini`.
   - Garante `SkyrimPrefs.ini`.
   - Forca/respeita modo borderless/windowed/fullscreen.
   - Ajuda muito no suporte a jogador.

5. Crash reporter
   - Procura `crash-*.log` em `Documents\My Games\Skyrim Special Edition\SKSE`.
   - Filtra crashes da sessao atual.
   - Envia somente arquivo truncado.
   - Deduplica crashes ja enviados.

### Prioridade media

6. Analise de plugins
   - Le header TES4 de plugin.
   - Detecta masters ausentes e ordem errada.
   - Vale integrar na aba Mods para explicar CTD antes do jogador abrir o jogo.

7. Discord Rich Presence via IPC local
   - Sem dependencia extra.
   - Atualiza presenca enquanto `SkyrimSE.exe` esta rodando.
   - Bom para acabamento, nao essencial para MVP.

8. Gate de fila com Discord
   - Fluxo `join-queue` e `poll-queue`.
   - Injeta ticket em campo custom `launcherTicket`.
   - Bom conceito, mas precisa casar com nosso backend e com o authService do cliente.

## O que nao copiar direto

- `DISCORD_CLIENT_SECRET` hardcoded.
- Webhook de crash hardcoded.
- IP e portas fixos (`serverAddress`, `server-ip`, API port).
- `webSecurity: false` sem revisao de superficie.
- `taskkill` e rotinas de remocao/quarentena sem confirmacao clara no UI.
- `quarantine-mods` deleta arquivos quando a whitelist tem tamanho plausivel; para producao, preferir mover para quarentena por padrao e exigir confirmacao para deletar.
- Assets visuais do launcher sem registro de origem/licenca.
- `node_modules` incluido na pasta extraida.

## Comparacao com nosso launcher atual

Nosso `apps/launcher` ja possui:

- Electron + React + TypeScript.
- Login Discord basico.
- Fila basica.
- Verificacao MD5 contra `mods.json`.
- Escrita de `plugins.txt`.
- Injecao de `skymp_config.json` e `skymp5-client-settings.txt`.

O app extraido adiciona principalmente:

- Auto-update do cliente.
- Auto-update do modpack.
- Delta multi-parte para mods grandes.
- Reparo de INI.
- Diagnostico de plugin/master.
- Crash report.
- Rich Presence.
- Watchdog de processo do jogo/CEF.

## Plano recomendado

1. Criar um modulo `apps/launcher/electron/config.ts`
   - Ler servidor, portas, repo de distribuicao, Discord client id e endpoints por `.env`.
   - Nunca commitar secrets.

2. Migrar primeiro o reparador de INI
   - Baixo risco.
   - Alto impacto de suporte.
   - Nao mexe em modpack nem executa download.

3. Migrar verificador de plugins/load order
   - Reusar a ideia, mas manter em TypeScript.
   - Usar nosso `SERVER_IP/API_PORT` configuravel.

4. Migrar update do cliente
   - Exigir manifesto assinado por SHA256.
   - Nunca atualizar com jogo aberto.
   - Manter progresso no renderer.

5. Migrar update de modpack em partes
   - Adaptar para nosso pipeline de publicacao.
   - Usar `contentSig` por parte.
   - Registrar `skymp_mods_parts.json`.

6. Migrar crash reporter
   - Webhook deve ficar no backend, nao no cliente.
   - Launcher envia crash para nossa API; API decide se publica no Discord.

7. Migrar fila/ticket
   - Confirmar contrato com servidor.
   - Ticket deve ser one-time, curto, validado server-side.

## Decisao

Vale aproveitar a arquitetura e algoritmos, especialmente update/modpack/INI/crash. Nao vale importar o app inteiro.

O caminho seguro e portar recurso por recurso para `apps/launcher` em TypeScript, removendo segredos, parametrizando endpoints e adicionando UI de consentimento para qualquer acao que mova/remova arquivos do jogador.

## Implementacao aplicada em 2026-07-13

O primeiro corte de migracao ficou focado no que ja encaixava no launcher atual sem importar segredos ou endpoints do app extraido.

### Ja presente/validado no launcher

- Update de cliente via manifesto, download, SHA256 e extracao.
- Update de modpack em partes com manifest/content signature.
- Reparador de `Skyrim.ini` e `SkyrimPrefs.ini`.
- Verificacao/sincronizacao de `plugins.txt`.
- Analise de plugins/masters para diagnostico de load order.
- Painel de manutencao em `apps/launcher/src/pages/Settings.tsx`.

### Novo neste corte

- Botao `Enviar Crash` no painel de manutencao do launcher.
- IPC `get-recent-crashes` e `report-recent-crashes` no processo Electron.
- Coleta local de logs recentes em:
  - `Documents\My Games\Skyrim Special Edition\SKSE`
  - `Documents\My Games\Skyrim Special Edition\SKSE\Crashlogs`
- Limite de envio:
  - ate 2 arquivos por report;
  - ate 60 KB por arquivo no launcher;
  - ate 3 arquivos/65 KB por arquivo no backend.
- Envio para API propria: `POST /api/crashes/client`.
- Nenhum webhook ou segredo de Discord fica no cliente.

### Backend de suporte

O painel web em `apps/web/server.js` agora possui:

- `POST /api/crashes/client`
  - Recebe crash reports do launcher.
  - Normaliza campos basicos (`discordId`, `username`, versao do cliente/launcher).
  - Salva JSON local em `apps/web/crash-reports/`.

- `GET /api/crashes`
  - Lista os ultimos reports para staff autenticada.
  - Nao retorna o conteudo completo do log, apenas metadados/bytes por arquivo.

A pasta `apps/web/crash-reports/` foi adicionada ao `.gitignore`.

### Configuracao operacional

O launcher usa `VITE_API_PORT` para falar com a API configurada em `SERVER_IP`.

Para testar o crash report contra o painel web atual, alinhar uma das opcoes:

1. Rodar o painel web na mesma porta esperada pelo launcher.
2. Definir `VITE_API_PORT` para o `PANEL_PORT` do painel web.
3. Mover a rota `/api/crashes/client` para a mesma API que ja serve fila/mods, caso ela seja o servico oficial do launcher.

Sem esse alinhamento de porta, o botao do launcher compila e executa, mas o envio retornara erro de conexao.

### Validacao feita

- `npx tsc --noEmit` em `apps/launcher`.
- `npx vite build` em `apps/launcher`.
- `npm run lint` em `apps/launcher`.
- `node --check server.js` em `apps/web`.
- `git diff --check` nos arquivos alterados.

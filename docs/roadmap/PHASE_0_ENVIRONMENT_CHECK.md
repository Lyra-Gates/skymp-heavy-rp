# Fase 0 - Checagem do Ambiente Local

## Resultado Atual

Data: 2026-07-11

## Ferramentas

- Git: instalado.
- Node.js: instalado (`v25.5.0`).
- npm: instalado (`11.8.0`).
- CMake: nao encontrado no PATH.
- MSBuild/Visual Studio Build Tools: nao encontrado no PATH.

## Skyrim

Instalacao valida encontrada:

```text
D:\SteamLibrary\steamapps\common\Skyrim Special Edition
```

Masters encontrados em:

```text
D:\SteamLibrary\steamapps\common\Skyrim Special Edition\Data
```

Arquivos presentes:

- `Skyrim.esm`
- `Update.esm`
- `Dawnguard.esm`
- `HearthFires.esm`
- `Dragonborn.esm`

Tambem existe uma pasta em `E:\SteamLibrary\steamapps\common\Skyrim Special Edition`, mas sem os masters oficiais no `Data`.

## SkyMP

Referencia local clonada:

```text
references/skyrim-roleplay-skymp
```

Commit inspecionado:

```text
5de4aa8 internal: bump lodash from 4.17.21 to 4.17.23 in /misc/prettier (#2633)
```

Build pronta usada para boot local:

```text
Repo: skyrim-multiplayer/skymp
Workflow: PR Windows Flatrim (AE/SE)
Run: 29137896242
Artifact: server-dist
Client Artifact: dist/client
Head SHA: dbbc6b7e4bb33f79c45387a144eaa513aa88030c
```

## Bloqueio Atual

Compilar SkyMP localmente nao e o caminho mais rapido neste momento porque CMake e MSBuild/Visual Studio Build Tools nao estao disponiveis no PATH.

Para a primeira execucao, priorizar uma build pronta do servidor SkyMP. Se isso falhar ou estiver indisponivel, instalar CMake + Visual Studio Build Tools e compilar pelo repo.

Status: build pronta `server-dist` foi baixada via GitHub Actions e inicializou localmente.

## Primeiro Boot Local

Resultado:

- Servidor iniciou.
- `dataDir` local foi reconhecido.
- Masters vanilla foram copiados para `skymp/data`.
- `data/scripts/ActiveMagicEffect.pex` foi copiado do artifact.
- Storage `file` criou `skymp/world`.
- Gamemode minimo `skymp/gamemode/phase0-basic.js` carregou.
- API `mp` estava disponivel.
- Porta UDP `127.0.0.1:7777` ficou aberta.
- UI resources ficaram ouvindo em `127.0.0.1:3000`.
- O processo foi encerrado manualmente apos 12 segundos pelo script de teste.

## Primeiro Cliente Local

Resultado:

- Artifact `dist/client` foi baixado via GitHub Actions.
- Arquivos do cliente foram instalados no Skyrim local por `scripts/phase0/Install-SkyMPClient.ps1`.
- Arquivos sobrescritos foram salvos em `skymp/client-backups/`.
- `skymp5-client-settings.txt` foi apontado para `127.0.0.1:7777`.
- Servidor foi reinstalado com `scripts/phase0/Install-SkyMPServerArtifact.ps1 -OfflineMode`.
- Cliente iniciou via `scripts/phase0/Start-SkyMPClient.ps1`.
- Servidor registrou conexao local, criacao de personagem e login:
  - `connect 1`
  - `Creating character ff000000`
  - `1 logged as 1`

Observacao critica:

- `offlineMode=true` foi usado somente para laboratorio local com `profileId`.
- `offlineMode`, hot reload e admin por senha seguem proibidos em staging/producao.

Pendencias:

- Confirmar spawn visual na janela do Skyrim.
- Confirmar segundo cliente conectado.
- Confirmar sincronizacao basica entre dois clientes.
- Confirmar versao exata do `SkyrimSE.exe` no documento final da fase.

## Proxima Acao Recomendada

1. Rodar `scripts/phase0/Initialize-LocalConfig.ps1`.
2. Rodar `scripts/phase0/Prepare-SkyMPDataDir.ps1` sem `-CopyMasters` para confirmar fontes.
3. Quando a build do servidor estiver disponivel, rodar `Prepare-SkyMPDataDir.ps1 -CopyMasters`.
4. Rodar `scripts/phase0/Install-SkyMPServerArtifact.ps1`.
5. Rodar `scripts/phase0/Start-Phase0Server.ps1 -Seconds 12`.
6. Executar teste com cliente e preencher `docs/roadmap/PHASE_0_TEST_LOG.md`.

## Fontes Publicas Checadas

- `https://skymp.net/`: informa suporte para Skyrim SE/AE `1.6.1170` na versao Steam atual e oferece instalador/instalacao manual do cliente.
- `https://github.com/skyrim-multiplayer/skymp`: repo oficial ativo, com SkyMP como mod multiplayer open-source baseado em SkyrimPlatform.
- Docs locais do repo SkyMP: `docs_running_a_server.md` informa que servidor Windows pode ser construido e ficaria em `build/dist/server`.

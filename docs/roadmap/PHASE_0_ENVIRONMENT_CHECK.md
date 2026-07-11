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

## Bloqueio Atual

Compilar SkyMP localmente nao e o caminho mais rapido neste momento porque CMake e MSBuild/Visual Studio Build Tools nao estao disponiveis no PATH.

Para a primeira execucao, priorizar uma build pronta do servidor SkyMP. Se isso falhar ou estiver indisponivel, instalar CMake + Visual Studio Build Tools e compilar pelo repo.

## Proxima Acao Recomendada

1. Rodar `scripts/phase0/Initialize-LocalConfig.ps1`.
2. Rodar `scripts/phase0/Prepare-SkyMPDataDir.ps1` sem `-CopyMasters` para confirmar fontes.
3. Quando a build do servidor estiver disponivel, rodar `Prepare-SkyMPDataDir.ps1 -CopyMasters`.
4. Copiar/ajustar `server-settings.local.json` para o local esperado pela build.
5. Executar o servidor e preencher `docs/roadmap/PHASE_0_TEST_LOG.md`.

## Fontes Publicas Checadas

- `https://skymp.net/`: informa suporte para Skyrim SE/AE `1.6.1170` na versao Steam atual e oferece instalador/instalacao manual do cliente.
- `https://github.com/skyrim-multiplayer/skymp`: repo oficial ativo, com SkyMP como mod multiplayer open-source baseado em SkyrimPlatform.
- Docs locais do repo SkyMP: `docs_running_a_server.md` informa que servidor Windows pode ser construido e ficaria em `build/dist/server`.

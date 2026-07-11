# Fase 0 - Log de Testes

Use este arquivo para registrar evidencias reais dos testes SkyMP.

## Ambiente

- Data: 2026-07-11
- Responsavel: Codex/Vinicius
- Maquina: Windows local
- Sistema operacional: Windows
- Skyrim versao: Steam SE/AE alvo 1.6.1170, a confirmar pelo executavel
- SkyMP build: GitHub Actions artifact `server-dist`
- SkyMP origem: `skyrim-multiplayer/skymp`, workflow `PR Windows Flatrim (AE/SE)`, run `29137896242`
- Commit/tag: `dbbc6b7e4bb33f79c45387a144eaa513aa88030c`
- Cliente usado:
- `databaseDriver`: `file`
- Porta principal: `7777`
- Porta UI: `3000`
- Observacoes: CMake/MSBuild nao encontrados localmente; foi usada build pronta do GitHub Actions.

## Teste 0.1 - Boot do Servidor

- Resultado esperado: servidor inicia sem erro critico.
- Resultado real: servidor inicializou, carregou `dataDir`, storage `file`, gamemode minimo e ficou vivo por 12 segundos ate ser encerrado pelo script de teste.
- Logs relevantes:
  - `Hot reload is disabled for Papyrus`
  - `Using data dir '..\data'`
  - `Using file with name '..\world'`
  - `Gamemode path is "D:\Documents\New project\skymp\gamemode\phase0-basic.js"`
  - `[phase0] SkyMP Heavy RP gamemode loaded`
  - `[phase0] mp API available`
  - UDP `127.0.0.1:7777`
  - `Server resources folder is listening on 3000`
- Status: aprovado para boot local

## Teste 0.2 - Conexao Cliente 1

- Resultado esperado: primeiro cliente conecta e spawna.
- Resultado real:
- Logs relevantes:
- Status: pendente

## Teste 0.3 - Conexao Cliente 2

- Resultado esperado: segundo cliente conecta e os dois jogadores se veem.
- Resultado real:
- Logs relevantes:
- Status: pendente

## Teste 0.4 - Sincronizacao Basica

- Movimento:
- Animacao:
- Celula/worldspace:
- Inventario:
- Equipamento:
- Status: pendente

## Teste 0.5 - Morte e Respawn

- Resultado esperado:
- Resultado real:
- Crash/dessync:
- Status: pendente

## Teste 0.6 - Persistencia

- Criar personagem:
- Mover personagem:
- Alterar inventario:
- Reiniciar servidor:
- Reconectar:
- Estado preservado:
- Status: pendente

## Teste 0.7 - Chat Local

- Canal IC local:
- Distancia:
- Celula:
- OOC:
- Logs:
- Status: pendente

## Bugs Encontrados

```text
ID:
Data:
Build:
Ambiente:
Passos:
Resultado esperado:
Resultado real:
Gravidade:
Bloqueia progresso? sim/nao
```

## Decisao da Fase 0

- Continuar:
- Corrigir antes de avancar:
- Trocar abordagem:
- Justificativa:

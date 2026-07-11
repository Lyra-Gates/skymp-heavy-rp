# SkyMP Heavy RP

Projeto de planejamento e implementacao de um servidor publico Heavy RP de Skyrim usando SkyMP.

## Comece Aqui

O projeto deve comecar pela Fase 0: validar SkyMP tecnicamente antes de construir sistemas de RP complexos.

Leia nesta ordem:

1. `SKYMP_RP_DEVELOPMENT_PLAN.md`
2. `docs/roadmap/PHASE_0_START.md`
3. `docs/roadmap/PHASE_0_TEST_LOG.md`
4. `docs/technical/SKYMP_SERVER_SETUP.md`
5. `docs/technical/PHASE_0_FILE_LAYOUT.md`
6. `docs/technical/SERVER_OPTIONS_SCHEMA.md`
7. `docs/rules/PUBLIC_RULES_LAUNCH_OUTLINE.md`

## Primeira Meta

```text
Marco 0.1 - Teste de Conexao SkyMP
- Servidor SkyMP rodando localmente
- Dois clientes conectados
- Versao do Skyrim documentada
- Portas documentadas
- Driver de persistencia escolhido para MVP
- Crash/dessync documentados
- Decisao: continuar, corrigir ou trocar abordagem
```

## Decisao Tecnica Inicial

- SkyMP atual como base tecnica.
- Red House Public apenas como laboratorio de referencia.
- Estado nativo SkyMP separado da plataforma RP.
- PostgreSQL para whitelist, staff, logs, economia RP e painel.
- MongoDB avaliado para persistencia nativa SkyMP em producao.
- Vanilla spawn seletivo no MVP.
- Admin por senha, hot reload e `offlineMode` proibidos em producao.

## Estado Atual

O repositorio contem documentos de planejamento, regras, staff e arquitetura tecnica. Ainda nao contem codigo de servidor, painel, launcher ou gamemode.

O proximo trabalho e executar a Fase 0 e registrar evidencias reais.

## Configs Iniciais

Templates seguros foram criados em `skymp/config/`.

Arquivos reais como `server-settings.local.json`, builds SkyMP, `data/`, `world/`, masters do Skyrim e secrets nao devem ser versionados.

## Scripts da Fase 0

```powershell
.\scripts\phase0\Initialize-LocalConfig.ps1
.\scripts\phase0\Prepare-SkyMPDataDir.ps1
.\scripts\phase0\Install-SkyMPServerArtifact.ps1
.\scripts\phase0\Start-Phase0Server.ps1 -Seconds 12
```

O segundo comando roda em modo seco por padrao. Use `-CopyMasters` apenas quando for preparar a pasta local real do servidor.

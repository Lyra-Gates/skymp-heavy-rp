# Layout de Arquivos da Fase 0

## Versionado

Arquivos que devem entrar no Git:

- `README.md`
- `SKYMP_RP_DEVELOPMENT_PLAN.md`
- `docs/**`
- `skymp/config/*.example.json`
- Scripts proprios sem segredo.
- Gamemode proprio quando for criado.

## Nao Versionado

Arquivos que nao devem entrar no Git:

- Build do servidor SkyMP.
- Masters oficiais do Skyrim.
- `.esm`, `.esp`, `.bsa` redistribuiveis apenas com permissao explicita.
- Pasta `data` real do servidor.
- Pasta `world` ou banco local.
- Logs grandes.
- Secrets.
- Chaves `masterKey` reais.
- Backups compactados.

## Estrutura Esperada Local

```text
skymp/
  config/
    server-settings.local.example.json
    server-settings.local.json
    server-options.local.example.json
  server/
    skymp5-server.exe
    server-settings.json
    data/
  data/
    Skyrim.esm
    Update.esm
    Dawnguard.esm
    HearthFires.esm
    Dragonborn.esm
  gamemode/
    index.js
```

## Regra

Templates entram no Git. Arquivos reais de execucao ficam locais ate termos licenca, seguranca e empacotamento definidos.

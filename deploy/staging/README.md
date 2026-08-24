# Staging reproduzível

Esta stack cobre MariaDB, painel, Game API e bot em containers. SkyMP e
launcher continuam no host Windows: o artefato pinado do servidor e o Skyrim
são nativos, portanto não pertencem ao container Linux.

## Preparação

1. Inicie o Docker Desktop.
2. Copie `.env.example` para `.env` e substitua **todos** os placeholders.
3. Confirme que `apps/game-api/mods.json` representa a `Data` do servidor.
4. No primeiro uso, execute:

```powershell
.\deploy\staging\Start-Staging.ps1 -BootstrapDatabase
```

Nos usos seguintes, não repita o bootstrap:

```powershell
.\deploy\staging\Start-Staging.ps1
```

Para iniciar também o SkyMP no host:

```powershell
.\deploy\staging\Start-Staging.ps1 -StartSkyMP
```

O painel fica em `127.0.0.1:3001`, a Game API em `127.0.0.1:7758` e MariaDB
em `127.0.0.1:3306` (portas ajustáveis no `.env`). A porta do bot não é
publicada; painel e bot conversam pela rede privada do compose.

## Verificação

```powershell
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yaml ps
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:7758/health
```

Todos os containers precisam aparecer `healthy`. A Game API permanece
`unhealthy` se o manifesto de mods estiver ausente/inválido — comportamento
fail-closed intencional.

Depois do bootstrap, configure `skymp/config/database.local.json` para a porta
publicada e rode `npm run check:schema` em `skymp/gamemode`.

## Encerramento

```powershell
.\deploy\staging\Stop-Staging.ps1
```

O volume do banco é preservado. `-RemoveVolumes` exige confirmação textual e
é destrutivo; use somente para recriar uma staging descartável.

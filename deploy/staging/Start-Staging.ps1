param(
  [switch]$BootstrapDatabase,
  [switch]$StartSkyMP
)

$ErrorActionPreference = 'Stop'
$stagingDir = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $stagingDir '..\..')).Path
$composeFile = Join-Path $stagingDir 'compose.yaml'
$envFile = Join-Path $stagingDir '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Falta deploy\staging\.env. Copie .env.example, troque todos os placeholders e rode novamente."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI nao encontrado.'
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Engine nao esta ativo. Inicie o Docker Desktop e rode novamente.'
}

$previousEnvFile = $env:STAGING_ENV_FILE
$env:STAGING_ENV_FILE = '.env'
try {
  & docker compose --env-file $envFile -f $composeFile config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'compose.yaml ou .env invalido.' }

  & docker compose --env-file $envFile -f $composeFile up -d mariadb
  if ($LASTEXITCODE -ne 0) { throw 'MariaDB de staging nao iniciou.' }

  if ($BootstrapDatabase) {
    & docker compose --env-file $envFile -f $composeFile --profile bootstrap run --rm migrate
    if ($LASTEXITCODE -ne 0) {
      throw 'Bootstrap recusado ou falhou. Ele so roda em banco vazio; nao apague o volume para esconder o erro.'
    }
  }

  & docker compose --env-file $envFile -f $composeFile up -d web game-api bot-discord
  if ($LASTEXITCODE -ne 0) { throw 'Um ou mais servicos Node nao iniciaram.' }

  & docker compose --env-file $envFile -f $composeFile ps

  if ($StartSkyMP) {
    $serverScript = Join-Path $repoRoot 'scripts\phase0\Start-Phase0Server.ps1'
    Start-Process 'powershell.exe' -ArgumentList "-ExecutionPolicy Bypass -File `"$serverScript`"" -WorkingDirectory $repoRoot -WindowStyle Normal
    Write-Host 'SkyMP iniciado no host. Confirme o health dos containers antes de abrir o launcher.' -ForegroundColor Yellow
  }
} finally {
  $env:STAGING_ENV_FILE = $previousEnvFile
}

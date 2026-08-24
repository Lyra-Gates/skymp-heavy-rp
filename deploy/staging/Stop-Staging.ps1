param([switch]$RemoveVolumes)

$ErrorActionPreference = 'Stop'
$stagingDir = $PSScriptRoot
$composeFile = Join-Path $stagingDir 'compose.yaml'
$envFile = Join-Path $stagingDir '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Falta deploy\staging\.env; ele identifica a stack que sera encerrada.'
}

$previousEnvFile = $env:STAGING_ENV_FILE
$env:STAGING_ENV_FILE = '.env'
try {
  $args = @('compose', '--env-file', $envFile, '-f', $composeFile, 'down')
  if ($RemoveVolumes) {
    Write-Warning 'RemoveVolumes apaga o banco e crash reports da stack de staging.'
    $confirmation = Read-Host "Digite REMOVER-STAGING para confirmar"
    if ($confirmation -cne 'REMOVER-STAGING') { throw 'Remocao cancelada.' }
    $args += '--volumes'
  }
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao encerrar a stack.' }
} finally {
  $env:STAGING_ENV_FILE = $previousEnvFile
}

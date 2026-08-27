param([Parameter(Mandatory = $true)][string]$BackupFile)

$ErrorActionPreference = 'Stop'
$stagingDir = $PSScriptRoot
$composeFile = Join-Path $stagingDir 'compose.yaml'
$envFile = Join-Path $stagingDir '.env'
$backupDir = Join-Path $stagingDir 'backups'

if (-not (Test-Path -LiteralPath $envFile)) { throw 'Falta deploy\staging\.env.' }
$resolvedBackupDir = (Resolve-Path -LiteralPath $backupDir).Path
$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
if (-not $resolvedBackup.StartsWith($resolvedBackupDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'O backup precisa estar dentro de deploy\staging\backups.'
}
$filename = Split-Path -Leaf $resolvedBackup
if ($filename -notmatch '^skymp-staging-\d{8}-\d{6}\.sql\.gz$') { throw 'Nome de backup invalido.' }

$checksumFile = "$resolvedBackup.sha256"
if (-not (Test-Path -LiteralPath $checksumFile)) { throw 'Arquivo .sha256 correspondente ausente.' }
$expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $expected.ToLowerInvariant()) { throw 'SHA-256 do backup nao confere.' }

$confirmation = Read-Host "Isto substitui o banco de staging. Digite RESTAURAR-STAGING"
if ($confirmation -cne 'RESTAURAR-STAGING') { throw 'Restore cancelado.' }

$values = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $parts = $line -split '=', 2
  $values[$parts[0].Trim()] = $parts[1].Trim()
}
if (-not $values.DB_ROOT_PASS) { throw 'DB_ROOT_PASS ausente no .env.' }

$previousPwd = $env:MYSQL_PWD
$previousEnvFile = $env:STAGING_ENV_FILE
$env:MYSQL_PWD = $values.DB_ROOT_PASS
$env:STAGING_ENV_FILE = '.env'
try {
  & docker compose --env-file $envFile -f $composeFile stop web game-api bot-discord
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel parar os consumidores do banco.' }

  # `gzip -dc ... | mariadb -uroot` teria o mesmo defeito do backup: `sh`
  # (dash/ash, sem pipefail) devolve o exit code do mariadb, nao do gzip. Se
  # o volume /backups estiver montado errado (arquivo nao existe no
  # container mesmo existindo no host), gzip falha e nao escreve nada, mas
  # mariadb le stdin vazio, nao executa nenhuma instrucao e sai 0 -- restore
  # "bem sucedido" que nao restaurou nada. Descomprime pra arquivo primeiro
  # e usa `&&`, que propaga o primeiro erro real corretamente.
  & docker compose --env-file $envFile -f $composeFile exec -T -e MYSQL_PWD mariadb sh -c "gzip -dc /backups/$filename > /tmp/skymp-restore.sql && mariadb -uroot < /tmp/skymp-restore.sql; ec=`$?; rm -f /tmp/skymp-restore.sql; exit `$ec"
  if ($LASTEXITCODE -ne 0) { throw 'Restore falhou; mantenha os servicos parados e investigue o dump.' }

  & docker compose --env-file $envFile -f $composeFile --profile bootstrap run --rm --entrypoint sh migrate -c "npm ci --omit=dev && npm run check:schema:env -- --strict"
  if ($LASTEXITCODE -ne 0) { throw 'Restore terminou, mas o schema restaurado diverge das migrations.' }

  & docker compose --env-file $envFile -f $composeFile up -d web game-api bot-discord
  if ($LASTEXITCODE -ne 0) { throw 'Banco restaurado, mas os servicos nao reiniciaram.' }
} finally {
  $env:MYSQL_PWD = $previousPwd
  $env:STAGING_ENV_FILE = $previousEnvFile
}

Write-Host 'Restore concluido e schema validado.' -ForegroundColor Green

$ErrorActionPreference = 'Stop'
$stagingDir = $PSScriptRoot
$composeFile = Join-Path $stagingDir 'compose.yaml'
$envFile = Join-Path $stagingDir '.env'
$backupDir = Join-Path $stagingDir 'backups'

if (-not (Test-Path -LiteralPath $envFile)) { throw 'Falta deploy\staging\.env.' }

$values = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $parts = $line -split '=', 2
  $values[$parts[0].Trim()] = $parts[1].Trim()
}
if (-not $values.DB_ROOT_PASS) { throw 'DB_ROOT_PASS ausente no .env.' }

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$filename = 'skymp-staging-{0}.sql.gz' -f (Get-Date -Format 'yyyyMMdd-HHmmss')
$previousPwd = $env:MYSQL_PWD
$previousEnvFile = $env:STAGING_ENV_FILE
$env:MYSQL_PWD = $values.DB_ROOT_PASS
$env:STAGING_ENV_FILE = '.env'
try {
  # Dump pra arquivo temporario ANTES de comprimir, e sai com o codigo do
  # mariadb-dump, nao do gzip. `dump | gzip > arquivo` teria o defeito oposto:
  # `sh` (dash/ash nas imagens oficiais, sem pipefail) devolve o exit code do
  # ULTIMO comando do pipe -- se mariadb-dump falhar no meio (lock timeout,
  # conexao caindo), gzip comprime feliz o que recebeu ate o EOF e sai 0. O
  # backup ficaria não-vazio, com SHA-256 valido, e silenciosamente truncado
  # -- so descobriria no dia de precisar restaurar de verdade.
  & docker compose --env-file $envFile -f $composeFile exec -T -e MYSQL_PWD mariadb sh -c "mariadb-dump -uroot --single-transaction --routines --events --triggers --databases skymp_rp --add-drop-database > /tmp/skymp-backup.sql; ec=`$?; gzip -c /tmp/skymp-backup.sql > /backups/$filename; rm -f /tmp/skymp-backup.sql; exit `$ec"
  if ($LASTEXITCODE -ne 0) { throw 'mariadb-dump falhou.' }
} finally {
  $env:MYSQL_PWD = $previousPwd
  $env:STAGING_ENV_FILE = $previousEnvFile
}

$backupPath = Join-Path $backupDir $filename
if (-not (Test-Path -LiteralPath $backupPath) -or (Get-Item -LiteralPath $backupPath).Length -eq 0) {
  throw 'Backup nao foi criado ou ficou vazio.'
}
$hash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$backupPath.sha256" -Value "$hash  $filename" -Encoding ascii
Write-Host "Backup criado: $backupPath" -ForegroundColor Green
Write-Host "SHA-256: $hash"

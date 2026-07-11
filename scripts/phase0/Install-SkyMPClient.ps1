param(
  [string]$ClientArtifactPath = ".\skymp\artifacts\dist\client",
  [string]$SkyrimPath = "D:\SteamLibrary\steamapps\common\Skyrim Special Edition",
  [string]$ServerIp = "127.0.0.1",
  [int]$ServerPort = 7777,
  [string]$ServerMasterKey = "local-dev-key"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ClientArtifactPath)) {
  Write-Error "Client artifact path not found: $ClientArtifactPath"
}

if (-not (Test-Path -LiteralPath $SkyrimPath)) {
  Write-Error "Skyrim path not found: $SkyrimPath"
}

$artifact = Resolve-Path -LiteralPath $ClientArtifactPath
$skyrim = Resolve-Path -LiteralPath $SkyrimPath
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path (Resolve-Path ".") "skymp\client-backups\$timestamp"
$manifestPath = Join-Path $backupRoot "manifest.txt"

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

$files = Get-ChildItem -LiteralPath $artifact -Recurse -File

foreach ($file in $files) {
  $relative = $file.FullName.Substring($artifact.Path.Length + 1)
  $target = Join-Path $skyrim $relative
  $targetDir = Split-Path -Parent $target

  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

  if (Test-Path -LiteralPath $target) {
    $backupTarget = Join-Path $backupRoot $relative
    $backupDir = Split-Path -Parent $backupTarget
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Copy-Item -LiteralPath $target -Destination $backupTarget -Force
    Add-Content -LiteralPath $manifestPath -Value "BACKUP $relative"
  } else {
    Add-Content -LiteralPath $manifestPath -Value "NEW $relative"
  }

  Copy-Item -LiteralPath $file.FullName -Destination $target -Force
}

$settingsPath = Join-Path $skyrim "Data\Platform\Plugins\skymp5-client-settings.txt"
$settings = @{
  gameData = @{
    profileId = 1
  }
  master = ""
  "server-ip" = $ServerIp
  "server-master-key" = $ServerMasterKey
  "server-port" = $ServerPort
}

$settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $settingsPath -Encoding ASCII

Write-Host "Installed SkyMP client files into $skyrim"
Write-Host "Backup: $backupRoot"
Write-Host "Settings: $settingsPath"

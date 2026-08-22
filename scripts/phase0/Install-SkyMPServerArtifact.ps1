param(
  [string]$ArtifactPath = ".\skymp\artifacts\server-dist",
  [string]$ServerPath = ".\skymp\server",
  [string]$GamemodePath = "..\gamemode\phase0-basic.js",
  [switch]$OfflineMode
)

$ErrorActionPreference = "Stop"

# Ancorado em $PSScriptRoot, nao no diretorio de trabalho: rodar este script de
# dentro de scripts/phase0 (ou via "Run with PowerShell" no Explorer, que abre
# em outro cwd) fazia os caminhos relativos abaixo apontarem pro lugar errado
# e o script falhar com "Missing local settings" mesmo com o arquivo existindo.
# Descoberto em 21/08/2026 ajudando um fork externo a subir o servidor.
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

if (-not [System.IO.Path]::IsPathRooted($ArtifactPath)) {
  $ArtifactPath = Join-Path $root $ArtifactPath
}

if (-not (Test-Path -LiteralPath $ArtifactPath)) {
  Write-Error "Artifact path not found: $ArtifactPath"
}

$server = Join-Path $root $ServerPath
$artifact = Resolve-Path -LiteralPath $ArtifactPath

if (Test-Path -LiteralPath $server) {
  Remove-Item -LiteralPath $server -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $server | Out-Null

Get-ChildItem -LiteralPath $artifact -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $server -Recurse -Force
}

$localSettings = Join-Path $root "skymp\config\server-settings.local.json"
$serverSettings = Join-Path $server "server-settings.json"

if (-not (Test-Path -LiteralPath $localSettings)) {
  Write-Error "Missing local settings. Run scripts/phase0/Initialize-LocalConfig.ps1 first."
}

$settings = Get-Content -Raw -LiteralPath $localSettings | ConvertFrom-Json
$settings.dataDir = "..\data"
$settings.loadOrder = @(
  "Skyrim.esm",
  "Update.esm",
  "Dawnguard.esm",
  "HearthFires.esm",
  "Dragonborn.esm"
)
$settings.databaseDriver = "file"
$settings.databaseName = "..\world"
$settings.gamemodePath = $GamemodePath
$settings.offlineMode = [bool]$OfflineMode
$settings.isPapyrusHotReloadEnabled = $false
$settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $serverSettings -Encoding ASCII

$scriptsDir = Join-Path $root "skymp\data\scripts"
New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null

$artifactScripts = Join-Path $artifact "data\scripts"
if (Test-Path -LiteralPath $artifactScripts) {
  Get-ChildItem -LiteralPath $artifactScripts -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $scriptsDir -Recurse -Force
  }
}

Write-Host "Installed server artifact into $server"
Write-Host "Review $serverSettings before starting."
Write-Host "offlineMode=$($settings.offlineMode)"

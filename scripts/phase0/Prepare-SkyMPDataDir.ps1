param(
  [string]$SkyrimDataPath = "D:\SteamLibrary\steamapps\common\Skyrim Special Edition\Data",
  [string]$TargetDataPath = ".\skymp\data",
  [switch]$CopyMasters
)

$ErrorActionPreference = "Stop"

$masters = @(
  "Skyrim.esm",
  "Update.esm",
  "Dawnguard.esm",
  "HearthFires.esm",
  "Dragonborn.esm"
)

$source = Resolve-Path -LiteralPath $SkyrimDataPath
$target = Join-Path (Resolve-Path ".") $TargetDataPath

New-Item -ItemType Directory -Force -Path $target | Out-Null

Write-Host "Skyrim Data: $source"
Write-Host "Target Data:  $target"
Write-Host ""

$missing = @()

foreach ($master in $masters) {
  $src = Join-Path $source $master
  $dst = Join-Path $target $master
  $item = Get-Item -LiteralPath $src -ErrorAction SilentlyContinue

  if (-not $item) {
    $missing += $master
    Write-Host "MISSING $master"
    continue
  }

  if ($CopyMasters) {
    Copy-Item -LiteralPath $src -Destination $dst -Force
    Write-Host "COPIED  $master ($($item.Length) bytes)"
  } else {
    Write-Host "FOUND   $master ($($item.Length) bytes)"
  }
}

if ($missing.Count -gt 0) {
  Write-Error "Missing required masters: $($missing -join ', ')"
}

if (-not $CopyMasters) {
  Write-Host ""
  Write-Host "Dry run only. Re-run with -CopyMasters to copy files into skymp/data."
}

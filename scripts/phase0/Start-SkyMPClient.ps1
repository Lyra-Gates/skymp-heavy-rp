param(
  [string]$SkyrimPath = "D:\SteamLibrary\steamapps\common\Skyrim Special Edition"
)

$ErrorActionPreference = "Stop"

$loader = Join-Path $SkyrimPath "skse64_loader.exe"

if (-not (Test-Path -LiteralPath $loader)) {
  Write-Error "SKSE loader not found: $loader"
}

Start-Process -FilePath $loader -WorkingDirectory $SkyrimPath
Write-Host "Started SKSE loader: $loader"

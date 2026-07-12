$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$configDir = Join-Path $rootDir "skymp\config"

$copies = @(
  @{
    Source = "server-settings.local.example.json"
    Target = "server-settings.local.json"
  },
  @{
    Source = "server-options.local.example.json"
    Target = "server-options.local.json"
  }
)

foreach ($copy in $copies) {
  $src = Join-Path $configDir $copy.Source
  $dst = Join-Path $configDir $copy.Target

  if (Test-Path -LiteralPath $dst) {
    Write-Host "EXISTS  $($copy.Target)"
    continue
  }

  Copy-Item -LiteralPath $src -Destination $dst
  Write-Host "CREATED $($copy.Target)"
}

Write-Host ""
Write-Host "Review local config files before booting the server."

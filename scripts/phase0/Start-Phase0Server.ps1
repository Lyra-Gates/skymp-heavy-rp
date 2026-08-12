param(
  [int]$Seconds = 0,
  [switch]$EnableFaunaCensus,
  [switch]$EnableCorpseProbe
)

$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$server = Join-Path $rootDir "skymp\server"
$entry = Join-Path $server "dist_back\skymp5-server.js"

if (-not (Test-Path -LiteralPath $entry)) {
  Write-Error "Server entry not found. Run scripts/phase0/Install-SkyMPServerArtifact.ps1 first."
}

Push-Location $server
try {
  if ($EnableFaunaCensus) {
    $env:ENABLE_FAUNA_CENSUS = "true"
  }
  if ($EnableCorpseProbe) {
    $env:ENABLE_CORPSE_PROBE = "true"
    Write-Warning "Corpse probe writes and restores an NPC corpse inventory. Use only in a supervised lab session."
  }

  if ($Seconds -gt 0) {
    $out = Join-Path $server "phase0-server.out.log"
    $err = Join-Path $server "phase0-server.err.log"
    Remove-Item -LiteralPath $out, $err -ErrorAction SilentlyContinue

    $process = Start-Process -FilePath "node" -ArgumentList "dist_back/skymp5-server.js" -WorkingDirectory $server -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds $Seconds

    $alive = -not $process.HasExited
    $tcpPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.Id } | Select-Object LocalAddress, LocalPort, State
    $udpPorts = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.Id } | Select-Object LocalAddress, LocalPort

    if ($alive) {
      Stop-Process -Id $process.Id -Force
    }

    Write-Host "PID=$($process.Id) AliveAfter${Seconds}s=$alive ExitCode=$($process.ExitCode)"
    Write-Host "--- TCP LISTEN PORTS ---"
    $tcpPorts | Format-Table -AutoSize
    Write-Host "--- UDP PORTS ---"
    $udpPorts | Format-Table -AutoSize
    Write-Host "--- STDOUT ---"
    Get-Content -LiteralPath $out -ErrorAction SilentlyContinue | Select-Object -Last 160
    Write-Host "--- STDERR ---"
    Get-Content -LiteralPath $err -ErrorAction SilentlyContinue
  } else {
    node dist_back/skymp5-server.js
  }
} finally {
  Pop-Location
}

# Start-AllServices.ps1
# Script de orquestração para inicializar todos os serviços do servidor simultaneamente.

$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$webEnv = Join-Path $rootDir "apps\web\.env"
$botEnv = Join-Path $rootDir "apps\bot-discord\.env"

Write-Host "Iniciando todos os servicos do SkyMP Heavy RP..." -ForegroundColor Cyan

# 1. Servidor Web (Painel / API Launcher)
if (Test-Path -LiteralPath $webEnv) {
  Write-Host "[1/3] Iniciando Painel Web (Express)..." -ForegroundColor Yellow
  Start-Process "node" -ArgumentList "server.js" -WorkingDirectory "$rootDir\apps\web" -WindowStyle Normal
} else {
  Write-Warning "[1/3] Pulando Painel Web: apps\web\.env nao encontrado."
}

# 2. Bot do Discord
if (Test-Path -LiteralPath $botEnv) {
  Write-Host "[2/3] Iniciando Bot do Discord..." -ForegroundColor Yellow
  Start-Process "node" -ArgumentList "index.js" -WorkingDirectory "$rootDir\apps\bot-discord" -WindowStyle Normal
} else {
  Write-Warning "[2/3] Pulando Bot do Discord: apps\bot-discord\.env nao encontrado."
}

# 3. Servidor Nativo SkyMP (Gamemode)
Write-Host "[3/3] Iniciando Servidor SkyMP..." -ForegroundColor Yellow
Start-Process "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$rootDir\scripts\phase0\Start-Phase0Server.ps1`"" -WorkingDirectory "$rootDir" -WindowStyle Normal

Write-Host "Orquestracao concluida. Servicos sem .env foram pulados; o servidor SkyMP foi despachado." -ForegroundColor Green
Write-Host "Para jogar, basta abrir o Launcher na pasta apps/launcher." -ForegroundColor Green

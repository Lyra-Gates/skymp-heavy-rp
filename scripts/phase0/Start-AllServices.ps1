# Start-AllServices.ps1
# Script de orquestração para inicializar todos os serviços do servidor simultaneamente.

$rootDir = (Get-Item $PSScriptRoot).Parent.Parent.FullName

Write-Host "Iniciando todos os servicos do SkyMP Heavy RP..." -ForegroundColor Cyan

# 1. Servidor Web (Painel / API Launcher)
Write-Host "[1/3] Iniciando Painel Web (Express)..." -ForegroundColor Yellow
Start-Process "node" -ArgumentList "server.js" -WorkingDirectory "$rootDir\apps\web" -WindowStyle Normal

# 2. Bot do Discord
Write-Host "[2/3] Iniciando Bot do Discord..." -ForegroundColor Yellow
Start-Process "node" -ArgumentList "index.js" -WorkingDirectory "$rootDir\apps\bot-discord" -WindowStyle Normal

# 3. Servidor Nativo SkyMP (Gamemode)
Write-Host "[3/3] Iniciando Servidor SkyMP..." -ForegroundColor Yellow
Start-Process "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File .\Start-Phase0Server.ps1" -WorkingDirectory "$rootDir\scripts\phase0" -WindowStyle Normal

Write-Host "Todos os servicos de backend foram despachados em novas janelas!" -ForegroundColor Green
Write-Host "Para jogar, basta abrir o Launcher na pasta apps/launcher." -ForegroundColor Green

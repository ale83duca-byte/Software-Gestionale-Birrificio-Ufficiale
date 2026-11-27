# Script PowerShell per il download e configurazione di Node.js Portable per Brew Panda
# Questo rende la chiavetta USB completamente autonoma e funzionante anche su PC senza Node.js installato.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$NodeDir = Join-Path $RootDir "nodejs"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "       CONFIGURATORE RUNTIME PORTATILE NODE.JS              " -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

if (Test-Path (Join-Path $NodeDir "node.exe")) {
    Write-Host "[OK] Node.js portatile e' gia' presente in: $NodeDir" -ForegroundColor Green
    exit 0
}

Write-Host "[INFO] Download di Node.js LTS Portable (Windows x64) in corso..." -ForegroundColor Cyan
Write-Host "[INFO] Questa operazione e' richiesta SOLO LA PRIMA VOLTA sulla chiavetta." -ForegroundColor Gray

# URL ufficiale Node.js LTS zip x64
$NodeVersion = "v20.18.0"
$ZipUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
$TempZip = Join-Path $RootDir "node_portable_temp.zip"

try {
    # Abilita TLS 1.2 per sicurezza di download
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    Write-Host "[DOWNLOAD] Scaricamento da $ZipUrl ..." -ForegroundColor White
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($ZipUrl, $TempZip)
    Write-Host "[OK] Download completato con successo." -ForegroundColor Green

    Write-Host "[ESTRAZIONE] Estrazione in corso..." -ForegroundColor White
    $TempExtract = Join-Path $RootDir "node_temp_extract"
    if (Test-Path $TempExtract) { Remove-Item -Path $TempExtract -Recurse -Force }
    
    Expand-Archive -Path $TempZip -DestinationPath $TempExtract -Force
    
    $ExtractedInnerFolder = Join-Path $TempExtract "node-$NodeVersion-win-x64"
    if (Test-Path $NodeDir) { Remove-Item -Path $NodeDir -Recurse -Force }
    
    Move-Item -Path $ExtractedInnerFolder -Destination $NodeDir
    
    # Pulizia file temporanei
    Remove-Item -Path $TempZip -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $TempExtract -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "[OK] Node.js portatile configurato con successo in: $NodeDir" -ForegroundColor Green
    Write-Host "[OK] La chiavetta USB e' ora al 100% autonoma su qualsiasi PC Windows!" -ForegroundColor Yellow
}
catch {
    Write-Host "[ERRORE] Impossibile scaricare Node.js automaticamente: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Se non hai connessione Internet ora, puoi scaricare manualmente lo zip di Node.js" -ForegroundColor Yellow
    Write-Host "ed estrarne il contenuto nella cartella 'nodejs' della chiavetta." -ForegroundColor Yellow
    if (Test-Path $TempZip) { Remove-Item -Path $TempZip -Force -ErrorAction SilentlyContinue }
    exit 1
}

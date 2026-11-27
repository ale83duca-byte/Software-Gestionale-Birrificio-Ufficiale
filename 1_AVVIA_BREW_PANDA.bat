@echo off
setlocal
title 🐼 Brew Panda - Avvio Applicazione
cd /d "%~dp0"
chcp 65001 >nul

cls
echo ====================================================================
echo             🐼 BREW PANDA - AVVIO APPLICAZIONE DESKTOP               
echo ====================================================================
echo.
echo Inizializzazione motore di Brew Panda in corso...
echo.

:: 1. Verifica se esiste Node.js portatile nella cartella 'nodejs' della chiavetta
if exist "%~dp0nodejs\node.exe" (
    "%~dp0nodejs\node.exe" "%~dp0launcher.cjs"
    goto :fine
)

:: 2. Verifica se esiste Node.js installato nel sistema Windows
where node >nul 2>&1
if %errorlevel% equ 0 (
    node "%~dp0launcher.cjs"
    goto :fine
)

:: 3. Se Node non e' presente ne' sul PC ne' sulla chiavetta
echo [ATTENZIONE] Node.js non e' stato rilevato nel sistema.
echo.
echo Per avviare Brew Panda su questo computer hai due possibilita':
echo  1. Installa Node.js sul PC dal sito ufficiale: https://nodejs.org
echo  2. Oppure rendi la chiavetta 100%% autonoma scaricando lo zip di Node.js
echo     ed estraendolo nella cartella 'nodejs' della chiavetta USB
echo     (vedi istruzioni in GUIDA_CHIAVETTA_USB.md).
echo.
pause
exit /b 1

:fine
if %errorlevel% neq 0 (
    echo.
    echo Si e' verificato un errore durante l'esecuzione.
    pause
)
exit /b 0

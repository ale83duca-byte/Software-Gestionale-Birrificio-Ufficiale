@echo off
title Arresto Brew Panda
cd /d "%~dp0"
chcp 65001 >nul

cls
echo ====================================================================
echo                 🐼 ARRESTO SERVER BREW PANDA                        
echo ====================================================================
echo.
echo Ricerca processi attivi sulla porta 3000...
echo.

set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    if not "%%a"=="" (
        set "FOUND=1"
        echo Chiusura processo con PID: %%a...
        taskkill /F /PID %%a >nul 2>&1
    )
)

if "%FOUND%"=="1" (
    echo.
    echo [OK] Il server di Brew Panda e' stato arrestato con successo.
    echo Ora puoi rimuovere la chiavetta USB in tutta sicurezza.
) else (
    echo.
    echo [INFO] Nessun server Brew Panda attivo trovato sulla porta 3000.
    echo.
    echo --------------------------------------------------------------------
    echo NOTA BENE:
    echo Questo file serve per SPEGNERE / CHIUDERE Brew Panda prima di
    echo rimuovere la chiavetta USB.
    echo.
    echo Se invece desideri AVVIARE l'applicazione, fai doppio clic su:
    echo --^>  1_AVVIA_BREW_PANDA.bat
    echo --------------------------------------------------------------------
)

echo.
pause
exit /b 0

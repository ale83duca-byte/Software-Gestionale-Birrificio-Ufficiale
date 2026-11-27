@echo off
setlocal enabledelayedexpansion
title Crea Collegamento Desktop - Brew Panda
cd /d "%~dp0"
chcp 65001 >nul

cls
echo ====================================================================
echo             🐼 CREAZIONE COLLEGAMENTO DESKTOP CON ICONA              
echo ====================================================================
echo.
echo Creazione del collegamento sul tuo Desktop in corso...
echo Configurazione icona ufficiale: brew_panda.ico
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$shortcutPath = Join-Path $desktop 'Brew Panda.lnk'; " ^
  "$shortcut = $ws.CreateShortcut($shortcutPath); " ^
  "$shortcut.TargetPath = '%~dp0AVVIA_BREW_PANDA.bat'; " ^
  "$shortcut.WorkingDirectory = '%~dp0'; " ^
  "$shortcut.Description = 'Brew Panda - Gestionale Birrificio'; " ^
  "$shortcut.IconLocation = '%~dp0brew_panda.ico,0'; " ^
  "$shortcut.Save(); " ^
  "if (Test-Path $shortcutPath) { exit 0 } else { exit 1 }"

if %errorlevel% equ 0 (
    start "" /b ie4uinit.exe -show >nul 2>&1
    echo [OK] Collegamento con icona ufficiale 'Brew Panda' creato con successo!
    echo.
    echo Ora trovi l'icona ufficiale del Panda direttamente sul Desktop del computer.
) else (
    echo [ERRORE] Impossibile creare il collegamento sul Desktop.
)

echo.
pause
exit /b 0

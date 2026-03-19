@echo off
title The Weight of Silence - WSL Server
color 0A

echo.
echo  ================================================
echo   THE WEIGHT OF SILENCE - Launching via WSL
echo  ================================================
echo.

:: Check WSL is available
wsl --status >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    color 0C
    echo  [ERROR] WSL is not available or not set up.
    echo  Enable it via: wsl --install
    pause
    exit /b 1
)

echo  [OK] WSL found. Launching server...
echo.
echo  ------------------------------------------------
echo   Open browser at: http://localhost:3000
echo   Close this window to stop the server
echo  ------------------------------------------------
echo.

:: Run the shell script inside WSL, pointing to the Windows directory
wsl bash /mnt/c/Users/Himanshu/Desktop/MOVIES/MOVI/run-wsl.sh

pause

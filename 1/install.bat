@echo off
title Installing Dependencies
color 0B

echo.
echo  ================================================
echo   Installing Node.js Dependencies
echo  ================================================
echo.

node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    color 0C
    echo  [ERROR] Node.js not found!
    echo  Download from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo  Node.js version:
node --version
echo  npm version:
npm --version
echo.
echo  Installing packages...
echo.

npm install

IF %ERRORLEVEL% EQU 0 (
    color 0A
    echo.
    echo  [SUCCESS] All dependencies installed!
    echo.
    echo  Next step: Run start.bat
) ELSE (
    color 0C
    echo.
    echo  [ERROR] Installation failed. Check your internet connection.
)

echo.
pause

@echo off
title The Weight of Silence - AI Thriller Server
color 0A

echo.
echo  ================================================
echo   THE WEIGHT OF SILENCE - AI Thriller Server
echo  ================================================
echo.

:: Check if Node.js is installed
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    color 0C
    echo  [ERROR] Node.js is not installed!
    echo.
    echo  Download it from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Check if .env exists
IF NOT EXIST ".env" (
    color 0E
    echo  [WARNING] .env file not found!
    echo  Copying .env.example to .env ...
    copy .env.example .env >nul
    echo.
    echo  !! OPEN .env AND ADD YOUR GROK API KEY BEFORE CONTINUING !!
    echo.
    pause
    exit /b 1
)

:: Check if node_modules exists
IF NOT EXIST "node_modules" (
    echo  [INFO] Installing dependencies...
    echo.
    npm install
    IF %ERRORLEVEL% NEQ 0 (
        color 0C
        echo.
        echo  [ERROR] npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
)

echo  [OK] Dependencies found.
echo  [OK] Starting server...
echo.
echo  ------------------------------------------------
echo   Open your browser at: http://localhost:3000
echo   Press Ctrl+C to stop the server
echo  ------------------------------------------------
echo.

:: Open browser after 2 seconds
start "" timeout /t 2 >nul && start http://localhost:3000

:: Start the server
node server.js

echo.
echo  Server stopped.
pause

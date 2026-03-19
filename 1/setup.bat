@echo off
title Setup - Add Grok API Key
color 0B

echo.
echo  ================================================
echo   SETUP - Configure Your Grok API Key
echo  ================================================
echo.
echo  Get your API key from: https://console.x.ai
echo.

set /p GROK_KEY="  Paste your Grok API key here: "

IF "%GROK_KEY%"=="" (
    color 0C
    echo.
    echo  [ERROR] No key entered. Setup cancelled.
    pause
    exit /b 1
)

echo GROK_API_KEY=%GROK_KEY%> .env
echo PORT=3000>> .env

color 0A
echo.
echo  [SUCCESS] .env file created with your API key!
echo.
echo  ------------------------------------------------
echo   Your key is saved securely in .env
echo   Never share the .env file with anyone!
echo  ------------------------------------------------
echo.
echo  Now run: start.bat
echo.
pause

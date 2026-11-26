@echo off
chcp 65001 >nul
title FrogPet Windows Build
echo ============================================
echo   FrogPet - Windows build (installer + zip)
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)
cd /d "%~dp0.."
echo [1/2] Installing dependencies...
call npm ci
if errorlevel 1 goto fail
echo [2/2] Building Windows installer...
call npm run build:win
if errorlevel 1 goto fail
echo.
echo [OK] Output files are in the dist\ folder.
echo      FrogPet Setup *.exe  = installer
echo      FrogPet-*.zip        = portable version
explorer dist
pause
exit /b 0
:fail
echo.
echo [FAILED] See the error message above.
pause
exit /b 1

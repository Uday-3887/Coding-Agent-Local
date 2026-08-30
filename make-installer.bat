@echo off
chcp 65001 >nul
title LocalForge AI — One-Click Installer Builder
color 0E

echo.
echo   ================================================================
echo     LOCALFORGE AI  —  ONE-CLICK INSTALLER BUILDER
echo     Ye script aapke liye "LocalForge AI Setup.exe" banayegi.
echo   ================================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo   [X] Node.js nahi mila! Pehle install karein: https://nodejs.org
    echo       (LTS version, phir ye script dobara chalayein.)
    pause
    exit /b 1
)

echo   [1/6] Node.js mila: & node --version
echo.

if not exist node_modules (
    echo   [2/6] Dependencies install ho rahi hain (pehli baar 2-5 min)...
    call npm install
) else (
    echo   [2/6] Dependencies pehle se installed hain.
)
echo.

if not exist node_modules\electron (
    echo   [3/6] Electron + electron-builder install ho rahe hain...
    call npm install --save-dev electron electron-builder
) else (
    echo   [3/6] Electron pehle se installed hai.
)
echo.

echo   [4/6] Web app build ho rahi hai...
call npm run build
if errorlevel 1 (
    echo   [X] Build fail ho gaya. Upar wali error dekhein.
    pause
    exit /b 1
)
echo.

echo   [5/6] Windows installer (.exe) ban raha hai...
copy package.json package.json.lf-backup >nul
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.main='desktop/main.cjs';p.author='LocalForge AI';fs.writeFileSync('package.json',JSON.stringify(p,null,2));"
call npx electron-builder --config electron-builder.yml --win nsis
set BUILD_RESULT=%errorlevel%
move /y package.json.lf-backup package.json >nul
if %BUILD_RESULT% neq 0 (
    echo   [X] Installer build fail. Internet check karein (Electron binaries download hoti hain).
    pause
    exit /b 1
)
echo.

copy /y README-INSTALLER.md dist-installer\ >nul 2>nul
echo   [6/6] HO GAYA!
echo.
echo   ================================================================
echo     Aapka installer taiyaar hai:
echo.
echo        dist-installer\LocalForge-AI-Setup-0.1.0.exe
echo.
echo     - Double-click karein  →  single-click install
echo     - Install ke baad app khud khulega
echo     - Configuration wizard automatic start hoga
echo     - Detailed guide: dist-installer\README-INSTALLER.md
echo   ================================================================
echo.
pause

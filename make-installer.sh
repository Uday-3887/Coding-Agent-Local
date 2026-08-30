#!/usr/bin/env bash
# LocalForge AI — one-click installer builder (macOS / Linux)
set -e
cd "$(dirname "$0")"

echo ""
echo "  ================================================================"
echo "    LOCALFORGE AI — ONE-CLICK INSTALLER BUILDER"
echo "  ================================================================"

command -v node >/dev/null 2>&1 || { echo "  [X] Node.js missing — install from https://nodejs.org"; exit 1; }
echo "  [1/6] Node.js found: $(node --version)"

[ -d node_modules ] || { echo "  [2/6] Installing dependencies…"; npm install; }
[ -d node_modules/electron ] || { echo "  [3/6] Installing Electron…"; npm install --save-dev electron electron-builder; }

echo "  [4/6] Building web app…"
npm run build

echo "  [5/6] Building installer…"
cp package.json package.json.lf-backup
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.main='desktop/main.cjs';fs.writeFileSync('package.json',JSON.stringify(p,null,2));"
npx electron-builder --config electron-builder.yml || { mv -f package.json.lf-backup package.json; exit 1; }
mv -f package.json.lf-backup package.json

cp -f README-INSTALLER.md dist-installer/ 2>/dev/null || true
echo "  [6/6] DONE — installer is in dist-installer/"

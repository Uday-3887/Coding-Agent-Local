# LocalForge AI — One-Click Windows Installer Guide

> **Single-click `.exe` installer** + **configuration wizard after install** + everything runs 100% local.
> Ek click mein install, install ke baad configuration wizard, sab kuch aapke laptop par.

---

## 1. Quick Start (1 minute)

| Step | Kya karein |
|---|---|
| 1 | [Node.js LTS](https://nodejs.org) install karein (ek hi baar) |
| 2 | Project folder mein **`make-installer.bat`** par **double-click** karein |
| 3 | 3–8 minute wait karein (dependencies + Electron download hoti hain) |
| 4 | `dist-installer\LocalForge-AI-Setup-0.1.0.exe` — **yahi aapka installer hai** |
| 5 | `.exe` par double-click → **single-click install** → app khud khulega → **Setup Wizard** start |

That's it. Koi manual configuration nahi — wizard khud aayega.

---

## 2. What the Installer Does

The `.exe` is a standard **NSIS one-click installer** built with `electron-builder`:

- Installs to `%LOCALAPPDATA%\Programs\LocalForge AI` (**no admin prompt** — per-user install)
- Creates **Desktop** + **Start Menu** shortcuts
- Copies this guide into the install folder
- **Automatically launches the app after install** (`runAfterFinish: true`)
- On first launch the app detects "fresh install" and opens the **5-step Setup Wizard**
- Clean uninstaller included (Start Menu → LocalForge AI → Uninstall); your projects & data are **never** deleted

### The .exe is a real Windows executable

It is produced on *your* machine by `make-installer.bat` (the sandbox/CI here cannot compile
Windows binaries). The script does everything automatically:

```
npm install                → web dependencies
npm i -D electron electron-builder
npm run build              → compiles the IDE (dist/)
npx electron-builder       → packages dist-installer/LocalForge-AI-Setup-0.1.0.exe
```

---

## 3. Configuration Wizard (install ke baad)

Install hote hi app khulta hai aur wizard ke 5 steps aate hain:

| Step | Kya hota hai |
|---|---|
| **1 · Welcome** | Platform ka intro + shortcuts |
| **2 · Ollama** | Ollama URL (default `http://localhost:11434`) + **Connect & Test** button + install instructions agar nahi mila |
| **3 · Models** | Detected Ollama models ki list — ek click mein **default model** (sab roles ke liye). Qwen Coder auto-recommended |
| **4 · Workspace** | Theme (dark/light/system), **Agent autonomy** (Ask / Normal / Auto / Plan-only), project folder, AI autocomplete on/off |
| **5 · Ready** | Summary + **Start forging** |

Wizard kabhi bhi dobara khol sakte hain: **`Ctrl+Shift+P` → "Setup Wizard"**.

### Ollama setup (agar pehle se nahi hai)

```powershell
# 1. Install from https://ollama.com
# 2. Start the server
ollama serve
# 3. Pull a coding model (Qwen Coder recommended)
ollama pull qwen2.5-coder:7b
# 4. Wizard mein "Connect" dabayein
```

> **Note:** Agar LocalForge browser se (localhost ke alawa) chala rahe hain to
> `OLLAMA_ORIGINS=* ollama serve` use karein. Desktop `.exe` mein ye zaroorat nahi.

---

## 4. Where Your Data Lives

| Cheez | Location |
|---|---|
| App config | `%APPDATA%\LocalForge AI\config.json` |
| Chats, tasks, checkpoints, settings | Browser/Electron profile (IndexedDB) — local only |
| Aapke projects | Jahan aapne rakhe hain — app sirf aapke khole hue folder ko touch karta hai |
| Logs | App ke andar: Bottom Panel → Logs |

**Kuch bhi internet par nahi jaata** — AI Ollama se local chalta hai (`localhost:11434`).
Model downloads (step 3) hi ekmaatra network use hai, wo bhi aapke control mein.

---

## 5. Manual Commands (agar script use na karna ho)

```powershell
npm install
npm install --save-dev electron electron-builder
npm run build
npx electron-builder --config electron-builder.yml --win nsis
# → dist-installer\LocalForge-AI-Setup-0.1.0.exe
```

Run without packaging (development):

```powershell
npm run build
npx electron desktop/main.cjs
```

macOS / Linux: `./make-installer.sh` (DMG / AppImage banega).

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `make-installer.bat` turant band ho jata hai | Node.js install hai? `node --version` check karein |
| Installer build fail | Internet check karein — Electron binaries (~90 MB) download hoti hain; corporate proxy mein `npm config set proxy …` |
| Windows SmartScreen warning | Installer unsigned hai (local build) → **More info → Run anyway** |
| Wizard mein "Connect nahi hua" | `ollama serve` chal raha hai? URL sahi hai? `http://localhost:11434` |
| Ollama models khali | `ollama pull qwen2.5-coder:7b` chalayein, phir wizard mein Refresh |
| App blank khulta hai | `dist/` folder bana hai? Pehle `npm run build` |
| Uninstall ke baad data | Projects safe rehte hain; app data `%APPDATA%\LocalForge AI` mein hai |

---

## 7. Security Design (short)

- File operations sirf khole hue workspace tak limited (path traversal blocked)
- `.env`, `*.pem`, `*.key` AI context mein **mask** hote hain
- Dangerous commands (`rm -rf`, force push) hamesha explicit confirmation maangte hain
- `git push` kabhi automatic nahi
- Har AI file edit = snapshot → **diff review** → accept/reject; task-level undo
- Koi telemetry nahi, koi cloud API nahi — core kaam ke liye internet zaroori nahi

---

## हिंदी में पूरी गाइड

### इंस्टॉलेशन (एक क्लिक)
1. **Node.js LTS** इंस्टॉल करें → https://nodejs.org (सिर्फ पहली बार)
2. प्रोजेक्ट फोल्डर में `make-installer.bat` पर **डबल-क्लिक** करें
3. स्क्रिप्ट अपने-आप सब कुछ करेगी — dependencies, build, और `.exe` बनाना
4. `dist-installer` फोल्डर में **`LocalForge-AI-Setup-0.1.0.exe`** मिलेगा
5. उस `.exe` पर डबल-क्लिक करें → **एक ही क्लिक में इंस्टॉल** हो जाएगा
6. इंस्टॉल के तुरंत बाद ऐप खुलेगा और **कॉन्फ़िगरेशन विज़ार्ड** आएगा

### कॉन्फ़िगरेशन विज़ार्ड (5 स्टेप)
1. **Welcome** — परिचय
2. **Ollama** — URL डालें और Connect दबाएँ। Ollama नहीं है तो वहीं निर्देश दिए गए हैं (ollama.com से इंस्टॉल → `ollama serve` → `ollama pull qwen2.5-coder:7b`)
3. **Models** — मिले हुए मॉडलों में से डिफ़ॉल्ट मॉडल चुनें (Qwen Coder की सलाह दी जाती है)
4. **Workspace** — थीम, एजेंट ऑटोनॉमी (कितनी आज़ादी AI को दें), प्रोजेक्ट फोल्डर, ऑटोकम्पलीट
5. **Ready** — सारांश देखें और **Start forging** दबाएँ

विज़ार्ड बाद में भी खोल सकते हैं: `Ctrl+Shift+P` → **Setup Wizard**

### डेटा कहाँ रहता है
- ऐप की सेटिंग: `%APPDATA%\LocalForge AI\config.json`
- चैट/टास्क/चेकपॉइंट: लोकल IndexedDB — कुछ भी क्लाउड पर नहीं
- आपके प्रोजेक्ट: आपके फोल्डर में — ऐप सिर्फ वही फोल्डर छूता है जो आप खोलते हैं

### सुरक्षा
- AI की हर फाइल-एडिट पहले **diff** में दिखती है — Accept/Reject आपका है
- खतरनाक कमांड पर हमेशा पुष्टि मांगी जाती है; `git push` कभी अपने-आप नहीं
- `.env` जैसी सीक्रेट फाइलें AI को कभी नहीं भेजी जातीं
- कोई telemetry नहीं, कोई इंटरनेट अनिवार्यता नहीं

### समस्या आए तो
- स्क्रिप्ट बंद हो जाए → Node.js है या नहीं देखें (`node --version`)
- "Connect नहीं हुआ" → `ollama serve` चल रहा है?
- SmartScreen रोके → **More info → Run anyway** (लोकल बिल्ड unsigned होता है)
- मॉडल खाली दिखे → `ollama pull qwen2.5-coder:7b` चलाकर Refresh दबाएँ

**बस इतना ही — `make-installer.bat` → `.exe` → एक क्लिक इंस्टॉल → विज़ार्ड। Happy forging!**

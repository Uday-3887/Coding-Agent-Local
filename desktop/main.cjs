/**
 * LocalForge AI — Electron main process (desktop target).
 *  - Single-window IDE shell loading the built renderer (dist/).
 *  - First-run detection: on the very first launch after install the app opens
 *    with ?setup=1 so the configuration wizard appears immediately.
 *  - Config lives in %APPDATA%/LocalForge AI/config.json (no cloud, ever).
 */
const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const CONFIG_DIR = path.join(app.getPath("userData"));
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return { firstRunDone: false, ollamaUrl: "http://localhost:11434", createdAt: Date.now() };
  }
}

function writeConfig(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    return true;
  } catch {
    return false;
  }
}

let mainWindow = null;

function createWindow() {
  const cfg = readConfig();
  const firstRun = !cfg.firstRunDone;

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: "#0b0e14",
    show: false,
    autoHideMenuBar: true,
    title: "LocalForge AI",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const renderer = path.join(__dirname, "..", "dist", "index.html");
  const query = firstRun ? "?setup=1" : "";
  void mainWindow.loadFile(renderer, { search: query.replace("?", "") });

  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());

  // External links (ollama.com etc.) open in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

/* ── IPC: tiny, explicit surface ── */
ipcMain.handle("lf:get-config", () => readConfig());
ipcMain.handle("lf:save-config", (_e, patch) => {
  const cfg = { ...readConfig(), ...patch, firstRunDone: true };
  return writeConfig(cfg);
});
ipcMain.handle("lf:pick-folder", async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return res.canceled ? null : res.filePaths[0] ?? null;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

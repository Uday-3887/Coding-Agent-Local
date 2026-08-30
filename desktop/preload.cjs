/** Minimal, explicit preload bridge — contextIsolation stays on. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localforge", {
  getConfig: () => ipcRenderer.invoke("lf:get-config"),
  saveConfig: (patch) => ipcRenderer.invoke("lf:save-config", patch),
  pickFolder: () => ipcRenderer.invoke("lf:pick-folder"),
});

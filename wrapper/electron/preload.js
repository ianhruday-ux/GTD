// W6 — the narrow bridge. Mirrors how the Android shell exposes
// window.Capacitor.Plugins.* to the WebView: a small, explicit surface
// rather than nodeIntegration:true, so the renderer (the exact same
// dist/index.html a browser tab runs) never gets raw fs/child_process
// access. src/desktopTransport.js is the one module in the web app that
// touches window.__oelaDesktopBridge, the same way dropboxTransport.js is
// the one module that touches window.Capacitor.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__oelaDesktopBridge", {
  isElectron: true,
  detectDropboxFolder: () => ipcRenderer.invoke("desktop-detect-dropbox"),
  pickFolder: () => ipcRenderer.invoke("desktop-pick-folder"),
  readSyncFile: (root) => ipcRenderer.invoke("desktop-read-sync-file", root),
  writeSyncFile: (root, content) => ipcRenderer.invoke("desktop-write-sync-file", root, content),
  // The freshness fix: watchSyncFile arms a main-process fs.watch on the
  // synced file's folder; onSyncFileChanged is how the renderer learns
  // Dropbox delivered something without this app's own triggers (open,
  // resume, backgrounding, the manual button) ever firing.
  watchSyncFile: (root) => ipcRenderer.invoke("desktop-watch-sync-file", root),
  onSyncFileChanged: (callback) => ipcRenderer.on("desktop-sync-file-changed", () => callback())
});

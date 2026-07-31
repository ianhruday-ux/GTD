// W6 (wrapper-plan.md) — the plain Electron shell. Loads the exact same
// dist/index.html a browser tab would, over file: (so swClient.js's own
// existing `location.protocol === "file:"` check keeps the service worker
// out — no Electron-specific B3 equivalent needed, that check already
// covers it). This process owns the only two things a browser tab cannot
// do for itself: a folder picker, and reading/writing a file on disk. Both
// are exposed to the renderer through preload.js's contextBridge, never by
// turning on nodeIntegration.
"use strict";

const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const DIST_INDEX = path.join(__dirname, "..", "..", "dist", "index.html");
const ICON_PATH = path.join(__dirname, "..", "..", "dist", "icon-512.png");

// The App-Folder-scoped path W5's Dropbox API already writes to (see
// dropboxTransport.js's DROPBOX_SYNC_PATH and its own "Apps/OELA" note) —
// this MUST match exactly, since the whole point of file-based sync is that
// every device's transport reads and writes the one shared file. A local
// Dropbox client mirrors an API-scoped app folder at
// "<Dropbox root>/Apps/<app name>/", where <app name> is whatever the
// Dropbox app console has it registered as — "OELA" here, matching W5's
// device-verified path.
const DROPBOX_APP_SUBPATH = ["Apps", "OELA", "oela-sync.json"];

// Best-effort auto-detect of the local Dropbox root. Dropbox's desktop
// client has written info.json to a well-known, OS-specific location since
// at least the Dropbox API v1 era; this is read-only and never assumed to
// exist — connect() falls back to the folder picker (see desktopTransport.js)
// the moment this returns null. Windows is the ruled first target
// (wrapper-plan.md §0); macOS/Linux paths are the well-documented locations,
// included because they cost nothing, but only Windows has been run for real.
function infoJsonCandidates() {
  const home = os.homedir();
  const candidates = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "Dropbox", "info.json"));
    if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "Dropbox", "info.json"));
  } else if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "Dropbox", "info.json"));
  } else {
    candidates.push(path.join(home, ".dropbox", "info.json"));
  }
  return candidates;
}

async function detectDropboxRoot() {
  for (const p of infoJsonCandidates()) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const info = JSON.parse(raw);
      const entry = info.personal || info.business;
      if (entry && entry.path) return entry.path;
    } catch (e) {
      // Not found or unreadable at this candidate — try the next, and
      // ultimately fall through to null (the picker) rather than throw.
    }
  }
  return null;
}

ipcMain.handle("desktop-detect-dropbox", async () => {
  return detectDropboxRoot();
});

ipcMain.handle("desktop-pick-folder", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Choose your Dropbox folder",
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// `root` is whatever folder connect() resolved (auto-detected or picked) —
// always the Dropbox ROOT, never Apps/OELA itself; that subpath is appended
// here, in the one place that needs to agree with dropboxTransport.js's own
// DROPBOX_SYNC_PATH, rather than trusting the renderer to construct it.
function syncFilePath(root) {
  return path.join(root, ...DROPBOX_APP_SUBPATH);
}

ipcMain.handle("desktop-read-sync-file", async (_event, root) => {
  const filePath = syncFilePath(root);
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath)
    ]);
    return { exists: true, content, mtimeMs: stat.mtimeMs };
  } catch (e) {
    if (e && e.code === "ENOENT") return { exists: false, content: null, mtimeMs: null };
    throw e;
  }
});

ipcMain.handle("desktop-write-sync-file", async (_event, root, content) => {
  const filePath = syncFilePath(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  const stat = await fs.stat(filePath);
  return { mtimeMs: stat.mtimeMs };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    icon: ICON_PATH,
    title: "OELA",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // ⚑ Builder's call: no application menu. The app has its own ⋯ settings
  // menu and header chrome (the same one the phone and desktop-Chrome
  // layouts already use); a native File/Edit/View/Window/Help bar adds
  // nothing this app uses and would be the one piece of UI Electron invents
  // that the web build never had.
  Menu.setApplicationMenu(null);
  win.loadFile(DIST_INDEX);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

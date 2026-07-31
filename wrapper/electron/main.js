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
const fsWatch = require("fs").watch;
const path = require("path");
const os = require("os");

const DIST_INDEX = path.join(__dirname, "..", "..", "dist", "index.html");
const ICON_PATH = path.join(__dirname, "..", "..", "dist", "icon-512.png");

// The App-Folder-scoped path W5's Dropbox API already writes to (see
// dropboxTransport.js's DROPBOX_SYNC_PATH). This MUST match exactly, since
// the whole point of file-based sync is that every device's transport reads
// and writes the one shared file. A local Dropbox client mirrors an
// API-scoped app folder at "<Dropbox root>/Apps/<app name>/", where
// <app name> is whatever the Dropbox App Console has it registered as —
// NOT necessarily the app's display name. wrapper-plan.md's own prose says
// "Apps/OELA," which turned out to be shorthand, not the literal folder
// name: checked directly against the real account (2026-07-30 desktop
// test session) and the registered folder is "OELA_sync_ianhruday". Getting
// this wrong is silent and dangerous — the desktop transport would read and
// write a DIFFERENT file than the phone, each side merging happily with
// itself and never seeing the other's data, no error anywhere.
const DROPBOX_APP_SUBPATH = ["Apps", "OELA_sync_ianhruday", "oela-sync.json"];

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

// The freshness gap, found live testing against a real Dropbox account
// (2026-07-30): reading this file straight off disk only sees whatever
// Dropbox's OWN background client has already pulled down, which lags the
// true cloud state by however long THAT sync takes -- a device's own
// "Sync now" click can land in the gap and see stale data with no error.
// Android never has this problem (dropboxTransport.js asks Dropbox's
// servers directly, every time). The fix: watch the file itself and notify
// the renderer the instant Dropbox updates it, so "Sync now" isn't the only
// way this app ever learns something changed -- matching wrapper-plan.md
// §1's "in normal use, the UI teaches nothing at all... both devices are
// always live," which the read-from-disk design otherwise quietly breaks.
let lastWrittenMtimeMs = null; // set by OUR OWN writes below, so the watcher can tell "Dropbox delivered something" from "I just wrote this"

ipcMain.handle("desktop-write-sync-file", async (_event, root, content) => {
  const filePath = syncFilePath(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  const stat = await fs.stat(filePath);
  lastWrittenMtimeMs = stat.mtimeMs;
  return { mtimeMs: stat.mtimeMs };
});

let watcher = null;
let watchedDir = null;
let watchedFileName = null;
let watchedSender = null;
let debounceTimer = null;

function stopWatching() {
  if (watcher) { watcher.close(); watcher = null; }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
}

// Idempotent: called at the start of every desktopSyncNow() (desktopTransport.js),
// so it's re-armed on every trigger without either side having to remember to
// call it separately, and safe to call repeatedly against the same folder.
// Watches the DIRECTORY, not the file directly -- fs.watch on a file that
// doesn't exist yet throws, and the very first sync (which creates
// Apps/<folder>/) hasn't run when connect() first calls this.
ipcMain.handle("desktop-watch-sync-file", (event, root) => {
  const filePath = syncFilePath(root);
  const dir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  if (watchedDir === dir && watcher) { watchedSender = event.sender; return true; }
  stopWatching();
  watchedDir = dir;
  watchedFileName = fileName;
  watchedSender = event.sender;
  try {
    watcher = fsWatch(dir, (_eventType, changedName) => {
      if (changedName && changedName !== watchedFileName) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      // Coalesce Dropbox's own multi-step write (temp file + rename, common
      // sync-client behavior) into one notification, and give the dust a
      // moment to settle before reading.
      debounceTimer = setTimeout(async () => {
        try {
          const stat = await fs.stat(filePath);
          // Our own write, not Dropbox delivering something new -- the
          // ordinary case on every sync this app itself performs, and NOT
          // something to re-trigger a sync over (that way lies an infinite
          // write -> watch -> sync -> write loop).
          if (lastWrittenMtimeMs != null && Math.abs(stat.mtimeMs - lastWrittenMtimeMs) < 500) return;
          if (watchedSender && !watchedSender.isDestroyed()) watchedSender.send("desktop-sync-file-changed");
        } catch (e) {
          // Mid-write elsewhere the file can briefly not exist (rename-based
          // writers) -- nothing to do; the next real settle fires its own event.
        }
      }, 500);
    });
    return true;
  } catch (e) {
    // The directory doesn't exist yet (brand-new folder, nothing has synced
    // into it at all) -- nothing to watch until the first write creates it.
    // desktopSyncNow() re-calls this on every attempt, so the very next sync
    // (which creates the directory via mkdir) re-arms it successfully.
    watchedDir = null;
    return false;
  }
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

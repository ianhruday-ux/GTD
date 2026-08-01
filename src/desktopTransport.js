// ⚑ ERROR MESSAGES ARE i18n KEYS (author: "check that those sync reports have
// translations as well"). The sync status line surfaces the reason a sync
// failed, and these were raw English -- so a Chinese build read
// "同步失败 — No Dropbox folder connected". app.js runs the message through
// t(), which RETURNS THE KEY when it misses, so an authored reason gets
// translated and anything foreign (Dropbox's own API errors, the native auth
// plugin) still falls through verbatim rather than being swallowed.
// =========================================================
// DESKTOP TRANSPORT (W6, wrapper-plan.md) — the fs-based sibling to
// dropboxTransport.js (W5). Same shared file — the exact one
// dropboxTransport.js's DROPBOX_SYNC_PATH already writes via Dropbox's HTTP
// API — reached here by reading/writing the local disk copy the Dropbox
// desktop client already keeps in sync, instead of the API. No OAuth, no
// network call: "three lines of fs" is the whole reason this chunk exists
// (wrapper-plan.md §7 W6). wrapper/electron/main.js's DROPBOX_APP_SUBPATH
// must agree with this file's layout; that agreement, not a shared
// constant, is what makes one file readable by both shells. ⚠ The Dropbox
// App Folder's real on-disk name is NOT assumed to be "OELA" — see
// wrapper-plan.md §6 trap 10, found live: it's whatever the Dropbox App
// Console actually has registered, verified against the real account.
//
// In a browser (no window.__oelaDesktopBridge — GitHub Pages, a plain
// desktop Chrome tab): every exported function is unreachable, matching
// wrapper-plan.md's own line for this chunk — "In a browser: desktop
// Chrome remains a first-class way to run the app, unwrapped." isAvailable()
// is what the UI checks before ever offering it, same discipline as
// dropboxTransport.js.
// =========================================================

const DESKTOP_SYNC_FOLDER_KEY = "gtd_desktop_sync_folder"; // device-local (wrapper-plan.md §4.2) -- a path only means anything on THIS machine, so it is never synced
const DESKTOP_MAX_WRITE_RETRIES = 3; // mirrors DROPBOX_MAX_CAS_RETRIES's reasoning: a real race (the Dropbox daemon touching the file between our read and write) needs one retry to resolve; more than a few in a row means something else is wrong

function desktopBridge(){
  return (window.__oelaDesktopBridge && window.__oelaDesktopBridge.isElectron) ? window.__oelaDesktopBridge : null;
}

function desktopIsAvailable(){ return !!desktopBridge(); }

function desktopFolder(){ return Storage.get(DESKTOP_SYNC_FOLDER_KEY); }

// What a brand-new sync file looks like before this device has ever written
// it -- the same empty shape dropboxTransport.js's own dropboxEmptyBundle()
// builds, routed through the same additive-only, no-baseline path (§4.5).
function desktopEmptyBundle(){
  const stores = {};
  Sync.storeKeys.forEach(function(k){ stores[k] = []; });
  return { roster: {}, tombstones: [], stores: stores };
}

// Auto-detect first (Windows: %APPDATA%/Dropbox/info.json, read by the main
// process -- see wrapper/electron/main.js); fall back to the folder picker
// the moment detection comes back empty, which covers a nonstandard install
// or a platform whose info.json this hasn't actually been run against.
// ⚑ Builder's call: no confirmation dialog on the auto-detected path -- if
// it's wrong, the very first sync fails loudly (folder doesn't exist / isn't
// writable) rather than silently, and Disconnect + reconnect-with-the-picker
// is the recovery -- same "applies immediately, reversible" tier disconnect
// already sits at (dropboxTransport.js's own note).
async function desktopConnect(){
  const bridge = desktopBridge();
  if (!bridge) throw new Error("err.sync.wrapperOnly");
  let folder = await bridge.detectDropboxFolder();
  if (!folder) folder = await bridge.pickFolder();
  if (!folder) throw new Error("err.sync.noFolderChosen");
  Storage.set(DESKTOP_SYNC_FOLDER_KEY, folder);
  Sync.setConnected(true);
}

async function desktopDisconnect(){
  Storage.remove(DESKTOP_SYNC_FOLDER_KEY);
  Sync.setConnected(false);
}

// The one method the rest of the app calls, same shape as
// dropboxTransport.js's dropboxSyncNow(): pull, merge (W4), push, with an
// optimistic retry if the file's mtime moved between our read and our write
// -- the local stand-in for Dropbox's CAS-on-revision. There is no server to
// ask for a revision here, only the filesystem's own last-modified time, so
// the check is a re-read of that timestamp immediately before writing.
async function desktopSyncNow(){
  const bridge = desktopBridge();
  if (!bridge) throw new Error("err.sync.wrapperOnly");
  // ⚑ SELF-HEAL (W7). A device that believes it is connected but has lost its
  // folder path used to be stuck for good: every sync threw here, and the only
  // way out was noticing the message and manually disconnecting/reconnecting.
  // That state was reachable -- a restore-to-defaults wiped the path while
  // leaving the connected flag set -- and while the restore no longer does
  // that, "connected with nowhere to write" is worth recovering from rather
  // than merely not causing. Auto-detect is the same call connect() makes, so
  // this re-runs the step that produced the path in the first place; if it
  // comes back empty we are genuinely stuck and the error still stands.
  let folder = desktopFolder();
  if (!folder){
    folder = await bridge.detectDropboxFolder();
    if (folder) Storage.set(DESKTOP_SYNC_FOLDER_KEY, folder);
  }
  if (!folder) throw new Error("err.sync.noFolder");
  // Re-arm the freshness watch on every attempt -- idempotent in main.js if
  // already watching this folder, and this is also what re-arms it after a
  // brand-new folder's very first sync just created the directory the watch
  // couldn't attach to yet. Best-effort: a watch failure must never break
  // the sync itself, which is why this isn't awaited into the retry logic.
  if (bridge.watchSyncFile) bridge.watchSyncFile(folder).catch(function(){});
  let allConflicts = [];
  for (let attempt = 0; attempt < DESKTOP_MAX_WRITE_RETRIES; attempt++){
    const read = await bridge.readSyncFile(folder);
    const remoteBundle = read.exists ? JSON.parse(read.content) : desktopEmptyBundle();
    const result = Sync.reconcile(remoteBundle); // merges; applies locally unless a drafting page is open (result.applied)
    // REPLACE, don't concat -- same fix and same reason as dropboxTransport.js:
    // every attempt re-reads the file and re-runs the merge from scratch, so a
    // retry re-derives the SAME conflicts. Concatenating reported each one once
    // per attempt, turning an invisible self-resolving race into duplicate
    // entries in the user's conflict log.
    allConflicts = result.conflicts;
    const recheck = await bridge.readSyncFile(folder);
    if (recheck.exists !== read.exists || recheck.mtimeMs !== read.mtimeMs){
      continue; // something else (most likely the Dropbox daemon syncing a remote change to disk) wrote in between -- loop and merge again against what's actually there now
    }
    // result.bundle, NOT Sync.exportBundle() -- see the same note in
    // dropboxTransport.js: when the merge is deferred (drafting page open),
    // local storage still holds the pre-merge state on purpose, and
    // re-exporting it would publish the other device's records as deleted.
    await bridge.writeSyncFile(folder, JSON.stringify(result.bundle));
    return { conflicts: allConflicts };
  }
  throw new Error("err.sync.fileKeptChanging");
}

const DesktopTransport = {
  isAvailable: desktopIsAvailable,
  connect: desktopConnect,
  disconnect: desktopDisconnect,
  syncNow: desktopSyncNow
};
window.__oelaDesktop = DesktopTransport; // parallels window.__oelaDropbox -- the UI's hook and this chunk's own test harness

// The freshness fix's other half (main.js's fs.watch is the first half):
// whenever the watched file changes for a reason that wasn't this app's own
// write, run a real sync through the SAME orchestration every other trigger
// uses (runDropboxSync, defined in app.js -- safe to reference here despite
// load order, since this only ever actually runs asynchronously, long after
// the whole script has finished evaluating and every function has hoisted).
// Registered once at script load, guarded so a plain browser (no bridge) and
// the Capacitor/Android build (bridge simply doesn't exist) are both no-ops.
if (window.__oelaDesktopBridge && window.__oelaDesktopBridge.isElectron && window.__oelaDesktopBridge.onSyncFileChanged){
  window.__oelaDesktopBridge.onSyncFileChanged(function(){
    runDropboxSync();
  });
}

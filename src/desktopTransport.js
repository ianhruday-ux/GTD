// =========================================================
// DESKTOP TRANSPORT (W6, wrapper-plan.md) — the fs-based sibling to
// dropboxTransport.js (W5). Same shared file — Apps/OELA/oela-sync.json,
// the exact path dropboxTransport.js's DROPBOX_SYNC_PATH already writes
// via Dropbox's HTTP API — reached here by reading/writing the local disk
// copy the Dropbox desktop client already keeps in sync, instead of the
// API. No OAuth, no network call: "three lines of fs" is the whole reason
// this chunk exists (wrapper-plan.md §7 W6). wrapper/electron/main.js's
// DROPBOX_APP_SUBPATH must agree with this file's layout; that agreement,
// not a shared constant, is what makes one file readable by both shells.
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
  if (!bridge) throw new Error("Dropbox sync is only available in the installed app");
  let folder = await bridge.detectDropboxFolder();
  if (!folder) folder = await bridge.pickFolder();
  if (!folder) throw new Error("No folder was chosen");
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
  if (!bridge) throw new Error("Dropbox sync is only available in the installed app");
  const folder = desktopFolder();
  if (!folder) throw new Error("No Dropbox folder connected");
  let allConflicts = [];
  for (let attempt = 0; attempt < DESKTOP_MAX_WRITE_RETRIES; attempt++){
    const read = await bridge.readSyncFile(folder);
    const remoteBundle = read.exists ? JSON.parse(read.content) : desktopEmptyBundle();
    const result = Sync.reconcile(remoteBundle); // writes the merge back locally + advances this device's baseline/roster entry (W4)
    allConflicts = allConflicts.concat(result.conflicts);
    const recheck = await bridge.readSyncFile(folder);
    if (recheck.exists !== read.exists || recheck.mtimeMs !== read.mtimeMs){
      continue; // something else (most likely the Dropbox daemon syncing a remote change to disk) wrote in between -- loop and merge again against what's actually there now
    }
    await bridge.writeSyncFile(folder, JSON.stringify(Sync.exportBundle()));
    return { conflicts: allConflicts };
  }
  throw new Error("Dropbox sync: the file kept changing underneath this sync — try again shortly");
}

const DesktopTransport = {
  isAvailable: desktopIsAvailable,
  connect: desktopConnect,
  disconnect: desktopDisconnect,
  syncNow: desktopSyncNow
};
window.__oelaDesktop = DesktopTransport; // parallels window.__oelaDropbox -- the UI's hook and this chunk's own test harness

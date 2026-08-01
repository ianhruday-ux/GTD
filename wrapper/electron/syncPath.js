// Where the shared sync file actually is, inside somebody's Dropbox folder.
//
// This is its own module rather than three lines in main.js for one reason:
// main.js cannot be require()d outside Electron, and this is the piece most
// worth testing without one. checks/desktop_sync_path.py drives THIS FILE
// against real temporary directories.
//
// ── the problem ──────────────────────────────────────────────────────────────
// Dropbox mirrors an API-scoped App Folder on disk at
//
//     <Dropbox root>/Apps/<the app's registered folder name>/
//
// and W6 hardcoded both halves. The second half was already caught once and is
// genuinely fixed by knowing the value (wrapper-plan.md §6, trap 10: the folder
// is "OELA_sync_ianhruday", not "OELA"). The FIRST half is a second instance of
// the same mistake that went unnoticed beside it: **Dropbox localizes "Apps"**.
// A Spanish account has "Aplicaciones", a French one "Applications". On those
// accounts the hardcoded path names a folder that does not exist, so the
// desktop app would read nothing and then create an ordinary folder called
// "Apps" — which Dropbox syncs as an ordinary folder, NOT as the app folder the
// phone is writing to. Two devices, two files, no error: exactly the silent
// divergence trap 10 describes, arrived at from the other direction.
//
// ── the resolution ───────────────────────────────────────────────────────────
// Don't guess the parent's name; look for the child, whose name Dropbox does
// NOT translate because it comes from the app registration. Scan the root's
// immediate subdirectories for one containing OELA_sync_ianhruday and use
// whatever it turns out to be called.
//
// ⚑ Residual case, flagged rather than papered over: if nothing is found —
// nobody has linked OELA on any device yet, so Dropbox has not created the
// folder — this still falls back to the English "Apps" and creates it. For a
// non-English account that is still wrong, and it is wrong in the same silent
// way. Closing it properly means either refusing to create the folder at all
// (and telling the user to connect on the phone first, which is new UI and new
// copy in two languages) or shipping a table of Dropbox's own translations for
// "Apps" (a list with no authoritative source that rots quietly). Neither is
// free, and this fallback is strictly better than what it replaces: the
// realistic path to using desktop sync at all is having connected the phone
// first, which creates the folder and makes the scan succeed.
"use strict";

const path = require("path");

// Set in the Dropbox App Console, identical for every account that links this
// app, and NOT localized. This is the half that is safe to hardcode.
const APP_FOLDER_NAME = "OELA_sync_ianhruday";

// Must match dropboxTransport.js's DROPBOX_SYNC_PATH. The whole point of a
// file-based sync is that every transport reads and writes the one file.
const SYNC_FILE_NAME = "oela-sync.json";

// What Dropbox calls the app-folder parent in English, used only when the scan
// finds nothing at all.
const DEFAULT_PARENT = "Apps";

/**
 * @param {string} root  the Dropbox root folder (auto-detected, or picked)
 * @param {object} fsp   fs/promises, injected so the check can drive this
 *                       against temp directories without stubbing globals
 * @returns {Promise<string>} absolute path to the app folder (may not exist yet)
 */
async function resolveAppFolder(root, fsp) {
  const fallback = path.join(root, DEFAULT_PARENT, APP_FOLDER_NAME);

  const isDir = async (p) => {
    try {
      return (await fsp.stat(p)).isDirectory();
    } catch (e) {
      return false;
    }
  };

  // The English name first, when it is really there — so an account that has
  // both (possible after a rename, or a stray hand-made folder) resolves the
  // same way it did before this change rather than switching underneath
  // somebody who was already syncing fine.
  if (await isDir(fallback)) return fallback;

  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (e) {
    // Unreadable or gone: the caller's own mkdir/read will produce the real
    // error. Returning the fallback keeps this function total.
    return fallback;
  }

  // Sorted, so a root containing two candidates resolves to the same one on
  // every device and every run. A nondeterministic answer here would be the
  // silent-divergence bug again, just with a different cause.
  const parents = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const name of parents) {
    const candidate = path.join(root, name, APP_FOLDER_NAME);
    if (await isDir(candidate)) return candidate;
  }

  return fallback;
}

async function resolveSyncFile(root, fsp) {
  return path.join(await resolveAppFolder(root, fsp), SYNC_FILE_NAME);
}

module.exports = {
  APP_FOLDER_NAME,
  SYNC_FILE_NAME,
  DEFAULT_PARENT,
  resolveAppFolder,
  resolveSyncFile
};

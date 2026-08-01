// =========================================================
// DROPBOX TRANSPORT (W5, wrapper-plan.md §4.1/§4.4/§5) — the one place in
// the app that knows Dropbox exists. sync.js (W4) is pure and
// transport-agnostic on purpose; this module is deliberately the opposite:
// the native OAuth bridge (DropboxAuthPlugin.java), the Content API, the
// single synced file, and CAS-on-revision all live here and nowhere else.
//
// In a browser (no window.Capacitor, or Capacitor but not native — GitHub
// Pages, a desktop tab): every exported function is unreachable, matching
// wrapper-plan.md's own line for this chunk — "In a browser: the transport
// simply is not offered." isAvailable() is what the UI checks before ever
// showing a Dropbox control; nothing here runs unless that is true first.
//
// Requires "CapacitorHttp": {"enabled": true} in capacitor.config.json (set,
// wrapper-plan.md W5). Without it, fetch() here would be a real WebView
// browser fetch, and Dropbox's /files/download response carries its file
// revision in a custom header (Dropbox-API-Result) that a browser will not
// expose to JS cross-origin without the SERVER opting in via
// Access-Control-Expose-Headers -- which cannot be assumed. With the flag
// on, Capacitor's own native-bridge.js patches window.fetch to run the
// request through native HttpURLConnection and hand back EVERY response
// header when reconstructing the JS Response -- no CORS filtering, because
// the real network call never touches the WebView's browser networking
// stack at all. Verified by reading that bridge's source directly
// (node_modules/@capacitor/android/.../native-bridge.js), not assumed.
//
// §4.4's lock question, resolved the way the plan doc's own preferred branch
// reads: pure CAS on Dropbox's file revision (mode: update + the last-seen
// rev), no separate lock file. A crash mid-write just means an atomic write
// that did or didn't land; nothing is ever left stranded for another device
// to wait on.
// =========================================================

const DROPBOX_SYNC_PATH = "/oela-sync.json";
// A real collision (two devices writing in the same few seconds) needs
// exactly one retry to resolve. More than a few in a row past that means
// something else is wrong (a stuck token, a persistent network flap) and
// the caller should see an error rather than spin quietly.
const DROPBOX_MAX_CAS_RETRIES = 3;

function dropboxPlugin(){
  return (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins)
    ? window.Capacitor.Plugins.DropboxAuth
    : null;
}

function dropboxIsAvailable(){ return !!dropboxPlugin(); }

async function dropboxIsAuthorized(){
  const plugin = dropboxPlugin();
  if (!plugin) return false;
  const res = await plugin.isAuthorized();
  return !!(res && res.authorized);
}

// Launches the system-browser OAuth flow (DropboxAuthPlugin.authorize()).
// On success, marks this device connected -- Sync.isEnabled() (and with it
// the §4.3 pull-before-sweep gate) turns on starting with the NEXT boot;
// nothing mid-session needs to change, since this device has nothing synced
// yet to protect until a syncNow() actually runs.
async function dropboxConnect(){
  const plugin = dropboxPlugin();
  if (!plugin) throw new Error("Dropbox sync is only available in the installed app");
  await plugin.authorize();
  Sync.setConnected(true);
}

async function dropboxDisconnect(){
  const plugin = dropboxPlugin();
  if (plugin) await plugin.signOut();
  Sync.setConnected(false);
}

async function dropboxAccessToken(){
  const plugin = dropboxPlugin();
  if (!plugin) throw new Error("Dropbox sync is only available in the installed app");
  const res = await plugin.getAccessToken(); // refreshes silently if the stored token has expired (native side, AuthState.performActionWithFreshTokens)
  return res.accessToken;
}

// What a brand-new sync file looks like before anyone has written to it.
// Feeding this into Sync.reconcile() on a device's first-ever sync routes
// every local record through the SAME additive-only, no-baseline path
// wrapper-plan.md §4.5 already built for a rejoining/new device — there is
// no special "first sync" case in the merge engine, and there should not be.
function dropboxEmptyBundle(){
  const stores = {};
  Sync.storeKeys.forEach(function(k){ stores[k] = []; });
  return { roster: {}, tombstones: [], stores: stores };
}

async function dropboxDownload(token){
  const resp = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Dropbox-API-Arg": JSON.stringify({ path: DROPBOX_SYNC_PATH })
    }
  });
  if (resp.status === 409){
    // Dropbox reports endpoint-specific errors (a malformed-but-valid
    // request, e.g. "no such file yet") as 409 with a JSON body, reserving
    // other codes for transport/auth-level failures (401 expired token, 429
    // rate limit, 5xx). "not_found" is the ordinary first-sync-ever case,
    // not a fault -- everything else 409 reports as a real download failure.
    const errBody = await resp.json().catch(function(){ return null; });
    const tag = errBody && errBody.error && errBody.error.path && errBody.error.path[".tag"];
    if (tag === "not_found") return { exists: false, rev: null, bundle: null };
    throw new Error("Dropbox download failed: " + (errBody ? JSON.stringify(errBody) : resp.status));
  }
  if (!resp.ok) throw new Error("Dropbox download failed: HTTP " + resp.status);
  const resultHeader = resp.headers.get("Dropbox-API-Result");
  const meta = resultHeader ? JSON.parse(resultHeader) : null;
  const bundle = await resp.json();
  return { exists: true, rev: meta ? meta.rev : null, bundle: bundle };
}

async function dropboxUpload(token, bundle, mode){
  const resp = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/octet-stream",
      // autorename:false is load-bearing, not a default to leave implicit --
      // without it, two devices racing their very first "add" would each
      // succeed by silently forking into "oela-sync.json" and "oela-sync
      // (1).json", which is exactly the silent-divergence failure class §1
      // rules out. With it, the loser gets a real 409 and retries into the
      // winner's file instead, through the same CAS loop as every other
      // collision.
      "Dropbox-API-Arg": JSON.stringify({ path: DROPBOX_SYNC_PATH, mode: mode, autorename: false, mute: true })
    },
    body: JSON.stringify(bundle)
  });
  if (resp.status === 409) return { conflict: true };
  if (!resp.ok) throw new Error("Dropbox upload failed: HTTP " + resp.status);
  const meta = await resp.json();
  return { conflict: false, rev: meta.rev };
}

// The one method the rest of the app calls: pull, merge (W4), push; retry
// the push under CAS if another device wrote in between. Returns the
// conflicts W4 found so the UI can honor §1's "never silent" ruling.
async function dropboxSyncNow(){
  if (!dropboxIsAvailable()) throw new Error("Dropbox sync is only available in the installed app");
  const token = await dropboxAccessToken();
  let allConflicts = [];
  for (let attempt = 0; attempt < DROPBOX_MAX_CAS_RETRIES; attempt++){
    const download = await dropboxDownload(token);
    const remoteBundle = download.exists ? download.bundle : dropboxEmptyBundle();
    const result = Sync.reconcile(remoteBundle); // merges; applies locally unless a drafting page is open (result.applied)
    // ⚑ REPLACE, don't concat (found live: two log entries for one event).
    // Every attempt re-downloads and re-runs the whole merge from scratch, so
    // a CAS retry re-derives the SAME conflicts rather than finding new ones.
    // Concatenating reported each one once per attempt, turning "someone wrote
    // between our download and our upload" -- an invisible, self-resolving
    // race -- into duplicate entries in the user's conflict log. The last
    // attempt's set is the one that actually reached the cloud.
    allConflicts = result.conflicts;
    const mode = download.exists ? { ".tag": "update", update: download.rev } : { ".tag": "add" };
    // result.bundle, NOT Sync.exportBundle(). These are identical whenever the
    // merge was applied, but when it was DEFERRED (drafting page open, author
    // ruling 2026-07-30) local storage deliberately still holds the pre-merge
    // state -- re-exporting it would publish this device's view as if the other
    // device's records had been deleted, which the far end would then honour.
    // Pushing the merged bundle keeps "defer locally, still publish" safe.
    const upload = await dropboxUpload(token, result.bundle, mode);
    if (!upload.conflict) return { conflicts: allConflicts };
    // Someone else wrote between our download and our upload. Loop: the
    // next dropboxDownload() sees their write, and reconcile() is safe to
    // run again against it -- merging is idempotent against already-merged
    // data, nothing gets double-applied.
  }
  throw new Error("Dropbox sync: too many conflicting writes in a row — try again shortly");
}

const DropboxTransport = {
  isAvailable: dropboxIsAvailable,
  isAuthorized: dropboxIsAuthorized,
  connect: dropboxConnect,
  disconnect: dropboxDisconnect,
  syncNow: dropboxSyncNow
};
window.__oelaDropbox = DropboxTransport; // parallels window.__oelaSync — the UI's hook (task 5) and this chunk's own future test harness

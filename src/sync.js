// =========================================================
// SYNC ENGINE (W4, wrapper-plan.md §4) — merge only, no transport.
//
// "All of the data-loss risk in the entire project lives here, and none of
// it needs Dropbox to reproduce" (wrapper-plan.md). This file is pure and
// transport-agnostic on purpose: every function operates on plain data (a
// "bundle" — the shape below) and touches nothing but Storage. W5
// (dropboxTransport.js) wires a real Dropbox file to Sync.reconcile() and
// calls Sync.setConnected(true) the moment OAuth succeeds; until a device
// has done that, Sync.isEnabled() stays false and every call site that
// matters (the habit sweep gate) behaves exactly as it did before W5
// existed. window.__oelaSync exists so a transport (and this chunk's own
// tests) can drive it; it is not a feature surface.
//
// A bundle is everything that would live in the shared cloud file:
//   { roster:      { [deviceId]: { lastPull: ms|null } },
//     tombstones:  [ {id, store, recordId, deletedAt, modifiedAt, deviceId} ],
//     stores:      { "gtd_tasks_next": [...], "gtd_events": [...], ... } }
//
// Scope carried forward from W3, not widened here: SYNC_STORE_KEYS is the
// flat array-of-{id,...}-records stores only. gtd_habit_runs/gtd_habit_done/
// gtd_habit_done_order and the gtd_archived_* maps are keyed objects, not
// record arrays — W3 already excluded them from modifiedAt/tombstones for
// that reason, and merging them needs its own shape-aware logic this file
// does not attempt. Real W4-adjacent work, not a gap introduced here.
// =========================================================
const SYNC_STORE_KEYS = [
  "gtd_tasks_next", "gtd_tasks_waiting", "gtd_tasks_current", "gtd_tasks_future", "gtd_tasks_habit",
  "gtd_events", "gtd_notes", "gtd_tags", "gtd_contexts",
  "gtd_completed_next", "gtd_completed_waiting", "gtd_completed_current", "gtd_completed_future",
  "gtd_tray"
];
const SYNC_TOMBSTONE_KEY = "gtd_tombstones";
const SYNC_ROSTER_KEY = "gtd_sync_roster";
const SYNC_BASELINE_KEY = "gtd_sync_baseline"; // this device's own last-merged bundle; never itself synced
const SYNC_DEVICE_ID_KEY = "gtd_device_id";
const SYNC_CONNECTED_KEY = "gtd_sync_connected"; // W5: set/cleared by whichever transport connects (dropboxTransport.js today) -- a plain synchronous flag so the boot-time gate below never needs to await a native call
const SYNC_ROSTER_DROPOUT_MS = 365 * 24 * 60 * 60 * 1000; // wrapper-plan.md §4.5: a year, deliberately generous
const SYNC_GATE_TIMEOUT_MS = 5000; // §4.3: how long a sweep waits for a pull before sweeping local-only anyway
const sessionStart = Date.now();

function getDeviceId(){
  let id = Storage.get(SYNC_DEVICE_ID_KEY);
  if (!id){ id = genId(); Storage.set(SYNC_DEVICE_ID_KEY, id); }
  return id;
}

// §4.3's rule, real as of W5. window.__oelaSyncForceEnabled is a test-only
// escape hatch (undefined in any real browser) checked FIRST and
// unconditionally -- it exists so checks/sync_engine.py can exercise the
// boot-time gate across a real reload without a real Dropbox connection,
// and every one of those checks runs in a plain Playwright browser where
// window.Capacitor never exists, so the real condition below is always
// false there regardless -- the two paths cannot collide.
//
// The real condition is a synchronous, PERSISTED flag rather than a live
// call to the native plugin: canSweepAccumulated() is called from inside
// boot()'s synchronous processHabitBoundaries() sweep, and isAuthorized()/
// getAccessToken() are native calls that return Promises. Going async there
// would mean either blocking boot on a native round-trip or restructuring
// boot() itself -- exactly the kind of large, risky surgery W2 rejected for
// storage. dropboxTransport.js sets this the moment OAuth succeeds and
// clears it on sign-out; this function just reads what was last true.
// Two wrappers can make this true: Capacitor (Android, W5) or the Electron
// desktop bridge (W6, window.__oelaDesktopBridge — preload.js's contextBridge
// surface, checked directly rather than via desktopTransport.js to keep this
// file dependency-order-agnostic like it already was for Capacitor). Never
// both in the same running instance -- a browser tab has neither.
function isNativeWrapper(){
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return true;
  if (window.__oelaDesktopBridge && window.__oelaDesktopBridge.isElectron) return true;
  return false;
}
function syncIsEnabled(){
  if (window.__oelaSyncForceEnabled === true) return true;
  return isNativeWrapper() && Storage.get(SYNC_CONNECTED_KEY) === "1";
}
function setSyncConnected(on){ Storage.set(SYNC_CONNECTED_KEY, on ? "1" : "0"); }

function loadRoster(){ return Storage.getJSON(SYNC_ROSTER_KEY, {}); }
function loadBaseline(){ return Storage.getJSON(SYNC_BASELINE_KEY, null); }
function saveBaseline(bundle){ Storage.setJSON(SYNC_BASELINE_KEY, bundle); }

function exportBundle(){
  const stores = {};
  SYNC_STORE_KEYS.forEach(function(k){ stores[k] = Storage.getJSON(k, []); });
  return {
    roster: loadRoster(),
    tombstones: Storage.getJSON(SYNC_TOMBSTONE_KEY, []),
    stores: stores
  };
}
// Deliberately bypasses Storage.setJSON's own W3 stamping: the merge below
// has ALREADY decided the correct modifiedAt/deviceId for every record
// (newest-wins), and re-diffing on the way in would stamp the losing side's
// timestamp over the winner's the moment it lands in localStorage. Storage.
// set() still runs, so W2's native mirror keeps working; only the W3
// stamp-on-write is skipped, and skipping it also means a delete a MERGE
// applies never mints a second, redundant local tombstone for a deletion
// that already has one from whoever actually deleted it.
function importBundle(bundle){
  Storage.set(SYNC_ROSTER_KEY, JSON.stringify(bundle.roster));
  Storage.set(SYNC_TOMBSTONE_KEY, JSON.stringify(bundle.tombstones));
  SYNC_STORE_KEYS.forEach(function(k){
    Storage.set(k, JSON.stringify(bundle.stores[k] || []));
  });
}

function byId(arr){
  const m = {};
  (arr || []).forEach(function(r){ if (r && typeof r.id === "string") m[r.id] = r; });
  return m;
}
function sameContent(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
// Newest wins (ruled, §4.1). A tie on modifiedAt is vanishingly unlikely
// (millisecond timestamps from two different devices) but not impossible,
// so it needs A rule, not a random one: the larger deviceId wins, purely to
// be deterministic and stop two devices from flip-flopping the same record
// forever on a real tie.
function newestOf(a, b){
  const at = a.modifiedAt || 0, bt = b.modifiedAt || 0;
  if (at !== bt) return at > bt ? a : b;
  return (a.deviceId || "") >= (b.deviceId || "") ? a : b;
}
function tombstonesByRecordId(tombstones, store){
  const m = {};
  (tombstones || []).forEach(function(t){ if (t && t.store === store) m[t.recordId] = t; });
  return m;
}

// The one merge rule, applied to every store (tasks, events, notes... and
// tombstones themselves, which are just another {id,...} record array whose
// content never changes once written, so "merge" degenerates correctly to
// "union" for them with no special-casing needed).
//
// `noBaseline` (no prior successful sync for THIS device) means additive-
// only, per wrapper-plan.md §4.5: never infer a deletion from a record's
// absence, because there is no trustworthy prior state to say it used to be
// there. That is what protects a brand-new device's pre-first-sync writes,
// and what keeps a dropped-then-rejoining device's failure mode as
// resurrection (annoying, recoverable) rather than silent loss.
function mergeRecordArray(localArr, remoteArr, baselineArr, ctx){
  const local = byId(localArr), remote = byId(remoteArr), baseline = byId(baselineArr);
  const ids = {};
  Object.keys(local).forEach(function(id){ ids[id] = true; });
  Object.keys(remote).forEach(function(id){ ids[id] = true; });
  const out = [];
  const conflicts = [];
  Object.keys(ids).forEach(function(id){
    const l = local[id], r = remote[id], b = baseline[id];
    if (l && r){
      if (sameContent(l, r)){ out.push(l); return; }
      const winner = newestOf(l, r);
      out.push(winner);
      // A genuine conflict is BOTH sides having moved since the last state
      // this device knows they agreed on -- one side simply being ahead of
      // a shared baseline is a routine update, not something to report.
      if (b && !sameContent(l, b) && !sameContent(r, b)){
        conflicts.push({ store: ctx.store, id: id, local: l, remote: r, winner: winner });
      }
      return;
    }
    if (l && !r){
      if (ctx.noBaseline || !b){ out.push(l); return; } // additive: local creation, keep/push it
      const tomb = ctx.remoteTombstones[id];
      if (tomb && tomb.deletedAt >= (l.modifiedAt || 0)) return; // their delete wins; drop it
      out.push(l); // our edit is newer than their delete (or no tombstone reached us yet)
      if (tomb) conflicts.push({ store: ctx.store, id: id, resurrection: true, record: l, tombstone: tomb });
      return;
    }
    if (r && !l){
      if (ctx.noBaseline || !b){ out.push(r); return; } // additive: their creation, pull it
      const tomb = ctx.localTombstones[id];
      if (tomb && tomb.deletedAt >= (r.modifiedAt || 0)) return; // our delete wins; stays gone
      out.push(r);
      if (tomb) conflicts.push({ store: ctx.store, id: id, resurrection: true, record: r, tombstone: tomb });
      return;
    }
  });
  return { array: out, conflicts: conflicts };
}

function mergeRoster(a, b){
  const out = {};
  const ids = {};
  Object.keys(a || {}).forEach(function(id){ ids[id] = true; });
  Object.keys(b || {}).forEach(function(id){ ids[id] = true; });
  Object.keys(ids).forEach(function(id){
    const ea = (a || {})[id], eb = (b || {})[id];
    if (ea && eb) out[id] = { lastPull: Math.max(ea.lastPull || 0, eb.lastPull || 0) || null };
    else out[id] = ea || eb;
  });
  return out;
}

// wrapper-plan.md §4.5. A device that has NEVER pulled (lastPull == null)
// does not count toward "the oldest pull" -- it hasn't joined the
// GC-blocking set yet, only actual devices that have confirmed seeing at
// least one state have. If literally nobody has ever pulled, nothing is
// provably safe to discard, so nothing is discarded.
function gcTombstonesAndRoster(tombstones, roster){
  const now = Date.now();
  const activeRoster = {};
  Object.keys(roster || {}).forEach(function(id){
    const entry = roster[id];
    if (entry && entry.lastPull != null && (now - entry.lastPull) > SYNC_ROSTER_DROPOUT_MS) return; // dropped
    activeRoster[id] = entry;
  });
  const pulls = Object.keys(activeRoster)
    .map(function(id){ return activeRoster[id] && activeRoster[id].lastPull; })
    .filter(function(t){ return t != null; });
  if (!pulls.length) return { tombstones: tombstones, roster: activeRoster }; // nobody confirmed seeing anything yet
  const oldestPull = Math.min.apply(null, pulls);
  return {
    tombstones: tombstones.filter(function(t){ return t.deletedAt >= oldestPull; }),
    roster: activeRoster
  };
}

// Pure: same inputs always produce the same output, nothing is read from or
// written to Storage here. `baselineBundle` is null exactly when this
// device has never completed a sync before (brand new, or rejoining after
// being dropped) -- see the noBaseline handling in mergeRecordArray.
function mergeBundles(localBundle, remoteBundle, deviceId, baselineBundle){
  const noBaseline = !baselineBundle;
  const conflicts = [];

  const localTombByStore = {}, remoteTombByStore = {};
  SYNC_STORE_KEYS.forEach(function(k){
    localTombByStore[k] = tombstonesByRecordId(localBundle.tombstones, k);
    remoteTombByStore[k] = tombstonesByRecordId(remoteBundle.tombstones, k);
  });

  const tombMerge = mergeRecordArray(
    localBundle.tombstones, remoteBundle.tombstones,
    baselineBundle ? baselineBundle.tombstones : [],
    { store: SYNC_TOMBSTONE_KEY, noBaseline: noBaseline, localTombstones: {}, remoteTombstones: {} }
  );

  const mergedStores = {};
  SYNC_STORE_KEYS.forEach(function(key){
    const res = mergeRecordArray(
      localBundle.stores[key], remoteBundle.stores[key],
      baselineBundle ? baselineBundle.stores[key] : [],
      { store: key, noBaseline: noBaseline,
        localTombstones: localTombByStore[key], remoteTombstones: remoteTombByStore[key] }
    );
    mergedStores[key] = res.array;
    conflicts.push.apply(conflicts, res.conflicts);
  });

  const mergedRoster = mergeRoster(localBundle.roster, remoteBundle.roster);
  const gc = gcTombstonesAndRoster(tombMerge.array, mergedRoster);

  return {
    merged: { tombstones: gc.tombstones, roster: gc.roster, stores: mergedStores },
    conflicts: conflicts
  };
}

// ---------------------------------------------------------------------
// THE INVARIANT THIS FILE EXISTS TO PROTECT, learned the expensive way
// (2026-07-30, first real two-device test):
//
//   in-memory state and localStorage must NEVER disagree about a synced
//   store -- either both are updated, or neither is.
//
// The original reconcile() wrote the merge to localStorage and stopped
// there. app.js keeps every lane in memory (state.tasks[...] et al),
// loaded once at boot, and BOTH renders and SAVES from it. So a merge
// produced two silent failures at once:
//   1. Invisible. Lanes redrew from the stale in-memory copy, so pulled
//      records simply never appeared until the app was restarted.
//   2. DATA LOSS. saveTasksLocal() writes the whole in-memory array, and
//      storage.js's stampAndTombstone() diffs it against what is in
//      localStorage -- which was now the MERGED array. Every record the
//      merge had just pulled in was absent from stale memory, so it read
//      as a deletion and got a tombstone. The next sync then propagated
//      those tombstones and deleted the other device's records everywhere.
// One record created on a desktop ("Party") was destroyed exactly this way
// before anyone had typed a line of real data into the app.
//
// afterImport is how app.js reloads memory from storage; the apply gate is
// how a caller refuses the whole application (see setApplyGate).
// ---------------------------------------------------------------------
let afterImportHook = null;
function setAfterImport(fn){ afterImportHook = fn; }

// DRAFT ISOLATION x sync (author ruling, 2026-07-30, option 1 of three).
// A merge landing while a drafting page is open would change data out from
// under an edit in progress; CLAUDE.md's standing ruling says nothing
// commits until Save, and that has to hold against a remote write too.
// Defaults to "always allowed" so sync.js stays usable (and testable)
// without app.js having set anything.
let applyGate = function(){ return true; };
function setApplyGate(fn){ applyGate = fn; }

// Author ruling (2026-07-30): "If someone goes through the tutorial on one
// device before setting up cloud storage, we can pretty much assume they
// don't need the tutorial on the other device. The same will be true of the
// rest of the default data." A device JOINING an existing system adopts what
// is already there and contributes none of its own seeded content -- without
// this, both devices' independently-seeded tutorials merge into two of
// everything, which is exactly what happened on the first real desktop run.
// Seeded records are self-identifying: seedKey (habits, contexts) or
// tutorialKey (the tutorial chain and its sample project).
// ⚑ Accepted cost, flagged: a seed card the user had already EDITED on the
// joining device is dropped too. The ruling above treats that as fine.
function isSeededRecord(r){ return !!(r && (r.seedKey || r.tutorialKey)); }
function bundleHasAnyRecord(b){
  return SYNC_STORE_KEYS.some(function(k){ return ((b.stores && b.stores[k]) || []).length > 0; });
}
function stripSeededRecords(bundle){
  const stores = {};
  SYNC_STORE_KEYS.forEach(function(k){
    stores[k] = (bundle.stores[k] || []).filter(function(r){ return !isSeededRecord(r); });
  });
  return { roster: bundle.roster, tombstones: bundle.tombstones, stores: stores };
}

// The app-facing entry point (stateful; everything above is pure). Takes
// "what the cloud currently holds", returns the merged bundle to publish and
// the conflicts found. W5/W6's transports call this after every successful
// pull; the test suites call it directly.
//
// Returns `applied`: false means the merge was computed and is safe to PUSH,
// but was deliberately not applied to this device (a drafting page is open).
// Nothing is stashed -- the pushed bundle is already in the cloud, so simply
// syncing again later re-derives and applies it. Deferring is strictly safe
// precisely BECAUSE it leaves memory and storage in agreement.
function reconcile(remoteBundle){
  const deviceId = getDeviceId();
  const baseline = loadBaseline();
  let local = exportBundle();
  // Joining an existing system: drop this device's own seeded content first.
  if (!baseline && bundleHasAnyRecord(remoteBundle)) local = stripSeededRecords(local);
  const result = mergeBundles(local, remoteBundle, deviceId, baseline);
  result.merged.roster[deviceId] = { lastPull: Date.now() };
  const gc = gcTombstonesAndRoster(result.merged.tombstones, result.merged.roster);
  result.merged.tombstones = gc.tombstones;
  result.merged.roster = gc.roster;

  const apply = applyGate();
  if (!apply){
    // Report nothing yet: these conflicts have not been shown to the user or
    // applied here, and the later sync that DOES apply this bundle will
    // re-derive and report them then. Reported once, late -- never lost.
    return { conflicts: [], bundle: result.merged, applied: false };
  }
  importBundle(result.merged);
  saveBaseline(result.merged);
  // Memory follows storage, always, in the same breath. Everything above is
  // pointless if this is skipped -- see the invariant comment.
  if (afterImportHook) afterImportHook();
  if (state.sync) state.sync.pulledThisSession = true;
  return { conflicts: result.conflicts, bundle: result.merged, applied: true };
}

// wrapper-plan.md §4.3: "a device must pull before its sweep may persist
// accumulated state." Hard-false today (no transport exists), so this is a
// no-op returning true -- zero behavior change -- while the rule itself is
// real and under test (see syncIsEnabled's test-only override), ready for
// W5 to flip on.
function canSweepAccumulated(){
  if (!syncIsEnabled()) return true;
  if (state.sync && state.sync.pulledThisSession) return true;
  return (Date.now() - sessionStart) > SYNC_GATE_TIMEOUT_MS;
}

const Sync = {
  getDeviceId: getDeviceId,
  isEnabled: syncIsEnabled,
  setConnected: setSyncConnected,
  exportBundle: exportBundle,
  importBundle: importBundle,
  mergeBundles: mergeBundles,
  reconcile: reconcile,
  canSweepAccumulated: canSweepAccumulated,
  setAfterImport: setAfterImport, // app.js registers its "reload memory from storage" here
  setApplyGate: setApplyGate,     // app.js registers "is a drafting page open?" here
  storeKeys: SYNC_STORE_KEYS // read-only reference W5's transport needs to build an empty/first-sync bundle without duplicating this list
};
window.__oelaSync = Sync; // W5's hook, and this chunk's own test harness -- not a user-facing feature

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
  "gtd_tray",
  // Chunk A (sync-audit.md §2b): what a completed project took down with it,
  // and what un-completing restores from. Reshaped in app.js from keyed
  // objects to record arrays purely so they can live here.
  "gtd_archived_waiting", "gtd_archived_events",
  // Chunk B (sync-audit.md §3): habit progress -- the only gap that lost data
  // from the most ordinary act in the app. gtd_habit_runs carries a bespoke
  // merge (registerRecordMerger below); gtd_habit_done is an ordinary record
  // array. gtd_habit_done_order stays device-local by ruling: it is today-only
  // display ordering, recomputable and meaningless on another device.
  "gtd_habit_runs", "gtd_habit_done"
];

// A store whose records the generic rule cannot merge correctly registers
// itself here. Only gtd_habit_runs does, and only because a day's outcome is
// an assertion rather than an ordinary field -- see app.js
// mergeHabitRunRecord. Kept as a registry rather than a special case inside
// mergeRecordArray so sync.js goes on knowing nothing about habits.
const SYNC_RECORD_MERGERS = {};
function registerRecordMerger(store, fn){ SYNC_RECORD_MERGERS[store] = fn; }
const SYNC_TOMBSTONE_KEY = "gtd_tombstones";
const SYNC_ROSTER_KEY = "gtd_sync_roster";
const SYNC_BASELINE_KEY = "gtd_sync_baseline"; // this device's own last-merged bundle; never itself synced
const SYNC_DEVICE_ID_KEY = "gtd_device_id";
const SYNC_CONNECTED_KEY = "gtd_sync_connected"; // W5: set/cleared by whichever transport connects (dropboxTransport.js today) -- a plain synchronous flag so the boot-time gate below never needs to await a native call
const SYNC_ROSTER_DROPOUT_MS = 365 * 24 * 60 * 60 * 1000; // wrapper-plan.md §4.5: a year, deliberately generous
const SYNC_GATE_TIMEOUT_MS = 5000; // §4.3: how long a sweep waits for a pull before sweeping local-only anyway
// (W7 removed the last reader of a session-start timestamp -- the sweep gate's
// timeout now runs from its own first refusal, not from boot. See
// canSweepAccumulated.)

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

// DERIVED STATE MUST NOT TRAVEL (wrapper-plan.md §4.2, and trap #4: "Syncing
// derived state doubles the conflict surface for no benefit and makes every
// pseudo-action a potential collision"). The rule was ruled; the code did not
// implement it until the author asked how tombstones were generated.
//
// A pseudo-action is the row an event mints into Next Actions on its day. It
// lives in gtd_tasks_next -- a synced store -- but is a pure function of
// (gtd_events, today), which every device recomputes for itself in
// processEventBoundaries(). It is identified by carrying an eventId.
//
// Two separate harms, both real:
//   1. It travelled, so two devices could collide over a row neither of them
//      authored.
//   2. Worse, its REMOVAL wrote a tombstone. events.js's removePseudoRow()
//      drops the row and saves the lane, which reads as a deletion. But the
//      id is ev.taskId -- STABLE per series, re-minted every occurrence. So
//      one device rolling past an occurrence published "record T is deleted"
//      for an id the other device was legitimately displaying, and the merge
//      would honour it. A recurring event could delete its own live row on
//      the other device, every single day.
function isDerivedRecord(key, r){
  return key === "gtd_tasks_next" && !!(r && r.eventId);
}
function stripDerived(key, arr){
  // Array.isArray, not `arr || []`: chunks A and B reshaped four stores from
  // keyed objects to record arrays, and an install that has not re-saved them
  // yet still holds the old shape. A plain object is truthy and has no
  // .filter, so the old guard threw here -- on exportBundle, i.e. on the FIRST
  // SYNC AFTER UPGRADING. app.js normalizes those stores at boot so nothing is
  // lost; this makes the crash impossible even if that has not run.
  if (!Array.isArray(arr)) return [];
  return arr.filter(function(r){ return !isDerivedRecord(key, r); });
}

function exportBundle(){
  const stores = {};
  SYNC_STORE_KEYS.forEach(function(k){ stores[k] = stripDerived(k, Storage.getJSON(k, [])); });
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
  // suppressLocalChange, not a subtlety: without it every merge would look
  // like fourteen local edits and schedule another sync, which would import
  // again, forever. A sync's own writes are never "a local change."
  suppressLocalChange = true;
  try {
    Storage.set(SYNC_ROSTER_KEY, JSON.stringify(bundle.roster));
    Storage.set(SYNC_TOMBSTONE_KEY, JSON.stringify(bundle.tombstones));
    SYNC_STORE_KEYS.forEach(function(k){
      // Derived rows never left this device, so the merged bundle has none --
      // writing it verbatim would wipe THIS device's live pseudo-actions until
      // the next sweep re-minted them (a visible flicker at best). Carry the
      // local ones across untouched. stripDerived on the incoming side too, so
      // a bundle written by an older build that DID publish them gets cleaned
      // rather than reintroducing the collision.
      const localDerived = (Storage.getJSON(k, []) || []).filter(function(r){ return isDerivedRecord(k, r); });
      const incoming = stripDerived(k, bundle.stores[k] || []);
      Storage.set(k, JSON.stringify(localDerived.concat(incoming)));
    });
  } finally {
    suppressLocalChange = false;
  }
}

// ---------------------------------------------------------------------
// SYNC ON SAVE (author ruling, 2026-07-30, reversing the earlier "four
// triggers only" decision -- open/resume/backgrounding/manual). Without
// this, a record created on one device sits unpublished until the app
// happens to be backgrounded or the button is pressed, which is exactly
// how a real cross-device test lost half an hour to "I synced on the other
// device and nothing came through" -- the ORIGIN device had never pushed.
//
// THE GUARANTEE THE AUTHOR ASKED FOR -- "if I save several items while
// offline, the next sync will include those items regardless of whether
// the sync was caused by the save of another item" -- holds structurally,
// not by bookkeeping: a sync always pushes exportBundle(), the WHOLE local
// state, never a per-item queue or delta. There is no list of pending
// changes that could miss an entry, so any successful sync, whatever
// triggered it, publishes every unsynced save at once. Failed syncs
// (offline) leave local storage untouched and need no retry queue for the
// same reason.
// ---------------------------------------------------------------------
let suppressLocalChange = false;
let localChangeHook = null;
function setOnLocalChange(fn){ localChangeHook = fn; }

// Called by storage.js on every successful write (it is the single choke
// point every write in the app already goes through -- CLAUDE.md). Filters
// to the stores that actually sync: device-local keys (gtd_collapsed,
// gtd_surface, gtd_locale, gtd_tray_draft) and dev scaffolding must never
// schedule network work.
function noteSyncedWrite(key){
  if (suppressLocalChange) return;
  if (key !== SYNC_TOMBSTONE_KEY && SYNC_STORE_KEYS.indexOf(key) === -1) return;
  if (localChangeHook) localChangeHook();
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

// ---------------------------------------------------------------------
// PER-FIELD MERGE (chunk B; author's ruling, sync-audit.md §4b)
//
// The whole record used to be the merge unit, so two edits to the SAME item
// collided even in unrelated fields: change a habit's description on the
// phone and its temptation bundle on the computer, and one whole record won
// — the other edit gone, nothing warning you, and the two edits never having
// touched the same field. Ordinary use, invisible mechanism.
//
// ⚑ AND IT NEEDS NO SCHEMA CHANGE, correcting this document's own earlier
// estimate that every record would have to carry per-field timestamps. It
// does not: the BASELINE — the last state this device knows both sides
// agreed on — is already a merge base, which makes this an ordinary
// three-way merge:
//
//     field equal on both sides            -> take it, no question
//     differs, but local still == baseline -> only THEY changed it -> theirs
//     differs, but remote still == baseline-> only WE changed it   -> ours
//     both differ from baseline            -> a genuine field conflict
//
// Only that last case needs a tie-break, and it uses the same newest-wins
// rule as before, at field granularity. So the fix is strictly a refinement:
// everything that used to be reported as a conflict and resolved by
// timestamp still is — but only for the fields actually in dispute, instead
// of dragging every other field down with it.
//
// With no baseline there is no merge base and a three-way merge is not
// defined, so this falls back to whole-record newest-wins, matching the
// additive-only posture §4.5 already takes for a device with no history.
// Bookkeeping ABOUT the record, not content OF it. Excluded from the
// comparison entirely and set explicitly below. Missing this made every
// ordinary one-sided update look like a conflict: two records edited at
// different moments always disagree about modifiedAt, so the field-by-field
// pass reported it every single time and would have buried the real
// collisions in noise. Caught by checks/sync_chunk_b.py.
const FIELD_MERGE_METADATA = { id: true, modifiedAt: true, deviceId: true };

function mergeFields(l, r, b){
  const winner = newestOf(l, r);
  const loser = winner === l ? r : l;
  const out = {};
  const keys = {};
  Object.keys(l).forEach(function(k){ if (!FIELD_MERGE_METADATA[k]) keys[k] = true; });
  Object.keys(r).forEach(function(k){ if (!FIELD_MERGE_METADATA[k]) keys[k] = true; });
  const conflicted = [];
  if (l.id || r.id) out.id = l.id || r.id;
  Object.keys(keys).forEach(function(k){
    const lv = l[k], rv = r[k], bv = b ? b[k] : undefined;
    if (sameContent(lv, rv)){ out[k] = lv; return; }
    const lChanged = !sameContent(lv, bv);
    const rChanged = !sameContent(rv, bv);
    if (lChanged && !rChanged){ out[k] = lv; return; }
    if (rChanged && !lChanged){ out[k] = rv; return; }
    // Both moved since the baseline: a real disagreement about THIS field.
    out[k] = winner[k];
    conflicted.push(k);
  });
  // modifiedAt/deviceId describe the record, not any one field, and the
  // merged record is genuinely as new as its newest part.
  out.modifiedAt = Math.max(l.modifiedAt || 0, r.modifiedAt || 0);
  out.deviceId = winner.deviceId;
  return { record: out, conflictedFields: conflicted, loser: loser };
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
  // ⚑ W7 (author, after the first successful two-device sync): a record this
  // device has NEVER SEEN goes to the TOP, not the bottom.
  //
  // Everything the app creates locally is unshifted onto its lane (app.js:
  // capture, quick-add, convert, move-between-lanes all put the new thing
  // first), so an item arriving from the other device was the one kind of new
  // item that landed at the end -- inconsistent with the whole app, and
  // practically invisible: it appeared below whatever you were already
  // looking at, which on a full lane means off the bottom of the screen.
  //
  // Records BOTH devices already have keep their local position, so this
  // never reshuffles a lane you have arranged by hand; only genuinely new
  // arrivals move, and they move to where new things go.
  const ids = [];
  Object.keys(remote).forEach(function(id){ if (!local[id]) ids.push(id); });
  Object.keys(local).forEach(function(id){ ids.push(id); });
  const out = [];
  const conflicts = [];
  ids.forEach(function(id){
    const l = local[id], r = remote[id], b = baseline[id];
    if (l && r){
      if (sameContent(l, r)){ out.push(l); return; }
      // A store may know how to merge itself better than the generic rule
      // can -- habit runs do, because a day's outcome is an assertion rather
      // than an ordinary field (see mergeHabitRunRecord).
      if (ctx.mergeRecord){
        const custom = ctx.mergeRecord(l, r, b);
        out.push(custom.record);
        if (custom.conflict) conflicts.push(Object.assign({ store: ctx.store, id: id }, custom.conflict));
        return;
      }
      if (!b){
        // No merge base, so a three-way merge is undefined: fall back to
        // whole-record newest-wins, and report nothing -- without a baseline
        // there is no way to tell a conflict from one side simply being ahead.
        out.push(newestOf(l, r));
        return;
      }
      const merged = mergeFields(l, r, b);
      out.push(merged.record);
      // Only fields BOTH sides moved are a real disagreement. One side merely
      // being ahead of the baseline is a routine update and is applied
      // silently -- unchanged from before, just decided per field now.
      if (merged.conflictedFields.length){
        conflicts.push({ store: ctx.store, id: id, local: l, remote: r,
                         winner: merged.record, fields: merged.conflictedFields });
      }
      return;
    }
    if (l && !r){
      if (ctx.noBaseline || !b){
        // Additive: local creation, keep/push it. But a remote tombstone for
        // a record we are keeping is a RESURRECTION whichever branch notices
        // it, and §1 says it is never silent -- W7, found by
        // checks/restore_x_sync.py. This is the path a restored device takes
        // (a restore clears the baseline deliberately, so it rejoins
        // additive-only), which makes it exactly the case the user most wants
        // reported: the restore brought back something deleted elsewhere.
        // No noise on a genuine first join -- it fires only when the far end
        // holds a tombstone for an id this device actually has.
        const t0 = ctx.remoteTombstones[id];
        out.push(l);
        if (t0) conflicts.push({ store: ctx.store, id: id, resurrection: true, record: l, tombstone: t0 });
        return;
      }
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
      { store: key, noBaseline: noBaseline, mergeRecord: SYNC_RECORD_MERGERS[key],
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
// VALIDATE AT THE TRUST BOUNDARY (sync-audit.md §4c, chunk A). Everything
// below this line treats the remote bundle as foreign input, because it is:
// it was written by another device that may be running a different build of
// the app, and it arrives via a file anything on the machine can edit.
//
// The failure this prevents is the nastiest one available, and the author
// named it: the app syncs at STARTUP, so a record that breaks rendering
// breaks every launch, and reinstalling does not help because the cause is in
// the cloud file and is re-pulled the moment you reconnect. A data bug
// becomes an app you cannot open, on a phone, with no console.
//
// Deliberately minimal: this drops what is structurally unusable (not an
// object, no string id, a store that is not an array), and does NOT try to
// validate meaning. Enforcing app rules here — MAX_HOOKS, a schedule of
// exactly 7 days, a valid recurrence — would be a second rulebook to keep in
// step with the first, and getting it wrong would silently discard real data.
// Rendering defensively (app.js buildTree, and the nets contextId and habit
// hooks already have) is what makes odd-but-structurally-sound data safe.
function sanitizeRecordArray(arr){
  if (!Array.isArray(arr)) return [];
  return arr.filter(function(r){ return r && typeof r === "object" && !Array.isArray(r) && typeof r.id === "string"; });
}
function sanitizeBundle(b){
  const src = (b && typeof b === "object") ? b : {};
  const stores = {};
  SYNC_STORE_KEYS.forEach(function(k){
    stores[k] = sanitizeRecordArray(src.stores && src.stores[k]);
  });
  const roster = {};
  const rawRoster = (src.roster && typeof src.roster === "object") ? src.roster : {};
  Object.keys(rawRoster).forEach(function(id){
    const e = rawRoster[id];
    if (e && typeof e === "object") roster[id] = { lastPull: typeof e.lastPull === "number" ? e.lastPull : null };
  });
  return {
    roster: roster,
    // A tombstone needs its own fields to mean anything; one without them
    // cannot delete the right thing, so it is worse than useless.
    tombstones: sanitizeRecordArray(src.tombstones).filter(function(t){
      return typeof t.store === "string" && typeof t.recordId === "string" && typeof t.deletedAt === "number";
    }),
    stores: stores
  };
}

function reconcile(remoteBundle){
  const deviceId = getDeviceId();
  const baseline = loadBaseline();
  remoteBundle = sanitizeBundle(remoteBundle);
  let local = exportBundle();
  // Joining an existing system: drop this device's own seeded content first.
  if (!baseline && bundleHasAnyRecord(remoteBundle)) local = stripSeededRecords(local);
  const result = mergeBundles(local, remoteBundle, deviceId, baseline);
  // W7: a farewell sync REMOVES this device rather than stamping it, so the
  // roster stops counting a device that has deliberately left. mergeRoster
  // unions both sides, so the entry has to be deleted after the merge -- doing
  // it before would just have the remote's copy union straight back in.
  if (leavingRoster) delete result.merged.roster[deviceId];
  else result.merged.roster[deviceId] = { lastPull: Date.now() };
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
  lastPullAt = Date.now();
  gateWaitStartedAt = 0; // a pull landed; any wait in progress is satisfied
  return { conflicts: result.conflicts, bundle: result.merged, applied: true };
}

// wrapper-plan.md §4.3: "a device must pull before its sweep may persist
// accumulated state."
//
// ⚑ W7: this used to read state.sync.pulledThisSession, which is SESSION
// scoped, and to time its fallback out from sessionStart -- so a resident app
// that pulled once at 9am had the gate wide open at the 4am boundary the next
// morning and finalized the day on whatever it happened to be holding. Both
// halves were wrong for the same reason: the question is not "has this device
// pulled at all?" but "has it pulled since the thing it is about to finalize
// became final?" Callers pass that moment as sinceMs (app.js passes the
// boundary it is sweeping from); a caller with nothing specific in mind
// passes nothing and gets the old any-pull-will-do behavior.
//
// The timeout is the escape hatch for a slow or dead network, and it now runs
// from the first refusal rather than from session start, so it grants the
// same few seconds of grace at every boundary instead of being permanently
// expired on a long-lived session.
let lastPullAt = 0;
let gateWaitStartedAt = 0;
function canSweepAccumulated(sinceMs){
  if (!syncIsEnabled()) return true;
  if (lastPullAt && lastPullAt >= (sinceMs || 0)){ gateWaitStartedAt = 0; return true; }
  if (!gateWaitStartedAt) gateWaitStartedAt = Date.now();
  return (Date.now() - gateWaitStartedAt) > SYNC_GATE_TIMEOUT_MS;
}

// =========================================================
// RESTORING A BACKUP (W7, wrapper-plan.md §11 -- author's ruling).
//
// A backup is the USER'S DATA. It is not this device's place in the sync
// system, and importAllData used to make no distinction: it wiped every gtd_
// key and wrote back every gtd_ key in the file, sync's own bookkeeping
// included. Three things fell out, and the worst was the quietest --
// restoring a phone backup onto a new computer, which is the NORMAL way to
// set one up, gave two devices the SAME IDENTITY. The roster then held one
// entry for two devices, tombstone GC (§4.5, "oldest last pull across every
// device") was computed over a device set that was wrong, and the deviceId
// tie-break stopped distinguishing them.
//
// THE RULING, in two halves:
//
//   (a) A RESTORE IS THE TRUTH and propagates outward. Every restored record
//       is stamped modifiedAt = now, so it beats an earlier deletion on the
//       other device rather than being silently re-deleted by it. That
//       re-deletion was the sharpest failure of §1's never-silent standard in
//       the whole audit: mergeRecordArray's `l && !r` branch drops the record
//       and returns WITHOUT recording a conflict. A now-stamped record takes
//       the resurrection path instead, which does report.
//
//   (b) IDENTITY IS NEVER RESTORED. The device keeps its own id and rejoins
//       fresh. Baseline, tombstones and roster are CLEARED rather than
//       imported -- and clearing beats keeping, because after a restore this
//       device's data no longer matches its old baseline either, and a
//       baseline is precisely what licenses inferring "absent means deleted".
//       With none, §4.5 makes the next sync additive-only in both directions:
//       a restore asserts what it contains and infers nothing from what it
//       does not. So restoring January's backup cannot silently delete what
//       the other device did in February.
//
// gtd_sync_connected stays local too: a backup saying "connected" does not
// make a fresh machine connected -- it has no token.
const SYNC_MACHINERY_KEYS = [SYNC_DEVICE_ID_KEY, SYNC_BASELINE_KEY, SYNC_CONNECTED_KEY,
                             SYNC_TOMBSTONE_KEY, SYNC_ROSTER_KEY];
function isSyncMachineryKey(k){ return SYNC_MACHINERY_KEYS.indexOf(k) !== -1; }

// (a). Only the stores the merge engine actually reasons about; everything
// else in a backup is settings, which no device contests.
function stampRestoredRecords(data){
  const now = Date.now();
  const deviceId = getDeviceId();
  SYNC_STORE_KEYS.forEach(function(k){
    if (typeof data[k] !== "string") return;
    let arr;
    try { arr = JSON.parse(data[k]); } catch (e){ return; }
    // A backup predating chunk A/B holds keyed objects for the reshaped
    // stores. Left alone deliberately: normalizeReshapedStores() converts
    // them at the next boot and backfillModifiedAt() stamps them there.
    if (!Array.isArray(arr)) return;
    arr.forEach(function(r){
      if (!r || typeof r.id !== "string") return;
      r.modifiedAt = now;
      r.deviceId = deviceId;
    });
    data[k] = JSON.stringify(arr);
  });
  return data;
}

// (b). Called AFTER the restored keys are written, so nothing it clears can
// be resurrected by the write that follows it.
function resetSyncIdentityAfterRestore(){
  Storage.remove(SYNC_BASELINE_KEY);
  Storage.remove(SYNC_TOMBSTONE_KEY);
  Storage.remove(SYNC_ROSTER_KEY);
}

// ---------------------------------------------------------------------
// LEAVING THE ROSTER (W7, author's suggestion).
//
// "Hitting Disconnect in the main menu and hitting Disconnect and Restore are
// both signals of intent that the device no longer wants to be on the roster."
// Exactly right, and it matters more than it looks: §4.5's tombstone GC keeps
// every tombstone until the OLDEST last-pull across every rostered device, so
// one abandoned entry pins the GC horizon for a year (SYNC_ROSTER_DROPOUT_MS)
// and every device carries tombstones it could have dropped.
//
// Implemented as a flag rather than a separate code path so the farewell push
// goes through the SAME transport orchestration as every other sync -- the
// alternative was a second, near-identical push routine in each of the two
// transports. reconcile() consults it in the one place it would otherwise
// stamp this device's own lastPull.
let leavingRoster = false;
function setLeavingRoster(on){ leavingRoster = !!on; }
// How many devices this device last saw sharing the file. Used to decide
// whether a propagating reset is even a meaningful thing to offer.
function rosterDeviceCount(){
  const roster = Storage.getJSON(SYNC_ROSTER_KEY, {});
  return roster && typeof roster === "object" ? Object.keys(roster).length : 0;
}

// Keys a RESTORE-TO-DEFAULTS must not wipe. Device identity above all: reset
// used to clear it, so every reset minted a new id and abandoned the old one
// in the roster -- the same defect class as the import bug, arrived at from
// the other direction. The baseline survives for a subtler reason, see
// app.js's eraseAllData: without it the next sync is a baseline-less rejoin,
// stripSeededRecords fires, and the freshly seeded defaults are withheld from
// the push -- so the other devices would be emptied and never reseeded.
const SYNC_RESTORE_SURVIVOR_KEYS = [SYNC_DEVICE_ID_KEY, SYNC_CONNECTED_KEY,
                                    SYNC_BASELINE_KEY, SYNC_TOMBSTONE_KEY];
function isRestoreSurvivorKey(k){ return SYNC_RESTORE_SURVIVOR_KEYS.indexOf(k) !== -1; }

const Sync = {
  getDeviceId: getDeviceId,
  setLeavingRoster: setLeavingRoster,               // W7: disconnect takes this device off the roster
  rosterDeviceCount: rosterDeviceCount,             // W7: is a propagating reset meaningful here?
  isRestoreSurvivorKey: isRestoreSurvivorKey,       // W7: what a restore-to-defaults must keep
  isSyncMachineryKey: isSyncMachineryKey,           // W7: what a backup must never carry in
  stampRestoredRecords: stampRestoredRecords,       // W7: (a) a restore is the truth
  resetSyncIdentityAfterRestore: resetSyncIdentityAfterRestore, // W7: (b) rejoin fresh
  isEnabled: syncIsEnabled,
  setConnected: setSyncConnected,
  exportBundle: exportBundle,
  importBundle: importBundle,
  mergeBundles: mergeBundles,
  reconcile: reconcile,
  canSweepAccumulated: canSweepAccumulated,
  setAfterImport: setAfterImport,   // app.js registers its "reload memory from storage" here
  setApplyGate: setApplyGate,       // app.js registers "is a drafting page open?" here
  setOnLocalChange: setOnLocalChange, // app.js registers its debounced "push after a save" here
  registerRecordMerger: registerRecordMerger, // app.js registers the habit-run merge here
  mergeFields: mergeFields,         // the generic three-way field merge, reused by that habit merge
  storeKeys: SYNC_STORE_KEYS // read-only reference W5's transport needs to build an empty/first-sync bundle without duplicating this list
};
window.__oelaSync = Sync; // W5's hook, and this chunk's own test harness -- not a user-facing feature

const BUILD_STAMP = "__BUILD_STAMP__";  // replaced by build.py

// =========================================================
// STORAGE ADAPTER (spec.md §3, known issue 4)
//
// Every localStorage access in the app goes through this module — nothing
// else calls window.localStorage directly. Three stores grow forever by
// ruling (completed archives, habit run histories, archived Waiting sets),
// so this app WILL eventually hit localStorage's ~5MB ceiling. Before this
// adapter existed, every setItem was uncaught: a QuotaExceededError mid-save
// could throw partway through a multi-store commit, leaving state
// half-persisted with no user-visible error. This catches that and surfaces
// it instead, via the app's own dialog (native alert/confirm/prompt are
// banned app-wide — CLAUDE.md).
// =========================================================
// =========================================================
// NATIVE MIRROR (W2, wrapper-plan.md) — write-behind, wrapper-only.
//
// localStorage in an Android WebView is a cache the OS believes it may
// reclaim ("Clear storage", or eviction under disk pressure). Durable native
// storage is not. Every gtd_ write additionally mirrors to it; on boot, if
// localStorage looks wiped and the mirror still holds data, that data is
// copied back before the app reads anything. localStorage stays the
// synchronous working store — nothing above this file learns a promise
// exists; the mirror is entirely fire-and-forget.
//
// window.Capacitor is only present inside the wrapper (injected by the
// native shell the moment its bridge attaches), so every function here is a
// silent no-op in a plain browser tab, GitHub Pages included — same as the
// service worker's wrapper check (swClient.js).
//
// Preferences (small keys) vs Filesystem (anything that outgrows it): the
// split wrapper-plan.md calls for, not a simplification of it. There is no
// documented hard ceiling for Capacitor's Preferences plugin on Android (it
// is backed by SharedPreferences, which reads/writes its whole file on every
// access) — ⚑ 200,000 characters is a builder's-call threshold, comfortably
// under where that would ever become a problem, not a measured limit. A key
// is written to exactly one store at a time; crossing the threshold moves it
// and best-effort deletes the stale copy from the other, so restore never
// has to reconcile two versions of the same key.
// =========================================================
const MIRROR_PREFIX = "gtd_"; // gtddev_ is dev scaffolding — never mirrored, doesn't need to survive a wipe
const MIRROR_DIR = "gtd_mirror";
const MIRROR_LARGE_THRESHOLD = 200000; // chars — see note above

function nativeMirrorPlugins(){
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return null;
  const p = window.Capacitor.Plugins;
  if (!p || !p.Preferences || !p.Filesystem) return null;
  return p;
}
function mirrorWrite(key, value){
  if (key.indexOf(MIRROR_PREFIX) !== 0) return;
  const p = nativeMirrorPlugins();
  if (!p) return;
  if (value.length > MIRROR_LARGE_THRESHOLD){
    p.Filesystem.writeFile({ path: MIRROR_DIR + "/" + key, data: value, directory: "DATA", encoding: "utf8", recursive: true }).catch(function(){});
    p.Preferences.remove({ key: key }).catch(function(){});
  } else {
    p.Preferences.set({ key: key, value: value }).catch(function(){});
    p.Filesystem.deleteFile({ path: MIRROR_DIR + "/" + key, directory: "DATA" }).catch(function(){});
  }
}
function mirrorRemove(key){
  if (key.indexOf(MIRROR_PREFIX) !== 0) return;
  const p = nativeMirrorPlugins();
  if (!p) return;
  p.Preferences.remove({ key: key }).catch(function(){});
  p.Filesystem.deleteFile({ path: MIRROR_DIR + "/" + key, directory: "DATA" }).catch(function(){});
}
// Mirror-on-write only mirrors a key WHEN it is next written -- confirmed on
// a real device (2026-07-29): after installing this chunk, only the one key
// a real boot-time write actually touched (gtd_habit_runs, via the B1 resume
// sweep) had a native copy; the other seven gtd_ keys, untouched since the
// update, had none. That is a real gap, not a theoretical one: data written
// before this feature existed would sit unprotected until something
// happened to save it again. Closed by backfilling every current key once
// per boot below -- cheap (a handful of fire-and-forget native calls,
// nothing awaited, nothing on a render path) and it converges immediately
// instead of eventually.
function backfillNativeMirror(){
  const p = nativeMirrorPlugins();
  if (!p) return;
  Storage.keys().forEach(function(k){
    if (k.indexOf(MIRROR_PREFIX) !== 0) return;
    const v = Storage.get(k);
    if (v != null) mirrorWrite(k, v);
  });
}
// The entire recovery path (wrapper-plan.md W2): called once at boot, before
// any app code reads localStorage, ONLY when localStorage holds no gtd_ key
// at all. A partially-populated store (e.g. tasks exist but the contexts
// registry predates chunk 3) is a known, legitimate shape handled elsewhere
// (initLocalData) and must never be mistaken for a wipe.
function restoreFromNativeMirrorIfWiped(){
  const p = nativeMirrorPlugins();
  if (!p) return Promise.resolve();
  const wiped = !Storage.keys().some(function(k){ return k.indexOf(MIRROR_PREFIX) === 0; });
  if (!wiped){ backfillNativeMirror(); return Promise.resolve(); }
  const fromPrefs = p.Preferences.keys().then(function(res){
    const ks = (res && res.keys) || [];
    return ks.filter(function(k){ return k.indexOf(MIRROR_PREFIX) === 0; }).reduce(function(chain, k){
      return chain.then(function(){
        return p.Preferences.get({ key: k }).then(function(r){
          if (r && r.value != null) window.localStorage.setItem(k, r.value);
        });
      });
    }, Promise.resolve());
  }).catch(function(){});
  const fromFiles = p.Filesystem.readdir({ path: MIRROR_DIR, directory: "DATA" }).then(function(res){
    const files = (res && res.files) || [];
    return files.filter(function(f){ return f.type === "file" && f.name.indexOf(MIRROR_PREFIX) === 0; }).reduce(function(chain, f){
      return chain.then(function(){
        return p.Filesystem.readFile({ path: MIRROR_DIR + "/" + f.name, directory: "DATA", encoding: "utf8" }).then(function(r){
          if (r && r.data != null) window.localStorage.setItem(f.name, r.data);
        });
      });
    }, Promise.resolve());
  }).catch(function(){});
  return Promise.all([fromPrefs, fromFiles]);
}

// =========================================================
// RECORD IDENTITY (W3, wrapper-plan.md) — modifiedAt + tombstones.
//
// The prerequisite for the sync engine, not the sync engine itself: nothing
// here merges anything, it only makes sure every record CAN be merged later
// by carrying a timestamp, and every delete leaves a trace instead of
// silently becoming indistinguishable from "never existed."
//
// Centralized here rather than at each mutation site. The plan's own audit
// (§3.3 S1) frames this as touching every create/edit/delete in the app --
// true of the obvious approach, but not the only one. Every one of those
// sites already funnels through exactly one of a handful of saveXxx()
// functions, each of which hands its WHOLE array to Storage.setJSON. Diffing
// that array against what was there a moment ago (read via Storage.getJSON,
// same key, before the overwrite) finds every created, changed, and removed
// record for free -- correct by construction for every store shaped this
// way, present or future, the same reasoning that already made W2's mirror
// and this app's own serializeAllData() cheap. Nothing above this file, and
// no mutation site anywhere in app.js/events.js, needs to know this exists.
//
// Scope, flagged rather than hidden: this only covers stores shaped as a
// flat array of {id, ...} records -- tasks (all 5 kinds), events, notes,
// tags, contexts, the completed archives, and the capture tray. It does NOT
// cover gtd_habit_runs, gtd_habit_done, gtd_habit_done_order, or the
// gtd_archived_* maps: those are keyed objects, not record arrays, and
// habit_runs in particular is already flagged (§4.2/§4.3) as needing its own
// bespoke handling tied to the sweep-ordering rule -- that's W4 work, done
// once, not guessed at here. Records that end up archived (gtd_archived_*)
// already carry a correct, frozen modifiedAt from their life in a covered
// store before archiving, so this gap is narrower than the exclusion list
// makes it look.
//
// Tombstones live in their own append-only store (gtd_tombstones), not as
// in-place markers in the original array -- every existing reader of
// state.tasks/events/notes/etc. keeps working completely unchanged, because
// a deleted record still just isn't there. Each tombstone is itself a
// {id, ...} record, so it flows through this exact same mechanism when
// appended (new entries get stamped; nothing is ever removed FROM the
// tombstone log, so it can never trigger tombstoning itself). Unbounded
// growth here is the same accepted, already-flagged tradeoff as the
// completed archives and habit histories (spec.md known issue 4) --
// unaddressed for the same reason, not a new one.
//
// ⚑ Schema note (CLAUDE.md): no migration. Real use has not begun (this
// document, throughout), so existing records simply gain modifiedAt the
// next time their store is saved for any reason -- see
// backfillModifiedAt() in app.js, which forces that once at boot so
// coverage is immediate rather than eventual. A record deleted before this
// chunk existed leaves no tombstone; that history is genuinely gone, and
// Reset seeding fresh data in the new shape is the documented alternative
// to a migration, not an oversight.
// =========================================================
const TOMBSTONE_KEY = "gtd_tombstones";
const RECORD_ARRAY_EXCLUDE_PREFIXES = ["gtd_collapsed:"]; // Set<string> of ids, not records

function looksLikeRecordArray(key, v){
  if (key.indexOf(MIRROR_PREFIX) !== 0) return false;
  if (RECORD_ARRAY_EXCLUDE_PREFIXES.some(function(p){ return key.indexOf(p) === 0; })) return false;
  return Array.isArray(v) && v.every(function(x){ return x && typeof x === "object" && !Array.isArray(x) && typeof x.id === "string"; });
}
// Deep, key-sorted JSON so two records that differ only in property
// insertion order (very possible: one came from JSON.parse, the other from
// live app code) don't read as "changed." modifiedAt itself is always
// excluded -- it's the field this comparison exists to decide whether to
// update, not content to compare.
function canonicalJSON(value){
  function sorted(v){
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object"){
      const out = {};
      Object.keys(v).filter(function(k){ return k !== "modifiedAt"; }).sort().forEach(function(k){ out[k] = sorted(v[k]); });
      return out;
    }
    return v;
  }
  return JSON.stringify(sorted(value));
}
function appendTombstones(store, ids, when){
  const list = Storage.getJSON(TOMBSTONE_KEY, []);
  ids.forEach(function(id){
    list.push({ id: genId(), store: store, recordId: id, deletedAt: when, modifiedAt: when });
  });
  Storage.setJSON(TOMBSTONE_KEY, list);
}
// Mutates the records in `arr` IN PLACE (so `state` and what gets persisted
// never disagree about a record's own modifiedAt) and returns nothing --
// called for its side effects, immediately before the array is stringified.
function stampAndTombstone(key, arr){
  const prev = Storage.getJSON(key, null);
  const prevById = {};
  if (Array.isArray(prev)) prev.forEach(function(r){ if (r && typeof r.id === "string") prevById[r.id] = r; });
  const now = Date.now(); // wall-clock, deliberately not boundaryNow() -- QA time-jumps must never skew cross-device ordering
  const seen = {};
  arr.forEach(function(rec){
    if (!rec || typeof rec.id !== "string") return;
    seen[rec.id] = true;
    const old = prevById[rec.id];
    // New, content changed, or pre-W3 data that was never stamped: all three
    // get today's timestamp. An unrelated save of the same array (some OTHER
    // record edited) leaves an untouched record's existing modifiedAt alone.
    // deviceId rides along the same gate (W4, wrapper-plan.md §4.5) -- every
    // write is attributed to whichever device actually made it, which the
    // merge engine's tie-break and conflict report both need.
    if (!old || old.modifiedAt == null || canonicalJSON(old) !== canonicalJSON(rec)){
      rec.modifiedAt = now;
      rec.deviceId = getDeviceId();
    }
  });
  // DERIVED ROWS NEVER TOMBSTONE (author's question, 2026-07-30: "events
  // don't show up in the lanes until the day of either, and we don't want
  // those generating tombstones" -- exactly right, and they were).
  //
  // A pseudo-action leaves gtd_tasks_next every time its occurrence passes
  // (events.js removePseudoRow), which is an EXPIRY, not a deletion. Its id is
  // the event's stable taskId, re-minted on the next occurrence, so publishing
  // "this id was deleted" told every other device to delete a row it was
  // legitimately displaying -- and a daily series would have done it daily.
  // See sync.js isDerivedRecord for the other half (they never travel either).
  const removedIds = Object.keys(prevById).filter(function(id){
    return !seen[id] && !isDerivedRecord(key, prevById[id]);
  });
  if (removedIds.length) appendTombstones(key, removedIds, now);
}

const Storage = {
  get: function(key){
    try { return window.localStorage.getItem(key); }
    catch (e){ return null; }
  },
  getJSON: function(key, fallback){
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e){ return fallback; }
  },
  set: function(key, value){
    try {
      window.localStorage.setItem(key, value);
      mirrorWrite(key, value);
      // Sync-on-save (author ruling 2026-07-30). This is the single choke
      // point every write in the app goes through, which is what makes one
      // line here enough -- no call site has to remember to publish.
      // sync.js filters to synced stores and ignores its own imports.
      noteSyncedWrite(key);
      return true;
    } catch (e){
      Storage._onWriteError(e);
      return false;
    }
  },
  setJSON: function(key, value){
    if (looksLikeRecordArray(key, value)) stampAndTombstone(key, value);
    return Storage.set(key, JSON.stringify(value));
  },
  remove: function(key){
    try { window.localStorage.removeItem(key); }
    catch (e){ /* removal failing isn't a quota issue; nothing to surface */ }
    mirrorRemove(key);
  },
  keys: function(){
    try { return Object.keys(window.localStorage); }
    catch (e){ return []; }
  },
  // Only QuotaExceededError gets a user-facing message — other storage
  // failures here (disabled storage, privacy mode) are rarer and every
  // read already has a safe fallback, so the app keeps working with
  // whatever it had in memory.
  _onWriteError: function(e){
    if (e && e.name === "QuotaExceededError"){
      // ⚑ t() is safe here even though storage.js is concatenated BEFORE
      // i18n.js: this only ever runs on a failed write, long after parse, and
      // t() is a hoisted function declaration in the same IIFE (build.py's
      // module-order note). Only i18n's `const STRINGS` is order-sensitive,
      // and it is evaluated well before any user can trigger a quota error.
      openConfirmDialog(
        t("confirm.storageFull"),
        [{ label: t("confirm.ok"), style: "primary", action: function(){} }]
      );
    }
  }
};

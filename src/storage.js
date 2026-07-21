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
      return true;
    } catch (e){
      Storage._onWriteError(e);
      return false;
    }
  },
  setJSON: function(key, value){
    return Storage.set(key, JSON.stringify(value));
  },
  remove: function(key){
    try { window.localStorage.removeItem(key); }
    catch (e){ /* removal failing isn't a quota issue; nothing to surface */ }
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
      openConfirmDialog(
        "Storage is full — the last change couldn't be saved. Free up space " +
        "(clear old completed items, or Reset local data) and try again.",
        [{ label: "OK", style: "primary", action: function(){} }]
      );
    }
  }
};

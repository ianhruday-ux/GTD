// =========================================================
// EMERGENCY KILL SWITCH for the OELA service worker (chunk 9,
// service-worker-plan.md §10). NOT part of the normal build — build.py never
// touches this file. Kept here, ready to go, because the moment you need it
// is the worst possible moment to be writing it from scratch.
//
// WHEN TO USE THIS
// A bad deploy got precached, cache-first is now serving it to every
// installed copy, and a normal fix-forward build won't reach anyone until
// they see the update banner and tap Reload — which they can't do if the
// bad build itself is what's broken (e.g. the app won't load at all).
//
// WHAT IT DOES
// It caches nothing, deletes every existing cache, unregisters itself, and
// claims all open clients — so the very next load runs with NO service
// worker and a clean slate. It never touches localStorage/gtd_* data; only
// the Cache API is in scope for a SW, exactly like the real sw.js.
//
// HOW TO DEPLOY IT
//   1. Copy THIS FILE's contents over the deployed sw.js — i.e. replace
//      dist/sw.js with a copy of this file (do not run build.py, which would
//      regenerate the real one) — then commit and push straight to the
//      branch GitHub Pages serves.
//   2. Every client that opens the app fetches sw.js fresh (browsers never
//      cache this file), sees the bytes differ, installs this version, and —
//      because it calls skipWaiting()/clients.claim() itself, unlike the real
//      sw.js — takes over immediately, no update banner, no second reload.
//   3. Once every client is confirmed clean (or after enough time has
//      passed), run `python build.py` normally and deploy the real sw.js
//      again — a fresh content hash, so it's treated as a normal update.
//
// NON-TECHNICAL RECOVERY (per the user-non-technical memory, for the author
// or a tester who cannot do the above): fully close the app (swipe it away,
// don't just background it) and reopen it twice in a row. If it was
// installed to a home screen and still looks broken after that, remove it
// from the home screen and re-add it (Share -> Add to Home Screen again).
// =========================================================
"use strict";

self.addEventListener("install", function(){
  self.skipWaiting();
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys()
      .then(function(names){ return Promise.all(names.map(function(n){ return caches.delete(n); })); })
      .then(function(){ return self.registration.unregister(); })
      .then(function(){ return self.clients.claim(); })
  );
});

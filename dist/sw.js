// =========================================================
// SERVICE WORKER — chunk 9 (spec.md §sequencing; see service-worker-plan.md).
//
// Generated into dist/sw.js by build.py, which fills in the two placeholders
// below. This file is NOT run through the JS stapler (build.py's JS_MODULES) —
// it is its own top-level script with its own global scope, registered
// separately by src/swClient.js. Do not add it to JS_MODULES.
//
// Scope: offline + install polish only (service-worker-plan.md §2). No
// runtime network calls exist in this app, so there is exactly one strategy:
// cache-first, backed by the versioned-cache update flow below.
// =========================================================
"use strict";

const SW_VERSION = "d505c9960eb5";
const CACHE_NAME = "oela-" + SW_VERSION;
// Relative paths only — GitHub Pages serves this from a project subpath
// (…/GTD/), and an absolute "/index.html" would point at the domain root
// instead (service-worker-plan.md §9.1).
const PRECACHE_URLS = ["index.html", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // {cache:"reload"} bypasses the HTTP cache for the precache fetches
      // themselves, so a stale browser-cached copy can't sneak into a fresh
      // versioned cache.
      return Promise.all(PRECACHE_URLS.map(function(url){
        return cache.add(new Request(url, { cache: "reload" }));
      }));
    })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.filter(function(n){ return n !== CACHE_NAME; }).map(function(n){
        return caches.delete(n);
      }));
    }).then(function(){
      // Claim already-open clients immediately. On first install (no prior
      // SW) this is what lets the page that just installed us skip a manual
      // reload; on an update, the page only reaches here after the user has
      // already tapped Reload (src/swClient.js), so claiming is correct there
      // too (service-worker-plan.md §4.7).
      return self.clients.claim();
    })
  );
});

// The waiting worker only moves to activating when told to — src/swClient.js
// sends this after the user taps the update banner's Reload button
// (service-worker-plan.md §4.6). Never call skipWaiting() unconditionally
// here: that would apply an update to a page mid-edit with no prompt.
self.addEventListener("message", function(event){
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function(event){
  const req = event.request;
  if (req.method !== "GET") return;

  // Navigation-fallback trap (service-worker-plan.md §9.2): a request for the
  // bare scope root and a request for index.html are different cache keys.
  // Every navigation gets the one cached document regardless of which URL it
  // asked for, so a cold offline launch of the bare directory URL still works.
  if (req.mode === "navigate"){
    event.respondWith(
      caches.match("index.html").then(function(cached){
        return cached || fetch(req);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function(cached){
      return cached || fetch(req);
    })
  );
});

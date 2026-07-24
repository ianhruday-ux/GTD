// =========================================================
// SERVICE WORKER — client half (chunk 9, service-worker-plan.md §4).
// Registers dist/sw.js and drives the one user-visible surface it has: the
// non-modal "New version available" banner. Draft isolation (CLAUDE.md)
// doesn't apply here — there's no page to discard, just a reload the user
// explicitly asks for.
//
// Deliberately skipped on file: — a SW can't register against a file: origin
// at all (the browser refuses), and this is exactly how the author normally
// opens dist/index.html for a quick local look (per the commands in
// CLAUDE.md: "opened directly in a browser or served from GitHub Pages").
// That already keeps the SW out of the ordinary local dev-loop without any
// hostname sniffing — which matters because a hostname-based localhost no-op
// would also have silently disabled the SW for these checks/*.py Playwright
// suites, which serve dist/ over http://127.0.0.1 to drive the real thing.
// =========================================================
let swPendingWorker = null; // the current waiting worker the Reload button targets

function initServiceWorker(){
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", function(){
    if (refreshing) return;   // reload-loop guard (plan §4, "Reload-loop guard")
    refreshing = true;
    location.reload();
  });

  navigator.serviceWorker.register("sw.js").then(function(reg){
    if (reg.waiting && reg.active) showSwUpdateBanner(reg.waiting);
    reg.addEventListener("updatefound", function(){
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", function(){
        if (installing.state !== "installed") return;
        // A controller already exists -> this install is replacing a running
        // version, i.e. an UPDATE. No controller -> first install ever; the
        // plan is explicit that this case gets no banner (plan §4.7) — there
        // is no "old version" for the user to be reloading away from.
        if (navigator.serviceWorker.controller) showSwUpdateBanner(installing);
      });
    });
  }).catch(function(){
    // Registration can fail (e.g. blocked storage). The app already works
    // fully without a SW — it only adds offline/instant-load on top — so
    // there is nothing to surface to the user here.
  });
}

function showSwUpdateBanner(worker){
  swPendingWorker = worker; // rebindable: a second update before Reload retargets this, not the first worker
  const el = qs("#sw-update-banner");
  if (!el) return;
  el.hidden = false;
  const btn = qs("[data-action='sw-reload']", el);
  if (btn && !btn.dataset.bound){
    btn.dataset.bound = "1";
    btn.addEventListener("click", function(){
      if (swPendingWorker) swPendingWorker.postMessage({ type: "SKIP_WAITING" });
    });
  }
}

// Static markup, translated like the tab labels (renderTabLabels) — set once
// at boot and again on a language switch (applyLocale), independent of
// whether the banner is currently shown.
function renderSwUpdateBannerLabels(){
  const el = qs("#sw-update-banner");
  if (!el) return;
  const msg = qs(".sw-update-msg", el);
  if (msg) msg.textContent = t("sw.updateBanner.message");
  const btn = qs("[data-action='sw-reload']", el);
  if (btn) btn.textContent = t("sw.updateBanner.reload");
}

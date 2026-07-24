# Service worker — implementation plan and traps (chunk 9)

**Read this alongside `spec.md` (chunk 9 row, line ~124, and the sequencing note at ~129–133).**
This document records the design decisions taken in the planning conversation, maps the work onto
the existing build system, and — its main job — lists the traps a service worker (SW) build session
is likely to fall into. A SW is the one feature in this app that can brick every installed copy at
once; the traps section and the kill switch are not optional reading.

This is a **planning document. Nothing here is built yet.** Where it says "decided," the author ruled
it in conversation (2026-07-24). Where it says "builder's call," pick the simplest option and flag it
in the handoff, per CLAUDE.md.

---

## 0. When this ships, and why not before

The spec is emphatic and this plan does not reopen it: **the service worker is chunk 9, deliberately
last, and this is not negotiable** (spec.md §sequencing). A SW caches aggressively; during active
development that means hours lost to "why am I still seeing the old version." It ships only once the
app has *stopped changing* — i.e. after distribution prep, with the calendar (chunk 7), export/import
(chunk 8) already in. Writing the plan now is fine; building it now is the exact mistake the spec
names.

**Do not begin the build until the app is feature-frozen for distribution.** If a session picks this
up while chunks 7–8 are still moving, stop and confirm with the author.

---

## 1. The two questions CLAUDE.md requires

A SW is mostly infrastructure, but it has one genuinely user-facing surface — the "new version"
prompt — so the questions are worth answering, briefly:

- **Purpose of the system:** make the app open instantly and work with **zero network, forever**,
  and make a deployed update reach an already-open/installed copy *predictably* instead of
  whenever the browser happens to notice. It underwrites the app's core promise (local-first, no
  server, no account) at the transport layer.
- **What the UI teaches:** almost nothing, by design — a good SW is invisible. The single visible
  moment is the update prompt, and what it teaches is *"you are in control of when the app
  changes; it will not swap under you mid-edit."* That is the whole reason the silent-update option
  was rejected below.

---

## 2. Decisions locked in the planning conversation (do not re-litigate)

1. **Update UX = explicit "update ready" prompt.** Cache-first for instant load and full offline.
   A new build downloads in the background; when it is installed and waiting, the app shows a small,
   non-intrusive banner — *"New version available — Reload"* — and applies the update **only when
   the user taps it**. No surprise reloads, ever, and never mid-edit. (§4 details the mechanics.)
2. **Scope = offline + install polish only.** Exactly what chunk 9 defines: precache the app shell,
   detect and prompt updates, tidy the install experience on each platform. **Notifications /
   reminders are explicitly out of scope** — a SW is their prerequisite, but planning them here
   would expand chunk 9 beyond the spec. Recorded as a future hook in §8, not planned.
3. **Targets = Android + desktop/Windows (long-term focus) AND iOS Safari (short-term, for
   testers).** The author is distributing to friends on the devices they already own, so **iOS is
   in scope from day one.** The offline+update-prompt core is the same code on all three; iOS needs
   an install-instruction card and awareness of its weaker storage durability (§6, §7). See §6 for
   the platform matrix.

---

## 3. What gets cached, and the caching strategy

The product is a **single self-contained `dist/index.html` (~904 KB)** plus a few small static
assets. The entire app is tiny, so **precache everything up front** — no runtime/lazy caching
complexity is warranted.

**Precache list (everything `build.py` puts in `dist/`, except the baseline):**

| File | Notes |
| --- | --- |
| `index.html` | The whole app — HTML + all CSS + all JS, stapled. |
| `manifest.webmanifest` | Referenced by `<link rel="manifest">`. |
| `icon.svg`, `icon-192.png`, `icon-512.png` | Manifest + `apple-touch-icon`. |
| *(the app scope root, `./`)* | So a launch of the bare directory URL resolves offline — see the navigation-fallback trap in §9. |

> `dist/index.baseline.html` is a dev artifact and is git-ignored — **never** precache it.

**Strategy per request type:**

- **App shell (the HTML document / navigations):** **cache-first**, backed by the update flow in
  §4. This is what makes launch instant and fully offline. The update prompt is what keeps
  cache-first from meaning "stuck on an old build."
- **Static assets (icons, manifest):** **cache-first**; they change only when the shell does and are
  covered by the same version bump.
- **Everything else:** there is nothing else. The app makes **no network requests at runtime** —
  local-first, no CDN, no fonts, no analytics. If a future chunk adds a genuine network call, it
  gets its own strategy then; do not build speculative runtime caching now.

---

## 4. The update mechanism (the heart of chunk 9)

This is where PWAs go wrong. The flow, precisely:

1. **Versioned cache name.** Each build stamps the SW with a **version token**, and the cache is
   named after it (e.g. `oela-v<token>`). On `activate`, the SW deletes every cache whose name is
   not the current one. A new version therefore gets a *fresh* cache and cannot serve stale files.
2. **Version token must be unique per build.** ⚠️ **Do not reuse `build_stamp()` as-is** — it is
   `"%d %b %H:%M"` (minute resolution), so two builds in the same minute collide and the second
   would be served from the first's cache. Use a **content hash of the built `index.html`** (plus
   assets) as the token, or append seconds/a counter. Builder's call which; content hash is the
   robust choice and also means "no bytes changed → same version → no needless update prompt."
3. **Registration.** In `src/index.html` (or a small block in `src/app.js`), register with a
   **relative** path: `navigator.serviceWorker.register('sw.js')`. Relative matters for the Pages
   subpath — see §9.
4. **Update detection.** On each load, the browser re-fetches `sw.js`; if the bytes differ, the new
   SW installs and enters the **waiting** state (the old one still controls the page). Listen for
   `registration.updatefound` → track the installing worker → when its state hits `installed` **and**
   `navigator.serviceWorker.controller` exists (i.e. this is an *update*, not first install), show
   the banner.
5. **The banner.** A small bar/toast, styled to match the app (reuse existing toast/dialog chrome if
   present): *"New version available"* + a **Reload** button. Non-modal, dismissible, never steals an
   in-progress edit. Wording goes through i18n (`t(...)`) — **EN + ZH**, per the bilingual work just
   shipped.
6. **Applying the update.** Reload button → `postMessage({type:'SKIP_WAITING'})` to the waiting SW →
   SW calls `self.skipWaiting()` → page listens for `controllerchange` → `location.reload()` **once**
   (guard against reload loops with a flag). Cache-first means the reload is instant; the user sees
   the new build immediately.
7. **First install (no controller yet):** precache silently, **no banner** — there is no "old
   version" to update from. `clients.claim()` on activate so the freshly-installed SW controls the
   already-open page without a manual reload.

**Reload-loop guard (do not skip):** a naive `controllerchange → reload` can loop if multiple tabs
race. Use the well-known one-shot flag pattern (`let refreshing = false;`).

---

## 5. Build-system changes required

The SW must land in `dist/` and know its precache list + version. Fold it into `build.py` so it can
never drift from what actually shipped:

- **Add `src/sw.js`** as a template with placeholders, e.g. `__SW_VERSION__` and
  `__SW_PRECACHE__`.
- **In `build()`:** compute the version token (content hash of the built output — see §4.2), and the
  precache list (derive it from `ASSET_FILES` + `index.html` so it stays in sync automatically — do
  **not** hand-maintain a second list). Substitute both into `sw.js` and write it to `dist/sw.js`.
- **Do not run `sw.js` through the JS stapler** — it is a separate top-level script with its own
  global scope, not part of the `(function(){...})()` bundle in `index.html`.
- **`pages.yml` needs no change** — it uploads all of `dist/`, so `dist/sw.js` deploys automatically.
- **Registration snippet** in `src/index.html`/`src/app.js` (see §4.3), guarded by
  `if ('serviceWorker' in navigator)`.

**⚠️ The `--watch` / local-dev trap:** the whole reason the SW is last is that it poisons local
iteration. Give the build a way to **omit or disable** the SW during development — e.g. a
`build.py --no-sw` flag, or have the registration no-op on `localhost`/`file://`. Decide this before
building; a session that ships a SW into its own dev loop will relearn the spec's warning the hard
way.

---

## 6. Platform matrix

| Capability | Android / Chrome | Desktop (Chrome/Edge/Firefox) | iOS Safari |
| --- | --- | --- | --- |
| Service worker + offline cache | ✅ Full | ✅ Full | ✅ Works (iOS 11.3+) — **same code** |
| Update prompt (§4) | ✅ | ✅ | ✅ |
| Install to home screen / dock | ✅ Prompt available | ✅ Installable PWA | ⚠️ **Manual only**: Share → "Add to Home Screen". No prompt. |
| Storage durability | Strong | Strong | ⚠️ **Weaker** — eviction possible after ~7 days unused; home-screen install helps a lot. |
| Web push / notifications | ✅ (out of scope) | ✅ (out of scope) | ⚠️ Home-screen install only, iOS 16.4+ (out of scope) |

**The offline + update-prompt core is one codebase across all three.** iOS-specific work is small:

- **Install-instruction card for iOS testers.** Since Safari shows no install prompt, iOS users need
  a short in-app or hand-off note: *tap Share → "Add to Home Screen."* A few lines of copy + a
  screenshot; EN + ZH. This is onboarding, not code. Builder's call whether it lives in the app
  (e.g. a detected-iOS hint) or the distribution message; simplest is the distribution message.
- **Confirm the existing `<meta>`/manifest cover iOS.** `apple-touch-icon` and `theme-color` are
  already present (`src/index.html`). Verify `display: standalone` + portrait behave in an iOS
  home-screen launch; the desktop-redesign round already deals with standalone insets on mobile.

---

## 7. The coupled second gate — data & the storage-durability risk

The memory and spec both note real use is gated on **two** things: the SW *and* "an update strategy
for when real data is already in the app." They are coupled and this plan must not pretend the SW
alone opens the door.

- **The SW never touches user data.** It caches *app code* (the Cache API); user data lives in
  `localStorage` (via `src/storage.js`). Clearing/rotating SW caches does not clear data. Good.
- **But a cache-first update can load *new code against old data*.** Post-chunk-9, migrations stop
  being optional (spec §1). So the mandatory-migration discipline and the SW ship together: once the
  SW can silently deliver new code to a device holding real data, that new code **must** be able to
  read the old shape. Flag this coupling loudly in the chunk-9 handoff.
- **iOS storage eviction is the real-data risk, not a tester risk.** For friends poking demo data,
  eviction is harmless (Reset reseeds). It matters only at real-use, and the spec already names the
  backstop: **export/import (chunk 8)**. The plan's only ask here is to make sure iOS testers who
  *do* start relying on it are told to (a) install to the home screen and (b) export periodically,
  until durable storage is proven.

---

## 8. Explicitly out of scope (future hooks, not chunk 9)

Recorded so a future session doesn't think they were forgotten:

- **Notifications / reminders** (deadlines, habits due, calendar events). A SW is the prerequisite;
  building on it is a *later* decision. iOS requires home-screen install + iOS 16.4+.
- **Background sync**, periodic background updates.
- **Runtime/lazy caching** — irrelevant while the app makes no runtime network calls.
- **Any cloud/multi-device sync** — parked for the sprint (spec §10).

---

## 9. Traps (read before writing a line)

1. **The GitHub Pages subpath.** The site is served from `https://ianhruday-ux.github.io/GTD/`
   (no `CNAME` in the repo → project subpath, not a root domain). A SW's scope is capped by the
   directory it is served from. Register with a **relative** URL (`register('sw.js')`, giving scope
   `/GTD/`) and keep the precache paths **relative** (`./index.html`, not `/index.html`). An absolute
   `/sw.js` or `/index.html` points at the domain root and will 404 / mis-scope. Verify the actual
   Pages URL before trusting this assumption.
2. **Navigation fallback.** With cache-first navigations, requests for `/GTD/` (bare directory) and
   for `/GTD/index.html` may be *different* cache keys. Precache the resolved document and add a
   fetch handler that serves the cached `index.html` for any navigation request within scope, so a
   cold offline launch of the bare URL still works.
3. **The build-stamp collision** (§4.2) — minute resolution is not a version. Use a content hash.
4. **Stapler contamination** — `sw.js` must not be wrapped in the app's IIFE bundle (§5).
5. **`skipWaiting` without the reload-loop guard** (§4) — multi-tab races cause refresh storms.
6. **Caching the SW file itself.** Ensure `sw.js` is served with a short/no cache lifetime (Pages
   controls headers, but the browser also treats `sw.js` specially: it byte-compares on each load).
   Do **not** add `sw.js` to its own precache list.
7. **The dev-loop poison** (§5) — the reason this chunk is last. Provide a `--no-sw`/localhost no-op.
8. **iOS assumptions** — do not assume an install prompt exists; do not assume storage is permanent.
9. **Icon/manifest scope** — precache the manifest and all icons, or an offline install shows a
   broken icon.

---

## 10. Kill switch / recovery (mandatory)

A bad SW can serve a broken build to every installed copy, and because it is cache-first, users may
never fetch the fix. **Plan the escape hatch before shipping the SW, not after.**

- **The reset SW.** Keep ready a minimal `sw.js` that caches nothing and, on activate, deletes all
  caches and calls `self.registration.unregister()` then `clients.claim()`. Deploying *this* as
  `sw.js` un-poisons every client on their next load. This is the single most important recovery
  lever; write it as part of chunk 9 and note it in the handoff.
- **Version-delete on activate** (§4.1) already limits blast radius: a good new version wipes the
  bad cache.
- **Non-technical recovery instruction** for the author/testers (per the user-non-technical memory):
  the plain-language "fully close the app and reopen twice" / "remove from home screen and re-add"
  steps, documented in the QA checklist copy for the chunk-9 round.

---

## 11. Testing plan

**Automated (Playwright, `tests/`):** SW registration succeeds; precache populated on install; an
offline navigation still renders the app; a version bump triggers the waiting state and the banner
appears; tapping Reload activates the new version. Chromium supports SWs headless, so most of this is
testable in the existing suite. iOS Safari cannot be tested in Playwright — it needs a real device.

**Manual, plain-language (for the author — non-technical):**
- *Offline:* open the app, turn on airplane mode, close and reopen — it should still load and work.
- *Update:* deploy a change, keep the app open on the phone, wait a moment — the "New version
  available" bar should appear; tap Reload; confirm the build stamp in the settings menu changed.
- *Per device:* run the offline + update check on Android, on desktop, and on an iPhone
  (home-screen install), since only the last exercises iOS's quirks.

**Definition of done:** app launches offline on all three platform classes; an update reaches an open
copy as a prompt (never a surprise reload); the reset SW is proven to recover a poisoned client; the
chunk-9 QA checklist + chunk-map entry are injected (CLAUDE.md conventions), in plain language.

---

## 12. Builder's calls flagged (simplest option, per CLAUDE.md)

- **Version token:** content hash recommended over a timestamp (§4.2).
- **Banner chrome:** reuse existing toast/dialog styling rather than invent new (§4.5).
- **Registration location:** inline in `src/index.html` vs. a block in `src/app.js` — either; pick
  whichever keeps the guard readable.
- **Dev disable mechanism:** `--no-sw` flag vs. localhost no-op (§5) — localhost no-op is
  lower-friction (nothing to remember).
- **iOS install card:** in-app detected hint vs. distribution-message copy (§6) — distribution
  message is simplest for a tester handoff.

Each should be confirmed or overridden in the chunk-9 handoff summary, not silently chosen.

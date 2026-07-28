# Native wrappers + cross-device sync — plan, audit and traps

**Read alongside `spec.md` §2 (stretch goal: native app wrappers), §3 (known issues 1, 4, 5, 6) and
§10 (cloud-file sync — direction adopted).** This document does not reopen those; it records the
decisions taken in the planning conversation of **2026-07-28**, audits the actual code against them,
and flags the existing problems found along the way.

This is a **planning document. Nothing here is built yet.** Where it says *ruled*, the author decided
it in conversation. Where it says *builder's call*, pick the simplest option and flag it in the
handoff, per CLAUDE.md. Where it says ⚑, it is a judgment call this document is making and the
author has not seen.

Every claim about the current code was verified against `src/` while writing, and cites `file:line`.
Where the spec and the code disagree, the code is reported.

---

## 0. The two goals, and the decisions already ruled

The wrapper exists to buy exactly two things. Everything else is a consequence.

1. **Fix the Android long-press drag bug** (`spec.md` §3 known issue 5).
2. **Sync between phone and computer.**

Ruled in conversation:

| Decision | Ruling |
|---|---|
| Android | **Capacitor**, wrapping `dist/index.html` in a WebView |
| Desktop | **Electron** (Windows first, Linux after). Ships Chromium, so the whole Playwright history keeps meaning what it says |
| Tauri | **Rejected.** Uses WebKitGTK on Linux — a different engine, which discards the Chromium test continuity and imports a new class of rendering bugs |
| Capacitor's Electron target | **Rejected.** Community-maintained and flaky. Two thin shells, one payload |
| macOS / iPhone | Unchanged from `spec.md` §2: macOS nice-to-have, iPhone abandoned |
| Sync topology | **Per-record**, not whole-blob. A short lock around each write; what travels under the lock is the touched records, not the world |
| Long-lived "baton" | **Rejected** (proposed and dropped in the same conversation). It solved a possession problem the author doesn't have, and taught "you are locked out" constantly |
| Conflict on the same record | **Keep the newest** |
| Offline | Not an edge case. Local-first is non-negotiable (CLAUDE.md), so divergence is guaranteed by design and must be reconciled, never prevented |

### Why per-record and not the obvious thing

Recorded so it isn't re-litigated. A lock around each write prevents **torn writes**. It does not
prevent **lost updates**, and lost updates are what eat data:

> 9am — desktop pulls; it holds your whole system as of 9am. 10am — on the phone you complete three
> actions and capture two notes; phone takes the lock, writes, releases, clean. 11am — at the
> desktop, which has not pulled since 9am, you complete one project; the desktop takes the lock (no
> contention, nobody is holding it) and writes **its whole blob**. That blob is "9am plus one
> change." The five phone changes are gone, with no error, and the lock worked perfectly.

This is precisely `spec.md` §10's "it passes every test and eats data later." The fix is not a better
lock. It is to write the *change* rather than the *state*. The lock stops corruption; the record
granularity stops loss. **Neither alone is sufficient, and shipping only the lock is the dangerous
half** — it produces a system that looks correct for months.

---

## 1. The two questions CLAUDE.md requires

Sync is the only genuinely new system here; the wrapper itself is assembly. Answered in conversation,
recorded here.

**1. What is the purpose of this system?**

Not "sync." Precisely: **one person's single GTD system stays one system while being used from more
than one device.** The distinction sets the failure bar. This app's premise is that it is trustworthy
enough that your brain stops holding the contents; a sync that occasionally eats a completion is
*worse than no sync*, because it destroys the one property the app exists to provide. Convenience is
not the goal — preserved trust is.

**2. What must the UI teach?**

The failure mode first, because this is the question that slips. A heavy-handed sync teaches **"this
app is sometimes broken"** — you tap a checkbox, nothing happens, and the lesson learned is
unreliability, which destroys trust as thoroughly as data loss and buys nothing.

So: **in normal use, the UI teaches nothing at all.** Sync is invisible, both devices are always
live, no possession, no mode. That is the correct amount, and it is the strongest argument for the
per-record design over the baton.

It has exactly **two visible moments**:

- **You are offline, and this is how stale you are.** Plain words, not an icon alone. `spec.md` §10
  already requires the read side to show when it last pulled.
- **This one record changed in both places, and the newer one won.** Never silent — the newest-wins
  ruling is only safe if it is *reported*, because a silent overwrite is indistinguishable from the
  data loss the whole design exists to prevent. ⚑ This document treats "never silent" as binding;
  the *form* it takes (banner, review-surface entry, settings log) is a builder's call.

Corollary, carried from the rejected baton and still load-bearing: **never invite an edit you intend
to refuse.** Same principle as DRAFT ISOLATION — a page that opens, lets you type for two minutes and
*then* fails is strictly worse than one that never opened. Under per-record sync this almost never
arises, which is the point.

---

## 2. Step 0 — the smoke shell, before any of the below

**Do this first. It is roughly half a day and it de-risks the whole plan.**

Pin the current `dist/index.html`, wrap it in a bare Capacitor shell, put it on the phone unchanged.
Change nothing else. Prove three things:

1. The WebView loads the app and it is usable.
2. `localStorage` survives force-killing and reopening the app.
3. **The long-press drag bug is actually gone** with `onActionModeStarted` / `onCreateActionMode`
   no-op'd in the Android shell.

Point 3 is the one that matters. Goal #1 of the entire wrapper rests on a fix that has never been
tried on this device. If it does not work, the premise changes and you want to know before writing
another line of plan. Points 1–2 are cheap insurance against discovering a storage surprise after
three chunks of work.

---

## 3. The audit

### 3.1 What the wrapper does *not* change

Correcting the most expensive possible misconception first: **a Capacitor wrapper is still a
browser.** Android's WebView *is* Chromium; Electron ships Chromium. Wrapping does not remove the
browser, it changes who owns it. Almost nothing gets rebuilt.

| Feature | Status |
|---|---|
| **Touch drag and drop** | **Nothing to rebuild.** The phone path is already 100% custom — `touchstart`/`touchmove`/`touchend`, a hand-rolled 400ms long-press, `applyLiveMove`, `elementFromPoint`, edge auto-scroll with a speed ramp, a 4s idle watchdog (`app.js:5712` onward). HTML5 DnD does not exist on touch and the app never used it there |
| **Mouse drag and drop** | **Nothing to rebuild.** HTML5 DnD is the desktop-mouse path only (`app.js:5723` onward); Electron runs the same Chromium |
| **The drag bug itself** | **Fixed by shell config, not app code.** §3 known issue 5 is Android's native text-selection UI racing the app's long-press. CSS and JS mitigations were all tried and failed. One line in the owned WebView settles it |
| **Safe-area insets** | **Already paid.** 33 uses in `styles.css` |
| **Export / import** | **Already built.** `serializeAllData` (`app.js`) sweeps every `gtd_` key rather than enumerating entities, so it is complete by construction and cannot silently forget a new entity. Good foundation |
| **Confirm dialogs** | Already `openConfirmDialog` throughout; native dialogs banned app-wide. No WebView surprise |
| **Screen stack** | **Landed.** `state.screenStack` is a real array (`app.js:129`, pushed/popped at `2291`, `2319`, `2608`, `5232`, `5350`, `5363`, `5382`, `6609`, `events.js:1086`, `1411`). `spec.md` §3 known issue 1 is **stale — mark it resolved.** The back button can rely on it |

### 3.2 Must change — blocking

| # | Item | Detail |
|---|---|---|
| **B1** | **Boundary sweep is boot-only** | Confirmed: `processHabitBoundaries()` / `processEventBoundaries()` run at boot (`app.js:8091–8092`) and on a QA time jump (`4583–4584`) and nowhere else. The only `visibilitychange` listener in the app cancels a stuck drag (`app.js:5848`). An installed app stays resident for days: phone suspended overnight, opened at 9am, **never processes the 4am boundary.** Habits, recurring events and every deadline bar are wrong until a cold start. Must also fire on resume |
| **B2** | **Fonts load from a CDN** | `index.html:24–25` pulls Space Grotesk, Inter and IBM Plex Mono from `fonts.googleapis.com`. **This breaks the offline promise in the browser build too** — it is not a wrapper bug, it is an existing bug the wrapper merely makes obvious. Vendor them locally. See §3.5 |
| **B3** | **Service worker will register inside the wrapper** | `swClient.js` skips registration only on `file:`. Capacitor serves from `https://localhost` / `capacitor://localhost` — a registerable origin — so the SW **will** install, putting a second cache layer on top of assets that are already bundled locally. In a wrapper, app updates arrive as a new APK; a stale SW cache can serve the old app on top of the new binary. This is the exact bricking scenario `service-worker-plan.md` was written to prevent, in a context where the kill switch is harder to deliver. **Ruling needed:** the SW should almost certainly no-op inside the wrapper ⚑ |
| **B4** | **Android back button** | See §5. Small, because the work is already done |

### 3.3 Must change — sync prerequisites

| # | Item | Detail |
|---|---|---|
| **S1** | **No record carries a modification time** | `modifiedAt` / `updatedAt`: **zero occurrences** across `app.js` and `events.js`. `createdAt` exists but only 7 times, so it is not universal either. Per-record sync and newest-wins both require a per-record timestamp. This touches every mutation site in the app and is the single largest piece of the sync work |
| **S2** | **Deletions leave no trace** | Deletes are array `splice` (`app.js:420`, `441`, `1194`, `1285`, and others). With no tombstone, a record deleted on one device is simply *absent* — and absent is indistinguishable from *not yet known about*, so the other device will helpfully restore it. **Deleted items will resurrect.** `spec.md` §10 flags this; it is confirmed |
| **S3** | **Storage adapter is synchronous** | `storage.js` is clean — every access in the app routes through it, nothing calls `localStorage` directly — but it is sync, and native durable storage is async. The adapter shape is right; the signature is not. `spec.md` §2 anticipated this exactly |
| **S4** | **The serializer is blob-granular** | `serializeAllData` emits whole `gtd_*` blobs. That is correct for export and useless for per-record sync, which needs the inverse: a decomposition of each store into records with stable ids. The store inventory is 15 real stores plus QA flag keys (`gtd_tasks_*`, `gtd_completed_*`, `gtd_events`, `gtd_archived_events`, `gtd_archived_waiting`, `gtd_habit_runs`, `gtd_habit_done`, `gtd_habit_done_order`, `gtd_notes`, `gtd_tags`, `gtd_contexts`, `gtd_tray`, `gtd_collapsed`, `gtd_surface`, `gtd_locale`). **Not all of these should sync** — see §4.2 |

### 3.4 Test, don't pre-fix

Things that will probably survive the WebView. Fixing them speculatively burns time on non-problems.

| Item | Why it's on the list, not the fix list |
|---|---|
| **Markdown-bar undo/redo** | `app.js:7793` is `document.execCommand("undo")` — genuinely the browser's own undo stack. But Android WebView is Chromium, so it will likely just work. The code comment explains it was chosen *deliberately*: every format button also goes through `execCommand`, so the browser's stack already holds typing **and** formatting in the right order. Hand-rolling undo means rebuilding both. **Test it early; rebuild only if it actually breaks** |
| **On-screen keyboard vs the floating Complete badge** | `visualViewport` handling already exists (`app.js:5994–6023`) from the URL-bar work. May already be fine |
| **contenteditable behaviour in the notes body** | Same engine. Verify, don't pre-empt |

### 3.5 Existing problems found, and where they get fixed

Per the author's step 2, sorted into the three buckets agreed in conversation.

**Fix now, in both builds:**

- **B2 — fonts from a CDN.** The app claims to work with zero network. It does not: first paint on a
  cold cache with no connection falls back to system fonts, and `dist/index.html` is otherwise
  genuinely self-contained. This is a real browser-build bug found by the audit. ⚑ Recommend fixing
  it before the wrapper starts, since it is independent of everything else here.
- **`spec.md` §3 known issue 1 is stale.** The screen stack landed. Mark it resolved so the next
  session doesn't design around a limitation that no longer exists.

**Fix in its wrapper chunk:** B1, B3, B4, S1–S4.

**Test, don't pre-fix:** everything in §3.4.

**Noted, not scheduled:** `spec.md` §3 known issue 4 (unbounded growth vs the ~5MB localStorage
ceiling) is now partly mitigated — `storage.js` catches `QuotaExceededError` and surfaces it. The
growth itself is unchanged, and moving to native storage (S3) raises the ceiling rather than removing
the concern. Out of scope here; flagged so it isn't forgotten.

---

## 4. The sync design

### 4.1 Architecture

- Transport: a file in the user's own cloud storage (Dropbox first ⚑ — the API is simpler than
  Drive's and the author named it). No server, no account to run, per `spec.md` §10.
- Writes: acquire a short lock, write **only the touched records**, release. Compare-and-swap on the
  provider's file revision/etag.
- Reads: pull on open, on resume, and after any write.
- Conflict on the same record: **keep the newest** (ruled), and **report it** (§1).
- Deletions: tombstones, or S2 bites.
- Offline: writes proceed locally and queue. Reconciliation happens on reconnect. This is the normal
  path, not a degraded one.

### 4.2 Derived vs accumulated — the classification that makes the sweep safe

Not every store should sync, and the distinction is not cosmetic. **Derived** state is a pure
function of (data, date) and can be recomputed by any device at any time; it should never travel.
**Accumulated** state records something that happened once and cannot be recomputed; it is the only
state that can be corrupted by two devices, and the only state that must sync.

| Store | Class | Note |
|---|---|---|
| `gtd_tasks_*`, `gtd_events`, `gtd_notes`, `gtd_tags`, `gtd_contexts` | **Accumulated** | The system. Must sync, per-record |
| `gtd_completed_*`, `gtd_archived_events`, `gtd_archived_waiting` | **Accumulated** | Append-mostly history. Must sync |
| `gtd_habit_runs`, `gtd_habit_done`, `gtd_habit_done_order` | **Accumulated — and the sharp edge** | See below |
| `gtd_tray` | **Accumulated** | Capture. Append-only by nature, so it merges trivially |
| Pseudo-actions minted on an event's day | **Derived** | Recomputable from `gtd_events` + today. Should not travel |
| A recurring event's roll-forward | **Derived** | Pure function of (event, today) |
| `gtd_collapsed`, `gtd_surface`, `gtd_locale` | **Device-local** ⚑ | Which lists are folded and which wood you like are properties of the device you are sitting at, not of the system. Recommend they never sync |
| `gtddev_*`, `gtd_qa_checklist_*`, `gtd_chunk_map_*` | **Never sync** | Dev scaffolding |

### 4.3 The sweep rule

`processHabitBoundaries` (`app.js:803`) is already guarded and idempotent *per device*: it never
writes a day already in history (`app.js:825`) and advances `lastProcessedDate` to today. So two
devices sweeping the same data produce the same answer. The danger is two devices sweeping
**different** data:

> Tuesday 8am you tick "Sort the intray" on your phone. The desktop has not pulled since Monday.
> Wednesday 9am you open the desktop; its sweep sees Tuesday was scheduled, finds no completion in
> its stale copy, writes **miss**, and `applyHabitDayOutcome` resets `currentRunStart` — breaking the
> streak and bumping the lap count. And because of the already-in-history guard, **the phone will
> never correct it.**

Hence the rule, which falls straight out of §4.2:

> **A device must pull before it sweeps.** Derived state may be recomputed locally by anyone and is
> never written to the sync file. Accumulated state — habit history above all — may only be written
> by a sweep that ran against freshly pulled data.

⚑ The simplest implementation is to make the sweep a no-op until the first successful pull of a
session, falling back to sweeping local-only after a timeout so an offline device is never frozen.
Builder's call, but the *rule* is not.

### 4.4 Open for the build session

- The exact lock representation and whether Dropbox's revision CAS is sufficient alone.
- Pull cadence beyond open/resume/post-write.
- The form the conflict report takes (§1).
- Whether the review surface is the natural home for "these records collided."

---

## 5. The Android back button

**Ruled by the author, and it matches `spec.md` §4.6 exactly: BACK = CANCEL (✕), never Save**, with
the resolution order dialog → drawer → page → exit, and every warning dialog that a ✕ would
normally trigger.

**The work is already done.** `app.js:5501` binds Escape to precisely that chain:

```
closeHeaderDrops()  →  dialog  →  tray  →  attemptCancelScreen()
```

`attemptCancelScreen()` is the same function the ✕ calls, project warning included (§12.1). So the
Android back button is a Capacitor `App.addListener('backButton')` calling the existing handler.
Child drafting pages returning to the project page falls out of `state.screenStack` (§3.1), which
landed.

**One open question the author flagged and did not settle:** in the lanes, back exits the app. That
is conventional on Android, but it is one tap from discarding an uncommitted intray capture. Options:
accept it; double-tap-to-exit; or treat an open capture as a page that back cancels first. ⚑ This
document recommends the third — it is the only one consistent with "never invite an edit you intend
to refuse" — but it is the author's call and is **not** decided.

---

## 6. Traps

1. **"The wrapper will fix the drag code."** It will not; there is no drag code to fix. It fixes the
   *browser behaviour racing* the drag code, from the shell. If a session starts rewriting
   `applyLiveMove`, it has misread the problem.
2. **Shipping the lock without per-record granularity.** The dangerous half. It looks correct,
   passes every test, and quietly eats data (see §0).
3. **Letting a stale device sweep.** §4.3. Silent, permanent, and specifically un-self-correcting
   because of the idempotency guard that makes the sweep safe in every other respect.
4. **Syncing derived state.** Doubles the conflict surface for no benefit and makes every
   pseudo-action a potential collision.
5. **Forgetting tombstones.** S2. Deleted items come back, and they come back looking like the user's
   own data, so the bug is reported months later as "the app resurrected something."
6. **The service worker inside the wrapper.** B3. Two cache layers, and the kill switch is harder to
   deliver to an installed app than to a web page.
7. **Assuming offline is rare.** It is the normal path, and the product promises it.
8. **Testing the wrapper only on the desktop.** The bug that motivated goal #1 is Android-only and
   device-specific. Electron will not show it.

---

## 7. What is not decided yet

Deliberately not in this document, because both depend on the author's response to it:

- **Chunking** (author's step 4). Chunk boundaries depend on which flagged problems get fixed and in
  what order — particularly whether B2 (fonts) ships ahead of the wrapper, and whether S1
  (`modifiedAt` everywhere) is one chunk or is spread across the stores it touches.
- **Testing procedures for phone and computer** (author's step 5). Written once the chunks exist, so
  each chunk gets its own pass/fail list rather than one undifferentiated sweep.

**Immediate open questions for the author:**

1. Fix B2 (fonts) now, as a standalone browser-build fix, before the wrapper begins?
2. The lanes back-button ruling (§5).
3. Dropbox first, or Drive `appDataFolder` first?

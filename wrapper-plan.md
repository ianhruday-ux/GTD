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
| Durable local storage | **In, as W2** (author, overruling this document). `localStorage` in a WebView is a cache the OS may reclaim; mirror every write to native storage so the local copy survives a wipe **without** Dropbox being the safety net. Mirror-on-write, not a full async adapter |
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

### ⚖ THE STANDARD (author's ruling, 2026-07-31) — read this before designing any merge rule

> **The goal is to prevent accidental data loss over the course of normal use. It is not to prevent
> all data loss under all circumstances.**

This is a **decision procedure**, not a sentiment, and it is what makes otherwise-endless "but what
if two devices…" questions answerable. Apply it by asking one thing: **would a person doing ordinary
work, with no intent to stress the system, be surprised by this loss?**

- *Ticking a habit on your phone and having the computer's sweep record that day as a miss* — the
  user did one ordinary thing, the app destroyed it, and nothing in the interface hinted it could.
  **Must be prevented.** (This is why `sync-audit.md` §3's rule is "a done beats a miss": a
  completion is an assertion, a miss is only an inference from absence.)
- *Completing a project on one device and un-completing it on the other, and its linked actions do
  not come back* — both halves are ordinary, and the second is the app's own designed remedy for the
  first. **Must be prevented.** (`sync-audit.md` §2b.)
- *Deleting an action on one device while deliberately editing that same action on another* —
  whoever does that is testing the system's limits and knows it. **Accepted.** Resolve it by a
  consistent, explainable rule and report it; do not contort the design around it.

The corollary that does the real work: **the danger is not rarity, it is surprise.** A loss that
follows from something the user obviously did is tolerable and often self-correcting. A loss that
arrives from a mechanism the user cannot see — a sweep on stale data, a tombstone for a row that only
expired, a timestamp race between two identical-looking taps — is the kind that destroys trust,
because there is nothing to learn from it and no way to avoid it next time.

⚑ Corollary for *inconsistent* rules across data types, which the author raised in the same breath:
differing rules are acceptable **only** where the data genuinely differs in kind. Habit history earns
its own rule because a day's outcome is an assertion-or-inference question that no other store has.
Inventing per-store special cases for anything else is how a merge engine becomes unexplainable, and
an unexplainable merge cannot be trusted either.

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
| **B2** | ~~**Fonts load from a CDN**~~ | **FIXED 2026-07-28, ahead of the wrapper** (author's ruling: leave the web version in as good a state as possible first). It was never wrapper work — the CDN `<link>` broke the offline promise in the shipped web app too. `tools_getfonts.py` vendors the latin subsets; `build.py` inlines them as base64 so `dist/index.html` stays one self-contained file. +137 KB (1.24 MB total). Inter and Space Grotesk turned out to be **variable** fonts — one file each covers every weight — which halved the cost. Guarded by `checks/offline_fonts.py` |
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

- ~~**B2 — fonts from a CDN.**~~ **Done 2026-07-28.** The app claimed to work with zero network and
  did not: first paint on a cold cache with no connection fell back to system fonts, in a file that
  was otherwise genuinely self-contained. Fixed in the browser build ahead of the wrapper, since it
  was independent of everything else here. Verified from both a served origin and `file:`.
- ~~**`spec.md` §3 known issue 1 is stale.**~~ **DONE 2026-08-01.** The entry now reads "RESOLVED
  (chunk 1, confirmed 2026-08-01)" and records *why* it was kept as a struck entry rather than
  deleted: this line sat here flagged-and-unacted for a fortnight, and an open issue that is not
  open costs a session the moment somebody designs around it.

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
- Deletions: tombstones, or S2 bites. Tombstones don't live forever — see §4.5.
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
| `gtd_collapsed`, `gtd_surface`, `gtd_locale`, `gtd_tray_draft` | **Device-local** ⚑ | Which lists are folded, which wood you like, and a half-typed line still under the cursor are properties of the device you are sitting at, not of the system. Recommend they never sync. `gtd_tray_draft` especially: syncing a live keystroke buffer between devices is a race with no upside |
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

- The exact lock representation and whether Dropbox's revision CAS is sufficient alone. **Partially
  resolved in conversation, 2026-07-30:** whatever this turns out to be, it must not be an indefinite
  mutex. A device can die mid-write while briefly holding it (the lock in §4.1 is short-lived by
  design, not the rejected baton's long-lived authority — but "short" doesn't mean "can't be
  interrupted"), and an orphaned lock that nothing ever releases would freeze every other device out
  permanently. Two ways this actually resolves, still open which: if the lock is pure CAS (write only
  if the file's revision hasn't changed since it was read), there is no separate lock object to strand
  at all — a crash mid-write just means an atomic write that did or didn't land, nothing lingers. If
  an explicit lock file/flag turns out to be needed anyway (some multi-step sync operation CAS-on-one-
  revision can't cover atomically), it must be a **lease, not a mutex**: stamp it with when it was
  acquired, and let any device treat one older than a short threshold as abandoned and take over — the
  same `modifiedAt`/`deviceId` machinery W3/W4 already built for records, reused rather than
  reinvented.
- Pull cadence beyond open/resume/post-write.
- The form the conflict report takes (§1).
- Whether the review surface is the natural home for "these records collided."

### 4.5 Tombstone garbage collection and device rejoin

Resolved in conversation, 2026-07-30, after W3 shipped tombstones as permanently append-only and
deliberately left the question open. Not built yet — this is the design W4 builds to, recorded now so
it isn't re-litigated.

**The mechanism.**

- The cloud file carries a device roster. Every write a device makes — an ordinary record or a
  tombstone — carries its device ID.
- Each device on the roster records exactly one thing about itself: the timestamp of its last
  successful full pull.
- A tombstone is safe to delete once its `deletedAt` predates the **oldest** last-pull timestamp
  across every device currently on the roster — every device has necessarily pulled at least once
  since the tombstone was written, so all of them have seen it.
- ⚑ Chosen over the alternative floated in conversation — each device appending its own ID to an
  ack-list on the specific tombstone it applied. Same safety guarantee; a pull-timestamp per device is
  a fixed cost, where an ack-list grows with tombstones × devices. The ack-list is more debuggable
  ("who specifically hasn't cleared this one") if that ever turns out to matter — not built unless it
  does.
- **Device dropout: one year of no writes.** Otherwise a single permanently-gone device (lost,
  broken, retired without ever being told) freezes GC forever, waiting for a pull that will never
  come. A year, not six months (this document's first pass): tombstones and roster metadata are tiny
  — a personal task list's deletions, not a fleet's — so there is no storage-cost reason to be stingy,
  and dropping a device too eagerly is the failure mode that actually costs something (next point).

**The gap this doesn't close, named rather than hidden.** A device that gets dropped and later
reconnects — or a brand-new device on its very first sync — has no trustworthy baseline to diff
against. A local record missing from the cloud is genuinely ambiguous: deleted elsewhere while this
device was silent (tombstone now correctly gone), or created here and never pushed? No scheme that
ever discards a tombstone can fully resolve this from the tombstone side — it is inherent to expiry
itself, not a defect particular to this design.

**The resolution: a device with no baseline never infers a deletion from absence.** Reconciling with
no prior sync history — true of a rejoining device and a brand-new one alike — is additive-only in
both directions: a local-only record is a create to push, a cloud-only record is a create to pull.
"The cloud doesn't have this" is never read as "so delete mine." This is not a special case bolted
onto the merge engine; it is the same per-record merge every other sync already uses, run once against
a sparse local side. The only residual risk is a record genuinely deleted elsewhere resurrecting on
the rejoining device — the same accepted risk class as S2's tombstone-loss resurrection, and it fails
in the direction this project already prefers: annoying-but-recoverable (delete it again) over silent
(a freshly created item just gone). §1's "never silent" ruling extends here too — a resurrection
surfacing this way is reported the same as any other same-record collision, not applied quietly.

**The case this was chased down to fix:** something written on a brand-new phone before its first
sync completes must never be lost to that first sync. It isn't, once "first sync" is understood as an
ordinary merge with a sparse local side rather than a special "just take whatever the cloud says"
step that bypasses the merge engine everywhere else already commits to.

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

**Settled 2026-07-28: in the lanes, back exits the app, with no extra guard.** Standard Android
behaviour, and the guard turned out to be unnecessary for a reason worth recording — the concern was
that back would discard an uncommitted intray capture, but an open drawer never reaches "exit"
anyway; the chain closes it first. *(This document originally recommended treating an open capture as
a page that back cancels first. That recommendation was wrong: it solved a problem the resolution
order already handles.)*

The **real** risk sitting next door was that `closeTray()` discarded a half-typed capture outright —
on Escape and swipe-to-dismiss, today, with no back button involved. **Fixed 2026-07-28** in the
browser build: the capture persists to `gtd_tray_draft` as you type and is restored when the drawer
reopens. So by the time the back button exists, there is nothing left for it to lose.

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
9. **Running `assembleDebug` without `npx cap sync android` first.** Found live, W5 device pass:
   the APK packages whatever's already sitting in `android/app/src/main/assets/public/`, which only
   updates on an explicit `cap sync` — it does **not** happen automatically, and does not know
   `dist/index.html` was rebuilt since the last one. A build can succeed, install cleanly, and launch
   fine while silently running app code from hours earlier. `cap sync android` before *every*
   `assembleDebug`, not just the first one in a session.
10. **Assuming the Dropbox App Folder's on-disk name matches its display name.** Found live, W6 desktop
    test session: it's registered separately in the Dropbox App Console and can differ (here,
    `OELA_sync_ianhruday`, not `OELA`). W5's API-based transport never needed to know this — an App
    Folder access token scopes to its own root transparently. A filesystem-based transport (W6) does
    need to know it, and getting it wrong is **silent**: each device would read and write a different
    file, merge happily with itself, and never see the other's data, with nothing anywhere to error.
    Verify against the real, signed-in account before trusting this document's own prose about the
    folder name — it was never load-bearing before W6 and went unverified for that reason.

---

## 7. The chunks

Eight, **W0–W7**. Each ends in something you can hold and judge, and each states how it behaves in a
plain browser tab — because the public web app has to keep working (memory: pristine public web app
*and* personal native+sync). A change that only makes sense inside the wrapper is a change that has
to no-op cleanly outside it.

**Sequencing rule that shapes everything below:** the two goals are not equally risky. The drag fix
is one line of shell config and is either right or wrong on day one. Sync is where data gets eaten.
So the order front-loads the cheap certainty (W0) and then spends the bulk of the work getting the
merge logic correct **before any network is involved at all** (W4 before W5).

---

### W0 — The smoke shell (Android) ✅ DONE 2026-07-28

**All three gates passed.** The app loads, `localStorage` survives a force-kill, and the drag bug is
gone — verified by a device trace of 26 holds, 26 committed moves, zero `contextmenu` and zero
`touchcancel`. The author could not reproduce it.

**The gate nearly failed, and how it was saved is the reusable lesson.** The first build made the bug
"significantly better" but not gone, and guesswork would have gone the wrong way: this document's
own hypothesis — that presses were landing on unclaimed card padding — was **wrong**, and the drag
log disproved it in one reproduction by logging `[IS a drag title]` on every failure. Two long-press
timers were racing and the WebView's fired second. See `spec.md` §3 issue 5 for the full sequence.
**The dev drag log earned its existence here**, and reading it over the WebView DevTools protocol
(`adb forward` + `Runtime.evaluate`) meant no copy-paste and no guessing.

Two things landed alongside, both from using it on a real device:

- **The whole card is a drag surface now**, not just its title — the cue pill, the deadline bar and
  the stalled flag were all inert to press-and-hold. App-code change, ships to the web build too.
- **Contexts stay non-draggable (author, reaffirmed).** They live in the registry rather than the
  lane array, so they could only ever reorder among themselves and would stop dead at the first
  list. A drag that refuses half the time is worse than one that never starts.

*Original plan for this chunk follows.*

### W0 — The smoke shell (Android)

Wrap the current `dist/index.html` in a bare Capacitor shell. **No app-code changes whatsoever.**

Prove exactly three things:

1. The WebView loads the app and it is usable.
2. `localStorage` survives force-killing and reopening.
3. **The long-press drag bug is gone** with `onActionModeStarted` / `onCreateActionMode` no-op'd.

**Gate — and it is a real one.** Point 3 is the entire justification for goal #1, on a fix that has
never been tried on this device. If it does not work, stop and re-plan rather than proceeding: the
premise has changed and the remaining six chunks were costed against a premise that no longer holds.

*In a browser:* nothing to degrade. No app code moved.

---

### W1 — Wrapper-safe behaviour (app code, ships to the web too) — BUILT 2026-07-29, awaiting device test

All three fixes landed. `node --check`, the full `checks/*.py` suite, and a `gradlew assembleDebug`
all pass; **not yet run on the phone** — that's the next step.

- **B1.** `resweepBoundariesOnResume()` (`app.js`) runs `processHabitBoundaries` /
  `processEventBoundaries` and re-renders on `visibilitychange` going non-hidden, mirroring
  `applyQaTimeJump`'s existing re-render shape (every lane, the habit badge, and an open
  calendar/review screen — never a drafting page mid-edit). ⚑ **Builder's call:** implemented with
  `visibilitychange` alone, *not* also Capacitor's `App` plugin `appStateChange` as the plan
  sketched. An Android WebView's `document.hidden` already flips across a background/foreground
  cycle the same as a browser tab's, so a second, native-only signal looked like redundant surface
  for no evidence it's needed yet. If the device test shows resume is missed (e.g. the WebView
  doesn't fire `visibilitychange` on `onResume`), add the `@capacitor/app` listener as a second
  trigger into the same function — nothing else about it would change.
- **B4.** The Escape-key handler's cancel chain was extracted verbatim into `handleBackOrEscape()`
  and exposed as `window.__oelaHandleBack`. `MainActivity.onBackPressed()` asks it via
  `evaluateJavascript` and only falls through to `super.onBackPressed()` (BridgeActivity's own
  default — no `@capacitor/app` plugin installed, so that means WebView-back-history-else-finish)
  when the page reports it did nothing. Matches §5's ruling exactly: back in the lanes still exits,
  because that IS what "nothing left to intercept" falls through to.
- **B3.** `initServiceWorker()` now also returns early when `window.Capacitor.isNativePlatform()` is
  true. That global is injected by the native shell itself the moment the bridge attaches — no
  build-time flag, no change to how the plain web build is served or tested.

The chunk map (`src/chunkMap.js`) picked up rows for W0 and W1 (bumped to `gtd_chunk_map_v19`) —
W0 was built and verified but never recorded there.

*In a browser, confirmed via `checks/*.py`:* B1 is a straight improvement (`boundary_4am.py` still
23/23 via the untouched QA-jump path). B4 is inert — `capture_draft_and_cal_reset.py`'s "Escape
keeps it too" still passes, confirming the extraction changed nothing about the Escape path itself.
B3 is unaffected — `service_worker.py` still registers and updates normally over `http://127.0.0.1`,
where `window.Capacitor` does not exist.

**Two things found on the first real device pass, both fixed same round:**

- **B4 didn't work at all on first install.** This app targets SDK 36 (Android 16), where
  predictive back is **on by default** — once it is, the OS stops delivering the classic
  `KEYCODE_BACK` event that `Activity.onBackPressed()` depends on and calls a registered
  `OnBackInvokedCallback` instead. The override was correct in logic and dead in practice: every
  back press fell straight through to Android's own default (exit), skipping the JS chain
  entirely. Read via `adb logcat` rather than guessed — the same discipline that found the two
  long-press timers in W0. Fixed by moving to `androidx.activity.OnBackPressedCallback`
  (`getOnBackPressedDispatcher().addCallback`), the AndroidX shim that speaks both the classic and
  predictive dispatch depending on OS version, registered in `MainActivity.onCreate`. This is the
  forward-compatible fix, not an opt-out: setting `enableOnBackInvokedCallback="false"` would have
  worked too but silently turns off the system's predictive-back preview animation for the whole
  app to paper over one activity's plumbing.
- **The generic "Discard your changes?" confirm was live on phone and shouldn't have been —
  design correction, not a bug.** `attemptCancelScreen` (`app.js`) has always had two confirms: the
  project page's own (staged children, trap T6a) and a generic one added in the desktop redesign
  (`desktop-redesign-plan.md` §5) for every other drafting page. §5 read as universal and was built
  that way; the author's actual intent was desktop-only — Done and ✕ sit close together on the
  desktop card without enough contrast to trust a single tap, which is the entire reason the
  confirm exists, and that problem doesn't exist on the phone, where ✕ is already visually opposed
  enough to the page it closes. Found because B4 made the Android back button route through this
  same confirm for the first time, and the author didn't recognize it as something asked for.
  Scoped to `state.desktop` at the call site; the project page's richer warning is untouched and
  still fires on every layout.

*Original plan for this chunk follows.*

### W1 — Wrapper-safe behaviour (app code, ships to the web too)

Three fixes that a resident app needs and a browser tab merely benefits from:

- **B1 — the boundary sweep fires on resume**, not only at boot (`visibilitychange`, plus
  Capacitor's `appStateChange`). Today a phone suspended overnight and opened at 9am never processes
  the 4am boundary: habits, recurring events and every deadline bar stay on yesterday.
- **B4 — the Android back button** maps to the existing Escape chain (`app.js:5501`), which already
  implements §4.6's order exactly. Roughly a five-line listener calling a function that exists.
- **B3 — the service worker no-ops inside the wrapper.** It currently registers on any non-`file:`
  origin, and Capacitor serves from one — stacking a second cache on already-bundled assets, where
  a stale entry can serve the old app on top of a new APK.

*In a browser:* B1 is a straight improvement (a tab left open for days gets the same fix). B4 is
inert — there is no hardware back. B3 changes nothing; the web build still wants its service worker.

---

### W2 — Durable local storage (mirror-on-write) — BUILT AND DEVICE-VERIFIED 2026-07-29

**Built with `@capacitor/preferences` and `@capacitor/filesystem`** (both added to `wrapper/`, synced
into the Android project). `src/storage.js`'s `Storage.set`/`Storage.remove` — already the single
choke point every write goes through — now also mirror each `gtd_` key: Preferences for anything
≤200,000 characters (⚑ builder's call; no documented hard ceiling exists for Preferences on Android,
this is comfortably under where it would ever matter), Filesystem (`Directory.Data`, app-private, no
permissions needed) for anything larger. A key lives in exactly one store at a time — crossing the
threshold moves it and best-effort deletes the stale copy from the other, so restore never has to
reconcile two versions of the same key. `restoreFromNativeMirrorIfWiped()` gates `boot()` behind one
check: if `window.Capacitor` is absent (every browser, GitHub Pages included) it resolves on the next
microtask, byte-for-byte today's behavior; inside the wrapper, only when localStorage holds *no*
`gtd_` key at all does it await the native reads that repopulate it before `boot()` ever touches
`localStorage`.

**One gap found on the first real device check, fixed same round.** Mirror-on-write only mirrors a
key when it's next *written* — after installing this build, only `gtd_habit_runs` (touched by the B1
resume sweep) had a native copy; the other seven `gtd_` keys, untouched since the update, had none.
Real gap, not theoretical: data written before this chunk existed would sit unprotected until
something happened to save it again. Closed with `backfillNativeMirror()`, called on every non-wiped
boot — cheap, fire-and-forget, converges immediately instead of eventually.

**Device-verified, not just tested in a browser** (`adb` + Chrome DevTools Protocol over
`webview_devtools_remote_*`, same technique W0's drag-log debugging used): after the backfill fix,
every one of the phone's 8 live `gtd_` keys matched byte-for-byte between `localStorage` and the
native mirror. Then the actual claim was tested directly — `window.localStorage.clear()` (simulating
the OS wipe this chunk exists for), `am force-stop` (a real kill, not a background), cold relaunch —
and every key came back **byte-for-byte identical to its pre-wipe content**, with no reseeding of
fresh sample data. That is the entire promise of W2, confirmed end to end on the actual device.

*In a browser:* `window.Capacitor` doesn't exist, so `nativeMirrorPlugins()` returns null everywhere
it's checked — the mirror is a complete no-op, `restoreFromNativeMirrorIfWiped()` resolves
immediately, and `checks/*.py` (46 files, 0 failures both before and after the backfill fix) confirms
behavior is unchanged.

**Environment note, not a code issue:** this repo lives inside a OneDrive-synced folder, and Gradle's
resource merge intermittently failed with "Unable to delete directory" once the two new plugins
pulled in many localized AndroidX string resources — OneDrive's sync client and Gradle's filesystem
watcher both grab handles on the same files. Fixed by setting `org.gradle.vfs.watch=false` in
`android/gradle.properties`; if it recurs, deleting `android/app/build` and rebuilding also clears it.

*Original plan for this chunk follows.*

### W2 — Durable local storage (mirror-on-write)

**Author's ruling, overturning this document's own recommendation.** The reasoning is recorded
because the flaw it corrects is easy to slip back into.

This document originally deferred native storage on the grounds that *"once sync lands, a wiped
local copy stops being catastrophic, because the cloud file is the recovery."* That argument is
wrong in a specific way: it makes **Dropbox the safety net for local data**, which inverts the
premise the whole app is built on. Local-first means the local copy is the system and everything
else is a convenience — not the other way round. Author: *"If I lose access to that Dropbox, the app
will become less usable."*

**What it is protecting against, precisely.** The app is already fully local and already works with
zero network; that is not what is at stake. What is at stake is Android **wiping** the local copy —
"Clear storage" in the app's settings, or WebView storage evicted under disk pressure. `localStorage`
in a WebView is a cache the OS believes it may reclaim. Durable native storage is not.

**The mechanism — mirror-on-write, NOT a full async adapter.** The alternative in `spec.md` §2 is to
make `Storage` asynchronous throughout, and it is the largest single piece of surgery in the plan:
the app assumes synchronous persistence *everywhere*, including inside render paths, so every call
site would have to learn about promises. This buys the same protection for a fraction of that:

- `localStorage` stays the **working store** — synchronous, unchanged, every existing call site
  untouched. No promises anywhere near a render path.
- Every write additionally **mirrors** to durable native storage (Capacitor Preferences for the
  small keys; Filesystem for anything that outgrows its limits). Write-behind, not batched.
- On boot, if `localStorage` is empty **and** the mirror holds data, restore from the mirror. That
  single branch is the entire recovery path, and it is also the wrapper's answer to the
  "a WebView starts with empty localStorage" problem `spec.md` §2 raises about the first install.

**⚑ The honest trade-off:** a crash in the gap between the `localStorage` write and the mirror write
loses that one change. The window is a few milliseconds and the loss is bounded at a single edit,
against a full-async rewrite that would risk correctness bugs across the entire app. Flagged so the
choice is visible rather than discovered.

**Ordering.** This sits *before* the sync chunks, deliberately. Putting it after Dropbox would leave
a window in which the cloud is the only protection — precisely the arrangement the ruling rejects.
It also comes before W3 because both are storage-layer work: doing the durability layer first means
record identity is written against the final shape instead of being written twice.

*In a browser:* there is no native store to mirror to, so the mirror is a no-op and behaviour is
byte-for-byte what it is today. The restore branch never fires because the mirror is always empty.
`src/storage.js` is already the single choke point every write goes through, which is what makes
this cheap — the mirror hooks in at one place.

---

### W3 — Record identity: `modifiedAt` and tombstones — BUILT AND VERIFIED 2026-07-29

**Built centralized, not at each mutation site.** The audit line above (§3.3 S1) describes the
obvious approach — touch every create/edit/delete — and frames it as "the single largest piece of
the sync work." That was true of that approach; it wasn't the only one available. Every mutation
already funnels through one of a handful of `saveXxx()` functions, each handing its whole array to
`Storage.setJSON`. Diffing that array against what was there a moment ago (one more
`Storage.getJSON` on the same key, read before the overwrite) finds every created, changed, and
removed record without touching app.js or events.js at all — correct by construction for every
store shaped this way, the same reasoning that made W2's mirror and this app's own
`serializeAllData()` cheap. `src/storage.js`'s `stampAndTombstone()` does the diff (key-sorted deep
comparison via `canonicalJSON`, so property-insertion-order differences never read as a change);
`Storage.setJSON` calls it before every write to anything shaped like a flat `{id, ...}` record
array.

**Scope, flagged rather than hidden.** Covers tasks (all 5 kinds), events, notes, tags, contexts,
the completed archives, and the capture tray — the array-shaped stores. Does **not** cover
`gtd_habit_runs`, `gtd_habit_done`, `gtd_habit_done_order`, or the `gtd_archived_*` maps: those are
keyed objects, not record arrays, and `habit_runs` in particular is already flagged (§4.2/§4.3) as
needing bespoke handling tied to the sweep-ordering rule — real W4 work, not something to guess at
the shape of here. Records that end up archived already carry a correct, frozen `modifiedAt` from
their life in a covered store before archiving, so this gap is narrower than the exclusion list
suggests.

**Tombstones are their own append-only store** (`gtd_tombstones`), not in-place markers — every
existing reader of `state.tasks`/`events`/etc. is completely unaffected, because a deleted record
still just isn't there. Each tombstone is itself an `{id, ...}` record, so it flows through the exact
same mechanism when appended (new entries get stamped; nothing is ever removed *from* the tombstone
log, so appending can never trigger tombstoning itself — no special-casing needed, verified by
inspection and by test). Unbounded growth here is the same already-accepted tradeoff as the
completed archives and habit histories (`spec.md` known issue 4) — **not permanent**: §4.5 records the
garbage-collection design agreed after this chunk shipped, built when W4 is.

**One gap closed proactively rather than found live, this time.** `stampAndTombstone` only stamps a
record when its store is next saved — a store nobody touches after this ships would otherwise carry
zero `modifiedAt` fields indefinitely, the same shape of gap W2's mirror had on the first device
test. Closed before shipping with `backfillModifiedAt()` (`app.js`), called once at boot using data
already loaded into `state` — no extra reads, and once every record has a timestamp it finds nothing
to do on subsequent boots.

**⚑ Schema note, resolved.** No migration. Real use has not begun (this document, throughout), so
existing records simply gain `modifiedAt` the next time their store is saved — accelerated to
"immediately" by the boot-time backfill above. A record deleted before this chunk existed leaves no
tombstone; that history is genuinely gone, which is the documented cost of skipping a migration, not
an oversight.

**Verified with a throwaway Playwright script** (not part of `checks/`, since it tests a mechanism
those files don't know exists yet): confirmed every pre-existing record picks up `modifiedAt` via the
backfill, a real UI capture gets stamped through the actual save path, deleting it removes it from
`gtd_tray` **and** appends exactly one correctly-attributed tombstone (`store`, `recordId`,
`deletedAt` all correct), and — the case most likely to silently break — an unrelated store's save
leaves an untouched record's existing `modifiedAt` exactly alone rather than bumping everything to
"now." All 11 checks passed. The full `checks/*.py` suite (46 files) also passed with zero failures,
confirming nothing existing regressed.

*In a browser:* invisible and mildly useful on its own, exactly as this section originally said — the
export file gets richer for free, since `serializeAllData` already sweeps every `gtd_` key.

*Original plan for this chunk follows.*

### W3 — Record identity: `modifiedAt` and tombstones

The prerequisite for the sync engine.

- Every mutation stamps `modifiedAt` on the record it touched. Currently **zero** records carry one.
- Deletes leave a tombstone. Currently they are bare `splice`s, so "deleted" is indistinguishable
  from "not yet known about" — and a merge would helpfully restore it.

*In a browser:* invisible, and mildly useful on its own — the export file gets richer.

**⚑ Schema note.** CLAUDE.md still permits skipping migrations *until real use begins*. This chunk
is the natural last moment to take that freedom. If real use has started by the time it is built,
it ships with a migration; if not, Reset seeds the new shape and that is cheaper. Decide at build
time, flag the choice.

---

### W4 — The sync engine, with no network at all — BUILT AND TESTED 2026-07-30

**`src/sync.js`, new module.** Pure and transport-agnostic on purpose — every function operates on a
plain "bundle" (`{roster, tombstones, stores}`, one array per §4.2's must-sync stores) and touches
nothing but `Storage`. `mergeBundles(local, remote, deviceId, baseline)` is the one merge rule, applied
uniformly to every store (tasks, events, notes, tags, contexts, completed archives, tray — the same
flat-array scope W3 already committed to; `gtd_habit_runs`/`gtd_habit_done`/`gtd_habit_done_order` and
the `gtd_archived_*` maps stay out, unchanged from that boundary) — and, with no special-casing,
to `gtd_tombstones` itself, since a tombstone is just another `{id,...}` record whose content never
changes once written, so its "merge" degenerates correctly to a union:

- **Newest wins** on genuine conflicts (both sides moved since the last state this device knows they
  agreed on — one side merely being ahead of a shared baseline is a routine update, not a conflict,
  and is applied silently; only a real collision is reported, per §1).
- **A tie on `modifiedAt`** resolves on the larger `deviceId`, deterministically — not a coin flip that
  could flip-flop the same record between two devices forever.
- **Delete vs. edit races** resolve the same way: whichever timestamp is newer wins, so an edit made
  after a delete elsewhere resurrects the record (reported, not silent) rather than being silently
  discarded — and symmetrically for a delete made after a remote edit.
- **No baseline (brand-new device, or one rejoining after roster dropout) is additive-only in both
  directions** — §4.5's resolution, built as designed: never infer a deletion from a record's absence
  when there's no trustworthy prior state to say it used to be there.
- **Tombstone GC (§4.5)** exactly as recorded: a tombstone clears once its `deletedAt` predates the
  oldest last-pull timestamp among currently-active roster devices; a device silent over a year drops
  off the roster; a device that has never pulled doesn't count toward "oldest" at all (hasn't joined
  the GC-blocking set yet); if literally nobody has ever pulled, nothing is discarded.
- **§4.3's pull-before-sweep rule**, wired in: `processHabitBoundaries()` (`app.js`) now opens with
  `if (!Sync.canSweepAccumulated()) return;`. `Sync.isEnabled()` is hard-`false` — no transport exists
  yet — so this is a no-op today, verified across a real reload in the test suite via a test-only
  window flag (`window.__oelaSyncForceEnabled`, undefined and therefore false in any real browser).
- **Every stamped record now also carries `deviceId`** (`storage.js`'s `stampAndTombstone`, extended)
  — the tie-break rule and any future "changed on your phone/desktop" reporting both need it.
- `window.__oelaSync` exposes the engine (`exportBundle`, `importBundle`, `mergeBundles`, `reconcile`,
  `canSweepAccumulated`, `isEnabled`, `getDeviceId`) — W5's hook, and this chunk's own tests; not a
  user-facing feature, same pattern as `window.__oelaHandleBack`.

**`checks/sync_engine.py`, new — 39 checks, three groups, all exercising the real code:**

1. Pure `mergeBundles()` logic on hand-built fixture bundles: additive/no-baseline (including the
   literal "new phone" scenario — a local-only record with nothing in the corresponding cloud slot
   is kept, not inferred as a deletion), genuine conflict vs. routine one-sided update, the tie-break,
   both directions of the delete/edit race, and every tombstone-GC case from §4.5 (dropped once safe,
   a never-pulled device not blocking, nothing discarded when nobody's pulled, roster dropout
   unblocking a previously-guarded tombstone).
2. **A real two-device round trip** — two separate browser contexts, each its own `localStorage`,
   "syncing" only by the test handing one device's `exportBundle()` output to the other's
   `reconcile()`, exactly the shape W5's transport will eventually automate. The initial capture and
   the final delete go through the actual UI (fill-and-Enter, reveal-and-click), not raw storage
   pokes, so the test proves the genuine write path stamps and tombstones correctly, not a
   reimplementation of it.
3. **The §4.3 gate across a real reload** — force-enabled via an init script (survives navigation,
   unlike an in-page monkeypatch), a habit seeded several scheduled days stale, reload: confirmed the
   boot-time sweep does *not* advance while closed, confirmed it does after a `reconcile()` call opens
   it (triggered via the same `visibilitychange` dispatch B1's resume sweep already listens for, no
   second reload needed — a second reload would have reset the session-only gate state itself).

**Two test bugs found and fixed while writing this, worth recording because both looked like engine
bugs at first:** fixture timestamps for the GC tests were tiny epoch-relative numbers (`1000`, `9000`)
against a dropout check that compares to the real `Date.now()` — every device read as decades stale.
And the delete-propagation test reused a record whose `modifiedAt` had just been set artificially into
the future for an unrelated tie-break test, so a real (real-time) delete moments later looked *older*
than that inflated edit and correctly triggered resurrection — correct engine behavior, wrong fixture.
Neither would have been caught without actually running against the real merge code, which is the
whole argument in this chunk's own opening paragraph for building it exactly this way.

**The lock question raised separately (§4.4) is W5's, not this chunk's** — nothing here holds a lock
over anything, there being no transport to lock.

Full `checks/*.py` regression suite (46 files) also re-run clean, zero failures — the sweep gate and
the `deviceId` stamping extension touch code every existing check already exercises.

*In a browser:* fully functional and fully tested, exactly as described below. Nothing about the
merge is native.

*Original plan for this chunk follows.*

### W4 — The sync engine, with no network at all

Per-record diff and merge, newest-wins on a same-record collision, and the conflict report that
makes it non-silent (§1). Two simulated devices in one browser — two storage namespaces — and a
test suite that drives divergence deliberately: edit both sides, delete on one, sweep on a stale
copy, reconcile, assert.

**This is the chunk that matters.** All of the data-loss risk in the entire project lives here, and
none of it needs Dropbox to reproduce. Building it against a real network would mean debugging merge
logic through OAuth and latency, which is how the naive blob sync in `spec.md` §10 gets shipped by
accident. Also implement §4.3's rule here: a device must pull before its sweep may persist
accumulated state.

*In a browser:* fully functional and fully testable. Nothing about the merge is native.

---

### W5 — Dropbox transport (wrapper only) — BUILT AND TESTED 2026-07-30

**The App Key.** `wrapper/android/secrets.properties` (gitignored — author's ruling: not a real
secret under the AppAuth/PKCE pattern, since no App Secret is ever collected, but kept out of the
public repo anyway, "no reason not to"), loaded into `BuildConfig.DROPBOX_APP_KEY` by
`app/build.gradle`. Missing file → empty string, not a build failure, so a fresh checkout still
builds.

**OAuth.** `net.openid:appauth` + `androidx.security:security-crypto`, a redirect-URI manifest
placeholder (`com.ianhruday.oela`, AppAuth's own bundled `RedirectUriReceiverActivity` picks it up —
nothing to hand-declare), and a real Capacitor plugin, `DropboxAuthPlugin.java`
(`authorize`/`isAuthorized`/`getAccessToken`/`signOut`, registered in `MainActivity`). PKCE, no app
secret, matching why the setup checklist never asked for one. The refresh token lives in its own
Keystore-backed `EncryptedSharedPreferences` file — deliberately **not** W2's `gtd_` mirror, since a
sync credential and app data have different failure modes: Reset local data must not be able to
strand a live Dropbox grant. **⚑ Flagged, not fixed:** `EncryptedSharedPreferences` is marked
`@Deprecated` as of `security-crypto` 1.1.0 (confirmed by reading the actual class file, not
assumed) — still compiles and works, no replacement class shipped yet in this library version, so
kept as the least-bad current option. Worth revisiting if AndroidX ships a successor.

**The CORS trap, and how it actually got resolved.** The first design called `fetch()` directly from
`dropboxTransport.js` and read the file's revision from a custom response header
(`Dropbox-API-Result`) — which a WebView's `fetch()`, being genuine Chromium, will not expose to JS
cross-origin without the server opting in via `Access-Control-Expose-Headers`, not something to
assume of Dropbox's API. Caught by a mocked test, not guessed: every CAS write was silently sending
`"update": null`. The fix that shipped is **not** a hand-written native HTTP plugin (the first
instinct) — tracing Capacitor's own bridge source (`native-bridge.js`) found `CapacitorHttp`, an
*official* Capacitor feature that patches `window.fetch` to run the request through native
`HttpURLConnection` and hand back *every* response header when reconstructing the JS `Response` — no
CORS filtering, because the real network call never touches the WebView's browser networking stack
at all. One config flag (`capacitor.config.json` → `CapacitorHttp.enabled: true`, synced into the
Android project), not a rewrite. `dropboxTransport.js`'s `fetch()` calls needed zero changes.

**The transport (`src/dropboxTransport.js`).** §4.4's lock question resolved on its own preferred
branch: **pure CAS on the file revision, no separate lock file** — `mode:{".tag":"update", update:
rev}` with `autorename:false` (load-bearing: without it, two devices racing their first-ever "add"
would silently fork into `oela-sync.json` / `oela-sync (1).json` instead of one losing and retrying,
exactly the silent-divergence class §1 rules out). A brand-new/first-ever sync feeds `Sync.reconcile()`
an empty bundle rather than special-casing "no file yet" — routes through the same additive-only,
no-baseline path §4.5 already built for a rejoining device. `DROPBOX_MAX_CAS_RETRIES = 3`.

**Wiring `Sync.isEnabled()` for real.** W4 left it hard-`false` behind a test-only flag. Now: a
plain, *persisted* `gtd_sync_connected` flag (`Sync.setConnected`/read synchronously), checked
alongside `window.Capacitor.isNativePlatform()`. Deliberately **not** a live call to
`isAuthorized()`/`getAccessToken()` — those are async native calls, and `canSweepAccumulated()` is
read from inside `boot()`'s synchronous sweep; going async there would mean either blocking boot on a
native round-trip or restructuring `boot()` itself, exactly the surgery W2 already rejected for
storage. **A real bug found and fixed the same round, by the test suite itself:** the automatic sync
triggers below were first gated on `DropboxTransport.isAvailable()` (native platform only) — true the
moment the app is *installed*, long before anyone connects. Every boot would have attempted a real
network call and access-token fetch for a feature never opted into; on a real device
`DropboxAuthPlugin` would just reject it ("not signed in"), but it's wasted work and the wrong
semantics regardless. Caught because `checks/dropbox_transport.py`'s fake-native test harness
started failing once boot's own auto-sync began racing the test's own explicit calls — re-gated on
`Sync.isEnabled()` (native **and** connected), which fixed both the real bug and the test collision
in one change.

**The four triggers (app.js, `runDropboxSync()`).** Settled after asking the author directly, not
guessed:
1. **Open** — fired just before `processHabitBoundaries()` in `boot()`, not awaited (boot stays fully
   synchronous, same discipline as W2's storage decision); gives §4.3's pull-gate the best real chance
   of already being in flight when it's checked, with a slow network still falling through to the
   gate's own 5s timeout rather than freezing launch.
2. **Resume** — first line of `resweepBoundariesOnResume()` (B1), same not-awaited reasoning.
3. **Backgrounding, best-effort** — new `else` branch on the same `visibilitychange` listener.
   **Author asked specifically for an "on close" trigger; there isn't one to build.** Backgrounding
   and being swiped away entirely are the *same* OS signal at the moment it fires — the app cannot
   tell them apart in advance, so this is opportunistic (may not finish if the process dies) rather
   than guaranteed. Because a sync is always a full pull-*and*-push, this still means nothing waits
   more than one open/resume/background cycle to reach Dropbox in realistic use (background one
   device right before checking the other).
4. **Manual "Sync now"** — top of the ⋯ settings menu (author's placement), the reliable fallback.

**Author's question, tested directly, not reasoned about:** what survives the app's process dying
between the local merge and the network upload landing? `Sync.reconcile()` is synchronous and writes
to `localStorage` the instant it returns, *before* `dropboxSyncNow()`'s subsequent `await` on the
upload even starts — so a kill there loses nothing locally; the next sync attempt (any of the four
triggers) picks up cleanly, because `reconcile()` is idempotent against already-merged data. Verified
in `checks/dropbox_transport.py` group 2 by mocking the upload route to hang forever, confirming the
local merge already landed, then closing the whole browser context outright (closest a test driver
gets to an OS killing the process) and resuming in a fresh context sharing the same storage state.
**Honest limit, not glossed over:** this cannot exercise a kill mid-way through `reconcile()`'s own
synchronous multi-key write loop (`sync.js`'s `importBundle`) — no `await` inside it, so no instant a
test driver can interrupt from outside the JS engine. Real but sub-millisecond, same accepted-risk
class as W2's mirror-write gap.

**The two visible moments (§1).**
- **Staleness.** `dropboxSyncStatusLabel()` — "Synced just now" / "N minutes/hours/days ago" / "Not
  yet synced" / "Syncing…" / an error state, in the settings row next to Sync now. Bucketed and
  tested against a real 90-minutes-old timestamp, not just eyeballed.
- **Never silent.** Every conflict *and* every delete/edit resurrection `Sync.reconcile()` returns is
  appended to a capped, persisted log (`gtd_dropbox_conflict_log`, 20 entries) and surfaced as a row
  in settings ("N items changed on both devices — tap to review") opening a plain-language panel:
  which text was kept, which was replaced, when. §1's open question — "whether the review surface is
  the natural home for these" — resolved as **no, not this round**: settings, next to the sync status
  it's already adjacent to, was the simpler option and is where `wrapper-plan.md`'s own "choose the
  simplest option, flag it" convention points.

**Settings UI.** Connect Dropbox / Sync now + status / Disconnect, at the top of the ⋯ menu, hidden
entirely outside the wrapper (`DropboxTransport.isAvailable()` false in any browser tab — GitHub
Pages unaffected, byte-for-byte). **⚑ Disconnect has no confirm dialog** — builder's call: reversible
(reconnect picks back up) and non-destructive (touches neither local nor cloud data), so it sits at
the same "applies immediately" tier as the Background/Language rows, not the Restore-defaults tier.

**⚑ zh-Hans for the new strings is my own pass, not a native-speaker review** like the tutorial/info
copy got — flagged rather than presented as equally vetted.

**Tested, not guessed — 35 new checks, two files, both found real bugs while being written (not
after):**
- `checks/dropbox_transport.py` (17) — a mocked Dropbox Content API (`page.route`, a stateful fake
  cloud file), driving the real transport code: first-ever sync, a genuine CAS collision with exactly
  one retry, and the kill/relaunch scenario above. Found: the CORS/header-exposure bug (real, fixed
  via `CapacitorHttp`); a test-fixture bug of its own (an `intruder` roster entry seeded with
  `lastPull: 0` — epoch 1970 — correctly discarded by §4.5's year-old roster GC, same class of mistake
  `sync_engine.py`'s own header already warned about).
- `checks/dropbox_settings_ui.py` (18) — the same mocking approach, driving the real settings menu
  through a full connect → sync → staleness-bucketing → genuine conflict → disconnect cycle. Found:
  a test bug (calling `window.__oelaDropbox.syncNow()` directly bypasses `runDropboxSync()`'s conflict
  logging entirely — fixed by triggering through the real `visibilitychange` resume path instead) and,
  jointly with the first file, the `isEnabled()` vs `isAvailable()` gating bug above.

Full `checks/*.py` suite (49 files, including these two) re-run clean after every fix, zero failures.

**Device-verified 2026-07-30, same night — the gate is cleared.** Real Dropbox account, real
AppAuth login through the system browser, real `CapacitorHttp` native fetch, real file landing in
`Apps/OELA` on dropbox.com. Confirmed two ways, not just eyeballed: `window.__oelaSync.isEnabled()`
true and a genuine `gtd_dropbox_last_sync` timestamp inside the live WebView (via
`adb forward` + Chrome DevTools Protocol, the same technique W0/W2 used), and the author independently
checking dropbox.com directly. Two snags on the way, neither in the app code:

- **The installed APK was running stale web assets.** `assembleDebug` packages whatever's already
  in `android/app/src/main/assets/public/`, which only updates via `npx cap sync android` — run once,
  early, for the `CapacitorHttp` config flag, then never again despite `dist/index.html` being rebuilt
  many times afterward while the settings UI was being written. The phone ran a build from *before*
  the Connect Dropbox button existed for a full round of confused troubleshooting before the mismatch
  was caught by diffing build stamps. **Trap, recorded in §6: `npx cap sync android` before every
  `assembleDebug`, not just the first one in a session.**
- **adb couldn't see the phone at all, initially** — Windows had bound a generic USB driver rather
  than a proper Android one. Fixed by installing Samsung's own USB driver
  (developer.samsung.com/android-usb-driver); a Google-generic driver would likely also have worked
  but wasn't tried. Environment, not app.
- **DuckDuckGo (the author's then-default browser) had trouble with the AppAuth redirect**; switching
  the phone's default browser to Chrome fixed it immediately. Not investigated further — Chrome is a
  reasonable baseline to require, and this is a one-time device setting, not a per-sync annoyance.

Every piece of *logic* — merge, CAS, the kill scenario, the UI — was already real-code-tested before
tonight; this pass confirmed the one thing that couldn't be: OAuth and the native HTTP path actually
working end to end on real hardware against the real Dropbox API.

*In a browser:* the transport is not offered at all. Export/Import stays the web build's answer,
exactly as `spec.md` §10 says it should.

*Original plan for this chunk follows.*

### W5 — Dropbox transport (wrapper only)

OAuth through the system browser (the AppAuth pattern — available *because* the wrapper owns its
auth flow), file read/write, compare-and-swap on the file revision, and the short lock around each
write. Wire the W4 engine to it.

*In a browser:* the transport simply is not offered. Export/Import stays the web build's answer,
exactly as `spec.md` §10 says it should.

---

### W6 — Electron desktop — BUILT AND TESTED 2026-07-30

**`wrapper/electron/`, a second, independent shell.** `main.js` creates one `BrowserWindow`
(`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and loads `../../dist/index.html`
via `loadFile` — same file, same origin type (`file:`) a browser opening it directly would use, which
means **swClient.js's existing `location.protocol === "file:"` check already keeps the service worker
out with no Electron-specific code at all** — B3 (§3.2) turned out to already be solved by W1, for
free, the moment this chunk chose `loadFile` over serving from a local HTTP port. `preload.js` exposes
exactly four methods on `window.__oelaDesktopBridge` via `contextBridge` (`detectDropboxFolder`,
`pickFolder`, `readSyncFile`, `writeSyncFile`) — no `nodeIntegration`, mirroring how Capacitor exposes
`window.Capacitor.Plugins.*` to the WebView rather than raw native access. ⚑ **Builder's call:** no
application menu (`Menu.setApplicationMenu(null)`) — a native File/Edit/View/Window/Help bar adds
nothing this app uses; the app has always had its own ⋯ menu and header chrome.

**`src/desktopTransport.js`, new module — the fs-based sibling to `dropboxTransport.js`.** No OAuth, no
network call: `desktopSyncNow()` reads/writes `<folder>/Apps/<registered folder name>/oela-sync.json`
directly on disk — **the exact same file** W5's Dropbox API already writes to, since that's the whole
point of a file-based sync existing at all. ⚠ **A real bug, found live during the desktop test session
(2026-07-30), not by code review:** the app-folder name is *not* `OELA`. `dropboxTransport.js`'s own
`DROPBOX_SYNC_PATH` (`/oela-sync.json`) never had to know this — Dropbox's API scopes an App Folder
token to its own root transparently, so the literal on-disk folder name was never load-bearing for W5.
This document's own W5 entry above says the file "lands in `Apps/OELA`," which was an informal
description that happened to go unverified because nothing depended on it being exact. It wasn't
exact: checked directly against the real, signed-in account, the registered folder is
`Apps/OELA_sync_ianhruday`. Getting this wrong in `wrapper/electron/main.js`'s
`DROPBOX_APP_SUBPATH` would have been **silent and dangerous** — the desktop transport would read and
write a different file than the phone, each side merging happily with itself, seeing the other
device's data never, with no error anywhere to notice by. Fixed before any real test ran; added to §6
as its own trap. `<folder>` is resolved by
`desktopConnect()`: try `detectDropboxFolder()` first (the main process reads Dropbox's own
`info.json` — `%APPDATA%\Dropbox\info.json` on Windows, the ruled first target; macOS/Linux's
well-documented equivalent locations are included since they cost nothing, but untested here), and
fall back to `pickFolder()` (a native folder dialog) the moment that comes back empty. The folder path
itself is **device-local** (`gtd_desktop_sync_folder`, wrapper-plan.md §4.2) — never synced, since a
path only means anything on the machine that resolved it.

**The CAS-on-revision question, answered for a transport with no server to ask.** §4.4's lock question
was resolved for Dropbox's API by a revision string; there is no equivalent here, only the filesystem's
own mtime. `desktopSyncNow()` re-reads the file's mtime immediately before writing and retries the
whole read-merge-write cycle (capped at `DESKTOP_MAX_WRITE_RETRIES = 3`, mirroring
`DROPBOX_MAX_CAS_RETRIES`'s own reasoning) if it moved — the realistic case being the Dropbox desktop
client itself syncing a remote change to disk in that exact window, not another instance of this app.

**`activeSyncTransport()` (`app.js`), not a second settings surface.** The two transports are mutually
exclusive at runtime (Capacitor-native vs. Electron-native; a plain browser tab has neither), and both
are, in truth, "connect to Dropbox" — just by different mechanisms. Rather than forking
`settingsDropboxRowHtml()` / `runDropboxSync()` / the conflict-log panel into Dropbox and Desktop
copies, one small resolver (`DropboxTransport.isAvailable() ? DropboxTransport : DesktopTransport`)
is threaded through the existing W5 orchestration, which is otherwise **completely untouched** — same
function names, same storage keys (`gtd_dropbox_last_sync`, `gtd_dropbox_conflict_log`), same
`data-action` strings, same i18n copy ("Connect Dropbox" reads correctly for the folder-picker flow
too). ⚑ **Builder's call, flagged rather than silently assumed:** this trades a small amount of
naming accuracy (a desktop-only settings row still says "Dropbox" in code, not "Desktop sync") for
zero risk to W5's already-shipped, already-tested 35 checks — all 35 pass unmodified. `sync.js`'s
`syncIsEnabled()` gained one small generalization (`isNativeWrapper()`, recognizing either
`window.Capacitor` or `window.__oelaDesktopBridge`) to make this possible; nothing else in the merge
engine changed.

**Tested, not guessed — `checks/desktop_fs_sync.py`, new, 41 checks, three groups** (mirroring
`dropbox_transport.py`'s own split, adapted for a transport with no network): the engine directly
(first-ever sync; a genuine mtime race — something else writes the file between this device's read and
its write — resolving in exactly one retry); the same kill-mid-write question W5's author asked,
asked again of this transport (a hung write, confirmed the local merge already landed and the disk was
untouched by the killed attempt, then a simulated relaunch that recovers and completes the write); and
the settings UI end to end (connect via auto-detect, connect via the picker fallback, staleness
bucketing, a genuine conflict surfaced through the real resume trigger, disconnect clearing both the
generic sync state *and* the desktop-only saved folder). The fake "disk" is Python-side state
(`FakeDisk`) shared across browser contexts via `context.expose_function`, playing the same role
`dropbox_transport.py`'s `FakeCloud` plays for the network transport — a filesystem is external to any
one page's JS context the same way a real cloud file is external to any one browser tab.

Full `checks/*.py` suite re-run clean after this chunk, zero regressions — `activeSyncTransport()`'s
generalization of the W5 orchestration code is exercised by both `dropbox_transport.py`/
`dropbox_settings_ui.py` (Capacitor branch) and `desktop_fs_sync.py` (Electron branch), which is the
whole point of resolving it in one place rather than two.

~~**Not yet device-verified.**~~ **VERIFIED 2026-08-01**, and it held to the pattern: every prior
chunk that touched a real environment (W0, W2, W5) found something the plan didn't anticipate — a
racing long-press timer, a mirror-on-write gap, a CORS/header trap, a stale APK, a missing USB
driver — and so did this one. The author drove the Electron build all night against a real Dropbox
folder and it surfaced the "connected with nowhere to write" defect, duplicated conflict entries,
the silent resurrection, and the app folder's real on-disk name (§6, trap 10). See W7 item 2.

⚠ **Still unverified, and it is a different claim:** nobody has installed the *packaged* desktop
build the way a recipient would — download the zip, extract it, meet SmartScreen, run `OELA.exe`
from wherever it landed. Running it out of `build-tmp/` (which is all that has happened) skips every
step INSTALL.md actually describes. See §12.

*In a browser:* desktop Chrome remains a first-class way to run the app, unwrapped — `window.__oelaDesktopBridge`
does not exist there, so `DesktopTransport.isAvailable()` is false and `activeSyncTransport()` falls
through to `null`, exactly like it always has for `DropboxTransport` alone.

*Original plan for this chunk follows.*

### W6 — Electron desktop

The same `dist/index.html` in a plain Electron shell (**not** Capacitor's Electron target — it is
community-maintained and flaky; two thin shells, one payload). The desktop reads the synced file
straight off disk from the Dropbox folder, which is three lines of `fs` and is the actual reason
this chunk exists.

*In a browser:* desktop Chrome remains a first-class way to run the app, unwrapped.

---

### W7 — Distribution

**W7 carries everything still outstanding, not just packaging.** Recorded here (author, 2026-07-31)
so the last chunk is not mistaken for "just build an APK":

1. **Export / import must be re-tested, and it now has a SYNC problem, not only a staleness one.**
   The in-app chunk map has flagged this as TO DO for a while on the grounds that backups had not
   been exercised since deadlines gained a start date and a push counter, repeats gained a missed-day
   marker, and the backgrounds were renamed. It has since grown far past that: every record now
   carries `modifiedAt` and `deviceId`, there are tombstones, a roster and a baseline, and four
   stores changed shape in chunks A and B.
   **And import is sync-unaware in three ways — see §11, which is a ruling this chunk must resolve
   before shipping a backup people rely on.**
2. **A real desktop pass by the author.** W6 is tested and was driven end to end by the builder over
   the debugging port, but the author has not sat in front of the Electron app and used it. Every
   device pass so far (W0, W2, W5) found something no simulation did; there is no reason to assume
   this one is different.
3. **Then the packaging itself.** A sideloadable APK and an unsigned desktop build, plus the
   plain-language note on how to install each. Personal sideloading only — Play Store and Gatekeeper
   are recurring overhead and `spec.md` §2 already rules them out for now.
   *(Done 2026-08-01 — `tools_package.py` and `INSTALL.md`; see the W7 progress notes below. The APK
   turned out to want its own release signing key rather than the debug one, which is the single
   consequential decision in the chunk.)*

⚑ Sequencing note: 1 and 2 are both *finding* work — they exist to surface what is still wrong. 3 is
*finishing* work. Doing 3 first would mean handing someone an installer for a build whose backup
story is unverified, which is the wrong order for the one feature whose entire job is to be there
when everything else has failed.

---

### Nothing is deferred any more

An earlier draft of this section deferred native storage and argued for it at length. That argument
is struck — see W2. The full **async** storage adapter of `spec.md` §2 remains unbuilt, but that is
now a choice of *mechanism* rather than a deferral of the *protection*: mirror-on-write delivers the
durability, and going fully async stays available later if the mirror proves insufficient.

---

### Two conventions, handled

- **QA checklist injection: skipped**, per the author's ruling this round. It is dev scaffolding and
  the author is testing in English.
- **The in-app chunk map** (`src/chunkMap.js`, CLAUDE.md's replace-don't-accumulate rule) is
  refreshed **when a wrapper chunk actually ships**, not now — it describes what a chunk *changed*,
  and so far nothing has.

---

## 8. Testing procedures

Written after W0, per the author: the smoke shell will say more about what needs testing than
guessing now would. W0's own three gates are listed above and are the immediate test.

---

## 9. The record of what was decided, and what landed alongside

1. ~~Fix B2 (fonts) now?~~ **Answered: yes. Done 2026-07-28.**
2. ~~The lanes back-button ruling (§5).~~ **Answered: back exits, no guard. Recorded in §5.**
3. ~~Dropbox first, or Drive `appDataFolder` first?~~ **Answered: Dropbox** — it is what the author
   already uses, and its API is the simpler of the two. Drive's `appDataFolder` stays the documented
   fallback (§4.1) rather than a second target to build.

**Browser-build fixes landed alongside this plan** (author: "leave the web version in as good a state
as possible before moving on to the wrapper"):

- the CDN fonts (B2) — the app now genuinely works with zero network
- the intray discarding a half-typed capture on close, Escape or swipe
- the calendar creation row inheriting a repeat into the next entry
- **fifteen user-facing strings that bypassed i18n**, found by auditing outward from one hard-coded
  placeholder; then the confirm dialogs, the background names and the last stray strings, which
  needed whole-sentence One/Many pairs because English pluralisation had been concatenated inline
- the calendar's missing ⓘ, and the review capture panel explaining six of its seven buttons
- **completing a project from the lane checkbox skipped the confirm and the archiving**, leaving
  linked waiting actions live and a linked recurring event minting a Next Action for ever. Found
  while testing the dialog copy, not by looking for it.

---

### W7 progress, 2026-07-31 — the habit half is built, the import half is not

Item 1 of W7 split in two once the author ruled on it. **What the ruling turned out to need first**
was the *habit* half, and that shipped this round (commits `373e562`, `d888cc8`):

- **Day outcomes are assertions.** Un-ticking used to delete the `habitDone` record, making a
  correction into an absence — the one form the merge discards — so done-wins resurrected the
  fat-finger permanently once either device promoted the day. Tick and un-tick are now both stamped
  assertions, a contested day goes to the later one, and `assertedAt` rides into history so the rule
  still holds after the 4am boundary. Done-beats-miss is unchanged; it is now *written* as
  assertion-beats-inference, which is what it always said.
- **Pause is a dated range**, `[from, to)`, with `run.paused` derived. Dating it makes the protection
  retroactive: a stale device's misses inside the range are filtered at replay rather than needing
  to be prevented.
- **Two defects found while tracing.** `reloadSyncedStateFromStorage` never reloaded
  `habitRuns`/`habitDone` (so the chunk-B merge reached storage and never memory, and the §4.3 gate
  was protecting nothing for habits); and `canSweepAccumulated` keyed on a session-scoped flag, so a
  resident app that pulled at 9am finalized the 4am boundary on stale data.

39 new checks in `checks/sync_w7_assertions.py`, 16 of which fail on the pre-change build. All 54
existing suites pass.

**§11 is now RULED AND BUILT** (commit `d1ad13e`). The author took (a) *and* (b): a restore
propagates outward, and identity is never restored. §11 below is kept as written for the reasoning;
the resolution is:

- Export omits sync bookkeeping and import refuses it — `gtd_device_id`, `gtd_sync_baseline`,
  `gtd_sync_connected`, `gtd_tombstones`, `gtd_sync_roster`. Baseline/tombstones/roster are
  **cleared**, not merely refused, so the device rejoins additive-only and a restore infers no
  deletions from what the backup lacks.
- Restored records are stamped `modifiedAt = now` and attributed to the restoring device, so they
  beat a later deletion elsewhere; the resurrection is reported.
- Two things found while testing it: a lane the backup doesn't mention is restored **empty** rather
  than left absent (otherwise `initLocalData` re-seeds every lane over the restore on the next
  boot), and the additive rejoin path now reports resurrections instead of returning before the
  tombstone check.

17 checks in `checks/restore_x_sync.py`, 11 failing pre-change.

**W7 item 2 (the author's desktop pass) is DONE**, 2026-08-01 — not as a set-piece but by using the
Electron build all night to drive the sync, restore and reset testing above. It found the
"connected with nowhere to write" defect, the duplicated conflict entries and the silent
resurrection, which is exactly the argument for insisting on a device pass.

**W7 item 1 is now DONE in both halves**, 2026-08-01. The staleness half — the one the in-app chunk
map had flagged as TO DO since chunk 8 and which `restore_x_sync.py` never covered — is
`checks/backup_fields.py`, 59 checks. A real system goes out through the real Export download and
back through the real file chooser, with localStorage wiped in between *and the wipe asserted*, so
nothing in it can pass because the data never left. It holds every field the app has grown:
`setAt`/`pushCount`, `missedOcc`, the renamed surfaces, and chunks A and B's four reshaped stores,
each asserted twice over (the value out of storage, and the thing that renders — the ↻1 chip, the
paused pill, the lacquer frame, the missed repeat in the review, the archived waiting action coming
back). A second group restores a genuinely LEGACY backup — keyed maps, the bare `paused` boolean, a
`gtd_habit_done` of date strings — because those files are on disk now and every loader's tolerance
of the old shape is what stands between them and a lost restore. Proven to fail twice, once per
sabotage, per protocol 2.

~~⚑ **Found while writing it, unfixed, and it needs a ruling rather than a patch:**
`restoreEventsForProject` (`app.js`) is called from nowhere.~~ **RULED AND BUILT** (commit
`b620cc5`, "Un-completing a project brings its events back, stamped to survive"). Completing a
project archived its linked events and `restoreTask()` restored only the archived *waiting* actions,
so un-completing brought the actions back and left the events archived. The ruling was that
un-completing means undo — restore both — and the restored events are stamped so the merge carries
them rather than letting another device's stale copy re-archive them. Covered by
`checks/project_uncomplete_events.py`.

**W7 item 3 — the packaging — is BUILT, 2026-08-01. W7 is closed, and so is the wrapper round.**

`tools_package.py` produces `release/` in one command: the standalone HTML file, a signed release
APK, a packaged Windows desktop build, `INSTALL.md`, and `CHECKSUMS.txt`. `release/` and
`build-tmp/` are gitignored — they are build output regenerated from `dist/`, and one of them is
138 MB.

- **The APK is release-signed now, not debug-signed.** `wrapper/android/release.keystore` +
  `keystore.properties`, both gitignored, wired into `app/build.gradle` by the same
  missing-file-is-not-a-build-failure pattern `secrets.properties` already used — a fresh checkout
  still builds, `assembleDebug` is untouched, and only `assembleRelease` needs the key.
  ⚠ **The consequence, which is the one thing in this chunk that can cost real data:** Android
  identifies an app by its signing certificate, so this APK **cannot install over the debug build
  currently on the author's phone.** That is a one-time migration (export, uninstall, install,
  import — or let Dropbox repopulate), and it is the last time it happens, because every build from
  here is signed with this key. Losing `release.keystore` re-imposes it on everyone.
  `keystore.properties` says so in its own header; INSTALL.md says so where a friend would hit it.
  **`tools_pushphone.py` follows, 2026-08-01:** it built a debug APK and carried its own copy of the
  sync-then-verify chain, and after this both were wrong — the build the phone can no longer accept,
  and a second implementation of a chain `tools_package.py` already does better (four assertions
  against the finished artifact, not just the staged assets). It now calls that chain and adds the
  one thing packaging does not do: `adb install`. The APK on the phone and the one you would hand
  somebody are the same file rather than two builds from the same source. A signature clash is
  caught by name (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) and answered with the export-uninstall-
  reinstall sequence in plain words, since that error otherwise reads as a broken script. ⚑ The
  `--debug` escape hatch this document briefly proposed was **dropped before being built** —
  speculative capacity for a need that has not arisen, which is what CLAUDE.md's scope rule exists
  to prevent.
- **The Dropbox App Key ships inside the APK** (author's ruling this round, reversing W5's
  "gitignored anyway"): sync works out of the box for anyone who installs it, and everyone who
  connects links their own Dropbox to the one registration. Dropbox allows 500 linked accounts on an
  app in development status and gives you two weeks to apply for production once **50** have linked
  — nowhere near a handful of friends, but a number that has to be watched rather than discovered,
  so INSTALL.md asks people to say if they'll use sync. **The key is still not in the public repo**
  and this document has not put it there: baking it into a binary you hand someone is reversible
  (revoke the app), committing it to a public GitHub history is not.
- **Packaging verifies the artifact, not the build.** `tools_pushphone.py` exists because trap 9 is
  silent; a stale APK handed to somebody else is the same failure with no way for either party to
  notice. So the staging check is kept *and* the finished APK is opened as a zip and its
  `assets/public/index.html` compared to `dist/index.html` byte for byte — a Gradle cache can defeat
  the first check and cannot defeat the second. Three more assertions ride along: signed by the
  release key and not `CN=Android Debug`, `application-debuggable` absent, and the App Key actually
  present in `classes.dex` (an APK whose Connect Dropbox rejects every attempt is the same
  silent-failure shape as a stale one). The desktop build is checked the same way — it *copies* the
  payload rather than referencing it, so it can go stale identically.
- **The Electron shell resolves its payload from either layout.** `main.js` loaded
  `../../dist/index.html`, which does not exist once packaged; it now takes whichever of
  `./dist` and `../../dist` is really there. ⚑ **Builder's call:** `--asar=false`, so the shipped
  app stays a plain folder — the payload is one self-contained HTML file whose whole premise is that
  you can open and read it, and a verification that requires unpacking an archive is one that
  quietly stops being performed.
- ⚠ **The staged `package.json` must keep `"name": "oela-electron"` and no `productName`.** Electron
  derives `userData` — where localStorage, and therefore every list, actually lives — from
  `app.getName()`. `productName: "OELA"` would have pointed the packaged build at `%APPDATA%/OELA`
  while `npm start` reads `%APPDATA%/oela-electron`: two installs of one app unable to see each
  other's data, the packaged one silently starting empty on a machine that already had lists.
  Verified by launching the packaged `.exe` and confirming no second folder appeared. Nothing
  user-visible pays for it — the exe is still `OELA.exe`, the window still says OELA.
- ⚑ `minifyEnabled` stays `false` in release. R8 would shrink an APK whose bulk is an HTML asset it
  cannot touch, while adding release-only reflection breakage (AppAuth, Capacitor plugin lookup) to
  the one build nobody can debug remotely.
- **Two things `shutil` and `electron-packager` needed and this document did not anticipate:** some
  files in an Electron distribution carry epoch-0 mtimes, which `make_archive` cannot represent and
  dies on halfway through (hand-rolled zip, timestamps clamped to 1980), and the packager requires
  an `author` field, which becomes the CompanyName Windows shows in the SmartScreen dialog.

**`INSTALL.md`** (repo root, copied into `release/`) covers all three installs click by click,
including the two warnings that will frighten people and deserve a straight answer rather than a
reassurance — Play Protect's "unsafe app" on any non-Play APK, and SmartScreen's "unknown
publisher" on an unsigned `.exe` (a code-signing certificate costs hundreds a year; `spec.md` §2
already rules out that class of recurring overhead). It says plainly, in both cases, that the
one-file version asks nothing of you if that isn't good enough. It also documents where data lives
per platform, that Windows sync needs the Dropbox desktop client running while Android does not, and
what the checksums are for.

**The localized-`Apps` bug, found while writing the doc, is FIXED the same round** (author: "if it
can be fixed with 0 cost now, why not do it?"). `wrapper/electron/main.js` hardcoded the Dropbox
app-folder parent as `"Apps"`, which Dropbox **localizes** — "Aplicaciones", "Applications". This is
trap 10 a second time, one path segment to the left: the registered *child* name was caught live in
W6 and fixed by knowing the value; the *parent* went unexamined beside it.

`wrapper/electron/syncPath.js` (new, plain CommonJS, no Electron import so it can be tested) scans
the Dropbox root's immediate subdirectories for one containing `OELA_sync_ianhruday` — the half
Dropbox does **not** translate, because it comes from the app registration — and uses whatever that
parent turns out to be called. The English name is preferred when it really exists, so an account
already syncing does not switch underneath itself, and the scan is sorted so two devices cannot
resolve differently.

⚑ **The residual case, pinned rather than closed:** if *nothing* is linked anywhere yet, no app
folder exists to find, and this still falls back to creating the English `Apps`. Closing it means
either refusing to create the folder and telling the user to connect a phone first (new UI, new copy
in two languages) or shipping a table of Dropbox's translations (no authoritative source, rots
quietly). Neither is free, and the fallback is strictly better than what it replaced — the realistic
route to desktop sync is having connected the phone, which creates the folder and makes the scan
succeed. `checks/desktop_sync_path.py` asserts the fallback explicitly so a later fix has to change
that line deliberately. INSTALL.md tells a non-English user to connect the phone first.

**`checks/desktop_sync_path.py`, new — 8 checks, and the first file in `checks/` that is not
Playwright.** Every other check drives `dist/index.html` in a browser because that is where the app
is; this code is in the Electron *main* process, which has no DOM to assert on, so protocol 1 has
nothing to bind to. What it has instead is a real filesystem: the file drives the real module via
`node` against real temp directories, rather than reimplementing the logic in Python, which protocol
2 would not accept. **Proven to fail by sabotage** (protocol 2): restoring the hardcoded join gives
6 passed, 2 failed, both localized cases, failing with the wrong parent rather than an exception.
The other six pass either way on purpose — they pin what must not change.

`src/desktopTransport.js` and `checks/desktop_fs_sync.py` both carried comments citing the deleted
`DROPBOX_APP_SUBPATH`; corrected (protocol 2b). `desktop_fs_sync.py`'s fake path is now labelled as
arbitrary, because it is — that file mocks the bridge and never reaches the resolver.

**Two OneDrive collisions, one of them this script's own fault.** W2 recorded Gradle failing with
"Unable to delete directory" in a OneDrive-synced repo and set `org.gradle.vfs.watch=false`. It came
back harder here, and the reason is worth recording: the first version of `tools_package.py` staged
the desktop build *inside the repo*, unpacking ~300 MB of Electron into a synced folder. OneDrive
began uploading it, held handles on thousands of files, and the next `assembleRelease` and
`cap sync` both lost the race. **Scratch space now lives outside OneDrive** (`%LOCALAPPDATA%/oela-build`,
overridable with `OELA_BUILD_TMP`), which removes the cause; `run_resilient()` retries once past the
remaining lock signatures, but only those, and does the documented remedy first — a packaging script
that quietly retried real compile errors would be worse than one that never retried.

~~The in-app chunk map and QA checklist are still due when W7 actually ships.~~ **Struck, 2026-08-01
(author).** Both conventions are retired: *"the dev tools should be hidden and inaccessible in the
final product. Leave them in just in case I want to come back to this, but for now, they've served
their purpose."* `DEV_TOOLS_BUILT_IN` (`app.js`) is false, which closes the ⋯ → Debugging row and
makes `applyQaScaffolding()` sweep both out of the lanes rather than inject them. Nothing is
deleted — flip the constant and rebuild. Recorded in CLAUDE.md, held by
`checks/shipped_surface.py` in both directions.

---

## 11. Export/import × sync — an open ruling, raised by the author 2026-07-31

**The question:** delete something on device 1; the tombstone reaches the cloud but device 2 has not
pulled yet; now import a backup that still contains the deleted item. What happens?

**What happens today, traced through the code, not reasoned about.** `importAllData` (`app.js:7929`)
removes **every** `gtd_` key and writes back every key in the file with a raw `Storage.set` — no
stamping, no tombstoning — then reloads. `serializeAllData` is the mirror: it sweeps every `gtd_`
key. Neither knows sync exists, and "every `gtd_` key" includes sync's own machinery. Three distinct
problems fall out.

**1. A restored item can be silently re-deleted.** The backup contains the item with its old
`modifiedAt` (t0) and does not contain the tombstone, so importing *destroys the local tombstone*.
The next sync pulls the cloud, which still has it (`deletedAt` t1 > t0), and `mergeRecordArray`'s
`l && !r` branch drops the record — and that path returns **without recording a conflict**. So the
user restores a backup and the app quietly throws part of it away. Ordinary deliberate action,
invisible mechanism, no report: it fails §1's standard outright.

**2. Import copies `gtd_device_id`, so two devices can end up with the same identity.** Restoring a
phone backup onto a new computer is the *normal* way to set one up. Afterwards the roster holds one
entry for two devices, §4.5's tombstone GC ("oldest last pull across every device") is computed over
a device set that is wrong, and the `deviceId` tie-break stops distinguishing them. This is the
worst of the three and the least obvious.

**3. Import copies `gtd_sync_baseline`**, which records what *the other* device had agreed with the
cloud. A baseline is precisely what licenses inferring "absent means deleted" (§4.5 makes a device
with no baseline additive-only for exactly this reason). Importing a foreign one can license
deletions this device was never entitled to make.

**The ruling needed, and the options.** The real question is what *restore* means once two devices
exist — and it is a design question, not a technical one:

- **(a) Restore means "this is now the truth."** Stamp every restored record `modifiedAt = now`, so
  the restore beats any earlier deletion and propagates outward. Most intuitive reading of the word
  restore; it also means a restore can undo deletions on the *other* device, which the user may not
  expect.
- **(b) Restore is local and joins afresh.** Never import sync machinery (device id, baseline,
  tombstones, connection state); clear this device's sync identity so the next sync is a rejoin —
  additive-only in both directions per §4.5, inferring no deletions at all.
- **(c) Leave as-is and warn.** Tell the user plainly, in the existing import confirm, that a restore
  may be partly undone by another device's later changes. Cheapest, and the least honest.

⚑ The builder's view, recorded but NOT decided: **(b) is the floor and is not really optional** —
copying a device identity is a straightforward defect whichever way the ruling goes. **(a) is the
part that needs the author**, because it changes what a restore does to the *other* device.

---

## 12. What is left — two open tasks (author, 2026-08-01)

The wrapper round is built. These two are what remains, and neither is code.

### 12.1 ⏳ OPEN — Live with it on both devices, and watch for divergence

**The task:** use the app normally on the phone and the computer over the next couple of days, and
watch for the two systems disagreeing.

**What specifically to watch for**, because "look for divergence" is not a test:

1. **New Dropbox conflicted copies** in `Dropbox/Apps/OELA_sync_ianhruday/`. The folder was cleared
   to make this legible — 33 files from the 2026-07-31 testing night were moved to
   `Dropbox/Apps/Archive/oela-sync conflicted copies 2026-08-01/`. **The folder now holds nothing
   but `oela-sync.json`, so any new one is a signal rather than noise.**
2. **An item that exists on one device and not the other**, after both have synced.
3. **A habit day whose outcome differs** between devices — the sharpest case in the whole design
   (§4.3), because a wrong answer there is written into history and does not self-correct.

**Why the previous evidence could not settle it, recorded so this isn't re-litigated.** A forensic
pass over those 33 files found 205 records present in a conflicted copy and absent from the live
bundle with no tombstone — which sounds decisive and is not. 155 of them are the same seed data
reseeded about ten times (ten distinct ids for "1 CLICK HERE TO START THE TUTORIAL"), and the ~15
one-offs are hand-typed fixtures named *Delete after Export*, *Keep after export*, *Made after
export*. **Reset and Restore both destroy records without writing tombstones** — §11's ruling has a
restore *clear* the tombstone log outright, which is also why the live bundle holds zero — so the
exact fingerprint the check looked for is what a night of reset testing produces anyway. The test
was not decisive and was reported as such. It becomes decisive from a clean folder under ordinary
use, where deletions *do* tombstone.

⚑ **The structural question underneath, open either way.** The desktop transport writes into a
folder Dropbox's own daemon also writes, using the file's mtime as its compare-and-swap. Two
writers, one file: that *can* fork by construction, and a conflicted copy is never named
`oela-sync.json`, so no device will ever read one. Anything whose only home is a conflicted copy is
out of sync from that moment. Whether this happens in practice is what the watch answers — and
per the golden rule, **classify before diagnosing**: is the fix technical (make the desktop write
in a way Dropbox won't fork), or is the finding that a file-based desktop transport writing into a
daemon-synced folder was the wrong shape and it should go through the API like the phone does?

### 12.2 ⏳ OPEN — The project review document

**The task:** a review of the project as a whole, in two portions, **both written and kept
separate** — not merged into one voice.

- **The AI-written portion.** What was built, what it cost, where the design held and where it
  bent, which decisions turned out wrong and what the evidence was. The material is unusually
  complete: `spec.md`, this file, `ROUND-NOTES.md`, the `*-plan.md` files, ~65 suites in `checks/`,
  and a commit log written in whole sentences.
- **The human-written portion.** The author's own account. Whether the thing is good to use,
  whether the process was worth it, what it was like to work this way.

⚑ Keeping them separate is the point rather than a formatting preference: the two are evidence
about different things, and a blended document would let the confident one launder the uncertain
one. Where they disagree, that disagreement is the most interesting content in the file.

### Also outstanding, smaller, and not scheduled

Named here so "we are basically done" is a statement someone can check rather than take on trust.

| | What | Bites when |
|---|---|---|
| **A** | **Nobody has installed the packaged Windows build as a recipient would** — download, extract, SmartScreen, run. It has only been launched out of `build-tmp/`, which skips every step INSTALL.md describes. This is the same shape as the Play Protect error the author found by standing in front of the dialog | A friend on Windows follows the doc |
| **B** | **`syncPath.js`'s residual case:** a non-English Dropbox with nothing linked yet still creates the English `Apps`. Pinned by `checks/desktop_sync_path.py` rather than closed | A non-English friend sets up desktop *before* phone |
| **C** | **`EncryptedSharedPreferences` is `@Deprecated`** (W5) with no successor shipped in that library version | AndroidX ships a replacement |
| **D** | **zh-Hans for the sync/settings/packaging strings is the builder's own pass**, not the native-speaker review the tutorial and info copy got | A Chinese-reading friend uses it |
| **E** | **No macOS or Linux desktop build.** "Windows first, Linux after" (§0) — the "after" never came | A friend isn't on Windows |
| **F** | **`spec.md` §3 known issue 4** — unbounded growth against the storage ceiling. Mitigated (quota errors surface) but not solved | Months of real use |
| **G** | **`tools_pushphone.py`'s install path is untested** — rewritten to build release, verified only as far as the device check | First time the phone is plugged in |

None of these blocks using the app. **A** is the one worth doing before handing anything to anyone,
because it is the only item on this list that a recipient hits on their first minute.

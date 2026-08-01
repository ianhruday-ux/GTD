# Handoff — three open bugs + the convert page-swap ruling

Written 2026-08-01 at the end of a long session, for a fresh instance. Everything below is
verified against the code and, where it says so, against the running app — not remembered.

Read `CLAUDE.md` first, then this. **Do not read `spec.md` end to end** (223 KB); the line
references below are enough.

---

## 0. Where the project is

One-month sprint, wrapper/sync work is chunk **W7** (`wrapper-plan.md` §7).

- **W7 item 1 — DONE.** Habit day-assertions, pause as dated ranges, restore-vs-sync semantics,
  the Dropbox refresh-token fix, merge ordering, draggable contexts, the propagating reset, the
  promotion pushback, link-existing.
- **W7 item 2 (author's desktop pass) — DONE**, by use rather than as a set-piece.
- **W7 item 3 — packaging. NOT STARTED.** A sideloadable APK and an unsigned desktop build plus
  plain-language install notes. This is the last thing between the author and shipping.
- The in-app chunk map and QA checklist refresh **when W7 actually ships**, per `wrapper-plan.md`
  §7. The author has said repeatedly: **do not inject QA checklists.**

**Git: ~16 commits unpushed, deliberately.** Pushing `main` triggers `.github/workflows/pages.yml`,
which publishes `dist/` to GitHub Pages. **Never push without the author asking.** They were caught
out by this once already.

---

## 1. BUG — a staged create still offers Complete

**Reported:** *"Yes, but it also has a complete button which shouldn't be there."*

Ruling recap: an item opened from a project's linked list is **editable**, but must not be
completable or deletable. **One exemption:** a staged create (added on this page, not yet saved)
keeps **Delete**, because its row carries no ✕ and Delete is the only way to take it back.

I implemented that exemption with a single predicate, `openedAsProjectMember(s)` (`src/app.js`,
search the name), used by **both** gates:

- `showDelete` in `screenHeaderHtml`
- the Complete-pill condition, `(kind === "next" || ... ) && s.taskId && !openedAsProjectMember(s)`

Because the predicate returns `false` for a staged create, that item gets **Delete *and* Complete**.
Delete is right; Complete is not.

**Fix:** split it. Delete needs the staged-create exemption; Complete does not — nothing opened
from the project list should be completable, staged or live.

**Test:** `checks/project_link_existing.py` group 6 asserts Delete is present for a staged create.
Add the matching assertion that **Complete is absent**. Group 5 already covers the live case.

---

## 2. BUG — "Link existing" is on the same row, not above

**Reported:** *"It's not above the buttons on the phone or the computer. It's on the same row."*

The review's stalled card (`src/app.js`, search `l.kind === "stalled"`) builds band 1 as a single
`reviewBandHtml(...)` containing four buttons; I made Link existing the first **child of that
band**, so it shares the flex row.

**Fix:** give it its own `reviewBandHtml(...)` immediately before band 1, so it is a row of its own
above the three make-something-new buttons.

**⚠ My check was too weak and passed anyway.** `checks/project_link_existing.py` group 7 asserts
DOM *order* across a flat button list, which is satisfied by same-row placement. Rewrite it to
assert Link existing is in a **different** `.review-band` from the `data-type="text"` button —
otherwise the fix cannot be verified. It runs at both 420px and 1280px; keep that.

---

## 3. BUG — the conflict report isn't visible on either device

**Reported:** *"I don't see the report on either device now."*

**Not yet reproduced.** What I verified:

- The wiring is intact: `runDropboxSync()` calls `appendDropboxConflicts(result.conflicts)`
  (`src/app.js` ~9616), and the settings row renders when `conflicts.length` (search
  `settingsDropboxConflictsHtml`).
- **The log is wiped by two things the author did last night:** `disconnectSyncThen()` removes
  `gtd_dropbox_conflict_log`, and restore-to-defaults clears every `gtd_` key. Both devices were
  disconnected *and* reset, and the cloud file was emptied. So an empty log may simply be correct.

**Prime suspect if it is real — my own dedupe from this session.** `appendDropboxConflicts` now
skips a conflict whose `store:id` key was logged in the last 60 s (`CONFLICT_DEDUPE_MS`). If a
resurrection is re-derived by several syncs in quick succession, only the first is recorded — which
is the intent, but check it is not swallowing the *only* one. Note the log is also capped at 20
entries.

**How to reproduce properly:** both devices connected to Dropbox; delete an item on device A and
let it sync; restore a backup containing that item on device B; sync both. Expect a conflicts row
in **⋯** on **both** devices — device B for bringing it back, device A for having deleted it. The
device-A half is new this session (`mergeRecordArray`'s `r && !l` additive branch in
`src/sync.js`); `checks/restore_x_sync.py` group 4 covers it at the merge level, so if that passes
and the UI shows nothing, the fault is between `reconcile()` and the settings render.

---

## 4. THE RULING — convert swaps the page, in the draft

**Author's words:** *"I like option 1."*

> Swap the page in the draft. Arming the convert re-renders as the destination kind with its
> fields, including "waiting for"; ✕ still discards; Save validates as normal.

### Why this is being reintroduced

Converting Next → Waiting **currently creates an invalid item, silently.** Verified in the running
app:

```
RESULTING WAITING RECORD:
   whenText     : None
   conditionId  : None
   -> ORPHANED?   True
REVIEW SAYS: All clear. Nothing slipping through the cracks.
```

Three layers, all confirmed:

1. `changeKind` (`src/app.js` ~1729) keeps `whenText`/`conditionId` only when the destination is
   Waiting — but a Next Action never had them (§4.2 forbids it). So the result is condition-less
   **by construction**.
2. The Waiting page **refuses to save that state** (`saveScreen`, `s.invalidField = "waitingFor"`).
   The convert bypasses that validation entirely.
3. Nothing catches it afterwards. `isWaitingOrphaned` (`src/app.js` ~7582) opens with
   `if (!task || !task.conditionId) return false;` — it only catches a **dangling** condition, so a
   row with *no* condition is invisible to the review.

It used to swap pages, which made this state unreachable: you supplied the condition before saving.
Draft isolation (`spec.md` line 767 — convert is "draft-only and armed, applied at Save") moved it
to save-time, and the consequence was not followed through.

**The reason the old behaviour was rejected no longer holds.** The author: *"This was before
projects had staging."* Correct — the project page now carries pending creates, links, detaches and
deletes in `draft.staged` and commits none of them until ←. A draft can hold a pending structural
change safely, so a page swap can be draft-safe now in a way it could not be then.

### Scope

Both pairs: **Next ↔ Waiting** and **Current ↔ Future**. All four convert buttons already exist and
work (`makeKindBtnHtml`, `data-action="make-kind"`); this changes what arming one *does*.

### The author's additional ruling

> *"the warning dialogue about actions and projects should get moved to the make future button
> instead of the save button."*

`demoteProjectToFuture` (`src/app.js` ~2071) currently fires at Save. It warns that a Someday
project can't hold linked actions/events and offers unlink-or-delete. Under the page swap it must
fire **when Make Future is tapped**, because that is when the decision is made.

**RULED (author, 2026-08-01): the dialog fires on tap, and its choice is STAGED, applied at Save.**

The dialog's outcome is a single enum — unlink / delete / cancel — so this is cheap. Both branches
are already id-based (`setLink`, `deleteTask`, `deleteEventEntirely`), and nothing in them needs to
run at the moment of the tap:

```js
{ unlink } → setLink(each linked action, null) + unlinkEvents() + changeKind
{ delete } → deleteTask(each linked action)   + deleteEvents()  + changeKind
{ cancel } → nothing
```

Costed before ruling: acting immediately is ~15 lines, staging is ~30. **The extra fifteen buys the
only thing that matters here** — acting immediately means choosing *Delete* and then leaving with
**✕** discards the conversion while the project's actions and events are already gone, leaving an
unchanged Current project that has silently lost its contents. That is worse than the 🗑 exception
it would lean on: 🗑 destroys the thing you are looking at, deliberately, behind its own confirm;
this would destroy **other** items as a side effect of a decision the user then backed out of —
the case DRAFT ISOLATION names explicitly ("including side effects on *other* items").

Staging is also *more correct*, not merely safer: recompute the linked set **at Save**, not at the
tap, so items added or promoted while the page sat open are included — the same zombie trap
`applyProjectStaging` already resolves by id. (Consequence to accept: the dialog may have said "2
actions" and Save may act on 3. The unlink/delete choice still applies.)

**Shape:**

- Split `demoteProjectToFuture` into an **ask** and an **apply**. The ask fires from the make-kind
  handler; it must no longer call `changeKind`/`closeScreen` — the page swap and Save take those.
- Store the answer as `draft.demoteChoice = "unlink" | "delete"`. Cancel leaves the convert
  **unarmed** (no page swap).
- Apply it in the save path, immediately before `changeKind`, recomputing the linked set by
  project id.
- **Disarming the convert clears the stored choice** — author: *"I'm fine with throwing up the
  dialogue again if the user swaps back and forth."* So re-arming asks again rather than silently
  reusing a minute-old answer.
- The no-linked-items path (no dialog, straight swap) stays as it is.

### Implementation sketch

- Arming a convert sets a pending kind on the draft and **re-renders the page as that kind**, with
  the destination's field set. Do not call `changeKind` until Save.
- `✕` discards the pending kind along with everything else. Existing warn-on-discard
  (`projectDraftDirty` / the drafting-page equivalent) should count it as dirty.
- Save runs the destination kind's **normal validation** — so Next → Waiting with no condition is
  blocked with the dashed outline, on a page that now has the field to fix it in.
- `changeKind` itself can stay as the committer.
- Watch the kind badge, the title placeholder, the lane accent colour and `KIND_BADGE_LABEL` — the
  page is rendered from `s.kind` in many places; the pending kind has to be threaded through the
  render without changing `s.kind` itself (which would break Save's knowledge of where the item
  currently lives).

### Also fix, separately

`isWaitingOrphaned` should **also** report a Waiting action with no condition at all. That is a
safety net worth having whichever way convert goes, and there may already be such rows in the
author's data from this path. Flag it as a behaviour change: previously-invisible rows will start
appearing in the review.

---

## 5. Standing facts this session established

- **Convert has ZERO test coverage.** No suite touches arming, saving, or either gate, on any of
  the four page types. Largest untested surface in the repo. Build one with the page-swap work.
- **`docs/` does not exist.** `CLAUDE.md`'s reading order points at `docs/spec.md` and
  `docs/changelog.md`. The spec is at the repo root as `spec.md`, and **there is no changelog at
  all.** Worth correcting `CLAUDE.md`.
- One raw-English error string remains user-visible: `new Error("Sync timed out — will try again")`
  in `runDropboxSync` (`src/app.js` ~9611). Every other surfaced sync error is now an `err.sync.*`
  i18n key; this one was missed.
- The native Dropbox auth plugin's own reject messages are still English — they are produced in
  Java and never pass through `t()`.

---

## 6. Environment gotchas (they cost real time)

- **`python`, not `python3`.** `CLAUDE.md` says `python3`; that fails on this machine.
- **`node --check dist/index.html` fails** on this Node — it rejects the `.html` extension. Check
  `src/*.js` individually, and parse-check the bundle by extracting its inline `<script>` blocks.
- **`export PYTHONIOENCODING=utf-8` before running checks.** The Windows console is cp1252 and
  several suites print rendered UI containing `⏸`, `✓`, `↻`; without it a suite dies in its own
  final print loop *after* every check has run, discarding the results.
- Checks live in `checks/`, are **not** pytest, and are run individually: `python checks/<name>.py`.
  ~62 suites, all green as of this handoff.
- **Protocol (checks/README.md): prove a check fails on the pre-change build.** `git stash push
  src/`, rebuild, run, `git stash pop`, rebuild. Guard any new API/selector the old build lacks, or
  the file aborts instead of reporting.
- Fixture traps that cost me time in this session, all now commented in the suites: the Completed
  section's collapse state persists in `localStorage` (an unconditional header click opens it once
  and closes it the next time); the review button lives **inside the capture tray**, so the tray
  must be opened first; `reconcile()` with no baseline calls `stripSeededRecords` and will delete
  the seeded fixture out from under you.
- **The phone:** `python tools_pushphone.py` rebuilds, installs and verifies. Keep it current when
  `dist/` changes and the phone is plugged in.
- **The desktop app:** `cd wrapper/electron && npm start`. It loads `dist/index.html` at startup, so
  a rebuild needs a restart.

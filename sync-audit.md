# What syncs, what doesn't, and what it would take to sync everything

**Written 2026-07-31, after the first real two-device test destroyed a record.** This document exists
because "what is actually synced?" turned out to be a question nobody could answer from the code
without reading four files, and because the answer contained surprises — including one that ate data.

It is an **audit, not a plan**. Where it recommends, it says so and says why. Nothing here is built
unless a row says it is.

Read alongside `wrapper-plan.md` §4.2 (the derived-vs-accumulated classification this refines) and
§4.3 (the pull-before-sweep rule, which turns out to be load-bearing for habits specifically).

---

## 0. The one-paragraph answer

**Your tasks, projects, events, notes, tags, contexts, captures and completed archives all sync.
Your habit progress does not** — not the streak, not the history, not the paused state. Neither do
two archive side-maps used by projects and events. Everything else that doesn't sync either
shouldn't (device preferences, sync's own bookkeeping, dev scaffolding) or *must not* (state derived
from other state, which caused a real bug).

Three problems are not about *which stores* sync at all, and were found later — they are in §4b and
§4c: **the merge unit is the whole record**, so two edits to different fields of the same item eat
each other; **a task orphaned by a list deleted elsewhere is never rendered**, so it vanishes
silently; and **nothing protects the app from merged data it cannot render**, which on a
sync-at-startup app means a crash on every launch that reinstalling does not fix.

If you read only one section, read §4c.

---

## 1. What syncs today

These are `SYNC_STORE_KEYS` in `src/sync.js`. Each is a flat array of `{id, …}` records, which is
what makes the one merge rule (newest-wins per record, §4.1) apply uniformly.

| Key | Holds | Notes |
|---|---|---|
| `gtd_tasks_next` | Next Actions | ⚠ **minus pseudo-actions** — see §4 |
| `gtd_tasks_waiting` | Waiting On | |
| `gtd_tasks_current` | Current Projects | |
| `gtd_tasks_future` | Future/Someday | |
| `gtd_tasks_habit` | Habit **definitions** | The habit itself syncs; its *progress* does not — §3 |
| `gtd_events` | Calendar events | Includes `paused`, `missedOcc`, `completedOccs`, the rolled `date` |
| `gtd_notes` | Notes | |
| `gtd_tags` | Note tags | |
| `gtd_contexts` | Contexts registry | |
| `gtd_completed_next` / `_waiting` / `_current` / `_future` | Completed archives | Append-mostly history |
| `gtd_tray` | Capture tray | |

Plus two that travel but aren't user data:

| Key | Role |
|---|---|
| `gtd_tombstones` | Deletion records. Merges as a union — a tombstone never changes once written |
| `gtd_sync_roster` | Which devices exist and when each last pulled. Drives tombstone GC (§4.5) |

---

## 2. What does NOT sync — the full list, grouped by whether that's correct

### 2a. Genuinely missing, and it matters — habit progress

| Key | Shape | What is lost between devices |
|---|---|---|
| `gtd_habit_runs` | keyed object `{habitId: {schedule, paused, history[], currentRunStart, personalBest, bestSequence, lifetimeTotal, lastProcessedDate, pendingResult, badge}}` | **The whole streak system.** Schedule, paused state, every day's outcome, personal best, lifetime total |
| `gtd_habit_done` | keyed object `{habitId: "YYYY-MM-DD"}` | Whether you ticked it today |
| `gtd_habit_done_order` | `{date, order[]}` | Display order of today's ticks (today-only) |

**Why they were excluded:** W3 and W4 both scoped themselves to "flat arrays of `{id, …}` records",
because that's the shape the merge engine understands. These are keyed objects, so they were left
out — explicitly and in writing, but left out.

**What this means in practice right now:** tick a habit on your phone and the computer never learns.
Worse, each device runs its own sweep and writes its own miss/done history, so the two diverge
permanently and silently. This is the single largest correctness gap in sync today.

### 2b. ~~Genuinely missing~~ — two archive side-maps ✅ **FIXED, chunk A (2026-07-31)**

Both now sync. The stored shape changed from a keyed object to a record array
(`[{id: projectId, items: [...]}]`) purely so the merge engine can read it; the in-memory shape every
caller uses is unchanged, so the fix touched no call site, and reading still tolerates the old shape.
Verified across two devices through the real UI: complete a project on one, un-complete on the other,
and its linked waiting action comes back. It fails against the pre-fix build, per protocol 2.

*The original finding follows, since it is what the fix was for.*

### 2b (original). Genuinely missing — two archive side-maps, and they fail the standard

| Key | Shape | Used by |
|---|---|---|
| `gtd_archived_waiting` | keyed object of **full record copies** | Waiting actions archived when their project was completed, so completing a project can be undone |
| `gtd_archived_events` | keyed object of **full record copies** | Same, for events linked to a completed project |

Same reason as above (keyed objects, not record arrays). But the consequence is worse than "narrower
than habits", and it fails `wrapper-plan.md` §1's standard outright:

> Complete a project on your phone. Its linked waiting actions and recurring events are archived
> (`archiveWaitingForProject` / `archiveEventsForProject`, `app.js:1361`/`1375`) and removed from the
> live stores. That removal *does* sync, so they disappear on the computer too — correctly. Now
> change your mind and un-complete the project **on the computer**: its archive map is empty, because
> the map never synced. **Nothing is restored. The actions and the recurring event are gone.**

Both halves are ordinary use, and the second is the app's own designed remedy for the first — the
code comment at `app.js:1370` says completing a project "is easy to do by mistake, and a deleted
series cannot be got back", which is precisely why it archives instead of deleting. Sync currently
defeats that protection.

**This raises 2b's priority: it is a correctness bug, not a nice-to-have.** The work itself is still
small (§3).

### 2c. Correctly device-local (ruled in `wrapper-plan.md` §4.2 — recommend keeping)

| Key | Why it should not sync |
|---|---|
| `gtd_collapsed:<lane>` | Which groups you've folded shut is a property of the screen you're looking at |
| `gtd_surface` | Which desk background you like on *this* device |
| `gtd_locale` | Which language *this* device shows |
| `gtd_tray_draft` | A half-typed capture still under the cursor. Syncing a live keystroke buffer is a race with no upside |
| `gtd_habit_done_order` | Today-only display ordering, recomputable. Listed in 2a for completeness but belongs here |

### 2d. Sync's own bookkeeping (must never sync — it describes *this* device)

| Key | Role |
|---|---|
| `gtd_device_id` | This device's identity. Syncing it would merge two devices into one |
| `gtd_sync_baseline` | This device's last-merged snapshot — the thing "have both sides changed?" is measured against |
| `gtd_sync_connected` | Whether *this* device has connected |
| `gtd_desktop_sync_folder` | Where Dropbox lives on *this* computer |
| `gtd_dropbox_last_sync` | When *this* device last synced |
| `gtd_dropbox_conflict_log` | What *this* device reported to you |

### 2e. Dev scaffolding (never sync)

`gtddev_drag_log`, `gtddev_drag_log_on`, `gtddev_show_draglog`, `gtddev_show_qa`,
`gtddev_show_snapshot`, `gtddev_show_time`, `gtddev_snapshot`, `gtd_qa_checklist_*`,
`gtd_chunk_map_*`.

### 2f. Derived state — must not sync, and the bug that proved it

Pseudo-actions (the Next Actions row an event mints on its day) live *inside* the synced
`gtd_tasks_next`, but are a pure function of `gtd_events` + today.

**They used to sync, and worse, their removal wrote a tombstone.** A pseudo-action's id is the
event's `taskId` — stable per series, re-minted every occurrence. So one device rolling past an
occurrence published "delete T" for a row the other device was correctly showing; a daily recurring
event would have done that daily. **Fixed 2026-07-31**: excluded from what is published, and their
disappearance no longer tombstones (an occurrence passing is an *expiry*, not a deletion).

---

## 3. "Sync absolutely everything" — how big a job, item by item

Honest sizing. The work splits cleanly into *mechanical* (plumbing a store into the existing engine)
and *judgement* (deciding what merging two copies even means).

| Item | Size | Mechanical or judgement? |
|---|---|---|
| `gtd_archived_waiting`, `gtd_archived_events` | **Small** | Mechanical. Reshape `{id: value}` → `[{id, …}]` and add to `SYNC_STORE_KEYS`. The existing merge covers it |
| `gtd_habit_done` | **Small** | Mostly mechanical, one easy rule: if either device says you ticked it today, you ticked it |
| `gtd_habit_done_order` | **Skip** | Recommend leaving device-local; it is today-only display ordering |
| `gtd_habit_runs` | **Large** | **Judgement.** This is the real work — see below |

### Why `gtd_habit_runs` is the whole job

Its fields are not one kind of thing, and that's what makes it hard:

- `history[]` — **accumulated.** A record of what happened. Cannot be recomputed.
- `schedule`, `paused` — **settings.** Ordinary editable fields; newest-wins is fine.
- `currentRunStart`, `personalBest`, `bestSequence`, `lifetimeTotal` — **derived.** Every one is a
  pure function of `history` + `schedule`.
- `lastProcessedDate`, `pendingResult`, `badge` — **device-local sweep bookkeeping.**

Merging those uniformly by newest-wins is exactly the failure you named: two devices with different
histories, one timestamp wins, the loser's day disappears.

**The shape of the answer, and it's simpler than it first looks:** merge `history` per day, treat
settings as ordinary fields, then **recompute every derived field from the merged history.** Streaks
and personal bests are never merged — they're recalculated, so they cannot disagree.

That leaves exactly one genuine decision: **two devices disagree about the same day.**

### The rule I'd propose for that day — assertions beat inferences

Your instinct in the conversation was that accidental, counterintuitive loss is the thing to prevent,
and that a completion erased by a timestamp race is the clearest example. There's a principled rule
that gives you exactly that, and it isn't arbitrary:

> **A "done" is something you did. A "miss" is something nobody did.**
>
> A completion is a *positive assertion* — you tapped a checkbox on a specific day. A miss is an
> *inference* the sweep draws from the absence of a completion, on whatever data that device happened
> to hold. An inference drawn from incomplete information must never overwrite a direct assertion.
>
> So for the same day: **done wins over miss, regardless of timestamps.** Two "done"s agree. Two
> "miss"es agree. Only done-vs-miss needs the rule, and it always resolves the same way.

This is not a special case bolted on — it's the same reasoning behind `wrapper-plan.md` §4.3's
existing pull-before-sweep rule, which exists *because* a sweep on stale data infers false misses.
That rule reduces how often the situation arises; this rule makes it safe when it does.

It also fails in the direction the project already prefers everywhere else: the worst case is a
streak that is too generous, never one that erases a day you actually did. Generosity is recoverable
and obvious; erasure is silent and infuriating.

**Size, with that rule chosen:** reshaping the store, the per-day merge, recomputing the derived
fields, and a test suite for it — comparable to W4 itself. It is the largest single remaining piece
of sync work, and it is the one worth doing.

---

## 4. The other thing "everything syncs" runs into: lane moves

Not a store, but it belongs in this document, because it's about whether synced data stays correct.

**Moving an item between lanes is currently modelled as a delete plus a create.** `promote()`
(`app.js:1217`) and `moveKind()` (`app.js:1261`) each save *both* the source lane and the
destination lane. The removal writes a tombstone; the insertion re-creates the **same id** in a
different store.

Two devices racing that can produce the same id in two lanes at once, or lose it from both.

By your own principle this is lower priority than habits — it takes a deliberate collision (moving an
item on one device while editing or deleting it on the other) rather than the ordinary act of
ticking a checkbox. But it's worth recording that the model disagrees with itself here: an item's
lane is data *about* the item, currently expressed as *which file it's filed in*.

**Two ways out, not chosen:**
1. Make lane membership a **field on the record**, so a move is an ordinary edit and newest-wins
   handles it natively. Removes the class entirely; a data-model change touching every lane read.
2. Keep store-per-lane and teach the merge that an id has one home, picking a winner when it finds
   two. Smaller, but leaves the contradiction in place.

---

## 4b. Merge granularity: today the whole record wins, and that loses ordinary edits

Found 2026-07-31, answering the author's questions about descriptions, temptation bundles and habit
cues. It is not specific to those fields — it applies to every record in the app.

**The merge unit is one whole record.** Newest-wins picks one entire object and discards the other
completely. So two edits to the *same item* collide even when they touch completely different fields.

Worked example. A habit "Floss" has one hook (A) and one text cue ("After breakfast"). On the phone
you add hook B. On the computer you add the cue "After dinner". They sync:

- computer's record newer → hooks `[A]`, cues `["After breakfast", "After dinner"]` — **hook B is
  gone**
- phone's record newer → hooks `[A, B]`, cues `["After breakfast"]` — **"After dinner" is gone**

Nothing warns you, and the two edits never touched the same field. By §1's standard this is squarely
accidental loss in normal use: editing an item's description on one device and its temptation bundle
on the other is ordinary, and the mechanism that eats one of them is invisible.

**⚖ Author's ruling, 2026-07-31: merging should be per field, not per record.**

Three levels, so the ruling's reach is clear:

1. **Record-level** — what ships today. Any two edits to the same item collide.
2. **Field-level** — the ruling. Each field resolves independently, so the example above keeps both
   the hook and the cue. Fixes every *cross-field* collision.
3. **Element-level** — **⚖ ruled out, 2026-07-31. Not doing this.** Field-level still loses one when
   both devices edit *the same* field: two devices each adding a different hook are both writing
   `hooks`. Merging the array's elements individually would fix it and is feasible (each hook carries
   the target's id; text cues are bare strings that could union by value) — but the author's ruling
   is that it isn't worth it: the loss is a single cue you can retype, and it needs both devices to
   edit the same field of the same habit before syncing, which is not normal use. A correct
   application of §1's standard, and it also avoids adding a second kind of merge rule, which §1's
   own corollary warns against.

   **What is knowingly accepted:** add one hook on the phone and a different hook on the computer
   before they sync, and one of them is gone. Field-level merge does not cover it and nothing will.

**Cost of field-level:** moderate, and mostly mechanical. `mergeRecordArray` currently picks a winner
object; it would instead build one by choosing each field. That needs per-field timestamps — a record
would carry something like `modifiedFields: {title: <ms>, hooks: <ms>}` alongside `modifiedAt`, which
`stampAndTombstone` already has the before/after comparison to produce. Every stamped record grows,
and the conflict report becomes per-field (which is an improvement — "your description was replaced"
beats "this item was replaced").

## 4c. When merged data cannot be rendered — the crash-loop the author raised

The author's concern, and it is the right one: **the app syncs on startup.** If merged data crashes
the render, the app crashes every launch. Reinstalling does not help, because the cause is in the
cloud file, and it is re-pulled the moment the user reconnects. That turns a data bug into an
unusable app with no obvious way out — on a phone, with no console.

Two distinct failure shapes, and today only one of them is even loud:

- **Disappearing.** `buildTree` buckets tasks by `parent`; rendering walks the roots and each
  surviving group's children. A task whose `parent` names a list deleted on the other device lands in
  a bucket nothing ever renders. It is in storage, it syncs, and **no lane shows it.** Notably,
  `contextId` already has exactly this safety net — a member whose context no longer resolves falls
  back to a loose card, and the code calls it "the unlink safety net" — while `parent` has none. It
  has never bitten because deleting a list *through the UI* clears its children's parent first; only
  a merge can produce the orphan.
- **Crashing.** Nothing validates a merged record's shape before it is written and rendered. The
  author's example — a habit given more than `MAX_HOOKS` cues by merging two 7-hook habits — happens
  to be harmless, because the cap is enforced only in the drafting UI (which targets it offers,
  whether Add is enabled) and nothing downstream depends on it. That is luck, not design.

**Three layers, cheapest first — 1 and 2 shipped in chunk A:**

1. ✅ **Render defensively (BUILT, chunk A).** `buildTree` now treats a `parent` that names no
   existing list as "loose", so an orphaned card renders where you would look for it instead of
   vanishing. This is the one reference that had no net; `contextId`, habit hooks and waiting
   conditions already had theirs.

   **The rule is NOT "always keep it visible", and getting that wrong would have been its own bug.**
   Writing the recurrence lifecycle test (protocol 4) turned up a second orphan of the opposite kind:
   delete a recurring event on one device, and the merge removes it from `gtd_events` on the other —
   but its pseudo-action lives in `gtd_tasks_next`, is deliberately never synced (derived state does
   not travel, §2f), and nothing cleaned it up. The result was a live Next Action for an event that
   no longer exists, which cannot be completed or opened sensibly. Applying the visible-fallback rule
   there would have preserved a phantom row that acts on nothing — a worse lie than removing it.

   So the rule has two halves, split by who authored the data:

   > **Data the user authored must never vanish** → fall back to *visible*.
   > **Derived data must vanish when its source does** → fall back to *gone*.

   Both are now built: the orphaned-`parent` fallback in `buildTree`, and a sweep in
   `processEventBoundaries()` that drops any pseudo-action whose event is no longer there.
2. ✅ **Validate on import (BUILT, chunk A).** `sanitizeBundle()` in `sync.js` drops anything
   structurally unusable before it can be written or rendered. Deliberately structural only — it does
   **not** enforce app rules like `MAX_HOOKS`, because that would be a second rulebook to keep in step
   with the first, and getting it wrong would silently discard real data. Layer 1 is what makes
   odd-but-well-formed data safe.
3. **A recovery path that does not need a console** — *not built.* Boot's render wrapped so a throw
   cannot leave a blank app, with a plain-language way out: use local data only, or start a fresh sync
   file. Worth building only if 1 and 2 prove insufficient.

⚑ On the author's "or delete it and start a new one": it must be **offered, never automatic.**
Silently deleting the shared file is destructive and irreversible, and CLAUDE.md's standing ruling is
that data destruction is possible but never accidental. The escape hatch belongs behind an explicit
confirm, phrased so it is clear the other device's copy is what will be replaced.

## 5. Summary — the recommended order

Ordered by `wrapper-plan.md` §1's standard: **accidental loss during normal use first, deliberate
collisions last.**

**✅ CHUNK A — shipped 2026-07-31.** Render defensively, validate on import (§4c layers 1–2), and the
two archive maps (§2b). The safety net went first deliberately: it is what limits the damage while
the merge engine itself is being operated on.

**CHUNK B — next, not started:**

1. **`gtd_habit_runs` + `gtd_habit_done`**, with the assertions-beat-inferences rule (§3). Loses data
   from the single most ordinary act in the app — ticking a checkbox.
2. **Per-field merge** (§4b, ruled). Fixes every cross-field collision — description versus
   temptation bundle, hooks versus text cues — which are ordinary edits today silently eating each
   other.

These two are one chunk because habit sync's design already assumes fields merge independently;
building it on today's whole-record merge would mean writing habit-specific logic that per-field
would then partly obsolete. Both also change stored shapes, so together they cost one Reset instead
of two — **and that freedom expires the day real use begins** (CLAUDE.md), which is worth deciding
deliberately rather than discovering.

**Later, or never:**

3. **The boot recovery path** (§4c, layer 3). Only if chunk A proves insufficient.
4. **Lane moves** (§4). Requires a deliberate collision, so by the standard it is genuinely lower
   priority. Worth fixing when convenient; not worth contorting the design for.
5. **Leave 2c, 2d, 2e and 2f alone.** They are correct as they are, and 2f is correct *because* it
   was wrong once.

**Ruled out and not on this list:** element-level array merge (§4b level 3). Two devices editing the
same field of the same habit is not normal use, and the loss is one retypeable cue.

After 1 and 2, "everything that is yours syncs" is a true statement, and the only things left out are
this-device facts (which desk you like, where your Dropbox folder is) and scaffolding.

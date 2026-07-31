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

The gap that matters is habits. Everything else on the not-synced list is either correct or small.

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

### 2b. Genuinely missing — two archive side-maps, and they fail the standard

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

## 5. Summary — the recommended order

Ordered by `wrapper-plan.md` §1's standard: **accidental loss during normal use first, deliberate
collisions last.**

1. **`gtd_habit_runs` + `gtd_habit_done`**, with the assertions-beat-inferences rule. Loses data from
   the single most ordinary act in the app — ticking a checkbox.
2. **`gtd_archived_waiting` + `gtd_archived_events`.** Small and mechanical, but it silently defeats
   un-complete, which is the app's own safety net for an easy mistake (§2b). Fails the standard.
3. **Lane moves** (§4). Requires a deliberate collision — moving an item on one device while editing
   or deleting it on another — so by the standard it is genuinely lower priority. Worth fixing when
   convenient; not worth contorting the design for.
4. **Leave 2c, 2d, 2e and 2f alone.** They are correct as they are, and 2f is correct *because* it
   was wrong once.

After 1 and 2, "everything that is yours syncs" is a true statement, and the only things left out are
this-device facts (which desk you like, where your Dropbox folder is) and scaffolding.

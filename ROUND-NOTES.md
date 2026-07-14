# Round notes — what changed in `spec.md` and what still needs you

Applied to `spec.md` only. `CLAUDE.md` needed no changes this round (included unmodified for
completeness). Full diff: `spec-changes.diff`. The prior audit is in `audit.md`.

---

## 1. Past-due deadlines are now open loops (your ruling)

**§4.8b** — the "Overdue deadlines are NOT open loops … out of scope" paragraph is **deleted and
replaced with the reversal**, stated as a reversal, with the reason it was forced: the old exclusion
rested on an asymmetry (deadlines had a bar, untimed events had none) that **§4.4d deleted this
round**. One display language, one rule.

**The past-due kind now has two shapes**, and the queue table says so:
- **past-due deadline → decision menu** — *Push the date · Complete it · Delete it · Not now*
- **past-due pseudo-action → checkbox** (and tappable)

§4.8b's "one deliberate exception" paragraph is rewritten: **the exception is the pseudo-action, not
the past-due kind.** A late appointment asks *"did it happen?"* (a tick); a late deadline is a thing
you did **not** do, so a checkbox is the wrong control.

**⚑ Two judgment calls, flagged inline in §4.8b, overrule either:**
- **"Not now" is included** in the deadline menu. Omitting it would make this the only undodgeable
  menu in the app — a real design statement, and not one to make by omission. The honest tension is
  recorded in the spec: *Push the date* is arguably the deadline's true deferral, and it writes data
  instead of hiding a card.
- **"Push the date" is an inline date field**, on the precedent of the stalled project's inline
  quick-add. The alternative is tapping through to the item's page.

**Sequencing consequence — §2, chunk 6b row rewritten.** 6b deferred the past-due kind to chunk 7
*because* it was "only a pseudo-action." That premise is dead. **6b now builds all four kinds** (past-due
in its deadline shape) and five chips; **chunk 7 extends the past-due kind to its second shape**, adds
the sixth chip and the "it moved" banner. The instruction inverts cleanly: *don't hard-code the
deadline case*, where it used to say *don't hard-code three kinds*.

**§4.4d** — "the review still catches it, exactly as before" was false and is corrected.

---

## 2. §4.4 has an owner (it had none)

The bar has never existed in the code, and no chunk row cited §4.4. Now:

- **Chunk 2** builds **§4.4b, §4.4c, and the two DEADLINE rows of §4.4d.** It is card rendering, it is
  visual, and chunk 2 exists so nothing ships in the old visual language and gets reworked.
- **Chunk 7** adds **the two EVENT rows** to the same renderer (§4.14c's appointment window; the
  untimed event's born-full bar).

Both chunk rows now say so, and §4.4 carries a ⚠ ownership block. Also fixed: **a deadline created
*for today* has a zero-length window** (§4.4b defines it as creation → due) — it renders full, no
red-shift arithmetic. A build session would have divided by zero.

---

## 3. Event-conditioning moved to chunk 8 — with the condition you need to know about

**§10 is rewritten from DEFERRED to CLOSED/SCHEDULED.** The five-subsystem estimate was computed
before the pseudo-action had a structure. The structure kills four of the five costs: **§4.14a already
requires the task ID to be stable across every roll, so nothing requires it to be allocated at first
appearance.** Mint it when the **event** is created, and a hook-in-advance stores **a plain task ID like
every other condition** — the evaluator, the archive, and §9's re-evaluation never learn events exist.

**What's left is two things, and that is chunk 8's whole scope for this:** the picker gains a
pending-events section (live occurrences only), and condition resolution stops reading a pending
pseudo-action as an orphan.

**⚠ THE CONDITION: chunk 7 must mint the ID at event creation.** This is now a requirement in the
chunk 7 row and a ruling in §4.14a. If chunk 7 mints at 4 AM instead, chunk 8 is **not** cheap — it
becomes a re-allocation of the ID every condition reference in the app points at, landing on the far
side of §1's migration boundary (chunk 8 *is* the export/import floor for real use). Chunk 8's row
also says: **build the feature first, then the serializer.**

**Retired, so it isn't re-derived:** §10's "this re-introduces date-driven promotion through a side
door" objection is **wrong** and is recorded as wrong. Promotion fires on the pseudo-action being
**completed** — a user tick, not a clock event.

**Unverified assumption, flagged in the spec:** that task IDs are globally unique and nothing
enumerates `gtd_tasks_next` assuming every row renders. §1's ID-preservation ruling implies the
first; the second is a build-session check.

---

## 4. Chores

- **§4.3d** — contexts: added the ⚠ clause that a pseudo-action takes a context because it **lives in
  the Next Actions lane**. "The whole list" / "nowhere else" were lists of **lanes**, and the event
  page's Context field is not a lane; a chunk-7 session would have had a plain mandate to delete a
  field §4.1, §4.14, §4.14a and §4.15b all require. Same clause in the chunk 3 row and the decisions log.
- **Decisions log** — three stale rows fixed: *Waiting promotion rule* (still said "a **Next Action**
  condition," the exact phrasing §4.2 was rewritten to prevent), *Waiting condition targets*, and
  *Edit page exits* (now names its two ruled exceptions: no 🗑 on the Tags page, no ✕ on the completed page).
- **§4.3e** — "the second option opens an inline row, **not a create page**" now says *on the action
  and project lanes*; Notes is the ruled exception and the table already said so. Build split fixed:
  chunk 2 cannot build the Notes row (chunk 6) or the Calendar row (no badge).
- **Chunk 0a + §2's points ruling** — the kill-list named **`addPoints`, which does not exist**. The code
  has `awardPoints` / `loadPoints` / `savePoints`. A first grep would have found nothing.
- **§4.6** — Back = ✕ now notes the one page with no ✕.

---

## Still open for you

1. The two ⚑ judgment calls in §4.8b's deadline menu ("Not now"; inline date field).
2. Nothing else. The chunk map now has an owner for every section it references.

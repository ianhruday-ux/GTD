# Audit — GTD Console spec round (fresh instance)

**Inputs:** `spec.md` (2,227 lines, post-change), `CLAUDE.md` (135 lines, post-change),
`changes.diff` (this round's edits), `index-47-2.html` (the built app, 4,399 lines).

**Method:** read the diff, then read the *current* spec around every line it touched, then
grep the whole document for the phrasings the diff claimed to have retired, then check the
diff's factual claims (its §-citations and its claims about the code) against the source.

**Verdict.** The round is mostly sound: every citation correction I checked is correct, and
the fixes to §4.1's Time row, the habit-toggle analogy, the migration line, and the ✕-on-the-
completed-page line are all real bugs that would have cost a build session. But the round has
a signature failure mode: **it made absolute statements ("that is the whole list", "nowhere
else", "no X anywhere") that swept up cases they didn't mean to, and it amended two sections
without re-reading the third that depended on them.** Three of those are load-bearing. One
(#3) is not a wording problem at all — it is a hole in the chunk map.

---

## 1. 🔴 The review now both does and does not catch past-due deadlines

**This is the round's worst regression, and it was introduced by an edit, not inherited.**

- §4.8b, unchanged, still says: *"**Overdue deadlines are NOT open loops.** They are late, not
  unresolved, and their red bar is already shouting. **Out of scope.**"* Its queue table defines
  the past-due kind as *"i.e. a **pseudo-action** (§4.14)"* — events only.
- §4.4d, **new this round**, says of the passed chip: *"**The review (§4.8b) still catches it** as a
  past-due open loop, **exactly as before**."*
- §7's *Dates* block, **rewritten this round**, says: *"An untimed thing — **a dateless-time
  deadline** or an untimed event — … The review (§4.8b) picks it up **like any other past-due
  item**."*

So the spec contains, in three places, both "deadlines are out of scope for the review" and
"deadlines are picked up by the review." "Exactly as before" is the tell: before, it was
explicitly *not* so.

**It cascades into the chunk map.** The 6b row defers the past-due open-loop kind to chunk 7 on
the stated grounds that *"the past-due open-loop kind is now **only** a pseudo-action, and
pseudo-actions arrive with the calendar."* If §4.4d and §7 are right, that premise is false —
**deadlines exist today**, so past-due open loops exist in 6b, and 6b should build the fourth
kind rather than defer it. The whole "6b builds three kinds and five chips" ruling rests on the
sentence §4.4d contradicts.

**Needs a user ruling, not a wording fix.** Two coherent answers:
- *(a)* Deadlines stay out of the review (the chip is the whole statement, the red bar is the
  nag). Then delete the review sentence from §4.4d, and fix §7's Dates bullet to say the review
  catches the **event** case only. 6b's three-kinds ruling survives.
- *(b)* Past-due deadlines **are** open loops. Then delete §4.8b's "Overdue deadlines are NOT open
  loops" paragraph, widen the table's past-due row from "pseudo-action" to "any past-due dated
  item", and **rewrite the 6b row** — it builds the past-due kind (deadline case) and chunk 7 only
  extends it to pseudo-actions.

Note that §4.8b's exclusion has an argument behind it ("two nags for one problem" — the same
principle §9's orphan ruling settles), and §4.4d has an argument behind it ("two surfaces, one
fact — *not* two nags"). **They reach opposite conclusions from the same principle.** That is
worth deciding on purpose.

---

## 2. 🟠 "Contexts apply to Next and Waiting. That is the whole list." — except events

§4.3d was strengthened this round from "not the project lanes" into three absolutes:

- §4.3d: *"Where they apply: **Next Actions and Waiting Actions. That is the whole list. RULED.**"*
- §4.3d: *"**It is the only Context set in the app.**"*
- Chunk 3 row: *"shared Next↔Waiting, **and nowhere else**"*
- Decisions log: *"**shared Next↔Waiting and nowhere else**. One registry, one set"*

Four other places say events carry a context:

- §4.1 field matrix, Event column: *Context* ✅ *(edit-only, and inert until it is a pseudo-action —
  4.15a)* — **left in place by this round**, in the same table whose Context row you edited.
- §4.14: the pseudo-action *"is draggable, **droppable into a context**, and completable."*
- §4.14a: it must be a stored row *"because it holds state a projection cannot: drag position,
  **context**, completion."*
- §4.15b: *"On roll, the new pseudo-action **inherits the previous one's context**"* — with dead-parent
  handling if that context was deleted.
- §4.15a: *"**Context is not on this row.** It is **edit-only, from the event page.**"*

The reading that saves it is that a pseudo-action *lives in the Next Actions lane*, so "Next
Actions" covers it — and §4.2's promotion rule was amended **this round** to make exactly that
argument (*"the qualifier is the LANE, not the type"*). But §4.3d's list is a list of **lanes**,
and the event **page's** Context field is not a lane, and "nowhere else" is what a chunk-7 build
session will read.

**Fix (cheap):** add one clause to §4.3d's "Where they apply" bullet — *"…and to events, via the
pseudo-action, which lives in the Next Actions lane (§4.14, §4.15a). The registry is still the
action-lane registry; there is no second one."* Same clause in the chunk 3 row and the decisions
log. Nothing else changes; the ruling you meant survives intact.

---

## 3. 🟠 Nobody builds §4.4. The deadline progress bar does not exist and no chunk owns it.

This one is not a wording defect.

- **The bar is not in the code.** `index-47-2.html` line 2407, in the screen-refactor header
  comment: *"Deliberately NOT in this chunk … **deadline-approaching progress bar visuals
  (chunk 6)**."* That "chunk 6" is the **old** numbering, from before the resequence. There is no
  bar rendering anywhere in the file.
- **No chunk in §2 cites §4.4.** I grepped: the chunk rows cite §4.7b, §4.10b, §4.3d, §4.3e,
  §12.1, §12.2, §4.8a/b, §4.9, §4.10, §4.3c, §4.13–§4.15. **§4.4 appears in no row.** Chunk 2 is
  scoped to the layout cleanup and the nav tabs; chunk 7 owns §4.13–§4.15, which gets you §4.14c's
  *appointment* bar and nothing else.
- **This round made the gap bigger, not smaller.** §4.4d is a new build item of real size: four
  display cases, a window rule that differs per case (an untimed *deadline* has a runway and reddens
  at 85%; an untimed *event* has none and is born full), a passed chip, and a red-shift keyed to the
  window rather than the clock. §4.14c and §7's *Dates* block now both **depend on it** — chunk 7
  cannot render an appointment correctly against a display language that was never built.
- The **optional time on a deadline** is the one part that *does* exist: `data-field="deadline-time"`
  is already in the code (line 2975), which is why this round's §4.1 fix was right. But the bar it
  now feeds is vapour.

**Fix:** give §4.4 an owner. The natural home is **chunk 2** (it is card rendering, it is visual, and
chunk 2 exists precisely so nothing gets built in the old visual language and reworked) — but 4.4d's
*passed chip* logic for events can't be tested until chunk 7. Cleanest split: **chunk 2 builds §4.4b/c
and the deadline half of §4.4d** (both deadline rows of the table, plus the chip); **chunk 7 adds the
two event rows** to the same renderer. Whatever you choose, put it in a row — right now the largest
single new ruling of the round has no build session attached to it.

---

## 4. 🟡 The decisions log still contradicts §4.2's rewritten promotion rule

§4.2, rewritten this round, warns in as many words that *"a literal `type === 'next'` check would
silently refuse to promote anything hooked to an event"* — and then the decisions log, untouched,
says:

| Waiting promotion rule | Auto-move only when a **Next Action** condition is completed |

That is the exact phrasing §4.2 now exists to prevent, sitting in the table a session skims for a
summary. Same row block:

- **Waiting condition targets** — *"Next Actions or other Waiting actions"*; §4.2's new picker bullet
  says pseudo-actions are valid targets too.
- **Edit page exits** — *"← save+exit; ✕ cancel/discard; 🗑 delete"* — now has **two exceptions this
  round created**: the Tags page has no 🗑 (§4.9b) and the completed page has no ✕ (§4.12b).

The decisions log is the one place in the document whose whole job is to be the short version, and
this round updated six of its rows while leaving three that now say the opposite of the sections
above them.

---

## 5. 🟡 Smaller inconsistencies, in descending order of how likely they are to bite

**§4.3e's "not a create page" bullet vs. the Notes row.** *"The second option opens an inline text
row with an add button — **not a create page, not a dialog**"* — while the table you just told
readers to trust literally says Notes' second option **navigates to the Tags page**. The bullet's
closing sentence (*"This is true of both New context and New list"*) technically scopes it, but the
lead clause says "the second option" unqualified. One word fixes it: *"On the action and project
lanes, the second option opens an inline text row…"*

**§4.3e's build split vs. chunk 2.** *"**Chunk 2** builds the whole thing: badge menu, **the label
table above**, the inline naming row"* — the label table now contains a **Notes** row (chunk 6) and a
**Calendar** row (chunk 7). Chunk 2 cannot build them. Say so: chunk 2 builds the five lanes that
exist; chunk 6 adds the Notes row when the lane arrives.

**Chunk 0a's kill-list names a function that doesn't exist.** It says to delete *"`gtd_points`,
`state.points`, **`addPoints`**, the header counter."* The code has `awardPoints`, `loadPoints`,
`savePoints` — there is no `addPoints`. A first-session grep for it finds nothing, which is a bad
first five minutes for the very first build session. Fix the names.

**§4.4b's window on a same-day untimed deadline.** §4.4b sets the bar's window as *creation → due
date*; §4.4d says an untimed deadline *"arrives full at the 4 AM boundary"* of its day. A deadline
created **for today** has a degenerate (zero or negative) window. The right answer is obviously
"render it full," but §4.4d's red-shift bullet goes out of its way to say untimed deadlines have a
runway and redden normally — a build session will divide by zero here. One sentence.

**Back = ✕ on pages that have no ✕.** §4.6: *"Back … means **✕ (cancel and discard)**."* The
completed page now has **no ✕** (§4.12b, this round). Harmless in practice — there is nothing to
discard, so Back closes — but §4.6 states the mapping as a universal, and it now has an exception.

---

## 6. ✅ Verified correct — claims I checked and found sound

The round makes several assertions *about the document* that would be damaging if wrong. They
aren't:

- **The §9 → §7 citation fix (§4.9b's tag-delete confirm) is correct.** §9 contains no dialog of any
  kind — it is the staged-edits/timer ruling and its case table. §7 *does* contain the save-time
  dialog it now cites (*"Current → Future demotion … fires **at Save**, not on tap; Cancel leaves the
  page open with the convert still armed"*). The old citation was wrong; the new one is right.
- **The §10 quotation in §4.2 is accurate.** §10 does say *"the cheap half already works, free"* and
  does hang the stable-ID ruling (§4.14a) on it. The lane-not-type promotion rewrite is therefore
  load-bearing exactly as claimed.
- **The §4.1 "Time — events only" fix matches the code.** `data-field="deadline-time"` ships today.
  The old row contradicted the running app, not just §4.4.
- **The habit-toggle correction is right and matters.** The old "mirrors the list **checkbox**" line
  did tell a build session to commit on tap, and CLAUDE.md's draft-isolation ruling does explicitly
  exclude the checkbox from drafting surfaces. §9's day-stamp ruling would have been dead code —
  which is the golden rule's origin specimen, on the same feature, for the second time.
- **The migration reconciliation is complete.** I grepped for survivors: §1, §3, §4.3d's build note,
  the chunk 0a/3 rows, the decisions log, and CLAUDE.md all now say "no migration." Nothing is left.
- **The points layer is fully struck from the prose.** No hook left anywhere in the spec.
- **§4.12b and §12.2 now agree** on ← only / no ✕, and §4.12b's "Restore and 🗑 act immediately"
  reasoning is consistent with the draft-isolation ruling rather than an exception to it.

---

## 7. Note on the code baseline

`index-47-2.html` is the **pre-sprint** build — chunk 0a has not run. It still contains the full
Google Tasks layer (the GSI script tag, the `tasks` OAuth scope, the API base), three `window.alert`
calls in the Google paths, `prompt()` for mini-list creation, the Google Fonts CDN link, `gtd_points`
/ `state.points` / `awardPoints`, a single `state.returnScreen` slot, and no contexts registry, no
events, no bar. That is exactly what §2 and §3 say the code should be, so the spec's account of the
*current* state checks out — with the one exception noted in §5 above (`addPoints`).

Two things worth knowing before chunk 0a:

- The banned native dialogs are **all in code chunk 0a deletes** (the Google paths) except for the
  one `prompt()` on mini-list creation, which §4.3e retires in **chunk 2**. So the "banned app-wide"
  ruling is not actually satisfied until chunk 2 — fine, but it means the ban currently describes an
  intent, not the code, and a session running a compliance grep in 0b will find a hit.
- `qaTimeOffset` (§12.3, chunk 0c) does not exist yet, and §4.14b explicitly says the app-day rule is
  **untestable without it**. That dependency is correctly sequenced (0c precedes 7) — just noting it
  holds.

---

## What I'd do next, in order

1. **Rule on #1** (are past-due deadlines open loops?). It changes the 6b row either way, and 6b is
   close enough on the board to matter.
2. **Add the event clause to §4.3d** (#2) — five minutes, prevents a chunk-7 session from deleting a
   field §4.1 requires.
3. **Give §4.4 a chunk** (#3). This is the one that is not a document problem.
4. Sweep the decisions log (#4) — it is the only table in the spec that is *supposed* to be
   redundant, which is exactly why a stale row there is worse than a stale row anywhere else.

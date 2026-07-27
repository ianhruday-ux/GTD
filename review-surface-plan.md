# The review surface — planning document

> ## ⛔ MUST FIX — live bug, independent of everything below
>
> **The Chinese info text for a missed repeat quotes buttons that do not exist.**
> `info.review.missed` (zh-Hans) tells the user to press 「我做了」 and 「算了吧」; the buttons on
> screen say **我做完了** (`review.iDidIt`) and **不管了** (`review.letItGo`). The English pair
> matches exactly — only the Chinese drifted, in the native-speaker pass. A Chinese user is being
> directed to a control that is not there.
>
> **Author has flagged this for fixing.** It rides along with the `Skipped` rename (§6a) if that
> happens first — but if the rename is deferred for any reason, **fix this on its own anyway.**
> Whoever fixes it: re-read the whole zh-Hans `info.review.*` block for the same class of drift, not
> just this one string.

**Status: nothing in §3–§6 or §8 is built.** This records the author's rulings from the
review-surface conversation (2026-07-27) and the survey work done alongside them, so a later session
can build without re-deriving any of it. Where it says **RULED**, the author decided it; where it
says **builder's call**, pick the simplest option and flag it in the handoff (CLAUDE.md).

**§8 is unrelated to the review** — it is the Advanced button, noticed in the same conversation and
parked here rather than in a document of its own. It can be built independently and in any order.

Read with `spec.md` §4.8b (the daily review) and `src/app.js` `reviewCardHtml` / `reviewBodyHtml`
(~line 6690 onward), plus the `.review-*` block in `src/styles.css` (~1193–1260 base, ~2060–2100
desktop).

---

## 1. Already shipped in the same conversation (context, not work)

Two items were decided and built immediately; they are recorded here so the doc reads as a complete
account of the round, **not** as outstanding work.

- **Desktop capture card is now three rows: 6 / 2 / 2.** Six lane chips across the top (keeping the
  pair grouping — Next·Waiting, Project·Future, Habit·Note — with a wider gap between pairs than
  within one), Calendar + 2 min centred on row 2, Not now and Delete pushed to opposite corners on
  row 3. The review card went back from 780px to the base 700px: the widening existed *only* to fit
  the old 8-chip single row. Desktop now mirrors the phone's **shape** while keeping its own split
  of the lane chips (6 across vs phone's 3 + 3), which is the template §5 generalises.
- **"Show all" removed.** RULED: *"once the review has started, there is no need for such a
  button."* The redaction is only a discipline if there is no button beside it offering to undo it.
  The remaining-count (`N to review`) stays — information, not an escape hatch. Revealing captures
  in the **drawer**, before the review starts, is untouched and still fine. `spec.md` §4.8b has been
  amended. `review.showAll` / `review.oneAtATime` are now dead i18n keys, left in place rather than
  deleted (builder's call, flagged) — delete them if you touch that table for another reason.

---

## 2. The two questions CLAUDE.md requires

Answered before any mechanics, because §5 is a redesign of a basic system.

**What is the purpose of the review surface?** To walk you through *everything the app has noticed
is slipping* — one item at a time, in a fixed order you do not get to shop around in — and make you
**decide** on each one. Not do the work: decide. The queue is derived, never snapshotted, so a
decision that resolves an item removes it and a decision that doesn't leaves it there. The surface
exists to convert a vague sense that things are drifting into a finite, visibly shrinking stack.

**What should the UI teach the user about it?** Three things, and the current surface teaches the
first two well and the third badly:

1. *This is finite and it is shrinking.* (Redaction bars + the count. Working.)
2. *You must choose; you cannot browse.* (One card revealed, no cherry-picking. Working — and
   strengthened by removing Show all.)
3. **_The same kind of choice looks the same everywhere._** This is the failure §5 addresses. Right
   now each of the five card kinds invented its own menu, so "get rid of this" is a red-bordered
   `Delete it` on a project, a grey-with-red-text `Delete` on a capture, a `🗑 Delete` on a past-due
   event, a `Let it go` on a missed occurrence, and *absent* on an orphaned waiter. The user is
   being asked to re-learn the vocabulary on every card. **What the surface should teach is that
   the review has a small, fixed decision vocabulary** — roughly *do it / defer it / re-aim it /
   drop it* — and each card just offers the subset that applies to it.

That third point is the whole brief for §5. Any proposal that standardises the *pixels* but leaves
five different verbs for the same act has missed it.

---

## 3. Item A — the info button must be scoped to the card on screen

### The problem

`reviewInfoPanelHtml()` (app.js ~6575) renders **one fixed blob covering every kind at once**,
prepended to `.screen-body` above the card, and the ⓘ in the review header just toggles its
`hidden`. It always contains:

- a **"sorting"** block — all six lane definitions from `LANE_INFO`, plus the 2-minute rule;
- a **"deciding"** block — the past-due, stalled, orphaned and missed explanations.

So a user looking at a *stalled project* card is told what the Notes lane is for, how the 2-minute
rule works, and what an orphaned waiting action is. Only one of the seven paragraphs on screen is
about the thing in front of them, and the useful one is buried.

**RULED (author): the info button should only show text relevant to what is on the page.**

### What "on the page" means

The review reveals **exactly one card at a time** (§4.8b, and now with no Show all to break that
invariant). So "what's on the page" is unambiguous: **the revealed card's kind.** The mapping is
already half-built — `reviewMenuInfo()` (app.js ~6566) is exactly the per-kind table, it is simply
never used to *filter* anything.

| Revealed card | Info panel should show |
| --- | --- |
| `capture` | the sorting block: six lane definitions + the 2-minute rule. **This is the only kind that needs it** — sorting is what a capture card asks you to do. |
| `pastdue` (deadline) | `info.review.pastdue` |
| `pastdue` (pseudo-action/event) | `info.review.pastdue`, *possibly* a distinct string — its menu is a tick/delete, not a push (see open question Q3) |
| `stalled` | `info.review.stalled` |
| `orphaned` | `info.review.orphaned` |
| `missed` | `info.review.missed` |
| end state (all clear / all deferred) | builder's call — simplest is to hide the ⓘ entirely; there is nothing on the page to explain |

There is already precedent for the review showing *less* than the lanes do: `LANE_INFO_EXTRA`
(app.js ~31) holds the "→→" paragraphs that the lane's own ⓘ shows and **the review deliberately
withholds**. Scoping by kind is the same instinct applied one level further in.

### Implementation sketch

Small and self-contained; this is not a redesign.

1. `reviewInfoPanelHtml()` takes the revealed loop (or its `kind`) as an argument.
2. It returns the sorting block **only** for `capture`, and the single matching "deciding" paragraph
   otherwise. Headings stay (`review.heading.sorting` / `review.heading.deciding`) but only the one
   in play is emitted.
3. `reviewBodyHtml` already computes `active[0]`; pass it through. It currently emits the panel
   *before* it knows whether the queue is empty — that ordering needs a small shuffle.
4. The panel keeps its current position (top of `.screen-body`, above the card) and its
   `hidden`-toggle handler at app.js ~4872 is unchanged.
5. **Trap:** the panel's open/closed state is DOM-only (`panel.hidden`), not in `state`. Every
   review decision re-renders the whole screen, so the panel silently closes on each one. Today that
   is invisible because the content never changed; once the content is per-card, a user who opens
   ⓘ, decides, and gets a new card will find it shut. Decide deliberately whether it should
   **persist across cards** (needs a `state.screen.reviewInfoOpen` flag) or **close on each new
   card** (current behaviour, arguably correct — the explanation was for the card you just
   dismissed). Builder's call; flag it. Persisting is the friendlier read if a user is working
   through several cards of the same kind.

### Verification

- Seed one loop of each kind; for each, open ⓘ and assert the panel contains the expected string
  **and none of the other four**.
- Capture card: assert all six lane names + the 2-minute text are present.
- Assert the panel is not rendered (or the ⓘ is gone) on the all-clear end state.

---

## 4. Item B — what "standardize the review surface" is actually fixing

This section is **survey, not proposal.** The proposal is §5. Everything below was measured against
the current build, not remembered.

### The five card kinds and how far apart they have drifted

| | capture | missed | pastdue (pseudo) | pastdue (deadline) | stalled | orphaned |
| --- | --- | --- | --- | --- | --- | --- |
| body | plain `<div>` title, **not tappable** | tappable → event page | tappable → event page | tappable → item page | tappable | tappable |
| context line | none | "⚠ went by on …" | deadline/pseudo bar | deadline bar | "⚠ no way forward" | "🪝 after …" |
| controls | 8 chips + 2 | 3 | 3 | 4 | 7 | 6 |
| layout | chip grid, 3 rows | vertical stack | vertical stack | vertical stack | vertical stack | vertical stack |
| `.review-menu` wrapper | **no** | **no** | yes | yes | yes | yes |
| "delete" reads as | `Delete`, grey + red text | *(absent — `Let it go`)* | `🗑 Delete`, `.danger` | `Delete it`, `.danger` | `Delete it`, `.danger` | `Delete`, `.danger` |
| "complete" reads as | *(n/a — `2 min` is the analogue)* | `✓ I did it` | `✓ Mark done` | `Complete it` | `Complete it` | `Complete` |
| icons | none | none | ✓ and 🗑 | none | none | none |
| Not now | cornered, paired with Delete | last item in the stack | last in stack | last in stack | last in stack | last in stack |

Measured at 1440px: the stalled card is **402px tall × 646px wide** — seven full-width buttons in a
single undifferentiated column, no grouping, and the card's width doing no work at all. The capture
card next to it is a compact three-row grid. They do not look like the same product.

### The five concrete defects

1. **Same act, five names.** *(the important one)* `Delete it` / `Delete` / `🗑 Delete` /
   `Let it go`; `Complete it` / `Complete` / `Mark done` / `I did it`. Some of these differences are
   *meaningful* — `Let it go` on a missed occurrence genuinely is not `Complete` — and standardising
   must not flatten the meaningful ones. See Q1.
2. **Delete has two visual treatments**, and the code already knows which one won: the comment at
   app.js ~6613 says the capture card's grey-button/red-text `.review-delete-text` is *"the new
   baseline… the pattern the other three decision menus will be brought in line with next."* That
   promise was never kept. This is the one piece of §5 that is already ruled and just needs doing.
3. **`Not now` is in two different places** — cornered with Delete on a capture, last-in-stack
   everywhere else. It is the *same* control (same handler, same `.review-notnow` dashed styling)
   answering the same question on every card, and it should sit in the same place on all of them.
4. **Two cards skip `.review-menu`**, so their buttons inherit the card's 12px gap instead of the
   menu's 7px. A real, visible inconsistency with a one-line cause.
5. **The long stacks have no hierarchy.** Stalled offers seven controls that are not peers: three
   are *"give the project a way forward"* (add next action / waiting action / event), two are
   *"remove it from play"* (Someday / Complete), one is destructive, one is defer. The flat column
   makes the user read all seven to find the one they want, every time.

---

## 5. Item B — the shape, and where desktop and phone must differ

**RULED (author): the three-band structure is adopted — for the four non-capture kinds.** Build to
it. **§5a is binding and narrows the scope of everything in this section: the capture card is out,
and stays exactly as it is.** Read §5a before building anything here.

**RULED (author): desktop and phone will probably need different interface choices here.** They
already do, and §1's capture card is the working template — **but for its CSS technique, not its
structure.** The technique to copy: **one DOM, two arrangements** — identical markup produces 3+3+2
on phone and 6+2 on desktop with nothing but `order` and `flex-basis` overrides, and it reads as the
same card in both. Generalise *that*, and do not invent a second mechanism.

### The shape the four Rule-B kinds should share

**Not** the capture card — see §5a. For `missed`, `pastdue` (both shapes), `stalled` and `orphaned`:

```
┌─────────────────────────────────────────┐
│ title                    (tappable)     │
│ context line             (⚠ / 🪝 / bar) │
├─────────────────────────────────────────┤
│ the decisions that MOVE this forward    │   ← per-kind, 1–3 controls
├─────────────────────────────────────────┤
│ the decisions that TAKE IT OFF the list  │   ← complete / someday
├─────────────────────────────────────────┤
│ Not now                      Delete     │   ← always last, always corners
└─────────────────────────────────────────┘
```

Three bands, in the same order on every kind, with the bottom band **identical everywhere** — the
capture card's row 3, promoted to a universal. A kind with nothing in a band simply omits it.

- **Phone:** bands stack; controls within a band are full-width rows (except the corner band).
  Close to today, minus the drift.
- **Desktop:** the 700px width is currently wasted. Bands 1 and 2 can lay their controls out
  **horizontally**, the way the capture card's chips already do, which is what collapses that 402px
  stalled card to something that reads at a glance. Same DOM, `flex-wrap` + basis overrides in the
  ≥1000px block.

### 5a. ⚑ RULED — the capture card is NOT banded, and that is correct

**This supersedes the paragraph above** and any earlier claim in this document that the capture card
already *is* the three-band shape. That claim was wrong and the author caught it: **Calendar and
2 min share row 2**, but Calendar is a sorting destination and 2 min means "off the list, I did it
already" — under the bands they are on opposite sides of a boundary. What produces that row is
wrapping arithmetic (seven destinations don't divide into rows of six), not grouping.

**RULED (author): leave the capture card exactly as it is. Apply the bands to the other cards
only.** The reasoning, which is the important part and is now the governing model for the whole
surface:

> The capture card has more controls than any other card, and **the rule it follows is a different
> one: band 3 sits at the bottom, and the rows above it mimic the LANE STRUCTURE.** The other cards
> have no lane options available, so they need a different structural rule — and the bands are the
> right rule for that.

So there is **one universal and two organising rules**, not one rule everywhere:

| | applies to | rule above band 3 |
| --- | --- | --- |
| **Universal** | *every* card | **band 3 at the bottom: Not now (left) · Delete (right)** |
| Rule A — *mirror the lanes* | `capture` only | rows reproduce the lane structure the user already knows from the tab bar / desktop columns, plus Calendar and 2 min. Not banded. Already built; do not touch. |
| Rule B — *bands* | `missed`, `pastdue` (both shapes), `stalled`, `orphaned` | band 1 *move it forward* → band 2 *take it off the list* → band 3 |

**Why this is better than what this document originally proposed.** A capture card's buttons are
**destinations** — the question is *"where does this go?"* and the honest answer is a picture of the
places it could go. The other four kinds' buttons are **decisions** — there is no destination to
show, so grouping by decision-type is the only structure available. Forcing one rule across both
would have made the capture card worse (breaking its lane mirror to satisfy a boundary the user has
no reason to care about) to make a table in a planning document tidier.

**What the capture card still contributes to the standard:** band 3. Its Not now / Delete corner row
is the universal, and it is the one part of it every other card must copy. That, and the
one-DOM-two-arrangements CSS technique below — not its upper rows.

**Consequence for §4's defect list:** defect 5 (flat seven-button stacks) is a Rule-B problem only.
Defects 1–4 (verb drift, two delete treatments, `Not now` in two places, missing `.review-menu`
wrapper) still apply to **every** card including capture, because they are about the universal band
and about vocabulary, not about upper-row structure.

### Do this first, regardless of what §5 becomes

These four are pure convergence, carry no design risk, and shrink the surface the redesign has to
cover. They can ship in one small commit **before** the author rules on the shape:

1. Wrap the capture and missed menus in `.review-menu` (defect 4).
2. Move `.review-delete-text` onto every delete control (defect 2 — **already ruled**, just unkept).
3. Put `Not now` in the same place on every kind (defect 3) — the corner row, since that is the one
   the author has now approved twice.
4. Settle the verb table (defect 1) — but see Q1 first; this one *is* a design question wearing a
   tidy-up's clothes.

---

## 6. Open questions — for the author, do not invent answers

- **Q1. Which verb differences are meaningful?** *(partly resolved — see §6a.)* `I did it` and
  `Mark done` still look like pure drift and should merge. **`Let it go` is now confirmed distinct
  and must NOT be merged into `Delete`** — §6a has the evidence. What remains open is only its
  *label*, which the author has called too long.
- ~~**Q2. Does the three-band shape in §5 survive contact with the author's intent?**~~
  **RESOLVED — adopted, with the capture card excluded. See §5a.**
- **Q3. Does the past-due *pseudo-action* need its own info string,** or does `info.review.pastdue`
  (written for deadlines, which you can push) cover a card whose only options are tick and delete?
- **Q4. Should the info panel stay open across cards** (§3 trap), or close each time?
- **Q5. Where does the *desktop* review sit relative to the phone's?** §1 brought the capture card
  much closer to phone. Is "as close to the phone as the width allows" the standing rule for the
  whole surface, or does desktop get to use its width more aggressively (horizontal bands, §5)?
  These pull in opposite directions and the answer shapes §5.
- **Q6. Does `Skipped` want the same treatment as the tick?** It now records a *status* rather than
  naming an act (§6a), which puts it in the same grammatical family as `✓ Mark done`. Whether it
  should also carry a glyph falls out of the icon question in §4 defect 1 — settle both together.

## 6a. `Let it go` — what it actually is (verified against the build)

Established by reading `events.js` ~231–262 and `app.js` `reviewMissedClear` ~6931; recorded so the
label decision is made against facts rather than memory.

- **It only ever appears for a REPEATING event.** The miss is recorded inside the recurrence
  roll-forward: when a repeating occurrence's whole app-day passes unticked, the app stores that
  date in `ev.missedOcc` and advances the series. A **one-off** event never gets a `missedOcc` — it
  keeps its pseudo-action and reaches the review as *past its date* instead. So the author's
  recollection is correct.
- **One slot only.** A newer miss overwrites an older unhandled one, so a month of ignored dailies
  produces **one** card, not thirty.
- **It clears the miss without recording a completion**, so it never counts as something achieved.
  It destroys nothing — the series is untouched and the occurrence had already been rolled past —
  which is why it is the one review action with no confirm dialog, and why the standing
  data-destruction rule does not apply.
- **Therefore it is a skip, not a delete.** `Delete` on this card would have to mean killing the
  whole repeating series; `Let it go` means "this one instance didn't happen, and that's fine."
  Genuinely different decisions. Merging them would be a data-loss bug wearing a tidy-up's clothes.

**It is described in the info text**, and the description names both buttons in quotes:

> `info.review.missed` — "A repeating thing whose day went by without being ticked. Often you did it
> and forgot to say so — **'I did it'** records it on the day it happened. **'Let it go'** clears it
> without pretending you did. Only the most recent one is ever kept, so this never piles up."

**So renaming the button means editing that sentence too, in BOTH languages.** A rename that leaves
the info text quoting a button that no longer exists is worse than no rename.

### ⚑ RULED — the button becomes `Skipped`, not `Skip`

**RULED (author).** My recommendation was `Skip`; the author overruled it with a reason worth
keeping, because it generalises past this one button:

> **"Skipped" is an adjective that describes the event. "Skip" is a verb which might be confused
> with "Not now."**

That is exactly right and I had missed it. **`Not now` is also a skip** — it is the defer control
that sits on every card, including this one. A button labelled `Skip` next to a button that
literally means "skip this for now" is two verbs competing for the same act. `Skipped` sidesteps the
collision by changing what the label is *about*: it is not an instruction to the user, it is a
**status being recorded about the occurrence** — this instance was skipped. Same grammatical move as
a tick recording "done".

**Generalise this when settling the rest of the verb table (§4 defect 1).** On this surface, a label
that describes *what becomes true of the item* is safer than a label that names *the act you are
performing*, because the acts are all fairly similar ("get this off my screen") and the outcomes are
not. Check every proposed label against `Not now` specifically — it is the one control on every
card, so it is the one everything else can collide with.

**Chinese:** `跳过` is the verb ("to skip") and carries the same collision. Prefer a past/stative
form — `已跳过` ("skipped" / "has been skipped") is the direct equivalent of the author's reasoning.
Confirm with a native speaker before shipping; the last Chinese pass is what introduced the
must-fix bug at the top of this document.

**Do not forget the info text.** `info.review.missed` names both buttons in quotes (see above), so
the rename is a **two-string change in each language, four strings total** — plus the must-fix
correction of the two Chinese quotes, which this rename supersedes and must not leave half-done.

### ⚑ Separate defect found while checking this — the Chinese info text quotes the wrong buttons

`info.review.missed` (zh-Hans) quotes button labels that **do not match the actual Chinese
buttons**:

| | button says | info text quotes |
| --- | --- | --- |
| `review.iDidIt` | 我做完了 | 「我做了」 |
| `review.letItGo` | 不管了 | 「算了吧」 |

The English pair matches exactly; only the Chinese drifted. A Chinese user is told to press a button
that is not on screen. **This is a live bug independent of everything else in this document** — fix
it whether or not the rename happens (and fold it in if it does).

## 7. Traps

- **The queue is derived, never snapshotted.** Any change to card markup must survive the fact that
  the whole screen re-renders after every decision and the card under the cursor may be replaced by
  a different *kind*. State that lives only in the DOM (the info panel's `hidden`) is lost on every
  decision — see §3's trap.
- **Do not add a completion checkbox to a review card.** §4.8b: the review offers decisions, not
  execution, with exactly one deliberate exception (the past-due pseudo-action's tick). Any
  "standardisation" that gives every card a checkbox has broken the fence.
- **Draft isolation does not apply here** and must not be introduced by accident. Review decisions
  are applied **immediately**, not armed — that is deliberate and different from every drafting
  page in the app (app.js ~6620). A standardisation pass that makes review controls *look* like
  drafting controls will teach the wrong thing.
- **The capture card's chips are colour-coded to their lanes** via `--lane-accent`, and `2 min` is
  deliberately uncoloured because it sorts nothing. Preserve that distinction under any regrouping.
- **`.review-sort-chips` uses percentage flex-basis, never content-based**, on both phone and
  desktop. A previous round shipped content-based widths and silently dropped to 2-per-row on the
  author's actual phone. Any new band layout must keep deterministic bases.
- **The review is reached from inside the intray drawer.** A check script that clears `#tray-root`
  has thrown away its own entry point (see `checks/review_and_event_page.py`).
- **Do not "standardise" the capture card into the bands.** §5a rules it out explicitly, and the
  temptation will be strong precisely because it is the odd one out in every table in this
  document. It is the odd one out *on purpose*: its buttons are destinations, not decisions.

---

# 8. UNRELATED — the "Advanced" button

Noticed by the author in the review-surface conversation; nothing to do with the review. Built:
nothing. Surveyed against the current build, not remembered.

## 8.1 What exists today

**Two different controls** currently occupy the "the simple form isn't enough" role, and they behave
differently:

| | label | class | what it does | where |
| --- | --- | --- | --- | --- |
| **A. the dialog opener** | `Advanced options…` (`advanced.button`) | `.btn.btn-ghost.btn-small.screen-advanced-btn` | `screen-open-advanced` → opens the **Advanced modal** over the page you are on; Done returns you | drafting pages for **next**, **waiting**, **habit** (`advancedRowHtml`, app.js ~3618) |
| **B. the calendar's** | `More options →` (`cal.moreOptions`) | `.cal-advanced-btn` | `cal-advanced` → `openEventCreateScreen()`, which **navigates to the full event page** and does not come back | calendar quick-add, **Event side only** (events.js ~924) |

Both are transparent-background outline buttons today (`.btn-ghost` is `background:transparent`;
`.cal-advanced-btn` likewise).

**B carries everything already typed** — name, description, date, time, recurrence, interval,
tickler, project link (events.js ~1079). It is a lossless hand-off, not a restart. Worth knowing
before touching it.

**B is absent from the Deadline side of the quick-add**, deliberately: that side creates a *task*,
which has its own drafting page and its own route to context/project. Leave that alone.

## 8.2 What the author ruled

1. **The calendar's `More options →` becomes `Advanced`.**
2. **It moves to the TOP of the controls**, not the bottom. Current order inside
   `.cal-create-controls` (events.js ~907–927) is: Time → Description → Recurrence (+ interval) →
   [habit bubble, conditional] → Tickler checkbox → **More options** (last). It should become first.
3. **Every other "Advanced options…" button becomes just `Advanced`.**
4. **Give them a grey fill so they stand out** (author: "try" — so this is a proposal to evaluate on
   screen, not a fixed value).
5. **There should be one on almost every drafting page**, with **Notes a likely exception**.

## 8.3 Building it

**Grey fill — reuse the app's existing grey, do not mint a new one.** `rgba(255,255,255,0.11)` is
already the app's neutral raised fill (`.review-notnow`, and the `2 min` chip's
`[data-target="quickdone"]`). One grey, already precedented, already checked against the wood
background. Applies to both `.screen-advanced-btn` and `.cal-advanced-btn`.

**⚑ Check the habit bubble when you move B to the top.** The CSS comment at styles.css ~1632 records
a deliberate hierarchy: the advanced button is *"deliberately quieter than the habit bubble beside
it — that one makes a suggestion about what you are building, this one just opens a door."*
Promoting it to first position **and** giving it a fill reverses that hierarchy. That may well be
fine — the author has now asked for it twice over (position and fill) — but look at the two together
on screen before calling it done, and say what you saw in the handoff.

**⚑ The ellipsis is doing work; dropping it has a cost.** `Advanced options…` ends in an ellipsis by
the usual convention that the control opens a dialog. `Advanced` does not signal that. And the two
controls being unified under one label **behave differently**: A opens a modal and returns you to
the page; B leaves the page entirely. The author's instruction stands — from the user's side both
mean "the simple form isn't enough, give me everything," and that is a defensible thing to name
identically. **But verify on screen that the calendar's `Advanced` does not read as "opens a
dialog,"** because it doesn't. If it does, the fix is B's arrow (`Advanced →`), which already
carries "you are going somewhere" — not reopening the label.

## 8.4 Coverage — what is actually missing

Checked every drafting page:

| page | has an Advanced button? | |
| --- | --- | --- |
| Next action | ✅ | |
| Waiting action | ✅ | |
| Habit | ✅ | |
| **Current project** | ❌ | **the gap** |
| **Future project** | ❌ | **the gap** |
| Notes | ❌ | the author's predicted exception — **confirmed**, leave it |
| Event page | ❌ | correct: this page *is* where B sends you. It is the advanced destination, not a page that needs its own door. |

So the author's expectation is right, and the gap is exactly **the two project pages**.

> ### ⚑ Q7 — BLOCKER for the project pages. Do not resolve this by inventing content.
>
> The Advanced dialog has exactly **two tabs**: *Bundling* (next/waiting) and *Extra cues* (habits).
> **There is nothing defined for a project.** Adding the button to Current/Future without deciding
> what goes inside opens an empty dialog.
>
> This is a **feature question, not a styling one**, and CLAUDE.md's standing rule applies — judgment
> calls inside a feature are the builder's, inventing a feature is not. **Ask the author what a
> project's Advanced dialog contains** before adding the button there.
>
> Everything else in §8 (rename, reposition, grey fill, on the three pages that already have one)
> is unblocked and can ship without this.

## 8.5 A third relative, for the author to rule on

**`Full page →`** (`review.fullPage`) sits in the review's inline quick-add forms and does the same
job as B — navigates to the full drafting page, carrying what has been typed. The author did not
mention it, and it does **not** say "Advanced options", so it is not literally in scope.

**Recommendation: leave it.** It lives inside the review, whose vocabulary is being standardised
separately under §5, and `Full page →` is doing a different piece of teaching there — it names the
destination rather than the depth. **Q8: confirm, or fold it into the `Advanced` family.**

## 8.6 Verification

- Each of next / waiting / habit: button reads `Advanced`, has the grey fill, still opens the
  Advanced dialog, dialog still returns to the page with the draft intact.
- Calendar, Event side: button reads `Advanced`, sits **first** in the controls, still carries
  name/description/date/time/recurrence/interval/tickler/project through to the event page.
- Calendar, Deadline side: **still has no such button** — that is correct, not a regression.
- Both languages: `advanced.button` and `cal.moreOptions` are separate i18n keys and both need the
  new label in EN **and** zh-Hans. `advanced.buttonDialog` is the *dialog's own title* and should
  stay "Advanced options" — do not shorten that one by accident.
- Draft isolation (CLAUDE.md): unchanged by any of this, but the standing verification procedure
  still applies to any drafting page you re-render — enumerate every control the page renders,
  mutate, ✕, confirm nothing persisted.

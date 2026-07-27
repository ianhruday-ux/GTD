# The review surface — planning document

**Status: nothing in §3–§6 is built.** This records the author's rulings from the review-surface
conversation (2026-07-27) and the survey work done alongside them, so a later session can build
without re-deriving any of it. Where it says **RULED**, the author decided it; where it says
**builder's call**, pick the simplest option and flag it in the handoff (CLAUDE.md).

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

## 5. Item B — the proposal, and where desktop and phone must differ

**RULED (author): the three-band structure is adopted.** Build to it. The two corrections the author
made when accepting it are recorded in §5a below and are binding.

**RULED (author): desktop and phone will probably need different interface choices here.** They
already do, and §1's capture card is the working template for how: **one DOM, one *shape*, two
arrangements via CSS.** The capture card proves the pattern — identical markup produces 3+3+2 on
phone and 6+2 on desktop with nothing but `order` and `flex-basis` overrides, and it reads as the
same card in both. Generalise that, do not invent a second mechanism.

### The shape every card should share

Proposed, **not ruled** — this is the part to bring back to the author before building:

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

Making the capture card's chip grid **band 1 of the same shape** — rather than a special case — is
the move that makes "standardised" true rather than cosmetic. Its bottom band is already the target
pattern.

### 5a. The correction the author made when adopting this (binding)

The claim above — that the capture card already *is* the three-band shape — **was overstated, and
the author caught it.** On the capture card, **Calendar and 2 min share row 2**, but they belong to
different bands: Calendar is the seventh sorting destination (band 1), while 2 min means "off the
list, I just did it" (band 2). So row 2 straddles a band boundary.

**What actually produces that row is wrapping arithmetic, not structure.** Seven sorting chips do
not divide into rows of six, so Calendar spills onto row 2 and 2 min follows it. On phone the same
thing happens with rows of three. The pairing is an accident that *looks* like grouping.

This does not sink the model, but it does mean the capture card needs one small change to stop
being a counter-example to the pattern it is supposed to demonstrate:

- **Adopt (recommended):** mark the band boundary inside row 2 with a **gap** — `Calendar` · gap ·
  `2 min` — reusing the exact device the row already uses to separate the three lane pairs (the
  20px `margin-right` on desktop). Costs no extra row, keeps the layout the author just approved,
  and makes the structure honest. Applies to both phone and desktop.
- **Rejected alternative, recorded so it is not re-proposed:** read 2 min as an *eighth destination*
  ("where does this go? nowhere — I did it"), making the capture card all band 1 with no band 2.
  Internally coherent, but it contradicts the existing styling ruling that 2 min is deliberately
  **uncoloured because it sorts nothing** (styles.css `[data-target="quickdone"]`, app.js ~6705).
  Taking this option would mean reopening that decision too.

**Do not let a band boundary fall silently inside a wrapped row anywhere else either.** Any band
whose controls wrap needs the boundary marked, or the grouping the bands exist to communicate is
invisible exactly where it matters most.

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
- **Q2. Does the three-band shape in §5 survive contact with the author's intent?** It is a
  proposal, inferred from the capture card. Confirm before building.
- **Q3. Does the past-due *pseudo-action* need its own info string,** or does `info.review.pastdue`
  (written for deadlines, which you can push) cover a card whose only options are tick and delete?
- **Q4. Should the info panel stay open across cards** (§3 trap), or close each time?
- **Q5. Where does the *desktop* review sit relative to the phone's?** §1 brought the capture card
  much closer to phone. Is "as close to the phone as the width allows" the standing rule for the
  whole surface, or does desktop get to use its width more aggressively (horizontal bands, §5)?
  These pull in opposite directions and the answer shapes §5.

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

**Label candidates** (author's call): `Skip` is shortest and matches the mental model, but breaks
the `I did it` / `Let it go` symmetry; `I didn't` keeps the symmetry and stays short but reads as
self-blame; `Didn't happen` is the most precise and still shorter than today's. Recommendation:
`Skip` (`跳过`), with the info text rewritten to explain the pairing rather than rely on it.

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

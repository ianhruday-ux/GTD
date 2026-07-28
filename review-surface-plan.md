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

**Status: §1 is BUILT and committed. Nothing in §3–§6 or §8–§10 is built.** This records the
author's rulings from the review-surface conversation (2026-07-27) and the survey work done
alongside them, so a later session can build without re-deriving any of it. Where it says **RULED**,
the author decided it; where it says **builder's call**, pick the simplest option and flag it in the
handoff (CLAUDE.md).

**Only §2–§7 are about the review.** §8 (the Advanced button), §9 (the habit bubble) and §10 (the
desktop calendar) are unrelated items noticed in the same conversation and parked here rather than
in documents of their own.

---

## 0. START HERE — handoff, build order, and what is still open

This document was written for a **fresh session that has none of the conversation behind it.** Every
factual claim in it was measured or read against the build, not remembered; where a claim was later
found wrong, the correction is inline and marked, and **the correction wins over anything earlier in
the document that contradicts it.**

### Read in this order

1. `CLAUDE.md` — in particular the golden rule, draft isolation, and the two-questions rule.
2. `spec.md` §4.8b for anything in §2–§7 here; §4.13–§4.16 for anything in §9–§10.
3. This document's §0, then only the section you are building.

### Suggested build order

Each row is independently shippable and independently revertable. Nothing forces this order except
the one dependency called out below.

| # | work | size | notes |
| --- | --- | --- | --- |
| 1 | **MUST FIX banner above** — zh-Hans `info.review.missed` | tiny | Independent of everything. Do it first; it is a live bug in shipped text. |
| 2 | §5 "Do this first" — the four convergence items | small | No design risk; shrinks what the §5 redesign has to cover. |
| 3 | §3 — scope the review's ⓘ to the revealed card | small | Self-contained. Watch the DOM-only panel-state trap. |
| 4 | §9 — the habit bubble's ✕ | small | Touches the same control stack as #6. |
| 5 | §6a — rename `Let it go` → `Skipped` (+ its info text, both languages) | small | Supersedes #1 if done together; **do not leave it half-done.** |
| 6 | **§10 — the two-column desktop calendar** | **large** | The biggest item, and the only one fixing a bug users hit today. **Carries §8's desktop half.** |
| 7 | §8 — Advanced reposition + contrast | small | Phone half is independent; **desktop half is part of #6 and must not be built separately.** |
| 8 | §5 + §5a — the three-band redesign of the four non-capture cards | medium | The most design-sensitive. Do it last, once #2 has cleared the noise. |

**The one hard dependency:** §8's desktop placement for `More options` is *"top of the left-hand
control column"* — a column that does not exist until §10 is built. Build §10 first, or build only
§8's phone half.

### Still open — ask the author, do not decide these alone

`Q1` (partly), `Q3`, `Q4`, `Q5`, `Q6` in §6; `Q8` in §8.5; the reserve-height call in §10.5.
**Resolved and closed:** Q2, Q7, Q9.

### What was already built and committed this round

§1 only: the desktop capture card's 6/2/2 layout with half-row spacing, and the removal of "Show
all". Both are in `dist/` and in `spec.md`. Everything else here is plan.

### ⚠ Testing gotcha — the service worker will show you a stale build

Chunk 9 shipped, so `dist/sw.js` is live and **cache-first: for page loads it returns the cached
`index.html` without asking the network** (src/sw.js, the `req.mode === "navigate"` branch). A hard
reload does **not** help — the worker intercepts that too. This cost real time in the round that
produced this document: a change was built, committed and verified in the file, and the author still
saw the old UI.

- **To see a fresh build reliably: use a private/incognito window,** where no worker is registered.
  Serving on a *different port* also works, since the origin includes the port.
- Automated checks are unaffected — Playwright contexts start clean — so **a screenshot from a
  check script and what the author sees in their browser can legitimately disagree.** If the author
  reports "I don't see it," verify the served bytes before you start debugging your own change.
- CLAUDE.md predicted exactly this when it scheduled the worker last. It is not a bug; it is the
  cost of having shipped it.

---

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

**⚑ AMENDED after the survey below was put to the author. The rename is WITHDRAWN.** Shown as
first-pass → final so the reasoning survives:

1. ~~The calendar's `More options →` becomes `Advanced`.~~ ~~Every other "Advanced options…" button
   becomes just `Advanced`.~~ **WITHDRAWN (author):** *"That's fair that the buttons name two
   separate things. Maybe the current label is fine."* Once it was clear that A opens a dialog and
   returns you while B leaves the page for good (§8.1), the shared label stopped being an
   improvement — the two names are carrying a real distinction. **Keep `Advanced options…` and
   `More options →` as they are.** Do not "finish the job" by renaming them later.
2. **STANDS — the calendar's button moves off the bottom of the controls.** Current order inside
   `.cal-create-controls` (events.js ~907–927) is: Time → Description → Recurrence (+ interval) →
   [habit bubble, conditional] → Tickler checkbox → **More options** (last).
   - **PHONE — RULED (author):** put it **to the right of the Event/Deadline toggle, above the Add
     button.** Note this is a different place from the original "top of the controls" instruction:
     the toggle sits above `.cal-create-controls`, so the button leaves the control stack entirely
     and pairs with the segmented control instead.
   - **DESKTOP — RULED via §10.4:** top of the **left-hand control column** in the two-column
     calendar. It has no separate existence from that layout; build it as part of §10.
   - **⚑ RULED (author): keep the row of space it vacates.** *"When you move the More options
     button, leave the extra row of space at the bottom of the page. The control panel should have a
     bit of a margin on both the phone and computer."* So this is **not** a pure move — the control
     panel keeps bottom breathing room on **both** platforms after the button leaves. Removing the
     button and letting the panel close up is the wrong outcome.
3. **STANDS — more contrast, on all of them.** The author's original wording was "a grey fill to
   make them stand out"; with the rename withdrawn, **contrast is the whole of the remaining visual
   ask.** Treat the grey fill as the proposed means, not the requirement — if something else reads
   better on the wood, use it and say so.
4. ~~There should be one on almost every drafting page.~~ **See §8.4 — resolved, no new buttons.**

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

> ### ✅ Q7 — RESOLVED. Do not add an Advanced button to the project pages.
>
> The question was: the Advanced dialog has exactly **two tabs** — *Bundling* (next/waiting) and
> *Extra cues* (habits) — and **nothing is defined for a project**, so adding the button there would
> open an empty dialog. Content would have to be invented, which CLAUDE.md forbids.
>
> **RULED (author): leave it. "I don't have any features I need to add to that right now."**
>
> So the button lives on exactly the three pages it lives on today (next / waiting / habit) plus the
> calendar's own door, and the ❌ rows in the table above are all **correct as they stand, not gaps
> to close.** Revisit only if a project ever grows a power feature that has nowhere else to go — the
> button follows the content, not the other way round.

## 8.5 A third relative, for the author to rule on

**`Full page →`** (`review.fullPage`) sits in the review's inline quick-add forms and does the same
job as B — navigates to the full drafting page, carrying what has been typed. The author did not
mention it, and it does **not** say "Advanced options", so it is not literally in scope.

**Recommendation: leave it.** It lives inside the review, whose vocabulary is being standardised
separately under §5, and `Full page →` is doing a different piece of teaching there — it names the
destination rather than the depth. **Q8: confirm, or fold it into the `Advanced` family.**

## 8.6 Verification

**Scope after the amendments: reposition + contrast only. No renames, no new buttons.** That makes
this a small, low-risk change — but the reposition touches a page whose control order was
deliberate, so verify rather than assume.

- Each of next / waiting / habit: label **unchanged** (`Advanced options…`), new contrast applied,
  still opens the Advanced dialog, dialog still returns to the page with the draft intact.
- Calendar, Event side: label **unchanged** (`More options →`), now sits **first** in the controls,
  still carries name/description/date/time/recurrence/interval/tickler/project through to the event
  page (events.js ~1079 — this is a lossless hand-off and must stay one).
- Calendar, Deadline side: **still has no such button** — correct, not a regression.
- Project pages: **still no button** — correct, not a regression (Q7).
- **No i18n changes are needed at all** now the rename is withdrawn. If you find yourself editing
  `advanced.button` or `cal.moreOptions`, you have gone beyond the ask.
- Draft isolation (CLAUDE.md): unchanged by any of this, but the standing verification procedure
  still applies to any drafting page you re-render — enumerate every control the page renders,
  mutate, ✕, confirm nothing persisted.
- **Re-check the habit bubble's prominence relative to the moved button** — see §9, which is about
  that bubble and interacts directly with this change.

---

# 9. The "Make this a habit instead" bubble — RESOLVED, ready to build

Raised by the author (2026-07-27): *"That's a useful feature that got hidden when we changed the
calendar. IIRC, when you selected repeat daily or weekly a little dismissible bubble would pop up
over the recurrence field asking if you want to make it a habit instead. It intervened during the
creation process. Currently, that bubble lives on the full page only, and you usually only see it
after you've created the event."*

**That premise turned out to be half-confirmed and half-contradicted by the build** — see §9.1. The
author has since ruled on the outcome (§9.2), so this section **is** buildable now; the findings are
kept because they explain why the build is a two-line change rather than a rebuild. Everything below
was produced by driving the real app, not by reading.

## 9.1 What the build does today (verified)

There are **two** instances of this control:

| # | where | condition | so… |
| --- | --- | --- | --- |
| 1 | **calendar quick-add** (events.js ~905) | `calRecur` is `daily` or `weekly` | **appears DURING creation** |
| 2 | **full event page** (events.js ~1133) | `!creating && recurrence` is daily/weekly | **edit-only — you see it only AFTER the event exists** |

Instance 2 matches the author's description exactly. **Instance 1 contradicts the "lives on the full
page only" half of it**: driven live at 1440px and 400px, with a name typed and recurrence set to
`daily` and then `weekly`, the bubble is **present and visible in the calendar quick-add at both
widths**, reading *"Recurring chore? Make this a habit instead →"*, sitting directly under the
recurrence row. At `none` and `monthly` it is correctly absent.

So the **function survived the calendar change. What did not survive is the FORM.**

## 9.2 The gap between memory and build — this is the real question

| author remembers | build has |
| --- | --- |
| a **bubble that pops up over** the recurrence field | an inline button in normal flow (`position: static`), *below* the recurrence row |
| **dismissible** | **no dismiss control of any kind** |
| **intervenes** in creation | sits as one row in a stack of six, easy to scroll straight past |

It is styled to be noticed — dashed purple border, purple tint, the only coloured thing in that
stack — but it is **a row in a list, not an interruption.** That is a plausible and complete
explanation for "it got hidden": nothing was removed, the *interrupt* was flattened into an option.

### ✅ Q9 — RESOLVED. Keep it inline; add an ✕.

**RULED (author): "just put an X on the end of it to dismiss it."**

So this is **not** a popover rebuild. The bubble stays where it is, in the flow under the recurrence
row, and gains a dismiss affordance on its trailing end. Everything in §9.3 below about floating
positioning and phone-keyboard overlap is therefore **moot** — kept only so nobody re-proposes the
popover. The draft-isolation and dismissal-scope items in §9.3 **still apply**, because they are
about the ✕, not about the form.

## 9.3 Building the ✕

**Applies to the ruled build:**

- **Draft isolation (CLAUDE.md).** `cal-make-habit` → `calMakeHabit()` converts what is being drafted
  into a habit. The ✕ adds a new piece of *drafting-page* state; **dismissal must not persist
  anything**, and ✕ on the calendar screen must discard it like every other control.
- **Where does "dismissed" live, and how long?** Per-draft — it comes back next time you pick daily
  — is almost certainly right and is the simplest. Anything longer needs a storage key and an answer
  for what Reset does to it. Flag whatever you choose.
- **Do not touch instance 2.** The event page's edit-only offer is correct as it is — the comment at
  events.js ~1131 explains why (`makeHabitFromEvent` needs a real event). The ✕ is for the calendar
  quick-add's copy.
- **The ✕ must not be mistaken for the bubble's own action.** The bubble is itself a button
  (`cal-make-habit`); putting a second control inside it means a tap near the right edge must
  dismiss, not convert. Precedent to copy: `.bundle-pill-wrap` (styles.css ~1106) already solves
  exactly this — a pill button with a separate clearing ✕ beside it, as two siblings rather than one
  nested inside the other. Use that shape.

**Moot under the ruling, kept only so the popover is not re-proposed:** floating/absolute
positioning over the recurrence field, and the phone-keyboard overlap that a popover would have
created there.

## 9.4 Interaction with §8 — ✅ resolved: there is no conflict

I raised a worry that §8 (louder `More options`, moved to the top) and §9 (a more prominent habit
bubble) were pushing against the recorded hierarchy from opposite ends. **The author dismissed it,
and the reason is the useful part — record it, it is the cleanest statement of what these two
controls are for:**

> **`More options` lets you put pseudo-actions in contexts and link events to projects.**
> **The habit bubble suggests the action might belong better in another lane.**
> *"I want both changes for different reasons."*

They are not competing for the same attention because they answer different questions — one is
*"this event needs fields this row can't give it"*, the other is *"this might not be an event at
all."* A user who needs one does not need the other. The styles.css ~1632 comment framing them as
loud-vs-quiet siblings was the wrong model; **do not preserve that hierarchy at the cost of either
change.**

Still worth one screenshot of the finished stack with recurrence set to `daily` in the handoff —
not to arbitrate a conflict, just to confirm the stack still reads well with both changes in.

---

# 10. The desktop calendar is broken — measurements and proposals

Author (2026-07-27): *"It appears that the calendar height never got fixed. Those calendar squares
are ridiculously tall. At the very least, the calendar should be able to fit on the page without
scrolling. We should also be able to take advantage of the bigger computer screen for a more
efficient layout for the controls."*

Confirmed, and it is worse than "tall cells." Measured by driving the real build.

## 10.1 Measurements

Month view, at four viewports:

| viewport | `.cal-body` needs | `.cal-body` gets | scrolls? |
| --- | --- | --- | --- |
| 1366 × 768 (common laptop) | 1073px | 644px | **yes — 429px over** |
| 1440 × 900 | 1073px | 776px | **yes** |
| 1920 × 1080 | 1073px | 956px | **yes** |
| 400 × 860 (phone) | 806px | 806px | **no — phone is fine** |

**The desktop calendar overflows at every size tested, including 1920 × 1080.** The phone does not.
This is a desktop-only defect.

Where the 1073px goes (measured at 1366 × 768):

```
   34px   .cal-monthnav
  669px   .cal-swipe-viewport   ← the month grid
  280px   .cal-create           ← name, kind toggle, time, description,
                                   recurrence, tickler, More options, Add
   ~90px  padding + gaps
```

**Cell size — the root cause:**

| | desktop | phone |
| --- | --- | --- |
| cell | **92 × 105 px** | 49 × 56 px |
| six rows | 539px of grid | 293px |

Desktop cells are ~2× the phone's in each dimension — **3.5× the area** — and they are empty.

**Why the previous fix did not work.** Capping the grid at 660px capped its *width*. But
`.cal-cell` carries `aspect-ratio: 1/1.15`, so **height still follows width**: 660/7 ≈ 92px wide
forces 105px tall, and six of those is 630px before gaps. The cap was applied to the wrong axis.
The grid is **height**-constrained on desktop and the cap only ever addressed width.

**And the width is simultaneously wasted:** the card is 900px, the grid is 660px — **240px of dead
horizontal space** — while the controls sit stacked vertically below the fold.

## 10.2 What this costs the user

At 1366 × 768 the month grid fills the entire card top to bottom, and **`.cal-create` is entirely
off-screen** — the name field, the Event/Deadline toggle, and the **Add button** are all below the
fold. You cannot add anything to the calendar without scrolling first, on the most common laptop
size there is. That is the real bug; the tall squares are how it happens.

## 10.3 Proposals — ✅ answered in §10.4; kept for the reasoning

Three, in the conversation. Whichever is chosen must also answer **where `More options` goes on
desktop** (§8.2), which is why the two questions were put together.

- **A — Two columns. ✅ CHOSEN.** Card widens (~1040px); the create panel becomes a column beside the
  grid instead of a stack beneath it; cells become wide rectangles rather than near-squares. Fixes
  height and width at once, matches how every desktop calendar looks, and gives `More options` an
  obvious home at the top of the control column. Biggest change. *(As offered, this said grid-left /
  controls-right; the author then reversed the columns — see §10.4, which is authoritative.)*
- **B — Minimal: size the cells from the available height.** Keep the single column; derive
  `--cal-cell-w` from a viewport-height budget rather than a fixed 660px width cap, so six rows
  always fit and the controls come back above the fold. Smallest change, closest to the phone —
  but leaves the 240px of dead width unused and makes the grid *smaller* than the screen allows.
- **C — Middle: wide-and-short cells, controls in a horizontal strip.** Single column still, but
  cells become wide rectangles (grid ~440px tall) and the create controls lay out **horizontally**
  across the card's full width in two rows instead of a vertical stack of six. Uses the width for
  both grid and controls without restructuring into columns.

**Whichever is chosen:** the phone must be left alone. It measures 806px into 806px and does not
scroll; every change here belongs in the ≥1000px block.

## 10.4 ⚑ RULED — Proposal A, with wide cells

**RULED (author): Proposal A — two columns. Cells become wide rectangles (~92 × 58), keeping the
full width and cutting the height.**

**⚑ COLUMN ORDER CORRECTED (author, after choosing A): the CONTROLS go on the LEFT and the calendar
on the RIGHT** — the reverse of the mockup that was chosen. The mockup showed grid-left; the ruling
is controls-left. Where the two disagree, **this line wins.**

This also settles the open half of §8.2: **`More options` goes at the top of the left-hand control
column on desktop.** Phone keeps its own answer (right of the Event/Deadline toggle, above Add).

### Target geometry

| | now | after |
| --- | --- | --- |
| calendar card width | 900px | ~1040px |
| cell | 92 × 105 | **92 × 58** |
| six rows of grid | 539px | **~363px** |
| `.cal-create` | 280px stacked *below* the grid | a **left** column *beside* it |
| worst case 1366 × 768 | **overflows by 429px** | must fit with room to spare |

Left column (controls) ≈ 340px, right column (calendar) ≈ 660px — the grid keeps its current width,
it was only ever the height that was wrong — plus the gap and the card's 26px side padding.

```
CARD ~1040px
┌──────────────────┬─────────────────────────────────────┐
│  Name…           │  ‹      July 2026            ›      │
│ ┌──────┬───────┐ │  Sun Mon Tue Wed Thu Fri Sat        │
│ │Event │Deadln │ │  ┌────┬────┬────┬────┬────┬────┬──┐ │
│ └──────┴───────┘ │  │    │    │  1 │  2 │  3 │  4 │5 │ │
│  More options →  │  ├────┼────┼────┼────┼────┼────┼──┤ │
│  🕐 --:--        │  │  6 │  7 │  8 │  9 │ 10 │ 11 │12│ │
│  Description…    │  ├────┼────┼────┼────┼────┼────┼──┤ │
│  🔄 Daily  ev 1  │  │ 13 │ 14 │ 15 │ 16 │ 17 │ 18 │19│ │
│ ┌──────────────┐ │  ├────┼────┼────┼────┼────┼────┼──┤ │
│ │Habit instead✕│ │  │ 20 │ 21 │ 22 │ 23 │ 24 │ 25 │26│ │
│ └──────────────┘ │  ├────┼────┼────┼────┼────┼────┼──┤ │
│  ☐ Hide until…   │  │ 27 │ 28 │ 29 │ 30 │ 31 │    │  │ │
│     [ Add ]      │  └────┴────┴────┴────┴────┴────┴──┘ │
│   ↑ keep bottom  │   wide cells, 92 × 58               │
│     margin       │                                     │
└──────────────────┴─────────────────────────────────────┘
```

### Build notes

- **Everything lives in the ≥1000px block.** The phone measures 806px into 806px and does not
  scroll; it is correct today and must not move. `--cal-cell-w`'s base definition stays as it is.
- **The aspect ratio is the actual fix.** `.cal-cell{ aspect-ratio:1/1.15 }` is what makes height
  follow width; the desktop override needs roughly `1/0.63`. Capping the width again will not work
  — that is what was tried before and it is why this is still broken.
- **`--cal-grid-h` hard-codes the old ratio** — `calc(6 * 1.15 * var(--cal-cell-w) + …)`. The `1.15`
  must change with the cell, or every consumer of that variable reserves the wrong height.
- **Day and List are fixed by the same work — see §10.5**, which measures them. Short version: both
  overflow today for the same reason, both need *both* halves of this change, and neither is a
  follow-up task.
- **`.cal-swipe-viewport{ max-width:660px; margin:0 auto }`** (desktop, styles.css ~2003) must become
  the **right** column instead of a centred 660px block. The viewport renders neighbouring months
  for the swipe transition — confirm the transform still lands correctly at the new width.
- **The Deadline side of the create panel is shorter than the Event side** (no recurrence, no
  tickler, no habit bubble, no More options). The **left** column must look deliberate in both
  states, not half-empty on one.
- **Keep the control panel's bottom margin** (§8.2, author) — that ruling applies to the **left**
  column's lower edge here, not just to the phone's stack.
- **Do not shrink the card below what the grid needs.** 1040px is a starting figure, not a measured
  one; measure the finished thing and adjust.

### Verification

Drive the real build at **1366 × 768** (the worst case, and the size that exposed this), plus
1440 × 900 and 1920 × 1080, and assert for each:

- `.cal-body` does **not** scroll (`scrollHeight <= clientHeight`);
- the **Add button is inside the viewport** without scrolling — this is the actual user-facing bug;
- Month, Day and List views all fit;
- phone at 400 × 860 is byte-for-byte unchanged in layout terms (cells still 49 × 56, still no
  scroll).

## 10.5 What this does to Day and List — measured

Author asked directly. Measured at 1366 × 768 with one event seeded on the selected day.

**Both are broken today, in exactly the same way, and by the same variable:**

| view | needs | has | scrolls? | the tall child |
| --- | --- | --- | --- | --- |
| Month | 1073px | 644px | **yes** | `.cal-swipe-viewport` 669px |
| **Day** | 1032px | 644px | **yes** | `.cal-agenda` **628px** |
| **List** | 1032px | 644px | **yes** | `.cal-agenda.cal-list` **628px** |

**`.cal-agenda` is 628px tall while containing ONE row.** All of that height is
`min-height: var(--cal-grid-h)` — the month grid's reserved height, applied so switching views
doesn't make the card jump (styles.css ~1466). So a day with one appointment reserves 628px of
empty space, purely to match a month grid that is itself 270px too tall.

### So the fix reaches them, but only half by itself

`--cal-grid-h` is derived from the cell, so shrinking the cell to 92 × 58 drops the reserve from
~628px to **~363px** automatically. Day and List inherit that with no extra work.

**That alone is not enough.** Run the numbers for Day after only the cell change:

```
  34px  .cal-daynav
 363px  .cal-agenda   (new reserve)
 280px  .cal-create   ← still in the vertical stack
  ~90px padding/gaps
 ─────
 767px  needed, against 644px available  → STILL SCROLLS
```

**It is moving `.cal-create` out of the vertical stack into its own column that fixes Day and
List** — the same move that fixes Month. After that, Day is ~34 + 363 + padding ≈ **440px**, and
fits comfortably.

**Conclusion for the builder: all three views are fixed by the same two changes, and neither change
alone is sufficient for Day/List.** Do not treat Day and List as a follow-up — they come along
automatically if both halves of §10.4 are built, and they stay broken if only the cell size is
touched.

### One judgment call left in this area

With the controls in a column of their own, `--cal-grid-h`'s reserve still does its job — it keeps
the calendar column a stable height across Month/Day/List so the card doesn't resize as you switch.
Keep it. But **363px of reserve for a one-row day is still mostly empty**, and now it is empty
*beside* a control column rather than above one. If it looks wrong once built, the fix is to reduce
the reserve rather than remove it — removing it reintroduces the jump it exists to prevent.
Builder's call; flag what you chose.

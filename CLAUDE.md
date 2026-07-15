# CLAUDE.md — standing instructions for every session in this repo

**GTD Console.** A GTD-inspired task manager: five lanes (Next Actions, Waiting On, Current
Projects, Future/Someday, Habits), with Notes and a Calendar arriving later in the sprint. Vanilla
JS, no framework. *(There is no points layer — it is deleted in chunk 0a; see `docs/spec.md` §2.)*
Source lives in `src/`, is stapled into a single self-contained `dist/index.html`, and runs
entirely in the browser on `localStorage`. **Local-first is not negotiable:** the app must be
fully functional with zero setup, zero server, zero account.

**We are in a one-month sprint** (see `docs/spec.md` §2). The goal is the best usable
productivity app in the time available, installable on the author's phone and shareable with a
handful of friends. Scope discipline matters more than completeness. Do not add features that
are not in the current chunk.

**There is no real user data yet, and there are no early testers.** Everything in localStorage is
test data; the author begins real use only once the base product is finished, and the testers are
programmers who receive the finished product at the same time. So: **schema migrations are
optional** — if a data-model change is cleaner without one, skip it and let Reset seed fresh data in
the new shape. Flag the choice; don't ask. This changes the day export/import (chunk 8) ships — see
`docs/spec.md` §1.

**Do not add a service worker before chunk 9.** It is scheduled last on purpose: caching during
active development means hours lost debugging stale builds. The web manifest (which makes the app
installable) is fine and ships in 0b.

**The date model changed (calendar round) and `docs/spec.md` §4.13 is the authority.** An **event is
a calendar entity that never lives in a lane**; **Waiting actions have no dates**; **recurrence is a
property of events only**. If any code, test, or older document implies otherwise, it is stale.

---

## ⛔ GOLDEN RULE — READ BEFORE TOUCHING ANY REPORTED PROBLEM ⛔

**When the human reports a problem where two systems interact unexpectedly, ASK "is this a bug
or a design error?" BEFORE ANY DEBUGGING BEGINS.** Not before writing the fix — before opening
the code, before diagnosing, before forming a theory of the fix. No exceptions.

Ask it plainly: *"Before I dig in — should these systems interact here at all? Is the fix to
make the interaction work correctly (technical), or should the interaction be impossible
(design)?"* Only after the human answers does diagnosis start.

**Why this is a golden rule and not an ordinary instruction:** a bug report triggers immediate
diagnostic momentum — reproduce, trace, patch — and an instruction sitting quietly in a list
gets skipped once that momentum starts. The interrupt has to fire *before* the momentum exists.
The classification cannot be inferred from the report: the reporter classifies under the same
uncertainty (the origin specimen below was filed as a bug, in good faith, and was wrong).

**Origin specimen.** "Pause a habit, then complete it, and advancing the day erases the
progress" was read as data loss and patched technically. The fix was coherent, tested end to
end, and wrong: the human's actual ruling was that pausing should *disable* completion entirely,
which made the verified fix dead code around a state the UI should never have allowed. One
question before debugging would have saved the round.

---

## Standing design rulings (bind every build)

**DRAFT ISOLATION.** Nothing on a create/edit page commits until Save (←); ✕ discards
*everything*. This applies to every control on every drafting page, present and future —
including controls that feel like switches (Pause), and including side effects on *other* items.
The lane behind an open page re-renders on **save**, never on an individual control.
- *Complete is draft-only on every page.* It **arms** ("✓ Completing on save"); tapping again
  disarms; Save archives. Habits toggle rather than archive, but are equally draft-only.
- *Convert is draft-only and mutually exclusive with Complete.* Arming one greys out the other.
- *The single deliberate exception is 🗑 Delete*, which acts immediately — saving a page whose
  subject you just deleted is incoherent.
- *The list checkbox and card controls are not drafting surfaces* and act immediately.
- **Verification procedure, run every round that touches a draft page:** (1) enumerate every
  control **the page renders** — not the ones you touched; (2) mutate state with each; (3) ✕
  out; (4) confirm nothing persisted. Then repeat with Save and confirm it does. "No control
  leaks" is a claim about *all* of them and can only be made by enumeration.

**ANSWER TWO QUESTIONS BEFORE ANY REDESIGN.** Whenever making fundamental changes to a basic
system — especially when the change is motivated by a clash between systems — stop and answer
in writing, in the conversation, before proposing mechanics:
1. **What is the purpose of this system?**
2. **What do I want the UI to teach the user about this system?**

Mechanics answer question 1. Defaults, affordances, and what the page invites answer question 2
— and question 2 is the one that slips. (Origin: the multi-hook redesign answered 1 thoroughly
and produced a page that *taught* users to accumulate cues, contradicting the cue→response model
habits are built on.)

**ASK FOR AN EXAMPLE BEFORE ARGUING.** When the human suggests something might be true and you
believe they're wrong, ask for a concrete example rather than assuming error. Disagreement is
more often two mental models talking past each other than one party being wrong. (Origin: a true
proof that didn't address the human's actual intuition cost a full round; one example did what
correct mathematics could not.)

**DATA DESTRUCTION IS POSSIBLE, NEVER ACCIDENTAL.** Every destructive action sits behind an
explicit confirm dialog (`openConfirmDialog`). Native `alert`/`confirm`/`prompt` are banned
app-wide — they fail silently in sandboxed contexts.

**WHERE THE SPEC IS SILENT, choose the simplest option and flag it** in your handoff summary.
Don't redesign. Don't invent answers to questions `docs/spec.md` §10 explicitly marks as open.

---

## Commands

```bash
python3 build.py              # staple src/ into dist/index.html
python3 build.py --watch      # rebuild on file change (optional convenience)
node --check dist/index.html  # syntax check — run before every handoff
python3 -m pytest tests/      # Playwright end-to-end suites (real Chromium)
```

`dist/index.html` is the product: one self-contained file, opened directly in a browser or
served from GitHub Pages. Never hand-edit it — it is generated. Edit `src/` and rebuild.

## Conventions

- **Storage keys** are prefixed `gtd_` (app data) or `gtddev_` (dev tools, must survive Reset).
  Every write goes through `src/storage.js` — never call `localStorage` directly from feature
  code. A schema version lives at `gtd_schema_version`. **Migrations are OPTIONAL until real use
  begins** (see above, and `docs/spec.md` §1) — from that day forward, every data-shape change ships
  with one. *(Corrected: this line used to require a migration for any data-shape change, flatly
  contradicting the paragraph three above it and the chunk 0a / chunk 3 rows in the spec.)*
- **No field labels.** Placeholder text inside empty boxes carries the teaching; tooltips carry
  the rest. Edit pages get no info button (the lane tabs and the intray do).
- **Validation** shows a dashed outline on the offending field, cleared on next input. No popups.
- **Every chunk ends by injecting a QA checklist into Next Actions** (`injectQAChecklist`,
  spec.md §8.1) — replace the previous chunk's content *and* its flag key; never accumulate.
- **Every chunk also refreshes the chunk map** — one Current Project per chunk, seeded with a
  plain-language description of what that chunk changes (`docs/spec.md` §8.2). Same
  replace-don't-accumulate discipline as the QA checklist, its own flag key, and it must survive
  Reset the same way.
- **Commit as you go**, with real messages. The repo is the safety net that makes autonomous
  work acceptable; a chunk that can't be reverted is a chunk that shouldn't have been written.
- **Flag every judgment call** in the handoff summary, inline, where the human can see it.

## Reading order for a build session

1. This file.
2. `docs/spec.md` §2 (what we're building and in what order) and the section for your chunk.
3. Only the `src/` modules your chunk touches.

`docs/changelog.md` is history — read it only if you need to know *why* something is the way it
is. Do not read it by default; it is long and it is not the spec.

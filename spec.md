# GTD Console — Specification

**This document is the memory.** A session starting here needs the repo, `CLAUDE.md`, and this
file — no chat history. Historical narrative lives in `changelog.md`; design principles for the
human–AI collaboration live in `principles.md` (companion doc, v2.3).

**Status:** `index-47` is the last single-file build. The repo restructure (chunk 0) converts it
to `src/` + `build.py` + `dist/index.html` without changing behavior.

**Last amended: the calendar design round.** The date model changed — **an event is now a calendar
entity, not a Waiting action with a date** (§4.13). That patch is merged here in full, together with
its knock-on edits, and the sprint is re-chunked (§2: old 7 + 8 merged into **7**; export/import is
**8**; the service worker is **9**). If any other document still says a Waiting action can hold a
date, or that recurrence lives on an action, **it is stale and this file wins.**

---

## 1. What this app is

A GTD-inspired task manager: five lanes (Next Actions, Waiting On, Current Projects,
Future/Someday, Habits), with Notes and a Calendar arriving later in the sprint. Ships as a single
self-contained HTML file — no server, no account, no build step for the *user*.
**There is no reward layer.** *(Struck this round: this sentence used to promise "a lightweight
reward layer" — the points substrate, **deleted in chunk 0a** (§2). It is the exact line a future
session would cite to resurrect it. There is no hook.)*

**Core principle: local-first.** The app is fully functional with zero setup, storing everything
in browser local storage. It must work offline, forever, with no external dependency.

**RULING (sprint decision): Google Tasks and Google Calendar integration are removed.**
Rationale, recorded so it isn't relitigated:
- Its own doc always ranked it peripheral. It was never a requirement.
- It was buying a large, permanent tax: every mutation function carried a dual local/Google path;
  every new feature needed a Google-mode ruling; the task data model was shaped by what the Tasks
  API could represent rather than by what the app needs.
- Three of the hardest known collisions were caused by it and vanish with it: the Contexts rework
  couldn't represent a shared context set in Google's `parent`-nesting substrate; restore was
  local-only and would have silently vanished on the next fetch; and Chunk B's "atomic" staging
  was atomic locally but best-effort against Google, with no reconciliation anywhere.
- **The freeing consequence:** cross-lane moves only regenerate task IDs because *Google Tasks
  can't move a task between lists*. Locally there is no such constraint. `moveItem` can move the
  object and keep its ID, which deletes `relinkConditionDependents` and the entire class of
  "patch every reference because the ID churned" logic. Condition chains survive promotion for
  free, and Contexts can survive promotion cheaply.
- The wrapper milestone would have forced either a substantial OAuth rework (Google blocks its
  sign-in inside embedded WebViews by policy) or a browser-only demotion anyway.

**Cost accepted:** there is now no cross-device sync. A phone install and a desktop install are
independent databases. Manual export/import (chunk 8) is the sprint answer; the adopted long-term
direction — auto-export plus a one-way mirror through the user's own cloud storage — is recorded in
§10 and is a wrapper feature.

**If the app proves useful,** sync, gamification, and native app-store distribution are the
natural post-sprint additions. Nothing here forecloses them; a future sync conversation should
start fresh from the backup format rather than inheriting the Tasks API's shape.

### RULING: there is no real user data yet, and won't be until the base product is done

Everything currently in localStorage is test data. **Nothing in the app is precious.** The author
will begin real daily use only once the base product is finished and **distributed — which is after
chunk 9** (the service worker that makes it reliably offline-capable and install-polished; note the
manifest that makes it *installable* already ships in 0b — chunk 9 adds the offline cache, not
installability). *(Corrected,
user, this round: earlier phrasings pegged this to "after the calendar, chunk 7." That was always a
floor, not the date; the actual switch-over is distribution, and distribution is after chunk 9. The
testers are experienced programmers who receive the finished product at that same distribution, not
a half-built one, so there is no early-tester data to protect before then either.)*

**Consequences for every session between now and then:**
- **Migrations are optional.** If a schema change is cleaner without one — the notes-marker
  retirement (chunk 0a), the Contexts registry (chunk 3) — **skip the migration and let Reset
  seed fresh data in the new shape.** Do not spend build time or add code complexity migrating
  data that doesn't matter. Flag it in the handoff so the decision is visible; don't ask.
- **Data-model changes are cheap right now and will never be this cheap again.** Make them now.
  This is the window for getting the shape right.
- **This window closes on a specific event:** the first day the app is used for real, which is
  **distribution, after chunk 9** (see the corrected timeline above). That day is late by design —
  the author will not switch over until the base product is finished and distributed, and **the
  testers are experienced programmers who receive the finished product at roughly the same time**,
  not a half-built one. So there is no early-tester data to protect either. From that day forward,
  every schema change carries a migration and every bug can destroy something irreplaceable.
  **Export/import (chunk 8) must exist before that day** — it is a hard prerequisite for
  distribution, and it precedes chunk 9, so this still holds. *(Softened this round: this line used
  to call chunk 8 "the last chunk before the app stops being disposable." With the switch-over moved
  to distribution, chunk 8 is no longer the **last** disposable chunk — chunk 9 is — but it remains a
  hard prerequisite. **⚑ Flagged consequence, not rewritten:** the chunk-8 row and §4.14a warn about
  work landing "on the far side of §1's migration boundary." Against the corrected timeline those
  warnings now fire *before* the real boundary — i.e. they are conservative, which is harmless. Left
  as-is deliberately; do not relax them on the strength of this correction.)*

---

## 2. The sprint: scope, sequence, and stretch goals

**One month. One month of Claude Pro.** The usage quota is shared between design conversations
and Claude Code build sessions, so *sessions* are the scarce resource, not enthusiasm. Sequence
accordingly; don't parallelize heavy design and heavy build in the same window.

**Definition of done for the sprint:** an app the author uses daily on their phone, installed to
the home screen, that a few friends can install from a link and try, with their data safe.

### Chunk order

**Resequenced (sprint planning round).** Two facts drove this: **there is no real data and there
will be no early testers** — the friends are experienced programmers who receive the *finished*
product at roughly the same time the author starts using it — and **the service worker is a
development hazard, not an early win.** Everything that was sequenced around a data-safety
deadline moved later; everything that removes friction from the next twenty sessions moved earlier.

| # | Chunk | Notes |
|---|-------|-------|
| **0a** | **Remove Google integration + delete the points layer** | First Claude Code session. Delete the API layer, both code paths in every mutation function, the connect/disconnect UI, the GSI script tag. Simplify `moveItem`/`changeKind` to **preserve task IDs** now that nothing forces delete-and-recreate; delete `relinkConditionDependents` if it becomes unnecessary. Retire the notes-marker encoding for plain fields. **Also delete the points layer outright** — see the ruling below: `gtd_points`, `state.points`, `awardPoints`, `loadPoints`, `savePoints`, the header counter, and every call site. *(Corrected this round: this list used to name `addPoints`, **which does not exist in the code** — a first-session grep for it finds nothing.)* **No migration needed** (§1). Harness must stay green *except* where a suite asserts a points value — those assertions are deleted with the feature, and that is the one permitted expectation change in this chunk. |
| **0b** | **Restructure + storage adapter + hosting + manifest** | The stapler: `src/` modules, `build.py` → `dist/index.html`. **Zero behavior change**, certified by the Playwright suites — if a test's *expectation* needs changing, the refactor exceeded its mandate. All `localStorage` access moves behind `src/storage.js` (with `QuotaExceededError` caught and surfaced — see §3). Turn on GitHub Pages. Ship a **web manifest + icons**: name **"GTD Console"**, theme color **`#171513`** (the desk), `display: standalone`, **portrait-locked** (single-column mobile layout — landscape would need design work there is no time for). **Do NOT add a service worker yet — see the sequencing note below.** **Also fold in a one-line leftover from 0a: the header still reads "Runs on its own" under the wordmark** — that sub-brand line was written to distinguish the app from the Google-tethered version; with the Google paths gone (0a), it describes nothing and reads as an orphaned tagline. Delete the `<span class="sub">` (or the line entirely) while touching the header markup for the stapler move. |
| **0c** | **Dev tools: snapshot & restore** (§12.3) | Cheap, and it pays for itself across every remaining chunk. One button to capture state before destructive testing, one to roll back. Do it *before* the heavy chunks, not after. |
| **1** | **Navigation stack** | Replace the single `state.returnScreen` slot with a real screen stack (§3, known issue 1). **In plain terms:** the app currently remembers *one* place to go back to, so any flow that goes two screens deep (lane → project → linked action → back) has nowhere to put the second breadcrumb and lands you in the wrong place. A stack remembers the whole path, so ← always means "back one screen." Small, and it unblocks **two** later chunks (5 and 6) that would otherwise each hack around the limitation independently. **⚑ Wording flagged (user, this round): the original one-line description was too terse to be understood by anyone not already holding `state.returnScreen` in their head** — the plain-terms sentence above is the fix; check the same failure mode in the other rows before the build sessions start. |
| **2** | **Main UI visual redesign** | §4.7b layout cleanup + §4.10b floating nav tabs. **Builds the deadline progress bar — §4.4b, §4.4c, and the two DEADLINE rows of §4.4d (assigned this round; §4.4 previously had no owner in this table and the bar has never existed in the code).** The two EVENT rows of §4.4d extend the same renderer in chunk 7 — so **the renderer must TAKE its window's origin, not assume the item's creation date** (§4.4d, §4.14c: an event's bar opens at its 4 AM appearance, and measuring it from creation puts it 98% full and red at birth). One parameter now; a rewrite in chunk 7 if it is hard-coded. Build with `env(safe-area-inset-*)` from day one. Implement the **freeze-tab-collapse-during-drag** ruling (§3, known issue 2). Comes before any new surface exists, so nothing gets built in the old visual language and reworked. **Build the new creation affordance (§4.3e — RULED):** delete the "+ New list" button, give the + badge a two-option pop-up menu (no menu on Habits), second option opens an inline naming row. On the action lanes that option still calls the existing group path — chunk 3 swaps the handler underneath it. |
| **3** | **Contexts rework + retire the old date model** | §4.3d. A `gtd_contexts` registry, **shared Next↔Waiting, and no second registry anywhere** — **RULED: the project lanes keep plain lists and Habits have no grouping at all** (§4.3d). Contexts are an action-lane feature; do not build a second registry for Current Projects. *(This is a statement about **registries**, not a ban on anything else touching the one registry: from chunk 7 the pseudo-action takes a context too, because it lives in the Next Actions lane — §4.3d, §4.14.)* Touches the same card/lane rendering chunk 2 just reworked. **No migration needed** (§1). Includes the **duplicate-title check on quick-add rows** (below). Creation UI already exists from chunk 2 — this chunk swaps *one handler*: *New context* stops creating a lane-local group and starts writing to the registry (§4.3e). Project-lane lists are **not** touched; they stay plain groups. **Also, and purely subtractive — retire the old date model (§4.13a):** delete the *date* option from a Waiting action's "waiting for", delete date-based auto-promotion, delete the **recurrence `<select>` from the deadline picker** on the Next / Waiting / Project pages, and delete the *"make this a habit?"* bubble that currently hangs off a **deadline's** recurrence (it returns in chunk 7, on the event page). **Why here and not in chunk 7:** §9's case table is chunk 5's build reference and it no longer contains the date rows — so the code must stop containing them *before* chunk 5, or the riskiest chunk on the board gets built against a spec that doesn't describe it. The app has no events at all between this chunk and chunk 7; that is correct and costs nothing (§1). **⚑ Judgment call — flagged, overrule if you'd rather carry the dead code to chunk 7.** **⭐ ALSO IN THIS CHUNK, three additions ruled this round (user):** (a) **contexts become cue targets in the habit hook picker** (§4.5, §4.3d, §11) — a habit can be cued by a context, distinct from *filing* a habit into one, which stays banned; (b) the picker copy stops saying "habit" and says **"cue"** (§4.5, §11), because the list now holds contexts as well as habits; (c) as part of retiring the date model, **a Next Action with a deadline set has its "Make Waiting" convert disabled** (greyed + tooltip, §4.13a) — a dated thing does not wait. All three land here because the contexts registry and the date-model retirement are both this chunk. **⚑ Flagged: (a)/(b) depend on the registry existing, so they cannot precede this chunk; (c) is the §4.13a enforcement.** |
| **4** | **Completed-items overhaul** | §12.2. Spec'd, self-contained, ready to build as written (minus its Google clauses). |
| **5** | **Chunk B — staged child actions** | §12.1. **Unblocked — the staged-edits-vs-timer question is RULED in §9.** Build to that ruling exactly; do not re-derive it, and mind the by-ID staged-delete trap. Riskiest chunk on the board: it moves the storage boundary for a whole class of edits. Better done with weeks of recovery time left than days. Depends on chunk 1. **Promotion has exactly ONE trigger — a completed condition** (chunk 3 deleted the other). Do not build staging support for date-based promotion; do not re-add the rows chunk 3 removed. **⭐ TWO additions ruled this round (user), both riding on this chunk's staging machinery:** (1) **creating a Current project requires at least one staged action** — the drafting page will not save an actionless Current project (§4.3, §12.1); staging is what makes the action and the project land atomically. **Scoped deliberately:** drafting page only, **Current only** (Future projects hold no actions), and the **calendar creation row is exempt** (§4.15a still creates a dateless, actionless project by design). The review's stalled-project kind is **retained** — a project can still be stranded later (§4.8b). (2) **a linked action opened *as a child of the project page* cannot be un-linked from it** — the project-link field is locked (disabled + tooltip); the same action opened from its lane stays freely unlinkable (§12.1). |
| **6** | **Tray drawer + Notes + header + settings surface** | §4.8a (**the capture drawer — a left drawer, not a full-screen tray**), §4.9, §4.10, §4.3c. **The review (§4.8b) is NOT in this chunk** — see 6b. Depends on chunk 1. **The settings surface arrives here** — it owns **Clear all app data** (today's Reset) and, from chunk 8, **Export/Import**. **The Completed trash can does NOT move into it (RULED, user, this round):** it is lane-scoped — *clear **this lane's** archive* — and it stays in the Completed section header where chunk 4 puts it (§4.12b). Two destructive controls, two scopes, one never-accidental ruling — and it is satisfied **inside the sprint**, not hung on the wrapper stretch goal. |
| **6b** | **The review (open loops)** | §4.8b. Split out of chunk 6 on purpose — daily review is the highest design-surface part of GTD, and chunk 6 is already full. Derived queue over four open-loop types, redaction-as-state, decision menus, session-scoped "Not now", empty-vs-N-deferred end states. **Depends on chunk 1** (returns to the review after a tap-through). **Mind the fence at the end of §4.8b** — this is where scope dies. **⚠ RESEQUENCED THIS ROUND — 6b now builds ALL FOUR kinds.** The previous ruling deferred the past-due kind to chunk 7 because it was "only a pseudo-action"; **that premise died when past-due deadlines became open loops (§4.8b, user ruling this round)** — and deadlines exist today. So 6b builds **four open-loop kinds** (past-due in its **deadline** shape — the *push the date / complete / delete / Not now* menu — plus stalled projects, orphaned waitings, and captures) and **five** sort chips. **Chunk 7 extends the past-due kind to its second shape** (the pseudo-action, which gets a checkbox, not the menu), adds the sixth chip, and the "it moved" banner (§4.15e). Build the past-due kind so a second **shape** slots in — do not hard-code the deadline case. **⭐ ALSO IN THIS CHUNK (user, this round): explicit teaching in the review.** A prominent **info button** (extending the §4.8a exception to the no-help-on-pages rule) explains the options visible while sorting — the capture sort chips and the decision menus. It reuses the tab info text where it fits (the chips map to lanes; reuse `LANE_INFO`) and needs fresh copy for the decision menus. **Single info-button pattern, not an onboarding overlay** — the redaction discipline and the §4.8b fence still hold (§4.8b). |
| **7** | **Calendar + events + recurrence + seeded sample habits** | **MERGED (was 7 + 8) — calendar planning round.** Under the new model recurrence is *calendar machinery*: it operates on events, and events do not exist until the calendar does, so a standalone recurrence chunk scheduled first would have nothing to operate on. Contents: the calendar (month/day, marks, creation row) · events/appointments as an entity with their own store · the **pseudo-action** (§4.14) · recurrence (roll-forward, projection, skip / delete-series, pause) · completed-series collapse · **`seriesId`** (now internal to this chunk, not a cross-chunk dependency) · **the pseudo-action SHAPE of the review's past-due kind** (the checkbox variant — 6b already built the kind, in its deadline shape) + the Calendar chip · **the two EVENT rows of §4.4d** (the appointment window, §4.14c; the untimed event's born-full bar), extending the renderer chunk 2 built · seeded sample habits (§4.16). §4.13–§4.15. **⭐ TWO small additions ruled this round (user):** (a) **the project health / stalled computation now counts linked events and appointments as forward motion** (§4.3b, §4.8b) — a project whose plan is "act after the conference on the 14th" is **not** stalled and must not be nagged or offered Someday; a directly-linked waiting action already counts today, events are the gap this closes. (b) **the event page exposes no "Make Waiting" affordance** — this is an *absence*, not a disable (the event page is not built from the action-page template), and it satisfies the pseudo-action half of §4.13a's dated-things-don't-wait rule (§4.14). **⚠ ONE-LINE REQUIREMENT WITH A LONG SHADOW: the pseudo-action's task ID is minted WHEN THE EVENT IS CREATED, not when the row first appears at 4 AM (§4.14a).** The ID's home is the event record. This costs nothing here — §4.14a already requires the ID to be *stable* across every roll, and allocating it at creation is the simplest way to make it so — but getting it wrong makes **chunk 8's advance-conditioning cheap and re-allocates every condition reference in the app**, at exactly the moment migrations stop being optional (§1). Mint at creation. **Unambiguously the largest chunk on the board** — it already was; the merge is honest about it. **Core, not stretch:** it is a **floor** for real use — the author will not switch over before it ships. But it is not *the* switch-over point: per §1 (corrected round 2) real daily use begins at **distribution, after chunk 9**, and export/import (chunk 8) is the hard prerequisite that must precede it. *(Stated as a floor, not a start date: the calendar is necessary for real use but not sufficient — §1 pegs the first real day to distribution after chunk 9, and chunk 8 lands before it.)* Everything it depends on is settled. |
| **8** | **Export / import** | *(was 9.)* Late now that there is no data to protect and no early testers. Lands in the settings surface from chunk 6. **The backup must serialize events and series too** — they are a new top-level entity as of chunk 7, and the export format is where new entities get silently forgotten. **Import REPLACES, it does not merge** — behind a confirm reading "This will replace everything currently in the app." Merge is a conflict engine in disguise (§10); replace makes the file an honest snapshot. Foundation for the sync design (§10). **⚠ ALSO IN THIS CHUNK, and thematically it does not belong here — it is here because it is cheap and this is the only chunk with room (user ruling, this round): CONDITIONING A WAITING ACTION ON A NOT-YET-LIVE EVENT** (§10 — re-costed this round from five subsystems down to two). **Two pieces only:** (1) the condition picker gains a section for **pending events**, filtered to live occurrences only; (2) **condition resolution stops treating a pending pseudo-action as an orphan** — today a lookup searches live lanes only, so a hook to Tuesday's event would wear the dashed orphan pill until Tuesday 4 AM. That is the one place that has to learn `gtd_events` exists. **Everything else is free *only if chunk 7 minted the ID at event creation*** — if it did not, stop and fix that first; do not re-allocate IDs here, in the chunk that ships the export format, on the far side of §1's migration boundary. **Order within the chunk: build the feature first, then the serializer** — a serializer written against a data model that changes underneath it in the same session is exactly how the export format silently forgets an entity. **⭐ ALSO IN THIS CHUNK (user, this round), riding on the same event-conditioning work:** (1) **waiting actions appear as dependents in the project's linked list** (§4.15d) — a waiting action hooked to a project-linked item shows nested beneath it, even when its only tie to the project is the dependency. (2) **Recurrence × condition orphan rulings (§4.15b):** *delete-series* orphans the dependent (target gone); *skip-this-one* does **not** (same task ID, the dependent re-targets the next occurrence — §4.14a); *pause* shows the dependent orphaned as a **reversible render-time state** that clears on unpause (a few lines in the resolver you are already touching — **⚑ optional/flagged**, take it or leave it). (3) **Deferred, not built: the uncompleted-bump orphan** (a dependent whose occurrence passed uncompleted before being bumped) — see §10; it costs a return to per-dependent occurrence-binding and may be redundant with the missed occurrence's own review surfacing, so it is an **open question to revisit during real use (post-chunk-9)**, not scope here. |
| **9** | **Service worker + offline + install polish** | *(was 10.)* **Deliberately last.** The app has stopped changing, so caching becomes a feature instead of a debugging tax. |
| — | **Stretch: native wrappers** | Android → Windows/Linux → macOS. iPhone never. See below. |

**Sequencing rules that matter more than the order itself:**

- **The service worker goes last, and this is not negotiable.** A service worker caches
  aggressively; during active development that means hours lost debugging a stale build you
  already fixed. Every "why am I still seeing the old version" bug in a PWA traces back to
  shipping the cache too early. The manifest (which makes the app installable) is safe and ships
  in 0b; the cache is the part that bites.
- **Install to the phone in chunk 0b and stay there.** A home-screen PWA launches in standalone
  mode, which changes the layout viewport and exposes notch and gesture-bar insets. You want to be
  looking at *that* while building the visual redesign, not at a browser tab. This app is
  mobile-first, and every hard bug in its history — URL-bar resize, long-press selection, the
  jumping Complete badge — was a mobile bug found late.
- **Design conversations happen at least one chunk ahead of the build that needs them.** The only
  one currently outstanding is the timer ruling blocking chunk 5.
- **Formally parked for the sprint** (the "if people find this useful" pile): gamification
  (the adventurer/Six Paths concept stays at concept level — no mechanics, no code), Google sync of
  any kind, cloud sync (§10), habit classification and per-class animations,
  relative-to-completion recurrence, the project-planning Blackboard, and the full 4.11b
  ghost-runner animation (the built dot-track approximation stands).

### RULING — the points layer is DELETED (user, this round)

**Points are removed from the app entirely, in chunk 0a.** `gtd_points`, `state.points`,
`awardPoints`, `loadPoints`, `savePoints`, the header counter, and every call site go. Nothing
replaces them. *(Symbol names corrected this round — there is no `addPoints` in the code.)*

**Why:** points were never a feature in their own right — they were the **substrate for the parked
gamification layer** (the adventurer / Six Paths concept), and that layer is not being built in this
sprint and may never be. What is left without it is a number that goes up, attached to nothing,
teaching nothing. **A scoreboard for a game nobody is playing is not a lightweight feature; it is a
promise the app does not keep.**

- **It is deleted, not hidden.** A dormant counter still writes on every completion, still has to be
  exported (chunk 8), still has to survive Reset, still shows up in every audit of "what does
  completing a thing do." Carrying dead infrastructure is exactly what chunk 0a exists to stop.
- **This is not a decision against gamification.** If gamification is ever built, it starts from the
  design conversation, not from a leftover integer — and §4.8b already records where the interesting
  mechanic would live (repeated deferral), which is *not* a completion counter. **A future session
  must not resurrect points on the grounds that "the hook was already there."** There is no hook.
- **Nothing else depends on it.** Points are already ruled out of the archive (§4.12b: gamification
  never couples to the Completed archive) and out of the Chunk B staging boundary (§12.1). The
  deletion is genuinely local: completion side-effects lose one line.
- **Consequence for the pseudo-action (§4.14):** the question "does completing a pseudo-action award
  points?" is **void**. Completing anything awards nothing.

### Stretch goal: native app wrappers

**The author is committed to attempting this and accepts it may not land.** Targets, in priority
order:

1. **Android app** — the primary want. Capacitor wraps `dist/` in a native WebView. Also the
   permanent fix for the DuckDuckGo long-press text-selection conflict (§3), which a page cannot
   fully control from inside a browser it doesn't own but an owned WebView settles in one line
   (`onCreateActionMode` / `onActionModeStarted` no-op).
2. **Desktop app (Windows/Linux)** — Electron. Ships Chromium, so the entire Playwright test
   history keeps meaning what it says.
3. **macOS desktop** — nice to have, lower commitment. Same Electron build; the cost is Apple's
   Gatekeeper (Developer ID + notarization, or every launch shows a malware warning).
4. **iPhone — explicitly abandoned.** Not attempted. The App Store cost is disproportionate.

**Wrapper prerequisites, and why three of them are pulled forward into the sprint** — these
reach backward into chunks you're building anyway, so paying them now means the wrapper is
assembly rather than rework:
- **Export/import (chunk 8)** — a wrapper's WebView is a different origin with *empty*
  localStorage. Without a backup file, the wrapper milestone begins by losing every run history
  and personal best. *(It is no longer "pulled forward" — the resequence moved it to the end. It is
  still a hard prerequisite for the wrapper; it just isn't early anymore, so a wrapper attempt
  cannot begin before chunk 8 lands.)*
- **Storage adapter (chunk 0b)** — native durable storage is async; the app assumes synchronous
  persistence everywhere. Adapter now = configuration later instead of surgery.
- **Safe-area-aware fixed chrome (chunk 2)** — free if done at build time, painful to retrofit.

**Wrapper work that cannot be pulled forward, and must be budgeted honestly if attempted:**
boundary sweeps must move from boot-only to also firing on resume (`visibilitychange`) — an
installed app stays resident for days, and a phone opened at 9am after being suspended overnight
must still process the 4am boundary; the Android hardware/gesture **back** action must map onto
the screen stack (**RULED in §4.6 — BACK = CANCEL (✕), never Save**, with the resolution order
dialog → drawer → page → exit; this line used to pose it as an open question and was stale); on-screen
keyboard resize will fight the floating Complete badge the same way the URL bar did; and fonts must
be vendored locally (currently loaded from Google Fonts — a CDN dependency that breaks the
offline promise).

*(Struck this round: "destructive controls must relocate into the settings surface **the wrapper
introduces**." **The settings surface is chunk 6**, not a wrapper feature — the resequence moved it
into the sprint and this line was never updated. Nothing here waits on the wrapper.)*

**Distribution is a fork, not a detail.** Personal sideloading (an APK you install yourself,
an unsigned desktop build) is nearly free. Play Store + Gatekeeper + auto-update is recurring
overhead. Decide which one is the goal *before* choosing tooling. For the sprint, sideloading
and the PWA link are enough.

**The wrapper also unlocks cloud-file sync** (§10) — the only route to phone↔desktop sync without
running a server, and impossible in the browser build, where a page cannot silently write a file.
Not a sprint item; recorded here because it is the strongest *post-sprint* argument for doing the
wrapper at all, stronger than the long-press fix or the app icon.

---

## 3. Architecture & technical notes

- **Source:** `src/*.js` + `src/styles.css`, stapled by `build.py` into `dist/index.html`.
  Vanilla JS, one IIFE, no framework, no npm.
- **Storage:** `localStorage`, keys prefixed `gtd_` (`gtd_tasks_next`,
  `gtd_habit_done`, `gtd_habit_runs`, `gtd_completed_*`, `gtd_archived_waiting`,
  `gtd_collapsed:*`, `gtd_contexts`, `gtd_tags`, `gtd_schema_version`). Dev-tool keys use `gtddev_`
  so they survive Reset. **All access goes through `src/storage.js`.**
- **Events are NOT tasks and do not live in a lane** (§4.13, chunk 7). They get their own store,
  **`gtd_events`** — one row per event or series, holding title, description, date, optional time,
  `recurrence`, `seriesId`, `paused`, `linkedProjectId`, `parent` (context, inert until it is a
  pseudo-action). Completed occurrences archive to **`gtd_completed_events`**, keyed by `seriesId`
  so the collapse ("Pay rent ×6") has something to group on. **The pseudo-action (§4.14a) is a
  separate, real row in `gtd_tasks_next` holding `eventId`** — it is the *view*, `gtd_events` is
  the *record*. Stated because the obvious shortcut — "just put events in the Waiting lane" — is
  the model this design deleted.
- **⚠ Consumers of `state.tasks.next` must tolerate a row that is not an action.** From chunk 7 the
  Next lane contains pseudo-actions. Audit, by enumeration, every reader: the Tidy sort, the
  duplicate-title check, the condition picker, the project-link picker, the QA checklist injector
  (§8.1), the completed archive, and export (chunk 8).
- **Data model:** plain objects, stored as JSON. With Google gone, the HTML-comment marker
  encoding (`<!--gtdlink:…-->`, `gtdcond`, `gtddeadline`, `gtdhook`, `gtdwhen`, `gtdbundle`,
  `gtdgroup`) exists **only** to serialize into a `notes` string — a shape inherited from the
  Tasks API. **Chunk 0a should retire it** in favor of plain fields on the task object. **No
  migration** — §1 rules it out by name (no real data; Reset seeds fresh in the new shape), and the
  chunk 0a row says so too. *(Struck this round: "with a one-time migration reading old markers,"
  written before the no-real-data ruling. §3 is on chunk 0a's reading list, so this line was pointing
  the very first build session at work §1 had already cancelled.)* This deletes a whole class of
  regex fragility and is the natural moment to do it, since nothing external reads those markers any
  more.
- **Contexts** (formerly "mini-lists"): currently lane-local group tasks using a `parent` field.
  Chunk 3 replaces this with a shared registry — see §4.3d.
- **State object** (`state`): `tasks` per lane, `completed` per lane, `activeKind`,
  `collapsed`, `habitDone`, `habitDoneOrder`, `habitRuns`, `events` (chunk 7), `audioCtx`,
  `screen` (current full-screen overlay), `returnScreen`, `qaTimeOffset` (dev only — **hour/minute
  granular**, see §12.3; the old day-granular `qaDayOffset` cannot test §4.14b).
- **Rendering:** no virtual DOM — mutation functions rebuild the relevant DOM subtree via
  `innerHTML`. Screen overlays carry a `data-screen-key` so same-key re-renders swap inner HTML
  in place (preserving scroll, avoiding a replayed slide-in transition).
- **Day boundary:** a single app-wide **4:00 AM** boundary (`boundaryNow()` backs `todayStr()`).
  Habits, events, deadlines — one clock, one rule. `processHabitBoundaries()` runs at boot and
  finalizes every elapsed scheduled day.
- **Cross-lane moves:** `moveItem()` / `changeKind()`. **Post-Google, these must preserve task
  IDs** (see §1). Until that lands, they delete-and-recreate and `relinkConditionDependents()`
  patches dependent conditions to survive the churn.
- **Touch:** press-and-hold (~400ms) starts a drag (HTML5 `draggable` has no touch equivalent);
  live-snap reordering via `document.elementFromPoint`; edge-held auto-scroll with a speed ramp;
  a 4-second idle watchdog self-heals a stuck drag.
- **Dev QA checklist injector:** every chunk build injects a one-time manual-test checklist into
  Next Actions — see §8.1.

### Known issues and collisions to design around

These were identified in a collision audit and are **not yet fixed**. Read the relevant one
before building the chunk it touches.

1. **`state.returnScreen` is a single slot** (blocks chunks 5, 6 and 6b). The child-screen return flow
   stashes exactly one screen. The intray sorts an item → opens a project page → whose quick-add
   ✎ opens a child page: two levels. Chunk B's staging adds per-frame draft state on top. **Design
   a real navigation stack once,** before chunk 5 and Chunk B each hack around the single slot
   independently.
2. **Fixed chrome × drag auto-scroll** (chunk 2). The collapsing tab bar is scroll-triggered;
   drag auto-scroll deliberately scrolls the page while a finger is held at the edge. So a drag
   near the top will expand the tab bar, changing reserved content space, shifting every element
   under the finger mid-drag. **Ruling to implement:** the tab bar's collapse state **freezes
   while a drag is active.** Related: §4.7b removes the card backgrounds that currently make drop
   targets legible — consider a drag-time-only insertion indicator.
3. **Recurrence needs a series identity that doesn't exist** (chunk 7). Collapse-into-one-entry
   ("Pay rent ×6") and the delete-series prompt require knowing which archived completions belong
   to one series. **Shrunk by the new model (§4.15b): there is no spawning**, so `seriesId` no
   longer has to survive across a chain of new task IDs — it is a field on **one** event and on its
   archive entries, internal to chunk 7. It is still required; it is no longer a cross-chunk
   dependency.
4. **Unbounded growth × localStorage's ~5MB ceiling.** Three stores grow forever by ruling:
   completed archives (keep-everything retention), habit run histories, archived Waiting sets.
   Every `setItem` in the app is currently **uncaught** — a `QuotaExceededError` mid-save would
   throw partway through a multi-store commit, leaving state half-persisted with no user-visible
   error. `src/storage.js` must catch and surface this. Note also that `habitLapNumber` counts
   every "miss" ever written, so any future pruning of run history would silently corrupt lap
   numbers.
5. **DuckDuckGo/Android long-press text selection** (deferred to the wrapper). A sustained
   press-and-hold can trigger the browser's native selection UI, racing the app's long-press
   drag detection; when the browser wins, the element can stick in a dimmed mid-drag state. CSS
   and JS mitigations were tried and none reliably suppress it — and broadening `user-select:none`
   app-wide made it *worse*. Title-scoped selection blocking + the idle watchdog stand as the
   accepted mitigation. Testing happens on Chrome for Android. Fixed properly by the Android
   wrapper.
6. **Boundary sweep is boot-only** (wrapper). Fine for browser tabs, wrong for an installed app.
   Must also fire on resume.

---

## 4. Feature spec

**Scope:** Next Actions, Waiting Actions, Current Projects, Future/Someday Projects, Habits.
Applies to both creation and editing. Full-screen navigation (a distinct screen you navigate
into and back out of), not inline editors.

### 4.1 Field matrix

| Field | Next Action | Waiting Action | Current/Future Project | Habit | Event / Appointment |
|---|---|---|---|---|---|
| Title | ✅ | ✅ | ✅ | ✅ | ✅ |
| Description (free text) | ✅ | ✅ | ✅ | ✅ *(identity placeholder — see 4.5)* | ✅ |
| Link to Project | ✅ | ✅ | — | — | ✅ *(from the event page only — 4.15d)* |
| Condition link (→ Next Action *or* Waiting) | 🚫 not offered *(the greyed icon was removed — see 4.2)* | ✅ | — | — | ❌ |
| "When?" / hook-to-habit cue | — | — | — | ✅ | — |
| **Deadline** | ✅ | ❌ *(4.13a — waiting actions have no dates)* | ✅ *(Current only)* | ❌ | ❌ |
| **Time (optional)** | ✅ *(4.4, 4.4d)* | — | ✅ *(Current only — 4.4, 4.4d)* | — | ✅ *(supplying it is what makes it an appointment — 4.13)* |
| **Recurrence** | ❌ *(4.13 — deadlines do not recur)* | ❌ | ❌ | ❌ | ✅ *(4.15b)* |
| Progress bar + passed chip | ✅ *(4.4b/c/d)* | — | ✅ *(4.4b/c/d)* | — | ✅ *(**every** event, timed or not — 4.4d; appointments run on a different origin — 4.14c)* |
| "+ Next Action" / "+ Waiting Action" quick-add | — | — | ✅ | — | — |
| No-linked-actions indicator | — | — | ✅ *(Current only)* | — | — |
| Context | ✅ | ✅ | ❌ *(4.3d — the project lanes keep **plain lists**, not contexts)* | ❌ *(4.3d)* | ✅ *(edit-only, and inert until it is a pseudo-action — 4.15a)* |

*Notes (chunk 6, §4.9) are deliberately outside this matrix: title (required) + body (optional) +
**many** project links. The many-link is the only one in the app — build it on the `hooks[]`
pattern, not the single-select project-link pattern.*

### 4.2 Waiting-action conditions

- A Waiting action can link to a **Next Action or another Waiting action** as its condition,
  using the hook-picker UI pattern (a dedicated list of valid targets, not a dropdown).
- **Promotion rule:** a Waiting action auto-moves to Next Actions **only when a condition that
  lives in the Next Actions lane gets completed.** ⚠ **The qualifier is the LANE, not the type —
  which means a pseudo-action qualifies** (§4.14: an event on its day is a row in `gtd_tasks_next`
  that "does not become an action"). Written this way deliberately: a literal `type === 'next'` check
  would silently refuse to promote anything hooked to an event, and §10's "the cheap half of
  event-conditioning already works, **free**" — the entire justification for the stable-ID ruling in
  §4.14a — would quietly be untrue. A Waiting condition being *promoted* does not promote its
  dependents. Chains resolve one promotion at a time as conditions reach the Next lane and get done.
- **The condition picker's valid targets follow the same rule:** everything in the Next Actions lane
  (**pseudo-actions included**, while live) and every other Waiting action. See §3's enumeration of
  `state.tasks.next` consumers — the picker is on it.
- **Branching is allowed** (unlike habit hooks): several Waiting items may share one condition.
- **A Waiting action can hold both a Project link and a Condition link** — different questions.
- **Next Actions cannot have conditions.** *(Amended — user round, chunk 2: the condition icon is
  no longer shown on the Next Action page.* It used to appear greyed there as a teaching affordance —
  "a next action waiting on something else is, by definition, a waiting action" — but in practice it
  read as a broken control, not a lesson, so it was **deleted**. The rule stands; only the greyed
  icon is gone. The show-but-disable teaching pattern itself still lives on elsewhere — see §4.13a's
  disabled "Make Waiting" and §12.1's locked project-link field.)*
- **Layout:** once hooked, the condition pill displays **immediately under the title** — second
  only to the title in importance. The when-row is where it gets *set*.
- **Required at creation:** a Waiting action cannot exist without specifying what it's waiting
  for — **free text or a hooked action. That is the whole list.**
- **A DATE IS NOT AN OPTION (§4.13a).** A date is not a way of waiting for something; it is a thing
  that happens, and things that happen are born in the calendar. *(Deleted this round, along with
  date-based auto-promotion. The code carries it until chunk 3 removes it.)*
- **Mutual exclusivity:** text + hook **do not** coexist (the hook target's title is already the
  label) — setting one greys the other. With dates gone, that is the only exclusivity rule left.
- **Promotion has exactly one trigger: a completed condition.** No date, anywhere, promotes
  anything (§9's case table lost its two date rows for this reason).

### 4.3 Projects ↔ actions

- **Two ways to create an action, same result:** create it in the Next/Waiting lane and link it
  to a project, or create it from the project's page, pre-linked.
- **No auto-generated project lists.** Removed — it conflated project-grouping with the list
  mechanism, which contradicts Contexts (4.3d). The project-link pill on each card and the
  project's own linked-actions list already surface the relationship.
- **A project's linked actions do not appear in the Projects lane**; they appear on the project's
  own page, as a tappable list, with Waiting items conditioned on another item in the list
  indented beneath it (recursive for chains).
- **Creating from the project page:** quick-add rows ("Next action…", "Waiting action…").
  - **Next action row:** Enter/+ creates instantly, pre-linked, box clears. ✎ opens the full drafting
    page with the typed text carried over.
  - **Waiting action row (REVISED — see §12.1b):** the "+" is a **hook**, greyed until text is typed.
    Then either tap **✎** for the drafting page, or tap the **hook** and pick a condition target —
    which creates the Waiting action immediately. **The rule: the quick-add row can create a Waiting
    action if and only if the trigger is a hook, because the hook is the only trigger that is a single
    tap.** Dates and qualitative text need the drafting page. *(This replaces the old behaviour, where
    "+" opened the drafting page anyway because a trigger was required — which made the "+" a lie.)*
  - Under Chunk B, everything created here is **staged**, not written — and **staged actions can hook
    to each other**, because the project page is a planning surface. See §12.1b.
- **Creating a Current project REQUIRES at least one action — RULED (user, chunk 5).** The project
  drafting page will not save a Current project with an empty staged action set; the block uses the
  standard dashed-outline feedback (§4.6), and the requirement is satisfied by any staged action
  (next or waiting), created via the quick-add rows or ✎. **Why chunk 5:** staging (§12.1) is what
  lets the action and the project land **atomically** — on a *new* project with no ID yet, there is
  nothing to link a child action to until save, so the requirement is only coherent once staged
  children exist. **Scope, deliberately narrow:**
  - **Current projects only.** Future/Someday projects hold no linked actions by design (§4.3d,
    §4.8b) — the requirement cannot apply to them, and converting Future→Current does not retroactively
    demand one.
  - **The drafting page only. The calendar creation row is EXEMPT** (§4.15a) — a deadline created
    there still makes a dateless, actionless Current project by design, which is *stalled by
    definition* and correctly surfaces in the review. Fast capture stays fast.
    - **⚠ Build trap — enforce this at the drafting-page save handler, NOT in a shared
      `createProject`/`saveProject` path.** Three creators deliberately make actionless Current
      projects: the calendar creation row (above), and the QA-checklist and chunk-map injectors
      (§8.1/§8.2, which push actionless Current projects straight into state so they show the "no
      linked actions" flag on purpose). A check placed in a shared create/save function breaks all
      three. The block belongs on the drafting-page save gesture only.
  - **The review's stalled-project kind is RETAINED, not replaced.** Requiring an action at creation
    does not mean a project can never be stalled: completing a project's last action re-strands it
    (§4.8b), and the calendar path creates stalled projects on purpose. The two mechanisms are
    complementary — one at birth, one for the whole life after. **⚑ Judgment call, flagged:** the
    daily review only ever *offers* "add a next action" (it is one of five menu options, never
    forced); requiring one at creation is a stricter, separate stance. Overrule if you would rather
    the drafting page also merely *nudge* toward an action instead of blocking save.

### 4.3b Project health indicator

Projects with **no way forward** show an icon plus a short muted-amber line beneath the
title on the lane card: **"⚠ no linked actions."** This is **derived** state, computed at render
time — every commit that mutates the relevant stores calls `refreshProjectFlags(kind)`, which
re-renders the Current lane. Commit-time only; never from a draft.

**⚠ WHAT COUNTS AS "FORWARD MOTION" — CORRECTED (user ruling, this round).** The GTD rationale is
*"an active project with no way to move it forward is stalled,"* **not** *"a project with no next
action is stalled."* The goal is to know how to move each project forward, and **waiting is a
legitimate way forward.** So a project is stalled only when it has **none of**: a linked **next
action**, a linked **waiting action**, or (from chunk 7) a linked **event/appointment**. A directly
linked waiting action already counts today (the computation scans both action lanes). **The gap this
closes is events:** a project whose only plan is *"act after the conference on the 14th"* — an event
linked from the event page (§4.15d) — must read as **healthy, not stalled**, and must **not** be
nagged to add an action or offered Someday/Maybe in the review (§4.8b). **Build note (chunk 7):**
extend the health computation (and the review's stalled query, §4.8b) to count linked events, once
events can link to projects. *(Rejected: counting a **projected** future occurrence of a recurring
event — only the one live occurrence counts, matching §4.15d's "shows exactly one instance.")*

### 4.3c Linked notes on Projects

- **The project page is a planning page**, not just an actions container.
- **Shared pool:** project-linked notes are the *same* notes as the Notes tab (4.9). No separate
  project-scoped note type.
- **Swipeable list area:** the project page gains a second list — Actions | Notes — switched by
  swiping. Only the list area swaps; title, description, deadline, Complete stay fixed. Desktop:
  a click-based tab toggle.
- **Linking works both directions:** a project-link field on the note's page; a quick-add row on
  the project's Notes tab. **The note's field is MANY-valued** (tag-style, hooks pattern) and
  survives project deletion as a tombstone chip — see §4.9.

### 4.3d Contexts (formerly "mini-lists")

**The reframe:** grouping by *where or how* an action gets done (location or tool), not by *what
it belongs to*. Classic GTD batching — all your calls together, all your errands together.

- **Renamed "Context" throughout the UI.**
- **Default seeded contexts: Computer, Calls, Errands.** Users add their own; the defaults are a
  starting point, not a taxonomy.
- **Where they apply: Next Actions and Waiting Actions — the two action lanes. RULED (user, this
  round).** **Not** the project lanes — **neither Current nor Future**. **Not** Habits — removed
  entirely (context-batching doesn't transfer to habits; each runs on its own schedule, and the
  hook-chain system already encodes real behavioral sequence, which is a better grouping than an
  arbitrary label).
  - **⚠ "NOT HABITS" IS ABOUT GROUPING, NOT CUEING — RULED (user, this round).** A habit is never
    *filed into* a context (there is no context grouping on the Habits lane; the line above stands).
    But a habit may be **cued by** a context: from chunk 3 the habit hook picker offers contexts
    alongside habits as cue targets, because **a context is a cue** — being in a context ("at the
    computer," "on errands") is exactly the kind of cue a habit fires on ("when I sit at the
    computer, check my computer list"). These are two different relationships to the one registry, and
    only the *grouping* one is banned for habits. **A context-cue behaves like a text cue** (§11): it
    is **always live** (a context has no schedule and cannot be completed) and it takes **no part in
    the hook cycle** (nothing hooks back out of a context, so it can never close a loop). It is **not**
    exempt from the caps, though: cueing a habit on a context spends one of the habit's **7 outgoing**
    slots (the Habit card already counts it), and a context accepts at most **7 incoming** hooks like
    any other target (§7). See §4.5, §11.
  - **⚠ EVENTS ARE NOT AN EXCEPTION TO THIS, AND THEY ARE NOT ABSENT FROM IT.** A **pseudo-action
    lives in the Next Actions lane** (§4.14), so it takes a context like anything else there: it is
    **droppable into one**, it **stores** it (§4.14a), it **inherits** it across a series roll
    (§4.15b), and the event page carries a **Context field, edit-only** (§4.1, §4.15a — it is not on
    the calendar's fast-capture row). **This is the action-lane registry doing its job, not a second
    set.** *(Stated because "the two action lanes" and the chunk 3 row's "nowhere else" are lists of
    **lanes**, and the event **page's** field is not a lane. A chunk-7 session reading "nowhere
    else" as a mandate to delete that field would break four other sections.)*
- **A "Context" is not the same thing as a "list" (user ruling — see §4.3e).** Both project lanes,
  **Current and Future**, keep **plain lists**: a grouping header you file projects under, lane-local,
  no registry, no shared set, no membership surviving a move. That is all a project list ever is, and
  it is exactly what the lanes have today — chunk 3 does not touch them.
  Contexts — the registry, the shared Next↔Waiting set, membership surviving promotion — are an
  **action-lane** feature.
  *(⚠ This corrects, rather than reinterprets, three earlier statements: the chunk 3 row's
  "independent for Current Projects", this section's own "Current Projects keep an independent set",
  and §4.1's Context ✅ on Current. There is no independent set. There is no second registry. A
  build session that finds one of those phrasings surviving anywhere should delete it, not implement
  it.)*
- **Two ways to assign, additive:** a Context field on the create/edit page (picker, same pattern
  as the project-link/hook pickers), and drag-and-drop in the lane view.
- **The picker is CHOOSE-ONLY. It never creates a context (user ruling).** No inline "+ new" row,
  no create-on-type. Creation happens in exactly one place: the + badge on the lane (§4.3e).
  - *Why — and the argument is the **teaching**, not draft isolation.* ⚠ *(Restated this round. This
    bullet used to say that creating a context from inside a draft is "a side effect on another item,
    which draft isolation forbids **outright**." §4.9b then built exactly that for tags — the
    create-only **Manage tags →** sub-view — and showed it can be done isolation-safely. The old
    rationale therefore refuted itself, and a session reading §4.9b could reasonably conclude the ban
    here was an oversight. It is not — but the reason is the one below, not draft isolation. The
    asymmetry with tags is deliberate: a tag is **a word you add to a vocabulary**, and inviting one
    mid-note costs nothing; a context is **a bucket you file things into**, and inviting one
    mid-draft teaches the exact habit that breaks batching.)*
  - *The teaching is the reason:* contexts only batch if the set stays **small and stable**.
    A picker that invites naming one on the spot teaches invention-at-point-of-use, and the long
    tail that produces — fourteen contexts holding one item each — is a second title field, not a
    batching tool.
  - *Consistency:* no picker in this app creates its target. You cannot invent a project from
    inside an action, or a habit from inside a hook. A picker points at what already exists.
  - *The friction is small and already answered:* three contexts ship seeded, so an empty picker is
    rare; and §4.3d already gives the escape hatch — save the action ungrouped, create the context
    from the badge, **drag it in**. One drag, no lost draft.
  - **Empty state (carries the teaching, per the no-field-labels convention):** the picker reads
    *"No contexts yet — create them with + on the lane."*
- **Next and Waiting share one Context set** — the same underlying definitions, which is what
  makes "a promoted Waiting item lands in the identically-named Context automatically" possible.
  **It is the only Context set in the app** — the one the pseudo-action files itself into as well
  (§4.14). (Projects don't participate in the promotion cycle, and they don't participate in contexts
  either — they have lists.)
- **Info text:** "Group actions by where or how you'll do them — Calls, Computer, Errands. Handy
  for batching similar tasks together."
- **Deleting a Context that still holds items → UNLINK (user ruling).** The Context is deleted, the
  items **survive**, landing ungrouped at the top of the lane. Behind a confirm that says so plainly.
  Nothing is destroyed by a mistap, per the never-accidental ruling — and it reuses the same
  dead-parent machinery as the emergency restore rule (§7). *(Rejected: blocking the delete;
  deleting the items with it.)*
- **Build note (chunk 3):** this is a data-model change, not a rename. A `gtd_contexts` registry
  replaces lane-local group tasks. **No migration** — §1 rules it out (no real data; Reset seeds
  fresh in the new shape). *(Struck this round: this note used to read "ships with the first schema
  migration," written before the no-real-data ruling. It contradicted both §1 and the chunk 3 row.)*
  With IDs now stable across `moveItem` (§1), context membership can survive promotion cheaply —
  which is the whole point of the shared set.

### 4.3e Creation affordance — RULED (build in chunk 2; one string swap in chunk 3)

**Why it's here.** Creation was split across two controls: the floating **+ badge** (creates an item
in the active lane) and a per-lane **"+ New list"** button. Chunk 2 deletes the lane chrome that
button sits in (§4.7b) and chunk 3 changes what a "list" *is* on the action lanes (§4.3d) — so
without a ruling it gets restyled once and re-plumbed again, to reach a shape nobody agreed to.
Ruled once, here, so each chunk touches it exactly once.

**The ruling (user):**
- **The "+ New list" button is removed.** The floating **+ badge is the single creation entry
  point** on every lane.
- **On the five lanes with something to create besides the item itself, the badge opens a two-option
  pop-up menu**, labelled by the active tab. **The table below is the spec — read the counts off it,
  not off this sentence:**

  | Lane | Menu |
  |---|---|
  | Next Actions | *New action* · *New context* |
  | Waiting Actions | *New action* · *New context* |
  | Current Projects | *New project* · *New list* |
  | Future / Someday | *New project* · *New list* |
  | Habits | **no menu** — the badge creates a habit directly, one tap, exactly as today |
  | Notes (chunk 6) | **⭐ REVISED (user, BUILT): *New checklist* · *New note*** (checklist on top; each opens the note page — checklist-seeded or blank). **A third option, *New tag*, joins with §4.9b and navigates to the Tags page** (not an inline row). *(Was "New note · New tag" before the checklist ruling.)* |
  | Calendar (chunk 7) | **RULED — the calendar has NO `+` badge.** Its creation affordance is the bottom creation row (§4.15a). Do not add one |

- **No menu on Habits.** Habits have neither contexts nor lists (§4.3d); a menu with one live
  option is a menu with a dead option in it.
- **On the action and project lanes, the second option opens an inline text row with an add button —
  not a create page, not a dialog.** Same affordance the "+ New list" button expands into today
  (native `prompt` is banned, §3); it simply now hangs off the badge. Name, tap +, done. True of
  **both** *New context* and *New list*. **Notes is the one exception and the table says so:** *New
  tag* **navigates to the Tags page** (§4.9b), because the tag surface is a page, not a row.
- **Project lists stay plain lists.** *New list* on Current/Future creates a lane-local grouping
  header and nothing more — no registry, no shared set, no promotion mechanics. See §4.3d.

**Open — the one thing not ruled: the cost of the second tap.** Creating an action is the app's
most frequent operation; creating a context is something a user does a handful of times, ever. A
menu taxes the frequent path to serve the rare one — today the badge is a one-tap create, and under
this ruling every action creation becomes badge → *New action*. Alternatives if that tax proves
real in use: keep the badge a direct create and hang context creation off a **long-press**; or put
a small secondary affordance on the badge itself. **Not blocking chunk 2** — the menu is the
default and ships; revisit after the author has lived with it on the phone for a week.

**Build split (deliberate, and it is one touch each):**
- **Chunk 2** builds the machinery and **the five lanes that exist at the time**: badge menu, the
  inline naming row, removal of "+ New list", and the Next / Waiting / Current / Future / Habits rows
  of the label table. On the action lanes, *New context* calls the **existing group-creation path**
  (`addGroup`) — the contexts registry does not exist yet. *(It cannot build the whole table: **Notes
  is chunk 6** and **Calendar has no badge at all**. Chunk 6 adds the Notes row when the lane
  arrives.)*
- **Chunk 3** swaps *only* the action-lane handler: *New context* stops creating a lane-local group
  and starts writing to the `gtd_contexts` registry. The menu, the labels, and the inline row are
  untouched. Project lanes are untouched entirely — their lists never leave the group path.

**Build note:** one control, **six lanes** (every lane but the Calendar, which has no badge at all —
its creation affordance is the row in §4.15a). **Five of the six carry the menu**; Habits carries the
badge with no menu. Implement the label table above **literally**, from this section; do not infer it
per-lane, and do not trust a prose count over the table.

### 4.4 Deadlines

Structured date, **with an optional time** — not free text; it feeds the calendar. **Next Actions and
Current Projects only** (see 4.13). **Deadlines do not recur** (§4.13, §7) and they are **not**
events — they are a *field on* an item that already exists. They can be set from the item's own page
**or** from the calendar's creation row (§4.15a), which creates the action or project due that day.

**The time is genuinely optional (RULED, user, this round), and that is the whole reason §4.4d
exists.** A deadline with a time counts down to the time; a deadline without one is due *on a day*
and has no intra-day countdown to run. Both are deadlines; only the display differs. **This
supersedes §4.1's old "Time — events only" row**, which was written when the calendar patch landed
and was never reconciled with §4.4 and §4.13.

**⚠ WHO BUILDS THIS (added this round — §4.4 had NO owner in the chunk map).** The bar has never
existed in the code (the screen-refactor comment defers it to a *"chunk 6"* from the pre-resequence
numbering, which no longer means anything), and no chunk row cited §4.4. **Ruled: chunk 2 builds
§4.4b, §4.4c, and the two DEADLINE rows of §4.4d** — it is card rendering, it is visual, and chunk 2
exists precisely so nothing gets built in the old visual language and reworked. **Chunk 7 adds the
two EVENT rows to the same renderer** (§4.14c's appointment window, and the untimed event's
born-full bar). One display language, one renderer, extended once. *(The optional **time** input on a
deadline already ships — it is in the code today; it was §4.1 that was wrong about it, not the app.)*

**4.4b Progress-bar scaling.** The bar is not a neutral time-elapsed gauge; it exists to counter
procrastination on long-horizon items while staying honest in the final stretch.
- **Measured from creation to due date** — 0% at creation, 100% at the deadline, always.
- **Under 3 weeks: straight linear.** There isn't enough runway for front-loading to do useful
  work, and curvature would look erratic.
- **3+ weeks: light-touch front-loaded curve for the first 85%** of the window — faster than
  linear early (urgency while there's still time to act), then easing. Deliberately mild; an
  aggressive curve reads as dishonest and loses credibility. Exact steepness is a build-time
  tuning detail; the *shape* is what's locked.
- **Final 15% of time remaining: converges to honest 1:1 tracking**, reaching exactly 100% at the
  due date. This is what prevents the cry-wolf problem — the bar can't plateau near-full for
  weeks.
- **Color shift to red at that same final-15% point**, on *every* deadline including short linear
  ones — **and including a deadline with no time**, whose window runs creation → its day (§4.4d).

**4.4c Visual treatment.** A thin (~5px) rounded bar beneath the title. Brass fill normally, red
in the final-15% window. No label, no icon. *(Rejected: a bar with an "Nd left" label — redundant;
a radial/ring icon — reads less immediately as progress.)*

**4.4d Every dated thing gets a bar, and the passed state is a chip — RULED (user, this round).**
**Built in chunk 2 (the two deadline rows) and chunk 7 (the two event rows) — see §2.**
*This is one display language for four things* — a timed deadline, an untimed deadline, an
appointment, an untimed event — *and it is stated once, here, so the four don't drift apart.* It
replaces the old "untimed things have no bar, and show their date in red instead" rule, which gave
the app two ways of saying "this is late" and put one of them on the entity that most needed the
other.

| Dated thing | What the bar does | On its day |
|---|---|---|
| **Deadline with a time** | §4.4b's curve, converging on **the time** | reaches 100% at the time |
| **Deadline with no time** | §4.4b's curve, converging on **the day** | **arrives full at the 4 AM boundary** — there is no intra-day countdown to run |
| **Appointment** (event with a time) | §4.14c's window: 4 AM → the time | reaches 100% at the time |
| **Event with no time** | *(exists only on its day)* | **full, from the 4 AM boundary** |

- **⚠ THE BAR'S ORIGIN IS PER-TYPE, AND IT IS NOT THE ROW'S CREATION (user, this round — stated here
  because CHUNK 2 BUILDS THE RENDERER and would otherwise have no reason to know).** A deadline's bar
  runs from **the item's creation** (§4.4b). **An event's bar does not.** A pseudo-action's window
  opens at the **4 AM boundary of the app-day containing the event's timestamp** — the moment the row
  appears — and closes at the time (§4.14c), which is ~20–28 hours, *not* the weeks since the event
  was coined in the calendar. Measure an event's bar from its creation and it is **98% full and red at
  birth**, which is the exact failure §4.14c exists to prevent. **The origin needs no stored field:**
  it is derivable from the event's own timestamp (4 AM of its app-day — mind §4.14b, where an event
  between midnight and 4 AM belongs to the *previous* civil day's app-day). Build the renderer to take
  an origin, not to assume one.
- **⚠ And the ID is not the row.** The pseudo-action's task **ID** is minted when the event is created
  (§4.14a, so a condition can hook to it in advance — §10, chunk 8). The **row** is still minted at 4
  AM, unchanged. Nothing is rendered, sorted, counted, duplicate-checked, or **measured** before the
  boundary; an event that exists is not an item in a lane. *(Recorded because "the ID exists early"
  reads as "the row exists early," and a row that exists early is a row something will measure from.)*
- **Full ≠ late.** A full bar says "today"; the chip says "gone." An untimed thing sits at a full
  brass bar all day, which is honest: the day is the resolution of the deadline, so the whole day is
  the final moment.
- **The passed chip.** When the moment passes uncompleted — the time, for timed things; the 4 AM
  boundary that **ends** the app-day, for untimed ones — the bar stays **full and red** and a small
  **"passed" chip renders at the end of the bar.** It stays in place. **Nothing auto-expires, ever.**
- **Same chip, same place, on all four.** The chip is what a user reads, so it must not be
  type-specific — an untimed event is not a lesser citizen of the Next Actions lane than a deadline.
- **The review (§4.8b) catches it** as a past-due open loop — **all four of them, deadlines
  included.** *(Corrected: this line used to say "exactly as before," which was false — §4.8b
  previously excluded deadlines from the review outright, on the strength of the very asymmetry this
  section deletes. The exclusion is **reversed** in §4.8b, this round, and the two sections now say
  one thing. A deadline's shape in the queue is a **decision menu** — push the date / complete /
  delete — not the pseudo-action's checkbox; see §4.8b.)* The chip is the in-lane statement; the
  review is the queue. Two surfaces, one fact — *not* two nags (§9's orphan ruling settles the general
  principle).
- **A deadline created *for today* has no window, and renders FULL.** *(Stated because §4.4b defines
  the window as creation → due, which for a same-day deadline is zero or negative — a build session
  will divide by zero here.)* Zero window, full bar, no red-shift arithmetic: it is due today, which
  is what a full bar says. It takes the passed chip on the usual schedule (its time, or the 4 AM
  boundary that ends the day).
- **The red shift keys off the WINDOW, not the time.** An untimed **deadline** still has a long
  window (creation → its day), so §4.4b's final-15% red applies to it normally — a deadline three
  days out is late-stage whether or not you named an hour. An untimed **event** is the only thing
  with no window at all: it is born full at 4 AM on its day, so it has no final-15% to shade — it is
  **full**, then **full-and-passed**. *(Stated because "untimed" is not one case: an untimed deadline
  has a runway and an untimed event does not, and a build session collapsing them will either paint
  every event red or never redden a dateless-hour deadline.)*

### 4.5 Habits — page

Full-screen, same chrome as everything else. Existing hook logic, cycle rules, and the two-tone
chime carry over. **Description field with an identity prompt as its placeholder:** *"Who will I
be if I build this habit?"* (shorter approved variant if it truncates: "Who will this habit make
me?"). Identity-based framing is the strongest known anchor for habit persistence, and the
placeholder does that teaching silently — consistent with the no-field-labels rule.

**Hook picker — contexts as cue targets, and the copy follows (chunk 3, user ruling this round).**
From chunk 3 the picker lists **contexts as well as habits** as things a habit's cue can point at
(§4.3d: a context is a cue, not a grouping-for-habits). Because the list is no longer habits-only,
**the picker copy stops saying "habit" and says "cue"**: the header "Hook onto which habit?" becomes
a cue-framed prompt, and the empty state "No habits available to hook to yet." becomes a cue-framed
one that **names the way out** (per the empty-picker-teaches rule, §12.1b/§4.3d): e.g. *"No cues yet —
add a habit, or create a context with + on the Next/Waiting lane."* A context in this list behaves
like a text cue — always live, and outside the hook **cycle** — but it is **not** cap-exempt: it
counts against the habit's 7 outgoing slots and against the context's own 7 incoming (§7, §4.3d), so
the picker blocks an 8th outgoing cue and hides a context that already carries seven incoming hooks.
Group the picker so habits and contexts read as distinct sections. *(This is the same
list-widening/relabel that the condition and hook pickers already model; reuse, don't reinvent.)*

### 4.6 Edit page chrome

- **← (top left):** saves and exits. The safe default.
- **✕ (top right):** cancels, discarding unsaved edits.
- **🗑 (top right):** deletes, behind a confirm. **The one control that acts immediately.**
- **Complete (bottom):** arms completion ("✓ Completing on save"); tap again to disarm; Save
  archives. On a **Project**, Complete also completes linked Next Actions and **archives** linked
  Waiting actions (recoverable if the completion was a mistake), with a prompt flagging this if
  any exist. On a **Habit** it is a same-day **toggle** rather than an archive — it does not close
  the page, and swaps to an outlined "✓ Completed today" so its reversibility is legible — **but it
  is still draft-only and armed, and commits on Save, like every other control on a drafting page**
  (`CLAUDE.md`, draft isolation; §9's day-stamp ruling depends on it).
  ⚠ *(Corrected this round: this line used to say the toggle "mirrors the list **checkbox**." The
  list checkbox is explicitly **not** a drafting surface and acts **immediately** — so the analogy
  told a build session to commit on tap, which would have made §9's day-stamp dead code around a
  state the UI never produces. That is the golden rule's origin specimen, on the same feature. The
  toggle mirrors the checkbox's **reversibility**, not its **timing**.)*
- **Convert buttons** (Make Waiting / Make Next / Make Current / Make Future): **edit-only** —
  never on a create page (a draft isn't an item yet). Draft-only and armed, applied at Save after
  field edits land. **Mutually exclusive with Complete:** arming one greys out the other.
- **Layout density:** fields are compact, single-line by default, auto-expanding to fit content.
  Title in a larger font. Forms top-anchored, deliberate negative space toward the bottom.
- **BACK = CANCEL (user ruling).** The browser Back button, and later the Android back gesture,
  mean **✕ (cancel and discard)** — never ← (save). Back is a *navigation* gesture, not a commit
  gesture; treating it as Save would silently write half-finished drafts on an accidental swipe. It
  routes through the **same warning Chunk B specifies** whenever anything is staged, so nothing is
  lost silently. Resolution order: **Back closes an open dialog → then an open drawer → then an open
  page (as cancel) → and at the root, it exits the app** (standard Android behavior; ignoring it
  strands people). *(On the one page with no ✕ — the completed-item page (§4.12b) — Back simply
  closes: there is nothing editable, so cancel and close are the same gesture. Noted so the mapping
  doesn't read as broken.)*
- **Feedback conventions:** blocked saves show a **dashed outline** on the offending field,
  cleared on next input — no popups. **Validation never fires against a state the item is leaving**
  — see §9: an armed Complete or Convert suppresses the waiting-for requirement entirely. Buttons play a soft navigation tick (the two-tone chime stays
  reserved for hook/condition picks). The promote control on Waiting/Future cards is a visible ←
  arrow.

### 4.7 Cards

Compact rows. A description shows a truncated preview; full text only on the detail screen.

### 4.7b Main UI layout cleanup (chunk 2)

**This is a real visual-identity shift, not a tightening pass** — the nested "ledger" structure
(paper-colored lane panel containing individually-boxed gray cards) goes away entirely.

- **Both levels of boxing removed.** No `.lane` panel, no per-item `.card` background. Items sit
  directly on the page background.
- **Background: a subtle viewport-pinned vertical gradient** — darkest at top, slightly lighter
  warm gray at the bottom edge. Pinned to the viewport, so content scrolls as a separate layer
  over it. Kept in the warm family, restrained enough not to fight the app's semi-transparent
  white overlays (pills, quick-add rows, condition badges), which are tuned against the current
  dark tone.
- **Separation: pure whitespace.** No dividers, no hairlines. Generous spacing and typography.
- **The colored lane header survives as a floating label**, no longer capping a panel.
- **Larger list items:** both bigger text and taller rows.
- **Tighter margins:** three nested paddings (page, lane body, card) collapse to one.
- **The list-view "×" delete button is removed** — items are deletable from their own page.
- **Build with safe-area insets** (see §2 wrapper prerequisites).
- **The "+ New list" button goes down with the chrome it sits in — see §4.3e (RULED).** Its
  replacement — a two-option pop-up menu on the floating + badge, opening an inline naming row —
  is built in this chunk, to the label table in §4.3e.

### 4.8 The Tray — capture drawer + open-loop review (MAJOR REVISION)

**The reframe (user ruling, design conversation).** The tray is not a container of typed notes. It
is **where open loops go to be closed** — and an open loop is anything unresolved, *wherever it
actually lives.* This gives the tray two jobs, and they are built as two things.

**The §6 two questions, answered before mechanics.**
1. **Purpose:** capture anything, instantly, before it's lost (GTD's collection habit); and then
   surface every unresolved thing in one place so it can be *decided on*, one at a time.
2. **What the UI must teach:** an open loop is anything unresolved, not just anything you typed.
   Deferring is legitimate but not free. And — the sharp one — **"I can't think of a next action"
   is not a thinking failure; it is information about the project.**

---

#### 4.8a The drawer (chunk 6)

- **A drawer that pulls out from the left**, over the main screen, lanes still visible behind it.
- **Auto-opens on app launch (user ruling — restored).** Capture is the first job, so the capture
  box is the first thing you see. **It auto-opens even when empty** — an empty tray showing a
  capture box is exactly right, and per the info text an empty tray is a small reward, not a wasted
  screen. Launch only; **never** on tab-switch back to the app.
- **Opens by tapping 📥.** *(Originally: "NOT by a left-edge swipe" — on Android the left-edge swipe
  is the system back gesture, and an app that fights it loses.)* **⭐ REVERSED (user): the drawer is
  now swipeable too** — swipe **right to open, left to close.** Tapping 📥 remains the primary open
  path; swipe is additive. **Mitigation for the back-gesture collision:** the open-swipe is accepted
  anywhere in the **left third** of the screen, not just the OS edge band, so a slightly-inset swipe
  still opens even if the OS claims the outermost pixels. **Accepted residual cost:** a hard
  edge-swipe may still register as system-back on some Android setups. **Lanes-only:** swipe never
  fires over an edit/create page or a dialog, and it yields to an in-progress card-reorder drag.
- **Closing it is a cancel.** Nothing on the main screen changes as a result of opening or closing
  it. **Back closes the drawer first** (§4.6's Back ruling).
- Top: one large capture input + "+". Speed-first, no other fields. Nothing else competes with it.
- **No counter, no badge (user ruling).** The tray auto-opens, so the count would be telling you
  something you are already looking at. Anyone who wants a number can count the cards.
- **Info button** (exception to the no-help-on-pages rule): "A holding pen for stray thoughts. Try
  sorting through it once a day — an empty intray means nothing's slipping through the cracks."

---

#### 4.8b The review — open loops, one at a time (ITS OWN CHUNK — see §2)

**Split out of chunk 6 deliberately.** Daily review is the part of GTD with the most design surface
and the least obvious UI; folding it into a chunk that already holds the drawer, Notes, the header
and the settings surface would roughly double that chunk. It gets its own.

**The queue.** One list, four kinds of open loop, all of them **derived** except captures:

| Kind | Lives where | Affordance when revealed |
|---|---|---|
| **Past-due dated item** — *any* dated thing whose moment has passed uncompleted (§4.4d): a **deadline** (its day, or its time), or a **pseudo-action** (§4.14) whose appointment time has passed or whose untimed event's app-day has ended. **Both shapes; see the split below** | Next Actions / Current Projects | **Depends on which** — a pseudo-action gets **a checkbox** (and is tappable: a rescheduled appointment gets edited, not just ticked); a past-due **deadline** gets a **decision menu** (below) |
| **Capture** (typed into the tray; an *uncategorised* open loop) | The tray itself | The sort chips: **Next / Waiting / Project / Future / Note / Calendar** *(the **Calendar chip is chunk 7** — it has nowhere to send a capture until the calendar exists; the other five ship in 6b)* |
| **Stalled project** (**no way forward** — no linked next action, no linked waiting action, and from chunk 7 no linked event/appointment; §4.3b) | Current Projects | Decision menu (below) |
| **Orphaned waiting action** (its condition target was deleted) | Waiting | Decision menu (below) |

- **Actions and projects stay in their lanes.** The review is a **lens, not a container** — it
  renders them where they are and tapping through goes to their real page. Yanking an orphaned
  waiting item out of Waiting would make the lane lie about what you're waiting on.
- **Past-due items sort to the top and are revealed first.** They are mostly things you did and
  forgot to tick — so the review opens with something you can close in one tap, which is the right
  way to start a chore. Completing one right there just removes it; no tap-through needed.
- **⚠ Overdue deadlines ARE open loops — RULED (user, this round). This REVERSES the previous
  ruling, and the reversal is forced.** This section used to read: *"Overdue deadlines are NOT open
  loops. They are late, not unresolved, and their red bar is already shouting. Out of scope."* That
  argument was load-bearing on an asymmetry **§4.4d has now deleted**: under the old model a deadline
  had a bar and an untimed event had **none** (it showed its date in red), so the review had to catch
  events — nothing else surfaced them — and did not have to catch deadlines. **One display language
  means one rule.** If a full red bar plus a passed chip discharges the app's duty to surface a
  past-due item, it discharges it for the pseudo-action too and the past-due kind should not exist at
  all; if it does not, it does not discharge it for a deadline either. The in-lane chip states the
  fact; the review is the queue that makes you *decide* about it. Two surfaces, one fact — **not two
  nags**, exactly as §9's orphan ruling settles the identical question for the orphan pill.
- **⚠ SEQUENCING — REVISED (this round, following the ruling above).** The old sequencing said the
  past-due kind was *only* a pseudo-action and therefore had to wait for the calendar. **That premise
  died with the ruling: deadlines exist today, so past-due open loops exist in 6b.** So:
  **6b builds all four kinds** — past-due (the **deadline** shape: the decision menu) plus the three
  derived kinds — **and five sort chips.** **Chunk 7 extends the past-due kind to the pseudo-action
  shape** (the checkbox variant), and adds the sixth chip and the "it moved" banner (§4.15e). Build
  the past-due kind so a **second shape** slots into it without restructuring — **do not hard-code the
  deadline case**, exactly as the old note said not to hard-code three kinds. *(The alternative —
  moving the calendar ahead of 6b — was rejected: the calendar is the largest chunk on the board and
  the review is the one that needs the navigation stack settled around it.)*
- **What the Calendar chip does (chunk 7):** sorting a capture to Calendar **opens the calendar with
  the capture's text prefilled into the creation row (§4.15a), today selected**, and fires the "it
  moved" banner on save.

**Redaction (user's design, adopted — supersedes the old "genuinely hidden" rule).**
- **Unrevealed cards render with a redaction bar across them.** You can see *that* they exist and
  *how many* remain; you cannot read them and **you cannot tap them.** (Tappable redacted cards
  would let you cherry-pick blind, making the discipline decorative.)
- **The revealed card — always the top one — renders as its normal lane card, minus the completion
  checkbox.** *Redaction is a **state**, not a card type:* every kind of open loop is redacted when
  unrevealed and rendered normally when revealed.
- **Why this beats hiding:** you can see the stack is finite and shrinking. That is the difference
  between a chore and a task, and it makes the empty state land — the stack disappearing card by
  card *is* the reward.
- **"Show all" toggle** stays as the second escape hatch. The discipline is a default, not a cage.

**The review offers decisions, not execution** — with **one deliberate exception, and it is narrower
than it used to be: the exception is the PSEUDO-ACTION, not the past-due kind.** A past-due
pseudo-action gets a **checkbox**, because for *that* card completion **is** the decision: a past-due
appointment is nearly always something that *happened* and you forgot to tick, so the question is
"did it happen?" and the answer is a tick.

**A past-due deadline is the opposite case and gets a decision menu (RULED, user, this round).** A
late deadline is a thing you did **not** do; "did it happen?" is the wrong question and a checkbox is
the wrong control. Its menu:

> - **Push the date** — an **inline date field**, right there. ⚑ *(Judgment call, flagged: the fence
>   says decisions, not execution — but the stalled project's menu already opens an inline quick-add,
>   so an inline date is the established precedent rather than a breach of it. Overrule if you'd
>   rather it tap through to the item's page.)*
> - **Complete it** — it's actually done.
> - **Delete it** — it's dead.
> - **Not now.** ⚑ *(Judgment call, flagged: every other menu ends here, and the whole deferral
>   architecture — no cap, no shame, the review simply never reaches empty — depends on "Not now"
>   being universal. Omitting it would make this the only undodgeable menu in the app: a real design
>   statement, and not one to make by omission. **Note the honest tension:** "Push the date" is
>   arguably the deadline's true deferral, and it writes data instead of hiding a card. Overrule if
>   you want this menu to have no exit.)*

Written as a ruling so a future session doesn't "fix" the inconsistency between the two shapes: they
are two questions, not one control applied unevenly.

**Decision menus (the escape-hatch ruling — the heart of this design).**

A stalled project's revealed card does **not** lead with "Not now." It leads with the decision:

> - **Add a next action** — quick-add, right there. Placeholder: **"What's the very next physical
>   action?"** (GTD's actual question, asked at the actual moment.) *(This is the menu's headline exit,
>   but per §4.3b it is not the only thing that un-stalls a project: a linked waiting action or event is
>   also a way forward. The menu leads with the next action because it is GTD's real question, not
>   because it is the sole cure.)*
> - **Move to Someday/Maybe** — the honest answer. *A project you cannot name a next step for is not
>   a project you are actively moving.* This is doctrine, not evasion, and the data model already
>   agrees (Future projects hold no linked actions and take no deadlines).
> - **Complete it** — it's actually done.
> - **Delete it** — it's dead.
> - **Not now** — *and only then.*

An orphaned waiting action's menu: *re-point the condition / replace it with free text / promote to
Next / complete / delete /* **Not now**. *(There is no "replace it with a date" option — waiting
actions have no dates, §4.13a. Deleted this round; it was the last place the old date model survived
in the review.)*

**This is not friction as punishment. It is making the alternatives visible, so that "Not now" is
revealed as the one option that changes nothing.** Three of those four doors close the loop *without*
requiring you to invent a next action you don't have — which is precisely why "I can't think of one"
is information rather than failure. The teaching layer does the work here; no rule forces anything.

**The cost of deferring — intrinsic, not imposed.**
- **No cap.** A cap is a rule; it is arbitrary ("why five?"); and it forces behavior, which the
  capstone principle forbids.
- **The cost is simply that the review never reaches empty while anything is deferred.** That is the
  entire mechanism, and it reuses the reward the app already has: *an empty tray means nothing is
  slipping through the cracks.*
- **Deferral is session-scoped, and the 4 AM boundary ENDS the session.** ⚑ *(Judgment call, flagged
  — the spec stated both rules and never said what happens when they diverge. They coincide in a
  browser tab; they diverge in the wrapper, where the app stays resident for days (§9). Simplest
  coherent reading, adopted: a deferral holds until the boundary, and the boundary starts a new
  session even if the app never closed. Overrule if you'd rather a deferral survive until the app is
  actually relaunched.)* A deferred item drops to the bottom and **does not re-surface again this
  session** (or the queue is an infinite loop). Tomorrow it's back in the queue with everyone else. This is the
  fresh-start effect the habit system is already built on, applied to the same problem.
- **Two honest end states:** **empty** (the reward), or **"3 deferred."** — you saw everything;
  three are waiting on you. Not a failure, not a scold. Just true.
- **NO SHAME MARKERS. Explicitly ruled.** No "skipped 4 times," no aging colours, no red. The habit
  system exists because framing a lapse as failure is what makes people quit, and a project you have
  dodged three times is exactly that shape. The app does not shame the runner who falls; it will not
  shame the project you are avoiding. The empty tray you didn't get is sufficient information.
- *Worth knowing (and the seed of any future gamification):* **an item deferred repeatedly is
  usually one that should be moved to Someday/Maybe.** The menu is already the answer; you just have
  to see it a few times. If gamification is ever built, *this* — not streaks — is where the
  interesting mechanic lives.

**Navigation.** Tapping a revealed card opens its real page. **Save-exiting returns to the review**
(the third feature depending on chunk 1's navigation stack). **On return, the review recomputes** —
an item you fixed drops out; an item you edited but didn't fix stays. It is derived state; do not
snapshot the queue at review-open, or you will be triaging ghosts.

**Consequence, ruled deliberately rather than discovered:** completing a project's last linked action
makes that project stalled **if that action was its last way forward** — so **finishing something can
add an open loop.** This is GTD-correct (a project with **no way forward** is genuinely unresolved;
it is what the ⚠ flag has always meant — see §4.3b, which counts a linked waiting action or event as
a way forward, not only a next action) and it should be taught, not hidden. The reward lives in the
*empty tray*, not in a count going down.

**Explicit teaching — an info button (user ruling, this round).** The app teaches implicitly almost
everywhere, but the review is where a user is actively *sorting their materials* and most needs to
know what each option does. So the review carries a **prominent info button** — the same exception to
the no-help-on-pages rule that §4.8a already grants the drawer. It explains the options visible while
sorting, across **two surfaces**: the **capture sort chips** (Next / Waiting / Project / Future /
Note / Calendar), whose meanings map to the lanes and can **reuse the tab info text** (`LANE_INFO`);
and the **decision menus** (stalled project, orphaned waiting, past-due), which need **their own
copy** because they describe decisions, not lanes. **It is one info button, not an onboarding
overlay** — coach-marks or a walkthrough would fight the redaction discipline and belong to the
fenced-off region below.

**⛔ FENCE — what the review is NOT, for the sprint.** A redacted queue, decision menus, a
tap-through, "Not now," an empty state, and the single info button above. **That is all.** Explicitly out: progress indicators
("3 of 12"), Next/Skip buttons, a "review complete" screen, review streaks, scheduled review
reminders, snoozing to next week, deferral tracking, a weekly-review mode distinct from the daily
one. Each is defensible and several are in the GTD book; together they are a chunk the size of the
calendar. **This is the gamification-shaped hole, and gamification is parked** — so build the review
so that it *could* later be gamified, rather than partially gamifying it now.

### 4.9 Notes tab (chunk 6) — RULED in full

Sixth tab, **teal** accent, standard info button: "A place for things that aren't actions. Try
linking one to a project so it's there when you need it. One caution: these notes aren't a
replacement for a real filing system." Cards: title + one-line preview. Standard chrome (←/🗑/✕),
title + auto-growing body. No Complete, no dates.

**The page.** Two fields, nothing else:
- **Title — required.** Empty on save → dashed outline, per the validation convention. No popup.
- **Body — a large text box, optional.** Explicitly a scratchpad; it is the one place in the app
  where writing nothing structured is the point. **⭐ RICH TEXT (user ruling this round, BUILT):** the
  body is a `contenteditable` rich-text editor, not a plain textarea — the author uses bold/underline
  constantly for section headings and important lines, and visible markdown marks in edit mode were
  the dealbreaker. Toolbar: **Bold · Italic · Underline · Heading · Bullet list · Checklist**, plus
  the **⊞** button that opens the add-a-tag/linked-project picker (one entry point; gains the Tags
  section with §4.9b). The body is stored as **HTML**, run through a **strict tag allow-list**
  (`b/strong/i/em/u/h2/ul/ol/li/br/p/div`, plus `class="checklist"` on `<ul>` and `class="checked"`
  on `<li>`, **zero other attributes**) on every save and defensively on render — it is the one
  untrusted-input surface (imported backups, chunk 8; pastes). Card preview strips tags to one line.
- **Checklist note type (user ruling this round, BUILT).** The Notes **+** badge menu is **New
  checklist · New note** (checklist on top; **New tag** joins with §4.9b). *New checklist* seeds the
  body with one empty checklist item so the page is a checklist from the first keystroke. A checklist
  is a `<ul class="checklist">`; the checkbox and its ticked state are pure CSS on the class (nothing
  to sanitise-validate). Tap the left checkbox zone to tick; tap the text to edit.
- **Linked projects — a repeatable picker, tag-style.**

**Linked projects are MANY, and this is the app's first many-link field.** Actions link to *one*
project; a note links to any number. **Build to the `hooks[]` pattern** (habits already carry a
repeatable picker over a list), **not** the single-select project-link pattern — a build session
reading only §4.1 will reach for the wrong one and hand back a single-select.
- **Store the project's NAME alongside its ID at link time** — the same denormalisation
  `conditionLabel` already uses. This is not an optimisation; the tombstone rule below is impossible
  without it.
- **Linking is bidirectional** (§4.3c): the picker on the note's page, and a quick-add row on the
  project page's Notes list. Same shared pool of notes either way.

**Deleting a project UNLINKS, and leaves a tombstone chip (user ruling).** The note survives; the
chip stays, wearing the dead project's frozen name and a **dashed outline** — *this is the orphan
pill from §9, not a new concept.* Rationale is the orphan-condition rationale: the user did create
that relationship, and its target's deletion is a data-integrity fact the app should state, not
quietly erase. Clearing the tombstone is the user's call — an ✕ on the chip on the note's page,
draft-isolated, committed on Save.
- **Completing a project is NOT deleting it, and its chip is NOT a tombstone.** A completed
  project's chip goes **green-bordered** ("this is history, not live work") and stays on the note.
  The tombstone — frozen name, dashed outline — is for genuine deletion only.
  - **Completion is DERIVED, never a stored field on the link.** The project still exists in the
    Completed archive with its name intact, so the chip looks it up and styles from that. Which
    means it **self-corrects on restore**: un-complete the project and every green chip on every
    note goes normal again — no cascade, no bookkeeping, no migration. *Do not stamp a
    `completed` flag onto the link; it would go stale the moment the project is restored.*
  - **A project completed and THEN deleted from the archive becomes a tombstone** — the green chip
    turns frozen-and-dashed. This works only because the name was denormalised at link time. It is
    the case that proves the denormalisation rule.
  - **Three chip states, one visual language, used identically on the note card and the note page:**
    live (normal), completed (**green border**), deleted (**frozen name, dashed outline**).
- **This deliberately differs from contexts** (§4.3d), where deleting a Context leaves items
  *ungrouped* with no trace. A context is a bucket; a project is a *thing that had content*, and the
  note is a reference to it. Do not "harmonise" these later — the difference is the ruling.
- **Tombstones do NOT enter the review queue** (§4.8b). A stale reference is not an open loop, and
  §4.8b's fence holds.

**The lane is FLAT. No grouping, no project sections, no contexts (user ruling).**
- *Why:* every grouping surface in this app is single-parent (one `parent` field, one header, drag
  moves between them). Project tags are many. A note tagged to two projects would have to appear
  twice (breaking the data model, drag semantics, and collapse state), appear once under an
  arbitrary winner (silently hiding a relationship the user created — a note you'd fail to find,
  not a bug you'd notice), or require inventing a "primary tag" concept, a picker for it, and a
  ruling for deleting it — all on the lane that is supposed to be the simple one.
- *And the project-grouped view already exists, from the other side:* §4.3c gives every project page
  a swipeable **Actions | Notes** list over the same shared pool. "Everything I've written about the
  kitchen remodel" is answered on the kitchen remodel's page. The Notes lane's job is the opposite
  direction: the flat chronological pile — including the large share of notes that belong to no
  project at all, which a project-grouped lane has nowhere to put.
- **Order: most-recently-edited first.**
- **Project chips render on the note card**, so relationships are visible without the lane
  pretending to be a hierarchy.
- **Tapping a chip FILTERS the lane** to that project. Filtering is not grouping: transient,
  single-selection, no parent field, no drag semantics, no collapse state, and it cannot hide
  anything — the unfiltered lane is always the complete set. ~90% of what a project-grouped lane
  promised, for ~5% of the machinery. *(Tombstone chips are inert: nothing to filter to.)*
- **⭐ FILTER BUTTON (user ruling this round, BUILT).** Chip-tap alone was not enough: there is now a
  **filter button at the top of the lane, under the header**, opening a single-select menu ("All
  notes" + a **Projects** section of every project any note links to; a **Tags** section joins with
  §4.9b — the menu already renders sections). Same single-selection filter model as the chip; the two
  share state. Deleted/tombstoned projects are excluded (inert). The active filter self-heals if its
  project vanishes.
- **Card chip row shows at most TWO chips, then a "+n" badge (user ruling this round, BUILT).** The
  cap is over the combined project+tag list; the card is a preview, not the full set.
- **The + badge on Notes opens the two-option menu — *New note* · *New tag*** (§4.3e; the second
  option navigates to the Tags page, §4.9b). *(Corrected this round: this bullet used to read "a
  direct one-tap create — no menu … because there is no second thing to create here." It was written
  before tags existed. There is now a second thing to create, and this sentence was deleting one of
  the Tags page's three entry points — in the same chunk that builds them.)*

**Watch for (recorded so it isn't rediscovered):** if in practice *most* notes carry a project, a
flat lane will read as an undifferentiated pile and the chips will be carrying too much weight. The
fix if it arrives is a **sort-by-project toggle** — still not grouping, still no parent field. Do
not reach for sections.

**⚑ UNDER REVIEW — NOT DECIDED (user, awaiting human input; do not implement without a ruling):**
1. **A darker (slate-black) background for the note page specifically**, for reading/writing
   contrast, distinct from the dark-wood lanes. Leaning yes, but as a deliberate "ink on paper"
   contrast that still keeps the teal accent — not a jarring theme break.
2. **A whole-app aesthetic shift toward a Chinese visual language** — black lacquer ground with
   jade + goldleaf highlights around borders, replacing the current dark wood. Attractive and more
   distinctive than the generic dark-wood, but it is an app-wide CSS-variable change and should be
   its own coordinated theming pass, not folded into a feature chunk. Cautions on record: keep gold
   for **borders/accents/iconography, not body copy** (gold-on-dark fails contrast at text sizes);
   decide whether **jade replaces teal as the single accent** so the palette stays unified rather
   than teal+jade+moss competing. Both items are recorded here so a later session does not treat
   them as settled either way.

### 4.9b Tags (chunk 6) — RULED

**Why tags exist: they are the answer to "no search" (user ruling).** With no search in the sprint
(and none planned), a flat notes pile needs *some* retrieval handle. Project links are one kind of
handle; freely-chosen tags are the other, and they carry the vocabulary the projects don't.

- **Tags are a registry** (`gtd_tags`) — the same shape as `gtd_contexts` (chunk 3), minus the
  drag-and-drop, minus the lane rendering, minus the shared-cross-lane set. Notes reference tags
  **by ID**, which is what makes rename propagate for free — and rename is the cost that grows
  exactly as the no-search decision starts to hurt.
- **Tags are NOTES-ONLY.** They do not appear on actions, projects, or habits. *(The obvious future
  pressure is "why can't I tag actions?" — that lane already has contexts, and two overlapping
  grouping systems on one surface is a user who can't tell you which to use. If it's ever wanted, it
  is a **design conversation**, not an extension.)*
- **Contexts vs tags, so nobody unifies them later:** a **context is a container with membership**
  (a parent field, items move into it, it renders as a lane header). A **tag is an attribute of the
  note that carries it.** Different animals; their creation rules differ for a reason.

**The picker on the note page has two sections** (user ruling — cheap, and it does most of the work):
- **Projects** — the **live** project list, present by default. Selecting one creates a project link
  (§4.9: tombstone on project deletion).
  - **DELETED AND COMPLETED PROJECTS NEVER APPEAR IN THE PICKER (user ruling).** The picker offers
    only projects you can still work on. A tombstone is a record of what you *had*; a completed
    project is finished, and **a note about a finished project should be written somewhere else
    anyway.** Neither earns the clutter it would cost in the one list you use constantly.
    **This is two different code paths — the picker's project list and the note's chip row — and
    only one of them has any reason to know about the dead or the done. Verify both:** the chip row
    must still render green and frozen chips for links that already exist.
  - *Corollary — both exclusions are unrepeatable, for different reasons.* A tombstone can't be
    re-picked because the thing is *gone*. A green chip can't be re-picked because the picker won't
    offer it. So the ✕ on either is **"acknowledge and forget," not "unlink."** *Accepted cost:
    accidentally clearing a green chip cannot be undone by re-picking — restore the project, link,
    re-complete. Mitigated by draft isolation: the removal only commits on **Save**, so ✕-ing out of
    the draft brings it back.*
  - *The duplicate hole this opens is CLOSED — see the duplicate check below.* Hiding completed projects from the Tags
    page would otherwise permit: complete a project → create a tag with its name → restore the
    project → two identically-named chips in the picker. **The check's scope and the list's scope
    are different questions:** the check covers every project that can appear in the picker
    *including ones currently hidden*; the list shows only what you can select today.
- **Tags** — every tag in the registry. Choose-only, per §4.3d's picker ruling.
- **"Manage tags →" (RULED, user).** The picker carries an affordance that opens the **Tags page as
  a draft sub-view** — the trick the habit hook picker already uses (`state.screen.draft.hookPicker`;
  the note draft is never torn down, ✕ still discards the whole thing) — in **CREATE-ONLY mode: add
  rows, no deletes.** Deletes mutate *other notes* and must not be reachable from inside an open
  draft; creation adds a word to a vocabulary and strands nothing worse than an unused entry in a
  list. Same component as the full page, with `manage: false`.

**The Tags page** — reached from the **+ badge → *New tag*** on the Notes lane (§4.3e), from the
picker's *Manage tags →* (create-only), and from the settings surface (chunk 6). Chrome: **← Save and
✕ Discard only — there is NO page-level 🗑**, because the page is not an item and there is nothing for
it to delete; tags are removed by the **row ✕**, which stages the removal and fires its confirm at
Save (below). *(Corrected this round: this line used to specify the standard ←/🗑/✕ chrome, which put
a delete button on the page with no defined target — the only reading being "delete every tag," which
nothing asks for.)*
- **Projects appear first, READ-ONLY.** They are tags you did not create and cannot edit here;
  showing them is what makes duplicates visible (you can see at a glance that a "kitchen" tag would
  duplicate the *Kitchen remodel* project). **Live projects only — deleted and completed projects do
  not appear**, matching the picker exactly (§4.9). The tombstone lives on the note's chip, not in
  any list you can select from.
- **"Add tag" appends an empty text box**; an **✕ at the right of the row removes it.** Build to the
  **habit cue-row pattern** (`whenTexts`), which is exactly this control and already exists.
- **DRAFT ISOLATION APPLIES, and this is the part that will be got wrong.** The page's own **✕
  discards every row change**; **← Save commits them.** *The row-level ✕ removes a row from the
  draft — it does not delete a tag.* (Two different ✕s on one page. Unavoidable: the row control is
  the established pattern and the page chrome is the established chrome. Label/tooltip the row one
  as "remove".)
- **Deleting an in-use tag: the confirm fires AT SAVE, once — never on the row ✕.** This is the
  linked-actions-dialog pattern from **§7** ("Current → Future demotion … fires **at Save**, not on
  tap") — *not* §9, which this line used to cite and which contains no dialog. It is the only
  draft-isolation-safe way to do it. Text: *"Delete 'recipes'? It will be
  removed from 3 notes."* Removing a row you added in the same draft fires nothing — nothing
  existed.
- **DELETE-A-TAG = UNLINK. No tombstone** — deliberately unlike project deletion (§4.9). Deleting a
  project destroys *a thing that had content*, so the note keeps a mark. Deleting a tag retires *a
  word you chose*, deliberately, from the page whose entire job is retiring words. A tombstone there
  is noise.
**Duplicate check — case-insensitive, whitespace-trimmed, and it checks MORE THAN IT SHOWS.**
- **Scope: every tag, every live project, and every COMPLETED project.** Completed projects are
  hidden from this page and from the picker (§4.9) — but they are **restorable**, so their names are
  not free. Without this, the hole is: complete a project → create a tag with its name → restore the
  project → the picker now offers two identical chips. **The check's scope is not the list's scope.
  Do not "simplify" the check to what is on screen.**
- **Deleted projects are NOT in the check.** A tombstoned project cannot be restored; its name is
  genuinely free. That is what makes the completed-project rule principled rather than arbitrary.
- **The check runs ONE WAY.** Creating a tag is blocked by an existing project name. Creating or
  renaming a **project is never blocked by a tag** — projects are the substance, tags are the index,
  and a note's filing vocabulary has no business vetoing what you call your work. *(Accepted
  asymmetry. It looks like an inconsistency; it is a ruling.)*

**RULING — a project may collide with an existing tag, and NOTHING HAPPENS. Do not "fix" this.**
Name (or rename) a project `Kitchen` while a tag `kitchen` exists, and the app does not block it, does
not warn, and above all **does not renumber the tag to `kitchen 1`.** The collision is tolerated, on
purpose, and this paragraph exists because the "problem" is easy to rediscover and the auto-rename
is the obvious-looking fix.

- **The invariant is not "no two things in the picker share a name."** It is **"no two things *of the
  same kind* share a name"** — and that already holds, for free. The picker has two **labelled
  sections** (Projects / Tags), and project chips carry three states tag chips never do (live /
  green / tombstoned). A project `Kitchen` and a tag `kitchen` are in different sections and render
  differently on the card. There is nothing to disambiguate, so there is nothing to fix.
- **Auto-renumbering is not the cheap option; it is the expensive one.** (1) Renaming a tag touches
  every note carrying it — a mutation of shared state fired from an open *project* draft, so under
  draft isolation it must stage and commit at Save and unwind on ✕: **chunk 5 machinery imported
  into the project page for an edge case.** (2) It **silently rewrites the user's data**, which this
  app has refused to do everywhere else. (3) `kitchen 1` **is a lie** — not what they typed, not what
  they meant, carrying no information. Real complexity spent to produce a worse name.
- **The collision is usually a SIGNAL, not debris.** A note tagged `kitchen`, written *before* the
  Kitchen remodel project existed, is exactly the note you would want to link to that project once it
  does. Renumbering it buries a legible signal under a digit. Left alone, the user opens the picker,
  sees `Kitchen remodel` under Projects and `kitchen` under Tags, and decides for themselves — two
  taps, no machinery.
- **The principle, stated so it generalises: PREVENT WHERE IT IS CHEAP, TOLERATE WHERE IT IS NOT.**
  The one-way check blocks the collision at the single moment prevention costs nothing — you are
  typing a tag, the colliding name is on screen, and typing a different one is free. It declines to
  act when prevention would cost a staged cross-item rename and a silent edit. **The asymmetry is not
  a compromise; it is the design.**
- **The error must EXPLAIN, not just outline — and this is a new validation rule, stated generally:**
  **a dashed outline suffices only when the collision is visible on screen.** The convention (§4.6)
  is outline-only, no popups, and it works because the offending item is normally right there. A
  completed project is *deliberately hidden*, so an outline alone would read as a bug. Therefore:
  **validation carries a one-line inline reason exactly when the cause is off-screen.** Inline text
  under the offending row — **not** a dialog, the popup ban stands.
  - Colliding with a visible tag or live project → **dashed outline only.** You can see why.
  - Colliding with a completed project → **dashed outline + inline line:**
    *"A completed project already uses this name."*
- This is what stops "Recipes" / "recipes" / "recipe", the classic free-tag failure. Seeing
  duplicates is good; being unable to create them is better.

**The mid-note case is therefore closed:** a tag you want *while writing a note* is created through
*Manage tags →* above, without leaving the draft. The badge → *New tag* route (§4.3e) remains the
path when you are not mid-note, and the settings surface remains the path for rename and delete.
Three entry points, one component, one set of rules.

### 4.10 Header + navigation (chunk 2 / 6)

- Header keeps: brand, 📥 intray, 📅 calendar. **The points counter is gone** (§2 — the points layer
  is deleted in chunk 0a; do not leave a gap for it, and do not put anything back in it). Destructive
  and settings controls live behind an overflow (⋯) menu, which **becomes the settings surface in
  chunk 6** — where **Clear all app data** (today's Reset) lives, and Export/Import from chunk 8.
  **The Completed trash can is not one of these** — it is lane-scoped and stays in the Completed
  header (§4.12b).
- **The header is fixed and always visible** — it holds the intray icon, whose entire purpose is
  frictionless capture the instant a thought occurs.
- **4.10b — Collapsing top tab bar.** The tab row sits at full width at rest; scrolling down
  collapses it into a slim floating pill (active tab's icon, name, count); scrolling back up
  re-expands it. Scroll-triggered, not tap-triggered. The header does **not** hide with it.
  *(Rejected: a bottom floating pill — reserves that space for a possible future gamification
  element, and would collide with the + FAB; a vertical side rail — eats horizontal width on a
  narrow mobile layout.)*
  **Build notes:** needs a scroll-direction listener with a debounce/threshold (so jitter near
  the top doesn't flicker, and a list too short to scroll never collapses); the tab row leaves
  normal flow (`position: fixed`), so content below needs reserved space matching the current
  state. **See §3 known issue 2 — freeze the collapse state during a drag.**

### 4.11 Habits: the metric system

- **No streak counter, ever.** The current streak number is never displayed anywhere. You know
  you're running from the animation alone — "you know you're in a race, but you don't check your
  time mid-race."
- **Personal best** and **lifetime total completions** display under the animation box. Nothing
  else. The lifetime total never resets, which makes it immune to the all-or-nothing trap.
- **Animation box:** a stick figure that runs while the run is live, catches its breath when it
  ends, and reads a book on off-days ("you can't be on all the time").
- **Pause button** — skip without losing the run. Persists until manually unpaused. **A paused
  habit cannot be completed** (the badge and checkbox go inert), and a paused card shows only the
  ⏸ pill — no cue pills, because cues describe when a habit fires and a paused habit doesn't fire.
- **Day-of-week selector:** seven lettered boxes. Highlighted = the days the habit applies. None
  highlighted = every day. Off-days neither help nor hurt.
- **4:00 AM rollover** (app-wide — see §3).
- **Info text** appends: "Everyone misses a habit occasionally. We don't track streaks here, but
  we do track personal bests. If you break your streak, then maybe you'll have a new personal best
  to beat. After all: 'It's more important to be persistent than it is to be consistent.'
  – Rebecca"

### 4.11b Streak-break & restart

**The problem this solves:** the original design was good at *starting* a habit and punishing at
*restarting* one. Research base: the abstinence-violation effect (a single lapse read as total
failure is what turns a slip into abandonment); Lally et al. 2010 (one missed opportunity does not
measurably affect the automaticity curve — only sustained inconsistency does); the fresh-start
effect (temporal landmarks close a chapter and boost recommitment); mercy mechanics (streak
repair retains users through illness, travel, grief; rigid streaks backfire).

1. **Never-miss-twice grace (the stumble).** One missed scheduled day does **not** end a run — the
   runner stumbles, gets up, keeps going, and completing the next scheduled day repairs it.
   **Two consecutive missed scheduled days end the run.** Nothing is backdated; the threshold
   changed, not the honesty of the record. Personal-best comparisons count *actual completed days*
   (a 100-day run with one stumble counts 99). **The grace only engages once a run has begun** —
   a miss before the first completion is a no-op, or a fresh habit would silently burn a phantom
   lap.
2. **The ghost runner** — a translucent replay of the record run, in lockstep by scheduled-day
   index. It **stumbles where past-you stumbled** (the emotional core: on the day you fall, you
   have already watched your past self fall and get up on this same track). **Symbolic offset, not
   proportional distance** — a small fixed lead, no literal gap (a literal gap would leak the
   hidden streak number). If the current run is *cleaner*, the positions swap. **The overtake is
   the record moment** — the ghost steps off and applauds as you pass. **The fatal misses that
   ended the record run are never replayed** — the record is the completed days; the failure isn't
   part of the achievement. **Honest encouragement only:** the thought bubble may say "My best run
   had stumbles too" *iff* the record actually contains stumbles. Ties: replace the ghost with the
   more recent run. First-ever run: no ghost.
   *(Built as a static per-day dot comparison, not the full animation — flagged, not silently
   dropped. Upgrading it is a stretch goal, not a sprint requirement.)*
3. **Fresh-start restart.** A lapsed habit's page becomes a restart ritual, not a shame display:
   one tap, **"Start lap N."** Copy splits by *today's* day of week, not the lapse date:
   **Mon–Wed** → "Start next lap" / "Start fresh next time" (most of the week is ahead; no reason
   to defer). **Thu–Sun** → "Start fresh next week?" (a soft landmark without naming a weekday, so
   it doesn't misfire on schedules that exclude Monday). No frequency-based branching. Tapping
   always restarts immediately regardless of copy — the wording changes the framing, not the
   mechanics.
4. **The worn path.** The track accumulates lifetime completions: faint grass → dirt → gravel →
   proper track, with small details at higher totals. The environment *is* the metric: when a run
   ends, the runner may be down, but the path they built is visibly still there. Truest metaphor
   in the app: habits are worn paths.
5. **Lifetime total count** anchors the path's meaning, since the wear is slow and initially
   obscure.

### 4.12 Completed sections

- Completing an action or project moves it to a **Completed** section at the bottom of its lane,
  rather than vanishing.
- **Retention: keep everything forever, no automatic clearing.** Nothing purges on a timer or a
  count. *(Manual deletion exists — see 4.12b — which does not contradict this: "no automatic
  clearing" never prohibited deliberate destruction.)* Flagged for build, not design: an
  ever-growing section may eventually want collapsed-by-default or paginated rendering.
- **Recurring EVENTS collapse into one entry per series** with a completion count ("Pay rent ×6").
  *(Actions do not recur — §7, §4.15b. What archives is the completed occurrence of an event, via its
  pseudo-action.)* Un-completing rolls back the most recent occurrence and decrements the count —
  **and only within 10 minutes of the completion** (§4.15c, §7: the window governs, and "the most
  recent" is simply what the window can reach). **Needs a `seriesId` — see §3 known issue 3.**
- **Un-completion reversal cascade — RULED (§9):** un-completing an action pushes back the
  dependents its completion promoted **only within a 10-minute window** (`promotedBy` +
  `promotedAt`, checked lazily in `restoreTask`). Beyond that, the dependent stays in Next Actions.
  A dependent that has been edited since is still pushed back if it's inside the window.

### 4.12b Completed-items overhaul (spec'd in §12.2)

- **Deleting a completed project deletes its archived Waiting actions with it.** No prompt. The
  archive existed as a failsafe against accidental completion; once the project is deleted for
  good, there is nothing left to reopen against.
- **Un-completion forfeited on delete: acceptable loss.** Dependents already orphaned by the
  completion stay orphaned. *(Not a new failure mode — a live item's condition lookup only ever
  searches live lanes, so completion orphans dependents today; delete just removes the recovery
  path.)*
- **Clear-all trash can** at the top-right of the Completed section header, on Next/Waiting/
  Current/Future — **never on Habits** (its "Completed" section is today's toggles, not an
  archive; clear-all there has no sane meaning). Behind a confirm. **From chunk 7** (when recurring
  series and `seriesId` exist), a three-way dialog for recurring entries: "Delete all items" / "Only
  delete non-repeating items" / "Cancel." Chunk 4 ships the two-way confirm only.
- **Checkbox restore replaces the ↻ button** — the filled checkbox un-completes on tap, mirroring
  the habit lane, teaching the symmetry: the control that completed the item un-completes it.
- **Completed sections are COLLAPSED BY DEFAULT**, with the count in the header ("Completed (47)").
  This is also the whole answer to the unbounded-growth rendering worry — nothing renders until you
  open it.
- **Completed rows are tappable** and open the item's page, reading from the archive: fields
  **read-only**; convert buttons **greyed and inert**; Complete pill becomes **"↩ Restore"**; 🗑
  is a per-item delete behind a confirm.
- **The completed page has ← only — no ✕** (user ruling). With nothing editable, ← and ✕ would be
  the same gesture, and shipping both would be theatre. **Restore and 🗑 act immediately:** the
  completed page **is not a drafting surface**, which is the same reason the list checkbox acts
  immediately. This is not an exception to draft isolation — it is draft isolation applied
  correctly. Recorded so nobody "fixes" it later.
- **Gamification never couples to the archive** — ruled outright, not deferred.

### 4.13 Date semantics — three entities, two homes

**Status: RULED IN FULL (user, calendar planning round).** This section replaced the old
§4.13/§4.13b/§4.14/§4.15 outright. **Read §4.13's first two paragraphs before anything else in the
calendar chunk — the model changed, and most of what follows is a consequence of the change rather
than new design.**

**Before:** an event was a Waiting action whose "waiting for" was a date. It lived in the Waiting
lane, sorted to the top as its date approached, and hid from the lane when the date was far away.

**After: an event is a calendar entity. It never lives in a lane.** It is created in the calendar,
it lives in the calendar, and what appears in the lanes is a *view* of it — a bulleted list in a
widget at the top of Waiting, and then, on its day, a **pseudo-action** in Next Actions.

This is not a tweak. It deletes an entire class of problem the old model generated and that the
design conversation kept re-discovering: items disappearing from a list the user put them in, the
7-day hide rule, the hard-landscape pseudo-list, the drag-into-context fight, the
context-child-count trap (which re-opened the §7 EMERGENCY RULE bug through a side door), and the
stale-event hole (an untimed event, 8 days past, visible in no lane and surfaced by no review).
**None of those exist under the new model.** They were all artifacts of events being lane residents.

| Entity | What it is | Created where | Lives where | Recurs? | Progress bar |
|---|---|---|---|---|---|
| **Event** | Day-specific, **no time** | **Calendar only** | The calendar | ✅ | ✅ *(full on its day, then a passed chip — 4.4d)* |
| **Appointment** | An event **with a time**. *Not a separate type* — the time is the only difference | **Calendar only** | The calendar | ✅ | ✅ (4.14c) |
| **Deadline** | A date (optional time) by which something must be **done** | Next Action page, Current Project page, **or the calendar** (§4.15a) | It is a *field on* an action or project | ❌ | ✅ (4.4b/c) |

**The load-bearing sentence: dates are born in the calendar.** Deadlines are the one exception, and
they are not entities — they are a field on something that already exists.

**4.13a Waiting actions have no dates.** A Waiting action's "waiting for" is **free text or a hooked
condition** (§4.2). A date is not a way of waiting for something; it is a thing that happens.

**Consequence, stated so nobody re-derives it:** there is **no date-based auto-promotion** of Waiting
actions. Promotion happens on **condition completion only**. §9's case table lost two rows to this.
**The code still implements date-promotion until chunk 3 deletes it** (§2) — that is a removal task,
not behaviour to preserve.

**Second consequence — "Make Waiting" is disabled on a dated item (RULED, user, this round; chunk
3).** A Waiting action cannot hold a date, so converting a **dated Next Action** into one would have
to silently drop the date — a lie. Instead the **"Make Waiting" convert is disabled whenever a
deadline is set** on the Next Action page: greyed, inert, with a tooltip ("A waiting action can't
hold a date — clear the deadline first"). This is the same **show-but-disable** teaching pattern used
for §12.1's locked project-link field — the control stays visible and explains itself rather than
vanishing. *(This used to cite the greyed condition icon on Next Actions as the exemplar; that icon
was removed in chunk 2 — §4.2 — but the pattern it demonstrated still applies here.)* Scope is the
**Next Action page only** (Current/Future projects don't convert to actions). The `.disabled` state
already exists for the Complete-mutual-exclusion case; this adds a second reason. **The
pseudo-action's counterpart is an *absence*, not a disable** — pseudo-actions are edited through the
event page (§4.14, §4.15), which is not built from the action-page template and so carries no
"Make Waiting" control at all; that lands in chunk 7.
- **⚠ The disable tracks the DRAFT deadline, not the saved one.** The deadline field is draft-only and
  armed like everything else on the page (§4.6), so "Make Waiting" must grey/ungrey **live** as the
  user sets or clears the deadline in the open draft — keying it off the last *saved* value would leave
  the convert wrongly greyed after a draft clear (or wrongly enabled after a draft set) until Save.

### 4.13b The calendar's two entry points

1. **Header 📅**, top right, next to the settings menu.
2. **A widget at the top of the Waiting Actions lane** — roughly two rows high, **yellow border**,
   containing the calendar icon and a **bulleted list of upcoming events/appointments**. Tapping
   anywhere on it opens the calendar.

**The widget's contents.** Any event whose date falls within **7 days**, as of the 4 AM boundary.
Each bullet is **date/time + title**. Nothing more.

- The bullets are **not interactive, not draggable, not completable.** They are a reminder, not a
  list. *(This is why the old decluttering rule is gone: nothing is being hidden, because nothing was
  ever in the lane.)*
- The widget is why events "belong" in Waiting conceptually without living there. A busy week
  produces a longer widget, and that is correct.

### 4.14 The pseudo-action — an event that displays as an action

**At the 4 AM boundary of the app-day containing the event's timestamp, a pseudo-action is created
at the top of Next Actions.** It renders exactly like a Next Action with a deadline, and it behaves
like one everywhere a user can see.

- **It is draggable, droppable into a context, and completable** — like any other card. The type is
  an implementation fact, not a user-facing one. *("If it displays as a next action, let it behave
  like a next action where anyone can see." — user)*
- **It does not become an action.** It **migrates lanes without changing type**: it keeps its dot on
  the calendar (on its own day, which is the day you most want to see it), keeps its event fields
  set, and is edited through the event page. **Write this in these words** — it is the app's first
  and only type that changes lane without changing type, and a future session will otherwise "tidy"
  the type away on promotion.
- **On the card's detail view, the descriptor in front of the date/time reads "event" or
  "appointment" — never "deadline."**
- **It completes like a Next Action, and that includes the side effects** (RULED, where the spec was
  silent): completing it **promotes any Waiting action hooked to it**, exactly as completing an action
  does. "Displays as an action, behaves as an action" is the whole principle. *(There is no points
  question to answer — the points layer is deleted, §2.)*

**4.14a IT IS A REAL STORED ROW, NOT A RENDER-TIME PROJECTION.** ⚠ It is a row in `gtd_tasks_next`
holding a reference to its event/series by ID (`eventId`). It **must** be, because it holds state a
projection cannot: drag position, context, completion. *Build trap: implemented as a projection, the
user's drag position is silently lost at every 4 AM boundary.* Completing it writes back to the
event/series — it does not merely archive a card.

- **⚠ THE ID IS MINTED WHEN THE EVENT IS CREATED, NOT WHEN THE ROW APPEARS (RULED, this round).**
  The task ID is allocated on the **event record** at creation and the pseudo-action adopts it at 4
  AM — **the ID is minted early; the ROW is not.** Nothing is rendered, sorted, counted, or
  duplicate-checked before the boundary, and **nothing measures a progress bar from it** (§4.4d: an
  event's bar opens at the 4 AM appearance, never at the event's creation). §3's enumeration of
  `state.tasks.next` consumers is unaffected — there is no early row for them to see. **Why it is not
  a detail:** it is what lets a Waiting action hook its condition to an event
  *before its day* while storing **a plain task ID like any other condition** — which is the whole
  reason event-conditioning collapsed from a five-subsystem job to a two-part one and got scheduled
  (§10, chunk 8). Mint at first appearance instead and chunk 8 has to re-allocate the ID every
  condition reference in the app points at, on the far side of §1's migration boundary.
- **⚠ THE ROW'S ID IS STABLE ACROSS A ROLL (RULED, this round).** When a recurring series rolls
  (§4.15b) the pseudo-action is *replaced* — but the replacement **reuses the same task ID**. This is
  not an optimisation. A Waiting action may hook its condition to a live pseudo-action (§10, the
  cheap half of event-conditioning), and a condition reference is by ID: mint a new ID every cycle
  and every dependent silently orphans itself, every cycle, forever. Same ID, new occurrence.

**4.14b The app-day rule, and the one place it will look like a bug. ⚠**
The app has one clock: an app-day runs **4 AM → 4 AM** (§3). So the rule is simply: *the
pseudo-action appears at the start of the app-day containing the event's timestamp.* There is **no
"day before" special case** — an event at **2 AM Tuesday** falls inside the app-day that *began at
4 AM Monday*, and so it appears on Monday. That is the rule working, not an exception to it.

**But the calendar grid keys off the CIVIL date**, because a 2 AM Tuesday appointment must draw its
dot on Tuesday's cell — that is what a person means by Tuesday. **So for events between midnight and
4 AM, the grid and the promotion disagree by one square, deliberately.** Recorded here because it
will look like a bug to whoever finds it first.

**Test dependency:** this is **untestable with a day-granular offset.** Chunk 0c ships
`qaTimeOffset`, hour/minute-granular — see §12.3.

**4.14c The progress bar on a pseudo-action has a different origin than a deadline's.**
§4.4b measures a deadline's bar **from creation to due date**. Applied naively to an event created
six weeks ago, the bar arrives 98% full and red at birth — useless.

> **A pseudo-action's bar spans the pseudo-action's own window: from its 4 AM appearance to the
> appointment's time.** ~20–28 hours, straight linear (under 3 weeks, per §4.4b), red in the final
> 15%.

It is a *"how long until this happens"* bar, not a *"how long have you been procrastinating"* bar —
which is right, because **you cannot do an appointment early.**

**An untimed event's bar is FULL for the whole of its day (§4.4d — AMENDED, user ruling).** There is
no time to converge on, so there is nothing to count down: the bar arrives full at the 4 AM boundary
and stays full. *(This replaces the old rule — "an untimed event gets no bar at all and shows its
date in red" — which gave untimed things a second, private vocabulary for lateness. One display
language, §4.4d.)*

**Overdue — and the untimed case, RULED (amended this round, per §4.4d):**
- An **appointment** whose time passes uncompleted behaves like any Next Action: **full red bar plus
  the passed chip**, it stays in place, no auto-expiry (consistent with §7's *Dates* ruling).
- An **untimed event** has no time to pass, so it goes past-due at **the 4 AM boundary that ends its
  app-day** — i.e. from the moment its day is over. Its already-full bar goes **red and takes the
  passed chip**, the same chip a deadline gets. It stays in place; nothing auto-expires.
- **Either way the review (§4.8b) catches it** as a past-due open loop. This is what closes the old
  stale-event hole, and it is closed by the model, not by a patch: every dated thing reaches Next
  Actions on its day, so nothing dated can go stale outside the review's reach.

### 4.15 The calendar view

Full screen. **Two tabs at the top: Month · Day.** Tapping Day shows the day currently highlighted in
the month grid.

**Month view.**
- Compact day cells. **Marks: shape carries the kind, colour carries the owner.**

  | Mark | Meaning |
  |---|---|
  | **Yellow dot** | Appointment (event **with** a time) |
  | **White dot** | Event (**no** time) |
  | **Red line** | Deadline on a **Next Action** |
  | **Green line** | Deadline on a **Current Project** |
  | dimmed / hollow | A **projected** future occurrence of a recurring event (§4.15b) |

  At a glance a cell says *how many things happen* vs *how many things are due*, before a single
  colour is read.
- **Maximum three marks per cell**, then a **`+` overflow icon**. Priority order when truncating:
  **appointments → deadlines → events → projected recurrences.**
- Selected day highlighted in brass. Today keyed to the **app-day** (§4.14b).

**Day view.** Everything on that day, no truncation: events, appointments, and deadlines.

**Tapping an existing item opens its real page** — the event page, the action's page, or the
project's page, in whichever lane it currently lives. *(The read-only peek popup was considered and
**rejected by the user**. Do not re-propose it.)*

**4.15a The creation row (bottom of the calendar, both tabs).**

A single inline row anchored to the **selected day**, working exactly like the existing quick-add rows
for lists and contexts: **a name text box + an `Add` button.** Above it, two segmented toggles —
**Event · Deadline** — which swap the controls rendered beneath:

| Toggle | Controls |
|---|---|
| **Event** | **Time** (optional — *supplying it is what makes it an appointment*), description, **recurrence** |
| **Deadline** | **Time** (optional — §4.4; an untimed deadline is due *on the day*, §4.4d), description, **action-or-project** toggle. **No recurrence.** |

- One row, one state variable, no navigation, no dialog, no second tab bar. *(Rejected: separate
  creation tabs — a second tab bar at the bottom of a screen that already has one at the top.)*
- **These are quick-add rows and inherit the quick-add rulings**: the duplicate-title check (**flash
  the border red, keep the typed text** — §7, and see §7 for the *scope* an event's check runs
  against, which is not obvious) and the dashed-outline-on-empty-title validation. They are not an
  exception.
- **A deadline created here creates a Next Action or a Current Project due that day** — per the
  toggle. It does not create a third thing. *(Consequence, ruled rather than discovered: a project
  created this way has no linked actions, so it is **stalled by definition** and appears in the next
  review (§4.8b). That is correct — it is a project you have dated and not yet planned — and it is
  recorded here because it will otherwise be reported as a bug.)*
- **The calendar has NO `+` badge.** This row is the creation affordance (§4.3e).
- **Context is not on this row.** It is edit-only, from the event page. Fast capture stays fast.

**4.15b Recurring events — the one-live-entity model.**

**There is no spawning.** A series is **one live event that rolls forward.** Everything the user sees
beyond the current occurrence is a **projection from the rule, never stored.**

- **The next occurrence goes live** either when the current one's date/time **passes**, or **10
  minutes after its pseudo-action is completed** (§4.15c).
- **The pseudo-action of a completed-or-passed occurrence sits in Next Actions until it is
  bumped/replaced at the 4 AM boundary of the next occurrence's app-day.** ⚠ **An uncompleted
  pseudo-action is REPLACED, not accumulated** — a series never has two live pseudo-actions. **The
  replacement keeps the same task ID (§4.14a).**
- **On roll, the new pseudo-action inherits the previous one's context** and lands at the **top of
  that context** (not at a remembered index — indices are fragile and nobody remembers row 4 of
  anything). *A recurring event that forgets its filing every month makes the user re-file it every
  month.* **[user ruling]** *(If that context was deleted meanwhile, the inherited `parent` no longer
  resolves: null it and land the item at the top of the lane — the §7 EMERGENCY RULE, applied to a
  third surface. Do not invent a second behaviour.)*
- **Pause.** A paused series stops rolling and stops projecting. **It lives on the event page, so it
  is draft-only and armed, applied at Save** — Pause is the control the **golden rule's origin
  specimen** was about (`CLAUDE.md`: the *habit* pause — pause, complete, advance the day), and it
  gets no second chance to act on tap. *(The specimen is the habit case; this is its sibling. Stated
  precisely because the golden rule's authority rests on that story being told accurately.)*
- **Delete on a recurring event prompts: Skip this one · Delete series · Cancel.** *("Skip this one"
  = advance to the next occurrence. Relabelled from the old "Delete event / Delete series", which was
  ambiguous about whether next month still came.)*
- **What these do to a Waiting action hooked on the series (RULED, user, this round; chunk 8).** A
  condition reference is a **stable task ID** (§4.14a), so the default is *re-target, not orphan*:
  - **Skip this one → no orphan.** The series advances keeping the same task ID; the dependent simply
    now waits on the next occurrence (§10's "promote on the first occurrence after the hook is set").
    Orphaning here would contradict the stable-ID model.
  - **Delete series → orphan.** The target ID is genuinely gone; the dependent orphans through the
    existing dead-target machinery (frozen label, dashed pill), and per §9 an orphaned condition
    still satisfies the waiting-for requirement, so it saves cleanly.
  - **Pause → orphan, reversibly. ⚑ Optional/flagged.** A paused series will not fire, so a dependent
    waiting on it is stuck; showing it orphaned is honest. **But pause is reversible** (draft-only,
    armed), so this must be a **render-time soft-orphan that clears on unpause** — *not* the
    frozen-label kind, which would not un-freeze. It is a few lines in the same resolver chunk 8 is
    already teaching about `gtd_events`. Take it or leave it for the sprint.
  - **Uncompleted-bump → DEFERRED, see §10.** A dependent whose occurrence passed uncompleted before
    being replaced at the next 4 AM boundary: the user's instinct is to orphan it (the specific thing
    you were waiting on was missed), but the current model can't tell "wanted *that* occurrence" from
    "wants *any* occurrence" without adding per-dependent occurrence-binding — the very cost §10
    costed away. It may also be redundant with the missed occurrence's own past-due review card
    (§4.14c). **Recorded as an open question (§10), revisited during real use; not built.**
- **`seriesId` is still required** — for collapsing archived completions ("Pay rent ×6") — but it no
  longer has to survive across spawned tasks. It is a field on one event and its archive entries
  (§3, known issue 3).
- **The "make this a habit?" bubble on daily/weekly recurrence is now load-bearing, not a nicety.**
  It is what keeps the calendar from filling with chores. Describe it that way. *(It lives on the
  event page and the calendar creation row — **not** on the deadline picker, where the current build
  wrongly puts it. Chunk 3 deletes it from there; chunk 7 rebuilds it here.)*

**4.15c Un-complete × a series — closed, and it needs LITTLE new machinery (but not none).**
A pseudo-action **cannot be revived beyond 10 minutes** after completion. Inside the window,
un-completing rolls the series back and the pseudo-action returns; outside it, the archive entry
stands and the series has moved on.

**This reuses the *pattern* ruled in §9 — a timestamp, evaluated lazily on read; no timer, no
background process.** ⚠ **But not the fields.** §9's `promotedBy`/`promotedAt` live on a *promoted
Waiting dependent* and are read inside `restoreTask`; a series rollback is a different question
answered the same way, and needs its own state on the event: **`completedAt` on the archive entry,
and the date the series rolled *from*** — enough to put the occurrence back. Roughly: two fields and
one lazily-evaluated check, the same shape as §9, **not literally §9's fields.** *(Corrected this
round: the patch as drafted said "nothing new to build," which would send a build session hunting for
`promotedAt` on an event and finding nothing.)*

**4.15d Projects × events.**
- An event **can link to a project**, from the **event page**. The reverse is not true: **the project
  page's quick-add creates actions only.** Dates are born in the calendar, on every surface. *(This
  also keeps Chunk B's staged-child-action machinery from having to learn about dates, which it
  should not.)*
- On the project page, a linked event **displays like an action** — the same displays-as-an-action
  principle, applied to a third surface. **A recurring event shows exactly one instance** (the live
  one); the rest are projections and do not appear.
- **Display order in the project's linked list:**
  1. **All dated items — events, appointments, and deadlined actions — sorted nearest to farthest.**
  2. Then undated: **next actions and their nested waiting actions**, then **unnested waiting
     actions.**

  *(Ruling: "dated" beats the grouping. A Next Action with a deadline is both a dated thing and a next
  action; the date wins. — user)*
- **Dependents show, even by dependency alone (RULED, user, this round; chunk 8).** A **waiting
  action hooked to a project-linked item** — including a project-linked **event/appointment** once
  event-conditioning exists (§10, chunk 8) — appears **nested beneath that item** in the list, the
  same indentation the linked-actions list already uses for in-project chains (§4.3). It shows even
  when its *only* tie to the project is the dependency (it carries no project link of its own): the
  thing you are waiting on is part of this project's plan, so the wait is too. **This needs no
  guardrail against masking a stalled project:** a dependent can only *appear* nested under an anchor
  the project already has, and any such anchor already makes the project non-stalled (§4.3b) — so
  there is no empty project for a stray hook to falsely revive.

**4.15e The "it moved" banner.** A save that moves an item **off the surface the user is currently
looking at** shows a brief confirmation ("Scheduled for 3 Aug — in your calendar"). It fires on the
tray review's **Calendar chip** (§4.8b) and on a reschedule that removes an item from the current
view. It does **not** fire when you are standing in the calendar and the thing appears in the calendar
— that would be narrating what the user's eyes are already doing.

**Build note (carried forward, unchanged):** native `<input type="date">` / `<input type="time">`
chrome defaults to a light OS picker on many platforms and clashes with the dark UI.
`color-scheme: dark` at minimum; a custom picker if that leaves platform gaps.

---

### 4.16 Seeded sample habits — the app teaches itself (user design)

**The idea:** rather than a tutorial, a tour, or instructional copy, the app ships with **three
default habits that are the GTD routine itself.** They are ordinary habits — editable, completable,
and **deletable** — so the app teaches without forcing, which is the capstone principle applied
exactly.

**The §6 two questions.** (1) *Purpose:* teach the GTD operating rhythm — capture daily, review
daily, review projects weekly — by *practising* it, not by describing it. (2) *What the UI teaches:*
the routine, the cue system, the schedule system, **and what a good answer to the identity prompt
looks like** — all by example, with nothing to read.

**The seed set:**

| Habit | Schedule | Cue | Description (models the identity prompt) |
|---|---|---|---|
| **Sort my tray** | Every day | *"When I sit down at my desk"* (text cue) | "Someone who doesn't carry their to-do list around in their head." |
| **Review my calendar and waiting actions** | Every day | **Hooked to "Sort my tray"** | "Someone who knows what's coming, instead of being surprised by it." |
| **Review my projects** | **Friday** *(adopted default, flagged — Sunday works too; it's one chip)* | *"After my Friday coffee"* (text cue) | "Someone who finishes what they start." |

**Why these three details are load-bearing, not decoration:**

- **The middle habit is HOOKED to the first.** This is a live, working demonstration of what the
  hook system is *for* — and it models the correct GTD order (capture, then review). One seeded hook
  teaches more about habit-stacking than any info text could.
- **Every habit needs a cue** (the at-least-one-cue validation would refuse to *create* a habit
  without one). So the seeds must carry cues — which turns a constraint into a demonstration of the
  hardest-to-explain field on the page.
- **The descriptions answer the identity placeholder** *("Who will I be if I build this habit?")*.
  Without them, the seed set would teach that habits are for app-maintenance chores, which cuts
  against the whole identity-anchoring rationale (4.5). With them, the seeds teach the *shape of a
  good answer* — the single hardest thing in the app to teach, taught by example rather than
  instruction.
- **Weekly means picking a day.** The schedule model is explicit: none highlighted = every day. GTD's
  canonical weekly review is Friday (close the week, leave the desk clear).

**Collision checked — and it is already closed by an existing fix.** A new user who *ignores* the
three samples might have been expected to accumulate stumbles, run-endings, phantom laps and
notification badges within days — a miserable first week. **This cannot happen**, because the mercy
engine treats a miss as a **no-op until the current attempt has logged at least one `done` day**
("you can't stumble before you've started running" — a fix originally made for the phantom-lap bug).
An ignored seeded habit is therefore completely **inert**: nothing recorded, nothing ended, no badge.
**Recorded here because a future session might 'optimise' that no-op away without realising what it
is holding up.**

**Build notes.**
- **Ships complete in chunk 7**, since the calendar habit references a feature that does not exist
  before then. The first two can be seeded earlier if convenient; the set is not *correct* until the
  calendar does.
- Seeded by `seedData()` alongside the existing sample tasks. **Reset re-seeds them** (same as the
  rest of the sample data) — a user who deletes them and later resets gets them back, which is right:
  Reset means "start fresh," and a fresh start includes the teaching.
- They are **ordinary habits in every respect** — no flags, no special-casing, no "sample" badge.
  A habit the user cannot fully own is a habit that forces behaviour.

---

## 5. Working process

The golden rule, draft isolation, the two design questions, and ask-for-an-example all live in
**`CLAUDE.md`** — they bind every session and are loaded automatically. This section holds only
what doesn't fit there.

**Sequencing:** design conversation first for anything architecturally ambiguous → lock the spec →
then build. Don't let implementation start before the shape is agreed.

**Task classification:**

| Type | Examples | Handling |
|---|---|---|
| Quick / mechanical | Spacing, wording, colors, icons | Just do it inline |
| Self-contained & fully spec'd | A feature talked through in detail first | One autonomous Claude Code pass |
| Architecturally ambiguous | Calendar, Intray, anything in §10 | Planning conversation *before* code |

**Where work happens.** Design conversations in the chat interface (heavier reasoning models earn
their keep here); builds in **Claude Code** against the repo, where the session can run the build,
run the Playwright harness, and iterate to green before handing back. Plan Mode is worth using for
anything chunk-sized. Quota is shared across both — sequence, don't parallelize.

**Git is the safety net that makes autonomy acceptable.** Commit at chunk boundaries at minimum.
A chunk that can't be reverted is a chunk that shouldn't have been written.

---

## 6. Decisions log

| Decision | Resolution |
|---|---|
| Google Tasks / Calendar integration | **Removed** (§1). Cross-device sync forfeited; export/import is the replacement |
| Existing app data | **All test data. Nothing is precious** (§1). Migrations optional until real use begins — which is **distribution, after chunk 9** (corrected round 2; the calendar, chunk 7, is a floor but not the switch-over point). Export/import (chunk 8) is the hard prerequisite before that day |
| Events, appointments, deadlines | **RULED — the model changed** (§4.13). An **event is a calendar entity that never lives in a lane**; it appears in Waiting as a *widget* and in Next Actions, on its day, as a **pseudo-action** (§4.14). **Dates are born in the calendar.** Deletes the 7-day hide rule, the hard-landscape pseudo-list, and the stale-event hole outright |
| Waiting actions × dates | **Waiting actions have NO dates** (§4.13a). "Waiting for" is free text or a hook. **There is no date-based promotion** — the only trigger is a completed condition. Code carries it until chunk 3 deletes it |
| Recurrence | **A property of EVENTS only** (§7, §4.15b). Not deadlines, not actions. **One live event that rolls forward** — no spawning; future occurrences are projections, never stored |
| Time on a deadline | **Optional** (§4.4, user, this round). With a time it counts down to the time; without one it is due **on the day**. Both are deadlines; only the display differs |
| Dated-item display | **One language for all four** (§4.4d, user, this round): a bar for every dated thing; **untimed things sit at a FULL bar all day** (the day *is* the deadline); when the moment passes — the time, or the 4 AM boundary ending the app-day — the bar goes red and takes a **"passed" chip**. **No "date in red" rendering anywhere** |
| Cross-device sync | **Direction adopted, built post-wrapper** (§10). Auto-export + **one-way mirror** through the user's own cloud storage (Drive `appDataFolder` / Dropbox). One-way because it sidesteps conflict resolution entirely. A browser cannot silently write files, so the sprint ships **manual** export/import (chunk 8) and the automatic version waits for the wrapper. Never ship a naive two-way blob sync |
| Staged edits vs. timers | **RULED (§9):** don't queue the promotion — **re-evaluate the item's condition against its final saved state at page exit.** Per-item, never global (freezing the sweep would stall every habit). Applies to any page *holding* the item, including a project page's staged children |
| Habit drafts across the day boundary | **Day-stamped** (§9): a drafted completion records the day it was armed for, so saving after a 4 AM rollover credits the day you actually did it |
| Multiple app instances | **Not engineered around** (§9). Accepted risk + a `storage`-event banner ("open in another window — reload"), because the failure would otherwise be silent |
| Back button / gesture | **= ✕ (cancel), never ← (save).** Routes through Chunk B's warning when anything is staged. Order: dialog → drawer → page → exit app at root (§4.6) |
| The Tray | **Two things.** (a) A left **drawer** for capture (chunk 6) — **auto-opens on launch, even when empty**, opens by tapping 📥, **never by an edge swipe** (that's Android's back gesture), no counter. (b) The **review** (its own chunk, §4.8b) — a redacted, one-at-a-time queue over *all* open loops |
| What counts as an open loop | Past-due dated items (top of the queue, revealed first) — **including overdue deadlines** (RULED, reversed; §4.8b) — captures, stalled projects, orphaned waiting actions. The past-due kind has **two shapes**: a **deadline** (decision menu — push the date / complete / delete / Not now; built in 6b) and a **pseudo-action** (checkbox; added in chunk 7). *(The old "overdue deadlines are late, not unresolved, so out of scope" ruling was reversed when §4.4d gave every dated thing one display language — §4.8b.)* |
| Review: redaction | **Redaction is a state, not a card type.** Unrevealed = redaction bar, **not tappable**. Revealed (always the top card) = its normal lane card, minus the checkbox |
| Review: decisions not execution | With **one exception** — the past-due card gets a checkbox, because for that card completion *is* the decision. It is also tappable, for a rescheduled appointment |
| Review: the escape hatch | **Decision menus, with "Not now" LAST.** A stalled project offers: add a next action ("What's the very next physical action?") / move to Someday/Maybe / complete / delete / *then* Not now. **Making the alternatives visible is the mechanism** — it reveals Not now as the one option that changes nothing |
| Review: cost of deferring | **No cap.** The cost is intrinsic: the review never reaches empty while anything is deferred. Deferral is **session-scoped**, clears at the 4 AM boundary. Two end states: empty (the reward), or "3 deferred" (honest). **No shame markers, ever** |
| Orphaned item placement | **Does not move.** (Supersedes an earlier drop-to-bottom ruling — the review is the better nag, and burying an item is a strange way to surface it) |
| Validation × Complete/Convert | Validation **never fires against a state the item is leaving** (§9). An armed Complete or Convert suppresses the waiting-for requirement |
| Orphaned condition | **Satisfies** the waiting-for requirement, and **the item does not move at all** (§9). *(Corrected: this row used to say it moved once to the bottom of the Waiting lane — that nag was superseded in the same session it was invented. The review is the nag.)* |
| Un-completion reversal | **10-minute window** via `promotedBy`/`promotedAt`, evaluated lazily in `restoreTask`. No timer, no sweep. Edited dependents are still pushed back inside the window (§9) |
| Deleting a Context with items in it | **Unlink** — Context goes, items survive ungrouped at the top of the lane, behind a confirm |
| Import | **Replaces**, never merges. Behind a confirm |
| Completed sections | **Collapsed by default**, count in the header |
| Completed item page | ← only (no ✕ — nothing to discard); Restore and 🗑 act immediately; **not a drafting surface** |
| Duplicate titles on quick-add rows | **Enforced** — flash the input border red, keep the typed text |
| Onboarding / tutorial | **None.** Instead, **three seeded sample habits** that *are* the GTD routine (§4.16) — deletable, ordinary, with cues, a demonstrated hook, and identity-framed descriptions. The app teaches itself by example |
| Waiting quick-add on the project page | The "+" becomes a **hook** (§12.1b). Quick-add can create a Waiting action **iff the trigger is a hook** — the only single-tap trigger. Free text goes through ✎. *(There is no date exit — waiting actions have no dates, §4.13a.)* |
| Empty pickers | **A teaching surface, not an error state.** The control is never greyed; the picker opens and its empty state names the way out. (Pattern already exists for habit hooks and conditions — reuse it) |
| Staged actions referencing each other | **Yes** — the project page is a planning surface. And it is nearly free: **staged actions get their real, final ID at stage time; there are no temp IDs and no remapping** (post-Google windfall). "Staged" means only *not yet written* |
| PWA identity | Name "GTD Console"; theme `#171513`; `standalone`; **portrait-locked** |
| Service worker | **Last chunk, deliberately.** Caching during active development means debugging stale builds. The manifest (installability) ships early in 0b; the cache does not |
| Calendar | **Core, not stretch** — a **floor** for real use, but not the switch-over: real daily use begins at **distribution, after chunk 9** (§1, corrected round 2) |
| Testers | Experienced programmers, receiving the **finished** product. No early-tester data to protect; no half-built releases |
| Build system | **Option B — "the stapler."** `src/` modules concatenated by `build.py` into one `dist/index.html`. No npm, no Node. Upgradeable to Vite later if the project outlives the sprint |
| Phone deployment | **PWA + GitHub Pages**, not a native wrapper. Wrapper is a stretch goal |
| iPhone app | **Not attempted** |
| Notes-marker encoding | Retire it with Google (§3) — plain fields on the task object. **No migration** (§1) |
| Task IDs across lane moves | **Preserve them** post-Google (§1) |
| UI-first vs backend-first | UI first — lock interaction patterns before deepening the data model |
| Page fields: labels | None. Placeholders carry the teaching |
| Help on edit pages | None. Exceptions: lane tabs and the intray get info buttons |
| Edit page exits | ← save+exit; ✕ cancel/discard; 🗑 delete (with confirm, immediate). **Two ruled exceptions:** the **Tags page** has no 🗑 (§4.9b — it is not an item; there is nothing to delete), and the **completed-item page** has no ✕ (§4.12b — nothing is editable, so ← and ✕ would be one gesture) |
| Complete / Convert | Both draft-only, armed, applied at Save; mutually exclusive in the UI |
| Validation feedback | Dashed outline on the field, cleared on next input. Never a popup |
| Native dialogs | Banned app-wide (silently blocked in sandboxed contexts). `openConfirmDialog` only |
| Waiting condition targets | Anything in the **Next Actions lane** — **pseudo-actions included** (§4.2, §4.14) — **or** another Waiting action; branching allowed. From chunk 8, also a **not-yet-live event** (§10) |
| Waiting promotion rule | Auto-move when a condition **that lives in the Next Actions lane** is completed. **⚠ The qualifier is the LANE, not the type** (§4.2) — a literal `type === 'next'` check silently refuses to promote anything hooked to an event |
| Next Actions with conditions | Never — no condition control on the Next Action page (§4.2; the greyed icon was removed, user round chunk 2) |
| Waiting creation requirement | Must specify what it's waiting for — **free text or a hook. That is the whole list** (§4.2, §4.13a). *(A date was struck this round; it was the last one left in this table.)* |
| Habit metric | Personal best + lifetime total. **Current streak never displayed** |
| Habit streak-break rule | **Never miss twice** — one miss is a stumble; two consecutive end the run |
| Habit rollover | 4:00 AM — **and everything else in the app uses the same boundary** |
| Contexts | GTD contexts (Calls/Computer/Errands), **shared Next↔Waiting** (§4.3d). **The project lanes keep plain lists; Habits have no context *grouping*** — but from chunk 3 a habit **can be cued by** a context (a context is a cue, not a grouping-for-habits; §4.3d/§4.5/§11), which counts against the hook caps (§7). **One registry, one set** — and the pseudo-action files into that same set, because it lives in the Next Actions lane (§4.14) |
| Project auto-lists | Removed |
| Completed items | Move to a Completed section; keep forever; manual delete behind a confirm |
| Completed-row restore | Filled checkbox un-completes (↻ removed) |
| Project completion | Completes linked Next Actions; **archives** linked Waiting actions (recoverable) |
| Deleting a completed project | Deletes its archived Waiting actions too |
| Data destruction | Possible, never accidental: confirm dialogs always. **App-wide destruction (Clear all app data) lives in the settings surface — chunk 6, not the wrapper.** The **lane-scoped** Completed trash can stays in the Completed header (§4.12b) |
| Gamification | **Parked** for the sprint. Never couples to the Completed archive |
| The points layer | **DELETED** (§2, chunk 0a). It existed only as substrate for the parked gamification layer; without that, it is a number attached to nothing. Deleted, not hidden — and **not** a hook for a future session to build on |
| QA checklist | Every chunk injects one into Next Actions; replace, never accumulate (§8.1) |

---

## 7. Edge-case rulings

**Waiting conditions & promotion**
- Condition action deleted → the dependent keeps an **orphaned pill** with a dashed warning
  outline; the label is frozen at the target's last title before deletion.
- No cycles among Waiting conditions — the picker filters to valid targets.
- Converting a condition Next Action to Waiting is allowed; dependents now point at a Waiting item,
  per chain rules.
- The project-Complete cascade **does** auto-promote unrelated Waiting items that were waiting on a
  completed action. Ripple outside the project is accepted.
- Free-text "waiting for" items never auto-promote — manual arrow only.
- Event/appointment boundaries crossed while the app is closed (pseudo-action creation, series
  rolls): processed on next open, mirroring `processHabitBoundaries()`. **At the wrapper, this must
  also fire on resume** (§3).

**Recurring EVENTS** (chunk 7) — *rewritten this round around rolling, not spawning*
- **Recurrence is a property of EVENTS ONLY.** Deadlines cannot recur; waiting actions have no dates
  (§4.13a); actions do not recur. *"Recurring actions cycle between Waiting and Next" is **dead**,
  and so is spawning — see §4.15b's one-live-entity model.*
- Recurrence is set on the event page and on the calendar creation row. Options: daily, weekly,
  monthly, yearly (fixed schedule only; relative-to-completion deferred).
- Setting **daily or weekly** recurrence on an *event* shows the suggestion bubble: "Do you want to
  make this a habit?" — **load-bearing, not a nicety** (§4.15b): it is what keeps the calendar from
  filling with chores.
- Delete on a recurring event prompts: **Skip this one · Delete series · Cancel.**
- A series is **one live event that rolls forward**; its pseudo-action is **replaced, never
  accumulated**, and **keeps its task ID** across the roll (§4.14a).

**Completed section**
- Un-complete is allowed, but only **one instance** per recurring series (the most recent); the count
  decrements. **And only within 10 minutes of the completion** (§4.15c) — past that, the archive entry
  stands and the series has moved on. *(Reconciled this round: this bullet and §4.15c were two rules
  for one question. The 10-minute window governs; "the most recent" is what the window can reach.)*
- **EMERGENCY RULE — restoration with dangling references.** When a restored item's structural
  reference no longer resolves, the item must still land **visibly**: a dead `parent` (its Context
  was deleted while the item sat in Completed) is **cleared, and the item renders at the top of the
  lane**. A dead `linkedProjectId` is **unlinked**. Condition references are left to the orphan-pill
  handling, which already degrades gracefully. Applies to `restoreTask` **and**
  `restoreArchivedWaitingForProject`.
  *Origin bug:* complete a Context's only item → the Context now counts zero **live** children, so
  it becomes deletable → delete it → restore the item → **it disappears entirely** (still stored —
  the lane count even included it — but rendered under a group ID that no longer exists).

**Habits**
- Pause persists until manually unpaused. Paused days are neither completions nor misses.
- Day-of-week runs count consecutive **scheduled** days; off-days neither help nor hurt. Changing
  the schedule mid-run just continues under the new schedule (ghost replay is by scheduled-day
  index, so it's schedule-change-proof).
- **Streak-end result** (shown once, on viewing the habit, which clears the tab's badge): new
  record → celebration + "New personal best." Tie → celebration + "Tie," and the ghost is replaced
  with the **more recent** of the tied runs. Short of the record → the fresh-start restart ritual.
- **Hook caps: 7 outgoing, 7 incoming.** With seven weekdays, one live anchor per day is all the
  coverage a cue set can ever need — so an 8th is safely blockable in both directions.
  - **The 7-outgoing cap already covers context-cues (RULED, user).** A context added as a habit's cue
    (chunk 3, §4.3d/§4.5) consumes an **outgoing** slot exactly like a habit-cue does — there is no
    separate budget. This is not a new rule; it is how the Habit card already implements the outgoing
    limit (the cap counts *cues on the card*, whatever they point at), so context-cues fall under it for
    free. A habit therefore has **at most 7 cues total**, in any mix of habits, contexts, and text cues.
  - **A context accepts at most 7 incoming hooks (RULED, user — the natural extension of the cap).**
    Nothing hooks *out* of a context (it has no cues of its own), but habits hook *into* it as a cue
    target, and that incoming edge obeys the same 7-incoming ceiling every hook target has. The picker
    blocks an 8th habit from cueing on a context that already has seven.
- **Cycle rule:** the hook picker blocks **self and direct mutuals only.** Longer cycles are
  allowed — a full-graph cycle can be a coherent *rotating weekly routine* (A{Mon,Tue};
  B{Tue,Wed}→A; C{Wed,Mon}→B; A→C — each day's live sub-graph is a clean chain). A mutual pair
  X⇄T is provably never coherent: X→T mattering requires a shared scheduled day, which is the
  identical condition for T→X mattering, so a mutual edge is either same-day-circular or entirely
  pointless. Every graph consumer keeps a visited-set guard regardless.

**Titles**
- **Duplicate titles are blocked per-lane, case-insensitive** — because hook and condition labels are
  *frozen copies* of a title, so two items called "Stretch" make a frozen label ambiguous, and the
  Tidy sort has no stable key.
- **⚠ EVENTS ARE NOT IN A LANE, SO "per-lane" DOES NOT DEFINE THEIR SCOPE. RULED (this round):
  an event's title is checked against `gtd_events` AND the Next Actions lane.** The reason is not
  tidiness — it is that on its day the event lands **in Next Actions** as a pseudo-action (§4.14), so
  an event titled "Dentist" created while a Next Action "Dentist" exists mints, at 4 AM, exactly the
  duplicate the per-lane rule forbids, **through a boundary sweep no save-time check can intercept.**
  Check at creation, where prevention is free (§4.9b's *prevent where it is cheap* principle), because
  at 4 AM there is nobody to tell.
- **RULING — the quick-add rows must enforce it too** (chunk 3 — still 3 after the resequence). They currently bypass the check
  entirely, because they were built with no channel for the dashed-outline error — so the *fast*
  path can create exactly the duplicates the *slow* path forbids. Fix: **flash the input's border
  red and keep the typed text**, so the user edits and presses Enter again. No popup. *(Some
  quick-add rows may disappear in the chunk 2 redesign; the rule applies to whichever survive.)*

**Projects**
- **Actions cannot link to Future projects** — a project with a live action is by definition
  current. Future projects are excluded from the link-project picker.
- **Current → Future demotion is allowed, with a prompt:** "Future projects can't have linked
  actions. Do you want to unlink your actions or delete them?" (Unlink / Delete / Cancel.) Under
  draft isolation this fires **at Save**, not on tap; Cancel leaves the page open with the convert
  still armed.
- Deleting a project prompts: "Delete linked actions too" / "Keep actions (unlink them)."

**Dates** — *the display language is §4.4d; this is the edge-case reading of it*
- Overdue deadline: bar **full and red, with the passed chip at its end**; the item stays in place.
  Same for appointments whose time passes uncompleted in Next Actions.
- **An untimed thing** — a dateless-time deadline or an untimed event — carries a **full bar through
  its whole day** (§4.4d), and goes past-due at the **4 AM boundary that ends its app-day**: the bar
  goes red and takes the **same passed chip**. The review (§4.8b) picks it up like any other past-due
  item. Nothing auto-expires, ever.
- **There is no "date in red" rendering anywhere.** *(Deleted this round — it was the untimed
  entities' private way of saying "late," and §4.4d gives them the app's shared one.)*

---

## 8. QA and handoff

**Instruction template for a build session:** *"Implement chunk N from `docs/spec.md` §2. Follow
`CLAUDE.md`. Don't redesign anything; where the spec is silent, choose the simplest option and flag
it. Run the harness and the syntax check before handing back."*

### 8.1 Standing instruction: the self-QA checklist

Every chunk build ends by injecting a manual-test checklist into the Next Actions lane, so testing
happens inside the app itself. This is automatic — it does not need to be asked for.

- **Replace, don't accumulate.** Swap out the previous chunk's content *and* its flag key
  (`gtd_qa_checklist_chunkN` → `chunkN+1`) so the new one fires on next load.
- **Two Context groups** pushed into `state.tasks.next` as real leaf items: **"✅ QA — Chunk N"**
  (one item per testable behavior: new surfaces, new logic branches, and the §7 edge cases the
  chunk touches — title = short summary, `notesClean` = the actual steps to try) and **"✅ QA —
  Recheck chunk N−1"** (a shorter list of things easy to have missed, especially anything not
  exercised while testing the new chunk).
- **Runs once per chunk**, flag-guarded, whether or not the data was freshly seeded.
- **It must survive "Reset local data"** — the reset handler clears any `gtd_qa_checklist*` key
  along with the data, so the checklist re-injects with the fresh data rather than being erased.
- **Self-contained:** the injector only ever pushes plain Next Action items and is referenced by
  nothing else, so it's trivially deletable.

### 8.2 Standing instruction: the chunk map

**Every build session also refreshes the chunk map** — one **Current Project per chunk** (§2),
title = the chunk, notes = what to expect in it. Like the QA checklist, this is automatic and does
not need to be asked for. Its purpose is that the plan changes faster than anyone can hold it in
their head: the map is how the author knows what is in what chunk *while testing inside the app*,
and it doubles as a real workout for the Current Projects lane.

- **Same mechanics as §8.1:** flag-guarded (`gtd_chunk_map_vN`), **replace don't accumulate** —
  sweep the previous map's group and its children out of the active lane before injecting, bump the
  flag when §2 changes, and clear the flag on Reset so the map re-injects with fresh data.
- **Injected as one group** ("Sprint chunks") holding one leaf project per chunk, ordered as §2
  orders them. Unlinked, so every one shows the "no linked actions" flag — expected, and useful.
- **Regenerate the wording from §2 each time; don't preserve the previous session's phrasing.** The
  map is a *derived view of the plan*, not a document in its own right. If §2 and the map disagree,
  §2 wins and the map is stale by definition. Write for someone who does not already know the
  codebase: a chunk described only by the identifier it deletes (`state.returnScreen`) teaches
  nothing — say what changes for the user.
- **Dev-only, stripped at the wrapper**, same as the QA day-jump button and the checklist injector.
  Self-contained and referenced by nothing else, so it is trivially deletable.
- **Where it lives:** today, directly in the single-file build. **From chunk 0b it must land in
  `src/` as its own module**, or the stapler will drop it.

**Automated harness.** Playwright/Chromium end-to-end suites live in `tests/`. They are the
certification tool for refactors (chunk 0b's mandate is *zero behavior change*, and this is how
that claim gets made). **A red test is a claim about the harness plus the app — audit the harness
first.** (Precedent: two suites went red once because the container clock crossed midnight UTC and
the app's day boundary is 4am; the harness now derives the day from the same boundary the app uses.)

---

## 9. RULING — staged edits vs. state that moves on a timer

**Status: DECIDED (user ruling, sprint planning round). This unblocks chunk 5.** Recorded in full
because the same shape recurs for every future feature that mutates state on a timer or at a
boundary.

**The problem.** A Waiting action can be auto-promoted (its condition target got completed) *while* a
drafting page holds an edit to that same action. The page's save would then write the stale record
over the promotion. *(Promotion used to have a second trigger — a date arriving at the 4 AM boundary.
**That trigger is deleted** (§4.13a): waiting actions have no dates. The ruling below is unchanged;
it simply now has one trigger to re-evaluate instead of two.)* Chunk B's staging narrows the
exposure — only items the user actually touched are at risk — but does not close it.

### The rule

**Do not queue the promotion. Discard it, and re-evaluate the item's promotion condition against
its final saved state at the moment the page closes.**

This is deliberately *not* "defer the timer." The distinction matters and the wrong phrasing
invites the wrong implementation:

> **Everything processes normally, except mutations targeting an item that an open draft is
> holding.** Those are dropped, and the affected item's promotion condition is re-evaluated when
> the draft closes.

The boundary sweep is **global** — it walks every habit and every dated item. Freezing *the sweep*
while a page is open would mean that leaving one habit page open on a phone for three days stops
the run engine for **all** habits: no stumbles, no run endings, nothing processed. The deferral is
**per-item**, never global.

**Why re-evaluation beats queuing.** A queued promotion can fire against an item that no longer
justifies it (the user changed the date, or removed the condition). Re-evaluation is stateless: ask
"does this item, as it now stands, meet its promotion condition?" and act on the answer. The
original firing event is just a hint that something might have changed. This also makes
double-promotion structurally impossible rather than something to guard against.

**Ordering:** re-evaluation runs **after** the staged edits land, never before — the same ordering
rule as armed Complete and armed Convert.

### The exhaustive case table

Given: a promotion fires for a Waiting action whose drafting page is open.

| The user, on the open page… | Result |
|---|---|
| **Saves** | Edits land → re-evaluate → **promotes** |
| **Cancels (✕)** | Nothing changed → re-evaluate → **promotes** |
| **Manually promotes** (arrow, or "Make Next Action") | Already in Next; condition is moot → **nothing to do** |
| **Completes it** | Archived, not in any lane → **nothing to do** |
| **Removes or repoints the condition** | Re-evaluate → no qualifying condition → **stays in Waiting**. *(This is the branch most likely to be skipped: it is easy to implement "re-evaluate" as "check whether the condition completed" and never handle the condition being **taken away** on the open page.)* |
| ~~**Changes the date to the past / to the future**~~ | **DELETED (calendar round).** There is no date-based promotion — §4.13a. Two rows removed, not one; the code carries them until chunk 3 deletes it, and chunk 5 must not build staging support for them. |
| **Deletes it (🗑)** | 🗑 is the one immediate-action control (§6) — the item is gone *before* the exit hook exists. Nothing to re-evaluate; the promotion evaporates. **The one path where the at-exit hook never runs — say so explicitly in code, so it reads as a ruling and not an oversight.** |

**§9 also governs the pseudo-action's event page** (chunk 7). An event page open across a 4 AM
boundary or a series roll is the same shape of problem, and gets the same answer: nothing happens
while the page is open; everything re-evaluates from saved state on exit. Nothing new to rule.

### Scope: it is keyed to the page holding the item, not the item's own page

The deferral applies to **any open drafting page that holds this item** — which, under Chunk B
(§12.1), includes a **project page holding a staged edit** to one of its linked actions. The project's
save applies its staged child edits first, then re-evaluates the promotion condition of **every
touched item**, not just the project's own.

**⚠ Build trap — staged deletes and edits must resolve by ID, across lanes.** Concretely: from the
project page, stage a delete of a Waiting action; its condition completes and it promotes to Next
Actions; the project saves and applies the staged delete **against the Waiting lane, where it no
longer is.** The delete silently no-ops and the item lives on as a zombie in Next Actions. Staged
operations must therefore find their target **by ID wherever it currently lives**, never by the lane
it occupied when it was staged. This will pass every test that doesn't specifically try it.

### Sibling ruling — habits: the draft must be day-stamped

The same re-evaluation rule applies to habits (nothing happens while the page is open; everything
recalculates from the saved state on exit) **with one addition, because a habit draft is not
stateless the way a promotion condition is.**

A habit's drafted `done` is an **intent tied to a specific day.** Tick Complete on Tuesday night,
leave the page open, save on Wednesday morning after the 4 AM rollover — and naive re-evaluation
writes the completion to **Wednesday**. Tuesday becomes a miss and Wednesday is falsely credited.
Re-evaluation cannot fix this, because the draft carries a fact about a day that has passed, not a
condition to re-check.

**Ruling: the draft records the day it was completing** (`done: "2026-07-12"`, not `done: true`).
At save, if the boundary has rolled, the completion lands on **the day it was armed for.** You *did*
the habit on Tuesday; saving is bookkeeping, not the act. The same applies to a drafted pause —
pausing "today" means the day the toggle was tapped.

**Reachability:** this is currently unreachable, because boundary processing is boot-only and a
browser tab cannot cross 4 AM with a page open. It becomes reachable **in the wrapper**, where the
app is resident for days. *(Which also exposes a latent bug in its own right: a tab left open for
three days does not sweep at all today. Nobody does that in a browser; everybody does it in an app.)*

### Sibling ruling — validation must not fire against a state the item is leaving

**Two user-reported problems, run through the golden rule and classified as ONE design error, not
two bugs.** (1) Completing a Waiting action from its drafting page still demands something in the
"waiting for" box. (2) Arming "Make Next Action" does the same.

**The diagnosis:** the rule *"a Waiting action cannot exist without a waiting-for"* is a rule about
**waiting actions**. An item being archived will not be one. An item being converted to a Next
Action will not be one. The validation was enforcing an invariant on a state the item is about to
leave.

**RULING: the waiting-for validation does not fire when Complete or Convert is armed.** Generalize
it — **no field validation should block a save that is about to remove the item from the state that
field belongs to.** Any future validation inherits this by default.

### Sibling ruling — an orphaned condition satisfies the waiting-for requirement

**The case:** a Waiting item's condition target is deleted. The condition pill goes orphaned (frozen
label, dashed outline). Today the item then behaves as if it has *no* waiting-for at all, so an
unrelated edit can't be saved without retyping one.

**RULING: an orphaned condition satisfies the requirement.** The user *did* specify what they were
waiting for; the target's deletion is a data-integrity fact the orphan pill already communicates
loudly. Forcing a retype punishes the user for something the app did.

**~~The item moves to the bottom of the Waiting lane~~ — SUPERSEDED, same session.** That was
invented as a nag mechanism minutes before the review (§4.8b) was designed, and the review is a
strictly better nag: it surfaces every orphan in a queue you cannot skip past. Two nags for one
problem, one of which fights manual drag order and *buries* the thing it is trying to surface.

**RULING: an orphaned item does not move at all.** It stays exactly where the user put it. The
orphan pill flags it in the lane; the review catches it for triage. One mechanism, not two.

### Sibling ruling — un-completion reversal: a timestamp, not a timer

**The problem** (§10's recorded divergence, now closed): the spec says un-completing an action should
force back into Waiting any dependents its completion promoted. `restoreTask` never did this. The
question was whether it should.

**RULING: reverse the promotion only if the un-completion happens within 10 minutes.** The failure
this protects against is a mistap while scrolling — noticed within seconds or not at all. Beyond that
window, a promoted dependent has had a life of its own, possibly for weeks, and yanking it back to
Waiting would be the app overriding the user's more recent reality with an inference.

**Mechanism — no timer, no background process, no interaction with the §9 deferral rules.** A promoted
dependent records **`promotedBy: <taskId>`** and **`promotedAt: <timestamp>`**. `restoreTask` asks,
lazily and only at the moment anyone cares: *does any live Next Action say it was promoted by this
item, within the last 10 minutes?* If yes, push it back to Waiting. If no, leave it alone. Two fields
and one check; the "expiry" is evaluated on read, never fired.

**Explicitly ruled, so it isn't guessed:** if the promoted dependent has been **edited** since, it is
**still pushed back** — its edits survive, only its lane changes. Simpler rule, and within 10 minutes
it cannot be surprising. *(Accepted, minor: a user who edits a just-promoted action may see it move.
Narrow window, rare case.)*

### Multiple instances — accepted risk, with a smoke alarm

**User ruling: not engineered around.** Full multi-instance coherence is a large amount of work for
a rare case in a personal app, and "don't do that" is a legitimate answer.

**Two things it is worth being honest about.** It is more likely than it sounds — as a PWA, an
*installed* instance and a *browser tab* on the same origin are two instances, and the author will
hit this during development. And the failure mode is **silent**: two instances, both holding state in
memory, and whoever saves last wipes the other's work with no error shown.

**Adopted mitigation (cheap, ~10 lines, not sync):** listen for the browser's `storage` event, which
fires in *other* instances when one writes. On receipt, show a banner — *"This app is open in another
window. Reload to see the latest."* This does not fix the problem; it refuses to lose data
**silently**, which is the standard applied everywhere else in this app.

---

## 10. Open questions

- ~~**Un-completion reversal cascade is not implemented**~~ **CLOSED** — ruled in §9 (10-minute
  `promotedBy`/`promotedAt` window, evaluated lazily in `restoreTask`).

- ~~**Conditioning a Waiting action on an event/appointment — DEFERRED**~~ **CLOSED — RE-COSTED AND
  SCHEDULED (user ruling, this round). It ships in CHUNK 8.** *("Call the dentist after the
  appointment.")* **The old five-subsystem estimate is dead. It was computed before the
  pseudo-action had a structure, and the structure makes four of the five costs vanish.**
  - **The cheap half already works, free:** on its day the event **is** a Next Action-shaped card
    (§4.14), and the existing condition mechanics hook onto it with no new code. **This is why the
    pseudo-action's task ID must be stable across a roll (§4.14a)** — otherwise the free half
    silently orphans its dependents every cycle.
  - **What was cut is hooking onto it *in advance*** — before the pseudo-action exists. The old
    estimate assumed that required the `condition` reference to become **two-kinded** (task *or*
    event/series), touching five places: the picker, the promotion evaluator, the orphan pill, §9's
    re-evaluation, and the archive.
  - **⚠ THE TWO-KINDED REFERENCE IS UNNECESSARY. The ID can be minted early.** §4.14a already rules
    the pseudo-action's task ID is **stable across every roll** — one series, one task ID, forever. If
    the ID is stable, nothing requires it to be *allocated at first appearance*. **Allocate it when
    the event is created** (chunk 7; its home is the event record). The row simply isn't in the lane
    yet. A hook-in-advance then stores **a plain task ID, like every other condition** — and the
    evaluator, the archive, and §9's re-evaluation **never learn events exist**, because they are
    looking at a task ID and do not care what minted it.
  - **What is genuinely left — two things, and they are chunk 8's whole scope for this:** (1) **the
    picker gains a section** for not-yet-live events, filtered to **live** occurrences only, never
    expired ones; (2) **condition resolution must stop reading a pending pseudo-action as an
    orphan** — a lookup searches live lanes today, so a hook to Tuesday's event wears the dashed
    orphan pill until Tuesday's 4 AM. Cosmetic (§9 already rules an orphaned condition satisfies the
    waiting-for requirement, so nothing *breaks*) but visibly wrong, and it is the one place that has
    to know `gtd_events` exists.
  - **~~And it re-introduces date-driven promotion through a side door~~ — RETIRED, this round. It
    does not.** Promotion fires when the pseudo-action is **completed** — a user tick, not a clock
    event. No date drives anything. That objection would bite only if promotion fired on
    *occurrence*, which nobody proposed. *(Recorded because it is the objection a future session will
    re-derive and re-lose the feature to.)*
  - **The undesigned corner, recorded so it isn't re-derived:** hooking to a *recurring* event means
    promoting on **the first occurrence after the hook is set** — coherent, but it must be said, and
    now it is.
  - **⏳ OPEN, deferred to real use (user, this round): should an *uncompleted bump* orphan the
    dependent?** When a recurring occurrence passes uncompleted and is replaced at the next 4 AM
    boundary (§4.15b), the same task ID rolls forward, so today the dependent silently re-targets the
    next occurrence. The question is whether a *missed* occurrence should instead orphan the dependent
    — surfacing "the thing you were waiting on didn't happen" rather than quietly rolling it. **Cost:
    real.** The dependent stores only a stable ID, with no memory of *which* occurrence it wanted, so
    orphaning-on-miss needs **per-dependent occurrence-binding** — which reaches back into the picker,
    the roll logic (chunk 7), the resolver, §9's re-evaluation, and the archive/export, i.e. roughly
    the five-subsystem job this entry was proud of costing *down* to two. **Possibly redundant:** the
    missed occurrence already surfaces on its own as a past-due open loop in the review (§4.14c),
    which may discharge the app's duty to surface without touching the dependent at all. **Ruling:
    do not build it in the sprint.** Revisit only after the calendar ships and the author has lived
    with recurring events (post-chunk-9), when it will be clear whether rolling-forward or
    orphaning-on-miss is what real use actually wants. *(Skip and delete-series are **not** open —
    they are ruled in §4.15b: re-target and orphan respectively.)*
  - **Why chunk 8 and not chunk 7, where it thematically belongs:** chunk 7 is already the largest
    chunk on the board and this is the first thing that would be cut from it. Chunk 8 is small, it is
    strictly downstream of every dependency, and it is the only chunk with room. **The theme is
    wrong; the schedule is right.** *(Not verified against the code: this assumes task IDs are
    globally unique and that nothing enumerates `gtd_tasks_next` assuming every row renders. §1's
    ID-preservation ruling implies the first; the second is a build-session check.)*

- **Run-history durability.** Habit runs, personal bests, and lifetime totals live only in
  localStorage — evictable, clearable, stranded on a device switch. This is the irreplaceable
  class: earned history isn't retypeable. **Answered by export/import — which is now chunk 8, near
  the END of the sprint** (the resequence moved it *down*, on the grounds that there is no real data
  to protect and no early testers; §1). *(Corrected this round: this paragraph used to read
  "largely answered by chunk 2, which is why it moved up" — written before the resequence, and it
  told any reader the exact opposite of the truth.)* So this question stays **open for the length of
  the sprint by design**: between now and chunk 8 there is no backup of anything, and that is an
  accepted risk only because none of the data is real yet. The remaining question — whether the wrapper should own durable native storage —
  is a wrapper decision, not a sprint one. *(Not urgent before real use begins — see §1.)*

### Cloud-file sync — DIRECTION ADOPTED, build post-wrapper. Analysis recorded so it isn't redone.

**The idea (user's, adopted):** rather than run a server, keep the app's data as a file in the
user's own existing cloud storage (Google Drive, Dropbox, OneDrive), and have the phone app and the
desktop app both read it. Genuinely serverless: no accounts to run, no hosting bill, no privacy
question — it's the user's drive.

**Verdict: sound, but wrapper-only, and the storage is the easy half.**

- **A browser cannot silently write a file to disk.** This is a security boundary, not a missing
  feature. Desktop Chrome's File System Access API can do it *if* the user picks the file once and
  grants persistent permission; Android has no equivalent. **So in the PWA, "auto-export" honestly
  means a prominent manual Export button (chunk 8).** Reaching cloud storage from a web page means
  the provider's API, which means OAuth — the exact dependency chunk 0a deleted.
- **Viable in a native wrapper.** An owned app can hold a file handle and do real OAuth through the
  system browser (the AppAuth pattern) — available *precisely because* the wrapper owns its auth
  flow; Google blocks its sign-in inside embedded WebViews, which is what made the old Tasks
  integration a dead end at this milestone. Google Drive's **`appDataFolder` scope** is the best
  fit: a hidden, app-private folder in the user's own Drive, invisible in their file list, needing
  no permission over their real documents. Dropbox's API is comparably simple.
- **The hard part is conflict resolution, not transport.** Two devices holding one JSON blob means
  last-write-wins: the second device to sync silently destroys the first's work, and an offline edit
  can lose a month of habit history with no error shown. **Do not ship a naive two-way blob sync.**
  It passes every test and eats data later — the same failure mode the snapshot-and-rollback design
  was rejected for (§12.1).

**Adopted path:**
1. **Sprint (chunk 8):** manual export/import. Export to a Drive/Dropbox folder on one device,
   import on the other. Conflicts are impossible by construction — the user knows which file they're
   loading. **This is the whole sprint answer. Stop here.**
2. **Post-wrapper v1 — auto-export + one-way mirror (adopted direction).** One device is
   authoritative (the phone, where capture happens); it writes the file automatically on change. The
   other device *pulls*, and does not write. **One-way sync sidesteps the entire conflict problem**
   while covering the actual use case: capture on the phone, review on the desktop. The read side
   should show plainly when it last pulled, and never silently overwrite the authority.
3. **Only if v1 proves genuinely inadequate:** two-way merge — and then do it properly, with an
   **operation log** replayed on both sides, not a timestamp-merged blob. Per-record `modifiedAt`
   merging handles most cases but needs deletion tombstones or deleted items resurrect. This is
   genuinely more work than most of the rest of the app; do not start it casually.

- *Parked future flags:* habit classification and per-class animations; per-direction sync toggles
  (moot while Google is gone); the project-planning Blackboard.

---

## 11. The teaching layer (built — recorded so it isn't undone)

Built after a category of error the two-questions rule now guards against: the multi-hook mechanic
was internally coherent, but the page it produced **taught the wrong lesson.** Answering the two
questions retroactively:

1. **Purpose:** attach a habit's cue to an existing habit, because a habit is a cue followed by an
   automatic response, and an established habit is the most reliable cue there is. Multi-hook,
   liveness, and caps exist only to keep that working under per-day schedules — they are plumbing,
   not the point.
2. **What the UI must teach:** **one cue → one response.** A habit with two cues is arguably two
   habits; three or more is arguably not a habit at all but a fancy, possibly ineffective scheduling
   system. The UI must make the one-cue path the visible, natural, complete-feeling path, and make
   cue accumulation a deliberate, mildly discouraged act.

**Consequences, all still in force:**
- **The base habit page teaches one cue.** The hook affordance shows only while the habit has no
  hook; once one exists, the page stops inviting more.
- **Advanced options** — a dialog on the Next, Waiting, and Habit pages, the standing home for
  power features the base page deliberately doesn't teach. Habits get two tabs (Bundling, Extra
  cues); Next/Waiting open straight to Bundling. All edits land on the draft and commit with the
  page's Save.
- **The Extra cues tab opens with an explicit recommendation against it** ("Not recommended. A habit
  is one cue followed by one automatic response… Extra hooks exist for rotating weekly routines, not
  for stacking reminders").
- **Temptation bundling** — a per-task text field (Next/Waiting/Habit): "pair something you enjoy
  with the thing you're doing: allow yourself the treat only while, or right after, doing this."
  Shows as a 🍬 pill with a × to remove (draft-only). Not shown on cards.
- **A cue is live today** iff its target is scheduled today and not paused. Text cues are always
  live. **Context cues are always live too** (chunk 3, §4.3d) — a context has no schedule and cannot
  be completed, so it is exactly a text cue that happens to point at a registry entry rather than
  hold free text; it takes no part in the hook cycle (nothing hooks back out of it), but it is **not**
  cap-exempt — it spends one of the habit's 7 outgoing slots and a context accepts at most 7 incoming
  hooks (§7). Liveness is one link deep.
  **Cues never get their own schedules — no per-hook day picker, ever.** Coverage is derived from
  targets; if two hooks are live the same day, both pills show. Crossing this line means building a
  second scheduling system.
- **"Tidy order" is a verb, not a rule** — a one-shot button that applies a suggested topological
  order (Kahn's, alphabetical tiebreak) and leaves the lane fully manual afterward. Never a standing
  invariant. *(The original standing normalization pass was deleted: schedules killed its premise —
  Tuesday's routine genuinely differs from Monday's, so there is no single sequence for the lane to
  assert. Prefer verbs to rules; rules encode today's assumptions and break silently when new
  features change the model.)*

---

## 12. Specified handoff tasks

### 12.1 Chunk B — project-page child actions are staged, not written

> **UNBLOCKED.** §9 rules the staged-edits-vs-timer question. Build to it exactly — including the by-ID staged-delete trap.

**The violation.** Actions created or edited from a project page are written to storage by the
*child* page's Save. ✕ on the project page then leaves them behind — so ✕ does not mean "nothing
happened."

**The ruling.** Nothing reached from the project page touches storage until the **project** is
save-exited. *Rejected, recorded so they aren't relitigated:* (a) *child Save is real* — leaves the
reported bug in place; (b) *snapshot-and-rollback on ✕* — restoring an entry-time snapshot clobbers
anything that changed underneath from another source, i.e. it passes every test and eats data later.
**Staging wins because nothing is written, so there is nothing to clobber.**

**Required behavior.**
- The project draft carries a **staged action set** (creates, edits, deletes, completions), applied
  atomically by the project's Save.
- The linked-actions list renders **from the draft** — staged creates appear, staged deletes
  disappear, staged edits show new titles.
- **Staged actions get their REAL, FINAL ID at stage time — there are no temp IDs.** *(Post-Google
  windfall — see below. This is the single most important implementation note in this chunk.)* A
  staged action can be reopened, re-edited, or deleted before the project saves.
- Both creation paths are in scope (quick-add rows; ✎ full drafting page). Editing a **pre-existing**
  linked action from the project page is also staged.
- **A linked action edited *through the project page* cannot be un-linked from it (RULED, user, this
  round).** When an action **that carries this project's link** is opened as a **child of the project
  page**, its **Link-to-Project field is locked** — shown disabled, with a tooltip ("Linked to this
  project — remove it from the project's list instead"), the same show-but-disable teaching pattern as
  §4.13a's disabled "Make Waiting" convert. *(This used to cite the greyed condition icon on Next
  Actions; that icon was removed in chunk 2 — §4.2 — but the pattern still holds.)* The membership is
  the reason you are on that page; silently
  re-pointing it mid-staged-edit would make the atomic save incoherent. **This is contextual, not a
  property of the action:** the *same* action opened from its own lane keeps a fully editable project
  link. It is knowable which context you are in because chunk 1's navigation stack records that the
  page was reached from the project. **Locks only the link** — deleting or completing the action from
  here stays available (both staged). **Consequence:** "remove this action from the project" is
  therefore an explicit gesture on the project's own list (a staged delete/unlink there), never a
  silent field edit on the child.
  - **⚠ The lock is keyed to the link, NOT to the fact of being opened from the project page (RULED,
    to resolve the §4.15d collision; chunk 8).** From chunk 8 the project's linked list also shows a
    **dependency-only** waiting action — one nested under a project-linked item whose *only* tie to the
    project is the hook, carrying **no project link of its own** (§4.15d). Opening *that* child must
    **not** lock its Link-to-Project field: there is no membership to protect, the "remove it from the
    project's list instead" tooltip would be false (it is in the list only via its anchor, not as a
    member), and the user may legitimately want to add a project link. So: **lock the field iff the
    action actually carries this project's link; leave it fully editable otherwise.** The chunk-5 lock
    and the chunk-8 nesting agree once the trigger is *membership*, not *provenance*.
- ~~**The child page's Save must not say "Save"** — relabel to "Done"~~ — **VOID (user correction).**
  The spec item assumed a text-labelled Save button. The actual control is an **unlabelled ← arrow**,
  so there is no label to lie. And the child page returns to the *project* page, never to the lanes —
  the only exits to the lanes are the project's own save-exit or its cancel-with-warning — so the
  user is never handed a claim that anything was saved. Nothing to fix. *(Optional nicety, not
  required: a tooltip reading "Done — saves when the project saves.")*
- **✕ on the project warns — only when the staged set is non-empty** (state-compare against entry,
  **not a dirty flag**, so create-then-delete, edit-then-revert, and cancelled child drafts are all
  silent). Approved wording:
  > **Are you sure?**
  > Exiting without saving will undo everything you did on this page — including actions you
  > created, edited, or deleted, and any changes to the project's own notes.
  > [ Discard changes ] [ Keep editing ]
- **Every exit route** goes through the warning (✕, Escape, Android back, swipe-to-dismiss) — a
  guarantee is only as strong as its narrowest door.

---

#### 12.1b The project page is a planning surface: staged actions can reference each other

**User-raised collision, resolved.** Two requirements, which together turn the staged set from a list
into a **graph**:

1. **The Waiting quick-add row's "+" becomes a HOOK.** It stays greyed until text is typed. Then you
   can either tap **✎** for the full drafting page, or tap the **hook** and pick a condition target —
   and picking one **creates the Waiting action immediately** (staged), with no trip to the drafting
   page.
   **The rule this establishes:** *the quick-add row can create a Waiting action **if and only if** the
   trigger is a hook — because the hook is the only trigger that is a single tap.* Qualitative text
   needs typing, so it goes through ✎. This is not arbitrary — it is the fast path being fast.
   *(Amended, calendar round: this used to read "a date needs a picker; qualitative text needs typing;
   **both** go through ✎." **There is no date. §4.13a.** Chunk 5 builds this row — do not build a date
   exit into it.)* *(Replaces the old behaviour, where typing + "+" opened the drafting page anyway
   because a trigger was required — which made the "+" a lie.)*
2. **Staged actions must appear in the hook picker.** The whole point of creating actions on the
   project page is *planning*, and planning means wiring up dependencies between the things you are
   planning. An action you just staged must be hookable.

**⭐ THE WINDFALL — there are no temp IDs, so this is nearly free.** The expensive version of this
feature assumes staged items carry **temporary** IDs, which must be remapped to real IDs at save
time, with every reference rewritten in dependency order. **None of that is necessary.** Post-Google,
IDs are generated **locally** — no server round-trip forces an ID to be assigned at write time. So:

- A staged action receives its **real, final ID the moment it is staged.**
- Other staged actions reference it **by that ID**, exactly as they would a live one.
- At project save, everything is written **as it stands**: no temp→real map, no reference rewriting,
  no topological ordering.
- On cancel, nothing was written and the IDs simply evaporate. (IDs must be collision-proof, which
  they already are.)

**"Staged" therefore means exactly one thing: not yet written to storage.** *(This is the same
windfall that lets `moveItem` preserve IDs — §1. Google's removal keeps refunding.)*

**The four graph edges to implement:**

- **Deleting a staged action that another staged action depends on → ORPHAN the dependent.** Exactly
  as if a *live* condition target had been deleted: frozen label, dashed pill, existing machinery. And
  per §9, **an orphaned condition satisfies the waiting-for requirement**, so the dependent still saves
  cleanly. Consistency with the live case; zero new code. *(Rejected: blocking the delete; cascade-
  deleting the dependent.)*
- **Cycle prevention must run over live ∪ staged.** The picker already filters to prevent cycles among
  Waiting conditions; that filter now sees staged items too. Mechanical, easy to forget.
- **The duplicate-title check must span live ∪ staged.** A staged title can collide with a live one.
- **Picker scope: GROUP, don't filter.** Per §4.2 a condition may target *any* Next or Waiting action,
  not only ones in this project — so the picker must not filter to the project. But for planning, the
  project's own actions are what you want 95% of the time. **Show the project's actions (live *and*
  staged) at the top, everything else below.** This keeps the legitimate "waiting on something outside
  the project" case without burying the common one.

**Empty-picker edge case — the picker explains itself; the hook is NOT greyed (user ruling).** A
brand-new project with nothing to hook onto: **the hook stays active, the picker opens, and the
picker's empty state does the teaching.** A greyed control says only *that* you can't; an empty picker
says *why*, and *what to do instead* — which is the app's existing habit everywhere else.

**This pattern already exists and must be reused, not reinvented:** the habit hook picker already
shows *"No habits available to hook to yet"* and the condition picker already shows *"No valid items
to link to yet"* (`index-47`, ~L3149 and ~L3274). *(Note: chunk 3 relabels the habit-picker string to
a cue-framed one — see §4.5 — so by the time this chunk builds it reads roughly "No cues yet…"; reuse
the **pattern**, not the exact literal.)*

**Copy amendment.** The existing condition-picker empty state names the problem but no exit. Since
this picker is now reachable from the quick-add row — where the alternative is one tap away — it
should carry it:

> **"No actions to wait on yet. Add a next action first — or use ✎ to say what you're waiting for."**

*(Amended, calendar round — the old copy offered "wait on a date instead", an exit that no longer
exists (§4.13a). The remaining exits are a hook and free text.)*

It teaches the dependency honestly — **you cannot wait on nothing** — while pointing at the door.

*General principle, worth stating once: **an empty picker is a teaching surface, not an error state.**
Every picker's empty state should name the way out.*

**Already handled, no special case needed:** stage a Next Action, hook a Waiting action to it, *and*
tick Complete on the Next Action — all before saving. At project save, §9's re-evaluation rule fires
and the Waiting action promotes immediately. The rule generalised correctly; do not add a branch for it.

**⛔ SCOPE FENCE.** A project page where you create actions *and wire dependencies between them* is a
dependency-graph editor — i.e. **the shadow of the parked Blackboard.** What is specified here is the
modest, correct version: one hook per Waiting action, through the picker that already exists. **No
canvas, no arrows, no layout, no visual graph.** If you find yourself wanting to *see* the graph, that
is the Blackboard asking to be built, and it is parked for good reason.

---

**Acceptance criteria.** (1) Create an action from the project page, then delete it from the project
page → state matches entry → ✕ is **silent**. (2) Create an action, ✕ → **warns**; on Discard it
exists nowhere. (3) Modify a linked action, ✕ → warns; on Discard the original is intact. (4) Open a
child drafting page, ✕ *the child* → nothing staged → ✕ on the project is silent. (5) Delete a
pre-existing linked action, ✕ → warns; on Discard it still exists. (6) Complete a linked action, ✕ →
warns; on Discard it isn't archived. (7) Quick-add → same as (2). (8) Save the project → everything
lands atomically. (9) The cancel/save audit extended to the project page's child paths.

**Additional acceptance criteria for 12.1b.** (10) Type in the Waiting quick-add row → the hook icon
activates; tap it → pick a target → a Waiting action is created **staged**, with no trip to the
drafting page. (11) With no valid hook targets anywhere, the hook is **still active**; tapping it opens the
picker, which shows the amended empty state naming both exits (add a next action / use ✎ for free
text — **not** a date). (12) Stage a Next Action, then hook a staged Waiting action to it → the
staged Next Action **appears in the picker**, grouped with the project's own actions. (13) Save the
project → both land; the Waiting action's condition points at the **real, unchanged** ID of the Next
Action (proving no remapping is needed and none is happening). (14) Stage both, then delete the Next
Action from the project page → the Waiting action **orphans** (frozen label, dashed pill) and still
saves. (15) ✕ after staging a hooked pair → warns; on Discard, **neither exists anywhere**. (16) The
cycle filter and the duplicate-title check both see staged items, not just live ones. (17) Stage a
Next Action, hook a Waiting action to it, tick Complete on the Next Action, save → the Waiting action
**promotes immediately** via §9's re-evaluation, with no special-case code.

**Snapshot boundary (settled).** Staging touches **only the task lanes** (next, waiting, current,
future, completed archives). Habit runs are explicitly **outside** — a boundary sweep or a QA
day-jump firing while a project page is open must not be affected. *(This clause used to name points
too; the points layer is deleted, §2.)*

### 12.2 Completed-items overhaul (ready to build — chunk 4)

**The two questions, answered.** (1) *Purpose:* the Completed section is the app's memory of finished
work — an undo buffer near-term, a permanent record long-term. (2) *Teaching:* **completion is safe
and reversible** (the filled checkbox un-checks, mirroring how it got checked) while **deletion is
deliberate and final** (one control, behind a confirm). The checkbox-restore swap is what makes that
lesson legible; the trash can is the one place the section says "this is forever."

**Scope.** Implements 4.12b, §7's emergency restore rule, and the bundle-pill ×. Next/Waiting/
Current/Future only; **Habits explicitly untouched.** Gamification, the recurrence engine, and the
reversal-cascade divergence are all out of scope. *(All Google clauses in the original spec are void
— delete, don't implement.)*

1. **New `deleteCompleted(kind, taskId)`.** Do **not** route through `deleteTask` — it operates on
   live lanes only; its filters no-op against the archive and its side effects (label freeze,
   dependent patching) don't apply (dependents were already orphaned at completion time). Splice from
   `state.completed[kind]`, save, re-render. **Projects:** also delete `gtd_archived_waiting[taskId]`.
2. **`clearCompleted(kind)`** behind a **🗑 in the Completed header row**, four lanes only, via
   `openConfirmDialog`: *"Delete all N completed items? This can't be undone."* Implement as a loop
   over `deleteCompleted`'s logic — **one code path, so the rulings can't diverge.**
3. **Checkbox restore.** `completedItemHtml` renders a filled checkbox in place of ↻; tap =
   `restoreTask`. **Remove ↻.**
4. **Emergency restore rule** in `restoreTask` *and* `restoreArchivedWaitingForProject`: before
   insertion, if `parent` doesn't resolve to a live group, null it (the existing unshift then lands
   the item visibly at the top); if `linkedProjectId` doesn't resolve, null it. Condition fields
   untouched.
5. **Completed item page.** Tappable rows open a completed-view variant reading from the archive:
   fields **read-only** (honest static rendering — no inputs that don't save); all four convert
   buttons **greyed and inert**, tooltip "Restore the item to convert it"; the Complete pill renders
   as **"↩ Restore"** (restore + close); **🗑** = `deleteCompleted` behind the confirm; **← only —
   there is NO ✕** (§4.12b, user ruling: with nothing editable, ← and ✕ would be the same gesture and
   shipping both is theatre). *(Corrected this round: this step used to read "← and ✕ both just
   close," which would have shipped the ✕ the user ruled out — from the build spec, in the chunk that
   builds it.)* Draft isolation is trivially satisfied, **but extend the cancel audit to this page
   anyway** — "no control leaks" is a claim made by enumeration, not by reasoning that there's
   nothing to leak.
6. **Bundle-pill ×** on the Next/Waiting/Habit pages: clears `draft.bundleText`, re-renders in place.
   Draft-only.

**Acceptance criteria.** (1) Delete a completed item → gone from archive and storage; live lanes
untouched. (2) Delete a completed project → its `gtd_archived_waiting` key goes too. (3) Trash can
present on four lanes, **absent on Habits**; Cancel is a no-op; confirm empties that lane's archive
only. (4) Checkbox restore returns the item to the top of the live lane; ↻ renders nowhere.
(5) **The origin repro passes:** complete a Context's only item → delete the Context → restore → the
item is visible at the top, parentless. (6) Same through the project path. (7) Completed page: convert
buttons inert; Restore restores and closes; 🗑 deletes with confirm; **← closes with no side effects,
and there is no ✕ to find** (§4.12b).
(8) Bundle ×: set text → pill shows with × → tap × → ✕ the page → the saved bundle survives; repeat
ending with Save → bundle cleared. (9) `node --check` clean; QA checklist re-issued per §8.1.

### 12.3 Dev tool: state snapshot & restore (chunk 0c)

**Purpose.** Capture the entire app state before destructive testing (deletes, QA day-jumps through
the run engine), restore it afterward, repeat. **Dev tool only; stripped at the wrapper**, same as
the QA day-jump button and the checklist injector.

**⚠ `qaDayOffset` must become `qaTimeOffset` — hour/minute granular — in this chunk.** The
midnight–4 AM rule (§4.14b) is otherwise untestable: a day-granular jump can never place the clock
*inside* the window where the calendar grid and the pseudo-action promotion deliberately disagree.
Chunk 0c ships long before chunk 7, so this is cheap now and a blocker later. Keep the "+1 Day"
button; add hour/minute controls beside it.

Two buttons beside the QA time controls. **Snapshot:** serialize every `gtd_`-prefixed key verbatim into one
JSON object under **`gtddev_snapshot`** — the `gtddev_` prefix is mandatory, because Reset clears
`gtd_*` keys and the snapshot must survive a reset. Include a `savedAt`. Single slot, overwrites
silently. **Restore:** via `openConfirmDialog` ("Restore the snapshot from [savedAt]? Current data
will be replaced"), remove every `gtd_` key, write the snapshot back verbatim, then `location.reload()`
— a full reload sidesteps all re-render complexity by design; **do not attempt in-place rehydration.**

*Note: the user-facing export/import (chunk 8) is a different feature with a different audience. This one
is a dev convenience and can share the serialization code.*

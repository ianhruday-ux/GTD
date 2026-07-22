# Desktop redesign — implementation plan and traps

**Read this alongside `Desktop redesign.txt`** (the author's ten numbered notes). This document
records the rulings from the design conversation the author required before any build, maps each
note onto the existing code, and — its main job — lists the traps a build session is likely to
fall into. It was written by the session that held that conversation; where it says "ruled," the
author decided it explicitly. Where it says "builder's call," pick the simplest option and flag
it in the handoff summary, per CLAUDE.md.

The two questions CLAUDE.md requires before a redesign were answered in conversation:

- **Purpose of the shell:** survey and triage. One-lane-at-a-time on the phone was a constraint
  we accepted, not a design goal. The desktop removes the constraint; it does not add features.
- **What the UI teaches:** three columns teach the GTD division of attention — *do*
  (Next/Waiting), *plan* (Projects/Someday), *support* (Notes/Habits). Each column's toggle
  teaches that every area has a front face and a back face. Same pairs as the mobile tabs,
  so both layouts stay one mental model.

---

## 1. The rulings (all decided with the author — do not re-litigate)

1. **Breakpoint ~1000px.** At or above it, the desktop layout; below it, the phone app exactly
   as it is today. The phone is untouched this round with **one sanctioned exception**: the tray
   handle (ruling 8). A half-snapped laptop window gets the mobile layout; that is intended.
2. **Three columns**, keeping the mobile pairings: left toggles Next Actions ↔ Waiting On,
   middle toggles Current Projects ↔ Someday, right toggles Notes ↔ Habits. A two-column
   split (act/watch) was considered and explicitly deferred — do not build it.
3. **No dragging between columns.** Drag stays within a lane. Moving an item between lanes
   remains open-page-and-convert.
4. **Drafting pages become centered cards** over the dimmed lanes: ~700px wide, ~880px for
   project pages (they carry the staged-actions machinery). Button geography:
   - **Done** — bottom-right, filled, prominent. It *is* the current ← (`data-action="screen-save"`):
     save and close. Nothing else about commit semantics changes.
   - **Delete** — bottom-left, danger-styled, keeps its confirm. Maximum distance from Done.
   - **✕** — top-right of the card.
   - **Complete and Convert live together in the card body** as one visible "what happens on
     Done" group — Complete pill first, convert buttons beside/below it in the same bordered
     section. They are the same kind of control (a declaration about what the item becomes on
     save) and their mutual exclusion is only legible when they are adjacent: arming one greys
     the others *right next to it*. Complete never moves into the footer — a big "✓ Complete"
     next to "Done" reads as two rival finish buttons. Footer = "am I finished drafting?";
     body group = "what is this item becoming?"
5. **Discard protection (author picked option 1):** clicking the dimmed background does
   **nothing**. ✕ (and Escape) asks "Discard your changes?" — but **only when the draft
   actually differs** from the saved state; an untouched page closes instantly. This is a
   *softening added on top of* draft isolation, not a change to it: ✕ still never commits.
6. **Calendar: visually a popup, structurally the same screen.** It stays a screen-stack
   citizen (`openCalendarScreen` in `src/events.js`), restyled on desktop as a large centered
   card (~900px) so the month grid finally gets room. No new popup system. All threaded flows
   (event page returns to calendar, add-event-from-project, Waiting-lane widget) must keep
   working untouched.
7. **Header (desktop only):** top-left gets a Language dropdown, a Background dropdown, and the
   Calendar button; **OELA centered**; a gear (the current ⋯ menu) top-right. On desktop the
   gear menu **loses** its Language and Background rows (one place per thing); on the phone the
   header and ⋯ menu stay exactly as they are.
8. **Tray:** widen to ~440px on desktop (`min(440px, 86vw)`). The header 📥 **retires on both
   layouts**, replaced by a floating white arrow **handle on the left screen edge** — slim tab,
   tap to open; an arrow on the tray's edge closes it. On the phone the handle must be a plain
   **tap** target (the left edge belongs to browser back-swipe gestures — do not make it a
   drag/pull target) and slim enough to barely occlude cards. This is the one phone change.
9. **Lane headers (author note 4):** full words, bigger, one layer across the top. On desktop
   the three column-toggle headers ARE that single layer — see trap T8 for what this means for
   the in-lane `.lane-label`.
10. **Per-lane create buttons (author note 5):** on desktop the floating + (FAB) disappears and
    each column gets its lane's options as real buttons under its header (e.g. Notes: "+ New
    Note", "+ New Checklist", "Tags"). The FAB stays on the phone.
11. **Gold-leaf frame (author note 10):** on desktop it wraps the **whole page** (header
    included), never individual lanes. Mobile keeps its current behavior (frame wraps `#main`
    and scrolls/grows with it).

---

## 2. Where the current code lives (verified this session)

- **Header:** static HTML in `src/index.html` (`<header>` — brand left; 📥 `open-tray`, 📅
  `open-calendar`, ⋯ `open-overflow` right).
- **Tab bar:** `nav.tabbar` in `index.html` — three `.tab-pair` blocks, already the same
  pairings as the desktop columns. Counts live in `.tab-count`. There is a
  **collapse-on-scroll** machinery for it (`tabScrollAccum` / `TAB_COLLAPSE_HYSTERESIS` /
  `resyncTabScroll` in `src/app.js`, plus `.tabbar-spacer`).
- **Lane rendering:** all six lanes are ALWAYS in the DOM (`renderShell` / `laneShellHtml` in
  `app.js`); visibility is one class, toggled by `updateLaneVisibility()` — `.active-lane` on
  exactly the lane matching `state.activeKind`. `state.activeKind` is not persisted; every
  load starts on "next".
- **`state.activeKind` consumers** (the complete list, ~8 sites in `app.js`): the tab click
  handler (which also lazily calls `renderLane("notes")` when switching to notes),
  `updateLaneVisibility` (FAB retint/repoint + FAB menu relabel from `FAB_MENU_LABELS`), and
  the FAB menu handlers `new-primary` / `new-secondary` / `new-tertiary` (which route by
  `state.activeKind`, including `openInlineNameRow(state.activeKind)`).
- **Screens:** `openScreen`/`renderScreen`/`closeScreen` in `app.js`. One `.screen-overlay`
  node in `#screen-root`, `position:fixed; inset:0`, slide-in via `transform:translateX` + an
  `.open` class added in rAF. `renderScreen` has an **in-place re-render path** keyed on
  `data-screen-key` (same item re-rendering swaps innerHTML and preserves `.screen-body`
  scroll). Chrome: `screenHeaderHtml` (← save / badge / 🗑 / ✕). Body scroll lock:
  `lockBodyScroll` + `body.screen-open`.
- **Cancel gate precedent:** `attemptCancelScreen()` already implements exactly the ruling-5
  pattern, but **only for project pages** (`projectDraftDirty(s)`, a state-compare). Escape
  routes through it. §4.6 resolution order lives in the Escape keydown handler:
  dialog → drawer → page.
- **Calendar:** `openCalendarScreen` (`src/events.js`) sets `state.screen.calendarView`;
  rendered by the same `renderScreen`. Month nav has clickable ‹ › buttons
  (`data-action="cal-month"`), so mouse users need nothing new; `bindCalendarSwipe` is
  touch-only extra. Grid sizing is written against `.screen-body`'s max-width 640 (see the
  comments around `.cal-cells` in `styles.css`).
- **Tray:** `openTray`/`closeTray` in `app.js`; `.tray-drawer` in `styles.css` is
  `width:min(360px, 86vw)`, slides from the left, z-index 211 over a 210 backdrop. It
  **auto-opens on launch** (call near the bottom of `app.js`, §4.8a). A touch swipe-right
  from the left third of the screen also opens it. The lacquer surface draws a jade inlay
  down the drawer's inner edge (`body.has-frame .tray-drawer::after`).
- **Settings:** `openSettings` in `app.js` builds the ⋯ menu into `#dialog-root`;
  `settingsLanguageHtml` / `settingsBackgroundsHtml` are the sub-panels; picking calls
  `setLocale(id)` / `setSurface(id)` — reuse those, never copy their logic.
- **Frame:** `src/surface.js` — `drawDeskFrame()` paints the key-fret onto the `#desk-frame`
  canvas, sized to **`#main`'s own box** (deliberate mobile decision: border wraps the lanes
  and grows with content), redrawn by a ResizeObserver on `#main`. `--frame-inset` +
  `body.has-frame` pad content off the band. Only the Black-lacquer surface has
  `frame: true`.
- **i18n:** `src/i18n.js` — `t("dotted.key")`, `STRINGS` table keyed key→locale, locales
  `en` and `zh-Hans`. Per-lane/per-kind label maps are rebuilt in `rebuildStringTables()`
  (`app.js` top). **`NEW_ITEM_LABEL` is a plain English const, NOT in the i18n table** —
  it's currently only a tooltip, but see trap T12.
- **Tutorial:** `seedTutorial` cards carry `tutorialKey`; text comes from
  `t("tutorial.*")` and is restamped on language switch.
- **Tests:** the real suites are standalone Playwright scripts in `checks/` (run
  individually with `python`; `conftest.py` at root is the old chunk-0b parity harness —
  CLAUDE.md's `pytest tests/` path is stale). **Every check creates its context with an
  explicit mobile viewport (390–430px wide).** Roughly ten of them open the tray by clicking
  `[data-action="open-tray"]` and several click `#fab-create` — see traps T2/T3.

---

## 3. Suggested build order

Each stage is a committable, revertable unit. Commit as you go.

1. **Mode plumbing.** One `matchMedia("(min-width: 1000px)")` as the single source of truth
   (trap T1), a `body.desktop` class, per-column active-lane state, `updateLaneVisibility`
   generalized to N visible lanes.
2. **Shell:** three-column grid, column toggle headers (full words + counts), tabbar hidden on
   desktop, per-lane buttons with explicit `data-kind` (trap T4), FAB hidden on desktop.
3. **Header:** OELA centered, Language/Background dropdowns + Calendar top-left, gear
   top-right, desktop gear menu loses Language/Background.
4. **Screens as cards:** scrim + centered card styling, Done/Delete footer, ✕ top-right,
   Complete+Convert grouped, dirty-check discard confirm (trap T6), calendar popup width.
5. **Tray:** handle both layouts, 440px desktop width, header 📥 removed (traps T2, T15).
6. **Frame:** whole-page on desktop (trap T14).
7. **Round close:** draft-isolation enumeration on every page (§ below), new-string
   translations (T12), tutorial copy audit (T13), QA checklist + chunk map refresh
   (plain-language items only), `node --check dist/index.html`.

---

## 4. The traps

**T1 — Two sources of truth for "am I desktop?"** The breakpoint will exist in CSS media
queries *and* in JS behavior (which lanes visible, FAB vs buttons, gear menu contents, frame
geometry). If JS reads `window.innerWidth` ad hoc in each place, the numbers drift and you get
half-desktop states. Define the breakpoint **once**: one `matchMedia` listener that sets a body
class and fires one `applyLayoutMode()`; all JS asks that, all CSS keys off the media query with
the same number. Also handle **live resize across the boundary** in both directions: an open
screen, open tray, open settings menu, and open FAB menu must all survive a mode flip
(re-render, don't strand). Crossing desktop→mobile, set `state.activeKind` to the left column's
active lane; crossing mobile→desktop, seed the left column from `activeKind` if it's an
action lane. Defaults on a fresh desktop load: Next, Projects, Notes (the first-named of each
pair in the author's note).

**T2 — The retiring 📥 breaks ~10 Playwright checks.** `deadline_push`, `missed_repeats`,
`qa_checklist`, `project_new_event`, `review_and_event_page`, `review_waiting_and_tray`,
`stalled_projects`, `tutorial`, and others click `[data-action="open-tray"]` at mobile
viewports. **Put `data-action="open-tray"` on the new handle** and the checks keep passing
unmodified — the action name is the contract, not the button's position. Same for the close
arrow: reuse the existing close action.

**T3 — New Playwright contexts default to 1280×720 = desktop.** Existing checks pin mobile
viewports, so they keep testing the phone (good — that's the no-regression contract). But any
*new* check written without an explicit viewport will silently run the desktop layout, and a
selector like `#fab-create` or `.tab[data-kind]` won't be interactable there. Every new desktop
check: explicit wide viewport. Every new mobile check: explicit narrow one. Never rely on the
default. And note the flip side: after this round, the desktop layout has **zero** coverage
until desktop checks are written — write at least a smoke check (three columns render, toggles
work, a card saves).

**T4 — The FAB handlers route by `state.activeKind`; the per-lane buttons must not.** The
handlers for `new-primary`/`new-secondary`/`new-tertiary` (and `openInlineNameRow`) all read
`state.activeKind`. On desktop three lanes are live at once, so "the active lane" is ambiguous.
Give the new under-header buttons an explicit `data-kind` and route by it. Easiest safe shape:
new actions (`lane-new-primary` etc. carrying `data-kind`) that call the same underlying
functions with an explicit kind — leave the FAB path reading `activeKind` for the phone.
Labels come from `FAB_MENU_LABELS` (already localized). Habits gets a single "+ New Habit"
(it has no FAB menu today — `FAB_MENU_LABELS.habit` doesn't exist; don't invent extra
options) and keeps its existing "⇅ Tidy order" lane tool.

**T5 — `updateLaneVisibility` and the notes lazy render.** `.active-lane` is currently
exactly-one; desktop needs exactly-three (one per column). The tab click handler lazily calls
`renderLane("notes")` on switch-to-notes; on desktop that must fire when the *right column
toggle* lands on notes, and on initial load if notes is the column default (it is). Miss this
and the notes lane renders stale or empty. Counts: the column toggle should show both lanes'
counts (the hidden half's count is the reason to toggle).

**T6 — The dirty-check discard confirm is subtler than it looks.** `attemptCancelScreen`
already does this for project pages via `projectDraftDirty` (a state-compare, not a dirty
flag — keep that approach; flags rot). Extending to every page type means a per-shape compare:
plain task pages, habit pages (cueRows arrays, schedule arrays, paused, armed done),
notes (`noteView`), events (`eventView`), and the calendar's own creation row. Normalize
before comparing (null vs "" vs missing key, trimmed titles, array order) or you'll get
false "Discard your changes?" on untouched pages — which trains users to click through the
one dialog that matters. Two more edges: (a) **don't stack two confirms on project pages** —
the existing project warning IS the confirm; keep its wording, don't add a second generic one
in front of it; (b) an **armed Complete/Convert counts as dirty** (it is exactly the kind of
staged intention the confirm exists to protect); (c) a brand-new empty draft is never dirty —
✕ on an untouched create closes silently. Apply the gate on both layouts — one code path, no
mode fork (author approved the mechanism; flag this in the handoff as the shared-path choice).
The read-only completed page and the review have no draft: never confirm there.

**T7 — Restyling the screen must not fork its DOM.** `renderScreen`'s in-place re-render path
(`data-screen-key`) is what stops the page replaying its entrance animation and losing scroll
on every draft mutation (arming Complete re-renders!). Make the desktop card a **CSS
restyle of the same `.screen-overlay` node** (scrim = the overlay's own backdrop area, card =
an inner wrapper it already has or gets in both modes). If desktop builds different DOM than
mobile, the in-place path and the habit runner mount (`mountHabitRunner`) both need forked
logic — a bug farm. One DOM, two stylesheets' worth of rules. The entrance animation can
differ per mode in CSS alone (slide on mobile, fade/scale on desktop). Keep
`lockBodyScroll` exactly as is — the dimmed lanes behind the card are the same frozen body.

**T8 — "One layer of headers" means merging, not adding.** Each lane already renders its own
`.lane-label` (title + count + ⓘ info button). If the desktop column header (the toggle) sits
above it, every column shows its name twice — exactly the stacked-layers look the author is
ruling out. On desktop: the column toggle header carries the full lane names, counts, and the
active lane's ⓘ; hide the in-lane `.lane-label`. The ⓘ must keep toggling the same
`.lane-info` panel. Don't delete the mobile markup — hide per mode.

**T9 — The scrim must be genuinely inert, and unlike the dialogs' backdrop.** The app's
*dialogs* (`.choice-dialog-backdrop`, advanced options) close-and-capture on backdrop click.
The screen scrim, per ruling 5, does **nothing** on click. These two look identical on screen.
Do not reuse the dialog backdrop element/handler for the screen scrim, and don't "helpfully"
wire the scrim to `attemptCancelScreen` — the author explicitly chose inert.

**T10 — The Complete/Convert group has per-page membership.** Not every page has both halves:
notes and events have no convert set; the completed page shows "↩ Restore" in the Complete
slot with converts greyed; habits *toggle* complete and block it while paused (and pausing
lives on the page as a draft control). Build the group as "render what the page has, in one
section" — do not force a uniform two-slot layout that leaves ghost buttons. The mutual-
exclusion logic (`make-kind` disabled while Complete armed, and vice versa) is already correct;
touch ONLY layout. Desktop bonus: the greyed buttons' `title` tooltips ("Disarm Complete to
convert") finally work on hover — keep them.

**T11 — Calendar width is load-bearing.** The month grid, day cells, and creation row are
sized against `.screen-body`'s 640px column (comments in `styles.css` around `.cal-cells` say
so explicitly). Widening the calendar card to ~900px means widening that inner column *for the
calendar screen only* — a `.screen-overlay[data-kind="calendar"]` scope — and checking the
cells actually grow (they may be flex/aspect constrained). Verify the ‹ › month buttons, the
Month·Day segmented tabs, and the agenda list at the new width, and that `bindCalendarSwipe`
still binds harmlessly (it's touch-only). The calendar stays in the screen stack — opening an
event from it must still return to it, including from inside the desktop card.

**T12 — Every new visible string ships in both languages.** The app has a shipped Chinese
translation; `t()` falls back to English loudly in dev builds. New strings this round: "Done",
the discard-confirm text, the column toggle labels (reuse `lane.*.title` — already
translated), the per-lane button labels (reuse `fab.*` — already translated), the tray handle
tooltip, dropdown labels for Language/Background (reuse `settings.*` keys where they exist).
The one pre-existing hole: `NEW_ITEM_LABEL` (used for the FAB tooltip, and tempting to reuse
for "+ New Habit") is **English-only and outside the i18n table** — if any of its strings
become visible button text, move them into `STRINGS` properly. Also: the new header dropdowns
must re-render on `setLocale` (their own labels change language) — `setLocale` re-renders
lanes/tabs/screen but knows nothing about header widgets; add them to its render path.

**T13 — The tutorial teaches the mobile UI.** The seeded tutorial cards (`t("tutorial.*")`)
were written for the phone: if any of them say "tap the + button", "tap the N tab", or
reference the header 📥, a desktop user is being taught controls they can't see (and after the
tray-handle change, the 📥 wording is wrong on the phone too). Audit every `tutorial.*` string
against both layouts; reword to layout-neutral language ("open the intray from the left
edge…") rather than forking the tutorial per mode. Same audit for the lane ⓘ info texts and
`INFO-TEXT.txt`-derived copy (the author authored those — **propose wording changes, don't
silently rewrite**; flag them in the handoff).

**T14 — The frame's two geometries must not merge.** Mobile (unchanged): canvas inside
`#main`, sized to `#main`'s box, grows with content, ResizeObserver on `#main`. Desktop
(new): a **viewport-fixed** frame around everything, header included — which means a second
geometry: sized to the window, redrawn on window resize (the `#main` observer won't fire for
a window-height change that doesn't reflow main), and `--frame-inset` padding applied to the
header and handle too, not just main. Parameterize `drawDeskFrame` by host box rather than
duplicating it. Watch three collisions: the tray handle sits on the left band (put the handle
*over* the frame; it's an object on the desk's edge, that reads fine); `body.has-frame`
currently also styles the tray's jade inlay (keep); only Black lacquer has a frame — the
other three surfaces must show clean layouts with `--frame-inset: 0`. Test all four surfaces
in both modes.

**T15 — The tray handle's small print.** (a) Keep `data-action="open-tray"` (T2). (b) The
handle hides while the tray is open and comes back after the 280ms slide-out — the drawer's
teardown uses a `setTimeout(…, 300)`; hook the same timing or the handle pops in over the
moving drawer. (c) Phone: tap-only, ~22px wide with a ≥44px tall hit area, positioned where it
occludes card checkboxes least (upper third of the lane area is emptiest; the author's phone
test is the real verdict — flag position for their QA). (d) It floats over lane content:
z-index above cards, *below* the tray backdrop (210). (e) The existing touch swipe-open from
the left third stays — the handle is an affordance on top of it, not a replacement. (f) The
tray auto-open-on-launch stays — it's the teaching moment that hands off to the handle.
(g) Desktop width `min(440px, 86vw)`; keep the jade inlay working at the new width.

**T16 — The tab bar's scroll collapse must die cleanly on desktop.** The collapse-on-scroll
state machine (`tabScrollAccum` etc.) listens globally. On desktop the tabbar is
`display:none`, but the JS keeps running and `resyncTabScroll` is called from screen-close
paths. It's harmless if truly display:none — but verify nothing else keys off the collapsed
class, and don't let the new column headers inherit the collapse behavior. Desktop headers
are static: the page scrolls as one document (columns grow downward; the frame and
`lockBodyScroll` already assume a single scrolling document — **do not** give each column its
own scrollbar, it fights both).

**T17 — Header dropdowns are new chrome in a header that never had state.** The header is
static HTML today. Language/Background dropdowns need: outside-click close, Escape close
(slot BEFORE the §4.6 dialog→drawer→page order — a stray Escape closing the user's
half-edited page because a dropdown was open would violate least surprise), only-one-open
(opening Language closes Background), re-render on locale change (T12), and the swatch/native-
name presentation reused from `settingsBackgroundsHtml`/`settingsLanguageHtml` — call
`setSurface`/`setLocale`, never reimplement. Builder's call on `<select>` vs custom menu;
custom matching `.settings-item` markup will look right with near-zero new CSS. The Calendar
button moves next to them (`data-action="open-calendar"` unchanged — a check may click it).
Mobile header markup stays byte-identical.

**T18 — Draft isolation must be re-verified by enumeration, per CLAUDE.md.** The redesign
rearranges every drafting surface, which is exactly when a control quietly starts committing
early. Run the standing procedure on **every page type in desktop mode**: enumerate every
control the page renders (not the ones you touched), mutate with each, ✕ out (now through the
confirm), verify nothing persisted; repeat with Done and verify everything did. The new
footer buttons, the grouped Complete/Convert, and the discard confirm itself are all new
surfaces for a leak. Also re-verify the one deliberate exception: 🗑 still acts immediately,
from its new bottom-left position, behind its confirm.

**T19 — Round-close conventions still bind.** Inject the new QA checklist into Next Actions
(replace the previous chunk's content AND flag key; plain-language items only — the author
does not use DevTools, so every item must be checkable by tapping around the app, on both a
phone and a desktop window). Refresh the chunk-map Current Project the same way. Rebuild with
`python build.py`, run `node --check dist/index.html`, run the `checks/` scripts you touched
the domains of, and commit in stages. Do not deploy/push to Pages without being asked
(standing instruction), and no service worker.

---

## 5. Defaults already chosen (flag if you change them)

- Breakpoint number: **1000px** (author accepted the recommendation without attachment).
- Fresh desktop load shows **Next / Projects / Notes**.
- Desktop card widths: **~700px** standard, **~880px** project, **~900px** calendar.
- Tray: **440px** desktop.
- Column toggle = the two full lane names side by side, active one lit, with counts.
- The discard confirm's wording: match the existing project-page warning's register
  ("Discard changes" / "Keep editing" buttons via `openConfirmDialog` — never native
  `confirm`).
- Per-column active lane is session-only (not persisted), matching `activeKind` today.

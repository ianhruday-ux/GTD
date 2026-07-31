# checks/

End-to-end checks that drive **the real built app** (`dist/index.html`) in a real Chromium via
Playwright — clicking through it the way a person would and asserting what actually rendered.

They are **not** `pytest` files and are deliberately not named `test_*.py`: each one is a plain
script that runs top to bottom and exits non-zero on failure, so pytest's collector must not import
them. The repo's `test_parity.py` / `test_0b_deltas.py` are a separate, chunk-0b-specific thing.

## Running them

Build first — these check `dist/`, not `src/`:

```bash
python build.py
python checks/calendar_round.py
python checks/boundary_4am.py
python checks/settings_surface.py
```

Each prints one line per check and a `N passed, M failed` summary.

## What each one covers

| file | covers |
|---|---|
| `calendar_round.py` | Calendar creation row stays fully visible (never collapsed), the removed jargon lines, a completed one-shot event not re-minting itself, the appointment bar's fill, and the intray drawer's finger-follow swipe |
| `boundary_4am.py` | The 4 AM turnover for all four dated shapes — appointment, untimed event, recurring series roll, untimed deadline — stepping 03:55 → 04:05 across each relevant day on a faked clock |
| `settings_surface.py` | The settings dropdown (rows, order, disabled Language, outside-tap dismiss), the background picker, persistence across reload, and a `gtd_` clear resetting the surface |

## Why these exist

Several of the rulings they encode existed only as prose in `spec.md` until the round that wrote
them — in particular **the corrected pseudo-action bar** (a pseudo-action's bar begins when the row
appears; an untimed event fills across its day rather than sitting full, §4.4d/§4.14c) and **an
untimed deadline going passed at the boundary that *ends* its due day, not the one that begins it**.
Both were regressions waiting to happen, and neither is visible from reading the code.

## Standing testing protocols (author, 2026-07-31)

Four rules, each written after something got through. They bind new checks and any check you touch.

**1. A check is not finished until it asserts on something RENDERED.**
Assert the DOM the user would actually see — not the `localStorage` key underneath, and not a
screenshot (the DOM is cheaper *and* more precise). Storage assertions are still welcome **in
addition**, because some state has no visible surface (tombstones, the sync baseline); they are just
never sufficient on their own.

*Why:* every sync check in this directory asserted on `localStorage` — which was the one place that
was **correct** — while the bug made merged records invisible on screen and then destroyed them.
None of those checks *could* have caught it. See `checks/sync_live_state.py`, which asserts on
rendered cards for exactly this reason.

**2. A new check must be proven to FAIL against the unfixed build.**
Rebuild the previous commit's `dist/index.html` somewhere and point the check at it. If it passes
there, it is testing nothing.

*Why:* two checks written the same night passed vacuously — one clicked a button that did not exist
in that layout and asserted nothing, another asserted a bundle property that held whether or not the
fix was present. Both were caught only by running them against the pre-fix build. **A check that has
never failed is not evidence.**

**3. Anything touching LAYOUT must be exercised on Black lacquer, at both widths.**
Set `gtd_surface` to `lacquer` before asserting geometry.

*Why:* lacquer is not merely a busier texture. It is the only surface with `frame: true`, which adds
a separate fixed canvas layer, sets `body.has-frame`, and **pads the content box in via
`--frame-inset`** — so it changes layout geometry, not just appearance. It also has two different
frame geometries, phone versus desktop (trap T14). A bug involving edges, insets, fixed positioning
or full-bleed elements can exist *only* under lacquer, and only at one of the two widths.

**4. Anything touching sync, events, the review, lanes or completion must exercise a RECURRING event
end to end** — creation → completion → un-completion → deletion → how it sorts in the review.

*Scope deliberately, and deliberately not "every check":* a full recurrence lifecycle in every file
would make the suite slow enough to stop being run, which is worse than the gap. The rule is scoped
to the systems that actually collide with recurrence.

*Why:* recurrence is where the most systems meet (projection, the 4 AM boundary, pseudo-actions,
missed-occurrence tracking, the undo window, the review's five card kinds), and it has been the
buggiest area of the app historically. Pieces are covered — `missed_repeats.py`,
`recurrence_projection.py`, `review_skip_*.py`, `boundary_4am.py` — but **nothing crossed recurrence
with sync**, which is exactly where the pseudo-action tombstone bug lived.

## Two notes for whoever edits these

- **A faked clock freezes CSS transitions.** The intray auto-opens at boot and its slide never
  completes under `page.clock`, so these dismiss it by clearing `#tray-root` rather than clicking
  the animated close button.
- **Check your own clock arithmetic before believing a failure.** Two "bugs" found while writing
  these were errors in the test's own `timedelta`, not in the app. The app-day starts at 4 AM, so
  "the day before" is rarely the offset you first reach for.

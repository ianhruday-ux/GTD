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

## Two notes for whoever edits these

- **A faked clock freezes CSS transitions.** The intray auto-opens at boot and its slide never
  completes under `page.clock`, so these dismiss it by clearing `#tray-root` rather than clicking
  the animated close button.
- **Check your own clock arithmetic before believing a failure.** Two "bugs" found while writing
  these were errors in the test's own `timedelta`, not in the app. The app-day starts at 4 AM, so
  "the day before" is rarely the offset you first reach for.

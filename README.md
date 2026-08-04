# OELA — the Over-Engineered List App

A GTD-inspired task manager that runs entirely in your browser. Five lanes — Next Actions,
Waiting On, Current Projects, Future/Someday and Habits — plus Notes and a Calendar.

**No account, no server, no setup.** Everything lives in your own browser's local storage. The
whole app is one self-contained HTML file you can open straight from disk and hand to anyone.
Optional Dropbox sync keeps two devices in step if you want it; nothing breaks if you don't.

- **Try it:** https://ianhruday-ux.github.io/GTD/
- **Install it** (Windows desktop app, Android APK, or just the single file): [`INSTALL.md`](INSTALL.md)
  — note that the packaged downloads it describes are built locally by `tools_package.py`; no
  GitHub Release has been published yet.

## Building

Source lives in `src/` and is stapled into `dist/index.html` by the build script. Never edit
`dist/` by hand — it is generated.

```bash
python build.py            # staple src/ into dist/index.html
python build.py --watch    # rebuild whenever a src/ file changes
node --check src/app.js    # syntax check
```

## Tests

`checks/` holds end-to-end suites that drive the real built app in a real Chromium via Playwright,
asserting on what actually rendered. They are **not** pytest — each is a plain script, run one at
a time, against `dist/`:

```bash
python build.py
python checks/csp.py
python checks/calendar_round.py
```

See [`checks/README.md`](checks/README.md) for what each one covers and the standing testing
protocols they follow.

## Layout

| path | what it is |
|---|---|
| `src/` | the application source — vanilla JS, no framework |
| `dist/` | the built product: one self-contained HTML file, plus the manifest, icons and service worker |
| `checks/` | end-to-end browser suites |
| `wrapper/` | Capacitor (Android) and Electron (desktop) wrappers around the same `dist/` |
| `spec.md` | the specification, and the authority where documents disagree |
| `sw-killswitch.js` | emergency service-worker recovery; see `service-worker-plan.md` §10 |

The `*-plan.md` files and `ROUND-NOTES.md` at the root are working history, not specification —
read them only if you need to know why something is the way it is.

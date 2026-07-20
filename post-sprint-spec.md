# post-sprint spec

**Status: SEED.** This document is opened deliberately empty of ambition. `spec.md` is the authority
for everything built during the one-month sprint (chunks 0–9); this file is where work that lands
*after* that scope goes, starting with the settings/appearance round. The author intends to build it
up — so the shape below is meant to be added to, argued with, and reorganised, not treated as
settled.

**Numbering.** Sections here are `§P<n>` so they can never be confused with a `spec.md` §. Where a
post-sprint change contradicts something in `spec.md`, the contradiction is named explicitly in both
files rather than silently resolved (the calendar round showed what silent resolution costs).

**What is NOT in scope here.** The QA checklists stay in the app and keep their existing
inject-and-replace discipline — the author has not finished walking them. No chunk-9 work is
represented here.

---

## §P1 The settings surface is a dropdown

**Was:** a modal sheet (`choice-dialog` + `settings-sheet`) over a backdrop, with an explicit Close
button.

**Is:** a dropdown anchored under the header `⋯`, dismissed by tapping anywhere outside it.

**Why.** A modal is a room you have to leave. Settings here are small, frequent, and mostly one tap
— pick a background, take a backup — and the modal made each of them a three-step trip. The
dropdown also keeps the desk visible behind it, which matters specifically for §P2: you cannot judge
a background against a dialog covering the thing it is changing.

**Mechanics.**
- An invisible full-viewport `.menu-scrim` catches the outside tap; the menu itself is
  `position:fixed`, anchored to the header's right edge, above the header's own z-index.
- **Nested panels push into the same dropdown**, they do not open a second layer. Background opens a
  panel with a `‹ Back` row at the top. One surface, one dismiss target, at any depth.
- The menu renders into `#dialog-root`, so anything that opens a real dialog from a menu row (the
  destructive confirm, import/export) replaces the menu rather than stacking on it. That is the
  intended behaviour, not an accident of implementation.
- **The destructive control keeps its confirm dialog.** `openConfirmDialog` still guards Restore to
  defaults — CLAUDE.md's "data destruction is possible, never accidental" is untouched by the
  surface change. A dropdown is *easier* to open than a modal, which makes the confirm more load
  bearing, not less.

**Rows, in order:** Export a backup · Import a backup · — · Background ▸ · Language · — · Restore app
to defaults.

---

## §P2 Backgrounds

**The desk surface is a user preference**, chosen from a registry rather than compiled in.

| id | label | what it is |
|---|---|---|
| `walnut` | Walnut | the default; dark warm brown, tight rings |
| `oak` | Oak | lighter and warmer, wider rings |
| `ebony` | Ebony | near-black, many fine rings |
| `slate` | Slate | not wood — `rings: 0` turns the same generator into stone |
| `plain` | Plain | no texture at all, flat desk colour |

- **Applies immediately, and the menu stays open**, so surfaces can be compared against the real
  desk instead of from memory. This is why §P1 is a dropdown.
- **Persisted at `gtd_surface`** — the `gtd_` prefix, not `gtddev_`, which means **Restore app to
  defaults resets the background too.** ⚑ Judgement call: it is a preference, and "restore to
  defaults" that leaves a non-default appearance in place is lying. Flagged because the opposite
  reading (appearance is chrome, not data) is defensible.
- **A background sets `--desk` as well as `--wood`.** The flat colour under the texture belongs to
  the surface; they are not independently choosable, and should not become so without a reason.
- ⚑ **The picker's swatch is a colour sample, not a texture sample** — a two-stop ramp of that
  surface's own tones. Both texture options were tried and rejected *by looking at them*: a 512px
  tile shrunk into a 20px chip averages its own grain into a flat square, and a chip rendered
  natively at 20px puts the fibre frequency past Nyquist and aliases into mud. These woods are all
  near-black by design, so colour is the most a chip that size can honestly carry.

**Open (§P2-o).**
- Should Slate live in a "Backgrounds" list at all, or does a non-wood surface want its own
  grouping once there are more than five?
- Light mode is *not* addressed here. The whole palette is dark-only; a light desk is a much larger
  change than a texture swap and does not belong in this section.

---

## §P3 Language — declared, not built

The menu carries a **Language** row that is visibly `not built yet` and disabled.

**Why list it at all.** The slot is real and the work is intended, so the menu says so. Hiding a
planned feature until the day it ships teaches nothing; a disabled row with an honest label sets an
expectation and costs one line.

**What it implies, recorded now so it is not discovered late.** Every user-facing string in this app
is currently a literal inside a template string in `app.js` / `events.js`, and a great many of them
carry meaning through *placeholder text* rather than labels (CLAUDE.md: "no field labels"). A
language pass is therefore a string-extraction pass first and a translation second, and the
placeholder-carries-the-teaching convention is the hard part — placeholders are longer and more
idiomatic than labels, and they are the thing a new user reads.

**Related, and deliberately separate: the jargon pass.** The app is littered with GTD-book
vocabulary ("tickler", "next actions", "someday/maybe") and development jargon, which a user
unfamiliar with the system reads as noise. That pass is scheduled for chunk 9 and is *not* the same
work as translation — but it should happen **first**, because translating jargon multiplies it. Two
strings were already changed ahead of that pass, in the calendar creation row: the "time makes it an
appointment" hint (deleted) and "Tickler — keep off the calendar & reminders until its day" (now
"Hide until the day it happens").

---

## §P4 The desk surface is generated, not shipped

`src/surface.js`. The texture is **generated at boot into a data URI** and handed to CSS as
`--wood`, which is exactly where the old baked base64 string sat — nothing downstream changed.

**What was wrong with the old one.** It was `feTurbulence` fractal noise at `baseFrequency
"0.9 0.010"`: noise stretched into horizontal streaks. Streaks are not grain.

**What wood actually is.** Growth *rings* — roughly parallel bands, warped by the tree's own
irregularity — plus a fibre texture running along them. **Noise alone cannot produce rings, however
it is stretched**, because a ring is a *periodic function that noise displaces*. That construction
is Perlin's own (the wood example in his 1985 paper, the same trick as his marble):

```
warp = fbm(u, v)                     ← Perlin, several octaves
r    = v · RINGS + warp · WARP       ← noise displaces the bands
d    = |2 · frac(r) − 1|             ← triangle wave, 0 mid-band
ring = smoothstep(weight, 1, d)      ← a NARROW dark line, not a soft sine
shade = base_tone + fibre + pore − ring · DEPTH
```

Three things that were arrived at by rendering and looking, and are worth not re-deriving:
- **Rings must cut into the base tone (subtractive), not be mixed against it.** Mixing flattens the
  whole thing into painted stripes.
- **The ring line must be narrow.** A wide soft band reads as a stripe; a narrow one reads as timber.
- **Ring weight varies along its length**, driven by the fibre field. A uniform stroke looks printed.

**Tileable by construction.** The tile repeats across the viewport, so a seam would show as a grid.
Every lattice coordinate is wrapped modulo a per-axis period, and each octave doubles its period
alongside its frequency — so the noise is exactly periodic over the tile and the edges match with no
blending, mirroring, or fade.

**The tile is 512px, not 256.** At 256 the same ring wave recurs every 256px down the page and the
eye locks onto the repeat immediately. 512 quarters how often that happens, for ~40ms more
generation paid once at boot.

**Fallback.** If the canvas is unavailable, `--wood` stays at its CSS default of `none` and the desk
is the flat `--desk` colour. ⚑ The fallback is deliberately *not* the old feTurbulence texture: if
the good texture can't be made, a clean surface beats a bad one.

**Open (§P4-o).**
- Grain runs horizontally, always. Should it follow device orientation?
- Tiles are regenerated on every boot rather than cached in `localStorage`. That is currently the
  right trade (a 512px PNG data URI is large, and the storage adapter is already the app's known
  ceiling risk — see `storage.js`), but it is worth revisiting if boot time ever matters.

---

## §P6 The habit runner

A stick figure that runs your habit back to you, mounted on the **habit page**, above the dot
track. `src/runner.js` (12 scenes, inline SVG + CSS keyframes) plus `habitRunnerState()` in
`app.js`, which decides which scene the habit is actually in.

**The runner is a VIEW of the run engine, never a second source of truth.** Every input it reads
already exists in `habitRuns`, and the dot track directly beneath it is drawn from the same
numbers. If the figure and the dots ever disagree, the mapping is wrong — not the engine.

**It sits above the track deliberately:** the figure is the feeling, the dots are the record, and
the record should read as the evidence for the feeling.

**Draft isolation covers it.** The mapping reads `draft.done` / `draft.schedule` / `draft.paused`
exactly as the dot track does, so the figure reacts the instant the badge is tapped and reverts on
✕ along with everything else.

**The mapping**, in priority order — the order matters, the conditions overlap:

| # | scene | fires when |
|---|---|---|
| 11 | `rest_reading` | paused, or an off-day. **Checked first** — a paused habit is resting whatever its history says |
| 3 / 12 / 8 | `pb_end_celebration` / `tie_celebration` / `run_end_no_pb` | `pendingResult` is `record` / `tie` / `short`. Same signal the celebration banner consumes, so the two can never disagree |
| 10 | `fresh_start_stretch` | the lap hasn't started. Lap one gets the `_first` copy variant |
| 9 | `pb_overtake` | `doneCount === personalBest + 1` |
| 1 / 2 | `run_solo` / `stumble_solo` | no record exists yet — **or the ghost's sequence has run out**, because past its end there is nobody to race |
| 4–7 | the ghost pairs | you × ghost, clean × stumbled, at the same point on the track |

**⚠ Two traps, both found by building it:**

- **`pb_overtake` needs no "already fired" flag.** `doneCount === personalBest + 1` is true on
  exactly one day and then the count moves past it on its own. Adding a flag would be state that
  can desync.
- **The ghost must be read at the point the scene DEPICTS, not always at today.** When you are
  running clean that point is today; when the scene is your stumble it is the last *recorded* day.
  Comparing a stumble at index `n−1` against the ghost at index `n` rendered "you stumbled, the
  record was clean" every time the record had in fact stumbled beside you — which inverts the
  emotional content of the scene. Caught by `checks/habit_runner_states.py`, not by looking at it.

**The chalkboard.** The module ships black-on-cream and exposes four colour variables
(`--runner-ink`, `--runner-ghost`, `--runner-bubble-bg`, `--runner-ground`), so the restyle is a
palette swap plus the board — **the artwork is untouched**. Slate green rather than black, because
a true-black board on a near-black desk loses its edge. The bubble is *outlined* in chalk rather
than filled. Chalk dust is generated by the same Perlin machinery as the desk (§P4): eraser smears
are noise stretched along the sweep direction, with a fine speckle over the top. ⚑ Reversed once —
high-x/low-y frequency gave vertical streaks that read as rain on a window.

**Not yet wired: the locale.** `BUBBLE_COPY` already carries English and 简体中文 and the instance
exposes `setLocale()`, but the app mounts it hard-coded to `en`. **This is the first real precedent
for §P3** and the language pass should adopt it rather than invent a second mechanism.

**⚑ `runner-demo.html` stays at the repo root** as the design reference. It inlines its own copy of
the module, so it keeps working independently — but that means **it does not track changes to
`src/runner.js`.** If the artwork is edited, the demo goes stale silently.

---

## §P5 The app is called OELA

**Was:** GTD Console. **Is:** **OELA**, the **Over-Engineered List App**.

**Why.** "Getting Things Done" and "GTD" are claimed marks of the David Allen Company. Shipping a
product *named* GTD Console — installable, with that name on the home screen — is the exposed
position, however small the audience.

**Where the line is drawn.** The **product name** is renamed everywhere it is user-visible or
identifying: the wordmark, the page title, the web manifest (`name` / `short_name`), the export
file's `app` field and filename, and the doc titles. **Descriptive references to the GTD
*methodology* stay** — "a GTD-inspired task manager", "GTD contexts" — because describing the method
a tool is built on is not the same act as branding a product with the mark. If that reading is
wrong, the remaining mentions are all in prose and are a find-and-replace away.

⚑ **The `gtd_` localStorage prefix is deliberately NOT renamed.** It is invisible plumbing — never
shown, never exported as a name, carrying no trademark exposure — and renaming it would orphan the
current test data and every backup file already exported, in exchange for nothing. The cost of
changing it later is the same as the cost of changing it now, so it can wait for a reason. Note that
`§1`'s "migrations are optional until real use begins" is what makes that true; **once real use
starts, this decision hardens.**

**Not done, and the author's to do:** the GitHub repository itself is still named `GTD`.

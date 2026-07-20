# Chunk 0b certification suite

Backup automated coverage for the spec §2 mandate: **chunk 0b changes nothing
about behavior** except four enumerated deltas. Written to run alongside your
by-hand pass, not replace it.

## The idea (why this works without me hardcoding expected behavior)

"No behavior change before and after 0b" is a **before/after** claim, so the
suite compares two builds running the *same* interactions and asserts they
agree. Correctness is defined as "the post-0b build does exactly what the
pre-0b build did" — so `test_parity.py` never encodes what the app *should* do,
only that the two builds match. The four intended changes are tested
separately, in `test_0b_deltas.py`, against the new build alone.

```
test_parity.py     unintended changes  -> baseline vs candidate must MATCH
test_0b_deltas.py  the 4 intended ones -> candidate must have CHANGED
```

## Point it at two builds

```bash
GTD_BASELINE=path/to/pre-0b/index.html \   # the build right BEFORE 0b (post-0a)
GTD_CANDIDATE=path/to/dist/index.html \    # your 0b result
python3 -m pytest tests/chunk0b/ -v
```

- `test_parity.py` needs **both**. If either env var is unset/missing it
  **skips** (won't fail the run), so the file is safe to keep in the tree.
- `test_0b_deltas.py` needs only `GTD_CANDIDATE`.

> The correct baseline is the build **immediately before 0b** (i.e. after 0a) —
> *not* `index-47`. index-47 is pre-sprint; all of 0a's deletions sit between it
> and 0b, so it is not a zero-behavior-change baseline. If you have git, the
> baseline is just the parent commit's `dist/index.html`.

## The four intended deltas it checks (spec §2 row)

1. Header `<span class="sub">` "Runs on its own" is **removed**.
2. Web manifest shipped — name `Over-Engineered List App` (short name `OELA`), `theme_color #171513`,
   `display standalone`, `orientation portrait*`; plus `<meta name=theme-color>`.
3. All `localStorage` behind the adapter, which **catches + surfaces**
   `QuotaExceededError` instead of throwing uncaught (§3 known issue 4).
4. **No** service worker (that's chunk 9).

## Before this runs green — confirm the selectors

I built these from the spec because the app HTML didn't upload, so every DOM
assumption is centralized and marked `CONFIRM` in **`_app.py`** (`SEL` dict) and
in the scenario bodies in `test_parity.py`. Fix any wrong ones once, in `_app.py`.

Telling the two failure kinds apart:

- **Wrong selector** → the step fails the *same way on both builds* (it can't
  run). Setup bug. Fix the selector.
- **Real regression** → a *mismatch between* baseline and candidate. That's the
  signal you want.

Specific things to verify against the real build:

- `fab`, `title_input`, `save_btn`, `cancel_btn` — the create/edit flow the
  scenarios drive.
- `lane_container`, `card` — how a lane and a task card are marked up.
- `qa_group`, `chunkmap_group` — the injected QA checklist (§8.1) and chunk map
  (§8.2). These are **excluded** from parity snapshots because they
  legitimately differ per chunk; if the exclusion selectors are wrong, parity
  will show noise. If they're right, parity is clean.
- `sub_brand`, `confirm_dialog` — for the delta tests.

If a storage key legitimately changes between two adjacent chunks, add it to
`VOLATILE_KEY_SUBSTR` in `_app.py` (already contains the QA checklist, chunk
map, and schema version).

## Extending

`SCENARIOS` in `test_parity.py` is a plain list — add any user flow (move
cross-lane and confirm the id is preserved per §1; contexts; validation dashed
outline; reset re-seeds). Each new scenario is self-certifying: it just has to
produce the same result on both builds.

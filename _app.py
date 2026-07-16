"""
The app driver + the single place every DOM assumption lives.

>>> IMPORTANT <<<
I wrote these tests from the SPEC, not the running app (the index-47 HTML build
didn't upload). Every selector below is my best read of the spec and is marked
CONFIRM. When you wire this against the real build, fix any that are wrong HERE,
once, and every test picks up the change.

How to tell a wrong-selector failure from a real behavior-change failure:
  - A wrong selector fails on BOTH builds identically (the step can't run) ->
    it's a setup bug, fix the selector.
  - A real regression fails as a *mismatch between* baseline and candidate ->
    that's the thing we're hunting.

>>> HARNESS BUG FOUND AND FIXED WHILE WIRING UP CHUNK 0b <<<
genId() is `"local-" + Date.now().toString(36) + "-" + Math.random()...` — a
fresh id every seed, even reloading the IDENTICAL build twice (verified: run
this suite with GTD_BASELINE == GTD_CANDIDATE and the "parity" tests still
fail on live ids). That's correct app behavior, not a 0b regression, and nothing
0b should "fix" — but it means comparing storage JSON / rendered HTML byte-for-
byte can never pass. normalize_ids_in() below replaces every genId()-shaped
token with a stable positional placeholder, shared across everything compared
in one assertion, so a conditionId that points at another item's id still
points at the same placeholder after normalization.
"""

import json
import re

_ID_PATTERN = re.compile(r"local-[0-9a-z]+-[0-9a-z]+")


def normalize_ids_in(*objs):
    """Replace genId()-shaped ids with stable placeholders (ID0, ID1, ...),
    one independent numbering PER OBJECT passed in (not shared across objs).
    Each object is one build's output — e.g. its storage dump, or its
    {storage, lanes_html} probe — and the ids inside it get numbered by
    first-appearance order (sorted dict keys, then in-string order), which
    is deterministic given the same seed code runs in the same order on
    both builds. Cross-references *within* one object (a conditionId
    pointing at another item's id, possibly in a different dict key or in
    the rendered HTML) still resolve to the same placeholder, because both
    live under that object's one mapping. Returns a tuple of normalized
    structures, same shape and order as the input.
    """

    def normalize_one(o):
        mapping = {}

        def register(raw):
            if raw not in mapping:
                mapping[raw] = "ID%d" % len(mapping)

        def walk_register(x):
            if isinstance(x, dict):
                for k in sorted(x):
                    walk_register(x[k])
            elif isinstance(x, str):
                for m in _ID_PATTERN.finditer(x):
                    register(m.group(0))

        def walk_sub(x):
            if isinstance(x, dict):
                return {k: walk_sub(v) for k, v in x.items()}
            if isinstance(x, str):
                return _ID_PATTERN.sub(lambda m: mapping[m.group(0)], x)
            return x

        walk_register(o)
        return walk_sub(o)

    return tuple(normalize_one(o) for o in objs)


DEV_CONTEXTS = ("qa-checklist", "chunk-map")


def _is_dev_group(item):
    if not item.get("isGroup"):
        return False
    if item.get("devContext") in DEV_CONTEXTS:
        return True
    # Baseline (pre-0b) has no devContext attribute at all — that tagging is
    # new in this chunk. Its QA checklist is only identifiable the way the
    # injector itself identifies stale rounds to sweep: a title starting
    # with "✅ QA" (see injectQAChecklist's own staleGroupIds check). Matching
    # that same convention here keeps stripping symmetric across an
    # untagged baseline and a tagged candidate.
    title = item.get("title") or ""
    return title.startswith("✅ QA")


def strip_dev_scaffolding(dump):
    """Remove the dev-injected QA-checklist / chunk-map groups (and their
    children) from a storage dump's gtd_tasks_* values before comparing.

    Mirrors the exclusion _lane_probe already applies to the DOM (querying
    out [data-context] groups) — storage and DOM parity should use the same
    invariant: compare the app's real state, not this chunk's dev
    scaffolding, which legitimately differs every chunk by design (spec.md
    §8.1/§8.2). Without this, the differing *count* of injected items shifts
    normalize_ids_in's shared id numbering for every key that sorts after
    the affected one, making genuinely-identical keys (e.g. gtd_tasks_future)
    show up as mismatched too — apply this before normalize_ids_in, not after.
    """
    out = {}
    for key, val in dump.items():
        if not key.startswith("gtd_tasks_") or val is None:
            out[key] = val
            continue
        try:
            items = json.loads(val)
        except (ValueError, TypeError):
            out[key] = val
            continue
        dev_group_ids = {item.get("id") for item in items if _is_dev_group(item)}
        if not dev_group_ids:
            out[key] = val
            continue
        filtered = [
            item for item in items
            if item.get("id") not in dev_group_ids and item.get("parent") not in dev_group_ids
        ]
        out[key] = json.dumps(filtered, separators=(",", ":"))
    return out

# ---------------------------------------------------------------------------
# SELECTORS  — CONFIRM every one against the real dist/index.html
# ---------------------------------------------------------------------------
SEL = {
    # header / brand (§4.10). The sub-brand line is the one 0b deletes.
    # CONFIRMED against src/index.html + src/app.js as of chunk 0b.
    "brand": ".brand",
    "sub_brand": "header .sub",                        # spec names <span class="sub">; 0b deletes it
    "points_counter": ".points, #points, [data-points]",  # must NOT exist (deleted 0a)
    # NOT YET BUILT: intray (📥) and calendar (📅) are header items scheduled
    # for chunk 2 / chunk 6 (spec.md §4.10 row), not 0a/0b. index-47.html's
    # header has never had them. Kept here (matching nothing today) so this
    # file doesn't need touching again when those chunks land; test_0b_deltas
    # no longer asserts their presence — see the comment there.
    "intray_btn": '[data-action="intray"], header .intray',
    "calendar_btn": '[data-action="calendar"], header .calendar',

    # lanes / tabs (§1: five lanes)
    "lane_tab": "[data-kind]",                    # both the switcher buttons and .lane carry data-kind
    "lane_container": "#lanes",                   # the single rendered lanes root
    "card": ".card-title",                        # carries data-action="open-edit" + data-id; reliably clickable

    # capture / create
    "fab": "#fab-create",                              # + FAB, data-action="open-create"
    "title_input": "[data-field='title']",
    "save_btn": "[data-action='screen-save']",         # ← save+exit (§4.6)
    "cancel_btn": "[data-action='screen-cancel']",     # ✕ discard (§4.6)
    "delete_btn": "[data-action='screen-delete']",     # 🗑 immediate (§4.6), edit-page trash icon

    # edit-page controls that must obey draft isolation (CLAUDE.md)
    "complete_toggle": "[data-action='screen-complete']",  # arms on tap, commits on save
    "convert_control": "[data-action='make-kind']",        # "Make Waiting/Next/Current/Future" pill

    # destructive confirm dialog (openConfirmDialog; native confirm() is banned)
    "confirm_dialog": ".choice-dialog-backdrop",
    "confirm_ok": ".choice-dialog-btns button.primary",   # the non-Cancel button in a 2-button dialog

    # dev tools that get injected into the lane every chunk — EXCLUDE from parity
    # snapshots (their content legitimately differs per chunk: §8.1 / §8.2).
    # These are tagged with a plain `data-context` attribute on the .group
    # wrapper (added in chunk 0b) purely so tooling — this suite — can find
    # and exclude them without matching on their per-chunk title text. It's
    # inert markup: no visual or behavioral effect, nothing else reads it.
    "qa_group": "[data-context='qa-checklist']",
    "chunkmap_group": "[data-context='chunk-map']",
}

# Storage keys (§3). Split so parity can ignore the ones that are *meant* to
# differ between two adjacent chunk builds.
APP_KEY_PREFIX = "gtd_"
DEV_KEY_PREFIX = "gtddev_"

# Keys whose *value* legitimately differs pre/post-0b and must be excluded from
# any before/after equality check:
VOLATILE_KEY_SUBSTR = (
    "gtd_qa_checklist",   # §8.1 each chunk injects its own, replacing the last
    "gtd_chunk_map",      # §8.2 same
    "gtd_schema_version", # may bump; a bump is allowed and is asserted separately
)


def is_volatile_key(key: str) -> bool:
    return key.startswith(DEV_KEY_PREFIX) or any(s in key for s in VOLATILE_KEY_SUBSTR)


# ---------------------------------------------------------------------------
# Build driver
# ---------------------------------------------------------------------------
class Build:
    """Wraps one page loaded from one build URL, freshly seeded."""

    def __init__(self, browser, url, name):
        self.name = name
        self.context = browser.new_context()
        self.page = self.context.new_page()
        self.page.goto(url, wait_until="load")
        self.reset_to_seed()

    def close(self):
        self.context.close()

    # -- lifecycle ----------------------------------------------------------
    def reset_to_seed(self):
        """Clear storage and reload so the app re-seeds fresh sample data.

        §1: 'let Reset seed fresh data'. A clean localStorage on load is the
        seed path. gtddev_ keys are meant to survive Reset, but for a parity
        baseline we want a fully deterministic start, so we clear everything.
        """
        self.page.evaluate("() => localStorage.clear()")
        self.page.reload(wait_until="load")
        # give the app a beat to render the seeded lanes
        self.page.wait_for_timeout(150)

    # -- storage ------------------------------------------------------------
    def storage_dump(self, include_volatile=False):
        raw = self.page.evaluate(
            """() => {
                const out = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    out[k] = localStorage.getItem(k);
                }
                return out;
            }"""
        )
        if include_volatile:
            return raw
        return {k: v for k, v in raw.items() if not is_volatile_key(k)}

    def storage_keys(self, include_volatile=False):
        return sorted(self.storage_dump(include_volatile).keys())

    def get_key(self, key):
        return self.page.evaluate("(k) => localStorage.getItem(k)", key)

    # -- DOM ----------------------------------------------------------------
    def html(self, selector):
        el = self.page.query_selector(selector)
        return el.inner_html() if el else None

    def exists(self, selector):
        return self.page.query_selector(selector) is not None

    def count(self, selector):
        return len(self.page.query_selector_all(selector))

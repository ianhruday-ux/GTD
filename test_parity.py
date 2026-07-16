"""
BEFORE/AFTER PARITY — the core certification of chunk 0b's "zero behavior
change" mandate (spec §2).

Model: run the *same* user interaction against the pre-0b build (BASELINE) and
the post-0b build (CANDIDATE); assert they end in the same state. Equality is
the assertion, so these tests don't hard-code any expected app behavior — they
only require the two builds to agree.

Two layers:
  1. Seed-shape parity  — the storage schema the app writes on a fresh seed is
     identical (minus keys that are *supposed* to differ per chunk, see _app).
  2. Scenario parity    — a list of user flows; each runs on both builds and
     the touched storage + rendered DOM must match.

Requires GTD_BASELINE and GTD_CANDIDATE (see conftest). Skips if either absent.
"""

import pytest

from _app import Build, SEL, normalize_ids_in, strip_dev_scaffolding


# ---------------------------------------------------------------------------
# Layer 1: fresh-seed schema parity
# ---------------------------------------------------------------------------
def test_seed_storage_keys_match(browser, baseline_url, candidate_url):
    """The set of app-storage keys written on a fresh seed is unchanged.

    This catches a storage-adapter refactor (§3: all localStorage moves behind
    src/storage.js) that accidentally renames, drops, or adds a key.
    """
    base = Build(browser, baseline_url, "baseline")
    cand = Build(browser, candidate_url, "candidate")
    try:
        assert cand.storage_keys() == base.storage_keys(), (
            "Fresh-seed storage schema diverged.\n"
            f"  only in baseline:  {sorted(set(base.storage_keys()) - set(cand.storage_keys()))}\n"
            f"  only in candidate: {sorted(set(cand.storage_keys()) - set(base.storage_keys()))}"
        )
    finally:
        base.close()
        cand.close()


def test_seed_storage_values_match(browser, baseline_url, candidate_url):
    """Beyond keys, the seeded *values* match (minus volatile per-chunk keys).

    The QA checklist and chunk map legitimately differ per chunk and are
    excluded in _app.is_volatile_key. Everything else — the seeded lanes,
    habits (§4.16), contexts — should be structurally identical (ids are
    normalized first — see _app.normalize_ids_in; genId() mints a fresh id
    every seed by design, even reloading the same build twice).
    """
    base = Build(browser, baseline_url, "baseline")
    cand = Build(browser, candidate_url, "candidate")
    try:
        b, c = base.storage_dump(), cand.storage_dump()
        b, c = strip_dev_scaffolding(b), strip_dev_scaffolding(c)
        b, c = normalize_ids_in(b, c)
        mismatched = sorted(k for k in set(b) | set(c) if b.get(k) != c.get(k))
        assert not mismatched, (
            "Seeded storage values diverged for keys: "
            f"{mismatched}\n(If one of these is legitimately chunk-specific, add "
            "it to VOLATILE_KEY_SUBSTR in _app.py.)"
        )
    finally:
        base.close()
        cand.close()


# ---------------------------------------------------------------------------
# Layer 2: scenario parity
#
# Each scenario is a function(Build) -> None that performs user actions. The
# runner executes it on both builds from an identical fresh seed, then compares
# a "probe" of the resulting state. Add scenarios freely; they cost nothing to
# certify because correctness == "both builds agree".
# ---------------------------------------------------------------------------
def _lane_probe(build):
    """A stable, dev-scaffolding-free view of the visible lanes + app storage."""
    return {
        "storage": build.storage_dump(),  # volatile keys already excluded
        # DOM of the lane area minus the injected QA / chunk-map groups, which
        # differ per chunk by design. CONFIRM the exclusion selectors in _app.
        "lanes_html": build.page.evaluate(
            """(sel) => {
                const root = document.querySelector(sel.lane_container) || document.body;
                const clone = root.cloneNode(true);
                for (const s of [sel.qa_group, sel.chunkmap_group]) {
                    clone.querySelectorAll(s).forEach(n => n.remove());
                }
                // Fallback for a pre-0b baseline: it has no data-context
                // attribute at all (new this chunk), so its QA checklist
                // group is only identifiable by title text — the same
                // "✅ QA" prefix injectQAChecklist itself sweeps by.
                clone.querySelectorAll('.group').forEach(function(g){
                    const t = g.querySelector('.group-title');
                    if (t && t.textContent.indexOf('✅ QA') === 0) g.remove();
                });
                // The lane-tab's .count badge was rendered from the
                // un-stripped array length, so removing scaffolding above
                // leaves it stale (e.g. baseline's old 1-group/5-item QA
                // checklist vs candidate's 2-group/7-item one land on
                // different counts for reasons that have nothing to do with
                // real behavior). Recompute each lane's badge from what
                // actually remains in the clone.
                clone.querySelectorAll('.lane').forEach(function(laneEl){
                    const countEl = laneEl.querySelector('.lane-tab .count');
                    if (!countEl) return;
                    const remaining = laneEl.querySelectorAll('.group').length +
                        laneEl.querySelectorAll('.card-title').length;
                    countEl.textContent = String(remaining);
                });
                // strip volatile attrs that don't imply behavior
                clone.querySelectorAll('[style]').forEach(n => n.removeAttribute('style'));
                return clone.innerHTML;
            }""",
            SEL,
        ),
    }


def _run_on_both(browser, baseline_url, candidate_url, scenario, probe=_lane_probe):
    base = Build(browser, baseline_url, "baseline")
    cand = Build(browser, candidate_url, "candidate")
    try:
        scenario(base)
        scenario(cand)
        pb, pc = probe(base), probe(cand)
        return pb, pc
    finally:
        base.close()
        cand.close()


# ---- scenarios -------------------------------------------------------------
# NOTE: the bodies use SEL selectors; CONFIRM them. Kept intentionally small
# so a wrong selector is obvious (it fails identically on both builds).

def _create_next_action(build):
    build.page.click(SEL["fab"])
    build.page.fill(SEL["title_input"], "buy stamps")
    build.page.click(SEL["save_btn"])
    build.page.wait_for_timeout(100)


def _create_then_cancel(build):
    """Draft isolation (CLAUDE.md): ✕ must persist NOTHING."""
    build.page.click(SEL["fab"])
    build.page.fill(SEL["title_input"], "should not persist")
    build.page.click(SEL["cancel_btn"])
    build.page.wait_for_timeout(100)


def _complete_arms_but_does_not_commit_until_save(build):
    """Complete is draft-only: arming then ✕ leaves the item un-completed."""
    build.page.click(SEL["fab"])
    build.page.fill(SEL["title_input"], "draft complete test")
    build.page.click(SEL["save_btn"])
    build.page.wait_for_timeout(50)
    # reopen, arm complete, cancel -> must remain active
    card = build.page.query_selector(SEL["card"])
    if card:
        card.click()
        build.page.click(SEL["complete_toggle"])
        build.page.click(SEL["cancel_btn"])
    build.page.wait_for_timeout(100)


SCENARIOS = [
    pytest.param(_create_next_action, id="create-next-action-persists"),
    pytest.param(_create_then_cancel, id="draft-cancel-persists-nothing"),
    pytest.param(
        _complete_arms_but_does_not_commit_until_save,
        id="complete-is-draft-only",
    ),
]


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_scenario_parity(browser, baseline_url, candidate_url, scenario):
    pb, pc = _run_on_both(browser, baseline_url, candidate_url, scenario)
    # Dev scaffolding (QA checklist / chunk map) legitimately differs every
    # chunk and lives inside gtd_tasks_* alongside real data, so it's
    # stripped from the storage side the same way lanes_html already
    # excludes it from the DOM side (_lane_probe). Then ids are normalized —
    # genId() mints a fresh id every seed by design, even reloading the same
    # build twice (_app.normalize_ids_in) — and strip must run BEFORE
    # normalize, or the differing scaffolding item count shifts the shared
    # id numbering for unrelated keys too.
    pb["storage"] = strip_dev_scaffolding(pb["storage"])
    pc["storage"] = strip_dev_scaffolding(pc["storage"])
    pb, pc = normalize_ids_in(pb, pc)

    assert pc["storage"] == pb["storage"], (
        "Post-scenario storage diverged between builds.\n"
        f"  baseline keys : {sorted(pb['storage'])}\n"
        f"  candidate keys: {sorted(pc['storage'])}"
    )
    assert pc["lanes_html"] == pb["lanes_html"], (
        "Post-scenario rendered lanes diverged between builds — the refactor "
        "changed visible behavior."
    )

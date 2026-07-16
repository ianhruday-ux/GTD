"""
The four deliberate changes chunk 0b IS allowed/required to make (spec §2 row).
These run against the candidate (post-0b) build only — they assert the delta
happened, so there's nothing to compare against the baseline.

A "zero behavior change" refactor still has an exact, enumerated set of intended
changes. Testing them both directions matters: the parity suite catches
*unintended* changes; this file catches a 0b that *forgot* a required one.

  1. Header sub-brand line "Runs on its own" (<span class="sub">) is deleted.
  2. Web manifest shipped: name "GTD Console", theme #171513, standalone, portrait.
  3. localStorage is fully behind a storage adapter that catches + surfaces
     QuotaExceededError (§3 known issue 4) instead of throwing uncaught.
  4. Still NO service worker (deferred to chunk 9; CLAUDE.md).

Only needs GTD_CANDIDATE.
"""

import json

import pytest

from _app import Build, SEL


@pytest.fixture
def app(browser, candidate_url):
    b = Build(browser, candidate_url, "candidate")
    yield b
    b.close()


# ---------------------------------------------------------------------------
# 1. The orphaned sub-brand line is gone
# ---------------------------------------------------------------------------
def test_subbrand_line_removed(app):
    assert not app.exists(SEL["sub_brand"]), (
        "Header still renders the <span class='sub'> sub-brand line; 0b deletes it."
    )
    # belt and suspenders: the literal string shouldn't survive anywhere visible
    body = app.page.inner_text("body")
    assert "Runs on its own" not in body, (
        "'Runs on its own' tagline still present after 0b."
    )


def test_header_still_has_its_real_controls(app):
    """Deleting the sub-line must not disturb the rest of the header (§4.10)."""
    # brand remains; points counter stays gone (deleted 0a). NOTE: intray (📥)
    # and calendar (📅) are NOT asserted here — per spec.md §4.10's own chunk
    # row they land in chunk 2 / chunk 6, not 0a/0b, and index-47.html's
    # header has never had them. Asserting them here was this suite's own
    # scope-boundary error (written from the spec's *eventual* header shape,
    # not 0b's), not a wrong selector; fixed rather than the app.
    assert app.exists(SEL["brand"]), "wordmark/brand missing from header"
    assert not app.exists(SEL["points_counter"]), (
        "a points counter is present — the points layer was deleted in 0a and "
        "§4.10 says leave no gap for it."
    )


# ---------------------------------------------------------------------------
# 2. Web manifest + icons
# ---------------------------------------------------------------------------
def test_manifest_linked_and_valid(app):
    href = app.page.get_attribute('link[rel="manifest"]', "href")
    assert href, "no <link rel='manifest'> in the document head"

    # fetch the manifest from the page's own origin
    manifest = app.page.evaluate(
        """async (href) => {
            const r = await fetch(href);
            if (!r.ok) return {__error: r.status};
            return await r.json();
        }""",
        href,
    )
    assert "__error" not in manifest, f"manifest fetch failed: {manifest}"

    assert manifest.get("name") == "GTD Console", f"name: {manifest.get('name')!r}"
    assert manifest.get("theme_color", "").lower() == "#171513", (
        f"theme_color: {manifest.get('theme_color')!r} (spec: #171513, 'the desk')"
    )
    assert manifest.get("display") == "standalone", (
        f"display: {manifest.get('display')!r}"
    )
    # portrait-locked (single-column mobile layout — landscape is out of scope)
    assert "portrait" in (manifest.get("orientation") or ""), (
        f"orientation: {manifest.get('orientation')!r} (spec: portrait-locked)"
    )
    assert manifest.get("icons"), "manifest declares no icons"


def test_theme_color_meta_present(app):
    meta = app.page.get_attribute('meta[name="theme-color"]', "content")
    assert (meta or "").lower() == "#171513", (
        f"<meta name=theme-color> is {meta!r}; spec wants #171513."
    )


# ---------------------------------------------------------------------------
# 3. Storage adapter surfaces QuotaExceededError instead of throwing uncaught
#    (§3 known issue 4: an uncaught QuotaExceededError mid-save leaves state
#     half-written with no user-visible error.)
# ---------------------------------------------------------------------------
def test_quota_exceeded_is_surfaced_not_thrown(browser, candidate_url):
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        page.goto(candidate_url, wait_until="load")
        page.evaluate("() => localStorage.clear()")
        page.reload(wait_until="load")

        # Track any uncaught page errors — the failure mode we're guarding against.
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # Force the very next setItem to throw a QuotaExceededError, the way a
        # full localStorage would. The adapter must catch this.
        page.evaluate(
            """() => {
                const real = Storage.prototype.setItem;
                let armed = true;
                Storage.prototype.setItem = function (k, v) {
                    // let dev/plumbing writes through; trip on the next app write
                    if (armed && String(k).startsWith('gtd_')) {
                        armed = false;
                        const err = new DOMException('quota', 'QuotaExceededError');
                        throw err;
                    }
                    return real.call(this, k, v);
                };
            }"""
        )

        # Trigger a save. CONFIRM these selectors drive a persist in the real app.
        page.click(SEL["fab"])
        page.fill(SEL["title_input"], "trip the quota")
        page.click(SEL["save_btn"])
        page.wait_for_timeout(200)

        assert not errors, (
            "QuotaExceededError propagated as an uncaught page error; §3 requires "
            f"src/storage.js to catch and surface it. Errors: {errors}"
        )

        # And it must be *surfaced* — via the app's own dialog, since native
        # alert/confirm are banned app-wide (CLAUDE.md). CONFIRM the selector.
        surfaced = page.query_selector(SEL["confirm_dialog"]) is not None
        # Some builds surface via an inline notice rather than the confirm dialog;
        # fall back to a text probe so the test doesn't over-specify the surface.
        if not surfaced:
            txt = page.inner_text("body").lower()
            surfaced = "storage" in txt and ("full" in txt or "quota" in txt or "space" in txt)
        assert surfaced, (
            "QuotaExceededError was swallowed silently — §3 says it must be "
            "surfaced to the user, not just caught."
        )
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# 4. No service worker yet (CLAUDE.md: not before chunk 9)
# ---------------------------------------------------------------------------
def test_no_service_worker_registered(app):
    # no registration call in the shipped file, and none active at runtime
    registrations = app.page.evaluate(
        """async () => {
            if (!('serviceWorker' in navigator)) return 0;
            const regs = await navigator.serviceWorker.getRegistrations();
            return regs.length;
        }"""
    )
    assert registrations == 0, "a service worker is registered; 0b must not ship one."

    # also assert the source doesn't call register() — cheap static check
    html = app.page.content()
    assert "serviceWorker.register" not in html, (
        "source contains serviceWorker.register(); service worker is chunk 9, not 0b."
    )

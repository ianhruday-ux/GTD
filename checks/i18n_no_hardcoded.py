"""No user-facing English hard-coded past i18n.

THE BUG THIS GUARDS. The intray's capture placeholder was written straight into
the markup as "Capture a thought…" while i18n.js had carried
tray.capturePlaceholder, fully translated, unused, the whole time. A zh-Hans user
got an English prompt on the app's most-used control. Auditing outward from that
one instance turned up twelve more of exactly the same shape — tooltips, the
drawer's empty state, the settings build row, the event page's kind badge — every
one of them a key that existed and was simply never called.

The shape is specific and worth naming: it is NOT "we forgot to translate this",
it is "someone wrote the string twice, translated one copy, and shipped the
other." That is invisible in English and invisible in review, which is why it
needs a machine check.

TWO HALVES, because either alone is fooled:

  · A STATIC sweep of src/ for literal English in title=/placeholder= attributes
    inside generated markup. Catches the bug at the moment it is written, in the
    file where it is written.
  · A RUNTIME pass that switches the app to Chinese and reads the surfaces that
    were wired up. Catches a key that exists, is called, and still renders
    English because the call was wrong.

⚠ The static half deliberately ignores src/index.html's static <button> markup
and the dev toolbar. index.html's tray handle IS stamped at runtime
(renderTabLabels), which the runtime half verifies; the dev tools are debug
scaffolding the author has ruled stays English.
"""
import os, re, functools, http.server, socket, socketserver, threading, contextlib, sys
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(REPO, "dist")
SRC = os.path.join(REPO, "src")


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


@contextlib.contextmanager
def serve(d):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), functools.partial(Q, directory=d))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{port}/index.html"
    finally:
        httpd.shutdown(); httpd.server_close()


fails, notes = [], []
def check(cond, msg):
    (notes if cond else fails).append(("PASS " if cond else "FAIL ") + msg)


# ---------------------------------------------------------------- static half
# A literal like  title="Mark complete"  in a JS string that builds markup.
# Anything routed through t() is fine, and so is a single capitalised word that
# is almost always an attribute value rather than prose (e.g. type="Button").
PATTERNS = [
    # title="Mark complete"  — an attribute written straight into the markup
    ("attribute", re.compile(r'(?:title|placeholder|aria-label)="([A-Z][a-z]+(?:[^"\'{}]*[a-z])?)"')),
    # >Empty for now …<     — VISIBLE text between tags. Added after the first
    # sweep (attributes only) shipped a fix for the reveal button's tooltip and
    # left the English label right next to it: inline text is the same bug in
    # different clothes. Entities (&times;) and single words that are usually
    # markup are excluded.
    ("inline text", re.compile(r'>([A-Z][a-z]+(?:\s+[A-Za-z’\',.—-]+){2,})<')),
    # ? "Hide" : "Reveal"   — the two-state label, which is how that one hid.
    # ⚠ WIDENED after this pattern shipped as single-word-only and promptly let
    # `(paused ? "Paused — unpause to complete" : "Mark done for today")` walk
    # past it on the very next sweep. Both arms may now be whole phrases.
    ("label ternary", re.compile(
        r'\?\s*"([A-Z][a-z][^"]*)"\s*:\s*"[A-Z][a-z][^"]*"')),
    # openConfirmDialog("Some sentence.", …) and { label: "Delete all" }
    ("confirm body", re.compile(r'openConfirmDialog\(\s*"([A-Z][^"]{8,})"')),
    # A DIALOG option, not any object with a `label:` field — the SURFACES table
    # in surface.js uses `label:` for data, and its English literals are the
    # deliberate fallback behind surfaceLabel(). Requiring style:/action: on the
    # same line separates a button from a record.
    ("dialog button", re.compile(r'\blabel:\s*"([A-Z][a-z][^"]*)"(?=[^\n]*\b(?:style|action):)')),
]

# Debug scaffolding the author has ruled stays English (the dev toolbar and its
# dialogs). Matched on content because these lines carry no gtddev_ marker of
# their own — the keys live in the DEV_GROUPS table further up.
DEV_TEXT = re.compile(r'snapshot|Snapshot|Drag log|Time jump|QA checklist|chunk map', re.I)
offenders = []
for name in ("app.js", "events.js", "pickers.js", "chunkMap.js", "surface.js"):
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        continue
    dev_window = 0
    for i, line in enumerate(open(path, encoding="utf-8").read().splitlines(), 1):
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        # Debug scaffolding stays English. The marker often sits on the dialog's
        # BODY line while the offending literal is on its button line a few rows
        # down ("Restore" under "Restore the snapshot from …"), so a hit opens a
        # short window rather than excusing only its own line.
        if "gtddev_" in line or "dev-" in line or DEV_TEXT.search(line):
            dev_window = 6
            continue
        if dev_window > 0:
            dev_window -= 1
            continue
        for label, pat in PATTERNS:
            for text in pat.findall(line):
                offenders.append(f"{name}:{i}  [{label}] {text[:52]}")

check(not offenders,
      "no hard-coded English in generated markup (attributes, inline text, label ternaries)"
      + ("" if not offenders else f" — {len(offenders)} found:\n      " + "\n      ".join(offenders)))

# --------------------------------------------------------------- runtime half
with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    # ⚠ PHONE width on purpose. On desktop the language picker moves into a
    # header dropdown (renderHeaderWidgets) and [data-action="settings-language"]
    # is not in the overflow menu at all, so the whole navigation below silently
    # finds nothing.
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.goto(url); pg.wait_for_timeout(1300)

    def kill_overlays():
        pg.evaluate("""() => { for (const sel of ['#tray-root', '#dialog-root']) {
            const r = document.querySelector(sel); if (r) r.innerHTML = ''; } }""")

    # ⚠ settings-language only exists once the overflow menu is open — the same
    # two-step the i18n_language check uses.
    kill_overlays()
    pg.evaluate("""() => document.querySelector('[data-action="open-overflow"]').click()""")
    pg.wait_for_timeout(350)
    pg.evaluate("""() => document.querySelector('[data-action="settings-language"]').click()""")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => document.querySelector('[data-action="settings-pick-lang"][data-lang="zh-Hans"]').click()""")
    pg.wait_for_timeout(700)
    kill_overlays(); pg.wait_for_timeout(200)
    check(pg.evaluate("() => document.documentElement.getAttribute('lang')") == "zh-Hans",
          "the app switched to Chinese")

    def has_han(s):
        return bool(s) and any("一" <= c <= "鿿" for c in s)

    # Each of these rendered English before the wiring round.
    surfaces = {
        "the intray handle's tooltip":
            "() => { const e = document.querySelector('#tray-handle'); return e && e.getAttribute('title'); }",
        "a card checkbox's tooltip":
            """() => { const e = document.querySelector('.card .check[data-action="complete"]');
                       return e && e.getAttribute('title'); }""",
        "a card title's tooltip":
            "() => { const e = document.querySelector('.card-title'); return e && e.getAttribute('title'); }",
        "the settings build row":
            """() => { const e = document.querySelector('.settings-build');
                       return e && (e.textContent + ' ' + (e.getAttribute('title') || '')); }""",
    }
    # the build row only exists while the overflow menu is open
    pg.evaluate("""() => document.querySelector('[data-action="open-overflow"]').click()""")
    pg.wait_for_timeout(400)
    for label, js in surfaces.items():
        val = pg.evaluate(js)
        if val is None:
            check(False, f"{label} — NOT FOUND, selector needs updating")
        else:
            check(has_han(val), f"{label} is translated ({val[:40]!r})")

    # the drawer's empty state and its controls
    # The reveal/hide toggle's VISIBLE label — the one the attribute-only sweep
    # missed, sitting right beside the tooltip it did catch. Needs a capture
    # present, since the toggle only renders above a non-empty list.
    kill_overlays()
    pg.evaluate("""() => localStorage.setItem('gtd_tray',
        JSON.stringify([{ id: 'zz1', text: 'ZZ probe', createdAt: Date.now() }]))""")
    pg.reload(); pg.wait_for_timeout(1300)

    def reopen_tray():
        if pg.locator(".tray-drawer").count() == 0:
            pg.evaluate("""() => document.querySelector('#tray-handle').click()""")
            pg.wait_for_timeout(600)

    reopen_tray()
    label = pg.evaluate("""() => { const e = document.querySelector('.tray-reveal-btn span');
                                   return e && e.textContent; }""")
    check(label is not None and has_han(label),
          f"the reveal toggle's visible label is translated ({(label or '')[:20]!r})")
    ph = pg.get_attribute("#tray-input", "placeholder")
    check(has_han(ph), f"and so is the capture placeholder ({ph!r})")

    # ⚠ The drawer's empty state needs BOTH no captures and no review loops —
    # the seeded lanes generate loops, so clearing gtd_tray alone leaves the
    # loop cards rendering and .tray-empty never appears. Clear the lot.
    pg.evaluate("""() => { ['gtd_tray','gtd_events','gtd_notes'].forEach(k =>
            localStorage.setItem(k, '[]'));
        ['next','waiting','current','future','habit'].forEach(k =>
            localStorage.setItem('gtd_tasks_' + k, '[]')); }""")
    pg.reload(); pg.wait_for_timeout(1300)
    reopen_tray()
    empty = pg.evaluate("""() => { const e = document.querySelector('.tray-empty');
                                   return e && e.textContent; }""")
    check(empty is not None and has_han(empty),
          f"the drawer's empty state is translated ({(empty or '')[:30]!r})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

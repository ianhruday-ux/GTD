"""What the SHIPPED app shows, once the build scaffolding is closed off.

Two author rulings from 2026-08-01, both about the app finally being a product
rather than a build in progress.

1. THE DEV TOOLS ARE HIDDEN AND INACCESSIBLE. "Leave them in just in case I want
   to come back to this, but for now, they've served their purpose." So none of
   it is deleted — `app.js`'s DEV_TOOLS_BUILT_IN gates the way IN. The ⋯ menu has
   no Debugging row, the toolbar cannot appear however the per-group gtddev_
   keys are set, and — the consequence that is easy to miss — the QA checklist
   and the sprint chunk map are SWEPT out of the lanes at boot instead of being
   injected, because `applyQaScaffolding()` keys off the same switch.

   The last one is the reason this file asserts on the lanes and not only on the
   menu: "the row is gone" is a claim about a menu, while "someone you hand this
   to sees a clean app" is a claim about what is in Next Actions and Current
   Projects, and only the second one is the ruling.

2. THE STORAGE LINE IS GONE FROM THE WRAPPER. The footer says "Data lives in
   this browser's local storage", which is true of the web build and false in an
   installed one — W2 mirrors every write to native storage precisely so the
   browser's copy is not where the data lives, and a connected device is not
   even the only holder. Removed in the wrapper, kept in the tab.

Both are asserted in BOTH directions, which is what makes them evidence rather
than a screenshot: the switch flipped back on restores the row and the tools,
and a plain browser tab keeps the footer the wrapper drops. A check that only
proves the "off" half cannot tell a working gate from a deleted feature.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")


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


def boot(b, url, init=None, storage=None):
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    if init:
        ctx.add_init_script(init)   # survives the reload; an in-page evaluate would not
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(900)
    if storage:
        pg.evaluate("""(kv) => { Object.keys(kv).forEach(k => localStorage.setItem(k, kv[k])); }""", storage)
        pg.reload(); pg.wait_for_timeout(1100)
    close_tray(pg)
    return ctx, pg, errs


def close_tray(pg):
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
    pg.wait_for_timeout(150)


def open_settings(pg):
    pg.click('[data-action="open-overflow"]'); pg.wait_for_timeout(400)


def close_settings(pg):
    # ⚠ Escape does NOT clear this one: the menu renders into #dialog-root with
    # a full-viewport .menu-scrim over the app, and the scrim goes on swallowing
    # every click underneath it — a later tab click then times out on "scrim
    # intercepts pointer events" rather than doing anything. Dismiss it the way
    # the app itself does: tap the scrim.
    pg.evaluate("() => { const s = document.querySelector('.menu-scrim'); if (s) s.click(); }")
    pg.wait_for_timeout(300)


def menu_rows(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('.settings-menu .si-label')]
        .map(e => e.textContent.trim())""")


def lane_titles(pg, kind):
    """Cards and group headers rendered INSIDE one lane.

    ⚠ Scoped to `.lane[data-kind]`, and the tab really is `.tab[data-kind]`.
    Both matter: every lane renders into the DOM at once, so an unscoped query
    would have let "the chunk map is not in Current Projects" pass by finding
    nothing named that in Next Actions either — the wrong question, answered
    correctly. Caught by reading why a green was green, not by a failure.
    """
    tab = pg.locator('.tab[data-kind="%s"]' % kind)
    if tab.count():
        tab.first.click(); pg.wait_for_timeout(350)
    return pg.evaluate("""(k) => {
      const el = document.querySelector('.lane[data-kind="' + k + '"]');
      return el ? [...el.querySelectorAll('.card-title, .group-title')].map(e => e.textContent.trim()) : [];
    }""", kind)


def toolbar_visible(pg):
    return pg.evaluate("""() => { const bar = document.querySelector('#dev-toolbar');
        return !!bar && !bar.hidden; }""")


def footer_text(pg):
    return pg.evaluate("""() => { const f = document.querySelector('#footer-note');
        return f ? f.textContent.trim() : null; }""")


# The per-group keys ON, with no master switch: the state a device that had the
# tools switched on before this ruling is actually left in. It must read as off,
# not as "visible with nowhere to turn it off".
LEGACY_DEV_ON = {"gtddev_show_time": "1", "gtddev_show_snapshot": "1",
                 "gtddev_show_draglog": "1", "gtddev_show_qa": "1"}
MASTER_ON = dict(LEGACY_DEV_ON, gtddev_enabled="1")

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- the shipped app, with the scaffolding closed off
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url, storage=LEGACY_DEV_ON)

    open_settings(pg1)
    rows = menu_rows(pg1)
    check(bool(rows), f"fixture: the settings menu rendered ({rows})")
    check(not any("Debug" in r for r in rows),
          f"THE RULING: the ⋯ menu has no Debugging row ({rows})")
    check(any("Background" in r for r in rows) and any("Restore" in r for r in rows),
          f"and every ordinary row is untouched — this closed one door, not the menu ({rows})")
    close_settings(pg1)

    check(not toolbar_visible(pg1),
          "the dev toolbar stays hidden even with all three per-group keys set to 1 — a device "
          "that had them on is not stranded with tools and no menu to hide them")

    nxt = lane_titles(pg1, "next")
    check(not any("QA" in title for title in nxt),
          f"and the QA checklist is swept out of Next Actions, not injected ({nxt[:6]})")
    cur = lane_titles(pg1, "current")
    check(not any("Sprint chunks" in title or "🗺" in title for title in cur),
          f"and the sprint chunk map out of Current Projects ({cur[:6]})")
    check(pg1.evaluate("""() => Object.keys(localStorage)
            .filter(k => k.indexOf('gtd_qa_checklist_') === 0 || k.indexOf('gtd_chunk_map_') === 0).length""") == 0,
          "with the injectors' own flag keys cleared, so flipping the switch back re-injects "
          "rather than finding them set and doing nothing")
    check(not errs1, f"no JS errors ({errs1[:3]})")
    ctx1.close()

    # ============================================================
    # Group 2 -- the same build with the switch flipped: nothing was DELETED
    # ============================================================
    # Without this half, every assertion above is equally satisfied by a build
    # that tore the tools out — which is precisely what the author ruled against.
    ctx2, pg2, errs2 = boot(b, url, storage=MASTER_ON)
    open_settings(pg2)
    rows2 = menu_rows(pg2)
    check(any("Debug" in r for r in rows2),
          f"THE OTHER HALF: one key brings the Debugging row back, so the tools are gated, "
          f"not deleted ({rows2})")
    close_settings(pg2)
    check(toolbar_visible(pg2), "and the toolbar with it")
    check(pg2.locator("#qa-day-btn").count() > 0, "including the time-jump button the checks drive")

    cur2 = lane_titles(pg2, "current")
    check(any("Sprint chunks" in title or "🗺" in title for title in cur2),
          f"and the chunk map re-injects rather than staying swept ({cur2[:6]})")
    check(not errs2, f"no JS errors ({errs2[:3]})")
    ctx2.close()

    # ============================================================
    # Group 3 -- the storage line: kept in a tab, gone in a wrapper
    # ============================================================
    ctx3, pg3, errs3 = boot(b, url)
    check((footer_text(pg3) or "").startswith("Data lives in this browser"),
          f"a plain browser tab keeps the storage line, where it is true ({footer_text(pg3)})")
    ctx3.close()

    # The Electron shell's own signal (preload.js exposes this bridge). An init
    # script, not an evaluate: it has to be there before boot() reads it.
    ctx4, pg4, errs4 = boot(b, url, init="window.__oelaDesktopBridge = { isElectron: true };")
    check(pg4.evaluate("() => !!(window.__oelaDesktopBridge && window.__oelaDesktopBridge.isElectron)"),
          "fixture: the desktop bridge is present before boot reads it")
    check(footer_text(pg4) is None,
          f"THE RULING: inside the desktop wrapper the line is gone entirely — not reworded, "
          f"not hidden, removed ({footer_text(pg4)})")
    check(not errs4, f"no JS errors in the desktop shell ({errs4[:3]})")
    ctx4.close()

    # And the Android shell's signal, which is a different global.
    ctx5, pg5, errs5 = boot(b, url, init="window.Capacitor = { isNativePlatform: () => true };")
    check(footer_text(pg5) is None,
          f"same inside the Android wrapper, which announces itself differently ({footer_text(pg5)})")
    check(not errs5, f"no JS errors in the Android shell ({errs5[:3]})")
    ctx5.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)

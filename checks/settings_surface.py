"""Settings dropdown + background picker."""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys
from playwright.sync_api import sync_playwright

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


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 820}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    def load():
        pg.wait_for_timeout(900)
        pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
        pg.wait_for_timeout(150)

    def wood():
        return pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--wood')")

    pg.goto(url); load()

    # --- the dropdown itself ---
    check(wood().strip().startswith('url("data:image/png'), "boot paints a generated Perlin tile")
    default_tile = wood()
    pg.click('[data-action="open-overflow"]'); pg.wait_for_timeout(300)
    check(pg.locator(".settings-menu").count() == 1, "⋯ opens a dropdown")
    check(pg.locator(".choice-dialog-backdrop").count() == 0, "it is not a modal sheet")
    labels = pg.locator(".settings-menu .si-label").all_inner_texts()
    check(labels == ["Export a backup", "Import a backup", "Background", "Language",
                     "Restore app to defaults"], f"rows in order (got {labels})")
    check(pg.locator('[data-action="settings-language"]').is_disabled(), "Language is disabled")
    check("not built yet" in pg.locator('[data-action="settings-language"]').inner_text(),
          "Language says it is not built yet")

    # outside tap dismisses
    pg.click(".menu-scrim"); pg.wait_for_timeout(250)
    check(pg.locator(".settings-menu").count() == 0, "outside tap closes the dropdown")

    # --- the background panel ---
    pg.click('[data-action="open-overflow"]'); pg.wait_for_timeout(250)
    pg.click('[data-action="settings-backgrounds"]'); pg.wait_for_timeout(250)
    names = pg.locator(".settings-menu .si-label").all_inner_texts()
    # Dark wood and Rosewood are PHOTOGRAPHS (user-supplied), not drawn like the
    # first four — they sit last in the list for that reason.
    check(names == ["Background", "Walnut", "Oak", "Ebony", "Slate", "Plain",
                    "Dark wood", "Rosewood", "Black lacquer"], f"surfaces listed (got {names})")

    check(pg.locator('[data-bg="walnut"] .settings-check').count() == 1, "current surface is ticked")

    pg.click('[data-bg="oak"]'); pg.wait_for_timeout(400)
    check(pg.locator(".settings-menu").count() == 1, "picking a surface leaves the menu open")
    check(pg.locator('[data-bg="oak"] .settings-check').count() == 1, "the tick moves to the pick")
    oak_tile = wood()
    check(oak_tile != default_tile and oak_tile.startswith('url("data:image/png'), "the desk texture changed")

    # --- a PHOTO surface takes a different path through surfaceTile() ---
    # It must hand over its baked tile rather than falling through to the
    # generator, which would silently render it as one of the drawn woods.
    pg.click('[data-bg="darkwood"]'); pg.wait_for_timeout(400)
    applied = pg.evaluate("""() => ({
      wood: getComputedStyle(document.documentElement).getPropertyValue('--wood').trim().slice(0, 40),
      desk: getComputedStyle(document.documentElement).getPropertyValue('--desk').trim()
    })""")
    check("data:image/jpeg" in applied["wood"],
          f"a photo surface applies a JPEG tile, not a generated PNG ({applied})")
    check(applied["desk"].lower() == "#2c160d", f"and brings its own desk colour ({applied})")
    pg.click('[data-bg="rosewood"]'); pg.wait_for_timeout(400)
    check("data:image/jpeg" in wood(), "the second photo surface applies too")
    check(wood() != applied["wood"], "and it is a different image, not a cached one")
    pg.click('[data-bg="oak"]'); pg.wait_for_timeout(400)   # back to a drawn one
    check(wood() == oak_tile, "returning to a drawn surface regenerates it unchanged")

    pg.click('[data-action="settings-root"]'); pg.wait_for_timeout(250)
    check(pg.locator(".settings-menu").count() == 1, "Back returns to the root panel, still one layer")
    check("Oak" in pg.locator('[data-action="settings-backgrounds"]').inner_text(), "root row shows the current surface")

    # --- Plain, then persistence ---
    pg.click('[data-action="settings-backgrounds"]'); pg.wait_for_timeout(200)
    pg.click('[data-bg="plain"]'); pg.wait_for_timeout(350)
    check(wood().strip() == "none", "Plain removes the texture entirely")

    pg.click('[data-bg="oak"]'); pg.wait_for_timeout(350)
    pg.reload(); load()
    check(pg.evaluate("localStorage.getItem('gtd_surface')") == "oak", "the choice is persisted")
    check(wood() == oak_tile, "the same surface is regenerated identically after reload")

    # --- Restore to defaults resets the preference too ---
    pg.evaluate("() => { Object.keys(localStorage).filter(k=>k.indexOf('gtd_')===0).forEach(k=>localStorage.removeItem(k)); }")
    pg.reload(); load()
    check(pg.evaluate("localStorage.getItem('gtd_surface')") is None, "a full gtd_ clear drops the surface preference")
    check(wood() == default_tile, "and the desk returns to the default Walnut")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

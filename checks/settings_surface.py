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
    # ⚑ The default is Dark wood now — a PHOTOGRAPH — because the drawn woods
    # (Walnut, Oak, Ebony) were removed. So boot paints a JPEG, not the
    # generated PNG this file used to assert.
    check(wood().strip().startswith('url("data:image/jpeg'),
          f"boot paints the default photographic desk ({wood()[:40]})")
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
    check(names == ["Background", "Slate", "Plain", "Dark wood", "Rosewood",
                    "Black lacquer"], f"surfaces listed (got {names})")
    for gone in ["Walnut", "Oak", "Ebony"]:
        check(gone not in names, f"the drawn wood {gone!r} is gone")

    check(pg.locator('[data-bg="darkwood"] .settings-check').count() == 1, "current surface is ticked")

    # Slate is the only DRAWN surface left (rings:0 — stone, not timber), so it
    # is what keeps the Perlin generator covered now that the woods are photos.
    pg.click('[data-bg="slate"]'); pg.wait_for_timeout(400)
    check(pg.locator(".settings-menu").count() == 1, "picking a surface leaves the menu open")
    check(pg.locator('[data-bg="slate"] .settings-check').count() == 1, "the tick moves to the pick")
    slate_tile = wood()
    check(slate_tile != default_tile and slate_tile.startswith('url("data:image/png'),
          f"the generator still runs for the one drawn surface ({slate_tile[:40]})")

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
    pg.click('[data-bg="slate"]'); pg.wait_for_timeout(400)   # back to the drawn one
    check(wood() == slate_tile, "returning to a drawn surface regenerates it unchanged")

    # --- the lacquer's frame and jade, which no other surface has ---
    pg.click('[data-bg="lacquer"]'); pg.wait_for_timeout(500)
    lac = pg.evaluate("""() => ({
      framed: document.body.classList.contains('has-frame'),
      inset: getComputedStyle(document.documentElement).getPropertyValue('--frame-inset').trim(),
      painted: (() => { const c = document.getElementById('desk-frame');
        if (!c) return false;
        const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(80, c.height)).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
        return false; })(),
      jade: getComputedStyle(document.documentElement).getPropertyValue('--jade').trim().slice(0, 22)
    })""")
    check(lac["framed"], f"the lacquer desk flags the frame ({lac})")
    check(lac["inset"] not in ("", "0px"), f"and insets the content off the band ({lac})")
    check(lac["painted"], f"and the frame canvas actually has pixels on it ({lac})")
    check(lac["jade"].startswith("url("), f"and the jade inlay is generated ({lac})")

    pg.click('[data-bg="slate"]'); pg.wait_for_timeout(500)
    off = pg.evaluate("""() => ({
      framed: document.body.classList.contains('has-frame'),
      inset: getComputedStyle(document.documentElement).getPropertyValue('--frame-inset').trim(),
      painted: (() => { const c = document.getElementById('desk-frame');
        if (!c) return false;
        const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(80, c.height)).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
        return false; })()
    })""")
    check(not off["framed"] and off["inset"] == "0px" and not off["painted"],
          f"and leaving the lacquer clears the frame completely ({off})")

    pg.click('[data-action="settings-root"]'); pg.wait_for_timeout(250)
    check(pg.locator(".settings-menu").count() == 1, "Back returns to the root panel, still one layer")
    check("Slate" in pg.locator('[data-action="settings-backgrounds"]').inner_text(), "root row shows the current surface")

    # --- Plain, then persistence ---
    pg.click('[data-action="settings-backgrounds"]'); pg.wait_for_timeout(200)
    pg.click('[data-bg="plain"]'); pg.wait_for_timeout(350)
    check(wood().strip() == "none", "Plain removes the texture entirely")

    pg.click('[data-bg="slate"]'); pg.wait_for_timeout(350)
    pg.reload(); load()
    check(pg.evaluate("localStorage.getItem('gtd_surface')") == "slate", "the choice is persisted")
    check(wood() == slate_tile, "the same surface is regenerated identically after reload")

    # ⚑ A stored id for a REMOVED surface must fall back, not blank the desk.
    # This is what stands in for the migration that was deliberately not written.
    pg.evaluate("() => localStorage.setItem('gtd_surface', 'walnut')")
    pg.reload(); load()
    check(wood().strip().startswith('url("data:image/jpeg'),
          f"a stored 'walnut' falls back to the default rather than breaking ({wood()[:40]})")

    # --- Restore to defaults resets the preference too ---
    pg.evaluate("() => { Object.keys(localStorage).filter(k=>k.indexOf('gtd_')===0).forEach(k=>localStorage.removeItem(k)); }")
    pg.reload(); load()
    check(pg.evaluate("localStorage.getItem('gtd_surface')") is None, "a full gtd_ clear drops the surface preference")
    check(wood() == default_tile, "and the desk returns to the default Dark wood")

    # ---------- which build am I running? ----------
    # ⚑ Added after a fix was pushed, deployed, and reported as still broken —
    # the phone was serving a cached copy. GitHub Pages caches the HTML for a
    # few minutes, so "is this the new build?" is a question that costs a round
    # trip every time it cannot be answered on the device.
    pg.click('[data-action="open-overflow"]'); pg.wait_for_timeout(300)
    stamp = pg.locator(".settings-build")
    check(stamp.count() == 1, "the settings menu says which build this is")
    txt = stamp.first.inner_text() if stamp.count() else ""
    check("__BUILD_STAMP__" not in txt,
          f"and the placeholder was actually substituted at build time ({txt})")
    check(len(txt) > 8 and "Build" in txt, f"and it reads as a build marker ({txt})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    # some Windows consoles are cp1252; the settings rows carry a ⋯
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

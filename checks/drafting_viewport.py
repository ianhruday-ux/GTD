"""The drafting overlay covers the visible area — position AND height.

User: "the bug that pushes the title and top controls out of the viewport on a
notes page... the list is peaking through at the bottom."

⚠ ONE CAUSE, BOTH SYMPTOMS. .screen-overlay is positioned at --vv-top and sized
to --vv-height. A previous round dropped offsetTop tracking to stop jitter and
KEPT the height tracking. With the top pinned at 0 and the height shrunk to the
keyboard-visible area, the overlay ends up both too high (the title scrolls out
of view) and too short (the lanes show through beneath it). Tracking one without
the other is worse than tracking neither.

⚠ WHAT THIS CHECK CAN AND CANNOT DO. Playwright has no on-screen keyboard, so
the real condition cannot be reproduced headlessly — that is why this bug
survived several rounds. What it CAN do is pin the invariant that broke: the two
variables move together, and the overlay's box matches the visible box for any
values of them. The keyboard itself still needs a device.
"""
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
    pg = b.new_context(viewport={"width": 420, "height": 880}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1100)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    # ---------- the meta that makes this a non-problem where supported ----------
    meta = pg.evaluate("""() => {
      const m = document.querySelector('meta[name="viewport"]');
      return m ? m.getAttribute('content') : null;
    }""")
    check(meta and "interactive-widget=resizes-content" in meta,
          f"the viewport meta asks the keyboard to resize the layout ({meta})")

    # ---------- both variables are maintained, not just one ----------
    vv = pg.evaluate("""() => {
      const cs = getComputedStyle(document.documentElement);
      return { h: cs.getPropertyValue('--vv-height').trim(),
               top: cs.getPropertyValue('--vv-top').trim() };
    }""")
    check(vv["h"].endswith("px"), f"--vv-height is set ({vv})")
    check(vv["top"].endswith("px"),
          f"--vv-top is set TOO — tracking height alone is what caused the bug ({vv})")

    # ---------- open a note and check the overlay covers the visible box ----------
    pg.click('.tab[data-kind="notes"]'); pg.wait_for_timeout(400)
    pg.click('[data-action="fab"]'); pg.wait_for_timeout(350)
    pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(600)
    check(pg.locator(".screen-overlay").count() == 1, "a note page is open")

    def geom():
        return pg.evaluate("""() => {
          const el = document.querySelector('.screen-overlay');
          const r = el.getBoundingClientRect();
          const vv = window.visualViewport;
          return { top: Math.round(r.top), bottom: Math.round(r.bottom),
                   vvTop: Math.round(vv ? vv.offsetTop : 0),
                   vvBottom: Math.round((vv ? vv.offsetTop + vv.height : window.innerHeight)) };
        }""")

    g = geom()
    check(abs(g["top"] - g["vvTop"]) <= 1,
          f"the overlay starts at the top of the visible area ({g})")
    check(abs(g["bottom"] - g["vvBottom"]) <= 1,
          f"and ends at the bottom of it — nothing shows through ({g})")

    # ---------- simulate the keyboard: the visible area shrinks AND shifts ----------
    # This is the state the bug lived in. Driving the vars directly is the only
    # way to reach it without a device; the assertion is that the overlay's box
    # follows BOTH, which is what a keyboard would demand of it.
    pg.evaluate("""() => {
      const root = document.documentElement;
      root.style.setProperty('--vv-height', '420px');
      root.style.setProperty('--vv-top', '160px');
    }""")
    pg.wait_for_timeout(200)
    box = pg.evaluate("""() => {
      const r = document.querySelector('.screen-overlay').getBoundingClientRect();
      return { top: Math.round(r.top), height: Math.round(r.height) };
    }""")
    check(box["top"] == 160,
          f"with the visible area shifted down, the overlay moves with it ({box})")
    check(box["height"] == 420,
          f"and takes the shrunken height ({box})")

    # the failure mode, stated as its own assertion: height without position
    pg.evaluate("""() => {
      document.documentElement.style.setProperty('--vv-top', '0px');
    }""")
    pg.wait_for_timeout(150)
    bad = pg.evaluate("""() => {
      const r = document.querySelector('.screen-overlay').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }""")
    check(bad["bottom"] == 420,
          f"[documenting the bug] top pinned at 0 with a shrunk height ends the "
          f"overlay early — this is the gap the lanes showed through ({bad})")

    # ---------- EVERY drafting page, not just notes ----------
    # User: "if the lacquer is the problem, you should check to see if this
    # happens with any of the description boxes on the other drafting pages."
    # It is not the lacquer — but the question is the right test of the
    # diagnosis. There is ONE .screen-overlay shared by every drafting page, so
    # if the cause is its geometry, the fault and the fix are shared too.
    # Asserted rather than assumed.
    pg.evaluate("""() => {
      document.documentElement.style.removeProperty('--vv-top');
      document.documentElement.style.removeProperty('--vv-height');
      ['#tray-root', '#dialog-root', '#screen-root'].forEach(sel => {
        const el = document.querySelector(sel); if (el) el.innerHTML = '';
      });
      document.body.classList.remove('screen-open');
      window.scrollTo(0, 0);
    }""")
    pg.wait_for_timeout(300)

    def overlay_covers():
        return pg.evaluate("""() => {
          const el = document.querySelector('.screen-overlay');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const vv = window.visualViewport;
          const top = vv ? vv.offsetTop : 0;
          const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
          return Math.abs(r.top - top) <= 1 && Math.abs(r.bottom - bottom) <= 1;
        }""")

    # ⚠ Habits are not in this loop: that lane has NO create menu — its badge
    # makes a habit in one tap — so there is no new-primary to click. Next and
    # Project are the pages with the description boxes the user asked about.
    for lane, label in [("next", "a Next Action"), ("current", "a Project")]:
        pg.evaluate("""() => {
          ['#tray-root','#dialog-root','#screen-root'].forEach(s => {
            const el = document.querySelector(s); if (el) el.innerHTML = '';
          });
          document.body.classList.remove('screen-open');
          const fm = document.querySelector('#fab-menu'); if (fm) fm.hidden = true;
          document.querySelectorAll('.menu-scrim').forEach(e => e.remove());
          window.scrollTo(0, 0);
        }""")
        pg.wait_for_timeout(250)
        pg.click('.tab[data-kind="%s"]' % lane); pg.wait_for_timeout(350)
        pg.click('[data-action="fab"]'); pg.wait_for_timeout(300)
        pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(550)
        has_desc = pg.locator('[data-field="notesClean"]').count()
        ok = overlay_covers()
        check(ok is True, f"{label} page's overlay covers the visible area too")
        check(has_desc >= 1,
              f"{label} page has the description box the user asked about ({has_desc})")

    # ---------- and it is surface-independent ----------
    # The lacquer made the gap VISIBLE (a different texture and a gold border
    # behind it) but cannot cause it: --frame-inset never touches .screen-overlay.
    pg.evaluate("() => { localStorage.setItem('gtd_surface','lacquer'); }")
    pg.reload(); pg.wait_for_timeout(1200)
    pg.evaluate("""() => {
      const r = document.querySelector('#tray-root'); if (r) r.innerHTML = '';
      const fm = document.querySelector('#fab-menu'); if (fm) fm.hidden = true;
      window.scrollTo(0, 0);
    }""")
    pg.click('.tab[data-kind="notes"]'); pg.wait_for_timeout(350)
    pg.click('[data-action="fab"]'); pg.wait_for_timeout(300)
    pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(600)
    check(overlay_covers() is True,
          "and the same holds on the Black lacquer desk — the surface is not the cause")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

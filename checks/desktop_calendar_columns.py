"""§10 (review-surface-plan.md): the desktop calendar's two-column fix.

Verifies, at 1366x768 (the worst case that exposed the bug), 1440x900 and
1920x1080: .cal-body does not scroll, the Add button is inside the viewport
without scrolling, Month/Day/List all fit, and the phone layout at 400x860 is
untouched (still single column, still no scroll).
"""
import os, functools, http.server, socketserver, socket, threading, contextlib, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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

    def measure(pg):
        return pg.evaluate("""() => {
          const body = document.querySelector('.cal-body');
          const addBtn = document.querySelector('[data-action="cal-add"]');
          const vp = document.querySelector('.cal-swipe-viewport, .cal-agenda, .cal-day-empty');
          const rect = addBtn ? addBtn.getBoundingClientRect() : null;
          return {
            scrollH: body.scrollHeight, clientH: body.clientHeight,
            scrolls: body.scrollHeight > body.clientHeight + 1,
            addVisible: rect ? (rect.top >= 0 && rect.bottom <= window.innerHeight) : false,
            addTop: rect ? rect.top : null,
            innerH: window.innerHeight,
            gridCols: getComputedStyle(body).gridTemplateColumns,
            vpWidth: vp ? vp.getBoundingClientRect().width : null,
          };
        }""")

    for w, h in [(1366, 768), (1440, 900), (1920, 1080)]:
        pg = b.new_context(viewport={"width": w, "height": h}).new_page()
        pg.goto(url); pg.wait_for_timeout(1000)
        pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
        pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(400)

        m = measure(pg)
        check(not m["scrolls"], f"[{w}x{h}] Month: .cal-body does not scroll ({m})")
        check(m["addVisible"], f"[{w}x{h}] Month: Add button is inside the viewport ({m})")
        check("300px" in m["gridCols"], f"[{w}x{h}] Month: two-column grid is active ({m['gridCols']})")

        pg.click('[data-action="cal-tab"][data-tab="day"]'); pg.wait_for_timeout(300)
        m = measure(pg)
        check(not m["scrolls"], f"[{w}x{h}] Day: .cal-body does not scroll ({m})")
        check(m["addVisible"], f"[{w}x{h}] Day: Add button is inside the viewport ({m})")

        pg.click('[data-action="cal-tab"][data-tab="list"]'); pg.wait_for_timeout(300)
        m = measure(pg)
        check(not m["scrolls"], f"[{w}x{h}] List: .cal-body does not scroll ({m})")
        check(m["addVisible"], f"[{w}x{h}] List: Add button is inside the viewport ({m})")

        pg.close()

    # ---------- phone unchanged ----------
    pg = b.new_context(viewport={"width": 400, "height": 860}).new_page()
    pg.goto(url); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(400)
    cellBox = pg.evaluate("""() => { const c = document.querySelector('.cal-cell:not(.cal-cell-blank)');
      const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }""")
    check(cellBox["w"] in (48, 49, 50) and cellBox["h"] in (55, 56, 57),
          f"phone cells unchanged (~49x56, got {cellBox})")
    m = measure(pg)
    check(not m["scrolls"], f"phone: .cal-body still does not scroll ({m})")
    check("300px" not in m["gridCols"], f"phone: single column, no desktop grid ({m['gridCols']})")
    pg.close()

    b.close()

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    if fails: sys.exit(1)

"""Bug (author): linking a new event to a stalled project through the daily
review's "Add an Event" band (review-add-event -> openCalendarScreen ->
calAdd -> commitNewEvent) never cleared that project's stale "no linked
actions" flag on the Current Projects lane. commitNewEvent re-rendered the
Next and Waiting lanes (their cue pills can depend on an event) but not
Current, even though projectHasWayForward's projectHasLinkedEvent check is
exactly what a new linked event satisfies.

Fix: commitNewEvent also calls renderLane("current").
"""
import os, functools, http.server, socketserver, socket, threading, contextlib, sys, json
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
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)

    def jclick(selector):
        pg.evaluate("(sel) => { const el = document.querySelector(sel); if (el) el.click(); }", selector)

    def current_card(id_):
        return pg.evaluate("""(id) => { const c = document.querySelector('.lane[data-kind="current"] .card[data-drag-id="' + id + '"]');
          return c ? { found: true, flag: c.querySelector('.card-project-flag') !== null } : { found: false }; }""", id_)

    pg.evaluate("""() => {
      const c = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
      c.unshift({ id: 'zz-stalled', title: 'ZZ stalled project', notesClean: '',
        linkedProjectId: null, contextId: null, createdAt: Date.now(), deadline: null });
      localStorage.setItem('gtd_tasks_current', JSON.stringify(c));
    }""")
    pg.reload(); pg.wait_for_timeout(1000)

    # Look at the Current lane FIRST so its DOM exists behind the review, same
    # as a real user browsing Current Projects then opening the tray.
    jclick('[data-action="tab"][data-kind="current"]'); pg.wait_for_timeout(300)
    before = current_card("zz-stalled")
    check(before["found"] and before["flag"], f"fixture: the stalled project shows its flag before ({before})")

    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    jclick('[data-action="open-tray"]'); pg.wait_for_timeout(300)
    jclick('[data-action="open-review"]'); pg.wait_for_timeout(500)
    for _ in range(8):
        title = pg.evaluate("() => { const el = document.querySelector('.review-card-title'); return el ? el.textContent.trim() : null; }")
        if title == "ZZ stalled project": break
        jclick('[data-action="review-defer"]'); pg.wait_for_timeout(300)
    check(pg.evaluate("() => { const el=document.querySelector('.review-card-title'); return el?el.textContent.trim():null; }") == "ZZ stalled project",
          "fixture: the stalled project is revealed in review")

    jclick('[data-action="review-add-event"]')
    pg.wait_for_timeout(500)
    check(pg.evaluate("() => !!document.querySelector('.cal-name')"), "fixture: landed on the event-add screen")
    pg.fill(".cal-name", "ZZ project event")
    jclick('[data-action="cal-add"]')
    pg.wait_for_timeout(500)
    ev = pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_events') || '[]').find(e => e.title === 'ZZ project event')")
    check(ev is not None and ev.get("linkedProjectId") == "zz-stalled", f"the event was created and linked to the project ({ev})")

    jclick('[data-action="review-close"]')
    pg.wait_for_timeout(400)
    after = current_card("zz-stalled")
    check(after["found"] and not after["flag"],
          f"the Current lane re-renders and clears the flag without a manual refresh ({after})")

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

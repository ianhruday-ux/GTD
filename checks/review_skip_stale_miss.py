"""Author-reported bug: a recurring event can hold BOTH a live overdue
occurrence AND an older recorded miss at once -- the single-slot design
hides the older miss behind the live row (computeOpenLoops shows only the
live one). Skipping the live row used to leave the older missedOcc
untouched, so the instant the live row disappeared the older miss was
revealed -- from the review this read as "I hit Skipped and the same event
came right back", requiring a second Skipped click on what looked like the
same card to actually clear it.

skipOccurrence() (events.js) now retires an older missedOcc the same way
onPseudoActionCompleted() already did on the completing side -- answering
the newer (live) question retires the older, superseded one.
"""
import os, functools, http.server, socketserver, socket, threading, contextlib, sys, datetime
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


# 3pm on a Monday; the event started 3 weeks earlier at 9am, so the boundary
# sweep rolls it forward week by week (recording only the LAST miss it
# passes, per the single-slot design) until it reaches TODAY -- which is
# itself time-of-day overdue (9am < 3pm) but not yet a full day passed, so it
# stays live rather than rolling again. Net: missedOcc = 2 weeks ago,
# ev.date = today, and today's occurrence shows as a live "pastdue" card
# with the 2-week-old miss suppressed behind it.
BASE = datetime.datetime(2026, 6, 15, 15, 0, 0)
START = (BASE - datetime.timedelta(days=21)).strftime("%Y-%m-%d")
EXPECTED_STALE_MISS = (BASE - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
TODAY = BASE.strftime("%Y-%m-%d")

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)

    def jclick(selector):
        pg.evaluate("(sel) => { const el = document.querySelector(sel); if (el) el.click(); }", selector)

    def revealed_title():
        return pg.evaluate("""() => { const el = document.querySelector('.review-card-title');
          return el ? el.textContent.trim() : null; }""")

    def stored():
        return pg.evaluate("""() => { const e = JSON.parse(localStorage.getItem('gtd_events'))[0];
          return { date: e.date, missed: e.missedOcc || null, done: e.completedOccs || [] }; }""")

    pg.evaluate("""(start) => {
      const e = { id: 'zz-ev', taskId: 'zz-ev-task', title: 'ZZ stale-miss weekly', date: start,
        time: '09:00', notesClean: '', recurrence: 'weekly', interval: 1,
        paused: false, contextId: null, linkedProjectId: null,
        seriesId: 'zz-s', tickler: false, completedOccs: [] };
      localStorage.setItem('gtd_events', JSON.stringify([e]));
      const n = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
      localStorage.setItem('gtd_tasks_next', JSON.stringify(n.filter(t => t.id !== 'zz-ev-task')));
    }""", START)
    pg.reload(); pg.wait_for_timeout(1000)

    st = stored()
    check(st["date"] == TODAY, f"fixture: the series caught up to today ({st}, expected date={TODAY})")
    check(st["missed"] == EXPECTED_STALE_MISS,
          f"fixture: an OLDER miss is recorded and suppressed behind today's live row ({st}, expected missed={EXPECTED_STALE_MISS})")

    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    jclick('[data-action="open-tray"]'); pg.wait_for_timeout(350)
    jclick('[data-action="open-review"]'); pg.wait_for_timeout(600)

    title = revealed_title()
    check(title == "ZZ stale-miss weekly", f"the live pastdue card is revealed, not the older miss ({title})")
    check(pg.locator('[data-action="review-skip-live"]').count() == 1, "it offers Skipped")

    jclick('[data-action="review-skip-live"]'); pg.wait_for_timeout(600)

    st2 = stored()
    check(st2["missed"] is None,
          f"THE FIX: the older suppressed miss is retired along with the live occurrence, not left behind ({st2})")
    check(st2["done"] == [], f"and skipping still doesn't credit a completion ({st2})")

    title2 = revealed_title()
    check(title2 != "ZZ stale-miss weekly",
          f"so the SAME event does not reappear disguised as a 'missed' card ({title2})")
    end_state = pg.evaluate("() => !!document.querySelector('.review-end')")
    check(end_state or (title2 is not None and title2 != "ZZ stale-miss weekly"),
          f"the review has genuinely moved on ({title2!r}, end_state={end_state})")

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

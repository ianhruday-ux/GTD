"""QA #1 and #2 — what a repeating event draws on the month grid.

A recurring series is ONE live entity that rolls forward (§4.15b), so:
  · before the live date  -> nothing, UNLESS that occurrence was completed,
                             which keeps a dimmed solid mark (user ruling #6)
  · on the live date      -> a solid mark
  · after the live date   -> a hollow "projected" mark

The old code walked backwards from the live date to find past occurrences, which
drew projections across every past month (#2) and kept drawing an occurrence the
user had explicitly skipped (#1).
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, datetime
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


BASE = datetime.datetime(2026, 6, 15, 10, 0, 0)   # "today" for the whole run

# ⚠ Every seeded live date is AFTER that. Seed one in the past and the boundary
# sweep correctly rolls the series forward before the first assertion runs, so
# the "live" occurrence has already moved and the test measures the wrong day.

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(900)

    def seed(ev):
        pg.evaluate("e => localStorage.setItem('gtd_events', JSON.stringify([e]))", ev)
        pg.reload(); pg.wait_for_timeout(900)
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(500)

    def marks(date):
        """classes of the marks drawn on one day cell, across months if needed"""
        return pg.evaluate("""(d) => {
          const cell = document.querySelector('.cal-cell[data-date="' + d + '"]');
          if (!cell) return null;
          return [...cell.querySelectorAll('.cal-mark')].map(m => m.className);
        }""", date)

    MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
                   "August", "September", "October", "November", "December"]

    def ordinal(label):
        # ⚠ compare months as ORDINALS, not strings: "May 2026" > "June 2026" is
        # true alphabetically, which sends the navigation the wrong way forever.
        name, year = label.split()
        return int(year) * 12 + MONTH_NAMES.index(name)

    def goto_month(target):
        for _ in range(24):
            cur = pg.locator(".cal-monthlabel").first.inner_text().strip()
            if cur == target:
                return True
            d = 1 if ordinal(target) > ordinal(cur) else -1
            pg.click('[data-action="cal-month"][data-dir="%d"]' % d)
            pg.wait_for_timeout(220)
        return False

    MONTHLY = {
        "id": "ev1", "taskId": "t1", "title": "Pay rent", "date": "2026-06-20",
        "time": None, "notesClean": "", "recurrence": "monthly", "interval": 1,
        "paused": False, "contextId": None, "linkedProjectId": None,
        "seriesId": "s1", "tickler": False, "completedOccs": []
    }

    # ---------- a live series with nothing completed ----------
    seed(dict(MONTHLY))
    live = marks("2026-06-20")
    check(live is not None and len(live) == 1 and "cal-mark-proj" not in live[0],
          f"the live occurrence draws a solid mark ({live})")
    fut = marks("2026-07-20")
    if fut is None:
        goto_month("July 2026"); fut = marks("2026-07-20")
    check(fut and any("cal-mark-proj" in c for c in fut), f"a FUTURE occurrence is projected ({fut})")

    goto_month("May 2026")
    past = marks("2026-05-20")
    check(past == [], f"#2: a PAST occurrence draws nothing ({past})")
    goto_month("April 2026")
    check(marks("2026-04-20") == [], "and nothing two months back either")

    # ---------- a completed past occurrence keeps its dimmed mark ----------
    ev = dict(MONTHLY); ev["completedOccs"] = ["2026-05-20"]
    seed(ev)
    goto_month("May 2026")
    done = marks("2026-05-20")
    check(done and any("cal-mark-done" in c for c in done),
          f"a COMPLETED past occurrence still shows, dimmed ({done})")
    check(done and not any("cal-mark-proj" in c for c in done),
          f"and it is NOT drawn as a projection ({done})")

    # ---------- a skipped occurrence leaves nothing behind ----------
    # skipping rolls the live date forward; the skipped date is simply in the past
    ev = dict(MONTHLY); ev["date"] = "2026-07-20"   # June's occurrence was skipped
    seed(ev)
    check(marks("2026-06-20") == [], "#1: a skipped occurrence draws nothing")
    goto_month("July 2026")
    still = marks("2026-07-20")
    check(still and len(still) == 1 and "cal-mark-proj" not in still[0],
          f"and the series still shows its new live occurrence ({still})")

    # ---------- a paused series projects nothing ----------
    ev = dict(MONTHLY); ev["paused"] = True
    seed(ev)
    goto_month("July 2026")
    check(marks("2026-07-20") == [], "a paused series projects nothing forward")

    # ---------- the day agenda agrees with the grid ----------
    ev = dict(MONTHLY)
    seed(ev)
    # NB: the swipe track renders prev/current/next months, so a neighbouring
    # month's cells exist in the DOM but sit outside the viewport — navigate
    # before clicking one, even though querying it works either way.
    goto_month("May 2026")
    pg.click('.cal-cell[data-date="2026-05-20"]'); pg.wait_for_timeout(300)
    pg.click('[data-action="cal-tab"][data-tab="day"]'); pg.wait_for_timeout(400)
    agenda = pg.locator(".cal-agenda-row").count()
    check(agenda == 0, f"Day view for a past, uncompleted occurrence is empty ({agenda} rows)")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

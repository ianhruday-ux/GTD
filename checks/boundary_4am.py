"""4 AM turnover audit: do events, appointments, deadlines and recurring events
all actually turn over at the boundary? Drives the real build with a faked clock,
stepping across 03:55 -> 04:05 on each relevant day.
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


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 780})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    BASE = datetime.datetime(2026, 8, 3, 10, 0, 0)   # Mon 10:00
    pg.clock.install(time=BASE)

    # ⚠ These two events used to arrive as SAMPLE DATA. 8c6f171 deleted the
    # sample events on purpose ("disposable demo filler duplicated the
    # tutorial's job"), which left this file asserting against a fixture the
    # app no longer creates — it failed on a missing card, not on a broken
    # boundary. The fixtures live here now, where the assertions can see them.
    # Both dates are AFTER BASE: seed a live occurrence in the past and the
    # boundary sweep correctly rolls the series forward before the first
    # assertion runs, so the test would measure the wrong day.
    FIXTURES = [
        {"id": "ev-dentist", "taskId": "task-dentist", "title": "Dentist",
         "date": "2026-08-05", "time": "14:30", "notesClean": "Cleaning + check-up",
         "recurrence": "none", "interval": 1, "paused": False, "contextId": None,
         "linkedProjectId": None, "seriesId": None, "tickler": False, "completedOccs": []},
        {"id": "ev-rent", "taskId": "task-rent", "title": "Pay rent",
         "date": "2026-08-08", "time": None, "notesClean": "",
         "recurrence": "monthly", "interval": 1, "paused": False, "contextId": None,
         "linkedProjectId": None, "seriesId": "series-rent", "tickler": False,
         "completedOccs": []},
    ]

    def close_tray():
        # The intray auto-opens at boot and its slide transition never finishes
        # under a frozen clock, so dismiss it in the DOM rather than clicking.
        pg.wait_for_timeout(600)
        pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
        pg.wait_for_timeout(100)

    def at(**kw):
        pg.clock.set_fixed_time(BASE + datetime.timedelta(**kw))
        pg.reload(); close_tray()

    def card(name):
        return pg.locator('.card:has-text("%s")' % name)

    def bar(name):
        el = card(name).first.locator(".deadline-bar").first
        style, cls = el.get_attribute("style") or "", el.get_attribute("class") or ""
        pct = int("".join(c for c in style.split("--fill:")[1].split("%")[0] if c.isdigit()) or 0)
        return pct, cls

    pg.goto(url); close_tray()   # first boot at BASE builds the store
    pg.evaluate("evs => localStorage.setItem('gtd_events', JSON.stringify(evs))", FIXTURES)
    pg.reload(); close_tray()    # the reload runs the 4 AM sweep over them

    # ---------- APPOINTMENT (Dentist, Aug 5 14:30) ----------
    at(days=1, hours=17, minutes=55)                      # Aug 4 03:55 — day BEFORE
    check(card("Dentist").count() == 0, "appointment absent at 03:55 the day before")
    at(days=1, hours=18, minutes=5)                       # Aug 5 04:05
    check(card("Dentist").count() == 1, "appointment appears at 04:05 on its day")
    pct, _ = bar("Dentist")
    check(pct <= 2, f"appointment bar starts empty at the boundary ({pct}%)")
    at(days=2, hours=4, minutes=30)                       # Aug 5 14:30 exactly
    pct, cls = bar("Dentist")
    check(pct == 100 and "passed" in cls, f"appointment full+passed at its time ({pct}%, {cls.strip()})")

    # ---------- UNTIMED EVENT (Pay rent, Aug 8, monthly) ----------
    at(days=4, hours=17, minutes=55)                      # Aug 7 03:55
    check(card("Pay rent").count() == 0, "untimed event absent at 03:55 the day before")
    at(days=4, hours=18, minutes=5)                       # Aug 8 04:05
    check(card("Pay rent").count() == 1, "untimed event appears at 04:05 on its day")
    pct, cls = bar("Pay rent")
    check(pct <= 2, f"untimed event bar starts EMPTY at 04:05, not full ({pct}%)")
    check("passed" not in cls, "untimed event not passed at the start of its day")
    at(days=5, hours=6)                                   # Aug 8 16:00 — mid-day
    pct, _ = bar("Pay rent")
    check(40 <= pct <= 60, f"untimed event bar ~half way by 16:00 ({pct}%)")
    at(days=5, hours=17, minutes=55)                      # Aug 9 03:55 — still its day
    pct, cls = bar("Pay rent")
    check(pct >= 95 and "passed" not in cls, f"untimed event nearly full, not yet passed at 03:55 ({pct}%)")
    at(days=5, hours=18, minutes=5)                       # Aug 9 04:05 — turnover
    pct, cls = bar("Pay rent")
    check(pct == 100 and "passed" in cls and "red" in cls,
          f"untimed event full+red+passed just after the 4 AM turnover ({pct}%, {cls.strip()})")

    # ---------- RECURRING ROLL ----------
    # Pay rent is monthly. Complete it, let the 10-minute undo window close, and
    # confirm it rolls to the next month rather than accumulating.
    at(days=5, hours=6)                                   # back to Aug 8 16:00
    pg.evaluate("""() => {
      const t = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Pay rent'));
      t.querySelector('[data-action="complete"]').click();
    }""")
    pg.wait_for_timeout(400)
    check(card("Pay rent").count() == 0, "completing the recurring occurrence clears the lane")
    at(days=5, hours=7)                                   # +1h, undo window long closed
    check(card("Pay rent").count() == 0, "recurring event does not return the same day after completion")
    rolled = pg.evaluate("JSON.parse(localStorage.getItem('gtd_events')).find(e=>e.title==='Pay rent').date")
    check(rolled.startswith("2026-09"), f"monthly series rolled to September (got {rolled})")
    at(days=35, hours=18, minutes=5)                      # Sep 8 04:05
    check(card("Pay rent").count() == 1, "next occurrence appears at 04:05 a month later")
    pct, _ = bar("Pay rent")
    check(pct <= 2, f"rolled occurrence's bar also starts empty ({pct}%)")

    # ---------- DEADLINE (untimed, on a normal Next Action) ----------
    at(days=0, hours=1)
    pg.evaluate("""() => {
      const k = 'gtd_tasks_next';
      const rows = JSON.parse(localStorage.getItem(k));
      rows.unshift({ id: 'dl-probe', isGroup: false, parent: null, title: 'File taxes',
        notesClean: '', contextId: null, linkedProjectId: null,
        deadline: { date: '2026-08-06', time: null }, whenText: null,
        conditionId: null, conditionKind: null, conditionLabel: null,
        bundleText: null, createdAt: Date.now() });
      localStorage.setItem(k, JSON.stringify(rows));
    }""")
    at(days=2, hours=17, minutes=55)                      # Aug 5 03:55 — day before due
    at(days=1, hours=17, minutes=55)                      # Aug 5 03:55 — day before the due day
    pct, cls = bar("File taxes")
    check(pct < 90 and "passed" not in cls, f"untimed deadline mid-fill the day before ({pct}%)")
    at(days=2, hours=17, minutes=55)                      # Aug 6 03:55 — 5 min before its day begins
    pct, cls = bar("File taxes")
    check(pct == 100 and "passed" not in cls, f"untimed deadline ~full just before its day ({pct}%)")
    at(days=2, hours=18, minutes=5)                       # Aug 6 04:05 — its due day BEGINS
    pct, cls = bar("File taxes")
    check(pct == 100, f"untimed deadline full at the 4 AM boundary of its due day ({pct}%)")
    check("passed" not in cls,
          f"untimed deadline NOT passed at the start of its due day (class: {cls.strip()})")
    at(days=3, hours=17, minutes=55)                      # Aug 7 03:55 — still its due day
    _, cls = bar("File taxes")
    check("passed" not in cls, f"untimed deadline still not passed at 03:55 on its due day ({cls.strip()})")
    at(days=3, hours=18, minutes=5)                       # Aug 7 04:05 — due day OVER
    pct, cls = bar("File taxes")
    check("passed" in cls and "red" in cls,
          f"untimed deadline passed once its day ends ({cls.strip()})")

    check(not errors, f"no JS errors ({errors[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

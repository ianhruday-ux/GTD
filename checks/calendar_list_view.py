"""QA #33 — the calendar's List view.

"a list view that lists all events, appointments and deadlines in the order they
occur, including hidden events and the next projected occurrence of paused
repeating events. This list should only show one occurrence of a repeating
event."

Every clause there is an inclusion rule that differs from the month grid, which
is what makes this a view and not a filter:
  · hidden (tickler) events appear — the grid hides them
  · paused series appear at their next occurrence — the grid projects nothing
  · exactly one row per repeating series — the grid draws every occurrence
  · deadlines (action AND project) sit inline with events, in time order
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


BASE = datetime.datetime(2026, 6, 15, 10, 0, 0)


def ev(id_, title, date, **over):
    e = {
        "id": id_, "taskId": "task-" + id_, "title": title, "date": date,
        "time": None, "notesClean": "", "recurrence": "none", "interval": 1,
        "paused": False, "contextId": None, "linkedProjectId": None,
        "seriesId": None, "tickler": False, "completedOccs": [],
    }
    e.update(over)
    return e


EVENTS = [
    ev("e1", "ZZ dentist", "2026-06-18", time="14:30"),
    ev("e2", "ZZ standup", "2026-06-16", time="09:00", recurrence="daily", seriesId="s1"),
    ev("e3", "ZZ passport", "2026-07-05", tickler=True),
    ev("e4", "ZZ gym", "2026-06-17", recurrence="weekly", seriesId="s2", paused=True),
    ev("e5", "ZZ long gone", "2026-05-01"),
    ev("e6", "ZZ all day thing", "2026-06-18"),
]

TASKS_NEXT = [
    {"id": "d1", "title": "ZZ file taxes", "notesClean": "", "linkedProjectId": None,
     "isGroup": False, "parent": None, "whenText": None, "hooks": [],
     "deadline": {"date": "2026-06-18", "time": "11:00"}},
    {"id": "d2", "title": "ZZ past due thing", "notesClean": "", "linkedProjectId": None,
     "isGroup": False, "parent": None, "whenText": None, "hooks": [],
     "deadline": {"date": "2026-06-01", "time": None}},
]

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)

    pg.evaluate(
        """([evs, nxt]) => {
             localStorage.setItem('gtd_events', JSON.stringify(evs));
             const cur = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
             localStorage.setItem('gtd_tasks_next', JSON.stringify(cur.concat(nxt)));
           }""", [EVENTS, TASKS_NEXT])
    pg.reload(); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(500)
    check(pg.locator('[data-action="cal-tab"][data-tab="list"]').count() == 1,
          "the calendar has a List tab")
    pg.click('[data-action="cal-tab"][data-tab="list"]'); pg.wait_for_timeout(500)

    def rows():
        """Ordered [(when, title)] of the ZZ probe rows in the list."""
        return pg.evaluate("""() => [...document.querySelectorAll('.cal-list .cal-agenda-row')]
          .map(r => [ (r.querySelector('.cal-agenda-when')||{}).textContent.trim(),
                      (r.querySelector('.cal-agenda-title')||{}).textContent.trim() ])
          .filter(p => p[1].indexOf('ZZ') === 0);""")

    r = rows()
    titles = [t for _, t in r]

    def find(frag):
        return [t for t in titles if frag in t]

    # ---------- the four inclusion rules ----------
    check(len(find("ZZ passport")) == 1, f"a HIDDEN event is listed ({find('ZZ passport')})")
    check("hidden" in (find("ZZ passport") or [""])[0],
          f"and it is tagged hidden ({find('ZZ passport')})")

    check(len(find("ZZ gym")) == 1, f"a PAUSED series is listed ({find('ZZ gym')})")
    check("paused" in (find("ZZ gym") or [""])[0],
          f"and it is tagged paused ({find('ZZ gym')})")

    check(len(find("ZZ standup")) == 1,
          f"a repeating series contributes exactly ONE row ({find('ZZ standup')})")

    check(len(find("ZZ file taxes")) == 1, f"an action deadline is listed ({find('ZZ file taxes')})")
    check("deadline" in (find("ZZ file taxes") or [""])[0],
          f"and is labelled a deadline ({find('ZZ file taxes')})")

    # ---------- ordering ----------
    order = [t.split(" ")[1] for t in titles]
    want_before = [("standup", "gym"), ("gym", "dentist"), ("dentist", "passport")]
    for a, c in want_before:
        ia = next((i for i, t in enumerate(order) if t == a), -1)
        ic = next((i for i, t in enumerate(order) if t == c), -1)
        check(ia >= 0 and ic >= 0 and ia < ic, f"{a} is listed before {c} ({order})")

    # Untimed before timed within one day: 18 Jun has all-day, then 11:00, then 14:30
    day18 = [w for w, t in r if t.split(" ")[1] in ("all", "file", "dentist")]
    check(day18 == ["All day", "11:00", "14:30"],
          f"within a day, untimed comes first then timed in order ({day18})")

    # ---------- the flagged exclusions ----------
    check(not find("ZZ long gone"), f"a finished past one-shot is not listed ({find('ZZ long gone')})")
    check(not find("ZZ past due thing"),
          f"[flagged] a past-due deadline is not listed ({find('ZZ past due thing')})")

    # ---------- a row still opens its item ----------
    pg.locator('.cal-list .cal-agenda-row:has-text("ZZ dentist")').first.click()
    pg.wait_for_timeout(600)
    opened = pg.evaluate("""() => {
      const el = document.querySelector('[data-field=\\"title\\"], .screen-field-title');
      return el ? el.value : null;
    }""")
    check(opened == "ZZ dentist", f"tapping a list row opens that item ({opened})")

    # ---------- the controls sit in the same place on every tab ----------
    # The create row used to start immediately under the day's content, so an
    # empty day floated it up under the header while Month view had it two
    # thirds down (user). Day and List now reserve a full month grid's height.
    # The row-tap check above left us on the event's own page, not the calendar.
    # Reload rather than trying to unwind the screen stack.
    pg.reload(); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(500)

    def create_top(tab):
        pg.click('[data-action="cal-tab"][data-tab="%s"]' % tab); pg.wait_for_timeout(450)
        return pg.evaluate("""() => {
          const c = document.querySelector('.cal-create');
          return c ? Math.round(c.getBoundingClientRect().top) : null;
        }""")

    tops = {t: create_top(t) for t in ("month", "day", "list")}
    check(all(v is not None for v in tops.values()), f"every tab renders the controls ({tops})")
    if all(v is not None for v in tops.values()):
        spread = max(tops.values()) - min(tops.values())
        check(spread <= 4, f"the controls land in the same place on every tab ({tops})")

    # An EMPTY day must not float them up either.
    pg.click('[data-action="cal-tab"][data-tab="month"]'); pg.wait_for_timeout(400)
    pg.click('.cal-cell[data-date="2026-06-24"]'); pg.wait_for_timeout(300)
    pg.click('[data-action="cal-tab"][data-tab="day"]'); pg.wait_for_timeout(450)
    empty_top = pg.evaluate("""() => {
      const c = document.querySelector('.cal-create');
      return c ? Math.round(c.getBoundingClientRect().top) : null;
    }""")
    check(empty_top is not None and abs(empty_top - tops["month"]) <= 4,
          f"an empty day keeps the controls in place ({empty_top} vs month {tops['month']})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

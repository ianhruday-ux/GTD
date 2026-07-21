"""Creating an event from the project page, and the deadline rule.

User rulings:
  · "you should refuse events scheduled beyond the deadline, but there should be
    an error message above the field. 'This is scheduled after the project
    deadline.'"
  · "I'm inclined to go with cheap for recurring events. Only connect the event
    to the project if it's within the project deadline. We can let users delete
    the series if it creates clutter."

⚑ So a REPEAT is checked on its FIRST occurrence only. A series that starts
inside the deadline is linked and then runs on past it, by design — the
alternative was giving recurrence an end date, which is a new field on the
most load-bearing logic in the app and was ruled out as its own feature.

⚠ There is no create mode on the event page — events are only ever made from the
calendar's creation row. So this reuses the review's existing "open the calendar
prefilled, come back when done" route rather than building a second event form.
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

# deadline 2026-06-30 — the whole point of the fixture
PROJECT = {"id": "zz-proj", "title": "ZZ build the shed", "notesClean": "",
           "linkedProjectId": None, "isGroup": False, "parent": None,
           "whenText": None, "contextId": None,
           "deadline": {"date": "2026-06-30", "time": None}}

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1100)
    pg.evaluate("""(proj) => {
      const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
      localStorage.setItem('gtd_tasks_current',
        JSON.stringify(cur.filter(t => t.id !== proj.id).concat([proj])));
      localStorage.setItem('gtd_events', '[]');
    }""", PROJECT)
    pg.reload(); pg.wait_for_timeout(1100)

    def open_project():
        pg.evaluate("""() => {
          ['#tray-root', '#dialog-root', '#screen-root'].forEach(sel => {
            const el = document.querySelector(sel); if (el) el.innerHTML = '';
          });
          document.body.classList.remove('screen-open');
          window.scrollTo(0, 0);
        }""")
        pg.wait_for_timeout(250)
        pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
        pg.locator('.card-title:has-text("ZZ build the shed")').first.click()
        pg.wait_for_timeout(600)

    def goto_day(iso):
        """Select a day in the open calendar, paging months as needed."""
        MONTHS = ["January","February","March","April","May","June","July",
                  "August","September","October","November","December"]
        y, m, _d = iso.split("-")
        target = int(y) * 12 + int(m) - 1
        for _ in range(24):
            cell = pg.locator('.cal-cell[data-date="%s"]' % iso)
            if cell.count():
                cell.first.click(); pg.wait_for_timeout(350)
                return True
            lab = pg.locator(".cal-monthlabel").first.inner_text().strip()
            name, yr = lab.split()
            cur = int(yr) * 12 + MONTHS.index(name)
            pg.click('[data-action="cal-month"][data-dir="%d"]' % (1 if target > cur else -1))
            pg.wait_for_timeout(250)
        return False

    def events():
        return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_events') || '[]')")

    # ---------- the button, and where it goes ----------
    open_project()
    add = pg.locator('[data-action="new-linked-event"]')
    check(add.count() == 1, f"the project offers New event ({add.count()})")
    onnotes = pg.evaluate("""() => {
      const b = document.querySelector('[data-action="new-linked-event"]');
      return !!(b && b.closest('.screen-body'));
    }""")
    check(onnotes, "and it is on the page")
    add.first.click(); pg.wait_for_timeout(800)
    check(pg.locator(".cal-create").count() == 1, "it opens the calendar")
    banner = pg.locator(".cal-for-project")
    check(banner.count() == 1, "which says which project it is adding to")
    check("ZZ build the shed" in banner.first.inner_text(),
          f"naming the project ({banner.first.inner_text()})")

    # ---------- REFUSED past the deadline, with the reason ----------
    check(goto_day("2026-07-05"), "picked a day after the deadline")
    pg.fill(".cal-name", "ZZ too late")
    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(500)
    err = pg.locator(".cal-error")
    check(err.count() == 1, "adding past the deadline is refused with a message")
    check("after the project deadline" in err.first.inner_text().lower(),
          f"and the message says why ({err.first.inner_text()})")
    above = pg.evaluate("""() => {
      const e = document.querySelector('.cal-error');
      const f = document.querySelector('.cal-name');
      if (!e || !f) return false;
      return e.getBoundingClientRect().top < f.getBoundingClientRect().top;
    }""")
    check(above, "the message sits ABOVE the field, as asked")
    check(len(events()) == 0, f"and nothing was created ({len(events())})")

    # picking a different day clears it — the app's standing validation rule
    check(goto_day("2026-06-20"), "picked a day inside the deadline")
    check(pg.locator(".cal-error").count() == 0, "choosing another day clears the message")

    # ---------- allowed inside the deadline, and linked ----------
    pg.fill(".cal-name", "ZZ site meeting")
    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(800)
    evs = events()
    check(len(evs) == 1, f"an event inside the deadline is created ({len(evs)})")
    check(evs and evs[0]["linkedProjectId"] == "zz-proj",
          f"and linked to the project ({evs[0].get('linkedProjectId') if evs else None})")
    back = pg.evaluate("""() => {
      const el = document.querySelector('[data-field="title"]');
      return el ? el.value : null;
    }""")
    check(back == "ZZ build the shed", f"and adding returns you to the project ({back})")

    # ---------- a REPEAT is judged on its FIRST occurrence only ----------
    # Starts inside the deadline, so it is allowed and linked — and then runs on
    # past the deadline for ever, which is the accepted cost of the cheap option.
    open_project()
    pg.locator('[data-action="new-linked-event"]').first.click(); pg.wait_for_timeout(800)
    goto_day("2026-06-22")
    pg.fill(".cal-name", "ZZ weekly standup")
    pg.select_option('[data-calfield="recur"]', "weekly")
    pg.wait_for_timeout(250)
    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(800)
    evs = events()
    rep = [e for e in evs if e["title"] == "ZZ weekly standup"]
    check(len(rep) == 1, f"a repeat starting inside the deadline is allowed ({len(rep)})")
    check(rep and rep[0]["linkedProjectId"] == "zz-proj",
          "and it IS linked, even though later occurrences fall past the deadline")
    check(rep and rep[0]["recurrence"] == "weekly", "and it really is a repeat")

    # but a repeat whose FIRST occurrence is past the deadline is refused
    open_project()
    pg.locator('[data-action="new-linked-event"]').first.click(); pg.wait_for_timeout(800)
    goto_day("2026-07-06")
    pg.fill(".cal-name", "ZZ late repeat")
    pg.select_option('[data-calfield="recur"]', "weekly")
    pg.wait_for_timeout(250)
    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(600)
    check(pg.locator(".cal-error").count() == 1,
          "a repeat STARTING past the deadline is refused like any other")
    check(not any(e["title"] == "ZZ late repeat" for e in events()),
          "and is not created")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

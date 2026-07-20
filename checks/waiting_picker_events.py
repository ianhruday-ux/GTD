"""QA #31 — repeating events in the Waiting action's condition picker.

A Waiting action can be hooked to a pending event (§10). The picker built that
list from `ev.date` and dropped anything `occPassed()` called expired — correct
for a one-shot, wrong for a series.

⚑ The failing window is narrower than the report suggests, and worth writing
down because it is not obvious. A series with a LIVE occurrence is fine: it has
a pseudo-action row, so it is offered under "Next Actions". The hole opens once
that occurrence is COMPLETED — the pseudo-row is removed, but `ev.date` does not
roll until the 4 AM boundary. In between (up to a full day) the old code saw a
passed date, no live row, and offered the series nowhere at all. Tick off your
09:00 standup and you could not hook anything to it for the rest of the day.

A series is never expired; only its current occurrence is. The picker must offer
the NEXT occurrence, and offer it exactly once.
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


# 10:00 — after the 09:00 occurrence, before the 4 AM roll. The bug's window.
BASE = datetime.datetime(2026, 6, 15, 10, 0, 0)

WAITER = {
    "id": "w1", "title": "ZZ probe waiter", "notesClean": "", "linkedProjectId": None,
    "isGroup": False, "parent": None, "whenText": None, "conditionId": None,
    "conditionKind": None, "conditionLabel": None, "bundleText": None,
    "contextId": None, "createdAt": 0,
}


def event(**over):
    ev = {
        "id": "ev1", "taskId": "t1", "title": "Team standup", "date": "2026-06-15",
        "time": "09:00", "notesClean": "", "recurrence": "daily", "interval": 1,
        "paused": False, "contextId": None, "linkedProjectId": None,
        "seriesId": "s1", "tickler": False, "completedOccs": [],
    }
    ev.update(over)
    return ev


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)

    def open_picker(ev):
        # ⚠ Clear the pseudo-action row too. It lives in gtd_tasks_next under the
        # EVENT's taskId and survives a reload, so without this a row minted by an
        # earlier probe makes the next probe's event look live — which reads as a
        # pass in the wrong section. Let each scenario mint its own row (or not).
        pg.evaluate(
            """([e, w]) => {
                 localStorage.setItem('gtd_events', JSON.stringify(e ? [e] : []));
                 const nxt = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
                 localStorage.setItem('gtd_tasks_next',
                   JSON.stringify(nxt.filter(t => t.id !== 't1')));
                 const cur = JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]');
                 if (!cur.some(t => t.id === 'w1')) cur.push(w);
                 localStorage.setItem('gtd_tasks_waiting', JSON.stringify(cur));
               }""", [ev, WAITER])
        pg.reload(); pg.wait_for_timeout(1000)
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        pg.click('.tab[data-kind="waiting"]'); pg.wait_for_timeout(300)
        pg.locator('.card-title:has-text("ZZ probe waiter")').first.click()
        pg.wait_for_timeout(500)
        pg.click('[data-action="screen-open-condition-pick"]'); pg.wait_for_timeout(400)

    def rows_by_section():
        """{section label: [row text, ...]} for rows naming the standup."""
        return pg.evaluate("""() => {
          const out = {};
          [...document.querySelectorAll('.screen-hook-pick-label')].forEach(l => {
            const list = l.nextElementSibling;
            if (!list) return;
            const hits = [...list.querySelectorAll('.screen-hook-pick-item')]
              .map(b => b.textContent.trim()).filter(t => /standup/i.test(t));
            if (hits.length) out[l.textContent.trim()] = hits;
          });
          return out;
        }""")

    def total(sections):
        return sum(len(v) for v in sections.values())

    # ---------- THE BUG: completed today, series has not rolled yet ----------
    open_picker(event(completedOccs=["2026-06-15"]))
    s = rows_by_section()
    check("Upcoming events" in s,
          f"a completed-today series is still offered ({s})")
    check(s.get("Upcoming events") and "16 Jun" in s["Upcoming events"][0],
          f"and it is offered at its NEXT occurrence ({s})")
    check(total(s) == 1, f"exactly one row, not one per occurrence ({s})")

    # ---------- a live occurrence is offered as its pseudo-action ----------
    # Not under "Upcoming events" — it is a real row in Next Actions. The point
    # of this case is that the fix did not start listing it in BOTH places.
    open_picker(event())
    s = rows_by_section()
    check(list(s.keys()) == ["Next Actions"],
          f"a live occurrence is offered once, as its pseudo-action ({s})")
    check(total(s) == 1, f"and is not double-listed under Upcoming events ({s})")

    # ---------- an untimed live occurrence behaves the same ----------
    open_picker(event(time=None))
    s = rows_by_section()
    check(total(s) == 1, f"an untimed live occurrence is offered once ({s})")

    # ---------- a future series is offered at its own date ----------
    open_picker(event(date="2026-06-16"))
    s = rows_by_section()
    check(s.get("Upcoming events") and "16 Jun" in s["Upcoming events"][0],
          f"a future series is offered on its own day ({s})")
    check(total(s) == 1, f"and only once ({s})")

    # ---------- a finished one-shot is gone for good ----------
    open_picker(event(recurrence="none", completedOccs=["2026-06-15"]))
    s = rows_by_section()
    check(total(s) == 0, f"a passed, completed one-shot is not offered ({s})")

    # ---------- a future one-shot is offered ----------
    open_picker(event(recurrence="none", date="2026-06-20", time=None))
    s = rows_by_section()
    check(s.get("Upcoming events") and "20 Jun" in s["Upcoming events"][0],
          f"a future one-shot is offered ({s})")

    # ---------- a paused series is still excluded ----------
    open_picker(event(paused=True, completedOccs=["2026-06-15"]))
    s = rows_by_section()
    check(total(s) == 0, f"a paused series is not offered ({s})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

"""What happens to a project's calendar entries when the project ends.

Found while writing the projects/calendar design brief: `state.events` was
touched in exactly three places in app.js — the condition picker, the review's
loop scan, and boot. NO project lifecycle path touched events at all. So a
project could be completed, deleted or parked and its events carried on firing.

⚠ The three cases are NOT equally bad, and it is worth recording which is which
so nobody "fixes" the harmless one into a data-loss bug:

  COMPLETE  — the real one. A repeating event on a finished project kept minting
              a Next Action every week for ever. Archived now, mirroring what
              linked WAITING items already did, because completing a project is
              easy to do by mistake and a deleted series cannot be got back.
  SOMEDAY   — also real. The app kept interrupting about a project you had
              explicitly parked. Follows the precedent the codebase ALREADY had
              for actions (a Someday project holds no links; you choose unlink
              or delete) rather than the pausing originally proposed.
  DELETE    — mild. An event with a dangling project id already behaved
              correctly, because it just keeps firing as an ordinary entry —
              which IS the wanted "unlink, don't delete". Only the stale id is
              cleared. Deleting the events would be the wrong fix: a meeting can
              outlive the project it was booked for.
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

PROJECT = {"id": "zz-proj", "title": "ZZ build the shed", "notesClean": "",
           "linkedProjectId": None, "isGroup": False, "parent": None,
           "whenText": None, "deadline": None, "contextId": None}
EVENT = {"id": "zz-ev", "taskId": "zz-evt", "title": "ZZ site meeting",
         "date": "2026-06-16", "time": "09:00", "notesClean": "",
         "recurrence": "weekly", "interval": 1, "paused": False,
         "contextId": None, "linkedProjectId": "zz-proj", "seriesId": "zz-s1",
         "tickler": False, "completedOccs": []}

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)

    def seed():
        pg.evaluate("""([proj, ev]) => {
          const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
          localStorage.setItem('gtd_tasks_current',
            JSON.stringify(cur.filter(t => t.id !== proj.id).concat([proj])));
          localStorage.setItem('gtd_events', JSON.stringify([ev]));
          localStorage.removeItem('gtd_archived_events');
        }""", [PROJECT, EVENT])
        pg.reload(); pg.wait_for_timeout(1000)
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    def state():
        return pg.evaluate("""() => {
          const evs = JSON.parse(localStorage.getItem('gtd_events') || '[]');
          const arch = JSON.parse(localStorage.getItem('gtd_archived_events') || '{}');
          const nxt = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
          const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
          return { live: evs.length,
                   link: evs.length ? evs[0].linkedProjectId : null,
                   archived: (arch['zz-proj'] || []).length,
                   pseudoRows: nxt.filter(t => t.eventId === 'zz-ev').length,
                   projectStillCurrent: cur.some(t => t.id === 'zz-proj') };
        }""")

    def open_project():
        # ⚠ Clear the decks first. Each case leaves something over the lanes —
        # a screen, a dialog, the auto-opening drawer — and the lane tab is
        # then present but not clickable, which reads as a mysterious timeout.
        pg.evaluate("""() => {
          ['#tray-root', '#dialog-root', '#screen-root'].forEach(sel => {
            const el = document.querySelector(sel); if (el) el.innerHTML = '';
          });
          document.body.classList.remove('screen-open');
          // ⚠ The tab bar COLLAPSES as you scroll (a designed behaviour), so a
          // page left scrolled down has present-but-invisible lane tabs.
          window.scrollTo(0, 0);
        }""")
        pg.wait_for_timeout(250)
        pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
        pg.locator('.card-title:has-text("ZZ build the shed")').first.click()
        pg.wait_for_timeout(600)

    def dialog_text():
        el = pg.locator(".choice-dialog p")
        return el.first.inner_text() if el.count() else None

    # ---------- the linked event is live to begin with ----------
    seed()
    st = state()
    check(st["live"] == 1 and st["link"] == "zz-proj", f"the event starts linked and live ({st})")

    # ---------- COMPLETE: archived, and it says so ----------
    open_project()
    pg.locator('[data-action="screen-complete"], .screen-complete-pill').first.click()
    pg.wait_for_timeout(300)
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(600)
    msg = dialog_text()
    check(msg is not None, f"completing warns before touching anything ({msg})")
    check(msg and ("calendar" in msg.lower()),
          f"and the warning NAMES the calendar entries ({msg})")
    pg.locator('.choice-dialog button:has-text("Complete project")').first.click()
    pg.wait_for_timeout(800)
    st = state()
    check(st["live"] == 0, f"the event is no longer live ({st})")
    check(st["archived"] == 1, f"it was archived, not deleted ({st})")
    check(st["pseudoRows"] == 0, f"and it stopped appearing in Next Actions ({st})")

    # ---------- it stays gone across a reload and a day roll ----------
    pg.reload(); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    pg.click("#qa-day-btn"); pg.wait_for_timeout(400)
    pg.click("#qa-day-btn"); pg.wait_for_timeout(400)
    st = state()
    check(st["live"] == 0 and st["pseudoRows"] == 0,
          f"a completed project's repeat does not come back a week later ({st})")

    # ---------- SOMEDAY: the choice, and unlink keeps the entry ----------
    seed()
    open_project()
    # ⚠ Converting is DRAFT-ONLY like everything else on this page: the button
    # arms it, Save commits it. Clicking the button alone does nothing.
    pg.locator('[data-action="make-kind"][data-dest="future"]').first.click()
    pg.wait_for_timeout(300)
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(600)
    msg = dialog_text()
    check(msg is not None and "calendar" in msg.lower(),
          f"parking a project asks about its calendar entries ({msg})")
    pg.locator('.choice-dialog button:has-text("Unlink")').first.click()
    pg.wait_for_timeout(800)
    st = state()
    check(st["live"] == 1, f"unlink KEEPS the calendar entry ({st})")
    check(st["link"] is None, f"but it is no longer tied to the project ({st})")
    check(not st["projectStillCurrent"], f"and the project moved to Someday ({st})")

    # ---------- DELETE the project: the entry survives, unlinked ----------
    seed()
    open_project()
    pg.locator('[data-action="screen-delete"]').first.click()
    pg.wait_for_timeout(400)
    dlg = pg.locator('.choice-dialog button:has-text("Delete")')
    if dlg.count():
        dlg.first.click(); pg.wait_for_timeout(800)
    st = state()
    check(st["live"] == 1,
          f"deleting a project does NOT delete its calendar entries ({st})")
    check(st["link"] is None,
          f"and the dangling project link is cleared ({st})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

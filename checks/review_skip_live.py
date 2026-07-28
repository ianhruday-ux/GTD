"""Author third QA round (review-surface-plan.md): "Skipped" now also
appears on a still-live (not yet rolled-past) recurring event's past-due
pseudo-action card, not just the already-rolled "missed" card. Also checks
the button-label unification: every "this is done" button now says
"Completed", every delete button says "Delete" (not "Delete it" / "Mark
done" / "Complete it" / "Complete").
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, datetime
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


BASE = datetime.datetime(2026, 6, 15, 15, 0, 0)  # a Monday, 3pm


def weekly_ev(**o):
    # 09:00 weekly, dated TODAY: passed today (9am < 3pm) but appearCivil ==
    # today, so the boundary sweep leaves it live (pastdue pseudo), not yet
    # rolled to "missed" -- exactly the still-live state under test.
    e = {"id": "e1", "taskId": "t1", "title": "ZZ live overdue", "date": "2026-06-15",
         "time": "09:00", "notesClean": "", "recurrence": "weekly", "interval": 1,
         "paused": False, "contextId": None, "linkedProjectId": None,
         "seriesId": "s1", "tickler": False, "completedOccs": []}
    e.update(o)
    return e


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)

    def seed(e):
        pg.evaluate("""(e) => {
          localStorage.setItem('gtd_events', JSON.stringify([e]));
          const nxt = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
          localStorage.setItem('gtd_tasks_next', JSON.stringify(nxt.filter(t => t.id !== 't1')));
          localStorage.setItem('gtd_tray', '[]');
        }""", e)
        pg.reload(); pg.wait_for_timeout(1000)

    def stored():
        return pg.evaluate("""() => {
          const e = JSON.parse(localStorage.getItem('gtd_events') || '[]')[0];
          return e ? { date: e.date, missed: e.missedOcc || null,
                       done: e.completedOccs || [] } : null;
        }""")

    def open_review():
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
        pg.wait_for_timeout(350)
        pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
        pg.wait_for_timeout(600)

    def close_review():
        pg.evaluate("() => { const c=document.querySelector('[data-action=\"review-close\"]'); if(c) c.click(); }")
        pg.wait_for_timeout(300)

    # ---------- the live overdue recurring card offers Skipped ----------
    seed(weekly_ev())
    st = stored()
    check(st["date"] == "2026-06-15", f"fixture: the occurrence has NOT rolled past yet ({st})")
    open_review()
    title = pg.evaluate("""() => { const el = document.querySelector('.review-card-title');
      return el ? el.textContent.trim() : null; }""")
    check(title == "ZZ live overdue", f"the live overdue card is revealed ({title})")
    check(pg.locator('[data-action="review-complete"]').count() == 1, "it offers Completed")
    check(pg.locator('[data-action="review-skip-live"]').count() == 1,
          "and now ALSO offers Skipped, same as the already-rolled 'missed' card")
    completed_label = pg.evaluate("""() => { const b = document.querySelector('[data-action="review-complete"]');
      return b ? b.textContent.trim() : null; }""")
    check("Completed" in completed_label, f"labelled 'Completed', not 'Mark done' ({completed_label})")
    skip_label = pg.evaluate("""() => { const b = document.querySelector('[data-action="review-skip-live"]');
      return b ? b.textContent.trim() : null; }""")
    check(skip_label == "Skipped", f"labelled 'Skipped' ({skip_label})")
    delete_label = pg.evaluate("""() => { const b = document.querySelector('[data-action="review-delete-event"]');
      return b ? b.textContent.trim() : null; }""")
    check("Delete" in delete_label, f"delete labelled 'Delete' ({delete_label})")

    # ---------- clicking Skipped ----------
    pg.locator('[data-action="review-skip-live"]').first.click(); pg.wait_for_timeout(600)
    st = stored()
    check(st["date"] == "2026-06-22", f"the series advanced to its next occurrence ({st})")
    check(st["done"] == [], f"and it was NOT credited as done ({st})")
    check(st["missed"] is None, f"nor recorded as a silently-discovered miss ({st})")
    close_review()
    row_gone = pg.evaluate("""() => { const rows = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
      return rows.some(t => t.id === 't1'); }""")
    check(not row_gone, "and today's now-resolved row is gone from the lane")

    # ---------- a ONE-SHOT overdue event does NOT offer Skipped ----------
    seed(weekly_ev(recurrence="none"))
    open_review()
    title2 = pg.evaluate("""() => { const el = document.querySelector('.review-card-title');
      return el ? el.textContent.trim() : null; }""")
    check(title2 == "ZZ live overdue", f"fixture: the one-shot overdue card is revealed ({title2})")
    check(pg.locator('[data-action="review-skip-live"]').count() == 0,
          "a one-shot has no next occurrence to roll onto, so no Skipped button")
    check(pg.locator('[data-action="review-complete"]').count() == 1, "still offers Completed")
    check(pg.locator('[data-action="review-delete-event"]').count() == 1, "still offers Delete")
    close_review()

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

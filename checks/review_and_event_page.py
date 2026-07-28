"""QA #27, #13, #19 — the event page's armed Complete pill, Delete on a past-due
event in the review, and returning to the review after adding to the calendar.

Note the review is opened from INSIDE the intray drawer, so a test that clears
#tray-root has thrown away its own entry point."""
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
    pg = b.new_context(viewport={"width": 400, "height": 820}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)

    def load():
        pg.wait_for_timeout(800)
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        pg.wait_for_timeout(150)

    def open_review():
        # the Review button lives inside the tray drawer, so re-open the tray
        pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
        pg.wait_for_timeout(500)
        pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
        pg.wait_for_timeout(800)

    pg.goto(url); load()

    # ---------- #27: the armed Complete pill must be shaded like every other ----------
    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(400)
    pg.fill('[data-calfield="name"]', "Shading probe")
    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(500)
    pg.click('[data-action="cal-close"]'); pg.wait_for_timeout(400)
    pg.locator('.card-title:has-text("Shading probe")').first.click(); pg.wait_for_timeout(600)
    pill = pg.locator('[data-action="event-complete"]').first
    check(pill.count() == 1, "event page has a Complete pill")
    before = pg.evaluate("() => { const e=document.querySelector('[data-action=\"event-complete\"]');"
                         " const c=getComputedStyle(e); return c.backgroundColor+'|'+c.color; }")
    pill.click(); pg.wait_for_timeout(400)
    cls = pg.evaluate("() => document.querySelector('[data-action=\"event-complete\"]').className")
    after = pg.evaluate("() => { const e=document.querySelector('[data-action=\"event-complete\"]');"
                        " const c=getComputedStyle(e); return c.backgroundColor+'|'+c.color; }")
    check("done" in cls, f"armed pill uses the app-wide 'done' class (got {cls!r})")
    check(before != after, f"armed pill actually changes shading ({before} -> {after})")

    # ---------- #13: a past-due event in the review offers Delete ----------
    pg.evaluate("""() => {
      const evs = JSON.parse(localStorage.getItem('gtd_events'));
      const e = evs.find(x => x.title === 'Shading probe');
      e.date = '2026-01-05';                       // long past, one-shot
      localStorage.setItem('gtd_events', JSON.stringify(evs));
      const rows = JSON.parse(localStorage.getItem('gtd_tasks_next'));
      const r = rows.find(t => t.eventId === e.id);
      if (r){ r.occDate = e.date; r.occCanon = e.date; }
      localStorage.setItem('gtd_tasks_next', JSON.stringify(rows));
    }""")
    pg.reload(); load()
    open_review()
    card = pg.locator('.review-card:has-text("Shading probe")').first
    check(card.count() == 1, "the past-due event reaches the review")
    check(card.locator('[data-action="review-complete"]').count() == 1, "it still offers Completed")
    check(card.locator('[data-action="review-delete-event"]').count() == 1, "it now offers Delete (#13)")

    # deleting must remove the EVENT, not just the row (or the sweep re-mints it)
    # ⚑ NO confirm dialog for a one-shot review delete (author ruling, third QA
    # round — review deletes are triage, not drafting; the only exception is a
    # recurring event, where "delete" is ambiguous). This fixture is one-shot.
    check(pg.locator('.choice-dialog').count() == 0, "no confirm dialog is showing yet")
    card.locator('[data-action="review-delete-event"]').click(); pg.wait_for_timeout(600)
    check(pg.locator('.choice-dialog').count() == 0,
          "and none appears — a one-shot event deletes immediately from the review")
    gone_ev = pg.evaluate("() => !JSON.parse(localStorage.getItem('gtd_events')).some(e => e.title === 'Shading probe')")
    check(gone_ev, "Delete removes the underlying event, not only the lane row")
    pg.reload(); load()
    check(pg.locator('.card-title:has-text("Shading probe")').count() == 0,
          "and it does not come back after a reload")

    # ---------- #19: adding from the review returns to the review ----------
    pg.evaluate("""() => localStorage.setItem('gtd_tray',
        JSON.stringify([{id:'cap1', text:'Book the dentist', createdAt: Date.now()}]))""")
    pg.reload(); load()
    open_review()
    cal_chip = pg.locator('[data-action="review-sort"][data-target="calendar"]').first
    check(cal_chip.count() == 1, "the review offers a Calendar chip")
    cal_chip.click(); pg.wait_for_timeout(600)
    check(pg.locator('.cal-create').count() == 1, "the Calendar chip opens the calendar")
    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(800)
    check(pg.locator('.cal-create').count() == 0, "the calendar closes after adding (#19)")
    check(pg.locator('.review-card, .review-body').count() > 0, "and we are back on the review (#19)")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

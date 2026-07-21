"""The calendar's "More options →" — a full creation page for an event.

User: "It's currently not possible to link an event to a project, or add it to a
context during event creation. I suggest putting an advanced options button that
will open a full creation page near the calendar controls. The page is already
built. You just need to reuse the drafting page and remove the complete and
delete buttons."

Exactly that: the same eventView screen opened with no eventId. The quick-add
row's values come across so nothing typed is lost, and the two fields the row
cannot offer — context and project link — are the point of the page.

WARNING: the hidden controls are not cosmetic. Complete, Pause and Make-habit all
act on an event that exists; on a create page there is nothing for them to act on,
and Make-habit in particular would hand makeHabitFromEvent an undefined event.
The delete button drops out on its own because screenHeaderHtml keys it to
s.taskId. Each is asserted absent below so a future "why is this gated?" tidy-up
has to read this first.
"""
import os, sys, functools, http.server, socket, socketserver, threading, contextlib
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

DIST = os.path.join(REPO, "dist")


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
    (notes if cond else fails).append(("PASS  " if cond else "FAIL  ") + msg)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)

    def kill_tray():
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    def open_calendar():
        kill_tray()
        pg.evaluate("() => document.querySelector('[data-action=\"open-calendar\"]').click()")
        pg.wait_for_timeout(600)

    def events():
        return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_events') || '[]')")

    # ---------- the door exists, and only on the Event side ----------
    open_calendar()
    check(pg.locator('[data-action="cal-advanced"]').count() == 1,
          "the creation row has a More options button")
    pg.locator('[data-action="cal-kind"][data-kind="deadline"]').first.click()
    pg.wait_for_timeout(350)
    check(pg.locator('[data-action="cal-advanced"]').count() == 0,
          "but NOT on the Deadline side — that creates a task, which has its own page")
    pg.locator('[data-action="cal-kind"][data-kind="event"]').first.click()
    pg.wait_for_timeout(350)

    # ---------- what was typed comes with you ----------
    pg.locator('.cal-name').first.fill("ZZ advanced event"); pg.wait_for_timeout(200)
    pg.locator('.cal-desc').first.fill("ZZ carried description"); pg.wait_for_timeout(200)
    pg.locator('[data-action="cal-advanced"]').first.click(); pg.wait_for_timeout(650)
    check(pg.locator('.screen-field-title').count() == 1, "it opens the full event page")
    check(pg.evaluate("() => document.querySelector('.screen-field-title').value") == "ZZ advanced event",
          "carrying the title already typed")
    check("ZZ carried description" in pg.evaluate(
              "() => document.querySelector('.screen-field-desc').value"),
          "and the description")

    # ---------- the controls that must not be there ----------
    check(pg.locator('[data-action="event-complete"]').count() == 0,
          "no Complete pill — completing a thing you have not created is incoherent")
    check(pg.locator('[data-action="screen-delete"]').count() == 0,
          "no Delete button — nothing to delete")
    check(pg.locator('[data-action="event-toggle-pause"]').count() == 0,
          "no Pause — same shape as Complete")
    check(pg.locator('[data-action="event-make-habit"]').count() == 0,
          "no Make-habit — it needs a real event; the quick-add row still offers it")

    # ---------- the two fields this page exists for ----------
    popts = pg.evaluate("""() => [...document.querySelectorAll('[data-field="linkedProjectId"] option')]
        .map(o => o.value).filter(Boolean)""")
    copts = pg.evaluate("""() => { const s = document.querySelector('[data-field="contextId"]');
        return s ? [...s.options].map(o => o.value).filter(Boolean) : []; }""")
    check(len(popts) > 0, f"a project link is offered ({len(popts)} projects)")
    check(len(copts) > 0, f"and a context ({len(copts)} contexts)")
    pg.select_option('[data-field="linkedProjectId"]', popts[0]); pg.wait_for_timeout(350)
    pg.select_option('[data-field="contextId"]', copts[0]); pg.wait_for_timeout(350)

    before = len(events())
    pg.locator('[data-action="screen-save"]').first.click(); pg.wait_for_timeout(800)
    check(pg.locator('.cal-tabs').count() == 1, "saving returns to the calendar it came from")
    made = [e for e in events() if e["title"] == "ZZ advanced event"]
    check(len(made) == 1, f"exactly one event was created ({len(events())} vs {before})")
    if made:
        e = made[0]
        check(e.get("linkedProjectId") == popts[0], f"with the project link ({e.get('linkedProjectId')})")
        check(e.get("contextId") == copts[0], f"and the context ({e.get('contextId')})")
        check(e.get("notesClean") == "ZZ carried description", "and the description")

    # ---------- an empty title is a silent discard, like every other page ----------
    open_calendar()
    before = len(events())
    pg.locator('[data-action="cal-advanced"]').first.click(); pg.wait_for_timeout(650)
    pg.locator('[data-action="screen-save"]').first.click(); pg.wait_for_timeout(700)
    check(len(events()) == before,
          f"an empty title creates nothing, silently (§4.6 house rule) ({len(events())} vs {before})")
    check(pg.locator('.cal-tabs').count() == 1, "and drops you back on the calendar")

    # ---------- X discards, as on every drafting page ----------
    open_calendar()
    before = len(events())
    pg.locator('.cal-name').first.fill("ZZ discarded event"); pg.wait_for_timeout(200)
    pg.locator('[data-action="cal-advanced"]').first.click(); pg.wait_for_timeout(650)
    pg.locator('[data-action="screen-cancel"]').first.click(); pg.wait_for_timeout(700)
    check(len(events()) == before,
          f"X on the advanced page creates nothing ({len(events())} vs {before})")
    check(not any(e["title"] == "ZZ discarded event" for e in events()),
          "and the discarded title is nowhere in the calendar")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

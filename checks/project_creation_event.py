"""A project CREATION page can add an event — staged, isolated, gate-satisfying.

User QA: "The add an event button doesn't appear on the project creation page.
Also, the warning about the unlinked action shouldn't appear on the creation page
unless someone tries to leave without creating an action or event."

The button used to be saved-projects-only, and the flag on it explained why:
adding an event goes through the CALENDAR, a separate full screen with its own
commit, so there was no draft to stage it into. There is now -- staged.eventCreates,
the same contract noteCreates already had.

WARNING: the half that MUST keep passing is DRAFT ISOLATION (CLAUDE.md). An event
added while drafting a project that is then X'd out of has to go with it. Without
that, this feature strands events in the calendar linked to projects that never
existed, which is worse than not having the button at all.
"""
import os, sys, functools, http.server, socket, socketserver, threading, contextlib, datetime
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from _pickers import enable_dev_tools

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


BASE = datetime.datetime(2026, 6, 15, 10, 0, 0)
fails, notes = [], []


def check(cond, msg):
    (notes if cond else fails).append(("PASS  " if cond else "FAIL  ") + msg)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)
    enable_dev_tools(pg)

    def kill_tray():
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    def events():
        return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_events')||'[]')"
                           ".map(e => e.title)")

    def projects():
        return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_current')||'[]')"
                           ".filter(t=>!t.isGroup).map(t=>t.title)")

    def open_new_project():
        kill_tray()
        pg.evaluate("""() => { const t=[...document.querySelectorAll('.tab')]
            .find(x=>x.getAttribute('data-kind')==='current'); if(t) t.click(); }""")
        pg.wait_for_timeout(400)
        pg.locator('#fab-create').first.click(); pg.wait_for_timeout(300)
        pg.locator('[data-action="new-primary"]').first.click(); pg.wait_for_timeout(500)

    def add_event_from_page(title):
        pg.locator('[data-action="new-linked-event"]').first.click(); pg.wait_for_timeout(600)
        assert pg.locator('.cal-name').count(), "calendar did not open"
        pg.locator('.cal-name').first.fill(title); pg.wait_for_timeout(200)
        pg.locator('[data-action="cal-add"]').first.click(); pg.wait_for_timeout(700)

    base_events = events()

    # ---------- the button is there at all ----------
    open_new_project()
    check(pg.locator('[data-action="new-linked-event"]').count() == 1,
          "+ New event renders on the project CREATION page")

    # ---------- the warning waits for a blocked save ----------
    flag = pg.locator('.screen-project-flag')
    check(flag.count() == 0,
          "the 'no linked actions' warning does NOT show on an untouched creation page")
    pg.locator('.screen-field-title').first.fill("ZZ staged project"); pg.wait_for_timeout(200)
    pg.locator('[data-action="screen-save"]').first.click(); pg.wait_for_timeout(500)
    check(pg.locator('.screen-project-flag').count() == 1,
          "it DOES show once a save is attempted with no way forward")
    check(pg.locator('.screen-field-title').count() == 1, "and the save was blocked (still on the page)")

    # ---------- the event stages, it does not write ----------
    add_event_from_page("ZZ staged event")
    check(pg.locator('.screen-field-title').count() == 1, "adding an event returns to the project page")
    check(events() == base_events,
          f"the event is NOT written while the project is unsaved ({events()})")
    check(pg.locator('.linked-action-staged').count() == 1,
          "but it IS shown on the page, as an inert staged row")
    check(pg.locator('.screen-project-flag').count() == 0,
          "and the warning clears — an event is a way forward (4.3b)")

    # ---------- X discards it with the project (DRAFT ISOLATION) ----------
    pg.locator('[data-action="screen-cancel"]').first.click(); pg.wait_for_timeout(400)
    dlg = pg.locator('.choice-dialog-backdrop')
    check(dlg.count() == 1, "X on a dirty project draft warns before discarding")
    if dlg.count():
        pg.locator('.choice-dialog-backdrop button', has_text="Discard").first.click()
        pg.wait_for_timeout(600)
    check(events() == base_events,
          f"X discarded the staged event — nothing stranded in the calendar ({events()})")
    check("ZZ staged project" not in projects(), "and no project was created")

    # ---------- Save commits both, together ----------
    open_new_project()
    pg.locator('.screen-field-title').first.fill("ZZ real project"); pg.wait_for_timeout(200)
    add_event_from_page("ZZ real event")
    pg.locator('[data-action="screen-save"]').first.click(); pg.wait_for_timeout(800)
    check("ZZ real event" in events(), f"Save writes the staged event ({events()})")
    check("ZZ real project" in projects(), f"and the project ({projects()})")
    link = pg.evaluate("""() => { const e=JSON.parse(localStorage.getItem('gtd_events'))
        .find(x=>x.title==='ZZ real event');
        const p=JSON.parse(localStorage.getItem('gtd_tasks_current'))
        .find(x=>x.title==='ZZ real project');
        return !!(e && p && e.linkedProjectId === p.id); }""")
    check(link, "and the event's linkedProjectId resolves to the new project")
    stalled = pg.evaluate("""() => { const cards=[...document.querySelectorAll('.card')]
        .find(c=>c.textContent.includes('ZZ real project'));
        return cards ? cards.textContent.includes('no linked actions') : null; }""")
    check(stalled is False, f"so the project is not flagged stalled in the lane ({stalled})")

    print("\n".join(notes + fails))
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    if errs:
        print("PAGE ERRORS:", errs)
    b.close()
    sys.exit(1 if (fails or errs) else 0)

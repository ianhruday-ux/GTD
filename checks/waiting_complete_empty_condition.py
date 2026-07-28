"""Bug (author): a waiting action with no condition and no free-text "waiting
for" -- e.g. one whose dangling condition was cleared, or one still mid-draft
-- could never be completed. saveScreen's §4.2 mutual-exclusivity check ran
unconditionally, so arming Complete and hitting Save just re-rejected the
save as an invalid edit, over and over, with no way out except typing
something into a field that's about to be archived anyway.

Fix: that validation is skipped when Complete is armed (willComplete) --
completing retires the item, it doesn't need a live condition. A plain edit
(Complete NOT armed) with an empty condition must still be rejected, same
as before.
"""
import os, functools, http.server, socketserver, socket, threading, contextlib, sys, json
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


def seed(pg, id_, title):
    pg.evaluate("""(o) => {
      const w = JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]');
      w.unshift({ id: o.id, title: o.title, notesClean: '',
        conditionId: null, conditionKind: null, whenText: null,
        linkedProjectId: null, contextId: null, createdAt: Date.now() });
      localStorage.setItem('gtd_tasks_waiting', JSON.stringify(w));
    }""", {"id": id_, "title": title})


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)

    def jclick(selector):
        pg.evaluate("(sel) => { const el = document.querySelector(sel); if (el) el.click(); }", selector)

    # ---------- arming Complete on an empty-condition waiting action archives it ----------
    seed(pg, "zz-empty", "ZZ empty condition waiter")
    pg.reload(); pg.wait_for_timeout(1000)
    jclick('[data-action="tab"][data-kind="waiting"]'); pg.wait_for_timeout(300)
    jclick('[data-action="open-edit"][data-kind="waiting"][data-id="zz-empty"]'); pg.wait_for_timeout(400)
    jclick('[data-action="screen-complete"]'); pg.wait_for_timeout(300)
    jclick('[data-action="screen-save"]'); pg.wait_for_timeout(400)
    still_open = pg.evaluate("() => !!document.querySelector('.screen-kind-badge')")
    check(not still_open, "Save closes the screen once Complete is armed, even with an empty condition")
    row = pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]').find(t => t.id === 'zz-empty')")
    check(row is None, "the item leaves the waiting list")
    completed = pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_completed_waiting') || '[]').find(t => t.id === 'zz-empty')")
    check(completed is not None, "and lands in the completed archive")

    # ---------- a plain edit (Complete NOT armed) with an empty condition is still rejected ----------
    seed(pg, "zz-empty2", "ZZ empty condition waiter 2")
    pg.reload(); pg.wait_for_timeout(1000)
    jclick('[data-action="tab"][data-kind="waiting"]'); pg.wait_for_timeout(300)
    jclick('[data-action="open-edit"][data-kind="waiting"][data-id="zz-empty2"]'); pg.wait_for_timeout(400)
    jclick('[data-action="screen-save"]'); pg.wait_for_timeout(400)
    still_open2 = pg.evaluate("() => !!document.querySelector('.screen-kind-badge')")
    check(still_open2, "a plain save (Complete not armed) with no condition still gets rejected")
    invalid_shown = pg.evaluate("() => !!document.querySelector('.field-invalid')")
    check(invalid_shown, "and the field is flagged invalid, same as before the fix")
    jclick('[data-action="screen-cancel"]'); pg.wait_for_timeout(300)

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

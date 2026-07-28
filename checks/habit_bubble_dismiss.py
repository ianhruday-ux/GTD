"""§9 (review-surface-plan.md): the calendar quick-add's "Make this a habit
instead" bubble gains a dismiss X.

Covers: the bubble appears for daily/weekly recurrence, the X clears it
without triggering calMakeHabit, it stays gone while recurrence is unchanged,
it comes BACK once recurrence changes away and back to daily/weekly (the
"per-draft, resets on recur change" ruling), and X on the calendar screen
discards the dismissal like any other draft field.
"""
import os, functools, http.server, socketserver, socket, threading, contextlib, sys
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


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 860}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")

    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(400)
    check(pg.locator(".cal-habit-bubble").count() == 0, "no bubble at the default 'none' recurrence")

    pg.select_option('[data-calfield="recur"]', "daily"); pg.wait_for_timeout(250)
    check(pg.locator(".cal-habit-bubble").count() == 1, "bubble appears for daily recurrence")
    check(pg.locator(".cal-habit-bubble-clear").count() == 1, "and it carries a dismiss X")

    # ---------- dismiss ----------
    pg.click(".cal-habit-bubble-clear"); pg.wait_for_timeout(250)
    check(pg.locator(".cal-habit-bubble").count() == 0, "the X dismisses the bubble")
    check(pg.locator('[data-calfield="recur"]').count() == 1,
          "the X did NOT navigate away — still on the calendar quick-add")

    # ---------- it stays dismissed while recurrence is unchanged ----------
    pg.evaluate("""() => { const i = document.querySelector('.cal-name'); if (i) i.value = 'ZZ dismiss test'; }""")
    pg.wait_for_timeout(100)
    check(pg.locator(".cal-habit-bubble").count() == 0, "still gone after an unrelated field edit")

    # ---------- comes back once recurrence changes away and back ----------
    pg.select_option('[data-calfield="recur"]', "none"); pg.wait_for_timeout(200)
    pg.select_option('[data-calfield="recur"]', "weekly"); pg.wait_for_timeout(250)
    check(pg.locator(".cal-habit-bubble").count() == 1,
          "the bubble comes back once recurrence is picked again (per-draft ruling)")

    # ---------- the make-habit action itself still works, untouched ----------
    pg.click(".cal-habit-bubble"); pg.wait_for_timeout(400)
    on_habit_page = pg.evaluate("""() => !!document.querySelector('.badge-habit, [data-kind="habit"]')""") \
        or pg.evaluate("""() => (document.querySelector('.screen-kind-badge')||{}).textContent""")
    check(bool(on_habit_page), f"the bubble itself still opens the habit page ({on_habit_page})")

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

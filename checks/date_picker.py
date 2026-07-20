"""The date picker — and the half of bug #3 that routing the clock could not fix.

"The date picker still recognizes the real day. This is the wanted behaviour in
the real app, but it's unwanted during testing."

Routing every clock read through nowMs() fixed the half that was ours: what the
app COMPUTES. This is the half that was not. The ring around "today" in the
phone's own date picker is drawn by the phone, from the device clock, and no CSS
or JS could move it — so the QA time jump was invisible there no matter what.

The only fix is to stop borrowing that control. This one asks the APP what today
is (todayStr(), which honours the offset), so jumping the dev clock ten days
moves the highlight ten days. That is what this file pins, and it is the whole
reason the date picker exists.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, datetime
from playwright.sync_api import sync_playwright
from _pickers import pick_date

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

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    # ---------- nothing native survives ----------
    check(pg.locator('input[type="date"]').count() == 0,
          "no native date input on the main screen")

    def open_create():
        pg.click('[data-action="fab"]'); pg.wait_for_timeout(350)
        pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(500)

    def open_date_picker():
        pg.locator('[data-field="deadline-date"]').first.click()
        pg.wait_for_timeout(400)

    def today_ring():
        return pg.evaluate("""() => {
          const el = document.querySelector('.dp-cell.is-today');
          return el ? el.getAttribute('data-date') : null;
        }""")

    open_create()
    check(pg.locator('input[type="date"]').count() == 0,
          "the create page has no native date input either")
    field = pg.locator('[data-field="deadline-date"]').first
    check(field.get_attribute("readonly") is not None,
          "the date field is readonly, so the phone's picker cannot open over ours")

    open_date_picker()
    check(pg.locator(".dp-grid").count() == 1, "tapping the field opens our date picker")
    check(today_ring() == "2026-06-15",
          f"today is ringed, and it is the app's today ({today_ring()})")

    # ---------- THE POINT: the ring follows the APP's clock ----------
    pg.click('[data-dp="cancel"]'); pg.wait_for_timeout(300)
    pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(400)
    d = pg.locator('.choice-dialog button:has-text("Discard changes")')
    if d.count():
        d.first.click(); pg.wait_for_timeout(300)
    for _ in range(10):
        pg.click("#qa-day-btn"); pg.wait_for_timeout(110)

    open_create()
    open_date_picker()
    moved = today_ring()
    check(moved == "2026-06-25",
          f"after a 10-day jump the ring moved with the app's clock ({moved})")
    # The device clock never moved, so a picker reading the device would still
    # be ringing the 15th. That is exactly the bug this replaces.
    check(moved != "2026-06-15", "and is NOT still on the device's today")

    # ---------- picking works and the value format is unchanged ----------
    pg.click('[data-dp="cancel"]'); pg.wait_for_timeout(250)
    pick_date(pg, '[data-field="deadline-date"]', "2026-07-04")
    val = pg.eval_on_selector('[data-field="deadline-date"]', "e => e.value")
    check(val == "2026-07-04", f"picking a day writes YYYY-MM-DD ({val})")

    # ---------- month navigation ----------
    open_date_picker()
    label0 = pg.locator(".dp-label").first.inner_text().strip()
    pg.click('[data-dp="next"]'); pg.wait_for_timeout(250)
    label1 = pg.locator(".dp-label").first.inner_text().strip()
    pg.click('[data-dp="prev"]'); pg.wait_for_timeout(250)
    label2 = pg.locator(".dp-label").first.inner_text().strip()
    check(label0 != label1 and label0 == label2,
          f"the month arrows go forward and back ({label0} -> {label1} -> {label2})")

    # ---------- the Today button uses the app's today too ----------
    pg.click('[data-dp="today"]'); pg.wait_for_timeout(300)
    sel = pg.evaluate("""() => {
      const el = document.querySelector('.dp-cell.is-sel');
      return el ? el.getAttribute('data-date') : null;
    }""")
    check(sel == "2026-06-25", f"the Today button jumps to the APP's today ({sel})")

    # ---------- cancel and escape commit nothing ----------
    before = pg.eval_on_selector('[data-field="deadline-date"]', "e => e.value")
    pg.click('[data-dp="cancel"]'); pg.wait_for_timeout(300)
    check(pg.eval_on_selector('[data-field="deadline-date"]', "e => e.value") == before,
          "Cancel leaves the field alone")

    open_date_picker()
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check(pg.locator(".dp-grid").count() == 0, "Escape closes the date picker")
    # ...and, as with the time picker, must not also close the page behind it.
    check(pg.locator('[data-field="deadline-date"]').count() == 1,
          "and leaves the page underneath open")
    check(pg.eval_on_selector('[data-field="deadline-date"]', "e => e.value") == before,
          "and commits nothing")

    # ---------- clear ----------
    open_date_picker()
    pg.click('[data-dp="clear"]'); pg.wait_for_timeout(300)
    check(pg.eval_on_selector('[data-field="deadline-date"]', "e => e.value") == "",
          "Clear empties the date")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

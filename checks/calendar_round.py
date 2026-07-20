"""Verification for the calendar round: no collapsible creation section, jargon
lines gone, completed one-shot appointment stays gone, pseudo-action bar is
near-EMPTY just after the 4 AM turnover, and the drawer takes the calendar's
finger-follow swipe."""
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
    ctx = b.new_context(viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    cdp = ctx.new_cdp_session(pg)

    BASE = datetime.datetime(2026, 8, 3, 10, 0, 0)   # a Monday, 10:00
    pg.clock.install(time=BASE)

    def close_tray():
        pg.wait_for_timeout(700)
        for _ in range(4):
            t = pg.locator('button[data-action="close-tray"]')
            if t.count() and t.first.is_visible():
                t.first.click(); pg.wait_for_timeout(300)
            else:
                break

    def swipe(x0, y0, x1, y1, steps=12):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                 "touchPoints": [{"x": x0, "y": y0}]})
        for i in range(1, steps + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
                {"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps}]})
            pg.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        pg.wait_for_timeout(500)

    pg.goto(url); close_tray()   # first boot seeds: Dentist = BASE+2 days, 14:30, one-shot

    # ---- 1. the creation section is fully visible, never collapsed ----
    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(400)
    check(pg.locator(".cal-create-controls").count() == 1, "creation controls visible, not collapsed")
    check(pg.locator('[data-action="cal-more"]').count() == 0, "no Options toggle")
    check(pg.locator('[data-calfield="time"]').first.is_visible(), "time field visible without a tap")

    # ---- 2. jargon removed ----
    footer = pg.locator(".cal-create").inner_text().lower()
    check("makes it an appointment" not in footer, "'time makes it an appointment' line gone")
    check("tickler" not in footer, "'tickler' jargon gone from the creation row")
    check("hide until the day it happens" in footer, "plain-language replacement present")
    pg.click('[data-action="cal-close"]'); pg.wait_for_timeout(400)

    # ---- 3. the bar just after the 4 AM turnover on the appointment's own day ----
    # BASE is Aug 3 10:00 → Dentist lands Aug 5 14:30. Aug 5 04:05 is +1d18h05.
    pg.clock.set_fixed_time(BASE + datetime.timedelta(days=1, hours=18, minutes=5))
    pg.reload(); close_tray()
    dentist = pg.locator('.card:has-text("Dentist")').first
    check(dentist.count() == 1, "Dentist pseudo-action present on its day")
    bar = dentist.locator(".deadline-bar").first
    fill = bar.get_attribute("style") or ""
    cls = bar.get_attribute("class") or ""
    pct = int("".join(c for c in fill.split("--fill:")[1].split("%")[0] if c.isdigit()) or 0)
    check(pct <= 5, f"bar is near-empty at 04:05 for a 14:30 appointment (got {pct}%)")
    check("red" not in cls and "passed" not in cls, f"bar is not red/passed at 04:05 (class: {cls.strip()})")

    # and it fills as the day runs
    pg.clock.set_fixed_time(BASE + datetime.timedelta(days=2, hours=4, minutes=0))   # Aug 5 14:00
    pg.reload(); close_tray()
    bar = pg.locator('.card:has-text("Dentist")').first.locator(".deadline-bar").first
    pct2 = int("".join(c for c in (bar.get_attribute("style") or "").split("--fill:")[1].split("%")[0] if c.isdigit()) or 0)
    check(90 <= pct2 <= 100, f"bar nearly full at 14:00 for a 14:30 appointment (got {pct2}%)")

    # ---- 4. completing the one-shot appointment: it must not come back ----
    pg.locator('.card:has-text("Dentist")').first.locator('[data-action="complete"]').first.click()
    pg.wait_for_timeout(500)
    check(pg.locator('.card:has-text("Dentist")').count() == 0, "completing removes Dentist")
    pg.reload(); close_tray()
    check(pg.locator('.card:has-text("Dentist")').count() == 0, "Dentist stays gone after reload")
    pg.clock.set_fixed_time(BASE + datetime.timedelta(days=4, hours=0))   # a later day
    pg.reload(); close_tray()
    check(pg.locator('.card:has-text("Dentist")').count() == 0, "Dentist stays gone on a later day")

    # ---- 5. the drawer takes the finger-follow swipe ----
    check(pg.evaluate("!!document.querySelector('.tray-drawer')") is False, "tray closed to start")
    swipe(6, 400, 300, 400)                                    # drag in from the left edge
    check(pg.evaluate("!!document.querySelector('.tray-drawer.open')"), "edge swipe opens the drawer")
    swipe(300, 400, 20, 400)                                   # drag it back out
    check(pg.evaluate("!document.querySelector('.tray-drawer.open')"), "left swipe closes the drawer")
    swipe(6, 400, 60, 400)                                     # short drag = below threshold
    check(pg.evaluate("!document.querySelector('.tray-drawer.open')"), "short drag does not open it")
    swipe(6, 400, 300, 400)
    check(pg.evaluate("!!document.querySelector('.tray-drawer.open')"), "still opens after a cancelled drag")

    check(not errors, f"no JS errors ({errors[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

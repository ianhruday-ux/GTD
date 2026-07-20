"""Bug #2 / QA #15 — the app's own time picker.

The complaint was that you cannot tell which of AM/PM is selected. Last round
that was answered with "those buttons belong to your phone's picker" — true, and
exactly the problem: the control was not ours to style. User ruling: build the
full picker.

What this pins:
  · no native <input type="time"> survives anywhere (that is what re-opened the
    phone's own picker over ours)
  · the selected AM/PM is FILLED, not merely outlined — the actual complaint,
    asserted on computed style rather than a class name
  · the 12-hour conversion, including the two cases that are always wrong first:
    12 AM is 00:xx and 12 PM is 12:xx
  · the value format is still 24-hour "HH:MM", because every existing reader
    (deadline.time, event time, the calendar row) parses that
  · Set commits through a real change event, so the app's delegated handlers
    run; Cancel and Escape commit nothing; Clear empties
"""
import os, math, functools, http.server, socket, socketserver, threading, contextlib, sys, datetime
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

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    # ---------- no native time input anywhere ----------
    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(500)
    native = pg.locator('input[type="time"]').count()
    check(native == 0, f"the calendar row has no native time input ({native})")
    field = pg.locator("input.screen-time").first
    check(field.count() > 0, "the time field is still there")
    check(field.get_attribute("readonly") is not None,
          "and it is readonly, so the phone's picker cannot open over ours")

    def open_picker():
        pg.locator("input.screen-time").first.click()
        pg.wait_for_timeout(400)

    def dial_click(slot_deg, radius=92):
        box = pg.locator(".tp-dial").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        a = math.radians(slot_deg - 90)
        pg.mouse.move(cx + math.cos(a) * radius, cy + math.sin(a) * radius)
        pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(300)

    def readout():
        return pg.evaluate("""() => ({
          hour: (document.querySelector('[data-tp="hour"]')||{}).textContent,
          minute: (document.querySelector('[data-tp="minute"]')||{}).textContent,
          hourActive: !!document.querySelector('[data-tp="hour"].active'),
          minuteActive: !!document.querySelector('[data-tp="minute"].active'),
        })""")

    def field_value():
        return pg.eval_on_selector("input.screen-time", "e => e.value")

    # ---------- the AM/PM fix, asserted on pixels not class names ----------
    open_picker()
    check(pg.locator(".tp-backdrop").count() == 1, "tapping the field opens our picker")
    styles = pg.evaluate("""() => {
      const am = document.querySelector('[data-tp="am"]');
      const pm = document.querySelector('[data-tp="pm"]');
      const g = e => getComputedStyle(e);
      return { amBg: g(am).backgroundColor, pmBg: g(pm).backgroundColor,
               amColor: g(am).color, pmColor: g(pm).color,
               amActive: am.classList.contains('active') };
    }""")
    check(styles["amBg"] != styles["pmBg"],
          f"the selected half of AM/PM is filled differently ({styles['amBg']} vs {styles['pmBg']})")
    transparent = ("rgba(0, 0, 0, 0)", "transparent")
    sel_bg = styles["amBg"] if styles["amActive"] else styles["pmBg"]
    check(sel_bg not in transparent,
          f"and the selected one has an actual fill, not just a border ({sel_bg})")

    # ---------- picking an hour advances to minutes ----------
    r = readout()
    check(r["hourActive"] and not r["minuteActive"], f"it opens on the hour ({r})")
    dial_click(4 * 30)          # 4 o'clock
    r = readout()
    check(r["hour"] == "4", f"the dial set the hour ({r})")
    check(r["minuteActive"] and not r["hourActive"],
          f"and picking an hour advances to the minute ({r})")

    dial_click(35 * 6)          # 35 minutes
    r = readout()
    check(r["minute"] == "35", f"the dial set the minute ({r})")

    # ---------- PM conversion ----------
    pg.click('[data-tp="pm"]'); pg.wait_for_timeout(200)
    pg.click('[data-tp="set"]'); pg.wait_for_timeout(400)
    check(field_value() == "16:35", f"4:35 PM stores as 16:35 ({field_value()})")

    # ---------- the two that are always wrong first ----------
    def set_time(face_slot, minute_slot, pm):
        open_picker()
        dial_click(face_slot * 30)
        dial_click(minute_slot * 6)
        pg.click('[data-tp="pm"]' if pm else '[data-tp="am"]'); pg.wait_for_timeout(200)
        pg.click('[data-tp="set"]'); pg.wait_for_timeout(400)
        return field_value()

    check(set_time(12, 0, False) == "00:00", f"12:00 AM is midnight, 00:00 ({field_value()})")
    check(set_time(12, 30, True) == "12:30", f"12:30 PM is midday, 12:30 ({field_value()})")
    check(set_time(11, 5, True) == "23:05", f"11:05 PM is 23:05 ({field_value()})")
    check(set_time(1, 5, False) == "01:05", f"1:05 AM is 01:05 ({field_value()})")

    # ---------- the picker reopens on the value already set ----------
    open_picker()
    r = readout()
    ampm = pg.evaluate("""() => ({ am: !!document.querySelector('[data-tp="am"].active'),
                                   pm: !!document.querySelector('[data-tp="pm"].active') })""")
    check(r["hour"] == "1" and r["minute"] == "05" and ampm["am"],
          f"reopening shows the current value, not a default ({r}, {ampm})")

    # ---------- cancel commits nothing ----------
    before = field_value()
    dial_click(7 * 30)
    pg.click('[data-tp="cancel"]'); pg.wait_for_timeout(300)
    check(field_value() == before, f"Cancel leaves the field alone ({field_value()} vs {before})")

    # ---------- escape commits nothing ----------
    open_picker()
    dial_click(8 * 30)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check(pg.locator(".tp-backdrop").count() == 0, "Escape closes the picker")
    check(field_value() == before, f"and commits nothing ({field_value()})")

    # ---------- clear empties ----------
    open_picker()
    pg.click('[data-tp="clear"]'); pg.wait_for_timeout(300)
    check(field_value() == "", f"Clear empties the field ({field_value()!r})")

    # ---------- and the value actually reaches the app ----------
    # The picker sets .value directly, so it must dispatch a real change event or
    # the app's delegated handlers never see the write. Add an event through the
    # calendar row and confirm the time stuck.
    pg.fill(".cal-name", "ZZ picker event"); pg.wait_for_timeout(200)
    open_picker()
    dial_click(2 * 30); dial_click(15 * 6)
    pg.click('[data-tp="pm"]'); pg.wait_for_timeout(150)
    pg.click('[data-tp="set"]'); pg.wait_for_timeout(300)
    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(700)
    stored = pg.evaluate("""() => {
      const evs = JSON.parse(localStorage.getItem('gtd_events') || '[]');
      const e = evs.find(x => x.title === 'ZZ picker event');
      return e ? e.time : null;
    }""")
    check(stored == "14:15", f"the picked time reaches the saved event ({stored})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

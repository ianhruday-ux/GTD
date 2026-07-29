"""Two small user-round fixes that both come down to "don't carry state you
shouldn't, and don't drop state you should."

1. THE UNCOMMITTED CAPTURE. closeTray() wipes #tray-root and trayAdd() only
   persists on an explicit Enter/+, so a half-typed thought was destroyed by
   closing the drawer, by Escape, and by swipe-to-dismiss — silently, in the one
   surface whose entire job is frictionless capture. It now survives all of
   those AND a reload, which is the case that really matters: a phone killing a
   suspended app with the drawer open.

2. THE CALENDAR CREATION ROW. It cleared name/description/time on Add but kept
   the repeat, interval and hide-until-its-day toggles. The author's ruling is
   that every field clears — an inherited "weekly" is a mistake you don't notice
   until it is made. The selected DAY and the Event/Deadline toggle deliberately
   survive; neither is a field.

⚠ The reload assertion in (1) is the load-bearing one. An in-memory draft would
pass every other check here and still lose the text in the only situation the
feature exists for.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys
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
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1200)

    def open_tray():
        if pg.locator(".tray-drawer").count() == 0:
            pg.click('[data-action="open-tray"], #tray-handle')
            pg.wait_for_timeout(500)

    # ================= 1. the uncommitted capture =================
    open_tray()
    check(pg.locator("#tray-input").count() == 1, "the intray drawer is open")

    # the i18n miss fixed in the same line: the placeholder is a translated
    # string now, not a hard-coded English one
    ph = pg.get_attribute("#tray-input", "placeholder")
    check(ph and ph != "tray.capturePlaceholder" and len(ph) > 0,
          f"the capture placeholder resolves through i18n ({ph!r})")

    pg.fill("#tray-input", "ZZ half a thought")
    pg.wait_for_timeout(200)
    check(pg.evaluate("() => localStorage.getItem('gtd_tray_draft')") == "ZZ half a thought",
          "typing persists the draft as you go")

    # closing the drawer must not eat it
    # ⚠ scoped to the head: [data-action="close-tray"] also matches the backdrop
    # and the edge handle, and the backdrop sits BEHIND the drawer, so an
    # unscoped click resolves to it and then never lands.
    pg.click('.tray-head [data-action="close-tray"]'); pg.wait_for_timeout(600)
    open_tray()
    check(pg.input_value("#tray-input") == "ZZ half a thought",
          f"closing and reopening keeps it ({pg.input_value('#tray-input')!r})")

    # Escape must not eat it either
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    open_tray()
    check(pg.input_value("#tray-input") == "ZZ half a thought", "Escape keeps it too")

    # ⚠ the one that matters: an app kill
    pg.reload(); pg.wait_for_timeout(1200)
    open_tray()
    check(pg.input_value("#tray-input") == "ZZ half a thought",
          f"and it survives a reload ({pg.input_value('#tray-input')!r})")
    check(pg.evaluate("""() => { const i = document.querySelector('#tray-input');
            return i && i.selectionStart === i.value.length; }"""),
          "the caret sits at the END, ready to resume the sentence")

    # committing clears the draft — it has done its job
    pg.fill("#tray-input", "ZZ a whole thought")
    pg.wait_for_timeout(150)
    pg.press("#tray-input", "Enter"); pg.wait_for_timeout(500)
    check(pg.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tray')) || [])
            .some(t => t.text === 'ZZ a whole thought')"""), "Enter still captures")
    check(not pg.evaluate("() => localStorage.getItem('gtd_tray_draft')"),
          "and committing clears the draft")
    check(pg.input_value("#tray-input") == "", "leaving an empty box for the next thought")

    # a reload now restores nothing, because there is nothing to restore
    pg.reload(); pg.wait_for_timeout(1200)
    open_tray()
    check(pg.input_value("#tray-input") == "", "a committed capture does not come back as a draft")
    # ⚠ scoped to the head: [data-action="close-tray"] also matches the backdrop
    # and the edge handle, and the backdrop sits BEHIND the drawer, so an
    # unscoped click resolves to it and then never lands.
    pg.click('.tray-head [data-action="close-tray"]'); pg.wait_for_timeout(500)

    # ================= 2. the calendar creation row =================
    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(600)

    day = pg.evaluate("""() => { const c = document.querySelector('.cal-cell:not(.cal-cell-blank)');
            return c && c.getAttribute('data-date'); }""")
    pg.fill(".cal-name", "ZZ recurring thing")
    pg.select_option('[data-calfield="recur"]', "weekly"); pg.wait_for_timeout(300)
    pg.check('[data-calfield="tickler"]'); pg.wait_for_timeout(200)
    # ⚠ `state` lives inside the build's IIFE and is unreachable from the page,
    # so everything here is read off the DOM, which is the honest surface anyway.
    KIND = """() => { const b = document.querySelector('.cal-seg-btn.active');
                      return b && b.getAttribute('data-kind'); }"""
    SEL = """() => { const c = document.querySelector('.cal-cell.cal-selected');
                     return c && c.getAttribute('data-date'); }"""
    before_kind = pg.evaluate(KIND)
    sel_before = pg.evaluate(SEL)

    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(600)
    made = pg.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_events')) || [])
            .find(e => e.title === 'ZZ recurring thing') || null""")
    check(made is not None, "the event was created")
    check(made and made["recurrence"] == "weekly" and made["tickler"] is True,
          f"with the toggles that were set ({made and made.get('recurrence')}, tickler={made and made.get('tickler')})")

    # every FIELD is clear
    check(pg.input_value(".cal-name") == "", "the name clears after Add")
    check(pg.input_value('[data-calfield="time"]') == "", "the time clears")
    check(pg.input_value('[data-calfield="recur"]') == "none",
          f"the repeat resets to none ({pg.input_value('[data-calfield=\"recur\"]')})")
    check(pg.locator('[data-calfield="tickler"]').is_checked() is False,
          "the hide-until-its-day box clears")
    # the interval box only renders while a repeat is set, so its ABSENCE is
    # the same fact stated in the DOM
    check(pg.locator(".cal-interval").count() == 0,
          "the interval box is gone, because the repeat went with it")

    # ...and the two things that are NOT fields survive
    check(pg.evaluate(SEL) == sel_before and sel_before is not None,
          f"the selected day is kept — it is not a field ({sel_before})")
    check(pg.evaluate(KIND) == before_kind and before_kind is not None,
          f"and so is the Event/Deadline toggle ({before_kind})")

    # a second entry made straight after inherits nothing
    pg.fill(".cal-name", "ZZ plain one")
    pg.click('[data-action="cal-add"]'); pg.wait_for_timeout(600)
    second = pg.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_events')) || [])
            .find(e => e.title === 'ZZ plain one') || null""")
    check(second is not None, "a second event follows straight after")
    check(second and second["recurrence"] == "none" and second["tickler"] is False,
          f"and inherits neither the repeat nor the flag "
          f"({second and second.get('recurrence')}, tickler={second and second.get('tickler')})")
    check(second and second["date"] == made["date"],
          "but does land on the same day, which was never cleared")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

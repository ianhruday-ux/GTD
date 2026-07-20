"""Bug #3 — one clock, app-wide.

The QA time-jump buttons move `state.qaTimeOffset`. That offset was read in
three places and bypassed in six, every one of them `createdAt: Date.now()`.
One of those six is load-bearing: `createdAt` is the deadline bar's origin
(§4.4b, read at deadlineBarState). Jump the clock ten days forward, create a
deadline, and the bar measured from the REAL now — ten days behind the app's
now — so a fresh deadline was born part-full.

Reported as "the date picker still recognizes the real day". It was two clocks.

⚠ This check MUST create the task through the UI. Writing one straight into
localStorage never runs createTask, so createdAt is never stamped, the bar falls
back to its zero-width-window branch, and the check passes on a broken build.
That is the trap this file exists to avoid; an earlier draft fell into it.

⚠ Two clocks stay real on purpose — genId (ids must never repeat, and the
offset can run BACKWARDS) and the drag log (elapsed-millisecond deltas). If a
future round "unifies" those, that is a regression, not a cleanup.
"""
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

    def jump_days(n):
        for _ in range(n):
            pg.click("#qa-day-btn")
            pg.wait_for_timeout(120)

    def app_today():
        """The app's own idea of today, straight off the dev readout."""
        return pg.locator("#qa-time-readout").inner_text().strip()

    def create_with_deadline(title, due):
        """Create a Next Action through the real UI, so createTask stamps it."""
        pg.click('[data-action="fab"]'); pg.wait_for_timeout(350)
        pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(500)
        pg.fill('[data-field="title"]', title)
        # Setting the date re-renders the screen (the time + clear controls
        # appear), so this must settle before the save button is clicked.
        pg.fill('[data-field="deadline-date"]', due); pg.wait_for_timeout(400)
        pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(600)

    def bar_percent(title):
        """The bar's fill, read from the --fill custom property it renders with."""
        return pg.evaluate("""(t) => {
          const card = [...document.querySelectorAll('.card')]
            .find(c => (c.querySelector('.card-title') || {}).textContent.trim() === t);
          if (!card) return null;
          const bar = card.querySelector('.deadline-bar');
          if (!bar) return null;
          const v = bar.style.getPropertyValue('--fill').trim();
          return v.endsWith('%') ? Math.round(parseFloat(v)) : null;
        }""", title)

    def stamp(title):
        return pg.evaluate("""(t) => {
          const nxt = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
          const row = nxt.find(x => x.title === t);
          return row ? (row.createdAt || null) : null;
        }""", title)

    # ---------- control: no jump, 14 days out, starts empty ----------
    create_with_deadline("ZZ control", "2026-06-29")
    ctl = bar_percent("ZZ control")
    check(ctl is not None, f"the control card rendered a deadline bar ({ctl})")
    check(ctl is not None and ctl <= 2, f"a fresh 14-day deadline starts empty ({ctl}%)")

    # ---------- the bug: jump 10 days, THEN create, still 14 days out ----------
    before = app_today()
    jump_days(10)
    after = app_today()
    check(before != after, f"the QA clock actually moved ({before} -> {after})")

    # 2026-07-09 is 14 days after the JUMPED today (2026-06-25), and 24 days
    # after the real one. Measured while the clock is still jumped: a bar whose
    # origin came from the real clock has 10 of those 24 days already elapsed.
    create_with_deadline("ZZ jumped", "2026-07-09")
    jmp = bar_percent("ZZ jumped")
    check(jmp is not None, f"the jumped card rendered a deadline bar ({jmp})")
    check(jmp is not None and jmp <= 2,
          f"a deadline created after a 10-day jump also starts empty ({jmp}%)")

    # ---------- the stamp itself follows the app clock ----------
    s_ctl, s_jmp = stamp("ZZ control"), stamp("ZZ jumped")
    check(s_ctl is not None and s_jmp is not None,
          f"both tasks carry a createdAt stamp ({s_ctl}, {s_jmp})")
    if s_ctl and s_jmp:
        gap_days = (s_jmp - s_ctl) / 86400000.0
        check(9.5 < gap_days < 10.5,
              f"the stamp moved with the clock, ~10 days apart ({gap_days:.2f} days)")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

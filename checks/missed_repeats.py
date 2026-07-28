"""A missed repeating occurrence reaches the review — most recent only.

User: "Passed due events should show up in the daily review... The justification
is the same as for uncompleted appointments. Sometimes these are just a matter of
someone forgetting to tick a box." Then, on being shown the trade-off: "only keep
the most recent miss in the review."

⚠ Before this, a ONE-SHOT that went unticked reached the review (it keeps its
pseudo-action) but a SERIES did not — rolling forward erased the occurrence, so a
standup you forgot to tick vanished at 4 AM with no trace. That asymmetry is what
this fixes.

⚠ The roll itself is NOT reverted, and that matters: "one live entity, no
accumulation" (§4.15b) is what stops a month of ignored dailies becoming thirty
review rows. The miss is recorded beside the series instead, in a single slot, so
a newer miss overwrites an older unhandled one.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, datetime
from playwright.sync_api import sync_playwright
from _pickers import enable_dev_tools

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


def ev(**o):
    # ⚠ WEEKLY at 23:00 by default, chosen deliberately: exactly one occurrence
    # is missed (the 12th), the next lands on the 19th, and today's has not
    # passed yet — so the missed card is the one the review shows. A daily at
    # 09:00 would ALSO be past-due today, and the live past-due row deliberately
    # suppresses the miss, so the card under test would never appear.
    e = {"id": "e1", "taskId": "t1", "title": "ZZ standup", "date": "2026-06-12",
         "time": "23:00", "notesClean": "", "recurrence": "weekly", "interval": 1,
         "paused": False, "contextId": None, "linkedProjectId": None,
         "seriesId": "s1", "tickler": False, "completedOccs": []}
    e.update(o)
    return e


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)
    enable_dev_tools(pg)   # the dev toolbar is hidden until switched on

    def seed(e):
        pg.evaluate("""(e) => {
          localStorage.setItem('gtd_events', JSON.stringify([e]));
          const nxt = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
          localStorage.setItem('gtd_tasks_next', JSON.stringify(nxt.filter(t => t.id !== 't1')));
          localStorage.setItem('gtd_tray', '[]');
        }""", e)
        pg.reload(); pg.wait_for_timeout(1000)

    def stored():
        return pg.evaluate("""() => {
          const e = JSON.parse(localStorage.getItem('gtd_events') || '[]')[0];
          return e ? { date: e.date, missed: e.missedOcc || null,
                       done: e.completedOccs || [] } : null;
        }""")

    def find_in_review(fragment):
        """Walk the queue with Not now until the card shows up, or it runs out."""
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
        pg.wait_for_timeout(350)
        pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
        pg.wait_for_timeout(600)
        for _ in range(16):
            t = pg.evaluate("""() => { const el = document.querySelector('.review-card-title');
                                       return el ? el.textContent.trim() : null; }""")
            if t is None:
                return False
            if fragment in t:
                return True
            nn = pg.locator('[data-action="review-defer"]')
            if not nn.count():
                return False
            nn.first.click(); pg.wait_for_timeout(250)
        return False

    def close_review():
        pg.evaluate("() => { const c=document.querySelector('[data-action=\"review-close\"]'); if(c) c.click(); }")
        pg.wait_for_timeout(300)

    # ---------- the gap this closes ----------
    seed(ev())
    st = stored()
    check(st["missed"] == "2026-06-12", f"the rolled-past occurrence is recorded ({st})")
    check(st["date"] == "2026-06-19",
          f"and the series still rolled forward — the roll is not reverted ({st})")
    check(find_in_review("ZZ standup"), "a missed repeat now reaches the review")

    note = pg.evaluate("""() => {
      const n = document.querySelector('.review-card-note');
      return n ? n.textContent.trim() : null;
    }""")
    check(note and "12 June" in note, f"the card says which day went by ({note})")

    # ---------- 'Mark done' records it on the day it happened ----------
    pg.locator('[data-action="review-missed-done"]').first.click(); pg.wait_for_timeout(600)
    st = stored()
    check(st["missed"] is None, f"'Mark done' clears the miss ({st})")
    check("2026-06-12" in st["done"],
          f"and records the completion on the day it actually happened, not today ({st})")
    close_review()
    check(not find_in_review("ZZ standup"), "so it stops being asked about")
    close_review()

    # ---------- 'Skipped' clears without claiming credit ----------
    seed(ev())
    check(find_in_review("ZZ standup"), "a fresh miss is back")
    pg.locator('[data-action="review-missed-clear"]').first.click(); pg.wait_for_timeout(600)
    st = stored()
    check(st["missed"] is None, f"'Skipped' clears the miss ({st})")
    check(st["done"] == [],
          f"and does NOT record it as done — no credit for something you skipped ({st})")
    close_review()

    # ---------- only the MOST RECENT is kept ----------
    # Seeded four days back: the sweep rolls past the 11th, 12th, 13th and 14th
    # in one pass and must keep only the last of them.
    seed(ev(recurrence="daily", date="2026-06-11", time="23:00"))
    st = stored()
    check(st["missed"] == "2026-06-14",
          f"rolling past several misses in one sweep keeps only the latest ({st})")
    check(st["date"] == "2026-06-15", f"and still lands on today ({st})")

    # A newer miss overwrites an older unhandled one.
    # ⚠ The drawer is a full-height overlay and sits over the dev panel, so the
    # QA button cannot be clicked while it is open (a real click is intercepted).
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    pg.click("#qa-day-btn"); pg.wait_for_timeout(600)
    st = stored()
    check(st["missed"] == "2026-06-15",
          f"a new miss replaces the old unhandled one ({st})")

    # ---------- one row per series, even when today is ALSO past due ----------
    # ⚠ The case that made this necessary: a daily at 09:00, seeded days back.
    # Today's occurrence has passed unticked (a live past-due row) AND an earlier
    # one was rolled past (a recorded miss). Both are real, but queueing both puts
    # one series in the review twice, which is the pile-up the single slot exists
    # to prevent. The live row wins.
    seed(ev(recurrence="daily", date="2026-06-12", time="09:00"))
    st = stored()
    check(st["missed"] and st["date"] == "2026-06-15",
          f"the fixture really does have both a miss and a past-due today ({st})")
    seen = 0
    pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
    pg.wait_for_timeout(600)
    for _ in range(16):
        t = pg.evaluate("""() => { const el = document.querySelector('.review-card-title');
                                   return el ? el.textContent.trim() : null; }""")
        if t is None:
            break
        if "ZZ standup" in t:
            seen += 1
        nn = pg.locator('[data-action="review-defer"]')
        if not nn.count():
            break
        nn.first.click(); pg.wait_for_timeout(220)
    check(seen == 1, f"the series contributes exactly ONE review row ({seen})")
    close_review()

    # ---------- ticking the LIVE past-due row retires the miss it supersedes ----
    # ⚠ User QA: "I completed the pay rent event after it was passed due in the
    # lane, but it still showed up in the daily review." Both halves were behaving
    # as written and the pair was still wrong. This fixture has both a recorded
    # miss (the 12th–14th) and a live past-due row (today, 09:00); the case above
    # asserts only ONE row reaches the review, and it is the live one. So ticking
    # that row was answering the only question the user had been ASKED — and the
    # older miss, which they had never been shown, silently took its place. From
    # the outside, completion did nothing.
    seed(ev(recurrence="daily", date="2026-06-12", time="09:00"))
    st = stored()
    check(st["missed"] is not None and st["date"] == "2026-06-15",
          f"fixture: a recorded miss AND a past-due row today ({st})")
    ticked = pg.evaluate("""() => {
      const row = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('ZZ standup'));
      if (!row) return 'no row';
      const cb = row.querySelector('.checkbox, [data-action="complete"], input[type=checkbox]');
      if (!cb) return 'no checkbox';
      cb.click(); return 'ok';
    }""")
    pg.wait_for_timeout(700)
    check(ticked == "ok", f"the past-due row is tickable in the lane ({ticked})")
    st = stored()
    check("2026-06-15" in st["done"], f"ticking records today's occurrence ({st})")
    check(st["missed"] is None,
          f"and retires the older miss it supersedes — the review only ever "
          f"promises the MOST RECENT one ({st})")
    check(not find_in_review("ZZ standup"),
          "so completing it in the lane really does clear it from the review")
    close_review()

    # ---------- a completed occurrence is never reported as missed ----------
    seed(ev(date="2026-06-12", completedOccs=["2026-06-12"]))
    st = stored()
    check(st["missed"] is None,
          f"an occurrence you DID tick is not recorded as a miss ({st})")

    # ---------- a paused series stops rolling, so it stops accruing misses ----------
    seed(ev(paused=True))
    st = stored()
    check(st["missed"] is None and st["date"] == "2026-06-12",
          f"a paused series neither rolls nor accrues a miss ({st})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

"""The calendar's ⓘ, and the Calendar line the review's capture panel was missing.

Two gaps found by reading the review copy against the buttons it sits above:

1. THE CALENDAR HAD NO ⓘ AT ALL. The six lane tabs and the intray have always
   had one; the review — also a screen, not a lane — shows a screen can carry
   one. The calendar was simply skipped.

2. THE CAPTURE PANEL EXPLAINED SIX OF ITS SEVEN BUTTONS. A Calendar destination
   was added to the capture card in chunk 7 and the info panel beneath it was
   never updated, so it described Next/Waiting/Project/Future/Habit/Note and
   silently omitted Calendar.

⚠ THE LAST CHECK IS THE ONE THAT MATTERS. Rather than asserting "Calendar is
mentioned" — which only pins today's gap — it counts the destination buttons on
the card and the explained labels in the panel and demands they match. That is
the invariant that was actually broken, and it will catch the NEXT destination
someone adds without touching the copy.

The split follows the established `.more` convention (info.lane.next /
info.lane.next.more): the review shows only the first sentence, the calendar's
own ⓘ shows everything.
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
    pg.goto(url); pg.wait_for_timeout(1300)
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML=''; }")

    # ================= 1. the calendar's own ⓘ =================
    pg.click('[data-action="open-calendar"]'); pg.wait_for_timeout(600)
    check(pg.locator('[data-action="cal-info"]').count() == 1, "the calendar has an ⓘ button")
    check(pg.locator(".cal-info-panel").is_hidden(), "its panel starts closed")

    pg.click('[data-action="cal-info"]'); pg.wait_for_timeout(300)
    check(pg.locator(".cal-info-panel").is_visible(), "tapping ⓘ opens it")
    full = pg.inner_text(".cal-info-panel")
    check("schedule appointments and deadlines" in full, "it opens with the first sentence")
    check("month view" in full and "day and list views" in full,
          "and carries the .more paragraph the review withholds")

    # it must survive a re-render, like the review's does
    pg.click('[data-action="cal-tab"][data-tab="list"]'); pg.wait_for_timeout(400)
    check(pg.locator(".cal-info-panel").is_visible(), "it stays open across a month/day/list swap")
    pg.click('[data-action="cal-info"]'); pg.wait_for_timeout(300)
    check(pg.locator(".cal-info-panel").is_hidden(), "and tapping ⓘ again closes it")
    pg.click('[data-action="cal-close"]'); pg.wait_for_timeout(500)

    # ================= 2. the review's capture panel =================
    pg.evaluate("""() => localStorage.setItem('gtd_tray',
        JSON.stringify([{ id: 'zz1', text: 'ZZ a stray thought', createdAt: Date.now() }]))""")
    pg.reload(); pg.wait_for_timeout(1300)
    pg.evaluate("""() => document.querySelector('[data-action="open-review"]').click()""")
    pg.wait_for_timeout(700)
    check(pg.locator(".review-card").count() >= 1 or pg.locator("[data-action='review-sort']").count() >= 1,
          "the review is showing the capture card")

    pg.evaluate("""() => document.querySelector('[data-action="review-info"]').click()""")
    pg.wait_for_timeout(400)
    panel = pg.inner_text(".review-info-panel")
    check("Calendar:" in panel, "the capture panel now explains Calendar")
    check("schedule appointments and deadlines" in panel, "using the first sentence")
    # ⚠ the .more paragraph is WITHHELD here — that is the whole point of the split
    check("month view" not in panel and "declutter" not in panel,
          "and withholds the rest, per the .more convention")

    # ---- the invariant: every destination button is explained ----
    counts = pg.evaluate("""() => {
      const panel = document.querySelector('.review-info-panel');
      // destination buttons on the card: the lane sorts plus Calendar
      const btns = [...document.querySelectorAll('[data-action="review-sort"]')]
        .map(b => b.getAttribute('data-target'));
      // explained lines in the panel: every bold label except the 2 min one
      const labels = [...panel.querySelectorAll('b')].map(b => b.textContent.trim());
      return { targets: btns, labels: labels };
    }""")
    # "2 min:" and the heading are not destinations
    explained = [l for l in counts["labels"] if not l.startswith("2 min") and l.endswith(":")]
    check(len(counts["targets"]) > 0, f"the card offers destinations ({counts['targets']})")
    check(len(explained) == len(counts["targets"]),
          f"every destination button has a line in the panel — "
          f"{len(counts['targets'])} buttons {counts['targets']} vs "
          f"{len(explained)} explained {explained}")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

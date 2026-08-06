"""The celebration banner and the runner must agree, and both must follow the DRAFT.

A habit page shows a run's ending twice: as a runner scene (habitRunnerState)
and as a coloured banner underneath it. Both read `draft.pendingResult`, which
`consumeHabitPendingResult` copies into the draft when the page opens.

The runner gated its celebration on `pendingResult && !doneToday`. The banner
gated on `pendingResult` alone. Arming Complete flips `draft.done` and never
clears `draft.pendingResult`, so the runner started the next lap while the
banner kept announcing the run that had just ended -- on the same screen, from
the same draft. habitRunnerState's own comment asserted they "can never
disagree", which is what makes this an oversight rather than a decision.

Complete is DRAFT-ONLY on a habit page (CLAUDE.md), so this asserts BOTH
directions -- arming hides the banner, disarming brings it back -- and that
neither leaks past a discard. Asserting only that arming hides it would pass
against a banner that was simply deleted.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, json, datetime

from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

# habitDone stores a DATE STRING per habit, not a boolean, and the app-day
# starts at 4am (habit_runner_states.py carries the same note).
APP_TODAY = (datetime.datetime.now() - datetime.timedelta(hours=4)).strftime("%Y-%m-%d")

ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


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


def run_record(**kw):
    base = dict(schedule=ALL_DAYS, paused=False, history=[], currentRunStart=0,
                personalBest=0, bestSequence=[], lifetimeTotal=0,
                lastProcessedDate=None, pendingResult=None, badge=False)
    base.update(kw)
    return base


# Each ended-run result type, with the banner text it must produce.
CASES = [
    ("record", {"type": "record", "length": 9, "prevBest": 4}, "New personal best"),
    ("tie",    {"type": "tie", "length": 4, "prevBest": 4},    "Tie"),
    ("short",  {"type": "short", "length": 2, "prevBest": 9},  "Start lap"),
]

fails, notes = [], []


def check(cond, msg):
    (notes if cond else fails).append(("PASS " if cond else "FAIL ") + msg)


def banner_text(pg):
    return (pg.evaluate("() => (document.querySelector('.habit-celebration')||{}).textContent") or "").strip()


def bubble_text(pg):
    return (pg.evaluate("() => (document.querySelector('.runner-bubble')||{}).textContent") or "").strip()


def celebrating(pg):
    """Is the RUNNER in one of the three run-ended scenes?"""
    b = bubble_text(pg)
    return (b.startswith("A new personal best")
            or b.startswith("A tie is good")
            or b.startswith("I've made it past here before"))


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 430, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)

    pg.goto(url); pg.wait_for_timeout(1000)
    habit_id = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_habit'))
        .filter(t => !t.isGroup)[0].id""")

    for label, pending, want_text in CASES:
        pg.evaluate("""([id, rec]) => {
          localStorage.setItem('gtd_habit_runs', JSON.stringify({[id]: rec}));
          localStorage.setItem('gtd_habit_done', JSON.stringify({}));
        }""", [habit_id, run_record(pendingResult=pending, badge=True)])
        pg.reload(); pg.wait_for_timeout(800)
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        pg.click('.tab[data-kind="habit"]'); pg.wait_for_timeout(400)
        pg.locator(f'.card-title[data-id="{habit_id}"]').first.click()
        pg.wait_for_timeout(600)

        # ---------- opened: both readouts show the ended run ----------
        opened_banner, opened_running = banner_text(pg), celebrating(pg)
        check(want_text in opened_banner,
              f"[{label}] on open the banner announces the ended run ({opened_banner[:44]!r})")
        check(opened_running,
              f"[{label}] and the runner is in a run-ended scene ({bubble_text(pg)[:40]!r})")

        # The pill exists at all -- guard, so a missing selector reports here
        # rather than aborting the file on a 30s locator timeout.
        pill = pg.locator('[data-action="screen-complete"]')
        if pill.count() == 0:
            check(False, f"[{label}] habit page has no screen-complete pill -- cannot test the draft")
            continue

        # ---------- arm Complete: the next lap has started ----------
        pill.first.click(); pg.wait_for_timeout(500)
        armed_banner, armed_running = banner_text(pg), celebrating(pg)
        check(armed_banner == "",
              f"[{label}] arming Complete clears the banner ({armed_banner[:44]!r})")
        check(not armed_running,
              f"[{label}] and the runner has left the celebration ({bubble_text(pg)[:40]!r})")
        check((armed_banner != "") == armed_running,
              f"[{label}] banner and runner AGREE while armed "
              f"(banner={'shown' if armed_banner else 'hidden'}, runner={'celebrating' if armed_running else 'running'})")

        # ---------- disarm: it comes back ----------
        # Asserting only the arming direction would also pass against a banner
        # that had simply been deleted.
        pill.first.click(); pg.wait_for_timeout(500)
        back_banner, back_running = banner_text(pg), celebrating(pg)
        check(want_text in back_banner,
              f"[{label}] disarming brings the banner back ({back_banner[:44]!r})")
        check(back_running,
              f"[{label}] and the runner returns to the celebration ({bubble_text(pg)[:40]!r})")
        check((back_banner != "") == back_running, f"[{label}] banner and runner AGREE while disarmed")

        # ---------- discard: nothing committed ----------
        pill.first.click(); pg.wait_for_timeout(400)          # re-arm, then throw it away
        # ⚠ MUST be data-action="screen-cancel" (✕). There is no "screen-close"
        # action anywhere in the app, and `.screen-chrome-btn` matches the ←
        # SAVE button first in DOM order (app.js:5294 before 5298) -- so the
        # obvious-looking selector commits the very draft this is asserting was
        # discarded, and the check fails against correct code.
        cancel = pg.locator('[data-action="screen-cancel"]')
        if cancel.count() == 0:
            check(False, f"[{label}] no screen-cancel (✕) button -- cannot test discard")
            continue
        cancel.first.click()
        pg.wait_for_timeout(500)
        done_after = pg.evaluate("() => localStorage.getItem('gtd_habit_done')")
        check(not (done_after and APP_TODAY in done_after),
              f"[{label}] discarding an armed completion commits nothing ({done_after})")

check(errs == [], f"no JS errors ({errs[:2]})")

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)

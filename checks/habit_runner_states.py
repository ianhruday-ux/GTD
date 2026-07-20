"""All 12 habit-runner states (post-sprint §P6).

The runner is a VIEW of the run engine, so what is actually under test is
habitRunnerState(): given a habitRuns record, does the right one of runner.js's
12 scenes appear? Each state's bubble copy is unique, so the copy is used as the
state's fingerprint.

Seeds gtd_habit_runs / gtd_habit_done directly, then opens the habit page in the
real built app and reads what rendered.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, json, datetime

# ⚠ habitDone stores a DATE STRING per habit, not a boolean — habitDoneToday()
# compares it against the app-day, which starts at 4am. Seeding `true` looks
# right and silently reads as "not done".
APP_TODAY = (datetime.datetime.now() - datetime.timedelta(hours=4)).strftime("%Y-%m-%d")

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


# state id -> the opening words of its bubble copy (unique per state)
FINGERPRINT = {
    "run_solo": "One foot in front",
    "stumble_solo": "Everyone falls",
    "pb_end_celebration": "A new personal best",
    "run_with_ghost": "I know this path well",
    "stumble_ghost_clean": "A mistake is just something",
    "stumble_ghost_stumble": "Even my best run had mistakes",
    "clean_ghost_stumble": "Even my best run had stumbles",
    "run_end_no_pb": "I've made it past here before",
    "pb_overtake": "I beat my personal best",
    "fresh_start_stretch": "I'm ready for my next lap",
    "fresh_start_stretch_first": "I'm ready for this lap",
    "rest_reading": "It's important to take a break",
    "tie_celebration": "A tie is good",
}

ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


def run_record(**kw):
    base = dict(schedule=ALL_DAYS, paused=False, history=[], currentRunStart=0,
                personalBest=0, bestSequence=[], lifetimeTotal=0,
                lastProcessedDate=None, pendingResult=None, badge=False)
    base.update(kw)
    return base


D1, D2, D3 = "2020-01-01", "2020-01-02", "2020-01-03"
DONE, STUM = {"date": D1, "status": "done"}, {"date": D2, "status": "stumble"}

# (expected state, habitRuns record, done-today?)
CASES = [
    ("fresh_start_stretch_first", run_record(), False),
    ("fresh_start_stretch", run_record(personalBest=4, bestSequence=["done"] * 4), False),
    ("run_solo", run_record(history=[DONE]), False),
    ("stumble_solo", run_record(history=[DONE, STUM]), False),
    ("rest_reading", run_record(paused=True, history=[DONE]), False),
    ("rest_reading", run_record(schedule=[], history=[DONE]), False),          # off-day
    ("pb_end_celebration", run_record(pendingResult={"type": "record", "length": 9, "prevBest": 4}), False),
    ("tie_celebration", run_record(pendingResult={"type": "tie", "length": 4, "prevBest": 4}), False),
    ("run_end_no_pb", run_record(pendingResult={"type": "short", "length": 2, "prevBest": 9}), False),
    ("pb_overtake", run_record(personalBest=2, bestSequence=["done", "done"],
                               history=[DONE, DONE, DONE]), False),
    ("run_with_ghost", run_record(personalBest=5, bestSequence=["done"] * 5, history=[DONE]), False),
    ("stumble_ghost_clean", run_record(personalBest=5, bestSequence=["done"] * 5,
                                       history=[DONE, STUM]), False),
    ("stumble_ghost_stumble", run_record(personalBest=5, bestSequence=["done", "stumble", "done", "done", "done"],
                                         history=[DONE, STUM]), False),
    ("clean_ghost_stumble", run_record(personalBest=5, bestSequence=["done", "stumble", "done", "done", "done"],
                                       history=[DONE]), False),
    # past the end of the ghost's sequence there is nobody to race
    ("run_solo", run_record(personalBest=2, bestSequence=["done", "done"],
                            history=[DONE, DONE, DONE, DONE]), False),

    # ---- completion is ALWAYS acknowledged (user ruling) ----
    # a rest day normally rests, but ticking it puts the runner back on its feet
    ("rest_reading", run_record(schedule=[], history=[DONE]), False),
    ("run_solo", run_record(schedule=[], history=[DONE]), True),
    # ...and it overrides a pending celebration: the next lap has started
    ("pb_end_celebration", run_record(pendingResult={"type": "record", "length": 9, "prevBest": 4}), False),
    ("run_solo", run_record(pendingResult={"type": "record", "length": 9, "prevBest": 4}), True),
    ("run_solo", run_record(pendingResult={"type": "tie", "length": 4, "prevBest": 4}), True),
    ("run_solo", run_record(pendingResult={"type": "short", "length": 2, "prevBest": 9}), True),
    # but PAUSE still wins, because completing is impossible while paused
    ("rest_reading", run_record(paused=True, history=[DONE]), True),
    # a rest-day completion must NOT count toward the run: with a PB of 2 and
    # two done days, counting it would falsely fire the overtake scene
    ("run_with_ghost", run_record(personalBest=2, bestSequence=["done", "done"],
                                  schedule=[], history=[DONE]), True),
]

fails, notes = [], []


def check(cond, msg):
    (notes if cond else fails).append(("PASS " if cond else "FAIL ") + msg)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 430, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)

    pg.goto(url); pg.wait_for_timeout(1000)
    habit_id = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_habit'))
        .filter(t => !t.isGroup)[0].id""")

    for expected, record, done_today in CASES:
        pg.evaluate("""([id, rec, done, today]) => {
          localStorage.setItem('gtd_habit_runs', JSON.stringify({[id]: rec}));
          localStorage.setItem('gtd_habit_done', JSON.stringify(done ? {[id]: today} : {}));
        }""", [habit_id, record, done_today, APP_TODAY])
        pg.reload(); pg.wait_for_timeout(800)
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        pg.click('.tab[data-kind="habit"]'); pg.wait_for_timeout(400)
        # ⚠ A habit ticked off TODAY leaves the active list and moves into the
        # lane's "Completed" section, which is collapsed by default — so its
        # card is not in the DOM at all until that section is opened. Expand it
        # when the card isn't found, rather than assuming the habit vanished.
        if pg.locator(f'.card-title[data-id="{habit_id}"]').count() == 0:
            hdr = pg.locator('[data-action="toggle-group"][data-id="__completed_open__"]')
            if hdr.count():
                hdr.first.click(); pg.wait_for_timeout(350)
        pg.locator(f'.card-title[data-id="{habit_id}"]').first.click()
        pg.wait_for_timeout(600)
        bubble = (pg.evaluate("() => (document.querySelector('.runner-bubble')||{}).textContent") or "").strip()
        want = FINGERPRINT[expected]
        label = f"{expected:<26} pb={record['personalBest']} hist={len(record['history'])}"
        check(bubble.startswith(want), f"{label} -> {bubble[:46]!r}")
        pg.evaluate("() => { const c=document.querySelector('[data-action=\"screen-close\"],.screen-chrome-btn'); if(c) c.click(); }")
        pg.wait_for_timeout(250)

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

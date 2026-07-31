"""W4 -- the sync engine, with no network at all (wrapper-plan.md).

"All of the data-loss risk in the entire project lives here, and none of it
needs Dropbox to reproduce." Drives window.__oelaSync directly (the merge
engine is pure and transport-agnostic by design) rather than reimplementing
merge logic in the test -- these assertions are only meaningful if they are
exercising the real code.

Three groups:
  1. Pure mergeBundles() logic: additive/no-baseline, genuine conflicts vs
     routine one-sided updates, delete-vs-edit races (resurrection), and
     tombstone/roster garbage collection (wrapper-plan.md §4.5).
  2. A real two-device round trip -- two separate browser contexts, each its
     own localStorage, "syncing" only by the test script handing one
     device's exported bundle to the other's reconcile(), the way W5's
     transport eventually will.
  3. The §4.3 pull-before-sweep gate, wired into processHabitBoundaries --
     proven across a real reload, not just as an isolated function.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, json, datetime
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

SYNC_STORE_KEYS = [
    "gtd_tasks_next", "gtd_tasks_waiting", "gtd_tasks_current", "gtd_tasks_future", "gtd_tasks_habit",
    "gtd_events", "gtd_notes", "gtd_tags", "gtd_contexts",
    "gtd_completed_next", "gtd_completed_waiting", "gtd_completed_current", "gtd_completed_future",
    "gtd_tray",
]


def empty_bundle():
    return {"roster": {}, "tombstones": [], "stores": {k: [] for k in SYNC_STORE_KEYS}}


def rec(id, text, modifiedAt, deviceId="dev-x"):
    return {"id": id, "text": text, "modifiedAt": modifiedAt, "deviceId": deviceId}


def tomb(id, store, recordId, deletedAt, deviceId="dev-x"):
    return {"id": id, "store": store, "recordId": recordId, "deletedAt": deletedAt, "modifiedAt": deletedAt, "deviceId": deviceId}


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


def merge(pg, local, remote, device_id="dev-local", baseline=None):
    return pg.evaluate(
        "([l, r, d, b]) => window.__oelaSync.mergeBundles(l, r, d, b)",
        [local, remote, device_id, baseline],
    )


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- pure mergeBundles() logic
    # ============================================================
    ctx1 = b.new_context(viewport={"width": 420, "height": 900})
    pg1 = ctx1.new_page()
    errs1 = []
    pg1.on("pageerror", lambda e: errs1.append(str(e)))
    pg1.goto(url); pg1.wait_for_timeout(800)

    # --- additive merge, no baseline (the new-phone / rejoin case) ---
    local = empty_bundle(); local["stores"]["gtd_tray"] = [rec("a", "local only", 1000, "A")]
    remote = empty_bundle(); remote["stores"]["gtd_tray"] = [rec("b", "remote only", 1000, "B")]
    out = merge(pg1, local, remote, "A", None)  # baseline=None -> no prior sync
    ids = sorted(r["id"] for r in out["merged"]["stores"]["gtd_tray"])
    check(ids == ["a", "b"], f"no-baseline merge keeps both sides' records ({ids})")
    check(len(out["conflicts"]) == 0, "no-baseline merge reports no conflicts (nothing to compare against)")

    # --- the exact case this was chased down to fix: new phone's pre-sync write survives ---
    local = empty_bundle(); local["stores"]["gtd_tray"] = [rec("new-write", "written before first sync", 1000, "PHONE")]
    remote = empty_bundle()  # cloud doesn't have it -- could look like "deleted elsewhere" to a naive diff
    out = merge(pg1, local, remote, "PHONE", None)
    check(any(r["id"] == "new-write" for r in out["merged"]["stores"]["gtd_tray"]),
          "a brand-new device's pre-first-sync write is NOT inferred as a deletion")

    # --- routine one-sided update: only remote changed since baseline -> no conflict ---
    baseline = empty_bundle(); baseline["stores"]["gtd_notes"] = [rec("n1", "v1", 1000, "A")]
    local = empty_bundle(); local["stores"]["gtd_notes"] = [rec("n1", "v1", 1000, "A")]  # unchanged
    remote = empty_bundle(); remote["stores"]["gtd_notes"] = [rec("n1", "v2", 2000, "B")]  # they edited
    out = merge(pg1, local, remote, "A", baseline)
    check(out["merged"]["stores"]["gtd_notes"][0]["text"] == "v2", "a one-sided update applies cleanly")
    check(len(out["conflicts"]) == 0, "and is NOT reported as a conflict (only one side actually moved)")

    # --- genuine conflict: BOTH sides changed since baseline -> newest wins, and it's reported ---
    baseline = empty_bundle(); baseline["stores"]["gtd_notes"] = [rec("n1", "v1", 1000, "A")]
    local = empty_bundle(); local["stores"]["gtd_notes"] = [rec("n1", "local edit", 2000, "A")]
    remote = empty_bundle(); remote["stores"]["gtd_notes"] = [rec("n1", "remote edit", 3000, "B")]
    out = merge(pg1, local, remote, "A", baseline)
    check(out["merged"]["stores"]["gtd_notes"][0]["text"] == "remote edit", "genuine conflict: the newer write wins (3000 > 2000)")
    check(len(out["conflicts"]) == 1 and out["conflicts"][0]["id"] == "n1", f"and it IS reported ({out['conflicts']})")

    # --- tie-break on identical modifiedAt: deterministic, not a coin flip ---
    baseline = empty_bundle(); baseline["stores"]["gtd_notes"] = [rec("n1", "v1", 1000, "A")]
    local = empty_bundle(); local["stores"]["gtd_notes"] = [rec("n1", "from A", 5000, "A")]
    remote = empty_bundle(); remote["stores"]["gtd_notes"] = [rec("n1", "from Z", 5000, "Z")]
    out1 = merge(pg1, local, remote, "A", baseline)
    out2 = merge(pg1, local, remote, "A", baseline)
    check(out1["merged"]["stores"]["gtd_notes"][0]["text"] == out2["merged"]["stores"]["gtd_notes"][0]["text"] == "from Z",
          "a modifiedAt tie resolves deterministically (larger deviceId wins), not randomly")

    # --- clean deletion propagates with no conflict ---
    baseline = empty_bundle(); baseline["stores"]["gtd_tray"] = [rec("d1", "to be deleted", 1000, "A")]
    local = empty_bundle(); local["stores"]["gtd_tray"] = [rec("d1", "to be deleted", 1000, "A")]  # unaware of the delete yet
    remote = empty_bundle()  # they deleted it
    remote["tombstones"] = [tomb("t1", "gtd_tray", "d1", 2000, "B")]
    out = merge(pg1, local, remote, "A", baseline)
    check(len(out["merged"]["stores"]["gtd_tray"]) == 0, "a clean delete (no local edit since) removes the record")
    check(len(out["conflicts"]) == 0, "and is not reported -- nothing local disagreed with it")

    # --- resurrection: local edited AFTER the remote delete -> newer edit wins, reported ---
    baseline = empty_bundle(); baseline["stores"]["gtd_tray"] = [rec("d2", "original", 1000, "A")]
    local = empty_bundle(); local["stores"]["gtd_tray"] = [rec("d2", "edited after their delete", 3000, "A")]
    remote = empty_bundle()
    remote["tombstones"] = [tomb("t2", "gtd_tray", "d2", 2000, "B")]  # deleted at 2000, but local edit is 3000
    out = merge(pg1, local, remote, "A", baseline)
    check(any(r["id"] == "d2" for r in out["merged"]["stores"]["gtd_tray"]),
          "an edit newer than the delete resurrects the record instead of silently losing it")
    check(any(c.get("resurrection") for c in out["conflicts"]), "and the resurrection is reported, not silent (§1)")

    # --- symmetric case: remote edited after LOCAL's own delete -> also resurrects ---
    baseline = empty_bundle(); baseline["stores"]["gtd_tray"] = [rec("d3", "original", 1000, "A")]
    local = empty_bundle()
    local["tombstones"] = [tomb("t3", "gtd_tray", "d3", 2000, "A")]  # we deleted it at 2000
    remote = empty_bundle(); remote["stores"]["gtd_tray"] = [rec("d3", "they edited after our delete", 3000, "B")]
    out = merge(pg1, local, remote, "A", baseline)
    check(any(r["id"] == "d3" for r in out["merged"]["stores"]["gtd_tray"]),
          "symmetric case: their later edit also resurrects past our earlier delete")

    # ⚠ GC's dropout check compares against the REAL Date.now(), so fixture
    # timestamps below are offsets from actual now, not tiny epoch-relative
    # numbers -- 9000ms since epoch is 1970, i.e. "over a year stale" to the
    # dropout check regardless of intent, which silently defeated this test
    # the first time it was written.
    now_ms = pg1.evaluate("() => Date.now()")

    # --- tombstone GC: dropped once every active device has pulled since ---
    local = empty_bundle()
    local["tombstones"] = [tomb("old", "gtd_tray", "gone", now_ms - 9000, "A"), tomb("new", "gtd_tray", "gone2", now_ms - 1000, "A")]
    local["roster"] = {"A": {"lastPull": now_ms}}
    remote = empty_bundle(); remote["roster"] = {"B": {"lastPull": now_ms - 5000}}
    out = merge(pg1, local, remote, "A", None)
    kept_ids = [t["id"] for t in out["merged"]["tombstones"]]
    check("old" not in kept_ids, f"a tombstone older than every active device's last pull is GC'd ({kept_ids})")
    check("new" in kept_ids, f"one newer than the oldest last-pull survives ({kept_ids})")

    # --- a device that has NEVER pulled doesn't block GC by being "infinitely stale" ... ---
    # ...it simply doesn't count at all, per wrapper-plan.md §4.5 (hasn't joined the
    # GC-blocking set yet). Confirmed by the case above already including one device
    # with lastPull=None implicitly absent; test it explicitly too:
    local = empty_bundle()
    local["tombstones"] = [tomb("old2", "gtd_tray", "gone3", now_ms - 9000, "A")]
    local["roster"] = {"A": {"lastPull": now_ms}, "NEVER": {"lastPull": None}}
    out = merge(pg1, local, empty_bundle(), "A", None)
    kept_ids = [t["id"] for t in out["merged"]["tombstones"]]
    check("old2" not in kept_ids, "a never-pulled device does not block GC of an otherwise-safe tombstone")

    # --- if NOBODY has ever pulled, nothing is GC'd (nothing confirmed seen yet) ---
    local = empty_bundle()
    local["tombstones"] = [tomb("untouched", "gtd_tray", "gone4", 1000, "A")]
    local["roster"] = {"A": {"lastPull": None}}
    out = merge(pg1, local, empty_bundle(), "A", None)
    kept_ids = [t["id"] for t in out["merged"]["tombstones"]]
    check("untouched" in kept_ids, "with no confirmed pulls at all, nothing is discarded")

    # --- roster dropout: a device silent >1yr is dropped, which can then unblock GC ---
    a_year_ms = 365 * 24 * 60 * 60 * 1000
    now_ms = pg1.evaluate("() => Date.now()")
    local = empty_bundle()
    local["roster"] = {"STALE": {"lastPull": now_ms - a_year_ms - 86400000}, "A": {"lastPull": now_ms}}
    local["tombstones"] = [tomb("blocked", "gtd_tray", "gone5", now_ms - 1000, "A")]
    out = merge(pg1, local, empty_bundle(), "A", None)
    check("STALE" not in out["merged"]["roster"], "a device silent over a year is dropped from the roster")
    check("A" in out["merged"]["roster"], "an active device stays")
    kept_ids = [t["id"] for t in out["merged"]["tombstones"]]
    check("blocked" not in kept_ids, "once the stale device drops off, the tombstone it was blocking clears too")

    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")

    # ============================================================
    # Group 2 -- a real two-device round trip (two contexts, real localStorage)
    # ============================================================
    ctxA = b.new_context(viewport={"width": 390, "height": 780})
    ctxB = b.new_context(viewport={"width": 390, "height": 780})
    pgA, pgB = ctxA.new_page(), ctxB.new_page()
    errsA, errsB = [], []
    pgA.on("pageerror", lambda e: errsA.append(str(e)))
    pgB.on("pageerror", lambda e: errsB.append(str(e)))
    pgA.goto(url); pgA.wait_for_timeout(800)
    pgB.goto(url); pgB.wait_for_timeout(800)

    # Start both devices from a clean, controlled tray (sample/tutorial data
    # would just be noise for this test) and reload so it takes effect.
    for pg in (pgA, pgB):
        pg.evaluate("() => { localStorage.setItem('gtd_tray', '[]'); }")
        pg.reload(); pg.wait_for_timeout(800)

    devA = pgA.evaluate("() => window.__oelaSync.getDeviceId()")
    devB = pgB.evaluate("() => window.__oelaSync.getDeviceId()")
    check(devA != devB, f"the two simulated devices have distinct ids ({devA} vs {devB})")

    # A creates something locally through the REAL capture UI (not a
    # localStorage poke), so this leg proves the actual write path -- fill,
    # Enter, reveal -- lands a genuinely stamped record.
    pgA.wait_for_selector("#tray-input", timeout=5000)
    pgA.fill("#tray-input", "from device A")
    pgA.press("#tray-input", "Enter"); pgA.wait_for_timeout(400)

    bundleA = pgA.evaluate("() => window.__oelaSync.exportBundle()")
    resultB = pgB.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", bundleA)
    check(len(resultB["conflicts"]) == 0, "B's first-ever sync produces no conflicts")
    trayB = pgB.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray'))")
    check(any(r["text"] == "from device A" for r in trayB), "B's real localStorage now has A's record after reconcile")
    rec_id = next(r["id"] for r in trayB if r["text"] == "from device A")

    # Round trip back: B reconciles into A too, so both sides agree A's own baseline updates.
    bundleB = pgB.evaluate("() => window.__oelaSync.exportBundle()")
    resultA = pgA.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", bundleB)
    check(len(resultA["conflicts"]) == 0, "the return trip to A is also clean")

    # Now both have a baseline. Edit the SAME record on both sides with
    # explicit, controlled modifiedAt values -- set via importBundle rather
    # than a real edit UI (tray captures have no in-place edit affordance),
    # deliberately, so the winner is asserted on the merge rule itself and
    # not on incidental wall-clock timing between two Playwright contexts.
    def set_record(pg, record_id, text, modified_at, device_id):
        pg.evaluate("""([id, text, modifiedAt, deviceId]) => {
          const b = window.__oelaSync.exportBundle();
          const rows = b.stores.gtd_tray;
          const row = rows.find(r => r.id === id);
          row.text = text; row.modifiedAt = modifiedAt; row.deviceId = deviceId;
          window.__oelaSync.importBundle(b);
        }""", [record_id, text, modified_at, device_id])

    now_ms2 = pgA.evaluate("() => Date.now()")
    set_record(pgA, rec_id, "edited on A", now_ms2 + 1000, devA)
    set_record(pgB, rec_id, "edited on B", now_ms2 + 500, devB)  # earlier than A's -> A should win

    bundleA2 = pgA.evaluate("() => window.__oelaSync.exportBundle()")
    resultB2 = pgB.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", bundleA2)
    check(len(resultB2["conflicts"]) == 1, f"editing the same record on both sides IS reported as a conflict ({resultB2['conflicts']})")
    trayB2 = pgB.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray'))")
    winner = next(r for r in trayB2 if r["id"] == rec_id)
    check(winner["text"] == "edited on A", f"and B ends up with A's later (1000 > 500) edit ({winner['text']!r})")

    # A fresh record for the delete case, captured through the real UI so its
    # modifiedAt is a genuine wall-clock timestamp -- reusing the record just
    # edited above would carry the artificially-future modifiedAt given to it
    # for the deterministic tie-break test, which a REAL (real-time) delete
    # a moment later would then appear to predate, misreading as "an edit
    # newer than the delete" and resurrecting it. Not an engine bug: a test
    # fixture accidentally racing its own earlier fixture.
    pgA.fill("#tray-input", "to be deleted on A")
    pgA.press("#tray-input", "Enter"); pgA.wait_for_timeout(400)
    del_id = pgA.evaluate(
        "() => JSON.parse(localStorage.getItem('gtd_tray')).find(r => r.text === 'to be deleted on A').id"
    )
    bundleA2b = pgA.evaluate("() => window.__oelaSync.exportBundle()")
    pgB.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", bundleA2b)  # B needs it before A deletes it

    # Delete on A through the REAL delete UI (not a raw localStorage splice),
    # so it actually leaves the tombstone the merge needs to tell B's still-
    # present copy "this was deleted" rather than "never existed" (W3, S2).
    reveal = pgA.locator('[data-action="tray-reveal"]')
    if reveal.count(): reveal.first.click(); pgA.wait_for_timeout(300)
    pgA.evaluate("""(id) => {
      const btn = [...document.querySelectorAll('.tray-card')].find(c => {
        const del = c.querySelector('[data-action=\"tray-delete\"]');
        return del && del.getAttribute('data-id') === id;
      });
      const del = btn && btn.querySelector('[data-action=\"tray-delete\"]');
      if (del) del.click();
    }""", del_id)
    pgA.wait_for_timeout(300)

    bundleA3 = pgA.evaluate("() => window.__oelaSync.exportBundle()")
    check(any(t.get("recordId") == del_id for t in bundleA3["tombstones"]),
          "the real delete UI left a tombstone for the merge to use")
    pgB.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", bundleA3)
    trayB3 = pgB.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray'))")
    check(not any(r["id"] == del_id for r in trayB3), "a delete on A propagates to B's real storage on reconcile")

    check(not errsA and not errsB, f"no JS errors in group 2 (A:{errsA[:2]} B:{errsB[:2]})")

    # ============================================================
    # Group 3 -- the §4.3 pull-before-sweep gate, across a real reload
    # ============================================================
    ctx3 = b.new_context(viewport={"width": 390, "height": 780})
    pg3 = ctx3.new_page()
    errs3 = []
    pg3.on("pageerror", lambda e: errs3.append(str(e)))
    pg3.add_init_script("window.__oelaSyncForceEnabled = true;")
    pg3.goto(url); pg3.wait_for_timeout(800)

    check(pg3.evaluate("() => window.__oelaSync.isEnabled()") is True, "the test-only force-enable hook is live")
    check(pg3.evaluate("() => window.__oelaSync.canSweepAccumulated()") is False,
          "gate starts CLOSED: enabled, but nothing has pulled this session yet")

    # Seed a habit several scheduled days behind, so a real sweep would have
    # real accumulated history to write -- then reload with the gate closed.
    # ⚠ applyHabitDayOutcome (app.js) deliberately ignores a miss before the
    # run has a single completed day ("nothing to protect yet"), so a fresh
    # run with empty history would sweep 4 stale days and correctly write
    # NOTHING -- indistinguishable from the gate silently blocking it. One
    # prior "done" entry makes a swept miss actually observable.
    APP_TODAY = (datetime.datetime.now() - datetime.timedelta(hours=4))
    DONE_DATE = (APP_TODAY - datetime.timedelta(days=5)).strftime("%Y-%m-%d")
    STALE_DATE = (APP_TODAY - datetime.timedelta(days=4)).strftime("%Y-%m-%d")
    pg3.evaluate("""([doneDate, staleDate]) => {
      localStorage.setItem('gtd_tasks_habit', JSON.stringify([
        {id:'h1', title:'ZZ gate habit', isGroup:false, parent:null, notesClean:'',
         whenTexts:[], schedule:[0,1,2,3,4,5,6]}
      ]));
      localStorage.setItem('gtd_habit_runs', JSON.stringify({
        h1: {schedule:[0,1,2,3,4,5,6], paused:false,
             history:[{date: doneDate, status:'done'}], currentRunStart:0,
             personalBest:0, bestSequence:[], lifetimeTotal:1,
             lastProcessedDate: staleDate, pendingResult:null, badge:false}
      }));
      localStorage.setItem('gtd_habit_done', '{}');
    }""", [DONE_DATE, STALE_DATE])
    pg3.reload(); pg3.wait_for_timeout(800)

    check(pg3.evaluate("() => window.__oelaSync.isEnabled()") is True, "force-enable survives the reload (real init-script, not a monkeypatch)")
    runsAfterClosedBoot = pg3.evaluate("() => JSON.parse(localStorage.getItem('gtd_habit_runs')).h1")
    check(runsAfterClosedBoot["lastProcessedDate"] == STALE_DATE,
          f"gate CLOSED: boot's own sweep did NOT advance lastProcessedDate ({runsAfterClosedBoot['lastProcessedDate']})")
    check(len(runsAfterClosedBoot["history"]) == 1, f"and wrote no NEW accumulated history while closed (still just the seeded done day: {runsAfterClosedBoot['history']})")

    # Open the gate the only way it can open pre-W5: a successful reconcile.
    selfBundle = pg3.evaluate("() => window.__oelaSync.exportBundle()")
    pg3.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", selfBundle)
    check(pg3.evaluate("() => window.__oelaSync.canSweepAccumulated()") is True, "gate OPENS once a pull has succeeded this session")

    # Re-trigger the resume sweep (B1, app.js) the same way backgrounding and
    # returning to the app does -- no second reload, which would reset the
    # session (and pulledThisSession) entirely.
    pg3.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    pg3.wait_for_timeout(300)
    runsAfterOpenSweep = pg3.evaluate("() => JSON.parse(localStorage.getItem('gtd_habit_runs')).h1")
    check(runsAfterOpenSweep["lastProcessedDate"] != STALE_DATE,
          f"gate OPEN: the resume sweep now advances lastProcessedDate ({runsAfterOpenSweep['lastProcessedDate']})")
    check(len(runsAfterOpenSweep["history"]) > 0, f"and actually wrote accumulated history ({len(runsAfterOpenSweep['history'])} day(s))")

    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")

    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

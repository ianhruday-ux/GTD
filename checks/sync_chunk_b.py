"""CHUNK B -- habit progress syncs, and the merge is per field.

The two fixes, and the rulings they implement:

  1. PER-FIELD MERGE (sync-audit.md §4b). The whole record used to be the
     merge unit, so two edits to the same item collided even in unrelated
     fields. Now a three-way merge against the baseline: a field only one side
     moved is taken from that side, and only fields BOTH sides moved are
     conflicts. No schema change -- the baseline was already a merge base.

  2. HABIT PROGRESS (sync-audit.md §3). It did not sync at all, which made it
     the only gap that lost data from the most ordinary act in the app.
     Streaks are never merged: they are RECOMPUTED from merged history, so two
     devices cannot disagree about a personal best. And for a contested day:

         A "done" is something you DID. A "miss" is something nobody did -- an
         inference from absence. An inference must never overwrite an
         assertion. So DONE WINS, regardless of timestamps.

Written to the protocols in checks/README.md. Every assertion here is on
rendered state or on the app's own live data, and the whole file was run
against the pre-fix build (see the commit) -- including checking WHY each
green is green, which is the half that caught two vacuous checks in chunk A.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, json, sys, time
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

SYNC_STORES = ["gtd_tasks_next", "gtd_tasks_waiting", "gtd_tasks_current", "gtd_tasks_future",
               "gtd_tasks_habit", "gtd_events", "gtd_notes", "gtd_tags", "gtd_contexts",
               "gtd_completed_next", "gtd_completed_waiting", "gtd_completed_current",
               "gtd_completed_future", "gtd_tray", "gtd_archived_waiting", "gtd_archived_events",
               "gtd_habit_runs", "gtd_habit_done"]


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


def empty_bundle():
    return {"roster": {"other": {"lastPull": int(time.time() * 1000)}},
            "tombstones": [], "stores": {k: [] for k in SYNC_STORES}}


def boot(b, url):
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(700)
    pg.click('button.icon-btn[data-action="close-tray"]'); pg.wait_for_timeout(300)
    return ctx, pg, errs


# A check must be able to RUN against the old build, not just fail on it: on
# the pre-fix build exportBundle() THROWS on the legacy keyed shape (that is
# the upgrade bug this chunk fixes), and an uncaught throw ends the file
# instead of reporting anything. Catching it turns "the old build cannot even
# publish" into a legible failure, which is what protocol 2 actually wants.
def export_bundle(pg):
    return pg.evaluate("""() => {
        try { return window.__oelaSync.exportBundle(); }
        catch (e) { return { threw: String(e), stores: {}, tombstones: [], roster: {} }; }
    }""")


def run_for(pg, habit_id):
    """The app's live view of a habit run, read the way the app reads it."""
    return pg.evaluate("""(id) => {
        const raw = JSON.parse(localStorage.getItem('gtd_habit_runs') || '[]');
        return Array.isArray(raw) ? (raw.find(r => r && r.id === id) || null) : (raw[id] || null);
    }""", habit_id)


def run_record(habit_id, history, extra=None):
    rec = {"id": habit_id, "schedule": [0, 1, 2, 3, 4, 5, 6], "paused": False,
           "history": history, "currentRunStart": 0, "personalBest": 0, "bestSequence": [],
           "lifetimeTotal": len([h for h in history if h["status"] == "done"]),
           "lastProcessedDate": None, "pendingResult": None, "badge": False,
           "modifiedAt": int(time.time() * 1000), "deviceId": "other-device"}
    if extra:
        rec.update(extra)
    return rec


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- habit progress travels at all
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url)
    hid = pg1.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_habit')||'[]')
        .find(h => !h.isGroup) || {}).id""")
    check(bool(hid), f"fixture: a seeded habit exists to sync ({hid})")

    published = export_bundle(pg1)
    check("gtd_habit_runs" in published.get("stores", {}),
          "THE FIX: habit runs are part of what this device publishes at all -- pre-fix the store did not sync")
    check("gtd_habit_done" in published.get("stores", {}), "and so is 'did I tick it today'")

    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")

    # ============================================================
    # Group 2 -- THE RULING: a done beats a miss, whatever the clock says
    # ============================================================
    ctx2, pg2, errs2 = boot(b, url)
    hid2 = pg2.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_habit')||'[]')
        .find(h => !h.isGroup) || {}).id""")

    # This device believes the user missed both days.
    pg2.evaluate("""(args) => {
        const raw = JSON.parse(localStorage.getItem('gtd_habit_runs') || '[]');
        // Tolerates the PRE-FIX keyed shape on purpose: this file is also run
        // against the old build (protocol 2), and a fixture that throws there
        // proves less than one that reports a real failure.
        const arr = Array.isArray(raw)
          ? raw
          : Object.keys(raw).map(k => Object.assign({ id: k }, raw[k]));
        const i = arr.findIndex(r => r && r.id === args.id);
        const rec = i >= 0 ? arr[i] : { id: args.id };
        rec.schedule = [0,1,2,3,4,5,6]; rec.paused = false;
        rec.history = [{date:'2026-07-20', status:'done'}, {date:'2026-07-21', status:'stumble'}];
        rec.currentRunStart = 0; rec.personalBest = 0; rec.bestSequence = [];
        rec.lifetimeTotal = 1; rec.modifiedAt = Date.now() + 60000;  // LOCAL IS NEWER
        rec.deviceId = 'this-device';
        if (i >= 0) arr[i] = rec; else arr.push(rec);
        localStorage.setItem('gtd_habit_runs', JSON.stringify(arr));
    }""", {"id": hid2})
    pg2.reload(); pg2.wait_for_timeout(700)
    pg2.click('button.icon-btn[data-action="close-tray"]'); pg2.wait_for_timeout(300)

    # Establish a baseline, so this is a genuine two-sided merge.
    base = empty_bundle()
    base["stores"]["gtd_habit_runs"] = [run_record(hid2, [{"date": "2026-07-20", "status": "done"}])]
    pg2.evaluate("(r) => window.__oelaSync.reconcile(r)", base)
    pg2.wait_for_timeout(300)

    # The OTHER device says the user actually did it on the 21st -- and its
    # record is OLDER, so plain newest-wins would discard the completion.
    remote = empty_bundle()
    remote["stores"]["gtd_habit_runs"] = [run_record(hid2, [
        {"date": "2026-07-20", "status": "done"},
        {"date": "2026-07-21", "status": "done"},
    ], {"modifiedAt": int(time.time() * 1000) - 60000})]  # DELIBERATELY OLDER
    res = pg2.evaluate("(r) => window.__oelaSync.reconcile(r)", remote)
    pg2.wait_for_timeout(400)

    merged = run_for(pg2, hid2)
    statuses = {h["date"]: h["status"] for h in (merged or {}).get("history", [])}
    check(statuses.get("2026-07-21") == "done",
          f"THE RULING: the completion survived even though the device asserting it had the OLDER record ({statuses})")
    check(statuses.get("2026-07-20") == "done", f"and the day both agreed on is untouched ({statuses})")
    check((merged or {}).get("lifetimeTotal") == 2,
          f"the lifetime total was RECOMPUTED from the merged history, not merged ({(merged or {}).get('lifetimeTotal')})")
    check(any(c.get("habitDays") for c in res["conflicts"]),
          f"and the disagreement was REPORTED, not applied silently ({res['conflicts']})")

    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")

    # ============================================================
    # Group 3 -- two devices tick DIFFERENT days; both must survive
    # ============================================================
    ctx3, pg3, errs3 = boot(b, url)
    hid3 = pg3.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_habit')||'[]')
        .find(h => !h.isGroup) || {}).id""")

    base3 = empty_bundle()
    base3["stores"]["gtd_habit_runs"] = [run_record(hid3, [])]
    pg3.evaluate("(r) => window.__oelaSync.reconcile(r)", base3)
    pg3.wait_for_timeout(300)

    pg3.evaluate("""(args) => {
        const raw = JSON.parse(localStorage.getItem('gtd_habit_runs') || '[]');
        const arr = Array.isArray(raw)
          ? raw
          : Object.keys(raw).map(k => Object.assign({ id: k }, raw[k]));
        const rec = arr.find(r => r && r.id === args.id) || { id: args.id };
        if (arr.indexOf(rec) === -1) arr.push(rec);
        rec.history = [{date:'2026-07-22', status:'done'}];
        rec.lifetimeTotal = 1; rec.modifiedAt = Date.now();
        localStorage.setItem('gtd_habit_runs', JSON.stringify(arr));
    }""", {"id": hid3})

    remote3 = empty_bundle()
    remote3["stores"]["gtd_habit_runs"] = [run_record(hid3, [{"date": "2026-07-23", "status": "done"}])]
    pg3.evaluate("(r) => window.__oelaSync.reconcile(r)", remote3)
    pg3.wait_for_timeout(400)

    merged3 = run_for(pg3, hid3)
    days3 = sorted(h["date"] for h in (merged3 or {}).get("history", []) if h["status"] == "done")
    check(days3 == ["2026-07-22", "2026-07-23"],
          f"a day ticked on EACH device survives -- neither erased the other ({days3})")
    check((merged3 or {}).get("lifetimeTotal") == 2,
          f"and the total counts both ({(merged3 or {}).get('lifetimeTotal')})")

    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")

    # ============================================================
    # Group 4 -- PER-FIELD MERGE: two edits, different fields, both survive
    # ============================================================
    ctx4, pg4, errs4 = boot(b, url)
    hid4 = pg4.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_habit')||'[]')
        .find(h => !h.isGroup) || {}).id""")

    def habit_rec(pg, hid, **fields):
        return pg.evaluate("""(args) => {
            const arr = JSON.parse(localStorage.getItem('gtd_tasks_habit') || '[]');
            const rec = arr.find(h => h.id === args.id);
            Object.assign(rec, args.fields);
            rec.modifiedAt = Date.now();
            localStorage.setItem('gtd_tasks_habit', JSON.stringify(arr));
            return rec;
        }""", {"id": hid, "fields": fields})

    baseline_rec = pg4.evaluate("""(id) => JSON.parse(localStorage.getItem('gtd_tasks_habit')||'[]')
        .find(h => h.id === id)""", hid4)
    base4 = empty_bundle()
    base4["stores"]["gtd_tasks_habit"] = [baseline_rec]
    pg4.evaluate("(r) => window.__oelaSync.reconcile(r)", base4)
    pg4.wait_for_timeout(300)

    # LOCAL edits the description only.
    habit_rec(pg4, hid4, notesClean="EDITED ON THIS DEVICE")

    # REMOTE edits the temptation bundle only, and is NEWER, so whole-record
    # newest-wins would have discarded the local description entirely.
    remote_rec = dict(baseline_rec)
    remote_rec["bundleText"] = "EDITED ON THE OTHER DEVICE"
    remote_rec["modifiedAt"] = int(time.time() * 1000) + 120000
    remote_rec["deviceId"] = "other-device"
    remote4 = empty_bundle()
    remote4["stores"]["gtd_tasks_habit"] = [remote_rec]
    res4 = pg4.evaluate("(r) => window.__oelaSync.reconcile(r)", remote4)
    pg4.wait_for_timeout(400)

    after4 = pg4.evaluate("""(id) => JSON.parse(localStorage.getItem('gtd_tasks_habit')||'[]')
        .find(h => h.id === id)""", hid4)
    check(after4.get("notesClean") == "EDITED ON THIS DEVICE",
          f"THE FIX: this device's description survived a NEWER remote record ({after4.get('notesClean')!r})")
    check(after4.get("bundleText") == "EDITED ON THE OTHER DEVICE",
          f"and the other device's temptation bundle landed too ({after4.get('bundleText')!r})")
    check(not res4["conflicts"],
          f"and neither is a conflict -- they touched different fields, so there was nothing to disagree about ({res4['conflicts']})")

    # The same field on both sides is still a real conflict, still reported.
    habit_rec(pg4, hid4, notesClean="LOCAL SAYS THIS")
    remote_rec2 = dict(after4)
    remote_rec2["notesClean"] = "REMOTE SAYS THIS"
    remote_rec2["modifiedAt"] = int(time.time() * 1000) + 300000
    remote_rec2["deviceId"] = "other-device"
    remote5 = empty_bundle()
    remote5["stores"]["gtd_tasks_habit"] = [remote_rec2]
    res5 = pg4.evaluate("(r) => window.__oelaSync.reconcile(r)", remote5)
    pg4.wait_for_timeout(400)
    after5 = pg4.evaluate("""(id) => JSON.parse(localStorage.getItem('gtd_tasks_habit')||'[]')
        .find(h => h.id === id)""", hid4)
    check(after5.get("notesClean") == "REMOTE SAYS THIS",
          f"both sides editing the SAME field still resolves newest-wins ({after5.get('notesClean')!r})")
    check(any("notesClean" in (c.get("fields") or []) for c in res5["conflicts"]),
          f"and is reported, naming the field in dispute ({res5['conflicts']})")

    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")

    # ============================================================
    # Group 5 -- upgrading from the OLD keyed shape must not crash the sync
    # (this is what broke first, and it would have hit a real install)
    # ============================================================
    ctx5 = b.new_context(viewport={"width": 420, "height": 900})
    ctx5.add_init_script("""
        localStorage.setItem('gtd_habit_runs', JSON.stringify({
            'legacy-1': { schedule:[0,1,2,3,4,5,6], paused:false,
                          history:[{date:'2026-07-19', status:'done'}],
                          currentRunStart:0, personalBest:0, bestSequence:[], lifetimeTotal:1,
                          lastProcessedDate:null, pendingResult:null, badge:false }
        }));
        localStorage.setItem('gtd_archived_waiting', JSON.stringify({ 'proj-x': [] }));
    """)
    pg5 = ctx5.new_page()
    errs5 = []
    pg5.on("pageerror", lambda e: errs5.append(str(e)))
    pg5.goto(url); pg5.wait_for_timeout(900)

    stored5 = pg5.evaluate("() => JSON.parse(localStorage.getItem('gtd_habit_runs') || 'null')")
    check(isinstance(stored5, list),
          f"the legacy keyed store was converted to a record array at boot ({type(stored5).__name__})")
    # isinstance guard: on the PRE-FIX build this is still a keyed object, and
    # iterating it yields strings. A check run against the old build has to
    # degrade to a FAILURE, not an exception -- a crash reports nothing.
    kept = [r for r in (stored5 if isinstance(stored5, list) else [])
            if isinstance(r, dict) and r.get("id") == "legacy-1"]
    check(kept and kept[0]["history"][0]["date"] == "2026-07-19",
          f"and its history came through the conversion intact ({kept})")
    bundle5 = export_bundle(pg5)
    check(any(isinstance(r, dict) and r.get("id") == "legacy-1"
              for r in bundle5["stores"].get("gtd_habit_runs", [])),
          "and it is publishable -- pre-fix exportBundle threw on the keyed shape, breaking the FIRST sync after upgrading")
    check(not errs5, f"no JS errors upgrading from the old shape ({errs5[:3]})")

    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

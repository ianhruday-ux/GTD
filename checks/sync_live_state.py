"""THE REGRESSION SUITE FOR THE BUG EVERY OTHER SYNC CHECK MISSED.

Found 2026-07-30 on the first real two-device test (Android phone + Electron
desktop, real Dropbox account), NOT by any check in this directory -- and the
reason is worth stating plainly at the top of the file that fixes it:

    checks/sync_engine.py, checks/dropbox_transport.py and
    checks/dropbox_settings_ui.py all assert on localStorage.

localStorage was the one place that was CORRECT. app.js serves every lane from
an in-memory copy (state.tasks[...] et al) loaded once in boot(), and
Sync.reconcile() wrote the merge to storage without ever refreshing it. So:

  1. Pulled records were invisible until the app was restarted.
  2. Worse -- saveTasksLocal() writes the whole in-memory array, and
     storage.js's stampAndTombstone() diffs it against localStorage, which now
     held the MERGED array. Every record the merge had just pulled in was
     missing from stale memory, so it read as a DELETION and got a tombstone.
     The next sync propagated those tombstones and destroyed the other
     device's records everywhere.

A record created on the desktop ("Party") was destroyed exactly that way.

So every check here asserts on what the app actually HAS and SHOWS -- the
rendered DOM and the in-memory state -- not on the storage key underneath.
Group 2 reproduces the full destruction chain and would have failed loudly
against the pre-fix build.

Runs entirely in a plain browser against the real merge engine: no bridge, no
transport, no network. Sync.reconcile() is driven directly, which is exactly
how the real transports call it.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, json, sys, time
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

SYNC_STORES = ["gtd_tasks_next", "gtd_tasks_waiting", "gtd_tasks_current", "gtd_tasks_future",
               "gtd_tasks_habit", "gtd_events", "gtd_notes", "gtd_tags", "gtd_contexts",
               "gtd_completed_next", "gtd_completed_waiting", "gtd_completed_current",
               "gtd_completed_future", "gtd_tray"]


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
    return {"roster": {}, "tombstones": [], "stores": {k: [] for k in SYNC_STORES}}


def remote_with_next(records, roster=None):
    b = empty_bundle()
    b["stores"]["gtd_tasks_next"] = records
    b["roster"] = roster if roster is not None else {"other-device": {"lastPull": int(time.time() * 1000)}}
    return b


def rec(id_, title, ms=None, device="other-device"):
    return {"id": id_, "title": title, "isGroup": False, "parent": None, "notesClean": "",
            "linkedProjectId": None, "contextId": None, "whenText": None,
            "createdAt": ms or int(time.time() * 1000),
            "modifiedAt": ms or int(time.time() * 1000), "deviceId": device}


# What the app actually SHOWS. Deliberately not localStorage -- that is the
# entire point of this file. The rendered card text IS the in-memory state:
# renderLane() reads state.tasks[kind] and nothing else, so a title appearing
# here proves memory was refreshed, which is precisely what was broken.
def dom_card_titles(pg):
    return pg.evaluate("""() => Array.from(document.querySelectorAll('.card'))
        .map(e => (e.querySelector('.card-title') || e).textContent.trim())""")


def storage_next_titles(pg):
    return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').map(t=>t.title)")


def tombstoned_ids(pg):
    return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tombstones')||'[]').map(t=>t.recordId)")


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- a merged record must become VISIBLE, with no restart
    # ============================================================
    # Phone viewport throughout: the desktop layout replaces the floating +
    # with per-column buttons, and every existing check in this directory
    # drives the phone shape ([data-action="fab"]).
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(700)
    pg.click('button.icon-btn[data-action="close-tray"]'); pg.wait_for_timeout(300)

    incoming = rec("remote-visible-1", "ARRIVED FROM THE OTHER DEVICE")
    pg.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", remote_with_next([incoming]))
    pg.wait_for_timeout(200)
    # The real app re-renders after reconcile inside runDropboxSync(); reconcile
    # itself only refreshes memory. Render the way the app does.
    pg.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    pg.wait_for_timeout(400)

    dom = dom_card_titles(pg)
    store = storage_next_titles(pg)
    check("ARRIVED FROM THE OTHER DEVICE" in store, "sanity: the merge did reach storage (this half always worked)")
    check("ARRIVED FROM THE OTHER DEVICE" in dom,
          f"THE FIX: the pulled record is actually ON SCREEN without a restart -- pre-fix this was the invisible half ({dom})")

    check(not errs, f"no JS errors in group 1 ({errs[:3]})")

    # ============================================================
    # Group 2 -- THE DESTRUCTION CHAIN, reproduced end to end.
    # Pre-fix this group fails: the remote record gets tombstoned by a
    # subsequent ordinary local save, then deleted on every device.
    # ============================================================
    ctx2 = b.new_context(viewport={"width": 420, "height": 900})
    pg2 = ctx2.new_page()
    errs2 = []
    pg2.on("pageerror", lambda e: errs2.append(str(e)))
    pg2.goto(url); pg2.wait_for_timeout(700)
    pg2.click('button.icon-btn[data-action="close-tray"]'); pg2.wait_for_timeout(300)

    seed_title = "1 CLICK HERE TO START THE TUTORIAL"
    check(seed_title in dom_card_titles(pg2), "fixture: the seeded next-action this device will complete is on screen")

    # 1. The other device's record arrives and is merged in.
    party = rec("party-1", "Party", device="the-desktop")
    pg2.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", remote_with_next([party]))
    pg2.wait_for_timeout(300)
    check("Party" in storage_next_titles(pg2), "setup: 'Party' merged in from the other device")

    # 2. THE ORDINARY LOCAL ACTION THAT ACTUALLY DESTROYED IT. On the real
    #    device this was "I ticked off the items I'd finished on my phone" --
    #    the lane checkbox, which acts immediately (CLAUDE.md) and ends in
    #    saveTasksLocal("next"), writing the whole in-memory array over
    #    storage. Driven through the real checkbox, not a storage poke, so
    #    this reproduces the user's actual sequence rather than a model of it.
    before_tombs = set(tombstoned_ids(pg2))
    completed_ok = pg2.evaluate("""(title) => {
        const card = [...document.querySelectorAll('.card')].find(c => c.textContent.includes(title));
        if (!card) return false;
        const btn = card.querySelector('[data-action="complete"]');
        if (!btn) return false;
        btn.click();
        return true;
    }""", seed_title)
    pg2.wait_for_timeout(600)
    check(completed_ok, "fixture: really clicked a real lane checkbox (not a simulated save)")
    check(seed_title not in dom_card_titles(pg2), "fixture: and it really completed -- the card left the lane, so a save definitely ran")

    after_tombs = set(tombstoned_ids(pg2))
    new_tombs = after_tombs - before_tombs
    check("party-1" not in new_tombs,
          f"THE FIX: that ordinary completion does NOT tombstone the freshly-merged remote record ({sorted(new_tombs)})")
    check("Party" in storage_next_titles(pg2),
          f"and 'Party' is still there afterwards ({storage_next_titles(pg2)})")
    check("Party" in dom_card_titles(pg2), "and still on screen")

    # 3. Prove it also survives being pushed back out: export what this device
    #    would publish, and confirm it still contains the other device's record
    #    rather than a deletion of it.
    exported = pg2.evaluate("() => window.__oelaSync.exportBundle()")
    exported_titles = [t["title"] for t in exported["stores"]["gtd_tasks_next"]]
    exported_tombs = [t["recordId"] for t in exported["tombstones"]]
    check("Party" in exported_titles,
          f"what this device would PUBLISH still contains the other device's record ({exported_titles})")
    check("party-1" not in exported_tombs,
          "and carries no deletion marker for it -- nothing to destroy it on the far end")

    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")

    # ============================================================
    # Group 3 -- DRAFT ISOLATION x sync (author ruling: defer, option 1)
    # ============================================================
    ctx3 = b.new_context(viewport={"width": 420, "height": 900})
    pg3 = ctx3.new_page()
    errs3 = []
    pg3.on("pageerror", lambda e: errs3.append(str(e)))
    pg3.goto(url); pg3.wait_for_timeout(700)

    # The intray drawer must NOT count as a drafting page -- it auto-opens in
    # boot(), so if it did, sync would be permanently disabled on every device.
    # It is open right now, straight from boot: the strongest possible form of
    # this check, since it is the exact state every launch begins in.
    check(pg3.evaluate("() => !!document.querySelector('.tray-drawer.open')"),
          "fixture: the intray drawer really is open, straight from boot()")
    res_tray = pg3.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)",
                            remote_with_next([rec("drawer-ok-1", "MERGED WITH THE DRAWER OPEN")]))
    check(res_tray.get("applied") is True,
          "an open intray drawer does NOT defer the merge -- it auto-opens at launch, so deferring on it would disable sync entirely, on every device, silently")
    pg3.click('button.icon-btn[data-action="close-tray"]'); pg3.wait_for_timeout(400)

    # A real drafting page DOES defer. The fab opens a KIND menu first; the
    # drafting page itself needs the second click (same two-step every other
    # check in this directory uses).
    pg3.click('[data-action="fab"]'); pg3.wait_for_timeout(400)
    pg3.click('[data-action="new-primary"]'); pg3.wait_for_timeout(600)
    check(pg3.locator(".screen-overlay").count() == 1, "fixture: a real drafting page is open")

    res_draft = pg3.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)",
                             remote_with_next([rec("deferred-1", "SHOULD NOT LAND YET")]))
    check(res_draft.get("applied") is False,
          "a merge arriving while a drafting page is open is DEFERRED, not applied")
    # Only meaningful once the line above holds -- a bundle containing the
    # record proves nothing if the merge was applied normally.
    check(res_draft.get("applied") is False and
          any(r["title"] == "SHOULD NOT LAND YET" for r in res_draft["bundle"]["stores"]["gtd_tasks_next"]),
          "but the merged bundle is STILL returned for pushing -- deferring locally must not stop publishing (the amendment to option 1)")
    check("SHOULD NOT LAND YET" not in storage_next_titles(pg3),
          "and nothing was written locally, so memory and storage still agree -- which is WHY deferring is safe rather than merely polite")

    # NOT TESTED HERE, deliberately and honestly: that closing the page picks
    # the deferred merge back up. That path runs through runDropboxSync(),
    # which returns immediately without a connected transport -- and this file
    # has none by design. checks/desktop_fs_sync.py covers it, where a
    # transport exists.
    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")

    # ============================================================
    # Group 4 -- joining an existing system contributes no seed data
    # ============================================================
    ctx4 = b.new_context(viewport={"width": 420, "height": 900})
    pg4 = ctx4.new_page()
    errs4 = []
    pg4.on("pageerror", lambda e: errs4.append(str(e)))
    pg4.goto(url); pg4.wait_for_timeout(700)
    pg4.click('button.icon-btn[data-action="close-tray"]')
    pg4.wait_for_timeout(300)

    seeded_before = pg4.evaluate("""() => {
        const all = ['gtd_tasks_next','gtd_tasks_waiting','gtd_tasks_current','gtd_tasks_habit','gtd_contexts'];
        let n = 0;
        all.forEach(k => JSON.parse(localStorage.getItem(k)||'[]').forEach(r => { if (r.seedKey || r.tutorialKey) n++; }));
        return n;
    }""")
    check(seeded_before > 0, f"fixture: this fresh device really did seed its own tutorial/sample data ({seeded_before} records)")

    # The cloud already holds someone else's established system.
    established = remote_with_next([rec("established-1", "THE ESTABLISHED SYSTEM")])
    pg4.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", established)
    pg4.wait_for_timeout(300)

    seeded_after = pg4.evaluate("""() => {
        const all = ['gtd_tasks_next','gtd_tasks_waiting','gtd_tasks_current','gtd_tasks_habit','gtd_contexts'];
        let n = 0;
        all.forEach(k => JSON.parse(localStorage.getItem(k)||'[]').forEach(r => { if (r.seedKey || r.tutorialKey) n++; }));
        return n;
    }""")
    check(seeded_after == 0,
          f"joining an existing system drops this device's own tutorial/sample data instead of duplicating it ({seeded_after} left)")
    check("THE ESTABLISHED SYSTEM" in storage_next_titles(pg4),
          "and the established system's own records were adopted")

    # And the joining device's REAL (non-seed) work is never collateral damage.
    ctx5 = b.new_context(viewport={"width": 420, "height": 900})
    pg5 = ctx5.new_page()
    pg5.goto(url); pg5.wait_for_timeout(700)
    pg5.wait_for_selector("#tray-input", timeout=5000)
    pg5.fill("#tray-input", "MY OWN WORK BEFORE CONNECTING")
    pg5.press("#tray-input", "Enter"); pg5.wait_for_timeout(400)
    pg5.evaluate("(bundle) => window.__oelaSync.reconcile(bundle)", established)
    pg5.wait_for_timeout(300)
    tray_after = pg5.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray')||'[]').map(r=>r.text)")
    check("MY OWN WORK BEFORE CONNECTING" in tray_after,
          f"a real capture made before connecting SURVIVES the join -- only seeded content is dropped ({tray_after})")

    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")

    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

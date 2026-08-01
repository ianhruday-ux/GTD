"""W7 -- Restore to defaults, once the cloud holds a copy too.

The author's ruling: the warning has always said "everything you've entered
will be permanently erased… this can't be undone", and SYNC QUIETLY MADE THAT
FALSE. The cloud still held everything, so the next sync poured it all back
and stripped the freshly seeded sample data on the way in -- a reset on a
connected device produced neither your data nor the defaults. The ruling is to
make the warning true again rather than to soften it.

  1. RESET PROPAGATES. "Erase on all devices" tombstones every synced record
     and pushes, so the erase reaches the other devices instead of being
     undone by them. This is the most destructive thing the app can do, which
     is why the dialog says so and why it only appears when the roster
     actually shows another device.

  2. THE RESEED, which the author flagged: the cloud deliberately holds no
     sample data, so a bare mass-tombstone would empty the other devices and
     leave them empty. Keeping the BASELINE is the fix -- with one present the
     next sync is an ordinary three-way merge rather than a rejoin, so
     stripSeededRecords never fires and the defaults this device seeds on
     reload publish as ordinary records. Deletions and fresh sample data reach
     the other devices in the same bundle.

  3. IDENTITY SURVIVES A RESET. The old code cleared gtd_device_id, so every
     reset minted a new id and abandoned the old one in the roster -- the same
     defect class as the import bug, reached from the other side.

  4. DISCONNECTING LEAVES THE ROSTER (author's suggestion). Both Disconnect and
     Disconnect-and-erase are signals that the device no longer wants to be
     counted. It matters because §4.5's tombstone GC keeps every tombstone
     until the OLDEST last-pull across the roster, so one abandoned entry pins
     that horizon for a year.
"""
import os, sys, json, functools, http.server, socket, socketserver, threading, contextlib, time
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

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


def boot(b, url):
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(800)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    return ctx, pg, errs


def ls(pg, k):
    return pg.evaluate("(k) => localStorage.getItem(k)", k)


def next_titles(pg):
    return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').map(t => t.title)")


def cloud_with(pg, records, roster=None):
    keys = pg.evaluate("() => window.__oelaSync.storeKeys")
    t = int(time.time() * 1000)
    return {"roster": roster if roster is not None else {"other-device": {"lastPull": t}},
            "tombstones": [],
            "stores": {k: (records if k == "gtd_tasks_next" else []) for k in keys}}


def rec(id_, title, age_ms=0):
    t = int(time.time() * 1000) - age_ms
    return {"id": id_, "title": title, "isGroup": False, "parent": None, "notesClean": "",
            "linkedProjectId": None, "contextId": None, "whenText": None,
            "createdAt": t, "modifiedAt": t, "deviceId": "other-device"}


def make_connected(pg):
    """Two devices on the roster, with real work already synced in."""
    pg.evaluate("() => { window.__oelaSyncForceEnabled = true; }")
    pg.evaluate("(x) => window.__oelaSync.reconcile(x)", cloud_with(pg, [], roster={}))
    pg.wait_for_timeout(200)
    pg.evaluate("(x) => window.__oelaSync.reconcile(x)", cloud_with(pg, [rec("real-1", "MY REAL WORK")]))
    pg.wait_for_timeout(400)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- a plain (non-propagating) reset is UNDONE by the next sync
    # ============================================================
    # Not a bug being fixed -- the documented reason the propagating option
    # exists. Asserting it so the justification cannot rot silently.
    ctx1, pg1, errs1 = boot(b, url)
    make_connected(pg1)
    check("MY REAL WORK" in next_titles(pg1), f"fixture: the cloud's work is here ({next_titles(pg1)})")

    pg1.evaluate("() => { Object.keys(localStorage).filter(k => k.startsWith('gtd_')).forEach(k => localStorage.removeItem(k)); }")
    pg1.reload(); pg1.wait_for_timeout(900)
    pg1.evaluate("() => { window.__oelaSyncForceEnabled = true; const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    check("MY REAL WORK" not in next_titles(pg1), "a bare wipe does clear it locally")
    pg1.evaluate("(x) => window.__oelaSync.reconcile(x)", cloud_with(pg1, [rec("real-1", "MY REAL WORK")]))
    pg1.wait_for_timeout(500)
    check("MY REAL WORK" in next_titles(pg1),
          f"…and the next sync pours it straight back -- which is exactly why the propagating "
          f"option had to exist ({next_titles(pg1)})")
    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")
    ctx1.close()

    # ============================================================
    # Group 2 -- the propagating reset
    # ============================================================
    ctx2, pg2, errs2 = boot(b, url)
    make_connected(pg2)
    device_before = ls(pg2, "gtd_device_id")
    check(bool(device_before), f"fixture: this device has an identity ({device_before})")

    # Driven through the REAL settings row and the REAL confirm dialog -- the
    # propagating option only renders when the roster shows another device, so
    # driving the UI also proves that gating.
    pg2.click('[data-action="open-overflow"]'); pg2.wait_for_timeout(400)
    pg2.locator('[data-action="clear-all-data"]').first.click(); pg2.wait_for_timeout(500)
    dialog_text = pg2.locator('.choice-dialog p').first.inner_text()
    check("also delete your data on any device" in dialog_text,
          f"the warning says the erase TRAVELS -- it stopped being true when sync shipped ({dialog_text[-70:]!r})")
    labels = pg2.locator('.choice-dialog button').all_inner_texts()
    check(any("all devices" in x for x in labels) and any("only" in x for x in labels),
          f"and the dialog offers both erases plus cancel ({labels})")
    # ⚠ Guarded, not asserted-and-clicked. On the PRE-CHANGE build this button
    # does not exist, and an unguarded click times out and aborts the file --
    # abandoning every later group. checks/README.md protocol 2 wants these
    # runnable against the old build, so a missing control has to read as a
    # legible failure rather than a traceback.
    propagate_btn = pg2.locator('.choice-dialog button').filter(has_text="all devices")
    if propagate_btn.count():
        propagate_btn.first.click()
        pg2.wait_for_timeout(1400)
    else:
        check(False, "the propagating erase button exists at all (it does not on the pre-W7 build)")
        pg2.locator('.choice-dialog button').last.click()  # Cancel, so the page is left usable
        pg2.wait_for_timeout(400)
    pg2.evaluate("() => { window.__oelaSyncForceEnabled = true; const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    check(ls(pg2, "gtd_device_id") == device_before,
          f"THE FIX: the device keeps its IDENTITY across a reset -- pre-W7 every reset minted a "
          f"new id and abandoned the old one in the roster ({ls(pg2, 'gtd_device_id')} vs {device_before})")
    titles = next_titles(pg2)
    check("MY REAL WORK" not in titles, f"the real work is gone locally ({titles})")
    check(any("CLICK HERE" in x for x in titles),
          f"and the sample data was reseeded, so this is a RESTORE and not just an erase ({titles})")

    tombs = json.loads(ls(pg2, "gtd_tombstones") or "[]")
    check(any(t.get("recordId") == "real-1" for t in tombs),
          f"THE RULING: every synced record was TOMBSTONED, so the erase can travel "
          f"({[t.get('recordId') for t in tombs][:6]})")
    check(ls(pg2, "gtd_sync_baseline") is not None,
          "and the baseline survived -- without it the next sync is a rejoin, stripSeededRecords "
          "fires, and the fresh defaults never reach the other devices")

    # Now publish, and read what the OTHER device would receive.
    published = pg2.evaluate("() => window.__oelaSync.exportBundle()")
    pub_titles = [r["title"] for r in published["stores"]["gtd_tasks_next"]]
    pub_tombs = [t["recordId"] for t in published["tombstones"]]
    check("real-1" in pub_tombs,
          f"what this device publishes carries the deletion ({pub_tombs[:6]})")
    check(any("CLICK HERE" in x for x in pub_titles),
          f"AND THE FRESH SAMPLE DATA -- the author's complication: the cloud holds no defaults, so "
          f"a bare mass-tombstone would empty the other devices and leave them empty ({pub_titles})")
    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")
    ctx2.close()

    # ============================================================
    # Group 3 -- the other device actually ends up restored
    # ============================================================
    # Group 2 proved what gets published; this proves what that does on arrival.
    ctx3, pg3, errs3 = boot(b, url)
    pg3.evaluate("() => { window.__oelaSyncForceEnabled = true; }")
    # ⚠ ONE reconcile, against a NON-EMPTY cloud and with no baseline -- the
    # realistic way a second device joins an established system. That path runs
    # stripSeededRecords, so this device drops its OWN sample data on the way
    # in. Seeding it via an empty cloud first (which is what an earlier draft of
    # this file did) skips the strip and leaves the device holding a second copy
    # of the tutorial, which then reads as a duplicate at the end of the group
    # and blames the code for the fixture's mistake.
    #
    # The work is dated an hour ago for the same reason: device 2's reset
    # happens LATER in real life, and a tombstone only wins over a record it is
    # newer than. Minting it at "now" inside this group makes it newer than the
    # tombstone group 2 already wrote, and the merge correctly refuses to
    # delete it.
    pg3.evaluate("(x) => window.__oelaSync.reconcile(x)",
                 cloud_with(pg3, [rec("real-1", "MY REAL WORK", age_ms=3600000)]))
    pg3.wait_for_timeout(500)
    check("MY REAL WORK" in next_titles(pg3), "fixture: the second device has the real work too")
    check(not any("CLICK HERE" in x for x in next_titles(pg3)),
          f"fixture: and joining an established system stripped its own sample data ({next_titles(pg3)})")

    pg3.evaluate("(x) => window.__oelaSync.reconcile(x)", published)
    pg3.wait_for_timeout(600)
    after3 = next_titles(pg3)
    check("MY REAL WORK" not in after3,
          f"the erase reached the second device ({after3})")
    check(any("CLICK HERE" in x for x in after3),
          f"and it was RESTORED to defaults, not merely emptied ({after3})")
    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")
    ctx3.close()

    # ============================================================
    # Group 4 -- disconnecting leaves the roster
    # ============================================================
    ctx4, pg4, errs4 = boot(b, url)
    pg4.evaluate("() => { window.__oelaSyncForceEnabled = true; }")
    me = ls(pg4, "gtd_device_id")
    pg4.evaluate("(x) => window.__oelaSync.reconcile(x)", cloud_with(pg4, [], roster={}))
    pg4.wait_for_timeout(300)
    roster = json.loads(ls(pg4, "gtd_sync_roster") or "{}")
    check(me in roster, f"fixture: an ordinary sync puts this device on the roster ({list(roster)})")

    # ⚠ Guarded, like group 2's button. This API does not exist on the
    # pre-change build, and an unguarded call aborts the whole file --
    # checks/README.md protocol 2 wants these runnable against the old build,
    # so a missing API has to read as a legible failure, not a traceback.
    if not pg4.evaluate("() => typeof window.__oelaSync.setLeavingRoster === 'function'"):
        check(False, "the farewell-sync API exists at all (it does not on the pre-W7 build)")
        check(False, "a farewell sync removes this device from the roster it publishes")
        check(False, "while every other device stays exactly where it was")
    else:
        pg4.evaluate("() => window.__oelaSync.setLeavingRoster(true)")
        # ⚠ A REALISTIC lastPull. gcTombstonesAndRoster drops any device that
        # has not pulled inside SYNC_ROSTER_DROPOUT_MS (a year), so the
        # epoch-1ms value an earlier draft used got the other device
        # garbage-collected out -- correctly -- and read as this fix having
        # removed the wrong one.
        out = pg4.evaluate("(x) => window.__oelaSync.reconcile(x)",
                           cloud_with(pg4, [], roster={"other-device": {"lastPull": int(time.time() * 1000)}}))
        pg4.wait_for_timeout(300)
        check(me not in (out["bundle"]["roster"] or {}),
              f"THE RULING: a farewell sync REMOVES this device from the roster it publishes -- an "
              f"abandoned entry pins the tombstone GC horizon for a year ({list(out['bundle']['roster'])})")
        check("other-device" in (out["bundle"]["roster"] or {}),
              "while every other device stays exactly where it was")
        pg4.evaluate("() => window.__oelaSync.setLeavingRoster(false)")
    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")
    ctx4.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

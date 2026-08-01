"""W7 -- restoring a backup, once two devices exist (wrapper-plan.md §11).

The author's ruling, in two halves:

  (a) A RESTORE IS THE TRUTH and propagates outward. Restored records are
      stamped modifiedAt = now, so a restored item beats an earlier deletion
      on the other device instead of being quietly re-deleted by it. Pre-W7
      that re-deletion took mergeRecordArray's `l && !r` branch, which drops
      the record and returns WITHOUT recording a conflict -- an ordinary
      deliberate action, an invisible mechanism, and no report. It failed §1's
      never-silent standard outright.

  (b) IDENTITY IS NEVER RESTORED. gtd_device_id, gtd_sync_baseline,
      gtd_sync_connected, gtd_tombstones and gtd_sync_roster are sync's own
      bookkeeping, not the user's data. Import refuses them and export no
      longer writes them. The worst case was the quietest: restoring a phone
      backup onto a new computer is the NORMAL way to set one up, and it gave
      two devices the same identity -- corrupting the roster, the tombstone GC
      ("oldest last pull across every device") and the deviceId tie-break.

      Baseline/tombstones/roster are CLEARED rather than kept, because after a
      restore this device's data no longer matches its old baseline either,
      and a baseline is exactly what licenses inferring "absent means deleted".
      With none, §4.5 makes the next sync additive-only: a restore asserts what
      it contains and infers nothing from what it does not, so restoring
      January's backup cannot silently delete February's work on the other
      device.

Written to the protocols in checks/README.md. Driven through the real Import
button and the real confirm dialog -- a storage poke would prove nothing about
the path a person actually takes.
"""
import os, sys, json, functools, http.server, socket, socketserver, threading, contextlib, time
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

MACHINERY = ["gtd_device_id", "gtd_sync_baseline", "gtd_sync_connected",
             "gtd_tombstones", "gtd_sync_roster"]


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
    pg.goto(url); pg.wait_for_timeout(700)
    pg.click('button.icon-btn[data-action="close-tray"]'); pg.wait_for_timeout(300)
    return ctx, pg, errs


def do_import(pg, payload):
    """Drive the REAL import: the file chooser, then the real confirm button.

    set_input_files on the hidden <input type=file> importAllData creates --
    the one native dialog that works in a sandboxed context, per the app's own
    comment. Nothing here pokes storage directly.
    """
    with pg.expect_file_chooser() as fc:
        pg.locator('[data-action="import-data"]').first.click()
    fc.value.set_files({"name": "oela-backup.json", "mimeType": "application/json",
                        "buffer": json.dumps(payload).encode()})
    pg.wait_for_timeout(600)
    # The danger-styled button in the confirm dialog is the commit.
    pg.locator('.choice-dialog button.danger').first.click()
    pg.wait_for_timeout(1200)


def open_settings(pg):
    pg.click('[data-action="open-overflow"]'); pg.wait_for_timeout(400)


def ls(pg, key):
    return pg.evaluate("(k) => localStorage.getItem(k)", key)


def next_titles(pg):
    return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').map(t => t.title)")


def next_records(pg):
    return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]')")


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- what a backup CONTAINS
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url)
    # Give this device a full set of sync bookkeeping to leak.
    pg1.evaluate("""() => {
        localStorage.setItem('gtd_device_id', 'THE-PHONE');
        localStorage.setItem('gtd_sync_baseline', JSON.stringify({stores:{}}));
        localStorage.setItem('gtd_sync_connected', '1');
        localStorage.setItem('gtd_tombstones', JSON.stringify([{id:'t1',store:'gtd_tasks_next',recordId:'x',deletedAt:1}]));
        localStorage.setItem('gtd_sync_roster', JSON.stringify({'THE-PHONE':{lastPull:1}}));
    }""")
    payload = pg1.evaluate("() => window.__oelaSerializeAllData ? window.__oelaSerializeAllData() : null")
    if payload is None:
        # No test hook: read what the real Export writes, via the download.
        with pg1.expect_download() as dl:
            open_settings(pg1)
            pg1.locator('[data-action="export-data"]').first.click()
        path = dl.value.path()
        payload = json.loads(open(path, encoding="utf-8").read())

    keys = list((payload or {}).get("data", {}).keys())
    check(bool(keys), f"fixture: the backup contains data at all ({len(keys)} keys)")
    leaked = [k for k in MACHINERY if k in keys]
    check(not leaked,
          "THE FIX: a backup carries NO sync bookkeeping -- pre-W7 it swept every gtd_ key, "
          f"gtd_device_id included ({leaked})")
    check("gtd_tasks_next" in keys, f"while the user's actual data is all still there ({'gtd_tasks_next' in keys})")
    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")
    ctx1.close()

    # ============================================================
    # Group 2 -- restoring onto a DIFFERENT device keeps its identity
    # ============================================================
    # The scenario the ruling is named for: a phone backup restored onto a new
    # computer, which is the normal way to set one up.
    ctx2, pg2, errs2 = boot(b, url)
    own_id = ls(pg2, "gtd_device_id")
    check(bool(own_id), f"fixture: this device has an identity of its own ({own_id})")

    phone_backup = {"app": "OELA", "format": 1, "exportedAt": "2026-01-21T00:00:00Z", "data": {
        "gtd_tasks_next": json.dumps([
            {"id": "restored-1", "title": "RESTORED FROM THE PHONE", "isGroup": False,
             "parent": None, "notesClean": "", "linkedProjectId": None, "contextId": None,
             "whenText": None, "createdAt": 1, "modifiedAt": 1, "deviceId": "THE-PHONE"}]),
        # An OLD backup, from a build that still wrote these. Import must
        # refuse them even though export no longer emits them.
        "gtd_device_id": "THE-PHONE",
        "gtd_sync_baseline": json.dumps({"stores": {"gtd_tasks_next": []}}),
        "gtd_tombstones": json.dumps([{"id": "t9", "store": "gtd_tasks_next",
                                       "recordId": "restored-1", "deletedAt": 9999999999999}]),
        "gtd_sync_roster": json.dumps({"THE-PHONE": {"lastPull": 1}}),
    }}
    open_settings(pg2)
    do_import(pg2, phone_backup)

    check("RESTORED FROM THE PHONE" in next_titles(pg2),
          f"the backup's actual data was restored ({next_titles(pg2)})")
    check(ls(pg2, "gtd_device_id") == own_id,
          f"THE FIX: this device kept its OWN identity -- pre-W7 it adopted the phone's, so two "
          f"devices shared one ({ls(pg2, 'gtd_device_id')} vs {own_id})")
    check(ls(pg2, "gtd_sync_baseline") is None,
          f"the foreign baseline was refused AND the local one cleared -- no baseline means "
          f"additive-only, so the restore infers no deletions ({ls(pg2, 'gtd_sync_baseline')})")
    check(not json.loads(ls(pg2, "gtd_tombstones") or "[]"),
          f"tombstones are cleared, so the restore asserts no deletions either "
          f"({ls(pg2, 'gtd_tombstones')})")
    check(not json.loads(ls(pg2, "gtd_sync_roster") or "{}"),
          f"and the roster is rebuilt from scratch rather than inheriting the phone's "
          f"({ls(pg2, 'gtd_sync_roster')})")
    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")
    ctx2.close()

    # ============================================================
    # Group 3 -- (a) a restored record BEATS the other device's deletion
    # ============================================================
    ctx3, pg3, errs3 = boot(b, url)
    t_delete = int(time.time() * 1000) - 60000  # the other device deleted it a minute ago

    backup3 = {"app": "OELA", "format": 1, "exportedAt": "2026-01-21T00:00:00Z", "data": {
        "gtd_tasks_next": json.dumps([
            {"id": "party-1", "title": "Party", "isGroup": False, "parent": None,
             "notesClean": "", "linkedProjectId": None, "contextId": None, "whenText": None,
             # DELIBERATELY older than the deletion. Unstamped, this loses.
             "createdAt": 1, "modifiedAt": t_delete - 60000, "deviceId": "THE-PHONE"}]),
    }}
    open_settings(pg3)
    do_import(pg3, backup3)

    restored = [r for r in next_records(pg3) if r["id"] == "party-1"]
    check(bool(restored), f"fixture: 'Party' was restored ({next_titles(pg3)})")
    check(restored and restored[0]["modifiedAt"] > t_delete,
          "THE RULING (a): the restored record is stamped NOW, so it outranks a deletion made "
          f"after the backup was taken ({restored[0]['modifiedAt'] if restored else None} vs {t_delete})")
    check(restored and restored[0]["deviceId"] == ls(pg3, "gtd_device_id"),
          "and is attributed to the device that restored it, not the one that wrote the backup")

    # Now prove it end to end against a cloud that still holds the tombstone.
    empty_stores = pg3.evaluate("() => window.__oelaSync.storeKeys")
    remote3 = {"roster": {"other-device": {"lastPull": int(time.time() * 1000)}},
               "tombstones": [{"id": "t-party", "store": "gtd_tasks_next", "recordId": "party-1",
                               "deletedAt": t_delete, "modifiedAt": t_delete,
                               "deviceId": "other-device"}],
               "stores": {k: [] for k in empty_stores}}
    res3 = pg3.evaluate("(r) => window.__oelaSync.reconcile(r)", remote3)
    pg3.wait_for_timeout(500)
    check("Party" in next_titles(pg3),
          f"and it SURVIVES the sync that follows -- pre-W7 the cloud's newer tombstone dropped it "
          f"on a code path that reports nothing ({next_titles(pg3)})")
    check(any(c.get("resurrection") for c in res3["conflicts"]),
          f"and the resurrection was REPORTED, not silent ({res3['conflicts']})")
    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")
    ctx3.close()

    # ============================================================
    # Group 4 -- the DELETING device is told too, and told once
    # ============================================================
    # Found live by the author: after a restore, the phone (which brought the
    # record back) logged the resurrection and the desktop (which had DELETED
    # it) logged nothing -- and the phone logged it TWICE.
    #
    # The silence was the sharper bug. A record this device deleted is by
    # definition absent from its own baseline, so mergeRecordArray's `r && !l`
    # branch took the additive path and returned before ever consulting the
    # local tombstone. The person who deleted the thing is precisely the person
    # who needs telling it came back.
    ctx4, pg4, errs4 = boot(b, url)
    keys = pg4.evaluate("() => window.__oelaSync.storeKeys")
    t_del = int(time.time() * 1000) - 120000

    # ⚠ The other device's lastPull is deliberately OLDER than our deletion.
    # gcTombstonesAndRoster keeps a tombstone only until the oldest last-pull
    # across the roster, so a roster claiming everyone pulled just now
    # garbage-collects a two-minute-old tombstone immediately -- and with no
    # tombstone there is no resurrection left to report, which made an earlier
    # draft of this group fail identically on both builds and look like the fix
    # not working. It is also simply realistic: the far end has NOT pulled
    # since we deleted, which is exactly why it still holds the record.
    def bundle(records, tombstones):
        return {"roster": {"other-device": {"lastPull": t_del - 60000}},
                "tombstones": tombstones,
                "stores": {k: (records if k == "gtd_tasks_next" else []) for k in keys}}

    party = {"id": "party-1", "title": "Party", "isGroup": False, "parent": None,
             "notesClean": "", "linkedProjectId": None, "contextId": None, "whenText": None,
             "createdAt": t_del - 60000, "modifiedAt": t_del - 60000, "deviceId": "other-device"}

    # This device once had 'Party' and deleted it -- so it holds a tombstone and
    # its baseline no longer mentions the record.
    pg4.evaluate("(x) => window.__oelaSync.reconcile(x)", bundle([party], []))
    pg4.wait_for_timeout(300)
    pg4.evaluate("""(t) => {
        const arr = JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]')
            .filter(r => r.id !== 'party-1');
        localStorage.setItem('gtd_tasks_next', JSON.stringify(arr));
        localStorage.setItem('gtd_tombstones', JSON.stringify([
          { id: 'tomb-party', store: 'gtd_tasks_next', recordId: 'party-1',
            deletedAt: t, modifiedAt: t, deviceId: 'this-device' }]));
    }""", t_del)
    pg4.wait_for_timeout(200)
    check("Party" not in next_titles(pg4), f"fixture: this device deleted 'Party' ({next_titles(pg4)})")

    # ⚠ AND THE DELETION HAS TO SETTLE before the restore arrives, or this
    # group tests the wrong branch. Sync once against a cloud that has also
    # dropped the record: that rewrites the baseline WITHOUT it, which is the
    # real post-deletion state. An earlier draft skipped this, left 'Party' in
    # the baseline, and so exercised mergeRecordArray's ordinary
    # tombstone-vs-record path -- which already reported resurrections before
    # this fix, making the whole group vacuous. The bug lives specifically in
    # the `!b` additive path, and `!b` is only true once the baseline has
    # caught up with the deletion.
    pg4.evaluate("(x) => window.__oelaSync.reconcile(x)", bundle([], []))
    pg4.wait_for_timeout(300)
    baseline_has = pg4.evaluate("""() => {
        const b = JSON.parse(localStorage.getItem('gtd_sync_baseline') || 'null');
        return !!(b && (b.stores.gtd_tasks_next || []).some(r => r.id === 'party-1'));
    }""")
    check(not baseline_has,
          "fixture: and the deletion has SETTLED -- the baseline no longer mentions it, which is "
          "what puts the next merge on the additive path where the bug lived")

    # The other device restored it from a backup, so it comes back NEWER than
    # our deletion.
    restored_party = dict(party); restored_party["modifiedAt"] = int(time.time() * 1000)
    res4 = pg4.evaluate("(x) => window.__oelaSync.reconcile(x)", bundle([restored_party], []))
    pg4.wait_for_timeout(400)
    check("Party" in next_titles(pg4), f"the restored record arrives ({next_titles(pg4)})")
    check(any(c.get("resurrection") for c in res4["conflicts"]),
          f"THE FIX: and THIS device -- the one that deleted it -- is told, instead of resurrecting "
          f"it in silence ({res4['conflicts']})")

    # Re-running the SAME merge must not re-report: a resurrection is
    # re-derived by every sync until the restored record has actually been
    # pushed, so the conflict recurring is normal and must not multiply.
    res4b = pg4.evaluate("(x) => window.__oelaSync.reconcile(x)", bundle([restored_party], []))
    pg4.wait_for_timeout(300)
    check(not any(c.get("resurrection") for c in res4b["conflicts"]),
          f"and once the record is settled on BOTH sides there is nothing left to report "
          f"({res4b['conflicts']})")
    # (The other half -- that a CAS retry inside ONE sync does not log the same
    # conflict twice -- is asserted in desktop_fs_sync.py, where a transport
    # with a real retry loop is already wired up.)
    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")
    ctx4.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

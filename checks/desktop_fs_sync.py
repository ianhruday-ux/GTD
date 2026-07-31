"""W6 -- the Electron desktop transport (wrapper-plan.md W6, src/desktopTransport.js).

Drives the real window.__oelaDesktop against a FAKED window.__oelaDesktopBridge
(the contextBridge surface wrapper/electron/preload.js exposes), since this
sandbox has no real Electron process and no real Dropbox-synced folder on
disk. The fake "disk" is Python-side state shared across browser contexts via
context.expose_function -- the same role dropbox_transport.py's FakeCloud
class plays for the network transport, except here the shared thing really is
meant to model a filesystem, which is naturally external to any one page the
way an OS disk is external to any one process. Everything else (connect,
syncNow, the retry loop, the settings UI, activeSyncTransport() in app.js)
runs the real code.

Three groups, mirroring dropbox_transport.py's own split:
  1. Engine, via window.__oelaDesktop directly: first-ever sync, and the
     mtime-based "someone else wrote to the file in between" race that
     desktopSyncNow()'s retry loop exists to survive (the local stand-in for
     dropboxTransport.js's CAS-on-revision collision test).
  2. THE SAME QUESTION dropbox_transport.py's author asked, asked again of a
     different transport: what survives the app's process dying between the
     local merge landing and the write to disk actually completing.
  3. Settings UI, via activeSyncTransport() (app.js): proves the SAME "Connect
     Dropbox" row, staleness label, conflict panel, and disconnect flow that
     dropbox_settings_ui.py already exercises for Android are genuinely
     transport-agnostic -- driven here by the desktop bridge instead of a
     mocked Dropbox API, through the exact same app.js code path. Also covers
     the one thing only this transport has: auto-detect failing and falling
     back to the folder picker.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, json, sys, time
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

FAKE_DESKTOP_BRIDGE = """
window.__testDetectedFolder = "C:/FakeDropbox";
window.__testPickedFolder = null;
window.__testWriteHangs = false;
window.__oelaDesktopBridge = {
  isElectron: true,
  detectDropboxFolder: async function(){ return window.__testDetectedFolder; },
  pickFolder: async function(){ return window.__testPickedFolder; },
  readSyncFile: async function(root){ return await window.__fsRead(root); },
  writeSyncFile: async function(root, content){
    if (window.__testWriteHangs) return new Promise(function(){}); // never resolves -- simulates the process dying mid-write
    return await window.__fsWrite(root, content);
  }
};
"""


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


class FakeDisk:
    """The one shared file, as a real filesystem would track it: content plus
    an mtime that changes on every write -- desktopTransport.js's own stand-in
    for Dropbox's CAS revision. `root` mirrors main.js's DROPBOX_APP_SUBPATH
    layout (<root>/Apps/OELA/oela-sync.json), exercised for real here rather
    than assumed. Shared across MULTIPLE browser contexts (group 2) the same
    way dropbox_transport.py's FakeCloud is, since a real disk doesn't belong
    to any one browser context either."""
    def __init__(self):
        self.files = {}  # path -> {"content": str, "mtimeMs": float}
        self.read_count = 0
        self.race_on_read_count = None
        self.race_content = None

    def _path(self, root):
        return root + "/Apps/OELA/oela-sync.json"

    def read(self, root):
        self.read_count += 1
        p = self._path(root)
        f = self.files.get(p)
        result = ({"exists": True, "content": f["content"], "mtimeMs": f["mtimeMs"]}
                   if f else {"exists": False, "content": None, "mtimeMs": None})
        if self.race_on_read_count == self.read_count:
            # Simulate another writer (the real Dropbox daemon syncing a
            # remote change to disk) landing in the gap between THIS read and
            # the caller's own eventual write.
            self.files[p] = {"content": self.race_content, "mtimeMs": time.time() * 1000 + 0.5}
        return result

    def write(self, root, content):
        p = self._path(root)
        self.files[p] = {"content": content, "mtimeMs": time.time() * 1000 + 0.5}
        return {"mtimeMs": self.files[p]["mtimeMs"]}


def wire_bridge(ctx, disk):
    ctx.add_init_script(FAKE_DESKTOP_BRIDGE)
    ctx.expose_function("__fsRead", disk.read)
    ctx.expose_function("__fsWrite", disk.write)


def local_tray_texts(pg):
    return sorted(r["text"] for r in pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray')||'[]')"))


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- engine, against the real code
    # ============================================================
    disk1 = FakeDisk()
    ctx1 = b.new_context(viewport={"width": 420, "height": 900})
    wire_bridge(ctx1, disk1)
    pg1 = ctx1.new_page()
    errs1 = []
    pg1.on("pageerror", lambda e: errs1.append(str(e)))
    pg1.goto(url); pg1.wait_for_timeout(600)

    check(pg1.evaluate("() => !!(window.__oelaDesktop && window.__oelaDesktopBridge.isElectron)"),
          "the fake bridge + transport hook are both live")

    pg1.evaluate("() => window.__oelaDesktop.connect()")
    pg1.wait_for_timeout(300)
    check(pg1.evaluate("() => localStorage.getItem('gtd_desktop_sync_folder')") == "C:/FakeDropbox",
          "connect() used the auto-detected folder, not the picker")
    check(pg1.evaluate("() => window.__oelaSync.isEnabled()"), "Sync.isEnabled() flips on after connect()")

    pg1.wait_for_selector("#tray-input", timeout=5000)
    pg1.fill("#tray-input", "first device, first sync")
    pg1.press("#tray-input", "Enter"); pg1.wait_for_timeout(400)

    result1 = pg1.evaluate("() => window.__oelaDesktop.syncNow()")
    check(bool(disk1.files), "first-ever sync (no file yet) still produces a real write, via desktopEmptyBundle()")
    check(result1["conflicts"] == [], "no conflicts reported on an empty-disk first sync")
    check(local_tray_texts(pg1) == ["first device, first sync"], "the local capture survived its own first sync")

    # A genuine race: something else writes the file between this device's
    # read and its write. Simulated directly, same approach as
    # dropbox_transport.py's CAS-collision test.
    pg1.fill("#tray-input", "second local item, before the race"); pg1.press("#tray-input", "Enter")
    pg1.wait_for_timeout(300)
    existing = json.loads(next(iter(disk1.files.values()))["content"])
    intruder_bundle = dict(existing)
    intruder_bundle["roster"] = dict(existing["roster"])
    intruder_bundle["roster"]["intruder"] = {"lastPull": int(time.time() * 1000)}
    disk1.race_content = json.dumps(intruder_bundle)
    disk1.race_on_read_count = disk1.read_count + 1  # the very next read this device makes
    reads_before = disk1.read_count

    result2 = pg1.evaluate("() => window.__oelaDesktop.syncNow()")
    check(disk1.read_count - reads_before == 4, f"a real race (file changed between read and write) triggers exactly one retry, i.e. 4 reads not 2 ({disk1.read_count - reads_before})")
    check("second local item, before the race" in local_tray_texts(pg1), "the item queued during the race still made it to disk after the retry")
    final_bundle = json.loads(next(iter(disk1.files.values()))["content"])
    check("intruder" in final_bundle["roster"], "the OTHER write that won the race is still present too -- the retry merged with it, didn't clobber it")

    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")

    # ============================================================
    # Group 2 -- killed between local merge and the write landing on disk
    # ============================================================
    disk2 = FakeDisk()
    now_ms = int(time.time() * 1000)
    seed_stores = {k: [] for k in ["gtd_tasks_next", "gtd_tasks_waiting", "gtd_tasks_current",
                                    "gtd_tasks_future", "gtd_tasks_habit", "gtd_events", "gtd_notes",
                                    "gtd_tags", "gtd_contexts", "gtd_completed_next",
                                    "gtd_completed_waiting", "gtd_completed_current",
                                    "gtd_completed_future", "gtd_tray"]}
    seed_stores["gtd_tray"] = [{"id": "remote-1", "text": "from the other device", "modifiedAt": 1, "deviceId": "other-device"}]
    disk2.files[disk2._path("C:/FakeDropbox")] = {
        "content": json.dumps({"roster": {"other-device": {"lastPull": 1}}, "tombstones": [], "stores": seed_stores}),
        "mtimeMs": time.time() * 1000
    }

    ctxA = b.new_context(viewport={"width": 420, "height": 900})
    wire_bridge(ctxA, disk2)
    pgA = ctxA.new_page()
    errsA = []
    pgA.on("pageerror", lambda e: errsA.append(str(e)))
    pgA.goto(url); pgA.wait_for_timeout(600)

    pgA.evaluate("() => window.__oelaDesktop.connect()")
    pgA.wait_for_timeout(300)
    pgA.wait_for_selector("#tray-input", timeout=5000)
    pgA.fill("#tray-input", "captured right before the app dies"); pgA.press("#tray-input", "Enter")
    pgA.wait_for_timeout(400)

    pgA.evaluate("() => { window.__testWriteHangs = true; }")
    write_calls_before = disk2.read_count  # not used for writes, just a sanity anchor
    pgA.evaluate("() => { window.__oelaDesktop.syncNow(); }")  # fire-and-forget, NOT awaited -- exactly like a real dangling call the process dies during
    pgA.wait_for_timeout(600)  # time for the read + synchronous reconcile() to complete; the write is still hanging

    merged_now = local_tray_texts(pgA)
    check("captured right before the app dies" in merged_now, "this device's own capture is still there after the 'kill' -- reconcile() writing locally does not depend on the disk write finishing")
    check("from the other device" in merged_now, "the OTHER device's record was already merged in locally too, before the write that would have reported it ever landed")
    check(len(disk2.files) == 1 and "captured right before the app dies" not in disk2.files[disk2._path("C:/FakeDropbox")]["content"],
          "the disk file itself was NOT touched by the killed attempt -- no torn/partial write landed")

    state = ctxA.storage_state()
    ctxA.close()

    ctxB = b.new_context(viewport={"width": 420, "height": 900}, storage_state=state)
    wire_bridge(ctxB, disk2)  # SAME disk -- a relaunch reconnects to the same folder on the same machine
    pgB = ctxB.new_page()
    errsB = []
    pgB.on("pageerror", lambda e: errsB.append(str(e)))
    pgB.goto(url); pgB.wait_for_timeout(600)

    check(sorted(local_tray_texts(pgB)) == sorted(merged_now), "everything survived the relaunch untouched -- nothing lost, nothing duplicated, before a second sync even runs")

    result3 = pgB.evaluate("() => window.__oelaDesktop.syncNow()")
    check(result3["conflicts"] == [], "the recovery sync is a routine one-sided update, not a conflict -- the other device's record hadn't changed since")
    final2 = json.loads(next(iter(disk2.files.values()))["content"])
    check(any(r["text"] == "captured right before the app dies" for r in final2["stores"]["gtd_tray"]),
          "the capture that was 'lost' in the kill made it to the actual disk on the very next sync attempt")
    check(any(r["text"] == "from the other device" for r in final2["stores"]["gtd_tray"]),
          "and the other device's record is still there too -- the delayed write didn't overwrite it")

    check(not errsA, f"no JS errors on device A, including during the killed attempt ({errsA[:3]})")
    check(not errsB, f"no JS errors on the relaunch/recovery ({errsB[:3]})")

    # ============================================================
    # Group 3 -- the settings UI, via activeSyncTransport() (app.js)
    # ============================================================
    disk3 = FakeDisk()
    ctx3 = b.new_context(viewport={"width": 420, "height": 900})
    wire_bridge(ctx3, disk3)
    pg3 = ctx3.new_page()
    errs3 = []
    pg3.on("pageerror", lambda e: errs3.append(str(e)))
    pg3.goto(url); pg3.wait_for_timeout(600)

    pg3.click('button.icon-btn[data-action="close-tray"]'); pg3.wait_for_timeout(300)
    pg3.click('[data-action="open-overflow"]'); pg3.wait_for_timeout(300)

    check(pg3.locator(".settings-menu").count() > 0, "the settings menu actually opened")
    check(pg3.locator('[data-action="dropbox-connect"]').count() == 1,
          "not connected yet: the SAME 'Connect Dropbox' row Android uses, now backed by the desktop transport (no window.Capacitor here, so activeSyncTransport() resolved to DesktopTransport)")
    check(pg3.locator('[data-action="dropbox-sync-now"]').count() == 0, "and not the Sync now row yet")

    pg3.click('[data-action="dropbox-connect"]')
    pg3.wait_for_timeout(600)  # connect() -> setConnected(true) -> runDropboxSync() (first-ever sync)

    check(pg3.locator('[data-action="dropbox-sync-now"]').count() == 1, "after connecting: Sync now row appears")
    check(pg3.locator('[data-action="dropbox-connect"]').count() == 0, "and Connect Dropbox is gone")
    check(bool(disk3.files), "connecting triggered a real first sync that actually reached the (fake) disk")

    status_text = pg3.locator('[data-action="dropbox-sync-now"] .si-note').inner_text()
    check("just now" in status_text.lower() or "刚刚" in status_text, f"status label reads as fresh right after syncing ({status_text!r})")

    # ---- staleness bucketing, same generic key/label as Dropbox's own UI test ----
    ninety_min_ago = int(time.time() * 1000) - 90 * 60 * 1000
    pg3.evaluate("(t) => localStorage.setItem('gtd_dropbox_last_sync', String(t))", ninety_min_ago)
    pg3.click(".menu-scrim", position={"x": 5, "y": 5}); pg3.wait_for_timeout(150)
    pg3.click('[data-action="open-overflow"]'); pg3.wait_for_timeout(200)
    status_text2 = pg3.locator('[data-action="dropbox-sync-now"] .si-note').inner_text()
    check("1 hour" in status_text2 or "1 小时" in status_text2, f"90 minutes later, the label buckets into hours ({status_text2!r})")

    # ---- a genuine conflict, driven through the real resume trigger ----
    pg3.click(".menu-scrim", position={"x": 5, "y": 5}); pg3.wait_for_timeout(150)
    pg3.click('[data-action="open-tray"]'); pg3.wait_for_timeout(300)
    pg3.wait_for_selector("#tray-input", timeout=5000)
    pg3.fill("#tray-input", "the shared baseline text"); pg3.press("#tray-input", "Enter")
    pg3.wait_for_timeout(300)
    local_capture_id = pg3.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray'))[0].id")
    pg3.click('button.icon-btn[data-action="close-tray"]'); pg3.wait_for_timeout(300)

    pg3.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")  # the real resume trigger, not the raw transport call
    pg3.wait_for_timeout(600)

    pg3.evaluate("""(id) => {
        const arr = JSON.parse(localStorage.getItem('gtd_tray'));
        const rec = arr.find(r => r.id === id);
        rec.text = 'edited locally after the baseline';
        rec.modifiedAt = Date.now();
        localStorage.setItem('gtd_tray', JSON.stringify(arr));
    }""", local_capture_id)

    disk_path3 = disk3._path("C:/FakeDropbox")
    remote_bundle = json.loads(disk3.files[disk_path3]["content"])
    remote_bundle = dict(remote_bundle)
    remote_bundle["stores"] = dict(remote_bundle["stores"])
    remote_bundle["stores"]["gtd_tray"] = [
        {"id": local_capture_id, "text": "edited on the OTHER device",
         "createdAt": 1, "modifiedAt": int(time.time() * 1000) + 60000, "deviceId": "some-other-device"}
    ]
    disk3.files[disk_path3] = {"content": json.dumps(remote_bundle), "mtimeMs": time.time() * 1000 + 1}

    pg3.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    pg3.wait_for_timeout(600)

    log = pg3.evaluate("() => JSON.parse(localStorage.getItem('gtd_dropbox_conflict_log')||'[]')")
    check(len(log) == 1, f"the real sync produced exactly one logged conflict ({log})")
    if log:
        check(log[0]["keptText"] == "edited on the OTHER device", f"logged the WINNING text correctly ({log[0]})")
        check(log[0]["lostText"] == "edited locally after the baseline", f"and the LOSING (local) text too ({log[0]})")

    pg3.click('[data-action="open-overflow"]'); pg3.wait_for_timeout(200)
    check(pg3.locator('[data-action="settings-dropbox-conflicts"]').count() == 1, "the conflict row shows in the root panel")
    pg3.click('[data-action="settings-dropbox-conflicts"]')
    pg3.wait_for_timeout(200)
    panel_text = pg3.locator(".settings-menu").inner_text()
    check("edited on the OTHER device" in panel_text, "the conflict panel shows what was kept")
    check("edited locally after the baseline" in panel_text, "and what was replaced")
    pg3.click('[data-action="settings-root"]'); pg3.wait_for_timeout(150)

    # ---- disconnect clears the generic sync state AND the desktop-only folder ----
    pg3.click('[data-action="dropbox-disconnect"]')
    pg3.wait_for_timeout(300)
    check(pg3.locator('[data-action="dropbox-connect"]').count() == 1, "after disconnecting: back to showing Connect Dropbox")
    check(pg3.evaluate("() => localStorage.getItem('gtd_dropbox_last_sync')") is None, "last-sync timestamp cleared on disconnect")
    check(pg3.evaluate("() => localStorage.getItem('gtd_dropbox_conflict_log')") is None, "conflict log cleared on disconnect")
    check(pg3.evaluate("() => localStorage.getItem('gtd_desktop_sync_folder')") is None, "the saved Dropbox folder is cleared too -- desktopDisconnect()'s own extra state, not shared with Android")

    check(not errs3, f"no JS errors across the whole settings flow ({errs3[:5]})")

    # ---- auto-detect failing falls back to the picker ----
    disk4 = FakeDisk()
    ctx4 = b.new_context(viewport={"width": 420, "height": 900})
    wire_bridge(ctx4, disk4)
    pg4 = ctx4.new_page()
    errs4 = []
    pg4.on("pageerror", lambda e: errs4.append(str(e)))
    pg4.goto(url); pg4.wait_for_timeout(600)
    pg4.evaluate("() => { window.__testDetectedFolder = null; window.__testPickedFolder = 'D:/PickedDropbox'; }")

    pg4.evaluate("() => window.__oelaDesktop.connect()")
    pg4.wait_for_timeout(300)
    check(pg4.evaluate("() => localStorage.getItem('gtd_desktop_sync_folder')") == "D:/PickedDropbox",
          "auto-detect returning nothing falls back to the folder picker's result")
    check(pg4.evaluate("() => window.__oelaSync.isEnabled()"), "and connect() still succeeds via the picker path")
    check(not errs4, f"no JS errors in the picker-fallback check ({errs4[:3]})")

    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

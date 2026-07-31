"""W5 -- the Dropbox settings UI (wrapper-plan.md SS1/SS5): the row at the top
of the settings menu, the manual Sync now button, the staleness label, and
the conflict log panel ("never silent"). checks/dropbox_transport.py already
proves the merge/CAS/kill-recovery logic; this file proves that logic is
actually WIRED to what the user sees -- the settings menu renders the right
row in the right state, a real conflict returned by a real sync lands in the
panel with the right text, and Disconnect actually clears what it should.

Same mocking approach as dropbox_transport.py: a fake window.Capacitor +
DropboxAuth plugin (native-only feature, no real device here), and a
minimal stateful fake Dropbox file via page.route -- just enough of it to
drive one connect -> sync -> conflict -> disconnect cycle through the real
UI code, not a reimplementation of it.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, json, sys, time
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

FAKE_CAPACITOR = """
window.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    DropboxAuth: {
      isAuthorized: async () => ({ authorized: true }),
      authorize: async () => ({}),
      signOut: async () => ({}),
      getAccessToken: async () => ({ accessToken: "fake-token-for-tests" })
    }
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


def not_found_body():
    return json.dumps({"error_summary": "path/not_found/.", "error": {".tag": "path", "path": {".tag": "not_found"}}})


class FakeCloud:
    """Bare minimum to drive one connect -> sync -> edit -> conflicting
    remote edit -> sync cycle. No CAS-collision simulation here -- that's
    dropbox_transport.py's job; this file only needs the happy path plus one
    genuine same-record conflict."""
    def __init__(self):
        self.exists = False
        self.rev = None
        self.bundle = None

    def route_download(self, route):
        if not self.exists:
            route.fulfill(status=409, content_type="application/json", body=not_found_body())
            return
        route.fulfill(status=200,
                       headers={"Dropbox-API-Result": json.dumps({"rev": self.rev}),
                                "Access-Control-Expose-Headers": "Dropbox-API-Result"},
                       content_type="application/octet-stream", body=json.dumps(self.bundle))

    def route_upload(self, route):
        req = route.request
        self.bundle = json.loads(req.post_data)
        self.rev = "rev" + str(int(self.rev[3:]) + 1) if self.rev else "rev1"
        self.exists = True
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"rev": self.rev}))

    def install(self, page):
        page.route("https://content.dropboxapi.com/2/files/download", self.route_download)
        page.route("https://content.dropboxapi.com/2/files/upload", self.route_upload)


def open_settings(pg):
    pg.click('[data-action="open-overflow"]')


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    cloud = FakeCloud()
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    ctx.add_init_script(FAKE_CAPACITOR)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    cloud.install(pg)
    pg.goto(url); pg.wait_for_timeout(600)

    # Close the auto-opened intray via its real close action (no faked clock
    # here, unlike settings_surface.py, so its own animation completes fine
    # -- reopened later via data-action="open-tray" for the capture step).
    pg.click('button.icon-btn[data-action="close-tray"]'); pg.wait_for_timeout(300)
    open_settings(pg)
    pg.wait_for_timeout(300)

    check(pg.locator(".settings-menu").count() > 0, "the settings menu actually opened")

    check(pg.locator('[data-action="dropbox-connect"]').count() == 1, "not connected yet: shows Connect Dropbox")
    check(pg.locator('[data-action="dropbox-sync-now"]').count() == 0, "and not the Sync now row yet")

    pg.click('[data-action="dropbox-connect"]')
    pg.wait_for_timeout(600)  # connect() -> setConnected(true) -> runDropboxSync() (first-ever sync, empty cloud)

    check(pg.locator('[data-action="dropbox-sync-now"]').count() == 1, "after connecting: Sync now row appears")
    check(pg.locator('[data-action="dropbox-connect"]').count() == 0, "and Connect Dropbox is gone")
    check(cloud.exists, "connecting triggered a real first sync that actually reached the (fake) cloud")

    status_text = pg.locator('[data-action="dropbox-sync-now"] .si-note').inner_text()
    check("just now" in status_text.lower() or "刚刚" in status_text, f"status label reads as fresh right after syncing ({status_text!r})")

    # ---- staleness bucketing: fake an older last-sync timestamp directly,
    # the same way a real device's clock would just have moved on, and
    # confirm the label actually recomputes rather than being frozen at
    # first-render text. ----
    ninety_min_ago = int(time.time() * 1000) - 90 * 60 * 1000
    pg.evaluate("(t) => localStorage.setItem('gtd_dropbox_last_sync', String(t))", ninety_min_ago)
    # Force a re-render the same way the app itself would on next open: close and reopen the menu.
    pg.click(".menu-scrim", position={"x": 5, "y": 5}); pg.wait_for_timeout(150)
    open_settings(pg); pg.wait_for_timeout(200)
    status_text2 = pg.locator('[data-action="dropbox-sync-now"] .si-note').inner_text()
    check("1 hour" in status_text2 or "1 小时" in status_text2, f"90 minutes later, the label buckets into hours, not minutes ({status_text2!r})")

    # ---- a genuine conflict, driven through a real second sync ----
    # mergeRecordArray only calls something a CONFLICT when both sides moved
    # since a shared baseline (sync.js) -- a brand-new record with no prior
    # sync is always additive, never a conflict, by design. So this needs
    # THREE syncs: one to create the baseline, then diverge both sides from
    # it, then sync again.
    pg.click(".menu-scrim", position={"x": 5, "y": 5}); pg.wait_for_timeout(150)  # close settings to get at the tray input underneath
    pg.click('[data-action="open-tray"]'); pg.wait_for_timeout(300)
    pg.wait_for_selector("#tray-input", timeout=5000)
    pg.fill("#tray-input", "the shared baseline text"); pg.press("#tray-input", "Enter")
    pg.wait_for_timeout(300)
    local_capture_id = pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray'))[0].id")
    pg.click('button.icon-btn[data-action="close-tray"]'); pg.wait_for_timeout(300)

    # Through the real resume trigger (resweepBoundariesOnResume ->
    # runDropboxSync()), NOT window.__oelaDropbox.syncNow() directly -- that
    # raw transport call bypasses app.js's wrapper entirely, including the
    # conflict-log bookkeeping this whole file exists to test. document.hidden
    # is already false on a normal foregrounded test page, so this dispatch
    # takes the resume branch exactly like backgrounding-then-returning would.
    pg.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    pg.wait_for_timeout(600)

    # Diverge LOCAL from the baseline. Storage.setJSON (which would stamp
    # modifiedAt/deviceId) isn't reachable from outside the IIFE, so this
    # stamps by hand -- a controlled test shortcut, not a claim about how a
    # real edit reaches storage.
    pg.evaluate("""(id) => {
        const arr = JSON.parse(localStorage.getItem('gtd_tray'));
        const rec = arr.find(r => r.id === id);
        rec.text = 'edited locally after the baseline';
        rec.modifiedAt = Date.now();
        localStorage.setItem('gtd_tray', JSON.stringify(arr));
    }""", local_capture_id)

    # Diverge REMOTE from the same baseline, with a later modifiedAt so it's
    # the one that should win.
    remote_bundle = dict(cloud.bundle)
    remote_bundle["stores"] = dict(cloud.bundle["stores"])
    remote_bundle["stores"]["gtd_tray"] = [
        {"id": local_capture_id, "text": "edited on the OTHER device",
         "createdAt": 1, "modifiedAt": int(time.time() * 1000) + 60000, "deviceId": "some-other-device"}
    ]
    cloud.bundle = remote_bundle
    cloud.rev = "rev" + str(int(cloud.rev[3:]) + 1)

    pg.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")  # same real trigger as above, not the raw transport call
    pg.wait_for_timeout(600)

    log = pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_dropbox_conflict_log')||'[]')")
    check(len(log) == 1, f"the real sync produced exactly one logged conflict ({log})")
    if log:
        check(log[0]["keptText"] == "edited on the OTHER device", f"logged the WINNING text correctly (newer modifiedAt) ({log[0]})")
        check(log[0]["lostText"] == "edited locally after the baseline", f"and the LOSING (local) text too ({log[0]})")

    open_settings(pg); pg.wait_for_timeout(200)  # tray is already closed (line 153) -- nothing else to dismiss first
    check(pg.locator('[data-action="settings-dropbox-conflicts"]').count() == 1, "the conflict row now shows in the root panel")

    pg.click('[data-action="settings-dropbox-conflicts"]')
    pg.wait_for_timeout(200)
    panel_text = pg.locator(".settings-menu").inner_text()
    check("edited on the OTHER device" in panel_text, "the conflict panel shows what was kept")
    check("edited locally after the baseline" in panel_text, "and what was replaced")

    pg.click('[data-action="settings-root"]')
    pg.wait_for_timeout(150)

    # ---- disconnect actually clears what it should ----
    pg.click('[data-action="dropbox-disconnect"]')
    pg.wait_for_timeout(300)
    check(pg.locator('[data-action="dropbox-connect"]').count() == 1, "after disconnecting: back to showing Connect Dropbox")
    check(pg.evaluate("() => localStorage.getItem('gtd_dropbox_last_sync')") is None, "last-sync timestamp cleared on disconnect")
    check(pg.evaluate("() => localStorage.getItem('gtd_dropbox_conflict_log')") is None, "conflict log cleared on disconnect")

    check(not errs, f"no JS errors across the whole flow ({errs[:5]})")

    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

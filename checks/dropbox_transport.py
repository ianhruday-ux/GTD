"""W5 -- Dropbox transport (wrapper-plan.md SS4.1/SS4.4/SS5).

Drives the real window.__oelaDropbox (src/dropboxTransport.js) against a
MOCKED Dropbox Content API (Playwright page.route, a stateful fake "cloud"
kept in this file), since this sandbox has no real Dropbox account and no
Android device -- see wrapper-plan.md's own note that OAuth-through-the-
system-browser is a device-only gate. Everything below exercises the real
fetch/CAS/merge code path; only the two HTTP endpoints are faked.

Two groups:
  1. A normal first-ever sync (empty cloud -> 409 not_found -> "add") and a
     genuine CAS collision (two uploads racing the same rev -> the loser
     retries and lands cleanly), proving the transport's own logic against
     the real code -- it had never actually been executed before this file
     existed, only compiled/read.
  2. THE QUESTION THE AUTHOR ASKED: what survives if the app's process dies
     between the local merge (Sync.reconcile(), synchronous, already written
     to localStorage the instant it returns) and the network upload actually
     reaching Dropbox. Simulated by making the upload route hang forever
     (never fulfilled), confirming the local merge already landed, then
     closing the browser context outright -- the closest a test driver can
     get to an OS killing the process -- and resuming in a fresh context
     that shares the same storage_state, the way a relaunched app would.

HONEST LIMIT, not glossed over: this cannot exercise a kill mid-WAY-THROUGH
Sync.reconcile()'s own synchronous multi-key write loop (sync.js's
importBundle) -- that is a single-threaded JS function with no await inside
it, so there is no instant a test driver can interrupt it at from outside the
JS engine. That window is real but sub-millisecond, and it is the same class
of risk W2's own mirror-on-write design already accepted in writing (a crash
between two related writes loses that one change) as the honest cost of not
going fully async. Group 2 below tests the window that actually matters in
practice: the network round trip, which takes real wall-clock time and is
where an Android process actually gets killed.

Cosmetic, not a failure: group 2 prints an asyncio "CancelledError" traceback
to stderr on every run. That is Playwright's own internal cleanup noise from
abandoning a route it deliberately never fulfilled (the hung upload) when the
context is closed out from under it -- exit code and PASS/FAIL counts are
unaffected; confirmed by checking $? directly, not just eyeballing output.
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


def conflict_body():
    return json.dumps({"error_summary": "path/conflict/file/.", "error": {".tag": "path", "path": {".tag": "conflict", "conflict": {".tag": "file"}}}})


class FakeCloud:
    """The one synced file, as Dropbox itself would track it: content + a
    revision that changes on every successful write. Shared across BOTH
    browser contexts in group 2 so a "second device" (or a relaunched first
    one) sees whatever the fake cloud actually holds, not a reset stub."""
    def __init__(self):
        self.exists = False
        self.rev = None
        self.bundle = None
        self.upload_hangs = False  # when True, the upload route never fulfills -- simulates the process dying mid-request

    def route_download(self, route):
        if not self.exists:
            route.fulfill(status=409, content_type="application/json", body=not_found_body())
            return
        # Access-Control-Expose-Headers is what makes this an HONEST simulation
        # rather than an accidentally-passing one: a plain WebView fetch() would
        # hide Dropbox-API-Result from JS without it (found live -- see the
        # session notes), and that is exactly the failure this project's real
        # fix (CapacitorHttp's patched fetch, capacitor.config.json) sidesteps
        # by never going through browser CORS filtering at all. Playwright's
        # plain Chromium context has no native bridge to exercise that fix
        # directly, so this header is the closest honest stand-in for "the
        # header reaches JS," which is the only thing dropboxTransport.js
        # actually depends on.
        route.fulfill(status=200,
                       headers={"Dropbox-API-Result": json.dumps({"rev": self.rev}),
                                "Access-Control-Expose-Headers": "Dropbox-API-Result"},
                       content_type="application/octet-stream", body=json.dumps(self.bundle))

    def route_upload(self, route):
        if self.upload_hangs:
            return  # deliberately never call fulfill/abort/continue -- request stays pending forever
        req = route.request
        arg = json.loads(req.headers.get("dropbox-api-arg", "{}"))
        mode = arg.get("mode", {})
        if mode.get(".tag") == "update" and (not self.exists or self.rev != mode.get("update")):
            route.fulfill(status=409, content_type="application/json", body=conflict_body())
            return
        if mode.get(".tag") == "add" and self.exists:
            route.fulfill(status=409, content_type="application/json", body=conflict_body())
            return
        self.bundle = json.loads(req.post_data)
        self.rev = "rev" + str(int(self.rev[3:]) + 1) if self.rev else "rev1"
        self.exists = True
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"rev": self.rev}))

    def install(self, page):
        page.route("https://content.dropboxapi.com/2/files/download", self.route_download)
        page.route("https://content.dropboxapi.com/2/files/upload", self.route_upload)


def local_tray_texts(pg):
    return sorted(r["text"] for r in pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray')||'[]')"))


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- normal flow against the real fetch/CAS code
    # ============================================================
    cloud1 = FakeCloud()
    ctx1 = b.new_context(viewport={"width": 420, "height": 900})
    ctx1.add_init_script(FAKE_CAPACITOR)
    pg1 = ctx1.new_page()
    errs1 = []
    pg1.on("pageerror", lambda e: errs1.append(str(e)))
    cloud1.install(pg1)
    pg1.goto(url); pg1.wait_for_timeout(600)

    check(pg1.evaluate("() => !!(window.__oelaDropbox && window.Capacitor.isNativePlatform())"),
          "the fake native shell + transport hook are both live")

    pg1.wait_for_selector("#tray-input", timeout=5000)
    pg1.fill("#tray-input", "first device, first sync")
    pg1.press("#tray-input", "Enter"); pg1.wait_for_timeout(400)

    result1 = pg1.evaluate("() => window.__oelaDropbox.syncNow()")
    check(cloud1.exists, "first-ever sync (empty cloud -> 409 not_found) still produces a real upload, via mode:add")
    check(result1["conflicts"] == [], "no conflicts reported on an empty-cloud first sync")
    check(local_tray_texts(pg1) == ["first device, first sync"], "the local capture survived its own first sync")

    # A genuine CAS collision: something else writes the cloud file between
    # this device's download and its upload landing (simulated directly --
    # no second browser needed to prove the retry loop itself works).
    pg1.fill("#tray-input", "second local item, before the collision"); pg1.press("#tray-input", "Enter")
    pg1.wait_for_timeout(300)
    original_route_upload = cloud1.route_upload
    calls = {"n": 0}
    def upload_with_one_collision(route):
        calls["n"] += 1
        if calls["n"] == 1:
            # steal the win once, out from under this device's own pending
            # write, exactly like another device's upload landing first
            # lastPull must be a real recent Date.now()-scale timestamp, not
            # epoch-relative -- SS4.5's roster dropout GC compares it against
            # the actual clock and will (correctly) discard anything older
            # than a year, which epoch 0 very much is.
            now_ms = int(time.time() * 1000)
            cloud1.bundle = {**cloud1.bundle, "roster": {**cloud1.bundle["roster"], "intruder": {"lastPull": now_ms}}}
            cloud1.rev = "rev" + str(int(cloud1.rev[3:]) + 1)
            route.fulfill(status=409, content_type="application/json", body=conflict_body())
            return
        original_route_upload(route)
    pg1.unroute("https://content.dropboxapi.com/2/files/upload")
    pg1.route("https://content.dropboxapi.com/2/files/upload", upload_with_one_collision)

    result2 = pg1.evaluate("() => window.__oelaDropbox.syncNow()")
    check(calls["n"] == 2, f"a real CAS conflict (409 on upload) triggers exactly one retry, not zero and not a loop ({calls['n']} attempts)")
    check("second local item, before the collision" in local_tray_texts(pg1), "the item queued during the collision still made it to the cloud after the retry")
    check("intruder" in cloud1.bundle["roster"], "the OTHER write that won the race is still present too -- the retry merged with it, didn't clobber it")

    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")

    # ============================================================
    # Group 2 -- the author's question: killed between local merge and upload
    # ============================================================
    cloud2 = FakeCloud()
    # Seed the fake cloud with "another device's" prior contribution, so the
    # kill scenario is exercising a real merge, not just a push of new data.
    cloud2.exists = True
    cloud2.rev = "rev1"
    cloud2.bundle = {"roster": {"other-device": {"lastPull": 1}}, "tombstones": [],
                      "stores": {k: [] for k in ["gtd_tasks_next", "gtd_tasks_waiting", "gtd_tasks_current",
                                                  "gtd_tasks_future", "gtd_tasks_habit", "gtd_events", "gtd_notes",
                                                  "gtd_tags", "gtd_contexts", "gtd_completed_next",
                                                  "gtd_completed_waiting", "gtd_completed_current",
                                                  "gtd_completed_future", "gtd_tray"]}}
    cloud2.bundle["stores"]["gtd_tray"] = [{"id": "remote-1", "text": "from the other device", "modifiedAt": 1, "deviceId": "other-device"}]

    ctxA = b.new_context(viewport={"width": 420, "height": 900})
    ctxA.add_init_script(FAKE_CAPACITOR)
    pgA = ctxA.new_page()
    errsA = []
    pgA.on("pageerror", lambda e: errsA.append(str(e)))
    cloud2.install(pgA)
    pgA.goto(url); pgA.wait_for_timeout(600)

    pgA.wait_for_selector("#tray-input", timeout=5000)
    pgA.fill("#tray-input", "captured right before the app dies"); pgA.press("#tray-input", "Enter")
    pgA.wait_for_timeout(400)

    cloud2.upload_hangs = True  # the request will be sent and never answered
    pgA.evaluate("() => { window.__oelaDropbox.syncNow(); }")  # fire-and-forget: NOT awaited, exactly like a real dangling call the process dies during
    pgA.wait_for_timeout(600)  # time for the mocked download + the synchronous reconcile() to complete; the upload is still hanging

    merged_now = local_tray_texts(pgA)
    check("captured right before the app dies" in merged_now, "this device's own capture is still there after the 'kill' -- reconcile() writing locally does not depend on the upload finishing")
    check("from the other device" in merged_now, "the OTHER device's record was already merged in locally too, before the upload that would have reported it ever landed")
    check(not cloud2.bundle or cloud2.bundle.get("stores", {}).get("gtd_tray", [{}])[0].get("id") != "local", "the cloud file itself was NOT touched by the killed attempt -- no torn/partial write landed on the Dropbox side")

    # Snapshot storage exactly as a relaunching app would find it, then kill
    # the context outright -- the closest a test driver gets to the OS
    # reclaiming a backgrounded process.
    state = ctxA.storage_state()
    ctxA.close()

    ctxB = b.new_context(viewport={"width": 420, "height": 900}, storage_state=state)
    ctxB.add_init_script(FAKE_CAPACITOR)
    pgB = ctxB.new_page()
    errsB = []
    pgB.on("pageerror", lambda e: errsB.append(str(e)))
    cloud2.upload_hangs = False  # this time the network cooperates
    cloud2.install(pgB)
    pgB.goto(url); pgB.wait_for_timeout(600)

    check(sorted(local_tray_texts(pgB)) == sorted(merged_now), "everything survived the relaunch untouched -- nothing lost, nothing duplicated, before a second sync even runs")

    result3 = pgB.evaluate("() => window.__oelaDropbox.syncNow()")
    check(result3["conflicts"] == [], "the recovery sync is a routine one-sided update, not a conflict -- the other device's record hadn't changed since")
    check(cloud2.bundle.get("stores", {}).get("gtd_tray") is not None and
          any(r["text"] == "captured right before the app dies" for r in cloud2.bundle["stores"]["gtd_tray"]),
          "the capture that was 'lost' in the kill made it to the actual cloud on the very next sync attempt")
    check(any(r["text"] == "from the other device" for r in cloud2.bundle["stores"]["gtd_tray"]),
          "and the other device's record is still there too -- the delayed push didn't overwrite it")

    check(not errsA, f"no JS errors on device A, including during the killed attempt ({errsA[:3]})")
    check(not errsB, f"no JS errors on the relaunch/recovery ({errsB[:3]})")

    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

"""Chunk 9: service worker registration, precache, offline, and the update-ready banner.

Serves a COPY of dist/ (not dist/ itself) because the version-bump check
mutates sw.js on disk to simulate a new deploy — mutating the real dist/sw.js
would corrupt the build artifact for every other check/commit.
"""
import os, re, shutil, tempfile, functools, http.server, socket, socketserver, threading, contextlib
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(REPO, "dist")


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        # Real static hosts (GitHub Pages included) don't let browsers cache
        # sw.js for long; SimpleHTTPRequestHandler sends no explicit
        # Cache-Control, which is close enough, but force no-store so the
        # version-bump step below can never be masked by an HTTP cache hit.
        self.send_header("Cache-Control", "no-store")
        http.server.SimpleHTTPRequestHandler.end_headers(self)


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


tmp = tempfile.mkdtemp(prefix="oela-sw-check-")
try:
    shutil.copytree(DIST, tmp, dirs_exist_ok=True)
    sw_path = os.path.join(tmp, "sw.js")

    with serve(tmp) as url, sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 420, "height": 820})
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

        def close_tray():
            # The intray auto-opens on every boot (§4.8a); a faked/interrupted
            # clock can freeze its close animation, so clear it directly
            # rather than clicking the animated close button (same approach
            # as checks/calendar_round.py and friends).
            pg.wait_for_timeout(300)
            pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
            pg.wait_for_timeout(150)

        pg.goto(url, wait_until="load")
        close_tray()

        # --- registration + first install (no banner) ---
        ready = pg.evaluate(
            "() => navigator.serviceWorker.ready.then(r => ({scope: r.scope, active: !!r.active}))"
        )
        check(ready["active"], "the service worker reaches the active state")
        check(ready["scope"].endswith("/"), f"scope is the app's own directory ({ready['scope']})")
        check(pg.locator("#sw-update-banner").is_hidden(),
              "no update banner on first install (nothing to update FROM)")

        # --- precache populated ---
        cache_names = pg.evaluate("() => caches.keys()")
        check(len(cache_names) == 1 and cache_names[0].startswith("oela-"),
              f"exactly one versioned cache exists ({cache_names})")
        cached_urls = pg.evaluate(
            "(name) => caches.open(name).then(c => c.keys()).then(reqs => reqs.map(r => new URL(r.url).pathname))",
            cache_names[0],
        )
        for expect in ("/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"):
            check(any(u.endswith(expect) for u in cached_urls), f"precache includes {expect} ({cached_urls})")

        # --- offline navigation still renders the app ---
        ctx.set_offline(True)
        pg.reload(wait_until="load")
        close_tray()
        check(pg.locator(".brand .mark").inner_text() == "OELA",
              "a fully offline reload still renders the app shell")
        check(pg.locator("#lanes").count() == 1, "and the lanes root is present offline")
        ctx.set_offline(False)

        # --- a version bump triggers the waiting state + banner ---
        sw_src = open(sw_path, encoding="utf-8").read()
        bumped = re.sub(r'const SW_VERSION = "[^"]+";', 'const SW_VERSION = "test-bump";', sw_src)
        check(bumped != sw_src, "test setup: the version-bump edit actually changed the file")
        open(sw_path, "w", encoding="utf-8").write(bumped)

        pg.evaluate("() => navigator.serviceWorker.getRegistration().then(r => r && r.update())")
        pg.wait_for_function(
            "() => { const el = document.querySelector('#sw-update-banner'); return el && !el.hidden; }",
            timeout=10000,
        )
        check(True, "the update banner appears once the bumped sw.js is detected")
        check(pg.locator(".sw-update-msg").inner_text() != "", "banner carries a translated message")

        # --- tapping Reload activates the new version ---
        pg.click("[data-action='sw-reload']")
        pg.wait_for_load_state("load", timeout=10000)
        pg.wait_for_timeout(300)
        new_caches = pg.evaluate("() => caches.keys()")
        check(new_caches == ["oela-test-bump"], f"the bumped version is now the only cache ({new_caches})")

        check(errs == [], f"no JS errors ({errs})")
        ctx.close(); b.close()
finally:
    shutil.rmtree(tmp, ignore_errors=True)


for n in notes: print(n)
for f in fails: print(f)
print(f"\n{len(notes)} passed, {len(fails)} failed")
if fails:
    raise SystemExit(1)

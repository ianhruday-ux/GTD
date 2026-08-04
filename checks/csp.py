"""The Content-Security-Policy: that it is THERE, that it is CORRECT, and that
it does not quietly break the app.

Three failure modes, and the middle one is why this file exists at all:

  1. The policy is missing or weakened (someone adds 'unsafe-inline' to
     script-src to make a stubborn thing work, and the whole point evaporates).
  2. THE HASH IS WRONG. script-src names a sha256 of the stapled script, so a
     one-newline change in src/index.html's template — or any edit to how
     build.py assembles the bundle — blocks the app's ONLY script. The app then
     serves a perfectly valid, completely blank page, on every platform at once,
     with nothing in the UI to say why. This is the expensive one, and it is
     caught here by asserting on a RENDERED card (protocol 1): if the card is on
     screen, the script ran, so the hash matched.
  3. The policy is right but too tight, and some legitimate resource — the
     inlined base64 fonts, the canvas-generated desk textures, the manifest, the
     service worker, the export download — is blocked. Caught by listening for
     securitypolicyviolation during a normal boot and asserting the list is
     empty, which is a much better assertion than checking each resource by
     hand: it catches the resource nobody thought to enumerate.

Then the security property itself: an <img src=… onerror=…> that reaches the DOM
as markup does NOT execute. That is the class of bug the escaping round closed at
100 sinks (ae8a99f); this asserts the backstop holds at sink 101.

Run on Black lacquer (protocol 3) deliberately: it is the only surface with
frame: true, so it generates BOTH the canvas desk texture and the frame canvas —
the two data: image sources that img-src has to allow.
"""
import contextlib, functools, http.server, json, os, socket, socketserver, threading
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(REPO, "dist")


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


# Collect violations from the very first parsed byte, and force lacquer before
# boot so the textures are generated during the window we are watching.
INIT = """
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', function(e){
  window.__cspViolations.push(e.violatedDirective + ' <- ' + (e.blockedURI || '(inline)'));
});
try { localStorage.setItem('gtd_surface', 'lacquer'); } catch (e) {}
"""


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 420, "height": 900}, accept_downloads=True)
    pg = ctx.new_page()
    pg.add_init_script(INIT)
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(1200)

    # ---- 1. the policy is present and is not a fig leaf ---------------------
    policy = pg.evaluate(
        "() => { const m = document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]');"
        "        return m ? m.getAttribute('content') : ''; }")
    check(bool(policy), "the CSP meta tag is present in the built app")

    script_src = ""
    for part in policy.split(";"):
        if part.strip().startswith("script-src"):
            script_src = part.strip()
    check("sha256-" in script_src, f"script-src names a sha256 hash ({script_src[:48] or 'MISSING'}…)")
    check(bool(script_src) and "unsafe-inline" not in script_src,
          "script-src does NOT carry 'unsafe-inline' (CSP3 would ignore the hash beside it)")
    check(bool(script_src) and "unsafe-eval" not in script_src,
          "script-src does NOT carry 'unsafe-eval'")
    check("object-src" in policy or "default-src 'none'" in policy,
          "plugins/objects are denied (default-src 'none' or an explicit object-src)")

    # ---- 2. the hash is RIGHT: the app actually ran -------------------------
    # A blank page would satisfy every assertion above. This is the one that
    # separates "the policy exists" from "the policy let the app boot".
    # ⚠ Guarded, and the guard is the point (protocol 2a). A wrong hash means
    # NOTHING below responds — every locator would hit its 30s timeout and the
    # file would die on an exception, reporting nothing, which looks like
    # evidence and is not. A blocked script has to come out as a legible FAIL.
    booted = pg.evaluate("() => { const l = document.getElementById('lanes');"
                         "        return !!(l && l.children.length); }")
    check(booted, "the stapled script EXECUTED — so the sha256 in script-src matches it")

    rendered = False
    if booted:
        try:
            # The intray auto-opens on every boot (§4.8a) and its scrim intercepts
            # the FAB; clear it directly rather than clicking the animated close
            # button (checks/README.md, "Two notes for whoever edits these").
            pg.evaluate("() => { const t = document.getElementById('tray-root'); if (t) t.innerHTML = ''; }")
            pg.wait_for_timeout(200)

            pg.click('[data-action="fab"]', timeout=5000); pg.wait_for_timeout(400)
            pg.click('[data-action="new-primary"]', timeout=5000); pg.wait_for_timeout(500)
            pg.fill('[data-field="title"]', "CSP smoke test action", timeout=5000)
            pg.click('[data-action="screen-save"]', timeout=5000); pg.wait_for_timeout(700)
            rendered = pg.evaluate(
                "() => document.body.innerText.includes('CSP smoke test action')")
        except Exception as e:
            notes.append(f"      (create-an-action path threw: {str(e).splitlines()[0][:90]})")
    check(rendered, "the app rendered a created action under the policy — end to end")

    # ---- 3. nothing legitimate was blocked ---------------------------------
    boot_violations = pg.evaluate("() => window.__cspViolations.slice()")
    check(not boot_violations,
          f"a normal boot on lacquer raises ZERO policy violations ({boot_violations or 'none'})")

    fonts_ok = pg.evaluate("() => document.fonts && document.fonts.size > 0")
    check(bool(fonts_ok), "the inlined data: webfonts loaded under font-src")

    sw_ok = pg.evaluate("async () => { if (!navigator.serviceWorker) return false;"
                        " const r = await navigator.serviceWorker.getRegistration(); return !!r; }")
    check(bool(sw_ok), "the service worker still registers under worker-src 'self'")

    # ---- 4. the security property ------------------------------------------
    pg.evaluate("() => { window.__cspViolations.length = 0; window.__pwned = false; }")
    pg.evaluate("""() => {
        const d = document.createElement('div');
        // Exactly the shape an imported note or a synced record could carry.
        d.innerHTML = '<img src=\"definitely-not-here.png\" onerror=\"window.__pwned = true\">';
        document.body.appendChild(d);
    }""")
    pg.wait_for_timeout(800)

    pwned = pg.evaluate("() => window.__pwned === true")
    check(not pwned, "an injected <img onerror> does NOT execute (the backstop holds)")

    blocked = pg.evaluate("() => window.__cspViolations.slice()")
    check(any("script-src" in v for v in blocked),
          f"…and the block was REPORTED as a script-src violation ({blocked or 'nothing reported'})")

    # ---- 5. default-src 'none' did not break the export --------------------
    # The export builds a Blob and clicks an object URL. Downloads are not
    # governed by the fetch directives, but that is a claim worth testing rather
    # than believing, since a broken backup is silent until you need it.
    pg.evaluate("() => window.__cspViolations.length = 0")
    payload, export_violations = None, ["(not reached)"]
    if booted:                       # same guard: no app, no menu, no exception
        try:
            pg.click('[data-action="open-overflow"]', timeout=5000); pg.wait_for_timeout(400)
            with pg.expect_download() as dl:
                pg.locator('[data-action="export-data"]').first.click(timeout=5000)
            payload = json.loads(open(dl.value.path(), encoding="utf-8").read())
            export_violations = pg.evaluate("() => window.__cspViolations.slice()")
        except Exception as e:
            notes.append(f"      (export path threw: {str(e).splitlines()[0][:90]})")
    check(isinstance(payload, dict) and bool(payload),
          f"the backup export still produces a readable file ({len(payload or {})} keys)")
    check(not export_violations, f"…and downloading it raised no policy violation ({export_violations or 'none'})")

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

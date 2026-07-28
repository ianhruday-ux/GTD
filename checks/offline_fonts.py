"""The app renders in its own fonts with NO network at all.

The three families used to load from fonts.googleapis.com. dist/index.html was
self-contained in every other respect, so that one <link> was the whole gap
between the app and its central promise — "fully functional with zero setup,
zero server" (CLAUDE.md). On a cold cache with no connection every surface fell
back to system fonts. Found in the wrapper audit (wrapper-plan.md §3.5); it was
a browser-build bug, not a wrapper one.

This guards the fix in the way that actually matters: **every off-origin request
is aborted**, so if a CDN <link> ever comes back, the fonts stop resolving and
this fails. Asserting "no such URL in the HTML" would be weaker — it would pass
for a stylesheet pulled in by script, or an @import nested in the CSS.

The last check is the one with teeth: it measures rendered text width against a
deliberately bogus family. Identical widths mean the browser silently fell back
to a system font, which is exactly the failure this file exists to catch and is
invisible to any assertion about document.fonts alone.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
FAMILIES = ["Inter", "Space Grotesk", "IBM Plex Mono"]


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
        yield f"http://127.0.0.1:{port}/index.html", port
    finally:
        httpd.shutdown(); httpd.server_close()


fails, notes = [], []
def check(cond, msg):
    (notes if cond else fails).append(("PASS " if cond else "FAIL ") + msg)


with serve(DIST) as (url, port), sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs, offsite = [], []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)

    # Hard offline: anything not served by our own loopback origin is killed.
    def gate(route):
        if f"127.0.0.1:{port}" in route.request.url:
            route.continue_()
        else:
            offsite.append(route.request.url)
            route.abort()

    pg.route("**/*", gate)
    pg.goto(url); pg.wait_for_timeout(1400)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    check(not offsite, f"the app made no off-origin request at all ({offsite[:3]})")
    check(pg.locator(".lane").count() >= 1, "and it booted")

    # Every declared face resolved from the inlined data URI.
    faces = pg.evaluate("""() => [...document.fonts].map(f =>
        ({ family: f.family, weight: f.weight, status: f.status }))""")
    for fam in FAMILIES:
        mine = [f for f in faces if f["family"] == fam]
        check(len(mine) >= 1, f"{fam} is declared ({len(mine)} face(s))")
        check(all(f["status"] == "loaded" for f in mine),
              f"{fam} loaded with no network ({[f['status'] for f in mine]})")

    check(all("data:" in s for s in pg.evaluate(
              """() => [...document.styleSheets]
                   .flatMap(ss => { try { return [...ss.cssRules]; } catch(e){ return []; } })
                   .filter(r => r.constructor.name === 'CSSFontFaceRule')
                   .map(r => r.style.getPropertyValue('src'))""")),
          "every @font-face src is an inlined data: URI")

    # The one with teeth: real metrics, not just a declaration.
    widths = pg.evaluate("""(fams) => {
      const probe = document.createElement('span');
      probe.textContent = 'Handgloves 0123456789 — the quick brown fox';
      probe.style.cssText = 'position:absolute;left:-9999px;font-size:32px;white-space:pre;';
      document.body.appendChild(probe);
      const out = {};
      probe.style.fontFamily = 'ZZNoSuchFaceAnywhere';
      out.fallback = probe.getBoundingClientRect().width;
      fams.forEach(f => {
        probe.style.fontFamily = "'" + f + "', ZZNoSuchFaceAnywhere";
        out[f] = probe.getBoundingClientRect().width;
      });
      probe.remove();
      return out;
    }""", FAMILIES)
    for fam in FAMILIES:
        check(abs(widths[fam] - widths["fallback"]) > 1.0,
              f"{fam} actually renders its own glyphs, not a fallback "
              f"({widths[fam]:.1f}px vs fallback {widths['fallback']:.1f}px)")

    # The families are genuinely the ones the design asks for.
    used = pg.evaluate("""() => {
      const g = getComputedStyle(document.documentElement);
      return { display: g.getPropertyValue('--font-display').trim(),
               body: g.getPropertyValue('--font-body').trim(),
               mono: g.getPropertyValue('--font-mono').trim() };
    }""")
    check("Space Grotesk" in used["display"] and "Inter" in used["body"]
          and "IBM Plex Mono" in used["mono"],
          f"the design tokens still point at the vendored families ({used})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

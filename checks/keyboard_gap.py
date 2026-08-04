"""The drafting page must cover the strip it vacates when the keyboard opens.

THE BUG THIS GUARDS (device round, 2026-08-04, filmed on a Galaxy S25 and
reproduced here at 10x slow motion): Android resizes the layout viewport for the
on-screen keyboard BEFORE the keyboard is composited. For ~60ms the overlay has
already shrunk to --vv-height and nothing covers the strip it just gave up, so
the lanes behind show through and the drafting page reads as half-disappeared.

WHAT THIS FILE CAN AND CANNOT TEST. It cannot test the OS's ordering — there is
no virtual keyboard in Playwright, which is exactly why this went unseen for
seventeen days and needed a video to find (see the standing note in
memory/pending-notes-ux-feedback: a keyboard-viewport bug is invisible to this
suite). What it CAN test is the invariant that makes the gap harmless: whenever
the overlay is shorter than the viewport, the space below it still belongs to
the drafting page. That is asserted directly, by shrinking --vv-height the way
the keyboard would and asking the DOM what is actually on screen at a point
inside the gap.

So: this proves the fix is present and load-bearing. It does not prove the flash
is gone — only the device does that, and it was re-checked there.
"""
import contextlib, functools, http.server, json, os, re, socket, socketserver, threading
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(REPO, "dist")

KEYBOARD_H = 420          # the shrunken visible area, roughly a phone with the keyboard up
VIEWPORT_H = 900


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


# ---------------------------------------------------------------------------
# The two NATIVE declarations of the gap colour must agree with each other, and
# must be a colour the app actually uses.
#
# ⚠ THIS ASSERTION WAS WRONG FIRST TIME and the correction is the interesting
# part. It compared the native colour against `--desk` read from the built CSS,
# which looks right and is not: `:root{--desk}` is only a FALLBACK. surface.js
# sets --desk per surface at runtime (lacquer 0a0908, dark wood 2c160d, rosewood
# 6d3210, slate 15161A), so the value in the stylesheet is one no user ever sees.
# The check passed against a colour that never renders — green, and meaningless.
#
# What is actually true: the CSS filler needs no guard at all, because it
# inherits from the overlay and therefore tracks the live surface for free (the
# ::after assertions below prove that). The native side CANNOT track it — a theme
# resource is fixed at build time — so the honest invariants are narrower: the
# two native files agree with each other, and the value they name is one of the
# app's real surface colours rather than something invented.
SURFACE_DESKS = None
def colour_sources():
    global SURFACE_DESKS
    out = {}
    try:
        html = open(os.path.join(DIST, "index.html"), encoding="utf-8").read()
        SURFACE_DESKS = {m.lower() for m in re.findall(r"desk:\s*\"(#[0-9a-fA-F]{6})\"", html)}
    except Exception:
        SURFACE_DESKS = set()
    try:
        xml = open(os.path.join(REPO, "wrapper", "android", "app", "src", "main",
                                "res", "values", "colors.xml"), encoding="utf-8").read()
        m = re.search(r'name="oela_window_gap"\s*>\s*(#[0-9a-fA-F]{3,8})', xml)
        out["android colors.xml"] = m.group(1) if m else None
    except Exception as e:
        out["android colors.xml"] = f"unreadable: {e}"
    try:
        cfg = json.load(open(os.path.join(REPO, "wrapper", "capacitor.config.json"), encoding="utf-8"))
        out["capacitor.config.json"] = cfg.get("backgroundColor")
    except Exception as e:
        out["capacitor.config.json"] = f"unreadable: {e}"
    return out


cols = colour_sources()
missing = [k for k, v in cols.items() if not v or not str(v).startswith("#")]
check(not missing, f"both native files declare the gap colour ({missing or 'found in both'})")
if not missing:
    vals = {str(v).lower() for v in cols.values()}
    check(len(vals) == 1,
          "the Android window and the Capacitor WebView agree on the gap colour "
          + ("(" + list(vals)[0] + ")" if len(vals) == 1
             else "-- THEY DIVERGE: " + ", ".join(f"{k}={v}" for k, v in cols.items())))
    check(bool(SURFACE_DESKS) and vals <= SURFACE_DESKS,
          f"…and it is one of the app's real surface colours ({sorted(SURFACE_DESKS) or 'none parsed'})")


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    # Black lacquer (protocol 3): the only surface with frame:true, so if the
    # filler ever interacted with --frame-inset this is where it would show.
    ctx = b.new_context(viewport={"width": 420, "height": VIEWPORT_H})
    pg = ctx.new_page()
    pg.add_init_script("try{localStorage.setItem('gtd_surface','lacquer');}catch(e){}")
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(1200)
    pg.evaluate("() => { const t = document.getElementById('tray-root'); if (t) t.innerHTML=''; }")
    pg.wait_for_timeout(200)

    opened = False
    try:
        pg.click('[data-action="fab"]', timeout=5000); pg.wait_for_timeout(400)
        pg.click('[data-action="new-primary"]', timeout=5000); pg.wait_for_timeout(600)
        opened = pg.locator(".screen-overlay").count() > 0
    except Exception as e:
        notes.append(f"      (could not open a drafting page: {str(e).splitlines()[0][:90]})")
    check(opened, "a drafting page is open over the lanes")

    if opened:
        # Simulate the keyboard exactly as the app's own JS would: shrink the
        # variable the overlay is sized from. The bug is a paint-ordering race,
        # but the STATE it passes through is this one, and it is reachable here.
        pg.evaluate(f"() => document.documentElement.style.setProperty('--vv-height', '{KEYBOARD_H}px')")
        pg.wait_for_timeout(300)

        box = pg.locator(".screen-overlay").bounding_box() or {}
        h = round(box.get("height", 0))
        check(abs(h - KEYBOARD_H) <= 2,
              f"the overlay shrank to the keyboard-visible height ({h}px, expected ~{KEYBOARD_H})")

        # THE ASSERTION. A point well inside the vacated strip: what is on screen?
        probe_y = KEYBOARD_H + 160
        who = pg.evaluate("""(y) => {
            const el = document.elementFromPoint(Math.round(window.innerWidth / 2), y);
            if (!el) return "(nothing)";
            const overlay = el.closest(".screen-overlay");
            return overlay ? "screen-overlay" : (el.className || el.tagName || "?").toString().slice(0, 60);
        }""", probe_y)
        check(who == "screen-overlay",
              f"{probe_y}px down — inside the gap — still belongs to the drafting page (got: {who})")

        # ...and it is actually painted, not merely hit-testable.
        painted = pg.evaluate("""() => {
            const o = document.querySelector(".screen-overlay");
            const a = getComputedStyle(o, "::after");
            return { img: a.backgroundImage, h: a.height, top: a.top };
        }""")
        check(painted.get("img", "none") != "none",
              f"the filler carries the page's own surface rather than a flat block ({str(painted.get('img'))[:44]}…)")
        check(painted.get("h") not in (None, "auto", "0px"),
              f"the filler has real height ({painted.get('h')})")

        # Nothing belonging to the LANES may be reachable there. Stated separately
        # from the probe above because it is the actual user harm: touching the
        # page behind an open modal.
        #
        # ⚠ This asked `.card` first and PASSED on the unfixed build, because the
        # probe happened to land on a group body rather than a card — a check
        # satisfied by where the fixture put a card, which is protocol 2c's
        # "assert on identity, not on a coincidence". Widened to the lane
        # container, which is what the claim was always about.
        leaked = pg.evaluate("""(y) => {
            const el = document.elementFromPoint(Math.round(window.innerWidth / 2), y);
            if (!el) return null;
            return el.closest("#lanes") ? (el.className || el.tagName).toString().slice(0, 40) : null;
        }""", probe_y)
        check(leaked is None, f"nothing from the lanes is reachable through the gap (got: {leaked})")

        # Restore, and confirm the filler stays out of the way at full height:
        # it must sit entirely below the fold when nothing has shrunk.
        pg.evaluate("() => document.documentElement.style.removeProperty('--vv-height')")
        pg.wait_for_timeout(300)
        below = pg.evaluate("""() => {
            const o = document.querySelector(".screen-overlay");
            return Math.round(o.getBoundingClientRect().bottom) >= window.innerHeight - 2;
        }""")
        check(below, "with no keyboard the overlay fills the viewport, so the filler is off-screen")

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

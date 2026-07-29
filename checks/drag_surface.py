"""Press-and-hold drags from the whole card — but not from its real controls.

User, after the first device test of the wrapper: "the pills should probably be
considered part of the card. Right now, I can tap and hold the 'After X action'
pill, and it won't drag the card."

The old rule was literally `.card-title`, so the cue pill, the stalled flag and
the deadline bar were inert to press-and-hold — a hold there did nothing at all,
which is worse than doing the obvious thing.

⚠ THE LINE IS NOT "IS IT A BUTTON". The cue pill IS a <button>, and it must drag;
its data-id is this same card and it opens this same page, so it is a second tap
target for the title and should be a second drag target too. What must keep its
own gesture is the short list of controls that act on something ELSE — the
checkbox completes, the promote arrow moves lanes, the project jump navigates to
a different item. That distinction is what this file pins down, in both
directions, because getting it wrong in either is invisible until you use it:
a card you cannot drag, or a checkbox you cannot tick.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys
from playwright.sync_api import sync_playwright

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


TOUCH = """([sel, x, y, type]) => {
  const el = document.querySelector(sel);
  if (!el) return 'NO ELEMENT ' + sel;
  const t = new Touch({ identifier: 9, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
  const list = type === 'touchend' ? [] : [t];
  el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
    touches: list, targetTouches: list, changedTouches: [t] }));
  return 'ok';
}"""

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}, has_touch=True).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1200)

    # A waiting action with a free-text cue renders the "waiting for …" pill.
    pg.evaluate("""() => {
      localStorage.setItem('gtd_tasks_waiting', JSON.stringify([
        { id: 'zzw1', title: 'ZZ first waiter', notesClean: '', parent: null,
          whenText: 'Bob replies', conditionId: null },
        { id: 'zzw2', title: 'ZZ second waiter', notesClean: '', parent: null,
          whenText: 'the parcel arrives', conditionId: null }
      ]));
      localStorage.setItem('gtd_tasks_next', '[]');
    }""")
    pg.reload(); pg.wait_for_timeout(1300)
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML=''; }")
    pg.evaluate("""() => { const t = document.querySelector('.tab[data-kind="waiting"]'); if (t) t.click(); }""")
    pg.wait_for_timeout(400)

    check(pg.locator('.lane[data-kind="waiting"] .link-pill').count() >= 1,
          "the waiting cards render their cue pills")

    def hold(sel):
        """Press and hold on sel; report whether a drag armed."""
        box = pg.locator(sel).first.bounding_box()
        if not box:
            return None
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        pg.evaluate(TOUCH, [sel, x, y, "touchstart"])
        pg.wait_for_timeout(560)                     # past TOUCH_LONG_PRESS_MS (400)
        armed = pg.locator(".card.dragging, .group.dragging").count() > 0
        pg.evaluate(TOUCH, [sel, x, y, "touchend"])
        pg.wait_for_timeout(350)
        return armed

    W = '.lane[data-kind="waiting"] '

    # ---------- what MUST drag ----------
    check(hold(W + '.card-title') is True, "the title still starts a drag")
    check(hold(W + '.link-pill') is True,
          "and so does the cue pill — the change the user asked for")

    # ---------- what must NOT ----------
    check(hold(W + '.promote-arrow') is False,
          "the promote arrow does NOT drag — it moves the item to another lane")

    # ---------- and the pill's own tap still works ----------
    pg.evaluate("""() => { const d = document.querySelector('#screen-root'); if (d) d.innerHTML=''; }""")
    pg.locator(W + '.link-pill').first.click()
    pg.wait_for_timeout(600)
    opened = pg.evaluate("""() => { const b = document.querySelector('.screen-kind-badge');
                                    return b ? b.textContent.trim() : null; }""")
    check(opened is not None,
          f"a short tap on the pill still opens the card, drag or no drag ({opened!r})")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    # ---------- the checkbox keeps its tap ----------
    # Checked separately from `hold`, because what matters is not merely that no
    # drag armed but that the tap still COMPLETES the item.
    pg.evaluate("""() => { const d = document.querySelector('#screen-root'); if (d) d.innerHTML=''; }""")
    pg.evaluate("""() => {
      localStorage.setItem('gtd_tasks_next', JSON.stringify(
        [{ id: 'zzn', title: 'ZZ tickable', notesClean: '', parent: null }]));
      localStorage.setItem('gtd_completed_next', '[]');
    }""")
    pg.reload(); pg.wait_for_timeout(1300)
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML=''; }")
    check(hold('.lane[data-kind="next"] .check') is False,
          "the checkbox does NOT drag")
    pg.locator('.lane[data-kind="next"] .check').first.click()
    pg.wait_for_timeout(700)
    check(pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_completed_next') || '[]').length""") == 1,
          "and tapping it still completes the item")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

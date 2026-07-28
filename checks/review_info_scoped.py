"""§3 (review-surface-plan.md): the review's ⓘ is scoped to the ONE card
revealed on screen, not a dump of every kind at once.

Covers:
  - the default seed's first card (the stalled sample project) shows only
    the stalled-project text, not the lane-sorting block or any other kind's
    deciding paragraph;
  - a capture card shows the lane-sorting block instead;
  - the panel's open/closed state PERSISTS across a card-resolving decision
    (builder's call, §3 trap — persisting is the friendlier read);
  - the ⓘ disappears entirely once the queue is empty (all-deferred).
"""
import os, functools, http.server, socketserver, socket, threading, contextlib, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 860}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)

    def dismiss_tray():
        pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")

    def open_review():
        dismiss_tray()
        pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
        pg.wait_for_timeout(300)
        pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
        pg.wait_for_timeout(500)

    def info_text():
        return pg.evaluate("""() => { const p = document.querySelector('.review-info-panel');
          return p ? p.textContent : null; }""")

    def info_hidden():
        return pg.evaluate("""() => { const p = document.querySelector('.review-info-panel');
          return p ? p.hidden : 'no-panel'; }""")

    def has_info_button():
        return pg.evaluate("""() => !!document.querySelector('[data-action=\"review-info\"]')""")

    def click_info():
        pg.evaluate("() => document.querySelector('[data-action=\"review-info\"]').click()")
        pg.wait_for_timeout(250)

    # ---------- the default queue's first card (stalled sample) ----------
    open_review()
    cls = pg.evaluate("() => { const c = document.querySelector('.review-card'); return c ? c.className : ''; }")
    check("review-card-stalled" in cls, f"fixture: first card is the stalled sample ({cls})")
    check(has_info_button(), "the ⓘ is present while a card is on screen")
    click_info()
    panel = info_text()
    check("no way forward. Add the next physical step" in panel, "stalled text shown")
    check("single next physical step" not in panel, "NOT the lane-sorting block")
    check("recurring place or time" not in panel, "NOT a lane-only paragraph")

    # ---------- add a capture; it jumps ahead of the stalled sample ----------
    pg.evaluate("""() => { const c = document.querySelector('[data-action=\"review-close\"]'); if (c) c.click(); }""")
    pg.wait_for_timeout(300)
    dismiss_tray()
    pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => { const i = document.querySelector('#tray-input'); i.value = 'ZZ scoped-info capture'; }""")
    pg.evaluate("() => document.querySelector('[data-action=\"tray-add\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
    pg.wait_for_timeout(500)
    cls = pg.evaluate("() => { const c = document.querySelector('.review-card'); return c ? c.className : ''; }")
    check("review-card-capture" in cls, f"the fresh capture is now revealed first ({cls})")
    check(info_hidden() in (True, "no-panel"),
          "info panel starts CLOSED on a freshly opened review")
    click_info()
    panel = info_text()
    check("single next physical step" in panel, "capture card shows the lane-sorting block")
    check("no way forward" not in panel, "NOT the stalled card's text, even though it's next in queue")

    # ---------- persistence across a resolving decision (builder's call) ----------
    # "Sort into Next" opens the full next-action page (prefilled), pushing the
    # review onto the screen stack; saving it pops back to the review with the
    # capture resolved out of the queue.
    pg.evaluate("""() => { const b = document.querySelector('[data-action=\"review-sort\"][data-target=\"next\"]');
      if (b) b.click(); }""")
    pg.wait_for_timeout(400)
    pg.evaluate("""() => { const b = document.querySelector('[data-action=\"screen-save\"]'); if (b) b.click(); }""")
    pg.wait_for_timeout(500)
    cls = pg.evaluate("() => { const c = document.querySelector('.review-card'); return c ? c.className : ''; }")
    check("review-card-stalled" in cls, f"resolving the capture reveals the stalled sample next ({cls})")
    check(info_hidden() is False, "the info panel is STILL OPEN after the card changed")
    panel = info_text()
    check("no way forward. Add the next physical step" in panel,
          "and its content updated to the new card's kind")

    # ---------- all-clear: defer everything, the ⓘ disappears ----------
    for _ in range(6):
        if not pg.evaluate("() => !!document.querySelector('.review-card')"): break
        pg.evaluate("""() => { const b = document.querySelector('[data-action=\"review-defer\"]');
          if (b) b.click(); }""")
        pg.wait_for_timeout(300)
    ended = pg.evaluate("() => !!document.querySelector('.review-end')")
    check(ended, "the review reaches its end state")
    check(not has_info_button(), "and the ⓘ is gone — nothing on the page to explain")
    check(not pg.evaluate("() => !!document.querySelector('.review-info-panel')"),
          "no info panel in the DOM either")

    pg.evaluate("""() => { const c = document.querySelector('[data-action=\"review-close\"]'); if (c) c.click(); }""")
    pg.wait_for_timeout(300)

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

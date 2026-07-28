"""Author addition: the stalled project's inline "add a waiting action" form
(reviewWaitingFormHtml) had a "what/until" pair of free-text boxes only, with
no way to attach a real Next/Waiting condition short of escaping to the full
create page -- inconsistent with every other waiting-for field in the app,
which all offer a hook icon. Added a .review-hook-btn beside the "until
what/when" box, reusing the review-form-full navigation (there's no task id
yet to reuse review-open's edit-existing path -- this is a CREATE), so it
opens the full page prefilled, same destination the "Full page ->" link
already went to, just also reachable via the familiar hook affordance.
"""
import os, functools, http.server, socketserver, socket, threading, contextlib, sys, json
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
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)

    def jclick(selector):
        pg.evaluate("(sel) => { const el = document.querySelector(sel); if (el) el.click(); }", selector)

    pg.evaluate("""() => {
      const c = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
      c.unshift({ id: 'zz-stalled2', title: 'ZZ stalled project 2', notesClean: '',
        linkedProjectId: null, contextId: null, createdAt: Date.now(), deadline: null });
      localStorage.setItem('gtd_tasks_current', JSON.stringify(c));
    }""")
    pg.reload(); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    jclick('[data-action="open-tray"]'); pg.wait_for_timeout(300)
    jclick('[data-action="open-review"]'); pg.wait_for_timeout(500)
    for _ in range(8):
        title = pg.evaluate("() => { const el = document.querySelector('.review-card-title'); return el ? el.textContent.trim() : null; }")
        if title == "ZZ stalled project 2": break
        jclick('[data-action="review-defer"]'); pg.wait_for_timeout(300)
    check(pg.evaluate("() => { const el=document.querySelector('.review-card-title'); return el?el.textContent.trim():null; }") == "ZZ stalled project 2",
          "fixture: the stalled project is revealed")

    jclick('[data-action="review-form-start"][data-type="waiting"]')
    pg.wait_for_timeout(400)
    hook = pg.evaluate("""() => { const b = document.querySelector('.review-hook-btn[data-action="review-form-full"]');
      return b ? { kind: b.dataset.kind, project: b.dataset.project, glyph: b.textContent.trim() } : null; }""")
    check(hook is not None, "the hook icon is present on the waiting quick-add form")
    check(hook is not None and hook["kind"] == "waiting", f"and targets kind=waiting ({hook})")
    check(hook is not None and hook["project"] == "zz-stalled2", f"and carries the stalled project's id ({hook})")
    check(hook is not None and hook["glyph"] == "\U0001FA9D", f"and shows the hook glyph ({hook})")
    still_has_fullpage = pg.evaluate("() => !!document.querySelector('[data-action=\"review-form-full\"].review-form-full')")
    check(still_has_fullpage, "the existing 'Full page ->' escape hatch is untouched")

    # clicking it opens the full create page, prefilled with what was typed
    pg.fill("#review-form-input", "ZZ new waiting title")
    pg.fill("#review-form-input2", "ZZ new waiting when")
    jclick('.review-hook-btn[data-action="review-form-full"]')
    pg.wait_for_timeout(500)
    badge = pg.evaluate("() => { const b=document.querySelector('.screen-kind-badge'); return b?b.textContent.trim():null; }")
    check(badge is not None and "Wait" in badge, f"navigates to the full waiting-action create page ({badge})")
    title_val = pg.evaluate("() => { const i=document.querySelector('.screen-field-title'); return i?i.value:null; }")
    check(title_val == "ZZ new waiting title", f"carrying the typed title over ({title_val!r})")

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

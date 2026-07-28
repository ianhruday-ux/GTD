"""Author simplification, fifth QA round: the orphaned card's "Re-point the
condition" and "Replace with free text" buttons -- two full-width buttons for
one job -- are replaced by a single compact row: a text box, a hook icon
(navigates to the full waiting page to re-point the condition, same as
before), and Add. "+Next" stays as its own chip.
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


def seed_orphan(pg, id_="zz-orphan", title="ZZ orphaned waiter"):
    pg.evaluate("""(o) => {
      const w = JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]');
      w.unshift({ id: o.id, title: o.title, notesClean: '',
        conditionId: 'zz-does-not-exist', conditionKind: 'next', whenText: null,
        linkedProjectId: null, contextId: null, createdAt: Date.now() });
      localStorage.setItem('gtd_tasks_waiting', JSON.stringify(w));
    }""", {"id": id_, "title": title})


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)

    def jclick(selector):
        pg.evaluate("(sel) => { const el = document.querySelector(sel); if (el) el.click(); }", selector)

    def open_review():
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        jclick('[data-action="open-tray"]')
        pg.wait_for_timeout(350)
        jclick('[data-action="open-review"]')
        pg.wait_for_timeout(600)

    def close_review():
        jclick('[data-action="review-close"]')
        pg.wait_for_timeout(300)

    def revealed_title():
        return pg.evaluate("""() => { const el = document.querySelector('.review-card-title');
          return el ? el.textContent.trim() : null; }""")

    def defer_until(title):
        """The tutorial's own stalled sample project sits ahead of a freshly
        seeded orphaned waiter in the queue (stalled precedes orphaned) --
        walk past it with Not now."""
        for _ in range(8):
            if revealed_title() == title: return True
            if not pg.evaluate("() => !!document.querySelector('[data-action=\"review-defer\"]')"):
                return False
            jclick('[data-action="review-defer"]')
            pg.wait_for_timeout(300)
        return revealed_title() == title

    # ---------- the simplified card shows exactly field + hook + Add + +Next ----------
    seed_orphan(pg)
    pg.reload(); pg.wait_for_timeout(1000)
    open_review()
    check(defer_until("ZZ orphaned waiter"), f"fixture: the orphaned waiter is revealed ({revealed_title()})")
    check(pg.locator('#review-form-input').count() == 1, "the quick-add text field is present, unconditionally")
    check(pg.locator('.review-hook-btn[data-action="review-open"]').count() == 1, "the hook icon is present")
    check(pg.locator('[data-action="review-freetext-save"]').count() == 1, "the Add button is present")
    promote_text = pg.evaluate("""() => { const b = document.querySelector('[data-action="review-promote"]');
      return b ? b.textContent.trim() : null; }""")
    check(promote_text == "+Next", f"+Next is still offered, labelled correctly ({promote_text!r})")
    body_text = pg.evaluate("() => document.querySelector('.review-card').textContent")
    check("Re-point" not in body_text, "the old 'Re-point the condition' button is gone")
    check("Replace with free text" not in body_text, "the old 'Replace with free text' button is gone")

    # ---------- typing and hitting Add replaces the condition with free text ----------
    pg.evaluate("""() => { const i = document.querySelector('#review-form-input');
      i.value = 'Sarah gets back to me'; }""")
    jclick('[data-action="review-freetext-save"]')
    pg.wait_for_timeout(500)
    row = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]')
      .find(t => t.id === 'zz-orphan')""")
    check(row is not None, "the waiting action still exists")
    check(row["whenText"] == "Sarah gets back to me", f"Add saved the typed free text ({row['whenText']!r})")
    check(row["conditionId"] is None, f"and cleared the dangling condition ({row['conditionId']!r})")
    close_review()

    # ---------- the hook icon navigates to the full waiting page ----------
    seed_orphan(pg, id_="zz-orphan2", title="ZZ orphaned waiter 2")
    pg.reload(); pg.wait_for_timeout(1000)
    open_review()
    check(defer_until("ZZ orphaned waiter 2"), f"fixture: the second orphaned waiter is revealed ({revealed_title()})")
    jclick('.review-hook-btn[data-action="review-open"]')
    pg.wait_for_timeout(500)
    on_waiting_page = pg.evaluate("""() => { const b = document.querySelector('.screen-kind-badge');
      return b ? b.textContent.trim() : null; }""")
    check(on_waiting_page is not None and "Wait" in on_waiting_page,
          f"the hook icon opened the full waiting-action page ({on_waiting_page})")
    jclick('[data-action="screen-cancel"]')
    pg.wait_for_timeout(400)
    back_on_review = pg.evaluate("""() => !!document.querySelector('.review-card')""")
    check(back_on_review, "and closing it returns to the review")

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

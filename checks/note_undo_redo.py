"""Undo / redo on the note formatting bar.

User: "the notes page needs an undo button on the markdown bar. It should be a
forward and a back arrow, which is especially useful when someone has used large
modifications by highlighting text."

⚑ Implemented with document.execCommand("undo"/"redo"), NOT a hand-rolled
history. Every format button in this bar already goes through execCommand, so
the browser's own undo stack already holds the typing and the formatting
correctly interleaved. A separate stack would have to duplicate that and would
drift from the caret the moment the two disagreed.

That is exactly why the interesting case here is not typing — it is undoing a
FORMAT applied to a selection, which is the case the user named.
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


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1100)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    # open a new note
    pg.click('.tab[data-kind="notes"]'); pg.wait_for_timeout(400)
    pg.click('[data-action="fab"]'); pg.wait_for_timeout(350)
    pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(600)
    check(pg.locator(".note-toolbar").count() == 1, "the note page has a formatting bar")

    undo = pg.locator('[data-md="undo"]')
    redo = pg.locator('[data-md="redo"]')
    check(undo.count() == 1 and redo.count() == 1, "with an undo and a redo button")
    order = pg.evaluate("""() => [...document.querySelectorAll('.note-toolbar [data-md]')]
        .map(e => e.getAttribute('data-md'))""")
    check(order[:2] == ["undo", "redo"], f"leading the bar ({order})")

    body = ".note-body[contenteditable]"
    pg.click(body); pg.wait_for_timeout(200)
    pg.keyboard.type("The quick brown fox")
    pg.wait_for_timeout(300)

    def html():
        return pg.eval_on_selector(body, "e => e.innerHTML")

    def draft_body():
        return pg.evaluate("""() => {
          // the draft is what SAVE writes, so it has to keep up with undo
          const el = document.querySelector('.note-body[contenteditable]');
          return el ? el.innerHTML : null;
        }""")

    typed = html()
    check("quick brown fox" in typed, f"typing lands in the body ({typed[:60]})")

    # ---------- THE CASE THE USER NAMED: a format over a selection ----------
    pg.evaluate("""() => {
      const el = document.querySelector('.note-body[contenteditable]');
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
    }""")
    pg.locator('[data-md="bold"]').first.click(); pg.wait_for_timeout(350)
    bolded = html()
    check(bolded != typed and ("<b>" in bolded.lower() or "<strong>" in bolded.lower()),
          f"bolding the whole selection changes the body ({bolded[:80]})")

    undo.first.click(); pg.wait_for_timeout(400)
    after_undo = html()
    check("<b>" not in after_undo.lower() and "<strong>" not in after_undo.lower(),
          f"undo takes the formatting back off ({after_undo[:80]})")
    check("quick brown fox" in after_undo,
          f"without losing the text underneath it ({after_undo[:80]})")

    redo.first.click(); pg.wait_for_timeout(400)
    after_redo = html()
    check("<b>" in after_redo.lower() or "<strong>" in after_redo.lower(),
          f"redo puts it back ({after_redo[:80]})")

    # ---------- the draft keeps up, so Save writes what you see ----------
    undo.first.click(); pg.wait_for_timeout(400)
    pg.fill('[data-field="noteTitle"]', "ZZ undo note")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(800)
    saved = pg.evaluate("""() => {
      const ns = JSON.parse(localStorage.getItem('gtd_notes') || '[]');
      const n = ns.find(x => x.title === 'ZZ undo note');
      return n ? n.body : null;
    }""")
    check(saved is not None, "the note saved")
    check(saved is not None and "<b>" not in saved.lower() and "<strong>" not in saved.lower(),
          f"and what was UNDONE is not in the saved body ({(saved or '')[:80]})")
    check(saved is not None and "quick brown fox" in saved,
          f"while the text itself survived ({(saved or '')[:80]})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

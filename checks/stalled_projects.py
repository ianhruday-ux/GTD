"""QA #17 — do projects with no way forward still reach the review?

The user saw the chunk-map entries missing and suspected sample data. They are
missing ON PURPOSE: isDevScaffold() excludes anything carrying a devContext, or
whose parent group does, and the chunk map is exactly that. This check pins both
halves — dev scaffolding stays out, real projects still come through — so the
exclusion can't quietly widen into hiding genuine stalled projects.

A project has a "way forward" if a Next Action or Waiting action is linked to
it, or a linked event is coming (§4.3b/§4.8b).
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from _pickers import enable_qa_scaffolding

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
    # ⚠ The chunk map is dev scaffolding and is OFF by default now; this check
    # exists to prove the review EXCLUDES it, so it has to be present first.
    enable_qa_scaffolding(pg)

    def reload_app():
        pg.reload(); pg.wait_for_timeout(900)

    def open_review():
        pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
        pg.wait_for_timeout(450)
        pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
        pg.wait_for_timeout(700)
        # the review shows one loop at a time; reveal them all
        showall = pg.locator('[data-action="review-showall"], [data-action="review-show-all"]')
        if showall.count():
            showall.first.click(); pg.wait_for_timeout(400)

    def review_text():
        return pg.evaluate("""() => [...document.querySelectorAll('.review-card')]
            .map(c => c.textContent).join(' | ')""")

    # a real project with nothing pointing at it
    pg.evaluate("""() => {
      const rows = JSON.parse(localStorage.getItem('gtd_tasks_current'));
      rows.unshift({id:'p-lonely', title:'Lonely project', notesClean:'', isGroup:false,
                    parent:null, linkedProjectId:null, deadline:null, createdAt:Date.now()});
      localStorage.setItem('gtd_tasks_current', JSON.stringify(rows));
    }""")
    reload_app(); open_review()
    txt = review_text()
    check("Lonely project" in txt, "a real project with no way forward reaches the review")

    chunk_titles = pg.evaluate("""() => {
      const rows = JSON.parse(localStorage.getItem('gtd_tasks_current'));
      const g = rows.find(t => t.isGroup && t.devContext === 'chunk-map');
      return g ? rows.filter(t => t.parent === g.id).map(t => t.title) : [];
    }""")
    check(len(chunk_titles) > 0, f"the chunk map exists to test against ({len(chunk_titles)} entries)")
    leaked = [t for t in chunk_titles if t and t in txt]
    check(not leaked, f"chunk-map entries stay OUT of the review (leaked: {leaked[:3]})")

    # give the project a way forward -> it leaves the review
    pg.evaluate("""() => {
      const rows = JSON.parse(localStorage.getItem('gtd_tasks_next'));
      rows.unshift({id:'a-1', title:'The very next step', notesClean:'', isGroup:false,
                    parent:null, linkedProjectId:'p-lonely', deadline:null, whenText:null,
                    conditionId:null, conditionKind:null, conditionLabel:null,
                    bundleText:null, createdAt:Date.now()});
      localStorage.setItem('gtd_tasks_next', JSON.stringify(rows));
    }""")
    reload_app(); open_review()
    check("Lonely project" not in review_text(), "linking a next action clears it from the review")

    # ...and removing that action brings it back
    pg.evaluate("""() => {
      const rows = JSON.parse(localStorage.getItem('gtd_tasks_next')).filter(t => t.id !== 'a-1');
      localStorage.setItem('gtd_tasks_next', JSON.stringify(rows));
    }""")
    reload_app(); open_review()
    check("Lonely project" in review_text(), "removing it again makes the project stalled again")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

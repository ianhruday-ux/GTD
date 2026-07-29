"""The confirm dialogs read correctly after being routed through i18n.

Seven dialogs used to build their sentence by concatenation with ENGLISH
pluralisation:

    "Delete all " + n + " completed item" + (n === 1 ? "" : "s") + "?"
    "Completing it will put " + (many ? "them" : "it") + " aside"

That cannot be translated in place — Chinese has no plural -s and no them/it
split — so each became a whole-sentence One/Many pair with an {n} template.
Restructuring a sentence is exactly where a template placeholder gets left
unsubstituted, or the wrong arm gets picked, so this drives the real dialogs at
both plurality boundaries and reads what came out.

⚠ THE POINT IS THE BOUNDARY. One item and two items take different keys, and a
raw "{n}" or "{name}" surviving into the visible string is the failure this is
looking for — it renders as literal braces and no test that only checks "a
dialog appeared" would notice.
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
    pg.goto(url); pg.wait_for_timeout(1200)

    def clean():
        pg.evaluate("""() => { for (const s of ['#tray-root', '#dialog-root']) {
            const r = document.querySelector(s); if (r) r.innerHTML = ''; } }""")

    def dialog_text():
        return pg.evaluate("""() => { const d = document.querySelector('.choice-dialog-backdrop');
                                      return d ? d.innerText : null; }""")

    def seed(js):
        clean()
        pg.evaluate(js)
        pg.reload(); pg.wait_for_timeout(1200)
        clean()

    def no_placeholders(txt, where):
        bad = [tok for tok in ("{n}", "{name}", "{what}", "{title}") if tok in (txt or "")]
        check(not bad, f"{where}: no unsubstituted placeholder left in the text ({bad})")

    LIST = """(n) => {
      const rows = [{ id: 'zzg', title: 'ZZ errands', isGroup: true, parent: null,
                      notesClean: '', linkedProjectId: null }];
      for (let i = 0; i < n; i++) rows.push({ id: 'zzc' + i, title: 'ZZ item ' + i,
        notesClean: '', parent: 'zzg' });
      localStorage.setItem('gtd_tasks_next', JSON.stringify(rows));
    }"""

    # ---------------- delete a list: empty / one / many ----------------
    for n, expect, label in ((0, None, "empty"), (1, "1 item", "one item"), (3, "3 items", "3 items")):
        clean()
        pg.evaluate(LIST, n)
        pg.reload(); pg.wait_for_timeout(1200); clean()
        pg.evaluate("""() => document.querySelector('[data-action="delete-group"][data-id="zzg"]').click()""")
        pg.wait_for_timeout(400)
        txt = dialog_text()
        check(txt is not None and "ZZ errands" in txt,
              f"delete list ({label}): the dialog names the list")
        no_placeholders(txt, f"delete list ({label})")
        if expect:
            check(expect in (txt or ""), f"delete list ({label}): says “{expect}” ({(txt or '')[:74]!r})")
        else:
            check("item" not in (txt or "").lower(),
                  f"delete list (empty): says nothing about items ({(txt or '')[:60]!r})")
        check("Delete list" in (txt or ""), f"delete list ({label}): the button is there")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300); clean()

    # ---------------- clear a completed archive: one / many ----------------
    COMPLETED = """(n) => {
      const done = [];
      for (let i = 0; i < n; i++) done.push({ id: 'zzd' + i, title: 'ZZ done ' + i,
        notesClean: '', parent: null, completedAt: Date.now() });
      localStorage.setItem('gtd_completed_next', JSON.stringify(done));
      localStorage.setItem('gtd_tasks_next', '[]');
    }"""
    for n, expect in ((1, "1 completed item"), (4, "4 completed items")):
        clean()
        pg.evaluate(COMPLETED, n)
        pg.reload(); pg.wait_for_timeout(1200); clean()
        pg.evaluate("""() => document.querySelector('[data-action="clear-completed"]').click()""")
        pg.wait_for_timeout(400)
        txt = dialog_text()
        no_placeholders(txt, f"clear completed (n={n})")
        check(expect in (txt or ""),
              f"clear completed (n={n}): says “{expect}” ({(txt or '')[:70]!r})")
        check("undone" in (txt or ""), f"clear completed (n={n}): still warns it can't be undone")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300); clean()

    # ---------------- complete a project with linked items: one / many ------
    PROJ = """(nWaiting) => {
      localStorage.setItem('gtd_tasks_current', JSON.stringify(
        [{ id: 'zzp', title: 'ZZ project', notesClean: '', isGroup: false, parent: null }]));
      const w = [];
      for (let i = 0; i < nWaiting; i++) w.push({ id: 'zzw' + i, title: 'ZZ waiting ' + i,
        notesClean: '', parent: null, linkedProjectId: 'zzp' });
      localStorage.setItem('gtd_tasks_waiting', JSON.stringify(w));
      localStorage.setItem('gtd_tasks_next', '[]');
      localStorage.setItem('gtd_completed_next', '[]');
    }"""
    for n, expect, pron in ((1, "1 linked waiting item", " it aside"),
                            (2, "2 linked waiting items", " them aside")):
        clean()
        pg.evaluate(PROJ, n)
        pg.reload(); pg.wait_for_timeout(1200); clean()
        # ⚠ NOT the lane checkbox. That calls completeTask() directly and never
        # reaches completeProject(), so the dialog does not exist on that path
        # (see the note in the handoff). The real route is the project's own
        # page: arm Complete, then Save.
        pg.evaluate("""() => document.querySelector('[data-action="open-edit"][data-id="zzp"]').click()""")
        pg.wait_for_timeout(450)
        pg.evaluate("""() => document.querySelector('[data-action="screen-complete"]').click()""")
        pg.wait_for_timeout(300)
        pg.evaluate("""() => document.querySelector('[data-action="screen-save"]').click()""")
        pg.wait_for_timeout(600)
        txt = dialog_text()
        no_placeholders(txt, f"complete project (n={n})")
        check(expect in (txt or ""),
              f"complete project (n={n}): counts them “{expect}” ({(txt or '')[:70]!r})")
        check(pron in (txt or ""),
              f"complete project (n={n}): picks the right pronoun (“{pron.strip()}”)")
        check("Complete project" in (txt or ""), f"complete project (n={n}): the button is there")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300); clean()

    # ---------------- and the whole set survives in Chinese ----------------
    pg.evaluate("""() => document.querySelector('[data-action="open-overflow"]').click()""")
    pg.wait_for_timeout(350)
    pg.evaluate("""() => document.querySelector('[data-action="settings-language"]').click()""")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => document.querySelector('[data-action="settings-pick-lang"][data-lang="zh-Hans"]').click()""")
    pg.wait_for_timeout(700)
    clean()
    pg.evaluate(LIST, 3)
    pg.reload(); pg.wait_for_timeout(1200); clean()
    pg.evaluate("""() => document.querySelector('[data-action="delete-group"][data-id="zzg"]').click()""")
    pg.wait_for_timeout(400)
    txt = dialog_text() or ""
    no_placeholders(txt, "delete list (zh-Hans)")
    check(any("一" <= c <= "鿿" for c in txt), f"the dialog is translated ({txt[:40]!r})")
    check("3" in txt, f"and the count still lands in it ({txt[:40]!r})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

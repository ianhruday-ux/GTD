"""The two ways hostile data got in, and the boundaries that now stop it.

Found by the security audit of 2026-08-03, both proven to execute against the
build of that morning before either fix was written.

  1. PARSE-THEN-SANITISE. sanitizeNoteHtml and noteBodyToText read a note's
     stored HTML with `document.createElement("div").innerHTML = html`. A
     detached node is not an inert one: Chromium creates the <img>, tries the
     load, fails, and runs the onerror handler — so an imported note's payload
     executed during the very pass that was stripping it. The OUTPUT was always
     clean, which is exactly why nobody saw it. Both readers now parse through
     DOMParser, which builds a genuinely inert document.

     The lane preview is the hot path: it renders every note's body on load, so
     the payload fired before the note was ever opened.

  2. IDS ARE NOT USER INPUT — except they became it. Record ids are spliced
     into HTML attributes unescaped in ~60 places (`data-id="' + task.id + '"`),
     which is safe for as long as ids come from genId(). Import let a FILE
     supply them: an id of `x"><img src=q onerror=…>` broke out of the
     attribute and ran with the whole origin in reach. The import path now
     refuses a file whose id-shaped fields hold anything outside
     [A-Za-z0-9_.:-] — it refuses rather than repairs, because rewriting ids
     would orphan every linkedProjectId/conditionId/parent pointing at them.

Group 4 is the false-positive guard, and it is the one that matters most for
daily use: a backup this app actually wrote must still restore. A validator
that rejects real backups would be worse than the hole it closes.
"""
import os, sys, json, functools, http.server, socket, socketserver, threading, contextlib, tempfile
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

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


# Fires on its own the moment it is parsed into a live document; harmless in an
# inert one. The <script> tag never runs via innerHTML at all — it is here to
# confirm the allowlist still drops it.
EVIL_BODY = ('<img src=q onerror="window.__pwned=(window.__pwned||0)+1">'
             '<' + 'script>window.__pwned=99</' + 'script>'
             '<b onclick="1">visible text</b>')
# Breaks OUT of data-id="…" and injects an element that fires by itself.
EVIL_ID = 'x"><img src=q onerror="window.__pwned=(window.__pwned||0)+1"><b id="y'


def clear_decks(pg):
    pg.evaluate("""() => {
      ['#tray-root', '#dialog-root', '#screen-root'].forEach(sel => {
        const el = document.querySelector(sel); if (el) el.innerHTML = '';
      });
      document.body.classList.remove('screen-open');
      window.scrollTo(0, 0);
    }""")
    pg.wait_for_timeout(250)


def pwned(pg):
    return pg.evaluate("() => window.__pwned || 0")


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    errs = []

    @contextlib.contextmanager
    def fresh():
        ctx = b.new_context(viewport={"width": 420, "height": 900})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
        pg.goto(url); pg.wait_for_timeout(700)
        try:
            yield pg
        finally:
            ctx.close()

    # ============================================================
    # Group 1 -- a hostile note body, on the lane (the hot path)
    # ============================================================
    with fresh() as pg:
        pg.evaluate("""(body) => {
            localStorage.setItem('gtd_notes', JSON.stringify([
              { id:'n1', title:'an ordinary note', body: body, projectLinks:[], tagIds:[], editedAt: Date.now() }
            ]));
        }""", EVIL_BODY)
        pg.reload(); pg.wait_for_timeout(1000)
        clear_decks(pg)
        pg.evaluate("() => document.querySelector('.tab[data-kind=\"notes\"]').click()")
        pg.wait_for_timeout(700)
        check(pwned(pg) == 0,
              f"THE HOT PATH: rendering the notes lane runs nothing — the card preview reads every "
              f"body on load, and used to fire the payload before the note was opened (__pwned={pwned(pg)})")
        preview = pg.evaluate("""() => document.body.innerText.includes('visible text')""")
        check(preview, "and the note's actual TEXT still shows — inert parsing is not blank parsing")

        # ---- and on the note's own page, where the body is rendered as HTML ----
        pg.evaluate("() => { const c = document.querySelector('.note-card, .card'); if (c) c.click(); }")
        pg.wait_for_timeout(900)
        state = pg.evaluate("""() => ({
            pwned: window.__pwned || 0,
            imgs: document.querySelectorAll('img').length,
            handlers: document.querySelectorAll('[onclick],[onerror]').length,
            scripts: document.querySelectorAll('.note-body script').length
        })""")
        check(state["pwned"] == 0, f"opening the note runs nothing either ({state})")
        check(state["imgs"] == 0, f"the <img> never reaches the document ({state})")
        check(state["handlers"] == 0, f"no event-handler attribute survives the allowlist ({state})")
        check(state["scripts"] == 0, f"and no <script> ({state})")

    # ============================================================
    # Group 2 -- a hostile id already in storage still renders inertly
    # ============================================================
    # Storage is not itself a trust boundary (the import path below is), but the
    # id sinks are unescaped, so this records exactly what such an id does.
    with fresh() as pg:
        pg.evaluate("""(evil) => {
            localStorage.setItem('gtd_tasks_next', JSON.stringify([
              { id: evil, title: 'ordinary looking task', isGroup:false, parent:null,
                notesClean:'', linkedProjectId:null, contextId:null, whenText:null, deadline:null }
            ]));
        }""", EVIL_ID)
        pg.reload(); pg.wait_for_timeout(1200)
        injected = pg.evaluate("() => document.querySelectorAll('img').length")
        check(pwned(pg) > 0 and injected > 0,
              f"DOCUMENTED, NOT FIXED: an id that reaches storage by some other route still injects "
              f"— the ~60 unescaped `data-id=\"' + id + '\"` sinks are unchanged, which is why the "
              f"IMPORT boundary below has to hold (__pwned={pwned(pg)}, imgs={injected})")

    # ============================================================
    # Group 3 -- import REFUSES a file carrying such an id
    # ============================================================
    with tempfile.TemporaryDirectory() as tmp:
        hostile = os.path.join(tmp, "hostile-backup.json")
        with open(hostile, "w", encoding="utf-8") as fh:
            json.dump({"data": {"gtd_tasks_next": json.dumps([
                {"id": EVIL_ID, "title": "looks fine", "isGroup": False, "parent": None,
                 "notesClean": "", "linkedProjectId": None, "contextId": None,
                 "whenText": None, "deadline": None}
            ])}}, fh)
        good = os.path.join(tmp, "real-backup.json")
        with open(good, "w", encoding="utf-8") as fh:
            json.dump({"data": {"gtd_tasks_next": json.dumps([
                {"id": "local-mfxk2p-a91c3d", "title": "ZZ RESTORED TASK", "isGroup": False,
                 "parent": None, "notesClean": "", "linkedProjectId": None, "contextId": None,
                 "whenText": None, "deadline": None}
            ])}}, fh)

        def do_import(pg, path):
            # ⚠ Through the REAL menu. The import handler is bound to
            # `#dialog-root .settings-menu`, not the document, so a synthetic
            # [data-action="import-data"] element appended anywhere else is
            # never dispatched — the file chooser simply never opens and the
            # suite hangs on expect_file_chooser rather than failing.
            pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
            pg.wait_for_timeout(150)
            pg.evaluate("() => document.querySelector('[data-action=\"open-overflow\"]').click()")
            pg.wait_for_timeout(400)
            row = pg.locator('.settings-menu [data-action="import-data"]')
            if not row.count():
                check(False, "the settings menu offers an import row")
                return False
            with pg.expect_file_chooser() as fc:
                row.first.click()
            fc.value.set_files(path)
            pg.wait_for_timeout(900)
            return True

        def dialog_text(pg):
            return pg.evaluate("""() => {
                const d = document.querySelector('.choice-dialog p');
                return d ? d.textContent.trim() : null;
            }""")

        with fresh() as pg:
            do_import(pg, hostile)
            msg = dialog_text(pg)
            check(msg is not None and "identifiers" in msg,
                  f"THE BOUNDARY: a backup carrying a hostile id is REFUSED, by name ({msg!r})")
            check(pwned(pg) == 0, f"nothing ran while deciding that ({pwned(pg)})")
            stored = pg.evaluate("""() => (localStorage.getItem('gtd_tasks_next') || '')""")
            check(EVIL_ID not in stored,
                  "and the record was never written — refused, not written-then-regretted")
            check("Replace everything" not in (pg.evaluate("() => document.body.innerText") or ""),
                  "the destructive confirm is never even offered for a file that fails the check")

    # ============================================================
    # Group 4 -- a REAL backup still restores (the false-positive guard)
    # ============================================================
        with fresh() as pg:
            do_import(pg, good)
            body = pg.evaluate("() => document.body.innerText")
            check("Replace everything" in body or "replace" in body.lower(),
                  "a backup this app could have written reaches the normal confirm")
            btn = pg.locator('.choice-dialog button:has-text("Replace everything")')
            if btn.count():
                btn.first.click(); pg.wait_for_timeout(1500)
                restored = pg.evaluate("""() => (localStorage.getItem('gtd_tasks_next') || '')""")
                check("ZZ RESTORED TASK" in restored,
                      "and it restores — the validator does not reject legitimate ids")
            else:
                check(False, "expected the ordinary replace-everything confirm for a valid backup")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

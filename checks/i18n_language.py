"""The Language switch (Chinese translation round).

The Language row in ⋯ was a disabled "not built yet" placeholder. It now opens a
sub-panel that switches the whole app between English and Simplified Chinese, the
choice persists, and every translated surface actually changes.

WHAT THIS GUARDS beyond "it works once":
  · the switch RE-RENDERS live — lanes, tab strip, badges, an open drafting page —
    rather than needing a reload, which is the thing a string-table-behind-a-const
    approach silently fails to do;
  · English is UNCHANGED — translating is not licence to reword the source copy,
    which is the writing pass the user reserved and marked done;
  · each language is named in its OWN script, or a switcher is useless once you
    are stuck in the language you cannot read;
  · no string key leaks to the UI (a missing translation shows the raw dotted
    key by design — greppable, and caught here).
"""
import os, sys, functools, http.server, socket, socketserver, threading, contextlib
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

DIST = os.path.join(REPO, "dist")


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
    (notes if cond else fails).append(("PASS  " if cond else "FAIL  ") + msg)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)

    def tabs():
        return pg.evaluate("() => [...document.querySelectorAll('.tab-name')].map(e => e.textContent)")

    def kill_tray():
        pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")

    def open_language():
        kill_tray()
        pg.evaluate("() => { const d = document.querySelector('#dialog-root'); if (d) d.innerHTML = ''; }")
        pg.evaluate("() => document.querySelector('[data-action=\"open-overflow\"]').click()")
        pg.wait_for_timeout(300)
        pg.evaluate("() => document.querySelector('[data-action=\"settings-language\"]').click()")
        pg.wait_for_timeout(250)

    def pick(lang):
        pg.evaluate("(l) => document.querySelector('[data-action=\"settings-pick-lang\"][data-lang=\"'+l+'\"]').click()", lang)
        pg.wait_for_timeout(400)
        pg.evaluate("() => { const d = document.querySelector('#dialog-root'); if (d) d.innerHTML = ''; }")
        pg.wait_for_timeout(150)

    # ---------- default is English ----------
    check(tabs()[0] == "Next", f"a first-time visitor sees English ({tabs()})")
    check(pg.evaluate("() => document.documentElement.getAttribute('lang')") == "en",
          "and <html lang> says so")

    # ---------- the picker names each language in its own script ----------
    open_language()
    opts = pg.evaluate("""() => [...document.querySelectorAll('[data-action="settings-pick-lang"]')]
      .map(b => [b.getAttribute('data-lang'), b.textContent.trim()])""")
    by = {lang: txt for lang, txt in opts}
    check("简体中文" in by.get("zh-Hans", ""), f"Chinese is offered as 简体中文 ({opts})")
    check("English" in by.get("en", ""), f"English as English ({opts})")

    # ---------- switching re-renders live, no reload ----------
    pick("zh-Hans")
    zt = tabs()
    check(zt == ["下一步", "等待", "项目", "将来", "习惯", "笔记"],
          f"the tab strip switches to Chinese with no reload ({zt})")
    laneTitle = pg.evaluate("() => document.querySelector('.lane[data-kind=\"next\"] .lane-label-title').textContent")
    check(laneTitle == "下一步行动", f"and the lane header ({laneTitle})")
    check(pg.evaluate("() => document.documentElement.getAttribute('lang')") == "zh-Hans",
          "<html lang> follows the switch")

    # a drafting page open in Chinese shows a translated badge + placeholder
    pg.evaluate("() => document.querySelector('#fab-create').click()"); pg.wait_for_timeout(250)
    pg.evaluate("""() => { const b = document.querySelector('[data-action="new-primary"]'); if (b) b.click(); }""")
    pg.wait_for_timeout(400)
    badge = pg.evaluate("() => { const e = document.querySelector('.screen-kind-badge'); return e ? e.textContent : null; }")
    ph = pg.evaluate("() => { const e = document.querySelector('.screen-field-title'); return e ? e.getAttribute('placeholder') : null; }")
    check(badge == "下一步行动", f"a drafting page's badge is translated ({badge})")
    check(ph and any('一' <= c <= '鿿' for c in ph), f"and its title placeholder ({ph})")
    pg.evaluate("""() => { const x = document.querySelector('[data-action="screen-cancel"]'); if (x) x.click(); }""")
    pg.wait_for_timeout(300)

    # ---------- the info button carries the user's translated prose ----------
    kill_tray()
    pg.evaluate("""() => { const b = document.querySelector('[data-action="toggle-info"][data-kind="next"]'); if (b) b.click(); }""")
    pg.wait_for_timeout(250)
    info = pg.evaluate("() => { const e = document.querySelector('.lane-info[data-kind=\"next\"]'); return e ? e.textContent : ''; }")
    check("下一步行动" in info and "情境" in info, f"the lane info is in Chinese ({info[:40]}…)")

    # ---------- the choice persists across a reload ----------
    check(pg.evaluate("() => localStorage.getItem('gtd_locale')") == "zh-Hans", "the locale is stored")
    pg.reload(); pg.wait_for_timeout(1000)
    check(tabs()[0] == "下一步", f"and the app comes back up in Chinese ({tabs()})")

    # ---------- English is UNCHANGED (no reworded source) ----------
    open_language(); pick("en")
    check(tabs() == ["Next", "Waiting", "Projects", "Someday", "Habits", "Notes"],
          f"switching back gives the original English tabs, not new wording ({tabs()})")
    kill_tray()
    pg.evaluate("""() => { const b = document.querySelector('[data-action="toggle-info"][data-kind="future"]'); if (b) b.click(); }""")
    pg.wait_for_timeout(200)
    fen = pg.evaluate("() => { const e = document.querySelector('.lane-info[data-kind=\"future\"]'); return e ? e.textContent : ''; }")
    check(fen.startswith("This lane is for projects you're not committed to starting yet"),
          f"and the info text is the user's exact reviewed copy ({fen[:60]}…)")

    # ---------- no raw string key ever reaches the UI ----------
    for locale in ("en", "zh-Hans"):
        open_language(); pick(locale)
        body = pg.evaluate("() => document.body.innerText")
        leaked = [tok for tok in ["lane.", "info.lane", "badge.", "fab.", "placeholder.", "review.heading", "settings."]
                  if tok in body]
        check(not leaked, f"[{locale}] no untranslated string key leaked to the UI ({leaked})")
    open_language(); pick("en")  # leave it English for the next check file

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

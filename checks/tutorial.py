"""The in-lane tutorial (user request).

Six numbered steps seeded as default data, one per lane the step is about, cleared
through completion as you work — modelled on the QA checklist's "cards in the
lanes" shape, but REAL user-facing content (not gated behind the QA switch, and it
re-seeds on Reset with the other samples).

WHAT THIS GUARDS:
  · the cards seed into the right lanes with the numbered titles;
  · the dependency wiring — ② hooked to ① (conditionId), ② linked to project ④
    (linkedProjectId) — is real, so ① auto-promotes ② when completed;
  · exactly ONE stalled project reaches Review (the ◇ sample), not two — the
    generic "Website relaunch" sample was healed so it doesn't compete;
  · a LANGUAGE switch re-stamps every card's text (title, notes, and ②'s frozen
    condition label) WITHOUT changing any id, so the hook and the link survive
    translation — the whole reason the id-stable approach was chosen;
  · completing a step archives it (clears it), and the two persist-exceptions
    (◇ sample project, ⑥ habit) are not next actions that could be ticked away.
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
    pg.goto(url); pg.wait_for_timeout(1100)

    def tasks(kind):
        return pg.evaluate("(k) => JSON.parse(localStorage.getItem('gtd_tasks_' + k) || '[]')", kind)

    def tut(kind, key):
        for tk in tasks(kind):
            if tk.get("tutorialKey") == key:
                return tk
        return None

    def kill_tray():
        pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")

    # ---------- the cards seed into the right lanes ----------
    check(tut("next", "t1") is not None, "① seeds into Next Actions")
    check(tut("waiting", "t2") is not None, "② seeds into Waiting")
    check(tut("next", "t3") is not None, "③ seeds into Next Actions")
    check(tut("current", "t4") is not None, "④ seeds into Current Projects")
    check(tut("next", "t5") is not None, "⑤ seeds into Next Actions")
    check(tut("next", "t6") is not None, "⑥ (habit instruction) seeds into Next Actions")
    check(tut("current", "tp") is not None, "◇ stalled sample seeds into Current Projects")
    check("①" in (tut("next", "t1") or {}).get("title", ""),
          "the title is numbered — it says what to do")

    # ---------- the dependency wiring is real ----------
    t1, t2, t4 = tut("next", "t1"), tut("waiting", "t2"), tut("current", "t4")
    check(t2["conditionId"] == t1["id"] and t2["conditionKind"] == "next",
          "② is hooked to ① (conditionId → ①)")
    check(t2["conditionLabel"] == t1["title"], "and its frozen label reads ①'s title")
    check(t2["linkedProjectId"] == t4["id"], "② is linked to project ④")

    # ---------- exactly one stalled project reaches Review ----------
    kill_tray()
    pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()"); pg.wait_for_timeout(350)
    badge = pg.evaluate("() => { const b = document.querySelector('.tray-review-count'); return b ? b.textContent.trim() : '0'; }")
    check(badge == "1", f"the review badge is 1 — only the ◇ sample is stalled ({badge})")
    pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()"); pg.wait_for_timeout(600)
    first = pg.evaluate("() => { const e = document.querySelector('.review-card-title'); return e ? e.textContent.trim() : null; }")
    check(first and "sample project" in first, f"and it is the ◇ sample that comes up ({first})")
    pg.evaluate("() => { const c = document.querySelector('[data-action=\"review-close\"]'); if (c) c.click(); }")
    pg.wait_for_timeout(300); kill_tray()

    # ---------- ① auto-promotes ② when completed (the hook, live) ----------
    # Tick ①'s checkbox in the lane; ② should jump from Waiting into Next Actions.
    pg.evaluate("() => { const t = [...document.querySelectorAll('.tab')].find(x => x.getAttribute('data-kind') === 'next'); if (t) t.click(); }")
    pg.wait_for_timeout(300)
    ok = pg.evaluate("""() => {
      const row = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Create your first next action'));
      if (!row) return 'no ① row';
      const cb = row.querySelector('.checkbox, [data-action="complete"], input[type=checkbox]');
      if (!cb) return 'no checkbox';
      cb.click(); return 'ok';
    }""")
    pg.wait_for_timeout(700)
    check(ok == "ok", f"① has a completion checkbox and it ticks ({ok})")
    check(tut("next", "t1") is None, "① left the active Next Actions lane (archived)")
    check(tut("next", "t2") is not None,
          "② auto-promoted from Waiting into Next Actions — the hook fired live")
    check(tut("waiting", "t2") is None, "and is no longer in Waiting")

    # ---------- language switch re-stamps text but not ids ----------
    # ⚠ Reset to FRESH seed first: ① was completed above and completion persists
    # across a reload, so a plain reload would NOT bring it back. Clear the gtd_
    # keys and reload to re-seed the tutorial in its untouched state.
    pg.evaluate("""() => { Object.keys(localStorage)
      .filter(k => k.indexOf('gtd_') === 0)
      .forEach(k => localStorage.removeItem(k)); }""")
    pg.reload(); pg.wait_for_timeout(1200)
    kill_tray()
    id_before = {k: (tut("next", k) or tut("waiting", k) or tut("current", k) or {}).get("id")
                 for k in ["t1", "t2", "t4", "tp"]}
    pg.evaluate("() => document.querySelector('[data-action=\"open-overflow\"]').click()"); pg.wait_for_timeout(300)
    pg.evaluate("() => document.querySelector('[data-action=\"settings-language\"]').click()"); pg.wait_for_timeout(250)
    pg.evaluate("() => document.querySelector('[data-action=\"settings-pick-lang\"][data-lang=\"zh-Hans\"]').click()"); pg.wait_for_timeout(500)
    pg.evaluate("() => { const d = document.querySelector('#dialog-root'); if (d) d.innerHTML = ''; }"); pg.wait_for_timeout(200)
    z1 = tut("next", "t1")
    check(z1 and any('一' <= c <= '鿿' for c in z1["title"]),
          f"switching to Chinese re-stamps ①'s title ({(z1 or {}).get('title')})")
    z2 = tut("waiting", "t2")
    check(z2 and z2["conditionLabel"] == z1["title"],
          "and ②'s frozen condition label follows into Chinese")
    id_after = {k: (tut("next", k) or tut("waiting", k) or tut("current", k) or {}).get("id")
                for k in ["t1", "t2", "t4", "tp"]}
    check(id_before == id_after, f"no card id changed across the switch ({id_before} vs {id_after})")
    check(z2 and z2["conditionId"] == z1["id"] and z2["linkedProjectId"] == tut("current", "t4")["id"],
          "so ②'s hook and project link still resolve after translation")

    # ---------- the two persist-exceptions are NOT tick-away next actions ----------
    tp = tut("current", "tp")
    check(tp is not None and tp.get("tutorialKey") == "tp",
          "the ◇ sample project persists (removed by 🗑, per the ruling)")

    # put it back to English so later check files see the default
    pg.evaluate("() => document.querySelector('[data-action=\"open-overflow\"]').click()"); pg.wait_for_timeout(250)
    pg.evaluate("() => document.querySelector('[data-action=\"settings-language\"]').click()"); pg.wait_for_timeout(200)
    pg.evaluate("() => document.querySelector('[data-action=\"settings-pick-lang\"][data-lang=\"en\"]').click()"); pg.wait_for_timeout(300)

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

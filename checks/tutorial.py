"""The in-lane tutorial (user request; chained in a later round; content
replaced again with the author's own reviewed script, oela_app_tutorial_en_zh.txt).

Eight numbered steps seeded as default data, cleared through completion as you
work — modelled on the QA checklist's "cards in the lanes" shape, but REAL
user-facing content (not gated behind the QA switch, and it re-seeds on Reset
with the other samples).

▲ CHAIN ROUND: ②–⑧ are a real chain. Each is a waiting action hooked to the
step before it, seeded directly into Waiting On, and promotes into Next
Actions on its own as the previous step is ticked. EVERY step (①–⑧), not just
②, is linked to the reference project `tr` — the new script's own framing for
that project is "each of its linked actions is a different stage in the
tutorial." `tp`, the stalled sample, is unchanged in mechanism but now fixed
at step ⑦ instead of ⑤ (the script moved that lesson later).

⚑ The OLD copy made ⑥ (the habit step) a persist-exception — it never
self-completed, teaching the "habits don't archive" lesson by never letting
you tick it; you deleted it instead. The new script doesn't ask for that on
⑧, so ⑧ is now a normal chain link like the rest (ticks to complete). This
file tests THAT reading of the new copy.

WHAT THIS GUARDS:
  · ① seeds into Next Actions with no condition; ②–⑧ all seed into WAITING ON,
    each hooked to the step before it; tr and tp seed into Current Projects;
  · the FULL CHAIN fires live: completing each step promotes exactly the next
    one from Waiting into Next Actions, in order, all the way to ⑧;
  · a step mid-chain — waiting on a target that has ALREADY promoted from
    Waiting to Next but not yet been completed — does NOT render as orphaned.
    This is the bug the chain would expose: the app used to pick a fixed pool
    (next XOR waiting) by the target's conditionKind, which goes stale the
    moment a live target changes lanes. Both leafCardHtml's cue pill and
    isWaitingOrphaned now check both live pools;
  · exactly ONE stalled project reaches Review (tp), not tr — tr counts as
    having a way forward because every chain step links to it, in EITHER of
    its lanes (Waiting or, once promoted, Next);
  · a language switch re-stamps every card's text AND every chain link's
    frozen condition label, without changing any id, so the whole chain still
    resolves after translation;
  · completing a step archives it (clears it), including ⑧ now; the one
    remaining persist-exception (tp) is not a next action that could be
    ticked away.
"""
import os, sys, functools, http.server, socket, socketserver, threading, contextlib
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

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

    def find_tut(key):
        """A chain link's lane changes as it promotes — search wherever it lives."""
        for kind in ("next", "waiting", "current"):
            t = tut(kind, key)
            if t is not None:
                return kind, t
        return None, None

    def kill_tray():
        pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")

    # ---------- the cards seed into the right lanes ----------
    check(tut("next", "t1") is not None, "① seeds into Next Actions")
    for key in ["t2", "t3", "t4", "t5", "t6", "t7", "t8"]:
        check(tut("waiting", key) is not None, f"{key} seeds into Waiting On (the chain)")
    check(tut("current", "tr") is not None, "the healthy reference project (tr) seeds into Current Projects")
    check(tut("current", "tp") is not None, "stalled sample seeds into Current Projects")
    check("1" in (tut("next", "t1") or {}).get("title", ""),
          "the title is numbered — it says what to do")

    # ---------- the chain wiring is real, link by link ----------
    t1 = tut("next", "t1")
    t2, t3, t4, t5, t6, t7, t8 = (tut("waiting", k) for k in ["t2", "t3", "t4", "t5", "t6", "t7", "t8"])
    tr = tut("current", "tr")
    check(t2["conditionId"] == t1["id"] and t2["conditionKind"] == "next",
          "② is hooked to ① (conditionId → ①)")
    check(t2["conditionLabel"] == t1["title"], "and its frozen label reads ①'s title")
    check(t1["linkedProjectId"] == tr["id"], "① is linked to the reference project too")
    check(t2["linkedProjectId"] == tr["id"], "② is linked to the reference project")
    check(t3["conditionId"] == t2["id"] and t3["conditionKind"] == "waiting", "③ is hooked to ②")
    check(t4["conditionId"] == t3["id"], "④ is hooked to ③")
    check(t5["conditionId"] == t4["id"], "⑤ is hooked to ④")
    check(t6["conditionId"] == t5["id"], "⑥ is hooked to ⑤")
    check(t7["conditionId"] == t6["id"], "⑦ is hooked to ⑥")
    check(t8["conditionId"] == t7["id"], "⑧ is hooked to ⑦ — the last link")
    check(all(x["linkedProjectId"] == tr["id"] for x in [t3, t4, t5, t6, t7, t8]),
          "every step is linked to the reference project, not just ②")

    # ---------- exactly one stalled project reaches Review ----------
    kill_tray()
    pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()"); pg.wait_for_timeout(350)
    badge = pg.evaluate("() => { const b = document.querySelector('.tray-review-count'); return b ? b.textContent.trim() : '0'; }")
    check(badge == "1", f"the review badge is 1 — only tp is stalled, tr is not ({badge})")
    pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()"); pg.wait_for_timeout(600)
    first = pg.evaluate("() => { const e = document.querySelector('.review-card-title'); return e ? e.textContent.trim() : null; }")
    check(first and "stalled project" in first, f"and it is tp, the stalled sample ({first})")
    pg.evaluate("() => { const c = document.querySelector('[data-action=\"review-close\"]'); if (c) c.click(); }")
    pg.wait_for_timeout(300); kill_tray()

    # ---------- the chain fires live, and never shows a false orphan ----------
    pg.evaluate("() => { const t = [...document.querySelectorAll('.tab')].find(x => x.getAttribute('data-kind') === 'next'); if (t) t.click(); }")
    pg.wait_for_timeout(300)

    def tick_by_title(kind, title_substr):
        pg.evaluate("""(k) => { const t = [...document.querySelectorAll('.tab')].find(x => x.getAttribute('data-kind') === k); if (t) t.click(); }""", kind)
        pg.wait_for_timeout(250)
        ok = pg.evaluate("""(needle) => {
          const row = [...document.querySelectorAll('.card')].find(c => c.textContent.includes(needle));
          if (!row) return 'no row for: ' + needle;
          const cb = row.querySelector('.check, [data-action="complete"], input[type=checkbox]');
          if (!cb) return 'no checkbox for: ' + needle;
          cb.click(); return 'ok';
        }""", title_substr)
        pg.wait_for_timeout(700)
        return ok

    ok = tick_by_title("next", "CLICK HERE TO START")
    check(ok == "ok", f"① has a completion checkbox and it ticks ({ok})")
    check(tut("next", "t1") is None, "① left the active Next Actions lane (archived)")
    kind2, live2 = find_tut("t2")
    check(kind2 == "next", "② auto-promoted from Waiting into Next Actions — the hook fired live")

    # The bug this round fixed: ③ is still hooked to ②, and ② has just moved
    # lanes (waiting → next) WITHOUT being completed yet. ③'s cue pill must
    # still read as a live hook, not an orphan.
    orphaned = pg.evaluate("""(id) => {
      const btn = document.querySelector('.link-pill[data-kind="waiting"][data-id="' + id + '"]');
      return btn ? btn.classList.contains('cue-orphaned') : 'no pill found';
    }""", t3["id"])
    check(orphaned is False,
          f"③'s cue pill reads live, not orphaned, while ② sits promoted-but-uncompleted ({orphaned})")

    ok = tick_by_title("next", "The interface")
    check(ok == "ok", f"② ticks from Next Actions ({ok})")
    kind3, _ = find_tut("t3")
    check(kind3 == "next", "③ promoted in turn")

    ok = tick_by_title("next", "Creating Items")
    check(ok == "ok", f"③ ticks ({ok})")
    kind4, _ = find_tut("t4")
    check(kind4 == "next", "④ promoted in turn")

    ok = tick_by_title("next", "Creating a waiting action")
    check(ok == "ok", f"④ ticks ({ok})")
    kind5, _ = find_tut("t5")
    check(kind5 == "next", "⑤ promoted in turn")

    ok = tick_by_title("next", "Creating a context")
    check(ok == "ok", f"⑤ ticks ({ok})")
    kind6, _ = find_tut("t6")
    check(kind6 == "next", "⑥ promoted in turn")

    ok = tick_by_title("next", "Create a project")
    check(ok == "ok", f"⑥ ticks ({ok})")
    kind7, _ = find_tut("t7")
    check(kind7 == "next", "⑦ promoted in turn")

    ok = tick_by_title("next", "capture drawer")
    check(ok == "ok", f"⑦ ticks ({ok})")
    kind8, _ = find_tut("t8")
    check(kind8 == "next", "⑧ promoted in turn — the whole chain fired, link by link")

    # ⑧ is a normal chain link now (the OLD copy's habit card never
    # self-completed; the new script doesn't ask for that, see file docstring).
    ok = tick_by_title("next", "Tutorial Final")
    check(ok == "ok", f"⑧ ticks too — no persist-exception on the last step ({ok})")
    check(tut("next", "t8") is None, "⑧ archived like every other step")

    # ---------- language switch re-stamps text but not ids ----------
    # ⚠ Reset to FRESH seed first: the chain above was ticked all the way
    # through, and that persists across a reload.
    pg.evaluate("""() => { Object.keys(localStorage)
      .filter(k => k.indexOf('gtd_') === 0)
      .forEach(k => localStorage.removeItem(k)); }""")
    pg.reload(); pg.wait_for_timeout(1200)
    kill_tray()
    id_before = {k: (tut("next", k) or tut("waiting", k) or tut("current", k) or {}).get("id")
                 for k in ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "tr", "tp"]}
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
    z3 = tut("waiting", "t3")
    check(z3 and z3["conditionLabel"] == z2["title"],
          "so does ③'s — pointing at ②, not ①")
    id_after = {k: (tut("next", k) or tut("waiting", k) or tut("current", k) or {}).get("id")
                for k in ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "tr", "tp"]}
    check(id_before == id_after, f"no card id changed across the switch ({id_before} vs {id_after})")
    check(z2 and z2["conditionId"] == z1["id"] and z2["linkedProjectId"] == tut("current", "tr")["id"],
          "so ②'s hook and project link still resolve after translation")

    # ---------- the persist-exception is NOT a tick-away next action ----------
    tp = tut("current", "tp")
    check(tp is not None and tp.get("tutorialKey") == "tp",
          "the stalled sample persists (removed by 🗑, per the ruling)")
    trz = tut("current", "tr")
    check(trz is not None and trz.get("tutorialKey") == "tr",
          "the reference project persists the same way")

    # put it back to English so later check files see the default
    pg.evaluate("() => document.querySelector('[data-action=\"open-overflow\"]').click()"); pg.wait_for_timeout(250)
    pg.evaluate("() => document.querySelector('[data-action=\"settings-language\"]').click()"); pg.wait_for_timeout(200)
    pg.evaluate("() => document.querySelector('[data-action=\"settings-pick-lang\"][data-lang=\"en\"]').click()"); pg.wait_for_timeout(300)

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

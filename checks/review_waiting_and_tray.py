"""Two user rulings on the review surface.

1. "Stalled projects need more than next actions on the daily review. They
   should also have create waiting action and create event." The event half is
   parked until the projects page can see the calendar; this is the waiting half.

   ⚠ A Waiting action is INVALID without something to wait on (§4.2) — it lands
   in the review as an "orphaned" loop. So a one-box form here would let the
   review manufacture its own next finding: close a stalled project, open an
   orphan. Both fields are required, and that is most of what this file checks.

2. "The empty label shows when there are no captures, but it's not strictly
   true. Stalled projects and orphaned actions should show up as redacted cards
   in the list which can be revealed."

   The Review badge has always counted every open loop, so a drawer reading
   "nothing slipping through the cracks" directly above a badge reading 3 was
   contradicting itself.

⚠ The review shows ONE loop at a time (§4.8b), and the sample data has stalled
projects of its own, so the card on screen is NOT necessarily the one this file
seeded. Everything below reads the visible card's own id out of the DOM and
asserts against that, rather than assuming which project it is looking at. An
earlier draft targeted its own seeded title and simply timed out.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, datetime
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


BASE = datetime.datetime(2026, 6, 15, 10, 0, 0)

STALLED = {"id": "zz-proj", "title": "ZZ stalled project", "notesClean": "",
           "linkedProjectId": None, "isGroup": False, "parent": None,
           "whenText": None, "deadline": None, "contextId": None}
ORPHAN = {"id": "zz-orph", "title": "ZZ stranded waiter", "notesClean": "",
          "linkedProjectId": None, "isGroup": False, "parent": None,
          "whenText": None, "conditionId": "gone-forever", "conditionKind": "next",
          "conditionLabel": "a deleted thing", "bundleText": None, "contextId": None}

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)

    def seed(captures):
        pg.evaluate("""([proj, orph, caps]) => {
          const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
          if (!cur.some(t => t.id === proj.id)) cur.push(proj);
          localStorage.setItem('gtd_tasks_current', JSON.stringify(cur));
          const w = JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]');
          if (!w.some(t => t.id === orph.id)) w.push(orph);
          localStorage.setItem('gtd_tasks_waiting', JSON.stringify(w));
          localStorage.setItem('gtd_tray', JSON.stringify(caps));
        }""", [STALLED, ORPHAN, captures])
        pg.reload(); pg.wait_for_timeout(1000)

    def open_tray():
        pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
        pg.wait_for_timeout(500)

    def tray_state():
        return pg.evaluate("""() => ({
          empty: !!document.querySelector('.tray-empty'),
          cards: document.querySelectorAll('.tray-card').length,
          loops: document.querySelectorAll('.tray-card-loop').length,
          redacted: document.querySelectorAll('.tray-card-redacted').length,
          badge: (document.querySelector('.tray-review-count')||{}).textContent || null,
          texts: [...document.querySelectorAll('.tray-card-text')].map(e => e.textContent.trim()),
        })""")

    # ---------- the drawer no longer claims to be empty ----------
    seed([])
    open_tray()
    st = tray_state()
    check(not st["empty"],
          f"with loops but no captures the drawer does NOT say it is empty ({st})")
    check(st["loops"] >= 2, f"derived loops are listed ({st['loops']})")
    check(st["redacted"] == st["cards"], f"and every card starts redacted ({st})")
    check(st["texts"] == [], f"nothing is readable before revealing ({st['texts']})")
    check(st["badge"] == str(st["cards"]),
          f"the list length matches the badge above it ({st['badge']} vs {st['cards']})")

    # ---------- revealing names them ----------
    pg.evaluate("() => document.querySelector('[data-action=\"tray-reveal\"]').click()")
    pg.wait_for_timeout(400)
    st = tray_state()
    joined = " | ".join(st["texts"])
    # ⚠ The labels are deliberately plain English, not the internal kind names
    # ("stalled"/"orphaned") — the user's jargon pass. Assert the words a reader
    # actually sees, so renaming the internals cannot quietly reintroduce them.
    check("ZZ stalled project" in joined and "no way forward" in joined,
          f"revealed, a stalled project says what is wrong with it ({joined[:140]})")
    check("ZZ stranded waiter" in joined and "waiting on something gone" in joined,
          f"and so does one whose condition was deleted ({joined[:140]})")
    check("orphan" not in joined.lower(),
          f"and the word 'orphan' does not reach the user ({joined[:140]})")

    # ---------- not discardable; tappable ONLY once revealed ----------
    dis = pg.evaluate("""() => [...document.querySelectorAll('.tray-card-loop')]
      .filter(c => c.querySelector('[data-action="tray-delete"]')).length""")
    check(dis == 0, f"a derived loop has no discard button ({dis})")
    # ⚠ REVERSED (user QA): this used to assert a revealed loop card was NOT
    # tappable, on the review's no-cherry-picking rule (§4.8b). The user's ruling:
    # "Once they've hit that reveal button, they've basically opted out of the one
    # at a time rule anyway." The discipline lives in the redaction, so a card you
    # have deliberately unsealed has none left to protect — it was merely inert.
    # The UNREVEALED half is the part that was ever load-bearing, and it is
    # asserted below.
    tappable = pg.evaluate("""() => [...document.querySelectorAll('.tray-card-loop')]
      .filter(c => c.matches('[data-action="tray-open-loop"]')).length""")
    check(tappable == st["cards"],
          f"revealed, every loop card opens its real page ({tappable} of {st['cards']})")

    pg.evaluate("() => document.querySelector('[data-action=\"tray-reveal\"]').click()")
    pg.wait_for_timeout(400)
    sealed = pg.evaluate("""() => [...document.querySelectorAll('.tray-card-loop')]
      .filter(c => c.tagName === 'BUTTON' || c.querySelector('button')).length""")
    check(sealed == 0, f"but sealed again, none of them is tappable ({sealed})")
    pg.evaluate("() => document.querySelector('[data-action=\"tray-reveal\"]').click()")
    pg.wait_for_timeout(400)

    # ---------- captures list alongside them ----------
    before_cards = st["cards"]
    seed([{"id": "c1", "text": "a stray thought", "createdAt": 0}])
    open_tray()
    st = tray_state()
    check(st["cards"] == before_cards + 1, f"a capture adds one card ({st['cards']})")
    check(st["badge"] == str(st["cards"]), f"and the badge keeps up ({st['badge']})")

    # ---------- PAST-DUE counts too ----------
    # ⚠ This case is why the earlier version of the feature was wrong, and why
    # this file previously passed while the bug was live: every fixture above
    # happens to have no overdue items, so "list length == badge" held by
    # accident. With an overdue deadline and an overdue event and nothing else,
    # the badge read 2 and the drawer still said "nothing slipping through the
    # cracks" — the exact complaint the feature was built for.
    pg.evaluate("""() => {
      ['next','waiting','current','future'].forEach(k =>
        localStorage.setItem('gtd_tasks_' + k, '[]'));
      localStorage.setItem('gtd_tasks_next', JSON.stringify([{
        id: 'zz-dl', title: 'ZZ overdue deadline', notesClean: '', linkedProjectId: null,
        isGroup: false, parent: null, whenText: null, hooks: [], contextId: null,
        deadline: { date: '2026-06-01', time: null } }]));
      localStorage.setItem('gtd_events', JSON.stringify([{
        id: 'zz-ev', taskId: 'zz-evt', title: 'ZZ overdue event', date: '2026-06-05',
        time: null, notesClean: '', recurrence: 'none', interval: 1, paused: false,
        contextId: null, linkedProjectId: null, seriesId: null, tickler: false,
        completedOccs: [] }]));
      localStorage.setItem('gtd_tray', '[]');
    }""")
    pg.reload(); pg.wait_for_timeout(1000)
    open_tray()
    st = tray_state()
    check(not st["empty"],
          f"with only overdue items the drawer does not claim to be empty ({st})")
    check(st["badge"] == str(st["cards"]),
          f"the list still matches the badge when the loops are overdue ({st})")
    pg.evaluate("() => document.querySelector('[data-action=\"tray-reveal\"]').click()")
    pg.wait_for_timeout(400)
    joined = " | ".join(tray_state()["texts"])
    check("past its date" in joined,
          f"and an overdue item says what is wrong with it ({joined[:140]})")

    # ---------- genuinely empty still says so ----------
    pg.evaluate("""() => {
      localStorage.setItem('gtd_tray', '[]');
      ['next','waiting','current','future'].forEach(k =>
        localStorage.setItem('gtd_tasks_' + k, '[]'));
      localStorage.setItem('gtd_events', '[]');
    }""")
    pg.reload(); pg.wait_for_timeout(1000)
    open_tray()
    st = tray_state()
    check(st["empty"] and st["cards"] == 0,
          f"with genuinely nothing outstanding it still says so ({st})")

    # ---------- ADD A WAITING ACTION to whichever project the review shows ----------
    seed([])
    open_tray()
    pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
    pg.wait_for_timeout(700)

    def shown_stalled():
        """(project id, title) of the visible card, if it is a stalled one."""
        return pg.evaluate("""() => {
          const card = document.querySelector('.review-card');
          if (!card) return null;
          if (!card.querySelector('[data-action="review-form-start"][data-type="waiting"]')) return null;
          const open = card.querySelector('[data-action="review-open"]');
          const t = card.querySelector('.review-card-title');
          return { id: open ? open.getAttribute('data-id') : null,
                   title: t ? t.textContent.trim() : null };
        }""")

    # Step past anything that is not a stalled project.
    target = None
    for _ in range(12):
        target = shown_stalled()
        if target:
            break
        nn = pg.locator('[data-action="review-defer"]')
        if not nn.count():
            break
        nn.first.click(); pg.wait_for_timeout(400)
    check(target is not None, f"a stalled project reaches the review ({target})")

    if target:
        card = pg.locator(".review-card").first
        btn = card.locator('[data-action="review-form-start"][data-type="waiting"]')
        check(btn.count() > 0, "and offers 'Add a waiting action'")
        btn.first.click(); pg.wait_for_timeout(400)

        check(pg.locator("#review-form-input").count() == 1 and
              pg.locator("#review-form-input2").count() == 1,
              "the form has two boxes — the thing, and what it waits on")

        def made_for(pid):
            return pg.evaluate("""(pid) => JSON.parse(localStorage.getItem('gtd_tasks_waiting'))
                .filter(t => t.linkedProjectId === pid).length""", pid)

        # title missing
        pg.fill("#review-form-input2", "Sarah gets back to me")
        pg.locator('[data-action="review-addwaiting-save"]').first.click(); pg.wait_for_timeout(400)
        check(made_for(target["id"]) == 0, "it will not save without a title")
        check(pg.locator("#review-form-input.field-invalid").count() == 1,
              "and the empty box is outlined, not a popup")
        check(pg.eval_on_selector("#review-form-input2", "e => e.value") == "Sarah gets back to me",
              "the other box keeps what was typed while you fix it")

        # condition missing
        pg.fill("#review-form-input", "The signed contract")
        pg.fill("#review-form-input2", "")
        pg.locator('[data-action="review-addwaiting-save"]').first.click(); pg.wait_for_timeout(400)
        check(made_for(target["id"]) == 0, "nor without something to wait on")
        check(pg.locator("#review-form-input2.field-invalid").count() == 1,
              "and that box is the one outlined")

        # happy path
        pg.fill("#review-form-input2", "Sarah gets back to me")
        pg.locator('[data-action="review-addwaiting-save"]').first.click(); pg.wait_for_timeout(700)
        row = pg.evaluate("""(pid) => JSON.parse(localStorage.getItem('gtd_tasks_waiting'))
            .find(t => t.linkedProjectId === pid) || null""", target["id"])
        check(row is not None, "a complete form creates the waiting action")
        if row:
            check(row["title"] == "The signed contract", f"with the title ({row['title']})")
            check(row["whenText"] == "Sarah gets back to me",
                  f"and what it waits on ({row['whenText']})")

        # ---------- and THAT is what un-stalls the project ----------
        # The point of the whole feature: the new action counts as a way
        # forward, and must NOT come straight back as an orphan.
        pg.reload(); pg.wait_for_timeout(1000)
        loops = pg.evaluate("""(pid) => {
          const cur = JSON.parse(localStorage.getItem('gtd_tasks_current'));
          const w = JSON.parse(localStorage.getItem('gtd_tasks_waiting'));
          return { stillProject: !!cur.find(t => t.id === pid),
                   waiter: w.find(t => t.linkedProjectId === pid) || null };
        }""", target["id"])
        check(loops["waiter"] is not None and loops["waiter"]["conditionId"] is None,
              f"the new waiter uses free text, not a dangling condition ({loops['waiter']})")
        open_tray()
        pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
        pg.wait_for_timeout(700)
        seen = []
        for _ in range(14):
            t = pg.evaluate("""() => {
              const el = document.querySelector('.review-card-title');
              return el ? el.textContent.trim() : null;
            }""")
            if not t:
                break
            seen.append(t)
            nn = pg.locator('[data-action="review-defer"]')
            if not nn.count():
                break
            nn.first.click(); pg.wait_for_timeout(300)
        check(target["title"] not in seen,
              f"the project is no longer reported as stalled ({seen})")
        check("The signed contract" not in seen,
              f"and the new waiting action is not reported as an orphan ({seen})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

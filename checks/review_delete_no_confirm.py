"""Author ruling, third QA round (review-surface-plan.md): Delete in the
review needs no confirm dialog -- the review is a GTD triage pass, and
Delete sits maximally far from every other control (band 3, bottom-right)
as the app's existing defence against a stray tap. The ONE exception is a
recurring event, where "delete" is ambiguous (this occurrence, or the whole
series?) -- that dialog stays.

Covers all five review card kinds' delete path: capture, stalled (project),
orphaned (waiting), past-due deadline (task), and past-due event (both
one-shot -- no confirm -- and recurring -- confirm stays).
"""
import os, functools, http.server, socketserver, socket, threading, contextlib, sys, datetime
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
        """A raw DOM click, dispatched via JS -- Playwright's own .click()
        actionability check sometimes finds #main 'intercepting' a click on
        an element it insists is visible/stable (a quirk of this app's
        transitions, not a real overlap); every other check file in this
        repo that touches the tray/review sidesteps it the same way."""
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

    def no_dialog():
        return pg.locator('.choice-dialog').count() == 0

    def revealed_title():
        return pg.evaluate("""() => { const el = document.querySelector('.review-card-title');
          return el ? el.textContent.trim() : null; }""")

    # ---------- capture ----------
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
    jclick('[data-action="open-tray"]'); pg.wait_for_timeout(300)
    pg.evaluate("""() => { const i = document.querySelector('#tray-input'); i.value = 'ZZ delete no confirm'; }""")
    jclick('[data-action="tray-add"]'); pg.wait_for_timeout(300)
    jclick('[data-action="open-review"]'); pg.wait_for_timeout(500)
    check(revealed_title() == "ZZ delete no confirm", f"fixture: the fresh capture is revealed ({revealed_title()})")
    jclick('[data-action="review-delete-capture"]'); pg.wait_for_timeout(400)
    check(no_dialog(), "capture: no confirm dialog appears")
    still_there = pg.evaluate("() => (JSON.parse(localStorage.getItem('gtd_tray') || '[]')).length")
    check(still_there == 0, f"and the capture is actually gone ({still_there})")
    close_review()

    # ---------- stalled project (the tutorial's own sample) ----------
    open_review()
    kind = pg.evaluate("() => { const c = document.querySelector('.review-card'); return c ? c.className : ''; }")
    check("review-card-stalled" in kind, f"fixture: the stalled sample is revealed ({kind})")
    before = pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]').length")
    jclick('[data-action="review-delete"]'); pg.wait_for_timeout(400)
    check(no_dialog(), "stalled project: no confirm dialog appears")
    after = pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]').length")
    check(after < before, f"and the project is actually gone ({before} -> {after})")
    close_review()

    # ---------- orphaned waiting ----------
    pg.evaluate("""() => {
      const w = JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]');
      w.unshift({ id: 'zz-orphan', title: 'ZZ orphaned no-confirm', notesClean: '',
        conditionId: 'zz-does-not-exist', conditionKind: 'next', whenText: null,
        linkedProjectId: null, contextId: null, createdAt: Date.now() });
      localStorage.setItem('gtd_tasks_waiting', JSON.stringify(w));
    }""")
    pg.reload(); pg.wait_for_timeout(1000)
    open_review()
    check(revealed_title() == "ZZ orphaned no-confirm", f"fixture: the orphaned waiter is revealed ({revealed_title()})")
    jclick('[data-action="review-delete"]'); pg.wait_for_timeout(400)
    check(no_dialog(), "orphaned: no confirm dialog appears")
    gone = pg.evaluate("""() => !JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]')
      .some(t => t.id === 'zz-orphan')""")
    check(gone, "and it is actually gone")
    close_review()

    # ---------- past-due deadline (task) ----------
    pg.evaluate("""() => {
      const n = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
      n.unshift({ id: 'zz-pastdue-task', title: 'ZZ pastdue no-confirm', notesClean: '',
        deadline: { date: '2020-01-01', time: null, pushCount: 0 },
        linkedProjectId: null, contextId: null, createdAt: Date.now() });
      localStorage.setItem('gtd_tasks_next', JSON.stringify(n));
    }""")
    pg.reload(); pg.wait_for_timeout(1000)
    open_review()
    check(revealed_title() == "ZZ pastdue no-confirm", f"fixture: the past-due deadline is revealed ({revealed_title()})")
    jclick('[data-action="review-delete"]'); pg.wait_for_timeout(400)
    check(no_dialog(), "past-due deadline: no confirm dialog appears")
    gone2 = pg.evaluate("""() => !JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]')
      .some(t => t.id === 'zz-pastdue-task')""")
    check(gone2, "and it is actually gone")
    close_review()

    close_review()
    b.close()

    # ---------- past-due RECURRING event: the one exception, confirm stays ----------
    # A fresh page with a faked clock (matching checks/review_skip_live.py's
    # fixture) -- needed so the event is a LIVE pastdue-pseudo card (today's
    # occurrence, overdue but not yet rolled) rather than an already-rolled
    # "missed" card, which the real current date would produce for a fixed
    # historical date like 2020-01-01 (the boundary sweep rolls it all the
    # way forward on load).
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs2 = []
    pg.on("pageerror", lambda e: errs2.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs2.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=datetime.datetime(2026, 6, 15, 15, 0, 0))
    pg.goto(url); pg.wait_for_timeout(1000)
    pg.evaluate("""() => {
      const e = { id: 'zz-ev', taskId: 'zz-ev-task', title: 'ZZ recurring pastdue', date: '2026-06-15',
        time: '09:00', notesClean: '', recurrence: 'weekly', interval: 1,
        paused: false, contextId: null, linkedProjectId: null,
        seriesId: 'zz-s1', tickler: false, completedOccs: [] };
      localStorage.setItem('gtd_events', JSON.stringify([e]));
      const n = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
      localStorage.setItem('gtd_tasks_next', JSON.stringify(n.filter(t => t.id !== 'zz-ev-task')));
    }""")
    pg.reload(); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    jclick('[data-action="open-tray"]'); pg.wait_for_timeout(350)
    jclick('[data-action="open-review"]'); pg.wait_for_timeout(600)
    title = revealed_title()
    check(title == "ZZ recurring pastdue", f"fixture: the live recurring event reached the review ({title})")
    is_pseudo_menu = pg.evaluate("""() => !!document.querySelector('[data-action="review-delete-event"]')""")
    check(is_pseudo_menu, "and it's the pseudo-action shape (review-delete-event), not already-rolled 'missed'")
    jclick('[data-action="review-delete-event"]'); pg.wait_for_timeout(400)
    check(not no_dialog(), "recurring event: the disambiguation dialog DOES appear (the one exception)")
    dialog_text = pg.evaluate("""() => { const d = document.querySelector('.choice-dialog');
      return d ? d.textContent : ''; }""")
    check("Skip" in dialog_text or "skip" in dialog_text.lower(),
          f"and it offers a skip-this-one option, not a bare 'are you sure' ({dialog_text[:120]!r})")
    pg.evaluate("""() => { const btns = [...document.querySelectorAll('.choice-dialog button')];
      const cancel = btns.find(b => b.textContent.trim().toLowerCase().includes('cancel'));
      if (cancel) cancel.click(); }""")
    pg.wait_for_timeout(300)
    still_exists = pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_events') || '[]').length")
    check(still_exists == 1, "Cancel leaves the event untouched")

    # ---------- the ALREADY-ROLLED "missed" card: same button, same dialog ----------
    # Author ruling: "It should be on both pages, and it should get the
    # dialogue. There is no reason those pages should look or behave any
    # differently." Weekly at 23:00 dated the 12th (missed_repeats.py's own
    # fixture shape): today's occurrence (the 19th) hasn't passed yet, so the
    # ONLY open loop is the recorded miss -- the review shows the missed card,
    # not the live pseudo-action.
    pg.evaluate("""() => {
      const e = { id: 'zz-ev2', taskId: 'zz-ev2-task', title: 'ZZ missed recurring', date: '2026-06-12',
        time: '23:00', notesClean: '', recurrence: 'weekly', interval: 1,
        paused: false, contextId: null, linkedProjectId: null,
        seriesId: 'zz-s2', tickler: false, completedOccs: [] };
      localStorage.setItem('gtd_events', JSON.stringify([e]));
      const n = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
      localStorage.setItem('gtd_tasks_next', JSON.stringify(n.filter(t => !t.id.startsWith('zz-ev'))));
    }""")
    pg.reload(); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    jclick('[data-action="open-tray"]'); pg.wait_for_timeout(350)
    jclick('[data-action="open-review"]'); pg.wait_for_timeout(600)
    title2 = revealed_title()
    check(title2 == "ZZ missed recurring", f"fixture: the already-rolled missed card is revealed ({title2})")
    is_missed_menu = pg.evaluate("""() => !!document.querySelector('[data-action="review-missed-clear"]')""")
    check(is_missed_menu, "confirmed it's the missed shape, not the live pseudo-action")
    check(pg.locator('[data-action="review-delete-event-missed"]').count() == 1,
          "the missed card now offers Delete too")
    jclick('[data-action="review-delete-event-missed"]'); pg.wait_for_timeout(400)
    check(not no_dialog(), "and it gets the SAME disambiguation dialog as the live card")
    dialog_text2 = pg.evaluate("""() => { const d = document.querySelector('.choice-dialog');
      return d ? d.textContent : ''; }""")
    check("Skip" in dialog_text2 or "skip" in dialog_text2.lower(),
          f"same skip-this-one / delete-series choice ({dialog_text2[:120]!r})")
    pg.evaluate("""() => { const btns = [...document.querySelectorAll('.choice-dialog button')];
      const del = btns.find(b => b.textContent.trim().toLowerCase().includes('series'));
      if (del) del.click(); }""")
    pg.wait_for_timeout(400)
    ev_gone = pg.evaluate("""() => !JSON.parse(localStorage.getItem('gtd_events') || '[]')
      .some(e => e.id === 'zz-ev2')""")
    check(ev_gone, "'Delete series' actually removes the event")

    errs += errs2

    check(len(errs) == 0, f"no JS errors ({errs})")

    for n in notes: print(n)
    for f in fails: print(f)
    print(f"\n{len(notes)} passed, {len(fails)} failed")
    b.close()
    if fails: sys.exit(1)

"""Deleting a project UNLINKS its actions -- it does not half-delete them.

Author, reporting it: "When deleting a project with linked actions, the app
still behaves as if they are linked actions. The linked actions pill is still on
the card minus the deleted project, and they no longer appear in the picker
because they are still linked to the project."

Asked before any diagnosis (CLAUDE.md golden rule -- bug or design error?), the
ruling was ACTIONS SURVIVE, UNLINKED: deleting a project deletes the project,
and its actions carry on as ordinary standalone actions. Not "delete them too",
not "refuse to delete while linked".

deleteTask() already swept the linked EVENTS clean; the tasks were the half it
never did. Two visible consequences, one in each direction:

  1. The card kept its 🔗 pill. findProjectTitle() had nothing to resolve, so
     it rendered the "linked project" fallback -- a pill naming no project.

  2. Worse, and invisible: linkTargetsFor() excludes anything with a truthy
     linkedProjectId, so the orphan could never be offered to ANOTHER project.
     Tethered to a project that no longer exists, with no way out except the
     action's own page.

Group 3 is the regression guard on the half that was already right: the events
keep their behaviour exactly (unlinked, never deleted -- a meeting can outlive
the project it was booked for).
"""
import os, sys, functools, http.server, socket, socketserver, threading, contextlib
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


FIXTURE = """() => {
    localStorage.setItem('gtd_tasks_next', JSON.stringify([
      { id: 'zz-next', title: 'ZZ THE NEXT ACTION', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: 'zz-doomed', contextId: null, whenText: null, deadline: null }
    ]));
    localStorage.setItem('gtd_tasks_waiting', JSON.stringify([
      { id: 'zz-wait', title: 'ZZ THE WAITING ACTION', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: 'zz-doomed', contextId: null, whenText: 'the shop to call back',
        conditionId: null, conditionKind: null, conditionLabel: null }
    ]));
    localStorage.setItem('gtd_tasks_current', JSON.stringify([
      { id: 'zz-doomed', title: 'ZZ THE DOOMED PROJECT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null, deadline: null },
      { id: 'zz-survivor', title: 'ZZ THE OTHER PROJECT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null, deadline: null }
    ]));
    localStorage.setItem('gtd_tasks_future', '[]');
    localStorage.setItem('gtd_tasks_habit', '[]');
    localStorage.setItem('gtd_events', JSON.stringify([
      { id: 'zz-ev', taskId: 'zz-evt', title: 'ZZ THE SITE MEETING', date: '2099-06-16',
        time: '09:00', notesClean: '', recurrence: 'none', interval: 1, paused: false,
        contextId: null, linkedProjectId: 'zz-doomed', seriesId: 'zz-s1',
        tickler: false, completedOccs: [] }
    ]));
}"""


def clear_decks(pg):
    # Each step leaves something over the lanes -- the capture tray, a dialog,
    # a closed screen's shell -- and a covered lane tab reads as a mysterious
    # 30-second timeout rather than a failure.
    pg.evaluate("""() => {
      ['#tray-root', '#dialog-root', '#screen-root'].forEach(sel => {
        const el = document.querySelector(sel); if (el) el.innerHTML = '';
      });
      document.body.classList.remove('screen-open');
      window.scrollTo(0, 0);
    }""")
    pg.wait_for_timeout(250)


def stored(pg):
    return pg.evaluate("""() => {
      const get = k => JSON.parse(localStorage.getItem('gtd_tasks_' + k) || '[]');
      const evs = JSON.parse(localStorage.getItem('gtd_events') || '[]');
      const find = (k, id) => get(k).find(t => t.id === id) || null;
      const nx = find('next', 'zz-next'), wt = find('waiting', 'zz-wait');
      return {
        nextExists: !!nx, nextLink: nx ? (nx.linkedProjectId || null) : 'MISSING',
        waitExists: !!wt, waitLink: wt ? (wt.linkedProjectId || null) : 'MISSING',
        projectGone: !get('current').some(t => t.id === 'zz-doomed'),
        eventCount: evs.length,
        eventLink: evs.length ? (evs[0].linkedProjectId || null) : 'MISSING'
      };
    }""")


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.goto(url); pg.wait_for_timeout(800)
    pg.evaluate(FIXTURE)
    pg.reload(); pg.wait_for_timeout(900)
    clear_decks(pg)

    before = stored(pg)
    check(before["nextLink"] == "zz-doomed" and before["waitLink"] == "zz-doomed",
          f"fixture: both actions start linked to the project ({before})")

    # ---------- delete the project from its own page ----------
    pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
    pg.locator('.card-title[data-id="zz-doomed"]').first.click(); pg.wait_for_timeout(600)
    dl = pg.locator('[data-action="screen-delete"]')
    check(dl.count() >= 1, "the project page has its 🗑")
    dl.first.click(); pg.wait_for_timeout(400)
    confirm = pg.locator('.choice-dialog-btns button')
    check(confirm.count() >= 1, "and it asks first (DATA DESTRUCTION IS POSSIBLE, NEVER ACCIDENTAL)")
    confirm.first.click(); pg.wait_for_timeout(800)

    # ============================================================
    # Group 1 -- the actions survive, and the link is severed
    # ============================================================
    after = stored(pg)
    check(after["projectGone"], f"the project itself is gone ({after})")
    check(after["nextExists"] and after["waitExists"],
          f"THE RULING: both actions SURVIVE -- deleting a project deletes the project ({after})")
    check(after["nextLink"] is None,
          f"THE BUG: the Next Action's link is severed, not left pointing at a dead id ({after})")
    check(after["waitLink"] is None,
          f"and the Waiting action's too ({after})")

    # ============================================================
    # Group 2 -- and the lanes SHOW it (protocol 1: assert on render)
    # ============================================================
    clear_decks(pg)
    pg.click('.tab[data-kind="next"]'); pg.wait_for_timeout(400)
    pill = pg.evaluate("""() => {
      const card = document.querySelector('.card[data-drag-id="zz-next"]');
      if (!card) return 'NO CARD';
      const p = card.querySelector('.link-pill');
      return p ? p.textContent.trim() : null;
    }""")
    check(pill is None,
          f"THE REPORTED SYMPTOM: no 🔗 pill left on the card -- it used to keep one with no "
          f"project name in it ({pill!r})")
    clear_decks(pg)
    pg.click('.tab[data-kind="waiting"]'); pg.wait_for_timeout(400)
    jump = pg.evaluate("""() => {
      const card = document.querySelector('.card[data-drag-id="zz-wait"]');
      if (!card) return 'NO CARD';
      return card.querySelectorAll('.project-jump').length;
    }""")
    check(jump == 0,
          f"and no green jump-to-project icon on the Waiting card either -- there is nothing to "
          f"jump to ({jump})")

    # ============================================================
    # Group 3 -- the orphans are offerable again
    # ============================================================
    # The half of the report that nothing on screen would have told you about:
    # linkTargetsFor() skips anything carrying a linkedProjectId, so an action
    # tethered to a deleted project was invisible to every project's picker.
    clear_decks(pg)
    pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
    pg.locator('.card-title[data-id="zz-survivor"]').first.click(); pg.wait_for_timeout(600)
    picker = pg.locator('[data-action="open-link-picker"]')
    check(picker.count() >= 1, "the surviving project has a Link existing button")
    picker.first.click(); pg.wait_for_timeout(500)
    offered = pg.evaluate("""() => [...document.querySelectorAll('[data-action="pick-link"]')]
        .map(e => (e.getAttribute('data-id') || '') + '|' + e.textContent.trim())""")
    check(any(x.startswith("zz-next|") for x in offered),
          f"THE OTHER HALF: the orphaned Next Action is offered to another project again ({offered})")
    check(any(x.startswith("zz-wait|") for x in offered),
          f"and so is the orphaned Waiting action ({offered})")

    # ============================================================
    # Group 4 -- the event half stays exactly as it was
    # ============================================================
    ev = stored(pg)
    check(ev["eventCount"] == 1,
          f"REGRESSION GUARD: the linked calendar entry was NOT deleted -- a meeting can outlive "
          f"the project it was booked for ({ev})")
    check(ev["eventLink"] is None,
          f"it was unlinked, same as the actions now are ({ev})")

    check(not errs, f"no JS errors ({errs[:3]})")
    ctx.close()
    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

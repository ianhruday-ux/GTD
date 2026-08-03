"""Deleting a project: what happens to the things linked to it.

Author, reporting the bug: "When deleting a project with linked actions, the app
still behaves as if they are linked actions. The linked actions pill is still on
the card minus the deleted project, and they no longer appear in the picker
because they are still linked to the project."

Asked before any diagnosis (CLAUDE.md golden rule -- bug or design error?), the
ruling was ACTIONS SURVIVE, UNLINKED. deleteTask() already swept the linked
EVENTS clean; the tasks were the half it never did, with two consequences:

  1. The card kept its 🔗 pill -- findProjectTitle() had nothing to resolve, so
     it rendered the "linked project" fallback, a pill naming no project.

  2. Worse, and invisible: linkTargetsFor() excludes anything with a truthy
     linkedProjectId, so the orphan could never be offered to ANOTHER project.
     Tethered to nothing, with no way out but the action's own page.

Then, the author: "I was being lazy by not asking for changes to the dialogue...
The three options should be also delete linked actions, only delete project, and
cancel." So the silent-but-correct outcome became a stated one. The dialog names
the linked set and offers both readings; ORDER follows askDemoteChoice, the
existing three-way twin of this dialog (survivor first and primary, destruction
second and danger-styled, Cancel last), because two near-identical dialogs that
disagree about which button is where is how a stray tap becomes data loss.

Groups 5-7 are the reason the dialog is worth testing at all: an option nobody
proves is an option nobody can trust. Group 8 holds the line on the plain
two-button confirm for a project with nothing linked, and group 9 on the Chinese
copy -- a dialog assembled from five new keys is exactly where an untranslated
fragment hides.
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


FIXTURE = """(locale) => {
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
        linkedProjectId: null, contextId: null, whenText: null, deadline: null },
      { id: 'zz-lonely', title: 'ZZ THE LONELY PROJECT', isGroup: false, parent: null, notesClean: '',
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
    if (locale) localStorage.setItem('gtd_locale', locale); else localStorage.removeItem('gtd_locale');
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


def dialog(pg):
    return pg.evaluate("""() => {
      const d = document.querySelector('.choice-dialog');
      if (!d) return null;
      const p = d.querySelector('p');
      return { msg: p ? p.textContent.trim() : '',
               btns: [...d.querySelectorAll('.choice-dialog-btns button')].map(b => b.textContent.trim()) };
    }""")


def open_delete_dialog(pg, project_id):
    clear_decks(pg)
    pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
    pg.locator('.card-title[data-id="' + project_id + '"]').first.click(); pg.wait_for_timeout(600)
    pg.locator('[data-action="screen-delete"]').first.click(); pg.wait_for_timeout(400)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    errs = []

    @contextlib.contextmanager
    def fresh(locale=None):
        ctx = b.new_context(viewport={"width": 420, "height": 900})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
        pg.goto(url); pg.wait_for_timeout(800)
        pg.evaluate(FIXTURE, locale)
        pg.reload(); pg.wait_for_timeout(900)
        clear_decks(pg)
        try:
            yield pg
        finally:
            ctx.close()

    # ============================================================
    # Group 1 -- the dialog itself
    # ============================================================
    with fresh() as pg:
        before = stored(pg)
        check(before["nextLink"] == "zz-doomed" and before["waitLink"] == "zz-doomed",
              f"fixture: both actions start linked to the project ({before})")
        open_delete_dialog(pg, "zz-doomed")
        d = dialog(pg)
        check(d is not None, "🗑 on a project asks before anything happens")
        check(d and len(d["btns"]) == 3,
              f"THE ASK: three options, not two ({d and d['btns']})")
        check(d and "2 linked actions" in d["msg"],
              f"and the message COUNTS the actions -- the outcome used to be discoverable only by "
              f"going to look at the lane afterwards ({d and d['msg']!r})")
        check(d and "1 linked calendar entry" in d["msg"],
              f"and names the linked calendar entry in the same breath, like completeProject and "
              f"askDemoteChoice do ({d and d['msg']!r})")
        check(d and d["btns"][0] == "Only the project",
              f"ORDER, following askDemoteChoice: the survivor first ({d and d['btns']})")
        check(d and d["btns"][1] == "Delete them too",
              f"destruction second ({d and d['btns']})")
        check(d and d["btns"][2] == "Cancel", f"Cancel last ({d and d['btns']})")

    # ============================================================
    # Group 2 -- Cancel changes nothing
    # ============================================================
    with fresh() as pg:
        open_delete_dialog(pg, "zz-doomed")
        pg.locator('.choice-dialog button:has-text("Cancel")').first.click(); pg.wait_for_timeout(500)
        st = stored(pg)
        check(not st["projectGone"] and st["nextLink"] == "zz-doomed" and st["eventCount"] == 1,
              f"Cancel leaves the project, the actions and the link exactly as they were ({st})")

    # ============================================================
    # Group 3 -- "Only the project": the actions survive, unlinked
    # ============================================================
    with fresh() as pg:
        open_delete_dialog(pg, "zz-doomed")
        pg.locator('.choice-dialog button:has-text("Only the project")').first.click()
        pg.wait_for_timeout(800)
        st = stored(pg)
        check(st["projectGone"], f"the project itself is gone ({st})")
        check(st["nextExists"] and st["waitExists"],
              f"THE RULING: both actions SURVIVE ({st})")
        check(st["nextLink"] is None,
              f"THE BUG: the Next Action's link is severed, not left pointing at a dead id ({st})")
        check(st["waitLink"] is None, f"and the Waiting action's too ({st})")

        # ---- and the lanes SHOW it (protocol 1: assert on render) ----
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

        # ---- the orphans are offerable again ----
        # The half of the report nothing on screen would have told you about.
        clear_decks(pg)
        pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
        pg.locator('.card-title[data-id="zz-survivor"]').first.click(); pg.wait_for_timeout(600)
        pg.locator('[data-action="open-link-picker"]').first.click(); pg.wait_for_timeout(500)
        offered = pg.evaluate("""() => [...document.querySelectorAll('[data-action="pick-link"]')]
            .map(e => (e.getAttribute('data-id') || '') + '|' + e.textContent.trim())""")
        check(any(x.startswith("zz-next|") for x in offered),
              f"THE OTHER HALF: the orphaned Next Action is offered to another project again ({offered})")
        check(any(x.startswith("zz-wait|") for x in offered),
              f"and so is the orphaned Waiting action ({offered})")

        # ---- the event half stays exactly as it was ----
        ev = stored(pg)
        check(ev["eventCount"] == 1,
              f"REGRESSION GUARD: the linked calendar entry was NOT deleted -- a meeting can outlive "
              f"the project it was booked for ({ev})")
        check(ev["eventLink"] is None, f"it was unlinked, same as the actions now are ({ev})")

    # ============================================================
    # Group 4 -- "Delete them too" takes the whole set
    # ============================================================
    with fresh() as pg:
        open_delete_dialog(pg, "zz-doomed")
        pg.locator('.choice-dialog button:has-text("Delete them too")').first.click()
        pg.wait_for_timeout(900)
        st = stored(pg)
        check(st["projectGone"], f"the project is gone ({st})")
        check(not st["nextExists"] and not st["waitExists"],
              f"THE OTHER OPTION: both linked actions go with it ({st})")
        check(st["eventCount"] == 0,
              f"and so does the linked calendar entry -- a 'delete everything linked' that spared "
              f"the calendar would be a surprise in the other direction ({st})")
        gone = pg.evaluate("""() => {
          const t = document.body.innerText;
          return !t.includes('ZZ THE NEXT ACTION') && !t.includes('ZZ THE WAITING ACTION');
        }""")
        check(gone, "and nothing of them is left rendered anywhere")

    # ============================================================
    # Group 5 -- a project with nothing linked keeps the plain confirm
    # ============================================================
    with fresh() as pg:
        open_delete_dialog(pg, "zz-lonely")
        d = dialog(pg)
        check(d and len(d["btns"]) == 2,
              f"no linked anything -> the ordinary two-button confirm, not a three-way question "
              f"about an empty set ({d and d['btns']})")
        check(d and "Delete this for good?" in d["msg"],
              f"with the copy it always had ({d and d['msg']!r})")

    # ============================================================
    # Group 6 -- 简体中文
    # ============================================================
    with fresh("zh-Hans") as pg:
        open_delete_dialog(pg, "zz-doomed")
        d = dialog(pg)
        check(d is not None and len(d["btns"]) == 3, f"the dialog is there in Chinese too ({d})")
        check(d and "只删除项目" in d["btns"][0], f"the survivor button is translated ({d and d['btns']})")
        check(d and "连它们一起删除" in d["btns"][1], f"the delete-both button too, in its plural form ({d and d['btns']})")
        check(d and "取消" in d["btns"][2], f"and Cancel ({d and d['btns']})")
        check(d and "2 个关联的行动" in d["msg"],
              f"the counted noun is translated, not left as an English fragment spliced into a "
              f"Chinese sentence ({d and d['msg']!r})")
        check(d and "1 个关联的日历条目" in d["msg"], f"both nouns ({d and d['msg']!r})")
        check(d and not any(c.isascii() and c.isalpha() for c in d["msg"].replace("ZZ", "")),
              f"and no English leaks through anywhere in the sentence ({d and d['msg']!r})")
        # It still WORKS in Chinese -- a translated button that does nothing is worse than English.
        pg.locator('.choice-dialog button:has-text("只删除项目")').first.click(); pg.wait_for_timeout(800)
        st = stored(pg)
        check(st["projectGone"] and st["nextLink"] is None and st["waitLink"] is None,
              f"and the Chinese button does what the English one does ({st})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

"""Un-completing pushes back the dependents it promoted (spec.md §10).

Reported by the author 2026-07-31: "the pushback from uncompleted items doesn't
work on either the phone or the computer… it was supposed to push the dependency
within a window of about 10 minutes… right now it's 0."

Right, and the reason is that it was never BUILT. spec.md §10 closed the
question with a ruling and a mechanism -- a promoted dependent records
promotedBy/promotedAt, and restoreTask asks lazily whether any live Next Action
says it was promoted by this item inside the window -- and neither field
appeared anywhere in the source. So the window was not misconfigured; there was
no window.

The window is FIVE minutes, narrowed from the spec's ten by the author in the
same message. What it guards is a mistap while scrolling, noticed within
seconds or not at all, so it only has to outlast "wait, wrong row". Beyond it a
promoted dependent has had a life of its own and yanking it back would be the
app overriding the user's more recent reality with an inference.

Offline-only behaviour -- no sync involved, which matches the author's own read
("this is probably unrelated, because it fails offline too").
"""
import os, sys, json, datetime, functools, http.server, socket, socketserver, threading, contextlib, time
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


def boot(b, url):
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(800)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    return ctx, pg, errs


def install_pair(pg, promoted_age_ms=0):
    """A Next Action with one Waiting dependent hanging off it.

    promoted_age_ms back-dates the promotion once it has happened, which is how
    the "outside the window" case is reached without waiting five real minutes.
    """
    pg.evaluate("""(age) => {
        localStorage.setItem('gtd_tasks_next', JSON.stringify([
          { id: 'src-1', title: 'THE SOURCE', isGroup: false, parent: null, notesClean: '',
            linkedProjectId: null, contextId: null, whenText: null }
        ]));
        localStorage.setItem('gtd_tasks_waiting', JSON.stringify([
          { id: 'dep-1', title: 'THE DEPENDENT', isGroup: false, parent: null, notesClean: '',
            linkedProjectId: null, contextId: null, whenText: null,
            conditionId: 'src-1', conditionKind: 'next', conditionLabel: 'THE SOURCE' }
        ]));
        localStorage.setItem('gtd_tasks_current', '[]');
        localStorage.setItem('gtd_tasks_future', '[]');
        localStorage.setItem('gtd_tasks_habit', '[]');
        window.__pushbackAge = age;
    }""", promoted_age_ms)
    pg.reload(); pg.wait_for_timeout(900)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")


def lane(pg, kind):
    return pg.evaluate("(k) => JSON.parse(localStorage.getItem('gtd_tasks_' + k)||'[]').map(t => t.title)", kind)


def rec_in(pg, kind, id_):
    return pg.evaluate("""([k, id]) => (JSON.parse(localStorage.getItem('gtd_tasks_' + k)||'[]')
        .find(t => t.id === id) || null)""", [kind, id_])


def complete_source(pg):
    """Tick THE SOURCE through its real lane checkbox."""
    pg.locator('.lane[data-kind="next"] button.check[data-action="complete"][data-id="src-1"]').first.click()
    pg.wait_for_timeout(700)


def uncomplete_source(pg):
    """Un-tick it from the Completed section, the way a person would."""
    hdr = pg.locator('.lane[data-kind="next"] [data-action="toggle-group"][data-id="__completed_open__"]')
    if hdr.count():
        hdr.first.click(); pg.wait_for_timeout(400)
    pg.locator('.lane[data-kind="next"] [data-action="restore"][data-id="src-1"]').first.click()
    pg.wait_for_timeout(800)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- inside the window, the dependent goes back
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url)
    install_pair(pg1)
    check("THE DEPENDENT" in lane(pg1, "waiting"), f"fixture: the dependent starts in Waiting ({lane(pg1,'waiting')})")

    complete_source(pg1)
    check("THE DEPENDENT" in lane(pg1, "next"),
          f"completing the source promotes it into Next Actions ({lane(pg1,'next')})")
    promoted = rec_in(pg1, "next", "dep-1")
    check(promoted and promoted.get("promotedBy") == "src-1",
          f"THE MECHANISM: the promoted item records WHAT promoted it -- pre-fix this field did not "
          f"exist anywhere in the source ({promoted and promoted.get('promotedBy')})")
    check(promoted and promoted.get("promotedAt"),
          f"and WHEN, which is what the window is measured against ({promoted and promoted.get('promotedAt')})")

    uncomplete_source(pg1)
    check("THE SOURCE" in lane(pg1, "next"), f"the source is back in Next Actions ({lane(pg1,'next')})")
    check("THE DEPENDENT" in lane(pg1, "waiting"),
          f"THE RULING: and the dependent was PUSHED BACK to Waiting -- the fat-finger safety the "
          f"author reported as not working ({lane(pg1,'waiting')})")
    back = rec_in(pg1, "waiting", "dep-1")
    check(back and back.get("conditionId") == "src-1",
          f"with its dependency rebuilt, not just its lane changed ({back and back.get('conditionId')})")
    check(back and not back.get("promotedBy"),
          "and the promotion stamp cleared, so a second un-complete can't push it back twice")
    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")
    ctx1.close()

    # ============================================================
    # Group 2 -- outside the window, it is left alone
    # ============================================================
    # The other half of the ruling, and the half that protects the user from
    # the app: beyond the window a promoted dependent has had a life of its own.
    ctx2, pg2, errs2 = boot(b, url)
    install_pair(pg2)
    complete_source(pg2)
    check("THE DEPENDENT" in lane(pg2, "next"), "fixture: promoted again")

    # Back-date the promotion past the five-minute window.
    pg2.evaluate("""() => {
        const arr = JSON.parse(localStorage.getItem('gtd_tasks_next'));
        const d = arr.find(t => t.id === 'dep-1');
        d.promotedAt = Date.now() - (6 * 60 * 1000);
        localStorage.setItem('gtd_tasks_next', JSON.stringify(arr));
    }""")
    pg2.reload(); pg2.wait_for_timeout(900)
    pg2.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    uncomplete_source(pg2)
    check("THE DEPENDENT" in lane(pg2, "next"),
          f"THE OTHER HALF: six minutes on, the dependent STAYS in Next Actions -- past the window "
          f"the app must not override the user's more recent reality ({lane(pg2,'next')})")
    check("THE DEPENDENT" not in lane(pg2, "waiting"),
          f"and is not duplicated back into Waiting ({lane(pg2,'waiting')})")
    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")
    ctx2.close()

    # ============================================================
    # Group 3 -- the CALENDAR half moved to the same window
    # ============================================================
    # "It's basically the same feature for two different data types, so they
    # should be unified" (author). The pseudo-action revival window was ten
    # minutes and the promotion pushback five; they are now one constant.
    #
    # ⚠ This boundary was previously untested. boundary_4am.py completes and
    # then jumps a whole hour ("undo window long closed") and sync_chunk_a.py
    # un-completes immediately -- both pass at five OR ten, so nothing pinned
    # the value and the unification could have been a no-op nobody noticed.
    # Real clock control, so the assertion is on the boundary itself.
    ctx3 = b.new_context(viewport={"width": 420, "height": 900})
    pg3 = ctx3.new_page()
    errs3 = []
    pg3.on("pageerror", lambda e: errs3.append(str(e)))
    base = datetime.datetime(2026, 8, 3, 12, 0, 0)

    def series_fixture(minutes_after_completion):
        pg3.clock.install(time=base)
        pg3.goto(url); pg3.wait_for_timeout(800)
        pg3.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        # A daily series whose pseudo-action is due today.
        pg3.evaluate("""() => {
            localStorage.setItem('gtd_events', JSON.stringify([{
              id: 'ev-1', taskId: 'pseudo-1', title: 'DAILY THING', date: '2026-08-03',
              time: null, recurrence: 'daily', interval: 1, completedOccs: [],
              completedAt: null, completedFrom: null }]));
        }""")
        pg3.reload(); pg3.wait_for_timeout(900)
        pg3.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        box = pg3.locator('.lane[data-kind="next"] button.check[data-action="complete"]').first
        if not box.count():
            return "NO-CHECKBOX"
        box.click(); pg3.wait_for_timeout(700)
        pg3.clock.set_fixed_time(base + datetime.timedelta(minutes=minutes_after_completion))
        pg3.reload(); pg3.wait_for_timeout(900)
        pg3.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        # ⚠ Toggle only if it is actually collapsed. The collapse state lives in
        # localStorage and this helper runs twice in ONE browser context, so an
        # unconditional click opened it the first time and CLOSED it the second
        # -- which reads as "no restore button" and blames the code for the
        # fixture. Query first, toggle only if that came up empty.
        sel_restore = '.lane[data-kind="next"] [data-action="restore"]'
        if not pg3.locator(sel_restore).count():
            hdr = pg3.locator('.lane[data-kind="next"] [data-action="toggle-group"][data-id="__completed_open__"]')
            if hdr.count():
                hdr.first.click(); pg3.wait_for_timeout(400)
        restore = pg3.locator(sel_restore).first
        if not restore.count():
            return "NO-RESTORE-BUTTON: " + repr(pg3.evaluate("""() => {
                const l = document.querySelector('.lane[data-kind=\"next\"]');
                return l ? l.innerText.slice(0, 300) : 'no lane';
            }"""))
        restore.click(); pg3.wait_for_timeout(700)
        return pg3.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]')
            .some(t => t.title === 'DAILY THING'))""")

    inside = series_fixture(3)
    check(inside is True,
          f"three minutes on, un-completing a series occurrence still rolls it back ({inside})")
    outside = series_fixture(7)
    check(outside is False,
          f"THE UNIFICATION: seven minutes on it is REFUSED -- the calendar half now uses the same "
          f"five-minute window as the promotion pushback, not its old ten ({outside})")
    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")
    ctx3.close()

    # ============================================================
    # Group 4 -- the way back drops the deadline
    # ============================================================
    # §4.13a, restated by the author: "deadlines can't live in the waiting lane."
    # Every other route into Waiting honours it (the page has no deadline field,
    # saveScreen nulls it, the convert button is inert while a date is set), and
    # this one did not: MOVE_MAP only promotes, so pushBackPromotedDependents is
    # the ONLY next→waiting mover in the app, and it preserved the deadline.
    # Promote a dependent, give it a date while it sits in Next, undo the
    # completion inside the window -- it must not go back dated.
    ctx4, pg4, errs4 = boot(b, url)
    install_pair(pg4)
    complete_source(pg4)
    check("THE DEPENDENT" in lane(pg4, "next"), "fixture: the dependent is promoted")
    # Written through storage + reload rather than into the live page: memory and
    # localStorage must never disagree (the sync invariant), and a reload is the
    # one way to set a field this fixture cannot reach through the UI without
    # driving the date picker.
    pg4.evaluate("""() => {
        const arr = JSON.parse(localStorage.getItem('gtd_tasks_next'));
        arr.forEach(t => { if (t.id === 'dep-1') t.deadline = { date: '2099-01-01', time: null }; });
        localStorage.setItem('gtd_tasks_next', JSON.stringify(arr));
    }""")
    pg4.reload(); pg4.wait_for_timeout(900)
    pg4.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    dated = rec_in(pg4, "next", "dep-1")
    check(dated and dated.get("deadline"), f"fixture: it now carries a deadline in Next ({dated and dated.get('deadline')})")
    uncomplete_source(pg4)
    back = rec_in(pg4, "waiting", "dep-1")
    check(bool(back), f"undoing the completion pushes it back to Waiting ({lane(pg4,'waiting')})")
    check(back and not back.get("deadline"),
          f"AND THE DEADLINE IS DROPPED -- a dated thing does not wait ({back and back.get('deadline')})")
    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")
    ctx4.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

"""Un-completing a project brings back everything linked to it — and it survives.

Author's ruling, 2026-08-01, in two parts: *"does the fat finger protection
extend to projects and their linked actions? The answer is yes. Give it the same
timestamp treatment as waiting actions and events."* — then, asked whether it
covered the next actions too: *"Yes, it should extend to everything linked to the
project, including next actions."*

So un-completing a project now reverses all three kinds: the archived WAITING
actions (which always worked), the archived EVENTS (which never did), and the
NEXT actions the completion completed outright (which nothing recorded).

WHAT WAS WRONG. Completing a project archives its linked waiting actions AND its
linked events (`archiveEventsForProject`, chunk 7) — archived rather than deleted
precisely because completing a project is easy to do by mistake and a deleted
series cannot be got back. But `restoreTask()` restored only the waiting half.
`restoreEventsForProject` existed, correct and complete, and was called from
nowhere. So the archive was a one-way door for exactly the mistake it exists to
undo: tick a project by accident, untick it, and its weekly site meeting is gone
from the calendar with the archive still holding a copy nothing can reach.

Chunk A then made both maps SYNC, which fixed the half that crosses devices and
left the local half broken — which is why this reads as a sync bug and is not
one. The same omission had a second site: `deleteCompleted()` dropped a deleted
project's archived WAITING items and left its archived events stranded forever.

THE TIMESTAMP TREATMENT, which is the half that is not obvious. Archiving removes
the events from `gtd_events`, and every removal writes a TOMBSTONE (storage.js
`stampAndTombstone`). A record that comes back carrying its old `modifiedAt` is
therefore OLDER than its own deletion, and the next merge with a device that saw
that tombstone deletes it again — silently, by the rules working correctly. What
saves it is that a restored record is absent from the previous array, so the same
save path stamps it `modifiedAt = now` with this device's id. Group 2 proves the
restore survives that merge, and then proves WHY by rolling the timestamp back
and watching the same merge eat it.

THE NEXT ACTIONS NEEDED A MARKER, not a query. They are not archived — §4.6 has
them complete silently, because they are genuinely done — so "which completed
actions did this project's completion complete?" had no answer in the data.
Completion now stamps `completedByProject`. The obvious alternative, un-completing
every completed action that happens to link to the project, would also resurrect
the ones the user ticked off by hand days earlier: the undo has to reverse the
click, not the week. The fixture below carries one of each and checks they are
told apart.

Protocols 4 and 5 both apply and are honoured in one fixture: the project carries
a linked waiting action, a linked NEXT action, an action the user completed by
hand, a waiting action hooked to the linked one (so completion promotes it and
un-completion must push it back), a linked RECURRING event and a linked note —
through completion, un-completion, deletion, and a sync round trip.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, json, sys, time, datetime
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
BASE = datetime.datetime(2026, 6, 15, 10, 0, 0)

SYNC_STORES = ["gtd_tasks_next", "gtd_tasks_waiting", "gtd_tasks_current", "gtd_tasks_future",
               "gtd_tasks_habit", "gtd_events", "gtd_notes", "gtd_tags", "gtd_contexts",
               "gtd_completed_next", "gtd_completed_waiting", "gtd_completed_current",
               "gtd_completed_future", "gtd_tray", "gtd_archived_waiting", "gtd_archived_events",
               "gtd_habit_runs", "gtd_habit_done"]


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


def empty_bundle():
    return {"roster": {"other-device": {"lastPull": int(time.time() * 1000)}},
            "tombstones": [], "stores": {k: [] for k in SYNC_STORES}}


def boot(b, url):
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)
    close_tray(pg)
    return ctx, pg, errs


def close_tray(pg):
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
    pg.wait_for_timeout(150)


def seed(pg):
    """A project with all three kinds of linked thing (protocol 5), the event
    RECURRING (protocol 4). Seeded rather than clicked because what is under
    test is completion and un-completion, and both of those are driven through
    the real UI below."""
    pg.evaluate("""() => {
        const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
        cur.unshift({ id: 'p-kitchen', title: 'ZZ Kitchen', notesClean: '', isGroup: false,
                      parent: null, linkedProjectId: null, contextId: null, deadline: null });
        localStorage.setItem('gtd_tasks_current', JSON.stringify(cur));

        const wait = JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]');
        wait.unshift({ id: 'w-quote', title: 'ZZ Quote from the fitter', notesClean: '',
                       isGroup: false, parent: null, linkedProjectId: 'p-kitchen',
                       contextId: null, conditionText: 'the fitter calls back',
                       conditionKind: 'text' });
        // Hooked to the linked next action below, NOT to the project: completing
        // that action promotes this one into Next (§4.2), so un-completing has to
        // push it back (§10). Tests the cascade, not the link.
        wait.unshift({ id: 'w-order', title: 'ZZ Order the worktop', notesClean: '',
                       isGroup: false, parent: null, linkedProjectId: null,
                       contextId: null, conditionText: 'ZZ Measure the alcove',
                       conditionKind: 'task', conditionId: 'n-measure' });
        localStorage.setItem('gtd_tasks_waiting', JSON.stringify(wait));

        const nxt = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
        nxt.unshift({ id: 'n-measure', title: 'ZZ Measure the alcove', notesClean: '',
                      isGroup: false, parent: null, linkedProjectId: 'p-kitchen',
                      contextId: null, whenText: null });
        localStorage.setItem('gtd_tasks_next', JSON.stringify(nxt));

        // ⚠ THE DISCRIMINATOR. Linked to the same project and completed BY HAND,
        // before any of this. Un-completing the project must not resurrect it:
        // the undo reverses the click, not the week.
        const done = JSON.parse(localStorage.getItem('gtd_completed_next') || '[]');
        done.unshift({ id: 'n-colour', title: 'ZZ Pick a colour', notesClean: '',
                       isGroup: false, parent: null, linkedProjectId: 'p-kitchen',
                       contextId: null, whenText: null, completedAt: '2026-06-10' });
        localStorage.setItem('gtd_completed_next', JSON.stringify(done));

        localStorage.setItem('gtd_events', JSON.stringify([
          { id: 'e-site', taskId: 't-site', title: 'ZZ Site meeting', date: '2026-06-15',
            time: '09:00', notesClean: '', recurrence: 'weekly', interval: 1, paused: false,
            contextId: null, linkedProjectId: 'p-kitchen', seriesId: 's-site', tickler: false,
            completedOccs: [] }
        ]));

        localStorage.setItem('gtd_notes', JSON.stringify([
          { id: 'n-tiles', title: 'ZZ Tile options', body: '', projectLinks: [{ id: 'p-kitchen', name: 'ZZ Kitchen' }],
            tagIds: [], editedAt: 1 }
        ]));
        localStorage.setItem('gtd_tray', '[]');
    }""")
    pg.reload(); pg.wait_for_timeout(1200); close_tray(pg)


def lane(pg, kind):
    tab = pg.locator('.tab[data-kind="%s"]' % kind)
    if tab.count():
        tab.first.click(); pg.wait_for_timeout(400)
    return pg.evaluate("""(k) => {
      const el = document.querySelector('.lane[data-kind="' + k + '"]');
      return el ? [...el.querySelectorAll('.card-title')].map(e => e.textContent.trim()) : [];
    }""", kind)


def events_now(pg):
    return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_events') || '[]')")


def event_by_id(pg, ev_id):
    return next((e for e in events_now(pg) if e.get("id") == ev_id), None)


def archived_ids(pg, key):
    v = pg.evaluate("(k) => JSON.parse(localStorage.getItem(k) || '[]')", key)
    return [r.get("id") for r in v] if isinstance(v, list) else list(v.keys())


def tombstones_for(pg, record_id):
    return pg.evaluate("""(rid) => JSON.parse(localStorage.getItem('gtd_tombstones') || '[]')
        .filter(t => t && t.recordId === rid)""", record_id)


def complete_project(pg):
    pg.locator('.tab[data-kind="current"]').first.click(); pg.wait_for_timeout(400)
    pg.evaluate("""() => {
      const card = [...document.querySelectorAll('.card')]
        .find(c => (c.querySelector('.card-title') || {}).textContent.trim() === 'ZZ Kitchen');
      const box = card && card.querySelector('[data-action="complete"]');
      if (box) box.click();
    }""")
    pg.wait_for_timeout(500)
    pg.evaluate("""() => { const btns = [...document.querySelectorAll('.choice-dialog-backdrop button')];
        const go = btns.find(x => x.classList.contains('primary') || x.classList.contains('danger'));
        if (go) go.click(); }""")
    pg.wait_for_timeout(900)


def open_completed_project(pg):
    # ⚠ The Completed section is default-collapsed; its rows are not in the DOM
    # until the group header is tapped.
    pg.locator('.tab[data-kind="current"]').first.click(); pg.wait_for_timeout(400)
    pg.evaluate("""() => { const h = document.querySelector('.lane[data-kind="current"] .completed-section .group-header');
                           if (h) h.click(); }""")
    pg.wait_for_timeout(400)
    pg.evaluate("""() => {
      const el = [...document.querySelectorAll('.completed-item-title')]
        .find(e => e.textContent.trim().indexOf('ZZ Kitchen') === 0);
      if (el) el.click();
    }""")
    pg.wait_for_timeout(700)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ================================================================
    # Group 1 -- complete, un-complete, and everything linked comes back
    # ================================================================
    ctx1, pg1, errs1 = boot(b, url)
    seed(pg1)

    ev_before = event_by_id(pg1, "e-site")
    check(ev_before is not None, f"fixture: the linked recurring event exists ({(ev_before or {}).get('title')})")
    check((ev_before or {}).get("recurrence") == "weekly", "fixture: and it repeats (protocol 4)")
    modified_before = (ev_before or {}).get("modifiedAt")
    check(isinstance(modified_before, int), f"fixture: carrying a modifiedAt ({modified_before})")
    check("ZZ Quote from the fitter" in lane(pg1, "waiting"), "fixture: the linked waiting action renders")

    complete_project(pg1)

    check(event_by_id(pg1, "e-site") is None,
          "completing the project takes the event out of the calendar")
    check("p-kitchen" in archived_ids(pg1, "gtd_archived_events"),
          f"and into the archive ({archived_ids(pg1, 'gtd_archived_events')})")
    check("p-kitchen" in archived_ids(pg1, "gtd_archived_waiting"),
          "with the waiting action, as it always did")
    check("ZZ Quote from the fitter" not in lane(pg1, "waiting"),
          "the waiting action is off the lane")
    tombs = tombstones_for(pg1, "e-site")
    check(len(tombs) == 1,
          f"⚠ AND THE REMOVAL WROTE A TOMBSTONE — the thing the restore has to outrank ({tombs})")
    deleted_at = tombs[0]["deletedAt"] if tombs else 0

    # ---- the fix ----
    open_completed_project(pg1)
    restore_btn = pg1.locator('[data-action="completed-restore"]')
    check(restore_btn.count() > 0, "the completed project page offers Restore")
    if restore_btn.count():
        restore_btn.first.click(); pg1.wait_for_timeout(900)

    ev_after = event_by_id(pg1, "e-site")
    check(ev_after is not None,
          "THE FIX: un-completing the project puts its linked event back in the calendar — "
          "before this it stayed archived and unreachable for ever")
    check((ev_after or {}).get("title") == "ZZ Site meeting" and (ev_after or {}).get("recurrence") == "weekly",
          f"the same event, series and all, not a stub ({ev_after and ev_after.get('title')}, "
          f"{ev_after and ev_after.get('recurrence')})")
    check("p-kitchen" not in archived_ids(pg1, "gtd_archived_events"),
          f"and the archive entry is consumed, not left as a duplicate "
          f"({archived_ids(pg1, 'gtd_archived_events')})")
    check("ZZ Quote from the fitter" in lane(pg1, "waiting"),
          "the waiting action came back too, as it always did")
    check("ZZ Kitchen" in lane(pg1, "current"), "and the project itself is live again")

    # ⚑ TODAY'S OCCURRENCE COMES BACK UN-TICKED, and this is the case the ruling
    # was extended to cover. A pseudo-action inherits its event's
    # linkedProjectId, so it IS one of the project's linked next actions and the
    # project's completion ticked it — which the author had never done. Restoring
    # the next actions runs it back through onPseudoActionRestored, which (inside
    # the 10-minute undo window, §4.15c) rolls the series back and un-records the
    # occurrence. Outside that window the row is refused by design: the series has
    # already rolled and putting it back would duplicate the rolled row.
    # Fat-fingering a project and undoing it is the inside-the-window case.
    occs = (ev_after or {}).get("completedOccs") or []
    check(occs == [],
          f"THE EXTENDED RULING: today's occurrence is no longer recorded complete — the tick the "
          f"project's completion applied is undone with it ({occs})")
    check((ev_after or {}).get("completedAt") in (None, 0),
          f"and the series is no longer armed to roll ({(ev_after or {}).get('completedAt')})")
    check("ZZ Site meeting" in lane(pg1, "next"),
          f"RENDERED: so the occurrence is back on the lane, untouched ({lane(pg1, 'next')[:5]})")

    # ---- the third kind: the next actions the completion completed ----
    completed_next = pg1.evaluate("""() => JSON.parse(localStorage.getItem('gtd_completed_next') || '[]')
        .map(t => ({ id: t.id, title: t.title, byProject: t.completedByProject || null }))""")
    live_next = lane(pg1, "next")

    check("ZZ Measure the alcove" in live_next,
          f"THE EXTENDED RULING: the linked NEXT action the project's completion completed is live "
          f"again ({live_next[:5]})")
    check(not any(t["id"] == "n-measure" for t in completed_next),
          f"and gone from the completed list rather than sitting in both ({completed_next})")
    check(any(t["id"] == "n-colour" for t in completed_next),
          f"⚠ THE DISCRIMINATOR: the action the USER completed by hand a week earlier is still "
          f"completed — the undo reverses the click, not the week ({completed_next})")
    check("ZZ Pick a colour" not in live_next,
          f"and it did not reappear on the lane ({live_next[:5]})")
    check(not any(t["byProject"] for t in completed_next),
          f"no stale completedByProject marker is left behind to fire next time ({completed_next})")

    # The cascade, free from reusing restoreTask: completing the linked action
    # promoted its dependent into Next (§4.2), so un-completing pushes it back.
    check("ZZ Order the worktop" in lane(pg1, "waiting"),
          f"RENDERED: the waiting action that completion PROMOTED is pushed back to Waiting "
          f"(§10) ({lane(pg1, 'waiting')[:5]})")
    check("ZZ Order the worktop" not in lane(pg1, "next"),
          f"and is not left duplicated in Next ({lane(pg1, 'next')[:5]})")

    n_measure = pg1.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]')
        .find(t => t.id === 'n-measure') || null""")
    check(n_measure and n_measure.get("modifiedAt", 0) > deleted_at,
          f"and the restored action carries the same fresh stamp the events do, so a stale device "
          f"cannot re-complete it ({n_measure and n_measure.get('modifiedAt')} > {deleted_at})")

    note_state = pg1.evaluate("""() => {
      const n = JSON.parse(localStorage.getItem('gtd_notes') || '[]').find(x => x.id === 'n-tiles');
      return n ? (n.projectLinks || []).map(l => l.id) : null;
    }""")
    check(note_state == ["p-kitchen"], f"the linked note still points at the live project ({note_state})")
    check(not errs1, f"no JS errors ({errs1[:3]})")

    # ================================================================
    # Group 2 -- THE TIMESTAMP TREATMENT: the restore has to outrank its own
    #            tombstone, or the next merge quietly undoes it
    # ================================================================
    modified_after = (ev_after or {}).get("modifiedAt")
    check(isinstance(modified_after, int) and modified_after > deleted_at,
          f"the restored event is stamped NEWER than the deletion that archived it "
          f"({modified_after} > {deleted_at})")
    check(modified_after != modified_before,
          f"i.e. it did NOT come back wearing its pre-completion timestamp ({modified_before})")
    own_device = pg1.evaluate("() => window.__oelaSync.getDeviceId()")
    check((ev_after or {}).get("deviceId") == own_device,
          f"and attributed to the device that restored it ({(ev_after or {}).get('deviceId')})")

    # Now the claim that timestamp is FOR. A device that saw the completion and
    # has not seen the un-completion arrives holding the tombstone.
    baseline = empty_bundle()
    baseline["stores"]["gtd_events"] = []          # what both sides agreed at completion time
    baseline["tombstones"] = [{"id": "tb-1", "store": "gtd_events", "recordId": "e-site",
                               "deletedAt": deleted_at, "modifiedAt": deleted_at,
                               "deviceId": "other-device"}]
    pg1.evaluate("(r) => window.__oelaSync.reconcile(r)", baseline)
    pg1.wait_for_timeout(400)

    stale = empty_bundle()
    stale["stores"]["gtd_events"] = []
    stale["tombstones"] = [{"id": "tb-1", "store": "gtd_events", "recordId": "e-site",
                            "deletedAt": deleted_at, "modifiedAt": deleted_at,
                            "deviceId": "other-device"}]
    pg1.evaluate("(r) => window.__oelaSync.reconcile(r)", stale)
    pg1.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    pg1.wait_for_timeout(700)

    check(event_by_id(pg1, "e-site") is not None,
          "THE POINT OF THE STAMP: a device still holding the completion's tombstone does NOT "
          "re-delete the restored event — the restore is newer, so it wins")

    # RENDERED (protocol 1), and the strongest form of it available here: today's
    # occurrence is ticked (above), so the proof that the SERIES is genuinely
    # running again — not merely sitting in storage — is that it projects at its
    # NEXT occurrence. Advance a week and let the resume sweep run.
    pg1.clock.fast_forward(7 * 24 * 60 * 60 * 1000)
    pg1.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    pg1.wait_for_timeout(900)
    check("ZZ Site meeting" in lane(pg1, "next"),
          f"RENDERED: a week on, the restored series projects into Next Actions again — it survived "
          f"the merge AND is still a live repeat ({lane(pg1, 'next')[:5]})")
    check((event_by_id(pg1, "e-site") or {}).get("date") == "2026-06-22",
          f"having rolled to its next occurrence like any other repeat "
          f"({(event_by_id(pg1, 'e-site') or {}).get('date')})")
    check(not errs1, f"no JS errors through the merge ({errs1[:3]})")
    ctx1.close()

    # ================================================================
    # Group 3 -- and WHY it wins: roll the timestamp back, watch it lose
    # ================================================================
    # Without this, "the event survived" is equally explained by the merge never
    # honouring that tombstone at all, which would make group 2 vacuous.
    ctx3, pg3, errs3 = boot(b, url)
    seed(pg3)
    complete_project(pg3)
    tombs3 = tombstones_for(pg3, "e-site")
    deleted_at3 = tombs3[0]["deletedAt"] if tombs3 else 0
    open_completed_project(pg3)
    rb3 = pg3.locator('[data-action="completed-restore"]')
    if rb3.count():
        rb3.first.click(); pg3.wait_for_timeout(900)
    check(event_by_id(pg3, "e-site") is not None, "fixture: restored again on a fresh device")

    # Put the pre-completion timestamp back — exactly what a restore that reused
    # the archived copy's own modifiedAt would have produced.
    pg3.evaluate("""(old) => {
        const evs = JSON.parse(localStorage.getItem('gtd_events') || '[]');
        const e = evs.find(x => x.id === 'e-site');
        if (e) e.modifiedAt = old;
        localStorage.setItem('gtd_events', JSON.stringify(evs));  // raw write: no re-stamping
    }""", deleted_at3 - 60000)
    pg3.reload(); pg3.wait_for_timeout(1000); close_tray(pg3)

    base3 = empty_bundle()
    base3["stores"]["gtd_events"] = []
    base3["tombstones"] = [{"id": "tb-3", "store": "gtd_events", "recordId": "e-site",
                            "deletedAt": deleted_at3, "modifiedAt": deleted_at3,
                            "deviceId": "other-device"}]
    pg3.evaluate("(r) => window.__oelaSync.reconcile(r)", base3)
    pg3.wait_for_timeout(300)
    pg3.evaluate("(r) => window.__oelaSync.reconcile(r)", base3)
    pg3.wait_for_timeout(600)

    check(event_by_id(pg3, "e-site") is None,
          "CONTROL: with a pre-completion timestamp the SAME merge deletes it — so group 2 is "
          "measuring the stamp, not a merge that ignores tombstones")
    ctx3.close()

    # ================================================================
    # Group 4 -- deleting the completed project for good takes the archive too
    # ================================================================
    ctx4, pg4, errs4 = boot(b, url)
    seed(pg4)
    complete_project(pg4)
    check("p-kitchen" in archived_ids(pg4, "gtd_archived_events"), "fixture: archived again")

    open_completed_project(pg4)
    del_btn = pg4.locator('[data-action="completed-delete"]')
    check(del_btn.count() > 0, "the completed project page offers Delete")
    if del_btn.count():
        del_btn.first.click(); pg4.wait_for_timeout(500)
        pg4.evaluate("""() => { const btns = [...document.querySelectorAll('.choice-dialog-backdrop button')];
            const go = btns.find(x => x.classList.contains('danger'));
            if (go) go.click(); }""")
        pg4.wait_for_timeout(900)

    check("p-kitchen" not in archived_ids(pg4, "gtd_archived_waiting"),
          f"deleting it for good drops the archived waiting items, as it always did "
          f"({archived_ids(pg4, 'gtd_archived_waiting')})")
    check("p-kitchen" not in archived_ids(pg4, "gtd_archived_events"),
          f"THE SECOND SITE: and now the archived events too — they used to be stranded in a map "
          f"nothing could reach, growing for ever and still syncing "
          f"({archived_ids(pg4, 'gtd_archived_events')})")
    check(not errs4, f"no JS errors ({errs4[:3]})")
    ctx4.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)

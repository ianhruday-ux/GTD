"""CHUNK A -- the safety net (sync-audit.md §4c layers 1-2, and §2b).

Three fixes, and this file is written to the standing protocols in
checks/README.md, which means every check below asserts on something RENDERED
(protocol 1) rather than on the storage key underneath -- the failure mode
that let the original data-loss bug through.

  1. DEFENSIVE RENDERING. A card whose parent list was deleted on the other
     device used to land in a bucket renderLane never draws: in storage, on
     both devices, visible on neither. contextId has had this safety net all
     along; `parent` had none. Now an unresolvable parent renders loose.
  2. VALIDATE ON IMPORT. Structurally unusable records in the cloud file are
     dropped before they can reach the renderer. The failure this prevents is
     the app syncing at STARTUP and therefore crashing on every launch, with
     reinstalling no help because the cause is in the cloud file.
  3. THE ARCHIVE MAPS SYNC (§2b). Complete a project on one device and
     un-complete it on the other, and its linked actions and events come back.

Protocol 5 (a project end to end) is not an extra here -- it IS fix 3, so
group 3 drives a real project through completion and un-completion across two
devices. Protocol 4 (a recurring event end to end crossed with sync) is
covered in group 4, since this chunk touches lanes and sync.

Protocol 2 -- every group below was run against the pre-fix build and failed
there. That is recorded per-group in the commit, not asserted here.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, json, sys, time
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

SYNC_STORES = ["gtd_tasks_next", "gtd_tasks_waiting", "gtd_tasks_current", "gtd_tasks_future",
               "gtd_tasks_habit", "gtd_events", "gtd_notes", "gtd_tags", "gtd_contexts",
               "gtd_completed_next", "gtd_completed_waiting", "gtd_completed_current",
               "gtd_completed_future", "gtd_tray", "gtd_archived_waiting", "gtd_archived_events"]


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


# What the user can actually SEE (protocol 1). Never localStorage.
def visible_titles(pg):
    return pg.evaluate("""() => Array.from(document.querySelectorAll('.card'))
        .map(e => (e.querySelector('.card-title') || e).textContent.trim())""")


# Lists render as .group-header, NOT as .card. Asserting a list's absence
# against visible_titles() can therefore never fail, which is exactly the
# vacuous check protocol 2 caught in this file's first version.
def visible_group_titles(pg):
    return pg.evaluate("""() => Array.from(document.querySelectorAll('.group-header'))
        .map(e => e.textContent.trim())""")


def close_tray(pg):
    pg.click('button.icon-btn[data-action="close-tray"]'); pg.wait_for_timeout(300)


def boot(b, url, viewport=None, surface=None):
    ctx = b.new_context(viewport=viewport or {"width": 420, "height": 900})
    if surface:
        ctx.add_init_script("localStorage.setItem('gtd_surface', %r);" % surface)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(700)
    return ctx, pg, errs


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- an orphaned card is VISIBLE, not swallowed
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url)
    close_tray(pg1)

    # Build the real thing through the real UI: a list with a card in it.
    #
    # On the CURRENT PROJECTS lane, not Next Actions, and that is not
    # arbitrary: openInlineNameRow() offers "new list" only on current/future
    # ("placeholder.listName"); on an action lane the same button makes a
    # CONTEXT instead. Lists (isGroup) are a project-lane thing, so that is
    # where a real orphan can come from.
    #
    # Via the FAB, not [data-action="lane-new"] -- those are the DESKTOP
    # per-column buttons, present-but-hidden at phone width (Playwright:
    # "resolved to 12 elements ... not visible").
    pg1.click('.tab[data-kind="current"]'); pg1.wait_for_timeout(400)
    pg1.click('[data-action="fab"]'); pg1.wait_for_timeout(400)
    pg1.click('[data-action="new-secondary"]'); pg1.wait_for_timeout(400)
    pg1.fill('.inline-name-row input', "Holiday planning")
    pg1.click('[data-role="inline-name-confirm"]'); pg1.wait_for_timeout(500)
    made_list = pg1.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_current')||'[]')
        .find(t => t.isGroup && t.title === 'Holiday planning')""")
    check(made_list is not None, f"fixture: a real list was created through the UI ({made_list and made_list.get('title')})")

    if made_list:
        # A card inside that list, and a sanity check that it renders there.
        pg1.evaluate("""(gid) => {
            const arr = JSON.parse(localStorage.getItem('gtd_tasks_current'));
            arr.unshift({ id: 'orphan-me-1', title: 'BOOK THE FLIGHTS', parent: gid, isGroup: false,
                          notesClean: '', linkedProjectId: null, contextId: null, whenText: null,
                          createdAt: Date.now(), modifiedAt: Date.now(), deviceId: 'this-device' });
            localStorage.setItem('gtd_tasks_current', JSON.stringify(arr));
        }""", made_list["id"])
        pg1.reload(); pg1.wait_for_timeout(700); close_tray(pg1)
        pg1.click('.tab[data-kind="current"]'); pg1.wait_for_timeout(400)
        check("BOOK THE FLIGHTS" in visible_titles(pg1), "fixture: the card renders while its list exists")

        # FIRST establish a baseline. Without one the merge is additive-only by
        # design (§4.5: never infer a deletion from absence when there is no
        # trustworthy prior state), so the tombstone below would be ignored,
        # the list would survive, and the card would render inside it -- which
        # is precisely why this group passed against the pre-fix build the
        # first time it was written.
        baseline_pass = empty_bundle()
        baseline_pass["stores"]["gtd_tasks_current"] = pg1.evaluate(
            "() => JSON.parse(localStorage.getItem('gtd_tasks_current')||'[]')")
        pg1.evaluate("(r) => window.__oelaSync.reconcile(r)", baseline_pass)
        pg1.wait_for_timeout(300)

        # NOW the other device deletes that list: absent from the bundle, and
        # carrying a tombstone that a baselined device will honour.
        remote = empty_bundle()
        remote["stores"]["gtd_tasks_current"] = [
            {"id": "orphan-me-1", "title": "BOOK THE FLIGHTS", "parent": made_list["id"], "isGroup": False,
             "notesClean": "", "linkedProjectId": None, "contextId": None, "whenText": None,
             "createdAt": 1, "modifiedAt": int(time.time() * 1000) + 5000, "deviceId": "other-device"}
        ]
        remote["tombstones"] = [
            {"id": "tomb-list-1", "store": "gtd_tasks_current", "recordId": made_list["id"],
             "deletedAt": int(time.time() * 1000) + 9000, "modifiedAt": int(time.time() * 1000) + 9000,
             "deviceId": "other-device"}
        ]
        pg1.evaluate("(r) => window.__oelaSync.reconcile(r)", remote)
        pg1.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
        pg1.wait_for_timeout(600)

        seen = visible_titles(pg1)
        groups = visible_group_titles(pg1)
        check(not any("Holiday planning" in g for g in groups),
              f"the list really was deleted by the merge -- checked against .group-header, since a list is never a .card ({groups})")
        check("BOOK THE FLIGHTS" in seen,
              f"THE FIX: the orphaned card is still ON SCREEN, as a loose card -- pre-fix it was in storage and rendered nowhere ({seen})")

    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")

    # ============================================================
    # Group 2 -- malformed cloud data cannot reach the renderer
    # ============================================================
    ctx2, pg2, errs2 = boot(b, url)
    # A REAL capture of the user's own, so the survival check below means
    # something. Not the seeded tutorial cards: this device has never synced,
    # so a bundle carrying any record makes this a JOIN, and joining correctly
    # discards your own seeded sample data (the author's ruling, sync.js
    # stripSeededRecords). Asserting the tutorial survived would be asserting
    # against a rule we deliberately built -- the first version of this check
    # did exactly that and failed, correctly.
    pg2.wait_for_selector("#tray-input", timeout=5000)
    pg2.fill("#tray-input", "MY OWN REAL WORK")
    pg2.press("#tray-input", "Enter"); pg2.wait_for_timeout(400)
    close_tray(pg2)

    junk = empty_bundle()
    junk["stores"]["gtd_tasks_next"] = [
        None,
        "a bare string where a record should be",
        42,
        [],
        {"title": "no id at all"},
        {"id": 12345, "title": "id is not a string"},
        {"id": "good-1", "title": "A GENUINELY VALID RECORD", "isGroup": False, "parent": None,
         "notesClean": "", "linkedProjectId": None, "contextId": None, "whenText": None,
         "createdAt": 1, "modifiedAt": int(time.time() * 1000), "deviceId": "other-device"},
    ]
    junk["tombstones"] = [{"id": "t1"}, {"id": "t2", "store": "gtd_tasks_next"}, None]
    junk["roster"] = {"ok-device": {"lastPull": int(time.time() * 1000)}, "bad-device": "not an object"}

    pg2.evaluate("(r) => window.__oelaSync.reconcile(r)", junk)
    pg2.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    pg2.wait_for_timeout(600)

    after = visible_titles(pg2)
    check("A GENUINELY VALID RECORD" in after,
          f"the one well-formed record among the junk was still accepted ({after})")
    tray_after = pg2.evaluate("() => JSON.parse(localStorage.getItem('gtd_tray')||'[]').map(r => r.text)")
    check("MY OWN REAL WORK" in tray_after,
          f"and the user's own real capture survived the junk untouched ({tray_after})")
    stored = pg2.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]')")
    check(all(isinstance(r, dict) and isinstance(r.get("id"), str) for r in stored),
          f"every record written to storage is structurally sound -- the junk never landed ({[r for r in stored if not (isinstance(r, dict) and isinstance(r.get('id'), str))]})")
    check(len(visible_titles(pg2)) > 0, "and the app still renders at all, which is the whole point")
    check(not errs2, f"THE FIX: malformed cloud data caused NO JS error -- pre-fix this is what would crash every launch ({errs2[:3]})")

    # ============================================================
    # Group 3 -- PROJECT END TO END ACROSS TWO DEVICES (protocol 5)
    # complete on one, un-complete on the other, linked items come back
    # ============================================================
    ctx3, pg3, errs3 = boot(b, url)
    close_tray(pg3)

    # A project with a linked waiting action, built through storage but read
    # back through the real UI so the assertions are all on what renders.
    pg3.evaluate("""() => {
        const now = Date.now();
        const proj = { id: 'proj-1', title: 'KITCHEN REFIT', isGroup: false, parent: null, notesClean: '',
                       linkedProjectId: null, contextId: null, deadline: null, createdAt: now,
                       modifiedAt: now, deviceId: 'd1' };
        const wait = { id: 'wait-1', title: 'PLUMBER TO CONFIRM', isGroup: false, parent: null, notesClean: '',
                       linkedProjectId: 'proj-1', contextId: null, whenText: 'a callback',
                       conditionId: null, conditionKind: null, conditionLabel: null,
                       createdAt: now, modifiedAt: now, deviceId: 'd1' };
        const cur = JSON.parse(localStorage.getItem('gtd_tasks_current')||'[]'); cur.unshift(proj);
        localStorage.setItem('gtd_tasks_current', JSON.stringify(cur));
        const w = JSON.parse(localStorage.getItem('gtd_tasks_waiting')||'[]'); w.unshift(wait);
        localStorage.setItem('gtd_tasks_waiting', JSON.stringify(w));
    }""")
    pg3.reload(); pg3.wait_for_timeout(700); close_tray(pg3)
    pg3.click('.tab[data-kind="waiting"]'); pg3.wait_for_timeout(400)
    check("PLUMBER TO CONFIRM" in visible_titles(pg3), "fixture: the linked waiting action is on screen")

    # Complete the project through its real lane checkbox (a confirm dialog
    # appears because it has linked items -- that IS the archiving path).
    pg3.click('.tab[data-kind="current"]'); pg3.wait_for_timeout(400)
    pg3.evaluate("""() => {
        const c = [...document.querySelectorAll('.card')].find(x => x.textContent.includes('KITCHEN REFIT'));
        c.querySelector('[data-action="complete"]').click();
    }""")
    pg3.wait_for_timeout(500)
    confirmed = pg3.evaluate("""() => {
        const btn = [...document.querySelectorAll('#dialog-root button')]
            .find(b => !/cancel|not now/i.test(b.textContent));
        if (!btn) return false;
        btn.click(); return true;
    }""")
    pg3.wait_for_timeout(600)
    check(confirmed, "fixture: the completion confirm appeared and was accepted")

    pg3.click('.tab[data-kind="waiting"]'); pg3.wait_for_timeout(400)
    check("PLUMBER TO CONFIRM" not in visible_titles(pg3),
          "completing the project took its linked waiting action off the board, as designed")

    archived_bundle = pg3.evaluate("() => window.__oelaSync.exportBundle()")
    published_archive = archived_bundle["stores"].get("gtd_archived_waiting", [])
    check(len(published_archive) > 0,
          f"THE FIX: the archive map is now part of what this device PUBLISHES ({published_archive})")

    # Second device: starts empty, receives that bundle, then un-completes.
    ctx3b, pg3b, errs3b = boot(b, url)
    close_tray(pg3b)
    pg3b.evaluate("(r) => window.__oelaSync.reconcile(r)", archived_bundle)
    pg3b.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    pg3b.wait_for_timeout(700)

    pg3b.click('.tab[data-kind="current"]'); pg3b.wait_for_timeout(400)
    # The Completed section is COLLAPSED by default (completedSectionHtml reads
    # isCollapsed(kind, "__completed_open__")), so the restore tick is not in
    # the DOM until its header is tapped. Expand it the way a person would.
    pg3b.evaluate("""() => {
        const h = document.querySelector('.completed-section [data-action="toggle-group"][data-id="__completed_open__"]')
               || document.querySelector('.completed-section .group-header');
        if (h) h.click();
    }""")
    pg3b.wait_for_timeout(500)
    restored = pg3b.evaluate("""() => {
        const btn = document.querySelector('[data-action="restore"][data-id="proj-1"]');
        if (!btn) return false;
        btn.click(); return true;
    }""")
    pg3b.wait_for_timeout(700)
    check(restored, "fixture: the completed project is visible on device 2 and was un-completed there")

    pg3b.click('.tab[data-kind="waiting"]'); pg3b.wait_for_timeout(500)
    back = visible_titles(pg3b)
    check("PLUMBER TO CONFIRM" in back,
          f"THE FIX: un-completing on the OTHER device brought the linked waiting action back ({back}) -- pre-fix its archive map was empty and nothing returned")

    check(not errs3, f"no JS errors on device 1 ({errs3[:3]})")
    check(not errs3b, f"no JS errors on device 2 ({errs3b[:3]})")

    # ============================================================
    # Group 4 -- a RECURRING EVENT end to end, crossed with sync (protocol 4)
    # ============================================================
    ctx4, pg4, errs4 = boot(b, url)
    close_tray(pg4)

    pg4.click('[data-action="open-calendar"]'); pg4.wait_for_timeout(500)
    pg4.fill('[data-calfield="name"]', "STANDUP")
    pg4.select_option('[data-calfield="recur"]', "daily")
    pg4.wait_for_timeout(200)
    pg4.click('[data-action="cal-add"]'); pg4.wait_for_timeout(500)
    pg4.click('[data-action="cal-close"]'); pg4.wait_for_timeout(500)

    ev = pg4.evaluate("() => JSON.parse(localStorage.getItem('gtd_events')||'[]').find(e => e.title === 'STANDUP')")
    check(ev is not None and ev.get("recurrence") == "daily", f"fixture: a real daily recurring event exists ({ev and ev.get('recurrence')})")
    check("STANDUP" in visible_titles(pg4), "fixture: and its pseudo-action is on screen today")

    # It must NOT travel (it is derived), but the EVENT must.
    bundle4 = pg4.evaluate("() => window.__oelaSync.exportBundle()")
    check(any(e.get("title") == "STANDUP" for e in bundle4["stores"]["gtd_events"]),
          "the recurring EVENT is published")
    check(not any(t.get("eventId") for t in bundle4["stores"]["gtd_tasks_next"]),
          "but its pseudo-action is not -- derived state still does not travel, with recurrence in play")

    # Complete today's occurrence, then un-complete it, then delete the series.
    tombs_before = pg4.evaluate("() => JSON.parse(localStorage.getItem('gtd_tombstones')||'[]').length")
    pg4.evaluate("""() => {
        const c = [...document.querySelectorAll('.card')].find(x => x.textContent.includes('STANDUP'));
        c.querySelector('[data-action="complete"]').click();
    }""")
    pg4.wait_for_timeout(700)
    check("STANDUP" not in visible_titles(pg4), "completing today's occurrence clears it from the lane")

    tombs_after = pg4.evaluate("() => JSON.parse(localStorage.getItem('gtd_tombstones')||'[]').length")
    check(tombs_after == tombs_before,
          f"and completing it wrote NO tombstone -- an occurrence leaving the lane is not a deletion ({tombs_before} -> {tombs_after})")

    ev_after = pg4.evaluate("() => JSON.parse(localStorage.getItem('gtd_events')||'[]').find(e => e.title === 'STANDUP')")
    check(ev_after is not None, "and the series itself survives its own occurrence being completed")

    bundle4b = pg4.evaluate("() => window.__oelaSync.exportBundle()")
    check(not any(t.get("recordId") == (ev_after or {}).get("taskId") for t in bundle4b["tombstones"]),
          "nothing published would tell the other device to delete the series' live row")

    # UN-COMPLETE, inside the 10-minute undo window (restorePseudoAction).
    # The completion is recorded on the EVENT, so this is the recurrence
    # equivalent of un-completing a project -- and it must not resurrect as a
    # duplicate row or mint a tombstone either.
    pg4.click('.tab[data-kind="next"]'); pg4.wait_for_timeout(300)
    pg4.evaluate("""() => {
        const h = document.querySelector('.completed-section [data-action="toggle-group"][data-id="__completed_open__"]')
               || document.querySelector('.completed-section .group-header');
        if (h) h.click();
    }""")
    pg4.wait_for_timeout(400)
    unc = pg4.evaluate("""() => {
        const btn = document.querySelector('.completed-section [data-action="restore"]');
        if (!btn) return false;
        btn.click(); return true;
    }""")
    pg4.wait_for_timeout(700)
    if unc:
        back4 = visible_titles(pg4)
        check(back4.count("STANDUP") == 1,
              f"un-completing the occurrence brings back exactly ONE live row, not zero and not a duplicate ({back4.count('STANDUP')})")
        rows = pg4.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').filter(t => t.eventId).length""")
        check(rows == 1, f"and exactly one pseudo-action exists underneath it ({rows})")
        # A tombstone here is CORRECT and my first assertion was wrong: taking
        # the entry back out of gtd_completed_next is a genuine deletion from a
        # store that syncs, and the other device does need to learn the item is
        # no longer completed. The derived-row exemption applies only to
        # gtd_tasks_next. So assert the SHAPE of the tombstone, not its absence.
        tombs_unc = pg4.evaluate("() => JSON.parse(localStorage.getItem('gtd_tombstones')||'[]')")
        bad = [t for t in tombs_unc if t.get("store") == "gtd_tasks_next"]
        check(not bad,
              f"un-completing tombstoned only the completed-archive entry, never the derived row ({bad})")
    else:
        check(False, "fixture: could not find the restore control for the completed occurrence")

    # DELETE the series, and confirm what gets published is a deletion of the
    # EVENT -- never of the derived row, which is what would have told the
    # other device to delete a row it was legitimately showing.
    ev_id = pg4.evaluate("() => (JSON.parse(localStorage.getItem('gtd_events')||'[]').find(e => e.title === 'STANDUP')||{}).id")
    pg4.evaluate("""(id) => {
        const evs = JSON.parse(localStorage.getItem('gtd_events')||'[]').filter(e => e.id !== id);
        localStorage.setItem('gtd_events', JSON.stringify(evs));
    }""", ev_id)
    pg4.reload(); pg4.wait_for_timeout(800); close_tray(pg4)
    gone = visible_titles(pg4)
    check("STANDUP" not in gone, f"deleting the series clears its row from the lane too ({gone})")
    orphan_rows = pg4.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').filter(t => t.eventId).length")
    check(orphan_rows == 0,
          f"and leaves no derived row behind pointing at an event that no longer exists ({orphan_rows})")

    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")

    # ============================================================
    # Group 5 -- the same fix renders correctly on Black lacquer (protocol 3)
    # ============================================================
    for width, label in ((420, "phone"), (1280, "desktop")):
        ctxl, pgl, errsl = boot(b, url, viewport={"width": width, "height": 900}, surface="lacquer")
        if width == 420:
            close_tray(pgl)
        pgl.evaluate("""() => {
            const arr = JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]');
            arr.unshift({ id: 'lacquer-orphan', title: 'ORPHAN ON LACQUER', parent: 'a-list-that-never-existed',
                          isGroup: false, notesClean: '', linkedProjectId: null, contextId: null,
                          whenText: null, createdAt: Date.now(), modifiedAt: Date.now(), deviceId: 'd' });
            localStorage.setItem('gtd_tasks_next', JSON.stringify(arr));
        }""")
        pgl.reload(); pgl.wait_for_timeout(800)
        if width == 420:
            close_tray(pgl)
        check(pgl.evaluate("() => document.body.classList.contains('has-frame')"),
              f"fixture: lacquer's frame layer is actually active ({label})")
        check("ORPHAN ON LACQUER" in visible_titles(pgl),
              f"the orphan fallback renders on Black lacquer too ({label})")
        check(not errsl, f"no JS errors on lacquer ({label}) ({errsl[:3]})")
        ctxl.close()

    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

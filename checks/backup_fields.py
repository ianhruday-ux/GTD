"""W7 item 1, the STALENESS half — a backup written by TODAY's app, restored,
still carries every field the app has grown since chunk 8.

`wrapper-plan.md` §W7 item 1 split in two. The SYNC half is ruled, built and
covered by `checks/restore_x_sync.py` (a restore is the truth; identity is never
restored). This file is the other half, the one the in-app chunk map has flagged
as TO DO the whole time: export/import has not been exercised since

  · deadlines gained a start date (`setAt`) and a push counter (`pushCount`),
  · repeats gained a missed-day marker (`missedOcc`),
  · the backgrounds were renamed (walnut/oak/ebony → darkwood/rosewood/lacquer),
  · and chunks A and B RESHAPED four stores from keyed objects to record arrays
    (`gtd_archived_waiting`, `gtd_archived_events`, `gtd_habit_runs`,
    `gtd_habit_done`) so the merge engine could read them.

The last one is why this is not paranoia. A backup is the only feature whose
entire job is to be there when everything else has failed, and it now round-trips
four shapes that did not exist when it was last tested — plus W7's own
`stampRestoredRecords`, which rewrites `modifiedAt`/`deviceId` on every record in
a synced store on the way IN, including those four.

WHAT IS ASSERTED, per checks/README.md protocol 1: both claims, separately.
  · "the data is what it should be" — the named field, by value, out of storage.
  · "the user can see it" — the pushed chip, the paused pill, the lacquer frame,
    the missed-repeat review card, the restored waiting action, all rendered.
Field values are asserted by CONTENT, never by count (protocol 2c): a backup that
silently drops `pushCount` and one that writes `pushCount: 0` are the same bug,
and only a value assertion tells them apart.

⚠ THE VACUITY GUARD, which is what makes this file evidence (protocol 2). A
restore check trivially passes if the data was never actually removed. So between
export and import this wipes localStorage outright, reloads onto a freshly seeded
install, and ASSERTS THE FIXTURE IS GONE before importing it back. Every claim
below that says "survived" is measured across that gap.

Group 2 restores a LEGACY backup — the keyed-object shapes, the bare `paused:
true` boolean, a `gtd_habit_done` of plain date strings, a deadline with no
`setAt`. This is the case that actually bites: files written by the older build
are sitting on the author's disk right now, and every loader's tolerance of the
old shape is load-bearing for them. It asserts on the pre-change data shape
rather than requiring it, per protocol 2a.

⚑ FOUND WHILE WRITING THIS, NOT FIXED HERE (flagged for the author): completing a
project archives its linked EVENTS into `gtd_archived_events`
(`archiveEventsForProject`), but `restoreEventsForProject` — defined at
app.js:1959 — is called from nowhere in the app. `restoreTask()` restores the
archived WAITING actions and stops. So un-completing a project brings its waiting
actions back and leaves its events in the archive. The backup carries the map
faithfully either way, which is this file's claim; the checks below therefore
assert what the app DOES (the map survives; the waiting actions come back), and
do not encode the event half as if it worked.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, json, sys, datetime
from playwright.sync_api import sync_playwright
from _pickers import pick_date

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

# The same clock every dated check in here uses, so the arithmetic is one
# already-verified set (README: "check your own clock arithmetic first").
BASE = datetime.datetime(2026, 6, 15, 10, 0, 0)


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
    ctx = b.new_context(viewport={"width": 420, "height": 900}, accept_downloads=True)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)
    close_tray(pg)
    return ctx, pg, errs


def close_tray(pg):
    # A faked clock freezes the intray's slide, so the animated close button
    # never settles — clear the root instead (README, note 1).
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
    pg.wait_for_timeout(150)


def open_settings(pg):
    pg.click('[data-action="open-overflow"]'); pg.wait_for_timeout(400)


def do_export(pg):
    """The REAL export — the settings row, the download it triggers, the file
    it wrote. No serializeAllData() hook exists to shortcut this, which is
    just as well: the file on disk is the artefact under test."""
    open_settings(pg)
    with pg.expect_download() as dl:
        pg.locator('[data-action="export-data"]').first.click()
    path = dl.value.path()
    with open(path, encoding="utf-8") as f:
        return json.loads(f.read())


def do_import(pg, payload):
    """The REAL import — the file chooser importAllData creates, then the
    danger-styled commit button in the real confirm. Storage pokes prove
    nothing about the path a person takes."""
    open_settings(pg)
    with pg.expect_file_chooser() as fc:
        pg.locator('[data-action="import-data"]').first.click()
    fc.value.set_files({"name": "oela-backup.json", "mimeType": "application/json",
                        "buffer": json.dumps(payload).encode()})
    pg.wait_for_timeout(600)
    pg.locator('.choice-dialog button.danger').first.click()
    pg.wait_for_timeout(1500)   # importAllData reloads the page
    close_tray(pg)


def raw(pg, key):
    return pg.evaluate("(k) => localStorage.getItem(k)", key)


def js(pg, key, dflt=None):
    v = raw(pg, key)
    if v is None:
        return dflt
    try:
        return json.loads(v)
    except ValueError:
        return dflt


def task_by_title(pg, store, title):
    return pg.evaluate("""(a) => (JSON.parse(localStorage.getItem(a.store) || '[]')
        .find(t => t && t.title === a.title) || null)""", {"store": store, "title": title})


def card_deadline(pg, title):
    """What the deadline bar RENDERS for a card — the pushed treatment and the
    counter chip, not the record underneath."""
    return pg.evaluate("""(t) => {
      const card = [...document.querySelectorAll('.card')]
        .find(c => (c.querySelector('.card-title') || {}).textContent.trim() === t);
      if (!card) return null;
      const el = card.querySelector('.deadline-bar');
      return { found: true,
               pushed: !!(el && el.classList.contains('pushed')),
               chip: (card.querySelector('.deadline-push-chip') || {}).textContent || null };
    }""", title)


def lane(pg, kind):
    """Titles rendered in a lane right now — the tab is switched first, because
    a lane that is not on screen renders nothing to assert on."""
    pg.evaluate("""(k) => { const b = document.querySelector('[data-action="tab"][data-kind="' + k + '"]')
                              || document.querySelector('[data-tab="' + k + '"]');
                            if (b) b.click(); }""", kind)
    pg.wait_for_timeout(400)
    return pg.evaluate("""() => [...document.querySelectorAll('.card .card-title')]
        .map(e => e.textContent.trim())""")


def habit_card(pg, title):
    """The habit card's own paused treatment: the ⏸ pill beside the title and
    the greyed checkbox. Both come from the run's OPEN pausedRange."""
    lane(pg, "habit")
    return pg.evaluate("""(t) => {
      const card = [...document.querySelectorAll('.card')]
        .find(c => (c.querySelector('.card-title') || {}).textContent.trim() === t);
      if (!card) return null;
      const pill = [...card.querySelectorAll('.link-pill')].map(e => e.textContent.trim()).join(' | ');
      return { found: true, pill: pill,
               checkPaused: !!card.querySelector('.check.check-paused') };
    }""", title)


def find_in_review(pg, fragment):
    """Walk the review queue with Not now until the card appears, or it runs
    out. Lifted from missed_repeats.py, which already proved the navigation."""
    close_tray(pg)
    pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
    pg.wait_for_timeout(400)
    pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
    pg.wait_for_timeout(700)
    for _ in range(16):
        t = pg.evaluate("""() => { const el = document.querySelector('.review-card-title');
                                   return el ? el.textContent.trim() : null; }""")
        if t is None:
            return False
        if fragment in t:
            return True
        nn = pg.locator('[data-action="review-defer"]')
        if not nn.count():
            return False
        nn.first.click(); pg.wait_for_timeout(300)
    return False


def close_review(pg):
    pg.evaluate("() => { const c = document.querySelector('[data-action=\"review-close\"]'); if (c) c.click(); }")
    pg.wait_for_timeout(400)


def open_completed_item(pg, title):
    """Open a completed item's page.

    ⚠ The Completed section is DEFAULT-COLLAPSED (app.js completedSectionHtml:
    it only ever grows, so closed is the sane default), so its rows do not
    exist in the DOM until the group header is tapped. A check that skips this
    finds nothing and reports it as a missing restore.
    """
    pg.evaluate("""() => { const h = document.querySelector('.completed-section .group-header');
                           if (h) h.click(); }""")
    pg.wait_for_timeout(400)
    pg.evaluate("""(t) => {
      const el = [...document.querySelectorAll('.completed-item-title')]
        .find(e => e.textContent.trim().indexOf(t) === 0);
      if (el) el.click();
    }""", title)
    pg.wait_for_timeout(700)


def is_record_array(v):
    """Chunks A and B's stored shape: a flat array of {id, ...} records. The
    keyed object it replaced is what the merge engine cannot read."""
    return isinstance(v, list) and all(isinstance(r, dict) and isinstance(r.get("id"), str) for r in v)


def find_record(pg, key, rec_id):
    """One record out of a reshaped store, TOLERATING every shape it can be in.

    ⚠ Protocol 2a, and this file was written the wrong way round first: pointed
    at a build where `normalizeReshapedStores()` never ran, a plain list
    comprehension iterated the legacy KEYED OBJECT, hit a bare date string, and
    died with an AttributeError — ending the file and reporting nothing at all,
    which looks like evidence and is not. Tolerating the old shape here is what
    turns that into the legible run of failures the sabotage was meant to prove.
    """
    v = js(pg, key, None)
    if isinstance(v, list):
        return next((r for r in v if isinstance(r, dict) and r.get("id") == rec_id), None)
    if isinstance(v, dict):
        inner = v.get(rec_id)
        if isinstance(inner, dict):
            return dict(inner, id=rec_id)
        if isinstance(inner, str):
            return {"id": rec_id, "date": inner}   # pre-chunk-B gtd_habit_done: a bare date
    return None


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ================================================================
    # Group 1 — a real system out through Export and back through Import
    # ================================================================
    ctx1, pg1, errs1 = boot(b, url)

    # ---- fixture: state the app itself writes, not JSON handed to it -------
    habit_id = pg1.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_habit') || '[]')
        .find(h => !h.isGroup) || {}).id""")
    habit_title = pg1.evaluate("""(id) => (JSON.parse(localStorage.getItem('gtd_tasks_habit') || '[]')
        .find(h => h.id === id) || {}).title""", habit_id)
    check(bool(habit_id), f"fixture: a seeded habit to carry run history ({habit_title})")

    pg1.evaluate("""(a) => {
        // A weekly repeat whose occurrence is already behind us: the boot sweep
        // records the miss and rolls the series — a REAL write of missedOcc,
        // not a hand-set field.
        localStorage.setItem('gtd_events', JSON.stringify([
          { id: 'e-standup', taskId: 't-standup', title: 'ZZ standup', date: '2026-06-12',
            time: '23:00', notesClean: '', recurrence: 'weekly', interval: 1, paused: false,
            contextId: null, linkedProjectId: null, seriesId: 's1', tickler: false,
            completedOccs: [] },
          { id: 'e-site', taskId: 't-site', title: 'ZZ site meeting', date: '2026-06-20',
            time: '09:00', notesClean: '', recurrence: 'weekly', interval: 1, paused: false,
            contextId: null, linkedProjectId: 'p-move', seriesId: 's2', tickler: false,
            completedOccs: [] }
        ]));
        const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
        cur.unshift({ id: 'p-move', title: 'ZZ Move house', notesClean: '', isGroup: false,
                      parent: null, linkedProjectId: null, contextId: null, deadline: null });
        localStorage.setItem('gtd_tasks_current', JSON.stringify(cur));
        const wait = JSON.parse(localStorage.getItem('gtd_tasks_waiting') || '[]');
        wait.unshift({ id: 'w-agent', title: 'ZZ Call the agent', notesClean: '', isGroup: false,
                       parent: null, linkedProjectId: 'p-move', contextId: null,
                       conditionText: 'the survey', conditionKind: 'text' });
        localStorage.setItem('gtd_tasks_waiting', JSON.stringify(wait));
        // A habit mid-run AND paused: history (chunk B), an open pausedRange
        // (W7's dated pause), and a personal best that must not be recomputed
        // away by the restore.
        localStorage.setItem('gtd_habit_runs', JSON.stringify([{
          id: a.habitId, schedule: [0,1,2,3,4,5,6], pausedRanges: [{ from: '2026-06-13', to: null }],
          history: [{ date: '2026-06-10', status: 'done' }, { date: '2026-06-11', status: 'done' },
                    { date: '2026-06-12', status: 'stumble' }],
          currentRunStart: 0, personalBest: 7, bestSequence: ['done','done','done','done','done','done','done'],
          lifetimeTotal: 2, lastProcessedDate: '2026-06-12', pendingResult: null, badge: false
        }]));
        // An assertion, W7's shape: state + the instant it was asserted.
        localStorage.setItem('gtd_habit_done', JSON.stringify([
          { id: a.habitId, date: '2026-06-11', state: 'done', at: 1749600000000 }
        ]));
        localStorage.setItem('gtd_tray', '[]');
    }""", {"habitId": habit_id})
    pg1.reload(); pg1.wait_for_timeout(1200); close_tray(pg1)

    standup = pg1.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_events') || '[]')
        .find(e => e.id === 'e-standup') || null)""")
    check(standup and standup.get("missedOcc") == "2026-06-12",
          f"fixture: the sweep recorded a real missed occurrence ({standup and standup.get('missedOcc')})")
    check(standup and standup.get("date") == "2026-06-19",
          f"fixture: and rolled the series past it ({standup and standup.get('date')})")

    # A deadline, pushed once, through the two real UI paths that write it.
    pg1.click('[data-action="fab"]'); pg1.wait_for_timeout(400)
    pg1.click('[data-action="new-primary"]'); pg1.wait_for_timeout(500)
    pg1.fill('[data-field="title"]', "ZZ Tax return")
    pick_date(pg1, '[data-field="deadline-date"]', "2026-07-05")
    pg1.click('[data-action="screen-save"]'); pg1.wait_for_timeout(700)
    pg1.locator('.card-title:has-text("ZZ Tax return")').first.click(); pg1.wait_for_timeout(600)
    pick_date(pg1, '[data-field="deadline-date"]', "2026-07-25")
    pg1.click('[data-action="screen-save"]'); pg1.wait_for_timeout(700)

    tax = task_by_title(pg1, "gtd_tasks_next", "ZZ Tax return")
    dl_before = (tax or {}).get("deadline") or {}
    check(dl_before.get("pushCount") == 1,
          f"fixture: the deadline carries a push counter ({dl_before.get('pushCount')})")
    check(bool(dl_before.get("setAt")),
          f"fixture: and the start date the bar measures from ({dl_before.get('setAt')})")

    # Black lacquer, through the real picker — the surface ids were renamed
    # after chunk 8, so a backup naming one is exactly the staleness at issue.
    open_settings(pg1)
    pg1.click('[data-action="settings-backgrounds"]'); pg1.wait_for_timeout(300)
    pg1.click('[data-bg="lacquer"]'); pg1.wait_for_timeout(500)
    pg1.keyboard.press("Escape"); pg1.wait_for_timeout(300)
    check(raw(pg1, "gtd_surface") == "lacquer", f"fixture: the surface is Black lacquer ({raw(pg1, 'gtd_surface')})")

    # Complete the project from the lane checkbox — the path that archives its
    # linked waiting actions and events into chunk A's two reshaped maps.
    lane(pg1, "current")
    pg1.evaluate("""() => {
      const card = [...document.querySelectorAll('.card')]
        .find(c => (c.querySelector('.card-title') || {}).textContent.trim() === 'ZZ Move house');
      const box = card && card.querySelector('[data-action="complete"]');
      if (box) box.click();
    }""")
    pg1.wait_for_timeout(500)
    pg1.evaluate("""() => { const btns = [...document.querySelectorAll('.choice-dialog-backdrop button')];
        const go = btns.find(x => x.classList.contains('danger') || x.classList.contains('primary'));
        if (go) go.click(); }""")
    pg1.wait_for_timeout(800)

    arch_w_before = js(pg1, "gtd_archived_waiting", [])
    arch_e_before = js(pg1, "gtd_archived_events", [])
    check(is_record_array(arch_w_before) and any(r["id"] == "p-move" for r in arch_w_before),
          f"fixture: completing the project archived its waiting action ({arch_w_before})")
    check(is_record_array(arch_e_before) and any(r["id"] == "p-move" for r in arch_e_before),
          f"fixture: and its linked event ({arch_e_before})")
    check(not errs1, f"no JS errors building the fixture ({errs1[:3]})")

    # ---- what the backup CONTAINS, by value ------------------------------
    payload = do_export(pg1)
    data = (payload or {}).get("data", {})
    check(bool(data.get("gtd_tasks_next")), f"the backup has data at all ({len(data)} keys)")

    p_tax = next((t for t in json.loads(data.get("gtd_tasks_next") or "[]")
                  if t.get("title") == "ZZ Tax return"), None)
    check((p_tax or {}).get("deadline", {}).get("pushCount") == 1,
          f"the backup carries the deadline's push COUNTER ({(p_tax or {}).get('deadline')})")
    check((p_tax or {}).get("deadline", {}).get("setAt") == dl_before.get("setAt"),
          f"and its start date, unchanged ({(p_tax or {}).get('deadline', {}).get('setAt')})")

    p_stand = next((e for e in json.loads(data.get("gtd_events") or "[]")
                    if e.get("id") == "e-standup"), None)
    check((p_stand or {}).get("missedOcc") == "2026-06-12",
          f"the backup carries the repeat's missed-day marker ({(p_stand or {}).get('missedOcc')})")

    p_run = next((r for r in json.loads(data.get("gtd_habit_runs") or "[]")
                  if r.get("id") == habit_id), None)
    check((p_run or {}).get("pausedRanges") == [{"from": "2026-06-13", "to": None}],
          f"the backup carries the dated pause range ({(p_run or {}).get('pausedRanges')})")
    check(len((p_run or {}).get("history") or []) == 3 and (p_run or {}).get("personalBest") == 7,
          f"and the run history and personal best ({(p_run or {}).get('personalBest')})")

    p_done = next((d for d in json.loads(data.get("gtd_habit_done") or "[]")
                   if d.get("id") == habit_id), None)
    check((p_done or {}).get("state") == "done" and (p_done or {}).get("at") == 1749600000000,
          f"the backup carries the day ASSERTION, not just the date ({p_done})")

    check(data.get("gtd_surface") == "lacquer",
          f"the backup carries the renamed background ({data.get('gtd_surface')})")
    check(any(r.get("id") == "p-move" for r in json.loads(data.get("gtd_archived_waiting") or "[]")),
          "the backup carries the completed project's archived waiting actions")
    check(any(r.get("id") == "p-move" for r in json.loads(data.get("gtd_archived_events") or "[]")),
          "and its archived events")

    # ---- THE VACUITY GUARD: wipe, and prove the wipe took ----------------
    pg1.evaluate("() => localStorage.clear()")
    pg1.reload(); pg1.wait_for_timeout(1200); close_tray(pg1)
    check(task_by_title(pg1, "gtd_tasks_next", "ZZ Tax return") is None,
          "the wipe really removed the fixture — every 'survived' below is measured across this gap")
    check(raw(pg1, "gtd_surface") != "lacquer",
          f"and the surface reverted with it ({raw(pg1, 'gtd_surface')})")

    # ---- restore, and read the fields back -------------------------------
    do_import(pg1, payload)

    tax_after = task_by_title(pg1, "gtd_tasks_next", "ZZ Tax return")
    dl_after = (tax_after or {}).get("deadline") or {}
    check(dl_after.get("pushCount") == 1,
          f"RESTORED: the push counter survived ({dl_after.get('pushCount')})")
    check(dl_after.get("setAt") == dl_before.get("setAt"),
          f"RESTORED: the deadline's start date survived byte-for-byte ({dl_after.get('setAt')})")
    check(dl_after.get("date") == "2026-07-25",
          f"RESTORED: and the pushed-to date itself ({dl_after.get('date')})")

    stand_after = pg1.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_events') || '[]')
        .find(e => e.id === 'e-standup') || null)""")
    check((stand_after or {}).get("missedOcc") == "2026-06-12",
          f"RESTORED: the missed-day marker survived ({(stand_after or {}).get('missedOcc')})")

    run_after = find_record(pg1, "gtd_habit_runs", habit_id)
    check((run_after or {}).get("pausedRanges") == [{"from": "2026-06-13", "to": None}],
          f"RESTORED: the dated pause range survived ({(run_after or {}).get('pausedRanges')})")
    check((run_after or {}).get("personalBest") == 7,
          f"RESTORED: the personal best survived ({(run_after or {}).get('personalBest')})")
    check(len((run_after or {}).get("history") or []) == 3,
          f"RESTORED: the run history survived ({(run_after or {}).get('history')})")

    done_after = find_record(pg1, "gtd_habit_done", habit_id)
    check((done_after or {}).get("state") == "done" and (done_after or {}).get("at") == 1749600000000,
          f"RESTORED: the day assertion kept its state AND its asserted-at ({done_after})")

    check(raw(pg1, "gtd_surface") == "lacquer",
          f"RESTORED: the background preference survived ({raw(pg1, 'gtd_surface')})")

    # The four reshaped stores must come back as RECORD ARRAYS. sync.js reads
    # storage directly, so a restore that reinstated the keyed shape would
    # leave the merge engine unable to read its own stores.
    for key in ["gtd_archived_waiting", "gtd_archived_events", "gtd_habit_runs", "gtd_habit_done"]:
        check(is_record_array(js(pg1, key, None)),
              f"RESTORED: {key} is still a chunk-A/B record array, not a keyed object ({raw(pg1, key)})")

    # ---- and the user can SEE all of it ----------------------------------
    lane(pg1, "next")
    bar_after = card_deadline(pg1, "ZZ Tax return")
    check(bar_after and bar_after["pushed"],
          f"RENDERED: the restored deadline still reads as pushed ({bar_after})")
    check(bar_after and bar_after["chip"] and "1" in bar_after["chip"],
          f"RENDERED: and its counter still says 1 ({bar_after})")

    hc = habit_card(pg1, habit_title)
    check(hc and "⏸" in (hc["pill"] or ""),
          f"RENDERED: the restored habit still shows its paused pill ({hc})")
    check(hc and hc["checkPaused"],
          f"RENDERED: and its checkbox is still inert ({hc})")

    frame = pg1.evaluate("""() => ({ hasFrame: document.body.classList.contains('has-frame'),
                                     layer: !!document.querySelector('#frame-layer, .frame-layer') })""")
    check(frame["hasFrame"],
          f"RENDERED: Black lacquer came back as the lacquer, frame and all ({frame})")

    check(find_in_review(pg1, "ZZ standup"),
          "RENDERED: the restored miss still reaches the daily review")
    close_review(pg1)

    # Un-complete the project: the archived waiting action comes back live.
    lane(pg1, "current")
    open_completed_item(pg1, "ZZ Move house")
    restore_btn = pg1.locator('[data-action="completed-restore"]')
    check(restore_btn.count() > 0, "the restored project opens its completed page")
    if restore_btn.count():
        restore_btn.first.click(); pg1.wait_for_timeout(800)
    check("ZZ Call the agent" in lane(pg1, "waiting"),
          "RENDERED: un-completing the RESTORED project brought its archived waiting action back — "
          "the chunk-A map survived the backup intact")

    check(not errs1, f"no JS errors across the whole round trip ({errs1[:3]})")
    ctx1.close()

    # ================================================================
    # Group 2 — a LEGACY backup: the shapes that are on disk right now
    # ================================================================
    # Written by a build from before chunks A and B, before W7's dated pause,
    # and before deadlines had setAt/pushCount. Every loader claims to tolerate
    # these; this is where that claim is worth something.
    ctx2, pg2, errs2 = boot(b, url)
    # ⚠ The habit LANE has to be in the payload, not borrowed from the install
    # underneath. A lane a backup does not mention is restored EMPTY by ruling
    # (importAllData's KINDS loop, found by restore_x_sync.py), so a run record
    # keyed to a habit the backup never carried has nothing to render on — the
    # app is right and the fixture would be wrong.
    legacy_habit = "old-habit"
    legacy_habit_title = "ZZ Old habit"

    legacy = {"app": "OELA", "format": 1, "exportedAt": "2026-05-01T00:00:00Z", "data": {
        "gtd_tasks_next": json.dumps([
            {"id": "old-1", "title": "ZZ Old deadline", "isGroup": False, "parent": None,
             "notesClean": "", "linkedProjectId": None, "contextId": None,
             # No setAt, no pushCount — a deadline from before either existed.
             "deadline": {"date": "2026-06-30", "time": None}}]),
        "gtd_tasks_current": json.dumps([
            {"id": "old-p", "title": "ZZ Old project", "isGroup": False, "parent": None,
             "notesClean": "", "linkedProjectId": None, "contextId": None, "deadline": None}]),
        "gtd_tasks_waiting": "[]",
        "gtd_tasks_habit": json.dumps([
            {"id": legacy_habit, "title": legacy_habit_title, "isGroup": False, "parent": None,
             "notesClean": "", "linkedProjectId": None, "whenTexts": ["after coffee"], "hooks": []}]),
        "gtd_completed_current": json.dumps([
            {"id": "old-done-p", "title": "ZZ Old finished project", "isGroup": False,
             "parent": None, "notesClean": "", "linkedProjectId": None, "contextId": None,
             "deadline": None, "completedAt": 1746000000000}]),
        # PRE-CHUNK-A: keyed objects, the shape the merge engine cannot read.
        "gtd_archived_waiting": json.dumps(
            {"old-done-p": [{"id": "old-w", "title": "ZZ Archived waiting", "isGroup": False,
                             "parent": None, "notesClean": "", "linkedProjectId": "old-done-p",
                             "contextId": None, "conditionText": "the old thing",
                             "conditionKind": "text"}]}),
        "gtd_archived_events": json.dumps({"old-done-p": []}),
        # PRE-CHUNK-B / PRE-W7: keyed run map, and pause as a bare boolean.
        "gtd_habit_runs": json.dumps({legacy_habit: {
            "schedule": [0, 1, 2, 3, 4, 5, 6], "paused": True,
            "history": [{"date": "2026-04-28", "status": "done"},
                        {"date": "2026-04-29", "status": "done"}],
            "currentRunStart": 0, "personalBest": 4, "bestSequence": ["done"] * 4,
            "lifetimeTotal": 2, "lastProcessedDate": "2026-04-29",
            "pendingResult": None, "badge": False}}),
        # PRE-CHUNK-B: a bare date string, with no way to say "cleared".
        "gtd_habit_done": json.dumps({legacy_habit: "2026-04-29"}),
        "gtd_surface": "lacquer",
    }}
    do_import(pg2, legacy)

    check(not errs2, f"THE CLAIM: a legacy backup imports with no JS error at all ({errs2[:3]})")
    check("ZZ Old deadline" in lane(pg2, "next"),
          f"RENDERED: its actions came back ({lane(pg2, 'next')[:4]})")
    check("ZZ Old project" in lane(pg2, "current"),
          "RENDERED: and its projects")

    lane(pg2, "next")
    old_bar = card_deadline(pg2, "ZZ Old deadline")
    check(old_bar and old_bar["found"],
          f"RENDERED: a deadline with no setAt and no pushCount still draws ({old_bar})")
    check(old_bar and not old_bar["pushed"] and not old_bar["chip"],
          f"and reads as never pushed rather than pushed zero times ({old_bar})")

    for key in ["gtd_archived_waiting", "gtd_archived_events", "gtd_habit_runs", "gtd_habit_done"]:
        check(is_record_array(js(pg2, key, None)),
              f"normalizeReshapedStores converted {key} to a record array on the next boot "
              f"({raw(pg2, key)})")

    legacy_run = find_record(pg2, "gtd_habit_runs", legacy_habit)
    check(legacy_run and legacy_run.get("personalBest") == 4,
          f"the legacy run's personal best came through the reshape ({(legacy_run or {}).get('personalBest')})")
    check(legacy_run and len(legacy_run.get("history") or []) == 2,
          f"and its history ({(legacy_run or {}).get('history')})")

    hc2 = habit_card(pg2, legacy_habit_title)
    check(hc2 and "⏸" in (hc2["pill"] or ""),
          f"RENDERED: the legacy `paused: true` boolean became a dated range and still reads as paused ({hc2})")

    legacy_done = find_record(pg2, "gtd_habit_done", legacy_habit)
    check(legacy_done is not None and legacy_done.get("date") == "2026-04-29",
          f"the legacy done-date survived the reshape ({legacy_done})")

    # The keyed archive map, restored and normalized, still un-completes.
    lane(pg2, "current")
    open_completed_item(pg2, "ZZ Old finished project")
    rb2 = pg2.locator('[data-action="completed-restore"]')
    if rb2.count():
        rb2.first.click(); pg2.wait_for_timeout(800)
    check("ZZ Archived waiting" in lane(pg2, "waiting"),
          "RENDERED: un-completing a project restored from a PRE-CHUNK-A backup still returns its "
          "archived waiting action — the keyed map was converted, not dropped")

    check(raw(pg2, "gtd_surface") == "lacquer",
          f"and the legacy backup's background preference applied ({raw(pg2, 'gtd_surface')})")
    check(not errs2, f"no JS errors across the legacy restore ({errs2[:3]})")
    ctx2.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)

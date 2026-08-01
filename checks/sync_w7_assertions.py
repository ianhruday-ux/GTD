"""W7 -- un-completing is an ASSERTION, and pause is a DATED RANGE.

The rulings this file encodes (author, 2026-07-31):

  1. THE DAY-ASSERTION LAYER. Un-ticking used to DELETE the habitDone record,
     which made a deliberate correction into an ABSENCE -- and absence is what
     the sweep reads as "nobody did this", an inference. So the merge's own
     rule ("an inference must never overwrite an assertion") threw the
     correction away and DONE WINS resurrected the fat-finger, permanently,
     the moment either device promoted the day into history. Now a tick and an
     un-tick are both assertions, both stored, and a contested day is settled
     by WHICHEVER IS LATER. Done-beats-miss is unchanged -- it just no longer
     has to stand in for "explicitly not done", which had no way to be said.

  2. assertedAt SURVIVES THE SWEEP. History entries carry the stamp of the act
     that produced them. Without it, two devices that had each promoted the
     same day hold entries indistinguishable from genuine inferences, and the
     ruling silently stops holding at the 4am boundary.

  3. PAUSE IS A DATED RANGE, [from, to). A boolean said only "parked now" and
     carried no opinion about any given day, so a device that had not yet
     heard about the pause went on sweeping misses -- which union in and
     cannot be beaten by anything but a done. Dating it makes the protection
     RETROACTIVE: a stale device's fabricated misses are filtered at replay
     time once the range arrives, rather than having to be prevented.

  4. MEMORY FOLLOWS STORAGE, for habits too. reloadSyncedStateFromStorage did
     not reload habitRuns/habitDone at all, so a merged history reached
     localStorage and never memory -- and §4.3's sweep gate was protecting
     nothing, since the sweep read pre-pull memory however long it had waited.

Written to the protocols in checks/README.md. Group 4 in particular asserts on
what RENDERED, not on localStorage -- localStorage was the one place the
chunk-B bug was already correct, which is exactly why no check caught it.
"""
import os, sys, functools, http.server, socket, socketserver, threading, contextlib, time
from playwright.sync_api import sync_playwright

# The Windows console is cp1252 and several of these messages quote rendered UI
# containing U+23F8 (the pause glyph). Without this the file dies in its own
# final print loop, AFTER every check has run -- discarding the results.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

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
    return {"roster": {"other": {"lastPull": int(time.time() * 1000)}},
            "tombstones": [], "stores": {k: [] for k in SYNC_STORES}}


def boot(b, url):
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(700)
    pg.click('button.icon-btn[data-action="close-tray"]'); pg.wait_for_timeout(300)
    goto_habits(pg)
    return ctx, pg, errs


def goto_habits(pg):
    """Select the habit lane. Nothing habit-shaped is even in the DOM until."""
    pg.click('.tab[data-kind="habit"]'); pg.wait_for_timeout(400)


def habit_box(pg, habit_id):
    """The habit's checkbox, wherever the lane has put its card.

    ⚠ A habit ticked off TODAY leaves the active list for the lane's
    "Completed" section, which is COLLAPSED by default -- so the button is not
    in the DOM at all until that section is opened, and it moves BACK when the
    habit is un-ticked. Both directions happen inside these groups, so this
    toggles the section until the button turns up rather than assuming which
    side of the lane it is on. habit_runner_states.py hit the same wall.
    """
    sel = f'button.check[data-action="toggle-habit"][data-id="{habit_id}"]'
    for _ in range(3):
        if pg.locator(sel).count() and pg.locator(sel).first.is_visible():
            return pg.locator(sel).first
        hdr = pg.locator('[data-action="toggle-group"][data-id="__completed_open__"]')
        if not hdr.count():
            break
        hdr.first.click(); pg.wait_for_timeout(350)
    return pg.locator(sel).first


def box_class(pg, habit_id):
    """The checkbox's class list, or "" if the lane is not showing it at all.

    Never raises: a missing button is a legible FAIL on the check that wanted
    it, not a traceback that abandons every group after this one.
    """
    sel = f'button.check[data-action="toggle-habit"][data-id="{habit_id}"]'
    habit_box(pg, habit_id)
    if not pg.locator(sel).count():
        return ""
    return pg.locator(sel).first.get_attribute("class") or ""


def first_habit(pg):
    return pg.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_habit')||'[]')
        .find(h => !h.isGroup) || {}).id""")


def done_record(pg, habit_id):
    """The habitDone entry as stored -- tolerating every shape it has had."""
    return pg.evaluate("""(id) => {
        const raw = JSON.parse(localStorage.getItem('gtd_habit_done') || '[]');
        if (Array.isArray(raw)) return raw.find(r => r && r.id === id) || null;
        return raw && raw[id] !== undefined ? { id: id, date: raw[id] } : null;
    }""", habit_id)


def run_for(pg, habit_id):
    return pg.evaluate("""(id) => {
        const raw = JSON.parse(localStorage.getItem('gtd_habit_runs') || '[]');
        return Array.isArray(raw) ? (raw.find(r => r && r.id === id) || null) : (raw[id] || null);
    }""", habit_id)


def today_str(pg):
    """The app's OWN idea of today -- 4am day start, so never re-derive it here."""
    return pg.evaluate("""() => {
        const d = new Date(); d.setHours(d.getHours() - 4);
        return d.toLocaleDateString('en-CA');
    }""")


def tombstones_for(pg, store):
    return pg.evaluate("""(s) => (JSON.parse(localStorage.getItem('gtd_tombstones') || '[]'))
        .filter(t => t && t.store === s)""", store)


def write_run(pg, habit_id, patch):
    """Overwrite one habit's run record in place, tolerating the pre-W7 shape."""
    pg.evaluate("""(args) => {
        const raw = JSON.parse(localStorage.getItem('gtd_habit_runs') || '[]');
        const arr = Array.isArray(raw)
          ? raw : Object.keys(raw).map(k => Object.assign({ id: k }, raw[k]));
        const i = arr.findIndex(r => r && r.id === args.id);
        const rec = Object.assign(i >= 0 ? arr[i] : { id: args.id }, args.patch);
        if (i >= 0) arr[i] = rec; else arr.push(rec);
        localStorage.setItem('gtd_habit_runs', JSON.stringify(arr));
    }""", {"id": habit_id, "patch": patch})


def remote_run(habit_id, history, extra=None):
    rec = {"id": habit_id, "schedule": [0, 1, 2, 3, 4, 5, 6], "pausedRanges": [],
           "history": history, "currentRunStart": 0, "personalBest": 0, "bestSequence": [],
           "lifetimeTotal": len([h for h in history if h["status"] == "done"]),
           "lastProcessedDate": None, "pendingResult": None, "badge": False,
           "modifiedAt": int(time.time() * 1000), "deviceId": "other-device"}
    if extra:
        rec.update(extra)
    return rec


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- un-ticking is an ASSERTION, not a deletion
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url)
    hid = first_habit(pg1)
    check(bool(hid), f"fixture: a seeded habit exists ({hid})")
    today = today_str(pg1)

    habit_box(pg1, hid).click(); pg1.wait_for_timeout(500)
    ticked = done_record(pg1, hid)
    check((ticked or {}).get("state") == "done",
          f"a tick records a DONE assertion ({ticked})")
    check(bool((ticked or {}).get("at")), f"stamped with when it was made ({(ticked or {}).get('at')})")

    habit_box(pg1, hid).click(); pg1.wait_for_timeout(500)
    cleared = done_record(pg1, hid)
    check(cleared is not None,
          "THE FIX: un-ticking leaves a RECORD behind -- pre-W7 it deleted the entry, "
          f"turning a deliberate correction into an absence the merge is built to discard ({cleared})")
    check((cleared or {}).get("state") == "cleared",
          f"and the record says explicitly-not-done, not merely nothing ({cleared})")
    check((cleared or {}).get("at", 0) > (ticked or {}).get("at", 0),
          "and carries a LATER stamp than the tick it corrects -- which is what settles the merge")

    check(not tombstones_for(pg1, "gtd_habit_done"),
          "and mints NO tombstone: the record was superseded, not removed "
          f"({tombstones_for(pg1, 'gtd_habit_done')})")

    # Requirement 2 from the ruling: re-completing after un-completing works.
    habit_box(pg1, hid).click(); pg1.wait_for_timeout(500)
    again = done_record(pg1, hid)
    check((again or {}).get("state") == "done" and (again or {}).get("at", 0) > (cleared or {}).get("at", 0),
          f"re-completing after un-completing works -- simply a third, later assertion ({again})")
    check("checked" in box_class(pg1, hid),
          "and the checkbox renders ticked again")
    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")
    ctx1.close()

    # ============================================================
    # Group 2 -- a LATER un-tick beats an EARLIER promoted done
    # ============================================================
    # The shape of the real failure: the fat-finger reached the other device,
    # that device promoted it into history at its own 4am, and the correction
    # has to be able to win afterwards.
    ctx2, pg2, errs2 = boot(b, url)
    hid2 = first_habit(pg2)
    t_tick = int(time.time() * 1000) - 600000     # 09:00 -- the accident
    t_clear = int(time.time() * 1000) - 300000    # 09:05 -- noticed and corrected

    # This device sweptable the day as a miss, FROM the un-tick assertion.
    write_run(pg2, hid2, {
        "schedule": [0, 1, 2, 3, 4, 5, 6], "pausedRanges": [],
        "history": [{"date": "2026-07-20", "status": "done", "assertedAt": t_tick - 90000},
                    {"date": "2026-07-21", "status": "stumble", "assertedAt": t_clear}],
        "currentRunStart": 0, "personalBest": 0, "bestSequence": [], "lifetimeTotal": 1,
        "modifiedAt": int(time.time() * 1000), "deviceId": "this-device"})
    pg2.reload(); pg2.wait_for_timeout(700)
    pg2.click('button.icon-btn[data-action="close-tray"]'); pg2.wait_for_timeout(300)
    goto_habits(pg2)

    base = empty_bundle()
    base["stores"]["gtd_habit_runs"] = [remote_run(hid2, [
        {"date": "2026-07-20", "status": "done", "assertedAt": t_tick - 90000}])]
    pg2.evaluate("(r) => window.__oelaSync.reconcile(r)", base)
    pg2.wait_for_timeout(300)

    # The other device promoted the ACCIDENT, stamped with the earlier tick.
    remote = empty_bundle()
    remote["stores"]["gtd_habit_runs"] = [remote_run(hid2, [
        {"date": "2026-07-20", "status": "done", "assertedAt": t_tick - 90000},
        {"date": "2026-07-21", "status": "done", "assertedAt": t_tick},
    ], {"modifiedAt": int(time.time() * 1000) + 60000})]  # and its record is NEWER
    res2 = pg2.evaluate("(r) => window.__oelaSync.reconcile(r)", remote)
    pg2.wait_for_timeout(400)

    merged = run_for(pg2, hid2)
    statuses = {h["date"]: h["status"] for h in (merged or {}).get("history", [])}
    check(statuses.get("2026-07-21") != "done",
          "THE RULING: the later UN-TICK beat the earlier tick, even though the device holding the "
          f"tick had the newer record -- pre-W7 done-wins resurrected the fat-finger ({statuses})")
    check(statuses.get("2026-07-20") == "done",
          f"and a day nobody contested is untouched ({statuses})")
    check((merged or {}).get("lifetimeTotal") == 1,
          f"the lifetime total was recomputed from the corrected history ({(merged or {}).get('lifetimeTotal')})")
    check(any(c.get("habitDays") for c in res2["conflicts"]),
          "and the disagreement was REPORTED, not applied silently")
    resolved = [c.get("habitResolved") for c in res2["conflicts"] if c.get("habitResolved")]
    check(resolved and resolved[0].get("2026-07-21") is False,
          f"the report says WHICH WAY it went -- no longer always 'done' ({resolved})")
    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")
    ctx2.close()

    # ============================================================
    # Group 3 -- pre-W7 history still resolves done-wins (regression guard)
    # ============================================================
    # Not a proof of the fix -- it passes on the old build too, deliberately.
    # It proves the new rule DIDN'T break the old one for data that carries no
    # assertion stamps, which is all history written before this round.
    ctx3, pg3, errs3 = boot(b, url)
    hid3 = first_habit(pg3)
    write_run(pg3, hid3, {
        "schedule": [0, 1, 2, 3, 4, 5, 6], "pausedRanges": [],
        "history": [{"date": "2026-07-22", "status": "stumble"}],   # NO assertedAt
        "currentRunStart": 0, "personalBest": 0, "bestSequence": [], "lifetimeTotal": 0,
        "modifiedAt": int(time.time() * 1000) + 60000, "deviceId": "this-device"})
    pg3.reload(); pg3.wait_for_timeout(700)
    pg3.click('button.icon-btn[data-action="close-tray"]'); pg3.wait_for_timeout(300)
    goto_habits(pg3)

    base3 = empty_bundle()
    base3["stores"]["gtd_habit_runs"] = [remote_run(hid3, [])]
    pg3.evaluate("(r) => window.__oelaSync.reconcile(r)", base3)
    pg3.wait_for_timeout(300)
    remote3 = empty_bundle()
    remote3["stores"]["gtd_habit_runs"] = [remote_run(hid3, [
        {"date": "2026-07-22", "status": "done"}],                  # NO assertedAt
        {"modifiedAt": int(time.time() * 1000) - 60000})]           # and OLDER
    pg3.evaluate("(r) => window.__oelaSync.reconcile(r)", remote3)
    pg3.wait_for_timeout(400)
    st3 = {h["date"]: h["status"] for h in (run_for(pg3, hid3) or {}).get("history", [])}
    check(st3.get("2026-07-22") == "done",
          f"un-asserted history on BOTH sides still resolves done-beats-miss, unchanged ({st3})")
    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")
    ctx3.close()

    # ============================================================
    # Group 4 -- memory follows storage for habits, and it RENDERS
    # ============================================================
    # Asserting on the rendered checkbox on purpose. The chunk-B defect this
    # fixes was invisible to every existing sync check precisely because they
    # all read localStorage, which was correct -- it was MEMORY that was stale.
    ctx4, pg4, errs4 = boot(b, url)
    hid4 = first_habit(pg4)
    today4 = today_str(pg4)
    check("checked" not in box_class(pg4, hid4),
          "fixture: the habit starts un-ticked on this device")

    # Establish a baseline FIRST. Without one, reconcile() treats a non-empty
    # remote as "joining an existing system" and calls stripSeededRecords on
    # this device's own seeded content -- which includes the habit under test,
    # so the card leaves the lane entirely and the real assertion below can
    # neither pass nor fail honestly. An empty remote has no records, so it
    # takes no strip and leaves a baseline behind.
    pg4.evaluate("(r) => window.__oelaSync.reconcile(r)", empty_bundle())
    pg4.wait_for_timeout(300)
    check("checked" not in box_class(pg4, hid4),
          "and is still un-ticked after the baseline sync -- so the check below is not vacuous")

    remote4 = empty_bundle()
    remote4["stores"]["gtd_habit_done"] = [
        {"id": hid4, "date": today4, "state": "done", "at": int(time.time() * 1000),
         "modifiedAt": int(time.time() * 1000), "deviceId": "other-device"}]
    pg4.evaluate("(r) => window.__oelaSync.reconcile(r)", remote4)
    pg4.wait_for_timeout(500)
    check("checked" in box_class(pg4, hid4),
          "THE FIX: a completion pulled from the other device is VISIBLE without a restart -- "
          "pre-W7 reloadSyncedStateFromStorage skipped habit state entirely, so it reached "
          "localStorage and never memory")
    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")
    ctx4.close()

    # ============================================================
    # Group 5 -- pause is dated, and the protection is RETROACTIVE
    # ============================================================
    ctx5, pg5, errs5 = boot(b, url)
    hid5 = first_habit(pg5)

    # A real run, then a pause covering the days that follow it.
    write_run(pg5, hid5, {
        "schedule": [0, 1, 2, 3, 4, 5, 6],
        "pausedRanges": [{"from": "2026-07-20", "to": None}],
        "history": [{"date": "2026-07-18", "status": "done", "assertedAt": 1},
                    {"date": "2026-07-19", "status": "done", "assertedAt": 2}],
        "currentRunStart": 0, "personalBest": 0, "bestSequence": [], "lifetimeTotal": 2,
        "modifiedAt": int(time.time() * 1000), "deviceId": "this-device"})
    pg5.reload(); pg5.wait_for_timeout(700)
    pg5.click('button.icon-btn[data-action="close-tray"]'); pg5.wait_for_timeout(300)
    goto_habits(pg5)

    check(bool(run_for(pg5, hid5).get("pausedRanges")),
          "pause is stored as a dated RANGE, not a boolean")
    pill = pg5.locator(f'.card[data-drag-id="{hid5}"] .link-pill').first.inner_text()
    check("Paused since" in pill,
          f"and the card names the day it began -- a bracket you opened, not a switch ({pill!r})")

    base5 = empty_bundle()
    base5["stores"]["gtd_habit_runs"] = [remote_run(hid5, [
        {"date": "2026-07-18", "status": "done", "assertedAt": 1},
        {"date": "2026-07-19", "status": "done", "assertedAt": 2}],
        {"pausedRanges": []})]
    pg5.evaluate("(r) => window.__oelaSync.reconcile(r)", base5)
    pg5.wait_for_timeout(300)

    # A STALE device never heard about the pause and swept misses right across
    # it. Pre-W7 these union in, cannot be beaten by anything but a done, and
    # end the run -- the exact failure dating pause exists to make impossible.
    remote5 = empty_bundle()
    remote5["stores"]["gtd_habit_runs"] = [remote_run(hid5, [
        {"date": "2026-07-18", "status": "done", "assertedAt": 1},
        {"date": "2026-07-19", "status": "done", "assertedAt": 2},
        {"date": "2026-07-20", "status": "stumble"},
        {"date": "2026-07-21", "status": "miss"},
        {"date": "2026-07-22", "status": "miss"}],
        {"modifiedAt": int(time.time() * 1000) + 60000, "pausedRanges": []})]
    pg5.evaluate("(r) => window.__oelaSync.reconcile(r)", remote5)
    pg5.wait_for_timeout(400)

    merged5 = run_for(pg5, hid5) or {}
    dates5 = [h["date"] for h in merged5.get("history", [])]
    check("2026-07-21" not in dates5 and "2026-07-22" not in dates5,
          "THE RULING: a stale device's misses INSIDE the paused range were filtered at replay -- "
          f"the protection is retroactive, not merely preventive ({dates5})")
    check(merged5.get("lifetimeTotal") == 2,
          f"and the run survived the pause intact ({merged5.get('lifetimeTotal')})")
    check(merged5.get("pausedRanges") and merged5["pausedRanges"][0]["from"] == "2026-07-20",
          f"the range itself came through the merge ({merged5.get('pausedRanges')})")
    check(not errs5, f"no JS errors in group 5 ({errs5[:3]})")
    ctx5.close()

    # ============================================================
    # Group 6 -- an asserted DONE outranks a pause
    # ============================================================
    # The completion locked in on the day pause begins, and any completion made
    # by a device that had not yet heard about the pause: in both cases the
    # user did in fact do it, so it counts. [from, to) puts that day INSIDE the
    # range, which is exactly why this needs asserting.
    ctx6, pg6, errs6 = boot(b, url)
    hid6 = first_habit(pg6)
    write_run(pg6, hid6, {
        "schedule": [0, 1, 2, 3, 4, 5, 6],
        "pausedRanges": [{"from": "2026-07-20", "to": "2026-07-25"}],
        "history": [{"date": "2026-07-20", "status": "done", "assertedAt": 5},
                    {"date": "2026-07-22", "status": "miss"}],
        "currentRunStart": 0, "personalBest": 0, "bestSequence": [], "lifetimeTotal": 1,
        "modifiedAt": int(time.time() * 1000), "deviceId": "this-device"})
    pg6.reload(); pg6.wait_for_timeout(700)
    pg6.click('button.icon-btn[data-action="close-tray"]'); pg6.wait_for_timeout(300)
    goto_habits(pg6)

    base6 = empty_bundle()
    base6["stores"]["gtd_habit_runs"] = [remote_run(hid6, [], {"pausedRanges": []})]
    pg6.evaluate("(r) => window.__oelaSync.reconcile(r)", base6)
    pg6.wait_for_timeout(300)
    remote6 = empty_bundle()
    remote6["stores"]["gtd_habit_runs"] = [remote_run(hid6, [], {"pausedRanges": []})]
    pg6.evaluate("(r) => window.__oelaSync.reconcile(r)", remote6)
    pg6.wait_for_timeout(400)

    merged6 = run_for(pg6, hid6) or {}
    st6 = {h["date"]: h["status"] for h in merged6.get("history", [])}
    check(st6.get("2026-07-20") == "done",
          f"an asserted DONE on the day a pause began still counts ({st6})")
    check("2026-07-22" not in st6,
          f"while an un-asserted miss inside the same range does not ({st6})")
    check(merged6.get("pausedRanges") and merged6["pausedRanges"][0].get("to") == "2026-07-25",
          f"and a closed range keeps its end date through the merge ({merged6.get('pausedRanges')})")
    check(not errs6, f"no JS errors in group 6 ({errs6[:3]})")
    ctx6.close()

    # ============================================================
    # Group 7 -- DRAFT ISOLATION, run against the rebuilt pause control
    # ============================================================
    # CLAUDE.md's verification procedure, required of every round that touches
    # a drafting page: mutate, ✕ out, confirm nothing persisted; then repeat
    # with Save and confirm it does. Pause is the control the ruling calls out
    # by name ("including controls that feel like switches"), and this round
    # rewrote what saving it actually WRITES -- a dated range rather than a
    # boolean -- so the guarantee has to be re-proved, not assumed.
    ctx7, pg7, errs7 = boot(b, url)
    hid7 = first_habit(pg7)
    today7 = today_str(pg7)

    def open_page():
        pg7.locator(f'.card-title[data-id="{hid7}"]').first.click(); pg7.wait_for_timeout(500)

    def leave(action):
        pg7.locator(f'[data-action="{action}"]').first.click(); pg7.wait_for_timeout(500)

    open_page()
    pg7.locator('[data-action="screen-toggle-pause"]').first.click(); pg7.wait_for_timeout(300)
    leave("screen-cancel")
    check(not (run_for(pg7, hid7) or {}).get("pausedRanges"),
          f"✕ discards an armed pause -- no range was opened ({(run_for(pg7, hid7) or {}).get('pausedRanges')})")
    check("Paused since" not in (pg7.locator(f'.card[data-drag-id="{hid7}"]').first.inner_text() or ""),
          "and the lane behind it never re-rendered as paused")

    open_page()
    pg7.locator('[data-action="screen-toggle-pause"]').first.click(); pg7.wait_for_timeout(300)
    leave("screen-save")
    ranges7 = (run_for(pg7, hid7) or {}).get("pausedRanges") or []
    check(len(ranges7) == 1 and ranges7[0]["from"] == today7 and ranges7[0]["to"] is None,
          f"Save opens exactly one range, dated today, still open ({ranges7})")
    check("Paused since" in (pg7.locator(f'.card[data-drag-id="{hid7}"]').first.inner_text() or ""),
          "and NOW the lane shows it, on save -- never on the individual control")

    open_page()
    pg7.locator('[data-action="screen-toggle-pause"]').first.click(); pg7.wait_for_timeout(300)
    leave("screen-save")
    ranges7b = (run_for(pg7, hid7) or {}).get("pausedRanges") or []
    check(len(ranges7b) == 1 and ranges7b[0]["to"] == today7,
          f"resuming CLOSES the same range rather than opening another ({ranges7b})")
    check("Paused since" not in (pg7.locator(f'.card[data-drag-id="{hid7}"]').first.inner_text() or ""),
          "and the card stops reporting a pause")
    check(not errs7, f"no JS errors in group 7 ({errs7[:3]})")
    ctx7.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

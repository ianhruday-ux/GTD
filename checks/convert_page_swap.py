"""CONVERT: the page swap, and the demote choice that rides with it.

Convert had ZERO test coverage before this file -- no suite touched arming,
saving, or either gate, on any of the four page types. It was the largest
untested surface in the repo, and it was also broken:

    Converting Next -> Waiting created an INVALID item, silently. changeKind
    keeps whenText/conditionId only when the destination is Waiting, and a Next
    Action never has them (§4.2 forbids it), so the result was condition-less by
    construction. The Waiting page's own save gate refuses exactly that state --
    the convert bypassed it. And isWaitingOrphaned opened with
    `if (!task.conditionId) return false;`, so the review could not see the row
    either. The app's answer was "All clear. Nothing slipping through the
    cracks."

THE RULING (author, 2026-08-01: "I like option 1"): swap the page in the draft.
Arming the convert re-renders as the destination kind with its fields, including
"waiting for"; ✕ still discards; Save validates as normal. The reason the old
page-swap behaviour was once rejected no longer holds -- "this was before
projects had staging" -- so a draft can hold a pending structural change now.

THE ADDITIONAL RULING: the Someday-can't-hold-linked-items warning moves off
Save and onto the Make Future button, "because that is when the decision is
made" -- and its answer is STAGED, applied at Save. Group 9 is the assertion
that ruling was bought for: choose Delete, then leave with ✕, and the project's
actions must still be there. Acting at the tap would have emptied a project the
user then backed out of converting.
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
      { id: 'n1', title: 'PLAIN NEXT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null, deadline: null },
      { id: 'n2', title: 'DATED NEXT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null,
        deadline: { date: '2099-01-01', time: null } },
      { id: 'a1', title: 'PROJECT ACTION', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: 'p1', contextId: null, whenText: null, deadline: null }
    ]));
    localStorage.setItem('gtd_tasks_waiting', JSON.stringify([
      { id: 'w1', title: 'A WAITING', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null,
        conditionId: 'n1', conditionKind: 'next', conditionLabel: 'PLAIN NEXT', deadline: null },
      { id: 'w2', title: 'WAITING ON NOTHING', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null,
        conditionId: null, conditionKind: null, conditionLabel: null, deadline: null }
    ]));
    localStorage.setItem('gtd_tasks_current', JSON.stringify([
      { id: 'p1', title: 'CURRENT PROJECT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null, deadline: null },
      { id: 'p2', title: 'EMPTY PROJECT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null, deadline: null }
    ]));
    localStorage.setItem('gtd_tasks_future', JSON.stringify([
      { id: 'f1', title: 'SOMEDAY PROJECT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null, deadline: null }
    ]));
    localStorage.setItem('gtd_tasks_habit', '[]');
    localStorage.setItem('gtd_events', '[]');
}"""


def boot(b, url, width=420, keep_tray=False):
    ctx = b.new_context(viewport={"width": width, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(700)
    pg.evaluate(FIXTURE)
    pg.reload(); pg.wait_for_timeout(900)
    # The capture tray overlays the lanes; every other suite clears it. The
    # review's button lives INSIDE it, so the one group that needs the review
    # keeps it (see group 15).
    if not keep_tray:
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    return ctx, pg, errs


def open_item(pg, lane, task_id):
    pg.click('.tab[data-kind="%s"]' % lane); pg.wait_for_timeout(400)
    pg.locator('.card-title[data-id="%s"]' % task_id).first.click(); pg.wait_for_timeout(600)


def page_kind(pg):
    """What the page is RENDERING as -- the whole point of the swap."""
    return pg.evaluate("""() => {
        const o = document.querySelector('.screen-overlay');
        return o ? o.getAttribute('data-kind') : null;
    }""")


def badge(pg):
    el = pg.locator('.screen-kind-badge')
    return el.first.inner_text().strip() if el.count() else None


def lane_of(pg, task_id):
    return pg.evaluate("""(id) => {
        for (const k of ['next','waiting','current','future']){
            const arr = JSON.parse(localStorage.getItem('gtd_tasks_' + k) || '[]');
            if (arr.some(t => t.id === id)) return k;
        }
        return 'GONE';
    }""", task_id)


def rec(pg, task_id):
    return pg.evaluate("""(id) => {
        for (const k of ['next','waiting','current','future']){
            const arr = JSON.parse(localStorage.getItem('gtd_tasks_' + k) || '[]');
            const t = arr.find(x => x.id === id);
            if (t) return t;
        }
        return null;
    }""", task_id)


def dialog_open(pg):
    return pg.locator('.choice-dialog').count() > 0


def dialog_click(pg, idx):
    # Tolerant, for the same protocol reason as fill(): on the PRE-CHANGE build
    # the demote dialog does not fire at the tap at all, and a 30-second locator
    # timeout in group 8 would abort the file instead of reporting.
    sel = '.choice-dialog-btns button[data-idx="%d"]' % idx
    if pg.locator(sel).count() == 0:
        return False
    pg.locator(sel).first.click()
    pg.wait_for_timeout(500)
    return True


def discard(pg):
    """✕ out. A dirty PROJECT page confirms first (data-idx 0 = discard)."""
    pg.locator('[data-action="screen-cancel"]').first.click(); pg.wait_for_timeout(400)
    if dialog_open(pg):
        dialog_click(pg, 0)
    pg.wait_for_timeout(400)


def save(pg):
    pg.locator('[data-action="screen-save"]').first.click(); pg.wait_for_timeout(700)


def arm(pg, dest):
    pg.locator('[data-action="make-kind"][data-dest="%s"]' % dest).first.click()
    pg.wait_for_timeout(500)


def fill(pg, sel, text):
    """Tolerant fill. The PRE-CHANGE build has no 'waiting for' field on a
    swapped page at all (that is the bug), and checks/README.md's protocol
    requires this file to REPORT the failures rather than abort mid-group on a
    30-second locator timeout."""
    if pg.locator(sel).count() == 0:
        return False
    pg.locator(sel).first.fill(text)
    return True


def has(pg, sel):
    return pg.locator(sel).count() > 0


WAITFOR = '[data-field="waitingForText"]'
DEADLINE = '[data-field="deadline-date"]'


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- arming Make Waiting SWAPS THE PAGE
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url)
    # Read the real Waiting badge off a real Waiting item first, so the swap can
    # be asserted against it without hardcoding an i18n string.
    open_item(pg1, "waiting", "w1")
    waiting_badge = badge(pg1)
    discard(pg1)
    open_item(pg1, "next", "n1")
    next_badge = badge(pg1)
    check(page_kind(pg1) == "next" and has(pg1, DEADLINE) and not has(pg1, WAITFOR),
          "fixture: a Next Action page has a deadline row and no 'waiting for'")
    arm(pg1, "waiting")
    check(page_kind(pg1) == "waiting",
          f"THE SWAP: arming Make Waiting re-renders the page AS a Waiting page ({page_kind(pg1)})")
    check(badge(pg1) == waiting_badge and waiting_badge != next_badge,
          f"the kind badge says so ({next_badge!r} -> {badge(pg1)!r})")
    check(has(pg1, WAITFOR),
          "and the destination's own field is THERE -- the 'waiting for' the conversion needs")
    check(not has(pg1, DEADLINE),
          "while the deadline row, which a Waiting action may not have (§4.13a), is gone")
    check(lane_of(pg1, "n1") == "next" and (rec(pg1, "n1") or {}).get("conditionId") is None,
          "DRAFT ISOLATION: nothing is written -- the item is still a Next Action in its lane")
    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")
    ctx1.close()

    # ============================================================
    # Group 2 -- ✕ discards the swap
    # ============================================================
    ctx2, pg2, errs2 = boot(b, url)
    open_item(pg2, "next", "n1")
    arm(pg2, "waiting")
    fill(pg2, WAITFOR, "SOMETHING TO WAIT ON")
    discard(pg2)
    check(lane_of(pg2, "n1") == "next", f"✕ discards the conversion ({lane_of(pg2, 'n1')})")
    check((rec(pg2, "n1") or {}).get("whenText") in (None, ""),
          "and the condition typed on the swapped page with it")
    open_item(pg2, "next", "n1")
    check(page_kind(pg2) == "next" and has(pg2, DEADLINE) and not has(pg2, WAITFOR),
          "reopening gives an ordinary Next Action page -- the swap left no residue")
    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")
    ctx2.close()

    # ============================================================
    # Group 3 -- THE BUG: Save is blocked without a condition
    # ============================================================
    # This is the whole reason the page swap came back. Before it, Save here
    # produced a Waiting row with neither whenText nor conditionId -- a state
    # the Waiting page itself refuses and the review could not see.
    ctx3, pg3, errs3 = boot(b, url)
    open_item(pg3, "next", "n1")
    arm(pg3, "waiting")
    save(pg3)
    check(page_kind(pg3) == "waiting",
          "Save with nothing to wait on does NOT convert -- the page stays open")
    check(has(pg3, '.field-invalid'),
          "with the dashed outline on the offending field (§ validation: no popups)")
    check(lane_of(pg3, "n1") == "next",
          f"and the item has not moved lanes ({lane_of(pg3, 'n1')})")
    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")
    ctx3.close()

    # ============================================================
    # Group 4 -- supply the condition on the swapped page, and it converts
    # ============================================================
    ctx4, pg4, errs4 = boot(b, url)
    open_item(pg4, "next", "n1")
    arm(pg4, "waiting")
    fill(pg4, WAITFOR, "THE OTHER THING")
    save(pg4)
    r = rec(pg4, "n1") or {}
    check(lane_of(pg4, "n1") == "waiting", f"Save converts ({lane_of(pg4, 'n1')})")
    check((r.get("whenText") or "").strip() == "THE OTHER THING",
          f"carrying the condition collected on the swapped page ({r.get('whenText')!r})")
    check(bool(r.get("whenText") or r.get("conditionId")),
          "THE REGRESSION THIS FILE EXISTS FOR: a converted Waiting action is never "
          "condition-less -- the state that used to be unreachable is unreachable again")
    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")
    ctx4.close()

    # ============================================================
    # Group 5 -- the armed button is the way BACK
    # ============================================================
    ctx5, pg5, errs5 = boot(b, url)
    open_item(pg5, "next", "n1")
    arm(pg5, "waiting")
    check(pg5.locator('[data-action="make-kind"][data-dest="waiting"].armed').count() == 1,
          "on the swapped page the convert button is ARMED and still points at the destination "
          "-- tapping it must undo, not arm a second conversion")
    arm(pg5, "waiting")
    check(page_kind(pg5) == "next" and has(pg5, DEADLINE) and not has(pg5, WAITFOR),
          f"disarming swaps the page back ({page_kind(pg5)})")
    check(not errs5, f"no JS errors in group 5 ({errs5[:3]})")
    ctx5.close()

    # ============================================================
    # Group 6 -- Waiting -> Next, the other half of the pair
    # ============================================================
    ctx6, pg6, errs6 = boot(b, url)
    open_item(pg6, "waiting", "w1")
    check(has(pg6, WAITFOR), "fixture: the Waiting page has its condition row")
    arm(pg6, "next")
    check(page_kind(pg6) == "next" and not has(pg6, WAITFOR) and has(pg6, DEADLINE),
          f"arming Make Next swaps to a Next Action page, deadline row and all ({page_kind(pg6)})")
    save(pg6)
    r6 = rec(pg6, "w1") or {}
    check(lane_of(pg6, "w1") == "next", f"Save converts ({lane_of(pg6, 'w1')})")
    check(r6.get("conditionId") is None,
          "and the condition is dropped -- a Next Action may not have one (§4.2)")
    check(not errs6, f"no JS errors in group 6 ({errs6[:3]})")
    ctx6.close()

    # ============================================================
    # Group 7 -- a dated Next Action still cannot become Waiting
    # ============================================================
    # §4.13a: a dated thing does not wait. The swap must not have re-opened this.
    ctx7, pg7, errs7 = boot(b, url)
    open_item(pg7, "next", "n2")
    arm(pg7, "waiting")
    check(page_kind(pg7) == "next",
          f"the greyed Make Waiting on a dated action does not swap the page ({page_kind(pg7)})")
    check(not has(pg7, WAITFOR), "and no 'waiting for' field appears")
    check(not errs7, f"no JS errors in group 7 ({errs7[:3]})")
    ctx7.close()

    # ============================================================
    # Group 8 -- Current -> Future: the dialog fires AT THE TAP
    # ============================================================
    ctx8, pg8, errs8 = boot(b, url)
    open_item(pg8, "current", "p1")
    arm(pg8, "future")
    check(dialog_open(pg8),
          "AUTHOR'S RULING: the Someday-can't-hold-this warning fires when Make Future is "
          "TAPPED, not at Save -- that is when the decision is made")
    dialog_click(pg8, 0)  # Unlink
    check(page_kind(pg8) == "future",
          f"answering it arms the convert and swaps the page ({page_kind(pg8)})")
    check((rec(pg8, "a1") or {}).get("linkedProjectId") == "p1",
          "but the ANSWER IS STAGED -- the linked action is still linked")
    check(lane_of(pg8, "p1") == "current", "and the project has not moved")
    # ⚑ ✕ must WARN. projectDraftDirty counted staged links, unlinks, creates
    # and deletes but not an armed convert, and it is the project page's only
    # discard gate on the phone (the other one is desktop-only) -- so a
    # conversion carrying a decision about other items was discarded in silence.
    pg8.locator('[data-action="screen-cancel"]').first.click(); pg8.wait_for_timeout(400)
    check(dialog_open(pg8),
          "✕ on a page with an armed convert warns before discarding it")
    dialog_click(pg8, 1)  # keep editing
    check(page_kind(pg8) == "future", "and declining leaves the swapped page open, still armed")
    check(not errs8, f"no JS errors in group 8 ({errs8[:3]})")
    ctx8.close()

    # ============================================================
    # Group 9 -- THE ASSERTION THE RULING WAS BOUGHT FOR
    # ============================================================
    # Choose Delete, then back out with ✕. Acting at the tap would have left an
    # unchanged Current project whose actions were silently gone -- a side
    # effect on OTHER items surviving a discard, which DRAFT ISOLATION names
    # explicitly. Costed at ~15 extra lines; this is what they buy.
    ctx9, pg9, errs9 = boot(b, url)
    open_item(pg9, "current", "p1")
    arm(pg9, "future")
    dialog_click(pg9, 1)  # Delete
    check(page_kind(pg9) == "future", "armed with Delete, the page swaps")
    check(lane_of(pg9, "a1") == "next",
          "and the action is STILL THERE while the page is open -- nothing acted yet")
    discard(pg9)
    check(lane_of(pg9, "a1") == "next",
          f"✕ AFTER CHOOSING DELETE: the project's action still exists ({lane_of(pg9, 'a1')})")
    check((rec(pg9, "a1") or {}).get("linkedProjectId") == "p1",
          "still linked to a project that never converted")
    check(lane_of(pg9, "p1") == "current", "which is still a Current project")
    check(not errs9, f"no JS errors in group 9 ({errs9[:3]})")
    ctx9.close()

    # ============================================================
    # Group 10 -- Save applies the staged choice, both branches
    # ============================================================
    ctx10, pg10, errs10 = boot(b, url)
    open_item(pg10, "current", "p1")
    arm(pg10, "future")
    dialog_click(pg10, 0)  # Unlink
    save(pg10)
    check(lane_of(pg10, "p1") == "future", f"Unlink + Save: the project demotes ({lane_of(pg10, 'p1')})")
    check(lane_of(pg10, "a1") == "next", "the action survives")
    check((rec(pg10, "a1") or {}).get("linkedProjectId") in (None, ""),
          "detached, because a Someday project holds no linked actions (§4.3)")
    check(not errs10, f"no JS errors in group 10 ({errs10[:3]})")
    ctx10.close()

    ctx10b, pg10b, errs10b = boot(b, url)
    open_item(pg10b, "current", "p1")
    arm(pg10b, "future")
    dialog_click(pg10b, 1)  # Delete
    save(pg10b)
    check(lane_of(pg10b, "p1") == "future", "Delete + Save: the project demotes")
    check(lane_of(pg10b, "a1") == "GONE", f"and the action really is deleted ({lane_of(pg10b, 'a1')})")
    check(not errs10b, f"no JS errors in group 10b ({errs10b[:3]})")
    ctx10b.close()

    # ============================================================
    # Group 11 -- Cancel leaves the convert unarmed
    # ============================================================
    ctx11, pg11, errs11 = boot(b, url)
    open_item(pg11, "current", "p1")
    arm(pg11, "future")
    dialog_click(pg11, 2)  # Cancel
    check(page_kind(pg11) == "current",
          f"Cancel: no page swap, the convert never arms ({page_kind(pg11)})")
    check(pg11.locator('[data-action="make-kind"].armed').count() == 0,
          "and no armed button is left behind")
    check(not errs11, f"no JS errors in group 11 ({errs11[:3]})")
    ctx11.close()

    # ============================================================
    # Group 12 -- disarming clears the stored choice
    # ============================================================
    # Author: "I'm fine with throwing up the dialogue again if the user swaps
    # back and forth." A minute-old answer about OTHER items is not consent for
    # a conversion you re-armed after changing your mind.
    ctx12, pg12, errs12 = boot(b, url)
    open_item(pg12, "current", "p1")
    arm(pg12, "future")
    dialog_click(pg12, 0)
    arm(pg12, "future")  # disarm
    check(page_kind(pg12) == "current", "disarmed back to a Current project page")
    arm(pg12, "future")  # re-arm
    check(dialog_open(pg12),
          "RE-ARMING ASKS AGAIN -- the previous answer was cleared, not silently reused")
    dialog_click(pg12, 0)
    check(not errs12, f"no JS errors in group 12 ({errs12[:3]})")
    ctx12.close()

    # ============================================================
    # Group 13 -- a project with nothing linked swaps with no dialog
    # ============================================================
    ctx13, pg13, errs13 = boot(b, url)
    open_item(pg13, "current", "p2")
    arm(pg13, "future")
    check(not dialog_open(pg13), "nothing linked: no warning, because there is nothing to warn about")
    check(page_kind(pg13) == "future", f"the page swaps straight away ({page_kind(pg13)})")
    save(pg13)
    check(lane_of(pg13, "p2") == "future", "and Save demotes it")
    check(not errs13, f"no JS errors in group 13 ({errs13[:3]})")
    ctx13.close()

    # ============================================================
    # Group 14 -- Future -> Current, the fourth button
    # ============================================================
    ctx14, pg14, errs14 = boot(b, url)
    open_item(pg14, "future", "f1")
    arm(pg14, "current")
    check(page_kind(pg14) == "current", f"a Someday project swaps to a Current page ({page_kind(pg14)})")
    check(has(pg14, DEADLINE),
          "which has the deadline field a Someday project is not allowed (§4.3)")
    save(pg14)
    check(lane_of(pg14, "f1") == "current", f"Save promotes it ({lane_of(pg14, 'f1')})")
    check(not errs14, f"no JS errors in group 14 ({errs14[:3]})")
    ctx14.close()

    # ============================================================
    # Group 15 -- the review can finally SEE a condition-less Waiting row
    # ============================================================
    # isWaitingOrphaned used to open with `if (!task.conditionId) return false;`
    # -- it only ever caught a DANGLING condition, so a row waiting on nothing
    # (which the old convert minted) was invisible while the review reported
    # "All clear."
    ctx15, pg15, errs15 = boot(b, url, keep_tray=True)
    # ⚠ The review is a ONE-AT-A-TIME queue, so an assertion about what is on
    # screen is an assertion about what sorts FIRST. The fixture's two projects
    # are stalled (no linked action, no linked event) and would occupy the card.
    # Clear them so the queue has exactly one member and the check is about
    # w2 being IN it, not about ordering.
    pg15.evaluate("""() => {
        localStorage.setItem('gtd_tasks_current', '[]');
        localStorage.setItem('gtd_tasks_future', '[]');
    }""")
    pg15.reload(); pg15.wait_for_timeout(900)
    pg15.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
    pg15.wait_for_timeout(400)
    pg15.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
    pg15.wait_for_timeout(800)
    keys = pg15.evaluate("""() => [...document.querySelectorAll('.review-card, [data-key]')]
        .map(e => e.getAttribute('data-key') || e.getAttribute('data-id')).filter(Boolean)""")
    check("w2" in keys,
          f"a Waiting action with NO condition at all is now an open loop in the review ({keys})")
    check(not errs15, f"no JS errors in group 15 ({errs15[:3]})")
    ctx15.close()

    # ============================================================
    # Group 16 -- DRAFT ISOLATION on the swapped page, by enumeration
    # ============================================================
    # CLAUDE.md: "No control leaks" is a claim about ALL of them and can only be
    # made by enumerating what the page RENDERS. The swapped page is a page the
    # verification procedure has never been run against, so run it: touch every
    # control it renders, ✕, confirm nothing persisted.
    ctx16, pg16, errs16 = boot(b, url)
    open_item(pg16, "next", "n1")
    arm(pg16, "waiting")
    rendered = pg16.evaluate("""() => [...document.querySelectorAll(
        '.screen-body [data-field], .screen-body [data-action]')]
        .map(e => e.getAttribute('data-field') || e.getAttribute('data-action'))""")
    check(len(rendered) >= 3, f"the swapped page renders controls to enumerate ({rendered})")
    fill(pg16, '[data-field="title"]', "RENAMED ON THE SWAPPED PAGE")
    fill(pg16, '[data-field="notesClean"]', "A DESCRIPTION")
    fill(pg16, WAITFOR, "A CONDITION")
    discard(pg16)
    r16 = rec(pg16, "n1") or {}
    check(r16.get("title") == "PLAIN NEXT", f"✕: the title is untouched ({r16.get('title')!r})")
    check((r16.get("notesClean") or "") == "", "the description is untouched")
    check((r16.get("whenText") or "") == "", "the condition never landed")
    check(lane_of(pg16, "n1") == "next", "and the kind never changed")
    check(not errs16, f"no JS errors in group 16 ({errs16[:3]})")
    ctx16.close()

    # ============================================================
    # Group 17 -- no convert on a page opened from a project's list
    # ============================================================
    # W7's "reached sideways" ruling already withholds Complete and Delete
    # there. Convert was rendered but INERT -- saveScreen hands a staging page
    # to stageChildSave, which returns before the convert branch ever runs, so
    # arming one and saving did nothing. Under the page swap that stops being
    # harmless: the page would swap, invite a condition, and stage it onto a
    # record whose kind never changed -- a Next Action carrying a condition,
    # which §4.2 forbids.
    ctx17, pg17, errs17 = boot(b, url)
    open_item(pg17, "current", "p1")
    check(pg17.locator('.linked-action-item[data-id="a1"]').count() == 1,
          "fixture: the project lists its linked action")
    pg17.locator('.linked-action-item[data-id="a1"]').first.click(); pg17.wait_for_timeout(600)
    check(pg17.locator('[data-field="title"]').count() >= 1,
          "opening it from the project's list still gives an editable page")
    check(pg17.locator('[data-action="make-kind"]').count() == 0,
          "and NO convert button -- it could never have worked from here, and under the page "
          "swap an inert one would invite a condition onto an item that stays a Next Action")
    check(not errs17, f"no JS errors in group 17 ({errs17[:3]})")
    ctx17.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)

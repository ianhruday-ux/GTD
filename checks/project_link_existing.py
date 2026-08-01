"""Linking EXISTING actions and events to a project (W7).

The author, closing out the project: "You can create new actions from the
project drafting page and creation page, but you can't link existing actions or
events." Right -- and the reverse direction already existed (an action's own
page carries a project select), so this was the missing symmetric half rather
than a new concept.

The rulings:

  1. UNLINKED ONLY. An action already belonging to another project is not
     offered. Moving one stays possible from the action's own page, which names
     the project it is leaving; doing it from here would silently empty a
     project this screen never mentions, possibly stranding it stalled.

  2. NO COMPLETE, NO DELETE for an item the project ALREADY has, opened from
     its linked list. Fields stay editable. A staged create is exempt: its row
     has no ✕, so Delete is the only way to take back a mis-added action.

  3. THEREFORE A WAY OUT. §12.1's own comment said "you remove it from the
     project's own list instead" and described a control nobody had built --
     completing or deleting was the only exit. With those blocked, an action
     could have checked into a project and never left. Every row that is in the
     project now carries a ✕ that detaches it: the item keeps its lane, its
     edits and its history, and only loses the link.

  4. DRAFT ISOLATION over all of it. Linking and detaching are staged; ✕
     discards, Save commits. CLAUDE.md requires this be proved by ENUMERATING
     the page's controls rather than asserting it, so group 3 does.
"""
import os, sys, json, functools, http.server, socket, socketserver, threading, contextlib, time
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
      { id: 'free-1', title: 'FREE ACTION', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null },
      { id: 'owned-1', title: 'OWNED BY OTHER', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: 'proj-other', contextId: null, whenText: null },
      { id: 'mine-1', title: 'ALREADY MINE', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: 'proj-1', contextId: null, whenText: null }
    ]));
    localStorage.setItem('gtd_tasks_waiting', '[]');
    localStorage.setItem('gtd_tasks_current', JSON.stringify([
      { id: 'proj-1', title: 'THE PROJECT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null },
      { id: 'proj-other', title: 'THE OTHER PROJECT', isGroup: false, parent: null, notesClean: '',
        linkedProjectId: null, contextId: null, whenText: null }
    ]));
    localStorage.setItem('gtd_tasks_future', '[]');
    localStorage.setItem('gtd_tasks_habit', '[]');
    localStorage.setItem('gtd_events', '[]');
}"""


def boot(b, url):
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(700)
    pg.evaluate(FIXTURE)
    pg.reload(); pg.wait_for_timeout(900)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
    return ctx, pg, errs


def open_project(pg):
    pg.locator('.card-title[data-id="proj-1"]').first.click(); pg.wait_for_timeout(600)


def linked_titles(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('.linked-actions-list .linked-action-item')]
        .map(e => e.textContent.trim()).filter(Boolean)""")


def picker_titles(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('[data-action="pick-link"]')]
        .map(e => e.textContent.trim()).filter(Boolean)""")


def link_of(pg, task_id):
    return pg.evaluate("""(id) => {
        for (const k of ['next','waiting']){
            const t = (JSON.parse(localStorage.getItem('gtd_tasks_' + k)||'[]')).find(x => x.id === id);
            if (t) return t.linkedProjectId || null;
        }
        return 'MISSING';
    }""", task_id)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- the picker offers the right things
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url)
    open_project(pg1)
    check(pg1.locator('[data-action="open-link-picker"]').count() == 1,
          "THE GAP: the project page has a Link existing button at all")
    pg1.locator('[data-action="open-link-picker"]').first.click(); pg1.wait_for_timeout(500)
    offered = picker_titles(pg1)
    check(any("FREE ACTION" in x for x in offered),
          f"an unlinked action is offered ({offered})")
    check(not any("OWNED BY OTHER" in x for x in offered),
          f"THE RULING: one already owned by ANOTHER project is NOT -- taking it from here would "
          f"empty a project this screen never names ({offered})")
    check(not any("ALREADY MINE" in x for x in offered),
          f"and one this project already has is not offered twice ({offered})")
    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")
    ctx1.close()

    # ============================================================
    # Group 2 -- link, save, and it is really linked
    # ============================================================
    ctx2, pg2, errs2 = boot(b, url)
    open_project(pg2)
    pg2.locator('[data-action="open-link-picker"]').first.click(); pg2.wait_for_timeout(400)
    pg2.locator('[data-action="pick-link"][data-id="free-1"]').first.click(); pg2.wait_for_timeout(500)
    check(any("FREE ACTION" in x for x in linked_titles(pg2)),
          f"picking it shows it in the linked list straight away ({linked_titles(pg2)})")
    check(link_of(pg2, "free-1") is None,
          f"but NOTHING is written yet -- draft isolation ({link_of(pg2, 'free-1')})")
    pg2.locator('[data-action="screen-save"]').first.click(); pg2.wait_for_timeout(700)
    check(link_of(pg2, "free-1") == "proj-1",
          f"Save commits the link ({link_of(pg2, 'free-1')})")
    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")
    ctx2.close()

    # ============================================================
    # Group 3 -- DRAFT ISOLATION, by enumeration (CLAUDE.md)
    # ============================================================
    # "No control leaks" is a claim about ALL of them and can only be made by
    # enumerating what the page renders -- so: link one, detach another, then ✕.
    ctx3, pg3, errs3 = boot(b, url)
    open_project(pg3)
    pg3.locator('[data-action="open-link-picker"]').first.click(); pg3.wait_for_timeout(400)
    pg3.locator('[data-action="pick-link"][data-id="free-1"]').first.click(); pg3.wait_for_timeout(400)
    unlink = pg3.locator('[data-action="unlink-linked"][data-id="mine-1"]')
    check(unlink.count() == 1,
          "THE WAY OUT: an item the project already has carries a ✕ to detach it -- §12.1 described "
          "this control and nobody had built it")
    unlink.first.click(); pg3.wait_for_timeout(400)
    after = linked_titles(pg3)
    check(not any("ALREADY MINE" in x for x in after),
          f"detaching removes it from the list immediately ({after})")
    pg3.locator('[data-action="screen-cancel"]').first.click(); pg3.wait_for_timeout(700)
    check(link_of(pg3, "free-1") is None,
          f"✕ discards the LINK ({link_of(pg3, 'free-1')})")
    check(link_of(pg3, "mine-1") == "proj-1",
          f"✕ discards the DETACH too -- and the item was never touched beyond its link "
          f"({link_of(pg3, 'mine-1')})")
    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")
    ctx3.close()

    # ============================================================
    # Group 4 -- detaching, saved
    # ============================================================
    ctx4, pg4, errs4 = boot(b, url)
    open_project(pg4)
    pg4.locator('[data-action="unlink-linked"][data-id="mine-1"]').first.click(); pg4.wait_for_timeout(400)
    pg4.locator('[data-action="screen-save"]').first.click(); pg4.wait_for_timeout(700)
    check(link_of(pg4, "mine-1") is None,
          f"Save commits the detach ({link_of(pg4, 'mine-1')})")
    check(link_of(pg4, "mine-1") != "MISSING",
          "and the action still EXISTS -- remove from project is never delete")
    titles = pg4.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').map(t => t.title)""")
    check("ALREADY MINE" in titles, f"still in its lane, with its title intact ({titles})")
    check(not errs4, f"no JS errors in group 4 ({errs4[:3]})")
    ctx4.close()

    # ============================================================
    # Group 5 -- no Complete, no Delete on an already-linked item
    # ============================================================
    ctx5, pg5, errs5 = boot(b, url)
    open_project(pg5)
    pg5.locator('.linked-action-item[data-id="mine-1"]').first.click(); pg5.wait_for_timeout(600)
    check(pg5.locator('[data-field="title"]').count() >= 1,
          "opening an already-linked item still gives an EDITABLE page")
    check(pg5.locator('[data-action="screen-delete"]').count() == 0,
          "THE RULING: no Delete -- it is a pre-existing item reached sideways, not this page's to destroy")
    check(pg5.locator('[data-action="screen-complete"]').count() == 0,
          "and no Complete, for the same reason")
    check(not errs5, f"no JS errors in group 5 ({errs5[:3]})")
    ctx5.close()

    # ============================================================
    # Group 6 -- a staged CREATE keeps its Delete
    # ============================================================
    # The exemption that stops the ruling stranding a mis-added row: a staged
    # create has no ✕, so Delete is its only take-back.
    ctx6, pg6, errs6 = boot(b, url)
    open_project(pg6)
    pg6.locator('[data-action="generate-action"][data-gen-kind="next"]').first.click(); pg6.wait_for_timeout(600)
    pg6.locator('[data-field="title"]').first.fill("JUST MADE THIS")
    pg6.locator('[data-action="screen-save"]').first.click(); pg6.wait_for_timeout(600)
    made = [x for x in linked_titles(pg6) if "JUST MADE THIS" in x]
    check(bool(made), f"fixture: the staged create is in the list ({linked_titles(pg6)})")
    pg6.locator('.linked-action-item:has-text("JUST MADE THIS")').first.click(); pg6.wait_for_timeout(600)
    check(pg6.locator('[data-action="screen-delete"]').count() == 1,
          "a STAGED CREATE keeps Delete -- its row has no ✕, so this is the only way to take it back")
    # ⚑ Author: "it also has a complete button which shouldn't be there." The
    # exemption is Delete-ONLY. One predicate used to gate both, so the staged
    # create inherited Complete along with Delete; nothing reached through a
    # project's linked list is completable, staged or live.
    check(pg6.locator('[data-action="screen-complete"]').count() == 0,
          "but NOT Complete -- the staged-create exemption is Delete-only")
    check(not errs6, f"no JS errors in group 6 ({errs6[:3]})")
    ctx6.close()

    # ============================================================
    # Group 7 -- the same picker on the REVIEW surface, both layouts
    # ============================================================
    # Author: "the link an action picker should be added to the review surface
    # for stalled projects above the new action and event buttons on both the
    # phone and computer." A stalled project usually has an action already --
    # it just was never attached -- so offering to attach one before offering
    # to invent one is the honest order.
    #
    # It ACTS IMMEDIATELY here, unlike the project page's copy: the review has
    # no draft and no ✕ to discard into, and every other button on the card
    # commits on tap.
    for layout, width in (("phone", 420), ("desktop", 1280)):
        ctxr = b.new_context(viewport={"width": width, "height": 900})
        pgr = ctxr.new_page()
        errsr = []
        pgr.on("pageerror", lambda e: errsr.append(str(e)))
        pgr.goto(url); pgr.wait_for_timeout(700)
        # 'THE PROJECT' has a linked action in the fixture, so strip it to make
        # the project genuinely stalled -- that is what puts it in the queue.
        pgr.evaluate(FIXTURE)
        pgr.evaluate("""() => {
            const arr = JSON.parse(localStorage.getItem('gtd_tasks_next'));
            arr.forEach(t => { if (t.id === 'mine-1') t.linkedProjectId = null; });
            localStorage.setItem('gtd_tasks_next', JSON.stringify(arr));
        }""")
        pgr.reload(); pgr.wait_for_timeout(900)
        pgr.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        # ⚠ The review button lives INSIDE the capture tray, so the tray has to
        # be opened first -- and this file's own boot() wipes #tray-root, which
        # removes the button entirely. Same open-tray-then-open-review sequence
        # every other review suite uses, driven through evaluate() because a
        # locator click cannot reach either one here.
        pgr.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
        pgr.wait_for_timeout(400)
        pgr.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
        pgr.wait_for_timeout(800)

        btn = pgr.locator('[data-action="review-form-start"][data-type="link"]')
        check(btn.count() >= 1, f"[{layout}] the stalled card offers Link existing")
        # "Above the new action and event buttons" -- meaning its OWN ROW.
        # ⚠ This used to assert DOM order across a flat button list, which
        # same-row placement satisfies: the bug ("it's on the same row") passed
        # the check. A band is a flex row, so the question is which BAND each
        # button is in, not which index.
        bands = pgr.evaluate("""() => {
            const all = [...document.querySelectorAll('.review-band')];
            const bandOf = sel => {
                const el = document.querySelector(sel);
                if (!el) return -1;
                return all.indexOf(el.closest('.review-band'));
            };
            return {
                link: bandOf('[data-action="review-form-start"][data-type="link"]'),
                text: bandOf('[data-action="review-form-start"][data-type="text"]'),
                linkSiblings: (() => {
                    const el = document.querySelector('[data-action="review-form-start"][data-type="link"]');
                    const band = el && el.closest('.review-band');
                    return band ? band.querySelectorAll('button').length : -1;
                })()
            };
        }""")
        check(bands["link"] != -1 and bands["text"] != -1 and bands["link"] != bands["text"],
              f"[{layout}] Link existing is in a DIFFERENT band from the make-something-new "
              f"buttons -- a row of its own, not beside them ({bands})")
        check(bands["link"] != -1 and bands["text"] != -1 and bands["link"] < bands["text"],
              f"[{layout}] and that band comes ABOVE them ({bands})")
        check(bands["linkSiblings"] == 1,
              f"[{layout}] alone in its row ({bands['linkSiblings']} buttons in the band)")

        btn.first.click(); pgr.wait_for_timeout(500)
        picked = pgr.locator('[data-action="review-link-pick"][data-id="free-1"]')
        check(picked.count() >= 1, f"[{layout}] the picker lists unlinked actions")
        check(pgr.locator('[data-action="review-link-pick"][data-id="owned-1"]').count() == 0,
              f"[{layout}] and still excludes one owned by another project -- ONE definition of "
              f"eligible, shared with the project page")
        check(pgr.locator('.pick-body .screen-hook-pick-item').count() >= 1,
              f"[{layout}] rendered in the shared picker language, not a second style")
        picked.first.click(); pgr.wait_for_timeout(700)
        check(link_of(pgr, "free-1") == "proj-1",
              f"[{layout}] picking commits immediately -- the review has no draft to stage into "
              f"({link_of(pgr, 'free-1')})")
        check(not errsr, f"[{layout}] no JS errors ({errsr[:3]})")
        ctxr.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

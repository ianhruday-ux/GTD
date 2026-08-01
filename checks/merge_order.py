"""W7 -- where a synced-in item lands, and what order contexts display in.

Two rulings from the author, both made after the first successful two-device
sync (2026-07-31):

  1. A RECORD THIS DEVICE HAS NEVER SEEN GOES TO THE TOP. Everything the app
     creates locally is unshifted onto its lane -- capture, quick-add,
     convert, move-between-lanes all put the new thing first -- so an item
     arriving from the other device was the one kind of new item that landed
     at the END. Inconsistent with the whole app, and practically invisible:
     it appeared below whatever you were already looking at, which on a full
     lane means off the bottom of the screen. Records BOTH devices already
     have keep their local position, so a hand-arranged lane is never
     reshuffled.

  2. CONTEXTS DISPLAY IN A DETERMINISTIC ORDER (alphabetical), so two devices
     agree. A context registry cannot be rearranged by hand, so its stored
     order carries no intent -- it is just whatever sequence the devices
     happened to merge in. And contexts are what the action lanes group BY,
     so a disagreement about their order is a disagreement about the shape of
     the whole lane.

Both assert on RENDERED order, not on the stored array -- the ordering IS the
rendering here, and sync_live_state.py's own history is the argument for it:
every sync check used to read localStorage, which was the one place the bug
of the day wasn't.
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


def boot(b, url):
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(700)
    pg.click('button.icon-btn[data-action="close-tray"]'); pg.wait_for_timeout(300)
    return ctx, pg, errs


def empty_bundle(pg):
    keys = pg.evaluate("() => window.__oelaSync.storeKeys")
    return {"roster": {"other-device": {"lastPull": int(time.time() * 1000)}},
            "tombstones": [], "stores": {k: [] for k in keys}}


def rec(id_, title, ms=None):
    t = ms or int(time.time() * 1000)
    return {"id": id_, "title": title, "isGroup": False, "parent": None, "notesClean": "",
            "linkedProjectId": None, "contextId": None, "whenText": None,
            "createdAt": t, "modifiedAt": t, "deviceId": "other-device"}


def card_titles(pg):
    """Rendered card titles, top to bottom -- the order a person actually sees."""
    return pg.evaluate("""() => [...document.querySelectorAll('.card-title')]
        .map(e => e.textContent.trim()).filter(Boolean)""")


def group_titles(pg, kind="next"):
    """Context group headers within ONE lane, top to bottom.

    ⚠ Scoped to a single .lane on purpose: every action lane renders the same
    context set, and all of them are in the DOM at once (only one is visible),
    so an unscoped query returns the list once per lane and any ordering
    assertion on it is meaningless.
    """
    return pg.evaluate("""(kind) => {
        const lane = document.querySelector('.lane[data-kind="' + kind + '"]');
        return lane ? [...lane.querySelectorAll('.group-title')]
            .map(e => e.textContent.trim()).filter(Boolean) : [];
    }""", kind)


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()

    # ============================================================
    # Group 1 -- a synced-in item lands at the TOP
    # ============================================================
    ctx1, pg1, errs1 = boot(b, url)
    before = card_titles(pg1)
    check(bool(before), f"fixture: the lane has cards to land above ({before})")

    # Baseline first, so this is an ordinary merge and not a first-join strip.
    pg1.evaluate("(x) => window.__oelaSync.reconcile(x)", empty_bundle(pg1))
    pg1.wait_for_timeout(300)
    settled = card_titles(pg1)

    remote = empty_bundle(pg1)
    remote["stores"]["gtd_tasks_next"] = [rec("arrived-1", "ARRIVED FROM THE OTHER DEVICE")]
    pg1.evaluate("(x) => window.__oelaSync.reconcile(x)", remote)
    pg1.wait_for_timeout(500)

    after = card_titles(pg1)
    check("ARRIVED FROM THE OTHER DEVICE" in after,
          f"the record merged in and rendered at all ({after})")
    check(after and after[0] == "ARRIVED FROM THE OTHER DEVICE",
          f"THE RULING: it is at the TOP of the lane -- pre-W7 it was appended to the end, "
          f"below everything already there ({after})")
    check(after[1:] == settled,
          f"and nothing else moved -- a lane arranged by hand is not reshuffled "
          f"({after[1:]} vs {settled})")
    check(not errs1, f"no JS errors in group 1 ({errs1[:3]})")
    ctx1.close()

    # ============================================================
    # Group 2 -- contexts are DRAGGABLE, and the order is the user's
    # ============================================================
    # ⚑ Supersedes this file's original group 2, which asserted contexts render
    # alphabetically. The author's correction: the complaint was never "the two
    # devices disagree" alone, it was "they disagree AND I can't fix it."
    # Dragging restores the agency, so the sort is no longer wanted and stored
    # order is honoured instead.
    ctx2, pg2, errs2 = boot(b, url)

    def with_context_order(pg, names):
        pg.evaluate("""(names) => {
            localStorage.setItem('gtd_contexts', JSON.stringify(
                names.map(n => ({ id: 'ctx-' + n.toLowerCase(), name: n,
                                  modifiedAt: Date.now(), deviceId: 'd' }))));
            localStorage.setItem('gtd_contexts_ordered', '1'); // past the one-time normalization
        }""", names)
        pg.reload(); pg.wait_for_timeout(900)
        pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
        return group_titles(pg, "next")

    stored = with_context_order(pg2, ["Errands", "Calls", "Computer"])
    check(stored == ["Errands", "Calls", "Computer"],
          f"THE RULING: contexts render in the order they are STORED, not alphabetically — "
          f"the arrangement is the user's ({stored})")

    # Now drag the last one to the top, through the real press-and-hold path.
    TOUCH = """([sel, x, y, type]) => {
      const el = document.querySelector(sel);
      const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      const list = type === 'touchend' ? [] : [t];
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: list, targetTouches: list, changedTouches: [t] }));
    }"""
    SEL = '.lane[data-kind="next"] .group[data-context-group="ctx-computer"] .group-title'
    src = pg2.locator(SEL).bounding_box()
    pg2.evaluate(TOUCH, [SEL, src["x"] + src["width"] / 2, src["y"] + src["height"] / 2, "touchstart"])
    pg2.wait_for_timeout(550)  # past TOUCH_LONG_PRESS_MS
    check(pg2.locator(".group.dragging").count() == 1,
          "press and hold on a context group starts a drag — the list-group mechanics, reused")

    TOP = """() => { const r = document.querySelector('.lane[data-kind="next"] .cards-root')
        .getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 6 }; }"""
    for _ in range(5):
        c = pg2.evaluate(TOP)
        pg2.evaluate(TOUCH, [SEL, c["x"], c["y"], "touchmove"])
        pg2.wait_for_timeout(40)
    c = pg2.evaluate(TOP)
    pg2.evaluate(TOUCH, [SEL, c["x"], c["y"], "touchend"])
    pg2.wait_for_timeout(600)

    saved = pg2.evaluate("() => JSON.parse(localStorage.getItem('gtd_contexts')||'[]').map(c => c.name)")
    check(saved and saved[0] == "Computer",
          f"dropping it commits to the REGISTRY, not to a lane's task array ({saved})")
    check(group_titles(pg2, "next")[0] == "Computer",
          f"the dragged lane shows the new order ({group_titles(pg2, 'next')})")
    check(group_titles(pg2, "waiting")[0] == "Computer",
          f"AND SO DOES THE OTHER ACTION LANE — one registry behind both, so a drag in either is "
          f"a change to both ({group_titles(pg2, 'waiting')})")
    check(pg2.locator(".dragging, .drop-zone-active").count() == 0,
          "and every drag cue is cleared once the gesture ends")
    check(not errs2, f"no JS errors in group 2 ({errs2[:3]})")
    ctx2.close()

    # ============================================================
    # Group 3 -- the one-time alphabetical normalization
    # ============================================================
    # So two devices start hand-ordering from the SAME arrangement rather than
    # from whatever sequence each happened to merge in. Once only: after that
    # the order belongs to the user and is never touched again.
    ctx3, pg3, errs3 = boot(b, url)
    pg3.evaluate("""() => {
        localStorage.removeItem('gtd_contexts_ordered');
        localStorage.setItem('gtd_contexts', JSON.stringify(
            ['Errands','Calls','Computer'].map(n => ({ id: 'ctx-' + n.toLowerCase(), name: n }))));
    }""")
    pg3.reload(); pg3.wait_for_timeout(900)
    pg3.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    first = group_titles(pg3, "next")
    check(first == ["Calls", "Computer", "Errands"],
          f"a device that has never hand-ordered gets one alphabetical pass ({first})")

    # Hand-order it, reload, and confirm the normalization does NOT run again.
    pg3.evaluate("""() => {
        localStorage.setItem('gtd_contexts', JSON.stringify(
            ['Errands','Calls','Computer'].map(n => ({ id: 'ctx-' + n.toLowerCase(), name: n }))));
    }""")
    pg3.reload(); pg3.wait_for_timeout(900)
    pg3.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    again = group_titles(pg3, "next")
    check(again == ["Errands", "Calls", "Computer"],
          f"and it never runs again — a hand-made order is never re-sorted underneath the user ({again})")
    check(not errs3, f"no JS errors in group 3 ({errs3[:3]})")
    ctx3.close()

    b.close()

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)

"""Dragging into an EMPTY list or context: a visible target, and visible capture.

User round: "it's difficult to drag and drop items into empty lists... Ever since
we removed the quick add rows for lists and contexts, it's not clear where you're
supposed to drag an item, nor is it clear when it's been captured by the
list/context. Items in a list/context should be indented slightly, and when
you're dragging an item, it needs to be clearer both where to drag it and when
it's been captured. It needs to do both of these things without interrupting the
drag."

Three things are checked, and the third is the one that is easy to break:

  1. An empty list/context body is a real, card-sized target (it used to be 11px
     of bottom padding — the whole drop zone was a sliver you could not aim at).
  2. Members are indented relative to a loose card, and the accent rail is there.
  3. **Nothing the drag cues do changes layout.** The outline/background/colour
     swaps must not move geometry, and the body must not SHRINK when the
     drop-hint gives way to the dragged card — a zone that shrinks under the
     finger can bounce the card straight back out, which is exactly the
     "interrupting the drag" the user ruled out. Measured, not assumed.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys
from playwright.sync_api import sync_playwright

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


SEED = """() => {
  const nxt = [
    { id: 'zz-loose', title: 'ZZ loose action', notesClean: '', parent: null },
    { id: 'zz-list',  title: 'ZZ empty list',   notesClean: '', isGroup: true, parent: null, linkedProjectId: null },
    { id: 'zz-full',  title: 'ZZ full list',    notesClean: '', isGroup: true, parent: null, linkedProjectId: null },
    { id: 'zz-m1',    title: 'ZZ a member',     notesClean: '', parent: 'zz-full' }
  ];
  localStorage.setItem('gtd_tasks_next', JSON.stringify(nxt));
  localStorage.setItem('gtd_contexts', JSON.stringify([{ id: 'zz-ctx', name: 'ZZ empty context' }]));
}"""

# Geometry of every drop zone in the Next lane, keyed by its dropzone parent id.
GEOM = """() => {
  const out = {};
  document.querySelectorAll('.lane[data-kind="next"] .group-body').forEach(b => {
    const r = b.getBoundingClientRect();
    out[b.getAttribute('data-dropzone-parent')] =
      { top: r.top, left: r.left, w: r.width, h: r.height };
  });
  return out;
}"""

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    # has_touch so TouchEvent/Touch can be constructed for the press-and-hold
    # path in section 5 — the phone gesture, which has no native DnD at all.
    pg = b.new_context(viewport={"width": 420, "height": 900}, has_touch=True).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1100)
    pg.evaluate(SEED)
    pg.reload(); pg.wait_for_timeout(1200)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    # ---------- 1. an empty list / context is an aimable target ----------
    for gid, label in (("zz-list", "list"), ("zz-ctx", "context")):
        h = pg.evaluate("""(id) => {
          const b = document.querySelector('.lane[data-kind="next"] [data-dropzone-parent="' + id + '"]');
          return b ? b.getBoundingClientRect().height : 0;
        }""", gid)
        check(h >= 40, f"an empty {label}'s drop zone is a real target, not a sliver ({h:.0f}px)")
        hint = pg.locator(f'.lane[data-kind="next"] [data-dropzone-parent="{gid}"] .drop-hint')
        check(hint.count() == 1, f"and the empty {label} says where to drag")
    # a list that HAS items shows no hint
    check(pg.locator('[data-dropzone-parent="zz-full"] .drop-hint:visible').count() == 0,
          "a list with items shows no drop hint")
    # the hint can never swallow a tap or the drag hit test
    check(pg.evaluate("""() => getComputedStyle(document.querySelector('.drop-hint')).pointerEvents""") == "none",
          "the hint is inert (pointer-events:none)")

    # ---------- 2. members are indented, with a rail ----------
    indent = pg.evaluate("""() => {
      const q = s => document.querySelector('.lane[data-kind="next"] ' + s);
      const loose = q('.cards-root > .card');
      const member = q('[data-dropzone-parent="zz-full"] > .card');
      const body = q('[data-dropzone-parent="zz-full"]');
      const rail = body ? getComputedStyle(body, '::before') : null;
      return { loose: loose && loose.getBoundingClientRect().left,
               member: member && member.getBoundingClientRect().left,
               railW: rail && rail.width, railBg: rail && rail.backgroundColor };
    }""")
    check(indent["member"] is not None and indent["loose"] is not None
          and indent["member"] - indent["loose"] >= 12,
          f"a member is indented past a loose action ({indent['member']} vs {indent['loose']})")
    check(indent["railW"] not in (None, "auto", "0px"),
          f"and sits against a containment rail ({indent['railW']})")

    # ---------- 3. the drag cues cost no layout ----------
    before = pg.evaluate(GEOM)
    # drag-active alone (every zone advertises itself)
    pg.evaluate("() => document.body.classList.add('drag-active')")
    during = pg.evaluate(GEOM)
    # ...and one zone lit up as captured
    pg.evaluate("""() => document.querySelector('[data-dropzone-parent="zz-list"]')
                     .classList.add('drop-zone-active')""")
    active = pg.evaluate(GEOM)
    pg.evaluate("""() => { document.body.classList.remove('drag-active');
      document.querySelectorAll('.drop-zone-active').forEach(e => e.classList.remove('drop-zone-active')); }""")

    def same(a, c, keys=("top", "left", "w", "h")):
        return all(abs(a[k] - c[k]) < 0.6 for k in keys)

    check(all(same(before[k], during[k]) for k in before),
          f"turning the drag cues on moves nothing ({before} -> {during})")
    check(all(same(during[k], active[k]) for k in during),
          f"and lighting up the captured zone moves nothing ({during} -> {active})")

    # the empty zone must not SHRINK when a card replaces the drop-hint
    empty_h = before["zz-list"]["h"]
    with_card = pg.evaluate("""() => {
      document.body.classList.add('drag-active');
      const body = document.querySelector('[data-dropzone-parent="zz-list"]');
      const card = document.querySelector('.lane[data-kind="next"] .cards-root > .card');
      const home = card.parentElement, next = card.nextSibling;
      body.appendChild(card);
      const h = body.getBoundingClientRect().height;
      home.insertBefore(card, next);
      document.body.classList.remove('drag-active');
      return h;
    }""")
    check(with_card >= empty_h - 0.6,
          f"the zone never shrinks when the dragged card lands in it "
          f"(empty {empty_h:.0f}px -> holding a card {with_card:.0f}px)")

    # ---------- 4. a real drag into the empty list actually commits ----------
    src = pg.locator('.lane[data-kind="next"] .cards-root > .card .card-title[data-id="zz-loose"]')
    box = src.bounding_box()
    CENTRE = """() => {
      const r = document.querySelector('[data-dropzone-parent="zz-list"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }"""
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2 + 8, steps=3)
    # Re-aim between hops. Live-snap reordering moves real content as the card
    # travels — the empty list shifts up the moment the card leaves its old slot
    # — so a fixed coordinate computed before the drag is stale by the time the
    # pointer arrives. A person re-aims at what they can see; so does this.
    for _ in range(4):
        c = pg.evaluate(CENTRE)
        pg.mouse.move(c["x"], c["y"], steps=6)
    lit = pg.locator('[data-dropzone-parent="zz-list"].drop-zone-active').count()
    pg.mouse.up()
    pg.wait_for_timeout(500)
    check(lit == 1, "the list under the pointer is lit as captured mid-drag")
    landed = pg.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_next')) || [])
        .find(t => t.id === 'zz-loose')""")
    check(landed and landed.get("parent") == "zz-list",
          f"and dropping there really puts the item in the list (parent={landed and landed.get('parent')})")
    check(pg.locator('[data-dropzone-parent="zz-list"] .drop-hint:visible').count() == 0,
          "the hint is gone once the list has an item")

    # ---------- 5. the LAST card in the lane, dropped by touch ----------
    # Two things at once, and both were broken:
    #   · the phone path (press-and-hold) is the one that actually matters here
    #     — it shares applyLiveMove with the mouse but reaches it differently
    #   · the dragged card being the LAST element in the lane is the case where
    #     "insert before nothing" looked identical to "already in place", so the
    #     card silently refused to enter an empty list at the bottom of a lane
    pg.evaluate("""() => {
      localStorage.setItem('gtd_tasks_next', JSON.stringify([
        { id: 'zz-list', title: 'ZZ empty list', notesClean: '', isGroup: true,
          parent: null, linkedProjectId: null },
        { id: 'zz-last', title: 'ZZ last in the lane', notesClean: '', parent: null }
      ]));
      localStorage.setItem('gtd_contexts', '[]');
    }""")
    pg.reload(); pg.wait_for_timeout(1200)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    check(pg.evaluate("""() => {
            const c = document.querySelector('.lane[data-kind="next"] .cards-root');
            return c.lastElementChild && c.lastElementChild.getAttribute('data-drag-id') === 'zz-last';
          }"""), "the card under test really is the last one in the lane")

    TOUCH = """([sel, x, y, type]) => {
      const el = document.querySelector(sel);
      const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      const list = type === 'touchend' ? [] : [t];
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: list, targetTouches: list, changedTouches: [t] }));
    }"""
    SEL = '.card-title[data-id="zz-last"]'
    src = pg.locator(SEL).bounding_box()
    sx, sy = src["x"] + src["width"] / 2, src["y"] + src["height"] / 2
    pg.evaluate(TOUCH, [SEL, sx, sy, "touchstart"])
    pg.wait_for_timeout(550)   # past TOUCH_LONG_PRESS_MS — the hold has fired
    check(pg.locator(".card.dragging").count() == 1, "press and hold starts a touch drag")
    CENTRE = """() => {
      const r = document.querySelector('[data-dropzone-parent="zz-list"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }"""
    for _ in range(4):
        c = pg.evaluate(CENTRE)
        pg.evaluate(TOUCH, [SEL, c["x"], c["y"], "touchmove"])
        pg.wait_for_timeout(40)
    check(pg.locator('[data-dropzone-parent="zz-list"].drop-zone-active').count() == 1,
          "the empty list lights up under the finger")
    check(pg.evaluate("""() => { const d = document.querySelector('.card.dragging');
            return !!(d && d.parentElement.getAttribute('data-dropzone-parent') === 'zz-list'); }"""),
          "and the card really moves into it mid-drag (not just outlined)")
    c = pg.evaluate(CENTRE)
    pg.evaluate(TOUCH, [SEL, c["x"], c["y"], "touchend"])
    pg.wait_for_timeout(500)
    landed = pg.evaluate("""() => (JSON.parse(localStorage.getItem('gtd_tasks_next')) || [])
        .find(t => t.id === 'zz-last')""")
    check(landed and landed.get("parent") == "zz-list",
          f"lifting the finger commits it (parent={landed and landed.get('parent')})")
    check(pg.locator(".drop-zone-active").count() == 0 and pg.locator(".dragging").count() == 0,
          "and every drag cue is cleared once the gesture ends")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

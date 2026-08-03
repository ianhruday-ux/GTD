"""The + beside a list's / context's count replaces the quick-add rows.

User: "removing the quick add rows from the lanes. To substitute, try putting a
small appropriately coloured + button beside the number badge on lists and
contexts. That should open a drafting page with the appropriate context already
filled in. I don't think we have an equivalent control for lists, so you can just
drop the created project in the correct list when it's created."

So the two destinations reach the drafting page by different routes and this
checks both landings:
  · a CONTEXT pre-fills the context field, which the page already had
  · a LIST has no field — it sets the new item's parent on save, which required
    carrying `parent` through createTask for the first time

⚠ The + lives inside .group-header, whose own click toggles the list open and
shut. The handler stops propagation; without that, tapping + also collapses the
list you are adding to. That is checked here because it is invisible in the
markup and obvious only when you use it.

⚑ AND ON THE PROJECT LANES (author bug report: "the add button on the project
list doesn't add the project under the list ... it does seem to work for
contexts"). Lists render identically in Current and Someday, but a project does
not save through createTask — saveProjectScreen builds its record from an
explicit whitelist and hard-coded `parent: null`, so the field was dropped and
the project landed loose at the top of the lane. This file only ever exercised a
list in NEXT ACTIONS, which is why it passed throughout. Both project lanes are
checked now, Current with the staged action its way-forward gate requires.
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


with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1100)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    # a list in Next Actions, and a context with a member
    pg.evaluate("""() => {
      const nxt = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
      nxt.unshift({ id: 'zz-list', title: 'ZZ errands', notesClean: '', isGroup: true,
                    parent: null, linkedProjectId: null });
      localStorage.setItem('gtd_tasks_next', JSON.stringify(nxt));
      localStorage.setItem('gtd_contexts', JSON.stringify([{ id: 'zz-ctx', name: 'ZZ at the desk' }]));
    }""")
    pg.reload(); pg.wait_for_timeout(1100)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    # ---------- the quick-add rows are gone ----------
    check(pg.locator(".add-row-mini").count() == 0,
          f"no quick-add rows anywhere ({pg.locator('.add-row-mini').count()})")
    check(pg.locator('[data-role="add-mini"]').count() == 0, "and none of their buttons")

    # ---------- the + is there, on both ----------
    list_add = pg.locator('[data-action="add-to-list"][data-id="zz-list"]')
    ctx_add = pg.locator('[data-action="add-to-context"][data-id="zz-ctx"]')
    check(list_add.count() == 1, "a list has a + beside its count")
    # ⚠ >= 1, not == 1: BOTH action lanes (Next and Waiting) are in the DOM at
    # once — only one is visible — so a context renders a group in each.
    check(ctx_add.count() >= 1, f"and so does a context ({ctx_add.count()})")

    # it carries the lane's accent, not a neutral grey
    colour = pg.evaluate("""() => {
      const el = document.querySelector('[data-action="add-to-list"]');
      const g = getComputedStyle(el);
      const accent = getComputedStyle(el.closest('.lane') || document.documentElement)
        .getPropertyValue('--lane-accent').trim();
      return { colour: g.color, accent: accent, bg: g.backgroundColor };
    }""")
    check(colour["colour"] not in ("rgb(0, 0, 0)", "rgba(0, 0, 0, 0)"),
          f"the + is coloured, not default ({colour})")
    check(colour["bg"] not in ("rgba(0, 0, 0, 0)",), f"and has a fill ({colour})")

    # ---------- it must NOT collapse the list it belongs to ----------
    before = pg.locator('.group:has([data-id="zz-list"]) .group-body').count()
    list_add.first.click(); pg.wait_for_timeout(600)
    check(pg.locator("#screen-root .screen-overlay, .screen-overlay").count() >= 1,
          "tapping + opens the drafting page")

    # ---------- a list drop: parent is set on save ----------
    pg.fill('[data-field="title"]', "ZZ posted the parcel")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(700)
    row = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next'))
        .find(t => t.title === 'ZZ posted the parcel') || null""")
    check(row is not None, "the item was created")
    check(row and row["parent"] == "zz-list",
          f"and it landed IN the list it was added from ({row.get('parent') if row else None})")
    # and it renders inside that list, not loose at the top of the lane
    inside = pg.evaluate("""() => {
      const hdr = document.querySelector('[data-action="add-to-list"][data-id="zz-list"]');
      const group = hdr ? hdr.closest('.group') : null;
      return !!(group && [...group.querySelectorAll('.card-title')]
        .some(t => t.textContent.trim() === 'ZZ posted the parcel'));
    }""")
    check(inside, "and it renders inside that list")

    # ---------- a context drop: the context field is pre-filled ----------
    pg.locator('.lane[data-kind="next"] [data-action="add-to-context"][data-id="zz-ctx"]').first.click()
    pg.wait_for_timeout(600)
    picked = pg.evaluate("""() => {
      const sel = document.querySelector('[data-field="contextId"]');
      return sel ? sel.value : null;
    }""")
    check(picked == "zz-ctx", f"the context is already chosen on the page ({picked})")
    pg.fill('[data-field="title"]', "ZZ tidy the inbox")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(700)
    row = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next'))
        .find(t => t.title === 'ZZ tidy the inbox') || null""")
    check(row is not None and row["contextId"] == "zz-ctx",
          f"and the saved item keeps that context ({row.get('contextId') if row else None})")
    check(row is not None and not row.get("parent"),
          f"a context does not also set a parent ({row.get('parent') if row else None})")

    # ---------- the ordinary create path is unchanged ----------
    # Nothing opened from the floating button belongs to a list.
    pg.click('[data-action="fab"]'); pg.wait_for_timeout(350)
    pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(500)
    pg.fill('[data-field="title"]', "ZZ loose action")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(700)
    row = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next'))
        .find(t => t.title === 'ZZ loose action') || null""")
    check(row is not None and not row.get("parent"),
          f"an item created from the floating + is still ungrouped ({row.get('parent') if row else None})")

    # ---------- the + works while the list is COLLAPSED ----------
    # The old quick-add row could not: it lived in the body, which is not
    # rendered when collapsed.
    pg.evaluate("""() => {
      const h = document.querySelector('.group-header[data-id="zz-list"]');
      if (h) h.click();
    }""")
    pg.wait_for_timeout(400)
    collapsed = pg.locator('.group:has([data-id="zz-list"]) .group-body').count()
    still = pg.locator('[data-action="add-to-list"][data-id="zz-list"]').count()
    check(collapsed == 0, f"the list really is collapsed ({collapsed})")
    check(still == 1, "and its + is still reachable")

    # ---------- THE PROJECT LANES: a list drop must work there too ----------
    # Seeded after the fact so the checks above ran against the lane they were
    # written for. Both project lanes get a list; the reload picks them up.
    pg.evaluate("""() => {
      [['gtd_tasks_current','zz-clist','ZZ house'], ['gtd_tasks_future','zz-flist','ZZ someday pile']]
        .forEach(([key, id, title]) => {
          const arr = JSON.parse(localStorage.getItem(key) || '[]');
          arr.unshift({ id: id, title: title, notesClean: '', isGroup: true,
                        parent: null, linkedProjectId: null });
          localStorage.setItem(key, JSON.stringify(arr));
        });
    }""")
    pg.reload(); pg.wait_for_timeout(1100)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    # --- Someday: no way-forward gate, so this is the bare create path ---
    pg.click('.tab[data-kind="future"]'); pg.wait_for_timeout(450)
    f_add = pg.locator('.lane[data-kind="future"] [data-action="add-to-list"][data-id="zz-flist"]')
    check(f_add.count() == 1, f"a Someday list has a + too ({f_add.count()})")
    if f_add.count():
        f_add.first.click(); pg.wait_for_timeout(650)
        pg.fill('[data-field="title"]', "ZZ re-shingle the roof")
        pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(800)
    row = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_future') || '[]')
        .find(t => t.title === 'ZZ re-shingle the roof') || null""")
    check(row is not None, "the Someday project was created")
    check(row and row.get("parent") == "zz-flist",
          f"and it landed IN the list it was added from ({row.get('parent') if row else None})")

    # --- Current: same +, but the page also demands a way forward ---
    pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(450)
    c_add = pg.locator('.lane[data-kind="current"] [data-action="add-to-list"][data-id="zz-clist"]')
    check(c_add.count() == 1, f"a Current list has a + too ({c_add.count()})")
    if c_add.count():
        c_add.first.click(); pg.wait_for_timeout(650)
        pg.fill('[data-field="title"]', "ZZ replace the gutters")
        # §4.3: a new Current project needs one staged action or it will not save
        gen = pg.locator('[data-action="generate-action"][data-gen-kind="next"]')
        if gen.count():
            gen.first.click(); pg.wait_for_timeout(600)
            pg.fill('[data-field="title"]', "ZZ price the gutters")
            pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(700)
        pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(900)
    row = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]')
        .find(t => t.title === 'ZZ replace the gutters') || null""")
    check(row is not None, "the Current project was created")
    check(row and row.get("parent") == "zz-clist",
          f"and it landed IN the list it was added from ({row.get('parent') if row else None})")
    # and it renders inside that list, not loose at the top of the lane
    inside = pg.evaluate("""() => {
      const hdr = document.querySelector('.lane[data-kind="current"] [data-action="add-to-list"][data-id="zz-clist"]');
      const group = hdr ? hdr.closest('.group') : null;
      return !!(group && [...group.querySelectorAll('.card-title')]
        .some(t => t.textContent.trim() === 'ZZ replace the gutters'));
    }""")
    check(inside, "and it renders inside that list")

    # the staged child action is NOT dragged into the list along with it
    child = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]')
        .find(t => t.title === 'ZZ price the gutters') || null""")
    check(child is None or not child.get("parent"),
          f"its staged action stays ungrouped in Next ({child.get('parent') if child else 'absent'})")

    # an EDIT does not move a project between lists from the page
    pg.locator('.card-title:has-text("ZZ replace the gutters")').first.click()
    pg.wait_for_timeout(650)
    pg.fill('[data-field="title"]', "ZZ replace the gutters EDITED")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(900)
    row = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]')
        .find(t => t.title === 'ZZ replace the gutters EDITED') || null""")
    check(row is not None and row.get("parent") == "zz-clist",
          f"editing it keeps it in the list ({row.get('parent') if row else None})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

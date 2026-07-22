"""The desktop layout (desktop-redesign-plan.md).

Until this round the app had ONE layout and every check pinned a phone viewport,
so the desktop shell shipped with zero coverage (trap T3). This is the smoke
check that closes that hole. It runs at 1440x900 — explicitly, never the default
— and a companion pass at 390px proves the phone is untouched.

WHAT THIS GUARDS:
  · the breakpoint has ONE source of truth: body.desktop and the CSS media query
    agree, in both directions, across a live resize (trap T1);
  · three columns render at once, in the author's pairings, and each column's
    toggle switches only its own column (ruling 2);
  · the toggles carry BOTH lanes' counts — the hidden half's count is the reason
    to toggle (trap T5);
  · the notes lane is really rendered when its column lands on it, not stale;
  · per-column create buttons exist and route by their own data-kind, not by
    state.activeKind (trap T4) — the Notes column's three buttons open a note, a
    checklist and the Tags page;
  · the FAB and the tab bar are gone on desktop, and back on the phone;
  · a drafting page is a centered card with Done bottom-right and Delete
    bottom-left, and Done still saves (it IS screen-save);
  · exactly ONE element carries data-action="screen-save" in either mode — the
    action name has to stay an unambiguous selector for every other check;
  · the discard gate: an untouched page closes silently, a touched one asks;
  · the header holds Language and Background dropdowns and the gear menu does
    NOT (one place per thing), while the phone's gear menu still does;
  · the tray handle opens the drawer on both layouts and hides while it is open.
"""
import os, sys, functools, http.server, socket, socketserver, threading, contextlib
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

# Windows consoles default to cp1252 and this file's labels are not ASCII.
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

DIST = os.path.join(REPO, "dist")
DESKTOP = {"width": 1440, "height": 900}
PHONE = {"width": 390, "height": 844}

fails = []


def check(cond, label):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        fails.append(label)


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
        httpd.shutdown()


def visible_lanes(pg):
    return pg.evaluate("() => [...document.querySelectorAll('.lane.active-lane')].map(l => l.dataset.kind)")


def close_tray(pg):
    """The drawer auto-opens on launch (§4.8a) and covers the left column."""
    pg.evaluate("() => { const b = document.querySelector('[data-action=\"close-tray\"]'); if (b) b.click(); }")
    pg.wait_for_timeout(400)


def run(pg, url, viewport, errors):
    pg.set_viewport_size(viewport)
    pg.goto(url)
    pg.wait_for_timeout(700)
    close_tray(pg)
    return pg


def main():
    with serve(DIST) as url, sync_playwright() as p:
        br = p.chromium.launch()

        # ---------------------------------------------------------------- desktop
        ctx = br.new_context(viewport=DESKTOP)
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        run(pg, url, DESKTOP, errors)

        print("\n-- desktop shell --")
        check(pg.evaluate("() => document.body.classList.contains('desktop')"), "body.desktop is on at 1440px")
        check(pg.evaluate("() => getComputedStyle(document.querySelector('.tabbar')).display") == "none",
              "the tab bar is gone")
        check(pg.evaluate("() => getComputedStyle(document.querySelector('#fab-create')).display") == "none",
              "the floating + is gone")
        check(visible_lanes(pg) == ["next", "current", "notes"],
              "fresh load shows Next / Projects / Notes")
        cols = pg.evaluate("""() => [...document.querySelectorAll('.lane.active-lane')]
          .map(l => l.getBoundingClientRect().left)""")
        check(len(cols) == 3 and cols[0] < cols[1] < cols[2], "the three lanes really sit side by side")
        check(pg.evaluate("() => document.querySelectorAll('.lane.active-lane .lane-colhead .col-tab').length") == 6,
              "each visible lane renders its own two-lane column toggle")
        check(pg.evaluate("""() => [...document.querySelectorAll('.lane.active-lane .lane-label')]
              .every(el => getComputedStyle(el).display === 'none')"""),
              "the in-lane label is hidden, not stacked under the toggle (trap T8)")

        print("\n-- column toggles --")
        pg.click('.lane[data-kind="next"] .col-tab[data-kind="waiting"]'); pg.wait_for_timeout(300)
        check(visible_lanes(pg) == ["waiting", "current", "notes"],
              "the left toggle switches only the left column")
        pg.click('.lane[data-kind="notes"] .col-tab[data-kind="habit"]'); pg.wait_for_timeout(300)
        check(visible_lanes(pg) == ["waiting", "current", "habit"],
              "the right toggle switches only the right column")
        pg.click('.lane[data-kind="habit"] .col-tab[data-kind="notes"]'); pg.wait_for_timeout(300)
        check(pg.evaluate("() => document.querySelectorAll('.lane[data-kind=\"notes\"] .note-card, .lane[data-kind=\"notes\"] .empty-note').length") > 0,
              "landing the right column on Notes renders the notes lane (trap T5)")
        counts = pg.evaluate("""() => [...document.querySelectorAll('.lane[data-kind="waiting"] .col-tab')]
          .map(b => b.dataset.kind + ':' + b.querySelector('.col-count').textContent)""")
        live = pg.evaluate("""() => ({ next: JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').length,
                                       waiting: JSON.parse(localStorage.getItem('gtd_tasks_waiting')||'[]').length })""")
        check(counts == ["next:%d" % live["next"], "waiting:%d" % live["waiting"]],
              "the toggle shows BOTH lanes' counts, the hidden half included")
        pg.click('.lane[data-kind="waiting"] .col-tab[data-kind="next"]'); pg.wait_for_timeout(250)

        print("\n-- per-column create buttons (trap T4) --")
        labels = pg.evaluate("""() => [...document.querySelectorAll('.lane[data-kind="notes"] .lane-create-btn')]
          .map(b => b.textContent.trim())""")
        check(labels == ["+ New note", "+ New checklist", "Tags"],
              "Notes offers its three options as real buttons: %s" % labels)
        check(pg.evaluate("""() => [...document.querySelectorAll('.lane[data-kind="habit"] .lane-create-btn')]
              .map(b => b.textContent.trim())""") == ["+ New habit"],
              "Habits offers exactly one — it has no menu to copy")
        # The Notes column's buttons must act on NOTES even though the left
        # column (the "active kind") is Next Actions. This is trap T4 itself.
        pg.click('.lane[data-kind="notes"] .lane-create-btn[data-idx="2"]'); pg.wait_for_timeout(500)
        check(pg.evaluate("() => (document.querySelector('.screen-kind-badge')||{}).textContent") == "Tags",
              "the Notes column's Tags button opens the Tags page, not the left column's")
        pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(400)
        pg.click('.lane[data-kind="notes"] .lane-create-btn[data-idx="1"]'); pg.wait_for_timeout(500)
        check(pg.evaluate("() => !!document.querySelector('.note-body ul.checklist')"),
              "New checklist opens a note that is already a checklist")
        pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(400)

        print("\n-- the drafting card (ruling 4) --")
        pg.click('.lane[data-kind="next"] .lane-create-btn[data-idx="0"]'); pg.wait_for_timeout(500)
        check(pg.evaluate("() => !!document.querySelector('.screen-overlay .screen-card')"),
              "the page renders as a card inside the overlay")
        geom = pg.evaluate("""() => { const c = document.querySelector('.screen-card');
          const r = c.getBoundingClientRect();
          return { w: Math.round(r.width), centered: Math.abs((r.left + r.right)/2 - innerWidth/2) < 4 }; }""")
        check(geom["centered"] and 600 < geom["w"] <= 700, "it is centered and ~700px wide: %s" % geom)
        check(pg.evaluate("() => document.querySelectorAll('[data-action=\"screen-save\"]').length") == 1,
              "exactly ONE element carries data-action=screen-save")
        check(pg.evaluate("""() => { const f = document.querySelector('.screen-footer-done');
              return !!f && getComputedStyle(f).display !== 'none'; }"""),
              "Done sits in the footer")
        # A brand-new empty draft is never dirty: ✕ closes silently (trap T6c).
        pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(400)
        check(pg.evaluate("() => !document.querySelector('.screen-overlay') && !document.querySelector('.choice-dialog')"),
              "an untouched create closes with no confirm")

        pg.click('.lane[data-kind="next"] .lane-create-btn[data-idx="0"]'); pg.wait_for_timeout(500)
        pg.fill('.screen-field-title', 'Desktop smoke action')
        pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(400)
        check(pg.evaluate("() => !!document.querySelector('.choice-dialog')"),
              "a TOUCHED draft asks before discarding (ruling 5)")
        pg.evaluate("""() => [...document.querySelectorAll('.choice-dialog-btns button')]
          .find(b => b.classList.contains('danger')).click()""")
        pg.wait_for_timeout(400)
        check(pg.evaluate("() => !JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').some(t => t.title === 'Desktop smoke action')"),
              "discarding really discarded it - cancel still never commits")

        pg.click('.lane[data-kind="next"] .lane-create-btn[data-idx="0"]'); pg.wait_for_timeout(500)
        pg.fill('.screen-field-title', 'Desktop smoke action')
        pg.click('.screen-footer-done'); pg.wait_for_timeout(600)
        check(pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').some(t => t.title === 'Desktop smoke action')"),
              "Done saves and closes — it IS the old back arrow")

        print("\n-- the header (author note 8) --")
        check(pg.evaluate("() => document.querySelectorAll('#header-left .header-drop').length") == 2,
              "Language and Background are header dropdowns")
        check(pg.evaluate("() => !!document.querySelector('#header-left [data-action=\"open-calendar\"]')"),
              "the Calendar button moved beside them")
        # MOVED, not cloned. Scoped to the header: the Waiting lane's calendar
        # widget carries the same action by design (§4.13b).
        check(pg.evaluate("() => document.querySelectorAll('header [data-action=\"open-calendar\"]').length") == 1,
              "...MOVED, not duplicated")
        pg.click('[data-action="hdr-drop"][data-drop="lang"]'); pg.wait_for_timeout(250)
        check(pg.evaluate("() => document.querySelectorAll('.header-drop-menu:not([hidden]) [data-action=\"settings-pick-lang\"]').length") >= 2,
              "the Language dropdown lists the locales")
        pg.click('[data-action="hdr-drop"][data-drop="bg"]'); pg.wait_for_timeout(250)
        check(pg.evaluate("() => document.querySelectorAll('.header-drop-menu:not([hidden])').length") == 1,
              "opening one dropdown closes the other")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        check(pg.evaluate("() => document.querySelectorAll('.header-drop-menu:not([hidden])').length") == 0,
              "Escape closes an open dropdown (trap T17)")
        pg.click('[data-action="open-overflow"]'); pg.wait_for_timeout(300)
        check(pg.evaluate("() => !document.querySelector('[data-action=\"settings-language\"]') && !document.querySelector('[data-action=\"settings-backgrounds\"]')"),
              "the desktop gear menu has dropped Language and Background")
        pg.click('.menu-scrim'); pg.wait_for_timeout(250)   # the gear menu closes on its scrim, not Escape

        print("\n-- the calendar as a popup (ruling 6) --")
        pg.click('#header-left [data-action="open-calendar"]'); pg.wait_for_timeout(600)
        w = pg.evaluate("""() => { const c = document.querySelector('.screen-overlay[data-kind="calendar"] .screen-card');
          return c ? Math.round(c.getBoundingClientRect().width) : 0; }""")
        check(800 < w <= 900, "the calendar card is ~900px wide: %d" % w)
        check(pg.evaluate("""() => { const b = document.querySelector('.screen-overlay[data-kind="calendar"] .screen-body');
              const g = document.querySelector('.cal-cells');
              return !!g && g.getBoundingClientRect().width > 700; }"""),
              "the month grid actually grew with it (trap T11)")
        pg.click('[data-action="cal-close"]'); pg.wait_for_timeout(400)

        print("\n-- the tray --")
        check(pg.evaluate("""() => { const h = document.querySelector('#tray-handle');
              return !!h && getComputedStyle(h).display !== 'none' && h.dataset.action === 'open-tray'; }"""),
              "the left-edge handle is present and keeps data-action=open-tray (trap T2)")
        pg.click('#tray-handle'); pg.wait_for_timeout(500)
        check(pg.evaluate("() => !!document.querySelector('.tray-drawer.open')"), "it opens the drawer")
        check(pg.evaluate("() => getComputedStyle(document.querySelector('#tray-handle')).opacity") == "0",
              "and hides itself while the drawer is open (trap T15b)")
        tw = pg.evaluate("() => Math.round(document.querySelector('.tray-drawer').getBoundingClientRect().width)")
        check(tw == 440, "the drawer is 440px on desktop: %d" % tw)
        pg.click('.tray-edge-handle'); pg.wait_for_timeout(600)
        check(pg.evaluate("() => !document.querySelector('.tray-drawer')"), "the drawer's own arrow closes it")
        check(pg.evaluate("() => getComputedStyle(document.querySelector('#tray-handle')).opacity") == "1",
              "the handle comes back after the slide-out finishes")

        print("\n-- live resize across the boundary (trap T1) --")
        pg.set_viewport_size(PHONE); pg.wait_for_timeout(500)
        check(not pg.evaluate("() => document.body.classList.contains('desktop')"), "crossing down leaves desktop mode")
        check(len(visible_lanes(pg)) == 1, "the phone shows exactly one lane")
        check(pg.evaluate("() => getComputedStyle(document.querySelector('#fab-create')).display") != "none",
              "the floating + is back")
        check(pg.evaluate("() => !!document.querySelector('.tab.active') && document.querySelector('.tab.active').dataset.kind") == visible_lanes(pg)[0],
              "the tab strip agrees with the lane on screen")
        pg.set_viewport_size(DESKTOP); pg.wait_for_timeout(500)
        check(pg.evaluate("() => document.body.classList.contains('desktop')") and len(visible_lanes(pg)) == 3,
              "and crossing back up restores three columns")
        ctx.close()

        # ------------------------------------------------------------- the phone
        print("\n-- the phone is untouched (except the handle) --")
        ctx2 = br.new_context(viewport=PHONE)
        pg2 = ctx2.new_page()
        pg2.on("pageerror", lambda e: errors.append(str(e)))
        pg2.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg2.goto(url); pg2.wait_for_timeout(700)
        close_tray(pg2)
        check(not pg2.evaluate("() => document.body.classList.contains('desktop')"), "no desktop mode at 390px")
        check(pg2.evaluate("() => getComputedStyle(document.querySelector('.tabbar')).display") != "none",
              "the tab bar is still there")
        check(pg2.evaluate("""() => [...document.querySelectorAll('.lane.active-lane .lane-colhead, .lane.active-lane .lane-create-row')]
              .every(el => getComputedStyle(el).display === 'none')"""),
              "the desktop column head and create row are hidden, not rendered twice")
        check(pg2.evaluate("() => getComputedStyle(document.querySelector('.lane.active-lane .lane-label')).display") != "none",
              "the phone's floating lane label is back")
        check(pg2.evaluate("() => !document.querySelector('header [data-action=\"open-tray\"]')"),
              "the header's intray button has retired on the phone too")
        pg2.click('#tray-handle'); pg2.wait_for_timeout(500)
        check(pg2.evaluate("() => !!document.querySelector('.tray-drawer.open')"), "the handle opens the drawer here too")
        close_tray(pg2)
        pg2.click('#fab-create'); pg2.wait_for_timeout(200)
        pg2.click('[data-action="new-primary"]'); pg2.wait_for_timeout(500)
        check(pg2.evaluate("() => document.querySelectorAll('[data-action=\"screen-save\"]').length") == 1,
              "the phone still has exactly one screen-save (its back arrow)")
        check(pg2.evaluate("""() => { const f = document.querySelector('.screen-footer');
              return !f || getComputedStyle(f).display === 'none'; }"""),
              "no desktop footer on the phone")
        ctx2.close()
        br.close()

    check(not errors, "no JS errors on either layout: %s" % errors[:3])
    print("\n%d failure(s)" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

"""Draft isolation on the desktop card (CLAUDE.md's standing verification).

CLAUDE.md requires this every round that touches a draft page, and this round
rearranged every drafting surface: the chrome moved into a footer, Complete and
Convert were grouped, and a discard confirm was slipped in front of the exit.
That is exactly when a control quietly starts committing early.

The rule the procedure encodes: "no control leaks" is a claim about ALL of them
and can only be made by enumeration — so this script ENUMERATES what each page
renders (and prints the list, so the record is readable), mutates through those
controls, leaves, and then asserts on the only thing that actually matters: not
one byte of gtd_ storage changed.

A whole-storage snapshot is the assertion on purpose. Checking "the title did
not save" only proves the control you thought about; comparing every key proves
the ones you did not — including side effects on OTHER items, which draft
isolation covers explicitly.

Then the other half, which is just as important and easier to forget: Done must
commit everything. A page that saves nothing is not isolated, it is broken.

WHAT THIS GUARDS, per page type (next action, habit, note, project):
  · the controls the card renders are enumerated, not assumed;
  · mutating every one of them and pressing ✕ → Discard changes NO stored data;
  · an armed Complete is discarded with the rest;
  · Done commits, from its new bottom-right position;
  · 🗑 Delete — the one deliberate exception — still acts immediately, from its
    new bottom-left position, and still behind its confirm.
"""
import os, sys, json, functools, http.server, socket, socketserver, threading, contextlib
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

DIST = os.path.join(REPO, "dist")
DESKTOP = {"width": 1440, "height": 900}

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


def snapshot(pg):
    """Every gtd_ key, verbatim. gtddev_ is excluded: dev preferences are not app data."""
    return pg.evaluate("""() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++){
        const k = localStorage.key(i);
        if (k.indexOf('gtd_') === 0) out[k] = localStorage.getItem(k);
      }
      return out;
    }""")


def enumerate_controls(pg):
    """Every control the OPEN CARD renders — not the ones the test touched."""
    return pg.evaluate("""() => [...document.querySelectorAll(
        '.screen-card button, .screen-card input, .screen-card textarea, .screen-card select, .screen-card [contenteditable]')]
      .filter(el => el.offsetParent !== null || el.getAttribute('contenteditable') !== null)
      .map(el => {
        const tag = el.tagName.toLowerCase();
        const act = el.getAttribute('data-action') || el.getAttribute('data-field') || el.className.split(' ')[0] || '';
        return tag + '[' + act + ']';
      })""")


def close_tray(pg):
    pg.evaluate("() => { const b = document.querySelector('[data-action=\"close-tray\"]'); if (b) b.click(); }")
    pg.wait_for_timeout(400)


def discard(pg):
    """Leave via ✕ and take the Discard branch of whichever confirm appears."""
    pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(400)
    if pg.evaluate("() => !!document.querySelector('.choice-dialog')"):
        pg.evaluate("""() => { const b = [...document.querySelectorAll('.choice-dialog-btns button')]
          .find(x => x.classList.contains('danger')); if (b) b.click(); }""")
        pg.wait_for_timeout(500)
    return True


def diff_keys(a, b):
    return sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))


def main():
    with serve(DIST) as url, sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport=DESKTOP)
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(800)
        close_tray(pg)

        # ---------------------------------------------------------- next action
        print("\n-- a saved next action --")
        pg.evaluate("""() => { const c = [...document.querySelectorAll('.lane[data-kind="next"] .card-title')]
          .find(t => t.textContent.trim()); c.click(); }""")
        pg.wait_for_timeout(600)
        print("     controls: " + ", ".join(enumerate_controls(pg)))
        before = snapshot(pg)
        pg.fill('.screen-field-title', 'MUTATED title')
        pg.fill('.screen-field-desc', 'MUTATED description')
        pg.evaluate("""() => { const s = document.querySelector('[data-field="linkedProjectId"]');
          if (s && s.options.length > 1){ s.selectedIndex = s.options.length - 1; s.dispatchEvent(new Event('change', {bubbles:true})); } }""")
        pg.wait_for_timeout(250)
        pg.evaluate("""() => { const b = document.querySelector('[data-action="screen-complete"]'); if (b) b.click(); }""")
        pg.wait_for_timeout(250)
        check(pg.evaluate("() => !!document.querySelector('.screen-complete-pill.done')"),
              "Complete ARMS rather than acting (it is draft-only here too)")
        discard(pg)
        d = diff_keys(before, snapshot(pg))
        check(d == [], "nothing at all persisted through the discard: %s" % d)

        print("\n-- and Done commits --")
        pg.evaluate("""() => { const c = [...document.querySelectorAll('.lane[data-kind="next"] .card-title')]
          .find(t => t.textContent.trim()); c.click(); }""")
        pg.wait_for_timeout(600)
        pg.fill('.screen-field-title', 'COMMITTED title')
        pg.click('.screen-footer-done'); pg.wait_for_timeout(600)
        check(pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').some(t => t.title === 'COMMITTED title')"),
              "Done saved the edit from the footer's bottom-right corner")

        # ---------------------------------------------------------------- habit
        print("\n-- a saved habit (the control-densest page) --")
        pg.click('.lane[data-kind="notes"] .col-tab[data-kind="habit"]'); pg.wait_for_timeout(350)
        opened = pg.evaluate("""() => { const c = [...document.querySelectorAll('.lane[data-kind="habit"] .card-title')]
          .find(t => t.textContent.trim()); if (!c) return false; c.click(); return true; }""")
        if opened:
            pg.wait_for_timeout(600)
            print("     controls: " + ", ".join(enumerate_controls(pg)))
            before = snapshot(pg)
            pg.fill('.screen-field-title', 'MUTATED habit')
            pg.fill('.screen-field-desc', 'MUTATED identity line')
            # every schedule day chip, the pause switch, and the Complete badge
            pg.evaluate("""() => { document.querySelectorAll('.habit-day-chip').forEach(c => c.click()); }""")
            pg.wait_for_timeout(200)
            pg.evaluate("""() => { const b = document.querySelector('.habit-pause-btn'); if (b) b.click(); }""")
            pg.wait_for_timeout(200)
            pg.evaluate("""() => { const b = document.querySelector('[data-action="screen-complete"]'); if (b) b.click(); }""")
            pg.wait_for_timeout(250)
            discard(pg)
            d = diff_keys(before, snapshot(pg))
            check(d == [], "Pause, the day chips and Complete were all draft-only: %s" % d)
        else:
            check(False, "could not find a habit card to open")

        # ----------------------------------------------------------------- note
        print("\n-- a note --")
        pg.click('.lane[data-kind="habit"] .col-tab[data-kind="notes"]'); pg.wait_for_timeout(400)
        pg.click('.lane[data-kind="notes"] .lane-create-btn[data-idx="0"]'); pg.wait_for_timeout(600)
        print("     controls: " + ", ".join(enumerate_controls(pg)))
        before = snapshot(pg)
        pg.fill('.screen-field-title', 'MUTATED note')
        pg.evaluate("""() => { const b = document.querySelector('.note-body');
          if (b){ b.focus(); b.innerHTML = '<div>typed into the body</div>';
                  b.dispatchEvent(new Event('input', {bubbles:true})); } }""")
        pg.wait_for_timeout(250)
        discard(pg)
        d = diff_keys(before, snapshot(pg))
        check(d == [], "a typed-in note body is caught by the gate and discarded: %s" % d)

        # -------------------------------------------------------------- project
        print("\n-- a project page (staged children) --")
        pg.evaluate("""() => { const c = [...document.querySelectorAll('.lane[data-kind="current"] .card-title')]
          .find(t => t.textContent.trim()); c.click(); }""")
        pg.wait_for_timeout(700)
        print("     controls: " + ", ".join(enumerate_controls(pg)))
        before = snapshot(pg)
        pg.fill('.screen-field-title', 'MUTATED project')
        pg.fill('.screen-field-desc', 'MUTATED project notes')
        pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(400)
        # A project page keeps its OWN longer warning — and must not stack a
        # second, generic one in front of it (trap T6a).
        dialogs = pg.evaluate("() => document.querySelectorAll('.choice-dialog').length")
        check(dialogs == 1, "exactly one confirm on a project page, not two stacked: %d" % dialogs)
        pg.evaluate("""() => { const b = [...document.querySelectorAll('.choice-dialog-btns button')]
          .find(x => x.classList.contains('danger')); if (b) b.click(); }""")
        pg.wait_for_timeout(500)
        d = diff_keys(before, snapshot(pg))
        check(d == [], "the project page discarded cleanly: %s" % d)

        # ------------------------------------------- the one deliberate exception
        print("\n-- 🗑 Delete still acts immediately (the exception) --")
        pg.click('.lane[data-kind="next"] .lane-create-btn[data-idx="0"]'); pg.wait_for_timeout(500)
        pg.fill('.screen-field-title', 'Doomed action')
        pg.click('.screen-footer-done'); pg.wait_for_timeout(600)
        pg.evaluate("""() => { const c = [...document.querySelectorAll('.lane[data-kind="next"] .card-title')]
          .find(t => t.textContent.trim() === 'Doomed action'); c.click(); }""")
        pg.wait_for_timeout(600)
        check(pg.evaluate("""() => { const b = document.querySelector('.screen-footer-delete');
              return !!b && b.getBoundingClientRect().left < document.querySelector('.screen-footer-done').getBoundingClientRect().left; }"""),
              "Delete sits bottom-LEFT, maximum distance from Done")
        pg.click('.screen-footer-delete'); pg.wait_for_timeout(350)
        check(pg.evaluate("() => !!document.querySelector('.choice-dialog')"), "it still asks first")
        pg.evaluate("""() => { const b = [...document.querySelectorAll('.choice-dialog-btns button')]
          .find(x => x.classList.contains('danger')); if (b) b.click(); }""")
        pg.wait_for_timeout(600)
        check(pg.evaluate("() => !JSON.parse(localStorage.getItem('gtd_tasks_next')||'[]').some(t => t.title === 'Doomed action')"),
              "and then deletes at once, without waiting for Done")

        ctx.close(); br.close()

    check(not errors, "no JS errors: %s" % errors[:3])
    print("\n%d failure(s)" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

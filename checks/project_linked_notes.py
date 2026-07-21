"""Linked notes on the project page, behind an Actions | Notes toggle.

User: "Call it a tab or call it a section. You should be able to toggle back and
forth between the linked actions/events and the note list. We don't need to show
the tags under the notes either, just the note titles from most recent to least
recent."

Until now the link ran ONE WAY: a note could point at a project and show a chip
for it, but the project page was built from linked actions and linked events and
never looked at notes.

⚠ The two things most likely to break here are not the list itself:
  · the chosen side must live on the SCREEN, not the draft — a view preference
    stored in the draft would make merely LOOKING at the notes count as an
    unsaved change and trip the ✕ warning
  · opening a note must PUSH the screen stack — openNoteScreen replaces
    state.screen outright, so without that the project's draft (staged children
    included) is silently thrown away
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


fails, notes_out = [], []
def check(cond, msg):
    (notes_out if cond else fails).append(("PASS " if cond else "FAIL ") + msg)


PROJECT = {"id": "zz-proj", "title": "ZZ build the shed", "notesClean": "",
           "linkedProjectId": None, "isGroup": False, "parent": None,
           "whenText": None, "deadline": None, "contextId": None}
# editedAt ascending, so "most recent first" is the REVERSE of this order
NOTES = [
    {"id": "n-old", "title": "ZZ oldest note", "body": "", "editedAt": 1000,
     "projectLinks": [{"id": "zz-proj", "name": "ZZ build the shed"}], "tagIds": ["t1"]},
    {"id": "n-mid", "title": "ZZ middle note", "body": "", "editedAt": 2000,
     "projectLinks": [{"id": "zz-proj", "name": "ZZ build the shed"}], "tagIds": []},
    {"id": "n-new", "title": "ZZ newest note", "body": "", "editedAt": 3000,
     "projectLinks": [{"id": "zz-proj", "name": "ZZ build the shed"}], "tagIds": ["t1", "t2"]},
    {"id": "n-other", "title": "ZZ unrelated note", "body": "", "editedAt": 4000,
     "projectLinks": [], "tagIds": []},
]

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1100)

    pg.evaluate("""([proj, ns]) => {
      const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
      localStorage.setItem('gtd_tasks_current',
        JSON.stringify(cur.filter(t => t.id !== proj.id).concat([proj])));
      localStorage.setItem('gtd_notes', JSON.stringify(ns));
    }""", [PROJECT, NOTES])
    pg.reload(); pg.wait_for_timeout(1100)

    def open_project():
        pg.evaluate("""() => {
          ['#tray-root', '#dialog-root', '#screen-root'].forEach(sel => {
            const el = document.querySelector(sel); if (el) el.innerHTML = '';
          });
          document.body.classList.remove('screen-open');
          window.scrollTo(0, 0);   // the tab bar collapses when scrolled
        }""")
        pg.wait_for_timeout(250)
        pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
        pg.locator('.card-title:has-text("ZZ build the shed")').first.click()
        pg.wait_for_timeout(600)

    open_project()

    # ---------- the toggle exists and starts on Actions ----------
    seg = pg.locator('[data-action="project-linked-tab"]')
    check(seg.count() == 2, f"the project page has a two-way switch ({seg.count()})")
    labels = [t.strip() for t in seg.all_inner_texts()]
    check(any("Actions" in l for l in labels) and any("Notes" in l for l in labels),
          f"labelled Actions and Notes ({labels})")
    active = pg.locator('[data-action="project-linked-tab"].active').first.inner_text()
    check("Actions" in active, f"it opens on Actions ({active})")
    check(any("3" in l for l in labels), f"the Notes side shows how many there are ({labels})")

    # ---------- switching shows the notes, newest first, titles only ----------
    pg.locator('[data-action="project-linked-tab"][data-tab="notes"]').first.click()
    pg.wait_for_timeout(400)
    rows = pg.evaluate("""() => [...document.querySelectorAll('[data-action="open-linked-note"]')]
        .map(e => e.textContent.trim())""")
    check(len(rows) == 3, f"only this project's notes are listed ({rows})")
    check(rows == ["ZZ newest note", "ZZ middle note", "ZZ oldest note"],
          f"most recently edited first ({rows})")
    check(not any("ZZ unrelated" in r for r in rows),
          f"a note linked to nothing is not listed ({rows})")

    # tags must NOT appear — the user asked for titles only
    panel_html = pg.evaluate("""() => {
      const el = document.querySelector('.linked-actions-list');
      return el ? el.innerHTML : '';
    }""")
    check("note-chip" not in panel_html and "tag" not in panel_html.lower(),
          "no tags or chips under the notes — titles only")

    # ---------- and back again ----------
    pg.locator('[data-action="project-linked-tab"][data-tab="actions"]').first.click()
    pg.wait_for_timeout(400)
    check(pg.locator('[data-action="open-linked-note"]').count() == 0,
          "switching back hides the notes again")

    # ---------- looking at the notes is NOT an edit ----------
    # If the chosen side were kept in the draft, merely toggling would count as
    # an unsaved change and ✕ would start warning about discarding work.
    pg.locator('[data-action="project-linked-tab"][data-tab="notes"]').first.click()
    pg.wait_for_timeout(300)
    pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(500)
    warned = pg.locator('.choice-dialog').count()
    check(warned == 0, f"leaving after only toggling does not warn about unsaved changes ({warned})")

    # ---------- opening a note returns to the project ----------
    open_project()
    pg.fill('[data-field="title"]', "ZZ build the shed EDITED")
    pg.locator('[data-action="project-linked-tab"][data-tab="notes"]').first.click()
    pg.wait_for_timeout(350)
    pg.locator('[data-action="open-linked-note"]').first.click()
    pg.wait_for_timeout(700)
    on_note = pg.evaluate("""() => {
      const el = document.querySelector('[data-field="noteTitle"]');
      return el ? el.value : null;
    }""")
    check(on_note == "ZZ newest note", f"tapping a note opens that note ({on_note})")

    # back out of the note — the project page must still be there, still edited
    pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(500)
    d = pg.locator('.choice-dialog button:has-text("Discard changes")')
    if d.count():
        d.first.click(); pg.wait_for_timeout(500)
    back_on = pg.evaluate("""() => {
      const el = document.querySelector('[data-field="title"], .screen-field-title');
      return el ? el.value : null;
    }""")
    check(back_on == "ZZ build the shed EDITED",
          f"and backing out returns to the project with its draft intact ({back_on})")

    # ---------- the add button, pre-linked ----------
    open_project()
    pg.locator('[data-action="project-linked-tab"][data-tab="notes"]').first.click()
    pg.wait_for_timeout(350)
    add = pg.locator('[data-action="new-linked-note"]')
    check(add.count() == 1, f"the Notes side offers a New note button ({add.count()})")
    add.first.click(); pg.wait_for_timeout(700)

    chips = pg.evaluate("""() => [...document.querySelectorAll('.note-chip, [data-action="note-unlink"]')]
        .map(e => e.textContent.trim())""")
    check(any("shed" in c.lower() for c in chips),
          f"the new note opens ALREADY linked to the project ({chips})")

    pg.fill('[data-field="noteTitle"]', "ZZ note made from the project")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(800)
    saved = pg.evaluate("""() => {
      const ns = JSON.parse(localStorage.getItem('gtd_notes') || '[]');
      const n = ns.find(x => x.title === 'ZZ note made from the project');
      return n ? (n.projectLinks || []).map(l => l.id) : null;
    }""")
    check(saved == ["zz-proj"], f"and saves with that link ({saved})")

    # it should now be at the TOP of the project's note list, being newest
    open_project()
    pg.locator('[data-action="project-linked-tab"][data-tab="notes"]').first.click()
    pg.wait_for_timeout(400)
    rows = pg.evaluate("""() => [...document.querySelectorAll('[data-action="open-linked-note"]')]
        .map(e => e.textContent.trim())""")
    check(rows and rows[0] == "ZZ note made from the project",
          f"and appears at the top of the list, being the newest ({rows})")

    # ---------- ⚑ on an UNSAVED project the note STAGES ----------
    # User ruling: notes get the same staging treatment as child actions. A note
    # made here exists only in the project's draft until that project saves —
    # so ✕ takes it with it, and it never leaves a note linked to a project that
    # never existed.
    def fresh_project():
        pg.evaluate("""() => {
          ['#tray-root', '#dialog-root', '#screen-root'].forEach(sel => {
            const el = document.querySelector(sel); if (el) el.innerHTML = '';
          });
          document.body.classList.remove('screen-open');
          window.scrollTo(0, 0);
        }""")
        pg.wait_for_timeout(250)
        pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(350)
        pg.click('[data-action="fab"]'); pg.wait_for_timeout(300)
        pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(500)

    def note_count():
        return pg.evaluate("() => JSON.parse(localStorage.getItem('gtd_notes') || '[]').length")

    before = note_count()
    fresh_project()
    pg.fill('[data-field="title"]', "ZZ unsaved project")
    pg.locator('[data-action="project-linked-tab"][data-tab="notes"]').first.click()
    pg.wait_for_timeout(350)
    check(pg.locator('[data-action="new-linked-note"]').count() == 1,
          "a brand-new project DOES offer the button now")
    pg.locator('[data-action="new-linked-note"]').first.click(); pg.wait_for_timeout(600)
    pg.fill('[data-field="noteTitle"]', "ZZ staged note")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(700)
    check(note_count() == before,
          f"saving it writes NOTHING yet ({note_count()} vs {before})")
    listed = pg.evaluate("() => document.body.innerText")
    check("ZZ staged note" in listed,
          "but it is listed on the project page so the add did not look like a no-op")
    check(pg.locator('.staged-note').count() == 1,
          "marked as provisional rather than looking like a saved note")

    # discarding the project must take the staged note with it
    pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(500)
    d = pg.locator('.choice-dialog button:has-text("Discard changes")')
    check(d.count() == 1, "and X warns, because a staged note IS unsaved work")
    if d.count():
        d.first.click(); pg.wait_for_timeout(600)
    check(note_count() == before,
          f"discarding the project takes the staged note with it ({note_count()})")

    # and saving the project writes it
    before = note_count()
    fresh_project()
    pg.fill('[data-field="title"]', "ZZ kept project")
    # ⚠ A NEW Current project must have at least one NEXT ACTION before it can
    # save (§4.3) — and a staged note deliberately does not satisfy that: a note
    # is not a next step. So stage an action too, or the save is blocked and the
    # note never lands. (An earlier draft of this check missed that and read as
    # a staging bug.)
    # ⚠ Via the + New action BUTTON: the quick-add rows this used to type into
    # were removed, so creation always goes through the drafting page now.
    pg.locator('[data-action="generate-action"][data-gen-kind="next"]').first.click()
    pg.wait_for_timeout(600)
    pg.fill('[data-field="title"]', "ZZ first step")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(700)
    pg.locator('[data-action="project-linked-tab"][data-tab="notes"]').first.click()
    pg.wait_for_timeout(350)
    pg.locator('[data-action="new-linked-note"]').first.click(); pg.wait_for_timeout(600)
    pg.fill('[data-field="noteTitle"]', "ZZ kept note")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(600)
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(900)   # save the project
    check(note_count() == before + 1, f"saving the project writes the note ({note_count()})")
    linked_to = pg.evaluate("""() => {
      const ns = JSON.parse(localStorage.getItem('gtd_notes') || '[]');
      const n = ns.find(x => x.title === 'ZZ kept note');
      const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
      const proj = cur.find(t => t.title === 'ZZ kept project');
      return n && proj ? (n.projectLinks || []).some(l => l.id === proj.id) : false;
    }""")
    check(linked_to, "and it is linked to the project that was just created")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes_out + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes_out), len(fails)))
sys.exit(1 if fails else 0)

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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from _pickers import enable_qa_scaffolding

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
# ⚠ Injected rather than relying on seedData()'s old "Learn woodworking" Someday
# sample — that generic filler was removed (starter kit is now just the seeded
# contexts/habits + the in-lane tutorial), so the Someday lane check below needs
# its own fixture the same way the Current-lane one above already gets injected.
FUTURE_PROJECT = {"id": "zz-future-proj", "title": "ZZ someday project", "notesClean": "",
                   "linkedProjectId": None, "isGroup": False, "parent": None}
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
    # ⚠ The 'dev scaffolding is kept out of the picker' assertion near the end
    # needs scaffolding to EXIST. It is off by default now, so without this the
    # check passes without testing anything.
    enable_qa_scaffolding(pg)

    pg.evaluate("""([proj, futureProj, ns]) => {
      const cur = JSON.parse(localStorage.getItem('gtd_tasks_current') || '[]');
      localStorage.setItem('gtd_tasks_current',
        JSON.stringify(cur.filter(t => t.id !== proj.id).concat([proj])));
      const fut = JSON.parse(localStorage.getItem('gtd_tasks_future') || '[]');
      localStorage.setItem('gtd_tasks_future',
        JSON.stringify(fut.filter(t => t.id !== futureProj.id).concat([futureProj])));
      localStorage.setItem('gtd_notes', JSON.stringify(ns));
    }""", [PROJECT, FUTURE_PROJECT, NOTES])
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

    # ---------- a SOMEDAY project gets linked notes too ----------
    # User: "I think it should be possible to link notes to the future projects
    # page. Future projects should also get their own section in the tags picker
    # on the notes page."
    #
    # ⚠ Notes ONLY, and no Actions/Notes toggle: §4.3 is explicit that a Future
    # project holds no linked actions and takes no deadlines, so an Actions side
    # would be a switch to a list that can never have anything in it.
    pg.evaluate("""() => {
      ['#tray-root', '#dialog-root', '#screen-root'].forEach(s => {
        const el = document.querySelector(s); if (el) el.innerHTML = '';
      });
      document.body.classList.remove('screen-open');
      window.scrollTo(0, 0);
    }""")
    pg.wait_for_timeout(250)
    pg.click('.tab[data-kind="future"]'); pg.wait_for_timeout(450)
    pg.locator('.card-title:has-text("ZZ someday project")').first.click(); pg.wait_for_timeout(600)
    labels = pg.evaluate("""() => [...document.querySelectorAll('.screen-hook-pick-label')]
      .map(e => e.textContent.trim())""")
    check("Linked notes" in labels, f"a Someday project page has a Linked notes section ({labels})")
    check(pg.locator('[data-action="new-linked-note"]').count() == 1,
          "with its own + New note")
    check(pg.locator('[data-action="project-linked-tab"]').count() == 0,
          "and NO Actions/Notes toggle — a Someday project holds no actions (4.3)")

    pg.locator('[data-action="new-linked-note"]').first.click(); pg.wait_for_timeout(650)
    chips = pg.evaluate("() => [...document.querySelectorAll('.note-chip')].map(e => e.textContent.trim())")
    check(any("ZZ someday project" in c for c in chips),
          f"the new note arrives pre-linked to it ({chips})")
    pg.fill('[data-field="noteTitle"]', "ZZ someday note")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(600)
    rows = pg.evaluate("""() => [...document.querySelectorAll('.linked-action-item')]
      .map(e => e.textContent.trim())""")
    check(any("ZZ someday note" in r for r in rows), f"and shows in its list ({rows})")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(700)
    saved = pg.evaluate("""() => { const n = JSON.parse(localStorage.getItem('gtd_notes') || '[]')
      .find(x => x.title === 'ZZ someday note');
      return n ? (n.projectLinks || []).map(l => l.name) : null; }""")
    check(saved and "ZZ someday project" in saved, f"and the link persists ({saved})")

    # ---------- the notes picker splits the two lanes ----------
    pg.click('.tab[data-kind="notes"]'); pg.wait_for_timeout(450)
    pg.locator('#fab-create').first.click(); pg.wait_for_timeout(300)
    pg.locator('[data-action="new-primary"]').first.click(); pg.wait_for_timeout(600)
    pg.locator('[data-action="note-add-link"]').first.click(); pg.wait_for_timeout(450)
    labels = pg.evaluate("""() => [...document.querySelectorAll('.screen-hook-pick-label')]
      .map(e => e.textContent.trim())""")
    check("Link a current project" in labels and "Link a Someday project" in labels,
          f"the picker has a section per lane, not one flat list ({labels})")
    sections = pg.evaluate("""() => [...document.querySelectorAll('.screen-hook-pick-list')]
      .map(l => [...l.querySelectorAll('.screen-hook-pick-item')].map(i => i.textContent.trim()))""")
    cur_sec = sections[1] if len(sections) > 1 else []
    fut_sec = sections[2] if len(sections) > 2 else []
    check(any("ZZ someday project" in t for t in fut_sec),
          f"Someday projects are in the Someday section ({fut_sec})")
    check(not any("ZZ someday project" in t for t in cur_sec),
          f"and not in the current one ({cur_sec[:4]})")
    # ⚠ The chunk map injects ~26 rows into Current Projects. They are dev
    # scaffolding (devContext), and they were burying the real projects here.
    check(not any(t.startswith("✓") or "—" in t for t in cur_sec),
          f"dev scaffolding rows are kept out of the picker ({cur_sec[:6]})")

    # ---------- converting Current → Someday KEEPS the linked notes ----------
    # User: "make sure that converting a current project to a future project
    # doesn't remove the notes. The dialogue should reflect this if it doesn't
    # already." It never did remove them — demoteProjectToFuture only touches
    # linked actions and events — but the dialog listed only what gets unlinked or
    # deleted, so a reader had no reason to believe the notes were safe.
    #
    # ⚠ Why this matters beyond wording: the user's stated purpose for notes on
    # Someday projects is planning and sketching ideas out. That is exactly the
    # material nobody writes if they think a conversion eats it.
    pg.evaluate("""() => {
      ['#tray-root', '#dialog-root', '#screen-root'].forEach(s => {
        const el = document.querySelector(s); if (el) el.innerHTML = '';
      });
      document.body.classList.remove('screen-open');
      window.scrollTo(0, 0);
      localStorage.setItem('gtd_tasks_current', JSON.stringify([
        {id:'zz-conv', title:'ZZ convert me', notesClean:'', linkedProjectId:null,
         isGroup:false, parent:null}]));
      localStorage.setItem('gtd_tasks_next', JSON.stringify([
        {id:'zz-act', title:'ZZ a step', notesClean:'', linkedProjectId:'zz-conv',
         isGroup:false, parent:null, contextId:null}]));
      localStorage.setItem('gtd_notes', JSON.stringify([
        {id:'zz-n1', title:'ZZ plan sketch', body:'', projectLinks:[{id:'zz-conv',name:'ZZ convert me'}],
         tagIds:[], editedAt: Date.now()}]));
      localStorage.setItem('gtd_events', '[]');
      localStorage.setItem('gtd_tray', '[]');
    }""")
    pg.reload(); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const r = document.querySelector('#tray-root'); if (r) r.innerHTML = ''; }")
    pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(400)
    pg.locator('.card-title:has-text("ZZ convert me")').first.click(); pg.wait_for_timeout(600)
    # ⚑ UPDATED (author's ruling, 2026-08-01): the warning fires when Make
    # Future is TAPPED, not at Save, and its answer is staged until Save. The
    # dialog's WORDING -- what this group is actually about -- is unchanged.
    pg.locator('[data-action="make-kind"][data-dest="future"]').first.click(); pg.wait_for_timeout(400)
    dlg = pg.evaluate("""() => { const d = document.querySelector('.choice-dialog-backdrop');
      return d ? d.textContent : null; }""")
    check(dlg is not None, "converting a project with links asks first")
    check(dlg and "notes are kept" in dlg.lower().replace("linked notes are kept", "notes are kept"),
          f"and the dialog SAYS the notes are kept ({(dlg or '')[:150]})")
    pg.evaluate("""() => { const d = document.querySelector('.choice-dialog-backdrop');
      const b = [...d.querySelectorAll('button')].find(x => /unlink/i.test(x.textContent));
      if (b) b.click(); }""")
    pg.wait_for_timeout(500)
    pg.locator('[data-action="screen-save"]').first.click(); pg.wait_for_timeout(900)
    after = pg.evaluate("""() => {
      const n = JSON.parse(localStorage.getItem('gtd_notes') || '[]').find(x => x.id === 'zz-n1');
      const fut = JSON.parse(localStorage.getItem('gtd_tasks_future') || '[]')
        .some(t => t.id === 'zz-conv');
      return { noteAlive: !!n, stillLinked: n ? (n.projectLinks||[]).some(l => l.id === 'zz-conv') : false,
               nowFuture: fut }; }""")
    check(after["nowFuture"], f"the project really did convert ({after})")
    check(after["noteAlive"], f"and the note survived ({after})")
    check(after["stillLinked"], f"and is still linked to it ({after})")

    pg.click('.tab[data-kind="future"]'); pg.wait_for_timeout(450)
    pg.locator('.card-title:has-text("ZZ convert me")').first.click(); pg.wait_for_timeout(600)
    rows = pg.evaluate("""() => [...document.querySelectorAll('.linked-action-item')]
      .map(e => e.textContent.trim())""")
    check(any("ZZ plan sketch" in r for r in rows),
          f"and the converted Someday page still lists it ({rows})")
    check(pg.locator('[data-action="new-linked-note"]').count() == 1,
          "with the + New note button still there")

    # ---------- Someday projects have NO deadline field ----------
    # User: "Future projects don't have deadlines by definition." The field is gone
    # from the Someday creation AND drafting pages; a Current project keeps it.
    def has_deadline_field():
        return pg.evaluate("""() => !!document.querySelector(
          '[data-field="deadline-date"], .screen-date[data-field^="deadline"]')""")
    pg.evaluate("""() => { ['#tray-root','#dialog-root','#screen-root'].forEach(s => {
      const el = document.querySelector(s); if (el) el.innerHTML = ''; });
      document.body.classList.remove('screen-open'); window.scrollTo(0,0); }""")
    pg.wait_for_timeout(200)
    pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(300)
    pg.locator('#fab-create').click(); pg.wait_for_timeout(200)
    pg.locator('[data-action="new-primary"]').click(); pg.wait_for_timeout(400)
    check(has_deadline_field(), "a Current project's creation page KEEPS the deadline field")
    pg.locator('[data-action="screen-cancel"]').click(); pg.wait_for_timeout(300)
    pg.click('.tab[data-kind="future"]'); pg.wait_for_timeout(300)
    pg.locator('#fab-create').click(); pg.wait_for_timeout(200)
    pg.locator('[data-action="new-primary"]').click(); pg.wait_for_timeout(400)
    check(not has_deadline_field(), "but a Someday creation page has NO deadline field")
    pg.locator('[data-action="screen-cancel"]').click(); pg.wait_for_timeout(300)

    # ---------- Current → Someday drops a deadline SILENTLY ----------
    # User: "we don't need to warn anyone that they're getting stripped away."
    pg.evaluate("""() => {
      localStorage.setItem('gtd_tasks_current', JSON.stringify([
        {id:'zz-dated', title:'ZZ dated proj', notesClean:'', linkedProjectId:null,
         isGroup:false, parent:null,
         deadline:{date:'2026-08-01', time:null, setAt:Date.now(), pushCount:0}}]));
      localStorage.setItem('gtd_tasks_next','[]'); localStorage.setItem('gtd_events','[]');
      localStorage.setItem('gtd_tray','[]'); }""")
    pg.reload(); pg.wait_for_timeout(900)
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    pg.click('.tab[data-kind="current"]'); pg.wait_for_timeout(300)
    pg.locator('.card-title:has-text("ZZ dated proj")').click(); pg.wait_for_timeout(500)
    pg.locator('[data-action="make-kind"][data-dest="future"]').click(); pg.wait_for_timeout(300)
    pg.locator('[data-action="screen-save"]').click(); pg.wait_for_timeout(600)
    # no linked actions/events, so no dialog at all — the convert just happens
    check(pg.locator('.choice-dialog-backdrop').count() == 0,
          "a dateless-but-deadlined project converts with NO warning dialog")
    conv = pg.evaluate("""() => { const f=JSON.parse(localStorage.getItem('gtd_tasks_future')||'[]')
      .find(t => t.id === 'zz-dated'); return f ? {inFuture:true, deadline:f.deadline} : {inFuture:false}; }""")
    check(conv.get("inFuture"), f"it landed in Someday ({conv})")
    check(conv.get("deadline") is None, f"and its deadline was dropped ({conv})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes_out + fails:
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes_out), len(fails)))
sys.exit(1 if fails else 0)

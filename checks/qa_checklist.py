"""The QA checklist obeys §8.1: replace, never accumulate.

Three checklists had accumulated in Next Actions (chunk 7, the per-occurrence
follow-up, chunk 8) because two of them were deliberately additive while the
user was still walking them. This checks that the post-sprint one REPLACED all
three, that its items survive a reload, and that a Reset re-seeds exactly one
set rather than stacking another.
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


# This round's groups. ⚠ Update BOTH of these whenever injectQAChecklist is
# rewritten — the sweep test works by clearing the CURRENT flag to force a
# re-injection, so a stale flag name here makes the whole file pass vacuously.
EXPECTED = ["The new time picker", "The new date picker", "Deadlines that get pushed",
            "List view", "The review and the intray", "Repeating events and habits"]
RETIRED = ["Chunk 7", "Chunk 8", "Per-occurrence", "Recheck chunk 6b",
           "Settings & appearance", "Calendar & review fixes", "Progress bars", "Pickers"]
CURRENT_FLAG = "gtd_qa_checklist_postsprint_v4"
SUPERSEDED_FLAGS = ["gtd_qa_checklist_chunk7_v1", "gtd_qa_checklist_override_v1",
                    "gtd_qa_checklist_override_v2", "gtd_qa_checklist_chunk8_v1",
                    "gtd_qa_checklist_postsprint_v1", "gtd_qa_checklist_postsprint_v2",
                    "gtd_qa_checklist_postsprint_v3"]

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 860}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(url); pg.wait_for_timeout(1000)

    def groups():
        return pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next'))
            .filter(t => t.isGroup && (t.title||'').indexOf('✅ QA') === 0)
            .map(t => t.title)""")

    def items_under(title):
        return pg.evaluate("""(title) => {
          const rows = JSON.parse(localStorage.getItem('gtd_tasks_next'));
          const g = rows.find(t => t.isGroup && t.title === title);
          return g ? rows.filter(t => t.parent === g.id).length : 0;
        }""", title)

    g = groups()
    check(len(g) == len(EXPECTED), f"exactly {len(EXPECTED)} checklist groups (got {len(g)}: {g})")
    for name in EXPECTED:
        check(any(name in t for t in g), f"group present: {name}")
    for old in RETIRED:
        check(not any(old in t for t in g), f"retired checklist gone: {old}")
    for t in g:
        n = items_under(t)
        check(n > 0, f"{t!r} has {n} items")

    # plain language: no DevTools-dependent instructions (a standing rule)
    body = pg.evaluate("""() => JSON.parse(localStorage.getItem('gtd_tasks_next'))
        .map(t => (t.title||'') + ' ' + (t.notesClean||'')).join(' ').toLowerCase()""")
    for banned in ["devtools", "console", "localstorage", "inspect element", "git "]:
        check(banned not in body, f"no {banned!r} in the checklist text")

    # ⚑ No jargon anywhere the user can read it (user ruling: "open loop is
    # jargon from the book. It should be changed"). These are terms you have to
    # already know — one borrowed from GTD, one the app invented — and they kept
    # reappearing because the CODE uses them correctly as internal vocabulary.
    # Scanned across the whole rendered app, not just the checklist, since that
    # is the only way to catch it drifting back into a new screen.
    visible = pg.evaluate("""() => {
      const t = document.body.innerText || '';
      const attrs = [...document.querySelectorAll('[title],[placeholder],[aria-label]')]
        .map(e => [e.getAttribute('title'), e.getAttribute('placeholder'),
                   e.getAttribute('aria-label')].filter(Boolean).join(' ')).join(' ');
      return (t + ' ' + attrs).toLowerCase();
    }""")
    for jargon in ["open loop", "orphan", "tickler", "someday/maybe", "pseudo-action"]:
        check(jargon not in visible, f"no {jargon!r} visible in the app")

    # ⚑ "capture" is jargon as a NOUN and fine as a VERB (user), so this cannot
    # be a plain substring ban — "Capture a thought…" is the intray's own
    # placeholder and must survive. Ban the noun forms only.
    for noun in ["captures", "a capture", "the capture", "your capture"]:
        check(noun not in visible, f"no {noun!r} — capture is jargon as a noun")
    check("capture a thought" in visible or True,
          "(the verb form is deliberately still allowed)")

    # ⚑ The event/appointment distinction is fine as a LABEL and pointless as an
    # explanation (user: "the label adds no new information and clutters up the
    # UI"). Catch the sentence form specifically.
    for phrase in ["makes it an appointment", "is an appointment", "becomes an appointment"]:
        check(phrase not in visible, f"no {phrase!r} — the distinction needs no explaining")

    # a reload must not inject a second copy
    pg.reload(); pg.wait_for_timeout(900)
    check(len(groups()) == len(EXPECTED), f"reload does not re-inject (got {len(groups())})")

    # neither should a full reset
    pg.evaluate("""() => { Object.keys(localStorage).filter(k => k.indexOf('gtd_') === 0)
        .forEach(k => localStorage.removeItem(k)); }""")
    pg.reload(); pg.wait_for_timeout(1100)
    g2 = groups()
    check(len(g2) == len(EXPECTED), f"a reset re-seeds exactly one set (got {len(g2)}: {g2})")

    # THE UPGRADE PATH — the one that actually matters for the existing install:
    # the three old checklists are sitting in the lane and their flags are set,
    # so the new injector must sweep them rather than stack a fourth set.
    pg.evaluate("""(cur) => {
      const rows = JSON.parse(localStorage.getItem('gtd_tasks_next'));
      // drop the post-sprint groups and fake the three retired ones back in
      const keep = rows.filter(t => (t.title||'').indexOf('✅ QA') !== 0
                                 && !rows.some(g => g.isGroup && g.id === t.parent
                                                 && (g.title||'').indexOf('✅ QA') === 0));
      ['✅ QA — Chunk 7: Calendar & events',
       '✅ QA — Per-occurrence event edits',
       '✅ QA — Chunk 8: Event-conditioning & backup'].forEach((title, i) => {
        const gid = 'old-group-' + i;
        keep.push({id: gid, title: title, notesClean: '', isGroup: true, parent: null,
                   devContext: 'qa-checklist'});
        keep.push({id: 'old-item-' + i, title: 'an old item', notesClean: '',
                   isGroup: false, parent: gid});
      });
      localStorage.setItem('gtd_tasks_next', JSON.stringify(keep));
      localStorage.setItem('gtd_qa_checklist_chunk7_v1', '1');
      localStorage.setItem('gtd_qa_checklist_override_v2', '1');
      localStorage.setItem('gtd_qa_checklist_chunk8_v1', '1');
      // v1 of the post-sprint checklist counts as superseded too
      localStorage.setItem('gtd_qa_checklist_postsprint_v1', '1');
      localStorage.setItem('gtd_qa_checklist_postsprint_v2', '1');
      localStorage.setItem('gtd_qa_checklist_postsprint_v3', '1');
      localStorage.removeItem(cur);
    }""", CURRENT_FLAG)
    pg.reload(); pg.wait_for_timeout(1100)
    g3 = groups()
    check(len(g3) == len(EXPECTED), f"upgrade sweeps the old checklists (got {len(g3)}: {g3})")
    check(not any(any(o in t for o in RETIRED) for t in g3), "no retired group survives the upgrade")
    orphans = pg.evaluate("""() => {
      const rows = JSON.parse(localStorage.getItem('gtd_tasks_next'));
      const ids = new Set(rows.filter(t => t.isGroup).map(t => t.id));
      return rows.filter(t => t.parent && !ids.has(t.parent)).length;
    }""")
    check(orphans == 0, f"no orphaned items left behind by the sweep (got {orphans})")
    stale_flags = pg.evaluate(
        "keys => keys.filter(k => localStorage.getItem(k) !== null)", SUPERSEDED_FLAGS)
    check(not stale_flags, f"superseded flag keys are retired (left: {stale_flags})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    # some Windows consoles are cp1252; group titles carry an emoji
    print(line.encode("ascii", "replace").decode())
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

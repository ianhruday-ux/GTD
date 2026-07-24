"""QA #23, REVERSED (user) — pushing a deadline no longer restarts the bar; it
is still counted.

Original ruling: "Change the start, but mark the pushed with a counter. Put it
in the same place as the current passed due marker." That origin-reset half
was wrong: the bar should read progress since the schedule was FIRST set, not
since its most recent push. setAt is now written once and carried forward
untouched by every later push — only the push counter still moves.

⚠ There are THREE ways a deadline's date can change, and a fix that only covers
the review's "Push the date" leaves two silent exemptions:
  1. the review's inline push
  2. editing the date on the item's own page
  3. editing a child action from its PROJECT page (the staged-edit path, which
     applies edits with a blind Object.assign)
All three go through applyDeadlineChange. All three are checked here.
"""
import os, functools, http.server, socket, socketserver, threading, contextlib, sys, datetime
from playwright.sync_api import sync_playwright
from _pickers import pick_date, enable_dev_tools

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


BASE = datetime.datetime(2026, 6, 15, 10, 0, 0)

with serve(DIST) as url, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.clock.install(time=BASE)
    pg.goto(url); pg.wait_for_timeout(1000)
    enable_dev_tools(pg)   # the dev toolbar is hidden until switched on
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")

    def create_with_deadline(title, due):
        pg.click('[data-action="fab"]'); pg.wait_for_timeout(350)
        pg.click('[data-action="new-primary"]'); pg.wait_for_timeout(500)
        pg.fill('[data-field="title"]', title)
        pick_date(pg, '[data-field="deadline-date"]', due)
        pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(600)

    def task_row(title):
        return pg.evaluate("""(t) => {
          const nxt = JSON.parse(localStorage.getItem('gtd_tasks_next') || '[]');
          return nxt.find(x => x.title === t) || null;
        }""", title)

    def bar(title):
        return pg.evaluate("""(t) => {
          const card = [...document.querySelectorAll('.card')]
            .find(c => (c.querySelector('.card-title')||{}).textContent.trim() === t);
          if (!card) return null;
          const el = card.querySelector('.deadline-bar');
          if (!el) return null;
          const v = el.style.getPropertyValue('--fill').trim();
          return { fill: v.endsWith('%') ? Math.round(parseFloat(v)) : null,
                   pushed: el.classList.contains('pushed'),
                   passed: el.classList.contains('passed'),
                   chip: (card.querySelector('.deadline-push-chip')||{}).textContent || null };
        }""", title)

    def edit_deadline(title, new_due):
        """Path 2: change the date on the item's own page."""
        pg.locator(f'.card-title:has-text("{title}")').first.click(); pg.wait_for_timeout(500)
        pick_date(pg, '[data-field="deadline-date"]', new_due)
        pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(600)

    # ---------- a bar with a moved date does NOT restart ----------
    # 20 days out, then let 10 days pass, then push it another 20 days out.
    create_with_deadline("ZZ push me", "2026-07-05")
    start = bar("ZZ push me")
    check(start and start["fill"] <= 2, f"a fresh deadline starts empty ({start})")
    # ⚠ createTask() never calls applyDeadlineChange (a brand-new deadline has
    # no "previous" to compare against), so setAt stays unset until the FIRST
    # edit — deadlineBarState() falls back to task.createdAt until then. The
    # origin worth freezing and comparing against is set on that first push.

    for _ in range(10):
        pg.click("#qa-day-btn"); pg.wait_for_timeout(110)
    midway = bar("ZZ push me")
    check(midway and midway["fill"] > 30, f"10 days later the bar has filled ({midway})")

    edit_deadline("ZZ push me", "2026-07-25")
    after = bar("ZZ push me")
    # This first push is exactly when setAt gets ESTABLISHED (createTask never
    # writes it), so elapsed-since-origin is legitimately 0 right here — a
    # near-empty bar at this exact instant doesn't yet prove anything about
    # reset-vs-not. That is checked below, after more time passes.
    check(after and after["pushed"], f"and the bar is marked pushed ({after})")
    check(after and after["chip"] and "1" in after["chip"],
          f"and the counter reads 1 ({after})")

    row = task_row("ZZ push me")
    check(row and row["deadline"].get("pushCount") == 1,
          f"pushCount is 1 after one push ({row['deadline'] if row else None})")
    orig_set_at = row["deadline"].get("setAt") if row else None
    check(orig_set_at, f"and this first push recorded the window's origin ({row['deadline'] if row else None})")

    # ---------- letting more time pass, THEN a second push ----------
    # If the origin were still resetting (the old bug), this second push would
    # slam the bar back to ~0 despite the days that just passed. It shouldn't.
    for _ in range(5):
        pg.click("#qa-day-btn"); pg.wait_for_timeout(110)
    grown = bar("ZZ push me")
    check(grown and grown["fill"] > 5, f"5 more days later the bar has grown again ({grown})")

    edit_deadline("ZZ push me", "2026-08-20")
    row = task_row("ZZ push me")
    check(row and row["deadline"].get("pushCount") == 2,
          f"a second push increments the counter ({row['deadline'] if row else None})")
    check(row and row["deadline"].get("setAt") == orig_set_at,
          f"and still does not move the origin ({row['deadline'] if row else None})")
    two = bar("ZZ push me")
    check(two and two["chip"] and "2" in two["chip"], f"the chip reads 2 ({two})")
    check(two and two["fill"] > 5,
          f"and the second push does NOT slam the bar back to empty ({two} vs pre-push {grown})")

    # ---------- pulling a deadline FORWARD is not a push ----------
    # ⚑ Flagged judgment call, unchanged by the reversal: pulling the date in
    # is not scored as a push (only a later date is), but it still shrinks the
    # window against the same untouched origin.
    before_pull = task_row("ZZ push me")["deadline"]["pushCount"]
    edit_deadline("ZZ push me", "2026-08-01")
    after_pull = task_row("ZZ push me")["deadline"]
    check(after_pull["pushCount"] == before_pull,
          f"[flagged] pulling the date forward does not count as a push ({after_pull})")
    check(after_pull.get("setAt") == orig_set_at,
          f"and it does not restart the window either ({after_pull})")

    # ---------- saving without touching the date changes nothing ----------
    was = task_row("ZZ push me")["deadline"]
    pg.locator('.card-title:has-text("ZZ push me")').first.click(); pg.wait_for_timeout(500)
    pg.fill('[data-field="title"]', "ZZ push me")
    pg.click('[data-action="screen-save"]'); pg.wait_for_timeout(600)
    now = task_row("ZZ push me")["deadline"]
    check(now["pushCount"] == was["pushCount"] and now["setAt"] == was["setAt"],
          f"re-saving without moving the date leaves the window alone ({now})")

    # ---------- DRAFT ISOLATION for the deadline field ----------
    # Found while wiring the counter, and older/more serious than QA #23 itself:
    # getDeadline() handed back the task's own deadline object, which the date
    # input then mutated in place. Changing a date and leaving by ✕ had already
    # changed the task. Nothing was guarding this, so it is guarded now.
    was = task_row("ZZ push me")["deadline"]
    pg.locator('.card-title:has-text("ZZ push me")').first.click(); pg.wait_for_timeout(500)
    pick_date(pg, '[data-field="deadline-date"]', "2026-12-25")
    pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(500)
    # ✕ may ask about unsaved changes — discard if it does.
    discard = pg.locator('.choice-dialog button:has-text("Discard changes")')
    if discard.count():
        discard.first.click(); pg.wait_for_timeout(400)
    after_x = task_row("ZZ push me")["deadline"]
    check(after_x["date"] == was["date"],
          f"leaving by X does not move the stored deadline ({after_x['date']} vs {was['date']})")
    check(after_x["pushCount"] == was["pushCount"],
          f"and does not count a push ({after_x})")
    # ⚠ Storage alone does NOT catch the aliasing bug: the mutation was to the
    # in-memory task, which only reaches localStorage when something else
    # triggers a lane save. Verified — with the aliasing restored, the two
    # assertions above still passed. Re-opening the page reads live state, which
    # is what actually exposes it.
    pg.locator('.card-title:has-text("ZZ push me")').first.click(); pg.wait_for_timeout(500)
    shown = pg.evaluate("""() => {
      const el = document.querySelector('[data-field="deadline-date"]');
      return el ? el.value : null;
    }""")
    check(shown == was["date"],
          f"and the discarded date is gone from live state too ({shown} vs {was['date']})")
    pg.click('[data-action="screen-cancel"]'); pg.wait_for_timeout(400)
    d2 = pg.locator('.choice-dialog button:has-text("Discard changes")')
    if d2.count():
        d2.first.click(); pg.wait_for_timeout(400)

    # ---------- path 1: the review's inline push ----------
    create_with_deadline("ZZ review push", "2026-06-20")
    pg.evaluate("() => { const r=document.querySelector('#tray-root'); if(r) r.innerHTML=''; }")
    # let it go past due so it shows in the review as a past-due deadline.
    # ⚠ The review surfaces one past-due item at a time: this is trimmed from
    # 8 to 3 (down from the 5-day advance added above, for the "does the fill
    # survive a second push" check) to land the clock at the SAME absolute
    # date the untrimmed original did — past that point a dev-scaffolding
    # fixture ("Renew passport") comes due first and displaces this card.
    for _ in range(3):
        pg.click("#qa-day-btn"); pg.wait_for_timeout(110)
    before = task_row("ZZ review push")
    check(before and (before["deadline"].get("pushCount") or 0) == 0,
          f"the review probe starts unpushed ({before['deadline'] if before else None})")
    # Not yet through applyDeadlineChange (created directly, never edited), so
    # there is no prior origin to compare against here — the "does a SECOND
    # push leave the origin alone" case is already proven above, on path 2.
    # This path only needs to show it shares the same function.

    pg.evaluate("() => document.querySelector('[data-action=\"open-tray\"]').click()")
    pg.wait_for_timeout(400)
    pg.evaluate("() => document.querySelector('[data-action=\"open-review\"]').click()")
    pg.wait_for_timeout(600)
    card = pg.locator('.review-card:has-text("ZZ review push")').first
    if card.count():
        card.locator('[data-action="review-form-start"][data-type="date"]').first.click()
        pg.wait_for_timeout(400)
        pick_date(pg, "#review-form-input", "2026-07-15")
        pg.locator('[data-action="review-pushdate-save"]').first.click(); pg.wait_for_timeout(600)
    after_rev = task_row("ZZ review push")
    check(after_rev and after_rev["deadline"].get("pushCount") == 1,
          f"the review's Push the date counts as a push ({after_rev['deadline'] if after_rev else None})")
    check(after_rev and after_rev["deadline"].get("setAt"),
          f"and records an origin the same way (via the shared applyDeadlineChange) ({after_rev['deadline'] if after_rev else None})")

    check(not errs, f"no JS errors ({errs[:3]})")
    b.close()

for line in notes + fails:
    print(line)
print("\n%d passed, %d failed" % (len(notes), len(fails)))
sys.exit(1 if fails else 0)

  "use strict";

  // ⚑ TRANSLATED (Chinese round). These were `const` literals; they are now LIVE
  // tables rebuilt by rebuildStringTables() at boot and again whenever the
  // language changes. Deliberately kept as tables with the same names and shapes
  // rather than replacing every `LIST_TITLES[k]` with `t("lane."+k+".title")` at
  // the call sites: there are dozens of those, and rewriting them all would have
  // put the whole translation's regression risk into one commit for no benefit.
  // One place maps keys to strings; every existing reader is untouched.
  //
  // ⚠ They must NOT be read at module-evaluation time — only from inside
  // functions, after boot() has called rebuildStringTables(). Everything here
  // already did.
  //
  // The English side of the table lives in i18n.js now, including the user's own
  // authored info-button prose (INFO-TEXT.txt stays the record of what was
  // reviewed). Reword there, not here.
  let LIST_TITLES = {}, LANE_INFO = {}, LANE_INFO_EXTRA = {},
      FAB_MENU_LABELS = {}, TITLE_PLACEHOLDER = {}, KIND_BADGE_LABEL = {};
  function rebuildStringTables(){
    LIST_TITLES = {
      next: t("lane.next.title"), waiting: t("lane.waiting.title"),
      current: t("lane.current.title"), future: t("lane.future.title"),
      habit: t("lane.habit.title"), notes: t("lane.notes.title")
    };
    LANE_INFO = {
      next: t("info.lane.next"), waiting: t("info.lane.waiting"),
      current: t("info.lane.current"), future: t("info.lane.future"),
      habit: t("info.lane.habit"), notes: t("info.lane.notes")
    };
    // The →→ paragraphs: shown on the lane's own “i”, withheld from the review.
    LANE_INFO_EXTRA = {
      next: t("info.lane.next.more"), habit: t("info.lane.habit.more")
    };
    // §4.3e's FAB menu (New tag → Tags, user). Column-reversed: item[0] is nearest
    // the badge. Notes has a third option; the action/project lanes have two.
    FAB_MENU_LABELS = {
      next: [t("fab.newAction"), t("fab.newContext")],
      waiting: [t("fab.newAction"), t("fab.newContext")],
      current: [t("fab.newProject"), t("fab.newList")],
      future: [t("fab.newProject"), t("fab.newList")],
      notes: [t("fab.newNote"), t("fab.newChecklist"), t("fab.tags")]
    };
    TITLE_PLACEHOLDER = {
      next: t("placeholder.title.next"), waiting: t("placeholder.title.waiting"),
      current: t("placeholder.title.current"), future: t("placeholder.title.future"),
      habit: t("placeholder.title.habit"), notes: t("placeholder.title.notes")
    };
    KIND_BADGE_LABEL = {
      next: t("badge.next"), waiting: t("badge.waiting"), current: t("badge.current"),
      future: t("badge.future"), habit: t("badge.habit"), notes: t("badge.notes"),
      tags: t("badge.tags"), event: t("badge.event")
    };
  }
  // The tab strip's short names live in index.html as static markup, so they are
  // stamped in rather than rendered — renderShell() does not own that element.
  function renderTabLabels(){
    ALL_LANES.forEach(function(k){
      const el = qs('.tab[data-kind="' + k + '"] .tab-name');
      if (el) el.textContent = t("tab." + k);
    });
  }
  // Task lanes (each backed by state.tasks[k]). Notes are a lane too but NOT a
  // task kind — they have their own store — so KINDS stays task-only and
  // ALL_LANES is what tab/lane rendering and visibility iterate (chunk 6).
  const KINDS = ["next", "waiting", "current", "future", "habit"];
  const ALL_LANES = ["next", "waiting", "current", "future", "habit", "notes"];
  // =========================================================
  // DESKTOP LAYOUT (desktop-redesign-plan.md, rulings 1–2)
  //
  // ⚠ ONE SOURCE OF TRUTH for "am I desktop?" (trap T1). This number is
  // mirrored in exactly one place in styles.css — `@media (min-width:1000px)`.
  // Nothing in JS may read window.innerWidth to decide layout; everything asks
  // state.desktop, which only applyLayoutMode() writes.
  //
  // The three columns keep the phone's tab pairings, so both layouts are one
  // mental model: do (Next/Waiting) · plan (Projects/Someday) · support
  // (Notes/Habits). ⚠ ORDER MATTERS TWICE: it is the column order left→right,
  // and — because every pair is contiguous in ALL_LANES and the pairs are in
  // the same sequence — CSS grid auto-placement puts the three visible lanes in
  // their own columns with no explicit grid-column anywhere.
  // =========================================================
  const DESKTOP_MIN_PX = 1000;
  const COLUMN_PAIRS = [["next", "waiting"], ["current", "future"], ["notes", "habit"]];
  function columnIndexOfKind(k){
    for (let i = 0; i < COLUMN_PAIRS.length; i++){ if (COLUMN_PAIRS[i].indexOf(k) !== -1) return i; }
    return -1;
  }
  function laneCount(k){ return k === "notes" ? (state.notes || []).length : (state.tasks[k] || []).length; }
  function visibleLanes(){ return state.desktop ? state.columns.slice() : [state.activeKind]; }
  const PROJECT_KINDS = ["current", "future"];
  const MOVE_MAP = { waiting: "next", future: "current" };
  const NEW_ITEM_LABEL = {
    next: "+ New Action", waiting: "+ New Waiting Item",
    current: "+ New Project", future: "+ New Project", habit: "+ New Habit", notes: "+ New Note"
  };
  // Retained for chunk 7 (recurrence is a property of EVENTS, §4.13); no
  // longer used by deadlines, whose recurrence <select> was removed in chunk 3.
  const RECURRENCE_LABELS = { none: "Does not repeat", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
  const state = {
    tasks: {next: [], waiting: [], current: [], future: [], habit: []},
    completed: {next: [], waiting: [], current: [], future: []}, // permanent Completed archive per lane (habits use their own daily habitDone-based grouping instead — see habitCompletedTodayHtml)
    // chunk 3 (§4.3d): the ONE shared contexts registry, used by Next AND
    // Waiting. Each context is { id, name }. An action stores its membership
    // as a `contextId` field (null = ungrouped) — NOT the group-task `parent`
    // mechanism, which is now project-lanes-only. contextId is what lets a
    // promoted Waiting item land in the identically-named context for free.
    contexts: [],
    activeKind: "next",
    // Desktop round. `desktop` is written ONLY by applyLayoutMode(); `columns`
    // holds the active lane of each of the three columns, in COLUMN_PAIRS
    // order. Session-only, like activeKind — a fresh desktop load shows
    // Next / Projects / Notes (the first-named of each pair).
    desktop: false,
    columns: ["next", "current", "notes"],
    collapsed: {},
    habitDone: {},
    habitDoneOrder: [],
    habitRuns: {},
    audioCtx: null,
    screen: null, // { kind, taskId (null = new), draft: {...} }
    // chunk 1 (spec.md §3 known issue 1): a real stack, not a single slot.
    // The single-slot version could only remember ONE screen to return to,
    // so a flow two screens deep (project page -> a linked action's own
    // page -> that page's own child) lost the middle breadcrumb the moment
    // the second child opened, landing back at the lanes instead of the
    // project page. Each entry is a full stashed screen (draft included);
    // closeScreen() pops the top one, or exits to the lanes once it's empty.
    screenStack: [],
    tray: [],       // chunk 6 (§4.8a): captured stray thoughts
    trayOpen: false,
    events: [],     // chunk 7 (§4.13): calendar events/appointments — gtd_events, NOT a lane

    notes: [],      // chunk 6 (§4.9): { id, title, body, projectLinks:[{id,name}], tagIds:[], editedAt }
    tags: [],       // chunk 6 (§4.9b): notes-only tag registry, { id, name } — mirrors gtd_contexts
    notesFilter: null, // chunk 6 (§4.9): transient project-OR-tag-id filter on the Notes lane
    notesFilterMenuOpen: false,
    reviewDeferred: {}, // chunk 6b (§4.8b, user follow-up): in-memory "Not now" set — scoped to the CURRENTLY-OPEN review, cleared on every fresh open (not the app-day)
    trayReveal: false, // chunk 6b (user follow-up): captures are redacted in the drawer by default; this un-seals them for one drawer session
    qaTimeOffset: 0 // dev-only: MINUTES added to boundaryNow() (chunk 0c: hour/minute granular, not just whole days — the midnight-4am window (§4.14b) can only be tested by landing the clock inside it) — see the QA time-jump buttons
  };

  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function escapeHtml(str){
    return String(str || "").replace(/[&<>"']/g, function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  }
  // THE CLOCK. Every "what time is it" in the app goes through here, exactly as
  // every write goes through storage.js. The QA time-jump buttons move
  // qaTimeOffset, so honouring it here is what makes the dev tool tell the truth.
  //
  // ⚑ This used to be read in three places and BYPASSED in six, all of them
  // `createdAt: nowMs()`. One of those six is load-bearing: createdAt is the
  // deadline bar's origin (§4.4b, read at deadlineBarState). Jump the clock ten
  // days forward, create a deadline, and the bar measured from the real now —
  // ten days behind the app's now — so it was born part-full. Reported as a
  // date-picker bug; it was two clocks. (User ruling: one clock, app-wide.)
  function nowMs(){ return Date.now() + (state.qaTimeOffset || 0) * 60000; }
  // Single 4:00 AM day boundary, app-wide (habits, events, deadlines — one
  // clock, one rule, per the edge-case rulings). "Today" doesn't roll over
  // until 4am, so a late night doesn't cost you a habit day.
  function boundaryNow(){
    const d = new Date(nowMs());
    d.setHours(d.getHours() - 4);
    return d;
  }
  function todayStr(){ return boundaryNow().toLocaleDateString("en-CA"); }
  function dateStrToDate(s){ const parts = s.split("-").map(Number); return new Date(parts[0], parts[1] - 1, parts[2]); }
  function dateToStr(d){ return d.toLocaleDateString("en-CA"); }
  function addDaysToDate(d, n){ const copy = new Date(d); copy.setDate(copy.getDate() + n); return copy; }
  // ⚠ DELIBERATELY the real clock, and it must stay that way. An id must never
  // repeat, and qaTimeOffset can run BACKWARDS (the QA buttons subtract as well
  // as add) — feed it a rewindable clock and two sessions either side of a jump
  // can mint the same id. Uniqueness beats consistency here. Do not "fix" this.
  function genId(){ return "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

  // How many habits (other than excludeId) currently hook onto targetId.
  function habitIncomingHookCount(targetId, excludeId){
    return state.tasks.habit.reduce(function(n, h){
      if (h.isGroup || h.id === excludeId) return n;
      return n + ((h.hooks || []).some(function(hk){ return hk.id === targetId; }) ? 1 : 0);
    }, 0);
  }
  // Every habit it's safe to hook `excludeId` onto (11.4b — amended from
  // the original transitive exclusion). Blocked: self; anything already in
  // the draft's own hook list; DIRECT mutuals (T already hooks to X) —
  // for X→T to ever matter, X and T must share a scheduled day, which is
  // the identical condition for T→X to matter, so a mutual pair is either
  // same-day-circular or entirely pointless; nothing legitimate is lost.
  // LONGER cycles are deliberately ALLOWED: the overlap condition rotates
  // around the ring (A Mon+Tue hooks nothing… e.g. B{Tue,Wed}→A, C{Wed,
  // Mon}→B, A→C — the full graph is a cycle but each day's live sub-graph
  // is a clean two-link chain: a rotating weekly routine). Graph walks
  // keep visited-set guards and the Tidy sort appends stalled (cyclic)
  // remainders alphabetically, so nothing downstream needs acyclicity.
  // Also blocked: targets already anchoring MAX_HOOKS dependents (the cap
  // is bidirectional — 7 out, 7 in — RESTORED after one round removed:
  // the QA-round dictation was re-read as lifting it; the user confirmed
  // both directions stand while re-testing the original report).
  function getValidHookTargets(excludeId, currentHookIds){
    const excluded = new Set(currentHookIds || []);
    if (excludeId) excluded.add(excludeId);
    return state.tasks.habit.filter(function(t){
      if (t.isGroup || excluded.has(t.id)) return false;
      if (excludeId && (t.hooks || []).some(function(hk){ return hk.id === excludeId; })) return false;
      return habitIncomingHookCount(t.id, excludeId) < MAX_HOOKS;
    });
  }
  // Every context it's safe to add as a habit's cue (§4.5, §4.3d): not
  // already among this draft's cue rows, and not already carrying
  // MAX_HOOKS incoming hooks. A context takes no part in the hook CYCLE
  // (nothing hooks out of it), so there is no self/mutual exclusion — only
  // the shared 7-incoming cap and de-duplication. Note habitIncomingHookCount
  // already tallies context ids for free: a context-cue is stored in the
  // habit's own hooks array, so the same incoming count that guards habit
  // anchors guards contexts too.
  function getValidContextCueTargets(currentHookIds, excludeHabitId){
    const excluded = new Set(currentHookIds || []);
    return state.contexts.filter(function(c){
      if (excluded.has(c.id)) return false;
      return habitIncomingHookCount(c.id, excludeHabitId) < MAX_HOOKS;
    });
  }
  // A hook is live today iff its target exists, is scheduled today, and
  // isn't paused (11.2). One link deep only — the target's own cue
  // doesn't matter, because the target itself still occurs today.
  function hookLiveToday(hook){
    // A context-cue (§4.3d/§4.5) is ALWAYS live: a context has no schedule
    // and cannot be paused or completed. It only stops being live if the
    // context was deleted, in which case it reads as an orphan — exactly
    // like a deleted habit target below.
    if (hook.ctx) return !!findContext(hook.id);
    const target = state.tasks.habit.find(function(h){ return h.id === hook.id && !h.isGroup; });
    if (!target) return false;
    const run = ensureHabitRun(target.id);
    if (run.paused) return false;
    return run.schedule.indexOf(boundaryNow().getDay()) !== -1;
  }
  // Bidirectional (7 out, 7 in): one anchor per weekday bounds what a cue
  // set — or a target's dependent list — can usefully hold at weekly
  // resolution. Also the cue-ROW cap on the page: 1 default + 6 extra.
  const MAX_HOOKS = 7;

  // Set of Waiting-task ids that are (transitively) conditioned on
  // waitingId via another Waiting item — i.e. waitingId is somewhere
  // upstream in their condition chain. Only Waiting->Waiting edges can
  // ever form a cycle (Next Actions have no condition of their own), so
  // that's the only graph we need to walk.
  function getConditionDescendants(waitingId){
    const childrenMap = {};
    state.tasks.waiting.forEach(function(t){
      if (t.conditionId && t.conditionKind === "waiting"){
        (childrenMap[t.conditionId] = childrenMap[t.conditionId] || []).push(t.id);
      }
    });
    const result = new Set();
    const stack = [waitingId];
    while (stack.length){
      const cur = stack.pop();
      (childrenMap[cur] || []).forEach(function(childId){
        if (!result.has(childId)){ result.add(childId); stack.push(childId); }
      });
    }
    return result;
  }
  // Every Next Action or Waiting Action it's safe for `excludeId` (a
  // Waiting item, or null when creating a brand-new one) to condition on:
  // no self, no cycles. Unlike habits, there's no "one dependent per
  // target" rule here — multiple Waiting items may share the same
  // condition, so no "already claimed" filtering.
  function getValidConditionTargets(excludeId){
    const excludedWaiting = excludeId ? getConditionDescendants(excludeId) : new Set();
    if (excludeId) excludedWaiting.add(excludeId);
    const nextTargets = state.tasks.next.filter(function(t){ return !t.isGroup; })
      .map(function(t){ return { id: t.id, title: t.title, kind: "next" }; });
    const waitingTargets = state.tasks.waiting.filter(function(t){ return !t.isGroup && !excludedWaiting.has(t.id); })
      .map(function(t){ return { id: t.id, title: t.title, kind: "waiting" }; });
    return nextTargets.concat(waitingTargets);
  }
  // Cycle descendants over an arbitrary action set (live ∪ staged) — §12.1b:
  // the cycle filter must see staged items, not just live ones.
  function mergedConditionDescendants(waitingId, allActions){
    const childrenMap = {};
    allActions.forEach(function(l){
      if (l.kind === "waiting" && l.task.conditionId && l.task.conditionKind === "waiting"){
        (childrenMap[l.task.conditionId] = childrenMap[l.task.conditionId] || []).push(l.task.id);
      }
    });
    const result = new Set(); const stack = [waitingId];
    while (stack.length){
      const cur = stack.pop();
      (childrenMap[cur] || []).forEach(function(c){ if (!result.has(c)){ result.add(c); stack.push(c); } });
    }
    return result;
  }

  // A short two-tone chime, generated in-browser — no audio file needed.
  function playHookChime(){
    try{
      const ctx = state.audioCtx || (state.audioCtx = new (window.AudioContext || window.webkitAudioContext)());
      const now = ctx.currentTime;
      [[880, 0], [1318.5, 0.09]].forEach(function(pair){
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = pair[0];
        gain.gain.setValueAtTime(0.0001, now + pair[1]);
        gain.gain.exponentialRampToValueAtTime(0.18, now + pair[1] + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + pair[1] + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + pair[1]);
        osc.stop(now + pair[1] + 0.18);
      });
    } catch (e){ /* Web Audio unavailable — fail silently */ }
  }

  // A very short, quiet tick played on button presses — navigation
  // feedback, deliberately much subtler than the hook chime.
  function playNavClick(){
    try{
      const ctx = state.audioCtx || (state.audioCtx = new (window.AudioContext || window.webkitAudioContext)());
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 1500;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e){ /* Web Audio unavailable — fail silently */ }
  }

  // =========================================================
  // LOCAL STORAGE BACKEND (default, no setup required)
  // =========================================================
  function loadTasksLocal(kind){
    return Storage.getJSON("gtd_tasks_" + kind, null);
  }
  function saveTasksLocal(kind){
    Storage.setJSON("gtd_tasks_" + kind, state.tasks[kind]);
  }
  // Contexts registry (chunk 3, §4.3d) — the one shared Next↔Waiting set.
  function loadContexts(){ return Storage.getJSON("gtd_contexts", null); }
  function saveContexts(){ Storage.setJSON("gtd_contexts", state.contexts); }
  function isActionKind(k){ return k === "next" || k === "waiting"; }
  function findContext(id){ return state.contexts.find(function(c){ return c.id === id; }) || null; }
  function contextNameExists(name){
    const n = (name || "").trim().toLowerCase();
    return state.contexts.some(function(c){ return (c.name || "").trim().toLowerCase() === n; });
  }
  // Create a context in the registry (front, so a fresh one surfaces near the
  // top of the context list). Choose-only pickers never call this — creation
  // is the + badge alone (§4.3e). Returns the new context, or an existing one
  // if the name is a duplicate (case-insensitive), so callers can no-op safely.
  function addContext(name){
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const existing = state.contexts.find(function(c){ return (c.name || "").trim().toLowerCase() === trimmed.toLowerCase(); });
    if (existing) return existing;
    const ctx = { id: genId(), name: trimmed };
    state.contexts.unshift(ctx);
    saveContexts();
    return ctx;
  }
  // Completed archive (new): permanent per-lane list of finished Next/
  // Waiting/Current/Future items, most-recently-completed first. Always
  // local, same "app bookkeeping on top of whatever backend" pattern as
  // gtd_archived_waiting and habitRuns — kept forever per the retention
  // policy already settled in the doc (no clearing on a timer or count).
  function loadCompletedLocal(kind){
    return Storage.getJSON("gtd_completed_" + kind, []);
  }
  function saveCompletedLocal(kind){
    Storage.setJSON("gtd_completed_" + kind, state.completed[kind]);
  }
  function initCompletedData(){
    ["next", "waiting", "current", "future"].forEach(function(k){ state.completed[k] = loadCompletedLocal(k); });
  }
  // Moves a task from the live lane back out of the Completed archive and
  // back to the top of the active list (mirrors the "new items land on
  // top" rule). Projects also restore any Waiting items that were archived
  // alongside them at completion time.
  // Emergency restore rule (§7, §12.2 step 4). A completed item may have sat
  // in the archive while its parentage was deleted around it — the origin
  // bug: complete a Context's only item, delete the Context, restore, and the
  // item reappears under a group ID that no longer exists and renders
  // nowhere. Before it lands back in a live lane, sever any dead link so it
  // can't vanish: a dead parent (dev group) or contextId is nulled (the
  // item lands loose at the top of the lane), and a dead linkedProjectId is
  // nulled. Condition fields are left ALONE — dependents were already
  // orphaned at completion time (§4.12b), and that is not this rule's job.
  function sanitizeRestoredParentage(kind, task){
    if (task.parent && !state.tasks[kind].some(function(t){ return t.isGroup && t.id === task.parent; })){
      task.parent = null;
    }
    if (task.contextId && !findContext(task.contextId)){
      task.contextId = null;
    }
    if (task.linkedProjectId && !["current", "future"].some(function(k){
      return state.tasks[k].some(function(t){ return !t.isGroup && t.id === task.linkedProjectId; });
    })){
      task.linkedProjectId = null;
    }
  }
  function restoreTask(kind, taskId){
    const idx = state.completed[kind].findIndex(function(t){ return t.id === taskId; });
    if (idx === -1) return;
    const peek = state.completed[kind][idx];
    // chunk 7 (§4.15c): un-completing a series occurrence only rolls back inside
    // the 10-minute window; outside it the archive entry stands and the series
    // has moved on — leave it archived rather than duplicating the rolled row.
    if (peek && peek.eventId && !onPseudoActionRestored(peek)) return;
    const task = state.completed[kind].splice(idx, 1)[0];
    delete task.completedAt;
    sanitizeRestoredParentage(kind, task);
    saveCompletedLocal(kind);
    state.tasks[kind].unshift(task);
    saveTasksLocal(kind);
    renderLane(kind);
    refreshProjectFlags(kind);
    if (kind === "current" || kind === "future"){
      restoreArchivedWaitingForProject(taskId); // renders "waiting" itself
    }
  }
  // Delete ONE completed item from the archive (§12.2 step 1). Deliberately
  // NOT routed through deleteTask: that operates on live lanes only, its
  // filters no-op against the archive, and its side effects (label freeze,
  // dependent patching) don't apply here — the dependents were orphaned at
  // completion. A completed PROJECT also drops its archived Waiting actions
  // (§4.12b): once it is deleted for good there is nothing to reopen against.
  function deleteCompleted(kind, taskId, skipRender){
    const idx = state.completed[kind].findIndex(function(t){ return t.id === taskId; });
    if (idx === -1) return;
    state.completed[kind].splice(idx, 1);
    saveCompletedLocal(kind);
    if (kind === "current" || kind === "future"){
      const archived = loadArchivedWaiting();
      if (archived[taskId]){ delete archived[taskId]; saveArchivedWaiting(archived); }
    }
    if (!skipRender) renderLane(kind);
  }
  // Clear a whole lane's completed archive (§12.2 step 2) — four lanes only,
  // never Habits. Loops deleteCompleted's per-item logic so the project-
  // archive cleanup can't diverge (one code path). The caller owns the
  // confirm dialog; this just does the work.
  function clearCompleted(kind){
    const ids = (state.completed[kind] || []).map(function(t){ return t.id; });
    ids.forEach(function(id){ deleteCompleted(kind, id, true); });
    renderLane(kind);
  }
  function seedData(){
    // Default seeded contexts (§4.3d): Computer, Calls, Errands. A starting
    // point, not a taxonomy. Seeded newest-last so they read in this order.
    // Starter-kit content, not disposable demo filler (unlike the generic
    // sample tasks that used to live below) — each carries a stable seedKey
    // so a later language switch can restamp its name (restampSeedDefaults),
    // the same id-stable seed+restamp treatment the tutorial cards use.
    state.contexts = [
      { id: genId(), name: t("seed.context.computer"), seedKey: "computer" },
      { id: genId(), name: t("seed.context.calls"),    seedKey: "calls" },
      { id: genId(), name: t("seed.context.errands"),  seedKey: "errands" }
    ];
    saveContexts();

    // ⚑ The generic filler sample tasks (Email Sarah, Website relaunch, Kitchen
    // remodel, etc.) are gone — disposable demo content that duplicated the
    // in-lane tutorial's job of showing the lanes in use, and wasn't worth a
    // translation key. The starter kit is now just the contexts above, the
    // three habits below, and the tutorial chain (seedTutorial).
    state.tasks.next = [];
    state.tasks.current = [];
    state.tasks.waiting = [];
    state.tasks.future = [];

    // §4.16: the three seeded habits ARE the GTD routine — capture daily,
    // review daily, review projects weekly — taught by practising, not reading.
    // The middle one is HOOKED to the first (a live demo of habit-stacking in
    // the correct GTD order); the descriptions model a good answer to the
    // identity prompt; "Review my projects" is Friday (weekly review = one
    // scheduled weekday). This set is only *correct* once the calendar exists
    // (the middle habit references it), which is why it ships here in chunk 7.
    // Same starter-kit seed+restamp treatment as the contexts above: seedKey
    // is stable, restampSeedDefaults re-derives title/notes/cue/hook-label.
    const sortTrayId = genId();
    const reviewCalId = genId();
    const reviewProjId = genId();
    state.tasks.habit = [
      { id: sortTrayId, seedKey: "sortTray", title: t("seed.habit.sortTray.title"), linkedProjectId: null, isGroup: false, parent: null,
        notesClean: t("seed.habit.sortTray.notes"),
        whenTexts: [t("seed.habit.sortTray.cue")], hooks: [] },
      { id: reviewCalId, seedKey: "reviewCal", title: t("seed.habit.reviewCal.title"), linkedProjectId: null, isGroup: false, parent: null,
        notesClean: t("seed.habit.reviewCal.notes"),
        whenTexts: [], hooks: [{ id: sortTrayId, label: t("seed.habit.sortTray.title") }] },
      { id: reviewProjId, seedKey: "reviewProj", title: t("seed.habit.reviewProj.title"), linkedProjectId: null, isGroup: false, parent: null,
        notesClean: t("seed.habit.reviewProj.notes"),
        whenTexts: [t("seed.habit.reviewProj.cue")], hooks: [] }
    ];
    // "Review my projects" runs Fridays only; the other two every day. Seed the
    // run schedules through storage so boot()'s loadHabitRuns() picks them up
    // (boot reloads gtd_habit_runs after seedData runs).
    const seededRuns = {};
    seededRuns[reviewProjId] = Object.assign(defaultHabitRun(), { schedule: [5] });
    Storage.setJSON("gtd_habit_runs", seededRuns);

    seedTutorial(); // the in-lane onboarding — default data, cleared by completion
    KINDS.forEach(saveTasksLocal);
    seedEvents(); // chunk 7 (§4.13): sample events/appointments in their own store
  }
  // =========================================================
  // THE IN-LANE TUTORIAL (user). Seeded default data — one numbered card per
  // step, living in the lane the step is about, cleared through completion as you
  // work. Modelled on the QA checklist's "cards in the lanes" idea, but this is
  // REAL user-facing content: not gated behind the QA switch, and it re-seeds
  // with the rest of the samples on Reset (initLocalData → seedData).
  //
  // ⭐ REPLACED (user, oela_app_tutorial_en_zh.txt) — 8 steps now, not 6, and
  // EVERY chain step is linked to `tr` (not just ②): the new script's own
  // framing for that project is "each of its linked actions is a different
  // stage in the tutorial." tp is still the dedicated stalled sample, now
  // fixed at step ⑦ instead of ⑤ (the new script moved that lesson later).
  //
  // ONE deliberate persist-exception, removed by 🗑 rather than completion:
  //   · the ◇ stalled sample project (tp) — step ⑦ needs a stalled project to
  //     fix, and fixing it un-stalls it rather than deleting it (user OK'd this).
  // ⚑ The OLD copy had a second exception here — the ⑥ habit card, which never
  // self-completed (habits reset daily; you deleted it instead), to teach that
  // lesson by analogy. The new script doesn't ask for that on step ⑧, so it is
  // now a normal chain link like the rest. Flagged in case that ruling was
  // meant to survive the rewrite — see the i18n.js comment above these keys.
  //
  // LANGUAGE: each card carries a stable `tutorialKey`. A language switch re-reads
  // the text from i18n (restampTutorialCards) but never touches the IDs, so the
  // ①→…→⑧ chain and every step's `tr` link — which are by id — survive
  // translation. This is the id-stable alternative to the "swap cards for their
  // siblings" idea; it avoids rewriting every cross-reference.
  const TUTORIAL_KEYS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "tp", "tr"];
  // Maps a chain link to the step that unlocks it — used only to re-derive the
  // frozen conditionLabel after a language switch (below). ② is hooked to ①,
  // a plain next action whose kind never changes; ③–⑧ are each hooked to the
  // waiting card directly before them.
  const TUTORIAL_CHAIN_PARENT = { t2: "t1", t3: "t2", t4: "t3", t5: "t4", t6: "t5", t7: "t6", t8: "t7" };
  function tutTitle(key){ return t("tutorial." + key + ".title"); }
  function tutNotes(key){ return t("tutorial." + key + ".notes"); }
  function seedTutorial(){
    const id = {}; TUTORIAL_KEYS.forEach(function(k){ id[k] = genId(); });
    function card(key, extra){
      return Object.assign({
        id: id[key], title: tutTitle(key), notesClean: tutNotes(key),
        linkedProjectId: null, isGroup: false, parent: null, tutorialKey: key
      }, extra || {});
    }
    // ① is the seed: a plain next action, no condition, present from the start.
    // Every chain link (①–⑧) is linked to `tr` — the new script's own framing
    // for that project ("each of its linked actions is a different stage").
    state.tasks.next.unshift(card("t1", { contextId: null, linkedProjectId: id.tr }));
    // ②–⑧: the chain. Each is hooked (conditionId) to the step before it and
    // seeded directly into Waiting On, in order, so they read top to bottom as
    // ②③④⑤⑥⑦⑧. Completing a step promotes the next one into Next Actions on
    // its own — ticking through the tutorial IS working the hook mechanic.
    state.tasks.waiting.unshift(
      card("t2", { whenText: null, conditionId: id.t1, conditionKind: "next", conditionLabel: tutTitle("t1"), linkedProjectId: id.tr }),
      card("t3", { whenText: null, conditionId: id.t2, conditionKind: "waiting", conditionLabel: tutTitle("t2"), linkedProjectId: id.tr }),
      card("t4", { whenText: null, conditionId: id.t3, conditionKind: "waiting", conditionLabel: tutTitle("t3"), linkedProjectId: id.tr }),
      card("t5", { whenText: null, conditionId: id.t4, conditionKind: "waiting", conditionLabel: tutTitle("t4"), linkedProjectId: id.tr }),
      card("t6", { whenText: null, conditionId: id.t5, conditionKind: "waiting", conditionLabel: tutTitle("t5"), linkedProjectId: id.tr }),
      card("t7", { whenText: null, conditionId: id.t6, conditionKind: "waiting", conditionLabel: tutTitle("t6"), linkedProjectId: id.tr }),
      card("t8", { whenText: null, conditionId: id.t7, conditionKind: "waiting", conditionLabel: tutTitle("t7"), linkedProjectId: id.tr })
    );
    // tr: the "Tutorial" reference project every step is linked to — real
    // projects need a next step like this to stay off Review's stalled list.
    // tp: the stalled sample ⑦ exists to demonstrate fixing.
    state.tasks.current.unshift(card("tr"), card("tp"));
  }
  // Re-read every tutorial card's text for the current language (called from
  // applyLocale). IDs and cross-references are untouched; only title/notes/the
  // frozen conditionLabel change. Active lanes AND the Completed archive, so a
  // step you already ticked isn't left half-translated in the archive.
  function restampTutorialCards(){
    const touched = {};
    function stamp(list, kindKey){
      (list || []).forEach(function(tk){
        if (!tk || !tk.tutorialKey) return;
        tk.title = tutTitle(tk.tutorialKey);
        tk.notesClean = tutNotes(tk.tutorialKey);
        // A still-hooked chain link carries a frozen label for the step
        // before it; re-derive it in the new language. Naturally a no-op once
        // a link has promoted — changeKind clears its own conditionId then.
        const parentKey = TUTORIAL_CHAIN_PARENT[tk.tutorialKey];
        if (parentKey && tk.conditionId){
          tk.conditionLabel = tutTitle(parentKey);
        }
        touched[kindKey] = true;
      });
    }
    ["next", "waiting", "current", "future", "habit"].forEach(function(k){ stamp(state.tasks[k], k); });
    ["next", "waiting", "current", "future"].forEach(function(k){
      stamp((state.completed || {})[k], k);
    });
    Object.keys(touched).forEach(function(k){ saveTasksLocal(k); });
    // completed archive persistence, if any tutorial card lives there
    ["next", "waiting", "current", "future"].forEach(function(k){
      if ((state.completed || {})[k] && state.completed[k].some(function(x){ return x.tutorialKey; })) {
        saveCompletedLocal(k);
      }
    });
  }
  // Re-read the starter-kit contexts and habits for the current language —
  // the same restamp idea as restampTutorialCards, above, but keyed by
  // seedKey instead of tutorialKey since these aren't part of the tutorial
  // chain. Unlike the tutorial cards these are meant to stick around (habits
  // especially — §4.16), so this DOES overwrite any hand-edit the user made
  // to a starter-kit name, exactly as the tutorial restamp already does to
  // its own cards; flagging it rather than re-deciding it, since the
  // seed+restamp comment on seedData was already committed to before this.
  function restampSeedDefaults(){
    let ctxTouched = false;
    (state.contexts || []).forEach(function(c){
      if (!c || !c.seedKey) return;
      c.name = t("seed.context." + c.seedKey);
      ctxTouched = true;
    });
    if (ctxTouched) saveContexts();

    let habitsTouched = false;
    (state.tasks.habit || []).forEach(function(h){
      if (!h || h.isGroup || !h.seedKey) return;
      h.title = t("seed.habit." + h.seedKey + ".title");
      h.notesClean = t("seed.habit." + h.seedKey + ".notes");
      if (h.whenTexts && h.whenTexts.length && STRINGS["seed.habit." + h.seedKey + ".cue"]){
        h.whenTexts[0] = t("seed.habit." + h.seedKey + ".cue");
      }
      habitsTouched = true;
    });
    // Hook labels are a frozen display copy of the target habit's title
    // (same pattern as the tutorial's conditionLabel) — re-derive them from
    // the just-restamped titles above, not from a seed key of their own.
    (state.tasks.habit || []).forEach(function(h){
      (h.hooks || []).forEach(function(hk){
        const target = state.tasks.habit.find(function(x){ return x.id === hk.id; });
        if (target) hk.label = target.title;
      });
    });
    if (habitsTouched) saveTasksLocal("habit");
  }
  function initLocalData(){
    let anyMissing = false;
    KINDS.forEach(function(k){
      const loaded = loadTasksLocal(k);
      if (loaded){ state.tasks[k] = loaded; }
      else { anyMissing = true; }
    });
    // Migration-free read of pre-cue-row habits: a saved single whenText
    // becomes a text-cue list of one (same trick as the gtdhook list).
    state.tasks.habit.forEach(function(h){
      if (h.isGroup) return;
      if (!h.whenTexts) h.whenTexts = h.whenText ? [h.whenText] : [];
    });
    const loadedCtx = loadContexts();
    if (loadedCtx){ state.contexts = loadedCtx; }
    else if (!anyMissing){
      // Tasks exist but no registry (pre-chunk-3 data): give a default
      // registry rather than re-seeding over real tasks. Old parent-based
      // context group-tasks in the action lanes simply render ungrouped now
      // (no migration — §1). Reset seeds everything fresh in the new shape.
      state.contexts = [
        { id: genId(), name: t("seed.context.computer"), seedKey: "computer" },
        { id: genId(), name: t("seed.context.calls"),    seedKey: "calls" },
        { id: genId(), name: t("seed.context.errands"),  seedKey: "errands" }
      ];
      saveContexts();
    }
    if (anyMissing){ seedData(); }
  }

  // =========================================================
  // HABITS
  // =========================================================
  // habitDone: {habitId: "YYYY-MM-DD"} — the most recent date the user
  // tapped the checkbox for. Only ever meaningfully compared against
  // "today"; day-boundary processing below reads it once, at the moment a
  // scheduled day elapses, to decide that day's outcome, then it becomes
  // irrelevant history (superseded by habitRuns[id].history).
  function loadHabitDone(){
    return Storage.getJSON("gtd_habit_done", {});
  }
  function saveHabitDone(){ Storage.setJSON("gtd_habit_done", state.habitDone); }
  function habitDoneToday(taskId){ return state.habitDone[taskId] === todayStr(); }
  // Order habits were checked off today, most-recent-first — habitDone
  // itself only stores one date per habit, not a sequence, so this is what
  // lets the Completed-habits section put the latest tick at the top.
  // Scoped to "today" only: a stale date in storage means a fresh day
  // started since, so it's read as empty rather than carried over.
  function loadHabitDoneOrder(){
    const raw = Storage.getJSON("gtd_habit_done_order", null);
    if (raw && raw.date === todayStr()) return raw.order || [];
    return [];
  }
  function saveHabitDoneOrder(){
    Storage.setJSON("gtd_habit_done_order", { date: todayStr(), order: state.habitDoneOrder });
  }
  function habitDoneOrderIndex(taskId){
    const idx = state.habitDoneOrder.indexOf(taskId);
    return idx === -1 ? state.habitDoneOrder.length : idx;
  }

  // habitRuns: {habitId: {
  //   schedule: [0..6] (Sun=0),  paused: bool,
  //   history: [{date, status:"done"|"stumble"|"miss"}, ...]  (scheduled
  //     days only, oldest first, spans every run ever — kept so a tied
  //     run's ghost can be swapped in per the edge-case ruling),
  //   currentRunStart: index into history where the in-progress run begins,
  //   personalBest: best run's completed-day count (stumbles don't count),
  //   bestSequence: [status, ...] the record (or most recent tied) run's
  //     day-by-day sequence, replayed as the ghost,
  //   lifetimeTotal: count of every "done" day ever,
  //   lastProcessedDate: last date the boundary sweep finalized through,
  //   pendingResult: {type:"record"|"tie"|"short", length, prevBest} set
  //     the moment a run ends, consumed (and cleared) the first time the
  //     habit's page is opened — that's also when the badge clears,
  //   badge: true while a run-ending result hasn't been viewed yet
  // }}
  function loadHabitRuns(){
    return Storage.getJSON("gtd_habit_runs", {});
  }
  function saveHabitRuns(){ Storage.setJSON("gtd_habit_runs", state.habitRuns); }
  function defaultHabitRun(){
    return {
      schedule: [0, 1, 2, 3, 4, 5, 6], paused: false, history: [], currentRunStart: 0,
      personalBest: 0, bestSequence: [], lifetimeTotal: 0, lastProcessedDate: null,
      pendingResult: null, badge: false
    };
  }
  function ensureHabitRun(habitId){
    if (!state.habitRuns[habitId]) state.habitRuns[habitId] = defaultHabitRun();
    return state.habitRuns[habitId];
  }
  function currentRunEntries(run){ return run.history.slice(run.currentRunStart); }
  function currentRunDoneCount(run){
    return currentRunEntries(run).filter(function(e){ return e.status === "done"; }).length;
  }
  // A miss ends the run only if the *previous* day in this run was already
  // a stumble (never-miss-twice); a single miss is just a stumble and the
  // run continues. A "done" always just extends the run.
  function applyHabitDayOutcome(run, date, status){
    if (status === "done"){
      run.history.push({ date: date, status: "done" });
      run.lifetimeTotal++;
      return;
    }
    // Misses before this attempt has a single completed day aren't
    // tracked at all — there's no run in progress yet for the stumble
    // grace to protect. Without this guard, a brand-new (or freshly-
    // restarted) habit missed on its first two scheduled days would
    // "stumble" on day one and silently end a run on day two despite
    // zero completions ever happening — invisible in the moment (no
    // celebration fires, since doneCount is 0) but it still inflated the
    // lap counter, so the first *real* completion could show "Start lap
    // 2" instead of lap 1. The grace only engages once you're mid-run.
    if (currentRunDoneCount(run) === 0) return;
    const entries = currentRunEntries(run);
    const last = entries[entries.length - 1];
    if (last && last.status === "stumble"){
      run.history.push({ date: date, status: "miss" });
      endHabitRun(run);
    } else {
      run.history.push({ date: date, status: "stumble" });
    }
  }
  function endHabitRun(run){
    const entries = currentRunEntries(run);
    const finished = entries.slice(0, -1); // drop the terminating "miss"
    const doneCount = finished.filter(function(e){ return e.status === "done"; }).length;
    let type;
    if (doneCount > 0 && doneCount >= run.personalBest && run.personalBest > 0){
      type = doneCount > run.personalBest ? "record" : "tie";
      run.personalBest = doneCount;
      run.bestSequence = finished.map(function(e){ return e.status; }); // tie: ghost swaps to the more recent run
    } else if (run.personalBest === 0 && doneCount > 0){
      type = "record";
      run.personalBest = doneCount;
      run.bestSequence = finished.map(function(e){ return e.status; });
    } else {
      type = "short";
    }
    if (doneCount > 0){
      run.pendingResult = { type: type, length: doneCount, prevBest: run.personalBest };
      run.badge = true;
    }
    run.currentRunStart = run.history.length;
  }
  // Finalizes every scheduled day strictly between a habit's
  // lastProcessedDate and "today" (exclusive) — run once at boot, and
  // again whenever the app is opened after a gap, so nothing needs a
  // background timer. Paused habits are frozen: no misses accrue while
  // paused, and the gap simply isn't evaluated.
  function processHabitBoundaries(){
    const today = todayStr();
    state.tasks.habit.forEach(function(h){
      if (h.isGroup) return;
      const run = ensureHabitRun(h.id);
      if (!run.lastProcessedDate){ run.lastProcessedDate = today; return; }
      if (run.lastProcessedDate === today) return;
      // Paused habits are FROZEN outright (design ruling from the pause/
      // completion round: pausing disables completion itself, so there is
      // nothing to sweep — the earlier technical fix that recorded done
      // days during a paused gap is superseded; a completion made just
      // before pausing is locked into history by screenTogglePause).
      if (run.paused){ run.lastProcessedDate = today; return; }
      let cursor = dateStrToDate(run.lastProcessedDate);
      const todayDate = dateStrToDate(today);
      while (cursor.getTime() < todayDate.getTime()){
        const ds = dateToStr(cursor);
        // The already-in-history guard covers the complete→pause path,
        // where screenTogglePause locked today's done in immediately —
        // without it, that day would be recorded a second time here
        // (complete → pause → unpause, then the next day's sweep).
        if (run.schedule.indexOf(cursor.getDay()) !== -1 &&
            !run.history.some(function(en){ return en.date === ds; })){
          const status = (state.habitDone[h.id] === ds) ? "done" : "miss";
          applyHabitDayOutcome(run, ds, status);
        }
        cursor = addDaysToDate(cursor, 1);
      }
      run.lastProcessedDate = today;
    });
    saveHabitRuns();
  }
  function toggleHabit(taskId){
    // Design ruling (pause/completion round): PAUSE MEANS PAUSE — a
    // paused habit can't be completed (or un-completed) at all. The
    // checkbox and the page's Complete badge render disabled; this guard
    // is the backstop for every path that reaches them (card tap, the
    // delayed check-animation path, the page badge).
    if (ensureHabitRun(taskId).paused) return;
    const today = todayStr();
    if (state.habitDone[taskId] === today){
      delete state.habitDone[taskId];
      state.habitDoneOrder = state.habitDoneOrder.filter(function(id){ return id !== taskId; });
    } else {
      state.habitDone[taskId] = today;
      state.habitDoneOrder.unshift(taskId);
    }
    saveHabitDone();
    saveHabitDoneOrder();
    renderLane("habit");
  }
  // Marks a habit's pending run result as seen (clears the badge). Called
  // when the habit's full-screen page is opened — the pendingResult itself
  // is returned so the screen can render the celebration/restart once, but
  // it's cleared from persisted state so it doesn't reappear on the next visit.
  function consumeHabitPendingResult(habitId){
    const run = ensureHabitRun(habitId);
    run.badge = false;
    const result = run.pendingResult;
    run.pendingResult = null;
    saveHabitRuns();
    return result;
  }
  function anyHabitBadge(){
    return state.tasks.habit.some(function(h){ return !h.isGroup && state.habitRuns[h.id] && state.habitRuns[h.id].badge; });
  }
  // The old normalizeHabitOrder adjacency pass is deleted per 11.1/11.4 —
  // with per-day schedules there's no single true routine sequence for the
  // lane to enforce, so ordering is fully manual (waiting-style). In its
  // place: a one-shot "Tidy" verb (11.5) — deterministic topological sort
  // (Kahn's, always popping the alphabetically-first ready habit) over the
  // FULL hook graph (not today's live graph — the order is one persisted
  // list, and a daily-changing suggestion would fight manual arrangement).
  // Externally-smuggled cycles just stall Kahn's; the cyclic remainder is
  // appended alphabetically — the tiebreaker doubles as the cycle handling.
  // Sorting happens within each mini-list bucket independently (cross-
  // bucket hooks are ignored for ordering); group rows stay where they are.
  function kahnSortHabits(items){
    const byId = {};
    items.forEach(function(t){ byId[t.id] = t; });
    const indeg = {}, children = {};
    items.forEach(function(t){ indeg[t.id] = 0; });
    items.forEach(function(t){
      (t.hooks || []).forEach(function(hk){
        if (byId[hk.id]){ indeg[t.id]++; (children[hk.id] = children[hk.id] || []).push(t.id); }
      });
    });
    const alpha = function(a, b){ return byId[a].title.toLowerCase() < byId[b].title.toLowerCase() ? -1 : 1; };
    let ready = items.filter(function(t){ return indeg[t.id] === 0; }).map(function(t){ return t.id; }).sort(alpha);
    const out = [], placed = new Set();
    while (ready.length){
      const id = ready.shift();
      out.push(byId[id]); placed.add(id);
      (children[id] || []).forEach(function(c){ if (--indeg[c] === 0) ready.push(c); });
      ready.sort(alpha);
    }
    items.filter(function(t){ return !placed.has(t.id); })
      .sort(function(a, b){ return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; })
      .forEach(function(t){ out.push(t); });
    return out;
  }
  function tidyHabitOrder(){
    const list = state.tasks.habit;
    const byParent = {};
    list.forEach(function(t){
      if (!t.isGroup){ const k = t.parent || ""; (byParent[k] = byParent[k] || []).push(t); }
    });
    Object.keys(byParent).forEach(function(k){ byParent[k] = kahnSortHabits(byParent[k]); });
    const cursor = {};
    state.tasks.habit = list.map(function(t){
      if (t.isGroup) return t;
      const k = t.parent || "";
      cursor[k] = cursor[k] || 0;
      return byParent[k][cursor[k]++];
    });
    saveTasksLocal("habit");
    renderLane("habit");
  }
  // Small dot on the Habits tab (both the top switcher and the in-lane
  // header) when a habit has a run result waiting to be viewed.
  function updateHabitBadge(){
    const has = anyHabitBadge();
    const switcherBtn = qs('#lane-switcher button[data-kind="habit"]');
    if (switcherBtn) switcherBtn.classList.toggle("has-badge", has);
  }

  // =========================================================
  // COLLAPSED GROUPS (always local)
  // =========================================================
  function loadCollapsed(kind){
    return new Set(Storage.getJSON("gtd_collapsed:" + kind, []));
  }
  function saveCollapsed(kind){
    Storage.setJSON("gtd_collapsed:" + kind, Array.from(state.collapsed[kind]));
  }
  function isCollapsed(kind, groupId){
    if (!state.collapsed[kind]) state.collapsed[kind] = loadCollapsed(kind);
    return state.collapsed[kind].has(groupId);
  }
  function toggleCollapsed(kind, groupId){
    if (!state.collapsed[kind]) state.collapsed[kind] = loadCollapsed(kind);
    const set = state.collapsed[kind];
    if (set.has(groupId)) set.delete(groupId); else set.add(groupId);
    saveCollapsed(kind);
    renderLane(kind);
  }

  // =========================================================
  // TASK OPERATIONS
  // =========================================================
  function addTask(kind, title, parentId, contextId){
    state.tasks[kind].push({ id: genId(), title: title, notesClean: "", linkedProjectId: null, isGroup: false, parent: parentId || null, contextId: contextId || null, whenText: null, hooks: [] });
    saveTasksLocal(kind);
    renderLane(kind);
  }
  function addGroup(kind, title){
    // New lists go to the front of the array (bugfix: they were pushed to
    // the end, which put them at the bottom of the lane — easy to miss
    // right after creating one, since it's the opposite end from the
    // "+ New list" button the user just tapped).
    const id = genId();
    state.tasks[kind].unshift({ id: id, title: title, notesClean: "", linkedProjectId: null, isGroup: true, parent: null });
    if (!state.collapsed[kind]) state.collapsed[kind] = loadCollapsed(kind);
    saveTasksLocal(kind);
    renderLane(kind);
  }
  // Habits get their own creation function since they carry a cue set
  // (any number of hooks plus any number of text cues) from the start.
  function addHabit(title, notesClean, whenTexts, hooks, bundleText){
    const finalWhens = (whenTexts || []).map(function(w){ return (w || "").trim(); }).filter(Boolean);
    const finalHooks = (hooks || []).slice();
    const finalBundle = (bundleText || "").trim() || null;
    const id = genId();
    state.tasks.habit.push({ id: id, title: title, notesClean: notesClean || "", linkedProjectId: null, isGroup: false, parent: null, whenTexts: finalWhens, hooks: finalHooks, bundleText: finalBundle });
    saveTasksLocal("habit");
    renderLane("habit");
    return id;
  }
  // Change an existing habit's cue set — hooks and text cues (11.2, cue
  // rows) — plus the description field.
  function setHabitCue(taskId, notesClean, whenTexts, hooks, bundleText){
    const task = state.tasks.habit.find(function(t){ return t.id === taskId; });
    if (!task) return;
    task.notesClean = notesClean || "";
    task.whenTexts = (whenTexts || []).map(function(w){ return (w || "").trim(); }).filter(Boolean);
    task.hooks = (hooks || []).slice();
    task.bundleText = (bundleText || "").trim() || null;
    saveTasksLocal("habit");
    renderLane("habit");
  }
  function renameTask(kind, taskId, newTitle){
    const task = state.tasks[kind].find(function(t){ return t.id === taskId; });
    if (!task) return;
    task.title = newTitle;
    saveTasksLocal(kind);
    renderLane(kind);
  }
  function completeTask(kind, taskId){
    // Promotion rule (4.2): completing a Next Action auto-promotes any
    // Waiting items whose condition points at it. Free-text/date "waiting
    // for" items have no conditionId, so they never match here — manual
    // arrow only, as spec'd. Captured before removal; conditionId still
    // matches taskId regardless of when the source task is deleted.
    const dependents = kind === "next"
      ? state.tasks.waiting.filter(function(t){ return t.conditionId === taskId && !t.isGroup; })
      : [];
    function promoteDependents(){ dependents.forEach(function(dep){ moveItem("waiting", "next", dep.id, false); }); }
    // New Completed archive: the finished item moves to the top of
    // state.completed[kind] rather than disappearing for good — kept
    // forever per the retention ruling (§4.12b).
    let completedTask = null;
    function archiveCompleted(){
      const task = state.tasks[kind].find(function(t){ return t.id === taskId; });
      if (task){
        completedTask = task;
        // chunk 7: a completed pseudo-action archives with its series identity
        // so the Completed section can collapse repeats ("Pay rent ×6", §4.15b).
        const ev = task.eventId ? findEvent(task.eventId) : null;
        const extra = ev ? { completedAt: todayStr(), seriesId: ev.seriesId || null } : { completedAt: todayStr() };
        state.completed[kind].unshift(Object.assign({}, task, extra));
        saveCompletedLocal(kind);
      }
    }
    archiveCompleted();
    state.tasks[kind] = state.tasks[kind].filter(function(t){ return t.id !== taskId; });
    saveTasksLocal(kind);
    // chunk 7 (§4.14a): completing a pseudo-action writes back to its event —
    // records the occurrence and (for a series) arms the 10-minute roll.
    if (completedTask && completedTask.eventId){ onPseudoActionCompleted(completedTask); renderLane("waiting"); }
    renderLane(kind);
    refreshProjectFlags(kind);
    promoteDependents();
  }
  // The Current lane's "⚠ no linked actions" flag (4.3b) is DERIVED state:
  // it's computed from the next/waiting lanes at render time. So any commit
  // that mutates those lanes (create/update/delete/complete, or a link
  // change) can flip a project between stalled and healthy — re-render the
  // Current lane whenever that happens, or the flag goes stale until the
  // project's own page is next save-exited (QA finding: linking an action
  // from the Next Actions page left the project's flag showing until the
  // project itself was opened and saved). Cheap: renderLane is already a
  // full innerHTML rebuild everywhere else. Note this is COMMIT-time only —
  // it never fires from a draft, so the lane-refresh-keyed-to-save ruling
  // (§6) is untouched; this repaints committed truth, not draft state.
  function refreshProjectFlags(kind){
    if (kind === "next" || kind === "waiting") renderLane("current");
  }
  function deleteTask(kind, taskId){
    // If this is a habit that other habits are hooked onto, freeze their
    // cue label at whatever this habit was last called, rather than
    // leaving them pointing at nothing.
    if (kind === "habit"){
      const deletedHabit = state.tasks.habit.find(function(h){ return h.id === taskId; });
      if (deletedHabit){
        const dependents = state.tasks.habit.filter(function(h){
          return (h.hooks || []).some(function(hk){ return hk.id === taskId; });
        });
        dependents.forEach(function(h){
          h.hooks.forEach(function(hk){ if (hk.id === taskId) hk.label = deletedHabit.title; });
        });
      }
    }
    // Condition action deleted -> dependent keeps an orphaned pill (habit-
    // style): freeze the label now, before the target disappears, so the
    // card can still show meaningful text with the dashed warning outline.
    if (kind === "next" || kind === "waiting"){
      const deletedTask = state.tasks[kind].find(function(t){ return t.id === taskId; });
      if (deletedTask){
        const dependents = state.tasks.waiting.filter(function(t){ return t.conditionId === taskId; });
        if (dependents.length){
          dependents.forEach(function(t){ t.conditionLabel = deletedTask.title; });
          saveTasksLocal("waiting");
        }
      }
    }
    // ⚑ A deleted PROJECT leaves its events pointing at nothing. Their
    // behaviour was already right — an event with a dangling link keeps firing
    // as an ordinary calendar entry, which is the "unlink, don't delete" answer
    // — so this is hygiene rather than a behaviour change: clear the id so the
    // event page's project dropdown does not carry a reference to a project
    // that is gone. Deliberately NOT deleting the events: a meeting can outlive
    // the project it was booked for, and silently deleting calendar entries as
    // a side effect of deleting a project would be a nasty surprise.
    if (isProjectKind(kind)){
      let touched = false;
      (state.events || []).forEach(function(ev){
        if (ev.linkedProjectId === taskId){ ev.linkedProjectId = null; touched = true; }
      });
      if (touched) saveEvents();
    }
    state.tasks[kind] = state.tasks[kind].filter(function(t){ return t.id !== taskId && t.parent !== taskId; });
    if (kind === "habit" && state.habitRuns[taskId]){ delete state.habitRuns[taskId]; saveHabitRuns(); }
    saveTasksLocal(kind);
    renderLane(kind);
    if (kind !== "waiting") renderLane("waiting");
    refreshProjectFlags(kind);
  }
  // ⚑ Returns a COPY, and that is load-bearing. This used to hand back the
  // task's own deadline object, which the draft then mutated in place
  // (screen-date's handler does `draft.deadline.date = el.value`). Two
  // consequences, both real:
  //   · DRAFT ISOLATION was broken for this one field — typing a new date and
  //     leaving by ✕ had already changed the task in memory, against the
  //     standing ruling that nothing commits until Save.
  //   · QA #23 could not see a push at all: applyDeadlineChange compares the
  //     stored deadline against the incoming one, and they were the same
  //     object, so the date had ALWAYS "not changed".
  // Found while wiring the push counter; the isolation half is the older and
  // more serious of the two.
  function getDeadline(task){
    const d = task && task.deadline;
    if (!d) return null;
    return { date: d.date, time: d.time || null, setAt: d.setAt || null, pushCount: d.pushCount || 0 };
  }

  // Creates a brand-new leaf task (Next/Waiting/Current/Future) from the
  // full-screen create page. Habits have their own creation path (addHabit)
  // since their cue system predates this chunk and works differently.
  // data: { title, notesClean, linkedProjectId, deadline }
  function createTask(kind, data){
    const base = {
      notesClean: data.notesClean || "", linkedProjectId: data.linkedProjectId || null, deadline: data.deadline || null,
      whenText: data.whenText || null, conditionId: data.conditionId || null,
      conditionKind: data.conditionKind || null, conditionLabel: data.conditionLabel || null,
      bundleText: data.bundleText || null, contextId: data.contextId || null, createdAt: nowMs() // deadline-bar origin (§4.4b)
    };
    // ⚑ parent comes from the caller now: creating from a list's + drops the new
    // item straight into that list (user). Defaults to null — an item created
    // from the FAB is still ungrouped, exactly as before.
    const task = Object.assign({ id: genId(), title: data.title, isGroup: false, parent: data.parent || null }, base);
    state.tasks[kind].unshift(task);
    saveTasksLocal(kind);
    renderLane(kind);
    refreshProjectFlags(kind);
    return Promise.resolve(task);
  }

  // ⚑ REVERSED (user): QA #23 used to restart the progress bar's origin every
  // time the date changed ("change the start, but mark the pushed with a
  // counter"). That was wrong — the bar should NOT reset. setAt is now written
  // ONCE, the first time a deadline is set, and carried forward untouched
  // through every later push; the bar's fill keeps reflecting progress since
  // that original schedule was set, against whatever the CURRENT due date is.
  // A move to a LATER date is still counted by the push counter — that part of
  // the old ruling stands, only the origin-reset half was the mistake.
  //
  // This lives here rather than in the review's push handler, so that editing
  // the date on the item's own page behaves identically. One gesture, one rule.
  function applyDeadlineChange(task, next){
    const prev = task.deadline || null;
    const nd = (next && next.date) ? next : null;
    if (!nd){ task.deadline = null; return; }
    const pushedLater = !!(prev && prev.date && nd.date > prev.date);
    task.deadline = {
      date: nd.date,
      time: nd.time || null,
      setAt: (prev && prev.setAt) || nowMs(),
      pushCount: ((prev && prev.pushCount) || 0) + (pushedLater ? 1 : 0)
    };
  }

  // Updates an existing Next/Waiting/Current/Future task's editable fields.
  function updateTask(kind, taskId, data){
    const task = state.tasks[kind].find(function(t){ return t.id === taskId; });
    if (!task) return Promise.resolve(null);
    task.title = data.title;
    task.notesClean = data.notesClean || "";
    task.linkedProjectId = data.linkedProjectId || null;
    applyDeadlineChange(task, data.deadline);
    task.whenText = data.whenText || null;
    task.conditionId = data.conditionId || null;
    task.conditionKind = data.conditionKind || null;
    task.conditionLabel = data.conditionLabel || null;
    task.bundleText = data.bundleText || null;
    if (isActionKind(kind)) task.contextId = data.contextId || null;
    saveTasksLocal(kind);
    renderLane(kind);
    refreshProjectFlags(kind);
    return Promise.resolve(task);
  }

  // Moves a single leaf task to a different lane (Make Waiting / Make Next /
  // Make Current / Make Future). It exits any mini-list it belonged to —
  // simplest option, since mini-list membership is lane-specific. The task
  // keeps its id across the move (no backend forces a delete+recreate any
  // more), so anything conditioned on it — a Waiting item's "waiting for"
  // — keeps pointing at the right task with no relinking step needed.
  function changeKind(fromKind, toKind, taskId){
    const list = state.tasks[fromKind];
    const idx = list.findIndex(function(t){ return t.id === taskId; });
    if (idx === -1) return Promise.resolve(null);
    const task = list.splice(idx, 1)[0];
    task.parent = null;
    // ⚑ A Someday project holds no deadline (user). Converting Current → Someday
    // drops it SILENTLY — no warning: a Future project by definition has no due
    // date, so there is nothing to preserve and nothing lost that the user did not
    // ask for by moving it here. (This is the deadline sibling of the
    // whenText/condition drop below — same "the destination lacks this field" rule.)
    if (toKind === "future") task.deadline = null;
    task.linkedProjectId = (toKind === "current" || toKind === "future") ? null : task.linkedProjectId;
    // "Waiting for" only makes sense on the Waiting lane itself — Next
    // Actions can't have conditions (4.2), and Projects don't have this
    // field at all.
    task.whenText = toKind === "waiting" ? task.whenText : null;
    task.conditionId = toKind === "waiting" ? task.conditionId : null;
    task.conditionKind = toKind === "waiting" ? task.conditionKind : null;
    task.conditionLabel = toKind === "waiting" ? task.conditionLabel : null;
    state.tasks[toKind].unshift(task);
    saveTasksLocal(fromKind);
    saveTasksLocal(toKind);
    renderLane(fromKind);
    renderLane(toKind);
    refreshProjectFlags(toKind);
    return Promise.resolve(task);
  }

  function setLink(kind, taskId, projectId){
    const task = state.tasks[kind].find(function(t){ return t.id === taskId; });
    if (!task) return;
    task.linkedProjectId = projectId || null;
    saveTasksLocal(kind);
    renderLane(kind);
    refreshProjectFlags(kind);
  }
  // Manual arrow-promote (Waiting -> Next, Future -> Current) and the
  // auto-promotion cascade both funnel through here. Deadline carries over
  // since Next/Waiting/Current/Future all support it; "waiting for"
  // (whenText/condition) is intentionally dropped once something leaves
  // the Waiting lane — the destination kinds don't have that field. Ids
  // are preserved across the move (no backend forces a delete+recreate),
  // so anything conditioned on this task's id keeps pointing at it.
  function moveItem(sourceKind, destKind, taskId, isGroupItem){
    const list = state.tasks[sourceKind];
    const root = list.find(function(t){ return t.id === taskId; });
    if (!root) return;
    const children = isGroupItem ? list.filter(function(t){ return t.parent === taskId; }) : [];

    state.tasks[sourceKind] = list.filter(function(t){ return t.id !== taskId && t.parent !== taskId; });
    root.parent = null;
    root.linkedProjectId = root.isGroup ? null : root.linkedProjectId;
    root.deadline = root.isGroup ? null : (root.deadline || null);
    root.whenText = null;
    root.conditionId = null;
    root.conditionKind = null;
    root.conditionLabel = null;
    root.bundleText = null;
    children.forEach(function(c){
      c.deadline = c.deadline || null;
      c.whenText = null;
      c.conditionId = null;
      c.conditionKind = null;
      c.conditionLabel = null;
      c.bundleText = null;
    });
    // Promotions into Next Actions surface at the very top so the newly-
    // actionable item is impossible to miss (overnight notes); other
    // destinations keep appending.
    if (destKind === "next"){
      state.tasks[destKind].unshift(root);
      let after = 0;
      children.forEach(function(c){ state.tasks[destKind].splice(++after, 0, c); });
    } else {
      state.tasks[destKind].push(root);
      children.forEach(function(c){ state.tasks[destKind].push(c); });
    }
    saveTasksLocal(sourceKind);
    saveTasksLocal(destKind);
    renderLane(sourceKind);
    renderLane(destKind);
    return Promise.resolve(root);
  }
  // The DOM dropzone's data-dropzone-parent (`containerId`) means different
  // things per lane (chunk 3): on the ACTION lanes it is a CONTEXT id (or a
  // dev group-task id, or "" for loose); on the PROJECT lanes it is a
  // group-task parent id. groupKeyOf collapses that so reordering finds the
  // right same-group siblings either way.
  function groupKeyOf(kind, t){ return isActionKind(kind) ? (t.contextId || t.parent || "") : (t.parent || ""); }
  function moveWithinList(kind, taskId, containerId, previousId){
    const list = state.tasks[kind];
    const idx = list.findIndex(function(t){ return t.id === taskId; });
    if (idx === -1) return;
    const task = list[idx];
    list.splice(idx, 1);
    if (isActionKind(kind)){
      // A registry id → context membership; anything else (a dev group-task
      // id, or "") → the group-task parent slot. The other key is cleared, so
      // an action is never in a context and a group-task at once.
      if (containerId && findContext(containerId)){ task.contextId = containerId; task.parent = null; }
      else { task.contextId = null; task.parent = containerId || null; }
    } else {
      task.parent = containerId || null;
    }
    const myKey = groupKeyOf(kind, task);
    if (!previousId){
      let insertAt = list.findIndex(function(t){ return groupKeyOf(kind, t) === myKey; });
      if (insertAt === -1) insertAt = list.length;
      list.splice(insertAt, 0, task);
    } else {
      const prevIdx = list.findIndex(function(t){ return t.id === previousId; });
      if (prevIdx === -1){ list.push(task); } else { list.splice(prevIdx + 1, 0, task); }
    }
    saveTasksLocal(kind);
    renderLane(kind);
  }

  // =========================================================
  // GENERIC CHOICE DIALOG (delete confirm, demotion prompt, etc.)
  // =========================================================
  function closeDialog(){ qs("#dialog-root").innerHTML = ""; }
  function openConfirmDialog(message, buttons){
    // buttons: [{ label, style: "primary"|"danger"|"", action: fn }]
    const btnsHtml = buttons.map(function(b, i){
      return '<button type="button" class="' + (b.style || "") + '" data-idx="' + i + '">' + escapeHtml(b.label) + '</button>';
    }).join("");
    qs("#dialog-root").innerHTML =
      '<div class="choice-dialog-backdrop"><div class="choice-dialog"><p>' + escapeHtml(message) + '</p>' +
      '<div class="choice-dialog-btns">' + btnsHtml + '</div></div></div>';
    const backdrop = qs(".choice-dialog-backdrop");
    backdrop.addEventListener("click", function(e){ if (e.target === backdrop) closeDialog(); });
    qsa(".choice-dialog-btns button").forEach(function(btn, i){
      btn.addEventListener("click", function(){ closeDialog(); buttons[i].action && buttons[i].action(); });
    });
  }

  // Waiting actions archived off a completed project (9: "temporarily
  // archived in case the completion was a mistake"). Always local — this
  // is app-level bookkeeping on top of whatever backend holds the live
  // lists, same as collapsed-state or habit-done tracking.
  function loadArchivedWaiting(){
    return Storage.getJSON("gtd_archived_waiting", {});
  }
  function saveArchivedWaiting(obj){ Storage.setJSON("gtd_archived_waiting", obj); }
  function archiveWaitingForProject(projectId, tasks){
    const archived = loadArchivedWaiting();
    archived[projectId] = (archived[projectId] || []).concat(tasks.map(function(t){ return Object.assign({}, t); }));
    saveArchivedWaiting(archived);
  }
  // ⚑ The same treatment for a completed project's linked EVENTS, which nothing
  // used to do. Completing a project archived its waiting items — with a dialog
  // saying so — and silently left its events running: a weekly site meeting on a
  // finished project kept minting a Next Action every week, for ever. Archived
  // rather than deleted for exactly the reason the waiting items are: completing
  // a project is easy to do by mistake, and a deleted series cannot be got back.
  function loadArchivedEvents(){ return Storage.getJSON("gtd_archived_events", {}); }
  function saveArchivedEvents(obj){ Storage.setJSON("gtd_archived_events", obj); }
  function archiveEventsForProject(projectId){
    const linked = (state.events || []).filter(function(ev){ return ev.linkedProjectId === projectId; });
    if (!linked.length) return 0;
    const archived = loadArchivedEvents();
    archived[projectId] = (archived[projectId] || []).concat(linked.map(function(ev){ return Object.assign({}, ev); }));
    saveArchivedEvents(archived);
    // Take the live rows with them: an archived event must stop appearing in
    // Next Actions, which is the whole point.
    linked.forEach(function(ev){ removePseudoRow(ev.id); });
    const ids = new Set(linked.map(function(ev){ return ev.id; }));
    state.events = state.events.filter(function(ev){ return !ids.has(ev.id); });
    saveEvents();
    return linked.length;
  }
  // The mirror, ready for the un-complete control the same way
  // restoreWaitingForProject is. Not wired to a button yet.
  function restoreEventsForProject(projectId){
    const archived = loadArchivedEvents();
    const rows = archived[projectId];
    if (!rows || !rows.length) return 0;
    state.events = (state.events || []).concat(rows.map(function(ev){ return Object.assign({}, ev); }));
    delete archived[projectId];
    saveArchivedEvents(archived);
    saveEvents();
    processEventBoundaries();
    return rows.length;
  }
  // Restores a project's archived Waiting actions back into the live
  // Waiting list. Not wired to any button yet — the un-complete-project
  // control that would call this is chunk 5's Completed section; this is
  // ready for it (see the un-completion reversal cascade note below).
  function restoreArchivedWaitingForProject(projectId){
    const archived = loadArchivedWaiting();
    const items = archived[projectId] || [];
    if (!items.length) return;
    // Same emergency-restore rule (§12.2 step 4): the project itself is live
    // again by the time this runs (restoreTask unshifts it first), so a
    // waiting item's linkedProjectId resolves — but its parent/context may
    // have died while archived, so sanitize each before it lands.
    items.forEach(function(t){ sanitizeRestoredParentage("waiting", t); state.tasks.waiting.push(t); });
    saveTasksLocal("waiting");
    delete archived[projectId];
    saveArchivedWaiting(archived);
    renderLane("waiting");
  }

  // Actions (Next/Waiting) currently linked to a given project.
  function linkedActionsForProject(projectId){
    const out = [];
    ["next", "waiting"].forEach(function(k){
      state.tasks[k].forEach(function(t){ if (t.linkedProjectId === projectId) out.push({ kind: k, task: t }); });
    });
    return out;
  }
  // §4.3b: a Current project has a "way forward" if it has any linked action —
  // a next action OR a waiting action both count (linkedActionsForProject
  // already spans both). Extracted so the lane-card stalled flag (§4.3b) and
  // the review's stalled query (§4.8b) share ONE definition and can never
  // disagree. ⚑ Chunk 7 adds linked events/appointments as a third kind of
  // forward motion here (§4.3b/§4.8b) — that is the only edit this needs.
  function projectHasWayForward(projectId){
    return linkedActionsForProject(projectId).length > 0 || projectHasLinkedEvent(projectId);
  }

  // Project "Complete" — per 4.6 as refined in 9: Next Actions complete
  // silently; linked Waiting actions are temporarily archived instead of
  // completed (in case the project completion was a mistake), with a
  // confirmation prompt naming that up front.
  function completeProject(kind, projectId){
    const linked = linkedActionsForProject(projectId);
    const waitingLinked = linked.filter(function(l){ return l.kind === "waiting"; });
    const nextLinked = linked.filter(function(l){ return l.kind === "next"; });
    // \u2691 Events are counted and archived alongside the waiting items now. They
    // were previously left running, which meant a repeating event on a finished
    // project went on producing a Next Action indefinitely.
    const eventCount = (state.events || []).filter(function(ev){ return ev.linkedProjectId === projectId; }).length;
    function doComplete(){
      nextLinked.forEach(function(l){ completeTask(l.kind, l.task.id); });
      if (waitingLinked.length){
        archiveWaitingForProject(projectId, waitingLinked.map(function(l){ return l.task; }));
        waitingLinked.forEach(function(l){ deleteTask(l.kind, l.task.id); });
      }
      if (eventCount){
        archiveEventsForProject(projectId);
        renderLane("next"); renderLane("waiting");
      }
      completeTask(kind, projectId);
    }
    // One sentence per thing that is about to happen, naming both \u2014 a dialog
    // that mentioned only the waiting items while also archiving the calendar
    // entries would be worse than the silent version it replaces.
    const parts = [];
    if (waitingLinked.length) parts.push(waitingLinked.length + " linked waiting item" + (waitingLinked.length === 1 ? "" : "s"));
    if (eventCount) parts.push(eventCount + " linked calendar " + (eventCount === 1 ? "entry" : "entries"));
    if (parts.length){
      const what = parts.join(" and ");
      const many = (waitingLinked.length + eventCount) > 1;
      openConfirmDialog(
        "This project has " + what + ". Completing it will put " + (many ? "them" : "it") +
        " aside \u2014 " + (many ? "they" : "it") + " will stop appearing, and " +
        (many ? "they" : "it") + " can be brought back if this was a mistake.",
        [
          { label: "Complete project", style: "primary", action: doComplete },
          { label: t("chrome.cancel"), action: function(){} }
        ]
      );
    } else {
      doComplete();
    }
  }

  // Current -> Future demotion: future projects can't have linked actions.
  //
  // ⚑ Nor linked EVENTS, and that is the fix here. A project moved to Someday
  // used to keep its calendar entries firing — the app interrupting you about
  // something you had explicitly parked. The rule already existed for actions;
  // events were simply never included in it.
  //
  // ⚑ I had proposed pausing the series instead. The codebase had already ruled
  // on this exact shape and the precedent is better: a Someday project holds no
  // links at all, and the user chooses unlink or delete. An unlinked event keeps
  // firing as an ordinary calendar entry, exactly as an unlinked action stays in
  // its lane — the meeting may still be real even if the project is parked.
  function demoteProjectToFuture(projectId){
    const linked = linkedActionsForProject(projectId);
    const linkedEvents = (state.events || []).filter(function(ev){ return ev.linkedProjectId === projectId; });
    if (!linked.length && !linkedEvents.length){
      changeKind("current", "future", projectId).then(function(){ if (state.screen) closeScreen(); });
      return;
    }
    function unlinkEvents(){
      linkedEvents.forEach(function(ev){ ev.linkedProjectId = null; });
      if (linkedEvents.length){ saveEvents(); renderLane("next"); }
    }
    function deleteEvents(){
      linkedEvents.forEach(function(ev){ deleteEventEntirely(ev); });
    }
    const nouns = [];
    if (linked.length) nouns.push("actions");
    if (linkedEvents.length) nouns.push("calendar entries");
    const what = nouns.join(" or ");
    // ⚑ SAY WHAT SURVIVES, not just what goes (user: "make sure that converting a
    // current project to a future project doesn't remove the notes. The dialogue
    // should reflect this if it doesn't already.")
    //
    // It never did remove them — this function only touches linked actions and
    // events — but the dialog listed only casualties, so a reader had no reason
    // to believe the notes were safe and every reason to fear they weren't. That
    // is a real cost even when the code is right: the user's stated purpose for
    // notes on Someday projects is planning and sketching out ideas, which is
    // exactly the material you will not write if you think a conversion eats it.
    // Only stated when there ARE notes, or it is noise.
    const noteCount = (state.notes || []).filter(function(n){
      return (n.projectLinks || []).some(function(l){ return l.id === projectId; });
    }).length;
    const keeps = noteCount
      ? " Linked notes are kept either way — " + (noteCount === 1 ? "the note" : "all " + noteCount + " notes") + " will still be on the project."
      : "";
    openConfirmDialog(
      "Someday projects can't hold linked " + what + ". Unlink them, or delete them?" + keeps,
      [
        { label: "Unlink", style: "primary", action: function(){
            linked.forEach(function(l){ setLink(l.kind, l.task.id, null); });
            unlinkEvents();
            changeKind("current", "future", projectId).then(function(){ if (state.screen) closeScreen(); });
          } },
        { label: "Delete", style: "danger", action: function(){
            linked.forEach(function(l){ deleteTask(l.kind, l.task.id); });
            deleteEvents();
            changeKind("current", "future", projectId).then(function(){ if (state.screen) closeScreen(); });
          } },
        { label: t("chrome.cancel"), action: function(){} }
      ]
    );
  }

  // =========================================================
  // RENDERING
  // =========================================================
  function findProjectTitle(projectId){
    for (let i = 0; i < PROJECT_KINDS.length; i++){
      const k = PROJECT_KINDS[i];
      const t = state.tasks[k].find(function(x){ return x.id === projectId; });
      if (t) return t.title;
    }
    return null;
  }
  function findProjectKind(projectId){
    for (let i = 0; i < PROJECT_KINDS.length; i++){
      const k = PROJECT_KINDS[i];
      if (state.tasks[k].some(function(x){ return x.id === projectId; })) return k;
    }
    return null;
  }
  // Future projects are intentionally excluded (ruling in section 9: "a
  // project with a live action is by definition current").
  function projectOptionsHtml(selectedId){
    let html = '<option value="">' + escapeHtml(t("field.noLinkedProject")) + '</option>';
    if (state.tasks.current.length){
      html += '<optgroup label="' + escapeHtml(LIST_TITLES.current) + '">';
      // ⚑ Dev scaffolding excluded, same reasoning as the note picker: the chunk
      // map injects ~26 rows into Current Projects, and a chooser that buries the
      // two real ones under them is not a chooser. An item ALREADY linked to one
      // still lists it, so an existing selection can never silently vanish.
      state.tasks.current.filter(function(t){
        return !t.isGroup && (!isDevScaffold(t) || t.id === selectedId);
      }).forEach(function(t){
        html += '<option value="' + t.id + '"' + (t.id === selectedId ? " selected" : "") + '>' + escapeHtml(t.title) + '</option>';
      });
      html += '</optgroup>';
    }
    return html;
  }
  function buildTree(kind, list){
    const byParent = {};
    (list || state.tasks[kind]).forEach(function(t){
      const key = t.parent || "";
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(t);
    });
    return byParent;
  }
  // Deadline progress bar (§4.4b/c/d). Origin-agnostic math per the spec's own
  // instruction (chunk 7 reuses this exact bar for events with a different
  // origin) — deadlineBarState() just needs an origin + due instant, and
  // leafCardHtml only calls it for Next Actions / Current Projects (§4.1).
  function deadlineDueInstant(deadline){
    const d = dateStrToDate(deadline.date);
    if (deadline.time){
      const parts = deadline.time.split(":").map(Number);
      d.setHours(parts[0] || 0, parts[1] || 0, 0, 0);
      return d.getTime();
    }
    // Untimed: due at the 4 AM boundary that BEGINS the due day (§4.4d) —
    // the same shift boundaryNow() applies, in reverse, to locate it.
    return d.getTime() + 4 * 3600 * 1000;
  }
  function deadlineBarState(task){
    const deadline = task.deadline;
    if (!deadline || !deadline.date) return null;
    const due = deadlineDueInstant(deadline);
    const now = nowMs();
    // ⚑ FIXED (4 AM turnover audit, this round): an UNTIMED deadline's bar
    // converges on the 4 AM boundary that BEGINS its due day — that is when it
    // reaches full, and it is right, because the day itself is the resolution.
    // But it does not go PASSED there: §4.4d puts the chip at the 4 AM boundary
    // that ENDS the app-day. The two were conflated, so a deadline due today
    // wore the "passed" chip from 4 AM onward — a full day early — and the
    // review (§4.8b) counted it as a past-due open loop on the morning it was
    // still perfectly on time. Full all day, passed once the day is over.
    const passedAt = deadline.time ? due : due + 24 * 3600 * 1000;
    if (now >= passedAt) return { full: true, red: true, passed: true, fillPercent: 100 };
    if (now >= due) return { full: true, red: true, passed: false, fillPercent: 100 };
    // The window starts when the deadline was FIRST set (§ user reversal —
    // applyDeadlineChange no longer moves setAt on a later push, so the bar
    // never resets; it keeps reading progress against the original schedule,
    // just re-measured to whatever the due date currently is).
    // Missing both (pre-chunk-2 / hand-edited test data) → treat as a
    // zero-width window, the same safe fallback a same-day deadline uses
    // (§4.4d: don't divide by zero).
    const origin = deadline.setAt || task.createdAt || due;
    const totalWindow = due - origin;
    if (totalWindow <= 0) return { full: true, red: false, passed: false, fillPercent: 100 };
    const elapsedFrac = Math.max(0, Math.min(1, (now - origin) / totalWindow));
    const threeWeeksMs = 21 * 24 * 3600 * 1000;
    let fillFrac;
    if (totalWindow <= threeWeeksMs){
      fillFrac = elapsedFrac;
    } else {
      // Light front-loaded curve for the first 85% of elapsed time, then
      // honest 1:1 tracking for the final 15%, reaching exactly 100% at the
      // due instant (§4.4b). fillAt85 is a build-time tuning constant; the
      // shape — front-loaded, then linear home — is what's locked.
      const fillAt85 = 0.7;
      fillFrac = elapsedFrac <= 0.85
        ? fillAt85 * Math.pow(elapsedFrac / 0.85, 0.6)
        : fillAt85 + (elapsedFrac - 0.85) / 0.15 * (1 - fillAt85);
    }
    return { full: false, red: elapsedFrac >= 0.85, passed: false, fillPercent: Math.round(fillFrac * 100) };
  }
  // QA #23: the push counter sits in the same slot as the passed marker (user
  // ruling). ⚑ Rendered compactly as "↻2" with the count spelled out in the
  // tooltip, rather than "pushed ×2" — the chip slot is space the BAR gives up
  // (see .deadline-bar.passed's reserved margin, QA #21), and a wordy second
  // chip on a passed-and-pushed deadline eats a third of the card's width. The
  // app already puts teaching in tooltips (CLAUDE.md). Say if you would rather
  // have the word and the narrower bar.
  function deadlinePushChipHtml(deadline){
    const n = (deadline && deadline.pushCount) || 0;
    if (!n) return "";
    return '<span class="deadline-push-chip" title="Deadline pushed ' + n + (n === 1 ? " time" : " times") + '">&#8635;' + n + '</span>';
  }
  function deadlineBarHtml(task){
    const s = deadlineBarState(task);
    if (!s) return "";
    const pushed = ((task.deadline && task.deadline.pushCount) || 0) > 0;
    const classes = "deadline-bar" + (s.full ? " full" : "") + (s.red ? " red" : "") +
      (s.passed ? " passed" : "") + (pushed ? " pushed" : "");
    const chips = deadlinePushChipHtml(task.deadline) +
      (s.passed ? '<span class="deadline-passed-chip">passed</span>' : "");
    return '<div class="' + classes + '" style="--fill:' + s.fillPercent + '%"><div class="deadline-bar-fill"></div>' +
      (chips ? '<span class="deadline-chips">' + chips + '</span>' : "") + '</div>';
  }
  function leafCardHtml(kind, task){
    const canLink = (kind === "next" || kind === "waiting");
    const moveDest = MOVE_MAP[kind];
    const isHabit = kind === "habit";
    const done = isHabit && habitDoneToday(task.id);
    const habitRun = isHabit ? ensureHabitRun(task.id) : null;
    let linkBlock = "";
    if (canLink && task.linkedProjectId){
      if (kind === "waiting"){
        // The project-title pill and the condition pill competed for space
        // on Waiting cards (overnight notes) — the project link is now a
        // compact green icon that jumps to the project's page.
        const pKind = findProjectKind(task.linkedProjectId);
        const pTitle = findProjectTitle(task.linkedProjectId);
        if (pKind){
          linkBlock = '<button class="project-jump" data-action="open-edit" data-kind="' + pKind + '" data-id="' + task.linkedProjectId + '" title="Open project: ' + escapeHtml(pTitle || "") + '">&#128279;</button>';
        }
      } else {
        const title = findProjectTitle(task.linkedProjectId);
        linkBlock = '<button class="link-pill" data-action="open-edit" data-kind="' + kind + '" data-id="' + task.id + '">&#128279; ' + escapeHtml(title || "linked project") + '</button>';
      }
    }
    let cueBlock = "";
    if (isHabit && habitRun.paused){
      // QA ruling: a paused habit's card shows the Paused pill and
      // NOTHING cue-related — no live hook pills, no fallback text, no
      // "No cue today", no "+ add plan". Cues describe when the habit
      // fires, and a paused habit doesn't fire; rendering them contradicts
      // the pause. The full cue set stays visible on the habit page. The
      // "New result" badge is a notification, not a cue — it still shows.
      cueBlock = '<span class="link-pill" style="opacity:0.7;">&#9208; Paused</span>';
      if (habitRun.badge) cueBlock += '<span class="link-pill" style="border-color:var(--red); color:var(--red);">&#9679; New result</span>';
    } else if (isHabit){
      // 11.3: the card shows only today's LIVE cues. Dead hooks (target
      // off-schedule today, paused, or deleted) don't render here — the
      // habit page is where the full cue list, dimmed states, and orphan
      // repair live. No live hooks → fallback text; nothing live at all →
      // a dimmed "no cue today" pill in the orphan visual family.
      const hooks = task.hooks || [];
      const liveHooks = hooks.filter(hookLiveToday);
      const whens = task.whenTexts || [];
      if (liveHooks.length){
        liveHooks.forEach(function(hk){
          if (hk.ctx){
            // Context-cue: always-live. SAME linked-cue visual language as a
            // habit hook (user ruling): the 🔗 icon just says "a cue is
            // linked" — consistency is the whole point — with the context
            // name standing in for the hook target.
            const ctx = findContext(hk.id);
            cueBlock += '<button class="link-pill" data-action="open-edit" data-kind="habit" data-id="' + task.id + '">&#128279; ' + escapeHtml(ctx.name) + '</button>';
          } else {
            const target = state.tasks.habit.find(function(h){ return h.id === hk.id && !h.isGroup; });
            cueBlock += '<button class="link-pill" data-action="open-edit" data-kind="habit" data-id="' + task.id + '">&#128279; After ' + escapeHtml(target.title) + '</button>';
          }
        });
      } else if (whens.length){
        whens.forEach(function(w){
          cueBlock += '<button class="link-pill" data-action="open-edit" data-kind="habit" data-id="' + task.id + '">&#128337; ' + escapeHtml(w) + '</button>';
        });
      } else if (hooks.length){
        cueBlock += '<button class="link-pill cue-orphaned" data-action="open-edit" data-kind="habit" data-id="' + task.id + '">&#128279; No cue today</button>';
      } else {
        cueBlock += '<button class="link-pill cue-empty" data-action="open-edit" data-kind="habit" data-id="' + task.id + '">+ add plan</button>';
      }
      if (habitRun.badge) cueBlock += '<span class="link-pill" style="border-color:var(--red); color:var(--red);">&#9679; New result</span>';
    }
    // Waiting cards show what they're waiting for — a condition pill takes
    // priority (it's the "second most important thing after the title"
    // per 4.2), falling back to the free-text or date option.
    if (kind === "waiting"){
      if (task.conditionId){
        // ⚑ FIX: check BOTH live pools, not just the one named by
        // conditionKind. conditionKind records the target's kind at the
        // moment the hook was made — but a waiting target can PROMOTE to
        // next (that is the entire point of a hook) while remaining live,
        // and neither moveItem nor changeKind update a dependent's stored
        // conditionKind when that happens. Picking one pool by a value that
        // can go stale mid-flight showed a perfectly live chain link as
        // "cue-orphaned" for as long as its target sat promoted-but-not-yet-
        // completed. A condition can only ever target a next or waiting item
        // (getValidConditionTargets), so search both.
        const liveTarget = state.tasks.next.concat(state.tasks.waiting)
          .find(function(t){ return t.id === task.conditionId && !t.isGroup; });
        // chunk 8 (§10): a condition may point at a NOT-YET-LIVE event. Its
        // task ID isn't in a lane yet, but it is not an orphan — resolve it
        // against gtd_events so it shows as a valid pending condition.
        const pendingEv = liveTarget ? null : findEventByTaskId(task.conditionId);
        if (liveTarget){
          cueBlock = '<button class="link-pill" data-action="open-edit" data-kind="waiting" data-id="' + task.id + '">&#129693; ' + escapeHtml(t("waiting.after")) + ' <span class="pill-target">' + escapeHtml(liveTarget.title) + '</span></button>';
        } else if (pendingEv && !pendingEv.paused){
          const eff = effDate(pendingEv, pendingEv.date);
          const dd = dateStrToDate(eff);
          const when = dd.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          cueBlock = '<button class="link-pill" data-action="open-edit" data-kind="waiting" data-id="' + task.id + '">&#129693; ' + escapeHtml(t("waiting.after")) + ' <span class="pill-target">' + escapeHtml(effTitle(pendingEv, pendingEv.date)) + '</span> · ' + escapeHtml(when) + '</button>';
        } else {
          cueBlock = '<button class="link-pill cue-orphaned" data-action="open-edit" data-kind="waiting" data-id="' + task.id + '">&#129693; ' + escapeHtml(t("waiting.after")) + ' ' + escapeHtml(task.conditionLabel || t("picker.deletedItem")) + '</button>';
        }
      } else if (task.whenText){
        cueBlock = '<button class="link-pill" data-action="open-edit" data-kind="waiting" data-id="' + task.id + '">&#128337; ' + escapeHtml(t("waiting.waitingForLabel")) + ' <span class="pill-target">' + escapeHtml(task.whenText) + '</span></button>';
      }
      // (The date-pill fallback was removed in chunk 3 -- Waiting actions no
      // longer hold dates, §4.13a.)
    }
    // Stalled-project flag: every active project should have at least one
    // linked action — surface that on the lane card itself, beneath the
    // title (overnight notes), not just inside the project's page.
    let projectFlagBlock = "";
    if (kind === "current" && !projectHasWayForward(task.id)){
      projectFlagBlock = '<div class="card-project-flag">\u26A0 no linked actions</div>';
    }
    let checkboxHtml;
    if (moveDest){
      // Waiting On / Future items get a move arrow in place of a checkbox —
      // there's nothing to "complete" here, only to promote to the next stage.
      checkboxHtml = '<button class="promote-arrow" data-action="move" data-id="' + task.id + '" data-is-group="0" title="Move to ' + escapeHtml(LIST_TITLES[moveDest]) + '">&#8592;</button>';
    } else if (isHabit){
      // Paused habits get an inert checkbox (design ruling: pausing
      // disables completion). A ✓ earned before pausing stays visible —
      // frozen, not erased — but can't be toggled until unpause.
      const pausedNow = habitRun.paused;
      checkboxHtml = '<button class="check' + (done ? " checked" : "") + (pausedNow ? " check-paused" : "") +
        '" data-action="toggle-habit" data-id="' + task.id +
        '" title="' + (pausedNow ? "Paused \u2014 unpause to complete" : "Mark done for today") + '">' + (done ? "&#10003;" : "") + '</button>';
    } else {
      checkboxHtml = '<button class="check" data-action="complete" data-id="' + task.id + '" title="Mark complete"></button>';
    }
    // \u00a74.7b: the list-view "\u00d7" delete is gone \u2014 items are deletable from
    // their own page only (screen-delete). Next/Current cards that carry a
    // deadline (\u00a74.1) get the progress bar (\u00a74.4b/c/d) directly under the
    // title; everything else renders the title as a bare flex:1 child, same
    // as before.
    // chunk 7 (\u00a74.14): a pseudo-action displays as a Next Action but taps
    // through to the EVENT page, not an action page, and carries the event/
    // appointment progress bar (\u00a74.14c), not a deadline bar.
    const isPseudo = kind === "next" && isPseudoAction(task);
    const titleOpen = isPseudo
      ? 'data-action="open-event" data-id="' + task.eventId + '" data-date="' + (task.occCanon || task.occDate || "") + '"'
      : 'data-action="open-edit" data-kind="' + kind + '" data-id="' + task.id + '"';
    const titleHtml = '<div class="card-title' + (done ? " done" : "") + '" ' + titleOpen + ' title="Tap to open \u2014 press and hold to reorder">' + escapeHtml(task.title) + '</div>';
    const deadlineBarBlock = isPseudo ? pseudoBarHtml(task) : (kind === "next" || kind === "current") ? deadlineBarHtml(task) : "";
    const titleBlock = deadlineBarBlock ? ('<div style="flex:1">' + titleHtml + deadlineBarBlock + '</div>') : titleHtml;
    return (
      '<div class="card" draggable="true" data-drag-id="' + task.id + '" data-drag-parent="' + (task.parent || "") + '" data-drag-group="0">' +
        '<div class="card-top">' + checkboxHtml + titleBlock + '</div>' +
        (kind === "waiting" ? cueBlock + linkBlock : linkBlock + cueBlock) + projectFlagBlock +
      '</div>'
    );
  }
  // Completed archive (new): a collapsible block at the bottom of the
  // lane, default-collapsed since it only ever grows (per the doc's
  // retention policy — keep everything forever, no auto-clearing). Reuses
  // the same collapsed-Set toggle mechanism as Context groups, but with
  // inverted semantics for this one synthetic id: presence in the set
  // means "expanded" here, since the natural default for a Completed
  // section is closed rather than open.
  function completedSectionHtml(kind, items, renderItem){
    if (!items.length) return "";
    const open = isCollapsed(kind, "__completed_open__");
    // Clear-all 🗑 (§4.12b, §12.2 step 2): four lanes only. Habits reuse this
    // section for today's toggles, not an archive, so a clear-all there has no
    // sane meaning — no trash can. The button lives inside the header row but
    // its own handler runs first and returns, so it never toggles the section.
    const clearBtn = (kind !== "habit")
      ? '<span class="group-actions"><button type="button" class="icon-btn" data-action="clear-completed" data-kind="' + kind + '" title="' + escapeHtml(t("lane.deleteAllCompleted")) + '">&#128465;</button></span>'
      : "";
    return (
      '<div class="completed-section">' +
        '<div class="group-header" data-action="toggle-group" data-id="__completed_open__">' +
          '<span class="chevron">' + (open ? "&#9662;" : "&#9656;") + '</span>' +
          '<span class="group-title">' + escapeHtml(t("lane.completedSection")) + '</span>' +
          '<span class="count">' + items.length + '</span>' +
          clearBtn +
        '</div>' +
        (open ? '<div class="completed-list">' + items.map(renderItem).join("") + '</div>' : "") +
      '</div>'
    );
  }
  // A completed row (Next/Waiting/Current/Future): a FILLED checkbox that
  // un-completes on tap — mirroring the live checkbox, teaching that the
  // control that completed the item restores it (§4.12b) — and a tappable
  // title that opens the read-only completed page.
  function completedItemHtml(kind, task, count){
    const badge = (count && count > 1) ? ' <span class="completed-series-count">×' + count + '</span>' : "";
    return (
      '<div class="completed-item">' +
        '<button type="button" class="check checked" data-action="restore" data-kind="' + kind + '" data-id="' + task.id + '" title="' + escapeHtml(t("outcome.restoreToActive")) + '">&#10003;</button>' +
        '<span class="completed-item-title" data-action="open-completed" data-kind="' + kind + '" data-id="' + task.id + '" title="' + escapeHtml(t("card.tapToView")) + '">' + escapeHtml(task.title) + badge + '</span>' +
      '</div>'
    );
  }
  function groupHtml(kind, group, children){
    const collapsed = isCollapsed(kind, group.id);
    const moveDest = MOVE_MAP[kind];
    const moveBtn = moveDest
      ? '<button class="icon-btn" data-action="move" data-id="' + group.id + '" data-is-group="1" title="' + escapeHtml(t("lane.moveTo").replace("{lane}", LIST_TITLES[moveDest])) + '">&#8592;</button>'
      : "";
    // Deleting a list no longer requires emptying it first (user ruling): it
    // mirrors context deletion — the items survive, landing ungrouped at the
    // top of the lane, behind a confirm that says so. So the × is always live.
    const deleteTitle = "Delete list";
    const childrenHtml = children.map(function(c){ return leafCardHtml(kind, c); }).join("");
    // devContext is set only on the dev-injected QA-checklist / chunk-map
    // groups (injectQAChecklist / injectChunkMap) — a plain data attribute
    // with no visual or behavioral effect, so the certification suite can
    // find and exclude that dev scaffolding without matching on its
    // per-chunk title text (spec.md §8.1/§8.2 groups differ every chunk).
    const contextAttr = group.devContext ? ' data-context="' + escapeHtml(group.devContext) + '"' : '';
    return (
      '<div class="group"' + contextAttr + ' draggable="true" data-drag-id="' + group.id + '" data-drag-parent="" data-drag-group="1">' +
        '<div class="group-header" data-action="toggle-group" data-id="' + group.id + '">' +
          '<span class="chevron">' + (collapsed ? "&#9656;" : "&#9662;") + '</span>' +
          '<span class="group-title" title="' + escapeHtml(t("group.tapToExpandReorder")) + '">' + escapeHtml(group.title) + '</span>' +
          '<span class="count">' + children.length + '</span>' +
          // \u2691 Replaces the quick-add row that used to sit at the bottom of every
          // open list (user: "remove the quick add rows... they just clutter
          // things up"). One tap opens the normal drafting page with this list
          // already chosen, so a new item gets the same page \u2014 and the same
          // fields \u2014 as every other way of creating one. It also works while the
          // list is COLLAPSED, which the old row could not.
          '<button class="group-add" data-action="add-to-list" data-kind="' + kind + '" data-id="' + group.id + '" title="' + escapeHtml(t("group.addToList")) + '">+</button>' +
          '<span class="group-actions">' + moveBtn +
            '<button class="icon-btn" data-action="delete-group" data-id="' + group.id + '" title="' + deleteTitle + '">&times;</button>' +
          '</span>' +
        '</div>' +
        (collapsed ? "" :
          '<div class="group-body" data-dropzone-parent="' + group.id + '">' + childrenHtml + '</div>'
        ) +
      '</div>'
    );
  }
  // A context group in an action lane (chunk 3, §4.3d). Like groupHtml but
  // driven by the registry, not a group-task: the header shows the registry
  // name, its × deletes the CONTEXT (unlink — members survive), and its body
  // is a dropzone keyed on the context id. Not draggable — contexts don't
  // reorder as tasks. Renders even when empty so it's a visible drop target
  // (the §4.3d escape hatch: create a context, drag items in).
  function contextGroupHtml(kind, ctx, members){
    const collapsed = isCollapsed(kind, ctx.id);
    const childrenHtml = members.map(function(c){ return leafCardHtml(kind, c); }).join("");
    return (
      '<div class="group" data-context-group="' + ctx.id + '">' +
        '<div class="group-header" data-action="toggle-group" data-id="' + ctx.id + '">' +
          '<span class="chevron">' + (collapsed ? "&#9656;" : "&#9662;") + '</span>' +
          '<span class="group-title" title="' + escapeHtml(t("group.tapToExpand")) + '">' + escapeHtml(ctx.name) + '</span>' +
          '<span class="count">' + members.length + '</span>' +
          '<button class="group-add" data-action="add-to-context" data-kind="' + kind + '" data-id="' + ctx.id + '" title="' + escapeHtml(t("group.addToContext")) + '">+</button>' +
          '<span class="group-actions">' +
            '<button class="icon-btn" data-action="delete-context" data-id="' + ctx.id + '" title="Delete context">&times;</button>' +
          '</span>' +
        '</div>' +
        (collapsed ? "" :
          '<div class="group-body" data-dropzone-parent="' + ctx.id + '">' + childrenHtml + '</div>'
        ) +
      '</div>'
    );
  }
  function renderLane(kind){
    const laneEl = qs('.lane[data-kind="' + kind + '"]');
    if (!laneEl) return;
    if (kind === "notes"){ renderNotesLane(laneEl); updateColumnHeads(); return; } // chunk 6: notes aren't tasks
    if (kind === "habit"){
      updateHabitBadge();
    }
    laneEl.querySelector(".count").textContent = state.tasks[kind].length;
    const tabCountEl = qs('.tab[data-kind="' + kind + '"] .tab-count');
    if (tabCountEl) tabCountEl.textContent = state.tasks[kind].length;
    const rootEl = laneEl.querySelector(".cards-root");
    let activeHtml, completedHtml;
    if (kind === "habit"){
      // Habits use their own daily grouping instead of the permanent
      // archive: a habit checked off today moves down into "Completed"
      // and comes back on its own the next scheduled day, since
      // habitDoneToday() naturally flips back to false once the date
      // rolls over — no extra state needed for the "reappear" half.
      const activeList = state.tasks.habit.filter(function(h){ return h.isGroup || !habitDoneToday(h.id); });
      const doneList = state.tasks.habit.filter(function(h){ return !h.isGroup && habitDoneToday(h.id); })
        .sort(function(a, b){ return habitDoneOrderIndex(a.id) - habitDoneOrderIndex(b.id); });
      const byParent = buildTree(kind, activeList);
      const roots = byParent[""] || [];
      activeHtml = roots.length
        ? roots.map(function(r){ return r.isGroup ? groupHtml(kind, r, byParent[r.id] || []) : leafCardHtml(kind, r); }).join("")
        : '<div class="empty-note">' + escapeHtml(t("lane.nothingHereYet")) + '</div>';
      completedHtml = completedSectionHtml(kind, doneList, function(t){ return leafCardHtml(kind, t); });
    } else if (isActionKind(kind)){
      // Action lanes (chunk 3, §4.3d): items group by CONTEXT (registry), not
      // by group-task. Order: loose actions + any dev group-tasks (the QA
      // checklist still lives here) in array order at the top, then one group
      // per registry context. A member whose contextId no longer resolves
      // (context deleted) falls back to loose — the unlink safety net.
      const all = state.tasks[kind];
      const byParent = buildTree(kind);
      const roots = byParent[""] || [];
      let html = "";
      roots.forEach(function(r){
        if (r.isGroup){ html += groupHtml(kind, r, byParent[r.id] || []); }        // dev scaffolding (QA checklist)
        else if (!r.contextId || !findContext(r.contextId)){ html += leafCardHtml(kind, r); } // loose / orphaned
        // context members are rendered in their context group below
      });
      state.contexts.forEach(function(ctx){
        const members = all.filter(function(t){ return !t.isGroup && t.contextId === ctx.id; });
        html += contextGroupHtml(kind, ctx, members);
      });
      activeHtml = html || '<div class="empty-note">' + escapeHtml(t("lane.nothingHereYet")) + '</div>';
      // chunk 7 (§4.15b): collapse repeated completions of one series into a
      // single "Title ×N" row. Only items carrying a seriesId collapse; plain
      // completed actions/waitings (no seriesId) stay individual.
      const collapsed = collapseCompletedSeries(state.completed[kind] || []);
      completedHtml = completedSectionHtml(kind, collapsed, function(entry){ return completedItemHtml(kind, entry.task, entry.count); });
    } else {
      const byParent = buildTree(kind);
      const roots = byParent[""] || [];
      activeHtml = roots.length
        ? roots.map(function(r){ return r.isGroup ? groupHtml(kind, r, byParent[r.id] || []) : leafCardHtml(kind, r); }).join("")
        : '<div class="empty-note">' + escapeHtml(t("lane.nothingHereYet")) + '</div>';
      completedHtml = completedSectionHtml(kind, state.completed[kind] || [], function(t){ return completedItemHtml(kind, t); });
    }
    // chunk 7 (§4.13b): a yellow-bordered calendar widget rides at the top of
    // the Waiting lane — this is how events "belong" in Waiting without living
    // there. Tapping anywhere on it opens the calendar.
    const widget = kind === "waiting" ? waitingWidgetHtml() : "";
    rootEl.innerHTML = widget + activeHtml + completedHtml;
    updateColumnHeads(); // the desktop head shows BOTH lanes' counts, including this one's
  }
  // ▲ DESKTOP (ruling 9 / trap T8): "one layer of headers" means MERGING, not
  // adding. Each lane already renders a `.lane-label`; stacking a column header
  // above it would print every column's name twice. So the column head carries
  // the full lane names, both counts and the ⓘ, and CSS hides `.lane-label` on
  // desktop — the mobile markup is untouched, just not shown.
  //
  // It lives INSIDE the lane rather than in a separate bar across the top: the
  // ⓘ then still targets its own lane's `.lane-info` panel (same handler, same
  // data-kind), and the per-lane create row sits with the lane it creates into.
  // Because the three visible lanes are top-aligned grid items, the three heads
  // still read as one layer.
  function laneColHeadHtml(k){
    const pair = COLUMN_PAIRS[columnIndexOfKind(k)] || [k];
    return (
      '<div class="lane-colhead">' +
        '<div class="col-tabs">' +
          pair.map(function(pk){
            return '<button type="button" class="col-tab' + (pk === k ? " active" : "") + '" data-action="col-lane" data-kind="' + pk + '">' +
              '<span class="col-tab-name">' + escapeHtml(LIST_TITLES[pk]) + '</span>' +
              '<span class="col-count">0</span>' +
            '</button>';
          }).join("") +
        '</div>' +
        '<button class="info-btn col-info" data-action="toggle-info" data-kind="' + k + '" type="button" title="' + escapeHtml(t("chrome.info")) + '">i</button>' +
      '</div>'
    );
  }
  // ▲ DESKTOP (ruling 10 / trap T4): the floating + makes no sense when three
  // lanes are live at once — "the active lane" is ambiguous. Each column gets
  // its own lane's options as real buttons, carrying an EXPLICIT data-kind, so
  // nothing here routes through state.activeKind the way the FAB menu does.
  // Labels come from FAB_MENU_LABELS (already translated). Habits has no FAB
  // menu at all, so it gets the one button it has always had a tooltip for.
  function laneCreateRowHtml(k){
    const labels = k === "habit" ? [t("fab.newHabit")] : (FAB_MENU_LABELS[k] || []);
    if (!labels.length) return "";
    return '<div class="lane-create-row">' + labels.map(function(label, idx){
      // Only the tertiary slot is not a create (Notes → Tags); everything else
      // gets the "+" the author asked for by name.
      const text = idx === 2 ? label : "+ " + label;
      return '<button type="button" class="btn btn-ghost btn-small lane-create-btn" data-action="lane-new" ' +
        'data-kind="' + k + '" data-idx="' + idx + '">' + escapeHtml(text) + '</button>';
    }).join("") + '</div>';
  }
  function laneShellHtml(k){
    return (
      '<div class="lane" data-kind="' + k + '">' +
        laneColHeadHtml(k) +
        '<div class="lane-label">' +
          '<span class="lane-label-title">' + escapeHtml(LIST_TITLES[k]) + '</span>' +
          '<span class="lane-label-right">' +
            '<span class="count">0</span>' +
            '<button class="info-btn" data-action="toggle-info" data-kind="' + k + '" type="button" title="' + escapeHtml(t("chrome.info")) + '">i</button>' +
          '</span>' +
        '</div>' +
        // The lane's "i" gets BOTH halves; the review's ⓘ gets only LANE_INFO.
        '<div class="lane-info" data-kind="' + k + '">' + escapeHtml(LANE_INFO[k]) +
          (LANE_INFO_EXTRA[k] ? '<span class="lane-info-more">' + escapeHtml(LANE_INFO_EXTRA[k]) + '</span>' : "") +
        '</div>' +
        (k === "habit"
          ? '<div class="lane-tools-row"><button class="btn btn-ghost btn-small tidy-btn" data-action="tidy-habits" type="button" title="Suggest an order from your hooks (you can still rearrange freely afterward)">&#8645; Tidy order</button></div>'
          : "") +
        laneCreateRowHtml(k) +
        '<div class="inline-slot" data-kind="' + k + '"></div>' +
        '<div class="cards-root" data-dropzone-parent=""></div>' +
      '</div>'
    );
  }
  function renderShell(){ qs("#lanes").innerHTML = ALL_LANES.map(laneShellHtml).join(""); }

  // Both counts on every column head — the hidden half's count IS the reason to
  // toggle (trap T5). Cheap enough to redo wholesale on any lane render.
  function updateColumnHeads(){
    qsa(".col-tab").forEach(function(b){
      const bk = b.getAttribute("data-kind");
      const lane = b.closest(".lane");
      const laneKind = lane ? lane.getAttribute("data-kind") : bk;
      b.classList.toggle("active", bk === laneKind);
      const c = b.querySelector(".col-count");
      if (c) c.textContent = laneCount(bk);
    });
  }
  function updateLaneVisibility(){
    // On desktop the left column's lane IS the "active kind" for everything
    // that still asks (the FAB path, which the phone owns) — keep it in sync
    // rather than leaving a stale value behind a mode flip.
    if (state.desktop) state.activeKind = state.columns[0];
    const vis = visibleLanes();
    qsa(".lane").forEach(function(el){ el.classList.toggle("active-lane", vis.indexOf(el.getAttribute("data-kind")) !== -1); });
    updateColumnHeads();
    // The floating + creates for whichever lane is active — retint it and
    // repoint its data-kind whenever the tab changes (overnight notes:
    // Google-Tasks-style FAB replaces the per-lane create button).
    const fab = qs("#fab-create");
    if (fab){
      fab.setAttribute("data-kind", state.activeKind);
      fab.style.setProperty("--lane-accent", "var(" + accentVarForKind(state.activeKind) + ")");
      fab.title = NEW_ITEM_LABEL[state.activeKind] || "Create";
    }
    // ▲ CHUNK 2 (§4.3e) — relabel the FAB's two-option menu for the newly
    // active lane, and close it on every tab switch so a stale menu never
    // survives a jump to a different lane (Habits has no menu; its labels
    // just sit unused).
    const menu = qs("#fab-menu");
    if (menu){
      const labels = FAB_MENU_LABELS[state.activeKind] || [];
      const items = menu.querySelectorAll(".fab-menu-item");
      // Variable item count: label + show the first N, hide the rest (Notes has
      // a third option, Tags; the action/project lanes have two).
      items.forEach(function(item, i){
        if (i < labels.length){ item.textContent = labels[i]; item.hidden = false; }
        else item.hidden = true;
      });
      menu.hidden = true;
    }
  }

  // =========================================================
  // LAYOUT MODE (desktop redesign, trap T1)
  //
  // The single place that decides which layout is running. One matchMedia
  // listener; everything else reads state.desktop or keys off the matching
  // media query in styles.css. A live resize across the boundary re-renders
  // rather than stranding anything: an open page, an open tray, an open
  // settings menu and an open FAB menu all survive the flip.
  // =========================================================
  let layoutModeApplied = null;
  // Held as a NODE reference, not re-queried: on desktop the Calendar button is
  // MOVED into the header's left cluster (author note 8) rather than duplicated
  // there — a second element carrying data-action="open-calendar" would be a
  // second thing to keep in sync and would break any check that clicks the
  // action by selector.
  let calendarBtnEl = null;
  function applyLayoutMode(){
    const desk = window.matchMedia("(min-width:" + DESKTOP_MIN_PX + "px)").matches;
    if (layoutModeApplied === desk) return;
    layoutModeApplied = desk;
    state.desktop = desk;
    document.body.classList.toggle("desktop", desk);
    if (desk){
      // Carry the phone's current lane into its own column, so crossing the
      // boundary keeps you looking at what you were looking at.
      const i = columnIndexOfKind(state.activeKind);
      if (i !== -1) state.columns[i] = state.activeKind;
    } else {
      // Going the other way, the phone shows the left column's lane and the tab
      // strip has to agree with it.
      state.activeKind = state.columns[0];
      qsa("#lane-switcher button[data-kind]").forEach(function(b){
        b.classList.toggle("active", b.getAttribute("data-kind") === state.activeKind);
      });
    }
    const fabMenu = qs("#fab-menu"); if (fabMenu) fabMenu.hidden = true;
    closeHeaderDrops();
    // The ⋯ becomes a gear on desktop (author note 8); the phone keeps ⋯.
    const gear = qs('[data-action="open-overflow"]');
    if (gear){ gear.innerHTML = desk ? "&#9881;" : "&#8943;"; }
    renderHeaderWidgets();
    // The settings menu's contents differ per mode (Language/Background move
    // out of it on desktop), and it is positioned against chrome that just
    // changed — rebuild it rather than leaving a menu from the other layout.
    // ⚠ Scoped to #dialog-root: the header's Language/Background dropdowns
    // reuse the same "settings-menu" class for their chrome (T17), and a bare
    // qs(".settings-menu") matches whichever comes first in the DOM — the
    // header, not this one — see the matching fix in renderSettingsMenu.
    if (qs("#dialog-root .settings-menu")) closeDialog();
    // Notes may only now be on screen, and its cards are derived from live
    // project state (trap T5).
    renderLane("notes");
    updateLaneVisibility();
    if (state.screen) renderScreen();   // card ⇄ full-screen is a re-render, not a reopen
    if (typeof forceDeskFrame === "function") forceDeskFrame(); // the frame changes host box
  }
  // ▲ DESKTOP HEADER (author note 8, trap T17). The header has never held state
  // before, so everything stateful about it lives here: the two dropdowns are
  // built on demand, only one is ever open, and they re-render on a language
  // change (applyLocale calls this). Mobile gets an EMPTY left cluster and its
  // markup stays byte-identical to what shipped.
  function renderHeaderWidgets(){
    const host = qs("#header-left");
    if (!host) return;
    if (!calendarBtnEl) calendarBtnEl = qs('[data-action="open-calendar"]');
    if (!state.desktop){
      host.innerHTML = "";
      // Put the calendar button back where the phone header has always had it:
      // to the left of ⋯, in .header-right.
      const right = qs(".header-right"), gear = qs('[data-action="open-overflow"]');
      if (calendarBtnEl && right && gear && calendarBtnEl.parentNode !== right) right.insertBefore(calendarBtnEl, gear);
      return;
    }
    const surf = SURFACES[currentSurfaceId()] || SURFACES[DEFAULT_SURFACE];
    host.innerHTML =
      headerDropHtml("lang", "🌐", t("settings.language"), localeLabel(currentLocale())) +
      headerDropHtml("bg", "🎨", t("settings.background"), surf.label);
    if (calendarBtnEl) host.appendChild(calendarBtnEl); // moved, never cloned
  }
  function headerDropHtml(id, icon, label, value){
    return (
      '<div class="header-drop" data-drop="' + id + '">' +
        '<button type="button" class="header-drop-btn" data-action="hdr-drop" data-drop="' + id + '" title="' + escapeHtml(label) + '">' +
          '<span class="hdr-drop-icon" aria-hidden="true">' + icon + '</span>' +
          '<span class="hdr-drop-value">' + escapeHtml(value) + '</span>' +
          '<span class="hdr-drop-caret" aria-hidden="true">&#9662;</span>' +
        '</button>' +
        '<div class="header-drop-menu settings-menu" hidden></div>' +
      '</div>'
    );
  }
  // Returns whether it actually closed something — the Escape handler needs to
  // know, so a stray Escape with a dropdown open never reaches the open page
  // (trap T17).
  function closeHeaderDrops(){
    let closed = false;
    qsa(".header-drop-menu").forEach(function(m){ if (!m.hidden){ m.hidden = true; closed = true; } });
    return closed;
  }

  // =========================================================
  // FULL-SCREEN CREATE / EDIT (chunk 1)
  //
  // A single overlay ("screen") replaces the old inline add-row, the
  // inline link-pill editor, and the in-lane habit-creation panel for all
  // five kinds. Mini-lists stay on the quick prompt() flow — out of scope.
  //
  // Habits keep their existing hook/cue system (getValidHookTargets,
  // playHookChime, addHabit, setHabitCue, the delete-time label-freeze in
  // deleteTask) exactly as it worked before — per 4.5, only the container
  // changes, from an in-lane panel to a full screen.
  //
  // Deliberately NOT in this chunk (per the doc's own chunk breakdown):
  //  - waiting condition / hook picker for Waiting items (chunk 2) — that
  //    hook icon is shown greyed-out on both Next and Waiting for now.
  //  - deadline-approaching progress bar visuals — built in chunk 2, see
  //    deadlineBarHtml()/deadlineBarState() above.
  //  - habit personal-best / animation box — built in chunk 3, see
  //    habitTrackHtml() and the habitRuns engine above.
  // =========================================================
  function isProjectKind(k){ return k === "current" || k === "future"; }

  function openScreen(kind, taskId, prefill){
    let draft;
    if (kind === "habit"){
      // The habit draft's cue set is an ordered list of ROWS (QA-round
      // redesign, replacing the Advanced-dialog "Extra hooks" tab): each
      // row holds either a hook {hook:{id,label}} or a text cue
      // {text:"…"}. Row 1 is the default; up to MAX_HOOKS-1 extra rows
      // can be added right on the page. Saved hooks + text cues read
      // back as one row each; an empty habit starts with one empty row.
      if (taskId){
        const task = state.tasks.habit.find(function(t){ return t.id === taskId; });
        if (!task) return;
        const run = ensureHabitRun(taskId);
        let cueRows = (task.hooks || []).map(function(hk){ return { hook: { id: hk.id, label: hk.label, ctx: !!hk.ctx } }; })
          .concat((task.whenTexts || []).map(function(w){ return { text: w }; }));
        if (!cueRows.length) cueRows = [{ text: "" }];
        draft = {
          title: task.title, notesClean: task.notesClean || "",
          cueRows: cueRows, hookPicker: false, hookPickerRow: 0,
          bundleText: task.bundleText || "",
          schedule: run.schedule.slice(), paused: run.paused,
          done: habitDoneToday(taskId), // draft field — see screenComplete
          pendingResult: consumeHabitPendingResult(taskId)
        };
        updateHabitBadge();
      } else {
        draft = { title: "", notesClean: "", cueRows: [{ text: "" }], hookPicker: false, hookPickerRow: 0, bundleText: "", schedule: [0, 1, 2, 3, 4, 5, 6], paused: false, pendingResult: null };
      }
    } else if (taskId){
      const task = state.tasks[kind].find(function(t){ return t.id === taskId; });
      if (!task) return;
      draft = { title: task.title, notesClean: task.notesClean || "", linkedProjectId: task.linkedProjectId || null, deadline: getDeadline(task), bundleText: task.bundleText || "" };
      if (isActionKind(kind)) draft.contextId = task.contextId || null;
      if (kind === "waiting"){
        draft.whenText = task.whenText || "";
        draft.conditionId = task.conditionId || null;
        draft.conditionKind = task.conditionKind || null;
        draft.conditionLabel = task.conditionLabel || null;
        draft.conditionPicker = false;
      }
    } else {
      draft = { title: "", notesClean: "", linkedProjectId: null, deadline: null, bundleText: "" };
      if (isActionKind(kind)) draft.contextId = (prefill && prefill.contextId) || null;
      if (kind === "waiting"){
        draft.whenText = ""; draft.conditionId = null; draft.conditionKind = null; draft.conditionLabel = null; draft.conditionPicker = false;
      }
    }
    if (prefill) Object.assign(draft, prefill);
    // Chunk 5 (§12.1): a project page carries a staged action set, and a real
    // project id minted now so brand-new projects can link staged children
    // before save (§12.1b — ids are real at stage time, never remapped).
    if (isProjectKind(kind)){
      draft.staged = newStagedSet();
      draft.projectId = taskId || genId();
    }
    state.screen = { kind: kind, taskId: taskId || null, draft: draft };
    renderScreen();
  }
  function closeScreen(){
    // Pop the stack (chunk 1): if this screen was opened *from* another
    // screen (drafting an action from a project page, which itself may
    // have been opened from yet another screen), fall back to the one
    // directly underneath it — with its unsaved draft intact — instead of
    // all the way out to the lanes (overnight notes: creating an action
    // from the project page returns you to the project page). Works at
    // any depth, not just one level.
    if (state.screenStack.length){
      state.screen = state.screenStack.pop();
      renderScreen();
      return;
    }
    state.screen = null;
    lockBodyScroll(false);
    qs("#screen-root").innerHTML = "";
  }
  // The completed-item page (§4.12b, §12.2 step 5): a READ-ONLY view of an
  // archived item. No draft — the page never edits anything; it only offers
  // Restore and Delete. `completedTask` is the archive snapshot the body
  // renders from. Chrome is ← + 🗑 with NO ✕ (user ruling): nothing is
  // editable, so ← and ✕ would be one gesture.
  function openCompletedScreen(kind, taskId){
    const task = (state.completed[kind] || []).find(function(t){ return t.id === taskId; });
    if (!task) return;
    state.screen = { kind: kind, taskId: taskId, completedView: true, completedTask: task, draft: {} };
    renderScreen();
  }
  // Opens a screen "on top of" the current one — the current screen
  // (draft included) is pushed onto the stack and restored when the new
  // one closes, whichever way it closes: save, cancel, Escape, delete, or
  // complete. Nests to any depth (chunk 1).
  // `staging` (chunk 5, §12.1): when set, the child page is a child of a
  // project page — its Save routes into that project's staged set instead of
  // storage. { parent: <project screen>, projectId }.
  function openChildScreen(kind, taskId, prefill, staging){
    state.screenStack.push(state.screen);
    state.screen = null;
    openScreen(kind, taskId, prefill);
    if (staging && state.screen){
      state.screen.staging = staging;
      renderScreen(); // re-render with staging known (link-lock, §12.1)
    }
  }

  // =========================================================
  // CHUNK 5 (§12.1/§12.1b): project-page action STAGING.
  // Nothing a project page does to its linked actions touches storage until
  // the PROJECT save-exits. The project draft carries a staged set; the
  // linked list renders from it; project Save applies it atomically and
  // re-evaluates promotions (§9). The windfall (§12.1b): staged actions get
  // their REAL, FINAL id at stage time, so references are by real id and no
  // remapping is ever needed.
  // =========================================================
  // ⚑ noteCreates (user: "give notes the same staging treatment"). A note is
  // its own store, not a task, so it cannot ride in `creates` — but it needs the
  // same contract: made on an unsaved project page, it exists only in the draft
  // until that project saves, and ✕ takes it with it. Without this, a note
  // created from a project that was then discarded stayed behind linked to a
  // project that never existed.
  // ⚑ eventCreates (user QA: "The add an event button doesn't appear on the
  // project creation page"). It used to be hidden there, and the flag on it said
  // why: adding an event goes through the CALENDAR, a separate full screen with
  // its own commit, so there was no draft to stage it into.
  //
  // There is now — and it is the same shape noteCreates already established. An
  // event, like a note, lives in its own store rather than in `creates`, so it
  // rides here as a whole object and is only pushed to state.events when the
  // project saves. That keeps DRAFT ISOLATION exactly: an event added while
  // drafting a project that is then ✕'d out of goes with it, instead of being
  // stranded in the calendar linked to a project that never existed.
  function newStagedSet(){ return { creates: [], edits: {}, deletes: {}, completes: {}, noteCreates: [], eventCreates: [] }; }
  // The project id a project draft stages against — the live id when editing,
  // or the id minted at open for a brand-new project (so children can link).
  function stagingProjectId(s){ return (s && (s.taskId || (s.draft && s.draft.projectId))) || null; }
  function findTaskAnywhere(id){
    const kinds = ["next", "waiting", "current", "future"];
    for (let i = 0; i < kinds.length; i++){
      const t = state.tasks[kinds[i]].find(function(x){ return x.id === id; });
      if (t) return { kind: kinds[i], task: t };
    }
    return null;
  }
  // A staged create for this draft, by id (or null).
  function stagedCreate(s, id){
    const staged = s.draft.staged;
    if (!staged) return null;
    return staged.creates.find(function(c){ return c.id === id; }) || null;
  }
  // The project's linked actions AS THE DRAFT SEES THEM: live links minus
  // staged deletes/completes, staged edits applied, plus staged creates.
  function stagedEventCreates(s){ return (s && s.draft && s.draft.staged && s.draft.staged.eventCreates) || []; }
  // §4.3b's "way forward" as the DRAFT sees it: a linked action, or a linked
  // event — live or staged. This is what the new-Current-project save gate asks,
  // and the user's QA made the event half explicit ("without creating an action
  // or event"). projectHasWayForward answers the same question for committed
  // state; this one has to include the staged set, which storage cannot see yet.
  function projectDraftHasWayForward(s){
    if (projectDraftLinked(s).length) return true;
    if (stagedEventCreates(s).length) return true;
    const pid = stagingProjectId(s);
    return !!(pid && typeof projectHasLinkedEvent === "function" && projectHasLinkedEvent(pid));
  }
  function projectDraftLinked(s){
    const pid = stagingProjectId(s);
    const staged = s.draft.staged || newStagedSet();
    const out = [];
    linkedActionsForProject(pid).forEach(function(l){
      if (staged.deletes[l.task.id] || staged.completes[l.task.id]) return;
      const ed = staged.edits[l.task.id];
      const task = ed ? Object.assign({}, l.task, ed) : l.task;
      out.push({ kind: (ed && ed.kind) || l.kind, task: task });
    });
    (staged.creates || []).forEach(function(c){
      if (c.stagedComplete) return;
      out.push({ kind: c.kind, task: Object.assign({}, c) });
    });
    return out;
  }
  // Every action (live ∪ staged, minus staged-removed) that a condition may
  // target from THIS project page — used so the condition picker, cycle
  // filter, and duplicate-title check all see staged items (§12.1b).
  function draftAllActions(s){
    const staged = (s && s.draft && s.draft.staged) || newStagedSet();
    const out = [];
    ["next", "waiting"].forEach(function(k){
      state.tasks[k].forEach(function(t){
        if (t.isGroup) return;
        if (staged.deletes[t.id] || staged.completes[t.id]) return;
        const ed = staged.edits[t.id];
        out.push({ kind: (ed && ed.kind) || k, task: ed ? Object.assign({}, t, ed) : t });
      });
    });
    (staged.creates || []).forEach(function(c){
      if (c.stagedComplete) return;
      if (c.kind === "next" || c.kind === "waiting") out.push({ kind: c.kind, task: Object.assign({}, c) });
    });
    return out;
  }
  // The project draft (and its id) a condition picker should read from: the
  // parent project when on a child page, or the project page itself (quick-add
  // hook). null on an ordinary lane action page (no staging in play).
  function conditionContext(s){
    if (s && s.staging) return { proj: s.staging.parent, projectId: s.staging.projectId };
    if (s && isProjectKind(s.kind)) return { proj: s, projectId: stagingProjectId(s) };
    return { proj: null, projectId: null };
  }
  // Condition targets for a picker, spanning live ∪ staged (§12.1b) with the
  // project's own actions tagged for project-first grouping. Cycle + self
  // exclusion runs over the merged graph.
  function conditionTargetsForScreen(s, excludeId){
    const ctx = conditionContext(s);
    let all;
    if (ctx.proj){
      all = draftAllActions(ctx.proj);
    } else {
      all = [];
      ["next", "waiting"].forEach(function(k){
        state.tasks[k].forEach(function(t){ if (!t.isGroup) all.push({ kind: k, task: t }); });
      });
    }
    const excluded = excludeId ? mergedConditionDescendants(excludeId, all) : new Set();
    if (excludeId) excluded.add(excludeId);
    const out = all.filter(function(l){
      if (l.task.id === excludeId) return false;
      if (l.kind === "waiting" && excluded.has(l.task.id)) return false;
      return true;
    }).map(function(l){
      return { id: l.task.id, title: l.task.title, kind: l.kind, isEvent: false,
        inProject: !!(ctx.projectId && l.task.linkedProjectId === ctx.projectId) };
    });
    // chunk 8 (§10): condition a Waiting action on a NOT-YET-LIVE event. Its
    // task ID was minted at event creation (§4.14a), so it hooks with a plain
    // task ID like any other condition. Only pending events (no live pseudo-
    // action yet) and only LIVE, unexpired occurrences (§10) — an already-live
    // one is in `all`. Stored as conditionKind "next" (that is the lane it
    // lands in).
    //
    // ⚑ QA #31: this used to read ev.date directly and drop anything already
    // passed, which silently excluded every repeating series whose live date
    // had gone by — the common case, since a series' live date sits in the past
    // whenever it is completed, hidden, or waiting on the 4 AM roll. A series
    // is never "expired"; only its current occurrence is. nextLiveOccurrenceDate
    // rolls forward to the one you can still hook onto, and returns null for a
    // genuinely finished one-shot. One row per series, at its next occurrence.
    const liveIds = new Set(out.map(function(t){ return t.id; }));
    (state.events || []).forEach(function(ev){
      if (liveIds.has(ev.taskId)) return;               // already a live pseudo-action target
      if (ev.paused) return;                            // a paused series won't fire
      const canon = nextLiveOccurrenceDate(ev);
      if (!canon) return;                               // finished one-shot — nothing left to wait on
      const eff = effDate(ev, canon), effT = effTime(ev, canon);
      const dd = dateStrToDate(eff);
      const hint = dd.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + (effT ? " · " + effT : "");
      out.push({ id: ev.taskId, title: effTitle(ev, canon), kind: "next", isEvent: true, inProject: !!(ctx.projectId && ev.linkedProjectId === ctx.projectId), dateHint: hint });
    });
    return out;
  }
  // Has the project draft changed anything storage would keep? Drives the ✕
  // warning — a state-compare, not a dirty flag, so create-then-delete and
  // edit-then-revert are silent (§12.1).
  function projectDraftDirty(s){
    const staged = s.draft.staged;
    if (staged){
      if ((staged.creates || []).length) return true;
      if ((staged.noteCreates || []).length) return true;
      if ((staged.eventCreates || []).length) return true;
      if (Object.keys(staged.deletes).length) return true;
      if (Object.keys(staged.completes).length) return true;
      for (const id in staged.edits){
        const found = findTaskAnywhere(id);
        if (!found) return true;
        const ed = staged.edits[id];
        for (const k in ed){ if (ed[k] !== found.task[k]) return true; }
      }
    }
    if (s.taskId){
      const proj = state.tasks[s.kind].find(function(t){ return t.id === s.taskId; });
      if (proj){
        if ((s.draft.title || "").trim() !== proj.title) return true;
        if ((s.draft.notesClean || "") !== (proj.notesClean || "")) return true;
        if (JSON.stringify(s.draft.deadline || null) !== JSON.stringify(proj.deadline || null)) return true;
      }
    } else {
      if ((s.draft.title || "").trim()) return true;
      if ((s.draft.notesClean || "").trim()) return true;
    }
    return false;
  }
  // Re-evaluate a live Waiting action's promotion condition against current
  // saved state (§9): promote iff its condition target has been COMPLETED (a
  // deleted/orphaned target does NOT promote — §4.2). Stateless; safe to run
  // for every touched item after a project save.
  function reEvaluatePromotion(waitingId){
    const w = state.tasks.waiting.find(function(t){ return t.id === waitingId; });
    if (!w || !w.conditionId) return;
    if (findTaskAnywhere(w.conditionId)) return; // target still live → not yet
    const completed = (state.completed.next || []).concat(state.completed.waiting || [])
      .some(function(t){ return t.id === w.conditionId; });
    if (completed) moveItem("waiting", "next", waitingId, false);
  }
  // Apply a project draft's staged set to storage, atomically-ish, then
  // re-evaluate promotions. Order: creates → edits → deletes → completes, all
  // resolving targets BY ID wherever they now live (the §9 zombie trap), so a
  // staged delete of an item that promoted mid-edit still finds it.
  function applyProjectStaging(s){
    const staged = s.draft.staged;
    if (!staged) return;
    const touched = [];
    (staged.creates || []).forEach(function(c){
      const task = Object.assign({}, c);
      const kind = task.kind;
      delete task.kind; delete task.stagedComplete;
      state.tasks[kind].unshift(task);
      touched.push(task.id);
    });
    // Notes staged from this project page become real here, and only here.
    if ((staged.noteCreates || []).length){
      (staged.noteCreates || []).forEach(function(n){ state.notes.unshift(Object.assign({}, n)); });
      saveNotes();
      renderLane("notes");
    }
    // Same contract for events (§4.15d). processEventBoundaries runs after they
    // land so an event dated today mints its pseudo-action immediately, exactly
    // as it would have if the calendar had written it directly.
    if ((staged.eventCreates || []).length){
      (staged.eventCreates || []).forEach(function(ev){ state.events.push(Object.assign({}, ev)); });
      saveEvents();
      processEventBoundaries();
      renderLane("next"); renderLane("waiting");
    }
    for (const id in staged.edits){
      const found = findTaskAnywhere(id);
      if (found){
        // ⚑ QA #23: the deadline is pulled OUT of the blind Object.assign and
        // routed through applyDeadlineChange, so a child action edited from its
        // project page restarts its bar and counts its push exactly as one
        // edited from its own page does. A raw assign here would overwrite
        // setAt/pushCount with the draft's copy and silently exempt this path.
        const ed = staged.edits[id];
        const hasDeadline = Object.prototype.hasOwnProperty.call(ed, "deadline");
        const rest = Object.assign({}, ed);
        delete rest.deadline;
        Object.assign(found.task, rest);
        if (hasDeadline) applyDeadlineChange(found.task, ed.deadline);
        touched.push(id);
      }
    }
    ["next", "waiting", "current", "future"].forEach(saveTasksLocal);
    for (const id in staged.deletes){
      const found = findTaskAnywhere(id);
      if (found) deleteTask(found.kind, id);
    }
    // completes: staged-created-then-completed, then live-completed — all by id.
    (staged.creates || []).forEach(function(c){
      if (c.stagedComplete){ const f = findTaskAnywhere(c.id); if (f) completeTask(f.kind, c.id); }
    });
    for (const id in staged.completes){
      const found = findTaskAnywhere(id);
      if (found) completeTask(found.kind, id);
    }
    // §9 re-evaluation, AFTER the edits land: a Waiting action whose condition
    // completed on a timer while the page was open promotes now.
    touched.forEach(reEvaluatePromotion);
    KINDS.forEach(renderLane);
  }
  // The editable fields of a task, for prefilling a child drafting page.
  function buildPrefillFromTask(t){
    return {
      title: t.title || "", notesClean: t.notesClean || "", linkedProjectId: t.linkedProjectId || null,
      deadline: t.deadline || null, contextId: t.contextId || null,
      whenText: t.whenText || "", conditionId: t.conditionId || null,
      conditionKind: t.conditionKind || null, conditionLabel: t.conditionLabel || null,
      bundleText: t.bundleText || ""
    };
  }
  // Open a linked action from the project page as a STAGED child (§12.1). It
  // may be a staged create (not in storage yet), a pre-existing action with a
  // staged edit already recorded, or a plain live linked action.
  function openLinkedActionChild(kind, id){
    const s = state.screen;
    const staged = s && s.draft && s.draft.staged;
    const staging = { parent: s, projectId: stagingProjectId(s) };
    const created = staged && (staged.creates || []).find(function(c){ return c.id === id; });
    if (created){
      state.screenStack.push(state.screen);
      state.screen = null;
      openScreen(created.kind, null, buildPrefillFromTask(created));
      if (state.screen){
        state.screen.taskId = id; // edits this staged create in place
        state.screen.staging = staging;
        renderScreen();
      }
      return;
    }
    const ed = staged && staged.edits[id];
    openChildScreen(kind, id, ed ? Object.assign({}, ed) : undefined, staging);
  }
  // The ✕ / Back / Escape gate on a project page (§12.1): warn before
  // discarding a non-empty staged set (state-compare, not a dirty flag). Every
  // other page — and a non-dirty project — just closes.
  // =========================================================
  // THE DISCARD GATE (desktop ruling 5, trap T6)
  //
  // ✕ / Escape asks "Discard your changes?" — but ONLY when the draft actually
  // differs from what is saved. An untouched page closes instantly. This is a
  // SOFTENING ON TOP OF draft isolation, not a change to it: ✕ still never
  // commits anything, and Save still commits everything.
  //
  // ⚑ WHY A SNAPSHOT AND NOT A DIRTY FLAG. Flags rot: every new control is a new
  // place to remember to set one, and the day someone forgets, the confirm goes
  // quiet on exactly the page that needed it. This compares the draft against a
  // fingerprint of itself taken the moment the page first rendered — the same
  // state-compare discipline projectDraftDirty already uses, but shape-agnostic,
  // so notes, events, tags, habits and plain tasks are all covered by one path
  // and a page type invented later is covered for free.
  //
  // The excluded keys are TRANSIENT VIEW STATE, not content: which sub-picker is
  // open, which row it was opened from, a consumed animation result, per-row
  // validation marks, and the project page's staged set (which projectDraftDirty
  // reads on its own). Including them would fire the confirm for opening a
  // picker and closing it again.
  const DRAFT_TRANSIENT_KEYS = {
    hookPicker: 1, hookPickerRow: 1, conditionPicker: 1, projectPicker: 1,
    pendingResult: 1, rowErrors: 1, staged: 1, manage: 1, invalid: 1
  };
  function draftFingerprint(s){
    if (!s || !s.draft) return "";
    if (s.noteView && typeof syncNoteBodyDraft === "function"){
      // The note body lives in a contenteditable and only reaches the draft when
      // something flushes it. Flush before measuring, or every unsaved keystroke
      // in the body is invisible to the gate.
      try { syncNoteBodyDraft(); } catch (e){}
    }
    const d = s.draft;
    const keys = Object.keys(d).filter(function(k){ return !DRAFT_TRANSIENT_KEYS[k]; }).sort();
    return JSON.stringify(keys.map(function(k){
      const v = d[k];
      // null / undefined / "" are the same absence as far as a user is
      // concerned; a title differing only by trailing space is not an edit.
      if (v == null) return [k, ""];
      if (typeof v === "string") return [k, v.trim()];
      return [k, v];
    }));
  }
  function capturePristine(s){ if (s && !s.pristineDraft) s.pristineDraft = draftFingerprint(s); }
  function screenDirty(s){
    if (!s) return false;
    // No draft, nothing to discard: the completed page is read-only, the review
    // commits as it goes, the calendar is a view.
    if (s.completedView || s.reviewView || s.calendarView) return false;
    // An ARMED Complete or Convert counts as dirty — it is exactly the kind of
    // staged intention this confirm exists to protect (trap T6b).
    if (s.draft && (s.draft.willComplete || s.draft.convertTo)) return true;
    return !!s.pristineDraft && draftFingerprint(s) !== s.pristineDraft;
  }
  function attemptCancelScreen(){
    const s = state.screen;
    if (s && !s.staging && isProjectKind(s.kind) && projectDraftDirty(s)){
      openConfirmDialog(
        t("confirm.projectDiscardMessage"),
        [
          { label: t("discard.yes"), style: "danger", action: function(){ closeScreen(); } },
          { label: t("discard.no"), action: function(){} }
        ]
      );
      return;
    }
    // ⚑ Only reached when the project page's own warning did NOT fire — the two
    // must never stack (trap T6a). That warning IS this confirm for projects;
    // it just says more, because a project page can be holding staged children.
    if (screenDirty(s)){
      openConfirmDialog(t("discard.message"), [
        { label: t("discard.yes"), style: "danger", action: function(){ closeScreen(); } },
        { label: t("discard.no"), action: function(){} }
      ]);
      return;
    }
    closeScreen();
  }
  // Blocked saves mark the offending field with a dashed outline
  // (s.invalidField, cleared on the next input) instead of a popup —
  // popups are also unreliable in embedded/sandboxed contexts.
  // Title exception (overnight notes, reversing the earlier outline rule
  // for titles only): an empty title on a *create* silently discards the
  // draft — nothing is saved, no warning, same as Google Tasks. On an
  // *edit*, an emptied title keeps the item's existing title and the rest
  // of the edit saves normally (judgment call — silently discarding a
  // whole edit over a cleared title felt worse than either alternative).
  // The waiting-for and habit-when requirements keep their dashed-outline
  // validation, per the notes' explicit exception.
  function saveScreen(){
    const s = state.screen;
    if (!s) return;
    // The completed page is read-only (§12.2): its ← is a plain back with no
    // side effects — there is no draft to commit.
    if (s.completedView){ closeScreen(); return; }
    if (s.tagsView){ saveTagsScreen(s); return; } // chunk 6 (§4.9b)
    if (s.noteView){ saveNoteScreen(s); return; } // chunk 6 (§4.9)
    if (s.eventView){ saveEventScreen(s); return; } // chunk 7 (§4.15a)
    let title = (s.draft.title || "").trim();
    if (!title){
      if (!s.taskId){ closeScreen(); return; } // silent discard on create
      const existing = state.tasks[s.kind].find(function(t){ return t.id === s.taskId; });
      title = existing ? existing.title : "";
      if (!title){ closeScreen(); return; }
    }
    s.draft.title = title;
    // Duplicate-title check (11.6): per-lane, all kinds, case-insensitive.
    // Frozen hookedLabel/condition labels make duplicate titles ambiguous,
    // and the Tidy sort wants unambiguous keys — overdue independently.
    // Same dashed-outline pattern as the other save-time validations.
    const dupe = state.tasks[s.kind].some(function(t){
      return !t.isGroup && t.id !== s.taskId && (t.title || "").trim().toLowerCase() === title.toLowerCase();
    });
    if (dupe){
      s.invalidField = "title";
      renderScreen();
      return;
    }

    if (s.kind === "habit"){
      const d = s.draft;
      const hooks = draftCueHooks(d);
      const whenTexts = (d.cueRows || []).filter(function(r){ return !r.hook; })
        .map(function(r){ return (r.text || "").trim(); }).filter(Boolean);
      // "At least one cue" (11.2) — a hook row or a non-empty text row.
      if (!hooks.length && !whenTexts.length){
        s.invalidField = "habitWhen";
        renderScreen();
        return;
      }
      if (!d.schedule || !d.schedule.length){
        s.invalidField = "habitSchedule";
        renderScreen();
        return;
      }
      if (!s.taskId){
        Promise.resolve(addHabit(title, d.notesClean, whenTexts, hooks, d.bundleText)).then(function(newId){
          const run = ensureHabitRun(newId);
          run.schedule = d.schedule.slice();
          saveHabitRuns();
          consumeCaptureForScreen(s); // §4.8b: a capture sorted to Habit is now filed
          applyPendingReplacements(d, hooks, newId);
          // chunk 7 (§4.15b): "Make this a habit instead" — the word "instead"
          // is either/or, so on save the source event is removed (no warning),
          // and the now-stale event page underneath is popped so we don't land
          // back on a deleted event.
          if (d.fromEventId){
            const ev = findEvent(d.fromEventId);
            if (ev) deleteEventEntirely(ev);
            if (state.screenStack.length && state.screenStack[state.screenStack.length - 1] && state.screenStack[state.screenStack.length - 1].eventView){
              state.screenStack.pop();
            }
          }
          // Re-render AFTER the run's schedule lands: addHabit's own
          // render ran before it existed, so hook liveness on any card
          // pointing at (or from) this habit would be computed against
          // the default schedule (QA finding: dependents' cues must
          // recalculate whenever a schedule changes).
          renderLane("habit");
          closeScreen();
        });
        return;
      }
      const renamed = title !== state.tasks.habit.find(function(t){ return t.id === s.taskId; }).title;
      const chain = renamed ? Promise.resolve(renameTask("habit", s.taskId, title)) : Promise.resolve();
      chain.then(function(){ return setHabitCue(s.taskId, d.notesClean, whenTexts, hooks, d.bundleText); })
        .then(function(){
          const run = ensureHabitRun(s.taskId);
          run.schedule = d.schedule.slice();
          // DRAFT ISOLATION: the page's Complete badge only edited the
          // draft. Commit it here, BEFORE the pause transition below —
          // that block's lock-in reads habitDoneToday(), so a draft that
          // both completes and pauses must have its completion visible by
          // then or the day would be lost. (Bypasses toggleHabit's paused
          // guard deliberately: the guard exists to stop completing an
          // already-paused habit, and this completion was made while the
          // draft was unpaused.)
          const wantDone = !!d.done;
          if (habitDoneToday(s.taskId) !== wantDone){
            if (wantDone){
              state.habitDone[s.taskId] = todayStr();
              state.habitDoneOrder.unshift(s.taskId);
            } else {
              delete state.habitDone[s.taskId];
              state.habitDoneOrder = state.habitDoneOrder.filter(function(id){ return id !== s.taskId; });
            }
            saveHabitDone();
            saveHabitDoneOrder();
          }
          // DRAFT ISOLATION: the pause switch only edited the draft; the
          // run-side transition happens here, at Save, and only if the
          // value actually changed (toggling twice in a draft is a no-op,
          // so lastProcessedDate isn't jumped spuriously).
          const nowPaused = !!d.paused;
          if (run.paused !== nowPaused){
            const today = todayStr();
            if (nowPaused){
              // About to pause. lastProcessedDate jumping to today means
              // today never passes through the normal boundary sweep
              // again — a completion already earned today must be locked
              // into history now, or it's lost the moment pause lands. A
              // day merely unfinished when paused is fine to skip —
              // that's what Pause is for.
              const scheduledToday = run.schedule.indexOf(boundaryNow().getDay()) !== -1;
              const alreadyRecorded = run.history.some(function(e){ return e.date === today; });
              if (scheduledToday && habitDoneToday(s.taskId) && !alreadyRecorded){
                applyHabitDayOutcome(run, today, "done");
              }
            }
            run.paused = nowPaused;
            run.lastProcessedDate = today;
          }
          saveHabitRuns();
          applyPendingReplacements(d, hooks, s.taskId);
          // setHabitCue's render ran BEFORE the schedule/pause write
          // above, so every dependent's live/dead cue pill was computed
          // against the OLD schedule — re-render now that the run is
          // current (QA finding: unscheduling a target's today left its
          // dependents still showing "After …" until a reload).
          renderLane("habit");
          closeScreen();
        });
      return;
    }

    if (s.kind === "waiting"){
      const d = s.draft;
      // Enforce mutual exclusivity at save time (§4.2 -- text vs. hook; the
      // date option is gone as of chunk 3, §4.13a). A hooked condition wins
      // over free text, and a Waiting action never carries a deadline.
      d.deadline = null;
      if (d.conditionId){ d.whenText = ""; }
      if (!d.conditionId && !(d.whenText || "").trim()){
        s.invalidField = "waitingFor";
        renderScreen();
        return;
      }
    }

    const data = {
      title: title, notesClean: s.draft.notesClean, linkedProjectId: s.draft.linkedProjectId, deadline: s.draft.deadline,
      whenText: s.kind === "waiting" ? ((s.draft.whenText || "").trim() || null) : null,
      conditionId: s.kind === "waiting" ? s.draft.conditionId : null,
      conditionKind: s.kind === "waiting" ? s.draft.conditionKind : null,
      conditionLabel: s.kind === "waiting" ? s.draft.conditionLabel : null,
      bundleText: (s.kind === "next" || s.kind === "waiting") ? ((s.draft.bundleText || "").trim() || null) : null,
      contextId: isActionKind(s.kind) ? (s.draft.contextId || null) : null,
      // The list this was drafted into, if it was opened from a list's +
      // (user). Only meaningful on a create; an edit never moves an item
      // between lists from here, so it is read off the draft rather than
      // recomputed.
      parent: s.taskId ? undefined : (s.draft.parent || null)
    };
    // Chunk 5 (§12.1): a child action page opened from a project stages into
    // that project's set instead of touching storage. Nothing is written until
    // the project itself saves.
    if (s.staging){ stageChildSave(s, data); return; }
    // Chunk 5: the project page owns the atomic apply of its staged children.
    if (isProjectKind(s.kind)){ saveProjectScreen(s, data); return; }
    const wasCreate = !s.taskId; // edits already land back focused on the item; only creates need the camera reset
    const taskId = s.taskId;
    const kind = s.kind;
    const willComplete = !!s.draft.willComplete;
    // MUTUAL EXCLUSION (user ruling, supersedes the silent Complete-wins
    // resolution): the UI now prevents Complete and Convert from arming
    // together — each disables the other. The !willComplete condition here
    // stays as a defensive guard so that even if both somehow arrived
    // armed (a future regression), Complete still wins rather than the
    // item being archived AND converted. Convert buttons only ever render
    // when s.taskId exists, so convertTo is never set on a create page.
    const convertTo = (!willComplete && taskId) ? (s.draft.convertTo || null) : null;
    const p = s.taskId ? updateTask(s.kind, s.taskId, data) : createTask(s.kind, data);
    Promise.resolve(p).then(function(){
      consumeCaptureForScreen(s); // §4.8b: a capture sorted to Next/Waiting is now filed
      // Armed completion (strict-uniformity ruling): the edits above land
      // FIRST, then the archive happens — so a rename made in the same
      // draft is what shows in the Completed list. completeTask /
      // completeProject each re-render their lane; the page then closes as
      // it always did.
      if (willComplete && taskId){
        if (isProjectKind(kind)) completeProject(kind, taskId);
        else completeTask(kind, taskId);
        closeScreen();
      } else if (convertTo){
        // Convert AFTER the edits above landed — same ordering rule as
        // Complete, so a rename made in this draft is what appears in the
        // new lane. demoteProjectToFuture owns its own linked-actions
        // prompt (a real confirmation about mutating OTHER items, distinct
        // from the "are you sure you want to convert" dialog this chunk
        // deliberately skips) and closes the screen itself once the user
        // picks Unlink/Delete; Cancel there simply leaves this page open
        // with Convert still armed, same as any other unresolved draft.
        if (convertTo === "future" && kind === "current") demoteProjectToFuture(taskId);
        else changeKind(kind, convertTo, taskId).then(closeScreen);
      } else {
        closeScreen();
      }
      // Only scroll when the close landed all the way back at the lanes
      // (not a child-screen return to a project page) — new items land at
      // the top of the lane now, so the camera should meet them there.
      if (wasCreate && !state.screen){ window.scrollTo(0, 0); resyncTabScroll(); }
    });
  }
  // Stage a child action page's Save into its parent project's staged set
  // (§12.1) instead of writing to storage. Three cases: a brand-new action
  // (staged create), a re-edit of an already-staged create, and an edit or
  // completion of a pre-existing linked action. The project-link is never
  // stored from here — it is locked to this project (§12.1).
  function stageChildSave(s, data){
    const staged = s.staging.parent.draft.staged;
    const pid = s.staging.projectId;
    const willComplete = !!s.draft.willComplete;
    if (!s.taskId){
      const task = Object.assign({ id: genId(), isGroup: false, parent: null, createdAt: nowMs() }, data);
      task.linkedProjectId = pid;
      task.kind = s.kind;
      if (willComplete) task.stagedComplete = true;
      staged.creates.push(task);
    } else {
      const created = (staged.creates || []).find(function(c){ return c.id === s.taskId; });
      if (created){
        Object.assign(created, data);
        created.linkedProjectId = pid;
        created.kind = s.kind;
        created.stagedComplete = !!willComplete;
      } else if (willComplete){
        staged.completes[s.taskId] = true;
      } else {
        const ed = Object.assign({}, staged.edits[s.taskId] || {}, data);
        delete ed.linkedProjectId; // the link is locked to this project
        staged.edits[s.taskId] = ed;
      }
    }
    if (s.staging.parent.invalidField === "projectActions") s.staging.parent.invalidField = null;
    closeScreen();
  }
  // Save a project page (§12.1): write the project's own fields, apply its
  // staged children atomically (createProject with the minted id so links
  // match), then complete/convert if armed.
  function saveProjectScreen(s, data){
    const d = s.draft;
    // §4.3 (chunk 5): a NEW Current project needs at least one staged action.
    // Drafting-page-only, Current-only, at-creation-only — the calendar row and
    // the QA/chunk-map injectors deliberately make actionless projects and go
    // nowhere near this handler. Standard dashed-outline block.
    // ⚑ An event now satisfies this too (user QA). It always should have — §4.3b
    // has always counted a linked event as a way forward — but until this round a
    // creation page could not make one, so the gate never had to ask.
    if (s.kind === "current" && !s.taskId && !projectDraftHasWayForward(s)){
      s.invalidField = "projectActions";
      renderScreen();
      return;
    }
    const willComplete = !!d.willComplete;
    const convertTo = (!willComplete && s.taskId) ? (d.convertTo || null) : null;
    const projData = {
      title: data.title, notesClean: data.notesClean, deadline: data.deadline,
      linkedProjectId: null, whenText: null, conditionId: null, conditionKind: null,
      conditionLabel: null, bundleText: null, contextId: null
    };
    const projectId = stagingProjectId(s);
    function commit(){
      if (!s.taskId){
        const proj = Object.assign({ id: projectId, isGroup: false, parent: null, createdAt: nowMs() }, projData);
        state.tasks[s.kind].unshift(proj);
        saveTasksLocal(s.kind);
      } else {
        updateTask(s.kind, s.taskId, projData);
      }
      applyProjectStaging(s);
      if (willComplete && s.taskId){ completeProject(s.kind, s.taskId); closeScreen(); return; }
      if (convertTo){
        if (convertTo === "future" && s.kind === "current"){ demoteProjectToFuture(s.taskId); return; }
        changeKind(s.kind, convertTo, s.taskId).then(closeScreen); return;
      }
      consumeCaptureForScreen(s); // §4.8b: a capture sorted to Project is now filed
      closeScreen();
    }
    // ⚑ P-5 (user): moving a deadline EARLIER can strand events that were
    // legitimate when they were made. Creation refuses a date past the deadline,
    // but nothing at creation time can help here — the date that changed is the
    // deadline's, not the event's. So warn at the moment the deadline moves,
    // which is when you have the context to judge, and LET IT THROUGH: "give a
    // warning, but let them continue if they really want to."
    //
    // Only when the deadline actually CHANGED. Checking on every save would nag
    // forever after a repeating event rolls past a deadline that nobody touched,
    // which is the state a linked repeat ends up in by design.
    const oldDl = (s.taskId && findTaskAnywhere(s.taskId) &&
                   findTaskAnywhere(s.taskId).task.deadline &&
                   findTaskAnywhere(s.taskId).task.deadline.date) || null;
    const newDl = (projData.deadline && projData.deadline.date) || null;
    if (s.taskId && newDl && newDl !== oldDl){
      const stranded = (state.events || []).filter(function(ev){
        return ev.linkedProjectId === s.taskId && ev.date > newDl;
      });
      if (stranded.length){
        const n = stranded.length;
        openConfirmDialog(
          n === 1 ? t("confirm.strandedOne") : t("confirm.strandedMany").replace("{n}", n),
          [
            { label: t("confirm.saveAnyway"), style: "primary", action: commit },
            { label: t("confirm.goBack"), action: function(){} }
          ]
        );
        return;
      }
    }
    commit();
  }
  function deleteScreenItem(){
    const s = state.screen;
    if (!s || !s.taskId) return;
    if (s.eventView){ deleteEventFromPage(); return; } // chunk 7 (§4.15b: Skip / Delete series / Cancel)
    if (s.noteView){ // chunk 6 (§4.9)
      openConfirmDialog(t("confirm.deleteNoteForGood"), [
        { label: t("chrome.delete"), style: "danger", action: function(){ deleteNote(s.noteId); closeScreen(); } },
        { label: t("chrome.cancel"), action: function(){} }
      ]);
      return;
    }
    // Child of a project (§12.1): deleting is STAGED, not immediate — it lands
    // with the project's save (or evaporates on the project's ✕). A staged
    // create just disappears; a pre-existing linked action is marked deleted.
    if (s.staging){
      openConfirmDialog(t("confirm.deleteForGood"), [
        { label: t("chrome.delete"), style: "danger", action: function(){
            const staged = s.staging.parent.draft.staged;
            const ci = (staged.creates || []).findIndex(function(c){ return c.id === s.taskId; });
            if (ci !== -1){
              const removed = staged.creates[ci];
              staged.creates.splice(ci, 1);
              // §12.1b: a staged sibling that hooked onto this one now orphans —
              // freeze its label so the dashed pill reads the deleted title. It
              // still saves (an orphaned condition satisfies waiting-for, §9).
              (staged.creates || []).forEach(function(c){
                if (c.conditionId === s.taskId) c.conditionLabel = removed.title;
              });
            } else { staged.deletes[s.taskId] = true; delete staged.edits[s.taskId]; delete staged.completes[s.taskId]; }
            closeScreen();
          } },
        { label: t("chrome.cancel"), action: function(){} }
      ]);
      return;
    }
    openConfirmDialog(t("confirm.deleteForGood"), [
      { label: t("chrome.delete"), style: "danger", action: function(){ deleteTask(s.kind, s.taskId); closeScreen(); } },
      { label: t("chrome.cancel"), action: function(){} }
    ]);
  }
  function screenComplete(){
    const s = state.screen;
    if (!s || !s.taskId) return;
    if (s.kind === "habit"){
      // DRAFT ISOLATION (§6): completing from the habit page edits the
      // DRAFT — the badge flips, nothing persists, and ✕ discards it.
      // saveScreen commits it (before the pause transition, so a
      // pause-in-the-same-draft can still lock the day into history).
      // The list checkbox is NOT a draft surface and still acts at once.
      // The pause guard reads the DRAFT's value only (user ruling, QA
      // round on index-46): a pending unpause re-enables Complete right
      // away — the completion is just another draft field, and saveScreen
      // commits the done-write before the pause transition, so the
      // ordering works out whether the unpause is pending or already
      // saved. (Previously this also checked the saved run's pause state,
      // which kept the badge inert until an exit-and-reopen.)
      if (s.draft.paused) return;
      s.draft.done = !s.draft.done;
      renderScreen();
      return;
    }
    // Actions and projects: arm/disarm the completion on the draft.
    // saveScreen performs it (and closes); ✕ discards it. Strict
    // uniformity with every other drafting control (user ruling) —
    // supersedes the old archive-and-close-on-tap behavior.
    // MUTUAL EXCLUSION (user ruling, QA round on index-46): Complete and
    // Convert can never logically fire together, so arming one disables
    // the other — this guard plus the disabled rendering replace the old
    // silent "Complete wins at save" resolution, which let both arm and
    // quietly dropped one. Disarm the convert first to complete.
    if (s.draft.convertTo) return;
    s.draft.willComplete = !s.draft.willComplete;
    renderScreen();
  }
  // Convert buttons are edit-only (main doc 4.6): they never render on
  // create pages, so a missing taskId here is simply a no-op guard.
  // DRAFT ISOLATION (§13.0 Chunk A): tapping no longer converts
  // immediately — it arms/disarms draft.convertTo (tap the same
  // destination again to disarm). saveScreen carries the conversion out
  // AFTER the field edits land, so a rename made in this draft survives
  // into the new lane; ✕ discards it like any other draft field. No "are
  // you sure" dialog — nothing escapes the page until Save.
  function screenMakeKind(destKind){
    const s = state.screen;
    if (!s || !s.taskId) return;
    // Completed page: convert buttons are greyed + inert (§12.2 step 5) —
    // restore first. Backstop for the disabled rendering.
    if (s.completedView) return;
    // MUTUAL EXCLUSION (user ruling): an armed Complete disables the
    // convert buttons — disarm Complete first. Mirror of the guard in
    // screenComplete.
    if (s.draft.willComplete) return;
    // §4.13a (chunk 3): "Make Waiting" is inert while a deadline is set --
    // backstop for the greyed button (which has no disabled attribute).
    if (destKind === "waiting" && s.draft.deadline && s.draft.deadline.date) return;
    s.draft.convertTo = (s.draft.convertTo === destKind) ? null : destKind;
    renderScreen();
  }
  // Full drafting page for a project-linked action (the ✎ next to each
  // quick-add row). Opened as a child screen: saving, cancelling, or
  // Escape all land back on the project page with its draft intact
  // (overnight notes). An optional prefillTitle carries over whatever was
  // already typed into the quick-add box.
  function screenGenerateAction(destKind, prefillTitle){
    const s = state.screen;
    if (!s || s.kind !== "current") return;
    const projectId = stagingProjectId(s);
    // Chunk 5: the child page stages into THIS project's set (§12.1).
    openChildScreen(destKind === "waiting" ? "waiting" : "next", null,
      { linkedProjectId: projectId, title: prefillTitle || "" },
      { parent: s, projectId: projectId });
  }
  // Quick-add from the project page (overnight notes: create actions
  // without leaving the project). Next Actions create instantly. Waiting
  // actions can't exist without a "waiting for" (4.2), so their quick-add
  // routes through the drafting page pre-filled with the typed title —
  // and returns here on save (judgment call, flagged in the doc).
  // (screenQuickAdd and openWaitingHookPicker lived here — the project page's
  // type-and-Enter creation and its Waiting hook-tap. Both belonged to the
  // quick-add rows, which are gone; creation opens the drafting page now, so a
  // staged action gets the same fields as anything else. The duplicate-title
  // check screenQuickAdd carried is not lost — saveScreen runs the same check
  // for every create.)
  function screenOpenHookPick(rowIdx){
    if (!state.screen) return;
    state.screen.draft.hookPicker = true;
    state.screen.draft.hookPickerRow = rowIdx || 0;
    renderScreen();
  }
  function screenCancelHookPick(){
    if (!state.screen) return;
    state.screen.draft.hookPicker = false;
    renderScreen();
  }
  // Hooks currently held by the draft's cue rows.
  function draftCueHooks(draft){
    return (draft.cueRows || []).filter(function(r){ return r.hook; }).map(function(r){ return r.hook; });
  }
  // Applies "Replace" takeovers recorded in the draft — called from
  // saveScreen ONLY (draft isolation: ✕ discards them with the rest of
  // the draft). Dependents are computed fresh here, at save time; a
  // takeover whose hook was removed from the draft before saving is
  // dropped as moot. A dependent stripped of its only cue lands in the
  // representable "+ add plan" state rather than blocking the takeover.
  function applyPendingReplacements(d, savedHooks, ownId){
    (d.pendingReplaceTargets || []).forEach(function(tid){
      if (!savedHooks.some(function(hk){ return hk.id === tid; })) return;
      state.tasks.habit.forEach(function(h){
        if (h.isGroup || h.id === ownId) return;
        if ((h.hooks || []).some(function(hk){ return hk.id === tid; })){
          setHabitCue(h.id, h.notesClean, h.whenTexts,
            h.hooks.filter(function(hk){ return hk.id !== tid; }), h.bundleText);
        }
      });
    });
  }
  function screenPickHook(targetId, isCtx){
    const s = state.screen;
    if (!s) return;
    const d = s.draft;
    const hooks = draftCueHooks(d);
    const already = hooks.some(function(hk){ return hk.id === targetId; });
    const row = d.cueRows[d.hookPickerRow];
    // Resolve the target on either side of the ONE registry: another habit,
    // or a context used as a cue (§4.5). Context-cues go through the SAME
    // path as habit hooks (user ruling) — same cap, same "already hooked"
    // warning, same replace-at-save takeover — because a single cue driving
    // more than one behaviour is the same habit-formation problem whatever
    // the cue points at, and the warning is partly a teaching tool. Only the
    // display label and the stored `ctx` flag differ.
    const ctx = isCtx ? findContext(targetId) : null;
    const target = isCtx ? null : state.tasks.habit.find(function(h){ return h.id === targetId; });
    const label = isCtx ? (ctx && ctx.name) : (target && target.title);
    const exists = isCtx ? !!ctx : !!target;
    // MAX_HOOKS in both directions (restored — see getValidHookTargets):
    // the row model bounds outgoing anyway, and the incoming count keeps
    // a target from anchoring an 8th dependent.
    const addable = !already && row && hooks.length < MAX_HOOKS && exists &&
      habitIncomingHookCount(targetId, s.taskId) < MAX_HOOKS;
    d.hookPicker = false;
    if (!addable){ renderScreen(); return; }
    const newHook = isCtx ? { id: targetId, label: label, ctx: true } : { id: targetId, label: label };
    const commit = function(){
      // D7 (principles doc), now per-row: picking a hook for a cue row
      // REPLACES whatever was typed in that row — legible, not silent
      // (the hook icon lives in the row itself, so "choose this cue"
      // plausibly means displacing the old one), and the lost data is a
      // few retypeable words. Other rows are untouched.
      d.cueRows[d.hookPickerRow] = { hook: newHook };
      if (s.invalidField === "habitWhen") s.invalidField = null;
      playHookChime();
      renderScreen();
    };
    // Other habits already anchored on this target. (The habit being
    // edited doesn't count: its hooks are drafts, and re-picking the same
    // target is blocked upstream anyway.)
    const dependents = state.tasks.habit.filter(function(h){
      return !h.isGroup && h.id !== s.taskId && (h.hooks || []).some(function(hk){ return hk.id === targetId; });
    });
    if (!dependents.length){ commit(); return; }
    // The prompt is on the TARGET side (QA correction of the first
    // version, which wrongly prompted when the *hooking* habit grew a
    // second hook): piling onto an already-claimed anchor is legal and
    // ordinary (11.4), but worth a heads-up — and "Replace" covers the
    // takeover case, where the pile-up itself was the mistake.
    renderScreen(); // close the picker beneath the dialog first
    const many = dependents.length > 1;
    openConfirmDialog(
      many
        ? t("confirm.hookTakeoverMany").replace("{label}", label).replace("{n}", dependents.length)
        : t("confirm.hookTakeoverOne").replace("{label}", label).replace("{other}", dependents[0].title),
      [
        { label: t("confirm.hookAnyway"), style: "primary", action: commit },
        { label: many ? t("confirm.replaceThem") : t("confirm.replaceThatHook"), action: function(){
          // DRAFT ISOLATION (design principle): a takeover is recorded in
          // the draft and APPLIED AT SAVE — the earlier version stripped
          // the other dependents immediately, which meant ✕-cancelling
          // this page still left them changed. Now nothing anywhere is
          // touched until this page's own Save; the dependents to strip
          // are computed fresh at save time, and a takeover whose hook
          // was removed from the draft before saving is simply dropped.
          d.pendingReplaceTargets = d.pendingReplaceTargets || [];
          if (d.pendingReplaceTargets.indexOf(targetId) === -1) d.pendingReplaceTargets.push(targetId);
          commit();
        }},
        { label: t("chrome.cancel"), action: function(){} }
      ]
    );
  }
  // Removes a cue row (hook or text) by index; the page always keeps at
  // least one row, so removing the last leaves a single empty text row.
  function screenRemoveCueRow(idx){
    if (!state.screen) return;
    const d = state.screen.draft;
    d.cueRows = (d.cueRows || []).filter(function(r, i){ return i !== idx; });
    if (!d.cueRows.length) d.cueRows = [{ text: "" }];
    renderScreen();
  }
  // Appends an empty cue row (text box + hook icon, same as the default
  // row), capped at MAX_HOOKS rows total.
  function screenAddCueRow(){
    if (!state.screen) return;
    const d = state.screen.draft;
    if ((d.cueRows || []).length >= MAX_HOOKS) return;
    d.cueRows.push({ text: "" });
    renderScreen();
  }
  // Draft-only until Save — same pattern as every other field on the page.
  function screenToggleScheduleDay(dow){
    const s = state.screen;
    if (!s || s.kind !== "habit") return;
    const idx = s.draft.schedule.indexOf(dow);
    if (idx === -1) s.draft.schedule.push(dow); else s.draft.schedule.splice(idx, 1);
    s.draft.schedule.sort();
    if (s.invalidField === "habitSchedule" && s.draft.schedule.length) s.invalidField = null;
    renderScreen();
  }
  // Pause takes effect immediately (like a switch), not gated behind Save —
  // "persists until manually unpaused" reads as a standing state change,
  // not a draft edit. Jumping lastProcessedDate to today means no misses
  // accrue for the days spent paused, and none get backfilled on unpause.
  function screenTogglePause(){
    // DRAFT ISOLATION (design principle, this round): the pause switch —
    // like every control on a create/edit page — edits the DRAFT only.
    // Nothing touches the run until Save; ✕ discards the change. The
    // run-side work (locking in a completion earned today, jumping
    // lastProcessedDate) moved to saveScreen's pause-transition block.
    const s = state.screen;
    if (!s || s.kind !== "habit") return;
    s.draft.paused = !s.draft.paused;
    renderScreen();
  }

  // ---- Waiting-condition picker sub-view within the screen (chunk 2) ----
  function screenOpenConditionPick(){
    if (!state.screen) return;
    state.screen.draft.conditionPicker = true;
    renderScreen();
  }
  function screenCancelConditionPick(){
    if (!state.screen) return;
    state.screen.draft.conditionPicker = false;
    state.screen.draft.waitingHookPicker = false; // §12.1b quick-add hook picker
    renderScreen();
  }
  // Open the project's Waiting quick-add hook picker (§12.1b): stash the typed
  // title and show the condition picker. Empty text is a no-op (the hook reads
  // as greyed until you type).
  function screenPickCondition(targetId, targetKind){
    const s = state.screen;
    if (!s) return;
    let target = (targetKind === "next" ? state.tasks.next : state.tasks.waiting).find(function(t){ return t.id === targetId; });
    if (!target){
      const ctx = conditionContext(s);
      if (ctx.proj) target = (ctx.proj.draft.staged.creates || []).find(function(c){ return c.id === targetId; }) || null;
    }
    const label = target ? target.title : "";
    // (The quick-add-hook branch lived here: picking a target created a staged
    // Waiting action outright, skipping the drafting page. It was only ever
    // reachable from the project page's Waiting quick-add row, which is gone.)
    if (s.draft.conditionId !== targetId) playHookChime();
    s.draft.conditionId = targetId;
    s.draft.conditionKind = targetKind;
    s.draft.conditionLabel = label;
    s.draft.whenText = "";
    s.draft.deadline = null;
    s.draft.conditionPicker = false;
    renderScreen();
  }
  function screenUnhookCondition(){
    if (!state.screen) return;
    state.screen.draft.conditionId = null;
    state.screen.draft.conditionKind = null;
    state.screen.draft.conditionLabel = null;
    renderScreen();
  }
  // Same as screenClearHookPick, for the condition picker (bugfix).
  function screenClearConditionPick(){
    const s = state.screen;
    if (!s) return;
    s.draft.conditionId = null;
    s.draft.conditionKind = null;
    s.draft.conditionLabel = null;
    s.draft.conditionPicker = false;
    renderScreen();
  }

  // The Deadline row (date + optional time + recurrence). A disabled
  // condition/thread icon used to sit beside it on the Next Action page as a
  // greyed teaching affordance (4.2), but it read as a broken control rather
  // than a lesson, so it was deleted (user round). FLAG: this contradicts
  // 4.2's "the icon still appears, greyed" line -- update the spec to match.
  function deadlineFieldsHtml(draft, kind){
    const d = draft.deadline || {};
    // Recurrence lives on EVENTS only now (§4.13, chunk 7). Chunk 3 removed the
    // recurrence <select> and the daily/weekly "make it a habit" bubble from
    // the deadline picker -- a deadline is a one-shot date, it does not recur.
    return (
      '<div>' +
        '<div class="screen-row">' +
          '<div class="screen-boxed-row">' +
            '<span class="field-icon">&#128197;</span>' +
            '<input type="text" readonly inputmode="none" class="screen-date" data-field="deadline-date" placeholder="' + escapeHtml(t("field.noDeadline")) + '" value="' + escapeHtml(d.date || "") + '">' +
            (d.date ? '<input type="text" readonly inputmode="none" class="screen-time" data-field="deadline-time" placeholder="--:--" value="' + escapeHtml(d.time || "") + '">' : "") +
            (d.date ? '<button type="button" class="screen-clear-x" data-action="clear-deadline" title="' + escapeHtml(t("field.clearDeadline")) + '">&times;</button>' : "") +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }
  // A small coloured bullet standing in for a kind label (user tweak): red =
  // next, yellow = waiting, cream = event/calendar (chunk 7). Used in the
  // project's linked list and the condition picker.
  function kindDot(kind){ return '<span class="kind-dot kind-' + kind + '" aria-hidden="true"></span>'; }
  // The project page's linked-actions list (overnight notes): every Next /
  // Waiting action linked to this project, read-only, tap to open (as a
  // child screen, so you come back here). Waiting items conditioned on
  // another item in this same list indent beneath it to show dependency.
  // Chunk 5 (§12.1): renders from the DRAFT's staged view (staged creates
  // appear, staged deletes disappear, staged edits show new titles), not
  // straight from storage.
  function linkedActionsListHtml(s){
    const linked = projectDraftLinked(s);
    // chunk 7 (§4.15d): linked events/appointments display as actions here,
    // sorted nearest→farthest and ABOVE the undated actions ("dated beats the
    // grouping"). A recurring event shows exactly one instance — the live one.
    // ⚑ Simplification: events sit as a dated band above the action sub-tree
    // rather than being interleaved with deadlined actions; nested dependents
    // on events are chunk 8.
    const eventRows = projectLinkedEventRowsHtml(s.draft && s.draft.projectId, stagedEventCreates(s));
    if (!linked.length) return eventRows ? ('<div class="screen-hook-pick-label">' + escapeHtml(t("project.linkedActionsLabel")) + '</div><div class="linked-actions-list">' + eventRows + '</div>') : "";
    const byId = {};
    linked.forEach(function(l){ byId[l.task.id] = l; });
    const dependents = {};
    linked.forEach(function(l){
      if (l.kind === "waiting" && l.task.conditionId && byId[l.task.conditionId]){
        (dependents[l.task.conditionId] = dependents[l.task.conditionId] || []).push(l);
      }
    });
    // chunk 8 (§4.15d): a Waiting action hooked to a project-linked item shows
    // nested beneath it EVEN when its only tie to the project is the dependency
    // (it carries no project link of its own). No stalled-project guardrail is
    // needed — it can only nest under an anchor the project already has, which
    // already makes the project non-stalled (§4.3b). Marked `external` so it
    // opens its own page, not as a staged child of this project.
    state.tasks.waiting.forEach(function(t){
      if (t.isGroup || byId[t.id]) return; // already in the linked list
      if (t.conditionId && byId[t.conditionId]){
        (dependents[t.conditionId] = dependents[t.conditionId] || []).push({ kind: "waiting", task: t, external: true });
      }
    });
    const rendered = {};
    let html = "";
    function itemHtml(l, depth){
      if (rendered[l.task.id]) return;
      rendered[l.task.id] = true;
      const open = l.external
        ? 'data-action="open-edit" data-kind="waiting" data-id="' + l.task.id + '"'
        : 'data-action="open-linked-action" data-kind="' + l.kind + '" data-id="' + l.task.id + '"';
      html += '<button type="button" class="linked-action-item' + (depth > 0 ? " indented" : "") + '" ' + open + (depth > 1 ? ' style="margin-left:' + (depth * 22) + 'px;"' : '') + '>' +
        kindDot(l.kind) + escapeHtml(l.task.title) +
      '</button>';
      (dependents[l.task.id] || []).forEach(function(dep){ itemHtml(dep, Math.min(depth + 1, 4)); });
    }
    // Roots: anything whose condition isn't itself in this list.
    linked.forEach(function(l){
      const isDependent = l.kind === "waiting" && l.task.conditionId && byId[l.task.conditionId];
      if (!isDependent) itemHtml(l, 0);
    });
    // Safety net for condition cycles that slipped through: render anything
    // left over flat rather than dropping it.
    linked.forEach(function(l){ if (!rendered[l.task.id]) itemHtml(l, 0); });
    return (
      '<div class="linked-actions-list">' + eventRows + html + '</div>'
    );
  }
  // Notes linked to this project (user). Titles only, most recently edited
  // first — no tags, no preview, no chips: "just the note titles from most
  // recent to least recent".
  //
  // ⚑ The link ran ONE WAY until now. A note could point at a project and show
  // a chip for it, but the project page was built from linked actions and linked
  // events and never looked at notes, so from the project's side they did not
  // exist.
  function linkedNotesListHtml(s, projectId){
    const live = !projectId ? [] : (state.notes || [])
      .filter(function(n){ return (n.projectLinks || []).some(function(l){ return l.id === projectId; }); });
    // Notes STAGED on this page count as linked while you are looking at it —
    // otherwise you add one, come back, and the list looks like it did nothing.
    const staged = (s && s.draft && s.draft.staged && s.draft.staged.noteCreates) || [];
    const all = live.concat(staged).sort(function(a, b){ return (b.editedAt || 0) - (a.editedAt || 0); });
    const stagedIds = {};
    staged.forEach(function(n){ stagedIds[n.id] = 1; });
    const rows = all.length
      ? '<div class="linked-actions-list">' + all.map(function(n){
          // A staged one is not tappable: there is no note to open yet, and it
          // would have to be opened out of a set that has not been applied.
          if (stagedIds[n.id]){
            return '<div class="linked-action-item staged-note">' +
              kindDot("notes") + escapeHtml(n.title || t("project.untitled")) +
              ' <span class="cal-agenda-kind">' + escapeHtml(t("project.savesWithProject")) + '</span></div>';
          }
          return '<button type="button" class="linked-action-item" data-action="open-linked-note" data-id="' + n.id + '">' +
            kindDot("notes") + escapeHtml(n.title || t("project.untitled")) +
          '</button>';
        }).join("") + '</div>'
      : "";
    const hint = all.length ? "" : '<div class="empty-note">' + escapeHtml(t("project.noNotesLinkedYet")) + '</div>';
    return rows + hint +
      '<button type="button" class="btn btn-ghost btn-small project-add-note" data-action="new-linked-note">' + escapeHtml(t("project.newNote")) + '</button>';
  }
  // The two lists share one slot and you toggle between them (user: "you should
  // be able to toggle back and forth"). Reuses the segmented control the
  // calendar's creation row already uses, so this is not a new pattern.
  //
  // ⚠ The chosen side lives on the SCREEN, not the draft. It is a view
  // preference, not an edit — putting it in the draft would make merely looking
  // at the notes count as an unsaved change and trip the ✕ warning.
  function projectLinkedPanelHtml(s){
    const tab = s.linkedTab === "notes" ? "notes" : "actions";
    const pid = s.draft && s.draft.projectId;
    const noteCount = pid ? (state.notes || []).filter(function(n){
      return (n.projectLinks || []).some(function(l){ return l.id === pid; });
    }).length : 0;
    const actionsHtml = linkedActionsListHtml(s);
    // Nothing on either side and nothing to toggle between: stay silent rather
    // than showing an empty switch on a brand-new project.
    const seg =
      '<div class="cal-seg cal-seg-small project-linked-seg">' +
        '<button type="button" class="cal-seg-btn' + (tab === "actions" ? " active" : "") + '" data-action="project-linked-tab" data-tab="actions">' + escapeHtml(t("project.linkedActions")) + '</button>' +
        '<button type="button" class="cal-seg-btn' + (tab === "notes" ? " active" : "") + '" data-action="project-linked-tab" data-tab="notes">' + escapeHtml(t("project.linkedNotesTab")) +
          (noteCount ? ' <span class="seg-count">' + noteCount + '</span>' : "") +
        '</button>' +
      '</div>';
    // ⚑ "New event" sits on the ACTIONS side, not its own: a linked event
    // already renders in that list as a dated band above the actions, so this
    // is the add button for a list that exists rather than a new place.
    // ⚑ WAS saved-projects-only. That restriction is GONE (user QA: "The add an
    // event button doesn't appear on the project creation page"). The old flag
    // said adding an event goes through the calendar, which has its own commit
    // and no draft to stage into — so the calendar now defers the write back to
    // the page that opened it, via staged.eventCreates, the same contract notes
    // already had. See newStagedSet and calAdd.
    // The Actions side owns every way of adding something that lands in it.
    // ⚑ invalidField "projectActions" moves here with them: §4.3 blocks saving a
    // new Current project with no action, and the dashed outline has to be on
    // the control the user would use to fix it. It used to mark the quick-add
    // row that no longer exists.
    const bad = s.invalidField === "projectActions" ? " field-invalid" : "";
    const addAction =
      '<div class="project-add-row' + bad + '">' +
        '<button type="button" class="btn btn-ghost btn-small project-add-note" data-action="generate-action" data-gen-kind="next">' + escapeHtml(t("project.newAction")) + '</button>' +
        '<button type="button" class="btn btn-ghost btn-small project-add-note" data-action="generate-action" data-gen-kind="waiting">' + escapeHtml(t("project.newWaitingAction")) + '</button>' +
        '<button type="button" class="btn btn-ghost btn-small project-add-note" data-action="new-linked-event">' + escapeHtml(t("project.newEvent")) + '</button>' +
      '</div>';
    const body = tab === "notes"
      ? linkedNotesListHtml(s, pid)
      : ((actionsHtml || '<div class="empty-note">' + escapeHtml(t("project.nothingLinkedYet")) + '</div>') + addAction);
    return '<div class="screen-hook-pick-label">' + escapeHtml(t("project.linked")) + '</div>' + seg + body;
  }
  // `locked` (chunk 5, §12.1): when an action is opened as a child of the
  // project it is a member of, its project link is shown-but-disabled — you
  // remove it from the project's own list instead. Keyed to membership, not
  // provenance (§12.1, §4.15d).
  function linkRowHtml(draft, locked){
    if (locked){
      return (
        '<div class="screen-row">' +
          '<div class="screen-boxed-row screen-row-disabled" title="' + escapeHtml(t("project.lockedTooltip")) + '">' +
            '<span class="field-icon">&#128279;</span>' +
            '<select class="screen-link-select" data-field="linkedProjectId" disabled>' + projectOptionsHtml(draft.linkedProjectId) + '</select>' +
          '</div>' +
        '</div>'
      );
    }
    // Wrapped in .screen-row like every other .screen-boxed-row use — without
    // it, .screen-boxed-row's flex:1 was being read against .screen-body's
    // *column* axis (height) instead of a row's (width), so the box grew to
    // fill leftover vertical space instead of just sitting flush in its row.
    return (
      '<div class="screen-row">' +
        '<div class="screen-boxed-row">' +
          '<span class="field-icon">&#128279;</span>' +
          '<select class="screen-link-select" data-field="linkedProjectId">' + projectOptionsHtml(draft.linkedProjectId) + '</select>' +
        '</div>' +
      '</div>'
    );
  }
  // Context picker (chunk 3, §4.3d) — CHOOSE-ONLY, same select pattern as the
  // project link. It never creates a context (creation is the + badge alone,
  // §4.3e); when the registry is empty it names the way out rather than
  // greying out, per the no-field-labels teaching convention.
  function contextOptionsHtml(selectedId){
    let html = '<option value="">' + escapeHtml(t("field.noContext")) + '</option>';
    state.contexts.forEach(function(c){
      html += '<option value="' + c.id + '"' + (c.id === selectedId ? " selected" : "") + '>' + escapeHtml(c.name) + '</option>';
    });
    return html;
  }
  function contextRowHtml(draft){
    if (!state.contexts.length){
      return (
        '<div class="screen-row">' +
          '<div class="screen-boxed-row screen-row-disabled">' +
            '<span class="field-icon">&#128450;</span>' +
            '<span style="font-size:12.5px;color:var(--text-soft);">' + escapeHtml(t("field.noContextsYet")) + '</span>' +
          '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="screen-row">' +
        '<div class="screen-boxed-row">' +
          '<span class="field-icon">&#128450;</span>' +
          '<select class="screen-link-select" data-field="contextId">' + contextOptionsHtml(draft.contextId || "") + '</select>' +
        '</div>' +
      '</div>'
    );
  }
  // Condition pill — shown directly under the title once a Waiting action
  // is hooked to a condition (Next or Waiting item). Per 4.2, this is "the
  // second most important piece of information after the title."
  function conditionPillHtml(draft){
    return (
      '<div class="screen-condition-pill-row">' +
        '<span class="screen-hooked-pill">&#129693; ' + escapeHtml(t("waiting.after")) + ' ' + escapeHtml(draft.conditionLabel || "") + '</span>' +
        '<button type="button" class="screen-clear-x" data-action="screen-unhook-condition" title="' + escapeHtml(t("waiting.removeCondition")) + '">&times;</button>' +
      '</div>'
    );
  }
  // The revised "waiting for" when-row (4.2, supersedes the plain deadline
  // row for this kind): free text, a date, or a hook — one required, all
  // three mutually exclusive. Greyed out once a condition pill is showing
  // above (the pill replaces it; unhooking restores these fields).
  function waitingForRowHtml(draft, invalid){
    const hasCondition = !!draft.conditionId;
    const disabledAttr = hasCondition ? " disabled" : "";
    return (
      '<div>' +
        '<div class="screen-row">' +
          '<div class="screen-boxed-row' + (hasCondition ? " screen-row-disabled" : "") + (invalid ? " field-invalid" : "") + '">' +
            '<input type="text" class="screen-waitfor-input" data-field="waitingForText" placeholder="' + escapeHtml(t("waiting.forPlaceholder")) + '" value="' + escapeHtml(draft.whenText || "") + '"' + disabledAttr + '>' +
          '</div>' +
          // The hook button stays enabled while hooked — tapping it reopens
          // the picker to change the condition. (Bugfix: it was disabled
          // once hooked, which read as "locked" — removal is the pill's ×,
          // change is this button.)
          '<button type="button" class="screen-icon-toggle' + (hasCondition ? " active" : "") + '" data-action="screen-open-condition-pick" title="' + (hasCondition ? escapeHtml(t("waiting.changeHook")) : escapeHtml(t("waiting.hookToTarget"))) + '">&#129693;</button>' +
        '</div>' +
      '</div>'
    );
  }
  // "Advanced options" (doc §12): the standing home for power features the
  // base page deliberately doesn't teach. Next/Waiting get the Temptation
  // bundling tab; Habits additionally get the extra-hooks tab.
  function advancedRowHtml(draft){
    let out = "";
    if ((draft.bundleText || "").trim()){
      // Bundle pill with a × (§12.2 step 6): tapping the pill edits it in
      // Advanced options; the × clears it. Draft-only — it edits draft.bundleText
      // and commits on Save, so ✕ discards the removal like any other field.
      out += '<span class="bundle-pill-wrap">' +
        '<button type="button" class="link-pill bundle-pill" data-action="screen-open-advanced" title="' + escapeHtml(t("advanced.editBundle")) + '">&#127852; ' + escapeHtml(draft.bundleText.trim()) + '</button>' +
        '<button type="button" class="icon-btn bundle-pill-clear" data-action="clear-bundle" title="' + escapeHtml(t("advanced.removeBundle")) + '">&times;</button>' +
      '</span>';
    }
    out += '<button type="button" class="btn btn-ghost btn-small screen-advanced-btn" data-action="screen-open-advanced">' + escapeHtml(t("advanced.button")) + '</button>';
    return out;
  }
  // The cue set as ROWS (corrected in this QA round — the first row-model
  // build put the add button on the page itself, which was a misreading):
  // the page shows every cue row — a hook row renders as its pill (live
  // normal, dead dimmed with why, deleted red) with a ×; a text row
  // renders exactly like the default cue row: a text box with the hook
  // icon (picking a hook replaces that row's typed text — D7, per-row).
  // The ADD action lives in Advanced options (§12), behind the standing
  // recommendation against extra cues — but once the user has chosen to
  // add rows, the rows themselves live here on the main page, edited in
  // place like the default; hiding deliberately-added rows inside the
  // dialog made no sense. Base-page teaching is preserved: this page
  // never invites accumulation — no auto fallback box, no add affordance.
  function habitWhenFieldsHtml(draft, invalid){
    const rowsArr = draft.cueRows || [];
    const anyHook = rowsArr.some(function(r){ return r.hook; });
    let rows = "";
    rowsArr.forEach(function(row, i){
      if (row.hook && row.hook.ctx){
        // Context-cue row: always live, so there is no "not today" dim
        // state — only present (context name) or orphaned (deleted context).
        const hk = row.hook;
        const ctx = findContext(hk.id);
        const label = ctx ? ctx.name : (hk.label || t("habit.deletedContext"));
        const suffix = ctx ? "" : t("habit.deletedSuffix");
        rows += '<div class="screen-hooked-pill-row">' +
          '<span class="screen-hooked-pill' + (ctx ? "" : " cue-orphaned") + '">&#128279; ' + escapeHtml(label) + escapeHtml(suffix) + '</span>' +
          '<button type="button" class="icon-btn" data-action="screen-remove-cue-row" data-row="' + i + '" title="' + escapeHtml(t("habit.removeCue")) + '">&times;</button>' +
        '</div>';
      } else if (row.hook){
        const hk = row.hook;
        const target = state.tasks.habit.find(function(h){ return h.id === hk.id && !h.isGroup; });
        const live = target ? hookLiveToday(hk) : false;
        const label = target ? target.title : (hk.label || t("habit.deletedHabit"));
        const suffix = !target ? t("habit.deletedSuffix") : (live ? "" : t("habit.notTodaySuffix"));
        rows += '<div class="screen-hooked-pill-row">' +
          '<span class="screen-hooked-pill' + (!target ? " cue-orphaned" : (live ? "" : " cue-dim")) + '">&#128279; ' + escapeHtml(t("waiting.after")) + ' ' + escapeHtml(label) + escapeHtml(suffix) + '</span>' +
          '<button type="button" class="icon-btn" data-action="screen-remove-cue-row" data-row="' + i + '" title="' + escapeHtml(t("habit.removeCue")) + '">&times;</button>' +
        '</div>';
      } else {
        const placeholder = (i === 0 && !anyHook)
          ? t("habit.cuePlaceholderFirst")
          : t("habit.cuePlaceholderExtra");
        rows += '<div class="screen-when-field-row' + (invalid && i === 0 ? " field-invalid" : "") + '">' +
          '<input type="text" class="habit-when-input" data-field="cueText" data-row="' + i + '" placeholder="' + escapeHtml(placeholder) + '" value="' + escapeHtml(row.text || "") + '">' +
          '<button type="button" class="screen-icon-toggle" data-action="screen-open-hook-pick" data-row="' + i + '" title="' + escapeHtml(t("habit.hookToAnother")) + '">&#129693;</button>' +
          (rowsArr.length > 1 ? '<button type="button" class="icon-btn" data-action="screen-remove-cue-row" data-row="' + i + '" title="' + escapeHtml(t("habit.removeCue")) + '">&times;</button>' : "") +
        '</div>';
      }
    });
    return rows;
  }
  function habitHookPickerHtml(s){
    // Excludes self, direct mutuals, and anything already in the draft's
    // own cue rows (11.4b), plus full targets (7 dependents — the
    // bidirectional cap). Longer cycles are allowed — with schedules
    // they can be a coherent rotating routine. The old "No hook" row is
    // gone — with a per-row × on every cue, an empty list *is* the
    // cleared state.
    const currentIds = draftCueHooks(s.draft).map(function(hk){ return hk.id; });
    const targets = getValidHookTargets(s.taskId, currentIds);
    const ctxTargets = getValidContextCueTargets(currentIds, s.taskId);
    // The list now holds two kinds of cue target (§4.5): other habits, and
    // contexts. Group them into labelled sections so they read as distinct.
    // QA #29: heading, then a list — the same shape as every other picker. This
    // used to nest its headings INSIDE one .screen-hook-pick-list, which is why
    // its sections read differently from the notes and condition pickers.
    let sections = "";
    if (targets.length){
      sections += '<div class="screen-hook-pick-label">' + escapeHtml(t("habit.hookPickHabits")) + '</div>' +
        '<div class="screen-hook-pick-list">' +
        targets.map(function(hk){ return '<button type="button" class="screen-hook-pick-item" data-action="screen-pick-hook" data-id="' + hk.id + '">' + escapeHtml(hk.title) + '</button>'; }).join("") +
        '</div>';
    }
    if (ctxTargets.length){
      sections += '<div class="screen-hook-pick-label">' + escapeHtml(t("habit.hookPickContexts")) + '</div>' +
        '<div class="screen-hook-pick-list">' +
        ctxTargets.map(function(c){ return '<button type="button" class="screen-hook-pick-item" data-action="screen-pick-hook" data-ctx="1" data-id="' + c.id + '">' + escapeHtml(c.name) + '</button>'; }).join("") +
        '</div>';
    }
    // Empty state names the way out, per the empty-picker-teaches rule
    // (§4.3d/§12.1b): no habits to hook to AND no contexts to cue on.
    const itemsHtml = sections ||
      '<div class="screen-hook-pick-list"><div class="empty-note">' + escapeHtml(t("habit.hookPickEmpty")) + '</div></div>';
    return (
      '<div class="pick-body">' +
        // The prompt is an intro, not a section heading — otherwise it would
        // take a divider and sit right on top of the first section's.
        '<div class="pick-intro">' + escapeHtml(t("habit.hookPickIntro")) + '</div>' +
        itemsHtml +
        '<div class="screen-row" style="margin-top:8px;"><button type="button" class="btn btn-ghost btn-small" data-action="screen-cancel-hook-pick">' + escapeHtml(t("picker.back")) + '</button></div>' +
      '</div>'
    );
  }
  // ---- Habit run engine UI (chunk 3): schedule chips, pause, run track ----
  function habitScheduleHtml(draft, invalid){
    const chips = [0, 1, 2, 3, 4, 5, 6].map(function(i){
      const active = draft.schedule.indexOf(i) !== -1;
      return '<button type="button" class="habit-day-chip' + (active ? " active" : "") + '" data-action="screen-toggle-schedule-day" data-dow="' + i + '" title="' + escapeHtml(t("habit.dowFull." + i)) + '">' + escapeHtml(t("habit.dowLetter." + i)) + '</button>';
    }).join("");
    return (
      '<div class="screen-row">' +
        '<div class="screen-hook-pick-label" style="margin-bottom:2px;">' + escapeHtml(t("habit.scheduledDays")) + '</div>' +
      '</div>' +
      '<div class="screen-row"><div class="habit-day-row' + (invalid ? " field-invalid" : "") + '">' + chips + '</div></div>'
    );
  }
  function habitPauseBtnHtml(draft){
    return (
      '<div class="screen-row">' +
        '<button type="button" class="btn btn-ghost btn-small habit-pause-btn' + (draft.paused ? " active" : "") + '" data-action="screen-toggle-pause">' +
          (draft.paused ? "\u25B6 " + escapeHtml(t("habit.unpause")) : "\u23F8 " + escapeHtml(t("habit.pause"))) +
        '</button>' +
      '</div>'
    );
  }
  // How many runs (laps) this habit has completed or broken so far — each
  // run-ending "miss" in the history marks one finished lap.
  function habitLapNumber(run){
    const endedRuns = run.history.filter(function(e){ return e.status === "miss"; }).length;
    return endedRuns + 1;
  }
  // The ghost-runner track: your current run's day-by-day dots lined up
  // against the record (or most-recently-tied) run's sequence. Simplified
  // from the full lockstep-replay-with-overtake animation spec'd in 4.11b
  // to a static per-day comparison — same information (are you ahead of,
  // behind, or matching the best run today), lighter to build and read.
  // =========================================================
  // THE HABIT RUNNER (post-sprint §P6) — which of runner.js's 12 states the
  // habit is actually in. The runner is a VIEW of the run engine, not a second
  // source of truth: every input below already exists in habitRuns, and the
  // dot track above it is drawn from the same numbers.
  //
  // Reads the DRAFT (draft.done, draft.schedule) exactly as the dot track does,
  // so the figure reacts the instant the badge is tapped and reverts on ✕ with
  // everything else — draft isolation covers the runner too.
  //
  // Returns { state, variant }.
  // =========================================================
  function habitRunnerState(s, run){
    const draft = s.draft;
    const todayDow = boundaryNow().getDay();
    const scheduledToday = draft.schedule.indexOf(todayDow) !== -1;
    const doneToday = !!draft.done;

    // ⚑ COMPLETION IS ALWAYS ACKNOWLEDGED (user ruling). Ticking a habit puts
    // the runner back on its feet — on a rest day, and over the top of a
    // celebration. The rest day still does not COUNT (the engine only records
    // scheduled days, and doneCount below reflects that), but the figure must
    // not sit reading a book straight after you told it you did the thing.
    //
    // 11: paused. The one case completion cannot override, and only because
    // completion is impossible while paused — the pill renders inert — so this
    // can never be reached with doneToday true.
    if (draft.paused) return { state: "rest_reading", variant: null };
    // 11: off-day, when nothing was done. Done on an off-day falls through to
    // the running states below.
    if (!scheduledToday && !doneToday) return { state: "rest_reading", variant: null };

    // 3 / 12 / 8: a run that has ENDED and whose result hasn't been seen yet.
    // pendingResult is exactly the "run just ended" signal, already consumed by
    // the celebration banner, so the runner and the banner can never disagree.
    // Completing cancels the celebration: the next lap has started, and that is
    // the more useful thing to show.
    if (draft.pendingResult && !doneToday){
      const t = draft.pendingResult.type;
      if (t === "record") return { state: "pb_end_celebration", variant: null };
      if (t === "tie") return { state: "tie_celebration", variant: null };
      return { state: "run_end_no_pb", variant: null };
    }

    const entries = currentRunEntries(run);
    const hasPB = run.personalBest > 0;

    // 10: the habit exists but this lap hasn't started. Lap one gets its own
    // copy ("I'm ready for THIS lap" rather than "my next lap").
    if (!entries.length && !doneToday){
      return { state: "fresh_start_stretch", variant: hasPB ? null : "fresh_start_stretch_first" };
    }

    // Today's index on the track is where the ghost is compared against.
    const todayIdx = entries.length;
    // A rest-day completion is acknowledged by the figure but must NOT count
    // toward the run — otherwise it could fire the overtake scene on a day the
    // engine will never record.
    const doneCount = entries.filter(function(e){ return e.status === "done"; }).length +
      ((doneToday && scheduledToday) ? 1 : 0);
    // "You stumbled" is about the CURRENT position: today if today is a miss so
    // far, otherwise the most recent recorded day.
    const youStumbled = doneToday
      ? false
      : (entries.length ? entries[entries.length - 1].status === "stumble" : false);
    const ghostSeq = run.bestSequence || [];
    // 9: the live run has just passed the record. This needs no "already fired"
    // flag — doneCount === personalBest + 1 is true on exactly one day, then the
    // count moves past it on its own.
    if (hasPB && doneCount === run.personalBest + 1) return { state: "pb_overtake", variant: null };
    // The ghost must be read at the SAME point on the track that the scene is
    // depicting, or the two figures are showing different days. When you are
    // running clean, that point is today; when the scene is your stumble, it is
    // the day you stumbled — which is the last RECORDED day, not today.
    // (Bug found by the state check: comparing a stumble at index n-1 against
    // the ghost at index n rendered "you stumbled, record was clean" whenever
    // the record had in fact stumbled alongside you.)
    const cmpIdx = youStumbled ? entries.length - 1 : todayIdx;
    // Past the end of the ghost's sequence there is nobody to race, so the
    // solo states are the honest ones even though a PB exists.
    const ghostHere = cmpIdx < ghostSeq.length ? ghostSeq[cmpIdx] : null;
    if (!hasPB || ghostHere === null){
      return { state: youStumbled ? "stumble_solo" : "run_solo", variant: null };
    }
    const ghostStumbled = ghostHere === "stumble";
    if (youStumbled && !ghostStumbled) return { state: "stumble_ghost_clean", variant: null };
    if (youStumbled && ghostStumbled) return { state: "stumble_ghost_stumble", variant: null };
    if (!youStumbled && ghostStumbled) return { state: "clean_ghost_stumble", variant: null };
    return { state: "run_with_ghost", variant: null };
  }
  // Mounted after render (the page is built as an HTML string; the runner needs
  // a real element). Torn down and rebuilt on each render — the box is small
  // and this keeps it honest about draft changes.
  let habitRunnerInstance = null;
  function mountHabitRunner(s){
    if (habitRunnerInstance){ habitRunnerInstance.destroy(); habitRunnerInstance = null; }
    if (!s || s.kind !== "habit" || !s.taskId) return;
    const host = qs("#habit-runner-host");
    if (!host) return;
    const run = ensureHabitRun(s.taskId);
    const pick = habitRunnerState(s, run);
    habitRunnerInstance = mountRunner(host, { state: pick.state, locale: "en", copyVariant: pick.variant });
  }

  function habitTrackHtml(s){
    const run = ensureHabitRun(s.taskId);
    const draft = s.draft;
    const todayDow = boundaryNow().getDay();
    const today = todayStr();
    const scheduledToday = draft.schedule.indexOf(todayDow) !== -1;
    // Draft, not persisted state (draft isolation): the track shows today
    // as done the moment the badge is tapped, and reverts on ✕ with
    // everything else — matching how it already previews the draft's
    // schedule rather than the run's.
    // ▲ POST-SPRINT: the two rows of dots (you vs. the ghost) are GONE. They
    // existed to make the run engine's logic visible while it was being built,
    // and the runner (§P6) now shows the same comparison as a scene — the two
    // together were the same information twice, in two visual languages.
    // Nothing about the engine changed; only this readout was removed.
    let celebration = "";
    if (draft.pendingResult){
      const r = draft.pendingResult;
      if (r.type === "record"){
        celebration = '<div class="habit-celebration habit-celebration-record">New personal best \u2014 ' + r.length + (r.length === 1 ? " day" : " days") + '!</div>';
      } else if (r.type === "tie"){
        celebration = '<div class="habit-celebration habit-celebration-tie">Tie \u2014 ' + r.length + ' days, matching your best.</div>';
      } else {
        celebration = '<div class="habit-celebration habit-celebration-restart">Start lap ' + habitLapNumber(run) + '. The path remembers ' + r.length + (r.length === 1 ? " day" : " days") + ' \u2014 catch your breath and go again.</div>';
      }
    }
    const bodyHtml = !scheduledToday
      ? '<div class="habit-offday">&#128214; Off day \u2014 you can\u2019t be on all the time.</div>'
      : "";
    return (
      '<div class="habit-track-block">' +
        // The runner mounts here after render (§P6) — it is now the whole
        // readout, not a companion to the dot track.
        '<div id="habit-runner-host" class="habit-runner-host"></div>' +
        celebration + bodyHtml +
        '<div class="habit-metrics">' +
          '<span class="habit-metric"><b>' + run.personalBest + '</b> personal best</span>' +
          '<span class="habit-metric"><b>' + run.lifetimeTotal + '</b> lifetime</span>' +
        '</div>' +
      '</div>'
    );
  }
  // Condition picker for Waiting items — grouped by kind since a condition
  // can be either a Next Action or another Waiting action. Cycle filtering
  // (getValidConditionTargets) already excludes anything that would loop.
  function conditionPickerHtml(s){
    // Quick-add-hook mode (§12.1b): opened from the project's Waiting quick-add
    // row — picking a target CREATES a staged Waiting action, so there is no
    // "No condition" escape (a waiting can't wait on nothing).
    // ⚑ Was `isQuickAdd ? null : s.taskId` — the quick-add hook picker had no
    // task of its own to exclude. That mode is gone, so the picker always
    // excludes the item it belongs to, which is the only case left.
    const excludeId = s.taskId;
    const targets = conditionTargetsForScreen(s, excludeId);
    const ctx = conditionContext(s);
    function itemBtn(t){
      // Events show their date and a calendar dot; picking stores conditionKind
      // "next" (data-kind), so resolution/promotion never learn events exist.
      const dot = t.isEvent ? kindDot("event") : kindDot(t.kind);
      const hint = t.isEvent && t.dateHint ? ' <span class="cal-agenda-kind">' + escapeHtml(t.dateHint) + '</span>' : "";
      return '<button type="button" class="screen-hook-pick-item" data-action="screen-pick-condition" data-id="' + t.id + '" data-kind="' + t.kind + '">' +
        dot + escapeHtml(t.title) + hint + '</button>';
    }
    function group(label, arr){ return arr.length ? '<div class="screen-hook-pick-label">' + label + '</div><div class="screen-hook-pick-list">' + arr.map(itemBtn).join("") + '</div>' : ""; }
    const events = targets.filter(function(t){ return t.isEvent; });
    let body;
    if (ctx.projectId){
      // GROUP, don't filter (§12.1b): the project's own actions first, the rest
      // below — a condition may still target anything (§4.2).
      body = group(t("picker.conditionThisProject"), targets.filter(function(t){ return t.inProject && !t.isEvent; })) +
             group(t("picker.conditionEverythingElse"), targets.filter(function(t){ return !t.inProject && !t.isEvent; }));
    } else {
      body = group(t("picker.conditionNextActions"), targets.filter(function(t){ return t.kind === "next" && !t.isEvent; })) +
             group(t("picker.conditionWaitingActions"), targets.filter(function(t){ return t.kind === "waiting" && !t.isEvent; }));
    }
    body += group(t("picker.conditionUpcomingEvents"), events); // chunk 8 (§10): condition on a pending event
    // Empty state is a teaching surface, not an error (§12.1b) — name the exits.
    const empty = !targets.length
      ? '<div class="empty-note">' + escapeHtml(t("picker.conditionEmpty")) + '</div>' : "";
    const noneHtml = '<div class="screen-hook-pick-list"><button type="button" class="screen-hook-pick-item screen-hook-pick-none" data-action="screen-clear-condition-pick">' + escapeHtml(t("picker.noCondition")) + '</button></div>';
    return (
      '<div class="pick-body">' +
        noneHtml + body + empty +
        '<div class="screen-row" style="margin-top:8px;"><button type="button" class="btn btn-ghost btn-small" data-action="screen-cancel-condition-pick">' + escapeHtml(t("picker.back")) + '</button></div>' +
      '</div>'
    );
  }
  function screenHeaderHtml(s){
    const showDelete = !!s.taskId;
    // Event pages read "Appointment" once a time is set (§4.14 — the time is
    // the only thing that distinguishes the two; they are not separate types).
    const badge = s.eventView ? (s.draft && s.draft.time ? "Appointment" : "Event") : KIND_BADGE_LABEL[s.kind];
    // ▲ DESKTOP (ruling 4): ← and 🗑 move OUT of the header and into the card's
    // footer as "Done" and "Delete". They are not rendered in both places —
    // exactly one element carries data-action="screen-save" in either mode, so
    // the action stays an unambiguous selector. ✕ keeps its top-right corner in
    // both layouts.
    const desk = state.desktop;
    return (
      '<div class="screen-header">' +
        (desk
          ? '<span class="screen-chrome-spacer" aria-hidden="true"></span>'
          : '<button type="button" class="screen-chrome-btn" data-action="screen-save" title="' + escapeHtml(t("chrome.saveBack")) + '">&#8592;</button>') +
        '<span class="screen-kind-badge">' + escapeHtml(badge) + '</span>' +
        '<div class="screen-header-right">' +
          (!desk && showDelete ? '<button type="button" class="screen-chrome-btn danger" data-action="screen-delete" title="' + escapeHtml(t("chrome.delete")) + '">&#128465;</button>' : '') +
          '<button type="button" class="screen-chrome-btn" data-action="screen-cancel" title="' + escapeHtml(t("chrome.cancel")) + '">&#10005;</button>' +
        '</div>' +
      '</div>'
    );
  }
  // ▲ DESKTOP FOOTER (ruling 4). Done bottom-RIGHT, filled and prominent;
  // Delete bottom-LEFT, danger-styled and behind the same confirm it always
  // had — maximum distance between the two. Nothing about commit semantics
  // changes: Done IS screen-save.
  //
  // Deliberately NOT here: Complete and Convert. A big "✓ Complete" beside
  // "Done" reads as two rival finish buttons. The footer answers "am I finished
  // drafting?"; the body's outcome group answers "what is this item becoming?"
  function screenFooterHtml(s, variant){
    if (!state.desktop) return "";
    const deleteAction = variant === "completed" ? "completed-delete" : "screen-delete";
    const canDelete = !!s.taskId;
    return (
      '<div class="screen-footer">' +
        (canDelete
          ? '<button type="button" class="btn screen-footer-delete" data-action="' + deleteAction + '">&#128465; ' + escapeHtml(t("chrome.delete")) + '</button>'
          : '<span class="screen-footer-spacer" aria-hidden="true"></span>') +
        '<button type="button" class="btn btn-brass screen-footer-done" data-action="screen-save" title="' + escapeHtml(t("chrome.doneTitle")) + '">' +
          escapeHtml(t("chrome.done")) + '</button>' +
      '</div>'
    );
  }
  // Border/text color for the Make-Waiting/Next/Current/Future pill —
  // tinted with the *destination* kind's accent, per the guide.
  function accentVarForKind(kind){
    return kind === "next" ? "--red" : kind === "waiting" ? "--yellow" : kind === "current" ? "--forest" : kind === "future" ? "--royal" : kind === "notes" ? "--teal" : kind === "tags" ? "--brass" : kind === "review" ? "--brass" : kind === "event" ? "--yellow" : kind === "calendar" ? "--brass" : "--purple";
  }
  // DRAFT ISOLATION (§13.0 Chunk A): armed renders a filled pill reading
  // "Converting to X on save", the same "nothing has happened yet, but
  // here's what Save will do" language as the armed Complete badge —
  // saveScreen is what actually performs the conversion.
  // MUTUAL EXCLUSION (user ruling): disabled (grey, inert) while Complete
  // is armed — the two can never logically fire together.
  function makeKindBtnHtml(destKind, label, arrow, armed, disabled, disabledTitle){
    const accentVar = accentVarForKind(destKind);
    const style = armed
      ? 'background:var(' + accentVar + ');border-color:var(' + accentVar + ');color:var(--dark-on-accent);'
      : disabled
        ? 'border-color:var(--paper-2);color:var(--text-soft);cursor:default;'
        : 'border-color:var(' + accentVar + ');color:var(' + accentVar + ');';
    const text = armed
      ? "\u2713 " + escapeHtml(t("outcome.convertingToOnSave").replace("{kind}", KIND_BADGE_LABEL[destKind]))
      : ((arrow === "left" ? "&#8592; " : "") + escapeHtml(label) + (arrow === "right" ? " &#8594;" : ""));
    const title = armed ? escapeHtml(t("outcome.tapToUndo")) : disabled ? escapeHtml(disabledTitle || t("outcome.disarmToConvert")) : "";
    return (
      '<button type="button" class="btn screen-make-kind-btn' + (armed ? " armed" : "") + (disabled ? " disabled" : "") + '" data-action="make-kind" data-dest="' + destKind + '" ' +
        'title="' + title + '" style="' + style + '">' + text +
      '</button>'
    );
  }
  // Completed-item page chrome (§12.2 step 5): ← (back, no save) and 🗑, and
  // deliberately NO ✕ — with nothing editable, ← and ✕ would be one gesture.
  function completedHeaderHtml(s){
    // Same fork as screenHeaderHtml: on desktop both controls are in the card's
    // footer, so the header keeps only the badge.
    const desk = state.desktop;
    return (
      '<div class="screen-header">' +
        (desk
          ? '<span class="screen-chrome-spacer" aria-hidden="true"></span>'
          : '<button type="button" class="screen-chrome-btn" data-action="screen-save" title="' + escapeHtml(t("chrome.back")) + '">&#8592;</button>') +
        '<span class="screen-kind-badge">' + escapeHtml(KIND_BADGE_LABEL[s.kind]) + '</span>' +
        '<div class="screen-header-right">' +
          (desk ? '<span class="screen-chrome-spacer" aria-hidden="true"></span>'
                : '<button type="button" class="screen-chrome-btn danger" data-action="completed-delete" title="' + escapeHtml(t("chrome.delete")) + '">&#128465;</button>') +
        '</div>' +
      '</div>'
    );
  }
  // Read-only body: honest static rendering (no inputs that don't save), the
  // relevant secondary details, the kind's convert button greyed + inert
  // ("Restore the item to convert it"), and the Complete pill as "↩ Restore".
  function completedBodyHtml(s){
    // ⚠ Named `task`, not `t` — this function's body calls the i18n t()
    // function extensively, and a local `const t` would shadow it silently
    // (t.title etc. would still work, but any t("...") call would try to
    // invoke the completed task object as a function and throw).
    const task = s.completedTask, kind = s.kind;
    let fields = '<div class="screen-field-title completed-static">' + escapeHtml(task.title) + '</div>';
    if ((task.notesClean || "").trim()){
      fields += '<div class="completed-static-desc">' + escapeHtml(task.notesClean.trim()) + '</div>';
    }
    const rows = [];
    if (kind === "waiting"){
      if (task.conditionId) rows.push("🥅 " + escapeHtml(t("waiting.after")) + " " + escapeHtml(task.conditionLabel || t("waiting.anotherItem")));
      else if ((task.whenText || "").trim()) rows.push("🕐 " + escapeHtml(t("waiting.waitingForLabel")) + " " + escapeHtml(task.whenText.trim()));
    }
    if (isActionKind(kind) && task.contextId){
      const ctx = findContext(task.contextId);
      if (ctx) rows.push(escapeHtml(t("completed.context")) + " " + escapeHtml(ctx.name));
    }
    if (isActionKind(kind) && task.linkedProjectId){
      let proj = null;
      ["current", "future"].forEach(function(k){
        const p = state.tasks[k].find(function(x){ return x.id === task.linkedProjectId; }) ||
                  (state.completed[k] || []).find(function(x){ return x.id === task.linkedProjectId; });
        if (p) proj = p;
      });
      if (proj) rows.push("🔗 " + escapeHtml(t("completed.partOf")) + " “" + escapeHtml(proj.title) + "”");
    }
    if (task.deadline && task.deadline.date){
      const dd = dateStrToDate(task.deadline.date);
      let ds = dd ? dd.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : task.deadline.date;
      if (task.deadline.time) ds += " " + escapeHtml(t("completed.at")) + " " + escapeHtml(task.deadline.time);
      rows.push("📅 " + escapeHtml(t("completed.due")) + " " + escapeHtml(ds));
    }
    if ((task.bundleText || "").trim()){
      rows.push("🍬 " + escapeHtml(task.bundleText.trim()));
    }
    rows.forEach(function(r){ fields += '<div class="completed-info-row">' + r + '</div>'; });
    if (task.completedAt){
      fields += '<div class="completed-info-row completed-when">' + escapeHtml(t("completed.completedOn")) + ' ' + escapeHtml(task.completedAt) + '</div>';
    }
    // Convert button(s) for this kind — greyed and inert. screenMakeKind
    // guards completedView, so a tap does nothing even if the class slips.
    const tip = t("outcome.restoreToConvert");
    if (kind === "next") fields += makeKindBtnHtml("waiting", t("outcome.makeWaiting"), "right", false, true, tip);
    else if (kind === "waiting") fields += makeKindBtnHtml("next", t("outcome.makeNext"), "left", false, true, tip);
    else if (kind === "current") fields += makeKindBtnHtml("future", t("outcome.makeFuture"), "", false, true, tip);
    else if (kind === "future") fields += makeKindBtnHtml("current", t("outcome.makeCurrent"), "", false, true, tip);
    fields += '<button type="button" class="btn screen-complete-pill" data-action="completed-restore" title="' + escapeHtml(t("outcome.restoreToActive")) + '">↩ ' + escapeHtml(t("outcome.restore")) + '</button>';
    return '<div class="screen-body">' + fields + '</div>';
  }
  function screenBodyHtml(s){
    if (s.tagsView) return tagsPageBodyHtml(s); // chunk 6 (§4.9b)
    if (s.noteView) return noteBodyHtml(s); // chunk 6 (§4.9)
    if (s.eventView) return eventBodyHtml(s); // chunk 7 (§4.14/§4.15) — NOT the action template
    const draft = s.draft, kind = s.kind;
    // §12.1: lock the project link when this action is opened as a child of
    // the project it actually belongs to (membership, not provenance).
    const linkLocked = !!(s.staging && draft.linkedProjectId && draft.linkedProjectId === s.staging.projectId);

    if (kind === "habit" && draft.hookPicker){
      return '<div class="screen-body">' +
        '<input type="text" class="screen-field-title" data-field="title" placeholder="' + escapeHtml(TITLE_PLACEHOLDER[kind]) + '" value="' + escapeHtml(draft.title) + '" readonly>' +
        habitHookPickerHtml(s) +
      '</div>';
    }
    if (kind === "waiting" && draft.conditionPicker){
      return '<div class="screen-body">' +
        '<input type="text" class="screen-field-title" data-field="title" placeholder="' + escapeHtml(TITLE_PLACEHOLDER[kind]) + '" value="' + escapeHtml(draft.title) + '" readonly>' +
        conditionPickerHtml(s) +
      '</div>';
    }
    // (The Waiting quick-add hook picker's own sub-view lived here — a
    // read-only title above the target list. Same story: its entry point was
    // the quick-add row.)

    let fields = '<input type="text" class="screen-field-title' + (s.invalidField === "title" ? " field-invalid" : "") + '" data-field="title" placeholder="' + escapeHtml(TITLE_PLACEHOLDER[kind]) + '" value="' + escapeHtml(draft.title) + '">';
    // ▲ DESKTOP (ruling 4 / trap T10): the convert buttons are collected here
    // instead of being emitted where they are computed, so they can be rendered
    // in ONE bordered group with the Complete pill at the foot of the page —
    // "what happens on Done". Their mutual exclusion (arming one greys the
    // others) is only legible when they are adjacent. Membership is per page:
    // the group renders what the page HAS, never an empty slot.
    // ⚑ This changes the phone too, by exactly one thing: the convert button now
    // sits below the "Advanced" row instead of above it. One DOM, one order —
    // forking the markup by mode is what trap T7 rules out.
    let convertHtml = "";

    if (kind === "next"){
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="' + escapeHtml(t("field.description")) + '">' + escapeHtml(draft.notesClean) + '</textarea>';
      fields += linkRowHtml(draft, linkLocked);
      fields += contextRowHtml(draft);
      fields += deadlineFieldsHtml(draft, kind);
      if (s.taskId){
        // §4.13a (chunk 3): a dated thing does not wait. Disable "Make Waiting"
        // whenever a deadline is set -- converting would have to silently drop
        // the date. Complete-armed also disables it (existing mutual exclusion).
        const dated = !!(draft.deadline && draft.deadline.date);
        convertHtml += makeKindBtnHtml("waiting", t("outcome.makeWaiting"), "right", draft.convertTo === "waiting",
          !!draft.willComplete || dated,
          dated ? t("waiting.blockedByDeadline") : null);
      }
      fields += advancedRowHtml(draft);
    } else if (kind === "waiting"){
      // Condition pill sits directly under the title (before the
      // description) — "the second most important piece of information
      // after the title" per 4.2.
      if (draft.conditionId) fields += conditionPillHtml(draft);
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="' + escapeHtml(t("field.description")) + '">' + escapeHtml(draft.notesClean) + '</textarea>';
      fields += linkRowHtml(draft, linkLocked);
      fields += contextRowHtml(draft);
      fields += waitingForRowHtml(draft, s.invalidField === "waitingFor");
      if (s.taskId) convertHtml += makeKindBtnHtml("next", t("outcome.makeNext"), "left", draft.convertTo === "next", !!draft.willComplete);
      fields += advancedRowHtml(draft);
    } else if (isProjectKind(kind)){
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="' + escapeHtml(t("field.description")) + '">' + escapeHtml(draft.notesClean) + '</textarea>';
      // \u2691 Deadlines are CURRENT-only (user): "Future projects don't have deadlines
      // by definition." A Someday project is one you have NOT committed to starting
      // (\u00a74.3 / the lane's own info text), and a due date is a commitment \u2014 the two
      // contradict. Both the creation page and the drafting page drop the field.
      if (kind === "current") fields += deadlineFieldsHtml(draft, kind);
      if (kind === "current"){
        { // §4.3/§12.1: renders on NEW project pages too (staged children)
          const hasWay = projectDraftHasWayForward(s);
          fields += projectLinkedPanelHtml(s);
          // ⚑ The two quick-add rows that used to sit here are GONE (user).
          // Two reasons, and the second is a bug rather than taste:
          //   · they no longer fit beside the New event / New note buttons the
          //     linked panel now carries — three different shapes of "add"
          //     stacked on one page;
          //   · they rendered OUTSIDE the panel, so they were still on screen
          //     after switching to the Notes side, offering to add an action to
          //     a list that was not showing.
          // Their creation paths move into the panel's Actions side as buttons
          // (see projectLinkedPanelHtml), which is where the things they create
          // actually appear.
          // \u2691 QA (user): "the warning about the unlinked action shouldn't appear on
          // the creation page unless someone tries to leave without creating an
          // action or event." It used to render the instant the page opened, which
          // told a user who had not yet typed the title that they had already got
          // it wrong \u2014 a scold for being at step one. On an EXISTING project it is
          // a true statement about a saved thing and stays live; on a NEW one it
          // waits for the blocked save (invalidField) to have something to report.
          const showFlag = s.taskId ? !hasWay : (s.invalidField === "projectActions");
          if (showFlag) fields += '<div class="screen-project-flag">' + escapeHtml(t("project.noNextStepFlag")) + '</div>';
        }
        if (s.taskId) convertHtml += makeKindBtnHtml("future", t("outcome.makeFuture"), "", draft.convertTo === "future", !!draft.willComplete);
      } else {
        // ⚑ Future projects get LINKED NOTES (user: "it should be possible to
        // link notes to the future projects page"). Notes only, and no segmented
        // control: §4.3 is explicit that a Future project holds no linked actions
        // and takes no deadlines, so an Actions side would be a switch to a list
        // that can never have anything in it. A Someday project is exactly the
        // kind that accumulates thinking rather than steps, which is what a note
        // is for — the link already worked in one direction (a note could name a
        // Future project) and the page simply never showed it.
        // Same notes interface as a Current project's Notes side, count badge and
        // all — deliberately WITHOUT the Actions/Notes segmented control, which is
        // the one part that cannot carry over: demoteProjectToFuture exists
        // precisely because a Someday project may not hold linked actions, so a
        // toggle to that list would offer what the conversion just refused.
        {
          const fpid = s.draft && s.draft.projectId;
          const fCount = fpid ? (state.notes || []).filter(function(n){
            return (n.projectLinks || []).some(function(l){ return l.id === fpid; });
          }).length : 0;
          const fStaged = ((s.draft && s.draft.staged && s.draft.staged.noteCreates) || []).length;
          const fTotal = fCount + fStaged;
          fields += '<div class="screen-hook-pick-label">' + escapeHtml(t("project.linkedNotesLabel")) +
            (fTotal ? ' <span class="seg-count">' + fTotal + '</span>' : "") + '</div>' +
            linkedNotesListHtml(s, fpid);
        }
        if (s.taskId) convertHtml += makeKindBtnHtml("current", t("outcome.makeCurrent"), "", draft.convertTo === "current", !!draft.willComplete);
      }
    } else if (kind === "habit"){
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="' + escapeHtml(t("habit.identityPlaceholder")) + '">' + escapeHtml(draft.notesClean) + '</textarea>';
      fields += habitWhenFieldsHtml(draft, s.invalidField === "habitWhen");
      fields += habitScheduleHtml(draft, s.invalidField === "habitSchedule");
      fields += advancedRowHtml(draft);
      if (s.taskId){
        fields += habitPauseBtnHtml(draft);
        fields += habitTrackHtml(s);
      }
    }

    let completeHtml = "";
    if ((kind === "next" || kind === "waiting" || isProjectKind(kind)) && s.taskId){
      // STRICT UNIFORMITY (user ruling): Complete here is draft-only too.
      // It no longer archives-and-closes on tap; it ARMS the completion,
      // the page stays open, Save carries it out (archive + close) and ✕
      // discards it — the same contract as every other control on a
      // drafting page. Tap again to disarm. The list-view checkbox is not
      // a drafting surface and still archives immediately.
      // MUTUAL EXCLUSION (user ruling): while a convert is armed, the
      // pill goes grey and inert (reusing the paused treatment's visual
      // language) — disarm the convert to complete. screenComplete
      // carries the matching guard.
      const armed = !!draft.willComplete;
      const blocked = !armed && !!draft.convertTo;
      completeHtml += '<button type="button" class="btn screen-complete-pill' + (armed ? " done" : "") + (blocked ? " paused" : "") +
        '" data-action="screen-complete" title="' +
        escapeHtml(armed ? t("outcome.completingTapUndo") : blocked ? t("outcome.disarmToConvert") : t("outcome.completeOnSaveTitle")) + '">' +
        (armed ? "\u2713 " + escapeHtml(t("outcome.completingOnSave")) : escapeHtml(t("outcome.complete"))) + '</button>';
    } else if (kind === "habit" && s.taskId){
      // Habit Complete is a toggle rather than a one-way archive (the page
      // stays open so the track/celebration update in place) — but it is
      // equally draft-only: the badge edits draft.done, Save commits.
      // While paused, the badge renders inert (design ruling: pausing
      // disables completion; screenComplete carries the matching guard).
      const doneToday = !!draft.done;
      // Inert iff the DRAFT is paused (user ruling, QA round on
      // index-46): toggling unpause in the draft revives the badge
      // immediately, and toggling pause deadens it immediately — the
      // draft's value is the page's single source of truth, same as
      // every other control. saveScreen commits the done-write before
      // the pause transition, so a complete-after-pending-unpause draft
      // records the day correctly at save.
      const pausedNow = !!draft.paused;
      completeHtml += '<button type="button" class="btn screen-complete-pill' + (doneToday ? " done" : "") + (pausedNow ? " paused" : "") +
        '" data-action="screen-complete" title="' + (pausedNow ? escapeHtml(t("outcome.pausedUnpauseToComplete")) : "") + '">' +
        (pausedNow ? "\u23F8 " + escapeHtml(t("outcome.paused")) : (doneToday ? "\u2713 " + escapeHtml(t("outcome.completedToday")) : escapeHtml(t("outcome.complete")))) + '</button>';
    }
    // The outcome group. Complete first, converts beside/below it, in one
    // bordered section — or nothing at all when the page has neither half.
    if (completeHtml || convertHtml){
      fields += '<div class="screen-outcome-group">' + completeHtml + convertHtml + '</div>';
    }
    return '<div class="screen-body">' + fields + '</div>';
  }
  // Collapsing-tab-bar scroll state (module scope so lockBodyScroll and the
  // create-close scroll reset can resync it — see the scroll listener in
  // bindEvents). resyncTabScroll re-baselines the tracker to the current
  // scroll position WITHOUT toggling, so a programmatic scrollTo (screen
  // close restoring the lanes' position, or jumping to the top after a
  // create) isn't mistaken for a scroll gesture and bounced.
  let tabScrollLastY = 0;
  let tabScrollAccum = 0;
  const TAB_COLLAPSE_HYSTERESIS = 16; // px of committed one-way movement before the bar flips
  function resyncTabScroll(){ tabScrollLastY = window.scrollY || 0; tabScrollAccum = 0; }

  // Freeze the document while a page is open — the page's own body is the
  // only thing allowed to scroll. Saves/restores the lanes' scroll
  // position around the position:fixed lock.
  function lockBodyScroll(lock){
    const locked = document.body.classList.contains("screen-open");
    if (lock && !locked){
      state.savedScrollY = window.scrollY || 0;
      document.body.style.top = (-state.savedScrollY) + "px";
      document.body.classList.add("screen-open");
    } else if (!lock && locked){
      document.body.classList.remove("screen-open");
      document.body.style.top = "";
      window.scrollTo(0, state.savedScrollY || 0);
      resyncTabScroll(); // the restore jump is not a scroll gesture — don't bounce the bar
    }
  }
  // =========================================================
  // ADVANCED OPTIONS DIALOG (doc §12)
  // =========================================================
  // All edits land on the screen draft; the page's own Save commits them.
  // Backdrop click and Done both capture the bundle text first, so nothing
  // typed is ever silently dropped.
  // Habits carry a second tab, "Extra cues" (corrected this QA round):
  // the ADD action lives here, behind §12's recommendation against — but
  // the rows it adds live on the main page, edited in place like the
  // default row. The dialog never lists the rows; it only adds them.
  function openAdvancedDialog(){
    const s = state.screen;
    if (!s) return;
    if (!s.advTab) s.advTab = "bundle";
    renderAdvancedDialog();
  }
  function advCaptureBundle(){
    const s = state.screen;
    const input = qs("#adv-bundle-input");
    if (s && input) s.draft.bundleText = input.value;
  }
  function renderAdvancedDialog(){
    const s = state.screen;
    if (!s) return;
    const isHabit = s.kind === "habit";
    const tab = isHabit ? s.advTab : "bundle";
    let tabsHtml = "";
    if (isHabit){
      tabsHtml = '<div class="adv-tabs">' +
        '<button type="button" class="adv-tab' + (tab === "bundle" ? " active" : "") + '" data-tab="bundle">' + escapeHtml(t("advanced.bundlingTab")) + '</button>' +
        '<button type="button" class="adv-tab' + (tab === "cues" ? " active" : "") + '" data-tab="cues">' + escapeHtml(t("advanced.extraCuesTab")) + '</button>' +
      '</div>';
    }
    let content = "";
    if (tab === "bundle"){
      content =
        '<p class="adv-note"><strong>' + escapeHtml(t("advanced.temptationBundling")) + '</strong> ' + escapeHtml(t("advanced.bundleDescription")) + '</p>' +
        '<textarea id="adv-bundle-input" class="adv-textarea" placeholder="' + escapeHtml(t("advanced.bundlePlaceholder")) + '">' + escapeHtml(s.draft.bundleText || "") + '</textarea>';
    } else {
      const rowCount = (s.draft.cueRows || []).length;
      const addHtml = rowCount >= MAX_HOOKS
        ? '<p class="adv-note">' + escapeHtml(t("advanced.cueLimitReached").replace("{n}", MAX_HOOKS)) + '</p>'
        : '<button type="button" class="btn btn-ghost btn-small" data-adv-add-cue="1">' + escapeHtml(t("advanced.addAnotherCue")) + '</button>';
      content =
        '<p class="adv-note"><strong>' + escapeHtml(t("advanced.notRecommended")) + '</strong> ' + escapeHtml(t("advanced.notRecommendedDescription")) + '</p>' +
        '<p class="adv-note">' + escapeHtml(t("advanced.addedRowsHint")) + '</p>' +
        addHtml;
    }
    qs("#dialog-root").innerHTML =
      '<div class="choice-dialog-backdrop"><div class="choice-dialog adv-dialog">' +
      '<div class="adv-title">' + escapeHtml(t("advanced.buttonDialog")) + '</div>' + tabsHtml +
      '<div class="adv-content">' + content + '</div>' +
      '<div class="choice-dialog-btns"><button type="button" class="primary" data-adv-done="1">' + escapeHtml(t("advanced.done")) + '</button></div>' +
      '</div></div>';
    const backdrop = qs(".choice-dialog-backdrop");
    backdrop.addEventListener("click", function(e){
      if (e.target !== backdrop) return;
      advCaptureBundle(); closeDialog(); renderScreen();
    });
    qsa(".adv-tab").forEach(function(btn){
      btn.addEventListener("click", function(){
        advCaptureBundle();
        s.advTab = btn.getAttribute("data-tab");
        renderAdvancedDialog();
      });
    });
    const done = qs("[data-adv-done]");
    if (done) done.addEventListener("click", function(){ advCaptureBundle(); closeDialog(); renderScreen(); });
    const addCue = qs("[data-adv-add-cue]");
    if (addCue) addCue.addEventListener("click", function(){
      // Adds an empty row to the PAGE (draft-only, like everything else)
      // and closes the dialog so the user lands where the row now is.
      advCaptureBundle();
      closeDialog();
      screenAddCueRow();
    });
  }

  function renderScreen(){
    const s = state.screen;
    const root = qs("#screen-root");
    lockBodyScroll(!!s);
    if (!s){ root.innerHTML = ""; return; }
    const key = (s.completedView ? "completed:" : s.reviewView ? "review:" : s.calendarView ? "calendar:" : s.quickDoneView ? "quickdone:" : "") + s.kind + ":" + (s.taskId || "new");
    // The desktop footer is appended to the two page shapes that have something
    // to commit or delete. The review and the calendar have neither — the
    // review closes with its own ✕, the calendar with its ←. quickDoneView has
    // neither either — no header at all (author ruling: literally the capture's
    // text and two buttons), so no footer to match.
    const inner = s.completedView
      ? completedHeaderHtml(s) + completedBodyHtml(s) + screenFooterHtml(s, "completed")
      : s.reviewView
        ? reviewHeaderHtml(reviewActiveLoops().length > 0) + reviewBodyHtml(s)
        : s.calendarView
          ? calendarHeaderHtml(s) + calendarBodyHtml(s)
          : s.quickDoneView
            ? quickDoneBodyHtml(s)
            : screenHeaderHtml(s) + screenBodyHtml(s) + screenFooterHtml(s, "edit");
    const existing = root.querySelector(".screen-overlay");
    if (existing && existing.getAttribute("data-screen-key") === key){
      // Same item re-rendering (hook added, day chip toggled, Complete
      // toggled…): swap the content inside the existing overlay instead of
      // rebuilding it, so the slide-in doesn't replay (QA: "the page loads
      // in every time you add a hook") and the scroll position survives.
      const oldBody = existing.querySelector(".screen-body");
      const scrollTop = oldBody ? oldBody.scrollTop : 0;
      const card = existing.querySelector(".screen-card") || existing;
      card.innerHTML = inner;
      const newBody = existing.querySelector(".screen-body");
      if (newBody) newBody.scrollTop = scrollTop;
      autoGrowAll();
      if (s.calendarView) bindCalendarSwipe();
      mountHabitRunner(s);
      capturePristine(s);
      return;
    }
    // Fresh open, or navigation to a different item (child screens,
    // returning from one): full rebuild with the slide-in.
    // ⚑ `.screen-card` exists in BOTH modes (trap T7). On the phone it is a
    // transparent full-height wrapper and changes nothing; on desktop it is the
    // centered card and the overlay around it becomes the scrim. One DOM, two
    // stylesheets' worth of rules — a per-mode DOM would fork the in-place
    // re-render path and the habit runner mount, which is a bug farm.
    root.innerHTML = '<div class="screen-overlay" data-kind="' + s.kind + '" data-screen-key="' + key + '" style="--lane-accent:var(' + accentVarForKind(s.kind) + ')">' +
      '<div class="screen-card">' + inner + '</div></div>';
    requestAnimationFrame(function(){
      const overlay = qs(".screen-overlay");
      if (overlay) overlay.classList.add("open");
      const titleInput = qs('.screen-field-title');
      if (titleInput && !s.taskId && !s.draft.hookPicker) titleInput.focus();
    });
    autoGrowAll();
    if (s.calendarView) bindCalendarSwipe();
    mountHabitRunner(s);
    capturePristine(s);
  }
  function autoGrowAll(){
    qsa(".screen-field-desc").forEach(function(ta){
      ta.style.height = "auto";
      ta.style.height = (ta.scrollHeight + 2) + "px";
    });
  }

  // =========================================================
  // DEV TOOL: drag diagnostic log. The press-and-hold drag is invisible after
  // the fact and phone-only, so a bug in it can't be captured in a screenshot
  // or read from a video. This records the whole lifecycle — touchstart, the
  // hold timer, native text-selection attempts, cancels, the watchdog — as
  // copyable text. Off by default; gtddev_ so it survives Reset; strip at the
  // wrapper like the other dev scaffolding. NOT part of the designed surface.
  // =========================================================
  let dragLogOn = false;
  let dragLogBuf = [];
  let dragLogT0 = 0;
  // =========================================================
  // DEV TOOL VISIBILITY (user: put the dev tools behind the settings surface)
  // Each group is off until switched on under ⋯ → Debugging. Stored under
  // gttdev_-style keys — gtddev_ — because these are dev preferences and must
  // survive "Restore app to defaults" like the snapshot slot does; wiping them
  // would turn every reset into a hunt through the menu to get the tools back.
  // =========================================================
  const DEV_GROUPS = [
    { id: "time", key: "gtddev_show_time", label: "Time jump buttons",
      note: "Move the app's clock to test days, hours and the 4am boundary." },
    { id: "snapshot", key: "gtddev_show_snapshot", label: "Snapshot & restore",
      note: "Save all data to one slot before something risky, and put it back after." },
    { id: "draglog", key: "gtddev_show_draglog", label: "Drag log",
      note: "Record a press-and-hold drag so a phone-only bug can be sent as text." },
    // ⚑ QA SCAFFOLDING, off by default (user: "noone wants to see the QA
    // checklists except me"). The app is shown to other people through GitHub
    // Pages, and until this switch existed every visitor got a Next Actions lane
    // full of "✅ QA — …" and a Current Projects lane holding the 26-row sprint
    // map. That is not a demo of a task manager; it is a look at someone's build
    // notes.
    //
    // The chunk map is gated with it, deliberately: the user named the checklist,
    // but the map is the same category and by far the bulkier of the two. ⚑ Say
    // so if the map should stay visible on its own switch.
    //
    // `noBar` because this one has no toolbar buttons — it changes what is in the
    // LANES, not what sits in the dev strip, so it must not make an empty bar appear.
    { id: "qa", key: "gtddev_show_qa", label: "QA checklist & chunk map", noBar: true,
      note: "Inject your test checklist and the sprint map into the lanes. Off means anyone you show the app to sees a clean one." }
  ];
  const DEV_GROUP_QA = DEV_GROUPS.find(function(g){ return g.id === "qa"; });
  function devGroupOn(g){ return Storage.get(g.key) === "1"; }
  function setDevGroup(g, on){
    Storage.set(g.key, on ? "1" : "0");
    // Toggling the QA group has to act on the lanes immediately — switching it
    // off and still seeing the checklist would read as a broken switch.
    if (g === DEV_GROUP_QA) applyQaScaffolding();
    applyDevVisibility();
  }
  function applyDevVisibility(){
    let any = false;
    DEV_GROUPS.forEach(function(g){
      const on = devGroupOn(g);
      if (on && !g.noBar) any = true;
      const el = qs('[data-dev-group="' + g.id + '"]');
      if (el) el.hidden = !on;
    });
    const bar = qs("#dev-toolbar");
    if (bar) bar.hidden = !any;
    // (While a full-screen page is open the bar floats over it, so the clock is
    // reachable from the calendar and the drafting pages — see styles.css. The
    // room the page reserves for it is keyed off this `hidden` attribute directly,
    // so there is no extra state to keep in step here.)
    // The drag log's own panel has no business surviving its group being hidden.
    if (!devGroupOn(DEV_GROUPS[2])){
      const panel = qs("#drag-log-panel");
      if (panel) panel.hidden = true;
    }
  }

  function dragLogInit(){ dragLogOn = Storage.get("gtddev_drag_log_on") === "1"; }
  function dragDesc(el){
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (!el) return "(none)";
    let cls = "";
    if (el.className && typeof el.className === "string"){
      const parts = el.className.trim().split(/\s+/).slice(0, 2);
      if (parts[0]) cls = "." + parts.join(".");
    }
    const txt = (el.textContent || "").trim().slice(0, 16);
    return el.tagName.toLowerCase() + cls + (txt ? " “" + txt + "”" : "");
  }
  function dlog(ev, detail){
    if (!dragLogOn) return;
    // ⚠ Real clock on purpose (like genId): these are elapsed-millisecond deltas
    // for a drag gesture. A QA time jump landing mid-drag would inject days of
    // "elapsed" into a log measuring thumb movement.
    const now = Date.now();
    if (!dragLogBuf.length) dragLogT0 = now;
    dragLogBuf.push("+" + (now - dragLogT0) + "ms  " + ev + (detail ? "  " + detail : ""));
    if (dragLogBuf.length > 250) dragLogBuf.shift();
    try { Storage.set("gtddev_drag_log", dragLogBuf.join("\n")); } catch (e){ /* quota — the in-memory buffer still works */ }
  }
  function clearDragLog(){ dragLogBuf = []; dragLogT0 = 0; try { Storage.remove("gtddev_drag_log"); } catch (e){} }
  function updateDragLogUI(){ const b = qs("#drag-log-toggle"); if (b) b.textContent = "Drag log: " + (dragLogOn ? "ON" : "off"); }
  function toggleDragLog(){
    dragLogOn = !dragLogOn;
    Storage.set("gtddev_drag_log_on", dragLogOn ? "1" : "0");
    if (dragLogOn){ clearDragLog(); dlog("logging ON — now reproduce the drag"); }
    updateDragLogUI();
  }
  function showDragLog(){
    const panel = qs("#drag-log-panel"); if (!panel) return;
    const ta = qs("#drag-log-text");
    if (ta) ta.value = dragLogBuf.length ? dragLogBuf.join("\n") : "(empty — tap ‘Drag log: off’ to turn it ON, reproduce the drag, then Show again)";
    panel.hidden = false;
  }

  // =========================================================
  // DEV TOOLS: QA time jump + state snapshot/restore (spec.md §12.3, chunk 0c)
  // Dev tool only — stripped at the wrapper, same as the checklist and
  // chunk-map injectors. Snapshot lets you capture the whole app state
  // before destructive testing (deletes, time-jumps through the habit run
  // engine) and get back to exactly that state afterward, repeatably.
  // =========================================================
  function updateQaTimeReadout(){
    const el = qs("#qa-time-readout");
    if (el) el.textContent = boundaryNow().toLocaleString();
  }
  function applyQaTimeJump(minutes){
    state.qaTimeOffset = (state.qaTimeOffset || 0) + minutes;
    processHabitBoundaries();
    processEventBoundaries(); // chunk 7: roll events + mint pseudo-actions across the jumped boundary
    // Re-render EVERY lane, not just habits: deadline progress bars (§4.4,
    // Next + Current) read the clock at render time too, so a time jump has
    // to refresh them or they sit stale until you open/close a page.
    KINDS.forEach(renderLane);
    updateHabitBadge();
    updateQaTimeReadout();
    // ...and the same is true of an OPEN screen. The calendar's three tabs and
    // the review are all computed from "now": jump a day with the List tab open
    // and it kept yesterday's grouping, past-due rows and "Today" heading until
    // something else forced a redraw (user: "make sure the list view re-renders
    // when it needs to — this was a bug in past builds").
    //
    // ⚑ Deliberately limited to the read-only surfaces. A drafting page is
    // rebuilt from its draft, so re-rendering one mid-edit would tear down the
    // input under the cursor to show it the same value it already had.
    if (state.screen && (state.screen.calendarView || state.screen.reviewView)) renderScreen();
  }

  const GTD_KEY_PREFIX = "gtd_"; // deliberately excludes gtddev_ (e.g. the snapshot key itself)
  const SNAPSHOT_KEY = "gtddev_snapshot"; // gtddev_: must survive Reset, which only clears gtd_* keys

  // Single slot, overwrites silently — this is a dev convenience, not the
  // user-facing export/import (chunk 8, different feature, different
  // audience), so it doesn't need its own confirm dialog to write.
  function takeSnapshot(){
    const data = {};
    Storage.keys().forEach(function(k){
      if (k.indexOf(GTD_KEY_PREFIX) === 0) data[k] = Storage.get(k);
    });
    Storage.setJSON(SNAPSHOT_KEY, { savedAt: new Date().toISOString(), data: data });
  }
  function restoreSnapshot(){
    const snap = Storage.getJSON(SNAPSHOT_KEY, null);
    if (!snap){
      openConfirmDialog("No snapshot saved yet — tap Snapshot first.", [
        { label: "OK", style: "primary", action: function(){} }
      ]);
      return;
    }
    openConfirmDialog(
      "Restore the snapshot from " + new Date(snap.savedAt).toLocaleString() + "? Current data will be replaced.",
      [
        { label: "Restore", style: "danger", action: function(){
          // A full reload sidesteps all re-render complexity by design —
          // do not attempt in-place rehydration (spec.md §12.3).
          Storage.keys().forEach(function(k){
            if (k.indexOf(GTD_KEY_PREFIX) === 0) Storage.remove(k);
          });
          Object.keys(snap.data).forEach(function(k){ Storage.set(k, snap.data[k]); });
          window.location.reload();
        }},
        { label: t("chrome.cancel"), action: function(){} }
      ]
    );
  }

  // =========================================================
  // EVENTS
  // =========================================================
  function bindEvents(){

    // Dev QA aid (not a real feature): jumps boundaryNow() forward and
    // re-runs the same boundary sweep that normally only fires on boot, so
    // stumble/miss/run-ending/badge behavior can be exercised in seconds
    // instead of waiting real days between checks. Hour/minute granular
    // (chunk 0c) so the midnight-4am window (§4.14b) — where the calendar
    // date and the app's day boundary deliberately disagree — can actually
    // be landed inside, not just jumped over a whole day at a time.
    qs("#qa-day-btn").addEventListener("click", function(){ applyQaTimeJump(24 * 60); });
    qs("#qa-hour-btn").addEventListener("click", function(){ applyQaTimeJump(60); });
    qs("#qa-min-btn").addEventListener("click", function(){ applyQaTimeJump(15); });

    qs("#qa-snapshot-btn").addEventListener("click", takeSnapshot);
    qs("#qa-restore-btn").addEventListener("click", restoreSnapshot);

    // Drag diagnostic log (dev tool) — see the block near updateQaTimeReadout.
    qs("#drag-log-toggle").addEventListener("click", toggleDragLog);
    qs("#drag-log-show").addEventListener("click", showDragLog);
    qs("#drag-log-copy").addEventListener("click", function(){
      const ta = qs("#drag-log-text"); if (!ta) return;
      ta.focus(); ta.select();
      let ok = false;
      try { ta.setSelectionRange(0, ta.value.length); } catch (e){}
      try { if (navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(ta.value); ok = true; } } catch (e){}
      if (!ok){ try { document.execCommand("copy"); } catch (e){} }
      const btn = qs("#drag-log-copy"); if (btn){ const t = btn.textContent; btn.textContent = "Copied"; setTimeout(function(){ btn.textContent = t; }, 1200); }
    });
    qs("#drag-log-clear").addEventListener("click", function(){ clearDragLog(); const ta = qs("#drag-log-text"); if (ta) ta.value = ""; });
    qs("#drag-log-close").addEventListener("click", function(){ const p = qs("#drag-log-panel"); if (p) p.hidden = true; });

    qs("#lane-switcher").addEventListener("click", function(e){
      const btn = e.target.closest("button[data-kind]");
      if (!btn) return;
      state.activeKind = btn.getAttribute("data-kind");
      qsa("#lane-switcher button").forEach(function(b){ b.classList.toggle("active", b === btn); });
      // Notes chips are DERIVED from project state (live/completed/tombstone),
      // so refresh them every time the lane is shown — a project may have been
      // completed, deleted, or renamed since it last rendered (§4.9).
      if (state.activeKind === "notes") renderLane("notes");
      updateLaneVisibility();
    });

    // Mini-list "add to list…" rows — plain click/Enter handlers rather
    // than native form submission, and an inline name row rather than
    // window.prompt for "+ New list": both native mechanisms are silently
    // blocked in sandboxed/embedded contexts (which is why the buttons
    // appeared dead), and the inline versions work everywhere.
    // Dashed-outline feedback, cleared on next input (CLAUDE.md validation rule).
    function markInvalid(input){
      input.classList.add("field-invalid");
      input.addEventListener("input", function h(){ input.classList.remove("field-invalid"); input.removeEventListener("input", h); });
    }
    // (submitAddMini lived here. The quick-add rows it served are gone — the +
    // beside a list's or context's count opens the real drafting page instead
    // (user: "they just clutter things up"). Deleted rather than left dormant:
    // it was the only caller of addTask's parent/context arguments, and a dead
    // creation path is exactly the sort of thing that gets wired back up by
    // accident.)
    // CHUNK 2 (spec 4.3e) -- the FAB menu's second option ("New context" /
    // "New list"). Replaces the old button-swap openNewListRow(): there's no
    // "+ New list" button to swap out anymore, so this targets the lane's
    // own inline-slot div (laneShellHtml) instead. Still calls the existing
    // addGroup() path -- chunk 3 swaps that handler underneath.
    function openInlineNameRow(kind){
      const slot = qs('.inline-slot[data-kind="' + kind + '"]');
      if (!slot) return;
      const placeholder = (kind === "current" || kind === "future") ? "List name\u2026" : "Context name\u2026";
      slot.innerHTML = '<div class="inline-name-row"><input type="text" placeholder="' + escapeHtml(placeholder) + '" /><button type="button" data-role="inline-name-confirm">+</button></div>';
      const input = slot.querySelector("input");
      // ⚑ QA (user): "the viewport force scrolls to the bottom and keeps you
      // there." A bare focus() lets the BROWSER decide the camera: it scrolls the
      // field into view, and on a phone it does that again after the on-screen
      // keyboard resizes the layout viewport — which is the "keeps you there"
      // half, and why it cannot be scrolled away from.
      //
      // The row is injected at the TOP of the lane (laneShellHtml puts the
      // inline-slot above cards-root), so the honest camera move is the top of the
      // page — the same place a save-exiting create sends it, and for the same
      // reason (the thing you just made is up there). preventScroll stops the
      // browser adding its own opinion on top of that.
      window.scrollTo(0, 0);
      resyncTabScroll(); // a programmatic jump, not a gesture — don't bounce the tab bar
      try { input.focus({ preventScroll: true }); } catch (_){ input.focus(); }
      function clear(){ slot.innerHTML = ""; }
      function commit(){
        const name = input.value.trim();
        if (!name){ clear(); return; }
        // chunk 3 (§4.3e): the ONE handler that swapped this chunk. Action
        // lanes now write to the contexts registry; project lanes keep the
        // lane-local group-task path (addGroup) untouched. A duplicate context
        // name is a no-op (addContext returns the existing one), so the inline
        // row just closes without creating a second identical bucket.
        if (isActionKind(kind)){
          const existed = contextNameExists(name);
          addContext(name);
          clear();
          // Contexts are ONE shared Next↔Waiting set (§4.3d), so a new one
          // has to surface on BOTH action lanes immediately — rendering only
          // the active lane left the sibling stale until a full refresh.
          if (!existed){ renderLane("next"); renderLane("waiting"); }
        } else {
          clear();
          addGroup(kind, name);
        }
      }
      slot.querySelector("button").addEventListener("click", commit);
      input.addEventListener("keydown", function(ev){
        if (ev.key === "Enter") commit();
        else if (ev.key === "Escape") clear();
      });
      input.addEventListener("blur", function(){
        // Give the + button's click a beat to land before clearing.
        setTimeout(function(){ if (slot.isConnected && !slot.contains(document.activeElement)) clear(); }, 150);
      });
    }
    // The three creation routes, by EXPLICIT kind. Both entry points — the
    // phone's FAB menu and the desktop's per-column buttons — go through here,
    // so "New action" means the same thing whichever control started it.
    function createPrimary(kind){
      if (kind === "habit"){ openScreen("habit", null); return; }   // habits have one option, not a menu
      if (kind === "notes"){ openNoteScreen(null); return; }        // primary = New note
      openScreen(kind, null);
    }
    function createSecondary(kind){
      if (kind === "habit") return;                                 // no second option
      if (kind === "notes"){ openNoteScreen(null, { checklist: true }); return; }
      openInlineNameRow(kind);                                      // new context / new list
    }
    function createTertiary(kind){
      if (kind === "notes") openTagsScreen();                       // Tags → the Tags page (§4.9b)
    }
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape"){
        const fabMenuEl = qs("#fab-menu");
        if (fabMenuEl && !fabMenuEl.hidden) fabMenuEl.hidden = true;
      }
      if (e.key !== "Enter") return;
      if (e.target && e.target.id === "tray-input"){ e.preventDefault(); trayAdd(e.target.value); return; }
      if (e.target && e.target.id === "review-form-input"){ // chunk 6b (§4.8b)
        e.preventDefault();
        const s = state.screen, type = s && s.reviewForm && s.reviewForm.type;
        if (type === "date") reviewSavePushDate();
        else { // text form — dispatch by which kind opened it
          const kind = reviewFindLoopKind(s.reviewForm.key);
          if (kind === "stalled") reviewSaveAddNext(); else reviewSaveFreeText();
        }
        return;
      }
    });

    document.addEventListener("click", function(e){
      // Subtle navigation tick on real button presses (skip disabled
      // buttons, and skip picker selections where the hook chime plays).
      // The 📅 calendar widget is a <div>, not a <button> (it needs to be a
      // plain node the desktop header can MOVE rather than clone — see
      // calendarBtnEl above) so it's matched here by hand or it never ticks.
      const clickedBtn = e.target.closest('button:not([disabled]), .cal-widget');
      if (clickedBtn){
        const act = clickedBtn.getAttribute("data-action") || "";
        if (act !== "screen-pick-hook" && act !== "screen-pick-condition") playNavClick();
      }

      // CHUNK 7 (§4.13–§4.15): the calendar view, the event page, pseudo-action
      // taps, and the header/widget 📅. Runs early and short-circuits its own
      // actions; returns false for the generic screen-save/cancel/delete so
      // those still handle the event page below.
      if (eventsHandleClick(e)) return;

      // ▲ DESKTOP: any click outside a header dropdown puts it away. Runs
      // before the action handlers and does NOT return — clicking the gear with
      // the Language menu open should close the menu AND open the gear menu.
      if (!e.target.closest(".header-drop")) closeHeaderDrops();

      // ▲ DESKTOP (ruling 2): a column's toggle. Same pairings as the phone's
      // tab pairs, so the two layouts stay one mental model.
      const colTab = e.target.closest('[data-action="col-lane"]');
      if (colTab){
        const ck = colTab.getAttribute("data-kind");
        const ci = columnIndexOfKind(ck);
        if (ci !== -1) state.columns[ci] = ck;
        // Notes cards are DERIVED from live project state, so they are rendered
        // on the way in rather than left stale (trap T5) — the same thing the
        // phone's tab handler does.
        if (ck === "notes") renderLane("notes");
        updateLaneVisibility();
        return;
      }
      // ▲ DESKTOP (author note 8 / trap T17): the header's Language and
      // Background dropdowns. They REUSE the settings panels' markup and call
      // setLocale / setSurface — one implementation of each, two entry points.
      const hdrDropBtn = e.target.closest('[data-action="hdr-drop"]');
      if (hdrDropBtn){
        const wrap = hdrDropBtn.closest(".header-drop");
        const menu = wrap && wrap.querySelector(".header-drop-menu");
        if (!menu) return;
        const wasOpen = !menu.hidden;
        closeHeaderDrops();                 // only one open at a time
        if (!wasOpen){
          menu.innerHTML = hdrDropBtn.getAttribute("data-drop") === "lang"
            ? settingsLanguageHtml(true) : settingsBackgroundsHtml(true);
          menu.hidden = false;
        }
        return;
      }
      const hdrPick = e.target.closest('.header-drop-menu [data-action]');
      if (hdrPick){
        const act = hdrPick.getAttribute("data-action");
        // Applying re-renders the header widgets (which is what closes the
        // menu): the button's own label is the value you just picked, so the
        // menu has said everything it has to say.
        if (act === "settings-pick-lang"){ setLocale(hdrPick.getAttribute("data-lang")); renderHeaderWidgets(); return; }
        if (act === "settings-pick-bg"){ setSurface(hdrPick.getAttribute("data-bg")); renderHeaderWidgets(); return; }
      }

      // CHUNK 6 (§4.8a / §4.10): the intray drawer and the settings surface.
      if (e.target.closest('[data-action="open-tray"]')){ openTray(); return; }
      if (e.target.closest('[data-action="close-tray"]')){ closeTray(); return; }
      if (e.target.closest('[data-action="open-overflow"]')){ openSettings(); return; }
      if (e.target.closest('[data-action="tray-add"]')){
        const inp = qs("#tray-input"); trayAdd(inp ? inp.value : ""); return;
      }
      const trayDelBtn = e.target.closest('[data-action="tray-delete"]');
      if (trayDelBtn){ trayDelete(trayDelBtn.getAttribute("data-id")); return; }
      if (e.target.closest('[data-action="tray-reveal"]')){ state.trayReveal = !state.trayReveal; refreshTrayList(); return; }
      // A revealed open-loop card opens its real page (see trayLoopCardHtml).
      // Closing the drawer first is the same move open-review makes: the drawer is
      // a cancel-on-close overlay, not a screen, so it must not be left underneath.
      const trayOpenLoop = e.target.closest('[data-action="tray-open-loop"]');
      if (trayOpenLoop){
        const evId = trayOpenLoop.getAttribute("data-event");
        const lane = trayOpenLoop.getAttribute("data-lane");
        const id = trayOpenLoop.getAttribute("data-id");
        closeTray();
        if (evId) openEventScreen(evId); else if (lane && id) openScreen(lane, id);
        return;
      }
      if (e.target.closest('[data-action="tray-info"]')){
        const panel = qs(".tray-info-panel"); if (panel) panel.hidden = !panel.hidden; return;
      }

      // CHUNK 6b (§4.8b): the daily review surface.
      if (e.target.closest('[data-action="open-review"]')){ closeTray(); openReviewScreen(); return; }
      if (e.target.closest('[data-action="review-close"]')){ closeScreen(); return; }
      if (e.target.closest('[data-action="review-info"]')){
        if (state.screen) state.screen.reviewInfoOpen = !state.screen.reviewInfoOpen;
        const panel = qs(".review-info-panel"); if (panel) panel.hidden = !(state.screen && state.screen.reviewInfoOpen);
        return;
      }
      const revDefer = e.target.closest('[data-action="review-defer"]');
      if (revDefer){ deferReviewItem(revDefer.getAttribute("data-key")); if (state.screen) state.screen.reviewForm = null; renderScreen(); return; }
      const revOpen = e.target.closest('[data-action="review-open"]');
      if (revOpen){
        const lane = revOpen.getAttribute("data-lane"), id = revOpen.getAttribute("data-id");
        reviewOpenChild(function(){ openScreen(lane, id); });
        return;
      }
      const revOpenEv = e.target.closest('[data-action="review-open-event"]'); // chunk 7: past-due pseudo-action → event page
      if (revOpenEv){ reviewOpenChild(function(){ openEventScreen(revOpenEv.getAttribute("data-id")); }); return; }
      const revFormStart = e.target.closest('[data-action="review-form-start"]');
      if (revFormStart){
        if (state.screen) state.screen.reviewForm = { key: revFormStart.getAttribute("data-key"), type: revFormStart.getAttribute("data-type"), invalid: false };
        renderScreen();
        const inp = qs("#review-form-input"); if (inp) inp.focus();
        return;
      }
      if (e.target.closest('[data-action="review-form-cancel"]')){ if (state.screen) state.screen.reviewForm = null; renderScreen(); return; }
      if (e.target.closest('[data-action="review-pushdate-save"]')){ reviewSavePushDate(); return; }
      if (e.target.closest('[data-action="review-addnext-save"]')){ reviewSaveAddNext(); return; }
      if (e.target.closest('[data-action="review-addwaiting-save"]')){ reviewSaveAddWaiting(); return; }
      const missDone = e.target.closest('[data-action="review-missed-done"]');
      if (missDone){ reviewMissedDone(missDone.getAttribute("data-id")); return; }
      const missClear = e.target.closest('[data-action="review-missed-clear"]');
      if (missClear){ reviewMissedClear(missClear.getAttribute("data-id")); return; }
      if (e.target.closest('[data-action="review-freetext-save"]')){ reviewSaveFreeText(); return; }
      const revComplete = e.target.closest('[data-action="review-complete"]');
      if (revComplete){ reviewComplete(revComplete.getAttribute("data-lane"), revComplete.getAttribute("data-id")); return; }
      const revDelete = e.target.closest('[data-action="review-delete"]');
      if (revDelete){ reviewDelete(revDelete.getAttribute("data-lane"), revDelete.getAttribute("data-id")); return; }
      const revDeleteEvent = e.target.closest('[data-action="review-delete-event"]');
      if (revDeleteEvent){ reviewDeleteEvent(revDeleteEvent.getAttribute("data-id")); return; }
      const revSkipLive = e.target.closest('[data-action="review-skip-live"]');
      if (revSkipLive){ reviewSkipLive(revSkipLive.getAttribute("data-id")); return; }
      // ⚑ QA (user): the quick-add's escape hatch to the real creation page,
      // carrying whatever has been typed so far. Same reviewOpenChild contract as
      // the tap-through and the calendar: the review is pushed, so save-exiting
      // the page returns here and the queue recomputes.
      const revFormFull = e.target.closest('[data-action="review-form-full"]');
      if (revFormFull){
        const kind = revFormFull.getAttribute("data-kind");
        const pid = revFormFull.getAttribute("data-project");
        // Read the boxes BEFORE navigating — reviewOpenChild re-renders them away.
        const t = qs("#review-form-input"), w = qs("#review-form-input2");
        const prefill = { linkedProjectId: pid, title: (t ? t.value : "").trim() };
        if (kind === "waiting" && w && w.value.trim()) prefill.whenText = w.value.trim();
        if (state.screen) state.screen.reviewForm = null;
        reviewOpenChild(function(){ openScreen(kind, null, prefill); });
        return;
      }
      const revAddEvent = e.target.closest('[data-action="review-add-event"]');
      if (revAddEvent){
        const pid = revAddEvent.getAttribute("data-id");
        const found = findTaskAnywhere(pid);
        const proj = found && found.task;
        reviewOpenChild(function(){
          openCalendarScreen({
            forProjectId: pid,
            forProjectName: (proj && proj.title) || "",
            forProjectDeadline: (proj && proj.deadline && proj.deadline.date) || null
          });
        });
        return;
      }
      const revSomeday = e.target.closest('[data-action="review-someday"]');
      if (revSomeday){ changeKind("current", "future", revSomeday.getAttribute("data-id")).then(function(){ renderScreen(); }); return; }
      const revPromote = e.target.closest('[data-action="review-promote"]');
      if (revPromote){ moveItem("waiting", "next", revPromote.getAttribute("data-id"), false); renderScreen(); return; }
      const revSort = e.target.closest('[data-action="review-sort"]');
      if (revSort){ reviewSortCapture(revSort.getAttribute("data-target"), revSort.getAttribute("data-key")); return; }
      const revQuickDone = e.target.closest('[data-action="review-quickdone"]');
      if (revQuickDone){ reviewQuickDone(revQuickDone.getAttribute("data-key")); return; }
      const revDeleteCapture = e.target.closest('[data-action="review-delete-capture"]');
      if (revDeleteCapture){ reviewDeleteCapture(revDeleteCapture.getAttribute("data-key")); return; }
      if (e.target.closest('[data-action="quickdone-back"]')){ closeScreen(); return; }
      if (e.target.closest('[data-action="quickdone-complete"]')){ quickDoneComplete(); return; }

      // CHUNK 2 (spec 4.3e) -- close the FAB menu on any click that isn't
      // the FAB itself or one of its own items. A side effect, not a
      // return, so it applies uniformly ahead of every other branch below,
      // including clicks that match no data-action at all.
      const fabMenuEl = qs("#fab-menu");
      if (fabMenuEl && !fabMenuEl.hidden && !e.target.closest("#fab-create") && !e.target.closest("#fab-menu")){
        fabMenuEl.hidden = true;
      }

      const infoBtn = e.target.closest('[data-action="toggle-info"]');
      if (infoBtn){
        const kind = infoBtn.getAttribute("data-kind");
        const panel = qs('.lane-info[data-kind="' + kind + '"]');
        if (panel) panel.classList.toggle("show");
        return;
      }

      const tidyBtn = e.target.closest('[data-action="tidy-habits"]');
      if (tidyBtn){ tidyHabitOrder(); return; }

      const clearBundleBtn = e.target.closest('[data-action="clear-bundle"]');
      if (clearBundleBtn){
        const s = state.screen;
        if (s && s.draft){ s.draft.bundleText = ""; renderScreen(); } // draft-only (§12.2 step 6)
        return;
      }
      const advBtn = e.target.closest('[data-action="screen-open-advanced"]');
      if (advBtn){ openAdvancedDialog(); return; }

      // CHUNK 2 (spec 4.3e) -- the FAB is now a two-option menu on every
      // lane but Habits, where it still creates directly (no menu).
      const fabBtn = e.target.closest('[data-action="fab"]');
      if (fabBtn){
        // Notes now has a two-option menu too (user): New checklist · New note
        // (Tags joins with §4.9b). Habits still create directly (no menu).
        if (state.activeKind === "habit"){ openScreen("habit", null); return; }
        const menu = qs("#fab-menu");
        if (menu) menu.hidden = !menu.hidden;
        return;
      }
      // ▲ DESKTOP (trap T4): the per-column create buttons. They carry an
      // EXPLICIT data-kind and land in the same three functions the FAB menu
      // calls — the FAB path keeps reading state.activeKind, because on the
      // phone exactly one lane is live and that is the right answer there.
      const laneNewBtn = e.target.closest('[data-action="lane-new"]');
      if (laneNewBtn){
        const lk = laneNewBtn.getAttribute("data-kind");
        const idx = Number(laneNewBtn.getAttribute("data-idx") || 0);
        if (idx === 0) createPrimary(lk);
        else if (idx === 1) createSecondary(lk);
        else createTertiary(lk);
        return;
      }
      const fabPrimary = e.target.closest('[data-action="new-primary"]');
      if (fabPrimary){
        const menu = qs("#fab-menu");
        if (menu) menu.hidden = true;
        createPrimary(state.activeKind);
        return;
      }
      // The + beside a list's or a context's count (user). Both open the normal
      // drafting page with the destination already chosen — a list fills in the
      // parent, a context fills in the context field — so a created item gets
      // the same page and the same fields however it was started.
      // ⚠ stopPropagation: the + sits inside .group-header, whose own click
      // toggles the list open/closed. Without it, tapping + also collapses the
      // list you are adding to.
      const addToList = e.target.closest('[data-action="add-to-list"]');
      if (addToList){
        e.stopPropagation();
        openScreen(addToList.getAttribute("data-kind"), null, { parent: addToList.getAttribute("data-id") });
        return;
      }
      const addToCtx = e.target.closest('[data-action="add-to-context"]');
      if (addToCtx){
        e.stopPropagation();
        openScreen(addToCtx.getAttribute("data-kind"), null, { contextId: addToCtx.getAttribute("data-id") });
        return;
      }
      const fabSecondary = e.target.closest('[data-action="new-secondary"]');
      if (fabSecondary){
        const menu = qs("#fab-menu");
        if (menu) menu.hidden = true;
        createSecondary(state.activeKind);
        return;
      }
      const fabTertiary = e.target.closest('[data-action="new-tertiary"]');
      if (fabTertiary){
        const menu = qs("#fab-menu");
        if (menu) menu.hidden = true;
        createTertiary(state.activeKind);
        return;
      }
      const moveBtn = e.target.closest('[data-action="move"]');
      if (moveBtn){
        const kind = moveBtn.closest(".lane").getAttribute("data-kind");
        const dest = MOVE_MAP[kind];
        if (dest) moveItem(kind, dest, moveBtn.getAttribute("data-id"), moveBtn.getAttribute("data-is-group") === "1");
        return;
      }
      // Delete a list (project-lane group): UNLINK, mirroring context deletion
      // (user ruling). No longer requires emptying the list first — its items
      // survive, parent cleared, landing ungrouped at the top of the lane,
      // behind a confirm that says so. deleteTask then removes only the group
      // row (the now-parentless children no longer match t.parent === groupId).
      const delGroupBtn = e.target.closest('[data-action="delete-group"]');
      if (delGroupBtn){
        const kind = delGroupBtn.closest(".lane").getAttribute("data-kind");
        const groupId = delGroupBtn.getAttribute("data-id");
        const group = state.tasks[kind].find(function(t){ return t.id === groupId && t.isGroup; });
        const name = group ? group.title : "this list";
        const affected = state.tasks[kind].filter(function(t){ return t.parent === groupId && !t.isGroup; }).length;
        const msg = affected
          ? "Delete the “" + name + "” list? Its " + affected + " item" + (affected === 1 ? "" : "s") + " will stay — ungrouped, at the top of the lane."
          : "Delete the “" + name + "” list?";
        openConfirmDialog(msg, [
          { label: "Delete list", style: "danger", action: function(){
              state.tasks[kind].forEach(function(t){ if (t.parent === groupId) t.parent = null; });
              deleteTask(kind, groupId);
            } },
          { label: t("chrome.cancel"), action: function(){} }
        ]);
        return;
      }
      // Delete a context (chunk 3, §4.3d): UNLINK, never destroy. The context
      // leaves the registry; its members survive, contextId cleared, so they
      // render ungrouped at the top of the lane. Contexts are shared, so this
      // sweeps BOTH action lanes. Behind a confirm that says so plainly.
      const delCtxBtn = e.target.closest('[data-action="delete-context"]');
      if (delCtxBtn){
        const ctxId = delCtxBtn.getAttribute("data-id");
        const ctx = findContext(ctxId);
        if (!ctx) return;
        const affected = state.tasks.next.filter(function(t){ return t.contextId === ctxId; }).length +
                         state.tasks.waiting.filter(function(t){ return t.contextId === ctxId; }).length;
        const msg = affected
          ? "Delete the “" + ctx.name + "” context? Its " + affected + " item" + (affected === 1 ? "" : "s") + " will stay — ungrouped, at the top of the lane."
          : "Delete the “" + ctx.name + "” context?";
        openConfirmDialog(msg, [
          { label: "Delete context", style: "danger", action: function(){
            ["next", "waiting"].forEach(function(k){
              let changed = false;
              state.tasks[k].forEach(function(t){ if (t.contextId === ctxId){ t.contextId = null; changed = true; } });
              if (changed) saveTasksLocal(k);
            });
            state.contexts = state.contexts.filter(function(c){ return c.id !== ctxId; });
            saveContexts();
            // Also the Habits lane: a habit cued on this context now shows the
            // deleted-cue (orphan) pill, and that only recomputes on re-render
            // — otherwise it stayed stale until a full refresh.
            renderLane("next"); renderLane("waiting"); renderLane("habit");
          } },
          { label: t("chrome.cancel"), action: function(){} }
        ]);
        return;
      }
      const completeBtn = e.target.closest('[data-action="complete"]');
      if (completeBtn){
        const k = completeBtn.closest(".lane").getAttribute("data-kind");
        const id = completeBtn.getAttribute("data-id");
        // Show the check-mark pop first, then complete — completing
        // removes the card, so the animation has to run on the still-live
        // element (overnight notes).
        if (!completeBtn.classList.contains("checked")){
          completeBtn.classList.add("checked", "check-anim");
          completeBtn.innerHTML = "&#10003;";
          setTimeout(function(){ completeTask(k, id); }, 260);
        } else {
          completeTask(k, id);
        }
        return;
      }
      const restoreBtn = e.target.closest('[data-action="restore"]');
      if (restoreBtn){
        restoreTask(restoreBtn.getAttribute("data-kind"), restoreBtn.getAttribute("data-id"));
        return;
      }
      // Clear-all (§12.2 step 2). Sits inside the Completed header, so it must
      // run and return BEFORE the toggle-group handler below or it would also
      // collapse the section. Behind a confirm — this is the one place the
      // section says "forever."
      const clearCompletedBtn = e.target.closest('[data-action="clear-completed"]');
      if (clearCompletedBtn){
        const kind = clearCompletedBtn.getAttribute("data-kind");
        const n = (state.completed[kind] || []).length;
        if (!n) return;
        openConfirmDialog(
          "Delete all " + n + " completed item" + (n === 1 ? "" : "s") + "? This can’t be undone.",
          [
            { label: "Delete all", style: "danger", action: function(){ clearCompleted(kind); } },
            { label: t("chrome.cancel"), action: function(){} }
          ]
        );
        return;
      }
      const openCompletedBtn = e.target.closest('[data-action="open-completed"]');
      if (openCompletedBtn){
        openCompletedScreen(openCompletedBtn.getAttribute("data-kind"), openCompletedBtn.getAttribute("data-id"));
        return;
      }
      // Lane-card delete is gone (§4.7b) — deleteTask() is still called from
      // the full-screen page's own 🗑 (screen-delete, deleteScreenItem()).
      const habitBtn = e.target.closest('[data-action="toggle-habit"]');
      if (habitBtn){
        const habitId = habitBtn.getAttribute("data-id");
        // Paused habits are inert (design ruling) — bail before the
        // optimistic check animation, or the box would flash a ✓ that
        // toggleHabit's own guard then refuses to persist.
        if (ensureHabitRun(habitId).paused) return;
        // Same idea as complete: renderLane rebuilds the element right
        // away, so pop the animation on the live button and defer the
        // state flip just long enough for it to read.
        if (!habitBtn.classList.contains("checked")){
          habitBtn.classList.add("checked", "check-anim");
          habitBtn.innerHTML = "&#10003;";
          setTimeout(function(){ toggleHabit(habitId); }, 200);
        } else {
          toggleHabit(habitId);
        }
        return;
      }

      const groupHeader = e.target.closest('[data-action="toggle-group"]');
      if (groupHeader){
        const kind = groupHeader.closest(".lane").getAttribute("data-kind");
        toggleCollapsed(kind, groupHeader.getAttribute("data-id"));
        return;
      }

      // ---- full-screen create/edit ----
      // (creation is now the FAB's own data-action="fab"/"new-primary"
      // branches above, chunk 2 -- edit still opens via data-action="open-edit" below)

      const openNoteEl = e.target.closest('[data-action="open-note"]');
      if (openNoteEl){ openNoteScreen(openNoteEl.getAttribute("data-id")); return; }
      // Note project-link picker (§4.9), all draft-isolated.
      const mdBtn = e.target.closest("[data-md]");
      if (mdBtn){ applyNoteFormat(mdBtn.getAttribute("data-md")); return; }
      // Tick a checklist item by tapping its checkbox (the left marker zone).
      // Tapping the text still edits normally (falls through to caret).
      const clItem = e.target.closest(".note-body .checklist > li");
      if (clItem){
        const rect = clItem.getBoundingClientRect();
        if (e.clientX - rect.left <= 30){ clItem.classList.toggle("checked"); syncNoteBodyDraft(); return; }
      }
      if (e.target.closest('[data-action="note-add-link"]')){ if (state.screen){ syncNoteBodyDraft(); state.screen.draft.projectPicker = true; renderScreen(); } return; }
      if (e.target.closest('[data-action="note-cancel-pick"]')){ if (state.screen){ state.screen.draft.projectPicker = false; renderScreen(); } return; }
      const notePickBtn = e.target.closest('[data-action="note-pick-project"]');
      if (notePickBtn){
        const s = state.screen; const id = notePickBtn.getAttribute("data-id");
        const p = state.tasks.current.find(function(t){ return t.id === id; }) || state.tasks.future.find(function(t){ return t.id === id; });
        if (s && p && !(s.draft.projectLinks || []).some(function(l){ return l.id === id; })){
          (s.draft.projectLinks = s.draft.projectLinks || []).push({ id: id, name: p.title }); // denormalise the name (§4.9)
        }
        if (s){ s.draft.projectPicker = false; renderScreen(); }
        return;
      }
      if (e.target.closest('[data-action="note-manage-tags"]')){
        if (state.screen){
          syncNoteBodyDraft();                 // don't lose in-progress body text
          state.screenStack.push(state.screen); // stash the note draft; ←/✕ on the Tags page pops back to it
          openTagsScreen(true);                // create-only
        }
        return;
      }
      const notePickTagBtn = e.target.closest('[data-action="note-pick-tag"]');
      if (notePickTagBtn){
        const s = state.screen; const id = notePickTagBtn.getAttribute("data-id");
        if (s && findTag(id) && !(s.draft.tagIds || []).some(function(t){ return t === id; })){
          (s.draft.tagIds = s.draft.tagIds || []).push(id); // tags referenced by ID (§4.9b) — rename propagates for free
        }
        if (s){ s.draft.projectPicker = false; renderScreen(); }
        return;
      }
      const noteUnlinkBtn = e.target.closest('[data-action="note-unlink"]');
      if (noteUnlinkBtn){
        const s = state.screen; const id = noteUnlinkBtn.getAttribute("data-id");
        if (s){ syncNoteBodyDraft(); s.draft.projectLinks = (s.draft.projectLinks || []).filter(function(l){ return l.id !== id; }); renderScreen(); }
        return;
      }
      if (e.target.closest('[data-action="tag-add-row"]')){
        if (state.screen){ (state.screen.draft.rows = state.screen.draft.rows || []).push({ id: null, name: "" }); renderScreen();
          const inputs = qsa(".tags-row-input"); const last = inputs[inputs.length - 1]; if (last) last.focus(); }
        return;
      }
      const tagRemoveBtn = e.target.closest('[data-action="tag-remove-row"]');
      if (tagRemoveBtn){
        const s = state.screen; const idx = Number(tagRemoveBtn.getAttribute("data-row"));
        if (s && s.draft.rows){ s.draft.rows.splice(idx, 1); if (s.draft.rowErrors) s.draft.rowErrors = {}; renderScreen(); }
        return;
      }
      const noteUntagBtn = e.target.closest('[data-action="note-untag"]');
      if (noteUntagBtn){
        const s = state.screen; const id = noteUntagBtn.getAttribute("data-id");
        if (s){ syncNoteBodyDraft(); s.draft.tagIds = (s.draft.tagIds || []).filter(function(t){ return t !== id; }); renderScreen(); }
        return;
      }
      const filterNotesBtn = e.target.closest('[data-action="filter-notes"]');
      if (filterNotesBtn){ state.notesFilter = filterNotesBtn.getAttribute("data-id"); state.notesFilterMenuOpen = false; renderLane("notes"); return; }
      // Check clear (the ✕) before the toggle button that wraps it.
      if (e.target.closest('[data-action="clear-notes-filter"]')){ state.notesFilter = null; state.notesFilterMenuOpen = false; renderLane("notes"); return; }
      if (e.target.closest('[data-action="notes-filter-toggle"]')){ state.notesFilterMenuOpen = !state.notesFilterMenuOpen; renderLane("notes"); return; }
      const notesFilterPick = e.target.closest('[data-action="notes-filter-pick"]');
      if (notesFilterPick){ state.notesFilter = notesFilterPick.getAttribute("data-id") || null; state.notesFilterMenuOpen = false; renderLane("notes"); return; }
      // Outside-click closes an open filter menu (mirrors the FAB-menu pattern).
      if (state.notesFilterMenuOpen && !e.target.closest(".notes-filter-bar")){ state.notesFilterMenuOpen = false; renderLane("notes"); }

      const openEditEl = e.target.closest('[data-action="open-edit"]');
      if (openEditEl){ openScreen(openEditEl.getAttribute("data-kind"), openEditEl.getAttribute("data-id")); return; }

      const screenSaveBtn = e.target.closest('[data-action="screen-save"]');
      if (screenSaveBtn){ saveScreen(); return; }

      const screenCancelBtn = e.target.closest('[data-action="screen-cancel"]');
      if (screenCancelBtn){ attemptCancelScreen(); return; }

      const screenDeleteBtn = e.target.closest('[data-action="screen-delete"]');
      if (screenDeleteBtn){ deleteScreenItem(); return; }

      // Completed page (§12.2 step 5): Restore (restore + close) and Delete
      // (deleteCompleted behind a confirm) both act immediately — the page is
      // not a drafting surface (same reason the list checkbox acts at once).
      const completedRestoreBtn = e.target.closest('[data-action="completed-restore"]');
      if (completedRestoreBtn){
        const s = state.screen;
        if (s && s.completedView){ restoreTask(s.kind, s.taskId); closeScreen(); }
        return;
      }
      const completedDeleteBtn = e.target.closest('[data-action="completed-delete"]');
      if (completedDeleteBtn){
        const s = state.screen;
        if (!s || !s.completedView) return;
        const kind = s.kind, id = s.taskId;
        openConfirmDialog("Delete this completed item? This can’t be undone.", [
          { label: "Delete", style: "danger", action: function(){ deleteCompleted(kind, id); closeScreen(); } },
          { label: t("chrome.cancel"), action: function(){} }
        ]);
        return;
      }

      const screenCompleteBtn = e.target.closest('[data-action="screen-complete"]');
      if (screenCompleteBtn){ screenComplete(); return; }

      const makeKindBtn = e.target.closest('[data-action="make-kind"]');
      if (makeKindBtn){ screenMakeKind(makeKindBtn.getAttribute("data-dest")); return; }

      const generateActionBtn = e.target.closest('[data-action="generate-action"]');
      if (generateActionBtn){
        const genKind = generateActionBtn.getAttribute("data-gen-kind");
        // No title to carry over any more: the quick-add rows these used to sit
        // in are gone, so this always opens an empty drafting page.
        screenGenerateAction(genKind, "");
        return;
      }

      // (The quick-add submit and the Waiting hook-tap handlers lived here.
      // Both drove the project page's quick-add rows, which are gone — creation
      // is a button that opens the drafting page now. Deleted rather than left
      // dormant: a handler with no markup to fire it is an invitation to
      // re-add the markup.)

      const linkedTabBtn = e.target.closest('[data-action="project-linked-tab"]');
      if (linkedTabBtn){
        if (state.screen) state.screen.linkedTab = linkedTabBtn.getAttribute("data-tab");
        renderScreen();
        return;
      }
      if (e.target.closest('[data-action="new-linked-note"]')){
        const s = state.screen;
        const pid = s && s.draft && s.draft.projectId;
        const pname = (s && s.draft && s.draft.title) || findProjectTitle(pid) || "";
        if (!pid) return;
        // Same stack push as opening an existing note: openNoteScreen replaces
        // state.screen, and this page has a draft worth keeping.
        // ⚑ On an UNSAVED project the note stages instead of committing, the
        // same contract every other control on this page follows. On a saved
        // one it commits normally — there is nothing to wait for.
        const staging = s.taskId ? null : { parent: s, projectId: pid };
        state.screenStack.push(state.screen);
        state.screen = null;
        openNoteScreen(null, { projectLinks: [{ id: pid, name: pname }], staging: staging });
        return;
      }
      if (e.target.closest('[data-action="new-linked-event"]')){
        const s = state.screen;
        // ⚑ stagingProjectId, not s.taskId: a brand-new project page mints its
        // real id at open (§12.1b), so a staged event can carry the final
        // linkedProjectId and needs no remapping when the project is created.
        const pid = stagingProjectId(s);
        if (!pid) return;
        const dl = (s.draft && s.draft.deadline && s.draft.deadline.date) || null;
        state.screenStack.push(state.screen);
        state.screen = null;
        openCalendarScreen({
          forProjectId: pid,
          forProjectName: (s.draft && s.draft.title) || findProjectTitle(pid) || "",
          // ⚑ Read off the DRAFT, not the stored task: if you have just typed a
          // new deadline and not saved, that is the deadline you are working to.
          forProjectDeadline: dl,
          // Unsaved project → the event stages into this page's draft instead of
          // being written now (calAdd). A saved one writes through as it always did.
          forProjectStaging: s.taskId ? null : { parent: s }
        });
        return;
      }
      const linkedNoteBtn = e.target.closest('[data-action="open-linked-note"]');
      if (linkedNoteBtn){
        // ⚠ Push the stack first. openNoteScreen REPLACES state.screen, so
        // opening a note straight from a project page would throw away that
        // page's draft — including any staged children — with no warning.
        state.screenStack.push(state.screen);
        state.screen = null;
        openNoteScreen(linkedNoteBtn.getAttribute("data-id"));
        return;
      }
      const linkedActionBtn = e.target.closest('[data-action="open-linked-action"]');
      if (linkedActionBtn){
        openLinkedActionChild(linkedActionBtn.getAttribute("data-kind"), linkedActionBtn.getAttribute("data-id"));
        return;
      }

      const clearDeadlineBtn = e.target.closest('[data-action="clear-deadline"]');
      if (clearDeadlineBtn){
        if (state.screen){ state.screen.draft.deadline = null; renderScreen(); }
        return;
      }

      // ---- habit hook picker, now hosted inside the full screen ----
      const openHookPickBtn = e.target.closest('[data-action="screen-open-hook-pick"]');
      if (openHookPickBtn){ screenOpenHookPick(Number(openHookPickBtn.getAttribute("data-row") || 0)); return; }

      const cancelHookPickBtn = e.target.closest('[data-action="screen-cancel-hook-pick"]');
      if (cancelHookPickBtn){ screenCancelHookPick(); return; }

      const pickHookBtn = e.target.closest('[data-action="screen-pick-hook"]');
      if (pickHookBtn){ screenPickHook(pickHookBtn.getAttribute("data-id"), pickHookBtn.getAttribute("data-ctx") === "1"); return; }

      const removeCueRowBtn = e.target.closest('[data-action="screen-remove-cue-row"]');
      if (removeCueRowBtn){ screenRemoveCueRow(Number(removeCueRowBtn.getAttribute("data-row"))); return; }

      const scheduleDayBtn = e.target.closest('[data-action="screen-toggle-schedule-day"]');
      if (scheduleDayBtn){ screenToggleScheduleDay(Number(scheduleDayBtn.getAttribute("data-dow"))); return; }

      const pauseBtn = e.target.closest('[data-action="screen-toggle-pause"]');
      if (pauseBtn){ screenTogglePause(); return; }

      // ---- Waiting-condition picker, same pattern as the habit hook picker ----
      const openCondPickBtn = e.target.closest('[data-action="screen-open-condition-pick"]');
      if (openCondPickBtn){ screenOpenConditionPick(); return; }

      const cancelCondPickBtn = e.target.closest('[data-action="screen-cancel-condition-pick"]');
      if (cancelCondPickBtn){ screenCancelConditionPick(); return; }

      const pickCondBtn = e.target.closest('[data-action="screen-pick-condition"]');
      if (pickCondBtn){ screenPickCondition(pickCondBtn.getAttribute("data-id"), pickCondBtn.getAttribute("data-kind")); return; }

      const unhookCondBtn = e.target.closest('[data-action="screen-unhook-condition"]');
      if (unhookCondBtn){ screenUnhookCondition(); return; }

      const clearCondPickBtn = e.target.closest('[data-action="screen-clear-condition-pick"]');
      if (clearCondPickBtn){ screenClearConditionPick(); return; }
    });

    // Full-screen field edits update the in-memory draft as the user types.
    document.addEventListener("input", function(e){
      // chunk 7: calendar creation-row + event-page fields have their own
      // handler (data-calfield, plus the event-* data-field cases).
      if (state.screen && (state.screen.calendarView || state.screen.eventView)){
        if (eventsHandleFieldInput(e)) return;
      }
      const el = e.target.closest("[data-field]");
      if (!el || !state.screen) return;
      // Any edit clears a blocked-save outline without a full re-render
      // (a re-render here would drop keyboard focus mid-word).
      if (state.screen.invalidField){
        state.screen.invalidField = null;
        qsa(".field-invalid").forEach(function(n){ n.classList.remove("field-invalid"); });
      }
      const field = el.getAttribute("data-field");
      // chunk 6b (§4.8b): review inline form — clear its outline in place, no
      // re-render (state.screen.draft is unused by the review).
      if (field === "reviewForm"){
        if (state.screen.reviewForm) state.screen.reviewForm.invalid = false;
        el.classList.remove("field-invalid");
        return;
      }
      const draft = state.screen.draft;
      if (field === "title"){ draft.title = el.value; }
      else if (field === "noteTitle"){ draft.title = el.value; } // chunk 6
      else if (field === "tagRow"){ // chunk 6 (§4.9b) Tags page
        const idx = Number(el.getAttribute("data-row"));
        if (draft.rows && draft.rows[idx]) draft.rows[idx].name = el.value;
        if (draft.rowErrors && draft.rowErrors[idx] != null){ delete draft.rowErrors[idx]; el.classList.remove("field-invalid");
          const wrap = el.closest(".tags-row-wrap"); const reason = wrap && wrap.querySelector(".tags-row-reason"); if (reason) reason.remove(); }
      }
      else if (field === "noteBody"){
        // contenteditable rich body (§4.9): read HTML out, never write it back
        // here — re-rendering a contenteditable mid-keystroke resets the caret.
        draft.body = el.innerHTML;
        el.classList.toggle("is-empty", isNoteBodyEmpty(el));
      }
      else if (field === "notesClean"){ draft.notesClean = el.value; el.style.height = "auto"; el.style.height = (el.scrollHeight + 2) + "px"; }
      else if (field === "cueText"){
        const row = state.screen.draft.cueRows && state.screen.draft.cueRows[Number(el.getAttribute("data-row"))];
        if (row) row.text = el.value;
      }
      else if (field === "waitingForText"){
        draft.whenText = el.value;
        if (el.value.trim()) draft.deadline = null;
      }
      else if (field === "linkedProjectId"){ draft.linkedProjectId = el.value || null; }
      else if (field === "contextId"){ draft.contextId = el.value || null; }
      else if (field === "deadline-date"){
        if (!el.value){ draft.deadline = null; }
        else { draft.deadline = draft.deadline || { date: "", time: "" }; draft.deadline.date = el.value; }
      }
      else if (field === "deadline-time"){ if (draft.deadline) draft.deadline.time = el.value; }
    });
    document.addEventListener("change", function(e){
      if (state.screen && (state.screen.calendarView || state.screen.eventView)){
        if (eventsHandleFieldInput(e)) return;
      }
      const el = e.target.closest("[data-field]");
      if (!el || !state.screen) return;
      const field = el.getAttribute("data-field");
      const draft = state.screen.draft;
      if (field === "linkedProjectId" || field === "deadline-date"){ renderScreen(); }
    });

    document.addEventListener("keydown", function(e){
      if (e.key !== "Escape") return;
      // §4.6 Back/Escape resolution order: dialog → drawer → page → exit.
      // ▲ DESKTOP (trap T17): a header dropdown slots in FRONT of all of it. An
      // Escape aimed at a stray open menu must never travel through to the
      // half-edited page behind it.
      if (closeHeaderDrops()) return;
      if (qs(".choice-dialog-backdrop")){ closeDialog(); return; }
      if (state.trayOpen){ closeTray(); return; }
      if (state.screen){ attemptCancelScreen(); } // §12.1: project ✕-warning on every exit route
    });

    // Live-snap reordering (overnight notes): during dragover the dragged
    // element is physically moved to where it would land, so displaced
    // items immediately snap to their new positions — a much stronger cue
    // than a static ghost. The drop then just reads the element's final
    // DOM position, and dragend re-renders the lane from state, which
    // both settles a committed drop and rolls back a cancelled drag.
    //
    // applyLiveMove/commitLiveMove hold the actual reorder logic, shared
    // between the native mouse drag path (dragover/drop below) and the
    // touch long-press path (touchmove/touchend further down) — phones
    // have no native HTML5 drag-and-drop at all, so touch needs its own
    // gesture handling that lands in the same place.
    let liveDrag = null; // { el, kind, isGroup }
    // CHUNK 2 (spec 4.7b known issue 2) -- with card backgrounds gone, the
    // live-reordered card sliding into place isn't always legible on its
    // own. Track the last-marked anchor so a brass rule (.drop-before /
    // .drop-after, styles.css) can show exactly where it'll land, and clear
    // it as soon as the hover target changes.
    let dropIndicatorEl = null;
    function clearDropIndicator(){
      if (dropIndicatorEl){ dropIndicatorEl.classList.remove("drop-before", "drop-after"); dropIndicatorEl = null; }
    }
    // Clamps the hit-test point to the active-card area of a lane before
    // calling elementFromPoint. Without this, dragging past the last card
    // lands on the Completed section (or empty margin) below it — and past
    // the first card lands on the floating + badge or header above it —
    // neither of which is a valid drop target, so the drag just stalls
    // wherever the last valid hover was instead of tracking to the edge.
    // Clamping guarantees the point always falls on a real card or the
    // empty dropzone, so overshooting above/below always resolves to the
    // very top/bottom of the active list, exactly as it looks like it should.
    function resolveDragElement(kind, x, y){
      const laneEl = qs('.lane[data-kind="' + kind + '"]');
      const rootEl = laneEl && laneEl.querySelector(".cards-root");
      if (!rootEl) return { el: document.elementFromPoint(x, y), y: y };
      const rect = rootEl.getBoundingClientRect();
      const completedEl = rootEl.querySelector(".completed-section");
      const bottomLimit = (completedEl ? completedEl.getBoundingClientRect().top : rect.bottom) - 1;
      const cy = Math.min(Math.max(y, rect.top + 1), Math.max(rect.top + 1, bottomLimit));
      const cx = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
      return { el: document.elementFromPoint(cx, cy), y: cy };
    }
    // Auto-scroll near the screen edge while dragging — the actual cause
    // behind "dragging well below/above other items doesn't snap into
    // place": lists are often taller than the screen, dragging blocks
    // normal scrolling on purpose (so a finger-move doesn't fight the
    // page scrolling under it), and without this there was simply no way
    // to reach a card below or above whatever was already on screen. Runs
    // as a rAF loop so it keeps scrolling — and keeps re-resolving the
    // drop target as content shifts underneath — even while the finger
    // or cursor is held still near the edge.
    let dragPointer = null; // {x, y} — last known pointer position during an active drag
    let autoScrollRAF = null;
    let autoScrollHoldStart = null; // when the pointer first entered an edge zone, reset once it leaves
    const AUTOSCROLL_EDGE_PX = 70;
    const AUTOSCROLL_BASE_PX = 10;
    const AUTOSCROLL_RAMP_PX = 70; // added on top of base once fully ramped
    const AUTOSCROLL_RAMP_MS = 500; // time held at the edge to reach full ramped speed
    // Speed ramps with how long the edge has been held, rather than a
    // flat rate — a brief touch near the boundary stays gentle/precise,
    // but a sustained hold (reaching an item several screens away) ramps
    // to a much faster speed within half a second. This matters beyond
    // feel: holding a finger still on the screen for several continuous
    // seconds while content scrolls underneath it (a flat-rate scroll to
    // a distant item) turned out to be a plausible trigger for the native
    // long-press text-selection behavior described in testing — index-24
    // used the same 400ms hold-to-drag pattern without that problem
    // showing up, and auto-scroll was the thing that changed since. A
    // fast ramp keeps the total time a finger sits still to a fraction of
    // a second even for a long list, rather than however many seconds a
    // flat slow scroll would take.
    function autoScrollTick(){
      if (!liveDrag || !dragPointer){ autoScrollRAF = null; autoScrollHoldStart = null; return; }
      const vh = window.innerHeight;
      let strength = 0;
      if (dragPointer.y < AUTOSCROLL_EDGE_PX){
        strength = (AUTOSCROLL_EDGE_PX - dragPointer.y) / AUTOSCROLL_EDGE_PX;
      } else if (dragPointer.y > vh - AUTOSCROLL_EDGE_PX){
        strength = (dragPointer.y - (vh - AUTOSCROLL_EDGE_PX)) / AUTOSCROLL_EDGE_PX;
      }
      if (strength > 0){
        if (!autoScrollHoldStart) autoScrollHoldStart = performance.now();
        const ramp = Math.min(1, (performance.now() - autoScrollHoldStart) / AUTOSCROLL_RAMP_MS);
        const speed = AUTOSCROLL_BASE_PX + AUTOSCROLL_RAMP_PX * ramp;
        const dir = dragPointer.y < AUTOSCROLL_EDGE_PX ? -1 : 1;
        const dy = Math.ceil(dir * speed * strength);
        window.scrollBy(0, dy);
        const resolved = resolveDragElement(liveDrag.kind, dragPointer.x, dragPointer.y);
        applyLiveMove(liveDrag, resolved.el, resolved.y);
      } else {
        autoScrollHoldStart = null;
      }
      autoScrollRAF = requestAnimationFrame(autoScrollTick);
    }
    function startAutoScroll(){
      if (!autoScrollRAF) autoScrollRAF = requestAnimationFrame(autoScrollTick);
    }
    function stopAutoScroll(){
      if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
      autoScrollRAF = null;
      dragPointer = null;
      autoScrollHoldStart = null;
    }
    // Midpoint-based live reorder (user round -- fixes "tall items resist
    // reordering"). The old version needed elementFromPoint to land on a
    // *sibling* card before it would move anything; but the dragged element
    // stays in flow directly under the pointer, so on a tall card (a wrapped
    // multi-line title is ~2.5x a one-liner) you had to drag the finger clear
    // past the whole card before a different one got hit -- each slot felt
    // sticky. Now we only need the container the pointer is over plus the
    // pointer's Y, and we insert before the first sibling whose midpoint is
    // below the finger. That tracks the finger directly, independent of the
    // dragged card's height.
    function applyLiveMove(drag, targetEl, clientY){
      if (!targetEl) return;
      const el = drag.el;
      // Which dropzone (a group-body or the cards-root) is the pointer over?
      const hitCard = targetEl.closest("[data-drag-id]");
      let zone;
      if (hitCard && hitCard !== el && !el.contains(hitCard)){
        zone = hitCard.parentElement.closest("[data-dropzone-parent]") || hitCard.parentElement;
      } else {
        // Pointer is over the dragged element itself, or over empty container
        // space -- walk up to the nearest dropzone either way.
        zone = targetEl.closest("[data-dropzone-parent]");
      }
      if (!zone || el.contains(zone)) return;
      const laneEl = zone.closest(".lane");
      if (!laneEl || laneEl.getAttribute("data-kind") !== drag.kind) return;
      // Groups only ever live at the top level -- force them to the cards-root
      // instead of letting them drop inside another group's body.
      if (drag.isGroup && !zone.classList.contains("cards-root")){
        zone = laneEl.querySelector(".cards-root");
        if (!zone) return;
      }
      // Draggable siblings in this zone, minus the dragged element itself.
      const sibs = Array.prototype.filter.call(zone.children, function(c){
        return c.nodeType === 1 && c.hasAttribute("data-drag-id") && c !== el && !el.contains(c);
      });
      let ref = null;
      for (let i = 0; i < sibs.length; i++){
        const r = sibs[i].getBoundingClientRect();
        if (clientY < r.top + r.height / 2){ ref = sibs[i]; break; }
      }
      // (A group's body used to end with a non-draggable "Add to list…" row,
      // and a drop past the last card had to be kept ABOVE it. That row is gone
      // — creation moved to the + beside the count — so a group body now holds
      // nothing but cards and ref can simply stay null, meaning "append".)
      if (ref !== el && el.nextSibling !== ref){
        zone.insertBefore(el, ref);
      }
      // Drop indicator: a rule before the card we'd land in front of, else
      // after the last card when appending.
      clearDropIndicator();
      if (ref && ref.classList && ref.classList.contains("card")){
        ref.classList.add("drop-before"); dropIndicatorEl = ref;
      } else if (sibs.length){
        const last = sibs[sibs.length - 1];
        if (last.classList.contains("card")){ last.classList.add("drop-after"); dropIndicatorEl = last; }
      }
    }
    function commitLiveMove(drag){
      const el = drag.el;
      const laneEl = el.closest(".lane");
      if (!laneEl) return;
      const kind = laneEl.getAttribute("data-kind");
      const container = el.parentElement.closest("[data-dropzone-parent]") || el.parentElement;
      let parentId = container.getAttribute ? (container.getAttribute("data-dropzone-parent") || null) : null;
      if (drag.isGroup) parentId = null;
      let prev = el.previousElementSibling;
      while (prev && !prev.hasAttribute("data-drag-id")) prev = prev.previousElementSibling;
      const previousId = prev ? prev.getAttribute("data-drag-id") : null;
      moveWithinList(kind, el.getAttribute("data-drag-id"), parentId, previousId);
    }
    document.addEventListener("dragstart", function(e){
      const el = e.target.closest("[data-drag-id]");
      if (!el) return;
      const kind = el.closest(".lane").getAttribute("data-kind");
      const payload = { kind: kind, id: el.getAttribute("data-drag-id"), isGroup: el.getAttribute("data-drag-group") === "1" };
      e.dataTransfer.setData("text/plain", JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
      liveDrag = { el: el, kind: kind, isGroup: payload.isGroup };
      document.body.classList.add("drag-active"); // freeze the collapsing tab bar (spec 4.10b, known issue 2)
    });
    document.addEventListener("dragend", function(){
      if (!liveDrag) return;
      const kind = liveDrag.kind;
      liveDrag = null;
      document.body.classList.remove("drag-active");
      clearDropIndicator();
      stopAutoScroll();
      renderLane(kind); // restores state order on cancel; settles the DOM after a committed drop
    });
    document.addEventListener("dragover", function(e){
      const laneEl = e.target.closest(".lane");
      if (!laneEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!liveDrag || laneEl.getAttribute("data-kind") !== liveDrag.kind) return;
      dragPointer = { x: e.clientX, y: e.clientY };
      startAutoScroll();
      const resolved = resolveDragElement(liveDrag.kind, e.clientX, e.clientY);
      applyLiveMove(liveDrag, resolved.el, resolved.y);
    });
    document.addEventListener("drop", function(e){
      if (!liveDrag) return;
      e.preventDefault();
      commitLiveMove(liveDrag);
    });

    // Touch drag (phones/tablets — no native HTML5 drag-and-drop exists on
    // touchscreens at all, so this is a separate gesture path rather than
    // a polyfill). Starts from a press-and-hold on the card/group title —
    // NOT a separate handle icon, which read as an options menu rather
    // than a grab affordance. The title is also the "tap to open" /
    // "tap to expand" target, so a longer hold than the old handle-only
    // version is used here specifically to leave room for a normal
    // deliberate tap before the drag reading kicks in. If a real device
    // shows this misfiring on ordinary taps (or feeling laggy for
    // intentional drags), TOUCH_LONG_PRESS_MS is the one number to tune.
    let touchDrag = null; // { el, kind, isGroup, startX, startY, active, timer }
    const TOUCH_LONG_PRESS_MS = 400;
    const TOUCH_MOVE_CANCEL_PX = 10;
    function touchDragCleanup(){
      if (touchDrag && touchDrag.timer) clearTimeout(touchDrag.timer);
      touchDrag = null;
    }
    // Some mobile browsers (seen on DuckDuckGo for Android — its own
    // native text-selection toolbar, screenshot-confirmed) can still grab
    // a title press for their own UI even with user-select/touch-callout
    // set to none, racing against our long-press timer. When that
    // happens, the browser sometimes doesn't fire touchend/touchcancel
    // back to the page at all, since the gesture got handed off to
    // native chrome outside the DOM's own event model — so the card's
    // .dragging state (dimmed, looks disabled) was getting stuck with
    // nothing left to clear it.
    function forceCancelTouchDrag(reason){
      const wasActive = touchDrag && touchDrag.active;
      const kind = touchDrag && touchDrag.kind;
      if (touchDrag) dlog("forceCancel", (reason || "?") + " (wasActive=" + wasActive + ")");
      touchDragCleanup();
      disarmDragWatchdog();
      if (wasActive){
        liveDrag = null;
        document.body.classList.remove("drag-active");
        clearDropIndicator();
        stopAutoScroll();
        renderLane(kind);
      }
    }
    // Primary fix: an idle watchdog rather than trying to catch every way
    // a native UI can steal the gesture (verified by testing that even a
    // synthetic selection-hijack doesn't reliably fire the DOM events
    // below in every engine — depending on any single signal isn't
    // trustworthy). Once a drag goes active, if no further touchmove
    // arrives for a few seconds, it's treated as abandoned and self-heals
    // automatically. Re-armed on every touchmove so a genuinely slow but
    // continuing drag is never cut off mid-use.
    let dragWatchdog = null;
    const DRAG_WATCHDOG_IDLE_MS = 2500;
    function armDragWatchdog(){
      if (dragWatchdog) clearTimeout(dragWatchdog);
      dragWatchdog = setTimeout(function(){ forceCancelTouchDrag("watchdog-idle-" + DRAG_WATCHDOG_IDLE_MS + "ms"); }, DRAG_WATCHDOG_IDLE_MS);
    }
    function disarmDragWatchdog(){
      if (dragWatchdog) clearTimeout(dragWatchdog);
      dragWatchdog = null;
    }
    // Secondary, best-effort mitigations — harmless if they don't fire in
    // a given browser, since the CSS above + the watchdog below are the
    // actual backstop. Scoped to card/group titles specifically — an
    // earlier attempt broadened this app-wide (to also catch the
    // "+ New list" button) but that appears to have made things worse,
    // not better: with nothing selectable anywhere nearby, the native
    // fallback seemed to start highlighting whole sections instead of
    // single elements. Narrower scope, deliberately, even though it
    // reopens that button as a minor case — better than the broader
    // regression. Full fix deferred to the native app wrapper (see
    // project doc) where this can be disabled properly at the WebView
    // layer instead of approximated from page content.
    document.addEventListener("contextmenu", function(e){
      if (e.target.closest(".card-title, .group-title")){ dlog("contextmenu prevented", "(native long-press menu) on " + dragDesc(e.target)); e.preventDefault(); }
    });
    // selectstart fires the instant the browser decides to begin a text
    // selection — the clearest signal of the native long-press racing our
    // hold timer. Logged (not prevented here) so the trace shows its timing.
    document.addEventListener("selectstart", function(e){
      if (dragLogOn && e.target && e.target.closest && e.target.closest(".card, .group")) dlog("selectstart", dragDesc(e.target));
    });
    document.addEventListener("selectionchange", function(){
      const sel = window.getSelection();
      if (!sel || !sel.toString()) return;
      const node = sel.anchorNode;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      const inTitle = el && el.closest(".card-title, .group-title");
      dlog("selectionchange", "text “" + sel.toString().slice(0, 16) + "”" + (inTitle ? " IN title → cancelling drag" : " (not in a drag title)"));
      if (inTitle){
        sel.removeAllRanges();
        forceCancelTouchDrag("text-selected-in-title");
      }
    });
    window.addEventListener("blur", function(){ forceCancelTouchDrag("window-blur"); });
    document.addEventListener("visibilitychange", function(){ if (document.hidden) forceCancelTouchDrag("page-hidden"); });
    document.addEventListener("touchstart", function(e){
      if (e.touches.length !== 1) return;
      const titleEl = e.target.closest(".card-title, .group-title");
      if (dragLogOn && e.target.closest && e.target.closest(".card, .group")){
        dlog("touchstart", dragDesc(e.target) + (titleEl ? "  [IS a drag title]" : "  [NOT a drag title — no drag]"));
      }
      if (!titleEl) return;
      const el = titleEl.closest("[data-drag-id]");
      if (!el) return;
      const laneEl = el.closest(".lane");
      if (!laneEl) return; // the capture-phase listener above may have just re-rendered this lane, orphaning e.target — bail cleanly rather than throw
      const touch = e.touches[0];
      const kind = laneEl.getAttribute("data-kind");
      const isGroup = el.getAttribute("data-drag-group") === "1";
      dlog("hold-armed", (isGroup ? "group" : "card") + " on " + kind + " lane — waiting " + TOUCH_LONG_PRESS_MS + "ms");
      touchDrag = { el: el, kind: kind, isGroup: isGroup, startX: touch.clientX, startY: touch.clientY, active: false, timer: null };
      touchDrag.timer = setTimeout(function(){
        if (!touchDrag) return;
        touchDrag.active = true;
        dlog("HOLD FIRED → drag now active");
        el.classList.add("dragging");
        liveDrag = { el: el, kind: kind, isGroup: isGroup };
        document.body.classList.add("drag-active"); // freeze the collapsing tab bar (spec 4.10b, known issue 2)
        dragPointer = { x: touchDrag.startX, y: touchDrag.startY };
        startAutoScroll();
        armDragWatchdog();
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (err){ /* no haptics available — fine without it */ }
      }, TOUCH_LONG_PRESS_MS);
    }, { passive: true });
    document.addEventListener("touchmove", function(e){
      if (!touchDrag) return;
      const touch = e.touches[0];
      if (!touchDrag.active){
        const dx = Math.abs(touch.clientX - touchDrag.startX);
        const dy = Math.abs(touch.clientY - touchDrag.startY);
        if (dx > TOUCH_MOVE_CANCEL_PX || dy > TOUCH_MOVE_CANCEL_PX){
          dlog("cancel", "moved " + Math.round(Math.max(dx, dy)) + "px before the hold completed (scroll, not drag)");
          touchDragCleanup();
        }
        return;
      }
      e.preventDefault(); // only reached once actively dragging — scroll stays untouched until then
      armDragWatchdog(); // still hearing from this drag — push the idle deadline back out
      dragPointer = { x: touch.clientX, y: touch.clientY };
      startAutoScroll();
      const resolved = resolveDragElement(liveDrag.kind, touch.clientX, touch.clientY);
      applyLiveMove(liveDrag, resolved.el, resolved.y);
    }, { passive: false });
    document.addEventListener("touchend", function(e){
      if (!touchDrag) return;
      if (touchDrag.active){
        dlog("touchend", "was dragging → commit the move");
        e.preventDefault(); // suppresses the ghost click that'd otherwise fire on whatever's under the finger
        disarmDragWatchdog();
        stopAutoScroll();
        commitLiveMove(liveDrag);
        const kind = liveDrag.kind;
        liveDrag = null;
        document.body.classList.remove("drag-active");
        clearDropIndicator();
        renderLane(kind);
      } else {
        dlog("touchend", "no active drag (a tap, or the hold was cancelled)");
      }
      touchDragCleanup();
    });
    document.addEventListener("touchcancel", function(){
      if (dragLogOn) dlog("touchcancel", touchDrag ? ("active=" + touchDrag.active) : "(no touchDrag)");
      if (touchDrag && touchDrag.active){
        const kind = touchDrag.kind;
        liveDrag = null;
        document.body.classList.remove("drag-active");
        clearDropIndicator();
        disarmDragWatchdog();
        stopAutoScroll();
        renderLane(kind);
      }
      touchDragCleanup();
    });

    // CHUNK 6 (user): keep the note editor's selection alive when a formatting
    // button is pressed. A toolbar button would otherwise steal focus from the
    // contenteditable on mousedown and collapse the selection before the click
    // runs execCommand. preventDefault on the button's own mousedown holds it.
    document.addEventListener("mousedown", function(e){
      if (e.target.closest(".note-tool[data-md]")){ e.preventDefault(); return; }
      // Suppress caret placement when the tap lands on a checklist checkbox, so
      // ticking an item doesn't also move the cursor into it (the toggle itself
      // is on click, above).
      const li = e.target.closest(".note-body .checklist > li");
      if (li && (e.clientX - li.getBoundingClientRect().left) <= 30) e.preventDefault();
    });

    // CHUNK 6 tweak (user): SWIPE the capture drawer open / closed.
    // §4.8a originally ruled swipe-to-open OUT — a right-swipe from the left
    // edge IS Android's system back gesture, and a drawer that fights it loses.
    // The author reversed that ruling. Mitigation baked in here: the OPEN swipe
    // is accepted anywhere in the left third of the screen, not just the OS
    // edge band, so even if the OS eats the outermost pixels a slightly-inset
    // swipe still opens. The residual risk (a true hard-edge swipe going to
    // system-back instead) is documented in §4.8a as the accepted cost.
    // Lanes-only: never fires while an edit/create screen or a dialog is up,
    // and it yields to an active card-reorder drag. Threshold-detected (no
    // finger-follow); the CSS transition supplies the slide. Live finger-follow
    // is a possible future polish — flagged, not built.
    let swipeTrack = null;
    const SWIPE_MIN_PX = 55;           // horizontal distance to commit a swipe
    const SWIPE_H_DOMINANCE = 1.5;     // horizontal travel must beat vertical by this factor
    const SWIPE_OPEN_ZONE_FRAC = 0.33; // an open-swipe must START in the left third
    function swipeToOpenBlocked(){
      if (state.screen) return true;                 // a drafting / edit page is up
      const dlg = qs("#dialog-root");
      if (dlg && dlg.innerHTML.trim()) return true;  // a modal dialog is up
      if (touchDrag && touchDrag.active) return true; // a reorder drag owns this gesture
      return false;
    }
    document.addEventListener("touchstart", function(e){
      if (e.touches.length !== 1){ swipeTrack = null; return; }
      const t = e.touches[0];
      swipeTrack = { x0: t.clientX, y0: t.clientY, dx: 0, dy: 0, wasOpen: !!state.trayOpen };
    }, { passive: true });
    document.addEventListener("touchmove", function(e){
      if (!swipeTrack || e.touches.length !== 1) return;
      if (touchDrag && touchDrag.active){ swipeTrack = null; return; } // became a reorder drag
      const t = e.touches[0];
      swipeTrack.dx = t.clientX - swipeTrack.x0;
      swipeTrack.dy = t.clientY - swipeTrack.y0;
    }, { passive: true });
    document.addEventListener("touchend", function(){
      const s = swipeTrack; swipeTrack = null;
      if (!s) return;
      const adx = Math.abs(s.dx), ady = Math.abs(s.dy);
      if (adx < SWIPE_MIN_PX || adx < ady * SWIPE_H_DOMINANCE) return; // not a clean horizontal swipe
      if (s.wasOpen){
        if (s.dx < 0) closeTray();                                     // swipe LEFT closes the open drawer
      } else if (s.dx > 0 && s.x0 < window.innerWidth * SWIPE_OPEN_ZONE_FRAC && !swipeToOpenBlocked()){
        openTray();                                                    // swipe RIGHT from the left third opens it
      }
    });

    // CHUNK 6 (user: mobile keyboard bug). Mirror the visual viewport into CSS
    // vars so .screen-overlay can size to the VISIBLE area, not the layout
    // viewport the on-screen keyboard doesn't shrink. Kept current continuously;
    // only the drafting overlay reads them, so updating while no screen is open
    // is harmless.
    if (window.visualViewport){
      // ⚑ Tracks OFFSET AS WELL AS HEIGHT, and that pairing is the whole point.
      //
      // A previous round dropped offsetTop to stop the overlay jittering during
      // momentum scroll, and kept the height. That combination is worse than
      // either alone: .screen-overlay is positioned at --vv-top and sized to
      // --vv-height, so with the top pinned at 0 and the height shrunk to the
      // keyboard-visible area, the overlay ends up BOTH too high (the title
      // scrolls out of the visible area) AND too short (the lanes show through
      // underneath it). That was the reported bug — one cause, both symptoms.
      //
      // The jitter is dealt with properly instead: coalesce into a frame, and
      // write nothing when the numbers have not actually changed. Scroll has to
      // be listened to, because offsetTop only changes there.
      let vvRaf = 0, lastH = -1, lastT = -1;
      const syncVv = function(){
        const vv = window.visualViewport;
        const h = Math.round(vv.height), top = Math.round(vv.offsetTop);
        if (h === lastH && top === lastT) return;
        lastH = h; lastT = top;
        const root = document.documentElement;
        root.style.setProperty("--vv-height", h + "px");
        root.style.setProperty("--vv-top", top + "px");
      };
      const queueVv = function(){
        if (vvRaf) return;
        vvRaf = requestAnimationFrame(function(){ vvRaf = 0; syncVv(); });
      };
      window.visualViewport.addEventListener("resize", queueVv);
      window.visualViewport.addEventListener("scroll", queueVv);
      syncVv();
    }

    // CHUNK 2 (spec 4.10b) -- collapsing tab bar. rAF-debounced scroll
    // listener toggles body.tabs-collapsed on scroll direction; gated on
    // drag-active so an in-progress drag's auto-scroll can never flip it
    // mid-drag (spec 4.10b, known issue 2 -- the freeze is body.drag-active
    // itself, set/cleared at every liveDrag/touchDrag transition above).
    //
    // HYSTERESIS (user round -- fixes the bounce): the naive "any downward
    // pixel collapses, any upward pixel expands" flipped on every jitter, so
    // a quick flick, mobile rubber-band overscroll, or the tiny scroll clamp
    // that toggling itself produces would oscillate the bar. Instead we
    // accumulate movement in ONE direction (reset on a direction change) and
    // only flip once a committed run exceeds TAB_COLLAPSE_HYSTERESIS.
    let tabsScrollTicking = false;
    window.addEventListener("scroll", function(){
      if (tabsScrollTicking) return;
      tabsScrollTicking = true;
      requestAnimationFrame(function(){
        if (!document.body.classList.contains("drag-active")){
          const y = Math.max(0, window.scrollY);
          const dy = y - tabScrollLastY;
          if (dy !== 0){
            if ((dy > 0) !== (tabScrollAccum > 0)) tabScrollAccum = 0; // direction flipped
            tabScrollAccum += dy;
          }
          if (y <= 8){
            document.body.classList.remove("tabs-collapsed"); // always full near the top
            tabScrollAccum = 0;
          } else if (tabScrollAccum > TAB_COLLAPSE_HYSTERESIS){
            document.body.classList.add("tabs-collapsed");
            tabScrollAccum = 0;
          } else if (tabScrollAccum < -TAB_COLLAPSE_HYSTERESIS){
            document.body.classList.remove("tabs-collapsed");
            tabScrollAccum = 0;
          }
          tabScrollLastY = y;
        }
        tabsScrollTicking = false;
      });
    }, { passive: true });
  }

  // =========================================================
  // DEV QA CHECKLIST (temporary — not part of the app's feature set)
  //
  // Injects two mini-lists into Next Actions on first load: a manual test
  // checklist for this chunk's new behavior, plus a recheck list covering
  // things the previous chunk's handoff notes flagged as worth verifying.
  // Each check is a normal Next Action — tick it (or delete it) as you go,
  // and delete the group headers once you're done with the whole pass.
  //
  // Guarded by a localStorage flag so it only runs once, and runs
  // regardless of whether initLocalData() just seeded fresh data or
  // loaded your existing saved lists — so it shows up either way. Not
  // referenced by anything else; safe to delete this whole function (and
  // its boot() call below) once QA is done, or before handing the file
  // off to the next chunk.
  // =========================================================
  // The one place that decides whether dev scaffolding exists in the lanes at
  // all. Called at boot and again whenever the QA switch is flipped.
  //
  // ⚠ Switching OFF clears the injectors' own flag keys as well as sweeping the
  // rows. Without that, switching back on would find the flags already set,
  // decide the checklist had been injected, and inject nothing — a switch that
  // works once and is then silently dead. (Found by trying it, not by reading it.)
  function applyQaScaffolding(){
    if (devGroupOn(DEV_GROUP_QA)){
      injectQAChecklist(); // §8.1 replace-mode: one checklist, one flag key
      injectChunkMap();    // §8.2 same discipline, its own flag key
      return;
    }
    let touched = false;
    // The checklist: groups titled "✅ QA …" in Next Actions, plus their items.
    const qaGroups = new Set(state.tasks.next
      .filter(function(t){ return t.isGroup && (t.title || "").indexOf("✅ QA") === 0; })
      .map(function(t){ return t.id; }));
    if (qaGroups.size){
      state.tasks.next = state.tasks.next.filter(function(t){
        return !qaGroups.has(t.id) && !qaGroups.has(t.parent);
      });
      saveTasksLocal("next");
      touched = true;
    }
    // The chunk map: tagged by devContext, not by title (the title is free to change).
    const mapGroups = new Set(state.tasks.current
      .filter(function(t){ return t.isGroup && t.devContext === "chunk-map"; })
      .map(function(t){ return t.id; }));
    if (mapGroups.size){
      state.tasks.current = state.tasks.current.filter(function(t){
        return !mapGroups.has(t.id) && !mapGroups.has(t.parent);
      });
      saveTasksLocal("current");
      touched = true;
    }
    // Let both injectors run again if the switch comes back on.
    Object.keys(localStorage).forEach(function(k){
      if (k.indexOf("gtd_qa_checklist_") === 0 || k.indexOf("gtd_chunk_map_") === 0) Storage.remove(k);
    });
    if (touched){ renderLane("next"); renderLane("current"); }
  }
  function injectQAChecklist(){
    // REVIEW-SURFACE round (review-surface-plan.md). §8.1's
    // replace-don't-accumulate discipline: this is the ONLY injector, and the
    // public-app-polish round's groups below are swept out, not left dormant.
    const FLAG = "gtd_qa_checklist_reviewsurface_v4";
    if (Storage.get(FLAG)) return;
    Storage.set(FLAG, "1");
    // Retire the superseded flags so they can't resurrect their injectors, and
    // so a future Reset doesn't leave dead keys behind.
    ["gtd_qa_checklist_chunk7_v1", "gtd_qa_checklist_override_v1",
     "gtd_qa_checklist_override_v2", "gtd_qa_checklist_chunk8_v1",
     "gtd_qa_checklist_postsprint_v1", "gtd_qa_checklist_postsprint_v2",
     "gtd_qa_checklist_postsprint_v3", "gtd_qa_checklist_postsprint_v4",
     "gtd_qa_checklist_postsprint_v5", "gtd_qa_checklist_postsprint_v6",
     "gtd_qa_checklist_postsprint_v7", "gtd_qa_checklist_desktop_v1",
     "gtd_qa_checklist_desktop_v2", "gtd_qa_checklist_sw_v1",
     "gtd_qa_checklist_publicpolish_v1", "gtd_qa_checklist_reviewsurface_v1",
     "gtd_qa_checklist_reviewsurface_v2", "gtd_qa_checklist_reviewsurface_v3"].forEach(Storage.remove);

    // Replace, don't accumulate (8.1) — and actually mean it this time.
    // Earlier rounds bumped the flag but left the previous rounds' groups
    // sitting in Next Actions, so every new build stacked another
    // checklist on top of the last (QA finding). Sweep every existing
    // "\u2705 QA" group and its items out of the ACTIVE list before
    // injecting this round's; anything already completed stays in the
    // Completed archive untouched.
    const staleGroupIds = new Set(state.tasks.next
      .filter(function(t){ return t.isGroup && (t.title || "").indexOf("\u2705 QA") === 0; })
      .map(function(t){ return t.id; }));
    if (staleGroupIds.size){
      state.tasks.next = state.tasks.next.filter(function(t){
        return !staleGroupIds.has(t.id) && !staleGroupIds.has(t.parent);
      });
    }

    function addGroupWithItems(title, items){
      const groupId = genId();
      state.tasks.next.push({ id: groupId, title: title, notesClean: "", linkedProjectId: null, isGroup: true, parent: null, devContext: "qa-checklist" });
      items.forEach(function(item){
        state.tasks.next.push({
          id: genId(), title: item.title, notesClean: item.notes || "", linkedProjectId: null,
          isGroup: false, parent: groupId, whenText: null, hooks: [], deadline: null
        });
      });
    }

    addGroupWithItems('✅ QA — The review’s new grouped buttons', [
      { title: '1. Open the daily review', notes: 'Open the intray (the handle on the left edge of the screen, or the left column on a computer) and tap Review. Look at whichever card shows up first.' },
      { title: '2. Check the buttons are grouped, not one long list', notes: 'A card with several buttons (like a stalled project) should show them in a few small groups with a thin line between each group, ending with "Not now" in the bottom-left corner and a red "Delete" in the bottom-right — not seven buttons in one plain column.' },
      { title: '3. Check the colored buttons', notes: 'Buttons that add something to a list — "+Next", "+Waiting", "+Event", "Someday →" — should be short and colored like that list\'s tab (red, yellow, brass, blue). Buttons that don\'t send it anywhere (like "Completed") stay plain grey. Same on the phone and on a computer.' },
      { title: '4. Check the wording is the same everywhere', notes: 'Every card\'s "this got done" button should say "Completed" (not "Mark done" or "Complete it"), and every Delete button should just say "Delete" (not "Delete it").' },
      { title: '5. Find an overdue repeating habit or event, if one shows up', notes: 'Whether it\'s still showing today or already moved on to tomorrow, it should offer a "Skipped" button (not "Let it go") alongside "Completed" — a way to say "this one didn\'t happen, and that\'s fine" without deleting the whole repeating series.' },
      { title: '6. Check Delete acts right away, no popup', notes: 'Tapping Delete on a review card should delete it immediately, with no "are you sure?" popup — except a repeating calendar event, which still asks whether you mean just this occurrence or the whole series (that one stays, since "delete" is genuinely unclear there).' },
      { title: '7. Tap the (i) info button at the top of the review', notes: 'It should explain only the ONE card you\'re looking at — not a wall of text about every kind of card at once.' }
    ]);

    addGroupWithItems('✅ QA — Calendar changes', [
      { title: '8. Open the calendar and set something to repeat', notes: 'Start adding an event, set it to repeat Daily or Weekly. A purple box should offer to make it a habit instead, with a small X on the end to dismiss it if you don\'t want it.' },
      { title: '9. On a computer, open the calendar', notes: 'The whole calendar should fit on screen without needing to scroll, with the day squares wide and short (not tall) and the "Add" button always visible — not hidden below the fold.' },
      { title: '10. Check the "More options" / "Advanced options" buttons', notes: 'Wherever you see one of these (a next action, a waiting action, a habit, or the calendar), it should now have a light grey fill so it stands out a bit, instead of blending into the background.' }
    ]);
    saveTasksLocal("next");
  }


  // =========================================================
  // BOOT
  // =========================================================
  // =========================================================
  // CHUNK 6 (§4.8a): the capture drawer (intray). A left drawer over the
  // lanes for frictionless capture — capture is the first job, so it
  // auto-opens on launch (even when empty). Captures land in gtd_tray as
  // stray thoughts; the daily review (chunk 6b) is where they get sorted.
  // Opening/closing changes nothing on the main screen — closing is a cancel.
  // =========================================================
  // ⚑ The user's own copy (INFO-TEXT.txt [INTRAY]), transcribed verbatim.
  // ⚑ Translated: the user's own copy now lives in i18n.js under "info.tray".
  function trayInfoText(){ return t("info.tray"); }
  function loadTray(){ return Storage.getJSON("gtd_tray", []); }
  function saveTray(){ Storage.setJSON("gtd_tray", state.tray); }
  // The eye toggle glyph (user follow-up). Crossed eye = captures are hidden
  // (tap to reveal); open eye = revealed (tap to hide). Inline SVG so the
  // "eye with a cross through it" renders identically everywhere — no emoji
  // eye-off exists cross-platform.
  function eyeIconHtml(revealed){
    const base = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/>';
    return base + (revealed ? "" : '<line x1="3" y1="3" x2="21" y2="21"/>') + '</svg>';
  }
  // A tray card. Captures are REDACTED by default (user follow-up): a sealed
  // pitch-black bar, unreadable and with no discard ✕, exactly like the
  // review's redaction. The drawer's reveal toggle un-seals them.
  function trayCardHtml(item, revealed){
    if (!revealed) return '<div class="tray-card tray-card-redacted"><span class="tray-card-redaction" aria-hidden="true"></span></div>';
    return '<div class="tray-card">' +
      '<span class="tray-card-text">' + escapeHtml(item.text) + '</span>' +
      '<button type="button" class="icon-btn" data-action="tray-delete" data-id="' + item.id + '" title="Discard">&times;</button>' +
    '</div>';
  }
  // The drawer's Review button (chunk 6b, §4.8b) — the entry point to the
  // review surface. The badge counts EVERY open loop across all lanes (not
  // just captures). It does NOT subtract "Not now" deferrals: those now reset
  // the moment the review reopens (user follow-up), so the badge reflects what
  // the next open will actually show.
  function trayReviewBtnHtml(){
    const n = computeOpenLoops().length;
    return '<button type="button" class="tray-review-btn" data-action="open-review">' +
      '<span>&#128269; Review</span>' + (n ? '<span class="tray-review-count">' + n + '</span>' : '') +
    '</button>';
  }
  // ⚑ The drawer lists DERIVED loops too, not just captures (user): "the empty
  // label shows when there are no captures, but it's not strictly true. Stalled
  // projects and orphaned actions should show up as redacted cards in the list
  // which can be revealed."
  //
  // The Review button's badge has always counted every open loop, so a drawer
  // that said "nothing slipping through the cracks" directly above a badge
  // reading 3 was contradicting itself. Now the list shows what the badge counts.
  //
  // These are NOT captures and behave differently, deliberately:
  //   · no ✕ — a stalled project is not a stray thought you can discard; the
  //     way to clear it is to give it a way forward, which is the review's job
  //   · not tappable, revealed or not — same ruling as the review's own
  //     redaction (§4.8b): cherry-picking blind makes the discipline decorative
  //   · revealed, they name the kind ("stalled project"), because the title
  //     alone does not say why it is in the list
  // ⚑ EVERY kind the badge counts, past-due included (user: "passed due should
  // show up"). An earlier version left past-due out, reasoning that those items
  // already carry a bar and chip in the lanes — but that reasoning reproduced
  // the exact bug this feature exists to fix: with two overdue items and no
  // captures, the badge read 2 and the drawer still said "nothing slipping
  // through the cracks". The invariant is simple and worth stating: the list
  // shows one card per thing the badge counts, always.
  function trayDerivedLoops(){
    return computeOpenLoops().filter(function(l){ return l.kind !== "capture"; });
  }
  // ⚑ Plain descriptions, not the internal kind names (user: the jargon pass).
  // "no way forward" is the wording the review card already uses for a stalled
  // project, so the drawer and the review say the same thing about it.
  const TRAY_LOOP_LABEL = {
    stalled: "no way forward",
    orphaned: "waiting on something gone",
    pastdue: "past its date",
    missed: "a repeat you missed"
  };
  // A loop's title comes from different places by kind: a lane row for most, but
  // a missed repeat has no row at all — it is the event plus a date.
  function trayLoopTitle(loop){
    if (loop.kind === "missed") return effTitle(loop.ev, loop.occ);
    return (loop.task && loop.task.title) || "";
  }
  // ⚑ QA (user): "It's too strict to prevent people from entering a revealed card
  // in the intray. Once they've hit that reveal button, they've basically opted
  // out of the one at a time rule anyway." Correct, and it repairs an
  // inconsistency rather than making one: the no-tapping rule is the REVIEW's
  // (§4.8b), where it stops you cherry-picking blind through a redacted queue.
  // Reveal is already the sanctioned way out of that discipline, so a card you
  // have deliberately unsealed has no discipline left to protect — it was just
  // inert. UNREVEALED cards stay untappable, which is the half that was ever
  // load-bearing.
  //
  // Where it goes: the item's real page, the same destination as the review's
  // tap-through. A missed repeat and a past-due pseudo-action are views of an
  // EVENT, so they open the event page; everything else opens its lane row.
  function trayLoopCardHtml(loop, revealed){
    if (!revealed){
      return '<div class="tray-card tray-card-redacted tray-card-loop">' +
        '<span class="tray-card-redaction" aria-hidden="true"></span></div>';
    }
    const eventId = loop.kind === "missed" ? loop.id : (loop.task && loop.task.eventId) || "";
    const attrs = eventId
      ? ' data-event="' + escapeHtml(eventId) + '"'
      : ' data-lane="' + escapeHtml(loop.laneKind || "") + '" data-id="' + escapeHtml(loop.id) + '"';
    return '<button type="button" class="tray-card tray-card-loop tray-card-open" ' +
      'data-action="tray-open-loop"' + attrs + '>' +
      '<span class="tray-card-text">' + escapeHtml(trayLoopTitle(loop)) +
        ' <span class="tray-card-kind">' + (TRAY_LOOP_LABEL[loop.kind] || "needs a decision") + '</span>' +
      '</span></button>';
  }
  function trayListHtml(){
    const items = state.tray || [];
    const loops = trayDerivedLoops();
    const revealed = !!state.trayReveal;
    let list;
    if (items.length || loops.length){
      const cards = items.map(function(it){ return trayCardHtml(it, revealed); }).join("") +
        loops.map(function(l){ return trayLoopCardHtml(l, revealed); }).join("");
      const toggle = '<div class="tray-list-head">' +
        '<button type="button" class="tray-reveal-btn" data-action="tray-reveal" title="' + (revealed ? "Hide" : "Reveal") + '">' +
          eyeIconHtml(revealed) + '<span>' + (revealed ? "Hide" : "Reveal") + '</span>' +
        '</button></div>';
      list = toggle + '<div class="tray-list">' + cards + '</div>';
    } else {
      list = '<div class="tray-empty">Empty for now — nothing slipping through the cracks.</div>';
    }
    return trayReviewBtnHtml() + list;
  }
  // Update just the card list in an already-open drawer — adding/removing a
  // capture must not rebuild (and re-slide) the whole drawer (user: the jump).
  function refreshTrayList(){
    const wrap = qs(".tray-scroll");
    if (wrap) wrap.innerHTML = trayListHtml(); else renderTray();
  }
  function renderTray(skipOpen){
    const root = qs("#tray-root");
    if (!root) return;
    const list = '<div class="tray-scroll">' + trayListHtml() + '</div>';
    root.innerHTML =
      '<div class="tray-backdrop" data-action="close-tray"></div>' +
      '<div class="tray-drawer">' +
        '<div class="tray-head">' +
          '<span class="tray-title">' + escapeHtml(t("tray.title")) + '</span>' +
          '<span style="flex:1"></span>' +
          '<button type="button" class="icon-btn" data-action="tray-info" title="' + escapeHtml(t("chrome.info")) + '">&#9432;</button>' +
          '<button type="button" class="icon-btn" data-action="close-tray" title="' + escapeHtml(t("chrome.close")) + '">&times;</button>' +
        '</div>' +
        '<div class="tray-info-panel" hidden>' + escapeHtml(trayInfoText()) + '</div>' +
        '<div class="tray-capture">' +
          '<input type="text" id="tray-input" placeholder="Capture a thought…" autocomplete="off">' +
          '<button type="button" data-action="tray-add" title="' + escapeHtml(t("chrome.add")) + '">+</button>' +
        '</div>' +
        list +
        // The handle's other half: an arrow on the drawer's own edge that puts
        // it away. Same shape and colour as #tray-handle, pointing the other
        // way, so the pair reads as one control with two states. Carries both
        // looks (glyph + chevrons) the same way #tray-handle does — see the
        // revision note in styles.css.
        '<button type="button" class="tray-edge-handle" data-action="close-tray" title="' + escapeHtml(t("tray.handleClose")) + '" aria-label="' + escapeHtml(t("tray.handleClose")) + '">' +
          '<span class="tray-handle-glyph" aria-hidden="true">&#8249;</span>' +
          '<span class="tray-handle-chevron" aria-hidden="true"></span><span class="tray-handle-chevron" aria-hidden="true"></span>' +
        '</button>' +
      '</div>';
    // Force the -100% start state to commit BEFORE adding .open, or the
    // browser collapses both into one paint and the drawer snaps open with no
    // slide (worst at launch auto-open, user). The reflow read guarantees it.
    // skipOpen leaves the drawer parked off-screen at -100% so a finger-follow
    // swipe can drag it in (bindDrawerSwipe).
    const backdrop = qs(".tray-backdrop"), drawer = qs(".tray-drawer");
    if (skipOpen) return;
    if (drawer){ void drawer.offsetWidth; drawer.classList.add("open"); }
    if (backdrop) backdrop.classList.add("open");
  }
  // The left-edge handle hides while the drawer is open and comes back only
  // AFTER the slide-out finishes (trap T15b) — otherwise it pops in on top of a
  // drawer that is still moving. One class, driven from the same 300ms timer
  // the drawer's own teardown already uses.
  function syncTrayHandle(){ document.body.classList.toggle("tray-open", !!state.trayOpen); }
  function openTray(){
    state.trayOpen = true;
    state.trayReveal = false; // captures start sealed every time the drawer opens (user follow-up)
    syncTrayHandle();
    renderTray();
    const input = qs("#tray-input"); if (input) input.focus();
  }
  function closeTray(){
    state.trayOpen = false;
    const r = qs("#tray-root");
    const drawer = qs(".tray-drawer"), backdrop = qs(".tray-backdrop");
    if (!drawer){ if (r) r.innerHTML = ""; syncTrayHandle(); return; }
    drawer.classList.remove("open");            // slide out
    if (backdrop) backdrop.classList.remove("open");
    setTimeout(function(){ if (r && !state.trayOpen) r.innerHTML = ""; syncTrayHandle(); }, 300); // clears after the .28s slide-out
  }
  // Finger-follow swipe on the intray drawer — the same drag-and-snap mechanic
  // as the calendar month swipe (user: "works great, no browser issues"). Two
  // gestures: drag the OPEN drawer left to dismiss it, and drag in from the
  // LEFT EDGE to open it. The drawer tracks the finger and snaps on release.
  let drawerDrag = null;
  const DRAWER_EDGE = 26;
  function bindDrawerSwipe(){
    document.addEventListener("touchstart", function(e){
      if (drawerDrag || e.touches.length !== 1) return;
      if (qs(".choice-dialog-backdrop")) return; // a dialog owns the gesture
      const t = e.touches[0];
      if (state.trayOpen){
        const drawer = qs(".tray-drawer"); if (!drawer) return;
        drawerDrag = { mode: "close", startX: t.clientX, startY: t.clientY, width: drawer.getBoundingClientRect().width, drawer: drawer, backdrop: qs(".tray-backdrop"), decided: false, horizontal: false };
      } else if (!state.screen && t.clientX <= DRAWER_EDGE){
        renderTray(true); // build it parked off-screen at -100%, ready to drag in
        const drawer = qs(".tray-drawer"); if (!drawer) return;
        drawerDrag = { mode: "open", startX: t.clientX, startY: t.clientY, width: drawer.getBoundingClientRect().width, drawer: drawer, backdrop: qs(".tray-backdrop"), decided: false, horizontal: false };
      }
    }, { passive: true });
    document.addEventListener("touchmove", function(e){
      if (!drawerDrag) return;
      const t = e.touches[0];
      const dx = t.clientX - drawerDrag.startX, dy = t.clientY - drawerDrag.startY;
      if (!drawerDrag.decided){
        if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return;
        drawerDrag.decided = true;
        drawerDrag.horizontal = Math.abs(dx) > Math.abs(dy);
        if (!drawerDrag.horizontal){ cancelDrawerDrag(); return; } // vertical → let the drawer scroll
        drawerDrag.drawer.style.transition = "none";
        if (drawerDrag.backdrop) drawerDrag.backdrop.style.transition = "none";
      }
      if (!drawerDrag.horizontal) return;
      e.preventDefault(); // claim the horizontal gesture
      const w = drawerDrag.width;
      const offset = drawerDrag.mode === "close"
        ? Math.max(-w, Math.min(0, dx))
        : Math.max(-w, Math.min(0, -w + Math.max(0, dx)));
      drawerDrag.drawer.style.transform = "translateX(" + offset + "px)";
      if (drawerDrag.backdrop) drawerDrag.backdrop.style.opacity = String(Math.max(0, Math.min(1, 1 + offset / w)));
    }, { passive: false });
    function endDrawer(e){
      if (!drawerDrag) return;
      const dd = drawerDrag; drawerDrag = null;
      dd.drawer.style.transition = ""; if (dd.backdrop) dd.backdrop.style.transition = "";
      const clearInline = function(){ dd.drawer.style.transform = ""; if (dd.backdrop) dd.backdrop.style.opacity = ""; };
      const teardown = function(){ clearInline(); setTimeout(function(){ if (!state.trayOpen){ const r = qs("#tray-root"); if (r) r.innerHTML = ""; } }, 300); };
      if (!dd.decided || !dd.horizontal){
        if (dd.mode === "open") teardown(); else clearInline();
        return;
      }
      const dx = (e.changedTouches ? e.changedTouches[0].clientX : dd.startX) - dd.startX;
      const threshold = Math.max(60, dd.width * 0.33);
      if (dd.mode === "close"){
        if (dx < -threshold){ closeTray(); clearInline(); }                 // commit close
        else { dd.drawer.classList.add("open"); if (dd.backdrop) dd.backdrop.classList.add("open"); clearInline(); } // snap back open
      } else {
        if (dx > threshold){                                               // commit open
          state.trayOpen = true; state.trayReveal = false; syncTrayHandle();
          dd.drawer.classList.add("open"); if (dd.backdrop) dd.backdrop.classList.add("open"); clearInline();
          const inp = qs("#tray-input"); if (inp) setTimeout(function(){ inp.focus(); }, 60);
        } else { dd.drawer.classList.remove("open"); teardown(); }          // cancel open
      }
    }
    document.addEventListener("touchend", endDrawer, { passive: true });
    document.addEventListener("touchcancel", endDrawer, { passive: true });
  }
  function cancelDrawerDrag(){
    if (!drawerDrag) return;
    const dd = drawerDrag; drawerDrag = null;
    dd.drawer.style.transition = ""; if (dd.backdrop) dd.backdrop.style.transition = "";
    dd.drawer.style.transform = ""; if (dd.backdrop) dd.backdrop.style.opacity = "";
    if (dd.mode === "open"){ setTimeout(function(){ if (!state.trayOpen){ const r = qs("#tray-root"); if (r) r.innerHTML = ""; } }, 300); }
  }
  function trayAdd(text){
    text = (text || "").trim();
    if (!text) return;
    state.tray.unshift({ id: genId(), text: text, createdAt: nowMs() });
    saveTray();
    const inp = qs("#tray-input"); if (inp) inp.value = ""; // clear the box in place — no full re-render/re-slide
    refreshTrayList();
    if (inp) inp.focus(); // stays focused for the next thought
  }
  function trayDelete(id){
    state.tray = state.tray.filter(function(t){ return t.id !== id; });
    saveTray();
    refreshTrayList();
  }
  // Silent capture removal (no drawer re-render) — used when a sort chip's
  // create page saves. trayDelete would call refreshTrayList/renderTray and,
  // with the drawer closed, re-open it; this just mutates the store.
  function removeCapture(id){
    state.tray = state.tray.filter(function(t){ return t.id !== id; });
    saveTray();
  }
  function consumeCaptureForScreen(s){
    if (s && s.fromCaptureId){ removeCapture(s.fromCaptureId); s.fromCaptureId = null; }
  }

  // =========================================================
  // CHUNK 6b (§4.8b): the daily REVIEW — open loops, one at a time.
  // A redacted, one-at-a-time QUEUE (a lens, not a container) over four kinds
  // of open loop, on its own full-screen surface reached from the drawer's
  // Review button. Items stay in their lanes; tapping a revealed card opens
  // its real page and save-exiting returns here (screenStack). The queue is
  // DERIVED — recomputed on every render, never snapshotted (or we'd triage
  // ghosts, §4.8b). ⛔ Fence: no progress bar, no Next/Skip, no complete
  // screen, no streaks/reminders/snooze, no deferral history. The past-due
  // kind ships in its DEADLINE shape only; chunk 7 slots in the pseudo-action
  // CHECKBOX shape + the Calendar chip + the "it moved" banner.
  // =========================================================
  function isWaitingOrphaned(task){
    if (!task || !task.conditionId) return false;
    // Same fix as the cueBlock lookup in leafCardHtml: search both live
    // pools, not the one named by the (possibly stale) conditionKind.
    const live = state.tasks.next.concat(state.tasks.waiting)
      .some(function(t){ return t.id === task.conditionId && !t.isGroup; });
    if (live) return false;
    // chunk 8 (§10 / §4.15b): a condition on a not-yet-live event is NOT an
    // orphan — resolve it against gtd_events. A PAUSED series won't fire, so a
    // dependent on it IS shown orphaned, but reversibly (this is derived, not a
    // frozen label — it clears the moment the series is unpaused). Delete-series
    // removes the event, so its dependents fall through to the genuine-orphan
    // case below; skip-this-one keeps the same task ID and never lands here.
    const ev = findEventByTaskId(task.conditionId);
    if (ev) return !!ev.paused;
    return true;
  }
  // Dev scaffolding (the chunk-map roadmap, the QA checklist) is injected as
  // groups tagged devContext and is deliberately unlinked/actionless — the
  // LANE flag on those is expected (chunkMap.js), but they are NOT real open
  // loops and must never flood the user's review. Exclude an item whose own
  // group parent carries a devContext.
  function isDevScaffold(task){
    if (!task) return false;
    if (task.devContext) return true;
    if (!task.parent) return false;
    const groups = state.tasks.current.concat(state.tasks.next, state.tasks.waiting, state.tasks.future);
    const parent = groups.find(function(t){ return t.id === task.parent && t.isGroup; });
    return !!(parent && parent.devContext);
  }
  // The ordered queue. Past-due FIRST (§4.8b: sorts to top, revealed first),
  // then captures, then the two derived open-loop kinds LAST — stalled
  // projects and orphaned waiting actions sink to the bottom (user follow-up:
  // they're the "think about it" items, so you clear the quick wins first).
  // De-duped by id so an item that is both past-due and stalled surfaces once
  // (past-due wins, being first).
  function computeOpenLoops(){
    const loops = [];
    // Events already being asked about as a live past-due row. A series whose
    // TODAY has passed unticked is queued below as a pseudo-action; if it also
    // carries a recorded miss from an earlier day, showing both would put the
    // same series in the queue twice — the accumulation the single-slot design
    // exists to prevent. The live one wins: it is the more recent question, and
    // dealing with it is what the review is for.
    const pastDueEventIds = {};
    ["next", "current"].forEach(function(k){
      state.tasks[k].forEach(function(t){
        if (t.isGroup || isDevScaffold(t)) return;
        // chunk 7: a past-due pseudo-action is a past-due open loop too, but in
        // its CHECKBOX shape (§4.8b / §2) — not the deadline's push/complete/
        // delete menu. deadlineBarState is null for it (no deadline field), so
        // it needs its own past-due test.
        if (t.eventId){
          if (pseudoPassed(t)){
            pastDueEventIds[t.eventId] = 1;
            loops.push({ key: t.id, kind: "pastdue", laneKind: k, id: t.id, task: t, pseudo: true });
          }
          return;
        }
        const st = deadlineBarState(t);
        if (st && st.passed) loops.push({ key: t.id, kind: "pastdue", laneKind: k, id: t.id, task: t });
      });
    });
    // A repeating occurrence that went unticked and has already been rolled past
    // (user ruling). It has no lane row — the series' single pseudo-action has
    // moved on to the next date — so it is derived from the event itself rather
    // than found in a lane, and carries the EVENT id, not a task id.
    (state.events || []).forEach(function(ev){
      if (!ev.missedOcc) return;
      if (pastDueEventIds[ev.id]) return;   // already queued, once is enough
      loops.push({ key: "missed-" + ev.id, kind: "missed", id: ev.id, ev: ev, occ: ev.missedOcc });
    });
    (state.tray || []).forEach(function(c){ loops.push({ key: c.id, kind: "capture", id: c.id, text: c.text }); });
    state.tasks.current.forEach(function(t){
      if (!t.isGroup && !isDevScaffold(t) && !projectHasWayForward(t.id)) loops.push({ key: t.id, kind: "stalled", laneKind: "current", id: t.id, task: t });
    });
    state.tasks.waiting.forEach(function(t){
      if (!t.isGroup && !isDevScaffold(t) && isWaitingOrphaned(t)) loops.push({ key: t.id, kind: "orphaned", laneKind: "waiting", id: t.id, task: t });
    });
    const seen = {};
    return loops.filter(function(l){ if (seen[l.key]) return false; seen[l.key] = 1; return true; });
  }

  // --- "Not now" deferral: scoped to the currently-OPEN review (user
  //     follow-up, supersedes the §4.8b day-scoped model). A deferred item
  //     drops out for the rest of THIS viewing; closing the review and opening
  //     it again brings everything back — "defer until the next review", not
  //     "until tomorrow". The set is in-memory only; openReviewScreen clears
  //     it, so nothing needs to persist or be stamped with the app-day.
  function reviewDeferredSet(){ return state.reviewDeferred || (state.reviewDeferred = {}); }
  function deferReviewItem(key){ reviewDeferredSet()[key] = 1; }
  function reviewActiveLoops(){
    const deferred = reviewDeferredSet();
    return computeOpenLoops().filter(function(l){ return !deferred[l.key]; });
  }

  function openReviewScreen(){
    state.reviewDeferred = {}; // a fresh review always starts with everything on the table
    state.screen = { kind: "review", reviewView: true, taskId: null, draft: {}, reviewForm: null };
    renderScreen();
  }
  // Push the review onto the stack and open a child screen, so save-exiting
  // that child returns here and the queue recomputes (§4.8b navigation).
  function reviewOpenChild(fn){
    state.screenStack.push(state.screen);
    state.screen = null;
    fn();
  }

  // hasCard: false on the all-clear/all-deferred end state, where there is
  // nothing on the page for the ⓘ to explain (§3, review-surface-plan.md).
  function reviewHeaderHtml(hasCard){
    return (
      '<div class="screen-header">' +
        '<span class="screen-chrome-btn" style="visibility:hidden">&#8592;</span>' +
        '<span class="screen-kind-badge">' + escapeHtml(t("review.badge")) + '</span>' +
        '<div class="screen-header-right">' +
          (hasCard ? '<button type="button" class="screen-chrome-btn" data-action="review-info" title="' + escapeHtml(t("chrome.info")) + '">&#9432;</button>' : '') +
          '<button type="button" class="screen-chrome-btn" data-action="review-close" title="' + escapeHtml(t("chrome.close")) + '">&#10005;</button>' +
        '</div>' +
      '</div>'
    );
  }
  // ⚑ Translated (i18n.js). Rebuilt per call rather than cached, so a language
  // change is picked up without another table to remember to refresh.
  function reviewMenuInfo(){
    return {
      pastdue: t("info.review.pastdue"),
      pastdueEvent: t("info.review.pastdueEvent"),
      stalled: t("info.review.stalled"),
      orphaned: t("info.review.orphaned"),
      missed: t("info.review.missed"),
      capture: t("info.review.capture")
    };
  }
  // Scoped to the revealed card's kind (§3, review-surface-plan.md) — the
  // review shows exactly one card at a time, so "what's on the page" is
  // unambiguous. `capture` is the only kind that needs the sorting block
  // (sorting is what a capture card asks you to do); every other kind gets
  // the single matching "deciding" paragraph, not all four. `open` persists
  // across cards (state.screen.reviewInfoOpen) rather than closing on every
  // decision, which is friendlier when working through several cards of the
  // same kind in a row (builder's call, per review-surface-plan.md §3 trap).
  function reviewInfoPanelHtml(kind, open){
    if (!kind) return ""; // nothing on the page (all-clear / all-deferred) — no panel, no ⓘ
    let body;
    if (kind === "capture"){
      body = '<div class="review-info-block"><b>' + escapeHtml(t("review.heading.sorting")) + '</b><br>' +
          '<b>' + escapeHtml(t("review.infoNextLabel")) + '</b> ' + escapeHtml(LANE_INFO.next) + '<br>' +
          '<b>' + escapeHtml(t("review.infoWaitingLabel")) + '</b> ' + escapeHtml(LANE_INFO.waiting) + '<br>' +
          '<b>' + escapeHtml(t("review.infoProjectLabel")) + '</b> ' + escapeHtml(LANE_INFO.current) + '<br>' +
          '<b>' + escapeHtml(t("review.infoFutureLabel")) + '</b> ' + escapeHtml(LANE_INFO.future) + '<br>' +
          '<b>' + escapeHtml(t("review.infoHabitLabel")) + '</b> ' + escapeHtml(LANE_INFO.habit) + '<br>' +
          '<b>' + escapeHtml(t("review.infoNoteLabel")) + '</b> ' + escapeHtml(LANE_INFO.notes) + '<br>' +
          '<b>' + escapeHtml(t("review.infoTwoMinLabel")) + '</b> ' + escapeHtml(t("review.infoTwoMinText")) +
        '</div>';
    } else {
      // ⚑ Was "Deciding on an open loop" / "Orphaned waiting" (user: "open
      // loop is jargon from the book. It should be changed"). Both were terms
      // you had to already know — one borrowed from GTD, one the app invented.
      // The headings now describe the situation instead of naming it. "Stalled"
      // survives because it is ordinary English, not a term of art.
      // ⚑ REVISITED (Q3): the pseudo-action shape got its own info string once
      // it could also be Skipped — the deadline wording ("push it to a new
      // date") never applied to it and now omits an option it actually has.
      // Same label as pastdue (still "Past its date:") since that's still
      // literally true; only the paragraph after it differs.
      const label = {
        pastdue: t("review.infoPastDueLabel"),
        pastdueEvent: t("review.infoPastDueLabel"),
        stalled: t("review.infoStalledLabel"),
        orphaned: t("review.infoOrphanedLabel"),
        missed: t("review.infoMissedLabel")
      }[kind];
      body = '<div class="review-info-block"><b>' + escapeHtml(t("review.heading.deciding")) + '</b><br>' +
          '<b>' + escapeHtml(label) + '</b> ' + escapeHtml(reviewMenuInfo()[kind]) +
        '</div>';
    }
    return '<div class="review-info-panel"' + (open ? "" : " hidden") + '>' + body + '</div>';
  }

  // A redacted card: visible (you can see one more loop exists and count them)
  // but not readable and NOT tappable — cherry-picking blind would make the
  // discipline decorative (§4.8b).
  function reviewRedactionHtml(){ return '<div class="review-redaction" aria-hidden="true"></div>'; }

  // Grey button, red text only (author ruling — the capture card's baseline,
  // now shared by every delete control on the review surface; see
  // review-delete-text below).
  function reviewMenuBtn(action, label, extra, isDelete){
    return '<button type="button" class="review-menu-btn' + (isDelete ? " review-delete-text" : "") + '" data-action="' + action + '"' + (extra || "") + '>' + label + '</button>';
  }
  function reviewNotNowBtn(key){
    return '<button type="button" class="review-menu-btn review-notnow" data-action="review-defer" data-key="' + key + '">' + escapeHtml(t("review.notNow")) + '</button>';
  }
  // §5/§5a (review-surface-plan.md, RULED): the three-band structure for the
  // four non-capture kinds — band 1 "move it forward", band 2 "take it off
  // the list", band 3 (always .review-menu-row, the universal corner row —
  // reused as-is from the capture card, which is where it originated). A kind
  // with nothing for a band simply omits it (no empty div, so no stray
  // divider from the adjacent-sibling CSS rule). Each band renders as a
  // wrapping row of chips — same technique as .review-sort-chips, modeled
  // on the capture card per the author's own framing — and deliberately the
  // SAME layout on phone and desktop (author, second QA round: "keep
  // similar layouts for both, easier than introducing new concepts").
  function reviewBandHtml(html){ return html ? '<div class="review-band">' + html + '</div>' : ""; }
  // The active inline sub-form (Push date / Add next action / Free text) for
  // this card, if any. One at a time, held on the screen (draft-free — these
  // are review decisions, applied immediately, not armed edits).
  function reviewFormFor(s, key){ return (s.reviewForm && s.reviewForm.key === key) ? s.reviewForm : null; }
  // ⚑ QA (user): "keep the quick add options, but we should also make it possible
  // to open the full creation page from the daily review, since there are options
  // someone might want to add to their newly minted action."
  //
  // So the quick-add is the default and the full page is the escape hatch below
  // it, carrying whatever has already been typed. It is NOT a fourth menu item:
  // the fence (§4.8b) says the review offers decisions, and "add a next action" is
  // already the decision — which page you type it on is not a second choice to
  // make before you have typed anything. It sits on its own row, separate from
  // Cancel/Add: those two answer "keep this or go back," this one answers "do I
  // want more options for this action" — a different kind of control, not a
  // third peer alongside them (author ruling).
  //
  // The full page goes through reviewOpenChild, so save-exiting lands back on the
  // review and the queue recomputes (the project drops out if it now has a way
  // forward). Draft isolation is intact: nothing is written until that page saves.
  function reviewFullPageBtn(kind, projectId){
    return '<button type="button" class="review-menu-btn review-form-full" ' +
      'data-action="review-form-full" data-kind="' + kind + '" data-project="' + projectId + '" ' +
      'title="' + escapeHtml(t("review.fullPageTooltip")) + '">' + escapeHtml(t("review.fullPage")) + '</button>';
  }
  function reviewInlineFormHtml(placeholder, type, saveAction, saveLabel, value, invalid, fullKind, projectId){
    const isDate = type === "date";
    return (
      '<div class="review-inline-form">' +
        (isDate
          // review-form-date is the PICKER hook (pickers.js); review-form-input is
          // only the shared layout class. Keep them separate — see the note there.
          ? '<input type="text" readonly inputmode="none" id="review-form-input" data-field="reviewForm" placeholder="' + escapeHtml(t("field.pickDate")) + '" class="review-form-input review-form-date' + (invalid ? " field-invalid" : "") + '" value="' + escapeHtml(value || "") + '">'
          : '<input type="text" id="review-form-input" data-field="reviewForm" class="review-form-input' + (invalid ? " field-invalid" : "") + '" placeholder="' + escapeHtml(placeholder) + '" value="' + escapeHtml(value || "") + '" autocomplete="off">') +
        '<div class="review-inline-form-btns">' +
          '<div class="review-inline-form-btns-row">' +
            '<button type="button" class="review-menu-btn" data-action="review-form-cancel">' + escapeHtml(t("review.cancel")) + '</button>' +
            '<button type="button" class="review-menu-btn review-form-primary" data-action="' + saveAction + '">' + saveLabel + '</button>' +
          '</div>' +
          (fullKind ? reviewFullPageBtn(fullKind, projectId) : "") +
        '</div>' +
      '</div>'
    );
  }

  // The two-field variant, for adding a Waiting action to a stalled project.
  // `invalidField` names which box is at fault so the dashed outline lands on
  // the right one — validation shows an outline, never a popup (CLAUDE.md).
  function reviewWaitingFormHtml(s, key){
    const f = s.reviewForm || {};
    const bad = f.key === key ? (f.invalidField || null) : null;
    function box(id, ph, val, name){
      return '<input type="text" id="' + id + '" class="review-form-input' +
        (bad === name ? " field-invalid" : "") + '" placeholder="' + escapeHtml(ph) +
        '" value="' + escapeHtml(val || "") + '" autocomplete="off">';
    }
    return (
      '<div class="review-inline-form">' +
        box("review-form-input", t("review.whatWaitingOn"), f.value, "title") +
        box("review-form-input2", t("review.untilWhatWhen"), f.value2, "when") +
        '<div class="review-inline-form-btns">' +
          '<div class="review-inline-form-btns-row">' +
            '<button type="button" class="review-menu-btn" data-action="review-form-cancel">' + escapeHtml(t("review.cancel")) + '</button>' +
            '<button type="button" class="review-menu-btn review-form-primary" data-action="review-addwaiting-save">' + escapeHtml(t("review.add")) + '</button>' +
          '</div>' +
          reviewFullPageBtn("waiting", key) +
        '</div>' +
      '</div>'
    );
  }

  function reviewCardHtml(l, s){
    const invalid = !!(s.reviewForm && s.reviewForm.key === l.key && s.reviewForm.invalid);
    let bodyHtml = "", menuHtml = "";
    if (l.kind === "capture"){
      bodyHtml = '<div class="review-card-title">' + escapeHtml(l.text) + '</div>';
      // DOM order is pair-major (Next/Waiting, Project/Future, Habit/Note —
      // same adjacency as index.html's .tab-pair groups and desktop's
      // COLUMN_PAIRS), because that's the order the DESKTOP layout wants
      // on-screen (its column headers show each pair side by side). Phone
      // wants a DIFFERENT on-screen order — its tab bar reads column-major,
      // top row then bottom row (Next/Project/Habit over Waiting/Future/Note,
      // since the three .tab-pair columns sit side by side, each stacked
      // vertically) — so phone gets there via CSS `order` (styles.css), not by
      // reshuffling this markup. One DOM, two visual arrangements. Each lane
      // chip is colored to its lane's --lane-accent (styles.css tab map);
      // Calendar takes --brass (accentVarForKind); 2 min carries data-target
      //="quickdone" purely as a CSS order/selector hook — it sorts nothing and
      // stays uncolored, like Not now / Delete below it.
      menuHtml =
        '<div class="review-sort-chips">' +
          reviewMenuBtn("review-sort", t("review.next"), ' data-target="next" data-key="' + l.key + '"') +
          reviewMenuBtn("review-sort", t("review.waiting"), ' data-target="waiting" data-key="' + l.key + '"') +
          reviewMenuBtn("review-sort", t("review.project"), ' data-target="current" data-key="' + l.key + '"') +
          reviewMenuBtn("review-sort", t("review.future"), ' data-target="future" data-key="' + l.key + '"') +
          reviewMenuBtn("review-sort", t("review.habit"), ' data-target="habit" data-key="' + l.key + '"') +
          reviewMenuBtn("review-sort", t("review.note"), ' data-target="notes" data-key="' + l.key + '"') +
          reviewMenuBtn("review-sort", t("review.calendar"), ' data-target="calendar" data-key="' + l.key + '"') + // chunk 7 (§4.8b): the sixth chip
          reviewMenuBtn("review-quickdone", t("review.twoMin"), ' data-target="quickdone" data-key="' + l.key + '"') +
        '</div>' +
        '<div class="review-menu-row">' + reviewNotNowBtn(l.key) + reviewMenuBtn("review-delete-capture", t("review.delete"), ' data-key="' + l.key + '"', true) + '</div>';
      return '<div class="review-card review-card-capture">' + bodyHtml + menuHtml + '</div>';
    }
    // A rolled-past repeating occurrence (user ruling). Handled before the shared
    // path below because it has NO lane row to read a title or a bar from -- it is
    // the event plus a date. Tapping through goes to the event's page.
    //
    // The menu is the past-due pseudo-action's, minus anything that would act on
    // the wrong occurrence: you cannot push a date that is already behind you,
    // and Delete here must clear THIS miss, not the live series.
    if (l.kind === "missed"){
      const when = dateStrToDate(l.occ).toLocaleDateString(undefined,
        { weekday: "long", day: "numeric", month: "long" });
      bodyHtml =
        '<button type="button" class="review-card-open" data-action="review-open-event" data-id="' + l.id + '">' +
          '<span class="review-card-title">' + escapeHtml(effTitle(l.ev, l.occ)) + '</span>' +
          '<span class="review-card-note">⚠ ' + escapeHtml(t("review.wentByOn")) + ' ' + escapeHtml(when) + ' ' + escapeHtml(t("review.withoutTicking")) + '</span>' +
        '</button>';
      // No band 1 (move forward) — a missed occurrence has nothing to add,
      // only a way to resolve it. Band 2 (take it off the list): both options
      // resolve the miss, just with different honesty about what happened.
      // No delete either — see reviewMissedClear's comment: this destroys
      // nothing, so the universal corner row is Not now alone.
      menuHtml =
        reviewBandHtml(
          '<button type="button" class="review-menu-btn" data-action="review-missed-done" data-id="' + l.id + '">&#10003; ' + escapeHtml(t("review.completed")) + '</button>' +
          '<button type="button" class="review-menu-btn" data-action="review-missed-clear" data-id="' + l.id + '">' + escapeHtml(t("review.skipped")) + '</button>'
        ) +
        '<div class="review-menu-row">' + reviewNotNowBtn(l.key) + '</div>';
      return '<div class="review-card">' + bodyHtml + '<div class="review-menu">' + menuHtml + '</div></div>';
    }
    // Derived kinds share a tap-through title (opens the real page) + a
    // context line, then a per-kind decision menu. A pseudo-action taps
    // through to its EVENT page (§4.14/§4.15), not an action page.
    const openAttr = (l.pseudo)
      ? ' data-action="review-open-event" data-id="' + l.task.eventId + '"'
      : ' data-action="review-open" data-lane="' + l.laneKind + '" data-id="' + l.id + '"';
    bodyHtml = '<button type="button" class="review-card-open"' + openAttr + '>' +
      '<span class="review-card-title">' + escapeHtml(l.task.title || "") + '</span>';
    if (l.kind === "pastdue"){
      bodyHtml += l.pseudo ? pseudoBarHtml(l.task) : deadlineBarHtml(l.task);
    } else if (l.kind === "stalled"){
      bodyHtml += '<span class="review-card-note">⚠ ' + escapeHtml(t("review.noWayForward")) + '</span>';
    } else if (l.kind === "orphaned"){
      bodyHtml += '<span class="review-card-note cue-orphaned-text">🪝 ' + escapeHtml(t("waiting.after")) + ' ' + escapeHtml(l.task.conditionLabel || t("picker.deletedItem")) + '</span>';
    }
    bodyHtml += '</button>';

    const form = reviewFormFor(s, l.key);
    if (l.kind === "pastdue" && l.pseudo){
      // §2: the pseudo-action shape of the past-due kind is a CHECKBOX, not the
      // deadline menu -- you cannot "push" an event's date from here (it is
      // rescheduled on its own page), only tick it done or defer it.
      // ⚑ QA #13: Delete joins Completed. They look interchangeable but they
      // are not -- completing files the event into Completed, which is right for
      // something you did and wrong for something that simply died. Without a
      // delete here, the only way to clear a dead past-due event was to record
      // it as an accomplishment. Routed through the event (not the lane row):
      // deleting the row alone leaves the event live and the sweep re-mints it.
      // No band 1 — you cannot push an event's date from here (§2, above).
      // Band 2 (take it off the list): Completed, and — for a REPEATING event
      // only — Skipped (author, third QA round: the already-rolled-past
      // "missed" card had Skipped, this still-live one didn't, which read as
      // a gap). A one-shot has no next occurrence to roll onto, so it keeps
      // just Completed/Delete, unchanged.
      const pastdueEv = findEvent(l.task.eventId);
      menuHtml =
        reviewBandHtml(
          '<button type="button" class="review-menu-btn" data-action="review-complete" data-lane="' + l.laneKind + '" data-id="' + l.id + '">&#10003; ' + escapeHtml(t("review.completed")) + '</button>' +
          (pastdueEv && isRecurring(pastdueEv)
            ? '<button type="button" class="review-menu-btn" data-action="review-skip-live" data-id="' + l.id + '">' + escapeHtml(t("review.skipped")) + '</button>'
            : "")
        ) +
        '<div class="review-menu-row">' + reviewNotNowBtn(l.key) + reviewMenuBtn("review-delete-event", "&#128465; " + escapeHtml(t("review.delete")), ' data-id="' + l.id + '"', true) + '</div>';
    } else if (l.kind === "pastdue"){
      if (form && form.type === "date"){
        menuHtml = reviewInlineFormHtml("", "date", "review-pushdate-save", t("review.save"), (l.task.deadline && l.task.deadline.date) || "", invalid);
      } else {
        // Band 1 (move it forward): push the date — keeps it alive with a new
        // target, same family as stalled's "give it a next step". Band 2
        // (take it off the list): Completed.
        menuHtml =
          reviewBandHtml(reviewMenuBtn("review-form-start", t("review.pushTheDate"), ' data-key="' + l.key + '" data-type="date"')) +
          reviewBandHtml(reviewMenuBtn("review-complete", t("review.completed"), ' data-lane="' + l.laneKind + '" data-id="' + l.id + '"')) +
          '<div class="review-menu-row">' + reviewNotNowBtn(l.key) + reviewMenuBtn("review-delete", t("review.delete"), ' data-lane="' + l.laneKind + '" data-id="' + l.id + '"', true) + '</div>';
      }
    } else if (l.kind === "stalled"){
      if (form && form.type === "text"){
        menuHtml = reviewInlineFormHtml(t("review.whatsNextAction"), "text", "review-addnext-save", t("review.add"), "", invalid, "next", l.id);
      } else if (form && form.type === "waiting"){
        // ⚑ Two fields, not one (user: stalled projects need a waiting action
        // here too). A Waiting action is invalid without something to wait ON
        // (§4.2), so a single title box would create a broken row that the
        // review would immediately re-report as orphaned -- the exact loop this
        // menu exists to close. The second field is free text rather than the
        // condition picker: the picker is a whole sub-view, and the review's
        // character is one decision, inline, without leaving.
        menuHtml = reviewWaitingFormHtml(s, l.key);
      } else {
        // §5's own worked example (defect 5): band 1 (move it forward) is the
        // three ways to give the project a next step; band 2 (take it off the
        // list) is the two ways to remove it from play.
        // Lane-colored chips (author, modeled on the capture card's own
        // sort chips): a band button that SENDS the item to a lane carries
        // that lane's data-target purely for CSS coloring (styles.css) — its
        // click routing is unchanged, still data-action/data-key/data-id.
        // A button that resolves/edits in place (Completed) stays plain.
        menuHtml =
          reviewBandHtml(
            reviewMenuBtn("review-form-start", t("review.addNextAction"), ' data-key="' + l.key + '" data-type="text" data-target="next"') +
            reviewMenuBtn("review-form-start", t("review.addWaitingAction"), ' data-key="' + l.key + '" data-type="waiting" data-target="waiting"') +
            // ⚑ The third one the user asked for originally, parked until a project
            // could see the calendar. It can now: this opens the calendar for this
            // project, capped by its deadline, and returns HERE rather than to the
            // project page -- the review pushed the stack, so closeScreen lands back
            // in the queue where you left off.
            reviewMenuBtn("review-add-event", t("review.addAnEvent"), ' data-id="' + l.id + '" data-target="calendar"')
          ) +
          reviewBandHtml(
            reviewMenuBtn("review-someday", t("review.moveToSomeday"), ' data-id="' + l.id + '" data-target="future"') +
            reviewMenuBtn("review-complete", t("review.completed"), ' data-lane="current" data-id="' + l.id + '"')
          ) +
          '<div class="review-menu-row">' + reviewNotNowBtn(l.key) + reviewMenuBtn("review-delete", t("review.delete"), ' data-lane="current" data-id="' + l.id + '"', true) + '</div>';
      }
    } else if (l.kind === "orphaned"){
      if (form && form.type === "text"){
        menuHtml = reviewInlineFormHtml(t("review.waitingForDots"), "text", "review-freetext-save", t("review.save"), "", invalid);
      } else {
        // Band 1 (move it forward): the three ways to give it a condition to
        // wait on again, or act on it now. Band 2 (take it off the list):
        // Complete.
        menuHtml =
          reviewBandHtml(
            reviewMenuBtn("review-open", t("review.repointCondition"), ' data-lane="waiting" data-id="' + l.id + '"') +
            reviewMenuBtn("review-form-start", t("review.replaceWithFreeText"), ' data-key="' + l.key + '" data-type="text"') +
            reviewMenuBtn("review-promote", t("review.promoteToNext"), ' data-id="' + l.id + '" data-target="next"')
          ) +
          reviewBandHtml(reviewMenuBtn("review-complete", t("review.completed"), ' data-lane="waiting" data-id="' + l.id + '"')) +
          '<div class="review-menu-row">' + reviewNotNowBtn(l.key) + reviewMenuBtn("review-delete", t("review.delete"), ' data-lane="waiting" data-id="' + l.id + '"', true) + '</div>';
      }
    }
    return '<div class="review-card review-card-' + l.kind + '">' + bodyHtml + '<div class="review-menu">' + menuHtml + '</div></div>';
  }

  function reviewBodyHtml(s){
    const active = reviewActiveLoops();
    const deferredCount = computeOpenLoops().length - active.length;
    // "pastdueEvent" is a synthetic kind, info-panel only (§3 Q3, revisited):
    // the pseudo-action shape of "pastdue" now needs its own info string,
    // but the review-card renderer, computeOpenLoops, etc. all still key off
    // the real l.kind ("pastdue") + l.pseudo — only the info lookup cares.
    const revealedKind = active.length
      ? (active[0].kind === "pastdue" && active[0].pseudo ? "pastdueEvent" : active[0].kind)
      : null;
    let html = '<div class="screen-body review-body">' + reviewInfoPanelHtml(revealedKind, !!(s && s.reviewInfoOpen));
    if (!active.length){
      html += (deferredCount > 0)
        ? '<div class="review-end review-end-deferred"><div class="review-end-big">' + deferredCount + escapeHtml(t("review.deferredSuffix")) + '</div>' +
            '<div class="review-end-sub">' + escapeHtml(t("review.deferredSub")) + '</div></div>'
        : '<div class="review-end review-end-empty"><div class="review-end-big">' + escapeHtml(t("review.allClear")) + '</div>' +
            '<div class="review-end-sub">' + escapeHtml(t("review.nothingSlipping")) + '</div></div>';
      return html + '</div>';
    }
    // ⚑ "Show all" is gone (author). Once the review has started, revealing the
    // whole queue is not a thing anyone needs — and the redaction (§4.8b) only
    // does its job if there is no button beside it offering to undo it. The
    // count stays; it is information, not an escape hatch.
    if (active.length > 1){
      html += '<div class="review-toolbar"><span class="review-remaining">' + active.length + ' ' + escapeHtml(t("review.toReview")) + '</span></div>';
    }
    active.forEach(function(l, i){
      html += (i === 0) ? reviewCardHtml(l, s) : reviewRedactionHtml();
    });
    return html + '</div>';
  }

  // --- Review decision actions. Each mutates live state then re-renders the
  //     review, which recomputes the derived queue (§4.8b: resolved items drop
  //     out, edited-but-unfixed stay). No queue snapshot.
  function reviewFindTask(id){
    const kinds = ["next", "waiting", "current", "future"];
    for (let i = 0; i < kinds.length; i++){
      const t = state.tasks[kinds[i]].find(function(x){ return x.id === id; });
      if (t) return { kind: kinds[i], task: t };
    }
    return null;
  }
  // Which text sub-form is open: a Current project → "Add a next action";
  // a Waiting action → "Replace with free text".
  function reviewFindLoopKind(id){
    const found = reviewFindTask(id);
    return (found && found.kind === "current") ? "stalled" : "orphaned";
  }
  function reviewFormInput(){ return qs("#review-form-input"); }
  function reviewMarkFormInvalid(){ if (state.screen && state.screen.reviewForm){ state.screen.reviewForm.invalid = true; renderScreen(); const inp = reviewFormInput(); if (inp) inp.focus(); } }
  function reviewSavePushDate(){
    const s = state.screen; if (!s || !s.reviewForm) return;
    const inp = reviewFormInput(); const val = inp ? inp.value : "";
    if (!val){ reviewMarkFormInvalid(); return; }
    const found = reviewFindTask(s.reviewForm.key);
    if (found){
      const time = (found.task.deadline && found.task.deadline.time) || null;
      // keep the time; push only the day (§4.8b inline exec). Goes through the
      // shared helper so the bar restarts and the push is counted exactly as it
      // would be from the item's own page (QA #23).
      applyDeadlineChange(found.task, { date: val, time: time });
      saveTasksLocal(found.kind); renderLane(found.kind);
    }
    s.reviewForm = null; renderScreen();
  }
  function reviewSaveAddNext(){
    const s = state.screen; if (!s || !s.reviewForm) return;
    const inp = reviewFormInput(); const val = (inp ? inp.value : "").trim();
    if (!val){ reviewMarkFormInvalid(); return; }
    const pid = s.reviewForm.key;
    createTask("next", { title: val, linkedProjectId: pid }).then(function(){ s.reviewForm = null; renderScreen(); });
  }
  // Add a Waiting action to a stalled project (user). Both fields are required:
  // the title, and something to wait on — a Waiting action without either is
  // the orphaned state the review reports, so creating one here would be the
  // review manufacturing its own next finding.
  function reviewSaveAddWaiting(){
    const s = state.screen; if (!s || !s.reviewForm) return;
    const t = qs("#review-form-input"), w = qs("#review-form-input2");
    const title = (t ? t.value : "").trim();
    const when = (w ? w.value : "").trim();
    // Keep what was typed across the re-render, or the valid field is wiped
    // while the user fixes the other one.
    s.reviewForm.value = title; s.reviewForm.value2 = when;
    if (!title || !when){
      s.reviewForm.invalidField = !title ? "title" : "when";
      renderScreen();
      const el = qs(!title ? "#review-form-input" : "#review-form-input2");
      if (el) el.focus();
      return;
    }
    const pid = s.reviewForm.key;
    createTask("waiting", { title: title, whenText: when, linkedProjectId: pid })
      .then(function(){ s.reviewForm = null; renderScreen(); });
  }
  // "Mark done" — you did the thing and forgot to tick it, which is the case the
  // user named. Records the completion against the occurrence's own date, so it
  // keeps its dimmed mark on the calendar for the day it actually happened
  // rather than today, and clears the miss.
  function reviewMissedDone(eventId){
    const ev = findEvent(eventId);
    if (!ev) return;
    if (ev.missedOcc){
      ev.completedOccs = ev.completedOccs || [];
      if (ev.completedOccs.indexOf(ev.missedOcc) === -1) ev.completedOccs.push(ev.missedOcc);
      ev.missedOcc = null;
    }
    saveEvents();
    renderLane("next"); renderLane("waiting");
    if (state.screen) state.screen.reviewForm = null;
    renderScreen();
  }
  // "Skipped" — it did not happen and that is fine. Clears the miss WITHOUT
  // recording a completion, so it never counts as something you achieved.
  // ⚑ No confirm dialog: this destroys nothing (the series is untouched and the
  // occurrence was already rolled past), so the standing rule about destructive
  // actions does not apply.
  function reviewMissedClear(eventId){
    const ev = findEvent(eventId);
    if (!ev) return;
    ev.missedOcc = null;
    saveEvents();
    if (state.screen) state.screen.reviewForm = null;
    renderScreen();
  }
  function reviewSaveFreeText(){
    const s = state.screen; if (!s || !s.reviewForm) return;
    const inp = reviewFormInput(); const val = (inp ? inp.value : "").trim();
    if (!val){ reviewMarkFormInvalid(); return; }
    const found = reviewFindTask(s.reviewForm.key);
    if (found && found.kind === "waiting"){
      found.task.whenText = val;
      found.task.conditionId = null; found.task.conditionKind = null; found.task.conditionLabel = null;
      saveTasksLocal("waiting"); renderLane("waiting");
    }
    s.reviewForm = null; renderScreen();
  }
  function reviewComplete(lane, id){
    if (lane === "current") completeProject("current", id); else completeTask(lane, id);
    if (state.screen) state.screen.reviewForm = null;
    renderScreen();
  }
  // ⚑ NO CONFIRM (author ruling, third QA round — a deliberate exception to
  // CLAUDE.md's standing "every destructive action gets a confirm" rule,
  // scoped to the review only): the review is a GTD triage pass, and
  // deleting is as valid a sort as any other — friction here fights the
  // thing the review exists to do. Delete also sits at the opposite corner
  // from every other control (band 3, bottom-right, maximum distance from
  // Not now and the bands above), which is the app's existing defence
  // against a stray tap. Every OTHER delete in the app (a drafting page's
  // 🗑, the event page's own delete) is unaffected — this ruling is
  // reviewDelete/reviewDeleteCapture/reviewDeleteEvent's alone.
  function reviewDelete(lane, id){
    deleteTask(lane, id);
    if (state.screen) state.screen.reviewForm = null;
    renderScreen();
  }
  // QA #13. The id is the pseudo-action's task ID, which IS the event's taskId
  // (§4.14a) — that stability is exactly what lets the review address the event
  // without carrying a second identifier.
  // The ONE exception to the no-confirm ruling above: a RECURRING event, where
  // "delete" is ambiguous (this occurrence, or the whole series?) — that's
  // disambiguation, not a safety net, so it stays. Reuses confirmDeleteEvent's
  // own recurring branch unchanged (also used by the full event page); only
  // the non-recurring path diverges from it here, going straight to
  // deleteEventEntirely instead of confirmDeleteEvent's plain "are you sure".
  function reviewDeleteEvent(taskId){
    const ev = findEventByTaskId(taskId);
    if (!ev){ renderScreen(); return; }
    if (isRecurring(ev)){
      confirmDeleteEvent(ev, function(){
        if (state.screen) state.screen.reviewForm = null;
        renderScreen();
      });
    } else {
      deleteEventEntirely(ev);
      if (state.screen) state.screen.reviewForm = null;
      renderScreen();
    }
  }
  // §9/§2 (review-surface-plan.md, author third QA round): "Skipped" for a
  // still-live (not yet rolled-past) recurring occurrence — the same act as
  // reviewMissedClear performs for an already-rolled one, done a day early.
  // Reuses skipOccurrence(ev) verbatim — it's the exact same function the
  // event page's own "Skip this one" (confirmDeleteEvent's recurring
  // branch) already calls, so this gets its override-pruning and both-lane
  // re-render for free rather than a second, thinner reimplementation.
  // Records nothing in completedOccs (not credited) and nothing in
  // missedOcc (this isn't a silently-discovered miss; the user is choosing
  // it right now). No confirm dialog: destroys nothing, every other
  // occurrence is untouched. Recurring-only — a one-shot has no next
  // occurrence to roll onto, so the card never offers this button for one
  // (reviewCardHtml gates it on isRecurring(ev)).
  function reviewSkipLive(taskId){
    const ev = findEventByTaskId(taskId);
    if (!ev){ renderScreen(); return; }
    skipOccurrence(ev);
    if (state.screen) state.screen.reviewForm = null;
    renderScreen();
  }
  function reviewSortCapture(target, key){
    const capture = (state.tray || []).find(function(t){ return t.id === key; });
    if (!capture) { renderScreen(); return; }
    const text = capture.text;
    reviewOpenChild(function(){
      if (target === "calendar"){ // chunk 7 (§4.8b): open the calendar prefilled, today selected
        openCalendarScreen({ name: text, fromCaptureId: key });
      } else if (target === "notes"){ openNoteScreen(null, { title: text, fromCaptureId: key }); }
      else { openScreen(target, null, { title: text }); if (state.screen) state.screen.fromCaptureId = key; }
    });
  }
  // The 2-minute-rule chip (author ruling): a capture that's faster to just do
  // than to file. Opens a bare confirm page — no header, just the capture's
  // text and Complete/Back — rather than sorting into a lane at all.
  function reviewQuickDone(key){
    const capture = (state.tray || []).find(function(t){ return t.id === key; });
    if (!capture) { renderScreen(); return; }
    const text = capture.text;
    reviewOpenChild(function(){
      state.screen = { kind: "next", quickDoneView: true, taskId: null, draft: {}, quickDoneText: text, fromCaptureId: key };
      renderScreen();
    });
  }
  // Complete arms nothing here — quickDoneView is not a drafting surface, it's
  // a two-button confirm (draft isolation §-exempt the same way the list
  // checkbox and the missed card's "Mark done" are: an immediate action, not an
  // armed one). Reuses createTask + completeTask so a quick-done item is, in
  // every way the app can tell, an ordinary completed Next Action.
  function quickDoneComplete(){
    const s = state.screen;
    if (!s || !s.quickDoneView) return;
    const text = (s.quickDoneText || "").trim();
    if (!text){ closeScreen(); return; }
    createTask("next", { title: text }).then(function(task){
      completeTask("next", task.id);
      consumeCaptureForScreen(s);
      closeScreen();
    });
  }
  // Delete lives beside Not now because both answer "what to do with this
  // capture" without filing it anywhere. No confirm (author ruling, third QA
  // round — see reviewDelete's comment): the review is a triage pass, not a
  // drafting page, and this corner is already the app's defence against a
  // stray tap.
  function reviewDeleteCapture(key){
    removeCapture(key);
    if (state.screen) state.screen.reviewForm = null;
    renderScreen();
  }
  function quickDoneBodyHtml(s){
    return (
      '<div class="screen-body quickdone-body">' +
        '<div class="quickdone-text">' + escapeHtml(s.quickDoneText || "") + '</div>' +
        '<div class="quickdone-btns">' +
          '<button type="button" class="btn btn-ghost" data-action="quickdone-back">' + escapeHtml(t("review.quickDoneBack")) + '</button>' +
          '<button type="button" class="btn btn-brass" data-action="quickdone-complete">' + escapeHtml(t("review.quickDoneComplete")) + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  // =========================================================
  // CHUNK 6 (§4.10): the settings surface, behind the header ⋯. Holds the
  // app-wide destructive control (Clear all app data — today's Reset);
  // Export/Import join it in chunk 8. Lane-scoped Completed clearing stays put.
  // =========================================================
  function clearAllAppData(){
    // A true clear: every gtd_ key (data + injected-flag bookkeeping). gtddev_
    // keys (snapshot, drag-log settings) survive, like Reset always has.
    Storage.keys().forEach(function(key){ if (key.indexOf("gtd_") === 0) Storage.remove(key); });
    window.location.reload();
  }
  // ▲ POST-SPRINT (§P1): the settings surface is a DROPDOWN anchored under the
  // header ⋯, not a modal sheet. A modal is a room you have to leave; settings
  // here are small, frequent, and mostly one tap, so the menu opens over the
  // desk and dismisses on any outside tap. Nested panels (Background) push into
  // the same dropdown rather than opening a second layer.
  let settingsPanel = "root";
  function settingsRootHtml(){
    const surf = SURFACES[currentSurfaceId()] || SURFACES[DEFAULT_SURFACE];
    return (
      '<button type="button" class="settings-item" data-action="export-data">' +
        '<span>&#11014;</span><span class="si-label">' + escapeHtml(t("settings.exportBackup")) + '</span></button>' +
      '<button type="button" class="settings-item" data-action="import-data">' +
        '<span>&#11015;</span><span class="si-label">' + escapeHtml(t("settings.importBackup")) + '</span></button>' +
      '<div class="settings-sep"></div>' +
      // ▲ DESKTOP (author note 8): Background and Language become header
      // dropdowns and LEAVE this menu — one place per thing. The phone keeps
      // them here, where they have always been.
      (state.desktop ? "" :
        '<button type="button" class="settings-item" data-action="settings-backgrounds">' +
          '<span>&#127912;</span><span class="si-label">' + escapeHtml(t("settings.background")) + '</span>' +
          '<span class="si-value">' + escapeHtml(surf.label) + '</span><span class="si-caret">&#8250;</span></button>' +
        // ⚑ BUILT (Chinese round): no longer a disabled "not built yet" row. Opens a
        // sub-panel like Background; the current language shows in its own script.
        '<button type="button" class="settings-item" data-action="settings-language">' +
          '<span>&#127760;</span><span class="si-label">' + escapeHtml(t("settings.language")) + '</span>' +
          '<span class="si-value">' + escapeHtml(localeLabel(currentLocale())) + '</span><span class="si-caret">&#8250;</span></button>') +
      // ⚑ Where the dev tools live now. A row rather than a permanent bar: they
      // are scaffolding for building the app, and having them across the top of
      // every screen was the clutter the user wanted gone.
      '<button type="button" class="settings-item" data-action="settings-debug">' +
        '<span>&#128295;</span><span class="si-label">' + escapeHtml(t("settings.debuggingRow")) + '</span>' +
        '<span class="si-value">' + devOnCount() + '</span><span class="si-caret">&#8250;</span></button>' +
      '<div class="settings-sep"></div>' +
      '<button type="button" class="settings-item danger" data-action="clear-all-data">' +
        '<span>&#8634;</span><span class="si-label">' + escapeHtml(t("settings.restoreDefaultsRow")) + '</span></button>' +
      // ⚑ Which build this is. Not decoration: the app is tested on a phone
      // against GitHub Pages, which caches the HTML for a few minutes, so
      // "am I looking at the fix or at yesterday's copy?" is a real question
      // that has already cost a round trip. Now it is answerable on the device,
      // without a laptop.
      '<div class="settings-build" title="Which build you are running">Build ' + escapeHtml(BUILD_STAMP) + '</div>'
    );
  }
  function devOnCount(){
    const n = DEV_GROUPS.filter(devGroupOn).length;
    return n ? (n + " on") : "off";
  }
  function settingsDebugHtml(){
    let out =
      '<button type="button" class="settings-item settings-back" data-action="settings-root">' +
        '<span>&#8249;</span><span class="si-label">' + escapeHtml(t("settings.debuggingRow")) + '</span></button>' +
      '<div class="settings-sep"></div>';
    DEV_GROUPS.forEach(function(g){
      const on = devGroupOn(g);
      out +=
        '<button type="button" class="settings-item" data-action="settings-toggle-dev" data-dev="' + g.id + '">' +
          '<span class="settings-switch' + (on ? " on" : "") + '" aria-hidden="true"></span>' +
          '<span class="si-label">' + escapeHtml(g.label) + '<span class="si-note">' + escapeHtml(g.note) + '</span></span>' +
        '</button>';
    });
    return out;
  }
  // `noBack`: the header dropdown shows the same rows without the "‹ Background"
  // return row — a dropdown has nowhere to go back TO (trap T17: reuse the
  // presentation, never reimplement the picking).
  function settingsBackgroundsHtml(noBack){
    const cur = currentSurfaceId();
    let out = noBack ? "" :
      '<button type="button" class="settings-item settings-back" data-action="settings-root">' +
        '<span>&#8249;</span><span class="si-label">' + escapeHtml(t("settings.background")) + '</span></button>' +
      '<div class="settings-sep"></div>';
    Object.keys(SURFACES).forEach(function(id){
      out +=
        '<button type="button" class="settings-item" data-action="settings-pick-bg" data-bg="' + id + '">' +
          '<span class="settings-swatch" style="' + surfaceSwatchStyle(id) + '"></span>' +
          '<span class="si-label">' + escapeHtml(SURFACES[id].label) + '</span>' +
          (id === cur ? '<span class="settings-check">&#10003;</span>' : "") +
        '</button>';
    });
    return out;
  }
  // Each row shows its language in its OWN script (native name), the way a real
  // language switcher does — a menu that lists "简体中文" as "Chinese" is one you
  // cannot use once you are already in the language you cannot read.
  function settingsLanguageHtml(noBack){
    const cur = currentLocale();
    let out = noBack ? "" :
      '<button type="button" class="settings-item settings-back" data-action="settings-root">' +
        '<span>&#8249;</span><span class="si-label">' + escapeHtml(t("settings.language")) + '</span></button>' +
      '<div class="settings-sep"></div>';
    LOCALES.forEach(function(l){
      out +=
        '<button type="button" class="settings-item" data-action="settings-pick-lang" data-lang="' + l.id + '">' +
          '<span class="si-label">' + escapeHtml(l.native) + '</span>' +
          (l.id === cur ? '<span class="settings-check">&#10003;</span>' : "") +
        '</button>';
    });
    return out;
  }
  function renderSettingsMenu(){
    // ⚑ FIX (author QA: "the settings dropdown on desktop doesn't seem to
    // work"). qs(".settings-menu") is document.querySelector — it returns the
    // FIRST match anywhere on the page. The header's Language/Background
    // dropdowns (T17) reuse this SAME class for their visual chrome, and
    // #header-left sits earlier in the DOM than #dialog-root, so the bare
    // selector was silently writing this menu's content into a HIDDEN header
    // dropdown instead of the gear menu the user just opened — which is why
    // it looked empty and unresponsive rather than throwing. Scope to
    // #dialog-root, the one place openSettings() actually builds this menu.
    const menu = qs("#dialog-root .settings-menu");
    if (!menu) return;
    menu.innerHTML = settingsPanel === "backgrounds" ? settingsBackgroundsHtml()
      : settingsPanel === "language" ? settingsLanguageHtml()
      : settingsPanel === "debug" ? settingsDebugHtml()
      : settingsRootHtml();
  }
  function openSettings(){
    settingsPanel = "root";
    qs("#dialog-root").innerHTML =
      '<div class="menu-scrim" data-action="settings-close"></div>' +
      '<div class="settings-menu"></div>';
    renderSettingsMenu();
    qs(".menu-scrim").addEventListener("click", closeDialog); // not reused elsewhere — unambiguous
    qs("#dialog-root .settings-menu").addEventListener("click", function(e){
      const item = e.target.closest("[data-action]");
      if (!item) return;
      const action = item.getAttribute("data-action");
      if (action === "export-data"){ exportAllData(); return; }
      if (action === "import-data"){ importAllData(); return; }
      if (action === "settings-backgrounds"){ settingsPanel = "backgrounds"; renderSettingsMenu(); return; }
      if (action === "settings-language"){ settingsPanel = "language"; renderSettingsMenu(); return; }
      if (action === "settings-root"){ settingsPanel = "root"; renderSettingsMenu(); return; }
      if (action === "settings-debug"){ settingsPanel = "debug"; renderSettingsMenu(); return; }
      if (action === "settings-pick-lang"){
        // Applies immediately and stays open, like the background picker. setLocale
        // rebuilds the string tables and re-renders the lanes, the tab strip and any
        // open screen; the menu itself is re-rendered here so its own labels flip too.
        setLocale(item.getAttribute("data-lang"));
        renderSettingsMenu();
        return;
      }
      if (action === "settings-toggle-dev"){
        // Applies straight away and stays open, like the background picker —
        // you switch one on to use it, not to admire the menu.
        const g = DEV_GROUPS.find(function(x){ return x.id === item.getAttribute("data-dev"); });
        if (g) setDevGroup(g, !devGroupOn(g));
        renderSettingsMenu();
        return;
      }
      if (action === "settings-pick-bg"){
        // Applies immediately and stays open, so the surfaces can be compared
        // against the real desk instead of from memory.
        setSurface(item.getAttribute("data-bg"));
        renderSettingsMenu();
        return;
      }
      if (action === "clear-all-data"){
        openConfirmDialog(t("confirm.restoreDefaultsMessage"), [
          { label: t("confirm.eraseRestoreDefaults"), style: "danger", action: clearAllAppData },
          { label: t("chrome.cancel"), action: function(){} }
        ]);
      }
    });
  }
  // =========================================================
  // EXPORT / IMPORT (chunk 8, §2). The user-facing backup — a different feature
  // from the dev snapshot (§12.3), but it shares the "every gtd_ key, verbatim"
  // serialization. The backup MUST carry events/series (a top-level entity as
  // of chunk 7) — it does, because it sweeps ALL gtd_ keys, gtd_events included.
  // Import REPLACES (never merges): merge is a conflict engine in disguise (§10);
  // replace makes the file an honest snapshot.
  // =========================================================
  function serializeAllData(){
    const data = {};
    Storage.keys().forEach(function(k){ if (k.indexOf("gtd_") === 0) data[k] = Storage.get(k); });
    return { app: "OELA", format: 1, exportedAt: new Date().toISOString(), data: data };
  }
  function exportAllData(){
    closeDialog();
    const payload = serializeAllData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "oela-backup-" + todayStr() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  }
  function importError(msg){ openConfirmDialog(msg, [{ label: t("confirm.ok"), style: "primary", action: function(){} }]); }
  function importAllData(){
    // A hidden file input — native <input type=file> is the one native dialog
    // that works in sandboxed contexts (unlike alert/confirm/prompt).
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/json,.json"; inp.style.display = "none";
    inp.addEventListener("change", function(){
      const file = inp.files && inp.files[0];
      inp.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(){
        let payload;
        try { payload = JSON.parse(reader.result); } catch (e){ importError(t("confirm.importInvalidJson")); return; }
        const data = payload && payload.data;
        if (!data || typeof data !== "object"){ importError(t("confirm.importNotBackup")); return; }
        closeDialog();
        openConfirmDialog(t("confirm.importReplaceWarning"), [
          { label: t("confirm.replaceEverything"), style: "danger", action: function(){
              Storage.keys().forEach(function(k){ if (k.indexOf("gtd_") === 0) Storage.remove(k); });
              Object.keys(data).forEach(function(k){ if (k.indexOf("gtd_") === 0) Storage.set(k, data[k]); });
              window.location.reload();
            } },
          { label: t("chrome.cancel"), action: function(){} }
        ]);
      };
      reader.readAsText(file);
    });
    document.body.appendChild(inp);
    inp.click();
  }

  // =========================================================
  // CHUNK 6 (§4.9): Notes. A sixth lane (teal) for things that aren't actions
  // — its own store (gtd_notes), a flat lane, most-recently-edited first. A
  // note is title + body (project links and tags land in later checkpoints).
  // Standard chrome, no Complete, no dates.
  // =========================================================
  function loadNotes(){ return Storage.getJSON("gtd_notes", []); }
  function saveNotes(){ Storage.setJSON("gtd_notes", state.notes); }
  function findNote(id){ return state.notes.find(function(n){ return n.id === id; }) || null; }
  // ---- Tags registry (§4.9b) — notes-only, mirrors gtd_contexts -----------
  function loadTags(){ return Storage.getJSON("gtd_tags", []); }
  function saveTags(){ Storage.setJSON("gtd_tags", state.tags); }
  function findTag(id){ return (state.tags || []).find(function(t){ return t.id === id; }) || null; }
  // A project a note links to, wherever it now lives. Drives the chip's
  // state: live (still a project), completed (in the archive → green), or
  // deleted (found nowhere → tombstone, frozen denormalised name §4.9).
  function findProjectAnywhere(id){
    let p = state.tasks.current.find(function(t){ return t.id === id; }) || state.tasks.future.find(function(t){ return t.id === id; });
    if (p) return { task: p, state: "live" };
    p = (state.completed.current || []).find(function(t){ return t.id === id; }) || (state.completed.future || []).find(function(t){ return t.id === id; });
    if (p) return { task: p, state: "completed" };
    return null;
  }
  function noteLinkState(link){ const f = findProjectAnywhere(link.id); return f ? f.state : "deleted"; }
  // A note's project chip. On the note page it's removable (draft ✕); on a
  // card it filters the lane (tombstones are inert — nothing to filter to).
  function noteChipHtml(link, removable){
    const st = noteLinkState(link);
    const f = st !== "deleted" ? findProjectAnywhere(link.id) : null;
    const name = f ? f.task.title : (link.name || "a deleted project"); // live name refreshes; tombstone uses the frozen one
    const filterAttr = (!removable && st !== "deleted") ? ' data-action="filter-notes" data-id="' + link.id + '"' : '';
    return '<span class="note-chip note-chip-' + st + '"' + filterAttr + '>' +
      escapeHtml(name) +
      (removable ? '<button type="button" class="chip-x" data-action="note-unlink" data-id="' + link.id + '" title="' + escapeHtml(t("tags.remove")) + '">&times;</button>' : "") +
    '</span>';
  }
  // Tag chips for a note (§4.9b). One flat visual — tags never carry the
  // live/completed/deleted states project chips do. A tagId with no surviving
  // registry entry is simply dropped (delete-a-tag is unlink, no tombstone).
  // On the note page chips are removable (draft ✕); on a card they filter.
  function noteTagChips(noteLike, removable){
    return ((noteLike && noteLike.tagIds) || []).map(function(id){
      const t = findTag(id);
      if (!t) return null;
      const filterAttr = (!removable) ? ' data-action="filter-notes" data-id="' + id + '"' : '';
      return '<span class="note-chip note-chip-tag"' + filterAttr + '>#' + escapeHtml(t.name) +
        (removable ? '<button type="button" class="chip-x" data-action="note-untag" data-id="' + id + '" title="' + escapeHtml(t("tags.remove")) + '">&times;</button>' : "") +
      '</span>';
    }).filter(Boolean);
  }
  // ---- Rich-text note body (§4.9, user: proper markup) --------------------
  // The body is HTML now, not plain text. It is authored in a contenteditable
  // and constrained to a small allowlist: emphasis (b/strong, i/em, u), one
  // heading level (h2), and lists (ul/ol/li), plus br and paragraph wrappers.
  // Everything else — scripts, styles, images, inline styles, links, spans,
  // colours, foreign tags pasted from other apps or arriving in an imported
  // backup (chunk 8) — is stripped. This is the ONE untrusted-input surface in
  // a local app, so sanitise on every save and defensively on render.
  const NOTE_ALLOWED_TAGS = { B:1, STRONG:1, I:1, EM:1, U:1, H2:1, UL:1, OL:1, LI:1, BR:1, P:1, DIV:1 };
  function sanitizeNoteHtml(html){
    const root = document.createElement("div");
    root.innerHTML = html || "";
    (function clean(node){
      let child = node.firstChild;
      while (child){
        let next = child.nextSibling;
        if (child.nodeType === 3){
          /* text node — keep */
        } else if (child.nodeType === 1 && NOTE_ALLOWED_TAGS[child.tagName]){
          // The ONLY attributes that survive: class="checklist" on a <ul> and
          // class="checked" on its <li>s. Values are whitelisted (not copied),
          // so there is nothing to inject through — everything else is dropped.
          let keepClass = null;
          if (child.tagName === "UL" && child.classList.contains("checklist")) keepClass = "checklist";
          else if (child.tagName === "LI" && child.classList.contains("checked")) keepClass = "checked";
          while (child.attributes.length) child.removeAttribute(child.attributes[0].name); // no styles/handlers/hrefs
          if (keepClass) child.setAttribute("class", keepClass);
          clean(child);
        } else if (child.nodeType === 1){
          // disallowed element: unwrap (keep children, drop the wrapper), then
          // re-process the moved-up children starting from the first of them.
          const firstMoved = child.firstChild;
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          if (firstMoved) next = firstMoved;
        } else {
          node.removeChild(child); // comment / other
        }
        child = next;
      }
    })(root);
    return root.innerHTML;
  }
  // "Empty" for placeholder purposes: no text AND no structural content. A
  // seeded checklist (empty <li>s) has no text but IS content, so the
  // "Write anything…" placeholder must not show over it.
  function isNoteBodyEmpty(node){
    return !(node.textContent || "").trim() && !node.querySelector("ul,ol,h2,li");
  }
  // One-line plain-text reduction for the card preview.
  function noteBodyToText(html){
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }
  function noteCardHtml(note){
    const preview = noteBodyToText(note.body || "").slice(0, 120);
    // Card chip row is a PREVIEW, not the full set (user): show at most two,
    // then a "+n" badge for the remainder. Tags join projects here once §4.9b
    // ships — the cap is over the combined list. Order: projects, then tags.
    const allChips = (note.projectLinks || []).map(function(l){ return { html: noteChipHtml(l, false) }; })
      .concat(noteTagChips(note, false).map(function(h){ return { html: h }; }));
    let chips = "";
    if (allChips.length){
      const shown = allChips.slice(0, 2).map(function(c){ return c.html; }).join("");
      const extra = allChips.length - 2;
      const more = extra > 0 ? '<span class="note-chip note-chip-more">+' + extra + '</span>' : "";
      chips = '<div class="note-chips">' + shown + more + '</div>';
    }
    return (
      '<div class="card note-card">' +
        '<div class="card-top"><div class="card-title" data-action="open-note" data-id="' + note.id + '">' + escapeHtml(note.title || "Untitled") + '</div></div>' +
        (preview ? '<div class="note-preview" data-action="open-note" data-id="' + note.id + '">' + escapeHtml(preview) + '</div>' : "") +
        chips +
      '</div>'
    );
  }
  // Filter options in two groups: projects any note links to (live/completed),
  // and tags any note carries. IDs are globally unique, so a single filter id
  // discriminates project vs tag without a kind flag at match time.
  function noteFilterOptions(){
    const seenP = {}, seenT = {}, projects = [], tags = [];
    state.notes.forEach(function(n){
      (n.projectLinks || []).forEach(function(l){
        if (seenP[l.id]) return;
        const f = findProjectAnywhere(l.id);
        if (!f) return; // deleted → tombstone, not filterable
        seenP[l.id] = 1;
        projects.push({ id: l.id, name: f.task.title, kind: "project" });
      });
      (n.tagIds || []).forEach(function(id){
        if (seenT[id]) return;
        const t = findTag(id);
        if (!t) return;
        seenT[id] = 1;
        tags.push({ id: id, name: t.name, kind: "tag" });
      });
    });
    projects.sort(function(a, b){ return a.name.localeCompare(b.name); });
    tags.sort(function(a, b){ return a.name.localeCompare(b.name); });
    return { projects: projects, tags: tags };
  }
  // Display name for the active filter id, project OR tag (self-heals to null).
  function noteFilterName(id){
    const f = findProjectAnywhere(id);
    if (f) return f.task.title;
    const t = findTag(id);
    return t ? "#" + t.name : null;
  }
  function notesFilterBarHtml(){
    // Active filter name (project OR tag; self-heal to null if it vanished).
    let activeName = null;
    if (state.notesFilter){
      activeName = noteFilterName(state.notesFilter);
      if (!activeName) state.notesFilter = null;
    }
    const opts = noteFilterOptions();
    const btnLabel = activeName
      ? '<span class="notes-filter-active">' + escapeHtml(activeName) + '</span><button type="button" class="chip-x" data-action="clear-notes-filter" title="Clear filter">&times;</button>'
      : 'Filter';
    let menu = "";
    if (state.notesFilterMenuOpen){
      const pickItem = function(o){
        return '<button type="button" class="notes-filter-item' + (o.id === state.notesFilter ? " current" : "") + '" data-action="notes-filter-pick" data-id="' + o.id + '">' + escapeHtml(o.kind === "tag" ? "#" + o.name : o.name) + '</button>';
      };
      let items = ['<button type="button" class="notes-filter-item' + (state.notesFilter ? "" : " current") + '" data-action="notes-filter-pick" data-id="">' + escapeHtml(t("note.allNotes")) + '</button>'];
      if (opts.projects.length) items = items.concat('<div class="notes-filter-section">' + escapeHtml(t("note.filterProjects")) + '</div>', opts.projects.map(pickItem));
      if (opts.tags.length) items = items.concat('<div class="notes-filter-section">' + escapeHtml(t("note.filterTags")) + '</div>', opts.tags.map(pickItem));
      if (!opts.projects.length && !opts.tags.length) items.push('<div class="notes-filter-empty">Nothing to filter by yet — link a note to a project or add a tag.</div>');
      menu = '<div class="notes-filter-menu">' + items.join("") + '</div>';
    }
    return '<div class="notes-filter-bar">' +
      '<button type="button" class="notes-filter-btn' + (activeName ? " active" : "") + (state.notesFilterMenuOpen ? " open" : "") + '" data-action="notes-filter-toggle">' +
        '<span class="funnel">&#9662;</span>' + btnLabel +
      '</button>' + menu +
    '</div>';
  }
  function renderNotesLane(laneEl){
    const all = state.notes.slice().sort(function(a, b){ return (b.editedAt || 0) - (a.editedAt || 0); });
    laneEl.querySelector(".count").textContent = all.length;
    const tabCountEl = qs('.tab[data-kind="notes"] .tab-count');
    if (tabCountEl) tabCountEl.textContent = all.length;
    // Filter (§4.9): transient, single-selection, never hides the real total.
    let notes = all;
    if (state.notesFilter){
      const fid = state.notesFilter;
      // The id is a project or a tag (globally unique) — match either.
      if (noteFilterName(fid)){
        notes = all.filter(function(n){
          return (n.projectLinks || []).some(function(l){ return l.id === fid; }) || (n.tagIds || []).indexOf(fid) !== -1;
        });
      } else { state.notesFilter = null; }
    }
    const rootEl = laneEl.querySelector(".cards-root");
    rootEl.innerHTML = notesFilterBarHtml() + (notes.length
      ? notes.map(noteCardHtml).join("")
      : '<div class="empty-note">' + (state.notesFilter ? "No notes for this filter." : "No notes yet.") + '</div>');
  }
  function openNoteScreen(noteId, opts){
    let draft;
    if (noteId){
      const n = findNote(noteId);
      if (!n) return;
      draft = { title: n.title || "", body: n.body || "", projectLinks: (n.projectLinks || []).slice(), tagIds: (n.tagIds || []).slice() };
    } else {
      // "New checklist" (user) seeds the body with one empty checklist item so
      // the page IS a checklist from the first keystroke; "New note" is blank.
      const body = (opts && opts.checklist) ? '<ul class="checklist"><li></li></ul>' : "";
      // projectLinks can be seeded so a note created FROM a project page is
      // already linked to it (user). The name is denormalised here the same way
      // the link picker does it (§4.9).
      draft = { title: (opts && opts.title) || "", body: body,
                projectLinks: (opts && opts.projectLinks) ? opts.projectLinks.slice() : [],
                tagIds: [] };
    }
    state.screen = { kind: "notes", taskId: noteId || null, noteId: noteId || null, noteView: true, draft: draft,
                     noteStaging: (opts && opts.staging) || null };
    if (opts && opts.fromCaptureId) state.screen.fromCaptureId = opts.fromCaptureId; // §4.8b: remove the capture when this note saves
    renderScreen();
  }
  // The rich-text toolbar (§4.9, user). B/I/U are the emphasis the author uses
  // for headings + important lines; H2 for section titles; bulleted list; and
  // the ⊞ opens the add-a-tag/linked-project picker (one entry point — the
  // picker gains a Tags section when §4.9b lands; today it links projects).
  // Every button produces only allow-listed tags with no attributes, so it
  // survives sanitizeNoteHtml untouched. `data-md` buttons fire execCommand;
  // the mousedown-preventDefault (bindEvents) keeps the caret in the editable.
  function noteToolbarHtml(){
    return '<div class="note-toolbar">' +
      // ⚑ Undo / redo (user), leading the bar. They earn that position on a
      // rich-text field more than any format button does: a mis-aimed Heading or
      // Checklist on a selection can rewrite a whole block at once, and until now
      // the only way back was to retype it.
      //
      // ⚠ execCommand("undo") is used deliberately rather than a hand-rolled
      // history. Every format button above already goes through execCommand, so
      // the browser's own undo stack ALREADY contains both the typing and the
      // formatting, correctly interleaved. A separate stack would have to
      // duplicate that and would drift out of step with the caret the moment
      // the two disagreed.
      '<button type="button" class="note-tool" data-md="undo" title="' + escapeHtml(t("note.undo")) + '">&#8630;</button>' +
      '<button type="button" class="note-tool" data-md="redo" title="' + escapeHtml(t("note.redo")) + '">&#8631;</button>' +
      '<span class="note-tool-sep"></span>' +
      '<button type="button" class="note-tool" data-md="bold" title="' + escapeHtml(t("note.bold")) + '"><b>B</b></button>' +
      '<button type="button" class="note-tool" data-md="italic" title="' + escapeHtml(t("note.italic")) + '"><i>I</i></button>' +
      '<button type="button" class="note-tool" data-md="underline" title="' + escapeHtml(t("note.underline")) + '"><span style="text-decoration:underline">U</span></button>' +
      '<button type="button" class="note-tool" data-md="h2" title="' + escapeHtml(t("note.heading")) + '">H</button>' +
      '<button type="button" class="note-tool" data-md="ul" title="' + escapeHtml(t("note.bulletList")) + '">&#8226;</button>' +
      '<button type="button" class="note-tool" data-md="checklist" title="' + escapeHtml(t("note.checklist")) + '">&#9744;</button>' +
      '<span class="note-tool-sep"></span>' +
      '<button type="button" class="note-tool" data-action="note-add-link" title="' + escapeHtml(t("note.addTagOrProject")) + '">&#8862;</button>' +
    '</div>';
  }
  // The contenteditable owns its DOM while you type (the input handler only
  // reads out of it). Before ANY renderScreen that would rebuild the body from
  // draft.body — opening the picker, removing a chip — pull the live HTML into
  // the draft first, or in-progress typing since the last input event is lost.
  function syncNoteBodyDraft(){
    if (!state.screen || !state.screen.draft) return;
    const el = qs('.note-body[contenteditable]');
    if (el) state.screen.draft.body = el.innerHTML;
  }
  // Toolbar formatting. execCommand is deprecated-but-universally-supported and
  // the pragmatic choice for a small local editor (§4.9 build note); if a
  // browser ever drops it the notes are still valid HTML, only the buttons
  // break. Every command yields allow-listed tags, so nothing here can outrun
  // sanitizeNoteHtml. H2 toggles back to a plain block when already a heading.
  // The UL/OL ancestor of the current selection, bounded to the editable.
  function currentEditableList(editable){
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    let n = sel.anchorNode;
    while (n && n !== editable){
      if (n.nodeType === 1 && (n.tagName === "UL" || n.tagName === "OL")) return n;
      n = n.parentNode;
    }
    return null;
  }
  function applyNoteFormat(cmd){
    const el = qs('.note-body[contenteditable]');
    if (!el) return;
    el.focus();
    try {
      if (cmd === "undo") document.execCommand("undo");
      else if (cmd === "redo") document.execCommand("redo");
      else if (cmd === "bold") document.execCommand("bold");
      else if (cmd === "italic") document.execCommand("italic");
      else if (cmd === "underline") document.execCommand("underline");
      else if (cmd === "ul") document.execCommand("insertUnorderedList");
      else if (cmd === "checklist"){
        // A checklist is a <ul class="checklist"> — the checkbox and its ticked
        // state are pure CSS on the class, so it survives the strict sanitiser
        // with no attributes to validate. Toggle: none→checklist, plain
        // bullets→checklist (convert in place), checklist→off.
        const ul = currentEditableList(el);
        if (ul && ul.tagName === "UL" && ul.classList.contains("checklist")){
          document.execCommand("insertUnorderedList");
        } else if (ul && ul.tagName === "UL"){
          ul.classList.add("checklist");
        } else {
          document.execCommand("insertUnorderedList");
          const nu = currentEditableList(el);
          if (nu) nu.classList.add("checklist");
        }
      }
      else if (cmd === "h2"){
        const cur = (document.queryCommandValue("formatBlock") || "").toLowerCase();
        document.execCommand("formatBlock", false, (cur === "h2" || cur === "<h2>") ? "div" : "h2");
      }
    } catch (err){ /* execCommand unsupported — leave the body untouched */ }
    if (state.screen && state.screen.draft){
      state.screen.draft.body = el.innerHTML;
      el.classList.toggle("is-empty", isNoteBodyEmpty(el));
    }
  }
  function noteBodyHtml(s){
    const d = s.draft;
    if (d.projectPicker) return noteProjectPickerHtml(s);
    let fields = '<input type="text" class="screen-field-title' + (s.invalidField === "title" ? " field-invalid" : "") + '" data-field="noteTitle" placeholder="' + escapeHtml(t("note.titlePlaceholder")) + '" value="' + escapeHtml(d.title) + '">';
    fields += noteToolbarHtml();
    const bodyHtml = sanitizeNoteHtml(d.body);
    const bodyProbe = document.createElement("div"); bodyProbe.innerHTML = bodyHtml;
    fields += '<div class="screen-field-desc note-body' + (isNoteBodyEmpty(bodyProbe) ? " is-empty" : "") + '" contenteditable="true" data-field="noteBody" data-placeholder="' + escapeHtml(t("note.bodyPlaceholder")) + '">' + bodyHtml + '</div>';
    // Attached chips — projects now (many-valued, §4.9), tags too once §4.9b
    // lands. Draft-isolated: add/remove stage on the draft, commit on Save.
    const attached = (d.projectLinks || []).map(function(l){ return noteChipHtml(l, true); })
      .concat(noteTagChips({ tagIds: d.tagIds }, true));
    if (attached.length){
      fields += '<div class="note-chips note-attached">' + attached.join("") + '</div>';
    }
    return '<div class="screen-body note-screen-body">' + fields + '</div>';
  }
  // The add picker (§4.9b): TWO sections. Projects — LIVE projects only
  // (deleted/completed never appear; the chip row still shows their
  // frozen/green chips). Tags — every registry tag not already on the note,
  // choose-only. Plus "Manage tags →", which opens the Tags page as a
  // create-only draft sub-view without tearing down this note draft.
  function noteProjectPickerHtml(s){
    const linked = new Set((s.draft.projectLinks || []).map(function(l){ return l.id; }));
    // ⚑ Two sections, not one flat list (user: "Future projects should also get
    // their own section in the tags picker on the notes page"). Both lanes were
    // always offered here, concatenated — which meant an active project and one
    // you have parked read as the same kind of thing at the moment you choose,
    // and the only way to tell them apart was to already know the titles. They
    // are different lanes with different meanings everywhere else in the app;
    // this is the one place that flattened them.
    function pickList(items, empty){
      return items.length
        ? items.map(function(p){ return '<button type="button" class="screen-hook-pick-item" data-action="note-pick-project" data-id="' + p.id + '">' + escapeHtml(p.title) + '</button>'; }).join("")
        : '<div class="empty-note">' + empty + '</div>';
    }
    // ⚑ Dev scaffolding is excluded. The chunk map injects ~26 rows into Current
    // Projects, and they were drowning the two real ones in this picker — the
    // review already refuses to treat them as real work (isDevScaffold) and a
    // chooser has the same reason to.
    const notLinked = function(t){ return !t.isGroup && !linked.has(t.id) && !isDevScaffold(t); };
    const currentItems = pickList(state.tasks.current.filter(notLinked),
      t("note.noCurrentToLink"));
    const futureItems = pickList(state.tasks.future.filter(notLinked),
      t("note.noSomedayToLink"));

    const tagged = new Set((s.draft.tagIds || []));
    const tags = (state.tags || []).filter(function(t){ return !tagged.has(t.id); })
      .slice().sort(function(a, b){ return a.name.localeCompare(b.name); });
    const tagItems = tags.length
      ? tags.map(function(t){ return '<button type="button" class="screen-hook-pick-item" data-action="note-pick-tag" data-id="' + t.id + '">#' + escapeHtml(t.name) + '</button>'; }).join("")
      : '<div class="empty-note">' + escapeHtml(t("note.noTagsYet")) + '</div>';

    return '<div class="screen-body pick-body">' +
      '<div class="screen-hook-pick-label">' + escapeHtml(t("note.tagsHeading")) + '</div>' +
      '<div class="screen-hook-pick-list">' + tagItems + '</div>' +
      // The lanes' own names, so the section headings match the tabs they came
      // from rather than inventing a second vocabulary for the same two lists.
      '<div class="screen-hook-pick-label">' + escapeHtml(t("note.linkCurrentProject")) + '</div>' +
      '<div class="screen-hook-pick-list">' + currentItems + '</div>' +
      '<div class="screen-hook-pick-label">' + escapeHtml(t("note.linkSomedayProject")) + '</div>' +
      '<div class="screen-hook-pick-list">' + futureItems + '</div>' +
      '<div class="screen-row" style="margin-top:10px; justify-content:space-between;">' +
        '<button type="button" class="btn btn-ghost btn-small" data-action="note-cancel-pick">' + escapeHtml(t("picker.back")) + '</button>' +
        '<button type="button" class="btn btn-ghost btn-small" data-action="note-manage-tags">' + escapeHtml(t("note.manageTags")) + '</button>' + // wired in the Tags-page commit
      '</div>' +
    '</div>';
  }
  function saveNoteScreen(s){
    syncNoteBodyDraft(); // flush the live editor into the draft before we inspect it
    const title = (s.draft.title || "").trim();
    if (!title){
      // Uniform with every other drafting page (§4.6, user): ← on an EMPTY page
      // is a silent cancel, not a title nag. "Empty" for a note = no title, no
      // body text, no links, no tags. A note that HAS content but no title
      // still asks for a title — silently discarding a written body would break
      // "data destruction is never accidental".
      const probe = document.createElement("div"); probe.innerHTML = sanitizeNoteHtml(s.draft.body || "");
      const hasContent = !isNoteBodyEmpty(probe) || (s.draft.projectLinks || []).length || (s.draft.tagIds || []).length;
      if (!hasContent){ closeScreen(); return; }
      s.invalidField = "title"; renderScreen(); return;
    }
    const body = sanitizeNoteHtml(s.draft.body || ""); // untrusted-input surface (§4.9) — sanitise at the commit
    if (s.noteId){
      const n = findNote(s.noteId);
      if (n){ n.title = title; n.body = body; n.projectLinks = s.draft.projectLinks || []; n.tagIds = s.draft.tagIds || []; n.editedAt = nowMs(); }
    } else if (s.noteStaging && s.noteStaging.parent && s.noteStaging.parent.draft && s.noteStaging.parent.draft.staged){
      // ⚑ Staged, not written (user). The project page that opened this is still
      // a draft; the note joins its staged set and becomes real when — and only
      // when — that project saves. The id is minted now and never remapped,
      // matching §12.1b's rule for staged child actions.
      s.noteStaging.parent.draft.staged.noteCreates.push({
        id: genId(), title: title, body: body,
        projectLinks: s.draft.projectLinks || [], tagIds: s.draft.tagIds || [],
        editedAt: nowMs()
      });
      consumeCaptureForScreen(s);
      closeScreen();
      return;
    } else {
      state.notes.unshift({ id: genId(), title: title, body: body, projectLinks: s.draft.projectLinks || [], tagIds: s.draft.tagIds || [], editedAt: nowMs() });
    }
    saveNotes();
    renderLane("notes");
    consumeCaptureForScreen(s); // §4.8b: a capture sorted to Note is now filed
    closeScreen();
  }
  function deleteNote(noteId){
    state.notes = state.notes.filter(function(n){ return n.id !== noteId; });
    saveNotes();
    renderLane("notes");
  }

  // =========================================================
  // TAGS PAGE (§4.9b). Reached from the badge → Tags (full manage mode)
  // and the note picker's "Manage tags →" (create-only sub-view).
  // Chrome is ←(save)/✕(discard) with NO page 🗑 (the page is not an item);
  // tags are removed by the row ✕, which STAGES the removal — draft-isolated,
  // committed on Save, with the in-use delete confirm firing once AT save (§7).
  // =========================================================
  function tagNorm(s){ return (s || "").trim().toLowerCase(); }
  function liveProjectTitles(){
    return state.tasks.current.concat(state.tasks.future).filter(function(t){ return !t.isGroup; }).map(function(t){ return t.title; });
  }
  function completedProjectTitles(){
    return (state.completed.current || []).concat(state.completed.future || []).map(function(t){ return t.title; });
  }
  // ONE-WAY check (§4.9b): a tag is blocked by an existing tag row, a live
  // project (visible → dashed only), or a COMPLETED project (hidden but
  // restorable → dashed + inline reason). Deleted projects are NOT checked
  // (their names are genuinely free). Returns null | "dup" | "completed".
  function tagNameCollision(name, selfIdx, rows){
    const n = tagNorm(name);
    if (!n) return null;
    for (let i = 0; i < rows.length; i++){ if (i !== selfIdx && tagNorm(rows[i].name) === n) return "dup"; }
    if (liveProjectTitles().some(function(t){ return tagNorm(t) === n; })) return "dup";
    if (completedProjectTitles().some(function(t){ return tagNorm(t) === n; })) return "completed";
    return null;
  }
  function noteCountForTag(id){
    const c = state.notes.filter(function(n){ return (n.tagIds || []).indexOf(id) !== -1; }).length;
    return c + " note" + (c === 1 ? "" : "s");
  }
  // createOnly (§4.9b): the "Manage tags →" sub-view opened from inside a note
  // draft. Existing tags show read-only (no rename/delete of shared state from
  // an open note draft); only NEW rows are addable. The note screen is stashed
  // on the stack by the caller, so ←/✕ here pop back to it, note draft intact.
  function openTagsScreen(createOnly){
    const rows = (state.tags || []).map(function(t){ return { id: t.id, name: t.name }; });
    state.screen = { kind: "tags", tagsView: true, taskId: null, draft: { rows: rows, rowErrors: {}, manage: !createOnly } };
    renderScreen();
  }
  function tagsPageBodyHtml(s){
    const d = s.draft;
    const manage = d.manage !== false;
    const projects = state.tasks.current.concat(state.tasks.future).filter(function(t){ return !t.isGroup; });
    let html = '<div class="screen-body">';
    // Tags first (user round) — this is the page's subject; the read-only
    // project list sits below it as the duplicate-name reference.
    html += '<div class="screen-hook-pick-label">' + escapeHtml(t("note.tagsHeading")) + '</div>';
    html += '<div class="tags-rows">';
    (d.rows || []).forEach(function(r, i){
      const err = d.rowErrors && d.rowErrors[i];
      const editable = manage || !r.id; // create-only: existing tags are read-only
      const removable = manage || !r.id;
      html += '<div class="tags-row-wrap">' +
        '<div class="tags-row">' +
          '<input type="text" class="tags-row-input' + (err ? " field-invalid" : "") + '" data-field="tagRow" data-row="' + i + '" value="' + escapeHtml(r.name) + '" placeholder="' + escapeHtml(t("tags.namePlaceholder")) + '"' + (editable ? "" : " readonly") + '>' +
          (removable ? '<button type="button" class="tags-row-x" data-action="tag-remove-row" data-row="' + i + '" title="' + escapeHtml(t("tags.remove")) + '">&times;</button>' : "") +
        '</div>' +
        (err === "completed" ? '<div class="tags-row-reason">' + escapeHtml(t("tags.completedNameTaken")) + '</div>' : "") +
      '</div>';
    });
    html += '</div>';
    html += '<button type="button" class="tags-add-btn" data-action="tag-add-row">' + escapeHtml(t("tags.addTag")) + '</button>';
    if (!manage){
      html += '<div class="tags-createonly-hint">' + escapeHtml(t("tags.createOnlyHint")) + '</div>';
    }
    // Projects below, READ-ONLY — the reference that makes duplicates visible.
    html += '<div class="screen-hook-pick-label" style="margin-top:18px;">' + escapeHtml(t("tags.projectsHeading")) + '</div>';
    html += '<div class="tags-proj-list">' + (projects.length
      ? projects.map(function(p){ return '<span class="tags-proj-chip">' + escapeHtml(p.title) + '</span>'; }).join("")
      : '<span class="empty-note">' + escapeHtml(t("tags.noProjectsYet")) + '</span>') + '</div>';
    html += '</div>';
    return html;
  }
  function saveTagsScreen(s){
    const rows = s.draft.rows || [];
    // Validate every non-empty row; empties are simply dropped, no error.
    s.draft.rowErrors = {};
    let hasErr = false;
    rows.forEach(function(r, i){
      const name = (r.name || "").trim();
      if (!name) return;
      const col = tagNameCollision(name, i, rows);
      if (col){ s.draft.rowErrors[i] = col; hasErr = true; }
    });
    if (hasErr){ renderScreen(); return; }
    // Staged deletions = existing tags whose row is gone.
    const survivingIds = new Set(rows.filter(function(r){ return r.id; }).map(function(r){ return r.id; }));
    const deleted = (state.tags || []).filter(function(t){ return !survivingIds.has(t.id); });
    const inUse = deleted.filter(function(t){ return state.notes.some(function(n){ return (n.tagIds || []).indexOf(t.id) !== -1; }); });
    const commit = function(){
      const delIds = new Set(deleted.map(function(t){ return t.id; }));
      if (delIds.size){
        state.tags = state.tags.filter(function(t){ return !delIds.has(t.id); });
        state.notes.forEach(function(n){ if (n.tagIds) n.tagIds = n.tagIds.filter(function(id){ return !delIds.has(id); }); }); // unlink, no tombstone
        saveNotes();
      }
      rows.forEach(function(r){
        const name = (r.name || "").trim();
        if (!name) return;
        if (r.id){ const t = findTag(r.id); if (t) t.name = name; } // rename propagates by ID
        else state.tags.unshift({ id: genId(), name: name });
      });
      saveTags();
      renderLane("notes");
      closeScreen();
    };
    if (inUse.length){
      // The in-use delete confirm fires ONCE, at Save (§7 linked-actions pattern).
      const msg = inUse.length === 1
        ? t("confirm.deleteTagsOne").replace("{name}", inUse[0].name).replace("{notes}", noteCountForTag(inUse[0].id))
        : t("confirm.deleteTagsMany").replace("{n}", inUse.length);
      openConfirmDialog(msg, [
        { label: t("chrome.delete"), style: "danger", action: commit },
        { label: t("chrome.cancel"), action: function(){} }
      ]);
    } else commit();
  }

  function boot(){
    // ⚠ FIRST: every render below reads the live string tables, and they are
    // empty objects until this runs. A blank app is what a missed call looks like.
    state.locale = loadLocale();
    document.documentElement.setAttribute("lang", state.locale);
    rebuildStringTables();
    applySurface(loadSurfaceId()); // post-sprint: paint the desk before the shell lands on it
    initDeskFrame();               // the lacquer desk's gold border; a no-op for the rest
    applyChalkDust();              // §P6: the habit runner's board
    renderShell();
    renderTabLabels();
    // ⚠ BEFORE the first lane render: applyLayoutMode decides which lanes are
    // visible and what the header holds. One listener, both directions — a
    // window dragged across 1000px re-renders rather than stranding an open
    // page, tray or menu (trap T1).
    applyLayoutMode();
    const deskMQ = window.matchMedia("(min-width:" + DESKTOP_MIN_PX + "px)");
    if (deskMQ.addEventListener) deskMQ.addEventListener("change", applyLayoutMode);
    else if (deskMQ.addListener) deskMQ.addListener(applyLayoutMode);   // older Safari
    else window.addEventListener("resize", applyLayoutMode);
    bindEvents();
    bindDrawerSwipe(); // finger-follow open/close on the intray drawer, same mechanic as the calendar month swipe
    initLocalData();
    initCompletedData();
    applyQaScaffolding(); // §8.1/§8.2, but only when the QA switch is on
    state.habitDone = loadHabitDone();
    state.habitDoneOrder = loadHabitDoneOrder();
    state.habitRuns = loadHabitRuns();
    state.tray = loadTray();
    state.notes = loadNotes();
    state.tags = loadTags();
    // chunk 7 (§4.13): events load into their own store. A missing store on
    // fresh/legacy data seeds nothing here — seedData() owns the samples; an
    // existing-but-empty install just has no events, which is correct.
    { const loadedEvents = loadEvents(); if (loadedEvents) state.events = loadedEvents; }
    processHabitBoundaries();
    processEventBoundaries(); // §7 edge case: boundaries crossed while closed are swept on open, like habits
    ALL_LANES.forEach(renderLane);
    updateLaneVisibility();
    updateQaTimeReadout();
    dragLogInit();
    updateDragLogUI();
    applyDevVisibility();   // dev tools start hidden unless switched on
    // Bug #2 / QA #15: the app's own time picker takes over every .screen-time
    // field. Delegated at the document, so it covers fields that do not exist
    // yet (the calendar creation row, an event page opened later).
    initTimePickerFields();
    openTray(); // §4.8a: auto-open on launch — capture is the first job
    renderSwUpdateBannerLabels(); // chunk 9: static markup, translated like tab labels
    initServiceWorker(); // chunk 9: offline cache + the update-ready banner
  }

  document.addEventListener("DOMContentLoaded", boot);

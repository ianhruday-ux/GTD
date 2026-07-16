  "use strict";

  const LIST_TITLES = {
    next: "Next Actions", waiting: "Waiting On", current: "Current Projects",
    future: "Future / Someday", habit: "Habits"
  };
  const LANE_INFO = {
    next: "The single next physical step for anything you're actively moving forward \u2014 not the whole project, just what you'd do next if you sat down right now.",
    waiting: "Things you can't act on yet because they depend on something else \u2014 a reply from someone, a delivery, a decision, another action getting done, or a future date or event. Nothing to do here but check in occasionally. Use the arrow to promote it once it's back in your hands.",
    current: "Anything that takes more than one action to finish and that you're actively working on right now \u2014 could be as simple as returning a library book or as involved as planning a vacation. Link a Next Action or Waiting On item to one of these to keep the connection visible.",
    future: "Ideas and projects you're not committing to yet \u2014 no pressure, just a parking lot. Use the arrow to promote one to Current Projects when you're ready to start.",
    habit: "Things you want to do every day, not just once. Checking one off only counts for today \u2014 it resets automatically tomorrow so it keeps showing up. Everyone misses a habit occasionally. We don't track streaks here, but we do track personal bests. If you break your streak, then maybe you'll have a new personal best to beat. After all: \u2018It's more important to be persistent than it is to be consistent.\u2019 \u2013 Rebecca"
  };
  const KINDS = ["next", "waiting", "current", "future", "habit"];
  const PROJECT_KINDS = ["current", "future"];
  const MOVE_MAP = { waiting: "next", future: "current" };
  const NEW_ITEM_LABEL = {
    next: "+ New Action", waiting: "+ New Waiting Item",
    current: "+ New Project", future: "+ New Project", habit: "+ New Habit"
  };
  const TITLE_PLACEHOLDER = {
    next: "Next action\u2026", waiting: "What are you waiting on\u2026",
    current: "Project title\u2026", future: "Project title\u2026", habit: "Habit title\u2026"
  };
  const RECURRENCE_LABELS = { none: "Does not repeat", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
  const KIND_BADGE_LABEL = {
    next: "Next Action", waiting: "Waiting Action", current: "Current Project",
    future: "Future Project", habit: "Habit"
  };

  const state = {
    tasks: {next: [], waiting: [], current: [], future: [], habit: []},
    completed: {next: [], waiting: [], current: [], future: []}, // permanent Completed archive per lane (habits use their own daily habitDone-based grouping instead — see habitCompletedTodayHtml)
    activeKind: "next",
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
    qaTimeOffset: 0 // dev-only: MINUTES added to boundaryNow() (chunk 0c: hour/minute granular, not just whole days — the midnight-4am window (§4.14b) can only be tested by landing the clock inside it) — see the QA time-jump buttons
  };

  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function escapeHtml(str){
    return String(str || "").replace(/[&<>"']/g, function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  }
  // Single 4:00 AM day boundary, app-wide (habits, events, deadlines — one
  // clock, one rule, per the edge-case rulings). "Today" doesn't roll over
  // until 4am, so a late night doesn't cost you a habit day.
  function boundaryNow(){
    const d = new Date();
    d.setMinutes(d.getMinutes() + (state.qaTimeOffset || 0));
    d.setHours(d.getHours() - 4);
    return d;
  }
  function todayStr(){ return boundaryNow().toLocaleDateString("en-CA"); }
  function dateStrToDate(s){ const parts = s.split("-").map(Number); return new Date(parts[0], parts[1] - 1, parts[2]); }
  function dateToStr(d){ return d.toLocaleDateString("en-CA"); }
  function addDaysToDate(d, n){ const copy = new Date(d); copy.setDate(copy.getDate() + n); return copy; }
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
  // A hook is live today iff its target exists, is scheduled today, and
  // isn't paused (11.2). One link deep only — the target's own cue
  // doesn't matter, because the target itself still occurs today.
  function hookLiveToday(hook){
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
  function restoreTask(kind, taskId){
    const idx = state.completed[kind].findIndex(function(t){ return t.id === taskId; });
    if (idx === -1) return;
    const task = state.completed[kind].splice(idx, 1)[0];
    delete task.completedAt;
    saveCompletedLocal(kind);
    state.tasks[kind].unshift(task);
    saveTasksLocal(kind);
    renderLane(kind);
    if (kind === "current" || kind === "future"){
      restoreArchivedWaitingForProject(taskId); // renders "waiting" itself
    }
  }
  function seedData(){
    state.tasks.next = [
      { id: genId(), title: "Email Sarah the draft agenda", notesClean: "", linkedProjectId: null, isGroup: false, parent: null }
    ];
    const groupId = genId();
    state.tasks.next.push({ id: groupId, title: "At computer", notesClean: "", linkedProjectId: null, isGroup: true, parent: null });
    state.tasks.next.push({ id: genId(), title: "Update the budget spreadsheet", notesClean: "", linkedProjectId: null, isGroup: false, parent: groupId });
    state.tasks.next.push({ id: genId(), title: "Reply to the invoice question", notesClean: "", linkedProjectId: null, isGroup: false, parent: groupId });

    state.tasks.current = [
      { id: genId(), title: "Website relaunch", notesClean: "", linkedProjectId: null, isGroup: false, parent: null },
      { id: genId(), title: "Kitchen remodel", notesClean: "", linkedProjectId: null, isGroup: false, parent: null }
    ];

    const emailNextId = state.tasks.next[0].id;
    state.tasks.waiting = [
      { id: genId(), title: "Contractor quote from Dana", notesClean: "", linkedProjectId: state.tasks.current[1].id, isGroup: false, parent: null,
        whenText: "She said end of the week", conditionId: null, conditionKind: null, conditionLabel: null },
      { id: genId(), title: "Sign-off before I book the venue", notesClean: "", linkedProjectId: null, isGroup: false, parent: null,
        whenText: null, conditionId: emailNextId, conditionKind: "next", conditionLabel: "Email Sarah the draft agenda" }
    ];

    state.tasks.future = [
      { id: genId(), title: "Learn woodworking", notesClean: "", linkedProjectId: null, isGroup: false, parent: null }
    ];

    const waterHabitId = genId();
    const stretchHabitId = genId();
    state.tasks.habit = [
      { id: waterHabitId, title: "Drink a glass of water", notesClean: "", linkedProjectId: null, isGroup: false, parent: null,
        whenTexts: ["Right when I wake up"], hooks: [] },
      { id: stretchHabitId, title: "Stretch for 5 minutes", notesClean: "", linkedProjectId: null, isGroup: false, parent: null,
        whenTexts: [], hooks: [{ id: waterHabitId, label: "Drink a glass of water" }] }
    ];

    KINDS.forEach(saveTasksLocal);
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
  function addTask(kind, title, parentId){
    state.tasks[kind].push({ id: genId(), title: title, notesClean: "", linkedProjectId: null, isGroup: false, parent: parentId || null, whenText: null, hooks: [] });
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
    function archiveCompleted(){
      const task = state.tasks[kind].find(function(t){ return t.id === taskId; });
      if (task){
        state.completed[kind].unshift(Object.assign({}, task, { completedAt: todayStr() }));
        saveCompletedLocal(kind);
      }
    }
    archiveCompleted();
    state.tasks[kind] = state.tasks[kind].filter(function(t){ return t.id !== taskId; });
    saveTasksLocal(kind);
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
    state.tasks[kind] = state.tasks[kind].filter(function(t){ return t.id !== taskId && t.parent !== taskId; });
    if (kind === "habit" && state.habitRuns[taskId]){ delete state.habitRuns[taskId]; saveHabitRuns(); }
    saveTasksLocal(kind);
    renderLane(kind);
    if (kind !== "waiting") renderLane("waiting");
    refreshProjectFlags(kind);
  }
  function getDeadline(task){ return (task && task.deadline) || null; }

  // Creates a brand-new leaf task (Next/Waiting/Current/Future) from the
  // full-screen create page. Habits have their own creation path (addHabit)
  // since their cue system predates this chunk and works differently.
  // data: { title, notesClean, linkedProjectId, deadline }
  function createTask(kind, data){
    const base = {
      notesClean: data.notesClean || "", linkedProjectId: data.linkedProjectId || null, deadline: data.deadline || null,
      whenText: data.whenText || null, conditionId: data.conditionId || null,
      conditionKind: data.conditionKind || null, conditionLabel: data.conditionLabel || null,
      bundleText: data.bundleText || null
    };
    const task = Object.assign({ id: genId(), title: data.title, isGroup: false, parent: null }, base);
    state.tasks[kind].unshift(task);
    saveTasksLocal(kind);
    renderLane(kind);
    refreshProjectFlags(kind);
    return Promise.resolve(task);
  }

  // Updates an existing Next/Waiting/Current/Future task's editable fields.
  function updateTask(kind, taskId, data){
    const task = state.tasks[kind].find(function(t){ return t.id === taskId; });
    if (!task) return Promise.resolve(null);
    task.title = data.title;
    task.notesClean = data.notesClean || "";
    task.linkedProjectId = data.linkedProjectId || null;
    task.deadline = data.deadline || null;
    task.whenText = data.whenText || null;
    task.conditionId = data.conditionId || null;
    task.conditionKind = data.conditionKind || null;
    task.conditionLabel = data.conditionLabel || null;
    task.bundleText = data.bundleText || null;
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
  function moveWithinList(kind, taskId, parentId, previousId){
    const list = state.tasks[kind];
    const idx = list.findIndex(function(t){ return t.id === taskId; });
    if (idx === -1) return;
    const task = list[idx];
    list.splice(idx, 1);
    task.parent = parentId || null;
    if (!previousId){
      let insertAt = list.findIndex(function(t){ return (t.parent || null) === (task.parent || null); });
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
  // Restores a project's archived Waiting actions back into the live
  // Waiting list. Not wired to any button yet — the un-complete-project
  // control that would call this is chunk 5's Completed section; this is
  // ready for it (see the un-completion reversal cascade note below).
  function restoreArchivedWaitingForProject(projectId){
    const archived = loadArchivedWaiting();
    const items = archived[projectId] || [];
    if (!items.length) return;
    items.forEach(function(t){ state.tasks.waiting.push(t); });
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

  // Project "Complete" — per 4.6 as refined in 9: Next Actions complete
  // silently; linked Waiting actions are temporarily archived instead of
  // completed (in case the project completion was a mistake), with a
  // confirmation prompt naming that up front.
  function completeProject(kind, projectId){
    const linked = linkedActionsForProject(projectId);
    const waitingLinked = linked.filter(function(l){ return l.kind === "waiting"; });
    const nextLinked = linked.filter(function(l){ return l.kind === "next"; });
    function doComplete(){
      nextLinked.forEach(function(l){ completeTask(l.kind, l.task.id); });
      if (waitingLinked.length){
        archiveWaitingForProject(projectId, waitingLinked.map(function(l){ return l.task; }));
        waitingLinked.forEach(function(l){ deleteTask(l.kind, l.task.id); });
      }
      completeTask(kind, projectId);
    }
    if (waitingLinked.length){
      openConfirmDialog(
        "This project has " + waitingLinked.length + " linked waiting item" + (waitingLinked.length === 1 ? "" : "s") + ". Completing the project will archive " + (waitingLinked.length === 1 ? "it" : "them") + " \u2014 you can restore " + (waitingLinked.length === 1 ? "it" : "them") + " later if this was a mistake.",
        [
          { label: "Complete project", style: "primary", action: doComplete },
          { label: "Cancel", action: function(){} }
        ]
      );
    } else {
      doComplete();
    }
  }

  // Current -> Future demotion: future projects can't have linked actions.
  function demoteProjectToFuture(projectId){
    const linked = linkedActionsForProject(projectId);
    if (!linked.length){ changeKind("current", "future", projectId).then(function(){ if (state.screen) closeScreen(); }); return; }
    openConfirmDialog(
      "Future projects can't have linked actions. Do you want to unlink your actions or delete them?",
      [
        { label: "Unlink actions", style: "primary", action: function(){
            linked.forEach(function(l){ setLink(l.kind, l.task.id, null); });
            changeKind("current", "future", projectId).then(function(){ if (state.screen) closeScreen(); });
          } },
        { label: "Delete actions", style: "danger", action: function(){
            linked.forEach(function(l){ deleteTask(l.kind, l.task.id); });
            changeKind("current", "future", projectId).then(function(){ if (state.screen) closeScreen(); });
          } },
        { label: "Cancel", action: function(){} }
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
    let html = '<option value="">No linked project</option>';
    if (state.tasks.current.length){
      html += '<optgroup label="' + escapeHtml(LIST_TITLES.current) + '">';
      state.tasks.current.filter(function(t){ return !t.isGroup; }).forEach(function(t){
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
          const target = state.tasks.habit.find(function(h){ return h.id === hk.id && !h.isGroup; });
          cueBlock += '<button class="link-pill" data-action="open-edit" data-kind="habit" data-id="' + task.id + '">&#128279; After ' + escapeHtml(target.title) + '</button>';
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
        const liveTarget = (task.conditionKind === "next" ? state.tasks.next : state.tasks.waiting)
          .find(function(t){ return t.id === task.conditionId && !t.isGroup; });
        if (liveTarget){
          cueBlock = '<button class="link-pill" data-action="open-edit" data-kind="waiting" data-id="' + task.id + '">&#129693; After <span class="pill-target">' + escapeHtml(liveTarget.title) + '</span></button>';
        } else {
          cueBlock = '<button class="link-pill cue-orphaned" data-action="open-edit" data-kind="waiting" data-id="' + task.id + '">&#129693; After ' + escapeHtml(task.conditionLabel || "a deleted item") + '</button>';
        }
      } else if (task.whenText){
        cueBlock = '<button class="link-pill" data-action="open-edit" data-kind="waiting" data-id="' + task.id + '">&#128337; Waiting for <span class="pill-target">' + escapeHtml(task.whenText) + '</span></button>';
      } else if (task.deadline && task.deadline.date){
        cueBlock = '<button class="link-pill" data-action="open-edit" data-kind="waiting" data-id="' + task.id + '">&#128197; <span class="pill-target">' + escapeHtml(task.deadline.date) + '</span></button>';
      }
    }
    // Stalled-project flag: every active project should have at least one
    // linked action — surface that on the lane card itself, beneath the
    // title (overnight notes), not just inside the project's page.
    let projectFlagBlock = "";
    if (kind === "current" && !linkedActionsForProject(task.id).length){
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
    return (
      '<div class="card" draggable="true" data-drag-id="' + task.id + '" data-drag-parent="' + (task.parent || "") + '" data-drag-group="0">' +
        '<div class="card-top">' + checkboxHtml +
          '<div class="card-title' + (done ? " done" : "") + '" data-action="open-edit" data-kind="' + kind + '" data-id="' + task.id + '" title="Tap to open \u2014 press and hold to reorder">' + escapeHtml(task.title) + '</div>' +
          '<div class="card-actions">' +
            '<button class="icon-btn" data-action="delete" data-id="' + task.id + '" title="Delete">&times;</button>' +
          '</div>' +
        '</div>' + (kind === "waiting" ? cueBlock + linkBlock : linkBlock + cueBlock) + projectFlagBlock +
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
    return (
      '<div class="completed-section">' +
        '<div class="group-header" data-action="toggle-group" data-id="__completed_open__">' +
          '<span class="chevron">' + (open ? "&#9662;" : "&#9656;") + '</span>' +
          '<span class="group-title">Completed</span>' +
          '<span class="count">' + items.length + '</span>' +
        '</div>' +
        (open ? '<div class="completed-list">' + items.map(renderItem).join("") + '</div>' : "") +
      '</div>'
    );
  }
  function completedItemHtml(kind, task){
    return (
      '<div class="completed-item">' +
        '<span class="completed-item-title">' + escapeHtml(task.title) + '</span>' +
        '<button type="button" class="icon-btn" data-action="restore" data-kind="' + kind + '" data-id="' + task.id + '" title="Restore to the active list">&#8635;</button>' +
      '</div>'
    );
  }
  function groupHtml(kind, group, children){
    const collapsed = isCollapsed(kind, group.id);
    const moveDest = MOVE_MAP[kind];
    const moveBtn = moveDest
      ? '<button class="icon-btn" data-action="move" data-id="' + group.id + '" data-is-group="1" title="Move to ' + escapeHtml(LIST_TITLES[moveDest]) + '">&#8592;</button>'
      : "";
    const deleteTitle = children.length ? "Remove items inside first" : "Delete list";
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
          '<span class="group-title" title="Tap to expand/collapse \u2014 press and hold to reorder">' + escapeHtml(group.title) + '</span>' +
          '<span class="count">' + children.length + '</span>' +
          '<span class="group-actions">' + moveBtn +
            '<button class="icon-btn" data-action="delete-group" data-id="' + group.id + '" title="' + deleteTitle + '">&times;</button>' +
          '</span>' +
        '</div>' +
        (collapsed ? "" :
          '<div class="group-body" data-dropzone-parent="' + group.id + '">' + childrenHtml +
            '<div class="add-row add-row-mini" data-kind="' + kind + '" data-parent="' + group.id + '">' +
              '<input type="text" placeholder="Add to list\u2026" /><button type="button" data-role="add-mini">+</button>' +
            '</div>' +
          '</div>'
        ) +
      '</div>'
    );
  }
  function renderLane(kind){
    const laneEl = qs('.lane[data-kind="' + kind + '"]');
    if (!laneEl) return;
    if (kind === "habit"){
      updateHabitBadge();
    }
    laneEl.querySelector(".count").textContent = state.tasks[kind].length;
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
        : '<div class="empty-note">Nothing here yet.</div>';
      completedHtml = completedSectionHtml(kind, doneList, function(t){ return leafCardHtml(kind, t); });
    } else {
      const byParent = buildTree(kind);
      const roots = byParent[""] || [];
      activeHtml = roots.length
        ? roots.map(function(r){ return r.isGroup ? groupHtml(kind, r, byParent[r.id] || []) : leafCardHtml(kind, r); }).join("")
        : '<div class="empty-note">Nothing here yet.</div>';
      completedHtml = completedSectionHtml(kind, state.completed[kind] || [], function(t){ return completedItemHtml(kind, t); });
    }
    rootEl.innerHTML = activeHtml + completedHtml;
  }
  function laneShellHtml(k){
    return (
      '<div class="lane" data-kind="' + k + '">' +
        '<div class="lane-tab">' +
          '<span class="lane-tab-title">' + escapeHtml(LIST_TITLES[k]) + '</span>' +
          '<span class="lane-tab-right">' +
            '<span class="count">0</span>' +
            '<button class="info-btn" data-action="toggle-info" data-kind="' + k + '" type="button" title="What is this list for?">i</button>' +
          '</span>' +
        '</div>' +
        '<div class="lane-info" data-kind="' + k + '">' + escapeHtml(LANE_INFO[k]) + '</div>' +
        '<div class="lane-body">' +
          '<div class="lane-actions-row">' +
            '<button class="btn btn-ghost btn-small new-list-btn" data-action="new-list" data-kind="' + k + '" type="button">+ New list</button>' +
            (k === "habit" ? '<button class="btn btn-ghost btn-small tidy-btn" data-action="tidy-habits" type="button" title="Suggest an order from your hooks (you can still rearrange freely afterward)">&#8645; Tidy order</button>' : "") +
          '</div>' +
          '<div class="cards-root" data-dropzone-parent=""></div>' +
        '</div>' +
      '</div>'
    );
  }
  function renderShell(){ qs("#lanes").innerHTML = KINDS.map(laneShellHtml).join(""); }

  function updateLaneVisibility(){
    qsa(".lane").forEach(function(el){ el.classList.toggle("active-lane", el.getAttribute("data-kind") === state.activeKind); });
    // The floating + creates for whichever lane is active — retint it and
    // repoint its data-kind whenever the tab changes (overnight notes:
    // Google-Tasks-style FAB replaces the per-lane create button).
    const fab = qs("#fab-create");
    if (fab){
      fab.setAttribute("data-kind", state.activeKind);
      fab.style.setProperty("--accent", "var(" + accentVarForKind(state.activeKind) + ")");
      fab.title = NEW_ITEM_LABEL[state.activeKind] || "Create";
    }
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
  //  - deadline-approaching progress bar visuals (chunk 6).
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
        let cueRows = (task.hooks || []).map(function(hk){ return { hook: { id: hk.id, label: hk.label } }; })
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
      if (kind === "waiting"){
        draft.whenText = task.whenText || "";
        draft.conditionId = task.conditionId || null;
        draft.conditionKind = task.conditionKind || null;
        draft.conditionLabel = task.conditionLabel || null;
        draft.conditionPicker = false;
      }
    } else {
      draft = { title: "", notesClean: "", linkedProjectId: null, deadline: null, bundleText: "" };
      if (kind === "waiting"){
        draft.whenText = ""; draft.conditionId = null; draft.conditionKind = null; draft.conditionLabel = null; draft.conditionPicker = false;
      }
    }
    if (prefill) Object.assign(draft, prefill);
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
  // Opens a screen "on top of" the current one — the current screen
  // (draft included) is pushed onto the stack and restored when the new
  // one closes, whichever way it closes: save, cancel, Escape, delete, or
  // complete. Nests to any depth (chunk 1).
  function openChildScreen(kind, taskId, prefill){
    state.screenStack.push(state.screen);
    state.screen = null;
    openScreen(kind, taskId, prefill);
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
          applyPendingReplacements(d, hooks, newId);
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
      // Enforce mutual exclusivity at save time (text / date / hook), same
      // pattern as the habit when/hook cue — a hooked condition wins over
      // a date, which wins over free text.
      if (d.conditionId){ d.whenText = ""; d.deadline = null; }
      else if (d.deadline && d.deadline.date){ d.whenText = ""; }
      else { d.deadline = null; }
      if (!d.conditionId && !(d.deadline && d.deadline.date) && !(d.whenText || "").trim()){
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
      bundleText: (s.kind === "next" || s.kind === "waiting") ? ((s.draft.bundleText || "").trim() || null) : null
    };
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
      if (wasCreate && !state.screen) window.scrollTo(0, 0);
    });
  }
  function deleteScreenItem(){
    const s = state.screen;
    if (!s || !s.taskId) return;
    openConfirmDialog("Delete this for good?", [
      { label: "Delete", style: "danger", action: function(){ deleteTask(s.kind, s.taskId); closeScreen(); } },
      { label: "Cancel", action: function(){} }
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
    // MUTUAL EXCLUSION (user ruling): an armed Complete disables the
    // convert buttons — disarm Complete first. Mirror of the guard in
    // screenComplete.
    if (s.draft.willComplete) return;
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
    if (!s || !s.taskId || s.kind !== "current") return;
    const projectId = s.taskId;
    openChildScreen(destKind === "waiting" ? "waiting" : "next", null, { linkedProjectId: projectId, title: prefillTitle || "" });
  }
  // Quick-add from the project page (overnight notes: create actions
  // without leaving the project). Next Actions create instantly. Waiting
  // actions can't exist without a "waiting for" (4.2), so their quick-add
  // routes through the drafting page pre-filled with the typed title —
  // and returns here on save (judgment call, flagged in the doc).
  function screenQuickAdd(destKind, title){
    const s = state.screen;
    if (!s || !s.taskId || s.kind !== "current") return;
    title = (title || "").trim();
    if (!title) return; // silent no-op, same rule as empty-title creates
    if (destKind === "waiting"){
      screenGenerateAction("waiting", title);
      return;
    }
    Promise.resolve(createTask("next", { title: title, notesClean: "", linkedProjectId: s.taskId, deadline: null }))
      .then(function(){ renderScreen(); });
  }
  function screenSuggestHabit(){
    const s = state.screen;
    if (!s) return;
    const title = s.draft.title;
    closeScreen();
    openScreen("habit", null, { title: title });
  }
  // ---- habit hook-picker sub-view within the screen ----
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
  function screenPickHook(targetId){
    const s = state.screen;
    if (!s) return;
    const d = s.draft;
    const target = state.tasks.habit.find(function(h){ return h.id === targetId; });
    const hooks = draftCueHooks(d);
    const already = hooks.some(function(hk){ return hk.id === targetId; });
    const row = d.cueRows[d.hookPickerRow];
    // MAX_HOOKS in both directions (restored — see getValidHookTargets):
    // the row model bounds outgoing anyway, and the incoming count keeps
    // a target from anchoring an 8th dependent.
    const addable = !already && row && hooks.length < MAX_HOOKS && target &&
      habitIncomingHookCount(targetId, s.taskId) < MAX_HOOKS;
    d.hookPicker = false;
    if (!addable){ renderScreen(); return; }
    const newHook = { id: targetId, label: target.title };
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
      "\u201C" + target.title + "\u201D already has " + (many ? dependents.length + " habits" : "\u201C" + dependents[0].title + "\u201D") + " hooked to it. Hook to it anyway?",
      [
        { label: "Hook anyway", style: "primary", action: commit },
        { label: many ? "Replace them" : "Replace that hook", action: function(){
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
        { label: "Cancel", action: function(){} }
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
    renderScreen();
  }
  function screenPickCondition(targetId, targetKind){
    const s = state.screen;
    if (!s) return;
    const pool = targetKind === "next" ? state.tasks.next : state.tasks.waiting;
    const target = pool.find(function(t){ return t.id === targetId; });
    if (s.draft.conditionId !== targetId) playHookChime();
    s.draft.conditionId = targetId;
    s.draft.conditionKind = targetKind;
    s.draft.conditionLabel = target ? target.title : "";
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

  // Condition icon lives beside the Deadline row (not the Project-link row)
  // — deadline and wait-condition are the two mutually-exclusive ways an
  // item becomes actionable later, so they're paired visually. On the
  // Next Action page this icon stays permanently disabled (4.2: "Next
  // Actions cannot have conditions" — a teaching affordance). Waiting no
  // longer uses this function at all — see waitingForRowHtml below.
  function deadlineFieldsHtml(draft, kind){
    const d = draft.deadline || {};
    const showBubble = kind === "next" && d.date && (d.recurrence === "daily" || d.recurrence === "weekly");
    const showConditionIcon = kind === "next";
    return (
      '<div>' +
        '<div class="screen-row">' +
          '<div class="screen-boxed-row">' +
            '<span class="field-icon">&#128197;</span>' +
            '<input type="date" class="screen-date" data-field="deadline-date" value="' + escapeHtml(d.date || "") + '">' +
            (d.date ? '<input type="time" class="screen-time" data-field="deadline-time" value="' + escapeHtml(d.time || "") + '">' : "") +
            (d.date ? '<select class="screen-recurrence" data-field="deadline-recurrence">' +
              Object.keys(RECURRENCE_LABELS).map(function(r){
                return '<option value="' + r + '"' + ((d.recurrence || "none") === r ? " selected" : "") + '>' + RECURRENCE_LABELS[r] + '</option>';
              }).join("") +
            '</select>' : "") +
            (d.date ? '<button type="button" class="screen-clear-x" data-action="clear-deadline" title="Clear deadline">&times;</button>' : "") +
          '</div>' +
          (showConditionIcon ? conditionIconHtml() : "") +
        '</div>' +
        (showBubble ?
          '<div class="suggestion-bubble">Daily/weekly recurring items often work better as a Habit. <button type="button" data-action="suggest-habit">Make it a habit</button></div>'
          : "") +
      '</div>'
    );
  }
  function conditionIconHtml(){
    return '<button type="button" class="screen-icon-toggle" disabled title="Next Actions can\u2019t have conditions \u2014 if it\u2019s waiting on something, it\u2019s a Waiting Action">&#129525;</button>';
  }
  // The project page's linked-actions list (overnight notes): every Next /
  // Waiting action linked to this project, read-only, tap to open (as a
  // child screen, so you come back here). Waiting items conditioned on
  // another item in this same list indent beneath it to show dependency.
  function linkedActionsListHtml(projectId){
    const linked = linkedActionsForProject(projectId);
    if (!linked.length) return "";
    const byId = {};
    linked.forEach(function(l){ byId[l.task.id] = l; });
    const dependents = {};
    linked.forEach(function(l){
      if (l.kind === "waiting" && l.task.conditionId && byId[l.task.conditionId]){
        (dependents[l.task.conditionId] = dependents[l.task.conditionId] || []).push(l);
      }
    });
    const rendered = {};
    let html = "";
    function itemHtml(l, depth){
      if (rendered[l.task.id]) return;
      rendered[l.task.id] = true;
      const kindTag = l.kind === "next" ? "NEXT" : "WAIT";
      html += '<button type="button" class="linked-action-item' + (depth > 0 ? " indented" : "") + '" data-action="open-linked-action" data-kind="' + l.kind + '" data-id="' + l.task.id + '"' + (depth > 1 ? ' style="margin-left:' + (depth * 22) + 'px;"' : '') + '>' +
        '<span class="linked-action-kind">' + kindTag + '</span>' + escapeHtml(l.task.title) +
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
      '<div class="screen-hook-pick-label">Linked actions</div>' +
      '<div class="linked-actions-list">' + html + '</div>'
    );
  }
  function linkRowHtml(draft){
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
  // Condition pill — shown directly under the title once a Waiting action
  // is hooked to a condition (Next or Waiting item). Per 4.2, this is "the
  // second most important piece of information after the title."
  function conditionPillHtml(draft){
    return (
      '<div class="screen-condition-pill-row">' +
        '<span class="screen-hooked-pill">&#129693; After ' + escapeHtml(draft.conditionLabel || "") + '</span>' +
        '<button type="button" class="screen-clear-x" data-action="screen-unhook-condition" title="Remove condition">&times;</button>' +
      '</div>'
    );
  }
  // The revised "waiting for" when-row (4.2, supersedes the plain deadline
  // row for this kind): free text, a date, or a hook — one required, all
  // three mutually exclusive. Greyed out once a condition pill is showing
  // above (the pill replaces it; unhooking restores these fields).
  function waitingForRowHtml(draft, invalid){
    const hasCondition = !!draft.conditionId;
    const d = draft.deadline || {};
    const disabledAttr = hasCondition ? " disabled" : "";
    const showBubble = !hasCondition && d.date && (d.recurrence === "daily" || d.recurrence === "weekly");
    return (
      '<div>' +
        '<div class="screen-row">' +
          '<div class="screen-boxed-row' + (hasCondition ? " screen-row-disabled" : "") + (invalid ? " field-invalid" : "") + '">' +
            '<input type="text" class="screen-waitfor-input" data-field="waitingForText" placeholder="Waiting for\u2026 (required \u2014 text, a date, or a hook)" value="' + escapeHtml(draft.whenText || "") + '"' + disabledAttr + '>' +
            '<input type="date" class="screen-date" data-field="waiting-date" value="' + escapeHtml(d.date || "") + '"' + disabledAttr + '>' +
            (d.date ? '<input type="time" class="screen-time" data-field="waiting-time" value="' + escapeHtml(d.time || "") + '"' + disabledAttr + '>' : "") +
          '</div>' +
          // The hook button stays enabled while hooked — tapping it reopens
          // the picker to change the condition. (Bugfix: it was disabled
          // once hooked, which read as "locked" — removal is the pill's ×,
          // change is this button.)
          '<button type="button" class="screen-icon-toggle' + (hasCondition ? " active" : "") + '" data-action="screen-open-condition-pick" title="' + (hasCondition ? "Change the hooked condition" : "Hook to a Next or Waiting action") + '">&#129693;</button>' +
        '</div>' +
        (showBubble ?
          '<div class="suggestion-bubble">Daily/weekly recurring items often work better as a Habit. <button type="button" data-action="suggest-habit">Make it a habit</button></div>'
          : "") +
      '</div>'
    );
  }
  // "Advanced options" (doc §12): the standing home for power features the
  // base page deliberately doesn't teach. Next/Waiting get the Temptation
  // bundling tab; Habits additionally get the extra-hooks tab.
  function advancedRowHtml(draft){
    let out = "";
    if ((draft.bundleText || "").trim()){
      out += '<button type="button" class="link-pill bundle-pill" data-action="screen-open-advanced" title="Edit in Advanced options">&#127852; ' + escapeHtml(draft.bundleText.trim()) + '</button>';
    }
    out += '<button type="button" class="btn btn-ghost btn-small screen-advanced-btn" data-action="screen-open-advanced">Advanced options…</button>';
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
      if (row.hook){
        const hk = row.hook;
        const target = state.tasks.habit.find(function(h){ return h.id === hk.id && !h.isGroup; });
        const live = target ? hookLiveToday(hk) : false;
        const label = target ? target.title : (hk.label || "a deleted habit");
        const suffix = !target ? " (deleted)" : (live ? "" : " (not today)");
        rows += '<div class="screen-hooked-pill-row">' +
          '<span class="screen-hooked-pill' + (!target ? " cue-orphaned" : (live ? "" : " cue-dim")) + '">&#128279; After ' + escapeHtml(label) + suffix + '</span>' +
          '<button type="button" class="icon-btn" data-action="screen-remove-cue-row" data-row="' + i + '" title="Remove this cue">&times;</button>' +
        '</div>';
      } else {
        const placeholder = (i === 0 && !anyHook)
          ? "When? (required) e.g. After I\u2019ve had my coffee\u2026"
          : "Cue\u2026 (shows on days no hook is live)";
        rows += '<div class="screen-when-field-row' + (invalid && i === 0 ? " field-invalid" : "") + '">' +
          '<input type="text" class="habit-when-input" data-field="cueText" data-row="' + i + '" placeholder="' + placeholder + '" value="' + escapeHtml(row.text || "") + '">' +
          '<button type="button" class="screen-icon-toggle" data-action="screen-open-hook-pick" data-row="' + i + '" title="Hook to another habit">&#129693;</button>' +
          (rowsArr.length > 1 ? '<button type="button" class="icon-btn" data-action="screen-remove-cue-row" data-row="' + i + '" title="Remove this cue">&times;</button>' : "") +
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
    const itemsHtml = targets.length
      ? targets.map(function(t){ return '<button type="button" class="screen-hook-pick-item" data-action="screen-pick-hook" data-id="' + t.id + '">' + escapeHtml(t.title) + '</button>'; }).join("")
      : '<div class="empty-note">No habits available to hook to yet.</div>';
    return (
      '<div>' +
        '<div class="screen-hook-pick-label">Hook onto which habit?</div>' +
        '<div class="screen-hook-pick-list">' +
          itemsHtml +
        '</div>' +
        '<div class="screen-row" style="margin-top:8px;"><button type="button" class="btn btn-ghost btn-small" data-action="screen-cancel-hook-pick">Back</button></div>' +
      '</div>'
    );
  }
  // ---- Habit run engine UI (chunk 3): schedule chips, pause, run track ----
  const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
  function habitScheduleHtml(draft, invalid){
    const chips = DOW_LABELS.map(function(lab, i){
      const active = draft.schedule.indexOf(i) !== -1;
      return '<button type="button" class="habit-day-chip' + (active ? " active" : "") + '" data-action="screen-toggle-schedule-day" data-dow="' + i + '" title="' + ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][i] + '">' + lab + '</button>';
    }).join("");
    return (
      '<div class="screen-row">' +
        '<div class="screen-hook-pick-label" style="margin-bottom:2px;">Scheduled days</div>' +
      '</div>' +
      '<div class="screen-row"><div class="habit-day-row' + (invalid ? " field-invalid" : "") + '">' + chips + '</div></div>'
    );
  }
  function habitPauseBtnHtml(draft){
    return (
      '<div class="screen-row">' +
        '<button type="button" class="btn btn-ghost btn-small habit-pause-btn' + (draft.paused ? " active" : "") + '" data-action="screen-toggle-pause">' +
          (draft.paused ? "\u25B6 Unpause" : "\u23F8 Pause") +
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
  function habitDotHtml(status, isGhost){
    const cls = "habit-dot" + (isGhost ? " habit-dot-ghost" : "") +
      (status === "done" ? " habit-dot-done"
        : status === "stumble" ? " habit-dot-stumble"
        : status === "pending" ? " habit-dot-pending"
        : status === "miss" ? " habit-dot-miss"
        : " habit-dot-empty");
    return '<span class="' + cls + '"></span>';
  }
  // The ghost-runner track: your current run's day-by-day dots lined up
  // against the record (or most-recently-tied) run's sequence. Simplified
  // from the full lockstep-replay-with-overtake animation spec'd in 4.11b
  // to a static per-day comparison — same information (are you ahead of,
  // behind, or matching the best run today), lighter to build and read.
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
    const doneToday = !!draft.done;
    const runEntries = currentRunEntries(run);
    // Today is normally only reflected live here, not yet in history — the
    // boundary sweep records it the day after. The pause-toggle fix is one
    // case where today's entry can land in history same-day (so pausing
    // right after completing doesn't lose the credit); guard against
    // showing it twice when that's happened.
    const lastEntry = runEntries[runEntries.length - 1];
    const todayAlreadyRecorded = !!lastEntry && lastEntry.date === today;
    const liveEntries = runEntries.map(function(e){ return e.status; });
    if (scheduledToday && !todayAlreadyRecorded) liveEntries.push(doneToday ? "done" : "pending");
    const ghostSeq = run.bestSequence || [];
    const trackLen = Math.max(liveEntries.length, ghostSeq.length, 1);
    let ghostRow = "", yourRow = "";
    for (let i = 0; i < trackLen; i++){
      ghostRow += habitDotHtml(ghostSeq[i], true);
      yourRow += habitDotHtml(liveEntries[i], false);
    }
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
      : (
        '<div class="habit-track">' +
          '<div class="habit-track-row habit-track-ghost">' + ghostRow + '</div>' +
          '<div class="habit-track-row habit-track-you">' + yourRow + '</div>' +
        '</div>'
      );
    return (
      '<div class="habit-track-block">' +
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
    const targets = getValidConditionTargets(s.taskId);
    const nextTargets = targets.filter(function(t){ return t.kind === "next"; });
    const waitingTargets = targets.filter(function(t){ return t.kind === "waiting"; });
    function itemBtn(t){
      return '<button type="button" class="screen-hook-pick-item" data-action="screen-pick-condition" data-id="' + t.id + '" data-kind="' + t.kind + '">' + escapeHtml(t.title) + '</button>';
    }
    const nextHtml = nextTargets.length
      ? '<div class="screen-hook-pick-label">Next Actions</div><div class="screen-hook-pick-list">' + nextTargets.map(itemBtn).join("") + '</div>' : "";
    const waitingHtml = waitingTargets.length
      ? '<div class="screen-hook-pick-label">Waiting Actions</div><div class="screen-hook-pick-list">' + waitingTargets.map(itemBtn).join("") + '</div>' : "";
    const empty = (!nextTargets.length && !waitingTargets.length) ? '<div class="empty-note">No valid items to link to yet.</div>' : "";
    const noneHtml = '<div class="screen-hook-pick-list"><button type="button" class="screen-hook-pick-item screen-hook-pick-none" data-action="screen-clear-condition-pick">No condition</button></div>';
    return (
      '<div>' +
        noneHtml + nextHtml + waitingHtml + empty +
        '<div class="screen-row" style="margin-top:8px;"><button type="button" class="btn btn-ghost btn-small" data-action="screen-cancel-condition-pick">Back</button></div>' +
      '</div>'
    );
  }
  function screenHeaderHtml(s){
    const showDelete = !!s.taskId;
    return (
      '<div class="screen-header">' +
        '<button type="button" class="screen-chrome-btn" data-action="screen-save" title="Save and go back">&#8592;</button>' +
        '<span class="screen-kind-badge">' + escapeHtml(KIND_BADGE_LABEL[s.kind]) + '</span>' +
        '<div class="screen-header-right">' +
          (showDelete ? '<button type="button" class="screen-chrome-btn danger" data-action="screen-delete" title="Delete">&#128465;</button>' : '') +
          '<button type="button" class="screen-chrome-btn" data-action="screen-cancel" title="Cancel">&#10005;</button>' +
        '</div>' +
      '</div>'
    );
  }
  // Border/text color for the Make-Waiting/Next/Current/Future pill —
  // tinted with the *destination* kind's accent, per the guide.
  function accentVarForKind(kind){
    return kind === "next" ? "--red" : kind === "waiting" ? "--yellow" : kind === "current" ? "--moss" : kind === "future" ? "--dusty" : "--purple";
  }
  // DRAFT ISOLATION (§13.0 Chunk A): armed renders a filled pill reading
  // "Converting to X on save", the same "nothing has happened yet, but
  // here's what Save will do" language as the armed Complete badge —
  // saveScreen is what actually performs the conversion.
  // MUTUAL EXCLUSION (user ruling): disabled (grey, inert) while Complete
  // is armed — the two can never logically fire together.
  function makeKindBtnHtml(destKind, label, arrow, armed, disabled){
    const accentVar = accentVarForKind(destKind);
    const style = armed
      ? 'background:var(' + accentVar + ');border-color:var(' + accentVar + ');color:var(--dark-on-accent);'
      : disabled
        ? 'border-color:var(--paper-2);color:var(--text-soft);cursor:default;'
        : 'border-color:var(' + accentVar + ');color:var(' + accentVar + ');';
    const text = armed
      ? "\u2713 Converting to " + escapeHtml(KIND_BADGE_LABEL[destKind]) + " on save"
      : ((arrow === "left" ? "&#8592; " : "") + escapeHtml(label) + (arrow === "right" ? " &#8594;" : ""));
    const title = armed ? "Tap to undo" : disabled ? "Disarm Complete to convert" : "";
    return (
      '<button type="button" class="btn screen-make-kind-btn' + (armed ? " armed" : "") + (disabled ? " disabled" : "") + '" data-action="make-kind" data-dest="' + destKind + '" ' +
        'title="' + title + '" style="' + style + '">' + text +
      '</button>'
    );
  }
  function screenBodyHtml(s){
    const draft = s.draft, kind = s.kind;

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

    let fields = '<input type="text" class="screen-field-title' + (s.invalidField === "title" ? " field-invalid" : "") + '" data-field="title" placeholder="' + escapeHtml(TITLE_PLACEHOLDER[kind]) + '" value="' + escapeHtml(draft.title) + '">';

    if (kind === "next"){
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="Description (optional)\u2026">' + escapeHtml(draft.notesClean) + '</textarea>';
      fields += linkRowHtml(draft);
      fields += deadlineFieldsHtml(draft, kind);
      if (s.taskId) fields += makeKindBtnHtml("waiting", "Make Waiting Action", "right", draft.convertTo === "waiting", !!draft.willComplete);
      fields += advancedRowHtml(draft);
    } else if (kind === "waiting"){
      // Condition pill sits directly under the title (before the
      // description) — "the second most important piece of information
      // after the title" per 4.2.
      if (draft.conditionId) fields += conditionPillHtml(draft);
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="Description (optional)\u2026">' + escapeHtml(draft.notesClean) + '</textarea>';
      fields += linkRowHtml(draft);
      fields += waitingForRowHtml(draft, s.invalidField === "waitingFor");
      if (s.taskId) fields += makeKindBtnHtml("next", "Make Next Action", "left", draft.convertTo === "next", !!draft.willComplete);
      fields += advancedRowHtml(draft);
    } else if (isProjectKind(kind)){
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="Description (optional)\u2026">' + escapeHtml(draft.notesClean) + '</textarea>';
      fields += deadlineFieldsHtml(draft, kind);
      if (kind === "current"){
        if (s.taskId){
          const linkedCount = linkedActionsForProject(s.taskId).length;
          fields += linkedActionsListHtml(s.taskId);
          // Quick-add rows (doc 4.3's design, pulled forward by the
          // overnight notes): type + Enter/+ creates without leaving this
          // page; the ✎ opens the full drafting page and returns here.
          fields += '<div class="quick-add-row">' +
            '<input type="text" data-quickadd="next" placeholder="Next action\u2026">' +
            '<button type="button" data-action="quick-add-submit" data-gen-kind="next" title="Add">+</button>' +
            '<button type="button" data-action="generate-action" data-gen-kind="next" title="Open full editor">&#9998;</button>' +
          '</div>';
          fields += '<div class="quick-add-row">' +
            '<input type="text" data-quickadd="waiting" placeholder="Waiting action\u2026">' +
            '<button type="button" data-action="quick-add-submit" data-gen-kind="waiting" title="Add">+</button>' +
            '<button type="button" data-action="generate-action" data-gen-kind="waiting" title="Open full editor">&#9998;</button>' +
          '</div>';
          if (!linkedCount) fields += '<div class="screen-project-flag">No linked actions yet \u2014 every active project should have at least one next step.</div>';
        }
        if (s.taskId) fields += makeKindBtnHtml("future", "Make Future / Someday", "", draft.convertTo === "future", !!draft.willComplete);
      } else {
        if (s.taskId) fields += makeKindBtnHtml("current", "Make Current Project", "", draft.convertTo === "current", !!draft.willComplete);
      }
    } else if (kind === "habit"){
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="Who will I be if I build this habit?">' + escapeHtml(draft.notesClean) + '</textarea>';
      fields += habitWhenFieldsHtml(draft, s.invalidField === "habitWhen");
      fields += habitScheduleHtml(draft, s.invalidField === "habitSchedule");
      fields += advancedRowHtml(draft);
      if (s.taskId){
        fields += habitPauseBtnHtml(draft);
        fields += habitTrackHtml(s);
      }
    }

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
      fields += '<button type="button" class="btn screen-complete-pill' + (armed ? " done" : "") + (blocked ? " paused" : "") +
        '" data-action="screen-complete" title="' +
        (armed ? "Completes when you save \u2014 tap to undo" : blocked ? "Disarm the convert to complete" : "Complete on save") + '">' +
        (armed ? "\u2713 Completing on save" : "Complete") + '</button>';
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
      fields += '<button type="button" class="btn screen-complete-pill' + (doneToday ? " done" : "") + (pausedNow ? " paused" : "") +
        '" data-action="screen-complete" title="' + (pausedNow ? "Paused \u2014 unpause to complete" : "") + '">' +
        (pausedNow ? "\u23F8 Paused" : (doneToday ? "\u2713 Completed today" : "Complete")) + '</button>';
    }
    return '<div class="screen-body">' + fields + '</div>';
  }
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
        '<button type="button" class="adv-tab' + (tab === "bundle" ? " active" : "") + '" data-tab="bundle">Bundling</button>' +
        '<button type="button" class="adv-tab' + (tab === "cues" ? " active" : "") + '" data-tab="cues">Extra cues</button>' +
      '</div>';
    }
    let content = "";
    if (tab === "bundle"){
      content =
        '<p class="adv-note"><strong>Temptation bundling</strong> pairs something you enjoy with the thing you\u2019re doing: allow yourself the treat only while (or right after) doing this. e.g. \u201COnly my favorite podcast while running.\u201D</p>' +
        '<textarea id="adv-bundle-input" class="adv-textarea" placeholder="What treat goes with this?">' + escapeHtml(s.draft.bundleText || "") + '</textarea>';
    } else {
      const rowCount = (s.draft.cueRows || []).length;
      const addHtml = rowCount >= MAX_HOOKS
        ? '<p class="adv-note">Cue limit reached (' + MAX_HOOKS + ' rows \u2014 one per weekday).</p>'
        : '<button type="button" class="btn btn-ghost btn-small" data-adv-add-cue="1">+ Add another cue\u2026</button>';
      content =
        '<p class="adv-note"><strong>Not recommended.</strong> A habit is one cue followed by one automatic response \u2014 a habit with two cues is usually two habits, so consider creating a separate habit instead. Extra cues exist for rotating weekly routines (a different anchor on different days), not for stacking reminders.</p>' +
        '<p class="adv-note">Added rows appear on the habit page itself \u2014 each with its own text box and hook icon, like the default \u2014 and are edited and removed there.</p>' +
        addHtml;
    }
    qs("#dialog-root").innerHTML =
      '<div class="choice-dialog-backdrop"><div class="choice-dialog adv-dialog">' +
      '<div class="adv-title">Advanced options</div>' + tabsHtml +
      '<div class="adv-content">' + content + '</div>' +
      '<div class="choice-dialog-btns"><button type="button" class="primary" data-adv-done="1">Done</button></div>' +
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
    const key = s.kind + ":" + (s.taskId || "new");
    const inner = screenHeaderHtml(s) + screenBodyHtml(s);
    const existing = root.querySelector(".screen-overlay");
    if (existing && existing.getAttribute("data-screen-key") === key){
      // Same item re-rendering (hook added, day chip toggled, Complete
      // toggled…): swap the content inside the existing overlay instead of
      // rebuilding it, so the slide-in doesn't replay (QA: "the page loads
      // in every time you add a hook") and the scroll position survives.
      const oldBody = existing.querySelector(".screen-body");
      const scrollTop = oldBody ? oldBody.scrollTop : 0;
      existing.innerHTML = inner;
      const newBody = existing.querySelector(".screen-body");
      if (newBody) newBody.scrollTop = scrollTop;
      autoGrowAll();
      return;
    }
    // Fresh open, or navigation to a different item (child screens,
    // returning from one): full rebuild with the slide-in.
    root.innerHTML = '<div class="screen-overlay" data-kind="' + s.kind + '" data-screen-key="' + key + '" style="--accent:var(' + accentVarForKind(s.kind) + ')">' + inner + '</div>';
    requestAnimationFrame(function(){
      const overlay = qs(".screen-overlay");
      if (overlay) overlay.classList.add("open");
      const titleInput = qs('.screen-field-title');
      if (titleInput && !s.taskId && !s.draft.hookPicker) titleInput.focus();
    });
    autoGrowAll();
  }
  function autoGrowAll(){
    qsa(".screen-field-desc").forEach(function(ta){
      ta.style.height = "auto";
      ta.style.height = (ta.scrollHeight + 2) + "px";
    });
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
    renderLane("habit");
    updateHabitBadge();
    updateQaTimeReadout();
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
        { label: "Cancel", action: function(){} }
      ]
    );
  }

  // =========================================================
  // EVENTS
  // =========================================================
  function bindEvents(){
    qs("#reset-btn").addEventListener("click", function(){
      openConfirmDialog("Clear all local data and start fresh?", [
        { label: "Clear data", style: "primary", action: function(){
          KINDS.forEach(function(k){ Storage.remove("gtd_tasks_" + k); Storage.remove("gtd_collapsed:" + k); });
          Storage.remove("gtd_habit_done");
          Storage.remove("gtd_habit_runs");
          Storage.remove("gtd_archived_waiting");
          // Also clear the QA-checklist and chunk-map injection flags: the
          // reset wipes the injected items with the rest of the data, so the
          // flags must go too or they'd be gone for good — both should
          // re-inject with the fresh data (doc 8.1, 8.2).
          Storage.keys().forEach(function(key){
            if (key.indexOf("gtd_qa_checklist") === 0 || key.indexOf("gtd_chunk_map") === 0) Storage.remove(key);
          });
          window.location.reload();
        }},
        { label: "Cancel", action: function(){} }
      ]);
    });

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

    qs("#lane-switcher").addEventListener("click", function(e){
      const btn = e.target.closest("button[data-kind]");
      if (!btn) return;
      state.activeKind = btn.getAttribute("data-kind");
      qsa("#lane-switcher button").forEach(function(b){ b.classList.toggle("active", b === btn); });
      updateLaneVisibility();
    });

    // Mini-list "add to list…" rows — plain click/Enter handlers rather
    // than native form submission, and an inline name row rather than
    // window.prompt for "+ New list": both native mechanisms are silently
    // blocked in sandboxed/embedded contexts (which is why the buttons
    // appeared dead), and the inline versions work everywhere.
    function submitAddMini(row){
      const input = row.querySelector("input[type=text]");
      const title = input.value.trim();
      if (!title){ input.classList.add("field-invalid"); return; }
      input.classList.remove("field-invalid");
      input.value = "";
      addTask(row.getAttribute("data-kind"), title, row.getAttribute("data-parent") || null);
    }
    function openNewListRow(btn, kind){
      const row = document.createElement("div");
      row.className = "add-row new-list-inline";
      row.innerHTML = '<input type="text" placeholder="List name\u2026" /><button type="button" data-role="new-list-confirm">+</button>';
      btn.replaceWith(row);
      const input = row.querySelector("input");
      input.focus();
      // Bugfix: renderLane() only rebuilds .cards-root, not the lane-body's
      // own button row that this inline input replaced — so it never
      // actually restored the "+ New list" button, and the typed text sat
      // there uncleared after a successful create (the only feedback was
      // the new group, which was also landing at the bottom of the lane,
      // off-screen). Restore the button ourselves, immediately, on every
      // exit path.
      function restore(){
        if (row.isConnected) row.replaceWith(btn);
      }
      function commit(){
        const name = input.value.trim();
        if (!name){ restore(); return; }
        restore();
        addGroup(kind, name);
      }
      row.querySelector("button").addEventListener("click", commit);
      input.addEventListener("keydown", function(ev){
        if (ev.key === "Enter") commit();
        else if (ev.key === "Escape") restore();
      });
      input.addEventListener("blur", function(){
        // Give the + button's click a beat to land before restoring.
        setTimeout(function(){ if (document.body.contains(row) && !row.contains(document.activeElement)) restore(); }, 150);
      });
    }
    document.addEventListener("click", function(e){
      const addMiniBtn = e.target.closest('[data-role="add-mini"]');
      if (addMiniBtn){ submitAddMini(addMiniBtn.closest(".add-row-mini")); return; }
    });
    document.addEventListener("keydown", function(e){
      if (e.key !== "Enter") return;
      const row = e.target.closest && e.target.closest(".add-row-mini");
      if (row && e.target.matches("input[type=text]")){ e.preventDefault(); submitAddMini(row); }
      const quickAddInput = e.target.closest && e.target.closest("[data-quickadd]");
      if (quickAddInput){ e.preventDefault(); screenQuickAdd(quickAddInput.getAttribute("data-quickadd"), quickAddInput.value); }
    });

    document.addEventListener("click", function(e){
      // Subtle navigation tick on real button presses (skip disabled
      // buttons, and skip picker selections where the hook chime plays).
      const clickedBtn = e.target.closest("button:not([disabled])");
      if (clickedBtn){
        const act = clickedBtn.getAttribute("data-action") || "";
        if (act !== "screen-pick-hook" && act !== "screen-pick-condition") playNavClick();
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

      const advBtn = e.target.closest('[data-action="screen-open-advanced"]');
      if (advBtn){ openAdvancedDialog(); return; }

      const newListBtn = e.target.closest('[data-action="new-list"]');
      if (newListBtn){
        openNewListRow(newListBtn, newListBtn.getAttribute("data-kind"));
        return;
      }
      const moveBtn = e.target.closest('[data-action="move"]');
      if (moveBtn){
        const kind = moveBtn.closest(".lane").getAttribute("data-kind");
        const dest = MOVE_MAP[kind];
        if (dest) moveItem(kind, dest, moveBtn.getAttribute("data-id"), moveBtn.getAttribute("data-is-group") === "1");
        return;
      }
      const delGroupBtn = e.target.closest('[data-action="delete-group"]');
      if (delGroupBtn){
        const kind = delGroupBtn.closest(".lane").getAttribute("data-kind");
        const groupId = delGroupBtn.getAttribute("data-id");
        const hasChildren = state.tasks[kind].some(function(t){ return t.parent === groupId; });
        if (hasChildren){
          openConfirmDialog("Move or remove the items inside this list first.", [{ label: "OK", style: "primary", action: function(){} }]);
          return;
        }
        deleteTask(kind, groupId);
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
      const deleteBtn = e.target.closest('[data-action="delete"]');
      if (deleteBtn){
        const k = deleteBtn.closest(".lane").getAttribute("data-kind");
        deleteTask(k, deleteBtn.getAttribute("data-id"));
        return;
      }
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
      const openCreateBtn = e.target.closest('[data-action="open-create"]');
      if (openCreateBtn){ openScreen(openCreateBtn.getAttribute("data-kind"), null); return; }

      const openEditEl = e.target.closest('[data-action="open-edit"]');
      if (openEditEl){ openScreen(openEditEl.getAttribute("data-kind"), openEditEl.getAttribute("data-id")); return; }

      const screenSaveBtn = e.target.closest('[data-action="screen-save"]');
      if (screenSaveBtn){ saveScreen(); return; }

      const screenCancelBtn = e.target.closest('[data-action="screen-cancel"]');
      if (screenCancelBtn){ closeScreen(); return; }

      const screenDeleteBtn = e.target.closest('[data-action="screen-delete"]');
      if (screenDeleteBtn){ deleteScreenItem(); return; }

      const screenCompleteBtn = e.target.closest('[data-action="screen-complete"]');
      if (screenCompleteBtn){ screenComplete(); return; }

      const makeKindBtn = e.target.closest('[data-action="make-kind"]');
      if (makeKindBtn){ screenMakeKind(makeKindBtn.getAttribute("data-dest")); return; }

      const generateActionBtn = e.target.closest('[data-action="generate-action"]');
      if (generateActionBtn){
        const genKind = generateActionBtn.getAttribute("data-gen-kind");
        // Carry over anything already typed in that row's quick-add box.
        const row = generateActionBtn.closest(".quick-add-row");
        const typed = row ? (row.querySelector("[data-quickadd]") || {}).value : "";
        screenGenerateAction(genKind, typed);
        return;
      }

      const quickAddBtn = e.target.closest('[data-action="quick-add-submit"]');
      if (quickAddBtn){
        const row = quickAddBtn.closest(".quick-add-row");
        const input = row ? row.querySelector("[data-quickadd]") : null;
        if (input){ screenQuickAdd(quickAddBtn.getAttribute("data-gen-kind"), input.value); }
        return;
      }

      const linkedActionBtn = e.target.closest('[data-action="open-linked-action"]');
      if (linkedActionBtn){
        openChildScreen(linkedActionBtn.getAttribute("data-kind"), linkedActionBtn.getAttribute("data-id"));
        return;
      }

      const suggestHabitBtn = e.target.closest('[data-action="suggest-habit"]');
      if (suggestHabitBtn){ screenSuggestHabit(); return; }

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
      if (pickHookBtn){ screenPickHook(pickHookBtn.getAttribute("data-id")); return; }

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
      const el = e.target.closest("[data-field]");
      if (!el || !state.screen) return;
      // Any edit clears a blocked-save outline without a full re-render
      // (a re-render here would drop keyboard focus mid-word).
      if (state.screen.invalidField){
        state.screen.invalidField = null;
        qsa(".field-invalid").forEach(function(n){ n.classList.remove("field-invalid"); });
      }
      const field = el.getAttribute("data-field");
      const draft = state.screen.draft;
      if (field === "title"){ draft.title = el.value; }
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
      else if (field === "deadline-date"){
        if (!el.value){ draft.deadline = null; }
        else { draft.deadline = draft.deadline || { date: "", time: "", recurrence: "none" }; draft.deadline.date = el.value; }
      }
      else if (field === "deadline-time"){ if (draft.deadline) draft.deadline.time = el.value; }
      else if (field === "waiting-date"){
        if (!el.value){ draft.deadline = null; }
        else { draft.deadline = draft.deadline || { date: "", time: "", recurrence: "none" }; draft.deadline.date = el.value; draft.whenText = ""; }
      }
      else if (field === "waiting-time"){ if (draft.deadline) draft.deadline.time = el.value; }
    });
    document.addEventListener("change", function(e){
      const el = e.target.closest("[data-field]");
      if (!el || !state.screen) return;
      const field = el.getAttribute("data-field");
      const draft = state.screen.draft;
      if (field === "deadline-recurrence" && draft.deadline){ draft.deadline.recurrence = el.value; renderScreen(); }
      if (field === "linkedProjectId" || field === "deadline-date" || field === "waiting-date"){ renderScreen(); }
    });

    document.addEventListener("keydown", function(e){
      if (e.key !== "Escape") return;
      if (qs(".choice-dialog-backdrop")){ closeDialog(); return; }
      if (state.screen){ closeScreen(); }
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
    // Clamps the hit-test point to the active-card area of a lane before
    // calling elementFromPoint. Without this, dragging past the last card
    // lands on the Completed section (or empty margin) below it — and past
    // the first card lands on the "+ New list" button or header above it —
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
    function applyLiveMove(drag, targetEl, clientY){
      if (!targetEl) return;
      const target = targetEl.closest("[data-drag-id], [data-dropzone-parent]");
      if (!target) return;
      const laneEl = target.closest(".lane");
      if (!laneEl || laneEl.getAttribute("data-kind") !== drag.kind) return;
      const el = drag.el;
      const cardTarget = targetEl.closest("[data-drag-id]");
      if (cardTarget && cardTarget !== el && !el.contains(cardTarget)){
        let anchor = cardTarget;
        if (drag.isGroup){
          // Groups only reorder among top-level elements — resolve the
          // hovered card up to its root-level ancestor first.
          while (anchor.parentElement && !anchor.parentElement.classList.contains("cards-root")){
            anchor = anchor.parentElement;
          }
          if (anchor === el || el.contains(anchor)) return;
        }
        const rect = anchor.getBoundingClientRect();
        const before = (clientY - rect.top) < rect.height / 2;
        const ref = before ? anchor : anchor.nextSibling;
        if (ref !== el && el.nextSibling !== ref){
          anchor.parentElement.insertBefore(el, ref);
        }
      } else if (!cardTarget){
        const zone = targetEl.closest("[data-dropzone-parent]");
        if (!zone || el.contains(zone) || el.parentElement === zone) return;
        if (!drag.isGroup || zone.classList.contains("cards-root")){
          zone.appendChild(el);
        }
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
    });
    document.addEventListener("dragend", function(){
      if (!liveDrag) return;
      const kind = liveDrag.kind;
      liveDrag = null;
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
    function forceCancelTouchDrag(){
      const wasActive = touchDrag && touchDrag.active;
      const kind = touchDrag && touchDrag.kind;
      touchDragCleanup();
      disarmDragWatchdog();
      if (wasActive){
        liveDrag = null;
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
      dragWatchdog = setTimeout(forceCancelTouchDrag, DRAG_WATCHDOG_IDLE_MS);
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
      if (e.target.closest(".card-title, .group-title")) e.preventDefault();
    });
    document.addEventListener("selectionchange", function(){
      const sel = window.getSelection();
      if (!sel || !sel.toString()) return;
      const node = sel.anchorNode;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (el && el.closest(".card-title, .group-title")){
        sel.removeAllRanges();
        forceCancelTouchDrag();
      }
    });
    window.addEventListener("blur", forceCancelTouchDrag);
    document.addEventListener("visibilitychange", function(){ if (document.hidden) forceCancelTouchDrag(); });
    document.addEventListener("touchstart", function(e){
      if (e.touches.length !== 1) return;
      const titleEl = e.target.closest(".card-title, .group-title");
      if (!titleEl) return;
      const el = titleEl.closest("[data-drag-id]");
      if (!el) return;
      const laneEl = el.closest(".lane");
      if (!laneEl) return; // the capture-phase listener above may have just re-rendered this lane, orphaning e.target — bail cleanly rather than throw
      const touch = e.touches[0];
      const kind = laneEl.getAttribute("data-kind");
      const isGroup = el.getAttribute("data-drag-group") === "1";
      touchDrag = { el: el, kind: kind, isGroup: isGroup, startX: touch.clientX, startY: touch.clientY, active: false, timer: null };
      touchDrag.timer = setTimeout(function(){
        if (!touchDrag) return;
        touchDrag.active = true;
        el.classList.add("dragging");
        liveDrag = { el: el, kind: kind, isGroup: isGroup };
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
        if (dx > TOUCH_MOVE_CANCEL_PX || dy > TOUCH_MOVE_CANCEL_PX) touchDragCleanup();
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
        e.preventDefault(); // suppresses the ghost click that'd otherwise fire on whatever's under the finger
        disarmDragWatchdog();
        stopAutoScroll();
        commitLiveMove(liveDrag);
        const kind = liveDrag.kind;
        liveDrag = null;
        renderLane(kind);
      }
      touchDragCleanup();
    });
    document.addEventListener("touchcancel", function(){
      if (touchDrag && touchDrag.active){
        const kind = touchDrag.kind;
        liveDrag = null;
        disarmDragWatchdog();
        stopAutoScroll();
        renderLane(kind);
      }
      touchDragCleanup();
    });
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
  // off to chunk 3.
  // =========================================================
  function injectQAChecklist(){
    const FLAG = "gtd_qa_checklist_chunk1";
    if (Storage.get(FLAG)) return;
    Storage.set(FLAG, "1");

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

    addGroupWithItems("\u2705 QA \u2014 Chunk 1: back always means back one screen", [
      { title: "Opening a linked action from a project, then Cancel, returns to the project (not the lane list)", notes: "Open the Kitchen remodel project. Tap its linked \u2018Contractor quote from Dana\u2019 row to open that action's own page. Tap \u2715 (Cancel). You should land back on the Kitchen remodel project page, not out at the Current Projects list." },
      { title: "Same thing, but Save instead of Cancel", notes: "From the project page, open a linked action again, change its title, and tap \u2190 (Save). You should land back on the project page, and the linked action's new title should show correctly if you reopen it." },
      { title: "The project page's own unsaved typing survives that round trip", notes: "Open a project, type something new into its description box (don't save yet), then open a linked action and Cancel back out. Your unsaved project description should still be sitting there, untouched." },
      { title: "Creating a brand new action from a project (the pencil icon), then Cancel, returns to the project", notes: "Open a project, tap the pencil icon next to its quick-add row to open a full blank action page, then tap \u2715. You should land back on the project page, not the lane list, and nothing new should have been created." }
    ]);

    addGroupWithItems("\u2705 QA \u2014 Recheck chunk 0c", [
      { title: "Snapshot and Restore still work", notes: "Tap Snapshot, delete something, tap Restore and confirm \u2014 the deleted item should come back." },
      { title: "The QA time buttons still move the clock", notes: "Tap \u2018QA: +1 Day\u2019 and confirm the small readout text next to it changes." }
    ]);

    saveTasksLocal("next");
  }

  // =========================================================
  // BOOT
  // =========================================================
  function boot(){
    renderShell();
    bindEvents();
    initLocalData();
    initCompletedData();
    injectQAChecklist();
    injectChunkMap();
    state.habitDone = loadHabitDone();
    state.habitDoneOrder = loadHabitDoneOrder();
    state.habitRuns = loadHabitRuns();
    processHabitBoundaries();
    KINDS.forEach(renderLane);
    updateLaneVisibility();
    updateQaTimeReadout();
  }

  document.addEventListener("DOMContentLoaded", boot);

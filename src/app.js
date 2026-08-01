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
    // ⚑ The intray handle is static markup too, and its title/aria-label were
    // hard-coded English while tray.handle / tray.handleOpen sat unused in
    // i18n.js — so a zh-Hans user got an English tooltip on the one control
    // that opens capture. Stamped here because this function is exactly what
    // setLocale re-runs on a language switch; the drawer's own close handle
    // was already translated, which is what made the omission easy to miss.
    const handle = qs("#tray-handle");
    if (handle){
      handle.setAttribute("title", t("tray.handleOpen"));
      handle.setAttribute("aria-label", t("tray.handle"));
    }
  }
  // Task lanes (each backed by state.tasks[k]). Notes are a lane too but NOT a
  // task kind — they have their own store — so KINDS stays task-only and
  // ALL_LANES is what tab/lane rendering and visibility iterate (chunk 6).
  // ⚑ THE UNDO WINDOW — one constant, one ruling, both data types.
  //
  // "It's basically the same feature for two different data types, so they
  // should be unified" (author, 2026-08-01). There were two: the pseudo-action
  // revival window (§4.15c) at ten minutes, and the promotion pushback (§10)
  // at five. They ARE the same feature — un-completing something shortly after
  // completing it undoes the side effect the completion caused — differing
  // only in what the side effect was:
  //
  //   · a Waiting dependent promoted into Next Actions   (§10)
  //   · a recurring series rolled on to its next date     (§4.15c)
  //
  // FIVE minutes, the narrower of the two. What this guards is a mistap while
  // scrolling, noticed within seconds or not at all, so the window only has to
  // outlast "wait, that was the wrong row". Past it, the thing the completion
  // set in motion has had a life of its own, and reversing it would be the app
  // overriding the user's more recent reality with an inference.
  //
  // Declared here rather than in events.js so there is one home for a rule
  // that is not calendar-specific; events.js is stapled after app.js and reads
  // it only from inside functions, so ordering is not a concern.
  const UNDO_WINDOW_MS = 5 * 60 * 1000;
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
    // W4 (wrapper-plan.md §4.3): pulledThisSession is session-only, never
    // persisted; read by Sync.canSweepAccumulated(), set once a real pull
    // succeeds. W5 adds syncing/lastError, also session-only — "did the last
    // attempt work" is a property of right now, not something Reset needs to
    // touch. lastSyncAt (staleness, §1) and the conflict log ARE persisted,
    // in Storage under gtd_dropbox_*, not here — see runDropboxSync().
    sync: { pulledThisSession: false, syncing: false, lastError: null, deferredApply: false },
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
    return sortedContexts().filter(function(c){
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
    if (isRunPaused(run)) return false;
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
  // CONTEXT ORDER — hand-arranged, like every other list in the app.
  //
  // ⚑ This REPLACES the alphabetical sort added earlier in W7, and the
  // author's correction is worth recording because it changes what the
  // requirement was. The complaint was never "the two devices disagree" on
  // its own — it was "they disagree AND I can't fix it." Alphabetical
  // answered the first half by removing the disagreement; dragging answers
  // the whole thing by restoring the agency. Order still doesn't propagate
  // between devices (nothing hand-arranged does — the merge rebuilds each
  // array in ITS OWN order, so a lane you drag on the phone stays that way
  // only on the phone), and that is now fine by ruling: a divergence you can
  // correct in two seconds is not a defect.
  //
  // So this is plain array order, and new contexts unshift to the top like
  // everything else the app creates.
  function sortedContexts(){ return state.contexts || []; }
  // One-time alphabetical normalization, so BOTH devices start hand-ordering
  // from the same arrangement rather than from whatever sequence each of them
  // happened to merge in. Runs once ever; after that the order is the user's
  // and is never touched again. localeCompare for the Chinese build, id as
  // the tiebreaker so two contexts sharing a name cannot swap places.
  function normalizeContextOrderOnce(){
    if (Storage.get("gtd_contexts_ordered") === "1") return;
    Storage.set("gtd_contexts_ordered", "1");
    if (!state.contexts || state.contexts.length < 2) return;
    state.contexts.sort(function(a, b){
      const byName = (a.name || "").localeCompare(b.name || "");
      return byName !== 0 ? byName : (a.id < b.id ? -1 : 1);
    });
    saveContexts();
  }
  // Reorder the registry itself. The drag machinery is entirely reused — a
  // context group already renders at the cards-root level, which is where
  // applyLiveMove pins anything marked data-drag-group="1" — so the only new
  // logic is which array to splice and what to redraw.
  //
  // ⚑ Both action lanes redraw, not just the one dragged in (author). There is
  // ONE context registry behind Next and Waiting, so a drag in either is a
  // change to both, and the lane you weren't looking at would otherwise keep
  // rendering its groups in the old order until something else refreshed it.
  function moveContext(contextId, previousId){
    const list = state.contexts;
    const idx = list.findIndex(function(c){ return c.id === contextId; });
    if (idx === -1) return;
    const ctx = list[idx];
    list.splice(idx, 1);
    const prevIdx = previousId ? list.findIndex(function(c){ return c.id === previousId; }) : -1;
    if (!previousId) list.unshift(ctx);
    else if (prevIdx === -1) list.push(ctx);
    else list.splice(prevIdx + 1, 0, ctx);
    saveContexts();
    KINDS.filter(isActionKind).forEach(renderLane);
  }
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
    if (kind === "next") pushBackPromotedDependents(task);
    if (kind === "current" || kind === "future"){
      restoreArchivedWaitingForProject(taskId); // renders "waiting" itself
    }
  }
  // §10's RULING, built here for the first time — the spec closed the question
  // and nothing implemented it, so the window has effectively been zero:
  // un-completing an action never pushed back the dependents its completion
  // promoted. (`promotedBy`/`promotedAt` appeared nowhere in the source.)
  //
  // No timer and no background process: the expiry is evaluated on read, at
  // the only moment anyone cares. See UNDO_WINDOW_MS for the window itself.
  function pushBackPromotedDependents(restored){
    const now = nowMs(); // same clock the stamp was written with, see promoteDependents
    const due = state.tasks.next.filter(function(t){
      return t.promotedBy === restored.id && t.promotedAt &&
             (now - t.promotedAt) <= UNDO_WINDOW_MS;
    });
    if (!due.length) return;
    due.forEach(function(t){
      moveItem("next", "waiting", t.id, false);
      const back = state.tasks.waiting.find(function(x){ return x.id === t.id; });
      if (!back) return;
      // moveItem cleared the link on the way out and again on the way back, so
      // the condition is REBUILT rather than remembered. conditionKind is
      // "next" by construction: completeTask only promotes when the completed
      // item was a Next Action, and restoreTask has just put it back there.
      back.conditionId = restored.id;
      back.conditionKind = "next";
      back.conditionLabel = restored.title; // the same frozen denormalised name the link carries
      delete back.promotedBy;
      delete back.promotedAt;
    });
    // Ruled explicitly in the spec so it isn't guessed: a dependent EDITED
    // since promotion is still pushed back. Its edits survive; only its lane
    // changes. Inside five minutes that cannot be surprising.
    saveTasksLocal("next");
    saveTasksLocal("waiting");
    renderLane("waiting");
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
    Storage.setJSON("gtd_habit_runs", habitMapToStored(seededRuns));

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
  // habitDone: {habitId: {date, state:"done"|"cleared", at}} — the user's most
  // recent ASSERTION about a day, not merely the fact of a tick.
  //
  // ⚑ W7, author's ruling. Un-ticking used to delete the entry outright, which
  // made it an ABSENCE, and absence is what the sweep reads as "nobody did
  // this" -- an inference. So the deliberate act of correcting a fat-finger
  // was recorded in the one form the merge is built to discard, and DONE WINS
  // then resurrected the mistake on the other device, permanently, the moment
  // either device promoted the day into history.
  //
  // Now both acts are assertions and both are stored:
  //   · tick     -> {state:"done",    at: now}
  //   · un-tick  -> {state:"cleared", at: now}
  // and a contested day is settled by WHICHEVER ASSERTION IS LATER. The
  // original ruling is unchanged and in fact restored to its actual wording --
  // an inference must never overwrite an assertion -- it just no longer has to
  // stand in for "explicitly not done", which previously had no way to be
  // said. Re-completing after un-completing therefore works too: it is simply
  // a third, later assertion.
  //
  // Never removed, only superseded, so this store no longer mints a tombstone
  // on an un-tick (storage.js stampAndTombstone diffs saves for removals).
  function loadHabitDone(){
    // Tolerates all three shapes it can meet, so no migration ships with this:
    // the pre-chunk-B keyed object {id: "YYYY-MM-DD"}, chunk B's record array
    // [{id, date}], and this one. The first two are pure "done" assertions
    // with no timestamp, which resolveOutcome reads as un-asserted and settles
    // by the old done-wins rule -- exactly right for data recorded before
    // un-ticking could be said out loud.
    const out = habitMapFromStored(Storage.getJSON("gtd_habit_done", []));
    Object.keys(out).forEach(function(id){
      const v = out[id];
      if (typeof v === "string") out[id] = { date: v, state: "done", at: 0 };
      else if (v && !v.state) v.state = "done";
    });
    return out;
  }
  function saveHabitDone(){ Storage.setJSON("gtd_habit_done", habitMapToStored(state.habitDone)); }
  // The assertion this device holds about a given day, or null. "Cleared" is
  // an assertion and is returned as one -- callers asking "was it done?" must
  // check .state, not merely that something came back.
  function habitAssertionFor(taskId, date){
    const a = state.habitDone[taskId];
    return a && a.date === date ? a : null;
  }
  function habitDoneToday(taskId){
    const a = habitAssertionFor(taskId, todayStr());
    return !!a && a.state === "done";
  }
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
  //   schedule: [0..6] (Sun=0),
  //   pausedRanges: [{from, to}, ...]  (W7 -- see the pause block below;
  //     `to` null while open, [from, to) so the day you resume counts),
  //   history: [{date, status:"done"|"stumble"|"miss", assertedAt?}, ...]  (scheduled
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
  // SYNCED AS OF CHUNK B (sync-audit.md §3). Habit progress — the streak, the
  // history, the paused state — did not sync at all, which made it the only
  // gap that lost data during the most ordinary act in the app: ticking a
  // checkbox. It was excluded because a keyed object is not a shape the merge
  // engine reads.
  //
  // Same trick as the archive maps: only the STORED shape changes, to a
  // record array ([{id: habitId, ...run}]). state.habitRuns stays the keyed
  // object every call site already uses, so nothing else moves, and reading
  // still tolerates the old shape so an existing install needs no migration.
  function habitMapFromStored(raw, valueKey){
    if (Array.isArray(raw)){
      const out = {};
      raw.forEach(function(r){
        if (!r || typeof r.id !== "string") return;
        if (valueKey){ out[r.id] = r[valueKey]; return; }
        const copy = Object.assign({}, r);
        delete copy.id;
        out[r.id] = copy;
      });
      return out;
    }
    return raw && typeof raw === "object" ? raw : {}; // pre-chunk-B keyed object
  }
  function habitMapToStored(obj, valueKey){
    return Object.keys(obj || {}).map(function(id){
      if (valueKey){ const rec = { id: id }; rec[valueKey] = obj[id]; return rec; }
      return Object.assign({ id: id }, obj[id]);
    });
  }
  function loadHabitRuns(){
    const out = habitMapFromStored(Storage.getJSON("gtd_habit_runs", []));
    // W7: pause was a bare boolean before dated ranges. Converted on read
    // rather than by a migration (CLAUDE.md: migrations are optional until
    // real use begins) -- an open range is dated from the last day the sweep
    // finalized, which is the day pause froze it, so a habit paused under the
    // old model keeps protecting the same days under the new one.
    Object.keys(out).forEach(function(id){
      const r = out[id];
      if (!r || typeof r !== "object") return;
      if (!Array.isArray(r.pausedRanges)){
        r.pausedRanges = r.paused ? [{ from: r.lastProcessedDate || todayStr(), to: null }] : [];
      }
      delete r.paused;
    });
    return out;
  }
  function saveHabitRuns(){ Storage.setJSON("gtd_habit_runs", habitMapToStored(state.habitRuns)); }

  // ---------------------------------------------------------------------
  // PAUSE AS DATED RANGES (W7, author's ruling).
  //
  // PURPOSE (CLAUDE.md's question 1). Pause exists to protect the TRUTHFULNESS
  // of the record. A miss is an inference drawn from absence, but some
  // absences are not failures -- illness, travel, a closed gym. Without pause
  // the user's only options are to let a real run die for reasons unconnected
  // to their commitment, or to tick the box anyway; a streak tracker with no
  // pause trains its users to lie to it, and a history containing lies makes
  // the personal best worthless. Pause is how you say "these days were not
  // part of the experiment" without lying and without being punished.
  //
  // It is deliberately NOT a break from struggling -- that is just missing,
  // and the stumble grace already covers it. Pause is for INAPPLICABLE, not
  // for FAILING, which is why it stays behind a deliberate open-and-save on
  // the habit's own page and is not offered next to the checkbox.
  //
  // WHY DATED (the sync half). A boolean says only "parked now" and carries no
  // opinion about any particular day, so a device that had not yet heard about
  // the pause went on sweeping misses -- and misses union in and cannot be
  // beaten by anything except a done. Pausing IS a direct assertion, but
  // undated it was not in a form the merge could hear, so the inference won by
  // default. Dating it makes the protection RETROACTIVE: a stale device's
  // fabricated misses no longer have to be prevented, they are filtered at
  // replay time once the range arrives. That is the property no amount of
  // gate-tightening could buy.
  //
  // [from, to): the day you pause is inside the range, the day you resume is
  // not. `to` null means still open, which is the only thing run.paused ever
  // meant -- so it is now DERIVED rather than stored, and cannot disagree.
  function dateInPausedRanges(date, ranges){
    return (ranges || []).some(function(r){
      return r && r.from <= date && (!r.to || date < r.to);
    });
  }
  function isRunPaused(run){
    return (run.pausedRanges || []).some(function(r){ return r && !r.to; });
  }
  // The day the open pause began — what the card and page show, so pause reads
  // as a bracket you opened rather than a switch you flipped.
  function pausedSinceDate(run){
    const open = (run.pausedRanges || []).filter(function(r){ return r && !r.to; })
      .map(function(r){ return r.from; }).sort();
    return open.length ? open[0] : null;
  }
  // What the paused pill says, on the card and on the page. The DATE is the
  // teaching here (CLAUDE.md's question 2): a bare "Paused" reads as a switch
  // that is on, which is precisely the mental model the boolean encoded and
  // this round is replacing. Same short date style the deadline pills use.
  function pausedPillText(run){
    const since = pausedSinceDate(run);
    if (!since) return t("outcome.paused");
    const d = dateStrToDate(since);
    return t("habit.pausedSince").replace("{date}",
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  }
  function openPausedRange(run, date){
    if (isRunPaused(run)) return;
    run.pausedRanges = (run.pausedRanges || []).concat([{ from: date, to: null }]);
  }
  function closePausedRanges(run, date){
    (run.pausedRanges || []).forEach(function(r){ if (r && !r.to) r.to = date; });
  }
  // Ranges ACCUMULATE like history -- they are dated facts, never fields, so
  // they are unioned rather than three-way merged. Keyed by `from`, since two
  // devices describing the same pause agree about when it started.
  function mergePausedRanges(a, b){
    const byFrom = {};
    (a || []).concat(b || []).forEach(function(r){
      if (!r || typeof r.from !== "string") return;
      const prev = byFrom[r.from];
      if (!prev){ byFrom[r.from] = { from: r.from, to: r.to || null }; return; }
      // A resume is an assertion; an open range is only the absence of one
      // yet, so any close beats none. Two devices that both closed the same
      // pause: the EARLIER resume is the one the user actually made -- a later
      // one is a stale device repeating a resume it had not heard about.
      // ⚑ Judgment call (spec silent): earliest-close wins.
      if (!prev.to){ prev.to = r.to || null; return; }
      if (r.to && r.to < prev.to) prev.to = r.to;
    });
    return Object.keys(byFrom).sort().map(function(k){ return byFrom[k]; });
  }

  // ---------------------------------------------------------------------
  // THE HABIT MERGE (chunk B; sync-audit.md §3, and wrapper-plan.md §1's
  // standard). Registered with sync.js, which owns no habit knowledge.
  //
  // A habit run is three different kinds of thing wearing one coat, and
  // merging them uniformly is what would eat a completion:
  //   · history          ACCUMULATED. What actually happened. Irreplaceable.
  //   · schedule, paused SETTINGS. Ordinary fields; the generic per-field
  //                      three-way merge is exactly right for them.
  //   · currentRunStart, personalBest, bestSequence, lifetimeTotal
  //                      DERIVED. Every one is a function of history.
  //   · lastProcessedDate, pendingResult, badge
  //                      DEVICE-LOCAL sweep and celebration bookkeeping.
  //
  // So nothing about a streak is ever merged: the aggregates are RECOMPUTED
  // from the merged history, which means two devices cannot disagree about a
  // personal best — there is only one history to compute it from.
  //
  // That leaves exactly one real decision, and it is the author's ruling:
  //
  //   A "done" is something you DID. A "miss" is something nobody did — an
  //   inference the sweep draws from the absence of a completion, on
  //   whatever data that device happened to hold. An inference must never
  //   overwrite a direct assertion.
  //
  // ⚑ W7 restates that ruling without changing it. It used to be implemented
  // as the shorthand "DONE WINS, regardless of timestamps", which was only
  // ever correct because the model had no way to SAY "explicitly not done" —
  // un-ticking deleted the record, producing an absence indistinguishable
  // from never having ticked. Now un-ticking is an assertion too, so the rule
  // is implemented as what it always said:
  //
  //   assertion vs inference  -> the assertion, always, whichever way it goes
  //   assertion vs assertion  -> the LATER one (this is what timestamps are for)
  //   inference vs inference  -> done-wins, unchanged, and the only path
  //                              pre-W7 history can take (it carries no
  //                              assertion stamps, so it is all inference here)
  //
  // Note what is merged is the raw per-day OUTCOME (done or not), never the
  // stored status: "stumble" and "miss" are themselves derived — a miss
  // after a stumble ends a run, a first miss is only a stumble — so they
  // depend on order and on what came before, and unioning them directly
  // would produce sequences the rules could never have generated.
  //
  // The replay runs through applyHabitDayOutcome/endHabitRun, the SAME
  // functions live use, rather than a second implementation of the streak
  // rules that could drift from them.
  // A day's outcome, carrying the assertion that produced it: {done, at}.
  // `at` 0 means nobody asserted anything and the sweep inferred it.
  function resolveOutcome(a, c){
    if (!a) return c;
    if (!c) return a;
    if (a.at && c.at) return a.at >= c.at ? a : c;  // assertion vs assertion: the later
    if (a.at) return a;                             // assertion beats inference...
    if (c.at) return c;                             // ...whichever side holds it
    return { done: a.done || c.done, at: 0 };       // neither asserted: done-wins (pre-W7 data)
  }
  function replayHabitRun(outcomes, schedule, pausedRanges){
    const run = defaultHabitRun();
    run.schedule = schedule;
    run.pausedRanges = pausedRanges || [];
    Object.keys(outcomes).sort().forEach(function(date){
      const o = outcomes[date];
      // An asserted DONE outranks a pause: the only ways one exists inside a
      // paused stretch are the completion locked in on the day pause began,
      // and a device that had not yet heard about the pause — and in both
      // cases the user did in fact do it, so it counts.
      if (o.done){ applyHabitDayOutcome(run, date, "done", o.at); return; }
      // Everything else inside a paused stretch is simply not part of the
      // experiment. Note this is where a stale device's fabricated misses go
      // to die, retroactively, which is the whole point of dating pause.
      if (dateInPausedRanges(date, run.pausedRanges)) return;
      applyHabitDayOutcome(run, date, "miss", o.at);
    });
    return run;
  }
  function historyToOutcomes(history){
    const out = {};
    (history || []).forEach(function(e){
      if (!e || typeof e.date !== "string") return;
      out[e.date] = resolveOutcome(out[e.date],
                                   { done: e.status === "done", at: e.assertedAt || 0 });
    });
    return out;
  }
  function mergeHabitRunRecord(l, r, b){
    const lo = historyToOutcomes(l.history), ro = historyToOutcomes(r.history);
    const outcomes = {};
    const contested = [];
    Object.keys(lo).concat(Object.keys(ro)).forEach(function(d){
      if (outcomes.hasOwnProperty(d)) return;
      const a = lo[d], c = ro[d];
      outcomes[d] = resolveOutcome(a, c);
      if (a && c && a.done !== c.done) contested.push(d); // the devices actually disagreed
    });
    // Schedule is the only real FIELD left: pause became dated ranges, which
    // accumulate like history and are unioned rather than merged.
    const settings = Sync.mergeFields(
      { schedule: l.schedule, modifiedAt: l.modifiedAt, deviceId: l.deviceId },
      { schedule: r.schedule, modifiedAt: r.modifiedAt, deviceId: r.deviceId },
      b ? { schedule: b.schedule } : null
    );
    const rebuilt = replayHabitRun(outcomes, settings.record.schedule || defaultHabitRun().schedule,
                                   mergePausedRanges(l.pausedRanges, r.pausedRanges));
    // Device-local, deliberately kept from THIS device: a celebration this
    // device has not shown yet is not the other device's to deliver, and the
    // sweep cursor describes this device's own progress through the calendar.
    rebuilt.lastProcessedDate = l.lastProcessedDate || null;
    rebuilt.pendingResult = l.pendingResult || null;
    rebuilt.badge = !!l.badge;
    rebuilt.id = l.id;
    rebuilt.modifiedAt = Math.max(l.modifiedAt || 0, r.modifiedAt || 0);
    rebuilt.deviceId = settings.record.deviceId;
    return {
      record: rebuilt,
      // Only a day the two devices actually disagreed about is worth
      // reporting, and the report says which way it went -- §1's "never
      // silent" applies to a completion being upheld just as much as to one
      // being replaced. W7: which way it went is no longer always "done",
      // so the resolved outcome per day is reported instead of a flat flag.
      conflict: contested.length
        ? { habitDays: contested.slice(),
            habitResolved: contested.reduce(function(m, d){ m[d] = outcomes[d].done; return m; }, {}),
            local: l, remote: r, winner: rebuilt }
        : null
    };
  }
  // gtd_habit_done needs its own merger too (W7). An assertion record is
  // ATOMIC — date, state and stamp are one statement about one day — so the
  // generic per-field merge is actively wrong here: it could take `date` from
  // the device that ticked yesterday and `state` from the device that cleared
  // today, producing a statement neither device ever made. Whole record,
  // latest assertion wins, which is the same rule the history merge applies
  // to the same facts one day later.
  function mergeHabitDoneRecord(l, r){
    const winner = (r.at || 0) > (l.at || 0) ? r : l;
    const rec = Object.assign({}, winner);
    rec.id = l.id;
    rec.modifiedAt = Math.max(l.modifiedAt || 0, r.modifiedAt || 0);
    return {
      record: rec,
      // Two devices asserting different things about the same day is a real
      // disagreement and §1 says it is never silent -- even though the loser
      // is usually just this device's own earlier tick.
      conflict: (l.date === r.date && l.state !== r.state)
        ? { habitDays: [l.date], habitResolved: { [l.date]: rec.state === "done" },
            local: l, remote: r, winner: rec }
        : null
    };
  }
  function defaultHabitRun(){
    return {
      schedule: [0, 1, 2, 3, 4, 5, 6], pausedRanges: [], history: [], currentRunStart: 0,
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
  //
  // assertedAt (W7) is the timestamp of the user act this outcome came from --
  // a tick or an un-tick -- and is absent when the sweep merely inferred the
  // day from an absence. It has to survive INTO history, not just into the
  // sweep, because the sweep is where a day stops being contestable: once two
  // devices have each promoted the same day, an entry with no stamp is
  // indistinguishable from a genuine inference, and the merge would resurrect
  // a corrected fat-finger. Carrying it is what makes the ruling hold after
  // the 4am boundary as well as before it.
  function historyEntry(date, status, assertedAt){
    const e = { date: date, status: status };
    if (assertedAt) e.assertedAt = assertedAt;
    return e;
  }
  function applyHabitDayOutcome(run, date, status, assertedAt){
    if (status === "done"){
      run.history.push(historyEntry(date, "done", assertedAt));
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
      run.history.push(historyEntry(date, "miss", assertedAt));
      endHabitRun(run);
    } else {
      run.history.push(historyEntry(date, "stumble", assertedAt));
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
  // wrapper-plan.md §4.3: a device must pull before this sweep may persist
  // accumulated state (habit history), or a stale copy can write a "miss"
  // over a completion it simply hasn't seen yet.
  //
  // ⚑ W7: the gate now asks whether this device has pulled since the BOUNDARY
  // it is about to finalize across, not merely whether it has pulled at all
  // this session — see sync.js canSweepAccumulated. The moment is computed
  // from the real clock deliberately: the question is about network
  // freshness, and feeding it the QA-offset clock would jam the gate shut for
  // the whole of a time-jump testing session.
  function lastRealBoundaryMs(){
    const d = new Date();
    d.setHours(d.getHours() - 4); // same 4am day-start as boundaryNow()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + 4 * 3600 * 1000;
  }
  // Returns whether anything actually changed, so callers can skip a render —
  // and so the post-pull re-sweep can't spin (a write triggers a debounced
  // push, which lands a merge, which re-sweeps...).
  function processHabitBoundaries(){
    if (!Sync.canSweepAccumulated(lastRealBoundaryMs())) return false;
    const today = todayStr();
    let changed = false;
    state.tasks.habit.forEach(function(h){
      if (h.isGroup) return;
      const run = ensureHabitRun(h.id);
      if (!run.lastProcessedDate){ run.lastProcessedDate = today; changed = true; return; }
      if (run.lastProcessedDate === today) return;
      // Paused habits are FROZEN outright (design ruling from the pause/
      // completion round: pausing disables completion itself, so there is
      // nothing to sweep — a completion made just before pausing is locked
      // into history by saveScreen's pause transition). Under dated ranges
      // the replay would filter these days anyway; skipping them here keeps
      // history from accumulating entries that only ever get thrown away.
      if (isRunPaused(run)){ run.lastProcessedDate = today; changed = true; return; }
      let cursor = dateStrToDate(run.lastProcessedDate);
      const todayDate = dateStrToDate(today);
      while (cursor.getTime() < todayDate.getTime()){
        const ds = dateToStr(cursor);
        if (run.schedule.indexOf(cursor.getDay()) !== -1 && sweepDay(run, h.id, ds)) changed = true;
        cursor = addDaysToDate(cursor, 1);
      }
      run.lastProcessedDate = today;
      changed = true;
    });
    if (changed) saveHabitRuns();
    return changed;
  }
  // Finalizes ONE scheduled day. Returns whether it wrote anything.
  function sweepDay(run, habitId, ds){
    const asserted = habitAssertionFor(habitId, ds);
    const at = asserted ? (asserted.at || 0) : 0;
    const existing = run.history.find(function(en){ return en.date === ds; });
    if (existing){
      // The already-in-history guard covers the complete→pause path, where
      // the pause transition locked today's done in immediately — without it
      // that day would be recorded a second time here.
      //
      // ⚑ W7: but it also used to drop a LATER assertion on the floor. If a
      // merge brought in the other device's promoted outcome for a day this
      // device still holds a newer assertion about, the entry was already
      // present, so the correction was skipped and could never be applied
      // again — the sweep is once-per-day-per-device. Comparing stamps first
      // is what closes that, and it is the last hole in the un-complete path.
      if (!at || at <= (existing.assertedAt || 0)) return false;
      return rebuildRunWithOutcome(run, ds, { done: asserted.state === "done", at: at });
    }
    applyHabitDayOutcome(run, ds, asserted && asserted.state === "done" ? "done" : "miss", at);
    return true;
  }
  // Replacing a day already in history means every derived aggregate after it
  // is wrong, so the run is replayed from its own outcomes rather than
  // patched in place — the same rebuild the merge does, through the same
  // functions, for the same reason (no second implementation of the rules).
  function rebuildRunWithOutcome(run, date, outcome){
    const outcomes = historyToOutcomes(run.history);
    outcomes[date] = outcome;
    const rebuilt = replayHabitRun(outcomes, run.schedule, run.pausedRanges);
    run.history = rebuilt.history;
    run.currentRunStart = rebuilt.currentRunStart;
    run.personalBest = rebuilt.personalBest;
    run.bestSequence = rebuilt.bestSequence;
    run.lifetimeTotal = rebuilt.lifetimeTotal;
    return true;
  }
  function toggleHabit(taskId){
    // Design ruling (pause/completion round): PAUSE MEANS PAUSE — a
    // paused habit can't be completed (or un-completed) at all. The
    // checkbox and the page's Complete badge render disabled; this guard
    // is the backstop for every path that reaches them (card tap, the
    // delayed check-animation path, the page badge).
    if (isRunPaused(ensureHabitRun(taskId))) return;
    const today = todayStr();
    const wasDone = habitDoneToday(taskId);
    // W7: the record is SUPERSEDED, never removed. Deleting it made an
    // un-tick an absence, which is the one form the merge is built to
    // discard — see the habitDone block above. Date.now() and not
    // boundaryNow(): this orders two devices' assertions against each other,
    // exactly like storage.js's modifiedAt, and a QA time jump must never
    // skew that ordering.
    state.habitDone[taskId] = { date: today, state: wasDone ? "cleared" : "done", at: Date.now() };
    if (wasDone){
      state.habitDoneOrder = state.habitDoneOrder.filter(function(id){ return id !== taskId; });
    } else {
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
    // §10's pushback ruling: a promoted dependent records WHAT promoted it and
    // WHEN, so un-completing the source shortly afterwards can put it back.
    // Written here because moveItem deliberately clears conditionId/Kind/Label
    // on the way across — after the move the dependent has no memory of the
    // link at all, which is why the spec called for two new fields rather than
    // a lookup.
    function promoteDependents(){
      if (!dependents.length) return;
      // nowMs(), NOT Date.now(): this stamp is only ever compared against
      // "now" on the same device, so it does not need the wall clock that
      // cross-device ordering does (modifiedAt) — and using the QA-jumpable
      // clock is what makes the window testable with the time-jump buttons,
      // exactly as the calendar half of this feature already is.
      const at = nowMs();
      dependents.forEach(function(dep){
        moveItem("waiting", "next", dep.id, false);
        const moved = state.tasks.next.find(function(t){ return t.id === dep.id; });
        if (moved){ moved.promotedBy = taskId; moved.promotedAt = at; }
      });
      saveTasksLocal("next");
    }
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
    // ⚑ A DATED THING DOES NOT WAIT (§4.13a, author: "deadlines can't live in the
    // waiting lane"). Every other route into Waiting already honours this — the
    // page has no deadline field, saveScreen nulls it, and the convert button is
    // inert while a date is set — but this one did not. MOVE_MAP only ever
    // promotes, so the single next→waiting caller is pushBackPromotedDependents:
    // complete a Next Action, give the dependent it promoted a deadline, then
    // undo the completion inside the window, and the item went back to Waiting
    // still carrying the date. Narrow, but it is the only hole left in the rule.
    root.deadline = (root.isGroup || destKind === "waiting") ? null : (root.deadline || null);
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
  // SYNCED AS OF CHUNK A (sync-audit.md §2b). These two maps hold full COPIES
  // of the records a completed project took down with it, and they are what
  // un-completing restores from. They used to be keyed objects
  // ({projectId: [records]}), which is not a shape the merge engine can read,
  // so they were left out of sync entirely — and that silently defeated
  // un-complete across devices: complete a project on the phone (the linked
  // actions and events are archived and removed, and that removal correctly
  // syncs), then un-complete it on the computer, whose map is empty, and
  // nothing came back. Both halves are ordinary use and the second is the
  // app's own remedy for an easy mistake, so it failed wrapper-plan.md §1's
  // standard outright.
  //
  // Fixed by changing only the STORED shape to a record array
  // ([{id: projectId, items: [...]}]), which stampAndTombstone and the merge
  // already understand. The in-memory shape every caller uses is unchanged —
  // still a plain {projectId: [records]} object — which is why this fix
  // touches no call site. Reading tolerates the old keyed-object shape so an
  // existing install keeps working without a migration.
  function archiveMapFromStored(raw){
    if (Array.isArray(raw)){
      const out = {};
      raw.forEach(function(r){ if (r && typeof r.id === "string") out[r.id] = r.items || []; });
      return out;
    }
    return raw && typeof raw === "object" ? raw : {}; // pre-chunk-A keyed object, read as-is
  }
  function archiveMapToStored(obj){
    return Object.keys(obj || {}).map(function(id){ return { id: id, items: obj[id] || [] }; });
  }
  // Chunks A and B each reshaped a pair of stores from keyed objects to record
  // arrays so the merge engine could read them. Every LOADER tolerates the old
  // shape, but sync.js reads storage directly (exportBundle), so an install
  // that has not happened to re-save one of them yet would hand the merge a
  // plain object. Converting once at boot means the two shapes never coexist
  // beyond the first launch after an upgrade -- and no migration is needed,
  // since this IS the migration, and a cheap idempotent one.
  function normalizeReshapedStores(){
    const jobs = [
      ["gtd_habit_runs", function(o){ return habitMapToStored(o); }],
      ["gtd_habit_done", function(o){ return habitMapToStored(o, "date"); }],
      ["gtd_archived_waiting", function(o){ return archiveMapToStored(o); }],
      ["gtd_archived_events", function(o){ return archiveMapToStored(o); }]
    ];
    jobs.forEach(function(job){
      const raw = Storage.getJSON(job[0], null);
      if (raw && !Array.isArray(raw) && typeof raw === "object") Storage.setJSON(job[0], job[1](raw));
    });
  }
  function loadArchivedWaiting(){
    return archiveMapFromStored(Storage.getJSON("gtd_archived_waiting", []));
  }
  function saveArchivedWaiting(obj){ Storage.setJSON("gtd_archived_waiting", archiveMapToStored(obj)); }
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
  function loadArchivedEvents(){ return archiveMapFromStored(Storage.getJSON("gtd_archived_events", [])); }
  function saveArchivedEvents(obj){ Storage.setJSON("gtd_archived_events", archiveMapToStored(obj)); }
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
  // ⚑ `onConfirmed` (user): a hook that runs the moment completion is
  // actually going ahead — after the confirm is accepted, or straight away
  // when there is nothing to confirm. It receives the real finisher and must
  // call it. The lane checkbox uses it to play its tick BEFORE the card leaves,
  // so a project keeps the pop of satisfaction every other item gets; the
  // complication is exactly why the tick had to move rather than disappear.
  // Callers that pass nothing behave as before.
  function completeProject(kind, projectId, onConfirmed){
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
    if (waitingLinked.length) parts.push(waitingLinked.length === 1 ? t("confirm.linkedWaitingOne")
      : t("confirm.linkedWaitingMany").replace("{n}", waitingLinked.length));
    if (eventCount) parts.push(eventCount === 1 ? t("confirm.linkedEventOne")
      : t("confirm.linkedEventMany").replace("{n}", eventCount));
    if (parts.length){
      const what = parts.join(t("confirm.joinAnd"));
      const many = (waitingLinked.length + eventCount) > 1;
      // \u2691 One whole sentence per plurality rather than a concatenation with
      // (many ? "them" : "it") spliced through it three times: Chinese has no
      // them/it split to mirror, so only a complete sentence can be translated.
      openConfirmDialog(
        (many ? t("confirm.completeProjectMany") : t("confirm.completeProjectOne")).replace("{what}", what),
        [
          { label: t("confirm.completeProject"), style: "primary", action: goAhead },
          { label: t("chrome.cancel"), action: function(){} }
        ]
      );
    } else {
      goAhead();
    }
    function goAhead(){
      if (onConfirmed) onConfirmed(doComplete); else doComplete();
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
  //
  // ⚑ SPLIT IN TWO (author, 2026-08-01: "the warning dialogue about actions and
  // projects should get moved to the make future button instead of the save
  // button"). askDemoteChoice runs at the TAP, because that is when the decision
  // is made; applyDemoteChoice runs at Save. In between, the answer sits on the
  // draft as an enum — which is the whole reason this is worth thirty lines
  // rather than fifteen. Acting on Delete at the tap and then leaving with ✕
  // would discard the conversion while the project's actions and events were
  // already gone: an unchanged Current project silently emptied. DRAFT ISOLATION
  // names that case in as many words ("including side effects on *other*
  // items"), and it is worse than the 🗑 exception it would have leaned on — 🗑
  // destroys the thing you are looking at, deliberately, behind its own confirm.
  //
  // Staging is also MORE CORRECT than acting at the tap: the linked set is
  // recomputed at Save, so an action added or promoted while the page sat open
  // is included. The dialog may therefore have said "2 actions" and Save act on
  // 3; the unlink-or-delete choice still applies, and the alternative is a
  // stale by-value snapshot — the §9 zombie trap applyProjectStaging already
  // resolves by id.
  function askDemoteChoice(projectId, done){
    const linked = linkedActionsForProject(projectId);
    const linkedEvents = (state.events || []).filter(function(ev){ return ev.linkedProjectId === projectId; });
    // Nothing to warn about: swap the page straight away. Save still recomputes,
    // and applyDemoteChoice's null-choice default covers anything that arrives
    // in the meantime.
    if (!linked.length && !linkedEvents.length){ done("unlink"); return; }
    const nouns = [];
    if (linked.length) nouns.push(t("confirm.nounActions"));
    if (linkedEvents.length) nouns.push(t("confirm.nounCalendarEntries"));
    const what = nouns.join(t("confirm.joinOr"));
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
      ? (noteCount === 1 ? t("confirm.notesKeptOne") : t("confirm.notesKeptMany").replace("{n}", noteCount))
      : "";
    // ⚑ Each branch only ANSWERS. It must not call changeKind or closeScreen any
    // more: the page swap and Save own those now.
    openConfirmDialog(
      t("confirm.somedayCantHold").replace("{what}", what) + keeps,
      [
        { label: t("confirm.unlink"), style: "primary", action: function(){ done("unlink"); } },
        { label: t("chrome.delete"), style: "danger", action: function(){ done("delete"); } },
        { label: t("chrome.cancel"), action: function(){ done(null); } }
      ]
    );
  }
  // The APPLY half, run in the save path immediately before changeKind. The
  // linked set is recomputed HERE, by project id — never the snapshot the
  // dialog counted.
  //
  // A null choice means the dialog never ran (nothing was linked at the tap).
  // Anything that arrived since is UNLINKED, never deleted: the Someday
  // invariant has to hold either way, and destroying items nobody was asked
  // about is not a defensible default.
  function applyDemoteChoice(projectId, choice){
    const linked = linkedActionsForProject(projectId);
    const linkedEvents = (state.events || []).filter(function(ev){ return ev.linkedProjectId === projectId; });
    if (choice === "delete"){
      linked.forEach(function(l){ deleteTask(l.kind, l.task.id); });
      linkedEvents.forEach(function(ev){ deleteEventEntirely(ev); });
      return;
    }
    linked.forEach(function(l){ setLink(l.kind, l.task.id, null); });
    linkedEvents.forEach(function(ev){ ev.linkedProjectId = null; });
    if (linkedEvents.length){ saveEvents(); renderLane("next"); }
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
  // DEFENSIVE RENDERING (sync-audit.md §4c, chunk A). A card is bucketed by
  // its parent list, and renderLane only ever draws byParent[""] plus the
  // children of lists it actually found. So a card whose parent names a list
  // that ISN'T HERE lands in a bucket nothing draws: present in storage,
  // synced to both devices, and visible on neither.
  //
  // Before sync that could not happen — deleting a list through the UI clears
  // its children's parent first (see the delete-group handler), and the app
  // was the only writer, so it could keep its own promises. A merge can now
  // produce combinations no single device ever created: your copy of a card
  // plus the other device's deletion of the list it lived in. Sync turned this
  // app's own data into foreign input, and rendering has to stop trusting it.
  //
  // The fallback is not invented here — contextId has had exactly this net all
  // along ("loose / orphaned", renderLane), and dead habit hooks and orphaned
  // waiting conditions have their own. `parent` was the one reference with
  // none. An unresolvable parent now means "loose", which is where you would
  // look for it anyway.
  function buildTree(kind, list){
    const arr = list || state.tasks[kind];
    const groupIds = {};
    arr.forEach(function(t){ if (t.isGroup) groupIds[t.id] = true; });
    const byParent = {};
    arr.forEach(function(t){
      const key = (t.parent && groupIds[t.parent]) ? t.parent : "";
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
    return '<span class="deadline-push-chip" title="' + escapeHtml(n === 1 ? t("deadline.pushedOne") : t("deadline.pushedMany").replace("{n}", n)) + '">&#8635;' + n + '</span>';
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
          linkBlock = '<button class="project-jump" data-action="open-edit" data-kind="' + pKind + '" data-id="' + task.linkedProjectId + '" title="' + escapeHtml(t("project.openProject").replace("{title}", pTitle || "")) + '">&#128279;</button>';
        }
      } else {
        const title = findProjectTitle(task.linkedProjectId);
        linkBlock = '<button class="link-pill" data-action="open-edit" data-kind="' + kind + '" data-id="' + task.id + '">&#128279; ' + escapeHtml(title || "linked project") + '</button>';
      }
    }
    let cueBlock = "";
    if (isHabit && isRunPaused(habitRun)){
      // QA ruling: a paused habit's card shows the Paused pill and
      // NOTHING cue-related — no live hook pills, no fallback text, no
      // "No cue today", no "+ add plan". Cues describe when the habit
      // fires, and a paused habit doesn't fire; rendering them contradicts
      // the pause. The full cue set stays visible on the habit page. The
      // "New result" badge is a notification, not a cue — it still shows.
      cueBlock = '<span class="link-pill" style="opacity:0.7;">&#9208; ' + escapeHtml(pausedPillText(habitRun)) + '</span>';
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
      const pausedNow = isRunPaused(habitRun);
      checkboxHtml = '<button class="check' + (done ? " checked" : "") + (pausedNow ? " check-paused" : "") +
        '" data-action="toggle-habit" data-id="' + task.id +
        '" title="' + escapeHtml(pausedNow ? t("habit.pausedUnpause") : t("habit.markDoneToday")) + '">' + (done ? "&#10003;" : "") + '</button>';
    } else {
      checkboxHtml = '<button class="check" data-action="complete" data-id="' + task.id + '" title="' + escapeHtml(t("card.markComplete")) + '"></button>';
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
    const titleHtml = '<div class="card-title' + (done ? " done" : "") + '" ' + titleOpen + ' title="' + escapeHtml(t("card.tapToOpenReorder")) + '">' + escapeHtml(task.title) + '</div>';
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
  // An EMPTY list or context body used to be 11px of bottom padding and
  // nothing else — since the quick-add rows were removed there was literally
  // nothing on screen saying "this is where an item goes", and nothing big
  // enough to aim a finger at mid-drag. This row is that target: an inert
  // dashed slot the height of one card, so an empty list looks like a place
  // that can receive something and is as easy to hit as a real card.
  // pointer-events:none keeps it out of the way of the hit test (the drag
  // resolves to the .group-body behind it) and out of the way of taps.
  // It hides the moment a card is in the body — see .drop-hint in styles.css.
  function dropHintHtml(){
    return '<div class="drop-hint">' + escapeHtml(t("group.dropHint")) + '</div>';
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
    const deleteTitle = t("group.deleteList");
    const childrenHtml = children.map(function(c){ return leafCardHtml(kind, c); }).join("") || dropHintHtml();
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
    const childrenHtml = members.map(function(c){ return leafCardHtml(kind, c); }).join("") || dropHintHtml();
    return (
      // draggable + data-drag-group="1" reuse the list-group mechanics wholesale
      // (see groupHtml): applyLiveMove already pins anything flagged as a group
      // to the cards-root, which is exactly where a context group lives.
      // data-context-group stays as the discriminator commitLiveMove branches on.
      '<div class="group" draggable="true" data-context-group="' + ctx.id + '"' +
      ' data-drag-id="' + ctx.id + '" data-drag-parent="" data-drag-group="1">' +
        '<div class="group-header" data-action="toggle-group" data-id="' + ctx.id + '">' +
          '<span class="chevron">' + (collapsed ? "&#9656;" : "&#9662;") + '</span>' +
          // Same tooltip the list groups carry now that this one reorders too —
          // press-and-hold is not discoverable, and the tooltip is where the
          // app teaches it (CLAUDE.md: placeholders and tooltips carry the
          // teaching, there are no field labels).
          '<span class="group-title" title="' + escapeHtml(t("group.tapToExpandReorder")) + '">' + escapeHtml(ctx.name) + '</span>' +
          '<span class="count">' + members.length + '</span>' +
          '<button class="group-add" data-action="add-to-context" data-kind="' + kind + '" data-id="' + ctx.id + '" title="' + escapeHtml(t("group.addToContext")) + '">+</button>' +
          '<span class="group-actions">' +
            '<button class="icon-btn" data-action="delete-context" data-id="' + ctx.id + '" title="' + escapeHtml(t("group.deleteContext")) + '">&times;</button>' +
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
      sortedContexts().forEach(function(ctx){
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
          ? '<div class="lane-tools-row"><button class="btn btn-ghost btn-small tidy-btn" data-action="tidy-habits" type="button" title="' + escapeHtml(t("habit.tidyOrderTooltip")) + '">&#8645; ' + escapeHtml(t("habit.tidyOrder")) + '</button></div>'
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
  // THE PAGE SWAP (author, 2026-08-01: "I like option 1"). Arming a convert
  // re-renders the page AS the destination kind, with the destination's fields;
  // ✕ still discards; Save validates as the destination and only then moves the
  // item. It used to work this way, lost it to draft isolation, and the loss was
  // not followed through: Next → Waiting kept neither whenText nor conditionId
  // (a Next Action is forbidden both by §4.2), so the convert minted a Waiting
  // row with nothing to wait ON -- a state the Waiting page's own save gate
  // refuses, and which isWaitingOrphaned did not report either. The swap makes
  // it unreachable again: you supply the condition on the page before saving.
  //
  // The reason the old behaviour was rejected no longer holds -- that was
  // before projects had staging. A draft can hold a pending structural change
  // safely now (draft.staged does it for creates, links, detaches and deletes),
  // so a pending KIND is the same kind of promise.
  //
  // ⚑ s.kind is NOT touched. It is where the item still LIVES, and Save needs it
  // to know which lane to move out of, which lane to updateTask against, and
  // what to delete. Render paths ask viewKind; storage paths ask s.kind. Mixing
  // the two is the only real hazard in this design.
  function viewKind(s){
    if (!s) return null;
    // Page types that are not the action/project template at all: their kind is
    // structural, and none of them carry a convert.
    if (s.completedView || s.eventView || s.noteView || s.tagsView) return s.kind;
    return (s.draft && s.draft.convertTo) || s.kind;
  }
  // The other half of the pair -- for next↔waiting and current↔future, the kind
  // this page's single convert button points AT. On a swapped page that is the
  // origin, which is why the destination's own outgoing button doubles as the
  // "undo the conversion" control without any special case.
  function convertPartnerOf(kind){
    return kind === "next" ? "waiting" : kind === "waiting" ? "next"
         : kind === "current" ? "future" : kind === "future" ? "current" : null;
  }

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
          schedule: run.schedule.slice(), paused: isRunPaused(run),
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
      // ⚑ Both action kinds, not just Waiting (THE PAGE SWAP): a Next Action
      // converting to Waiting renders the "waiting for" row on the spot, and it
      // needs somewhere to put the answer. Priming these lazily at arm time
      // would work but would change the draft's SHAPE mid-page, which the
      // discard-warning fingerprint reads as an edit that arming-then-disarming
      // could never undo. A Next Action's stored record has neither field, so
      // they read back empty and saveScreen drops them by destination kind.
      if (isActionKind(kind)){
        draft.whenText = task.whenText || "";
        draft.conditionId = task.conditionId || null;
        draft.conditionKind = task.conditionKind || null;
        draft.conditionLabel = task.conditionLabel || null;
        draft.conditionPicker = false;
      }
    } else {
      draft = { title: "", notesClean: "", linkedProjectId: null, deadline: null, bundleText: "" };
      if (isActionKind(kind)) draft.contextId = (prefill && prefill.contextId) || null;
      if (isActionKind(kind)){
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
    // The drafting page is gone, so a merge deferred while it was open
    // (syncApplyGateOpen) can land now. Nothing was stashed to replay: the
    // merged bundle is already in the cloud, so an ordinary sync re-derives
    // and applies it. Cheap and self-limiting -- runDropboxSync() returns
    // immediately unless sync is actually connected.
    if (state.sync && state.sync.deferredApply){
      state.sync.deferredApply = false;
      runDropboxSync();
    }
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
  // `links` (W7): EXISTING actions and events being attached to this project.
  // The project page could always CREATE things into itself and never link
  // anything already in the app — the reverse direction existed (an action's
  // own page carries a project select) but not this one. Staged like every
  // other change on a drafting page, so ✕ discards the link and only Save
  // writes linkedProjectId onto the other item: DRAFT ISOLATION explicitly
  // covers "side effects on other items", and this is exactly that.
  // `unlinks` (W7): the way OUT of a project, which never existed. §12.1's own
  // comment said "you remove it from the project's own list instead" and
  // described a control nobody had built -- so detaching an action was only
  // possible by completing or deleting it, and once Complete and Delete are
  // blocked for linked items (author's ruling) an action could check into a
  // project and never leave. Staged like everything else here.
  function newStagedSet(){ return { creates: [], edits: {}, deletes: {}, completes: {}, noteCreates: [], eventCreates: [], links: [], unlinks: [] }; }
  function stagedLinks(s){ return (s && s.draft && s.draft.staged && s.draft.staged.links) || []; }
  function stagedUnlinks(s){ return (s && s.draft && s.draft.staged && s.draft.staged.unlinks) || []; }
  // An item opened from a project's linked list, that the project ALREADY has
  // -- as opposed to one created on this page and not yet saved. Complete and
  // Delete are withheld for these (author's ruling): they are pre-existing
  // items reached sideways, and destroying one from inside a project draft you
  // might still ✕ out of is not what "open" should offer. Fields stay editable.
  //
  // A staged create is deliberately NOT covered by the DELETE half: its row
  // carries no ✕ of its own, so Delete is the only way to take back a mis-added
  // action, and withholding it would strand the row until you discarded the
  // whole page. Once saved it becomes an ordinary linked item and loses Delete
  // on the next open, which is the direction the ruling wants.
  //
  // ⚑ The exemption is DELETE-ONLY (author: "it also has a complete button
  // which shouldn't be there"). One predicate used to gate both, so a staged
  // create got Delete *and* Complete. Nothing reached through a project's
  // linked list is completable — staged or live — so the two gates ask
  // different questions and are two functions now.
  function openedFromProjectList(s){
    if (!s || !s.staging || !s.draft) return false;
    return s.draft.linkedProjectId === s.staging.projectId;
  }
  function openedAsProjectMember(s){
    if (!openedFromProjectList(s)) return false;
    return !stagedCreate(s.staging.parent, s.taskId);
  }
  function stagedLinkedEventIds(s){
    return stagedLinks(s).filter(function(l){ return l.kind === "event"; }).map(function(l){ return l.id; });
  }
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
    // A staged LINK is a way forward too. §4.3's gate blocks saving a new
    // Current project with nothing to do next, and an action you just attached
    // is as much a next step as one you just typed — refusing to save there
    // would be the gate reading its own bookkeeping instead of the project.
    if (stagedLinks(s).length) return true;
    const pid = stagingProjectId(s);
    return !!(pid && typeof projectHasLinkedEvent === "function" && projectHasLinkedEvent(pid));
  }
  function projectDraftLinked(s){
    const pid = stagingProjectId(s);
    const staged = s.draft.staged || newStagedSet();
    const out = [];
    const unlinked = {};
    (staged.unlinks || []).forEach(function(u){ unlinked[u.id] = true; });
    linkedActionsForProject(pid).forEach(function(l){
      if (staged.deletes[l.task.id] || staged.completes[l.task.id]) return;
      if (unlinked[l.task.id]) return; // staged detach: gone from the list, still in its lane
      const ed = staged.edits[l.task.id];
      const task = ed ? Object.assign({}, l.task, ed) : l.task;
      out.push({ kind: (ed && ed.kind) || l.kind, task: task });
    });
    (staged.creates || []).forEach(function(c){
      if (c.stagedComplete) return;
      out.push({ kind: c.kind, task: Object.assign({}, c) });
    });
    // Staged LINKS render in the list immediately, so attaching something and
    // looking back at the list shows it there -- otherwise the button appears
    // to do nothing until Save. Marked stagedLink so the row can carry a ✕
    // that un-attaches it: without one a mis-tap could only be undone by ✕-ing
    // the whole page, which throws away every other edit too.
    (staged.links || []).forEach(function(lk){
      if (lk.kind === "event") return; // events render in their own dated band
      const found = findTaskAnywhere(lk.id);
      if (!found) return; // deleted from under us since it was picked
      out.push({ kind: found.kind, task: found.task, stagedLink: true });
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
      if ((staged.links || []).length) return true;   // W7: attaching something is a real edit to discard
      if ((staged.unlinks || []).length) return true; // ...and so is detaching one
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
    const pid = stagingProjectId(s); // the id staged links are written against
    const touched = [];
    (staged.creates || []).forEach(function(c){
      const task = Object.assign({}, c);
      const kind = task.kind;
      delete task.kind; delete task.stagedComplete;
      state.tasks[kind].unshift(task);
      touched.push(task.id);
    });
    // W7 -- staged LINKS become real here, and only here. Written by id
    // wherever the item now lives (the §9 zombie trap: an action can have been
    // promoted from Waiting to Next while this page was open). Re-checked
    // rather than trusted: the picker only offered UNLINKED items, but that was
    // when it was picked, and the other device -- or the other lane -- may have
    // linked it since. Last writer wins would silently steal it from a project
    // this screen never mentioned, which is the exact thing excluding
    // already-linked items from the picker exists to prevent.
    let linkedAnything = false;
    (staged.links || []).forEach(function(lk){
      if (lk.kind === "event"){
        const ev = findEvent(lk.id);
        if (!ev || ev.linkedProjectId) return;
        ev.linkedProjectId = pid;
        linkedAnything = true;
        return;
      }
      const found = findTaskAnywhere(lk.id);
      if (!found || found.task.linkedProjectId) return;
      found.task.linkedProjectId = pid;
      touched.push(lk.id);
      linkedAnything = true;
    });
    // ...and staged DETACHES. The item itself is untouched beyond losing the
    // link -- it stays in its lane, keeps its edits, keeps its history. This is
    // "remove from project", never "delete".
    (staged.unlinks || []).forEach(function(u){
      if (u.kind === "event"){
        const ev = findEvent(u.id);
        if (ev && ev.linkedProjectId === pid){ ev.linkedProjectId = null; linkedAnything = true; }
        return;
      }
      const found = findTaskAnywhere(u.id);
      if (found && found.task.linkedProjectId === pid){
        found.task.linkedProjectId = null;
        touched.push(u.id);
        linkedAnything = true;
      }
    });
    if (linkedAnything){
      saveEvents();
      KINDS.filter(isActionKind).forEach(saveTasksLocal);
    }
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
    //
    // DESKTOP ONLY (author's correction, 2026-07-29 — desktop-redesign-plan.md
    // §5 originally read as universal and was built that way by mistake). The
    // reason this exists at all is desktop-specific: Done sits bottom-right and
    // ✕ sits top-right on the desktop card, close enough that an accidental
    // click needs a second chance. On the phone, ✕ and the drafting page it
    // closes are already opposed enough (a corner control acting against the
    // whole screen behind it) that the extra confirm is friction, not safety —
    // draft isolation's own invariant (✕ always discards, nothing ever commits
    // early) already makes an accidental tap harmless to *undo the undo of*,
    // there was just never anything saved to lose.
    if (state.desktop && screenDirty(s)){
      openConfirmDialog(t("discard.message"), [
        { label: t("discard.yes"), style: "danger", action: function(){ closeScreen(); } },
        { label: t("discard.no"), action: function(){} }
      ]);
      return;
    }
    closeScreen();
  }
  // §4.6 Back/Escape resolution order: dialog → drawer → page → exit. Shared
  // by the Escape key (below, browser + Electron) and the Android hardware
  // back button (wrapper's MainActivity.onBackPressed calls
  // window.__oelaHandleBack — wrapper-plan.md §5) so the two triggers can
  // never drift apart. Returns whether something was closed/cancelled;
  // false means "nothing left to intercept" — Escape does nothing further,
  // and Android falls through to its own default (exit the lanes, per the
  // author's ruling that back in the lanes needs no extra guard).
  function handleBackOrEscape(){
    // ▲ DESKTOP (trap T17): a header dropdown slots in FRONT of all of it. A
    // back/Escape aimed at a stray open menu must never travel through to
    // the half-edited page behind it.
    if (closeHeaderDrops()) return true;
    if (qs(".choice-dialog-backdrop")){ closeDialog(); return true; }
    if (state.trayOpen){ closeTray(); return true; }
    if (state.screen){ attemptCancelScreen(); return true; } // §12.1: project ✕-warning on every exit route
    return false;
  }
  window.__oelaHandleBack = handleBackOrEscape; // wrapper-only hook; unused and harmless in a browser tab
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
    // THE PAGE SWAP: with a convert armed the page IS the destination kind, so
    // Save validates and shapes the record as the destination. That is the whole
    // point of the swap — Next → Waiting with nothing to wait on is now blocked
    // with the dashed outline, on a page that has the field to fix it in,
    // instead of silently landing condition-less in the Waiting lane.
    // s.kind remains the lane the item is being moved OUT of, which is what
    // updateTask, deleteTask and changeKind all still read.
    // Complete wins if both somehow armed — the UI's mutual exclusion prevents
    // it, and the convert site below carries the same defensive precedence.
    const effKind = s.draft.willComplete ? s.kind : viewKind(s);
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
    // ⚑ effKind: the rule is per-LANE, so a convert must be checked against the
    // lane it is landing in, not the one it is leaving. (Behaviour change,
    // flagged: converting onto a title that already exists in the destination
    // lane is now blocked where it used to go through and make a duplicate.)
    const dupe = state.tasks[effKind].some(function(t){
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
            // W7: superseded, never removed — same assertion record the
            // checkbox writes (see toggleHabit). Un-completing from the page
            // is every bit as deliberate as un-ticking on the card.
            state.habitDone[s.taskId] = { date: todayStr(), state: wantDone ? "done" : "cleared", at: Date.now() };
            if (wantDone){
              state.habitDoneOrder.unshift(s.taskId);
            } else {
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
          if (isRunPaused(run) !== nowPaused){
            const today = todayStr();
            if (nowPaused){
              // About to pause. lastProcessedDate jumping to today means
              // today never passes through the normal boundary sweep
              // again — a completion already earned today must be locked
              // into history now, or it's lost the moment pause lands. A
              // day merely unfinished when paused is fine to skip —
              // that's what Pause is for.
              //
              // W7: keyed on the ASSERTION, not on the bare presence of a
              // tick, so tick → un-tick → pause no longer resurrects the
              // tick. The stamp rides into history with it, which is what
              // lets the other device's copy of this day be compared
              // against it later. The day pause begins is inside the range
              // ([from, to)), and the replay lets an asserted done outrank
              // the pause — which is exactly why this lock-in still works.
              const scheduledToday = run.schedule.indexOf(boundaryNow().getDay()) !== -1;
              const alreadyRecorded = run.history.some(function(e){ return e.date === today; });
              const a = habitAssertionFor(s.taskId, today);
              if (scheduledToday && a && a.state === "done" && !alreadyRecorded){
                applyHabitDayOutcome(run, today, "done", a.at || 0);
              }
              openPausedRange(run, today);
            } else {
              // Resuming: the range closes at today, and [from, to) means
              // today is outside it — you are back, so today counts.
              closePausedRanges(run, today);
            }
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

    // ⚑ effKind, not s.kind: a Next Action with "Make Waiting" armed is saved
    // through this gate, which is what makes the condition mandatory before the
    // conversion can happen at all.
    if (effKind === "waiting"){
      const d = s.draft;
      // Enforce mutual exclusivity at save time (§4.2 -- text vs. hook; the
      // date option is gone as of chunk 3, §4.13a). A hooked condition wins
      // over free text, and a Waiting action never carries a deadline.
      d.deadline = null;
      if (d.conditionId){ d.whenText = ""; }
      // ⚑ BUG FIX (author): this ran even with Complete armed, so a waiting
      // action with an empty/cleared condition could never be completed --
      // Save just re-rejected it as an invalid edit. A completing item is
      // being retired, not kept alive on some ongoing wait; it needs no
      // condition at all. Skip the requirement when willComplete is armed.
      if (!d.willComplete && !d.conditionId && !(d.whenText || "").trim()){
        s.invalidField = "waitingFor";
        renderScreen();
        return;
      }
    }

    const data = {
      title: title, notesClean: s.draft.notesClean, linkedProjectId: s.draft.linkedProjectId, deadline: s.draft.deadline,
      // ⚑ effKind throughout: the record is shaped for where it is GOING. The
      // condition collected on a swapped-to-Waiting page is written onto the
      // still-in-Next record here, and changeKind (which keeps whenText and the
      // condition when the destination is Waiting) carries it across a moment
      // later. Shaping by s.kind instead is exactly how the old convert lost it.
      whenText: effKind === "waiting" ? ((s.draft.whenText || "").trim() || null) : null,
      conditionId: effKind === "waiting" ? s.draft.conditionId : null,
      conditionKind: effKind === "waiting" ? s.draft.conditionKind : null,
      conditionLabel: effKind === "waiting" ? s.draft.conditionLabel : null,
      bundleText: isActionKind(effKind) ? ((s.draft.bundleText || "").trim() || null) : null,
      contextId: isActionKind(effKind) ? (s.draft.contextId || null) : null,
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
        // new lane. No dialog can fire from here any more: the only one
        // convert ever had (the Someday-can't-hold-this warning) now fires
        // at the tap and arrives here as a staged choice.
        commitConvert(s, kind, convertTo, taskId);
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
      // ⚑ AFTER applyProjectStaging, deliberately: the demote's linked set is
      // recomputed inside commitConvert, so an action staged onto this project
      // in the same draft is included in the unlink-or-delete the user chose.
      if (convertTo){ commitConvert(s, s.kind, convertTo, s.taskId); return; }
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
  //
  // THE PAGE SWAP (author, 2026-08-01): arming also re-renders the page as the
  // destination kind (see viewKind). Nothing else about the contract moves —
  // still draft-only, still applied at Save, still discarded by ✕.
  function screenMakeKind(destKind){
    const s = state.screen;
    if (!s || !s.taskId) return;
    // Completed page: convert buttons are greyed + inert (§12.2 step 5) —
    // restore first. Backstop for the disabled rendering.
    if (s.completedView) return;
    // DISARM FIRST, before any guard below. On a swapped page this button is
    // the only way BACK, so nothing may be allowed to strand the user on the
    // destination — and none of the arming guards make sense for an undo.
    if (s.draft.convertTo === destKind){
      s.draft.convertTo = null;
      // Author: "I'm fine with throwing up the dialogue again if the user swaps
      // back and forth." A minute-old answer to a question about OTHER items is
      // not consent for a conversion you re-armed after changing your mind.
      s.draft.demoteChoice = null;
      renderScreen();
      return;
    }
    // MUTUAL EXCLUSION (user ruling): an armed Complete disables the
    // convert buttons — disarm Complete first. Mirror of the guard in
    // screenComplete.
    if (s.draft.willComplete) return;
    // §4.13a (chunk 3): "Make Waiting" is inert while a deadline is set --
    // backstop for the greyed button (which has no disabled attribute).
    if (destKind === "waiting" && s.draft.deadline && s.draft.deadline.date) return;
    // Author's ruling: the Someday-can't-hold-this warning moves off Save and
    // onto THIS TAP, "because that is when the decision is made". Its answer is
    // STAGED, not acted on — see askDemoteChoice.
    if (destKind === "future" && s.kind === "current"){
      askDemoteChoice(s.taskId, function(choice){
        if (!choice) return; // Cancel: the convert stays unarmed, no page swap
        s.draft.demoteChoice = choice;
        s.draft.convertTo = destKind;
        renderScreen();
      });
      return;
    }
    s.draft.convertTo = destKind;
    renderScreen();
  }
  // The committer both save paths share. Nothing here ASKS anything — the only
  // dialog convert has left fires at the tap (askDemoteChoice) and arrives here
  // as draft.demoteChoice. Runs after the page's own edits have landed, so a
  // rename made in this draft is what appears in the new lane.
  function commitConvert(s, fromKind, toKind, taskId){
    if (toKind === "future" && fromKind === "current"){
      applyDemoteChoice(taskId, s.draft.demoteChoice || null);
    }
    return changeKind(fromKind, toKind, taskId).then(closeScreen);
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
  // ⚑ The comment that used to sit here said pause "takes effect immediately
  // (like a switch), not gated behind Save" — flatly contradicting the body
  // below and the DRAFT ISOLATION ruling that superseded it. Left over from
  // the pause/completion round, which moved the run-side work into saveScreen
  // and did not clear the header. Corrected, not deleted, so the next reader
  // doesn't have to work out which of the two comments was true.
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
    const eventRows = projectLinkedEventRowsHtml(stagingProjectId(s), stagedEventCreates(s),
                                                stagedLinkedEventIds(s),
                                                stagedUnlinks(s).map(function(u){ return u.id; }));
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
      const rowBtn = '<button type="button" class="linked-action-item' + (depth > 0 ? " indented" : "") + '" ' + open + (depth > 1 ? ' style="margin-left:' + (depth * 22) + 'px;"' : '') + '>' +
        kindDot(l.kind) + escapeHtml(l.task.title) +
      '</button>';
      // A staged (not yet saved) link carries its own ✕ so a mis-tap can be
      // undone without ✕-ing the whole page and losing every other edit. Live
      // links deliberately do NOT get one -- removing something already in the
      // project goes through its own page, which is the existing contract.
      // Wrapped in a row rather than nesting the ✕ inside the open button,
      // which would be a button inside a button.
      // Every row that is IN the project gets a ✕ now: staged links drop the
      // staged link, live ones stage a detach. Staged CREATES keep their Delete
      // instead -- a thing that does not exist yet cannot be "removed from the
      // project", it can only not be created.
      const isStagedCreate = !!stagedCreate(s, l.task.id);
      html += (l.stagedLink || (!isStagedCreate && !l.external))
        ? '<div class="linked-action-row">' + rowBtn +
            '<button type="button" class="chip-x" data-action="' + (l.stagedLink ? "unstage-link" : "unlink-linked") + '" data-id="' + l.task.id + '" title="' + escapeHtml(t("project.removeFromProject")) + '">&times;</button>' +
          '</div>'
        : rowBtn;
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
        // W7: the missing half. Every button beside it CREATES; this one
        // attaches something that already exists.
        '<button type="button" class="btn btn-ghost btn-small project-add-note" data-action="open-link-picker">' + escapeHtml(t("project.linkExisting")) + '</button>' +
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
    sortedContexts().forEach(function(c){
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
  function habitPauseBtnHtml(draft, taskId){
    // The since-line reports the SAVED run, never the draft (DRAFT
    // ISOLATION): a pause armed but not yet saved has no range and no start
    // date to name, and claiming one would be the page asserting something
    // \u2715 is still able to discard. So it appears only once the bracket is
    // really open \u2014 which is also the moment it starts being worth seeing.
    const run = taskId ? state.habitRuns[taskId] : null;
    const since = run && isRunPaused(run)
      ? '<span class="habit-paused-since">' + escapeHtml(pausedPillText(run)) + '</span>'
      : '';
    return (
      '<div class="screen-row">' +
        '<button type="button" class="btn btn-ghost btn-small habit-pause-btn' + (draft.paused ? " active" : "") + '" data-action="screen-toggle-pause">' +
          (draft.paused ? "\u25B6 " + escapeHtml(t("habit.unpause")) : "\u23F8 " + escapeHtml(t("habit.pause"))) +
        '</button>' + since +
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
  // What the "Link existing" picker offers (W7).
  //
  // ⚑ UNLINKED ONLY — author's ruling. An action already belonging to another
  // project is excluded rather than moved. Moving one remains possible from the
  // action's own page, which has a project select and names the project you are
  // moving it out of; doing it from HERE would silently empty a project this
  // screen never mentions, and could leave it stalled, with nothing on screen
  // saying so. Nothing is lost — only the quiet path to it.
  //
  // Also excluded: group rows (not actions), anything already linked here,
  // anything already staged as a link, and staged creates (they are in the list
  // already and are not yet real).
  // Pure, so BOTH surfaces that offer this share one definition of eligible --
  // the project page and the review's stalled card. Two copies of "which items
  // can be linked" is exactly how the two would drift apart.
  function linkTargetsFor(pid, excludeIds){
    const skip = {};
    (excludeIds || []).forEach(function(id){ skip[id] = true; });
    const out = { actions: [], events: [] };
    ["next", "waiting"].forEach(function(k){
      state.tasks[k].forEach(function(t){
        if (t.isGroup || t.linkedProjectId || skip[t.id]) return;
        if (pid && t.id === pid) return;
        out.actions.push({ kind: k, task: t });
      });
    });
    (state.events || []).forEach(function(ev){
      if (ev.linkedProjectId || skip[ev.id]) return;
      out.events.push(ev);
    });
    return out;
  }
  function linkTargetsForScreen(s){
    return linkTargetsFor(stagingProjectId(s), stagedLinks(s).map(function(l){ return l.id; }));
  }
  // The grouped list itself, in the shared picker language. Takes the action
  // and any extra attributes so the two surfaces can route their picks
  // differently while looking and grouping identically.
  function linkPickListHtml(targets, action, extraAttr){
    function itemBtn(id, kind, title, hint){
      return '<button type="button" class="screen-hook-pick-item" data-action="' + action + '" ' +
        'data-id="' + escapeHtml(id) + '" data-link-kind="' + kind + '"' + (extraAttr || "") + '>' +
        kindDot(kind === "event" ? "event" : kind) + escapeHtml(title) +
        (hint ? ' <span class="cal-agenda-kind">' + escapeHtml(hint) + '</span>' : "") +
      '</button>';
    }
    function group(label, rows){
      return rows.length ? '<div class="screen-hook-pick-label">' + escapeHtml(label) + '</div>' +
        '<div class="screen-hook-pick-list">' + rows.join("") + '</div>' : "";
    }
    const eventRows = targets.events.map(function(ev){
      const d = dateStrToDate(effDate(ev, ev.date));
      // project.untitled, not an invented cal.untitledEvent: that key does not
      // exist, and t() returns the KEY when it misses -- so an unnamed event
      // would have rendered the literal string "cal.untitledEvent" in the
      // picker, in both languages. project.untitled is what the linked-notes
      // list already uses for exactly this.
      return itemBtn(ev.id, "event", ev.title || t("project.untitled"),
                     d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    });
    const nextRows = targets.actions.filter(function(a){ return a.kind === "next"; })
      .map(function(a){ return itemBtn(a.task.id, "next", a.task.title, null); });
    const waitRows = targets.actions.filter(function(a){ return a.kind === "waiting"; })
      .map(function(a){ return itemBtn(a.task.id, "waiting", a.task.title, null); });
    const body = group(t("picker.conditionNextActions"), nextRows) +
                 group(t("picker.conditionWaitingActions"), waitRows) +
                 group(t("picker.conditionUpcomingEvents"), eventRows);
    // Empty state is a teaching surface, not an error (§12.1b): "unlinked only"
    // is a rule the user cannot see from a blank list and would read as a bug.
    return body || '<div class="empty-note">' + escapeHtml(t("project.nothingToLink")) + '</div>';
  }
  // ⚑ THE SHARED PICKER LANGUAGE (author: "we settled on a unified style for
  // the pickers"). Same wrapper, label/list/item classes and Back row the hook
  // and condition pickers use -- this asks the same kind of question ("which
  // existing item?"), so a second look for it would be a new thing to learn for
  // nothing. An earlier draft reused the linked-list classes and quietly became
  // a third style.
  function linkPickerHtml(s){
    return (
      '<div class="pick-body">' +
        '<div class="screen-hook-pick-label">' + escapeHtml(t("project.linkExistingTitle")) + '</div>' +
        linkPickListHtml(linkTargetsForScreen(s), "pick-link", "") +
        '<div class="screen-row" style="margin-top:8px;"><button type="button" class="btn btn-ghost btn-small" data-action="screen-cancel-link-pick">' + escapeHtml(t("picker.back")) + '</button></div>' +
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
    // W7 (author): withheld for an item the project already has, opened from
    // its linked list. Kept for a staged create, whose row has no ✕ and for
    // which Delete is the only take-back. See openedAsProjectMember.
    const showDelete = !!s.taskId && !openedAsProjectMember(s);
    // Event pages read "Appointment" once a time is set (§4.14 — the time is
    // the only thing that distinguishes the two; they are not separate types).
    // ⚑ viewKind, not s.kind: with a convert armed the page IS the destination
    // (the page swap), and the badge is the loudest thing that says so.
    const badge = s.eventView ? (s.draft && s.draft.time ? t("badge.appointment") : t("badge.event")) : KIND_BADGE_LABEL[viewKind(s)];
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
  // The drafting page's single convert button, under THE PAGE SWAP.
  //
  // Each call site names the partner of the kind IT renders (next→waiting,
  // waiting→next, current→future, future→current). With a convert armed the
  // page has already swapped, so the branch running is the destination's and
  // its partner is where we came FROM -- but the button must stay pointed at
  // the armed destination, or tapping it would arm a second conversion instead
  // of undoing the first. So: armed ⇒ data-dest is draft.convertTo, and
  // screenMakeKind reads that as "disarm". The label is ignored when armed
  // (makeKindBtnHtml renders "✓ Converting to X on save" instead), which is why
  // the destination branch's own wording never leaks through.
  function screenConvertBtnHtml(s, partner, label, arrow, disabled, disabledTitle){
    // ⚑ NOT on a child page opened from a project (W7's "reached sideways"
    // ruling, which already withholds Complete and Delete there). This button
    // was ALREADY inert on those pages -- saveScreen hands a staging page to
    // stageChildSave, which returns long before the convert branch, so arming
    // one and saving did nothing at all. Under the page swap an inert control
    // stops being harmless: the page would swap, invite a condition, and stage
    // it onto a record whose kind never changed -- a Next Action carrying a
    // condition, which §4.2 forbids. Removing the control is the simplest
    // option and the one the spec's silence points at; the item's own page,
    // opened from its lane, still converts it.
    if (s.staging) return "";
    const armed = !!(s.draft && s.draft.convertTo);
    return makeKindBtnHtml(armed ? s.draft.convertTo : partner, label, arrow, armed,
      !armed && !!disabled, disabledTitle);
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
    // ⚑ THE PAGE SWAP: this whole function renders the kind the page is SHOWING,
    // which is the armed convert's destination when there is one. s.kind is
    // untouched underneath (see viewKind) and is what Save reads.
    const draft = s.draft, kind = viewKind(s);
    // §12.1: lock the project link when this action is opened as a child of
    // the project it actually belongs to (membership, not provenance).
    const linkLocked = !!(s.staging && draft.linkedProjectId && draft.linkedProjectId === s.staging.projectId);

    if (kind === "habit" && draft.hookPicker){
      return '<div class="screen-body">' +
        '<input type="text" class="screen-field-title" data-field="title" placeholder="' + escapeHtml(TITLE_PLACEHOLDER[kind]) + '" value="' + escapeHtml(draft.title) + '" readonly>' +
        habitHookPickerHtml(s) +
      '</div>';
    }
    // W7: the link picker takes over the project page the same way the hook and
    // condition pickers take over theirs -- the title stays visible and read-only
    // so you can see which project you are attaching to.
    if (isProjectKind(kind) && draft.linkPicker){
      return '<div class="screen-body">' +
        '<input type="text" class="screen-field-title" data-field="title" placeholder="' + escapeHtml(TITLE_PLACEHOLDER[kind]) + '" value="' + escapeHtml(draft.title) + '" readonly>' +
        linkPickerHtml(s) +
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
        convertHtml += screenConvertBtnHtml(s, "waiting", t("outcome.makeWaiting"), "right",
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
      if (s.taskId) convertHtml += screenConvertBtnHtml(s, "next", t("outcome.makeNext"), "left", !!draft.willComplete);
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
        if (s.taskId) convertHtml += screenConvertBtnHtml(s, "future", t("outcome.makeFuture"), "", !!draft.willComplete);
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
        // the one part that cannot carry over: the demote warning exists
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
        if (s.taskId) convertHtml += screenConvertBtnHtml(s, "current", t("outcome.makeCurrent"), "", !!draft.willComplete);
      }
    } else if (kind === "habit"){
      fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="' + escapeHtml(t("habit.identityPlaceholder")) + '">' + escapeHtml(draft.notesClean) + '</textarea>';
      fields += habitWhenFieldsHtml(draft, s.invalidField === "habitWhen");
      fields += habitScheduleHtml(draft, s.invalidField === "habitSchedule");
      fields += advancedRowHtml(draft);
      if (s.taskId){
        fields += habitPauseBtnHtml(draft, s.taskId);
        fields += habitTrackHtml(s);
      }
    }

    let completeHtml = "";
    // W7: no Complete either, for the same reason and by the same ruling --
    // an item reached sideways through a project draft should not be
    // completable from inside a page you might still ✕ out of.
    if ((kind === "next" || kind === "waiting" || isProjectKind(kind)) && s.taskId && !openedFromProjectList(s)){
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
          ? calendarHeaderHtml(s) + calendarInfoPanelHtml(!!s.calInfoOpen) + calendarBodyHtml(s)
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
      // ⚑ THE PAGE SWAP: arming a convert re-renders in place (the key holds
      // s.kind, deliberately — a rebuild would replay the slide-in and throw
      // away the scroll position for what is a change of fields, not of item).
      // The lane accent and data-kind live on the OVERLAY, which the in-place
      // branch never touched, so without this the page swapped its fields and
      // kept the old lane's colour.
      existing.setAttribute("data-kind", viewKind(s));
      existing.style.setProperty("--lane-accent", "var(" + accentVarForKind(viewKind(s)) + ")");
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
    root.innerHTML = '<div class="screen-overlay" data-kind="' + viewKind(s) + '" data-screen-key="' + key + '" style="--lane-accent:var(' + accentVarForKind(viewKind(s)) + ')">' +
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
      const placeholder = (kind === "current" || kind === "future")
        ? t("placeholder.listName") : t("placeholder.contextName");
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
      const revLinkPick = e.target.closest('[data-action="review-link-pick"]');
      if (revLinkPick){
        const s = state.screen;
        // The project rides on the ROW (data-project), not looked up from the
        // card key: data-id is already spoken for by the item being linked, and
        // every other button on this card carries its target the same way.
        const pid = revLinkPick.getAttribute("data-project");
        const id = revLinkPick.getAttribute("data-id");
        if (pid && id){
          if (revLinkPick.getAttribute("data-link-kind") === "event"){
            const ev = findEvent(id);
            if (ev && !ev.linkedProjectId){ ev.linkedProjectId = pid; saveEvents(); }
          } else {
            const found = findTaskAnywhere(id);
            if (found && !found.task.linkedProjectId){
              found.task.linkedProjectId = pid;
              saveTasksLocal(found.kind);
            }
          }
          KINDS.filter(isActionKind).forEach(renderLane);
          renderLane("current");
        }
        if (s) s.reviewForm = null;
        renderScreen();
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
      const revDeleteEventMissed = e.target.closest('[data-action="review-delete-event-missed"]');
      if (revDeleteEventMissed){ reviewDeleteEventById(revDeleteEventMissed.getAttribute("data-id")); return; }
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
        const name = group ? group.title : t("confirm.thisList");
        const affected = state.tasks[kind].filter(function(t){ return t.parent === groupId && !t.isGroup; }).length;
        const msg = (affected
          ? (affected === 1 ? t("confirm.deleteListOne")
                            : t("confirm.deleteListMany").replace("{n}", affected))
          : t("confirm.deleteListEmpty")).replace("{name}", name);
        openConfirmDialog(msg, [
          { label: t("group.deleteList"), style: "danger", action: function(){
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
        const msg = (affected
          ? (affected === 1 ? t("confirm.deleteContextOne")
                            : t("confirm.deleteContextMany").replace("{n}", affected))
          : t("confirm.deleteContextEmpty")).replace("{name}", ctx.name);
        openConfirmDialog(msg, [
          { label: t("group.deleteContext"), style: "danger", action: function(){
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
        // ⚑ A PROJECT completes through completeProject(), exactly as its own
        // page and the review already do (user ruling: both routes behave the
        // same). This checkbox used to call completeTask() straight through,
        // which skipped the confirm AND the archiving — so ticking a project
        // here left its linked waiting actions live and its linked events
        // still minting a Next Action every week, for ever. That is the very
        // failure the comment on archiveEventsForProject describes as fixed;
        // the fix had only ever landed on the other path.
        //
        // The tick still plays — it just waits until completion is actually
        // going ahead (user: "we don't want to deny the pop of satisfaction
        // just because there's a complication"). So: confirm first, THEN tick,
        // then complete. Cancelling never reaches the tick at all.
        if (isProjectKind(k)){
          completeProject(k, id, function(finish){
            // The lane is not re-rendered while a dialog is open, so the button
            // is normally still on screen here — but if anything did detach it,
            // animating a node nobody can see must not also stall the finish.
            if (completeBtn.classList.contains("checked") || !completeBtn.isConnected){ finish(); return; }
            completeBtn.classList.add("checked", "check-anim");
            completeBtn.innerHTML = "&#10003;";
            setTimeout(finish, 260);
          });
          return;
        }
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
          n === 1 ? t("confirm.deleteAllCompletedOne")
                  : t("confirm.deleteAllCompletedMany").replace("{n}", n),
          [
            { label: t("confirm.deleteAll"), style: "danger", action: function(){ clearCompleted(kind); } },
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
        if (isRunPaused(ensureHabitRun(habitId))) return;
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
        openConfirmDialog(t("confirm.deleteCompletedItem"), [
          { label: t("chrome.delete"), style: "danger", action: function(){ deleteCompleted(kind, id); closeScreen(); } },
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
      // W7 -- the link-existing picker. A sub-view of THIS page, not a new
      // screen: nothing is committed, so there is nothing to come back from.
      if (e.target.closest('[data-action="open-link-picker"]')){
        if (!state.screen || !state.screen.draft) return;
        state.screen.draft.linkPicker = true;
        renderScreen();
        return;
      }
      if (e.target.closest('[data-action="screen-cancel-link-pick"]')){
        if (!state.screen || !state.screen.draft) return;
        state.screen.draft.linkPicker = false;
        renderScreen();
        return;
      }
      const pickLinkBtn = e.target.closest('[data-action="pick-link"]');
      if (pickLinkBtn){
        const s = state.screen;
        if (!s || !s.draft) return;
        s.draft.staged = s.draft.staged || newStagedSet();
        s.draft.staged.links.push({ id: pickLinkBtn.getAttribute("data-id"),
                                    kind: pickLinkBtn.getAttribute("data-link-kind") });
        // Straight back to the list, so the thing you just attached is visible
        // where it will live. Picking one at a time is deliberate: the list is
        // what tells you what you have done, and a multi-select would hide it.
        s.draft.linkPicker = false;
        if (s.invalidField === "projectActions") s.invalidField = null;
        renderScreen();
        return;
      }
      const unstageLinkBtn = e.target.closest('[data-action="unstage-link"]');
      if (unstageLinkBtn){
        const s = state.screen;
        if (!s || !s.draft || !s.draft.staged) return;
        const id = unstageLinkBtn.getAttribute("data-id");
        s.draft.staged.links = s.draft.staged.links.filter(function(l){ return l.id !== id; });
        renderScreen();
        return;
      }
      // Detaching something the project ALREADY has. Staged, not immediate:
      // ✕-ing the page must put it back, like every other change here.
      const unlinkBtn = e.target.closest('[data-action="unlink-linked"]');
      if (unlinkBtn){
        const s = state.screen;
        if (!s || !s.draft) return;
        s.draft.staged = s.draft.staged || newStagedSet();
        const id = unlinkBtn.getAttribute("data-id");
        if (!s.draft.staged.unlinks.some(function(u){ return u.id === id; })){
          s.draft.staged.unlinks.push({ id: id, kind: findEvent(id) ? "event" : "action" });
        }
        renderScreen();
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
      handleBackOrEscape();
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
    // The rule above says *between which two cards* the item lands; this says
    // *which list or context has caught it*, which is the part that was
    // invisible for an empty group (user: "nor is it clear when it's been
    // captured by the list/context"). Purely a class swap — the styles it
    // drives are outline/background/border-colour only, never geometry, so
    // marking a zone can never move what's under the finger mid-drag.
    // cards-root is deliberately excluded: "loose at the top level" is the
    // absence of a list, and outlining the whole lane would be noise.
    let dropZoneEl = null;
    function setDropZone(zone){
      const next = (zone && zone.classList && !zone.classList.contains("cards-root")) ? zone : null;
      if (dropZoneEl === next) return;
      if (dropZoneEl) dropZoneEl.classList.remove("drop-zone-active");
      dropZoneEl = next;
      if (dropZoneEl) dropZoneEl.classList.add("drop-zone-active");
    }
    // Teardown for both cues. Called from every path that ends a drag —
    // dragend, touchend, touchcancel and the watchdog's force-cancel — so a
    // highlight can't outlive the gesture that drew it.
    function clearDropCues(){ clearDropIndicator(); setDropZone(null); }
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
      // The innermost enclosing dropzone IS the answer, in every case — over a
      // card it is that card's container, over a group's header it is the root
      // (so hovering a list's header drops BESIDE the list, as it should), and
      // over a list's body it is that list.
      //
      // ⚑ This used to special-case "the pointer is over some card" and take
      // that card's PARENT's dropzone, which quietly made an empty list
      // undroppable: with no card in the body, the hit resolves to the
      // .group-body, whose own closest [data-drag-id] is the GROUP element —
      // so the zone became the group's parent, i.e. the lane root, and the item
      // landed next to the list instead of in it. That is the real reason
      // dragging into an empty list "didn't work" rather than merely being
      // fiddly. The branch bought nothing: for a real card hit, the card's
      // parent-dropzone and the card's enclosing dropzone are the same element.
      let zone = targetEl.closest("[data-dropzone-parent]");
      if (!zone || el.contains(zone)){ setDropZone(null); return; }
      const laneEl = zone.closest(".lane");
      if (!laneEl || laneEl.getAttribute("data-kind") !== drag.kind){ setDropZone(null); return; }
      // Groups only ever live at the top level -- force them to the cards-root
      // instead of letting them drop inside another group's body.
      if (drag.isGroup && !zone.classList.contains("cards-root")){
        zone = laneEl.querySelector(".cards-root");
        if (!zone){ setDropZone(null); return; }
      }
      setDropZone(zone);
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
      // ⚑ The "already there?" test has to include the CONTAINER, not just the
      // next sibling. `el.nextSibling === ref` is also true when both are null
      // — the dragged card is the last thing in the lane and the target zone is
      // an empty list, i.e. exactly the case the user reported. The move was
      // being skipped as a no-op and the card never entered the list.
      if (el.parentElement !== zone || el.nextSibling !== ref){
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
      // A context group reorders the shared REGISTRY, not this lane's task
      // array — it is not in state.tasks[kind] at all, so moveWithinList would
      // find nothing and silently do nothing. Branching here covers the mouse
      // and touch paths at once: both commit through this one function.
      if (el.hasAttribute("data-context-group")){
        moveContext(el.getAttribute("data-context-group"), previousId);
        return;
      }
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
      clearDropCues();
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
        clearDropCues();
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
      // ⚑ THE WHOLE CARD DRAGS, not just its title (user, first device round:
      // "the pills should probably be considered part of the card. Right now, I
      // can tap and hold the 'After X action' pill, and it won't drag the
      // card"). The old rule was literally ".card-title" — so the cue pill,
      // the stalled flag and the deadline bar were all inert to press-and-hold,
      // and a hold there did nothing at all rather than doing the obvious thing.
      //
      // The line is drawn at CONTROLS THAT GO SOMEWHERE ELSE, not at "is it a
      // button". The cue pill IS a <button>, but its data-id is this same card
      // and it opens this same page — it is a second tap target for the
      // title, so it should be a second drag target too. What must keep its own
      // gesture is the handful of controls that act on something else: the
      // checkbox completes, the promote arrow moves lanes, the project jump
      // navigates to a DIFFERENT item, the group header's icons add and delete.
      const DRAG_EXEMPT = ".check, .promote-arrow, .project-jump, .icon-btn, .group-add";
      if (e.target.closest(DRAG_EXEMPT)) return;
      const titleEl = e.target.closest(".card, .group-header");
      if (dragLogOn && e.target.closest && e.target.closest(".card, .group")){
        dlog("touchstart", dragDesc(e.target) + (titleEl ? "  [drag surface]" : "  [exempt control — no drag]"));
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
        clearDropCues();
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
        clearDropCues();
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
    const FLAG = "gtd_qa_checklist_reviewsurface_v8";
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
     "gtd_qa_checklist_reviewsurface_v2", "gtd_qa_checklist_reviewsurface_v3",
     "gtd_qa_checklist_reviewsurface_v4", "gtd_qa_checklist_reviewsurface_v5",
     "gtd_qa_checklist_reviewsurface_v6", "gtd_qa_checklist_reviewsurface_v7"].forEach(Storage.remove);

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
      { title: '5. Find an overdue repeating habit or event, if one shows up', notes: 'Whether it\'s still showing today or already moved on to tomorrow, it should offer "Completed", "Skipped" (not "Let it go"), and "Delete" — the same three, looking and working exactly the same, on both.' },
      { title: '6. Tap Skipped just once', notes: 'It should resolve fully and move the review on to something else — not turn into another card for the same event that you then have to tap Skipped on again.' },
      { title: '7. Check Delete acts right away, no popup', notes: 'Tapping Delete on a review card should delete it immediately, with no "are you sure?" popup — except a repeating calendar event, which still asks whether you mean just this occurrence or the whole series (that one stays, since "delete" is genuinely unclear there).' },
      { title: '8. Find a waiting action review card that lost its condition', notes: 'It should show one compact row — a text box, a small hook icon, and Add — instead of two separate big buttons for the same job. Below that, a plain grey "Make Next Action" button, not a colored "+Next" chip — it converts this same item, so it shouldn\'t look like the buttons that create a new one.' },
      { title: '9. Tap the (i) on a stalled project, a waiting action that lost its condition, and a freshly captured thought', notes: 'Each one\'s "add a next action"-style button does something different (creates a linked item, converts the same item, or files a new item) — the info text should say which, in your own words. Read all three and check they still sound like you.' },
      { title: '10. Tap the (i) info button at the top of the review', notes: 'It should explain only the ONE card you\'re looking at — not a wall of text about every kind of card at once.' }
    ]);

    addGroupWithItems('✅ QA — Calendar changes', [
      { title: '11. Open the calendar and set something to repeat', notes: 'Start adding an event, set it to repeat Daily or Weekly. A purple box should offer to make it a habit instead, with a small X on the end to dismiss it if you don\'t want it.' },
      { title: '12. On a computer, open the calendar', notes: 'The whole calendar should fit on screen without needing to scroll, with the day squares wide and short (not tall) and the "Add" button always visible — not hidden below the fold.' },
      { title: '13. Check the "More options" / "Advanced options" buttons', notes: 'Wherever you see one of these (a next action, a waiting action, a habit, or the calendar), it should now have a light grey fill so it stands out a bit, instead of blending into the background.' }
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
  // ⚑ THE UNCOMMITTED CAPTURE (user round). closeTray() wipes #tray-root, and
  // trayAdd() only persists on an explicit Enter/+ — so a half-typed thought was
  // silently destroyed by closing the drawer, by Escape, and by the
  // swipe-to-dismiss. In an app whose first principle is frictionless capture
  // that is the worst possible thing to drop on the floor, and it cost nothing
  // to keep. Persisted rather than held in memory on purpose: the case that
  // actually matters is a phone killing the app while the drawer is open.
  //
  // Device-local by nature — a half-typed line belongs to the keyboard you are
  // sitting at, not to the system (wrapper-plan.md §4.2: never sync it).
  function loadTrayDraft(){ return Storage.get("gtd_tray_draft") || ""; }
  function saveTrayDraft(v){
    if (v) Storage.set("gtd_tray_draft", v); else Storage.remove("gtd_tray_draft");
  }
  // Caret to the END, not wherever focus() lands it — you are resuming a
  // sentence, not editing its first character.
  function focusTrayInput(){
    const input = qs("#tray-input");
    if (!input) return;
    input.focus();
    const n = input.value.length;
    try { input.setSelectionRange(n, n); } catch (e){ /* not all inputs allow it */ }
  }
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
      '<button type="button" class="icon-btn" data-action="tray-delete" data-id="' + item.id + '" title="' + escapeHtml(t("tray.discard")) + '">&times;</button>' +
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
        '<button type="button" class="tray-reveal-btn" data-action="tray-reveal" title="' + escapeHtml(revealed ? t("tray.hide") : t("tray.reveal")) + '">' +
          // ⚑ The VISIBLE label, not just the tooltip beside it. Missed on the
          // first pass because the audit swept attributes; inline text between
          // tags is the same bug wearing different clothes.
          eyeIconHtml(revealed) + '<span>' + escapeHtml(revealed ? t("tray.hide") : t("tray.reveal")) + '</span>' +
        '</button></div>';
      list = toggle + '<div class="tray-list">' + cards + '</div>';
    } else {
      list = '<div class="tray-empty">' + escapeHtml(t("tray.empty")) + '</div>';
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
          // ⚑ The placeholder was hard-coded English while i18n.js has carried
          // tray.capturePlaceholder unused all along — so the Chinese locale
          // showed an English prompt on the app's most-used control. Fixed here
          // because it is the same line the draft restore had to touch anyway.
          '<input type="text" id="tray-input" placeholder="' + escapeHtml(t("tray.capturePlaceholder")) + '" autocomplete="off" value="' + escapeHtml(loadTrayDraft()) + '">' +
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
    focusTrayInput();
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
          setTimeout(focusTrayInput, 60);
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
  // Keeps the half-typed line alive across a close, an Escape, a swipe-dismiss
  // and an app kill. Written straight through rather than debounced: it is one
  // short string, Storage.set is synchronous, and a debounce would lose exactly
  // the last few characters in the app-kill case this exists for.
  document.addEventListener("input", function(e){
    if (e.target && e.target.id === "tray-input") saveTrayDraft(e.target.value);
  });
  function trayAdd(text){
    text = (text || "").trim();
    if (!text) return;
    state.tray.unshift({ id: genId(), text: text, createdAt: nowMs() });
    saveTray();
    saveTrayDraft("");                                      // committed — the draft has done its job
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
    if (!task) return false;
    // ⚑ A Waiting action with NO condition at all is orphaned too. This used to
    // return false for it — the function only ever caught a DANGLING condition —
    // so a row waiting on nothing was invisible to the review while the review
    // said "all clear". §4.2 makes the condition mandatory and the Waiting page's
    // save gate enforces it, so this should be unreachable; the convert used to
    // reach it anyway (see viewKind / THE PAGE SWAP, which closes that door).
    // Kept as the safety net for any row already in that state, and for the next
    // path that finds a way in.
    // FLAG — behaviour change: previously-invisible rows start appearing in the
    // review. That is the point, but it is a change.
    if (!task.conditionId && !(task.whenText || "").trim()) return true;
    if (!task.conditionId) return false;
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
      // ⚑ info.review.capture (author, sixth QA round: "the next action
      // buttons on the stalled project and capture classification do
      // different things — the info text should reflect this"). Tapping a
      // lane here FILES this thought as a brand-new item — unlike stalled's
      // +Next/+Waiting/+Event (a new item too, but linked to the project)
      // and unlike orphaned's "Make Next Action" (no new item at all, the
      // same waiting action converts in place). Previously written but never
      // actually rendered — wired in here alongside the fix.
      body = '<div class="review-info-block"><b>' + escapeHtml(t("review.heading.sorting")) + '</b><br>' +
          escapeHtml(t("info.review.capture")) + '<br><br>' +
          '<b>' + escapeHtml(t("review.infoNextLabel")) + '</b> ' + escapeHtml(LANE_INFO.next) + '<br>' +
          '<b>' + escapeHtml(t("review.infoWaitingLabel")) + '</b> ' + escapeHtml(LANE_INFO.waiting) + '<br>' +
          '<b>' + escapeHtml(t("review.infoProjectLabel")) + '</b> ' + escapeHtml(LANE_INFO.current) + '<br>' +
          '<b>' + escapeHtml(t("review.infoFutureLabel")) + '</b> ' + escapeHtml(LANE_INFO.future) + '<br>' +
          '<b>' + escapeHtml(t("review.infoHabitLabel")) + '</b> ' + escapeHtml(LANE_INFO.habit) + '<br>' +
          '<b>' + escapeHtml(t("review.infoNoteLabel")) + '</b> ' + escapeHtml(LANE_INFO.notes) + '<br>' +
          // ⚑ ADDED (author, this round). The capture card has rendered a
          // Calendar button since chunk 7 and this panel explained the other six
          // destinations, so it described six of the seven buttons directly
          // beneath it. Sits after Note and before 2 min, matching the button
          // order on the card. Not from LANE_INFO — the calendar is a screen,
          // not a lane — and only the FIRST sentence, per the .more convention:
          // the rest is withheld until you open the calendar's own ⓘ.
          '<b>' + escapeHtml(t("review.infoCalendarLabel")) + '</b> ' + escapeHtml(t("info.calendar")) + '<br>' +
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
        // ⚑ Hook icon added here (author): this field was free-text only, with
        // no way to attach a real Next/Waiting condition short of escaping to
        // the full page — inconsistent with every other waiting-for field in
        // the app, which all offer the hook. Same icon/action as the orphaned
        // card's (review-form-full, since there's no task id yet to reuse
        // review-open's edit-existing path — this is still a CREATE).
        '<div class="review-band review-quickadd-row">' +
          box("review-form-input2", t("review.untilWhatWhen"), f.value2, "when") +
          '<button type="button" class="review-hook-btn" data-action="review-form-full" data-kind="waiting" data-project="' + key + '" title="' + escapeHtml(t("waiting.hookToTarget")) + '">&#129693;</button>' +
        '</div>' +
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
    // The menu is close kin to the past-due pseudo-action's, minus anything
    // that would act on the wrong occurrence: you cannot push a date that is
    // already behind you. Delete deletes the whole event/series, same as
    // everywhere else in the review (author ruling, fourth QA round) — the
    // "just this miss" case is what Skipped is for.
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
      // Delete (author ruling, fourth QA round: "no reason those pages
      // should look or behave any differently" from the live pastdue-pseudo
      // card) — same corner, same recurring-aware dialog, resolved by event
      // id since a missed card has no lane row to hang a task id off.
      menuHtml =
        reviewBandHtml(
          '<button type="button" class="review-menu-btn" data-action="review-missed-done" data-id="' + l.id + '">&#10003; ' + escapeHtml(t("review.completed")) + '</button>' +
          '<button type="button" class="review-menu-btn" data-action="review-missed-clear" data-id="' + l.id + '">' + escapeHtml(t("review.skipped")) + '</button>'
        ) +
        '<div class="review-menu-row">' + reviewNotNowBtn(l.key) + reviewMenuBtn("review-delete-event-missed", "&#128465; " + escapeHtml(t("review.delete")), ' data-id="' + l.id + '"', true) + '</div>';
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
      // ⚑ Two shapes of orphan now: a DANGLING condition ("After <the thing that
      // went away>") and NO condition at all, which isWaitingOrphaned started
      // reporting this round. The second must not borrow the first's wording —
      // "After a deleted item" would invent a deletion that never happened.
      bodyHtml += l.task.conditionId
        ? '<span class="review-card-note cue-orphaned-text">🪝 ' + escapeHtml(t("waiting.after")) + ' ' + escapeHtml(l.task.conditionLabel || t("picker.deletedItem")) + '</span>'
        : '<span class="review-card-note cue-orphaned-text">🪝 ' + escapeHtml(t("review.waitingOnNothing")) + '</span>';
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
      } else if (form && form.type === "link"){
        // ⚑ Author: the link picker belongs here too. It is the only entry in
        // this band that gives a stalled project a way forward WITHOUT making
        // something new -- often the honest answer, since the action usually
        // already exists and simply was never attached.
        //
        // Acts IMMEDIATELY, unlike the project page's copy. The review has no
        // draft and no ✕ to discard into; every other button on this card
        // commits on tap, and a picker that silently staged instead would be
        // the odd one out. Same list, same grouping, same look -- only the
        // routing differs.
        menuHtml =
          '<div class="pick-body">' +
            linkPickListHtml(linkTargetsFor(l.id, []), "review-link-pick", ' data-project="' + l.id + '"') +
            '<div class="review-menu-row">' + reviewMenuBtn("review-form-cancel", t("picker.back"), "") + '</div>' +
          '</div>';
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
          // Author: ABOVE the make-something-new buttons, because attaching what
          // already exists is the first thing to try. ⚑ Its own band, not the
          // first child of band 1 — a band is a flex row, so sharing one put it
          // beside them ("it's on the same row"), not above.
          reviewBandHtml(
            reviewMenuBtn("review-form-start", t("project.linkExisting"), ' data-key="' + l.key + '" data-type="link"')
          ) +
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
      // Simplified (author, fifth QA round): "Re-point the condition" and
      // "Replace with free text" were two separate full-width buttons for
      // what's really one job — say what this is waiting on now. Replaced
      // with the same compact quick-add row the waiting page's own field
      // uses: a text box (free text), a hook icon beside it (re-point to a
      // Next/Waiting condition — same navigation "Re-point the condition"
      // used, just an icon now), and Add. Always present, not gated behind
      // a button (there's nothing left to gate — this IS band 1 now).
      // reviewForm is primed here rather than via a "start" click, since
      // there's no longer a collapsed state to expand from; reviewSaveFreeText
      // and the Enter-to-submit handler (both pre-existing) need it set to
      // find this card by key.
      if (!(form && form.type === "text")){
        if (state.screen) state.screen.reviewForm = { key: l.key, type: "text", invalid: false };
      }
      const curForm = reviewFormFor(s, l.key) || {};
      menuHtml =
        '<div class="review-band review-quickadd-row">' +
          '<input type="text" id="review-form-input" data-field="reviewForm" class="review-form-input' + (curForm.invalid ? " field-invalid" : "") + '" placeholder="' + escapeHtml(t("review.waitingForDots")) + '" value="' + escapeHtml(curForm.value || "") + '" autocomplete="off">' +
          '<button type="button" class="review-hook-btn" data-action="review-open" data-lane="waiting" data-id="' + l.id + '" title="' + escapeHtml(t("waiting.hookToTarget")) + '">&#129693;</button>' +
          '<button type="button" class="review-menu-btn review-form-primary" data-action="review-freetext-save">' + escapeHtml(t("review.add")) + '</button>' +
        '</div>' +
        // ⚑ Deliberately NOT a colored "+Next" chip (author, sixth QA round:
        // "I got confused about what that button did because its behaviour
        // is substantially different from the other +Next buttons"). Every
        // other +Next creates a NEW item (stalled: a fresh linked action;
        // capture: files the thought as one); this one converts the SAME
        // waiting action in place, no new item — exactly what the drafting
        // page's own "Make Next Action" convert button does. Reuses THAT
        // button's actual markup (makeKindBtnHtml's unarmed/enabled render
        // for destKind "next": .btn.screen-make-kind-btn, red border+text,
        // "← " arrow prefix) rather than a generic .review-menu-btn chip or
        // the lane card's bare .promote-arrow icon — both tried and both
        // wrong (author, seventh QA round). Click still fires immediately
        // via review-promote, same as every other review decision.
        reviewBandHtml('<button type="button" class="btn screen-make-kind-btn" data-action="review-promote" data-id="' + l.id + '" style="border-color:var(--red);color:var(--red);">&#8592; ' + escapeHtml(t("outcome.makeNext")) + '</button>') +
        reviewBandHtml(reviewMenuBtn("review-complete", t("review.completed"), ' data-lane="waiting" data-id="' + l.id + '"')) +
        '<div class="review-menu-row">' + reviewNotNowBtn(l.key) + reviewMenuBtn("review-delete", t("review.delete"), ' data-lane="waiting" data-id="' + l.id + '"', true) + '</div>';
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
  // The ONE exception to the no-confirm ruling above: a RECURRING event, where
  // "delete" is ambiguous (this occurrence, or the whole series?) — that's
  // disambiguation, not a safety net, so it stays. Reuses confirmDeleteEvent's
  // own recurring branch unchanged (also used by the full event page); only
  // the non-recurring path diverges from it here, going straight to
  // deleteEventEntirely instead of confirmDeleteEvent's plain "are you sure".
  // Shared by both the live past-due pseudo-action card AND the already-
  // rolled-past missed card (author ruling: "no reason those pages should
  // look or behave any differently") — every recurring event in the review
  // gets Delete, and gets the same dialog.
  function reviewDeleteEventCore(ev){
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
  // QA #13. The id is the pseudo-action's task ID, which IS the event's taskId
  // (§4.14a) — that stability is exactly what lets the review address the event
  // without carrying a second identifier. Used by the live pastdue card.
  function reviewDeleteEvent(taskId){ reviewDeleteEventCore(findEventByTaskId(taskId)); }
  // The missed card carries the EVENT's own id (l.id = ev.id — it has no lane
  // row to hang a task id off), not a task id, so it needs the plain findEvent
  // lookup rather than reviewDeleteEvent's findEventByTaskId.
  function reviewDeleteEventById(eventId){ reviewDeleteEventCore(findEvent(eventId)); }
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
  // Disconnecting, with a farewell push first (W7, author's suggestion):
  // "hitting Disconnect and hitting Disconnect and Restore are both signals of
  // intent that the device no longer wants to be on the roster." The push
  // removes this device's roster entry, which matters because §4.5's tombstone
  // GC holds every tombstone until the OLDEST last-pull across the roster --
  // one abandoned entry pins that horizon for a year.
  //
  // BEST EFFORT, deliberately. If the farewell push fails (offline, expired
  // token) the disconnect still happens: refusing to disconnect because the
  // network is down would be a worse failure than a stale roster entry, and
  // the year-long dropout in gcTombstonesAndRoster is the backstop that
  // already exists for exactly this.
  function disconnectSyncThen(done){
    const transport = activeSyncTransport();
    if (!transport){ if (done) done(); return; }
    Sync.setLeavingRoster(true);
    Promise.resolve()
      .then(function(){ return transport.syncNow(); })
      .catch(function(){ /* see BEST EFFORT above */ })
      .then(function(){
        Sync.setLeavingRoster(false);
        return transport.disconnect();
      })
      .then(function(){
        Storage.remove(DROPBOX_LAST_SYNC_KEY);
        Storage.remove(DROPBOX_CONFLICT_LOG_KEY);
        state.sync.lastError = null;
        if (done) done();
      });
  }
  // RESTORE TO DEFAULTS, in two flavours (W7, author's ruling).
  //
  // The warning has always said "everything you've entered will be permanently
  // erased… this can't be undone." Sync quietly made that FALSE: the cloud
  // still held everything, so the next sync poured it all back and stripped
  // the fresh sample data on the way in. A reset on a connected device gave
  // you neither your data nor the defaults. The author's ruling is to make the
  // warning true again rather than to soften it.
  //
  // `propagate` decides whose data. Both paths keep this device's IDENTITY --
  // the old code cleared gtd_device_id, so every reset minted a new id and
  // abandoned the old one in the roster, which is the same defect the import
  // fix addressed from the other side.
  function clearAllAppData(propagate){
    if (propagate) tombstoneEverySyncedRecord();
    // Every other gtd_ key (data + injected-flag bookkeeping). gtddev_ keys
    // (snapshot, drag-log settings) survive, like Reset always has.
    Storage.keys().forEach(function(key){
      if (key.indexOf("gtd_") !== 0) return;
      if (propagate && Sync.isRestoreSurvivorKey(key)) return;
      Storage.remove(key);
    });
    window.location.reload();
  }
  // The wipe that TRAVELS. Writing an empty array through setJSON runs
  // storage.js's stampAndTombstone, which diffs against what is in storage and
  // mints a tombstone for every record that vanished -- the identical
  // machinery an ordinary delete uses, rather than a second implementation of
  // "publish a deletion" that could drift from it. An empty array passes the
  // record-array gate ([].every() is true), which is what makes this work.
  //
  // Then the stores are REMOVED, because initLocalData() only reseeds when a
  // lane store is missing -- an empty array reads as "this lane is genuinely
  // empty" and would leave the app blank instead of restored. Storage.remove
  // does not tombstone, so the tombstones minted a moment ago survive it.
  //
  // ⚑ THE RESEED, which the author flagged: the cloud deliberately holds no
  // sample data, so tombstoning everything would empty the other devices and
  // leave them empty. Keeping the BASELINE is what fixes it. With a baseline
  // present the next sync is an ordinary three-way merge rather than a rejoin,
  // so stripSeededRecords never fires, and the defaults this device seeds on
  // reload publish as ordinary new records. The other devices then receive the
  // deletions AND the fresh sample data in the same bundle. No new bundle
  // field, no reseed signal, no new merge semantics -- the existing rules
  // already say exactly this once the baseline is allowed to survive.
  function tombstoneEverySyncedRecord(){
    Sync.storeKeys.forEach(function(k){ Storage.setJSON(k, []); });
    Sync.storeKeys.forEach(function(k){ Storage.remove(k); });
  }
  // ▲ POST-SPRINT (§P1): the settings surface is a DROPDOWN anchored under the
  // header ⋯, not a modal sheet. A modal is a room you have to leave; settings
  // here are small, frequent, and mostly one tap, so the menu opens over the
  // desk and dismisses on any outside tap. Nested panels (Background) push into
  // the same dropdown rather than opening a second layer.
  let settingsPanel = "root";
  // W6: resolves to whichever transport THIS build actually offers --
  // DropboxTransport (Capacitor/Android, W5) or DesktopTransport (Electron,
  // W6) -- never both; a plain browser tab has neither. Every call site below
  // keeps saying "Dropbox" throughout (function names, storage keys, i18n
  // strings) on purpose: both transports read and write the exact same
  // Dropbox-synced file, just by different mechanisms (HTTP API + OAuth vs.
  // reading the local disk copy), so the existing copy ("Connect Dropbox")
  // stays accurate as written rather than forking into two near-identical
  // settings rows and duplicating this whole orchestration block.
  function activeSyncTransport(){
    if (DropboxTransport.isAvailable()) return DropboxTransport;
    if (DesktopTransport.isAvailable()) return DesktopTransport;
    return null;
  }
  // W5: hidden entirely outside the wrapper -- "In a browser, the transport
  // simply is not offered" (wrapper-plan.md). At the TOP of the menu (author's
  // placement, this round), above export/import, since it's the row most
  // likely to need a deliberate tap right before switching devices.
  function settingsDropboxRowHtml(){
    if (!activeSyncTransport()) return "";
    if (!Sync.isEnabled()){
      return '<button type="button" class="settings-item" data-action="dropbox-connect">' +
        '<span>&#9729;</span><span class="si-label">' + escapeHtml(t("sync.connect")) + '</span></button>' +
        '<div class="settings-sep"></div>';
    }
    const conflicts = dropboxConflictLog();
    let out =
      '<button type="button" class="settings-item" data-action="dropbox-sync-now">' +
        '<span>&#9729;</span><span class="si-label">' + escapeHtml(t("sync.now")) +
        '<span class="si-note">' + escapeHtml(dropboxSyncStatusLabel()) + '</span></span></button>';
    if (conflicts.length){
      out += '<button type="button" class="settings-item" data-action="settings-dropbox-conflicts">' +
        '<span>&#9888;</span><span class="si-label">' +
        escapeHtml(conflicts.length === 1 ? t("sync.conflictsOne") : t("sync.conflictsMany").replace("{n}", conflicts.length)) +
        '</span><span class="si-caret">&#8250;</span></button>';
    }
    out += '<button type="button" class="settings-item" data-action="dropbox-disconnect">' +
      '<span>&#10005;</span><span class="si-label">' + escapeHtml(t("sync.disconnect")) + '</span></button>' +
      '<div class="settings-sep"></div>';
    return out;
  }
  function settingsDropboxConflictsHtml(){
    const conflicts = dropboxConflictLog();
    let out =
      '<button type="button" class="settings-item settings-back" data-action="settings-root">' +
        '<span>&#8249;</span><span class="si-label">' + escapeHtml(t("sync.conflictsTitle")) + '</span></button>' +
      '<div class="settings-sep"></div>';
    if (!conflicts.length){
      return out + '<div class="settings-conflict-empty">' + escapeHtml(t("sync.conflictsEmpty")) + '</div>';
    }
    out += '<div class="settings-conflict-intro">' + escapeHtml(t("sync.conflictsIntro")) + '</div>';
    conflicts.forEach(function(c){
      const when = escapeHtml(new Date(c.at).toLocaleString());
      out += '<div class="settings-conflict-item"><div class="si-note">' + when + '</div>' +
        (c.resurrection
          ? '<div>' + escapeHtml(t("sync.resurrection")) + '</div><div>' + escapeHtml(t("sync.conflictKept").replace("{text}", c.keptText)) + '</div>'
          : '<div>' + escapeHtml(t("sync.conflictKept").replace("{text}", c.keptText)) + '</div>' +
            '<div>' + escapeHtml(t("sync.conflictReplaced").replace("{text}", c.lostText || "")) + '</div>'
        ) + '</div>';
    });
    return out;
  }
  function settingsRootHtml(){
    const surf = SURFACES[currentSurfaceId()] || SURFACES[DEFAULT_SURFACE];
    return (
      settingsDropboxRowHtml() +
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
      '<div class="settings-build" title="' + escapeHtml(t("settings.buildTooltip")) + '">' + escapeHtml(t("settings.build")) + ' ' + escapeHtml(BUILD_STAMP) + '</div>'
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
          '<span class="si-label">' + escapeHtml(surfaceLabel(id)) + '</span>' +
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
      : settingsPanel === "dropbox-conflicts" ? settingsDropboxConflictsHtml()
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
      if (action === "settings-dropbox-conflicts"){ settingsPanel = "dropbox-conflicts"; renderSettingsMenu(); return; }
      if (action === "dropbox-connect"){
        // Android: hands off to the system browser (AppAuth) and back.
        // Electron (W6): auto-detects the local Dropbox folder or opens a
        // native picker (desktopTransport.js) -- same shape, nothing to show
        // mid-flight beyond what the platform itself shows either way. On
        // return, sync once immediately so "Connect" doesn't sit there
        // looking unconnected.
        activeSyncTransport().connect().then(function(){ renderSettingsMenu(); runDropboxSync(); })
          .catch(function(e){ state.sync.lastError = (e && e.message) || String(e); renderSettingsMenu(); });
        return;
      }
      if (action === "dropbox-sync-now"){ runDropboxSync(); return; }
      if (action === "dropbox-disconnect"){
        // Not behind openConfirmDialog: reversible (reconnect and it picks
        // back up) and non-destructive (touches neither local nor cloud
        // data) -- same "applies immediately" tier as the background/
        // language rows right below it, not the restore-defaults tier below
        // THAT. ⚑ Builder's call, flagged rather than silently assumed.
        disconnectSyncThen(function(){ renderSettingsMenu(); });
        return;
      }
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
        // With other devices on the roster the choice is real, so it is put to
        // the user rather than guessed at (author's ruling). With none, the
        // second option would describe something that cannot happen, so the
        // dialog stays exactly as it was.
        const shared = Sync.isEnabled() && Sync.rosterDeviceCount() > 1;
        const buttons = [];
        if (shared){
          buttons.push({ label: t("confirm.restoreAllDevices"), style: "danger",
                         action: function(){ clearAllAppData(true); } });
          buttons.push({ label: t("confirm.disconnectAndRestore"), style: "danger",
                         action: function(){ disconnectSyncThen(function(){ clearAllAppData(false); }); } });
        } else {
          buttons.push({ label: t("confirm.eraseRestoreDefaults"), style: "danger",
                         action: function(){ clearAllAppData(false); } });
        }
        buttons.push({ label: t("chrome.cancel"), action: function(){} });
        openConfirmDialog(
          t("confirm.restoreDefaultsMessage") + (shared ? " " + t("confirm.restoreAlsoDeletesElsewhere") : ""),
          buttons
        );
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
  //
  // ⚑ W7 (wrapper-plan.md §11, author's ruling): "every gtd_ key" is no longer
  // literally every gtd_ key. Sync's own bookkeeping lives under the same
  // prefix, and a backup is the user's DATA, not this device's place in the
  // sync system. Export omits it and import refuses it — see sync.js's
  // RESTORING A BACKUP block for the full ruling. Neither half of that is a
  // detail: importing gtd_device_id gave two devices one identity, which is
  // the normal outcome of restoring a phone backup onto a new computer.
  // =========================================================
  function serializeAllData(){
    const data = {};
    Storage.keys().forEach(function(k){
      // Excluded on the way OUT as well as the way in. A backup carrying
      // another device's identity is a loaded gun even if this build refuses
      // to fire it -- the file outlives the build that wrote it.
      if (k.indexOf("gtd_") === 0 && !Sync.isSyncMachineryKey(k)) data[k] = Storage.get(k);
    });
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
        // The sync sentence only appears on a device that actually syncs --
        // on a plain browser tab it would describe consequences that cannot
        // happen, which is its own kind of dishonesty.
        const warning = t("confirm.importReplaceWarning") +
          (Sync.isEnabled() ? " " + t("confirm.importAlsoSyncs") : "");
        openConfirmDialog(warning, [
          { label: t("confirm.replaceEverything"), style: "danger", action: function(){
              // (a) A restore is the truth: stamp every restored record now,
              // so it beats an earlier deletion on the other device instead
              // of being silently re-deleted by it.
              Sync.stampRestoredRecords(data);
              // Clear only what a restore replaces. Sync machinery is NOT
              // cleared here -- gtd_device_id in particular must survive, or
              // this device forgets who it is and mints a second identity on
              // the next boot, which is the very failure being fixed.
              Storage.keys().forEach(function(k){
                if (k.indexOf("gtd_") === 0 && !Sync.isSyncMachineryKey(k)) Storage.remove(k);
              });
              Object.keys(data).forEach(function(k){
                // Belt and braces: a backup written by an older build still
                // carries the machinery keys, and this is where they are
                // refused. Export having stopped emitting them is not enough.
                if (k.indexOf("gtd_") === 0 && !Sync.isSyncMachineryKey(k)) Storage.set(k, data[k]);
              });
              // ⚑ A LANE THE BACKUP DOES NOT MENTION IS RESTORED EMPTY, not
              // left absent. initLocalData() treats ANY missing lane store as
              // "this install has no data" and calls seedData(), which
              // re-seeds EVERY lane -- so restoring a backup written before a
              // lane existed (gtd_tasks_habit, or notes before chunk 6) wiped
              // the restore on the very next boot and tombstoned every record
              // it had just written. Found by checks/restore_x_sync.py.
              // Writing "[]" says "this lane is empty", which is what the
              // backup actually means, and is a claim seedData never overrides.
              KINDS.forEach(function(k){
                const key = "gtd_tasks_" + k;
                if (Storage.get(key) === null) Storage.set(key, "[]");
              });
              // (b) Rejoin fresh -- baseline, tombstones and roster go, this
              // device's id and connection stay. Runs AFTER the writes above
              // so nothing it clears can be reinstated by them.
              Sync.resetSyncIdentityAfterRestore();
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
      ? '<span class="notes-filter-active">' + escapeHtml(activeName) + '</span><button type="button" class="chip-x" data-action="clear-notes-filter" title="' + escapeHtml(t("note.clearFilter")) + '">&times;</button>'
      : 'Filter';
    let menu = "";
    if (state.notesFilterMenuOpen){
      const pickItem = function(o){
        return '<button type="button" class="notes-filter-item' + (o.id === state.notesFilter ? " current" : "") + '" data-action="notes-filter-pick" data-id="' + o.id + '">' + escapeHtml(o.kind === "tag" ? "#" + o.name : o.name) + '</button>';
      };
      let items = ['<button type="button" class="notes-filter-item' + (state.notesFilter ? "" : " current") + '" data-action="notes-filter-pick" data-id="">' + escapeHtml(t("note.allNotes")) + '</button>'];
      if (opts.projects.length) items = items.concat('<div class="notes-filter-section">' + escapeHtml(t("note.filterProjects")) + '</div>', opts.projects.map(pickItem));
      if (opts.tags.length) items = items.concat('<div class="notes-filter-section">' + escapeHtml(t("note.filterTags")) + '</div>', opts.tags.map(pickItem));
      if (!opts.projects.length && !opts.tags.length) items.push('<div class="notes-filter-empty">' + escapeHtml(t("note.filterEmpty")) + '</div>');
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
      : '<div class="empty-note">' + escapeHtml(state.notesFilter ? t("note.emptyForFilter") : t("note.emptyNoNotes")) + '</div>');
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

  // W3 (wrapper-plan.md): storage.js's stampAndTombstone only stamps a record
  // when its store is next saved for some other reason -- a store nobody has
  // touched since this chunk shipped would otherwise carry zero modifiedAt
  // fields indefinitely. Forces that save once at boot, for every
  // record-array store, using data already loaded into `state` (no extra
  // reads). Cheap in steady state: once every record has a modifiedAt, this
  // finds nothing to stamp and calls no save function at all.
  function backfillModifiedAt(){
    function anyMissing(arr){ return Array.isArray(arr) && arr.some(function(r){ return r && r.modifiedAt == null; }); }
    KINDS.forEach(function(k){ if (anyMissing(state.tasks[k])) saveTasksLocal(k); });
    ["next", "waiting", "current", "future"].forEach(function(k){ if (anyMissing(state.completed[k])) saveCompletedLocal(k); });
    if (anyMissing(state.events)) saveEvents();
    if (anyMissing(state.notes)) saveNotes();
    if (anyMissing(state.tags)) saveTags();
    if (anyMissing(state.contexts)) saveContexts();
    if (anyMissing(state.tray)) saveTray();
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
    normalizeContextOrderOnce(); // one-time, so both devices start hand-ordering from the same arrangement
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
    normalizeReshapedStores(); // chunks A/B: convert any legacy keyed-object stores before anything reads them for sync
    backfillModifiedAt(); // W3: every record-array store gets a modifiedAt, immediately not eventually
    // W5 trigger 1/4 (open). Fired here, NOT awaited -- boot() stays
    // synchronous throughout (the same call the async-storage rewrite in
    // spec.md §2 was rejected to avoid making, W2). Placed just before the
    // gate it feeds: processHabitBoundaries() below checks
    // Sync.canSweepAccumulated(), which only opens once THIS call's pull
    // resolves. Firing it here, immediately before that check, gives it the
    // best real chance of already being in flight when the gate is tested,
    // without ever making boot wait on it -- a slow network still falls
    // through to §4.3's own timeout, not a frozen launch.
    runDropboxSync();
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

  // =========================================================
  // DROPBOX SYNC ORCHESTRATION (W5, wrapper-plan.md §4.1/§1). sync.js (the
  // merge engine) and dropboxTransport.js (the network transport) are both
  // deliberately narrow and UI-agnostic; this is the one place that turns
  // "a sync ran" into what the app actually shows -- staleness and the
  // "never silent" conflict report, §1's two visible moments.
  // =========================================================
  const DROPBOX_LAST_SYNC_KEY = "gtd_dropbox_last_sync";
  const DROPBOX_CONFLICT_LOG_KEY = "gtd_dropbox_conflict_log";
  const DROPBOX_CONFLICT_LOG_CAP = 20; // a personal log, not an audit trail -- old entries just age out
  // Long enough that a slow phone on a slow connection finishes honestly,
  // short enough that a wedged attempt cannot hold the "syncing" latch for a
  // whole session. Nothing waits on a sync, so this only bounds the latch.
  const SYNC_ATTEMPT_TIMEOUT_MS = 30000;

  function dropboxLastSyncAt(){
    const raw = Storage.get(DROPBOX_LAST_SYNC_KEY);
    return raw ? Number(raw) : null;
  }
  function dropboxConflictLog(){ return Storage.getJSON(DROPBOX_CONFLICT_LOG_KEY, []); }

  // A record's display field differs by store (tasks/events use title, notes
  // and tray use text) -- this is plain-language display only, never used to
  // decide anything, so a best-effort pick is fine.
  function conflictRecordSnippet(rec){
    if (!rec) return "";
    const s = rec.title || rec.text || rec.id || "";
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  }

  // §1: "never silent" -- every genuine conflict AND every delete/edit
  // resurrection the merge reports gets a plain-language line here, not just
  // applied quietly underneath. Minimal on purpose: which store, a snippet
  // of what won and what lost, when -- not a full diff viewer.
  // ⚑ A conflict is logged ONCE per event, not once per sync that re-derives
  // it (found live: two entries for one restored item). The same disagreement
  // is re-computed by every sync until the cloud settles -- a resurrection in
  // particular persists until the restored record has actually been pushed --
  // so without this the log fills with repeats of one thing and stops being
  // readable, which for a log whose whole job is "never silent" is its own
  // kind of failure.
  //
  // Sixty seconds, and keyed on store+id: long enough to swallow a CAS retry
  // and the back-to-back open/resume syncs that follow one action, short
  // enough that the same record genuinely contested again later still gets its
  // own entry.
  const CONFLICT_DEDUPE_MS = 60000;
  function appendDropboxConflicts(conflicts){
    if (!conflicts || !conflicts.length) return;
    const log = dropboxConflictLog();
    const now = Date.now();
    conflicts.forEach(function(c){
      const key = (c.store || "") + ":" + (c.id || "");
      const seen = log.some(function(e){
        return e.key === key && (now - (e.at || 0)) < CONFLICT_DEDUPE_MS;
      });
      if (seen) return;
      log.unshift({
        at: now,
        key: key,
        resurrection: !!c.resurrection,
        keptText: conflictRecordSnippet(c.resurrection ? c.record : c.winner),
        lostText: c.resurrection ? null : conflictRecordSnippet(c.winner === c.local ? c.remote : c.local)
      });
    });
    Storage.setJSON(DROPBOX_CONFLICT_LOG_KEY, log.slice(0, DROPBOX_CONFLICT_LOG_CAP));
  }

  function dropboxSyncStatusLabel(){
    if (state.sync.syncing) return t("sync.syncing");
    // ⚑ SHOW THE ACTUAL REASON, not just "failed" (added after the phone
    // stopped syncing on 2026-07-31 and the menu could only say that it had).
    // The reason was sitting in lastError the whole time; diagnosing it
    // instead took reading the shared Dropbox file and then the Java. On a
    // phone there is no console to fall back on, so a status line that will
    // not say WHY is a dead end rather than a hint. Truncated, because these
    // strings come from Dropbox and can run long.
    if (state.sync.lastError){
      // Through t(): an authored reason (err.sync.*) is translated, and any
      // other message -- Dropbox's own, or the native plugin's -- falls through
      // unchanged, because t() returns the key it was given when it misses.
      const why = t(String(state.sync.lastError).trim());
      return t("sync.error") + (why ? " — " + (why.length > 90 ? why.slice(0, 89) + "…" : why) : "");
    }
    const at = dropboxLastSyncAt();
    if (!at) return t("sync.notYetSynced");
    const min = Math.floor((Date.now() - at) / 60000);
    if (min < 1) return t("sync.justNow");
    if (min < 60) return min === 1 ? t("sync.minutesOne") : t("sync.minutesMany").replace("{n}", min);
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr === 1 ? t("sync.hoursOne") : t("sync.hoursMany").replace("{n}", hr);
    const day = Math.floor(hr / 24);
    return day === 1 ? t("sync.daysOne") : t("sync.daysMany").replace("{n}", day);
  }

  function isSettingsMenuOpen(){ return !!qs("#dialog-root .settings-menu"); }

  // The one function every trigger (boot, resume, backgrounding, the manual
  // button) calls. Fire-and-forget everywhere except the manual button,
  // which only awaits it to know when to stop showing "Syncing…" -- nothing
  // in the app ever blocks on this, matching Sync.canSweepAccumulated()'s
  // own tolerance for a sync still in flight (wrapper-plan.md §4.3).
  async function runDropboxSync(){
    // Sync.isEnabled(), not DropboxTransport.isAvailable() -- isAvailable()
    // only means "native platform," which is true the moment the app is
    // installed, long before anyone has connected Dropbox. Gating the
    // AUTOMATIC triggers (boot/resume/backgrounding) on isAvailable() alone
    // would mean every launch tries a real network call and access-token
    // fetch for a feature the user never opted into -- wasteful, and it
    // would silently attempt work an unauthorized DropboxAuthPlugin call is
    // only going to reject anyway. isEnabled() already means "native AND
    // this device has connected" (sync.js), which is the correct gate here.
    // Each transport's own syncNow() still only checks its own isAvailable()
    // -- it stays callable directly (the manual button's own connect flow
    // calls it right after Sync.setConnected(true), before isEnabled()
    // would differ from isAvailable() in practice).
    if (!Sync.isEnabled()) return;
    if (state.sync.syncing){
      // A trigger arrived mid-flight. Do NOT just drop it: with sync-on-save
      // that trigger is "the user saved something", and the in-flight sync
      // may already have read storage before that save landed. Remember to
      // run once more when this one finishes -- the trailing edge that makes
      // "every save eventually reaches the cloud" true rather than likely.
      state.sync.rerunWhenDone = true;
      return;
    }
    state.sync.syncing = true;
    if (isSettingsMenuOpen()) renderSettingsMenu();
    try {
      // Bounded, because "syncing" is a latch and a hung request would jam it
      // shut forever. Found by checks/desktop_fs_sync.py's offline simulation
      // (2026-07-30): its write never settled, runDropboxSync()'s await never
      // returned, its finally never ran, and every later sync in that session
      // bailed on the still-true flag -- sync silently dead until relaunch.
      // Not a test artifact: a request that never answers is exactly what a
      // flaky connection or a wedged IPC reply does in the real app.
      //
      // The abandoned attempt may still land afterwards; that is safe, since
      // both transports write under CAS/mtime checks and a late write either
      // wins cleanly or loses and retries.
      const result = await Promise.race([
        activeSyncTransport().syncNow(),
        new Promise(function(_, reject){
          // ⚑ A KEY, not a sentence: lastError goes through t() in
          // dropboxSyncStatusLabel, so an authored reason gets translated and
          // anything else falls through. This was the last surfaced sync error
          // still written in raw English.
          setTimeout(function(){ reject(new Error("err.sync.timedOut")); }, SYNC_ATTEMPT_TIMEOUT_MS);
        })
      ]);
      Storage.set(DROPBOX_LAST_SYNC_KEY, String(Date.now()));
      state.sync.lastError = null;
      appendDropboxConflicts(result.conflicts);
      if (result.applied === false){
        // Merged and PUSHED, but deliberately not applied here: a drafting
        // page is open (syncApplyGateOpen). Remember to come back for it when
        // that page closes -- otherwise this device sits stale until the next
        // resume/background/manual trigger happens to fire.
        state.sync.deferredApply = true;
        return;
      }
      // A pull may have changed anything -- same render shape as B1's resume
      // sweep just below (resweepBoundariesOnResume), never a drafting page
      // mid-edit. The tray is included because captures sync too (§4.2) and
      // it is a drawer rather than a lane, so renderLane never touches it.
      ALL_LANES.forEach(renderLane);
      updateLaneVisibility();
      updateHabitBadge();
      // refreshTrayList(), NOT renderTray(): renderTray rebuilds the whole
      // drawer, which would drop the .open class out from under an open
      // drawer AND rebuild #tray-input, destroying the cursor in a capture
      // being typed right now. refreshTrayList swaps only the card list --
      // it is the function that exists for exactly this (see its own note
      // about the drawer "jump"). Guarded so it can never fall through to a
      // full renderTray() that would slide the drawer open unbidden.
      if (qs(".tray-scroll")) refreshTrayList();
      if (state.screen && (state.screen.calendarView || state.screen.reviewView)) renderScreen();
    } catch (e) {
      state.sync.lastError = (e && e.message) || String(e);
    } finally {
      state.sync.syncing = false;
      if (isSettingsMenuOpen()) renderSettingsMenu();
      if (state.sync.rerunWhenDone){
        state.sync.rerunWhenDone = false;
        runDropboxSync(); // the trailing edge above; cannot loop, since a sync's own writes never re-trigger (sync.js suppresses them)
      }
    }
  }

  // =========================================================
  // THE OTHER HALF OF sync.js's INVARIANT (see its reconcile() header).
  // A merge writes localStorage; every lane in this file is served from an
  // in-memory copy loaded once in boot(). Without this, pulled records are
  // invisible until a restart AND the next save mistakes them for deletions,
  // destroying them on both devices. Found on the first real two-device test
  // (2026-07-30), not by any check -- every sync test asserted on
  // localStorage, which was the one place that WAS correct.
  //
  // Deliberately NOT initLocalData(): that seeds sample data when a store is
  // missing, which is exactly wrong here -- a merge that legitimately empties
  // a lane must not re-seed it.
  // =========================================================
  function reloadSyncedStateFromStorage(){
    KINDS.forEach(function(k){
      const loaded = loadTasksLocal(k);
      if (loaded) state.tasks[k] = loaded;
    });
    // Same migration-free read initLocalData() does: a pre-cue-row habit's
    // single whenText becomes a one-entry list. A record arriving from an
    // older build on the other device needs it just as much as a stored one.
    state.tasks.habit.forEach(function(h){
      if (h.isGroup) return;
      if (!h.whenTexts) h.whenTexts = h.whenText ? [h.whenText] : [];
    });
    const loadedCtx = loadContexts();
    if (loadedCtx) state.contexts = loadedCtx;
    initCompletedData();
    state.tray = loadTray();
    state.notes = loadNotes();
    state.tags = loadTags();
    const loadedEvents = loadEvents();
    if (loadedEvents) state.events = loadedEvents;
    // ⚑ W7 DEFECT FIX. These two were missing, and they are the two stores
    // chunk B added to sync. A merged habit history reached localStorage and
    // never reached memory, so the next saveHabitRuns() wrote the stale
    // in-memory copy straight back over it -- the exact failure the "memory
    // follows storage, always, in the same breath" invariant exists to
    // prevent (sync.js reconcile()). It also meant §4.3's sweep gate was
    // protecting nothing for habits: the sweep read pre-pull memory however
    // patiently it had waited for the pull. habitDoneOrder is deliberately
    // NOT here -- it is device-local today-only display ordering and does
    // not sync (sync.js SYNC_STORE_KEYS).
    state.habitDone = loadHabitDone();
    state.habitRuns = loadHabitRuns();
  }
  // A pull that lands mid-session has to re-run the boundary sweep, not just
  // reload memory. The sweep is gated on having pulled (§4.3), so at boot it
  // legitimately refuses and returns having done nothing; without this, the
  // day it declined to finalize would sit unswept until the next resume.
  // Idempotent by construction -- processHabitBoundaries only writes when a
  // day actually needs finalizing, and re-renders only follow a real change.
  function afterSyncImport(){
    reloadSyncedStateFromStorage();
    processHabitBoundaries();
    // Unconditionally, not only when the sweep wrote something: the merge
    // itself just changed what the lanes should be showing, and nothing else
    // on the path from reconcile() to here redraws them (neither transport
    // does -- see dropboxTransport.js). Safe while a drafting page is open
    // because sync.js's apply gate has already refused to apply at all.
    KINDS.forEach(renderLane);
    updateLaneVisibility();
    updateHabitBadge();
  }
  Sync.setAfterImport(afterSyncImport);

  // DRAFT ISOLATION x sync, author ruling 2026-07-30 (option 1 of three
  // offered): a merge may not land while a drafting page is open. The other
  // two options were rejected for concrete failures -- applying underneath an
  // open page makes Save silently overwrite the other device's edit (or break
  // outright if that record was deleted remotely), and redrawing the page
  // destroys what you were typing, which is DRAFT ISOLATION's whole subject.
  //
  // Read-only screens (calendar, review) do NOT defer: they are computed from
  // "now" and are already re-rendered by every other date-moving path here.
  // The intray drawer does NOT defer either, and that distinction is
  // load-bearing rather than incidental -- openTray() runs in boot() on every
  // launch, so counting an open drawer as "drafting" would disable sync
  // permanently, on every device, silently. The drawer is not a screen;
  // state.screen stays null while it is open, which is what makes this safe.
  function syncApplyGateOpen(){
    if (!state.screen) return true;
    if (state.screen.calendarView || state.screen.reviewView) return true;
    return false;
  }
  Sync.setApplyGate(syncApplyGateOpen);
  Sync.registerRecordMerger("gtd_habit_runs", mergeHabitRunRecord);   // chunk B + W7: assertions settle a day, aggregates recomputed
  Sync.registerRecordMerger("gtd_habit_done", mergeHabitDoneRecord);  // W7: an assertion record is atomic, latest wins

  // Sync-on-save, trigger 5 of 5 (author ruling 2026-07-30, reversing the
  // earlier four-trigger decision). Debounced rather than immediate: saving a
  // project page writes several stores in a row, and completing a few items in
  // a burst is normal, so a short settle collapses those into one push instead
  // of one per write. Two seconds is long enough to coalesce a burst and short
  // enough that the other device sees the change while you are still thinking
  // about it.
  //
  // Note this deliberately fires even while a drafting page is open: the merge
  // will defer (syncApplyGateOpen) but the PUSH still happens, which is the
  // whole point of the amendment to option 1 -- saving must publish, whether
  // or not it is safe to pull right now.
  const SYNC_AFTER_CHANGE_MS = 2000;
  let syncAfterChangeTimer = null;
  function scheduleSyncAfterChange(){
    if (!Sync.isEnabled()) return; // no transport, or not connected: nothing to schedule
    if (syncAfterChangeTimer) clearTimeout(syncAfterChangeTimer);
    syncAfterChangeTimer = setTimeout(function(){
      syncAfterChangeTimer = null;
      runDropboxSync();
    }, SYNC_AFTER_CHANGE_MS);
  }
  Sync.setOnLocalChange(scheduleSyncAfterChange);

  // B1 (wrapper-plan.md §3.2): the boundary sweep used to run at boot only.
  // A resident app can sit backgrounded for days without a cold start, so
  // habits, recurring events and every deadline bar would silently stay on
  // whatever day the app last launched. Keyed off visibilitychange rather
  // than a Capacitor-only lifecycle event -- an Android WebView's document
  // goes hidden/visible across a background/foreground cycle the same way a
  // browser tab does, so one listener covers the wrapper AND a browser tab
  // left open overnight, with nothing wrapper-specific to wire up.
  function resweepBoundariesOnResume(){
    runDropboxSync(); // W5 trigger 2/4 (resume) -- same not-awaited reasoning as boot()'s call, same paragraph above
    processHabitBoundaries();
    processEventBoundaries();
    KINDS.forEach(renderLane);
    updateLaneVisibility();
    updateHabitBadge();
    updateQaTimeReadout();
    // Same split as applyQaTimeJump: a read-only screen computed from "now"
    // (calendar, review) needs telling the day moved; a drafting page must
    // not be re-rendered, or it tears down the input under the cursor.
    if (state.screen && (state.screen.calendarView || state.screen.reviewView)) renderScreen();
  }
  document.addEventListener("visibilitychange", function(){
    if (!document.hidden) resweepBoundariesOnResume();
    // W5 trigger 3/4 (backgrounding, best-effort). This fires at the exact
    // same OS signal as the app being swiped away entirely -- there is no
    // way to tell those two apart in advance (author confirmed this reading
    // after asking about an "on close" trigger; see dropboxTransport.js's
    // own header for what "best-effort" costs). Not awaited, cannot be:
    // nothing runs after the page goes hidden to await it. If the process
    // survives a few seconds, this is what pushes a change made right
    // before switching devices; if it does not, the next open/resume
    // anywhere picks it up instead -- verified surviving exactly this kind
    // of interruption in checks/dropbox_transport.py's group 2.
    else runDropboxSync();
  });

  // W2 (wrapper-plan.md): the mirror's one recovery branch. In a browser
  // restoreFromNativeMirrorIfWiped() resolves immediately (window.Capacitor
  // does not exist) so this is boot() on the very next microtask, same as
  // today. Only inside the wrapper, and only when localStorage looks wiped,
  // does boot wait on the native reads that repopulate it first.
  document.addEventListener("DOMContentLoaded", function(){
    restoreFromNativeMirrorIfWiped().then(boot).catch(boot);
  });

// =========================================================
// CALENDAR · EVENTS · RECURRENCE (chunk 7, spec.md §4.13–§4.15)
//
// An EVENT is a calendar entity that never lives in a lane (§4.13). It is
// created in the calendar, lives in gtd_events, and what appears in the
// lanes is a *view* of it: a bulleted widget at the top of Waiting (§4.13b)
// and, on its day, a PSEUDO-ACTION at the top of Next Actions (§4.14).
//
// Concatenated AFTER app.js in build.py, so every helper this module leans
// on (state, Storage, genId, escapeHtml, dateStrToDate, boundaryNow,
// openScreen, renderScreen, renderLane, saveTasksLocal, openConfirmDialog…)
// is a hoisted declaration in the same IIFE and resolves at call time. app.js
// likewise calls into the hoisted functions here (processEventBoundaries,
// openCalendarScreen, eventsHandleClick, saveEventScreen…).
//
// THE LOAD-BEARING INVARIANTS (each has a build-trap note in the spec):
//  · The pseudo-action's task ID is minted ON THE EVENT at creation, not at
//    first appearance (§4.14a) — event.taskId. This is what lets chunk 8 hook
//    a condition onto an event before its day with a plain task ID.
//  · The pseudo-action is a REAL stored row in state.tasks.next (drag pos,
//    context, completion), never a render-time projection (§4.14a).
//  · A recurring series is ONE live event that rolls forward — no spawning.
//    Its pseudo-action is REPLACED, not accumulated, and keeps the same task
//    ID across every roll (§4.15b, §4.14a).
// =========================================================

// ⚠ Translated (author QA: month/weekday/recurrence names were among the
// "buttons and textboxes" that never got wired to i18n). These used to be
// static consts evaluated once at parse time — that would have frozen
// whichever language was active at load, wrong the moment someone switches.
// Functions instead, called fresh on every render so a language switch is
// picked up the same way every other translated string already is.
const RECUR_KEY = { none: "doesNotRepeat", daily: "daily", weekly: "weekly", monthly: "monthly", yearly: "yearly" };
function recurOptions(){
  return ["none", "daily", "weekly", "monthly", "yearly"].map(function(v){ return { v: v, label: t("cal." + RECUR_KEY[v]) }; });
}
function recurLabel(v){ return t("cal." + (RECUR_KEY[v] || "repeats")); }
// ⚑ UNIFIED (author, 2026-08-01): this used to be its own ten-minute
// UNDO_WINDOW_MS, separate from the promotion pushback's five. They are
// the same feature for two data types -- un-completing shortly after
// completing undoes the side effect the completion caused -- so there is now
// one window, declared in app.js. See UNDO_WINDOW_MS there for the reasoning.

function loadEvents(){ return Storage.getJSON("gtd_events", null); }
function saveEvents(){ Storage.setJSON("gtd_events", state.events); }
function findEvent(id){ return (state.events || []).find(function(e){ return e.id === id; }) || null; }
function findEventByTaskId(taskId){ return (state.events || []).find(function(e){ return e.taskId === taskId; }) || null; }

// The clock, matching deadlineBarState() — real time plus the dev QA offset.
function nowInstant(){ return nowMs(); }

// The instant an occurrence "happens" (and, once past, goes overdue). A timed
// occurrence passes at its time; an UNTIMED one has no moment to converge on,
// so it passes at the 4 AM boundary that ENDS its app-day (§4.4d/§4.14c).
function occDueInstant(dateStr, timeStr){
  const d = dateStrToDate(dateStr);
  if (timeStr){ const p = timeStr.split(":").map(Number); d.setHours(p[0] || 0, p[1] || 0, 0, 0); return d.getTime(); }
  d.setHours(0, 0, 0, 0);
  return d.getTime() + 28 * 3600 * 1000; // next civil day, 4 AM
}
// The 4 AM boundary that BEGINS the app-day containing an occurrence — the
// pseudo-action's appearance moment and its progress-bar origin (§4.14b/c).
// Untimed occurrences are anchored at noon so the -4h shift can't drag them
// into the previous civil day (only 00:00–03:59 timed events do that, §4.14b).
function occAppearanceInstant(dateStr, timeStr){
  const d = dateStrToDate(dateStr);
  if (timeStr){ const p = timeStr.split(":").map(Number); d.setHours(p[0] || 0, p[1] || 0, 0, 0); }
  else d.setHours(12, 0, 0, 0);
  const shifted = new Date(d.getTime() - 4 * 3600 * 1000);
  return new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), 4, 0, 0, 0).getTime();
}
function occAppearanceCivil(dateStr, timeStr){ return dateToStr(new Date(occAppearanceInstant(dateStr, timeStr))); }
function occPassed(dateStr, timeStr){ return nowInstant() >= occDueInstant(dateStr, timeStr); }

// Next occurrence of a recurrence rule from a given date. Interval (the
// "every N" advanced option, user ruling A1) defaults to 1. Weekly is a
// single weekday (the date's own) for the sprint — multi-weekday weekly is
// deferred and flagged in the handoff.
function nextOccurrenceDate(dateStr, recurrence, interval){
  const d = dateStrToDate(dateStr);
  const n = Math.max(1, interval || 1);
  if (recurrence === "daily") d.setDate(d.getDate() + n);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + n);
  else if (recurrence === "yearly") d.setFullYear(d.getFullYear() + n);
  else return null;
  return dateToStr(d);
}
// (prevOccurrenceDate lived here. Its only caller was occursOnCanonical's
// backward walk, which is exactly the bug in QA #1/#2 — a series never needs to
// look behind its live date. Deleted rather than left for someone to reuse.)
function isRecurring(ev){ return ev && ev.recurrence && ev.recurrence !== "none"; }

// The first occurrence of `ev` that has NOT yet passed, as a CANONICAL date —
// the occurrence a picker should offer you (QA #31). A one-shot has only its
// own date, so a passed one yields null. A recurring series is different: its
// live date is frequently already behind us (completed, hidden, or simply
// awaiting the 4 AM roll), and the thing you can still hook a Waiting action
// onto is the NEXT occurrence, not the one that is gone. Walking forward here
// is safe — unlike occursOnCanonical's deleted backward walk, this never
// invents an occurrence the series has already left behind.
function nextLiveOccurrenceDate(ev){
  if (!ev) return null;
  let d = ev.date, guard = 0;
  if (!occPassed(effDate(ev, d), effTime(ev, d))) return d;
  if (!isRecurring(ev)) return null;
  while (guard++ < 400){
    const nd = nextOccurrenceDate(d, ev.recurrence, ev.interval);
    if (!nd) return null;
    d = nd;
    if (!occPassed(effDate(ev, d), effTime(ev, d))) return d;
  }
  return null;
}

// =========================================================
// PER-OCCURRENCE OVERRIDES (user ruling #3: "edit particular events, not just
// series"). The one-live-entity model has no storage for a single overridden
// occurrence (§4.15b), so we add the smallest thing that does: an `overrides`
// map on the event, keyed by an occurrence's CANONICAL date (the date the pure
// recurrence rule lands it on — never moved). Each entry carries occurrence-
// level fields only: title, time, notesClean. Everything else (recurrence,
// interval, pause, context, project link, tickler) stays series-level.
// The EFFECTIVE value of an occurrence = the override for its date if present,
// else the series value. Scope is chosen at save via a dialog that mirrors the
// recurring-delete one. ⚑ Moving a single occurrence to a DIFFERENT day is out
// of scope (use "Skip this one", or edit the series) — flagged in the handoff.
// =========================================================
function occOverride(ev, canonicalDate){ return (ev && ev.overrides && ev.overrides[canonicalDate]) || null; }
function has(o, k){ return o && Object.prototype.hasOwnProperty.call(o, k); }
function effTitle(ev, d){ const o = occOverride(ev, d); return has(o, "title") ? o.title : ev.title; }
function effTime(ev, d){ const o = occOverride(ev, d); return has(o, "time") ? o.time : (ev.time || null); }
function effNotes(ev, d){ const o = occOverride(ev, d); return has(o, "notesClean") ? o.notesClean : (ev.notesClean || ""); }
// The occurrence's EFFECTIVE date — where it actually lands and displays. A
// single occurrence can be moved to a different day (override.date); the roll
// math and override key still use the CANONICAL date the rule produced.
function effDate(ev, canonicalDate){ const o = occOverride(ev, canonicalDate); return (o && o.date) ? o.date : canonicalDate; }
function daysBetween(a, b){ return Math.round((dateStrToDate(b).getTime() - dateStrToDate(a).getTime()) / 86400000); }
function addDaysStr(s, n){ return dateToStr(addDaysToDate(dateStrToDate(s), n)); }
// Which canonical occurrence(s) of `ev` display on `displayDate` (0, 1, or —
// if another occurrence was moved onto this day — more). Returns canonical
// dates, so callers can look up effective title/time/completion by key.
function canonicalsForDisplayDay(ev, displayDate){
  const out = [];
  // (a) the occurrence whose canonical date IS this day, unless it was moved away
  if (occursOnCanonical(ev, displayDate) && effDate(ev, displayDate) === displayDate) out.push(displayDate);
  // (b) any overridden occurrence moved ONTO this day from elsewhere
  if (ev.overrides){
    Object.keys(ev.overrides).forEach(function(c){
      if (c !== displayDate && ev.overrides[c] && ev.overrides[c].date === displayDate && occursOnCanonical(ev, c)) out.push(c);
    });
  }
  return out;
}
// After a roll, an override keyed to a now-past canonical date is dead weight.
function pruneOverrides(ev){
  if (!ev.overrides) return;
  Object.keys(ev.overrides).forEach(function(k){ if (k < ev.date) delete ev.overrides[k]; });
}

// §4.3b/§4.8b (chunk 7): a linked event/appointment is forward motion — a
// project planned around "act after the conference on the 14th" is NOT
// stalled. A recurring series always counts; a one-shot counts until it is
// completed (a long-past, done event no longer keeps a project alive).
function projectHasLinkedEvent(projectId){
  return (state.events || []).some(function(ev){
    if (ev.linkedProjectId !== projectId) return false;
    if (isRecurring(ev)) return true;
    return (ev.completedOccs || []).indexOf(ev.date) === -1;
  });
}

// =========================================================
// THE PSEUDO-ACTION (§4.14) — an event that displays as a Next Action.
// =========================================================
function isPseudoAction(task){ return !!(task && task.eventId); }

// The stored row. It carries the event's OWN occurrence date/time (occDate/
// occTime), independent of the live event.date, so it can sit in the lane as
// a past-due missed occurrence AFTER the series has already rolled its
// projection forward — and only flip to the new occurrence when that
// occurrence's app-day begins (§4.15b: "replaced at the 4 AM boundary of the
// next occurrence's app-day").
function makePseudoActionRow(ev){
  const c = ev.date; // canonical live occurrence (roll math + override key)
  return {
    id: ev.taskId, eventId: ev.id, isGroup: false, parent: null,
    title: effTitle(ev, c), notesClean: effNotes(ev, c),
    contextId: ev.contextId || null, linkedProjectId: ev.linkedProjectId || null,
    occCanon: c, occDate: effDate(ev, c), occTime: effTime(ev, c), // occDate = EFFECTIVE (where it lands)
    deadline: null, whenText: null, conditionId: null, conditionKind: null, conditionLabel: null,
    bundleText: null, createdAt: nowMs()
  };
}
function findPseudoRow(eventId){ return state.tasks.next.find(function(t){ return t.eventId === eventId; }) || null; }

// Drop a fresh pseudo-action at the top of its inherited context (or the top
// of the lane when it has none) — the §4.15b "lands at the top of that
// context" rule, reused for first appearance too.
function insertPseudoAtTop(row){
  const ctx = row.contextId;
  if (ctx){
    const idx = state.tasks.next.findIndex(function(t){ return !t.isGroup && t.contextId === ctx; });
    if (idx !== -1){ state.tasks.next.splice(idx, 0, row); return; }
  }
  state.tasks.next.unshift(row);
}

// The whole boundary sweep for events — mirrors processHabitBoundaries(), and
// like it is idempotent and safe to run on every boot/QA-jump. Returns true
// if anything changed (so the caller can persist + re-render).
function processEventBoundaries(){
  const today = todayStr();
  let changed = false;

  // DEFENSIVE SWEEP (sync-audit.md §4c, chunk A). A pseudo-action is derived
  // from an event; if that event is gone, the row is not derivable from
  // anything and must not survive. Reachable through ordinary use as soon as
  // there are two devices: delete a recurring event on the phone, and the
  // merge removes it from gtd_events here -- but the row lives in
  // gtd_tasks_next, is deliberately NOT synced (derived state does not
  // travel), and nothing else would ever clear it. The result is a live Next
  // Action for an event that no longer exists, which cannot be completed or
  // opened sensibly.
  //
  // ⚑ Note this is the OPPOSITE fallback to buildTree's orphaned `parent`,
  // and deliberately so. The rule is not "always keep it visible" -- it is:
  //   · data the USER authored must never vanish -> fall back to visible
  //   · DERIVED data must vanish when its source does -> fall back to gone
  // Keeping a derived orphan visible would leave a phantom row that acts on
  // nothing, which is a worse lie than removing it.
  const liveEventIds = {};
  (state.events || []).forEach(function(ev){ if (ev && ev.id) liveEventIds[ev.id] = true; });
  const beforeSweep = state.tasks.next.length;
  state.tasks.next = state.tasks.next.filter(function(t){ return !t.eventId || liveEventIds[t.eventId]; });
  if (state.tasks.next.length !== beforeSweep) saveTasksLocal("next");

  (state.events || []).forEach(function(ev){
    // A completed NON-recurring occurrence keeps its (dimmed) calendar mark
    // but has no live pseudo-action — nothing to sweep. A completed RECURRING
    // occurrence rolls once its 10-minute undo window closes (below).
    if (ev.paused){
      // Paused: stops rolling AND stops projecting (§4.15b). Any pseudo-action
      // already in the lane is left exactly where it is.
      return;
    }
    if (isRecurring(ev)){
      // (1) COMPLETION-DRIVEN roll: once the undo window after the pseudo-action's completion
      //     completed, the series moves on (§4.15b/§4.15c). Before the window
      //     closes, un-completing rolls it back (restorePseudoAction).
      if (ev.completedAt != null && nowInstant() >= ev.completedAt + UNDO_WINDOW_MS){
        const nd = nextOccurrenceDate(ev.completedFrom || ev.date, ev.recurrence, ev.interval);
        if (nd){ ev.date = nd; }
        ev.completedAt = null; ev.completedFrom = null;
        changed = true;
      }
      // (2) PASS-DRIVEN roll: an uncompleted occurrence whose whole app-day is
      //     already behind us is a stale miss — advance the projection past it
      //     (one live entity, no accumulation). The occurrence whose app-day is
      //     TODAY stays put, even if its time already passed today, so a missed
      //     appointment still shows as past-due until tomorrow's boundary.
      let guard = 0;
      while (ev.completedAt == null && guard++ < 400){
        const appearCivil = occAppearanceCivil(ev.date, ev.time);
        if (appearCivil < today && occPassed(ev.date, ev.time)){
          // ⚑ Remember the miss before rolling past it (user ruling: "only keep
          // the most recent miss in the review").
          //
          // A one-shot that goes unticked keeps its pseudo-action and so reaches
          // the review on its own. A SERIES did not: rolling forward erased the
          // occurrence, so a standup you simply forgot to tick vanished at 4 AM
          // with no trace. The roll itself is right and stays — "one live
          // entity, no accumulation" is what stops a month of ignored dailies
          // becoming thirty review rows — so the miss is recorded beside the
          // series rather than by holding the series back.
          //
          // ONE slot, deliberately: a newer miss overwrites an older unhandled
          // one, which is exactly "most recent only". Rolling past several in a
          // single sweep therefore leaves the LAST one, the one still worth
          // asking about.
          if ((ev.completedOccs || []).indexOf(ev.date) === -1){
            ev.missedOcc = ev.date;
          }
          const nd = nextOccurrenceDate(ev.date, ev.recurrence, ev.interval);
          if (!nd) break;
          ev.date = nd; changed = true;
        } else break;
      }
      pruneOverrides(ev); // drop overrides for occurrences the series has passed
    }
    // (3) APPEARANCE / REPLACEMENT. Timing keys off the occurrence's EFFECTIVE
    //     date/time — a single occurrence moved to another day appears on that
    //     day instead. Once its app-day has begun, ensure exactly one pseudo-
    //     action exists; a row still showing an earlier occurrence is REPLACED
    //     IN PLACE (same task ID, inherited context, top of context — §4.15b).
    if (ev.completedAt != null) return; // completed occurrence: no live row until it rolls
    // A COMPLETED occurrence has no live row (§4.14a). A recurring series is
    // held here by completedAt until its roll — but a ONE-SHOT never sets
    // completedAt, so without this check the sweep re-mints its pseudo-action
    // on every boot/QA-jump: a long-done event walks back into Next Actions,
    // arriving with a full red "passed" bar because its occDate is in the past.
    // Keyed by CANONICAL date, the same key completedOccs is written with.
    const doneOccs = ev.completedOccs || [];
    if (doneOccs.indexOf(ev.date) !== -1){
      // Heal state already corrupted by the above: a row for an occurrence
      // that is recorded complete is a ghost — drop it. (Idempotent, like the
      // rest of the sweep, so it self-repairs on the next boot.)
      const ghost = findPseudoRow(ev.id);
      if (ghost && doneOccs.indexOf(ghost.occCanon) !== -1){
        state.tasks.next = state.tasks.next.filter(function(t){ return t.id !== ghost.id; });
        changed = true;
      }
      return;
    }
    const eff = effDate(ev, ev.date), effT = effTime(ev, ev.date);
    const appearCivil = occAppearanceCivil(eff, effT);
    const row = findPseudoRow(ev.id);
    if (today < appearCivil){
      // Not its day yet. If a row for THIS canonical occurrence is sitting in
      // the lane — because the user just MOVED the live occurrence into the
      // future — retire it; it will re-appear on the moved day. (A past-due row
      // from an already-rolled occurrence has occCanon < ev.date and is left.)
      if (row && row.occCanon === ev.date){ state.tasks.next = state.tasks.next.filter(function(t){ return t.id !== row.id; }); changed = true; }
      return;
    }
    if (!row){
      insertPseudoAtTop(makePseudoActionRow(ev));
      changed = true;
    } else if (row.occCanon !== ev.date){
      // Rolled to a new occurrence — replace in place, inheriting context.
      row.occCanon = ev.date; row.occDate = eff; row.occTime = effT;
      row.title = effTitle(ev, ev.date); row.notesClean = effNotes(ev, ev.date);
      row.linkedProjectId = ev.linkedProjectId || null;
      if (row.contextId && !findContext(row.contextId)) row.contextId = null; // §7 EMERGENCY RULE
      state.tasks.next = state.tasks.next.filter(function(t){ return t.id !== row.id; });
      insertPseudoAtTop(row);
      changed = true;
    } else {
      // Same occurrence still live: keep drag position, refresh effective fields
      // (a time/title/date override or a series edit may have changed them).
      const nt = effTitle(ev, ev.date), nn = effNotes(ev, ev.date);
      if (row.occDate !== eff || row.occTime !== effT || row.title !== nt || row.notesClean !== nn){
        row.occDate = eff; row.occTime = effT; row.title = nt; row.notesClean = nn; changed = true;
      }
    }
  });
  if (changed){ saveTasksLocal("next"); saveEvents(); } // rolls/clears mutate BOTH stores
  return changed;
}

// Completing a pseudo-action (from the lane checkbox, its event page, or the
// review) archives the card like any Next Action AND writes back to the event
// (§4.14a). For a recurring series this arms the 10-minute roll; for a
// one-shot it just records the completed occurrence (kept, dimmed, on the
// calendar — user ruling #6). Called from completeTask() after it archives.
function onPseudoActionCompleted(task){
  const ev = findEvent(task.eventId);
  if (!ev) return;
  const occ = task.occCanon || ev.date; // completion is tracked by CANONICAL date (roll math)
  ev.completedOccs = ev.completedOccs || [];
  if (ev.completedOccs.indexOf(occ) === -1) ev.completedOccs.push(occ);
  // ⚑ QA (user): "I completed the pay rent event after it was past due in the
  // lane, but it still showed up in the daily review." Both halves were behaving
  // as written and the pair was still wrong. A series can hold BOTH a live
  // past-due row (today's occurrence, unticked) and a recorded miss from an
  // earlier day; computeOpenLoops deliberately shows only the live one, because
  // the single-slot design exists to stop one series filling the queue. Ticking
  // the live row removed it — and the older miss, which the user had never been
  // shown, took its place. From the outside that is completion doing nothing.
  //
  // Answering the more recent question retires the older one: the review only
  // ever promises the MOST RECENT miss (§4.8b), and resurrecting a stale one the
  // moment its successor is settled breaks that promise. Guarded on the date so
  // this can only ever clear a miss the completion actually supersedes.
  if (ev.missedOcc && ev.missedOcc <= occ) ev.missedOcc = null;
  if (isRecurring(ev)){
    ev.completedAt = nowInstant();
    ev.completedFrom = occ;
  }
  saveEvents();
}
// Un-completing (restoreTask) within the 10-minute window rolls a series back
// and returns the pseudo-action; outside it, the archive entry stands and the
// series has moved on (§4.15c). Called from restoreTask BEFORE it unshifts the
// row back into the lane; returns true if the restore should proceed normally.
function onPseudoActionRestored(task){
  const ev = findEventByTaskId(task.id) || findEvent(task.eventId);
  if (!ev) return true; // event deleted meanwhile: restore as a plain orphaned row
  const occ = task.occCanon || task.occDate || ev.date;
  if (isRecurring(ev)){
    // Inside the undo window (§4.15c): roll the series back and let the
    // pseudo-action return. Outside it: the archive entry stands and the series
    // has moved on — REFUSE the restore so it can't duplicate the rolled row.
    if (ev.completedAt != null && nowInstant() < ev.completedAt + UNDO_WINDOW_MS){
      ev.completedAt = null; ev.completedFrom = null;
    } else {
      return false;
    }
  }
  // A live row with this task ID would collide (belt-and-braces).
  if (findPseudoRow(ev.id) && findPseudoRow(ev.id).id === task.id) return false;
  ev.completedOccs = (ev.completedOccs || []).filter(function(d){ return d !== occ; });
  saveEvents();
  return true;
}

// =========================================================
// THE PSEUDO-ACTION PROGRESS BAR (§4.14c / §4.4d).
//
// ONE RULE, both shapes: the bar starts EMPTY at the moment the pseudo-action
// appears — the 4 AM boundary beginning its app-day — and fills linearly to the
// moment the occurrence happens. Red in the final 15%, passed after.
//   · Appointment (timed): 4 AM → the time.
//   · Untimed event:       4 AM → the 4 AM that ENDS the app-day (a flat 24h),
//                          so it reaches full exactly as it goes past-due.
//
// ⚑ CORRECTED (user, this round): the untimed case used to return a FULL bar
// for the whole day, on a "Full ≠ late" reading recorded in §4.4d/§4.14c as a
// user ruling. That was a miscommunication — the actual ruling is the one above
// (the bar begins when the row appears), and a bar that is full from the moment
// you first see it carries no information. spec.md §4.4d/§4.14c updated to match.
// =========================================================
function pseudoBarState(dateStr, timeStr){
  const now = nowInstant();
  const due = occDueInstant(dateStr, timeStr);
  if (now >= due) return { full: true, red: true, passed: true, fillPercent: 100 };
  const origin = occAppearanceInstant(dateStr, timeStr);
  const total = due - origin;
  if (total <= 0) return { full: true, red: false, passed: false, fillPercent: 100 };
  const frac = Math.max(0, Math.min(1, (now - origin) / total));
  return { full: false, red: frac >= 0.85, passed: false, fillPercent: Math.round(frac * 100) };
}
function pseudoBarHtml(task){
  const s = pseudoBarState(task.occDate, task.occTime);
  const classes = "deadline-bar" + (s.full ? " full" : "") + (s.red ? " red" : "") + (s.passed ? " passed" : "");
  // An event has no push counter (recurrence is its own thing), but it uses the
  // same chip wrapper so there is one positioning system, not two.
  const chip = s.passed ? '<span class="deadline-chips"><span class="deadline-passed-chip">passed</span></span>' : "";
  return '<div class="' + classes + '" style="--fill:' + s.fillPercent + '%"><div class="deadline-bar-fill"></div>' + chip + '</div>';
}
// Is this pseudo-action past-due? Used by the review's past-due kind (§4.8b,
// pseudo-action shape) — mirrors deadlineBarState().passed for real deadlines.
function pseudoPassed(task){ return pseudoBarState(task.occDate, task.occTime).passed; }

// (pseudoDescriptor lived here — it returned "appointment" or "event" for the
// text in front of a date. Its callers were removed in the jargon pass that took
// out "adding a time makes it an appointment"; the function outlived them as
// dead code. Deleted rather than left for someone to wire back up: the user's
// ruling is that the distinction is real but carries no information a reader
// needs, so it belongs on a label at most, never in a sentence.)

// =========================================================
// DUPLICATE-TITLE SCOPE FOR EVENTS (§7). An event is not in a lane, so
// "per-lane" doesn't define its scope: check gtd_events AND the Next Actions
// lane, because on its day the event mints a pseudo-action THERE, through a
// 4 AM sweep no save-time check can intercept. Prevent where it is cheap.
// =========================================================
function eventTitleClashes(title, exceptEventId){
  const n = (title || "").trim().toLowerCase();
  if (!n) return false;
  const inEvents = (state.events || []).some(function(e){
    return e.id !== exceptEventId && (e.title || "").trim().toLowerCase() === n;
  });
  if (inEvents) return true;
  return state.tasks.next.some(function(t){
    // Skip the event's own pseudo-action — it legitimately shares the title.
    if (t.isGroup || (t.eventId && t.eventId === exceptEventId)) return false;
    return (t.title || "").trim().toLowerCase() === n;
  });
}

// No sample events (author correction): disposable demo filler duplicated the
// tutorial's job, same reasoning that already removed the generic filler
// sample TASKS (Email Sarah, Website relaunch, etc. — see seedData in app.js)
// before this — the calendar's equivalent just got missed in that pass.
function seedEvents(){
  state.events = [];
  saveEvents();
}

// =========================================================
// THE WAITING-LANE WIDGET (§4.13b) — a yellow-bordered box atop Waiting with a
// bulleted list of events/appointments within 7 days. Not interactive beyond
// opening the calendar. Ticklers are excluded (user addition: set-and-forget
// reminders stay off the calendar list until their day).
// =========================================================
function upcomingWidgetEvents(){
  const today = todayStr();
  const horizon = dateToStr(addDaysToDate(dateStrToDate(today), 7));
  const out = [];
  (state.events || []).forEach(function(ev){
    if (ev.tickler || ev.paused) return;
    // The live occurrence, plus any projected recurrences, that fall in-window
    // by their EFFECTIVE date (a moved occurrence rides on its new day). Walk a
    // few canonical steps past the horizon so a moved-earlier occurrence isn't
    // missed.
    let d = ev.date, guard = 0;
    while (guard++ < 70){
      const e = effDate(ev, d);
      if (d > horizon && e > horizon) break;
      if (e >= today && e <= horizon) out.push({ date: e, time: effTime(ev, d), title: effTitle(ev, d) });
      if (!isRecurring(ev)) break;
      const nd = nextOccurrenceDate(d, ev.recurrence, ev.interval);
      if (!nd || nd <= d) break;
      d = nd;
    }
  });
  out.sort(function(a, b){ return (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")); });
  return out.slice(0, 8);
}
function waitingWidgetHtml(){
  const items = upcomingWidgetEvents();
  const bullets = items.length
    ? items.map(function(it){
        const d = dateStrToDate(it.date);
        const ds = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        const when = it.time ? ds + " · " + it.time : ds;
        return '<li><span class="cal-widget-when">' + escapeHtml(when) + '</span> ' + escapeHtml(it.title) + '</li>';
      }).join("")
    : '<li class="cal-widget-empty">' + escapeHtml(t("cal.nothingNext7Days")) + '</li>';
  return (
    '<div class="cal-widget" data-action="open-calendar" title="' + escapeHtml(t("cal.openCalendar")) + '">' +
      '<div class="cal-widget-icon">&#128197;</div>' +
      '<ul class="cal-widget-list">' + bullets + '</ul>' +
    '</div>'
  );
}

// Collapse repeated completions of one recurring series into a single row
// (§4.15b: "Pay rent ×6"). Order-preserving: only items with a truthy seriesId
// fold together (at their most-recent occurrence); everything else stays a
// singleton, so plain completed actions are untouched.
function collapseCompletedSeries(items){
  const out = [];
  const bySeries = {};
  (items || []).forEach(function(t){
    if (t.seriesId && bySeries[t.seriesId]){ bySeries[t.seriesId].count++; return; }
    const entry = { task: t, count: 1 };
    if (t.seriesId) bySeries[t.seriesId] = entry;
    out.push(entry);
  });
  return out;
}

// Linked-event rows for a project page (§4.15d) — displays-as-an-action,
// nearest→farthest. Tapping opens the event page as a child screen.
// `stagedEvents` are events added from an UNSAVED project page: they are not in
// state.events yet (§12.1 staging) but the page must still show what it is about
// to create, or adding one looks like it did nothing.
// alsoLinkIds (W7): events being ATTACHED to this project by a staged link.
// They are real events with a real page, so unlike stagedEvents they are not
// inert -- they simply do not carry linkedProjectId yet, because nothing on a
// drafting page is written until Save.
function projectLinkedEventRowsHtml(projectId, stagedEvents, alsoLinkIds, unlinkIds){
  if (!projectId) return "";
  const alsoSet = {};
  (alsoLinkIds || []).forEach(function(id){ alsoSet[id] = 1; });
  // W7: a staged detach leaves the list immediately, like a staged link joins it.
  const goneSet = {};
  (unlinkIds || []).forEach(function(id){ goneSet[id] = 1; });
  const evs = (state.events || []).filter(function(ev){ return (ev.linkedProjectId === projectId || alsoSet[ev.id]) && !goneSet[ev.id]; })
    .concat((stagedEvents || []).filter(function(ev){ return ev.linkedProjectId === projectId; }));
  if (!evs.length) return "";
  // Show the live occurrence at its EFFECTIVE date/time (a moved one included).
  evs.sort(function(a, b){ return (effDate(a, a.date) + (effTime(a, a.date) || "99:99")).localeCompare(effDate(b, b.date) + (effTime(b, b.date) || "99:99")); });
  const stagedIds = {};
  (stagedEvents || []).forEach(function(ev){ stagedIds[ev.id] = 1; });
  return evs.map(function(ev){
    const d = dateStrToDate(effDate(ev, ev.date));
    const when = d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + (effTime(ev, ev.date) ? " · " + effTime(ev, ev.date) : "");
    // A staged event has no event page to open — it is not in state.events yet, so
    // openEventScreen would find nothing. It renders as an inert row until the
    // project save makes it real, which is also the honest signal that it is not
    // committed.
    const staged = !!stagedIds[ev.id];
    let row = staged
      ? '<span class="linked-action-item linked-action-staged" title="' + escapeHtml(t("project.savesWithProject")) + '">' +
          '<span class="kind-dot kind-event" aria-hidden="true"></span>' + escapeHtml(effTitle(ev, ev.date)) +
          ' <span class="cal-agenda-kind">' + escapeHtml(when) + '</span></span>'
      : '<button type="button" class="linked-action-item" data-action="open-event" data-id="' + ev.id + '">' +
          '<span class="kind-dot kind-event" aria-hidden="true"></span>' + escapeHtml(effTitle(ev, ev.date)) +
          ' <span class="cal-agenda-kind">' + escapeHtml(when) + '</span></button>';
    // §4.15d: a Waiting action hooked to this linked event nests beneath it,
    // the same as one hooked to a linked action (chunk 8 event-conditioning).
    state.tasks.waiting.forEach(function(t){
      if (t.isGroup || t.conditionId !== ev.taskId) return;
      row += '<button type="button" class="linked-action-item indented" data-action="open-edit" data-kind="waiting" data-id="' + t.id + '">' +
        '<span class="kind-dot kind-waiting" aria-hidden="true"></span>' + escapeHtml(t.title) + '</button>';
    });
    return row;
  }).join("");
}

// =========================================================
// THE CALENDAR VIEW (§4.15) — full-screen, Month · Day tabs, a creation row.
// Its own screen view (like the review), pushed so opening an item's real page
// returns here.
// =========================================================
function openCalendarScreen(prefill){
  const today = todayStr();
  const sel = (prefill && prefill.date) || today;
  const d = dateStrToDate(sel);
  state.screen = {
    calendarView: true, kind: "calendar", taskId: null, draft: {},
    calTab: "month", calY: d.getFullYear(), calM: d.getMonth(), calSel: sel,
    calKind: "event", calName: (prefill && prefill.name) || "", calTime: "", calDesc: "",
    calRecur: "none", calInterval: 1, calDeadlineFor: "next", calTickler: false,
    // §9 (review-surface-plan.md): the habit-bubble ✕. Per-draft, not stored —
    // clears whenever recurrence changes (see the "recur" field handler below),
    // so the bubble comes back next time daily/weekly is picked, per author ruling.
    calHabitBubbleDismissed: false,
    calInvalid: false, calFromCaptureId: (prefill && prefill.fromCaptureId) || null,
    // Opened from a project page (user): the event that gets added is linked to
    // that project, the project's deadline caps the date, and adding returns
    // you there rather than parking you in the calendar.
    calForProjectId: (prefill && prefill.forProjectId) || null,
    calForProjectName: (prefill && prefill.forProjectName) || "",
    calForProjectDeadline: (prefill && prefill.forProjectDeadline) || null,
    // Set only when the project page that opened this is UNSAVED — calAdd then
    // stages the event into that page's draft instead of writing it (§12.1).
    calForProjectStaging: (prefill && prefill.forProjectStaging) || null,
    calError: null
  };
  renderScreen();
}
function dowShortList(){ return [0, 1, 2, 3, 4, 5, 6].map(function(i){ return t("cal.dowShort." + i); }); }
function monthName(i){ return t("cal.month." + i); }

// Every mark that lands on a given civil day, in truncation-priority order:
// appointments → deadlines → events → projected recurrences (§4.15). Each is
// { cls, kind } where kind drives the shape/colour.
function marksForDay(dateStr){
  const appts = [], events = [], projected = [];
  (state.events || []).forEach(function(ev){
    if (ev.tickler) return; // set-and-forget: no month-grid mark (user addition)
    // Marks key off the EFFECTIVE date: an occurrence moved onto this day shows
    // here; one moved away doesn't. Canonicals let us read the right effective
    // time / completion for each.
    canonicalsForDisplayDay(ev, dateStr).forEach(function(canon){
      const t = effTime(ev, canon);
      const completed = (ev.completedOccs || []).indexOf(canon) !== -1;
      const isLive = canon === ev.date;
      const doneCls = completed ? " cal-mark-done" : "";
      if (isLive){
        (t ? appts : events).push({ kind: t ? "appt" : "event", cls: "cal-mark-" + (t ? "appt" : "event") + doneCls });
      } else if (completed){
        // ⚑ Checked BEFORE the projection branch (QA #1/#2). A completed
        // occurrence of a live series is a thing that HAPPENED — it earns the
        // dimmed solid mark, not the hollow "coming up" one. Ordering these
        // the other way round drew every past completion as a projection.
        events.push({ kind: "event", cls: "cal-mark-" + (t ? "appt" : "event") + " cal-mark-done" });
      } else if (isRecurring(ev) && !ev.paused){
        // Strictly future by construction now: occursOnCanonical no longer
        // reports past dates for a live series unless they were completed.
        projected.push({ kind: "proj", cls: "cal-mark-" + (t ? "appt" : "event") + " cal-mark-proj" + doneCls });
      }
    });
  });
  const deadlines = [];
  state.tasks.next.forEach(function(t){
    if (t.isGroup || t.eventId) return; // pseudo-actions draw via gtd_events, not here
    if (t.deadline && t.deadline.date === dateStr) deadlines.push({ kind: "dl", cls: "cal-mark-dl-next" });
  });
  state.tasks.current.forEach(function(t){
    if (t.isGroup) return;
    if (t.deadline && t.deadline.date === dateStr) deadlines.push({ kind: "dl", cls: "cal-mark-dl-current" });
  });
  return appts.concat(deadlines, events, projected);
}
// Whether a recurring event has a (non-live) projected occurrence exactly on
// dateStr, within a bounded search from its live date.
function occursOnCanonical(ev, dateStr){
  if (!isRecurring(ev)) return ev.date === dateStr;
  if (dateStr === ev.date) return true;
  // ⚑ QA #1 and #2, which were one bug. A recurring series is ONE live entity
  // that rolls FORWARD (§4.15b): dates before the live one are occurrences the
  // series has already left behind — completed, missed, or explicitly skipped.
  // None of them are projections of anything. This used to walk BACKWARDS to
  // "find" them, which drew hollow future-marks across every past month (#2)
  // and kept drawing a skipped occurrence after the skip had rolled the series
  // past it (#1). The one past occurrence that still has something to say is a
  // COMPLETED one, which keeps its dimmed mark (user ruling #6) — and it is
  // recorded in completedOccs, so it needs no walking at all.
  if (dateStr < ev.date) return (ev.completedOccs || []).indexOf(dateStr) !== -1;
  let d = ev.date, guard = 0;
  while (guard++ < 400){
    const nd = nextOccurrenceDate(d, ev.recurrence, ev.interval);
    if (!nd || nd > dateStr) break;
    d = nd;
    if (d === dateStr) return true;
  }
  return false;
}

function calMarksHtml(dateStr){
  const marks = marksForDay(dateStr);
  if (!marks.length) return "";
  const shown = marks.slice(0, 3);
  const overflow = marks.length > 3;
  let html = '<div class="cal-marks">';
  shown.forEach(function(m){ html += '<span class="cal-mark ' + m.cls + '"></span>'; });
  if (overflow) html += '<span class="cal-mark-overflow">+</span>';
  return html + '</div>';
}

function calMonthGridHtml(y, m){
  const today = todayStr();
  const first = new Date(y, m, 1);
  const startDow = first.getDay(); // Sunday start (user #7)
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  let cells = "";
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell cal-cell-blank"></div>';
  for (let day = 1; day <= daysInMonth; day++){
    const ds = dateToStr(new Date(y, m, day));
    const isToday = ds === today;
    const isSel = ds === state.screen.calSel;
    cells += '<button type="button" class="cal-cell' + (isToday ? " cal-today" : "") + (isSel ? " cal-selected" : "") + '" data-action="cal-select" data-date="' + ds + '">' +
      '<span class="cal-daynum">' + day + '</span>' + calMarksHtml(ds) +
    '</button>';
  }
  const head = dowShortList().map(function(d){ return '<div class="cal-dow">' + escapeHtml(d) + '</div>'; }).join("");
  return '<div class="cal-grid"><div class="cal-dow-row">' + head + '</div><div class="cal-cells">' + cells + '</div></div>';
}

// Everything on the selected day, no truncation (§4.15). Agenda list: untimed
// first, then timed nearest→farthest (user ruling #4). Ticklers DO show in Day
// view — only the month grid and the widget hide them (user addition).
function calDayAgendaHtml(dateStr){
  const rows = [];
  (state.events || []).forEach(function(ev){
    // An occurrence shows on the day it EFFECTIVELY lands (moved ones included);
    // data-date carries the CANONICAL key so an edit targets the right override.
    canonicalsForDisplayDay(ev, dateStr).forEach(function(canon){
      const done = (ev.completedOccs || []).indexOf(canon) !== -1;
      // ⚠ Named `evTime`, not `t` — this function calls the i18n t() function,
      // and a local `t` here would shadow it (see completedBodyHtml in app.js
      // for the same fix, same reasoning).
      const evTime = effTime(ev, canon), title = effTitle(ev, canon);
      const moved = effDate(ev, canon) !== canon;
      rows.push({
        sort: (evTime ? "1" + evTime : "0"), timed: !!evTime,
        html: '<button type="button" class="cal-agenda-row' + (done ? " cal-agenda-done" : "") + '" data-action="cal-open-event" data-id="' + ev.id + '" data-date="' + canon + '">' +
          '<span class="cal-agenda-dot ' + (evTime ? "cal-mark-appt" : "cal-mark-event") + '"></span>' +
          '<span class="cal-agenda-when">' + (evTime ? escapeHtml(evTime) : escapeHtml(t("cal.allDay"))) + '</span>' +
          '<span class="cal-agenda-title">' + escapeHtml(title) +
            (moved ? ' <span class="cal-agenda-kind">' + escapeHtml(t("cal.moved")) + '</span>' : "") +
            (ev.tickler ? ' <span class="cal-tickler-tag">' + escapeHtml(t("cal.hidden")) + '</span>' : "") + '</span>' +
        '</button>'
      });
    });
  });
  function deadlineRow(task, laneKind){
    if (!(task.deadline && task.deadline.date === dateStr) || task.isGroup || task.eventId) return;
    rows.push({
      sort: (task.deadline.time ? "1" + task.deadline.time : "0"), timed: !!task.deadline.time,
      html: '<button type="button" class="cal-agenda-row" data-action="cal-open-task" data-lane="' + laneKind + '" data-id="' + task.id + '">' +
        '<span class="cal-agenda-dot cal-mark-dl-' + (laneKind === "current" ? "current" : "next") + '"></span>' +
        '<span class="cal-agenda-when">' + (task.deadline.time ? escapeHtml(task.deadline.time) : escapeHtml(t("cal.due"))) + '</span>' +
        '<span class="cal-agenda-title">' + escapeHtml(task.title) + ' <span class="cal-agenda-kind">' + escapeHtml(laneKind === "current" ? t("cal.projectDeadline") : t("cal.actionDeadline")) + '</span></span>' +
      '</button>'
    });
  }
  state.tasks.next.forEach(function(task){ deadlineRow(task, "next"); });
  state.tasks.current.forEach(function(task){ deadlineRow(task, "current"); });
  rows.sort(function(a, b){ return a.sort.localeCompare(b.sort); });
  if (!rows.length) return '<div class="cal-day-empty">' + escapeHtml(t("cal.nothingOnThisDay")) + '</div>';
  return '<div class="cal-agenda">' + rows.map(function(r){ return r.html; }).join("") + '</div>';
}

// =========================================================
// LIST VIEW (QA #33) — everything dated, in the order it happens.
//
// The month grid answers "what does this month look like"; Day answers "what is
// on this day". Neither answers "what is coming, in order", and that is the
// question this view exists for. So its inclusion rules are deliberately WIDER
// than the grid's, in the three ways the user called out:
//   · HIDDEN (tickler) events appear. The grid hides them because they are
//     set-and-forget; a complete index that silently omits things is not one.
//   · PAUSED series appear, at their next projected occurrence, tagged. The
//     grid projects nothing for a paused series — right there, wrong here.
//   · ONE row per repeating series, never one per occurrence. This is also what
//     bounds the list: a series contributes a single row, so there is no
//     infinite projection to cap and no horizon to pick.
//
// ⚑ Judgment calls, spec silent (CLAUDE.md: simplest option, flagged):
//   1. PAST DUE FIRST, then today forward. (Ruled by the user: an index of
//      everything that omits the overdue thing reads as broken.) Overdue rows
//      lead the list in their own group, oldest first, and use the SAME test
//      the daily review uses — see calPastDueRows. Still-past but RESOLVED
//      occurrences stay out: they are the month grid's history, not a loop.
//   2. GROUPED BY DAY with a date heading, rather than a date on every row.
//      The row markup is then byte-identical to Day view's.
//   3. UNTIMED BEFORE TIMED within a day — the same ordering rule Day view
//      already uses (user ruling #4), not a new one.
// =========================================================
// Everything already overdue, in the SAME terms the daily review uses — a
// past-due event is its pseudo-action row (pseudoPassed), a past-due deadline
// is deadlineBarState().passed. Deliberately not a second rule: if the review
// and this list ever disagreed about what "overdue" means, one of them would be
// lying, and there would be no way to tell which.
function calPastDueRows(){
  const rows = [];
  ["next", "current"].forEach(function(k){
    state.tasks[k].forEach(function(task){
      if (task.isGroup || isDevScaffold(task)) return;
      if (task.eventId){
        if (!pseudoPassed(task)) return;
        const when = dateStrToDate(task.occDate).toLocaleDateString(undefined, { day: "numeric", month: "short" });
        rows.push({
          date: task.occDate, sort: (task.occTime ? "1" + task.occTime : "0"),
          html: '<button type="button" class="cal-agenda-row cal-agenda-overdue" data-action="cal-open-event" data-id="' + task.eventId + '" data-date="' + task.occDate + '">' +
            '<span class="cal-agenda-dot ' + (task.occTime ? "cal-mark-appt" : "cal-mark-event") + '"></span>' +
            '<span class="cal-agenda-when">' + escapeHtml(when + (task.occTime ? " " + task.occTime : "")) + '</span>' +
            '<span class="cal-agenda-title">' + escapeHtml(task.title) + '</span>' +
          '</button>'
        });
        return;
      }
      const st = deadlineBarState(task);
      if (!(st && st.passed)) return;
      const when = dateStrToDate(task.deadline.date).toLocaleDateString(undefined, { day: "numeric", month: "short" });
      rows.push({
        date: task.deadline.date, sort: (task.deadline.time ? "1" + task.deadline.time : "0"),
        html: '<button type="button" class="cal-agenda-row cal-agenda-overdue" data-action="cal-open-task" data-lane="' + k + '" data-id="' + task.id + '">' +
          '<span class="cal-agenda-dot cal-mark-dl-' + (k === "current" ? "current" : "next") + '"></span>' +
          '<span class="cal-agenda-when">' + escapeHtml(when + (task.deadline.time ? " " + task.deadline.time : "")) + '</span>' +
          '<span class="cal-agenda-title">' + escapeHtml(task.title) + ' <span class="cal-agenda-kind">' + escapeHtml(k === "current" ? t("cal.projectDeadline") : t("cal.actionDeadline")) + '</span></span>' +
        '</button>'
      });
    });
  });
  rows.sort(function(a, b){
    return a.date === b.date ? a.sort.localeCompare(b.sort) : a.date.localeCompare(b.date);
  });
  return rows;
}
function calListRows(){
  const today = todayStr();
  const rows = [];
  // An event with a past-due pseudo-action is shown in the Past due group, so
  // it must not ALSO appear at its next occurrence — that would put one
  // repeating series on the list twice. Past-due wins, which is the same
  // precedence computeOpenLoops uses when an item is both past-due and stalled.
  const overdueEventIds = {};
  ["next", "current"].forEach(function(k){
    state.tasks[k].forEach(function(task){
      if (!task.isGroup && task.eventId && pseudoPassed(task)) overdueEventIds[task.eventId] = 1;
    });
  });
  (state.events || []).forEach(function(ev){
    if (overdueEventIds[ev.id]) return;
    // ONE occurrence per series (QA #31's helper does exactly this job): the
    // next one that has not passed. Paused included — a paused series still has
    // a next date, and this view is where you want to see it.
    const canon = nextLiveOccurrenceDate(ev);
    if (!canon) return;                       // finished one-shot
    const date = effDate(ev, canon);
    if (date < today) return;
    // ⚠ Named `evTime`, not `t` — see the same fix in calDayAgendaHtml above.
    const evTime = effTime(ev, canon), title = effTitle(ev, canon);
    const tags =
      (ev.paused ? ' <span class="cal-agenda-kind">' + escapeHtml(t("cal.paused")) + '</span>' : "") +
      (isRecurring(ev) && !ev.paused ? ' <span class="cal-agenda-kind">' + escapeHtml(recurLabel(ev.recurrence).toLowerCase()) + '</span>' : "") +
      (ev.tickler ? ' <span class="cal-tickler-tag">' + escapeHtml(t("cal.hidden")) + '</span>' : "");
    rows.push({
      date: date, sort: (evTime ? "1" + evTime : "0"),
      html: '<button type="button" class="cal-agenda-row" data-action="cal-open-event" data-id="' + ev.id + '" data-date="' + canon + '">' +
        '<span class="cal-agenda-dot ' + (evTime ? "cal-mark-appt" : "cal-mark-event") + '"></span>' +
        '<span class="cal-agenda-when">' + (evTime ? escapeHtml(evTime) : escapeHtml(t("cal.allDay"))) + '</span>' +
        '<span class="cal-agenda-title">' + escapeHtml(title) + tags + '</span>' +
      '</button>'
    });
  });
  function deadlineRow(task, laneKind){
    if (task.isGroup || task.eventId) return;       // pseudo-actions come from gtd_events
    if (!(task.deadline && task.deadline.date)) return;
    const st = deadlineBarState(task);
    if (st && st.passed) return;              // shown in the Past due group instead
    if (task.deadline.date < today) return;
    rows.push({
      date: task.deadline.date, sort: (task.deadline.time ? "1" + task.deadline.time : "0"),
      html: '<button type="button" class="cal-agenda-row" data-action="cal-open-task" data-lane="' + laneKind + '" data-id="' + task.id + '">' +
        '<span class="cal-agenda-dot cal-mark-dl-' + (laneKind === "current" ? "current" : "next") + '"></span>' +
        '<span class="cal-agenda-when">' + (task.deadline.time ? escapeHtml(task.deadline.time) : escapeHtml(t("cal.due"))) + '</span>' +
        '<span class="cal-agenda-title">' + escapeHtml(task.title) + ' <span class="cal-agenda-kind">' + escapeHtml(laneKind === "current" ? t("cal.projectDeadline") : t("cal.actionDeadline")) + '</span></span>' +
      '</button>'
    });
  }
  state.tasks.next.forEach(function(task){ deadlineRow(task, "next"); });
  state.tasks.current.forEach(function(task){ deadlineRow(task, "current"); });
  rows.sort(function(a, b){
    return a.date === b.date ? a.sort.localeCompare(b.sort) : a.date.localeCompare(b.date);
  });
  return rows;
}
function calListHtml(){
  const overdue = calPastDueRows();
  const rows = calListRows();
  if (!overdue.length && !rows.length){
    return '<div class="cal-day-empty">' + escapeHtml(t("cal.nothingComingUp")) + '</div>';
  }
  const today = todayStr();
  let html = '<div class="cal-agenda cal-list">', lastDate = null;
  if (overdue.length){
    html += '<div class="cal-list-daylabel is-overdue">' + escapeHtml(t("cal.pastDue")) + '</div>';
    overdue.forEach(function(r){ html += r.html; });
  }
  rows.forEach(function(r){
    if (r.date !== lastDate){
      const d = dateStrToDate(r.date);
      const label = r.date === today
        ? t("cal.today")
        : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      html += '<div class="cal-list-daylabel' + (r.date === today ? " is-today" : "") + '">' + escapeHtml(label) + '</div>';
      lastDate = r.date;
    }
    html += r.html;
  });
  return html + '</div>';
}

// The creation row (§4.15a) — Event · Deadline segmented toggle swaps the
// controls beneath, quick-add rulings apply (dup check, dashed-empty).
function calCreateRowHtml(s){
  const isEvent = s.calKind === "event";
  // Opened from a project: say so, and say why a date might be refused, ABOVE
  // the field rather than beside it (user). A bare dashed outline cannot
  // explain "after the deadline" — the reason is not guessable from the field.
  const forProject = s.calForProjectId
    ? '<div class="cal-for-project">' + escapeHtml(t("cal.adding")) + ' <b>' + escapeHtml(s.calForProjectName || t("cal.thisProject")) + '</b>' +
      (s.calForProjectDeadline
        ? ' &middot; ' + escapeHtml(t("cal.dueAbbrev")) + ' ' + escapeHtml(dateStrToDate(s.calForProjectDeadline).toLocaleDateString(undefined, { day: "numeric", month: "short" }))
        : "") +
      '</div>'
    : "";
  const errMsg = s.calError ? '<div class="cal-error">' + escapeHtml(s.calError) + '</div>' : "";
  const seg =
    '<div class="cal-seg">' +
      '<button type="button" class="cal-seg-btn' + (isEvent ? " active" : "") + '" data-action="cal-kind" data-kind="event">' + escapeHtml(t("cal.event")) + '</button>' +
      '<button type="button" class="cal-seg-btn' + (!isEvent ? " active" : "") + '" data-action="cal-kind" data-kind="deadline">' + escapeHtml(t("cal.deadline")) + '</button>' +
    '</div>';
  // §8 (review-surface-plan.md, RULED): moved off the bottom of the controls
  // and paired with the Event/Deadline toggle instead — PHONE placement is to
  // its right, above Add (DESKTOP placement — top of the left control column
  // — is §10's two-column layout, built separately). Events only (§8.1): the
  // Deadline side creates a task, which has its own drafting page already.
  const advancedBtn = isEvent
    ? '<button type="button" class="cal-advanced-btn" data-action="cal-advanced" ' +
        'title="' + escapeHtml(t("cal.moreOptionsTooltip")) + '">' +
        escapeHtml(t("cal.moreOptions")) + '</button>'
    : "";
  let controls;
  if (isEvent){
    // §9 (review-surface-plan.md, Q9 RESOLVED): dismissible, not removed — a
    // sibling ✕ next to the bubble, same shape as .bundle-pill-wrap, so a tap
    // near the edge clears it instead of triggering "Make this a habit instead".
    const habitBubble = (s.calRecur === "daily" || s.calRecur === "weekly") && !s.calHabitBubbleDismissed
      ? '<span class="cal-habit-bubble-wrap">' +
          '<button type="button" class="cal-habit-bubble" data-action="cal-make-habit">' + escapeHtml(t("cal.makeHabitInstead")) + '</button>' +
          '<button type="button" class="icon-btn cal-habit-bubble-clear" data-action="cal-dismiss-habit-bubble" title="' + escapeHtml(t("cal.dismissHabitBubble")) + '">&times;</button>' +
        '</span>'
      : "";
    controls =
      '<div class="cal-create-controls">' +
        '<div class="cal-boxed"><span class="field-icon">&#128337;</span>' +
          '<input type="text" readonly inputmode="none" class="screen-time" data-calfield="time" placeholder="' + escapeHtml(t("cal.time")) + '" value="' + escapeHtml(s.calTime || "") + '" title="' + escapeHtml(t("cal.optional")) + '">' +
        '</div>' +
        '<input type="text" class="cal-desc" data-calfield="desc" placeholder="' + escapeHtml(t("cal.description")) + '" value="' + escapeHtml(s.calDesc || "") + '">' +
        '<div class="cal-boxed"><span class="field-icon">&#128260;</span>' +
          '<select class="screen-link-select" data-calfield="recur">' +
            recurOptions().map(function(o){ return '<option value="' + o.v + '"' + (o.v === s.calRecur ? " selected" : "") + '>' + escapeHtml(o.label) + '</option>'; }).join("") +
          '</select>' +
          (s.calRecur !== "none" ? '<span class="cal-hint">' + escapeHtml(t("cal.every")) + '</span><input type="number" min="1" class="cal-interval" data-calfield="interval" value="' + (s.calInterval || 1) + '">' : "") +
        '</div>' +
        habitBubble +
        '<label class="cal-tickler-row"><input type="checkbox" data-calfield="tickler"' + (s.calTickler ? " checked" : "") + '> ' + escapeHtml(t("cal.hideUntilItHappens")) + '</label>' +
      '</div>';
  } else {
    controls =
      '<div class="cal-create-controls">' +
        '<div class="cal-boxed"><span class="field-icon">&#128337;</span>' +
          '<input type="text" readonly inputmode="none" class="screen-time" data-calfield="time" placeholder="' + escapeHtml(t("cal.time")) + '" value="' + escapeHtml(s.calTime || "") + '" title="' + escapeHtml(t("cal.optional")) + '">' +
        '</div>' +
        '<input type="text" class="cal-desc" data-calfield="desc" placeholder="' + escapeHtml(t("cal.description")) + '" value="' + escapeHtml(s.calDesc || "") + '">' +
        '<div class="cal-seg cal-seg-small">' +
          '<button type="button" class="cal-seg-btn' + (s.calDeadlineFor === "next" ? " active" : "") + '" data-action="cal-dlfor" data-for="next">' + escapeHtml(t("cal.action")) + '</button>' +
          '<button type="button" class="cal-seg-btn' + (s.calDeadlineFor === "current" ? " active" : "") + '" data-action="cal-dlfor" data-for="current">' + escapeHtml(t("cal.project")) + '</button>' +
        '</div>' +
      '</div>';
  }
  const sel = dateStrToDate(s.calSel);
  const selLabel = sel.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  // The creation controls stay fully visible (user ruling: scrolling the
  // calendar is fine, a collapsible creation section is not).
  return (
    '<div class="cal-create">' +
      forProject +
      errMsg +
      '<div class="cal-seg-row">' + seg + advancedBtn + '</div>' +
      '<div class="cal-create-main">' +
        '<input type="text" class="cal-name' + (s.calInvalid ? " field-invalid" : "") + '" data-calfield="name" placeholder="' + escapeHtml(isEvent ? t("cal.eventOnPrefix") : t("cal.duePrefix")) + escapeHtml(selLabel) + '…" value="' + escapeHtml(s.calName || "") + '" autocomplete="off">' +
        '<button type="button" class="cal-add-btn" data-action="cal-add">' + escapeHtml(t("cal.add")) + '</button>' +
      '</div>' +
      controls +
    '</div>'
  );
}

function calendarHeaderHtml(s){
  return (
    // The exit is a BACK ARROW top-left, not an ✕ top-right (user QA #7): the
    // calendar is a place you came from somewhere else, and every other page in
    // the app leaves by ← in that corner. The ✕ read as "discard", which is
    // wrong — there is nothing here to discard.
    '<div class="screen-header">' +
      '<button type="button" class="screen-chrome-btn" data-action="cal-close" title="' + escapeHtml(t("cal.back")) + '">&#8592;</button>' +
      '<div class="cal-tabs">' +
        '<button type="button" class="cal-tab' + (s.calTab === "month" ? " active" : "") + '" data-action="cal-tab" data-tab="month">' + escapeHtml(t("cal.month")) + '</button>' +
        '<button type="button" class="cal-tab' + (s.calTab === "day" ? " active" : "") + '" data-action="cal-tab" data-tab="day">' + escapeHtml(t("cal.day")) + '</button>' +
        '<button type="button" class="cal-tab' + (s.calTab === "list" ? " active" : "") + '" data-action="cal-tab" data-tab="list">' + escapeHtml(t("cal.list")) + '</button>' +
      '</div>' +
      '<div class="screen-header-right">' +
        // ⚑ ADDED (author, this round): the calendar was the one major
        // surface with no ⓘ at all. The six lane tabs and the intray have
        // always had one, and the review — also a screen, not a lane — shows
        // there is precedent for a screen carrying one. This replaces an
        // invisible spacer that existed only to balance the header.
        '<button type="button" class="screen-chrome-btn" data-action="cal-info" title="' + escapeHtml(t("chrome.info")) + '">&#9432;</button>' +
      '</div>' +
    '</div>'
  );
}
// The calendar's ⓘ panel. Held open across re-renders (s.calInfoOpen) the
// same way the review's is, so switching month/day/list does not shut it.
// Shows the full text: first sentence plus the `.more` paragraph the review
// deliberately withholds (info.lane.next(.more) sets the precedent).
function calendarInfoPanelHtml(open){
  return '<div class="cal-info-panel"' + (open ? "" : " hidden") + '>' +
      escapeHtml(t("info.calendar")) +
      '<span class="lane-info-more">' + escapeHtml(t("info.calendar.more")) + '</span>' +
    '</div>';
}
function calendarBodyHtml(s){
  let body;
  if (s.calTab === "month"){
    const nav =
      '<div class="cal-monthnav">' +
        '<button type="button" class="cal-navbtn" data-action="cal-month" data-dir="-1">&#8249;</button>' +
        '<span class="cal-monthlabel">' + escapeHtml(monthName(s.calM)) + " " + s.calY + '</span>' +
        '<button type="button" class="cal-navbtn" data-action="cal-month" data-dir="1">&#8250;</button>' +
      '</div>';
    // Three-panel swipe track (prev · current · next) — translateX follows the
    // finger, snaps on release (user #7: test the finger-follow swipe here).
    const prev = prevMonth(s.calY, s.calM), next = nextMonthYM(s.calY, s.calM);
    const track =
      '<div class="cal-swipe-viewport">' +
        '<div class="cal-swipe-track" id="cal-swipe-track">' +
          '<div class="cal-swipe-panel">' + calMonthGridHtml(prev.y, prev.m) + '</div>' +
          '<div class="cal-swipe-panel">' + calMonthGridHtml(s.calY, s.calM) + '</div>' +
          '<div class="cal-swipe-panel">' + calMonthGridHtml(next.y, next.m) + '</div>' +
        '</div>' +
      '</div>';
    body = nav + track;
  } else if (s.calTab === "list"){
    // No date nav: the list is one continuous run from today, so there is
    // nothing to page through.
    body = '<div class="cal-daynav"><span class="cal-monthlabel">' + escapeHtml(t("cal.comingUp")) + '</span></div>' + calListHtml();
  } else {
    const sel = dateStrToDate(s.calSel);
    const label = sel.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    body = '<div class="cal-daynav"><button type="button" class="cal-navbtn" data-action="cal-dayshift" data-dir="-1">&#8249;</button>' +
      '<span class="cal-monthlabel">' + escapeHtml(label) + '</span>' +
      '<button type="button" class="cal-navbtn" data-action="cal-dayshift" data-dir="1">&#8250;</button></div>' +
      calDayAgendaHtml(s.calSel);
  }
  // ⚑ QA #9 — the creation row is part of the CONTENT, at the bottom of the
  // calendar, not a pinned footer. Third and final shape for this: it was
  // sticky (overlapped the grid), then a solid pinned footer (ate half a phone
  // screen), then collapsible (hid controls behind a tap). The ruling is
  // simply that scrolling down to it is fine and it should never occupy the
  // view when you are reading the calendar — so it stops being chrome and
  // becomes the last section of the page.
  return '<div class="screen-body cal-body">' + body + calCreateRowHtml(s) + '</div>';
}
function prevMonth(y, m){ return m === 0 ? { y: y - 1, m: 11 } : { y: y, m: m - 1 }; }
function nextMonthYM(y, m){ return m === 11 ? { y: y + 1, m: 0 } : { y: y, m: m + 1 }; }

// =========================================================
// THE EVENT PAGE (§4.15a controls, edited via the event page §4.14/§4.15). A
// screen of kind "event" — NOT built from the action template, so it carries
// no "Make Waiting" (§4.13a, an absence not a disable). Renders through
// screenBodyHtml's kind==="event" branch (eventBodyHtml below).
// =========================================================
function openEventScreen(eventId, occDate){
  const ev = findEvent(eventId);
  if (!ev) return;
  // Which occurrence are we editing? `occDate` is the CANONICAL key; defaults
  // to the live one. The calendar agenda passes the tapped occurrence's
  // canonical date so a future occurrence can be overridden too.
  const c = occDate || ev.date;
  state.screen = {
    kind: "event", eventView: true, taskId: eventId, eventId: eventId, occDate: c,
    draft: {
      // occurrence-level fields show their EFFECTIVE value for this occurrence
      title: effTitle(ev, c), notesClean: effNotes(ev, c), time: effTime(ev, c),
      date: effDate(ev, c), // where this occurrence currently lands (editable to move it)
      recurrence: ev.recurrence || "none", interval: ev.interval || 1,
      paused: !!ev.paused, contextId: ev.contextId || null, linkedProjectId: ev.linkedProjectId || null,
      tickler: !!ev.tickler, willComplete: false
    }
  };
  renderScreen();
}
// ⚑ THE ADVANCED CREATION PAGE (user: "It's currently not possible to link an
// event to a project, or add it to a context during event creation. I suggest
// putting an advanced options button that will open a full creation page near
// the calendar controls. The page is already built. You just need to reuse the
// drafting page and remove the complete and delete buttons.")
//
// Exactly that: the same eventView screen, opened with no eventId. Everything
// the quick-add row already holds is carried across so nothing typed is lost on
// the way in, and the two fields the row cannot offer — context and project link
// — are the reason to come here at all.
//
// WHAT IS HIDDEN IN CREATE MODE, and why each one has to be:
//   · 🗑 Delete   — screenHeaderHtml already keys it to s.taskId, so it drops out
//                   on its own once taskId is null. Nothing to delete.
//   · Complete    — "this thing I have not made yet is done" is incoherent.
//   · Pause       — pausing a series that does not exist yet is the same shape.
//   · Make habit  — makeHabitFromEvent needs a real event; the quick-add row
//                   already offers this affordance, so nothing is lost.
//   · The "editing the occurrence on…" hint — there is no occurrence yet, and
//     no this-one-or-all question at save.
function openEventCreateScreen(){
  const s = state.screen;   // the calendar screen we are leaving
  state.screenStack.push(s);
  state.screen = {
    kind: "event", eventView: true, eventCreate: true,
    taskId: null, eventId: null, occDate: null,
    // Carried so the advanced page can honour a project-page origin exactly as
    // the quick-add row does — including the staging contract (§12.1).
    calForProjectStaging: s.calForProjectStaging || null,
    calFromCaptureId: s.calFromCaptureId || null,
    draft: {
      title: s.calName || "", notesClean: s.calDesc || "",
      date: s.calSel, time: s.calTime || null,
      recurrence: s.calRecur || "none", interval: s.calInterval || 1,
      paused: false, contextId: null,
      linkedProjectId: s.calForProjectId || null,
      tickler: !!s.calTickler, willComplete: false
    }
  };
  renderScreen();
}

function eventBodyHtml(s){
  const d = s.draft;
  const creating = !s.eventId;
  const ev = findEvent(s.eventId) || {};
  const doneToday = (ev.completedOccs || []).indexOf(s.occDate || d.date) !== -1; // completion keyed by canonical
  let fields = "";
  // On a recurring series, name the occurrence being edited so "this occurrence
  // only" vs "all occurrences" (offered at save) has a clear referent.
  if (!creating && isRecurring({ recurrence: d.recurrence })){
    const occ = dateStrToDate(s.occDate || d.date);
    fields += '<div class="event-occ-hint">' + escapeHtml(t("event.occurrenceHint").replace("{date}",
      occ.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))) + '</div>';
  }
  fields += '<input type="text" class="screen-field-title' + (s.invalidField === "title" ? " field-invalid" : "") + '" data-field="title" placeholder="' + escapeHtml(t("event.titlePlaceholder")) + '" value="' + escapeHtml(d.title) + '">';
  fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="' + escapeHtml(t("field.description")) + '">' + escapeHtml(d.notesClean) + '</textarea>';
  // Date — editable, so an occurrence can be moved to another day (a recurring
  // event asks "this occurrence / all" at save; a one-off just moves).
  fields += '<div class="screen-row"><div class="screen-boxed-row"><span class="field-icon">&#128197;</span>' +
    '<input type="text" readonly inputmode="none" class="screen-date" data-field="event-date" placeholder="' + escapeHtml(t("field.pickDate")) + '" value="' + escapeHtml(d.date || "") + '">' +
    (isRecurring({ recurrence: d.recurrence }) ? '<span class="cal-hint">' + escapeHtml(t("event.moveThisOccurrence")) + '</span>' : "") +
    '</div></div>';
  // Time
  fields += '<div class="screen-row"><div class="screen-boxed-row"><span class="field-icon">&#128337;</span>' +
    // ⚑ The "a time makes it an appointment" hint is gone (user): event vs.
    // appointment is a distinction the IMPLEMENTATION needs — it decides the
    // progress bar's window (§4.14c) and the past-due moment — but it means
    // nothing to someone adding a dentist visit. The field is optional and
    // self-evident; naming the taxonomy only taught users a word they will
    // never need. The internal terms stay in the code and the spec.
    '<input type="text" readonly inputmode="none" class="screen-time" data-field="event-time" placeholder="' + escapeHtml(t("cal.time")) + '" value="' + escapeHtml(d.time || "") + '">' +
    (d.time ? '<button type="button" class="screen-clear-x" data-action="event-clear-time" title="' + escapeHtml(t("field.clearTime")) + '">&times;</button>' : "") +
    '</div></div>';
  // Recurrence
  fields += '<div class="screen-row"><div class="screen-boxed-row"><span class="field-icon">&#128260;</span>' +
    '<select class="screen-link-select" data-field="event-recurrence">' +
      recurOptions().map(function(o){ return '<option value="' + o.v + '"' + (o.v === d.recurrence ? " selected" : "") + '>' + escapeHtml(o.label) + '</option>'; }).join("") +
    '</select>' +
    (d.recurrence !== "none" ? '<span class="cal-hint">' + escapeHtml(t("cal.every")) + '</span><input type="number" min="1" class="cal-interval" data-field="event-interval" value="' + (d.interval || 1) + '">' : "") +
    '</div></div>';
  // "Make this a habit instead" (§4.15b) — daily/weekly only, load-bearing.
  // Edit-only: makeHabitFromEvent needs a real event, and the calendar's quick-add
  // row already carries this same offer for something being created.
  if (!creating && (d.recurrence === "daily" || d.recurrence === "weekly")){
    fields += '<button type="button" class="cal-habit-bubble" data-action="event-make-habit">' + escapeHtml(t("cal.makeHabitInstead")) + '</button>';
  }
  // Context + project link (§4.15a/§4.15d) — the two fields the calendar's
  // quick-add row cannot offer, and therefore the whole reason this page has an
  // "advanced options" entry point of its own.
  fields += contextRowHtml(d);
  fields += '<div class="screen-row"><div class="screen-boxed-row"><span class="field-icon">&#128279;</span>' +
    '<select class="screen-link-select" data-field="linkedProjectId">' + projectOptionsHtml(d.linkedProjectId) + '</select></div></div>';
  // Tickler toggle (user addition)
  fields += '<label class="cal-tickler-row"><input type="checkbox" data-field="event-tickler"' + (d.tickler ? " checked" : "") + '> ' + escapeHtml(t("cal.hideUntilItHappens")) + '</label>';
  // Pause — recurring only, draft-only + armed (§4.15b, golden-rule sibling).
  // Edit-only: pausing a series that does not exist yet is incoherent.
  if (!creating && isRecurring({ recurrence: d.recurrence })){
    fields += '<button type="button" class="btn screen-pause-btn' + (d.paused ? " armed" : "") + '" data-action="event-toggle-pause">' +
      (d.paused ? "&#9208; " + escapeHtml(t("event.pausedResumeOnSave")) : "&#9208; " + escapeHtml(t("event.pauseSeries"))) + '</button>';
  }
  // Complete — draft-only, arms on save (§4.14: completes like a Next Action).
  // Edit-only (user: "remove the complete and delete buttons"): marking something
  // done before it has been created is incoherent, and 🗑 drops out on its own
  // because screenHeaderHtml keys it to s.taskId, which is null here.
  const armed = !!d.willComplete;
  if (!creating){
  // ⚑ QA #27: this emitted `armed`, but .screen-complete-pill only styles
  // `.done` (and `.paused`) — .screen-complete-pill.armed matches no rule
  // anywhere, so the armed state on THIS page alone rendered unshaded. The
  // action page has always emitted `done` for the identical draft state; the
  // class name is the app-wide contract for "this pill is lit", so the event
  // page now speaks it too. (`armed` remains correct on .screen-pause-btn and
  // .screen-make-kind-btn, which do define it.)
  fields += '<button type="button" class="btn screen-complete-pill' + (armed ? " done" : "") + '" data-action="event-complete">' +
    (armed ? "&#10003; " + escapeHtml(t("outcome.completingOnSave")) : (doneToday ? "&#10003; " + escapeHtml(t("event.completedTodayReopen")) : escapeHtml(t("event.markComplete")))) + '</button>';
  }
  return '<div class="screen-body">' + fields + '</div>';
}

// Save the event page (§4.14a: on a recurring series the pseudo-action keeps
// its task ID; the ID lives on the event, so it survives all edits here).
// The occurrence-level fields (title/time/notesClean) can land on THIS
// occurrence (an override) or the WHOLE series (the base) — chosen at save via
// a dialog that mirrors the recurring-delete one (user #3).
function saveEventScreen(s){
  const d = s.draft;
  // ---- CREATE (the advanced options page, §4.15a) ----
  // Deliberately its own short path rather than a branch woven through the edit
  // logic below: there is no occurrence to scope to, no this-one-or-all question,
  // and no override to reconcile. Sharing that machinery would mean guarding
  // every step of it against a state it can never be in.
  if (s.eventCreate){
    const title = (d.title || "").trim();
    // House rule (§4.6): an empty title on a CREATE is a silent discard, exactly
    // as it is on every other drafting page.
    if (!title){ closeScreen(); return; }
    if (eventTitleClashes(title, null)){ s.invalidField = "title"; renderScreen(); return; }
    const recur = d.recurrence || "none";
    const newEv = {
      id: genId(), taskId: genId(), title: title,
      date: d.date || todayStr(), time: d.time || null,
      notesClean: d.notesClean || "", recurrence: recur,
      interval: Math.max(1, d.interval || 1), paused: false,
      contextId: d.contextId || null, linkedProjectId: d.linkedProjectId || null,
      seriesId: recur !== "none" ? genId() : null,
      tickler: !!d.tickler, completedOccs: []
    };
    commitNewEvent(newEv, s.calForProjectStaging);
    // The capture that sent us here is filed by the same rule the quick-add row
    // uses — but consumeCalCapture reads state.screen, and this screen is the
    // event page rather than the calendar, so hand it the id directly.
    if (s.calFromCaptureId){
      removeCapture(s.calFromCaptureId);
      s.calFromCaptureId = null;
      const cd = dateStrToDate(newEv.date);
      showItMovedBanner(t("event.scheduledForBanner").replace("{date}", cd.toLocaleDateString(undefined, { month: "short", day: "numeric" })));
    }
    closeScreen();
    return;
  }
  const ev = findEvent(s.eventId);
  if (!ev){ closeScreen(); return; }
  const occDate = s.occDate || ev.date; // canonical key of the occurrence being edited
  let title = (d.title || "").trim();
  if (!title){ title = effTitle(ev, occDate); } // edit: empty title keeps the effective one (house rule)
  if (eventTitleClashes(title, ev.id)){ s.invalidField = "title"; renderScreen(); return; }
  const newTime = d.time || null;
  const newNotes = d.notesClean || "";
  const newDate = d.date || effDate(ev, occDate); // where the occurrence should land

  // ⚑ QA #25 (ruling A). Some fields have NO per-occurrence storage — they
  // define the series — so they always hit every occurrence whichever scope you
  // pick. The dialog used to promise "this occurrence only" over the top of
  // them, which is how an edit could appear to leak into the whole series
  // "regardless of what you pick". Detect them BEFORE they are written to the
  // event, so the dialog can name what it cannot scope instead of lying.
  const seriesFieldsChanged =
    (ev.recurrence || "none") !== (d.recurrence || "none") ||
    Math.max(1, ev.interval || 1) !== Math.max(1, d.interval || 1) ||
    (ev.contextId || null) !== (d.contextId || null) ||
    (ev.linkedProjectId || null) !== (d.linkedProjectId || null) ||
    !!ev.tickler !== !!d.tickler ||
    !!ev.paused !== !!d.paused;

  // Series-level fields always commit to the base series (they define the
  // series; there is no per-occurrence recurrence/pause/context/link/tickler).
  ev.recurrence = d.recurrence || "none";
  ev.interval = Math.max(1, d.interval || 1);
  ev.contextId = d.contextId || null;
  ev.linkedProjectId = d.linkedProjectId || null;
  ev.tickler = !!d.tickler;
  ev.paused = !!d.paused;
  if (ev.recurrence !== "none" && !ev.seriesId) ev.seriesId = genId();

  // Did the occurrence-level fields (incl. its date) actually change vs this
  // occurrence's effective values? Only then is there a scope question.
  const occChanged = (title !== effTitle(ev, occDate)) || (newTime !== effTime(ev, occDate)) ||
    (newNotes !== effNotes(ev, occDate)) || (newDate !== effDate(ev, occDate));

  function commitSeries(){
    ev.title = title; ev.time = newTime; ev.notesClean = newNotes;
    if (ev.overrides) delete ev.overrides[occDate]; // this occurrence follows the series again
    // A date change applied to "all" reschedules the whole series by the same
    // delta so this occurrence lands on newDate and the cadence follows.
    if (isRecurring(ev)){
      const delta = daysBetween(occDate, newDate);
      if (delta !== 0) ev.date = addDaysStr(ev.date, delta);
    } else {
      ev.date = newDate; // a one-off simply moves
    }
    finishEventSave(s, ev);
  }
  function commitOccurrence(){
    ev.overrides = ev.overrides || {};
    // Store the moved date only when it differs from canonical; effDate reads
    // override.date, so an unmoved occurrence keeps its canonical day.
    ev.overrides[occDate] = { title: title, time: newTime, notesClean: newNotes, date: (newDate !== occDate ? newDate : null) };
    finishEventSave(s, ev);
  }

  if (isRecurring(ev) && occChanged){
    // The choice is only offered for what can actually honour it. When the save
    // also carries series-level changes, say so rather than implying they are
    // being scoped too (QA #25, ruling A).
    const prompt = seriesFieldsChanged
      ? t("event.scopePromptSeriesNote")
      : t("event.scopePromptPlain");
    openConfirmDialog(prompt, [
      { label: t("event.thisOccurrenceOnly"), style: "primary", action: commitOccurrence },
      { label: t("event.allOccurrences"), action: commitSeries },
      { label: t("chrome.cancel"), action: function(){} }
    ]);
    return;
  }
  // Non-recurring, or a recurring event where only series-level fields changed:
  // commit the occurrence values straight to the base (harmless no-op if equal).
  commitSeries();
}
// The shared tail of an event save: persist, let the boundary sweep reconcile
// the live pseudo-action (refresh in place / replace / retire on a future
// move / re-appear), honour a draft-armed Complete, and close. The linked
// project can change per save, so re-sync it onto any surviving row.
function finishEventSave(s, ev){
  const d = s.draft;
  saveEvents();
  processEventBoundaries(); // create / replace / retire / refresh the pseudo-action from effective values
  const row = findPseudoRow(ev.id);
  if (row && row.linkedProjectId !== (ev.linkedProjectId || null)){ row.linkedProjectId = ev.linkedProjectId || null; saveTasksLocal("next"); }
  if (d.willComplete){
    if (row){
      completeTask("next", row.id); // archives + calls onPseudoActionCompleted
    } else {
      // Completing an occurrence with no live row (a future one): archive a
      // synthesised occurrence and arm the roll, same as a card tick.
      const synth = makePseudoActionRow(ev);
      state.completed.next.unshift(Object.assign({}, synth, { completedAt: todayStr(), seriesId: ev.seriesId || null }));
      saveCompletedLocal("next");
      onPseudoActionCompleted(synth);
      saveEvents();
    }
  }
  renderLane("next");
  renderLane("waiting");
  closeScreen();
}

// Delete on the event page. Recurring → Skip this one · Delete series · Cancel
// (§4.15b); one-shot → a plain confirm.
// Deleting an event, wherever it is deleted FROM (the event page, the review's
// past-due queue). Factored out for QA #13: a pseudo-action is a view of an
// event, so deleting one must delete the EVENT — removing just the lane row
// would leave the event live and the 4 AM sweep would mint the row straight
// back (the ghost-row bug, fixed earlier this round). A recurring series gets
// the scope choice; nothing here bypasses the confirm.
function confirmDeleteEvent(ev, after){
  const done = function(){ if (after) after(); };
  if (isRecurring(ev)){
    openConfirmDialog(t("event.repeatsPrompt"), [
      { label: t("event.skipThisOne"), action: function(){ skipOccurrence(ev); done(); } },
      { label: t("event.deleteSeries"), style: "danger", action: function(){ deleteEventEntirely(ev); done(); } },
      { label: t("chrome.cancel"), action: function(){} }
    ]);
  } else {
    openConfirmDialog(t("confirm.deleteTitleQuestion").replace("{title}", escapeHtml(ev.title)), [
      { label: t("chrome.delete"), style: "danger", action: function(){ deleteEventEntirely(ev); done(); } },
      { label: t("chrome.cancel"), action: function(){} }
    ]);
  }
}
function deleteEventFromPage(){
  const s = state.screen; if (!s || !s.eventView) return;
  const ev = findEvent(s.eventId); if (!ev){ closeScreen(); return; }
  confirmDeleteEvent(ev, closeScreen);
}
function removePseudoRow(eventId){
  const before = state.tasks.next.length;
  state.tasks.next = state.tasks.next.filter(function(t){ return t.eventId !== eventId; });
  if (state.tasks.next.length !== before) saveTasksLocal("next");
}
// "Skip this one" = advance to the next occurrence (§4.15b). Same task ID rolls
// forward, so a dependent simply now waits on the next occurrence.
// ⚑ BUG FIX (review-surface-plan.md follow-up, author report): a series can
// hold BOTH a live occurrence (the row this function is skipping) AND an
// older recorded miss at once — the single-slot design HIDES the older miss
// behind the live row (computeOpenLoops shows only the live one; see
// onPseudoActionCompleted's comment for the completed-side half of this same
// story). Skipping the live row used to leave that older missedOcc
// untouched, so the instant the live row disappeared the older miss was
// revealed — from the review it read as "I hit Skipped and the same event
// came right back," when it was actually a second, older question that had
// been waiting the whole time. Completing already retired the miss it
// supersedes (onPseudoActionCompleted); skipping now does the same.
function skipOccurrence(ev){
  const occ = ev.date; // the occurrence being skipped, captured before advancing
  const nd = nextOccurrenceDate(ev.date, ev.recurrence, ev.interval);
  if (nd){ ev.date = nd; }
  ev.completedAt = null; ev.completedFrom = null;
  if (ev.missedOcc && ev.missedOcc <= occ) ev.missedOcc = null;
  pruneOverrides(ev);
  removePseudoRow(ev.id);
  saveEvents();
  processEventBoundaries();
  renderLane("next"); renderLane("waiting");
}
function deleteEventEntirely(ev){
  // §4.15b: delete-series orphans any dependent hooked to this occurrence's
  // task ID. Freeze its label first (mirrors deleteTask), so the dashed orphan
  // pill still reads meaningfully once the target is gone. skip-this-one does
  // NOT come here (it keeps the same task ID); pause is reversible (resolver).
  const deps = state.tasks.waiting.filter(function(t){ return t.conditionId === ev.taskId; });
  if (deps.length){ deps.forEach(function(t){ t.conditionLabel = effTitle(ev, ev.date); }); saveTasksLocal("waiting"); }
  removePseudoRow(ev.id);
  state.events = state.events.filter(function(e){ return e.id !== ev.id; });
  saveEvents();
  renderLane("next"); renderLane("waiting");
}

// "Make this a habit instead" (§4.15b, user #5). Opens the habit create page
// prefilled from the event; on save the event is removed (the word "instead"
// signals either/or, so no warning). Cancelling returns to the event page
// (nothing was confirmed). Works from the event page and the creation row.
function makeHabitFromEvent(ev){
  // Weekly recurrence → a single scheduled weekday (the event's own); daily →
  // every day. Anything else → every day, since habits have no monthly cadence.
  const dow = dateStrToDate(ev.date).getDay();
  const schedule = ev.recurrence === "weekly" ? [dow] : [0, 1, 2, 3, 4, 5, 6];
  state.screenStack.push(state.screen);
  state.screen = null;
  openScreen("habit", null, { title: ev.title, schedule: schedule, fromEventId: ev.id });
}

// =========================================================
// CLICK DELEGATION for the calendar view and the event page. Called EARLY from
// app.js's document click listener; returns true when it handled the event
// (so the generic screen handlers below it don't also fire). Generic
// screen-save / screen-cancel / screen-delete still run for the event page —
// saveScreen / deleteScreenItem branch on kind==="event".
// =========================================================
function eventsHandleClick(e){
  const s = state.screen;
  // ---- pseudo-action card tap → the event page (from any lane) ----
  const openEv = e.target.closest('[data-action="open-event"]');
  if (openEv){
    if (s){ state.screenStack.push(s); state.screen = null; }
    openEventScreen(openEv.getAttribute("data-id"), openEv.getAttribute("data-date") || null);
    return true;
  }
  // ---- the Waiting widget / header 📅 ----
  if (e.target.closest('[data-action="open-calendar"]')){ closeTrayIfOpen(); openCalendarScreen(); return true; }

  if (!s) return false;

  // ---- calendar view ----
  if (s.calendarView){
    const tab = e.target.closest('[data-action="cal-tab"]');
    if (tab){ s.calTab = tab.getAttribute("data-tab"); renderScreen(); return true; }
    if (e.target.closest('[data-action="cal-info"]')){
      // Toggled in place rather than via renderScreen(): the creation row
      // holds unsaved field state, and a full re-render for an info panel
      // would be a draft-isolation hazard for no benefit.
      s.calInfoOpen = !s.calInfoOpen;
      const panel = qs(".cal-info-panel");
      if (panel) panel.hidden = !s.calInfoOpen;
      return true;
    }
    if (e.target.closest('[data-action="cal-close"]')){ closeScreen(); return true; }
    const mv = e.target.closest('[data-action="cal-month"]');
    if (mv){ shiftMonth(Number(mv.getAttribute("data-dir"))); return true; }
    const ds = e.target.closest('[data-action="cal-dayshift"]');
    if (ds){ shiftSelectedDay(Number(ds.getAttribute("data-dir"))); return true; }
    const cell = e.target.closest('[data-action="cal-select"]');
    if (cell){
      const dt = cell.getAttribute("data-date");
      // Second tap on the already-selected day opens Day view (§4.15).
      if (s.calSel === dt && s.calTab === "month"){ s.calTab = "day"; } else { s.calSel = dt; }
      // Picking a different day is the fix for "after the deadline", so the
      // message clears on that input — same rule as the dashed outline.
      s.calError = null; s.calInvalid = false;
      renderScreen(); return true;
    }
    const kb = e.target.closest('[data-action="cal-kind"]');
    if (kb){ s.calKind = kb.getAttribute("data-kind"); renderScreen(); return true; }
    const dlf = e.target.closest('[data-action="cal-dlfor"]');
    if (dlf){ s.calDeadlineFor = dlf.getAttribute("data-for"); renderScreen(); return true; }
    if (e.target.closest('[data-action="cal-add"]')){ calAdd(); return true; }
    if (e.target.closest('[data-action="cal-advanced"]')){ openEventCreateScreen(); return true; }
    if (e.target.closest('[data-action="cal-make-habit"]')){ calMakeHabit(); return true; }
    if (e.target.closest('[data-action="cal-dismiss-habit-bubble"]')){ s.calHabitBubbleDismissed = true; renderScreen(); return true; }
    const openEvt = e.target.closest('[data-action="cal-open-event"]');
    if (openEvt){ state.screenStack.push(s); state.screen = null; openEventScreen(openEvt.getAttribute("data-id"), openEvt.getAttribute("data-date") || null); return true; }
    const openTask = e.target.closest('[data-action="cal-open-task"]');
    if (openTask){ state.screenStack.push(s); state.screen = null; openScreen(openTask.getAttribute("data-lane"), openTask.getAttribute("data-id")); return true; }
    return false;
  }

  // ---- event page ----
  if (s.eventView){
    if (e.target.closest('[data-action="event-clear-time"]')){ s.draft.time = null; renderScreen(); return true; }
    if (e.target.closest('[data-action="event-toggle-pause"]')){ s.draft.paused = !s.draft.paused; renderScreen(); return true; }
    if (e.target.closest('[data-action="event-complete"]')){ s.draft.willComplete = !s.draft.willComplete; renderScreen(); return true; }
    if (e.target.closest('[data-action="event-make-habit"]')){ const ev = findEvent(s.eventId); if (ev) makeHabitFromEvent(ev); return true; }
    return false;
  }
  return false;
}
function closeTrayIfOpen(){ if (state.trayOpen && typeof closeTray === "function") closeTray(); }

function shiftMonth(dir){
  const s = state.screen;
  const nm = dir < 0 ? prevMonth(s.calY, s.calM) : nextMonthYM(s.calY, s.calM);
  s.calY = nm.y; s.calM = nm.m;
  renderScreen();
}
function shiftSelectedDay(dir){
  const s = state.screen;
  const d = addDaysToDate(dateStrToDate(s.calSel), dir);
  s.calSel = dateToStr(d); s.calY = d.getFullYear(); s.calM = d.getMonth();
  s.calError = null; s.calInvalid = false;
  renderScreen();
}

// Creation-row Add (§4.15a). Quick-add rulings: dashed-empty + dup check (for
// events, the gtd_events-AND-Next-Actions scope, §7).
function calAdd(){
  const s = state.screen;
  const name = (s.calName || "").trim();
  if (!name){ s.calInvalid = true; renderScreen(); const el = qs(".cal-name"); if (el) el.focus(); return; }
  // Captured BEFORE the branches: consumeCalCapture() clears calFromCaptureId
  // as its first act, so by the time the add finishes there is no longer any
  // record that this calendar was opened from the review.
  const cameFromReview = !!s.calFromCaptureId;
  const forProject = s.calForProjectId || null;
  // ⚑ THE DEADLINE RULE (user): an event scheduled after the project's deadline
  // is refused, with the reason stated above the field rather than left to a
  // bare outline.
  //
  // ⚑ For a REPEAT this checks the FIRST occurrence only, which is the cheap
  // option the user chose over giving recurrence an end date. A series whose
  // first occurrence is inside the deadline is linked and then runs on past it;
  // the ruling was that clutter can be dealt with by deleting the series, and
  // that an end date is its own feature rather than a rider on this one.
  if (forProject && s.calForProjectDeadline && s.calSel > s.calForProjectDeadline){
    s.calError = t("cal.afterProjectDeadline");
    s.calInvalid = true;
    renderScreen();
    return;
  }
  s.calError = null;
  if (s.calKind === "event"){
    if (eventTitleClashes(name, null)){ s.calInvalid = true; renderScreen(); const el = qs(".cal-name"); if (el) el.focus(); return; }
    const ev = {
      id: genId(), taskId: genId(), title: name, date: s.calSel, time: s.calTime || null,
      notesClean: s.calDesc || "", recurrence: s.calRecur || "none", interval: Math.max(1, s.calInterval || 1),
      paused: false, contextId: null, linkedProjectId: forProject,
      seriesId: (s.calRecur && s.calRecur !== "none") ? genId() : null, tickler: !!s.calTickler, completedOccs: []
    };
    commitNewEvent(ev, s.calForProjectStaging);
    consumeCalCapture();
  } else {
    // Deadline → a Next Action or Current Project due that day (§4.15a).
    const kind = s.calDeadlineFor === "current" ? "current" : "next";
    const dupe = state.tasks[kind].some(function(t){ return !t.isGroup && (t.title || "").trim().toLowerCase() === name.toLowerCase(); });
    if (dupe){ s.calInvalid = true; renderScreen(); const el = qs(".cal-name"); if (el) el.focus(); return; }
    createTask(kind, { title: name, notesClean: s.calDesc || "", deadline: { date: s.calSel, time: s.calTime || null } });
    consumeCalCapture();
  }
  // ⚑ QA #19: when the calendar was opened FROM the review (a capture's
  // Calendar chip), placing the thing is the whole errand — so go back to the
  // review instead of leaving the user parked in the calendar to find their own
  // way home. closeScreen() pops the stack the review pushed. The "it moved"
  // banner has already said where it went, so nothing is lost by leaving.
  // Same reasoning as the review's return (QA #19): placing the thing was the
  // whole errand, so go back where it started from.
  if (cameFromReview || forProject){ closeScreen(); return; }
  // Otherwise the calendar is where the user chose to be: reset the row for the
  // next entry and stay put.
  //
  // ⚑ CHANGED (user round): this used to clear only name/description/time and
  // deliberately keep the toggles, on the theory that someone entering several
  // weekly events would want "weekly" to stick. The author's ruling is the
  // opposite — every FIELD clears, because a repeat or a hidden-until-its-day
  // flag silently inherited by the next entry is a mistake you don't notice
  // until it has already been made, and re-picking a repeat is cheap.
  //
  // ⚑ What deliberately does NOT reset, because neither is a field: the SELECTED
  // DAY (you are usually filling in one day at a time) and the Event/Deadline
  // toggle (that is which tool you are holding, not what you typed into it).
  s.calName = ""; s.calDesc = ""; s.calTime = ""; s.calInvalid = false;
  s.calRecur = "none"; s.calInterval = 1; s.calTickler = false;
  s.calHabitBubbleDismissed = false; // the bubble is per-draft; a cleared row is a new draft
  renderScreen();
}
// The single place a NEW event becomes real. Both creation routes go through it
// — the calendar's quick-add row and the advanced page (§4.15a) — so the staging
// rule can never drift between them.
//
// ⚑ Opened from an UNSAVED project page (§12.1): stage the event into that
// page's draft rather than writing it, so ✕ takes it with the project and Save
// lands them together. `staging` is only set on that path; every other caller
// writes straight through.
function commitNewEvent(ev, staging){
  if (staging && staging.parent && staging.parent.draft && staging.parent.draft.staged){
    staging.parent.draft.staged.eventCreates.push(ev);
    // Clear the parent's blocked-save outline the same way stageChildSave does:
    // an event IS a way forward (§4.3b), so it satisfies the requirement.
    if (staging.parent.invalidField === "projectActions") staging.parent.invalidField = null;
    return;
  }
  state.events.push(ev);
  saveEvents();
  processEventBoundaries();
  // ⚑ BUG FIX (author): renderLane("current") was missing here, so linking a
  // new event to a project (projectHasWayForward -> projectHasLinkedEvent)
  // never cleared that project's stale "no linked actions" flag on the Current
  // Projects lane until something else happened to re-render it.
  renderLane("next"); renderLane("waiting"); renderLane("current");
}

// A capture sorted to Calendar (§4.8b Calendar chip) is filed once something
// is created from it; fire the "it moved" banner (§4.15e).
function consumeCalCapture(dateStr){
  const s = state.screen;
  if (!s || !s.calFromCaptureId) return;
  removeCapture(s.calFromCaptureId);
  s.calFromCaptureId = null;
  // §4.15e "it moved" banner — the capture came from the review, so this save
  // moved it off the surface the user was on.
  const d = dateStrToDate(dateStr || s.calSel);
  showItMovedBanner("Scheduled for " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " — in your calendar");
}
// A brief bottom banner (§4.15e). Auto-dismisses; one at a time.
function showItMovedBanner(text){
  const old = document.getElementById("it-moved-banner"); if (old) old.remove();
  const el = document.createElement("div");
  el.id = "it-moved-banner"; el.className = "it-moved-banner"; el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(function(){ el.classList.add("show"); });
  setTimeout(function(){ el.classList.remove("show"); setTimeout(function(){ if (el.parentNode) el.remove(); }, 300); }, 2600);
}
function calMakeHabit(){
  const s = state.screen;
  const name = (s.calName || "").trim();
  const pseudoEv = { title: name || t("habit.newHabitDefault"), date: s.calSel, recurrence: s.calRecur, interval: s.calInterval, id: null };
  const dow = dateStrToDate(s.calSel).getDay();
  const schedule = s.calRecur === "weekly" ? [dow] : [0, 1, 2, 3, 4, 5, 6];
  state.screenStack.push(s);
  state.screen = null;
  openScreen("habit", null, { title: pseudoEv.title, schedule: schedule });
}

// Field input/change for the calendar creation row and the event page. Called
// from app.js's input/change listeners.
function eventsHandleFieldInput(e){
  const s = state.screen;
  if (!s) return false;
  const calEl = e.target.closest("[data-calfield]");
  if (calEl && s.calendarView){
    const f = calEl.getAttribute("data-calfield");
    if (f === "name"){ s.calName = calEl.value; s.calInvalid = false; calEl.classList.remove("field-invalid"); }
    else if (f === "desc"){ s.calDesc = calEl.value; }
    else if (f === "time"){ s.calTime = calEl.value; }
    else if (f === "interval"){ s.calInterval = Math.max(1, Number(calEl.value) || 1); }
    else if (f === "recur"){ s.calRecur = calEl.value; s.calHabitBubbleDismissed = false; renderScreen(); }
    else if (f === "tickler"){ s.calTickler = calEl.checked; }
    return true;
  }
  const evEl = e.target.closest("[data-field]");
  if (evEl && s.eventView){
    const f = evEl.getAttribute("data-field");
    if (f === "event-time"){ s.draft.time = evEl.value || null; renderScreen(); return true; }
    if (f === "event-date"){ if (evEl.value) s.draft.date = evEl.value; return true; } // empty date → keep the current one
    if (f === "event-interval"){ s.draft.interval = Math.max(1, Number(evEl.value) || 1); return true; }
    if (f === "event-recurrence"){ s.draft.recurrence = evEl.value; renderScreen(); return true; }
    if (f === "event-tickler"){ s.draft.tickler = evEl.checked; return true; }
  }
  return false;
}

// =========================================================
// FINGER-FOLLOW MONTH SWIPE (user #7). Three panels (prev · current · next)
// sit in a track parked one viewport-width left, so the CURRENT month is
// centred. During a horizontal drag the track's translateX tracks the finger;
// on release, a flick past the threshold animates to the neighbour and swaps
// the month, otherwise it snaps back. Deliberately built here (not reused from
// the lane long-press drag) so we can see whether the browser fights a
// finger-following horizontal gesture — the same gesture the intray wants.
// =========================================================
function bindCalendarSwipe(){
  const track = document.getElementById("cal-swipe-track");
  if (!track || track._swipeBound) return;
  track._swipeBound = true;
  const viewport = track.parentElement;
  let startX = 0, startY = 0, dx = 0, w = 0, dragging = false, decided = false, horizontal = false;
  function setX(px, animate){
    track.style.transition = animate ? "transform 0.18s ease-out" : "none";
    track.style.transform = "translateX(" + (-w + px) + "px)";
  }
  function reset(){ w = viewport.getBoundingClientRect().width; setX(0, false); }
  reset();
  window.addEventListener("resize", reset);
  track.addEventListener("touchstart", function(e){
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dragging = true; decided = false; horizontal = false;
    w = viewport.getBoundingClientRect().width;
  }, { passive: true });
  track.addEventListener("touchmove", function(e){
    if (!dragging) return;
    const t = e.touches[0];
    const mx = t.clientX - startX, my = t.clientY - startY;
    if (!decided){
      decided = Math.abs(mx) > 8 || Math.abs(my) > 8;
      horizontal = Math.abs(mx) > Math.abs(my);
    }
    if (decided && !horizontal){ dragging = false; setX(0, true); return; } // vertical scroll wins
    if (decided && horizontal){
      e.preventDefault(); // claim the horizontal gesture from the browser
      dx = mx; setX(dx, false);
    }
  }, { passive: false });
  function end(){
    if (!dragging){ return; }
    dragging = false;
    if (!horizontal){ setX(0, true); return; }
    const threshold = Math.max(48, w * 0.25);
    if (dx <= -threshold){ setX(-w, true); setTimeout(function(){ shiftMonth(1); }, 160); }
    else if (dx >= threshold){ setX(w, true); setTimeout(function(){ shiftMonth(-1); }, 160); }
    else { setX(0, true); }
  }
  track.addEventListener("touchend", end, { passive: true });
  track.addEventListener("touchcancel", end, { passive: true });
}

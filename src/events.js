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

const RECUR_OPTIONS = [
  { v: "none", label: "Does not repeat" },
  { v: "daily", label: "Daily" },
  { v: "weekly", label: "Weekly" },
  { v: "monthly", label: "Monthly" },
  { v: "yearly", label: "Yearly" }
];
const RECUR_LABEL = { none: "Does not repeat", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const CAL_UNDO_WINDOW_MS = 10 * 60 * 1000; // §4.15c: un-complete a series occurrence within 10 minutes

function loadEvents(){ return Storage.getJSON("gtd_events", null); }
function saveEvents(){ Storage.setJSON("gtd_events", state.events); }
function findEvent(id){ return (state.events || []).find(function(e){ return e.id === id; }) || null; }
function findEventByTaskId(taskId){ return (state.events || []).find(function(e){ return e.taskId === taskId; }) || null; }
function eventIsAppointment(ev){ return !!(ev && ev.time); }

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
      // (1) COMPLETION-DRIVEN roll: 10 minutes after the pseudo-action was
      //     completed, the series moves on (§4.15b/§4.15c). Before the window
      //     closes, un-completing rolls it back (restorePseudoAction).
      if (ev.completedAt != null && nowInstant() >= ev.completedAt + CAL_UNDO_WINDOW_MS){
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
    // Inside the 10-minute window (§4.15c): roll the series back and let the
    // pseudo-action return. Outside it: the archive entry stands and the series
    // has moved on — REFUSE the restore so it can't duplicate the rolled row.
    if (ev.completedAt != null && nowInstant() < ev.completedAt + CAL_UNDO_WINDOW_MS){
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
  const chip = s.passed ? '<span class="deadline-passed-chip">passed</span>' : "";
  return '<div class="' + classes + '" style="--fill:' + s.fillPercent + '%"><div class="deadline-bar-fill"></div>' + chip + '</div>';
}
// Is this pseudo-action past-due? Used by the review's past-due kind (§4.8b,
// pseudo-action shape) — mirrors deadlineBarState().passed for real deadlines.
function pseudoPassed(task){ return pseudoBarState(task.occDate, task.occTime).passed; }

// The descriptor in front of the date on the card/detail — "event" or
// "appointment", NEVER "deadline" (§4.14).
function pseudoDescriptor(task){ return task.occTime ? "appointment" : "event"; }

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

// Sample events seeded alongside the sample tasks (§4.16 references a calendar,
// so the seed set gives it something to show). Each mints its taskId now.
function seedEvents(){
  const t = boundaryNow();
  function iso(offsetDays){ const d = new Date(t.getFullYear(), t.getMonth(), t.getDate()); d.setDate(d.getDate() + offsetDays); return dateToStr(d); }
  state.events = [
    { id: genId(), taskId: genId(), title: "Dentist", date: iso(2), time: "14:30",
      notesClean: "Cleaning + check-up", recurrence: "none", interval: 1, paused: false,
      contextId: null, linkedProjectId: null, seriesId: null, tickler: false, completedOccs: [] },
    { id: genId(), taskId: genId(), title: "Pay rent", date: iso(5), time: null,
      notesClean: "", recurrence: "monthly", interval: 1, paused: false,
      contextId: null, linkedProjectId: null, seriesId: genId(), tickler: false, completedOccs: [] },
    { id: genId(), taskId: genId(), title: "Renew passport", date: iso(20), time: null,
      notesClean: "Set-and-forget — off the calendar until it's due", recurrence: "none", interval: 1, paused: false,
      contextId: null, linkedProjectId: null, seriesId: null, tickler: true, completedOccs: [] }
  ];
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
    : '<li class="cal-widget-empty">Nothing in the next 7 days.</li>';
  return (
    '<div class="cal-widget" data-action="open-calendar" title="Open the calendar">' +
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
function projectLinkedEventRowsHtml(projectId){
  if (!projectId) return "";
  const evs = (state.events || []).filter(function(ev){ return ev.linkedProjectId === projectId; });
  if (!evs.length) return "";
  // Show the live occurrence at its EFFECTIVE date/time (a moved one included).
  evs.sort(function(a, b){ return (effDate(a, a.date) + (effTime(a, a.date) || "99:99")).localeCompare(effDate(b, b.date) + (effTime(b, b.date) || "99:99")); });
  return evs.map(function(ev){
    const d = dateStrToDate(effDate(ev, ev.date));
    const when = d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + (effTime(ev, ev.date) ? " · " + effTime(ev, ev.date) : "");
    let row = '<button type="button" class="linked-action-item" data-action="open-event" data-id="' + ev.id + '">' +
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
    calInvalid: false, calFromCaptureId: (prefill && prefill.fromCaptureId) || null
  };
  renderScreen();
}
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
  const head = DOW_SHORT.map(function(d){ return '<div class="cal-dow">' + d + '</div>'; }).join("");
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
      const t = effTime(ev, canon), title = effTitle(ev, canon);
      const moved = effDate(ev, canon) !== canon;
      rows.push({
        sort: (t ? "1" + t : "0"), timed: !!t,
        html: '<button type="button" class="cal-agenda-row' + (done ? " cal-agenda-done" : "") + '" data-action="cal-open-event" data-id="' + ev.id + '" data-date="' + canon + '">' +
          '<span class="cal-agenda-dot ' + (t ? "cal-mark-appt" : "cal-mark-event") + '"></span>' +
          '<span class="cal-agenda-when">' + (t ? escapeHtml(t) : "All day") + '</span>' +
          '<span class="cal-agenda-title">' + escapeHtml(title) +
            (moved ? ' <span class="cal-agenda-kind">moved</span>' : "") +
            (ev.tickler ? ' <span class="cal-tickler-tag">hidden</span>' : "") + '</span>' +
        '</button>'
      });
    });
  });
  function deadlineRow(t, laneKind){
    if (!(t.deadline && t.deadline.date === dateStr) || t.isGroup || t.eventId) return;
    rows.push({
      sort: (t.deadline.time ? "1" + t.deadline.time : "0"), timed: !!t.deadline.time,
      html: '<button type="button" class="cal-agenda-row" data-action="cal-open-task" data-lane="' + laneKind + '" data-id="' + t.id + '">' +
        '<span class="cal-agenda-dot cal-mark-dl-' + (laneKind === "current" ? "current" : "next") + '"></span>' +
        '<span class="cal-agenda-when">' + (t.deadline.time ? escapeHtml(t.deadline.time) : "Due") + '</span>' +
        '<span class="cal-agenda-title">' + escapeHtml(t.title) + ' <span class="cal-agenda-kind">' + (laneKind === "current" ? "project" : "action") + ' deadline</span></span>' +
      '</button>'
    });
  }
  state.tasks.next.forEach(function(t){ deadlineRow(t, "next"); });
  state.tasks.current.forEach(function(t){ deadlineRow(t, "current"); });
  rows.sort(function(a, b){ return a.sort.localeCompare(b.sort); });
  if (!rows.length) return '<div class="cal-day-empty">Nothing on this day.</div>';
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
// ⚑ Three judgment calls, spec silent (CLAUDE.md: simplest option, flagged):
//   1. TODAY FORWARD. Past occurrences are the month grid's job and the daily
//      review's; repeating them here would bury the thing you opened it for.
//      This means a past-due deadline does NOT appear — say if you want it, it
//      is a leading "Past due" group and half an hour.
//   2. GROUPED BY DAY with a date heading, rather than a date on every row.
//      The row markup is then byte-identical to Day view's.
//   3. UNTIMED BEFORE TIMED within a day — the same ordering rule Day view
//      already uses (user ruling #4), not a new one.
// =========================================================
function calListRows(){
  const today = todayStr();
  const rows = [];
  (state.events || []).forEach(function(ev){
    // ONE occurrence per series (QA #31's helper does exactly this job): the
    // next one that has not passed. Paused included — a paused series still has
    // a next date, and this view is where you want to see it.
    const canon = nextLiveOccurrenceDate(ev);
    if (!canon) return;                       // finished one-shot
    const date = effDate(ev, canon);
    if (date < today) return;                 // judgment call 1
    const t = effTime(ev, canon), title = effTitle(ev, canon);
    const tags =
      (ev.paused ? ' <span class="cal-agenda-kind">paused</span>' : "") +
      (isRecurring(ev) && !ev.paused ? ' <span class="cal-agenda-kind">' + escapeHtml(RECUR_LABEL[ev.recurrence] || "Repeats").toLowerCase() + '</span>' : "") +
      (ev.tickler ? ' <span class="cal-tickler-tag">hidden</span>' : "");
    rows.push({
      date: date, sort: (t ? "1" + t : "0"),
      html: '<button type="button" class="cal-agenda-row" data-action="cal-open-event" data-id="' + ev.id + '" data-date="' + canon + '">' +
        '<span class="cal-agenda-dot ' + (t ? "cal-mark-appt" : "cal-mark-event") + '"></span>' +
        '<span class="cal-agenda-when">' + (t ? escapeHtml(t) : "All day") + '</span>' +
        '<span class="cal-agenda-title">' + escapeHtml(title) + tags + '</span>' +
      '</button>'
    });
  });
  function deadlineRow(t, laneKind){
    if (t.isGroup || t.eventId) return;       // pseudo-actions come from gtd_events
    if (!(t.deadline && t.deadline.date)) return;
    if (t.deadline.date < today) return;      // judgment call 1
    rows.push({
      date: t.deadline.date, sort: (t.deadline.time ? "1" + t.deadline.time : "0"),
      html: '<button type="button" class="cal-agenda-row" data-action="cal-open-task" data-lane="' + laneKind + '" data-id="' + t.id + '">' +
        '<span class="cal-agenda-dot cal-mark-dl-' + (laneKind === "current" ? "current" : "next") + '"></span>' +
        '<span class="cal-agenda-when">' + (t.deadline.time ? escapeHtml(t.deadline.time) : "Due") + '</span>' +
        '<span class="cal-agenda-title">' + escapeHtml(t.title) + ' <span class="cal-agenda-kind">' + (laneKind === "current" ? "project" : "action") + ' deadline</span></span>' +
      '</button>'
    });
  }
  state.tasks.next.forEach(function(t){ deadlineRow(t, "next"); });
  state.tasks.current.forEach(function(t){ deadlineRow(t, "current"); });
  rows.sort(function(a, b){
    return a.date === b.date ? a.sort.localeCompare(b.sort) : a.date.localeCompare(b.date);
  });
  return rows;
}
function calListHtml(){
  const rows = calListRows();
  if (!rows.length){
    return '<div class="cal-day-empty">Nothing coming up. Anything you schedule will be listed here, in the order it happens.</div>';
  }
  const today = todayStr();
  let html = '<div class="cal-agenda cal-list">', lastDate = null;
  rows.forEach(function(r){
    if (r.date !== lastDate){
      const d = dateStrToDate(r.date);
      const label = r.date === today
        ? "Today"
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
  const seg =
    '<div class="cal-seg">' +
      '<button type="button" class="cal-seg-btn' + (isEvent ? " active" : "") + '" data-action="cal-kind" data-kind="event">Event</button>' +
      '<button type="button" class="cal-seg-btn' + (!isEvent ? " active" : "") + '" data-action="cal-kind" data-kind="deadline">Deadline</button>' +
    '</div>';
  let controls;
  if (isEvent){
    const habitBubble = (s.calRecur === "daily" || s.calRecur === "weekly")
      ? '<button type="button" class="cal-habit-bubble" data-action="cal-make-habit">Recurring chore? Make this a habit instead &#8594;</button>' : "";
    controls =
      '<div class="cal-create-controls">' +
        '<div class="cal-boxed"><span class="field-icon">&#128337;</span>' +
          '<input type="time" class="screen-time" data-calfield="time" value="' + escapeHtml(s.calTime || "") + '" style="color-scheme:dark" title="Optional">' +
        '</div>' +
        '<input type="text" class="cal-desc" data-calfield="desc" placeholder="Description (optional)…" value="' + escapeHtml(s.calDesc || "") + '">' +
        '<div class="cal-boxed"><span class="field-icon">&#128260;</span>' +
          '<select class="screen-link-select" data-calfield="recur">' +
            RECUR_OPTIONS.map(function(o){ return '<option value="' + o.v + '"' + (o.v === s.calRecur ? " selected" : "") + '>' + o.label + '</option>'; }).join("") +
          '</select>' +
          (s.calRecur !== "none" ? '<span class="cal-hint">every</span><input type="number" min="1" class="cal-interval" data-calfield="interval" value="' + (s.calInterval || 1) + '">' : "") +
        '</div>' +
        habitBubble +
        '<label class="cal-tickler-row"><input type="checkbox" data-calfield="tickler"' + (s.calTickler ? " checked" : "") + '> Hide until the day it happens</label>' +
      '</div>';
  } else {
    controls =
      '<div class="cal-create-controls">' +
        '<div class="cal-boxed"><span class="field-icon">&#128337;</span>' +
          '<input type="time" class="screen-time" data-calfield="time" value="' + escapeHtml(s.calTime || "") + '" style="color-scheme:dark" title="Optional">' +
        '</div>' +
        '<input type="text" class="cal-desc" data-calfield="desc" placeholder="Description (optional)…" value="' + escapeHtml(s.calDesc || "") + '">' +
        '<div class="cal-seg cal-seg-small">' +
          '<button type="button" class="cal-seg-btn' + (s.calDeadlineFor === "next" ? " active" : "") + '" data-action="cal-dlfor" data-for="next">Action</button>' +
          '<button type="button" class="cal-seg-btn' + (s.calDeadlineFor === "current" ? " active" : "") + '" data-action="cal-dlfor" data-for="current">Project</button>' +
        '</div>' +
      '</div>';
  }
  const sel = dateStrToDate(s.calSel);
  const selLabel = sel.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  // The creation controls stay fully visible (user ruling: scrolling the
  // calendar is fine, a collapsible creation section is not).
  return (
    '<div class="cal-create">' +
      seg +
      '<div class="cal-create-main">' +
        '<input type="text" class="cal-name' + (s.calInvalid ? " field-invalid" : "") + '" data-calfield="name" placeholder="' + (isEvent ? "Event on " : "Due ") + escapeHtml(selLabel) + '…" value="' + escapeHtml(s.calName || "") + '" autocomplete="off">' +
        '<button type="button" class="cal-add-btn" data-action="cal-add">Add</button>' +
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
      '<button type="button" class="screen-chrome-btn" data-action="cal-close" title="Back">&#8592;</button>' +
      '<div class="cal-tabs">' +
        '<button type="button" class="cal-tab' + (s.calTab === "month" ? " active" : "") + '" data-action="cal-tab" data-tab="month">Month</button>' +
        '<button type="button" class="cal-tab' + (s.calTab === "day" ? " active" : "") + '" data-action="cal-tab" data-tab="day">Day</button>' +
        '<button type="button" class="cal-tab' + (s.calTab === "list" ? " active" : "") + '" data-action="cal-tab" data-tab="list">List</button>' +
      '</div>' +
      '<div class="screen-header-right">' +
        '<span class="screen-chrome-btn" style="visibility:hidden">&#8592;</span>' +
      '</div>' +
    '</div>'
  );
}
function calendarBodyHtml(s){
  let body;
  if (s.calTab === "month"){
    const nav =
      '<div class="cal-monthnav">' +
        '<button type="button" class="cal-navbtn" data-action="cal-month" data-dir="-1">&#8249;</button>' +
        '<span class="cal-monthlabel">' + MONTHS[s.calM] + " " + s.calY + '</span>' +
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
    body = '<div class="cal-daynav"><span class="cal-monthlabel">Coming up</span></div>' + calListHtml();
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
function eventBodyHtml(s){
  const d = s.draft;
  const ev = findEvent(s.eventId) || {};
  const doneToday = (ev.completedOccs || []).indexOf(s.occDate || d.date) !== -1; // completion keyed by canonical
  let fields = "";
  // On a recurring series, name the occurrence being edited so "this occurrence
  // only" vs "all occurrences" (offered at save) has a clear referent.
  if (isRecurring({ recurrence: d.recurrence })){
    const occ = dateStrToDate(s.occDate || d.date);
    fields += '<div class="event-occ-hint">Editing the occurrence on ' +
      escapeHtml(occ.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })) +
      ' · you’ll choose this one or the whole series when you save</div>';
  }
  fields += '<input type="text" class="screen-field-title' + (s.invalidField === "title" ? " field-invalid" : "") + '" data-field="title" placeholder="Event title…" value="' + escapeHtml(d.title) + '">';
  fields += '<textarea class="screen-field-desc" data-field="notesClean" placeholder="Description (optional)…">' + escapeHtml(d.notesClean) + '</textarea>';
  // Date — editable, so an occurrence can be moved to another day (a recurring
  // event asks "this occurrence / all" at save; a one-off just moves).
  fields += '<div class="screen-row"><div class="screen-boxed-row"><span class="field-icon">&#128197;</span>' +
    '<input type="date" class="screen-date" data-field="event-date" value="' + escapeHtml(d.date || "") + '" style="color-scheme:dark">' +
    (isRecurring({ recurrence: d.recurrence }) ? '<span class="cal-hint">move this occurrence</span>' : "") +
    '</div></div>';
  // Time
  fields += '<div class="screen-row"><div class="screen-boxed-row"><span class="field-icon">&#128337;</span>' +
    // ⚑ The "a time makes it an appointment" hint is gone (user): event vs.
    // appointment is a distinction the IMPLEMENTATION needs — it decides the
    // progress bar's window (§4.14c) and the past-due moment — but it means
    // nothing to someone adding a dentist visit. The field is optional and
    // self-evident; naming the taxonomy only taught users a word they will
    // never need. The internal terms stay in the code and the spec.
    '<input type="time" class="screen-time" data-field="event-time" value="' + escapeHtml(d.time || "") + '" style="color-scheme:dark">' +
    (d.time ? '<button type="button" class="screen-clear-x" data-action="event-clear-time" title="Clear time">&times;</button>' : "") +
    '</div></div>';
  // Recurrence
  fields += '<div class="screen-row"><div class="screen-boxed-row"><span class="field-icon">&#128260;</span>' +
    '<select class="screen-link-select" data-field="event-recurrence">' +
      RECUR_OPTIONS.map(function(o){ return '<option value="' + o.v + '"' + (o.v === d.recurrence ? " selected" : "") + '>' + o.label + '</option>'; }).join("") +
    '</select>' +
    (d.recurrence !== "none" ? '<span class="cal-hint">every</span><input type="number" min="1" class="cal-interval" data-field="event-interval" value="' + (d.interval || 1) + '">' : "") +
    '</div></div>';
  // "Make this a habit instead" (§4.15b) — daily/weekly only, load-bearing.
  if (d.recurrence === "daily" || d.recurrence === "weekly"){
    fields += '<button type="button" class="cal-habit-bubble" data-action="event-make-habit">Recurring chore? Make this a habit instead &#8594;</button>';
  }
  // Context (edit-only, §4.15a) + project link (§4.15d)
  fields += contextRowHtml(d);
  fields += '<div class="screen-row"><div class="screen-boxed-row"><span class="field-icon">&#128279;</span>' +
    '<select class="screen-link-select" data-field="linkedProjectId">' + projectOptionsHtml(d.linkedProjectId) + '</select></div></div>';
  // Tickler toggle (user addition)
  fields += '<label class="cal-tickler-row"><input type="checkbox" data-field="event-tickler"' + (d.tickler ? " checked" : "") + '> Hide until the day it happens</label>';
  // Pause — recurring only, draft-only + armed (§4.15b, golden-rule sibling)
  if (isRecurring({ recurrence: d.recurrence })){
    fields += '<button type="button" class="btn screen-pause-btn' + (d.paused ? " armed" : "") + '" data-action="event-toggle-pause">' +
      (d.paused ? "&#9208; Paused — resume on save" : "&#9208; Pause series") + '</button>';
  }
  // Complete — draft-only, arms on save (§4.14: completes like a Next Action)
  const armed = !!d.willComplete;
  // ⚑ QA #27: this emitted `armed`, but .screen-complete-pill only styles
  // `.done` (and `.paused`) — .screen-complete-pill.armed matches no rule
  // anywhere, so the armed state on THIS page alone rendered unshaded. The
  // action page has always emitted `done` for the identical draft state; the
  // class name is the app-wide contract for "this pill is lit", so the event
  // page now speaks it too. (`armed` remains correct on .screen-pause-btn and
  // .screen-make-kind-btn, which do define it.)
  fields += '<button type="button" class="btn screen-complete-pill' + (armed ? " done" : "") + '" data-action="event-complete">' +
    (armed ? "&#10003; Completing on save" : (doneToday ? "&#10003; Completed today — tap to reopen on save" : "Mark complete")) + '</button>';
  return '<div class="screen-body">' + fields + '</div>';
}

// Save the event page (§4.14a: on a recurring series the pseudo-action keeps
// its task ID; the ID lives on the event, so it survives all edits here).
// The occurrence-level fields (title/time/notesClean) can land on THIS
// occurrence (an override) or the WHOLE series (the base) — chosen at save via
// a dialog that mirrors the recurring-delete one (user #3).
function saveEventScreen(s){
  const d = s.draft;
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
      ? "Repeat, pause, context, project link and hiding always apply to the whole series — those are saved either way. Apply your other changes to…"
      : "Apply your changes to…";
    openConfirmDialog(prompt, [
      { label: "This occurrence only", style: "primary", action: commitOccurrence },
      { label: "All occurrences", action: commitSeries },
      { label: "Cancel", action: function(){} }
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
    openConfirmDialog("This event repeats. What would you like to do?", [
      { label: "Skip this one", action: function(){ skipOccurrence(ev); done(); } },
      { label: "Delete series", style: "danger", action: function(){ deleteEventEntirely(ev); done(); } },
      { label: "Cancel", action: function(){} }
    ]);
  } else {
    openConfirmDialog("Delete “" + escapeHtml(ev.title) + "”?", [
      { label: "Delete", style: "danger", action: function(){ deleteEventEntirely(ev); done(); } },
      { label: "Cancel", action: function(){} }
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
function skipOccurrence(ev){
  const nd = nextOccurrenceDate(ev.date, ev.recurrence, ev.interval);
  if (nd){ ev.date = nd; }
  ev.completedAt = null; ev.completedFrom = null;
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
      renderScreen(); return true;
    }
    const kb = e.target.closest('[data-action="cal-kind"]');
    if (kb){ s.calKind = kb.getAttribute("data-kind"); renderScreen(); return true; }
    const dlf = e.target.closest('[data-action="cal-dlfor"]');
    if (dlf){ s.calDeadlineFor = dlf.getAttribute("data-for"); renderScreen(); return true; }
    if (e.target.closest('[data-action="cal-add"]')){ calAdd(); return true; }
    if (e.target.closest('[data-action="cal-make-habit"]')){ calMakeHabit(); return true; }
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
  if (s.calKind === "event"){
    if (eventTitleClashes(name, null)){ s.calInvalid = true; renderScreen(); const el = qs(".cal-name"); if (el) el.focus(); return; }
    const ev = {
      id: genId(), taskId: genId(), title: name, date: s.calSel, time: s.calTime || null,
      notesClean: s.calDesc || "", recurrence: s.calRecur || "none", interval: Math.max(1, s.calInterval || 1),
      paused: false, contextId: null, linkedProjectId: null,
      seriesId: (s.calRecur && s.calRecur !== "none") ? genId() : null, tickler: !!s.calTickler, completedOccs: []
    };
    state.events.push(ev);
    saveEvents();
    processEventBoundaries();
    renderLane("next"); renderLane("waiting");
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
  if (cameFromReview){ closeScreen(); return; }
  // Otherwise the calendar is where the user chose to be: reset the row for the
  // next entry and stay put, keeping the toggles where they are.
  s.calName = ""; s.calDesc = ""; s.calTime = ""; s.calInvalid = false;
  renderScreen();
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
  const pseudoEv = { title: name || "New habit", date: s.calSel, recurrence: s.calRecur, interval: s.calInterval, id: null };
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
    else if (f === "recur"){ s.calRecur = calEl.value; renderScreen(); }
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

// =========================================================
// CHUNK MAP (spec.md §8.2) — its own src/ module per that section's
// "from chunk 0b it must land in src/ as its own module, or the stapler
// will drop it." First build of this convention: no prior single-file
// version existed to migrate out of (grepping index-47.html before this
// chunk found nothing).
//
// Injects one Current Project per sprint chunk (§2), grouped under a
// single "Sprint chunks" project so the plan is visible from inside the
// app while testing. As of v2 it also carries the post-sprint rounds and
// marks what is done, because with every numbered chunk but 9 built, a bare
// plan no longer answers the question it is opened for. Every entry is deliberately unlinked — each shows
// the lane's own "no linked actions" flag, which is expected and useful
// here (it's a plan, not a real project).
//
// Same conventions as injectQAChecklist: guarded by a flag so it only
// runs once per version, replaces rather than accumulates on every
// version bump, and is swept + re-injected by Reset local data so it
// survives a fresh seed. Self-contained; safe to delete wholesale
// (this file + its boot() call) if the convention is ever retired.
// =========================================================
function injectChunkMap(){
  const FLAG = "gtd_chunk_map_v13";
  if (Storage.get(FLAG)) return;
  Storage.set(FLAG, "1");
  ["gtd_chunk_map_v1", "gtd_chunk_map_v2", "gtd_chunk_map_v3", "gtd_chunk_map_v4",
   "gtd_chunk_map_v5", "gtd_chunk_map_v6", "gtd_chunk_map_v7", "gtd_chunk_map_v8",
   "gtd_chunk_map_v9", "gtd_chunk_map_v10", "gtd_chunk_map_v11",
   "gtd_chunk_map_v12"].forEach(Storage.remove);  // retire superseded flags

  // Replace, don't accumulate (8.2, mirroring 8.1): sweep any previous
  // chunk-map group (tagged via devContext, not a title match, since the
  // map's own title text is free to change) out of Current Projects.
  const staleGroupIds = new Set(state.tasks.current
    .filter(function(t){ return t.isGroup && t.devContext === "chunk-map"; })
    .map(function(t){ return t.id; }));
  if (staleGroupIds.size){
    state.tasks.current = state.tasks.current.filter(function(t){
      return !staleGroupIds.has(t.id) && !staleGroupIds.has(t.parent);
    });
  }

  // Regenerated from spec.md §2 each time this file is touched — this is a
  // derived view of the plan, not a document of record. If §2 changes,
  // this list is what's stale.
  // Regenerated from spec.md §2 each time this file is touched — this is a
  // derived view of the plan, not a document of record. If §2 changes, this
  // list is what's stale.
  //
  // ⚑ It now shows STATE, not just the plan. Every numbered chunk except 9 is
  // built, so a bare list of chunk titles had stopped answering the question
  // anybody actually opens it for — what is left. Done rows are ticked and say
  // what landed; the rest is what remains, including the post-sprint work that
  // never had chunk numbers and so was invisible here.
  const CHUNKS = [
    { title: "✓ 0a — Remove Google + points", notes: "DONE. Disconnected the app from Google Tasks entirely and removed the points counter. Fully local-only, with nothing to score." },
    { title: "✓ 0b — Restructure + storage + install", notes: "DONE. The code became maintainable pieces, storage fails safely instead of crashing when a device runs low, and the app installs to a home screen with its own icon." },
    { title: "✓ 0c — Dev tools: snapshot & restore", notes: "DONE. A developer safety net: snapshot everything before risky testing, roll it back after. The QA time-jump buttons live here too." },
    { title: "✓ 1 — Navigation stack", notes: "DONE. Back always returns to the right previous screen, however many deep you went." },
    { title: "✓ 2 — Main UI redesign", notes: "DONE. The tab bar, the deadline progress bars, the floating + and the phone-shaped layout all came from here." },
    { title: "✓ 3 — Contexts + retire old dates", notes: "DONE. Contexts you can tag actions with, and the old date-based waiting options removed so the calendar could do it properly." },
    { title: "✓ 4 — Completed items overhaul", notes: "DONE. Finished items archive properly and can be un-finished if you tick something by mistake." },
    { title: "✓ 5 — Staged child actions", notes: "DONE. Actions created on a project page are drafts until the project itself is saved — the same nothing-commits-until-Save rule as everywhere else." },
    { title: "✓ 6 — Tray, Notes, header, settings", notes: "DONE. The capture drawer, the Notes tab, tags, and the ⋯ settings menu." },
    { title: "✓ 6b — The daily review", notes: "DONE, and extended since: it now also asks about repeats you forgot to tick, and can add a waiting action to a stalled project." },
    { title: "✓ 7 — Calendar + events + recurrence", notes: "DONE. The calendar, events, appointments and repeats. A List view was added afterwards." },
    { title: "✓ 8 — Export / import", notes: "DONE. Save everything to a file and restore from one. ⚠ Not re-tested since several new fields were added — see the ‘Re-test backups’ row below." },
    { title: "✓ Post-sprint — Desks, habit runner, settings", notes: "DONE. The settings dropdown, the background picker, the chalkboard habit runner, and the app being named OELA." },
    { title: "✓ Post-sprint — Calendar and review follow-ups", notes: "DONE. Repeating events stopped projecting into the past, past-due events can be deleted from the review, and the pickers were unified." },
    { title: "✓ Post-sprint — Pickers, deadlines, wording, decoration", notes: "DONE. The app's own time and date pickers, pushed deadlines that restart their bar and count the push, one clock app-wide, the jargon removed, the photographic desks and black lacquer, and the + on lists and contexts." },
    { title: "✓ Post-sprint — Your checklist findings", notes: "DONE. Six of the seven you reported: ticking a past-due repeat now clears it from the review; the QA clock buttons reach you inside the calendar and every other full-screen page; a revealed intray card opens its item; the review's quick-add boxes take typing again (they were opening the date picker) and gained a Full page button; a project's creation page can add an event, as a proper draft; and naming a new list or context no longer drags the screen to the bottom. The seventh — a delete dialog when leaving a repeating event — I could not reproduce; there is a question waiting for you in the QA checklist." },

    { title: "✓ Polish the writing", notes: "DONE. Ruled that the only text needing a review pass was the information-button copy; INFO-TEXT.txt was marked up and is now wired into the app. COPY.txt — the generated dump of all 236 strings — is OBSOLETE and was never filled in; the app's inline wording stands as written. This row used to say everything waited on it, which is what made the translation look blocked when it was not."},
    { title: "✓ Chinese translation", notes: "DONE. src/i18n.js holds the string table (English + Simplified Chinese) and the ⋯ → Language switch, which re-labels the whole app live and persists the choice. Built on the same en / zh-Hans pattern the habit bubbles already used." },
    { title: "✓ Chinese translation — native-speaker pass", notes: "DONE. The tutorial, every lane's (i), and the daily review's decision text were rewritten by a native speaker to stop reading as translated-from-English, and a glossary pass swept 泳道/复盘/「」 out of the rest of i18n.js in favor of 列表·清单/回顾/“ ”. Also fixed a same-page label collision: the desktop footer's Done button was labelled 完成, the same word as the Complete pill next to it — Done is now 保存 (Save), matching its own tooltip." },
    { title: "✓ Review's stalled-project Add button", notes: "DONE. The quick-add row used to read Cancel · Full page → · Add, so the escape hatch sat right where a fat-fingered tap for Add would land. Add is now the filled, unmistakably primary button on the right; Full page → moved to the far left and reads as muted/dashed instead of a normal button." },
    { title: "✓ In-lane tutorial", notes: "DONE. Six numbered steps seeded across the lanes (make a next action, a hooked waiting action, a context, a project, fix a stalled project in Review, build a habit), cleared through completion as you go. The cards are wired to each other to demo the dependency — ② is hooked to ① and linked to project ④ — and the text toggles with the language. Two cards persist and are deleted by hand: the ◇ stalled sample (step ⑤ needs it) and the ⑥ habit (habits can't self-complete)." },
    { title: "✓ Someday has no deadlines", notes: "DONE. Future projects don't take a deadline by definition, so the field is gone from their pages and a Current → Someday conversion drops any deadline silently — no warning about losing something the destination can't hold." },
    { title: "✓ Fix up the desktop layout", notes: "DONE. On a window 1000px or wider the app now shows THREE lanes at once, keeping the same pairings as the phone's tabs: Next↔Waiting on the left, Projects↔Someday in the middle, Notes↔Habits on the right, each with a toggle carrying both lists' counts. The floating + is replaced by real buttons under each column's header; drafting pages become centred cards with a Done button bottom-right and Delete bottom-left; the calendar opens as a wide popup; Language and Background move out of the ⚙ menu into the header; OELA sits in the middle; and the gold border wraps the whole page. Narrower than 1000px you get the phone app exactly as before — with one change on both layouts: the header's intray button is gone, replaced by an edge handle on the left of the screen. Also new on both: closing a page you have edited asks before throwing the changes away." },
    { title: "✓ Intray handle, redrawn", notes: "DONE. The edge handle was flagged as visually distracting — it started as a solid white tab. It is now two small nested arrow-lines with no background block behind them, sitting at the exact vertical middle of the screen instead of a third of the way down. Fully invisible (display:none, not just faded) the instant a drafting page opens, on both layouts." },
    { title: "✓ The tutorial is now a chain", notes: "DONE. Steps ②–⑥ used to be five separate cards (only ② was actually hooked to anything); they are now a real chain of waiting actions, each hooked to the one before it, seeded together into Waiting On and promoting into Next Actions one at a time as you tick through — the same mechanic ② always demonstrated, now run five times instead of once. Building it surfaced and fixed a real bug in the hook engine: a waiting action's condition pill could show as broken ('cue-orphaned') for as long as its target sat promoted-but-not-yet-completed, because the lookup picked one storage pool by a value that goes stale the moment the target changes lanes. The healthy demo project ② links to is no longer step ④ itself (a project can't be a chain link) — it is its own unnumbered card, ◆, the same way the stalled sample ◇ already worked." },
    { title: "✓ Events on the project page", notes: "DONE. A project shows its linked events and can create them — including on the creation page, where the event is held as a draft and only becomes real when the project is saved. ‘Add an event’ in the daily review came with it." },
    { title: "✓ Linked notes on the project page", notes: "DONE. The link runs both ways now. A current project's Linked panel has an Actions side and a Notes side you toggle between, and a Someday project has a Linked notes section of its own — notes only, since a Someday project holds no actions by design." },
    { title: "Re-test backups against the new fields", notes: "TO DO. Export and import have not been exercised since deadlines gained a start date and a push counter, repeats gained a missed-day marker, and the backgrounds changed names. Backups are the one thing that has to survive real use." },
    { title: "✓ The review surface, standardised", notes: "DONE. Fixed a live bug where the Chinese text for a missed repeat quoted buttons that no longer existed. The review's five card kinds (missed, past due, stalled, orphaned, and the sort-a-thought capture card) now share one delete style and one 'Not now' corner position instead of five different looks. The four decision cards (everything but capture) are now grouped into bands — 'ways to move it forward', 'ways to take it off the list', then Not now/Delete — separated by a divider line, same layout on phone and computer, so a card that used to be seven buttons in a column now reads at a glance. Buttons that send the item to a list are short and colored like that list's tab ('+Next', '+Waiting', '+Event', 'Someday →'), modeled on the capture card's own colored buttons; buttons that resolve or edit in place stay plain. The missed-repeat button 'Let it go' is renamed 'Skipped' (in both languages) so it can't be misread as the same action as 'Not now'. The review's (i) info button now explains only the one card on screen, not all five kinds at once, and stays open as you move to the next card." },
    { title: "✓ The habit-bubble dismiss, and the Advanced buttons", notes: "DONE. The calendar's 'Make this a habit instead' suggestion (shown when you set something to repeat daily or weekly) now has a small X to dismiss it — it comes back next time you pick daily or weekly on a fresh item. Every 'Advanced options' / 'More options' button across the app got a light grey fill for contrast, and the calendar's copy moved up next to the Event/Deadline toggle instead of sitting at the bottom of the form, on both phone and computer." },
    { title: "✓ The desktop calendar, fixed", notes: "DONE. The computer calendar used to overflow the screen at every size tested, including 1920x1080 — the day squares were too tall and the Add button could sit below the fold. It's now two columns (the form on the left, wide short day-squares on the right), fits on screen at any reasonable window size, and the phone layout is untouched." },
    { title: "✓ 9 — Service worker + offline + install polish", notes: "DONE. The app now works with no internet — it saves a copy of itself the first time you open it online, so airplane mode after that still loads and works. When I ship a change while you have the app open, a small bar appears saying “New version available” with a Reload button; nothing ever updates or interrupts you without that tap. See the fresh QA checklist in Next Actions to try both." },
    { title: "A drawing tool for Notes — only if there is time", notes: "MAYBE. The first thing to cut if the month runs out." }
  ];

  const groupId = genId();
  state.tasks.current.push({
    id: groupId, title: "🗺 Sprint chunks", notesClean: "", linkedProjectId: null,
    isGroup: true, parent: null, devContext: "chunk-map"
  });
  CHUNKS.forEach(function(chunk){
    state.tasks.current.push({
      id: genId(), title: chunk.title, notesClean: chunk.notes, linkedProjectId: null,
      isGroup: false, parent: groupId
    });
  });

  saveTasksLocal("current");
}

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
  const FLAG = "gtd_chunk_map_v3";
  if (Storage.get(FLAG)) return;
  Storage.set(FLAG, "1");
  ["gtd_chunk_map_v1", "gtd_chunk_map_v2"].forEach(Storage.remove);  // retire superseded flags

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

    { title: "Polish the writing", notes: "TO DO, and first — everything else that touches words waits on it. All the app's text is in COPY.txt and the information-button text is in INFO-TEXT.txt, both for you to mark up." },
    { title: "Chinese translation", notes: "TO DO. Waits on the writing being final: translating text that is about to be rewritten is wasted work. The habit thought-bubbles already have Chinese; everything else does not." },
    { title: "Fix up the desktop layout", notes: "TO DO. Everything this sprint was designed and tested on a phone, and the desktop view has drifted — wide screens especially." },
    { title: "Events on the project page", notes: "TO DO. Lets a project show and create calendar events. Needs a design pass first (written up for you in INFO-TEXT.txt) because projects and the calendar have overlapping ideas about dates. Also unblocks ‘create event’ in the daily review." },
    { title: "Linked notes on the project page", notes: "TO DO. The link only runs one way today: a note can link to a project and shows a chip for it, but the project page lists linked actions and linked events and nothing for notes. One decision first — that page has no tabs at all, so a ‘notes tab’ either introduces tabs to it or becomes a third section." },
    { title: "Re-test backups against the new fields", notes: "TO DO. Export and import have not been exercised since deadlines gained a start date and a push counter, repeats gained a missed-day marker, and the backgrounds changed names. Backups are the one thing that has to survive real use." },
    { title: "9 — Service worker + offline + install polish", notes: "TO DO, and deliberately LAST. Makes the app work with no internet and update like a proper app. Scheduled last on purpose: caching an app while it is still changing costs hours of chasing stale builds." },
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

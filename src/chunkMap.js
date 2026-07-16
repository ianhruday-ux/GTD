// =========================================================
// CHUNK MAP (spec.md §8.2) — its own src/ module per that section's
// "from chunk 0b it must land in src/ as its own module, or the stapler
// will drop it." First build of this convention: no prior single-file
// version existed to migrate out of (grepping index-47.html before this
// chunk found nothing).
//
// Injects one Current Project per sprint chunk (§2), grouped under a
// single "Sprint chunks" project so the plan is visible from inside the
// app while testing. Every entry is deliberately unlinked — each shows
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
  const FLAG = "gtd_chunk_map_v1";
  if (Storage.get(FLAG)) return;
  Storage.set(FLAG, "1");

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
  const CHUNKS = [
    { title: "0a — Remove Google + points", notes: "Disconnects the app from Google Tasks entirely and removes the points/score counter. The app is now fully local-only, with nothing to score." },
    { title: "0b — Restructure + storage + install", notes: "No visible change to how the app behaves. Under the hood the code is reorganized into maintainable pieces, local storage now fails safely instead of crashing if your device runs low on space, and the app becomes installable to your home screen with its own icon and window." },
    { title: "0c — Dev tools: snapshot & restore", notes: "A developer-only safety net: one button to snapshot all your data before risky testing, one to roll it back. Nothing you'll notice day to day." },
    { title: "1 — Navigation stack", notes: "Fixes Back so it always returns you to the right previous screen, even several screens deep (lane → project → linked action). No new screens — just correct backing-out behavior." },
    { title: "2 — Main UI redesign", notes: "A visual overhaul: a floating tab bar that collapses as you scroll, a progress bar on deadlines, a new + button for creating lists and actions, and layout tuned for a phone's notch and gesture bar." },
    { title: "3 — Contexts + retire old dates", notes: "Adds shared contexts (like @home, @errands) you can tag Next/Waiting actions with, and removes the old date-based waiting/recurrence options the calendar (chunk 7) will replace properly." },
    { title: "4 — Completed items overhaul", notes: "Reworks how finished items are archived and shown, so your completed history is easier to browse — and to undo a mistaken completion from." },
    { title: "5 — Staged child actions", notes: "On a project page, actions you create while editing are staged as drafts and only really created once you save the project — matching the app's ‘nothing commits until Save’ rule everywhere else." },
    { title: "6 — Tray, Notes, header, settings", notes: "Adds a slide-out capture drawer for quick notes on the go, a Notes tab, and a settings menu (behind the header's ⋯) that holds Reset and, later, Export/Import." },
    { title: "6b — The daily review", notes: "A guided daily review: one queue that walks you through anything stalled, overdue, or waiting on someone, one at a time, with clear next-step choices." },
    { title: "7 — Calendar + events + recurrence", notes: "The biggest chunk: a real calendar with events, appointments, and repeating items. Events are new and separate from your task lanes — a due event shows up as a linked action right when it's time." },
    { title: "8 — Export / import", notes: "Adds Export to save all your data to a file, and Import to restore from one, replacing whatever's currently in the app. This is what makes it safe to move to a new device or a native wrapper." },
    { title: "9 — Service worker + offline + install polish", notes: "The app can be used with no internet connection at all, and installs/updates behave like a proper app. Deliberately last — caching an in-progress app makes testing painful." }
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

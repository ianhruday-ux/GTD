"""Build the human-reviewable copy file from src/."""
import re, pathlib, datetime, collections

# ⚑ DERIVED, not hardcoded (2026-08-03). This used to spell out
# C:\Users\ianhr\OneDrive\Desktop\GTD, which was the one file in the repo that
# broke when the project left OneDrive — and it would have broken again on the
# next move. The script lives at the repo root, so the root is simply its own
# folder; every checks/*.py already resolves its paths this way.
REPO = pathlib.Path(__file__).resolve().parent
SRC = REPO / "src"
OUT = REPO / "COPY.txt"

FILES = ["index.html", "app.js", "events.js", "timepicker.js", "runner.js"]

FUNC = re.compile(r'^\s*(?:function\s+([A-Za-z0-9_$]+)|const\s+([A-Z][A-Za-z0-9_$]*)\s*=)')

PATTERNS = [
    ("placeholder", re.compile(r'placeholder="([^"]{2,})"')),
    ("tooltip",     re.compile(r'title="([^"]{2,})"')),
    ("aria",        re.compile(r'aria-label="([^"]{2,})"')),
]
TAG_TEXT = re.compile(r'>([A-Z][^<>"\'{}]{2,70}?)<')
SENT = re.compile(r'"([A-Z][^"\\]{10,200}?)"')
SENT2 = re.compile(r"'([A-Z][^'\\]{10,200}?)'")

# Dev scaffolding — regenerated every round, never product copy.
SKIP_FUNCS = {"injectQAChecklist", "injectChunkMap", "addGroupWithItems",
              "showDragLog", "dragLogInit", "updateDragLogUI", "dlog",
              "seedData", "seedSampleData", "defaultTasks", "defaultEvents",
              "restoreSnapshot", "saveSnapshot", "iso", "disarmDragWatchdog",
              "bindEvents", "commit", "commitOccurrence"}
SKIP_SUBSTR = ["QA —", "gtd_", "gtddev_", "data-", "chunk-", "\\u",
               # dev panel: not product copy, and stripped from the real build
               "Dev QA aid", "QA:", "Drag log", "Snapshot", "snapshot",
               "Reset local data", "Restore app to defaults",
               # leaked markup / entities rather than prose
               "&lsquo;", "&rsquo;", "&nbsp;", "font-", "border", "rgba("]

# Function -> the place in the app you actually see it.
AREAS = [
    ("The main screen — lanes, tabs, cards", [
        "index.html", "leafCardHtml", "groupHtml", "contextGroupHtml", "renderLane",
        "completedSectionHtml", "completedHeaderHtml", "completedBodyHtml",
        "completedItemHtml", "laneShellHtml", "LANE_INFO", "LIST_TITLES",
        "KIND_BADGE_LABEL", "FAB_MENU_LABELS", "makeKindBtnHtml", "conditionPillHtml",
        "deadlinePushChipHtml", "openInlineNameRow", "waitingWidgetHtml"]),
    ("The intray (capture drawer)", [
        "trayCardHtml", "trayListHtml", "renderTray", "trayReviewBtnHtml", "TRAY_INFO",
        "eyeIconHtml"]),
    ("The daily review", [
        "reviewCardHtml", "reviewInfoPanelHtml", "REVIEW_MENU_INFO", "reviewHeaderHtml",
        "reviewBodyHtml", "reviewInlineFormHtml", "reviewMenuBtn", "openReviewScreen"]),
    ("Create and edit pages", [
        "screenBodyHtml", "screenHeaderHtml", "deadlineFieldsHtml", "waitingForRowHtml",
        "advancedRowHtml", "renderAdvancedDialog", "attemptCancelScreen",
        "deleteScreenItem", "screenPickHook", "projectOptionsHtml",
        "linkedActionsListHtml", "linkRowHtml", "contextOptionsHtml", "contextRowHtml",
        "demoteProjectToFuture", "doComplete", "group", "itemHtml"]),
    ("The calendar", [
        "calendarHeaderHtml", "calendarBodyHtml", "calCreateRowHtml", "calDayAgendaHtml",
        "calListHtml", "calListRows", "calPastDueRows", "calAdd", "openCalendarScreen"]),
    ("Events and repeats", [
        "eventBodyHtml", "confirmDeleteEvent", "RECURRENCE_LABELS", "RECUR_LABEL",
        "deleteEventEntirely", "skipOccurrence", "pseudoDescriptor"]),
    ("Habits and the runner", [
        "habitWhenFieldsHtml", "habitHookPickerHtml", "habitScheduleHtml",
        "habitTrackHtml", "habitRunnerState", "BUBBLE_COPY", "SCENE_LABELS"]),
    ("Notes and tags", [
        "noteToolbarHtml", "noteProjectPickerHtml", "noteBodyHtml", "notesFilterBarHtml",
        "tagsPageBodyHtml"]),
    ("The time picker", ["openTimePicker", "initTimePickerFields"]),
    ("Settings, backup and dialogs", [
        "openConfirmDialog", "settingsRootHtml", "openSettings", "importAllData",
        "exportBackup"]),
]
AREA_OF = {}
for title, funcs in AREAS:
    for f in funcs:
        AREA_OF[f] = title


def clean(s):
    s = (s.replace("\\u2014", "—").replace("\\u2019", "’")
          .replace("\\u2026", "…").replace("\\u2192", "→")
          .replace("\\u2713", "✓").replace("\\u2715", "✕"))
    s = s.replace("\\'", "'").replace('\\"', '"')
    return s.strip()


def harvest(path):
    out = []
    cur = path.name
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        m = FUNC.match(line)
        if m:
            cur = m.group(1) or m.group(2)
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
            continue
        if cur in SKIP_FUNCS:
            continue
        found = []
        for kind, pat in PATTERNS:
            for mm in pat.finditer(line):
                found.append((kind, clean(mm.group(1))))
        for mm in TAG_TEXT.finditer(line):
            v = clean(mm.group(1))
            if " + " not in v and "escapeHtml" not in v:
                found.append(("label", v))
        for pat in (SENT, SENT2):
            for mm in pat.finditer(line):
                v = clean(mm.group(1))
                if "<" not in v and " " in v:
                    found.append(("text", v))
        for kind, v in found:
            if not v or any(s in v for s in SKIP_SUBSTR):
                continue
            if "' + " in v or '" + ' in v or v.startswith("' +"):
                continue                       # a template fragment, not a sentence
            if re.match(r"^[Mm][\d.\s\-]", v):
                continue                       # an SVG path
            if not re.search(r"[a-z]{3}", v):
                continue                       # no real word in it
            out.append((cur, kind, v, path.name, i))
    return out


rows = []
for name in FILES:
    p = SRC / name
    if p.exists():
        rows += harvest(p)

# de-dup on the string itself, keeping the first place it appears
seen, uniq = set(), []
for r in rows:
    if r[2] in seen:
        continue
    seen.add(r[2])
    uniq.append(r)

by_area = collections.OrderedDict((t, []) for t, _ in AREAS)
by_area["Everything else"] = []
for func, kind, v, fname, line in uniq:
    by_area.setdefault(AREA_OF.get(func, "Everything else"), []).append((kind, v, fname, line, func))

KIND_LABEL = {"label": "button/label", "placeholder": "placeholder", "tooltip": "tooltip",
              "aria": "screen-reader", "text": "text"}

L = []
L.append("OELA — ALL COPY AND BUTTON LABELS")
L.append("Generated " + datetime.date.today().isoformat() + " from src/. " + str(len(uniq)) + " strings.")
L.append("")
L.append("HOW TO USE THIS FILE")
L.append("  Read down it. When you want something changed, write the new wording on the")
L.append("  line underneath it, after the arrow. Leave the arrow line blank (or delete it)")
L.append("  for anything you are happy with. Don't worry about matching the exact spelling")
L.append("  of the old text — I find these by their tag, not by their content.")
L.append("")
L.append("  Example:")
L.append("      [A12] placeholder   Add to list…")
L.append("         → What needs doing?")
L.append("")
L.append("  Each entry's tag (like [A12]) is how I locate it in the code, so please leave")
L.append("  those alone. The (file:line) at the end is for me.")
L.append("")
L.append("WHAT THE KINDS MEAN")
L.append("  button/label   text on a button, a tab, or a heading — you see it as-is")
L.append("  placeholder    the grey hint inside an empty box, gone as soon as you type")
L.append("  tooltip        the label on hover, or long-press on a phone")
L.append("  text           full sentences: info panels, empty states, confirm dialogs")
L.append("  screen-reader  never shown; only read aloud by a screen reader")
L.append("")
L.append("  The habit thought-bubbles are under HABITS AND THE RUNNER. Those are the")
L.append("  ones that will need Chinese versions, so they are worth extra attention.")
L.append("")
L.append("  NOT IN THIS FILE, on purpose: the QA checklist, the chunk map, the dev")
L.append("  buttons, and the sample data. Those are scaffolding for building the app —")
L.append("  they get regenerated every round or stripped from the real build, so editing")
L.append("  them here would be wasted work.")
L.append("")
L.append("  A few strings may be filed under the wrong heading — the grouping is worked")
L.append("  out from the code's own structure, which does not always match how the app")
L.append("  looks. If something is in an odd place, it is still the right string.")
L.append("")
L.append("=" * 78)

counter = 0
for area, items in by_area.items():
    if not items:
        continue
    L.append("")
    L.append(area.upper())
    L.append("-" * 78)
    last_func = None
    for kind, v, fname, line, func in items:
        counter += 1
        tag = "[%03d]" % counter
        if func != last_func:
            L.append("")
            last_func = func
        L.append("  %s %-13s %s" % (tag, KIND_LABEL.get(kind, kind), v))
        L.append("     →")
        L.append("     (%s:%d)" % (fname, line))
    L.append("")

OUT.write_text("\n".join(L) + "\n", encoding="utf-8")
print("wrote", OUT, len(uniq), "strings")

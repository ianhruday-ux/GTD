// =========================================================
// i18n — the string table and the lookup (Chinese translation round).
//
// WHY IT LOOKS LIKE THIS. The app is one IIFE of vanilla JS with no build step
// beyond stapling (spec.md §3), so there is no framework locale system to lean
// on and nothing here may depend on module loading order at *runtime* — but a
// `const` IS in the temporal dead zone until its line is evaluated, so this file
// is stapled EARLY (build.py's JS_MODULES) and must stay there.
//
// The pattern is already in the app: runner.js has carried BUBBLE_COPY keyed
// `en` / `zh-Hans` since the habit runner was built. This generalises that
// exact shape rather than inventing a second one, which is also why the locale
// ids match its keys — `zh-Hans` (Simplified), not `zh` or `zh-CN`.
//
// HOW IT IS USED.  t("lane.next.title")  →  the string for the current locale.
// A missing key falls back to English and, in a dev build, says so loudly rather
// than rendering an empty box: a silently blank label is the failure mode that
// makes a half-translated app look broken instead of untranslated.
// =========================================================
const LOCALES = [
  { id: "en", label: "English", native: "English" },
  { id: "zh-Hans", label: "Chinese (Simplified)", native: "简体中文" }
];
const LOCALE_KEY = "gtd_locale"; // gtd_: a preference, so "Restore to defaults" resets it, like the desk

function loadLocale(){
  const id = Storage.get(LOCALE_KEY);
  return LOCALES.some(function(l){ return l.id === id; }) ? id : "en";
}
function currentLocale(){ return state.locale || (state.locale = loadLocale()); }
function localeLabel(id){
  const l = LOCALES.find(function(x){ return x.id === id; });
  return l ? l.native : id;
}

// The table. Keyed by dotted path, then by locale — deliberately this way round
// rather than locale-then-key, so a string and its translation sit on adjacent
// lines and a missing translation is visible while reading rather than only by
// diffing two large objects.
//
// ⚑ The English side is the app's REAL copy, moved here verbatim — including the
// user's own authored info-button text (INFO-TEXT.txt). Changing wording means
// changing it here now; that file stays the record of what was reviewed.
const STRINGS = {
  // ---- lane names (the tab bar and every lane header) ----
  "lane.next.title":    { en: "Next Actions",     "zh-Hans": "下一步行动" },
  "lane.waiting.title": { en: "Waiting On",       "zh-Hans": "等待中" },
  "lane.current.title": { en: "Current Projects", "zh-Hans": "当前项目" },
  "lane.future.title":  { en: "Someday",          "zh-Hans": "将来某天" },
  "lane.habit.title":   { en: "Habits",           "zh-Hans": "习惯" },
  "lane.notes.title":   { en: "Notes",            "zh-Hans": "笔记" },

  // ---- the tab bar's short names (the strip along the bottom) ----
  "tab.next":    { en: "Next",     "zh-Hans": "下一步" },
  "tab.waiting": { en: "Waiting",  "zh-Hans": "等待" },
  "tab.current": { en: "Projects", "zh-Hans": "项目" },
  "tab.future":  { en: "Someday",  "zh-Hans": "将来" },
  "tab.habit":   { en: "Habits",   "zh-Hans": "习惯" },
  "tab.notes":   { en: "Notes",    "zh-Hans": "笔记" },

  // ---- the kind badge at the top of a drafting page ----
  "badge.next":     { en: "Next Action",    "zh-Hans": "下一步行动" },
  "badge.waiting":  { en: "Waiting On",     "zh-Hans": "等待中" },
  "badge.current":  { en: "Project",        "zh-Hans": "项目" },
  "badge.future":   { en: "Future Project", "zh-Hans": "将来项目" },
  "badge.habit":    { en: "Habit",          "zh-Hans": "习惯" },
  "badge.notes":    { en: "Note",           "zh-Hans": "笔记" },
  "badge.tags":     { en: "Tags",           "zh-Hans": "标签" },
  "badge.review":   { en: "Review",         "zh-Hans": "回顾" },
  "badge.event":    { en: "Event",          "zh-Hans": "事件" },
  "badge.appointment": { en: "Appointment", "zh-Hans": "约会" },
  "badge.calendar": { en: "Calendar",       "zh-Hans": "日历" },

  // ---- the floating + menu ----
  "fab.newAction":    { en: "New action",         "zh-Hans": "新建行动" },
  "fab.newContext":   { en: "New context",        "zh-Hans": "新建情境" },
  "fab.newProject":   { en: "New project",        "zh-Hans": "新建项目" },
  "fab.newList":      { en: "New list",           "zh-Hans": "新建清单" },
  "fab.newNote":      { en: "New note",           "zh-Hans": "新建笔记" },
  "fab.newChecklist": { en: "New checklist",      "zh-Hans": "新建清单笔记" },
  "fab.tags":         { en: "Tags",               "zh-Hans": "标签" },

  // ---- title placeholders on the drafting pages ----
  // ⚠ The English is the app's REAL placeholder text (unchanged). Translating is
  // not licence to reword the source — that is the writing pass, which is done.
  "placeholder.title.next":    { en: "Next action…",           "zh-Hans": "下一步行动…" },
  "placeholder.title.waiting": { en: "What are you waiting on…", "zh-Hans": "你在等待什么…" },
  "placeholder.title.current": { en: "Project title…",         "zh-Hans": "项目标题…" },
  "placeholder.title.future":  { en: "Project title…",         "zh-Hans": "项目标题…" },
  "placeholder.title.habit":   { en: "Habit title…",           "zh-Hans": "习惯标题…" },
  "placeholder.title.notes":   { en: "Note title…",            "zh-Hans": "笔记标题…" },
  "placeholder.desc":          { en: "Description (optional)…", "zh-Hans": "描述（可选）…" },

  // ---- the lane info buttons: THE USER'S OWN COPY (INFO-TEXT.txt) ----
  // ⚠ The English here is authored prose, transcribed verbatim. It is not to be
  // reworded in passing; INFO-TEXT.txt is the record of what was reviewed.
  "info.lane.next": {
    en: "This lane is for “next actions” and “contexts.” A next action is the single next physical step you need to move something forward. It is not a whole project, only the next action you can take in a project.",
    "zh-Hans": "这个列表用于存放「下一步行动」和「情境」。下一步行动是推进某件事所需的下一个具体动作。它不是整个项目，而只是你在这个项目中可以采取的下一个行动。"
  },
  "info.lane.waiting": {
    en: "A waiting action is something you can't act on yet because it depends on something else—a reply from someone, a delivery, a decision, another action getting done, or a future event. Use the left arrow to promote a waiting action to the next action list, or hook it to a next action so it will promote automatically. Actions in a context will promote to their sibling context in the next action list.",
    "zh-Hans": "等待项是你暂时无法着手的事，因为它取决于别的事情——某人的回复、一次送达、一个决定、另一个行动的完成，或是将来的某个事件。用左箭头把等待项提升到下一步行动列表，或者把它挂到某个下一步行动上，这样它就会自动提升。属于某个情境的行动，会提升到下一步行动列表中对应的同名情境里。"
  },
  "info.lane.current": {
    en: "A project is anything that takes more than one action to complete. It could be as simple as returning a library book or as involved as planning a vacation. Current projects should always have at least one step tied to them to prevent them from being stalled. This step might be an action, a waiting action, or even an event on the calendar.",
    "zh-Hans": "项目是指任何需要一个以上行动才能完成的事。它可以简单到还一本图书馆的书，也可以复杂到筹划一次假期。当前项目应始终至少挂着一个步骤，以免陷入停滞。这个步骤可以是一个行动、一个等待项，甚至是日历上的一个事件。"
  },
  "info.lane.future": {
    en: "This lane is for projects you're not committed to starting yet. Review this list at least once a month to keep the dreams alive.",
    "zh-Hans": "这个列表用于存放你还没决定要开始的项目。至少每月回顾一次，让这些想法保持鲜活。"
  },
  "info.lane.habit": {
    en: "A habit is an automatic behaviour which is triggered by a cue. It's easiest to build habits when you're doing them at least once a week. Type in a cue when you're creating a habit or use the habit hook to create habit stacks in which one habit is the cue for the next habit in the stack.",
    "zh-Hans": "习惯是一种由提示触发的自动行为。每周至少做一次的习惯最容易养成。创建习惯时输入一个提示，或者使用习惯挂钩来搭建习惯链——链条中的每个习惯都是下一个习惯的提示。"
  },
  "info.lane.notes": {
    en: "This lane is for notes. It's useful for keeping track of ideas, links, email addresses, and assorted reference materials related to current and future projects.",
    "zh-Hans": "这个列表用于存放笔记。它适合记录与当前项目和将来项目有关的想法、链接、电子邮件地址，以及各种参考资料。"
  },
  // The →→ paragraphs: lane-only, deliberately withheld from the review's ⓘ.
  "info.lane.next.more": {
    en: "A “context” is a recurring place or time which offers you the opportunity to take an action. Here, we have created contextual lists, so you can group all your “at computer” and “getting off work” actions together.",
    "zh-Hans": "「情境」是指反复出现的地点或时间，它给了你采取行动的机会。这里我们建立了情境清单，让你可以把所有「在电脑前」和「下班时」的行动归拢到一起。"
  },
  "info.lane.habit.more": {
    en: "Some apps track streaks, but everyone misses a habit occasionally. We don't track streaks here, but we do track personal bests. If you break your streak, then maybe you'll have a new personal best to beat. After all: ‘It's more important to be persistent than it is to be consistent.’ – Rebecca",
    "zh-Hans": "有些应用会记录连续天数，但每个人都难免有中断的时候。这里我们不记录连续天数，而是记录个人最佳。就算中断了，你也不过是多了一个要超越的个人最佳而已。毕竟：「坚持比不间断更重要。」——Rebecca"
  },

  // ---- the intray ----
  "info.tray": {
    en: "The intray is a tray that holds everything that needs dealing with. Stalled projects, overdue deadlines, and waiting actions which have lost their waiting condition, all belong here. You can use the text box to quickly add thoughts or reminders if you don't have time to add them to the proper list. You can sort through and process everything using the tray's review feature.",
    "zh-Hans": "收件箱是一个存放所有待处理事项的地方。停滞的项目、过期的截止日期，以及失去了等待条件的等待项，都归到这里。如果你来不及把想法或提醒放进合适的列表，可以用输入框先快速记下来。之后用收件箱的回顾功能，把所有东西逐一整理和处理掉。"
  },
  "tray.empty":   { en: "Empty for now — nothing slipping through the cracks.", "zh-Hans": "暂时是空的——没有任何事情被遗漏。" },
  "tray.review":  { en: "Review",  "zh-Hans": "回顾" },
  "tray.reveal":  { en: "Reveal",  "zh-Hans": "显示" },
  "tray.hide":    { en: "Hide",    "zh-Hans": "隐藏" },
  "tray.discard": { en: "Discard", "zh-Hans": "丢弃" },

  // ---- the daily review's decision menus ----
  "info.review.pastdue": {
    en: "This was due and the moment has passed. Push it to a new date, tick it if it's actually done, delete it if it's dead — or Not now to see it again next time.",
    "zh-Hans": "这件事已经到期，而时间已经过去了。把它推到新的日期，如果确实做完了就打勾，如果已经作废就删除——或者选「暂不处理」，下次再看到它。"
  },
  "info.review.stalled": {
    en: "This is a project with no way forward. Add the next physical step, a waiting action, or an event to keep it going, or move it to Someday if continuing the project isn't possible or practical. You can always come back to it in the future.",
    "zh-Hans": "这是一个没有推进方式的项目。加上下一个具体步骤、一个等待项或一个事件，让它继续走下去；如果继续这个项目已不可行或不实际，就把它移到「将来某天」。你随时可以在将来回过头来处理它。"
  },
  "info.review.orphaned": {
    en: "This was waiting on something that no longer exists. Point it at something else, replace it with a note to yourself, promote it if you can act now, or close it out.",
    "zh-Hans": "这件事在等待一个已经不存在的东西。把它指向别的东西、改成一句写给自己的说明、如果现在就能动手就把它提升，或者干脆结束它。"
  },
  "info.review.missed": {
    en: "A repeating thing whose day went by without being ticked. Often you did it and forgot to say so — 'I did it' records it on the day it happened. 'Let it go' clears it without pretending you did. Only the most recent one is ever kept, so this never piles up.",
    "zh-Hans": "一件重复的事，它的那一天过去了却没有打勾。很多时候你其实做了，只是忘了记下来——「我做了」会把它记在实际发生的那一天。「算了吧」则会清掉它，而不假装你做过。这里只保留最近的一次，所以永远不会越积越多。"
  },
  "info.review.capture": {
    en: "A stray thought you haven't filed yet. Send it to a lane — or Not now to leave it for later.",
    "zh-Hans": "一个你还没归类的零散想法。把它送进某个列表——或者选「暂不处理」，留到以后。"
  },
  "review.heading.sorting":  { en: "Sorting a new thought",        "zh-Hans": "整理一个新想法" },
  "review.heading.deciding": { en: "When something needs a decision", "zh-Hans": "当某件事需要做决定时" },
  "review.notNow":           { en: "Not now",                      "zh-Hans": "暂不处理" },

  // ---- the settings menu ----
  "settings.background": { en: "Background", "zh-Hans": "背景" },
  "settings.language":   { en: "Language",   "zh-Hans": "语言" },
  "settings.debugging":  { en: "Debugging",  "zh-Hans": "调试" },
  "settings.build":      { en: "Build",      "zh-Hans": "版本" },

  // ---- chrome shared by every drafting page ----
  "chrome.saveBack": { en: "Save and go back", "zh-Hans": "保存并返回" },
  "chrome.back":     { en: "Back",             "zh-Hans": "返回" },
  "chrome.cancel":   { en: "Cancel",           "zh-Hans": "取消" },
  "chrome.delete":   { en: "Delete",           "zh-Hans": "删除" },
  "chrome.info":     { en: "Information",      "zh-Hans": "说明" },

  // ---- desktop round: the card footer, the discard gate, the tray handle ----
  // "Done" is the desktop footer's filled button. It is the SAME action as the
  // phone's ← (screen-save): save and close. The word changes, the contract
  // does not.
  "chrome.done":     { en: "Done",             "zh-Hans": "完成" },
  "chrome.doneTitle":{ en: "Save and close",   "zh-Hans": "保存并关闭" },
  // The discard gate (desktop ruling 5, applied on both layouts): ✕/Escape asks
  // only when the draft actually differs from what is saved. Register matched to
  // the project page's existing warning — "Discard changes" / "Keep editing".
  "discard.message": {
    en: "Discard your changes? Nothing on this page has been saved yet.",
    "zh-Hans": "放弃你的更改？此页面上的内容尚未保存。"
  },
  "discard.yes":     { en: "Discard changes",  "zh-Hans": "放弃更改" },
  "discard.no":      { en: "Keep editing",     "zh-Hans": "继续编辑" },
  "tray.handle":     { en: "Intray",           "zh-Hans": "收集箱" },
  "tray.handleOpen": { en: "Open the intray",  "zh-Hans": "打开收集箱" },
  "tray.handleClose":{ en: "Close the intray", "zh-Hans": "关闭收集箱" },
  // ⚑ Was NEW_ITEM_LABEL.habit, an English-only const outside this table (trap
  // T12). It becomes visible button text on the desktop Habits column, so it
  // moves in here properly. Habits has no multi-option menu — one button.
  "fab.newHabit":    { en: "New habit",        "zh-Hans": "新建习惯" },

  // ---- the in-lane tutorial (seedTutorial in app.js) ----
  // Each seeded tutorial card carries a `tutorialKey`; restampTutorialCards()
  // re-reads these on a language change. Titles say what to DO; notes describe
  // the interface. ⚠ The card IDs and their cross-references (the ② → ① hook, the
  // ② → ④ project link) are NOT touched by a language switch — only this text is —
  // which is why the dependency wiring survives translation.
  "tutorial.t1.title": {
    en: "① Create your first next action",
    "zh-Hans": "① 创建你的第一个下一步行动"
  },
  "tutorial.t1.notes": {
    en: "Tap the round + at the bottom right and choose “New action”. A next action is the one physical thing you'd do next — not the whole project. When you've made one, tick this card's circle to complete it: that's how you clear each tutorial step.",
    "zh-Hans": "点右下角的圆形 + 按钮，选择「新建行动」。下一步行动是你接下来会做的那一个具体动作——不是整个项目。做好之后，点这张卡片的圆圈把它标记为完成：教程的每一步都是这样清除的。"
  },
  "tutorial.t2.title": {
    en: "② Add a waiting action and hook it to a next action",
    "zh-Hans": "② 添加一个等待项，并把它挂到下一步行动上"
  },
  "tutorial.t2.notes": {
    en: "This card IS a waiting action — it's hooked to step ① and linked to the project in step ④. Complete ① and watch this jump up into Next Actions on its own. To make your own: on the Waiting tab, + → “New action”, then tap the 🪝 to choose what it's waiting on.",
    "zh-Hans": "这张卡片本身就是一个等待项——它挂在第①步上，并链接到第④步的项目。完成第①步，看它自己跳进「下一步行动」列表。要创建你自己的：在「等待」标签页，+ →「新建行动」，然后点 🪝 选择它在等待什么。"
  },
  "tutorial.t3.title": {
    en: "③ Make a context",
    "zh-Hans": "③ 创建一个情境"
  },
  "tutorial.t3.notes": {
    en: "A context groups actions by where or how you'll do them — “at computer”, “errands”. On an action tab, tap + → “New context”, name it, then file actions under it. Tick this card once you've made one.",
    "zh-Hans": "情境按你做事的地点或方式给行动分组——「在电脑前」「外出办事」。在某个行动标签页，点 + →「新建情境」，起个名字，然后把行动归到它下面。创建好后点这张卡片。"
  },
  "tutorial.t4.title": {
    en: "④ Start a project",
    "zh-Hans": "④ 开始一个项目"
  },
  "tutorial.t4.notes": {
    en: "A project is anything that takes more than one action. On the Projects tab, tap + → “New project”. Every project needs at least one next step, so add an action or link an existing one. (This card already has step ②'s waiting action linked to it.)",
    "zh-Hans": "项目是指任何需要一个以上行动才能完成的事。在「项目」标签页，点 + →「新建项目」。每个项目都需要至少一个下一步，所以加一个行动或链接一个已有的。（这张卡片已经把第②步的等待项链接进来了。）"
  },
  "tutorial.t5.title": {
    en: "⑤ Fix a stalled project in Review",
    "zh-Hans": "⑤ 在回顾中修复一个停滞的项目"
  },
  "tutorial.t5.notes": {
    en: "Open the 📥 intray, then 🔍 Review. The sample project with no next step (below in Projects) will come up — give it a way forward by adding a next action right there in the review. Tick this card once you have.",
    "zh-Hans": "打开 📥 收件箱，再点 🔍 回顾。那个没有下一步的示例项目（在下面的「项目」里）会出现——就在回顾里给它加一个下一步行动，让它继续走下去。做完后点这张卡片。"
  },
  "tutorial.t6.title": {
    en: "⑥ Build a habit",
    "zh-Hans": "⑥ 养成一个习惯"
  },
  "tutorial.t6.notes": {
    en: "A habit is a routine triggered by a cue. On the Habits tab, tap + and give it a cue like “after I pour my coffee”. Check it off each day; the little runner on the card keeps your streak. This card can't be completed (habits reset daily instead) — delete it with the 🗑 on its page once you've made your own.",
    "zh-Hans": "习惯是由提示触发的例行行为。在「习惯」标签页，点 + 并给它一个提示，比如「倒完咖啡之后」。每天把它勾掉；卡片上的小人会记录你的连续天数。这张卡片无法被「完成」（习惯每天会重置）——创建好你自己的之后，在它的页面上用 🗑 删除它。"
  },
  "tutorial.tp.title": {
    en: "◇ A sample project with no next step",
    "zh-Hans": "◇ 一个没有下一步的示例项目"
  },
  "tutorial.tp.notes": {
    en: "Leave this one be — it's the stalled project for step ⑤. It has no next action, so it shows a ⚠ and turns up in Review. When you're done exploring, delete it with the 🗑 on its page.",
    "zh-Hans": "先别动它——它是留给第⑤步的停滞项目。它没有下一步行动，所以显示 ⚠ 并出现在回顾里。等你探索完，在它的页面上用 🗑 删除它。"
  }
};

// ⚑ Dev aid, deliberately loud. A missing key used to be the silent failure that
// makes a partly-translated app look BROKEN rather than merely incomplete: the
// label renders empty and nobody can tell whether the string is missing or the
// feature is. This returns the key itself, which is ugly on purpose and instantly
// greppable.
function t(key){
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[currentLocale()] || entry.en || key;
}
// Same lookup for a specific locale — used by the language picker, which has to
// show each language in its OWN language rather than in the current one.
function tIn(key, locale){
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[locale] || entry.en || key;
}
function setLocale(id){
  if (!LOCALES.some(function(l){ return l.id === id; })) return;
  state.locale = id;
  Storage.set(LOCALE_KEY, id);
  document.documentElement.setAttribute("lang", id);
  applyLocale();
}
// Everything that has to be redrawn when the language changes. The lane names,
// the info blocks, the FAB menu, the badges and the placeholders are all baked
// into markup at RENDER time from the tables rebuilt above — so re-rendering is
// the whole update; there is no live-binding to keep in sync.
//
// ⚠ The names called here (renderShell, renderTabLabels, renderLane, ALL_LANES,
// updateLaneVisibility, renderScreen, renderTray) are all function/var
// declarations in the shared IIFE scope and hoisted, so calling them from this
// early-stapled file is safe AT CALL TIME — this only ever runs from a click,
// long after boot(). The typeof guards are belt-and-braces for the very first
// language read during boot, before those are defined.
function applyLocale(){
  if (typeof rebuildStringTables === "function") rebuildStringTables();
  // Tutorial cards carry their own translatable text (seedTutorial) — re-stamp
  // it BEFORE the lanes re-render below, or they'd repaint in the old language.
  if (typeof restampTutorialCards === "function") restampTutorialCards();
  if (typeof renderShell === "function") renderShell();
  if (typeof renderTabLabels === "function") renderTabLabels();
  // Desktop round: the header's Language/Background dropdowns carry their own
  // labels in their own language, and setLocale knows nothing about them
  // otherwise (trap T12).
  if (typeof renderHeaderWidgets === "function") renderHeaderWidgets();
  if (typeof renderLane === "function" && typeof ALL_LANES !== "undefined"){
    ALL_LANES.forEach(renderLane);
  }
  if (typeof updateLaneVisibility === "function") updateLaneVisibility();
  if (state.screen && typeof renderScreen === "function") renderScreen();
  if (state.trayOpen && typeof renderTray === "function") renderTray(true);
}

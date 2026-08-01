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
    "zh-Hans": "这个列表用于存放“下一步行动”和“情境”。“下一步行动”是推进一件事情所需要采取的下一个具体行动。它不是整个项目，而只是这个项目当前可以执行的下一步。"
  },
  "info.lane.waiting": {
    en: "A waiting action is something you can't act on yet because it depends on something else—a reply from someone, a delivery, a decision, another action getting done, or a future event. Use the left arrow to promote a waiting action to the next action list, or hook it to a next action so it will promote automatically. Actions in a context will promote to their sibling context in the next action list.",
    "zh-Hans": "“等待行动”是指暂时还不能开始，因为它需要等待其他事情完成，例如等待他人回复、等待快递送达、等待决定、等待另一项行动完成，或等待将来的某个事件。你可以点击左箭头，把等待行动移到“下一步行动”列表；也可以把它关联到一项“下一步行动”，这样条件满足后，它就会自动移过去。属于某个情境的等待行动，也会自动移到“下一步行动”列表中对应的情境。"
  },
  "info.lane.current": {
    en: "A project is anything that takes more than one action to complete. It could be as simple as returning a library book or as involved as planning a vacation. Current projects should always have at least one step tied to them to prevent them from being stalled. This step might be an action, a waiting action, or even an event on the calendar.",
    "zh-Hans": "凡是需要一个以上行动步骤才能完成的事情，都属于项目。它可以简单到归还一本图书馆的书，也可以复杂到规划一次假期。当前项目应始终至少关联一个步骤，以免陷入停滞。这个步骤可以是一项行动、一项等待行动，甚至是一个日历事件。"
  },
  "info.lane.future": {
    en: "This lane is for projects you're not committed to starting yet. Review this list at least once a month to keep the dreams alive.",
    "zh-Hans": "这个列表用于存放那些你还不打算开始，但又不想放弃的项目。至少每月回顾一次，让这些想法保持鲜活。"
  },
  "info.lane.habit": {
    en: "A habit is an automatic behaviour which is triggered by a cue. It's easiest to build habits when you're doing them at least once a week. Type in a cue when you're creating a habit or use the habit hook to create habit stacks in which one habit is the cue for the next habit in the stack.",
    "zh-Hans": "习惯是由提示（cue）触发的自动行为。如果一项行为每周至少会发生一次，通常最容易养成习惯。创建习惯时，请填写一个提示（cue）；也可以使用习惯挂钩，把多个习惯串联起来，让前一个习惯成为后一个习惯的提示（cue）。"
  },
  "info.lane.notes": {
    en: "This lane is for notes. It's useful for keeping track of ideas, links, email addresses, and assorted reference materials related to current and future projects.",
    "zh-Hans": "这个列表用于存放笔记。你可以在这里记录与当前项目和将来项目有关的想法、链接、电子邮件地址，以及各种参考资料。"
  },
  // The →→ paragraphs: lane-only, deliberately withheld from the review's ⓘ.
  "info.lane.next.more": {
    en: "A “context” is a recurring place or time which offers you the opportunity to take an action. Here, we have created contextual lists, so you can group all your “at computer” and “getting off work” actions together.",
    "zh-Hans": "“情境”是指反复出现、适合执行某项行动的地点或时机。在这里，你可以创建情境清单，把所有“在电脑前”或“下班后”才能完成的行动整理到一起。"
  },
  "info.lane.habit.more": {
    en: "Some apps track streaks, but everyone misses a habit occasionally. We don't track streaks here, but we do track personal bests. If you break your streak, then maybe you'll have a new personal best to beat. After all: ‘It's more important to be persistent than it is to be consistent.’ – Rebecca",
    "zh-Hans": "有些应用会记录连续完成天数，但每个人偶尔都会中断。这里不记录连续天数，而是记录你的个人最佳。就算连续记录中断了，你也只是多了一个新的个人最佳可以挑战。毕竟：“坚持下去，比从不中断更重要。”——Rebecca"
  },

  // ---- the intray ----
  // ⚑ The author's own copy, transcribed verbatim (2026-07-28). Split on the
  // established `.more` convention: the first sentence is what the REVIEW's
  // capture card shows beside its Calendar button; the rest is withheld until
  // you open the calendar's own ⓘ — exactly how info.lane.next(.more) works.
  //
  // ⚠ Every specific claim in `.more` was verified against the code before it
  // shipped: the month grid skips ticklers (events.js, calMonthGridHtml), the
  // day agenda and the list view both show them (and tag them "hidden"), and
  // nothing in the pseudo-action path filters them, so a hidden event does
  // still reach Next Actions on its day.
  "info.calendar": {
    en: "The calendar can be used to schedule appointments and deadlines.",
    "zh-Hans": "日历可以用来安排约会和截止日期。"
  },
  "info.calendar.more": {
    en: "It's also a powerful tool that allows you to see your schedule at a glance. When creating an event you don't need to see, select the \"hide\" checkbox to prevent it from showing up in month view. This will help you declutter your calendar, keeping it readable. You'll still be able to see it on the day and list views, and it will still appear in your action list the day of the event.",
    "zh-Hans": "它也是一个强大的工具，让你一眼就能看到自己的日程安排。创建一个你不需要看到的事件时，可以勾选“隐藏”复选框，让它不出现在月视图中。这有助于让日历保持整洁、易读。你仍然可以在日视图和列表视图中看到它，并且在事件当天，它依然会出现在你的行动清单中。"
  },
  "info.tray": {
    en: "The intray is a tray that holds everything that needs dealing with. Stalled projects, overdue deadlines, and waiting actions which have lost their waiting condition, all belong here. You can use the text box to quickly add thoughts or reminders if you don't have time to add them to the proper list. You can sort through and process everything using the tray's review feature.",
    "zh-Hans": "收件箱用于集中存放所有需要处理的事项。停滞的项目、已过截止日期的事项，以及失去等待条件的等待行动，都会出现在这里。如果一时来不及把想法或提醒整理到合适的列表，可以先用输入框快速记下来。之后再通过收件箱的“回顾”功能，逐项整理并处理。"
  },
  "tray.empty":   { en: "Empty for now — nothing slipping through the cracks.", "zh-Hans": "暂时是空的——没有任何事情被遗漏。" },
  "tray.review":  { en: "Review",  "zh-Hans": "回顾" },
  "tray.reveal":  { en: "Reveal",  "zh-Hans": "显示" },
  "tray.hide":    { en: "Hide",    "zh-Hans": "隐藏" },
  "tray.discard": { en: "Discard", "zh-Hans": "丢弃" },

  // ---- the daily review's decision menus ----
  "info.review.pastdue": {
    en: "This was due and the moment has passed. Push it to a new date, tick it if it's actually done, delete it if it's dead — or Not now to see it again next time.",
    "zh-Hans": "这件事的截止时间已经过去了。可以把它改到新的日期；如果实际上已经完成，就勾选完成；如果已经不用做了，就删除；或者选择“暂不处理”，下次回顾时再处理。"
  },
  // ⚑ Distinct from info.review.pastdue (review-surface-plan.md §3, Q3
  // revisited): the pseudo-action shape can't push a date, and can now also
  // be skipped (a live, not-yet-rolled-past recurring occurrence) — the
  // shared deadline wording stopped being accurate once Skip was added here.
  "info.review.pastdueEvent": {
    en: "This event's time has passed without being ticked. Tick it if you actually did it, skip it if you didn't (a repeating event moves on to its next occurrence), or delete it to remove the event for good — or Not now to see it again next time.",
    "zh-Hans": "这个事件的时间已经过去，但还没有勾选完成。如果确实做了就勾选完成；如果没做就跳过（如果是重复事件，会自动进入下一次）；要彻底删除这个事件就选删除——或者选择“暂不处理”，下次再看到它。"
  },
  // ⚑ ADDED clause (author, sixth QA round): distinguishes this +Next/
  // +Waiting/+Event from capture's — this one is linked to the project,
  // not a stray new item on its own.
  "info.review.stalled": {
    en: "This is a project with no way forward. Add the next physical step, a waiting action, or an event — linked to this project rather than standing on its own — to keep it going, or move it to Someday if continuing the project isn't possible or practical. You can always come back to it in the future.",
    "zh-Hans": "这个项目目前没有任何推进方式。请添加下一步行动、一项等待行动或一个日历事件——它们都会关联到这个项目，而不是单独存在的条目——让项目继续推进；如果暂时不适合继续，也可以把它移到“将来”列表。以后随时都可以再回来处理。"
  },
  // ⚑ REWRITTEN (author, sixth QA round): the old text never mentioned
  // Completed or Delete at all ("close it out" tried to cover both) and
  // called the convert option "promote" when the button now reads "Make
  // Next Action" — clarified as the SAME item, not a new one, which is the
  // whole point of contrast with stalled's +Next (a fresh, linked item)
  // and capture's Next (a fresh, unlinked item).
  "info.review.orphaned": {
    en: "This was waiting on something that no longer exists. Point it at something else, replace it with a note to yourself, or make it a next action if you can act on it now — the same item, not a new one. Mark it done if it's already handled, or delete it if it's dead — or Not now to see it again next time.",
    "zh-Hans": "这项等待行动原本依赖的条件已经不存在了。你可以把它指向别的东西、改成一条写给自己的笔记，或者如果现在就能做，就把它转为下一步行动——还是同一个条目，不会新建一个。如果已经处理好了就勾选完成，如果已经没用了就删除——或者选择“暂不处理”，下次再看到它。"
  },
  "info.review.missed": {
    en: "A repeating thing whose day went by without being ticked. Often you did it and forgot to say so — 'Completed' records it on the day it happened. 'Skipped' clears it without pretending you did. Delete removes the whole repeating series, not just this occurrence. Only the most recent miss is ever kept, so this never piles up.",
    "zh-Hans": "这是一项重复事项，它的执行日期已经过去，但还没有勾选完成。很多时候其实已经做了，只是忘了记录。“已完成”会把完成记录补到实际发生的那一天；“已跳过”则会直接清除这次记录，而不会假装已经完成。“删除”会删除整个重复系列，而不只是这一次。系统始终只保留最近的一次，因此不会越积越多。"
  },
  // ⚑ Now actually rendered (author, sixth QA round) — previously written
  // but never wired into reviewInfoPanelHtml's capture branch. Shortened
  // to just the mechanic (the six lane bullets below already say what each
  // lane is for, and the card's own Not now button doesn't need re-
  // explaining here): tapping a lane FILES this thought as a brand-new
  // item — the contrast this round is drawing out is with stalled's
  // +Next/+Waiting/+Event (also new, but linked to the project) and
  // orphaned's "Make Next Action" (no new item at all).
  "info.review.capture": {
    en: "Tap a lane to turn this thought into a new item there.",
    "zh-Hans": "点击任意一个列表，就会把这个想法变成那里的一个新条目。"
  },
  "review.heading.sorting":  { en: "Sorting a new thought",        "zh-Hans": "整理一个新想法" },
  "review.heading.deciding": { en: "When something needs a decision", "zh-Hans": "当某件事需要做决定时" },
  "review.notNow":           { en: "Not now",                      "zh-Hans": "暂不处理" },

  // ---- the settings menu ----
  "settings.exportBackup": { en: "Export a backup", "zh-Hans": "导出备份" },
  "settings.importBackup": { en: "Import a backup", "zh-Hans": "导入备份" },
  "settings.background": { en: "Background", "zh-Hans": "背景" },
  "settings.language":   { en: "Language",   "zh-Hans": "语言" },
  "settings.debugging":  { en: "Debugging",  "zh-Hans": "调试" },
  "settings.build":      { en: "Build",      "zh-Hans": "版本" },

  // ---- chrome shared by every drafting page ----
  // The line along the bottom of the app. It was the last user-facing string in
  // the whole product still hard-coded in English — it lives in index.html's
  // markup rather than in a JS string, which is exactly why the i18n sweep and
  // checks/i18n_no_hardcoded.py (which reads JS) both walked past it. A reader
  // of 简体中文 got one English sentence, in the web build, which is the build
  // the testers are given. (In a wrapper the line is removed outright instead —
  // see applyFooterNote: an installed app has no browser to name.)
  "chrome.footerNote": { en: "Data lives in this browser's local storage.",
                         "zh-Hans": "数据保存在此浏览器的本地存储中。" },
  "chrome.saveBack": { en: "Save and go back", "zh-Hans": "保存并返回" },
  "chrome.back":     { en: "Back",             "zh-Hans": "返回" },
  "chrome.cancel":   { en: "Cancel",           "zh-Hans": "取消" },
  "chrome.close":    { en: "Close",            "zh-Hans": "关闭" },
  "chrome.delete":   { en: "Delete",           "zh-Hans": "删除" },
  "chrome.info":     { en: "Information",      "zh-Hans": "说明" },
  "chrome.add":      { en: "Add",               "zh-Hans": "添加" },

  // ---- desktop round: the card footer, the discard gate, the tray handle ----
  // "Done" is the desktop footer's filled button. It is the SAME action as the
  // phone's ← (screen-save): save and close. The word changes, the contract
  // does not.
  "chrome.done":     { en: "Done",             "zh-Hans": "保存" },
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
  // the interface. ⚠ The card IDs and their cross-references (the ①→…→⑧ chain,
  // every step's link to `tr`) are NOT touched by a language switch — only this
  // text is — which is why the dependency wiring survives translation.
  //
  // ⭐ REPLACED (user, oela_app_tutorial_en_zh.txt) — the author's own reviewed
  // script, transcribed verbatim like INFO-TEXT.txt: 8 steps now, not 6, and
  // EVERY step links to `tr` (not just step ②) — the script's own framing for
  // that project is "each of its linked actions is a different stage in the
  // tutorial." tr/tp keep the plain titles from the script (no ◆/◇ marker —
  // those glyphs were this app's invention, not in the reviewed text).
  // ⚑ Flagged: the script never tells step ⑧ to delete itself the way the old
  // t6 did ("habits reset daily, delete this card") — that was a deliberate
  // ruling on the OLD copy, teaching the habit lesson by never letting this
  // card self-complete. The new script is silent on it, so ⑧ is now a normal
  // chain link like ①–⑦ (ticks to complete, same as the rest). Simplest
  // reading of the new copy, which doesn't ask for the exception; flagging in
  // case the old ruling was meant to survive the rewrite.
  "tutorial.t1.title": {
    en: "1 CLICK HERE TO START THE TUTORIAL",
    "zh-Hans": "1 点击这里开始教程"
  },
  "tutorial.t1.notes": {
    en: "This is a tutorial on the use of OELA, or the Over Engineered List App. This app is intended to help you organize and plan your life. It is partially inspired by the popular system in the book \"Getting Things Done,\" though I have made my own additions to that organizational system as well.\nYou are currently on a drafting page for a next action. These drafting pages allow you to create list items which show up in the various specialized lists in the app. The X in the top right corner exits this page without saving any changes you may have made. If you are on a phone, the exit and save button is the arrow in the top left corner. If you are on a computer, you can click the \"done\" button. To complete this part of the tutorial, hit the complete button then click the done button or tap the arrow. The next card will show up in the list.",
    "zh-Hans": "这是 OELA（Over Engineered List App，过度设计清单应用）的使用教程。本应用旨在帮助你整理事务、规划生活。它的设计部分参考了《搞定》（Getting Things Done）中的经典方法，同时也加入了我自己的一些改进。\n你现在看到的是“下一步行动”的编辑页面。在这里，你可以创建会显示在应用各个列表中的条目。点击右上角的 X 会退出当前页面，并且不会保存任何修改。如果你使用的是手机，保存并退出请点击左上角的箭头；如果使用的是电脑，请点击“保存”按钮。要完成这一部分教程，请先点击“完成”按钮，再点击“保存”按钮或左上角箭头。完成后，下一张教程卡片会出现在列表中。"
  },
  "tutorial.t2.title": {
    en: "2 Tutorial: The interface",
    "zh-Hans": "2 教程：界面介绍"
  },
  "tutorial.t2.notes": {
    en: "You may have noticed those colourful tabs at the top of the page on the main screen. These are the lanes or specialized lists. You can navigate to them by clicking or tapping them. The red list is for next actions. The yellow list is for waiting actions. The green and blue lists are for current and future projects. The purple and teal lists are for habits and notes. There is also a calendar which can be accessed either on the bar at the top of the screen, or through the yellow list.\nEach list has a specialized function and behaves slightly differently. You can see information about the list's purpose and function by pressing the small (i) icon next to the list's header. Try looking around at the different lanes. Exit this drafting page and take a look at the different lists available. When you're done, return to the red list and check the box on this action. The next tutorial card will appear in this list.",
    "zh-Hans": "你可能已经注意到主界面顶部那些彩色标签了。它们就是应用中的各个列表。点击或轻触即可切换。红色列表用于“下一步行动”，黄色列表用于“等待行动”，绿色和蓝色列表分别用于当前项目和将来项目，紫色和青色列表分别用于习惯和笔记。此外，还有一个日历，可以从屏幕顶部的工具栏进入，也可以通过黄色列表进入。\n每个列表都有不同的用途，操作方式也略有区别。点击列表标题旁边的小 (i) 图标，就能查看该列表的用途和功能说明。现在请退出这个编辑页面，浏览一下各个列表。看完之后，回到红色列表，勾选这项行动的复选框。下一张教程卡片就会出现在这个列表中。"
  },
  "tutorial.t3.title": {
    en: "3 Tutorial: Creating Items",
    "zh-Hans": "3 教程：创建条目"
  },
  "tutorial.t3.notes": {
    en: "Now that you've familiarized yourself with the different lists, you're ready to create your first item. If you're using a phone, you may have noticed a floating + badge in the bottom right corner. That is the creation button. Tap that to create items in your current lane. If you're on a computer, the creation buttons will be below the lane header. Go to the red list, and tap the badge or click the button to create a next action. Remember to hit the arrow/done button when you're finished.",
    "zh-Hans": "现在你已经熟悉了各个列表，可以创建你的第一个条目了。如果你使用的是手机，应该已经注意到右下角悬浮着一个 + 按钮，它就是新建按钮。轻触它，就能在当前列表中新建条目。如果你使用的是电脑，新建按钮位于列表标题下方。请切换到红色列表，点击 + 按钮或新建按钮，创建一个“下一步行动”。完成后，别忘了点击左上角箭头或“保存”按钮。"
  },
  "tutorial.t4.title": {
    en: "4 Tutorial: Creating a waiting action",
    "zh-Hans": "4 教程：创建等待行动"
  },
  "tutorial.t4.notes": {
    en: "Now that you've created your first action, it's time to create a waiting action. A waiting action is an action that you plan to take, but it depends on something else. For example, you might plan to book a hotel for your vacation, but you have to book your flight first. When creating a waiting action, this app allows you to give a qualitative description of the thing you're waiting on, but you can also connect it to another action. Now that you've created a next action, go to the waiting action lane (yellow) and create a waiting action connected to the action you created in tutorial 3. When you complete that action, your waiting action will automatically move to the red list.",
    "zh-Hans": "现在你已经创建了第一个行动，接下来可以创建一个“等待行动”。等待行动指的是你打算去做，但必须先等其他事情完成才能进行的行动。例如，你打算预订假期酒店，但必须先订好机票。在创建等待行动时，你可以填写正在等待什么，也可以直接把它关联到另一项行动。现在请前往黄色列表，创建一个等待行动，并将它关联到你在教程 3 中创建的那项“下一步行动”。等那项行动完成后，这个等待行动会自动移到红色列表。"
  },
  "tutorial.t5.title": {
    en: "5 Tutorial: Creating a context",
    "zh-Hans": "5 教程：创建情境"
  },
  "tutorial.t5.notes": {
    en: "While you were creating your actions, you may have noticed the create context button. This button allows you to create a special sub-list in the action lanes. In the Getting Things Done system, contexts are lists of actions organized by where and when you do them. For example, you might have a list of errands which can only be done if your in the car, or a list of calls you can only make if you have a phone. Contexts offer you the opportunity to take an action. In this app, they are shared across both the next action and waiting on lanes, meaning that a waiting item in the calls context in the yellow lane will promote to the calls context in the next actions (red) lane.",
    "zh-Hans": "在创建行动时，你可能已经注意到“创建情境”按钮。这个按钮可以让你在行动列表中创建一个专门的子列表。在《搞定》（Getting Things Done）系统中，情境是按照执行地点或时机来整理行动的方式。例如，你可以建立一个只有开车时才能处理的“跑腿”情境，或者一个只有手边有电话时才能处理的“打电话”情境。情境代表你具备了采取某项行动的条件。在本应用中，情境会同时应用于“下一步行动”和“等待行动”两个列表。也就是说，黄色列表中“打电话”情境里的等待项，在满足条件后，会自动移动到红色列表中对应的“打电话”情境。"
  },
  "tutorial.t6.title": {
    en: "6 Tutorial: Create a project",
    "zh-Hans": "6 教程：创建项目"
  },
  "tutorial.t6.notes": {
    en: "Projects are an important part of the organizational system this app uses. A project is anything you are currently working on that requires more than one action step to complete. Projects can be as simple as replacing a lightbulb, (identifying the type of light your fixture needs, going to the store, putting it in the socket) or as complicated as planning a vacation (booking time off, researching hotels, researching flights, etc.). If it takes more than one physical step, it's a project.\nYou can create projects on the project lane. Every project you create needs at least one linked action or calendar event. You can also create these from the project page.",
    "zh-Hans": "项目是本应用组织系统中非常重要的一部分。凡是你正在进行，而且需要一个以上具体行动步骤才能完成的事情，都属于项目。项目可以简单到换一个灯泡（确认灯泡型号、去商店购买、装进灯座），也可以复杂到规划一次假期（请假、查找酒店、查询航班等）。只要需要多个实际行动步骤，它就是一个项目。\n你可以在项目列表中创建项目。每个项目都必须至少关联一项行动或一个日历事件。你也可以直接在项目页面中创建这些内容。"
  },
  "tutorial.t7.title": {
    en: "7 Tutorial: The capture drawer and the daily review",
    "zh-Hans": "7 教程：收件箱与回顾"
  },
  "tutorial.t7.notes": {
    en: "When you opened the app, you may have noticed the pullout drawer on the right of your screen. On the computer, this drawer can be opened by clicking on the large white handle. On the phone, you can tap the arrows or swipe right. This drawer has a text box so you can capture thoughts, reminders, and information quickly. Whenever you add something to the drawer, it will create a face down card in the drawer. Cards can appear there for other reasons as well. Passed deadlines, projects with no linked actions, and waiting actions which have lost their waiting condition will also appear as face down cards in the drawer.\nYou can review these cards by clicking the \"review\" button. The review system will show them to you one at a time so that you can make decisions about each one. Go to the drawer now and use the review system to link an action to the sample project with no linked actions.",
    "zh-Hans": "打开应用时，你可能已经注意到屏幕右侧的抽屉。在电脑上，点击白色的大把手即可打开；在手机上，可以点击箭头或向右滑动打开。抽屉里有一个输入框，方便你快速记录想法、提醒或其他信息。每当你输入一条内容，就会在收件箱中生成一张背面朝上的卡片。除此之外，超过截止日期的事项、没有关联行动的项目，以及失去等待条件的等待行动，也都会以背面朝上的卡片出现在收件箱中。\n点击“回顾”按钮即可逐一处理这些卡片。回顾功能会一次显示一张卡片，让你决定如何处理。现在请打开抽屉，使用回顾功能，为那个没有关联行动的示例项目添加一项关联行动。"
  },
  "tutorial.t8.title": {
    en: "8 Tutorial Final: Habits",
    "zh-Hans": "8 教程终章：习惯"
  },
  "tutorial.t8.notes": {
    en: "None of this organizational system would work without habits. Habits are here defined as an automatic behaviour which is triggered by a cue. For example, when you here the notification sound on your cellphone, you automatically reach to check your text messages. The Getting Things Done system requires you to make a habit of checking your contextual lists when you're in the right context, as well as regularly submitting and reviewing items in your intray.\nThis app has a robust habit tracking system which helps you build the habits you want. Go to the habit lane and try to create your own habit. Remember to enter a cue in the box. Alternatively, you can use the hook icon to make another habit the cue for your new habit.",
    "zh-Hans": "没有习惯，这套组织系统就无法真正发挥作用。这里所说的“习惯”，是指由提示（cue）触发的自动行为。例如，当你听到手机通知铃声时，就会下意识地拿起手机查看消息。《搞定》（Getting Things Done）系统要求你养成这样的习惯：当处于相应情境时查看情境清单，并定期把事项放进收件箱，再通过回顾进行整理。\n本应用提供了完整的习惯追踪系统，帮助你培养想养成的习惯。请前往习惯列表，尝试创建一个属于自己的习惯。记得在输入框中填写提示（cue）。你也可以使用挂钩图标，把另一个习惯设为这个新习惯的提示（cue）。"
  },
  "tutorial.tp.title": {
    en: "Sample stalled project.",
    "zh-Hans": "示例停滞项目"
  },
  "tutorial.tp.notes": {
    en: "This project is a sample project intended for use in the tutorial. Its purpose is to get caught in the daily review during step 7 of the tutorial.",
    "zh-Hans": "这是一个用于教程的示例项目，用途是在教程第 7 步的回顾中被捕获。"
  },
  "tutorial.tr.title": {
    en: "Tutorial",
    "zh-Hans": "教程"
  },
  "tutorial.tr.notes": {
    en: "This project is a tutorial on how to use this app. Each of its linked actions is a different stage in the tutorial. You can see them listed below. You can also see these actions listed in the red and yellow lanes when you leave this page.",
    "zh-Hans": "这个项目就是本应用的使用教程。每一项关联行动都对应教程中的一个步骤，你可以在下方看到它们。离开这个页面后，也可以在红色和黄色列表中找到这些行动。"
  },

  // =========================================================
  // ▲ COVERAGE ROUND (author QA): "most of the buttons and textboxes on
  // creation and drafting pages aren't translated". These are the field
  // placeholders, button labels and tooltips on the actual drafting pages —
  // description boxes, "no linked project", "no deadline", the convert/complete
  // pills, the habit cue rows, the project's linked panel, notes, tags, the
  // calendar and event pages, the two pickers, and the confirm dialogs. See
  // COPY.txt, regenerated this round as the coverage reference.
  // =========================================================

  // ---- generic field placeholders (every drafting page) ----
  "field.description":       { en: "Description (optional)…", "zh-Hans": "描述（可选）…" },
  "field.noDeadline":        { en: "No deadline",              "zh-Hans": "无期限" },
  "field.noLinkedProject":   { en: "No linked project",        "zh-Hans": "未链接项目" },
  "field.noContext":         { en: "No context",                "zh-Hans": "无情境" },
  "field.noContextsYet":     { en: "No contexts yet — create them with + on the lane.", "zh-Hans": "还没有情境——在列表上用“+”创建。" },
  "field.clearDeadline":     { en: "Clear deadline",            "zh-Hans": "清除期限" },
  "field.clearTime":         { en: "Clear time",                "zh-Hans": "清除时间" },
  "field.optional":          { en: "Optional",                  "zh-Hans": "可选" },
  "field.pickDate":          { en: "Pick a date",                "zh-Hans": "选择日期" },

  // ---- the waiting-for row + condition hook ----
  "waiting.forPlaceholder":  { en: "Waiting for… (required — text or a hook)", "zh-Hans": "在等待…（必填——文字或挂钩）" },
  "waiting.changeHook":      { en: "Change the hooked condition", "zh-Hans": "更换挂钩的条件" },
  "waiting.hookToTarget":    { en: "Hook to a Next or Waiting action", "zh-Hans": "挂钩到一个下一步行动或等待项" },
  "waiting.removeCondition": { en: "Remove condition",          "zh-Hans": "移除条件" },
  "waiting.after":           { en: "After",                     "zh-Hans": "在…之后" },
  "waiting.anotherItem":     { en: "another item",              "zh-Hans": "另一个项目" },
  "waiting.waitingForLabel": { en: "Waiting for",               "zh-Hans": "在等待" },
  "waiting.blockedByDeadline": { en: "A waiting action can’t hold a date — clear the deadline first", "zh-Hans": "等待项不能带有日期——请先清除期限" },

  // ---- convert / complete pill group ----
  "outcome.makeWaiting":     { en: "Make Waiting Action",        "zh-Hans": "转为等待项" },
  "outcome.makeNext":        { en: "Make Next Action",           "zh-Hans": "转为下一步行动" },
  "outcome.makeFuture":      { en: "Make Future / Someday",      "zh-Hans": "转为将来/某天项目" },
  "outcome.makeCurrent":     { en: "Make Current Project",       "zh-Hans": "转为当前项目" },
  "outcome.disarmToConvert": { en: "Disarm Complete to convert", "zh-Hans": "先取消“完成”才能转换" },
  // outcome.tapToUndo / outcome.convertingToOnSave retired (author): the armed
  // convert no longer renders a filled "✓ Converting to X on save" pill. Under
  // THE PAGE SWAP the page itself has already changed kind, and the button
  // becomes the destination page's own — outcome.makeNext and friends, above.
  // Deleted rather than left dormant: an unused translated string is how the
  // intray shipped an English placeholder (see checks/i18n_no_hardcoded.py).
  "outcome.restoreToConvert":{ en: "Restore the item to convert it", "zh-Hans": "先恢复该项目才能转换" },
  "outcome.complete":        { en: "Complete",                   "zh-Hans": "完成" },
  "outcome.completeOnSaveTitle": { en: "Complete on save",       "zh-Hans": "保存时标记完成" },
  "outcome.completingOnSave":{ en: "Completing on save",         "zh-Hans": "保存时将标记完成" },
  "outcome.completingTapUndo": { en: "Completes when you save — tap to undo", "zh-Hans": "保存时会标记完成——点一下可撤销" },
  "outcome.completedToday":  { en: "Completed today",            "zh-Hans": "今天已完成" },
  "outcome.paused":          { en: "Paused",                     "zh-Hans": "已暂停" },
  "outcome.pausedUnpauseToComplete": { en: "Paused — unpause to complete", "zh-Hans": "已暂停——取消暂停后才能标记完成" },
  "outcome.restore":         { en: "Restore",                    "zh-Hans": "恢复" },
  "outcome.restoreToActive": { en: "Restore to the active list",  "zh-Hans": "恢复到活动列表" },

  // ---- advanced options ----
  "advanced.button":         { en: "Advanced options…",          "zh-Hans": "高级选项…" },
  "advanced.buttonDialog":   { en: "Advanced options",           "zh-Hans": "高级选项" },
  "advanced.done":           { en: "Done",                       "zh-Hans": "完成" },
  "advanced.bundlingTab":    { en: "Bundling",                   "zh-Hans": "捆绑" },
  "advanced.extraCuesTab":   { en: "Extra cues",                 "zh-Hans": "额外提示" },
  "advanced.temptationBundling": { en: "Temptation bundling",    "zh-Hans": "诱惑捆绑" },
  "advanced.bundlePlaceholder": { en: "What treat goes with this?", "zh-Hans": "配上什么小奖励？" },
  "advanced.notRecommended": { en: "Not recommended.",            "zh-Hans": "不太推荐。" },
  "advanced.bundleDescription": { en: "Temptation bundling pairs something you enjoy with the thing you’re doing: allow yourself the treat only while (or right after) doing this. e.g. “Only my favorite podcast while running.”", "zh-Hans": "诱惑捆绑把你喜欢的事和正在做的事绑在一起：只有在做这件事的时候（或刚做完）才允许自己享受那个奖励。例如“只有跑步的时候才听我最喜欢的播客”。" },
  "advanced.notRecommendedDescription": { en: "A habit is one cue followed by one automatic response — a habit with two cues is usually two habits, so consider creating a separate habit instead. Extra cues exist for rotating weekly routines (a different anchor on different days), not for stacking reminders.", "zh-Hans": "一个习惯是一个提示加一个自动反应——有两个提示的习惯通常其实是两个习惯，不如考虑单独创建一个。额外提示是为了轮换的每周惯例（不同的日子用不同的触发点），不是为了堆叠提醒。" },
  "advanced.addedRowsHint": { en: "Added rows appear on the habit page itself — each with its own text box and hook icon, like the default — and are edited and removed there.", "zh-Hans": "添加的行会出现在习惯页面本身——每一行都有自己的文本框和挂钩图标，和默认的一样——在那里编辑和删除。" },
  "advanced.cueLimitReached": { en: "Cue limit reached ({n} rows — one per weekday).", "zh-Hans": "已达到提示数量上限（{n} 行——每个工作日一行）。" },
  "advanced.addAnotherCue": { en: "+ Add another cue…",           "zh-Hans": "+ 添加另一个提示…" },
  "advanced.editBundle":     { en: "Edit in Advanced options",    "zh-Hans": "在高级选项中编辑" },
  "advanced.removeBundle":   { en: "Remove this bundle",          "zh-Hans": "移除这个捆绑" },

  // ---- habit page ----
  "habit.identityPlaceholder": { en: "Who will I be if I build this habit?", "zh-Hans": "养成这个习惯后，我会成为什么样的人？" },
  "habit.cuePlaceholderFirst": { en: "When? (required) e.g. After I’ve had my coffee…", "zh-Hans": "什么时候？（必填）例如：喝完咖啡之后…" },
  "habit.cuePlaceholderExtra": { en: "Cue… (shows on days no hook is live)", "zh-Hans": "提示…（在没有挂钩生效的日子显示）" },
  "habit.removeCue":         { en: "Remove this cue",             "zh-Hans": "移除这个提示" },
  "habit.hookToAnother":     { en: "Hook to another habit",       "zh-Hans": "挂钩到另一个习惯" },
  "habit.scheduledDays":     { en: "Scheduled days",              "zh-Hans": "安排的日子" },
  "habit.pause":             { en: "Pause",                       "zh-Hans": "暂停" },
  "habit.unpause":           { en: "Unpause",                     "zh-Hans": "取消暂停" },
  "habit.hookPickIntro":     { en: "Cue on which habit or context?", "zh-Hans": "以哪个习惯或情境为提示？" },
  "habit.hookPickHabits":    { en: "Habits",                      "zh-Hans": "习惯" },
  "habit.hookPickContexts":  { en: "Contexts",                    "zh-Hans": "情境" },
  "habit.hookPickEmpty":     { en: "No cues yet — add a habit, or create a context with + on the Next or Waiting lane.", "zh-Hans": "还没有提示——添加一个习惯，或在“下一步”或“等待”列表用“+”创建一个情境。" },
  "habit.deletedContext":    { en: "a deleted context",           "zh-Hans": "一个已删除的情境" },
  "habit.deletedHabit":      { en: "a deleted habit",             "zh-Hans": "一个已删除的习惯" },
  "habit.deletedSuffix":     { en: " (deleted)",                  "zh-Hans": "（已删除）" },
  "habit.notTodaySuffix":    { en: " (not today)",                "zh-Hans": "（今天不适用）" },
  "habit.dowFull.0":         { en: "Sunday",    "zh-Hans": "星期日" },
  "habit.dowFull.1":         { en: "Monday",    "zh-Hans": "星期一" },
  "habit.dowFull.2":         { en: "Tuesday",   "zh-Hans": "星期二" },
  "habit.dowFull.3":         { en: "Wednesday", "zh-Hans": "星期三" },
  "habit.dowFull.4":         { en: "Thursday",  "zh-Hans": "星期四" },
  "habit.dowFull.5":         { en: "Friday",    "zh-Hans": "星期五" },
  "habit.dowFull.6":         { en: "Saturday",  "zh-Hans": "星期六" },
  "habit.dowLetter.0":       { en: "S", "zh-Hans": "日" },
  "habit.dowLetter.1":       { en: "M", "zh-Hans": "一" },
  "habit.dowLetter.2":       { en: "T", "zh-Hans": "二" },
  "habit.dowLetter.3":       { en: "W", "zh-Hans": "三" },
  "habit.dowLetter.4":       { en: "T", "zh-Hans": "四" },
  "habit.dowLetter.5":       { en: "F", "zh-Hans": "五" },
  "habit.dowLetter.6":       { en: "S", "zh-Hans": "六" },

  // ---- the picker "Back" used by both hook and condition pickers ----
  "picker.back":              { en: "Back",                       "zh-Hans": "返回" },
  "picker.noCondition":        { en: "No condition",              "zh-Hans": "无条件" },
  "picker.conditionThisProject": { en: "This project",            "zh-Hans": "本项目" },
  "picker.conditionEverythingElse": { en: "Everything else",      "zh-Hans": "其他" },
  "picker.conditionNextActions": { en: "Next Actions",            "zh-Hans": "下一步行动" },
  "picker.conditionWaitingActions": { en: "Waiting Actions",      "zh-Hans": "等待项" },
  "picker.conditionUpcomingEvents": { en: "Upcoming events",      "zh-Hans": "即将到来的事件" },
  "picker.conditionEmpty":    { en: "No actions to wait on yet. Add a next action first — or use ✎ to say what you’re waiting for.", "zh-Hans": "还没有可以等待的行动。先添加一个下一步行动——或用 ✎ 写下你在等待什么。" },
  "picker.deletedItem":       { en: "a deleted item",              "zh-Hans": "一个已删除的项目" },

  // ---- the project page's linked panel ----
  "project.linked":          { en: "Linked",                       "zh-Hans": "已链接" },
  "project.linkedActions":   { en: "Actions",                      "zh-Hans": "行动" },
  "project.linkedNotesTab":  { en: "Notes",                        "zh-Hans": "笔记" },
  "project.linkedActionsLabel": { en: "Linked actions",            "zh-Hans": "已链接的行动" },
  "project.linkedNotesLabel": { en: "Linked notes",                "zh-Hans": "已链接的笔记" },
  "project.noNotesLinkedYet": { en: "No notes linked yet.",        "zh-Hans": "还没有链接任何笔记。" },
  "project.nothingLinkedYet": { en: "Nothing linked yet.",         "zh-Hans": "还没有链接任何东西。" },
  "project.newNote":         { en: "+ New note",                   "zh-Hans": "+ 新建笔记" },
  "project.newAction":       { en: "+ New action",                 "zh-Hans": "+ 新建行动" },
  "project.newWaitingAction": { en: "+ New waiting action",        "zh-Hans": "+ 新建等待项" },
  "project.newEvent":        { en: "+ New event",                  "zh-Hans": "+ 新建事件" },
  "project.noNextStepFlag":  { en: "No linked actions yet — every active project should have at least one next step.", "zh-Hans": "还没有链接任何行动——每个进行中的项目都应该至少有一个下一步。" },
  "project.lockedTooltip":   { en: "Linked to this project — remove it from the project’s list instead", "zh-Hans": "已链接到本项目——请从项目的列表中移除它" },
  "project.savesWithProject": { en: "saves with the project",      "zh-Hans": "随项目一起保存" },
  "project.untitled":        { en: "Untitled",                     "zh-Hans": "未命名" },
  "lane.nothingHereYet":     { en: "Nothing here yet.",             "zh-Hans": "这里还什么都没有。" },
  "lane.completedSection":   { en: "Completed",                     "zh-Hans": "已完成" },
  "tray.title":              { en: "Intray",                        "zh-Hans": "收件箱" },
  "settings.debuggingRow":   { en: "Debugging",                     "zh-Hans": "调试" },
  "settings.restoreDefaultsRow": { en: "Restore app to defaults",   "zh-Hans": "恢复应用默认设置" },
  "note.allNotes":           { en: "All notes",                     "zh-Hans": "全部笔记" },
  "note.filterProjects":     { en: "Projects",                      "zh-Hans": "项目" },
  "note.filterTags":         { en: "Tags",                          "zh-Hans": "标签" },
  "note.clearFilter":        { en: "Clear filter",                  "zh-Hans": "清除筛选" },
  // ⚑ NEW STRING, not a re-wiring: the notes filter's empty state was the one
  // hard-coded line in the audit with no key waiting for it, so this zh-Hans is
  // newly written rather than the author's own — revise freely.
  "note.filterEmpty":        { en: "Nothing to filter by yet — link a note to a project or add a tag.",
                               "zh-Hans": "还没有可筛选的内容——请把笔记关联到项目，或添加标签。" },
  "deadline.pushedOne":      { en: "Deadline pushed 1 time",         "zh-Hans": "期限已推迟 1 次" },
  "deadline.pushedMany":     { en: "Deadline pushed {n} times",      "zh-Hans": "期限已推迟 {n} 次" },
  "project.openProject":     { en: "Open project: {title}",          "zh-Hans": "打开项目：{title}" },
  "lane.moveTo":             { en: "Move to {lane}",                 "zh-Hans": "移到{lane}" },
  "card.markComplete":       { en: "Mark complete",                  "zh-Hans": "标记完成" },
  "card.tapToOpenReorder":   { en: "Tap to open — press and hold to reorder", "zh-Hans": "点击打开——按住可重新排序" },
  "lane.deleteAllCompleted": { en: "Delete all completed items",     "zh-Hans": "删除所有已完成的项目" },
  "card.tapToView":          { en: "Tap to view",                    "zh-Hans": "点击查看" },
  "group.tapToExpandReorder": { en: "Tap to expand/collapse — press and hold to reorder", "zh-Hans": "点击展开/收起——按住可重新排序" },
  "group.addToList":         { en: "Add to this list",               "zh-Hans": "添加到此列表" },
  "group.tapToExpand":       { en: "Tap to expand/collapse",         "zh-Hans": "点击展开/收起" },
  "group.addToContext":      { en: "Add to this context",            "zh-Hans": "添加到此情境" },
  "group.deleteContext":     { en: "Delete context",                 "zh-Hans": "删除情境" },
  "group.dropHint":          { en: "Drag items here",                "zh-Hans": "把项目拖到这里" },
  "habit.tidyOrderTooltip":  { en: "Suggest an order from your hooks (you can still rearrange freely afterward)", "zh-Hans": "根据你的挂钩关系建议一个顺序（之后仍可自由调整）" },
  "habit.tidyOrder":         { en: "Tidy order",                     "zh-Hans": "整理顺序" },
  "tray.discard":            { en: "Discard",                        "zh-Hans": "丢弃" },
  "tray.capturePlaceholder": { en: "Capture a thought…",             "zh-Hans": "记录一个想法…" },
  "settings.buildTooltip":   { en: "Which build you are running",    "zh-Hans": "你正在运行的版本" },

  // ---- notes ----
  "note.titlePlaceholder":   { en: "Note title…",                  "zh-Hans": "笔记标题…" },
  "note.bodyPlaceholder":    { en: "Write anything…",               "zh-Hans": "写点什么…" },
  "note.undo":               { en: "Undo",                         "zh-Hans": "撤销" },
  "note.redo":               { en: "Redo",                         "zh-Hans": "重做" },
  "note.bold":               { en: "Bold",                         "zh-Hans": "加粗" },
  "note.italic":             { en: "Italic",                       "zh-Hans": "斜体" },
  "note.underline":          { en: "Underline",                    "zh-Hans": "下划线" },
  "note.heading":            { en: "Heading",                      "zh-Hans": "标题" },
  "note.bulletList":         { en: "Bullet list",                  "zh-Hans": "项目符号列表" },
  "note.checklist":          { en: "Checklist",                    "zh-Hans": "清单" },
  "note.addTagOrProject":    { en: "Add a tag or linked project",  "zh-Hans": "添加标签或链接项目" },
  "note.tagsHeading":        { en: "Tags",                         "zh-Hans": "标签" },
  "note.linkCurrentProject": { en: "Link a current project",        "zh-Hans": "链接一个当前项目" },
  "note.linkSomedayProject": { en: "Link a Someday project",        "zh-Hans": "链接一个将来项目" },
  "note.noCurrentToLink":    { en: "No current projects to link — create one on the Projects tab.", "zh-Hans": "没有可以链接的当前项目——在“项目”标签页创建一个。" },
  "note.noSomedayToLink":    { en: "Nothing in Someday to link yet.", "zh-Hans": "“将来”里还没有可以链接的项目。" },
  "note.noTagsYet":          { en: "No tags yet — add some with “Manage tags”.", "zh-Hans": "还没有标签——用“管理标签”添加一些。" },
  "note.manageTags":         { en: "Manage tags →",                 "zh-Hans": "管理标签 →" },

  // ---- tags page ----
  "tags.namePlaceholder":    { en: "tag name…",                    "zh-Hans": "标签名称…" },
  "tags.addTag":             { en: "+ Add tag",                    "zh-Hans": "+ 添加标签" },
  "tags.remove":             { en: "Remove",                       "zh-Hans": "移除" },
  "tags.createOnlyHint":     { en: "Adding tags here — ← saves them and returns to your note. Rename or delete tags from the Notes + badge → Tags.", "zh-Hans": "在这里添加标签——← 会保存并返回你的笔记。要重命名或删除标签，请从“笔记”的 + 徽章 → “标签”进入。" },
  "tags.projectsHeading":    { en: "Projects (names already taken)", "zh-Hans": "项目（名称已被占用）" },
  "tags.noProjectsYet":      { en: "No projects yet.",              "zh-Hans": "还没有项目。" },
  "tags.completedNameTaken": { en: "A completed project already uses this name.", "zh-Hans": "已有一个已完成的项目使用了这个名称。" },

  // ---- the daily review ----
  "review.badge":            { en: "Review",                        "zh-Hans": "回顾" },
  "review.toReview":         { en: "to review",                     "zh-Hans": "项待回顾" },
  "review.showAll":          { en: "Show all",                      "zh-Hans": "全部显示" },
  "review.oneAtATime":       { en: "One at a time",                 "zh-Hans": "一次一个" },
  "review.allClear":         { en: "All clear.",                    "zh-Hans": "全部清空。" },
  "review.nothingSlipping":  { en: "Nothing slipping through the cracks.", "zh-Hans": "没有什么被遗漏。" },
  "review.deferredSuffix":   { en: " deferred.",                    "zh-Hans": " 项已推迟。" },
  "review.deferredSub":      { en: "You saw everything. These are waiting on you — they’ll be back next time you open the review.", "zh-Hans": "你已经看过全部了。这些还在等你处理——下次打开回顾时会再出现。" },
  "review.next":             { en: "Next",                          "zh-Hans": "下一步" },
  "review.waiting":          { en: "Waiting",                       "zh-Hans": "等待" },
  "review.project":          { en: "Project",                       "zh-Hans": "项目" },
  "review.future":           { en: "Future",                        "zh-Hans": "将来" },
  "review.habit":            { en: "Habit",                         "zh-Hans": "习惯" },
  "review.note":             { en: "Note",                          "zh-Hans": "笔记" },
  "review.calendar":         { en: "Calendar",                      "zh-Hans": "日历" },
  "review.twoMin":           { en: "2 min",                         "zh-Hans": "2分钟" },
  "review.infoNextLabel":    { en: "Next:",                         "zh-Hans": "下一步：" },
  "review.infoWaitingLabel": { en: "Waiting:",                      "zh-Hans": "等待：" },
  "review.infoProjectLabel": { en: "Project:",                      "zh-Hans": "项目：" },
  "review.infoFutureLabel":  { en: "Future:",                       "zh-Hans": "将来：" },
  "review.infoHabitLabel":   { en: "Habit:",                        "zh-Hans": "习惯：" },
  "review.infoNoteLabel":    { en: "Note:",                         "zh-Hans": "笔记：" },
  // ⚑ The capture card has offered a Calendar button since chunk 7; the info
  // panel beside it explained the other six destinations and not this one.
  "review.infoCalendarLabel": { en: "Calendar:",                   "zh-Hans": "日历：" },
  "review.infoTwoMinLabel":  { en: "2 min:",                        "zh-Hans": "2分钟：" },
  "review.infoTwoMinText":   { en: "If you can get something done in 2 minutes, you should do it right away instead of recording it.", "zh-Hans": "如果一件事两分钟内就能做完，直接去做就好，不用特地记下来。" },
  "review.infoPastDueLabel": { en: "Past its date:",                "zh-Hans": "已过期：" },
  "review.infoStalledLabel": { en: "Stalled project:",              "zh-Hans": "停滞的项目：" },
  "review.infoOrphanedLabel": { en: "Waiting on something gone:",   "zh-Hans": "在等一个已经不存在的东西：" },
  "review.infoMissedLabel":  { en: "A repeat you missed:",          "zh-Hans": "一个你错过的重复项：" },
  "review.noWayForward":     { en: "no way forward",                "zh-Hans": "没有下一步" },
  // The orphaned card's note when the row has NO condition at all rather than a
  // dangling one — "After a deleted item" would have been a plain lie about a
  // row that never had one. Same card, same fix-it row underneath.
  "review.waitingOnNothing": { en: "not waiting on anything",        "zh-Hans": "没有在等任何东西" },
  // review.iDidIt retired — merged into review.completed, later unified
  // further across every "mark this done" verb on the review surface
  // (author rulings, second and third QA rounds).
  "review.skipped":          { en: "Skipped",                       "zh-Hans": "已跳过" },
  "review.quickDoneComplete": { en: "Complete",                     "zh-Hans": "完成" },
  "review.quickDoneBack":    { en: "Back",                          "zh-Hans": "返回" },
  "review.wentByOn":         { en: "went by on",                    "zh-Hans": "已过期，日期是" },
  "review.withoutTicking":   { en: "without being ticked",          "zh-Hans": "但没有勾选" },
  // ⚑ UNIFIED (author, third QA round): "Mark done" / "Complete it" /
  // "Complete" were three names for the identical act across five card
  // kinds — one shared key now, everywhere a review card resolves an item
  // as done. Same move for delete: "Delete" / "Delete it" -> review.delete
  // alone (its two other call sites below now point here).
  "review.completed":        { en: "Completed",                     "zh-Hans": "已完成" },
  "review.delete":           { en: "Delete",                        "zh-Hans": "删除" },
  "review.pushTheDate":      { en: "Push the date",                 "zh-Hans": "推迟日期" },
  "review.whatsNextAction":  { en: "What's the very next physical action?", "zh-Hans": "接下来最具体的下一步是什么？" },
  "review.add":              { en: "Add",                           "zh-Hans": "添加" },
  "review.addNextAction":    { en: "+Next",                         "zh-Hans": "+下一步" },
  "review.addWaitingAction": { en: "+Waiting",                      "zh-Hans": "+等待" },
  "review.addAnEvent":       { en: "+Event",                        "zh-Hans": "+事件" },
  "review.moveToSomeday":    { en: "Someday →",                     "zh-Hans": "将来 →" },
  "review.whatWaitingOn":    { en: "What are you waiting on?",      "zh-Hans": "你在等待什么？" },
  "review.untilWhatWhen":    { en: "Until what, or until when?",    "zh-Hans": "等到什么，或者等到什么时候？" },
  "review.waitingForDots":   { en: "Waiting for…",                  "zh-Hans": "在等待…" },
  // review.repointCondition / review.replaceWithFreeText retired — merged
  // into one quick-add field (text box + hook icon), fifth QA round.
  // review.promoteToNext retired — the orphaned card's promote button now
  // reuses outcome.makeNext's label directly (sixth QA round): it converts
  // the existing item, unlike every other "+Next", so it needed to look
  // like the drafting page's own convert button, not a create-flavored chip.
  "review.cancel":           { en: "Cancel",                        "zh-Hans": "取消" },
  "review.save":             { en: "Save",                          "zh-Hans": "保存" },
  "review.fullPage":         { en: "Full page →",                   "zh-Hans": "完整页面 →" },
  "review.fullPageTooltip":  { en: "More fields — context, deadline, description", "zh-Hans": "更多字段——情境、期限、描述" },

  // ---- the completed page ----
  "completed.context":       { en: "Context:",                     "zh-Hans": "情境：" },
  "completed.partOf":        { en: "Part of",                       "zh-Hans": "属于" },
  "completed.due":           { en: "Due",                           "zh-Hans": "截止" },
  "completed.at":            { en: "at",                            "zh-Hans": "，时间" },
  "completed.completedOn":   { en: "Completed",                     "zh-Hans": "完成于" },

  // ---- confirm dialogs ----
  "confirm.projectDiscardMessage": {
    en: "Are you sure? Exiting without saving will undo everything you did on this page — including actions you created, edited, or deleted, and any changes to the project’s own notes.",
    "zh-Hans": "确定吗？不保存就退出会撤销你在这个页面上做的一切——包括你创建、编辑或删除的行动，以及项目自身笔记的任何改动。"
  },
  "confirm.deleteNoteForGood": { en: "Delete this note for good?", "zh-Hans": "永久删除这条笔记？" },
  "confirm.deleteForGood":   { en: "Delete this for good?",        "zh-Hans": "永久删除这个吗？" },
  "confirm.deleteTagsOne":   { en: "Delete “{name}”? It will be removed from {notes}.", "zh-Hans": "删除“{name}”吗？它将从{notes}中移除。" },
  "confirm.deleteTagsMany":  { en: "Delete {n} tags? They’ll be removed from the notes that use them.", "zh-Hans": "删除 {n} 个标签吗？它们将从使用它们的笔记中移除。" },
  "confirm.hookTakeoverOne": { en: "“{label}” already has “{other}” hooked to it. Hook to it anyway?", "zh-Hans": "“{label}”上已经挂着“{other}”了。仍要挂上吗？" },
  "confirm.hookTakeoverMany": { en: "“{label}” already has {n} habits hooked to it. Hook to it anyway?", "zh-Hans": "“{label}”上已经挂着 {n} 个习惯了。仍要挂上吗？" },
  "confirm.hookAnyway":      { en: "Hook anyway",                   "zh-Hans": "仍要挂上" },
  "confirm.replaceThem":     { en: "Replace them",                  "zh-Hans": "替换它们" },
  "confirm.replaceThatHook": { en: "Replace that hook",             "zh-Hans": "替换那个挂钩" },
  "confirm.restoreDefaultsMessage": {
    en: "Restore the app to its default state? Everything you’ve entered — notes, actions, projects, habits — will be permanently erased and replaced with the sample data. This can’t be undone.",
    "zh-Hans": "把应用恢复到默认状态？你输入的一切——笔记、行动、项目、习惯——都会被永久清除，替换成示例数据。此操作无法撤销。"
  },
  "confirm.eraseRestoreDefaults": { en: "Erase & restore defaults", "zh-Hans": "清除并恢复默认" },
  // W7. The stark warning above was TRUE before sync and quietly stopped being
  // true after it -- the cloud kept a copy, so the next sync poured everything
  // back. The author's ruling is to make it true again, which means saying out
  // loud that the erase travels. Appended only when the roster shows another
  // device, so it never describes something that cannot happen.
  "confirm.restoreAlsoDeletesElsewhere": {
    en: "This will also delete your data on any device you sync with.",
    "zh-Hans": "这也会删除你同步的所有其他设备上的数据。"
  },
  "confirm.restoreAllDevices": { en: "Erase on all devices", "zh-Hans": "清除所有设备上的数据" },
  "confirm.disconnectAndRestore": { en: "Disconnect & erase here only", "zh-Hans": "断开连接，仅清除本设备" },
  "confirm.importInvalidJson": { en: "That file isn’t valid backup JSON.", "zh-Hans": "该文件不是有效的备份 JSON。" },
  "confirm.importNotBackup": { en: "That file doesn’t look like an OELA backup.", "zh-Hans": "该文件看起来不是 OELA 的备份文件。" },
  "confirm.importReplaceWarning": { en: "This will replace everything currently in the app.", "zh-Hans": "这将替换应用中当前的所有内容。" },
  // W7: shown only when this device syncs. A restore propagates (author's
  // ruling), so it can bring back something deleted on the other device --
  // which is worth saying plainly BEFORE it happens, not discovering after.
  "confirm.importAlsoSyncs": { en: "Your other devices will get the restored items too, including anything you deleted there.", "zh-Hans": "你的其他设备也会收到恢复的内容，包括你在那里删除过的项目。" },
  "confirm.replaceEverything": { en: "Replace everything",          "zh-Hans": "替换全部" },
  "confirm.ok":               { en: "OK",                           "zh-Hans": "好" },
  "confirm.deleteTitleForGood": { en: "Delete “{title}” for good?", "zh-Hans": "永久删除“{title}”吗？" },
  "confirm.deleteThisItem":   { en: "this",                         "zh-Hans": "这个" },
  "confirm.saveAnyway":       { en: "Save anyway",                  "zh-Hans": "仍要保存" },
  "confirm.goBack":           { en: "Go back",                      "zh-Hans": "返回" },
  "confirm.strandedOne":      { en: "1 calendar entry is scheduled after this new deadline. You can keep it — nothing will be moved or deleted.", "zh-Hans": "有 1 项日历安排在这个新期限之后。你可以保留——不会有任何东西被移动或删除。" },
  "confirm.strandedMany":     { en: "{n} calendar entries are scheduled after this new deadline. You can keep them — nothing will be moved or deleted.", "zh-Hans": "有 {n} 项日历安排在这个新期限之后。你可以保留——不会有任何东西被移动或删除。" },
  "confirm.cancel":           { en: "Cancel",                       "zh-Hans": "取消" },

  // ---- the calendar ----
  "cal.back":                { en: "Back",                          "zh-Hans": "返回" },
  "cal.month":                { en: "Month",                        "zh-Hans": "月" },
  "cal.day":                  { en: "Day",                          "zh-Hans": "日" },
  "cal.list":                 { en: "List",                         "zh-Hans": "列表" },
  "cal.comingUp":             { en: "Coming up",                    "zh-Hans": "即将到来" },
  "cal.pastDue":              { en: "Past due",                     "zh-Hans": "已过期" },
  "cal.today":                { en: "Today",                        "zh-Hans": "今天" },
  "cal.nothingOnThisDay":     { en: "Nothing on this day.",         "zh-Hans": "这一天没有安排。" },
  "cal.nothingComingUp":      { en: "Nothing coming up. Anything you schedule will be listed here, in the order it happens.", "zh-Hans": "还没有即将到来的安排。你排定的任何事都会按发生顺序列在这里。" },
  "cal.allDay":               { en: "All day",                      "zh-Hans": "全天" },
  "cal.due":                  { en: "Due",                          "zh-Hans": "截止" },
  "cal.moved":                { en: "moved",                        "zh-Hans": "已移动" },
  "cal.hidden":               { en: "hidden",                       "zh-Hans": "已隐藏" },
  "cal.paused":                { en: "paused",                      "zh-Hans": "已暂停" },
  "cal.repeats":               { en: "Repeats",                     "zh-Hans": "重复" },
  "cal.projectDeadline":       { en: "project deadline",            "zh-Hans": "项目期限" },
  "cal.actionDeadline":        { en: "action deadline",             "zh-Hans": "行动期限" },
  "cal.openCalendar":          { en: "Open the calendar",           "zh-Hans": "打开日历" },
  "cal.nothingNext7Days":      { en: "Nothing in the next 7 days.", "zh-Hans": "接下来 7 天内没有安排。" },
  "cal.event":                 { en: "Event",                       "zh-Hans": "事件" },
  "cal.deadline":              { en: "Deadline",                    "zh-Hans": "期限" },
  "cal.action":                 { en: "Action",                     "zh-Hans": "行动" },
  "cal.project":                { en: "Project",                    "zh-Hans": "项目" },
  "cal.description":            { en: "Description (optional)…",   "zh-Hans": "描述（可选）…" },
  "cal.time":                   { en: "--:--",                      "zh-Hans": "--:--" },
  "cal.hideUntilItHappens":     { en: "Hide until the day it happens", "zh-Hans": "在发生的那天之前先隐藏" },
  "cal.moreOptions":            { en: "More options →",             "zh-Hans": "更多选项 →" },
  "cal.moreOptionsTooltip":     { en: "Open the full page — context, project link, and everything here", "zh-Hans": "打开完整页面——情境、项目链接，以及这里的一切" },
  "cal.makeHabitInstead":       { en: "Recurring chore? Make this a habit instead →", "zh-Hans": "重复的例行事务？改用习惯来记录 →" },
  "cal.dismissHabitBubble":     { en: "Dismiss",                    "zh-Hans": "关闭" },
  "cal.add":                    { en: "Add",                        "zh-Hans": "添加" },
  "cal.eventOnPrefix":          { en: "Event on ",                   "zh-Hans": "事件安排在 " },
  "cal.duePrefix":              { en: "Due ",                        "zh-Hans": "截止于 " },
  "cal.adding":                 { en: "Adding to",                   "zh-Hans": "添加到" },
  "cal.dueAbbrev":               { en: "due",                        "zh-Hans": "截止" },
  "cal.thisProject":             { en: "this project",               "zh-Hans": "本项目" },
  "cal.every":                   { en: "every",                      "zh-Hans": "每" },
  "cal.optional":                { en: "Optional",                   "zh-Hans": "可选" },
  "cal.doesNotRepeat":           { en: "Does not repeat",            "zh-Hans": "不重复" },
  "cal.daily":                   { en: "Daily",                      "zh-Hans": "每天" },
  "cal.weekly":                  { en: "Weekly",                     "zh-Hans": "每周" },
  "cal.monthly":                 { en: "Monthly",                    "zh-Hans": "每月" },
  "cal.yearly":                  { en: "Yearly",                     "zh-Hans": "每年" },
  "cal.month.0":  { en: "January",   "zh-Hans": "一月" },
  "cal.month.1":  { en: "February",  "zh-Hans": "二月" },
  "cal.month.2":  { en: "March",     "zh-Hans": "三月" },
  "cal.month.3":  { en: "April",     "zh-Hans": "四月" },
  "cal.month.4":  { en: "May",       "zh-Hans": "五月" },
  "cal.month.5":  { en: "June",      "zh-Hans": "六月" },
  "cal.month.6":  { en: "July",      "zh-Hans": "七月" },
  "cal.month.7":  { en: "August",    "zh-Hans": "八月" },
  "cal.month.8":  { en: "September", "zh-Hans": "九月" },
  "cal.month.9":  { en: "October",   "zh-Hans": "十月" },
  "cal.month.10": { en: "November",  "zh-Hans": "十一月" },
  "cal.month.11": { en: "December",  "zh-Hans": "十二月" },
  "cal.dowShort.0": { en: "Sun", "zh-Hans": "日" },
  "cal.dowShort.1": { en: "Mon", "zh-Hans": "一" },
  "cal.dowShort.2": { en: "Tue", "zh-Hans": "二" },
  "cal.dowShort.3": { en: "Wed", "zh-Hans": "三" },
  "cal.dowShort.4": { en: "Thu", "zh-Hans": "四" },
  "cal.dowShort.5": { en: "Fri", "zh-Hans": "五" },
  "cal.dowShort.6": { en: "Sat", "zh-Hans": "六" },

  // ---- the event page ----
  "event.titlePlaceholder":     { en: "Event title…",                "zh-Hans": "事件标题…" },
  "event.occurrenceHint":       { en: "Editing the occurrence on {date} · you’ll choose this one or the whole series when you save", "zh-Hans": "正在编辑 {date} 这一次发生的事件 · 保存时会让你选择只改这一次还是整个系列" },
  "event.moveThisOccurrence":   { en: "move this occurrence",        "zh-Hans": "移动这一次发生的日期" },
  "event.pauseSeries":          { en: "Pause series",                "zh-Hans": "暂停系列" },
  "event.pausedResumeOnSave":   { en: "Paused — resume on save",     "zh-Hans": "已暂停——保存时恢复" },
  "event.markComplete":         { en: "Mark complete",               "zh-Hans": "标记完成" },
  "event.completedTodayReopen": { en: "Completed today — tap to reopen on save", "zh-Hans": "今天已完成——点一下可在保存时重新打开" },
  "event.scheduledForBanner":   { en: "Scheduled for {date} — in your calendar", "zh-Hans": "已安排在 {date} —— 已加入你的日历" },
  "event.scopePromptPlain":     { en: "Apply your changes to…",      "zh-Hans": "把改动应用到…" },
  "event.scopePromptSeriesNote": { en: "Repeat, pause, context, project link and hiding always apply to the whole series — those are saved either way. Apply your other changes to…", "zh-Hans": "重复方式、暂停、情境、项目链接和隐藏设置总是应用于整个系列——无论你怎么选都会保存。把其他改动应用到…" },
  "event.thisOccurrenceOnly":   { en: "This occurrence only",        "zh-Hans": "仅这一次" },
  "event.allOccurrences":       { en: "All occurrences",             "zh-Hans": "全部发生" },
  "event.repeatsPrompt":        { en: "This event repeats. What would you like to do?", "zh-Hans": "这个事件是重复的。你想怎么处理？" },
  "event.skipThisOne":          { en: "Skip this one",               "zh-Hans": "跳过这一次" },
  "event.deleteSeries":         { en: "Delete series",                "zh-Hans": "删除整个系列" },
  // ---- confirm dialogs (i18n round 2). Whole-sentence One/Many pairs rather
  // than concatenated fragments: English pluralises with -s and swaps
  // them/it, Chinese does neither, so only a complete sentence can carry both.
  "confirm.linkedWaitingOne":  { en: "1 linked waiting item",           "zh-Hans": "1 个关联的等待事项" },
  "confirm.linkedWaitingMany": { en: "{n} linked waiting items",        "zh-Hans": "{n} 个关联的等待事项" },
  "confirm.linkedEventOne":    { en: "1 linked calendar entry",         "zh-Hans": "1 个关联的日历条目" },
  "confirm.linkedEventMany":   { en: "{n} linked calendar entries",     "zh-Hans": "{n} 个关联的日历条目" },
  "confirm.joinAnd":           { en: " and ",                           "zh-Hans": "和" },
  "confirm.joinOr":            { en: " or ",                            "zh-Hans": "或" },
  "confirm.completeProjectOne": {
    en: "This project has {what}. Completing it will put it aside — it will stop appearing, and it can be brought back if this was a mistake.",
    "zh-Hans": "这个项目有{what}。完成它会把它收起来——它将不再出现；如果这是个误操作，也可以再把它恢复。"
  },
  "confirm.completeProjectMany": {
    en: "This project has {what}. Completing it will put them aside — they will stop appearing, and they can be brought back if this was a mistake.",
    "zh-Hans": "这个项目有{what}。完成它会把它们收起来——它们将不再出现；如果这是个误操作，也可以再把它们恢复。"
  },
  "confirm.completeProject":   { en: "Complete project",                "zh-Hans": "完成项目" },
  "confirm.nounActions":       { en: "actions",                         "zh-Hans": "行动" },
  "confirm.nounCalendarEntries": { en: "calendar entries",              "zh-Hans": "日历条目" },
  "confirm.somedayCantHold": {
    en: "Someday projects can't hold linked {what}. Unlink them, or delete them?",
    "zh-Hans": "将来项目不能保留关联的{what}。要解除关联，还是删除它们？"
  },
  "confirm.notesKeptOne": {
    en: " Linked notes are kept either way — the note will still be on the project.",
    "zh-Hans": "无论选择哪一项，关联的笔记都会保留——这条笔记仍会留在项目里。"
  },
  "confirm.notesKeptMany": {
    en: " Linked notes are kept either way — all {n} notes will still be on the project.",
    "zh-Hans": "无论选择哪一项，关联的笔记都会保留——全部 {n} 条笔记仍会留在项目里。"
  },
  "confirm.unlink":            { en: "Unlink",                          "zh-Hans": "解除关联" },
  "confirm.thisList":          { en: "this list",                       "zh-Hans": "这个列表" },
  "confirm.thisContext":       { en: "this context",                    "zh-Hans": "这个情境" },
  "confirm.deleteListEmpty":   { en: "Delete the “{name}” list?",       "zh-Hans": "删除“{name}”列表？" },
  "confirm.deleteListOne": {
    en: "Delete the “{name}” list? Its 1 item will stay — ungrouped, at the top of the lane.",
    "zh-Hans": "删除“{name}”列表？其中的 1 个条目会保留下来——不再分组，移到该列表的顶部。"
  },
  "confirm.deleteListMany": {
    en: "Delete the “{name}” list? Its {n} items will stay — ungrouped, at the top of the lane.",
    "zh-Hans": "删除“{name}”列表？其中的 {n} 个条目会保留下来——不再分组，移到该列表的顶部。"
  },
  "confirm.deleteContextEmpty": { en: "Delete the “{name}” context?",   "zh-Hans": "删除“{name}”情境？" },
  "confirm.deleteContextOne": {
    en: "Delete the “{name}” context? Its 1 item will stay — ungrouped, at the top of the lane.",
    "zh-Hans": "删除“{name}”情境？其中的 1 个条目会保留下来——不再分组，移到该列表的顶部。"
  },
  "confirm.deleteContextMany": {
    en: "Delete the “{name}” context? Its {n} items will stay — ungrouped, at the top of the lane.",
    "zh-Hans": "删除“{name}”情境？其中的 {n} 个条目会保留下来——不再分组，移到该列表的顶部。"
  },
  "confirm.deleteAllCompletedOne":  { en: "Delete 1 completed item? This can’t be undone.",
                                      "zh-Hans": "删除 1 个已完成的条目？此操作无法撤销。" },
  "confirm.deleteAllCompletedMany": { en: "Delete all {n} completed items? This can’t be undone.",
                                      "zh-Hans": "删除全部 {n} 个已完成的条目？此操作无法撤销。" },
  "confirm.deleteAll":         { en: "Delete all",                      "zh-Hans": "全部删除" },
  "confirm.deleteCompletedItem": { en: "Delete this completed item? This can’t be undone.",
                                   "zh-Hans": "删除这个已完成的条目？此操作无法撤销。" },
  "confirm.storageFull": {
    en: "Storage is full — the last change couldn't be saved. Free up space (clear old completed items, or Reset local data) and try again.",
    "zh-Hans": "存储空间已满——最后一次更改没有保存成功。请先腾出空间（清除旧的已完成条目，或重置本地数据），然后再试一次。"
  },
  // ---- surfaces: the background picker renders SURFACES[id].label directly
  "surface.slate":     { en: "Slate",         "zh-Hans": "石板灰" },
  "surface.plain":     { en: "Plain",         "zh-Hans": "纯色" },
  "surface.darkwood":  { en: "Dark wood",     "zh-Hans": "深色木纹" },
  "surface.rosewood":  { en: "Rosewood",      "zh-Hans": "红木" },
  "surface.lacquer":   { en: "Black lacquer", "zh-Hans": "黑漆" },
  // ---- odds and ends
  // The title a brand-new habit is born with when "Make it a habit" is used
  // from an unnamed calendar row. Becomes DATA, like project.untitled.
  // The inline naming row that creates a list or a context (§4.3e).
  "placeholder.listName":    { en: "List name…",    "zh-Hans": "列表名称…" },
  "placeholder.contextName": { en: "Context name…", "zh-Hans": "情境名称…" },
  "habit.newHabitDefault": { en: "New habit",                     "zh-Hans": "新习惯" },
  "habit.markDoneToday":  { en: "Mark done for today",           "zh-Hans": "标记为今天已完成" },
  "habit.pausedUnpause":  { en: "Paused — unpause to complete",  "zh-Hans": "已暂停——恢复后才能完成" },
  // W7: pause is a dated range, so the card and page name the day it began.
  // A bare "Paused" taught users it was a switch; the date teaches the bracket
  // they opened and will close, and makes a forgotten pause visible.
  "habit.pausedSince":    { en: "Paused since {date}",           "zh-Hans": "自 {date} 起暂停" },
  // W7: the project page could always CREATE into itself and never attach
  // something already in the app. These label the missing half.
  "project.linkExisting":     { en: "Link existing",                "zh-Hans": "关联已有项目" },
  "project.linkExistingTitle":{ en: "Link an existing action or event", "zh-Hans": "关联一个已有的行动或事件" },
  "project.nothingToLink":    { en: "Nothing to link — actions and events already attached to a project don't appear here. Move one from its own page.",
                                "zh-Hans": "没有可关联的项目——已归属某个项目的行动和事件不会出现在这里。请在它自己的页面上移动它。" },
  "project.removeFromProject":{ en: "Remove from this project",     "zh-Hans": "从此项目中移除" },
  "group.deleteList":     { en: "Delete list",                   "zh-Hans": "删除列表" },
  "note.emptyNoNotes":    { en: "No notes yet.",                 "zh-Hans": "还没有笔记。" },
  "note.emptyForFilter":  { en: "No notes for this filter.",     "zh-Hans": "没有符合此筛选条件的笔记。" },
  "cal.afterProjectDeadline": { en: "This is scheduled after the project deadline.",
                                "zh-Hans": "这个安排晚于项目的截止日期。" },
  "confirm.deleteTitleQuestion": { en: "Delete “{title}”?",           "zh-Hans": "删除“{title}”吗？" },

  // ---- date & time pickers ----
  "picker.selectTime":          { en: "Select time",                 "zh-Hans": "选择时间" },
  "picker.chooseTime":          { en: "Choose a time",                "zh-Hans": "选择一个时间" },
  "picker.hour":                 { en: "Hour",                       "zh-Hans": "小时" },
  "picker.minute":               { en: "Minute",                     "zh-Hans": "分钟" },
  "picker.clear":                 { en: "Clear",                     "zh-Hans": "清除" },
  "picker.cancel":                 { en: "Cancel",                   "zh-Hans": "取消" },
  "picker.set":                     { en: "Set",                     "zh-Hans": "设置" },
  "picker.selectDate":              { en: "Select date",              "zh-Hans": "选择日期" },
  "picker.chooseDate":              { en: "Choose a date",            "zh-Hans": "选择一个日期" },
  "picker.previousMonth":            { en: "Previous month",         "zh-Hans": "上个月" },
  "picker.nextMonth":                { en: "Next month",             "zh-Hans": "下个月" },
  "picker.today":                    { en: "Today",                   "zh-Hans": "今天" },
  "picker.am":                       { en: "AM",                      "zh-Hans": "上午" },
  "picker.pm":                       { en: "PM",                      "zh-Hans": "下午" },

  // ---- default contexts + habits (author QA: "a bigger problem" than the
  // disposable sample data — these are the starter kit, not throwaway demo
  // content, so they get the tutorial's id-stable seed+restamp treatment). ----
  "seed.context.computer":   { en: "Computer",                       "zh-Hans": "电脑" },
  "seed.context.calls":      { en: "Calls",                          "zh-Hans": "电话" },
  "seed.context.errands":    { en: "Errands",                        "zh-Hans": "外出办事" },
  "seed.habit.sortTray.title": { en: "Sort my tray",                 "zh-Hans": "整理我的收件箱" },
  "seed.habit.sortTray.notes": { en: "Someone who doesn’t carry their to-do list around in their head.", "zh-Hans": "一个不把待办清单一直放在脑子里的人。" },
  "seed.habit.sortTray.cue":  { en: "When I sit down at my desk",    "zh-Hans": "当我坐到桌前时" },
  "seed.habit.reviewCal.title": { en: "Review my calendar and waiting actions", "zh-Hans": "回顾我的日历和等待项" },
  "seed.habit.reviewCal.notes": { en: "Someone who knows what’s coming, instead of being surprised by it.", "zh-Hans": "一个知道接下来会发生什么、而不是被打个措手不及的人。" },
  "seed.habit.reviewProj.title": { en: "Review my projects",          "zh-Hans": "回顾我的项目" },
  "seed.habit.reviewProj.notes": { en: "Someone who finishes what they start.", "zh-Hans": "一个能把开始的事情做完的人。" },
  "seed.habit.reviewProj.cue":  { en: "After my Friday coffee",       "zh-Hans": "周五喝完咖啡之后" },

  // ---- service worker update banner (chunk 9) ----
  "sw.updateBanner.message": { en: "New version available",          "zh-Hans": "有新版本可用" },
  "sw.updateBanner.reload":  { en: "Reload",                         "zh-Hans": "重新加载" },

  // ---- Dropbox sync (W5, wrapper-plan.md). Wrapper-only -- this whole row
  // is hidden in a plain browser tab, so these strings only ever render
  // inside the installed app. ⚑ zh-Hans below is my own pass, not a
  // native-speaker review like the tutorial/info-button copy got — flagged
  // rather than presented as equally vetted. "Dropbox" itself stays
  // untranslated, same treatment as "OELA". ----
  // Sync failure reasons. Thrown as KEYS by the transports so the status line
  // can translate them; see the header comment in dropboxTransport.js.
  "err.sync.wrapperOnly":     { en: "Sync is only available in the installed app", "zh-Hans": "同步仅在已安装的应用中可用" },
  "err.sync.noFolder":        { en: "No Dropbox folder connected",     "zh-Hans": "未连接 Dropbox 文件夹" },
  "err.sync.noFolderChosen":  { en: "No folder was chosen",            "zh-Hans": "未选择文件夹" },
  "err.sync.fileKeptChanging":{ en: "The sync file kept changing — try again shortly", "zh-Hans": "同步文件一直在变动——请稍后重试" },
  "err.sync.tooManyWrites":   { en: "Too many conflicting writes in a row — try again shortly", "zh-Hans": "连续出现过多写入冲突——请稍后重试" },
  "err.sync.downloadFailed":  { en: "Couldn’t read the sync file from Dropbox", "zh-Hans": "无法从 Dropbox 读取同步文件" },
  "err.sync.uploadFailed":    { en: "Couldn’t write the sync file to Dropbox",  "zh-Hans": "无法向 Dropbox 写入同步文件" },
  // The attempt watchdog. Thrown in app.js rather than a transport (it is what
  // guards against a transport that never answers at all), which is how it got
  // missed when the rest of these became keys.
  "err.sync.timedOut":        { en: "Sync timed out — will try again",  "zh-Hans": "同步超时——稍后会重试" },
  "sync.connect":            { en: "Connect Dropbox",                "zh-Hans": "连接 Dropbox" },
  "sync.disconnect":         { en: "Disconnect",                     "zh-Hans": "断开连接" },
  "sync.now":                { en: "Sync now",                       "zh-Hans": "立即同步" },
  "sync.syncing":            { en: "Syncing…",                       "zh-Hans": "同步中…" },
  "sync.notYetSynced":       { en: "Not yet synced",                 "zh-Hans": "尚未同步过" },
  "sync.justNow":            { en: "Synced just now",                "zh-Hans": "刚刚同步过" },
  "sync.minutesOne":         { en: "Synced 1 minute ago",            "zh-Hans": "1 分钟前同步过" },
  "sync.minutesMany":        { en: "Synced {n} minutes ago",         "zh-Hans": "{n} 分钟前同步过" },
  "sync.hoursOne":           { en: "Synced 1 hour ago",               "zh-Hans": "1 小时前同步过" },
  "sync.hoursMany":          { en: "Synced {n} hours ago",            "zh-Hans": "{n} 小时前同步过" },
  "sync.daysOne":            { en: "Synced 1 day ago",                "zh-Hans": "1 天前同步过" },
  "sync.daysMany":           { en: "Synced {n} days ago",             "zh-Hans": "{n} 天前同步过" },
  "sync.error":              { en: "Last attempt failed — will try again",
                               "zh-Hans": "上次同步失败——稍后会重试" },
  "sync.conflictsOne":       { en: "1 item changed on both devices — tap to review",
                               "zh-Hans": "有 1 项在两台设备上都被修改——点击查看" },
  "sync.conflictsMany":      { en: "{n} items changed on both devices — tap to review",
                               "zh-Hans": "有 {n} 项在两台设备上都被修改——点击查看" },
  "sync.conflictsTitle":     { en: "Changed on both devices",         "zh-Hans": "两台设备上都有修改" },
  "sync.conflictsEmpty":     { en: "Nothing to review right now.",    "zh-Hans": "目前没有需要查看的内容。" },
  "sync.conflictsIntro":     { en: "Each of these changed on two devices before they could sync with each other. The newer change was kept automatically; the older one is what changed here.",
                               "zh-Hans": "以下内容在两台设备上分别被修改，且尚未来得及互相同步。系统自动保留了较新的修改；下面列出的是被替换掉的较早修改。" },
  "sync.conflictKept":       { en: "kept: “{text}”",                  "zh-Hans": "保留：“{text}”" },
  "sync.conflictReplaced":   { en: "replaced: “{text}”",              "zh-Hans": "替换掉：“{text}”" },
  "sync.resurrection":       { en: "This was deleted on one device but changed on the other — the change won, so it's back.",
                               "zh-Hans": "这项内容在一台设备上被删除，但在另一台设备上被修改——修改被保留，因此它又出现了。" },
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
  // Starter-kit contexts/habits carry their own seedKey (seedData) — restamp
  // them the same way, before the lanes re-render below.
  if (typeof restampSeedDefaults === "function") restampSeedDefaults();
  if (typeof renderShell === "function") renderShell();
  if (typeof renderTabLabels === "function") renderTabLabels();
  if (typeof renderSwUpdateBannerLabels === "function") renderSwUpdateBannerLabels();
  // The footer line lives in index.html's markup, so nothing else repaints it.
  if (typeof applyFooterNote === "function") applyFooterNote();
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

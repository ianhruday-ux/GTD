/* ============================================================
 * timepicker.js — the app's own time picker (bug #2, QA #15)
 *
 * WHY THIS EXISTS. The complaint was that you cannot tell which of AM/PM is
 * selected. Last round that was answered with "those buttons belong to your
 * phone's picker, not to the app" — true, and exactly the problem: the control
 * was not ours to fix. Styling could not reach it, so the fix is to stop
 * borrowing it. User ruling: the full picker, matching the reference shot —
 * hour/minute boxes, a draggable dial, and AM/PM as a filled pill.
 *
 * WHAT IT REPLACES. Every <input type="time"> in the app (class .screen-time)
 * becomes a readonly text field that opens this. The field's VALUE FORMAT is
 * unchanged — 24-hour "HH:MM" — so every existing reader (deadline.time,
 * event time, the calendar creation row) keeps working untouched. Only the way
 * you enter it changed.
 *
 * ⚑ Flagged: the field still DISPLAYS 24-hour, because the rest of the app
 * does (agenda rows read "09:00", "14:30"). The picker itself is 12-hour with
 * AM/PM, as ruled. If you would rather the fields read "2:30 PM" too, that is a
 * display pass across the agenda, the cards and the review — say so and it is
 * its own round.
 *
 * NOT the date picker. The native date field still circles the real day (the
 * unfixable half of bug #3); this shell is what a date picker would be built
 * on, but that is a separate piece of work.
 * ============================================================ */

// Parse "HH:MM" (24h) into the picker's working state. Anything unparseable —
// including the empty string a blank field carries — starts at 9:00 AM rather
// than midnight: a blank time is far more often a morning appointment than one
// at 00:00, and starting on the hour hand means one drag sets a usable time.
function timeParse(value){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return { h24: 9, min: 0 };
  let h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  let mi = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return { h24: h, min: mi };
}
function timeFormat24(h24, min){
  return String(h24).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}
// 24h -> the 12h face number (12, 1..11) the dial actually shows.
function to12(h24){ const h = h24 % 12; return h === 0 ? 12 : h; }
function isPm(h24){ return h24 >= 12; }
// (face number, am/pm) -> 24h. 12 AM is 0; 12 PM is 12; everything else adds 12
// for PM. Getting this wrong is the classic off-by-twelve, so it lives in one
// place and both the dial and the pills go through it.
function from12(face, pm){
  const f = face % 12;               // 12 -> 0
  return pm ? f + 12 : f;
}

const TIME_PICKER_STYLE_ID = "oela-timepicker-styles";
const TIME_PICKER_CSS = `
.tp-backdrop{
  position:fixed; inset:0; z-index:400;
  background:rgba(0,0,0,0.62);
  display:flex; align-items:center; justify-content:center; padding:18px;
}
.tp-card{
  width:100%; max-width:330px;
  background:var(--paper, #262420); color:var(--text-primary, #EDE7DA);
  border:1px solid rgba(255,255,255,0.12); border-radius:16px;
  box-shadow:var(--paper-shadow, 0 6px 14px rgba(0,0,0,0.5));
  padding:16px 16px 12px;
}
.tp-title{
  font-family:var(--font-mono, monospace); font-size:10px; letter-spacing:0.09em;
  text-transform:uppercase; color:var(--text-soft, #A79E8C); margin-bottom:10px;
}
/* ---- readout: HH : MM + AM/PM ---- */
.tp-readout{ display:flex; align-items:center; gap:8px; margin-bottom:14px; }
.tp-unit{
  flex:0 0 auto; width:76px; height:62px; border-radius:10px;
  border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.05);
  color:var(--text-primary, #EDE7DA);
  font-family:var(--font-display, sans-serif); font-weight:700; font-size:34px;
  display:flex; align-items:center; justify-content:center;
}
/* The ACTIVE unit is the one the dial is editing. Brass fill, not a hairline —
   this is the same "which one is selected" problem the AM/PM pills had. */
.tp-unit.active{
  background:var(--brass, #C68A3E); color:var(--dark-on-accent, #1a1408);
  border-color:var(--brass, #C68A3E);
}
.tp-colon{ font-family:var(--font-display, sans-serif); font-weight:700; font-size:30px; opacity:0.7; }
.tp-ampm{ display:flex; flex-direction:column; gap:5px; margin-left:4px; }
.tp-ampm button{
  width:58px; padding:7px 0; border-radius:9px;
  border:1px solid rgba(255,255,255,0.22); background:transparent;
  color:var(--text-soft, #A79E8C);
  font-family:var(--font-mono, monospace); font-size:12px; font-weight:700; letter-spacing:0.06em;
}
/* THE FIX. Filled, not outlined — legible at a glance in a dark room, which
   the borrowed control was not. */
.tp-ampm button.active{
  background:var(--brass, #C68A3E); color:var(--dark-on-accent, #1a1408);
  border-color:var(--brass, #C68A3E);
}
/* ---- dial ---- */
.tp-dial{
  position:relative; width:236px; height:236px; margin:0 auto 6px;
  border-radius:50%; background:rgba(255,255,255,0.05);
  touch-action:none; user-select:none;
}
.tp-hand{
  position:absolute; left:50%; top:50%; height:2px;
  background:var(--brass, #C68A3E); transform-origin:0 50%;
  border-radius:2px; pointer-events:none;
}
.tp-hub{
  position:absolute; left:50%; top:50%; width:7px; height:7px; margin:-3.5px 0 0 -3.5px;
  border-radius:50%; background:var(--brass, #C68A3E); pointer-events:none;
}
.tp-knob{
  position:absolute; width:36px; height:36px; margin:-18px 0 0 -18px;
  border-radius:50%; background:var(--brass, #C68A3E); pointer-events:none;
}
.tp-num{
  position:absolute; width:34px; height:34px; margin:-17px 0 0 -17px;
  display:flex; align-items:center; justify-content:center;
  font-family:var(--font-body, sans-serif); font-size:14.5px; font-weight:600;
  color:var(--text-primary, #EDE7DA); pointer-events:none; border-radius:50%;
}
.tp-num.on{ color:var(--dark-on-accent, #1a1408); }
/* ---- footer ---- */
.tp-btns{ display:flex; align-items:center; gap:8px; margin-top:8px; }
.tp-btns .tp-spacer{ flex:1; }
.tp-btns button{
  border:none; background:transparent; color:var(--brass, #C68A3E);
  font-family:var(--font-body, sans-serif); font-weight:600; font-size:14px;
  padding:9px 13px; border-radius:8px;
}
.tp-btns button:hover{ background:rgba(255,255,255,0.07); }
.tp-btns button.tp-clear{ color:var(--text-soft, #A79E8C); }
@media (prefers-reduced-motion: no-preference){
  .tp-knob, .tp-hand{ transition:transform .12s ease, left .12s ease, top .12s ease; }
}
`;

function ensureTimePickerStyles(){
  if (document.getElementById(TIME_PICKER_STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = TIME_PICKER_STYLE_ID;
  st.textContent = TIME_PICKER_CSS;
  document.head.appendChild(st);
}

/* Opens the picker.
 *   value    "HH:MM" or "" — what the field currently holds
 *   opts     { allowClear: bool }
 *   onDone   called with "HH:MM", or "" if cleared. NOT called on cancel.
 */
function openTimePicker(value, opts, onDone){
  ensureTimePickerStyles();
  const options = opts || {};
  const start = timeParse(value);
  let face = to12(start.h24);        // 12, 1..11 — what the dial shows
  let min = start.min;
  let pm = isPm(start.h24);
  let mode = "hour";                 // which unit the dial is editing

  const RADIUS = 118, NUM_R = 92;    // dial radius, and where the numbers sit

  const root = document.getElementById("dialog-root");
  root.innerHTML =
    '<div class="tp-backdrop" role="dialog" aria-modal="true" aria-label="Choose a time">' +
      '<div class="tp-card">' +
        '<div class="tp-title">Select time</div>' +
        '<div class="tp-readout">' +
          '<button type="button" class="tp-unit" data-tp="hour" aria-label="Hour"></button>' +
          '<span class="tp-colon">:</span>' +
          '<button type="button" class="tp-unit" data-tp="minute" aria-label="Minute"></button>' +
          '<div class="tp-ampm">' +
            '<button type="button" data-tp="am">AM</button>' +
            '<button type="button" data-tp="pm">PM</button>' +
          '</div>' +
        '</div>' +
        '<div class="tp-dial" data-tp="dial">' +
          '<div class="tp-hand"></div><div class="tp-knob"></div><div class="tp-hub"></div>' +
        '</div>' +
        '<div class="tp-btns">' +
          (options.allowClear ? '<button type="button" class="tp-clear" data-tp="clear">Clear</button>' : "") +
          '<span class="tp-spacer"></span>' +
          '<button type="button" data-tp="cancel">Cancel</button>' +
          '<button type="button" data-tp="set">Set</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  const backdrop = root.querySelector(".tp-backdrop");
  const dial = root.querySelector(".tp-dial");
  const hand = root.querySelector(".tp-hand");
  const knob = root.querySelector(".tp-knob");
  const hourBtn = root.querySelector('[data-tp="hour"]');
  const minBtn = root.querySelector('[data-tp="minute"]');
  const amBtn = root.querySelector('[data-tp="am"]');
  const pmBtn = root.querySelector('[data-tp="pm"]');

  // The numbers are redrawn per mode: 1..12 for hours, 00..55 by fives for
  // minutes. Minutes still SELECT to the nearest single minute when you drag —
  // the labels are every five only because sixty of them is unreadable.
  function faceValues(){
    if (mode === "hour") return [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    return [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  }
  function drawNumbers(){
    Array.prototype.slice.call(dial.querySelectorAll(".tp-num")).forEach(function(n){ n.remove(); });
    const vals = faceValues();
    vals.forEach(function(v, i){
      const ang = (i * 30 - 90) * Math.PI / 180;   // slot 0 at the top
      const el = document.createElement("div");
      el.className = "tp-num";
      el.textContent = mode === "hour" ? String(v) : String(v).padStart(2, "0");
      el.style.left = (RADIUS + Math.cos(ang) * NUM_R) + "px";
      el.style.top = (RADIUS + Math.sin(ang) * NUM_R) + "px";
      el.setAttribute("data-val", String(v));
      dial.appendChild(el);
    });
  }
  // The angle the hand points at, in slot units (0..11.999 from the top).
  function currentSlot(){
    if (mode === "hour") return (face % 12);
    return min / 5;
  }
  function render(){
    hourBtn.textContent = String(face);
    minBtn.textContent = String(min).padStart(2, "0");
    hourBtn.classList.toggle("active", mode === "hour");
    minBtn.classList.toggle("active", mode === "minute");
    amBtn.classList.toggle("active", !pm);
    pmBtn.classList.toggle("active", pm);

    const slot = currentSlot();
    const deg = slot * 30 - 90;
    hand.style.width = (NUM_R - 16) + "px";
    hand.style.transform = "rotate(" + deg + "deg)";
    const ang = deg * Math.PI / 180;
    knob.style.left = (RADIUS + Math.cos(ang) * NUM_R) + "px";
    knob.style.top = (RADIUS + Math.sin(ang) * NUM_R) + "px";

    // Highlight the label under the knob, when one is exactly there.
    Array.prototype.slice.call(dial.querySelectorAll(".tp-num")).forEach(function(n){
      const v = parseInt(n.getAttribute("data-val"), 10);
      const on = mode === "hour" ? (v % 12) === (face % 12) : v === min;
      n.classList.toggle("on", on);
    });
  }
  function redraw(){ drawNumbers(); render(); }

  // Pointer -> value. Hours snap to the 12 slots; minutes snap to the nearest
  // MINUTE, not the nearest label, so the dial can express 14:37.
  function applyPointer(ev){
    const r = dial.getBoundingClientRect();
    const dx = ev.clientX - (r.left + r.width / 2);
    const dy = ev.clientY - (r.top + r.height / 2);
    if (dx === 0 && dy === 0) return;
    let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;   // 0 at the top
    if (deg < 0) deg += 360;
    if (mode === "hour"){
      const slot = Math.round(deg / 30) % 12;
      face = slot === 0 ? 12 : slot;
    } else {
      min = Math.round(deg / 6) % 60;
    }
    render();
  }

  let dragging = false;
  function onDown(ev){ dragging = true; dial.setPointerCapture && dial.setPointerCapture(ev.pointerId); applyPointer(ev); }
  function onMove(ev){ if (dragging) applyPointer(ev); }
  function onUp(ev){
    if (!dragging) return;
    dragging = false;
    // Picking an hour advances to minutes, the way the reference picker does —
    // it is the near-universal next thing you want, and it saves a tap.
    if (mode === "hour"){ mode = "minute"; redraw(); }
  }
  dial.addEventListener("pointerdown", onDown);
  dial.addEventListener("pointermove", onMove);
  dial.addEventListener("pointerup", onUp);
  dial.addEventListener("pointercancel", function(){ dragging = false; });

  function finish(result){
    document.removeEventListener("keydown", onKey, true);
    root.innerHTML = "";
    if (result !== null && onDone) onDone(result);
  }
  // ⚠ CAPTURE phase, and the event is stopped. The picker is a layer ON TOP of
  // a screen that has its own Escape handling: without this, one Escape closed
  // the picker AND the calendar underneath it, so cancelling a time threw away
  // the page you were on. (Found by the check, not by reading.) Enter is
  // swallowed for the same reason — it must not reach a form behind us.
  function onKey(e){
    if (e.key === "Escape"){
      e.preventDefault(); e.stopPropagation(); finish(null);
    } else if (e.key === "Enter"){
      e.preventDefault(); e.stopPropagation(); finish(timeFormat24(from12(face, pm), min));
    }
  }
  document.addEventListener("keydown", onKey, true);

  backdrop.addEventListener("click", function(e){ if (e.target === backdrop) finish(null); });
  root.addEventListener("click", function(e){
    const btn = e.target.closest("[data-tp]");
    if (!btn) return;
    const what = btn.getAttribute("data-tp");
    if (what === "hour"){ mode = "hour"; redraw(); }
    else if (what === "minute"){ mode = "minute"; redraw(); }
    else if (what === "am"){ pm = false; render(); }
    else if (what === "pm"){ pm = true; render(); }
    else if (what === "cancel") finish(null);
    else if (what === "clear") finish("");
    else if (what === "set") finish(timeFormat24(from12(face, pm), min));
  });

  redraw();
}

/* Field wiring. The inputs stay in the DOM and keep their name, class and value
 * format; they are simply no longer typed into directly. `readonly` is what
 * stops the phone's own picker from opening on top of ours.
 *
 * ⚠ The change is dispatched as a real `input` + `change` event so the app's
 * existing delegated handlers (which listen for those on [data-field] /
 * [data-calfield]) run exactly as they did when the native picker committed a
 * value. Setting .value alone would update the box and silently drop the write.
 */
function timePickerFieldValue(el){ return el.value || ""; }
function initTimePickerFields(){
  document.addEventListener("mousedown", function(e){
    const el = e.target.closest && e.target.closest("input.screen-time");
    if (el) e.preventDefault();          // never focus it; the picker is the UI
  }, true);
  document.addEventListener("click", function(e){
    const el = e.target.closest && e.target.closest("input.screen-time");
    if (!el || el.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    openTimePicker(timePickerFieldValue(el), { allowClear: true }, function(next){
      el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }, true);
}

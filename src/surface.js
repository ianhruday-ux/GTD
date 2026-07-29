// =========================================================
// THE DESK SURFACE — procedural wood grain (post-sprint, §P1/§P2)
//
// The desk texture used to be a hand-tuned feTurbulence data URI: fractal
// noise at baseFrequency "0.9 0.010", which stretches noise into horizontal
// streaks. Streaks are not grain. Real wood has *growth rings* — roughly
// parallel bands, warped by the tree's own irregularity — and a fibre texture
// running along them. Noise alone can't produce rings, however it is stretched,
// because rings are a periodic function that noise *displaces*; that is the
// whole trick, and it is Perlin's own (the "wood" example in his 1985 paper,
// the same construction as his marble).
//
//   ring coordinate  r = v·RINGS + warp(u,v)      ← noise displaces the bands
//   ring line        d = |2·frac(r) − 1|          ← triangle wave, 0 mid-band
//   fibre            f = fbm stretched along the grain
//
// So: real Perlin noise (gradient noise, fade curve, permutation table), used
// as the displacement inside a periodic ring function. Not feTurbulence.
//
// TILEABLE BY CONSTRUCTION. The tile repeats across the whole viewport, so a
// seam would be visible as a grid. Every lattice coordinate is wrapped modulo
// a per-axis period, and each octave doubles that period alongside its
// frequency — which makes the noise exactly periodic over the tile, so the
// edges match with no blending or mirroring.
//
// Generated at boot into a data URI and handed to CSS as --wood, which is
// where the old base64 string used to sit; nothing downstream changed.
// =========================================================

// ---- Perlin gradient noise, seeded and periodic ----------------------------
function makePerlin(seed){
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // mulberry32: a seeded shuffle, so a given background always looks the same
  // (a texture that changed on every boot would read as a rendering bug).
  let s = seed >>> 0;
  function rnd(){
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  for (let i = 255; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function fade(t){ return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  // 4 diagonal gradients — enough in 2D, and branch-free-ish
  function grad(h, x, y){
    switch (h & 3){
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  }
  // perX/perY are the lattice periods: the noise repeats exactly every perX
  // units in x and perY in y, which is what makes the tile seamless.
  return function noise(x, y, perX, perY){
    let X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    X = ((X % perX) + perX) % perX;
    Y = ((Y % perY) + perY) % perY;
    const X1 = (X + 1) % perX, Y1 = (Y + 1) % perY;
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y1];
    const ba = perm[perm[X1] + Y], bb = perm[perm[X1] + Y1];
    const r1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const r2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(r1, r2, v); // ~[-1, 1]
  };
}

// Fractal sum. Frequencies are integers and double per octave, so the periods
// double with them and the whole sum stays tileable.
function fbm(noise, u, v, fx, fy, octaves){
  let sum = 0, amp = 1, norm = 0, ax = fx, ay = fy;
  for (let i = 0; i < octaves; i++){
    sum += amp * noise(u * ax, v * ay, ax, ay);
    norm += amp;
    amp *= 0.5; ax *= 2; ay *= 2;
  }
  return sum / norm; // ~[-1, 1]
}

// ---- the palettes ---------------------------------------------------------
// Each is the same construction with different constants — which is the point
// of building it procedurally rather than shipping four baked PNGs.
//   rings  how many growth rings cross the tile
//   warp   how far the noise displaces them (0 = drawn with a ruler)
//   fibre  weight of the along-grain streaking
//   seed   which tree
// ⚑ Walnut, Oak and Ebony are GONE (user: "remove the original wood
// backgrounds"). They were the drawn woods this file was written for, and the
// generator below still earns its place — Slate uses it (rings:0, so stone
// rather than timber) and it is what a future drawn surface would use. But as
// WOOD they were superseded the moment real photographs arrived: no ring
// function produces knots or a bookmatched veneer, and side by side that showed.
//
// No migration. loadSurfaceId() already validates the stored id against this
// table and falls back to the default, so anyone sitting on 'walnut' quietly
// lands on Dark wood instead. That is the behaviour a migration would have had
// to hand-write anyway.
// \u2691 The picker used to render SURFACES[id].label raw, so the five background
// names were the last English strings in the settings menu. The table keeps its
// literal as a fallback; surfaceLabel() prefers the translation and is resolved
// at call time, so a language switch is picked up like everything else.
function surfaceLabel(id){
  const key = "surface." + id;
  const s = t(key);
  return (s && s !== key) ? s : ((SURFACES[id] && SURFACES[id].label) || id);
}
const SURFACES = {
  slate:  { label: "Slate", desk: "#15161A", dark: "#0E0F13", mid: "#1A1C21", light: "#292C33",
            rings: 0, warp: 0.0,  ringDepth: 0.0,  fibre: 0.55, seed: 5 },  // rings:0 → stone, not wood
  plain:  { label: "Plain", desk: "#171513", flat: true },
  // ⚑ PHOTOGRAPHS, not drawn (user-supplied). A `photo` surface skips the
  // generator entirely and hands its baked tile straight to CSS. Real wood has
  // figure — knots, medullary rays, the mirrored bookmatch down the centre of a
  // veneer — that a ring function does not produce and should not fake. The
  // drawn surfaces above stay because they cost nothing and tile forever.
  // Tones are sampled from each image (see textures.js) so the picker's swatch
  // is an honest ramp of that surface's own colours rather than a guess.
  darkwood: { label: "Dark wood", desk: "#2c160d", dark: "#1f0d09", mid: "#2d160e", light: "#361f12",
              photo: TEX_DARK_WOOD },
  rosewood: { label: "Rosewood", desk: "#6d3210", dark: "#57230b", mid: "#6f330f", light: "#7d3f16",
              photo: TEX_ROSEWOOD },
  // ⚑ The one surface that is more than a texture (user). Black lacquer, a gold
  // leaf key-fret frame around the viewport, and a jade inlay down the intray
  // drawer's inner edge. `frame` and `jade` are what make it different; nothing
  // else in the picker sets them, and everything is a no-op without them.
  lacquer: { label: "Black lacquer", desk: "#0a0908", dark: "#050404", mid: "#0d0b09", light: "#241a10",
             lacquer: true, frame: true, jade: true }
};

// ---- Black lacquer -------------------------------------------------------
// Lacquer is many thin polished coats over a dark ground. It is NOT wood: no
// rings, no fibre. What makes it read as lacquer is depth — a very low black
// floor with a narrow, warm specular catch on top.
//
// ⚑ Tuned by looking at it. A first attempt sat around 0.10–0.26 luminance with
// a broad soft sheen and read as grey concrete; the fix was to drop the floor to
// ~0.02 and raise a much tighter highlight (the pow(...,3.2)), then warm ONLY
// the highlight. Black lacquer picks up an amber note where light catches it,
// and stays near-neutral in shadow — that split is the whole difference between
// lacquer and a board painted black.
function renderLacquerTile(N){
  const cv = document.createElement("canvas");
  cv.width = N; cv.height = N;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(N, N), d = img.data;
  const noise = makePerlin(3);
  for (let y = 0; y < N; y++){
    const v = y / N;
    for (let x = 0; x < N; x++){
      const u = x / N;
      const broad = fbm(noise, u, v, 2, 2, 3);    // where the light sits at all
      const spec  = fbm(noise, u, v, 6, 6, 4);    // the polished catch
      const grit  = fbm(noise, u, v, 90, 90, 2);  // dust in the finish
      const s = Math.pow(Math.max(0, spec * 0.65 + broad * 0.35), 3.2);
      let L = 0.022 + 0.30 * s + 0.012 * (grit - 0.5);
      L = Math.max(0, Math.min(1, L));
      const warm = Math.pow(Math.min(1, L / 0.32), 1.4);
      const o = (y * N + x) * 4;
      d[o]     = Math.round(255 * Math.min(1, L * (1.00 + 0.55 * warm)));
      d[o + 1] = Math.round(255 * Math.min(1, L * (0.86 + 0.30 * warm)));
      d[o + 2] = Math.round(255 * Math.min(1, L * (0.80 + 0.10 * warm)));
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/jpeg", 0.80);
}

// ---- Jade ----------------------------------------------------------------
// A narrow vertical strip, tiled down the drawer's inner edge. Jade reads as
// jade because it is TRANSLUCENT and unevenly so: cloudy pale veins drifting
// through a deeper green, not a flat colour with a highlight.
function renderJadeTile(w, h){
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(w, h), d = img.data;
  const noise = makePerlin(61);
  for (let y = 0; y < h; y++){
    const v = y / h;
    for (let x = 0; x < w; x++){
      const u = x / w;
      // Stretched along the strip so the cloudiness runs with it, not across.
      const cloud = fbm(noise, u, v, 2, 5, 4);
      const vein  = fbm(noise, u, v, 5, 13, 3);
      const t = Math.max(0, Math.min(1, 0.42 + 0.75 * (cloud - 0.5) + 0.35 * (vein - 0.5)));
      // deep green -> pale celadon, with the pale end desaturating rather than
      // just brightening, which is what stops it looking like plastic.
      const o = (y * h === 0 ? 0 : 0) + (y * w + x) * 4;
      d[o]     = Math.round(28 + 168 * Math.pow(t, 1.6));
      d[o + 1] = Math.round(74 + 150 * Math.pow(t, 1.1));
      d[o + 2] = Math.round(58 + 128 * Math.pow(t, 1.3));
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/jpeg", 0.82);
}
let jadeTileCache = null;
function jadeTile(){
  if (!jadeTileCache) jadeTileCache = renderJadeTile(16, 192);
  return jadeTileCache;
}
// Dark wood inherits the default from Walnut: nearest in tone to what the app
// has always opened on, and the one anybody stored as "walnut" now falls back to.
const DEFAULT_SURFACE = "darkwood";
// 512 rather than 256: at 256 the same ring wave recurs every 256px down the
// page and the eye locks onto the repeat immediately. Doubling it quarters how
// often that happens for ~40ms more generation, paid once at boot.
const SURFACE_TILE = 512;

function hexToRgb(h){
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function smoothstep(a, b, x){
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Render one seamless tile and return it as a PNG data URI. `size` and
// `ringsOverride` exist for the picker's chip: a 512px tile shrunk into a 20px
// swatch averages its own grain away and every surface comes out an identical
// dark square, so the chip is rendered small with only a couple of rings in it
// — a stylised sample of the material, like a paint chip, not a literal crop.
function renderSurfaceTile(cfg, size, ringsOverride){
  const N = size || SURFACE_TILE;
  const rings = (ringsOverride == null) ? cfg.rings : ringsOverride;
  const cv = document.createElement("canvas");
  cv.width = N; cv.height = N;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const noise = makePerlin(cfg.seed);
  const dark = hexToRgb(cfg.dark), mid = hexToRgb(cfg.mid), light = hexToRgb(cfg.light);

  for (let y = 0; y < N; y++){
    const v = y / N;
    for (let x = 0; x < N; x++){
      const u = x / N;
      // (1) The warp: a slow, large-scale wander, five octaves so it bends at
      //     several scales at once. This is what stops the rings looking
      //     printed — it is the tree not growing straight.
      const warp = fbm(noise, u, v, 2, 3, 5);
      // (2) The fibre: stretched hard along the grain (low frequency across the
      //     plank, high along it) — the long capillary streaking that carries
      //     most of the "this is a cut surface" reading.
      const fibre = fbm(noise, u, v, 3, 64, 4);
      // (3) Pores: fine, short, high-frequency flecks.
      const pore = fbm(noise, u, v, 16, 128, 2);
      // Base tone first — the plank is not one flat colour before the rings
      // arrive. Rings then CUT INTO it (subtractive), rather than being mixed
      // against it; mixing is what flattened this into painted stripes.
      let shade = 0.58 + cfg.fibre * fibre + 0.07 * pore;
      if (rings > 0){
        // The rings themselves: a periodic band function of the ring
        // coordinate, displaced by the warp. |2·frac(r)−1| is a triangle wave;
        // smoothstep turns its peak into a NARROW dark line rather than a soft
        // sine — a wide soft band reads as a stripe, a narrow one as timber.
        const r = v * rings + warp * cfg.warp;
        const t = r - Math.floor(r);
        const dline = Math.abs(2 * t - 1);
        // Ring lines vary in weight along their length (a real ring is not a
        // uniform stroke), driven by the same fibre field.
        const weight = 0.62 + 0.10 * fibre;
        const ring = smoothstep(weight, 1.0, dline);
        shade -= ring * cfg.ringDepth;
      }
      shade = Math.max(0, Math.min(1, shade));
      // Three-stop ramp (dark → mid → light) rather than two: a straight
      // two-colour lerp washes the midtones flat and loses the depth.
      let c0, c1, f;
      if (shade < 0.5){ c0 = dark; c1 = mid; f = shade * 2; }
      else { c0 = mid; c1 = light; f = (shade - 0.5) * 2; }
      const i = (y * N + x) * 4;
      d[i]     = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      d[i + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      d[i + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}

// =========================================================
// CHALK DUST (post-sprint §P6) — the habit runner is drawn as chalk on a
// board, and a clean board reads as printed vinyl. Same Perlin machinery as
// the desk: eraser smears are noise stretched HARD along the sweep direction
// (that is what an eraser does — it moves in arcs, not dots), with a fine
// speckle on top for the dust that never comes off.
//
// White with a varying alpha, so it composites over whatever board colour the
// theme sets rather than baking one in.
// =========================================================
const CHALK_TILE = 256;
let chalkDustUrl = null;
function renderChalkDust(){
  const N = CHALK_TILE;
  const cv = document.createElement("canvas");
  cv.width = N; cv.height = N;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const noise = makePerlin(1987);
  for (let y = 0; y < N; y++){
    const v = y / N;
    for (let x = 0; x < N; x++){
      const u = x / N;
      // Smears: LOW frequency along the sweep, high across it — an eraser
      // travels sideways, so the marks are long horizontally and thin
      // vertically. (Reversed once: high-x/low-y gave vertical streaks that
      // read as rain on a window.)
      const smear = fbm(noise, u, v, 2, 24, 3);
      // Speckle: isotropic and fine.
      const speck = fbm(noise, u, v, 48, 48, 2);
      // Only the upper tail of each field becomes visible dust, so the board
      // stays mostly clean and the marks read as occasional, not as texture.
      let a = 0;
      a += Math.max(0, smear - 0.25) * 0.10;
      a += Math.max(0, speck - 0.45) * 0.09;
      const i = (y * N + x) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
      d[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}
function applyChalkDust(){
  if (!chalkDustUrl) chalkDustUrl = renderChalkDust();
  document.documentElement.style.setProperty("--chalk-dust", 'url("' + chalkDustUrl + '")');
  document.documentElement.style.setProperty("--chalk-dust-size", CHALK_TILE + "px");
}

// ---- wiring into CSS ------------------------------------------------------
const SURFACE_KEY = "gtd_surface"; // gtd_: a preference, so "Restore to defaults" resets it too
function loadSurfaceId(){
  const id = Storage.get(SURFACE_KEY);
  return (id && SURFACES[id]) ? id : DEFAULT_SURFACE;
}
function currentSurfaceId(){ return state.surfaceId || loadSurfaceId(); }

// Each tile costs a few ms of canvas work, so they are generated once and kept
// — the picker shows every surface at once, and re-rendering four textures on
// each repaint of the menu would be visible.
const surfaceTileCache = {};
function surfaceTile(id){
  const cfg = SURFACES[id];
  if (!cfg || cfg.flat) return null;
  if (cfg.photo) return cfg.photo;   // baked: nothing to generate, nothing to cache
  if (!surfaceTileCache[id]){
    surfaceTileCache[id] = cfg.lacquer ? renderLacquerTile(SURFACE_TILE) : renderSurfaceTile(cfg);
  }
  return surfaceTileCache[id];
}

// =========================================================
// THE GOLD LEAF FRAME (user)
//
// ⚑ WHY THIS IS NOT PART OF THE TILE. Every other surface is one repeating
// image. A border baked into a repeating image is not a border — it is a grid,
// drawn every 512px down the page. So the frame is a separate fixed layer sized
// to the VIEWPORT, redrawn on resize, and it is the only thing in the app that
// works this way. It sits at z-index -1 alongside the desk, so lane content
// paints over it; `body.has-frame` pads the content in so nothing lands on the
// band in the first place.
//
// The motif is a key fret (回紋). ⚑ A first attempt drew each unit as a separate
// bracket, which is the usual way this pattern is got wrong: a real meander is
// ONE line that never lifts, spiralling in and back out so consecutive units
// interlock. A cloud scroll (雲紋) was tried alongside it and abandoned — at
// this scale it read as a row of disconnected hooks.
// =========================================================
const FRAME_INSET = 9;    // gap from the screen edge to the band
const FRAME_BAND = 20;    // the band's depth — mirrored by --frame-inset in CSS
const FRAME_STEP = 26;    // one meander unit

// Gold leaf is not a colour, it is uneven metal: the tone shifts across the
// stroke and there are skips where the leaf did not take. Flat #d4af37 is what
// makes gilding look like a highlighter pen.
function goldGradient(ctx, y, depth){
  const g = ctx.createLinearGradient(0, y, 0, y + depth);
  g.addColorStop(0, "#f6dd94");
  g.addColorStop(0.38, "#c9a24a");
  g.addColorStop(0.62, "#8c6a24");
  g.addColorStop(1, "#e3c476");
  return g;
}
// One run of meander along a band of length `len`, drawn from (0,0).
// ⚑ The step is stretched so a whole number of units fits the run exactly —
// otherwise the last unit is clipped mid-spiral, which is instantly visible at
// a corner and changes with every screen size.
function drawFretRun(ctx, len, band, seed){
  const units = Math.max(1, Math.round(len / FRAME_STEP));
  const step = len / units;
  const g = step * 0.20;
  ctx.strokeStyle = goldGradient(ctx, 0, band);
  ctx.lineWidth = 1.5;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.beginPath();
  ctx.moveTo(0, band);
  for (let i = 0; i < units; i++){
    const ox = i * step;
    ctx.lineTo(ox, g);
    ctx.lineTo(ox + step - g, g);
    ctx.lineTo(ox + step - g, band - g);
    ctx.lineTo(ox + g * 2, band - g);
    ctx.lineTo(ox + g * 2, g * 2.6);
    ctx.lineTo(ox + step - g * 2.2, g * 2.6);
    ctx.lineTo(ox + step - g * 2.2, band - g * 2.4);
    ctx.lineTo(ox + step * 0.5, band - g * 2.4);
    ctx.lineTo(ox + step * 0.5, band);
    ctx.lineTo(ox + step, band);
  }
  ctx.stroke();
}
// ▲ DESKTOP (author note 10 / trap T14): the frame has TWO geometries, and they
// must not be merged.
//
//   · MOBILE (unchanged): the canvas lives inside #main and is sized to #main's
//     own box, so the border wraps the lanes and GROWS with them as content is
//     added. A ResizeObserver on #main is what keeps it honest.
//   · DESKTOP (new): the frame goes around the WHOLE PAGE, header included, so
//     it is sized to the VIEWPORT and pinned there. #main's observer cannot see
//     a window-height change that doesn't reflow main, so the desktop path
//     listens to the window as well.
//
// One function, parameterised by host box — not two copies of the meander.
function frameHostBox(){
  const desktop = document.body && document.body.classList.contains("desktop");
  if (desktop) return { W: window.innerWidth, H: window.innerHeight, fixed: true };
  const host = document.getElementById("main");
  if (!host) return null;
  return { W: host.offsetWidth, H: host.offsetHeight, fixed: false };
}
function drawDeskFrame(){
  const cv = document.getElementById("desk-frame");
  const box = frameHostBox();
  if (!cv || !box) return;
  const cfg = SURFACES[currentSurfaceId()];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = box.W, H = box.H;
  if (!W || !H) return;
  cv.classList.toggle("frame-fixed", !!box.fixed);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width = W + "px";
  cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!cfg || !cfg.frame) return;

  const i = FRAME_INSET, b = FRAME_BAND;
  const x0 = i, y0 = i, x1 = W - i, y1 = H - i;
  const wRun = x1 - x0, hRun = y1 - y0;
  if (wRun < b * 3 || hRun < b * 3) return;   // too small to carry a border
  // Each side is the same run, rotated into place, so the motif turns every
  // corner the same way instead of four separately-fudged edges.
  const sides = [
    { x: x0, y: y0, rot: 0,            len: wRun },
    { x: x1, y: y0, rot: Math.PI / 2,  len: hRun },
    { x: x1, y: y1, rot: Math.PI,      len: wRun },
    { x: x0, y: y1, rot: -Math.PI / 2, len: hRun }
  ];
  sides.forEach(function(s, n){
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    drawFretRun(ctx, s.len, b, n);
    ctx.restore();
  });
  // A hairline inside the band, the way a real panel has a scribed line
  // separating the decorated border from the field.
  ctx.strokeStyle = goldGradient(ctx, 0, 2);
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + b + 3, y0 + b + 3, wRun - (b + 3) * 2, hRun - (b + 3) * 2);
  ctx.globalAlpha = 1;
}
// ⚑ Redrawn whenever main's box changes — which now includes the lane content
// getting longer or shorter, not just the window resizing. A ResizeObserver on
// main is the honest way to say that; the old resize/visualViewport listeners
// only knew about the window and would have left the border the wrong length
// after adding a card. Guarded on the measured size so the observer's own
// chatter costs nothing.
let lastFrameW = -1, lastFrameH = -1;
function refreshDeskFrame(){
  const box = frameHostBox();
  if (!box) return;
  if (box.W === lastFrameW && box.H === lastFrameH) return;
  lastFrameW = box.W; lastFrameH = box.H;
  drawDeskFrame();
}
// Bypasses the size guard — for when the SURFACE changed rather than the box.
function forceDeskFrame(){
  lastFrameW = -1; lastFrameH = -1;
  refreshDeskFrame();
}
function initDeskFrame(){
  const host = document.getElementById("main");
  if (host && window.ResizeObserver){
    new ResizeObserver(refreshDeskFrame).observe(host);
  }
  // ALWAYS, not as a fallback: the desktop frame is sized to the window, and a
  // window that gets shorter without reflowing #main never touches the observer.
  window.addEventListener("resize", refreshDeskFrame);
  forceDeskFrame();
}
function applySurface(id){
  const cfg = SURFACES[id] || SURFACES[DEFAULT_SURFACE];
  state.surfaceId = SURFACES[id] ? id : DEFAULT_SURFACE;
  const root = document.documentElement;
  root.style.setProperty("--desk", cfg.desk);
  root.style.setProperty("--wood-size", SURFACE_TILE + "px");
  const tile = surfaceTile(state.surfaceId);
  root.style.setProperty("--wood", tile ? 'url("' + tile + '")' : "none");
  // The framed surface pads the content in so nothing sits on the gold band,
  // and lights the jade inlay on the drawer's inner edge. Both are driven off
  // one class, so a surface without them costs nothing.
  root.style.setProperty("--frame-inset", cfg.frame ? (FRAME_INSET + FRAME_BAND + 6) + "px" : "0px");
  if (cfg.jade) root.style.setProperty("--jade", 'url("' + jadeTile() + '")');
  if (document.body) document.body.classList.toggle("has-frame", !!cfg.frame);
  forceDeskFrame();   // same viewport, different frame — the size guard would skip it
}
// The picker's swatch: the whole tile shrunk into a 20px square, which reads as
// a sample of that surface rather than four near-identical dark chips (all the
// desk colours are within a few points of each other by design).
// ⚑ Judgement call: the chip is a COLOUR sample, not a texture sample. Both
// texture options were tried and rejected by looking at them: the full tile
// shrunk to 20px averages its own grain into a flat square, and a 20px tile
// rendered directly puts the fibre frequency past Nyquist, which aliases into
// mud. These woods are all near-black by design, so a two-stop ramp of the
// surface's own tones is the most a chip that size can honestly carry.
function surfaceSwatchStyle(id){
  const cfg = SURFACES[id];
  if (!cfg) return "background:#000";
  if (cfg.flat) return "background:" + cfg.desk;
  return "background:linear-gradient(135deg," + cfg.light + " 0%," + cfg.mid + " 55%," + cfg.dark + " 100%)";
}
function setSurface(id){
  if (!SURFACES[id]) return;
  Storage.set(SURFACE_KEY, id);
  applySurface(id);
}

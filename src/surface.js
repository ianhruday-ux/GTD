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
const SURFACES = {
  walnut: { label: "Walnut", desk: "#171513", dark: "#0F0C0A", mid: "#241B15", light: "#38291D",
            rings: 7, warp: 0.55, ringDepth: 0.50, fibre: 0.30, seed: 11 },
  oak:    { label: "Oak", desk: "#1B1713", dark: "#150F08", mid: "#2C2117", light: "#453322",
            rings: 5, warp: 0.42, ringDepth: 0.42, fibre: 0.34, seed: 7 },
  ebony:  { label: "Ebony", desk: "#111010", dark: "#080707", mid: "#15120F", light: "#241E18",
            rings: 9, warp: 0.70, ringDepth: 0.55, fibre: 0.26, seed: 23 },
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
              photo: TEX_ROSEWOOD }
};
const DEFAULT_SURFACE = "walnut";
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
  if (!surfaceTileCache[id]) surfaceTileCache[id] = renderSurfaceTile(cfg);
  return surfaceTileCache[id];
}
function applySurface(id){
  const cfg = SURFACES[id] || SURFACES[DEFAULT_SURFACE];
  state.surfaceId = SURFACES[id] ? id : DEFAULT_SURFACE;
  const root = document.documentElement;
  root.style.setProperty("--desk", cfg.desk);
  root.style.setProperty("--wood-size", SURFACE_TILE + "px");
  const tile = surfaceTile(state.surfaceId);
  root.style.setProperty("--wood", tile ? 'url("' + tile + '")' : "none");
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

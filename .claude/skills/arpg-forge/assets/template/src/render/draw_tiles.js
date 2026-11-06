/**
 * Procedural floor tiles and walls. (sx, sy) is always the screen position
 * of the tile's ground centre.
 *
 * Everything here is rasterised once into cached sprites (draw_util.cached) and
 * drawn at FULL brightness; lighting.js multiplies the frame afterwards. So the
 * textures are authored as "lit" surfaces with strong value contrast: bevel
 * highlights on the edges facing the key light (screen top-left), deep grout,
 * ambient occlusion where walls meet floors.
 *
 * Wall geometry (origin = tile centre): two vertical faces hang below a top
 * diamond raised by WALL_H. The 'left' face is the one facing +y (screen
 * down-left), the 'right' face faces +x (screen down-right).
 *
 * Setting-specific look comes only from `art` (level.palette.art, built from the
 * tileset's optional `art` block by levelgen paletteFor); see resolveArt() for
 * every knob and its default. The defaults describe worn stone + torches.
 */
import { cached, blit, shade, mix, hash2, parseColor } from './draw_util.js';

export const TILE_W = 64;
export const TILE_H = 32;
export const WALL_H = 64;
/** Height of a door opening; walls above door tiles get a lintel from DOOR_H to WALL_H. */
export const DOOR_H = 48;
const HW = TILE_W / 2;
const HH = TILE_H / 2;
const PAD = 1;
const FLOOR_VARIANTS = 12;
const WALL_VARIANTS = 4;
const OUTLINE_WIDTH = 2;
const LEFT_FACE = 0.8;      // face brightness: key light from screen top-left
const RIGHT_FACE = 0.56;
const TOP_FACE = 1.0;
const CAP_H = 8;            // cap course / top trim height on wall faces
const PLINTH_H = 9;         // plinth / kick plate height
const BRICK_L = 16;         // brick length along a face (face is 32 long, so joints stay seamless)
const LIGHT_DIR = norm(-0.45, -0.9); // screen-space direction the bevels are lit from
const DEFAULT_FLOOR = ['#5a5247', '#4a4339'];
const DEFAULT_WALL = ['#6b6358', '#4e473f', '#847b6e'];

/* ------------------------------------------------------------------ */
/* Theme knobs                                                         */
/* ------------------------------------------------------------------ */

const ART_DEFAULTS = {
  floorStyle: 'flagstone',  // flagstone | cobble | concrete | plate | grate | water
  floorStyles: null,        // per floor index (palette.floors order); falls back to floorStyle
  wallStyle: 'masonry',     // masonry | rough | panel
  wallStyles: null,         // per wall index
  groutDark: 0.22,          // grout = floor colour * groutDark
  grout: null,              // explicit grout colour (overrides groutDark)
  cracks: 0.16,             // chance a slab gets a crack
  grime: 0.6,               // 0..1 dirt blotches / streaks
  stain: null,              // moss / water-stain tint (null = none)
  rust: '#6a4026',          // panel drips
  hazard: '#c09a2a',        // hazard stripes on panel kick plates / plates
  metal: '#57565a',         // brackets, chains, bolts
  runeColor: null,          // carved rune glow (default: accent)
  runes: 0.22,              // chance a wall top / plaque carries runes
  pilasterEvery: 4,         // pilaster on every Nth wall face along a run (0 = none)
  features: null,           // wall face feature weights, e.g. { niche: 0.12, runes: 0.05, damaged: 0.08 }
  accent: '#c8a050',
};
const FEATURES_BY_STYLE = {
  masonry: { niche: 0.13, runes: 0.05, damaged: 0.08 },
  rough: { niche: 0.05, damaged: 0.12 },
  panel: { vent: 0.12, screen: 0.06, damaged: 0.06 },
};
export const FEAT = Object.freeze({ NONE: 0, NICHE: 1, PILASTER: 2, RUNES: 3, DAMAGED: 4, VENT: 5, SCREEN: 6 });
const FEAT_NAMES = { niche: FEAT.NICHE, runes: FEAT.RUNES, damaged: FEAT.DAMAGED, vent: FEAT.VENT, screen: FEAT.SCREEN };

const artCache = new WeakMap();
let artSerial = 0;

/**
 * Resolve a palette's art block against the defaults (memoised per object).
 * @param {object} [art] level.palette.art
 * @returns {object} resolved knobs plus a short cache `key`
 */
export function resolveArt(art) {
  const src = art || ART_DEFAULTS;
  let r = artCache.get(src);
  if (r) return r;
  r = { ...ART_DEFAULTS, ...src };
  r.runeColor = r.runeColor || r.accent;
  r.key = `a${artSerial++}`;
  artCache.set(src, r);
  return r;
}

export function floorStyleFor(art, i) {
  return (art.floorStyles && art.floorStyles[i]) || art.floorStyle;
}

export function wallStyleFor(art, i) {
  return (art.wallStyles && art.wallStyles[i]) || art.wallStyle;
}

/** Face-feature weights for a wall style (theme override or style default). */
export function featureTable(art, wallStyle) {
  const t = art.features || FEATURES_BY_STYLE[wallStyle] || FEATURES_BY_STYLE.masonry;
  return Object.entries(t).filter(([k]) => FEAT_NAMES[k]).map(([k, w]) => [FEAT_NAMES[k], w]);
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function norm(x, y) {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** Deterministic float stream for one sprite. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function tone(color, m) {
  return shade(color, 15, m);
}

export function rgba(color, a) {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${a})`;
}

/** Iso tile-local (a, b in -0.5..0.5) to screen offset. */
function iso(a, b, lift = 0) {
  return [(a - b) * HW, (a + b) * HH - lift];
}

function path(c, pts) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}

function diamondPath(c, lift = 0) {
  path(c, [iso(-0.5, -0.5, lift), iso(0.5, -0.5, lift), iso(0.5, 0.5, lift), iso(-0.5, 0.5, lift)]);
}

/**
 * Bevel a closed screen-space polygon: every edge gets a highlight or shadow
 * depending on how its outward normal faces LIGHT_DIR. Call while clipped to the polygon
 * so only the inner half of each stroke shows.
 */
export function bevel(c, pts, width, hi, lo) {
  // winding sign so normals point outward
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const sgn = area > 0 ? 1 : -1;
  c.lineWidth = width * 2;
  c.lineCap = 'round';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const [nx, ny] = norm((q[1] - p[1]) * sgn, -(q[0] - p[0]) * sgn);
    const d = nx * LIGHT_DIR[0] + ny * LIGHT_DIR[1];
    c.strokeStyle = d > 0 ? `rgba(255,255,255,${(hi * d).toFixed(3)})` : `rgba(0,0,0,${(-lo * d).toFixed(3)})`;
    c.beginPath();
    c.moveTo(p[0], p[1]);
    c.lineTo(q[0], q[1]);
    c.stroke();
  }
}

/** Soft dark/light blotches (grime, mottling) inside the current clip. */
function blotches(c, r, n, x0, y0, w, h, dark, light, rmin, rmax) {
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * w;
    const y = y0 + r() * h;
    const rad = rmin + r() * (rmax - rmin);
    const isDark = r() < 0.6;
    const a = (isDark ? dark : light) * (0.4 + r() * 0.6);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, isDark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);
    g.addColorStop(1, isDark ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0)');
    c.save();
    c.translate(x, y);
    c.scale(1, 0.6);
    c.fillStyle = g;
    c.fillRect(-rad, -rad, rad * 2, rad * 2);
    c.restore();
  }
}

function speckle(c, r, n, x0, y0, w, h, a) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`;
    const s = 0.5 + r() * 0.8;
    c.fillRect(x0 + r() * w, y0 + r() * h, s, s * 0.7);
  }
}

/** Random-walk crack from (x, y); dark line with a faint lit lip below it. */
export function crack(c, r, x, y, len, ang, width = 0.8) {
  const pts = [[x, y]];
  let a = ang;
  const segs = 3 + Math.floor(r() * 3);
  for (let i = 0; i < segs; i++) {
    a += (r() - 0.5) * 1.3;
    const l = len / segs * (0.6 + r() * 0.8);
    const p = pts[pts.length - 1];
    pts.push([p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l * 0.55]);
  }
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.lineWidth = width;
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1] + 0.7) : c.moveTo(p[0], p[1] + 0.7)));
  c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.6)';
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.stroke();
  // a short branch
  if (segs > 3 && r() < 0.6) {
    const p = pts[2];
    c.lineWidth = width * 0.7;
    c.beginPath();
    c.moveTo(p[0], p[1]);
    c.lineTo(p[0] + (r() - 0.5) * len * 0.5, p[1] + (r() - 0.2) * len * 0.3);
    c.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* Floors                                                              */
/* ------------------------------------------------------------------ */

const FLOOR_STYLES = {
  // n = slab grid per tile edge; merge = chance two cells fuse; chip = corner chipping; bevel = edge contrast
  flagstone: { n: 2, merge: 0.35, chip: 0.45, jitter: 0.014, bevel: 1, inset: 0.034, mottle: 1, rivets: false },
  cobble: { n: 3, merge: 0.2, chip: 0.7, jitter: 0.02, bevel: 1.1, inset: 0.04, mottle: 0.8, rivets: false },
  concrete: { n: 2, merge: 0.6, chip: 0.12, jitter: 0.004, bevel: 0.55, inset: 0.022, mottle: 1.4, rivets: false },
  plate: { n: 2, merge: 0.25, chip: 0, jitter: 0, bevel: 1.5, inset: 0.026, mottle: 0.5, rivets: true },
};

function slabCells(r, st) {
  const { n } = st;
  const used = new Set();
  const cells = [];
  const step = 1 / n;
  if (n === 2 && r() < st.merge * 0.25) return [[-0.5, -0.5, 0.5, 0.5]];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (used.has(i * n + j)) continue;
      let w = 1;
      let h = 1;
      const roll = r();
      if (roll < st.merge * 0.5 && i + 1 < n && !used.has((i + 1) * n + j)) w = 2;
      else if (roll < st.merge && j + 1 < n && !used.has(i * n + j + 1)) h = 2;
      for (let di = 0; di < w; di++) for (let dj = 0; dj < h; dj++) used.add((i + di) * n + j + dj);
      cells.push([-0.5 + i * step, -0.5 + j * step, -0.5 + (i + w) * step, -0.5 + (j + h) * step]);
    }
  }
  return cells;
}

/** Slab outline in screen space: inset, jittered, optionally chipped corners. */
function slabPoly(r, cell, st, lift = 0) {
  const [a0, b0, a1, b1] = cell;
  const g = st.inset;
  const j = () => (r() - 0.5) * 2 * st.jitter;
  const corners = [[a0 + g + j(), b0 + g + j()], [a1 - g + j(), b0 + g + j()], [a1 - g + j(), b1 - g + j()], [a0 + g + j(), b1 - g + j()]];
  const out = [];
  for (let k = 0; k < 4; k++) {
    const p = corners[k];
    if (r() < st.chip) {
      const prev = corners[(k + 3) % 4];
      const next = corners[(k + 1) % 4];
      const t = 0.08 + r() * 0.12;
      const t2 = 0.08 + r() * 0.12;
      out.push([p[0] + (prev[0] - p[0]) * t, p[1] + (prev[1] - p[1]) * t]);
      out.push([p[0] + (next[0] - p[0]) * t2, p[1] + (next[1] - p[1]) * t2]);
    } else out.push(p);
  }
  return out.map(([a, b]) => iso(a, b, lift));
}

function bounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Diamond-plate tread: short raised dashes on an iso lattice. */
function tread(c, b) {
  for (let y = b.y0 - 2; y < b.y1 + 2; y += 3.2) {
    const odd = Math.round((y - b.y0) / 3.2) % 2;
    for (let x = b.x0 - 4 + odd * 3; x < b.x1 + 4; x += 6) {
      c.strokeStyle = 'rgba(0,0,0,0.28)';
      c.lineWidth = 0.9;
      c.beginPath();
      c.moveTo(x, y + 0.5);
      c.lineTo(x + 2.2, y + (odd ? -0.6 : 1.6));
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + 2.2, y + (odd ? -1.1 : 1.1));
      c.stroke();
    }
  }
}

/** Draw one slab (fill, texture, crack, bevel). Shared by floors and wall tops. */
function drawSlab(c, r, pts, color, st, art, opts = {}) {
  const b = bounds(pts);
  c.save();
  path(c, pts);
  c.clip();
  const g = c.createLinearGradient(b.x0, b.y0, b.x1 * 0.4, b.y1);
  g.addColorStop(0, tone(color, 1.1));
  g.addColorStop(1, tone(color, 0.86));
  c.fillStyle = g;
  c.fillRect(b.x0 - 1, b.y0 - 1, b.w + 2, b.h + 2);
  const area = Math.max(1, b.w * b.h);
  blotches(c, r, Math.ceil(area / 260 * st.mottle) + 1, b.x0, b.y0, b.w, b.h, 0.16 * art.grime + 0.05, 0.07, 2, Math.max(4, b.w * 0.35));
  if (art.stain && r() < 0.35) {
    const x = b.x0 + r() * b.w;
    const y = b.y0 + r() * b.h;
    const gr = c.createRadialGradient(x, y, 0, x, y, 6 + r() * 8);
    gr.addColorStop(0, rgba(art.stain, 0.35));
    gr.addColorStop(1, rgba(art.stain, 0));
    c.fillStyle = gr;
    c.fillRect(b.x0, b.y0, b.w, b.h);
  }
  if (st.rivets && opts.tread) tread(c, b);
  else if (st.rivets && r() < 0.5) {
    // brushed metal: faint long strokes along the plate
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.lineWidth = 0.6;
    for (let i = 0; i < 6; i++) {
      const y = b.y0 + r() * b.h;
      c.beginPath();
      c.moveTo(b.x0, y);
      c.lineTo(b.x1, y + b.w * 0.5 * (r() < 0.5 ? 1 : -1));
      c.stroke();
    }
  }
  speckle(c, r, Math.ceil(area / 40), b.x0, b.y0, b.w, b.h, 0.22);
  if (!st.rivets && r() < art.cracks * (opts.crackMult || 1)) {
    const e = pts[Math.floor(r() * pts.length)];
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    crack(c, r, e[0], e[1], Math.min(b.w, 26) * (0.6 + r() * 0.5), Math.atan2(cy - e[1], cx - e[0]) + (r() - 0.5));
  }
  if (st.rivets && art.rust && r() < 0.3 * art.grime) {
    blotches(c, r, 2, b.x0, b.y0, b.w, b.h, 0, 0, 2, 5);
    const x = b.x0 + r() * b.w;
    const y = b.y0 + r() * b.h;
    const gr = c.createRadialGradient(x, y, 0, x, y, 5 + r() * 5);
    gr.addColorStop(0, rgba(art.rust, 0.45));
    gr.addColorStop(1, rgba(art.rust, 0));
    c.fillStyle = gr;
    c.fillRect(b.x0, b.y0, b.w, b.h);
  }
  bevel(c, pts, 1.1 * st.bevel, 0.42 * st.bevel, 0.55 * st.bevel);
  c.restore();
  if (st.rivets) {
    // bolts just inside each plate corner
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    for (const p of pts) {
      const x = p[0] + (cx - p[0]) * 0.16;
      const y = p[1] + (cy - p[1]) * 0.16;
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.beginPath(); c.ellipse(x, y + 0.3, 1.1, 0.7, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(x - 0.5, y - 0.5, 0.8, 0.6);
    }
  }
}

function drawSlabFloor(c, r, base, alt, art, style, v) {
  const st = FLOOR_STYLES[style] || FLOOR_STYLES.flagstone;
  c.fillStyle = art.grout || tone(base, art.groutDark);
  diamondPath(c);
  c.fill();
  const cells = slabCells(r, st);
  for (const cell of cells) {
    const t = r() < 0.12 ? 0.68 + r() * 0.1 : 0.8 + r() * 0.32;
    let col = tone(base, t);
    if (r() < 0.3) col = mix(col, tone(alt, t), 0.6);
    drawSlab(c, r, slabPoly(r, cell, st), col, st, art, { tread: st.rivets && (v % 3 === 0) });
  }
  if (style === 'concrete' && v % 5 === 1) {
    // faded painted line across the tile
    c.save();
    diamondPath(c);
    c.clip();
    c.strokeStyle = rgba(art.hazard, 0.32);
    c.lineWidth = 3;
    c.setLineDash([7, 3]);
    const [x0, y0] = iso(-0.5, 0.1);
    const [x1, y1] = iso(0.5, 0.1);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.setLineDash([]);
    c.restore();
  }
  if (style === 'plate' && v % 7 === 3) {
    // hazard-striped plate edge
    c.save();
    path(c, [iso(-0.47, 0.32), iso(0.47, 0.32), iso(0.47, 0.47), iso(-0.47, 0.47)]);
    c.clip();
    c.fillStyle = rgba(art.hazard, 0.55);
    c.fillRect(-HW, -HH, TILE_W, TILE_H);
    c.strokeStyle = 'rgba(10,10,10,0.75)';
    c.lineWidth = 2.2;
    for (let x = -HW - 20; x < HW + 20; x += 6) { c.beginPath(); c.moveTo(x, HH); c.lineTo(x + 10, -HH); c.stroke(); }
    c.restore();
  }
}

function drawGrateFloor(c, r, base, art) {
  c.fillStyle = tone(base, 0.55);
  diamondPath(c);
  c.fill();
  // frame
  const outer = [iso(-0.47, -0.47), iso(0.47, -0.47), iso(0.47, 0.47), iso(-0.47, 0.47)];
  const inner = [iso(-0.36, -0.36), iso(0.36, -0.36), iso(0.36, 0.36), iso(-0.36, 0.36)];
  c.save();
  path(c, outer);
  c.clip();
  c.fillStyle = tone(base, 1.0);
  c.fill();
  bevel(c, outer, 1, 0.45, 0.6);
  c.restore();
  // pit below the bars
  c.save();
  path(c, inner);
  c.clip();
  const g = c.createLinearGradient(0, -HH, 0, HH);
  g.addColorStop(0, 'rgba(0,0,0,0.92)');
  g.addColorStop(1, tone(base, 0.18));
  c.fillStyle = g;
  c.fillRect(-HW, -HH, TILE_W, TILE_H);
  if (art.accent && r() < 0.35) {
    const gr = c.createRadialGradient(0, 4, 0, 0, 4, 16);
    gr.addColorStop(0, rgba(art.accent, 0.25));
    gr.addColorStop(1, rgba(art.accent, 0));
    c.fillStyle = gr;
    c.fillRect(-HW, -HH, TILE_W, TILE_H);
  }
  // bars along a, cross-bars along b
  for (let k = -0.3; k <= 0.31; k += 0.1) {
    const [x0, y0] = iso(-0.36, k);
    const [x1, y1] = iso(0.36, k);
    c.strokeStyle = tone(base, 0.45); c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(x0, y0 + 0.8); c.lineTo(x1, y1 + 0.8); c.stroke();
    c.strokeStyle = tone(base, 1.15); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  for (const k of [-0.12, 0.12]) {
    const [x0, y0] = iso(k, -0.36);
    const [x1, y1] = iso(k, 0.36);
    c.strokeStyle = tone(base, 0.9); c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  c.restore();
  // corner bolts
  for (const [a, b] of [[-0.42, -0.42], [0.42, -0.42], [0.42, 0.42], [-0.42, 0.42]]) {
    const [x, y] = iso(a, b);
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x - 0.8, y - 0.3, 1.6, 1.1);
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x - 0.5, y - 0.5, 0.8, 0.5);
  }
}

function drawWaterFloor(c, r, base, art) {
  c.save();
  diamondPath(c);
  c.clip();
  const g = c.createLinearGradient(0, -HH, 0, HH);
  g.addColorStop(0, tone(base, 0.75));
  g.addColorStop(1, tone(base, 1.05));
  c.fillStyle = g;
  c.fillRect(-HW - 1, -HH - 1, TILE_W + 2, TILE_H + 2);
  blotches(c, r, 4, -HW, -HH, TILE_W, TILE_H, 0.18, 0.06, 6, 14);
  for (let i = 0; i < 4; i++) {
    const x = (r() - 0.5) * 44;
    const y = (r() - 0.5) * 18;
    c.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.1})`;
    c.lineWidth = 0.7;
    c.beginPath();
    c.ellipse(x, y, 4 + r() * 7, 1.2 + r() * 1.5, 0, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
  }
  for (let i = 0; i < 3; i++) {
    c.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.12})`;
    c.fillRect((r() - 0.5) * 40, (r() - 0.5) * 14, 3 + r() * 6, 0.6);
  }
  c.restore();
}

/**
 * Draw a floor diamond.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx tile centre x
 * @param {number} sy tile centre y
 * @param {{colors?:string[], variant?:number, style?:string, art?:object}} opts colors = [base, speckle]
 */
export function drawTile(ctx, sx, sy, { colors = DEFAULT_FLOOR, variant = 0, style, art } = {}) {
  const A = resolveArt(art);
  const st = style || A.floorStyle;
  const v = variant % FLOOR_VARIANTS;
  const base = colors[0];
  const alt = colors[1] || colors[0];
  const key = `f|${st}|${base}|${alt}|${v}|${A.key}`;
  const entry = cached(key, TILE_W + PAD * 2, TILE_H + PAD * 2, HW + PAD, HH + PAD, (c) => {
    const r = rng(hash2(v, strHash(base + st), 11));
    if (st === 'water') drawWaterFloor(c, r, base, A);
    else if (st === 'grate') drawGrateFloor(c, r, base, A);
    else drawSlabFloor(c, r, base, alt, A, st, v);
  });
  blit(ctx, entry, sx, sy);
}

/**
 * Ambient occlusion on a floor tile from walls behind it.
 * mask bits: 1 = wall at (x, y-1) (upper-right edge), 2 = wall at (x-1, y) (upper-left edge),
 * 4 = wall at (x-1, y-1) only (top corner).
 */
export function drawFloorAO(ctx, sx, sy, mask) {
  if (!mask) return;
  const entry = cached(`ao|${mask}`, TILE_W + PAD * 2, TILE_H + PAD * 2, HW + PAD, HH + PAD, (c) => {
    diamondPath(c);
    c.clip();
    const band = (mx, my, nx, ny) => {
      const g = c.createLinearGradient(mx, my, mx + nx * 13, my + ny * 13);
      g.addColorStop(0, 'rgba(0,0,0,0.62)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(-HW, -HH, TILE_W, TILE_H);
    };
    const [nx, ny] = norm(-16, 32); // inward normal of the upper-right edge (screen space, iso-corrected)
    if (mask & 1) band(16, -8, nx, ny);
    if (mask & 2) band(-16, -8, -nx, ny);
    if ((mask & 4) && !(mask & 3)) {
      const g = c.createRadialGradient(0, -HH, 0, 0, -HH, 14);
      g.addColorStop(0, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(-HW, -HH, TILE_W, TILE_H);
    }
  });
  blit(ctx, entry, sx, sy);
}

/* ------------------------------------------------------------------ */
/* Wall faces (drawn in face space: s along the face 0..32, h up 0..WALL_H) */
/* ------------------------------------------------------------------ */

/** Map face space onto the screen: left face runs (-32,0)->(0,16), right face (0,16)->(32,0). */
export function faceTransform(c, face) {
  if (face === 'left') c.transform(1, 0.5, 0, -1, -HW, 0);
  else c.transform(1, -0.5, 0, -1, 0, HH);
}

function hiLo(c, s0, h0, w, h, hi, lo) {
  c.fillStyle = `rgba(255,255,255,${hi})`;
  c.fillRect(s0, h0 + h - 0.9, w, 0.9);
  c.fillRect(s0, h0, 0.7, h);
  c.fillStyle = `rgba(0,0,0,${lo})`;
  c.fillRect(s0, h0, w, 0.9);
  c.fillRect(s0 + w - 0.7, h0, 0.7, h);
}

function runeGlyph(c, r, x, y, w, h, color) {
  const strokes = [];
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const kind = Math.floor(r() * 5);
    if (kind === 0) strokes.push([[x + w * 0.5, y], [x + w * 0.5, y + h]]);
    else if (kind === 1) strokes.push([[x, y + h * r()], [x + w, y + h * r()]]);
    else if (kind === 2) strokes.push([[x, y], [x + w, y + h]]);
    else if (kind === 3) strokes.push([[x + w, y], [x, y + h]]);
    else strokes.push([[x, y + h * 0.5], [x + w * 0.5, y], [x + w, y + h * 0.5]]);
  }
  c.lineCap = 'round';
  for (const [col, off, lw] of [['rgba(0,0,0,0.7)', 0, 1.1], [rgba(color, 0.75), 0.45, 0.55]]) {
    c.strokeStyle = col;
    c.lineWidth = lw;
    for (const s of strokes) {
      c.beginPath();
      s.forEach((p, i) => (i ? c.lineTo(p[0], p[1] + off) : c.moveTo(p[0], p[1] + off)));
      c.stroke();
    }
  }
}

function faceGrime(c, r, art, color) {
  // streaks running down from the cap
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
    const s = r() * 30;
    const len = 10 + r() * 26;
    const g = c.createLinearGradient(0, WALL_H - CAP_H, 0, WALL_H - CAP_H - len);
    g.addColorStop(0, `rgba(0,0,0,${0.12 + 0.2 * art.grime})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(s, WALL_H - CAP_H - len, 1.2 + r() * 2.5, len);
  }
  if (art.stain) {
    const g = c.createLinearGradient(0, 0, 0, 18 + r() * 10);
    g.addColorStop(0, rgba(art.stain, 0.4));
    g.addColorStop(1, rgba(art.stain, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 28);
  }
  // shadow under the cap overhang
  let g = c.createLinearGradient(0, WALL_H - CAP_H, 0, WALL_H - CAP_H - 5);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, WALL_H - CAP_H - 5, 32, 5);
  // ambient occlusion where the wall meets the floor
  g = c.createLinearGradient(0, 0, 0, 24);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.4, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 24);
  void color;
}

function drawCourses(c, r, color, rough, seedKey) {
  const mid = WALL_H - CAP_H - PLINTH_H;
  const rows = Math.round(mid / 9.5);
  const ch = mid / rows;
  const gap = 0.75;
  for (let ci = 0; ci < rows; ci++) {
    const hb = PLINTH_H + ci * ch;
    const off = (ci % 2) * (BRICK_L / 2);
    let s = -BRICK_L + off;
    while (s < 32) {
      const len = rough ? BRICK_L * (0.6 + r() * 0.7) : BRICK_L;
      const s0 = Math.max(0, s);
      const s1 = Math.min(32, s + len);
      const crosses = s < 0 || s + len > 32;
      // bricks crossing the tile seam take a tone from the course alone so both halves match
      const tr = crosses && !rough ? (hash2(ci, seedKey, 5) % 1000) / 1000 : r();
      const t = 0.8 + tr * 0.3;
      const hj = rough ? (r() - 0.5) * 1.6 : 0;
      c.fillStyle = tone(color, t);
      const bx = s0 + (s0 > 0 ? gap / 2 : 0);
      const bw = s1 - s0 - (s0 > 0 ? gap / 2 : 0) - (s1 < 32 ? gap / 2 : 0);
      const by = hb + gap / 2 + Math.max(0, hj);
      const bh = ch - gap - Math.abs(hj);
      if (rough) {
        c.beginPath();
        c.roundRect(bx, by, bw, bh, 2.2);
        c.fill();
      } else c.fillRect(bx, by, bw, bh);
      // bevel: top lit, bottom in shadow, ends
      c.fillStyle = 'rgba(255,255,255,0.2)';
      c.fillRect(bx, by + bh - 1, bw, 1);
      c.fillStyle = 'rgba(0,0,0,0.32)';
      c.fillRect(bx, by, bw, 1);
      if (s0 > 0) { c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(bx, by, 0.8, bh); }
      if (s1 < 32) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(bx + bw - 0.8, by, 0.8, bh); }
      speckle(c, r, 3, bx, by, bw, bh, 0.25);
      if (r() < 0.14) {
        // chipped corner
        c.fillStyle = 'rgba(0,0,0,0.45)';
        const cx = r() < 0.5 ? bx : bx + bw - 2.5;
        c.beginPath(); c.moveTo(cx, by + bh); c.lineTo(cx + 2.5, by + bh); c.lineTo(cx + (cx === bx ? 0 : 2.5), by + bh - 2.2); c.fill();
      }
      s += len;
    }
  }
}

function drawNiche(c, r, color, art) {
  const s0 = 9;
  const s1 = 23;
  const hb = PLINTH_H + 2;
  const spring = 34;
  const rad = (s1 - s0) / 2;
  const cx = (s0 + s1) / 2;
  // voussoir ring
  c.fillStyle = tone(color, 1.04);
  c.beginPath();
  c.moveTo(s0 - 2.5, hb);
  c.lineTo(s0 - 2.5, spring);
  c.arc(cx, spring, rad + 2.5, Math.PI, 0, true);
  c.lineTo(s1 + 2.5, hb);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.45)';
  c.lineWidth = 0.6;
  for (let k = 1; k < 5; k++) {
    const a = Math.PI - (k / 5) * Math.PI;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * rad, spring + Math.sin(a) * rad);
    c.lineTo(cx + Math.cos(a) * (rad + 2.5), spring + Math.sin(a) * (rad + 2.5));
    c.stroke();
  }
  c.strokeStyle = 'rgba(255,255,255,0.22)';
  c.beginPath();
  c.arc(cx, spring, rad + 2.3, Math.PI, Math.PI * 0.5, true);
  c.stroke();
  // recess
  c.beginPath();
  c.moveTo(s0, hb);
  c.lineTo(s0, spring);
  c.arc(cx, spring, rad, Math.PI, 0, true);
  c.lineTo(s1, hb);
  c.closePath();
  const g = c.createLinearGradient(0, spring + rad, 0, hb);
  g.addColorStop(0, tone(color, 0.08));
  g.addColorStop(1, tone(color, 0.32));
  c.fillStyle = g;
  c.fill();
  c.save();
  c.clip();
  // inner side wall in shadow and a lit opposite jamb
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(s0, hb, 2.2, spring + rad);
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.fillRect(s1 - 2, hb, 2, spring - hb);
  if (r() < 0.5) {
    // something left on the sill: an urn / skull silhouette
    c.fillStyle = tone(art.accent ? mix(color, art.accent, 0.25) : color, 0.55);
    c.beginPath(); c.ellipse(cx, hb + 3.5, 2.6, 3, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(cx - 1.6, hb + 4.5, 1, 1.4);
  }
  c.restore();
  // sill
  c.fillStyle = tone(color, 1.12);
  c.fillRect(s0 - 1.5, hb - 1.5, s1 - s0 + 3, 1.8);
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.fillRect(s0 - 1.5, hb, s1 - s0 + 3, 0.5);
}

function drawPilaster(c, r, color, panel) {
  const w = 7;
  // cast shadow on the wall to the right
  const g = c.createLinearGradient(w, 0, w + 4, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(w, 0, 4, WALL_H - CAP_H);
  c.fillStyle = tone(color, panel ? 0.7 : 1.08);
  c.fillRect(0, 0, w, WALL_H);
  if (panel) {
    // I-beam: flanges + bolts
    c.fillStyle = tone(color, 0.95);
    c.fillRect(0, 0, 1.6, WALL_H);
    c.fillRect(w - 1.6, 0, 1.6, WALL_H);
    for (let h = 6; h < WALL_H - 4; h += 8) {
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(w / 2 - 0.7, h - 0.3, 1.4, 1.4);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(w / 2 - 0.5, h + 0.5, 0.8, 0.5);
    }
  } else {
    // stacked drums with fluting
    for (let h = PLINTH_H + 2; h < WALL_H - 12; h += 11) {
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, h, w, 0.7);
      c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(0, h - 0.8, w, 0.6);
    }
    c.fillStyle = 'rgba(0,0,0,0.16)';
    c.fillRect(2, PLINTH_H + 2, 0.7, WALL_H - 26);
    c.fillRect(4, PLINTH_H + 2, 0.7, WALL_H - 26);
    // capital and base blocks
    c.fillStyle = tone(color, 1.18);
    c.fillRect(0, WALL_H - CAP_H - 5, w + 2, 5);
    c.fillRect(0, 0, w + 2, PLINTH_H + 2);
    hiLo(c, 0, WALL_H - CAP_H - 5, w + 2, 5, 0.3, 0.45);
    hiLo(c, 0, 0, w + 2, PLINTH_H + 2, 0.25, 0.4);
  }
  c.fillStyle = 'rgba(255,255,255,0.28)';
  c.fillRect(0, 0, 0.9, WALL_H);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(w - 0.9, 0, 0.9, WALL_H - CAP_H);
  void r;
}

function drawRunePlaque(c, r, color, art) {
  const s0 = 7, s1 = 25, h0 = 26, h1 = 42;
  c.fillStyle = tone(color, 0.7);
  c.fillRect(s0, h0, s1 - s0, h1 - h0);
  hiLo(c, s0, h0, s1 - s0, h1 - h0, 0.05, 0.1);
  c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(s0, h0, s1 - s0, 0.8);
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(s0, h1 - 0.8, s1 - s0, 0.8);
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 3; k++) runeGlyph(c, r, s0 + 2 + k * 5.6, h0 + 2.5 + row * 6.5, 3.4, 4.2, art.runeColor);
  }
}

function drawDamage(c, r, color, panel) {
  const n = 2 + Math.floor(r() * 3);
  const mid = WALL_H - CAP_H - PLINTH_H;
  for (let i = 0; i < n; i++) {
    const s = 3 + r() * 20;
    const h = PLINTH_H + 3 + r() * (mid - 12);
    const w = 5 + r() * 7;
    const hh = 4 + r() * 6;
    c.fillStyle = tone(color, 0.14);
    c.beginPath();
    c.moveTo(s, h); c.lineTo(s + w * 0.6, h - 1); c.lineTo(s + w, h + hh * 0.4); c.lineTo(s + w * 0.8, h + hh); c.lineTo(s + 0.5, h + hh * 0.8);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(s + 0.5, h - 0.8, w * 0.6, 0.8);
    if (panel) {
      // torn panel: cables hanging out
      c.strokeStyle = tone('#303038', 1);
      c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(s + 2, h + hh * 0.7); c.quadraticCurveTo(s + 3, h - 4, s + 5, h - 7); c.stroke();
    }
  }
  crack(c, r, 4 + r() * 20, PLINTH_H + 6 + r() * 20, 22, Math.PI / 2 + (r() - 0.5), 0.7);
}

function drawMasonryFace(c, r, color, art, feat, rough, seedKey) {
  c.fillStyle = tone(color, 0.3);
  c.fillRect(0, 0, 32, WALL_H);
  drawCourses(c, r, color, rough, seedKey);
  // plinth: big dark blocks with a lit ledge
  c.fillStyle = tone(color, 0.74);
  c.fillRect(0, 0, 32, PLINTH_H - 0.6);
  c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(16, 0, 0.8, PLINTH_H);
  c.fillStyle = tone(color, 1.15); c.fillRect(0, PLINTH_H - 2.2, 32, 1.6);
  c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(0, PLINTH_H - 0.9, 32, 0.6);
  // cap course: long stones, joints offset from the bricks
  c.fillStyle = tone(color, 1.1);
  c.fillRect(0, WALL_H - CAP_H, 32, CAP_H);
  c.fillStyle = tone(color, 0.95);
  c.fillRect(16.4, WALL_H - CAP_H, 15.6, CAP_H);
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(16, WALL_H - CAP_H, 0.7, CAP_H);
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, WALL_H - CAP_H, 32, 0.9);
  c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(0, WALL_H - 1.2, 32, 1.2);
  if (feat === FEAT.NICHE) drawNiche(c, r, color, art);
  else if (feat === FEAT.RUNES) drawRunePlaque(c, r, color, art);
  else if (feat === FEAT.DAMAGED) drawDamage(c, r, color, false);
  faceGrime(c, r, art, color);
  if (feat === FEAT.PILASTER) drawPilaster(c, r, color, false);
}

function drawPanelFace(c, r, color, art, feat, v) {
  c.fillStyle = tone(color, 0.28);
  c.fillRect(0, 0, 32, WALL_H);
  // kick plate
  c.fillStyle = tone(color, 0.66);
  c.fillRect(0, 0, 32, PLINTH_H - 0.8);
  if (v % 4 === 1) {
    c.save();
    c.beginPath(); c.rect(0, 1, 32, PLINTH_H - 3); c.clip();
    c.fillStyle = rgba(art.hazard, 0.6);
    c.fillRect(0, 0, 32, PLINTH_H);
    c.strokeStyle = 'rgba(12,12,12,0.8)';
    c.lineWidth = 2;
    for (let s = -10; s < 40; s += 5) { c.beginPath(); c.moveTo(s, 0); c.lineTo(s + 6, PLINTH_H); c.stroke(); }
    c.restore();
  }
  c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(0, PLINTH_H - 1.6, 32, 0.8);
  // panels
  const split = v % 2 === 0;
  const rows = [[PLINTH_H, 30], [30, WALL_H - CAP_H]];
  for (const [h0, h1] of rows) {
    const cols = split && h0 > PLINTH_H ? [[0, 16], [16, 32]] : [[0, 32]];
    for (const [s0, s1] of cols) {
      const t = 0.8 + r() * 0.26;
      const x = s0 + 0.6;
      const y = h0 + 0.6;
      const w = s1 - s0 - 1.2;
      const h = h1 - h0 - 1.2;
      const g = c.createLinearGradient(0, h0, 0, h1);
      g.addColorStop(0, tone(color, t * 0.86));
      g.addColorStop(1, tone(color, t * 1.08));
      c.fillStyle = g;
      c.fillRect(x, y, w, h);
      hiLo(c, x, y, w, h, 0.26, 0.45);
      if (r() < 0.45) {
        // pressed ribs
        for (let k = 1; k <= 3; k++) {
          const hy = y + (h * k) / 4;
          c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x + 2, hy, w - 4, 0.7);
          c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x + 2, hy + 0.7, w - 4, 0.5);
        }
      }
      blotches(c, r, 2, x, y, w, h, 0.18 * art.grime, 0.04, 2, 7);
      // bolts and rust drips
      for (const [bx, by] of [[x + 2, y + 2], [x + w - 2, y + 2], [x + 2, y + h - 2], [x + w - 2, y + h - 2]]) {
        if (art.rust && r() < 0.35 * art.grime) {
          const len = 5 + r() * 12;
          const gg = c.createLinearGradient(0, by, 0, by - len);
          gg.addColorStop(0, rgba(art.rust, 0.6));
          gg.addColorStop(1, rgba(art.rust, 0));
          c.fillStyle = gg;
          c.fillRect(bx - 0.6, by - len, 1.4, len);
        }
        c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(bx - 0.7, by - 0.7, 1.5, 1.5);
        c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(bx - 0.6, by + 0.1, 0.8, 0.6);
      }
      if (r() < 0.15) {
        // stencilled label
        c.fillStyle = rgba(art.hazard, 0.5);
        c.fillRect(x + 3, y + h * 0.55, 6, 2.2);
        c.fillStyle = 'rgba(255,255,255,0.4)';
        c.fillRect(x + 10, y + h * 0.55 + 0.6, 4, 0.7);
      }
    }
  }
  // top trim
  c.fillStyle = tone(color, 1.12);
  c.fillRect(0, WALL_H - CAP_H, 32, CAP_H);
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, WALL_H - CAP_H, 32, 1);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, WALL_H - CAP_H + 3, 32, 0.7);
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, WALL_H - 1.2, 32, 1.2);
  if (feat === FEAT.VENT) {
    const s0 = 8, h0 = 13, w = 16, h = 12;
    c.fillStyle = tone(color, 0.12); c.fillRect(s0, h0, w, h);
    for (let k = 0; k < 5; k++) {
      c.fillStyle = tone(color, 0.75); c.fillRect(s0, h0 + 1 + k * 2.3, w, 1);
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(s0, h0 + 1.9 + k * 2.3, w, 0.4);
    }
    hiLo(c, s0 - 0.8, h0 - 0.8, w + 1.6, h + 1.6, 0.25, 0.5);
  } else if (feat === FEAT.SCREEN) {
    const s0 = 7, h0 = 31, w = 18, h = 13;
    c.fillStyle = tone(color, 0.5); c.fillRect(s0 - 1.2, h0 - 1.2, w + 2.4, h + 2.4);
    c.fillStyle = '#05070a'; c.fillRect(s0, h0, w, h);
    c.fillStyle = rgba(art.accent, 0.5);
    for (let k = 0; k < 4; k++) c.fillRect(s0 + 1.5, h0 + h - 3 - k * 2.6, 3 + r() * 11, 1);
    c.fillStyle = rgba(art.accent, 0.12); c.fillRect(s0, h0, w, h);
    hiLo(c, s0 - 1.2, h0 - 1.2, w + 2.4, h + 2.4, 0.25, 0.5);
  } else if (feat === FEAT.DAMAGED) drawDamage(c, r, color, true);
  // conduit pipe running the length of every panel wall
  const ph = WALL_H - CAP_H - 5;
  c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(0, ph - 2.6, 32, 1.2);
  c.fillStyle = tone(art.metal, 0.8); c.fillRect(0, ph - 1.6, 32, 3.2);
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, ph + 0.8, 32, 0.7);
  c.fillStyle = tone(art.metal, 0.5); c.fillRect(10, ph - 2.2, 2.2, 4.4);
  faceGrime(c, r, art, color);
  if (feat === FEAT.PILASTER) drawPilaster(c, r, color, true);
}

function drawFace(c, face, color, wallStyle, art, feat, v, lintel) {
  c.save();
  faceTransform(c, face);
  c.beginPath();
  c.rect(0, lintel ? DOOR_H : 0, 32, WALL_H - (lintel ? DOOR_H : 0));
  c.clip();
  const r = rng(hash2(v, feat * 7 + (face === 'left' ? 1 : 2), strHash(color + wallStyle)));
  if (lintel) drawLintelFace(c, color, wallStyle, art);
  else if (wallStyle === 'panel') drawPanelFace(c, r, color, art, feat, v);
  else drawMasonryFace(c, r, color, art, feat, wallStyle === 'rough', strHash(color));
  c.restore();
}

function drawLintelFace(c, color, wallStyle, art) {
  const panel = wallStyle === 'panel';
  c.fillStyle = tone(color, panel ? 0.75 : 1.0);
  c.fillRect(0, DOOR_H, 32, WALL_H - DOOR_H);
  hiLo(c, 0, DOOR_H, 32, WALL_H - DOOR_H - CAP_H, 0.2, 0.45);
  if (panel) {
    c.fillStyle = rgba(art.hazard, 0.55);
    c.fillRect(0, DOOR_H + 1, 32, 3);
    c.strokeStyle = 'rgba(10,10,10,0.8)';
    c.lineWidth = 1.5;
    for (let s = -4; s < 36; s += 4) { c.beginPath(); c.moveTo(s, DOOR_H + 1); c.lineTo(s + 3, DOOR_H + 4); c.stroke(); }
  } else {
    // keystone
    c.fillStyle = tone(color, 1.15);
    c.fillRect(13, DOOR_H - 1, 6, WALL_H - DOOR_H - CAP_H + 1);
    hiLo(c, 13, DOOR_H - 1, 6, WALL_H - DOOR_H - CAP_H + 1, 0.3, 0.5);
  }
  c.fillStyle = tone(color, 1.1);
  c.fillRect(0, WALL_H - CAP_H, 32, CAP_H);
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, WALL_H - CAP_H, 32, 0.9);
  c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(0, WALL_H - 1.2, 32, 1.2);
  // soffit shadow under the lintel
  c.fillStyle = 'rgba(0,0,0,0.7)';
  c.fillRect(0, DOOR_H, 32, 1.4);
}

/* ------------------------------------------------------------------ */
/* Wall tops                                                           */
/* ------------------------------------------------------------------ */

// edges of the top diamond: [from corner, to corner, neighbour bit]
// corners: 0 top, 1 right, 2 bottom, 3 left. bits: 1 (x,y-1) 2 (x+1,y) 4 (x,y+1) 8 (x-1,y)
const TOP_CORNERS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const TOP_EDGES = [[0, 1, 1], [1, 2, 2], [2, 3, 4], [3, 0, 8]];

const TOP_PLATE = { ...FLOOR_STYLES.plate, bevel: 1.0 };
const TOP_STONE = { ...FLOOR_STYLES.flagstone, chip: 0.1, inset: 0.02 };

/** Rooftop machinery box (fan unit) on interior roof tiles of panel buildings. */
function roofUnit(c, color, art, lift) {
  const H = 7;
  const P = (a, b, z) => iso(a, b, lift + z);
  const quad = (pts, col) => { path(c, pts); c.fillStyle = col; c.fill(); };
  // contact shadow
  quad([P(-0.3, -0.25, 0), P(0.3, -0.25, 0), P(0.38, 0.33, 0), P(-0.22, 0.33, 0)], 'rgba(0,0,0,0.35)');
  quad([P(-0.3, 0.25, 0), P(0.25, 0.25, 0), P(0.25, 0.25, H), P(-0.3, 0.25, H)], tone(art.metal, 0.85));
  quad([P(0.25, -0.25, 0), P(0.25, 0.25, 0), P(0.25, 0.25, H), P(0.25, -0.25, H)], tone(art.metal, 0.6));
  const top = [P(-0.3, -0.25, H), P(0.25, -0.25, H), P(0.25, 0.25, H), P(-0.3, 0.25, H)];
  c.save();
  quad(top, tone(art.metal, 1.1));
  c.clip();
  bevel(c, top, 0.9, 0.5, 0.5);
  const [fx, fy] = P(-0.02, 0, H);
  c.fillStyle = 'rgba(0,0,0,0.75)';
  c.beginPath(); c.ellipse(fx, fy, 7, 3.6, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = tone(art.metal, 0.9); c.lineWidth = 0.8;
  for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(fx - 6 + k * 6, fy - 3); c.lineTo(fx - 3 + k * 3, fy + 3); c.stroke(); }
  c.restore();
  // vent slats on the front face
  for (let k = 1; k < 4; k++) {
    const [x0, y0] = P(-0.26, 0.25, k * 1.7);
    const [x1, y1] = P(0.2, 0.25, k * 1.7);
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 0.7;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  void color;
}

function drawTop(c, color, wallStyle, art, mask, v) {
  const lift = WALL_H;
  const r = rng(hash2(v, mask, strHash(color + wallStyle) ^ 77));
  const panel = wallStyle === 'panel';
  const st = panel ? TOP_PLATE : TOP_STONE;
  c.fillStyle = tone(color, 0.35);
  diamondPath(c, lift);
  c.fill();
  // slab surface: one or two stones per tile
  const cells = r() < 0.5 ? [[-0.5, -0.5, 0.5, 0.5]] : (r() < 0.5 ? [[-0.5, -0.5, 0, 0.5], [0, -0.5, 0.5, 0.5]] : [[-0.5, -0.5, 0.5, 0], [-0.5, 0, 0.5, 0.5]]);
  for (const cell of cells) {
    // cells touching a wall neighbour run flush into it (no grout on that side)
    const [a0, b0, a1, b1] = cell;
    const e = [a0 <= -0.5 && (mask & 8), b0 <= -0.5 && (mask & 1), a1 >= 0.5 && (mask & 2), b1 >= 0.5 && (mask & 4)];
    const g = st.inset;
    const pts = [[a0 + (e[0] ? -0.02 : g), b0 + (e[1] ? -0.02 : g)], [a1 - (e[2] ? -0.02 : g), b0 + (e[1] ? -0.02 : g)],
      [a1 - (e[2] ? -0.02 : g), b1 - (e[3] ? -0.02 : g)], [a0 + (e[0] ? -0.02 : g), b1 - (e[3] ? -0.02 : g)]].map(([a, b]) => iso(a, b, lift));
    drawSlab(c, r, pts, tone(color, TOP_FACE * (0.9 + r() * 0.16)), st, art, { crackMult: 0.6 });
  }
  if (panel && v === 2 && mask !== 15) {
    // roof hatch / vent box
    const pts = [iso(-0.2, -0.2, lift), iso(0.15, -0.2, lift), iso(0.15, 0.15, lift), iso(-0.2, 0.15, lift)];
    c.save(); path(c, pts); c.clip();
    c.fillStyle = tone(color, 0.45); c.fill();
    for (let k = -0.15; k < 0.15; k += 0.07) {
      const [x0, y0] = iso(-0.2, k, lift);
      const [x1, y1] = iso(0.15, k, lift);
      c.strokeStyle = tone(color, 1.0); c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    bevel(c, pts, 1, 0.5, 0.6);
    c.restore();
  }
  if (panel && mask === 15 && v === 1) roofUnit(c, color, art, lift);
  // raised rim along exposed edges, with a bright catch-light on the outer lip
  const RIM = 0.13;
  let runeDone = false;
  for (const [i0, i1, bit] of TOP_EDGES) {
    if (mask & bit) continue;
    const p0 = TOP_CORNERS[i0];
    const p1 = TOP_CORNERS[i1];
    const inward = [-(p0[0] + p1[0]) * RIM, -(p0[1] + p1[1]) * RIM];
    const q0 = [p0[0] + inward[0], p0[1] + inward[1]];
    const q1 = [p1[0] + inward[0], p1[1] + inward[1]];
    const band = [iso(p0[0], p0[1], lift), iso(p1[0], p1[1], lift), iso(q1[0], q1[1], lift), iso(q0[0], q0[1], lift)];
    c.save();
    diamondPath(c, lift);
    c.clip();
    path(c, band);
    c.fillStyle = tone(color, panel ? 0.8 : 1.12);
    c.fill();
    if (panel && bit === 4) {
      // hazard trim on the front edge of roofs
      c.save(); path(c, band); c.clip();
      c.fillStyle = rgba(art.hazard, 0.45); c.fill();
      c.restore();
    }
    // inner groove
    const [ix0, iy0] = iso(q0[0], q0[1], lift);
    const [ix1, iy1] = iso(q1[0], q1[1], lift);
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(ix0, iy0); c.lineTo(ix1, iy1); c.stroke();
    const front = bit === 2 || bit === 4;
    const [ox0, oy0] = iso(p0[0], p0[1], lift);
    const [ox1, oy1] = iso(p1[0], p1[1], lift);
    c.strokeStyle = `rgba(255,255,255,${front ? 0.42 : 0.3})`; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(ox0, oy0); c.lineTo(ox1, oy1); c.stroke();
    if (!panel && front && !runeDone && art.runes > 0 && (hash2(v, mask, 91) % 1000) / 1000 < art.runes) {
      runeDone = true;
      const rr = rng(hash2(v, bit, 13));
      for (let k = 0; k < 4; k++) {
        const t = 0.18 + k * 0.18;
        const a = p0[0] + (p1[0] - p0[0]) * t + inward[0] * 0.5;
        const b = p0[1] + (p1[1] - p0[1]) * t + inward[1] * 0.5;
        const [gx, gy] = iso(a, b, lift);
        runeGlyph(c, rr, gx - 1.6, gy - 1.6, 3.2, 2.6, art.runeColor);
      }
    }
    c.restore();
  }
}

/**
 * Draw a wall block.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx tile centre x
 * @param {number} sy tile centre y
 * @param {object} opts
 *   colors = [leftFace, rightFace, top]; side = which faces show; mask = wall-neighbour bits
 *   (1 y-1, 2 x+1, 4 y+1, 8 x-1); featL / featR = FEAT codes per face; variant; wallStyle; art;
 *   lintel = draw only the part above a door opening.
 */
export function drawWall(ctx, sx, sy, {
  colors = DEFAULT_WALL, side = 'both', mask = 0, featL = 0, featR = 0, variant = 0, wallStyle, art, lintel = false,
} = {}) {
  const A = resolveArt(art);
  const ws = wallStyle || A.wallStyle;
  const base = colors[0];
  const top = colors[2] || colors[0];
  const v = variant % WALL_VARIANTS;
  const showL = side === 'left' || side === 'both';
  const showR = side === 'right' || side === 'both';
  const fl = showL ? featL : 0;
  const fr = showR ? featR : 0;
  const key = `w|${base}|${top}|${ws}|${side}|${mask}|${fl}|${fr}|${v}|${lintel ? 1 : 0}|${A.key}`;
  const entry = cached(key, TILE_W + PAD * 2, TILE_H + WALL_H + PAD * 2, HW + PAD, WALL_H + HH + PAD, (c) => {
    if (showL) drawFace(c, 'left', tone(base, LEFT_FACE), ws, A, fl, v, lintel);
    if (showR) drawFace(c, 'right', tone(base, RIGHT_FACE), ws, A, fr, v + 1, lintel);
    if (showL && showR) {
      // catch-light on the vertical corner edge
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.fillRect(-0.6, HH - WALL_H, 0.9, WALL_H - (lintel ? DOOR_H : 0));
    }
    drawTop(c, top, ws, A, mask, v);
  });
  blit(ctx, entry, sx, sy);
}

/**
 * Outline a tile diamond (hover / target marker). Not cached.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx
 * @param {number} sy
 * @param {string} [color]
 */
export function drawTileOutline(ctx, sx, sy, color = 'rgba(255,255,255,0.6)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(sx, sy - HH);
  ctx.lineTo(sx + HW, sy);
  ctx.lineTo(sx, sy + HH);
  ctx.lineTo(sx - HW, sy);
  ctx.closePath();
  ctx.stroke();
}

/**
 * Procedural "forged metal" kit for UI chrome: a private sprite cache, the
 * theme-derived chrome colours, path helpers and the shading recipes every
 * frame / slot / button / ornament is built from.
 *
 * Recipe for one metal piece (metal()):
 *   1. soft drop shadow under the silhouette (depth against the world),
 *   2. vertical gradient light→base→dark (key light from above),
 *   3. clipped grain: hashed speckles + short brushed strokes,
 *   4. a faint diagonal sheen band,
 *   5. inner bevel: the OUTSIDE of the silhouette is filled with a shadow
 *      offset down (light rim on the top edges) and up (dark rim on the bottom
 *      edges) while clipped to the inside — the classic canvas inner-shadow trick,
 *   6. a 1px near-black outline.
 * Trim (inlays, filigree) is stroked on top: metallic (dark under-stroke, base,
 * highlight) or, with palette.trimGlow > 0, a glowing neon tube.
 *
 * Everything here is static: callers build it once into a cached sprite
 * (chromeSprite) at RENDER_SCALE and blit it per frame. Shadow blur/offsets are
 * not affected by the context transform, so they are multiplied by RENDER_SCALE.
 */
import { RENDER_SCALE, makeCanvas, mix, lighten, shade, hash2 } from '../draw_util.js';

const TAU = Math.PI * 2;
const STORE_LIMIT = 600;
const store = new Map();
const sigs = new WeakMap();

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

/**
 * Get or build a cached chrome sprite (own cache, so world-sprite churn never evicts HUD art).
 * `draw(c)` gets a context scaled to RENDER_SCALE and translated so (0,0) is the anchor.
 */
export function chromeSprite(key, w, h, ax, ay, draw) {
  const S = RENDER_SCALE;
  const k = `${key}@${S}`;
  let e = store.get(k);
  if (e) return e;
  if (store.size >= STORE_LIMIT) store.clear();
  const canvas = makeCanvas(Math.max(1, Math.ceil(w * S)), Math.max(1, Math.ceil(h * S)));
  const c = canvas.getContext('2d');
  c.scale(S, S);
  c.translate(ax, ay);
  draw(c);
  e = { canvas, ax, ay, w, h };
  store.set(k, e);
  return e;
}

/** Draw a chrome sprite with its anchor at (x, y). */
export function blitSprite(ctx, e, x, y) {
  ctx.drawImage(e.canvas, x - e.ax, y - e.ay, e.w, e.h);
}

/* ------------------------------------------------------------------ */
/* Theme colours                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fill the optional chrome keys of a merged palette from its base keys.
 *   metal      base metal tone          default mix(panel, panelBorder, 0.6)
 *   metalLight top-lit metal            default lighten(metal, 0.35)
 *   metalDark  shadowed metal           default metal × 0.4
 *   metalEdge  outlines                 default metal × 0.18
 *   trim       inlays / filigree        default accent
 *   trimGlow   0 = metallic trim, >0 = glowing neon trim (0..1 strength)
 *   recess     slot / groove cavities   default bg darkened
 *   lifeColor / manaColor  globe liquid default hp / mp
 *   gem        jewel accents            default accent
 *   ornament   'organic' (curved horns) | 'angular' (faceted blades)
 */
export function deriveChrome(p) {
  const metal = p.metal || mix(p.panel, p.panelBorder, 0.6);
  return {
    ...p,
    metal,
    metalLight: p.metalLight || lighten(metal, 0.35),
    metalDark: p.metalDark || shade(metal, 15, 0.4),
    metalEdge: p.metalEdge || shade(metal, 15, 0.18),
    trim: p.trim || p.accent,
    trimGlow: typeof p.trimGlow === 'number' ? p.trimGlow : 0,
    recess: p.recess || mix(p.bg, '#000000', 0.5),
    lifeColor: p.lifeColor || p.hp,
    manaColor: p.manaColor || p.mp,
    gem: p.gem || p.accent,
    ornament: p.ornament === 'angular' ? 'angular' : 'organic',
  };
}

/** Short signature of the chrome colours (cache keys). */
export function chromeSig(pal) {
  let s = sigs.get(pal);
  if (!s) {
    s = [pal.metal, pal.metalLight, pal.metalDark, pal.trim, pal.trimGlow, pal.recess, pal.panel, pal.panelBorder, pal.ornament, pal.lifeColor, pal.manaColor, pal.gem].join('|');
    sigs.set(pal, s);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Paths (adders: they append sub-paths, the caller owns beginPath)     */
/* ------------------------------------------------------------------ */

export function roundRectPath(c, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

/**
 * Closed outline through [x, y, sharp?] points. organic: quadratic curves through
 * edge midpoints (sharp points stay corners: tips, spikes); angular: straight facets.
 */
export function profilePath(c, pts, organic = true) {
  const n = pts.length;
  const P = (i) => pts[((i % n) + n) % n];
  if (!organic) {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    return;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(P(n - 1), P(0));
  c.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = P(i);
    const m = mid(p, P(i + 1));
    if (p[2]) {
      c.lineTo(p[0], p[1]);
      c.lineTo(m[0], m[1]);
    } else c.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  c.closePath();
}

/** Point at polar (angle degrees, radius) around (0,0). */
export function polar(deg, r, sharp) {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r, sharp ? 1 : 0];
}

/* ------------------------------------------------------------------ */
/* Shading recipes                                                     */
/* ------------------------------------------------------------------ */

function grow(box, d) {
  return { x: box.x - d, y: box.y - d, w: box.w + d * 2, h: box.h + d * 2 };
}

/** Hashed speckle + brushed-stroke grain over a box (call while clipped). */
export function grain(c, box, seed = 1, strength = 1) {
  const area = box.w * box.h;
  const n = Math.min(5000, Math.floor(area / 10));
  const light = new Path2D();
  const dark = new Path2D();
  for (let i = 0; i < n; i++) {
    const h = hash2(i, seed, 911);
    const x = box.x + ((h & 0xffff) / 0xffff) * box.w;
    const y = box.y + ((h >>> 16) / 0xffff) * box.h;
    const s = 0.5 + ((h >>> 8) & 3) * 0.25;
    ((h >>> 3) & 1 ? light : dark).rect(x, y, s, s);
  }
  c.fillStyle = `rgba(255,255,255,${0.07 * strength})`;
  c.fill(light);
  c.fillStyle = `rgba(0,0,0,${0.22 * strength})`;
  c.fill(dark);
  const brush = new Path2D();
  const m = Math.min(400, Math.floor(area / 90));
  for (let i = 0; i < m; i++) {
    const h = hash2(i, seed, 313);
    const x = box.x + ((h & 0xffff) / 0xffff) * box.w;
    const y = box.y + ((h >>> 16) / 0xffff) * box.h;
    const len = 4 + ((h >>> 5) & 15);
    brush.moveTo(x, y);
    brush.lineTo(x + len, y + (((h >>> 9) & 3) - 1.5) * 0.3);
  }
  c.strokeStyle = `rgba(255,255,255,${0.035 * strength})`;
  c.lineWidth = 0.5;
  c.stroke(brush);
}

/**
 * Inner bevel / inner shadow (call while clipped to the shape): fills the area
 * OUTSIDE the shape and lets only its offset shadow fall inside.
 */
export function innerShade(c, add, box, color, dx, dy, blur) {
  const S = RENDER_SCALE;
  const g = grow(box, 30 + Math.abs(dx) + Math.abs(dy) + blur * 2);
  c.save();
  c.shadowColor = color;
  c.shadowBlur = blur * S;
  c.shadowOffsetX = dx * S;
  c.shadowOffsetY = dy * S;
  c.fillStyle = '#000';
  c.beginPath();
  c.rect(g.x, g.y, g.w, g.h);
  add(c);
  c.fill('evenodd');
  c.restore();
}

/**
 * Forged metal piece. o: {color, light (top lift 0..1), bevel (px), shadow (blur px, 0 = none),
 * texture, outline, rule ('evenodd' for frames with holes), seed, sheen}
 */
export function metal(c, add, box, pal, o = {}) {
  const S = RENDER_SCALE;
  const base = o.color || pal.metal;
  const rule = o.rule || 'nonzero';
  const path = () => {
    c.beginPath();
    add(c);
  };
  c.save();
  const sh = o.shadow == null ? 5 : o.shadow;
  if (sh > 0) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.75)';
    c.shadowBlur = sh * S;
    c.shadowOffsetY = Math.max(1, sh * 0.4) * S;
    c.fillStyle = shade(base, 15, 0.25);
    path();
    c.fill(rule);
    c.restore();
  }
  const lift = o.light == null ? 0.32 : o.light;
  const g = c.createLinearGradient(0, box.y, 0, box.y + box.h);
  g.addColorStop(0, lighten(base, lift));
  g.addColorStop(0.32, mix(base, lighten(base, lift), 0.25));
  g.addColorStop(0.62, base);
  g.addColorStop(1, shade(base, 15, 0.42));
  c.fillStyle = g;
  path();
  c.fill(rule);
  c.save();
  path();
  c.clip(rule);
  if (o.texture !== false) grain(c, box, o.seed || 1, o.grain == null ? 1 : o.grain);
  if (o.sheen !== false) {
    const sg = c.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.42, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    sg.addColorStop(0.58, 'rgba(255,255,255,0)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sg;
    c.fillRect(box.x, box.y, box.w, box.h);
  }
  const bv = o.bevel == null ? 1.5 : o.bevel;
  if (bv > 0) {
    innerShade(c, add, box, `rgba(255,255,255,${o.bevelLight == null ? 0.38 : o.bevelLight})`, bv * 0.5, bv, bv * 0.8);
    innerShade(c, add, box, 'rgba(0,0,0,0.55)', -bv * 0.5, -bv, bv * 0.9);
  }
  c.restore();
  if (o.outline !== false) {
    c.strokeStyle = pal.metalEdge;
    c.lineWidth = o.outlineW || 1;
    c.lineJoin = 'round';
    path();
    c.stroke();
  }
  c.restore();
}

/**
 * Recessed cavity (slot well, groove, plaque): dark fill, deep inner shadow from the
 * top-left, faint light catch on the bottom lip.
 */
export function recess(c, add, box, pal, o = {}) {
  const depth = o.depth == null ? 3 : o.depth;
  const base = o.color || pal.recess;
  c.save();
  const g = c.createLinearGradient(0, box.y, 0, box.y + box.h);
  g.addColorStop(0, shade(base, 15, 0.6));
  g.addColorStop(1, mix(base, pal.metal, 0.25));
  c.globalAlpha = o.alpha == null ? 1 : o.alpha;
  c.fillStyle = g;
  c.beginPath();
  add(c);
  c.fill();
  c.globalAlpha = 1;
  c.beginPath();
  add(c);
  c.clip();
  innerShade(c, add, box, 'rgba(0,0,0,0.95)', depth * 0.4, depth, depth * 1.6);
  innerShade(c, add, box, `rgba(255,255,255,${o.lip == null ? 0.16 : o.lip})`, 0, -1, 0.6);
  c.restore();
}

/** Engraved groove along a path: dark cut with a light catch one pixel below. */
export function engrave(c, add, strength = 1, width = 1) {
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = width;
  c.strokeStyle = `rgba(0,0,0,${0.6 * strength})`;
  c.beginPath();
  add(c);
  c.stroke();
  c.translate(0, 0.8);
  c.strokeStyle = `rgba(255,255,255,${0.14 * strength})`;
  c.lineWidth = width * 0.8;
  c.beginPath();
  add(c);
  c.stroke();
  c.restore();
}

/** Trim inlay along a path: metallic (gold/brass) or a glowing neon tube (pal.trimGlow > 0). */
export function trimStroke(c, add, pal, w = 1.4, color) {
  const S = RENDER_SCALE;
  const col = color || pal.trim;
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const path = () => {
    c.beginPath();
    add(c);
  };
  if (pal.trimGlow > 0) {
    c.shadowColor = col;
    c.shadowBlur = 7 * S * pal.trimGlow;
    c.strokeStyle = mix(col, '#000000', 0.15);
    c.lineWidth = w;
    path();
    c.stroke();
    c.stroke();
    c.shadowBlur = 0;
    c.strokeStyle = lighten(col, 0.6);
    c.lineWidth = Math.max(0.5, w * 0.4);
    path();
    c.stroke();
  } else {
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.lineWidth = w + 1.4;
    c.translate(0, 0.5);
    path();
    c.stroke();
    c.translate(0, -0.5);
    c.strokeStyle = shade(col, 15, 0.62);
    c.lineWidth = w;
    path();
    c.stroke();
    c.strokeStyle = col;
    c.lineWidth = w * 0.6;
    c.translate(0, -w * 0.15);
    path();
    c.stroke();
    c.strokeStyle = lighten(col, 0.55);
    c.lineWidth = Math.max(0.4, w * 0.22);
    c.translate(0, -w * 0.18);
    path();
    c.stroke();
  }
  c.restore();
}

/** Domed rivet / stud. Glowing themes get a lit core (an LED). */
export function rivet(c, x, y, r, pal, color) {
  const base = color || pal.metal;
  c.save();
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
  g.addColorStop(0, lighten(base, 0.75));
  g.addColorStop(0.45, lighten(base, 0.15));
  g.addColorStop(1, shade(base, 15, 0.3));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.75)';
  c.lineWidth = 0.6;
  c.stroke();
  if (pal.trimGlow > 0 && !color) {
    c.shadowColor = pal.trim;
    c.shadowBlur = 4 * RENDER_SCALE * pal.trimGlow;
    c.fillStyle = lighten(pal.trim, 0.3);
    c.beginPath();
    c.arc(x, y, r * 0.42, 0, TAU);
    c.fill();
  }
  c.restore();
}

/** Cut jewel in a metal bezel. */
export function gem(c, x, y, r, color, pal) {
  const S = RENDER_SCALE;
  c.save();
  // bezel
  c.shadowColor = 'rgba(0,0,0,0.7)';
  c.shadowBlur = 3 * S;
  c.shadowOffsetY = 1 * S;
  const bz = c.createLinearGradient(0, y - r - 2, 0, y + r + 2);
  bz.addColorStop(0, pal.trimGlow > 0 ? pal.metalLight : lighten(pal.trim, 0.3));
  bz.addColorStop(1, pal.trimGlow > 0 ? pal.metalDark : shade(pal.trim, 15, 0.35));
  c.fillStyle = bz;
  c.beginPath();
  c.arc(x, y, r + 1.6, 0, TAU);
  c.fill();
  c.shadowColor = 'transparent';
  // stone
  if (pal.trimGlow > 0) {
    c.shadowColor = color;
    c.shadowBlur = 6 * S * pal.trimGlow;
  }
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  g.addColorStop(0, lighten(color, 0.7));
  g.addColorStop(0.35, lighten(color, 0.15));
  g.addColorStop(0.8, color);
  g.addColorStop(1, shade(color, 15, 0.3));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  c.shadowBlur = 0;
  // facets
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = 0.5;
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    c.moveTo(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45);
    c.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95);
  }
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.beginPath();
  c.ellipse(x - r * 0.32, y - r * 0.38, r * 0.22, r * 0.13, -0.6, 0, TAU);
  c.fill();
  c.restore();
}

/**
 * Tapered spike from a base centre (x, y) pointing at angle `deg` (0 = right, -90 = up).
 * organic spikes get a slight curl.
 */
export function spikePath(c, x, y, len, w, deg, organic, curl = 0) {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const px = -uy;
  const py = ux;
  const tip = [x + ux * len + px * curl, y + uy * len + py * curl, 1];
  const l = [x + px * w / 2, y + py * w / 2, 1];
  const r = [x - px * w / 2, y - py * w / 2, 1];
  if (!organic) {
    const mid = 0.45;
    profilePath(c, [l, [x + ux * len * mid + px * w * 0.32, y + uy * len * mid + py * w * 0.32, 1], tip, [x + ux * len * mid - px * w * 0.22, y + uy * len * mid - py * w * 0.22, 1], r], false);
    return;
  }
  const bend = curl * 0.5;
  profilePath(c, [l, [x + ux * len * 0.5 + px * (w * 0.3 + bend), y + uy * len * 0.5 + py * (w * 0.3 + bend)], tip, [x + ux * len * 0.5 - px * (w * 0.2 - bend), y + uy * len * 0.5 - py * (w * 0.2 - bend)], r], true);
}

export { TAU };

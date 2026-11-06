/**
 * Volume-shading helpers shared by the actor, object and item drawers.
 *
 * Everything here runs only while a sprite is being rasterised into the cache
 * (see draw_util.cached), never per frame, so gradients and compositing passes
 * are affordable. The conventions every drawer follows:
 *
 *   - Key light comes from the upper-left of the screen (LIGHT_X, LIGHT_Y). Every
 *     gradient puts its highlight on that side, whatever way the sprite faces, so
 *     the whole scene reads as lit from one place.
 *   - `inked(c, paint, opts)` paints a sprite into a scratch layer, adds a rim light
 *     on the lit edge and a dark outline around the silhouette, then composites it.
 *     This is what turns flat procedural shapes into "painted game art".
 *   - Colours are always parameters: these helpers know nothing about any setting.
 */
import { makeCanvas, parseColor, mix } from './draw_util.js';

export const LIGHT_X = -0.62;
export const LIGHT_Y = -0.78;
const TAU = Math.PI * 2;
const OUTLINE_DEFAULT = 'rgba(10,8,12,0.92)';
const RIM_DEFAULT = '#fff6e8';
const OFFS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

const scratch = [null, null];

function layer(i, w, h) {
  let cv = scratch[i];
  if (!cv || cv.width !== w || cv.height !== h) {
    cv = makeCanvas(w, h);
    scratch[i] = cv;
  }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  return cv;
}

/** Highlight strength scaled down for already-bright colours so they don't blow out to white. */
export function hiFor(color, hi) {
  return hi * (1 - 0.7 * luma(color));
}

/** 'rgba(r,g,b,a)' from any colour accepted by parseColor. */
export function rgba(color, a) {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${a})`;
}

/** Multiply toward black (k=1 unchanged, 0 black). */
export function dark(color, k) {
  return mix(color, '#000000', 1 - k);
}

/** Blend toward white. */
export function light(color, t) {
  return mix(color, '#ffffff', t);
}

/** Perceived luminance 0..1. */
export function luma(color) {
  const [r, g, b] = parseColor(color);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Paint a sprite with an outline and a rim light.
 * `paint(g)` receives a context with the same transform as `c`.
 * opts: { outline, outlineW (logical px), rim, rimAlpha, flash (0..1 white overlay), post(g) }
 */
export function inked(c, paint, opts = {}) {
  const W = c.canvas.width;
  const H = c.canvas.height;
  const m = c.getTransform();
  const S = Math.hypot(m.a, m.b) || 1;
  const A = layer(0, W, H);
  const a = A.getContext('2d');
  a.setTransform(m);
  paint(a);
  a.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.flash) {
    a.globalCompositeOperation = 'source-atop';
    a.fillStyle = `rgba(255,255,255,${opts.flash})`;
    a.fillRect(0, 0, W, H);
    a.globalCompositeOperation = 'source-over';
  }
  const B = layer(1, W, H);
  const b = B.getContext('2d');
  // Rim: the silhouette minus itself shifted away from the light = a thin band on the lit edge.
  const rimA = opts.rimAlpha ?? 0.4;
  if (rimA > 0) {
    b.drawImage(A, 0, 0);
    b.globalCompositeOperation = 'source-in';
    b.fillStyle = opts.rim || RIM_DEFAULT;
    b.fillRect(0, 0, W, H);
    b.globalCompositeOperation = 'destination-out';
    b.drawImage(A, -LIGHT_X * S * 1.1, -LIGHT_Y * S * 1.1);
    a.globalCompositeOperation = 'source-atop';
    a.globalAlpha = rimA;
    a.drawImage(B, 0, 0);
    a.globalAlpha = 1;
    a.globalCompositeOperation = 'source-over';
    b.globalCompositeOperation = 'copy';
  }
  // Outline: the silhouette in ink, stamped at 8 offsets behind the sprite.
  b.drawImage(A, 0, 0);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = opts.outline || OUTLINE_DEFAULT;
  b.fillRect(0, 0, W, H);
  b.globalCompositeOperation = 'source-over';
  const d = (opts.outlineW ?? 1) * S;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (d > 0) for (const [ox, oy] of OFFS8) c.drawImage(B, ox * d, oy * d);
  c.drawImage(A, 0, 0);
  c.restore();
}

/** Soft elliptical contact shadow centred at (x, y). */
export function contactShadow(c, x, y, rx, ry, alpha = 0.5) {
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.6})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, rx, 0, TAU);
  c.fill();
  c.restore();
}

/** Linear gradient across a box, lit on the upper-left. */
export function litLinear(c, x0, y0, x1, y1, color, hi = 0.3, lo = 0.45) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, light(color, hiFor(color, hi)));
  g.addColorStop(0.38, color);
  g.addColorStop(1, dark(color, lo));
  return g;
}

/** Horizontal lit gradient for a shape spanning [xl, xr]. */
export function litH(c, xl, xr, color, hi = 0.3, lo = 0.45) {
  return litLinear(c, xl, 0, xr, 0, color, hi, lo);
}

/** Radial gradient for a round volume of radius r at (x, y) with its highlight up-left. */
export function litRadial(c, x, y, r, color, hi = 0.45, lo = 0.4) {
  const g = c.createRadialGradient(x + LIGHT_X * r * 0.45, y + LIGHT_Y * r * 0.45, r * 0.08, x, y, r * 1.05);
  g.addColorStop(0, light(color, hiFor(color, hi)));
  g.addColorStop(0.45, color);
  g.addColorStop(1, dark(color, lo));
  return g;
}

/** A shaded sphere. */
export function sphere(c, x, y, r, color, hi, lo) {
  c.fillStyle = litRadial(c, x, y, r, color, hi, lo);
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

/**
 * Tapered capsule from (x0,y0) radius r0 to (x1,y1) radius r1, shaded across its width
 * (lit side toward the key light).
 */
export function capsule(c, x0, y0, x1, y1, r0, r1, color, hi = 0.3, lo = 0.5) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 0.001;
  let nx = -dy / len;
  let ny = dx / len;
  if (nx * LIGHT_X + ny * LIGHT_Y < 0) { nx = -nx; ny = -ny; } // n points at the light
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const rm = Math.max(r0, r1);
  const g = c.createLinearGradient(mx + nx * rm, my + ny * rm, mx - nx * rm, my - ny * rm);
  g.addColorStop(0, light(color, hiFor(color, hi)));
  g.addColorStop(0.35, color);
  g.addColorStop(1, dark(color, lo));
  c.fillStyle = g;
  const a = Math.atan2(dy, dx);
  c.beginPath();
  c.arc(x0, y0, r0, a + Math.PI / 2, a - Math.PI / 2);
  c.arc(x1, y1, r1, a - Math.PI / 2, a + Math.PI / 2);
  c.closePath();
  c.fill();
}

/** Fill a polygon given as [[x,y],...]. */
export function fillPts(c, pts) {
  if (!pts.length) return;
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
  c.fill();
}

/** Stroke an open polyline [[x,y],...]. */
export function strokePts(c, pts, width) {
  if (pts.length < 2) return;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.stroke();
}

/** Convex hull (monotone chain) of [[x,y],...]. */
export function hull(pts) {
  const p = pts.slice().sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Bounding box of [[x,y],...]. */
export function bbox(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Rivet / stud: a tiny bright dot with a dark underside. */
export function rivet(c, x, y, r, color) {
  c.fillStyle = dark(color, 0.35);
  c.beginPath();
  c.arc(x + r * 0.25, y + r * 0.3, r, 0, TAU);
  c.fill();
  c.fillStyle = light(color, 0.45);
  c.beginPath();
  c.arc(x, y, r * 0.85, 0, TAU);
  c.fill();
}

/** Iso box (footprint half extents hw, hh; height h) with shaded faces; returns the top-face y. */
export function isoBlock(c, x, y, hw, hh, h, color, opts = {}) {
  const leftC = opts.left || dark(color, 0.72);
  const rightC = opts.right || dark(color, 0.5);
  c.fillStyle = litLinear(c, x - hw, y - h, x, y + hh, leftC, 0.12, 0.25);
  fillPts(c, [[x - hw, y], [x, y + hh], [x, y + hh - h], [x - hw, y - h]]);
  c.fillStyle = litLinear(c, x, y - h, x + hw, y + hh, rightC, 0.08, 0.3);
  fillPts(c, [[x, y + hh], [x + hw, y], [x + hw, y - h], [x, y + hh - h]]);
  c.fillStyle = litLinear(c, x - hw, y - h - hh, x + hw, y - h + hh, opts.top || color, 0.22, 0.2);
  fillPts(c, [[x, y - h - hh], [x + hw, y - h], [x, y - h + hh], [x - hw, y - h]]);
  if (opts.edge !== false) {
    c.strokeStyle = rgba(light(opts.top || color, 0.5), 0.55);
    c.lineWidth = 0.6;
    c.beginPath();
    c.moveTo(x - hw, y - h); c.lineTo(x, y + hh - h); c.lineTo(x + hw, y - h);
    c.stroke();
  }
  return y - h;
}

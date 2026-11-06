/**
 * Shared helpers for the procedural sprite drawers: a string-keyed cache
 * of offscreen canvases, colour parsing / shading by light level, a tiny
 * deterministic hash for texture noise, and direction -> screen vectors.
 *
 * Light (0..15) darkens toward black with a mild gamma so explored-but-dark
 * tiles (light 2) remain faintly readable.
 */
import { DIRS8, DIR_COUNT } from '../world/pathfind.js';

export const MAX_LIGHT = 15;
const CACHE_LIMIT = 4000;
const LIGHT_GAMMA = 0.7;
const HEX_SHORT_LEN = 4;
const HEX_LONG_LEN = 7;
const BYTE = 255;
const HASH_A = 374761393;
const HASH_B = 668265263;
const HASH_C = 1274126177;
const ISO_RATIO = 2; // TILE_W / TILE_H
const FALLBACK_RGB = [128, 128, 128];
const TAU = Math.PI * 2;

const spriteCache = new Map();

/**
 * Backing-store scale. The game works in logical 960x540 pixels; the canvas and every cached
 * sprite are rasterised at RENDER_SCALE× so art stays crisp when the page scales it up.
 * main.js sets it once at boot (before anything is cached).
 */
export let RENDER_SCALE = 1;
export function setRenderScale(s) {
  if (s !== RENDER_SCALE) { RENDER_SCALE = s; spriteCache.clear(); }
}
const colorCache = new Map();

/** Create an offscreen canvas of the given size. */
export function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

/**
 * Get or build a cached sprite. `draw(c)` receives a context already
 * translated so (0,0) is the anchor point (ax, ay) inside the canvas.
 * @returns {{canvas:HTMLCanvasElement, ax:number, ay:number}}
 */
export function cached(key, w, h, ax, ay, draw) {
  let entry = spriteCache.get(key);
  if (entry) return entry;
  if (spriteCache.size >= CACHE_LIMIT) spriteCache.clear();
  const S = RENDER_SCALE;
  const canvas = makeCanvas(Math.ceil(w * S), Math.ceil(h * S));
  const c = canvas.getContext('2d');
  c.scale(S, S);
  c.translate(ax, ay);
  draw(c);
  entry = { canvas, ax, ay, w, h };
  spriteCache.set(key, entry);
  return entry;
}

/** Draw a cached entry with its anchor at (sx, sy). */
export function blit(ctx, entry, sx, sy) {
  ctx.drawImage(entry.canvas, sx - entry.ax, sy - entry.ay, entry.w, entry.h);
}

/** Drop every cached sprite (e.g. on theme change). */
export function clearSpriteCache() {
  spriteCache.clear();
}

/** @returns {number} number of cached sprites */
export function spriteCacheSize() {
  return spriteCache.size;
}

/**
 * Parse '#rgb', '#rrggbb' or 'rgb(r,g,b)' into [r,g,b]. Unknown -> grey.
 * @returns {number[]}
 */
export function parseColor(color) {
  let rgb = colorCache.get(color);
  if (rgb) return rgb;
  rgb = FALLBACK_RGB;
  if (typeof color === 'string' && color[0] === '#') {
    let hex = color.slice(1, HEX_LONG_LEN);
    if (color.length === HEX_SHORT_LEN) hex = hex.split('').map((ch) => ch + ch).join('');
    const n = parseInt(hex, 16);
    if (!Number.isNaN(n)) rgb = [(n >> 16) & BYTE, (n >> 8) & BYTE, n & BYTE];
  } else if (typeof color === 'string' && color.startsWith('rgb')) {
    const parts = color.match(/[\d.]+/g);
    if (parts && parts.length >= 3) rgb = parts.slice(0, 3).map(Number);
  }
  colorCache.set(color, rgb);
  return rgb;
}

/** Brightness multiplier 0..1 for a light level 0..15. */
export function lightFactor(light) {
  const l = Math.max(0, Math.min(MAX_LIGHT, light)) / MAX_LIGHT;
  return Math.pow(l, LIGHT_GAMMA);
}

/** Return a CSS colour darkened by light level, times an extra multiplier. */
export function shade(color, light = MAX_LIGHT, mult = 1) {
  const [r, g, b] = parseColor(color);
  const f = lightFactor(light) * mult;
  return `rgb(${clampByte(r * f)},${clampByte(g * f)},${clampByte(b * f)})`;
}

/** Linear blend between two colours, t in 0..1. */
export function mix(colorA, colorB, t) {
  const a = parseColor(colorA);
  const b = parseColor(colorB);
  return `rgb(${clampByte(a[0] + (b[0] - a[0]) * t)},${clampByte(a[1] + (b[1] - a[1]) * t)},${clampByte(a[2] + (b[2] - a[2]) * t)})`;
}

/** Blend toward white. */
export function lighten(color, t) {
  return mix(color, '#ffffff', t);
}

function clampByte(v) {
  return Math.max(0, Math.min(BYTE, Math.round(v)));
}

/** Deterministic 32-bit hash of two ints and a seed (texture noise). */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, HASH_A) ^ Math.imul(y | 0, HASH_B) ^ Math.imul((seed | 0) + 1, HASH_C);
  h = Math.imul(h ^ (h >>> 13), HASH_A);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Unit screen-space vector for a direction index (0..7), accounting for the
 * 2:1 isometric squash.
 * @returns {{x:number,y:number}}
 */
export function dirToScreen(dir) {
  const d = DIRS8[(((dir | 0) % DIR_COUNT) + DIR_COUNT) % DIR_COUNT];
  const x = (d[0] - d[1]) * ISO_RATIO;
  const y = d[0] + d[1];
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/* ---- tiny shape helpers shared by the drawers ---- */

export function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

export function ellipse(c, x, y, rx, ry) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, TAU);
  c.fill();
}

/** Fill a polygon from a flat [x0,y0,x1,y1,...] array. */
export function poly(c, pts) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
}

export function line(c, x0, y0, x1, y1, width = 1) {
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

/** Fill a diamond centred at (x,y) with half extents (hw, hh). */
export function diamond(c, x, y, hw, hh) {
  poly(c, [x, y - hh, x + hw, y, x, y + hh, x - hw, y]);
}

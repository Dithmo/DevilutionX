/**
 * Immediate-mode UI primitives shared by every UI module, plus the per-frame
 * hit registry: anything clickable is drawn AND registered in the same call
 * (`registerHit`), so click handling resolves against exactly the rects that
 * were rendered last frame and the two can never disagree.
 *
 * All colours come from the theme palette (`palette(game)`), all labels from
 * `str(game, key, fallback)`.
 */
import { drawItemGlyph } from '../sprites.js';
import { mix, lighten, shade, parseColor, RENDER_SCALE } from '../draw_util.js';
import {
  deriveChrome, chromeSig, chromeSprite, blitSprite, roundRectPath, metal, recess, engrave, trimStroke, rivet, innerShade, TAU,
} from './chrome.js';

const DEFAULT_FONT = '14px system-ui, sans-serif';
const DEFAULT_SIZE = 14;
const SHADOW_OFFSET = 1;
const SHADOW_ALPHA = 0.8;
const PANEL_ALPHA = 0.94;
const PANEL_FRAME = 6; // metal frame width; panel content keeps clear of it
const PANEL_PAD = 10; // sprite margin for the drop shadow
const SLOT_PAD = 6;
const DISABLED_ALPHA = 0.45;
const GLOBE_WAVE_PX = 1.8;
const GLOBE_WAVE_STEP = 3;
const GLOBE_SWIRL_A = 0.012; // rad per tick, bright arms
const GLOBE_SWIRL_B = 0.007; // dark arms turn the other way
const GLOBE_BUBBLES = 7;
const ICON_GLYPH_PAD = 6;
const BAR_LIP_ALPHA = 0.12;
const ELLIPSIS = '…';

export const DEFAULT_PALETTE = Object.freeze(deriveChrome({
  bg: '#0a0a0c',
  panel: '#1b1a1f',
  panelBorder: '#6e5a3a',
  text: '#e8e0cc',
  textDim: '#8d867a',
  accent: '#7fb7ff',
  hp: '#b8232f',
  mp: '#2b58c7',
  xp: '#c9a24a',
  gold: '#e9c24a',
  rarity: { normal: '#e8e0cc', magic: '#7fb7ff', rare: '#f0e35a', unique: '#d9a441' },
  danger: '#e04545',
  good: '#67d36a',
  light: '#ffd27a',
  font: DEFAULT_FONT,
}));

const CHROME_KEYS = ['metal', 'metalLight', 'metalDark', 'metalEdge', 'trim', 'trimGlow', 'recess', 'lifeColor', 'manaColor', 'gem', 'ornament'];

/** Merged palette for the game (theme values over defaults). */
export function palette(game) {
  const p = game && game.theme && game.theme.palette;
  if (!p) return DEFAULT_PALETTE;
  if (p === game.ui?._palSrc) return game.ui._pal;
  // Chrome keys (metal, trim, lifeColor, ...) are derived from the theme's own base keys
  // unless the theme sets them, so they never fall back to the default theme's metal.
  const base = { ...DEFAULT_PALETTE };
  for (const k of CHROME_KEYS) delete base[k];
  const merged = deriveChrome({ ...base, ...p, rarity: { ...DEFAULT_PALETTE.rarity, ...(p.rarity || {}) } });
  if (game.ui) {
    game.ui._palSrc = p;
    game.ui._pal = merged;
  }
  return merged;
}

/** Localised string with fallback: game.strings, then theme.strings, then the fallback. */
export function str(game, key, fallback) {
  const s = game && game.strings && game.strings[key];
  if (typeof s === 'string') return s;
  const t = game && game.theme && game.theme.strings && game.theme.strings[key];
  return typeof t === 'string' ? t : fallback;
}

/** Colour for an item's quality tier; red when the player cannot use it. */
export function rarityColor(game, item) {
  const pal = palette(game);
  if (!item) return pal.text;
  if (item.quality === 'unique') return pal.rarity.unique;
  if (item.quality === 'rare') return pal.rarity.rare;
  if (item.quality === 'magic') return pal.rarity.magic;
  return pal.rarity.normal;
}

/** Make the base font string at a given pixel size (keeps the palette family). */
export function fontAt(game, size = DEFAULT_SIZE, weight = '') {
  const base = palette(game).font || DEFAULT_FONT;
  const family = base.replace(/^[^a-zA-Z]*?\d+(\.\d+)?px\s*/, '');
  return `${weight ? `${weight} ` : ''}${size}px ${family}`;
}

/** @returns {boolean} */
export function pointInRect(x, y, r) {
  return !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Inset a rect on all sides. */
export function inset(r, d) {
  return { x: r.x + d, y: r.y + d, w: r.w - d * 2, h: r.h - d * 2 };
}

/* ------------------------------------------------------------------ */
/* Hit registry                                                        */
/* ------------------------------------------------------------------ */

/** Reset the registry at the start of a render pass. */
export function beginHits(game) {
  game.ui._hits = [];
}

/**
 * Register a clickable rect with a payload describing what it is.
 * Later registrations win (draw order == stacking order).
 * @param {object} game
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {object} payload e.g. { kind:'invCell', cx, cy }
 */
export function registerHit(game, rect, payload) {
  if (!game.ui._hits) game.ui._hits = [];
  game.ui._hits.push({ rect, payload });
}

/** Topmost registered hit under a point, or null. */
export function hitAt(game, x, y) {
  const hits = game.ui && game.ui._hits;
  if (!hits) return null;
  for (let i = hits.length - 1; i >= 0; i--) {
    if (pointInRect(x, y, hits[i].rect)) return hits[i];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/**
 * Draw one line of text.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y baseline-top (textBaseline = 'top')
 * @param {{color?:string,size?:number,align?:CanvasTextAlign,font?:string,shadow?:boolean,alpha?:number,weight?:string,maxW?:number,game?:object}} [opts]
 * @returns {number} drawn text width
 */
export function drawText(ctx, text, x, y, opts = {}) {
  const t = text == null ? '' : String(text);
  ctx.font = opts.font || fontAt(opts.game, opts.size || DEFAULT_SIZE, opts.weight);
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = 'top';
  let out = t;
  if (opts.maxW) out = ellipsize(ctx, t, opts.maxW);
  const prevAlpha = ctx.globalAlpha;
  if (typeof opts.alpha === 'number') ctx.globalAlpha = prevAlpha * opts.alpha;
  if (opts.shadow !== false) {
    ctx.fillStyle = `rgba(0,0,0,${SHADOW_ALPHA})`;
    ctx.fillText(out, x + SHADOW_OFFSET, y + SHADOW_OFFSET);
  }
  ctx.fillStyle = opts.color || DEFAULT_PALETTE.text;
  ctx.fillText(out, x, y);
  const w = ctx.measureText(out).width;
  ctx.globalAlpha = prevAlpha;
  ctx.textAlign = 'left';
  return w;
}

/** Measure text width in the given font. */
export function measureText(ctx, text, font) {
  ctx.font = font;
  return ctx.measureText(String(text)).width;
}

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ELLIPSIS).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ELLIPSIS;
}

/**
 * Word-wrap text to a pixel width in the given font.
 * @returns {string[]} lines
 */
export function wrapText(ctx, text, maxW, font) {
  if (font) ctx.font = font;
  const lines = [];
  for (const para of String(text == null ? '' : text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const trial = `${line} ${words[i]}`;
      if (ctx.measureText(trial).width <= maxW) line = trial;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Boxes, buttons, bars                                                */
/* ------------------------------------------------------------------ */

/**
 * Forged-metal panel: dark translucent body with an inner shadow, a bevelled
 * metal frame, an inner trim line, corner brackets with rivets and an optional
 * title flanked by trim flourishes. The static part is one cached sprite per size.
 * @param {{alpha?:number,title?:string,game:object,titleColor?:string}} opts
 */
export function drawPanel(ctx, rect, opts = {}) {
  const pal = palette(opts.game);
  const alpha = opts.alpha == null ? PANEL_ALPHA : opts.alpha;
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  const sp = chromeSprite(`panel|${chromeSig(pal)}|${w}x${h}|${alpha}`, w + PANEL_PAD * 2, h + PANEL_PAD * 2, PANEL_PAD, PANEL_PAD, (c) => buildPanel(c, w, h, alpha, pal));
  blitSprite(ctx, sp, rect.x, rect.y);
  if (opts.title) {
    const size = 15;
    const tw = drawText(ctx, opts.title, rect.x + rect.w / 2, rect.y + 9, {
      color: opts.titleColor || pal.gold, align: 'center', size, weight: 'bold', game: opts.game,
    });
    drawTitleFlourish(ctx, rect.x + rect.w / 2, rect.y + 9 + size / 2 + 1, tw, Math.min(70, rect.w / 2 - tw / 2 - 18), pal);
  }
}

function buildPanel(c, w, h, alpha, pal) {
  const outer = (k) => roundRectPath(k, 0, 0, w, h, 5);
  const inner = (k) => roundRectPath(k, PANEL_FRAME, PANEL_FRAME, w - PANEL_FRAME * 2, h - PANEL_FRAME * 2, 3);
  // body
  c.save();
  c.globalAlpha = alpha;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mix(pal.panel, pal.metal, 0.22));
  g.addColorStop(0.4, pal.panel);
  g.addColorStop(1, mix(pal.panel, '#000000', 0.35));
  c.fillStyle = g;
  c.beginPath();
  inner(c);
  c.fill();
  c.restore();
  c.save();
  c.beginPath();
  inner(c);
  c.clip();
  innerShade(c, inner, { x: 0, y: 0, w, h }, 'rgba(0,0,0,0.85)', 0, 3, 10);
  if (pal.trimGlow > 0) {
    const vg = c.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, mix(pal.trim, '#000000', 0.8));
    c.globalAlpha = 0.25 * alpha;
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
  }
  c.restore();
  // frame
  const frame = (k) => {
    outer(k);
    inner(k);
  };
  metal(c, frame, { x: 0, y: 0, w, h: Math.min(h, 60) }, pal, { rule: 'evenodd', shadow: 6, bevel: 1.2, light: 0.4, seed: w * 7 + h });
  // re-light the long frame with a full-height gradient so the bottom edge is darker
  c.save();
  c.beginPath();
  frame(c);
  c.clip('evenodd');
  const fg = c.createLinearGradient(0, 0, 0, h);
  fg.addColorStop(0, 'rgba(0,0,0,0)');
  fg.addColorStop(1, 'rgba(0,0,0,0.35)');
  c.fillStyle = fg;
  c.fillRect(0, 0, w, h);
  c.restore();
  engrave(c, (k) => roundRectPath(k, 2.5, 2.5, w - 5, h - 5, 4), 0.8);
  // inner trim line
  const ti = PANEL_FRAME + 3;
  c.save();
  c.globalAlpha = pal.trimGlow > 0 ? 0.75 : 0.55;
  trimStroke(c, (k) => roundRectPath(k, ti, ti, w - ti * 2, h - ti * 2, 2), pal, 0.8);
  c.restore();
  // corner brackets + rivets
  const L = Math.min(22, w / 5, h / 5);
  for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const x = sx ? w : 0;
    const y = sy ? h : 0;
    const dx = sx ? -1 : 1;
    const dy = sy ? -1 : 1;
    const br = (k) => {
      k.moveTo(x + dx * 2, y + dy * (L + 4));
      k.lineTo(x + dx * 2, y + dy * 2);
      k.lineTo(x + dx * (L + 4), y + dy * 2);
      k.lineTo(x + dx * (L + 4), y + dy * 7);
      k.lineTo(x + dx * 9, y + dy * 9);
      k.lineTo(x + dx * 7, y + dy * (L + 4));
      k.closePath();
    };
    metal(c, br, { x: Math.min(x, x + dx * (L + 4)), y: Math.min(y, y + dy * (L + 4)), w: L + 4, h: L + 4 }, pal, { color: mix(pal.metal, pal.metalLight, 0.45), shadow: 3, bevel: 1, texture: false, light: 0.3 });
    c.save();
    c.globalAlpha = 0.9;
    trimStroke(c, (k) => {
      k.moveTo(x + dx * 7.5, y + dy * (L + 1));
      k.lineTo(x + dx * 8.5, y + dy * 8.5);
      k.lineTo(x + dx * (L + 1), y + dy * 7.5);
    }, pal, 0.7);
    c.restore();
    rivet(c, x + dx * 5.5, y + dy * 5.5, 2, pal, pal.trimGlow > 0 ? null : pal.trim);
  }
}

function drawTitleFlourish(ctx, cx, y, textW, len, pal) {
  if (len < 8) return;
  ctx.save();
  ctx.lineWidth = 1;
  for (const s of [-1, 1]) {
    const x0 = cx + s * (textW / 2 + 8);
    const x1 = x0 + s * len;
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, pal.trim);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x1, y + 0.5);
    ctx.stroke();
    ctx.fillStyle = pal.trim;
    ctx.beginPath();
    ctx.moveTo(x0 - s * 4, y + 0.5);
    ctx.lineTo(x0, y - 2.5);
    ctx.lineTo(x0 + s * 4, y + 0.5);
    ctx.lineTo(x0, y + 3.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Metal plate button with hover / active / disabled states (plates cached per size and state).
 * @param {{hover?:boolean,active?:boolean,disabled?:boolean,game:object,size?:number,color?:string}} state
 */
export function drawButton(ctx, rect, label, state = {}) {
  const pal = palette(state.game);
  const prev = ctx.globalAlpha;
  if (state.disabled) ctx.globalAlpha = prev * DISABLED_ALPHA;
  const mode = state.active ? 'active' : state.hover && !state.disabled ? 'hover' : 'idle';
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  const sp = chromeSprite(`btn|${chromeSig(pal)}|${w}x${h}|${mode}`, w + 8, h + 8, 4, 4, (c) => buildButton(c, w, h, mode, pal));
  blitSprite(ctx, sp, rect.x, rect.y);
  const size = state.size || Math.min(DEFAULT_SIZE, Math.max(10, rect.h - 7));
  const textCol = state.color || (mode === 'active' ? lighten(pal.text, 0.3) : mode === 'hover' ? lighten(pal.text, 0.2) : pal.text);
  drawText(ctx, label, rect.x + rect.w / 2, rect.y + (rect.h - size) / 2 - 0.5, {
    color: textCol, align: 'center', size, game: state.game, maxW: rect.w - 6,
  });
  ctx.globalAlpha = prev;
}

function buildButton(c, w, h, mode, pal) {
  const add = (k) => roundRectPath(k, 0, 0, w, h, Math.min(4, h / 4));
  let col = mix(pal.metal, pal.metalLight, 0.12);
  if (mode === 'hover') col = mix(pal.metal, pal.metalLight, 0.45);
  if (mode === 'active') col = mix(pal.metal, pal.trim, pal.trimGlow > 0 ? 0.3 : 0.38);
  metal(c, add, { x: 0, y: 0, w, h }, pal, { color: col, shadow: 3, bevel: 1.1, light: 0.4, seed: w + h * 3, grain: 0.7 });
  // inner face: a shallow panel inset so the label reads engraved
  const face = (k) => roundRectPath(k, 2.5, 2.5, w - 5, h - 5, 2);
  c.save();
  c.globalAlpha = 0.35;
  c.fillStyle = shade(col, 15, 0.5);
  c.beginPath();
  face(c);
  c.fill();
  c.restore();
  engrave(c, face, 0.6);
  if (mode === 'active' || mode === 'hover') {
    c.save();
    c.globalAlpha = mode === 'active' ? 1 : 0.6;
    trimStroke(c, (k) => roundRectPath(k, 0.5, 0.5, w - 1, h - 1, Math.min(4, h / 4)), pal, mode === 'active' ? 1.1 : 0.8);
    c.restore();
  }
}

/**
 * Horizontal bar (hp / xp / progress) in a recessed groove with a glossy fill.
 * @param {{color:string,bg?:string,border?:string,game?:object}} opts
 */
export function drawBar(ctx, rect, ratio, opts = {}) {
  const pal = palette(opts.game);
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const color = opts.color || pal.hp;
  ctx.save();
  // groove
  ctx.fillStyle = opts.bg || 'rgba(0,0,0,0.78)';
  ctx.fillRect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(rect.x, rect.y, rect.w, 1);
  if (r > 0) {
    const fw = Math.max(1, (rect.w - 2) * r);
    const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
    g.addColorStop(0, lighten(color, 0.45));
    g.addColorStop(0.45, color);
    g.addColorStop(1, shade(color, 15, 0.45));
    ctx.fillStyle = g;
    ctx.fillRect(rect.x + 1, rect.y + 1, fw, rect.h - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(rect.x + 1, rect.y + 1, fw, Math.max(0.5, (rect.h - 2) * 0.25));
    // hot leading edge
    ctx.fillStyle = lighten(color, 0.6);
    ctx.fillRect(rect.x + 1 + fw - 1, rect.y + 1, 1, rect.h - 2);
  }
  // rim: dark top/left, light catch on the bottom
  ctx.strokeStyle = opts.border || 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.w + 1, rect.h + 1);
  ctx.fillStyle = `rgba(255,255,255,${BAR_LIP_ALPHA})`;
  ctx.fillRect(rect.x - 1, rect.y + rect.h + 1, rect.w + 2, 0.75);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Globes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Glass globe: dark glass interior, liquid filling from the bottom to `ratio`
 * (cached radial-shaded liquid + two counter-rotating swirl layers + rising
 * bubbles, clipped under a double-sine surface with a bright meniscus), then a
 * cached glass overlay (edge vignette = dark inner rim, soft dome highlight,
 * hot specular spot, coloured bottom caustic). Only the clip, two rotated blits
 * and the surface line are per-frame work.
 * @param {{color:string,tint?:string|null,tick?:number,time?:number,game?:object,frame?:boolean}} opts
 *   tint overlays e.g. mana shield; time (in ticks, may be fractional) drives the animation;
 *   frame:false skips the standalone metal ring (the HUD bakes its own socket).
 */
export function drawGlobe(ctx, cx, cy, r, ratio, opts = {}) {
  const pal = palette(opts.game);
  const color = opts.color || pal.lifeColor;
  const f = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const t = typeof opts.time === 'number' ? opts.time : opts.tick || 0;
  const R = Math.max(4, Math.round(r));
  const key = `${chromeSig(pal)}|${color}|${R}`;
  const box = R * 2 + 4;
  const back = chromeSprite(`gback|${key}`, box, box, R + 2, R + 2, (c) => buildGlobeBack(c, R, color));
  blitSprite(ctx, back, cx, cy);
  if (f > 0) {
    const liquid = chromeSprite(`gliq|${key}`, box, box, R + 2, R + 2, (c) => buildGlobeLiquid(c, R, color));
    const swirlA = chromeSprite(`gswa|${key}`, box, box, R + 2, R + 2, (c) => buildGlobeSwirl(c, R, color, 0));
    const swirlB = chromeSprite(`gswb|${key}`, box, box, R + 2, R + 2, (c) => buildGlobeSwirl(c, R, color, 1));
    const surfaceY = cy + R - f * R * 2;
    const calm = f >= 0.995;
    const waveAt = (x) => (calm ? 0 : Math.sin(x * 0.11 + t * 0.21) * GLOBE_WAVE_PX + Math.sin(x * 0.27 - t * 0.33) * GLOBE_WAVE_PX * 0.45);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - R - 2, cy + R + 2);
    for (let x = -R - 2; x <= R + 2; x += GLOBE_WAVE_STEP) ctx.lineTo(cx + x, surfaceY + waveAt(x));
    ctx.lineTo(cx + R + 2, surfaceY + waveAt(R + 2));
    ctx.lineTo(cx + R + 2, cy + R + 2);
    ctx.closePath();
    ctx.clip();
    blitSprite(ctx, liquid, cx, cy);
    ctx.translate(cx, cy);
    ctx.rotate(t * GLOBE_SWIRL_A);
    ctx.drawImage(swirlA.canvas, -swirlA.ax, -swirlA.ay, swirlA.w, swirlA.h);
    ctx.rotate(-t * (GLOBE_SWIRL_A + GLOBE_SWIRL_B));
    ctx.drawImage(swirlB.canvas, -swirlB.ax, -swirlB.ay, swirlB.w, swirlB.h);
    ctx.rotate(t * GLOBE_SWIRL_B);
    ctx.translate(-cx, -cy);
    // rising bubbles
    ctx.fillStyle = lighten(color, 0.7);
    const depth = f * R * 2;
    for (let i = 0; i < GLOBE_BUBBLES; i++) {
      const seed = (i * 73) % 97;
      const bx = cx + ((seed / 97) * 1.3 - 0.65) * R;
      const by = cy + R - ((t * (0.9 + (i % 3) * 0.35) + seed * 3.1) % Math.max(1, depth));
      ctx.globalAlpha = 0.18 + (i % 3) * 0.08;
      ctx.beginPath();
      ctx.arc(bx + Math.sin(t * 0.2 + i) * 1.5, by, 0.8 + (i % 3) * 0.45, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (opts.tint) {
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = opts.tint;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (!calm) {
      // meniscus: bright surface line with a soft glow band beneath
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R - 0.5, 0, TAU);
      ctx.clip();
      ctx.beginPath();
      for (let x = -R; x <= R; x += GLOBE_WAVE_STEP) {
        const y = surfaceY + waveAt(x);
        if (x === -R) ctx.moveTo(cx + x, y);
        else ctx.lineTo(cx + x, y);
      }
      ctx.strokeStyle = lighten(color, 0.35);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = lighten(color, 0.75);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }
  const glass = chromeSprite(`gglass|${key}`, box, box, R + 2, R + 2, (c) => buildGlobeGlass(c, R, color));
  blitSprite(ctx, glass, cx, cy);
  if (opts.frame !== false) {
    const ring = chromeSprite(`gring|${chromeSig(pal)}|${R}`, box + 24, box + 24, R + 14, R + 14, (c) => drawGlobeRing(c, R, pal));
    blitSprite(ctx, ring, cx, cy);
  }
}

function circleClip(c, R) {
  c.beginPath();
  c.arc(0, 0, R, 0, TAU);
  c.clip();
}

function buildGlobeBack(c, R, color) {
  circleClip(c, R);
  const g = c.createRadialGradient(0, -R * 0.25, R * 0.1, 0, 0, R);
  g.addColorStop(0, mix(color, '#000000', 0.72));
  g.addColorStop(0.7, mix(color, '#000000', 0.88));
  g.addColorStop(1, '#030303');
  c.fillStyle = g;
  c.fillRect(-R, -R, R * 2, R * 2);
}

function buildGlobeLiquid(c, R, color) {
  circleClip(c, R);
  const g = c.createRadialGradient(-R * 0.18, R * 0.12, R * 0.05, 0, 0, R * 1.02);
  g.addColorStop(0, lighten(color, 0.32));
  g.addColorStop(0.35, lighten(color, 0.08));
  g.addColorStop(0.7, color);
  g.addColorStop(1, shade(color, 15, 0.32));
  c.fillStyle = g;
  c.fillRect(-R, -R, R * 2, R * 2);
}

/**
 * Vortex layer, clipped to the globe: layer 0 = two broad bright arms plus a lit core,
 * layer 1 = two dark arms between them (rotates the other way). Arms are stroked in
 * short segments whose width and alpha swell and fade, then blurred.
 */
function buildGlobeSwirl(c, R, color, layer) {
  circleClip(c, R);
  const arms = 2;
  const turns = layer ? 0.8 : 0.95;
  c.lineCap = 'round';
  if ('filter' in c) c.filter = `blur(${(layer ? 3.2 : 2.4) * RENDER_SCALE}px)`;
  for (let a = 0; a < arms; a++) {
    const off = (a / arms) * TAU + (layer ? Math.PI / 2 : 0);
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      const u0 = i / steps;
      const u1 = (i + 1) / steps;
      const th0 = off + u0 * turns * TAU;
      const th1 = off + u1 * turns * TAU;
      const r0 = R * (0.04 + 0.98 * Math.pow(u0, 0.85));
      const r1 = R * (0.04 + 0.98 * Math.pow(u1, 0.85));
      const swell = Math.sin(Math.PI * Math.min(1, u0 * 1.1));
      c.lineWidth = Math.max(0.6, R * (layer ? 0.34 : 0.26) * swell);
      c.strokeStyle = layer ? shade(color, 15, 0.18) : lighten(color, 0.48);
      c.globalAlpha = (layer ? 0.62 : 0.42) * swell;
      c.beginPath();
      c.moveTo(Math.cos(th0) * r0, Math.sin(th0) * r0);
      c.lineTo(Math.cos(th1) * r1, Math.sin(th1) * r1);
      c.stroke();
      if (!layer && i % 2 === 0) {
        // thin bright filament along the arm's leading edge
        c.lineWidth = Math.max(0.4, R * 0.035 * swell);
        c.strokeStyle = lighten(color, 0.75);
        c.globalAlpha = 0.45 * swell;
        const k = 0.92;
        c.beginPath();
        c.moveTo(Math.cos(th0 + 0.12) * r0 * k, Math.sin(th0 + 0.12) * r0 * k);
        c.lineTo(Math.cos(th1 + 0.12) * r1 * k, Math.sin(th1 + 0.12) * r1 * k);
        c.stroke();
      }
    }
  }
  if (!layer) {
    c.globalAlpha = 0.5;
    const g = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.32);
    g.addColorStop(0, lighten(color, 0.55));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(-R, -R, R * 2, R * 2);
  }
  c.globalAlpha = 1;
  if ('filter' in c) c.filter = 'none';
}

function buildGlobeGlass(c, R, color) {
  c.save();
  circleClip(c, R);
  // depth vignette = dark inner rim
  const v = c.createRadialGradient(0, -R * 0.08, R * 0.45, 0, 0, R);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.62, 'rgba(0,0,0,0.12)');
  v.addColorStop(0.86, 'rgba(0,0,0,0.5)');
  v.addColorStop(1, 'rgba(0,0,0,0.92)');
  c.fillStyle = v;
  c.fillRect(-R, -R, R * 2, R * 2);
  // coloured caustic on the bottom inside of the glass
  if ('filter' in c) c.filter = `blur(${2 * RENDER_SCALE}px)`;
  c.strokeStyle = lighten(color, 0.45);
  c.globalAlpha = 0.4;
  c.lineWidth = R * 0.08;
  c.beginPath();
  c.arc(0, 0, R * 0.86, Math.PI * 0.22, Math.PI * 0.78);
  c.stroke();
  if ('filter' in c) c.filter = 'none';
  c.globalAlpha = 1;
  // soft dome reflection
  c.save();
  c.translate(-R * 0.3, -R * 0.47);
  c.rotate(-0.5);
  c.scale(1, 0.58);
  const hg = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.56);
  hg.addColorStop(0, 'rgba(255,255,255,0.42)');
  hg.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hg;
  c.beginPath();
  c.arc(0, 0, R * 0.56, 0, TAU);
  c.fill();
  c.restore();
  // hot specular spot
  c.save();
  c.translate(-R * 0.36, -R * 0.55);
  c.rotate(-0.62);
  c.scale(1, 0.48);
  const sg = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.2);
  sg.addColorStop(0, 'rgba(255,255,255,0.95)');
  sg.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = sg;
  c.beginPath();
  c.arc(0, 0, R * 0.2, 0, TAU);
  c.fill();
  c.restore();
  // window glint lower right + fresnel rim upper left
  c.strokeStyle = 'rgba(255,255,255,0.22)';
  c.lineWidth = 1.4;
  c.beginPath();
  c.arc(0, 0, R * 0.8, Math.PI * 0.06, Math.PI * 0.3);
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = 1;
  c.beginPath();
  c.arc(0, 0, R - 2.2, Math.PI * 1.05, Math.PI * 1.55);
  c.stroke();
  c.restore();
  // crisp dark lip
  c.strokeStyle = 'rgba(0,0,0,0.95)';
  c.lineWidth = 1.6;
  c.beginPath();
  c.arc(0, 0, R - 0.3, 0, TAU);
  c.stroke();
}

/**
 * Metal socket ring around a globe of radius R, centred on (0,0) of `c`:
 * bevelled annulus, two engraved grooves, a trim inlay and rivets.
 * @param {number} [width] ring width in px
 */
export function drawGlobeRing(c, R, pal, width = 9) {
  const ro = R + width;
  const ring = (k) => {
    k.arc(0, 0, ro, 0, TAU);
    k.closePath();
    k.moveTo(R + 0.5, 0);
    k.arc(0, 0, R + 0.5, 0, TAU);
    k.closePath();
  };
  metal(c, ring, { x: -ro, y: -ro, w: ro * 2, h: ro * 2 }, pal, { rule: 'evenodd', shadow: 6, bevel: 1.6, light: 0.45, seed: R });
  engrave(c, (k) => k.arc(0, 0, R + 2.6, 0, TAU), 0.9);
  engrave(c, (k) => k.arc(0, 0, ro - 2.2, 0, TAU), 0.7);
  c.save();
  c.globalAlpha = pal.trimGlow > 0 ? 0.9 : 0.85;
  trimStroke(c, (k) => k.arc(0, 0, R + width * 0.55, 0, TAU), pal, 1);
  c.restore();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    rivet(c, Math.cos(a) * (R + width * 0.55), Math.sin(a) * (R + width * 0.55), 1.7, pal);
  }
}

/* ------------------------------------------------------------------ */
/* Slots and icons                                                     */
/* ------------------------------------------------------------------ */

/**
 * Inventory / belt cell: bevelled metal border around a deep recessed well
 * (cached per size + state), tinted by the quality of the item inside.
 * @param {{item?:object|null,hover?:boolean,highlight?:string|null,game:object,valid?:boolean|null}} opts
 */
export function drawSlot(ctx, rect, opts = {}) {
  const pal = palette(opts.game);
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  let glow = null;
  if (opts.valid === true) glow = pal.good;
  else if (opts.valid === false) glow = pal.danger;
  else if (opts.item) glow = rarityColor(opts.game, opts.item);
  const hl = opts.highlight || null;
  const sp = chromeSprite(`slot|${chromeSig(pal)}|${w}x${h}|${glow || ''}|${hl || ''}|${opts.valid == null ? '' : opts.valid}`, w + SLOT_PAD * 2, h + SLOT_PAD * 2, SLOT_PAD, SLOT_PAD,
    (c) => buildSlot(c, w, h, pal, glow, hl, opts.valid != null));
  blitSprite(ctx, sp, rect.x, rect.y);
  if (opts.hover) {
    ctx.save();
    ctx.strokeStyle = pal.accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = lighten(pal.accent, 0.25);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx.restore();
  }
}

function buildSlot(c, w, h, pal, glow, hl, strongGlow) {
  const S = RENDER_SCALE;
  const b = Math.min(w, h) >= 30 ? 3 : 2.5;
  const outer = (k) => roundRectPath(k, 0, 0, w, h, 3);
  if (hl) {
    c.save();
    c.shadowColor = hl;
    c.shadowBlur = 8 * S;
    c.fillStyle = hl;
    c.beginPath();
    outer(c);
    c.fill();
    c.restore();
  }
  metal(c, outer, { x: 0, y: 0, w, h }, pal, { color: hl ? mix(pal.metal, hl, 0.45) : pal.metal, shadow: 2.5, bevel: 1, light: 0.5, texture: false, seed: w });
  const well = (k) => roundRectPath(k, b, b, w - b * 2, h - b * 2, 1.5);
  recess(c, well, { x: b, y: b, w: w - b * 2, h: h - b * 2 }, pal, { depth: Math.min(5, Math.max(2.5, Math.min(w, h) * 0.1)) });
  if (glow) {
    c.save();
    c.beginPath();
    well(c);
    c.clip();
    const cx = w / 2;
    const cy = h / 2;
    const rad = Math.max(w, h) * 0.62;
    const g = c.createRadialGradient(cx, cy + h * 0.1, 1, cx, cy, rad);
    g.addColorStop(0, mix('#000000', glow, strongGlow ? 0.7 : 0.15 + 0.4 * saturation(glow)));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.restore();
  }
  if (hl) {
    c.save();
    c.globalAlpha = 0.95;
    c.strokeStyle = lighten(hl, 0.35);
    c.lineWidth = 1;
    c.beginPath();
    roundRectPath(c, 0.5, 0.5, w - 1, h - 1, 3);
    c.stroke();
    c.strokeStyle = hl;
    c.globalAlpha = 0.6;
    c.beginPath();
    roundRectPath(c, b - 0.5, b - 0.5, w - b * 2 + 1, h - b * 2 + 1, 1.5);
    c.stroke();
    c.restore();
  }
}

function saturation(color) {
  const [r, g, b] = parseColor(color);
  const mx = Math.max(r, g, b);
  return mx <= 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
}

/** Draw an item's glyph centred in a rect, scaled to the rect's footprint. */
export function drawItemInRect(ctx, item, rect) {
  if (!item) return;
  const size = Math.max(10, Math.min(rect.w, rect.h) - ICON_GLYPH_PAD);
  drawItemGlyph(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, item.look || {}, size);
}

/**
 * Skill icon: a domed rune gem in the skill's colour with its glyph letter (cached per size/colour).
 * look.icon (1-2 chars) overrides the glyph-derived letter, so themes can label skills distinctly.
 * @param {{color?:string,glyph?:string,icon?:string}} look
 */
export function drawSkillIcon(ctx, rect, look = {}, opts = {}) {
  const pal = palette(opts.game);
  const color = look.color || pal.accent;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = Math.max(4, Math.round(Math.min(rect.w, rect.h) / 2 - 2));
  const dis = !!opts.disabled;
  const sp = chromeSprite(`skill|${chromeSig(pal)}|${color}|${r}|${dis}`, r * 2 + 8, r * 2 + 8, r + 4, r + 4, (c) => buildSkillGem(c, r, dis ? mix(color, '#303030', 0.75) : color, pal));
  blitSprite(ctx, sp, cx, cy);
  const glyph = (look.icon || look.glyph || '?').toString();
  const letter = glyph.length <= 2 ? glyph : glyph[0].toUpperCase();
  const size = Math.max(9, Math.round(r * (letter.length > 1 ? 0.78 : 1.1)));
  drawText(ctx, letter, cx, cy - size * 0.52, {
    color: dis ? pal.textDim : '#ffffff', align: 'center', size, weight: 'bold', game: opts.game,
  });
}

function buildSkillGem(c, r, color, pal) {
  const S = RENDER_SCALE;
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.8)';
  c.shadowBlur = 3 * S;
  c.shadowOffsetY = 1 * S;
  const bz = c.createLinearGradient(0, -r, 0, r);
  bz.addColorStop(0, pal.metalLight);
  bz.addColorStop(1, pal.metalDark);
  c.fillStyle = bz;
  c.beginPath();
  c.arc(0, 0, r + 1.5, 0, TAU);
  c.fill();
  c.restore();
  const g = c.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.05, 0, 0, r);
  g.addColorStop(0, lighten(color, 0.35));
  g.addColorStop(0.5, mix('#000000', color, 0.75));
  g.addColorStop(1, mix('#000000', color, 0.3));
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r - 0.5, 0, TAU);
  c.fill();
  c.strokeStyle = lighten(color, 0.35);
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(0, 0, r - 1.6, 0, TAU);
  c.stroke();
  c.save();
  c.translate(-r * 0.3, -r * 0.48);
  c.rotate(-0.5);
  c.scale(1, 0.5);
  const hg = c.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
  hg.addColorStop(0, 'rgba(255,255,255,0.55)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hg;
  c.beginPath();
  c.arc(0, 0, r * 0.5, 0, TAU);
  c.fill();
  c.restore();
}

/** Fill a rect with a translucent colour (tints, overlays). */
export function fillRect(ctx, rect, color, alpha = 1) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = prev;
}

/** Thin separator line inside a panel. */
export function drawSeparator(ctx, x0, x1, y, game) {
  ctx.strokeStyle = shade(palette(game).panelBorder, 15, 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5);
  ctx.lineTo(x1, y + 0.5);
  ctx.stroke();
}

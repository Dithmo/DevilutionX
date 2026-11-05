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
import { mix, lighten, shade } from '../draw_util.js';

const TAU = Math.PI * 2;
const DEFAULT_FONT = '14px system-ui, sans-serif';
const DEFAULT_SIZE = 14;
const SHADOW_OFFSET = 1;
const SHADOW_ALPHA = 0.8;
const BORDER_W = 2;
const INNER_BORDER_W = 1;
const PANEL_ALPHA = 0.94;
const BUTTON_HOVER_T = 0.25;
const BUTTON_ACTIVE_T = 0.4;
const DISABLED_ALPHA = 0.45;
const GLOBE_HIGHLIGHT_ALPHA = 0.28;
const GLOBE_WAVE_PX = 2;
const GLOBE_WAVE_SPEED = 0.15;
const GLOBE_LIQUID_DARK = 0.45;
const GLOBE_LIQUID_LIGHT = 0.3;
const GLOBE_RIM_T = 0.5;
const SLOT_BG_T = 0.35;
const SLOT_BORDER_T = 0.55;
const ICON_GLYPH_PAD = 6;
const ICON_RUNE_T = 0.5;
const BAR_BORDER_ALPHA = 0.6;
const ELLIPSIS = '…';

export const DEFAULT_PALETTE = Object.freeze({
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
});

/** Merged palette for the game (theme values over defaults). */
export function palette(game) {
  const p = game && game.theme && game.theme.palette;
  if (!p) return DEFAULT_PALETTE;
  if (p === game.ui?._palSrc) return game.ui._pal;
  const merged = { ...DEFAULT_PALETTE, ...p, rarity: { ...DEFAULT_PALETTE.rarity, ...(p.rarity || {}) } };
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
 * Semi-opaque panel with a double border and optional title.
 * @param {{alpha?:number,title?:string,game:object,titleColor?:string}} opts
 */
export function drawPanel(ctx, rect, opts = {}) {
  const pal = palette(opts.game);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (opts.alpha == null ? PANEL_ALPHA : opts.alpha);
  ctx.fillStyle = pal.panel;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = prev;
  ctx.strokeStyle = pal.panelBorder;
  ctx.lineWidth = BORDER_W;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  ctx.strokeStyle = shade(pal.panelBorder, 15, 0.5);
  ctx.lineWidth = INNER_BORDER_W;
  ctx.strokeRect(rect.x + 4.5, rect.y + 4.5, rect.w - 9, rect.h - 9);
  if (opts.title) {
    drawText(ctx, opts.title, rect.x + rect.w / 2, rect.y + 9, {
      color: opts.titleColor || pal.gold, align: 'center', size: 15, weight: 'bold', game: opts.game,
    });
  }
}

/**
 * Button with hover / active / disabled states.
 * @param {{hover?:boolean,active?:boolean,disabled?:boolean,game:object,size?:number,color?:string}} state
 */
export function drawButton(ctx, rect, label, state = {}) {
  const pal = palette(state.game);
  const prev = ctx.globalAlpha;
  if (state.disabled) ctx.globalAlpha = prev * DISABLED_ALPHA;
  let bg = mix(pal.panel, pal.panelBorder, 0.25);
  if (state.active) bg = mix(pal.panel, pal.accent, BUTTON_ACTIVE_T);
  else if (state.hover) bg = mix(pal.panel, pal.panelBorder, BUTTON_HOVER_T + 0.3);
  ctx.fillStyle = bg;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = state.active ? pal.accent : state.hover ? lighten(pal.panelBorder, 0.3) : pal.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  const size = state.size || Math.min(DEFAULT_SIZE, Math.max(10, rect.h - 7));
  drawText(ctx, label, rect.x + rect.w / 2, rect.y + (rect.h - size) / 2 - 1, {
    color: state.color || (state.active ? pal.text : pal.text), align: 'center', size, game: state.game, maxW: rect.w - 6,
  });
  ctx.globalAlpha = prev;
}

/**
 * Horizontal bar (hp / xp / progress).
 * @param {{color:string,bg?:string,border?:string,game?:object}} opts
 */
export function drawBar(ctx, rect, ratio, opts = {}) {
  const pal = palette(opts.game);
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  ctx.fillStyle = opts.bg || 'rgba(0,0,0,0.65)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (r > 0) {
    ctx.fillStyle = opts.color || pal.hp;
    ctx.fillRect(rect.x + 1, rect.y + 1, Math.round((rect.w - 2) * r), rect.h - 2);
  }
  ctx.strokeStyle = opts.border || `rgba(255,255,255,${BAR_BORDER_ALPHA})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

/**
 * Globe: dark sphere with liquid filling from the bottom to `ratio`, a
 * sinusoidal surface, a specular highlight and a rim.
 * @param {{color:string,tint?:string|null,tick?:number,game?:object}} opts tint overlays e.g. mana shield
 */
export function drawGlobe(ctx, cx, cy, r, ratio, opts = {}) {
  const pal = palette(opts.game);
  const color = opts.color || pal.hp;
  const f = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const tick = opts.tick || 0;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.closePath();
  ctx.fillStyle = shade(pal.panel, 15, 0.55);
  ctx.fill();
  ctx.clip();
  if (f > 0) {
    const surfaceY = cy + r - f * r * 2;
    const grad = ctx.createLinearGradient(0, surfaceY, 0, cy + r);
    grad.addColorStop(0, lighten(color, GLOBE_LIQUID_LIGHT));
    grad.addColorStop(1, shade(color, 15, GLOBE_LIQUID_DARK));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + r);
    for (let x = -r; x <= r; x += 2) {
      const wave = Math.sin(x * 0.18 + tick * GLOBE_WAVE_SPEED) * GLOBE_WAVE_PX;
      ctx.lineTo(cx + x, surfaceY + wave);
    }
    ctx.lineTo(cx + r, cy + r);
    ctx.closePath();
    ctx.fill();
    if (opts.tint) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = opts.tint;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
  }
  // specular highlight
  ctx.globalAlpha = GLOBE_HIGHLIGHT_ALPHA;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, cy - r * 0.45, r * 0.28, r * 0.16, -0.6, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = mix(pal.panelBorder, '#000', GLOBE_RIM_T);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = pal.panelBorder;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, TAU);
  ctx.stroke();
}

/**
 * Inventory / belt cell background, tinted by the quality of the item inside.
 * @param {{item?:object|null,hover?:boolean,highlight?:string|null,game:object,valid?:boolean|null}} opts
 */
export function drawSlot(ctx, rect, opts = {}) {
  const pal = palette(opts.game);
  let bg = 'rgba(0,0,0,0.45)';
  if (opts.valid === true) bg = mix('#000', pal.good, SLOT_BG_T);
  else if (opts.valid === false) bg = mix('#000', pal.danger, SLOT_BG_T);
  else if (opts.item) bg = mix('#000', rarityColor(opts.game, opts.item), SLOT_BG_T * 0.6);
  ctx.fillStyle = bg;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = opts.hover ? pal.accent : opts.highlight || mix(pal.panel, pal.panelBorder, SLOT_BORDER_T);
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

/** Draw an item's glyph centred in a rect, scaled to the rect's footprint. */
export function drawItemInRect(ctx, item, rect) {
  if (!item) return;
  const size = Math.max(10, Math.min(rect.w, rect.h) - ICON_GLYPH_PAD);
  drawItemGlyph(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, item.look || {}, size);
}

/**
 * Skill icon: a rune disc in the skill's colour with its glyph letter.
 * @param {{color?:string,glyph?:string}} look
 */
export function drawSkillIcon(ctx, rect, look = {}, opts = {}) {
  const pal = palette(opts.game);
  const color = look.color || pal.accent;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = Math.min(rect.w, rect.h) / 2 - 3;
  ctx.fillStyle = opts.disabled ? shade(color, 15, 0.3) : mix('#000', color, ICON_RUNE_T);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = opts.disabled ? pal.textDim : lighten(color, 0.3);
  ctx.lineWidth = 2;
  ctx.stroke();
  const glyph = (look.glyph || '?').toString();
  const letter = glyph.length <= 2 ? glyph : glyph[0].toUpperCase();
  drawText(ctx, letter, cx, cy - r * 0.62, {
    color: opts.disabled ? pal.textDim : '#fff', align: 'center', size: Math.max(10, Math.round(r * 1.2)), weight: 'bold', game: opts.game,
  });
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

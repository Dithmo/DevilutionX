/**
 * Procedural item glyphs (inventory icons and floor drops) and missiles.
 *
 * look: { glyph:'blade'|'axe'|'mace'|'bow'|'gun'|'staff'|'wand'|'shield'|'helm'|'chest'|
 *         'boots'|'gloves'|'belt'|'ring'|'amulet'|'flask'|'scroll'|'book'|'gem'|'key'|'coin'|'generic',
 *         color, color2? }
 * Glyphs are drawn centred on (sx, sy) inside a `size` px box and cached.
 */
import { cached, blit, circle, ellipse, poly, line, dirToScreen } from './draw_util.js';

const DEFAULT_SIZE = 24;
const PAD = 2;
const DEFAULT_COLOR = '#cfc9b8';
const DEFAULT_COLOR2 = '#6f5a3a';
const HALF = 0.5;
const THIN = 2;
const THICK = 3;
const TAU = Math.PI * 2;
const MISSILE_SIZE = 6;
const TRAIL = 2.5;
const ORB_GLOW = 0.35;

/**
 * Draw an item glyph centred at (sx, sy).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx
 * @param {number} sy
 * @param {{glyph?:string,color?:string,color2?:string}} look
 * @param {number} [size=24] box size in px
 */
export function drawItemGlyph(ctx, sx, sy, look = {}, size = DEFAULT_SIZE) {
  const glyph = look.glyph || 'generic';
  const color = look.color || DEFAULT_COLOR;
  const color2 = look.color2 || DEFAULT_COLOR2;
  const key = `i|${glyph}|${color}|${color2}|${size}`;
  const box = size + PAD * 2;
  const entry = cached(key, box, box, box / 2, box / 2, (c) => {
    const u = size / DEFAULT_SIZE; // unit scale: glyphs are authored in a 24px box
    c.scale(u, u);
    c.lineCap = 'round';
    c.strokeStyle = color;
    c.fillStyle = color;
    const fn = WEAPONS[glyph] || WEARABLES[glyph] || MISC[glyph] || MISC.generic;
    fn(c, color, color2);
  });
  blit(ctx, entry, Math.round(sx), Math.round(sy));
}

const WEAPONS = {
  blade(c, color, color2) {
    line(c, -7, 7, 6, -6, THICK);
    c.strokeStyle = color2;
    line(c, -3, 3, -7, 7, THICK + 1);
    line(c, -6, 0, -1, 5, THIN);
  },
  axe(c, color, color2) {
    c.strokeStyle = color2;
    line(c, -7, 8, 5, -4, THICK);
    c.fillStyle = color;
    c.beginPath();
    c.arc(4, -5, 7, Math.PI * 0.6, Math.PI * 1.6);
    c.closePath();
    c.fill();
  },
  mace(c, color, color2) {
    c.strokeStyle = color2;
    line(c, -7, 8, 3, -2, THICK);
    c.fillStyle = color;
    circle(c, 5, -4, 5);
  },
  bow(c, color, color2) {
    c.strokeStyle = color2;
    c.lineWidth = THIN;
    c.beginPath();
    c.arc(-3, 0, 10, -Math.PI * 0.4, Math.PI * 0.4);
    c.stroke();
    c.strokeStyle = color;
    line(c, 5, -9, 5, 9, 1);
    line(c, -2, 0, 5, 0, 1);
  },
  gun(c, color, color2) {
    c.fillStyle = color;
    c.fillRect(-8, -3, 16, 4);
    c.fillStyle = color2;
    c.fillRect(-6, 1, 5, 7);
  },
  staff(c, color, color2) {
    c.strokeStyle = color2;
    line(c, -8, 9, 6, -6, THICK);
    c.fillStyle = color;
    circle(c, 7, -7, 3.5);
  },
  wand(c, color, color2) {
    c.strokeStyle = color2;
    line(c, -5, 5, 3, -3, THIN);
    c.fillStyle = color;
    poly(c, [4, -8, 6, -4, 10, -3, 6, -1, 5, 3, 3, -1, -1, -3, 3, -4]);
  },
};

const WEARABLES = {
  shield(c, color, color2) {
    c.fillStyle = color2;
    poly(c, [-8, -8, 8, -8, 8, 1, 0, 9, -8, 1]);
    c.fillStyle = color;
    poly(c, [-5, -5, 5, -5, 5, 0, 0, 5, -5, 0]);
  },
  helm(c, color, color2) {
    c.fillStyle = color;
    c.beginPath();
    c.arc(0, 1, 8, Math.PI, 0);
    c.fill();
    c.fillStyle = color2;
    c.fillRect(-9, 0, 18, 3);
    c.fillRect(-2, -10, 4, 4);
  },
  chest(c, color, color2) {
    c.fillStyle = color;
    poly(c, [-8, -8, -3, -6, 3, -6, 8, -8, 8, 8, -8, 8]);
    c.fillStyle = color2;
    c.fillRect(-1, -6, 2, 14);
  },
  boots(c, color, color2) {
    c.fillStyle = color;
    c.fillRect(-8, -8, 6, 12);
    c.fillRect(2, -8, 6, 12);
    c.fillStyle = color2;
    c.fillRect(-8, 3, 9, 5);
    c.fillRect(2, 3, 9, 5);
  },
  gloves(c, color, color2) {
    c.fillStyle = color;
    ellipse(c, -5, 0, 4, 7);
    ellipse(c, 5, 0, 4, 7);
    c.fillStyle = color2;
    c.fillRect(-9, 5, 8, 3);
    c.fillRect(1, 5, 8, 3);
  },
  belt(c, color, color2) {
    c.fillStyle = color2;
    c.fillRect(-10, -3, 20, 6);
    c.fillStyle = color;
    c.fillRect(-3, -5, 6, 10);
    c.clearRect(-1, -3, 2, 6);
  },
  ring(c, color, color2) {
    c.strokeStyle = color;
    c.lineWidth = THICK;
    c.beginPath();
    c.arc(0, 1, 6, 0, TAU);
    c.stroke();
    c.fillStyle = color2;
    poly(c, [0, -9, 3, -6, 0, -3, -3, -6]);
  },
  amulet(c, color, color2) {
    c.strokeStyle = color2;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(0, -4, 7, Math.PI * 0.8, Math.PI * 2.2);
    c.stroke();
    c.fillStyle = color;
    circle(c, 0, 5, 4);
  },
};

const MISC = {
  flask(c, color, color2) {
    c.fillStyle = color;
    c.fillRect(-2, -10, 4, 5);
    ellipse(c, 0, 3, 7, 7);
    c.fillStyle = color2;
    c.beginPath();
    c.arc(0, 3, 6, 0, Math.PI);
    c.fill();
  },
  scroll(c, color, color2) {
    c.fillStyle = color;
    c.fillRect(-7, -8, 14, 16);
    c.fillStyle = color2;
    c.fillRect(-9, -9, 18, 3);
    c.fillRect(-9, 6, 18, 3);
    c.fillRect(-4, -3, 8, 1);
    c.fillRect(-4, 0, 8, 1);
  },
  book(c, color, color2) {
    c.fillStyle = color2;
    c.fillRect(-8, -9, 16, 18);
    c.fillStyle = color;
    c.fillRect(-5, -7, 11, 14);
    c.fillStyle = color2;
    c.fillRect(-3, -4, 7, 1);
  },
  gem(c, color, color2) {
    c.fillStyle = color2;
    poly(c, [-8, -3, -4, -8, 4, -8, 8, -3, 0, 9]);
    c.fillStyle = color;
    poly(c, [-4, -3, -2, -6, 2, -6, 4, -3, 0, 4]);
  },
  key(c, color, color2) {
    c.strokeStyle = color;
    c.lineWidth = THIN;
    c.beginPath();
    c.arc(-5, -4, 4, 0, TAU);
    c.stroke();
    line(c, -2, -1, 8, 9, THIN);
    c.strokeStyle = color2;
    line(c, 5, 6, 8, 3, THIN);
    line(c, 7, 8, 10, 5, THIN);
  },
  coin(c, color, color2) {
    c.fillStyle = color;
    circle(c, 0, 0, 8);
    c.fillStyle = color2;
    circle(c, 0, 0, 5);
    c.fillStyle = color;
    circle(c, 0, 0, 2);
  },
  generic(c, color, color2) {
    c.fillStyle = color2;
    c.fillRect(-7, -7, 14, 14);
    c.fillStyle = color;
    c.fillRect(-4, -4, 8, 8);
  },
};

/**
 * Draw a missile (uncached, cheap). look: { shape:'bolt'|'arrow'|'orb'|'shard'|'ring', color, size }
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx
 * @param {number} sy
 * @param {{shape?:string,color?:string,size?:number}} look
 * @param {number} dir 0..7 travel direction
 */
export function drawMissile(ctx, sx, sy, look = {}, dir = 0) {
  const color = look.color || DEFAULT_COLOR;
  const size = look.size || MISSILE_SIZE;
  const shape = look.shape || 'bolt';
  const v = dirToScreen(dir);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(Math.atan2(v.y, v.x));
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  if (shape === 'orb') {
    ctx.globalAlpha = ORB_GLOW;
    circle(ctx, 0, 0, size * 1.8);
    ctx.globalAlpha = 1;
    circle(ctx, 0, 0, size * HALF);
  } else if (shape === 'ring') {
    ctx.lineWidth = THIN;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 2, size, 0, 0, TAU);
    ctx.stroke();
  } else if (shape === 'arrow') {
    line(ctx, -size * TRAIL, 0, size, 0, THIN);
    poly(ctx, [size + 3, 0, size - 2, -3, size - 2, 3]);
  } else if (shape === 'shard') {
    poly(ctx, [size * 1.5, 0, 0, -size * HALF, -size * 1.5, 0, 0, size * HALF]);
  } else {
    ctx.globalAlpha = HALF;
    line(ctx, -size * TRAIL, 0, 0, 0, size);
    ctx.globalAlpha = 1;
    ellipse(ctx, 0, 0, size, size * HALF);
  }
  ctx.restore();
}

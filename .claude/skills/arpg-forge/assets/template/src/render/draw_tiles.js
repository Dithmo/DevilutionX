/**
 * Procedural floor tiles and walls. (sx, sy) is always the screen position
 * of the tile's ground centre.
 *
 * Wall geometry (origin = tile centre): two vertical faces hang below a top
 * diamond raised by WALL_H. The 'left' face is the one facing +y (screen
 * down-left), the 'right' face faces +x (screen down-right).
 */
import { cached, blit, shade, hash2, diamond, poly, line } from './draw_util.js';

export const TILE_W = 64;
export const TILE_H = 32;
export const WALL_H = 48;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
const PAD = 1;
const SPECKLES = 18;
const SPECKLE_MAX = 3;
const VARIANT_COUNT = 8;
const VARIANT_JITTER = 0.05;
const EDGE_MULT = 0.75;
const LEFT_FACE_MULT = 0.85;
const RIGHT_FACE_MULT = 0.62;
const TOP_MULT = 1.0;
const BRICK_ROWS = 4;
const MORTAR_ALPHA = 0.3;
const OUTLINE_WIDTH = 2;
const STYLE_PLAIN = 0;
const STYLE_BRICK = 1;
const DEFAULT_FLOOR = ['#5a5247', '#4a4339'];
const DEFAULT_WALL = ['#6b6358', '#4e473f', '#847b6e'];

/**
 * Draw a floor diamond.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx tile centre x
 * @param {number} sy tile centre y
 * @param {{colors?:string[], variant?:number, light?:number}} opts colors = [base, speckle]
 */
export function drawTile(ctx, sx, sy, { colors = DEFAULT_FLOOR, variant = 0, light = 15 } = {}) {
  const v = variant % VARIANT_COUNT;
  const base = colors[0];
  const alt = colors[1] || colors[0];
  const key = `t|${base}|${alt}|${v}|${light}`;
  const entry = cached(key, TILE_W + PAD, TILE_H + PAD, HALF_W, HALF_H, (c) => {
    const jitter = 1 + ((v / (VARIANT_COUNT - 1)) - 0.5) * VARIANT_JITTER;
    c.fillStyle = shade(base, light, jitter);
    diamond(c, 0, 0, HALF_W, HALF_H);
    c.save();
    c.beginPath();
    c.moveTo(0, -HALF_H); c.lineTo(HALF_W, 0); c.lineTo(0, HALF_H); c.lineTo(-HALF_W, 0);
    c.closePath();
    c.clip();
    c.fillStyle = shade(alt, light);
    for (let i = 0; i < SPECKLES; i++) {
      const h = hash2(i, v, 7);
      const px = (h % TILE_W) - HALF_W;
      const py = ((h >>> 8) % TILE_H) - HALF_H;
      const s = 1 + ((h >>> 16) % SPECKLE_MAX);
      c.fillRect(px, py, s, Math.max(1, s >> 1));
    }
    c.restore();
    c.strokeStyle = shade(alt, light, EDGE_MULT);
    c.beginPath();
    c.moveTo(0, -HALF_H); c.lineTo(HALF_W, 0); c.lineTo(0, HALF_H); c.lineTo(-HALF_W, 0);
    c.closePath();
    c.lineWidth = 1;
    c.stroke();
  });
  blit(ctx, entry, sx, sy);
}

function brickLines(c, x0, y0, x1, y1, rows, color) {
  c.strokeStyle = color;
  const step = WALL_H / rows;
  for (let k = 1; k < rows; k++) {
    const dy = -WALL_H + k * step;
    line(c, x0, y0 + dy, x1, y1 + dy, 1);
  }
}

/**
 * Draw a wall block.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx tile centre x
 * @param {number} sy tile centre y
 * @param {{colors?:string[], style?:number, light?:number, side?:'left'|'right'|'both'|'none'}} opts
 *   colors = [leftFace, rightFace, top]
 */
export function drawWall(ctx, sx, sy, { colors = DEFAULT_WALL, style = STYLE_BRICK, light = 15, side = 'both' } = {}) {
  const [cl, cr, ct] = [colors[0], colors[1] || colors[0], colors[2] || colors[0]];
  const key = `w|${cl}|${cr}|${ct}|${style}|${light}|${side}`;
  const entry = cached(key, TILE_W + PAD, TILE_H + WALL_H + PAD, HALF_W, WALL_H + HALF_H, (c) => {
    const mortar = `rgba(0,0,0,${MORTAR_ALPHA})`;
    const showLeft = side === 'left' || side === 'both';
    const showRight = side === 'right' || side === 'both';
    if (showLeft) {
      c.fillStyle = shade(cl, light, LEFT_FACE_MULT);
      poly(c, [-HALF_W, 0, 0, HALF_H, 0, HALF_H - WALL_H, -HALF_W, -WALL_H]);
      if (style !== STYLE_PLAIN) brickLines(c, -HALF_W, 0, 0, HALF_H, BRICK_ROWS, mortar);
    }
    if (showRight) {
      c.fillStyle = shade(cr, light, RIGHT_FACE_MULT);
      poly(c, [0, HALF_H, HALF_W, 0, HALF_W, -WALL_H, 0, HALF_H - WALL_H]);
      if (style !== STYLE_PLAIN) brickLines(c, 0, HALF_H, HALF_W, 0, BRICK_ROWS, mortar);
    }
    c.fillStyle = shade(ct, light, TOP_MULT);
    diamond(c, 0, -WALL_H, HALF_W, HALF_H);
    c.strokeStyle = mortar;
    c.beginPath();
    c.moveTo(0, -WALL_H - HALF_H); c.lineTo(HALF_W, -WALL_H); c.lineTo(0, -WALL_H + HALF_H); c.lineTo(-HALF_W, -WALL_H);
    c.closePath();
    c.lineWidth = 1;
    c.stroke();
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
  ctx.moveTo(sx, sy - HALF_H);
  ctx.lineTo(sx + HALF_W, sy);
  ctx.lineTo(sx, sy + HALF_H);
  ctx.lineTo(sx - HALF_W, sy);
  ctx.closePath();
  ctx.stroke();
}

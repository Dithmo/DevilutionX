/**
 * Procedural interactive objects. (sx, sy) is the tile's ground centre.
 *
 * kind:  'chest'|'door'|'breakable'|'altar'|'lever'|'stairs'|'portal'|'sign'
 * look:  { color, color2, orient?:'left'|'right' (doors: which wall face), frame? (portal swirl) }
 * state: string - chest 'closed'|'open'; door 'closed'|'open'; breakable 'intact'|'broken';
 *        altar 'idle'|'active'; lever 'off'|'on'; stairs 'down'|'up'; portal 'active'; sign ''
 */
import { cached, blit, shade, circle, ellipse, poly, line, diamond } from './draw_util.js';

const TILE_W = 64;
const TILE_H = 32;
const WALL_H = 48;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
const SPRITE_W = 72;
const SPRITE_H = 88;
const ANCHOR_Y = 70;
const MAX_LIGHT = 15;
const DEFAULT_COLOR = '#8a6a3a';
const DEFAULT_COLOR2 = '#d4b24a';
const SHADOW_ALPHA = 0.3;
const DARK = 0.6;
const DARKER = 0.4;
const STEP_COUNT = 4;
const PORTAL_RINGS = 3;
const PORTAL_RX = 14;
const PORTAL_RY = 26;
const PORTAL_ALPHA = 0.5;
const DOOR_T = 6;
const TAU = Math.PI * 2;

/**
 * Draw an object.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx
 * @param {number} sy
 * @param {string} kind
 * @param {{color?:string,color2?:string,orient?:string,frame?:number}} [look]
 * @param {string} [state]
 * @param {number} [light]
 */
export function drawObject(ctx, sx, sy, kind, look = {}, state = '', light = MAX_LIGHT) {
  const color = look.color || DEFAULT_COLOR;
  const color2 = look.color2 || DEFAULT_COLOR2;
  const orient = look.orient || 'left';
  const fn = DRAWERS[kind] || DRAWERS.sign;
  if (kind === 'portal') {
    ctx.save();
    ctx.translate(sx, sy);
    fn(ctx, shade(color, light), shade(color2, light), state, orient, look.frame || 0, light);
    ctx.restore();
    return;
  }
  const key = `o|${kind}|${state}|${color}|${color2}|${orient}|${light}`;
  const entry = cached(key, SPRITE_W, SPRITE_H, SPRITE_W / 2, ANCHOR_Y, (c) => {
    fn(c, shade(color, light), shade(color2, light), state, orient, 0, light);
  });
  blit(ctx, entry, sx, sy);
}

function shadow(c, rx, ry) {
  c.fillStyle = `rgba(0,0,0,${SHADOW_ALPHA})`;
  ellipse(c, 0, 0, rx, ry);
}

/** Small iso box: footprint half extents (hw, hh), height h. */
function isoBox(c, color, hw, hh, h, y = 0) {
  c.fillStyle = shadeStr(color, DARK);
  poly(c, [-hw, y, 0, y + hh, 0, y + hh - h, -hw, y - h]);
  c.fillStyle = shadeStr(color, DARKER);
  poly(c, [0, y + hh, hw, y, hw, y - h, 0, y + hh - h]);
  c.fillStyle = color;
  diamond(c, 0, y - h, hw, hh);
}

// Multiply an already-resolved rgb() string by a factor.
function shadeStr(rgb, f) {
  const p = rgb.match(/[\d.]+/g) || [0, 0, 0];
  return `rgb(${Math.round(p[0] * f)},${Math.round(p[1] * f)},${Math.round(p[2] * f)})`;
}

const DRAWERS = {
  chest(c, color, color2, state) {
    shadow(c, 16, 8);
    isoBox(c, color, 14, 7, 12, -2);
    c.fillStyle = color2;
    if (state === 'open') {
      c.fillStyle = shadeStr(color, DARK);
      poly(c, [-14, -14, 0, -7, 0, -30, -14, -36]);
      c.fillStyle = color2;
      diamond(c, 3, -13, 8, 4);
    } else {
      c.fillRect(-2, -10, 4, 5);
    }
  },
  door(c, color, color2, state, orient) {
    const mirror = orient === 'right' ? -1 : 1;
    c.scale(mirror, 1);
    const open = state === 'open';
    const w = open ? DOOR_T : HALF_W;
    const rise = open ? 0 : HALF_H;
    c.fillStyle = color;
    poly(c, [-w, rise - (open ? 0 : 0) + (open ? HALF_H : 0), 0, HALF_H, 0, HALF_H - WALL_H, -w, HALF_H - WALL_H - (open ? 0 : HALF_H)]);
    c.fillStyle = color2;
    if (!open) {
      c.fillRect(-w + 4, -WALL_H * 0.5, 3, 3);
      line(c, -w + 2, 0, -2, HALF_H - 2, 1);
    }
  },
  breakable(c, color, color2, state) {
    shadow(c, 12, 6);
    if (state === 'broken') {
      c.fillStyle = color;
      poly(c, [-10, -2, -4, -8, 2, -3]);
      poly(c, [3, 1, 9, -6, 11, 2]);
      c.fillStyle = color2;
      c.fillRect(-3, -4, 5, 3);
      return;
    }
    c.fillStyle = color;
    c.fillRect(-10, -26, 20, 26);
    ellipse(c, 0, -26, 10, 4);
    c.fillStyle = color2;
    c.fillRect(-10, -20, 20, 2);
    c.fillRect(-10, -8, 20, 2);
  },
  altar(c, color, color2, state) {
    shadow(c, 20, 10);
    isoBox(c, color, 18, 9, 14);
    c.fillStyle = color2;
    diamond(c, 0, -15, 8, 4);
    if (state === 'active') {
      c.fillStyle = `rgba(255,255,220,${PORTAL_ALPHA})`;
      circle(c, 0, -28, 7);
      c.fillStyle = color2;
      circle(c, 0, -28, 3);
    }
  },
  lever(c, color, color2, state) {
    shadow(c, 8, 4);
    isoBox(c, color, 6, 3, 6);
    const tilt = state === 'on' ? 1 : -1;
    c.strokeStyle = color2;
    line(c, 0, -6, tilt * 8, -22, 3);
    c.fillStyle = color2;
    circle(c, tilt * 8, -23, 3);
  },
  stairs(c, color, color2, state) {
    const down = state !== 'up';
    c.fillStyle = down ? shadeStr(color, DARKER) : color;
    diamond(c, 0, 0, HALF_W - 4, HALF_H - 2);
    c.strokeStyle = down ? color : color2;
    for (let i = 1; i < STEP_COUNT; i++) {
      const t = i / STEP_COUNT;
      const rise = down ? 0 : -i * 3;
      line(c, -HALF_W * (1 - t) + 2, -HALF_H * t + rise, HALF_W * t - 2, HALF_H * (1 - t) - HALF_H * t * 0 + rise - HALF_H * (1 - t) + HALF_H * (1 - t), 2);
    }
    if (down) {
      c.fillStyle = 'rgba(0,0,0,0.6)';
      diamond(c, 6, 3, HALF_W * 0.45, HALF_H * 0.45);
    }
  },
  portal(c, color, color2, state, orient, frame) {
    c.strokeStyle = color;
    c.globalAlpha = PORTAL_ALPHA;
    c.fillStyle = color2;
    ellipse(c, 0, -PORTAL_RY, PORTAL_RX, PORTAL_RY);
    c.globalAlpha = 1;
    for (let i = 0; i < PORTAL_RINGS; i++) {
      const phase = frame * 0.2 + i * (TAU / PORTAL_RINGS);
      const k = 0.5 + 0.5 * Math.sin(phase);
      c.lineWidth = 1 + k;
      c.beginPath();
      c.ellipse(0, -PORTAL_RY, PORTAL_RX * (0.3 + 0.7 * k), PORTAL_RY * (0.3 + 0.7 * k), 0, 0, TAU);
      c.stroke();
    }
    c.fillStyle = `rgba(255,255,255,${PORTAL_ALPHA})`;
    ellipse(c, 0, 0, PORTAL_RX, PORTAL_RX / 2);
  },
  sign(c, color, color2) {
    shadow(c, 6, 3);
    c.fillStyle = color;
    c.fillRect(-2, -22, 4, 22);
    c.fillStyle = color2;
    c.fillRect(-12, -34, 24, 14);
    c.fillStyle = color;
    c.fillRect(-8, -30, 16, 2);
    c.fillRect(-8, -26, 12, 2);
  },
};

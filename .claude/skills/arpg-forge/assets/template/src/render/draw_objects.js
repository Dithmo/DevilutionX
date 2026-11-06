/**
 * Procedural interactive objects and props. (sx, sy) is the tile's ground centre.
 *
 * The drawer is chosen by look.shape first (so data can say "this altar-kind object is drawn
 * as a brazier"), then by kind:
 *   shapes: box, slab, barrel, crate, altar, lever, post, plate, basin, stand, stairs, portal,
 *           brazier, rack, lamp, well, banner
 *   kinds:  chest, door, breakable, altar, lever, stairs, portal, sign, fountain, bookstand, trap
 * look:  { color (body: wood/stone/metal), color2 (accent: bands, runes, flame, neon, cloth),
 *          shape?, orient?:'left'|'right' (doors: which wall face), frame? (portal swirl) }
 * state: chest 'closed'|'open'; door 'closed'|'open'; breakable 'intact'|'broken';
 *        altar 'idle'|'active'; lever 'off'|'on'; stairs 'down'|'up'; portal 'active'
 *
 * Static bodies are cached per (kind, shape, state, colours, orient). Animated parts (flames,
 * portal swirls) are cached per animation frame (time-driven, bounded) and drawn on top.
 * Sprites are drawn at full brightness; lighting.js darkens the frame, and iso.js adds the
 * light + glow for objects with `light > 0`. Only part-specific glows are added here.
 */
import { cached, blit, mix } from './draw_util.js';
import { DOOR_H as TILE_DOOR_H } from './draw_tiles.js';
import {
  inked, contactShadow, capsule, sphere, litH, litLinear, litRadial, fillPts, strokePts, rgba,
  dark, light, rivet, isoBlock,
} from './draw_volume.js';
import { addGlow } from './lighting.js';

const TILE_W = 64;
const TILE_H = 32;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
/** Door leaf height; the wall drawer adds a lintel between DOOR_H and WALL_H. */
const DOOR_H = TILE_DOOR_H;
const SPRITE_W = 100;
const SPRITE_H = Math.max(124, DOOR_H + 64);
const ANCHOR_Y = SPRITE_H - 30;
const MAX_LIGHT = 15;
const DEFAULT_COLOR = '#8a6a3a';
const DEFAULT_COLOR2 = '#d4b24a';
const OUTLINE = 'rgba(10,8,10,0.9)';
const TAU = Math.PI * 2;
const FLAME_FRAMES = 8;
const FLAME_FPS = 12;
const PORTAL_FRAMES = 16;

function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/**
 * Draw an object.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx
 * @param {number} sy
 * @param {string} kind
 * @param {{color?:string,color2?:string,shape?:string,orient?:string,frame?:number}} [look]
 * @param {string} [state]
 * @param {number} [light] ignored (lighting is screen-space)
 * @param {number} [time] seconds, for animated parts (defaults to the wall clock)
 */
export function drawObject(ctx, sx, sy, kind, look = {}, state = '', light = MAX_LIGHT, time) {
  const color = look.color || DEFAULT_COLOR;
  const color2 = look.color2 || DEFAULT_COLOR2;
  const orient = look.orient || 'left';
  const shape = SHAPES[look.shape] ? look.shape : (KIND_SHAPE[kind] || 'post');
  const t = time ?? now();
  if (shape === 'portal') {
    const fr = (((look.frame || Math.floor(t * 20)) % PORTAL_FRAMES) + PORTAL_FRAMES) % PORTAL_FRAMES;
    const e = cached(`o|portal|${color}|${color2}|${fr}`, SPRITE_W, SPRITE_H, SPRITE_W / 2, ANCHOR_Y, (c) => portal(c, color, color2, fr));
    blit(ctx, e, sx, sy);
    addGlow(sx, sy - 26, 30, color, 0.35);
    return;
  }
  const key = `o|${shape}|${kind}|${state}|${color}|${color2}|${orient}`;
  const entry = cached(key, SPRITE_W, SPRITE_H, SPRITE_W / 2, ANCHOR_Y, (c) => {
    SHAPES[shape](c, color, color2, state, orient);
  });
  blit(ctx, entry, sx, sy);
  const anim = ANIMATED[shape];
  if (anim && state !== 'broken') anim(ctx, sx, sy, color, color2, t, state);
}

const KIND_SHAPE = {
  chest: 'box', door: 'slab', breakable: 'barrel', altar: 'altar', lever: 'lever', stairs: 'stairs',
  portal: 'portal', sign: 'post', fountain: 'basin', bookstand: 'stand', trap: 'plate',
};

/* ------------------------------------------------------------------ helpers */

/** Vertical cylinder: base centre (x, y), radii rx/ry, height h. */
function cylinder(c, x, y, rx, ry, h, color, hi = 0.3, lo = 0.6) {
  c.fillStyle = litH(c, x - rx, x + rx, color, hi, lo);
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI);
  c.lineTo(x - rx, y - h);
  c.ellipse(x, y - h, rx, ry, 0, Math.PI, 0, true);
  c.closePath();
  c.fill();
  c.fillStyle = litLinear(c, x - rx, y - h - ry, x + rx, y - h + ry, light(color, 0.08), 0.25, 0.3);
  c.beginPath();
  c.ellipse(x, y - h, rx, ry, 0, 0, TAU);
  c.fill();
}

/** Band around a cylinder (front half). */
function band(c, x, y, rx, ry, color, w = 1.6) {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.beginPath();
  c.ellipse(x, y, rx + 0.2, ry + 0.1, 0, 0.02 * Math.PI, 0.98 * Math.PI);
  c.stroke();
}

/** Iso quad on a vertical face: f(u,v) maps u along the face, v up. */
function facePts(ax, ay, bx, by, v0, v1) {
  return [[ax, ay - v0], [bx, by - v0], [bx, by - v1], [ax, ay - v1]];
}

function wood(color) {
  return color;
}

/* ------------------------------------------------------------------ static shapes */

const SHAPES = {
  box(c, color, color2, state) {
    contactShadow(c, 0, 2, 22, 10, 0.55);
    inked(c, (g) => {
      const hw = 17; const hh = 8.5; const h = 12;
      // body
      isoBlock(g, 0, 0, hw, hh, h, wood(color), { edge: false, top: dark(color, 0.6) });
      // planks on the faces
      g.strokeStyle = rgba(dark(color, 0.35), 0.7);
      for (let i = 1; i < 3; i++) {
        strokePts(g, [[-hw, -i * 4], [0, hh - i * 4]], 0.6);
        strokePts(g, [[0, hh - i * 4], [hw, -i * 4]], 0.6);
      }
      // corner bands + studs
      const bandC = color2;
      for (const t of [0.12, 0.88]) {
        const lx = -hw + hw * t; const ly = hh * t;
        g.fillStyle = litH(g, lx - 1.5, lx + 1.5, bandC, 0.4, 0.5);
        fillPts(g, [[lx - 1.4, ly - 0.7], [lx + 1.4, ly + 0.7], [lx + 1.4, ly + 0.7 - h], [lx - 1.4, ly - 0.7 - h]]);
        const rx = hw * t; const ry = hh - hh * t;
        g.fillStyle = litH(g, rx - 1.5, rx + 1.5, dark(bandC, 0.8), 0.3, 0.5);
        fillPts(g, [[rx - 1.4, ry + 0.7], [rx + 1.4, ry - 0.7], [rx + 1.4, ry - 0.7 - h], [rx - 1.4, ry + 0.7 - h]]);
        rivet(g, lx, ly - h * 0.5, 0.6, bandC);
      }
      if (state === 'open') {
        // dark interior, treasure glint, lid swung back
        g.fillStyle = '#120c08';
        fillPts(g, [[0, -h - hh + 1.5], [hw - 1.5, -h], [0, -h + hh - 1.5], [-hw + 1.5, -h]]);
        g.fillStyle = litRadial(g, 1, -h + 1, 9, color2, 0.6, 0.3);
        g.beginPath(); g.ellipse(1, -h + 1, 8, 3.2, 0, 0, TAU); g.fill();
        for (let i = 0; i < 5; i++) { g.fillStyle = light(color2, 0.5); g.fillRect(-5 + i * 2.6, -h - 0.5 + (i % 2), 1, 1); }
        // lid: a slab rising from the back edge
        const lidH = 13;
        g.fillStyle = litLinear(g, -hw, -h - hh, 0, -h - hh - lidH, dark(color, 0.75), 0.2, 0.35);
        fillPts(g, [[-hw, -h], [0, -h - hh], [0, -h - hh - lidH], [-hw, -h - lidH]]);
        g.fillStyle = litLinear(g, 0, -h - hh, hw, -h - lidH, dark(color, 0.55), 0.15, 0.3);
        fillPts(g, [[0, -h - hh], [hw, -h], [hw, -h - lidH], [0, -h - hh - lidH]]);
        g.strokeStyle = rgba(color2, 0.9);
        strokePts(g, [[-hw + 2, -h - 1], [-hw + 2, -h - lidH + 1]], 1.4);
        strokePts(g, [[hw - 2, -h - 1], [hw - 2, -h - lidH + 1]], 1.4);
      } else {
        // rounded lid: a half-cylinder along the long (left->right) axis
        const top = -h;
        const lid = 6;
        const L0 = [-hw, top]; const F0 = [0, top + hh]; const R0 = [hw, top]; const B0 = [0, top - hh];
        // left face of the lid (curved front)
        g.fillStyle = litLinear(g, -hw, top - lid, 0, top + hh, color, 0.35, 0.35);
        g.beginPath();
        g.moveTo(L0[0], L0[1]); g.lineTo(F0[0], F0[1]);
        g.bezierCurveTo(F0[0] + hw * 0.3, F0[1] - hh * 0.3 - lid * 1.2, B0[0] + hw * 0.1, B0[1] + hh * 0.1 - lid * 1.4, R0[0] * 0.25, -h - hh * 0.6 - lid);
        g.lineTo(-hw * 0.75, top - hh * 0.25 - lid - 1);
        g.bezierCurveTo(-hw - 0.5, top - lid * 0.8, -hw, top - 1, L0[0], L0[1]);
        g.fill();
        // right end cap
        g.fillStyle = litLinear(g, 0, top, hw, top - lid, dark(color, 0.62), 0.15, 0.3);
        g.beginPath();
        g.moveTo(F0[0], F0[1]); g.lineTo(R0[0], R0[1]);
        g.bezierCurveTo(R0[0], R0[1] - lid * 1.1, R0[0] * 0.5, top - hh * 0.4 - lid * 1.5, R0[0] * 0.25, -h - hh * 0.6 - lid);
        g.bezierCurveTo(B0[0] + hw * 0.1, B0[1] + hh * 0.1 - lid * 1.4, F0[0] + hw * 0.3, F0[1] - hh * 0.3 - lid * 1.2, F0[0], F0[1]);
        g.fill();
        // lid bands
        g.strokeStyle = color2;
        g.lineWidth = 1.6;
        for (const t of [0.15, 0.85]) {
          const bx = -hw + hw * t; const by = top + hh * t;
          g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + 4, by - lid * 1.6, bx + hw * 0.55, by - hh * 0.7 - lid * 0.6); g.stroke();
        }
        // lock plate
        const lx = -hw * 0.5; const ly = top + hh * 0.5 + 1;
        g.fillStyle = litH(g, lx - 2.5, lx + 2.5, color2, 0.45, 0.5);
        fillPts(g, [[lx - 2.4, ly - 3.4], [lx + 2.4, ly - 1], [lx + 2.4, ly + 3.4], [lx - 2.4, ly + 1]]);
        g.fillStyle = '#100a06';
        g.fillRect(lx - 0.5, ly - 0.2, 1, 2);
      }
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  slab(c, color, color2, state, orient) {
    // Closed: a door leaf filling the 'left' wall face (edge left-vertex -> bottom-vertex).
    // Open: swung 90 degrees against the neighbouring face, half length.
    c.scale(orient === 'right' ? -1 : 1, 1);
    const H = DOOR_H;
    inked(c, (g) => {
      if (state === 'open') {
        const ax = 0; const ay = HALF_H; const bx = HALF_W * 0.55; const by = HALF_H * 0.45;
        g.fillStyle = litLinear(g, ax, ay - H, bx, by, dark(color, 0.7), 0.15, 0.4);
        fillPts(g, facePts(ax, ay, bx, by, 0, H * 0.9));
        g.fillStyle = rgba(dark(color, 0.3), 0.9);
        fillPts(g, [[bx, by], [bx + 1.5, by - 0.8], [bx + 1.5, by - 0.8 - H * 0.9], [bx, by - H * 0.9]]);
        g.strokeStyle = color2;
        for (const v of [0.22, 0.7]) strokePts(g, [[ax, ay - H * v], [bx, by - H * v]], 1.4);
        return;
      }
      const ax = -HALF_W; const ay = 0; const bx = 0; const by = HALF_H;
      // frame (jambs and lintel) in a darker tone
      const frame = dark(color, 0.55);
      g.fillStyle = litLinear(g, ax, ay - H, bx, by, frame, 0.15, 0.35);
      fillPts(g, facePts(ax, ay, bx, by, 0, H));
      // leaf with an arched top
      const u0 = 0.14; const u1 = 0.86;
      const pA = [ax + (bx - ax) * u0, ay + (by - ay) * u0];
      const pB = [ax + (bx - ax) * u1, ay + (by - ay) * u1];
      const top = H * 0.86;
      const mid = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2];
      g.fillStyle = litLinear(g, pA[0], pA[1] - top, pB[0], pB[1], color, 0.28, 0.45);
      g.beginPath();
      g.moveTo(pA[0], pA[1]); g.lineTo(pB[0], pB[1]); g.lineTo(pB[0], pB[1] - top * 0.82);
      g.quadraticCurveTo(mid[0], mid[1] - top * 1.08, pA[0], pA[1] - top * 0.82);
      g.closePath();
      g.fill();
      // planks
      g.strokeStyle = rgba(dark(color, 0.4), 0.8);
      for (let i = 1; i < 5; i++) {
        const u = u0 + (u1 - u0) * (i / 5);
        const px = ax + (bx - ax) * u; const py = ay + (by - ay) * u;
        const arch = 1 - Math.pow((i / 5) * 2 - 1, 2);
        strokePts(g, [[px, py - 0.5], [px, py - top * (0.82 + 0.2 * arch)]], 0.6);
      }
      // bands with studs
      for (const v of [0.22, 0.62]) {
        g.strokeStyle = color2;
        strokePts(g, [[pA[0], pA[1] - top * v], [pB[0], pB[1] - top * v]], 2);
        g.strokeStyle = rgba(dark(color2, 0.4), 0.8);
        strokePts(g, [[pA[0], pA[1] - top * v + 1.1], [pB[0], pB[1] - top * v + 1.1]], 0.5);
        for (let i = 0; i <= 4; i++) {
          const u = i / 4;
          rivet(g, pA[0] + (pB[0] - pA[0]) * u, pA[1] + (pB[1] - pA[1]) * u - top * v, 0.55, color2);
        }
      }
      // ring handle
      const hx = pA[0] + (pB[0] - pA[0]) * 0.78; const hy = pA[1] + (pB[1] - pA[1]) * 0.78 - top * 0.42;
      g.strokeStyle = color2;
      g.lineWidth = 0.9;
      g.beginPath(); g.ellipse(hx, hy + 1.8, 1.4, 2, 0, 0, TAU); g.stroke();
      rivet(g, hx, hy, 0.8, color2);
      // threshold shadow
      g.fillStyle = 'rgba(0,0,0,0.35)';
      fillPts(g, [[pA[0], pA[1]], [pB[0], pB[1]], [pB[0], pB[1] - 1.2], [pA[0], pA[1] - 1.2]]);
    }, { outline: OUTLINE, rimAlpha: 0.25, outlineW: 0.8 });
  },

  barrel(c, color, color2, state) {
    contactShadow(c, 0, 1, 15, 7, 0.55);
    inked(c, (g) => {
      if (state === 'broken') {
        brokenStaves(g, color, color2);
        return;
      }
      const rx = 10; const ry = 5; const h = 25;
      // bulging body: three stacked cylinders
      cylinder(g, 0, 0, rx - 1, ry - 0.5, 6, color);
      cylinder(g, 0, -5, rx, ry, 15, color);
      cylinder(g, 0, -19, rx - 1, ry - 0.5, 6, color);
      // staves
      g.strokeStyle = rgba(dark(color, 0.4), 0.7);
      for (let i = -3; i <= 3; i++) {
        const x = (i / 3.5) * rx;
        const bulge = (1 - Math.abs(i) / 4) * 0.6;
        strokePts(g, [[x * 0.92, ry * Math.sqrt(1 - Math.min(0.98, (x / rx) ** 2)) - 1], [x * (1 + bulge * 0.05), -h * 0.5], [x * 0.92, -h + ry * Math.sqrt(1 - Math.min(0.98, (x / rx) ** 2)) - 0.5]], 0.6);
      }
      // hoops
      for (const y of [-3.5, -10, -16, -22]) band(g, 0, y, rx - (y < -20 || y > -5 ? 0.6 : 0), ry, color2, 1.6);
      for (const y of [-3.5, -22]) for (const x of [-6, 0, 6]) rivet(g, x, y + ry * Math.sqrt(1 - (x / rx) ** 2) - 0.2, 0.5, color2);
      // lid rim
      g.strokeStyle = rgba(dark(color, 0.45), 0.9);
      g.lineWidth = 0.8;
      g.beginPath(); g.ellipse(0, -h, rx - 2.4, ry - 1.4, 0, 0, TAU); g.stroke();
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  crate(c, color, color2, state) {
    contactShadow(c, 0, 2, 17, 8, 0.55);
    inked(c, (g) => {
      if (state === 'broken') { brokenPlanks(g, color, color2); return; }
      const hw = 13; const hh = 6.5; const h = 18;
      isoBlock(g, 0, 0, hw, hh, h, color, { edge: false });
      const bc = mix(color, color2, 0.5);
      g.strokeStyle = bc;
      // frame edges on both faces + diagonal braces
      const L = [-hw, 0]; const F = [0, hh]; const R = [hw, 0];
      for (const [a, b] of [[L, F], [F, R]]) {
        strokePts(g, [[a[0] + (b[0] - a[0]) * 0.06, a[1] + (b[1] - a[1]) * 0.06 - 1.2], [b[0] - (b[0] - a[0]) * 0.06, b[1] - (b[1] - a[1]) * 0.06 - 1.2]], 2);
        strokePts(g, [[a[0] + (b[0] - a[0]) * 0.06, a[1] + (b[1] - a[1]) * 0.06 - h + 1.2], [b[0] - (b[0] - a[0]) * 0.06, b[1] - (b[1] - a[1]) * 0.06 - h + 1.2]], 2);
        strokePts(g, [[a[0] + (b[0] - a[0]) * 0.08, a[1] + (b[1] - a[1]) * 0.08 - 2], [b[0] - (b[0] - a[0]) * 0.08, b[1] - (b[1] - a[1]) * 0.08 - h + 2]], 1.8);
      }
      g.strokeStyle = rgba(dark(color, 0.4), 0.6);
      for (const v of [h / 3, (2 * h) / 3]) {
        strokePts(g, [[L[0], L[1] - v], [F[0], F[1] - v]], 0.5);
        strokePts(g, [[F[0], F[1] - v], [R[0], R[1] - v]], 0.5);
      }
      // top boards
      g.strokeStyle = rgba(dark(color, 0.5), 0.6);
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        strokePts(g, [[-hw + hw * t, -h - hh * t], [hw * t, -h + hh - hh * t]], 0.5);
      }
      // stencil mark
      g.fillStyle = rgba(color2, 0.7);
      g.save(); g.transform(1, 0.5, 0, 1, -hw * 0.55, -h * 0.55 + hh * 0.45); g.fillRect(-2.5, -2, 5, 1.2); g.fillRect(-2.5, 0.6, 3, 1.2); g.restore();
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  rack(c, color, color2, state) {
    contactShadow(c, 0, 2, 20, 9, 0.5);
    inked(c, (g) => {
      if (state === 'broken') { brokenPlanks(g, color, color2); return; }
      const hw = 16; const hh = 8; const h = 34;
      // back panel along the left->right axis (the rack faces the viewer's lower-left)
      isoBlock(g, 0, -2, hw, 3.5, h, color, { edge: false });
      // shelves and contents
      for (let i = 0; i < 3; i++) {
        const y = -6 - i * 10;
        g.fillStyle = litH(g, -hw, hw, dark(color, 0.8), 0.3, 0.5);
        fillPts(g, [[-hw, y], [0, y + hh * 0.9], [0, y + hh * 0.9 - 1.6], [-hw, y - 1.6]]);
        // contents: alternating blocks with accent lights
        for (let k = 0; k < 4; k++) {
          const t = (k + 0.5) / 4;
          const x = -hw + hw * t; const yy = y + hh * 0.9 * t - 2;
          g.fillStyle = litH(g, x - 1.8, x + 1.8, mix(color, '#000', 0.3), 0.4, 0.5);
          fillPts(g, [[x - 1.8, yy - 0.9], [x + 1.8, yy + 0.9], [x + 1.8, yy + 0.9 - 6], [x - 1.8, yy - 0.9 - 6]]);
          g.fillStyle = (k + i) % 3 === 0 ? light(color2, 0.3) : rgba(color2, 0.75);
          g.fillRect(x - 0.6, yy - 4.4, 1.2, 1.2);
        }
      }
      // uprights
      for (const x of [-hw, 0]) {
        const y = x === 0 ? hh * 0.9 - 2 : -2;
        capsule(g, x, y, x, y - h, 1.3, 1.3, dark(color, 0.9), 0.3, 0.5);
      }
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  altar(c, color, color2, state) {
    contactShadow(c, 0, 3, 28, 13, 0.55);
    inked(c, (g) => {
      // stepped plinth
      isoBlock(g, 0, 3, 24, 12, 4, dark(color, 0.85), { edge: true });
      const top = isoBlock(g, 0, -1, 18, 9, 14, color, { edge: true });
      // carved runes on the front faces
      g.strokeStyle = rgba(color2, 0.85);
      g.lineWidth = 0.8;
      for (let i = 0; i < 3; i++) {
        const t = 0.25 + i * 0.25;
        const x = -18 + 18 * t; const y = -1 + 9 * t - 7;
        g.beginPath(); g.moveTo(x - 1.2, y - 1.5); g.lineTo(x + 1.2, y + 1.5); g.moveTo(x + 1.2, y - 1.5 + 1.2); g.lineTo(x - 1.2, y + 1.2); g.stroke();
      }
      // altar cloth runner hanging over the front-left face
      g.fillStyle = litLinear(g, -9, top - 4, -4, top + 12, dark(color2, 0.55), 0.2, 0.4);
      fillPts(g, [[-11, top + 3.5], [-5, top + 6.5], [-5, top + 16], [-8, top + 15], [-11, top + 13]]);
      // top slab detail + focus
      g.fillStyle = rgba(dark(color, 0.4), 0.8);
      g.beginPath(); g.ellipse(0, top, 8, 4, 0, 0, TAU); g.fill();
      g.fillStyle = litRadial(g, 0, top - 1, 6, color2, 0.4, 0.5);
      g.beginPath(); g.ellipse(0, top - 0.6, 6.5, 3.2, 0, 0, TAU); g.fill();
      if (state === 'active') {
        sphere(g, 0, top - 14, 4, light(color2, 0.4), 0.7, 0.2);
      }
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  brazier(c, color, color2) {
    contactShadow(c, 0, 2, 18, 8, 0.6);
    inked(c, (g) => {
      // three splayed legs
      for (const [x, y] of [[-10, 1], [10, 1], [0, 6]]) capsule(g, x, y, x * 0.35, y * 0.3 - 17, 1.4, 1.6, dark(color, 0.9), 0.4, 0.5);
      // bowl: a frustum rendered as a cylinder pinched at the bottom
      g.fillStyle = litH(g, -13, 13, color, 0.35, 0.6);
      g.beginPath();
      g.ellipse(0, -26, 13, 5.5, 0, 0, Math.PI);
      g.quadraticCurveTo(-11, -15, 0, -14);
      g.quadraticCurveTo(11, -15, 13, -26);
      g.fill();
      g.beginPath(); g.ellipse(0, -26, 13, 5.5, 0, 0, Math.PI); g.lineTo(-13, -26); g.fill();
      // rim
      g.strokeStyle = light(color, 0.25);
      g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(0, -26, 13, 5.5, 0, 0, TAU); g.stroke();
      // coals, glowing
      const cg = g.createRadialGradient(0, -26, 0, 0, -26, 12);
      cg.addColorStop(0, light(color2, 0.6));
      cg.addColorStop(0.5, color2);
      cg.addColorStop(1, dark(color2, 0.35));
      g.fillStyle = cg;
      g.beginPath(); g.ellipse(0, -26, 11.5, 4.5, 0, 0, TAU); g.fill();
      g.fillStyle = rgba(dark(color, 0.4), 0.8);
      for (let i = 0; i < 7; i++) { const a = i * 2.1; g.beginPath(); g.arc(Math.cos(a) * 6, -26 + Math.sin(a) * 2.2, 1.2, 0, TAU); g.fill(); }
      // decorative band and studs
      g.strokeStyle = rgba(dark(color, 0.4), 0.9);
      g.lineWidth = 1;
      g.beginPath(); g.ellipse(0, -22, 11.5, 4.2, 0, 0.05 * Math.PI, 0.95 * Math.PI); g.stroke();
      for (const x of [-8, 0, 8]) rivet(g, x, -21 + (x === 0 ? 3.6 : 2.4), 0.7, light(color, 0.3));
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  lamp(c, color, color2) {
    contactShadow(c, 0, 2, 10, 4.5, 0.55);
    inked(c, (g) => {
      // base and post
      isoBlock(g, 0, 0, 5.5, 2.8, 3, dark(color, 0.9), { edge: false });
      capsule(g, 0, -3, 0, -52, 1.8, 1.4, color, 0.35, 0.5);
      g.strokeStyle = rgba(light(color, 0.2), 0.8);
      for (const y of [-14, -36]) { g.lineWidth = 1.2; g.beginPath(); g.ellipse(0, y, 2.6, 1, 0, 0, TAU); g.stroke(); }
      // arm and housing
      capsule(g, 0, -50, 7, -54, 1, 1, color, 0.35, 0.5);
      g.fillStyle = litH(g, 3, 11, dark(color, 0.9), 0.3, 0.5);
      fillPts(g, [[3.5, -54], [10.5, -54], [9.5, -59], [4.5, -59]]);
      // lit glass (bright, glow added by the lighting pass)
      const lg = g.createLinearGradient(4, -53, 10, -45);
      lg.addColorStop(0, light(color2, 0.75));
      lg.addColorStop(1, color2);
      g.fillStyle = lg;
      fillPts(g, [[4.3, -53.5], [9.7, -53.5], [9.2, -45.5], [4.8, -45.5]]);
      g.fillStyle = dark(color, 0.8);
      fillPts(g, [[4, -45.6], [10, -45.6], [9, -44], [5, -44]]);
      // a vertical strip of colour2 down the post (reads as neon or brass)
      g.strokeStyle = rgba(color2, 0.85);
      strokePts(g, [[0.6, -10], [0.6, -32]], 0.8);
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  post(c, color, color2) {
    contactShadow(c, 0, 2, 10, 4.5, 0.5);
    inked(c, (g) => {
      capsule(g, 0, 0, 0, -36, 1.8, 1.6, color, 0.3, 0.5);
      // board, slightly angled
      g.fillStyle = litLinear(g, -13, -40, 13, -24, color2, 0.3, 0.45);
      fillPts(g, [[-13, -38], [13, -41], [13, -27], [-13, -24]]);
      g.fillStyle = rgba(dark(color2, 0.5), 0.9);
      fillPts(g, [[13, -41], [14.2, -40.4], [14.2, -26.4], [13, -27]]);
      g.fillStyle = rgba(dark(color, 0.6), 0.85);
      for (let i = 0; i < 3; i++) g.fillRect(-9, -35 + i * 3.6 - i * 0.3, 14 - i * 3, 1.3);
      for (const [x, y] of [[-11.5, -36.6], [11.5, -39.3], [-11.5, -25.8], [11.5, -28.6]]) rivet(g, x, y, 0.55, light(color, 0.4));
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  banner(c, color, color2) {
    contactShadow(c, 0, 2, 9, 4, 0.5);
    inked(c, (g) => {
      // pole with a spearhead finial and cross bar
      capsule(g, 0, 0, 0, -62, 1.4, 1.2, color, 0.35, 0.5);
      g.fillStyle = litH(g, -2, 2, light(color, 0.2), 0.5, 0.5);
      fillPts(g, [[0, -70], [2, -64], [0, -61], [-2, -64]]);
      capsule(g, -9, -58, 9, -60, 0.9, 0.9, dark(color, 0.9), 0.3, 0.5);
      // cloth: hangs from the bar, swallow-tailed hem, folds
      const top = -58;
      const pts = [[-8.5, top + 0.5], [8.5, top - 1], [8, top + 30], [0, top + 24], [-8, top + 31]];
      g.fillStyle = litH(g, -9, 9, color2, 0.25, 0.55);
      fillPts(g, pts);
      const vg = g.createLinearGradient(0, top, 0, top + 32);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = vg; fillPts(g, pts);
      g.strokeStyle = rgba(dark(color2, 0.4), 0.6);
      for (const x of [-4, 4]) strokePts(g, [[x, top + 1], [x + 0.6, top + 22]], 1);
      // emblem: a simple chevron/diamond in a light tint of the cloth
      g.fillStyle = rgba(light(color2, 0.55), 0.85);
      fillPts(g, [[0, top + 6], [4, top + 11], [0, top + 16], [-4, top + 11]]);
      g.fillStyle = rgba(dark(color2, 0.5), 0.9);
      fillPts(g, [[0, top + 8.5], [1.8, top + 11], [0, top + 13.5], [-1.8, top + 11]]);
      g.strokeStyle = rgba(light(color2, 0.4), 0.7);
      strokePts(g, [[-8.3, top + 3], [8.3, top + 1.5]], 0.8);
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  lever(c, color, color2, state) {
    contactShadow(c, 0, 1, 10, 5, 0.5);
    inked(c, (g) => {
      isoBlock(g, 0, 0, 7, 3.5, 7, color, { edge: true });
      g.fillStyle = 'rgba(0,0,0,0.6)';
      fillPts(g, [[-3, -7], [0, -5.5], [3, -7], [0, -8.5]]);
      const tilt = state === 'on' ? 1 : -1;
      capsule(g, 0, -7, tilt * 9, -24, 1.3, 1, light(color, 0.2), 0.4, 0.5);
      sphere(g, tilt * 9, -25, 2.8, color2, 0.6, 0.5);
      // status pip
      g.fillStyle = state === 'on' ? light(color2, 0.3) : dark(color2, 0.4);
      g.fillRect(-5, -3.5, 1.6, 1.6);
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  plate(c, color, color2) {
    // pressure plate, flush with the floor
    c.fillStyle = 'rgba(0,0,0,0.35)';
    fillPts(c, [[0, -8], [16, 0], [0, 8], [-16, 0]]);
    c.fillStyle = litLinear(c, -14, -7, 14, 7, color, 0.25, 0.4);
    fillPts(c, [[0, -6.5], [13, 0], [0, 6.5], [-13, 0]]);
    c.strokeStyle = rgba(color2, 0.6);
    c.lineWidth = 0.7;
    c.beginPath(); c.moveTo(0, -4); c.lineTo(8, 0); c.lineTo(0, 4); c.lineTo(-8, 0); c.closePath(); c.stroke();
  },

  basin(c, color, color2) {
    contactShadow(c, 0, 3, 24, 11, 0.5);
    inked(c, (g) => {
      // pedestal + wide round basin with water
      cylinder(g, 0, 0, 6, 3, 8, dark(color, 0.85));
      cylinder(g, 0, -8, 18, 8.5, 7, color);
      g.fillStyle = dark(color, 0.45);
      g.beginPath(); g.ellipse(0, -15, 15.5, 7, 0, 0, TAU); g.fill();
      const wg = g.createLinearGradient(-12, -20, 12, -10);
      wg.addColorStop(0, light(color2, 0.45)); wg.addColorStop(0.5, color2); wg.addColorStop(1, dark(color2, 0.55));
      g.fillStyle = wg;
      g.beginPath(); g.ellipse(0, -14.4, 14.5, 6.3, 0, 0, TAU); g.fill();
      g.strokeStyle = rgba(light(color2, 0.7), 0.6);
      g.lineWidth = 0.6;
      for (const r of [3, 6.5, 10]) { g.beginPath(); g.ellipse(1, -14.4, r, r * 0.43, 0, 0, TAU); g.stroke(); }
      // spout column
      cylinder(g, 0, -15, 2.2, 1.1, 12, light(color, 0.1));
      g.fillStyle = light(color2, 0.4);
      g.beginPath(); g.ellipse(0, -27.5, 3, 1.4, 0, 0, TAU); g.fill();
      band(g, 0, -10, 18, 8.5, rgba(dark(color, 0.4), 0.8), 1);
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  well(c, color, color2) {
    contactShadow(c, 0, 3, 24, 11, 0.5);
    inked(c, (g) => {
      // ring wall of blocks
      cylinder(g, 0, 0, 17, 8, 11, color, 0.3, 0.6);
      g.fillStyle = '#05070a';
      g.beginPath(); g.ellipse(0, -11, 13.5, 6, 0, 0, TAU); g.fill();
      g.fillStyle = rgba(color2, 0.55);
      g.beginPath(); g.ellipse(0, -9.5, 10, 4, 0, 0, TAU); g.fill();
      g.strokeStyle = rgba(dark(color, 0.4), 0.75);
      g.lineWidth = 0.6;
      for (const y of [-4, -8]) { g.beginPath(); g.ellipse(0, y, 17.1, 8.05, 0, 0.02 * Math.PI, 0.98 * Math.PI); g.stroke(); }
      for (let i = 0; i < 7; i++) {
        const a = 0.12 * Math.PI + (i / 6) * 0.76 * Math.PI + ((i % 2) * 0.06);
        const x = Math.cos(a) * 17; const y = Math.sin(a) * 8;
        strokePts(g, [[x, y - (i % 2 ? 4 : 0)], [x, y - (i % 2 ? 8 : 4)]], 0.6);
      }
      // posts, crossbeam, roof
      for (const x of [-15, 15]) capsule(g, x, -6, x, -36, 1.6, 1.5, dark(color, 0.75), 0.3, 0.5);
      capsule(g, -15, -32, 15, -32, 1.1, 1.1, dark(color, 0.6), 0.3, 0.5);
      g.strokeStyle = 'rgba(200,190,170,0.6)';
      strokePts(g, [[2, -32], [2, -16]], 0.5);
      g.fillStyle = litH(g, 0, 4, dark(color2, 0.6), 0.3, 0.5);
      g.fillRect(0.5, -17, 3, 3);
      g.fillStyle = litLinear(g, -19, -44, 19, -32, dark(color, 0.7), 0.25, 0.45);
      fillPts(g, [[-19, -33], [0, -45], [19, -33], [17, -31], [0, -42], [-17, -31]]);
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  stand(c, color, color2) {
    contactShadow(c, 0, 2, 12, 5.5, 0.5);
    inked(c, (g) => {
      isoBlock(g, 0, 0, 7, 3.5, 2, dark(color, 0.85), { edge: false });
      capsule(g, 0, -2, 0, -22, 2.2, 1.8, color, 0.3, 0.5);
      // slanted top
      g.fillStyle = litLinear(g, -12, -30, 12, -20, color, 0.3, 0.45);
      fillPts(g, [[-12, -24], [1, -31], [12, -25], [-1, -18]]);
      g.fillStyle = dark(color, 0.6);
      fillPts(g, [[-12, -24], [-1, -18], [-1, -16.5], [-12, -22.5]]);
      // open book / screen
      g.fillStyle = litLinear(g, -9, -29, 9, -21, color2, 0.25, 0.35);
      fillPts(g, [[-9.5, -24], [0, -29], [0.6, -28.6], [-8.9, -23.5]]);
      fillPts(g, [[0.6, -28.6], [9.5, -24.6], [0.2, -19.8], [-8.9, -23.5]]);
      g.strokeStyle = rgba(dark(color2, 0.4), 0.6);
      for (let i = 0; i < 3; i++) {
        strokePts(g, [[-6.5 + i * 0.8, -24.2 - i * 0.6 + 1.3], [-1.5 + i * 0.8, -26.6 - i * 0.6 + 1.3]], 0.4);
        strokePts(g, [[2.5 + i * 0.8, -26.3 + i * 0.9], [7 + i * 0.4, -24.3 + i * 0.9]], 0.4);
      }
    }, { outline: OUTLINE, rimAlpha: 0.3 });
  },

  stairs(c, color, color2, state) {
    // Steps parallel to the left->bottom edge. Down: a dark well with steps descending.
    // Up: steps rising with lit treads and shaded risers.
    const down = state !== 'up';
    const hw = HALF_W - 2;
    const hh = HALF_H - 1;
    const N = 5;
    const RISE = 4;
    if (down) {
      c.fillStyle = '#050406';
      fillPts(c, [[0, -hh], [hw, 0], [0, hh], [-hw, 0]]);
    }
    for (let i = 0; i < N; i++) {
      const t0 = i / N; const t1 = (i + 1) / N;
      const rise = down ? (i + 1) * 2.2 : -i * RISE;
      const k = down ? 0.95 - (i / N) * 0.7 : 0.65 + (i / N) * 0.4;
      const tread = [
        [-hw + t0 * hw, -t0 * hh + rise], [t0 * hw, hh - t0 * hh + rise],
        [t1 * hw, hh - t1 * hh + rise], [-hw + t1 * hw, -t1 * hh + rise],
      ];
      c.fillStyle = litLinear(c, tread[0][0], tread[0][1], tread[2][0], tread[2][1], dark(color, k), 0.2, 0.2);
      fillPts(c, tread);
      // riser (front face of the step)
      const riseH = down ? 2.2 : RISE;
      c.fillStyle = dark(color, k * 0.55);
      fillPts(c, [tread[0], tread[1], [tread[1][0], tread[1][1] + riseH], [tread[0][0], tread[0][1] + riseH]]);
      c.strokeStyle = rgba(light(color, 0.35), down ? 0.35 * (1 - i / N) : 0.55);
      c.lineWidth = 0.7;
      c.beginPath(); c.moveTo(tread[0][0], tread[0][1]); c.lineTo(tread[1][0], tread[1][1]); c.stroke();
    }
    c.strokeStyle = rgba(color2, 0.75);
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, -hh); c.lineTo(hw, 0); c.lineTo(0, hh); c.lineTo(-hw, 0); c.closePath(); c.stroke();
    if (down) {
      const vg = c.createLinearGradient(-hw * 0.5, 0, hw * 0.5, hh * 0.5);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      c.fillStyle = vg;
      fillPts(c, [[0, -hh], [hw, 0], [0, hh], [-hw, 0]]);
    }
  },
};

function brokenStaves(g, color, color2) {
  const bits = [[-12, -2, -4, -7], [-3, 3, 6, -2], [5, -4, 13, 1], [-8, 4, -1, 6]];
  for (const [x0, y0, x1, y1] of bits) capsule(g, x0, y0, x1, y1, 1.8, 1.6, color, 0.3, 0.55);
  g.strokeStyle = color2;
  g.lineWidth = 1.3;
  g.beginPath(); g.ellipse(1, 0, 9, 4, 0.2, 0.2, 2.6); g.stroke();
  g.fillStyle = rgba(dark(color, 0.3), 0.9);
  g.beginPath(); g.ellipse(-1, 1, 5, 2.2, 0, 0, TAU); g.fill();
}

function brokenPlanks(g, color, color2) {
  const bits = [[-13, -1, -3, -5, 0.4], [-4, 4, 9, 0, -0.2], [3, -5, 12, -2, 0.3], [-9, 5, -4, 7, 0], [6, 5, 10, 7, 0]];
  for (const [x0, y0, x1, y1] of bits) {
    capsule(g, x0, y0, x1, y1, 1.6, 1.6, color, 0.3, 0.55);
  }
  g.strokeStyle = rgba(mix(color, color2, 0.5), 0.9);
  strokePts(g, [[-11, -2], [-5, -4.5]], 0.8);
}

/* ------------------------------------------------------------------ animated parts */

function flameFrame(color2, fr) {
  return cached(`flame|${color2}|${fr}`, 40, 56, 20, 50, (c) => {
    const ph = (fr / FLAME_FRAMES) * TAU;
    c.globalCompositeOperation = 'lighter';
    // three tongues of different height that sway out of phase
    const tongues = [[-4, 22, 0], [3, 28, 2.1], [0, 34, 4.2], [-6, 14, 1.3], [6, 16, 3.3]];
    for (const [x, h, p] of tongues) {
      const sway = Math.sin(ph + p) * 2.4;
      const hh = h * (0.85 + 0.15 * Math.sin(ph * 2 + p));
      const g = c.createLinearGradient(0, 0, 0, -hh);
      g.addColorStop(0, rgba(color2, 0.95));
      g.addColorStop(0.45, rgba(light(color2, 0.25), 0.75));
      g.addColorStop(1, rgba(color2, 0));
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x - 5, 0);
      c.quadraticCurveTo(x - 5 + sway * 0.3, -hh * 0.5, x + sway, -hh);
      c.quadraticCurveTo(x + 5 + sway * 0.3, -hh * 0.5, x + 5, 0);
      c.closePath();
      c.fill();
    }
    // white-hot core
    const core = c.createRadialGradient(0, -5, 0, 0, -5, 9);
    core.addColorStop(0, 'rgba(255,255,240,0.95)');
    core.addColorStop(0.5, rgba(light(color2, 0.6), 0.6));
    core.addColorStop(1, rgba(color2, 0));
    c.fillStyle = core;
    c.beginPath(); c.ellipse(0, -5, 9, 7, 0, 0, TAU); c.fill();
  });
}

const ANIMATED = {
  brazier(ctx, sx, sy, color, color2, t) {
    const fr = Math.floor(t * FLAME_FPS) % FLAME_FRAMES;
    blit(ctx, flameFrame(color2, fr), sx, sy - 26);
    addGlow(sx, sy - 40, 16, light(color2, 0.4), 0.55);
  },
  lamp(ctx, sx, sy, color, color2) {
    addGlow(sx + 7, sy - 50, 9, light(color2, 0.4), 0.6);
  },
  altar(ctx, sx, sy, color, color2, t, state) {
    if (state === 'active') addGlow(sx, sy - 26, 16 + Math.sin(t * 3) * 2, color2, 0.5);
  },
  rack(ctx, sx, sy, color, color2, t) {
    if (Math.sin(t * 2.3) > 0.2) addGlow(sx - 8, sy - 20, 10, color2, 0.25);
  },
};

function portal(c, color, color2, fr) {
  const ph = (fr / PORTAL_FRAMES) * TAU;
  const RX = 15; const RY = 28; const CY = -30;
  // stone/metal frame ring behind
  contactShadow(c, 0, 2, 20, 8, 0.5);
  // swirl body
  const g = c.createRadialGradient(0, CY, 2, 0, CY, RY);
  g.addColorStop(0, rgba(light(color, 0.7), 0.95));
  g.addColorStop(0.35, rgba(color, 0.8));
  g.addColorStop(0.8, rgba(color2, 0.65));
  g.addColorStop(1, rgba(color2, 0));
  c.fillStyle = g;
  c.beginPath(); c.ellipse(0, CY, RX, RY, 0, 0, TAU); c.fill();
  // spiral arms
  c.save();
  c.translate(0, CY);
  c.scale(RX / RY, 1);
  c.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    c.strokeStyle = rgba(light(color, 0.5), 0.75);
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i <= 24; i++) {
      const tt = i / 24;
      const a = ph + arm * (TAU / 3) + tt * 4.2;
      const r = 3 + tt * (RY - 4);
      if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r); else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.stroke();
  }
  c.restore();
  // rim
  c.strokeStyle = rgba(light(color2, 0.4), 0.9);
  c.lineWidth = 1.6;
  c.beginPath(); c.ellipse(0, CY, RX, RY, 0, 0, TAU); c.stroke();
  // floor ring
  c.strokeStyle = rgba(color, 0.7);
  c.lineWidth = 1.2;
  c.beginPath(); c.ellipse(0, 0, RX + 4, (RX + 4) / 2, 0, 0, TAU); c.stroke();
  for (let i = 0; i < 6; i++) {
    const a = ph * 0.5 + (i / 6) * TAU;
    c.fillStyle = rgba(light(color, 0.6), 0.85);
    c.fillRect(Math.cos(a) * (RX + 4) - 0.8, Math.sin(a) * (RX + 4) * 0.5 - 0.8, 1.6, 1.6);
  }
}

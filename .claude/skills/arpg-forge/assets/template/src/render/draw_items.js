/**
 * Procedural item glyphs (inventory icons and floor drops) and missiles.
 *
 * look: { glyph:'blade'|'axe'|'mace'|'bow'|'gun'|'staff'|'wand'|'shield'|'helm'|'chest'|
 *         'boots'|'gloves'|'belt'|'ring'|'amulet'|'flask'|'scroll'|'book'|'gem'|'key'|'coin'|'generic',
 *         color, color2? }
 *
 * Colour convention (all glyphs): `color` is the primary material (blade, axe head, shaft,
 * armour shell, glass, paper, band), `color2` the secondary (hilt / handle, trim, gem, liquid,
 * seal, string). Nothing here knows about any setting; defaults are neutral.
 *
 * Glyphs are authored in a 24-unit box centred on the origin, painted with volume shading
 * (key light upper-left), a rim light and a dark outline via draw_volume.inked, and cached per
 * (glyph, colours, size). Weapons lie on the diagonal, hilt bottom-left, like a classic inventory.
 *
 * Missiles: look { shape:'bolt'|'arrow'|'orb'|'shard'|'ring'|'flame', color, size?, glyph? } —
 * look.glyph 'flame' turns an orb/bolt into a fireball. Cached per (shape, colour, size, dir,
 * flicker phase); 4 phases cycle at MISSILE_FPS so energy shots shimmer without per-frame gradients.
 */
import { cached, blit, dirToScreen, mix, parseColor } from './draw_util.js';
import {
  inked, litLinear, litRadial, sphere, capsule, fillPts, light, dark, rgba, hiFor, rivet, luma,
} from './draw_volume.js';

const DEFAULT_SIZE = 24;
const PAD = 3;
const DEFAULT_COLOR = '#cfc9b8';
const DEFAULT_COLOR2 = '#6f5a3a';
const TAU = Math.PI * 2;
const MISSILE_SIZE = 6;
const MISSILE_PHASES = 4;
const MISSILE_FPS = 14;
const SQ = Math.SQRT1_2;

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
    const u = size / DEFAULT_SIZE;
    c.scale(u, u);
    const fn = GLYPHS[glyph] || GLYPHS.generic;
    inked(c, (g) => {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      fn(g, color, color2);
    }, { outlineW: size >= 40 ? 0.75 : 0.95, rimAlpha: 0.35 });
  });
  blit(ctx, entry, Math.round(sx), Math.round(sy));
}

// ---------- small helpers (glyph units) ----------

/** Four-point sparkle. */
function glint(c, x, y, r, a = 0.9) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = `rgba(255,255,255,${a})`;
  c.beginPath();
  c.moveTo(x, y - r); c.lineTo(x + r * 0.22, y - r * 0.22); c.lineTo(x + r, y);
  c.lineTo(x + r * 0.22, y + r * 0.22); c.lineTo(x, y + r); c.lineTo(x - r * 0.22, y + r * 0.22);
  c.lineTo(x - r, y); c.lineTo(x - r * 0.22, y - r * 0.22);
  c.closePath();
  c.fill();
  c.restore();
}

/** Soft additive halo (for gems, orbs, glowing tips). */
function halo(c, x, y, r, color, a = 0.55) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  c.restore();
}

/** A colour reads as "emissive" when it's bright and saturated (neon trim, runes, potions). */
function emissive(color) {
  const v = luma(color);
  const [r, g, b] = parseColor(color);
  const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  return v > 0.38 && sat > 0.35;
}

/** Bevelled straight blade from base (bx,by) to tip (tx,ty), half width w; lit half/shadow half + fuller. */
function bladeShape(c, bx, by, tx, ty, w, color, taper = 0.78) {
  const dx = tx - bx; const dy = ty - by;
  const len = Math.hypot(dx, dy);
  const ux = dx / len; const uy = dy / len;
  const nx = -uy; const ny = ux; // left normal; for an up-right blade this points up-left (lit)
  const sx = bx + dx * taper; const sy = by + dy * taper;
  const L = [[bx + nx * w, by + ny * w], [sx + nx * w * 0.92, sy + ny * w * 0.92], [tx, ty], [bx, by]];
  const R = [[bx, by], [tx, ty], [sx - nx * w * 0.92, sy - ny * w * 0.92], [bx - nx * w, by - ny * w]];
  c.fillStyle = litLinear(c, bx, by, tx, ty, light(color, 0.18), 0.45, 0.25);
  fillPts(c, L);
  c.fillStyle = litLinear(c, bx, by, tx, ty, dark(color, 0.62), 0.25, 0.35);
  fillPts(c, R);
  // edge highlight on the lit side
  c.strokeStyle = rgba(light(color, 0.7), 0.85);
  c.lineWidth = 0.55;
  c.beginPath();
  c.moveTo(bx + nx * w, by + ny * w); c.lineTo(sx + nx * w * 0.92, sy + ny * w * 0.92); c.lineTo(tx, ty);
  c.stroke();
  // fuller
  c.strokeStyle = rgba(dark(color, 0.45), 0.6);
  c.lineWidth = 0.5;
  c.beginPath();
  c.moveTo(bx + ux * 1.2, by + uy * 1.2); c.lineTo(bx + dx * 0.62, by + dy * 0.62);
  c.stroke();
}

/** Wrapped grip: a capsule with diagonal wrap marks. */
function grip(c, x0, y0, x1, y1, r, color) {
  capsule(c, x0, y0, x1, y1, r, r, color, 0.3, 0.55);
  const n = 4;
  c.strokeStyle = rgba(dark(color, 0.35), 0.8);
  c.lineWidth = 0.45;
  const dx = x1 - x0; const dy = y1 - y0; const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; const ny = dx / len;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const px = x0 + dx * t; const py = y0 + dy * t;
    c.beginPath();
    c.moveTo(px + nx * r - dx / len * 0.6, py + ny * r - dy / len * 0.6);
    c.lineTo(px - nx * r + dx / len * 0.6, py - ny * r + dy / len * 0.6);
    c.stroke();
  }
}

function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------- glyphs ----------

const GLYPHS = {
  blade(c, color, color2) {
    bladeShape(c, -2.6, 2.6, 9.2, -9.2, 2.3, color);
    grip(c, -3.4, 3.4, -7.2, 7.2, 1.15, dark(color2, 0.55));
    capsule(c, -5.5, -0.3, 0.3, 5.5, 1.1, 1.1, color2, 0.45, 0.5); // cross-guard
    sphere(c, -8.1, 8.1, 1.7, color2, 0.6, 0.45);
    glint(c, 6.4, -6.6, 2.6, 0.75);
  },
  axe(c, color, color2) {
    capsule(c, -7.5, 9.5, 5.5, -7.8, 1.15, 1.0, color2, 0.35, 0.55);
    // head: crescent perpendicular to the haft
    const ux = 0.6; const uy = -0.8; const nx = 0.8; const ny = 0.6;
    const px = 2.8; const py = -4.2;
    const s0 = [px - ux * 2.4, py - uy * 2.4];
    const s1 = [px + ux * 2.4, py + uy * 2.4];
    const e0 = [px + nx * 7 - ux * 7, py + ny * 7 - uy * 7];
    const e1 = [px + nx * 7 + ux * 6.5, py + ny * 7 + uy * 6.5];
    const ctl = [px + nx * 10.5, py + ny * 10.5];
    c.fillStyle = litLinear(c, px - 2, py - 7, px + 8, py + 6, color, 0.4, 0.5);
    c.beginPath();
    c.moveTo(s0[0], s0[1]);
    c.quadraticCurveTo(px + nx * 3.5 - ux * 2, py + ny * 3.5 - uy * 2, e0[0], e0[1]);
    c.quadraticCurveTo(ctl[0], ctl[1], e1[0], e1[1]);
    c.quadraticCurveTo(px + nx * 3.5 + ux * 2, py + ny * 3.5 + uy * 2, s1[0], s1[1]);
    c.closePath();
    c.fill();
    c.strokeStyle = rgba(light(color, 0.75), 0.9);
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(e0[0], e0[1]);
    c.quadraticCurveTo(ctl[0], ctl[1], e1[0], e1[1]);
    c.stroke();
    // back spike + socket
    c.fillStyle = dark(color, 0.6);
    fillPts(c, [[px - ux * 1.6, py - uy * 1.6], [px - nx * 4.2, py - ny * 4.2], [px + ux * 1.6, py + uy * 1.6]]);
    capsule(c, px - ux * 2.6, py - uy * 2.6, px + ux * 2.6, py + uy * 2.6, 1.6, 1.6, dark(color, 0.75), 0.35, 0.5);
    rivet(c, px, py, 0.7, color2);
    glint(c, e0[0] + 1.5, e0[1] - 0.5, 2, 0.6);
  },
  mace(c, color, color2) {
    grip(c, -8, 9, -4.5, 5.5, 1.2, dark(color2, 0.6));
    capsule(c, -4.5, 5.5, 3, -2, 1.05, 1.05, color2, 0.35, 0.55);
    sphere(c, -8.6, 9.6, 1.5, color, 0.5, 0.5);
    const hx = 4.6; const hy = -3.6;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.3;
      const ox = Math.cos(a); const oy = Math.sin(a);
      c.fillStyle = oy < 0.2 ? light(color, 0.15) : dark(color, 0.6);
      fillPts(c, [[hx + ox * 3.2 - oy * 1.5, hy + oy * 3.2 + ox * 1.5], [hx + ox * 6.6, hy + oy * 6.6], [hx + ox * 3.2 + oy * 1.5, hy + oy * 3.2 - ox * 1.5]]);
    }
    sphere(c, hx, hy, 4.1, color, 0.55, 0.5);
    c.strokeStyle = rgba(dark(color, 0.5), 0.7);
    c.lineWidth = 0.5;
    c.beginPath(); c.arc(hx, hy, 2.6, 0.2, Math.PI * 1.3); c.stroke();
    glint(c, hx - 1.6, hy - 1.8, 1.8, 0.7);
  },
  bow(c, color, color2) {
    // string
    c.strokeStyle = rgba(light(color2, 0.25), 0.95);
    c.lineWidth = 0.55;
    c.beginPath(); c.moveTo(3.2, -10.2); c.lineTo(3.2, 10.2); c.stroke();
    // limbs: recurve, thick in the middle
    const limb = (sgn) => {
      c.beginPath();
      c.moveTo(-3.8, 0);
      c.bezierCurveTo(-4.2, sgn * 6, -0.5, sgn * 9.2, 3.2, sgn * 10.2);
      c.bezierCurveTo(2.0, sgn * 11.4, 0.6, sgn * 10.8, 0.4, sgn * 10.4);
      c.bezierCurveTo(-1.8, sgn * 8.8, -2.2, sgn * 5.2, -1.6, 0);
      c.closePath();
      c.fill();
    };
    c.fillStyle = litLinear(c, -5, 0, 3, 0, color, 0.45, 0.5);
    limb(-1); limb(1);
    // grip
    capsule(c, -3.2, -2.4, -3.2, 2.4, 1.6, 1.6, dark(color2, 0.55), 0.3, 0.5);
    rivet(c, 3.2, -10.2, 0.55, color2);
    rivet(c, 3.2, 10.2, 0.55, color2);
    // nocked arrow
    c.strokeStyle = light(color, 0.35);
    c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(3.2, 0); c.lineTo(-8.6, 0); c.stroke();
    c.fillStyle = light(color2, 0.35);
    fillPts(c, [[-10.6, 0], [-8, -1.3], [-8, 1.3]]);
  },
  gun(c, color, color2) {
    // grip (angled), behind the frame
    c.fillStyle = litLinear(c, -9, 0, -2, 8, dark(color, 0.85), 0.25, 0.5);
    fillPts(c, [[-8.6, -0.6], [-3.4, -0.6], [-4.6, 8.6], [-9.8, 8.2]]);
    c.strokeStyle = rgba(light(color, 0.35), 0.5);
    c.lineWidth = 0.4;
    for (let i = 0; i < 3; i++) {
      c.beginPath(); c.moveTo(-8.4 + i * 0.1, 2 + i * 2); c.lineTo(-4.4 - i * 0.15, 2 + i * 2); c.stroke();
    }
    // trigger guard
    c.strokeStyle = dark(color, 0.7);
    c.lineWidth = 0.8;
    c.beginPath(); c.arc(-1.4, 0.6, 2.2, 0, Math.PI); c.stroke();
    // frame + slide
    c.fillStyle = litLinear(c, 0, -6, 0, 1.5, dark(color, 0.8), 0.25, 0.5);
    fillPts(c, [[-9.6, -1.6], [8.6, -1.6], [8.6, 0.8], [-9.4, 0.8]]);
    c.fillStyle = litLinear(c, 0, -6.4, 0, -1.4, color, 0.5, 0.45);
    roundRectPath(c, -10.4, -6.2, 21.2, 4.8, 1.1);
    c.fill();
    // barrel tip + sights
    c.fillStyle = dark(color, 0.45);
    c.fillRect(10.4, -5.2, 1.2, 2.8);
    c.fillRect(8.4, -7.0, 1.2, 0.9);
    c.fillRect(-9.4, -7.0, 1.6, 0.9);
    // slide serrations
    c.strokeStyle = rgba(dark(color, 0.4), 0.8);
    c.lineWidth = 0.4;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-8.6 + i * 1.1, -5.6); c.lineTo(-8.6 + i * 1.1, -2.2); c.stroke(); }
    // accent strip
    c.fillStyle = color2;
    c.fillRect(-4, -3.6, 13, 0.9);
    if (emissive(color2)) halo(c, 2.5, -3.2, 6, color2, 0.35);
    c.fillStyle = rgba(light(color, 0.8), 0.7);
    c.fillRect(-9.6, -5.8, 19.4, 0.55);
  },
  staff(c, color, color2) {
    capsule(c, -8.6, 10.2, 5.2, -5.2, 1.0, 1.15, color, 0.35, 0.55);
    for (const t of [0.22, 0.5]) {
      const x = -8.6 + 13.8 * t; const y = 10.2 - 15.4 * t;
      capsule(c, x - 0.8, y + 0.9, x + 0.8, y - 0.9, 1.45, 1.45, dark(color2, 0.7), 0.4, 0.5);
    }
    const hx = 7.2; const hy = -7.4;
    if (emissive(color2)) halo(c, hx, hy, 8, color2, 0.6);
    // prongs cradling the orb
    c.strokeStyle = dark(color, 0.85);
    c.lineWidth = 1.0;
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(5.2, -5.2);
      c.quadraticCurveTo(hx + s * 4.6 - 1.6, hy + s * 1.2 + 3.4, hx + s * 2.4 - 0.4, hy - s * 0.2 - 3.6);
      c.stroke();
    }
    sphere(c, hx, hy, 3.4, color2, 0.7, 0.35);
    glint(c, hx - 1.2, hy - 1.4, 1.8, 0.8);
  },
  wand(c, color, color2) {
    grip(c, -7.2, 7.6, -4.2, 4.6, 1.1, dark(color, 0.6));
    capsule(c, -4.2, 4.6, 2.6, -2.2, 0.95, 0.75, color, 0.4, 0.5);
    capsule(c, -4.6, 5.0, -3.6, 4.0, 1.5, 1.5, color2, 0.4, 0.5);
    if (emissive(color2)) halo(c, 5.2, -5.2, 7, color2, 0.6);
    // crystal tip
    const T = [[2.2, -1.6], [3.6, -5.4], [7.8, -8.6], [5.4, -3.8]];
    c.fillStyle = light(color2, 0.25);
    fillPts(c, [T[0], T[1], T[2]]);
    c.fillStyle = dark(color2, 0.7);
    fillPts(c, [T[0], T[2], T[3]]);
    glint(c, 6.4, -7.2, 2.4, 0.85);
  },
  shield(c, color, color2) {
    const path = () => {
      c.beginPath();
      c.moveTo(-8.6, -9.4);
      c.quadraticCurveTo(0, -11.2, 8.6, -9.4);
      c.lineTo(8.6, -1.5);
      c.quadraticCurveTo(8.0, 6.0, 0, 10.6);
      c.quadraticCurveTo(-8.0, 6.0, -8.6, -1.5);
      c.closePath();
    };
    c.fillStyle = litLinear(c, -9, -10, 9, 10, color2, 0.4, 0.5);
    path(); c.fill();
    c.save();
    c.translate(0, 0.4);
    c.scale(0.8, 0.8);
    c.fillStyle = litLinear(c, -9, -10, 9, 10, color, 0.45, 0.5);
    path(); c.fill();
    c.restore();
    // field division + boss
    c.fillStyle = rgba(dark(color2, 0.85), 0.85);
    fillPts(c, [[-1.0, -8.4], [1.0, -8.4], [1.0, 8.4], [-1.0, 8.4]]);
    sphere(c, 0, -1.2, 2.5, color2, 0.6, 0.45);
    for (const [x, y] of [[-6.6, -7.8], [6.6, -7.8], [-6.2, 0.8], [6.2, 0.8], [0, 8.4]]) rivet(c, x, y, 0.65, light(color2, 0.2));
  },
  helm(c, color, color2) {
    const shell = () => {
      c.beginPath();
      c.moveTo(-8.2, 7.6);
      c.lineTo(-8.4, -0.6);
      c.bezierCurveTo(-8.4, -6.4, -4.6, -9.6, 0, -9.6);
      c.bezierCurveTo(4.6, -9.6, 8.4, -6.4, 8.4, -0.6);
      c.lineTo(8.2, 7.6);
      c.lineTo(4.4, 8.6);
      c.lineTo(3.0, 3.4);
      c.lineTo(-3.0, 3.4);
      c.lineTo(-4.4, 8.6);
      c.closePath();
    };
    c.fillStyle = litRadial(c, 0, -1.5, 10.5, color, 0.55, 0.55);
    shell(); c.fill();
    // brow band
    c.fillStyle = litLinear(c, -8, -2, 8, 1, dark(color, 0.8), 0.35, 0.4);
    fillPts(c, [[-8.4, -2.4], [8.4, -2.4], [8.3, 0.4], [-8.3, 0.4]]);
    for (const x of [-6.4, -3.2, 3.2, 6.4]) rivet(c, x, -1.0, 0.55, light(color, 0.15));
    // visor slit
    c.fillStyle = color2;
    fillPts(c, [[-6.6, 1.0], [6.6, 1.0], [6.0, 2.6], [-6.0, 2.6]]);
    if (emissive(color2)) halo(c, 0, 1.8, 7, color2, 0.5);
    // crest ridge
    c.strokeStyle = rgba(light(color, 0.6), 0.8);
    c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(0, -9.4); c.lineTo(0, -2.6); c.stroke();
    glint(c, -4.2, -6.2, 2.0, 0.6);
  },
  chest(c, color, color2) {
    const torso = [[-6.8, -8.2], [-2.8, -9.4], [0, -6.6], [2.8, -9.4], [6.8, -8.2], [7.4, -1.6], [6.6, 9.4], [-6.6, 9.4], [-7.4, -1.6]];
    c.fillStyle = litLinear(c, -8, -9, 8, 10, color, 0.45, 0.5);
    fillPts(c, torso);
    // pectoral plates
    c.strokeStyle = rgba(dark(color, 0.5), 0.75);
    c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(-5.8, -1.2); c.quadraticCurveTo(-2.4, 1.0, 0, -0.6); c.quadraticCurveTo(2.4, 1.0, 5.8, -1.2); c.stroke();
    c.beginPath(); c.moveTo(-5.2, 3.0); c.lineTo(5.2, 3.0); c.stroke();
    // centre seam / trim
    c.fillStyle = color2;
    fillPts(c, [[-0.7, -6.2], [0.7, -6.2], [0.7, 6.0], [-0.7, 6.0]]);
    // belt
    c.fillStyle = litLinear(c, -7, 5.6, 7, 8.2, dark(color2, 0.65), 0.35, 0.4);
    fillPts(c, [[-6.8, 5.8], [6.8, 5.8], [6.7, 7.8], [-6.7, 7.8]]);
    c.fillStyle = light(color2, 0.15);
    c.fillRect(-1.2, 5.5, 2.4, 2.6);
    // pauldrons
    for (const s of [-1, 1]) {
      c.fillStyle = litRadial(c, s * 8.0, -6.6, 4.2, light(color, 0.06), 0.55, 0.5);
      c.beginPath(); c.ellipse(s * 8.0, -6.4, 3.8, 3.2, s * 0.35, Math.PI, 0); c.lineTo(s * 8.0 + 3.8, -4.6); c.lineTo(s * 8.0 - 3.8, -4.6); c.closePath(); c.fill();
      c.strokeStyle = color2; c.lineWidth = 0.6;
      c.beginPath(); c.ellipse(s * 8.0, -5.0, 3.5, 1.0, 0, 0, Math.PI); c.stroke();
    }
    if (emissive(color2)) halo(c, 0, -1, 7, color2, 0.25);
  },
  boots(c, color, color2) {
    const boot = (ox, oy, col) => {
      c.fillStyle = litLinear(c, ox - 6, oy - 9, ox + 6, oy + 8, col, 0.4, 0.5);
      c.beginPath();
      c.moveTo(ox - 5.2, oy - 9);
      c.lineTo(ox + 0.8, oy - 9);
      c.lineTo(ox + 1.2, oy + 1.8);
      c.quadraticCurveTo(ox + 6.8, oy + 2.6, ox + 7.2, oy + 6.2);
      c.lineTo(ox + 7.2, oy + 7.6);
      c.lineTo(ox - 5.4, oy + 7.6);
      c.closePath();
      c.fill();
      c.fillStyle = dark(color2, 0.5);
      fillPts(c, [[ox - 5.6, oy + 6.4], [ox + 7.4, oy + 6.4], [ox + 7.4, oy + 8.4], [ox - 5.6, oy + 8.4]]);
      c.fillStyle = litLinear(c, ox - 6, oy - 10, ox + 1, oy - 7, color2, 0.45, 0.4);
      fillPts(c, [[ox - 5.8, oy - 10.2], [ox + 1.4, oy - 10.2], [ox + 1.2, oy - 7.4], [ox - 5.6, oy - 7.4]]);
      c.strokeStyle = rgba(dark(col, 0.5), 0.7); c.lineWidth = 0.5;
      c.beginPath(); c.moveTo(ox - 5.0, oy - 2.4); c.lineTo(ox + 1.0, oy - 2.4); c.stroke();
    };
    boot(-0.6, -1.2, dark(color, 0.72));
    boot(-3.0, 1.6, color);
  },
  gloves(c, color, color2) {
    // cuff
    c.fillStyle = litLinear(c, -6, 4, 6, 10, color2, 0.4, 0.45);
    roundRectPath(c, -5.6, 3.6, 10.4, 6.6, 1.4); c.fill();
    // palm
    c.fillStyle = litLinear(c, -6, -4, 6, 5, color, 0.45, 0.5);
    roundRectPath(c, -5.0, -3.2, 9.4, 8.0, 2.4); c.fill();
    // fingers
    const fx = [-3.8, -1.4, 1.0, 3.2];
    const fl = [5.0, 6.4, 6.0, 4.6];
    for (let i = 0; i < 4; i++) capsule(c, fx[i], -2.2, fx[i] + 0.1 * i, -2.2 - fl[i], 1.15, 1.0, color, 0.45, 0.45);
    capsule(c, -4.6, 1.6, -8.4, -2.0, 1.3, 1.1, color, 0.45, 0.5);
    // knuckle plate
    c.fillStyle = litLinear(c, -5, -3.8, 5, -1, light(color, 0.1), 0.5, 0.45);
    fillPts(c, [[-5.0, -3.4], [4.6, -3.4], [4.2, -1.2], [-4.6, -1.2]]);
    for (const x of fx) rivet(c, x, -2.3, 0.45, light(color2, 0.1));
  },
  belt(c, color, color2) {
    c.strokeStyle = dark(color, 0.6);
    c.lineWidth = 4.4;
    c.beginPath(); c.ellipse(0, -1.2, 10.0, 5.4, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
    c.strokeStyle = litLinear(c, -10, 0, 10, 6, color, 0.45, 0.5);
    c.beginPath(); c.ellipse(0, -1.2, 10.0, 5.4, 0, -0.05, Math.PI + 0.05); c.stroke();
    // stitching
    c.strokeStyle = rgba(light(color, 0.5), 0.6);
    c.lineWidth = 0.35;
    c.setLineDash([0.8, 0.8]);
    c.beginPath(); c.ellipse(0, -1.2, 10.0, 5.4, 0, 0.1, Math.PI - 0.1); c.stroke();
    c.setLineDash([]);
    // pouch
    c.fillStyle = litLinear(c, 3, 1, 9, 9, dark(color, 0.85), 0.35, 0.5);
    roundRectPath(c, 3.6, 2.2, 5.2, 5.6, 1.2); c.fill();
    c.fillStyle = dark(color, 0.6); c.fillRect(3.6, 2.2, 5.2, 1.6);
    // buckle
    c.strokeStyle = litLinear(c, -3, 1, 3, 7, color2, 0.6, 0.45);
    c.lineWidth = 1.3;
    roundRectPath(c, -2.8, 1.6, 5.6, 5.2, 0.8); c.stroke();
    c.strokeStyle = light(color2, 0.3); c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(0, 2.2); c.lineTo(0, 6.2); c.stroke();
  },
  ring(c, color, color2) {
    // band: back half dark, front half lit
    c.lineWidth = 2.4;
    c.strokeStyle = dark(color, 0.5);
    c.beginPath(); c.ellipse(0, 2.6, 6.4, 4.8, 0, Math.PI, TAU); c.stroke();
    c.strokeStyle = litLinear(c, -7, 0, 7, 8, color, 0.6, 0.5);
    c.beginPath(); c.ellipse(0, 2.6, 6.4, 4.8, 0, 0, Math.PI); c.stroke();
    c.strokeStyle = rgba(light(color, 0.8), 0.8);
    c.lineWidth = 0.6;
    c.beginPath(); c.ellipse(0, 2.6, 7.0, 5.4, 0, Math.PI * 0.55, Math.PI * 0.95); c.stroke();
    // setting + gem
    capsule(c, -2.8, -2.6, 2.8, -2.6, 1.6, 1.6, dark(color, 0.85), 0.5, 0.5);
    if (emissive(color2)) halo(c, 0, -5.2, 6.5, color2, 0.55);
    gem(c, 0, -5.4, 3.4, color2);
  },
  amulet(c, color, color2) {
    // chain links
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (0.85 + 1.3 * (i / 12));
      const x = Math.cos(a) * 7.6; const y = -2.6 + Math.sin(a) * 7.4;
      c.fillStyle = i % 2 ? dark(color, 0.6) : light(color, 0.2);
      c.beginPath(); c.ellipse(x, y, 0.95, 0.7, a, 0, TAU); c.fill();
    }
    // pendant setting
    c.fillStyle = litLinear(c, -5, 1, 5, 10, color, 0.55, 0.5);
    fillPts(c, [[0, 0.4], [4.6, 4.8], [0, 10.6], [-4.6, 4.8]]);
    capsule(c, -0.9, -0.4, 0.9, -0.4, 1.0, 1.0, color, 0.5, 0.5);
    if (emissive(color2)) halo(c, 0, 5.2, 7, color2, 0.55);
    gem(c, 0, 5.2, 2.9, color2);
  },
  flask(c, color, color2) {
    const bx = 0; const by = 3.0; const r = 7.0;
    // liquid inside the round body
    c.save();
    c.beginPath(); c.arc(bx, by, r - 0.6, 0, TAU); c.clip();
    c.fillStyle = litRadial(c, bx, by + 1, r, color2, 0.35, 0.45);
    c.fillRect(-r, by - 1.2, r * 2, r * 2);
    c.fillStyle = rgba(light(color2, 0.5), 0.9);
    c.beginPath(); c.ellipse(bx, by - 1.2, r - 0.8, 1.3, 0, 0, TAU); c.fill();
    c.restore();
    // glass
    c.fillStyle = rgba(color, 0.22);
    c.beginPath(); c.arc(bx, by, r, 0, TAU); c.fill();
    c.fillStyle = rgba(color, 0.3);
    c.fillRect(-2.2, -6.6, 4.4, 4.4);
    c.strokeStyle = rgba(light(color, 0.4), 0.85);
    c.lineWidth = 0.7;
    c.beginPath(); c.arc(bx, by, r, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(-2.2, -2.4); c.lineTo(-2.2, -6.6); c.moveTo(2.2, -2.4); c.lineTo(2.2, -6.6); c.stroke();
    // stopper + lip
    capsule(c, -2.8, -6.8, 2.8, -6.8, 0.8, 0.8, light(color, 0.1), 0.5, 0.5);
    c.fillStyle = litLinear(c, -2, -11, 2, -7, dark(color2, 0.45), 0.4, 0.4);
    roundRectPath(c, -1.8, -10.8, 3.6, 3.8, 0.8); c.fill();
    // glass highlights
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 1.0;
    c.beginPath(); c.arc(bx, by, r - 2.0, Math.PI * 1.1, Math.PI * 1.45); c.stroke();
    glint(c, -3.4, 0.4, 1.4, 0.8);
    if (emissive(color2)) halo(c, bx, by + 1, 9, color2, 0.3);
  },
  scroll(c, color, color2) {
    c.fillStyle = litLinear(c, -7, -8, 7, 8, color, 0.35, 0.35);
    fillPts(c, [[-6.6, -7.2], [6.6, -7.2], [6.6, 7.2], [-6.6, 7.2]]);
    // text lines
    c.strokeStyle = rgba(mix(color2, dark(color, 0.3), 0.35), 0.85);
    c.lineWidth = 0.6;
    for (let i = 0; i < 4; i++) {
      const y = -4.2 + i * 2.2;
      c.beginPath(); c.moveTo(-4.6, y); c.lineTo(i === 3 ? 1.4 : 4.6, y); c.stroke();
    }
    // rolled ends
    capsule(c, -8.4, -8.2, 8.4, -8.2, 1.7, 1.7, light(color, 0.06), 0.45, 0.5);
    capsule(c, -8.4, 8.2, 8.4, 8.2, 1.7, 1.7, dark(color, 0.85), 0.4, 0.5);
    // seal
    if (emissive(color2)) halo(c, 4.0, 5.4, 5.5, color2, 0.5);
    sphere(c, 4.0, 5.4, 2.0, color2, 0.55, 0.5);
  },
  book(c, color, color2) {
    const pages = light(color, 0.78);
    // page block (visible right / bottom edge)
    c.fillStyle = litLinear(c, -6, -8, 9, 10, pages, 0.2, 0.25);
    fillPts(c, [[-6.0, -8.6], [8.6, -8.6], [9.4, -7.6], [9.4, 9.6], [-5.2, 9.6], [-6.0, 8.6]]);
    c.strokeStyle = rgba(dark(pages, 0.6), 0.6);
    c.lineWidth = 0.3;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(8.8 + i * 0.2, -7.6); c.lineTo(8.8 + i * 0.2, 9.2); c.stroke(); }
    // cover
    c.fillStyle = litLinear(c, -8, -9, 8, 9, color, 0.45, 0.5);
    fillPts(c, [[-7.6, -9.4], [8.0, -9.4], [8.0, 8.4], [-7.6, 8.4]]);
    // spine
    c.fillStyle = litLinear(c, -9, 0, -5, 0, dark(color, 0.75), 0.4, 0.4);
    fillPts(c, [[-8.8, -9.0], [-5.6, -9.4], [-5.6, 8.4], [-8.8, 8.8]]);
    // corners + emblem
    c.fillStyle = color2;
    for (const [x, y, sx, sy] of [[8.0, -9.4, -1, 1], [8.0, 8.4, -1, -1]]) fillPts(c, [[x, y], [x + sx * 3.2, y], [x, y + sy * 3.2]]);
    if (emissive(color2)) halo(c, 1.2, -0.5, 6, color2, 0.45);
    c.strokeStyle = color2;
    c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(1.2, -4.4); c.lineTo(4.4, -0.5); c.lineTo(1.2, 3.4); c.lineTo(-2.0, -0.5); c.closePath(); c.stroke();
    sphere(c, 1.2, -0.5, 1.0, color2, 0.6, 0.4);
  },
  gem(c, color) {
    if (emissive(color)) halo(c, 0, 0, 11, color, 0.4);
    gem(c, 0, 0.6, 8.6, color);
  },
  key(c, color, color2) {
    // bow
    c.lineWidth = 2.0;
    c.strokeStyle = litLinear(c, -10, -9, -2, -1, color, 0.55, 0.5);
    c.beginPath(); c.arc(-5.2, -4.6, 3.6, 0, TAU); c.stroke();
    sphere(c, -5.2, -4.6, 1.4, color2, 0.6, 0.45);
    // shaft
    capsule(c, -2.6, -2.0, 8.0, 8.6, 1.05, 1.05, color, 0.45, 0.5);
    // bit
    c.fillStyle = litLinear(c, 3, 3, 9, 9, color, 0.4, 0.5);
    fillPts(c, [[4.6, 5.2], [7.8, 2.0], [9.2, 3.4], [8.0, 4.6], [9.0, 5.6], [6.0, 8.6]]);
    capsule(c, -1.0, -0.4, 0.4, -1.8, 1.5, 1.5, dark(color, 0.75), 0.4, 0.5);
    glint(c, -7.6, -7.0, 1.6, 0.6);
  },
  coin(c, color) {
    const rim = dark(color, 0.55);
    // edge (thickness) then face
    c.fillStyle = rim;
    c.beginPath(); c.ellipse(0.6, 1.1, 8.2, 8.2, 0, 0, TAU); c.fill();
    c.fillStyle = litRadial(c, 0, 0, 8.2, color, 0.65, 0.45);
    c.beginPath(); c.arc(0, 0, 8.0, 0, TAU); c.fill();
    c.strokeStyle = rgba(dark(color, 0.6), 0.85);
    c.lineWidth = 0.7;
    c.beginPath(); c.arc(0, 0, 6.2, 0, TAU); c.stroke();
    c.strokeStyle = rgba(light(color, 0.6), 0.8);
    c.beginPath(); c.arc(0, 0, 6.2, Math.PI * 0.95, Math.PI * 1.55); c.stroke();
    // embossed mark
    c.fillStyle = dark(color, 0.65);
    fillPts(c, [[0, -3.4], [3.0, 0], [0, 3.4], [-3.0, 0]]);
    c.fillStyle = light(color, 0.3);
    fillPts(c, [[0, -3.4], [3.0, 0], [0, 0], [-3.0, 0]]);
    glint(c, -3.6, -4.0, 2.0, 0.75);
  },
  generic(c, color, color2) {
    c.fillStyle = litLinear(c, -8, -8, 8, 8, color, 0.45, 0.5);
    roundRectPath(c, -7.6, -7.6, 15.2, 15.2, 1.6); c.fill();
    c.fillStyle = litLinear(c, -8, -8, 8, 8, color2, 0.45, 0.5);
    fillPts(c, [[-7.6, -4.6], [7.6, -4.6], [7.6, -2.6], [-7.6, -2.6]]);
    fillPts(c, [[-7.6, 2.6], [7.6, 2.6], [7.6, 4.6], [-7.6, 4.6]]);
    for (const [x, y] of [[-5.6, -3.6], [5.6, -3.6], [-5.6, 3.6], [5.6, 3.6]]) rivet(c, x, y, 0.6, light(color2, 0.2));
    c.strokeStyle = rgba(dark(color, 0.5), 0.6);
    c.lineWidth = 0.5;
    c.beginPath(); c.moveTo(-7, -1); c.lineTo(7, -1); c.moveTo(-7, 1); c.lineTo(7, 1); c.stroke();
  },
};

/** Faceted cut gem of radius r: table, crown facets lit from the upper-left, dark pavilion. */
function gem(c, x, y, r, color) {
  const top = y - r * 0.55;
  const girdle = y - r * 0.05;
  const P = [[x - r, girdle], [x - r * 0.55, top], [x + r * 0.55, top], [x + r, girdle], [x, y + r]];
  c.fillStyle = dark(color, 0.55);
  fillPts(c, P);
  // pavilion facets
  c.fillStyle = dark(color, 0.8);
  fillPts(c, [[x - r, girdle], [x, girdle], [x, y + r]]);
  c.fillStyle = color;
  fillPts(c, [[x - r * 0.4, girdle], [x + r * 0.15, girdle], [x, y + r]]);
  // crown
  c.fillStyle = light(color, hiFor(color, 0.5));
  fillPts(c, [[x - r, girdle], [x - r * 0.55, top], [x - r * 0.2, girdle]]);
  c.fillStyle = light(color, hiFor(color, 0.25));
  fillPts(c, [[x - r * 0.55, top], [x + r * 0.55, top], [x + r * 0.3, girdle], [x - r * 0.2, girdle]]);
  c.fillStyle = color;
  fillPts(c, [[x + r * 0.55, top], [x + r, girdle], [x + r * 0.3, girdle]]);
  c.strokeStyle = rgba(light(color, 0.7), 0.7);
  c.lineWidth = Math.max(0.3, r * 0.06);
  c.beginPath(); c.moveTo(x - r, girdle); c.lineTo(x + r, girdle); c.stroke();
  glint(c, x - r * 0.35, top + r * 0.12, r * 0.55, 0.85);
}

// ---------- missiles ----------

/**
 * Draw a missile. look: { shape:'bolt'|'arrow'|'orb'|'shard'|'ring'|'flame', color, size, glyph? }
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx
 * @param {number} sy
 * @param {{shape?:string,color?:string,size?:number,glyph?:string}} look
 * @param {number} dir 0..7 travel direction
 */
export function drawMissile(ctx, sx, sy, look = {}, dir = 0) {
  const color = look.color || DEFAULT_COLOR;
  const size = Math.max(2, Math.min(24, Math.round(look.size || MISSILE_SIZE)));
  let shape = look.shape || 'bolt';
  if (look.glyph === 'flame' && (shape === 'orb' || shape === 'bolt')) shape = 'flame';
  if (!MISSILES[shape]) shape = 'bolt';
  const d = shape === 'ring' ? 0 : ((dir % 8) + 8) % 8; // rings lie flat on the ground
  const still = shape === 'arrow' || shape === 'shard';
  const ph = still ? 0 : Math.floor(nowSec() * MISSILE_FPS) % MISSILE_PHASES;
  const box = size * 9 + 8;
  const key = `m|${shape}|${color}|${size}|${d}|${ph}`;
  const entry = cached(key, box, box, box / 2, box / 2, (c) => {
    if (shape !== 'ring') {
      const v = dirToScreen(d);
      c.rotate(Math.atan2(v.y, v.x));
    }
    MISSILES[shape](c, size, color, ph);
  });
  blit(ctx, entry, Math.round(sx), Math.round(sy));
}

function nowSec() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/** Additive radial blob. */
function glowBlob(c, x, y, r, color, a) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(light(color, 0.6), a));
  g.addColorStop(0.35, rgba(color, a * 0.7));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

/** Tapered streak from (x0,0) (thin, transparent) to (x1,0) (wide, opaque). */
function streak(c, x0, x1, w, color, a) {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(1, rgba(color, a));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x0, 0);
  c.quadraticCurveTo((x0 + x1) / 2, -w * 0.7, x1, -w);
  c.arc(x1, 0, w, -Math.PI / 2, Math.PI / 2);
  c.quadraticCurveTo((x0 + x1) / 2, w * 0.7, x0, 0);
  c.closePath();
  c.fill();
}

const MISSILES = {
  bolt(c, s, color, ph) {
    c.globalCompositeOperation = 'lighter';
    glowBlob(c, 0, 0, s * 2.6, color, 0.45);
    streak(c, -s * 4.2, 0, s * 0.75, color, 0.75);
    streak(c, -s * 2.6, s * 0.3, s * 0.32, light(color, 0.7), 0.9);
    c.fillStyle = rgba(light(color, 0.85), 1);
    c.beginPath(); c.ellipse(s * 0.2, 0, s * 0.85, s * 0.42, 0, 0, TAU); c.fill();
    // crackle
    c.strokeStyle = rgba(light(color, 0.5), 0.7);
    c.lineWidth = 0.7;
    c.beginPath();
    const j = [0.6, -0.5, 0.4, -0.7][ph];
    c.moveTo(-s * 3.4, s * 0.4 * j); c.lineTo(-s * 2.4, -s * 0.6 * j); c.lineTo(-s * 1.4, s * 0.5 * j); c.lineTo(-s * 0.4, -s * 0.2 * j);
    c.stroke();
  },
  flame(c, s, color, ph) {
    c.globalCompositeOperation = 'lighter';
    glowBlob(c, 0, 0, s * 2.8, color, 0.5);
    const k = 1 + 0.12 * [0, 1, 0.5, -0.5][ph];
    c.fillStyle = rgba(dark(color, 0.8), 0.75);
    c.beginPath();
    c.moveTo(-s * 4.4 * k, s * 0.2);
    c.quadraticCurveTo(-s * 1.8, -s * 1.6, s * 0.4, -s * 1.15);
    c.arc(s * 0.3, 0, s * 1.15, -Math.PI / 2, Math.PI / 2);
    c.quadraticCurveTo(-s * 1.8, s * 1.4, -s * 4.4 * k, s * 0.2);
    c.fill();
    c.fillStyle = rgba(light(color, 0.35), 0.85);
    c.beginPath();
    c.moveTo(-s * 2.8 * k, -s * 0.1);
    c.quadraticCurveTo(-s * 1.0, -s * 0.9, s * 0.4, -s * 0.7);
    c.arc(s * 0.4, 0, s * 0.7, -Math.PI / 2, Math.PI / 2);
    c.quadraticCurveTo(-s * 1.0, s * 0.8, -s * 2.8 * k, -s * 0.1);
    c.fill();
    c.fillStyle = 'rgba(255,250,235,0.95)';
    c.beginPath(); c.arc(s * 0.45, 0, s * 0.42, 0, TAU); c.fill();
    // embers
    c.fillStyle = rgba(light(color, 0.5), 0.8);
    for (let i = 0; i < 3; i++) {
      const t = (i + ph / MISSILE_PHASES) / 3;
      c.beginPath(); c.arc(-s * (1.6 + t * 3.2), Math.sin(i * 2.3 + ph) * s * 0.8, s * 0.18 * (1 - t * 0.5), 0, TAU); c.fill();
    }
  },
  orb(c, s, color, ph) {
    c.globalCompositeOperation = 'lighter';
    glowBlob(c, 0, 0, s * 2.4, color, 0.5);
    streak(c, -s * 3, -s * 0.2, s * 0.6, color, 0.35);
    c.globalCompositeOperation = 'source-over';
    const g = c.createRadialGradient(-s * 0.3, -s * 0.35, s * 0.1, 0, 0, s * 1.05);
    g.addColorStop(0, 'rgba(255,255,255,0.98)');
    g.addColorStop(0.45, rgba(light(color, 0.3), 0.95));
    g.addColorStop(1, rgba(color, 0.65));
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, s * 1.05, 0, TAU); c.fill();
    // swirl
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = rgba(light(color, 0.6), 0.8);
    c.lineWidth = Math.max(0.6, s * 0.16);
    const a0 = ph * (Math.PI / 2);
    c.beginPath(); c.arc(0, 0, s * 0.72, a0, a0 + 1.6); c.stroke();
    c.beginPath(); c.arc(0, 0, s * 0.72, a0 + Math.PI, a0 + Math.PI + 1.6); c.stroke();
  },
  shard(c, s, color) {
    c.globalCompositeOperation = 'lighter';
    glowBlob(c, 0, 0, s * 2.2, color, 0.35);
    streak(c, -s * 4, -s * 0.8, s * 0.45, color, 0.5);
    c.globalCompositeOperation = 'source-over';
    const P = [[s * 1.9, 0], [0, -s * 0.62], [-s * 1.5, 0], [0, s * 0.62]];
    c.fillStyle = light(color, 0.45);
    fillPts(c, [P[0], P[1], P[2]]);
    c.fillStyle = dark(color, 0.72);
    fillPts(c, [P[0], P[2], P[3]]);
    c.strokeStyle = rgba(light(color, 0.8), 0.9);
    c.lineWidth = 0.5;
    c.beginPath(); c.moveTo(P[2][0], 0); c.lineTo(P[0][0], 0); c.stroke();
    glint(c, s * 0.6, -s * 0.2, s * 0.7, 0.8);
  },
  ring(c, s, color, ph) {
    c.globalCompositeOperation = 'lighter';
    const rx = s * 2.1 * (1 + ph * 0.04); const ry = s * 1.05 * (1 + ph * 0.04);
    c.fillStyle = rgba(color, 0.12);
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.fill();
    c.strokeStyle = rgba(color, 0.45);
    c.lineWidth = s * 0.7;
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.stroke();
    c.strokeStyle = rgba(light(color, 0.7), 0.95);
    c.lineWidth = Math.max(0.8, s * 0.22);
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.stroke();
  },
  arrow(c, s, color) {
    const shaft = mix(color, '#d8d0c0', 0.5);
    c.globalCompositeOperation = 'lighter';
    streak(c, -s * 4.6, -s * 1.2, s * 0.3, color, 0.35);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = dark(shaft, 0.5);
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(-s * 2, 0); c.lineTo(s * 1.4, 0); c.stroke();
    c.strokeStyle = shaft;
    c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(-s * 2, -0.15); c.lineTo(s * 1.4, -0.15); c.stroke();
    // fletching
    c.fillStyle = color;
    fillPts(c, [[-s * 1.2, 0], [-s * 2.3, -s * 0.55], [-s * 2.0, 0]]);
    c.fillStyle = dark(color, 0.65);
    fillPts(c, [[-s * 1.2, 0], [-s * 2.3, s * 0.55], [-s * 2.0, 0]]);
    // head
    c.fillStyle = '#20202a';
    fillPts(c, [[s * 2.5, 0], [s * 1.1, -s * 0.5], [s * 1.3, 0], [s * 1.1, s * 0.5]]);
    c.fillStyle = light(shaft, 0.6);
    fillPts(c, [[s * 2.3, -0.1], [s * 1.25, -s * 0.38], [s * 1.35, -0.1]]);
  },
};

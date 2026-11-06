/**
 * Level dressing: purely visual decor chosen deterministically from the tile grid
 * (hash2 of tile coords + level seed; never Math.random, never the game rng), so the
 * same level always looks the same and nothing here affects gameplay.
 *
 *   - wall-face features (niches, pilasters, rune plaques, damage, vents, screens)
 *   - wall mounts: light sources (torch | neon tube) and hangings (banner | sign | chain | cable)
 *   - flat floor decals (cracks, puddles, grates, vents, bones, debris, grime)
 *   - raised props depth-sorted with entities (rubble piles, scattered stones, banner poles)
 *
 * Placement rules: nothing within 2 tiles of stairs or 1 tile of a door, object, NPC,
 * entry or spawn; rubble only on floor tiles backed by a wall and with >= 5 open
 * neighbours (never in corridors); poles only in fully open floor; lights spaced by
 * art.lamp.spacing (Chebyshev) and registered only while their tile is explored.
 *
 * Setting comes from level.palette.art (see resolveArt in draw_tiles.js and DECOR_DEFAULTS here).
 */
import { cached, blit, hash2, mix } from './draw_util.js';
import { worldToScreen } from './camera.js';
import { T, idx, inBounds } from '../world/tiles.js';
import { addLight, addGlow, flicker } from './lighting.js';
import { addEmitter } from './atmosphere.js';
import {
  WALL_H, FEAT, resolveArt, featureTable, floorStyleFor, wallStyleFor, faceTransform, tone, rgba, rng, bevel, crack,
} from './draw_tiles.js';

const SEED_FEAT = 101;
const SEED_MOUNT = 202;
const SEED_FLOOR = 303;
const PROP_W = 72;
const PROP_H = 96;
const PROP_AY = 78;
const RUBBLE_SCALE = 1.35;
const DECOR_DEFAULTS = {
  lamp: { kind: 'torch', color: '#ff9a40', colors: null, chance: 0.3, spacing: 4, radius: 135, intensity: 1.0 },
  wallDecor: ['banner', 'chain'],   // banner | sign | chain | cable
  wallDecorChance: 0.14,
  banner: null,                     // [cloth, trim]; default [door colour, accent]
  bone: '#cbbf9f',
  wood: '#5a4030',
  rubble: 0.12,                     // chance per wall-backed floor tile
  stones: 0.035,
  poles: 0.02,                      // banner poles in open floor
  decalChance: 0.03,                // per floor tile, per listed decal kind (capped at 2 kinds)
};
const DECAL_KINDS = { puddle: 'puddle', grate: 'grate', vent: 'vent', bones: 'bones', crate: 'debris', debris: 'debris', crack: 'crack', grime: 'grime' };
const MAX_LIGHTS_ON_SCREEN = 14;

const decorCache = new WeakMap();

function frac(h) {
  return (h % 10007) / 10007;
}

/** Decor knobs merged over defaults (lamp merged one level deep). */
function decorArt(art) {
  const A = resolveArt(art);
  if (A._decor) return A._decor;
  const d = { ...DECOR_DEFAULTS, ...A };
  d.lamp = { ...DECOR_DEFAULTS.lamp, ...(A.lamp || {}) };
  d.banner = A.banner || [A.door || '#6a1e22', A.accent || '#c8a050'];
  A._decor = d;
  return d;
}

/* ------------------------------------------------------------------ */
/* Placement (once per level)                                          */
/* ------------------------------------------------------------------ */

function buildDecor(level) {
  const { tiles } = level;
  const { w, h } = tiles;
  const pal = level.palette || {};
  const D = decorArt(pal.art);
  const seed = (level.seed ^ (level.depth * 7919)) | 0;
  const n = w * h;
  const wallAt = (x, y) => inBounds(tiles, x, y) && tiles.wall[idx(tiles, x, y)] > 0;
  const floorAt = (x, y) => inBounds(tiles, x, y) && tiles.floor[idx(tiles, x, y)] > 0 && !tiles.wall[idx(tiles, x, y)];

  // keep-out map
  const blocked = new Uint8Array(n);
  const block = (cx, cy, r) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inBounds(tiles, x, y)) blocked[idx(tiles, x, y)] = 1;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const f = tiles.flags[idx(tiles, x, y)];
      if (f & (T.STAIRS_DOWN | T.STAIRS_UP)) block(x, y, 2);
      else if (f & T.DOOR) block(x, y, 1);
    }
  }
  for (const list of [level.objects, level.npcs]) {
    for (const o of list || []) {
      const x = Math.floor(o.tx ?? o.x);
      const y = Math.floor(o.ty ?? o.y);
      if (Number.isFinite(x) && Number.isFinite(y)) block(x, y, 1);
    }
  }
  for (const p of [level.entry, level.spawn, level.portalAnchor, level.entryBelow]) if (p) block(p.x, p.y, 1);
  const waterIdx = new Set();
  (pal.floors || []).forEach((_, i) => { if (floorStyleFor(resolveArt(pal.art), i) === 'water') waterIdx.add(i + 1); });

  const featL = new Uint8Array(n);
  const featR = new Uint8Array(n);
  const mounts = new Map();
  const lights = [];
  const decals = new Map();
  const props = [];
  const A = resolveArt(pal.art);
  let P = A.pilasterEvery | 0;
  if ((A.decor || []).includes('pillar') && P > 2) P -= 1;
  const mountAt = [];
  const debrisAt = new Set();
  const near = (list, x, y, r) => list.some((m) => Math.abs(m.x - x) < r && Math.abs(m.y - y) < r);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(tiles, x, y);
      if (!tiles.wall[i]) continue;
      const ws = wallStyleFor(A, tiles.wall[i] - 1);
      const table = featureTable(A, ws);
      for (const face of ['left', 'right']) {
        const fx = face === 'left' ? x : x + 1;
        const fy = face === 'left' ? y + 1 : y;
        if (wallAt(fx, fy) || !floorAt(fx, fy)) continue;
        const fi = idx(tiles, fx, fy);
        const along = face === 'left' ? x : y;
        let feat = FEAT.NONE;
        if (P > 0 && along % P === 0) feat = FEAT.PILASTER;
        else {
          let roll = frac(hash2(x, y, seed + SEED_FEAT + (face === 'left' ? 0 : 1)));
          for (const [code, wgt] of table) {
            if (roll < wgt) { feat = code; break; }
            roll -= wgt;
          }
        }
        if (blocked[fi] && feat !== FEAT.PILASTER) feat = FEAT.NONE;
        (face === 'left' ? featL : featR)[i] = feat;
        if (blocked[fi]) continue;
        if (feat === FEAT.DAMAGED) debrisAt.add(fi);
        // light sources first (spaced), then hangings
        const hm = frac(hash2(x, y, seed + SEED_MOUNT + (face === 'left' ? 0 : 5)));
        const okFace = feat === FEAT.NONE || feat === FEAT.PILASTER || feat === FEAT.DAMAGED;
        if (okFace && hm < D.lamp.chance && !near(lights, x, y, D.lamp.spacing)) {
          const cols = D.lamp.colors;
          const color = cols && cols.length ? cols[hash2(x, y, seed + 9) % cols.length] : D.lamp.color;
          const m = { x, y, fx, fy, face, kind: D.lamp.kind === 'neon' ? 'neon' : 'torch', color, v: hash2(x, y, 3) % 4 };
          lights.push(m);
          mountAt.push(m);
          (mounts.get(i) || mounts.set(i, []).get(i)).push(m);
        } else if (feat === FEAT.NONE && D.wallDecor.length && hm > 1 - D.wallDecorChance && !near(mountAt, x, y, 3)) {
          const kind = D.wallDecor[hash2(x, y, seed + 17) % D.wallDecor.length];
          const m = { x, y, fx, fy, face, kind, v: hash2(x, y, 4) % 4, color: D.lamp.color };
          mountAt.push(m);
          if (kind === 'sign') lights.push({ ...m, glowOnly: true, color: m.v % 2 ? A.accent : (D.lamp.colors ? D.lamp.colors[0] : A.accent) });
          (mounts.get(i) || mounts.set(i, []).get(i)).push(m);
        }
      }
    }
  }

  const kinds = (A.decor || []).map((k) => DECAL_KINDS[k]).filter(Boolean);
  const rubbleBoost = (A.decor || []).includes('rubble') ? 1.6 : 1;
  const poles = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(tiles, x, y);
      if (!floorAt(x, y) || blocked[i] || waterIdx.has(tiles.floor[i])) continue;
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && floorAt(x + dx, y + dy)) open++;
      const behind = wallAt(x, y - 1) || wallAt(x - 1, y);
      const hp = frac(hash2(x, y, seed + SEED_FLOOR));
      const hv = hash2(x, y, seed + SEED_FLOOR + 1);
      if (behind && open >= 5 && (hp < D.rubble * rubbleBoost || (debrisAt.has(i) && hp < 0.6))) {
        props.push({ x, y, kind: 'rubble', v: hv % 6, back: wallAt(x, y - 1) ? (wallAt(x - 1, y) ? 3 : 1) : 2 });
        continue;
      }
      if (open === 8 && hp > 1 - D.poles && !near(poles, x, y, 6) && !behind) {
        let wide = true;
        for (let dy = -2; dy <= 2 && wide; dy++) for (let dx = -2; dx <= 2; dx++) if (!floorAt(x + dx, y + dy)) { wide = false; break; }
        if (wide) {
          const p = { x, y, kind: A.wallDecor && A.wallDecor.includes('sign') ? 'signpole' : 'pole', v: hv % 4 };
          poles.push(p);
          props.push(p);
          if (p.kind === 'signpole') lights.push({ x, y, fx: x, fy: y, face: 'pole', kind: 'sign', glowOnly: true, color: A.accent, v: p.v });
          continue;
        }
      }
      if (open >= 6 && hp > 0.5 && hp < 0.5 + D.stones) {
        props.push({ x, y, kind: 'stones', v: hv % 6 });
        continue;
      }
      const list = [];
      const hd = frac(hash2(x, y, seed + SEED_FLOOR + 2));
      if (kinds.length && hd < D.decalChance * Math.min(2, kinds.length)) list.push({ kind: kinds[hv % kinds.length], v: (hv >>> 8) % 6 });
      else if (hd > 1 - A.cracks * 0.12) list.push({ kind: 'crack', v: (hv >>> 8) % 6 });
      else if (hd > 0.5 && hd < 0.5 + 0.05 * A.grime) list.push({ kind: 'grime', v: (hv >>> 8) % 6 });
      if (list.length) decals.set(i, list);
    }
  }
  return { featL, featR, mounts, lights, decals, props };
}

/** Decor record for a level (built lazily, cached per level object). */
export function getDecor(level) {
  let d = decorCache.get(level);
  if (!d) {
    d = buildDecor(level);
    decorCache.set(level, d);
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Shared shape helpers                                                */
/* ------------------------------------------------------------------ */

/** An extruded rock / chunk: lit top facet, side faces shaded by direction. */
function chunk(c, r, x, y, rad, height, color, sharp = 1) {
  const k = 5 + Math.floor(r() * 3);
  const rot = r() * Math.PI;
  const top = [];
  for (let i = 0; i < k; i++) {
    const a = rot + (i / k) * Math.PI * 2;
    const rr = rad * (0.65 + r() * 0.35 * sharp);
    top.push([x + Math.cos(a) * rr, y - height + Math.sin(a) * rr * 0.55]);
  }
  // sides: edges whose outward normal faces the camera (down)
  for (let i = 0; i < k; i++) {
    const p = top[i];
    const q = top[(i + 1) % k];
    const ny = q[0] - p[0];
    if (ny <= 0) continue;
    const nx = -(q[1] - p[1]);
    c.fillStyle = tone(color, nx < 0 ? 0.62 : 0.42);
    c.beginPath();
    c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.lineTo(q[0], q[1] + height); c.lineTo(p[0], p[1] + height);
    c.closePath();
    c.fill();
  }
  c.save();
  c.beginPath();
  top.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.closePath();
  c.fillStyle = tone(color, 0.95 + r() * 0.2);
  c.fill();
  c.clip();
  bevel(c, top, 0.8, 0.55, 0.4);
  c.restore();
}

/** A broken masonry block: small iso box, optionally tilted, lit from the top-left. */
function block(c, r, x, y, A, B, H, color) {
  const tilt = (r() - 0.5) * 0.5;
  const P = (a, b, z) => [x + (a - b) + z * tilt, y + (a + b) * 0.5 - z];
  const quad = (pts, col) => {
    c.fillStyle = col;
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill();
  };
  quad([P(0, B, 0), P(A, B, 0), P(A, B, H), P(0, B, H)], tone(color, 0.62));
  quad([P(A, 0, 0), P(A, B, 0), P(A, B, H), P(A, 0, H)], tone(color, 0.42));
  const top = [P(0, 0, H), P(A, 0, H), P(A, B, H), P(0, B, H)];
  c.save();
  quad(top, tone(color, 1 + r() * 0.12));
  c.clip();
  bevel(c, top, 0.8, 0.5, 0.4);
  c.restore();
  // broken edge: a dark notch on the front face
  if (r() < 0.6) {
    const t = 0.3 + r() * 0.4;
    quad([P(A * t, B, H), P(A * t + 2, B, H), P(A * t + 1, B, H * 0.4)], 'rgba(0,0,0,0.45)');
  }
}

function shadowBlob(c, x, y, rx, ry, a = 0.4) {
  const g = c.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  c.translate(-x, -y);
  c.fillRect(x - rx, y - rx, rx * 2, rx * 2);
  c.restore();
}

function rebar(c, r, x, y, metal) {
  const a = -Math.PI / 2 + (r() - 0.5) * 1.6;
  const l = 6 + r() * 8;
  c.lineCap = 'round';
  c.strokeStyle = tone(metal, 0.5); c.lineWidth = 1.1;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 0.4;
  c.beginPath(); c.moveTo(x - 0.3, y - 0.3); c.lineTo(x + Math.cos(a) * l - 0.3, y + Math.sin(a) * l - 0.3); c.stroke();
}

/* ------------------------------------------------------------------ */
/* Floor decals (flat, drawn in the floor pass)                        */
/* ------------------------------------------------------------------ */

const DECAL_DRAW = {
  crack(c, r) {
    for (let k = 0; k < 2; k++) crack(c, r, (r() - 0.5) * 30, (r() - 0.5) * 12, 30 + r() * 16, r() * Math.PI * 2, 1);
  },
  grime(c, r) {
    for (let k = 0; k < 4; k++) shadowBlob(c, (r() - 0.5) * 30, (r() - 0.5) * 12, 6 + r() * 9, 3 + r() * 5, 0.32);
  },
  puddle(c, r, D, pal) {
    const rx = 12 + r() * 8;
    const ry = rx * 0.45;
    const x = (r() - 0.5) * 10;
    const y = (r() - 0.5) * 4;
    c.save();
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rr = 0.8 + r() * 0.3;
      const px = x + Math.cos(a) * rx * rr;
      const py = y + Math.sin(a) * ry * rr;
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.closePath();
    c.fillStyle = 'rgba(4,6,10,0.65)';
    c.fill();
    c.clip();
    const tint = pal.lightTint || '#c8d8ff';
    const g = c.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
    g.addColorStop(0, rgba(tint, 0.24));
    g.addColorStop(0.5, rgba(tint, 0.04));
    g.addColorStop(1, rgba(D.accent, 0.14));
    c.fillStyle = g;
    c.fillRect(x - rx, y - ry, rx * 2, ry * 2);
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 0.6;
    c.beginPath(); c.ellipse(x + 2, y, rx * 0.5, ry * 0.4, 0, Math.PI * 1.1, Math.PI * 1.8); c.stroke();
    c.restore();
  },
  grate(c, r, D, pal) {
    const base = (pal.walls && pal.walls[0] && pal.walls[0][0]) || D.metal;
    const pts = [[0, -9], [18, 0], [0, 9], [-18, 0]];
    c.save();
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath();
    c.fillStyle = 'rgba(0,0,0,0.85)'; c.fill();
    c.clip();
    for (let k = -14; k <= 14; k += 3.5) {
      c.strokeStyle = tone(D.metal, 0.9); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(k - 9, -4.5 + k * 0.5 - 4.5); c.lineTo(k + 9, 4.5 + k * 0.5 - 4.5); c.stroke();
    }
    bevel(c, pts, 1.2, 0.5, 0.6);
    c.restore();
    void base; void r;
  },
  vent(c, r, D) {
    c.save();
    c.beginPath(); c.ellipse(0, 0, 13, 6.5, 0, 0, Math.PI * 2);
    c.fillStyle = tone(D.metal, 0.7); c.fill();
    c.beginPath(); c.ellipse(0, 0.5, 10.5, 5, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0,0,0,0.9)'; c.fill();
    c.clip();
    const rot = r() * Math.PI;
    for (let k = 0; k < 5; k++) {
      const a = rot + (k / 5) * Math.PI * 2;
      c.fillStyle = tone(D.metal, 0.75);
      c.beginPath();
      c.moveTo(0, 0.5);
      c.lineTo(Math.cos(a) * 10, 0.5 + Math.sin(a) * 5);
      c.lineTo(Math.cos(a + 0.5) * 10, 0.5 + Math.sin(a + 0.5) * 5);
      c.closePath();
      c.fill();
    }
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 0.8;
    c.beginPath(); c.ellipse(0, 0, 13, 6.5, 0, Math.PI, Math.PI * 1.9); c.stroke();
  },
  bones(c, r, D) {
    const bone = D.bone;
    for (let k = 0; k < 3; k++) {
      const x = (r() - 0.5) * 22;
      const y = (r() - 0.5) * 8;
      const a = r() * Math.PI;
      const l = 5 + r() * 4;
      const dx = Math.cos(a) * l;
      const dy = Math.sin(a) * l * 0.5;
      c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - dx, y - dy + 1); c.lineTo(x + dx, y + dy + 1); c.stroke();
      c.strokeStyle = tone(bone, 0.9); c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(x - dx, y - dy); c.lineTo(x + dx, y + dy); c.stroke();
      c.fillStyle = tone(bone, 1);
      for (const s of [-1, 1]) { c.beginPath(); c.arc(x + dx * s, y + dy * s, 1.2, 0, Math.PI * 2); c.fill(); }
    }
    const x = (r() - 0.5) * 14;
    const y = (r() - 0.5) * 4 - 1;
    shadowBlob(c, x, y + 2.5, 5, 2.5, 0.5);
    c.fillStyle = tone(bone, 1);
    c.beginPath(); c.ellipse(x, y, 3.6, 3, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(x - 2, y + 1, 4, 2.4);
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.beginPath(); c.ellipse(x - 1, y - 1.2, 1.6, 1, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(10,6,4,0.85)';
    c.fillRect(x - 2.1, y - 0.2, 1.5, 1.4);
    c.fillRect(x + 0.6, y - 0.2, 1.5, 1.4);
  },
  debris(c, r, D, pal) {
    const wood = pal.door || D.wood;
    for (let k = 0; k < 5; k++) {
      const x = (r() - 0.5) * 30;
      const y = (r() - 0.5) * 11;
      const a = r() * Math.PI;
      const l = 4 + r() * 6;
      c.save();
      c.translate(x, y);
      c.scale(1, 0.55);
      c.rotate(a);
      c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(-l, -0.4, l * 2, 3.2);
      c.fillStyle = tone(wood, 0.8 + r() * 0.3); c.fillRect(-l, -1.6, l * 2, 2.6);
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(-l, -1.6, l * 2, 0.6);
      c.restore();
    }
  },
};

/** Draw the flat decals of one floor tile. */
export function drawDecals(ctx, sx, sy, list, pal) {
  const D = decorArt(pal.art);
  for (const d of list) {
    const fn = DECAL_DRAW[d.kind];
    if (!fn) continue;
    const key = `dc|${d.kind}|${d.v}|${D.key}|${pal.door || ''}`;
    const entry = cached(key, 66, 34, 33, 17, (c) => fn(c, rng(hash2(d.v, 7, d.kind.length * 31)), D, pal));
    blit(ctx, entry, sx, sy);
  }
}

/* ------------------------------------------------------------------ */
/* Raised props (depth-sorted with entities)                           */
/* ------------------------------------------------------------------ */

function drawRubblePile(c, r, color, D, panel, back) {
  // lean the pile toward the wall(s) behind it
  const ox = back === 1 ? 6 : back === 2 ? -6 : 0;
  const oy = -4;
  shadowBlob(c, ox, oy + 2, 24, 10, 0.5);
  const chunks = [];
  const n = 11 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const size = (1 - d * 0.5) * (2.8 + r() * 4);
    chunks.push({ x: ox + Math.cos(a) * d * 20, y: oy + Math.sin(a) * d * 7.5, size, hgt: size * (0.6 + r() * 0.7) + (1 - d) * 8 });
  }
  const nb = 2 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.3 + r() * 0.7;
    chunks.push({ x: ox + Math.cos(a) * d * 17, y: oy + Math.sin(a) * d * 6, block: true, A: 5 + r() * 5, B: 3 + r() * 4, H: 3 + r() * 4 });
  }
  chunks.sort((p, q) => p.y - q.y);
  for (const ch of chunks) {
    const col = r() < 0.25 ? mix(color, '#000000', 0.3) : color;
    if (ch.block) block(c, r, ch.x - ch.A / 2, ch.y - ch.B / 2, ch.A, ch.B, ch.H, col);
    else chunk(c, r, ch.x, ch.y, ch.size, ch.hgt, col);
    if (panel && r() < 0.18) rebar(c, r, ch.x, ch.y - (ch.hgt || ch.H), D.metal);
  }
  // dust and grit
  for (let i = 0; i < 18; i++) {
    c.fillStyle = r() < 0.5 ? tone(color, 0.9) : 'rgba(0,0,0,0.35)';
    c.fillRect(ox + (r() - 0.5) * 44, oy + 3 + (r() - 0.5) * 12, 1, 0.8);
  }
}

function drawStones(c, r, color) {
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
    const x = (r() - 0.5) * 34;
    const y = (r() - 0.5) * 12;
    const s = 2 + r() * 3;
    shadowBlob(c, x + 1, y + 1, s * 1.8, s * 0.8, 0.45);
    chunk(c, r, x, y, s, s * 0.7, color);
  }
}

function drawPole(c, r, D, sign) {
  const metal = D.metal;
  const top = -78;
  shadowBlob(c, 3, 1, 12, 5, 0.5);
  // foot
  c.fillStyle = tone(metal, 0.55);
  c.beginPath(); c.ellipse(0, 0, 5, 2.4, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = tone(metal, 0.8); c.fillRect(-3, -3, 6, 3);
  // shaft
  c.fillStyle = tone(sign ? metal : D.wood, 0.7); c.fillRect(-1.3, top, 2.6, -top - 2);
  c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(-1.3, top, 0.8, -top - 2);
  // crossbar + finial
  c.fillStyle = tone(metal, 0.9); c.fillRect(-11, top + 3, 22, 1.8);
  c.beginPath(); c.moveTo(0, top - 7); c.lineTo(2.4, top); c.lineTo(-2.4, top); c.closePath(); c.fill();
  if (sign) {
    const [x0, y0, w, h] = [-10, top + 7, 20, 26];
    c.strokeStyle = tone(metal, 0.6); c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(-8, top + 4); c.lineTo(-8, y0); c.moveTo(8, top + 4); c.lineTo(8, y0); c.stroke();
    c.fillStyle = '#07080d'; c.fillRect(x0, y0, w, h);
    c.strokeStyle = rgba(D.accent, 0.35); c.lineWidth = 2.6; c.strokeRect(x0, y0, w, h);
    c.strokeStyle = mix(D.accent, '#ffffff', 0.45); c.lineWidth = 0.9; c.strokeRect(x0, y0, w, h);
    c.fillStyle = mix(D.accent, '#ffffff', 0.3);
    for (let k = 0; k < 4; k++) c.fillRect(x0 + 3, y0 + 4 + k * 5, 4 + r() * 10, 1.4);
    return;
  }
  drawCloth(c, r, -9, top + 5, 18, 34, D.banner[0], D.banner[1], D.accent);
}

/** Banner cloth in the current (screen or face) space, y down. */
function drawCloth(c, r, x, y, w, h, cloth, trim, accent) {
  const tail = 6 + r() * 3;
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x + w / 2, y + h - tail], [x, y + h]];
  c.save();
  c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath();
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, tone(cloth, 1.15));
  g.addColorStop(1, tone(cloth, 0.65));
  c.fillStyle = g;
  c.fill();
  c.clip();
  // folds
  for (let k = 0; k < 4; k++) {
    const fx = x + (k + 0.5) * (w / 4);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(fx + 1, y, 1.6, h);
    c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(fx - 0.6, y, 1, h);
  }
  // trim
  c.strokeStyle = tone(trim, 0.9); c.lineWidth = 1.2;
  c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.stroke();
  // emblem
  const cx = x + w / 2;
  const cy = y + h * 0.38;
  c.fillStyle = tone(accent, 0.95);
  c.beginPath(); c.moveTo(cx, cy - 5); c.lineTo(cx + 4, cy); c.lineTo(cx, cy + 5); c.lineTo(cx - 4, cy); c.closePath(); c.fill();
  c.fillStyle = tone(cloth, 0.7);
  c.beginPath(); c.arc(cx, cy, 1.6, 0, Math.PI * 2); c.fill();
  // tatters
  c.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 3; k++) {
    c.beginPath(); c.arc(x + r() * w, y + h - 2 - r() * 6, 0.8 + r() * 1.2, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

/** Draw a raised prop with its ground anchor at (sx, sy). */
export function drawProp(ctx, sx, sy, p, pal) {
  const D = decorArt(pal.art);
  const color = (pal.walls && pal.walls[0] && pal.walls[0][0]) || '#6b6358';
  const panel = wallStyleFor(D, 0) === 'panel';
  const key = `pr|${p.kind}|${p.v}|${p.back || 0}|${color}|${D.key}`;
  const entry = cached(key, PROP_W, PROP_H, PROP_W / 2, PROP_AY, (c) => {
    const r = rng(hash2(p.v, p.kind.length, (p.back || 0) + 41));
    if (p.kind === 'rubble') {
      c.scale(RUBBLE_SCALE, RUBBLE_SCALE);
      drawRubblePile(c, r, tone(color, 0.82), D, panel, p.back);
    }
    else if (p.kind === 'stones') drawStones(c, r, tone(color, 0.8));
    else drawPole(c, r, D, p.kind === 'signpole');
  });
  blit(ctx, entry, sx, sy);
}

/* ------------------------------------------------------------------ */
/* Wall mounts (drawn right after their wall)                          */
/* ------------------------------------------------------------------ */

const FLAME_H = WALL_H - 18;     // flame base height on a face
const TUBE_H = WALL_H - 17;

function mountTorch(c, metal) {
  c.fillStyle = tone(metal, 0.45); c.fillRect(14.3, FLAME_H - 15, 3.4, 8);
  c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(14.3, FLAME_H - 8, 3.4, 0.6);
  c.fillStyle = tone(metal, 0.7); c.fillRect(15.3, FLAME_H - 8, 1.4, 6);
  c.fillStyle = tone(metal, 0.6);
  c.beginPath(); c.moveTo(12.6, FLAME_H); c.lineTo(19.4, FLAME_H); c.lineTo(17.6, FLAME_H - 3); c.lineTo(14.4, FLAME_H - 3); c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(12.6, FLAME_H - 0.6, 6.8, 0.6);
  // soot above the torch
  const g = c.createLinearGradient(0, FLAME_H, 0, FLAME_H + 16);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(11, FLAME_H + 1, 10, 15);
}

function mountNeon(c, color, metal, v) {
  const vertical = v % 2 === 1;
  c.lineCap = 'round';
  if (vertical) {
    c.fillStyle = tone(metal, 0.5); c.fillRect(14.5, TUBE_H - 22, 3, 2); c.fillRect(14.5, TUBE_H + 2, 3, 2);
    c.strokeStyle = rgba(color, 0.5); c.lineWidth = 3.4;
    c.beginPath(); c.moveTo(16, TUBE_H - 20); c.lineTo(16, TUBE_H + 2); c.stroke();
    c.strokeStyle = mix(color, '#ffffff', 0.7); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(16, TUBE_H - 20); c.lineTo(16, TUBE_H + 2); c.stroke();
    return;
  }
  c.fillStyle = tone(metal, 0.5); c.fillRect(4.5, TUBE_H - 1.5, 2, 3); c.fillRect(25.5, TUBE_H - 1.5, 2, 3);
  c.strokeStyle = rgba(color, 0.5); c.lineWidth = 3.4;
  c.beginPath(); c.moveTo(6, TUBE_H); c.lineTo(26, TUBE_H); c.stroke();
  c.strokeStyle = mix(color, '#ffffff', 0.7); c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(6, TUBE_H); c.lineTo(26, TUBE_H); c.stroke();
}

function mountChain(c, r, metal, v) {
  const link = (x, y, i) => {
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 2.2;
    if (i % 2) {
      c.beginPath(); c.moveTo(x, y - 2.2); c.lineTo(x, y + 2.2); c.stroke();
      c.strokeStyle = tone(metal, 1.1); c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(x, y - 2.2); c.lineTo(x, y + 2.2); c.stroke();
      return;
    }
    c.beginPath(); c.ellipse(x, y, 1.6, 2.5, 0, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = tone(metal, 0.95); c.lineWidth = 1.1;
    c.beginPath(); c.ellipse(x, y, 1.6, 2.5, 0, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 0.5;
    c.beginPath(); c.ellipse(x, y, 1.6, 2.5, 0, Math.PI * 0.5, Math.PI * 1.1); c.stroke();
  };
  const ring = (x, y) => {
    c.fillStyle = tone(metal, 0.4); c.fillRect(x - 1.5, y - 1, 3, 3);
    c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(x - 1.5, y + 1.4, 3, 0.5);
  };
  const top = WALL_H - 13;
  if (v % 2 === 0) {
    // draped between two rings
    ring(6, top); ring(26, top);
    const sag = 12 + r() * 8;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      link(6 + 20 * t, top - 4 * sag * t * (1 - t) - 1, i);
    }
  }
  // hanging chain with a shackle
  const x = v % 2 === 0 ? 16 + (r() - 0.5) * 6 : 10 + r() * 12;
  const bottom = 18 + r() * 12;
  ring(x, top);
  let i = 0;
  for (let y = top - 2.5; y > bottom; y -= 3.6) link(x, y, i++);
  c.strokeStyle = tone(metal, 0.5); c.lineWidth = 1.2;
  c.beginPath(); c.arc(x, bottom - 1, 2.6, 0, Math.PI * 2); c.stroke();
}

function mountCable(c, r, metal, accent) {
  const cols = [tone('#202226', 1), tone('#2c2a24', 1), accent];
  for (let k = 0; k < 3; k++) {
    const s0 = 1 + r() * 6;
    const s1 = 25 + r() * 6;
    const h0 = WALL_H - 11 - r() * 4;
    const sag = 8 + r() * 14;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(s0, h0 - 1.4); c.quadraticCurveTo((s0 + s1) / 2, h0 - sag * 2 - 1.4, s1, h0 - 1.4); c.stroke();
    c.strokeStyle = k === 2 ? tone(accent, 0.7) : cols[k]; c.lineWidth = 1.7;
    c.beginPath(); c.moveTo(s0, h0); c.quadraticCurveTo((s0 + s1) / 2, h0 - sag * 2, s1, h0); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 0.5;
    c.beginPath(); c.moveTo(s0, h0 + 0.5); c.quadraticCurveTo((s0 + s1) / 2, h0 - sag * 2 + 0.5, s1, h0 + 0.5); c.stroke();
  }
  c.fillStyle = tone(metal, 0.5); c.fillRect(0, WALL_H - 16, 3, 4); c.fillRect(29, WALL_H - 16, 3, 4);
}

function mountSign(c, r, color) {
  const [s0, h0, w, h] = [6, 26, 20, 22];
  c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(s0 + 1, h0 - 1.5, w, h);
  c.fillStyle = '#07080d'; c.fillRect(s0, h0, w, h);
  c.strokeStyle = rgba(color, 0.35); c.lineWidth = 2.6; c.strokeRect(s0, h0, w, h);
  c.strokeStyle = mix(color, '#ffffff', 0.45); c.lineWidth = 0.9; c.strokeRect(s0 + 0.4, h0 + 0.4, w - 0.8, h - 0.8);
  c.fillStyle = mix(color, '#ffffff', 0.3);
  for (let k = 0; k < 3; k++) c.fillRect(s0 + 3, h0 + h - 6 - k * 5, 4 + r() * 11, 1.6);
}

function drawMountSprite(c, m, D) {
  c.save();
  faceTransform(c, m.face);
  const r = rng(hash2(m.v, m.kind.length, 61));
  if (m.kind === 'torch') mountTorch(c, D.metal);
  else if (m.kind === 'neon') mountNeon(c, m.color, D.metal, m.v);
  else if (m.kind === 'chain') mountChain(c, r, D.metal, m.v);
  else if (m.kind === 'cable') mountCable(c, r, D.metal, D.accent);
  else if (m.kind === 'sign') mountSign(c, r, m.v % 2 ? D.accent : (D.lamp.colors ? D.lamp.colors[0] : D.accent));
  else if (m.kind === 'banner') {
    // cloth hangs from a rod; draw in face space with y flipped back to "down"
    c.fillStyle = tone(D.metal, 0.6); c.fillRect(6, WALL_H - 12, 20, 1.6);
    c.save();
    c.translate(0, WALL_H - 12);
    c.scale(1, -1);
    drawCloth(c, r, 8, 1, 16, 32 + (m.v % 2) * 6, D.banner[0], D.banner[1], D.accent);
    c.restore();
  }
  c.restore();
}

function flameSprite(color, frame) {
  return cached(`flame|${color}|${frame}`, 14, 22, 7, 18, (c) => {
    const r = rng(frame * 13 + 5);
    const h = 13 + r() * 3;
    const lean = (r() - 0.5) * 3;
    const layers = [[color, 1, 0.95], [mix(color, '#ffe080', 0.6), 0.68, 1], [mix('#fff6d0', '#ffffff', 0.5), 0.36, 1]];
    for (const [col, k, a] of layers) {
      c.globalAlpha = a;
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(-4 * k, 0);
      c.quadraticCurveTo(-5 * k, -h * k * 0.55, lean, -h * k);
      c.quadraticCurveTo(5 * k, -h * k * 0.5, 4 * k, 0);
      c.quadraticCurveTo(0, 2.2 * k, -4 * k, 0);
      c.fill();
    }
    c.globalAlpha = 1;
  });
}

/** Screen position of a mount's emitter, relative to its wall tile centre. */
function mountAnchor(m, sx, sy) {
  if (m.face === 'pole') return [sx, sy - 60];
  const fx = m.face === 'left' ? sx - 16 : sx + 16;
  if (m.kind === 'torch') return [fx, sy + 8 - FLAME_H - 2];
  if (m.kind === 'neon') return [fx, sy + 8 - TUBE_H + (m.v % 2 ? 9 : 0)];
  return [fx, sy + 8 - 37];
}

/** Draw the mounts of one wall tile (call right after drawWall, inside its alpha). */
export function drawMounts(ctx, sx, sy, list, pal, now) {
  const D = decorArt(pal.art);
  for (const m of list) {
    const key = `mt|${m.kind}|${m.face}|${m.v}|${m.color}|${D.key}`;
    const entry = cached(key, 66, 120, 33, 104, (c) => drawMountSprite(c, m, D));
    blit(ctx, entry, sx, sy);
    if (m.kind === 'torch') {
      const [fx, fy] = mountAnchor(m, sx, sy);
      const frame = Math.floor(now * 9 + m.x * 3 + m.y) % 4;
      blit(ctx, flameSprite(m.color, frame), fx, fy);
    }
  }
}

/**
 * Register lights / glows / embers for decor light sources on screen whose tile is explored.
 * @param {object} level
 * @param {object} cam
 * @param {{x0,y0,x1,y1}} b visible tile bounds
 * @param {number} now seconds
 */
export function registerDecorLights(level, cam, b, now) {
  const dec = getDecor(level);
  const D = decorArt((level.palette || {}).art);
  let count = 0;
  for (const m of dec.lights) {
    if (m.x < b.x0 - 1 || m.x > b.x1 + 1 || m.y < b.y0 - 1 || m.y > b.y1 + 1) continue;
    if (!inBounds(level.tiles, m.fx, m.fy) || !level.explored[idx(level.tiles, m.fx, m.fy)]) continue;
    if (count++ >= MAX_LIGHTS_ON_SCREEN) break;
    const p = worldToScreen(m.x + 0.5, m.y + 0.5, cam);
    const [ax, ay] = mountAnchor(m, p.x, p.y);
    const seed = m.x * 7.3 + m.y * 3.1;
    if (m.glowOnly) {
      addLight(ax, ay + 10, 70, m.color, 0.45);
      addGlow(ax, ay, 22, m.color, 0.28);
      continue;
    }
    if (m.kind === 'torch') {
      const f = flicker(seed, now, 0.16);
      addLight(ax, ay + 18, D.lamp.radius, m.color, D.lamp.intensity * f);
      addGlow(ax, ay - 5, 26, m.color, 0.55 * f);
      addGlow(ax, ay - 4, 9, '#fff0c0', 0.5 * f);
      addGlow(ax, ay + 30, 70, m.color, 0.09 * f); // warm pool on wall + floor
      addEmitter(ax, ay - 10, m.color, 3, 3);
    } else {
      const f = flicker(seed, now, 0.04);
      addLight(ax, ay + 16, D.lamp.radius, m.color, D.lamp.intensity * f);
      addGlow(ax, ay, 30, m.color, 0.42 * f);
      addGlow(ax, ay, 12, mix(m.color, '#ffffff', 0.5), 0.35 * f);
    }
  }
}

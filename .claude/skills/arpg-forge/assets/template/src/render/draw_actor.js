/**
 * Procedural actor sprites: players, NPCs and monsters. (sx, sy) is the feet ground point.
 *
 * How it works (see NOTES-actors.md for the reusable version):
 *   - Every figure is a small 3D puppet in actor space (s = right, f = forward, z = up, in px).
 *     A pose is authored as foot / hand TARGETS plus torso tilt & twist; two-bone IK places
 *     knees and elbows. The puppet is projected for the facing direction (orthographic,
 *     ground plane squashed 2:1 like the tiles), and every part is painted back-to-front by
 *     its projected depth, so all 8 directions come out of one description.
 *   - Parts are volumes, not flat fills: tapered capsules (limbs), elliptic frustums (torso,
 *     faulds, robes), ellipsoids (heads, pauldrons, bodies), each with a gradient lit from the
 *     upper-left. Surface details (visor slits, chest seams, emblems) are drawn through an
 *     affine "decal" transform so they turn with the body.
 *   - The finished figure is inked (dark outline + rim light, draw_volume.inked) over a soft
 *     contact shadow. Glowing parts are listed per sprite and registered as additive glows
 *     each frame, because the lighting pass multiplies the world down.
 *   - Sprites are cached per (look, dir, anim, frame-pose, size); the light level is NOT in
 *     the key (lighting is screen-space now).
 *
 * look (all optional except silhouette; colours are data, never hardcoded here):
 *   silhouette  'bulky'|'lean'|'robed'|'tall'|'crawler'|'flier'|'blob'|'turret'
 *   bodyColor   main armour / hide colour           trimColor   accent / cloth colour
 *   size        scale factor (bosses 1.5–2)
 *   weapon      'sword'|'katana'|'greatsword'|'axe'|'hammer'|'mace'|'spear'|'staff'|'wand'|
 *               'dagger'|'blade'|'claws'|'pistol'|'gun'|'rifle'|'bow'|'none'
 *               (item glyph names blade/axe/mace/bow/gun/staff/wand are accepted too)
 *   offhand     'shield'|'buckler'|'pistol'|'dagger'|'orb'|'none'
 *   helm        'full'|'visor'|'open'|'hood'|'horned'|'crest'|'bare'|'mask'|'goggles'
 *               (mask = respirator + goggles, goggles = open face with goggles; the 2D puppet
 *               draws them as visor / open)
 *   armor       'plate'|'light'|'cloth'|'none'  (none = bare hide in bodyColor)
 *   cloak       'none'|'short'|'long'|'tattered'
 *   glow        true (= trimColor) or a colour: emissive trim, visor, eyes, energy edges
 *   cloakColor, metalColor (weapons), skinColor, accentColor (buckles, studs, horns), underColor,
 *   hairColor (3D tech heads)
 *   legs        crawler leg count (4|6|8)       wings  flier: 'membrane'|'rotor'
 *   style       'classic' (forged metal, leather, wool) | 'tech' (hard-shell polymer, gunmetal,
 *               techwear, light strips; sci-fi weapons and helmets). 3D renderer only.
 *               setLookDefaults({ style }) sets it for every look (theme meta.lookDefaults).
 * Missing fields default per silhouette (DEFAULTS below).
 * opts: { dir 0..7, frame, anim:'stand'|'walk'|'attack'|'cast'|'hit'|'death', light, scale }
 * Glows are registered only for world draws (callers that pass opts.light).
 */
import { cached, blit, dirToScreen, mix, RENDER_SCALE } from './draw_util.js';
import {
  inked, contactShadow, capsule, sphere, litH, litRadial, fillPts, strokePts, hull, bbox,
  rgba, dark, light, luma, rivet, LIGHT_X, LIGHT_Y,
} from './draw_volume.js';
import { addGlow } from './lighting.js';

const TAU = Math.PI * 2;
const PI = Math.PI;
const GROUND_SQUASH = 0.5;
export const WALK_FRAMES = 8;
export const ATTACK_FRAMES = 8;
export const CAST_POSES = 4;
export const HIT_POSES = 2;
export const DEATH_POSES = 4;
const DEATH_FRAMES = 10;
const HIT_FRAMES = 4;
const CAST_FRAMES = 8;

/** Sprite boxes (logical px at size 1): w, h, anchor y (feet). */
export const BOX = { w: 100, h: 116, ay: 102 };
export const BOX_TALL = { w: 124, h: 150, ay: 134 };
export const BOX_DEATH = { w: 156, h: 84, ay: 58 };
export const BOX_LOW = { w: 96, h: 80, ay: 66 };

const DEFAULT_LOOK = { silhouette: 'bulky', bodyColor: '#a0a0a0', trimColor: '#404040' };
const DEFAULT_METAL = '#b9bec8';
const DEFAULT_SKIN = '#b98d70';
const OUTLINE = 'rgba(8,6,10,0.94)';

/** Per-silhouette defaults for the optional look fields. */
export const DEFAULTS = {
  bulky: { weapon: 'sword', offhand: 'none', helm: 'full', armor: 'plate', cloak: 'short' },
  lean: { weapon: 'dagger', offhand: 'none', helm: 'hood', armor: 'light', cloak: 'none' },
  robed: { weapon: 'staff', offhand: 'none', helm: 'hood', armor: 'cloth', cloak: 'none' },
  tall: { weapon: 'claws', offhand: 'none', helm: 'horned', armor: 'plate', cloak: 'tattered' },
  crawler: { legs: 6 },
  flier: { wings: 'membrane' },
  blob: {},
  turret: { weapon: 'gun' },
};

/** Body builds (px at size 1). z values are heights above the ground. */
export const BUILDS = {
  bulky: { hipZ: 30, hipW: 4.9, thigh: 15.5, shin: 15, legR: [4.4, 3.3], waistZ: 35, shZ: 52, sh: 11, chest: [10, 6.8], waist: [7.6, 5.6], head: 5.8, arm: [12.5, 11.5], armR: [3.8, 3.1], pauld: 7.2, tilt: 0.02 },
  lean: { hipZ: 31, hipW: 3.8, thigh: 16, shin: 15.5, legR: [3.2, 2.4], waistZ: 36, shZ: 53, sh: 8.4, chest: [7.4, 5.0], waist: [5.6, 4.2], head: 5.3, arm: [12.5, 12], armR: [2.8, 2.3], pauld: 4.4, tilt: 0.04 },
  robed: { hipZ: 30, hipW: 3.8, thigh: 15.5, shin: 15, legR: [3.0, 2.4], waistZ: 35, shZ: 52, sh: 8.6, chest: [7.8, 5.4], waist: [6.2, 4.8], head: 5.4, arm: [12.5, 12], armR: [3.2, 2.9], pauld: 5.2, tilt: 0.05 },
  tall: { hipZ: 40, hipW: 6, thigh: 20.5, shin: 20, legR: [5.2, 3.8], waistZ: 46, shZ: 72, sh: 14, chest: [12.5, 8.4], waist: [8.4, 6.6], head: 6.0, arm: [18, 17], armR: [4.8, 3.8], pauld: 8.5, tilt: 0.32 },
};

const ONE_HAND = new Set(['sword', 'katana', 'axe', 'mace', 'dagger', 'blade', 'wand', 'pistol', 'claws', 'none']);
export const HEAVY = new Set(['greatsword', 'hammer']);
export const RANGED = new Set(['pistol', 'gun', 'rifle', 'bow']);
const WEAPON_ALIAS = { gun: 'rifle' };

// Legs: thigh + shin just longer than hip height above the ankle, so a standing leg is nearly straight.
for (const b of Object.values(BUILDS)) { b.thigh = (b.hipZ - 2.2) * 0.515; b.shin = (b.hipZ - 2.2) * 0.5; }

/** Non-humanoids are authored small; this brings them up to the heroes' scale. */
export const SPECIAL_SCALE = { crawler: 1.3, flier: 1.4, blob: 1.45, turret: 1.4 };

let resolvedLooks = new WeakMap();
let LOOK_DEFAULTS = {};

/** Theme-wide defaults under every look (e.g. { style: 'tech' }); call before the first draw. */
export function setLookDefaults(d) {
  LOOK_DEFAULTS = { ...(d || {}) };
  resolvedLooks = new WeakMap();
}
let pendingGlows = null;

export function frameKey(anim, frame) {
  const f = Math.max(0, frame | 0);
  if (anim === 'walk') return f % WALK_FRAMES;
  if (anim === 'attack') return f % ATTACK_FRAMES;
  if (anim === 'cast') return Math.min(CAST_POSES - 1, Math.floor(((f % CAST_FRAMES) * CAST_POSES) / CAST_FRAMES));
  if (anim === 'hit') return Math.min(HIT_POSES - 1, Math.floor((Math.min(f, HIT_FRAMES - 1) * HIT_POSES) / HIT_FRAMES));
  if (anim === 'death') return Math.min(DEATH_POSES - 1, Math.floor((Math.min(f, DEATH_FRAMES - 1) * DEATH_POSES) / (DEATH_FRAMES - 2)));
  return 0;
}

/** Fill in defaults and derived colours once per look object. */
export function resolveLook(look) {
  let r = resolvedLooks.get(look);
  if (r) return r;
  const sil = DEFAULTS[look.silhouette] ? look.silhouette : 'bulky';
  const d = DEFAULTS[sil];
  const body = look.bodyColor || DEFAULT_LOOK.bodyColor;
  const trim = look.trimColor || DEFAULT_LOOK.trimColor;
  const glow = look.glow === true ? trim : (typeof look.glow === 'string' ? look.glow : null);
  const armor = look.armor || d.armor || 'plate';
  let weapon = look.weapon || d.weapon || 'none';
  weapon = WEAPON_ALIAS[weapon] || weapon;
  r = {
    sil,
    style: look.style || LOOK_DEFAULTS.style || 'classic',
    body,
    trim,
    glow,
    armor,
    weapon,
    offhand: look.offhand || d.offhand || 'none',
    helm: look.helm || d.helm || 'full',
    cloak: look.cloak || d.cloak || 'none',
    legs: look.legs || d.legs || 6,
    wings: look.wings || d.wings || 'membrane',
    metal: look.metalColor || DEFAULT_METAL,
    skin: look.skinColor || (armor === 'none' ? body : DEFAULT_SKIN),
    under: look.underColor || mix(body, '#16131a', armor === 'cloth' ? 0.35 : 0.6),
    leather: mix(mix(body, trim, 0.25), '#17120f', 0.62),
    cloakC: look.cloakColor || mix(trim, '#0d0b0f', 0.55),
    accent: look.accentColor || light(trim, 0.2),
  };
  r.key = [sil, r.style, body, trim, glow, armor, weapon, r.offhand, r.helm, r.cloak, r.legs, r.wings,
    look.metalColor, look.skinColor, look.cloakColor, look.accentColor, look.underColor, look.hairColor].join('|');
  resolvedLooks.set(look, r);
  return r;
}

/**
 * Draw an actor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx feet x
 * @param {number} sy feet y
 * @param {object} look see header
 * @param {{dir?:number, frame?:number, anim?:string, light?:number, scale?:number}} [opts]
 */
export function drawActor(ctx, sx, sy, look = DEFAULT_LOOK, opts = {}) {
  const { dir = 0, frame = 0, anim = 'stand', scale = 1 } = opts;
  const L = resolveLook(look || DEFAULT_LOOK);
  const size = (look.size || 1) * scale * (SPECIAL_SCALE[L.sil] || 1);
  const fk = frameKey(anim, frame);
  const d = ((dir | 0) % 8 + 8) % 8;
  const key = `A|${L.key}|${d}|${anim}|${fk}|${size}`;
  const box = anim === 'death' && !SPECIAL[L.sil] ? BOX_DEATH : (L.sil === 'tall' ? BOX_TALL : (L.sil === 'crawler' || L.sil === 'blob' ? BOX_LOW : BOX));
  const w = Math.ceil(box.w * size);
  const h = Math.ceil(box.h * size);
  const ay = Math.round(box.ay * size);
  pendingGlows = [];
  const entry = cached(key, w, h, w / 2, ay, (c) => paintActor(c, L, d, anim, fk, size));
  if (!entry.glows) entry.glows = pendingGlows;
  pendingGlows = null;
  blit(ctx, entry, sx, sy);
  if (opts.light !== undefined) {
    for (const g of entry.glows) addGlow(sx + g.x, sy + g.y, g.r, g.color, g.a);
  }
}

/* ------------------------------------------------------------------ projection */

export function makeView(dir) {
  const v = dirToScreen(dir);
  let gx = v.x;
  let gy = v.y / GROUND_SQUASH;
  const n = Math.hypot(gx, gy) || 1;
  gx /= n; gy /= n;
  // forward F, right R in the ground plane (screen x, screen-down depth)
  return { F: [gx, gy], R: [-gy, gx] };
}

/** Project actor-space (s, f, z) -> {x, y, d}. */
function proj(V, p) {
  const gx = p[0] * V.R[0] + p[1] * V.F[0];
  const gy = p[0] * V.R[1] + p[1] * V.F[1];
  return { x: gx, y: gy * GROUND_SQUASH - p[2], d: gy };
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len3(a) || 1));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Two-bone IK: joint position for root A reaching target T with bone lengths l1, l2. */
export function ik(A, T, l1, l2, pole) {
  let dv = sub(T, A);
  let d = len3(dv);
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) { dv = mul(dv, maxD / d); d = maxD; }
  if (d < 0.001) return add(A, mul(norm(pole), l1));
  const u = mul(dv, 1 / d);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let p = sub(pole, mul(u, dot(pole, u)));
  p = norm(p);
  return add(A, add(mul(u, a), mul(p, hh)));
}

/** Weapon direction from pitch (0 down, PI/2 forward, PI up) and yaw (+ toward the right). */
export function wdir(p, y) {
  return [Math.sin(y) * Math.sin(p), Math.cos(y) * Math.sin(p), -Math.cos(p)];
}

/* ------------------------------------------------------------------ main painter */

function paintActor(c, L, dir, anim, f, size) {
  const V = makeView(dir);
  c.save();
  c.scale(size, size);
  const special = SPECIAL[L.sil];
  const ctx = { c, L, V, anim, f, size, ops: [], glows: [], after: [] };
  let pose = null;
  if (!special) {
    pose = humanoidPose(L, anim, f);
    buildHumanoid(ctx, pose);
  } else {
    special(ctx);
  }
  const death = anim === 'death';
  const topple = death && !special; // humanoids fall over; other bodies collapse in place
  const fall = topple ? (V.F[0] > 0.05 ? -1 : 1) : 0;
  const ang = topple ? [0.32, 0.95, 1.42, 1.5][f] : 0;
  const slump = death && special ? [0.85, 0.66, 0.52, 0.48][f] : 1;
  // contact shadow (not inked)
  const sw = ctx.shadowR || (BUILDS[L.sil] ? BUILDS[L.sil].sh * 1.35 + 2 : 13);
  if (topple) contactShadow(c, fall * Math.sin(ang) * 26, 0, sw + Math.sin(ang) * 22, 6 + Math.sin(ang) * 3, 0.5);
  else if (death) contactShadow(c, 0, 0, sw * 1.2, sw * 0.5, 0.55);
  else contactShadow(c, (pose ? pose.rootF * V.F[0] : 0), 1, sw, sw * 0.42, ctx.shadowA || 0.55);
  ctx.ops.sort((a, b) => a.d - b.d);
  const flash = anim === 'hit' ? (f === 0 ? 0.45 : 0.2) : 0;
  inked(c, (g) => {
    if (topple) {
      g.rotate(fall * ang);
      if (f === DEATH_POSES - 1) g.scale(1, 0.82);
    } else if (death) {
      g.rotate((V.F[0] > 0 ? -1 : 1) * (1 - slump) * 0.35);
      g.scale(1 + (1 - slump) * 0.3, slump);
    }
    for (const op of ctx.ops) op.fn(g);
  }, { outline: OUTLINE, rim: ctx.rim || light(L.glow || L.metal, 0.5), rimAlpha: death ? 0.15 : 0.42, flash });
  for (const fn of ctx.after) fn(c);
  c.restore();
  if (!death) for (const g of ctx.glows) pendingGlows.push({ x: g.x * size, y: g.y * size, r: g.r * size, color: g.color, a: g.a });
}

/* ------------------------------------------------------------------ humanoid poses */

export function stanceFor(L) {
  if (L.weapon === 'bow') return 'bow';
  if (RANGED.has(L.weapon)) return L.weapon === 'pistol' ? 'pistol' : 'rifle';
  if (L.weapon === 'staff' || L.weapon === 'spear') return 'pole';
  if (HEAVY.has(L.weapon)) return 'heavy';
  if (L.weapon === 'claws' || L.weapon === 'none') return 'claws';
  return 'blade';
}

/**
 * Pose = { rootF, rootZ, tilt, twist, feet:[R,L] targets, hands:[R,L] targets (upper-body
 * space, relative to the waist), wp:[pitch,yaw], two (offhand grips weapon), flash, smear,
 * muzzle, cast }.
 */
export function humanoidPose(L, anim, f) {
  const B = BUILDS[L.sil];
  const st = stanceFor(L);
  const sh = B.sh;
  const up = B.shZ - B.waistZ; // shoulder height above waist
  const P = {
    rootF: 0, rootZ: 0, tilt: B.tilt, twist: 0, crouch: 0,
    feet: [[B.hipW + 0.6, 0.8, 0], [-B.hipW - 0.6, -0.6, 0]],
    hands: [[sh + 1.5, 3, up - B.arm[0] - B.arm[1] + 5], [-sh - 1.2, 1, up - B.arm[0] - B.arm[1] + 4]],
    wp: [0.95, 0.18], two: false, smear: null, muzzle: false, cast: 0,
  };
  const rest = (k) => {
    if (st === 'heavy') { P.hands[0] = [sh - 1, 5, up - 9]; P.wp = [2.55, 0.35]; P.hands[1] = [sh * 0.3, 8, up - 19]; P.two = true; }
    if (st === 'pole') { P.hands[0] = [sh + 2.5, 4, up - 18]; P.wp = [PI, 0]; }
    if (st === 'rifle') { P.hands[0] = [sh * 0.55, 7, up - 17]; P.wp = [1.25, -0.35]; P.two = true; }
    if (st === 'pistol') { P.hands[0] = [sh + 1.5, 6, up - 22]; P.wp = [1.0, 0.1]; }
    if (st === 'bow') { P.hands[1] = [-sh - 1.5, 5, up - 20]; P.wp = [PI * 0.92, -0.1]; }
    if (st === 'claws') { P.hands[0] = [sh + 2, 4, up - 21]; P.hands[1] = [-sh - 2, 4, up - 21]; P.wp = [1.0, 0.3]; }
    if (L.sil === 'tall') { P.hands[0][2] -= 4; P.hands[1][2] -= 4; P.hands[0][1] += 3; P.hands[1][1] += 3; }
    return k;
  };
  rest();
  if (anim === 'walk') {
    const ph = (f / WALK_FRAMES) * TAU;
    const s = Math.sin(ph);
    const stride = L.sil === 'tall' ? 8 : 6;
    P.feet[0] = [B.hipW + 0.4, stride * s, Math.max(0, Math.cos(ph)) * 3.2];
    P.feet[1] = [-B.hipW - 0.4, -stride * s, Math.max(0, -Math.cos(ph)) * 3.2];
    P.rootZ = -Math.abs(s) * 1.2 + 0.4;
    P.twist = 0.1 * s;
    P.tilt += 0.06;
    const swing = 4.5;
    if (st === 'blade' || st === 'claws' || st === 'pistol' || st === 'pole') P.hands[0][1] -= swing * s * (st === 'pole' ? 0.4 : 0.8);
    if (st !== 'bow' && !P.two) P.hands[1][1] += swing * s;
    if (st === 'claws') P.hands[1][1] += swing * s * 0.2;
  } else if (anim === 'attack') {
    attackPose(P, L, st, f, B);
  } else if (anim === 'cast') {
    const k = [0.35, 0.75, 1, 0.8][f];
    P.cast = k;
    P.tilt -= 0.08 * k;
    if (st === 'pole') {
      P.hands[0] = [sh * 0.6, 8 + 4 * k, up + 2 + 10 * k];
      P.wp = [PI, 0];
      P.hands[1] = [-sh * 0.4, 10 + 5 * k, up - 4 + 8 * k];
    } else {
      P.hands[0] = [sh * 0.5 + 2 * k, 8 + 7 * k, up - 10 + 14 * k];
      P.hands[1] = [-sh * 0.5 - 2 * k, 8 + 7 * k, up - 10 + 14 * k];
      P.wp = [1.6, 0.6];
    }
    P.feet[0][1] = 2.5; P.feet[1][1] = -2.5;
  } else if (anim === 'hit') {
    const k = f === 0 ? 1 : 0.5;
    P.tilt -= 0.3 * k;
    P.rootF = -2.5 * k;
    P.hands[0][0] += 3 * k; P.hands[0][2] += 5 * k;
    P.hands[1][0] -= 3 * k; P.hands[1][2] += 5 * k;
    P.feet[1][1] = -4 * k;
  } else if (anim === 'death') {
    const k = [0.3, 0.7, 1, 1][f];
    P.crouch = 5 * k;
    P.tilt -= 0.25 * k;
    P.hands[0][2] += 8 * k; P.hands[0][0] += 4 * k;
    P.hands[1][2] += 8 * k; P.hands[1][0] -= 4 * k;
  }
  return P;
}

function attackPose(P, L, st, f, B) {
  const sh = B.sh;
  const up = B.shZ - B.waistZ;
  const lunge = [0, -0.5, 0.5, 3, 5, 4.5, 2.5, 1][f];
  if (st === 'rifle' || st === 'pistol') {
    const aim = [0.4, 0.85, 1, 1, 1, 1, 0.8, 0.5][f];
    const kick = f === 2 || f === 4 ? 1 : (f === 3 || f === 5 ? 0.4 : 0);
    if (st === 'rifle') {
      P.hands[0] = [lerp(sh * 0.55, sh * 0.35, aim), lerp(7, 5, aim) - kick * 2, lerp(up - 17, up - 6, aim)];
      P.wp = [lerp(1.25, PI / 2, aim) + kick * 0.12, lerp(-0.35, -0.05, aim)];
    } else {
      P.hands[0] = [lerp(sh + 1.5, sh * 0.5, aim), lerp(6, 18, aim) - kick * 2.5, lerp(up - 22, up - 5, aim)];
      P.wp = [lerp(1.0, PI / 2, aim) + kick * 0.25, 0];
    }
    P.twist = 0.12 * aim;
    P.rootF = -kick * 1.2;
    P.feet[0][1] = 2; P.feet[1][1] = -3;
    P.muzzle = kick === 1;
    return;
  }
  if (st === 'bow') {
    const draw = [0.3, 0.7, 1, 1, 0, 0, 0, 0][f];
    P.hands[1] = [-sh * 0.3, 16, up - 6];
    P.hands[0] = [sh * 0.2, 16 - draw * 13, up - 5];
    P.wp = [PI / 2, 0];
    P.twist = -0.2;
    P.feet[0][1] = -2; P.feet[1][1] = 3;
    P.bowDraw = draw;
    return;
  }
  if (st === 'claws') {
    // alternating rakes
    const side = f < 4 ? 0 : 1;
    const t = (f % 4) / 3;
    const reach = Math.sin(t * PI);
    const s = side === 0 ? 1 : -1;
    P.hands[side] = [s * lerp(sh + 2, 2, t), lerp(2, 16, reach), lerp(up + 4, up - 12, t)];
    P.twist = s * lerp(-0.3, 0.35, t);
    P.tilt += 0.15 * reach;
    P.rootF = lunge * 0.6;
    P.smear = reach > 0.6 ? side : null;
    P.feet[0][1] = 3; P.feet[1][1] = -3;
    return;
  }
  // melee swings: keyframes of [hand s, f, z(rel shoulder), pitch, yaw, twist, tilt]
  const heavy = st === 'heavy' || st === 'pole';
  const K = heavy ? [
    [sh - 2, 2, -4, 2.6, 0.3, -0.15, -0.05],
    [sh * 0.4, -1, 10, 3.5, 0.15, -0.25, -0.15],
    [sh * 0.3, 2, 14, 3.7, 0.05, -0.3, -0.2],
    [sh * 0.2, 12, 6, 2.0, 0, 0, 0.15],
    [sh * 0.1, 15, -12, 0.75, 0, 0.12, 0.35],
    [sh * 0.1, 14, -16, 0.45, 0, 0.12, 0.32],
    [sh * 0.4, 9, -12, 0.9, 0.2, 0.05, 0.15],
    [sh - 1, 6, -9, 1.6, 0.3, 0, 0.05],
  ] : [
    [sh + 1, -1, -6, 2.0, 0.5, -0.25, 0],
    [sh + 1, -4, 6, 2.9, 0.4, -0.45, -0.1],
    [sh - 1, 0, 9, 2.6, 0.2, -0.35, -0.08],
    [sh - 2, 11, 1, 1.65, -0.3, 0.1, 0.12],
    [2, 15, -12, 1.15, -0.8, 0.38, 0.22],
    [-3, 11, -17, 0.75, -1.2, 0.48, 0.2],
    [sh - 3, 7, -16, 0.85, -0.2, 0.2, 0.1],
    [sh, 4, -18, 0.95, 0.1, 0.05, 0.04],
  ];
  const k = K[f];
  P.hands[0] = [k[0], k[1], up + k[2]];
  P.wp = [k[3], k[4]];
  P.twist = k[5];
  P.tilt += k[6];
  P.rootF = lunge;
  P.smear = (f === 3 || f === 4 || f === 5) ? 0 : null;
  P.smearKeys = K;
  P.feet[0] = [B.hipW + 0.8, lunge > 2 ? 5 : 1.5, 0];
  P.feet[1] = [-B.hipW - 0.8, lunge > 2 ? -5.5 : -1.5, 0];
  if (heavy) {
    P.two = true;
  } else if (L.offhand === 'shield' || L.offhand === 'buckler') {
    P.hands[1] = [-sh * 0.6, 9, up - 15];
  } else {
    P.hands[1] = [-sh - 2, lerp(-2, 4, lunge / 5), up - 18 + lunge];
  }
}

/**
 * The posed skeleton in actor space (s right, f forward, z up), shared by the 3D renderer so
 * both renderers animate identically: legs {hip, knee, ankle}, arms {shoulder, elbow, hand},
 * neck, head centre, weapon direction wd, and U() mapping upper-body space to actor space.
 */
export function humanoidSkeleton(L, anim, f) {
  const B = BUILDS[L.sil];
  const P = humanoidPose(L, anim, f);
  const tw = P.twist;
  const tl = P.tilt;
  const rootF = P.rootF;
  const pelvisZ = B.hipZ - 0.6 + P.rootZ - P.crouch;
  const waistZ = B.waistZ - (B.hipZ - pelvisZ);
  const cosT = Math.cos(tw); const sinT = Math.sin(tw);
  const cosL = Math.cos(tl); const sinL = Math.sin(tl);
  const U = (p) => {
    const s1 = p[0] * cosT - p[1] * sinT;
    const f1 = p[0] * sinT + p[1] * cosT;
    return [s1, f1 + p[2] * sinL + rootF, waistZ + p[2] * cosL];
  };
  const up = B.shZ - B.waistZ;
  const legs = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const hip = [side * B.hipW, rootF * 0.6, pelvisZ];
    const ft = P.feet[i];
    const ankle = [ft[0], ft[1] + rootF * 0.5, ft[2] + 2.2];
    const knee = ik(hip, ankle, B.thigh, B.shin, [side * 0.12, 1, 0]);
    legs.push({ side, hip, knee, ankle, lift: ft[2] });
  }
  const wd = U2dir(U, wdir(P.wp[0], P.wp[1]));
  const arms = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const shoulder = U([side * B.sh, 0, up - 1.5]);
    let target;
    if (i === 1 && P.two) target = add(U(P.hands[0]), mul(wd, L.weapon === 'rifle' ? 9 : -5.5));
    else target = U(P.hands[i]);
    const elbow = ik(shoulder, target, B.arm[0], B.arm[1], [side * 0.8, -0.7, -0.4]);
    arms.push({ side, shoulder, elbow, hand: target });
  }
  const neck = U([0, 0.6, up + 2.5]);
  const headC = U([0, 0.9, up + 2.5 + B.head * 0.95]);
  return { B, P, U, legs, arms, neck, headC, wd, pelvisZ, waistZ, up, rootF, tw, tl };
}

/* ------------------------------------------------------------------ humanoid build */

function buildHumanoid(X, P) {
  const { L, V } = X;
  const B = BUILDS[L.sil];
  const robe = L.sil === 'robed';
  const plate = L.armor === 'plate';
  const bare = L.armor === 'none';
  const tw = P.twist;
  const tl = P.tilt;
  const rootF = P.rootF;
  const pelvisZ = B.hipZ - 0.6 + P.rootZ - P.crouch;
  const waistZ = B.waistZ - (B.hipZ - pelvisZ);
  const cosT = Math.cos(tw); const sinT = Math.sin(tw);
  const cosL = Math.cos(tl); const sinL = Math.sin(tl);
  /** upper-body space (relative to waist centre) -> actor space */
  const U = (p) => {
    const s1 = p[0] * cosT - p[1] * sinT;
    const f1 = p[0] * sinT + p[1] * cosT;
    const f2 = f1 + p[2] * sinL;
    const z2 = p[2] * cosL;
    return [s1, f2 + rootF, waistZ + z2];
  };
  const pr = (p) => proj(V, p);
  const fy = V.F[1];
  const frontVis = fy > -0.3;
  const up = B.shZ - B.waistZ;
  const ops = X.ops;
  const op = (d, fn) => ops.push({ d, fn });

  /* ---- legs (IK). Always behind the torso group; ordered among themselves. */
  const legs = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const hip = [side * B.hipW, rootF * 0.6, pelvisZ];
    const ft = P.feet[i];
    const ankle = [ft[0], ft[1] + rootF * 0.5, ft[2] + 2.2];
    const knee = ik(hip, ankle, B.thigh, B.shin, [side * 0.12, 1, 0]);
    legs.push({ side, hip, knee, ankle });
  }
  for (const lg of legs) {
    const dd = pr(lg.knee).d * 0.01 - 30;
    op(dd, (g) => drawLeg(g, X, B, lg, robe));
  }

  /* ---- cloak (behind torso unless seen from behind) */
  if (L.cloak !== 'none' && !robe) {
    const cd = pr(U([0, -B.chest[1] - 2, up * 0.4])).d;
    op(cd < 1.5 ? -20 : 8 + cd * 0.01, (g) => drawCloak(g, X, B, U, P, waistZ)); // pure profile: behind
  }

  /* ---- torso group */
  op(0, (g) => {
    if (robe) drawRobe(g, X, B, U, P, legs, waistZ);
    else drawFauld(g, X, B, U, P);
    drawTorso(g, X, B, U, P);
  });

  /* ---- arms */
  const sh = B.sh;
  const arms = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const shoulder = U([side * sh, 0, up - 1.5]);
    let target;
    if (i === 1 && P.two) {
      const hand0 = U(P.hands[0]);
      const wd = U2dir(U, wdir(P.wp[0], P.wp[1]));
      target = add(hand0, mul(wd, L.weapon === 'rifle' ? 9 : -5.5));
    } else target = U(P.hands[i]);
    const elbow = ik(shoulder, target, B.arm[0], B.arm[1], [side * 0.8, -0.7, -0.4]);
    const hand = target;
    arms.push({ side, shoulder, elbow, hand });
  }
  const armD = (a) => (pr(a.shoulder).d + pr(a.hand).d * 0.6) / 1.6;
  for (const a of arms) {
    const d = armD(a);
    op(d + 0.2, (g) => drawArm(g, X, B, a, bare));
    if (!robe || L.armor === 'plate') {
      op(pr(a.shoulder).d + 0.6 + (a.side === 1 ? 0.01 : 0), (g) => drawPauldron(g, X, B, a, U));
    }
  }

  /* ---- head */
  const neck = U([0, 0.6, up + 2.5]);
  const headC = U([0, 0.9, up + 2.5 + B.head * 0.95]);
  const headUp = norm(sub(headC, neck));
  op(pr(headC).d + 1.5, (g) => drawHead(g, X, B, headC, headUp, U, P));

  /* ---- weapon (right hand) and offhand */
  const wd = U2dir(U, wdir(P.wp[0], P.wp[1]));
  const hand = arms[0].hand;
  if (L.weapon !== 'none') {
    const wl = weaponLen(L.weapon);
    const mid = add(hand, mul(wd, wl * 0.4));
    const wD = pr(mid).d;
    const aD = armD(arms[0]);
    op(wD + 0.3, (g) => drawWeapon(g, X, hand, wd, P, U));
    if (wD + 0.3 > aD + 0.2) op(wD + 0.31, (g) => drawFist(g, X, B, arms[0], bare));
    if (P.two && L.weapon !== 'claws') op(Math.max(wD + 0.32, armD(arms[1]) + 0.2), (g) => drawFist(g, X, B, arms[1], bare));
  }
  if (L.offhand !== 'none' && !P.two) {
    const lh = arms[1].hand;
    op(pr(lh).d + 0.5, (g) => drawOffhand(g, X, B, lh, U, P));
  }

  /* ---- motion smear */
  if (P.smear !== null && P.smear !== undefined && P.smearKeys) {
    const K = P.smearKeys;
    const f = X.f;
    X.after.push((c) => drawSmear(c, X, B, K, f, U, P));
  }
  if (P.smear !== null && P.smear !== undefined && !P.smearKeys) {
    const a = arms[P.smear];
    X.after.push((c) => clawSmear(c, X, a));
  }

  /* ---- glows (registered each frame by drawActor) */
  if (L.glow) {
    const hc = pr(headC);
    if (frontVis) X.glows.push({ x: hc.x, y: hc.y, r: 9, color: L.glow, a: 0.28 });
    if (BLADE_GLOW.has(L.weapon)) {
      const m = pr(add(hand, mul(wd, weaponLen(L.weapon) * 0.6)));
      X.glows.push({ x: m.x, y: m.y, r: 13, color: L.glow, a: 0.22 });
    }
  }
  if (P.muzzle) {
    const m = pr(add(hand, mul(wd, weaponLen(L.weapon) + 2)));
    X.glows.push({ x: m.x, y: m.y, r: 26, color: L.glow || '#ffe2a0', a: 0.85 });
  }
  if (P.cast > 0) {
    const ch = L.weapon === 'staff' ? add(hand, mul(wd, 26)) : lerp3(arms[0].hand, arms[1].hand, 0.5);
    const m = pr(ch);
    X.glows.push({ x: m.x, y: m.y, r: 16 + 14 * P.cast, color: L.glow || light(L.trim, 0.3), a: 0.45 + 0.4 * P.cast });
  }
}

export const BLADE_GLOW = new Set(['sword', 'katana', 'greatsword', 'dagger', 'blade', 'staff', 'wand', 'spear']);

/** Rotate a direction from upper-body space into actor space (no translation). */
export function U2dir(U, d) {
  const o = U([0, 0, 0]);
  return norm(sub(U(d), o));
}

/* ------------------------------------------------------------------ part painters */

function drawLeg(g, X, B, lg, robe) {
  const { L, V } = X;
  const plate = L.armor === 'plate';
  const bare = L.armor === 'none';
  const h = proj(V, lg.hip); const k = proj(V, lg.knee); const a = proj(V, lg.ankle);
  const thighC = bare ? L.skin : L.under;
  const shinC = plate ? L.body : (bare ? L.skin : L.leather);
  if (!robe) capsule(g, h.x, h.y, k.x, k.y, B.legR[0], B.legR[0] * 0.82, thighC, 0.25, 0.55);
  // greave / shin
  capsule(g, k.x, k.y, a.x, a.y, B.legR[1] * (plate ? 1.08 : 0.95), B.legR[1] * 0.78, shinC, plate ? 0.45 : 0.25, 0.55);
  if (plate && !robe) {
    // knee cop
    const kr = B.legR[0] * 0.78;
    g.fillStyle = litRadial(g, k.x, k.y - 0.5, kr, L.body, 0.55, 0.45);
    g.beginPath(); g.ellipse(k.x, k.y - 0.5, kr, kr * 0.85, 0, 0, TAU); g.fill();
    g.fillStyle = rgba(L.glow || L.trim, 0.9);
    g.fillRect(k.x - kr * 0.7, k.y + kr * 0.4, kr * 1.4, 0.8);
  }
  // boot: heel -> toe along the facing
  const heel = proj(V, [lg.ankle[0], lg.ankle[1] - 1.6, Math.max(1.3, lg.ankle[2] - 1.3)]);
  const toe = proj(V, [lg.ankle[0], lg.ankle[1] + 4.6, Math.max(1.0, lg.ankle[2] - 1.7)]);
  const bootC = bare ? dark(L.skin, 0.7) : dark(L.leather, 0.85);
  capsule(g, a.x, a.y - 1, heel.x, heel.y, B.legR[1] * 0.95, B.legR[1] * 0.9, bootC, 0.25, 0.5);
  capsule(g, heel.x, heel.y, toe.x, toe.y, B.legR[1] * 0.9, B.legR[1] * 0.7, bootC, 0.3, 0.5);
  if (!bare) {
    g.strokeStyle = rgba(L.trim, 0.85);
    strokePts(g, [[a.x - B.legR[1], a.y - 2.4], [a.x + B.legR[1], a.y - 2.4]], 0.9);
  }
}

/** Points of a horizontal ellipse ring (upper-body space) projected; returns [{x,y,d}]. */
function ring(V, U, a, b, z, n = 20, fOff = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    pts.push(proj(V, U([a * Math.cos(t), b * Math.sin(t) + fOff, z])));
  }
  return pts;
}

/** Shaded elliptic frustum stack; rings = [[a,b,z,fOff?],...] in upper-body space. */
function frustum(g, V, U, rings, color, hi, lo, spec) {
  const pts = [];
  for (const r of rings) for (const p of ring(V, U, r[0], r[1], r[2], 22, r[3] || 0)) pts.push([p.x, p.y]);
  const H = hull(pts);
  const bb = bbox(H);
  g.fillStyle = litH(g, bb.x0, bb.x1, color, hi, lo);
  fillPts(g, H);
  // vertical ambient: darker toward the bottom
  const vg = g.createLinearGradient(0, bb.y0, 0, bb.y1);
  vg.addColorStop(0, 'rgba(255,255,255,0.06)');
  vg.addColorStop(0.6, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = vg;
  fillPts(g, H);
  if (spec) {
    const sx = lerp(bb.x0, bb.x1, 0.3);
    const sgr = g.createLinearGradient(sx - 2.5, 0, sx + 2.5, 0);
    sgr.addColorStop(0, 'rgba(255,255,255,0)');
    sgr.addColorStop(0.5, `rgba(255,255,255,${spec})`);
    sgr.addColorStop(1, 'rgba(255,255,255,0)');
    g.save();
    g.beginPath();
    g.moveTo(H[0][0], H[0][1]);
    for (const q of H) g.lineTo(q[0], q[1]);
    g.closePath();
    g.clip();
    g.fillStyle = sgr;
    g.fillRect(sx - 2.5, bb.y0, 5, bb.y1 - bb.y0);
    g.restore();
  }
  return H;
}

/** Stroke the front-facing half of a ring (a band around the body). */
function bandFront(g, V, U, a, b, z, color, width, fOff = 0) {
  const pts = ring(V, U, a, b, z, 28, fOff);
  const c0 = proj(V, U([0, fOff, z]));
  const seg = [];
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let i = 0; i <= pts.length; i++) {
    const p = pts[i % pts.length];
    if (p.d >= c0.d - 0.05) seg.push([p.x, p.y]);
    else if (seg.length) { strokePts(g, seg, width); seg.length = 0; }
  }
  if (seg.length) strokePts(g, seg, width);
}

/**
 * Decal transform on a body surface: origin at upper-body point o, x axis along the body's
 * right (R), y axis down. Draw in local px; returns false when the surface faces away.
 */
function decal(g, V, U, o, facing = 1) {
  const O = proj(V, U(o));
  const Rp = proj(V, U([o[0] + 1, o[1], o[2]]));
  const Dn = proj(V, U([o[0], o[1], o[2] - 1]));
  const n = proj(V, U([o[0], o[1] + facing, o[2]]));
  if ((n.d - O.d) * 1 < -0.15) return false;
  g.transform(Rp.x - O.x, Rp.y - O.y, Dn.x - O.x, Dn.y - O.y, O.x, O.y);
  return true;
}

function drawFauld(g, X, B, U, P) {
  const { L, V } = X;
  const plate = L.armor === 'plate';
  const bare = L.armor === 'none';
  const hipDrop = B.waistZ - B.hipZ;
  const wa = B.waist[0]; const wb = B.waist[1];
  if (bare) {
    // ragged loincloth
    frustum(g, V, U, [[wa + 0.3, wb + 0.3, 0], [wa + 1.2, wb + 1, -hipDrop - 4]], dark(L.trim, 0.8), 0.15, 0.5);
    return;
  }
  // hips / fauld
  const fc = plate ? L.body : L.leather;
  frustum(g, V, U, [[wa + 0.6, wb + 0.6, 0.5], [wa + 2.2, wb + 1.6, -hipDrop - 7]], fc, plate ? 0.4 : 0.2, 0.55, plate ? 0.25 : 0);
  if (plate) {
    for (let i = 1; i <= 2; i++) bandFront(g, V, U, wa + 0.6 + i * 0.55, wb + 0.6 + i * 0.35, -i * 3.6, rgba(dark(L.body, 0.35), 0.8), 0.7);
  }
  // tabard panels (front and back) swinging with the walk
  const sway = (P.feet[0][1] - P.feet[1][1]) * 0.12;
  const tab = L.cloak !== 'none' ? L.cloakC : dark(L.trim, 0.75);
  for (const side of [1, -1]) {
    g.save();
    if (decal(g, V, U, [0, side * (wb + 1.6), 0], side)) {
      const lenT = hipDrop + 11;
      const grd = g.createLinearGradient(0, 0, 0, lenT);
      grd.addColorStop(0, light(tab, 0.12));
      grd.addColorStop(1, dark(tab, 0.55));
      g.fillStyle = grd;
      fillPts(g, [[-3.6, -1], [3.6, -1], [3.4 + sway, lenT - 1], [0.5 + sway, lenT + 1], [-3.2 + sway, lenT - 0.5]]);
      g.fillStyle = rgba(L.glow || L.accent, 0.85);
      g.fillRect(-3.6, -1, 7.2, 1);
      if (side === 1) {
        g.strokeStyle = rgba(L.glow || L.accent, 0.5);
        strokePts(g, [[-2.4, 1.5], [-2.2 + sway, lenT - 2]], 0.5);
        strokePts(g, [[2.4, 1.5], [2.3 + sway, lenT - 2]], 0.5);
      }
    }
    g.restore();
  }
}

function drawTorso(g, X, B, U, P) {
  const { L, V } = X;
  const plate = L.armor === 'plate';
  const bare = L.armor === 'none';
  const cloth = L.armor === 'cloth';
  const up = B.shZ - B.waistZ;
  const [ca, cb] = B.chest;
  const [wa, wb] = B.waist;
  const tc = bare ? L.skin : (cloth ? L.body : L.body);
  frustum(g, V, U, [
    [wa, wb, -1],
    [ca * 0.92, cb, up * 0.45],
    [ca, cb * 1.02, up * 0.78],
    [B.sh * 0.78, cb * 0.85, up + 0.5],
  ], tc, plate ? 0.5 : 0.28, plate ? 0.6 : 0.5, plate ? 0.32 : (cloth ? 0 : 0.1));
  // gorget / collar
  frustum(g, V, U, [[B.sh * 0.45, cb * 0.6, up], [B.head * 0.75, B.head * 0.7, up + 3]], plate ? L.body : L.under, 0.4, 0.6);

  // front details
  g.save();
  if (decal(g, V, U, [0, cb * 0.98, up * 0.62], 1)) {
    const em = L.glow;
    if (bare) {
      g.strokeStyle = rgba(dark(L.skin, 0.45), 0.7);
      strokePts(g, [[0, -5], [0, 6]], 0.7);
      strokePts(g, [[-5, -3], [-1, -1], [-5, 1]], 0.6);
      strokePts(g, [[5, -3], [1, -1], [5, 1]], 0.6);
      if (em) { g.fillStyle = em; g.fillRect(-0.6, -2, 1.2, 6); }
    } else if (plate) {
      // breastplate: centre ridge, pec edges, abdominal lames
      g.strokeStyle = rgba(light(L.body, 0.6), 0.6);
      strokePts(g, [[0, -7.5], [0, 7]], 0.8);
      g.strokeStyle = rgba(dark(L.body, 0.3), 0.8);
      strokePts(g, [[-ca + 1.2, -2], [-2, 2.6], [0, 3.2], [2, 2.6], [ca - 1.2, -2]], 0.8);
      g.strokeStyle = rgba(em || L.trim, em ? 1 : 0.85);
      strokePts(g, [[-ca * 0.62, -8.5], [0, -6], [ca * 0.62, -8.5]], em ? 1 : 1.1);
      if (em) {
        strokePts(g, [[-3.5, 0.5], [-1.2, 4.6]], 0.8);
        strokePts(g, [[3.5, 0.5], [1.2, 4.6]], 0.8);
      }
      rivet(g, -ca * 0.62, -6.4, 0.65, L.accent);
      rivet(g, ca * 0.62, -6.4, 0.65, L.accent);
    } else {
      // jerkin / robe: crossing straps and a front seam
      g.strokeStyle = rgba(L.leather, 0.95);
      strokePts(g, [[-ca * 0.7, -8], [ca * 0.5, 7]], 1.7);
      g.strokeStyle = rgba(em || L.trim, 0.95);
      strokePts(g, [[0, -8], [0, 8]], em ? 0.9 : 0.8);
      if (cloth) {
        strokePts(g, [[-ca * 0.8, -8.5], [0, -2], [ca * 0.8, -8.5]], 1.1);
      }
      if (em) strokePts(g, [[ca * 0.25, -5], [ca * 0.6, -5], [ca * 0.6, -1]], 0.7);
    }
  }
  g.restore();
  // back details
  g.save();
  if (decal(g, V, U, [0, -cb * 0.98, up * 0.62], -1)) {
    g.strokeStyle = rgba(plate ? light(L.body, 0.5) : dark(tc, 0.5), 0.6);
    strokePts(g, [[0, -7], [0, 7]], 0.8);
    if (L.glow) {
      g.strokeStyle = L.glow;
      strokePts(g, [[-2.5, -4], [-2.5, 3]], 0.7);
      strokePts(g, [[2.5, -4], [2.5, 3]], 0.7);
    }
  }
  g.restore();
  // belt
  if (!bare) {
    bandFront(g, V, U, wa + 0.45, wb + 0.45, 0.3, dark(L.leather, 0.8), 2.4);
    bandFront(g, V, U, wa + 0.5, wb + 0.5, 1.2, rgba(light(L.leather, 0.25), 0.5), 0.5);
    g.save();
    if (decal(g, V, U, [0, wb + 0.55, 0.4], 1)) {
      g.fillStyle = L.glow || L.accent;
      g.fillRect(-1.6, -1.4, 3.2, 2.8);
      g.fillStyle = dark(L.accent, 0.5);
      g.fillRect(-0.6, -0.6, 1.2, 1.2);
    }
    g.restore();
    // side pouch
    g.save();
    if (decal(g, V, U, [-wa * 0.75, wb * 0.75, -1.5], 1)) {
      g.fillStyle = litH(g, -1.8, 1.8, L.leather, 0.3, 0.5);
      g.fillRect(-1.8, -0.5, 3.6, 3.6);
    }
    g.restore();
  }
}

function drawCloak(g, X, B, U, P, waistZ) {
  const { L, V } = X;
  const up = B.shZ - B.waistZ;
  const cb = B.chest[1];
  const long = L.cloak === 'long' || L.cloak === 'tattered';
  const bottomZ = (long ? 4 : 18) - waistZ; // relative to waist (upper-body z)
  const walkSway = Math.abs(P.feet[0][1] - P.feet[1][1]) * 0.25;
  const trail = Math.min(6, 1.5 + walkSway + Math.max(0, P.rootF) * 0.5 + Math.max(0, P.tilt) * 6);
  // rows from the shoulders down; each row is a half-ellipse wrapped behind the body.
  // Depth stays close to the chest so the profile view reads as drape, not a board.
  // `back` pushes a row's side edges behind the body so in profile the drape hangs behind the
  // legs instead of covering them.
  const rows = [
    { z: up + 0.8, w: B.sh - 1.2, dep: cb * 0.8, back: 0, f: 0 },
    { z: up * 0.4, w: B.sh + 1.0, dep: cb * 0.9 + 0.8, back: cb * 0.45, f: -trail * 0.35 },
    { z: bottomZ, w: B.sh + 2.6, dep: cb * 0.95 + 1.4, back: cb * 0.65, f: -trail },
  ];
  const N = 9;
  const grid = rows.map((r) => {
    const out = [];
    for (let i = 0; i <= N; i++) {
      const t = -PI / 2 + (i / N) * PI; // -90..90 deg around the back
      out.push(proj(V, U([r.w * Math.sin(t), -r.back - (r.dep - r.back) * Math.cos(t) + r.f, r.z])));
    }
    return out;
  });
  const inside = V.F[1] > 0.25; // seeing the lining between the legs
  const all = [];
  for (const row of grid) for (const p of row) all.push([p.x, p.y]);
  // hem with jags for tattered cloaks
  const hem = grid[2].map((p, i) => [p.x, p.y + (L.cloak === 'tattered' ? (i % 2 ? 3.2 : -0.4) : 0)]);
  for (const q of hem) all.push(q);
  const H = hull(all);
  const bb = bbox(H);
  const base = inside ? dark(L.cloakC, 0.6) : L.cloakC;
  g.save();
  g.beginPath();
  g.moveTo(H[0][0], H[0][1]);
  for (const q of H) g.lineTo(q[0], q[1]);
  g.closePath();
  if (L.cloak === 'tattered') {
    // carve notches out of the hem
    g.clip();
    g.fillStyle = litH(g, bb.x0, bb.x1, base, 0.22, 0.55);
    g.fillRect(bb.x0 - 1, bb.y0 - 1, bb.x1 - bb.x0 + 2, bb.y1 - bb.y0 + 2);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 1; i < hem.length; i += 2) {
      g.beginPath(); g.moveTo(hem[i - 1][0], hem[i - 1][1] + 4); g.lineTo(hem[i][0], hem[i][1] - 3.5); g.lineTo(hem[Math.min(hem.length - 1, i + 1)][0], hem[Math.min(hem.length - 1, i + 1)][1] + 4); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  } else {
    g.fillStyle = litH(g, bb.x0, bb.x1, base, 0.22, 0.55);
    g.fill();
    g.clip();
  }
  const vg = g.createLinearGradient(0, bb.y0, 0, bb.y1);
  vg.addColorStop(0, 'rgba(255,255,255,0.05)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = vg;
  g.fillRect(bb.x0 - 1, bb.y0 - 1, bb.x1 - bb.x0 + 2, bb.y1 - bb.y0 + 2);
  // vertical folds: follow grid columns that face the viewer
  for (let i = 1; i < N; i += 2) {
    const col = grid.map((row) => row[i]);
    if (!inside && col[1].d < proj(V, U([0, 0, up * 0.4])).d - 0.5 && V.F[1] > 0.25) continue;
    g.strokeStyle = rgba(dark(base, 0.35), 0.5);
    strokePts(g, col.map((p) => [p.x + 0.4, p.y]), 1.1);
    g.strokeStyle = rgba(light(base, 0.25), 0.25);
    strokePts(g, col.map((p) => [p.x - 0.7, p.y]), 0.6);
  }
  g.restore();
  if (!inside) {
    // hem trim on the near half of the bottom ring only
    const cd = proj(V, U([0, -rows[2].dep * 0.5 + rows[2].f, rows[2].z])).d;
    g.strokeStyle = rgba(L.glow || L.trim, L.glow ? 0.95 : 0.7);
    let seg = [];
    for (let i = 0; i < hem.length; i++) {
      if (grid[2][i].d >= cd - 0.3) seg.push(hem[i]);
      else { if (seg.length > 1) strokePts(g, seg, 0.9); seg = []; }
    }
    if (seg.length > 1) strokePts(g, seg, 0.9);
  }
}

function drawRobe(g, X, B, U, P, legs, waistZ) {
  const { L, V } = X;
  const sway = (P.feet[0][1] - P.feet[1][1]) * 0.18;
  const hemZ = 1 - waistZ;
  const H = frustum(g, V, U, [
    [B.waist[0] + 0.5, B.waist[1] + 0.5, 0.5],
    [B.waist[0] + 3, B.waist[1] + 2.4, -12],
    [B.waist[0] + 6.5, B.waist[1] + 5.4, hemZ, sway],
  ], L.body, 0.25, 0.6);
  // hem band (front half) and front opening
  bandFront(g, V, U, B.waist[0] + 6.4, B.waist[1] + 5.3, hemZ + 1.2, L.glow || L.trim, 1.6, sway);
  g.save();
  if (decal(g, V, U, [0, B.waist[1] + 0.6, 0], 1)) {
    g.fillStyle = dark(L.body, 0.45);
    const bot = -hemZ - 1;
    fillPts(g, [[-0.8, 0], [0.8, 0], [3.2 + sway * 0.3, bot], [-3.2 + sway * 0.3, bot]]);
    g.strokeStyle = rgba(L.glow || L.trim, 0.9);
    strokePts(g, [[-0.9, 0], [-3.3 + sway * 0.3, bot]], 0.8);
    strokePts(g, [[0.9, 0], [3.3 + sway * 0.3, bot]], 0.8);
  }
  g.restore();
  // toes peeking out under the hem
  for (const lg of legs) {
    const toe = proj(V, [lg.ankle[0], lg.ankle[1] + 4.6, 1.2]);
    const toeD = (lg.ankle[1] + 4) * V.F[1] + lg.ankle[0] * V.R[1];
    if (toeD > B.waist[1] + 2) {
      g.fillStyle = litRadial(g, toe.x, toe.y, 2.6, dark(L.leather, 0.8));
      g.beginPath(); g.ellipse(toe.x, toe.y, 2.6, 1.6, 0, 0, TAU); g.fill();
    }
  }
  return H;
}

function drawArm(g, X, B, a, bare) {
  const { L, V } = X;
  const plate = L.armor === 'plate';
  const robe = L.sil === 'robed';
  const s = proj(V, a.shoulder); const e = proj(V, a.elbow); const h = proj(V, a.hand);
  const upC = bare ? L.skin : (robe ? L.body : (plate ? mix(L.under, L.body, 0.35) : L.under));
  capsule(g, s.x, s.y, e.x, e.y, B.armR[0], B.armR[0] * 0.85, upC, 0.28, 0.55);
  const foreC = bare ? L.skin : (plate ? L.body : (robe ? L.body : L.leather));
  if (robe) {
    // wide sleeve
    capsule(g, e.x, e.y, lerp(e.x, h.x, 0.8), lerp(e.y, h.y, 0.8), B.armR[0] * 0.95, B.armR[0] * 1.35, foreC, 0.25, 0.55);
    g.fillStyle = L.glow || L.trim;
    const cx = lerp(e.x, h.x, 0.8); const cy = lerp(e.y, h.y, 0.8);
    g.beginPath(); g.ellipse(cx, cy, B.armR[0] * 1.1, B.armR[0] * 0.6, Math.atan2(h.y - e.y, h.x - e.x) + PI / 2, 0, TAU); g.fill();
  } else {
    capsule(g, e.x, e.y, h.x, h.y, B.armR[1] * (plate ? 1.15 : 1), B.armR[1] * (plate ? 1.0 : 0.85), foreC, plate ? 0.5 : 0.28, 0.55);
    if (plate) {
      sphere(g, e.x, e.y, B.armR[0] * 0.85, L.body, 0.55, 0.45);
    }
    if (!bare) {
      // cuff
      const cx = lerp(e.x, h.x, 0.72); const cy = lerp(e.y, h.y, 0.72);
      g.strokeStyle = rgba(L.glow || L.trim, 0.9);
      const ang = Math.atan2(h.y - e.y, h.x - e.x) + PI / 2;
      const r = B.armR[1] * 1.1;
      strokePts(g, [[cx - Math.cos(ang) * r, cy - Math.sin(ang) * r], [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]], 0.9);
    }
  }
  drawFist(g, X, B, a, bare);
}

function drawFist(g, X, B, a, bare) {
  const { L, V } = X;
  const h = proj(V, a.hand);
  const c = bare ? L.skin : (L.armor === 'plate' ? dark(L.body, 0.85) : dark(L.leather, 0.9));
  sphere(g, h.x, h.y, B.armR[1] * 0.95, c, 0.4, 0.5);
  if (L.weapon === 'claws' && a.side === 1 || (L.weapon === 'claws' && L.sil !== 'robed')) {
    // talons
    const e = proj(V, a.elbow);
    let dx = h.x - e.x; let dy = h.y - e.y;
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    g.strokeStyle = L.glow || light(L.accent, 0.3);
    g.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const px = -dy * i * 1.4; const py = dx * i * 1.4;
      strokePts(g, [[h.x + px, h.y + py], [h.x + px + dx * 4.5 + px * 0.4, h.y + py + dy * 4.5 + py * 0.4 + 0.6]], 0.9);
    }
  }
}

function drawPauldron(g, X, B, a, U) {
  const { L, V } = X;
  const plate = L.armor === 'plate';
  const bare = L.armor === 'none';
  if (bare) return;
  const r = B.pauld * (plate ? 1 : 0.8);
  const robe = L.sil === 'robed';
  const c = proj(V, add(a.shoulder, [0, 0, 1.2]));
  const col = robe ? L.body : (plate ? L.body : L.leather);
  // dome
  g.fillStyle = litRadial(g, c.x, c.y, r, col, plate ? 0.6 : 0.3, 0.5);
  g.beginPath();
  g.ellipse(c.x, c.y, r * 1.02, r * 0.88, 0, 0, TAU);
  g.fill();
  if (plate) {
    // lames hanging below the dome
    for (let i = 1; i <= 2; i++) {
      const yy = c.y + r * 0.55 + i * 1.7;
      g.fillStyle = litH(g, c.x - r, c.x + r, dark(L.body, 0.92 - i * 0.08), 0.4, 0.55);
      g.beginPath();
      g.ellipse(c.x, yy - 1, r * (0.95 - i * 0.12), 1.9, 0, 0, PI);
      g.fill();
    }
    g.strokeStyle = rgba(L.glow || L.trim, L.glow ? 1 : 0.9);
    g.lineWidth = L.glow ? 0.9 : 1.1;
    g.beginPath();
    g.ellipse(c.x, c.y + 0.6, r * 0.98, r * 0.78, 0, 0.15 * PI, 0.85 * PI);
    g.stroke();
    rivet(g, c.x + LIGHT_X * r * 0.25, c.y + LIGHT_Y * r * 0.2, 0.7, L.accent);
  } else {
    g.strokeStyle = rgba(L.glow || L.trim, 0.8);
    g.lineWidth = 0.8;
    g.beginPath();
    g.ellipse(c.x, c.y + 0.5, r * 0.98, r * 0.8, 0, 0.1 * PI, 0.9 * PI);
    g.stroke();
  }
}

function drawHead(g, X, B, hc, hu, U, P) {
  const { L, V } = X;
  const r = B.head;
  const c = proj(V, hc);
  const fy = V.F[1];
  const helm = L.helm === 'mask' ? 'visor' : (L.helm === 'goggles' ? 'open' : L.helm);
  const plateC = L.armor === 'none' ? L.skin : L.body;
  const eyeC = L.glow || null;
  // face-forward decal helper: origin on the face surface
  const face = (fn, depth = r * 0.92, z = 0) => {
    g.save();
    // build a decal frame at the head: right = R, down = -z, at hc + forward*depth
    const o = add(hc, [0, 0, z]);
    const fw = U2dirLocal(U, [0, 1, 0]);
    const rt = U2dirLocal(U, [1, 0, 0]);
    const O = proj(V, add(o, mul(fw, depth)));
    const Rp = proj(V, add(add(o, mul(fw, depth)), rt));
    const Dn = proj(V, add(add(o, mul(fw, depth)), [0, 0, -1]));
    const N = proj(V, add(o, mul(fw, depth + 1)));
    if (N.d - O.d > -0.25) {
      g.transform(Rp.x - O.x, Rp.y - O.y, Dn.x - O.x, Dn.y - O.y, O.x, O.y);
      fn();
    }
    g.restore();
  };
  if (helm === 'hood') {
    // cowl: bigger than the head, peaked behind
    const cr = r * 1.3;
    const back = proj(V, add(hc, add(mul(U2dirLocal(U, [0, -1, 0]), r * 0.9), [0, 0, r * 0.9])));
    const pts = [];
    for (let i = 0; i < 18; i++) {
      const t = (i / 18) * TAU;
      pts.push([c.x + Math.cos(t) * cr, c.y + 0.6 + Math.sin(t) * cr * 1.05]);
    }
    pts.push([back.x, back.y - 1.5]);
    const H = hull(pts);
    const bb = bbox(H);
    g.fillStyle = litH(g, bb.x0, bb.x1, L.cloakC, 0.3, 0.55);
    fillPts(g, H);
    face(() => {
      g.fillStyle = 'rgba(6,5,8,0.95)';
      g.beginPath(); g.ellipse(0, 0.8, r * 0.72, r * 0.82, 0, 0, TAU); g.fill();
      g.fillStyle = eyeC || 'rgba(200,190,170,0.55)';
      g.fillRect(-2.2, -0.2, 1.4, 0.9);
      g.fillRect(0.8, -0.2, 1.4, 0.9);
    }, r * 0.55, 0);
    // hood rim
    g.strokeStyle = rgba(L.glow || L.trim, 0.7);
    g.lineWidth = 0.8;
    if (fy > -0.3) {
      face(() => {
        g.beginPath(); g.ellipse(0, 0.6, r * 0.86, r * 0.98, 0, PI * 1.05, PI * 1.95); g.stroke();
      }, r * 0.62, 0);
    }
    return;
  }
  const skull = helm === 'bare' || helm === 'open' ? L.skin : plateC;
  g.fillStyle = litRadial(g, c.x, c.y, r * 1.05, helm === 'bare' ? L.skin : (helm === 'open' ? L.skin : plateC), 0.55, 0.55);
  g.beginPath(); g.ellipse(c.x, c.y, r, r * 1.08, 0, 0, TAU); g.fill();
  if (helm === 'bare') {
    face(() => {
      g.fillStyle = eyeC || 'rgba(20,10,10,0.9)';
      g.fillRect(-2.6, -0.8, 1.7, eyeC ? 1.1 : 1.3);
      g.fillRect(0.9, -0.8, 1.7, eyeC ? 1.1 : 1.3);
      g.fillStyle = rgba(dark(L.skin, 0.4), 0.8);
      g.fillRect(-1.6, 2.4, 3.2, 0.7);
    }, r * 0.9, 0);
    // scalp / hair in trim colour
    g.fillStyle = litRadial(g, c.x, c.y - r * 0.5, r * 0.9, dark(L.trim, 0.7), 0.25, 0.5);
    g.beginPath(); g.ellipse(c.x, c.y - r * 0.45, r * 0.95, r * 0.6, 0, PI, TAU); g.fill();
    return;
  }
  if (helm === 'open') {
    // dome on top, cheek guards, face visible
    g.fillStyle = litRadial(g, c.x, c.y - r * 0.4, r * 1.05, plateC, 0.6, 0.5);
    g.beginPath(); g.ellipse(c.x, c.y - r * 0.15, r * 1.08, r * 0.95, 0, PI * 0.98, TAU * 1.01); g.fill();
    g.fillRect(c.x - r * 1.05, c.y - r * 0.2, r * 2.1, 1.2);
    face(() => {
      g.fillStyle = eyeC || 'rgba(25,15,12,0.9)';
      g.fillRect(-2.4, 0.2, 1.5, 1);
      g.fillRect(0.9, 0.2, 1.5, 1);
      g.fillStyle = rgba(dark(L.skin, 0.5), 0.7);
      g.fillRect(-1.2, 3.2, 2.4, 0.6);
    }, r * 0.9, 0);
    g.strokeStyle = rgba(L.glow || L.trim, 0.9);
    g.lineWidth = 0.9;
    g.beginPath(); g.ellipse(c.x, c.y - r * 0.15, r * 1.08, r * 0.95, 0, PI * 1.02, TAU * 0.99); g.stroke();
    return;
  }
  // closed helms: full / visor / horned / crest
  if (helm === 'visor') {
    face(() => {
      g.fillStyle = eyeC ? eyeC : 'rgba(18,22,30,0.95)';
      g.beginPath(); g.ellipse(0, -0.3, r * 0.92, 1.6, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(-r * 0.6, -1, r * 0.5, 0.5);
    }, r * 0.82, 0);
    // side lights / ear pods
    for (const sd of [1, -1]) {
      const ep = proj(V, add(hc, mul(U2dirLocal(U, [sd, 0, 0]), r * 0.95)));
      g.fillStyle = litRadial(g, ep.x, ep.y, 1.8, dark(plateC, 0.8));
      g.beginPath(); g.arc(ep.x, ep.y, 1.8, 0, TAU); g.fill();
      if (eyeC) { g.fillStyle = eyeC; g.fillRect(ep.x - 0.5, ep.y - 0.5, 1, 1); }
    }
  } else {
    // T-visor slit and breaths
    face(() => {
      g.fillStyle = eyeC || 'rgba(8,6,8,0.95)';
      g.fillRect(-r * 0.75, -0.6, r * 1.5, 1.3);
      g.fillStyle = eyeC ? rgba(eyeC, 0.9) : 'rgba(8,6,8,0.9)';
      g.fillRect(-0.55, 0.4, 1.1, r * 0.7);
      g.fillStyle = rgba(dark(plateC, 0.4), 0.8);
      for (let i = 0; i < 3; i++) g.fillRect(1.2, 2 + i * 0.9, 1.4, 0.4);
    }, r * 0.88, 0);
  }
  // ridge over the crown, front to back
  const ridge = [];
  for (let i = 0; i <= 8; i++) {
    const t = -PI / 2 + (i / 8) * PI;
    const p = add(hc, add(mul(U2dirLocal(U, [0, 1, 0]), Math.sin(t) * r * 1.0), [0, 0, Math.cos(t) * r * 1.08]));
    ridge.push(proj(V, p));
  }
  g.strokeStyle = rgba(light(plateC, 0.55), 0.75);
  strokePts(g, ridge.map((p) => [p.x, p.y]), helm === 'crest' ? 0.8 : 1.1);
  if (helm === 'crest') {
    // fin in trim colour
    g.fillStyle = litH(g, c.x - 3, c.x + 3, L.trim, 0.35, 0.5);
    const top = ridge.map((p) => [p.x, p.y - 4.5]);
    fillPts(g, ridge.slice(1, 8).map((p) => [p.x, p.y]).concat(top.slice(1, 8).reverse()));
  }
  if (helm === 'horned') {
    for (const sd of [1, -1]) {
      const rt = U2dirLocal(U, [sd, 0, 0]);
      const fw = U2dirLocal(U, [0, 1, 0]);
      const p0 = add(hc, add(mul(rt, r * 0.8), [0, 0, r * 0.35]));
      const p1 = add(p0, add(mul(rt, r * 1.1), add(mul(fw, 0.6), [0, 0, r * 0.65])));
      const p2 = add(p1, add(mul(rt, r * 0.2), add(mul(fw, 1.2), [0, 0, r * 1.15])));
      const a0 = proj(V, p0); const a1 = proj(V, p1); const a2 = proj(V, p2);
      capsule(g, a0.x, a0.y, a1.x, a1.y, 1.7, 1.2, L.accent, 0.45, 0.5);
      capsule(g, a1.x, a1.y, a2.x, a2.y, 1.2, 0.35, L.accent, 0.5, 0.5);
    }
  }
  // brow band
  g.strokeStyle = rgba(L.glow || L.trim, L.glow ? 0.95 : 0.85);
  g.lineWidth = 0.9;
  if (fy > -0.4) {
    face(() => { g.beginPath(); g.moveTo(-r * 0.95, -2.4); g.quadraticCurveTo(0, -3.4, r * 0.95, -2.4); g.stroke(); }, r * 0.75, 0);
  }
}

function U2dirLocal(U, d) {
  return U2dir(U, d);
}

/* ------------------------------------------------------------------ weapons */

export function weaponLen(w) {
  return {
    sword: 24, katana: 25, greatsword: 30, axe: 20, hammer: 22, mace: 16, spear: 32, staff: 30, wand: 9,
    dagger: 11, blade: 13, claws: 6, pistol: 8, rifle: 17, bow: 14,
  }[w] || 14;
}

function drawWeapon(g, X, hand, wd, P, U) {
  const { L, V } = X;
  const w = L.weapon;
  const metal = L.metal;
  const em = L.glow;
  const at = (k) => proj(V, add(hand, mul(wd, k)));
  // a perpendicular "flat" axis: weapon x right, projected
  const side = norm([wd[1], -wd[0], 0]);
  const sideP = (p, k) => proj(V, add(p, mul(side, k)));
  const H = proj(V, hand);
  g.lineCap = 'round';
  const blade = (lenB, w0, w1, guard, grip, curved) => {
    const g0 = at(-grip); const base = at(1.2);
    capsule(g, g0.x, g0.y, H.x, H.y, 0.9, 0.9, dark(L.leather, 0.8), 0.2, 0.4);
    const pom = at(-grip - 0.8);
    g.fillStyle = L.accent; g.beginPath(); g.arc(pom.x, pom.y, 1.1, 0, TAU); g.fill();
    // guard
    if (guard) {
      const gc = add(hand, mul(wd, 1.3));
      const ga = sideP(gc, guard); const gb = sideP(gc, -guard);
      capsule(g, ga.x, ga.y, gb.x, gb.y, 0.9, 0.9, L.accent, 0.45, 0.5);
    }
    const tipPt = add(hand, mul(wd, lenB));
    const tip = proj(V, curved ? add(tipPt, mul(side, 1.2)) : tipPt);
    const b0a = sideP(add(hand, mul(wd, 1.8)), w0); const b0b = sideP(add(hand, mul(wd, 1.8)), -w0);
    const mPt = add(hand, mul(wd, lenB * 0.75));
    const m1 = sideP(mPt, w1 + (curved ? 0.6 : 0)); const m2 = sideP(mPt, -w1 + (curved ? 0.6 : 0));
    // ensure some screen width even when seen edge-on
    const pts = [[b0a.x, b0a.y], [m1.x, m1.y], [tip.x, tip.y], [m2.x, m2.y], [b0b.x, b0b.y]];
    const ax = tip.x - base.x; const ay = tip.y - base.y;
    const al = Math.hypot(ax, ay) || 1;
    const nx = -ay / al; const ny = ax / al;
    const minW = 0.9;
    for (const q of pts) {
      // nothing: width is handled by the outline pass; we only widen if degenerate
    }
    const wDeg = Math.abs((b0a.x - b0b.x) * nx + (b0a.y - b0b.y) * ny) < minW;
    if (wDeg) {
      pts[0] = [base.x + nx * minW, base.y + ny * minW];
      pts[4] = [base.x - nx * minW, base.y - ny * minW];
      pts[1] = [lerp(base.x, tip.x, 0.75) + nx * minW * 0.8, lerp(base.y, tip.y, 0.75) + ny * minW * 0.8];
      pts[3] = [lerp(base.x, tip.x, 0.75) - nx * minW * 0.8, lerp(base.y, tip.y, 0.75) - ny * minW * 0.8];
    }
    const gr = g.createLinearGradient(base.x + nx * 2, base.y + ny * 2, base.x - nx * 2, base.y - ny * 2);
    gr.addColorStop(0, light(metal, 0.55));
    gr.addColorStop(0.5, metal);
    gr.addColorStop(0.52, dark(metal, 0.62));
    gr.addColorStop(1, dark(metal, 0.45));
    g.fillStyle = gr;
    fillPts(g, pts);
    // fuller / energy edge
    g.strokeStyle = em ? em : rgba(light(metal, 0.7), 0.7);
    strokePts(g, [[lerp(base.x, tip.x, 0.08), lerp(base.y, tip.y, 0.08)], [lerp(base.x, tip.x, 0.8), lerp(base.y, tip.y, 0.8)]], em ? 0.9 : 0.5);
  };
  switch (w) {
    case 'sword': blade(weaponLen(w), 1.7, 1.45, 3.6, 3.8); break;
    case 'katana': blade(weaponLen(w), 1.0, 0.95, 1.4, 5, true); break;
    case 'greatsword': blade(weaponLen(w), 2.0, 1.7, 4.4, 6); break;
    case 'dagger': case 'blade': blade(weaponLen(w), 1.2, 1.0, 2.2, 2.6); break;
    case 'axe': case 'hammer': case 'mace': {
      const lenH = weaponLen(w);
      const b = at(-4); const t = at(lenH);
      capsule(g, b.x, b.y, t.x, t.y, 0.95, 0.95, dark(L.leather, 0.95), 0.3, 0.5);
      const hc = add(hand, mul(wd, lenH - 2));
      if (w === 'mace') {
        const p = proj(V, add(hand, mul(wd, lenH)));
        sphere(g, p.x, p.y, 3.4, metal, 0.6, 0.55);
        g.fillStyle = dark(metal, 0.5);
        for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; g.fillRect(p.x + Math.cos(a) * 3.3 - 0.6, p.y + Math.sin(a) * 3.3 - 0.6, 1.2, 1.2); }
        if (em) { g.fillStyle = em; g.beginPath(); g.arc(p.x, p.y, 1, 0, TAU); g.fill(); }
      } else if (w === 'hammer') {
        // block head: a short capsule across the haft
        const a = sideP(hc, 4.2); const bb = sideP(hc, -4.2);
        capsule(g, a.x, a.y, bb.x, bb.y, 3.2, 3.2, metal, 0.55, 0.6);
        g.strokeStyle = em || rgba(L.trim, 0.9);
        strokePts(g, [[lerp(a.x, bb.x, 0.3), lerp(a.y, bb.y, 0.3) - 2.6], [lerp(a.x, bb.x, 0.3), lerp(a.y, bb.y, 0.3) + 2.6]], 0.9);
        strokePts(g, [[lerp(a.x, bb.x, 0.7), lerp(a.y, bb.y, 0.7) - 2.6], [lerp(a.x, bb.x, 0.7), lerp(a.y, bb.y, 0.7) + 2.6]], 0.9);
      } else {
        // axe: crescent to one side
        const e0 = proj(V, add(hc, mul(wd, 3)));
        const e1 = proj(V, add(hc, mul(wd, -3)));
        const o0 = sideP(add(hc, mul(wd, 4.5)), 6.5);
        const o1 = sideP(add(hc, mul(wd, -4.5)), 6.5);
        const om = sideP(hc, 7.6);
        g.fillStyle = litH(g, Math.min(e0.x, om.x), Math.max(e0.x, om.x), metal, 0.5, 0.5);
        fillPts(g, [[e0.x, e0.y], [o0.x, o0.y], [om.x, om.y], [o1.x, o1.y], [e1.x, e1.y]]);
        g.strokeStyle = em || rgba(light(metal, 0.7), 0.8);
        strokePts(g, [[o0.x, o0.y], [om.x, om.y], [o1.x, o1.y]], 0.8);
      }
      break;
    }
    case 'spear': case 'staff': {
      const lenS = weaponLen(w);
      const b = at(w === 'staff' ? -14 : -8); const t = at(lenS);
      capsule(g, b.x, b.y, t.x, t.y, 0.95, 0.85, dark(L.leather, 1.1), 0.35, 0.5);
      if (w === 'spear') {
        const p0 = add(hand, mul(wd, lenS));
        const tip = at(lenS + 7);
        const s0 = sideP(add(p0, mul(wd, 1.5)), 1.8); const s1 = sideP(add(p0, mul(wd, 1.5)), -1.8);
        g.fillStyle = litH(g, Math.min(s0.x, s1.x), Math.max(s0.x, s1.x), metal, 0.5, 0.5);
        fillPts(g, [[t.x, t.y], [s0.x, s0.y], [tip.x, tip.y], [s1.x, s1.y]]);
      } else {
        // head: prongs cradling a focus
        const p0 = add(hand, mul(wd, lenS));
        const f = at(lenS + 2.5);
        for (const k of [1, -1]) {
          const a = sideP(p0, k * 1.2); const bb = sideP(add(p0, mul(wd, 5)), k * 2.8);
          capsule(g, a.x, a.y, bb.x, bb.y, 0.7, 0.4, L.accent, 0.4, 0.5);
        }
        const fc = em || light(L.trim, 0.35);
        g.fillStyle = litRadial(g, f.x, f.y, 2.6, fc, 0.7, 0.2);
        g.beginPath(); g.arc(f.x, f.y, 2.4, 0, TAU); g.fill();
        X.glows.push({ x: f.x, y: f.y, r: 9 + P.cast * 10, color: fc, a: 0.35 + P.cast * 0.4 });
      }
      break;
    }
    case 'wand': {
      const t = at(weaponLen(w));
      const b = at(-2);
      capsule(g, b.x, b.y, t.x, t.y, 0.8, 0.5, dark(L.leather, 1.1), 0.3, 0.5);
      const fc = em || light(L.trim, 0.35);
      g.fillStyle = fc;
      g.beginPath(); g.arc(t.x, t.y, 1.5, 0, TAU); g.fill();
      break;
    }
    case 'pistol': case 'rifle': {
      const lenG = weaponLen(w);
      const back = at(w === 'rifle' ? -7 : -2.2);
      const front = at(lenG);
      const body = dark(L.metal, 0.42);
      capsule(g, back.x, back.y, front.x, front.y, w === 'rifle' ? 1.7 : 1.4, 1.0, body, 0.45, 0.5);
      // receiver block, grip, barrel
      const rc = at(w === 'rifle' ? 2 : 1);
      g.fillStyle = litRadial(g, rc.x, rc.y, 2.6, body, 0.5, 0.5);
      g.beginPath(); g.arc(rc.x, rc.y, w === 'rifle' ? 2.5 : 2.0, 0, TAU); g.fill();
      const grip = proj(V, add(add(hand, mul(wd, -0.6)), [0, 0, -2.6]));
      capsule(g, H.x, H.y, grip.x, grip.y, 1.0, 0.9, dark(body, 0.8), 0.3, 0.5);
      if (w === 'rifle') {
        const mag = proj(V, add(add(hand, mul(wd, 4)), [0, 0, -3.4]));
        const mag0 = at(4);
        capsule(g, mag0.x, mag0.y, mag.x, mag.y, 1.1, 1.0, dark(body, 0.85), 0.3, 0.5);
        const sc = proj(V, add(add(hand, mul(wd, 3)), [0, 0, 1.9]));
        const sc2 = proj(V, add(add(hand, mul(wd, 7)), [0, 0, 1.9]));
        capsule(g, sc.x, sc.y, sc2.x, sc2.y, 0.9, 0.9, dark(body, 0.7), 0.5, 0.5);
      }
      const ml = at(lenG * 0.35); const mr = at(lenG * 0.9);
      g.strokeStyle = em || rgba(L.trim, 0.9);
      strokePts(g, [[ml.x, ml.y - 0.5], [mr.x, mr.y - 0.5]], 0.6);
      if (P.muzzle) {
        const m = at(lenG + 2.5);
        const fc = em ? light(em, 0.5) : '#fff1b8';
        g.fillStyle = fc;
        const sp = at(lenG + 8);
        const a = Math.atan2(sp.y - m.y, sp.x - m.x);
        g.save(); g.translate(m.x, m.y); g.rotate(a);
        fillPts(g, [[-1, 0], [2, -2.6], [3, -0.8], [7, 0], [3, 0.8], [2, 2.6]]);
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(1, 0, 1.3, 0, TAU); g.fill();
        g.restore();
      }
      break;
    }
    case 'bow': {
      const lenB = weaponLen(w);
      const top = proj(V, add(hand, [0, 0, lenB]));
      const bot = proj(V, add(hand, [0, 0, -lenB]));
      const fw = U2dir(U, [0, 1, 0]);
      const bend = proj(V, add(hand, mul(fw, 4)));
      const H2 = proj(V, hand);
      g.strokeStyle = dark(L.leather, 1.2);
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(top.x, top.y); g.quadraticCurveTo(bend.x * 2 - H2.x, bend.y * 2 - H2.y - 0, bot.x, bot.y); g.stroke();
      const pull = proj(V, add(hand, mul(fw, -13 * (P.bowDraw || 0))));
      g.strokeStyle = 'rgba(230,230,220,0.8)';
      strokePts(g, [[top.x, top.y], [pull.x, pull.y], [bot.x, bot.y]], 0.45);
      if (P.bowDraw > 0) {
        const tip = proj(V, add(hand, mul(fw, 3)));
        g.strokeStyle = L.accent;
        strokePts(g, [[pull.x, pull.y], [tip.x, tip.y]], 0.8);
      }
      break;
    }
    default: break;
  }
}

function drawOffhand(g, X, B, hand, U, P) {
  const { L, V } = X;
  const kind = L.offhand;
  const fw = U2dir(U, [0, 1, 0]);
  const rt = U2dir(U, [1, 0, 0]);
  if (kind === 'shield' || kind === 'buckler') {
    const big = kind === 'shield';
    const ctr = add(hand, add(mul(fw, 2.2), mul(rt, -1)));
    // shield plane faces forward-left
    const n = norm(add(fw, mul(rt, -0.55)));
    const ax = norm([n[1], -n[0], 0]);
    const O = proj(V, ctr);
    const A = proj(V, add(ctr, ax));
    const D = proj(V, add(ctr, [0, 0, -1]));
    const N = proj(V, add(ctr, n));
    const front = N.d - O.d > -0.05;
    g.save();
    g.transform(A.x - O.x, A.y - O.y, D.x - O.x, D.y - O.y, O.x, O.y);
    const w = big ? 7 : 4.5; const h = big ? 10 : 4.5;
    const shape = big ? [[-w, -h * 0.75], [w, -h * 0.75], [w, h * 0.1], [0, h], [-w, h * 0.1]] : null;
    const col = front ? L.body : dark(L.leather, 0.9);
    g.fillStyle = litH(g, -w, w, col, 0.45, 0.55);
    if (shape) fillPts(g, shape); else { g.beginPath(); g.arc(0, 0, w, 0, TAU); g.fill(); }
    if (front) {
      g.strokeStyle = L.glow || L.trim;
      g.lineWidth = 1.2;
      if (shape) { g.beginPath(); g.moveTo(shape[0][0] + 1.2, shape[0][1] + 1.2); for (const q of shape.slice(1)) g.lineTo(q[0] * 0.82, q[1] * 0.85 + 0.3); g.closePath(); g.stroke(); } else { g.beginPath(); g.arc(0, 0, w - 1, 0, TAU); g.stroke(); }
      g.fillStyle = L.accent;
      g.beginPath(); g.arc(0, -0.5, big ? 1.8 : 1.4, 0, TAU); g.fill();
    }
    g.restore();
    return;
  }
  if (kind === 'orb') {
    const p = proj(V, add(hand, [0, 0, 3]));
    const fc = L.glow || light(L.trim, 0.3);
    g.fillStyle = litRadial(g, p.x, p.y, 2.8, fc, 0.7, 0.25);
    g.beginPath(); g.arc(p.x, p.y, 2.6, 0, TAU); g.fill();
    X.glows.push({ x: p.x, y: p.y, r: 10, color: fc, a: 0.4 });
    return;
  }
  if (kind === 'pistol' || kind === 'dagger') {
    const saved = L.weapon;
    const L2 = { ...L, weapon: kind };
    drawWeapon(g, { ...X, L: L2 }, hand, U2dir(U, wdir(1.0, -0.1)), { ...P, muzzle: false }, U);
    void saved;
  }
}

/** Translucent arc following the weapon tip over the last few attack keyframes. */
function drawSmear(c, X, B, K, f, U, P) {
  const { L, V } = X;
  const up = B.shZ - B.waistZ;
  const wl = weaponLen(L.weapon) + (L.weapon === 'staff' ? 4 : 0);
  const tips = [];
  const bases = [];
  const from = Math.max(0, f - 2);
  const STEPS = 5;
  for (let i = from; i < f; i++) {
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS;
      const k0 = K[i]; const k1 = K[i + 1];
      const hand = U([lerp(k0[0], k1[0], t), lerp(k0[1], k1[1], t), up + lerp(k0[2], k1[2], t)]);
      const wd = U2dir(U, wdir(lerp(k0[3], k1[3], t), lerp(k0[4], k1[4], t)));
      tips.push(proj(V, add(hand, mul(wd, wl + 1))));
      bases.push(proj(V, add(hand, mul(wd, wl * 0.5))));
    }
  }
  {
    const k = K[f];
    const hand = U([k[0], k[1], up + k[2]]);
    const wd = U2dir(U, wdir(k[3], k[4]));
    tips.push(proj(V, add(hand, mul(wd, wl + 1))));
    bases.push(proj(V, add(hand, mul(wd, wl * 0.5))));
  }
  if (tips.length < 3) return;
  const col = L.glow || light(L.metal, 0.5);
  const n = tips.length;
  // ribbon: alpha ramps from 0 (oldest) to bright (newest), as thin quads
  for (let i = 0; i < n - 1; i++) {
    const a = (i + 1) / n;
    c.fillStyle = rgba(col, a * (L.glow ? 0.6 : 0.42));
    fillPts(c, [[tips[i].x, tips[i].y], [tips[i + 1].x, tips[i + 1].y], [bases[i + 1].x, bases[i + 1].y], [bases[i].x, bases[i].y]]);
  }
  c.strokeStyle = rgba(light(col, 0.6), 0.7);
  c.lineCap = 'round';
  strokePts(c, tips.slice(Math.floor(n / 2)).map((p) => [p.x, p.y]), 0.8);
  const b = tips[n - 1];
  if (L.glow) X.glows.push({ x: b.x, y: b.y, r: 18, color: L.glow, a: 0.35 });
}

function clawSmear(c, X, arm) {
  const { L, V } = X;
  const h = proj(V, arm.hand);
  const col = L.glow || 'rgba(255,255,255,0.8)';
  c.strokeStyle = rgba(L.glow || '#ffffff', 0.55);
  c.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    c.beginPath();
    c.arc(h.x - 6, h.y + i * 2.2, 8, -0.9, 0.5);
    c.lineWidth = 0.8;
    c.stroke();
  }
  void col;
}

/* ------------------------------------------------------------------ non-humanoids */

/** Ellipsoid in actor space, centre p, radii (s, f, z), drawn shaded. Returns screen hull. */
function ellipsoid(g, V, p, rs, rf, rz, color, hi = 0.5, lo = 0.55) {
  const pts = [];
  for (let i = 0; i < 7; i++) {
    const lat = -PI / 2 + (i / 6) * PI;
    for (let j = 0; j < 12; j++) {
      const lon = (j / 12) * TAU;
      const q = [p[0] + rs * Math.cos(lat) * Math.cos(lon), p[1] + rf * Math.cos(lat) * Math.sin(lon), p[2] + rz * Math.sin(lat)];
      const s = proj(V, q);
      pts.push([s.x, s.y]);
    }
  }
  const H = hull(pts);
  const bb = bbox(H);
  const cx = (bb.x0 + bb.x1) / 2; const cy = (bb.y0 + bb.y1) / 2;
  const r = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
  g.fillStyle = litRadial(g, cx, cy, r, color, hi, lo);
  fillPts(g, H);
  return H;
}

/** Rotate actor-space vector by the view so specials can use yaw too (identity here). */
function crawler(X) {
  const { L, V, anim, f } = X;
  const ops = X.ops;
  const walk = anim === 'walk';
  const ph = (f / WALK_FRAMES) * TAU;
  const atk = anim === 'attack' ? Math.sin((f / ATTACK_FRAMES) * PI) : 0;
  const hit = anim === 'hit' ? (f === 0 ? 1 : 0.5) : 0;
  const dz = anim === 'death' ? 0 : 0;
  const n = Math.max(2, Math.min(4, Math.round(L.legs / 2)));
  const bodyZ = (n === 2 ? 13 : 9) + (walk ? Math.abs(Math.sin(ph)) * 0.8 : 0) + dz;
  const lungeF = atk * 6 - hit * 2.5;
  const hide = L.body;
  const quad = n === 2;
  const thorax = [0, 2 + lungeF, bodyZ + 1];
  const abdomen = [0, -9 + lungeF * 0.5, bodyZ + (quad ? 0.5 : 0.5)];
  const head = [0, (quad ? 13 : 11) + lungeF * 1.3, bodyZ + (quad ? 3.5 : 1.5) - atk * 2];
  X.shadowR = quad ? 15 : 17;
  // legs
  for (let i = 0; i < n; i++) {
    for (const side of [1, -1]) {
      const t = n === 1 ? 0 : i / (n - 1);
      const attachF = quad ? lerp(7, -8, t) : lerp(5, -6, t);
      const phase = ph + (i % 2 === 0 ? 0 : PI) + (side > 0 ? 0 : PI);
      const step = walk ? Math.sin(phase) * 4 : 0;
      const lift = walk ? Math.max(0, Math.cos(phase)) * 3 : 0;
      const hip = [side * (quad ? 4.5 : 4), attachF + lungeF * (1 - t * 0.5), bodyZ - (quad ? 1.5 : 0)];
      const foot = quad
        ? [side * 5.5, attachF + step + lungeF * (1 - t * 0.5) + (i === 0 ? atk * 4 : 0), lift + (i === 0 ? atk * 5 : 0)]
        : [side * (13 + (i === 0 ? 1 : 0)), attachF * 1.5 + step + lungeF * 0.5 + (i === 0 ? atk * 3 : 0), lift + (i === 0 ? atk * 7 : 0)];
      const knee = quad
        ? ik(hip, foot, 7.5, 7.5, [0, i === 0 ? -1 : 1, 0])
        : ik(hip, foot, 9, 11, [side * 0.4, 0, 1]);
      const kd = proj(V, knee).d;
      ops.push({ d: kd * 0.5 + (proj(V, hip).d) * 0.5, fn: (g) => {
        const a = proj(V, hip); const k = proj(V, knee); const ft = proj(V, foot);
        capsule(g, a.x, a.y, k.x, k.y, quad ? 2.6 : 1.8, quad ? 1.9 : 1.4, quad ? hide : dark(hide, 0.85), 0.35, 0.55);
        capsule(g, k.x, k.y, ft.x, ft.y, quad ? 1.8 : 1.4, quad ? 1.4 : 0.6, quad ? dark(hide, 0.85) : dark(L.trim, 0.65), 0.35, 0.55);
        if (!quad) { g.fillStyle = L.glow || light(L.trim, 0.2); g.beginPath(); g.arc(k.x, k.y, 0.9, 0, TAU); g.fill(); }
      } });
    }
  }
  const bodyD = proj(V, [0, 0, 0]).d;
  const absD = proj(V, abdomen).d;
  const thD = proj(V, thorax).d;
  const hdD = proj(V, head).d;
  ops.push({ d: absD, fn: (g) => {
    ellipsoid(g, V, abdomen, quad ? 5.2 : 7.5, quad ? 7 : 9, quad ? 5 : 6.5, hide, 0.45, 0.6);
    // banding stripes on the abdomen
    for (let i = -1; i <= 1; i++) {
      const p0 = proj(V, [-(quad ? 4.6 : 6.8), abdomen[1] + i * 3, abdomen[2] + 2]);
      const p1 = proj(V, [0, abdomen[1] + i * 3, abdomen[2] + (quad ? 5 : 6.4)]);
      const p2 = proj(V, [(quad ? 4.6 : 6.8), abdomen[1] + i * 3, abdomen[2] + 2]);
      g.strokeStyle = rgba(L.glow || L.trim, L.glow ? 0.9 : 0.75);
      g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(p0.x, p0.y); g.quadraticCurveTo(p1.x * 2 - (p0.x + p2.x) / 2, p1.y * 2 - (p0.y + p2.y) / 2, p2.x, p2.y); g.stroke();
    }
  } });
  ops.push({ d: thD + 0.1, fn: (g) => {
    ellipsoid(g, V, thorax, quad ? 5.8 : 5.6, quad ? 7.5 : 5.5, quad ? 5.4 : 4.8, light(hide, 0.05), 0.5, 0.55);
    // dorsal spines
    for (let i = 0; i < 4; i++) {
      const b = [0, thorax[1] + 4 - i * 3.6, thorax[2] + (quad ? 5 : 4.5) - Math.abs(i - 1) * 0.4];
      const p0 = proj(V, b); const p1 = proj(V, add(b, [0, -2.2, 3.2 - i * 0.4]));
      capsule(g, p0.x, p0.y, p1.x, p1.y, 1.2, 0.2, L.glow ? dark(L.trim, 0.8) : L.accent, 0.4, 0.5);
    }
  } });
  ops.push({ d: hdD + 0.2, fn: (g) => {
    ellipsoid(g, V, head, quad ? 3.8 : 3.6, quad ? 5 : 3.8, quad ? 3.4 : 3, light(hide, 0.08), 0.55, 0.55);
    const fw = [0, 1, 0];
    const front = proj(V, add(head, mul(fw, quad ? 4.5 : 3.4)));
    const hd = proj(V, head);
    const vis = front.d - hd.d > -0.5;
    // jaws / mandibles
    for (const sd of [1, -1]) {
      const m0 = add(head, [sd * 1.8, quad ? 3.5 : 2.6, -1.5]);
      const m1 = add(m0, [sd * (1.5 + atk * 2), 3.5 + atk * 1.5, -0.8]);
      const a = proj(V, m0); const b = proj(V, m1);
      capsule(g, a.x, a.y, b.x, b.y, 1.0, 0.3, L.accent, 0.5, 0.5);
    }
    if (vis) {
      const ec = L.glow || '#ffffff';
      for (const sd of [1, -1]) {
        const e = proj(V, add(head, [sd * 1.6, quad ? 3.6 : 2.9, 1.2]));
        g.fillStyle = L.glow ? ec : 'rgba(255,240,200,0.9)';
        g.beginPath(); g.arc(e.x, e.y, 0.9, 0, TAU); g.fill();
      }
      X.glows.push({ x: front.x, y: front.y, r: 7, color: L.glow || L.trim, a: L.glow ? 0.35 : 0 });
    }
    if (quad) {
      // ears / sensor fins
      for (const sd of [1, -1]) {
        const e0 = proj(V, add(head, [sd * 2, -1, 2.5]));
        const e1 = proj(V, add(head, [sd * 3, -3, 6]));
        capsule(g, e0.x, e0.y, e1.x, e1.y, 1.2, 0.3, dark(hide, 0.9), 0.4, 0.5);
      }
    }
  } });
  void bodyD;
  if (anim === 'attack' && atk > 0.7) {
    X.after.push((c) => {
      const p = proj(V, add(head, [0, 7, -1]));
      c.strokeStyle = rgba(L.glow || '#ffffff', 0.5);
      c.lineWidth = 0.8;
      for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(p.x, p.y + i * 2, 5, -1.1, 1.1); c.stroke(); }
    });
  }
  if (anim === 'death') {
    // curl up: handled by the generic death rotation; flatten legs by lowering body
  }
}

function flier(X) {
  const { L, V, anim, f } = X;
  const ops = X.ops;
  const ph = (f / WALK_FRAMES) * TAU;
  const hover = Math.sin(ph) * 2.5;
  const atk = anim === 'attack' ? Math.sin((f / ATTACK_FRAMES) * PI) : 0;
  const z = anim === 'death' ? 6 : 24 + hover - atk * 5;
  const fw = 0 + atk * 6;
  const body = [0, fw, z];
  const rotor = L.wings === 'rotor';
  X.shadowR = 10;
  X.shadowA = 0.35;
  const flapK = rotor ? 0 : [0.9, 0.5, -0.2, -0.7, -0.9, -0.4, 0.3, 0.8][(anim === 'death' ? 0 : f) % 8];
  for (const side of [1, -1]) {
    if (rotor) {
      for (const fo of [5, -5]) {
        const arm0 = add(body, [side * 3, fo * 0.4, 0.5]);
        const hub = add(body, [side * 10, fo, 1.5]);
        const hd = proj(V, hub).d;
        ops.push({ d: hd, fn: (g) => {
          const a = proj(V, arm0); const h = proj(V, hub);
          capsule(g, a.x, a.y, h.x, h.y, 1.2, 1.0, dark(L.body, 0.8), 0.35, 0.5);
          sphere(g, h.x, h.y, 1.8, dark(L.body, 0.7), 0.4, 0.5);
          // blurred disc
          g.fillStyle = rgba(light(L.metal, 0.3), 0.35);
          g.beginPath(); g.ellipse(h.x, h.y - 1.6, 7, 3.2, 0, 0, TAU); g.fill();
          g.strokeStyle = rgba(L.glow || L.trim, 0.6);
          g.lineWidth = 0.6;
          g.beginPath(); g.ellipse(h.x, h.y - 1.6, 7, 3.2, 0, 0, TAU); g.stroke();
        } });
      }
    } else {
      const root = add(body, [side * 3, -1, 1.5]);
      const elbow = add(body, [side * 11, -2, 1.5 + flapK * 9]);
      const tip = add(body, [side * 19, -4, flapK * 15 - 1]);
      const back1 = add(body, [side * 15, -8, flapK * 8 - 2]);
      const back2 = add(body, [side * 8, -7, flapK * 3 - 1]);
      const wd = proj(V, elbow).d;
      ops.push({ d: wd, fn: (g) => {
        const P = [root, elbow, tip, back1, back2].map((q) => proj(V, q));
        const bb = bbox(P.map((p) => [p.x, p.y]));
        g.fillStyle = litH(g, bb.x0, bb.x1, mix(L.trim, L.body, 0.4), 0.25, 0.6);
        g.beginPath();
        g.moveTo(P[0].x, P[0].y); g.lineTo(P[1].x, P[1].y); g.lineTo(P[2].x, P[2].y);
        g.quadraticCurveTo((P[2].x + P[3].x) / 2, (P[2].y + P[3].y) / 2 + 2, P[3].x, P[3].y);
        g.quadraticCurveTo((P[3].x + P[4].x) / 2, (P[3].y + P[4].y) / 2 + 2, P[4].x, P[4].y);
        g.closePath(); g.fill();
        g.strokeStyle = dark(L.body, 0.6);
        strokePts(g, [[P[0].x, P[0].y], [P[1].x, P[1].y], [P[2].x, P[2].y]], 1.1);
        strokePts(g, [[P[1].x, P[1].y], [P[3].x, P[3].y]], 0.6);
      } });
    }
  }
  const bd = proj(V, body).d;
  ops.push({ d: bd + 0.1, fn: (g) => {
    ellipsoid(g, V, body, 5, 6.5, 4.6, L.body, 0.55, 0.55);
    const h = add(body, [0, 5.5, 1.2]);
    if (!rotor) {
      ellipsoid(g, V, h, 3.2, 3, 3, light(L.body, 0.06), 0.5, 0.55);
      for (const sd of [1, -1]) {
        const e0 = proj(V, add(h, [sd * 1.8, -0.5, 2])); const e1 = proj(V, add(h, [sd * 2.6, -1.2, 5]));
        capsule(g, e0.x, e0.y, e1.x, e1.y, 1.1, 0.3, L.body, 0.4, 0.5);
      }
    } else {
      const ring0 = proj(V, add(body, [0, 0, 0]));
      g.strokeStyle = L.glow || L.trim;
      g.lineWidth = 0.9;
      g.beginPath(); g.ellipse(ring0.x, ring0.y, 5.2, 2.4, 0, 0.05 * PI, 0.95 * PI); g.stroke();
      // underslung gun
      const gb = proj(V, add(body, [0, 2, -4])); const gt = proj(V, add(body, [0, 9, -4.5]));
      capsule(g, gb.x, gb.y, gt.x, gt.y, 1.1, 0.8, dark(L.metal, 0.4), 0.4, 0.5);
    }
    const e = proj(V, add(rotor ? body : h, [0, rotor ? 5.6 : 2.6, rotor ? 0.5 : 0.6]));
    const vis = e.d - proj(V, body).d > -1;
    if (vis) {
      const ec = L.glow || '#ff4030';
      g.fillStyle = L.glow || light(L.trim, 0.4);
      if (rotor) { g.beginPath(); g.arc(e.x, e.y, 1.6, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(e.x - 0.4, e.y - 0.4, 0.5, 0, TAU); g.fill(); } else {
        g.fillRect(e.x - 1.8, e.y - 0.4, 1.1, 1); g.fillRect(e.x + 0.7, e.y - 0.4, 1.1, 1);
      }
      if (L.glow) X.glows.push({ x: e.x, y: e.y, r: 8, color: ec, a: 0.4 });
    }
  } });
}

function blob(X) {
  const { L, V, anim, f } = X;
  const ph = (f / WALK_FRAMES) * TAU;
  const atk = anim === 'attack' ? Math.sin((f / ATTACK_FRAMES) * PI) : 0;
  const death = anim === 'death';
  const sq = anim === 'walk' ? Math.sin(ph) * 0.12 : (anim === 'cast' ? 0.1 : 0) - atk * 0.15;
  const melt = death ? 0.55 : 1;
  const rx = 12 * (1 + sq) * (death ? 1.4 : 1);
  const rz = 10.5 * (1 - sq) * melt + atk * 3;
  const c0 = [0, atk * 4, rz * 0.82];
  X.shadowR = rx + 2;
  X.rim = light(L.trim, 0.6);
  X.ops.push({ d: 0, fn: (g) => {
    const H = ellipsoid(g, V, c0, rx, rx, rz, L.body, 0.35, 0.55);
    // translucent: inner glow toward the core
    const bb = bbox(H);
    const cx = (bb.x0 + bb.x1) / 2; const cy = (bb.y0 + bb.y1) / 2 + 2;
    const ig = g.createRadialGradient(cx, cy, 1, cx, cy, rx);
    ig.addColorStop(0, rgba(light(L.trim, 0.3), 0.55));
    ig.addColorStop(0.6, rgba(L.trim, 0.15));
    ig.addColorStop(1, rgba(L.trim, 0));
    g.fillStyle = ig; fillPts(g, H);
    // nucleus
    const n = proj(V, add(c0, [Math.sin(ph) * 1.5, 0, -1]));
    g.fillStyle = litRadial(g, n.x, n.y, 3.5, L.trim, 0.5, 0.4);
    g.beginPath(); g.arc(n.x, n.y, 3.4, 0, TAU); g.fill();
    // bubbles
    for (let i = 0; i < 4; i++) {
      const b = proj(V, add(c0, [Math.cos(i * 2.1 + ph) * rx * 0.55, Math.sin(i * 1.7) * 3, Math.sin(i * 2.7 + ph * 0.5) * rz * 0.45]));
      g.strokeStyle = rgba(light(L.body, 0.6), 0.55);
      g.lineWidth = 0.5;
      g.beginPath(); g.arc(b.x, b.y, 0.8 + (i % 2) * 0.6, 0, TAU); g.stroke();
    }
    // specular
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.ellipse(bb.x0 + (bb.x1 - bb.x0) * 0.3, bb.y0 + (bb.y1 - bb.y0) * 0.25, rx * 0.22, rz * 0.12, -0.5, 0, TAU); g.fill();
    // eyes
    const e = proj(V, add(c0, [0, rx * 0.85, rz * 0.25]));
    if (e.d - proj(V, c0).d > -2 && !death) {
      g.fillStyle = L.glow || 'rgba(15,10,10,0.9)';
      g.beginPath(); g.ellipse(e.x - 2.4, e.y, 1.1, 1.5, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(e.x + 2.4, e.y, 1.1, 1.5, 0, 0, TAU); g.fill();
    }
  } });
  const core = proj(V, c0);
  X.glows.push({ x: core.x, y: core.y, r: 16, color: L.glow || L.trim, a: L.glow ? 0.35 : 0.18 });
}

function turret(X) {
  const { L, V, anim, f } = X;
  const ops = X.ops;
  const fire = anim === 'attack' && (f === 2 || f === 3 || f === 5);
  const recoil = fire ? 1.5 : 0;
  X.shadowR = 15;
  // base: fixed octagonal plinth (does not rotate)
  const Vfix = makeView(0);
  ops.push({ d: -10, fn: (g) => {
    // tripod legs
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      const p0 = proj(Vfix, [0, 0, 9]); const p1 = proj(Vfix, [Math.cos(a) * 13, Math.sin(a) * 13, 0]);
      capsule(g, p0.x, p0.y, p1.x, p1.y, 2.2, 1.4, dark(L.body, 0.75), 0.35, 0.55);
      sphere(g, p1.x, p1.y, 1.8, dark(L.trim, 0.7), 0.35, 0.5);
    }
    const H = [];
    for (const zz of [6, 13]) for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + PI / 8; const p = proj(Vfix, [Math.cos(a) * 6, Math.sin(a) * 6, zz]); H.push([p.x, p.y]); }
    const hh = hull(H); const bb = bbox(hh);
    g.fillStyle = litH(g, bb.x0, bb.x1, L.body, 0.35, 0.6); fillPts(g, hh);
    g.strokeStyle = rgba(L.glow || L.trim, 0.85);
    const r0 = proj(Vfix, [0, 0, 9]);
    g.lineWidth = 0.9; g.beginPath(); g.ellipse(r0.x, r0.y, 6, 3, 0, 0.05 * PI, 0.95 * PI); g.stroke();
  } });
  // head rotates with dir
  const head = [0, -recoil * 0.4, 19];
  const hd = proj(V, head).d;
  const barrel = (side) => {
    const b0 = [side * 2.4, 3 - recoil, 19.5];
    const b1 = [side * 2.4, 15 - recoil, 19.5];
    return { b0, b1, d: proj(V, lerp3(b0, b1, 0.5)).d };
  };
  for (const side of [1, -1]) {
    const B2 = barrel(side);
    ops.push({ d: B2.d + (B2.d > hd ? 0.5 : -0.5), fn: (g) => {
      const a = proj(V, B2.b0); const b = proj(V, B2.b1);
      capsule(g, a.x, a.y, b.x, b.y, 1.5, 1.2, dark(L.metal, 0.5), 0.5, 0.5);
      g.fillStyle = 'rgba(0,0,0,0.85)';
      g.beginPath(); g.arc(b.x, b.y, 0.7, 0, TAU); g.fill();
    } });
  }
  ops.push({ d: hd, fn: (g) => {
    ellipsoid(g, V, head, 6.2, 6.8, 4.6, L.body, 0.55, 0.6);
    // armour seam and sensor
    const s0 = proj(V, add(head, [-6, 0, 0.5])); const s1 = proj(V, add(head, [6, 0, 0.5]));
    g.strokeStyle = rgba(dark(L.body, 0.4), 0.8);
    strokePts(g, [[s0.x, s0.y], [s1.x, s1.y]], 0.6);
    const e = proj(V, add(head, [0, 6.4, 1.2]));
    if (e.d - proj(V, head).d > -1) {
      g.fillStyle = L.glow || light(L.trim, 0.3);
      g.beginPath(); g.arc(e.x, e.y, 1.5, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath(); g.arc(e.x - 0.4, e.y - 0.4, 0.5, 0, TAU); g.fill();
      X.glows.push({ x: e.x, y: e.y, r: 7, color: L.glow || L.trim, a: 0.4 });
    }
  } });
  if (fire) {
    const m = proj(V, [0, 18, 19.5]);
    X.after.push((c) => {
      c.fillStyle = rgba(L.glow || '#fff0b0', 0.95);
      c.beginPath(); c.arc(m.x, m.y, 2.6, 0, TAU); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.arc(m.x, m.y, 1.2, 0, TAU); c.fill();
    });
    X.glows.push({ x: m.x, y: m.y, r: 24, color: L.glow || '#ffe0a0', a: 0.8 });
  }
}

const SPECIAL = { crawler, flier, blob, turret };

void luma; void LIGHT_Y; void RENDER_SCALE;

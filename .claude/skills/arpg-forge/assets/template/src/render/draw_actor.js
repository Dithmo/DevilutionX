/**
 * Procedural actor sprites. (sx, sy) is the screen position of the feet.
 *
 * look: { silhouette:'bulky'|'lean'|'robed'|'crawler'|'flier'|'blob'|'turret'|'tall',
 *         bodyColor, trimColor, size? }
 * opts: { dir 0..7, frame, anim:'stand'|'walk'|'attack'|'hit'|'death'|'cast', light 0..15, scale }
 *
 * Sprites face left/right by mirroring; a small triangle at the feet shows
 * the exact facing. Walk bobs, attack lunges toward dir, hit flashes white,
 * death draws a lying body, cast raises the arms with a glow.
 */
import { cached, blit, shade, lighten, dirToScreen, circle, ellipse, poly } from './draw_util.js';

const SPRITE_W = 80;
const SPRITE_H = 96;
const FEET_Y = 84;
const LIGHT_STEP = 2;
const MAX_LIGHT = 15;
const WALK_FRAMES = 8;
const ATTACK_FRAMES = 8;
const CAST_FRAMES = 4;
const HIT_FLASH = 0.65;
const BOB_PX = 2;
const LUNGE_PX = 8;
const SWING_PX = 3;
const SHADOW_RX = 12;
const SHADOW_RY = 5;
const SHADOW_ALPHA = 0.35;
const DIR_DIST = 15;
const DIR_SIZE = 4;
const DIR_ALPHA = 0.75;
const ARM_W = 3;
const EYE = 2;
const GLOW_R = 7;
const GLOW_BASE = 0.3;
const GLOW_PULSE = 0.2;
const WING_SPAN = 18;
const HOVER_PX = 3;
const DEFAULT_LOOK = { silhouette: 'bulky', bodyColor: '#a0a0a0', trimColor: '#404040' };
const SHAPES = {
  bulky: { sh: 11, hip: 7, h: 36, head: 6 },
  lean: { sh: 7, hip: 5, h: 34, head: 5 },
  robed: { sh: 8, hip: 11, h: 36, head: 5, robe: true },
  tall: { sh: 7, hip: 5, h: 50, head: 5 },
};

function frameKey(anim, frame) {
  const f = Math.max(0, frame | 0);
  if (anim === 'walk') return f % WALK_FRAMES;
  if (anim === 'attack') return f % ATTACK_FRAMES;
  if (anim === 'cast') return f % CAST_FRAMES;
  return 0;
}

/**
 * Draw an actor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx feet x
 * @param {number} sy feet y
 * @param {{silhouette?:string, bodyColor?:string, trimColor?:string, size?:number}} look
 * @param {{dir?:number, frame?:number, anim?:string, light?:number, scale?:number}} [opts]
 */
export function drawActor(ctx, sx, sy, look = DEFAULT_LOOK, opts = {}) {
  const { dir = 0, frame = 0, anim = 'stand', light = MAX_LIGHT, scale = 1 } = opts;
  const sil = look.silhouette || DEFAULT_LOOK.silhouette;
  const body = look.bodyColor || DEFAULT_LOOK.bodyColor;
  const trim = look.trimColor || DEFAULT_LOOK.trimColor;
  const fk = frameKey(anim, frame);
  const lq = Math.min(MAX_LIGHT, Math.ceil(light / LIGHT_STEP) * LIGHT_STEP);
  const size = (look.size || 1) * scale;
  const key = `a|${sil}|${body}|${trim}|${dir}|${anim}|${fk}|${lq}|${size}`;
  const entry = cached(key, SPRITE_W, SPRITE_H, SPRITE_W / 2, FEET_Y, (c) => {
    paintActor(c, sil, body, trim, dir, anim, fk, lq, size);
  });
  blit(ctx, entry, sx, sy);
}

function paintActor(c, sil, bodyColor, trimColor, dir, anim, f, light, size) {
  const facing = dirToScreen(dir);
  const flip = facing.x < 0 ? -1 : 1;
  let body = shade(bodyColor, light);
  let trim = shade(trimColor, light);
  if (anim === 'hit') {
    body = lighten(body, HIT_FLASH);
    trim = lighten(trim, HIT_FLASH);
  }
  c.save();
  c.scale(size, size);
  c.fillStyle = `rgba(0,0,0,${SHADOW_ALPHA})`;
  ellipse(c, 0, 0, SHADOW_RX, SHADOW_RY);
  if (anim === 'death') {
    corpse(c, body, trim, flip);
    c.restore();
    return;
  }
  c.fillStyle = `rgba(255,255,255,${DIR_ALPHA})`;
  const tx = facing.x * DIR_DIST;
  const ty = facing.y * DIR_DIST * 0.5;
  poly(c, [tx + facing.x * DIR_SIZE, ty + facing.y * DIR_SIZE, tx - facing.y * DIR_SIZE, ty + facing.x * DIR_SIZE * 0.5,
    tx + facing.y * DIR_SIZE, ty - facing.x * DIR_SIZE * 0.5]);
  let ox = 0;
  let oy = 0;
  if (anim === 'walk') oy = -Math.abs(Math.sin((f * Math.PI) / (WALK_FRAMES / 2))) * BOB_PX;
  if (anim === 'attack') {
    const l = Math.sin((f / ATTACK_FRAMES) * Math.PI) * LUNGE_PX;
    ox = facing.x * l;
    oy = facing.y * l;
  }
  c.translate(ox, oy);
  c.scale(flip, 1);
  const p = { body, trim, f, walk: anim === 'walk', cast: anim === 'cast', attack: anim === 'attack' };
  const special = SPECIAL[sil];
  if (special) special(c, p);
  else humanoid(c, p, SHAPES[sil] || SHAPES.bulky);
  c.restore();
}

function humanoid(c, p, s) {
  const legH = s.h * 0.42;
  const torsoTop = -s.h * 0.88;
  const torsoBot = -legH + 2;
  const legW = Math.max(3, s.hip * 0.7);
  const swing = p.walk ? Math.sin((p.f * Math.PI) / (WALK_FRAMES / 2)) * SWING_PX : 0;
  if (s.robe) {
    c.fillStyle = p.body;
    poly(c, [-s.hip, 0, s.hip, 0, s.sh * 0.8, torsoBot, -s.sh * 0.8, torsoBot]);
    c.fillStyle = p.trim;
    c.fillRect(-s.hip, -3, s.hip * 2, 3);
  } else {
    c.fillStyle = p.trim;
    c.fillRect(-s.hip + swing, -legH, legW, legH);
    c.fillRect(s.hip - legW - swing, -legH, legW, legH);
  }
  c.fillStyle = p.body;
  c.fillRect(-s.sh, torsoTop, s.sh * 2, torsoBot - torsoTop);
  c.fillStyle = p.trim;
  c.fillRect(-s.sh, torsoBot - 3, s.sh * 2, 2);
  const armLen = (torsoBot - torsoTop) * 0.8;
  if (p.cast) {
    c.fillRect(-s.sh - ARM_W, torsoTop - armLen * 0.6, ARM_W, armLen * 0.6 + 4);
    c.fillRect(s.sh, torsoTop - armLen * 0.6, ARM_W, armLen * 0.6 + 4);
  } else if (p.attack) {
    c.fillRect(-s.sh - ARM_W + 1, torsoTop + 3, ARM_W, armLen);
    c.fillRect(s.sh - 1, torsoTop + 4, armLen * 0.9, ARM_W);
  } else {
    c.fillRect(-s.sh - ARM_W + 1, torsoTop + 3 - swing, ARM_W, armLen);
    c.fillRect(s.sh - 1, torsoTop + 3 + swing, ARM_W, armLen);
  }
  const headY = torsoTop - s.head + 1;
  c.fillStyle = p.body;
  circle(c, 0, headY, s.head);
  c.fillStyle = p.trim;
  c.beginPath();
  c.arc(0, headY, s.head, Math.PI, 0);
  c.fill();
  c.fillStyle = '#ffffff';
  c.fillRect(s.head * 0.4, headY, EYE, EYE);
  if (p.cast) {
    c.fillStyle = `rgba(255,255,200,${GLOW_BASE + GLOW_PULSE * Math.sin((p.f / CAST_FRAMES) * Math.PI)})`;
    circle(c, 0, headY - s.head * 2.5, GLOW_R);
  }
}

function crawler(c, p) {
  const bodyY = -7;
  const phase = p.walk ? Math.sin((p.f * Math.PI) / (WALK_FRAMES / 2)) * 3 : 0;
  c.strokeStyle = p.trim;
  c.lineWidth = 2;
  for (let i = -1; i <= 1; i++) {
    const lx = i * 6;
    const dx = i % 2 === 0 ? phase : -phase;
    c.beginPath();
    c.moveTo(lx, bodyY);
    c.lineTo(lx - 9 + dx, bodyY + 3);
    c.lineTo(lx - 11 + dx, 0);
    c.moveTo(lx, bodyY);
    c.lineTo(lx + 9 - dx, bodyY + 3);
    c.lineTo(lx + 11 - dx, 0);
    c.stroke();
  }
  c.fillStyle = p.body;
  ellipse(c, 0, bodyY, 14, 7);
  c.fillStyle = p.trim;
  circle(c, 13, bodyY - 1, 4);
  c.fillStyle = '#ffffff';
  c.fillRect(14, bodyY - 2, EYE, EYE);
  if (p.attack) {
    c.fillStyle = p.trim;
    poly(c, [16, bodyY - 1, 22, bodyY - 4, 22, bodyY + 2]);
  }
}

function flier(c, p) {
  const hover = Math.sin((p.f * Math.PI) / (WALK_FRAMES / 2)) * HOVER_PX;
  const bodyY = -24 + hover;
  const flap = p.f % 2 === 0 ? -6 : 4;
  c.fillStyle = p.trim;
  poly(c, [-6, bodyY, -WING_SPAN, bodyY - 8 + flap, -WING_SPAN + 4, bodyY + 4]);
  poly(c, [6, bodyY, WING_SPAN, bodyY - 8 + flap, WING_SPAN - 4, bodyY + 4]);
  c.fillStyle = p.body;
  ellipse(c, 0, bodyY, 8, 6);
  circle(c, 7, bodyY - 3, 4);
  c.fillStyle = '#ffffff';
  c.fillRect(8, bodyY - 4, EYE, EYE);
  if (p.cast) {
    c.fillStyle = `rgba(255,255,200,${GLOW_BASE})`;
    circle(c, 0, bodyY - 12, GLOW_R);
  }
}

function blob(c, p) {
  const squish = 1 + Math.sin((p.f * Math.PI) / (WALK_FRAMES / 2)) * 0.1;
  const rx = 13 * squish;
  const ry = 10 / squish;
  c.fillStyle = p.body;
  ellipse(c, 0, -ry + 1, rx, ry);
  c.fillStyle = p.trim;
  ellipse(c, 0, -ry * 0.6, rx * 0.7, ry * 0.35);
  c.fillStyle = '#ffffff';
  c.fillRect(rx * 0.3, -ry - 1, EYE, EYE);
  c.fillRect(rx * 0.3 + 4, -ry, EYE, EYE);
}

function turret(c, p) {
  c.fillStyle = p.trim;
  poly(c, [-14, 0, 14, 0, 10, -8, -10, -8]);
  c.fillStyle = p.body;
  c.fillRect(-5, -26, 10, 18);
  c.fillStyle = p.trim;
  c.fillRect(2, -31 - (p.attack ? 2 : 0), 14 + (p.attack ? 4 : 0), 5);
  c.fillStyle = p.body;
  circle(c, 0, -29, 7);
  c.fillStyle = '#ffffff';
  c.fillRect(2, -31, EYE, EYE);
  if (p.cast) {
    c.fillStyle = `rgba(255,255,200,${GLOW_BASE})`;
    circle(c, 0, -29, GLOW_R + 4);
  }
}

function corpse(c, body, trim, flip) {
  c.fillStyle = body;
  ellipse(c, 0, -4, 15, 6);
  c.fillStyle = trim;
  circle(c, flip * 14, -5, 4);
  c.fillRect(-flip * 10 - 2, -7, 4, 3);
}

const SPECIAL = { crawler, flier, blob, turret };

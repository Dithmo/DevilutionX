/**
 * Missile core: fractional world-space projectiles with sub-stepped
 * collision against solid tiles (closed doors included) and the occupant
 * grid. Archetype behaviour (bolt, chain, wall, charge, …) is in
 * missile_archetypes.js. Damage always goes through combat.js (via
 * monster_deps) so resistances and block live in one place.
 */
import { isSolid } from '../world/tiles.js';
import { dirFromDelta } from '../world/pathfind.js';
import { deps } from './monster_deps.js';
import { occupantAt, actorsById, isAlly } from './monster_util.js';
import { staggerMonster } from './monster_update.js';
import { killMonster } from './monster.js';
import { ARCHETYPES } from './missile_archetypes.js';

const HALF = 0.5;
const PCT = 100;
const SPREAD_STEP = Math.PI / 8; // one 16-direction notch

function bal(game) {
  return game.balance.missiles;
}

function nextId(game) {
  if (!game.nextId) game.nextId = 1;
  return game.nextId++;
}

/** @returns {{x:number,y:number}} unit vector from `from` toward `to` (tile or dir) */
function aimVector(from, to, owner) {
  if (typeof to === 'number' || to === undefined || to === null) {
    const d = typeof to === 'number' ? to : owner ? owner.dir : 0;
    const v = [[1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]][((d % 8) + 8) % 8];
    const n = Math.hypot(v[0], v[1]);
    return { x: v[0] / n, y: v[1] / n };
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const n = Math.hypot(dx, dy);
  if (n === 0) return aimVector(from, undefined, owner);
  return { x: dx / n, y: dy / n };
}

/** Rotate a unit vector by `rad`. */
export function rotate(v, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Point a missile along a unit vector at its speed. */
export function setVelocity(ms, unit) {
  ms.vx = unit.x * ms.speed;
  ms.vy = unit.y * ms.speed;
  ms.dir = dirFromDelta(Math.round(unit.x * 2), Math.round(unit.y * 2));
  if (ms.dir < 0) ms.dir = 0;
}

/**
 * Create a missile. spec: `{archetype, owner, from:{x,y}, to:{x,y}|dir, skillId, level,
 * dmg:{min,max}, element, look, speed?, range?, radius?, count?, spread?, pierce?, typeId?, ally?}`.
 * Instant archetypes (nova, wall, blink, summon) do their work immediately and return a dead
 * missile whose `children` lists what they spawned.
 * @returns {object} Missile
 */
export function spawnMissile(game, spec) {
  const b = bal(game);
  const arch = b.arch[spec.archetype] || b.arch.bolt;
  const handler = ARCHETYPES[spec.archetype] || ARCHETYPES.bolt;
  const owner = spec.owner || null;
  const level = game.level;
  const from = spec.from || (owner ? { x: owner.tx, y: owner.ty } : { x: 0, y: 0 });
  const ownerKind = spec.ownerKind || (owner ? (owner.kind === 'player' ? 'player' : 'monster') : 'trap');
  const dmg = spec.dmg || { min: 0, max: 0 };
  const ms = {
    id: nextId(game), archetype: spec.archetype, ownerKind, ownerId: owner ? owner.id : 0, owner,
    friendly: owner ? isAlly(owner) : null, skillId: spec.skillId || null,
    x: from.x + HALF, y: from.y + HALF, tx: from.x, ty: from.y, vx: 0, vy: 0, dir: owner ? owner.dir : 0,
    speed: spec.speed !== undefined ? spec.speed : arch.speed || 0,
    range: spec.range !== undefined ? spec.range : arch.range !== undefined ? arch.range : b.defaultRange, dist: 0,
    dmgMin: dmg.min, dmgMax: dmg.max, element: spec.element || 'phys', level: spec.level || 1,
    hitSet: new Set(), pierce: spec.pierce !== undefined ? spec.pierce : spec.archetype === 'pierce',
    radius: spec.radius !== undefined ? spec.radius : arch.radius || 0,
    state: {}, look: { ...(arch.look || {}), ...(spec.look || {}) }, dead: false, spec, children: [],
    targetTile: typeof spec.to === 'object' && spec.to ? { x: spec.to.x, y: spec.to.y } : null,
  };
  const count = spec.count || 1;
  const aim = aimVector(from, spec.to, owner);
  if (count > 1 && ms.speed > 0) {
    const spread = (spec.spread || 1) * SPREAD_STEP;
    for (let i = 0; i < count; i++) {
      const child = spawnMissile(game, { ...spec, count: 1, aimUnit: rotate(aim, spread * (i - (count - 1) / 2)) });
      ms.children.push(child);
    }
    ms.dead = true;
    return ms;
  }
  setVelocity(ms, spec.aimUnit || aim);
  if (handler.spawn) handler.spawn(game, ms, spec);
  if (!ms.dead) level.missiles.push(ms);
  return ms;
}

/** @returns {boolean} may this missile damage `actor`? */
export function canHit(ms, actor) {
  if (!actor || actor.dead || actor.id === ms.ownerId || actor.hidden) return false;
  if (ms.friendly === null) return true;
  return ms.friendly ? !isAlly(actor) : isAlly(actor);
}

/**
 * Apply the missile's damage to an actor through combat.js. Arrows roll
 * to-hit; everything else lands. @returns {number} damage dealt (0 = miss)
 */
export function missileDamage(game, ms, actor, scale = 1) {
  const b = bal(game);
  const owner = ms.owner;
  const source = owner || ms;
  let dmg = 0;
  if (actor.kind === 'player') {
    if (ms.archetype === 'arrow' && owner && owner.kind === 'monster') {
      const r = deps.rollMonsterHitsPlayer(game, owner, actor);
      if (!r.hit || r.blocked) { game.bus.emit('sfx', { name: r.blocked ? 'block' : 'miss', x: actor.tx, y: actor.ty }); return 0; }
      dmg = r.dmg;
    } else dmg = game.rng.range(ms.dmgMin, ms.dmgMax);
    dmg = Math.max(1, Math.round(dmg * scale));
    deps.applyDamageToPlayer(game, actor, dmg, ms.element, source);
  } else {
    if (ms.archetype === 'arrow' && owner && owner.kind === 'player') {
      if (game.rng.rand(PCT) < ms.dist * b.arrowDistPenalty) return 0;
      const r = deps.rollPlayerHitsMonster(game, owner, actor);
      if (!r.hit) { game.bus.emit('sfx', { name: 'miss', x: actor.tx, y: actor.ty }); return 0; }
      dmg = r.dmg;
    } else dmg = game.rng.range(ms.dmgMin, ms.dmgMax);
    dmg = Math.max(1, Math.round(dmg * scale));
    deps.applyDamageToMonster(game, actor, dmg, ms.element, source);
    staggerMonster(game, actor, dmg, owner);
    actor.lastHp = actor.hp;
    if (actor.hp <= 0 && !actor.dead) killMonster(game, actor, owner);
  }
  game.bus.emit('sfx', { name: b.impactSfx[ms.element] || 'hit', x: actor.tx, y: actor.ty });
  return dmg;
}

/** Every live actor hostile to the missile within Chebyshev `r` tiles of (tx,ty). */
export function actorsInBlast(game, ms, tx, ty, r, byId = actorsById(game)) {
  const out = [];
  for (const a of byId.values()) {
    if (Math.max(Math.abs(a.tx - tx), Math.abs(a.ty - ty)) <= r && canHit(ms, a)) out.push(a);
  }
  return out;
}

/**
 * Advance a moving missile with sub-stepping, calling the handler's
 * `onHit(game, ms, actor)` / `onWall(game, ms)` as collisions occur.
 */
export function moveMissile(game, ms, byId, handler) {
  const level = game.level;
  const speed = Math.hypot(ms.vx, ms.vy);
  if (speed === 0) return;
  const steps = Math.max(1, Math.ceil(speed / bal(game).subStep));
  const sx = ms.vx / steps;
  const sy = ms.vy / steps;
  for (let i = 0; i < steps && !ms.dead; i++) {
    ms.x += sx;
    ms.y += sy;
    ms.dist += speed / steps;
    const tx = Math.floor(ms.x);
    const ty = Math.floor(ms.y);
    ms.tx = tx;
    ms.ty = ty;
    if (isSolid(level.tiles, tx, ty)) {
      ms.x -= sx * bal(game).impactBack;
      ms.y -= sy * bal(game).impactBack;
      if (handler.onWall) handler.onWall(game, ms); else ms.dead = true;
      return;
    }
    const occ = occupantAt(level, tx, ty);
    if (occ === 0 || ms.hitSet.has(occ)) continue;
    const actor = byId.get(occ);
    if (!canHit(ms, actor)) continue;
    ms.hitSet.add(occ);
    if (handler.onHit) handler.onHit(game, ms, actor, byId);
    else { missileDamage(game, ms, actor); if (!ms.pierce) ms.dead = true; }
  }
}

/**
 * Advance every missile on the level one tick: move/collide, run archetype
 * ticks, expire, and drop dead missiles from `level.missiles`.
 */
export function updateMissiles(game) {
  const level = game.level;
  if (!level || !level.missiles) return;
  const byId = actorsById(game);
  const list = level.missiles.slice();
  for (const ms of list) {
    if (ms.dead) continue;
    const handler = ARCHETYPES[ms.archetype] || ARCHETYPES.bolt;
    if (handler.tick) handler.tick(game, ms, byId);
    else moveMissile(game, ms, byId, handler);
    if (ms.dead) continue;
    if (--ms.range <= 0) {
      if (handler.onExpire) handler.onExpire(game, ms, byId);
      ms.dead = true;
    }
  }
  const keep = [];
  for (const ms of level.missiles) if (!ms.dead) keep.push(ms);
  level.missiles.length = 0;
  for (const ms of keep) level.missiles.push(ms);
}

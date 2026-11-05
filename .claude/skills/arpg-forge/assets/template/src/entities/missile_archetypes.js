/**
 * Missile archetype handlers. Each entry may define:
 *   spawn(game, ms, spec)      one-time setup (instant archetypes finish here and set ms.dead)
 *   tick(game, ms, byId)       per-tick update (default: move + collide)
 *   onHit(game, ms, actor)     actor collision (default: damage, die unless pierce)
 *   onWall(game, ms)           solid tile collision (default: die)
 *   onExpire(game, ms)         range ran out
 * ref §11 for the source behaviours each one condenses.
 */
import { isWalkable } from '../world/tiles.js';
import { lineOfSight } from '../world/fov.js';
import { occupantAt, setOccupant, tileFree, findFreeTileNear, stepAllowed, dirDelta, isAlly } from './monster_util.js';
import { monsterAttackPlayer, monsterStand, startAnim } from './monster_update.js';
import { spawnMonster } from './monster.js';
import { missileDamage, actorsInBlast, moveMissile, setVelocity, rotate, spawnMissile, canHit } from './missile.js';

const HALF = 0.5;
const PCT = 100;
const TWO_PI = Math.PI * 2;

function bal(game) {
  return game.balance.missiles;
}

function worldPosOf(a) {
  return { x: a.tx + (a.ox || 0) + HALF, y: a.ty + (a.oy || 0) + HALF };
}

/** Nearest actor the missile may hit within `r` tiles (Euclid on world positions), excluding hitSet. */
function nearestTarget(game, ms, r, needLos, byId) {
  let best = null;
  let bestD = Infinity;
  for (const a of byId.values()) {
    if (!canHit(ms, a) || ms.hitSet.has(a.id)) continue;
    const p = worldPosOf(a);
    const d = Math.hypot(p.x - ms.x, p.y - ms.y);
    if (d > r || d >= bestD) continue;
    if (needLos && !lineOfSight(game.level.tiles, ms.tx, ms.ty, a.tx, a.ty)) continue;
    best = a;
    bestD = d;
  }
  return best;
}

function spark(game, x, y, look) {
  spawnMissile(game, { archetype: 'spark', from: { x: Math.floor(x), y: Math.floor(y) }, look });
}

function explode(game, ms, byId) {
  const r = ms.radius || bal(game).arch.explode.radius;
  for (const a of actorsInBlast(game, ms, ms.tx, ms.ty, r, byId)) missileDamage(game, ms, a);
  game.bus.emit('sfx', { name: 'explode', x: ms.tx, y: ms.ty });
  spark(game, ms.x, ms.y, { ...ms.look, size: (ms.look.size || 4) * 2 });
  ms.dead = true;
}

/** Move an actor instantly to a tile, keeping the occupant grid consistent. */
function teleportActor(game, a, x, y) {
  const level = game.level;
  if (occupantAt(level, a.tx, a.ty) === a.id) setOccupant(level, a.tx, a.ty, 0);
  setOccupant(level, x, y, a.id);
  a.tx = x;
  a.ty = y;
  a.ox = 0;
  a.oy = 0;
  a.path = null;
  if (a.kind === 'monster') a.stepT = 1;
}

function endCharge(game, ms) {
  const m = ms.owner;
  ms.dead = true;
  if (!m || m.dead) return;
  m.charging = false;
  m.ox = 0;
  m.oy = 0;
  monsterStand(game, m, false);
}

export const ARCHETYPES = {
  /** Straight projectile; dies on the first thing it hits. ref §11.3 */
  bolt: {},

  /** Straight projectile that passes through actors, hitting each once. */
  pierce: {},

  /** Steers toward the nearest enemy within seekRadius, turn rate capped. ref §11.7 */
  homing: {
    tick(game, ms, byId) {
      const c = bal(game).arch.homing;
      const t = nearestTarget(game, ms, c.seekRadius, true, byId);
      if (t) {
        const p = worldPosOf(t);
        const want = Math.atan2(p.y - ms.y, p.x - ms.x);
        const cur = Math.atan2(ms.vy, ms.vx);
        let delta = want - cur;
        while (delta > Math.PI) delta -= TWO_PI;
        while (delta < -Math.PI) delta += TWO_PI;
        const turn = Math.max(-c.turnRate, Math.min(c.turnRate, delta));
        setVelocity(ms, rotate({ x: Math.cos(cur), y: Math.sin(cur) }, turn));
      }
      moveMissile(game, ms, byId, ARCHETYPES.homing);
    },
  },

  /** Spawns `count` piercing bolts radially and is done. ref §11.10 */
  nova: {
    spawn(game, ms, spec) {
      const c = bal(game).arch.nova;
      const n = spec.count || c.count;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TWO_PI;
        ms.children.push(spawnMissile(game, {
          ...spec, archetype: 'bolt', count: 1, pierce: true, speed: spec.speed || c.speed, range: spec.range || c.range,
          aimUnit: { x: Math.cos(a), y: Math.sin(a) }, look: { ...c.look, ...(spec.look || {}) },
        }));
      }
      game.bus.emit('sfx', { name: 'cast', x: ms.tx, y: ms.ty });
      ms.dead = true;
    },
  },

  /** On hit, jumps to the nearest other enemy within jumpRadius; damage decays per jump. ref §11.9 */
  chain: {
    spawn(game, ms, spec) {
      const c = bal(game).arch.chain;
      ms.state.jumps = spec.jumps !== undefined ? spec.jumps : c.jumps;
      ms.state.jumpRadius = spec.radius || c.jumpRadius;
      ms.state.range0 = ms.range;
    },
    onHit(game, ms, actor, byId) {
      const c = bal(game).arch.chain;
      missileDamage(game, ms, actor);
      const next = ms.state.jumps > 0 ? nearestTarget(game, ms, ms.state.jumpRadius, true, byId) : null;
      if (!next) { ms.dead = true; return; }
      ms.state.jumps--;
      ms.dmgMin = Math.max(1, Math.round(ms.dmgMin * c.decay));
      ms.dmgMax = Math.max(1, Math.round(ms.dmgMax * c.decay));
      ms.range = ms.state.range0;
      const p = worldPosOf(actor);
      ms.x = p.x;
      ms.y = p.y;
      const q = worldPosOf(next);
      const n = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      setVelocity(ms, { x: (q.x - p.x) / n, y: (q.y - p.y) / n });
    },
  },

  /** Line of stationary damaging segments perpendicular to the cast direction. ref §11.12 */
  wall: {
    spawn(game, ms, spec) {
      const c = bal(game).arch.wall;
      const centre = ms.targetTile || { x: ms.tx + Math.round(ms.vx / (ms.speed || 1)) * 2, y: ms.ty + Math.round(ms.vy / (ms.speed || 1)) * 2 };
      const n = spec.segments || (spec.length ? 2 * spec.length + 1 : 0) || spec.count || c.segments;
      const perp = dirDelta(((ms.dir + 2) % 8 + 8) % 8);
      const place = (x, y) => {
        if (!isWalkable(game.level.tiles, x, y)) return false;
        ms.children.push(spawnMissile(game, {
          ...spec, archetype: 'wallSeg', count: 1, length: 0, from: { x, y }, range: spec.lifetime || spec.duration || c.lifetime, look: { ...c.look, ...(spec.look || {}) },
        }));
        return true;
      };
      place(centre.x, centre.y);
      const half = Math.floor((n - 1) / 2);
      for (const sgn of [1, -1]) {
        for (let k = 1; k <= half + (sgn === 1 && (n - 1) % 2 ? 1 : 0); k++) {
          if (!place(centre.x + perp.x * k * sgn, centre.y + perp.y * k * sgn)) break;
        }
      }
      ms.dead = true;
    },
  },

  /** One wall tile: damages whoever stands on it every tickPeriod ticks. */
  wallSeg: {
    tick(game, ms, byId) {
      const c = bal(game).arch.wall;
      if (ms.range % c.tickPeriod !== 0) return;
      const a = byId.get(occupantAt(game.level, ms.tx, ms.ty));
      if (canHit(ms, a)) missileDamage(game, ms, a, c.dmgPct / PCT);
    },
  },

  /** Stationary area that damages everyone inside every tickPeriod ticks. ref §11.13 */
  groundAoe: {
    spawn(game, ms, spec) {
      const c = bal(game).arch.groundAoe;
      const t = ms.targetTile || { x: ms.tx, y: ms.ty };
      ms.x = t.x + HALF;
      ms.y = t.y + HALF;
      ms.tx = t.x;
      ms.ty = t.y;
      ms.vx = 0;
      ms.vy = 0;
      ms.radius = spec.radius || c.radius;
      ms.range = spec.lifetime || spec.duration || spec.range || c.lifetime;
    },
    tick(game, ms, byId) {
      const c = bal(game).arch.groundAoe;
      if (ms.range % c.tickPeriod !== 0) return;
      for (const a of byId.values()) {
        const p = worldPosOf(a);
        if (canHit(ms, a) && Math.hypot(p.x - ms.x, p.y - ms.y) <= ms.radius) missileDamage(game, ms, a, c.dmgPct / PCT);
      }
    },
  },

  /** Physical bolt with a to-hit roll (see missileDamage). ref §11.1 */
  arrow: {},

  /** Bolt that bursts in a radius on hit, wall or expiry. ref §11.4 */
  explode: {
    onHit(game, ms, actor, byId) { explode(game, ms, byId); },
    onWall(game, ms) { explode(game, ms, null); },
    onExpire(game, ms, byId) { explode(game, ms, byId); },
  },

  /** Carries its owner in a straight line at speedMult × walk speed until something is hit. ref §11.16 */
  charge: {
    spawn(game, ms) {
      const m = ms.owner;
      const c = bal(game).arch.charge;
      if (!m || m.kind !== 'monster') { ms.dead = true; return; }
      const n = Math.hypot(ms.vx, ms.vy) || 1;
      const unit = n === 1 && ms.vx === 0 && ms.vy === 0 ? { x: 1, y: 0 } : { x: ms.vx / n, y: ms.vy / n };
      ms.speed = c.speedMult / Math.max(1, m.speed.walkTicksPerTile);
      setVelocity(ms, unit);
      ms.range = c.range;
      m.charging = true;
      m.dir = ms.dir;
      m.ox = 0;
      m.oy = 0;
      startAnim(game, m, 'walk', m.speed.walkTicksPerTile);
      game.bus.emit('sfx', { name: (m.sfx && m.sfx.attack) || 'swing', x: m.tx, y: m.ty });
    },
    tick(game, ms, byId) {
      const m = ms.owner;
      if (!m || m.dead || !m.charging) { ms.dead = true; return; }
      const level = game.level;
      const steps = Math.max(1, Math.ceil(ms.speed / bal(game).subStep));
      const sx = ms.vx / steps;
      const sy = ms.vy / steps;
      for (let i = 0; i < steps; i++) {
        ms.x += sx;
        ms.y += sy;
        const tx = Math.floor(ms.x);
        const ty = Math.floor(ms.y);
        if (tx !== m.tx || ty !== m.ty) {
          const dir = ((Math.sign(tx - m.tx) + 1) * 3 + (Math.sign(ty - m.ty) + 1));
          const dirIdx = [4, 3, 2, 5, -1, 1, 6, 7, 0][dir];
          const blockedCorner = dirIdx >= 0 && !stepAllowed(level.tiles, m.tx, m.ty, dirIdx);
          if (blockedCorner || !tileFree(level, tx, ty, m.id)) {
            const victim = byId.get(occupantAt(level, tx, ty));
            if (victim && canHit(ms, victim)) monsterAttackPlayer(game, m, victim, true);
            endCharge(game, ms);
            return;
          }
          if (occupantAt(level, m.tx, m.ty) === m.id) setOccupant(level, m.tx, m.ty, 0);
          setOccupant(level, tx, ty, m.id);
          m.tx = tx;
          m.ty = ty;
        }
        m.ox = ms.x - HALF - m.tx;
        m.oy = ms.y - HALF - m.ty;
      }
      ms.tx = m.tx;
      ms.ty = m.ty;
    },
    onExpire(game, ms) { endCharge(game, ms); },
  },

  /** Instant teleport of the owner to the target tile (or nearest free). ref §11.20 */
  blink: {
    spawn(game, ms) {
      const a = ms.owner;
      const c = bal(game).arch.blink;
      ms.dead = true;
      ms.fizzled = true;
      if (!a || a.dead || !ms.targetTile) return;
      const t = ms.targetTile;
      const dest = tileFree(game.level, t.x, t.y, a.id) && lineOfSight(game.level.tiles, a.tx, a.ty, t.x, t.y) ? t : findFreeTileNear(game.level, t.x, t.y, c.searchRadius);
      if (!dest || (dest.x === a.tx && dest.y === a.ty)) return;
      ms.fizzled = false;
      spark(game, a.tx + HALF, a.ty + HALF, ms.look);
      teleportActor(game, a, dest.x, dest.y);
      spark(game, dest.x + HALF, dest.y + HALF, ms.look);
      game.bus.emit('sfx', { name: 'portal', x: dest.x, y: dest.y });
    },
  },

  /** Spawns a monster of `spec.typeId` (ally ward when the owner is on the player's side). ref §2.9 */
  summon: {
    spawn(game, ms, spec) {
      ms.dead = true;
      ms.fizzled = true;
      const owner = ms.owner;
      const t = ms.targetTile || { x: ms.tx, y: ms.ty };
      const friendly = spec.ally !== undefined ? spec.ally : !!(owner && isAlly(owner));
      const w = bal(game).ward;
      const typeId = spec.typeId || spec.special || (owner && owner.special) || (friendly ? w.typeId : null);
      if (!typeId) return;
      const lvl = ms.level || 1;
      const opts = { ally: friendly, ownerId: owner ? owner.id : 0, noLoot: true };
      if (friendly) {
        opts.lifeTicks = spec.lifetime || spec.duration || w.lifetime;
        opts.stats = { hp: w.hpBase + w.hpPerLevel * lvl, dmgMin: w.dmgBase + w.dmgPerLevel * lvl, dmgMax: w.dmgBase + 2 * w.dmgPerLevel * lvl, ac: w.ac, toHit: w.toHitBase + w.toHitPerLevel * lvl };
      }
      const m = spawnMonster(game, typeId, t.x, t.y, opts);
      if (!m) return;
      ms.fizzled = false;
      if (friendly) {
        m.ai = 'ally';
        m.awake = true;
        m.reach = spec.radius || w.reach;
        if (ms.dmgMax > 0) m.missile = { archetype: 'bolt', element: ms.element, dmg: [ms.dmgMin, ms.dmgMax] }; // ward spits the skill's bolt
      }
      ms.children.push(m);
      spark(game, m.tx + HALF, m.ty + HALF, ms.look);
      game.bus.emit('sfx', { name: 'cast', x: m.tx, y: m.ty });
    },
  },

  /** Cosmetic: sits still for a few ticks. */
  spark: {
    tick() {},
  },
};

export default ARCHETYPES;

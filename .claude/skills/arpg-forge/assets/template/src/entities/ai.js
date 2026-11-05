/**
 * Monster AI archetypes. Each entry is `(game, m) => void`, called once per
 * tick while the monster stands still and is awake; it starts at most one
 * action (step, attack, shot, special, delay). Probabilities are a·INT + b
 * percent from data/balance/monsters.js `ai`. ref §7.
 */
import { dist } from '../world/pathfind.js';
import { lineOfSight } from '../world/fov.js';
import {
  monsterApproach, monsterRetreat, monsterWander, monsterStepFan, monsterBeginAttack, monsterBeginShoot,
  monsterDelay, walkGate, aiChance, monsterFace, startAnim,
} from './monster_update.js';
import { nearestEnemy, actorsSeeEachOther, tileFree, oppositeDir, dirToward, turnDir, dirDelta, findFreeTileNear } from './monster_util.js';
import { spawnMissile } from './missile.js';

const PCT = 100;
const ADJ = 1;
const RECENT_HIT_TICKS = 3;
const BLINK_AWAY_TILES = 4;

function cfg(game, key) {
  return game.balance.monsters.ai[key];
}

/** Gather what the archetype needs: nearest enemy, where to head, distance. */
function situation(game, m) {
  const near = nearestEnemy(game, m);
  const ent = near ? near.ent : null;
  const visible = !!ent && actorsSeeEachOther(game.level, m, ent);
  let pos = visible ? { x: ent.tx, y: ent.ty } : m.target || null;
  if (visible) { m.target = pos; m.targetId = ent.id; }
  if (!visible && m.leaderId) {
    const leader = game.level.monsters.find((o) => o.id === m.leaderId);
    if (leader && !leader.dead && dist(m.tx, m.ty, leader.tx, leader.ty) > game.balance.monsters.pack.radius) pos = { x: leader.tx, y: leader.ty };
  }
  return { ent, pos, d: ent ? near.d : Infinity, visible, I: m.intelligence };
}

/** Pause and remember that we paused (the next think acts for sure). ref §7.3 */
function pause(game, m, ab, rand) {
  monsterDelay(m, Math.max(1, ab[0] * m.intelligence + ab[1] + game.rng.rand(rand)));
  m.aiState.paused = true;
}

/** Walk toward pos, or idle briefly when boxed in. @returns {boolean} */
function approachOrWait(game, m, pos) {
  if (monsterApproach(game, m, pos.x, pos.y)) return true;
  monsterDelay(m, game.rng.range(5, 10));
  return false;
}

/** Default melee cadence (skeleton melee). ref §7.3 */
function meleeCore(game, m, s, c) {
  if (!s.pos) return;
  const paused = m.aiState.paused;
  m.aiState.paused = false;
  if (s.d >= 2) {
    m.mode = 'chase';
    if (paused || game.rng.rand(PCT) >= c.pause[0] * s.I + c.pause[1]) approachOrWait(game, m, s.pos);
    else pause(game, m, c.pauseFar, c.pauseRand);
    return;
  }
  monsterFace(m, s.ent.tx, s.ent.ty);
  if (paused || aiChance(game, m, c.attack)) monsterBeginAttack(game, m, s.ent);
  else pause(game, m, c.pauseNear, c.pauseRand);
}

/** Gate-driven approach + adjacent attack chance (bruiser / avoidance). */
function gatedMelee(game, m, s, gate, attack) {
  if (!s.pos) return;
  if (s.d >= 2) {
    m.mode = 'chase';
    if (walkGate(game, m, gate)) approachOrWait(game, m, s.pos);
    return;
  }
  monsterFace(m, s.ent.tx, s.ent.ty);
  if (aiChance(game, m, attack)) monsterBeginAttack(game, m, s.ent);
}

/** Can the monster shoot the target? LOS from its tile. */
function canShoot(game, m, ent) {
  return !!ent && lineOfSight(game.level.tiles, m.tx, m.ty, ent.tx, ent.ty);
}

/** Teleport `tiles` away from the threat (or next to it when `toward`). */
function blink(game, m, from, tiles) {
  const d = dirDelta(oppositeDir(dirToward(m.tx, m.ty, from.x, from.y, m.dir)));
  spawnMissile(game, { archetype: 'blink', owner: m, from: { x: m.tx, y: m.ty }, to: { x: m.tx + d.x * tiles, y: m.ty + d.y * tiles } });
  m.aiState.blinkTick = game.tick;
}

/** Is the straight line to (x,y) free of walls and actors? ref §7.6 LineClear(IsTileAvailable) */
function lineFree(game, m, x, y) {
  const dx = Math.sign(x - m.tx);
  const dy = Math.sign(y - m.ty);
  const adx = Math.abs(x - m.tx);
  const ady = Math.abs(y - m.ty);
  if (!(dx === 0 || dy === 0 || adx === ady)) return false;
  const n = Math.max(adx, ady);
  for (let i = 1; i < n; i++) if (!tileFree(game.level, m.tx + dx * i, m.ty + dy * i, m.id)) return false;
  return true;
}

function liveMinions(game, m) {
  let n = 0;
  for (const o of game.level.monsters) if (!o.dead && o.ownerId === m.id) n++;
  return n;
}

function summonAt(game, m, typeId, count, ally = false) {
  for (let i = 0; i < count; i++) {
    const spot = findFreeTileNear(game.level, m.tx, m.ty, 2);
    if (!spot) return;
    spawnMissile(game, { archetype: 'summon', owner: m, from: { x: m.tx, y: m.ty }, to: spot, typeId, ally });
  }
  startAnim(game, m, 'special', m.speed.attackTicks);
  m.mode = 'special';
}

/** Archetype table keyed by `MonsterType.ai`. */
export const AI = {
  /** Straight chaser. ref §7.3 */
  rusher(game, m) {
    meleeCore(game, m, situation(game, m), cfg(game, 'rusher'));
  },

  /** Hit, then back off a few steps; flees when badly hurt. ref §7.13 + §7.9 retreat */
  skirmisher(game, m) {
    const c = cfg(game, 'skirmisher');
    const s = situation(game, m);
    const st = m.aiState;
    if (!s.pos) return;
    const hurt = m.hp * PCT < m.hpMax * c.fleeHpPct;
    if ((st.backoff > 0 || hurt) && s.d <= 4) {
      m.mode = 'flee';
      st.backoff = Math.max(0, (st.backoff || 0) - 1);
      if (monsterRetreat(game, m, s.pos.x, s.pos.y)) return;
      if (s.d <= ADJ) { monsterBeginAttack(game, m, s.ent); return; }
    }
    st.backoff = 0;
    if (s.d >= 2) {
      m.mode = 'chase';
      if (s.d >= 4 && game.rng.chance(c.circleChance)) { monsterStepFan(game, m, turnDir(dirToward(m.tx, m.ty, s.pos.x, s.pos.y, m.dir), game.rng.chance(50) ? 2 : -2), false); return; }
      if (walkGate(game, m, c.walkGate)) approachOrWait(game, m, s.pos);
      return;
    }
    monsterFace(m, s.ent.tx, s.ent.ty);
    if (aiChance(game, m, c.attack)) {
      monsterBeginAttack(game, m, s.ent);
      st.backoff = c.backoffSteps;
    }
  },

  /** Keeps 3–6 tiles away and shoots with LOS. ref §7.4 / §7.14 */
  ranged(game, m) {
    const c = cfg(game, 'ranged');
    const s = situation(game, m);
    if (!s.pos) return;
    monsterFace(m, s.pos.x, s.pos.y);
    if (s.d <= ADJ && aiChance(game, m, c.retreatAdjacent) && monsterRetreat(game, m, s.pos.x, s.pos.y)) { m.mode = 'flee'; return; }
    if (s.d < c.keepMin && walkGate(game, m, c.retreatGate) && monsterRetreat(game, m, s.pos.x, s.pos.y)) { m.mode = 'flee'; return; }
    if (s.visible && canShoot(game, m, s.ent) && s.d <= c.keepMax + 2) {
      if (aiChance(game, m, c.shoot)) {
        m.mode = 'attack';
        monsterBeginShoot(game, m, s.ent);
        monsterDelay(m, game.rng.range(c.cooldown[0], c.cooldown[1]));
      }
      return;
    }
    if (s.d <= ADJ) { monsterBeginAttack(game, m, s.ent); return; }
    m.mode = 'chase';
    approachOrWait(game, m, s.pos);
  },

  /** Bolt caster that blinks when hit or cornered and flees when hurt. ref §7.17 */
  caster(game, m) {
    const c = cfg(game, 'caster');
    const s = situation(game, m);
    const st = m.aiState;
    if (!s.pos) return;
    monsterFace(m, s.pos.x, s.pos.y);
    const recentlyHit = st.lastHitTick !== undefined && game.tick - st.lastHitTick <= RECENT_HIT_TICKS && st.lastHitTick !== st.blinkTick;
    const hurt = m.hp * PCT < m.hpMax * c.fleeHpPct;
    if (recentlyHit && game.rng.chance(c.blinkWhenHit)) { st.lastHitTick = undefined; blink(game, m, s.pos, BLINK_AWAY_TILES); return; }
    if (hurt && s.d < c.keepMin) {
      m.mode = 'flee';
      if (monsterRetreat(game, m, s.pos.x, s.pos.y)) return;
      blink(game, m, s.pos, BLINK_AWAY_TILES);
      return;
    }
    if (s.d <= ADJ) {
      if (!monsterRetreat(game, m, s.pos.x, s.pos.y) && game.rng.chance(c.blinkCornered)) { blink(game, m, s.pos, BLINK_AWAY_TILES); return; }
      if (m.anim === 'stand') monsterBeginAttack(game, m, s.ent);
      return;
    }
    if (s.visible && canShoot(game, m, s.ent)) {
      if (aiChance(game, m, c.cast)) { m.mode = 'attack'; monsterBeginShoot(game, m, s.ent); return; }
      if (s.d < c.keepMin && monsterRetreat(game, m, s.pos.x, s.pos.y)) return;
      pause(game, m, c.delay, c.delayRand);
      return;
    }
    m.mode = 'chase';
    approachOrWait(game, m, s.pos);
  },

  /** Lies hidden until the target is within 2–3 tiles, then rushes. ref §7.12 */
  ambusher(game, m) {
    const c = cfg(game, 'ambusher');
    const s = situation(game, m);
    if (m.hidden) {
      const reveal = Math.max(c.revealMin, c.revealDist[0] * s.I + c.revealDist[1]);
      if (!s.ent || s.d > reveal) return;
      m.hidden = false;
      m.mode = 'wake';
      game.bus.emit('sfx', { name: (m.sfx && m.sfx.attack) || 'monsterHit', x: m.tx, y: m.ty });
      return;
    }
    meleeCore(game, m, s, cfg(game, 'rusher'));
  },

  /** Charges in a straight line when aligned at 2–8 tiles. ref §7.6 */
  charger(game, m) {
    const c = cfg(game, 'charger');
    const s = situation(game, m);
    if (!s.pos) return;
    const cooled = m.aiState.chargeTick === undefined || game.tick - m.aiState.chargeTick >= c.cooldown;
    if (s.visible && cooled && s.d >= c.chargeMin && s.d <= c.chargeMax && lineFree(game, m, s.ent.tx, s.ent.ty) && aiChance(game, m, c.charge)) {
      m.mode = 'special';
      m.aiState.chargeTick = game.tick;
      spawnMissile(game, { archetype: 'charge', owner: m, from: { x: m.tx, y: m.ty }, to: { x: s.ent.tx, y: s.ent.ty } });
      return;
    }
    gatedMelee(game, m, s, c.walkGate, c.attack);
  },

  /** Summons one `special` minion every N ticks up to a cap, otherwise skirmishes. ref §7.20 */
  spawner(game, m) {
    const c = cfg(game, 'spawner');
    const s = situation(game, m);
    const st = m.aiState;
    const due = st.summonTick === undefined || game.tick - st.summonTick >= c.summonEvery;
    if (m.special && due && s.pos && s.d >= c.minDist && liveMinions(game, m) < c.cap && aiChance(game, m, c.summonChance)) {
      st.summonTick = game.tick;
      summonAt(game, m, m.special, 1, false);
      return;
    }
    AI.skirmisher(game, m);
  },

  /** Erratic: random moves half the time, bites and darts away. ref §7.9 */
  flier(game, m) {
    const c = cfg(game, 'flier');
    const s = situation(game, m);
    const st = m.aiState;
    if (!s.pos) return;
    if (st.retreat > 0) {
      st.retreat--;
      m.mode = 'flee';
      const away = oppositeDir(dirToward(m.tx, m.ty, s.pos.x, s.pos.y, m.dir));
      monsterStepFan(game, m, st.retreat === 0 ? turnDir(away, game.rng.chance(50) ? 2 : -2) : away, false);
      return;
    }
    if (s.d >= 2) {
      m.mode = 'chase';
      if (game.rng.chance(c.randomMove)) { monsterWander(game, m); return; }
      if (walkGate(game, m, c.walkGate)) approachOrWait(game, m, s.pos);
      return;
    }
    monsterFace(m, s.ent.tx, s.ent.ty);
    if (aiChance(game, m, c.attack)) { monsterBeginAttack(game, m, s.ent); st.retreat = c.retreatSteps; }
  },

  /** Slow, relentless, knocks back, never staggers (flags set at spawn). ref §7.2 */
  tank(game, m) {
    const c = cfg(game, 'tank');
    gatedMelee(game, m, situation(game, m), c.walkGate, c.attack);
  },

  /** Ranged volley at distance, melee up close, one summon wave at half HP. ref §7.15 + §7.8 */
  boss(game, m) {
    const c = cfg(game, 'boss');
    const s = situation(game, m);
    const st = m.aiState;
    if (!s.pos) return;
    if (!st.summoned && m.hp * PCT <= m.hpMax * c.summonHpPct) {
      st.summoned = true;
      const typeId = m.special || m.typeId;
      summonAt(game, m, typeId, c.summonCount, false);
      game.bus.emit('message', { text: `${m.name} calls for aid!`, color: game.theme.palette ? game.theme.palette.danger : '#f44' });
      return;
    }
    if (s.d >= c.volleyDist && s.visible && m.missile && canShoot(game, m, s.ent) && aiChance(game, m, c.volley)) {
      m.mode = 'attack';
      monsterBeginShoot(game, m, s.ent, { count: c.volleyCount, spread: c.volleySpread });
      return;
    }
    gatedMelee(game, m, s, c.walkGate, c.attack);
  },

  /** Player-allied ward: attack the nearest hostile, otherwise follow the player. ref §7.21 */
  ally(game, m) {
    const c = cfg(game, 'ally');
    const near = nearestEnemy(game, m, Math.max(c.searchRadius, m.reach || 0), false);
    if (near) {
      m.mode = near.d <= ADJ ? 'attack' : 'chase';
      if (near.d <= ADJ) { monsterBeginAttack(game, m, near.ent); return; }
      if (m.missile && near.d <= (m.reach || c.shootRange) && canShoot(game, m, near.ent)) { monsterBeginShoot(game, m, near.ent); return; }
      if (m.reach && near.d > m.reach) return; // turret-style wards hold position
      approachOrWait(game, m, { x: near.ent.tx, y: near.ent.ty });
      return;
    }
    const p = game.player;
    if (p && dist(m.tx, m.ty, p.tx, p.ty) > c.followDist) approachOrWait(game, m, { x: p.tx, y: p.ty });
  },
};

export default AI;

/**
 * Per-tick monster simulation: hit recovery → walking / attack resolution →
 * perception → AI think → animation. Also the movement and attack primitives
 * the AI archetypes call (monsterStep, monsterApproach, monsterRetreat,
 * monsterAttackPlayer, monsterShoot, monsterFacePlayer).
 *
 * Walking model (docs/CONTRACTS.md): the actor occupies its destination tile
 * from the first tick of a step; `tx,ty` jump to the destination and
 * `ox,oy` start at (-dx,-dy) and slide to 0 over `walkTicksPerTile` ticks.
 */
import { T, isSolid, hasFlag, clearFlag } from '../world/tiles.js';
import { dist, findPath, dirFromDelta } from '../world/pathfind.js';
import { lineOfSight } from '../world/fov.js';
import { deps } from './monster_deps.js';
import {
  occupantAt, setOccupant, tileFree, stepAllowed, dirToward, turnDir, oppositeDir, dirDelta,
  nearestEnemy, actorsSeeEachOther, isAlly,
} from './monster_util.js';
import { killMonster, wakeMonster } from './monster.js';
import { AI } from './ai.js';
import { spawnMissile } from './missile.js';

const RETHINK_CAP = 2;
const STEP_DONE = 1 - 1e-6;
const PCT = 100;

function bal(game) {
  return game.balance.monsters;
}

/**
 * Start an animation. `totalTicks` is spread over the archetype's frame
 * count (data/balance/monsters.js `frames`).
 */
export function startAnim(game, m, name, totalTicks) {
  const frames = bal(game).frames[name] || 1;
  m.anim = name;
  m.frames = frames;
  m.frame = 0;
  m.frameAcc = 0;
  m.frameTicks = Math.max(1, Math.round(totalTicks / frames));
}

/** Advance the current animation; @returns {boolean} true when it wrapped */
function stepAnim(m) {
  m.frameAcc++;
  if (m.frameAcc < m.frameTicks) return false;
  m.frameAcc = 0;
  m.frame++;
  if (m.frame >= (m.frames || 1)) { m.frame = 0; return true; }
  return false;
}

/** Return to the idle pose. `justStepped` tells the walk gate what happened. */
export function monsterStand(game, m, justStepped = false) {
  startAnim(game, m, 'stand', bal(game).standFrameTicks * bal(game).frames.stand);
  m.standTicks = 0;
  m.justStepped = justStepped;
  m.pending = null;
}

/** Turn to face a world point without changing mode. */
export function monsterFace(m, x, y) {
  m.dir = dirToward(m.tx, m.ty, x, y, m.dir);
}

/** Face the player (or the given target actor). */
export function monsterFacePlayer(game, m, target = game.player) {
  if (target) monsterFace(m, target.tx, target.ty);
}

/** Open a closed door tile for a door-opening monster. @returns {boolean} */
function tryOpenDoor(game, m, x, y) {
  const level = game.level;
  if (!m.opensDoors || !hasFlag(level.tiles, x, y, T.DOOR) || !isSolid(level.tiles, x, y)) return false;
  clearFlag(level.tiles, x, y, T.SOLID | T.BLOCKS_LIGHT);
  for (const o of level.objects || []) {
    if (o.kind === 'door' && o.tx === x && o.ty === y) { o.state = 'open'; o.solid = false; o.blocksLight = false; }
  }
  game.bus.emit('sfx', { name: 'open', x, y });
  return true;
}

/**
 * Begin a one-tile step in `dir`. Fails (returns false) when the destination
 * is solid, occupied, a closed door this monster cannot open, or a cut corner.
 * @returns {boolean}
 */
export function monsterStep(game, m, dir) {
  const level = game.level;
  const d = dirDelta(dir);
  const nx = m.tx + d.x;
  const ny = m.ty + d.y;
  if (!stepAllowed(level.tiles, m.tx, m.ty, dir)) return false;
  if (!tileFree(level, nx, ny, m.id)) {
    if (!(occupantAt(level, nx, ny) === 0 && tryOpenDoor(game, m, nx, ny))) return false;
  }
  if (m.leaderId && m.leashed) {
    const leader = level.monsters.find((o) => o.id === m.leaderId);
    if (leader && !leader.dead && dist(nx, ny, leader.tx, leader.ty) > bal(game).pack.radius + 1) return false;
  }
  if (occupantAt(level, m.tx, m.ty) === m.id) setOccupant(level, m.tx, m.ty, 0);
  setOccupant(level, nx, ny, m.id);
  m.tx = nx;
  m.ty = ny;
  m.ox = -d.x;
  m.oy = -d.y;
  m.stepT = 0;
  m.dir = dir;
  m.moveSpeed = 1 / Math.max(1, m.speed.walkTicksPerTile);
  startAnim(game, m, 'walk', m.speed.walkTicksPerTile);
  m.pathCount = 0;
  return true;
}

/** Try `dir`, then ±45°, then ±90° (coin-flip order). ref §5.4 RandomWalk. @returns {boolean} */
export function monsterStepFan(game, m, dir, wide = true) {
  const s = game.rng.chance(50) ? 1 : -1;
  const order = [dir, turnDir(dir, s), turnDir(dir, -s)];
  if (wide) order.push(turnDir(dir, 2 * s), turnDir(dir, -2 * s));
  for (const d of order) if (monsterStep(game, m, d)) return true;
  return false;
}

/**
 * Walk one step toward (x,y): greedy steer first, A* after repeated failures
 * or when the straight line is blocked. ref §5.6.
 * @returns {boolean}
 */
export function monsterApproach(game, m, x, y) {
  const level = game.level;
  const b = bal(game);
  const clear = lineOfSight(level.tiles, m.tx, m.ty, x, y);
  if (clear && monsterStepFan(game, m, dirToward(m.tx, m.ty, x, y, m.dir))) return true;
  m.pathCount = (m.pathCount || 0) + 1;
  if (clear && m.pathCount < b.blockedThinksBeforeAstar) return false;
  const path = findPath(level.tiles, { x: m.tx, y: m.ty }, { x, y }, {
    isBlocked: (px, py) => { const o = occupantAt(level, px, py); return o !== 0 && o !== m.id; },
    maxNodes: b.astarMaxNodes,
  });
  if (!path || path.length === 0) return false;
  const first = path[0];
  return monsterStep(game, m, dirFromDelta(first.x - m.tx, first.y - m.ty));
}

/** Step away from (x,y). @returns {boolean} */
export function monsterRetreat(game, m, x, y) {
  return monsterStepFan(game, m, oppositeDir(dirToward(m.tx, m.ty, x, y, m.dir)));
}

/** Step in a random direction. @returns {boolean} */
export function monsterWander(game, m) {
  return monsterStep(game, m, game.rng.rand(8));
}

/** Queue a melee swing; it resolves on the action frame. */
export function monsterBeginAttack(game, m, target) {
  monsterFace(m, target.tx, target.ty);
  m.pending = { kind: 'attack', targetId: target.id, done: false };
  m.mode = 'attack';
  startAnim(game, m, 'attack', m.speed.attackTicks);
}

/** Queue a ranged shot (optionally overriding the monster's missile spec). */
export function monsterBeginShoot(game, m, target, spec = null) {
  monsterFace(m, target.tx, target.ty);
  m.pending = { kind: 'shoot', targetId: target.id, done: false, spec, at: { x: target.tx, y: target.ty } };
  m.mode = 'attack';
  startAnim(game, m, 'cast', m.speed.attackTicks);
}

/** Pause for `ticks` (AiDelay). */
export function monsterDelay(m, ticks) {
  m.delayTicks = Math.max(0, ticks | 0);
}

/** @returns {boolean} the universal walk gate. ref §7: (var2 > 20 && v < a) || (justStepped && v < b) */
export function walkGate(game, m, gate) {
  const I = m.intelligence;
  const v = game.rng.rand(PCT);
  const a = gate[0][0] * I + gate[0][1];
  const b = gate[1][0] * I + gate[1][1];
  return (m.standTicks > bal(game).walkGateStandTicks && v < a) || (m.justStepped && v < b);
}

/** @returns {boolean} true with probability a·INT + b percent */
export function aiChance(game, m, ab) {
  return game.rng.rand(PCT) < ab[0] * m.intelligence + ab[1];
}

/** Shove `target` one tile along `dir` if the tile is free. @returns {boolean} */
export function knockback(game, target, dir) {
  const d = dirDelta(dir);
  const nx = target.tx + d.x;
  const ny = target.ty + d.y;
  if (!tileFree(game.level, nx, ny, target.id) || !stepAllowed(game.level.tiles, target.tx, target.ty, dir)) return false;
  if (occupantAt(game.level, target.tx, target.ty) === target.id) setOccupant(game.level, target.tx, target.ty, 0);
  setOccupant(game.level, nx, ny, target.id);
  target.tx = nx;
  target.ty = ny;
  target.ox = 0;
  target.oy = 0;
  if (target.kind === 'player') target.path = null;
  return true;
}

/**
 * Resolve a melee hit from `m` on `target` (player or monster). `sureHit`
 * bypasses the to-hit roll (charges). Damage goes through combat.js.
 * @returns {boolean} hit landed
 */
export function monsterAttackPlayer(game, m, target = game.player, sureHit = false) {
  if (!target || target.dead) return false;
  const b = bal(game);
  let dmg = 0;
  if (target.kind === 'player') {
    const r = deps.rollMonsterHitsPlayer(game, m, target);
    if (!sureHit && (!r.hit || r.blocked)) {
      game.bus.emit('sfx', { name: r.blocked ? 'block' : 'miss', x: target.tx, y: target.ty });
      return false;
    }
    dmg = sureHit && !r.hit ? game.rng.range(m.dmgMin, m.dmgMax) : r.dmg;
    deps.applyDamageToPlayer(game, target, dmg, 'phys', m);
  } else {
    const c = b.mvm.base + m.toHit - target.ac + b.mvm.levelDiffMult * (m.level - target.level);
    const chance = sureHit ? PCT : Math.max(b.mvm.min, Math.min(b.mvm.max, c));
    if (game.rng.rand(PCT) >= chance) return false;
    dmg = game.rng.range(m.dmgMin, m.dmgMax);
    deps.applyDamageToMonster(game, target, dmg, 'phys', m);
    wakeMonster(game, target, m);
  }
  game.bus.emit('sfx', { name: m.sfx && m.sfx.attack ? m.sfx.attack : 'hit', x: target.tx, y: target.ty });
  if (m.knockback || sureHit) knockback(game, target, dirToward(m.tx, m.ty, target.tx, target.ty, m.dir));
  return true;
}

/**
 * Fire the monster's missile (theme `missile` block) at a target tile.
 * @param {object} game
 * @param {object} m
 * @param {{x:number,y:number}|object} target tile or actor
 * @param {object|null} [spec] overrides {archetype, element, dmg:{min,max}, look, ...}
 * @returns {object|null} the missile
 */
export function monsterShoot(game, m, target, spec = null) {
  const ms = m.missile || {};
  const to = typeof target.tx === 'number' ? { x: target.tx, y: target.ty } : target;
  const mult = m.missileDmgMult || 1;
  const dmg = spec && spec.dmg ? spec.dmg : { min: Math.round((ms.dmg ? ms.dmg[0] : m.dmgMin) * mult), max: Math.round((ms.dmg ? ms.dmg[1] : m.dmgMax) * mult) };
  const full = {
    archetype: ms.archetype || 'bolt', element: ms.element || 'phys', level: m.level,
    look: { color: m.look.trimColor || m.look.bodyColor }, ...spec, owner: m, from: { x: m.tx, y: m.ty }, to, dmg,
  };
  game.bus.emit('sfx', { name: full.archetype === 'arrow' ? 'bowShot' : 'cast', x: m.tx, y: m.ty });
  return spawnMissile(game, full);
}

/** Wake + maybe stagger after taking `dmg`. Safe for combat.js to call directly. */
export function staggerMonster(game, m, dmg, source = null) {
  if (m.dead) return;
  wakeMonster(game, m, source);
  m.aiState.lastHitTick = game.tick;
  m.aiState.lastHitDmg = dmg;
  if (m.noHitRecover || m.charging) return;
  if (dmg >= m.level + bal(game).staggerLevelAdd && m.hitRecoverTicks <= 0) m.hitRecoverTicks = m.speed.hitTicks;
}

function resolvePending(game, m) {
  const p = m.pending;
  if (!p || p.done || m.frame !== m.speed.actionFrame || m.frameAcc !== 0) return;
  p.done = true;
  const target = p.targetId === game.player.id ? game.player : game.level.monsters.find((o) => o.id === p.targetId);
  if (p.kind === 'attack') {
    if (target && !target.dead && dist(m.tx, m.ty, target.tx, target.ty) <= 1) monsterAttackPlayer(game, m, target);
  } else if (p.kind === 'shoot') {
    const at = target && !target.dead ? target : p.at;
    monsterShoot(game, m, at, p.spec);
  }
}

/** Refresh awareness and remembered target position. ref §4. */
function perceive(game, m) {
  const b = bal(game);
  const seen = nearestEnemy(game, m, b.wakeRadius, true);
  if (seen) {
    if (!m.awake) wakeMonster(game, m, seen.ent);
    m.awake = true;
    m.awakeTicks = b.awakeTicks;
    m.target = { x: seen.ent.tx, y: seen.ent.ty };
    m.targetId = seen.ent.id;
    m.lastSeenTick = game.tick;
    return;
  }
  if (!m.awake) return;
  if (--m.awakeTicks <= 0) { m.awake = false; m.target = null; m.targetId = 0; m.mode = 'idle'; }
}

function regen(game, m) {
  if (m.hp >= m.hpMax) return;
  m.regenAcc = (m.regenAcc || 0) + m.level * bal(game).regenPerLevelPerTick;
  if (m.regenAcc >= 1) { m.hp = Math.min(m.hpMax, m.hp + Math.floor(m.regenAcc)); m.regenAcc -= Math.floor(m.regenAcc); }
}

function tickOne(game, m) {
  if (m.flash > 0) m.flash--;
  if (m.dead) {
    if (m.anim === 'death' && m.frame < m.frames - 1) stepAnim(m);
    return;
  }
  // Damage taken since the last tick (covers a combat.js that only edits hp).
  if (m.hp < m.lastHp) staggerMonster(game, m, m.lastHp - m.hp);
  m.lastHp = m.hp;
  if (m.hp <= 0) { killMonster(game, m, game.player); return; }
  if (m.lifeTicks > 0 && --m.lifeTicks === 0) { killMonster(game, m, null); return; }
  regen(game, m);

  if (m.hitRecoverTicks > 0) {
    if (m.anim !== 'hit') { startAnim(game, m, 'hit', m.hitRecoverTicks); m.ox = 0; m.oy = 0; m.stepT = 1; m.pending = null; }
    stepAnim(m);
    if (--m.hitRecoverTicks <= 0) monsterStand(game, m);
    return;
  }
  if (m.charging) { stepAnim(m); return; }

  for (let i = 0; i < RETHINK_CAP; i++) {
    if (m.anim === 'walk') {
      m.stepT += m.moveSpeed;
      const back = Math.max(0, 1 - m.stepT);
      const d = dirDelta(m.dir);
      m.ox = -d.x * back;
      m.oy = -d.y * back;
      stepAnim(m);
      if (m.stepT < STEP_DONE) return;
      m.ox = 0; m.oy = 0;
      monsterStand(game, m, true);
      continue;
    }
    if (m.anim === 'attack' || m.anim === 'cast' || m.anim === 'special') {
      resolvePending(game, m);
      if (stepAnim(m)) { monsterStand(game, m, false); continue; }
      return;
    }
    // standing
    stepAnim(m);
    m.standTicks++;
    perceive(game, m);
    if (m.delayTicks > 0) { m.delayTicks--; return; }
    if (!m.awake && !m.ally) return;
    const think = AI[m.ai] || AI.rusher;
    think(game, m);
    if (m.anim === 'stand') return;
  }
}

/**
 * Advance every monster on the current level by one tick. ref §3.1.
 * @param {object} game
 */
export function updateMonsters(game) {
  const level = game.level;
  if (!level || !level.monsters) return;
  const list = level.monsters;
  for (let i = 0; i < list.length; i++) tickOne(game, list[i]);
  const ct = bal(game).corpseTicks;
  if (ct > 0) {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.dead && game.tick - m.deathTick > ct) list.splice(i, 1);
    }
  }
}

export { isAlly, actorsSeeEachOther };

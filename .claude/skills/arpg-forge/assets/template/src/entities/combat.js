/**
 * Hit resolution in both directions. Formulas live in combat_rolls.js; this
 * module mutates entities, emits `float` / `sfx` / `playerHit` on game.bus,
 * and hands kills to entities/monster.js killMonster and player_stats
 * playerDie.
 *
 * Pipelines other modules call:
 *   playerMeleeHit(game, p, m)              — player.js on the attack action frame
 *   playerMissileHit(game, p, m, spec)      — missile.js when an arrow/bolt lands on a monster
 *   monsterMeleeHit(game, m, p)             — monster.js on the monster's action frame
 *   monsterMissileHit(game, m, p, spec)     — missile.js when a monster missile lands on the player
 * plus the CONTRACTS primitives rollPlayerHitsMonster / rollMonsterHitsPlayer /
 * applyDamageToMonster / applyDamageToPlayer / resistMultiplier.
 */
import { killMonster } from './monster.js';
import { playerDie } from './player_stats.js';
import { cancelWalk } from './player_move.js';
import { setAnim, ANIM_FRAMES } from './anim.js';
import { isWalkable, idx } from '../world/tiles.js';
import { dirFromDelta, dist } from '../world/pathfind.js';
import { worldPos } from '../render/camera.js';
import * as R from './combat_rolls.js';
import * as C from '../../data/balance/combat.js';

export { resistMultiplier, elementColor } from './combat_rolls.js';

const ADJACENT = 1;
const PCT = 100;

function classOf(game, p) {
  return p._cls || game.theme.classes.find((c) => c.id === p.classId);
}

/** Emit a floating number above an entity. */
export function emitFloat(game, e, text, color) {
  const w = worldPos(e);
  game.bus.emit('float', { x: w.x, y: w.y - C.FLOAT_HEAD_OFFSET, text: String(text), color });
}

function emitSfx(game, name, e) {
  const w = e ? worldPos(e) : null;
  game.bus.emit('sfx', w ? { name, x: w.x, y: w.y } : { name });
}

/**
 * Roll a player attack against a monster (no mutation).
 * @param {object} game
 * @param {object} p player
 * @param {object} m monster
 * @param {{ranged?:boolean, spell?:boolean, dist?:number, dmg?:{min:number,max:number}}} [opts]
 * @returns {{hit:boolean, dmg:number, crit:boolean, chance:number}}
 */
export function rollPlayerHitsMonster(game, p, m, opts = {}) {
  const cls = classOf(game, p);
  const chance = R.playerHitChance(p, cls, m, opts);
  if (game.rng.rand(C.ROLL_D) >= chance) return { hit: false, dmg: 0, crit: false, chance };
  const range = opts.dmg || R.weaponDamage(p);
  let dmg = game.rng.range(range.min, range.max);
  dmg += Math.floor((dmg * R.buffTotal(p, 'dmgPct')) / PCT);
  let mod = R.statDamageMod(p, cls);
  if (opts.ranged && cls.weaponPref !== 'ranged') mod = Math.floor(mod / 2); // reference: non-archer arrows get half statMod
  if (!opts.spell) dmg += mod;
  let crit = false;
  if (!opts.spell && cls.critOnLevel && game.rng.rand(C.ROLL_D) < p.level) {
    dmg *= C.CRIT_MULT;
    crit = true;
  }
  if (!opts.ranged && !opts.spell) dmg = Math.floor(dmg * R.weaponVsMonsterMult(p, m));
  return { hit: true, dmg: Math.max(1, dmg | 0), crit, chance };
}

/**
 * Roll a monster attack against the player (no mutation).
 * @param {object} game
 * @param {object} m monster ({toHit, level, dmgMin, dmgMax})
 * @param {object} p player
 * @param {{missile?:boolean, spell?:boolean, dist?:number, dmg?:{min:number,max:number}, toHit?:number}} [opts]
 * @returns {{hit:boolean, blocked:boolean, dmg:number, chance:number}}
 */
export function rollMonsterHitsPlayer(game, m, p, opts = {}) {
  if (p.dead) return { hit: false, blocked: false, dmg: 0, chance: 0 };
  const depth = game.level ? game.level.depth : 0;
  const chance = R.monsterHitChance(m, p, depth, opts);
  if (game.rng.rand(C.ROLL_D) >= chance) return { hit: false, blocked: false, dmg: 0, chance };
  if (R.canBlock(p)) {
    const blk = R.blockChance(p, classOf(game, p), m.level || 0, !!(opts.missile || opts.spell));
    if (game.rng.rand(C.ROLL_D) < blk) return { hit: true, blocked: true, dmg: 0, chance };
  }
  const range = opts.dmg || { min: m.dmgMin, max: m.dmgMax };
  const dmg = Math.max(C.MIN_PLAYER_DAMAGE, game.rng.range(range.min | 0, range.max | 0));
  return { hit: true, blocked: false, dmg, chance };
}

/** Put a monster into hit recovery (anim + ticks). Monster AI honours m.hitRecoverTicks. */
export function staggerMonster(game, m) {
  const ticks = (m.speed && m.speed.hitTicks) || C.MONSTER_HIT_TICKS_DEFAULT;
  m.hitRecoverTicks = ticks;
  setAnim(m, 'hit', Math.max(1, Math.round(ticks / ANIM_FRAMES.hit)), ANIM_FRAMES.hit);
}

/** Put the player into hit recovery; cancels walking and snaps to a tile. */
export function staggerPlayer(game, p) {
  const cls = classOf(game, p);
  const skip = Math.max(0, ((p.derived && p.derived.hitRecover) || 0) | 0);
  const perFrame = cls.frames.hitRecover;
  cancelWalk(game, p);
  setAnim(p, 'hit', perFrame, ANIM_FRAMES.hit, -1, skip);
  p.state.hitRecoverTicks = Math.max(1, (ANIM_FRAMES.hit - skip) * perFrame);
  p.action = null;
}

/**
 * Apply damage to a monster after resistances. Emits float/sfx, staggers,
 * and kills via monster.js. Returns damage actually dealt.
 * @param {object} game
 * @param {object} m
 * @param {number} dmg
 * @param {string} element 'phys'|'fire'|'cold'|'shock'|'arcane'
 * @param {object|null} source attacker entity (player for XP credit)
 * @returns {number}
 */
export function applyDamageToMonster(game, m, dmg, element = 'phys', source = null) {
  if (!m || m.dead || m.hp <= 0) return 0;
  const mult = R.resistMultiplier(m, element);
  if (mult <= 0) {
    emitFloat(game, m, 'immune', R.elementColor('immune'));
    return 0;
  }
  const dealt = Math.max(C.MIN_MONSTER_DAMAGE, Math.floor(dmg * mult));
  m.hp -= dealt;
  m.flash = C.HIT_FLASH_TICKS;
  m.awake = true;
  if (source) m.lastHitBy = source.id;
  emitFloat(game, m, dealt, R.elementColor(element));
  if (m.hp <= 0) {
    m.hp = 0;
    killMonster(game, m, source);
    return dealt;
  }
  emitSfx(game, 'monsterHit', m);
  if (mult >= 1 && R.monsterStaggers(m, dealt)) staggerMonster(game, m);
  return dealt;
}

/**
 * Apply damage to the player: god mode / invulnerability, resistances, mana
 * shield, floats, `playerHit`, stagger and death. Returns life lost.
 * @param {object} game
 * @param {object} p
 * @param {number} dmg
 * @param {string} element
 * @param {object|null} source
 * @returns {number}
 */
export function applyDamageToPlayer(game, p, dmg, element = 'phys', source = null) {
  if (!p || p.dead) return 0;
  if ((game.debug && game.debug.godMode) || p.state.invulnTicks > 0) return 0;
  const mult = R.resistMultiplier(p, element);
  const resisted = element !== 'phys' && mult < 1;
  let dealt = Math.max(C.MIN_PLAYER_DAMAGE, Math.floor(dmg * mult));
  if (p.state.manaShield > 0) {
    const s = R.manaShieldAbsorb(dealt, p.mp, p.state.manaShield);
    p.mp = Math.max(0, p.mp - s.manaUsed);
    if (s.manaUsed > 0) emitFloat(game, p, `-${s.manaUsed} mp`, R.elementColor('mana'));
    if (s.broke) p.state.manaShield = 0;
    dealt = s.dmg;
    if (dealt <= 0) return 0;
  }
  p.hp -= dealt;
  p.flash = C.HIT_FLASH_TICKS;
  emitFloat(game, p, dealt, R.elementColor('playerHit'));
  emitSfx(game, 'hit', p);
  game.bus.emit('playerHit', { dmg: dealt, element, source });
  if (p.hp <= 0) {
    p.hp = 0;
    playerDie(game);
    return dealt;
  }
  if (!resisted && R.playerStaggers(p, classOf(game, p), dealt)) staggerPlayer(game, p);
  return dealt;
}

/**
 * Shove an actor one tile away from (fromX, fromY) if that tile is free.
 * @returns {boolean} moved
 */
export function tryKnockback(game, target, fromX, fromY) {
  const level = game.level;
  if (!level || target.dead) return false;
  const dx = Math.sign(target.tx - fromX);
  const dy = Math.sign(target.ty - fromY);
  if (dx === 0 && dy === 0) return false;
  const nx = target.tx + dx * C.KNOCKBACK_TILES;
  const ny = target.ty + dy * C.KNOCKBACK_TILES;
  if (!isWalkable(level.tiles, nx, ny)) return false;
  const occ = level.occupant;
  const ni = idx(level.tiles, nx, ny);
  if (occ[ni] !== 0 && occ[ni] !== target.id) return false;
  if (target.kind === 'player') cancelWalk(game, target);
  const oi = idx(level.tiles, target.tx, target.ty);
  if (occ[oi] === target.id) occ[oi] = 0;
  occ[ni] = target.id;
  target.tx = nx;
  target.ty = ny;
  target.ox = 0;
  target.oy = 0;
  target.path = null;
  return true;
}

function applySteals(game, p, dealt) {
  const d = p.derived || {};
  if (d.lifeSteal > 0) {
    const heal = Math.floor((dealt * d.lifeSteal) / C.STEAL_PCT_DIV);
    if (heal > 0) p.hp = Math.min(p.hpMax, p.hp + heal);
  }
  if (d.manaSteal > 0) {
    const mana = Math.floor((dealt * d.manaSteal) / C.STEAL_PCT_DIV);
    if (mana > 0) p.mp = Math.min(p.mpMax, p.mp + mana);
  }
}

/**
 * Full player melee swing against a monster: roll, apply, steals, knockback.
 * @returns {{hit:boolean, dmg:number, crit:boolean, dealt:number}}
 */
export function playerMeleeHit(game, p, m) {
  const r = rollPlayerHitsMonster(game, p, m);
  if (!r.hit) {
    emitFloat(game, m, 'miss', R.elementColor('miss'));
    emitSfx(game, 'miss', m);
    return { ...r, dealt: 0 };
  }
  const dealt = applyDamageToMonster(game, m, r.dmg, 'phys', p);
  if (r.crit && dealt > 0) emitFloat(game, m, 'crit!', R.elementColor('crit'));
  applySteals(game, p, dealt);
  if (p.derived && p.derived.knockback && !m.dead) tryKnockback(game, m, p.tx, p.ty);
  emitSfx(game, 'hit', m);
  return { ...r, dealt };
}

/**
 * Player missile (arrow or spell) landing on a monster.
 * @param {object} game
 * @param {object} p owner
 * @param {object} m target
 * @param {{dist?:number, dmg:{min:number,max:number}, element?:string, knockback?:boolean}} spec
 * @returns {{hit:boolean, dmg:number, crit:boolean, dealt:number}}
 */
export function playerMissileHit(game, p, m, spec) {
  const element = spec.element || 'phys';
  const r = rollPlayerHitsMonster(game, p, m, { ranged: element === 'phys', spell: element !== 'phys', dist: spec.dist || 0, dmg: spec.dmg });
  if (!r.hit) {
    emitFloat(game, m, 'miss', R.elementColor('miss'));
    return { ...r, dealt: 0 };
  }
  const dealt = applyDamageToMonster(game, m, r.dmg, element, p);
  applySteals(game, p, dealt);
  if ((spec.knockback || (p.derived && p.derived.knockback)) && element === 'phys' && !m.dead) tryKnockback(game, m, p.tx, p.ty);
  return { ...r, dealt };
}

/**
 * Full monster melee attack on the player: adjacency, roll, block, damage,
 * thorns, knockback.
 * @returns {{hit:boolean, blocked:boolean, dmg:number, dealt:number}}
 */
export function monsterMeleeHit(game, m, p) {
  if (p.dead || dist(m.tx, m.ty, p.tx, p.ty) > ADJACENT) return { hit: false, blocked: false, dmg: 0, dealt: 0 };
  const r = rollMonsterHitsPlayer(game, m, p);
  if (!r.hit) return { ...r, dealt: 0 };
  if (r.blocked) {
    p.dir = dirFromDelta(m.tx - p.tx, m.ty - p.ty);
    emitFloat(game, p, 'block', R.elementColor('block'));
    emitSfx(game, 'block', p);
    return { ...r, dealt: 0 };
  }
  const dealt = applyDamageToPlayer(game, p, r.dmg, 'phys', m);
  const thorns = (p.derived && p.derived.thorns) || 0;
  if (thorns > 0 && !m.dead) applyDamageToMonster(game, m, game.rng.range(C.THORNS_MIN, Math.max(C.THORNS_MIN, thorns)), 'phys', p);
  if (R.hasFlag(m, 'knockback') && !p.dead) {
    tryKnockback(game, p, m.tx, m.ty);
    if (p.state.hitRecoverTicks <= 0) staggerPlayer(game, p);
  }
  return { ...r, dealt };
}

/**
 * Monster missile landing on the player.
 * @param {{dist?:number, dmg:{min:number,max:number}, element?:string, spell?:boolean}} spec
 * @returns {{hit:boolean, blocked:boolean, dmg:number, dealt:number}}
 */
export function monsterMissileHit(game, m, p, spec) {
  const element = spec.element || 'phys';
  const spell = spec.spell !== undefined ? spec.spell : element !== 'phys';
  const r = rollMonsterHitsPlayer(game, m, p, { missile: !spell, spell, dist: spec.dist || 0, dmg: spec.dmg });
  if (!r.hit) return { ...r, dealt: 0 };
  if (r.blocked) {
    emitFloat(game, p, 'block', R.elementColor('block'));
    emitSfx(game, 'block', p);
    return { ...r, dealt: 0 };
  }
  return { ...r, dealt: applyDamageToPlayer(game, p, r.dmg, element, m) };
}

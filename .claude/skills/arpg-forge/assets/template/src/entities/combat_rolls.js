/**
 * Pure combat formulas (no entity mutation, no imports beyond balance) so
 * they can be unit-tested and reused by missiles/skills/monsters.
 *
 * Conventions:
 *  - `p.derived` holds FULL player numbers (items/recalc.js semantics):
 *    `toHit` = classBase + level + Dex/2 (Dex with a bow) + items,
 *    `ac` = itemAC + Dex/5 + items, `dmgMin/dmgMax` = weapon + Str*level/100
 *    mod + items, `blockChance` = Dex + classBlock + 2*level + items (0
 *    without a shield), `stats` = current attributes. entities/player_stats
 *    recalcPlayerBase() fills the same shape from stats alone when the item
 *    pipeline has not run, so these helpers only READ derived and add the
 *    per-roll terms (monster AC, level gap, distance).
 *  - Monster `resist` uses 0 none / 1 resist / 2 immune; player `resist` is a
 *    percentage 0..75.
 */
import * as C from '../../data/balance/combat.js';
import { STAT_CAP, MAX_RESIST } from '../../data/balance/progression.js';

const HEAVY_MELEE_PREF = 'melee';

/** Clamp helper. @returns {number} */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Does an entity have a flag (Set or array)? @returns {boolean} */
export function hasFlag(e, flag) {
  const f = e && e.flags;
  if (!f) return false;
  return typeof f.has === 'function' ? f.has(flag) : f.includes(flag);
}

/** Sum of a stat over active buffs in p.state.buffs. @returns {number} */
export function buffTotal(p, stat) {
  const buffs = p.state && p.state.buffs;
  if (!buffs || !buffs.length) return 0;
  let t = 0;
  for (const b of buffs) if (b.data && b.data.stat === stat) t += b.data.value || 0;
  return t;
}

/** Current attribute: derived.stats when the item pipeline ran, else base + bonus + buffs, clamped 0..750. @returns {number} */
export function statTotal(p, stat) {
  const d = p.derived;
  if (d && d.stats && typeof d.stats[stat] === 'number') return d.stats[stat];
  const v = (p.base[stat] || 0) + ((p.bonus && p.bonus[stat]) || 0) + buffTotal(p, stat);
  return clamp(v, 0, STAT_CAP);
}

/** Player armor (derived.ac already holds itemAC + Dex/5). @returns {number} */
export function playerArmor(p) {
  return Math.floor((p.derived && p.derived.ac) || 0);
}

/** Player to-hit before the target's AC (derived.toHit already holds classBase + level + Dex term + items). @returns {number} */
export function playerToHit(p) {
  return Math.floor((p.derived && p.derived.toHit) || 0);
}

/**
 * Chance (5..95) a player hit lands on a monster.
 * melee: toHit - AC; arrow: toHit - AC - dist^2/2; spell: Mag + classBase - 2*mLvl - dist (reference).
 * @param {object} p player
 * @param {object} classDef theme PlayerClass
 * @param {object} m monster ({ ac, level })
 * @param {{ranged?:boolean, spell?:boolean, dist?:number}} [opts]
 * @returns {number}
 */
export function playerHitChance(p, classDef, m, opts = {}) {
  const dist = opts.dist || 0;
  let chance;
  if (opts.spell) {
    chance = statTotal(p, 'mag') + classDef.toHitBase - C.SPELL_TOHIT_LEVEL_MULT * (m.level || 0) - dist;
  } else if (opts.ranged) {
    chance = playerToHit(p) - (m.ac || 0) - Math.floor((dist * dist) / C.ARROW_DIST_SQ_DIV);
  } else {
    chance = playerToHit(p) - (m.ac || 0);
  }
  return clamp(Math.floor(chance), C.TO_HIT_MIN, C.TO_HIT_MAX);
}

/** Per-depth minimum monster hit chance (reference GetMinHit). @returns {number} */
export function monsterMinHit(depth, missile = false) {
  const t = missile ? C.MONSTER_MIN_HIT_MISSILE : C.MONSTER_MIN_HIT_MELEE;
  return t.byDepth[depth] !== undefined ? t.byDepth[depth] : t.default;
}

/**
 * Chance a monster hit lands on the player (floored, never capped).
 * melee: toHit + 2*(mLvl-cLvl) + 30 - AC; arrow: additionally -2*dist;
 * spell: 40 + 2*(mLvl-cLvl) - 2*dist (reference).
 * @param {object} m monster ({ toHit, level })
 * @param {object} p player
 * @param {number} depth level depth (for the floor table)
 * @param {{missile?:boolean, spell?:boolean, dist?:number, toHit?:number}} [opts]
 * @returns {number}
 */
export function monsterHitChance(m, p, depth, opts = {}) {
  const dist = opts.dist || 0;
  const gap = C.LEVEL_DIFF_MULT * ((m.level || 0) - (p.level || 1));
  let chance;
  if (opts.spell) {
    chance = C.MONSTER_SPELL_BASE_HIT + gap - C.MONSTER_MISSILE_DIST_MULT * dist;
  } else {
    const base = opts.toHit !== undefined ? opts.toHit : (m.toHit || 0);
    chance = base + gap + C.MONSTER_HIT_FLAT_BONUS - playerArmor(p);
    if (opts.missile) chance -= C.MONSTER_MISSILE_DIST_MULT * dist;
  }
  return Math.max(Math.floor(chance), monsterMinHit(depth, !!(opts.missile || opts.spell)));
}

/** True when the player can block right now (shield equipped, standing or attacking). @returns {boolean} */
export function canBlock(p) {
  const off = p.equipment && p.equipment.offhand;
  const shield = !!(off && off.type === 'shield') || !!(p.derived && p.derived.hasShield);
  return shield && C.BLOCKING_ANIMS.includes(p.anim);
}

/**
 * Block chance 0..100 against an attacker of level mLvl. derived.blockChance
 * = Dex + classBlock + 2*cLvl + items; the reference subtracts 2*mLvl for
 * melee and, for missiles, drops the 2*cLvl term while subtracting
 * 2*(mLvl - cLvl) — algebraically the same number, so one formula serves both.
 * @returns {number}
 */
export function blockChance(p, classDef, mLvl) {
  const base = (p.derived && p.derived.blockChance) || 0;
  return clamp(Math.floor(base - C.BLOCK_LEVEL_MULT * mLvl), C.BLOCK_MIN, C.BLOCK_MAX);
}

/**
 * Intrinsic block number for a class/level/dex (used to fill derived when
 * the item pipeline has not run and for the character sheet).
 * @returns {number}
 */
export function baseBlockChance(p, classDef) {
  return statTotal(p, 'dex') + (classDef.blockBase || 0) + C.BLOCK_LEVEL_MULT * p.level;
}

/**
 * Damage multiplier a target applies to an element: monsters 1 / 0.25 / 0
 * (none / resist / immune), players 1 - resist%/100 (phys never resisted).
 * @returns {number}
 */
export function resistMultiplier(target, element) {
  if (!target) return 1;
  if (target.kind === 'player') {
    if (element === 'phys' || !target.resist) return 1;
    const pct = clamp(target.resist[element] || 0, 0, MAX_RESIST);
    return 1 - pct / 100;
  }
  if (target.immune && typeof target.immune.has === 'function' && target.immune.has(element)) return C.IMMUNE_MULT;
  const r = target.resist ? target.resist[element] || 0 : 0;
  if (r >= C.RESIST_LEVEL_IMMUNE) return C.IMMUNE_MULT;
  if (r >= C.RESIST_LEVEL_RESIST) return C.RESIST_MULT;
  return 1;
}

/** Stat-derived flat damage (reference damageMod): melee/caster level*Str/100, ranged level*(Str+Dex)/200. @returns {number} */
export function statDamageMod(p, classDef) {
  if (classDef.weaponPref === 'ranged') {
    return Math.floor((p.level * (statTotal(p, 'str') + statTotal(p, 'dex'))) / C.RANGED_DMG_MOD_DIV);
  }
  return Math.floor((p.level * statTotal(p, 'str')) / C.MELEE_DMG_MOD_DIV);
}

/** Player damage range (derived.dmgMin/dmgMax already include weapon, items and the stat mod). @returns {{min:number,max:number}} */
export function weaponDamage(p) {
  const d = p.derived || {};
  if (!(d.dmgMax > 0)) return { min: C.UNARMED_DMG.min, max: C.UNARMED_DMG.max };
  return { min: Math.max(0, d.dmgMin | 0), max: Math.max(d.dmgMin | 0, d.dmgMax | 0) };
}

/** Weapon type vs monster flag multiplier (sword/mace vs undead/animal). @returns {number} */
export function weaponVsMonsterMult(p, m) {
  const w = p.equipment && p.equipment.weapon;
  if (!w) return 1;
  let mult = 1;
  for (const flag of Object.keys(C.WEAPON_VS_FLAG)) {
    if (hasFlag(m, flag) && C.WEAPON_VS_FLAG[flag][w.type]) mult *= C.WEAPON_VS_FLAG[flag][w.type];
  }
  return mult;
}

/** Monster stagger threshold: dmg >= mLvl + 3 (reference IsHardHit). @returns {boolean} */
export function monsterStaggers(m, dmg) {
  if (hasFlag(m, 'noHitRecover')) return false;
  return dmg >= (m.level || 0) + C.MONSTER_STAGGER_LEVEL_BONUS;
}

/** Player stagger threshold: dmg >= cLvl (+cLvl/4 for the heavy melee class). @returns {boolean} */
export function playerStaggers(p, classDef, dmg) {
  let threshold = p.level;
  if (classDef && classDef.weaponPref === HEAVY_MELEE_PREF && classDef.heavyStagger) {
    threshold += Math.floor(p.level / C.PLAYER_STAGGER_HEAVY_DIV);
  }
  return dmg >= threshold;
}

/**
 * Mana-shield absorption (reference §2.10). Returns the damage that reaches
 * life and the mana spent; `level` 0 means the shield is down.
 * @param {number} dmg
 * @param {number} mana current mana
 * @param {number} level shield level
 * @returns {{dmg:number, manaUsed:number, broke:boolean}}
 */
export function manaShieldAbsorb(dmg, mana, level) {
  if (level <= 0 || dmg <= 0) return { dmg, manaUsed: 0, broke: false };
  const r = C.MANA_SHIELD_BASE_REDUCTION - C.MANA_SHIELD_PER_LEVEL * Math.min(level, C.MANA_SHIELD_MAX_LEVEL);
  let d = dmg - Math.floor(dmg / r);
  if (mana >= d) return { dmg: 0, manaUsed: d, broke: false };
  d -= mana;
  d += Math.floor(d / (r - 1));
  return { dmg: d, manaUsed: mana, broke: true };
}

/** Floating-number colour for an element / outcome key. @returns {string} */
export function elementColor(element) {
  return C.ELEMENT_COLORS[element] || C.ELEMENT_COLORS.phys;
}

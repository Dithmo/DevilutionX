/**
 * Pure combat formulas (no entity mutation, no imports beyond balance) so
 * they can be unit-tested and reused by missiles/skills/monsters.
 *
 * CONVENTION (shared with items/recalc.js): `p.derived.toHit`, `.ac`,
 * `.dmgMin/.dmgMax`, `.blockPct`, `.lifeFromItems/.manaFromItems`,
 * `.lightRadius`, `.walkSpeed` are the ITEM contributions only. The stat /
 * level / class terms (Dex/5 armour, level + Dex/2 to-hit, Str*level/100
 * damage, class block base) are added HERE; buffs (p.state.buffs) are
 * layered by statTotal()/buffTotal(). Nothing double-counts.
 *  - Monster `resist` uses 0 none / 1 resist / 2 immune; player `resist` is a
 *    percentage 0..75.
 */
import * as C from '../../data/balance/combat.js';
import { STAT_CAP, MAX_RESIST } from '../../data/balance/progression.js';

const HEAVY_MELEE_PREF = 'melee';
const PCT = 100;

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

/** Current attribute = base + item bonus + buffs, clamped 0..750. @returns {number} */
export function statTotal(p, stat) {
  const v = (p.base[stat] || 0) + ((p.bonus && p.bonus[stat]) || 0) + buffTotal(p, stat);
  return clamp(v, 0, STAT_CAP);
}

/** Player armor = itemAC + Dex/5 + buff ac (reference GetArmor). @returns {number} */
export function playerArmor(p) {
  return Math.floor(((p.derived && p.derived.ac) || 0) + statTotal(p, 'dex') / C.PLAYER_AC_DEX_DIV + buffTotal(p, 'ac'));
}

/** Melee to-hit = classBase + level + Dex/2 + itemToHit + buffs (reference). @returns {number} */
export function playerMeleeToHit(p, classDef) {
  return Math.floor(classDef.toHitBase + p.level + statTotal(p, 'dex') / C.MELEE_TOHIT_DEX_DIV
    + ((p.derived && p.derived.toHit) || 0) + buffTotal(p, 'toHit'));
}

/** Ranged to-hit = classBase + level + Dex + itemToHit + buffs (reference). @returns {number} */
export function playerRangedToHit(p, classDef) {
  return Math.floor(classDef.toHitBase + p.level + statTotal(p, 'dex')
    + ((p.derived && p.derived.toHit) || 0) + buffTotal(p, 'toHit'));
}

/** To-hit for the equipped weapon kind (ranged when derived.ranged / a bow is held). @returns {number} */
export function playerToHit(p, classDef) {
  const bow = (p.derived && p.derived.ranged) || (p.equipment && p.equipment.weapon && p.equipment.weapon.type === 'bow');
  return bow ? playerRangedToHit(p, classDef) : playerMeleeToHit(p, classDef);
}

/**
 * Chance (5..95) a player hit lands on a monster.
 * melee: meleeToHit - AC; arrow: rangedToHit - AC - dist^2/2; spell: Mag + classBase - 2*mLvl - dist (reference).
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
    chance = playerRangedToHit(p, classDef) - (m.ac || 0) - Math.floor((dist * dist) / C.ARROW_DIST_SQ_DIV);
  } else {
    chance = playerMeleeToHit(p, classDef) - (m.ac || 0);
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
  const shield = !!(off && off.type === 'shield') || !!(p.derived && p.derived.canBlock);
  return shield && C.BLOCKING_ANIMS.includes(p.anim);
}

/**
 * Block chance 0..100: Dex + classBlock + 2*cLvl - 2*mLvl (+ blockPct items);
 * vs missiles: Dex + classBlock - 2*(mLvl - cLvl) (reference).
 * @returns {number}
 */
export function blockChance(p, classDef, mLvl, missile = false) {
  const items = ((p.derived && p.derived.blockPct) || 0) + buffTotal(p, 'blockPct');
  let chance = statTotal(p, 'dex') + (classDef.blockBase || 0) + items;
  if (missile) chance -= C.BLOCK_LEVEL_MULT * (mLvl - p.level);
  else chance += C.BLOCK_LEVEL_MULT * p.level - C.BLOCK_LEVEL_MULT * mLvl;
  return clamp(Math.floor(chance), C.BLOCK_MIN, C.BLOCK_MAX);
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
    return 1 - pct / PCT;
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

/** Weapon damage range from derived (items) or unarmed. @returns {{min:number,max:number}} */
export function weaponDamage(p) {
  const d = p.derived || {};
  if (!(d.dmgMax > 0)) return { min: C.UNARMED_DMG.min, max: C.UNARMED_DMG.max };
  return { min: Math.max(0, d.dmgMin | 0), max: Math.max(d.dmgMin | 0, d.dmgMax | 0) };
}

/**
 * Full player damage range for the sheet / arrows: weapon + buff dmgPct + stat mod.
 * @returns {{min:number,max:number}}
 */
export function playerDamageRange(p, classDef) {
  const w = weaponDamage(p);
  const mult = 1 + buffTotal(p, 'dmgPct') / PCT;
  const mod = statDamageMod(p, classDef);
  const min = Math.floor(w.min * mult) + mod;
  return { min, max: Math.max(min, Math.floor(w.max * mult) + mod) };
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
  if (hasFlag(m, 'noHitRecover') || m.noHitRecover) return false;
  return dmg >= (m.level || 0) + C.MONSTER_STAGGER_LEVEL_BONUS;
}

/** Player stagger threshold: dmg >= cLvl (+cLvl/4 for a class with heavyStagger). @returns {boolean} */
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

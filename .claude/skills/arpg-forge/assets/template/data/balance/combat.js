/**
 * Combat balance constants. Each value cites the genre reference it comes
 * from (references/systems/04-monsters-ai-combat.md §8 "Reference tuning
 * values" and Appendix A unless stated otherwise).
 */

/** Player hit chances are always clamped to 5..95 % (reference). */
export const TO_HIT_MIN = 5;
export const TO_HIT_MAX = 95;
/** Rolls are d100: hit when rand(100) < chance. */
export const ROLL_D = 100;

/** Monster melee vs player: toHit + 2*(mLvl - cLvl) + 30 - playerAC (reference). */
export const MONSTER_HIT_FLAT_BONUS = 30;
export const LEVEL_DIFF_MULT = 2;
/** Monster arrows get an extra -2*dist (reference). */
export const MONSTER_MISSILE_DIST_MULT = 2;
/** Monster spells vs player use a flat 40 base instead of the monster's toHit (reference). */
export const MONSTER_SPELL_BASE_HIT = 40;

/**
 * Per-depth floor on monster hit chance (reference GetMinHit): melee 15 default,
 * depth 14 → 20, 15 → 25, 16 → 30. Missiles use the same table with a 10 default.
 */
export const MONSTER_MIN_HIT_MELEE = Object.freeze({ default: 15, byDepth: { 14: 20, 15: 25, 16: 30 } });
export const MONSTER_MIN_HIT_MISSILE = Object.freeze({ default: 10, byDepth: { 14: 20, 15: 25, 16: 30 } });

/** Player armor = itemAC + Dex/5 (reference GetArmor). */
export const PLAYER_AC_DEX_DIV = 5;
/** Player melee to-hit = classBase + level + Dex/2 + itemToHit - monsterAC (reference). */
export const MELEE_TOHIT_DEX_DIV = 2;
/** Arrow to-hit range falloff: - dist^2 / 2 (reference, quadratic). */
export const ARROW_DIST_SQ_DIV = 2;
/** Spell to-hit = Mag + classBase - 2*mLvl - dist (reference). */
export const SPELL_TOHIT_LEVEL_MULT = 2;

/** Block = Dex + classBlock + 2*cLvl - 2*mLvl, clamp 0..100; vs missiles no cLvl term (reference). */
export const BLOCK_LEVEL_MULT = 2;
export const BLOCK_MIN = 0;
export const BLOCK_MAX = 100;
/** Block is only possible in these player anims (reference: Stand/Attack). */
export const BLOCKING_ANIMS = Object.freeze(['stand', 'attack']);

/** Critical strike: chance = cLvl %, damage x2 (reference). */
export const CRIT_MULT = 2;
/** Resisted damage is multiplied by 1/4; immune = 0 (reference). */
export const RESIST_MULT = 0.25;
export const IMMUNE_MULT = 0;
/** Monster resist table values (theme MonsterType.resist): 0 none, 1 resist, 2 immune. */
export const RESIST_LEVEL_RESIST = 1;
export const RESIST_LEVEL_IMMUNE = 2;

/** Stat-derived damage mod: melee/caster level*Str/100, ranged level*(Str+Dex)/200 (reference). */
export const MELEE_DMG_MOD_DIV = 100;
export const RANGED_DMG_MOD_DIV = 200;
/** Unarmed damage range (reference: 1-1). */
export const UNARMED_DMG = Object.freeze({ min: 1, max: 1 });

/** Weapon type vs monster flag damage multipliers (reference: sword -50% / mace +50% vs undead). */
export const WEAPON_VS_FLAG = Object.freeze({
  undead: { sword: 0.5, mace: 1.5 },
  animal: { mace: 0.5, sword: 1.5 },
});

/** Monster staggers when a single hit deals >= mLvl + 3 (reference). */
export const MONSTER_STAGGER_LEVEL_BONUS = 3;
/** Player staggers when a single hit deals >= cLvl (reference; heavy-melee bonus cLvl/4 is a class flag). */
export const PLAYER_STAGGER_HEAVY_DIV = 4;
/** After hit recovery ends the player cannot be re-staggered for this many ticks (anti stun-lock; 0 = reference). */
export const PLAYER_STAGGER_GRACE_TICKS = 12;
/** Minimum damage a landed hit deals to the player (reference: 1 HP). */
export const MIN_PLAYER_DAMAGE = 1;
/** Minimum damage a non-immune hit deals to a monster after resist. */
export const MIN_MONSTER_DAMAGE = 1;

/** Mana shield: reduction R = 24 - 3*min(level, 7); absorbed damage *= (1 - 1/R) (reference §2.10). */
export const MANA_SHIELD_BASE_REDUCTION = 24;
export const MANA_SHIELD_PER_LEVEL = 3;
export const MANA_SHIELD_MAX_LEVEL = 7;

/** Thorns reflects rand(1, thornsValue) to a melee attacker (reference 1..3 with thorns value 3). */
export const THORNS_MIN = 1;
/** Life/mana steal item stats are percentages of damage dealt (reference 3% / 5%). */
export const STEAL_PCT_DIV = 100;

/** Knockback: one tile away from the attacker, only onto a legal free tile (reference). */
export const KNOCKBACK_TILES = 1;

/** Fallback hit-recovery ticks for a monster whose type has no speed.hitTicks. */
export const MONSTER_HIT_TICKS_DEFAULT = 6;
/** Flash duration (ticks) on any entity that takes damage. */
export const HIT_FLASH_TICKS = 3;

/** Bow auto-attack range in tiles (reference arrows live ~ 16+ tiles; we cap the auto-shoot intent). */
export const BOW_RANGE_TILES = 12;

/** Floating-number / message colours per element and outcome. */
export const ELEMENT_COLORS = Object.freeze({
  phys: '#e8e0d0',
  fire: '#ff8c3a',
  cold: '#7ad0ff',
  shock: '#f0e860',
  arcane: '#c080ff',
  heal: '#60e080',
  mana: '#6080ff',
  crit: '#ffd040',
  block: '#a0c0ff',
  miss: '#8a8a8a',
  immune: '#b0b0b0',
  playerHit: '#ff5050',
});
/** Floats drift up from the entity's head: offset in world tiles. */
export const FLOAT_HEAD_OFFSET = 0.6;
/** Look of the plain auto-attack arrow missile. */
export const ARROW_LOOK = Object.freeze({ glyph: 'arrow', color: '#d8c8a0', color2: '#6f5a3a' });

/** Merged object for `game.balance.combat` (data/balance/index.js imports the default). */
const combat = {
  toHitMin: TO_HIT_MIN, toHitMax: TO_HIT_MAX, rollD: ROLL_D,
  monsterHitFlatBonus: MONSTER_HIT_FLAT_BONUS, levelDiffMult: LEVEL_DIFF_MULT,
  monsterMissileDistMult: MONSTER_MISSILE_DIST_MULT, monsterSpellBaseHit: MONSTER_SPELL_BASE_HIT,
  monsterMinHitMelee: MONSTER_MIN_HIT_MELEE, monsterMinHitMissile: MONSTER_MIN_HIT_MISSILE,
  playerAcDexDiv: PLAYER_AC_DEX_DIV, meleeToHitDexDiv: MELEE_TOHIT_DEX_DIV, arrowDistSqDiv: ARROW_DIST_SQ_DIV,
  spellToHitLevelMult: SPELL_TOHIT_LEVEL_MULT,
  blockLevelMult: BLOCK_LEVEL_MULT, blockMin: BLOCK_MIN, blockMax: BLOCK_MAX, blockingAnims: BLOCKING_ANIMS,
  critMult: CRIT_MULT, resistMult: RESIST_MULT, immuneMult: IMMUNE_MULT,
  meleeDmgModDiv: MELEE_DMG_MOD_DIV, rangedDmgModDiv: RANGED_DMG_MOD_DIV, unarmedDmg: UNARMED_DMG,
  weaponVsFlag: WEAPON_VS_FLAG, monsterStaggerLevelBonus: MONSTER_STAGGER_LEVEL_BONUS,
  playerStaggerHeavyDiv: PLAYER_STAGGER_HEAVY_DIV, playerStaggerGraceTicks: PLAYER_STAGGER_GRACE_TICKS, minPlayerDamage: MIN_PLAYER_DAMAGE, minMonsterDamage: MIN_MONSTER_DAMAGE,
  manaShield: { baseReduction: MANA_SHIELD_BASE_REDUCTION, perLevel: MANA_SHIELD_PER_LEVEL, maxLevel: MANA_SHIELD_MAX_LEVEL },
  thornsMin: THORNS_MIN, stealPctDiv: STEAL_PCT_DIV, knockbackTiles: KNOCKBACK_TILES,
  monsterHitTicksDefault: MONSTER_HIT_TICKS_DEFAULT, hitFlashTicks: HIT_FLASH_TICKS,
  bowRangeTiles: BOW_RANGE_TILES,
  elementColors: ELEMENT_COLORS, floatHeadOffset: FLOAT_HEAD_OFFSET, arrowLook: ARROW_LOOK,
};
export default combat;

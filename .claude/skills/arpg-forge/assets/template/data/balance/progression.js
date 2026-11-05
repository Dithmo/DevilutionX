/**
 * Progression balance: XP curve, level-up gains, stat caps, potion restore,
 * movement/animation timing shared by the player modules.
 *
 * Every number cites the genre reference value it was taken from (see
 * references/systems/03-player-items-ui.md §1 "Reference tuning values").
 */

/** Max character level (reference: 50). */
export const MAX_LEVEL = 50;
/** Stat points granted per level (reference: 5). */
export const STAT_POINTS_PER_LEVEL = 5;
/** Max level of any learned skill (reference: max spell level 15). */
export const MAX_SKILL_LEVEL = 15;
/** Max elemental resistance in % (reference: 75). */
export const MAX_RESIST = 75;
/** Hard cap on life and mana pools (reference: 2000). */
export const LIFE_MANA_CAP = 2000;
/** Hard cap on a current (base + items) attribute (reference: 750). */
export const STAT_CAP = 750;

/**
 * XP needed to LEAVE level L (index L; index 0 unused = 0). Reference
 * Experience table, 50 rows; ratio decays from ~2.3 (L1→2) to ~1.2 (L49→50).
 */
export const XP_TABLE = [
  0,
  2000, 4620, 8040, 12489, 18258, 25712, 35309, 47622, 63364, 83419,
  108879, 141086, 181683, 231075, 313656, 424067, 571190, 766569, 1025154, 1366227,
  1814568, 2401895, 3168651, 4166200, 5459523, 7130496, 9281874, 12042092, 15571031, 20066900,
  25774405, 32994399, 42095202, 53525811, 67831218, 85670061, 107834823, 135274799, 169122009, 210720231,
  261657253, 323800420, 399335440, 490808349, 601170414, 733825617, 892680222, 1082908612, 1310707109, 1583495809,
];

/** Per-kill XP cap: min(threshold(level)/20, 200*level) (reference MP anti-powerlevel cap). */
export const XP_CAP_THRESHOLD_DIV = 20;
export const XP_CAP_PER_LEVEL = 200;
/** Level-gap scaling: ±10% per level of difference (reference 1 + (mLvl-cLvl)/10). */
export const XP_LEVEL_GAP_DIV = 10;

/**
 * XP threshold to leave `level`. Levels past the table return the last value.
 * @param {number} level
 * @returns {number}
 */
export function xpThreshold(level) {
  if (level <= 0) return 0;
  if (level >= XP_TABLE.length) return XP_TABLE[XP_TABLE.length - 1];
  return XP_TABLE[level];
}

/**
 * XP a player of level cLvl earns for a monster of level mLvl worth baseXp.
 * Reference: base * (1 + (mLvl - cLvl)/10), floored at 0, then capped at
 * min(threshold(cLvl)/20, 200*cLvl).
 * @param {number} mLvl
 * @param {number} cLvl
 * @param {number} baseXp
 * @returns {number} integer >= 0
 */
export function xpForMonster(mLvl, cLvl, baseXp) {
  const scaled = Math.floor(baseXp * (1 + (mLvl - cLvl) / XP_LEVEL_GAP_DIV));
  if (scaled <= 0) return 0;
  const cap = Math.min(Math.floor(xpThreshold(cLvl) / XP_CAP_THRESHOLD_DIV), XP_CAP_PER_LEVEL * cLvl);
  return Math.max(0, Math.min(scaled, cap));
}

/**
 * Partial potion restore (reference RestorePartialLife): floor(max/8) + rand(0, max/4 - 1).
 * Expressed as divisors; the caller supplies the rng.
 */
export const PARTIAL_RESTORE_BASE_DIV = 8;
export const PARTIAL_RESTORE_RAND_DIV = 4;

/** Tome requirement scaling: each known level raises the Mag requirement by 20% of base (reference). */
export const TOME_REQ_SCALE_PER_LEVEL = 0.2;

/** Mana regeneration: off by default (reference engine has none); opt-in slow trickle. */
export const MANA_REGEN = Object.freeze({ enabled: false, ticksPerPoint: 40 });

/** Walking: 8 walk frames at 1 tick/frame = 8 ticks per tile (reference), i.e. 0.125 tiles/tick. */
export const WALK_TICKS_PER_TILE = 8;
export const BASE_MOVE_SPEED = 1 / WALK_TICKS_PER_TILE;
/** walkSpeed item effect is a percent bonus on BASE_MOVE_SPEED. */
export const WALK_SPEED_PCT_DIV = 100;
/** Max walk speed multiplier (never faster than 2 tiles per 8 ticks). */
export const MAX_MOVE_SPEED_MULT = 2;

/** Re-path throttle when a step is blocked by another actor (ticks) and max attempts before giving up. */
export const REPATH_WAIT_TICKS = 4;
export const MAX_REPATH_TRIES = 6;
/** A* expansion cap for player paths (reference walkpath is 25 steps; we allow longer click-to-walk). */
export const PLAYER_PATH_MAX_NODES = 4000;

/** Ticks of invulnerability after arriving on a level (reference: 10). */
export const ARRIVAL_INVULN_TICKS = 10;

/** Death: ticks before the death screen may be dismissed (reference: 30), gold lost on respawn (reference: half). */
export const DEATH_HOLD_TICKS = 30;
export const DEATH_GOLD_LOSS_FRAC = 0.5;
/** HP after respawn in town (reference: 1). */
export const RESPAWN_HP = 1;

/** Light radius default (reference: 10, range 2..15). */
export const LIGHT_RADIUS_DEFAULT = 10;
export const LIGHT_RADIUS_MIN = 2;
export const LIGHT_RADIUS_MAX = 15;

/** Starting gold for every class (reference: 100). */
export const START_GOLD = 100;

/** Merged object for `game.balance.progression` (data/balance/index.js imports the default). */
const progression = {
  maxLevel: MAX_LEVEL, statPointsPerLevel: STAT_POINTS_PER_LEVEL, maxSkillLevel: MAX_SKILL_LEVEL,
  maxResist: MAX_RESIST, lifeManaCap: LIFE_MANA_CAP, statCap: STAT_CAP,
  xpTable: XP_TABLE, xpThreshold, xpForMonster,
  xpCapThresholdDiv: XP_CAP_THRESHOLD_DIV, xpCapPerLevel: XP_CAP_PER_LEVEL, xpLevelGapDiv: XP_LEVEL_GAP_DIV,
  partialRestoreBaseDiv: PARTIAL_RESTORE_BASE_DIV, partialRestoreRandDiv: PARTIAL_RESTORE_RAND_DIV,
  tomeReqScalePerLevel: TOME_REQ_SCALE_PER_LEVEL, manaRegen: MANA_REGEN,
  walkTicksPerTile: WALK_TICKS_PER_TILE, baseMoveSpeed: BASE_MOVE_SPEED, walkSpeedPctDiv: WALK_SPEED_PCT_DIV,
  maxMoveSpeedMult: MAX_MOVE_SPEED_MULT, repathWaitTicks: REPATH_WAIT_TICKS, maxRepathTries: MAX_REPATH_TRIES,
  playerPathMaxNodes: PLAYER_PATH_MAX_NODES, arrivalInvulnTicks: ARRIVAL_INVULN_TICKS,
  deathHoldTicks: DEATH_HOLD_TICKS, deathGoldLossFrac: DEATH_GOLD_LOSS_FRAC, respawnHp: RESPAWN_HP,
  lightRadiusDefault: LIGHT_RADIUS_DEFAULT, lightRadiusMin: LIGHT_RADIUS_MIN, lightRadiusMax: LIGHT_RADIUS_MAX,
  startGold: START_GOLD,
};
export default progression;

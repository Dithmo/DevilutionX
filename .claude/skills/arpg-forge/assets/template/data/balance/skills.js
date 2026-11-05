/**
 * Skill / spell tuning constants (genre analysis cluster 03 §6). Reference
 * values in trailing comments.
 */
export const SKILLS = Object.freeze({
  maxSkillLevel: 15,            // book use: splLvl = min(splLvl+1, 15)
  scrollSkillLevel: 1,          // scrolls cast at the base scaling (ref: level 0)
  offClassManaMult: 1.25,       // class not in skill.classes pays ×1.25 (ref classes pay ×1.0 / ×0.75)
  inClassManaMult: 1,
  tomeMagReqGrowth: 0.2,        // next tome needs minMag * (1 + 0.2 * knownLevel)
  tomeManaRefund: true,         // learning refunds spell.manaCost mana
  effectiveLevelFloor: 0,       // items can push a level negative → 0 = unusable

  // damage helper: dmg = base + perCasterLevel*clvl + perSkillLevel*slvl (schema), floored
  scalePerLevel: 0.125,         // ScaleSpellEffect: +1/8 per level (used by groundAoe/homing splash)

  heal: {                       // rand(1..10) + Σ_L rand(1..4) + Σ_S rand(1..6)
    baseDie: [1, 10],
    perCasterLevelDie: [1, 4],
    perSkillLevelDie: [1, 6],
  },
  cleave: {
    sideDamageDivisor: 4,       // side tiles take ¼ damage
    toHitPenaltyBase: 35,       // hper -= (35 - level) * 2 ...
    toHitPenaltyPerLevel: 2,
    toHitPenaltyCap: 30,        // ... or 30 past level 20
    toHitPenaltyCapLevel: 20,
  },
  multishot: { count: 3, spreadDeg: 15 },   // 3 arrows at -15°, 0°, +15°
  chain: { radiusBase: 3, radiusCap: 8 },   // radius = min(S + 3, cap)
  nova: { count: 16 },                      // ring of 16 balls
  wall: { length: 7, ticksPerLevelMult: 10 }, // two arms of 7; life 10*(S+1)*16 ticks → we use ticks = 10*(S+1)*wallTickScale
  wallTickScale: 16,
  blink: { radius: 5 },                     // nearest free tile within 5 of click
  summon: { durationPerLevelTicks: 16, durationCap: 30, casterLevelDivisor: 2 }, // min(S + L/2, 30) << 4
  buff: { durationBase: 600, durationPerLevel: 60 }, // 30 s + 3 s per level
  townPortalAllowedModes: ['dungeon'],
  identifyAllowedModes: ['town', 'dungeon'],
  speedPerLevel: 0.05,          // bolt speed 16 + 2S units → +~6% per level (tiles/tick scaled)
  speedBonusCap: 0.6,
  degToRad: Math.PI / 180,
});

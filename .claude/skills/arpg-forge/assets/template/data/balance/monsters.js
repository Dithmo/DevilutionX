/**
 * Monster tuning constants. Every number the monster/AI code uses lives here.
 * "ref:" comments give the reference engine value the constant was adapted from
 * (20 ticks/s, single player, simple 8-frame animation model).
 */
export const monsters = {
  /** Per-difficulty (game.difficulty 0..2) instance scaling. ref §2.2 table. */
  difficulty: [
    { hpMult: 1, hpAdd: 0, dmgMult: 1, dmgAdd: 0, dmgPreAdd: 0, acAdd: 0, toHitAdd: 0, levelAdd: 0, xpMult: 1, xpPreAdd: 0 },
    // ref T1: hp 3*base+100, dmg 2*(d+2), ac +50, toHit +85, lvl +15, xp 2*(xp+1000)
    { hpMult: 3, hpAdd: 100, dmgMult: 2, dmgAdd: 0, dmgPreAdd: 2, acAdd: 50, toHitAdd: 85, levelAdd: 15, xpMult: 2, xpPreAdd: 1000 },
    // ref T2: hp 4*base+200, dmg 4*d+6, ac +80, toHit +120, lvl +30, xp 4*(xp+1000)
    { hpMult: 4, hpAdd: 200, dmgMult: 4, dmgAdd: 6, dmgPreAdd: 0, acAdd: 80, toHitAdd: 120, levelAdd: 30, xpMult: 4, xpPreAdd: 1000 },
  ],
  /** save.js stores difficulty as a name; index into `difficulty` above. */
  difficultyNames: ['normal', 'nightmare', 'hell'],
  /** ref: single player halves table HP. Our theme tables are already SP-sized, so 1. */
  hpMult: 1,
  /** Unique monsters: level = 2*uniqueLevel (ref) → we use uniqueLevel + uniqueLevelAdd; xp ×2. ref §2.2 */
  unique: { levelAdd: 5, xpMult: 2, lightRadius: 3, packSize: [3, 5], minionHpMult: 2 }, // ref pack 8, minion hp ×2
  /** ref: passive regen LVL/128 HP per tick. */
  regenPerLevelPerTick: 1 / 128,

  // --- population -----------------------------------------------------------
  /** Monsters per level = perLevelBase + depth * perDepth (ref: 1 per 30 walkable tiles). */
  perLevelBase: 18,
  perDepth: 2,
  /** Distinct types chosen per level. ref: up to 24 types per level under a sprite budget. */
  typesPerLevel: [3, 6],
  /** Monster level window (±) around the depth's target level when picking types. */
  levelWindow: 4,
  /** Never spawn within this Chebyshev distance of the entry / stairs. ref: vision radius 15. */
  entryExclusion: 10,
  /** ref §2.4: 50% lone monster; depth 1 always lone; depth 2 → 2–3; deeper 3–5. */
  pack: { loneChance: 50, loneDepth: 1, smallPackDepth: 2, smallPack: [2, 3], bigPack: [3, 5], radius: 3 }, // ref leash < 4
  /** Random placement attempts before giving up on a pack. ref: 10 attempts × 100 tries. */
  placeAttempts: 60,
  /** Max monsters alive on a level (ref: 200 − 10 reserve). */
  maxPerLevel: 190,

  // --- perception -------------------------------------------------------------
  /** Tiles within which a dormant monster notices the player (with LOS). ref: player vision radius 15. */
  wakeRadius: 10,
  /** Ticks of pursuit memory after losing sight. ref: activeForTicks 255. */
  awakeTicks: 255,
  /** Radius in which a wake propagates to pack mates / summon neighbours. ref: 5×5 around a summon. */
  packWakeRadius: 6,

  // --- movement -----------------------------------------------------------------
  /** Direct-steer failures tolerated before paying for A*. ref §5.6: 5. */
  blockedThinksBeforeAstar: 5,
  /** A* expansion cap per monster think (ref: 25-step path, 1024-node pool). */
  astarMaxNodes: 400,
  /** Ring-crawl radius when looking for a free tile. ref: 18 default. */
  crawlRadius: 8,
  /** Walk-gate stand threshold (ticks). ref: var2 > 20. */
  walkGateStandTicks: 20,

  // --- animation (8-frame model matching render/draw_actor.js) -----------------
  frames: { stand: 1, walk: 8, attack: 8, cast: 8, hit: 4, death: 10, special: 8 },
  /** Ticks per frame for the idle loop. ref: stand rate 1–5. */
  standFrameTicks: 3,

  // --- combat glue ----------------------------------------------------------------
  /** ref §8.6: a hit of ≥ LVL + 3 whole HP interrupts (hit recovery). */
  staggerLevelAdd: 3,
  /** Monster-vs-monster to-hit: base + toHit − ac + 2·(lvlDiff), clamped. ref MonsterAttackMonster. */
  mvm: { base: 30, levelDiffMult: 2, min: 5, max: 95 },
  /** Guaranteed-hit value used by charges. ref: to-hit 500. */
  sureHit: 500,
  /** Knockback distance in tiles. ref: 1. */
  knockbackTiles: 1,
  /** XP = m.xp × (1 + (mlvl − plvl) × xpLevelDiffPct/100), clamped. */
  xp: { levelDiffPct: 10, minMult: 0, maxMult: 2 },

  // --- death & loot ---------------------------------------------------------------
  /** ref §9.3: rand(100) > 40 → nothing (59%); then rand(100) > 25 → gold (≈31%) else item (≈10%). */
  loot: { dropPct: 41, goldPctOfDrop: 75, uniqueQuality: 'good' },
  /** Ticks a corpse stays in level.monsters after the death anim (0 = forever). */
  corpseTicks: 0,

  // --- AI archetype probabilities, as [a, b] in a·INT + b (percent per think) ---------------
  ai: {
    /** Skeleton-melee cadence. ref §7.3: walk unless rand ≥ 35−4I pause; attack 2I+20; pauses 15−2I+[0,10). */
    rusher: { pause: [-4, 35], attack: [2, 20], pauseFar: [-2, 15], pauseNear: [-2, 10], pauseRand: 10, walkGate: [[4, 20], [4, 70]] },
    /** Fat-bruiser style gate for rushers that just stopped. ref §7.2: 4I+20 / 4I+70. */
    /** Avoidance melee. ref §7.13: walk gate 2I+28 / 2I+78, attack 2I+23, back-off after swing. */
    skirmisher: { walkGate: [[2, 28], [2, 78]], attack: [2, 23], backoffTicks: [10, 20], backoffSteps: 2, fleeHpPct: 25, circleChance: 25 },
    /** Skeleton-archer / plain ranged. ref §7.4/7.14: retreat gate 2I+13 / 2I+63 when D<4; shoot 2I+3 … 10(I+7)% retreat. */
    ranged: { keepMin: 3, keepMax: 6, retreatGate: [[2, 13], [2, 63]], shoot: [4, 12], retreatAdjacent: [10, 70], cooldown: [0, 19] },
    /** Teleporting mage. ref §7.17: cast 5(I+10)%, vanish 30%, flee < ½ HP; delay 2(5−I)+[0,10). */
    caster: { cast: [5, 50], blinkWhenHit: 30, blinkCornered: 50, fleeHpPct: 50, delay: [-2, 10], delayRand: 10, keepMin: 3 },
    /** Invisible stalker reveal distance 5−I. ref §7.12. */
    ambusher: { revealDist: [-1, 5], revealMin: 2, hideDist: [-1, 6] },
    /** Charger. ref §7.6: charge 2I+43% when D≥5 and line clear; attack 2I+28; walk gate 2I+33 / 2I+83. */
    charger: { charge: [2, 43], chargeMin: 2, chargeMax: 8, attack: [2, 28], walkGate: [[2, 33], [2, 83]], speedMult: 3, cooldown: 30 },
    /** Spawner demon / boss summoner. ref §7.8/7.20: summon 4I+35% far; cap by pool. */
    spawner: { summonEvery: 60, summonChance: [4, 35], cap: 4, minDist: 3 },
    /** Erratic flyer. ref §7.9: walk gate I+13 / I+63, attack 4I+8 then retreat 2 steps, 50% random drift. */
    flier: { walkGate: [[1, 13], [1, 63]], attack: [4, 8], randomMove: 50, retreatSteps: 2 },
    /** Tank: slow, never flees, no hit recovery, knockback. ref §7.2 bruiser gate 4I+20 / 4I+70, attack 4I+15. */
    tank: { walkGate: [[4, 20], [4, 70]], attack: [4, 15], knockback: true },
    /** Boss: ranged volley at distance, rusher when close, summons once at 50% HP. ref §7.15 + §7.8. */
    boss: { volley: [5, 10], volleyDist: 3, volleyCount: 3, volleySpread: 1, summonHpPct: 50, summonCount: 3, attack: [2, 30], walkGate: [[2, 33], [2, 83]] },
    /** Player-allied ward. ref §7.21 golem: always attacks when adjacent, A* to nearest hostile, follows owner. */
    ally: { followDist: 2, searchRadius: 8, attack: [0, 100], shootRange: 6 },
  },
};

export default monsters;

/**
 * Missile tuning constants. Speeds are tiles per tick (ref speeds are screen
 * px/tick on a 64 px tile: 16 px ≈ 0.25 tile, 32 px ≈ 0.5 tile). Lifetimes are ticks.
 */
export const missiles = {
  /** Max distance moved between two collision checks. ref §10.4: ≤ ½ screen tile. */
  subStep: 0.5,
  /** Default lifetime for moving projectiles. ref: 256 ticks. */
  defaultRange: 256,
  /** Missiles of a dead owner keep flying; only `charge` dies with its owner. */
  maxPerLevel: 512,
  /** Fraction of the tile the impact point is pulled back along the velocity for the spark. */
  impactBack: 0.3,

  /** Per-archetype defaults; `spawnMissile` spec fields override. */
  arch: {
    bolt: { speed: 0.3, range: 256, look: { shape: 'bolt', size: 5 } }, // ref firebolt 16–26 px
    pierce: { speed: 0.35, range: 256, look: { shape: 'shard', size: 5 } },
    homing: { speed: 0.25, range: 300, seekRadius: 6, turnRate: 0.25, look: { shape: 'orb', size: 5 } }, // ref r19 retarget
    nova: { count: 16, speed: 0.3, range: 40, look: { shape: 'orb', size: 4 } }, // ref 36 balls, 255 ticks
    chain: { speed: 0.5, range: 120, jumps: 4, jumpRadius: 4, decay: 0.8, look: { shape: 'bolt', size: 4 } }, // ref chain r SLVL+3
    wall: { segments: 3, lifetime: 160, tickPeriod: 5, dmgPct: 35, look: { shape: 'ring', size: 7 } }, // ref 6 each side, dmg/8 per tick
    groundAoe: { radius: 1.5, lifetime: 100, tickPeriod: 5, dmgPct: 50, look: { shape: 'ring', size: 9 } }, // ref puddle 40(INT+1)
    arrow: { speed: 0.5, range: 256, look: { shape: 'arrow', size: 6 } }, // ref 32 px/tick
    explode: { speed: 0.3, range: 256, radius: 1, look: { shape: 'orb', size: 6 } }, // ref fireball 3×3
    charge: { speedMult: 3, range: 60, look: null }, // ref 18 px/tick ≈ 3× walk
    blink: { range: 1, searchRadius: 5, look: null }, // ref teleport: nearest free within 5
    summon: { range: 1, searchRadius: 3, look: null },
    spark: { range: 8, look: { shape: 'orb', size: 3 } },
    wallSeg: { look: { shape: 'ring', size: 7 } },
  },

  /** Accuracy penalty per tile travelled for arrows (ref: dist²/2 vs monsters, 2·dist vs player). */
  arrowDistPenalty: 1,
  /** Summoned ward stats: hp = base + perLevel·level (ref golem: 10·SLVL + maxMana/96). */
  ward: { hpBase: 20, hpPerLevel: 10, dmgBase: 2, dmgPerLevel: 2, ac: 25, toHitBase: 40, toHitPerLevel: 5, lifetime: 1200 },
  /** Sfx names used on impact per element. */
  impactSfx: { phys: 'hit', fire: 'explode', cold: 'hit', shock: 'explode', arcane: 'cast' },
};

export default missiles;

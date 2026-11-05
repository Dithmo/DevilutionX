/**
 * Level generation / population tuning.
 *
 * Reference values come from the genre analysis (a 40x40 mega-tile grid where
 * one mega tile = 2x2 world tiles). Our levels are plain per-tile grids, so
 * counts are rescaled; the reference number is quoted in each comment.
 * Every module reads these through `game.balance.levels` and falls back to
 * this object when the integrator has not merged balance data yet.
 */
export const LEVELS = {
  /** Layout retries before the generator gives up and returns the last attempt. (ref: unbounded) */
  maxAttempts: 20,

  /** Grid sizes per generator family [w, h]. */
  grid: { rooms: [48, 48], halls: [48, 48], caves: [56, 56], mirrored: [40, 40] },

  /** Minimum walkable floor tiles per generator. (ref: A 533/693/761 of 1600, B void<=700, C 600, D 692) */
  minFloor: { rooms: 480, halls: 480, caves: 800, mirrored: 380 },

  stairs: {
    minDist: 15,        // Chebyshev tiles between up and down stairs
    haloRadius: 1,      // NO_SPAWN ring around each staircase (ref: 5x5 "Populated" halo)
    entrySearch: 3,     // ring-crawl radius when looking for the arrival tile
    farFraction: 0.5,   // down stairs are picked among the farthest half of candidates (by BFS distance)
  },

  /** Colour multipliers used to derive the render palette from a tileset. */
  palette: { speckle: 0.8, wallRight: 0.7, wallTop: 1.2, stairsLight: 1.4, waterSpeckle: 0.7 },

  /** Generator A/B hybrid: BSP rooms, random-walk corridors, doors, pillared chambers. */
  rooms: {
    leafMin: 6,               // BSP leaf side (room = leaf - 2 margin)         (ref B: rooms 4..10)
    leafMax: 12,
    splitPct: 55,             // chance to split a leaf that fits but is not forced
    roomMin: 4,
    skipRoomPct: 8,           // leaves left empty for variety
    chambers: [0, 3],         // pillared 10x10 chambers per level               (ref A: 0..3)
    chamberSize: 10,
    pillarOffsets: [[3, 3], [6, 3], [3, 6], [6, 6]],  // (ref A: (4,4),(7,4),(4,7),(7,7) in an 11x11)
    randomWalkPct: 50,        // else an L-shaped corridor
    reaimH: [2, 30],          // re-aim horizontally with min(2*dx, 30)%        (ref B)
    reaimV: [5, 80],          // re-aim vertically with min(5*dy, 80)%          (ref B)
    driftPct: 12,             // random perpendicular wander per step
    maxWalkMult: 6,           // walk step cap = mult * (w + h)
    extraCorridors: [1, 3],   // loops added after the tree is connected
    extraMaxDist: 22,
    doorPct: 70,              // qualifying openings that get a door object     (ref: every separating wall)
    floorAltPct: 33,          // room floor variant 2 sprinkle                   (ref A FillFloor: 1/3)
  },

  /** Generator D (mirrored) and the ossuary (long halls) variant. */
  halls: {
    seedRoom: [3, 7],         // mirrored seed room side                          (ref: 2..6)
    roomSizes: [2, 4, 6],     // recursive side-room sides                        (ref: even 2/4/6)
    placeTries: 20,
    flipPctMirror: 75,        // orientation flip per recursion                   (ref D: 3/4)
    flipPctOssuary: 25,       //                                                  (ref A: 1/4)
    maxRooms: 80,
    maxDepth: 14,
    minRunMirror: 4,          // floor run length before a wall is carved         (ref D: > 3)
    minRunOssuary: 2,
    doorwayMirror: 3,         // 3-wide open doorways                             (ref D)
    doorwayOssuary: 1,        // 1-wide with a door object                        (ref B)
    wallPct: 85,              // qualifying runs that get walled
    doorPct: 80,
    hallWidth: 3,
    hallMargin: 4,
    chamber: [5, 8],
    alcoveSizes: [2, 3, 4],
    alcoveStep: [4, 7],
    alcovePct: 60,
    alcoveDepth: 2,
    floorAltPct: 10,          // (ref D: 1/10 floor variants)
  },

  /** Generator C: blob growth, smoothing, flood fill, pools, fences, walled cells. */
  caves: {
    seedBand: [0.25, 0.7],    // seed room position as a fraction of the grid      (ref: 10..29 of 40)
    blockSizes: [3, 4],
    continuePct: 75,          // recurse after a block lands                        (ref: rnd(4) != 0)
    ragPct: 50,               // border cells of a block that become floor          (ref: 50%)
    targetFloor: 1100,        // keep growing until this many cells                 (ref: >= 600 of 1600)
    growTries: 400,
    maxDepth: 60,
    smoothPasses: 2,          // cellular 4-5 rule passes
    smoothBirth: 5,           // >= this many floor neighbours -> floor
    smoothDeath: 2,           // <= this many floor neighbours -> rock
    pools: [0, 2],            // water pools per level                              (ref: >= 1 lava pool, 25% per region)
    poolMin: 5,
    poolMax: 40,
    fences: [0, 3],           // 1-tile fences with one gap                         (ref: 50% of eligible lines)
    fenceSpan: [3, 10],
    fenceTries: 40,
    cells: [1, 2],            // walled theme cells carved into open floor          (ref: theme rooms 5..10)
    cellInner: [5, 7],
    cellTries: 80,
    openRoomSize: 6,
    openRooms: 6,
    floorAltPct: 25,          // (ref: 25% floor variants)
  },

  populate: {
    themedRooms: [1, 3],
    themedMinSize: 5,
    oneShotThemes: ['treasure', 'armory', 'library', 'shrine'],
    chests: [2, 5],               // (ref: small 5-9, medium 3-5, large 1-4 on 80x80)
    largeChestPct: 30,
    chestTrapPctByTier: [10, 15, 20, 25, 25],  // (ref: 10/15/20/25% by level 1/2+/5+/7+)
    breakables: [6, 14],
    breakableGroup: [3, 7],        // (ref: 3-7 groups, grow while rnd(count/2)==0)
    breakableGrowTries: 3,
    explosivePct: 20,              // (ref: 1/4 first, 1/5 subsequent)
    altars: [0, 2],
    signs: [0, 1],
    fountainPct: 30,
    groundItems: [2, 5],
    goldPiles: [3, 6],
    treasureChests: [3, 5],
    treasureGold: [2, 4],
    libraryStands: [2, 4],
    armoryDrops: 2,
    armoryCrates: [2, 4],
    barrelRoom: [6, 10],
    denPack: [6, 8],
    tortureDecor: [2, 4],
    tortureUniquePct: 25,
    bossFollowers: [4, 6],
    denFollowers: [3, 5],
    vaultChestLoot: [2, 3],
    placeTries: 60,
    spawnMargin: 1,                // 3x3 free area for chests/altars            (ref: 3x3)
  },

  objects: {
    doorAutoCloseTicks: 0,         // 0 = doors stay open once opened
    chestTrapDmg: [2, 6],
    chestTrapDmgPerTier: 3,
    breakableGoldPct: 33,          // (ref: rnd(10) <= 1 -> item)
    breakableItemPct: 17,
    explosionDmgPlayer: [8, 16],   // (ref: 8-16 fire to players)
    explosionDmgMonster: [1, 4],   // (ref: 1-4 to monsters)
    explosionRadius: 1,
    fountainHeal: 5,
    fountainMana: 5,
    bookstandTomePct: 20,          // (ref: 1/5 spellbook else scroll)
    altarSpawnCount: [3, 5],
    altarGoldPiles: [3, 5],
    altarResistAmount: 10,
    altarResistCap: 75,
    altarStatSwap: { drain: 1, boost: 6 },   // (ref: -1 all, +6 one)
    altarDurability: { bless: 10, curse: 20 },
    altarBuffTicks: 1200,
    altarBuffDmgPct: 25,
    altarDrainPct: 10,              // (ref: lose 10% max mana)
    allowCrippling: true,
    flickerPeriod: 6,
    levelUpSkillMax: 15,
  },

  town: {
    plazaSize: [12, 10],
    buildings: [5, 7],
    buildingW: [5, 8],
    buildingH: [4, 7],
    buildingMargin: 2,
    placeTries: 200,
    groundAltPct: 20,
    streetHalf: 3,
    ringRadius: [0.3, 0.42],
    lampLight: 6,
  },
};

export default LEVELS;

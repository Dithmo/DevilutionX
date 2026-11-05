/**
 * Loot / item tuning constants. Every number the item modules use lives here.
 * Reference values (from the genre analysis, cluster 03 §3–§5) are given in
 * the trailing comment of each line; change the value, keep the comment.
 */
export const LOOT = Object.freeze({
  // --- quality roll (§3.2 GetItemBLevel / CheckUnique) ---
  magicFlatChance: 10,          // rand(100) <= 10 → magic tier regardless of ilvl
  uniqueChanceNormal: 1,        // "uper" 1: rand(100) > uper → not unique (≈2% real)
  uniqueChanceBoss: 15,         // "uper" 15 for unique monsters / bosses (≈16% real)
  uniqueBossLevelBonus: 4,      // iblvl = lvl + 4 when the source is a unique monster
  rareChanceDivisor: 2,         // rare = rand(100) < ilvl / 2 ...
  rareChanceCap: 20,            // ... capped at 20% (engine addition; reference has no rare tier)
  rarePrefixes: 2,              // rare = 2 prefixes + 2 suffixes
  rareSuffixes: 2,
  alwaysMagicTypes: ['ring', 'amulet', 'staff'], // misc in {Staff, Ring, Amulet} → iblvl = lvl

  // --- affix allocation (§3.4 GetItemPower) ---
  prefixChance: 25,             // rand(4) == 0
  suffixChance: 67,             // rand(3) != 0 (66.7%)
  cursedGateChance: 33,         // cursed pool only open when rand(3) == 0 (1/3)
  affixMinLevelDivisor: 2,      // level window [ilvl/2, ilvl]
  affixMinLevelCap: 25,         // minlvl = min(minlvl, 25) so deep drops still roll mid tiers
  onlyGoodMinLevelDivisor: 2,   // onlyGood base pool: base.level >= ilvl/2 (premium vendor rule plvl/4..plvl tightened)

  // --- durability (§3.2 ItemRndDur) ---
  dropDurMinFrac: 0.25,         // durability on drop 25%..75% of max
  dropDurMaxFrac: 0.75,
  indestructibleDur: 255,       // dur = max = 255 marks indestructible

  // --- prices (§4.7) ---
  priceMin: 1,                  // identifiedValue = max(..., 1)
  sellDivisor: 4,               // sell = max(value / 4, 1)
  vendorPriceCap: 140000,       // base-mode vendor reroll cap
  peddlerPriceCap: 90000,
  peddlerMarkup: 1.5,           // peddler sells at v + v/2
  identifyCost: 100,
  repairDivisor: 2,             // repair = baseValue * due / (maxDur * 2)

  // --- gold (§3.8, §5.5) ---
  goldPerLevelBase: 5,          // v = 5*dlvl + rand(10*dlvl)
  goldPerLevelRand: 10,
  goldDropCap: 5000,            // single pile cap
  goldStack: 5000,              // reference stack size (informational; we keep a counter)
  goldPlayerCap: 250000,        // counter cap = 50 stacks × 5000 (40 cells + stash headroom)

  // --- potions (§1.8 RestorePartialLife) ---
  potionRandFrac: 0.5,          // amount = max*value + rand(0, max*value*0.5)  (ref: max/8 + rand(max/4))

  // --- grid / belt / stash (§5) ---
  gridW: 10,
  gridH: 4,
  beltSlots: 8,
  stashW: 10,
  stashH: 10,
  dropSearchRadius: 6,          // ring search for a free floor tile (ref: 3×3 then rings 2..49)
  maxGroundItems: 127,          // world item cap

  // --- stat / resist clamps (§4.1, §1) ---
  resistCap: 75,
  statMax: 750,
  lifeManaCap: 2000,
  lightRadiusBase: 10,
  lightRadiusMin: 2,
  lightRadiusMax: 15,
  unarmedDmg: [1, 1],           // no weapon: 1-1
  shieldOnlyDmg: [1, 3],        // shield but no weapon: 1-3
  dexPerAc: 5,                  // ac += dex / 5
  meleeToHitDexDivisor: 2,      // melee to-hit: level + dex/2 + ...
  blockPerLevel: 2,             // block = dex + classBlock + 2*level
  dmgModDivisor: { melee: 100, ranged: 200, caster: 100 }, // L*Str/100, L*(Str+Dex)/200
  offPrefWeaponDmgMult: 0.5,    // bow used by a non-ranged class: half the class damage bonus
  toHitClamp: [5, 95],
  attackSpeedMax: 4,            // quick/fast/faster/fastest frame skips
  hitRecoverMax: 3,
  maxSpellLevelBonus: 2,

  // --- tooltip ---
  tooltipMaxAffixes: 6,
});

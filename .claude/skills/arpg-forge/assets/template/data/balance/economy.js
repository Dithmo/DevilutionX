/**
 * Economy tuning: vendor stock sizes, item-level window, price caps and
 * service costs. Everything npc/npcs.js reads lives here.
 */
export default {
  /** Vendor item level = clamp(deepestDepth + stockLevelBonus, stockLevelMin, stockLevelMax). */
  stockLevelBonus: 2,
  stockLevelMin: 6,
  stockLevelMax: 16,
  /** Premium slots roll at stockLevel + one of these offsets. */
  premiumOffsets: [-1, -1, 0, 0, 1, 2],
  premiumCount: 2,
  /** Stock counts per vendor type, [lo, hi] inclusive. */
  counts: {
    weapons: [6, 10],
    armor: [6, 10],
    magic: [4, 8],
    junk: [3, 6],
  },
  /** Potion vendor: base count per kind plus one more every `potionPerDepth` levels of stock level. */
  potions: { heal: 3, mana: 3, rejuv: 1, perDepth: 4 },
  /** Junk vendor rolls this many item levels below the stock level (min 1). */
  junkLevelPenalty: 3,
  /** Rejected while price.buy exceeds the cap; bounded by `rerollTries`. */
  priceCaps: { weapons: 140000, armor: 140000, magic: 140000, potions: 140000, junk: 90000 },
  rerollTries: 20,
  /** Items vendors always carry (regenerated when bought). */
  pinned: {
    magic: ['c_scroll_portal', 'c_scroll_identify'],
    potions: ['c_minor_heal', 'c_minor_mana'],
  },
  /** sell = max(floor(buy / sellDivisor), 1) */
  sellDivisor: 4,
  sellMin: 1,
  /** Service prices. Heal is free (reference behaviour). */
  healCost: 0,
  identifyCost: 100,
  /** repair = max(ceil(value * missing / max * repairFraction), 1) */
  repairFraction: 0.5,
  repairMin: 1,
  /** recharge = ceil(value * missingCharges / maxCharges * rechargeFraction) */
  rechargeFraction: 0.5,
  rechargeMin: 1,
  /** Gold the player may carry. */
  maxGold: 100000,
  /** Quest reward item level = quest depth + this. */
  questItemLevelBonus: 2,
};

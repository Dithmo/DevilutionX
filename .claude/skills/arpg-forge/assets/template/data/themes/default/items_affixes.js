/**
 * Default theme affix tables (imported by items.js).
 *
 * Row: { id, name, kind, slots, minLevel, maxLevel?, stat, range:[lo,hi],
 *        priceAdd:[lo,hi], priceMult, cursed?, power:1..3, weight? }
 * `slots` mixes equipment slots and base types (see CONTRACTS Item.slot/type):
 *   W = melee weapons (sword/axe/mace/wand)  B = bow  S = staff  Sh = shield
 *   A = armour (body/head)                   M = jewellery (ring/amulet)
 * Tiers follow the reference affix families (cluster 03 §3 tables), compressed
 * to a 1–30 level band. Weight 2 for to-hit / damage% / armour% families.
 */
const W = ['sword', 'axe', 'mace', 'wand'];
const B = ['bow'];
const S = ['staff'];
const Sh = ['shield'];
const A = ['body', 'head'];
const M = ['ring', 'amulet'];
const ALL = [...W, ...B, ...S, ...Sh, ...A, ...M];

function row(id, name, kind, slots, minLevel, stat, range, priceAdd, priceMult, power, extra = {}) {
  return { id, name, kind, slots, minLevel, stat, range, priceAdd, priceMult, power, ...extra };
}
const P = (...a) => row(a[0], a[1], 'prefix', ...a.slice(2));
const Sx = (...a) => row(a[0], a[1], 'suffix', ...a.slice(2));
const CURSED = { cursed: true, power: 1 };

export const prefixes = [
  // +to-hit %  (ref: 1-5@1 ×2, 6-10@4 ×3, 11-15@6 ×5, 16-20@9 ×7, 21-30@12 ×9)
  P('p_tohit_1', 'Steady', [...W, ...B, ...M], 1, 'toHit', [1, 5], [100, 500], 2, 1, { weight: 2 }),
  P('p_tohit_2', 'Keen', [...W, ...B, ...M], 4, 'toHit', [6, 10], [600, 1000], 3, 1, { weight: 2 }),
  P('p_tohit_3', 'Sure', [...W, ...B, ...M], 6, 'toHit', [11, 15], [1100, 1500], 5, 2, { weight: 2 }),
  P('p_tohit_4', 'Unerring', [...W, ...B, ...M], 9, 'toHit', [16, 20], [1600, 2000], 7, 2, { weight: 2 }),
  P('p_tohit_5', 'Hawkeyed', [...W, ...B, ...M], 12, 'toHit', [21, 30], [2100, 3000], 9, 3, { weight: 2 }),
  P('p_tohit_c1', 'Clumsy', [...W, ...B, ...M], 1, 'toHit', [-5, -1], [0, 0], -2, 1, CURSED),
  P('p_tohit_c2', 'Fumbling', [...W, ...B, ...M], 3, 'toHit', [-10, -6], [0, 0], -3, 1, CURSED),
  // +damage %  (ref: 20-35@4 ×3, 36-50@6 ×4, 51-65@9 ×5, 66-80@12 ×8, 81-95@16 ×10, 96-110@20 ×13)
  P('p_dmg_1', 'Honed', [...W, ...B], 4, 'dmgPct', [20, 35], [250, 450], 3, 1, { weight: 2 }),
  P('p_dmg_2', 'Cruel', [...W, ...B], 6, 'dmgPct', [36, 50], [500, 700], 4, 1, { weight: 2 }),
  P('p_dmg_3', 'Brutal', [...W, ...B], 9, 'dmgPct', [51, 65], [750, 950], 5, 2, { weight: 2 }),
  P('p_dmg_4', 'Savage', [...W, ...B], 12, 'dmgPct', [66, 80], [1000, 1450], 8, 2, { weight: 2 }),
  P('p_dmg_5', 'Ruinous', [...W, ...B], 16, 'dmgPct', [81, 95], [1500, 1950], 10, 3, { weight: 2 }),
  P('p_dmg_6', 'Merciless', [...W, ...B], 20, 'dmgPct', [96, 110], [2000, 2450], 13, 3, { weight: 2 }),
  P('p_dmg_c1', 'Dull', [...W, ...B], 1, 'dmgPct', [-45, -25], [0, 0], -3, 1, CURSED),
  // +armour %  (ref: 20-30@1 ×2, 31-40@3 ×3, 41-55@6 ×5, 56-70@10 ×7, 71-90@14 ×9, 91-110@19 ×11, 111-130@24 ×13)
  P('p_ac_1', 'Sturdy', [...A, ...Sh], 1, 'acPct', [20, 30], [20, 100], 2, 1, { weight: 2 }),
  P('p_ac_2', 'Stout', [...A, ...Sh], 3, 'acPct', [31, 40], [120, 200], 3, 1, { weight: 2 }),
  P('p_ac_3', 'Fortified', [...A, ...Sh], 6, 'acPct', [41, 55], [220, 300], 5, 2, { weight: 2 }),
  P('p_ac_4', 'Bastion', [...A, ...Sh], 10, 'acPct', [56, 70], [320, 400], 7, 2, { weight: 2 }),
  P('p_ac_5', 'Bulwark', [...A, ...Sh], 14, 'acPct', [71, 90], [420, 600], 9, 3, { weight: 2 }),
  P('p_ac_6', 'Adamant', [...A, ...Sh], 19, 'acPct', [91, 110], [620, 800], 11, 3, { weight: 2 }),
  P('p_ac_7', 'Unbreached', [...A, ...Sh], 24, 'acPct', [111, 130], [820, 1200], 13, 3, { weight: 2 }),
  P('p_ac_c1', 'Rusted', [...A, ...Sh], 1, 'acPct', [-50, -25], [0, 0], -2, 1, CURSED),
  P('p_acflat_1', 'Guarded', M, 3, 'ac', [2, 6], [300, 900], 2, 1),
  // single resists (ref: 10-20@4 ×2, 21-30@10 ×2, 31-40@16 ×2, 41-50@20 ×3)
  P('p_rfire_1', 'Ember', ALL, 4, 'resFire', [10, 20], [500, 1500], 2, 1),
  P('p_rfire_2', 'Kiln', ALL, 10, 'resFire', [21, 30], [2100, 3000], 2, 2),
  P('p_rfire_3', 'Furnace', ALL, 16, 'resFire', [31, 40], [3100, 4000], 2, 3),
  P('p_rfire_4', 'Pyre', ALL, 20, 'resFire', [41, 50], [8200, 12000], 3, 3),
  P('p_rcold_1', 'Rime', ALL, 4, 'resCold', [10, 20], [500, 1500], 2, 1),
  P('p_rcold_2', 'Glacial', ALL, 10, 'resCold', [21, 30], [2100, 3000], 2, 2),
  P('p_rcold_3', 'Boreal', ALL, 16, 'resCold', [31, 40], [3100, 4000], 2, 3),
  P('p_rcold_4', 'Hoarfrost', ALL, 20, 'resCold', [41, 50], [8200, 12000], 3, 3),
  P('p_rshock_1', 'Grounded', ALL, 4, 'resShock', [10, 20], [500, 1500], 2, 1),
  P('p_rshock_2', 'Insulated', ALL, 10, 'resShock', [21, 30], [2100, 3000], 2, 2),
  P('p_rshock_3', 'Stormproof', ALL, 16, 'resShock', [31, 40], [3100, 4000], 2, 3),
  P('p_rshock_4', 'Thunderward', ALL, 20, 'resShock', [41, 50], [8200, 12000], 3, 3),
  P('p_rarc_1', 'Warded', ALL, 4, 'resArcane', [10, 20], [500, 1500], 2, 1),
  P('p_rarc_2', 'Hexproof', ALL, 12, 'resArcane', [21, 30], [2100, 3000], 2, 2),
  P('p_rarc_3', 'Nullwoven', ALL, 20, 'resArcane', [31, 40], [3100, 4000], 2, 3),
  // resist all (ref: 10-15@8 ×3, 16-20@12 ×3, 21-30@18 ×3)
  P('p_rall_1', 'Shimmering', ALL, 8, 'resAll', [10, 15], [2000, 5000], 3, 1),
  P('p_rall_2', 'Prismatic', ALL, 12, 'resAll', [16, 20], [7400, 10000], 3, 2),
  P('p_rall_3', 'Radiant', ALL, 18, 'resAll', [21, 30], [11000, 15000], 3, 3),
  // +mana (ref: 10-15@1 ×2, 15-20@5 ×3, 21-30@9 ×5, 30-40@15 ×7, 41-50@21 ×9) and curse
  P('p_mana_1', 'Lunar', [...S, ...M], 1, 'mana', [10, 15], [500, 1000], 2, 1),
  P('p_mana_2', 'Mystic', [...S, ...M], 5, 'mana', [15, 20], [1100, 2000], 3, 1),
  P('p_mana_3', 'Arcane', [...S, ...M], 9, 'mana', [21, 30], [2100, 4000], 5, 2),
  P('p_mana_4', 'Astral', [...S, ...M], 15, 'mana', [30, 40], [4100, 6000], 7, 2),
  P('p_mana_5', 'Eldritch', [...S, ...M], 21, 'mana', [41, 50], [6100, 10000], 9, 3),
  P('p_mana_c1', 'Hollow', [...S, ...M], 1, 'mana', [-10, -1], [0, 0], -2, 1, CURSED),
  // spell levels (ref: +1@15 ×2, +2@25 ×3)
  P('p_spl_1', 'Sage\'s', [...S, 'amulet'], 15, 'spellLevels', [1, 1], [25000, 25000], 2, 2),
  P('p_spl_2', 'Oracle\'s', S, 25, 'spellLevels', [2, 2], [50000, 50000], 3, 3),
  // elemental hit damage (ref: fire 1-10@7 ×2, lightning 2-20@18 ×2)
  P('p_efire', 'Burning', [...W, ...S], 7, 'elemDmgFire', [1, 10], [5000, 5000], 2, 2),
  P('p_eshock', 'Crackling', [...W, ...S], 18, 'elemDmgShock', [2, 20], [10000, 10000], 2, 3),
  P('p_ecold', 'Frozen', [...W, ...S], 12, 'elemDmgCold', [1, 12], [6000, 6000], 2, 2),
];

export const suffixes = [
  // flat damage (ref: 1-2@2 ×2, 3-5@7 ×3, 6-8@15 ×5, 9-12@25 ×8)
  Sx('s_dmgflat_1', 'Quality', [...W, ...B], 2, 'dmgFlat', [1, 2], [100, 200], 2, 1),
  Sx('s_dmgflat_2', 'Maiming', [...W, ...B], 7, 'dmgFlat', [3, 5], [1300, 1500], 3, 2),
  Sx('s_dmgflat_3', 'Slaying', W, 15, 'dmgFlat', [6, 8], [2600, 3000], 5, 3),
  Sx('s_dmgflat_4', 'Gore', W, 25, 'dmgFlat', [9, 12], [4100, 5000], 8, 3),
  // strength / dexterity / magic / vitality (ref: 1-5@1 ×2, 6-10@5 ×3, 11-15@11 ×4, 16-20@17 ×7, 21-30@23 ×10)
  Sx('s_str_1', 'Strength', [...A, ...Sh, ...W, ...B, ...M], 1, 'str', [1, 5], [200, 1000], 2, 1),
  Sx('s_str_2', 'Might', [...A, ...Sh, ...W, ...B, ...M], 5, 'str', [6, 10], [1200, 2000], 3, 1),
  Sx('s_str_3', 'Power', [...A, ...Sh, ...W, ...B, ...M], 11, 'str', [11, 15], [2200, 3000], 4, 2),
  Sx('s_str_4', 'Giants', [...A, ...W, ...B, ...M], 17, 'str', [16, 20], [3200, 5000], 7, 3),
  Sx('s_str_5', 'Titans', [...W, ...M], 23, 'str', [21, 30], [5200, 10000], 10, 3),
  Sx('s_str_c1', 'Frailty', [...A, ...Sh, ...W, ...B, ...M], 1, 'str', [-5, -1], [0, 0], -2, 1, CURSED),
  Sx('s_dex_1', 'Skill', [...A, ...Sh, ...W, ...B, ...M], 1, 'dex', [1, 5], [200, 1000], 2, 1),
  Sx('s_dex_2', 'Accuracy', [...A, ...Sh, ...W, ...B, ...M], 5, 'dex', [6, 10], [1200, 2000], 3, 1),
  Sx('s_dex_3', 'Precision', [...A, ...Sh, ...W, ...B, ...M], 11, 'dex', [11, 15], [2200, 3000], 4, 2),
  Sx('s_dex_4', 'Perfection', [...A, ...W, ...B, ...M], 17, 'dex', [16, 20], [3200, 5000], 7, 3),
  Sx('s_dex_5', 'the Falcon', [...B, ...M], 23, 'dex', [21, 30], [5200, 10000], 10, 3),
  Sx('s_mag_1', 'the Mind', [...A, ...Sh, ...W, ...S, ...B, ...M], 1, 'mag', [1, 5], [200, 1000], 2, 1),
  Sx('s_mag_2', 'Brilliance', [...A, ...Sh, ...W, ...S, ...B, ...M], 5, 'mag', [6, 10], [1200, 2000], 3, 1),
  Sx('s_mag_3', 'Sorcery', [...A, ...Sh, ...W, ...S, ...B, ...M], 11, 'mag', [11, 15], [2200, 3000], 4, 2),
  Sx('s_mag_4', 'Wizardry', [...A, ...W, ...S, ...B, ...M], 17, 'mag', [16, 20], [3200, 5000], 7, 3),
  Sx('s_mag_5', 'the Archon', [...S, ...M], 23, 'mag', [21, 30], [5200, 10000], 10, 3),
  Sx('s_vit_1', 'Vigour', [...A, ...Sh, ...W, ...B, ...M], 1, 'vit', [1, 5], [200, 1000], 2, 1),
  Sx('s_vit_2', 'Zest', [...A, ...Sh, ...W, ...B, ...M], 5, 'vit', [6, 10], [1200, 2000], 3, 1),
  Sx('s_vit_3', 'Vim', [...A, ...Sh, ...W, ...B, ...M], 11, 'vit', [11, 15], [2200, 3000], 4, 2),
  Sx('s_vit_4', 'Vitality', [...A, ...W, ...B, ...M], 17, 'vit', [16, 20], [3200, 5000], 7, 3),
  Sx('s_vit_c1', 'Sickness', [...A, ...Sh, ...W, ...B, ...M], 1, 'vit', [-5, -1], [0, 0], -2, 1, CURSED),
  // all attributes (ref: 1-3@5 ×5, 4-7@11 ×10, 8-11@17 ×15)
  Sx('s_all_1', 'the Sky', [...A, ...Sh, ...W, ...B, ...M], 5, 'allStats', [1, 3], [800, 4000], 5, 1),
  Sx('s_all_2', 'the Moon', [...A, ...Sh, ...W, ...B, ...M], 11, 'allStats', [4, 7], [4800, 8000], 10, 2),
  Sx('s_all_3', 'the Stars', [...A, ...W, ...B, ...M], 17, 'allStats', [8, 11], [8800, 12000], 15, 3),
  // +life (ref: 10-15@1 ×2, 16-20@5 ×3, 21-30@9 ×5, 30-40@15 ×7, 41-50@21 ×9) and curse
  Sx('s_life_1', 'the Jackal', [...A, ...Sh, ...M], 1, 'life', [10, 15], [100, 1000], 2, 1),
  Sx('s_life_2', 'the Fox', [...A, ...Sh, ...M], 5, 'life', [16, 20], [1100, 2000], 3, 1),
  Sx('s_life_3', 'the Boar', [...A, ...Sh, ...M], 9, 'life', [21, 30], [2100, 4000], 5, 2),
  Sx('s_life_4', 'the Bear', [...A, ...Sh, ...M], 15, 'life', [30, 40], [4100, 6000], 7, 2),
  Sx('s_life_5', 'the Aurochs', [...A, ...Sh, ...M], 21, 'life', [41, 50], [6100, 10000], 9, 3),
  Sx('s_life_c1', 'the Leech', [...A, ...Sh, ...M], 1, 'life', [-10, -1], [0, 0], -2, 1, CURSED),
  // durability (ref: 26-75@1 ×2, 51-100@6 ×2, 101-200@12 ×2, indestructible@25 ×5)
  Sx('s_dur_1', 'Sturdiness', [...A, ...Sh, ...W, ...B], 1, 'durability', [26, 75], [100, 100], 2, 1),
  Sx('s_dur_2', 'Structure', [...A, ...Sh, ...W, ...B], 6, 'durability', [51, 100], [200, 200], 2, 1),
  Sx('s_dur_3', 'the Ages', [...A, ...Sh, ...W, ...B], 12, 'durability', [101, 200], [300, 300], 2, 2),
  Sx('s_indestr', 'Eternity', [...A, ...Sh, ...W, ...B], 25, 'indestructible', [1, 1], [600, 600], 5, 3),
  // light radius (ref: +2@4 ×2, +4@8 ×3, curse -2@3)
  Sx('s_light_1', 'Light', [...A, ...W, ...M], 4, 'lightRadius', [2, 2], [750, 750], 2, 1),
  Sx('s_light_2', 'Radiance', [...A, ...W, ...M], 8, 'lightRadius', [4, 4], [1500, 1500], 3, 2),
  Sx('s_light_c1', 'Gloom', [...A, ...W, ...M], 3, 'lightRadius', [-2, -2], [0, 0], -2, 1, CURSED),
  // thorns, knockback (ref: thorns 1-3@1 ×2; knockback @5 ×2)
  Sx('s_thorns', 'Thorns', [...A, ...Sh], 1, 'thorns', [1, 3], [500, 500], 2, 1),
  Sx('s_knock', 'Shoving', [...W, ...S, ...B], 5, 'knockback', [1, 1], [750, 750], 2, 1),
  // steal (ref: 3%@8 ×3, 5%@19 ×3)
  Sx('s_lsteal_1', 'the Bat', W, 8, 'lifeSteal', [3, 3], [7500, 7500], 3, 2),
  Sx('s_lsteal_2', 'the Vampire', W, 19, 'lifeSteal', [5, 5], [15000, 15000], 3, 3),
  Sx('s_msteal_1', 'the Siphon', W, 8, 'manaSteal', [3, 3], [7500, 7500], 3, 2),
  Sx('s_msteal_2', 'the Drinker', W, 19, 'manaSteal', [5, 5], [15000, 15000], 3, 3),
  // attack speed (ref: quick@1 ×2, fast@10 ×4, faster@19 ×8) and hit recovery (fast@1 ×2, faster@10 ×4, fastest@20 ×8)
  Sx('s_aspd_1', 'Readiness', [...W, ...S, ...B], 1, 'attackSpeed', [1, 1], [2000, 2000], 2, 1),
  Sx('s_aspd_2', 'Swiftness', [...W, ...S, ...B], 10, 'attackSpeed', [2, 2], [4000, 4000], 4, 2),
  Sx('s_aspd_3', 'Haste', [...W, ...S], 19, 'attackSpeed', [3, 3], [8000, 8000], 8, 3),
  Sx('s_hrec_1', 'Balance', [...A, ...M], 1, 'hitRecover', [1, 1], [2000, 2000], 2, 1),
  Sx('s_hrec_2', 'Stability', [...A, ...M], 10, 'hitRecover', [2, 2], [4000, 4000], 4, 2),
  Sx('s_hrec_3', 'Harmony', [...A, ...M], 20, 'hitRecover', [3, 3], [8000, 8000], 8, 3),
  // block, walk speed, mana cost, cold arrows (engine additions over the reference vocabulary)
  Sx('s_block', 'Blocking', Sh, 5, 'blockPct', [5, 10], [4000, 4000], 4, 2),
  Sx('s_walk', 'the Hare', A, 10, 'walkSpeed', [10, 15], [3000, 3000], 3, 2),
  Sx('s_thrift', 'Thrift', [...S, ...M], 12, 'manaCostPct', [10, 20], [5000, 5000], 4, 2),
  Sx('s_frostarrow', 'Frost', B, 5, 'elemDmgCold', [1, 6], [2000, 2000], 2, 1),
  Sx('s_firearrow', 'Cinders', B, 11, 'elemDmgFire', [1, 10], [4000, 4000], 4, 2),
];

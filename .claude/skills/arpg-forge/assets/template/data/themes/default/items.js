/**
 * Default theme ("Hollow Vigil") item tables: bases, affixes, uniques,
 * consumables, rare-name word lists. Ids are fixed by DEFAULT_THEME_IDS.
 *
 * Base rows follow the reference tables (cluster 03 §3): level = minimum
 * monster level that can drop it, dmg/ac ranges, durability, requirements,
 * value. Glyphs come from render/draw_items.js.
 */
import skills from './skills.js';
import { prefixes, suffixes } from './items_affixes.js';
export { prefixes, suffixes };

const STEEL = '#d0d0d8';
const WOOD = '#8a6a3a';
const BONE = '#e8e0c8';
const IRON = '#9a9aa4';
const LEATHER = '#8a5a3a';
const CLOTH = '#b8a888';
const GOLD = '#e0c040';
const RUNE = '#80d0ff';

const weapon = (id, name, type, size, level, price, dmg, dur, req, hands, speed, look, extra = {}) => ({
  id, name, slot: 'weapon', type, size, level, price, dmg, dur, req, hands, twoHanded: hands === 2, speed,
  dropWeight: type === 'bow' ? 2 : 1, look, ...extra,
});
const armor = (id, name, slot, type, size, level, price, ac, dur, req, look) => ({
  id, name, slot, type, size, level, price, ac, dur, req, dropWeight: 1, look,
});

export const bases = [
  // --- weapons (15) ---  (ref: short sword 1: 2-6/24/S18/120 ... great sword 17: 10-20/100/S75/3000)
  weapon('shortblade', 'Shortblade', 'sword', { w: 1, h: 3 }, 1, 120, [2, 6], 24, { str: 18 }, 1, 'fast', { glyph: 'blade', color: STEEL, color2: WOOD }, { classWeight: { warden: 1.5 } }),
  weapon('longblade', 'Longblade', 'sword', { w: 1, h: 3 }, 6, 350, [2, 10], 40, { str: 30, dex: 30 }, 1, 'normal', { glyph: 'blade', color: STEEL, color2: '#5a4a2a' }),
  weapon('greatblade', 'Greatblade', 'sword', { w: 2, h: 3 }, 14, 1800, [8, 16], 75, { str: 65 }, 2, 'slow', { glyph: 'blade', color: '#e0e0e8', color2: '#3a3a4a' }),
  weapon('hatchet', 'Hatchet', 'axe', { w: 1, h: 3 }, 2, 150, [2, 8], 24, {}, 1, 'normal', { glyph: 'axe', color: IRON, color2: WOOD }),
  weapon('war_axe', 'War Axe', 'axe', { w: 2, h: 3 }, 8, 1000, [8, 20], 50, { str: 50 }, 2, 'slow', { glyph: 'axe', color: STEEL, color2: '#4a3a2a' }),
  weapon('cudgel', 'Cudgel', 'mace', { w: 1, h: 3 }, 1, 20, [1, 6], 20, {}, 1, 'normal', { glyph: 'mace', color: WOOD, color2: '#5a4020' }),
  weapon('iron_mace', 'Iron Mace', 'mace', { w: 1, h: 2 }, 3, 300, [1, 10], 40, { str: 26 }, 1, 'normal', { glyph: 'mace', color: IRON, color2: WOOD }, { classWeight: { warden: 1.5 } }),
  weapon('maul', 'Maul', 'mace', { w: 2, h: 3 }, 10, 900, [6, 20], 50, { str: 55 }, 2, 'slow', { glyph: 'mace', color: '#7a7a84', color2: '#4a3a2a' }),
  weapon('short_bow', 'Short Bow', 'bow', { w: 2, h: 3 }, 1, 100, [1, 4], 30, {}, 2, 'fast', { glyph: 'bow', color: WOOD, color2: BONE }, { classWeight: { stalker: 2 } }),
  weapon('long_bow', 'Long Bow', 'bow', { w: 2, h: 3 }, 5, 250, [1, 6], 35, { str: 25, dex: 30 }, 2, 'normal', { glyph: 'bow', color: '#6a4a2a', color2: BONE }, { classWeight: { stalker: 2 } }),
  weapon('war_bow', 'War Bow', 'bow', { w: 2, h: 3 }, 12, 1000, [3, 9], 50, { str: 30, dex: 60 }, 2, 'normal', { glyph: 'bow', color: '#4a3a3a', color2: '#d8c8a0' }, { classWeight: { stalker: 2 } }),
  weapon('ash_staff', 'Ash Staff', 'staff', { w: 1, h: 3 }, 1, 30, [2, 4], 25, {}, 2, 'normal', { glyph: 'staff', color: CLOTH, color2: '#6a5a4a' }, { classWeight: { hexwright: 2 } }),
  weapon('bone_staff', 'Bone Staff', 'staff', { w: 1, h: 3 }, 6, 500, [5, 10], 45, {}, 2, 'normal', { glyph: 'staff', color: BONE, color2: '#8a8070' }, { classWeight: { hexwright: 2 } }),
  weapon('rune_staff', 'Rune Staff', 'staff', { w: 1, h: 3 }, 12, 1500, [8, 16], 75, { str: 30 }, 2, 'slow', { glyph: 'staff', color: '#5a5a7a', color2: RUNE }, { classWeight: { hexwright: 2 } }),
  weapon('wand', 'Wand', 'wand', { w: 1, h: 2 }, 3, 80, [1, 4], 20, { mag: 15 }, 1, 'fast', { glyph: 'wand', color: '#6a4a8a', color2: RUNE }, { classWeight: { hexwright: 2 } }),
  // --- armour (11) --- (ref: rags 1: 2-6/6/5 ... plate mail 19: 42-50/75/S60/4600; cap 1: 1-3/15/15; buckler 1: 1-5/16/30)
  armor('cloth_shirt', 'Cloth Shirt', 'body', 'armor', { w: 2, h: 3 }, 1, 15, [2, 5], 12, {}, { glyph: 'chest', color: CLOTH, color2: '#8a7a60' }),
  armor('leather_jerkin', 'Leather Jerkin', 'body', 'armor', { w: 2, h: 3 }, 6, 300, [10, 13], 35, {}, { glyph: 'chest', color: LEATHER, color2: '#5a3a20' }),
  armor('studded_coat', 'Studded Coat', 'body', 'armor', { w: 2, h: 3 }, 9, 700, [15, 17], 45, { str: 20 }, { glyph: 'chest', color: '#6a4a30', color2: IRON }),
  armor('chain_hauberk', 'Chain Hauberk', 'body', 'armor', { w: 2, h: 3 }, 13, 1250, [18, 22], 55, { str: 30 }, { glyph: 'chest', color: IRON, color2: '#5a5a64' }),
  armor('plate_harness', 'Plate Harness', 'body', 'armor', { w: 2, h: 3 }, 19, 4600, [42, 50], 75, { str: 60 }, { glyph: 'chest', color: STEEL, color2: '#4a4a5a' }),
  armor('cap', 'Cap', 'head', 'helm', { w: 2, h: 2 }, 1, 15, [1, 3], 15, {}, { glyph: 'helm', color: LEATHER, color2: '#5a3a20' }),
  armor('iron_helm', 'Iron Helm', 'head', 'helm', { w: 2, h: 2 }, 8, 40, [4, 6], 30, { str: 25 }, { glyph: 'helm', color: IRON, color2: '#4a4a54' }),
  armor('great_helm', 'Great Helm', 'head', 'helm', { w: 2, h: 2 }, 20, 400, [10, 15], 60, { str: 50 }, { glyph: 'helm', color: STEEL, color2: '#3a3a4a' }),
  armor('buckler', 'Buckler', 'offhand', 'shield', { w: 2, h: 2 }, 1, 30, [1, 5], 16, {}, { glyph: 'shield', color: WOOD, color2: IRON }),
  armor('kite_shield', 'Kite Shield', 'offhand', 'shield', { w: 2, h: 3 }, 14, 400, [8, 15], 40, { str: 50 }, { glyph: 'shield', color: IRON, color2: '#a04040' }),
  armor('tower_shield', 'Tower Shield', 'offhand', 'shield', { w: 2, h: 3 }, 20, 850, [12, 20], 50, { str: 60 }, { glyph: 'shield', color: STEEL, color2: '#2a3a5a' }),
  // --- jewellery (always magic; ref ring mlvl 5 value 1000, amulet mlvl 8 value 1200) ---
  { id: 'ring', name: 'Ring', slot: 'ring', type: 'ring', size: { w: 1, h: 1 }, level: 5, price: 1000, dropWeight: 1, look: { glyph: 'ring', color: GOLD, color2: '#c03030' } },
  { id: 'amulet', name: 'Amulet', slot: 'amulet', type: 'amulet', size: { w: 1, h: 1 }, level: 8, price: 1200, dropWeight: 1, look: { glyph: 'amulet', color: GOLD, color2: RUNE } },
  // --- quest items (never random) ---
  { id: 'q_sealed_ledger', name: 'Sealed Ledger', slot: 'quest', type: 'quest', size: { w: 1, h: 2 }, level: 1, price: 0, dropWeight: 0, look: { glyph: 'book', color: '#5a3a2a', color2: GOLD }, questId: 'q2_sealed_ledger' },
  { id: 'q_bell_clapper', name: 'Bell Clapper', slot: 'quest', type: 'quest', size: { w: 1, h: 1 }, level: 1, price: 0, dropWeight: 0, look: { glyph: 'generic', color: '#7a6a3a', color2: IRON }, questId: 'q4_bell_clappers', stackable: true },
];

/** Unique items: original names; effects use the CONTRACTS stat vocabulary. */
export const uniques = [
  { id: 'uq_vigilant_edge', name: 'Vigilant Edge', baseId: 'longblade', level: 6, price: 6500,
    effects: { toHit: 20, dmgPct: 50, lightRadius: 2, resArcane: 15 }, look: { glyph: 'blade', color: '#f0f0ff', color2: RUNE } },
  { id: 'uq_gorraks_jaw', name: "Gorrak's Jaw", baseId: 'war_axe', level: 8, price: 9000,
    effects: { dmgPct: 80, dmgFlat: 4, lifeSteal: 3, str: 8, lightRadius: -1 }, look: { glyph: 'axe', color: BONE, color2: '#7a2020' } },
  { id: 'uq_sallow_crown', name: 'Sallow Crown', baseId: 'iron_helm', level: 10, price: 12000,
    effects: { ac: 20, mana: 25, mag: 10, resAll: 10, vit: -5 }, look: { glyph: 'helm', color: '#c8c080', color2: '#5a6a3a' } },
  { id: 'uq_tallow_heart', name: 'Tallow Heart', baseId: 'amulet', level: 12, price: 20000,
    effects: { life: 50, resFire: 40, hitRecover: 2, thorns: 3, lightRadius: -2 }, look: { glyph: 'amulet', color: '#e8d8a0', color2: '#c04020' } },
  { id: 'uq_ash_vessel_staff', name: 'Staff of the Ash Vessel', baseId: 'rune_staff', level: 16, price: 45000,
    effects: { spellLevels: 2, mana: 40, elemDmgFire: 20, elemDmgFireMin: 6, resFire: 30, manaCostPct: 15, resCold: -20 }, look: { glyph: 'staff', color: '#4a2a2a', color2: '#ff7a30' } },
  { id: 'uq_whisper_bow', name: 'Whisper', baseId: 'long_bow', level: 10, price: 15000,
    effects: { toHit: 25, dmgPct: 60, dex: 10, attackSpeed: 2, knockback: 1, elemDmgCold: 8, elemDmgColdMin: 2 }, look: { glyph: 'bow', color: '#2a2a3a', color2: '#9ad8ff' } },
  { id: 'uq_warden_plate', name: "Warden's Plate", baseId: 'plate_harness', level: 20, price: 60000,
    effects: { acPct: 60, life: 60, resAll: 20, str: 10, hitRecover: 1, walkSpeed: -5 }, look: { glyph: 'chest', color: '#c8d0e0', color2: GOLD } },
  { id: 'uq_ring_of_the_watch', name: 'Ring of the Watch', baseId: 'ring', level: 14, price: 30000,
    effects: { allStats: 5, lightRadius: 3, resAll: 15, toHit: 10, durability: 50 }, look: { glyph: 'ring', color: GOLD, color2: '#f0f0ff' } },
];

/** Consumables. belt=true may sit on the quick belt. (ref: heal 1/50, full heal 1/150, mana 1/50, rejuv 3/120, full rejuv 7/600, elixirs 15–20/5000, identify 1/100, portal 4/200) */
const FLASK = (color) => ({ glyph: 'flask', color: '#e8e8f0', color2: color });
const potions = [
  { id: 'c_minor_heal', name: 'Minor Healing Draught', kind: 'potion', effect: { type: 'heal', value: 0.15 }, level: 1, price: 25, belt: true, look: FLASK('#c03030'), dropWeight: 6 },
  { id: 'c_heal', name: 'Healing Draught', kind: 'potion', effect: { type: 'heal', value: 0.3 }, level: 3, price: 50, belt: true, look: FLASK('#e02020'), dropWeight: 5 },
  { id: 'c_full_heal', name: 'Full Healing Draught', kind: 'potion', effect: { type: 'heal', value: 1 }, level: 7, price: 150, belt: true, look: FLASK('#ff4040'), dropWeight: 2 },
  { id: 'c_minor_mana', name: 'Minor Mana Draught', kind: 'potion', effect: { type: 'mana', value: 0.15 }, level: 1, price: 25, belt: true, look: FLASK('#3040c0'), dropWeight: 6 },
  { id: 'c_mana', name: 'Mana Draught', kind: 'potion', effect: { type: 'mana', value: 0.3 }, level: 3, price: 50, belt: true, look: FLASK('#2030e0'), dropWeight: 5 },
  { id: 'c_full_mana', name: 'Full Mana Draught', kind: 'potion', effect: { type: 'mana', value: 1 }, level: 7, price: 150, belt: true, look: FLASK('#4060ff'), dropWeight: 2 },
  { id: 'c_rejuv', name: 'Rejuvenation Draught', kind: 'potion', effect: { type: 'rejuv', value: 0.3 }, level: 5, price: 120, belt: true, look: FLASK('#c040c0'), dropWeight: 2 },
  { id: 'c_full_rejuv', name: 'Full Rejuvenation Draught', kind: 'potion', effect: { type: 'rejuv', value: 1 }, level: 10, price: 600, belt: true, look: FLASK('#ff60ff'), dropWeight: 1 },
  { id: 'c_elixir_str', name: 'Elixir of Sinew', kind: 'elixir', effect: { type: 'stat', stat: 'str', value: 1 }, level: 15, price: 5000, belt: false, look: FLASK('#e0a040'), dropWeight: 0.2 },
  { id: 'c_elixir_mag', name: 'Elixir of Insight', kind: 'elixir', effect: { type: 'stat', stat: 'mag', value: 1 }, level: 15, price: 5000, belt: false, look: FLASK('#40c0e0'), dropWeight: 0.2 },
  { id: 'c_elixir_dex', name: 'Elixir of Grace', kind: 'elixir', effect: { type: 'stat', stat: 'dex', value: 1 }, level: 15, price: 5000, belt: false, look: FLASK('#60e060'), dropWeight: 0.2 },
  { id: 'c_elixir_vit', name: 'Elixir of Marrow', kind: 'elixir', effect: { type: 'stat', stat: 'vit', value: 1 }, level: 20, price: 5000, belt: false, look: FLASK('#e06060'), dropWeight: 0.2 },
  { id: 'c_scroll_portal', name: 'Scroll of Homeward Gate', kind: 'scroll', effect: { type: 'townPortal' }, level: 4, price: 200, belt: true, look: { glyph: 'scroll', color: BONE, color2: '#80d0ff' }, dropWeight: 2 },
  { id: 'c_scroll_identify', name: 'Scroll of Revealing', kind: 'scroll', effect: { type: 'identify' }, level: 1, price: 100, belt: true, look: { glyph: 'scroll', color: BONE, color2: '#f0e0a0' }, dropWeight: 3 },
];

/** Scroll + tome rows for every skill (ref: scroll value ≈ staffCost×(2..4), tome = bookCost; tome mlvl = (learnLevel+1)*2). */
const SCROLL_PRICE_PER_MANA = 12;   // firebolt (6 mana) → 72 ≈ ref 50–100; nova (60) → 720 ≈ ref 1300/2
const TOME_PRICE_PER_LEVEL = 1000;  // ref books 1000..30000 by book level
const TOME_LEVEL_MULT = 2;
const skillItems = skills.flatMap((s) => [
  { id: `c_scroll_${s.id}`, name: `Scroll of ${s.name}`, kind: 'scroll', effect: { type: 'castSkill', skillId: s.id }, level: Math.max(1, s.learnLevel),
    price: Math.max(50, s.manaBase * SCROLL_PRICE_PER_MANA), belt: true, look: { glyph: 'scroll', color: BONE, color2: s.look.color }, dropWeight: s.archetype === 'melee' || s.archetype === 'multishot' ? 0.5 : 1 },
  { id: `c_tome_${s.id}`, name: `Tome of ${s.name}`, kind: 'tome', effect: { type: 'learnSkill', skillId: s.id }, level: Math.max(1, (s.learnLevel + 1) * TOME_LEVEL_MULT),
    price: TOME_PRICE_PER_LEVEL * Math.max(1, s.learnLevel), belt: false, look: { glyph: 'book', color: s.look.color, color2: '#3a2a1a' }, dropWeight: 0.5, minMag: s.minMag },
]);

export const consumables = [...potions, ...skillItems];

/** Rare items are named "<first> <second>". */
export const rareNames = {
  first: ['Grim', 'Dusk', 'Ember', 'Hollow', 'Vigil', 'Bone', 'Storm', 'Ash', 'Rook', 'Thorn', 'Night', 'Iron', 'Pale', 'Wraith', 'Cinder'],
  second: ['Bane', 'Call', 'Ward', 'Fang', 'Song', 'Grasp', 'Oath', 'Brand', 'Howl', 'Mark', 'Shroud', 'Needle', 'Crown', 'Whisper', 'Toll'],
};

export default { bases, prefixes, suffixes, uniques, consumables, rareNames };

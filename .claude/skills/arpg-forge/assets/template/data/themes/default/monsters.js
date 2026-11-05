/**
 * "Hollow Vigil" default roster: every id from docs/DEFAULT_THEME_IDS.md.
 * Families are declared once and expanded into `_2` / `_3` colour variants
 * (+level, +hp, +dmg, shifted colours). Stats follow the reference roster
 * shape per tier (see references/systems/04 §1): tier1 lvl 1–6 hp 2–40,
 * tier2 lvl 6–12 hp 30–120, tier3 lvl 12–20 hp 80–250, tier4 lvl 20–30 hp 150–500.
 */

const VARIANT_LEVEL_STEP = 2;
const VARIANT_HP_MULT = 1.35;
const VARIANT_DMG_MULT = 1.3;
const VARIANT_XP_MULT = 1.5;
const VARIANT_AC_ADD = 5;
const VARIANT_TOHIT_ADD = 5;
const MAX_INT = 3;

const NONE = { phys: 0, fire: 0, cold: 0, shock: 0, arcane: 0 };
const UNDEAD = { phys: 0, fire: 0, cold: 1, shock: 0, arcane: 2 };
const SPEED = {
  slow: { walkTicksPerTile: 12, attackTicks: 16, hitTicks: 8, deathTicks: 20, actionFrame: 5 },
  normal: { walkTicksPerTile: 8, attackTicks: 14, hitTicks: 6, deathTicks: 16, actionFrame: 4 },
  quick: { walkTicksPerTile: 6, attackTicks: 12, hitTicks: 5, deathTicks: 14, actionFrame: 4 },
  fast: { walkTicksPerTile: 4, attackTicks: 10, hitTicks: 4, deathTicks: 12, actionFrame: 3 },
  heavy: { walkTicksPerTile: 10, attackTicks: 18, hitTicks: 8, deathTicks: 24, actionFrame: 6 },
};

/** Expand one family into n colour variants. `palettes[k] = [bodyColor, trimColor]`. */
function family(base, palettes) {
  return palettes.map(([bodyColor, trimColor], k) => {
    const m = (v) => Math.round(v * VARIANT_HP_MULT ** k);
    const d = (v) => Math.max(1, Math.round(v * VARIANT_DMG_MULT ** k));
    return {
      ...base,
      id: k === 0 ? base.id : `${base.id}_${k + 1}`,
      name: k === 0 ? base.name : `${base.name} ${['', 'II', 'III'][k]}`,
      level: base.level + VARIANT_LEVEL_STEP * k,
      hp: [m(base.hp[0]), m(base.hp[1])],
      dmg: [d(base.dmg[0]), d(base.dmg[1])],
      ac: base.ac + VARIANT_AC_ADD * k,
      toHit: base.toHit + VARIANT_TOHIT_ADD * k,
      xp: Math.round(base.xp * VARIANT_XP_MULT ** k),
      intelligence: Math.min(MAX_INT, (base.intelligence || 0) + k),
      resist: { ...NONE, ...base.resist },
      missile: base.missile ? { ...base.missile, dmg: base.missile.dmg.map(d) } : null,
      look: { ...base.look, bodyColor, trimColor },
      speed: { ...base.speed },
      flags: [...(base.flags || [])],
      pack: base.pack || { size: [1, 3], leader: false },
      sfx: base.sfx || { attack: 'swing', hit: 'monsterHit', die: 'monsterDie' },
      special: base.special || null,
    };
  });
}

export const monsters = [
  // ---- tier 1: The Undercroft -----------------------------------------------------------------
  ...family({ id: 'shambler', name: 'Shambler', tier: 1, ai: 'rusher', level: 1, hp: [4, 8], dmg: [1, 4], ac: 5, toHit: 15, xp: 30,
    speed: SPEED.slow, resist: UNDEAD, flags: ['undead'], pack: { size: [2, 4], leader: false }, intelligence: 0,
    look: { silhouette: 'bulky', size: 1 } }, [['#6b7a5a', '#2f3a2a'], ['#7a6b5a', '#3a2f2a'], ['#5a6b7a', '#2a2f3a']]),
  ...family({ id: 'bonepicker', name: 'Bonepicker', tier: 1, ai: 'skirmisher', level: 2, hp: [3, 7], dmg: [1, 5], ac: 10, toHit: 20, xp: 40,
    speed: SPEED.quick, resist: UNDEAD, flags: ['undead'], pack: { size: [2, 5], leader: true }, intelligence: 0,
    look: { silhouette: 'lean', size: 1 } }, [['#d9d2b8', '#6a6050'], ['#c9b89a', '#5a4a30'], ['#b8c9d2', '#30505a']]),
  ...family({ id: 'cave_bat', name: 'Cave Bat', tier: 1, ai: 'flier', level: 3, hp: [3, 6], dmg: [1, 4], ac: 0, toHit: 30, xp: 35,
    speed: SPEED.fast, resist: NONE, flags: ['flies'], pack: { size: [3, 5], leader: false }, intelligence: 1,
    look: { silhouette: 'flier', size: 0.8 } }, [['#3a2f4a', '#8a7aa0'], ['#4a2f2f', '#a07a7a']]),
  ...family({ id: 'rust_sentinel', name: 'Rust Sentinel', tier: 1, ai: 'tank', level: 5, hp: [25, 40], dmg: [4, 8], ac: 30, toHit: 35, xp: 120,
    speed: SPEED.heavy, resist: { ...NONE, phys: 1, shock: 1, fire: 0 }, flags: ['noHitRecover', 'knockback'], pack: { size: [1, 1], leader: false }, intelligence: 1,
    look: { silhouette: 'tall', size: 1.2 } }, [['#8a5a3a', '#d0a060']]),

  // ---- tier 2: The Ossuary ----------------------------------------------------------------------
  ...family({ id: 'gravecaller', name: 'Gravecaller', tier: 2, ai: 'spawner', level: 7, hp: [30, 45], dmg: [3, 8], ac: 20, toHit: 40, xp: 220,
    speed: SPEED.normal, resist: UNDEAD, flags: ['undead', 'opensDoors'], pack: { size: [1, 2], leader: true }, intelligence: 1, special: 'shambler',
    look: { silhouette: 'robed', size: 1 } }, [['#3a3a4a', '#9a9ab0'], ['#4a3a3a', '#b09a9a'], ['#3a4a3a', '#9ab09a']]),
  ...family({ id: 'hollow_archer', name: 'Hollow Archer', tier: 2, ai: 'ranged', level: 6, hp: [20, 35], dmg: [2, 7], ac: 15, toHit: 40, xp: 180,
    speed: SPEED.normal, resist: UNDEAD, flags: ['undead', 'ranged'], pack: { size: [2, 4], leader: false }, intelligence: 1,
    missile: { archetype: 'arrow', element: 'phys', dmg: [3, 9] },
    look: { silhouette: 'lean', size: 1 } }, [['#8a8a7a', '#403a30'], ['#7a8a8a', '#30403a'], ['#8a7a8a', '#3a3040']]),
  ...family({ id: 'pit_hound', name: 'Pit Hound', tier: 2, ai: 'charger', level: 8, hp: [35, 55], dmg: [5, 11], ac: 25, toHit: 50, xp: 260,
    speed: SPEED.quick, resist: { ...NONE, fire: 1 }, flags: [], pack: { size: [2, 4], leader: false }, intelligence: 1,
    look: { silhouette: 'crawler', size: 1 } }, [['#5a2a2a', '#c04a3a'], ['#2a2a2a', '#7a4a3a'], ['#4a3a1a', '#c08a3a']]),
  ...family({ id: 'lantern_wisp', name: 'Lantern Wisp', tier: 2, ai: 'caster', level: 9, hp: [25, 40], dmg: [2, 6], ac: 10, toHit: 45, xp: 240,
    speed: SPEED.fast, resist: { ...NONE, fire: 2, arcane: 1 }, flags: ['flies'], pack: { size: [1, 2], leader: false }, intelligence: 2,
    missile: { archetype: 'bolt', element: 'fire', dmg: [5, 12] },
    look: { silhouette: 'blob', size: 0.7 } }, [['#f0c060', '#ff8030'], ['#60c0f0', '#3080ff']]),

  // ---- tier 3: The Root Caves ---------------------------------------------------------------------
  ...family({ id: 'root_crawler', name: 'Root Crawler', tier: 3, ai: 'ambusher', level: 13, hp: [80, 120], dmg: [10, 18], ac: 40, toHit: 70, xp: 700,
    speed: SPEED.quick, resist: { ...NONE, cold: 1 }, flags: ['hidden'], pack: { size: [1, 3], leader: false }, intelligence: 1,
    look: { silhouette: 'crawler', size: 1.1 } }, [['#3a4a2a', '#7a9a4a'], ['#4a3a2a', '#9a7a4a'], ['#2a3a4a', '#4a7a9a']]),
  ...family({ id: 'tallow_brute', name: 'Tallow Brute', tier: 3, ai: 'tank', level: 15, hp: [150, 220], dmg: [14, 24], ac: 55, toHit: 80, xp: 1100,
    speed: SPEED.heavy, resist: { ...NONE, phys: 1, fire: 1 }, flags: ['noHitRecover', 'knockback'], pack: { size: [1, 2], leader: true }, intelligence: 0,
    look: { silhouette: 'bulky', size: 1.4 } }, [['#e0d0a0', '#a08040'], ['#d0b090', '#806030'], ['#c0c0b0', '#606050']]),
  ...family({ id: 'spore_mage', name: 'Spore Mage', tier: 3, ai: 'caster', level: 14, hp: [80, 110], dmg: [6, 14], ac: 30, toHit: 75, xp: 900,
    speed: SPEED.normal, resist: { ...NONE, arcane: 1, cold: 1 }, flags: ['opensDoors'], pack: { size: [1, 3], leader: true }, intelligence: 2,
    missile: { archetype: 'explode', element: 'arcane', dmg: [12, 24] },
    look: { silhouette: 'robed', size: 1 } }, [['#6a4a8a', '#c090e0'], ['#4a6a8a', '#90c0e0'], ['#8a6a4a', '#e0c090']]),
  ...family({ id: 'thornling', name: 'Thornling', tier: 3, ai: 'rusher', level: 12, hp: [90, 130], dmg: [12, 20], ac: 45, toHit: 75, xp: 800,
    speed: SPEED.quick, resist: { ...NONE, cold: 1, shock: 1 }, flags: [], pack: { size: [3, 5], leader: false }, intelligence: 2,
    look: { silhouette: 'lean', size: 1 } }, [['#2a5a2a', '#90d050'], ['#5a5a2a', '#d0d050']]),

  // ---- tier 4: The Ember Vault --------------------------------------------------------------------
  ...family({ id: 'ash_knight', name: 'Ash Knight', tier: 4, ai: 'tank', level: 22, hp: [200, 280], dmg: [20, 34], ac: 80, toHit: 110, xp: 2600,
    speed: SPEED.normal, resist: { ...NONE, phys: 1, fire: 2, arcane: 1 }, flags: ['noHitRecover', 'knockback', 'opensDoors'], pack: { size: [2, 3], leader: true }, intelligence: 1,
    look: { silhouette: 'bulky', size: 1.3 } }, [['#4a4a4a', '#e06030'], ['#3a3a4a', '#e0a030'], ['#4a3a3a', '#e03030']]),
  ...family({ id: 'ember_hound', name: 'Ember Hound', tier: 4, ai: 'charger', level: 21, hp: [160, 220], dmg: [18, 32], ac: 60, toHit: 100, xp: 2200,
    speed: SPEED.fast, resist: { ...NONE, fire: 2, cold: 0 }, flags: [], pack: { size: [2, 4], leader: false }, intelligence: 2,
    look: { silhouette: 'crawler', size: 1.1 } }, [['#8a2a1a', '#ffa040'], ['#6a1a1a', '#ff6040'], ['#2a1a1a', '#ff4020']]),
  ...family({ id: 'cinder_seer', name: 'Cinder Seer', tier: 4, ai: 'caster', level: 24, hp: [150, 200], dmg: [10, 24], ac: 40, toHit: 110, xp: 3000,
    speed: SPEED.normal, resist: { ...NONE, fire: 2, arcane: 1, shock: 1 }, flags: ['opensDoors'], pack: { size: [1, 2], leader: false }, intelligence: 3,
    missile: { archetype: 'explode', element: 'fire', dmg: [24, 40] },
    look: { silhouette: 'robed', size: 1 } }, [['#5a2a2a', '#ff9040'], ['#2a2a5a', '#9040ff'], ['#5a5a2a', '#ffe040']]),
  ...family({ id: 'vault_warden', name: 'Vault Warden', tier: 4, ai: 'boss', level: 27, hp: [400, 500], dmg: [28, 46], ac: 90, toHit: 130, xp: 6000,
    speed: SPEED.heavy, resist: { ...NONE, phys: 1, fire: 2, arcane: 1 }, flags: ['ranged', 'opensDoors', 'noHitRecover'], pack: { size: [1, 1], leader: true }, intelligence: 3,
    missile: { archetype: 'bolt', element: 'fire', dmg: [20, 36] }, special: 'ash_knight',
    look: { silhouette: 'tall', size: 1.6 } }, [['#3a3a3a', '#ff8020'], ['#2a2a3a', '#40a0ff']]),
];

/** Named monsters. `level`/`hp`/`dmg` replace the base type's; difficulty scaling still applies. */
export const uniques = [
  { id: 'u_gorrak', name: 'Gorrak, the Thing Below', baseTypeId: 'rust_sentinel', level: 6, hp: 160, dmg: [6, 12], ai: 'boss',
    resist: { phys: 1, fire: 0, cold: 1, shock: 1, arcane: 0 }, flags: ['boss'], dropUniqueId: 'uq_gorraks_jaw',
    look: { silhouette: 'tall', bodyColor: '#5a3a2a', trimColor: '#ff6020', size: 1.6 }, packType: 'followers', questId: 'q1_the_thing_below', depth: 2 },
  { id: 'u_grim_tobin', name: 'Grim Tobin', baseTypeId: 'bonepicker_3', level: 7, hp: 90, dmg: [5, 10], ai: 'skirmisher',
    resist: { phys: 0, fire: 1, cold: 1, shock: 0, arcane: 2 }, flags: ['undead'], dropUniqueId: null,
    look: { silhouette: 'lean', bodyColor: '#202028', trimColor: '#c0c0ff', size: 1.1 }, packType: 'elite', questId: 'q3_grim_tobin', depth: 4 },
  { id: 'u_mother_sallow', name: 'Mother Sallow', baseTypeId: 'gravecaller_3', level: 13, hp: 420, dmg: [10, 20], ai: 'boss',
    resist: { phys: 0, fire: 1, cold: 2, shock: 0, arcane: 2 }, flags: ['undead', 'boss', 'opensDoors'], dropUniqueId: 'uq_sallow_crown',
    look: { silhouette: 'robed', bodyColor: '#2a2a3a', trimColor: '#e0e060', size: 1.4 }, packType: 'followers', questId: null, depth: 8 },
  { id: 'u_whisper', name: 'The Whisper', baseTypeId: 'root_crawler_3', level: 18, hp: 360, dmg: [16, 28], ai: 'ambusher',
    resist: { phys: 0, fire: 0, cold: 1, shock: 1, arcane: 1 }, flags: ['hidden'], dropUniqueId: 'uq_whisper_bow',
    look: { silhouette: 'crawler', bodyColor: '#1a2a1a', trimColor: '#a0ffa0', size: 1.3 }, packType: 'followers', questId: 'q5_the_whisper', depth: 10 },
  { id: 'u_the_tallow_king', name: 'The Tallow King', baseTypeId: 'tallow_brute_3', level: 21, hp: 900, dmg: [22, 38], ai: 'boss',
    resist: { phys: 1, fire: 1, cold: 0, shock: 1, arcane: 0 }, flags: ['boss', 'noHitRecover', 'knockback'], dropUniqueId: 'uq_tallow_heart',
    look: { silhouette: 'bulky', bodyColor: '#f0e0b0', trimColor: '#ff8000', size: 1.8 }, packType: 'elite', questId: null, depth: 12 },
  { id: 'u_vessel_of_ash', name: 'The Vessel of Ash', baseTypeId: 'vault_warden_2', level: 30, hp: 2400, dmg: [36, 60], ai: 'boss',
    resist: { phys: 1, fire: 2, cold: 0, shock: 1, arcane: 2 }, flags: ['boss', 'ranged', 'opensDoors', 'noHitRecover'], dropUniqueId: 'uq_ash_vessel_staff',
    look: { silhouette: 'tall', bodyColor: '#1a1a1a', trimColor: '#ff4000', size: 2 }, packType: 'elite', questId: 'q6_vessel_of_ash', depth: 16 },
];

export default { monsters, uniques };

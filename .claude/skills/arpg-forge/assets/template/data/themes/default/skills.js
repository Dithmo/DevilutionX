/**
 * Default theme ("Hollow Vigil") skills — the 16 ids fixed in DEFAULT_THEME_IDS.
 *
 * dmg = base + perCasterLevel*clvl + perSkillLevel*slvl (each a [lo,hi] pair).
 * Tuning anchors: a level-1 hexwright's level-1 firebolt rolls 2–8; a level-20
 * caster's level-10 firebolt rolls ~45–83. Mana: manaBase − manaPerLevel*(slvl−1),
 * never below manaMin (reference spelldat columns manaCost / manaMultiplier / minMana).
 * Skills whose damage comes from the weapon (volley, cleave) set `useWeaponDmg`.
 * missile.speed is in tiles per tick; omitted fields fall back to data/balance/missiles.js arch defaults.
 */
const ALL = ['warden', 'stalker', 'hexwright'];

export default [
  {
    id: 'firebolt', name: 'Firebolt', blurb: 'A darting mote of flame.',
    archetype: 'bolt', element: 'fire',
    manaBase: 6, manaPerLevel: 0.5, manaMin: 3, minMag: 15, classes: ['hexwright'], learnLevel: 1,
    dmg: { base: [0, 3], perCasterLevel: [2, 3], perSkillLevel: [0.5, 2] },
    missile: { speed: 0.35, range: 40 },
    look: { color: '#ff8a3a', glyph: 'bolt' }, sfx: 'cast',
  },
  {
    id: 'frost_shard', name: 'Frost Shard', blurb: 'A sliver of killing cold that slows what it strikes.',
    archetype: 'bolt', element: 'cold',
    manaBase: 7, manaPerLevel: 0.5, manaMin: 4, minMag: 18, classes: ['hexwright'], learnLevel: 2,
    dmg: { base: [1, 4], perCasterLevel: [1.5, 3], perSkillLevel: [1, 2] },
    missile: { speed: 0.28, range: 40, slow: 0.5 },
    look: { color: '#9ad8ff', glyph: 'shard' }, sfx: 'cast',
  },
  {
    id: 'arc_lance', name: 'Arc Lance', blurb: 'A line of lightning that passes through everything in its path.',
    archetype: 'pierce', element: 'shock',
    manaBase: 10, manaPerLevel: 1, manaMin: 6, minMag: 20, classes: ['hexwright'], learnLevel: 4,
    dmg: { base: [2, 2], perCasterLevel: [0, 1], perSkillLevel: [0.25, 0.75] },   // rand(2, 2+L) per segment
    missile: { speed: 0.4, range: 24, pierce: true },
    look: { color: '#d0e8ff', glyph: 'beam' }, sfx: 'cast',
  },
  {
    id: 'nova', name: 'Nova', blurb: 'A ring of sparks bursting outward from the caster.',
    archetype: 'nova', element: 'shock',
    manaBase: 60, manaPerLevel: 3, manaMin: 35, minMag: 60, classes: ['hexwright'], learnLevel: 14,
    dmg: { base: [2, 8], perCasterLevel: [0.5, 0.6], perSkillLevel: [0.5, 1] },   // (5d6 + L + 5)/2 scaled
    missile: { range: 16, count: 16 },
    look: { color: '#e8f0ff', glyph: 'ring' }, sfx: 'explode',
  },
  {
    id: 'chain_arc', name: 'Chain Arc', blurb: 'Lightning that leaps to every foe near the mark.',
    archetype: 'chain', element: 'shock',
    manaBase: 30, manaPerLevel: 1, manaMin: 18, minMag: 45, classes: ['hexwright'], learnLevel: 8,
    dmg: { base: [2, 2], perCasterLevel: [0, 1], perSkillLevel: [0.25, 0.75] },
    missile: { speed: 0.5, range: 120, radius: 3, jumps: 4 },
    look: { color: '#d0e8ff', glyph: 'beam' }, sfx: 'cast',
  },
  {
    id: 'flame_wall', name: 'Flame Wall', blurb: 'A burning line that bars the way.',
    archetype: 'wall', element: 'fire',
    manaBase: 28, manaPerLevel: 2, manaMin: 16, minMag: 27, classes: ['hexwright'], learnLevel: 3,
    dmg: { base: [2, 20], perCasterLevel: [1, 1], perSkillLevel: [0, 0.5] },      // 2d10 + 2 + L per touch
    missile: { segments: 3, lifetime: 160 },
    look: { color: '#ff6a2a', glyph: 'flame' }, sfx: 'cast',
  },
  {
    id: 'ember_pool', name: 'Ember Pool', blurb: 'The ground itself smoulders where it lands.',
    archetype: 'groundAoe', element: 'fire',
    manaBase: 16, manaPerLevel: 1, manaMin: 10, minMag: 35, classes: ['hexwright'], learnLevel: 9,
    dmg: { base: [4, 22], perCasterLevel: [1, 1.5], perSkillLevel: [1, 2] },
    missile: { speed: 0.3, range: 40, radius: 1.5, lifetime: 100 },
    look: { color: '#ff5a1a', glyph: 'orb' }, sfx: 'explode',
  },
  {
    id: 'mend', name: 'Mend', blurb: 'Knits torn flesh. Heals more as you grow.',
    archetype: 'heal', element: 'arcane',
    manaBase: 5, manaPerCasterLevel: 2, manaPerLevel: 3, manaMin: 1, minMag: 17, classes: ['hexwright', 'warden'], learnLevel: 1,
    dmg: { base: [0, 0], perCasterLevel: [0, 0], perSkillLevel: [0, 0] },
    missile: null,
    look: { color: '#8fe08f', glyph: 'cross' }, sfx: 'potion', allowedInTown: true,
  },
  {
    id: 'stone_skin', name: 'Stone Skin', blurb: 'Hardens the skin against blows for a time.',
    archetype: 'buff', element: 'arcane',
    manaBase: 20, manaPerLevel: 1, manaMin: 10, minMag: 25, classes: ['hexwright', 'warden'], learnLevel: 5,
    dmg: { base: [0, 0], perCasterLevel: [0, 0], perSkillLevel: [0, 0] },
    missile: null, buff: { stat: 'ac', value: 10, perLevel: 5, duration: 600 },
    look: { color: '#b8b0a0', glyph: 'shield' }, sfx: 'cast', allowedInTown: true,
  },
  {
    id: 'blink', name: 'Blink', blurb: 'Step through the dark to a nearby spot.',
    archetype: 'blink', element: 'arcane',
    manaBase: 12, manaPerLevel: 1, manaMin: 4, minMag: 30, classes: ['hexwright', 'stalker'], learnLevel: 7,
    dmg: { base: [0, 0], perCasterLevel: [0, 0], perSkillLevel: [0, 0] },
    missile: { speed: 0, range: 2, radius: 5 },
    look: { color: '#c8a8ff', glyph: 'swirl' }, sfx: 'portal',
  },
  {
    id: 'raise_ward', name: 'Raise Ward', blurb: 'Calls up a watchful sentinel that spits fire.',
    archetype: 'summon', element: 'fire',
    manaBase: 50, manaPerLevel: 2, manaMin: 30, minMag: 50, classes: ['hexwright'], learnLevel: 11,
    dmg: { base: [1, 10], perCasterLevel: [0.5, 0.5], perSkillLevel: [0.5, 1] },  // guardian bolt: d10 + L/2 + 1 scaled
    missile: { typeId: 'rust_sentinel', lifetime: 480 },   // ally monster type used as the ward body
    look: { color: '#ffb060', glyph: 'totem' }, sfx: 'cast',
  },
  {
    id: 'homing_spite', name: 'Homing Spite', blurb: 'A hateful spark that hunts its target down.',
    archetype: 'homing', element: 'arcane',
    manaBase: 35, manaPerLevel: 2, manaMin: 20, minMag: 55, classes: ['hexwright', 'stalker'], learnLevel: 12,
    dmg: { base: [2, 10], perCasterLevel: [1, 1], perSkillLevel: [0.5, 1.5] },    // half a fireball
    missile: { speed: 0.25, range: 300, radius: 1 },
    look: { color: '#d070ff', glyph: 'orb' }, sfx: 'cast',
  },
  {
    id: 'volley', name: 'Volley', blurb: 'Loose three arrows in a fan.',
    archetype: 'multishot', element: 'phys',
    manaBase: 8, manaPerLevel: 0.5, manaMin: 4, minMag: 0, classes: ['stalker'], learnLevel: 1,
    dmg: { base: [0, 0], perCasterLevel: [0, 0], perSkillLevel: [0, 0.5] }, useWeaponDmg: true,
    missile: { count: 3, spread: 15 },
    look: { color: '#d8c8a0', glyph: 'arrow' }, sfx: 'bowShot',
  },
  {
    id: 'cleave', name: 'Cleave', blurb: 'A wide swing that catches foes on either side.',
    archetype: 'melee', element: 'phys',
    manaBase: 6, manaPerLevel: 0.25, manaMin: 3, minMag: 0, classes: ['warden'], learnLevel: 1,
    dmg: { base: [0, 0], perCasterLevel: [0, 0], perSkillLevel: [0, 1] }, useWeaponDmg: true,
    missile: null,
    look: { color: '#e0d0c0', glyph: 'blade' }, sfx: 'swing',
  },
  {
    id: 'return_home', name: 'Return Home', blurb: 'Opens a gate back to the watch-town.',
    archetype: 'townPortal', element: 'arcane',
    manaBase: 35, manaPerLevel: 3, manaMin: 18, minMag: 20, classes: ALL, learnLevel: 6,
    dmg: { base: [0, 0], perCasterLevel: [0, 0], perSkillLevel: [0, 0] },
    missile: null,
    look: { color: '#80d0ff', glyph: 'portal' }, sfx: 'portal',
  },
  {
    id: 'reveal', name: 'Reveal', blurb: 'Lays bare the nature of an item.',
    archetype: 'identify', element: 'arcane',
    manaBase: 13, manaPerLevel: 2, manaMin: 1, minMag: 23, classes: ALL, learnLevel: 4,
    dmg: { base: [0, 0], perCasterLevel: [0, 0], perSkillLevel: [0, 0] },
    missile: null,
    look: { color: '#f0e0a0', glyph: 'eye' }, sfx: 'click', allowedInTown: true,
  },
];

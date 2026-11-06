/**
 * Hollow Vigil — the three player classes. Shapes per docs/THEME_SCHEMA.md
 * PlayerClass. Stat lines follow the genre reference (melee 30/10/20/25,
 * ranged 20/15/30/20, caster 15/35/15/20) and life/mana constants are
 * rearranged so that level-1 pools reproduce the reference table
 * (70/10, 45/23, 30/70) under our formula:
 *   life = startLife + lifePerLevel*(lvl-1) + lifePerVit*vit
 *   mana = startMana + manaPerLevel*(lvl-1) + manaPerMag*mag
 *
 * `frames` are TICKS PER FRAME for each anim (frame counts live in
 * src/entities/anim.js: attack/cast 8, hit 4, death 10, walk 8) and
 * `actionFrame` is the 0-based attack/cast frame on which the hit resolves.
 * Reference: attack 16 frames @1 tick with action frame ~9-11 -> 8 @2 with
 * action frame 5; caster casts in 12 @1 -> 8 @1-2 with action frame 4.
 */

const WARDEN = {
  id: 'warden',
  name: 'Warden',
  blurb: 'A wall-watch veteran. Heavy arms, heavier patience; hits hard and shrugs off blows.',
  base: { str: 30, mag: 10, dex: 20, vit: 25 },
  max: { str: 250, mag: 50, dex: 60, vit: 100 },
  startLife: 20, startMana: 10, lifePerLevel: 2, manaPerLevel: 1, lifePerVit: 2, manaPerMag: 1,
  toHitBase: 70,          // reference melee class base to-hit
  blockBase: 30,          // reference melee block bonus
  critOnLevel: true,      // reference: CriticalStrike flag, level% chance x2
  heavyStagger: false,
  frames: { attack: 2, cast: 3, hitRecover: 2, walk: 1, death: 2, actionFrame: 5 },
  weaponPref: 'melee',
  startKit: [
    { baseId: 'shortblade' },
    { baseId: 'buckler' },
    { baseId: 'cudgel' },
    { baseId: 'c_minor_heal', count: 2 },
  ],
  startSkill: 'cleave',
  skillPool: ['cleave', 'stone_skin', 'mend', 'return_home', 'reveal', 'raise_ward'],
  levelSkills: { 4: 'stone_skin', 8: 'mend' },
  look: { silhouette: 'bulky', bodyColor: '#b08a5a', trimColor: '#4a3a2a' },
};

const STALKER = {
  id: 'stalker',
  name: 'Stalker',
  blurb: 'A ridge-runner who hunts from the dark. Quick bow work and quicker feet.',
  base: { str: 20, mag: 15, dex: 30, vit: 20 },
  max: { str: 55, mag: 70, dex: 250, vit: 80 },
  startLife: 25, startMana: 8, lifePerLevel: 2, manaPerLevel: 2, lifePerVit: 1, manaPerMag: 1,
  toHitBase: 70,          // reference ranged class base ranged to-hit (melee base 50)
  blockBase: 20,          // reference ranged block bonus
  critOnLevel: false,
  heavyStagger: false,
  frames: { attack: 2, cast: 2, hitRecover: 2, walk: 1, death: 2, actionFrame: 4 },
  weaponPref: 'ranged',
  startKit: [
    { baseId: 'short_bow' },
    { baseId: 'c_minor_heal', count: 2 },
  ],
  startSkill: 'volley',
  skillPool: ['volley', 'frost_shard', 'blink', 'homing_spite', 'mend', 'return_home', 'reveal', 'stone_skin'],
  levelSkills: { 4: 'blink', 8: 'homing_spite' },
  look: { silhouette: 'lean', bodyColor: '#6f8a5a', trimColor: '#2a3324' },
};

const HEXWRIGHT = {
  id: 'hexwright',
  name: 'Hexwright',
  blurb: 'A lantern-scholar who bends the old sigils. Frail, but the ruins answer when called.',
  base: { str: 15, mag: 35, dex: 15, vit: 20 },
  max: { str: 45, mag: 250, dex: 85, vit: 80 },
  startLife: 10, startMana: 0, lifePerLevel: 1, manaPerLevel: 2, lifePerVit: 1, manaPerMag: 2,
  toHitBase: 50,          // reference caster melee base to-hit (magic base 70 is applied by skills)
  blockBase: 10,          // reference caster block bonus
  critOnLevel: false,
  heavyStagger: false,
  frames: { attack: 3, cast: 1, hitRecover: 2, walk: 1, death: 2, actionFrame: 4 },
  weaponPref: 'caster',
  startKit: [
    { baseId: 'ash_staff' },
    { baseId: 'c_minor_mana', count: 2 },
  ],
  startSkill: 'firebolt',
  skillPool: ['firebolt', 'frost_shard', 'arc_lance', 'nova', 'chain_arc', 'flame_wall', 'ember_pool',
    'mend', 'stone_skin', 'blink', 'raise_ward', 'homing_spite', 'return_home', 'reveal'],
  levelSkills: { 3: 'frost_shard', 6: 'arc_lance', 10: 'nova' },
  look: { silhouette: 'robed', bodyColor: '#5a5a8a', trimColor: '#c8b060' },
};

export default [WARDEN, STALKER, HEXWRIGHT];

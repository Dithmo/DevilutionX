/**
 * Interactive object types and random altar effects for the default theme.
 * look.color / look.color2 feed render/sprites drawObject; `kind` picks the
 * behaviour in entities/objects.js. `decor: true` objects only print text.
 */
export const objects = [
  { id: 'chest_small', name: 'Small Chest', kind: 'chest', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#8a6a3a', color2: '#d4b24a', shape: 'box' }, lootTable: { count: [0, 1], goodChance: 10 }, trapChance: 10 },
  { id: 'chest_large', name: 'Iron-bound Chest', kind: 'chest', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#6a5a4a', color2: '#c0c0d0', shape: 'box' }, lootTable: { count: [1, 3], goodChance: 25 }, trapChance: 15 },
  { id: 'door_wood', name: 'Wooden Door', kind: 'door', tilesets: ['undercroft', 'ossuary', 'root_caves'], solid: true, blocksLight: true, look: { color: '#6f4f2a', color2: '#d0b060', shape: 'slab' } },
  { id: 'door_iron', name: 'Iron Door', kind: 'door', tilesets: ['ossuary', 'ember_vault'], solid: true, blocksLight: true, look: { color: '#4a4a52', color2: '#c08040', shape: 'slab' } },
  { id: 'barrel', name: 'Barrel', kind: 'breakable', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#7a5a3a', color2: '#3a2a1a', shape: 'barrel' }, explosiveOk: true },
  { id: 'crate', name: 'Crate', kind: 'breakable', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#8a7a5a', color2: '#5a4a30', shape: 'crate' } },
  { id: 'altar_old', name: 'Weathered Altar', kind: 'altar', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#6a6a7a', color2: '#c8c8ff', shape: 'altar' }, light: 3 },
  { id: 'lever_rust', name: 'Rusted Lever', kind: 'lever', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#5a4a40', color2: '#b0a090', shape: 'lever' } },
  { id: 'sign_post', name: 'Sign', kind: 'sign', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#5a4020', color2: '#a08050', shape: 'post' }, text: 'The letters have long since weathered away.' },
  { id: 'trap_dart', name: 'Dart Trap', kind: 'trap', tilesets: 'all', solid: false, blocksLight: false, look: { color: '#444444', color2: '#888888', shape: 'plate' }, trapMissile: 'bolt', hidden: true },
  { id: 'fountain_murk', name: 'Murky Fountain', kind: 'fountain', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#4a5a6a', color2: '#6a9ab0', shape: 'basin' }, effect: { hp: 5, mp: 5 }, light: 2 },
  { id: 'bookstand', name: 'Book Stand', kind: 'bookstand', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#5a4030', color2: '#e0d8c0', shape: 'stand' }, text: 'The pages crumble, but one tome survives the damp.' },
  // extras used by the generators / town
  { id: 'stairs_down', name: 'Stairs Down', kind: 'stairs', tilesets: 'all', solid: false, blocksLight: false, look: { color: '#8c8478', color2: '#d8d0c0', shape: 'stairs' } },
  { id: 'stairs_up', name: 'Stairs Up', kind: 'stairs', tilesets: 'all', solid: false, blocksLight: false, look: { color: '#8c8478', color2: '#d8d0c0', shape: 'stairs' } },
  { id: 'portal_town', name: 'Town Portal', kind: 'portal', tilesets: 'all', solid: false, blocksLight: false, look: { color: '#80d0ff', color2: '#2040a0', shape: 'portal' }, light: 6 },
  { id: 'brazier', name: 'Brazier', kind: 'altar', decor: true, tilesets: 'all', solid: true, blocksLight: false, look: { color: '#4a3a30', color2: '#ffb040', shape: 'brazier' }, light: 5, text: 'Coals that should have died a century ago still glow.' },
  { id: 'rack_iron', name: 'Iron Rack', kind: 'breakable', decor: true, tilesets: 'all', solid: true, blocksLight: false, look: { color: '#3a3a40', color2: '#7a2a2a', shape: 'rack' }, text: 'Whoever was strapped here has been gone a long time. The straps have not.' },
  { id: 'lamp_post', name: 'Lamp Post', kind: 'sign', decor: true, tilesets: 'all', solid: true, blocksLight: false, look: { color: '#3a3a3a', color2: '#ffd080', shape: 'lamp' }, light: 6, text: 'The Watch lights these every dusk, and counts them every dawn.' },
  { id: 'well_stone', name: 'Old Well', kind: 'fountain', tilesets: 'all', solid: true, blocksLight: false, look: { color: '#6a6a60', color2: '#4a7a9a', shape: 'well' }, effect: { hp: 10, mp: 10 } },
];

/** Random-effect altars. `apply` is the engine vocabulary (docs/THEME_SCHEMA.md); text is shown when used. */
export const altarEffects = [
  { id: 'a_quiet_water', text: 'The basin fills with water that tastes of iron and morning. Your wounds close.', weight: 12, apply: 'healFull' },
  { id: 'a_cold_ember', text: 'A cold ember settles behind your eyes. Your mind is clear and full.', weight: 12, apply: 'manaFull' },
  { id: 'a_tithe', text: 'Something is taken from every part of you, and one part is paid back with interest.', weight: 8, apply: 'swapStats', params: { drain: 1, boost: 6 } },
  { id: 'a_old_oath', text: 'An old oath binds itself to your skin. One kind of ruin will find you harder to reach.', weight: 9, apply: 'randomResist', params: { amount: 10 } },
  { id: 'a_coin_rain', text: 'Coins fall from nowhere and ring on the stones. Nobody comes to claim them.', weight: 7, apply: 'dropGold', params: { piles: [3, 5] } },
  { id: 'a_true_names', text: 'Every thing you carry whispers its true name at once.', weight: 8, apply: 'identifyAll' },
  { id: 'a_rust_kiss', text: 'Rust blooms across something you own like frost on a window.', weight: 5, apply: 'curseItem', params: { durability: 20 }, crippling: true },
  { id: 'a_smiths_blessing', text: 'The leather softens and the iron brightens. Someone still remembers how things were made.', weight: 8, apply: 'blessItem', params: { durability: 10 } },
  { id: 'a_teachers_hand', text: 'A hand you cannot see guides yours through a motion you half knew.', weight: 6, apply: 'levelUpSkill', params: { max: 15 } },
  { id: 'a_wardens_eye', text: 'For one breath you see the whole level from above, as the Watch once did.', weight: 7, apply: 'revealMap' },
  { id: 'a_bell_below', text: 'A bell tolls somewhere beneath the floor. Things answer it.', weight: 7, apply: 'spawnMonsters', params: { count: [3, 5] } },
  { id: 'a_crooked_step', text: 'You take one step and arrive somewhere else entirely.', weight: 6, apply: 'teleport' },
  { id: 'a_red_thread', text: 'A red thread winds around your weapon hand and pulls tight.', weight: 7, apply: 'buffDamage', params: { pct: 25, ticks: 1200 } },
  { id: 'a_hollow_cup', text: 'The cup is empty. Now so are you.', weight: 4, apply: 'drainMana', params: { pct: 10 }, crippling: true },
];

/** Flavour strings used by randomly scattered signs / book stands. */
export const objectTexts = {
  signs: [
    'Thirty-one went down in the spring. Nine came back. Two of them still talk.',
    'If the lamps are lit, the Watch is above you. If they are not, do not wait for it.',
    'Here the masons stopped. Nobody wrote down why.',
    'Leave the doors as you find them. The things below count the open ones.',
    'The stair you came down by is the stair you leave by. There is no other.',
  ],
  bookstands: [
    'A ledger of grain deliveries that stops, mid-line, in a winter long past.',
    'A hymnal. Every page has had the same word scratched out.',
    'Someone drew the lower halls from memory. The memory was wrong in interesting ways.',
  ],
};

export default { objects, altarEffects, objectTexts };

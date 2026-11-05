/**
 * World structure for the default theme: four tiers of four depths over a
 * fixed hub town (depth 0). Ids follow docs/DEFAULT_THEME_IDS.md.
 */
const variants = (base, n) => [base, ...Array.from({ length: n - 1 }, (_, i) => `${base}_${i + 2}`)];

export const tiers = [
  {
    id: 't1', name: 'The Undercroft', tilesetId: 'undercroft', depths: [1, 4], monsterLevel: [1, 6], bossId: 'u_gorrak',
    monsterPool: [...variants('shambler', 3), ...variants('bonepicker', 3), ...variants('cave_bat', 2), 'rust_sentinel'],
    objectPool: ['chest_small', 'chest_large', 'door_wood', 'barrel', 'crate', 'altar_old', 'sign_post', 'bookstand', 'brazier', 'rack_iron'],
    themedRooms: ['treasure', 'library', 'shrine', 'barrel', 'monsterDen'],
  },
  {
    id: 't2', name: 'The Ossuary', tilesetId: 'ossuary', depths: [5, 8], monsterLevel: [6, 12], bossId: 'u_mother_sallow',
    monsterPool: [...variants('gravecaller', 3), ...variants('hollow_archer', 3), ...variants('pit_hound', 3), ...variants('lantern_wisp', 2)],
    objectPool: ['chest_small', 'chest_large', 'door_wood', 'door_iron', 'barrel', 'crate', 'altar_old', 'lever_rust', 'sign_post', 'bookstand', 'brazier', 'rack_iron', 'fountain_murk'],
    themedRooms: ['treasure', 'library', 'shrine', 'armory', 'barrel', 'torture', 'monsterDen'],
  },
  {
    id: 't3', name: 'The Root Caves', tilesetId: 'root_caves', depths: [9, 12], monsterLevel: [12, 20], bossId: 'u_the_tallow_king',
    monsterPool: [...variants('root_crawler', 3), ...variants('tallow_brute', 3), ...variants('spore_mage', 3), ...variants('thornling', 2)],
    objectPool: ['chest_small', 'chest_large', 'door_wood', 'barrel', 'crate', 'altar_old', 'lever_rust', 'sign_post', 'brazier', 'fountain_murk'],
    themedRooms: ['treasure', 'shrine', 'armory', 'barrel', 'monsterDen'],
  },
  {
    id: 't4', name: 'The Ember Vault', tilesetId: 'ember_vault', depths: [13, 16], monsterLevel: [20, 30], bossId: 'u_vessel_of_ash',
    monsterPool: [...variants('ash_knight', 3), ...variants('ember_hound', 3), ...variants('cinder_seer', 3), ...variants('vault_warden', 2)],
    objectPool: ['chest_large', 'chest_small', 'door_iron', 'crate', 'altar_old', 'lever_rust', 'sign_post', 'brazier', 'rack_iron', 'bookstand'],
    themedRooms: ['treasure', 'armory', 'torture', 'monsterDen', 'shrine'],
  },
];

export const maxDepth = tiers[tiers.length - 1].depths[1];

/** The hub. Buildings are solid blocks with a sign at the door side; NPCs stand outside their building. */
export const town = {
  name: 'Hollow Vigil',
  size: [48, 48],
  layout: 'plaza',
  spawn: { x: 24, y: 30 },
  dungeonEntrance: { x: 24, y: 8 },
  portalAnchor: { x: 20, y: 30 },
  groundColors: ['#5e5a3c', '#6a6442', '#55534a'],
  buildingColors: ['#6b5a48', '#5a4a3a', '#7a6a58'],
  accent: '#b89a5a',
  buildings: [
    { name: 'Chapel of the Quiet Hand', x: 6, y: 6, w: 8, h: 6, door: 'S' },
    { name: "Brann's Forge", x: 34, y: 6, w: 8, h: 6, door: 'S' },
    { name: 'The Storehouse', x: 33, y: 16, w: 7, h: 5, door: 'W' },
    { name: 'Watch House', x: 6, y: 30, w: 7, h: 6, door: 'E' },
    { name: "Mirelle's Tower", x: 36, y: 30, w: 6, h: 7, door: 'W' },
    { name: 'The Lantern Hall', x: 18, y: 38, w: 12, h: 6, door: 'N' },
  ],
  npcPlacements: [
    { npcId: 'n_sister_oda', x: 10, y: 14 },
    { npcId: 'n_brann', x: 38, y: 14 },
    { npcId: 'n_pip', x: 31, y: 18 },
    { npcId: 'n_captain_rook', x: 15, y: 33 },
    { npcId: 'n_mirelle', x: 34, y: 33 },
    { npcId: 'n_old_fen', x: 24, y: 36 },
  ],
  decor: [
    { kind: 'well', x: 24, y: 24 },
    { kind: 'lamp', x: 18, y: 19 }, { kind: 'lamp', x: 29, y: 19 }, { kind: 'lamp', x: 18, y: 28 }, { kind: 'lamp', x: 29, y: 28 },
    { kind: 'lamp', x: 22, y: 10 }, { kind: 'lamp', x: 26, y: 10 },
    { kind: 'crate', x: 33, y: 22 }, { kind: 'crate', x: 34, y: 22 }, { kind: 'barrel', x: 17, y: 40 }, { kind: 'barrel', x: 17, y: 41 },
    { kind: 'sign', x: 24, y: 12, text: 'The sealed stair. The Watch keeps no one from going down; it only counts who comes back.' },
  ],
};

export default { tiers, town, maxDepth };

/**
 * Tilesets for the default theme ("Hollow Vigil").
 *
 * `generator` picks the layout algorithm (world/levelgen): 'rooms' = BSP rooms
 * + corridors + doors, 'halls' = recursive flush rooms with carved walls
 * (`genOpts.mirror` for the 4-way symmetric variant, `chamberStyle:'ossuary'`
 * for long halls with alcoves), 'caves' = organic blobs with pools and fences.
 * floors[0..2] = base / variant / corridor; `water` is appended as the last
 * floor index by the generator. walls[0] = wall, walls[1] = pillar / fence.
 */
export const tilesets = [
  {
    id: 'undercroft', name: 'The Undercroft', generator: 'rooms', genOpts: {},
    floors: ['#5a5247', '#4e483d', '#453f36'], walls: ['#6b6358', '#7d7466'],
    accent: '#b89a5a', lightTint: '#ffd9a0', voidColor: '#0b0a08', doorColor: '#6f4f2a',
    decor: ['pillar', 'rubble', 'crate', 'bones'], ambient: null,
  },
  {
    id: 'ossuary', name: 'The Ossuary', generator: 'halls', genOpts: { mirror: false, chamberStyle: 'ossuary' },
    floors: ['#3c4352', '#454d5e', '#323845'], walls: ['#7c8398', '#959cb0'],
    accent: '#c9c2b0', lightTint: '#e8e0ff', voidColor: '#070709', doorColor: '#4a3b30',
    decor: ['bones', 'grate', 'rubble'], ambient: null,
  },
  {
    id: 'root_caves', name: 'The Root Caves', generator: 'caves', genOpts: {},
    floors: ['#3f4a33', '#48533a', '#36402c'], water: '#23485a', walls: ['#4d5a3b', '#746d4a'],
    accent: '#9ab86a', lightTint: '#d0ffb0', voidColor: '#050804', doorColor: '#5a4a2a',
    decor: ['puddle', 'vent', 'bones'], ambient: null,
  },
  {
    id: 'ember_vault', name: 'The Ember Vault', generator: 'halls', genOpts: { mirror: true },
    floors: ['#4a2a24', '#5a3028', '#3a201c'], walls: ['#6a3a30', '#8a5040'],
    accent: '#ff9a40', lightTint: '#ffb070', voidColor: '#0a0404', doorColor: '#5a2a1a',
    decor: ['grate', 'pillar', 'vent'], ambient: null,
  },
];

export default tilesets;

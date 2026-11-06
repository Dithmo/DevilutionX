/**
 * Default UI vocabulary. A theme's strings.js may override any key; use
 * `mergeStrings(theme.strings)` to build `game.strings`.
 */
export const DEFAULT_STRINGS = {
  // vitals & character sheet
  life: 'Life', mana: 'Mana', gold: 'Gold', experience: 'Experience', level: 'Level',
  nextLevel: 'Next level', strength: 'Strength', magic: 'Magic', dexterity: 'Dexterity',
  vitality: 'Vitality', toHit: 'To hit', armor: 'Armor', damage: 'Damage', block: 'Block',
  statPoints: 'Points to spend', resist: 'Resist', resFire: 'Fire resist', resCold: 'Cold resist',
  resShock: 'Shock resist', resArcane: 'Arcane resist', durability: 'Durability', charges: 'Charges',
  requires: 'Requires', unidentified: 'Unidentified', quality_normal: '', quality_magic: 'Magic',
  quality_rare: 'Rare', quality_unique: 'Unique',
  // panels
  inventory: 'Pack', character: 'Character', skills: 'Skills', quests: 'Journal', automap: 'Map',
  belt: 'Belt', potion: 'Potion', menu: 'Menu', options: 'Options', town: 'Town', depth: 'Depth',
  // vendor & services
  buy: 'Buy', sell: 'Sell', repair: 'Repair', identify: 'Identify', recharge: 'Recharge',
  heal: 'Heal', trade: 'Trade', gossip: 'Talk', leave: 'Leave', back: 'Back', confirm: 'Confirm',
  price: 'Price', notEnoughGold: 'Not enough gold.', noRoom: 'No room in your pack.',
  cannotSell: 'They will not take that.', nothingToRepair: 'Nothing needs mending.',
  identified: 'Identified.', repaired: 'Mended.', recharged: 'Recharged.', healed: 'You feel whole again.',
  sold: 'Sold.', bought: 'Bought.',
  // flow
  newGame: 'New game', continue: 'Continue', loadGame: 'Load', saveGame: 'Save', deleteSave: 'Delete',
  loading: 'Loading', youDied: 'You died', victory: 'Victory', paused: 'Paused', quit: 'Quit',
  chooseClass: 'Choose your calling', enterName: 'Name', seed: 'Seed', difficulty: 'Difficulty',
  difficulty_normal: 'Normal', difficulty_veteran: 'Veteran', difficulty_elite: 'Elite',
  hardcore: 'Permadeath', on: 'On', off: 'Off', permadeathNote: 'Permadeath: this hero is gone for good.',
  respawn: 'Return to town', quitToMenu: 'Quit to menu', load: 'Load game', start: 'Start',
  // quests
  questOffered: 'New task', questActive: 'In progress', questDone: 'Finished',
  questAccepted: 'Task taken', questComplete: 'Task finished', rewardGold: 'gold received',
  rewardXp: 'experience gained', noQuests: 'Nothing in the journal yet.',
  // world
  stairsDown: 'Down', stairsUp: 'Up', portal: 'Portal', portalOpened: 'A way home opens.',
  portalInTown: 'The portal only goes one way from here.', enterTown: 'Hollow ground.',
  levelUp: 'You feel stronger.', pickUp: 'Pick up', open: 'Open', use: 'Use', talk: 'Talk',
  monsterLevel: 'Monster level', kills: 'Kills', deaths: 'Deaths', playTime: 'Time',
  notEnoughMana: 'Not enough mana.', unknownSkill: 'You do not know that skill.', goldItem: 'Gold',
  hardcoreBadge: 'PERMADEATH', levelShort: 'Lv',
  permadeathHint: 'Permadeath: if this hero dies, the save is erased.',
};

/**
 * Merge theme overrides onto the defaults.
 * @param {Object<string,string>} [overrides]
 * @returns {Object<string,string>}
 */
export function mergeStrings(overrides) {
  return { ...DEFAULT_STRINGS, ...(overrides || {}) };
}

/**
 * The strings of the running game, for code that has no `game` handle (affix lines, item
 * tooltips, skill tooltips). main.js sets them in loadContent; defaults until then.
 */
let ACTIVE = DEFAULT_STRINGS;
export function setActiveStrings(strings) { ACTIVE = strings || DEFAULT_STRINGS; }
/** Lower-case resource word ('life', 'mana', 'gold' or the theme's renames). */
export function word(key) {
  return String(ACTIVE[key] || DEFAULT_STRINGS[key] || key).toLowerCase();
}
/** A string of the running game, with a fallback. */
export function activeStr(key, fallback) {
  const s = ACTIVE[key];
  return typeof s === 'string' ? s : fallback;
}

export default DEFAULT_STRINGS;

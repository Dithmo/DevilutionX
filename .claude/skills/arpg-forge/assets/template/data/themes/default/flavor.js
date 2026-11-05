/**
 * Flavour text for Hollow Vigil: death lines, loading tips, intro/outro
 * narration and the level naming rule. Tone: grim but dry.
 */
export default {
  deathLines: [
    'The watch will not come looking. They never do.',
    'Your lamp gutters out. The dark does not notice.',
    'Somewhere above, a bell rings once for you. Probably.',
    'The ledger of the Vigil gains one more line.',
    'The stone keeps what the stone takes.',
    'You were warned. You were also paid in advance.',
    'Another name for Old Fen to misremember.',
    'Rest now. The ruins are patient.',
  ],
  loadingTips: [
    'Sister Oda mends anyone who asks. Asking is the hard part.',
    'Brann will not buy back what he never sold. Try Pip.',
    'A portal scroll is cheaper than a funeral.',
    'The deeper the level, the better the stock in town.',
    'Unidentified gear may be cursed. Mirelle charges a hundred to find out.',
    'Doors stop arrows. They do not stop whatever is on the other side.',
    'Altars give and altars take. Nobody has found the pattern.',
    'Keep a rejuvenation draught on the belt for the moment you forget to drink.',
    'Elite packs follow a leader. Kill it and the pack loses its nerve.',
    'Finished tasks pay in gold and experience. Half-finished ones pay in regret.',
    'The town bell has no clapper. Three went missing below.',
    'Repairs cost less than replacements. Usually.',
  ],
  intro: [
    'Hollow Vigil was built to watch a door that was meant to stay shut.',
    'Last winter the door opened a crack, and the watch sent six people down.',
    'None came back, so the captain is now hiring anyone with legs and a blade.',
    'You have both, and you owe money. Welcome to the Vigil.',
  ],
  outro: [
    'The vessel cracks, and whatever it held goes quiet at last.',
    'Above, the watch-town bell rings for the first time in a year.',
    'They will build a new door. Someone will open it. That is not your problem tonight.',
  ],
  welcome: 'Hollow Vigil. Mind the stairs.',
  /**
   * Name shown on the loading screen for a depth.
   * @param {number} depth 0 = town
   * @param {string} [tierName]
   * @returns {string}
   */
  levelName(depth, tierName) {
    if (depth === 0) return 'Hollow Vigil';
    const base = tierName || 'The Below';
    return `${base}, descent ${depth}`;
  },
};

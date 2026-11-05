/** Stub of quests/quests.js for the UI harness. */
export function questLogEntries(game) {
  return [
    { id: 'q1_the_thing_below', name: 'The Thing Below', state: 'active', text: 'Captain Rook believes something large has made its lair two levels beneath the watch-town. Find it and put it down before it finds its way up.' },
    { id: 'q2_sealed_ledger', name: 'The Sealed Ledger', state: 'active', text: 'Mirelle wants the sealed ledger recovered from the third undercroft.' },
    { id: 'q3_grim_tobin', name: 'Grim Tobin', state: 'done', text: 'Tobin and his crew will trouble no one again.' },
  ];
}
export function initQuests() {}

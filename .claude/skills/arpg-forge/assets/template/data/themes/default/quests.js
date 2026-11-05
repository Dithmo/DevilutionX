/**
 * The six quests of Hollow Vigil. Fields beyond the schema: `main` (offered by
 * the giver without depth gating), `prereq` (quest that must be done first),
 * `final` (completing it wins the game), `depthRange` for multi-level collects.
 */
export default [
  {
    id: 'q1_the_thing_below', name: 'The Thing Below', tier: 1, depth: 2, type: 'killBoss',
    giverId: 'n_captain_rook', target: { uniqueMonsterId: 'u_gorrak' },
    reward: { xp: 400, gold: 250, uniqueItemId: 'uq_gorraks_jaw' },
    text: {
      journal: 'Something large has taken up residence two descents down and eats whoever the watch sends.',
      started: 'Captain Rook wants the thing on the second descent dead. Bring back proof, or at least come back.',
      progress: 'The thing below is dead. Rook will want to hear it from you.',
      done: 'Gorrak is dead. The captain paid, which for Rook is practically a speech.',
    },
    mapStamp: 'bossRoom', spOnly: false, main: true,
  },
  {
    id: 'q2_sealed_ledger', name: 'The Sealed Ledger', tier: 1, depth: 3, type: 'fetch',
    giverId: 'n_mirelle', target: { itemBaseId: 'q_sealed_ledger', count: 1 },
    reward: { xp: 500, gold: 150, itemBaseId: 'ring' },
    text: {
      journal: 'Mirelle wants a sealed ledger the first expedition carried. It should be in a vault on the third descent.',
      started: 'Find the sealed ledger on the third descent and bring it to Mirelle unopened. She was specific about unopened.',
      progress: 'You have the ledger. It is heavier than paper should be. Mirelle is waiting.',
      done: 'Mirelle took the ledger, read one page, and went quiet for a long time.',
    },
    mapStamp: 'vault', spOnly: false,
  },
  {
    id: 'q3_grim_tobin', name: 'Grim Tobin', tier: 1, depth: 4, type: 'clearArea',
    giverId: 'n_brann', target: { uniqueMonsterId: 'u_grim_tobin' },
    reward: { xp: 700, gold: 300, uniqueItemId: 'uq_vigilant_edge' },
    text: {
      journal: 'Brann\'s old apprentice Tobin went down with the first expedition and did not come back the same.',
      started: 'Tobin and whatever he keeps company with have dug a den on the fourth descent. Brann asks you to end it.',
      progress: 'The den is quiet. Tobin is at rest. Tell Brann, gently if you can manage it.',
      done: 'Brann did not say much. He gave you a blade he had been saving for someone else.',
    },
    mapStamp: 'den', spOnly: false,
  },
  {
    id: 'q4_bell_clappers', name: 'The Bell Clappers', tier: 2, depth: 5, type: 'collectN',
    giverId: 'n_sister_oda', target: { itemBaseId: 'q_bell_clapper', count: 3 }, depthRange: [5, 7],
    reward: { xp: 900, gold: 400, itemBaseId: 'amulet' },
    text: {
      journal: 'The watch bell has no clappers. Three were carried off into the ossuary by things that like bronze.',
      started: 'Recover the three bell clappers from the ossuary descents and bring them to Sister Oda.',
      progress: 'You have all three clappers. Sister Oda can hang them again.',
      done: 'The bell rang that evening. Half the town flinched. Oda called it progress.',
    },
    mapStamp: null, spOnly: false,
  },
  {
    id: 'q5_the_whisper', name: 'The Whisper', tier: 3, depth: 10, type: 'findNpc',
    giverId: 'n_old_fen', target: { uniqueMonsterId: 'u_whisper', npcId: null },
    reward: { xp: 1600, gold: 600, uniqueItemId: 'uq_whisper_bow' },
    text: {
      journal: 'Old Fen says something in the root caves speaks with the voices of the missing. He would like it to stop.',
      started: 'Find the source of the whispering on the tenth descent and silence it.',
      progress: 'The whispering has stopped. Fen will want to know what it said. Decide whether to tell him.',
      done: 'Fen listened, nodded, and poured you something that was not quite tea.',
    },
    mapStamp: 'den', spOnly: false,
  },
  {
    id: 'q6_vessel_of_ash', name: 'The Vessel of Ash', tier: 4, depth: 16, type: 'killBoss',
    giverId: 'n_captain_rook', target: { uniqueMonsterId: 'u_vessel_of_ash' },
    reward: { xp: 5000, gold: 2000, uniqueItemId: 'uq_ring_of_the_watch' },
    text: {
      journal: 'At the bottom of the ember vault waits the thing the Vigil was built to watch. Rook means to see it broken.',
      started: 'Descend to the sixteenth level and destroy the Vessel of Ash. There is no plan beyond that.',
      progress: 'The Vessel is broken. Climb back to the light and tell the captain it is over.',
      done: 'It is over. For now. Rook has already started drawing up a new rota.',
    },
    mapStamp: 'bossRoom', spOnly: false, main: true, prereq: 'q1_the_thing_below', final: true,
  },
];

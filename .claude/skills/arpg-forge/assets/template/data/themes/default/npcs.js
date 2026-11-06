/**
 * The six townsfolk of Hollow Vigil. `vendorTypes` (array) extends the schema's
 * single `vendorType` for NPCs who run two stalls; `vendorType` stays the primary.
 */
export default [
  {
    id: 'n_sister_oda', name: 'Sister Oda', title: 'Keeper of the Infirmary', role: 'healer',
    vendorType: null, services: ['heal'],
    look: { silhouette: 'robed', bodyColor: '#c8c0b0', trimColor: '#6a3a3a', weapon: 'none', helm: 'open' },
    greeting: [
      'Sit. Breathe. You are leaking on my floor, but sit.',
      'Back again. Either you are careful or you are lucky, and I do not stock luck.',
      'Whatever bit you, I have seen worse. Possibly on you.',
      'Hold still. This will hurt less than what you came in with.',
    ],
    gossip: [
      'The first expedition took three days of bandages down with them. I never got the baskets back.',
      'Rook sleeps in the watchtower now. He says it is for the view.',
      'Pip trades in things the dead do not need any more. I try not to ask which dead.',
    ],
    questLines: {
      q4_bell_clappers: {
        offer: 'The bell is silent because its clappers went below with the things that steal bronze. There are three. Bring them back and I will hang them myself.',
        active: 'Three clappers. Bronze, heavy, roughly the length of your forearm. The ossuary is full of hands that want them.',
        done: 'All three. You have done something for this town it will not thank you for. I will.',
      },
    },
  },
  {
    id: 'n_brann', name: 'Brann', title: 'Smith of the Watch', role: 'smith',
    vendorType: 'weapons', vendorTypes: ['weapons', 'armor'], services: ['repair'],
    look: { silhouette: 'bulky', bodyColor: '#6a5a4a', trimColor: '#c87a30', weapon: 'hammer', helm: 'bare', armor: 'light', cloak: 'none' },
    greeting: [
      'Steel is on the left, iron on the right, and complaints go out the door.',
      'If it is bent, I can fix it. If it is broken, I can sell you another.',
      'Mind the forge. It bites harder than anything on the first descent.',
      'You want it sharp or you want it cheap. Pick one.',
    ],
    gossip: [
      'Half the tools in this town came up from the ruins. Nobody asks who made them.',
      'Rook paid for the last batch of blades in promises. I accepted, which was my mistake.',
      'The caves below the ossuary have roots in them. Roots do not grow that deep. Think on that.',
    ],
    questLines: {
      q3_grim_tobin: {
        offer: 'My apprentice Tobin went down with the first lot. Something wearing his face has dug in on the fourth descent. I would rather it was finished by a stranger than by me.',
        active: 'Tobin kept a den near the stairs. He never did like walking far. Clear it out, all of it.',
        done: 'So that is done. Here. I was keeping this blade for him. Better it goes down with someone who comes back up.',
      },
    },
  },
  {
    id: 'n_mirelle', name: 'Mirelle', title: 'Arcanist of the Vigil', role: 'arcanist',
    vendorType: 'magic', vendorTypes: ['magic', 'potions'], services: ['identify', 'recharge'],
    look: { silhouette: 'robed', bodyColor: '#3a3a6a', trimColor: '#a0c0e0', weapon: 'staff', helm: 'hood' },
    greeting: [
      'Touch nothing that glows. Touch nothing that does not glow, either, until I have looked at it.',
      'Scrolls on the shelf, draughts in the crate, questions in the box by the door.',
      'You have the look of someone carrying something cursed. Set it there. Slowly.',
      'A hundred gold tells you what a thing is. Finding out for free costs more.',
    ],
    gossip: [
      'The ruins were sealed from the inside. I keep saying this. Nobody keeps hearing it.',
      'Lantern wisps are not alive. They are a kind of memory with opinions.',
      'Sister Oda thinks prayer and poultice are the same art. We have agreed not to discuss it.',
    ],
    questLines: {
      q2_sealed_ledger: {
        offer: 'The first expedition carried a sealed ledger: the watch\'s own record of what is down there. It will be in a vault on the third descent. Bring it to me. Do not open it.',
        active: 'The ledger is bound in grey leather and heavier than it looks. If it hums, that is normal. Probably.',
        done: 'You did not open it. Good. I have, and I would like to be alone with what it says. Take this.',
      },
    },
  },
  {
    id: 'n_captain_rook', name: 'Captain Rook', title: 'Commander of the Watch', role: 'questgiver',
    vendorType: null, services: [],
    look: { silhouette: 'bulky', bodyColor: '#2a3a4a', trimColor: '#c8963c', weapon: 'spear', helm: 'open', armor: 'plate', cloak: 'long', cloakColor: '#3a2a20' },
    greeting: [
      'You are standing on the last paid garrison north of anywhere. Act like it.',
      'Report. Short words. I have had a long year.',
      'Still alive. That puts you ahead of the last six.',
      'I do not hand out medals. I hand out gold and the next job.',
    ],
    gossip: [
      'The watch used to be forty strong. Now it is me, a bell with no clappers, and whoever walks in owing money.',
      'The door below was built to be watched, not opened. Someone forgot the second part.',
      'If Old Fen tells you he remembers the founding, he does not. He remembers a song about it.',
    ],
    questLines: {
      q1_the_thing_below: {
        offer: 'Two descents down there is something that eats patrols. It has a name now, which means it has lasted too long. Kill it. The watch pays on return.',
        active: 'It nests two descents down. Big, slow, and it does not stay down when it should. Make sure of it.',
        done: 'Dead. Good. Take your pay, and take the jaw. Nobody here wants to look at it.',
      },
      q6_vessel_of_ash: {
        offer: 'The ledger named it. The Vessel of Ash, at the bottom of the vault, the thing this town was built to sit on. I am sending you because you keep coming back. Break it.',
        active: 'Sixteen descents. Everything between here and there wants you dead. The Vessel just wants out.',
        done: 'Then it is done. The Vigil is a town again, not a lid. Here. The watch keeps its promises, eventually.',
      },
    },
  },
  {
    id: 'n_old_fen', name: 'Old Fen', title: 'Keeper of Stories', role: 'storyteller',
    vendorType: null, services: [],
    look: { silhouette: 'lean', bodyColor: '#5a5a50', trimColor: '#9a8a60', weapon: 'none', helm: 'hood' },
    greeting: [
      'Sit, if your knees still bend. Mine remember when they did.',
      'You want a story or a warning. They cost the same and come out the same.',
      'I have buried three captains and outlived one bell. Ask me anything.',
    ],
    gossip: [
      'Before the Vigil there was a hall here, and before the hall there was a hole. The hole is the oldest thing.',
      'The ossuary was a crypt once. Then it was a larder. Then nobody wrote anything down for a while.',
      'The Tallow King is not a king. It is what happens when a thing is lit for too long.',
      'Rook was a cheerful boy. Then he learned to read the ledgers.',
    ],
    questLines: {
      q5_the_whisper: {
        offer: 'Down in the root caves something speaks with the voices of the people we lost. Tenth descent, give or take. I would like it silenced before it learns my name.',
        active: 'It hides and it talks. Follow the talking. When you find the mouth, close it.',
        done: 'It stopped. I heard it stop, from up here. Take the bow; it belonged to someone the Whisper was pretending to be.',
      },
    },
  },
  {
    id: 'n_pip', name: 'Pip', title: 'Scavenger', role: 'wanderer',
    vendorType: 'junk', services: [],
    look: { silhouette: 'lean', bodyColor: '#7a6a50', trimColor: '#3a5a3a', weapon: 'dagger', helm: 'hood', cloak: 'short' },
    greeting: [
      'Found it, cleaned it, mostly. Have a look.',
      'Everything here came up from below and nothing here is haunted. Much.',
      'I buy what the others will not and sell what the others cannot.',
      'No refunds, no questions, no telling Rook where I was last night.',
    ],
    gossip: [
      'There is a fountain on the fourth descent that tastes like coins. I drank it twice. Still here.',
      'The bats are not the worst thing in the undercroft. The bats are just the loudest.',
      'Brann says my goods are junk. Brann sold a man a sword with no tang last spring.',
    ],
    questLines: {},
  },
];

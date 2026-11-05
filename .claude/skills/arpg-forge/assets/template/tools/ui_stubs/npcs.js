/** Stub of npc/npcs.js for the UI harness. */
export function getDialogue(game, npc) {
  return { lines: npc.greeting || [], options: [] };
}
export function serviceHeal(game, npc) {
  game.player.hp = game.player.hpMax;
  return { ok: true, text: 'You feel better.' };
}
export function serviceIdentify(game, npc, item) {
  if (!item) return { ok: false, reason: 'Hold an item to identify it' };
  item.identified = true;
  return { ok: true };
}

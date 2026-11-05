/** Stub of items/inventory.js for the UI harness (only what the UI probes). */
export function canEquip(player, item) {
  const req = item.req || {};
  const stat = (k) => ((player.base && player.base[k]) || 0) + ((player.bonus && player.bonus[k]) || 0);
  return !(req.str > stat('str') || req.dex > stat('dex') || req.mag > stat('mag'));
}
export function recalcPlayer(game) {
  game.__recalcs = (game.__recalcs || 0) + 1;
}

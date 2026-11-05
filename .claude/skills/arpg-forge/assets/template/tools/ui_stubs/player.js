/** Stub of entities/player.js for the UI harness (spendStat etc. left out to exercise fallbacks). */
export function xpForLevel(level) {
  return level <= 1 ? 0 : Math.floor(80 * Math.pow(level - 1, 2));
}

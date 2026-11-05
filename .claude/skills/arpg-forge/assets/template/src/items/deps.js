/**
 * Late-bound seam to the modules other builders own (entities/combat.js,
 * entities/player.js, entities/missile.js). The item/skill modules never
 * import those files directly: the integrator either calls `loadItemDeps()`
 * once at boot (dynamic import, each one optional) or passes the functions
 * to `setItemDeps`. Unit tests inject stubs the same way. Names and
 * signatures are the ones listed in docs/CONTRACTS.md plus
 * `recalcPlayerBase(game)` and `applyBuff(game, p, buff)` from player.js.
 */
const deps = {
  spawnMissile: null,          // (game, spec) -> Missile|null
  applyDamageToMonster: null,  // (game, m, dmg, element, source)
  rollPlayerHitsMonster: null, // (game, p, m) -> {hit, dmg, crit}
  monstersInRadius: null,      // (level, x, y, r) -> Monster[]
  applyBuff: null,             // (game, p, {id, stat, value, ticks})
  teleportPlayer: null,        // (game, tx, ty)
  recalcPlayerBase: null,      // (game) -> sets p.derived.lifeBase / manaBase (optional)
  giveXp: null,
};

const SOURCES = [
  ['../entities/missile.js', ['spawnMissile']],
  ['../entities/combat.js', ['applyDamageToMonster', 'rollPlayerHitsMonster']],
  ['../entities/monster.js', ['monstersInRadius']],
  ['../entities/player.js', ['applyBuff', 'teleportPlayer', 'recalcPlayerBase', 'giveXp']],
];

/**
 * Override one or more dependencies (tests, or an integrator wiring by hand).
 * @param {Partial<typeof deps>} partial
 */
export function setItemDeps(partial) {
  Object.assign(deps, partial);
}

/** @returns {typeof deps} the live dependency table (read, do not copy) */
export function getItemDeps() {
  return deps;
}

/**
 * Try to import every sibling module and fill the table with whatever it
 * exports. Missing modules or names are skipped silently so the item system
 * still works (with fallbacks) during partial builds.
 * @param {string} [base] import.meta.url of the caller when paths must be rebased
 * @returns {Promise<string[]>} names that were resolved
 */
export async function loadItemDeps(base) {
  const found = [];
  for (const [path, names] of SOURCES) {
    try {
      const url = base ? new URL(path, base).href : path;
      const mod = await import(url);
      for (const n of names) {
        if (typeof mod[n] === 'function' && !deps[n]) {
          deps[n] = mod[n];
          found.push(n);
        }
      }
    } catch (err) {
      // optional module not present yet
    }
  }
  return found;
}

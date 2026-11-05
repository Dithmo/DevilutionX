/**
 * Late-bound seams to modules written by other agents (monsters, items,
 * missiles, combat, player, inventory). The level generator and the object
 * layer call through `deps.*` so they can load (and be unit-tested) before
 * those modules exist. On import we try to wire the real modules; anything
 * missing stays null and callers degrade gracefully. Tests and integrators
 * can override with `setLevelDeps({...})`.
 *
 * Only names listed in docs/CONTRACTS.md are wired here.
 */

/** @type {Record<string, Function|null>} */
export const deps = {
  spawnMonster: null,          // entities/monster.js  (game, typeId, tx, ty, opts) -> Monster
  spawnPack: null,             // entities/monster.js  (game, typeId, tx, ty, opts) -> Monster[]
  placeMonstersForLevel: null, // entities/monster.js  (game, level, tier)
  monstersInRadius: null,      // entities/monster.js  (level, x, y, r) -> Monster[]
  generateItem: null,          // items/itemgen.js     (game, {level, quality?, baseId?, onlyGood?, source}) -> Item
  generateGold: null,          // items/itemgen.js     (game, level) -> Item
  identify: null,              // items/itemgen.js     (item)
  spawnMissile: null,          // entities/missile.js  (game, spec) -> Missile
  applyDamageToPlayer: null,   // entities/combat.js   (game, p, dmg, element, source)
  applyDamageToMonster: null,  // entities/combat.js   (game, m, dmg, element, source)
  teleportPlayer: null,        // entities/player.js   (game, tx, ty)
  recalcPlayer: null,          // items/inventory.js   (game)
};

const WIRING = [
  ['../../entities/monster.js', ['spawnMonster', 'spawnPack', 'placeMonstersForLevel', 'monstersInRadius']],
  ['../../items/itemgen.js', ['generateItem', 'generateGold', 'identify']],
  ['../../entities/missile.js', ['spawnMissile']],
  ['../../entities/combat.js', ['applyDamageToPlayer', 'applyDamageToMonster']],
  ['../../entities/player.js', ['teleportPlayer']],
  ['../../items/inventory.js', ['recalcPlayer']],
];

/**
 * Override seams (tests, integrators). Only keys already present are accepted.
 * @param {Partial<typeof deps>} overrides
 */
export function setLevelDeps(overrides) {
  for (const k of Object.keys(overrides)) if (k in deps && typeof overrides[k] === 'function') deps[k] = overrides[k];
}

/**
 * Resolves once auto-wiring has been attempted for every module (missing
 * modules are skipped silently). Await this in tools before generating.
 * @type {Promise<typeof deps>}
 */
export const levelDepsReady = Promise.all(WIRING.map(([path, names]) => import(path)
  .then((mod) => { for (const n of names) if (!deps[n] && typeof mod[n] === 'function') deps[n] = mod[n]; })
  .catch(() => null))).then(() => deps);

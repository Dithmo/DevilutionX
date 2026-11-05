/**
 * Late-bound dependencies for the monster / AI / missile modules.
 *
 * monster.js and missile.js call into modules written by other builders
 * (entities/combat.js, entities/player.js, items/itemgen.js). To keep this
 * cluster loadable on its own (unit tests, partial checkouts) those names are
 * resolved lazily: the real modules are imported in the background at load
 * time and copied into `deps`; anything that fails to load keeps a harmless
 * stub. `setMonsterDeps()` overrides explicitly (tests) and wins over the
 * background import. Only names listed in docs/CONTRACTS.md are used.
 */

const STUB_WARN_ONCE = new Set();

function warnOnce(name) {
  if (STUB_WARN_ONCE.has(name)) return;
  STUB_WARN_ONCE.add(name);
  console.warn(`[monster_deps] using stub for ${name}`);
}

/** Minimal stand-ins so the simulation never throws when a module is missing. */
const stubs = {
  rollPlayerHitsMonster(game, p, m) {
    warnOnce('rollPlayerHitsMonster');
    const d = p.derived || {};
    return { hit: true, dmg: game.rng.range(d.dmgMin || 1, d.dmgMax || 2), crit: false };
  },
  rollMonsterHitsPlayer(game, m) {
    warnOnce('rollMonsterHitsPlayer');
    return { hit: true, blocked: false, dmg: game.rng.range(m.dmgMin, m.dmgMax) };
  },
  applyDamageToMonster(game, m, dmg) {
    warnOnce('applyDamageToMonster');
    m.hp -= dmg;
  },
  applyDamageToPlayer(game, p, dmg) {
    warnOnce('applyDamageToPlayer');
    p.hp -= dmg;
  },
  giveXp() { warnOnce('giveXp'); },
  generateItem() { warnOnce('generateItem'); return null; },
  generateGold() { warnOnce('generateGold'); return null; },
};

/** Names each module contributes. */
const SOURCES = [
  // The last three are optional richer pipelines (not in CONTRACTS); code checks for them before use.
  { path: './combat.js', names: ['rollPlayerHitsMonster', 'rollMonsterHitsPlayer', 'applyDamageToMonster', 'applyDamageToPlayer', 'monsterMeleeHit', 'playerMissileHit', 'monsterMissileHit'] },
  { path: './player.js', names: ['giveXp'] },
  { path: '../items/itemgen.js', names: ['generateItem', 'generateGold'] },
];

const explicit = new Set();

/** The live dependency table. Call through `deps.name(...)` at call time, never destructure at load. */
export const deps = { ...stubs };

/**
 * Override dependencies (tests / embedding). Overrides are never replaced by
 * the background import. A `null` value pins an optional name off (the code
 * then uses the CONTRACTS primitives instead of e.g. combat.js monsterMeleeHit).
 * @param {Object<string, Function|null>} table
 */
export function setMonsterDeps(table) {
  for (const k of Object.keys(table)) {
    if (typeof table[k] !== 'function' && table[k] !== null) continue;
    deps[k] = table[k] === null ? stubs[k] || null : table[k];
    explicit.add(k);
  }
}

/**
 * Import the real modules (fire-and-forget). Safe to call repeatedly.
 * @returns {Promise<void>} resolves once every source has been tried
 */
export function loadMonsterDeps() {
  return Promise.all(SOURCES.map(async (src) => {
    let mod;
    try {
      mod = await import(src.path);
    } catch (err) {
      return; // module not present: keep stubs
    }
    for (const n of src.names) {
      if (!explicit.has(n) && typeof mod[n] === 'function') deps[n] = mod[n];
    }
  })).then(() => undefined);
}

loadMonsterDeps();

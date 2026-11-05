/**
 * Merged balance tables. Each area lives in its own module; this file only
 * collects them so the engine imports a single object: `game.balance`.
 */
import combat from './combat.js';
import progression from './progression.js';
import monsters from './monsters.js';
import missiles from './missiles.js';
import loot from './loot.js';
import skills from './skills.js';
import levels from './levels.js';
import economy from './economy.js';

export default { combat, progression, monsters, missiles, loot, skills, levels, economy };

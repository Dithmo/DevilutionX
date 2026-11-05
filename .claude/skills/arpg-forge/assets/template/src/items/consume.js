/**
 * Using consumables (reference UseItem): potions, elixirs, scrolls, tomes,
 * identify and town-portal scrolls. One charge is consumed only when the
 * effect went off (a fizzled scroll costs nothing).
 */
import { LOOT } from '../../data/balance/loot.js';
import { SKILLS } from '../../data/balance/skills.js';
import { removeItem } from './grid.js';
import { recalcPlayer, classOf } from './recalc.js';
import { castSkill, learnSkill } from '../skills/skills.js';
import { getItemDeps } from './deps.js';

const FULL_PCT = 100;

const STAT_NAMES = { str: 'strength', mag: 'magic', dex: 'dexterity', vit: 'vitality' };
const STR = (game, key, fallback) => (game.strings && game.strings[key]) || fallback;

/** undefined → reference partial restore (max/8 + rand(max/4)); number → percent of max (≥100 = full). */
function partial(game, max, value) {
  if (value === undefined || value === null) {
    return Math.floor(max / LOOT.partialRestoreBaseDiv) + game.rng.rand(Math.max(1, Math.floor(max / LOOT.partialRestoreRandDiv)));
  }
  if (value >= FULL_PCT) return max;
  return Math.floor((max * value) / FULL_PCT);
}

/** Remove one charge of the item from wherever it lives. */
export function consumeOne(game, item) {
  if ((item.count || 1) > 1) {
    item.count -= 1;
    return;
  }
  const p = game.player;
  if (p.inventory && p.inventory.items[item.id]) removeItem(p.inventory, item.id);
  if (p.stash && p.stash.items[item.id]) removeItem(p.stash, item.id);
  if (p.belt) {
    const i = p.belt.indexOf(item);
    if (i >= 0) p.belt[i] = null;
  }
  if (game.ui && game.ui.cursorItem === item) game.ui.cursorItem = null;
}

/**
 * Use a consumable. `target` is passed to skill scrolls ({x,y} tile or entity).
 * @returns {boolean} true when the effect happened and a charge was consumed
 */
export function useItem(game, item, target) {
  const deps = getItemDeps();
  if (deps.useConsumable) return !!deps.useConsumable(game, item, { target });
  const p = game.player;
  const e = item.effect;
  if (!e) return false;
  const bus = game.bus;
  let ok = true;
  switch (e.type) {
    case 'heal': {
      const n = partial(game, p.hpMax, e.value);
      p.hp = Math.min(p.hpMax, p.hp + n);
      if (bus) bus.emit('float', { x: p.tx, y: p.ty, text: `+${n}`, color: 'hp' });
      break;
    }
    case 'mana': {
      const n = partial(game, p.mpMax, e.value);
      p.mp = Math.min(p.mpMax, p.mp + n);
      if (bus) bus.emit('float', { x: p.tx, y: p.ty, text: `+${n}`, color: 'mp' });
      break;
    }
    case 'rejuv': {
      p.hp = Math.min(p.hpMax, p.hp + partial(game, p.hpMax, e.value));
      p.mp = Math.min(p.mpMax, p.mp + partial(game, p.mpMax, e.value));
      break;
    }
    case 'stat': {
      const cls = classOf(game, p);
      const cap = (cls.max && cls.max[e.stat]) || Infinity;
      if ((p.base[e.stat] || 0) >= cap) {
        ok = false;
        if (bus) bus.emit('message', { text: STR(game, 'statMaxed', 'That attribute is at its limit.'), color: 'danger' });
        break;
      }
      p.base[e.stat] = Math.min(cap, (p.base[e.stat] || 0) + e.value);
      recalcPlayer(game);
      if (bus) bus.emit('message', { text: `+${e.value} ${STAT_NAMES[e.stat] || e.stat}`, color: 'good' });
      break;
    }
    case 'castSkill':
      ok = castSkill(game, p, e.skillId, target, { slvl: SKILLS.scrollSkillLevel, free: true });
      break;
    case 'learnSkill':
      ok = learnSkill(game, p, e.skillId).ok;
      break;
    case 'identify':
      if (game.ui) game.ui.cursorMode = 'identify';
      break;
    case 'townPortal':
      ok = !!(game.hooks && game.hooks.onTownPortal && game.hooks.onTownPortal(game));
      break;
    default:
      ok = false;
  }
  if (!ok) return false;
  consumeOne(game, item);
  if (bus && e.type !== 'castSkill') bus.emit('sfx', { name: item.type === 'potion' || item.type === 'elixir' ? 'potion' : 'click' });
  return true;
}

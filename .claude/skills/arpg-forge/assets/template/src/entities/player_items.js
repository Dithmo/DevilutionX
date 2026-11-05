/**
 * Belt and consumable use. Effect types per THEME_SCHEMA Consumable.effect:
 * heal | mana | rejuv | stat | castSkill | identify | townPortal | learnSkill.
 *
 * `value` semantics: heal/mana/rejuv — undefined = reference partial restore
 * (max/8 + rand(max/4)), a number = percent of max (>= 100 is full);
 * stat — `effect.stat` (or a string `value`) names the attribute, numeric
 * `value` (default 1) is the amount; learnSkill/castSkill use `skillId`.
 */
import { removeItem } from '../items/inventory.js';
import { identify } from '../items/itemgen.js';
import { castSkill } from '../skills/skills.js';
import { modifyBaseStat, classDef } from './player_stats.js';
import { statTotal } from './combat_rolls.js';
import { dirToDelta } from '../world/pathfind.js';
import { elementColor } from './combat_rolls.js';
import * as P from '../../data/balance/progression.js';

const PCT = 100;
const FULL_PCT = 100;
const DEFAULT_STAT_AMOUNT = 1;
const STAT_SUFFIX = /_(str|mag|dex|vit)$/;
const EQUIP_SLOTS = ['head', 'body', 'weapon', 'offhand', 'ring1', 'ring2', 'amulet'];
const MSG = {
  nothingToIdentify: 'Nothing to identify.',
  noPortal: 'You cannot open a portal here.',
  alreadyMaxed: 'You already know all there is of that.',
  notYourArt: 'Your class cannot learn that.',
  needMag: 'You lack the magic to understand this.',
  learned: 'You learned',
  cannotUse: 'You cannot use that.',
};

function msg(game, text, color) {
  game.bus.emit('message', { text, color: color || game.theme.palette.textDim });
}

/** Consumable definition for an item (by baseId) or the item's own `effect`. @returns {object|null} */
export function consumableDef(game, item) {
  if (!item) return null;
  if (item.effect && item.effect.type) return { id: item.baseId, effect: item.effect };
  const list = (game.theme.items && game.theme.items.consumables) || [];
  return list.find((c) => c.id === item.baseId) || null;
}

function partialRestore(game, max) {
  return Math.floor(max / P.PARTIAL_RESTORE_BASE_DIV) + game.rng.rand(Math.max(1, Math.floor(max / P.PARTIAL_RESTORE_RAND_DIV)));
}

function restoreAmount(game, max, value) {
  if (value === undefined || value === null) return partialRestore(game, max);
  if (value >= FULL_PCT) return max;
  return Math.floor((max * value) / PCT);
}

function healPlayer(game, p, value) {
  const amount = Math.min(restoreAmount(game, p.hpMax, value), p.hpMax - p.hp);
  if (amount > 0) {
    p.hp += amount;
    game.bus.emit('float', { x: p.tx + 0.5, y: p.ty, text: `+${amount}`, color: elementColor('heal') });
  }
}

function restoreMana(game, p, value) {
  const amount = Math.min(restoreAmount(game, p.mpMax, value), p.mpMax - p.mp);
  if (amount > 0) {
    p.mp += amount;
    game.bus.emit('float', { x: p.tx + 0.5, y: p.ty, text: `+${amount} mp`, color: elementColor('mana') });
  }
}

function statOf(effect, item) {
  if (effect.stat) return effect.stat;
  if (typeof effect.value === 'string') return effect.value;
  const m = item.baseId && STAT_SUFFIX.exec(item.baseId);
  return m ? m[1] : null;
}

function defaultTarget(game, p) {
  const d = dirToDelta(p.dir);
  return { x: p.tx + d.x, y: p.ty + d.y };
}

/** Default identify: first unidentified equipped, then inventory item. @returns {boolean} */
export function identifyFirstUnknown(game, p) {
  for (const slot of EQUIP_SLOTS) {
    const it = p.equipment[slot];
    if (it && it.identified === false) { identify(it); msg(game, `Identified: ${it.name}`, game.theme.palette.good); return true; }
  }
  for (const id of Object.keys(p.inventory.items)) {
    const it = p.inventory.items[id];
    if (it && it.identified === false) { identify(it); msg(game, `Identified: ${it.name}`, game.theme.palette.good); return true; }
  }
  msg(game, MSG.nothingToIdentify);
  return false;
}

function learnSkill(game, p, skillId) {
  const def = (game.theme.skills || []).find((s) => s.id === skillId);
  const cls = classDef(game, p);
  if (!def) { msg(game, MSG.cannotUse); return false; }
  const allowed = (cls.skillPool && cls.skillPool.includes(skillId)) || (def.classes && def.classes.includes(p.classId));
  if (!allowed) { msg(game, MSG.notYourArt); return false; }
  const cur = p.skills[skillId] || 0;
  if (cur >= P.MAX_SKILL_LEVEL) { msg(game, MSG.alreadyMaxed); return false; }
  const req = Math.floor((def.minMag || 0) * (1 + P.TOME_REQ_SCALE_PER_LEVEL * cur));
  if (statTotal(p, 'mag') < req) { msg(game, `${MSG.needMag} (${req} magic)`); return false; }
  p.skills[skillId] = cur + 1;
  if (def.manaBase) p.mp = Math.min(p.mpMax, p.mp + def.manaBase); // reference: books refund the spell's mana cost
  if (!p.selectedSkill) p.selectedSkill = skillId;
  msg(game, `${MSG.learned} ${def.name} (level ${cur + 1}).`, game.theme.palette.good);
  game.bus.emit('sfx', { name: 'cast' });
  return true;
}

/**
 * Apply a consumable's effect. Returns true if it was consumed.
 * @param {object} game
 * @param {object} item
 * @param {{target?:{x:number,y:number}}} [opts]
 * @returns {boolean}
 */
export function applyConsumableEffect(game, item, opts = {}) {
  const p = game.player;
  const def = consumableDef(game, item);
  if (!def || !def.effect) { msg(game, MSG.cannotUse); return false; }
  const e = def.effect;
  switch (e.type) {
    case 'heal': healPlayer(game, p, e.value); break;
    case 'mana': restoreMana(game, p, e.value); break;
    case 'rejuv': healPlayer(game, p, e.value); restoreMana(game, p, e.value); break;
    case 'stat': {
      const stat = statOf(e, item);
      const amount = typeof e.value === 'number' ? e.value : DEFAULT_STAT_AMOUNT;
      if (!stat || modifyBaseStat(game, p, stat, amount) <= 0) { msg(game, MSG.cannotUse); return false; }
      msg(game, `${stat.toUpperCase()} +${amount}`, game.theme.palette.good);
      break;
    }
    case 'castSkill':
      return castSkill(game, p, e.skillId, opts.target || defaultTarget(game, p));
    case 'identify':
      return game.hooks.onIdentify(game, item);
    case 'townPortal': {
      const ok = game.hooks.onTownPortal(game);
      if (!ok) { msg(game, MSG.noPortal); return false; }
      break;
    }
    case 'learnSkill':
      return learnSkill(game, p, e.skillId);
    default:
      msg(game, MSG.cannotUse);
      return false;
  }
  game.bus.emit('sfx', { name: 'potion' });
  return true;
}

/** Remove one unit of an item from the belt slot / inventory it lives in. */
function consumeOne(game, item, beltIndex) {
  const p = game.player;
  if (item.count > 1) { item.count -= 1; return; }
  if (beltIndex !== undefined && p.belt[beltIndex] === item) { p.belt[beltIndex] = null; return; }
  const bi = p.belt.indexOf(item);
  if (bi >= 0) { p.belt[bi] = null; return; }
  if (p.inventory.items[item.id]) removeItem(p.inventory, item.id);
}

/**
 * Use a consumable from the inventory or belt. @returns {boolean} consumed
 */
export function useConsumable(game, item, opts = {}) {
  if (!item || game.player.dead) return false;
  if (!applyConsumableEffect(game, item, opts)) return false;
  consumeOne(game, item, opts.beltIndex);
  return true;
}

/**
 * Use belt slot i (0..7). @returns {boolean} consumed
 */
export function useBeltSlot(game, i) {
  const p = game.player;
  const item = p.belt[i];
  if (!item) return false;
  return useConsumable(game, item, { beltIndex: i });
}

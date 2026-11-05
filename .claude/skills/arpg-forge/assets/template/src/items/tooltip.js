/**
 * Item tooltip text for the UI layer: `itemTooltipLines(item, player, palette)`
 * returns `[{text, color}]`. Kept apart from itemgen.js so the generator stays
 * data-only.
 */
import { LOOT } from '../../data/balance/loot.js';
import { effectLine } from './affixes.js';
import { itemMeetsReq } from './itemgen.js';

const DEFAULT_PALETTE = {
  rarity: { normal: '#e8e0d0', magic: '#7aa0ff', rare: '#f0d060', unique: '#d8a040' },
  text: '#e8e0d0', textDim: '#9a9080', danger: '#ff5050', good: '#80e080',
};
const REQ_KEYS = ['str', 'dex', 'mag'];
const STAT_NAMES = { str: 'Str', dex: 'Dex', mag: 'Mag' };

/**
 * Tooltip lines for the UI: `[{text, color}]`.
 * @param {object} item
 * @param {object|null} player for requirement colouring
 * @param {object} [palette] theme palette (rarity colours); defaults built in
 */
export function itemTooltipLines(item, player, palette = DEFAULT_PALETTE) {
  const pal = { ...DEFAULT_PALETTE, ...palette, rarity: { ...DEFAULT_PALETTE.rarity, ...(palette.rarity || {}) } };
  const lines = [];
  const known = item.identified || item.quality === 'normal';
  const nameColor = known ? pal.rarity[item.quality] || pal.text : pal.textDim;
  lines.push({ text: known ? item.name : (item.baseName || item.name), color: nameColor });
  if (item.slot === 'gold') {
    lines.push({ text: `${item.count} gold`, color: pal.text });
    return lines;
  }
  if (item.dmg) lines.push({ text: `Damage: ${item.dmg.min}-${item.dmg.max}`, color: pal.text });
  if (item.ac !== null && item.ac !== undefined) lines.push({ text: `Armour: ${item.ac}`, color: pal.text });
  if (item.dur && !item.effects.indestructible) lines.push({ text: `Durability: ${item.dur.cur}/${item.dur.max}`, color: pal.textDim });
  if (item.charges) lines.push({ text: `Charges: ${item.charges.cur}/${item.charges.max}`, color: pal.textDim });
  const reqs = REQ_KEYS.filter((k) => item.req && item.req[k] > 0);
  if (reqs.length) {
    const met = !player || itemMeetsReq(player, item);
    lines.push({ text: `Requires ${reqs.map((k) => `${item.req[k]} ${STAT_NAMES[k]}`).join(', ')}`, color: met ? pal.textDim : pal.danger });
  }
  if (!known) {
    lines.push({ text: 'Unidentified', color: pal.danger });
  } else if (item.quality === 'unique' || item.quality === 'rare') {
    const keys = Object.keys(item.effects).filter((k) => !k.endsWith('Min')).slice(0, LOOT.tooltipMaxAffixes);
    for (const k of keys) {
      const txt = effectLine(k, item.effects[k], item.effects);
      if (txt) lines.push({ text: txt, color: item.effects[k] < 0 ? pal.danger : pal.good });
    }
  } else {
    for (const a of item.affixes.slice(0, LOOT.tooltipMaxAffixes)) {
      const eff = a.min !== undefined ? { [a.stat + 'Min']: a.min } : {};
      lines.push({ text: effectLine(a.stat, a.value, eff), color: a.cursed ? pal.danger : pal.good });
    }
  }
  if (item.effect && item.effect.type) lines.push({ text: consumableBlurb(item.effect), color: pal.textDim });
  if (item.price) lines.push({ text: `Value: ${item.price.buy}`, color: pal.textDim });
  return lines;
}

function consumableBlurb(effect) {
  switch (effect.type) {
    case 'heal': return effect.value >= 1 ? 'Restores all life' : 'Restores some life';
    case 'mana': return effect.value >= 1 ? 'Restores all mana' : 'Restores some mana';
    case 'rejuv': return effect.value >= 1 ? 'Restores all life and mana' : 'Restores some life and mana';
    case 'stat': return `Permanently +${effect.value} ${STAT_NAMES[effect.stat] || effect.stat}`;
    case 'castSkill': return 'Casts when used';
    case 'learnSkill': return 'Teaches a skill';
    case 'identify': return 'Identifies an item';
    case 'townPortal': return 'Opens a portal to town';
    default: return '';
  }
}

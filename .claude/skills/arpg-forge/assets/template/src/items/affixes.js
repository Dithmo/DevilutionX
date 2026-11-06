/**
 * Affix eligibility, weighted selection and value rolling (reference
 * GetItemPower / SelectAffix / SaveItemAffix / PLVal), plus the stat label
 * table used by item tooltips. Pure functions over an rng passed in.
 */
import { LOOT } from '../../data/balance/loot.js';
import { word } from '../../data/strings.js';

const PCT = 100;
const ELEM_MIN_SUFFIX = 'Min';

/** @returns {boolean} does an affix row apply to this item (slot or type match) */
export function affixFitsItem(affix, item) {
  return affix.slots.includes(item.slot) || affix.slots.includes(item.type);
}

/**
 * Affixes a given item may roll inside a level window.
 * @param {object[]} table prefixes or suffixes
 * @param {object} item base item (slot/type set)
 * @param {number} minLevel
 * @param {number} maxLevel
 * @param {{allowCursed?:boolean, exclude?:Set<string>, excludeStats?:Set<string>}} [opts]
 */
export function eligibleAffixes(table, item, minLevel, maxLevel, opts = {}) {
  const lo = Math.min(minLevel, LOOT.affixMinLevelCap);
  const out = [];
  for (const a of table) {
    if (!affixFitsItem(a, item)) continue;
    if (a.minLevel < lo || a.minLevel > maxLevel) continue;
    if (a.maxLevel !== undefined && maxLevel > a.maxLevel) continue;
    if (a.cursed && !opts.allowCursed) continue;
    if (opts.exclude && opts.exclude.has(a.id)) continue;
    if (opts.excludeStats && opts.excludeStats.has(a.stat)) continue;
    out.push(a);
  }
  return out;
}

/**
 * Weighted uniform pick (each row repeated `weight` times, default 1).
 * @returns {object|null}
 */
export function pickAffix(rng, list) {
  if (!list.length) return null;
  let total = 0;
  for (const a of list) total += a.weight || 1;
  let r = rng.rand(total);
  for (const a of list) {
    r -= a.weight || 1;
    if (r < 0) return a;
  }
  return list[list.length - 1];
}

/**
 * Roll an affix instance: value inside range, price add interpolated by the
 * roll (PLVal). Elemental damage stats carry their range as min/max.
 * @returns {{id,name,kind,stat,value,min?,priceAdd,priceMult,cursed}}
 */
export function rollAffix(rng, affix) {
  const [lo, hi] = affix.range;
  const [plo, phi] = affix.priceAdd;
  const isElem = affix.stat.startsWith('elemDmg');
  const value = isElem ? hi : rng.range(lo, hi);
  const t = hi === lo ? 0 : (value - lo) / (hi - lo);
  const priceAdd = Math.floor(plo + (phi - plo) * t);
  const inst = {
    id: affix.id, name: affix.name, kind: affix.kind, stat: affix.stat, value,
    priceAdd, priceMult: affix.priceMult || 0, cursed: !!affix.cursed, power: affix.power || 1,
  };
  if (isElem) inst.min = lo;
  return inst;
}

/** Add an affix instance's contribution to an `effects` map (in place). */
export function applyAffixEffects(effects, inst) {
  effects[inst.stat] = (effects[inst.stat] || 0) + inst.value;
  if (inst.min !== undefined) {
    const k = inst.stat + ELEM_MIN_SUFFIX;
    effects[k] = (effects[k] || 0) + inst.min;
  }
}

const sign = (v) => (v >= 0 ? `+${v}` : `${v}`);
const ELEMENT_NAMES = { Fire: 'fire', Cold: 'cold', Shock: 'shock', Arcane: 'arcane' };

/** Human-readable template per stat key (CONTRACTS vocabulary). */
export const STAT_LABELS = {
  toHit: (v) => `${sign(v)}% to hit`,
  dmgPct: (v) => `${sign(v)}% damage`,
  dmgFlat: (v) => `${sign(v)} to damage`,
  ac: (v) => `${sign(v)} armour`,
  acPct: (v) => `${sign(v)}% armour`,
  str: (v) => `${sign(v)} strength`,
  mag: (v) => `${sign(v)} magic`,
  dex: (v) => `${sign(v)} dexterity`,
  vit: (v) => `${sign(v)} vitality`,
  allStats: (v) => `${sign(v)} to all attributes`,
  life: (v) => `${sign(v)} ${word('life')}`,
  mana: (v) => `${sign(v)} ${word('mana')}`,
  resFire: (v) => `${sign(v)}% fire resist`,
  resCold: (v) => `${sign(v)}% cold resist`,
  resShock: (v) => `${sign(v)}% shock resist`,
  resArcane: (v) => `${sign(v)}% arcane resist`,
  resAll: (v) => `${sign(v)}% all resists`,
  lightRadius: (v) => `${sign(v)} light radius`,
  attackSpeed: (v) => `${['', 'quick', 'fast', 'faster', 'fastest'][Math.min(Math.max(v, 0), LOOT.attackSpeedMax)] || sign(v)} attack`,
  hitRecover: (v) => `${['', 'fast', 'faster', 'fastest'][Math.min(Math.max(v, 0), LOOT.hitRecoverMax)] || sign(v)} hit recovery`,
  lifeSteal: (v) => `hits steal ${v}% ${word('life')}`,
  manaSteal: (v) => `hits steal ${v}% ${word('mana')}`,
  durability: (v) => (v >= 0 ? 'high durability' : 'decreased durability'),
  indestructible: () => 'indestructible',
  thorns: (v) => `attackers take ${v} damage`,
  knockback: () => 'knocks targets back',
  spellLevels: (v) => `${sign(v)} to skill levels`,
  manaCostPct: (v) => `${v}% reduced ${word('mana')} cost`,
  blockPct: (v) => `${sign(v)}% block chance`,
  walkSpeed: (v) => `${sign(v)}% walk speed`,
};

/**
 * One tooltip line for a stat; elemental damage reads the paired min key.
 * @returns {string}
 */
export function effectLine(stat, value, effects = {}) {
  if (stat.startsWith('elemDmg')) {
    if (stat.endsWith(ELEM_MIN_SUFFIX)) return '';
    const el = ELEMENT_NAMES[stat.slice('elemDmg'.length)] || stat;
    const min = effects[stat + ELEM_MIN_SUFFIX] ?? value;
    return `${min}-${value} ${el} damage`;
  }
  const f = STAT_LABELS[stat];
  return f ? f(value) : `${sign(value)} ${stat}`;
}

/** Percent helper shared by callers that scale by an effects percentage. */
export function pct(v) {
  return v / PCT;
}

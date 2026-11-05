/**
 * Deterministic item generation (reference SetupAllItems pipeline).
 *
 * Every item gets `seed = game.rng.next()` and is rolled from a forked rng
 * seeded with it, so `generateItem(game, {...opts, seed})` reproduces it.
 * Theme tables: game.theme.items = { bases, prefixes, suffixes, uniques,
 * consumables, rareNames? }.
 */
import { createRng } from '../core/rng.js';
import { LOOT } from '../../data/balance/loot.js';
import { eligibleAffixes, pickAffix, rollAffix, applyAffixEffects } from './affixes.js';

export { itemTooltipLines } from './tooltip.js';

const PCT = 100;
const HALF = 2;
const GOLD_ID = 'gold';
const CONSUMABLE_SLOT = { scroll: 'scroll', tome: 'tome' };
const REQ_KEYS = ['str', 'dex', 'mag'];

/* ------------------------------------------------------------------ helpers */

const nextId = (game) => (game.nextId = (game.nextId || 1) + 1) - 1;
const tables = (game) => game.theme.items;
const baseById = (game, id) => tables(game).bases.find((b) => b.id === id) || null;
const consumableById = (game, id) => tables(game).consumables.find((c) => c.id === id) || null;
const statOf = (p, k) => ((p.base && p.base[k]) || 0) + ((p.bonus && p.bonus[k]) || 0);

/** Weighted pick among rows by dropWeight (×classWeight[classId] when given). */
function pickWeighted(rng, rows, classId) {
  let total = 0;
  const w = rows.map((r) => {
    const cw = classId && r.classWeight && r.classWeight[classId] ? r.classWeight[classId] : 1;
    const v = (r.dropWeight || 0) * cw;
    total += v;
    return v;
  });
  if (total <= 0) return null;
  let r = rng.float() * total;
  for (let i = 0; i < rows.length; i++) {
    r -= w[i];
    if (r < 0) return rows[i];
  }
  return rows[rows.length - 1];
}

/** Plain instance of an equipment base (GetItemAttrs). */
function instantiateBase(game, rng, base) {
  const item = {
    id: nextId(game), baseId: base.id, name: base.name, slot: base.slot, type: base.type,
    size: { ...base.size }, quality: 'normal', identified: true, level: base.level,
    req: { str: 0, dex: 0, mag: 0, ...(base.req || {}) },
    dmg: base.dmg ? { min: base.dmg[0], max: base.dmg[1] } : null,
    ac: base.ac ? rng.range(base.ac[0], base.ac[1]) : null,
    dur: base.dur ? { cur: base.dur, max: base.dur } : null,
    affixes: [], unique: null, effects: {}, charges: null, count: 1,
    price: { buy: base.price, sell: Math.max(Math.floor(base.price / LOOT.sellDivisor), LOOT.priceMin) },
    look: { ...base.look }, seed: 0,
    twoHanded: !!base.twoHanded, hands: base.hands || 1, speed: base.speed || 'normal',
  };
  if (base.questId) item.questId = base.questId;
  if (base.stackable) item.stackable = true;
  return item;
}

/** Instance of a consumable row. */
function instantiateConsumable(game, row) {
  const slot = CONSUMABLE_SLOT[row.kind] || 'consumable';
  const item = {
    id: nextId(game), baseId: row.id, name: row.name, slot, type: row.kind, size: { w: 1, h: 1 },
    quality: 'normal', identified: true, level: row.level, req: { str: 0, dex: 0, mag: row.minMag || 0 },
    dmg: null, ac: null, dur: null, affixes: [], unique: null, effects: {}, charges: null, count: 1,
    price: { buy: row.price, sell: Math.max(Math.floor(row.price / LOOT.sellDivisor), LOOT.priceMin) },
    look: { ...row.look }, seed: 0, belt: !!row.belt, effect: { ...row.effect }, stackable: true,
  };
  return item;
}

function computePrice(item, basePrice) {
  let add = 0;
  let mult = 0;
  for (const a of item.affixes) {
    add += a.priceAdd;
    mult += a.priceMult;
  }
  const buy = Math.max(Math.floor(basePrice + add + mult * basePrice), LOOT.priceMin);
  item.price = { buy, sell: Math.max(Math.floor(buy / LOOT.sellDivisor), LOOT.priceMin) };
}

function applyDurabilityEffects(item) {
  if (!item.dur) return;
  const e = item.effects;
  if (e.indestructible) {
    item.dur.max = LOOT.indestructibleDur;
    item.dur.cur = LOOT.indestructibleDur;
    return;
  }
  if (e.durability) {
    item.dur.max = Math.max(1, item.dur.max + Math.floor((item.dur.max * e.durability) / PCT));
    item.dur.cur = item.dur.max;
  }
}

function nameMagic(game, rng, item, prefixes, suffixes) {
  const base = baseById(game, item.baseId);
  if (item.quality === 'rare') {
    const rn = tables(game).rareNames;
    if (rn && rn.first && rn.second && rn.first.length && rn.second.length) {
      return `${rng.pick(rn.first)} ${rng.pick(rn.second)}`;
    }
    return `${prefixes[0].name} ${base.name}`;
  }
  let n = base.name;
  if (prefixes[0]) n = `${prefixes[0].name} ${n}`;
  if (suffixes[0]) n = `${n} of ${suffixes[0].name}`;
  return n;
}

/** GetItemBonus: roll prefixes/suffixes, flatten effects, name, price. */
function applyMagic(game, rng, item, iblvl, onlyGood, rare) {
  const t = tables(game);
  const minLvl = Math.floor(iblvl / LOOT.affixMinLevelDivisor);
  let wantPre = rng.rand(PCT) < LOOT.prefixChance ? 1 : 0;
  let wantSuf = rng.rand(PCT) < LOOT.suffixChance ? 1 : 0;
  if (!wantPre && !wantSuf) {
    if (rng.rand(HALF) === 0) wantPre = 1;
    else wantSuf = 1;
  }
  if (rare) {
    wantPre = LOOT.rarePrefixes;
    wantSuf = LOOT.rareSuffixes;
  }
  const allowCursed = !onlyGood && !rare && rng.rand(PCT) < LOOT.cursedGateChance;
  const usedStats = new Set();
  const pre = [];
  const suf = [];
  const roll = (table, n, out) => {
    for (let i = 0; i < n; i++) {
      const pool = eligibleAffixes(table, item, minLvl, iblvl, { allowCursed, excludeStats: usedStats });
      const a = pickAffix(rng, pool);
      if (!a) break;
      const inst = rollAffix(rng, a);
      usedStats.add(a.stat);
      out.push(inst);
    }
  };
  roll(t.prefixes, wantPre, pre);
  roll(t.suffixes, wantSuf, suf);
  if (!pre.length && !suf.length) return false; // nothing eligible → stays normal
  item.affixes = [...pre, ...suf];
  item.quality = rare && item.affixes.length > HALF ? 'rare' : 'magic';
  for (const a of item.affixes) applyAffixEffects(item.effects, a);
  item.name = nameMagic(game, rng, item, pre, suf);
  item.identified = false;
  computePrice(item, baseById(game, item.baseId).price);
  applyDurabilityEffects(item);
  return true;
}

function applyUnique(item, u) {
  item.quality = 'unique';
  item.unique = u.id;
  item.name = u.name;
  item.effects = { ...u.effects };
  item.affixes = [];
  item.identified = false;
  item.level = Math.max(item.level, u.level);
  item.price = { buy: u.price, sell: Math.max(Math.floor(u.price / LOOT.sellDivisor), LOOT.priceMin) };
  if (u.look) item.look = { ...item.look, ...u.look };
  applyDurabilityEffects(item);
}

function uniqueCandidates(game, item, iblvl) {
  const all = tables(game).uniques.filter((u) => u.baseId === item.baseId && u.level <= iblvl);
  const found = game.foundUniques;
  if (found && found.size) {
    const fresh = all.filter((u) => !found.has(u.id));
    if (fresh.length) return fresh;
  }
  return all;
}

/** ItemRndDur: durability 25–75% of max on drop. */
function rollDropDurability(rng, item) {
  if (!item.dur || item.effects.indestructible) return;
  const lo = Math.max(1, Math.floor(item.dur.max * LOOT.dropDurMinFrac));
  const hi = Math.max(lo, Math.floor(item.dur.max * LOOT.dropDurMaxFrac));
  item.dur.cur = rng.range(lo, hi);
}

/* ------------------------------------------------------------------ exports */

/**
 * Generate a random item.
 * @param {object} game
 * @param {{level:number, quality?:'any'|'normal'|'magic'|'rare'|'unique'|'good', baseId?:string,
 *          onlyGood?:boolean, source?:'monster'|'unique'|'boss'|'chest'|'floor'|'vendor'|'quest',
 *          pool?:'any'|'equipment'|'consumable', seed?:number, classId?:string, uniqueId?:string}} opts
 * @returns {object|null} Item (null only when no base qualifies)
 */
export function generateItem(game, opts = {}) {
  const t = tables(game);
  const ilvl = Math.max(1, Math.floor(opts.level || 1));
  const quality = opts.quality || 'any';
  const onlyGood = !!opts.onlyGood || quality === 'good';
  const seed = opts.seed === undefined ? game.rng.next() : opts.seed >>> 0;
  const rng = createRng(seed);
  const pool = opts.pool || 'any';

  // --- base selection ---
  const forcedUnique = opts.uniqueId ? t.uniques.find((x) => x.id === opts.uniqueId) : null;
  const baseId = opts.baseId || (forcedUnique && forcedUnique.baseId);
  let base = baseId ? baseById(game, baseId) : null;
  let consumable = baseId ? consumableById(game, baseId) : null;
  if (!base && !consumable) {
    const minLevel = onlyGood ? Math.floor(ilvl / LOOT.onlyGoodMinLevelDivisor) : 0;
    const rows = [];
    if (pool !== 'consumable') {
      for (const b of t.bases) if (b.dropWeight > 0 && b.level <= ilvl && b.level >= minLevel) rows.push(b);
    }
    if (pool !== 'equipment' && !onlyGood) {
      for (const c of t.consumables) if (c.dropWeight > 0 && c.level <= ilvl) rows.push(c);
    }
    const row = pickWeighted(rng, rows, opts.classId);
    if (!row) return null;
    if (row.kind) consumable = row;
    else base = row;
  }
  if (consumable) {
    const item = instantiateConsumable(game, consumable);
    item.seed = seed;
    return item;
  }
  const item = instantiateBase(game, rng, base);
  item.seed = seed;
  if (item.slot === 'quest' || quality === 'normal') return item;
  if (opts.uniqueId) {
    const u = t.uniques.find((x) => x.id === opts.uniqueId);
    if (u) {
      applyUnique(item, u);
      return item;
    }
  }

  // --- quality roll (GetItemBLevel) ---
  const boss = opts.source === 'unique' || opts.source === 'boss';
  const forceMagic = quality !== 'any' || onlyGood || LOOT.alwaysMagicTypes.includes(item.type);
  let magic = forceMagic;
  if (!magic) magic = rng.rand(PCT) <= LOOT.magicFlatChance || rng.rand(PCT) <= ilvl;
  if (!magic) {
    rollDropDurability(rng, item);
    return item;
  }
  const iblvl = boss ? ilvl + LOOT.uniqueBossLevelBonus : ilvl;

  // --- unique check (CheckUnique) ---
  const uper = boss ? LOOT.uniqueChanceBoss : LOOT.uniqueChanceNormal;
  const wantUnique = quality === 'unique' || (quality !== 'magic' && quality !== 'rare' && rng.rand(PCT) <= uper);
  if (wantUnique) {
    const cands = uniqueCandidates(game, item, iblvl);
    if (cands.length) {
      applyUnique(item, rng.pick(cands));
      return item;
    }
  }

  // --- magic / rare ---
  const rareChance = Math.min(Math.floor(iblvl / LOOT.rareChanceDivisor), LOOT.rareChanceCap);
  const rare = quality === 'rare' || (quality !== 'magic' && rng.rand(PCT) < rareChance);
  applyMagic(game, rng, item, iblvl, onlyGood, rare);
  rollDropDurability(rng, item);
  return item;
}

/**
 * Gold pile: amount = 5*level + rand(10*level), capped.
 * @returns {object} Item with slot 'gold' and `count`
 */
export function generateGold(game, level) {
  const lvl = Math.max(1, Math.floor(level || 1));
  const seed = game.rng.next();
  const rng = createRng(seed);
  const amount = Math.min(LOOT.goldPerLevelBase * lvl + rng.rand(LOOT.goldPerLevelRand * lvl) + 1, LOOT.goldDropCap);
  return {
    id: nextId(game), baseId: GOLD_ID, name: 'Gold', slot: 'gold', type: 'gold', size: { w: 1, h: 1 },
    quality: 'normal', identified: true, level: lvl, req: { str: 0, dex: 0, mag: 0 }, dmg: null, ac: null, dur: null,
    affixes: [], unique: null, effects: {}, charges: null, count: amount, price: { buy: amount, sell: amount },
    look: { glyph: 'coin', color: '#e0c040', color2: '#a08020' }, seed,
  };
}

/**
 * Random consumable of at most this level (weighted by dropWeight).
 * @returns {object|null}
 */
export function generateConsumable(game, level, opts = {}) {
  return generateItem(game, { ...opts, level, pool: 'consumable' });
}

/**
 * A specific base at a requested quality ('normal' | 'magic' | 'rare' | 'unique' | 'any').
 * @returns {object|null}
 */
export function generateSpecificBase(game, baseId, quality = 'normal', level) {
  const base = baseById(game, baseId) || consumableById(game, baseId);
  if (!base) return null;
  const lvl = level || Math.max(base.level, 1);
  return generateItem(game, { level: lvl, baseId, quality: quality || 'normal' });
}

/** Quest item from a base row with slot 'quest'. @returns {object|null} */
export function createQuestItem(game, baseId) {
  const base = baseById(game, baseId);
  if (!base) return null;
  const item = instantiateBase(game, createRng(0), base);
  item.seed = 0;
  item.quality = 'normal';
  item.identified = true;
  item.slot = 'quest';
  return item;
}

/** Mark an item identified (affix effects become active). @returns {object} the item */
export function identify(item) {
  item.identified = true;
  return item;
}

/**
 * Buy/sell value as the economy sees it: unidentified magic items trade at
 * their base value (reference rule).
 * @returns {{buy:number, sell:number}}
 */
export function priceOf(item, game) {
  if (item.slot === 'gold') return { buy: item.count, sell: item.count };
  if (item.identified || item.quality === 'normal' || !game) return item.price;
  const base = baseById(game, item.baseId);
  const buy = base ? base.price : item.price.buy;
  return { buy, sell: Math.max(Math.floor(buy / LOOT.sellDivisor), LOOT.priceMin) };
}

/**
 * Requirement check against the player's current (base + bonus) stats.
 * @param {object} player
 * @param {object} item
 * @param {{str?:number,dex?:number,mag?:number}} [stats] explicit stats (used by the recalc fixed point)
 * @returns {boolean}
 */
export function itemMeetsReq(player, item, stats) {
  if (!item.req) return true;
  for (const k of REQ_KEYS) {
    const need = item.req[k] || 0;
    if (!need) continue;
    const have = stats ? stats[k] || 0 : statOf(player, k);
    if (have < need) return false;
  }
  return true;
}

/**
 * Player derived-stat pipeline (reference CalcPlrInv). Rebuilds everything
 * from `p.base`, `p.level`, the class row and the seven equipment slots:
 *   1. usability fixed point (items can turn each other off),
 *   2. effect aggregation (identified or normal items only),
 *   3. `p.bonus` (item stat bonuses), `p.resist`, and `p.derived`.
 *
 * CONVENTION (shared with entities/combat_rolls.js): `derived.toHit`,
 * `derived.ac`, `derived.dmgMin/dmgMax`, `derived.blockPct`,
 * `derived.lifeFromItems/manaFromItems`, `derived.lightRadius`,
 * `derived.walkSpeed` are the ITEM contributions only. The stat / level /
 * class terms (Dex/5 armour, level + Dex/2 to-hit, Str·level/100 damage,
 * class block base, class life/mana) are added by combat_rolls.js and
 * player_stats.js `recalcPlayerBase(p, cls)`, which this calls last when
 * wired. `derived.display` carries the fully-summed numbers for the sheet.
 */
import { LOOT } from '../../data/balance/loot.js';
import { itemMeetsReq } from './itemgen.js';
import { getItemDeps } from './deps.js';
import { ensureSkills } from '../skills/skills.js';

const PCT = 100;
const EQUIP_SLOTS = ['head', 'body', 'weapon', 'offhand', 'ring1', 'ring2', 'amulet'];
const STAT_KEYS = ['str', 'mag', 'dex', 'vit'];
const REQ_KEYS = ['str', 'mag', 'dex'];
const RESISTS = [['fire', 'resFire'], ['cold', 'resCold'], ['shock', 'resShock'], ['arcane', 'resArcane']];
const ELEMENTS = ['Fire', 'Cold', 'Shock', 'Arcane'];
const ELEM_PREFIX = 'elemDmg';
const ELEM_MIN = 'Min';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** @returns {object} the class row for the player (theme) or the balance fallback */
export function classOf(game, p) {
  const list = (game.theme && game.theme.classes) || [];
  return list.find((c) => c.id === p.classId) || p._cls || LOOT.fallbackClass;
}

/** Distinct equipped items with their slot. @returns {{slot:string,item:object}[]} */
export function equippedItems(p) {
  const out = [];
  const seen = new Set();
  for (const slot of EQUIP_SLOTS) {
    const item = p.equipment && p.equipment[slot];
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      out.push({ slot, item });
    }
  }
  return out;
}

const effectsActive = (item) => item.identified || item.quality === 'normal';

function addEffects(into, from) {
  for (const k in from) into[k] = (into[k] || 0) + from[k];
}

/** Step 1: which equipped items are usable once the others' bonuses are counted. */
function resolveUsable(p, eq) {
  const usable = new Set(eq.map((e) => e.item.id));
  for (;;) {
    const bonus = { str: 0, mag: 0, dex: 0 };
    for (const { item } of eq) {
      if (!usable.has(item.id) || !effectsActive(item)) continue;
      for (const k of REQ_KEYS) bonus[k] += (item.effects[k] || 0) + (item.effects.allStats || 0);
    }
    const cur = {};
    for (const k of REQ_KEYS) cur[k] = Math.max(0, (p.base[k] || 0) + bonus[k]);
    let changed = false;
    for (const { item } of eq) {
      if (usable.has(item.id) && !itemMeetsReq(p, item, cur)) {
        usable.delete(item.id);
        changed = true;
      }
    }
    if (!changed) return usable;
  }
}

/** Fallback life/mana layering when entities/player.js is not wired. */
function layerPools(p, cls, cur, d) {
  const level = p.level || 1;
  const hpMax = cls.startLife + cls.lifePerLevel * (level - 1) + cls.lifePerVit * cur.vit + d.lifeFromItems;
  const mpMax = cls.startMana + cls.manaPerLevel * (level - 1) + cls.manaPerMag * cur.mag + d.manaFromItems;
  const dh = Math.floor(hpMax) - (p.hpMax || Math.floor(hpMax));
  const dm = Math.floor(mpMax) - (p.mpMax || Math.floor(mpMax));
  p.hpMax = clamp(Math.floor(hpMax), 1, LOOT.lifeManaCap);
  p.mpMax = clamp(Math.floor(mpMax), 0, LOOT.lifeManaCap);
  p.hp = typeof p.hp === 'number' ? clamp(p.hp + Math.max(0, dh), 0, p.hpMax) : p.hpMax;
  p.mp = typeof p.mp === 'number' ? clamp(p.mp + Math.max(0, dm), 0, p.mpMax) : p.mpMax;
  p.lightRadius = clamp(LOOT.lightRadiusBase + d.lightRadius, LOOT.lightRadiusMin, LOOT.lightRadiusMax);
}

/**
 * Rebuild `p.bonus`, `p.resist`, `p.derived` (and pools via recalcPlayerBase).
 * @param {object} game
 * @returns {object} p.derived
 */
export function recalcPlayer(game) {
  const p = game.player;
  const cls = classOf(game, p);
  const deps = getItemDeps();
  ensureSkills(game);
  const d = (p.derived = p.derived || {});
  const eq = equippedItems(p);
  const usable = resolveUsable(p, eq);
  for (const { item } of eq) item.usable = usable.has(item.id);

  // 2. aggregate item effects
  const eff = {};
  for (const { item } of eq) if (item.usable && effectsActive(item)) addEffects(eff, item.effects);

  // 3. stat bonuses (buffs are layered by combat_rolls.statTotal)
  p.bonus = {};
  const cur = {};
  for (const k of STAT_KEYS) {
    p.bonus[k] = (eff[k] || 0) + (eff.allStats || 0);
    cur[k] = clamp((p.base[k] || 0) + p.bonus[k], 0, LOOT.statMax);
  }

  // weapon / shield context
  const weapon = p.equipment.weapon;
  const wUsable = !!(weapon && weapon.usable);
  const shield = p.equipment.offhand;
  const hasShield = !!(shield && shield.usable && shield.type === 'shield');
  const wtype = wUsable ? weapon.type : null;
  const ranged = wtype === 'bow';

  // item contributions
  d.toHit = eff.toHit || 0;
  let armorAc = 0;
  for (const { item } of eq) if (item.usable && typeof item.ac === 'number') armorAc += item.ac;
  d.ac = Math.floor(armorAc * (1 + (eff.acPct || 0) / PCT)) + (eff.ac || 0);
  const dmgMult = 1 + (eff.dmgPct || 0) / PCT;
  const flat = eff.dmgFlat || 0;
  let wmin = 0;
  let wmax = 0;
  if (wUsable && weapon.dmg) {
    wmin = weapon.dmg.min;
    wmax = weapon.dmg.max;
  } else if (hasShield) {
    [wmin, wmax] = LOOT.shieldOnlyDmg;
  }
  if (wmax > 0) {
    d.dmgMin = Math.max(1, Math.floor(wmin * dmgMult + flat));
    d.dmgMax = Math.max(d.dmgMin, Math.floor(wmax * dmgMult + flat));
  } else {
    d.dmgMin = 0;
    d.dmgMax = 0;
  }
  d.blockPct = eff.blockPct || 0;
  d.canBlock = hasShield;
  d.lifeFromItems = eff.life || 0;
  d.manaFromItems = eff.mana || 0;
  d.lightRadius = eff.lightRadius || 0;
  d.walkSpeed = eff.walkSpeed || 0;
  d.attackSpeed = clamp(eff.attackSpeed || 0, 0, LOOT.attackSpeedMax);
  d.hitRecover = clamp(eff.hitRecover || 0, 0, LOOT.hitRecoverMax);
  d.manaCostPct = eff.manaCostPct || 0;
  d.spellLevels = clamp(eff.spellLevels || 0, -LOOT.maxSpellLevelBonus, LOOT.maxSpellLevelBonus);
  d.lifeSteal = eff.lifeSteal || 0;
  d.manaSteal = eff.manaSteal || 0;
  d.thorns = eff.thorns || 0;
  d.knockback = !!eff.knockback;
  d.elemDmg = {};
  for (const el of ELEMENTS) {
    const max = eff[ELEM_PREFIX + el] || 0;
    if (max > 0) d.elemDmg[el.toLowerCase()] = { min: Math.max(1, eff[ELEM_PREFIX + el + ELEM_MIN] || 1), max };
  }
  d.weaponType = wtype;
  d.weaponSpeed = wUsable ? weapon.speed : 'normal';
  d.twoHanded = wUsable && !!weapon.twoHanded;
  d.hasShield = hasShield;
  d.ranged = ranged;
  d.effects = eff;

  // resists (percent, capped)
  const rb = p.resistBase || {};
  p.resist = p.resist || {};
  for (const [key, stat] of RESISTS) p.resist[key] = clamp((rb[key] || 0) + (eff[stat] || 0) + (eff.resAll || 0), 0, LOOT.resistCap);

  // fully summed numbers for the character sheet
  const level = p.level || 1;
  const pref = cls.weaponPref || 'melee';
  const div = LOOT.dmgModDivisor[pref] || LOOT.dmgModDivisor.melee;
  let mod = pref === 'ranged' ? (level * (cur.str + cur.dex)) / div : (level * cur.str) / div;
  if (ranged && pref !== 'ranged') mod *= LOOT.offPrefWeaponDmgMult;
  const [umin, umax] = LOOT.unarmedDmg;
  d.display = {
    toHit: cls.toHitBase + level + (ranged ? cur.dex : Math.floor(cur.dex / LOOT.meleeToHitDexDivisor)) + d.toHit,
    ac: d.ac + Math.floor(cur.dex / LOOT.dexPerAc),
    dmgMin: Math.floor((d.dmgMax > 0 ? d.dmgMin : umin) + mod),
    dmgMax: Math.floor((d.dmgMax > 0 ? d.dmgMax : umax) + mod),
    blockChance: hasShield ? clamp(cur.dex + (cls.blockBase || 0) + LOOT.blockPerLevel * level + d.blockPct, 0, PCT) : 0,
    stats: cur,
  };

  if (deps.recalcPlayerBase) deps.recalcPlayerBase(p, cls);
  else layerPools(p, cls, cur, d);
  return d;
}

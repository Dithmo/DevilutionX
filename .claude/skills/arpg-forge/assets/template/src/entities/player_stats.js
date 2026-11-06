/**
 * Player creation, derived pools, XP/levels, stat points, buffs, regen,
 * death/respawn and teleport. No imports from sibling systems (items,
 * skills, missiles) so it can be unit-tested standalone.
 *
 * Life/mana formula (see data/balance/progression.js and the class file):
 *   hpMax = startLife + lifePerLevel*(lvl-1) + lifePerVit*vit + derived.lifeFromItems + buffs(life)
 *   mpMax = startMana + manaPerLevel*(lvl-1) + manaPerMag*mag + derived.manaFromItems + buffs(mana)
 * `p._cls` is a non-enumerable reference to the theme class (not serialized);
 * call bindPlayerClass(game, p) after loading a save.
 */
import * as P from '../../data/balance/progression.js';
import { setAnim, ANIM_FRAMES } from './anim.js';
import { isWalkable, inBounds, idx } from '../world/tiles.js';
import { statTotal, buffTotal, clamp, playerArmor, playerToHit, blockChance, playerDamageRange } from './combat_rolls.js';

const STATS = ['str', 'mag', 'dex', 'vit'];
const ELEMENTS = ['fire', 'cold', 'shock', 'arcane'];
const EQUIP_SLOTS = ['head', 'body', 'weapon', 'offhand', 'ring1', 'ring2', 'amulet'];
const INV_W = 10;
const INV_H = 4;
const BELT_SLOTS = 8;
const HOTKEYS = 4;
const TELEPORT_SEARCH_RADIUS = 3;
const MIN_MOVE_MULT = 0.5;
const PCT = 100;
const HALF = 0.5;

/**
 * Rebuild everything stat-derived: the full item pipeline when the host
 * installed `game.hooks.recalcPlayer` (items/inventory.js recalcPlayer, which
 * itself calls recalcPlayerBase first), otherwise just the base pools.
 */
export function fullRecalc(game, p) {
  if (game.hooks && typeof game.hooks.recalcPlayer === 'function') game.hooks.recalcPlayer(game);
  else recalcPlayerBase(p, classDef(game, p));
}

/** Theme class definition for a player. @returns {object} */
export function classDef(game, p) {
  return p._cls || game.theme.classes.find((c) => c.id === p.classId);
}

/** Attach the (non-serialized) class reference. @returns {object} the class */
export function bindPlayerClass(game, p) {
  const cls = game.theme.classes.find((c) => c.id === p.classId);
  if (!cls) throw new Error(`unknown class ${p.classId}`);
  Object.defineProperty(p, '_cls', { value: cls, enumerable: false, writable: true, configurable: true });
  return cls;
}

/**
 * Create a level-1 player without items (player.js adds the start kit).
 * @param {object} game
 * @param {string} classId
 * @param {string} name
 * @returns {object} Player
 */
export function createPlayerBase(game, classId, name) {
  if (!(game.nextId >= 1)) game.nextId = 1;
  const p = {
    id: game.nextId++, kind: 'player', classId, name,
    tx: 0, ty: 0, ox: 0, oy: 0, dir: 0,
    anim: 'stand', frame: 0, frameTicks: 1, frameAcc: 0, frames: 1, actionFrame: -1,
    path: null, walk: null, moveSpeed: P.BASE_MOVE_SPEED,
    hp: 0, hpMax: 0, dead: false, look: null, flash: 0,
    level: 1, xp: 0, statPoints: 0,
    base: null, bonus: { str: 0, mag: 0, dex: 0, vit: 0 },
    mp: 0, mpMax: 0, gold: P.START_GOLD,
    resist: { fire: 0, cold: 0, shock: 0, arcane: 0 },
    derived: { toHit: 0, ac: 0, dmgMin: 0, dmgMax: 0, blockChance: 0, lifeFromItems: 0, manaFromItems: 0 },
    equipment: {}, inventory: { w: INV_W, h: INV_H, cells: new Int32Array(INV_W * INV_H), items: {} },
    belt: new Array(BELT_SLOTS).fill(null),
    skills: {}, selectedSkill: null, hotkeys: new Array(HOTKEYS).fill(null),
    state: { hitRecoverTicks: 0, invulnTicks: 0, manaShield: 0, buffs: [], regenAcc: 0 },
    intent: null, action: null, deathTicks: 0, portalLevel: 0,
    lightRadius: P.LIGHT_RADIUS_DEFAULT,
  };
  const cls = bindPlayerClass(game, p);
  p.base = { ...cls.base };
  p.look = { ...cls.look };
  for (const s of EQUIP_SLOTS) p.equipment[s] = null;
  if (cls.startSkill) {
    p.skills[cls.startSkill] = 1;
    p.selectedSkill = cls.startSkill;
    p.hotkeys[0] = cls.startSkill;
  }
  recalcPlayerBase(p, cls);
  p.hp = p.hpMax;
  p.mp = p.mpMax;
  return p;
}

/**
 * Rebuild hpMax/mpMax/moveSpeed/lightRadius from class, level, stats (base +
 * item bonus + buffs), the item-only totals in p.derived and buffs. Current
 * hp/mp grow with the max and are clamped to it. items/recalc.js calls this
 * last after filling derived.
 * @param {object} p
 * @param {object} [cls] class def (defaults to p._cls)
 */
export function recalcPlayerBase(target, cls) {
  const p = target && target.player ? target.player : target; // items/recalc.js may pass (game) or (p, cls)
  if (!cls) cls = p._cls;
  const d = p.derived || (p.derived = {});
  const lvl = p.level - 1;
  const hpMax = clamp(Math.floor(cls.startLife + cls.lifePerLevel * lvl + cls.lifePerVit * statTotal(p, 'vit')
    + (d.lifeFromItems || 0) + buffTotal(p, 'life')), 1, P.LIFE_MANA_CAP);
  const mpMax = clamp(Math.floor(cls.startMana + cls.manaPerLevel * lvl + cls.manaPerMag * statTotal(p, 'mag')
    + (d.manaFromItems || 0) + buffTotal(p, 'mana')), 0, P.LIFE_MANA_CAP);
  const dh = hpMax - (p.hpMax || hpMax);
  const dm = mpMax - (p.mpMax || mpMax);
  p.hpMax = hpMax;
  p.mpMax = mpMax;
  p.hp = clamp(p.hp + Math.max(0, dh), 0, hpMax);
  p.mp = clamp(p.mp + Math.max(0, dm), 0, mpMax);
  for (const el of ELEMENTS) p.resist[el] = clamp(p.resist[el] || 0, 0, P.MAX_RESIST);
  const walkMult = clamp(1 + ((d.walkSpeed || 0) + buffTotal(p, 'walkSpeed')) / P.WALK_SPEED_PCT_DIV, MIN_MOVE_MULT, P.MAX_MOVE_SPEED_MULT);
  p.moveSpeed = P.BASE_MOVE_SPEED * walkMult;
  p.lightRadius = clamp(P.LIGHT_RADIUS_DEFAULT + (d.lightRadius || 0) + buffTotal(p, 'lightRadius'), P.LIGHT_RADIUS_MIN, P.LIGHT_RADIUS_MAX);
}

/**
 * Award (already level-scaled) XP; loops level-ups. Use
 * progression.xpForMonster() to scale a kill first.
 * @param {object} game
 * @param {number} amount
 */
export function giveXp(game, amount) {
  const p = game.player;
  if (!p || p.dead || p.level >= P.MAX_LEVEL) return;
  const add = Math.max(0, Math.floor(amount));
  if (add <= 0) return;
  p.xp = Math.min(p.xp + add, P.xpThreshold(P.MAX_LEVEL));
  while (p.level < P.MAX_LEVEL && p.xp >= P.xpThreshold(p.level)) levelUp(game);
}

/** Headroom left under the class stat caps. @returns {number} */
function capHeadroom(p, cls) {
  let h = 0;
  for (const s of STATS) h += Math.max(0, cls.max[s] - p.base[s]);
  return h;
}

/**
 * Level up: +5 stat points (capped by remaining stat headroom), pools grow,
 * full heal, class level skills, `levelUp` event.
 * @param {object} game
 */
export function levelUp(game) {
  const p = game.player;
  const cls = classDef(game, p);
  if (p.level >= P.MAX_LEVEL) return;
  p.level += 1;
  p.statPoints += Math.max(0, Math.min(P.STAT_POINTS_PER_LEVEL, capHeadroom(p, cls) - p.statPoints));
  fullRecalc(game, p);
  p.hp = p.hpMax;
  p.mp = p.mpMax;
  const learned = cls.levelSkills && cls.levelSkills[p.level];
  if (learned && !(p.skills[learned] >= 1)) {
    p.skills[learned] = 1;
    const def = (game.theme.skills || []).find((sk) => sk.id === learned);
    game.bus.emit('message', { text: `You learned ${def && def.name ? def.name : learned.replace(/_/g, ' ')}.`, color: game.theme.palette.good });
  }
  game.bus.emit('sfx', { name: 'levelup' });
  game.bus.emit('message', { text: `You have reached level ${p.level}.`, color: game.theme.palette.xp });
  game.bus.emit('levelUp', { level: p.level });
}

/**
 * Spend one stat point. @returns {boolean} spent
 */
export function spendStat(game, stat) {
  const p = game.player;
  const cls = classDef(game, p);
  if (!STATS.includes(stat) || p.statPoints <= 0 || p.base[stat] >= cls.max[stat]) return false;
  p.base[stat] += 1;
  p.statPoints -= 1;
  fullRecalc(game, p);
  return true;
}

/**
 * Permanently raise a base stat (elixirs); clamped to the class cap.
 * @returns {number} points actually added
 */
export function modifyBaseStat(game, p, stat, delta) {
  const cls = classDef(game, p);
  if (!STATS.includes(stat)) return 0;
  const d = clamp(delta, -p.base[stat], cls.max[stat] - p.base[stat]);
  p.base[stat] += d;
  fullRecalc(game, p);
  return d;
}

/**
 * Apply a timed buff; re-applying the same id refreshes it (no stacking).
 * @param {object} game
 * @param {object} p
 * @param {{id:string, stat:string, value:number, duration?:number, ticks?:number, data?:object}} buff
 */
export function applyBuff(game, p, buff) {
  const buffs = p.state.buffs;
  const ticks = buff.duration !== undefined ? buff.duration : buff.ticks;
  const existing = buffs.find((b) => b.id === buff.id);
  const data = { stat: buff.stat, value: buff.value, ...(buff.data || {}) };
  if (existing) {
    existing.ticksLeft = ticks;
    existing.data = data;
  } else {
    buffs.push({ id: buff.id, ticksLeft: ticks, data });
  }
  fullRecalc(game, p);
}

/** Count down buffs; drop expired ones. */
export function tickBuffs(game, p) {
  const buffs = p.state.buffs;
  if (!buffs.length) return;
  let changed = false;
  for (let i = buffs.length - 1; i >= 0; i--) {
    buffs[i].ticksLeft -= 1;
    if (buffs[i].ticksLeft <= 0) {
      buffs.splice(i, 1);
      changed = true;
    }
  }
  if (changed) fullRecalc(game, p);
}

/** Slow mana regen when the balance enables it (off by default). */
export function regenTick(game, p) {
  const regen = (game.balance && game.balance.manaRegen) || P.MANA_REGEN;
  if (!regen.enabled || p.mp >= p.mpMax) return;
  p.state.regenAcc = (p.state.regenAcc || 0) + 1;
  if (p.state.regenAcc >= regen.ticksPerPoint) {
    p.state.regenAcc = 0;
    p.mp = Math.min(p.mpMax, p.mp + 1);
  }
}

/**
 * Kill the player: death anim, mode 'dead', themed death line.
 * @param {object} game
 */
export function playerDie(game) {
  const p = game.player;
  if (p.dead) return;
  const cls = classDef(game, p);
  p.dead = true;
  p.hp = 0;
  p.path = null;
  p.walk = null;
  p.intent = null;
  p.action = null;
  p.ox = 0;
  p.oy = 0;
  p.deathTicks = 0;
  setAnim(p, 'death', cls.frames.death, ANIM_FRAMES.death);
  game.mode = 'dead';
  if (game.stats) game.stats.deaths = (game.stats.deaths || 0) + 1;
  const lines = (game.theme.flavor && game.theme.flavor.deathLines) || [];
  const text = lines.length ? game.rng.pick(lines) : 'You have died.';
  game.bus.emit('sfx', { name: 'die' });
  game.bus.emit('message', { text, color: game.theme.palette.danger });
  game.bus.emit('playerDied', { player: p });
}

/**
 * Revive after death (reference: HP 1, mana 0, half gold lost). The caller
 * moves the player to town and sets game.mode.
 * @param {object} game
 */
export function respawnPlayer(game) {
  const p = game.player;
  p.dead = false;
  p.hp = P.RESPAWN_HP;
  p.mp = 0;
  p.gold = Math.floor(p.gold * (1 - P.DEATH_GOLD_LOSS_FRAC));
  p.state.hitRecoverTicks = 0;
  p.state.manaShield = 0;
  p.state.buffs = [];
  p.state.invulnTicks = P.ARRIVAL_INVULN_TICKS;
  p.deathTicks = 0;
  setAnim(p, 'stand');
  fullRecalc(game, p);
}

/**
 * Place the player on (tx,ty) or the nearest free tile within 3, updating
 * occupancy and cancelling movement.
 * @returns {{x:number,y:number}} tile used
 */
export function teleportPlayer(game, tx, ty) {
  const p = game.player;
  const level = game.level;
  const tiles = level.tiles;
  const occ = level.occupant;
  const free = (x, y) => inBounds(tiles, x, y) && isWalkable(tiles, x, y) && (occ[idx(tiles, x, y)] === 0 || occ[idx(tiles, x, y)] === p.id);
  let dest = null;
  for (let r = 0; r <= TELEPORT_SEARCH_RADIUS && !dest; r++) {
    for (let dy = -r; dy <= r && !dest; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (free(tx + dx, ty + dy)) { dest = { x: tx + dx, y: ty + dy }; break; }
      }
    }
  }
  if (!dest) dest = { x: tx, y: ty };
  if (inBounds(tiles, p.tx, p.ty) && occ[idx(tiles, p.tx, p.ty)] === p.id) occ[idx(tiles, p.tx, p.ty)] = 0;
  if (p.walk && inBounds(tiles, p.walk.x, p.walk.y) && occ[idx(tiles, p.walk.x, p.walk.y)] === p.id) occ[idx(tiles, p.walk.x, p.walk.y)] = 0;
  p.tx = dest.x; p.ty = dest.y; p.ox = 0; p.oy = 0;
  p.walk = null; p.path = null; p.intent = null; p.action = null;
  p.prevX = p.tx + HALF; p.prevY = p.ty + HALF;
  if (inBounds(tiles, dest.x, dest.y)) occ[idx(tiles, dest.x, dest.y)] = p.id;
  if (!p.dead && p.anim !== 'stand') setAnim(p, 'stand');
  return dest;
}

/**
 * Numbers for the character panel.
 * @param {object} p
 * @returns {object}
 */
export function playerStatsSummary(p) {
  if (p && p.player && p.theme) { // called as (game)
    const game = p;
    p = game.player;
    if (!p._cls) bindPlayerClass(game, p);
  }
  const cls = p._cls;
  const dmg = playerDamageRange(p, cls);
  const stats = {};
  for (const s of STATS) stats[s] = { base: p.base[s], total: statTotal(p, s), max: cls.max[s] };
  return {
    name: p.name, className: cls.name, classId: p.classId, level: p.level,
    xp: p.xp, xpNext: p.level >= P.MAX_LEVEL ? null : P.xpThreshold(p.level), statPoints: p.statPoints,
    stats, hp: p.hp, hpMax: p.hpMax, mp: p.mpMax ? p.mp : 0, mpMax: p.mpMax, gold: p.gold,
    ac: playerArmor(p),
    toHit: playerToHit(p, cls),
    dmgMin: dmg.min, dmgMax: dmg.max,
    blockChance: blockChance(p, cls, p.level),
    canBlock: !!((p.derived && p.derived.canBlock) || (p.equipment.offhand && p.equipment.offhand.type === 'shield')),
    resist: { ...p.resist }, buffs: p.state.buffs.map((b) => ({ id: b.id, ticksLeft: b.ticksLeft })),
    percentHp: p.hpMax ? Math.round((p.hp * PCT) / p.hpMax) : 0,
  };
}

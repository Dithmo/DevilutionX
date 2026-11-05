/**
 * World objects: creation, per-tick update, interaction and altar effects.
 *
 * Objects are plain WorldObject records (docs/CONTRACTS.md). Door tiles are
 * flag-driven: a closed door sets SOLID|BLOCKS_LIGHT on its tile, opening
 * clears them. Loot, missiles and monsters go through the late-bound seams in
 * world/levelgen/deps.js so this module loads before those systems exist.
 * Emits `objectUsed`, `sfx`, `message`, `itemDropped` on game.bus.
 */
import { T, idx, setFlag, clearFlag, hasFlag, inBounds } from '../world/tiles.js';
import { freeTileNear, isWalkableLevel } from '../world/levelgen/grid.js';
import { deps } from '../world/levelgen/deps.js';
import { LEVELS } from '../../data/balance/levels.js';

const DEFAULT_STATE = { chest: 'closed', door: 'closed', breakable: 'intact', altar: 'active', lever: 'off', stairs: 'down', portal: 'active', sign: '', trap: 'armed', fountain: 'active', bookstand: 'closed' };
const PCT = 100;
const DROP_SEARCH = 3;
const EXPLODE_ELEMENT = 'fire';
const TRAP_ELEMENT = 'phys';
const MANA_DRAIN_FLOOR = 1;
const typeCache = new WeakMap();

const bal = (game) => game.balance?.levels?.objects || LEVELS.objects;
const palette = (game) => game.theme?.palette || {};
const msg = (game, text, color) => game.bus?.emit('message', { text, color: color || palette(game).text });
const sfx = (game, name, o) => game.bus?.emit('sfx', { name, x: o?.tx, y: o?.ty });

/** @returns {Array<object>} ObjectType list of the active theme */
export function objectTypes(game) {
  const src = game.theme?.objects;
  return Array.isArray(src) ? src : src?.objects || [];
}

/** @returns {object|undefined} ObjectType by id (cached per theme) */
export function objectTypeById(game, id) {
  let map = typeCache.get(game.theme);
  if (!map) { map = new Map(objectTypes(game).map((t) => [t.id, t])); typeCache.set(game.theme, map); }
  return map.get(id);
}

/** @returns {object|null} first non-removed object on the tile */
export function objectAt(level, x, y) {
  for (const o of level.objects) if (o.tx === x && o.ty === y && !o.removed) return o;
  return null;
}

/** @returns {boolean} the object blocks movement in its current state */
export function isObjectSolid(obj) {
  if (!obj || obj.removed) return false;
  if (obj.kind === 'door') return obj.state !== 'open';
  if (obj.kind === 'breakable') return obj.state !== 'broken';
  return !!obj.solid;
}

function doorOrient(tiles, x, y) {
  const wallish = (tx, ty) => inBounds(tiles, tx, ty) && (tiles.wall[idx(tiles, tx, ty)] > 0 || tiles.floor[idx(tiles, tx, ty)] === 0);
  return wallish(x - 1, y) && wallish(x + 1, y) ? 'left' : 'right';
}

/** Open or close a door: flips the object state and the tile's SOLID|BLOCKS_LIGHT flags. */
export function setDoorOpen(game, obj, open, level = game.level) {
  const tiles = level.tiles;
  obj.state = open ? 'open' : 'closed';
  obj.solid = !open;
  obj.blocksLight = !open;
  if (open) clearFlag(tiles, obj.tx, obj.ty, T.SOLID | T.BLOCKS_LIGHT);
  else setFlag(tiles, obj.tx, obj.ty, T.SOLID | T.BLOCKS_LIGHT);
  obj.openedTick = open ? game.tick : 0;
}

/**
 * Create a WorldObject from a theme ObjectType and add it to the level.
 * @param {object} game
 * @param {string} typeId
 * @param {number} tx
 * @param {number} ty
 * @param {{level?:object, state?:string, trapped?:boolean, explosive?:boolean, linkId?:string, locked?:boolean, text?:string, light?:number, lootLevel?:number, linkDepth?:number, questLoot?:object, look?:object}} [opts]
 * @returns {object} the object (also pushed to level.objects)
 */
export function createObject(game, typeId, tx, ty, opts = {}) {
  const level = opts.level || game.level;
  const type = objectTypeById(game, typeId) || { id: typeId, name: typeId, kind: 'sign', solid: true, look: {} };
  if (!game.nextId) game.nextId = 1;
  const obj = {
    id: game.nextId++, kind: type.kind, typeId: type.id, name: type.name, tx, ty, ox: 0, oy: 0,
    solid: !!type.solid, blocksLight: !!type.blocksLight, state: opts.state || DEFAULT_STATE[type.kind] || '',
    look: { ...type.look, ...(opts.look || {}) }, loot: null, trap: null, linkId: opts.linkId || null,
    text: opts.text || type.text || '', light: opts.light ?? type.light ?? 0, decor: !!type.decor, hidden: !!type.hidden,
    locked: !!opts.locked, explosive: !!opts.explosive, lootLevel: opts.lootLevel || level.depth || 1, lootSeed: game.rng.next(),
    linkDepth: opts.linkDepth ?? null, questLoot: opts.questLoot || null, effect: type.effect || null, removed: false,
  };
  if (type.lootTable) obj.loot = { count: game.rng.range(type.lootTable.count[0], type.lootTable.count[1]), quality: type.lootTable.goodChance || 0 };
  if (opts.trapped) obj.trap = { missile: type.trapMissile || 'bolt' };
  if (obj.kind === 'door') {
    obj.look.orient = doorOrient(level.tiles, tx, ty);
    setFlag(level.tiles, tx, ty, T.DOOR);
    setDoorOpen(game, obj, obj.state === 'open', level);
  }
  level.objects.push(obj);
  return obj;
}

/**
 * Put an item on the ground at the nearest free tile and register it on the level.
 * @returns {object|null} the GroundItem or null when nowhere to drop
 */
export function placeGroundItem(game, level, item, x, y) {
  if (!item) return null;
  const spot = freeTileNear(level, x, y, DROP_SEARCH, (tx, ty) => !level.items.some((it) => it.tx === tx && it.ty === ty)) || { x, y };
  item.tx = spot.x;
  item.ty = spot.y;
  item.dropTick = game.tick;
  level.items.push(item);
  game.bus?.emit('itemDropped', { item });
  return item;
}

function dropLoot(game, level, obj, count, goodChance) {
  for (let i = 0; i < count; i++) {
    const good = game.rng.chance(goodChance);
    const item = deps.generateItem?.(game, { level: obj.lootLevel, quality: good ? 'good' : 'any', source: obj.kind });
    placeGroundItem(game, level, item, obj.tx, obj.ty);
  }
}

function fireTrap(game, level, obj, player) {
  const b = bal(game);
  const tier = level.tier || 0;
  obj.trap = null;
  const dmg = { min: b.chestTrapDmg[0] + tier * b.chestTrapDmgPerTier, max: b.chestTrapDmg[1] + tier * b.chestTrapDmgPerTier };
  msg(game, `${obj.name} was trapped!`, palette(game).danger);
  sfx(game, 'bowShot', obj);
  if (deps.spawnMissile) {
    deps.spawnMissile(game, { archetype: 'bolt', owner: { kind: 'trap', id: obj.id }, from: { x: obj.tx, y: obj.ty }, to: { x: player.tx, y: player.ty }, skillId: null, level: obj.lootLevel, dmg, element: TRAP_ELEMENT, look: { color: '#c0c0c0' } });
  } else if (deps.applyDamageToPlayer) deps.applyDamageToPlayer(game, player, game.rng.range(dmg.min, dmg.max), TRAP_ELEMENT, obj);
}

/** Fire damage to everything in the explosion radius; chains to adjacent explosive breakables. */
export function explodeAt(game, level, x, y, source) {
  const b = bal(game);
  const r = b.explosionRadius;
  sfx(game, 'explode', { tx: x, ty: y });
  const p = game.player;
  if (p && Math.max(Math.abs(p.tx - x), Math.abs(p.ty - y)) <= r) {
    const dmg = game.rng.range(b.explosionDmgPlayer[0], b.explosionDmgPlayer[1]);
    if (deps.applyDamageToPlayer) deps.applyDamageToPlayer(game, p, dmg, EXPLODE_ELEMENT, source); else p.hp = Math.max(0, (p.hp || 0) - dmg);
  }
  for (const m of level.monsters) {
    if (m.dead || Math.max(Math.abs(m.tx - x), Math.abs(m.ty - y)) > r) continue;
    const dmg = game.rng.range(b.explosionDmgMonster[0], b.explosionDmgMonster[1]);
    if (deps.applyDamageToMonster) deps.applyDamageToMonster(game, m, dmg, EXPLODE_ELEMENT, source); else m.hp -= dmg;
  }
  for (const o of level.objects) {
    if (o === source || o.removed || o.kind !== 'breakable' || o.state === 'broken' || !o.explosive) continue;
    if (Math.max(Math.abs(o.tx - x), Math.abs(o.ty - y)) <= r) breakObject(game, level, o, null);
  }
}

function breakObject(game, level, obj, player) {
  if (obj.state === 'broken') return;
  obj.state = 'broken';
  obj.solid = false;
  sfx(game, 'drop', obj);
  const b = bal(game);
  if (obj.explosive) { explodeAt(game, level, obj.tx, obj.ty, obj); return; }
  if (game.rng.chance(b.breakableGoldPct)) placeGroundItem(game, level, deps.generateGold?.(game, obj.lootLevel), obj.tx, obj.ty);
  else if (game.rng.chance(b.breakableItemPct)) dropLoot(game, level, obj, 1, 0);
}

function openChest(game, level, obj, player) {
  if (obj.state === 'open') { msg(game, `The ${obj.name.toLowerCase()} is empty.`); return; }
  obj.state = 'open';
  sfx(game, 'open', obj);
  if (obj.trap) fireTrap(game, level, obj, player);
  if (obj.questLoot) { placeGroundItem(game, level, obj.questLoot, obj.tx, obj.ty); obj.questLoot = null; }
  dropLoot(game, level, obj, obj.loot ? obj.loot.count : 0, obj.loot ? obj.loot.quality : 0);
}

function pullLever(game, level, obj) {
  if (obj.state === 'on') return;
  obj.state = 'on';
  sfx(game, 'click', obj);
  let hits = 0;
  for (const o of level.objects) {
    if (o === obj || o.removed || !obj.linkId || o.linkId !== obj.linkId) continue;
    hits++;
    if (o.kind === 'door') { o.locked = false; setDoorOpen(game, o, true, level); }
    else if (o.kind === 'lever') o.state = 'on';
    else o.state = o.state === 'closed' ? 'open' : o.state;
  }
  msg(game, hits ? 'Something grinds open in the distance.' : 'The lever moves, and nothing answers.');
}

function pickAltarEffect(game) {
  const list = (game.theme?.altarEffects || game.theme?.objects?.altarEffects || []).filter((e) => bal(game).allowCrippling || !e.crippling);
  if (!list.length) return null;
  let total = 0;
  for (const e of list) total += e.weight || 1;
  let roll = game.rng.float() * total;
  for (const e of list) { roll -= e.weight || 1; if (roll < 0) return e; }
  return list[list.length - 1];
}

function useFountain(game, obj, player) {
  const b = bal(game);
  const hp = obj.effect?.hp ?? b.fountainHeal;
  const mp = obj.effect?.mp ?? b.fountainMana;
  if (player.hpMax) player.hp = Math.min(player.hpMax, (player.hp || 0) + hp);
  if (player.mpMax) player.mp = Math.min(player.mpMax, (player.mp || 0) + mp);
  sfx(game, 'potion', obj);
  msg(game, 'The water is cold and tastes faintly of stone.', palette(game).good);
}

function useBookstand(game, level, obj) {
  if (obj.state !== 'used') {
    obj.state = 'used';
    const tomes = (game.theme?.items?.consumables || []).filter((c) => c.kind === 'tome');
    const scrolls = (game.theme?.items?.consumables || []).filter((c) => c.kind === 'scroll');
    const pool = game.rng.chance(bal(game).bookstandTomePct) && tomes.length ? tomes : scrolls;
    const base = pool.length ? game.rng.pick(pool).id : undefined;
    placeGroundItem(game, level, deps.generateItem?.(game, { level: obj.lootLevel, baseId: base, quality: 'good', source: 'bookstand' }), obj.tx, obj.ty);
  }
  msg(game, obj.text);
}

/**
 * Player uses an object. Dispatches by kind and emits `objectUsed`.
 * @param {object} game
 * @param {object} obj
 * @param {object} player
 * @returns {boolean} true when something happened
 */
export function interactObject(game, obj, player) {
  const level = game.level;
  if (!obj || obj.removed) return false;
  if (obj.decor) { msg(game, obj.text); game.bus?.emit('objectUsed', { obj }); return true; }
  switch (obj.kind) {
    case 'chest': openChest(game, level, obj, player); break;
    case 'breakable': breakObject(game, level, obj, player); break;
    case 'door':
      if (obj.locked) { msg(game, 'Locked. Something elsewhere must release it.'); sfx(game, 'error', obj); return true; }
      if (obj.state === 'open' && (level.occupant?.[idx(level.tiles, obj.tx, obj.ty)] || level.items.some((it) => it.tx === obj.tx && it.ty === obj.ty))) { msg(game, 'Something blocks the door.'); return true; }
      setDoorOpen(game, obj, obj.state !== 'open', level);
      sfx(game, obj.state === 'open' ? 'open' : 'close', obj);
      break;
    case 'altar': {
      if (obj.state === 'used') { msg(game, 'The altar is silent now.'); return true; }
      const effect = pickAltarEffect(game);
      obj.state = 'used';
      sfx(game, 'cast', obj);
      if (effect) applyAltarEffect(game, effect, obj);
      break;
    }
    case 'lever': pullLever(game, level, obj); break;
    case 'stairs': if (game.hooks?.onStairs) game.hooks.onStairs(game, obj); else game.bus?.emit('useStairs', { obj }); break;
    case 'portal': if (game.hooks?.onPortal) game.hooks.onPortal(game, obj); else game.bus?.emit('usePortal', { obj }); break;
    case 'fountain': useFountain(game, obj, player); break;
    case 'bookstand': useBookstand(game, level, obj); break;
    case 'trap': if (obj.state === 'armed') { fireTrap(game, level, obj, player); obj.state = 'used'; } break;
    default: msg(game, obj.text || `${obj.name}.`); break;
  }
  game.bus?.emit('objectUsed', { obj });
  return true;
}

/** Per-tick: hidden floor traps, optional door auto-close, cosmetic light flicker. */
export function updateObjects(game) {
  const level = game.level;
  if (!level) return;
  const b = bal(game);
  const p = game.player;
  for (const o of level.objects) {
    if (o.removed) continue;
    if (o.light) o.flicker = ((game.tick + o.id) % b.flickerPeriod === 0) ? 1 : 0;
    if (o.kind === 'portal') o.look.frame = game.tick;
    if (o.kind === 'trap' && o.state === 'armed' && p && p.tx === o.tx && p.ty === o.ty) { fireTrap(game, level, o, p); o.state = 'used'; o.hidden = false; }
    if (o.kind === 'door' && o.state === 'open' && b.doorAutoCloseTicks > 0 && game.tick - o.openedTick > b.doorAutoCloseTicks
      && !level.occupant?.[idx(level.tiles, o.tx, o.ty)]) setDoorOpen(game, o, false, level);
  }
}

const STATS = ['str', 'mag', 'dex', 'vit'];
const RESISTS = ['fire', 'cold', 'shock', 'arcane'];

function equippedItems(p) {
  return Object.values(p.equipment || {}).filter(Boolean);
}
function carriedItems(p) {
  return [...equippedItems(p), ...Object.values(p.inventory?.items || {}), ...(p.belt || []).filter(Boolean)];
}

const ALTAR = {
  healFull(game, p) { if (p.hpMax) p.hp = p.hpMax; },
  manaFull(game, p) { if (p.mpMax) p.mp = p.mpMax; },
  swapStats(game, p, params, b) {
    if (!p.base) return;
    for (const s of STATS) p.base[s] = Math.max(1, (p.base[s] || 1) - (params.drain ?? b.altarStatSwap.drain));
    const s = game.rng.pick(STATS);
    p.base[s] += params.boost ?? b.altarStatSwap.boost;
  },
  randomResist(game, p, params, b) {
    if (!p.resist) p.resist = {};
    const r = game.rng.pick(RESISTS);
    p.resist[r] = Math.min(b.altarResistCap, (p.resist[r] || 0) + (params.amount ?? b.altarResistAmount));
  },
  dropGold(game, p, params, b, obj) {
    const range = params.piles || b.altarGoldPiles;
    const n = game.rng.range(range[0], range[1]);
    for (let i = 0; i < n; i++) placeGroundItem(game, game.level, deps.generateGold?.(game, game.level.depth), obj.tx, obj.ty);
  },
  identifyAll(game, p) { for (const it of carriedItems(p)) { if (deps.identify) deps.identify(it); else it.identified = true; } },
  curseItem(game, p, params, b) {
    const it = game.rng.pick(equippedItems(p));
    if (!it) return;
    it.cursed = true;
    if (it.dur) { it.dur.max = Math.max(1, it.dur.max - (params.durability ?? b.altarDurability.curse)); it.dur.cur = Math.min(it.dur.cur, it.dur.max); }
  },
  blessItem(game, p, params, b) {
    for (const it of equippedItems(p)) if (it.dur) { it.dur.max += params.durability ?? b.altarDurability.bless; it.dur.cur = it.dur.max; }
  },
  levelUpSkill(game, p, params, b) {
    const ids = Object.keys(p.skills || {});
    if (!ids.length) return;
    const id = game.rng.pick(ids);
    p.skills[id] = Math.min(params.max ?? b.levelUpSkillMax, p.skills[id] + 1);
  },
  revealMap(game) { game.level.explored.fill(1); },
  spawnMonsters(game, p, params, b, obj) {
    const tier = (game.theme?.tiers || [])[game.level.tier];
    const typeId = tier ? game.rng.pick(tier.monsterPool) : null;
    const range = params.count || b.altarSpawnCount;
    const n = game.rng.range(range[0], range[1]);
    if (!typeId) return;
    if (deps.spawnPack) deps.spawnPack(game, typeId, obj.tx, obj.ty, { size: n, awake: true });
    else for (let i = 0; i < n; i++) { const s = freeTileNear(game.level, obj.tx, obj.ty, DROP_SEARCH, () => true); if (s) deps.spawnMonster?.(game, typeId, s.x, s.y, { awake: true }); }
  },
  teleport(game, p) {
    const tiles = game.level.tiles;
    for (let t = 0; t < PCT; t++) {
      const x = game.rng.rand(tiles.w);
      const y = game.rng.rand(tiles.h);
      if (!isWalkableLevel(game.level, x, y) || hasFlag(tiles, x, y, T.DOOR)) continue;
      if (deps.teleportPlayer) deps.teleportPlayer(game, x, y); else { p.tx = x; p.ty = y; p.ox = 0; p.oy = 0; p.path = null; }
      return;
    }
  },
  buffDamage(game, p, params, b) {
    if (!p.state) p.state = { buffs: [] };
    if (!p.state.buffs) p.state.buffs = [];
    p.state.buffs.push({ id: 'altar_dmg', ticksLeft: params.ticks ?? b.altarBuffTicks, data: { dmgPct: params.pct ?? b.altarBuffDmgPct } });
  },
  drainMana(game, p, params, b) {
    p.mp = 0;
    if (p.mpMax) p.mpMax = Math.max(MANA_DRAIN_FLOOR, Math.round(p.mpMax * (1 - (params.pct ?? b.altarDrainPct) / PCT)));
  },
};

/**
 * Apply an AltarEffect to the player and print its text.
 * @param {object} game
 * @param {{id:string,text:string,apply:string,params?:object}} effect
 * @param {object} [obj] the altar (for effects that place things)
 * @returns {boolean} false when the vocabulary word is unknown
 */
export function applyAltarEffect(game, effect, obj = { tx: game.player?.tx || 0, ty: game.player?.ty || 0 }) {
  const fn = ALTAR[effect.apply];
  const p = game.player || {};
  if (!fn) { msg(game, effect.text); return false; }
  fn(game, p, effect.params || {}, bal(game), obj);
  deps.recalcPlayer?.(game);
  msg(game, effect.text, effect.crippling ? palette(game).danger : palette(game).accent);
  game.bus?.emit('altarUsed', { effect, obj });
  return true;
}

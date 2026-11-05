/**
 * Monster entities: spawning (single, unique, pack, whole level), death /
 * XP / loot, and the shared queries other systems use. Per-tick behaviour
 * lives in monster_update.js and the archetype decisions in ai.js; both are
 * re-exported here so callers import one module.
 */
import { isWalkable } from '../world/tiles.js';
import { dist } from '../world/pathfind.js';
import { deps } from './monster_deps.js';
import { occupantAt, setOccupant, tileFree, findFreeTileNear, ringCrawl, nearestEnemy } from './monster_util.js';
import { startAnim, monsterStand } from './monster_update.js';

export { updateMonsters, monsterStep, monsterFacePlayer, monsterAttackPlayer, monsterShoot, onMonsterDamaged, monsterApproach, monsterRetreat } from './monster_update.js';
export { setMonsterDeps, loadMonsterDeps } from './monster_deps.js';

const FLAG_FIELDS = { opensDoors: 'opensDoors', noHitRecover: 'noHitRecover', noLoot: 'noLoot', knockback: 'knockback' };
const PCT = 100;
const VARIANT_SUFFIX = /_\d+$/;

function bal(game) {
  return game.balance.monsters;
}

/** @returns {Array<object>} the theme's MonsterType list (either theme shape) */
function typeList(game) {
  const t = game.theme.monsters;
  return Array.isArray(t) ? t : (t && t.monsters) || [];
}

/** @returns {Array<object>} the theme's UniqueMonster list */
function uniqueList(game) {
  const t = game.theme.monsters;
  return game.theme.uniqueMonsters || (t && t.uniques) || [];
}

/** @returns {object} MonsterType definition or throws */
export function monsterDef(game, typeId) {
  const def = typeList(game).find((d) => d.id === typeId);
  if (!def) throw new Error(`unknown monster type ${typeId}`);
  return def;
}

function nextId(game) {
  if (!game.nextId) game.nextId = 1;
  return game.nextId++;
}

/** @returns {number} 0..2 from `game.difficulty` (number or name, see balance `difficultyNames`) */
export function difficultyIndex(game) {
  const b = bal(game);
  const d = game.difficulty;
  const i = typeof d === 'string' ? b.difficultyNames.indexOf(d) : d | 0;
  return Math.max(0, Math.min(b.difficulty.length - 1, i));
}

/**
 * Create a monster of `typeId` at (tx,ty) (nearest free tile if occupied).
 * Rolls HP, applies difficulty scaling from balance by `game.difficulty`.
 * @param {object} game
 * @param {string} typeId
 * @param {number} tx
 * @param {number} ty
 * @param {{leaderId?:number, packId?:number, leashed?:boolean, hpMult?:number, intelligence?:number,
 *          ally?:boolean, ownerId?:number, lifeTicks?:number, unique?:object, noLoot?:boolean,
 *          stats?:{hp?:number,dmgMin?:number,dmgMax?:number,ac?:number,toHit?:number}}} [opts]
 * @returns {object|null} Monster, or null when no free tile exists nearby
 */
export function spawnMonster(game, typeId, tx, ty, opts = {}) {
  const b = bal(game);
  const level = game.level;
  const def = monsterDef(game, typeId);
  const spot = findFreeTileNear(level, tx, ty, b.crawlRadius);
  if (!spot) return null;
  const u = opts.unique || null;
  const diff = b.difficulty[difficultyIndex(game)];
  const rng = game.rng;
  const st = opts.stats || {};
  let hp = st.hp !== undefined ? st.hp : u && u.hp ? u.hp : rng.range(def.hp[0], def.hp[1]);
  hp = Math.max(1, Math.round(hp * b.hpMult * (opts.hpMult || 1)));
  hp = hp * diff.hpMult + diff.hpAdd;
  const dmgRange = u && u.dmg ? u.dmg : def.dmg;
  const scaleDmg = (d) => (d + diff.dmgPreAdd) * diff.dmgMult + diff.dmgAdd;
  const baseLevel = u ? u.level : def.level;
  const flags = new Set([...(def.flags || []), ...((u && u.flags) || [])]);
  const resist = { phys: 0, fire: 0, cold: 0, shock: 0, arcane: 0, ...def.resist, ...((u && u.resist) || {}) };
  const immune = new Set(Object.keys(resist).filter((k) => resist[k] >= 2));
  const xpBase = (def.xp + diff.xpPreAdd) * diff.xpMult;
  const m = {
    id: nextId(game), kind: 'monster', typeId, name: u ? u.name : def.name,
    tx: spot.x, ty: spot.y, ox: 0, oy: 0, dir: rng.rand(8),
    anim: 'stand', frame: 0, frameTicks: b.standFrameTicks, frameAcc: 0, frames: b.frames.stand,
    path: null, moveSpeed: 1 / Math.max(1, def.speed.walkTicksPerTile), stepT: 1,
    hp, hpMax: hp, lastHp: hp, dead: false, flash: 0,
    look: { ...def.look, ...((u && u.look) || {}) },
    level: baseLevel + diff.levelAdd, ai: (u && u.ai) || def.ai, aiState: {},
    dmgMin: st.dmgMin !== undefined ? st.dmgMin : scaleDmg(dmgRange[0]),
    dmgMax: st.dmgMax !== undefined ? st.dmgMax : scaleDmg(dmgRange[1]),
    ac: (st.ac !== undefined ? st.ac : def.ac) + diff.acAdd,
    toHit: (st.toHit !== undefined ? st.toHit : def.toHit) + diff.toHitAdd,
    xp: u ? xpBase * b.unique.xpMult : xpBase,
    resist, immune, flags,
    packId: opts.packId || 0, leaderId: opts.leaderId || 0, leashed: !!opts.leashed,
    mode: 'idle', awake: false, awakeTicks: 0, target: null, targetId: 0, lastSeenTick: -1, goal: 'normal', goalTicks: 0,
    hitRecoverTicks: 0, delayTicks: 0, standTicks: 0, justStepped: false, pathCount: 0, pending: null,
    size: def.look.size || 1, lootSeed: rng.next(), dropOverride: null, dropUniqueId: (u && u.dropUniqueId) || null,
    intelligence: opts.intelligence !== undefined ? opts.intelligence : def.intelligence || 0,
    speed: { ...def.speed }, missile: def.missile ? { archetype: def.missile.archetype, element: def.missile.element, dmg: def.missile.dmg ? def.missile.dmg.map(scaleDmg) : null } : null,
    special: def.special || null, sfx: def.sfx || {}, def,
    opensDoors: false, noHitRecover: false, noLoot: !!opts.noLoot, knockback: false,
    hidden: flags.has('hidden') || def.ai === 'ambusher', charging: false,
    ally: !!opts.ally, ownerId: opts.ownerId || 0, lifeTicks: opts.lifeTicks || 0,
    unique: u ? u.id : null, light: u ? b.unique.lightRadius : 0, regenAcc: 0,
  };
  for (const f of Object.keys(FLAG_FIELDS)) if (flags.has(f)) m[FLAG_FIELDS[f]] = true;
  if (m.ai === 'tank') { m.noHitRecover = true; m.knockback = true; }
  if (u) { flags.add('unique'); m.noHitRecover = m.noHitRecover || flags.has('boss'); }
  if (flags.has('ranged') || (m.missile && m.ai === 'ranged')) flags.add('ranged');
  setOccupant(level, m.tx, m.ty, m.id);
  monsterStand(game, m);
  m.frame = rng.rand(m.frames); // desync idle loops (ref §2.1)
  level.monsters.push(m);
  return m;
}

/**
 * Spawn `size` monsters of one type around (tx,ty): a leader on the centre
 * tile and followers on free tiles found by ring crawl. ref §2.5 PlaceGroup.
 * @returns {Array<object>} the monsters placed (leader first)
 */
export function spawnPack(game, typeId, tx, ty, size, opts = {}) {
  const b = bal(game);
  const out = [];
  const packId = nextId(game);
  const leader = opts.leader || spawnMonster(game, typeId, tx, ty, { ...opts, packId });
  if (!leader) return out;
  leader.packId = packId;
  if (size > 1) leader.flags.add('leader');
  out.push(leader);
  const want = opts.leader ? size : size - 1;
  const radius = b.pack.radius;
  ringCrawl(leader.tx, leader.ty, radius, (x, y) => {
    if (out.length > want) return true;
    if ((x === leader.tx && y === leader.ty) || !tileFree(game.level, x, y, 0, true)) return false;
    const f = spawnMonster(game, typeId, x, y, {
      packId, leaderId: leader.id, leashed: true, hpMult: opts.minionHpMult || 1,
      intelligence: opts.inheritInt ? leader.intelligence : undefined, ally: opts.ally,
    });
    if (f) out.push(f);
    return false;
  });
  return out;
}

/**
 * Spawn a UniqueMonster (theme uniques list) with its pack.
 * @returns {object|null}
 */
export function spawnUniqueMonster(game, uniqueId, tx, ty) {
  const b = bal(game);
  const u = uniqueList(game).find((d) => d.id === uniqueId);
  if (!u) throw new Error(`unknown unique monster ${uniqueId}`);
  const m = spawnMonster(game, u.baseTypeId, tx, ty, { unique: u });
  if (!m) return null;
  m.name = u.name;
  if (u.questId) m.questId = u.questId;
  if (u.packType && u.packType !== 'none') {
    const size = game.rng.range(b.unique.packSize[0], b.unique.packSize[1]);
    spawnPack(game, u.baseTypeId, m.tx, m.ty, size, {
      leader: m, minionHpMult: u.packType === 'elite' ? b.unique.minionHpMult : 1, inheritInt: true,
    });
  }
  return m;
}

/** @returns {Array<object>} live monsters within Chebyshev radius r of (x,y) */
export function monstersInRadius(level, x, y, r) {
  const out = [];
  for (const m of level.monsters) if (!m.dead && dist(m.tx, m.ty, x, y) <= r) out.push(m);
  return out;
}

/**
 * Make `m` aware of `source` (actor or {x,y}); the whole pack wakes with it.
 */
export function wakeMonster(game, m, source = null) {
  if (m.dead) return;
  const b = bal(game);
  const was = m.awake;
  m.awake = true;
  m.awakeTicks = b.awakeTicks;
  if (source && typeof source.tx === 'number') { m.target = { x: source.tx, y: source.ty }; m.targetId = source.id || 0; }
  else if (source && typeof source.x === 'number') m.target = { x: source.x, y: source.y };
  if (m.mode === 'idle') m.mode = 'chase';
  if (was) return;
  if (m.packId) {
    for (const o of game.level.monsters) {
      if (o !== m && !o.dead && o.packId === m.packId && !o.awake && dist(o.tx, o.ty, m.tx, m.ty) <= b.packWakeRadius) wakeMonster(game, o, source);
    }
  }
}

/** @returns {boolean} is an enemy within the wake radius with line of sight? */
export function monsterCanSee(game, m) {
  return nearestEnemy(game, m, bal(game).wakeRadius, true) !== null;
}

/** XP award for killing `m`, scaled by the level gap. */
function xpFor(game, m) {
  const b = bal(game).xp;
  const plvl = game.player ? game.player.level || 1 : 1;
  const mult = Math.max(b.minMult, Math.min(b.maxMult, 1 + ((m.level - plvl) * b.levelDiffPct) / PCT));
  return Math.round(m.xp * mult);
}

function itemTileFree(level, x, y) {
  return isWalkable(level.tiles, x, y) && !level.items.some((it) => it.tx === x && it.ty === y);
}

/** Drop `item` on the nearest item-free tile around (x,y). */
export function dropItemNear(game, item, x, y) {
  if (!item) return null;
  const level = game.level;
  const spot = ringCrawl(x, y, 2, (ix, iy) => itemTileFree(level, ix, iy)) || { x, y };
  item.tx = spot.x;
  item.ty = spot.y;
  item.dropTick = game.tick;
  level.items.push(item);
  game.bus.emit('itemDropped', { item });
  return item;
}

/** Loot roll. ref §9.3: 59% nothing / 31% gold / 10% item; uniques always a good item. @returns {object|null} */
function rollLoot(game, m) {
  const b = bal(game).loot;
  const level = m.def.level;
  if (m.dropUniqueId) return deps.generateItem(game, { level, quality: b.uniqueQuality, uniqueId: m.dropUniqueId, source: 'monster' });
  if (m.dropOverride) return deps.generateItem(game, { level, baseId: m.dropOverride, source: 'monster' });
  if (m.unique) return deps.generateItem(game, { level, quality: b.uniqueQuality, onlyGood: true, source: 'monster' });
  if (game.rng.rand(PCT) >= b.dropPct) return null;
  if (game.rng.rand(PCT) < b.goldPctOfDrop) return deps.generateGold(game, level);
  return deps.generateItem(game, { level, source: 'monster' });
}

/**
 * Kill a monster: death animation, free the tile, XP, loot, pack release,
 * `monsterKilled` event. Safe to call twice.
 * @param {object} game
 * @param {object} m
 * @param {object|null} killer player, ally monster, or null (environment)
 */
export function killMonster(game, m, killer) {
  if (m.dead) return;
  m.dead = true;
  m.hp = 0;
  m.mode = 'dead';
  m.pending = null;
  m.charging = false;
  m.hidden = false;
  m.deathTick = game.tick;
  m.path = null;
  m.ox = 0;
  m.oy = 0;
  startAnim(game, m, 'death', m.speed.deathTicks);
  if (occupantAt(game.level, m.tx, m.ty) === m.id) setOccupant(game.level, m.tx, m.ty, 0);
  game.bus.emit('sfx', { name: (m.sfx && m.sfx.die) || 'monsterDie', x: m.tx, y: m.ty });
  for (const o of game.level.monsters) if (o.leaderId === m.id) { o.leaderId = 0; o.leashed = false; }
  if (!m.ally) {
    const credited = killer && (killer.kind === 'player' || killer.ally);
    if (credited) deps.giveXp(game, xpFor(game, m));
    if (!m.noLoot) dropItemNear(game, rollLoot(game, m), m.tx, m.ty);
    if (game.stats) game.stats.kills = (game.stats.kills || 0) + 1;
  }
  game.bus.emit('monsterKilled', { m, killer });
}

/** Chebyshev distance from (x,y) to the nearest protected point (entry / stairs). */
function entryDistance(level, x, y) {
  let best = Infinity;
  const pts = [level.entry, level.stairs && level.stairs.up, level.stairs && level.stairs.down, level.stairs && level.stairs.town];
  for (const p of pts) if (p) best = Math.min(best, dist(x, y, p.x, p.y));
  return best;
}

function canSpawnAt(game, level, x, y) {
  return tileFree(level, x, y, 0, true) && entryDistance(level, x, y) >= bal(game).entryExclusion;
}

function randomSpawnTile(game, level) {
  const t = level.tiles;
  for (let i = 0; i < bal(game).placeAttempts; i++) {
    const x = game.rng.rand(t.w);
    const y = game.rng.rand(t.h);
    if (canSpawnAt(game, level, x, y)) return { x, y };
  }
  return null;
}

/** ref §2.4 pack size by depth: d1 lone; 50% lone; d2 → 2–3; deeper 3–5 (capped by the type's own range). */
function rollPackSize(game, def, depth) {
  const p = bal(game).pack;
  if (depth <= p.loneDepth || game.rng.chance(p.loneChance)) return 1;
  const r = depth <= p.smallPackDepth ? p.smallPack : p.bigPack;
  let n = game.rng.range(r[0], r[1]);
  if (def.pack && def.pack.size) n = Math.min(n, def.pack.size[1]);
  return Math.max(1, n);
}

function normaliseStamps(stamps) {
  if (!stamps) return [];
  return Array.isArray(stamps) ? stamps : Object.values(stamps);
}

/** A stamp's tile: its own x,y, else the centre of the room tagged with its quest / stamp kind. */
function stampTile(level, s) {
  if (typeof s.x === 'number' && typeof s.y === 'number') return { x: s.x, y: s.y };
  const room = (level.rooms || []).find((r) => (s.questId && r.questId === s.questId) || (s.stamp && r.kind === s.stamp));
  return room ? { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) } : null;
}

function uniqueWanted(game, tier, u) {
  if (tier && u.id === tier.bossId) return true;
  if (!u.questId || !game.quests || !game.quests[u.questId]) return true;
  return game.quests[u.questId].state === 'active';
}

function farRoomCentre(game, level) {
  const rooms = (level.rooms || []).filter((r) => entryDistance(level, r.x + (r.w >> 1), r.y + (r.h >> 1)) >= bal(game).entryExclusion);
  const r = game.rng.pick(rooms);
  return r ? { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) } : randomSpawnTile(game, level);
}

/**
 * Populate a freshly generated level: 3–6 types from the tier pool picked by
 * level window, packs until the budget is met, never near the entry, plus
 * quest/boss uniques (from `level.questStamps` positions when present).
 * @param {object} game
 * @param {object} level
 * @param {object} tier theme Tier
 * @returns {number} monsters placed (uniques' followers included)
 */
export function placeMonstersForLevel(game, level, tier) {
  const b = bal(game);
  const rng = game.rng;
  const prev = game.level;
  game.level = level;
  const depth = level.depth;
  const span = Math.max(1, tier.depths[1] - tier.depths[0]);
  const frac = Math.max(0, Math.min(1, (depth - tier.depths[0]) / span));
  const target = tier.monsterLevel[0] + frac * (tier.monsterLevel[1] - tier.monsterLevel[0]);
  const pool = tier.monsterPool.map((id) => monsterDef(game, id));
  let eligible = pool.filter((d) => Math.abs(d.level - target) <= b.levelWindow);
  if (eligible.length < b.typesPerLevel[0]) eligible = pool.slice();
  const nTypes = Math.min(eligible.length, rng.range(b.typesPerLevel[0], b.typesPerLevel[1]));
  const types = rng.shuffle(eligible.slice()).slice(0, nTypes);
  const budget = Math.min(b.maxPerLevel, b.perLevelBase + depth * b.perDepth);
  let placed = 0;
  let guard = b.placeAttempts * 4;
  while (placed < budget && types.length && guard-- > 0) {
    const def = rng.pick(types);
    const spot = randomSpawnTile(game, level);
    if (!spot) break;
    const size = Math.min(rollPackSize(game, def, depth), budget - placed);
    placed += size === 1 ? (spawnMonster(game, def.id, spot.x, spot.y) ? 1 : 0) : spawnPack(game, def.id, spot.x, spot.y, size).length;
  }
  const done = new Set(level.uniquesPlaced || []);
  for (const s of normaliseStamps(level.questStamps)) {
    const uid = s.uniqueId || s.uniqueMonsterId;
    if (!uid || done.has(uid)) continue;
    const u = uniqueList(game).find((d) => d.id === uid);
    const at = stampTile(level, s);
    if (!u || !at || !uniqueWanted(game, tier, u)) continue;
    const before = level.monsters.length;
    if (spawnUniqueMonster(game, uid, at.x, at.y)) { done.add(uid); placed += level.monsters.length - before; }
  }
  for (const u of uniqueList(game)) {
    if (u.depth !== depth || done.has(u.id) || !uniqueWanted(game, tier, u)) continue;
    const spot = farRoomCentre(game, level);
    const before = level.monsters.length;
    if (spot && spawnUniqueMonster(game, u.id, spot.x, spot.y)) { done.add(u.id); placed += level.monsters.length - before; }
  }
  level.uniquesPlaced = [...done];
  game.level = prev || level;
  return placed;
}

/** @returns {string} base type id without a `_2`/`_3` variant suffix */
export function baseTypeId(typeId) {
  return typeId.replace(VARIANT_SUFFIX, '');
}

export { tileFree, findFreeTileNear };

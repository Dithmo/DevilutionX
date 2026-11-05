/**
 * Level population (reference pipeline order): stairs → doors → quest room
 * reservation → themed room reservation → scattered objects → monsters →
 * scattered items → themed room furnishing → quest stamps → light list.
 *
 * Monsters/items come from the late-bound seams in deps.js; everything else
 * is created here via entities/objects.js. Rooms picked for themes or quest
 * stamps are flagged T.NO_SPAWN so random placement (ours and the monster
 * module's) stays out of them.
 */
import { T, idx, setFlag, hasFlag } from '../tiles.js';
import { freeTileNear, isWalkableLevel, isFloor, markNoSpawn, rectContains } from './grid.js';
import { createObject, placeGroundItem, objectTypes } from '../../entities/objects.js';
import { deps } from './deps.js';
import { LEVELS } from '../../../data/balance/levels.js';

export { freeTileNear };

const PCT = 100;
const NEAR = 3;
const HALF = 0.5;

const bal = (game) => game.balance?.levels || LEVELS;
const rangeOf = (rng, r) => rng.range(r[0], r[1]);

/** Item level for drops on this depth, interpolated across the tier's monsterLevel band. @returns {number} */
export function itemLevelFor(tier, depth) {
  const [d0, d1] = tier.depths;
  const [m0, m1] = tier.monsterLevel;
  const t = d1 > d0 ? (depth - d0) / (d1 - d0) : 0;
  return Math.max(1, Math.round(m0 + (m1 - m0) * t));
}

/** Object type ids of a kind allowed on this tier (objectPool first, then any type whose tilesets allow the level's tileset). */
function typesOfKind(game, level, tier, kind) {
  const all = objectTypes(game).filter((t) => t.kind === kind && !t.decor && (t.tilesets === 'all' || t.tilesets.includes(level.tilesetId)));
  const pooled = all.filter((t) => tier.objectPool.includes(t.id));
  return (pooled.length ? pooled : all).map((t) => t.id);
}

function tileFree(level, x, y, opts = {}) {
  const tiles = level.tiles;
  if (!isWalkableLevel(level, x, y)) return false;
  const f = tiles.flags[idx(tiles, x, y)];
  if (f & (T.DOOR | T.STAIRS_UP | T.STAIRS_DOWN)) return false;
  if (!opts.allowNoSpawn && (f & T.NO_SPAWN)) return false;
  if (level.objects.some((o) => o.tx === x && o.ty === y && !o.removed)) return false;
  if (level.items.some((it) => it.tx === x && it.ty === y)) return false;
  if (level.monsters.some((m) => m.tx === x && m.ty === y && !m.dead)) return false;
  const m = opts.margin || 0;
  for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) if (!isFloor(tiles, x + dx, y + dy)) return false;
  if (opts.nearDoor === false) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (hasFlag(tiles, x + dx, y + dy, T.DOOR)) return false;
  return true;
}

function randomFreeTile(level, rng, opts = {}) {
  const tries = opts.tries || bal(opts.game || {}).populate.placeTries;
  const r = opts.room;
  for (let t = 0; t < tries; t++) {
    const x = r ? r.x + rng.rand(r.w) : rng.range(1, level.tiles.w - 2);
    const y = r ? r.y + rng.rand(r.h) : rng.range(1, level.tiles.h - 2);
    if (tileFree(level, x, y, opts)) return { x, y };
  }
  return null;
}

function roomCentre(room) {
  return { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
}

function roomHasStairs(level, room) {
  const s = level.stairs;
  return [s.up, s.down].some((p) => p && rectContains(room, p.x, p.y));
}

function reserveRoom(level, room, kind) {
  room.kind = kind;
  room.reserved = true;
  for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) setFlag(level.tiles, x, y, T.NO_SPAWN);
}

function placeStairs(game, level, tier, rng) {
  const cfg = bal(game).stairs;
  const { up, down } = level.stairs;
  if (up) {
    setFlag(level.tiles, up.x, up.y, T.STAIRS_UP);
    createObject(game, 'stairs_up', up.x, up.y, { level, rng, state: 'up', linkDepth: level.depth - 1 });
    markNoSpawn(level.tiles, up.x, up.y, cfg.haloRadius);
  }
  if (down) {
    setFlag(level.tiles, down.x, down.y, T.STAIRS_DOWN);
    createObject(game, 'stairs_down', down.x, down.y, { level, rng, state: 'down', linkDepth: level.depth + 1 });
    markNoSpawn(level.tiles, down.x, down.y, cfg.haloRadius);
  }
}

function placeDoors(game, level, tier, rng) {
  const doorTypes = typesOfKind(game, level, tier, 'door');
  if (!doorTypes.length) return;
  for (const d of level.doorSpecs || []) {
    if (!hasFlag(level.tiles, d.x, d.y, T.DOOR) || level.objects.some((o) => o.tx === d.x && o.ty === d.y)) continue;
    createObject(game, rng.pick(doorTypes), d.x, d.y, { level, rng });
  }
}

/** Spawn n monsters of a type around a point (pack seam first, then singles). @returns {Array} */
function spawnGroup(game, level, typeId, x, y, n, opts = {}) {
  if (!typeId) return [];
  if (deps.spawnPack) return deps.spawnPack(game, typeId, x, y, n, opts) || [];
  const out = [];
  for (let i = 0; i < n && deps.spawnMonster; i++) {
    const s = freeTileNear(level, x, y, NEAR, (tx, ty) => !level.monsters.some((m) => m.tx === tx && m.ty === ty));
    if (!s) break;
    const m = deps.spawnMonster(game, typeId, s.x, s.y, opts);
    if (m) out.push(m);
  }
  return out;
}

function placeObjects(game, level, rng, typeIds, n, opts = {}) {
  const made = [];
  for (let i = 0; i < n && typeIds.length; i++) {
    const spot = randomFreeTile(level, rng, { game, ...opts });
    if (!spot) break;
    made.push(createObject(game, rng.pick(typeIds), spot.x, spot.y, { level, rng, ...(opts.create || {}) }));
  }
  return made;
}

function scatterObjects(game, level, tier, rng) {
  const cfg = bal(game).populate;
  const trapPct = cfg.chestTrapPctByTier[Math.min(level.tier, cfg.chestTrapPctByTier.length - 1)];
  const chestTypes = typesOfKind(game, level, tier, 'chest');
  for (let i = 0, n = rangeOf(rng, cfg.chests); i < n && chestTypes.length; i++) {
    const spot = randomFreeTile(level, rng, { game, margin: cfg.spawnMargin }) || randomFreeTile(level, rng, { game });
    if (!spot) break;
    const typeId = chestTypes.length > 1 && rng.chance(cfg.largeChestPct) ? chestTypes[chestTypes.length - 1] : chestTypes[0];
    createObject(game, typeId, spot.x, spot.y, { level, rng, trapped: rng.chance(trapPct), lootLevel: itemLevelFor(tier, level.depth) });
  }
  const breakTypes = typesOfKind(game, level, tier, 'breakable');
  let left = rangeOf(rng, cfg.breakables);
  while (left > 0 && breakTypes.length) {
    const first = randomFreeTile(level, rng, { game });
    if (!first) break;
    const size = Math.min(left, rangeOf(rng, cfg.breakableGroup));
    let cur = first;
    for (let k = 0; k < size; k++) {
      if (k > 0) {
        let next = null;
        for (let t = 0; t < cfg.breakableGrowTries && !next; t++) {
          const c = { x: cur.x + rng.range(-1, 1), y: cur.y + rng.range(-1, 1) };
          if (tileFree(level, c.x, c.y)) next = c;
        }
        if (!next) break;
        cur = next;
      }
      createObject(game, rng.pick(breakTypes), cur.x, cur.y, { level, rng, explosive: rng.chance(cfg.explosivePct), lootLevel: itemLevelFor(tier, level.depth) });
      left--;
    }
  }
  placeObjects(game, level, rng, typesOfKind(game, level, tier, 'altar'), rangeOf(rng, cfg.altars), { margin: cfg.spawnMargin });
  const texts = game.theme?.objectTexts?.signs || [];
  placeObjects(game, level, rng, typesOfKind(game, level, tier, 'sign'), rangeOf(rng, cfg.signs), { create: { text: rng.pick(texts) } });
  if (rng.chance(cfg.fountainPct)) placeObjects(game, level, rng, typesOfKind(game, level, tier, 'fountain'), 1, { margin: cfg.spawnMargin });
}

function scatterItems(game, level, tier, rng) {
  const cfg = bal(game).populate;
  const ilvl = itemLevelFor(tier, level.depth);
  for (let i = 0, n = rangeOf(rng, cfg.groundItems); i < n; i++) {
    const s = randomFreeTile(level, rng, { game });
    if (s) placeGroundItem(game, level, deps.generateItem?.(game, { level, rng: ilvl, quality: 'any', source: 'floor' }), s.x, s.y);
  }
  for (let i = 0, n = rangeOf(rng, cfg.goldPiles); i < n; i++) {
    const s = randomFreeTile(level, rng, { game });
    if (s) placeGroundItem(game, level, deps.generateGold?.(game, ilvl), s.x, s.y);
  }
}

/** Floor tile inside the room next to a wall with floor on both lateral sides (reference TFit_Shrine). */
function wallSpot(level, room, rng) {
  const t = level.tiles;
  const cands = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (!tileFree(level, x, y, { allowNoSpawn: true })) continue;
      const n = !isFloor(t, x, y - 1) && isFloor(t, x - 1, y) && isFloor(t, x + 1, y);
      const s = !isFloor(t, x, y + 1) && isFloor(t, x - 1, y) && isFloor(t, x + 1, y);
      const w = !isFloor(t, x - 1, y) && isFloor(t, x, y - 1) && isFloor(t, x, y + 1);
      const e = !isFloor(t, x + 1, y) && isFloor(t, x, y - 1) && isFloor(t, x, y + 1);
      if (n || s || w || e) cands.push({ x, y });
    }
  }
  return cands.length ? rng.pick(cands) : randomFreeTile(level, rng, { room, allowNoSpawn: true, game: null, tries: PCT });
}

function pickThemedRooms(game, level, tier, rng) {
  const cfg = bal(game).populate;
  const pool = (level.rooms || []).filter((r) => !r.reserved && r.w >= cfg.themedMinSize && r.h >= cfg.themedMinSize && r.kind !== 'hall' && !roomHasStairs(level, r));
  rng.shuffle(pool);
  const kinds = [...(tier.themedRooms || [])];
  const chosen = [];
  const n = Math.min(pool.length, rangeOf(rng, cfg.themedRooms));
  for (let i = 0; i < n && kinds.length; i++) {
    const kind = rng.pick(kinds);
    if (cfg.oneShotThemes.includes(kind)) kinds.splice(kinds.indexOf(kind), 1);
    reserveRoom(level, pool[i], kind);
    chosen.push(pool[i]);
  }
  return chosen;
}

function furnishThemedRoom(game, level, tier, room, rng) {
  const cfg = bal(game).populate;
  const ilvl = itemLevelFor(tier, level.depth);
  const inRoom = { room, allowNoSpawn: true, game };
  const put = (kind, n, extra = {}) => placeObjects(game, level, rng, typesOfKind(game, level, tier, kind), n, { ...inRoom, ...extra });
  const dropGood = (n) => { for (let i = 0; i < n; i++) { const s = randomFreeTile(level, rng, inRoom); if (s) placeGroundItem(game, level, deps.generateItem?.(game, { level, rng: ilvl, quality: 'good', onlyGood: true, source: room.kind }), s.x, s.y); } };
  const c = roomCentre(room);
  switch (room.kind) {
    case 'treasure':
      put('chest', rangeOf(rng, cfg.treasureChests), { create: { lootLevel: ilvl } });
      for (let i = 0, n = rangeOf(rng, cfg.treasureGold); i < n; i++) { const s = randomFreeTile(level, rng, inRoom); if (s) placeGroundItem(game, level, deps.generateGold?.(game, ilvl), s.x, s.y); }
      break;
    case 'library': {
      const texts = game.theme?.objectTexts?.bookstands || [];
      put('bookstand', rangeOf(rng, cfg.libraryStands), { create: { text: rng.pick(texts), lootLevel: ilvl } });
      dropGood(1);
      break;
    }
    case 'shrine': {
      const spot = wallSpot(level, room, rng);
      const altars = typesOfKind(game, level, tier, 'altar');
      if (spot && altars.length) createObject(game, rng.pick(altars), spot.x, spot.y, { level, rng });
      const braziers = objectTypes(game).filter((t) => t.decor && t.light && (t.tilesets === 'all' || t.tilesets.includes(level.tilesetId))).map((t) => t.id);
      placeObjects(game, level, rng, braziers, 2, inRoom);
      break;
    }
    case 'armory': dropGood(cfg.armoryDrops); put('breakable', rangeOf(rng, cfg.armoryCrates)); break;
    case 'barrel': put('breakable', rangeOf(rng, cfg.barrelRoom), { create: { lootLevel: ilvl } }); break;
    case 'monsterDen':
      spawnGroup(game, level, rng.pick(tier.monsterPool), c.x, c.y, rangeOf(rng, cfg.denPack));
      put('chest', 1, { create: { lootLevel: ilvl } });
      break;
    case 'torture': {
      const decor = objectTypes(game).filter((t) => t.decor && !t.light && (t.tilesets === 'all' || t.tilesets.includes(level.tilesetId))).map((t) => t.id);
      placeObjects(game, level, rng, decor, rangeOf(rng, cfg.tortureDecor), inRoom);
      if (rng.chance(cfg.tortureUniquePct) && deps.spawnMonster) deps.spawnMonster(game, rng.pick(tier.monsterPool), c.x, c.y, { hpMult: cfg.championHpMult, champion: true });
      break;
    }
    default: break;
  }
}

/** Normalise quest stamps from the quest layer: `{kind|stamp, questId, uniqueId|uniqueMonsterId, items|itemBaseId}`. */
function questStampsFor(game, level) {
  const raw = game.hooks?.questStampsFor?.(game, level.depth) || [];
  return (Array.isArray(raw) ? raw : Object.values(raw)).map((s) => ({
    ...s,
    kind: s.kind || s.stamp || null,
    uniqueId: s.uniqueId || s.uniqueMonsterId || null,
    itemBaseId: s.itemBaseId || (s.items && s.items[0]) || null,
  }));
}

function reserveStampRooms(game, level, stamps, rng) {
  const free = () => (level.rooms || []).filter((r) => !r.reserved && r.kind !== 'hall' && !roomHasStairs(level, r));
  for (const st of stamps) {
    if (!st.kind) continue;
    const pool = free();
    if (!pool.length) continue;
    let room;
    if (st.kind === 'bossRoom') room = pool.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    else if (st.kind === 'vault') room = pool.find((r) => level.objects.some((o) => o.kind === 'door' && ringHas(r, o.tx, o.ty))) || rng.pick(pool);
    else room = rng.pick(pool);
    reserveRoom(level, room, st.kind);
    room.questId = st.questId || null;
    st.room = room;
  }
}

/** The unique a stamp names, unless the monster module already placed it. */
function spawnStampUnique(game, level, st, x, y) {
  const uid = st.uniqueId;
  if (!uid || !deps.spawnMonster || level.monsters.some((m) => m.unique === uid || m.uniqueId === uid || m.typeId === uid)) return null;
  const def = (game.theme?.uniqueMonsters || []).find((u) => u.id === uid) || { id: uid, name: uid, baseTypeId: uid };
  return deps.spawnMonster(game, def.baseTypeId || uid, x, y, { unique: def, questId: st.questId, boss: st.kind === 'bossRoom' });
}

/** Quest item with no room stamp: tuck it into an existing chest, else drop it on the floor. */
function placeLooseQuestItem(game, level, tier, st, rng) {
  const item = deps.generateItem?.(game, { level, rng: itemLevelFor(tier, level.depth), baseId: st.itemBaseId, source: 'quest' });
  if (!item) return;
  const chest = rng.pick(level.objects.filter((o) => o.kind === 'chest' && !o.questLoot));
  if (chest) { chest.questLoot = item; return; }
  const s = randomFreeTile(level, rng, { game });
  if (s) placeGroundItem(game, level, item, s.x, s.y);
}

function ringHas(r, x, y) {
  return x >= r.x - 1 && x <= r.x + r.w && y >= r.y - 1 && y <= r.y + r.h && !rectContains(r, x, y);
}

function applyStamp(game, level, tier, st, rng) {
  const cfg = bal(game).populate;
  const room = st.room;
  if (!room) { if (st.itemBaseId) placeLooseQuestItem(game, level, tier, st, rng); return; }
  const c = roomCentre(room);
  const ilvl = itemLevelFor(tier, level.depth);
  const unique = spawnStampUnique(game, level, st, c.x, c.y);
  if (st.kind === 'bossRoom' || st.kind === 'den') {
    const followers = rangeOf(rng, st.kind === 'bossRoom' ? cfg.bossFollowers : cfg.denFollowers);
    if (unique) spawnGroup(game, level, st.monsterTypeId || rng.pick(tier.monsterPool), c.x, c.y, followers, { leaderId: unique.id });
    if (st.kind === 'bossRoom') placeObjects(game, level, rng, typesOfKind(game, level, tier, 'chest'), 1, { room, allowNoSpawn: true, game, create: { lootLevel: ilvl } });
  }
  if (st.kind === 'vault') {
    const linkId = `vault:${st.questId || level.depth}`;
    for (const o of level.objects) if (o.kind === 'door' && ringHas(room, o.tx, o.ty)) { o.locked = true; o.linkId = linkId; }
    const questItem = st.itemBaseId ? deps.generateItem?.(game, { level, rng: ilvl, baseId: st.itemBaseId, source: 'quest' }) : null;
    const chestTypes = typesOfKind(game, level, tier, 'chest');
    const spot = randomFreeTile(level, rng, { room, allowNoSpawn: true, game });
    if (spot && chestTypes.length) createObject(game, chestTypes[chestTypes.length - 1], spot.x, spot.y, { level, rng, questLoot: questItem, lootLevel: ilvl });
    const levers = typesOfKind(game, level, tier, 'lever');
    const far = (level.rooms || []).filter((r) => r !== room && !r.reserved).sort((a, b) => Math.hypot(b.x - room.x, b.y - room.y) - Math.hypot(a.x - room.x, a.y - room.y));
    const leverRoom = far[rng.rand(Math.max(1, Math.ceil(far.length * HALF)))];
    const ls = randomFreeTile(level, rng, { room: leverRoom, game }) || randomFreeTile(level, rng, { game });
    if (ls && levers.length) createObject(game, levers[0], ls.x, ls.y, { level, rng, linkId });
  }
}

/**
 * Populate a generated level in place (stairs, doors, themes, objects, monsters, items, quest stamps, lights).
 * @param {object} game
 * @param {object} level Level with tiles/rooms/doorSpecs/stairs already set
 * @param {object} tier Tier definition
 * @param {object} [rng] forked rng (default: game.rng.fork('populate:'+depth))
 */
export function populateLevel(game, level, tier, rng = game.rng.fork(`populate:${level.depth}`)) {
  placeStairs(game, level, tier, rng);
  placeDoors(game, level, tier, rng);
  const stamps = questStampsFor(game, level);
  level.questStamps = stamps;
  reserveStampRooms(game, level, stamps, rng);
  const themed = pickThemedRooms(game, level, tier, rng);
  scatterObjects(game, level, tier, rng);
  deps.placeMonstersForLevel?.(game, level, tier);
  scatterItems(game, level, tier, rng);
  for (const room of themed) furnishThemedRoom(game, level, tier, room, rng);
  for (const st of stamps) applyStamp(game, level, tier, st, rng);
  level.lights = level.objects.filter((o) => o.light > 0 && !o.removed).map((o) => ({ x: o.tx, y: o.ty, r: o.light }));
}

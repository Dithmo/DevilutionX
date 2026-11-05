/**
 * Shared grid helpers for monsters, AI and missiles: occupancy, free-tile
 * search (ring crawl), targeting and direction maths. No game rules live
 * here beyond "who counts as an enemy of whom".
 */
import { T, inBounds, isSolid, isWalkable, hasFlag } from '../world/tiles.js';
import { DIRS8, DIR_COUNT, dirFromDelta, dist } from '../world/pathfind.js';
import { lineOfSight } from '../world/fov.js';

/** @returns {number} occupant id at (x,y), 0 when free or out of bounds */
export function occupantAt(level, x, y) {
  const t = level.tiles;
  if (!inBounds(t, x, y)) return 0;
  return level.occupant[y * t.w + x];
}

/** Set / clear the occupant id of a tile (no-op out of bounds). */
export function setOccupant(level, x, y, id) {
  const t = level.tiles;
  if (inBounds(t, x, y)) level.occupant[y * t.w + x] = id;
}

/**
 * Can an actor stand on (x,y)? Walkable, not occupied (or occupied by `selfId`),
 * and, when `noSpawn` is set, not flagged NO_SPAWN.
 * @returns {boolean}
 */
export function tileFree(level, x, y, selfId = 0, noSpawn = false) {
  if (!isWalkable(level.tiles, x, y)) return false;
  const occ = occupantAt(level, x, y);
  if (occ !== 0 && occ !== selfId) return false;
  if (noSpawn && hasFlag(level.tiles, x, y, T.NO_SPAWN)) return false;
  return true;
}

/**
 * Visit tiles ring by ring around (cx,cy) (Chebyshev rings 0..maxR), calling
 * `fn(x,y)` until it returns true. ref §5.9 Crawl.
 * @returns {{x:number,y:number}|null} the accepted tile
 */
export function ringCrawl(cx, cy, maxR, fn) {
  if (fn(cx, cy)) return { x: cx, y: cy };
  for (let r = 1; r <= maxR; r++) {
    for (let i = -r; i <= r; i++) {
      if (fn(cx + i, cy - r)) return { x: cx + i, y: cy - r };
      if (fn(cx + i, cy + r)) return { x: cx + i, y: cy + r };
    }
    for (let j = -r + 1; j <= r - 1; j++) {
      if (fn(cx - r, cy + j)) return { x: cx - r, y: cy + j };
      if (fn(cx + r, cy + j)) return { x: cx + r, y: cy + j };
    }
  }
  return null;
}

/**
 * Nearest free tile to (x,y) within maxR (ring order, so centre first).
 * @returns {{x:number,y:number}|null}
 */
export function findFreeTileNear(level, x, y, maxR, noSpawn = false) {
  return ringCrawl(x, y, maxR, (tx, ty) => tileFree(level, tx, ty, 0, noSpawn));
}

/** Diagonal steps may not cut a solid corner. ref §5.1. @returns {boolean} */
export function stepAllowed(tiles, fx, fy, dir) {
  const [dx, dy] = DIRS8[dir];
  if (dx !== 0 && dy !== 0 && (isSolid(tiles, fx + dx, fy) || isSolid(tiles, fx, fy + dy))) return false;
  return true;
}

/** @returns {number} direction from (ax,ay) toward (bx,by); facing `fallback` when equal */
export function dirToward(ax, ay, bx, by, fallback = 0) {
  const d = dirFromDelta(bx - ax, by - ay);
  return d < 0 ? fallback : d;
}

/** @returns {number} direction rotated by `turns` × 45° */
export function turnDir(d, turns) {
  return (((d + turns) % DIR_COUNT) + DIR_COUNT) % DIR_COUNT;
}

/** @returns {number} opposite direction */
export function oppositeDir(d) {
  return turnDir(d, 4);
}

/** @returns {boolean} true when the two actors are on the same or adjacent tiles */
export function adjacent(a, b) {
  return dist(a.tx, a.ty, b.tx, b.ty) <= 1;
}

/** @returns {boolean} Bresenham LOS between two actors' tiles */
export function actorsSeeEachOther(level, a, b) {
  return lineOfSight(level.tiles, a.tx, a.ty, b.tx, b.ty);
}

/** @returns {boolean} does `m` fight on the player's side? */
export function isAlly(m) {
  return m.kind === 'player' || m.ally === true;
}

/** @returns {boolean} are these two actors enemies? */
export function hostile(a, b) {
  return isAlly(a) !== isAlly(b);
}

/**
 * Everyone `m` could attack: the player and allies for a hostile monster,
 * hostile monsters for an ally. Dead actors are skipped.
 * @returns {Array<object>}
 */
export function enemiesOf(game, m) {
  const out = [];
  const p = game.player;
  if (!isAlly(m)) {
    if (p && !p.dead && game.level && game.level.monsters) out.push(p);
  }
  for (const o of game.level.monsters) {
    if (o === m || o.dead || o.hidden) continue;
    if (hostile(m, o)) out.push(o);
  }
  return out;
}

/**
 * Nearest enemy of `m` by Chebyshev distance, optionally within `maxDist`
 * and optionally requiring LOS.
 * @returns {{ent:object, d:number}|null}
 */
export function nearestEnemy(game, m, maxDist = Infinity, needLos = false) {
  let best = null;
  let bestD = Infinity;
  for (const e of enemiesOf(game, m)) {
    const d = dist(m.tx, m.ty, e.tx, e.ty);
    if (d > maxDist || d >= bestD) continue;
    if (needLos && !actorsSeeEachOther(game.level, m, e)) continue;
    best = e;
    bestD = d;
  }
  return best ? { ent: best, d: bestD } : null;
}

/**
 * Map of entity id → actor for the current level (player + monsters).
 * @returns {Map<number, object>}
 */
export function actorsById(game) {
  const map = new Map();
  if (game.player) map.set(game.player.id, game.player);
  for (const m of game.level.monsters) map.set(m.id, m);
  return map;
}

/** @returns {{x:number,y:number}} unit delta of a direction */
export function dirDelta(d) {
  const v = DIRS8[((d % DIR_COUNT) + DIR_COUNT) % DIR_COUNT];
  return { x: v[0], y: v[1] };
}

/**
 * Player walking: A* paths with occupant blocking, 8-direction facing,
 * sub-tile ox/oy interpolation and occupancy handoff.
 *
 * Step model (reference engine): the destination tile is claimed in
 * `level.occupant` the moment a step starts; the origin stays claimed until
 * arrival. `tx,ty` switch to the destination at the half-way point (so depth
 * sorting and adjacency follow the visible body) with a negative ox/oy.
 * Progress `p.walk.t` advances by `p.moveSpeed` tiles per tick.
 */
import { findPath, dirFromDelta, dist } from '../world/pathfind.js';
import { isWalkable, isSolid, inBounds, idx } from '../world/tiles.js';
import { setAnim, advanceAnim, ANIM_FRAMES } from './anim.js';
import { PLAYER_PATH_MAX_NODES } from '../../data/balance/progression.js';

const HALF = 0.5;
const EPS = 1e-6;
const ADJACENT = 1;

/** Chebyshev adjacency (same tile counts). @returns {boolean} */
export function isAdjacent(a, b) {
  return dist(a.tx, a.ty, b.tx !== undefined ? b.tx : b.x, b.ty !== undefined ? b.ty : b.y) <= ADJACENT;
}

/** The tile an actor will stand on when its current step ends. @returns {{x:number,y:number}} */
export function futureTile(e) {
  return e.walk ? { x: e.walk.x, y: e.walk.y } : { x: e.tx, y: e.ty };
}

/** Face an entity toward a world tile. */
export function faceToward(e, x, y) {
  const d = dirFromDelta(x - e.tx, y - e.ty);
  if (d >= 0) e.dir = d;
}

/** Blocker predicate for findPath: any other entity's tile. @returns {(x:number,y:number)=>boolean} */
export function occupantBlocker(level, selfId) {
  const occ = level.occupant;
  const w = level.tiles.w;
  return (x, y) => {
    const o = occ[y * w + x];
    return o !== 0 && o !== selfId;
  };
}

/** Set / clear an occupant cell (only clears when it still belongs to e). */
export function occupyTile(level, e, x, y) {
  if (inBounds(level.tiles, x, y)) level.occupant[idx(level.tiles, x, y)] = e.id;
}
export function freeTile(level, e, x, y) {
  if (!inBounds(level.tiles, x, y)) return;
  const i = idx(level.tiles, x, y);
  if (level.occupant[i] === e.id) level.occupant[i] = 0;
}

/** Can the actor step from (fx,fy) to the neighbouring (x,y) right now? @returns {boolean} */
export function canStep(level, e, fx, fy, x, y) {
  if (!isWalkable(level.tiles, x, y)) return false;
  const o = level.occupant[idx(level.tiles, x, y)];
  if (o !== 0 && o !== e.id) return false;
  const dx = x - fx;
  const dy = y - fy;
  if (dx !== 0 && dy !== 0 && (isSolid(level.tiles, fx + dx, fy) || isSolid(level.tiles, fx, fy + dy))) return false;
  return true;
}

/**
 * Compute and install a path from the actor's future tile to `target`.
 * An occupied/solid target yields a path to an adjacent tile.
 * @param {object} game
 * @param {object} p
 * @param {{x:number,y:number}} target
 * @param {{maxNodes?:number}} [opts]
 * @returns {boolean} true if a path exists (possibly empty = already there)
 */
export function setPlayerPath(game, p, target, opts = {}) {
  const level = game.level;
  const from = futureTile(p);
  const path = findPath(level.tiles, from, target, {
    isBlocked: occupantBlocker(level, p.id),
    maxNodes: opts.maxNodes || PLAYER_PATH_MAX_NODES,
    allowTargetBlocked: true,
  });
  if (!path) return false;
  p.path = path.length ? path : null;
  p.pathGoal = { x: target.x | 0, y: target.y | 0 };
  return true;
}

/**
 * Abort the current step, landing on whichever tile is closer, and release
 * the other tile. Safe to call when not walking.
 */
export function cancelWalk(game, p) {
  const level = game.level;
  const w = p.walk;
  if (w && level) {
    if (w.t >= HALF) {
      freeTile(level, p, w.fx, w.fy);
      p.tx = w.x; p.ty = w.y;
      occupyTile(level, p, w.x, w.y);
    } else {
      freeTile(level, p, w.x, w.y);
      p.tx = w.fx; p.ty = w.fy;
      occupyTile(level, p, w.fx, w.fy);
    }
  }
  p.walk = null;
  p.path = null;
  p.ox = 0;
  p.oy = 0;
  if (p.anim === 'walk') setAnim(p, 'stand');
}

/**
 * Advance walking by one tick.
 * @param {object} game
 * @param {object} p
 * @param {{frames:{walk:number}}} classDef ticks per walk frame
 * @returns {'idle'|'walking'|'arrived'|'blocked'} 'arrived' = a step completed this tick
 */
export function stepWalk(game, p, classDef) {
  const level = game.level;
  if (!p.path || !p.path.length) {
    p.path = null;
    if (!p.walk && p.anim === 'walk') setAnim(p, 'stand');
    return 'idle';
  }
  if (!p.walk) {
    const next = p.path[0];
    if (!canStep(level, p, p.tx, p.ty, next.x, next.y)) {
      p.path = null;
      if (p.anim === 'walk') setAnim(p, 'stand');
      return 'blocked';
    }
    p.walk = { fx: p.tx, fy: p.ty, x: next.x, y: next.y, t: 0 };
    occupyTile(level, p, next.x, next.y);
    p.dir = dirFromDelta(next.x - p.tx, next.y - p.ty);
    if (p.anim !== 'walk') setAnim(p, 'walk', classDef.frames.walk, ANIM_FRAMES.walk);
  }
  const w = p.walk;
  w.t += p.moveSpeed;
  advanceAnim(p);
  if (w.t >= 1 - EPS) {
    freeTile(level, p, w.fx, w.fy);
    p.tx = w.x; p.ty = w.y; p.ox = 0; p.oy = 0;
    occupyTile(level, p, w.x, w.y);
    p.walk = null;
    p.path.shift();
    if (!p.path.length) {
      p.path = null;
      setAnim(p, 'stand');
    }
    return 'arrived';
  }
  if (w.t >= HALF) {
    p.tx = w.x; p.ty = w.y;
    p.ox = (w.fx - w.x) * (1 - w.t);
    p.oy = (w.fy - w.y) * (1 - w.t);
  } else {
    p.tx = w.fx; p.ty = w.fy;
    p.ox = (w.x - w.fx) * w.t;
    p.oy = (w.y - w.fy) * w.t;
  }
  return 'walking';
}

/** Is the actor mid-step? @returns {boolean} */
export function isWalking(p) {
  return !!p.walk;
}

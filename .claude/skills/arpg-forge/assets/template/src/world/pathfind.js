/**
 * 8-neighbour A* over the tile grid with a binary-heap open list.
 *
 * Diagonal moves are forbidden when either orthogonal neighbour is solid
 * (no corner cutting). Dynamic blockers (other actors) are supplied by the
 * caller via `isBlocked(x,y)` and do not forbid diagonal slides.
 *
 * Direction convention (isometric, "south" is toward the viewer):
 *   index 0..7 = S, SW, W, NW, N, NE, E, SE
 *   S = (+1,+1) world, i.e. straight down on screen.
 */
import { inBounds, isSolid } from './tiles.js';

/** Unit deltas [dx, dy] indexed by direction 0..7. */
export const DIRS8 = Object.freeze([
  [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0],
]);
/** Direction names matching DIRS8. */
export const DIR_NAMES = Object.freeze(['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']);
export const DIR_COUNT = 8;

const DIAG_COST = Math.SQRT2;
const ORTHO_COST = 1;
const OCTILE_K = Math.SQRT2 - 2;
const DEFAULT_MAX_NODES = 2000;
const ADJACENT = 1;

// (dx+1)*3 + (dy+1) -> direction index; centre (-1) means no movement.
const DELTA_TO_DIR = [4, 3, 2, 5, -1, 1, 6, 7, 0];

/**
 * Direction index for a movement delta (any magnitude; signs are used).
 * @returns {number} 0..7, or -1 for a zero delta
 */
export function dirFromDelta(dx, dy) {
  return DELTA_TO_DIR[(Math.sign(dx) + 1) * 3 + (Math.sign(dy) + 1)];
}

/** @returns {{x:number,y:number}} unit delta for a direction index */
export function dirToDelta(d) {
  const v = DIRS8[((d % DIR_COUNT) + DIR_COUNT) % DIR_COUNT];
  return { x: v[0], y: v[1] };
}

/** Chebyshev (king-move) distance. @returns {number} */
export function dist(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Euclidean distance. @returns {number} */
export function distEuclid(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** Octile heuristic (exact for 8-connected grids with sqrt2 diagonals). */
function octile(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + OCTILE_K * Math.min(dx, dy);
}

// Scratch buffers reused across calls, one set per grid size.
const scratchBySize = new Map();

function getScratch(n) {
  let s = scratchBySize.get(n);
  if (!s) {
    s = { g: new Float64Array(n), parent: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), gen: 0 };
    scratchBySize.set(n, s);
  }
  s.gen = (s.gen + 1) >>> 0;
  if (s.gen === 0) { s.stamp.fill(0); s.closed.fill(0); s.gen = 1; }
  return s;
}

/** Minimal binary min-heap keyed on f, storing node indices. */
function createHeap() {
  const f = [];
  const id = [];
  function swap(a, b) {
    const tf = f[a]; f[a] = f[b]; f[b] = tf;
    const ti = id[a]; id[a] = id[b]; id[b] = ti;
  }
  return {
    get size() { return id.length; },
    push(nodeId, cost) {
      f.push(cost);
      id.push(nodeId);
      let i = id.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[p] <= f[i]) break;
        swap(i, p);
        i = p;
      }
    },
    pop() {
      const top = id[0];
      const lastF = f.pop();
      const lastId = id.pop();
      if (id.length > 0) {
        f[0] = lastF;
        id[0] = lastId;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < id.length && f[l] < f[m]) m = l;
          if (r < id.length && f[r] < f[m]) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    },
  };
}

function buildPath(tiles, s, startIdx, endIdx) {
  const path = [];
  let i = endIdx;
  while (i !== startIdx) {
    path.push({ x: i % tiles.w, y: (i / tiles.w) | 0 });
    i = s.parent[i];
  }
  path.reverse();
  return path;
}

/**
 * Find a path between two tiles.
 * @param {object} tiles
 * @param {{x:number,y:number}} from start tile (never tested for blocking)
 * @param {{x:number,y:number}} to target tile
 * @param {{
 *   isBlocked?:(x:number,y:number)=>boolean,  extra dynamic blockers
 *   maxNodes?:number,          expansion cap (default 2000)
 *   allowDiagonal?:boolean,    default true
 *   allowTargetBlocked?:boolean, default true: if the target is blocked, path to any adjacent tile
 *   allowPartial?:boolean,     default false: on failure return the path to the closest tile reached
 *   isPassable?:(x:number,y:number)=>boolean, solid tiles this walker may still enter (e.g. closed doors it will open)
 * }} [opts]
 * @returns {Array<{x:number,y:number}>|null} steps excluding the start tile; [] if already there
 */
export function findPath(tiles, from, to, opts = {}) {
  const {
    isBlocked = null,
    maxNodes = DEFAULT_MAX_NODES,
    allowDiagonal = true,
    allowTargetBlocked = true,
    allowPartial = false,
    isPassable = null,
  } = opts;
  const sx = from.x | 0, sy = from.y | 0, tx = to.x | 0, ty = to.y | 0;
  if (!inBounds(tiles, sx, sy) || !inBounds(tiles, tx, ty)) return null;

  const blocked = (x, y) => (isSolid(tiles, x, y) && !(isPassable !== null && isPassable(x, y))) || (isBlocked !== null && isBlocked(x, y));
  const targetBlocked = blocked(tx, ty);
  if (targetBlocked && !allowTargetBlocked) return null;
  const isGoal = targetBlocked
    ? (x, y) => dist(x, y, tx, ty) <= ADJACENT
    : (x, y) => x === tx && y === ty;
  if (isGoal(sx, sy)) return [];

  const w = tiles.w;
  const s = getScratch(w * tiles.h);
  const gen = s.gen;
  const heap = createHeap();
  const startIdx = sy * w + sx;
  s.g[startIdx] = 0;
  s.parent[startIdx] = -1;
  s.stamp[startIdx] = gen;
  heap.push(startIdx, octile(sx, sy, tx, ty));

  let expanded = 0;
  let bestIdx = startIdx;
  let bestH = octile(sx, sy, tx, ty);

  while (heap.size > 0 && expanded < maxNodes) {
    const cur = heap.pop();
    if (s.closed[cur] === gen) continue;
    s.closed[cur] = gen;
    expanded++;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    if (isGoal(cx, cy)) return buildPath(tiles, s, startIdx, cur);
    const h = octile(cx, cy, tx, ty);
    if (h < bestH) { bestH = h; bestIdx = cur; }

    for (let d = 0; d < DIR_COUNT; d++) {
      const dx = DIRS8[d][0];
      const dy = DIRS8[d][1];
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(tiles, nx, ny)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal) {
        if (!allowDiagonal) continue;
        if (isSolid(tiles, cx + dx, cy) || isSolid(tiles, cx, cy + dy)) continue;
      }
      const ni = ny * w + nx;
      if (s.closed[ni] === gen) continue;
      // The (blocked) target itself is never entered; adjacency is the goal.
      if (blocked(nx, ny)) continue;
      const ng = s.g[cur] + (diagonal ? DIAG_COST : ORTHO_COST);
      if (s.stamp[ni] === gen && ng >= s.g[ni]) continue;
      s.stamp[ni] = gen;
      s.g[ni] = ng;
      s.parent[ni] = cur;
      heap.push(ni, ng + octile(nx, ny, tx, ty));
    }
  }

  if (allowPartial && bestIdx !== startIdx) return buildPath(tiles, s, startIdx, bestIdx);
  return null;
}

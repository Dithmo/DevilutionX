/**
 * Shared grid helpers for the level generators and populate step.
 *
 * Everything here works on the plain tile grid (world/tiles) or on a 0/1
 * Uint8Array mask of the same size. No randomness except where an rng is
 * passed in explicitly.
 */
import { T, idx, inBounds, setFlag, isSolid } from '../tiles.js';

const VARIANTS = 256;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Carve a floor rectangle (clipped) with random cosmetic variants. */
export function carveRect(tiles, rng, x0, y0, w, h, floor) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!inBounds(tiles, x, y)) continue;
      const i = idx(tiles, x, y);
      tiles.floor[i] = floor;
      tiles.wall[i] = 0;
      tiles.flags[i] = 0;
      tiles.variant[i] = rng.rand(VARIANTS);
    }
  }
}

/** Turn a tile into a solid wall of the given style. */
export function setWall(tiles, x, y, style) {
  if (!inBounds(tiles, x, y)) return;
  const i = idx(tiles, x, y);
  tiles.floor[i] = 0;
  tiles.wall[i] = style;
  tiles.flags[i] = T.SOLID | T.BLOCKS_LIGHT;
}

/** Every void tile 8-adjacent to a floor tile becomes a solid wall of `style`. */
export function raiseWalls(tiles, style) {
  const { w, h } = tiles;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(tiles, x, y);
      if (tiles.floor[i] || tiles.wall[i]) continue;
      let touches = false;
      for (let ny = y - 1; ny <= y + 1 && !touches; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          if (inBounds(tiles, nx, ny) && tiles.floor[idx(tiles, nx, ny)]) { touches = true; break; }
        }
      }
      if (touches) setWall(tiles, x, y, style);
    }
  }
}

/** Sprinkle floor variant `alt` over tiles currently `base` with pct chance. */
export function sprinkleFloor(tiles, rng, base, alt, pct) {
  for (let i = 0; i < tiles.floor.length; i++) {
    if (tiles.floor[i] === base && rng.chance(pct)) tiles.floor[i] = alt;
  }
}

/** @returns {boolean} tile is a floor tile (floor > 0, no wall) */
export function isFloor(tiles, x, y) {
  if (!inBounds(tiles, x, y)) return false;
  const i = idx(tiles, x, y);
  return tiles.floor[i] > 0 && tiles.wall[i] === 0 && !(tiles.flags[i] & T.WATER);
}

/** @returns {boolean} every tile in the rect satisfies pred(x, y) */
export function rectAll(x0, y0, w, h, pred) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (!pred(x, y)) return false;
  return true;
}

/** @returns {boolean} rects (x,y,w,h) overlap after growing `a` by margin */
export function rectsOverlap(a, b, margin = 0) {
  return a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
}

/** @returns {boolean} point lies inside rect */
export function rectContains(r, x, y) {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/**
 * Label 4-connected components of cells where `open(i)` is true.
 * @returns {{ labels:Int32Array, sizes:number[], touchesEdge:boolean[] }} labels are 1-based, 0 = not open
 */
export function components(w, h, open) {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  const touchesEdge = [false];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (labels[s] || !open(s)) continue;
    const label = sizes.length;
    sizes.push(0);
    touchesEdge.push(false);
    labels[s] = label;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      sizes[label]++;
      const x = i % w;
      const y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge[label] = true;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (labels[ni] || !open(ni)) continue;
        labels[ni] = label;
        stack.push(ni);
      }
    }
  }
  return { labels, sizes, touchesEdge };
}

/** Index of the largest component (1-based), or 0 when none. */
export function largestComponent(sizes) {
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  return best;
}

/**
 * BFS over the tile grid (8-neighbour, no corner cutting) from (sx,sy).
 * Door tiles count as passable regardless of their SOLID flag.
 * @returns {Int32Array} step distance per tile, -1 = unreachable
 */
export function bfsDistances(tiles, sx, sy) {
  const { w, h } = tiles;
  const dist = new Int32Array(w * h).fill(-1);
  const pass = (x, y) => inBounds(tiles, x, y) && (!isSolid(tiles, x, y) || (tiles.flags[idx(tiles, x, y)] & T.DOOR) !== 0);
  if (!pass(sx, sy)) return dist;
  const queue = [sy * w + sx];
  dist[sy * w + sx] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!pass(nx, ny)) continue;
        if (dx && dy && (!pass(x + dx, y) || !pass(x, y + dy))) continue;
        const ni = ny * w + nx;
        if (dist[ni] >= 0) continue;
        dist[ni] = dist[i] + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}

/**
 * Deterministic ring-crawl offsets for Chebyshev radius r (reference DoCrawl
 * order: top/bottom, then the flanks, then the corners, then left/right).
 * @returns {Array<[number, number]>}
 */
export function ringOffsets(r) {
  if (r === 0) return [[0, 0]];
  const out = [[0, r], [0, -r]];
  for (let x = 1; x < r; x++) out.push([x, r], [-x, r], [x, -r], [-x, -r]);
  out.push([r, r], [-r, r], [r, -r], [-r, -r], [r, 0], [-r, 0]);
  for (let y = 1; y < r; y++) out.push([r, y], [-r, y], [r, -y], [-r, -y]);
  return out;
}

/** @returns {object|null} solid object on the tile */
export function solidObjectAt(level, x, y) {
  for (const o of level.objects) if (o.tx === x && o.ty === y && o.solid && !o.removed) return o;
  return null;
}

/**
 * Walkable for an actor: not solid, has floor, no solid object, nobody standing there.
 * @returns {boolean}
 */
export function isWalkableLevel(level, x, y) {
  const { tiles } = level;
  if (!inBounds(tiles, x, y)) return false;
  const i = idx(tiles, x, y);
  if (tiles.floor[i] === 0 || isSolid(tiles, x, y)) return false;
  if (level.occupant && level.occupant[i] !== 0) return false;
  return solidObjectAt(level, x, y) === null;
}

/**
 * Nearest free tile to (x,y) in ring-crawl order (radius 0..maxR).
 * @param {object} level
 * @param {number} x
 * @param {number} y
 * @param {number} maxR
 * @param {(x:number,y:number)=>boolean} [pred] extra filter (default: no object or item on the tile)
 * @returns {{x:number,y:number}|null}
 */
export function freeTileNear(level, x, y, maxR, pred = null) {
  const test = pred || ((tx, ty) => !level.objects.some((o) => o.tx === tx && o.ty === ty && !o.removed)
    && !level.items.some((it) => it.tx === tx && it.ty === ty));
  for (let r = 0; r <= maxR; r++) {
    for (const [dx, dy] of ringOffsets(r)) {
      const tx = x + dx;
      const ty = y + dy;
      if (isWalkableLevel(level, tx, ty) && !(level.tiles.flags[idx(level.tiles, tx, ty)] & T.DOOR) && test(tx, ty)) return { x: tx, y: ty };
    }
  }
  return null;
}

/** Mark a NO_SPAWN halo around a tile. */
export function markNoSpawn(tiles, x, y, r) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) setFlag(tiles, x + dx, y + dy, T.NO_SPAWN);
}

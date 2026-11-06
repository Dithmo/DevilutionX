/**
 * Tile grid storage and queries.
 *
 * floor[i]   0 = void (unwalkable, undrawn); >=1 = floor style index (1-based into palette.floors)
 * wall[i]    0 = none; >=1 = wall style index (1-based into palette.walls)
 * flags[i]   bitmask of T.* (see below)
 * variant[i] cosmetic noise seed per tile (0..255)
 *
 * Doors: a door tile keeps wall = 0 and the DOOR flag; the object layer toggles
 * SOLID|BLOCKS_LIGHT on it when the door closes/opens, so solidity and light
 * for DOOR tiles are purely flag-driven.
 */

/** Tile flag bitmask. */
export const T = Object.freeze({
  SOLID: 1,
  BLOCKS_LIGHT: 2,
  DOOR: 4,
  STAIRS_DOWN: 8,
  STAIRS_UP: 16,
  WATER: 32,
  DECOR: 64,
  NO_SPAWN: 128,
});

const NEIGHBOUR_OFFSETS = [
  [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0],
];

/**
 * Allocate an empty grid (all void).
 * @param {number} w
 * @param {number} h
 * @returns {{ w:number, h:number, floor:Uint8Array, wall:Uint8Array, flags:Uint8Array, variant:Uint8Array }}
 */
export function createTiles(w, h) {
  const n = w * h;
  return {
    w,
    h,
    floor: new Uint8Array(n),
    wall: new Uint8Array(n),
    flags: new Uint8Array(n),
    variant: new Uint8Array(n),
  };
}

/** @returns {boolean} */
export function inBounds(tiles, x, y) {
  return x >= 0 && y >= 0 && x < tiles.w && y < tiles.h;
}

/** Linear index of (x,y); caller guarantees bounds. @returns {number} */
export function idx(tiles, x, y) {
  return y * tiles.w + x;
}

/**
 * Solid = cannot be entered: out of bounds, void floor, SOLID flag, or a
 * wall that is not a door tile.
 * @returns {boolean}
 */
export function isSolid(tiles, x, y) {
  if (!inBounds(tiles, x, y)) return true;
  const i = y * tiles.w + x;
  const f = tiles.flags[i];
  if (f & T.SOLID) return true;
  if (tiles.floor[i] === 0 && !(f & T.DOOR)) return true;
  return tiles.wall[i] > 0 && !(f & T.DOOR);
}

/** Walkable = in bounds and not solid. @returns {boolean} */
export function isWalkable(tiles, x, y) {
  return !isSolid(tiles, x, y);
}

/**
 * Does this tile stop light / line of sight? Out of bounds counts as yes.
 * @returns {boolean}
 */
export function blocksLight(tiles, x, y) {
  if (!inBounds(tiles, x, y)) return true;
  const i = y * tiles.w + x;
  const f = tiles.flags[i];
  if (f & T.BLOCKS_LIGHT) return true;
  return tiles.wall[i] > 0 && !(f & T.DOOR);
}

/** OR a flag mask into a tile (no-op out of bounds). */
export function setFlag(tiles, x, y, mask) {
  if (inBounds(tiles, x, y)) tiles.flags[y * tiles.w + x] |= mask;
}

/** Clear a flag mask on a tile (no-op out of bounds). */
export function clearFlag(tiles, x, y, mask) {
  if (inBounds(tiles, x, y)) tiles.flags[y * tiles.w + x] &= ~mask;
}

/** @returns {boolean} true if any bit of mask is set on the tile */
export function hasFlag(tiles, x, y, mask) {
  return inBounds(tiles, x, y) && (tiles.flags[y * tiles.w + x] & mask) !== 0;
}

/**
 * In-bounds 8-neighbours of a tile, ordered S, SW, W, NW, N, NE, E, SE
 * (same order as pathfind.DIRS8).
 * @returns {Array<{x:number,y:number}>}
 */
export function neighbors8(tiles, x, y) {
  const out = [];
  for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(tiles, nx, ny)) out.push({ x: nx, y: ny });
  }
  return out;
}

/**
 * Fill a rectangle (clipped to the grid) with floor / wall / flags values.
 * Pass `undefined` for a channel to leave it untouched.
 */
export function fillRect(tiles, x0, y0, w, h, { floor, wall, flags } = {}) {
  const x1 = Math.min(tiles.w, x0 + w);
  const y1 = Math.min(tiles.h, y0 + h);
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      const i = y * tiles.w + x;
      if (floor !== undefined) tiles.floor[i] = floor;
      if (wall !== undefined) tiles.wall[i] = wall;
      if (flags !== undefined) tiles.flags[i] = flags;
    }
  }
}

/** Count tiles with floor > 0. @returns {number} */
export function countFloor(tiles) {
  let n = 0;
  for (let i = 0; i < tiles.floor.length; i++) if (tiles.floor[i]) n++;
  return n;
}

/**
 * Field of view and light map.
 *
 * computeFov() is recursive shadowcasting over 8 octants. It writes light
 * levels 0..15 into `out` using max-merge, so several sources can be cast
 * into one buffer. Light falls off linearly with Euclidean distance:
 *   light = max(0, 15 - round(dist * 15 / radius))
 * Light-blocking tiles (walls) next to a lit floor tile inherit that floor's
 * brightness so room edges render.
 */
import { inBounds, blocksLight } from './tiles.js';

export const MAX_LIGHT = 15;
const HALF = 0.5;

// Octant transforms: [xx, xy, yx, yy] per octant.
const OCTANTS = [
  [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
  [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
];

/**
 * Light level for a tile at the given distance from a source.
 * @param {number} dist Euclidean tile distance
 * @param {number} radius
 * @returns {number} 0..15
 */
export function lightAt(dist, radius) {
  if (radius <= 0) return 0;
  return Math.max(0, MAX_LIGHT - Math.round((dist * MAX_LIGHT) / radius));
}

function setMax(out, tiles, x, y, value) {
  const i = y * tiles.w + x;
  if (value > out[i]) out[i] = value;
}

function castOctant(tiles, cx, cy, row, start, end, radius, xx, xy, yx, yy, out) {
  if (start < end) return;
  const r2 = radius * radius;
  for (let j = row; j <= radius; j++) {
    let dx = -j - 1;
    const dy = -j;
    let blocked = false;
    let newStart = start;
    while (dx <= 0) {
      dx++;
      const x = cx + dx * xx + dy * xy;
      const y = cy + dx * yx + dy * yy;
      const lSlope = (dx - HALF) / (dy + HALF);
      const rSlope = (dx + HALF) / (dy - HALF);
      if (start < rSlope) continue;
      if (end > lSlope) break;
      const d2 = dx * dx + dy * dy;
      const inside = inBounds(tiles, x, y);
      if (d2 <= r2 && inside) setMax(out, tiles, x, y, lightAt(Math.sqrt(d2), radius));
      const opaque = !inside || blocksLight(tiles, x, y);
      if (blocked) {
        if (opaque) {
          newStart = rSlope;
        } else {
          blocked = false;
          start = newStart;
        }
      } else if (opaque && j < radius) {
        blocked = true;
        castOctant(tiles, cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy, out);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}

/** Walls touching a lit floor tile take the brightest neighbouring floor light. */
function litWallPass(tiles, ox, oy, radius, out) {
  const x0 = Math.max(0, ox - radius - 1);
  const y0 = Math.max(0, oy - radius - 1);
  const x1 = Math.min(tiles.w - 1, ox + radius + 1);
  const y1 = Math.min(tiles.h - 1, oy + radius + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!blocksLight(tiles, x, y)) continue;
      let best = out[y * tiles.w + x];
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          if (!inBounds(tiles, nx, ny) || blocksLight(tiles, nx, ny)) continue;
          const l = out[ny * tiles.w + nx];
          if (l > best) best = l;
        }
      }
      out[y * tiles.w + x] = best;
    }
  }
}

/**
 * Cast light from (ox,oy) into `out` (max-merge; does not clear it).
 * @param {object} tiles
 * @param {number} ox source tile x
 * @param {number} oy source tile y
 * @param {number} radius in tiles
 * @param {Uint8Array} out light level 0..15 per tile (tiles.w * tiles.h)
 */
export function computeFov(tiles, ox, oy, radius, out) {
  if (!inBounds(tiles, ox, oy) || radius <= 0) return;
  setMax(out, tiles, ox, oy, MAX_LIGHT);
  for (const [xx, xy, yx, yy] of OCTANTS) {
    castOctant(tiles, ox, oy, 1, 1, 0, radius, xx, xy, yx, yy, out);
  }
  litWallPass(tiles, ox, oy, radius, out);
}

/**
 * Persistent light + explored buffers for a level.
 * @param {object} tiles
 * @returns {{ light:Uint8Array, explored:Uint8Array, update(sources:Array<{x:number,y:number,r:number}>):void, reveal():void }}
 */
export function createLightMap(tiles) {
  const n = tiles.w * tiles.h;
  const lm = {
    light: new Uint8Array(n),
    explored: new Uint8Array(n),

    /** Clear light, cast every source (max), mark lit tiles explored. */
    update(sources) {
      lm.light.fill(0);
      for (const s of sources) computeFov(tiles, s.x, s.y, s.r, lm.light);
      for (let i = 0; i < n; i++) if (lm.light[i]) lm.explored[i] = 1;
    },

    /** Mark the whole level explored (debug / scroll of mapping). */
    reveal() {
      lm.explored.fill(1);
    },
  };
  return lm;
}

/**
 * Bresenham line of sight. Endpoints never block; any intermediate tile
 * that blocks light breaks the line.
 * @returns {boolean}
 */
export function lineOfSight(tiles, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (x === x1 && y === y1) return true;
    if ((x !== x0 || y !== y0) && blocksLight(tiles, x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

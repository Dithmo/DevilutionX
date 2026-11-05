/**
 * Generator "caves" (reference C): a blob grown by recursively attaching
 * 3-4 cell blocks with ragged borders (75% continue) until a floor target is
 * met, two cellular smoothing passes, diagonal-pinch removal, flood fill
 * keeping the largest component, 0-2 enclosed water pools, a few 1-tile
 * fences with one gap, and 1-2 walled "cells" (theme rooms) with a door.
 *
 * Output: floor 1 = cave floor, 2 = variant, water = floors.length + 1 with
 * T.WATER|T.SOLID; wall style 1 = rock, 2 = fence.
 */
import { createTiles, T, idx, inBounds, setFlag } from '../tiles.js';
import { carveRect, raiseWalls, setWall, sprinkleFloor, isFloor, rectAll, rectsOverlap, components, largestComponent } from './grid.js';
import { LEVELS } from '../../../data/balance/levels.js';

const FLOOR = 1;
const FLOOR_ALT = 2;
const ROCK_STYLE = 1;
const FENCE_STYLE = 2;
const HALF_PCT = 50;
const DIR_UP = 0;
const DIR_RIGHT = 1;
const DIR_DOWN = 2;
const DIR_LEFT = 3;
const DIAG_ANTI = 6;   // 2x2 window value: bl + tr set
const DIAG_MAIN = 9;   // 2x2 window value: tl + br set

function makeMask(w, h) {
  const m = new Uint8Array(w * h);
  return { w, h, m, get: (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]), set: (x, y, v) => { m[y * w + x] = v; } };
}

/** Reference FillRoom: interior solid floor, each border cell 50% floor; rejects overlap and out-of-bounds. */
function fillRoom(mask, rng, x1, y1, x2, y2, cfg) {
  if (x1 <= 1 || y1 <= 1 || x2 >= mask.w - 2 || y2 >= mask.h - 2) return false;
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (mask.get(x, y)) return false;
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const border = x === x1 || x === x2 || y === y1 || y === y2;
      if (!border || rng.chance(cfg.ragPct)) mask.set(x, y, 1);
    }
  }
  return true;
}

/** Reference CreateBlock: a 3-4 block on side `dir` of (px,py), slid along the shared edge. */
function createBlock(mask, rng, px, py, obs, dir, cfg, depth) {
  if (depth > cfg.maxDepth) return;
  const bw = rng.range(cfg.blockSizes[0], cfg.blockSizes[1]);
  const bh = rng.range(cfg.blockSizes[0], cfg.blockSizes[1]);
  const slide = (size) => (size < obs ? rng.rand(size) : size === obs ? 0 : -rng.rand(size));
  let x1;
  let y1;
  if (dir === DIR_UP) { y1 = py - 1 - bh; x1 = px + slide(bw); }
  else if (dir === DIR_DOWN) { y1 = py + 1; x1 = px + slide(bw); }
  else if (dir === DIR_RIGHT) { x1 = px + 1; y1 = py + slide(bh); }
  else { x1 = px - 1 - bw; y1 = py + slide(bh); }
  const x2 = x1 + bw;
  const y2 = y1 + bh;
  if (!fillRoom(mask, rng, x1, y1, x2, y2, cfg) || !rng.chance(cfg.continuePct)) return;
  if (dir !== DIR_DOWN) createBlock(mask, rng, x1, y1, bw, DIR_UP, cfg, depth + 1);
  if (dir !== DIR_LEFT) createBlock(mask, rng, x2, y1, bh, DIR_RIGHT, cfg, depth + 1);
  if (dir !== DIR_UP) createBlock(mask, rng, x1, y2, bw, DIR_DOWN, cfg, depth + 1);
  if (dir !== DIR_RIGHT) createBlock(mask, rng, x1, y1, bh, DIR_LEFT, cfg, depth + 1);
}

function countMask(mask) {
  let n = 0;
  for (let i = 0; i < mask.m.length; i++) n += mask.m[i];
  return n;
}

function grow(mask, rng, cfg) {
  const { w, h } = mask;
  const x1 = rng.range(Math.floor(w * cfg.seedBand[0]), Math.floor(w * cfg.seedBand[1]));
  const y1 = rng.range(Math.floor(h * cfg.seedBand[0]), Math.floor(h * cfg.seedBand[1]));
  fillRoom(mask, rng, x1, y1, x1 + 2, y1 + 2, cfg);
  createBlock(mask, rng, x1, y1, 2, DIR_UP, cfg, 0);
  createBlock(mask, rng, x1 + 2, y1, 2, DIR_RIGHT, cfg, 0);
  createBlock(mask, rng, x1, y1 + 2, 2, DIR_DOWN, cfg, 0);
  createBlock(mask, rng, x1, y1, 2, DIR_LEFT, cfg, 0);
  for (let t = 0; t < cfg.growTries && countMask(mask) < cfg.targetFloor; t++) {
    const x = rng.range(2, w - 3);
    const y = rng.range(2, h - 3);
    if (mask.get(x, y)) createBlock(mask, rng, x, y, 2, rng.rand(4), cfg, 0);
  }
}

function neighbours8(mask, x, y) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && mask.get(x + dx, y + dy)) n++;
  return n;
}

/** Cellular smoothing: birth at >= smoothBirth floor neighbours, death at <= smoothDeath. */
function smooth(mask, cfg) {
  for (let pass = 0; pass < cfg.smoothPasses; pass++) {
    const next = new Uint8Array(mask.m);
    for (let y = 1; y < mask.h - 1; y++) {
      for (let x = 1; x < mask.w - 1; x++) {
        const n = neighbours8(mask, x, y);
        if (n >= cfg.smoothBirth) next[y * mask.w + x] = 1;
        else if (n <= cfg.smoothDeath) next[y * mask.w + x] = 0;
      }
    }
    mask.m.set(next);
  }
}

/** Reference FillDiagonals: break diagonal-only connections (pathfinding forbids corner cutting). */
function fillDiagonals(mask, rng) {
  for (let y = 0; y < mask.h - 1; y++) {
    for (let x = 0; x < mask.w - 1; x++) {
      const v = mask.get(x + 1, y + 1) + 2 * mask.get(x, y + 1) + 4 * mask.get(x + 1, y) + 8 * mask.get(x, y);
      if (v === DIAG_ANTI) { if (rng.chance(HALF_PCT)) mask.set(x, y, 1); else mask.set(x + 1, y + 1, 1); }
      else if (v === DIAG_MAIN) { if (rng.chance(HALF_PCT)) mask.set(x + 1, y, 1); else mask.set(x, y + 1, 1); }
    }
  }
}

function keepLargest(mask) {
  const { labels, sizes } = components(mask.w, mask.h, (i) => mask.m[i] === 1);
  const keep = largestComponent(sizes);
  for (let i = 0; i < mask.m.length; i++) if (labels[i] !== keep) mask.m[i] = 0;
}

function clearEdges(mask) {
  for (let x = 0; x < mask.w; x++) { mask.set(x, 0, 0); mask.set(x, mask.h - 1, 0); }
  for (let y = 0; y < mask.h; y++) { mask.set(0, y, 0); mask.set(mask.w - 1, y, 0); }
}

/** Enclosed rock regions (not touching the edge, poolMin..poolMax cells) become water. */
function placePools(mask, tiles, rng, cfg, waterFloor) {
  const { labels, sizes, touchesEdge } = components(mask.w, mask.h, (i) => mask.m[i] === 0);
  const candidates = [];
  for (let l = 1; l < sizes.length; l++) if (!touchesEdge[l] && sizes[l] >= cfg.poolMin && sizes[l] <= cfg.poolMax) candidates.push(l);
  rng.shuffle(candidates);
  const n = Math.min(candidates.length, rng.range(cfg.pools[0], cfg.pools[1]));
  const chosen = new Set(candidates.slice(0, n));
  for (let i = 0; i < labels.length; i++) {
    if (!chosen.has(labels[i])) continue;
    tiles.floor[i] = waterFloor;
    tiles.wall[i] = 0;
    tiles.flags[i] = T.WATER | T.SOLID;
    tiles.variant[i] = rng.rand(2 ** 8);
  }
  return n;
}

/** A straight 1-tile fence spanning wall to wall across open floor, with one gap. */
function placeFences(tiles, rng, cfg) {
  const n = rng.range(cfg.fences[0], cfg.fences[1]);
  let placed = 0;
  for (let t = 0; t < cfg.fenceTries && placed < n; t++) {
    const x = rng.range(2, tiles.w - 3);
    const y = rng.range(2, tiles.h - 3);
    if (!isFloor(tiles, x, y)) continue;
    const horiz = rng.chance(HALF_PCT);
    const dx = horiz ? 1 : 0;
    const dy = horiz ? 0 : 1;
    let a = 0;
    while (isFloor(tiles, x - (a + 1) * dx, y - (a + 1) * dy)) a++;
    let b = 0;
    while (isFloor(tiles, x + (b + 1) * dx, y + (b + 1) * dy)) b++;
    const span = a + b + 1;
    if (span < cfg.fenceSpan[0] || span > cfg.fenceSpan[1]) continue;
    const cells = [];
    for (let k = -a; k <= b; k++) cells.push({ x: x + k * dx, y: y + k * dy });
    const gaps = cells.filter((c) => isFloor(tiles, c.x + dy, c.y + dx) && isFloor(tiles, c.x - dy, c.y - dx));
    if (!gaps.length) continue;
    const gap = rng.pick(gaps);
    for (const c of cells) if (c !== gap) setWall(tiles, c.x, c.y, FENCE_STYLE);
    // A fence laid along a corridor would sever it: keep the floor a single component or revert.
    const { sizes } = components(tiles.w, tiles.h, (i) => isFloor(tiles, i % tiles.w, (i / tiles.w) | 0));
    if (sizes.length - 1 > 1) { for (const c of cells) if (c !== gap) carveRect(tiles, rng, c.x, c.y, 1, 1, FLOOR); continue; }
    placed++;
  }
}

/** Walled theme cells: interior 5..7, walls, and one door on the bottom or right wall middle. */
function placeCells(tiles, rng, cfg, rooms, doorSpecs) {
  const n = rng.range(cfg.cells[0], cfg.cells[1]);
  for (let t = 0, placed = 0; t < cfg.cellTries && placed < n; t++) {
    const iw = rng.range(cfg.cellInner[0], cfg.cellInner[1]);
    const ih = rng.range(cfg.cellInner[0], cfg.cellInner[1]);
    const bx = rng.range(2, tiles.w - iw - 6);
    const by = rng.range(2, tiles.h - ih - 6);
    if (!rectAll(bx - 1, by - 1, iw + 4, ih + 4, (x, y) => isFloor(tiles, x, y))) continue;
    const room = { x: bx + 1, y: by + 1, w: iw, h: ih, kind: 'cell' };
    if (rooms.some((r) => rectsOverlap(r, room, 2))) continue;
    for (let y = by; y < by + ih + 2; y++) for (let x = bx; x < bx + iw + 2; x++) if (!(x > bx && x < bx + iw + 1 && y > by && y < by + ih + 1)) setWall(tiles, x, y, ROCK_STYLE);
    const door = rng.chance(HALF_PCT) ? { x: bx + 1 + (iw >> 1), y: by + ih + 1 } : { x: bx + iw + 1, y: by + 1 + (ih >> 1) };
    carveRect(tiles, rng, door.x, door.y, 1, 1, FLOOR);
    setFlag(tiles, door.x, door.y, T.DOOR);
    doorSpecs.push(door);
    rooms.push(room);
    placed++;
  }
}

/** Open all-floor squares usable as "rooms" by the populate step. */
function findOpenRooms(tiles, rng, cfg, rooms) {
  const s = cfg.openRoomSize;
  const origins = [];
  for (let y = 2; y < tiles.h - s - 2; y += 2) for (let x = 2; x < tiles.w - s - 2; x += 2) origins.push({ x, y });
  rng.shuffle(origins);
  let found = 0;
  for (const o of origins) {
    if (found >= cfg.openRooms) break;
    const r = { x: o.x, y: o.y, w: s, h: s, kind: 'open' };
    if (!rectAll(r.x, r.y, s, s, (x, y) => isFloor(tiles, x, y)) || rooms.some((q) => rectsOverlap(q, r, 2))) continue;
    rooms.push(r);
    found++;
  }
}

/**
 * Generate a cave level.
 * @param {object} rng forked rng
 * @param {number} w
 * @param {number} h
 * @param {{waterFloor?:number}} [opts] waterFloor = floor index used for pools; plus balance.levels.caves overrides
 * @returns {{ tiles:object, rooms:Array<{x:number,y:number,w:number,h:number,kind:string}>, doorSpecs:Array<{x:number,y:number}>, corridorFloor:number }}
 */
export function generateCaves(rng, w, h, opts = {}) {
  const cfg = { ...LEVELS.caves, waterFloor: FLOOR_ALT + 1, ...opts };
  const mask = makeMask(w, h);
  grow(mask, rng, cfg);
  smooth(mask, cfg);
  fillDiagonals(mask, rng);
  clearEdges(mask);
  keepLargest(mask);
  const tiles = createTiles(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask.get(x, y)) carveRect(tiles, rng, x, y, 1, 1, FLOOR);
  placePools(mask, tiles, rng, cfg, cfg.waterFloor);
  raiseWalls(tiles, ROCK_STYLE);
  const rooms = [];
  const doorSpecs = [];
  placeFences(tiles, rng, cfg);
  placeCells(tiles, rng, cfg, rooms, doorSpecs);
  findOpenRooms(tiles, rng, cfg, rooms);
  sprinkleFloor(tiles, rng, FLOOR, FLOOR_ALT, cfg.floorAltPct);
  return { tiles, rooms, doorSpecs, corridorFloor: 0 };
}

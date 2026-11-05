/**
 * Generator "rooms" (reference A/B hybrid): BSP leaves 6..12 tiles, one room
 * per leaf with a 1-tile margin, sibling subtrees joined by L-shaped or
 * random-walk corridors (reference re-aim probabilities), doors carved where a
 * corridor pierces a room wall, and 0..3 pillared 10x10 chambers.
 *
 * Output tiles: floor 1 = room, 2 = room variant, 3 = corridor; wall style 1
 * = wall, 2 = pillar; door tiles keep floor and carry T.DOOR.
 */
import { createTiles, T, idx, inBounds, setFlag, hasFlag } from '../tiles.js';
import { carveRect, raiseWalls, setWall, sprinkleFloor, isFloor, rectContains } from './grid.js';
import { LEVELS } from '../../../data/balance/levels.js';

export const ROOM_FLOOR = 1;
export const ROOM_FLOOR_ALT = 2;
export const CORRIDOR_FLOOR = 3;
const WALL_STYLE = 1;
const PILLAR_STYLE = 2;
const ASPECT_SPLIT = 1.25;
const HALF_PCT = 50;
const AXIS_H = 0;
const AXIS_V = 1;

function splitNode(node, rng, cfg, out) {
  const fitsW = node.w >= 2 * cfg.leafMin - 1;
  const fitsH = node.h >= 2 * cfg.leafMin - 1;
  const forced = node.w > cfg.leafMax || node.h > cfg.leafMax;
  if ((!fitsW && !fitsH) || (!forced && !rng.chance(cfg.splitPct))) { out.push(node); return node; }
  let axis;
  if (fitsW && !fitsH) axis = AXIS_V;
  else if (fitsH && !fitsW) axis = AXIS_H;
  else if (node.w > node.h * ASPECT_SPLIT) axis = AXIS_V;
  else if (node.h > node.w * ASPECT_SPLIT) axis = AXIS_H;
  else axis = rng.chance(HALF_PCT) ? AXIS_V : AXIS_H;
  // Children share the boundary column/row so rooms end up one wall apart.
  if (axis === AXIS_V) {
    const s = rng.range(cfg.leafMin - 1, node.w - cfg.leafMin);
    node.a = { x: node.x, y: node.y, w: s + 1, h: node.h };
    node.b = { x: node.x + s, y: node.y, w: node.w - s, h: node.h };
  } else {
    const s = rng.range(cfg.leafMin - 1, node.h - cfg.leafMin);
    node.a = { x: node.x, y: node.y, w: node.w, h: s + 1 };
    node.b = { x: node.x, y: node.y + s, w: node.w, h: node.h - s };
  }
  splitNode(node.a, rng, cfg, out);
  splitNode(node.b, rng, cfg, out);
  return node;
}

function makeRoom(leaf, rng, cfg) {
  if (leaf.chamber) {
    const s = cfg.chamberSize;
    return { x: leaf.x + 1 + rng.rand(leaf.w - 2 - s + 1), y: leaf.y + 1 + rng.rand(leaf.h - 2 - s + 1), w: s, h: s, kind: 'chamber' };
  }
  if (rng.chance(cfg.skipRoomPct)) return null;
  const maxW = leaf.w - 2;
  const maxH = leaf.h - 2;
  const side = (max) => { let best = 0; for (let i = 0; i < cfg.roomRolls; i++) best = Math.max(best, rng.range(Math.min(cfg.roomMin, max), max)); return best; };
  const w = side(maxW);
  const h = side(maxH);
  return { x: leaf.x + 1 + rng.rand(maxW - w + 1), y: leaf.y + 1 + rng.rand(maxH - h + 1), w, h, kind: 'room' };
}

function carveStep(tiles, rng, x, y) {
  if (!inBounds(tiles, x, y)) return;
  const i = idx(tiles, x, y);
  if (tiles.floor[i] === 0) carveRect(tiles, rng, x, y, 1, 1, CORRIDOR_FLOOR);
}

function carveL(tiles, rng, a, b) {
  const horizontalFirst = rng.chance(HALF_PCT);
  let x = a.x;
  let y = a.y;
  const stepX = () => { while (x !== b.x) { x += Math.sign(b.x - x); carveStep(tiles, rng, x, y); } };
  const stepY = () => { while (y !== b.y) { y += Math.sign(b.y - y); carveStep(tiles, rng, x, y); } };
  carveStep(tiles, rng, x, y);
  if (horizontalFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
}

/** Random-walk corridor with the reference re-aim rules; finishes with an L if the cap is hit. */
function carveWalk(tiles, rng, a, b, cfg) {
  let x = a.x;
  let y = a.y;
  let dir = Math.abs(b.x - x) >= Math.abs(b.y - y) ? [Math.sign(b.x - x) || 1, 0] : [0, Math.sign(b.y - y) || 1];
  const maxSteps = cfg.maxWalkMult * (tiles.w + tiles.h);
  carveStep(tiles, rng, x, y);
  for (let step = 0; step < maxSteps && (x !== b.x || y !== b.y); step++) {
    const dx = Math.abs(b.x - x);
    const dy = Math.abs(b.y - y);
    if (dx === 0) dir = [0, Math.sign(b.y - y)];
    else if (dy === 0) dir = [Math.sign(b.x - x), 0];
    else if (dx > dy) { if (rng.chance(Math.min(cfg.reaimH[0] * dx, cfg.reaimH[1]))) dir = [Math.sign(b.x - x), 0]; }
    else if (rng.chance(Math.min(cfg.reaimV[0] * dy, cfg.reaimV[1]))) dir = [0, Math.sign(b.y - y)];
    if (rng.chance(cfg.driftPct)) dir = dir[0] ? [0, rng.chance(HALF_PCT) ? 1 : -1] : [rng.chance(HALF_PCT) ? 1 : -1, 0];
    let nx = x + dir[0];
    let ny = y + dir[1];
    if (nx < 1 || ny < 1 || nx > tiles.w - 2 || ny > tiles.h - 2) {
      dir = dir[0] ? [Math.sign(b.x - x) || -dir[0], 0] : [0, Math.sign(b.y - y) || -dir[1]];
      nx = x + dir[0];
      ny = y + dir[1];
    }
    x = nx;
    y = ny;
    carveStep(tiles, rng, x, y);
  }
  if (x !== b.x || y !== b.y) carveL(tiles, rng, { x, y }, b);
}

function pointIn(room, rng) {
  return { x: room.x + rng.rand(room.w), y: room.y + rng.rand(room.h) };
}

function connect(node, tiles, rng, cfg) {
  if (!node.a) return node.room || null;
  const ra = connect(node.a, tiles, rng, cfg);
  const rb = connect(node.b, tiles, rng, cfg);
  if (ra && rb) {
    const from = pointIn(ra, rng);
    const to = pointIn(rb, rng);
    if (rng.chance(cfg.randomWalkPct)) carveWalk(tiles, rng, from, to, cfg);
    else carveL(tiles, rng, from, to);
  }
  if (!ra) return rb;
  if (!rb) return ra;
  return rng.chance(HALF_PCT) ? ra : rb;
}

/** Remove dead-end corridor stubs and isolated wall nubs left by the random walk. */
function tidyCorridors(tiles) {
  const floorN4 = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isFloor(tiles, x + dx, y + dy)).length;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < tiles.h - 1; y++) {
      for (let x = 1; x < tiles.w - 1; x++) {
        const i = idx(tiles, x, y);
        if (tiles.floor[i] !== CORRIDOR_FLOOR || floorN4(x, y) > 1) continue;
        tiles.floor[i] = 0;
        changed = true;
      }
    }
  }
  for (let y = 1; y < tiles.h - 1; y++) {
    for (let x = 1; x < tiles.w - 1; x++) {
      const i = idx(tiles, x, y);
      if (tiles.floor[i] === 0 && floorN4(x, y) >= 3) tiles.floor[i] = CORRIDOR_FLOOR;
    }
  }
}

/** A corridor tile on a room's wall ring that forms a proper 1-wide doorway. */
function doorwayAt(tiles, room, x, y) {
  if (!isFloor(tiles, x, y) || tiles.floor[idx(tiles, x, y)] !== CORRIDOR_FLOOR) return false;
  const onX = x === room.x - 1 || x === room.x + room.w;      // vertical wall (west/east)
  const onY = y === room.y - 1 || y === room.y + room.h;      // horizontal wall (north/south)
  if (onX === onY) return false;                               // corner
  if (onY) return !isFloor(tiles, x - 1, y) && !isFloor(tiles, x + 1, y) && isFloor(tiles, x, y - 1) && isFloor(tiles, x, y + 1);
  return !isFloor(tiles, x, y - 1) && !isFloor(tiles, x, y + 1) && isFloor(tiles, x - 1, y) && isFloor(tiles, x + 1, y);
}

function carveDoors(tiles, rooms, rng, cfg) {
  const specs = [];
  for (const room of rooms) {
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        if (rectContains(room, x, y) || !doorwayAt(tiles, room, x, y)) continue;
        if (hasFlag(tiles, x - 1, y, T.DOOR) || hasFlag(tiles, x + 1, y, T.DOOR) || hasFlag(tiles, x, y - 1, T.DOOR) || hasFlag(tiles, x, y + 1, T.DOOR)) continue;
        if (!rng.chance(cfg.doorPct)) continue;
        setFlag(tiles, x, y, T.DOOR);
        specs.push({ x, y });
      }
    }
  }
  return specs;
}

/**
 * Generate a rooms-and-corridors level.
 * @param {object} rng forked rng
 * @param {number} w
 * @param {number} h
 * @param {object} [opts] overrides for balance.levels.rooms
 * @returns {{ tiles:object, rooms:Array<{x:number,y:number,w:number,h:number,kind:string}>, doorSpecs:Array<{x:number,y:number}>, corridorFloor:number }}
 */
export function generateRooms(rng, w, h, opts = {}) {
  const cfg = { ...LEVELS.rooms, ...opts };
  const tiles = createTiles(w, h);
  const leaves = [];
  const root = splitNode({ x: 1, y: 1, w: w - 2, h: h - 2 }, rng, cfg, leaves);
  const big = rng.shuffle(leaves.filter((l) => l.w >= cfg.chamberSize + 2 && l.h >= cfg.chamberSize + 2));
  const nChambers = Math.min(rng.range(cfg.chambers[0], cfg.chambers[1]), big.length);
  for (let i = 0; i < nChambers; i++) big[i].chamber = true;
  const rooms = [];
  for (const leaf of leaves) {
    const room = makeRoom(leaf, rng, cfg);
    if (!room) continue;
    leaf.room = room;
    rooms.push(room);
    carveRect(tiles, rng, room.x, room.y, room.w, room.h, ROOM_FLOOR);
  }
  connect(root, tiles, rng, cfg);
  const extra = rng.range(cfg.extraCorridors[0], cfg.extraCorridors[1]);
  for (let i = 0; i < extra && rooms.length > 1; i++) {
    const a = rng.pick(rooms);
    const b = rng.pick(rooms);
    if (a === b || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > cfg.extraMaxDist) continue;
    carveL(tiles, rng, pointIn(a, rng), pointIn(b, rng));
  }
  tidyCorridors(tiles);
  sprinkleFloor(tiles, rng, ROOM_FLOOR, ROOM_FLOOR_ALT, cfg.floorAltPct);
  raiseWalls(tiles, WALL_STYLE);
  for (const room of rooms) {
    if (room.kind !== 'chamber') continue;
    for (const [px, py] of cfg.pillarOffsets) setWall(tiles, room.x + px, room.y + py, PILLAR_STYLE);
  }
  const doorSpecs = carveDoors(tiles, rooms, rng, cfg);
  return { tiles, rooms, doorSpecs, corridorFloor: CORRIDOR_FLOOR };
}

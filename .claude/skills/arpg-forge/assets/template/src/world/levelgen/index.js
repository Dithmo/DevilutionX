/**
 * Level generation entry point.
 *
 *   generateLevel(game, depth) -> Level      (depth 0 = hub town)
 *
 * Picks the tier for the depth, derives a deterministic seed from
 * `game.seed ^ hashString('level' + depth)`, runs the tileset's generator in
 * a retry loop (floor count, stairs ≥ minDist apart, connected by BFS, not in
 * doorways/corridors), then hands the layout to populateLevel. Always returns
 * a level: after maxAttempts the best layout is used with relaxed stairs.
 */
import { createRng, hashString } from '../../core/rng.js';
import { createTiles, T, idx, hasFlag, countFloor } from '../tiles.js';
import { createLightMap } from '../fov.js';
import { generateRooms } from './rooms.js';
import { generateHalls } from './halls.js';
import { generateCaves } from './caves.js';
import { populateLevel, freeTileNear } from './populate.js';
import { bfsDistances, isFloor, isWalkableLevel, rectContains } from './grid.js';
import { buildTown } from '../town.js';
import { LEVELS } from '../../../data/balance/levels.js';

export { setLevelDeps, levelDepsReady, deps as levelDeps } from './deps.js';
export { freeTileNear };

const GENERATORS = { rooms: generateRooms, halls: generateHalls, caves: generateCaves };
const STAIR_ROOM_KINDS = new Set(['room', 'chamber', 'open', 'alcove']);
const HEX_SHORT = 4;
const HEX_MAX = 255;
const HEX_RADIX = 16;
const DEG_WHITE = '#ffffff';

const bal = (game) => game.balance?.levels || LEVELS;

/** Multiply a CSS hex colour by a factor (clamped). @returns {string} */
export function mulColor(hex, f) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex;
  const h = hex.length === HEX_SHORT ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  const parts = [0, 2, 4].map((i) => Math.max(0, Math.min(HEX_MAX, Math.round(parseInt(h.slice(i, i + 2), HEX_RADIX) * f))));
  return `#${parts.map((v) => v.toString(HEX_RADIX).padStart(2, '0')).join('')}`;
}

/**
 * Render palette for a tileset (render/iso.js shape): floors [[base, speckle]], walls [[left, right, top]], stairs {color, color2}.
 * @param {object} tileset
 * @param {object} [cfg] balance.levels.palette
 * @returns {{floors:string[][], walls:string[][], stairs:{color:string,color2:string}, door:string, void:string, lightTint:string}}
 */
export function paletteFor(tileset, cfg = LEVELS.palette) {
  const floors = tileset.floors.map((c) => [c, mulColor(c, cfg.speckle)]);
  if (tileset.water) floors.push([tileset.water, mulColor(tileset.water, cfg.waterSpeckle)]);
  const walls = tileset.walls.map((c) => [c, mulColor(c, cfg.wallRight), mulColor(c, cfg.wallTop)]);
  const accent = tileset.accent || DEG_WHITE;
  return { floors, walls, stairs: { color: accent, color2: mulColor(accent, cfg.stairsLight) }, door: tileset.doorColor, void: tileset.voidColor, lightTint: tileset.lightTint };
}

/** @returns {{tier:object, index:number}|null} tier whose depth band contains `depth` */
export function tierForDepth(theme, depth) {
  const i = (theme.tiers || []).findIndex((t) => depth >= t.depths[0] && depth <= t.depths[1]);
  return i < 0 ? null : { tier: theme.tiers[i], index: i };
}

/**
 * Allocate an empty Level record (docs/CONTRACTS.md shape) with void tiles.
 * @returns {object} Level
 */
export function createEmptyLevel(w, h, depth, tier, tilesetId) {
  const tiles = createTiles(w, h);
  const lm = createLightMap(tiles);
  return {
    depth, tier, tilesetId, tiles, light: lm.light, explored: lm.explored, lightMap: lm,
    occupant: new Int32Array(w * h), monsters: [], objects: [], items: [], missiles: [], npcs: [],
    stairs: { up: null, down: null, town: null }, entry: { x: 0, y: 0 }, rooms: [], doorSpecs: [],
    seed: 0, visited: false, cleared: false, portal: null, lights: [], questStamps: [], isTown: false, name: '',
  };
}

/**
 * Walkable for an actor: in bounds, floor, not solid, no solid object, no occupant.
 * @returns {boolean}
 */
export function isWalkable(level, x, y) {
  return isWalkableLevel(level, x, y);
}

/** Tiles with a 3x3 floor neighbourhood, no door nearby, not corridor, preferably inside rooms. */
function stairCandidates(out) {
  const { tiles, rooms, corridorFloor } = out;
  const roomList = rooms.filter((r) => STAIR_ROOM_KINDS.has(r.kind));
  const inRoom = (x, y) => roomList.some((r) => rectContains(r, x, y));
  const cands = [];
  for (let y = 1; y < tiles.h - 1; y++) {
    for (let x = 1; x < tiles.w - 1; x++) {
      if (!isFloor(tiles, x, y) || (corridorFloor && tiles.floor[idx(tiles, x, y)] === corridorFloor)) continue;
      if (roomList.length && !inRoom(x, y)) continue;
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!isFloor(tiles, x + dx, y + dy) || hasFlag(tiles, x + dx, y + dy, T.DOOR)) { ok = false; break; }
      if (ok) cands.push({ x, y });
    }
  }
  return cands;
}

/** Pick up/down stairs: Chebyshev >= minDist, connected, down among the farthest half. @returns {{up,down}|null} */
function pickStairs(out, rng, cfg, needDown, minDist) {
  const cands = rng.shuffle(stairCandidates(out));
  if (!cands.length) return null;
  const upTries = Math.min(cands.length, cfg.upTries || cands.length);
  for (let u = 0; u < upTries; u++) {
    const up = cands[u];
    if (!needDown) return { up, down: null };
    const dist = bfsDistances(out.tiles, up.x, up.y);
    const far = cands
      .filter((c) => dist[idx(out.tiles, c.x, c.y)] >= 0 && Math.max(Math.abs(c.x - up.x), Math.abs(c.y - up.y)) >= minDist)
      .sort((a, b) => dist[idx(out.tiles, b.x, b.y)] - dist[idx(out.tiles, a.x, a.y)]);
    if (!far.length) continue;
    const down = far[rng.rand(Math.max(1, Math.ceil(far.length * cfg.farFraction)))];
    return { up, down };
  }
  return null;
}

function walkableFloor(tiles) {
  let n = 0;
  for (let y = 0; y < tiles.h; y++) for (let x = 0; x < tiles.w; x++) if (isFloor(tiles, x, y)) n++;
  return n;
}

/**
 * Generate (or build, for depth 0) a fully populated level.
 * @param {object} game needs seed, theme, balance?, bus, rng, hooks?
 * @param {number} depth 0 = town
 * @returns {object} Level
 */
export function generateLevel(game, depth) {
  if (depth === 0) return buildTown(game);
  const theme = game.theme;
  const cfg = bal(game);
  const found = tierForDepth(theme, depth);
  if (!found) throw new Error(`generateLevel: no tier covers depth ${depth}`);
  const { tier, index: tierIndex } = found;
  const tileset = theme.tilesets.find((t) => t.id === tier.tilesetId);
  if (!tileset) throw new Error(`generateLevel: unknown tileset ${tier.tilesetId}`);
  const generator = GENERATORS[tileset.generator];
  if (!generator) throw new Error(`generateLevel: unknown generator ${tileset.generator}`);
  const genOpts = { ...(tileset.genOpts || {}), waterFloor: tileset.floors.length + 1 };
  const family = tileset.generator === 'halls' && genOpts.mirror ? 'mirrored' : tileset.generator;
  const [w, h] = cfg.grid[family];
  const minFloor = cfg.minFloor[family];
  const needDown = depth < (theme.maxDepth || theme.tiers[theme.tiers.length - 1].depths[1]);
  const seed = (game.seed ^ hashString(`level${depth}`)) >>> 0;
  const rng = createRng(seed);

  let accepted = null;
  let best = null;
  let attempts = 0;
  for (; attempts < cfg.maxAttempts && !accepted; attempts++) {
    const layoutRng = rng.fork(`layout:${attempts}`);
    const out = generator(layoutRng, w, h, genOpts);
    const floor = walkableFloor(out.tiles);
    if (!best || floor > best.floor) best = { out, floor, rng: layoutRng };
    if (floor < minFloor) continue;
    const stairs = pickStairs(out, layoutRng, cfg.stairs, needDown, cfg.stairs.minDist);
    if (!stairs) continue;
    accepted = { out, stairs, floor, relaxed: false };
  }
  if (!accepted) {
    const stairs = pickStairs(best.out, best.rng, cfg.stairs, needDown, 1) || { up: stairCandidates(best.out)[0] || { x: 1, y: 1 }, down: null };
    accepted = { out: best.out, stairs, floor: best.floor, relaxed: true };
  }

  const level = createEmptyLevel(w, h, depth, tierIndex, tileset.id);
  level.tiles = accepted.out.tiles;
  level.rooms = accepted.out.rooms;
  level.doorSpecs = accepted.out.doorSpecs;
  level.stairs = { up: accepted.stairs.up, down: accepted.stairs.down, town: null };
  level.seed = seed;
  level.tierId = tier.id;
  level.attempts = attempts;
  level.relaxed = accepted.relaxed;
  level.floorCount = accepted.floor;
  level.palette = paletteFor(tileset, cfg.palette);
  level.name = theme.flavor?.levelName?.(depth, tier.name) || `${tier.name}, depth ${depth}`;
  const near = (p) => (p ? freeTileNear(level, p.x, p.y, cfg.stairs.entrySearch, (x, y) => !hasFlag(level.tiles, x, y, T.STAIRS_UP | T.STAIRS_DOWN)) || p : null);
  level.entry = near(level.stairs.up);          // set before populate: monster placement keeps clear of it
  level.entryBelow = near(level.stairs.down);
  // Reference behaviour: re-seed the simulation rng before population so monsters/items
  // (placed by other modules through game.rng) are reproducible from the level seed alone.
  const savedRng = game.rng;
  game.rng = rng.fork('sim');
  try { populateLevel(game, level, tier, rng.fork('populate')); } finally { game.rng = savedRng; }
  level.entry = near(level.stairs.up);
  level.entryBelow = near(level.stairs.down);
  level.exploredAtStart = countFloor(level.tiles);
  return level;
}

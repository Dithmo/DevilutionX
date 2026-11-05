/**
 * DEMO content proving the core works without the game modules.
 *
 * The integrator replaces `buildDemoLevel` with the real level generator
 * (world/levelgen) and `updateDemo` / `handleDemoClick` with the real
 * player + monster simulation. Nothing in here is referenced by the core.
 */
import { createTiles, T, setFlag, idx, isWalkable, inBounds } from './world/tiles.js';
import { createLightMap } from './world/fov.js';
import { findPath, dirFromDelta } from './world/pathfind.js';
import { worldPos } from './render/camera.js';

const LEVEL_W = 40;
const LEVEL_H = 40;
const FOV_RADIUS = 8;
const PLAYER_SPEED = 0.2; // tiles per tick
const DUMMY_SPEED = 0.12;
const WANDER_WAIT = [20, 70];
const WANDER_RANGE = 5;
const WANDER_TRIES = 8;
const NEAREST_SEARCH = 6;
const MOVE_EPS = 1e-6;
const HALF = 0.5;
const CORRIDOR_FLOOR = 2;
const ROOM_FLOOR = 1;
const WALL_STYLE = 1;
const VARIANTS = 256;
const HUD_FONT = '12px monospace';
const HUD_COLOR = '#c8c0a8';
const HUD_X = 10;
const HUD_Y = 18;
const HUD_LINE = 16;
// [x, y, w, h] interior floor rectangles
const ROOMS = [
  [3, 3, 12, 10], [21, 4, 10, 8], [5, 20, 9, 9], [22, 20, 14, 12], [15, 14, 6, 5],
];
const DUMMIES = [
  { room: 1, look: { silhouette: 'lean', bodyColor: '#7aa86c', trimColor: '#2e3d2a' } },
  { room: 2, look: { silhouette: 'crawler', bodyColor: '#a85c5c', trimColor: '#3d2222' } },
  { room: 3, look: { silhouette: 'flier', bodyColor: '#6c8ab0', trimColor: '#222d3d' } },
];
const DEMO_OBJECTS = [
  { room: 0, dx: -4, dy: -3, kind: 'chest', state: 'closed', look: { color: '#8a6a3a', color2: '#d4b24a' } },
  { room: 0, dx: 4, dy: 3, kind: 'breakable', state: 'intact', look: { color: '#7a5a3a', color2: '#3a2a1a' } },
  { room: 3, dx: -5, dy: 4, kind: 'altar', state: 'active', look: { color: '#6a6a7a', color2: '#c8c8ff' } },
  { room: 3, dx: 5, dy: -4, kind: 'portal', state: 'active', look: { color: '#80d0ff', color2: '#2040a0' } },
  { room: 2, dx: 0, dy: 3, kind: 'sign', state: '', look: { color: '#5a4020', color2: '#a08050' } },
];
const DEMO_ITEMS = [
  { room: 0, dx: 2, dy: -2, look: { glyph: 'blade', color: '#d0d0d8', color2: '#6f5a3a' } },
  { room: 0, dx: -2, dy: 2, look: { glyph: 'flask', color: '#e8e8f0', color2: '#c03030' } },
  { room: 4, dx: 0, dy: 0, look: { glyph: 'coin', color: '#e0c040', color2: '#a08020' } },
];
const PLAYER_LOOK = { silhouette: 'bulky', bodyColor: '#c8a060', trimColor: '#444444' };

let nextId = 1;

function roomCentre(r) {
  return { x: r[0] + (r[2] >> 1), y: r[1] + (r[3] >> 1) };
}

function carveRect(tiles, rng, x0, y0, w, h, floor) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!inBounds(tiles, x, y)) continue;
      const i = idx(tiles, x, y);
      tiles.floor[i] = floor;
      tiles.variant[i] = rng.rand(VARIANTS);
    }
  }
}

function carveCorridor(tiles, rng, a, b) {
  const xStep = Math.sign(b.x - a.x);
  for (let x = a.x; x !== b.x; x += xStep) carveRect(tiles, rng, x, a.y, 1, 1, CORRIDOR_FLOOR);
  const yStep = Math.sign(b.y - a.y);
  for (let y = a.y; y !== b.y + yStep; y += yStep) carveRect(tiles, rng, b.x, y, 1, 1, CORRIDOR_FLOOR);
}

/** Every void tile touching a floor becomes a solid wall. */
function raiseWalls(tiles) {
  for (let y = 0; y < tiles.h; y++) {
    for (let x = 0; x < tiles.w; x++) {
      const i = idx(tiles, x, y);
      if (tiles.floor[i]) continue;
      let touches = false;
      for (let ny = y - 1; ny <= y + 1 && !touches; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          if (inBounds(tiles, nx, ny) && tiles.floor[idx(tiles, nx, ny)]) { touches = true; break; }
        }
      }
      if (touches) {
        tiles.wall[i] = WALL_STYLE;
        setFlag(tiles, x, y, T.SOLID | T.BLOCKS_LIGHT);
      }
    }
  }
}

/**
 * Create a demo actor. kind: 'player'|'monster'|'npc'.
 * @returns {object}
 */
export function createActor(kind, tx, ty, look, speed) {
  return {
    id: nextId++, kind, tx, ty, ox: 0, oy: 0, dir: 0, anim: 'stand', frame: 0, look,
    dead: false, path: null, moveT: 0, from: null, speed, z: 0, prevX: tx + HALF, prevY: ty + HALF, wait: 0,
  };
}

/**
 * Build the 40x40 test level: rooms + corridors + walls + stairs + props.
 * Replace this with the real generator (world/levelgen) in the final game.
 * @param {object} game needs game.rng
 * @returns {object} level
 */
export function buildDemoLevel(game) {
  const rng = game.rng.fork('demo-level');
  const tiles = createTiles(LEVEL_W, LEVEL_H);
  for (const r of ROOMS) carveRect(tiles, rng, r[0], r[1], r[2], r[3], ROOM_FLOOR);
  for (let i = 0; i + 1 < ROOMS.length; i++) carveCorridor(tiles, rng, roomCentre(ROOMS[i]), roomCentre(ROOMS[i + 1]));
  raiseWalls(tiles);
  const up = roomCentre(ROOMS[0]);
  const down = roomCentre(ROOMS[3]);
  setFlag(tiles, up.x - 3, up.y - 2, T.STAIRS_UP);
  setFlag(tiles, down.x + 3, down.y + 2, T.STAIRS_DOWN);
  const lm = createLightMap(tiles);
  const level = {
    depth: 1, tier: 0, seedUsed: rng.seed, tiles, light: lm.light, explored: lm.explored, lightMap: lm,
    monsters: [], objects: [], items: [], missiles: [], npcs: [],
    stairs: { up: { x: up.x - 3, y: up.y - 2 }, down: { x: down.x + 3, y: down.y + 2 } },
    spawn: up,
  };
  for (const d of DUMMIES) {
    const c = roomCentre(ROOMS[d.room]);
    level.monsters.push(createActor('monster', c.x, c.y, d.look, DUMMY_SPEED));
  }
  for (const o of DEMO_OBJECTS) {
    const c = roomCentre(ROOMS[o.room]);
    level.objects.push({ id: nextId++, kind: o.kind, state: o.state, look: o.look, tx: c.x + o.dx, ty: c.y + o.dy, ox: 0, oy: 0 });
  }
  for (const it of DEMO_ITEMS) {
    const c = roomCentre(ROOMS[it.room]);
    level.items.push({ id: nextId++, look: it.look, tx: c.x + it.dx, ty: c.y + it.dy, ox: 0, oy: 0 });
  }
  return level;
}

/** @returns {object} the demo player standing on the level's spawn tile */
export function createDemoPlayer(game) {
  const s = game.level.spawn;
  return createActor('player', s.x, s.y, PLAYER_LOOK, PLAYER_SPEED);
}

function actorsOf(game) {
  return [game.player, ...game.level.monsters, ...game.level.npcs];
}

function makeOccupied(game, self) {
  const others = actorsOf(game).filter((a) => a && a !== self && !a.dead);
  const objects = game.level.objects;
  return (x, y) => {
    for (const a of others) if (a.tx === x && a.ty === y) return true;
    for (const o of objects) if (o.tx === x && o.ty === y && o.kind !== 'portal' && o.kind !== 'stairs') return true;
    return false;
  };
}

function nearestWalkable(tiles, x, y) {
  for (let r = 1; r <= NEAREST_SEARCH; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWalkable(tiles, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/**
 * Path an actor toward a tile (falls back to the nearest walkable tile).
 * @returns {boolean} true if a path was set
 */
export function setDestination(game, e, x, y) {
  const tiles = game.level.tiles;
  if (!inBounds(tiles, x, y)) return false;
  const occupied = makeOccupied(game, e);
  let path = findPath(tiles, { x: e.tx, y: e.ty }, { x, y }, { isBlocked: occupied });
  if (!path && !isWalkable(tiles, x, y)) {
    const alt = nearestWalkable(tiles, x, y);
    if (alt) path = findPath(tiles, { x: e.tx, y: e.ty }, alt, { isBlocked: occupied });
  }
  e.path = path && path.length ? path : null;
  return !!e.path;
}

/** Advance an actor one tick along its path (tx/ty switch at the midpoint). */
export function stepActor(game, e) {
  const w = worldPos(e);
  e.prevX = w.x;
  e.prevY = w.y;
  if (e.dead || !e.path) {
    // Only a finished walk resets the pose; other anims belong to whoever set them.
    if (e.anim === 'walk') { e.anim = 'stand'; e.frame = 0; }
    return;
  }
  const next = e.path[0];
  if (!e.moveT || !e.from) {
    e.moveT = 0;
    if (makeOccupied(game, e)(next.x, next.y)) { e.path = null; e.anim = 'stand'; return; }
    e.from = { x: e.tx, y: e.ty };
    e.dir = dirFromDelta(next.x - e.tx, next.y - e.ty);
  }
  e.anim = 'walk';
  e.frame = (e.frame || 0) + 1;
  e.moveT += e.speed || 0;
  const fx = e.from.x, fy = e.from.y;
  if (e.moveT >= 1 - MOVE_EPS) {
    e.tx = next.x; e.ty = next.y; e.ox = 0; e.oy = 0; e.moveT = 0;
    e.path.shift();
    if (!e.path.length) { e.path = null; e.anim = 'stand'; }
  } else if (e.moveT >= HALF) {
    e.tx = next.x; e.ty = next.y;
    e.ox = (fx - next.x) * (1 - e.moveT); e.oy = (fy - next.y) * (1 - e.moveT);
  } else {
    e.tx = fx; e.ty = fy;
    e.ox = (next.x - fx) * e.moveT; e.oy = (next.y - fy) * e.moveT;
  }
}

function wander(game, e, rng) {
  if (e.path) return;
  if (e.wait > 0) { e.wait--; return; }
  for (let i = 0; i < WANDER_TRIES; i++) {
    const x = e.tx + rng.range(-WANDER_RANGE, WANDER_RANGE);
    const y = e.ty + rng.range(-WANDER_RANGE, WANDER_RANGE);
    if (isWalkable(game.level.tiles, x, y) && setDestination(game, e, x, y)) break;
  }
  e.wait = rng.range(WANDER_WAIT[0], WANDER_WAIT[1]);
}

/** Left click = walk there. */
export function handleDemoClick(game, click) {
  if (click.button !== 0 || typeof click.wx !== 'number') return;
  setDestination(game, game.player, Math.floor(click.wx), Math.floor(click.wy));
}

/** One simulation tick of the demo. */
export function updateDemo(game) {
  for (const click of game.input.consumeClicks()) handleDemoClick(game, click);
  game.input.consumeKeyPresses();
  stepActor(game, game.player);
  for (const m of game.level.monsters) {
    wander(game, m, game.rng);
    stepActor(game, m);
  }
  for (const o of game.level.objects) if (o.kind === 'portal') o.look.frame = game.tick;
  game.level.lightMap.update([{ x: game.player.tx, y: game.player.ty, r: FOV_RADIUS }]);
}

/** Tiny text overlay for the demo. */
export function drawDemoHud(ctx, game, loop) {
  const p = game.player;
  ctx.font = HUD_FONT;
  ctx.fillStyle = HUD_COLOR;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`core demo - click to move  |  tick ${game.tick}  fps ${Math.round(loop.fps)}`, HUD_X, HUD_Y);
  ctx.fillText(`player ${p.tx},${p.ty} dir ${p.dir} ${p.anim}  |  seed ${game.seed}`, HUD_X, HUD_Y + HUD_LINE);
}

/**
 * World renderer: floors back-to-front, then walls / objects / actors /
 * missiles sorted by depth (x + y), plus screen-space picking helpers.
 *
 * Expects: game.camera, game.level.{tiles, light, explored, palette?,
 * monsters, objects, items, missiles, npcs}, game.player, game.renderAlpha.
 * Entities carry tx,ty,ox,oy (or x,y), dir, anim, frame, look, dead, z.
 * Objects additionally carry kind + state; items a glyph `look`.
 *
 * level.palette = { floors:[[base, speckle], ...], walls:[[left, right, top], ...],
 *                   stairs:{color,color2} } indexed by (floor-1) / (wall-1).
 */
import { worldToScreen, renderPos, worldPos, HALF_W, HALF_H } from './camera.js';
import { drawTile, drawWall, drawActor, drawItemGlyph, drawObject, drawMissile, drawTileOutline, lightFactor, WALL_H, TILE_W, TILE_H } from './sprites.js';
import { T, idx, inBounds } from '../world/tiles.js';

const DARK_LIGHT = 2; // explored but not currently lit
const HALF = 0.5;
const ITEM_SIZE = 20;
const PICK_RADIUS = 20;
const ACTOR_PICK_Y = 14;
const WALL_FADE_ALPHA = 0.45;
const PLAYER_HALF_W = 16;
const PLAYER_H = 48;
const KIND_WALL = 0;
const KIND_OBJECT = 1;
const KIND_ACTOR = 2;
const KIND_MISSILE = 3;
const DEFAULT_PALETTE = {
  floors: [['#5a5247', '#4a4339'], ['#4d4a44', '#3e3b36']],
  walls: [['#6b6358', '#4e473f', '#847b6e'], ['#5c5a66', '#45434d', '#7a7888']],
  stairs: { color: '#8c8478', color2: '#d8d0c0' },
};

function pick(list, i) {
  return list[((i % list.length) + list.length) % list.length];
}

function tileLight(level, x, y) {
  if (!inBounds(level.tiles, x, y)) return 0;
  const i = idx(level.tiles, x, y);
  if (!level.explored[i]) return 0;
  return level.light[i] > 0 ? level.light[i] : DARK_LIGHT;
}

function isWallLike(tiles, x, y) {
  if (!inBounds(tiles, x, y)) return false;
  const i = idx(tiles, x, y);
  return tiles.wall[i] > 0;
}

function wallSide(tiles, x, y) {
  const left = !isWallLike(tiles, x, y + 1);
  const right = !isWallLike(tiles, x + 1, y);
  if (left && right) return 'both';
  if (left) return 'left';
  if (right) return 'right';
  return 'none';
}

function pushEntities(list, entities, kind, level, cam, alpha, requireLit) {
  if (!entities) return;
  for (const e of entities) {
    if (e.removed) continue;
    const w = renderPos(e, alpha);
    const tx = Math.floor(w.x);
    const ty = Math.floor(w.y);
    const l = tileLight(level, tx, ty);
    if (l === 0 || (requireLit && l === DARK_LIGHT)) continue;
    const p = worldToScreen(w.x, w.y, cam);
    list.push({ d: w.x + w.y, x: w.x, kind, e, sx: Math.round(p.x), sy: Math.round(p.y - (e.z || 0)), l });
  }
}

function drawFloors(ctx, game, cam, b, pal) {
  const { tiles } = game.level;
  const list = [];
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = idx(tiles, x, y);
      if (!game.level.explored[i]) continue;
      const l = tileLight(game.level, x, y);
      const p = worldToScreen(x + HALF, y + HALF, cam);
      const sx = Math.round(p.x);
      const sy = Math.round(p.y);
      if (tiles.wall[i]) {
        list.push({ d: x + y + 1, x, kind: KIND_WALL, sx, sy, l, side: wallSide(tiles, x, y), style: tiles.wall[i] });
        continue;
      }
      if (!tiles.floor[i]) continue;
      drawTile(ctx, sx, sy, { colors: pick(pal.floors, tiles.floor[i] - 1), variant: tiles.variant[i], light: l });
      const fl = tiles.flags[i];
      if (fl & T.STAIRS_DOWN) drawObject(ctx, sx, sy, 'stairs', pal.stairs, 'down', l);
      else if (fl & T.STAIRS_UP) drawObject(ctx, sx, sy, 'stairs', pal.stairs, 'up', l);
    }
  }
  return list;
}

function drawItems(ctx, game, cam, b) {
  for (const it of game.level.items || []) {
    if (it.removed) continue;
    const w = worldPos(it);
    const tx = Math.floor(w.x);
    const ty = Math.floor(w.y);
    if (tx < b.x0 || tx > b.x1 || ty < b.y0 || ty > b.y1) continue;
    const l = tileLight(game.level, tx, ty);
    if (!l) continue;
    const p = worldToScreen(w.x, w.y, cam);
    ctx.globalAlpha = lightFactor(l);
    drawItemGlyph(ctx, p.x, p.y, it.look, ITEM_SIZE);
  }
  ctx.globalAlpha = 1;
}

function wallHidesPlayer(entry, player) {
  if (!player || entry.d <= player.d) return false;
  return Math.abs(entry.sx - player.sx) < TILE_W
    && entry.sy - WALL_H < player.sy
    && entry.sy > player.sy - PLAYER_H
    && Math.abs(entry.sx - player.sx) < HALF_W + PLAYER_HALF_W;
}

/**
 * Render the level and everything in it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 */
export function renderWorld(ctx, game) {
  const level = game.level;
  const cam = game.camera;
  if (!level || !level.tiles || !cam) return;
  const { tiles } = level;
  const alpha = typeof game.renderAlpha === 'number' ? game.renderAlpha : 1;
  const pal = level.palette || DEFAULT_PALETTE;
  const vb = cam.visibleTileBounds();
  const b = {
    x0: Math.max(0, vb.x0), y0: Math.max(0, vb.y0),
    x1: Math.min(tiles.w - 1, vb.x1), y1: Math.min(tiles.h - 1, vb.y1),
  };

  const list = drawFloors(ctx, game, cam, b, pal);
  if (game.ui && game.ui.hoverTile && inBounds(tiles, game.ui.hoverTile.x, game.ui.hoverTile.y)) {
    const p = worldToScreen(game.ui.hoverTile.x + HALF, game.ui.hoverTile.y + HALF, cam);
    drawTileOutline(ctx, Math.round(p.x), Math.round(p.y));
  }
  drawItems(ctx, game, cam, b);

  pushEntities(list, level.objects, KIND_OBJECT, level, cam, alpha, false);
  pushEntities(list, level.npcs, KIND_ACTOR, level, cam, alpha, true);
  pushEntities(list, level.monsters, KIND_ACTOR, level, cam, alpha, true);
  pushEntities(list, level.missiles, KIND_MISSILE, level, cam, alpha, true);
  if (game.player) pushEntities(list, [game.player], KIND_ACTOR, level, cam, alpha, false);
  list.sort((a, c) => a.d - c.d || a.x - c.x || a.kind - c.kind);

  const playerEntry = game.player ? list.find((en) => en.e === game.player) : null;
  for (const en of list) {
    if (en.kind === KIND_WALL) {
      const fade = wallHidesPlayer(en, playerEntry);
      if (fade) ctx.globalAlpha = WALL_FADE_ALPHA;
      drawWall(ctx, en.sx, en.sy, { colors: pick(pal.walls, en.style - 1), style: en.style, light: en.l, side: en.side });
      if (fade) ctx.globalAlpha = 1;
    } else if (en.kind === KIND_OBJECT) {
      drawObject(ctx, en.sx, en.sy, en.e.kind, en.e.look, en.e.state, en.l);
    } else if (en.kind === KIND_MISSILE) {
      drawMissile(ctx, en.sx, en.sy, en.e.look, en.e.dir || 0);
    } else {
      const e = en.e;
      drawActor(ctx, en.sx, en.sy, e.look, {
        dir: e.dir || 0, frame: e.frame || 0, anim: e.dead ? 'death' : (e.anim || 'stand'), light: en.l, scale: e.scale || 1,
      });
    }
  }
}

/**
 * Tile under a screen point, or null when outside the level.
 * @returns {{x:number,y:number}|null}
 */
export function getTileAtScreen(game, sx, sy) {
  if (!game.level || !game.camera) return null;
  const w = game.camera.screenToWorld(sx, sy);
  const x = Math.floor(w.x);
  const y = Math.floor(w.y);
  return inBounds(game.level.tiles, x, y) ? { x, y } : null;
}

/**
 * Nearest living, currently lit entity whose draw position is within 20px
 * of the screen point. Searches monsters, npcs, objects, then items.
 * @returns {{entity:object, type:'monster'|'npc'|'object'|'item', dist:number}|null}
 */
export function getEntityAtScreen(game, sx, sy) {
  const level = game.level;
  const cam = game.camera;
  if (!level || !cam) return null;
  const alpha = typeof game.renderAlpha === 'number' ? game.renderAlpha : 1;
  const groups = [
    ['monster', level.monsters, ACTOR_PICK_Y],
    ['npc', level.npcs, ACTOR_PICK_Y],
    ['object', level.objects, ACTOR_PICK_Y],
    ['item', level.items, 0],
  ];
  let best = null;
  for (const [type, entities, yOff] of groups) {
    if (!entities) continue;
    for (const e of entities) {
      if (e.dead || e.removed) continue;
      const w = renderPos(e, alpha);
      if (tileLight(level, Math.floor(w.x), Math.floor(w.y)) <= DARK_LIGHT && type !== 'object') continue;
      const p = worldToScreen(w.x, w.y, cam);
      const d = Math.hypot(p.x - sx, p.y - (e.z || 0) - yOff - sy);
      if (d <= PICK_RADIUS && (!best || d < best.dist)) best = { entity: e, type, dist: d };
    }
  }
  return best;
}

export { HALF_W, HALF_H, TILE_H };

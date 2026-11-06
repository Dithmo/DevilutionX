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
import { worldToScreen, renderPos, worldPos, HALF_W } from './camera.js';
import { drawTile, drawWall, drawActor, drawItemGlyph, drawObject, drawMissile, drawTileOutline, lightFactor, WALL_H, TILE_W } from './sprites.js';
import { T, idx, inBounds } from '../world/tiles.js';
import { beginLighting, addLight, addGlow, applyLighting, flicker } from './lighting.js';
import { beginAtmosphere, addEmitter, drawAtmosphere } from './atmosphere.js';
import { drawFloorAO, resolveArt, floorStyleFor, wallStyleFor } from './draw_tiles.js';
import { getDecor, drawDecals, drawProp, drawMounts, registerDecorLights } from './draw_decor.js';

// Sprites are drawn at full brightness; lighting.js darkens/tints the whole frame afterwards.
const LIT = 15;

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
const KIND_LINTEL = 4;   // wall band above a door opening: drawn after the door object
const KIND_PROP = 5;     // raised decor (rubble, poles); sorted like an object
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

/** Wall-neighbour bits for wall tops: 1 (x,y-1) 2 (x+1,y) 4 (x,y+1) 8 (x-1,y). */
function wallMask(tiles, x, y) {
  return (isWallLike(tiles, x, y - 1) ? 1 : 0) | (isWallLike(tiles, x + 1, y) ? 2 : 0)
    | (isWallLike(tiles, x, y + 1) ? 4 : 0) | (isWallLike(tiles, x - 1, y) ? 8 : 0);
}

/** Floor AO bits: 1 wall at (x,y-1), 2 wall at (x-1,y), 4 wall at (x-1,y-1). */
function aoMask(tiles, x, y) {
  return (isWallLike(tiles, x, y - 1) ? 1 : 0) | (isWallLike(tiles, x - 1, y) ? 2 : 0) | (isWallLike(tiles, x - 1, y - 1) ? 4 : 0);
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
    if (e.removed || e.hidden) continue;
    if (kind === KIND_OBJECT && e.kind === 'stairs') continue; // drawn from tile flags
    const w = renderPos(e, alpha);
    const tx = Math.floor(w.x);
    const ty = Math.floor(w.y);
    const l = tileLight(level, tx, ty);
    if (l === 0 || (requireLit && l === DARK_LIGHT)) continue;
    const p = worldToScreen(w.x, w.y, cam);
    list.push({ d: w.x + w.y, x: w.x, kind, e, sx: Math.round(p.x), sy: Math.round(p.y - (e.z || 0)), l });
  }
}

function drawFloors(ctx, game, cam, b, pal, art, decor) {
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
        list.push({ d: x + y + 1, x, y, i, kind: KIND_WALL, sx, sy, l, side: wallSide(tiles, x, y), style: tiles.wall[i] });
        continue;
      }
      if (!tiles.floor[i]) continue;
      const fi = tiles.floor[i] - 1;
      drawTile(ctx, sx, sy, { colors: pick(pal.floors, fi), variant: tiles.variant[i], style: floorStyleFor(art, fi % pal.floors.length), art: pal.art });
      const fl = tiles.flags[i];
      if (fl & T.STAIRS_DOWN) drawObject(ctx, sx, sy, 'stairs', pal.stairs, 'down', LIT);
      else if (fl & T.STAIRS_UP) drawObject(ctx, sx, sy, 'stairs', pal.stairs, 'up', LIT);
      else {
        const dl = decor.decals.get(i);
        if (dl) drawDecals(ctx, sx, sy, dl, pal);
      }
      drawFloorAO(ctx, sx, sy, aoMask(tiles, x, y));
      // lintel over a door set in a straight wall run
      if ((fl & T.DOOR) && ((isWallLike(tiles, x - 1, y) && isWallLike(tiles, x + 1, y)) || (isWallLike(tiles, x, y - 1) && isWallLike(tiles, x, y + 1)))) {
        const alongX = isWallLike(tiles, x - 1, y) && isWallLike(tiles, x + 1, y);
        list.push({ d: x + y + 1, x, y, i, kind: KIND_LINTEL, sx, sy, l, side: alongX ? 'left' : 'right', style: tiles.wall[idx(tiles, alongX ? x - 1 : x, alongX ? y : y - 1)] || 1 });
      }
    }
  }
  for (const pr of decor.props) {
    if (pr.x < b.x0 || pr.x > b.x1 || pr.y < b.y0 || pr.y > b.y1) continue;
    if (!game.level.explored[idx(tiles, pr.x, pr.y)]) continue;
    const p = worldToScreen(pr.x + HALF, pr.y + HALF, cam);
    list.push({ d: pr.x + pr.y + 1, x: pr.x, kind: KIND_PROP, sx: Math.round(p.x), sy: Math.round(p.y), prop: pr });
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
    drawItemGlyph(ctx, p.x, p.y, it.look, ITEM_SIZE);
    if (it.quality === 'unique' || it.quality === 'rare') addGlow(p.x, p.y - 4, 18, it.quality === 'unique' ? '#ffb040' : '#ffe070', 0.35);
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
  const art = resolveArt(pal.art);
  const decor = getDecor(level);
  const vb = cam.visibleTileBounds();
  const b = {
    x0: Math.max(0, vb.x0), y0: Math.max(0, vb.y0),
    x1: Math.min(tiles.w - 1, vb.x1), y1: Math.min(tiles.h - 1, vb.y1),
  };

  beginLighting();
  beginAtmosphere();
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  const list = drawFloors(ctx, game, cam, b, pal, art, decor);
  registerDecorLights(level, cam, b, now);
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
      const wi = (en.style - 1) % pal.walls.length;
      drawWall(ctx, en.sx, en.sy, {
        colors: pick(pal.walls, en.style - 1), side: en.side, mask: wallMask(tiles, en.x, en.y), featL: decor.featL[en.i], featR: decor.featR[en.i],
        variant: tiles.variant[en.i] ^ (en.x * 3 + en.y), wallStyle: wallStyleFor(art, wi), art: pal.art,
      });
      const mounts = decor.mounts.get(en.i);
      if (mounts) drawMounts(ctx, en.sx, en.sy, mounts, pal, now);
      if (fade) ctx.globalAlpha = 1;
    } else if (en.kind === KIND_LINTEL) {
      const fade = wallHidesPlayer(en, playerEntry);
      if (fade) ctx.globalAlpha = WALL_FADE_ALPHA;
      drawWall(ctx, en.sx, en.sy, {
        colors: pick(pal.walls, en.style - 1), side: en.side, mask: en.side === 'left' ? 10 : 5, lintel: true,
        variant: en.x + en.y, wallStyle: wallStyleFor(art, (en.style - 1) % pal.walls.length), art: pal.art,
      });
      if (fade) ctx.globalAlpha = 1;
    } else if (en.kind === KIND_PROP) {
      drawProp(ctx, en.sx, en.sy, en.prop, pal);
    } else if (en.kind === KIND_OBJECT) {
      drawObject(ctx, en.sx, en.sy, en.e.kind, en.e.look, en.e.state, LIT);
      const o = en.e;
      if (o.light > 0 && o.state !== 'broken') {
        const col = (o.look && o.look.color2) || '#ffb060';
        const f = flicker(o.id || en.sx, now, o.look && o.look.shape === 'brazier' ? 0.2 : 0.06);
        addLight(en.sx, en.sy - 20, 40 + o.light * 30, col, 1.1 * f);
        addGlow(en.sx, en.sy - 30, 22 + o.light * 3, col, 0.5 * f);
        if (o.look && o.look.shape === 'brazier') addEmitter(en.sx, en.sy - 34, '#ffb060', 10, 10);
      }
    } else if (en.kind === KIND_MISSILE) {
      drawMissile(ctx, en.sx, en.sy, en.e.look, en.e.dir || 0);
      const mc = (en.e.look && (en.e.look.color || en.e.look.color2)) || '#ffd080';
      addLight(en.sx, en.sy - 16, 90, mc, 0.9);
      addGlow(en.sx, en.sy - 16, 20, mc, 0.6);
    } else {
      const e = en.e;
      drawActor(ctx, en.sx, en.sy, e.look, {
        dir: e.dir || 0, frame: e.frame || 0, anim: e.dead ? 'death' : (e.anim || 'stand'), light: LIT, scale: e.scale || 1,
      });
      if (e === game.player) addLight(en.sx, en.sy - 24, 170, pal.lightTint || '#fff0d8', 0.45);
    }
  }
  applyLighting(ctx, game, b);
  drawAtmosphere(ctx, game);
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
      if (e.dead || e.removed || e.hidden) continue;
      const w = renderPos(e, alpha);
      if (tileLight(level, Math.floor(w.x), Math.floor(w.y)) <= DARK_LIGHT && type !== 'object') continue;
      const p = worldToScreen(w.x, w.y, cam);
      const d = Math.hypot(p.x - sx, p.y - (e.z || 0) - yOff - sy);
      if (d <= PICK_RADIUS && (!best || d < best.dist)) best = { entity: e, type, dist: d };
    }
  }
  return best;
}

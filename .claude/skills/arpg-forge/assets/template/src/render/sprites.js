/**
 * Procedural sprite drawing (barrel module). Everything is drawn from
 * palette/descriptor data and cached to offscreen canvases by key.
 *
 *   drawTile(ctx, sx, sy, { colors:[base, speckle], variant, light })
 *   drawWall(ctx, sx, sy, { colors:[left, right, top], style, light, side })
 *   drawActor(ctx, sx, sy, look, { dir, frame, anim, light, scale })
 *   drawItemGlyph(ctx, sx, sy, look, size)
 *   drawObject(ctx, sx, sy, kind, look, state, light)
 *   drawMissile(ctx, sx, sy, look, dir)
 *   drawTileOutline(ctx, sx, sy, color)
 *
 * drawActor draws the 3D-baked actor (render/actor3d) when that renderer is loaded and falls
 * back to the 2D puppet (render/draw_actor.js) otherwise, per look and per frame.
 *
 * (sx, sy) is always the screen position of the ground point (tile centre or
 * actor feet). `light` is 0..15 and darkens toward black.
 */
export { drawTile, drawWall, drawTileOutline, TILE_W, TILE_H, WALL_H } from './draw_tiles.js';
import { drawActor as drawActor2d } from './draw_actor.js';
export { setLookDefaults } from './draw_actor.js';
import { drawActor3d } from './actor3d/index.js';
export { drawItemGlyph, drawMissile } from './draw_items.js';
export { drawObject } from './draw_objects.js';
export { clearSpriteCache, spriteCacheSize, shade, lightFactor, parseColor, mix, lighten, dirToScreen, MAX_LIGHT } from './draw_util.js';

export { preloadActors3d, warmActors3d, actors3dState, setActors3dSync, clearActors3d, ACTORS3D } from './actor3d/index.js';
export { drawActor2d };

/** Draw an actor: 3D-baked sprite when available, else the 2D puppet (same arguments). */
export function drawActor(ctx, sx, sy, look, opts = {}) {
  if (drawActor3d(ctx, sx, sy, look, opts)) return;
  drawActor2d(ctx, sx, sy, look, opts);
}

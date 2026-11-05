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
 * (sx, sy) is always the screen position of the ground point (tile centre or
 * actor feet). `light` is 0..15 and darkens toward black.
 */
export { drawTile, drawWall, drawTileOutline, TILE_W, TILE_H, WALL_H } from './draw_tiles.js';
export { drawActor } from './draw_actor.js';
export { drawItemGlyph, drawMissile } from './draw_items.js';
export { drawObject } from './draw_objects.js';
export { clearSpriteCache, spriteCacheSize, shade, lightFactor, parseColor, mix, lighten, dirToScreen, MAX_LIGHT } from './draw_util.js';

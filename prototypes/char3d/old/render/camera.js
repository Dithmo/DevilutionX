/**
 * Isometric camera and world <-> screen transforms.
 *
 * COORDINATE CONVENTIONS
 * ----------------------
 * World space is in tiles. Tile (x,y) covers the unit square [x,x+1)x[y,y+1);
 * world point (x,y) is therefore the tile's top (north) corner and (x+0.5,y+0.5)
 * its centre.
 *
 * Entities store an integer tile `tx,ty` plus a fractional offset `ox,oy` in
 * [-0.5, 0.5] that points toward the tile they are walking to. Their world
 * position (the centre of the feet) is  worldPos(e) = { tx+ox+0.5, ty+oy+0.5 }.
 * An entity without `tx` is treated as already holding its world centre in
 * `x,y` (used by missiles and ad-hoc effects). Optional `z` is a height in
 * screen pixels, subtracted from screen y when drawing.
 *
 * Screen mapping for a camera focused on world point (cx, cy):
 *   sx = (wx - wy) * TILE_W/2 + viewW/2 - (cx - cy) * TILE_W/2
 *   sy = (wx + wy) * TILE_H/2 + viewH/2 - (cx + cy) * TILE_H/2
 * So +x world runs down-right on screen and +y world runs down-left; "south"
 * (toward the viewer) is +x+y.
 */

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
const HALF = 0.5;
const DEFAULT_MARGIN = 3; // extra tiles around the view so tall sprites/walls still draw
const ORIGIN = { x: 0, y: 0, viewW: 0, viewH: 0 };

/**
 * World-space centre of an entity (see conventions above).
 * @param {{tx?:number,ty?:number,ox?:number,oy?:number,x?:number,y?:number}} e
 * @returns {{x:number,y:number}}
 */
export function worldPos(e) {
  if (typeof e.tx === 'number') {
    return { x: e.tx + (e.ox || 0) + HALF, y: e.ty + (e.oy || 0) + HALF };
  }
  return { x: e.x || 0, y: e.y || 0 };
}

/**
 * Interpolated world position for rendering between ticks. Uses `prevX,prevY`
 * (the previous tick's worldPos, recorded by the simulation) when present.
 * @param {object} e
 * @param {number} alpha 0..1 fraction of the current tick elapsed
 * @returns {{x:number,y:number}}
 */
export function renderPos(e, alpha = 1) {
  const cur = worldPos(e);
  if (typeof e.prevX !== 'number' || alpha >= 1) return cur;
  return {
    x: e.prevX + (cur.x - e.prevX) * alpha,
    y: e.prevY + (cur.y - e.prevY) * alpha,
  };
}

/**
 * Fractional world coords -> screen pixels.
 * @param {number} wx
 * @param {number} wy
 * @param {{x:number,y:number,viewW:number,viewH:number}} [cam] defaults to origin, no view offset
 * @returns {{x:number,y:number}}
 */
export function worldToScreen(wx, wy, cam = ORIGIN) {
  return {
    x: (wx - wy - (cam.x - cam.y)) * HALF_W + cam.viewW * HALF,
    y: (wx + wy - (cam.x + cam.y)) * HALF_H + cam.viewH * HALF,
  };
}

/**
 * Screen pixels -> fractional world coords on the ground plane (z = 0).
 * @returns {{x:number,y:number}}
 */
export function screenToWorld(sx, sy, cam = ORIGIN) {
  const a = (sx - cam.viewW * HALF) / HALF_W + (cam.x - cam.y);
  const b = (sy - cam.viewH * HALF) / HALF_H + (cam.x + cam.y);
  return { x: (a + b) * HALF, y: (b - a) * HALF };
}

/**
 * Create a camera focused on world point (x,y) for a view of the given size.
 * @param {number} viewW logical canvas width
 * @param {number} viewH logical canvas height
 * @returns {{
 *   x:number, y:number, viewW:number, viewH:number,
 *   follow(target:object, lerp?:number):void,
 *   worldToScreen(wx:number, wy:number):{x:number,y:number},
 *   screenToWorld(sx:number, sy:number):{x:number,y:number},
 *   visibleTileBounds(margin?:number):{x0:number,y0:number,x1:number,y1:number},
 *   setView(w:number, h:number):void
 * }}
 */
export function createCamera(viewW, viewH) {
  const cam = {
    x: 0,
    y: 0,
    viewW,
    viewH,

    /**
     * Move the focus toward an entity or {x,y} world point.
     * lerp = 1 snaps; smaller values ease.
     */
    follow(target, lerp = 1) {
      const p = worldPos(target);
      cam.x += (p.x - cam.x) * lerp;
      cam.y += (p.y - cam.y) * lerp;
    },

    worldToScreen(wx, wy) {
      return worldToScreen(wx, wy, cam);
    },

    screenToWorld(sx, sy) {
      return screenToWorld(sx, sy, cam);
    },

    /**
     * Inclusive integer tile bounds that may intersect the view (unclamped;
     * the renderer clips to the level).
     */
    visibleTileBounds(margin = DEFAULT_MARGIN) {
      const corners = [
        screenToWorld(0, 0, cam),
        screenToWorld(cam.viewW, 0, cam),
        screenToWorld(0, cam.viewH, cam),
        screenToWorld(cam.viewW, cam.viewH, cam),
      ];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of corners) {
        if (c.x < x0) x0 = c.x;
        if (c.y < y0) y0 = c.y;
        if (c.x > x1) x1 = c.x;
        if (c.y > y1) y1 = c.y;
      }
      return {
        x0: Math.floor(x0) - margin,
        y0: Math.floor(y0) - margin,
        x1: Math.ceil(x1) + margin,
        y1: Math.ceil(y1) + margin,
      };
    },

    /** Change the logical view size (keeps focus). */
    setView(w, h) {
      cam.viewW = w;
      cam.viewH = h;
    },
  };
  return cam;
}

/**
 * Screen-space lighting pass (drawn after the world, before the UI).
 *
 * Every world sprite is drawn at full brightness; this pass darkens and tints it:
 *   1. A low-res light map is built from the per-tile FOV light (level.light, which already
 *      respects walls), so light never leaks through walls. Explored-but-unseen tiles get a dim
 *      "memory" value; unexplored stays black. Wall tiles light their whole raised face.
 *   2. Coloured point lights (braziers, lamps, missiles, wall torches) are added on top with
 *      'lighter', so warm pools of light overlap and mix.
 *   3. The light map is blurred (soft falloff) and multiplied over the scene.
 *   4. Glows are drawn additively afterwards: flames, neon, magic. These are the only things
 *      allowed to be brighter than the unlit sprite, which is what sells "light".
 *
 * Callers register lights each frame in logical screen pixels:
 *   addLight(sx, sy, radius, color, intensity)   - lights the scene (multiplied)
 *   addGlow(sx, sy, radius, color, alpha)        - additive bloom on top
 */
import { makeCanvas, parseColor } from './draw_util.js';
import { idx, inBounds } from '../world/tiles.js';
import { worldToScreen } from './camera.js';

const LM_DIV = 4;            // light map is 1/4 of the logical resolution
const BLUR_PX = 2.2;         // blur radius in light-map pixels (~9 logical px)
const MEMORY = 0.13;         // brightness of explored tiles outside the player's sight
const LIGHT_GAMMA = 0.85;
const WALL_H = 64;          // keep in sync with draw_tiles.js WALL_H
const TILE_HW = 32;
const TILE_HH = 16;
const MAX_LIGHT = 15;
const DEFAULT_TINT = '#fff4e0';

const lights = [];
const glows = [];
let lm = null;
let lmBlur = null;

/** Start a new frame of light registration. */
export function beginLighting() {
  lights.length = 0;
  glows.length = 0;
}

/** Register a coloured point light (logical screen px). intensity ~0.2 subtle .. 1.2 strong. */
export function addLight(sx, sy, radius, color, intensity = 1) {
  lights.push({ sx, sy, radius, color, intensity });
}

/** Register an additive glow sprite (flame, neon, magic) drawn over the lit scene. */
export function addGlow(sx, sy, radius, color, alpha = 0.5) {
  glows.push({ sx, sy, radius, color, alpha });
}

function rgba(color, a) {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${a})`;
}

function ensureMaps(w, h) {
  const lw = Math.ceil(w / LM_DIV);
  const lh = Math.ceil(h / LM_DIV);
  if (!lm || lm.width !== lw || lm.height !== lh) {
    lm = makeCanvas(lw, lh);
    lmBlur = makeCanvas(lw, lh);
  }
  return { lw, lh };
}

/** Flickering 0..1 multiplier, stable per light position. */
export function flicker(seed, t, amount = 0.12) {
  return 1 - amount + amount * (Math.sin(t * 9.1 + seed) * 0.5 + Math.sin(t * 23.7 + seed * 1.7) * 0.3 + 0.2);
}

/**
 * Build and apply the light map, then draw glows.
 * @param {CanvasRenderingContext2D} ctx world context (logical coords)
 * @param {object} game
 * @param {{x0:number,y0:number,x1:number,y1:number}} b visible tile bounds
 */
export function applyLighting(ctx, game, b) {
  const level = game.level;
  const cam = game.camera;
  const W = cam.viewW || 960;
  const H = cam.viewH || 540;
  const { lw, lh } = ensureMaps(W, H);
  const c = lm.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#000';
  c.fillRect(0, 0, lw, lh);
  c.setTransform(1 / LM_DIV, 0, 0, 1 / LM_DIV, 0, 0);

  const pal = level.palette || {};
  const isTown = !!level.isTown;
  const tint = parseColor(pal.lightTint || DEFAULT_TINT);
  // Town is "night with street lights": a dim ambient lifted by its lamps; dungeons use FOV.
  const ambient = isTown ? (pal.ambientLevel ?? 0.42) : 1;
  const { tiles } = level;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = idx(tiles, x, y);
      if (!level.explored[i]) continue;
      const l = level.light[i];
      let v = l > 0 ? Math.pow(l / MAX_LIGHT, LIGHT_GAMMA) : 0;
      v = Math.max(MEMORY, v) * ambient;
      const r = Math.round(tint[0] * v);
      const g = Math.round(tint[1] * v);
      const bl = Math.round(tint[2] * v);
      c.fillStyle = `rgb(${r},${g},${bl})`;
      const p = worldToScreen(x + 0.5, y + 0.5, cam);
      const top = tiles.wall[i] ? WALL_H : 0;
      c.beginPath();
      c.moveTo(p.x, p.y - TILE_HH - top - 2);
      c.lineTo(p.x + TILE_HW + 2, p.y - top);
      c.lineTo(p.x + TILE_HW + 2, p.y);
      c.lineTo(p.x, p.y + TILE_HH + 2);
      c.lineTo(p.x - TILE_HW - 2, p.y);
      c.lineTo(p.x - TILE_HW - 2, p.y - top);
      c.closePath();
      c.fill();
    }
  }

  c.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    const g = c.createRadialGradient(L.sx, L.sy, 0, L.sx, L.sy, L.radius);
    g.addColorStop(0, rgba(L.color, Math.min(1, 0.85 * L.intensity)));
    g.addColorStop(0.35, rgba(L.color, Math.min(1, 0.4 * L.intensity)));
    g.addColorStop(1, rgba(L.color, 0));
    c.fillStyle = g;
    c.fillRect(L.sx - L.radius, L.sy - L.radius, L.radius * 2, L.radius * 2);
  }

  const cb = lmBlur.getContext('2d');
  cb.setTransform(1, 0, 0, 1, 0, 0);
  cb.globalCompositeOperation = 'copy';
  cb.filter = `blur(${BLUR_PX}px)`;
  cb.drawImage(lm, 0, 0);
  cb.filter = 'none';

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lmBlur, 0, 0, lw * LM_DIV, lh * LM_DIV);
  ctx.globalCompositeOperation = 'lighter';
  for (const G of glows) {
    const g = ctx.createRadialGradient(G.sx, G.sy, 0, G.sx, G.sy, G.radius);
    g.addColorStop(0, rgba(G.color, G.alpha));
    g.addColorStop(0.4, rgba(G.color, G.alpha * 0.35));
    g.addColorStop(1, rgba(G.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(G.sx - G.radius, G.sy - G.radius, G.radius * 2, G.radius * 2);
  }
  ctx.restore();
}

/** Is the tile under a world point explored (so its lights may shine)? */
export function tileExplored(level, wx, wy) {
  const x = Math.floor(wx);
  const y = Math.floor(wy);
  return inBounds(level.tiles, x, y) && !!level.explored[idx(level.tiles, x, y)];
}

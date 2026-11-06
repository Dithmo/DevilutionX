/**
 * Atmosphere: the screen-space layers that make a scene feel like a place rather than a grid.
 *   - embers / sparks rising from registered emitters (fires, neon, magic), additive
 *   - slow drifting fog (a pre-baked noise texture scrolled at two speeds), screen-blended
 *   - drifting ash motes across the whole view
 *   - a vignette that pulls the eye to the centre
 * All purely visual and driven by wall-clock time, so it never touches the simulation.
 *
 * Theme knobs (level.palette, from the tileset): fogColor, fogAlpha, emberColor, moteColor.
 */
import { makeCanvas, parseColor, hash2 } from './draw_util.js';

const MAX_PARTICLES = 260;
const FOG_TEX = 256;
const MOTES = 40;

const particles = [];
const emitters = [];
let fogTex = null;
let fogKey = '';
let vignette = null;
let lastT = 0;
let motes = null;

function rgba(color, a) {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${a})`;
}

/** Register an ember emitter for this frame (logical screen px). rate = particles per second. */
export function addEmitter(sx, sy, color, rate = 6, spread = 6) {
  emitters.push({ sx, sy, color, rate, spread });
}

export function beginAtmosphere() {
  emitters.length = 0;
}

function bakeFog(color) {
  const c = makeCanvas(FOG_TEX, FOG_TEX);
  const g = c.getContext('2d');
  // Layered soft blobs, wrapped so the texture tiles seamlessly.
  for (let i = 0; i < 70; i++) {
    const h = hash2(i, 17, 3);
    const x = h % FOG_TEX;
    const y = (h >>> 9) % FOG_TEX;
    const r = 18 + ((h >>> 18) % 52);
    const a = 0.05 + ((h >>> 4) % 10) / 120;
    for (const ox of [-FOG_TEX, 0, FOG_TEX]) {
      for (const oy of [-FOG_TEX, 0, FOG_TEX]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, rgba(color, a));
        gr.addColorStop(1, rgba(color, 0));
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  return c;
}

function bakeVignette(W, H) {
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H * 0.46, H * 0.3, W / 2, H * 0.46, W * 0.62);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(0.65, 'rgba(0,0,0,0.28)');
  gr.addColorStop(1, 'rgba(0,0,0,0.78)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  return c;
}

/**
 * Update and draw the atmosphere over the lit world.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 */
export function drawAtmosphere(ctx, game) {
  const cam = game.camera;
  const W = cam.viewW;
  const H = cam.viewH;
  const pal = (game.level && game.level.palette) || {};
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  const dt = Math.min(0.1, lastT ? now - lastT : 0.016);
  lastT = now;

  // Fog: two layers scrolled at different speeds, offset by the camera so it sits in the world.
  const fogColor = pal.fogColor || '#8a90a8';
  const fogAlpha = pal.fogAlpha ?? 0.55;
  if (fogKey !== fogColor) { fogTex = bakeFog(fogColor); fogKey = fogColor; }
  const camX = (cam.x - cam.y) * 32;
  const camY = (cam.x + cam.y) * 16;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const [speed, scale, a] of [[6, 3.2, fogAlpha], [-4, 2.1, fogAlpha * 0.7]]) {
    const s = FOG_TEX * scale;
    const ox = (((-camX * 0.9 + now * speed) % s) + s) % s - s;
    const oy = (((-camY * 0.9 + now * speed * 0.3) % s) + s) % s - s;
    ctx.globalAlpha = a;
    for (let x = ox; x < W; x += s) for (let y = oy; y < H; y += s) ctx.drawImage(fogTex, x, y, s, s);
  }
  ctx.globalAlpha = 1;

  // Embers from emitters.
  for (const e of emitters) {
    let n = e.rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      if (particles.length >= MAX_PARTICLES) break;
      particles.push({
        x: e.sx + (Math.random() - 0.5) * e.spread, y: e.sy, vx: (Math.random() - 0.5) * 14,
        vy: -18 - Math.random() * 26, life: 0, max: 0.8 + Math.random() * 1.4, color: e.color, size: 0.8 + Math.random() * 1.3,
      });
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    p.x += (p.vx + Math.sin(now * 3 + i) * 6) * dt;
    p.y += p.vy * dt;
    const a = Math.sin((p.life / p.max) * Math.PI);
    ctx.fillStyle = rgba(p.color, 0.9 * a);
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.fillStyle = rgba(p.color, 0.18 * a);
    ctx.fillRect(p.x - 1.5, p.y - 1.5, p.size + 3, p.size + 3);
  }

  // Ash motes drifting over everything.
  if (!motes) motes = Array.from({ length: MOTES }, (_, i) => ({ x: (hash2(i, 1) % 1000) / 1000, y: (hash2(i, 2) % 1000) / 1000, s: 0.5 + (hash2(i, 3) % 100) / 100, p: hash2(i, 4) % 100 }));
  const moteColor = pal.moteColor || pal.emberColor || '#ffb070';
  for (const m of motes) {
    const x = ((m.x * W + now * 8 * m.s - camX * 0.3) % W + W) % W;
    const y = ((m.y * H - now * 5 * m.s - camY * 0.3) % H + H) % H;
    ctx.fillStyle = rgba(moteColor, 0.18 + 0.2 * Math.sin(now * 2 + m.p));
    ctx.fillRect(x, y, m.s * 1.4, m.s * 1.4);
  }
  ctx.restore();

  if (!vignette || vignette.width !== W) vignette = bakeVignette(W, H);
  ctx.drawImage(vignette, 0, 0, W, H);
}

/**
 * 3D actor front-end: decides per draw whether a 3D-baked sprite is available and blits it.
 *
 * - Nothing here imports three.js. preloadActors3d() dynamically imports the baker, loads the
 *   textures and makes the WebGL context; if any of that fails (no WebGL, file missing, old
 *   browser) the game keeps the 2D puppet and nothing else changes.
 * - Sprites bake lazily, the first time a (look, dir, anim, pose, size) is drawn, inside a
 *   per-frame time budget. Each look that appears is queued for a background warm-up (stand
 *   in all 8 directions first, then walk, attack, hit, death, cast) on idle time.
 * - A miss over budget draws the nearest pose already baked for that look and direction (then
 *   its stand pose); the 2D puppet is the last resort, so the style never flickers once a
 *   look is warm.
 * - Off switches: URL ?actors=2d, theme meta.actors = '2d', or look.render = '2d' per look.
 */
import { resolveLook, frameKey, WALK_FRAMES, ATTACK_FRAMES, CAST_POSES, HIT_POSES, DEATH_POSES } from '../draw_actor.js';
import { RENDER_SCALE, blit } from '../draw_util.js';
import { addGlow } from '../lighting.js';

/** Tunables (documented in references/visual-quality.md). */
export const ACTORS3D = {
  frameBudgetMs: 8, // baking allowed per rendered frame before falling back
  hardBudgetMs: 40, // a look with nothing baked yet may go this far to avoid a 2D pop
  idleSliceMs: 10, // background warm-up per idle callback
  cacheMB: 256, // sprite memory cap (LRU)
  preloadTimeoutMs: 6000,
};

let state = 'off'; // off | loading | ready | failed | disabled
let engine = null;
let failure = null;
let sync = false;
const cache = new Map(); // key -> entry (insertion order = LRU)
let bytes = 0;
const lookSeen = new Set();
const queue = [];
const queued = new Set();
let pumping = false;
let windowStart = 0;
let spent = 0;
const stats = { hits: 0, bakes: 0, fallbacks: 0, puppet: 0, bakeMs: 0, warmed: 0 };

const POSES = { stand: 1, walk: WALK_FRAMES, attack: ATTACK_FRAMES, cast: CAST_POSES, hit: HIT_POSES, death: DEATH_POSES };
const WARM_ORDER = ['stand', 'walk', 'attack', 'hit', 'death', 'cast'];

function urlMode() {
  try { return new URLSearchParams(window.location.search).get('actors'); } catch (e) { return null; }
}

/**
 * Load the 3D baker. Resolves true when 3D actors are active, false when the game stays 2D.
 * @param {{mode?:string, looks?:object[], timeoutMs?:number}} [o] mode '2d' disables; looks
 *   are warmed (stand, all dirs) before resolving.
 */
export async function preloadActors3d(o = {}) {
  const mode = urlMode() || o.mode || '3d';
  if (mode === '2d') { state = 'disabled'; return false; }
  if (state === 'ready') { warmLooks(o.looks); return true; }
  if (typeof document === 'undefined') { state = 'disabled'; return false; }
  state = 'loading';
  const timeout = o.timeoutMs || ACTORS3D.preloadTimeoutMs;
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) throw new Error('WebGL2 unavailable');
    const load = (async () => {
      const [{ createBaker }, { loadTextures }] = await Promise.all([import('./baker.js'), import('./materials.js')]);
      const T = await loadTextures();
      return createBaker(T);
    })();
    engine = await Promise.race([load, new Promise((_, rej) => setTimeout(() => rej(new Error('3D actor preload timed out')), timeout))]);
    state = 'ready';
  } catch (err) {
    failure = String((err && err.message) || err);
    state = 'failed';
    console.warn('[actors] 3D renderer unavailable, using the 2D puppet:', failure);
    return false;
  }
  if (o.looks) {
    const t0 = performance.now();
    for (const look of o.looks) {
      if (performance.now() - t0 > timeout) break;
      for (let d = 0; d < 8; d++) bakeNow(look, resolveLook(look), d, 'stand', 0, 1);
    }
  }
  return true;
}

/** Bake everything requested synchronously (model sheet, screenshots, tests). */
export function setActors3dSync(on) { sync = !!on; }

export function actors3dState() {
  return { state, failure, sprites: cache.size, mb: +(bytes / 1048576).toFixed(1), queue: queue.length, ...stats, engine: engine ? { ...engine.stats } : null };
}

/** Drop every baked sprite (theme change). Rigs stay until evicted. */
export function clearActors3d() {
  cache.clear(); bytes = 0; lookSeen.clear(); queue.length = 0; queued.clear();
}

function keyOf(L, dir, anim, fk, scale, size) {
  return `${L.key}|${dir}|${anim}|${fk}|${scale}|${size}|${RENDER_SCALE}`;
}

function store(key, e) {
  cache.set(key, e);
  bytes += e.canvas.width * e.canvas.height * 4;
  const cap = ACTORS3D.cacheMB * 1048576;
  while (bytes > cap && cache.size > 1) {
    const [k, old] = cache.entries().next().value;
    cache.delete(k);
    bytes -= old.canvas.width * old.canvas.height * 4;
  }
}

function bakeNow(look, L, dir, anim, fk, scale) {
  const key = keyOf(L, dir, anim, fk, scale, look.size || 1);
  let e = cache.get(key);
  if (e) return e;
  try {
    e = engine.bake(look, L, dir, anim, fk, scale, RENDER_SCALE);
  } catch (err) {
    failure = String((err && err.message) || err);
    state = 'failed';
    console.warn('[actors] 3D bake failed, switching to the 2D puppet:', err);
    return null;
  }
  stats.bakes++; stats.bakeMs += e.ms;
  spent += e.ms;
  store(key, e);
  return e;
}

function tick() {
  const now = performance.now();
  if (now - windowStart > 14) { windowStart = now; spent = 0; }
}

function nearest(L, dir, anim, fk, scale, size) {
  const n = POSES[anim] || 1;
  for (let i = 1; i < n; i++) {
    const e = cache.get(keyOf(L, dir, anim, (fk - i + n) % n, scale, size));
    if (e) return e;
  }
  if (anim !== 'stand') return cache.get(keyOf(L, dir, 'stand', 0, scale, size)) || null;
  return null;
}

/**
 * Draw a 3D-baked actor. Returns false when the caller should draw the 2D puppet instead.
 * Same arguments as draw_actor.drawActor.
 */
export function drawActor3d(ctx, sx, sy, look, opts = {}) {
  if (state !== 'ready' || !look || look.render === '2d') return false;
  const { dir = 0, frame = 0, anim = 'stand', scale = 1 } = opts;
  const L = resolveLook(look);
  const d = ((dir | 0) % 8 + 8) % 8;
  const fk = frameKey(anim, frame);
  const size = look.size || 1;
  const key = keyOf(L, d, anim, fk, scale, size);
  let e = cache.get(key);
  if (e) {
    stats.hits++;
    cache.delete(key); cache.set(key, e); // LRU touch
  } else {
    tick();
    const lk = `${L.key}|${scale}|${size}`;
    if (!lookSeen.has(lk)) { lookSeen.add(lk); enqueueLook(look, L, scale, d); }
    if (sync || anim === 'death' || spent < ACTORS3D.frameBudgetMs) e = bakeNow(look, L, d, anim, fk, scale);
    if (!e && state === 'ready') {
      e = nearest(L, d, anim, fk, scale, size);
      if (e) stats.fallbacks++;
      else if (spent < ACTORS3D.hardBudgetMs) e = bakeNow(look, L, d, anim, fk, scale);
      enqueue(look, L, d, anim, fk, scale, true);
    }
    if (!e) { stats.puppet++; return false; }
  }
  blit(ctx, e, sx, sy);
  if (opts.light !== undefined) for (const g of e.glows) addGlow(sx + g.x, sy + g.y, g.r, g.color, g.a);
  return true;
}

/* ------------------------------------------------ background warm-up */

function enqueue(look, L, dir, anim, fk, scale, urgent = false) {
  const key = keyOf(L, dir, anim, fk, scale, look.size || 1);
  if (cache.has(key) || queued.has(key)) return;
  queued.add(key);
  const job = { key, look, L, dir, anim, fk, scale, urgent };
  if (urgent) queue.unshift(job); else queue.push(job);
  pump();
}

function enqueueLook(look, L, scale, firstDir = 0) {
  const dirs = [firstDir, ...[0, 1, 2, 3, 4, 5, 6, 7].filter((x) => x !== firstDir)];
  for (const anim of WARM_ORDER) {
    for (const d of dirs) for (let f = 0; f < POSES[anim]; f++) enqueue(look, L, d, anim, f, scale);
  }
}

function warmLooks(looks) {
  if (!looks || state !== 'ready') return;
  for (const look of looks) {
    const L = resolveLook(look);
    const lk = `${L.key}|1|${look.size || 1}`;
    if (!lookSeen.has(lk)) { lookSeen.add(lk); enqueueLook(look, L, 1); }
  }
}

/** Queue the full sprite set of these looks for idle-time baking (e.g. a level's monsters). */
export function warmActors3d(looks) { warmLooks(looks); }

const idle = typeof requestIdleCallback === 'function'
  ? (fn) => requestIdleCallback(fn, { timeout: 250 })
  : (fn) => setTimeout(() => fn({ timeRemaining: () => ACTORS3D.idleSliceMs }), 30);

function pump() {
  if (pumping || state !== 'ready') return;
  pumping = true;
  idle(work);
}

function work(deadline) {
  const t0 = performance.now();
  const slice = Math.min(ACTORS3D.idleSliceMs, Math.max(2, deadline.timeRemaining ? deadline.timeRemaining() : ACTORS3D.idleSliceMs));
  while (queue.length && state === 'ready' && performance.now() - t0 < slice) {
    const j = queue.shift();
    queued.delete(j.key);
    if (cache.has(j.key)) continue;
    // background warm-up stops short of the cap so it never evicts sprites in use
    if (!j.urgent && bytes > ACTORS3D.cacheMB * 1048576 * 0.7) continue;
    const before = spent;
    if (bakeNow(j.look, j.L, j.dir, j.anim, j.fk, j.scale)) stats.warmed++;
    spent = before; // idle work does not count against the frame budget
  }
  pumping = false;
  if (queue.length && state === 'ready') pump();
}

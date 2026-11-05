/**
 * Fixed-timestep game loop: simulation ticks at a constant rate while
 * rendering runs once per animation frame with an interpolation alpha.
 */

const DEFAULT_TICK_RATE = 20;
const DEFAULT_MAX_CATCH_UP = 5;
const MAX_FRAME_MS = 250; // clamp after a tab switch so we never spiral
const MS_PER_SEC = 1000;
const FALLBACK_FRAME_MS = 16;
const FPS_SMOOTHING = 0.1;

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const requestFrame = typeof requestAnimationFrame === 'function'
  ? (fn) => requestAnimationFrame(fn)
  : (fn) => setTimeout(() => fn(nowMs()), FALLBACK_FRAME_MS);
const cancelFrame = typeof cancelAnimationFrame === 'function'
  ? (h) => cancelAnimationFrame(h)
  : (h) => clearTimeout(h);

/**
 * Create a loop. `update(tickDt)` runs at a fixed rate (tickDt in seconds);
 * `render(alpha)` runs every frame with alpha in [0,1] = fraction of the
 * next tick already elapsed (for interpolation).
 * @param {{ tickRate?:number, update:(dt:number)=>void, render?:(alpha:number)=>void, maxCatchUp?:number }} opts
 * @returns {{
 *   paused:boolean, running:boolean, speed:number, tick:number, tickDt:number, tickRate:number, fps:number,
 *   start():void, stop():void, setSpeed(mult:number):void, stepTicks(n:number):void
 * }}
 */
export function createLoop({
  tickRate = DEFAULT_TICK_RATE,
  update,
  render = () => {},
  maxCatchUp = DEFAULT_MAX_CATCH_UP,
} = {}) {
  const tickDt = 1 / tickRate;
  const tickMs = MS_PER_SEC / tickRate;
  let acc = 0;
  let last = 0;
  let handle = 0;

  const loop = {
    paused: false,
    running: false,
    speed: 1,
    tick: 0,
    tickDt,
    tickRate,
    fps: 0,

    /** Begin the animation-frame driven loop. */
    start() {
      if (loop.running) return;
      loop.running = true;
      last = nowMs();
      acc = 0;
      handle = requestFrame(frame);
    },

    /** Stop the loop (can be restarted). */
    stop() {
      loop.running = false;
      cancelFrame(handle);
    },

    /** Simulation speed multiplier (0 = frozen, 2 = double speed). */
    setSpeed(mult) {
      loop.speed = Math.max(0, Number(mult) || 0);
    },

    /** Run n updates synchronously, ignoring pause (used by tests/debug). */
    stepTicks(n) {
      for (let i = 0; i < n; i++) doTick();
    },
  };

  function doTick() {
    loop.tick++;
    update(tickDt);
  }

  function frame(t) {
    if (!loop.running) return;
    let dt = t - last;
    last = t;
    if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;
    if (dt > 0) loop.fps += (MS_PER_SEC / dt - loop.fps) * FPS_SMOOTHING;
    if (!loop.paused) acc += dt * loop.speed;
    let n = 0;
    while (acc >= tickMs && n < maxCatchUp) {
      doTick();
      acc -= tickMs;
      n++;
    }
    if (n >= maxCatchUp) acc = 0; // drop backlog rather than spiral
    render(loop.paused ? 1 : Math.min(1, acc / tickMs));
    handle = requestFrame(frame);
  }

  return loop;
}

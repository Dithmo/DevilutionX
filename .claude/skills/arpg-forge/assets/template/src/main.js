/**
 * Bootstrap: canvas scaling, core systems, game object, loop, debug API.
 *
 * Integration point: swap `buildDemoLevel` for the real level generator and
 * `updateDemo` for the real simulation; everything else here is generic.
 */
import { createLoop } from './core/loop.js';
import { createBus } from './core/events.js';
import { createInput } from './core/input.js';
import { createAudio } from './core/audio.js';
import { createRng } from './core/rng.js';
import { createCamera, renderPos } from './render/camera.js';
import { renderWorld, getTileAtScreen } from './render/iso.js';
import { buildDemoLevel, createDemoPlayer, updateDemo, drawDemoHud } from './demo.js';

const VIEW_W = 960;
const VIEW_H = 540;
const TICK_RATE = 20;
const DEFAULT_SEED = 12345;
const BG_COLOR = '#0a0a0c';
const CANVAS_ID = 'game';
const LOADING_ID = 'loading';
const SEED_PARAM = 'seed';

/** Scale the canvas to fit the window, preferring integer factors. */
function fitCanvas(canvas) {
  const w = window.innerWidth || VIEW_W;
  const h = window.innerHeight || VIEW_H;
  let scale = Math.min(w / VIEW_W, h / VIEW_H);
  if (scale >= 1) scale = Math.floor(scale);
  canvas.style.width = `${Math.floor(VIEW_W * scale)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * scale)}px`;
}

function readSeed() {
  const raw = new URLSearchParams(window.location.search).get(SEED_PARAM);
  if (raw === null || raw === '') return DEFAULT_SEED;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : raw;
}

/**
 * Create the shared game object with all core systems attached.
 * @param {HTMLCanvasElement} canvas
 * @param {number|string} seed
 * @returns {object} game
 */
export function createGame(canvas, seed) {
  const camera = createCamera(VIEW_W, VIEW_H);
  const game = {
    seed,
    tick: 0,
    mode: 'dungeon',
    rng: createRng(seed),
    bus: createBus(),
    input: createInput(canvas, camera),
    audio: createAudio(),
    camera,
    canvas,
    ctx: canvas.getContext('2d'),
    level: null,
    player: null,
    ui: { hoverTile: null, openPanel: null, messages: [], floats: [] },
    renderAlpha: 1,
    debug: {},
  };
  game.level = buildDemoLevel(game);
  game.player = createDemoPlayer(game);
  game.level.lightMap.update([{ x: game.player.tx, y: game.player.ty, r: 8 }]);
  camera.follow(game.player, 1);
  return game;
}

function update(game) {
  game.tick++;
  updateDemo(game);
}

function render(game, loop, alpha) {
  const { ctx, camera, input } = game;
  game.renderAlpha = alpha;
  camera.follow(renderPos(game.player, alpha), 1);
  game.ui.hoverTile = input.mouse.inside ? getTileAtScreen(game, input.mouse.x, input.mouse.y) : null;
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  renderWorld(ctx, game);
  drawDemoHud(ctx, game, loop);
}

function stateSummary(game) {
  let explored = 0;
  for (let i = 0; i < game.level.explored.length; i++) explored += game.level.explored[i];
  const p = game.player;
  return {
    tick: game.tick,
    seed: game.seed,
    player: { tx: p.tx, ty: p.ty, ox: p.ox, oy: p.oy, dir: p.dir, anim: p.anim, moving: !!p.path },
    monsters: game.level.monsters.length,
    objects: game.level.objects.length,
    items: game.level.items.length,
    explored,
    levelSize: [game.level.tiles.w, game.level.tiles.h],
  };
}

function boot() {
  const canvas = document.getElementById(CANVAS_ID);
  const game = createGame(canvas, readSeed());
  const loop = createLoop({
    tickRate: TICK_RATE,
    update: () => update(game),
    render: (alpha) => render(game, loop, alpha),
  });
  fitCanvas(canvas);
  window.addEventListener('resize', () => fitCanvas(canvas));
  const loading = document.getElementById(LOADING_ID);
  if (loading) loading.remove();
  loop.start();
  game.debug.api = {
    game,
    loop,
    step(n) { loop.stepTicks(n); },
    state() { return stateSummary(game); },
  };
  window.__game = game.debug.api;
}

boot();

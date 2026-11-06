/**
 * Bootstrap and integration: loads the active theme + balance, wires every
 * module's hooks onto `game`, runs the fixed-step simulation in the order
 * docs/CONTRACTS.md fixes, routes input UI-first, and exposes `window.__game`.
 *
 * Tick order: input (UI first, then world intents) → player → monsters →
 * npcs → objects → missiles → quests → light/FOV → UI bookkeeping.
 *
 * Most re-theming never touches this file. Extensions that need a new seam
 * (a new hook, a new tick step) add it here and document it in CONTRACTS.md.
 */
import { createLoop } from './core/loop.js';
import { createBus } from './core/events.js';
import { createInput } from './core/input.js';
import { createAudio } from './core/audio.js';
import { createRng } from './core/rng.js';
import { createCamera, renderPos } from './render/camera.js';
import { renderWorld, getTileAtScreen, getEntityAtScreen } from './render/iso.js';
import { setRenderScale } from './render/draw_util.js';
import { renderUi, updateUi, uiHandleClick, uiHandleKey, uiHitTest, openPanel, closeAll, openVendor, addMessage } from './render/ui.js';
import { computeFov, MAX_LIGHT } from './world/fov.js';
import { generateLevel, levelDepsReady } from './world/levelgen/index.js';
import { installPlayerHooks, createPlayer, updatePlayer, bindPlayerClass, respawnPlayer, teleportPlayer, giveXp } from './entities/player.js';
import { updateMonsters, loadMonsterDeps, spawnMonster, killMonster } from './entities/monster.js';
import { updateMissiles } from './entities/missile.js';
import { interactObject, updateObjects } from './entities/objects.js';
import { loadItemDeps } from './items/deps.js';
import { generateItem, generateGold, identify } from './items/itemgen.js';
import { tryPickUp, recalcPlayer } from './items/inventory.js';
import { initSkills } from './skills/skills.js';
import { initQuests, updateQuests } from './quests/quests.js';
import { installMetaHooks, updateNpcs, gossipLine, serviceHeal } from './npc/npcs.js';
import { saveGame, loadGame, restoreGame, deleteSave } from './save/save.js';
import { mergeStrings, setActiveStrings } from '../data/strings.js';
import BALANCE from '../data/balance/index.js';
import ACTIVE_THEME from '../data/active_theme.js';

const VIEW_W = 960;
const VIEW_H = 540;
const TICK_RATE = 20;
const BG_COLOR = '#0a0a0c';
const CANVAS_ID = 'game';
const LOADING_ID = 'loading';
const LEFT = 0;
const RIGHT = 2;
const HOLD_REPEAT_TICKS = 4;      // click-and-hold re-issues the walk target every 4 ticks
const LIGHT_EVERY_TICKS = 2;      // FOV refresh cadence when the player has not changed tile
const DEFAULT_SLOT = 0;
const DIFFICULTIES = ['normal', 'veteran', 'elite'];

/* ------------------------------------------------------------------ */
/* Game object                                                         */
/* ------------------------------------------------------------------ */

/**
 * Create the shared game object with core services. Theme content is
 * attached by `loadContent`.
 * @param {HTMLCanvasElement|null} canvas null for headless use
 * @returns {object} game
 */
export function createGame(canvas) {
  const camera = createCamera(VIEW_W, VIEW_H);
  const game = {
    seed: 0,
    tick: 0,
    mode: 'menu',
    difficulty: 'normal',
    rng: createRng(1),
    bus: createBus(),
    input: canvas ? createInput(canvas, camera) : null,
    audio: createAudio(),
    camera,
    canvas,
    ctx: canvas ? canvas.getContext('2d') : null,
    theme: null,
    balance: BALANCE,
    strings: mergeStrings({}),
    level: null,
    levels: {},
    town: null,
    player: null,
    quests: {},
    stats: freshStats(),
    flags: {},
    nextId: 1,
    hooks: {},
    ui: { loading: { title: 'Loading', text: '', progress: 0 } },
    renderAlpha: 1,
    debug: { god: false },
    _held: { ticks: 0, kind: null, target: null },
    _lightKey: '',
  };
  return game;
}

function freshStats() {
  return { kills: 0, deaths: 0, gold: 0, deepest: 0, playTicks: 0 };
}

/**
 * Load the active theme, strings and every module's late-bound deps, then
 * install hooks. Must finish before the first new game.
 * @param {object} game
 * @param {string} [themeId]
 */
export async function loadContent(game, themeId = ACTIVE_THEME) {
  const mod = await import(`../data/themes/${themeId}/index.js`);
  game.theme = mod.default;
  game.strings = mergeStrings(game.theme.strings || {});
  setActiveStrings(game.strings);
  game.ui.loading = { title: game.theme.meta.title, text: game.strings.loading || 'Loading', progress: 0.3 };
  await levelDepsReady;
  await loadItemDeps();
  await loadMonsterDeps();
  await installMetaHooks(game);
  installPlayerHooks(game);
  installIntegrationHooks(game);
  initSkills(game.theme.skills);
  game.audio.setDescriptors(game.theme.sfx || {});
  game.bus.on('sfx', (p) => { if (p && p.name) game.audio.play(p.name); });
  if (typeof document !== 'undefined' && game.theme.meta.title) document.title = game.theme.meta.title;
  game.ui.loading = null;
  return game;
}

/* ------------------------------------------------------------------ */
/* Hooks owned by the integrator                                       */
/* ------------------------------------------------------------------ */

function installIntegrationHooks(game) {
  const h = game.hooks;
  h.changeLevel = (g, depth, viaPortal) => changeLevel(g, depth, viaPortal);
  h.onInteract = (g, obj) => interactObject(g, obj, g.player);
  h.onTalk = (g, npc) => talkTo(g, npc);
  h.menuAction = (g, action) => menuAction(g, action);
}

/**
 * Move the player to `depth`, generating it on first visit (levels persist
 * in game.levels). Placement: portal → anchor/portal tile; going up → the
 * level's down stairs; otherwise the level's entry.
 */
export function changeLevel(game, depth, viaPortal = false) {
  const p = game.player;
  const from = game.level ? game.level.depth : null;
  const old = game.level;
  if (old && p) {
    releaseTile(old, p.tx, p.ty, p.id);
    if (p.walk) releaseTile(old, p.walk.x, p.walk.y, p.id);
  }
  let level = game.levels[depth];
  if (!level) {
    level = generateLevel(game, depth);
    game.levels[depth] = level;
  }
  if (depth === 0) game.town = level;
  game.level = level;
  level.missiles = level.missiles || [];
  let pos;
  if (viaPortal) pos = depth === 0 ? (level.portalAnchor || level.spawn || level.entry) : (p.portalPos || level.portal || level.entry);
  else if (from !== null && from > depth) pos = level.entryBelow || level.stairs.down || level.entry;
  else if (from === null && depth === 0) pos = level.spawn || level.entry;
  else pos = level.entry;
  if (p) {
    p.path = null; p.walk = null; p.intent = null; p.action = null; p.ox = 0; p.oy = 0;
    p.tx = pos.x; p.ty = pos.y;
    teleportPlayer(game, pos.x, pos.y);
  }
  level.visited = true;
  game.mode = depth === 0 ? 'town' : 'dungeon';
  if (game.ui) { game.ui.vendor = null; game.ui.dialogue = null; }
  game._lightKey = '';
  updateLight(game, true);
  if (p) game.camera.follow(renderPos(p, 1), 1);
  game.bus.emit('levelEntered', { depth, from });
  if (depth > 0) addMessage(game, level.name);
  return level;
}

function releaseTile(level, x, y, id) {
  const t = level.tiles;
  if (!t || x < 0 || y < 0 || x >= t.w || y >= t.h) return;
  const i = y * t.w + x;
  if (level.occupant[i] === id) level.occupant[i] = 0;
}

/** Talk: build the dialogue box from npcs.getDialogue and map its option ids to actions. */
function talkTo(game, npc) {
  if (!npc) return false;
  const d = game.hooks.getDialogue(game, npc);
  game.bus.emit('npcTalked', { npc });
  game.bus.emit('sfx', { name: 'click' });
  game.ui.dialogue = {
    npc: npc.npcId || npc.id, name: npc.name, title: d.title, lines: d.lines,
    options: d.options.map((o) => ({ label: o.label, action: optionAction(npc, o.action), keepOpen: o.action === 'gossip' })),
  };
  game.ui.open = 'dialogue';
  return true;
}

function optionAction(npc, id) {
  switch (id) {
    case 'trade': return (g) => openVendor(g, npc);
    case 'heal': return (g) => { serviceHeal(g, npc); };
    case 'gossip': return (g) => {
      const d = g.ui.dialogue;
      if (d) d.lines = [gossipLine(g, npc)];
    };
    case 'leave': return () => {};
    default: return (g) => { openVendor(g, npc); g.ui.vendorTab = 'services'; };
  }
}

/* ------------------------------------------------------------------ */
/* New game / save / load / menu                                       */
/* ------------------------------------------------------------------ */

function resetUi(game) {
  closeAll(game);
  Object.assign(game.ui, {
    menuOpen: false, dialogue: null, vendor: null, cursorItem: null, cursorMode: null,
    messages: [], floats: [], deathLine: null, lastHitMonster: null, hover: null, hoverUi: null,
  });
}

/**
 * Start a fresh run. seed null → time-based.
 * @param {object} game
 * @param {string} classId
 * @param {string} [name]
 * @param {number|string|null} [seed]
 * @param {{difficulty?:string, hardcore?:boolean}} [opts]
 */
export function newGame(game, classId, name = 'Hero', seed = null, opts = {}) {
  const s = seed === null || seed === undefined || seed === '' ? (Date.now() >>> 0) : seed;
  game.seed = s;
  game.rng = createRng(s);
  game.tick = 0;
  game.nextId = 1;
  game.levels = {};
  game.town = null;
  game.level = null;
  game.player = null;
  game.stats = freshStats();
  game.flags = { hardcore: !!opts.hardcore };
  game.difficulty = opts.difficulty || 'normal';
  resetUi(game);
  initQuests(game);
  game.levels[0] = generateLevel(game, 0);
  game.town = game.levels[0];
  game.level = game.town;
  createPlayer(game, classId, name);
  game.level = null;
  changeLevel(game, 0, false);
  const intro = game.theme.flavor && game.theme.flavor.intro;
  if (Array.isArray(intro)) intro.forEach((t) => addMessage(game, t));
  else if (intro) addMessage(game, intro);
  return game;
}

function themeId(game) {
  return (game.theme && game.theme.meta && game.theme.meta.id) || ACTIVE_THEME;
}

export function saveCurrent(game, slot = DEFAULT_SLOT) {
  if (!game.player || game.mode === 'dead' || game.mode === 'menu') return false;
  const ok = saveGame(game, slot);
  addMessage(game, ok ? (game.strings.saved || 'Game saved.') : (game.strings.saveFailed || 'Could not save.'));
  return ok;
}

export function loadSlot(game, slot = DEFAULT_SLOT) {
  const data = loadGame(slot, themeId(game));
  if (!data) {
    addMessage(game, game.strings.noSave || 'No saved game.');
    return false;
  }
  resetUi(game);
  restoreGame(data, game);
  bindPlayerClass(game, game.player);
  recalcPlayer(game);
  game.mode = game.level && game.level.depth === 0 ? 'town' : 'dungeon';
  if (game.player.dead) { respawnPlayer(game); changeLevel(game, 0, false); }
  game._lightKey = '';
  updateLight(game, true);
  game.camera.follow(renderPos(game.player, 1), 1);
  addMessage(game, game.strings.loaded || 'Game loaded.');
  return true;
}

function menuAction(game, action) {
  switch (action.type) {
    case 'continue': game.ui.menuOpen = false; return true;
    case 'save': game.ui.menuOpen = false; return saveCurrent(game, action.slot || DEFAULT_SLOT);
    case 'load': return loadSlot(game, action.slot || DEFAULT_SLOT);
    case 'mute': game.audio.muted = !game.audio.muted; return true;
    case 'respawn':
      if (!game.player || !game.player.dead || game.flags.hardcore) return false;
      respawnPlayer(game);
      changeLevel(game, 0, false);
      return true;
    case 'newGame':
      if (action.classId) {
        newGame(game, action.classId, action.name, action.seed, { difficulty: action.difficulty, hardcore: action.hardcore });
        return true;
      }
      game.mode = 'menu';
      resetUi(game);
      return true;
    case 'quitToMenu':
      game.mode = 'menu';
      resetUi(game);
      return true;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function handleInput(game) {
  const input = game.input;
  if (!input) return;
  for (const key of input.consumeKeyPresses()) {
    game.audio.resume();
    uiHandleKey(game, key);
  }
  const clicks = input.consumeClicks();
  for (const c of clicks) {
    game.audio.resume();
    if (identifyCursor(game, c)) continue;
    if (uiHandleClick(game, c.x, c.y, c.button, c)) { game._held.kind = null; continue; }
    worldClick(game, c);
  }
  if (!clicks.length) heldMouse(game);
}

/** Identify cursor (scroll / skill): next click on an inventory item identifies it. */
function identifyCursor(game, c) {
  if (game.ui.cursorMode !== 'identify') return false;
  game.ui.cursorMode = null;
  const hit = uiHitTest(game, c.x, c.y);
  const item = hit && hit.item;
  if (c.button === LEFT && item && !item.identified) {
    identify(item);
    recalcPlayer(game);
    addMessage(game, `${game.strings.identified || 'Identified'}: ${item.name}`);
    game.bus.emit('sfx', { name: 'cast' });
  }
  return true;
}

/**
 * Turn a world click into a player intent.
 * Left: monster → attack, npc → talk, object → interact, item → pickup, tile → move.
 * Shift+left: attack in place toward the cursor. Right: cast the selected skill.
 */
export function worldClick(game, c) {
  const p = game.player;
  if (!p || p.dead || !game.level || game.mode === 'menu') return;
  const ent = getEntityAtScreen(game, c.x, c.y);
  const tile = getTileAtScreen(game, c.x, c.y);
  if (c.button === RIGHT) {
    const skillId = p.selectedSkill || game.ui.selectedSkill;
    if (!skillId) return;
    const target = ent && ent.type === 'monster' ? ent.entity.id : tile ? { x: tile.x, y: tile.y } : null;
    if (target !== null) p.intent = { type: 'cast', target, skillId };
    return;
  }
  if (c.button !== LEFT) return;
  const intent = intentFor(game, ent, tile, c.shift);
  if (!intent) return;
  p.intent = intent;
  game._held = { ticks: 0, kind: intent.type, target: intent.target };
}

function intentFor(game, ent, tile, shift) {
  if (ent && !ent.entity.hidden) {
    const e = ent.entity;
    if (ent.type === 'monster' && !e.ally) return { type: 'attack', target: e.id };
    if (ent.type === 'npc') return { type: 'talk', target: e.id };
    if (ent.type === 'object') return { type: 'interact', target: e.id };
    if (ent.type === 'item') return { type: 'pickup', target: e.id };
  }
  if (!tile || shift) return null;
  return { type: 'move', target: { x: tile.x, y: tile.y } };
}

/** Click-and-hold: keep walking toward the cursor / keep attacking the same monster. */
function heldMouse(game) {
  const p = game.player;
  const held = game._held;
  if (!p || p.dead || !game.input.mouse.down || !held.kind || game.mode === 'menu') { held.kind = game.input.mouse.down ? held.kind : null; return; }
  held.ticks++;
  if (held.ticks % HOLD_REPEAT_TICKS !== 0) return;
  const mx = game.input.mouse.x;
  const my = game.input.mouse.y;
  if (uiHitTest(game, mx, my)) return;
  if (held.kind === 'move') {
    const tile = getTileAtScreen(game, mx, my);
    if (tile && (!p.intent || p.intent.type === 'move')) p.intent = { type: 'move', target: { x: tile.x, y: tile.y } };
  } else if (held.kind === 'attack' && !p.intent) {
    const m = (game.level.monsters || []).find((x) => x.id === held.target && !x.dead);
    if (m) p.intent = { type: 'attack', target: m.id };
  }
}

/* ------------------------------------------------------------------ */
/* Light / FOV                                                         */
/* ------------------------------------------------------------------ */

const scratchLight = { buf: null };

/**
 * Player FOV marks tiles explored; static lights (braziers, portals) only
 * brighten tiles already explored. Town is always fully lit.
 */
export function updateLight(game, force = false) {
  const level = game.level;
  const p = game.player;
  if (!level || !p) return;
  if (level.isTown) {
    level.light.fill(MAX_LIGHT);
    level.explored.fill(1);
    return;
  }
  const key = `${level.depth}:${p.tx},${p.ty}:${p.lightRadius}`;
  if (!force && key === game._lightKey && game.tick % LIGHT_EVERY_TICKS !== 0) return;
  game._lightKey = key;
  const n = level.light.length;
  level.light.fill(0);
  computeFov(level.tiles, p.tx, p.ty, p.lightRadius || 10, level.light);
  for (let i = 0; i < n; i++) if (level.light[i]) level.explored[i] = 1;
  const lights = (level.objects || []).filter((o) => o.light > 0 && !o.removed);
  if (!lights.length) return;
  if (!scratchLight.buf || scratchLight.buf.length !== n) scratchLight.buf = new Uint8Array(n);
  const buf = scratchLight.buf;
  buf.fill(0);
  for (const o of lights) computeFov(level.tiles, o.tx, o.ty, o.light, buf);
  for (let i = 0; i < n; i++) if (buf[i] > level.light[i] && level.explored[i]) level.light[i] = buf[i];
}

/* ------------------------------------------------------------------ */
/* Tick + render                                                       */
/* ------------------------------------------------------------------ */

/** One simulation tick (20 per second). */
export function update(game) {
  handleInput(game);
  if (game.mode === 'menu' || game.ui.loading || !game.player || !game.level) {
    updateUi(game);
    return;
  }
  const paused = game.ui.menuOpen;
  if (!paused) {
    game.tick++;
    game.stats.playTicks++;
    if (game.debug.god) { game.player.hp = game.player.hpMax; game.player.mp = game.player.mpMax; }
    updatePlayer(game);
    if (game.mode !== 'win') {
      updateMonsters(game);
      updateNpcs(game);
      updateObjects(game);
      updateMissiles(game);
      updateQuests(game);
    }
    updateLight(game);
    if (game.player.dead && game.flags.hardcore && !game.flags.hardcoreDeleted) {
      game.flags.hardcoreDeleted = true;
      deleteSave(DEFAULT_SLOT, themeId(game));
    }
  }
  updateUi(game);
}

/** Draw one frame. */
export function render(game, alpha) {
  const { ctx, camera } = game;
  if (!ctx) return;
  game.renderAlpha = alpha;
  const S = game.renderScale || 1;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (game.mode !== 'menu' && game.level && game.player && !game.ui.loading) {
    camera.follow(renderPos(game.player, alpha), 1);
    renderWorld(ctx, game);
  }
  renderUi(ctx, game);
}

/* ------------------------------------------------------------------ */
/* Debug API (window.__game) — used by tools/smoke_test.mjs            */
/* ------------------------------------------------------------------ */

function stateSummary(game) {
  const p = game.player;
  const L = game.level;
  return {
    mode: game.mode,
    depth: L ? L.depth : null,
    tick: game.tick,
    seed: game.seed,
    levelName: L ? L.name : null,
    player: p ? { level: p.level, hp: p.hp, hpMax: p.hpMax, mp: p.mp, mpMax: p.mpMax, xp: p.xp, gold: p.gold, x: p.tx, y: p.ty, class: p.classId, dead: !!p.dead, skills: { ...p.skills }, selectedSkill: p.selectedSkill } : null,
    counts: L ? {
      monsters: L.monsters.length,
      alive: L.monsters.filter((m) => !m.dead && !m.ally).length,
      items: L.items.length,
      objects: L.objects.length,
      missiles: (L.missiles || []).length,
      npcs: (L.npcs || []).length,
    } : null,
    quests: Object.fromEntries(Object.entries(game.quests || {}).map(([k, v]) => [k, v.state])),
    ui: { left: game.ui.left, right: game.ui.right, vendor: game.ui.vendor, dialogue: !!game.ui.dialogue, menuOpen: game.ui.menuOpen },
  };
}

function screenOf(game, tx, ty) {
  game.camera.follow(renderPos(game.player, 1), 1);
  return game.camera.worldToScreen ? game.camera.worldToScreen(tx + 0.5, ty + 0.5) : null;
}

function makeDebugApi(game, loop) {
  return {
    game,
    loop,
    step(n = 1) { for (let i = 0; i < n; i++) update(game); },
    state() { return stateSummary(game); },
    classes() { return game.theme.classes.map((c) => c.id); },
    newGame(classId, seed = 1, opts = {}) { newGame(game, classId || game.theme.classes[0].id, 'Tester', seed, opts); return stateSummary(game); },
    teleport(depth) { changeLevel(game, depth, false); return stateSummary(game); },
    give(what, amount) {
      if (what === 'gold') { game.player.gold += amount | 0; return true; }
      const item = generateItem(game, { level: Math.max(1, game.player.level), baseId: what, quality: amount || 'any', source: 'debug' });
      return !!(item && tryPickUp(game, item));
    },
    gold() { return generateGold(game, game.level.depth || 1); },
    item(baseId, quality = 'any') { return generateItem(game, { level: Math.max(1, game.level.depth * 2 || 1), baseId, quality, source: 'debug' }); },
    spawn(typeId, dx = 2, dy = 0) { return spawnMonster(game, typeId, game.player.tx + dx, game.player.ty + dy); },
    killAll() { for (const m of game.level.monsters) if (!m.dead && !m.ally) killMonster(game, m, game.player); },
    setGodMode(on) { game.debug.god = !!on; },
    xp(n) { giveXp(game, n); },
    clickTile(tx, ty, button = LEFT) { game.player.intent = button === RIGHT ? { type: 'cast', target: { x: tx, y: ty }, skillId: game.player.selectedSkill } : { type: 'move', target: { x: tx, y: ty } }; },
    castAt(skillId, tx, ty) { game.player.intent = { type: 'cast', target: { x: tx, y: ty }, skillId }; },
    attack(monsterId) { game.player.intent = { type: 'attack', target: monsterId }; },
    interact(objId) { game.player.intent = { type: 'interact', target: objId }; },
    talk(npcId) { const n = game.level.npcs.find((x) => x.npcId === npcId || x.id === npcId); if (n) game.player.intent = { type: 'talk', target: n.id }; return !!n; },
    openPanel(name) { openPanel(game, name); },
    closeAll() { resetUi(game); },
    save(slot = DEFAULT_SLOT) { return saveCurrent(game, slot); },
    load(slot = DEFAULT_SLOT) { return loadSlot(game, slot); },
    menu(action) { return menuAction(game, action); },
    screenOf(tx, ty) { return screenOf(game, tx, ty); },
    reveal() { if (game.level) game.level.explored.fill(1); },
    render() { render(game, 1); },
    screenshotHints: ['town', 'dungeon', 'inventory', 'character', 'vendor', 'menu'],
  };
}

/* ------------------------------------------------------------------ */
/* Browser boot                                                        */
/* ------------------------------------------------------------------ */

function fitCanvas(canvas) {
  const w = window.innerWidth || VIEW_W;
  const h = window.innerHeight || VIEW_H;
  const scale = Math.min(w / VIEW_W, h / VIEW_H); // hi-res backing store, so fractional scales stay sharp
  canvas.style.width = `${Math.floor(VIEW_W * scale)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * scale)}px`;
}

function urlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function boot() {
  const canvas = document.getElementById(CANVAS_ID);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // Hi-res backing store: logical size stays VIEW_W x VIEW_H, pixels are RENDER_SCALE x that.
  const scale = Math.max(2, Math.min(3, Math.ceil(window.devicePixelRatio || 1)));
  setRenderScale(scale);
  canvas.width = VIEW_W * scale;
  canvas.height = VIEW_H * scale;
  canvas.logicalW = VIEW_W;
  canvas.logicalH = VIEW_H;
  const game = createGame(canvas);
  game.renderScale = scale;
  const loop = createLoop({ tickRate: TICK_RATE, update: () => update(game), render: (alpha) => render(game, alpha) });
  fitCanvas(canvas);
  window.addEventListener('resize', () => fitCanvas(canvas));
  window.__game = makeDebugApi(game, loop);
  game.debug.api = window.__game;
  loop.start();
  try {
    await loadContent(game, urlParam('theme') || ACTIVE_THEME);
  } catch (err) {
    console.error(err);
    game.ui.loading = { title: 'Failed to load theme', text: String(err && err.message), progress: 0 };
    return;
  }
  const loading = document.getElementById(LOADING_ID);
  if (loading) loading.remove();
  const quick = urlParam('class');
  if (quick) newGame(game, quick, 'Hero', urlParam('seed') || null, { difficulty: DIFFICULTIES.includes(urlParam('difficulty')) ? urlParam('difficulty') : 'normal' });
  window.__game.ready = true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot();

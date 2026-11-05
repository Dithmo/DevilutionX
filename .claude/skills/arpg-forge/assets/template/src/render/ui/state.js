/**
 * UI state bootstrap, panel open/close rules, message + floating number
 * queues, and the bridge to sibling gameplay modules.
 *
 * Sibling modules are imported as namespaces so that a name missing from a
 * sibling (still being written) degrades to a no-op instead of a link error.
 *
 * game.ui fields owned here (all created lazily by `ensureUi`):
 *   left:   null|'character'|'skills'|'quests'    (left half panel)
 *   right:  null|'inventory'                      (right half panel)
 *   open:   last opened panel name or null        (CONTRACTS compat)
 *   vendor: npcId|null, dialogue: {...}|null, automap: boolean, menuOpen: boolean
 *   hover: null|{kind,id,entity}, hoverUi: payload|null, hoverTile: {x,y}|null
 *   cursorItem: Item|null, selectedSkill: skillId|null
 *   messages: [{text,color,ttl}], floats: [{x,y,text,color,ttl,ttlMax,born,key}]
 *   viewInset: {left,right}, skillPage, questSel, vendorTab, vendorPage, vendorMsg
 *   lastHitMonster: {id,tick}|null, deathLine, loading, menu: {classIndex,name,seed,focus}
 */
import * as Inventory from '../../items/inventory.js';
import * as ItemGen from '../../items/itemgen.js';
import * as Skills from '../../skills/skills.js';
import * as Npcs from '../../npc/npcs.js';
import * as Quests from '../../quests/quests.js';
import * as PlayerMod from '../../entities/player.js';
import * as Combat from '../../entities/combat.js';
import { uiLayout } from './layout.js';
import { palette } from './widgets.js';

export const bridge = { Inventory, ItemGen, Skills, Npcs, Quests, PlayerMod, Combat };

const LEFT_PANELS = new Set(['character', 'skills', 'quests']);
const RIGHT_PANELS = new Set(['inventory']);
const MESSAGE_MAX = 32;
const FLOAT_MAX = 64;
const DEFAULT_HOTKEY_NAMES = ['F1', 'F2', 'F3', 'F4'];
const LAST_HIT_TICKS = 100;

/** Call `mod[name](...args)` if it exists, else return `fallback`. */
export function call(mod, name, fallback, ...args) {
  const fn = mod && mod[name];
  if (typeof fn !== 'function') return fallback;
  return fn(...args);
}

/** Does the sibling export this function? */
export function has(mod, name) {
  return !!(mod && typeof mod[name] === 'function');
}

/** Make sure game.ui has every field the UI reads; bind bus events once. */
export function ensureUi(game) {
  if (!game.ui) game.ui = {};
  const ui = game.ui;
  if (ui._ready) return ui;
  ui._ready = true;
  if (ui.left === undefined) ui.left = null;
  if (ui.right === undefined) ui.right = null;
  if (ui.open === undefined) ui.open = null;
  if (ui.vendor === undefined) ui.vendor = null;
  if (ui.dialogue === undefined) ui.dialogue = null;
  if (ui.automap === undefined) ui.automap = false;
  if (ui.menuOpen === undefined) ui.menuOpen = false;
  if (ui.hover === undefined) ui.hover = null;
  if (ui.hoverUi === undefined) ui.hoverUi = null;
  if (ui.hoverTile === undefined) ui.hoverTile = null;
  if (ui.cursorItem === undefined) ui.cursorItem = null;
  if (ui.selectedSkill === undefined) ui.selectedSkill = null;
  if (!Array.isArray(ui.messages)) ui.messages = [];
  if (!Array.isArray(ui.floats)) ui.floats = [];
  if (!ui.viewInset) ui.viewInset = { left: 0, right: 0 };
  if (ui.skillPage === undefined) ui.skillPage = 0;
  if (ui.questSel === undefined) ui.questSel = 0;
  if (ui.vendorTab === undefined) ui.vendorTab = 'buy';
  if (ui.vendorPage === undefined) ui.vendorPage = 0;
  if (ui.vendorMsg === undefined) ui.vendorMsg = null;
  if (ui.lastHitMonster === undefined) ui.lastHitMonster = null;
  if (ui.deathLine === undefined) ui.deathLine = null;
  if (ui.loading === undefined) ui.loading = null;
  if (!ui.menu) ui.menu = { classIndex: 0, name: '', seed: String(game.seed == null ? '' : game.seed), focus: 'name' };
  ui._hits = ui._hits || [];
  if (game.bus && typeof game.bus.on === 'function' && !ui._bound) {
    ui._bound = true;
    game.bus.on('float', (p) => addFloat(game, p));
    game.bus.on('message', (p) => addMessage(game, p && p.text, p && p.color));
    game.bus.on('monsterHit', (p) => {
      const m = p && (p.m || p.monster || p.target);
      if (m && m.id) ui.lastHitMonster = { id: m.id, tick: game.tick };
    });
  }
  return ui;
}

/** Names of the 4 skill hotkeys (`game.hotkeys` overrides, else F1..F4). */
export function hotkeyNames(game) {
  const hk = game.hotkeys;
  if (Array.isArray(hk) && hk.length >= DEFAULT_HOTKEY_NAMES.length) return hk.slice(0, DEFAULT_HOTKEY_NAMES.length).map(String);
  if (hk && Array.isArray(hk.skills)) return hk.skills.slice(0, DEFAULT_HOTKEY_NAMES.length).map(String);
  return DEFAULT_HOTKEY_NAMES;
}

/** Push a message to the log (also used by the `message` bus event). */
export function addMessage(game, text, color) {
  const ui = ensureUi(game);
  if (!text) return;
  ui.messages.push({ text: String(text), color: color || palette(game).text, ttl: uiLayout.messages.ttl });
  if (ui.messages.length > MESSAGE_MAX) ui.messages.splice(0, ui.messages.length - MESSAGE_MAX);
}

/**
 * Add a floating number / text at world coords. Numbers on the same tile
 * with the same colour within `mergeTicks` ticks are summed into one float.
 * @param {{x:number,y:number,text:string|number,color?:string,element?:string,kind?:string}} p
 */
export function addFloat(game, p) {
  const ui = ensureUi(game);
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
  const color = p.color || elementColor(game, p.element || p.kind);
  const key = `${Math.floor(p.x)},${Math.floor(p.y)},${color}`;
  const num = Number(p.text);
  const ttlMax = uiLayout.floats.ttl;
  if (Number.isFinite(num)) {
    for (let i = ui.floats.length - 1; i >= 0; i--) {
      const f = ui.floats[i];
      if (f.key !== key || game.tick - f.born > uiLayout.floats.mergeTicks) continue;
      const cur = Number(f.text);
      if (!Number.isFinite(cur)) continue;
      f.text = String(cur + num);
      f.ttl = ttlMax;
      f.born = game.tick;
      return;
    }
  }
  ui.floats.push({ x: p.x, y: p.y, text: String(p.text), color, ttl: ttlMax, ttlMax, born: game.tick, key, crit: !!p.crit });
  if (ui.floats.length > FLOAT_MAX) ui.floats.splice(0, ui.floats.length - FLOAT_MAX);
}

/** Colour for a damage element / float kind (combat.js may override). */
export function elementColor(game, element) {
  const fromCombat = call(Combat, 'elementColor', null, element);
  if (fromCombat) return fromCombat;
  const pal = palette(game);
  switch (element) {
    case 'fire': return '#ff7a3c';
    case 'cold': return '#7ad7ff';
    case 'shock': return '#ffe66d';
    case 'arcane': return '#c98bff';
    case 'heal': return pal.good;
    case 'mana': return pal.accent;
    case 'crit': return pal.gold;
    case 'playerHit': return pal.danger;
    case 'xp': return pal.xp;
    default: return pal.text;
  }
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

/** Is any panel / modal open? */
export function anyPanelOpen(game) {
  const ui = ensureUi(game);
  return !!(ui.left || ui.right || ui.vendor || ui.dialogue || ui.automap || ui.menuOpen);
}

/** Open a panel by name, closing whatever shares its half of the screen. */
export function openPanel(game, name) {
  const ui = ensureUi(game);
  if (LEFT_PANELS.has(name)) {
    ui.left = name;
    ui.vendor = null;
  } else if (RIGHT_PANELS.has(name)) {
    ui.right = name;
  } else if (name === 'automap') ui.automap = true;
  else if (name === 'menu') ui.menuOpen = true;
  else if (name === 'vendor') {
    ui.left = null;
    ui.right = 'inventory';
  }
  ui.open = name;
  play(game, 'open');
}

/** Close a panel by name. */
export function closePanel(game, name) {
  const ui = ensureUi(game);
  if (LEFT_PANELS.has(name) && ui.left === name) ui.left = null;
  else if (RIGHT_PANELS.has(name) && ui.right === name) ui.right = null;
  else if (name === 'automap') ui.automap = false;
  else if (name === 'menu') ui.menuOpen = false;
  else if (name === 'vendor') {
    ui.vendor = null;
    ui.vendorMsg = null;
  } else if (name === 'dialogue') ui.dialogue = null;
  ui.open = ui.left || ui.right || (ui.vendor ? 'vendor' : null) || (ui.dialogue ? 'dialogue' : null) || (ui.automap ? 'automap' : null) || (ui.menuOpen ? 'menu' : null);
  play(game, 'close');
}

/** Toggle a panel. */
export function togglePanel(game, name) {
  if (isOpen(game, name)) closePanel(game, name);
  else openPanel(game, name);
}

/** @returns {boolean} */
export function isOpen(game, name) {
  const ui = ensureUi(game);
  if (LEFT_PANELS.has(name)) return ui.left === name;
  if (RIGHT_PANELS.has(name)) return ui.right === name;
  if (name === 'automap') return ui.automap;
  if (name === 'menu') return ui.menuOpen;
  if (name === 'vendor') return !!ui.vendor;
  if (name === 'dialogue') return !!ui.dialogue;
  return false;
}

/** Close every panel and modal (Space). */
export function closeAll(game) {
  const ui = ensureUi(game);
  const was = anyPanelOpen(game);
  ui.left = null;
  ui.right = null;
  ui.vendor = null;
  ui.vendorMsg = null;
  ui.dialogue = null;
  ui.automap = false;
  ui.menuOpen = false;
  ui.open = null;
  if (was) play(game, 'close');
}

/** Open the vendor screen for an NPC (also opens the inventory on the right). */
export function openVendor(game, npc) {
  const ui = ensureUi(game);
  ui.vendor = npc && typeof npc === 'object' ? npc.npcId || npc.id : npc;
  ui.vendorTab = 'buy';
  ui.vendorPage = 0;
  ui.vendorMsg = null;
  ui.dialogue = null;
  openPanel(game, 'vendor');
}

/** Resolve the NPC object for `ui.vendor` / a dialogue. */
export function findNpc(game, ref) {
  if (!ref) return null;
  if (typeof ref === 'object') return ref;
  const lists = [game.level && game.level.npcs, game.town && game.town.npcs];
  for (const list of lists) {
    if (!list) continue;
    const n = list.find((e) => e.npcId === ref || e.id === ref);
    if (n) return n;
  }
  return null;
}

/** Recompute how much of the world view the side panels cover. */
export function updateViewInset(game) {
  const ui = ensureUi(game);
  let left = 0;
  if (ui.vendor) left = uiLayout.vendor.w;
  else if (ui.left) left = uiLayout.leftPanel.w;
  const right = ui.right ? uiLayout.rightPanel.w : 0;
  ui.viewInset.left = left;
  ui.viewInset.right = right;
  return ui.viewInset;
}

/** Monster to show in the top health bar: hovered, else recently hit. */
export function focusMonster(game) {
  const ui = ensureUi(game);
  if (ui.hover && ui.hover.kind === 'monster' && ui.hover.entity && !ui.hover.entity.dead) return ui.hover.entity;
  const lh = ui.lastHitMonster;
  if (lh && game.level && game.tick - lh.tick <= LAST_HIT_TICKS) {
    const m = game.level.monsters && game.level.monsters.find((e) => e.id === lh.id);
    if (m && !m.dead) return m;
  }
  return null;
}

/** Play a UI sound if audio is available. */
export function play(game, name) {
  if (game.audio && typeof game.audio.play === 'function') game.audio.play(name);
}

/** Skill definition by id from the theme. */
export function skillDef(game, skillId) {
  const list = game.theme && game.theme.skills;
  if (!list || !skillId) return null;
  if (Array.isArray(list)) return list.find((s) => s.id === skillId) || null;
  return list[skillId] || null;
}

/** Class definition by id from the theme. */
export function classDef(game, classId) {
  const list = game.theme && game.theme.classes;
  if (!list) return null;
  if (Array.isArray(list)) return list.find((c) => c.id === classId) || null;
  return list[classId] || null;
}

/** Player class list from the theme (array form). */
export function classList(game) {
  const list = game.theme && game.theme.classes;
  if (!list) return [];
  return Array.isArray(list) ? list : Object.values(list);
}

/** Call `game.hooks.menuAction` (or fall back to a few built-in behaviours). */
export function menuAction(game, action) {
  const ui = ensureUi(game);
  const hook = game.hooks && game.hooks.menuAction;
  if (typeof hook === 'function') return hook(game, action);
  switch (action.type) {
    case 'continue':
      ui.menuOpen = false;
      return true;
    case 'mute':
      if (game.audio) game.audio.muted = !game.audio.muted;
      return true;
    default:
      addMessage(game, `${action.type}: no handler`, palette(game).textDim);
      return false;
  }
}

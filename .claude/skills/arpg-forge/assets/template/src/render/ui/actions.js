/**
 * Input routing for the UI: clicks resolve against the hit registry filled
 * during the last render (so handling can never disagree with what was
 * drawn), keys toggle panels / use the belt / bind skills / type into the
 * main-menu fields.
 *
 * Gameplay mutations go through the sibling modules when they export the
 * function (inventory.js, player.js, npcs.js ...) and fall back to minimal
 * local behaviour otherwise, so the UI stays usable while siblings land.
 */
import { palette, str, hitAt } from './widgets.js';
import {
  ensureUi, bridge, call, addMessage, togglePanel, openPanel, closePanel, closeAll, anyPanelOpen,
  openVendor, findNpc, hotkeyNames, menuAction, play, classList,
} from './state.js';
import { beltAccepts } from './hud.js';
import { cellId, itemOrigin, placementOrigin, canPlace, slotAccepts } from './panels.js';
import { buyPrice, sellPrice } from './vendor.js';
import { FIELD_LIMITS } from './overlays.js';

const LEFT = 0;
const RIGHT = 2;
const BELT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const PANEL_KEYS = { i: 'inventory', c: 'character', s: 'skills', q: 'quests' };
const PRINTABLE = /^[a-zA-Z0-9 _\-'.]$/;
const DROP_SEARCH_RADIUS = 2;

/* ------------------------------------------------------------------ */
/* Public entry points                                                 */
/* ------------------------------------------------------------------ */

/** Payload of the topmost UI element under a point, or null. */
export function uiHitTest(game, x, y) {
  ensureUi(game);
  const h = hitAt(game, x, y);
  return h ? { ...h.payload, rect: h.rect } : null;
}

/**
 * Handle a mouse click. Returns true when the UI consumed it.
 * @param {number} button 0 left, 2 right
 * @param {{shift?:boolean,ctrl?:boolean,alt?:boolean}} [mods]
 */
export function uiHandleClick(game, x, y, button = LEFT, mods = {}) {
  const ui = ensureUi(game);
  const hit = hitAt(game, x, y);
  const payload = hit ? hit.payload : null;
  if (ui.loading) return true;
  if (game.mode === 'menu') {
    if (payload) mainMenuClick(game, payload, button);
    return true;
  }
  if (game.mode === 'dead' || game.mode === 'win') {
    if (payload && payload.kind === 'menuAction' && button === LEFT) menuAction(game, payload.action);
    return true;
  }
  if (payload) {
    dispatch(game, payload, button, mods || {});
    return true;
  }
  if (ui.dialogue) {
    if (!Array.isArray(ui.dialogue.options) || ui.dialogue.options.length === 0) closePanel(game, 'dialogue');
    return true;
  }
  if (ui.cursorItem && button === LEFT) {
    dropCursorItem(game, x, y);
    return true;
  }
  return false;
}

/**
 * Handle a normalised key press (see core/input normalizeKey). Returns true
 * when the UI consumed it.
 */
export function uiHandleKey(game, key) {
  const ui = ensureUi(game);
  if (ui.loading) return true;
  if (game.mode === 'menu') return mainMenuKey(game, key);
  if (game.mode === 'dead' || game.mode === 'win') return false;
  if (key === 'Escape') {
    if (ui.dialogue) closePanel(game, 'dialogue');
    else if (ui.menuOpen) closePanel(game, 'menu');
    else if (anyPanelOpen(game)) closeAll(game);
    else openPanel(game, 'menu');
    return true;
  }
  if (ui.menuOpen) return true;
  if (key === 'space') {
    if (!anyPanelOpen(game)) return false;
    closeAll(game);
    return true;
  }
  if (PANEL_KEYS[key]) {
    togglePanel(game, PANEL_KEYS[key]);
    return true;
  }
  if (key === 'Tab') {
    togglePanel(game, 'automap');
    return true;
  }
  const hoverSkill = ui.hoverUi && ui.hoverUi.kind === 'skillRow' ? ui.hoverUi.skillId : null;
  const names = hotkeyNames(game);
  const hk = names.findIndex((n) => n.toLowerCase() === String(key).toLowerCase());
  if (hk >= 0) {
    if (hoverSkill) bindHotkey(game, hk, hoverSkill);
    else selectHotkey(game, hk);
    return true;
  }
  const belt = BELT_KEYS.indexOf(key);
  if (belt >= 0) {
    if (hoverSkill && belt < names.length) {
      bindHotkey(game, belt, hoverSkill);
      return true;
    }
    useBelt(game, belt);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

function dispatch(game, h, button, mods) {
  const ui = game.ui;
  switch (h.kind) {
    case 'hudButton':
      if (button === LEFT) togglePanel(game, h.id);
      return;
    case 'levelUp':
      if (button === LEFT) openPanel(game, 'character');
      return;
    case 'belt':
      if (button === RIGHT) useBelt(game, h.index);
      else beltClick(game, h.index);
      return;
    case 'hotkey':
      if (button === RIGHT) clearHotkey(game, h.index);
      else selectHotkey(game, h.index);
      return;
    case 'skillButton':
      if (button === LEFT) togglePanel(game, 'skills');
      return;
    case 'invCell':
      if (button === RIGHT) invRightClick(game, h.cx, h.cy);
      else if (mods.shift && ui.vendor && !ui.cursorItem) sellFromCell(game, h.cx, h.cy);
      else invLeftClick(game, h.cx, h.cy);
      return;
    case 'equipSlot':
      if (button === RIGHT) unequipToInventory(game, h.slot);
      else if (ui.cursorItem) equipCursor(game, h.slot);
      else unequipToCursor(game, h.slot);
      return;
    case 'statPlus':
      if (button === LEFT) spendStat(game, h.stat, mods.shift ? (game.player.statPoints || 1) : 1);
      return;
    case 'skillRow':
      if (button === LEFT) selectSkill(game, h.skillId);
      return;
    case 'skillPage':
      ui.skillPage = Math.max(0, (ui.skillPage | 0) + h.dir);
      play(game, 'click');
      return;
    case 'questRow':
      ui.questSel = h.index;
      play(game, 'click');
      return;
    case 'vendorTab':
      ui.vendorTab = h.tab;
      ui.vendorPage = 0;
      play(game, 'click');
      return;
    case 'vendorPage':
      ui.vendorPage = Math.max(0, (ui.vendorPage | 0) + h.dir);
      play(game, 'click');
      return;
    case 'vendorItem':
      if (button === LEFT) buyItem(game, h.item);
      return;
    case 'sellItem':
      if (button === LEFT) sellItem(game, h.item);
      return;
    case 'service':
      if (button === LEFT) runService(game, h.service);
      return;
    case 'close':
      closePanel(game, h.name);
      return;
    case 'dialogOption':
      if (button === LEFT) chooseOption(game, h.option);
      return;
    case 'menuAction':
      if (button === LEFT) {
        if (h.action.type === 'continue') closePanel(game, 'menu');
        else menuAction(game, h.action);
      }
      return;
    case 'itemLabel':
      if (button === LEFT && game.player) game.player.intent = { type: 'pickup', target: h.item.id, item: h.item };
      return;
    default:
      // 'panel', 'hud', 'globe', 'xpBar', ... : swallow
  }
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

function inv(game) {
  return game.player && game.player.inventory;
}

function removeFromInv(game, id) {
  const i = inv(game);
  if (!i) return null;
  const item = i.items[id];
  const r = call(bridge.Inventory, 'removeItem', undefined, i, id);
  if (r === undefined) {
    for (let k = 0; k < i.cells.length; k++) if (i.cells[k] === id) i.cells[k] = 0;
    delete i.items[id];
  }
  recalc(game);
  return item || (r && typeof r === 'object' ? r : null);
}

function placeInInv(game, item, cx, cy) {
  const i = inv(game);
  if (!i) return false;
  const r = call(bridge.Inventory, 'placeAt', undefined, i, item, cx, cy);
  if (r === undefined) {
    if (!canPlace(i, item, cx, cy)) return false;
    const w = (item.size && item.size.w) || 1;
    const h = (item.size && item.size.h) || 1;
    for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) i.cells[y * i.w + x] = item.id;
    i.items[item.id] = item;
    recalc(game);
    return true;
  }
  recalc(game);
  return r === true || (r && r.ok !== false);
}

function pickUpAnywhere(game, item) {
  const ok = call(bridge.Inventory, 'tryPickUp', undefined, game, item);
  if (ok !== undefined) return !!ok;
  const i = inv(game);
  if (!i) return false;
  for (let cy = 0; cy < i.h; cy++) for (let cx = 0; cx < i.w; cx++) if (canPlace(i, item, cx, cy) && !overlappedId(i, item, cx, cy)) return placeInInv(game, item, cx, cy);
  return false;
}

function overlappedId(i, item, cx, cy) {
  const w = (item.size && item.size.w) || 1;
  const h = (item.size && item.size.h) || 1;
  for (let y = cy; y < cy + h; y++) {
    for (let x = cx; x < cx + w; x++) {
      const id = cellId(i, x, y);
      if (id && id !== item.id) return id;
    }
  }
  return 0;
}

function recalc(game) {
  call(bridge.Inventory, 'recalcPlayer', undefined, game);
}

function error(game, key, fallback) {
  addMessage(game, str(game, key, fallback), palette(game).danger);
  play(game, 'error');
}

function invLeftClick(game, cx, cy) {
  const ui = game.ui;
  const i = inv(game);
  if (!i) return;
  if (ui.cursorItem) {
    const item = ui.cursorItem;
    const o = placementOrigin(item, cx, cy);
    if (!canPlace(i, item, o.cx, o.cy)) {
      error(game, 'noRoom', 'No room there');
      return;
    }
    const swapId = overlappedId(i, item, o.cx, o.cy);
    let swapped = null;
    let swapOrigin = null;
    if (swapId) {
      swapOrigin = itemOrigin(i, swapId);
      swapped = removeFromInv(game, swapId);
    }
    if (!placeInInv(game, item, o.cx, o.cy)) {
      if (swapped && swapOrigin) placeInInv(game, swapped, swapOrigin.cx, swapOrigin.cy);
      error(game, 'noRoom', 'No room there');
      return;
    }
    ui.cursorItem = swapped;
    play(game, 'drop');
    return;
  }
  const id = cellId(i, cx, cy);
  if (!id) return;
  const item = removeFromInv(game, id);
  if (item) {
    ui.cursorItem = item;
    play(game, 'pickup');
  }
}

function invRightClick(game, cx, cy) {
  const i = inv(game);
  if (!i || game.ui.cursorItem) return;
  const id = cellId(i, cx, cy);
  const item = id && i.items[id];
  if (!item) return;
  if (isConsumable(item)) {
    useItem(game, item);
    return;
  }
  if (!item.slot || item.slot === 'gold' || item.slot === 'quest') return;
  const slot = targetSlot(game, item);
  if (!slot) return;
  if (!slotAccepts(game, game.player, item, slot)) {
    error(game, 'cannotEquip', 'You cannot equip that');
    return;
  }
  const origin = itemOrigin(i, id);
  removeFromInv(game, id);
  const r = equipItem(game, item, slot);
  if (!r.ok) {
    if (origin) placeInInv(game, item, origin.cx, origin.cy);
    error(game, 'cannotEquip', r.reason || 'You cannot equip that');
    return;
  }
  if (r.swapped && !pickUpAnywhere(game, r.swapped)) game.ui.cursorItem = r.swapped;
  play(game, 'click');
}

function isConsumable(item) {
  return item.slot === 'consumable' || item.slot === 'scroll' || item.slot === 'tome';
}

function targetSlot(game, item) {
  const eq = game.player.equipment || {};
  if (item.slot === 'ring') return !eq.ring1 ? 'ring1' : !eq.ring2 ? 'ring2' : 'ring1';
  return item.slot;
}

function equipItem(game, item, slot) {
  const r = call(bridge.Inventory, 'equip', undefined, game, item, slot);
  if (r === undefined) {
    const p = game.player;
    if (!p.equipment) p.equipment = {};
    const prev = p.equipment[slot] || null;
    p.equipment[slot] = item;
    recalc(game);
    return { ok: true, swapped: prev };
  }
  if (r === true) return { ok: true, swapped: null };
  if (!r) return { ok: false };
  return { ok: r.ok !== false, swapped: r.swapped || null, reason: r.reason };
}

function equipCursor(game, slot) {
  const ui = game.ui;
  const item = ui.cursorItem;
  if (!slotAccepts(game, game.player, item, slot)) {
    error(game, 'cannotEquip', 'You cannot equip that');
    return;
  }
  const r = equipItem(game, item, slot);
  if (!r.ok) {
    error(game, 'cannotEquip', r.reason || 'You cannot equip that');
    return;
  }
  ui.cursorItem = r.swapped || null;
  play(game, 'drop');
}

function takeEquipped(game, slot) {
  const p = game.player;
  const item = p.equipment && p.equipment[slot];
  if (!item) return null;
  const r = call(bridge.Inventory, 'unequip', undefined, game, slot);
  if (r === undefined) {
    p.equipment[slot] = null;
    recalc(game);
  } else if (r && r.ok === false) return null;
  return item;
}

function unequipToCursor(game, slot) {
  const item = takeEquipped(game, slot);
  if (!item) return;
  game.ui.cursorItem = item;
  play(game, 'pickup');
}

function unequipToInventory(game, slot) {
  const p = game.player;
  const item = p.equipment && p.equipment[slot];
  if (!item || game.ui.cursorItem) return;
  const taken = takeEquipped(game, slot);
  if (!taken) return;
  if (!pickUpAnywhere(game, taken)) {
    equipItem(game, taken, slot);
    error(game, 'noRoom', 'No room in inventory');
    return;
  }
  play(game, 'click');
}

function useItem(game, item) {
  let r = call(bridge.Inventory, 'useItem', undefined, game, item);
  if (r === undefined) r = call(bridge.PlayerMod, 'useItem', undefined, game, item);
  if (r === undefined) {
    error(game, 'cannotUse', 'Nothing happens');
    return;
  }
  if (r === false || (r && r.ok === false)) error(game, 'cannotUse', (r && r.reason) || 'Cannot use that now');
  else play(game, 'potion');
}

/** Drop the held item on the ground near the player (world click while holding). */
export function dropCursorItem(game) {
  const ui = game.ui;
  const item = ui.cursorItem;
  const p = game.player;
  const level = game.level;
  if (!item || !p || !level) return;
  const r = call(bridge.Inventory, 'dropItem', undefined, game, item);
  if (r === undefined) {
    const spot = freeDropTile(game, p.tx, p.ty) || { x: p.tx, y: p.ty };
    item.tx = spot.x;
    item.ty = spot.y;
    item.dropTick = game.tick;
    level.items.push(item);
    if (game.bus) game.bus.emit('itemDropped', { item });
  } else if (r === false || (r && r.ok === false)) {
    error(game, 'cannotDrop', 'Cannot drop that here');
    return;
  }
  ui.cursorItem = null;
  play(game, 'drop');
}

function freeDropTile(game, x, y) {
  const level = game.level;
  const taken = new Set(level.items.map((it) => `${it.tx},${it.ty}`));
  for (let r = 0; r <= DROP_SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= level.tiles.w || ty >= level.tiles.h) continue;
        const i = ty * level.tiles.w + tx;
        if (level.tiles.floor[i] === 0 || (level.tiles.flags[i] & 1)) continue;
        if (taken.has(`${tx},${ty}`)) continue;
        return { x: tx, y: ty };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Belt / hotkeys / skills / stats                                     */
/* ------------------------------------------------------------------ */

function beltOf(game) {
  const p = game.player;
  if (!p) return null;
  if (!Array.isArray(p.belt)) p.belt = new Array(8).fill(null);
  return p.belt;
}

function beltClick(game, index) {
  const ui = game.ui;
  const belt = beltOf(game);
  if (!belt) return;
  if (ui.cursorItem) {
    if (!beltAccepts(ui.cursorItem)) {
      error(game, 'notBeltItem', 'That does not fit in the belt');
      return;
    }
    const prev = belt[index] || null;
    belt[index] = ui.cursorItem;
    ui.cursorItem = prev;
    play(game, 'drop');
    return;
  }
  if (belt[index]) {
    ui.cursorItem = belt[index];
    belt[index] = null;
    play(game, 'pickup');
  }
}

function useBelt(game, index) {
  const belt = beltOf(game);
  if (!belt || !belt[index]) return;
  const r = call(bridge.PlayerMod, 'useBeltSlot', undefined, game, index);
  if (r !== undefined) {
    if (r === false || (r && r.ok === false)) error(game, 'cannotUse', (r && r.reason) || 'Cannot use that now');
    return;
  }
  const item = belt[index];
  let u = call(bridge.Inventory, 'useItem', undefined, game, item);
  if (u === undefined) u = call(bridge.PlayerMod, 'useItem', undefined, game, item);
  if (u === undefined || u === false || (u && u.ok === false)) {
    error(game, 'cannotUse', 'Cannot use that now');
    return;
  }
  if (item.count > 1) item.count--;
  else belt[index] = null;
  play(game, 'potion');
}

function bindHotkey(game, index, skillId) {
  const p = game.player;
  if (!p) return;
  if (!Array.isArray(p.hotkeys)) p.hotkeys = new Array(4).fill(null);
  for (let i = 0; i < p.hotkeys.length; i++) if (p.hotkeys[i] === skillId && i !== index) p.hotkeys[i] = null;
  p.hotkeys[index] = p.hotkeys[index] === skillId ? null : skillId;
  play(game, 'click');
}

function clearHotkey(game, index) {
  const p = game.player;
  if (p && Array.isArray(p.hotkeys)) p.hotkeys[index] = null;
}

function selectHotkey(game, index) {
  const p = game.player;
  const id = p && Array.isArray(p.hotkeys) ? p.hotkeys[index] : null;
  if (id) selectSkill(game, id);
}

function selectSkill(game, skillId) {
  const p = game.player;
  if (!p) return;
  p.selectedSkill = skillId;
  game.ui.selectedSkill = skillId;
  play(game, 'click');
}

function spendStat(game, stat, n) {
  const p = game.player;
  if (!p || !(p.statPoints > 0)) return;
  const r = call(bridge.PlayerMod, 'spendStat', undefined, game, stat, n);
  if (r === undefined) {
    const count = Math.min(n, p.statPoints);
    p.base[stat] = (p.base[stat] || 0) + count;
    p.statPoints -= count;
    recalc(game);
  } else if (r === false || (r && r.ok === false)) {
    error(game, 'statCapped', 'That stat is at its maximum');
    return;
  }
  play(game, 'click');
}

/* ------------------------------------------------------------------ */
/* Vendor / dialogue                                                   */
/* ------------------------------------------------------------------ */

function vendorNpc(game) {
  return findNpc(game, game.ui.vendor);
}

function setVendorMsg(game, text, color) {
  game.ui.vendorMsg = { text, color: color || palette(game).text, ttl: 120 };
}

function buyItem(game, item) {
  const npc = vendorNpc(game);
  const p = game.player;
  if (!npc || !p || !item) return;
  const pal = palette(game);
  const price = buyPrice(item);
  const r = call(bridge.Npcs, 'vendorBuy', undefined, game, npc, item);
  if (r === undefined) {
    if ((p.gold || 0) < price) {
      setVendorMsg(game, str(game, 'notEnoughGold', 'Not enough gold'), pal.danger);
      play(game, 'error');
      return;
    }
    if (!pickUpAnywhere(game, item)) {
      setVendorMsg(game, str(game, 'noRoom', 'No room in inventory'), pal.danger);
      play(game, 'error');
      return;
    }
    p.gold -= price;
    const idx = npc.stock.indexOf(item);
    if (idx >= 0) npc.stock.splice(idx, 1);
  } else if (r === false || (r && r.ok === false)) {
    const reason = r && r.reason;
    const text = reason === 'gold' ? str(game, 'notEnoughGold', 'Not enough gold') : reason === 'space' ? str(game, 'noRoom', 'No room in inventory') : str(game, 'cannotBuy', reason || 'Cannot buy that');
    setVendorMsg(game, text, pal.danger);
    play(game, 'error');
    return;
  }
  setVendorMsg(game, `${str(game, 'bought', 'Bought')} ${item.name} (${price})`, pal.gold);
  play(game, 'gold');
}

function sellFromCell(game, cx, cy) {
  const i = inv(game);
  const id = i && cellId(i, cx, cy);
  if (!id) return;
  sellItem(game, i.items[id]);
}

function sellItem(game, item) {
  const p = game.player;
  const i = inv(game);
  if (!p || !i || !item) return;
  const pal = palette(game);
  if (item.slot === 'quest') {
    setVendorMsg(game, str(game, 'cannotSell', 'Cannot sell that'), pal.danger);
    return;
  }
  const origin = itemOrigin(i, item.id);
  const price = sellPrice(item);
  removeFromInv(game, item.id);
  const r = call(bridge.Npcs, 'vendorSell', undefined, game, item);
  if (r === undefined) {
    p.gold = (p.gold || 0) + price;
  } else if (r === false || (r && r.ok === false)) {
    if (origin) placeInInv(game, item, origin.cx, origin.cy);
    setVendorMsg(game, str(game, 'cannotSell', (r && r.reason) || 'Cannot sell that'), pal.danger);
    play(game, 'error');
    return;
  }
  const got = r && typeof r.gold === 'number' ? r.gold : price;
  setVendorMsg(game, `${str(game, 'sold', 'Sold')} ${item.name} ${str(game, 'for', 'for')} ${got} ${str(game, 'gold', 'Gold')}`, pal.gold);
  play(game, 'gold');
}

function runService(game, s) {
  const npc = vendorNpc(game);
  const pal = palette(game);
  if (!npc || !s) return;
  if (!s.run) {
    setVendorMsg(game, str(game, 'notAvailable', 'Not available'), pal.danger);
    return;
  }
  const r = s.run(game, npc, game.ui.cursorItem);
  if (r === false || (r && r.ok === false)) {
    setVendorMsg(game, (r && r.reason) || str(game, 'notAvailable', 'Not available'), pal.danger);
    play(game, 'error');
    return;
  }
  setVendorMsg(game, (r && r.text) || `${s.label}: ${str(game, 'done', 'done')}`, pal.good);
  play(game, 'click');
}

function chooseOption(game, option) {
  const ui = game.ui;
  const before = ui.dialogue;
  play(game, 'click');
  if (option && typeof option.action === 'function') option.action(game);
  else if (option && option.type === 'trade') openVendor(game, findNpc(game, before && (before.npc || before.npcId)));
  if (ui.dialogue === before && !(option && option.keepOpen)) ui.dialogue = null;
  if (!ui.dialogue && ui.open === 'dialogue') closePanel(game, 'dialogue');
}

/* ------------------------------------------------------------------ */
/* Main menu                                                           */
/* ------------------------------------------------------------------ */

function mainMenuClick(game, h, button) {
  const m = game.ui.menu;
  if (button !== LEFT) return;
  switch (h.kind) {
    case 'menuClass':
      m.classIndex = h.index;
      play(game, 'click');
      return;
    case 'menuField':
      m.focus = h.field;
      return;
    case 'menuStart':
      startGame(game);
      return;
    case 'menuAction':
      menuAction(game, h.action);
      return;
    default:
  }
}

function startGame(game) {
  const m = game.ui.menu;
  const cls = classList(game)[m.classIndex];
  if (!cls) return;
  const seedText = (m.seed || '').trim();
  const seedNum = Number(seedText);
  const seed = seedText === '' ? null : Number.isFinite(seedNum) ? seedNum >>> 0 : seedText;
  const name = (m.name || '').trim() || str(game, 'namePlaceholder', 'Hero');
  play(game, 'click');
  menuAction(game, { type: 'newGame', classId: cls.id, name, seed });
}

function mainMenuKey(game, key) {
  const m = game.ui.menu;
  const classes = classList(game);
  if (key === 'Enter') {
    startGame(game);
    return true;
  }
  if (key === 'Tab') {
    m.focus = m.focus === 'name' ? 'seed' : 'name';
    return true;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const n = Math.max(1, classes.length);
    m.classIndex = (m.classIndex + (key === 'ArrowLeft' ? n - 1 : 1)) % n;
    return true;
  }
  if (key === 'Backspace') {
    m[m.focus] = (m[m.focus] || '').slice(0, -1);
    return true;
  }
  if (key === 'space') key = ' ';
  if (key.length === 1 && PRINTABLE.test(key)) {
    const limit = FIELD_LIMITS[m.focus] || 16;
    if (m.focus === 'seed' && !/^[0-9a-zA-Z\-]$/.test(key)) return true;
    if ((m[m.focus] || '').length < limit) m[m.focus] = (m[m.focus] || '') + key;
    return true;
  }
  return true;
}


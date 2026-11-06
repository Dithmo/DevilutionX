/**
 * Side panels (320x400 over the left / right half of the world view), the
 * full-screen automap overlay and the pause menu.
 *
 *   right half: inventory (equipment slots + 10x4 grid)
 *   left half:  character sheet | skills | quest log
 */
import { worldPos, TILE_W, TILE_H } from '../camera.js';
import { drawItemGlyph } from '../sprites.js';
import { dirToScreen, mix, lighten } from '../draw_util.js';
import { T, idx, inBounds } from '../../world/tiles.js';
import { uiLayout } from './layout.js';
import {
  palette, str, drawPanel, drawButton, drawText, drawSlot, drawItemInRect, drawSkillIcon, drawSeparator,
  registerHit, pointInRect, rarityColor, wrapText, fontAt, fillRect,
} from './widgets.js';
import { ensureUi, bridge, call, hotkeyNames, skillDef, classDef } from './state.js';
import { xpBounds, manaCostOf, canCast, formatNumber } from './hud.js';

const EQUIP_ORDER = ['head', 'amulet', 'weapon', 'body', 'offhand', 'ring1', 'ring2'];
const EQUIP_LABEL_KEYS = { head: 'slotHead', amulet: 'slotAmulet', weapon: 'slotWeapon', body: 'slotBody', offhand: 'slotOffhand', ring1: 'slotRing', ring2: 'slotRing' };
const EQUIP_LABEL_FALLBACK = { head: 'Head', amulet: 'Amulet', weapon: 'Weapon', body: 'Body', offhand: 'Off hand', ring1: 'Ring', ring2: 'Ring' };
const EQUIP_GLYPH = { head: 'helm', amulet: 'amulet', weapon: 'blade', body: 'chest', offhand: 'shield', ring1: 'ring', ring2: 'ring' };
const EMPTY_SLOT_ALPHA = 0.28;
const SLOT_LABEL_MIN_W = 50;
const STATS = [
  { key: 'str', strKey: 'strength', fallback: 'Strength' },
  { key: 'mag', strKey: 'magic', fallback: 'Magic' },
  { key: 'dex', strKey: 'dexterity', fallback: 'Dexterity' },
  { key: 'vit', strKey: 'vitality', fallback: 'Vitality' },
];
const RESISTS = [
  { key: 'fire', strKey: 'resFire', fallback: 'Fire', effect: 'resFire' },
  { key: 'cold', strKey: 'resCold', fallback: 'Cold', effect: 'resCold' },
  { key: 'shock', strKey: 'resShock', fallback: 'Shock', effect: 'resShock' },
  { key: 'arcane', strKey: 'resArcane', fallback: 'Arcane', effect: 'resArcane' },
];
const RESIST_MAX = 75;
const CHAR_SIZE = 12;
const CHAR_TITLE_Y = 8;
const CHAR_FIELDS_Y = 30;
const GROUP_GAP = 6;
const SKILL_NAME_SIZE = 13;
const SKILL_SUB_SIZE = 11;
const PAGE_BTN_W = 26;
const PAGE_BTN_H = 18;
const QUEST_SIZE = 13;
const QUEST_DETAIL_SIZE = 12;
const QUEST_LINE_H = 15;
const AUTOMAP_FLOOR_ALPHA = 0.6;
const AUTOMAP_WALL_W = 1.5;
const AUTOMAP_PLAYER_R = 5;
const AUTOMAP_STAIR_R = 3;
const MENU_BUTTON_H = 30;
const MENU_BUTTON_GAP = 8;
const MENU_TITLE_SIZE = 18;
const CURSOR_ITEM_ALPHA = 0.9;
const CELL_PAD = 1;

/* ------------------------------------------------------------------ */
/* Inventory helpers (grid is Int32Array of item ids, row-major)        */
/* ------------------------------------------------------------------ */

/** Item id at a grid cell (0 when empty / out of range). */
export function cellId(inv, cx, cy) {
  if (!inv || cx < 0 || cy < 0 || cx >= inv.w || cy >= inv.h) return 0;
  return inv.cells[cy * inv.w + cx] | 0;
}

/** Top-left cell of an item in the grid, or null. */
export function itemOrigin(inv, id) {
  if (!inv || !id) return null;
  for (let i = 0; i < inv.cells.length; i++) {
    if (inv.cells[i] === id) return { cx: i % inv.w, cy: Math.floor(i / inv.w) };
  }
  return null;
}

/** Top-left grid cell for placing `item` so the cursor sits on its centre. */
export function placementOrigin(item, cx, cy) {
  const w = (item.size && item.size.w) || 1;
  const h = (item.size && item.size.h) || 1;
  return { cx: cx - Math.floor((w - 1) / 2), cy: cy - Math.floor((h - 1) / 2) };
}

function gridRect(panel, cx, cy, w = 1, h = 1) {
  const g = uiLayout.inventory.grid;
  const c = uiLayout.cell;
  return { x: panel.x + g.x + cx * c, y: panel.y + g.y + cy * c, w: c * w, h: c * h };
}

/** Rect of the inventory panel (right half). */
export function inventoryRect() {
  return uiLayout.rightPanel;
}

/** Draw the inventory panel: equipment slots, grid, gold. */
export function drawInventory(ctx, game) {
  const ui = ensureUi(game);
  const pal = palette(game);
  const p = game.player;
  const panel = uiLayout.rightPanel;
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  drawPanel(ctx, panel, { game, title: str(game, 'inventory', 'Inventory') });
  registerHit(game, panel, { kind: 'panel', name: 'inventory' });
  if (!p) return;

  // equipment
  const eq = p.equipment || {};
  for (const slot of EQUIP_ORDER) {
    const lr = uiLayout.inventory.equip[slot];
    const r = { x: panel.x + lr.x, y: panel.y + lr.y, w: lr.w, h: lr.h };
    const item = eq[slot] || null;
    const hover = pointInRect(mx, my, r);
    let valid = null;
    if (hover && ui.cursorItem) valid = slotAccepts(game, p, ui.cursorItem, slot);
    drawSlot(ctx, r, { game, item, hover, valid });
    if (item) drawItemInRect(ctx, item, r);
    else drawEmptySlot(ctx, game, r, slot);
    registerHit(game, r, { kind: 'equipSlot', slot, item });
  }

  // grid
  const inv = p.inventory;
  if (inv) {
    const g = uiLayout.inventory.grid;
    const hoverCell = cellAtScreen(panel, inv, mx, my);
    const hoverId = hoverCell ? cellId(inv, hoverCell.cx, hoverCell.cy) : 0;
    let preview = null;
    if (hoverCell && ui.cursorItem) {
      const o = placementOrigin(ui.cursorItem, hoverCell.cx, hoverCell.cy);
      const w = (ui.cursorItem.size && ui.cursorItem.size.w) || 1;
      const h = (ui.cursorItem.size && ui.cursorItem.size.h) || 1;
      preview = { ...o, w, h, valid: canPlace(inv, ui.cursorItem, o.cx, o.cy) };
    }
    const origins = new Map();
    for (let i = 0; i < inv.cells.length; i++) {
      const id = inv.cells[i];
      if (id && !origins.has(id)) origins.set(id, { cx: i % inv.w, cy: Math.floor(i / inv.w) });
    }
    for (let cy = 0; cy < g.rows; cy++) {
      for (let cx = 0; cx < g.cols; cx++) {
        const r = gridRect(panel, cx, cy);
        const id = cellId(inv, cx, cy);
        let valid = null;
        if (preview && cx >= preview.cx && cx < preview.cx + preview.w && cy >= preview.cy && cy < preview.cy + preview.h) valid = preview.valid;
        drawSlot(ctx, r, { game, item: null, hover: !!hoverId && id === hoverId && !preview, valid });
        const item = id ? inv.items[id] || null : null;
        const o = item ? origins.get(id) : null;
        const itemRect = item && o ? gridRect(panel, o.cx, o.cy, (item.size && item.size.w) || 1, (item.size && item.size.h) || 1) : null;
        registerHit(game, r, { kind: 'invCell', cx, cy, item, itemRect });
      }
    }
    const drawn = new Set();
    for (let i = 0; i < inv.cells.length; i++) {
      const id = inv.cells[i];
      if (!id || drawn.has(id)) continue;
      drawn.add(id);
      const item = inv.items && inv.items[id];
      if (!item) continue;
      const cx = i % inv.w;
      const cy = Math.floor(i / inv.w);
      const w = (item.size && item.size.w) || 1;
      const h = (item.size && item.size.h) || 1;
      const r = gridRect(panel, cx, cy, w, h);
      const tintRect = { x: r.x + CELL_PAD, y: r.y + CELL_PAD, w: r.w - CELL_PAD * 2, h: r.h - CELL_PAD * 2 };
      fillRect(ctx, tintRect, rarityColor(game, item), id === hoverId ? 0.3 : 0.16);
      ctx.strokeStyle = id === hoverId ? pal.accent : mix(rarityColor(game, item), '#000', 0.4);
      ctx.lineWidth = 1;
      ctx.strokeRect(tintRect.x + 0.5, tintRect.y + 0.5, tintRect.w - 1, tintRect.h - 1);
      drawItemInRect(ctx, item, r);
      if (item.count > 1) drawText(ctx, String(item.count), r.x + r.w - 3, r.y + r.h - 13, { align: 'right', size: 10, game });
    }
  }

  const gy = panel.y + uiLayout.inventory.goldY;
  drawText(ctx, `${str(game, 'gold', 'Gold')}: ${formatNumber(p.gold || 0)}`, panel.x + 16, gy, { color: pal.gold, size: 13, game });
  if (ui.vendor) drawText(ctx, str(game, 'sellHint', 'Shift-click an item to sell'), panel.x + panel.w - 16, gy + 1, { align: 'right', color: pal.textDim, size: 11, game, maxW: 180 });
}

function drawEmptySlot(ctx, game, r, slot) {
  const pal = palette(game);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * EMPTY_SLOT_ALPHA;
  const size = Math.max(14, Math.min(r.w, r.h) - 10);
  drawItemGlyph(ctx, r.x + r.w / 2, r.y + r.h / 2 - (r.w >= SLOT_LABEL_MIN_W ? 6 : 0), { glyph: EQUIP_GLYPH[slot], color: pal.text, color2: pal.textDim }, size);
  ctx.globalAlpha = prev;
  if (r.w >= SLOT_LABEL_MIN_W) {
    drawText(ctx, str(game, EQUIP_LABEL_KEYS[slot], EQUIP_LABEL_FALLBACK[slot]), r.x + r.w / 2, r.y + r.h - 15, { align: 'center', size: 10, color: pal.textDim, game, maxW: r.w - 4 });
  }
}

/** Grid cell under a screen point (or null). */
export function cellAtScreen(panel, inv, sx, sy) {
  const g = uiLayout.inventory.grid;
  const c = uiLayout.cell;
  const cx = Math.floor((sx - panel.x - g.x) / c);
  const cy = Math.floor((sy - panel.y - g.y) / c);
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return null;
  return { cx, cy };
}

/** Can `item` be placed with its top-left at (cx, cy)? (inventory.js canPlace, else local check) */
export function canPlace(inv, item, cx, cy) {
  const r = call(bridge.Inventory, 'canPlace', undefined, inv, item, cx, cy);
  if (typeof r === 'boolean') return r;
  const w = (item.size && item.size.w) || 1;
  const h = (item.size && item.size.h) || 1;
  if (cx < 0 || cy < 0 || cx + w > inv.w || cy + h > inv.h) return false;
  let other = 0;
  for (let y = cy; y < cy + h; y++) {
    for (let x = cx; x < cx + w; x++) {
      const id = inv.cells[y * inv.w + x];
      if (id && id !== item.id) {
        if (other && other !== id) return false;
        other = id;
      }
    }
  }
  return true;
}

/** Does the item fit an equipment slot (by slot type; inventory.js canEquip for requirements)? */
export function slotAccepts(game, p, item, slot) {
  if (!item) return false;
  const base = slot === 'ring1' || slot === 'ring2' ? 'ring' : slot;
  if (item.slot !== base) return false;
  const ok = call(bridge.Inventory, 'canEquip', undefined, p, item);
  if (typeof ok === 'boolean') return ok;
  if (ok && typeof ok.ok === 'boolean') return ok.ok;
  return true;
}

/** The cursor item follows the mouse, drawn last. */
export function drawCursorItem(ctx, game) {
  const ui = ensureUi(game);
  const item = ui.cursorItem;
  const mouse = game.input && game.input.mouse;
  if (!item || !mouse) return;
  const w = ((item.size && item.size.w) || 1) * uiLayout.cell;
  const h = ((item.size && item.size.h) || 1) * uiLayout.cell;
  const r = { x: mouse.x - w / 2, y: mouse.y - h / 2, w, h };
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * CURSOR_ITEM_ALPHA;
  fillRect(ctx, r, rarityColor(game, item), 0.25);
  ctx.strokeStyle = rarityColor(game, item);
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  drawItemInRect(ctx, item, r);
  if (item.count > 1) drawText(ctx, String(item.count), r.x + r.w - 3, r.y + r.h - 13, { align: 'right', size: 10, game });
  ctx.globalAlpha = prev;
}

/* ------------------------------------------------------------------ */
/* Character sheet                                                     */
/* ------------------------------------------------------------------ */

/** Sum of an `effects` stat across equipped items (+ item.ac / item.dmg presence). */
export function equippedEffect(p, stat) {
  let sum = 0;
  const eq = p.equipment || {};
  for (const k of Object.keys(eq)) {
    const it = eq[k];
    if (it && it.effects && typeof it.effects[stat] === 'number') sum += it.effects[stat];
  }
  return sum;
}

function hasEquipped(p, pred) {
  const eq = p.equipment || {};
  return Object.keys(eq).some((k) => eq[k] && pred(eq[k]));
}

/** Colour for a value: accent when boosted by items, danger when debuffed. */
function boostColor(game, bonus, neutral) {
  const pal = palette(game);
  if (bonus > 0) return pal.accent;
  if (bonus < 0) return pal.danger;
  return neutral || pal.text;
}

/** Draw the character sheet (left half). */
export function drawCharacter(ctx, game) {
  const pal = palette(game);
  const p = game.player;
  const panel = uiLayout.leftPanel;
  const C = uiLayout.character;
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  drawPanel(ctx, panel, { game, title: str(game, 'character', 'Character') });
  registerHit(game, panel, { kind: 'panel', name: 'character' });
  if (!p) return;
  const cls = classDef(game, p.classId);
  // p.derived holds ITEM contributions only (see items/recalc.js); the sheet shows the fully
  // summed numbers (class base + level + stats + items) from playerStatsSummary.
  const sum = call(bridge.PlayerMod, 'playerStatsSummary', null, game);
  const d = { ...(p.derived || {}), ...((p.derived && p.derived.display) || {}) };
  if (sum) for (const k of ['ac', 'toHit', 'dmgMin', 'dmgMax', 'blockChance']) if (typeof sum[k] === 'number') d[k] = sum[k];
  const { prev, next } = xpBounds(game, p);
  const lx = panel.x + C.labelX;
  const vx = panel.x + C.nowX + 36;
  const rowH = C.rowH;
  let y = panel.y + CHAR_FIELDS_Y;
  const row = (label, value, color, opts = {}) => {
    drawText(ctx, label, lx, y, { size: CHAR_SIZE, color: pal.textDim, game });
    drawText(ctx, value, vx, y, { size: CHAR_SIZE, color: color || pal.text, align: 'right', game, maxW: 150 });
    y += rowH;
  };
  row(str(game, 'name', 'Name'), p.name || '-');
  row(str(game, 'class', 'Class'), cls ? cls.name : p.classId || '-');
  row(str(game, 'level', 'Level'), String(p.level || 1));
  row(str(game, 'experience', 'Experience'), formatNumber(p.xp || 0));
  row(str(game, 'nextLevel', 'Next level'), next === null ? str(game, 'none', 'None') : formatNumber(next), next === null ? pal.gold : pal.text);
  y += GROUP_GAP;
  drawSeparator(ctx, panel.x + 10, panel.x + panel.w - 10, y - 3, game);
  drawText(ctx, str(game, 'base', 'Base'), panel.x + C.baseX, y, { size: 11, color: pal.textDim, align: 'right', game });
  drawText(ctx, str(game, 'now', 'Now'), vx, y, { size: 11, color: pal.textDim, align: 'right', game });
  y += rowH;
  const canSpend = (p.statPoints || 0) > 0;
  const max = (cls && cls.max) || {};
  for (const s of STATS) {
    const base = (p.base && p.base[s.key]) || 0;
    const bonus = (p.bonus && p.bonus[s.key]) || 0;
    const capped = max[s.key] && base >= max[s.key];
    drawText(ctx, str(game, s.strKey, s.fallback), lx, y, { size: CHAR_SIZE, color: pal.textDim, game });
    drawText(ctx, String(base), panel.x + C.baseX, y, { size: CHAR_SIZE, color: capped ? pal.gold : pal.text, align: 'right', game });
    drawText(ctx, String(base + bonus), vx, y, { size: CHAR_SIZE, color: boostColor(game, bonus), align: 'right', game });
    if (canSpend && !capped) {
      const r = { x: panel.x + C.plusX, y: y + 1, w: C.plusW, h: C.plusH };
      drawButton(ctx, r, '+', { game, hover: pointInRect(mx, my, r), size: 12, color: pal.gold });
      registerHit(game, r, { kind: 'statPlus', stat: s.key });
    }
    y += rowH;
  }
  row(str(game, 'statPoints', 'Points to spend'), String(p.statPoints || 0), canSpend ? pal.danger : pal.textDim);
  y += GROUP_GAP;
  drawSeparator(ctx, panel.x + 10, panel.x + panel.w - 10, y - 3, game);
  row(str(game, 'gold', 'Gold'), formatNumber(p.gold || 0), pal.gold);
  y += GROUP_GAP;
  drawSeparator(ctx, panel.x + 10, panel.x + panel.w - 10, y - 3, game);
  const lifeBonus = d.lifeFromItems != null ? d.lifeFromItems : equippedEffect(p, 'life');
  const manaBonus = d.manaFromItems != null ? d.manaFromItems : equippedEffect(p, 'mana');
  row(str(game, 'life', 'Life'), `${Math.ceil(p.hp || 0)} / ${p.hpMax || 0}`, (p.hp || 0) < (p.hpMax || 0) ? pal.danger : boostColor(game, lifeBonus));
  row(str(game, 'mana', 'Mana'), `${Math.ceil(p.mp || 0)} / ${p.mpMax || 0}`, (p.mp || 0) < (p.mpMax || 0) ? pal.danger : boostColor(game, manaBonus));
  const acBonus = equippedEffect(p, 'ac') + equippedEffect(p, 'acPct') + (hasEquipped(p, (it) => it.ac > 0) ? 1 : 0);
  row(str(game, 'armorClass', 'Armor class'), String(d.ac != null ? d.ac : 0), boostColor(game, acBonus));
  row(str(game, 'toHit', 'Chance to hit'), `${d.toHit != null ? d.toHit : 0}%`, boostColor(game, equippedEffect(p, 'toHit')));
  const dmgBonus = equippedEffect(p, 'dmgPct') + equippedEffect(p, 'dmgFlat');
  row(str(game, 'damage', 'Damage'), `${d.dmgMin != null ? d.dmgMin : 0} - ${d.dmgMax != null ? d.dmgMax : 0}`, boostColor(game, dmgBonus));
  row(str(game, 'block', 'Chance to block'), `${d.blockChance != null ? d.blockChance : 0}%`, boostColor(game, equippedEffect(p, 'blockPct')));
  y += GROUP_GAP;
  drawSeparator(ctx, panel.x + 10, panel.x + panel.w - 10, y - 3, game);
  const halfW = (panel.w - 28) / 2;
  RESISTS.forEach((rs, i) => {
    const col = i % 2;
    const ry = y + Math.floor(i / 2) * rowH;
    const x0 = panel.x + 14 + col * halfW;
    const v = (p.resist && p.resist[rs.key]) || 0;
    const bonus = equippedEffect(p, rs.effect) + equippedEffect(p, 'resAll');
    let color = v > 0 ? boostColor(game, bonus || 1) : pal.text;
    if (bonus < 0) color = pal.danger;
    let text = `${v}%`;
    if (v >= RESIST_MAX) {
      color = pal.gold;
      text = `${RESIST_MAX}% ${str(game, 'max', 'MAX')}`;
    }
    drawText(ctx, str(game, rs.strKey, rs.fallback), x0, ry, { size: CHAR_SIZE, color: pal.textDim, game });
    drawText(ctx, text, x0 + halfW - 8, ry, { size: CHAR_SIZE, color, align: 'right', game });
  });
}

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

/** Known skills as [{id, level, def}] in theme order (skills.js skillsForClass may add unlearned ones). */
export function knownSkills(game, p) {
  if (!p) return [];
  const out = [];
  const known = p.skills || {};
  const theme = game.theme && game.theme.skills;
  const ordered = Array.isArray(theme) ? theme.map((s) => s.id) : Object.keys(known);
  const seen = new Set();
  for (const id of ordered) {
    if (!(id in known) || !(known[id] > 0)) continue;
    seen.add(id);
    out.push({ id, level: known[id], def: skillDef(game, id) });
  }
  for (const id of Object.keys(known)) {
    if (!seen.has(id) && known[id] > 0) out.push({ id, level: known[id], def: skillDef(game, id) });
  }
  return out;
}

/** Draw the skills panel (left half): pages of 7, click to ready. */
export function drawSkills(ctx, game) {
  const ui = ensureUi(game);
  const pal = palette(game);
  const p = game.player;
  const panel = uiLayout.leftPanel;
  const S = uiLayout.skills;
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  drawPanel(ctx, panel, { game, title: str(game, 'skills', 'Skills') });
  registerHit(game, panel, { kind: 'panel', name: 'skills' });
  if (!p) return;
  const list = knownSkills(game, p);
  const pages = Math.max(1, Math.ceil(list.length / S.perPage));
  ui.skillPage = Math.max(0, Math.min(pages - 1, ui.skillPage | 0));
  const start = ui.skillPage * S.perPage;
  const names = hotkeyNames(game);
  const selected = p.selectedSkill || ui.selectedSkill;
  for (let i = 0; i < S.perPage; i++) {
    const entry = list[start + i];
    if (!entry) break;
    const r = { x: panel.x + 8, y: panel.y + S.rowY + i * S.rowH, w: panel.w - 16, h: S.rowH - 4 };
    const hover = pointInRect(mx, my, r);
    const isSel = entry.id === selected;
    if (hover || isSel) fillRect(ctx, r, isSel ? pal.accent : pal.panelBorder, isSel ? 0.18 : 0.14);
    if (isSel) {
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    const look = (entry.def && entry.def.look) || {};
    const usable = canCast(game, p, entry.id);
    drawSkillIcon(ctx, { x: r.x + 4, y: r.y + (r.h - S.iconSize) / 2, w: S.iconSize, h: S.iconSize }, look, { game, disabled: !usable });
    const tx = r.x + S.iconSize + 14;
    const name = entry.def ? entry.def.name : entry.id;
    drawText(ctx, name, tx, r.y + 5, { size: SKILL_NAME_SIZE, color: usable ? pal.text : pal.textDim, game, maxW: 150 });
    drawText(ctx, `${str(game, 'level', 'Level')} ${entry.level}`, r.x + r.w - 8, r.y + 5, { size: SKILL_SUB_SIZE, color: pal.textDim, align: 'right', game });
    const cost = manaCostOf(game, p, entry.id);
    const dmg = skillDamageText(game, p, entry);
    const sub = `${str(game, 'mana', 'Mana')}: ${cost}${dmg ? `   ${dmg}` : ''}`;
    drawText(ctx, sub, tx, r.y + 23, { size: SKILL_SUB_SIZE, color: pal.textDim, game, maxW: 200 });
    const hk = (p.hotkeys || []).indexOf(entry.id);
    if (hk >= 0) {
      const br = { x: r.x + r.w - 34, y: r.y + 22, w: 26, h: 16 };
      drawButton(ctx, br, names[hk], { game, active: true, size: 10 });
    }
    registerHit(game, r, { kind: 'skillRow', skillId: entry.id, name });
  }
  if (list.length === 0) {
    drawText(ctx, str(game, 'noSkills', 'No skills known'), panel.x + panel.w / 2, panel.y + S.rowY + 20, { align: 'center', color: pal.textDim, game });
  }
  const py = panel.y + S.rowY + S.perPage * S.rowH + 4;
  const prevR = { x: panel.x + 12, y: py, w: PAGE_BTN_W, h: PAGE_BTN_H };
  const nextR = { x: panel.x + panel.w - 12 - PAGE_BTN_W, y: py, w: PAGE_BTN_W, h: PAGE_BTN_H };
  drawButton(ctx, prevR, '<', { game, hover: pointInRect(mx, my, prevR), disabled: ui.skillPage === 0 });
  drawButton(ctx, nextR, '>', { game, hover: pointInRect(mx, my, nextR), disabled: ui.skillPage >= pages - 1 });
  registerHit(game, prevR, { kind: 'skillPage', dir: -1 });
  registerHit(game, nextR, { kind: 'skillPage', dir: 1 });
  drawText(ctx, `${str(game, 'page', 'Page')} ${ui.skillPage + 1} / ${pages}`, panel.x + panel.w / 2, py + 2, { align: 'center', size: 11, color: pal.textDim, game });
  drawText(ctx, str(game, 'skillHint', 'Click to ready. Hover + F1-F4 to bind.'), panel.x + panel.w / 2, py + 20, { align: 'center', size: 10, color: pal.textDim, game, maxW: panel.w - 20 });
}

function skillDamageText(game, p, entry) {
  const def = entry.def;
  if (!def || !def.dmg) return '';
  const r = call(bridge.Skills, 'skillDamage', null, def, p.level || 1, entry.level);
  if (!r || typeof r.min !== 'number') return '';
  const label = def.archetype === 'heal' ? str(game, 'heals', 'Heals') : str(game, 'dmg', 'Dmg');
  return `${label}: ${r.min} - ${r.max}`;
}

/* ------------------------------------------------------------------ */
/* Quest log                                                           */
/* ------------------------------------------------------------------ */

/** Quest log entries: [{id, name, state, text}] via quests.js or built from game.quests. */
export function questEntries(game) {
  const fromMod = call(bridge.Quests, 'questLogEntries', null, game);
  if (Array.isArray(fromMod)) {
    return fromMod.map((e) => ({
      id: e.id || e.questId,
      name: e.name || e.title || e.id,
      state: e.state || 'active',
      text: e.text || e.journal || (Array.isArray(e.lines) ? e.lines.join('\n') : ''),
    }));
  }
  const out = [];
  const defs = (game.theme && game.theme.quests) || [];
  const qs = game.quests || {};
  for (const id of Object.keys(qs)) {
    const q = qs[id];
    if (!q || q.state === 'hidden' || q.state === 'offered') continue;
    const def = Array.isArray(defs) ? defs.find((d) => d.id === id) : defs[id];
    out.push({ id, name: (def && def.name) || id, state: q.state, text: (def && def.text && (q.state === 'done' ? def.text.done : def.text.journal)) || '' });
  }
  out.sort((a, b) => (a.state === 'done') - (b.state === 'done'));
  return out;
}

/** Draw the quest log (left half). */
export function drawQuests(ctx, game) {
  const ui = ensureUi(game);
  const pal = palette(game);
  const panel = uiLayout.leftPanel;
  const Q = uiLayout.quests;
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  drawPanel(ctx, panel, { game, title: str(game, 'questLog', 'Quest log') });
  registerHit(game, panel, { kind: 'panel', name: 'quests' });
  const entries = questEntries(game);
  if (entries.length === 0) {
    drawText(ctx, str(game, 'noQuests', 'No quests yet'), panel.x + panel.w / 2, panel.y + Q.rowY + 10, { align: 'center', color: pal.textDim, game });
    return;
  }
  ui.questSel = Math.max(0, Math.min(entries.length - 1, ui.questSel | 0));
  const rows = Math.min(entries.length, Q.maxRows);
  const pitch = Math.min(Q.rowH + 4, Math.floor((Q.detailY - Q.rowY - 8) / Math.max(1, rows)));
  for (let i = 0; i < rows; i++) {
    const e = entries[i];
    const r = { x: panel.x + 10, y: panel.y + Q.rowY + i * pitch, w: panel.w - 20, h: pitch - 2 };
    const sel = i === ui.questSel;
    const hover = pointInRect(mx, my, r);
    if (sel || hover) fillRect(ctx, r, sel ? pal.accent : pal.panelBorder, sel ? 0.18 : 0.14);
    const done = e.state === 'done';
    drawText(ctx, (sel ? '▸ ' : '') + e.name, r.x + 6, r.y + (r.h - QUEST_SIZE) / 2 - 1, { size: QUEST_SIZE, color: done ? pal.gold : pal.text, game, maxW: r.w - 70 });
    const tag = done ? str(game, 'questDone', 'Done') : str(game, 'questActive', 'Active');
    drawText(ctx, tag, r.x + r.w - 6, r.y + (r.h - 11) / 2 - 1, { size: 11, align: 'right', color: done ? pal.gold : pal.good, game });
    registerHit(game, r, { kind: 'questRow', index: i, id: e.id });
  }
  drawSeparator(ctx, panel.x + 10, panel.x + panel.w - 10, panel.y + Q.detailY - 6, game);
  const cur = entries[ui.questSel];
  if (cur) {
    const font = fontAt(game, QUEST_DETAIL_SIZE);
    const lines = wrapText(ctx, cur.text || '', panel.w - 32, font);
    const maxLines = Math.floor((panel.h - Q.detailY - 12) / QUEST_LINE_H);
    lines.slice(0, maxLines).forEach((ln, i) => drawText(ctx, ln, panel.x + 16, panel.y + Q.detailY + i * QUEST_LINE_H, { size: QUEST_DETAIL_SIZE, color: pal.text, game }));
  }
}

/* ------------------------------------------------------------------ */
/* Automap                                                             */
/* ------------------------------------------------------------------ */

/** Full-screen translucent automap centred on the player (Tab). Not clickable. */
export function drawAutomap(ctx, game) {
  const pal = palette(game);
  const level = game.level;
  const p = game.player;
  if (!level || !level.tiles || !p) return;
  const A = uiLayout.automap;
  const hw = (TILE_W * A.scale) / 2;
  const hh = (TILE_H * A.scale) / 2;
  const area = { x: 0, y: 0, w: uiLayout.viewW, h: uiLayout.hud.y };
  fillRect(ctx, area, pal.bg, A.alpha);
  const cx = area.w / 2;
  const cy = area.h / 2;
  const pw = worldPos(p);
  const { tiles, explored } = level;
  const floorColor = mix(pal.panel, pal.text, 0.35);
  const wallColor = lighten(pal.panelBorder, 0.35);
  const doorColor = pal.accent;
  const maxDx = cx / hw + 2;
  const maxDy = cy / hh + 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  ctx.lineWidth = AUTOMAP_WALL_W;
  for (let ty = 0; ty < tiles.h; ty++) {
    for (let tx = 0; tx < tiles.w; tx++) {
      const i = ty * tiles.w + tx;
      if (!explored[i]) continue;
      const dx = tx + 0.5 - pw.x;
      const dy = ty + 0.5 - pw.y;
      const sx = cx + (dx - dy) * hw;
      const sy = cy + (dx + dy) * hh;
      if (Math.abs(sx - cx) > maxDx * hw || Math.abs(sy - cy) > maxDy * hh) continue;
      const isWall = tiles.wall[i] > 0;
      const isDoor = (tiles.flags[i] & T.DOOR) !== 0;
      if (isWall) {
        ctx.strokeStyle = wallColor;
        ctx.beginPath();
        // the two edges facing the viewer (south-west and south-east)
        ctx.moveTo(sx - hw, sy);
        ctx.lineTo(sx, sy + hh);
        ctx.lineTo(sx + hw, sy);
        ctx.stroke();
      } else if (tiles.floor[i] > 0) {
        ctx.fillStyle = isDoor ? doorColor : floorColor;
        ctx.globalAlpha = isDoor ? 1 : AUTOMAP_FLOOR_ALPHA;
        ctx.beginPath();
        ctx.moveTo(sx, sy - hh);
        ctx.lineTo(sx + hw, sy);
        ctx.lineTo(sx, sy + hh);
        ctx.lineTo(sx - hw, sy);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  // stairs / portal markers
  const marks = [];
  if (level.stairs) {
    if (level.stairs.down) marks.push({ ...level.stairs.down, color: pal.danger, label: str(game, 'down', 'Down') });
    if (level.stairs.up) marks.push({ ...level.stairs.up, color: pal.good, label: str(game, 'up', 'Up') });
    if (level.stairs.town) marks.push({ ...level.stairs.town, color: pal.gold, label: str(game, 'town', 'Town') });
  }
  if (level.portal) marks.push({ ...level.portal, color: pal.accent, label: str(game, 'portal', 'Portal') });
  for (const m of marks) {
    if (!inBounds(tiles, m.x, m.y) || !explored[idx(tiles, m.x, m.y)]) continue;
    const dx = m.x + 0.5 - pw.x;
    const dy = m.y + 0.5 - pw.y;
    const sx = cx + (dx - dy) * hw;
    const sy = cy + (dx + dy) * hh;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(sx, sy, AUTOMAP_STAIR_R, 0, Math.PI * 2);
    ctx.fill();
    drawText(ctx, m.label, sx, sy - 16, { size: 10, align: 'center', color: m.color, game });
  }
  // player arrow
  const f = dirToScreen(p.dir || 0);
  ctx.fillStyle = pal.light;
  ctx.beginPath();
  ctx.moveTo(cx + f.x * AUTOMAP_PLAYER_R * 1.6, cy + f.y * AUTOMAP_PLAYER_R * 1.6);
  ctx.lineTo(cx - f.y * AUTOMAP_PLAYER_R, cy + f.x * AUTOMAP_PLAYER_R);
  ctx.lineTo(cx + f.y * AUTOMAP_PLAYER_R, cy - f.x * AUTOMAP_PLAYER_R);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const label = level.depth === 0 ? ((game.theme && game.theme.town && game.theme.town.name) || str(game, 'town', 'Town')) : `${str(game, 'depth', 'Depth')} ${level.depth}`;
  drawText(ctx, label, 12, 8, { size: 14, color: pal.gold, game });
}

/* ------------------------------------------------------------------ */
/* Pause menu                                                          */
/* ------------------------------------------------------------------ */

const MENU_ITEMS = [
  { type: 'continue', key: 'continue', fallback: 'Continue' },
  { type: 'save', key: 'save', fallback: 'Save game' },
  { type: 'load', key: 'load', fallback: 'Load game' },
  { type: 'newGame', key: 'newGame', fallback: 'New game' },
  { type: 'mute', key: 'mute', fallback: 'Sound' },
  { type: 'quitToMenu', key: 'quitToMenu', fallback: 'Quit to menu' },
];

/** Centre pause menu: buttons routed to game.hooks.menuAction(game, {type}). */
export function drawMenu(ctx, game) {
  const pal = palette(game);
  const r = uiLayout.menu;
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  fillRect(ctx, { x: 0, y: 0, w: uiLayout.viewW, h: uiLayout.viewH }, '#000', 0.45);
  registerHit(game, { x: 0, y: 0, w: uiLayout.viewW, h: uiLayout.viewH }, { kind: 'panel', name: 'menuBackdrop' });
  drawPanel(ctx, r, { game });
  const title = (game.theme && game.theme.meta && game.theme.meta.title) || str(game, 'menu', 'Menu');
  drawText(ctx, title, r.x + r.w / 2, r.y + 16, { align: 'center', size: MENU_TITLE_SIZE, weight: 'bold', color: pal.gold, game, maxW: r.w - 20 });
  let y = r.y + 56;
  const muted = !!(game.audio && game.audio.muted);
  for (const it of MENU_ITEMS) {
    const br = { x: r.x + 30, y, w: r.w - 60, h: MENU_BUTTON_H };
    let label = str(game, it.key, it.fallback);
    if (it.type === 'mute') label = `${label}: ${muted ? str(game, 'off', 'Off') : str(game, 'on', 'On')}`;
    drawButton(ctx, br, label, { game, hover: pointInRect(mx, my, br) });
    registerHit(game, br, { kind: 'menuAction', action: { type: it.type, slot: 0 } });
    y += MENU_BUTTON_H + MENU_BUTTON_GAP;
  }
  const seed = game.seed != null ? `${str(game, 'seed', 'Seed')}: ${game.seed}` : '';
  drawText(ctx, seed, r.x + r.w / 2, r.y + r.h - 24, { align: 'center', size: 11, color: pal.textDim, game });
}


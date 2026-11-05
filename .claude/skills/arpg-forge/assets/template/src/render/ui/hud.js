/**
 * Bottom control panel: life globe (left), mana globe (right), belt of 8
 * slots centre-bottom, info box centre-top, panel buttons in two columns,
 * four skill hotkey slots plus the readied (right-click) skill button, gold,
 * a thin XP strip with the level number above the panel, and the fading
 * message log just above the panel on the left.
 */
import { drawItemGlyph } from '../sprites.js';
import { mix } from '../draw_util.js';
import { uiLayout, slotRect, columnButtonRect } from './layout.js';
import {
  palette, str, drawPanel, drawButton, drawBar, drawGlobe, drawText, drawSlot, drawItemInRect, drawSkillIcon,
  registerHit, pointInRect, rarityColor, fontAt, wrapText, fillRect,
} from './widgets.js';
import { ensureUi, bridge, call, hotkeyNames, isOpen, skillDef, focusMonster } from './state.js';

const LEFT_BUTTONS = [
  { id: 'character', key: 'character', fallback: 'Character', hotkey: 'C' },
  { id: 'quests', key: 'quests', fallback: 'Quests', hotkey: 'Q' },
  { id: 'automap', key: 'map', fallback: 'Map', hotkey: 'Tab' },
  { id: 'menu', key: 'menu', fallback: 'Menu', hotkey: 'Esc' },
];
const RIGHT_BUTTONS = [
  { id: 'inventory', key: 'inventory', fallback: 'Inventory', hotkey: 'I' },
  { id: 'skills', key: 'skills', fallback: 'Skills', hotkey: 'S' },
];
const GLOBE_LABEL_DY = 10;
const GLOBE_VALUE_SIZE = 12;
const XP_LEVEL_SIZE = 11;
const BELT_LABEL_SIZE = 9;
const COUNT_SIZE = 10;
const INFO_LINE_H = 15;
const INFO_SIZE = 13;
const INFO_HP_BAR_W = 120;
const INFO_HP_BAR_H = 6;
const GOLD_ICON = 14;
const MSG_SIZE = 12;
const SKILL_LABEL_SIZE = 10;
const MANA_SHIELD_TINT = '#ffd27a';
const TOP_EDGE = 2;
const SELECTED_T = 0.5;

/**
 * XP thresholds for the player's current level: { prev, next } (next null at cap).
 * Tries entities/player.js helpers, then balance tables, then a fallback curve.
 */
export function xpBounds(game, p) {
  const summary = call(bridge.PlayerMod, 'playerStatsSummary', null, game);
  if (summary && typeof summary.xpNext === 'number') {
    return { prev: typeof summary.xpPrev === 'number' ? summary.xpPrev : 0, next: summary.xpNext };
  }
  const lvl = p.level || 1;
  const xpFor = (l) => {
    const v = call(bridge.PlayerMod, 'xpForLevel', undefined, l);
    if (typeof v === 'number') return v;
    const table = game.balance && (game.balance.xpTable || game.balance.xp);
    if (Array.isArray(table) && typeof table[l] === 'number') return table[l];
    return null;
  };
  let prev = xpFor(lvl);
  let next = xpFor(lvl + 1);
  if (prev === null || next === null) {
    prev = fallbackXp(lvl);
    next = fallbackXp(lvl + 1);
  }
  if (typeof p.xpNext === 'number') next = p.xpNext;
  const cap = game.balance && game.balance.maxLevel;
  if (cap && lvl >= cap) next = null;
  return { prev, next };
}

function fallbackXp(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 2.2));
}

/** Draw the whole bottom panel. */
export function drawHud(ctx, game) {
  const ui = ensureUi(game);
  const pal = palette(game);
  const p = game.player;
  const L = uiLayout;
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;

  drawPanel(ctx, L.hud, { game });
  registerHit(game, L.hud, { kind: 'hud' });
  drawXpBar(ctx, game, p);
  drawMessages(ctx, game);

  // --- globes ---
  const hp = p ? Math.max(0, p.hp || 0) : 0;
  const hpMax = p ? Math.max(1, p.hpMax || 1) : 1;
  const mp = p ? Math.max(0, p.mp || 0) : 0;
  const mpMax = p ? Math.max(1, p.mpMax || 1) : 1;
  const shield = p && p.state && p.state.manaShield;
  drawGlobe(ctx, L.lifeGlobe.cx, L.lifeGlobe.cy, L.lifeGlobe.r, hp / hpMax, { color: pal.hp, tick: game.tick, game });
  drawGlobe(ctx, L.manaGlobe.cx, L.manaGlobe.cy, L.manaGlobe.r, mp / mpMax, { color: pal.mp, tick: game.tick, game, tint: shield ? MANA_SHIELD_TINT : null });
  const lifeRect = globeRect(L.lifeGlobe);
  const manaRect = globeRect(L.manaGlobe);
  registerHit(game, lifeRect, { kind: 'globe', stat: 'life' });
  registerHit(game, manaRect, { kind: 'globe', stat: 'mana' });
  const hpColor = hp <= 0 ? pal.danger : hp >= hpMax ? pal.gold : pal.text;
  drawText(ctx, `${Math.ceil(hp)}/${hpMax}`, L.lifeGlobe.cx, L.lifeGlobe.cy - GLOBE_LABEL_DY, { align: 'center', size: GLOBE_VALUE_SIZE, color: hpColor, game, weight: 'bold' });
  drawText(ctx, str(game, 'life', 'Life'), L.lifeGlobe.cx, L.lifeGlobe.cy + GLOBE_LABEL_DY - 4, { align: 'center', size: 10, color: pal.text, game, alpha: 0.8 });
  const mpColor = mp <= 0 ? pal.danger : mp >= mpMax ? pal.gold : pal.text;
  drawText(ctx, `${Math.ceil(mp)}/${mpMax}`, L.manaGlobe.cx, L.manaGlobe.cy - GLOBE_LABEL_DY, { align: 'center', size: GLOBE_VALUE_SIZE, color: mpColor, game, weight: 'bold' });
  drawText(ctx, str(game, shield ? 'manaShield' : 'mana', shield ? 'Shield' : 'Mana'), L.manaGlobe.cx, L.manaGlobe.cy + GLOBE_LABEL_DY - 4, { align: 'center', size: 10, color: shield ? MANA_SHIELD_TINT : pal.text, game, alpha: 0.8 });

  // --- buttons ---
  LEFT_BUTTONS.forEach((b, i) => drawPanelButton(ctx, game, columnButtonRect(L.leftButtons, i), b, mx, my));
  RIGHT_BUTTONS.forEach((b, i) => drawPanelButton(ctx, game, columnButtonRect(L.rightButtons, i), b, mx, my));
  if (p && p.statPoints > 0) {
    const r = L.levelUpButton;
    drawButton(ctx, r, str(game, 'levelUp', 'Level up'), { game, hover: pointInRect(mx, my, r), color: pal.gold, size: 11 });
    registerHit(game, r, { kind: 'levelUp' });
  }

  // --- gold ---
  drawItemGlyph(ctx, L.goldText.x + GOLD_ICON / 2, L.goldText.y + 8, { glyph: 'coin', color: pal.gold, color2: mix(pal.gold, '#000', 0.4) }, GOLD_ICON);
  drawText(ctx, formatNumber(p ? p.gold || 0 : 0), L.goldText.x + GOLD_ICON + 5, L.goldText.y + 1, { color: pal.gold, size: 13, game, maxW: L.goldText.w - GOLD_ICON - 4 });
  drawText(ctx, str(game, 'gold', 'Gold'), L.goldText.x, L.goldText.y + 20, { color: pal.textDim, size: 10, game });

  drawBelt(ctx, game, p, mx, my);
  drawHotkeys(ctx, game, p, mx, my);
  drawSkillButton(ctx, game, p, mx, my);
  drawInfoBox(ctx, game);
}

function globeRect(g) {
  return { x: g.cx - g.r, y: g.cy - g.r, w: g.r * 2, h: g.r * 2 };
}

function drawPanelButton(ctx, game, rect, b, mx, my) {
  const label = str(game, b.key, b.fallback);
  drawButton(ctx, rect, label, { game, hover: pointInRect(mx, my, rect), active: isOpen(game, b.id), size: 11 });
  registerHit(game, rect, { kind: 'hudButton', id: b.id, label, hotkey: b.hotkey });
}

function drawXpBar(ctx, game, p) {
  const pal = palette(game);
  const L = uiLayout;
  if (!p) return;
  const { prev, next } = xpBounds(game, p);
  const xp = p.xp || 0;
  const ratio = next === null ? 1 : (xp - prev) / Math.max(1, next - prev);
  drawBar(ctx, L.xpBar, ratio, { color: next === null ? pal.gold : pal.xp, game });
  registerHit(game, { x: L.xpBar.x, y: L.xpBar.y - TOP_EDGE, w: L.xpBar.w, h: L.xpBar.h + TOP_EDGE * 2 }, { kind: 'xpBar', xp, prev, next });
  const lvl = `${str(game, 'level', 'Level')} ${p.level || 1}`;
  drawText(ctx, lvl, L.xpBar.x - 6, L.xpBar.y - 4, { align: 'right', size: XP_LEVEL_SIZE, color: pal.xp, game });
  if (game.level && typeof game.level.depth === 'number') {
    const name = levelName(game);
    drawText(ctx, name, L.xpBar.x + L.xpBar.w + 6, L.xpBar.y - 4, { size: XP_LEVEL_SIZE, color: pal.textDim, game, maxW: 150 });
  }
}

function levelName(game) {
  const lvl = game.level;
  if (lvl.depth === 0) return (game.theme && game.theme.town && game.theme.town.name) || str(game, 'town', 'Town');
  const fl = game.theme && game.theme.flavor;
  const tier = game.theme && game.theme.tiers && game.theme.tiers.find((t) => t.depths && lvl.depth >= t.depths[0] && lvl.depth <= t.depths[1]);
  if (fl && typeof fl.levelName === 'function') return fl.levelName(lvl.depth, tier ? tier.name : '');
  return `${str(game, 'depth', 'Depth')} ${lvl.depth}`;
}

function drawBelt(ctx, game, p, mx, my) {
  const ui = game.ui;
  const pal = palette(game);
  const belt = (p && p.belt) || ui.belt || [];
  for (let i = 0; i < uiLayout.belt.count; i++) {
    const r = slotRect(uiLayout.belt, i);
    const item = belt[i] || null;
    const hover = pointInRect(mx, my, r);
    let valid = null;
    if (ui.cursorItem && hover) valid = beltAccepts(ui.cursorItem);
    drawSlot(ctx, r, { game, item, hover, valid });
    if (item) {
      drawItemInRect(ctx, item, r);
      if (item.count > 1) drawText(ctx, String(item.count), r.x + r.w - 2, r.y + r.h - 12, { align: 'right', size: COUNT_SIZE, color: pal.text, game });
    }
    drawText(ctx, String(i + 1), r.x + 2, r.y + 1, { size: BELT_LABEL_SIZE, color: pal.textDim, game });
    registerHit(game, r, { kind: 'belt', index: i, item });
  }
}

/** Can an item live in the belt? (consumable sized 1x1, or theme says belt:true) */
export function beltAccepts(item) {
  if (!item) return false;
  if (item.belt === true) return true;
  if (item.belt === false) return false;
  return item.slot === 'consumable' || item.slot === 'scroll';
}

function drawHotkeys(ctx, game, p, mx, my) {
  const pal = palette(game);
  const names = hotkeyNames(game);
  const hot = (p && p.hotkeys) || [];
  const selected = (p && p.selectedSkill) || game.ui.selectedSkill;
  for (let i = 0; i < uiLayout.hotkeys.count; i++) {
    const r = slotRect(uiLayout.hotkeys, i);
    const skillId = hot[i] || null;
    const def = skillDef(game, skillId);
    const hover = pointInRect(mx, my, r);
    drawSlot(ctx, r, { game, hover, highlight: skillId && skillId === selected ? pal.accent : null });
    if (def) drawSkillIcon(ctx, { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 6 }, def.look, { game, disabled: !canCast(game, p, skillId) });
    drawText(ctx, names[i], r.x + 2, r.y + 1, { size: BELT_LABEL_SIZE, color: pal.textDim, game });
    registerHit(game, r, { kind: 'hotkey', index: i, skillId, name: def ? def.name : null, hotkey: names[i] });
  }
}

/** Is the skill castable right now (skills.js canCast, else mana check)? */
export function canCast(game, p, skillId) {
  if (!p || !skillId) return false;
  const r = call(bridge.Skills, 'canCast', undefined, game, p, skillId);
  if (typeof r === 'boolean') return r;
  if (r && typeof r.ok === 'boolean') return r.ok;
  const cost = manaCostOf(game, p, skillId);
  return (p.mp || 0) >= cost;
}

/** Mana cost via skills.js (0 when unknown). */
export function manaCostOf(game, p, skillId) {
  const c = call(bridge.Skills, 'manaCost', null, p, skillId);
  if (typeof c === 'number') return c;
  const def = skillDef(game, skillId);
  if (!def) return 0;
  const lvl = (p.skills && p.skills[skillId]) || 1;
  const cost = (def.manaBase || 0) - (def.manaPerLevel || 0) * (lvl - 1);
  return Math.max(def.manaMin || 0, Math.round(cost));
}

function drawSkillButton(ctx, game, p, mx, my) {
  const pal = palette(game);
  const r = uiLayout.skillButton;
  const skillId = (p && p.selectedSkill) || game.ui.selectedSkill || null;
  const def = skillDef(game, skillId);
  const hover = pointInRect(mx, my, r);
  drawSlot(ctx, r, { game, hover, highlight: def ? mix(pal.panelBorder, pal.accent, SELECTED_T) : null });
  if (def) {
    drawSkillIcon(ctx, { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 }, def.look, { game, disabled: !canCast(game, p, skillId) });
  } else {
    drawText(ctx, str(game, 'noSkill', 'none'), r.x + r.w / 2, r.y + r.h / 2 - 6, { align: 'center', size: 10, color: pal.textDim, game });
  }
  drawText(ctx, def ? def.name : str(game, 'rightClick', 'RMB'), r.x + r.w / 2, r.y + r.h + 4, { align: 'center', size: SKILL_LABEL_SIZE, color: def ? pal.text : pal.textDim, game, maxW: 70 });
  registerHit(game, r, { kind: 'skillButton', skillId, name: def ? def.name : null });
}

/* ------------------------------------------------------------------ */
/* Info box (one priority chain)                                       */
/* ------------------------------------------------------------------ */

/**
 * Lines for the info box: [{text, color, bar?}] by priority
 * panel hover → held item → hovered world entity → hovered tile.
 */
export function infoLines(game) {
  const ui = ensureUi(game);
  const pal = palette(game);
  const hu = ui.hoverUi;
  if (hu) {
    const lines = uiHoverLines(game, hu);
    if (lines) return lines;
  }
  if (ui.cursorItem) {
    const it = ui.cursorItem;
    if (it.slot === 'gold') return [{ text: `${formatNumber(it.count || 0)} ${str(game, 'gold', 'Gold')}`, color: pal.gold }];
    return [{ text: it.name, color: rarityColor(game, it) }];
  }
  const h = ui.hover;
  if (h && h.entity) {
    const e = h.entity;
    if (h.kind === 'monster') {
      const color = e.flags && (e.flags.has ? e.flags.has('unique') || e.flags.has('boss') : false) ? pal.gold : pal.text;
      return [{ text: e.name || e.typeId || '?', color }, { bar: Math.max(0, e.hp || 0) / Math.max(1, e.hpMax || 1), color: pal.hp }];
    }
    if (h.kind === 'item') {
      if (e.slot === 'gold') return [{ text: `${formatNumber(e.count || 0)} ${str(game, 'gold', 'Gold')}`, color: pal.gold }];
      return [{ text: e.name || e.baseId, color: e.identified === false ? pal.text : rarityColor(game, e) }];
    }
    if (h.kind === 'npc') {
      const out = [{ text: e.name || e.npcId, color: pal.gold }];
      if (e.title) out.push({ text: e.title, color: pal.textDim });
      return out;
    }
    if (h.kind === 'object') {
      const out = [{ text: e.name || e.typeId || e.kind, color: pal.text }];
      if (e.state && e.state !== 'closed') out.push({ text: str(game, `state_${e.state}`, e.state), color: pal.textDim });
      return out;
    }
  }
  if (ui.hoverTile && game.level && game.level.stairs) {
    const t = ui.hoverTile;
    const s = game.level.stairs;
    if (s.down && s.down.x === t.x && s.down.y === t.y) return [{ text: str(game, 'stairsDown', 'Stairs down'), color: pal.text }];
    if (s.up && s.up.x === t.x && s.up.y === t.y) return [{ text: str(game, 'stairsUp', 'Stairs up'), color: pal.text }];
    if (s.town && s.town.x === t.x && s.town.y === t.y) return [{ text: str(game, 'toTown', 'To town'), color: pal.text }];
  }
  return [];
}

function uiHoverLines(game, hu) {
  const pal = palette(game);
  switch (hu.kind) {
    case 'hudButton':
      return [{ text: hu.label, color: pal.text }, { text: `${str(game, 'hotkey', 'Hotkey')}: ${hu.hotkey}`, color: pal.textDim }];
    case 'belt':
      if (hu.item) return [{ text: hu.item.name, color: rarityColor(game, hu.item) }, { text: `${str(game, 'hotkey', 'Hotkey')}: ${hu.index + 1}`, color: pal.textDim }];
      return [{ text: `${str(game, 'belt', 'Belt')} ${hu.index + 1}`, color: pal.textDim }];
    case 'hotkey':
      if (hu.name) return [{ text: hu.name, color: pal.text }, { text: `${str(game, 'hotkey', 'Hotkey')}: ${hu.hotkey}`, color: pal.textDim }];
      return [{ text: `${str(game, 'hotkey', 'Hotkey')} ${hu.hotkey}`, color: pal.textDim }, { text: str(game, 'hotkeyHint', 'Hover a skill and press the key to bind'), color: pal.textDim }];
    case 'skillButton':
      return [{ text: hu.name || str(game, 'noSkill', 'No skill readied'), color: hu.name ? pal.text : pal.textDim }, { text: str(game, 'skillButtonHint', 'Right-click to cast'), color: pal.textDim }];
    case 'xpBar': {
      const toGo = hu.next === null ? str(game, 'maxLevel', 'Max level') : `${formatNumber(hu.next - hu.xp)} ${str(game, 'toNextLevel', 'to next level')}`;
      return [{ text: `${str(game, 'experience', 'Experience')}: ${formatNumber(hu.xp)}`, color: pal.xp }, { text: toGo, color: pal.textDim }];
    }
    case 'globe': {
      const p = game.player;
      if (!p) return null;
      if (hu.stat === 'life') return [{ text: `${str(game, 'life', 'Life')}: ${Math.ceil(p.hp || 0)} / ${p.hpMax || 0}`, color: pal.text }];
      return [{ text: `${str(game, 'mana', 'Mana')}: ${Math.ceil(p.mp || 0)} / ${p.mpMax || 0}`, color: pal.text }];
    }
    case 'levelUp':
      return [{ text: `${game.player && game.player.statPoints} ${str(game, 'pointsToSpend', 'points to spend')}`, color: pal.gold }];
    case 'invCell':
    case 'equipSlot':
    case 'vendorItem':
    case 'sellItem':
      if (hu.item) return [{ text: hu.item.name, color: rarityColor(game, hu.item) }];
      return null;
    case 'skillRow':
      return hu.name ? [{ text: hu.name, color: pal.text }] : null;
    default:
      return null;
  }
}

function drawInfoBox(ctx, game) {
  const pal = palette(game);
  const r = uiLayout.infoBox;
  fillRect(ctx, r, '#000', 0.45);
  ctx.strokeStyle = mix(pal.panel, pal.panelBorder, 0.6);
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  const lines = infoLines(game).slice(0, 3);
  if (lines.length === 0) return;
  const totalH = lines.length * INFO_LINE_H;
  let y = r.y + (r.h - totalH) / 2;
  for (const ln of lines) {
    if (typeof ln.bar === 'number') {
      drawBar(ctx, { x: r.x + (r.w - INFO_HP_BAR_W) / 2, y: y + 4, w: INFO_HP_BAR_W, h: INFO_HP_BAR_H }, ln.bar, { color: ln.color, game });
    } else {
      drawText(ctx, ln.text, r.x + r.w / 2, y, { align: 'center', size: INFO_SIZE, color: ln.color || pal.text, game, maxW: r.w - 12 });
    }
    y += INFO_LINE_H;
  }
}

function drawMessages(ctx, game) {
  const ui = game.ui;
  const L = uiLayout.messages;
  const msgs = ui.messages.slice(-L.lines);
  const font = fontAt(game, MSG_SIZE);
  let y = L.y;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const alpha = Math.max(0, Math.min(1, m.ttl / L.fade));
    const lines = wrapText(ctx, m.text, uiLayout.leftPanel.w + 40, font);
    y -= lines.length * L.lineH;
    lines.forEach((ln, j) => drawText(ctx, ln, L.x, y + j * L.lineH, { size: MSG_SIZE, color: m.color, alpha, game }));
  }
}

/** 12345 -> "12,345" */
export function formatNumber(n) {
  return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export { focusMonster };

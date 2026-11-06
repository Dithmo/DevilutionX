/**
 * Bottom control panel, an ornamented forged-metal bar rather than a full-width
 * rectangle: life globe (left) and mana globe (right) in horned sockets, a
 * central row of recessed slots (gold plaque, 8 belt slots, 4 skill hotkeys,
 * the readied right-click skill in a raised bezel), panel-button tabs on the
 * bar's top edge either side of a level medallion, an XP groove in the top
 * molding, a floating hover-info plaque, the zone name and the fading message
 * log above the bar on the left. The world stays visible around the ornaments.
 *
 * Static chrome is one cached sprite (hud_frame.js); per frame only the globe
 * liquid, bars, slot contents, text and button states are drawn.
 */
import { drawItemGlyph } from '../sprites.js';
import { mix, RENDER_SCALE } from '../draw_util.js';
import { uiLayout, slotRect, columnButtonRect } from './layout.js';
import { blitSprite, chromeSprite, chromeSig, roundRectPath, metal, trimStroke } from './chrome.js';
import { hudFrameSprite, medallionSprite } from './hud_frame.js';
import {
  palette, str, drawButton, drawBar, drawGlobe, drawText, drawSlot, drawItemInRect, drawSkillIcon,
  registerHit, pointInRect, rarityColor, fontAt, wrapText,
} from './widgets.js';
import { ensureUi, bridge, call, hotkeyNames, isOpen, skillDef, focusMonster } from './state.js';

const LEFT_BUTTONS = [
  { id: 'character', key: 'character', fallback: 'Character', hotkey: 'C' },
  { id: 'quests', key: 'quests', fallback: 'Quests', hotkey: 'Q' },
  { id: 'automap', key: 'map', fallback: 'Map', hotkey: 'Tab' },
];
const RIGHT_BUTTONS = [
  { id: 'inventory', key: 'inventory', fallback: 'Inventory', hotkey: 'I' },
  { id: 'skills', key: 'skills', fallback: 'Skills', hotkey: 'S' },
  { id: 'menu', key: 'menu', fallback: 'Menu', hotkey: 'Esc' },
];
const GLOBE_LABEL_DY = 11;
const GLOBE_VALUE_SIZE = 14;
const TAB_TEXT = 10;
const MEDALLION_TEXT = 13;
const TICK_MS = 50; // globe animation runs on wall-clock time in tick units (smooth between ticks)
const XP_LEVEL_SIZE = 11;
const BELT_LABEL_SIZE = 9;
const COUNT_SIZE = 10;
const SLOT_LABEL_IN = 4; // slot number / hotkey name sits inside the well, clear of the bevel
const INFO_LINE_H = 15;
const INFO_SIZE = 13;
const INFO_HP_BAR_W = 120;
const INFO_HP_BAR_H = 6;
const GOLD_ICON = 14;
const MSG_SIZE = 12;
const MSG_MIN_W = 160;
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

  blitSprite(ctx, hudFrameSprite(pal), 0, 0);
  registerHit(game, L.hud, { kind: 'hud' });
  registerHit(game, L.lifeFrame, { kind: 'hud' });
  registerHit(game, L.manaFrame, { kind: 'hud' });
  drawXpBar(ctx, game, p);
  drawMessages(ctx, game);

  // --- globes ---
  const hp = p ? Math.max(0, p.hp || 0) : 0;
  const hpMax = p ? Math.max(1, p.hpMax || 1) : 1;
  const mp = p ? Math.max(0, p.mp || 0) : 0;
  const mpMax = p ? Math.max(1, p.mpMax || 1) : 1;
  const shield = p && p.state && p.state.manaShield;
  const time = typeof performance !== 'undefined' ? performance.now() / TICK_MS : game.tick;
  drawGlobe(ctx, L.lifeGlobe.cx, L.lifeGlobe.cy, L.lifeGlobe.r, hp / hpMax, { color: pal.lifeColor, tick: game.tick, time, game, frame: false });
  drawGlobe(ctx, L.manaGlobe.cx, L.manaGlobe.cy, L.manaGlobe.r, mp / mpMax, { color: pal.manaColor, tick: game.tick, time: time + 97, game, tint: shield ? MANA_SHIELD_TINT : null, frame: false });
  const lifeRect = globeRect(L.lifeGlobe);
  const manaRect = globeRect(L.manaGlobe);
  registerHit(game, lifeRect, { kind: 'globe', stat: 'life' });
  registerHit(game, manaRect, { kind: 'globe', stat: 'mana' });
  const hpColor = hp <= 0 ? pal.danger : hp >= hpMax ? pal.gold : pal.text;
  drawText(ctx, `${Math.ceil(hp)}/${hpMax}`, L.lifeGlobe.cx, L.lifeGlobe.cy - GLOBE_LABEL_DY, { align: 'center', size: GLOBE_VALUE_SIZE, color: hpColor, game, weight: 'bold' });
  drawText(ctx, str(game, 'life', 'Life'), L.lifeGlobe.cx, L.lifeGlobe.cy + GLOBE_LABEL_DY - 5, { align: 'center', size: 10, color: pal.text, game, alpha: 0.85 });
  const mpColor = mp <= 0 ? pal.danger : mp >= mpMax ? pal.gold : pal.text;
  drawText(ctx, `${Math.ceil(mp)}/${mpMax}`, L.manaGlobe.cx, L.manaGlobe.cy - GLOBE_LABEL_DY, { align: 'center', size: GLOBE_VALUE_SIZE, color: mpColor, game, weight: 'bold' });
  drawText(ctx, str(game, shield ? 'manaShield' : 'mana', shield ? 'Shield' : 'Mana'), L.manaGlobe.cx, L.manaGlobe.cy + GLOBE_LABEL_DY - 5, { align: 'center', size: 10, color: shield ? MANA_SHIELD_TINT : pal.text, game, alpha: 0.85 });

  // --- panel-button tabs ---
  LEFT_BUTTONS.forEach((b, i) => drawPanelButton(ctx, game, columnButtonRect(L.leftButtons, i), b, mx, my));
  RIGHT_BUTTONS.forEach((b, i) => drawPanelButton(ctx, game, columnButtonRect(L.rightButtons, i), b, mx, my));
  if (p && p.statPoints > 0 && !ui.right && !ui.vendor) {
    const r = L.levelUpButton;
    drawButton(ctx, r, str(game, 'levelUp', 'Level up'), { game, hover: pointInRect(mx, my, r), color: pal.gold, size: 11 });
    registerHit(game, r, { kind: 'levelUp' });
  }

  // --- gold plaque ---
  const G = L.goldText;
  drawItemGlyph(ctx, G.x + 6 + GOLD_ICON / 2, G.y + 10, { glyph: 'coin', color: pal.gold, color2: mix(pal.gold, '#000', 0.4) }, GOLD_ICON);
  drawText(ctx, formatNumber(p ? p.gold || 0 : 0), G.x + 8 + GOLD_ICON, G.y + 3, { color: pal.gold, size: 12, game, weight: 'bold', maxW: G.w - GOLD_ICON - 10 });
  drawText(ctx, str(game, 'gold', 'Gold'), G.x + G.w / 2, G.y + 21, { align: 'center', color: pal.textDim, size: 10, game, maxW: G.w - 6 });

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
  drawButton(ctx, rect, label, { game, hover: pointInRect(mx, my, rect), active: isOpen(game, b.id), size: TAB_TEXT });
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
  // level medallion over the groove's centre
  const M = L.medallion;
  blitSprite(ctx, medallionSprite(pal), M.cx, M.cy);
  drawText(ctx, String(p.level || 1), M.cx, M.cy - MEDALLION_TEXT / 2 - 0.5, { align: 'center', size: MEDALLION_TEXT, color: pal.gold, game, weight: 'bold' });
  registerHit(game, { x: M.cx - M.w / 2, y: M.cy - M.h / 2, w: M.w, h: M.h }, { kind: 'xpBar', xp, prev, next });
  if (game.level && typeof game.level.depth === 'number') {
    // Zone name sits in the top-right corner of the view, clear of the globe ornaments
    // (the character level is already shown on the medallion).
    const Z = L.zoneName;
    drawText(ctx, levelName(game), Z.x, Z.y, { align: 'right', size: 13, color: pal.text, game, maxW: 260, alpha: 0.85 });
  }
  // Permadeath badge under the zone name: a constant reminder that this hero's save dies with them.
  if (game.flags && game.flags.hardcore) {
    const Z = L.zoneName;
    const label = str(game, 'hardcoreBadge', 'PERMADEATH');
    const w = Math.min(160, label.length * 7 + 16);
    const r = { x: Z.x - w, y: Z.y + 20, w, h: 16 };
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = pal.danger;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.restore();
    drawText(ctx, label, r.x + r.w / 2, r.y + 3, { align: 'center', size: 10, weight: 'bold', color: pal.danger, game, maxW: r.w - 6 });
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
      if (item.count > 1) drawText(ctx, String(item.count), r.x + r.w - SLOT_LABEL_IN, r.y + r.h - 13, { align: 'right', size: COUNT_SIZE, color: pal.text, game });
    }
    drawText(ctx, String(i + 1), r.x + SLOT_LABEL_IN, r.y + SLOT_LABEL_IN - 1, { size: BELT_LABEL_SIZE, color: pal.textDim, game, alpha: 0.8 });
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
    drawText(ctx, names[i], r.x + SLOT_LABEL_IN, r.y + SLOT_LABEL_IN - 1, { size: BELT_LABEL_SIZE, color: pal.textDim, game, alpha: 0.8 });
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
  drawSlot(ctx, r, { game, hover, highlight: def ? mix(pal.trim, pal.accent, SELECTED_T) : null });
  if (def) {
    drawSkillIcon(ctx, { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 }, def.look, { game, disabled: !canCast(game, p, skillId) });
  } else {
    drawText(ctx, str(game, 'noSkill', 'none'), r.x + r.w / 2, r.y + r.h / 2 - 6, { align: 'center', size: 10, color: pal.textDim, game });
  }
  // name on a dark pill above the bezel so it reads over the trim
  const label = def ? def.name : str(game, 'rightClick', 'RMB');
  const lw = Math.min(82, label.length * SKILL_LABEL_SIZE * 0.56 + 12);
  const ly = r.y - SKILL_LABEL_SIZE - 9;
  ctx.save();
  ctx.fillStyle = 'rgba(6,6,10,0.82)';
  ctx.strokeStyle = pal.metalEdge || pal.trim;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(r.x + r.w / 2 - lw / 2, ly - 2, lw, SKILL_LABEL_SIZE + 6, 4); else ctx.rect(r.x + r.w / 2 - lw / 2, ly - 2, lw, SKILL_LABEL_SIZE + 6);
  ctx.fill(); ctx.stroke();
  ctx.restore();
  drawText(ctx, label, r.x + r.w / 2, ly, { align: 'center', size: SKILL_LABEL_SIZE, color: def ? pal.text : pal.textDim, game, maxW: 76 });
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
  const lines = infoLines(game).slice(0, 3);
  if (lines.length === 0) return; // nothing hovered: the world shows through
  blitSprite(ctx, infoPlaqueSprite(pal, r.w, r.h), r.x, r.y);
  const totalH = lines.length * INFO_LINE_H;
  let y = r.y + (r.h - totalH) / 2;
  for (const ln of lines) {
    if (typeof ln.bar === 'number') {
      drawBar(ctx, { x: r.x + (r.w - INFO_HP_BAR_W) / 2, y: y + 4, w: INFO_HP_BAR_W, h: INFO_HP_BAR_H }, ln.bar, { color: ln.color, game });
    } else {
      drawText(ctx, ln.text, r.x + r.w / 2, y, { align: 'center', size: INFO_SIZE, color: ln.color || pal.text, game, maxW: r.w - 24 });
    }
    y += INFO_LINE_H;
  }
}

/** Floating info plaque: smoked-glass body, thin metal frame, trim-tipped ends. */
function infoPlaqueSprite(pal, w, h) {
  return chromeSprite(`infoplaque|${chromeSig(pal)}|${w}x${h}`, w + 20, h + 12, 10, 6, (c) => {
    const body = (k) => roundRectPath(k, 0, 0, w, h, 6);
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = 8 * RENDER_SCALE;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0.78)');
    c.fillStyle = g;
    c.beginPath();
    body(c);
    c.fill();
    c.restore();
    const frame = (k) => {
      roundRectPath(k, 0, 0, w, h, 6);
      roundRectPath(k, 2, 2, w - 4, h - 4, 4.5);
    };
    metal(c, frame, { x: 0, y: 0, w, h }, pal, { rule: 'evenodd', shadow: 0, bevel: 0.6, texture: false, light: 0.4 });
    for (const s of [-1, 1]) {
      const x = s < 0 ? 0 : w;
      const tip = (k) => {
        k.moveTo(x, h / 2 - 8);
        k.lineTo(x + s * 7, h / 2);
        k.lineTo(x, h / 2 + 8);
        k.closePath();
      };
      metal(c, tip, { x: Math.min(x, x + s * 7), y: h / 2 - 8, w: 7, h: 16 }, pal, { shadow: 2, texture: false, bevel: 0.6, light: 0.5 });
      trimStroke(c, (k) => {
        k.moveTo(x - s * 9, h / 2 - 4);
        k.lineTo(x - s * 6, h / 2);
        k.lineTo(x - s * 9, h / 2 + 4);
        k.lineTo(x - s * 12, h / 2);
        k.closePath();
      }, pal, 0.7);
    }
  });
}

function drawMessages(ctx, game) {
  const ui = game.ui;
  const L = uiLayout.messages;
  const msgs = ui.messages.slice(-L.lines);
  const font = fontAt(game, MSG_SIZE);
  // keep the log readable beside an open left panel / vendor instead of under it
  const x = ui.vendor ? uiLayout.vendor.x + uiLayout.vendor.w + L.x : ui.left ? uiLayout.leftPanel.x + uiLayout.leftPanel.w + L.x : L.x;
  const rightEdge = uiLayout.viewW - (ui.right ? uiLayout.rightPanel.w : 0) - L.x;
  if (rightEdge - x < MSG_MIN_W) return; // panels cover both sides: no room for the log
  const wrapW = Math.min(uiLayout.leftPanel.w + 40, rightEdge - x);
  let y = L.y;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const alpha = Math.max(0, Math.min(1, m.ttl / L.fade));
    const lines = wrapText(ctx, m.text, wrapW, font);
    y -= lines.length * L.lineH;
    lines.forEach((ln, j) => drawText(ctx, ln, x, y + j * L.lineH, { size: MSG_SIZE, color: m.color, alpha, game }));
  }
}

/** 12345 -> "12,345" */
export function formatNumber(n) {
  return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}


/**
 * World-space and full-screen overlays: floating damage numbers, the
 * monster health bar, ground item labels (Alt), item / skill tooltips, the
 * death and win screens, the main menu (class select, name, seed) and the
 * loading screen.
 */
import { worldToScreen, worldPos } from '../camera.js';
import { drawActor } from '../sprites.js';
import { mix } from '../draw_util.js';
import { idx, inBounds } from '../../world/tiles.js';
import { uiLayout } from './layout.js';
import {
  palette, str, drawPanel, drawButton, drawBar, drawText, registerHit, pointInRect, rarityColor, wrapText, fontAt, fillRect, measureText,
} from './widgets.js';
import { ensureUi, bridge, call, classList, skillDef, focusMonster, hotkeyNames } from './state.js';
import { manaCostOf } from './hud.js';

const FLOAT_SIZE = 14;
const FLOAT_CRIT_SIZE = 18;
const FLOAT_FADE_FRACTION = 0.4;
const FLOAT_BASE_LIFT = 56;
const BAR_NAME_SIZE = 13;
const LABEL_SIZE = 11;
const LABEL_PAD_X = 4;
const LABEL_H = 14;
const LABEL_LIFT = 22;
const LABEL_GAP = 2;
const LABEL_ALPHA = 0.8;
const TOOLTIP_SIZE = 12;
const TOOLTIP_ALPHA = 0.95;
const CURSOR_OFFSET = 16;
const TITLE_SIZE = 40;
const TAGLINE_SIZE = 15;
const CARD_W = 200;
const CARD_H = 200;
const CARD_GAP = 20;
const CARD_Y = 130;
const CARD_ACTOR_SCALE = 1.5;
const CARD_ACTOR_FEET_Y = 108;
const CARD_BLURB_Y = 128;
const CARD_BLURB_LINES = 3;
const ROW_KINDS = new Set(['skillRow', 'vendorItem', 'sellItem']);
const CELL_KINDS = new Set(['invCell', 'equipSlot', 'belt', 'hotkey', 'skillButton']);
const ANCHOR_GAP = 6;
const FIELD_W = 260;
const FIELD_H = 24;
const FIELD_Y = 352;
const FIELD_GAP = 10;
const BIG_BUTTON_W = 150;
const BIG_BUTTON_H = 32;
const MENU_BUTTONS_Y = 440;
const TOGGLE_W = 170;
const TOGGLE_GAP = 16;
const NAME_MAX = 16;
const SEED_MAX = 12;
const DEATH_TITLE_SIZE = 44;
const DEATH_TINT = 'rgba(120,0,0,0.4)';
const WIN_TINT = 'rgba(20,10,0,0.55)';
const SCREEN_BUTTON_Y = 300;
const SCREEN_BUTTON_W = 160;
const SCREEN_BUTTON_H = 30;
const SCREEN_BUTTON_GAP = 14;
const LOADING_BAR_W = 300;
const CARET_BLINK_TICKS = 10;

/* ------------------------------------------------------------------ */
/* Floating numbers                                                    */
/* ------------------------------------------------------------------ */

/** Draw floats (world coords -> screen, rising and fading). */
export function drawFloats(ctx, game) {
  const ui = ensureUi(game);
  const cam = game.camera;
  if (!cam || ui.floats.length === 0) return;
  const F = uiLayout.floats;
  for (const f of ui.floats) {
    const life = 1 - f.ttl / (f.ttlMax || F.ttl);
    const s = worldToScreen(f.x, f.y, cam);
    const y = s.y - FLOAT_BASE_LIFT - life * F.rise;
    const alpha = f.ttl < (f.ttlMax || F.ttl) * FLOAT_FADE_FRACTION ? f.ttl / ((f.ttlMax || F.ttl) * FLOAT_FADE_FRACTION) : 1;
    drawText(ctx, f.text, s.x, y, { align: 'center', size: f.crit ? FLOAT_CRIT_SIZE : FLOAT_SIZE, weight: 'bold', color: f.color, alpha, game });
  }
}

/* ------------------------------------------------------------------ */
/* Monster health bar                                                  */
/* ------------------------------------------------------------------ */

/** Top-centre bar for the hovered / last-hit monster. */
export function drawMonsterBar(ctx, game) {
  const m = focusMonster(game);
  if (!m) return;
  const pal = palette(game);
  const B = uiLayout.monsterBar;
  const x = (uiLayout.viewW - B.w) / 2;
  const unique = m.flags && typeof m.flags.has === 'function' && (m.flags.has('unique') || m.flags.has('boss'));
  drawText(ctx, m.name || m.typeId || '?', uiLayout.viewW / 2, B.y - 1, { align: 'center', size: BAR_NAME_SIZE, weight: 'bold', color: unique ? pal.gold : pal.text, game });
  const ratio = Math.max(0, m.hp || 0) / Math.max(1, m.hpMax || 1);
  const over = (m.hp || 0) > (m.hpMax || 0) ? Math.floor((m.hp || 0) / Math.max(1, m.hpMax || 1)) : 0;
  drawBar(ctx, { x, y: B.y + 16, w: B.w, h: B.h }, over ? 1 : ratio, { color: over ? pal.mp : pal.hp, game, border: pal.panelBorder });
  const label = over ? `x${over + 1}` : `${Math.ceil(m.hp || 0)} / ${m.hpMax || 0}`;
  drawText(ctx, label, uiLayout.viewW / 2, B.y + 16, { align: 'center', size: 11, color: pal.text, game });
  const extras = [];
  if (m.level) extras.push(`${str(game, 'level', 'Level')} ${m.level}`);
  if (m.immune && m.immune.size) extras.push(`${str(game, 'immune', 'Immune')}: ${[...m.immune].join(', ')}`);
  if (extras.length) drawText(ctx, extras.join('   '), uiLayout.viewW / 2, B.y + 16 + B.h + 2, { align: 'center', size: 10, color: pal.textDim, game });
}

/* ------------------------------------------------------------------ */
/* Ground item labels (Alt)                                            */
/* ------------------------------------------------------------------ */

/** Labels above every visible ground item; overlapping labels are pushed up. */
export function drawItemLabels(ctx, game) {
  const level = game.level;
  const cam = game.camera;
  if (!level || !level.items || !cam) return;
  const pal = palette(game);
  const font = fontAt(game, LABEL_SIZE);
  const labels = [];
  for (const it of level.items) {
    if (it.removed) continue;
    if (inBounds(level.tiles, it.tx, it.ty) && !level.explored[idx(level.tiles, it.tx, it.ty)]) continue;
    const w = worldPos(it);
    const s = worldToScreen(w.x, w.y, cam);
    if (s.x < -100 || s.x > uiLayout.viewW + 100 || s.y < -50 || s.y > uiLayout.hud.y + 50) continue;
    const text = it.slot === 'gold' ? `${it.count || 0} ${str(game, 'gold', 'Gold')}` : (it.count > 1 ? `${it.name} (${it.count})` : it.name || it.baseId);
    const tw = measureText(ctx, text, font) + LABEL_PAD_X * 2;
    labels.push({ item: it, text, x: s.x - tw / 2, y: s.y - LABEL_LIFT - LABEL_H, w: tw, h: LABEL_H, color: it.slot === 'gold' ? pal.gold : rarityColor(game, it) });
  }
  labels.sort((a, b) => b.y - a.y || a.x - b.x);
  const placed = [];
  for (const l of labels) {
    let moved = true;
    let guard = 0;
    while (moved && guard++ < labels.length + 2) {
      moved = false;
      for (const o of placed) {
        const overlapX = l.x < o.x + o.w && l.x + l.w > o.x;
        const overlapY = l.y < o.y + o.h + LABEL_GAP && l.y + l.h + LABEL_GAP > o.y;
        if (overlapX && overlapY) {
          l.y = o.y - l.h - LABEL_GAP;
          moved = true;
        }
      }
    }
    placed.push(l);
  }
  for (const l of placed) {
    fillRect(ctx, l, '#000', LABEL_ALPHA);
    drawText(ctx, l.text, l.x + LABEL_PAD_X, l.y + 1, { size: LABEL_SIZE, color: l.color, game, shadow: false });
    registerHit(game, l, { kind: 'itemLabel', item: l.item });
  }
}

/* ------------------------------------------------------------------ */
/* Tooltips                                                            */
/* ------------------------------------------------------------------ */

/** Normalise tooltip lines to [{text, color}]. */
function normLines(game, lines, defaultColor) {
  const pal = palette(game);
  const out = [];
  for (const ln of lines || []) {
    if (ln == null) continue;
    if (typeof ln === 'string') out.push({ text: ln, color: defaultColor || pal.text });
    else if (typeof ln === 'object') out.push({ text: String(ln.text == null ? '' : ln.text), color: ln.color || defaultColor || pal.text });
  }
  return out;
}

/** Tooltip lines for an item (itemgen.js itemTooltipLines wins). */
export function itemTooltip(game, item) {
  const pal = palette(game);
  const fromMod = call(bridge.ItemGen, 'itemTooltipLines', null, game, item);
  if (Array.isArray(fromMod)) return normLines(game, fromMod, pal.text);
  const out = [{ text: item.name || item.baseId, color: item.identified === false ? pal.text : rarityColor(game, item) }];
  if (item.dmg) out.push({ text: `${str(game, 'damage', 'Damage')}: ${item.dmg.min} - ${item.dmg.max}`, color: pal.text });
  if (typeof item.ac === 'number') out.push({ text: `${str(game, 'armor', 'Armor')}: ${item.ac}`, color: pal.text });
  if (item.dur) out.push({ text: `${str(game, 'durability', 'Dur')}: ${item.dur.cur}/${item.dur.max}`, color: pal.textDim });
  if (item.charges) out.push({ text: `${str(game, 'charges', 'Charges')}: ${item.charges.cur}/${item.charges.max}`, color: pal.textDim });
  if (item.identified === false) out.push({ text: str(game, 'notIdentified', 'Not identified'), color: pal.danger });
  else if (Array.isArray(item.affixes)) for (const a of item.affixes) out.push({ text: a.text || a.name || a.id, color: pal.accent });
  if (item.req && (item.req.str || item.req.dex || item.req.mag)) {
    const parts = [];
    if (item.req.str) parts.push(`${item.req.str} ${str(game, 'strShort', 'Str')}`);
    if (item.req.dex) parts.push(`${item.req.dex} ${str(game, 'dexShort', 'Dex')}`);
    if (item.req.mag) parts.push(`${item.req.mag} ${str(game, 'magShort', 'Mag')}`);
    const ok = call(bridge.Inventory, 'canEquip', true, game.player, item);
    out.push({ text: `${str(game, 'required', 'Required')}: ${parts.join(' ')}`, color: ok === false || (ok && ok.ok === false) ? pal.danger : pal.textDim });
  }
  if (item.count > 1) out.push({ text: `${str(game, 'count', 'Count')}: ${item.count}`, color: pal.textDim });
  return out;
}

/** Tooltip lines for a skill (skills.js skillTooltipLines wins). */
export function skillTooltip(game, skillId) {
  const pal = palette(game);
  const fromMod = call(bridge.Skills, 'skillTooltipLines', null, game, skillId);
  if (Array.isArray(fromMod)) return normLines(game, fromMod, pal.text);
  const def = skillDef(game, skillId);
  if (!def) return [{ text: skillId, color: pal.text }];
  const p = game.player;
  const lvl = (p && p.skills && p.skills[skillId]) || 0;
  const out = [{ text: def.name, color: pal.accent }];
  if (def.blurb) out.push({ text: def.blurb, color: pal.textDim });
  out.push({ text: `${str(game, 'level', 'Level')} ${lvl}   ${str(game, 'mana', 'Mana')}: ${manaCostOf(game, p, skillId)}`, color: pal.text });
  const dmg = call(bridge.Skills, 'skillDamage', null, def, (p && p.level) || 1, lvl || 1);
  if (dmg && typeof dmg.min === 'number') out.push({ text: `${str(game, 'damage', 'Damage')}: ${dmg.min} - ${dmg.max}`, color: pal.text });
  const hk = p && p.hotkeys ? p.hotkeys.indexOf(skillId) : -1;
  if (hk >= 0) out.push({ text: `${str(game, 'hotkey', 'Hotkey')}: ${hotkeyNames(game)[hk]}`, color: pal.textDim });
  return out;
}

/** Draw the tooltip for whatever UI element is hovered (item or skill). */
export function drawTooltip(ctx, game) {
  const ui = ensureUi(game);
  const hu = ui.hoverUi;
  const mouse = game.input && game.input.mouse;
  if (!hu || !mouse || ui.cursorItem) return;
  let lines = null;
  if ((hu.kind === 'invCell' || hu.kind === 'equipSlot' || hu.kind === 'belt' || hu.kind === 'vendorItem' || hu.kind === 'sellItem' || hu.kind === 'itemLabel') && hu.item) {
    lines = itemTooltip(game, hu.item);
    if (hu.kind === 'vendorItem') lines.push({ text: `${str(game, 'price', 'Price')}: ${hu.price}`, color: palette(game).gold });
    if (hu.kind === 'sellItem') lines.push({ text: `${str(game, 'sellsFor', 'Sells for')}: ${hu.price}`, color: palette(game).gold });
  } else if ((hu.kind === 'skillRow' || hu.kind === 'hotkey' || hu.kind === 'skillButton') && hu.skillId) {
    lines = skillTooltip(game, hu.skillId);
  }
  if (!lines || lines.length === 0) return;
  const box = measureTooltip(ctx, game, lines);
  const anchor = hu.itemRect || hu.rect;
  let x = mouse.x + CURSOR_OFFSET;
  let y = mouse.y + CURSOR_OFFSET;
  if (anchor && CELL_KINDS.has(hu.kind)) {
    // genre convention: centred above the slot, flipped below when there is no room
    x = anchor.x + anchor.w / 2 - box.w / 2;
    y = anchor.y - box.h - ANCHOR_GAP;
    if (y < 4) y = anchor.y + anchor.h + ANCHOR_GAP;
  } else if (anchor && ROW_KINDS.has(hu.kind)) {
    x = mouse.x + CURSOR_OFFSET;
    y = anchor.y + anchor.h + ANCHOR_GAP;
    if (y + box.h > uiLayout.viewH - 4) y = anchor.y - box.h - ANCHOR_GAP;
  } else {
    if (x + box.w > uiLayout.viewW - 4) x = mouse.x - CURSOR_OFFSET - box.w;
    if (y + box.h > uiLayout.viewH - 4) y = mouse.y - CURSOR_OFFSET - box.h;
  }
  paintTooltip(ctx, game, box, x, y);
}

/** Wrap + measure tooltip lines. @returns {{w:number,h:number,wrapped:Array}} */
function measureTooltip(ctx, game, lines) {
  const Tt = uiLayout.tooltip;
  const font = fontAt(game, TOOLTIP_SIZE);
  const wrapped = [];
  for (const ln of lines) for (const w of wrapText(ctx, ln.text, Tt.maxW - Tt.pad * 2, font)) wrapped.push({ text: w, color: ln.color });
  let w = 0;
  for (const ln of wrapped) w = Math.max(w, measureText(ctx, ln.text, font));
  return { w: w + Tt.pad * 2, h: wrapped.length * Tt.lineH + Tt.pad * 2, wrapped };
}

/** Draw a tooltip box with its top-left at (ax, ay), clamped on screen. */
export function drawTooltipBox(ctx, game, lines, ax, ay) {
  paintTooltip(ctx, game, measureTooltip(ctx, game, lines), ax, ay);
}

function paintTooltip(ctx, game, box, ax, ay) {
  const pal = palette(game);
  const Tt = uiLayout.tooltip;
  const { w, h, wrapped } = box;
  const x = Math.max(4, Math.min(uiLayout.viewW - 4 - w, ax));
  const y = Math.max(4, Math.min(uiLayout.viewH - 4 - h, ay));
  const r = { x, y, w, h };
  fillRect(ctx, r, pal.panel, TOOLTIP_ALPHA);
  ctx.strokeStyle = pal.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  wrapped.forEach((ln, i) => drawText(ctx, ln.text, r.x + Tt.pad, r.y + Tt.pad + i * Tt.lineH, { size: TOOLTIP_SIZE, color: ln.color, game }));
}

/* ------------------------------------------------------------------ */
/* Death / win                                                         */
/* ------------------------------------------------------------------ */

function pickLine(game, list, storeKey) {
  const ui = ensureUi(game);
  if (ui[storeKey]) return ui[storeKey];
  if (!Array.isArray(list) || list.length === 0) return '';
  const i = Math.abs((game.tick || 0) * 2654435761 + (game.seed | 0)) % list.length;
  ui[storeKey] = list[i];
  return ui[storeKey];
}

function screenButtons(ctx, game, defs, mx, my) {
  const total = defs.length * SCREEN_BUTTON_W + (defs.length - 1) * SCREEN_BUTTON_GAP;
  let x = (uiLayout.viewW - total) / 2;
  for (const d of defs) {
    const r = { x, y: SCREEN_BUTTON_Y, w: SCREEN_BUTTON_W, h: SCREEN_BUTTON_H };
    drawButton(ctx, r, d.label, { game, hover: pointInRect(mx, my, r) });
    registerHit(game, r, { kind: 'menuAction', action: d.action });
    x += SCREEN_BUTTON_W + SCREEN_BUTTON_GAP;
  }
}

/** "You died" screen over the world. */
export function drawDeathScreen(ctx, game) {
  const pal = palette(game);
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  const full = { x: 0, y: 0, w: uiLayout.viewW, h: uiLayout.viewH };
  fillRect(ctx, full, DEATH_TINT);
  registerHit(game, full, { kind: 'panel', name: 'death' });
  drawText(ctx, str(game, 'youDied', 'You died'), uiLayout.viewW / 2, 150, { align: 'center', size: DEATH_TITLE_SIZE, weight: 'bold', color: pal.danger, game });
  const line = game.ui.deathLine || pickLine(game, game.theme && game.theme.flavor && game.theme.flavor.deathLines, 'deathLine');
  const font = fontAt(game, 15);
  wrapText(ctx, line, 600, font).forEach((ln, i) => drawText(ctx, ln, uiLayout.viewW / 2, 210 + i * 20, { align: 'center', size: 15, color: pal.text, game }));
  const st = game.stats || {};
  const p = game.player || {};
  const summary = `${str(game, 'level', 'Level')} ${p.level || 1}   ${str(game, 'kills', 'Kills')}: ${st.kills || 0}   ${str(game, 'deepest', 'Deepest')}: ${st.deepest || 0}`;
  drawText(ctx, summary, uiLayout.viewW / 2, 260, { align: 'center', size: 12, color: pal.textDim, game });
  const hardcore = !!(game.flags && game.flags.hardcore);
  if (hardcore) drawText(ctx, str(game, 'permadeathNote', 'Permadeath: this hero is gone for good.'), uiLayout.viewW / 2, 282, { align: 'center', size: 13, color: pal.danger, game });
  screenButtons(ctx, game, hardcore ? [
    { label: str(game, 'newGame', 'New game'), action: { type: 'newGame' } },
    { label: str(game, 'quitToMenu', 'Quit to menu'), action: { type: 'quitToMenu' } },
  ] : [
    { label: str(game, 'respawn', 'Return to town'), action: { type: 'respawn' } },
    { label: str(game, 'load', 'Load game'), action: { type: 'load', slot: 0 } },
    { label: str(game, 'quitToMenu', 'Quit to menu'), action: { type: 'quitToMenu' } },
  ], mx, my);
}

/** Victory screen. */
export function drawWinScreen(ctx, game) {
  const pal = palette(game);
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  const full = { x: 0, y: 0, w: uiLayout.viewW, h: uiLayout.viewH };
  fillRect(ctx, full, WIN_TINT);
  registerHit(game, full, { kind: 'panel', name: 'win' });
  drawText(ctx, str(game, 'victory', 'Victory'), uiLayout.viewW / 2, 120, { align: 'center', size: DEATH_TITLE_SIZE, weight: 'bold', color: pal.gold, game });
  const outro = (game.theme && game.theme.flavor && game.theme.flavor.outro) || [];
  const font = fontAt(game, 14);
  let y = 185;
  for (const para of outro.slice(0, 4)) {
    for (const ln of wrapText(ctx, para, 640, font)) {
      drawText(ctx, ln, uiLayout.viewW / 2, y, { align: 'center', size: 14, color: pal.text, game });
      y += 18;
    }
    y += 6;
    if (y > SCREEN_BUTTON_Y - 30) break;
  }
  screenButtons(ctx, game, [
    { label: str(game, 'continue', 'Continue'), action: { type: 'continue' } },
    { label: str(game, 'quitToMenu', 'Quit to menu'), action: { type: 'quitToMenu' } },
  ], mx, my);
}

/* ------------------------------------------------------------------ */
/* Main menu                                                           */
/* ------------------------------------------------------------------ */

/** Main menu: title, tagline, class cards, name + seed fields, Start / Load. */
export function drawMainMenu(ctx, game) {
  const ui = ensureUi(game);
  const pal = palette(game);
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  const full = { x: 0, y: 0, w: uiLayout.viewW, h: uiLayout.viewH };
  fillRect(ctx, full, pal.bg);
  registerHit(game, full, { kind: 'panel', name: 'mainMenu' });
  const meta = (game.theme && game.theme.meta) || {};
  drawText(ctx, meta.title || str(game, 'title', 'ARPG Forge'), uiLayout.viewW / 2, 40, { align: 'center', size: TITLE_SIZE, weight: 'bold', color: pal.gold, game });
  drawText(ctx, meta.tagline || '', uiLayout.viewW / 2, 92, { align: 'center', size: TAGLINE_SIZE, color: pal.textDim, game });

  const classes = classList(game);
  const m = ui.menu;
  m.classIndex = Math.max(0, Math.min(Math.max(0, classes.length - 1), m.classIndex | 0));
  const total = classes.length * CARD_W + Math.max(0, classes.length - 1) * CARD_GAP;
  let x = (uiLayout.viewW - total) / 2;
  classes.forEach((c, i) => {
    const r = { x, y: CARD_Y, w: CARD_W, h: CARD_H };
    const sel = i === m.classIndex;
    const hover = pointInRect(mx, my, r);
    drawPanel(ctx, r, { game, alpha: sel ? 1 : 0.8 });
    if (sel || hover) {
      ctx.strokeStyle = sel ? pal.accent : pal.text;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    drawText(ctx, c.name || c.id, r.x + r.w / 2, r.y + 10, { align: 'center', size: 16, weight: 'bold', color: sel ? pal.accent : pal.text, game });
    const look = c.look || {};
    drawActor(ctx, r.x + r.w / 2, r.y + CARD_ACTOR_FEET_Y, { silhouette: look.silhouette || 'bulky', bodyColor: look.bodyColor || pal.textDim, trimColor: look.trimColor || pal.panelBorder }, { dir: 0, anim: 'stand', scale: CARD_ACTOR_SCALE });
    const font = fontAt(game, 11);
    wrapText(ctx, c.blurb || '', r.w - 20, font).slice(0, CARD_BLURB_LINES).forEach((ln, j) => drawText(ctx, ln, r.x + r.w / 2, r.y + CARD_BLURB_Y + j * 14, { align: 'center', size: 11, color: pal.textDim, game }));
    const b = c.base || {};
    drawText(ctx, `${str(game, 'strShort', 'Str')} ${b.str || 0}  ${str(game, 'magShort', 'Mag')} ${b.mag || 0}  ${str(game, 'dexShort', 'Dex')} ${b.dex || 0}  ${str(game, 'vitShort', 'Vit')} ${b.vit || 0}`, r.x + r.w / 2, r.y + r.h - 18, { align: 'center', size: 10, color: pal.text, game });
    registerHit(game, r, { kind: 'menuClass', index: i, classId: c.id });
    x += CARD_W + CARD_GAP;
  });
  if (classes.length === 0) drawText(ctx, str(game, 'noClasses', 'No classes in theme'), uiLayout.viewW / 2, CARD_Y + 40, { align: 'center', color: pal.danger, game });

  const caret = Math.floor((game.tick || Date.now() / 50) / CARET_BLINK_TICKS) % 2 === 0 ? '|' : '';
  drawField(ctx, game, str(game, 'name', 'Name'), m.name, 'name', FIELD_Y, m.focus === 'name' ? caret : '', mx, my);
  drawField(ctx, game, str(game, 'seed', 'Seed'), m.seed, 'seed', FIELD_Y + FIELD_H + FIELD_GAP, m.focus === 'seed' ? caret : '', mx, my);

  const diffNames = (game.balance && game.balance.monsters && game.balance.monsters.difficultyNames) || ['normal', 'veteran', 'elite'];
  m.difficulty = Math.max(0, Math.min(diffNames.length - 1, m.difficulty | 0));
  const dn = diffNames[m.difficulty];
  const toggles = [
    { toggle: 'difficulty', label: `${str(game, 'difficulty', 'Difficulty')}: ${str(game, `difficulty_${dn}`, dn[0].toUpperCase() + dn.slice(1))}`, on: m.difficulty > 0 },
    { toggle: 'hardcore', label: `${str(game, 'hardcore', 'Permadeath')}: ${m.hardcore ? str(game, 'on', 'On') : str(game, 'off', 'Off')}`, on: !!m.hardcore },
  ];
  toggles.forEach((t, i) => {
    const r = { x: (uiLayout.viewW + FIELD_W) / 2 + TOGGLE_GAP + 30, y: FIELD_Y + i * (FIELD_H + FIELD_GAP), w: TOGGLE_W, h: FIELD_H };
    drawButton(ctx, r, t.label, { game, hover: pointInRect(mx, my, r), size: 12 });
    if (t.on) { ctx.strokeStyle = t.toggle === 'hardcore' ? pal.danger : pal.accent; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
    registerHit(game, r, { kind: 'menuToggle', toggle: t.toggle, count: diffNames.length });
  });

  const cls = classes[m.classIndex];
  const startR = { x: uiLayout.viewW / 2 - BIG_BUTTON_W - 10, y: MENU_BUTTONS_Y, w: BIG_BUTTON_W, h: BIG_BUTTON_H };
  const loadR = { x: uiLayout.viewW / 2 + 10, y: MENU_BUTTONS_Y, w: BIG_BUTTON_W, h: BIG_BUTTON_H };
  drawButton(ctx, startR, str(game, 'start', 'Start'), { game, hover: pointInRect(mx, my, startR), disabled: !cls, size: 15 });
  drawButton(ctx, loadR, str(game, 'load', 'Load game'), { game, hover: pointInRect(mx, my, loadR), size: 15 });
  registerHit(game, startR, { kind: 'menuStart' });
  registerHit(game, loadR, { kind: 'menuAction', action: { type: 'load', slot: 0 } });
  drawText(ctx, str(game, 'menuHint', 'Click a field to type. Enter starts.'), uiLayout.viewW / 2, MENU_BUTTONS_Y + BIG_BUTTON_H + 14, { align: 'center', size: 11, color: pal.textDim, game });
  if (meta.version) drawText(ctx, `v${meta.version}`, uiLayout.viewW - 10, uiLayout.viewH - 18, { align: 'right', size: 10, color: pal.textDim, game });
}

function drawField(ctx, game, label, value, field, y, caret, mx, my) {
  const pal = palette(game);
  const r = { x: (uiLayout.viewW - FIELD_W) / 2 + 30, y, w: FIELD_W, h: FIELD_H };
  const focused = game.ui.menu.focus === field;
  drawText(ctx, `${label}:`, r.x - 10, y + 5, { align: 'right', size: 13, color: pal.textDim, game });
  fillRect(ctx, r, '#000', 0.5);
  ctx.strokeStyle = focused ? pal.accent : pal.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  const shown = value || '';
  drawText(ctx, shown + caret, r.x + 8, y + 5, { size: 13, color: shown ? pal.text : pal.textDim, game, maxW: r.w - 16 });
  if (!shown && !caret) drawText(ctx, field === 'name' ? str(game, 'namePlaceholder', 'Hero') : str(game, 'seedPlaceholder', 'random'), r.x + 8, y + 5, { size: 13, color: mix(pal.textDim, pal.panel, 0.4), game });
  registerHit(game, r, { kind: 'menuField', field });
}

/** Limits used by the key handler when typing into the menu fields. */
export const FIELD_LIMITS = { name: NAME_MAX, seed: SEED_MAX };

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/** Loading screen: game.ui.loading = { title?, text?, progress?, tip? }. */
export function drawLoadingScreen(ctx, game) {
  const ui = ensureUi(game);
  const pal = palette(game);
  const ld = ui.loading || {};
  const full = { x: 0, y: 0, w: uiLayout.viewW, h: uiLayout.viewH };
  fillRect(ctx, full, pal.bg);
  registerHit(game, full, { kind: 'panel', name: 'loading' });
  drawText(ctx, ld.title || str(game, 'loading', 'Loading...'), uiLayout.viewW / 2, 200, { align: 'center', size: 26, weight: 'bold', color: pal.gold, game });
  if (ld.text) drawText(ctx, ld.text, uiLayout.viewW / 2, 240, { align: 'center', size: 14, color: pal.text, game });
  if (typeof ld.progress === 'number') drawBar(ctx, { x: (uiLayout.viewW - LOADING_BAR_W) / 2, y: 268, w: LOADING_BAR_W, h: 10 }, ld.progress, { color: pal.accent, game });
  const tips = game.theme && game.theme.flavor && game.theme.flavor.loadingTips;
  const tip = ld.tip || pickLine(game, tips, 'loadingTip');
  if (tip) {
    const font = fontAt(game, 13);
    wrapText(ctx, `${str(game, 'tip', 'Tip')}: ${tip}`, 600, font).forEach((ln, i) => drawText(ctx, ln, uiLayout.viewW / 2, 320 + i * 18, { align: 'center', size: 13, color: pal.textDim, game }));
  }
}

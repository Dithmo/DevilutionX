/**
 * Vendor screen (640x420, left-anchored so the inventory stays visible on
 * the right) with Buy / Sell / Services tabs, and the NPC dialogue box.
 *
 * game.ui.vendor   = npcId of the open vendor (resolved with findNpc)
 * game.ui.dialogue = { npc|npcId, name?, title?, lines:[string], options:[{label|text, action(game), keepOpen?}] }
 */
import { uiLayout } from './layout.js';
import {
  palette, str, drawPanel, drawButton, drawText, drawSlot, drawItemInRect, drawSeparator,
  registerHit, pointInRect, rarityColor, wrapText, fontAt, fillRect,
} from './widgets.js';
import { ensureUi, bridge, call, findNpc } from './state.js';
import { formatNumber } from './hud.js';
import { slotAccepts } from './panels.js';

const TABS = [
  { id: 'buy', key: 'buy', fallback: 'Buy' },
  { id: 'sell', key: 'sell', fallback: 'Sell' },
  { id: 'services', key: 'services', fallback: 'Services' },
];
const TAB_W = 110;
const TAB_H = 24;
const TAB_Y = 34;
const LIST_Y = 68;
const ROW_H = 32;
const ROWS_PER_PAGE = 9;
const ICON = 26;
const CLOSE_W = 60;
const CLOSE_H = 20;
const FOOTER_H = 30;
const PAGE_BTN_W = 26;
const PAGE_BTN_H = 18;
const SERVICE_BTN_H = 34;
const SERVICE_BTN_GAP = 10;
const SERVICE_BTN_W = 260;
const DIALOGUE_LINE_H = 18;
const DIALOGUE_SIZE = 14;
const OPTION_H = 24;
const OPTION_GAP = 6;
const MSG_TTL_FADE = 40;
const KNOWN_SERVICES = {
  heal: { key: 'serviceHeal', fallback: 'Heal', fn: 'serviceHeal' },
  identify: { key: 'serviceIdentify', fallback: 'Identify', fn: 'serviceIdentify' },
  repair: { key: 'serviceRepair', fallback: 'Repair', fn: 'serviceRepair' },
  recharge: { key: 'serviceRecharge', fallback: 'Recharge', fn: 'serviceRecharge' },
};

/** Buy price of an item (item.price.buy, else itemgen priceOf). */
export function buyPrice(item) {
  if (item && item.price && typeof item.price.buy === 'number') return item.price.buy;
  const p = call(bridge.ItemGen, 'priceOf', null, item);
  if (typeof p === 'number') return p;
  return typeof item.price === 'number' ? item.price : 0;
}

/** Sell price of an item (item.price.sell, else a quarter of buy). */
export function sellPrice(item) {
  if (item && item.price && typeof item.price.sell === 'number') return item.price.sell;
  return Math.max(1, Math.floor(buyPrice(item) / 4));
}

/**
 * Services an NPC offers: [{id, label, cost, run(game, npc)}].
 * npcs.js `services(game, npc)` wins; else built from npc.services ids.
 */
export function npcServices(game, npc) {
  if (!npc) return [];
  const fromMod = call(bridge.Npcs, 'services', null, game, npc);
  if (Array.isArray(fromMod)) {
    return fromMod.map((s) => ({
      id: s.id || s.type,
      label: s.label || s.name || str(game, KNOWN_SERVICES[s.id] ? KNOWN_SERVICES[s.id].key : s.id, (KNOWN_SERVICES[s.id] && KNOWN_SERVICES[s.id].fallback) || s.id),
      cost: typeof s.cost === 'number' ? s.cost : null,
      run: typeof s.run === 'function' ? s.run : typeof s.action === 'function' ? s.action : null,
    }));
  }
  const ids = npc.services || (npc.def && npc.def.services) || [];
  return ids.map((id) => {
    const known = KNOWN_SERVICES[id] || { key: id, fallback: id, fn: null };
    const cost = (npc.serviceCosts && npc.serviceCosts[id]);
    return {
      id,
      label: str(game, known.key, known.fallback),
      cost: typeof cost === 'number' ? cost : null,
      run: known.fn ? (g, n, item) => (id === 'heal' ? call(bridge.Npcs, known.fn, false, g, n) : call(bridge.Npcs, known.fn, false, g, item, n)) : null,
    };
  });
}

/** Rect of the vendor screen. */
export function vendorRect() {
  return uiLayout.vendor;
}

/** Draw the vendor screen when game.ui.vendor is set. */
export function drawVendor(ctx, game) {
  const ui = ensureUi(game);
  const pal = palette(game);
  const npc = findNpc(game, ui.vendor);
  const r = uiLayout.vendor;
  const p = game.player;
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  const title = npc ? `${npc.name || npc.npcId}${npc.title ? ` — ${npc.title}` : ''}` : str(game, 'vendor', 'Vendor');
  drawPanel(ctx, r, { game, title });
  registerHit(game, r, { kind: 'panel', name: 'vendor' });
  const closeR = { x: r.x + r.w - CLOSE_W - 10, y: r.y + 8, w: CLOSE_W, h: CLOSE_H };
  drawButton(ctx, closeR, str(game, 'close', 'Close'), { game, hover: pointInRect(mx, my, closeR), size: 11 });
  registerHit(game, closeR, { kind: 'close', name: 'vendor' });

  // tabs
  const tabs = TABS.filter((t) => t.id !== 'services' || npcServices(game, npc).length > 0);
  tabs.forEach((t, i) => {
    const tr = { x: r.x + 16 + i * (TAB_W + 6), y: r.y + TAB_Y, w: TAB_W, h: TAB_H };
    drawButton(ctx, tr, str(game, t.key, t.fallback), { game, hover: pointInRect(mx, my, tr), active: ui.vendorTab === t.id });
    registerHit(game, tr, { kind: 'vendorTab', tab: t.id });
  });
  drawSeparator(ctx, r.x + 10, r.x + r.w - 10, r.y + TAB_Y + TAB_H + 6, game);

  if (ui.vendorTab === 'sell') drawSellTab(ctx, game, npc, r, mx, my);
  else if (ui.vendorTab === 'services') drawServicesTab(ctx, game, npc, r, mx, my);
  else drawBuyTab(ctx, game, npc, r, mx, my);

  // footer: gold + message
  const fy = r.y + r.h - FOOTER_H;
  drawSeparator(ctx, r.x + 10, r.x + r.w - 10, fy - 4, game);
  drawText(ctx, `${str(game, 'gold', 'Gold')}: ${formatNumber(p ? p.gold || 0 : 0)}`, r.x + 16, fy + 6, { color: pal.gold, size: 13, game });
  const msg = ui.vendorMsg;
  if (msg && msg.text) {
    const alpha = msg.ttl == null ? 1 : Math.max(0, Math.min(1, msg.ttl / MSG_TTL_FADE));
    drawText(ctx, msg.text, r.x + r.w - 16, fy + 6, { align: 'right', color: msg.color || pal.text, size: 13, game, alpha, maxW: r.w - 160 });
  }
}

function listRows(ctx, game, r, items, mx, my, kind, priceOf, priceColorFn) {
  const ui = game.ui;
  const pal = palette(game);
  const pages = Math.max(1, Math.ceil(items.length / ROWS_PER_PAGE));
  ui.vendorPage = Math.max(0, Math.min(pages - 1, ui.vendorPage | 0));
  const start = ui.vendorPage * ROWS_PER_PAGE;
  const p = game.player;
  for (let i = 0; i < ROWS_PER_PAGE; i++) {
    const item = items[start + i];
    if (!item) break;
    const row = { x: r.x + 16, y: r.y + LIST_Y + i * ROW_H, w: r.w - 32, h: ROW_H - 2 };
    const hover = pointInRect(mx, my, row);
    if (hover) fillRect(ctx, row, pal.panelBorder, 0.18);
    const iconR = { x: row.x + 2, y: row.y + (row.h - ICON) / 2, w: ICON, h: ICON };
    drawSlot(ctx, iconR, { game, item });
    drawItemInRect(ctx, item, iconR);
    let nameColor = item.identified === false ? pal.text : rarityColor(game, item);
    if (p && item.slot && item.slot !== 'consumable' && item.slot !== 'scroll' && item.slot !== 'tome' && item.slot !== 'gold' && item.slot !== 'quest') {
      const okEquip = slotAccepts(game, p, item, item.slot === 'ring' ? 'ring1' : item.slot);
      if (!okEquip) nameColor = pal.danger;
    }
    const label = item.count > 1 ? `${item.name} (${item.count})` : item.name;
    drawText(ctx, label, iconR.x + ICON + 10, row.y + 4, { color: nameColor, size: 13, game, maxW: row.w - 200 });
    drawText(ctx, itemSubline(game, item), iconR.x + ICON + 10, row.y + 18, { color: pal.textDim, size: 10, game, maxW: row.w - 200 });
    const price = priceOf(item);
    drawText(ctx, formatNumber(price), row.x + row.w - 8, row.y + 8, { align: 'right', color: priceColorFn(price), size: 13, game });
    registerHit(game, row, { kind, item, price });
  }
  if (items.length === 0) {
    drawText(ctx, str(game, 'nothingHere', 'Nothing here'), r.x + r.w / 2, r.y + LIST_Y + 20, { align: 'center', color: pal.textDim, game });
  }
  if (pages > 1) {
    const py = r.y + LIST_Y + ROWS_PER_PAGE * ROW_H + 2;
    const prevR = { x: r.x + r.w / 2 - 60, y: py, w: PAGE_BTN_W, h: PAGE_BTN_H };
    const nextR = { x: r.x + r.w / 2 + 34, y: py, w: PAGE_BTN_W, h: PAGE_BTN_H };
    drawButton(ctx, prevR, '<', { game, hover: pointInRect(mx, my, prevR), disabled: ui.vendorPage === 0 });
    drawButton(ctx, nextR, '>', { game, hover: pointInRect(mx, my, nextR), disabled: ui.vendorPage >= pages - 1 });
    registerHit(game, prevR, { kind: 'vendorPage', dir: -1 });
    registerHit(game, nextR, { kind: 'vendorPage', dir: 1 });
    drawText(ctx, `${ui.vendorPage + 1} / ${pages}`, r.x + r.w / 2, py + 2, { align: 'center', size: 11, color: pal.textDim, game });
  }
}

function itemSubline(game, item) {
  const parts = [];
  if (item.dmg) parts.push(`${str(game, 'dmg', 'Dmg')} ${item.dmg.min}-${item.dmg.max}`);
  if (typeof item.ac === 'number') parts.push(`${str(game, 'ac', 'AC')} ${item.ac}`);
  if (item.req) {
    const req = [];
    if (item.req.str) req.push(`${item.req.str} ${str(game, 'strShort', 'Str')}`);
    if (item.req.dex) req.push(`${item.req.dex} ${str(game, 'dexShort', 'Dex')}`);
    if (item.req.mag) req.push(`${item.req.mag} ${str(game, 'magShort', 'Mag')}`);
    if (req.length) parts.push(`${str(game, 'required', 'Req')}: ${req.join(' ')}`);
  }
  if (item.identified === false) parts.push(str(game, 'notIdentified', 'Not identified'));
  return parts.join('   ');
}

function drawBuyTab(ctx, game, npc, r, mx, my) {
  const pal = palette(game);
  const gold = game.player ? game.player.gold || 0 : 0;
  const stock = (npc && npc.stock) || [];
  listRows(ctx, game, r, stock, mx, my, 'vendorItem', buyPrice, (price) => (price > gold ? pal.danger : pal.gold));
}

function drawSellTab(ctx, game, npc, r, mx, my) {
  const pal = palette(game);
  const p = game.player;
  const inv = p && p.inventory;
  const items = [];
  if (inv && inv.items) {
    const seen = new Set();
    for (let i = 0; i < inv.cells.length; i++) {
      const id = inv.cells[i];
      if (!id || seen.has(id) || !inv.items[id]) continue;
      seen.add(id);
      if (inv.items[id].slot === 'quest') continue;
      items.push(inv.items[id]);
    }
  }
  listRows(ctx, game, r, items, mx, my, 'sellItem', sellPrice, () => pal.gold);
  drawText(ctx, str(game, 'sellHint', 'Shift-click an item to sell'), r.x + r.w - 16, r.y + TAB_Y + 5, { align: 'right', color: pal.textDim, size: 11, game, maxW: 240 });
}

function drawServicesTab(ctx, game, npc, r, mx, my) {
  const pal = palette(game);
  const gold = game.player ? game.player.gold || 0 : 0;
  const services = npcServices(game, npc);
  let y = r.y + LIST_Y + 6;
  for (const s of services) {
    const br = { x: r.x + (r.w - SERVICE_BTN_W) / 2, y, w: SERVICE_BTN_W, h: SERVICE_BTN_H };
    const unaffordable = typeof s.cost === 'number' && s.cost > gold;
    const label = typeof s.cost === 'number' ? `${s.label}  —  ${formatNumber(s.cost)} ${str(game, 'gold', 'Gold')}` : s.label;
    drawButton(ctx, br, label, { game, hover: pointInRect(mx, my, br), disabled: unaffordable, size: 13 });
    registerHit(game, br, { kind: 'service', service: s });
    y += SERVICE_BTN_H + SERVICE_BTN_GAP;
  }
  if (services.length === 0) drawText(ctx, str(game, 'noServices', 'No services'), r.x + r.w / 2, y, { align: 'center', color: pal.textDim, game });
  if (game.ui.cursorItem) drawText(ctx, str(game, 'serviceItemHint', 'The held item will be used for item services'), r.x + r.w / 2, y + 10, { align: 'center', color: pal.textDim, size: 11, game });
}

/* ------------------------------------------------------------------ */
/* Dialogue                                                            */
/* ------------------------------------------------------------------ */

/** Draw the dialogue box when game.ui.dialogue is set. */
export function drawDialogue(ctx, game) {
  const ui = ensureUi(game);
  const d = ui.dialogue;
  if (!d) return;
  const pal = palette(game);
  const npc = findNpc(game, d.npc || d.npcId);
  const name = d.name || (npc && npc.name) || str(game, 'npc', 'NPC');
  const title = d.title || (npc && npc.title) || '';
  const lines = Array.isArray(d.lines) ? d.lines : d.text ? [d.text] : [];
  const options = Array.isArray(d.options) ? d.options : [];
  const font = fontAt(game, DIALOGUE_SIZE);
  const textW = uiLayout.dialogue.w - 48;
  const wrapped = [];
  for (const ln of lines) wrapped.push(...wrapText(ctx, ln, textW, font));
  const textH = Math.max(DIALOGUE_LINE_H, wrapped.length * DIALOGUE_LINE_H);
  const optH = options.length * (OPTION_H + OPTION_GAP);
  const h = Math.max(uiLayout.dialogue.h, 56 + textH + 14 + optH + 10);
  const r = { x: uiLayout.dialogue.x, y: Math.max(8, Math.floor((uiLayout.hud.y - h) / 2)), w: uiLayout.dialogue.w, h };
  const mouse = game.input && game.input.mouse;
  const mx = mouse ? mouse.x : -1;
  const my = mouse ? mouse.y : -1;
  drawPanel(ctx, r, { game });
  registerHit(game, r, { kind: 'panel', name: 'dialogue' });
  drawText(ctx, name, r.x + 24, r.y + 14, { color: pal.gold, size: 16, weight: 'bold', game });
  if (title) drawText(ctx, title, r.x + 24 + 10 + ctxWidth(ctx, name, fontAt(game, 16, 'bold')), r.y + 17, { color: pal.textDim, size: 12, game });
  drawSeparator(ctx, r.x + 16, r.x + r.w - 16, r.y + 38, game);
  wrapped.forEach((ln, i) => drawText(ctx, ln, r.x + 24, r.y + 50 + i * DIALOGUE_LINE_H, { color: pal.text, size: DIALOGUE_SIZE, game }));
  let y = r.y + h - 10 - optH;
  options.forEach((opt, i) => {
    const br = { x: r.x + 24, y, w: r.w - 48, h: OPTION_H };
    const label = `${i + 1}. ${opt.label || opt.text || opt.id || '...'}`;
    drawButton(ctx, br, label, { game, hover: pointInRect(mx, my, br), size: 13 });
    registerHit(game, br, { kind: 'dialogOption', option: opt, index: i });
    y += OPTION_H + OPTION_GAP;
  });
  if (options.length === 0) drawText(ctx, str(game, 'clickToContinue', 'Click to continue'), r.x + r.w / 2, r.y + h - 24, { align: 'center', color: pal.textDim, size: 11, game });
}

function ctxWidth(ctx, text, font) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

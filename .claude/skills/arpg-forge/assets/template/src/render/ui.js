/**
 * UI barrel: renders every HUD / panel / overlay from `game.ui` state and
 * routes input against the hit registry filled during the last render.
 *
 *   renderUi(ctx, game)                       draw everything (after renderWorld)
 *   updateUi(game)                            per tick: ttl of floats / messages, hover, viewInset
 *   uiHandleClick(game, x, y, button, mods)   -> consumed:boolean
 *   uiHandleKey(game, key)                    -> consumed:boolean  (normalised key, see core/input)
 *   uiHitTest(game, x, y)                     -> {kind, ...} | null
 *   uiLayout                                  geometry constants
 *
 * Panel state lives in game.ui (see ui/state.js for the full field list):
 * ui.left ('character'|'skills'|'quests'), ui.right ('inventory'), ui.vendor,
 * ui.dialogue, ui.automap, ui.menuOpen, ui.cursorItem, ui.viewInset.
 * Other systems open things with openPanel / openVendor / addMessage / addFloat
 * or by emitting `message` / `float` on game.bus.
 */
import { getTileAtScreen, getEntityAtScreen } from './iso.js';
import { uiLayout } from './ui/layout.js';
import { beginHits, hitAt } from './ui/widgets.js';
import { ensureUi, updateViewInset, openPanel, closePanel, togglePanel, closeAll, openVendor, addMessage, addFloat } from './ui/state.js';
import { drawHud } from './ui/hud.js';
import { drawInventory, drawCharacter, drawSkills, drawQuests, drawAutomap, drawMenu, drawCursorItem } from './ui/panels.js';
import { drawVendor, drawDialogue } from './ui/vendor.js';
import { drawFloats, drawMonsterBar, drawItemLabels, drawTooltip, drawDeathScreen, drawWinScreen, drawMainMenu, drawLoadingScreen } from './ui/overlays.js';
import { uiHandleClick, uiHandleKey, uiHitTest } from './ui/actions.js';

const ALT_KEYS = ['Alt', 'AltGraph'];
const MSG_TTL_STEP = 1;

/**
 * Draw the UI. Call after renderWorld, once per frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 */
export function renderUi(ctx, game) {
  const ui = ensureUi(game);
  beginHits(game);
  ctx.save();
  ctx.textBaseline = 'top';
  if (ui.loading) {
    drawLoadingScreen(ctx, game);
    ctx.restore();
    return;
  }
  if (game.mode === 'menu') {
    drawMainMenu(ctx, game);
    ctx.restore();
    updateViewInset(game);
    return;
  }
  drawFloats(ctx, game);
  if (ui.showLabels || altHeld(game)) drawItemLabels(ctx, game);
  drawMonsterBar(ctx, game);
  if (ui.automap) drawAutomap(ctx, game);
  drawHud(ctx, game);
  if (ui.vendor) drawVendor(ctx, game);
  else if (ui.left === 'character') drawCharacter(ctx, game);
  else if (ui.left === 'skills') drawSkills(ctx, game);
  else if (ui.left === 'quests') drawQuests(ctx, game);
  if (ui.right === 'inventory') drawInventory(ctx, game);
  if (ui.dialogue) drawDialogue(ctx, game);
  if (ui.menuOpen) drawMenu(ctx, game);
  if (game.mode === 'dead') drawDeathScreen(ctx, game);
  else if (game.mode === 'win') drawWinScreen(ctx, game);
  drawTooltip(ctx, game);
  drawCursorItem(ctx, game);
  ctx.restore();
  updateViewInset(game);
}

function altHeld(game) {
  const input = game.input;
  if (!input || typeof input.isDown !== 'function') return false;
  return ALT_KEYS.some((k) => input.isDown(k));
}

/**
 * Per-tick UI bookkeeping: expire floats / messages / vendor message,
 * compute hover (UI element first, then world entity, then tile) and the
 * view inset used by the world renderer.
 */
export function updateUi(game) {
  const ui = ensureUi(game);
  for (let i = ui.floats.length - 1; i >= 0; i--) {
    ui.floats[i].ttl -= MSG_TTL_STEP;
    if (ui.floats[i].ttl <= 0) ui.floats.splice(i, 1);
  }
  for (let i = ui.messages.length - 1; i >= 0; i--) {
    ui.messages[i].ttl -= MSG_TTL_STEP;
    if (ui.messages[i].ttl <= 0) ui.messages.splice(i, 1);
  }
  if (ui.vendorMsg && typeof ui.vendorMsg.ttl === 'number') {
    ui.vendorMsg.ttl -= MSG_TTL_STEP;
    if (ui.vendorMsg.ttl <= 0) ui.vendorMsg = null;
  }
  const mouse = game.input && game.input.mouse;
  ui.hoverUi = null;
  ui.hover = null;
  if (mouse && mouse.inside !== false) {
    const hit = hitAt(game, mouse.x, mouse.y);
    if (hit) ui.hoverUi = { ...hit.payload, rect: hit.rect };
    const playing = game.mode !== 'menu' && !ui.loading && !ui.menuOpen;
    if (!hit && playing && game.level) {
      const ent = getEntityAtScreen(game, mouse.x, mouse.y);
      if (ent) ui.hover = { kind: ent.type, id: ent.entity.id, entity: ent.entity };
      ui.hoverTile = getTileAtScreen(game, mouse.x, mouse.y);
    } else if (hit) {
      ui.hoverTile = null;
    }
  }
  updateViewInset(game);
}

export { uiHandleClick, uiHandleKey, uiHitTest, uiLayout };
export { openPanel, closePanel, togglePanel, closeAll, openVendor, addMessage, addFloat };

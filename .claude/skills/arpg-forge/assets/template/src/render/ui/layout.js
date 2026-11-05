/**
 * UI geometry for the 960x540 logical view. Every rect is in logical pixels.
 *
 * Genre conventions reproduced: a bottom control panel with two globes
 * flanking the belt / buttons / info box, 320x400 side panels that overlay
 * the left (character, skills, quests, vendor) or right (inventory) half of
 * the world view, and a thin XP strip above the panel.
 */

export const VIEW_W = 960;
export const VIEW_H = 540;
const HUD_H = 110;
const HUD_Y = VIEW_H - HUD_H;
const SIDE_W = 320;
const SIDE_H = 400;
const SIDE_Y = Math.floor((HUD_Y - SIDE_H) / 2);
const BUTTON_W = 68;
const BUTTON_H = 20;
const BUTTON_GAP = 4;
const CELL = 29;
const BELT_CELL = 34;
const BELT_GAP = 3;
const GLOBE_R = 44;
const GLOBE_CY = HUD_Y + 56;
const CENTRE_W = 300;
const CENTRE_X = (VIEW_W - CENTRE_W) / 2;
const VENDOR_W = 640;
const VENDOR_H = 420;
const DIALOGUE_W = 640;
const DIALOGUE_H = 220;
const MENU_W = 300;
const MENU_H = 320;
const EQUIP_SHIFT = 10; // keeps the head slot clear of the panel title

export const uiLayout = Object.freeze({
  viewW: VIEW_W,
  viewH: VIEW_H,
  hud: { x: 0, y: HUD_Y, w: VIEW_W, h: HUD_H },
  xpBar: { x: CENTRE_X, y: HUD_Y - 7, w: CENTRE_W, h: 5 },
  lifeGlobe: { cx: 60, cy: GLOBE_CY, r: GLOBE_R },
  manaGlobe: { cx: VIEW_W - 60, cy: GLOBE_CY, r: GLOBE_R },
  /** 4 rows: character, quests, map, menu */
  leftButtons: { x: 112, y: HUD_Y + 8, w: BUTTON_W, h: BUTTON_H, gap: BUTTON_GAP },
  /** 2 rows: inventory, skills */
  rightButtons: { x: 636, y: HUD_Y + 8, w: BUTTON_W, h: BUTTON_H, gap: BUTTON_GAP },
  levelUpButton: { x: 792, y: HUD_Y - 26, w: BUTTON_W, h: 18 },
  infoBox: { x: CENTRE_X, y: HUD_Y + 6, w: CENTRE_W, h: 46 },
  belt: { x: CENTRE_X + 4, y: HUD_Y + 58, cell: BELT_CELL, gap: BELT_GAP, count: 8 },
  hotkeys: { x: 636, y: HUD_Y + 58, cell: BELT_CELL, gap: BELT_GAP, count: 4 },
  skillButton: { x: 792, y: HUD_Y + 10, w: 52, h: 52 },
  goldText: { x: 712, y: HUD_Y + 14, w: 74 },
  messages: { x: 12, y: HUD_Y - 12, lines: 4, lineH: 14, ttl: 200, fade: 40 },
  leftPanel: { x: 0, y: SIDE_Y, w: SIDE_W, h: SIDE_H },
  rightPanel: { x: VIEW_W - SIDE_W, y: SIDE_Y, w: SIDE_W, h: SIDE_H },
  vendor: { x: 0, y: 5, w: VENDOR_W, h: VENDOR_H },
  dialogue: { x: (VIEW_W - DIALOGUE_W) / 2, y: Math.floor((HUD_Y - DIALOGUE_H) / 2), w: DIALOGUE_W, h: DIALOGUE_H },
  menu: { x: (VIEW_W - MENU_W) / 2, y: Math.floor((HUD_Y - MENU_H) / 2), w: MENU_W, h: MENU_H },
  monsterBar: { y: 12, w: 280, h: 14 },
  cell: CELL,
  /** Inventory panel, panel-local rects. */
  inventory: {
    grid: { x: 15, y: 236 + EQUIP_SHIFT, cols: 10, rows: 4 },
    equip: {
      head: { x: 132, y: 16 + EQUIP_SHIFT, w: 58, h: 58 },
      amulet: { x: 205, y: 46 + EQUIP_SHIFT, w: 28, h: 28 },
      weapon: { x: 17, y: 89 + EQUIP_SHIFT, w: 58, h: 87 },
      body: { x: 132, y: 89 + EQUIP_SHIFT, w: 58, h: 87 },
      offhand: { x: 248, y: 89 + EQUIP_SHIFT, w: 58, h: 87 },
      ring1: { x: 47, y: 191 + EQUIP_SHIFT, w: 28, h: 28 },
      ring2: { x: 248, y: 191 + EQUIP_SHIFT, w: 28, h: 28 },
    },
    goldY: 366 + EQUIP_SHIFT,
  },
  character: { rowH: 17, labelX: 14, baseX: 196, nowX: 268, plusX: 226, plusW: 20, plusH: 14 },
  skills: { rowY: 30, rowH: 46, perPage: 7, iconSize: 36 },
  quests: { rowY: 30, rowH: 20, maxRows: 9, detailY: 222 },
  automap: { scale: 1 / 8, alpha: 0.72 },
  floats: { ttl: 50, rise: 40, mergeTicks: 2 },
  tooltip: { pad: 8, lineH: 15, maxW: 300 },
});

/** Rect for the i-th belt or hotkey slot. */
export function slotRect(strip, i) {
  return { x: strip.x + i * (strip.cell + strip.gap), y: strip.y, w: strip.cell, h: strip.cell };
}

/** Rect for the i-th button in a vertical button column. */
export function columnButtonRect(col, i) {
  return { x: col.x, y: col.y + i * (col.h + col.gap), w: col.w, h: col.h };
}

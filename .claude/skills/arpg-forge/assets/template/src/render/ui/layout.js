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
/**
 * The HUD is an ornamented bar, not a full-width rectangle: the solid bar body
 * starts at HUD_TOP; globes, their horn frames, the button tabs and the level
 * medallion rise above it (up to HUD_ART_TOP) with the world visible in between.
 */
const HUD_TOP = 474;
const HUD_H = VIEW_H - HUD_TOP;
const HUD_ART_TOP = 390;
const PANEL_FLOOR = 430; // side panels / dialogs are centred above this line
const SIDE_W = 320;
const SIDE_H = 400;
const SIDE_Y = Math.floor((PANEL_FLOOR - SIDE_H) / 2);
const TAB_W = 62;
const TAB_H = 17;
const TAB_GAP = 6;
const TAB_Y = HUD_TOP - TAB_H - 1;
const MEDALLION_W = 52;
const CELL = 29;
const BELT_CELL = 36;
const BELT_GAP = 4;
const SLOT_Y = HUD_TOP + 16;
const GLOBE_R = 52;
const GLOBE_CY = HUD_TOP + 6;
const GLOBE_CX = 100;
const CENTRE_W = 300;
const CENTRE_X = (VIEW_W - CENTRE_W) / 2;
const MID = VIEW_W / 2;
const LEFT_TABS_X = MID - MEDALLION_W / 2 - 3 * TAB_W - 2 * TAB_GAP;
const RIGHT_TABS_X = MID + MEDALLION_W / 2;
const BELT_X = 237;
const HOTKEYS_X = BELT_X + 8 * (BELT_CELL + BELT_GAP) - BELT_GAP + 14;
const SKILL_SIZE = 44;
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
  hud: { x: 0, y: HUD_TOP, w: VIEW_W, h: HUD_H },
  /** Top of the ornaments (horns, tabs, medallion) that rise above the bar. */
  hudArtTop: HUD_ART_TOP,
  /** Solid bar body between the two globe sockets. */
  bar: { x: 108, y: HUD_TOP, w: VIEW_W - 216, h: HUD_H },
  /** Click-swallowing boxes around each globe's horn frame. */
  lifeFrame: { x: 0, y: GLOBE_CY - GLOBE_R - 22, w: GLOBE_CX + GLOBE_R + 12, h: VIEW_H - (GLOBE_CY - GLOBE_R - 22) },
  manaFrame: { x: VIEW_W - GLOBE_CX - GLOBE_R - 12, y: GLOBE_CY - GLOBE_R - 22, w: GLOBE_CX + GLOBE_R + 12, h: VIEW_H - (GLOBE_CY - GLOBE_R - 22) },
  /** XP groove in the bar's top molding; the level medallion sits over its centre. */
  xpBar: { x: LEFT_TABS_X - 8, y: HUD_TOP + 5, w: (MID - LEFT_TABS_X + 8) * 2, h: 5 },
  medallion: { cx: MID, cy: HUD_TOP - 3, w: MEDALLION_W, h: 36 },
  lifeGlobe: { cx: GLOBE_CX, cy: GLOBE_CY, r: GLOBE_R },
  manaGlobe: { cx: VIEW_W - GLOBE_CX, cy: GLOBE_CY, r: GLOBE_R },
  /** Tabs sitting on the bar's top edge, left of the medallion: character, quests, map */
  leftButtons: { x: LEFT_TABS_X, y: TAB_Y, w: TAB_W, h: TAB_H, gap: TAB_GAP, count: 3, dir: 'row' },
  /** Tabs right of the medallion: inventory, skills, menu */
  rightButtons: { x: RIGHT_TABS_X, y: TAB_Y, w: TAB_W, h: TAB_H, gap: TAB_GAP, count: 3, dir: 'row' },
  levelUpButton: { x: LEFT_TABS_X - 80, y: TAB_Y - 22, w: 74, h: 18 },
  /** Floating hover-info plaque above the medallion (drawn only when it has lines). */
  infoBox: { x: CENTRE_X, y: HUD_ART_TOP + 8, w: CENTRE_W, h: 44 },
  belt: { x: BELT_X, y: SLOT_Y, cell: BELT_CELL, gap: BELT_GAP, count: 8 },
  hotkeys: { x: HOTKEYS_X, y: SLOT_Y, cell: BELT_CELL, gap: BELT_GAP, count: 4 },
  skillButton: { x: HOTKEYS_X + 4 * (BELT_CELL + BELT_GAP) - BELT_GAP + 12, y: SLOT_Y - 4, w: SKILL_SIZE, h: SKILL_SIZE },
  goldText: { x: 166, y: SLOT_Y, w: 62, h: BELT_CELL },
  zoneName: { x: VIEW_W - 14, y: 12 },
  messages: { x: 12, y: HUD_ART_TOP + 4, lines: 4, lineH: 14, ttl: 200, fade: 40 },
  leftPanel: { x: 0, y: SIDE_Y, w: SIDE_W, h: SIDE_H },
  rightPanel: { x: VIEW_W - SIDE_W, y: SIDE_Y, w: SIDE_W, h: SIDE_H },
  vendor: { x: 0, y: 5, w: VENDOR_W, h: VENDOR_H },
  dialogue: { x: (VIEW_W - DIALOGUE_W) / 2, y: Math.floor((PANEL_FLOOR - DIALOGUE_H) / 2), w: DIALOGUE_W, h: DIALOGUE_H },
  menu: { x: (VIEW_W - MENU_W) / 2, y: Math.floor((PANEL_FLOOR - MENU_H) / 2), w: MENU_W, h: MENU_H },
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

/** Rect for the i-th button in a button strip (vertical column, or a row when strip.dir === 'row'). */
export function columnButtonRect(col, i) {
  if (col.dir === 'row') return { x: col.x + i * (col.w + col.gap), y: col.y, w: col.w, h: col.h };
  return { x: col.x, y: col.y + i * (col.h + col.gap), w: col.w, h: col.h };
}

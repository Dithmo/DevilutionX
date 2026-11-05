/**
 * Grid container primitives shared by the backpack (10×4) and stash (10×10).
 * `cells` holds the owning item id in every covered cell (0 = free); the
 * item itself remembers its top-left anchor in `item.cx, item.cy`.
 */
import { LOOT } from '../../data/balance/loot.js';

/**
 * @param {number} [w]
 * @param {number} [h]
 * @returns {{w:number,h:number,cells:Int32Array,items:Object<number,object>}}
 */
export function createInventory(w = LOOT.gridW, h = LOOT.gridH) {
  return { w, h, cells: new Int32Array(w * h), items: {} };
}

const sizeOf = (item) => item.size || { w: 1, h: 1 };

/** @returns {boolean} does the footprint fit inside the grid bounds */
export function fitsBounds(inv, item, cx, cy) {
  const s = sizeOf(item);
  return cx >= 0 && cy >= 0 && cx + s.w <= inv.w && cy + s.h <= inv.h;
}

/** Distinct item ids under a footprint (excluding `ignoreId`). */
export function overlappingIds(inv, item, cx, cy, ignoreId = 0) {
  const s = sizeOf(item);
  const ids = new Set();
  for (let y = cy; y < cy + s.h; y++) {
    for (let x = cx; x < cx + s.w; x++) {
      const id = inv.cells[y * inv.w + x];
      if (id && id !== ignoreId) ids.add(id);
    }
  }
  return ids;
}

/** @returns {object|null} the item covering cell (cx, cy) */
export function itemAt(inv, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= inv.w || cy >= inv.h) return null;
  const id = inv.cells[cy * inv.w + cx];
  return id ? inv.items[id] || null : null;
}

function writeCells(inv, item, cx, cy, id) {
  const s = sizeOf(item);
  for (let y = cy; y < cy + s.h; y++) {
    for (let x = cx; x < cx + s.w; x++) inv.cells[y * inv.w + x] = id;
  }
}

/**
 * First free anchor for an item. Height-1 items fill the bottom row first
 * (left→right, then upward); taller items fill from the top-left (reference
 * FindSlotForItem scan orders, simplified).
 * @returns {{x:number,y:number}|null}
 */
export function findFreeSpot(inv, item) {
  const s = sizeOf(item);
  const rows = [];
  if (s.h === 1) for (let y = inv.h - 1; y >= 0; y--) rows.push(y);
  else for (let y = 0; y + s.h <= inv.h; y++) rows.push(y);
  for (const y of rows) {
    for (let x = 0; x + s.w <= inv.w; x++) {
      if (overlappingIds(inv, item, x, y).size === 0) return { x, y };
    }
  }
  return null;
}

/**
 * Place an item with its top-left at (cx, cy). At most one existing item may
 * be covered; that item is removed and returned as `swapped`.
 * @returns {{ok:boolean, swapped:object|null, reason?:string}}
 */
export function placeAt(inv, item, cx, cy) {
  if (!fitsBounds(inv, item, cx, cy)) return { ok: false, swapped: null, reason: 'bounds' };
  const ids = overlappingIds(inv, item, cx, cy, item.id);
  if (ids.size > 1) return { ok: false, swapped: null, reason: 'overlap' };
  let swapped = null;
  if (ids.size === 1) swapped = removeItem(inv, [...ids][0]);
  if (inv.items[item.id]) removeItem(inv, item.id); // moving inside the same grid
  writeCells(inv, item, cx, cy, item.id);
  inv.items[item.id] = item;
  item.cx = cx;
  item.cy = cy;
  return { ok: true, swapped };
}

/**
 * Remove an item by id; clears its cells and anchor.
 * @returns {object|null} the removed item
 */
export function removeItem(inv, id) {
  const item = inv.items[id];
  if (!item) return null;
  for (let i = 0; i < inv.cells.length; i++) if (inv.cells[i] === id) inv.cells[i] = 0;
  delete inv.items[id];
  delete item.cx;
  delete item.cy;
  return item;
}

/** Place at the first free spot. @returns {boolean} */
export function autoPlace(inv, item) {
  const spot = findFreeSpot(inv, item);
  if (!spot) return false;
  return placeAt(inv, item, spot.x, spot.y).ok;
}

/** @returns {object[]} items in the grid */
export function gridItems(inv) {
  return Object.values(inv.items);
}

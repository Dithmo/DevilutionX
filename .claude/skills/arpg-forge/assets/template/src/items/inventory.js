/**
 * Backpack / belt / gold / stash / floor interactions. Re-exports the grid
 * primitives (grid.js), equipment rules (equip.js), the derived-stat pipeline
 * (recalc.js) and consumable use (consume.js) so callers import one module.
 */
import { LOOT } from '../../data/balance/loot.js';
import { isWalkable } from '../world/tiles.js';
import { worldPos } from '../render/camera.js';
import { createInventory, findFreeSpot, placeAt, removeItem, gridItems, fitsBounds, overlappingIds } from './grid.js';
import { detachItem } from './equip.js';

export { createInventory, findFreeSpot, placeAt, removeItem, itemAt, autoPlace, gridItems, fitsBounds } from './grid.js';
export { equip, unequip, canEquip, slotsForItem, detachItem } from './equip.js';
export { recalcPlayer, equippedItems, classOf } from './recalc.js';
export { useItem, consumeOne } from './consume.js';

const STR = (game, key, fallback) => (game.strings && game.strings[key]) || fallback;

/** Boolean form of placeAt's rule (bounds + at most one overlapped item). @returns {boolean} */
export function canPlace(inv, item, cx, cy) {
  return fitsBounds(inv, item, cx, cy) && overlappingIds(inv, item, cx, cy, item.id).size <= 1;
}

/** @returns {object} a 10×10 stash grid */
export function createStash() {
  return createInventory(LOOT.stashW, LOOT.stashH);
}

/** Ensure `player.stash` exists. @returns {object} */
export function ensureStash(p) {
  if (!p.stash) p.stash = createStash();
  return p.stash;
}

/* ------------------------------------------------------------------- gold */

/** @returns {number} */
export function goldTotal(p) {
  return p.gold || 0;
}

/**
 * Add gold up to the carry cap.
 * @returns {number} amount actually added
 */
export function addGold(game, amount) {
  const p = game.player;
  const cap = (game.balance && game.balance.economy && game.balance.economy.maxGold) || LOOT.goldPlayerCap;
  const room = Math.max(0, cap - (p.gold || 0));
  const added = Math.min(room, Math.max(0, Math.floor(amount)));
  p.gold = (p.gold || 0) + added;
  if (game.stats) game.stats.gold = (game.stats.gold || 0) + added;
  return added;
}

/** @returns {boolean} false (and nothing spent) when the player cannot afford it */
export function spendGold(game, amount) {
  const p = game.player;
  if ((p.gold || 0) < amount) return false;
  p.gold -= amount;
  return true;
}

/* ------------------------------------------------------------------- belt */

/** Put a belt-eligible consumable in the first free belt slot. @returns {number} slot or -1 */
export function beltAdd(p, item) {
  if (!item.belt) return -1;
  if (!p.belt) p.belt = new Array(LOOT.beltSlots).fill(null);
  for (let i = 0; i < p.belt.length; i++) {
    const cur = p.belt[i];
    if (cur && item.stackable && cur.baseId === item.baseId) {
      cur.count = (cur.count || 1) + (item.count || 1);
      return i;
    }
  }
  const i = p.belt.indexOf(null);
  if (i < 0) return -1;
  p.belt[i] = item;
  return i;
}

/** @returns {object|null} the item removed from that belt slot */
export function beltRemove(p, index) {
  if (!p.belt || index < 0 || index >= p.belt.length) return null;
  const item = p.belt[index];
  p.belt[index] = null;
  return item;
}

/* ------------------------------------------------------------------ floor */

function removeFromLevel(level, item) {
  if (!level || !level.items) return;
  const i = level.items.indexOf(item);
  if (i >= 0) level.items.splice(i, 1);
}

function stackInto(p, item) {
  if (!item.stackable) return false;
  const target = gridItems(p.inventory).find((it) => it.baseId === item.baseId && it !== item);
  if (!target) return false;
  target.count = (target.count || 1) + (item.count || 1);
  return true;
}

/**
 * Pick an item up off the floor: gold merges into `player.gold`, belt
 * consumables prefer the belt, everything else needs grid room.
 * @returns {boolean}
 */
export function tryPickUp(game, item) {
  const p = game.player;
  const bus = game.bus;
  if (item.slot === 'gold') {
    const added = addGold(game, item.count);
    if (added <= 0) {
      if (bus) bus.emit('message', { text: STR(game, 'goldFull', 'You cannot carry more gold.'), color: 'danger' });
      return false;
    }
    item.count -= added;
    if (bus) bus.emit('float', { x: item.tx, y: item.ty, text: `+${added}`, color: 'gold' });
    if (bus) bus.emit('sfx', { name: 'gold', x: item.tx, y: item.ty });
    if (item.count > 0) return false;
    removeFromLevel(game.level, item);
    if (bus) bus.emit('itemPickedUp', { item });
    return true;
  }
  let placed = stackInto(p, item);
  if (!placed && item.belt) placed = beltAdd(p, item) >= 0;
  if (!placed) {
    const spot = findFreeSpot(p.inventory, item);
    if (spot) placed = placeAt(p.inventory, item, spot.x, spot.y).ok;
  }
  if (!placed) {
    if (bus) bus.emit('message', { text: STR(game, 'noRoom', 'No room.'), color: 'danger' });
    return false;
  }
  removeFromLevel(game.level, item);
  delete item.tx;
  delete item.ty;
  delete item.dropTick;
  if (item.unique) {
    if (!game.foundUniques) game.foundUniques = new Set();
    game.foundUniques.add(item.unique);
  }
  if (bus) bus.emit('sfx', { name: 'pickup' });
  if (bus) bus.emit('itemPickedUp', { item });
  return true;
}

/**
 * Nearest free floor tile to (x, y) by expanding Chebyshev rings
 * (walkable and not already holding an item).
 * @returns {{x:number,y:number}|null}
 */
export function findDropTile(level, x, y, radius = LOOT.dropSearchRadius) {
  const taken = new Set((level.items || []).map((it) => `${it.tx},${it.ty}`));
  const free = (tx, ty) => isWalkable(level.tiles, tx, ty) && !taken.has(`${tx},${ty}`);
  if (free(x, y)) return { x, y };
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/**
 * Drop an item on the floor next to the player (or at `at`). Detaches it
 * from grid/belt/cursor first. Fails when no tile is free or the level is full.
 * @returns {boolean}
 */
export function dropItem(game, item, at) {
  const level = game.level;
  if (!level) return false;
  if ((level.items || []).length >= LOOT.maxGroundItems) return false;
  const origin = at || (() => {
    const w = worldPos(game.player);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  })();
  const tile = findDropTile(level, origin.x, origin.y);
  if (!tile) {
    if (game.bus) game.bus.emit('message', { text: STR(game, 'noRoomHere', 'There is no room here.'), color: 'danger' });
    return false;
  }
  detachItem(game, item);
  item.tx = tile.x;
  item.ty = tile.y;
  item.dropTick = game.tick || 0;
  if (!level.items) level.items = [];
  level.items.push(item);
  if (game.bus) game.bus.emit('sfx', { name: 'drop', x: tile.x, y: tile.y });
  if (game.bus) game.bus.emit('itemDropped', { item });
  return true;
}

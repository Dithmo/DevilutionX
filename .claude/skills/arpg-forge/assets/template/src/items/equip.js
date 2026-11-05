/**
 * Equipment slot rules (reference CanEquip / ChangeEquippedItem /
 * ChangeTwoHandItem): slot compatibility, requirements, two-handers clearing
 * the off-hand, rings in either ring slot, swap with the current occupant.
 */
import { itemMeetsReq } from './itemgen.js';
import { findFreeSpot, placeAt, removeItem } from './grid.js';
import { recalcPlayer } from './recalc.js';

const RING_SLOTS = ['ring1', 'ring2'];
const SLOTS_FOR = { weapon: ['weapon'], offhand: ['offhand'], head: ['head'], body: ['body'], amulet: ['amulet'], ring: RING_SLOTS };

/** @returns {string[]} equipment slot names the item can go into ([] if not equippable) */
export function slotsForItem(item) {
  return SLOTS_FOR[item.slot] || [];
}

/**
 * May the player wear this item (in this slot)?
 * @returns {{ok:boolean, reason?:'notEquippable'|'wrongSlot'|'requirements'}}
 */
export function canEquip(player, item, slot) {
  const slots = slotsForItem(item);
  if (!slots.length) return { ok: false, reason: 'notEquippable' };
  if (slot && !slots.includes(slot)) return { ok: false, reason: 'wrongSlot' };
  if (!itemMeetsReq(player, item)) return { ok: false, reason: 'requirements' };
  return { ok: true };
}

/** Pull an item out of wherever it currently sits (grid, stash, belt, cursor). */
export function detachItem(game, item) {
  const p = game.player;
  if (p.inventory && p.inventory.items[item.id]) removeItem(p.inventory, item.id);
  if (p.stash && p.stash.items[item.id]) removeItem(p.stash, item.id);
  if (p.belt) {
    const i = p.belt.indexOf(item);
    if (i >= 0) p.belt[i] = null;
  }
  if (game.ui && game.ui.cursorItem === item) game.ui.cursorItem = null;
}

function pickRingSlot(p) {
  for (const s of RING_SLOTS) if (!p.equipment[s]) return s;
  return RING_SLOTS[0];
}

/**
 * Equip an item. The previous occupant comes back as `swapped` (and goes to
 * the cursor when the item being equipped was the cursor item). A two-hander
 * moves the off-hand into the backpack (`displaced`), or hands it back as
 * `swapped` when no weapon was displaced, and fails with 'noRoom' otherwise.
 * @returns {{ok:boolean, swapped:object|null, displaced?:object|null, reason?:string}}
 */
export function equip(game, item, slot) {
  const p = game.player;
  const slots = slotsForItem(item);
  if (!slots.length) return { ok: false, swapped: null, reason: 'notEquippable' };
  if (!slot) slot = item.slot === 'ring' ? pickRingSlot(p) : slots[0];
  const check = canEquip(p, item, slot);
  if (!check.ok) return { ok: false, swapped: null, reason: check.reason };

  let swapped = p.equipment[slot] || null;
  let displaced = null;
  if (slot === 'weapon' && item.twoHanded && p.equipment.offhand) {
    const off = p.equipment.offhand;
    const spot = findFreeSpot(p.inventory, off);
    if (spot) {
      p.equipment.offhand = null;
      placeAt(p.inventory, off, spot.x, spot.y);
      displaced = off;
    } else if (!swapped) {
      p.equipment.offhand = null;
      swapped = off;
    } else {
      return { ok: false, swapped: null, reason: 'noRoom' };
    }
  }
  if (slot === 'offhand' && p.equipment.weapon && p.equipment.weapon.twoHanded) {
    if (swapped) return { ok: false, swapped: null, reason: 'twoHanded' };
    swapped = p.equipment.weapon;
    p.equipment.weapon = null;
  }
  const fromCursor = game.ui && game.ui.cursorItem === item;
  detachItem(game, item);
  p.equipment[slot] = item;
  if (swapped) {
    for (const s of Object.keys(p.equipment)) if (p.equipment[s] === swapped) p.equipment[s] = null;
    if (game.ui && (fromCursor || !game.ui.cursorItem)) game.ui.cursorItem = swapped;
  }
  recalcPlayer(game);
  if (game.bus) game.bus.emit('sfx', { name: 'click' });
  return { ok: true, swapped, displaced };
}

/**
 * Remove the item in a slot to the backpack (or just hand it back with
 * `toCursor`). Fails with 'noRoom' when the grid is full.
 * @returns {{ok:boolean, item:object|null, reason?:string}}
 */
export function unequip(game, slot, opts = {}) {
  const p = game.player;
  const item = p.equipment[slot];
  if (!item) return { ok: false, item: null, reason: 'empty' };
  if (!opts.toCursor) {
    const spot = findFreeSpot(p.inventory, item);
    if (!spot) return { ok: false, item, reason: 'noRoom' };
    p.equipment[slot] = null;
    placeAt(p.inventory, item, spot.x, spot.y);
  } else {
    p.equipment[slot] = null;
  }
  recalcPlayer(game);
  return { ok: true, item };
}

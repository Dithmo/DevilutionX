/**
 * Town NPCs: creation, idle behaviour, dialogue assembly, vendor stock and
 * transactions, services, town portals and stairs. Installs every
 * `game.hooks.*` seam this layer owns via `installMetaHooks(game)`.
 */
import { dirFromDelta } from '../world/pathfind.js';
import { deps, loadMetaDeps, onEvent, questDialogueFor, questStampsFor } from '../quests/quests.js';

const NPC_SPEED = 0;
const FACE_RANGE = 3;
const IDLE_TURN_PCT = 1;
const PORTAL_LOOK = { color: '#80d0ff', color2: '#2040a0' };
const PORTAL_LIGHT = 8;
const OPEN_PORTAL_SCROLL_RANGE = 1;

function eco(game) { return (game.balance && game.balance.economy) || {}; }
function npcDef(game, npcId) { return (game.theme.npcs || []).find((n) => n.id === npcId) || null; }
function say(game, text, color) { game.bus.emit('message', { text, color: color || (game.theme.palette || {}).text }); }
function sfx(game, name) { game.bus.emit('sfx', { name }); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function occupy(level, e) { if (level && level.occupant) level.occupant[e.ty * level.tiles.w + e.tx] = e.id; }

/**
 * Build an Npc entity from the theme definition.
 * @param {object} game
 * @param {string} npcId
 * @param {number} x
 * @param {number} y
 * @param {object} [level] level to mark occupancy in (optional)
 * @returns {object|null} Npc
 */
export function createNpc(game, npcId, x, y, level = null) {
  const def = npcDef(game, npcId);
  if (!def) return null;
  const npc = {
    id: game.nextId++, kind: 'npc', tx: x, ty: y, ox: 0, oy: 0, dir: 0,
    anim: 'stand', frame: 0, frameTicks: 8, frameAcc: 0, path: null, moveSpeed: NPC_SPEED,
    hp: 1, hpMax: 1, dead: false, look: { ...def.look }, flash: 0,
    npcId, name: def.name, title: def.title, role: def.role,
    vendorType: def.vendorType || null, vendorTypes: def.vendorTypes || (def.vendorType ? [def.vendorType] : []),
    services: def.services || [], stock: [], stockDepth: 0,
    greeting: def.greeting || [], lines: def.gossip || [], questLines: def.questLines || {},
  };
  occupy(level, npc);
  return npc;
}

/** Idle behaviour: face the player when near, otherwise turn now and then. */
export function updateNpcs(game) {
  const level = game.level;
  const p = game.player;
  if (!level || !level.npcs) return;
  for (const n of level.npcs) {
    const dx = p.tx - n.tx; const dy = p.ty - n.ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= FACE_RANGE) n.dir = dirFromDelta(Math.sign(dx), Math.sign(dy));
    else if (game.rng.chance(IDLE_TURN_PCT)) n.dir = game.rng.rand(8);
  }
}

/**
 * Full dialogue for an NPC: quest line or greeting plus menu options.
 * @returns {{title:string, lines:string[], options:Array<{label:string, action:string}>}}
 */
export function getDialogue(game, npc) {
  const s = game.strings;
  const quest = questDialogueFor(game, npc);
  const lines = quest ? [quest.text] : [game.rng.pick(npc.greeting) || `${npc.name}.`];
  const options = [];
  if (npc.vendorTypes.length) options.push({ label: s.trade, action: 'trade' });
  for (const svc of npc.services) options.push({ label: s[svc] || svc, action: svc });
  if (npc.lines.length) options.push({ label: s.gossip, action: 'gossip' });
  options.push({ label: s.leave, action: 'leave' });
  return { title: `${npc.name}, ${npc.title}`, lines, options, questId: quest ? quest.questId : null };
}

/** A gossip line for the NPC (random, via game.rng). */
export function gossipLine(game, npc) {
  return game.rng.pick(npc.lines) || game.rng.pick(npc.greeting) || '';
}

function pickBase(game, filter, maxLevel) {
  const bases = ((game.theme.items && game.theme.items.bases) || []).filter((b) => filter(b) && (b.level || 1) <= maxLevel);
  if (!bases.length) return null;
  let total = 0;
  for (const b of bases) total += b.dropWeight || 1;
  let roll = game.rng.float() * total;
  for (const b of bases) { roll -= b.dropWeight || 1; if (roll < 0) return b; }
  return bases[bases.length - 1];
}

/** Guarantee `item.price = {buy, sell}`; `priceOf` may return a number or that object. */
function ensurePrice(item, game) {
  if (!item.price) item.price = { buy: 0, sell: 0 };
  if (!(item.price.buy > 0)) {
    const v = deps.priceOf ? deps.priceOf(item, game) : (item.level || 1) * 10;
    item.price.buy = Math.max(1, (v && typeof v === 'object' ? v.buy : v) || 0);
  }
  if (!(item.price.sell >= 0)) item.price.sell = 0;
  return item;
}

/** Roll one stock item under the vendor's price cap. */
function rollStock(game, spec, cap) {
  if (!deps.generateItem) return null;
  const tries = eco(game).rerollTries || 20;
  let item = null;
  for (let i = 0; i < tries; i++) {
    item = deps.generateItem(game, { ...spec, source: 'vendor' });
    if (!item) return null;
    item.identified = true;
    ensurePrice(item, game);
    if (item.price.buy <= cap) break;
  }
  return item;
}

const SLOT_FILTERS = {
  weapons: (b) => b.slot === 'weapon',
  armor: (b) => b.slot === 'head' || b.slot === 'body' || b.slot === 'offhand',
  junk: (b) => b.slot !== 'quest' && b.slot !== 'gold',
};

function consumables(game) { return (game.theme.items && game.theme.items.consumables) || []; }
function consumableByEffect(game, type, maxLevel) {
  const list = consumables(game).filter((c) => c.effect && c.effect.type === type && (c.level || 1) <= maxLevel);
  list.sort((a, b) => (b.level || 1) - (a.level || 1));
  return list;
}

function stockFor(game, vendorType, level) {
  const e = eco(game);
  const cap = (e.priceCaps || {})[vendorType] || Infinity;
  const out = [];
  const push = (it) => { if (it) out.push(it); };
  const n = e.counts && e.counts[vendorType] ? game.rng.range(e.counts[vendorType][0], e.counts[vendorType][1]) : 0;
  if (vendorType === 'weapons' || vendorType === 'armor') {
    for (let i = 0; i < n; i++) {
      const base = pickBase(game, SLOT_FILTERS[vendorType], level);
      if (base) push(rollStock(game, { level, baseId: base.id, quality: 'any' }, cap));
    }
  } else if (vendorType === 'junk') {
    const lvl = Math.max(1, level - (e.junkLevelPenalty || 0));
    for (let i = 0; i < n; i++) {
      const base = pickBase(game, SLOT_FILTERS.junk, lvl);
      if (base) push(rollStock(game, { level: lvl, baseId: base.id, quality: 'any' }, cap));
    }
  } else if (vendorType === 'magic') {
    const books = consumables(game).filter((c) => (c.kind === 'tome' || c.kind === 'scroll') && (c.level || 1) <= level);
    for (let i = 0; i < n && books.length; i++) push(rollStock(game, { level, baseId: game.rng.pick(books).id }, cap));
    const offsets = e.premiumOffsets || [0];
    for (let i = 0; i < (e.premiumCount || 0); i++) {
      push(rollStock(game, { level: clamp(level + game.rng.pick(offsets), 1, 30), quality: 'good', onlyGood: true }, cap));
    }
  } else if (vendorType === 'potions') {
    const pot = e.potions || {};
    const extra = Math.floor(level / (pot.perDepth || 4));
    for (const type of ['heal', 'mana', 'rejuv']) {
      const tiers = consumableByEffect(game, type, level);
      const count = (pot[type] || 1) + extra;
      for (let i = 0; i < count && tiers.length; i++) push(rollStock(game, { level, baseId: tiers[Math.min(i % 2, tiers.length - 1)].id }, cap));
    }
  }
  for (const baseId of (e.pinned && e.pinned[vendorType]) || []) {
    const it = rollStock(game, { level, baseId }, Infinity);
    if (it) { it.infinite = true; out.push(it); }
  }
  return out;
}

/**
 * Regenerate every vendor's stock from the player's progress. Call on every
 * town entry. Stock level = clamp(deepest + bonus, min, max).
 * @param {object} game
 * @returns {number} stock level used
 */
export function restockVendors(game) {
  const e = eco(game);
  const deepest = (game.stats && game.stats.deepest) || 0;
  const level = clamp(deepest + (e.stockLevelBonus || 0), e.stockLevelMin || 1, e.stockLevelMax || 30);
  const town = game.town || (game.level && game.level.depth === 0 ? game.level : null);
  if (!town || !town.npcs) return level;
  for (const npc of town.npcs) {
    if (!npc.vendorTypes || !npc.vendorTypes.length) continue;
    npc.stock = [];
    for (const vt of npc.vendorTypes) npc.stock.push(...stockFor(game, vt, level));
    npc.stockDepth = level;
  }
  return level;
}

/**
 * Buy an item from a vendor: gold check, then inventory room.
 * @returns {boolean} true on success
 */
export function vendorBuy(game, npc, item) {
  const p = game.player;
  const price = ensurePrice(item, game).price.buy;
  if ((p.gold || 0) < price) { say(game, game.strings.notEnoughGold, (game.theme.palette || {}).danger); sfx(game, 'error'); return false; }
  const idx = npc.stock.indexOf(item);
  if (idx < 0) return false;
  const goods = item.infinite ? { ...item, infinite: false, id: game.nextId++ } : item;
  if (!deps.tryPickUp || !deps.tryPickUp(game, goods)) { say(game, game.strings.noRoom, (game.theme.palette || {}).danger); sfx(game, 'error'); return false; }
  p.gold -= price;
  if (!item.infinite) npc.stock.splice(idx, 1);
  sfx(game, 'gold');
  say(game, `${game.strings.bought} ${goods.name}`);
  return true;
}

/** Sell price for an item under the economy rules (0 = unsellable). */
export function sellPrice(game, item) {
  if (!item || item.slot === 'quest' || item.slot === 'gold') return 0;
  const e = eco(game);
  const buy = ensurePrice(item, game).price.buy;
  return Math.max(e.sellMin || 1, Math.floor(buy / (e.sellDivisor || 4)));
}

/**
 * Sell an item from the pack or belt. Quest items are refused.
 * @returns {number} gold received (0 if refused)
 */
export function vendorSell(game, item) {
  const p = game.player;
  const price = sellPrice(game, item);
  if (!price) { say(game, game.strings.cannotSell, (game.theme.palette || {}).danger); sfx(game, 'error'); return 0; }
  const inInv = p.inventory && p.inventory.items && p.inventory.items[item.id];
  const beltIdx = p.belt ? p.belt.indexOf(item) : -1;
  if (inInv) { if (deps.removeItem) deps.removeItem(p.inventory, item.id); else delete p.inventory.items[item.id]; }
  else if (beltIdx >= 0) p.belt[beltIdx] = null;
  else return 0;
  p.gold = Math.min((p.gold || 0) + price, eco(game).maxGold || Infinity);
  sfx(game, 'gold');
  say(game, `${game.strings.sold} ${item.name}`);
  return price;
}

function pay(game, cost) {
  if ((game.player.gold || 0) < cost) { say(game, game.strings.notEnoughGold, (game.theme.palette || {}).danger); sfx(game, 'error'); return false; }
  game.player.gold -= cost;
  return true;
}

/** Restore life and mana (free by default). @returns {boolean} */
export function serviceHeal(game, npc) {
  const p = game.player;
  if (!pay(game, eco(game).healCost || 0)) return false;
  p.hp = p.hpMax; p.mp = p.mpMax;
  sfx(game, 'potion'); say(game, game.strings.healed, (game.theme.palette || {}).good);
  return true;
}

/** Identify one item for the flat fee. @returns {boolean} */
export function serviceIdentify(game, item, npc) {
  if (!item || item.identified) return false;
  if (!pay(game, eco(game).identifyCost || 0)) return false;
  if (deps.identify) deps.identify(item); else item.identified = true;
  sfx(game, 'click'); say(game, `${game.strings.identified} ${item.name}`);
  return true;
}

/** Cost to repair an item to full (0 when nothing to repair). */
export function repairCost(game, item) {
  if (!item || !item.dur || item.dur.cur >= item.dur.max) return 0;
  const e = eco(game);
  const missing = item.dur.max - item.dur.cur;
  return Math.max(e.repairMin || 1, Math.ceil(ensurePrice(item, game).price.buy * missing / item.dur.max * (e.repairFraction || 0.5)));
}

/** Repair one item. @returns {boolean} */
export function serviceRepair(game, item, npc) {
  const cost = repairCost(game, item);
  if (!cost) { say(game, game.strings.nothingToRepair); return false; }
  if (!pay(game, cost)) return false;
  item.dur.cur = item.dur.max;
  sfx(game, 'hit'); say(game, `${game.strings.repaired} ${item.name}`);
  return true;
}

/** Cost to recharge a charged item (0 when full or uncharged). */
export function rechargeCost(game, item) {
  if (!item || !item.charges || item.charges.cur >= item.charges.max) return 0;
  const e = eco(game);
  const missing = item.charges.max - item.charges.cur;
  return Math.max(e.rechargeMin || 1, Math.ceil(ensurePrice(item, game).price.buy * missing / item.charges.max * (e.rechargeFraction || 0.5)));
}

/** Recharge one item. @returns {boolean} */
export function serviceRecharge(game, item, npc) {
  const cost = rechargeCost(game, item);
  if (!cost || !pay(game, cost)) return false;
  item.charges.cur = item.charges.max;
  sfx(game, 'cast'); say(game, `${game.strings.recharged} ${item.name}`);
  return true;
}

function makePortal(game, level, x, y, linkDepth) {
  let obj = null;
  if (deps.createObject) { try { obj = deps.createObject(game, 'portal', x, y); } catch (err) { obj = null; } }
  if (!obj) obj = { id: game.nextId++, kind: 'portal', typeId: 'portal', tx: x, ty: y, look: { ...PORTAL_LOOK }, loot: null, trap: null, text: '' };
  Object.assign(obj, { kind: 'portal', tx: x, ty: y, solid: false, blocksLight: false, state: 'open', linkId: linkDepth, light: PORTAL_LIGHT });
  level.objects.push(obj);
  level.portal = { x, y };
  return obj;
}

function removePortal(level) {
  if (!level) return;
  level.objects = level.objects.filter((o) => o.kind !== 'portal');
  level.portal = null;
}

function townAnchor(game) {
  const town = game.theme.town || {};
  if (town.portalAnchor) return town.portalAnchor;
  const d = town.dungeonEntrance || { x: 2, y: 2 };
  return { x: d.x + 2, y: d.y + 2 };
}

/**
 * Open a town portal at the player's feet (dungeon only). Replaces any
 * earlier portal; records `player.portalLevel` / `player.portalPos`.
 * @returns {boolean}
 */
export function openTownPortal(game) {
  const level = game.level; const p = game.player;
  if (!level || level.depth === 0) { say(game, game.strings.portalInTown); return false; }
  const levels = game.levels || {};
  if (p.portalLevel && levels[p.portalLevel]) removePortal(levels[p.portalLevel]);
  removePortal(level);
  const town = game.town || levels[0];
  if (town) { removePortal(town); const a = townAnchor(game); makePortal(game, town, a.x, a.y, level.depth); }
  const dx = OPEN_PORTAL_SCROLL_RANGE;
  makePortal(game, level, p.tx + dx, p.ty, 0);
  p.portalLevel = level.depth; p.portalPos = { x: p.tx + dx, y: p.ty };
  sfx(game, 'portal'); say(game, game.strings.portalOpened);
  return true;
}

/**
 * Step through a portal object. Town → remembered depth (consumes the
 * portal); dungeon → town. Travel itself is `game.hooks.changeLevel`.
 * @returns {boolean}
 */
export function usePortal(game, obj) {
  const p = game.player; const level = game.level;
  if (!level || !game.hooks || !game.hooks.changeLevel) return false;
  if (level.depth === 0) {
    const target = p.portalLevel;
    if (!target) return false;
    removePortal(level);
    const dest = (game.levels || {})[target];
    if (dest) removePortal(dest);
    p.portalLevel = 0;
    sfx(game, 'portal');
    game.hooks.changeLevel(game, target, true);
    return true;
  }
  sfx(game, 'portal');
  game.hooks.changeLevel(game, 0, true);
  return true;
}

/**
 * Install every seam owned by the quest/npc layer on `game.hooks` and route
 * bus events into the quest machine. Returns the dep-loading promise; await
 * it before the first reward or restock when running in the browser.
 * @param {object} game
 * @returns {Promise<object>}
 */
export function installMetaHooks(game) {
  const h = game.hooks = game.hooks || {};
  h.questStampsFor = (g, depth) => questStampsFor(g, depth);
  h.createNpc = (g, id, x, y, level) => createNpc(g, id, x, y, level);
  h.onTownPortal = (g) => openTownPortal(g);
  h.onPortal = (g, obj) => usePortal(g, obj);
  h.onStairs = (g, obj) => g.hooks.changeLevel(g, obj.linkDepth, false);
  h.restockVendors = (g) => restockVendors(g);
  h.getDialogue = (g, npc) => getDialogue(g, npc);
  if (!game.__metaBusWired) {
    game.__metaBusWired = true;
    for (const name of ['monsterKilled', 'itemPickedUp', 'itemDropped', 'objectUsed', 'levelEntered', 'npcTalked']) {
      game.bus.on(name, (payload) => onEvent(game, name, payload));
    }
    game.bus.on('levelEntered', ({ depth }) => { if (depth === 0) restockVendors(game); });
  }
  return loadMetaDeps();
}

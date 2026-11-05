#!/usr/bin/env node
/**
 * Unit test for the meta layer: quests, npcs/vendors/portals, save/load.
 * Uses a fake game (real rng + bus, real default theme text, stubbed
 * cross-module deps via setMetaDeps) and a Map-backed localStorage polyfill.
 *
 *   node tools/unit_meta.mjs
 */
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { createBus } from '../src/core/events.js';
import { mergeStrings } from '../data/strings.js';
import economy from '../data/balance/economy.js';
import meta from '../data/themes/default/meta.js';
import palette from '../data/themes/default/palette.js';
import npcsData from '../data/themes/default/npcs.js';
import questsData from '../data/themes/default/quests.js';
import flavor from '../data/themes/default/flavor.js';
import sfxData from '../data/themes/default/sfx.js';
import themeStrings from '../data/themes/default/strings.js';
import { setMetaDeps, initQuests, onEvent, questReward, questLogEntries, questDialogueFor, questStampsFor, objectiveMet } from '../src/quests/quests.js';
import { createNpc, getDialogue, restockVendors, vendorBuy, vendorSell, serviceHeal, serviceIdentify, serviceRepair, openTownPortal, usePortal, installMetaHooks, updateNpcs } from '../src/npc/npcs.js';
import { saveGame, loadGame, restoreGame, hasSave, deleteSave, listSaves } from '../src/save/save.js';

// ---- localStorage polyfill -------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

// ---- stub content from other agents (items) --------------------------------
const STUB_ITEMS = {
  bases: [
    { id: 'shortblade', name: 'Shortblade', slot: 'weapon', type: 'sword', size: { w: 1, h: 3 }, level: 1, price: 60, dropWeight: 10, dmg: [2, 6], dur: 20 },
    { id: 'war_axe', name: 'War Axe', slot: 'weapon', type: 'axe', size: { w: 2, h: 3 }, level: 8, price: 400, dropWeight: 6, dmg: [6, 14], dur: 30 },
    { id: 'cap', name: 'Cap', slot: 'head', type: 'helm', size: { w: 2, h: 2 }, level: 1, price: 40, dropWeight: 10, ac: [1, 3], dur: 15 },
    { id: 'leather_jerkin', name: 'Leather Jerkin', slot: 'body', type: 'armor', size: { w: 2, h: 3 }, level: 3, price: 150, dropWeight: 8, ac: [4, 8], dur: 25 },
    { id: 'buckler', name: 'Buckler', slot: 'offhand', type: 'shield', size: { w: 2, h: 2 }, level: 2, price: 90, dropWeight: 8, ac: [2, 5], dur: 20 },
    { id: 'ring', name: 'Ring', slot: 'ring', type: 'ring', size: { w: 1, h: 1 }, level: 5, price: 500, dropWeight: 3 },
    { id: 'amulet', name: 'Amulet', slot: 'amulet', type: 'amulet', size: { w: 1, h: 1 }, level: 8, price: 800, dropWeight: 2 },
    { id: 'q_sealed_ledger', name: 'Sealed Ledger', slot: 'quest', type: 'quest', size: { w: 1, h: 1 }, level: 1, price: 0, dropWeight: 0 },
    { id: 'q_bell_clapper', name: 'Bell Clapper', slot: 'quest', type: 'quest', size: { w: 1, h: 2 }, level: 1, price: 0, dropWeight: 0 },
  ],
  consumables: [
    { id: 'c_minor_heal', name: 'Minor Healing Draught', kind: 'potion', effect: { type: 'heal', value: 30 }, level: 1, price: 50, belt: true },
    { id: 'c_heal', name: 'Healing Draught', kind: 'potion', effect: { type: 'heal', value: 80 }, level: 8, price: 150, belt: true },
    { id: 'c_minor_mana', name: 'Minor Mana Draught', kind: 'potion', effect: { type: 'mana', value: 30 }, level: 1, price: 50, belt: true },
    { id: 'c_rejuv', name: 'Rejuvenation Draught', kind: 'potion', effect: { type: 'rejuv', value: 50 }, level: 6, price: 300, belt: true },
    { id: 'c_scroll_portal', name: 'Scroll of Returning', kind: 'scroll', effect: { type: 'townPortal' }, level: 1, price: 100, belt: true },
    { id: 'c_scroll_identify', name: 'Scroll of Naming', kind: 'scroll', effect: { type: 'identify' }, level: 1, price: 100, belt: true },
    { id: 'c_tome_firebolt', name: 'Tome of Firebolt', kind: 'tome', effect: { type: 'learnSkill', skillId: 'firebolt' }, level: 2, price: 1000, belt: false },
  ],
  uniques: [{ id: 'uq_gorraks_jaw', name: "Gorrak's Jaw", baseId: 'war_axe', level: 6, effects: { dmgPct: 50 }, price: 5000 }],
};
let items = STUB_ITEMS;
try { items = (await import('../data/themes/default/items.js')).default; } catch (err) { /* stub */ }

let xpGiven = 0;
const stubDeps = {
  giveXp: (game, amount) => { xpGiven += amount; game.player.xp += amount; },
  generateItem: (game, spec) => {
    const all = [...(items.bases || []), ...(items.consumables || [])];
    let base = spec.baseId ? all.find((b) => b.id === spec.baseId) : null;
    if (spec.uniqueId) {
      const u = (items.uniques || []).find((x) => x.id === spec.uniqueId);
      base = all.find((b) => b.id === (u ? u.baseId : null)) || all[0];
    }
    if (!base) base = game.rng.pick(all.filter((b) => b.slot !== 'quest'));
    const price = Math.max(1, Math.round((base.price || 10) * (1 + spec.level / 10)));
    return { id: game.nextId++, baseId: base.id, name: base.name, slot: base.slot || 'consumable', type: base.type || base.kind,
      size: base.size || { w: 1, h: 1 }, quality: spec.uniqueId ? 'unique' : 'normal', identified: false, level: spec.level,
      dur: base.dur ? { cur: base.dur, max: base.dur } : null, price: { buy: price, sell: Math.floor(price / 4) }, count: 1, seed: game.rng.next() };
  },
  priceOf: (item) => item.price || { buy: 10, sell: 2 }, // mirrors items/itemgen.js: returns {buy, sell}
  identify: (item) => { item.identified = true; },
  tryPickUp: (game, item) => {
    const inv = game.player.inventory;
    if (Object.keys(inv.items).length >= 40) return false;
    inv.items[item.id] = item;
    game.bus.emit('itemPickedUp', { item });
    return true;
  },
  removeItem: (inv, id) => { const had = !!inv.items[id]; delete inv.items[id]; return had; },
  createObject: null,
};
setMetaDeps(stubDeps);

// ---- fake game ---------------------------------------------------------------
function fakeLevel(depth, w = 24, h = 24) {
  const n = w * h;
  return { depth, tier: 0, tilesetId: 'undercroft', seed: depth,
    tiles: { w, h, floor: new Uint8Array(n).fill(1), wall: new Uint8Array(n), flags: new Uint8Array(n), variant: new Uint8Array(n) },
    light: new Uint8Array(n), explored: new Uint8Array(n), occupant: new Int32Array(n),
    monsters: [], objects: [], items: [], missiles: [], npcs: [],
    stairs: { up: null, down: { x: 5, y: 5 }, town: null }, entry: { x: 2, y: 2 },
    rooms: [{ x: 10, y: 10, w: 6, h: 6, kind: 'den', questId: 'q3_grim_tobin' }], visited: true, cleared: false, portal: null };
}
function fakeGame(seed = 7) {
  const theme = { meta, palette, npcs: npcsData, quests: questsData, flavor, sfx: sfxData, strings: themeStrings, items,
    uniqueMonsters: [{ id: 'u_gorrak', name: 'Gorrak' }], town: { dungeonEntrance: { x: 4, y: 4 } } };
  const game = {
    seed, tick: 1, mode: 'town', rng: createRng(seed), bus: createBus(), theme, balance: { economy }, strings: mergeStrings(theme.strings),
    level: null, town: null, levels: {}, nextId: 1, hooks: {},
    ui: { open: null, hover: null, cursorItem: null, vendor: null, dialogue: null, messages: [], floats: [], selectedSkill: null, belt: new Array(8).fill(null) },
    stats: { kills: 0, deaths: 0, gold: 0, deepest: 0, playTicks: 0 }, flags: {}, debug: {}, difficulty: 'normal', log: [],
  };
  game.bus.on('message', (m) => game.log.push(m.text));
  game.player = { id: game.nextId++, kind: 'player', tx: 3, ty: 3, ox: 0, oy: 0, dir: 0, anim: 'stand', frame: 0, frameTicks: 4, frameAcc: 0,
    path: null, moveSpeed: 0.2, hp: 40, hpMax: 60, dead: false, look: { silhouette: 'bulky', bodyColor: '#888', trimColor: '#444' }, flash: 0,
    classId: 'warden', name: 'Tester', level: 3, xp: 0, statPoints: 0, base: { str: 20, mag: 10, dex: 15, vit: 20 }, bonus: { str: 0, mag: 0, dex: 0, vit: 0 },
    mp: 5, mpMax: 20, gold: 0, resist: { fire: 0, cold: 0, shock: 0, arcane: 0 }, derived: {}, equipment: {},
    inventory: { w: 10, h: 4, cells: new Int32Array(40), items: {} }, belt: new Array(8).fill(null), skills: { cleave: 1 }, selectedSkill: 'cleave',
    hotkeys: [], state: { hitRecoverTicks: 0, invulnTicks: 0, manaShield: 0, buffs: [] }, intent: null, deathTicks: 0, portalLevel: 0 };
  game.town = fakeLevel(0);
  game.levels[0] = game.town;
  for (const n of npcsData) game.town.npcs.push(createNpc(game, n.id, 5 + game.town.npcs.length * 2, 6, game.town));
  game.level = game.town;
  return game;
}
const npcById = (game, id) => game.town.npcs.find((n) => n.npcId === id);
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !ArrayBuffer.isView(x))
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok - ${name}`); }

// ---- quests ------------------------------------------------------------------
test('killBoss quest: hidden → offered → active → done, reward paid once', () => {
  const game = fakeGame();
  initQuests(game);
  const q = game.quests.q1_the_thing_below;
  assert.equal(q.state, 'hidden');
  onEvent(game, 'levelEntered', { depth: 1 });
  assert.equal(q.state, 'offered');
  const rook = npcById(game, 'n_captain_rook');
  const d = questDialogueFor(game, rook);
  assert.equal(d.kind, 'offer');
  assert.equal(d.text, npcsData.find((n) => n.id === 'n_captain_rook').questLines.q1_the_thing_below.offer);
  assert.equal(q.state, 'active');
  assert.equal(game.quests.q6_vessel_of_ash.state, 'hidden', 'prereq keeps the final quest hidden');
  game.tick++;
  assert.equal(questDialogueFor(game, rook).kind, 'active');
  assert.equal(objectiveMet(game, 'q1_the_thing_below'), false);
  game.level = fakeLevel(2);
  onEvent(game, 'monsterKilled', { m: { id: 99, uniqueId: 'u_gorrak', typeId: 'shambler', tx: 1, ty: 1, dead: true } });
  assert.equal(q.progress, 1);
  assert.equal(objectiveMet(game, 'q1_the_thing_below'), true);
  game.tick++; game.level = game.town;
  const goldBefore = game.player.gold;
  xpGiven = 0;
  onEvent(game, 'npcTalked', { npc: rook });
  assert.equal(q.state, 'done');
  assert.equal(game.player.gold, goldBefore + 250);
  assert.equal(xpGiven, 400);
  assert.ok(Object.values(game.player.inventory.items).some((it) => it.baseId === 'war_axe'), 'unique reward placed');
  assert.equal(questReward(game, 'q1_the_thing_below'), false, 'second payment refused');
  assert.equal(game.player.gold, goldBefore + 250);
  assert.equal(game.quests.q6_vessel_of_ash.state, 'hidden');
  game.tick++;
  onEvent(game, 'npcTalked', { npc: rook });
  assert.equal(game.quests.q6_vessel_of_ash.state, 'active', 'main quest offered by talk once prereq done, then accepted');
  assert.ok(questLogEntries(game).some((e) => e.id === 'q1_the_thing_below' && e.state === 'done'));
});

test('collectN completes at 3 and removes items on turn-in', () => {
  const game = fakeGame(3);
  initQuests(game);
  const q = game.quests.q4_bell_clappers;
  onEvent(game, 'levelEntered', { depth: 4 });
  assert.equal(q.state, 'offered');
  const oda = npcById(game, 'n_sister_oda');
  questDialogueFor(game, oda);
  assert.equal(q.state, 'active');
  for (let i = 0; i < 3; i++) {
    const it = stubDeps.generateItem(game, { level: 5, baseId: 'q_bell_clapper' });
    stubDeps.tryPickUp(game, it);
    onEvent(game, 'itemPickedUp', { item: it });
    assert.equal(q.progress, i + 1);
    assert.equal(objectiveMet(game, 'q4_bell_clappers'), i === 2);
  }
  game.tick++;
  const d = questDialogueFor(game, oda);
  assert.equal(d.kind, 'done');
  assert.equal(q.state, 'done');
  assert.ok(!Object.values(game.player.inventory.items).some((it) => it.baseId === 'q_bell_clapper'));
  assert.equal(game.player.gold, 400);
});

test('clearArea den and quest stamps', () => {
  const game = fakeGame(5);
  initQuests(game);
  onEvent(game, 'levelEntered', { depth: 3 });
  const stamps = questStampsFor(game, 4);
  assert.ok(stamps.some((s) => s.questId === 'q3_grim_tobin' && s.stamp === 'den'));
  assert.ok(questStampsFor(game, 3).some((s) => s.questId === 'q2_sealed_ledger' && s.items[0] === 'q_sealed_ledger'));
  game.level = fakeLevel(4);
  const a = { id: 50, typeId: 'shambler', tx: 11, ty: 11, dead: false };
  const b = { id: 51, typeId: 'shambler', uniqueId: 'u_grim_tobin', tx: 12, ty: 12, dead: false };
  game.level.monsters.push(a, b);
  a.dead = true; onEvent(game, 'monsterKilled', { m: a });
  assert.equal(objectiveMet(game, 'q3_grim_tobin'), false);
  b.dead = true; onEvent(game, 'monsterKilled', { m: b });
  assert.equal(objectiveMet(game, 'q3_grim_tobin'), true);
});

test('final quest sets win', () => {
  const game = fakeGame(9);
  initQuests(game);
  game.quests.q1_the_thing_below.state = 'done';
  onEvent(game, 'levelEntered', { depth: 15 });
  const rook = npcById(game, 'n_captain_rook');
  questDialogueFor(game, rook);
  onEvent(game, 'monsterKilled', { m: { uniqueId: 'u_vessel_of_ash', tx: 0, ty: 0 } });
  game.tick++;
  onEvent(game, 'npcTalked', { npc: rook });
  assert.equal(game.flags.win, true);
  assert.equal(game.mode, 'win');
});

// ---- npcs / vendors ----------------------------------------------------------
test('vendor restock within caps, every item priced', () => {
  const game = fakeGame(11);
  initQuests(game);
  game.stats.deepest = 5;
  const level = restockVendors(game);
  assert.equal(level, 7);
  const brann = npcById(game, 'n_brann');
  assert.ok(brann.stock.length >= 12 && brann.stock.length <= 20, `brann stock ${brann.stock.length}`);
  const mirelle = npcById(game, 'n_mirelle');
  assert.ok(mirelle.stock.length >= 4 + 2 + 2 + 5 + 2, `mirelle stock ${mirelle.stock.length}`);
  assert.ok(mirelle.stock.some((it) => it.infinite && it.baseId === 'c_scroll_portal'));
  const pip = npcById(game, 'n_pip');
  assert.ok(pip.stock.length >= 3 && pip.stock.length <= 6);
  for (const npc of game.town.npcs) {
    for (const it of npc.stock) {
      assert.ok(it.price && it.price.buy > 0, `${it.name} has a price`);
      assert.ok(it.identified);
      assert.ok(it.price.buy <= economy.priceCaps.weapons);
    }
  }
  assert.equal(npcById(game, 'n_sister_oda').stock.length, 0);
});

test('buy fails without gold, succeeds with; sell pays a quarter; services', () => {
  const game = fakeGame(13);
  initQuests(game);
  restockVendors(game);
  const brann = npcById(game, 'n_brann');
  const item = brann.stock[0];
  const price = item.price.buy;
  assert.equal(vendorBuy(game, brann, item), false);
  assert.equal(game.player.gold, 0);
  game.player.gold = price + 10;
  assert.equal(vendorBuy(game, brann, item), true);
  assert.equal(game.player.gold, 10);
  assert.equal(game.player.inventory.items[item.id], item);
  assert.ok(!brann.stock.includes(item));
  assert.equal(vendorSell(game, item), Math.max(1, Math.floor(price / 4)));
  assert.equal(game.player.inventory.items[item.id], undefined);
  const questItem = stubDeps.generateItem(game, { level: 1, baseId: 'q_bell_clapper' });
  stubDeps.tryPickUp(game, questItem);
  assert.equal(vendorSell(game, questItem), 0, 'quest items unsellable');
  const mirelle = npcById(game, 'n_mirelle');
  const scroll = mirelle.stock.find((it) => it.infinite);
  game.player.gold = scroll.price.buy;
  assert.equal(vendorBuy(game, mirelle, scroll), true);
  assert.ok(mirelle.stock.includes(scroll), 'pinned stock stays');
  game.player.hp = 1;
  assert.equal(serviceHeal(game, npcById(game, 'n_sister_oda')), true);
  assert.equal(game.player.hp, game.player.hpMax);
  const unid = { id: 900, name: 'Thing', identified: false, price: { buy: 100 } };
  game.player.gold = 99;
  assert.equal(serviceIdentify(game, unid), false);
  game.player.gold = 100;
  assert.equal(serviceIdentify(game, unid), true);
  assert.equal(unid.identified, true);
  const worn = { id: 901, name: 'Blade', dur: { cur: 5, max: 20 }, price: { buy: 100 } };
  game.player.gold = 1000;
  assert.equal(serviceRepair(game, worn), true);
  assert.equal(worn.dur.cur, 20);
  assert.equal(game.player.gold, 1000 - Math.ceil(100 * 15 / 20 * 0.5));
});

test('dialogue for a questgiver includes the offer line when offered', () => {
  const game = fakeGame(17);
  initQuests(game);
  onEvent(game, 'levelEntered', { depth: 1 });
  const rook = npcById(game, 'n_captain_rook');
  const dlg = getDialogue(game, rook);
  const offer = npcsData.find((n) => n.id === 'n_captain_rook').questLines.q1_the_thing_below.offer;
  assert.equal(dlg.lines[0], offer);
  assert.ok(dlg.options.some((o) => o.action === 'leave') && dlg.options.some((o) => o.action === 'gossip'));
  const brann = getDialogue(game, npcById(game, 'n_brann'));
  assert.ok(brann.options.some((o) => o.action === 'trade') && brann.options.some((o) => o.action === 'repair'));
  assert.ok(npcsData.find((n) => n.id === 'n_brann').greeting.includes(brann.lines[0]));
  updateNpcs(game);
});

test('town portal round trip and hooks', async () => {
  const game = fakeGame(19);
  initQuests(game);
  const calls = [];
  game.hooks.changeLevel = (g, depth, viaPortal) => calls.push([depth, viaPortal]);
  await installMetaHooks(game);
  assert.equal(typeof game.hooks.onStairs, 'function');
  assert.equal(openTownPortal(game), false, 'no portal from town');
  game.level = fakeLevel(3); game.levels[3] = game.level;
  assert.equal(game.hooks.onTownPortal(game), true);
  assert.ok(game.level.objects.some((o) => o.kind === 'portal') && game.level.portal);
  assert.ok(game.town.objects.some((o) => o.kind === 'portal'));
  assert.equal(game.player.portalLevel, 3);
  game.hooks.onPortal(game, game.level.objects[0]);
  assert.deepEqual(calls.pop(), [0, true]);
  game.level = game.town;
  usePortal(game, game.town.objects[0]);
  assert.deepEqual(calls.pop(), [3, true]);
  assert.ok(!game.town.objects.some((o) => o.kind === 'portal'), 'portal consumed');
  assert.equal(game.player.portalLevel, 0);
  game.hooks.onStairs(game, { linkDepth: 4 });
  assert.deepEqual(calls.pop(), [4, false]);
  game.bus.emit('levelEntered', { depth: 1 });
  assert.equal(game.quests.q1_the_thing_below.state, 'offered', 'bus wired to quests');
});

// ---- save / load ------------------------------------------------------------
test('save → load → restore roundtrip', () => {
  const game = fakeGame(23);
  initQuests(game);
  onEvent(game, 'levelEntered', { depth: 1 });
  game.level = fakeLevel(1); game.levels[1] = game.level;
  game.level.monsters.push({ id: 70, kind: 'monster', typeId: 'shambler', tx: 4, ty: 4, ox: 0, oy: 0, hp: 10, hpMax: 10, dead: false,
    flags: new Set(['undead']), immune: new Set(), resist: {}, path: [{ x: 1, y: 1 }] },
  { id: 71, kind: 'monster', typeId: 'bonepicker', tx: 6, ty: 6, dead: true, flags: new Set(), immune: new Set() });
  game.level.explored[5] = 1;
  game.level.objects.push({ id: 72, kind: 'door', typeId: 'door_wood', tx: 7, ty: 7, state: 'open', look: {} });
  game.player.gold = 123;
  game.player.inventory.cells[0] = 5;
  game.player.path = [{ x: 1, y: 2 }];
  game.player.intent = { type: 'move' };
  assert.equal(saveGame(game, 'slot1'), true);
  assert.equal(hasSave('slot1'), true);
  assert.ok(localStorage.getItem('arpg:default:slot1'));
  const data = loadGame('slot1');
  assert.ok(data && data.version === 1);
  const game2 = fakeGame(1);
  restoreGame(data, game2);
  game.player.path = null; game.player.intent = null;
  assert.equal(stable(game2.player), stable(game.player));
  assert.equal(stable(game2.quests), stable(game.quests));
  assert.equal(game2.level.depth, 1);
  assert.ok(game2.level.tiles.floor instanceof Uint8Array && game2.level.tiles.floor[0] === 1);
  assert.equal(game2.level.explored[5], 1);
  assert.equal(game2.level.monsters.length, 1, 'dead monsters dropped');
  assert.ok(game2.level.monsters[0].flags instanceof Set && game2.level.monsters[0].flags.has('undead'));
  assert.equal(game2.level.monsters[0].path, null);
  assert.equal(game2.level.occupant[4 * 24 + 4], 70);
  assert.equal(game2.town.npcs.length, 6);
  assert.equal(game2.level.objects[0].state, 'open');
  assert.equal(game2.rng.state, game.rng.state);
  assert.equal(listSaves()[0].slot, 'slot1');
  assert.equal(listSaves()[0].summary.name, 'Tester');
  assert.equal(deleteSave('slot1'), true);
  assert.equal(hasSave('slot1'), false);
  assert.equal(loadGame('nope'), null);
});

test('storage unavailable never throws', () => {
  const saved = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
  const game = fakeGame(29);
  initQuests(game);
  assert.equal(saveGame(game, 'x'), false);
  assert.equal(loadGame('x'), null);
  assert.equal(hasSave('x'), false);
  assert.deepEqual(listSaves(), []);
  Object.defineProperty(globalThis, 'localStorage', { value: saved, configurable: true, writable: true });
});

console.log(`\n${passed} tests passed`);

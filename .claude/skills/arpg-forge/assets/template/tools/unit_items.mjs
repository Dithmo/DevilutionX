#!/usr/bin/env node
/**
 * Unit checks for items/* and skills/*. Runs with a fake game (stub bus,
 * real rng, real default theme) and whichever sibling modules exist; the
 * rest fall back to stubs through setItemDeps.
 *
 *   node tools/unit_items.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { createRng } = await mod('src/core/rng.js');
const { createTiles } = await mod('src/world/tiles.js');
const theme = (await mod('data/themes/default/items.js')).default;
const skillsTheme = (await mod('data/themes/default/skills.js')).default;
const { setItemDeps, loadItemDeps } = await mod('src/items/deps.js');
const ItemGen = await mod('src/items/itemgen.js');
const Inv = await mod('src/items/inventory.js');
const Sk = await mod('src/skills/skills.js');
const { affixFitsItem } = await mod('src/items/affixes.js');

let classes = null;
try { classes = (await mod('data/themes/default/classes.js')).default; } catch (e) { classes = null; }
const loaded = await loadItemDeps(pathToFileURL(path.join(ROOT, 'src/items/deps.js')).href);
console.log(`sibling deps wired: ${loaded.length ? loaded.join(', ') : '(none, stubs)'}`);
const spawned = [];
setItemDeps({ spawnMissile: (game, spec) => { spawned.push(spec); return { id: 1, spec }; } });

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL ${msg}`);
}
function section(name) { console.log(`\n== ${name}`); }

const LEVEL_W = 12;
function makeGame(seed = 1234) {
  const tiles = createTiles(LEVEL_W, LEVEL_W);
  tiles.floor.fill(1);
  const events = [];
  const bus = { emit: (n, p) => events.push([n, p]), on() { return () => {}; } };
  const player = {
    id: 1, kind: 'player', classId: 'warden', name: 'T', level: 1, xp: 0, tx: 5, ty: 5, ox: 0, oy: 0, dir: 0,
    base: { str: 30, mag: 10, dex: 20, vit: 25 }, bonus: { str: 0, mag: 0, dex: 0, vit: 0 },
    hp: 70, hpMax: 70, mp: 10, mpMax: 10, gold: 0, resist: { fire: 0, cold: 0, shock: 0, arcane: 0 }, derived: {},
    equipment: { head: null, body: null, weapon: null, offhand: null, ring1: null, ring2: null, amulet: null },
    inventory: Inv.createInventory(), belt: new Array(8).fill(null), skills: {}, selectedSkill: null,
    state: { hitRecoverTicks: 0, invulnTicks: 0, manaShield: 0, buffs: [] },
  };
  if (classes) Object.defineProperty(player, '_cls', { value: classes[0], enumerable: false });
  return {
    seed, tick: 0, mode: 'dungeon', rng: createRng(seed), events,
    theme: { items: theme, skills: skillsTheme, classes: classes || [], palette: null },
    level: { depth: 1, tiles, items: [], monsters: [], missiles: [], occupant: new Int32Array(LEVEL_W * LEVEL_W) },
    player, ui: { cursorItem: null }, bus, nextId: 10, stats: {}, balance: { economy: { maxGold: 100000 } },
  };
}

/* ---------------------------------------------------------------- itemgen */
section('generateItem: 2000 items, ilvl 1..30');
{
  const game = makeGame(42);
  const qualities = { normal: 0, magic: 0, rare: 0, unique: 0 };
  let affixBad = 0;
  let priceBad = 0;
  let durBad = 0;
  for (let i = 0; i < 2000; i++) {
    const ilvl = 1 + (i % 30);
    const source = i % 7 === 0 ? 'unique' : 'monster';
    const item = ItemGen.generateItem(game, { level: ilvl, source, pool: 'equipment' });
    assert(item, `item generated at ilvl ${ilvl}`);
    qualities[item.quality]++;
    const iblvl = source === 'unique' ? ilvl + 4 : ilvl;
    for (const a of item.affixes) {
      const row = [...theme.prefixes, ...theme.suffixes].find((r) => r.id === a.id);
      if (!row || !affixFitsItem(row, item) || row.minLevel > iblvl || row.minLevel < Math.min(Math.floor(iblvl / 2), 25)) {
        affixBad++;
        console.error(`   bad affix ${a.id} on ${item.baseId} ilvl ${ilvl}`);
      }
    }
    if (!(item.price.buy >= 1 && item.price.sell >= 1)) priceBad++;
    if (item.dur && item.quality !== 'unique' && !item.effects.indestructible && (item.dur.cur < 1 || item.dur.cur > item.dur.max)) durBad++;
    if (item.quality !== 'normal') assert(item.identified === false, `${item.quality} item unidentified`);
    if (item.quality === 'rare') assert(item.affixes.length >= 3, 'rare has >=3 affixes');
    if (item.quality === 'magic') assert(item.affixes.length >= 1 && item.affixes.length <= 2, 'magic has 1-2 affixes');
  }
  console.log('  qualities', qualities);
  for (const q of Object.keys(qualities)) assert(qualities[q] > 0, `quality ${q} appears`);
  assert(affixBad === 0, `every affix eligible for slot/level (bad=${affixBad})`);
  assert(priceBad === 0, `every price >= 1 (bad=${priceBad})`);
  assert(durBad === 0, `durability within [1,max] (bad=${durBad})`);
  // jewellery always magic+
  for (let i = 0; i < 50; i++) {
    const r = ItemGen.generateItem(game, { level: 10, baseId: 'ring' });
    assert(r.quality !== 'normal', 'ring never normal');
  }
  // forced qualities
  assert(ItemGen.generateItem(game, { level: 10, baseId: 'longblade', quality: 'unique' }).unique === 'uq_vigilant_edge', 'forced unique');
  assert(ItemGen.generateItem(game, { level: 1, uniqueId: 'uq_warden_plate' }).unique === 'uq_warden_plate', 'uniqueId option');
  assert(ItemGen.generateItem(game, { level: 12, baseId: 'short_bow', quality: 'rare' }).quality === 'rare', 'forced rare');
  assert(ItemGen.generateItem(game, { level: 12, baseId: 'short_bow', quality: 'normal' }).quality === 'normal', 'forced normal');
  const cons = ItemGen.generateConsumable(game, 5);
  assert(cons && ['consumable', 'scroll', 'tome'].includes(cons.slot), 'generateConsumable returns a consumable');
  const gold = ItemGen.generateGold(game, 5);
  assert(gold.slot === 'gold' && gold.count >= 26 && gold.count <= 75, `gold at level 5 in [26,75] (${gold.count})`);
  const q = ItemGen.createQuestItem(game, 'q_sealed_ledger');
  assert(q && q.slot === 'quest' && q.questId === 'q2_sealed_ledger', 'quest item');
  const tome = ItemGen.generateSpecificBase(game, 'c_tome_firebolt');
  assert(tome && tome.slot === 'tome' && tome.effect.skillId === 'firebolt', 'tome base');
}

section('determinism: same seed -> identical item');
{
  const g1 = makeGame(7);
  const g2 = makeGame(7);
  for (let i = 0; i < 200; i++) {
    const a = ItemGen.generateItem(g1, { level: 1 + (i % 30), source: 'monster' });
    const b = ItemGen.generateItem(g2, { level: 1 + (i % 30), seed: a.seed, source: 'monster' });
    const strip = (x) => JSON.stringify({ ...x, id: 0 });
    if (strip(a) !== strip(b)) { assert(false, `seed ${a.seed} reproduces (${a.name} vs ${b.name})`); break; }
  }
  assert(true, 'seed reproduction');
}

section('tooltip / price / identify');
{
  const game = makeGame(3);
  const it = ItemGen.generateItem(game, { level: 20, baseId: 'longblade', quality: 'magic' });
  const lines = ItemGen.itemTooltipLines(it, game.player);
  assert(lines.some((l) => l.text === 'Unidentified'), 'unidentified line present');
  const basePrice = theme.bases.find((b) => b.id === 'longblade').price;
  assert(ItemGen.priceOf(it, game).buy === basePrice, 'unidentified trades at base price');
  ItemGen.identify(it);
  assert(ItemGen.priceOf(it, game).buy === it.price.buy && it.price.sell === Math.max(1, Math.floor(it.price.buy / 4)), 'sell = buy/4');
  const lines2 = ItemGen.itemTooltipLines(game, it);
  assert(lines2[0].text === it.name && lines2.length > lines.length - 1, 'tooltip (game, item) form');
  assert(lines2.some((l) => l.text.startsWith('Requires')), 'requirements line');
}

/* ------------------------------------------------------------------- grid */
section('grid');
{
  const inv = Inv.createInventory();
  const big = { id: 100, size: { w: 2, h: 3 }, name: 'big' };
  const r = Inv.placeAt(inv, big, 0, 0);
  assert(r.ok && !r.swapped, '2x3 placed at (0,0)');
  assert(Inv.itemAt(inv, 1, 2) === big, '(1,2) blocked by 2x3');
  assert(Inv.itemAt(inv, 2, 0) === null, '(2,0) free');
  const small = { id: 101, size: { w: 1, h: 1 }, name: 'small' };
  const r2 = Inv.placeAt(inv, small, 1, 2);
  assert(r2.ok && r2.swapped === big, 'swap returns the displaced item');
  assert(Inv.itemAt(inv, 1, 2) === small && Inv.itemAt(inv, 0, 0) === null, 'grid updated after swap');
  const other = { id: 102, size: { w: 1, h: 1 }, name: 'other' };
  Inv.placeAt(inv, other, 0, 0);
  const wide = { id: 103, size: { w: 2, h: 3 }, name: 'wide' };
  assert(Inv.placeAt(inv, wide, 0, 0).ok === false, 'two overlaps refused');
  assert(Inv.canPlace(inv, wide, 0, 0) === false && Inv.canPlace(inv, wide, 4, 0) === true, 'canPlace boolean');
  assert(Inv.placeAt(inv, wide, 9, 2).ok === false, 'out of bounds refused');
  const spot = Inv.findFreeSpot(inv, { id: 104, size: { w: 1, h: 1 } });
  assert(spot && spot.y === 3 && spot.x === 0, 'small items fill the bottom row first');
  assert(Inv.removeItem(inv, 101) === small && Inv.itemAt(inv, 1, 2) === null, 'removeItem clears cells');
}

/* ------------------------------------------------------------------ equip */
section('equip / two-handed / pickup / drop');
{
  const game = makeGame(11);
  const p = game.player;
  p.base.str = 60;
  const sword = ItemGen.generateItem(game, { level: 1, baseId: 'shortblade', quality: 'normal' });
  const shield = ItemGen.generateItem(game, { level: 1, baseId: 'buckler', quality: 'normal' });
  const maul = ItemGen.generateItem(game, { level: 10, baseId: 'maul', quality: 'normal' });
  assert(Inv.equip(game, sword).ok && Inv.equip(game, shield).ok, 'sword + shield equipped');
  // fill the grid so the shield has nowhere to go
  for (let i = 0; i < 40; i++) Inv.placeAt(p.inventory, { id: 500 + i, size: { w: 1, h: 1 }, name: 'filler' }, i % 10, Math.floor(i / 10));
  const r = Inv.equip(game, maul);
  assert(r.ok === false && r.reason === 'noRoom', 'two-hander refused: offhand occupied, no room');
  for (const id of [500, 501, 510, 511]) Inv.removeItem(p.inventory, id); // free a 2x2 hole
  const r2 = Inv.equip(game, maul);
  assert(r2.ok && r2.swapped === sword && r2.displaced === shield && !p.equipment.offhand, 'two-hander swaps weapon, moves shield to grid');
  assert(p.inventory.items[shield.id] === shield, 'shield is in the backpack');
  const ring1 = ItemGen.generateItem(game, { level: 10, baseId: 'ring' });
  const ring2 = ItemGen.generateItem(game, { level: 10, baseId: 'ring' });
  ItemGen.identify(ring1); ItemGen.identify(ring2);
  assert(Inv.equip(game, ring1).ok && p.equipment.ring1 === ring1, 'ring -> ring1');
  assert(Inv.equip(game, ring2).ok && p.equipment.ring2 === ring2, 'second ring -> ring2');
  const bow = ItemGen.generateItem(game, { level: 12, baseId: 'war_bow', quality: 'normal' });
  assert(Inv.canEquip(p, bow).reason === 'requirements', 'canEquip reports unmet requirements');
  assert(Inv.canEquip(p, bow, 'head').ok === false, 'wrong slot refused');
  // pickup / drop
  for (let i = 0; i < 40; i++) Inv.removeItem(p.inventory, 500 + i);
  const pot = ItemGen.generateSpecificBase(game, 'c_minor_heal');
  Object.assign(pot, { tx: 5, ty: 5 });
  game.level.items.push(pot);
  assert(Inv.tryPickUp(game, pot) && p.belt[0] === pot && game.level.items.length === 0, 'belt consumable goes to belt');
  const gold = ItemGen.generateGold(game, 10);
  game.level.items.push(gold);
  const before = p.gold;
  const amount = gold.count;
  assert(Inv.tryPickUp(game, gold) && p.gold === before + amount, 'gold merges into player.gold');
  assert(game.events.some(([n]) => n === 'itemPickedUp'), 'itemPickedUp emitted');
  assert(Inv.dropItem(game, shield) && game.level.items.includes(shield) && typeof shield.tx === 'number' && !p.inventory.items[shield.id], 'dropItem puts item on the floor');
  assert(game.events.some(([n]) => n === 'itemDropped'), 'itemDropped emitted');
  assert(Inv.addGold(game, 10 ** 9) < 10 ** 9 && p.gold === 100000, 'gold capped');
  assert(Inv.spendGold(game, 50) && !Inv.spendGold(game, 10 ** 9), 'spendGold');
}

/* ------------------------------------------------------------ recalc chain */
section('recalcPlayer: requirement chain');
{
  const game = makeGame(5);
  const p = game.player;
  p.base.str = 40; // maul needs 55
  const maul = ItemGen.generateItem(game, { level: 10, baseId: 'maul', quality: 'normal' });
  const ring = ItemGen.generateItem(game, { level: 10, baseId: 'ring', quality: 'normal' });
  ring.quality = 'magic'; ring.identified = true; ring.effects = { str: 20 }; ring.affixes = [{ id: 's_str_x', name: 'Titans', kind: 'suffix', stat: 'str', value: 20, priceAdd: 0, priceMult: 0 }];
  p.equipment.ring1 = ring;
  p.equipment.weapon = maul;
  Inv.recalcPlayer(game);
  assert(maul.usable === true && p.derived.dmgMax === 20, 'maul usable thanks to +20 str ring');
  p.equipment.ring1 = null;
  Inv.recalcPlayer(game);
  assert(maul.usable === false && p.derived.dmgMax === 0, 'maul excluded once the ring is gone');
  // cascade: A fails its own requirement, so B loses A's +str and fails too
  const ringA = { ...ring, id: 9001, req: { str: 0, dex: 0, mag: 30 }, effects: { str: 20 } };
  const ringB = { ...ring, id: 9002, req: { str: 60, dex: 0, mag: 0 }, effects: { life: 10 } };
  p.base.mag = 10; p.equipment.weapon = null; p.equipment.ring1 = ringA; p.equipment.ring2 = ringB;
  Inv.recalcPlayer(game);
  assert(!ringA.usable && !ringB.usable && p.derived.lifeFromItems === 0, 'requirement cascade turns both rings off');
  // layering
  p.equipment.ring1 = null; p.equipment.ring2 = null;
  const amulet = { ...ring, id: 9003, slot: 'amulet', type: 'amulet', req: { str: 0, dex: 0, mag: 0 }, effects: { life: 30, resFire: 90, acPct: 50, lightRadius: 2 } };
  const armor = ItemGen.generateItem(game, { level: 6, baseId: 'leather_jerkin', quality: 'normal' });
  p.equipment.amulet = amulet; p.equipment.body = armor;
  Inv.recalcPlayer(game);
  assert(p.derived.lifeFromItems === 30 && p.resist.fire === 75, 'life from items, resist capped at 75');
  assert(p.derived.ac === Math.floor(armor.ac * 1.5), 'acPct applied to armour AC');
  assert(p.hpMax >= 70 + 30, `hpMax includes item life (${p.hpMax})`);
  // buff via stone_skin fallback path
  p.skills.stone_skin = 1; p.mp = 50; p.mpMax = 50;
  assert(Sk.castSkill(game, p, 'stone_skin', null), 'stone_skin cast');
  assert(p.state.buffs.some((b) => b.id === 'stone_skin'), 'buff recorded');
}

/* ----------------------------------------------------------------- skills */
section('skills');
{
  const game = makeGame(9);
  const p = game.player;
  p.classId = 'hexwright'; p.level = 1; p.base.mag = 35; p.skills = { firebolt: 1 }; p.mp = 100; p.mpMax = 100;
  Sk.initSkills(skillsTheme);
  for (const s of skillsTheme) {
    let prev = Infinity;
    for (let slvl = 1; slvl <= 15; slvl++) {
      const c = Sk.manaCost({ ...p, classId: 'warden' }, s.id, slvl);
      assert(c >= s.manaMin, `${s.id} manaCost(${slvl}) >= manaMin`);
      assert(c <= prev, `${s.id} manaCost non-increasing in slvl`);
      prev = c;
    }
    let lastMax = -1;
    for (let slvl = 1; slvl <= 15; slvl++) {
      const d = Sk.skillDamage(s, 10, slvl);
      assert(d.max >= lastMax && d.min <= d.max, `${s.id} skillDamage monotonic (slvl ${slvl})`);
      lastMax = d.max;
    }
  }
  const fb = Sk.skillDef('firebolt');
  const l1 = Sk.skillDamage(fb, 1, 1);
  const l20 = Sk.skillDamage(fb, 20, 10);
  assert(l1.min === 2 && l1.max === 8, `L1 firebolt 2-8 (${l1.min}-${l1.max})`);
  assert(l20.min >= 40 && l20.max <= 90 && l20.max >= 70, `L20/S10 firebolt ~40-90 (${l20.min}-${l20.max})`);
  assert(Sk.manaCost(p, 'firebolt') === 6 && Sk.manaCost({ ...p, classId: 'warden' }, 'firebolt') === 8, 'off-class mana x1.25');
  assert(Sk.canCast(p, 'firebolt').ok && Sk.canCast(game, p, 'firebolt').ok === true, 'canCast both signatures');
  assert(Sk.canCast(p, 'nova').reason === 'notLearned', 'unknown skill cannot be cast');
  spawned.length = 0;
  const mpBefore = p.mp;
  assert(Sk.castSkill(game, p, 'firebolt', { x: 8, y: 5 }) && spawned.length === 1 && spawned[0].archetype === 'bolt', 'firebolt spawns a bolt');
  assert(p.mp === mpBefore - 6, 'mana consumed after spawn');
  p.skills.volley = 1;
  spawned.length = 0;
  assert(Sk.castSkill(game, p, 'volley', { x: 8, y: 5 }) && spawned.length === 3 && spawned.every((s) => s.archetype === 'arrow'), 'volley spawns 3 arrows');
  p.mp = 0;
  assert(!Sk.castSkill(game, p, 'firebolt', { x: 8, y: 5 }), 'no mana -> no cast');
  assert(Sk.castSkill(game, p, 'firebolt', { x: 8, y: 5 }, { free: true, slvl: 1 }), 'scroll cast is free');
  // learn
  p.mp = 0; p.mpMax = 100;
  const r1 = Sk.learnSkill(game, p, 'frost_shard');
  assert(r1.ok && p.skills.frost_shard === 1 && p.mp === 7, 'learned frost_shard with mana refund');
  p.base.mag = 18;
  assert(Sk.learnSkill(game, p, 'frost_shard').reason === 'magic' && Sk.tomeMagReq(p, 'frost_shard') === 21, 'second tome needs 20% more magic');
  assert(Sk.learnSkill(game, p, 'cleave').reason === 'class', 'class gate');
  p.skills.firebolt = 15;
  assert(Sk.learnSkill(game, p, 'firebolt').reason === 'maxLevel', 'level cap');
  assert(Sk.skillsForClass(game.theme, 'hexwright').some((s) => s.id === 'nova'), 'skillsForClass');
  const tl = Sk.skillTooltipLines(game, 'firebolt');
  assert(Array.isArray(tl) && tl[0].text === 'Firebolt', 'skillTooltipLines (game, id)');
  // heal + blink
  p.classId = 'warden'; p.skills.mend = 1; p.mp = 100; p.hp = 10; p.hpMax = 70;
  assert(Sk.castSkill(game, p, 'mend', null) && p.hp > 10, 'mend heals');
  p.skills.blink = 1;
  assert(Sk.castSkill(game, p, 'blink', { x: 2, y: 2 }) && p.tx === 2 && p.ty === 2, 'blink moves the player (fallback path)');
  // cleave: monster in front
  p.skills.cleave = 1; p.dir = 6; p.tx = 5; p.ty = 5;
  const m = { id: 77, kind: 'monster', tx: 6, ty: 5, hp: 50, hpMax: 50, level: 1, ac: 0, dead: false, flags: new Set() };
  game.level.monsters.push(m);
  game.level.occupant[5 * LEVEL_W + 6] = 77;
  const hp0 = m.hp;
  const okC = Sk.castSkill(game, p, 'cleave', m);
  assert(okC, 'cleave executed');
  assert(m.hp <= hp0, 'cleave does not heal the monster');
}

section('theme coverage');
{
  const ids = new Set(theme.bases.map((b) => b.id));
  for (const id of ['shortblade', 'longblade', 'greatblade', 'hatchet', 'war_axe', 'cudgel', 'iron_mace', 'maul', 'short_bow', 'long_bow', 'war_bow', 'ash_staff', 'bone_staff', 'rune_staff', 'wand',
    'cloth_shirt', 'leather_jerkin', 'studded_coat', 'chain_hauberk', 'plate_harness', 'cap', 'iron_helm', 'great_helm', 'buckler', 'kite_shield', 'tower_shield', 'ring', 'amulet', 'q_sealed_ledger', 'q_bell_clapper']) {
    assert(ids.has(id), `base ${id}`);
  }
  const cids = new Set(theme.consumables.map((c) => c.id));
  for (const s of skillsTheme) assert(cids.has(`c_scroll_${s.id}`) && cids.has(`c_tome_${s.id}`), `scroll+tome for ${s.id}`);
  for (const id of ['c_minor_heal', 'c_heal', 'c_full_heal', 'c_minor_mana', 'c_mana', 'c_full_mana', 'c_rejuv', 'c_full_rejuv', 'c_elixir_str', 'c_elixir_mag', 'c_elixir_dex', 'c_elixir_vit', 'c_scroll_portal', 'c_scroll_identify']) assert(cids.has(id), `consumable ${id}`);
  assert(theme.prefixes.length >= 25 && theme.suffixes.length >= 25, 'affix counts');
  assert(theme.prefixes.filter((a) => a.cursed).length + theme.suffixes.filter((a) => a.cursed).length >= 3, 'cursed affixes present');
  const stats = new Set([...theme.prefixes, ...theme.suffixes].map((a) => a.stat));
  for (const s of ['toHit', 'dmgPct', 'dmgFlat', 'ac', 'acPct', 'str', 'mag', 'dex', 'vit', 'allStats', 'life', 'mana', 'resFire', 'resCold', 'resShock', 'resArcane', 'resAll', 'lightRadius', 'attackSpeed', 'hitRecover', 'lifeSteal', 'manaSteal', 'durability', 'indestructible', 'thorns', 'knockback', 'elemDmgFire', 'spellLevels', 'manaCostPct', 'blockPct', 'walkSpeed']) assert(stats.has(s), `affix stat ${s}`);
  assert(theme.uniques.length === 8 && theme.uniques.every((u) => ids.has(u.baseId)), 'uniques reference real bases');
  const allIds = [...theme.bases, ...theme.consumables, ...theme.prefixes, ...theme.suffixes, ...theme.uniques].map((x) => x.id);
  assert(new Set(allIds).size === allIds.length, 'ids unique');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

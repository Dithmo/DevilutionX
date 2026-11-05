#!/usr/bin/env node
/**
 * Print a generated level as ASCII for eyeballing the generators.
 *
 *   node tools/levelgen_ascii.mjs [seed] [depth]      (depth 0 = town)
 *
 * Legend: # wall  o pillar/fence  . floor  + door  < > stairs  ~ water
 *         C chest  B breakable  A altar  L lever  S sign  F fountain  K bookstand
 *         M monster  U unique  $ gold  * item  @ entry  N npc  & decor
 *
 * Also exports makeStubGame() used by tools/unit_levels.mjs: a game object
 * with the real rng/bus/theme data files written by this module's owner and
 * stub seams for the modules other agents write (real ones are used when
 * they exist).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => pathToFileURL(path.join(ROOT, p)).href;

const { createRng } = await import(src('src/core/rng.js'));
const { createBus } = await import(src('src/core/events.js'));
const { T } = await import(src('src/world/tiles.js'));
const { LEVELS } = await import(src('data/balance/levels.js'));
const { tilesets } = await import(src('data/themes/default/tilesets.js'));
const { tiers, town, maxDepth } = await import(src('data/themes/default/world.js'));
const { objects, altarEffects, objectTexts } = await import(src('data/themes/default/objects.js'));
const levelgen = await import(src('src/world/levelgen/index.js'));

const STUB_ITEM_LEVEL_SCALE = 1;
const STUB_GOLD = [5, 40];
const STUB_HP = 10;

/** Stub implementations of other agents' seams (only used when the real modules are missing). */
export function stubDeps() {
  const place = (game, typeId, tx, ty, opts = {}) => {
    const level = opts.level || game.level;
    const m = { id: game.nextId++, kind: 'monster', typeId, name: typeId, tx, ty, ox: 0, oy: 0, dir: 0, anim: 'stand', frame: 0, frameTicks: 8, frameAcc: 0,
      path: null, moveSpeed: 0.1, hp: STUB_HP, hpMax: STUB_HP, dead: false, look: {}, flash: 0, flags: new Set(opts.unique ? ['unique'] : []), unique: !!opts.unique, stub: true };
    level.monsters.push(m);
    level.occupant[ty * level.tiles.w + tx] = m.id;
    return m;
  };
  return {
    spawnMonster: (game, typeId, tx, ty, opts) => (levelgen.isWalkable(game.level, tx, ty) ? place(game, typeId, tx, ty, opts) : null),
    spawnPack: (game, typeId, tx, ty, opts = {}) => {
      const out = [];
      for (let i = 0; i < (opts.size || 1); i++) {
        const s = levelgen.freeTileNear(game.level, tx, ty, 3, () => true);
        if (s) out.push(place(game, typeId, s.x, s.y, opts));
      }
      return out;
    },
    placeMonstersForLevel: (game, level, tier) => {
      const rng = game.rng.fork('stub-monsters');
      let n = 0;
      for (let t = 0; t < 200 && n < 12; t++) {
        const x = rng.range(1, level.tiles.w - 2);
        const y = rng.range(1, level.tiles.h - 2);
        if (!levelgen.isWalkable(level, x, y) || (level.tiles.flags[y * level.tiles.w + x] & (T.NO_SPAWN | T.DOOR))) continue;
        if (level.objects.some((o) => o.tx === x && o.ty === y)) continue;
        place(game, rng.pick(tier.monsterPool), x, y, { level });
        n++;
      }
    },
    generateItem: (game, spec) => ({ id: game.nextId++, baseId: spec.baseId || 'stub_item', name: spec.baseId || 'Stub Item', slot: 'weapon', type: 'sword', size: { w: 1, h: 1 },
      quality: spec.quality === 'good' ? 'magic' : 'normal', identified: false, level: spec.level * STUB_ITEM_LEVEL_SCALE, req: {}, dmg: null, ac: null, dur: null, affixes: [], unique: null, effects: {}, charges: null, count: 1, price: { buy: 1, sell: 1 }, look: { glyph: 'blade', color: '#ccc' }, seed: 0, stub: true }),
    generateGold: (game, level) => ({ id: game.nextId++, baseId: 'gold', name: 'Gold', slot: 'gold', type: 'gold', size: { w: 1, h: 1 }, quality: 'normal', identified: true, level, count: game.rng.range(STUB_GOLD[0], STUB_GOLD[1]), look: { glyph: 'coin', color: '#e0c040' }, stub: true }),
    spawnMissile: (game, spec) => ({ id: game.nextId++, ...spec, dead: false, stub: true }),
  };
}

/**
 * Build a stub game for tools/tests.
 * @param {number} seed
 * @returns {Promise<object>} game
 */
export async function makeStubGame(seed) {
  await levelgen.levelDepsReady;
  const real = levelgen.levelDeps;
  const stubs = stubDeps();
  const missing = {};
  for (const k of Object.keys(stubs)) if (!real[k]) missing[k] = stubs[k];
  levelgen.setLevelDeps(missing);
  const bus = createBus();
  const game = {
    seed, tick: 0, mode: 'dungeon', rng: createRng(seed), bus,
    theme: { tilesets, tiers, town, maxDepth, objects, altarEffects, objectTexts, npcs: [], palette: { text: '#eee', good: '#8f8', danger: '#f66', accent: '#fc8' }, flavor: { levelName: (d, t) => `${t} ${d}` } },
    balance: { levels: LEVELS }, strings: {}, level: null, town: null, levels: {}, hooks: {},
    player: { id: 1, kind: 'player', tx: 0, ty: 0, ox: 0, oy: 0, hp: 50, hpMax: 50, mp: 20, mpMax: 20, base: { str: 10, mag: 10, dex: 10, vit: 10 }, resist: {}, gold: 0,
      equipment: {}, inventory: { items: {} }, belt: [], skills: { firebolt: 1 }, state: { buffs: [] }, path: null },
    ui: { messages: [] }, nextId: 2, stats: {}, debug: {}, stubDeps: Object.keys(missing),
  };
  bus.on('message', (m) => game.ui.messages.push(m));
  return game;
}

/** @returns {string[]} rows of ASCII for a level */
export function levelToAscii(level) {
  const t = level.tiles;
  const rows = [];
  const glyph = new Map();
  const mark = (x, y, g) => glyph.set(y * t.w + x, g);
  for (const it of level.items) mark(it.tx, it.ty, it.slot === 'gold' ? '$' : '*');
  for (const o of level.objects) {
    const g = { chest: 'C', breakable: 'B', altar: 'A', lever: 'L', sign: 'S', fountain: 'F', bookstand: 'K', trap: 'T', portal: 'P' }[o.kind];
    if (o.decor) mark(o.tx, o.ty, '&'); else if (g) mark(o.tx, o.ty, g);
  }
  for (const m of level.monsters) mark(m.tx, m.ty, m.unique || m.flags?.has?.('unique') ? 'U' : 'M');
  for (const n of level.npcs) mark(n.tx, n.ty, 'N');
  if (level.entry) mark(level.entry.x, level.entry.y, '@');
  for (let y = 0; y < t.h; y++) {
    let s = '';
    for (let x = 0; x < t.w; x++) {
      const i = y * t.w + x;
      const f = t.flags[i];
      if (f & T.STAIRS_UP) s += '<';
      else if (f & T.STAIRS_DOWN) s += '>';
      else if (f & T.DOOR) s += '+';
      else if (f & T.WATER) s += '~';
      else if (glyph.has(i)) s += glyph.get(i);
      else if (t.wall[i] === 2) s += 'o';
      else if (t.wall[i]) s += '#';
      else if (t.floor[i]) s += '.';
      else s += ' ';
    }
    rows.push(s);
  }
  return rows;
}

async function main() {
  const seed = Number(process.argv[2] || 1);
  const depth = Number(process.argv[3] || 1);
  const game = await makeStubGame(seed);
  const level = levelgen.generateLevel(game, depth);
  console.log(levelToAscii(level).join('\n'));
  const rooms = level.rooms.map((r) => r.kind).reduce((acc, k) => ({ ...acc, [k]: (acc[k] || 0) + 1 }), {});
  console.log(`seed ${seed} depth ${depth} ${level.name} [${level.tilesetId}] ${level.tiles.w}x${level.tiles.h} floor=${level.floorCount ?? '-'} attempts=${level.attempts ?? '-'}${level.relaxed ? ' RELAXED' : ''}`);
  console.log(`objects=${level.objects.length} monsters=${level.monsters.length} items=${level.items.length} npcs=${level.npcs.length} rooms=${JSON.stringify(rooms)} stamps=${level.questStamps.map((s) => s.kind).join(',') || '-'} stubs=${game.stubDeps.join(',') || 'none'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

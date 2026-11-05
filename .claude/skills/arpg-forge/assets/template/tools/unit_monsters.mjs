#!/usr/bin/env node
/**
 * Unit checks for the monster / AI / missile cluster. Runs standalone: a fake
 * 40×40 open level, stub player, and stubbed combat/player/itemgen functions
 * (the real modules are tried first and wrapped when present).
 *
 *   node tools/unit_monsters.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => pathToFileURL(path.join(ROOT, p)).href;

const { createTiles, fillRect, T } = await import(src('src/world/tiles.js'));
const { createRng } = await import(src('src/core/rng.js'));
const { createBus } = await import(src('src/core/events.js'));
const { createLightMap } = await import(src('src/world/fov.js'));
const theme = await import(src('data/themes/default/monsters.js'));
const balMonsters = (await import(src('data/balance/monsters.js'))).default;
const balMissiles = (await import(src('data/balance/missiles.js'))).default;
const monster = await import(src('src/entities/monster.js'));
const missile = await import(src('src/entities/missile.js'));

const W = 40;
const H = 40;
const SEED = 1337;
const PLAYER = { x: 20, y: 20 };
const RUSH_TICKS = 200;
const RANGED_TICKS = 120;
const BOLT_TICKS = 80;
const CHAIN_TICKS = 60;
const KILLS = 30;
const PACK_SIZE = 4;

let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`  FAIL ${msg}`); process.exitCode = 1; throw new Error(msg); }
  passed++;
  console.log(`  ok   ${msg}`);
}

// --- dependency stubs (real modules wrapped when they load) --------------------------------------
const calls = { giveXp: 0, generateItem: 0, generateGold: 0, applyDamageToPlayer: 0, applyDamageToMonster: 0 };
const stubs = {
  rollPlayerHitsMonster: (game, p) => ({ hit: true, dmg: game.rng.range(p.derived.dmgMin, p.derived.dmgMax), crit: false }),
  rollMonsterHitsPlayer: (game, m) => ({ hit: true, blocked: false, dmg: game.rng.range(m.dmgMin, m.dmgMax) }),
  applyDamageToMonster: (game, m, dmg) => { m.hp -= dmg; },
  applyDamageToPlayer: (game, p, dmg) => { p.hp -= dmg; },
  giveXp: () => {},
  generateItem: (game, spec) => ({ id: game.nextId++, baseId: 'stub', name: 'Stub', slot: 'weapon', level: spec.level, look: {} }),
  generateGold: (game, level) => ({ id: game.nextId++, baseId: 'gold', slot: 'gold', count: level * 5, look: {} }),
};
/** Prefer the real module's function, fall back to the stub when it is missing or throws; count every call. */
async function wrap(modPath, names) {
  let mod = null;
  try { mod = await import(src(modPath)); } catch (err) { /* not written yet */ }
  const out = {};
  for (const n of names) {
    const real = mod && typeof mod[n] === 'function' ? mod[n] : null;
    out[n] = (...args) => {
      if (n in calls) calls[n]++;
      if (real) { try { return real(...args); } catch (err) { /* fall through to stub */ } }
      return stubs[n](...args);
    };
  }
  console.log(`  deps ${modPath}: ${mod ? 'real' : 'stub'}`);
  return out;
}
monster.setMonsterDeps({
  ...(await wrap('src/entities/combat.js', ['rollPlayerHitsMonster', 'rollMonsterHitsPlayer', 'applyDamageToMonster', 'applyDamageToPlayer'])),
  ...(await wrap('src/entities/player.js', ['giveXp'])),
  ...(await wrap('src/items/itemgen.js', ['generateItem', 'generateGold'])),
  // Optional combat.js pipelines need a full player (state, class); pin them off so the
  // CONTRACTS primitives above are used against the stub player.
  monsterMeleeHit: null, playerMissileHit: null, monsterMissileHit: null,
});

// --- fake game -----------------------------------------------------------------------------------
function makeGame(seed = SEED) {
  const tiles = createTiles(W, H);
  fillRect(tiles, 0, 0, W, H, { floor: 1, wall: 0, flags: 0 });
  fillRect(tiles, 0, 0, W, 1, { floor: 0, wall: 1, flags: T.SOLID | T.BLOCKS_LIGHT });
  fillRect(tiles, 0, H - 1, W, 1, { floor: 0, wall: 1, flags: T.SOLID | T.BLOCKS_LIGHT });
  fillRect(tiles, 0, 0, 1, H, { floor: 0, wall: 1, flags: T.SOLID | T.BLOCKS_LIGHT });
  fillRect(tiles, W - 1, 0, 1, H, { floor: 0, wall: 1, flags: T.SOLID | T.BLOCKS_LIGHT });
  const lm = createLightMap(tiles);
  const level = {
    depth: 1, tier: 0, tilesetId: 'undercroft', tiles, light: lm.light, explored: lm.explored, occupant: new Int32Array(W * H),
    monsters: [], objects: [], items: [], missiles: [], npcs: [], stairs: { up: null, down: null, town: null },
    entry: { x: 2, y: 2 }, rooms: [{ x: 1, y: 1, w: W - 2, h: H - 2, kind: 'hall' }], seed, visited: true, cleared: false, portal: null,
  };
  const player = {
    id: 1, kind: 'player', tx: PLAYER.x, ty: PLAYER.y, ox: 0, oy: 0, dir: 0, anim: 'stand', frame: 0, path: null,
    hp: 1000, hpMax: 1000, dead: false, level: 5, derived: { dmgMin: 5, dmgMax: 10, toHit: 80, ac: 10 }, look: {}, flash: 0,
  };
  level.occupant[player.ty * W + player.tx] = player.id;
  const events = [];
  const bus = createBus();
  for (const n of ['sfx', 'float', 'message', 'monsterKilled', 'itemDropped']) bus.on(n, (p) => events.push({ n, p }));
  const game = {
    seed, tick: 0, mode: 'dungeon', rng: createRng(seed), bus, events,
    theme: { monsters: theme.monsters, uniqueMonsters: theme.uniques, palette: { danger: '#f44' } },
    balance: { monsters: balMonsters, missiles: balMissiles }, level, player, nextId: 2, difficulty: 0, quests: {}, stats: { kills: 0 },
    ui: { messages: [], floats: [] },
  };
  return game;
}
function step(game, n = 1) {
  for (let i = 0; i < n; i++) {
    game.tick++;
    monster.updateMonsters(game);
    missile.updateMissiles(game);
  }
}
const occ = (game, x, y) => game.level.occupant[y * W + x];

// --- tests -----------------------------------------------------------------------------------------
console.log('spawnPack');
{
  const game = makeGame();
  const pack = monster.spawnPack(game, 'bonepicker', 10, 10, PACK_SIZE);
  assert(pack.length === PACK_SIZE, `spawnPack placed ${PACK_SIZE} monsters`);
  const keys = new Set(pack.map((m) => `${m.tx},${m.ty}`));
  assert(keys.size === PACK_SIZE, 'all on distinct tiles');
  assert(pack.every((m) => occ(game, m.tx, m.ty) === m.id), 'occupant grid holds each id');
  assert(pack.slice(1).every((m) => m.leaderId === pack[0].id && m.packId === pack[0].packId), 'followers point at the leader');
  assert(pack.every((m) => m.hp >= 1 && m.hp <= m.hpMax), 'hp rolled in range');
}

console.log('rusher closes distance');
{
  const game = makeGame();
  const m = monster.spawnMonster(game, 'thornling', PLAYER.x + 8, PLAYER.y, {});
  let reached = -1;
  for (let t = 0; t < RUSH_TICKS && reached < 0; t++) {
    step(game);
    if (Math.max(Math.abs(m.tx - PLAYER.x), Math.abs(m.ty - PLAYER.y)) <= 1) reached = game.tick;
  }
  assert(m.awake, 'rusher woke up on its own (LOS + wake radius)');
  assert(reached > 0, `rusher adjacent after ${reached} ticks (≤ ${RUSH_TICKS})`);
  step(game, 60);
  assert(calls.applyDamageToPlayer > 0, 'rusher attacked the player through combat deps');
  assert(occ(game, m.tx, m.ty) === m.id && game.level.occupant.filter((v) => v === m.id).length === 1, 'monster occupies exactly one tile');
}

console.log('ranged fires');
{
  const game = makeGame();
  const before = calls.applyDamageToPlayer;
  monster.spawnMonster(game, 'hollow_archer', PLAYER.x + 5, PLAYER.y, {});
  let maxMissiles = 0;
  let shots = 0;
  for (let t = 0; t < RANGED_TICKS; t++) {
    step(game);
    maxMissiles = Math.max(maxMissiles, game.level.missiles.filter((ms) => ms.archetype === 'arrow').length);
  }
  shots = game.events.filter((e) => e.n === 'sfx' && e.p.name === 'bowShot').length;
  assert(maxMissiles >= 1 && shots >= 1, `ranged monster fired ${shots} arrow(s)`);
  assert(calls.applyDamageToPlayer > before, 'an arrow reached the player');
}

console.log('bolt dies on wall');
{
  const game = makeGame();
  const ms = missile.spawnMissile(game, { archetype: 'bolt', owner: game.player, from: { x: 20, y: 10 }, to: { x: 20, y: 0 }, dmg: { min: 1, max: 2 }, element: 'fire' });
  assert(game.level.missiles.includes(ms), 'bolt spawned');
  step(game, BOLT_TICKS);
  assert(ms.dead && !game.level.missiles.includes(ms), 'bolt removed after hitting the wall');
  assert(ms.ty >= 0 && ms.ty <= 1, `bolt stopped at the wall row (ty=${ms.ty})`);
}

console.log('nova');
{
  const game = makeGame();
  const nova = missile.spawnMissile(game, { archetype: 'nova', owner: game.player, from: PLAYER, dmg: { min: 3, max: 5 }, element: 'shock' });
  assert(nova.children.length === balMissiles.arch.nova.count && balMissiles.arch.nova.count === 16, 'nova spawned 16 children');
  assert(game.level.missiles.length === 16, '16 live bolts on the level');
  step(game, 5);
  assert(game.level.missiles.every((ms) => Math.hypot(ms.x - 20.5, ms.y - 20.5) > 1), 'nova bolts travel outward');
}

console.log('chain lightning');
{
  const game = makeGame();
  const dummies = [[30, 20], [31, 20], [32, 20]].map(([x, y]) => monster.spawnMonster(game, 'tallow_brute', x, y, {}));
  assert(dummies.every(Boolean), 'three adjacent dummies spawned');
  const ms = missile.spawnMissile(game, { archetype: 'chain', owner: game.player, from: { x: 26, y: 20 }, to: { x: 30, y: 20 }, dmg: { min: 10, max: 10 }, element: 'shock' });
  step(game, CHAIN_TICKS);
  const hurt = dummies.filter((m) => m.hp < m.hpMax).length;
  assert(hurt === 3, `chain hit all 3 dummies (${hurt})`);
  assert(dummies.every((m) => ms.hitSet.has(m.id)), 'hitSet lists each target once');
  assert(ms.dead, 'chain finished');
}

console.log('killMonster');
{
  const game = makeGame();
  let maxItemsPerKill = 0;
  for (let i = 0; i < KILLS; i++) {
    const m = monster.spawnMonster(game, 'shambler', 5 + (i % 10) * 3, 5 + Math.floor(i / 10) * 3, {});
    const before = game.level.items.length;
    const xpBefore = calls.giveXp;
    monster.killMonster(game, m, game.player);
    assert(m.dead && occ(game, m.tx, m.ty) === 0, `kill #${i + 1} freed the tile`);
    maxItemsPerKill = Math.max(maxItemsPerKill, game.level.items.length - before);
    if (i === 0) assert(calls.giveXp === xpBefore + 1, 'XP granted once');
    monster.killMonster(game, m, game.player);
  }
  assert(maxItemsPerKill <= 1, `at most one loot item per kill (max ${maxItemsPerKill})`);
  assert(game.level.items.length > 0, `some kills dropped loot (${game.level.items.length}/${KILLS})`);
  assert(game.events.filter((e) => e.n === 'monsterKilled').length === KILLS, 'monsterKilled emitted once per kill');
  assert(game.stats.kills === KILLS, 'stats.kills counted');
  const m = monster.spawnMonster(game, 'shambler', 20, 30, {});
  m.hp = 0;
  step(game, 1);
  assert(m.dead, 'updateMonsters kills a monster whose hp reached 0 outside killMonster');
}

console.log('more archetypes');
{
  const game = makeGame();
  const c = monster.spawnMonster(game, 'pit_hound', PLAYER.x + 6, PLAYER.y, {});
  let charged = false;
  for (let t = 0; t < 200 && !charged; t++) { step(game); if (c.charging) charged = true; }
  assert(charged, 'charger launched a charge when aligned');
  step(game, 40);
  assert(!c.charging && game.level.occupant.filter((v) => v === c.id).length === 1, 'charge ended with a consistent occupant grid');

  const g2 = makeGame();
  const sp = monster.spawnMonster(g2, 'gravecaller', PLAYER.x + 5, PLAYER.y + 5, {});
  let minions = 0;
  for (let t = 0; t < 400; t++) { step(g2); minions = Math.max(minions, g2.level.monsters.filter((m) => m.ownerId === sp.id && !m.dead).length); }
  assert(minions >= 1 && minions <= balMonsters.ai.spawner.cap, `spawner summoned ${minions} minion(s) within the cap`);

  const g3 = makeGame();
  const ward = missile.spawnMissile(g3, { archetype: 'summon', owner: g3.player, from: PLAYER, to: { x: PLAYER.x + 1, y: PLAYER.y }, typeId: 'rust_sentinel', level: 3 });
  const w = ward.children[0];
  assert(w && w.ally && w.ai === 'ally', 'summon created an allied ward');
  const foe = monster.spawnMonster(g3, 'shambler', PLAYER.x + 4, PLAYER.y, {});
  step(g3, 150);
  assert(foe.hp < foe.hpMax || foe.dead, 'ward attacked the hostile monster');

  const g4 = makeGame();
  const ambusher = monster.spawnMonster(g4, 'root_crawler', PLAYER.x + 6, PLAYER.y, {});
  step(g4, 40);
  assert(ambusher.hidden && ambusher.tx === PLAYER.x + 6, 'ambusher stays hidden at range');
  g4.player.tx = PLAYER.x + 4; g4.level.occupant[PLAYER.y * W + PLAYER.x] = 0; g4.level.occupant[PLAYER.y * W + PLAYER.x + 4] = 1;
  step(g4, 20);
  assert(!ambusher.hidden, 'ambusher revealed when approached');

  const g5 = makeGame();
  const before = g5.player.hp;
  missile.spawnMissile(g5, { archetype: 'wall', owner: null, ownerKind: 'trap', from: { x: 16, y: 20 }, to: { x: 20, y: 20 }, dmg: { min: 4, max: 6 }, element: 'fire' });
  const segs = g5.level.missiles.filter((ms) => ms.archetype === 'wallSeg');
  assert(segs.length === balMissiles.arch.wall.segments, `wall placed ${segs.length} segments`);
  step(g5, 20);
  assert(g5.player.hp < before, 'wall segment under the player dealt damage');

  const g6 = makeGame();
  monster.spawnMonster(g6, 'tallow_brute', 28, 20, {});
  const hm = missile.spawnMissile(g6, { archetype: 'homing', owner: g6.player, from: { x: 24, y: 24 }, to: { x: 24, y: 10 }, dmg: { min: 5, max: 5 }, element: 'arcane' });
  const dmgBefore = calls.applyDamageToMonster;
  step(g6, 80);
  assert(hm.dead && hm.hitSet.size === 1 && calls.applyDamageToMonster > dmgBefore, 'homing missile curved into the target');

  const g7 = makeGame();
  const blinker = monster.spawnMonster(g7, 'lantern_wisp', 10, 10, {});
  missile.spawnMissile(g7, { archetype: 'blink', owner: blinker, from: { x: 10, y: 10 }, to: { x: 14, y: 14 } });
  assert(blinker.tx === 14 && blinker.ty === 14 && occ(g7, 14, 14) === blinker.id && occ(g7, 10, 10) === 0, 'blink moved the owner and the occupant id');
  assert(missile.spawnMissile(g7, { archetype: 'blink', owner: blinker, from: { x: 14, y: 14 }, to: { x: 14, y: 14 } }) === null, 'blink to own tile fizzles (returns null)');

  // skills/cast.js conventions: world-space from/to, zero-valued fields meaning "default", glyph looks, duration/length
  const g8 = makeGame();
  const sb = missile.spawnMissile(g8, { archetype: 'bolt', owner: g8.player, ownerKind: 'player', ownerId: 1, from: { x: 20.5, y: 20.5 }, to: { x: 30.5, y: 20.5 },
    skillId: 'firebolt', level: 1, dmg: { min: 2, max: 4 }, element: 'fire', look: { color: '#f80', glyph: 'beam' }, speed: 0, range: 0, radius: 0, count: 0, pierce: false, duration: 0, length: 0 });
  assert(sb && sb.speed === balMissiles.arch.bolt.speed && sb.range === balMissiles.arch.bolt.range && sb.look.shape === 'bolt' && Math.abs(sb.x - 20.5) < 1e-9, 'cast.js-style spec normalised');
  const sw = missile.spawnMissile(g8, { archetype: 'wall', owner: g8.player, from: { x: 20.5, y: 20.5 }, to: { x: 24.5, y: 20.5 }, dmg: { min: 1, max: 2 }, element: 'fire', speed: 0, range: 160, length: 3, duration: 100 });
  assert(sw.children.length === 7 && sw.children[0].range === 100, 'wall honours length (2·3+1 segments) and duration');
  g8.difficulty = 'nightmare';
  assert(monster.spawnMonster(g8, 'shambler', 5, 5, {}).level === 1 + balMonsters.difficulty[1].levelAdd, 'string difficulty names resolve');
}

console.log('placeMonstersForLevel');
{
  const game = makeGame();
  const tier = { id: 't1', name: 'The Undercroft', tilesetId: 'undercroft', depths: [1, 4], monsterLevel: [1, 6], bossId: 'u_gorrak',
    monsterPool: ['shambler', 'shambler_2', 'bonepicker', 'bonepicker_2', 'cave_bat', 'rust_sentinel'], objectPool: [], themedRooms: [] };
  game.level.depth = 2;
  game.level.questStamps = [{ kind: 'bossRoom', uniqueId: 'u_gorrak', x: 30, y: 30 }];
  const n = monster.placeMonstersForLevel(game, game.level, tier);
  const live = game.level.monsters;
  assert(n >= balMonsters.perLevelBase && live.length === n, `placed ${n} monsters`);
  const near = live.filter((m) => Math.max(Math.abs(m.tx - 2), Math.abs(m.ty - 2)) < balMonsters.entryExclusion);
  assert(near.length === 0, 'none within 10 tiles of the entry');
  assert(live.some((m) => m.unique === 'u_gorrak'), 'quest unique stamped');
  const g = live.find((m) => m.unique === 'u_gorrak');
  assert(Math.max(Math.abs(g.tx - 30), Math.abs(g.ty - 30)) <= 2 && live.some((m) => m.leaderId === g.id), 'unique near its stamp with followers');
  assert(live.every((m) => occ(game, m.tx, m.ty) === m.id), 'every placed monster owns its tile');
  const types = new Set(live.filter((m) => !m.unique && !m.leaderId).map((m) => m.typeId));
  assert(types.size >= 1 && types.size <= balMonsters.typesPerLevel[1], `${types.size} distinct types`);
}

console.log('difficulty scaling');
{
  const game = makeGame();
  game.difficulty = 1;
  const m = monster.spawnMonster(game, 'shambler', 10, 10, {});
  const d = balMonsters.difficulty[1];
  assert(m.hpMax >= 4 * d.hpMult + d.hpAdd && m.level === 1 + d.levelAdd && m.toHit === 15 + d.toHitAdd, 'difficulty 1 scaling applied (hp ×3+100, lvl +15, toHit +85)');
  assert(m.dmgMin === (1 + d.dmgPreAdd) * d.dmgMult, 'damage scaled 2·(d+2)');
}

console.log(`\n${passed} assertions passed`);

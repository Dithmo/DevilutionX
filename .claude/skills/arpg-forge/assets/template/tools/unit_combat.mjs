#!/usr/bin/env node
/**
 * Unit test for the player / combat modules with a minimal fake game.
 *   node tools/unit_combat.mjs
 * Pure modules are imported directly; facades that depend on sibling
 * systems (items, skills, missiles, monsters) are loaded in try/catch so the
 * test runs before those modules exist.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { createRng } = await mod('src/core/rng.js');
const { createBus } = await mod('src/core/events.js');
const { createTiles, fillRect, T } = await mod('src/world/tiles.js');
const R = await mod('src/entities/combat_rolls.js');
const P = await mod('data/balance/progression.js');
const A = await mod('src/entities/anim.js');
const S = await mod('src/entities/player_stats.js');
const M = await mod('src/entities/player_move.js');
const classes = (await mod('data/themes/default/classes.js')).default;

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`);
}
function assertEq(a, b, msg) { assert(a === b, `${msg} (got ${a}, want ${b})`); }

const W = 20, H = 20;
function fakeLevel() {
  const tiles = createTiles(W, H);
  fillRect(tiles, 0, 0, W, H, { floor: 1, wall: 0, flags: 0 });
  for (let x = 0; x < W; x++) { tiles.wall[x] = 1; tiles.wall[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { tiles.wall[y * W] = 1; tiles.wall[y * W + W - 1] = 1; }
  return { depth: 1, tiles, occupant: new Int32Array(W * H), monsters: [], objects: [], items: [], missiles: [], npcs: [] };
}
function fakeGame(seed = 7) {
  const bus = createBus();
  const log = [];
  for (const n of ['message', 'float', 'sfx', 'levelUp', 'playerHit', 'playerDied']) bus.on(n, (pl) => log.push({ n, pl }));
  return {
    seed, tick: 0, mode: 'dungeon', rng: createRng(seed), bus, log,
    theme: { classes, palette: { danger: '#f00', good: '#0f0', xp: '#ff0', textDim: '#888' }, flavor: { deathLines: ['The watch falls silent.'] }, items: { consumables: [] }, skills: [] },
    balance: {}, strings: {}, level: fakeLevel(), nextId: 1, stats: { kills: 0, deaths: 0 }, debug: {}, ui: {},
  };
}

console.log('== class pools (reference level-1 table) ==');
{
  const g = fakeGame();
  const w = S.createPlayerBase(g, 'warden', 'W');
  assertEq(w.hpMax, 70, 'warden life'); assertEq(w.mpMax, 10, 'warden mana');
  const s = S.createPlayerBase(g, 'stalker', 'S');
  assertEq(s.hpMax, 45, 'stalker life'); assertEq(s.mpMax, 23, 'stalker mana');
  const h = S.createPlayerBase(g, 'hexwright', 'H');
  assertEq(h.hpMax, 30, 'hexwright life'); assertEq(h.mpMax, 70, 'hexwright mana');
  assertEq(w.skills.cleave, 1, 'warden starts with cleave');
  assertEq(JSON.stringify(w).includes('"_cls"'), false, '_cls is not serialized');
}

console.log('== to-hit / block formulas ==');
{
  const g = fakeGame();
  const p = S.createPlayerBase(g, 'warden', 'W');
  const cls = p._cls;
  assertEq(R.playerMeleeToHit(p, cls), 81, 'A.1 melee to-hit 81');
  assertEq(R.playerRangedToHit(p, cls), 91, 'A.1 ranged to-hit 91 (class base shared)');
  assertEq(R.playerArmor(p), 4, 'A.1 armor = dex/5');
  assertEq(R.blockChance(p, cls, 0), 52, 'A.1 block 52');
  assert(!R.canBlock(p), 'no block without shield');
  p.equipment.offhand = { type: 'shield' };
  assert(R.canBlock(p), 'can block standing with shield');
  assertEq(R.playerHitChance(p, cls, { ac: 1000, level: 1 }), 5, 'to-hit clamps to 5');
  assertEq(R.playerHitChance(p, cls, { ac: -1000, level: 1 }), 95, 'to-hit clamps to 95');
  assertEq(R.playerHitChance(p, cls, { ac: 10, level: 1 }, { ranged: true, dist: 6 }), 91 - 10 - 18, 'arrow falloff dist^2/2');
  const far = { toHit: 0, level: 1 };
  p.derived.ac = 500;
  assertEq(R.monsterHitChance(far, p, 1), 15, 'monster floor 15 shallow');
  assertEq(R.monsterHitChance(far, p, 16), 30, 'monster floor 30 at depth 16');
  assertEq(R.monsterHitChance(far, p, 1, { missile: true }), 10, 'missile floor 10');
  p.derived.ac = 0;
  assertEq(R.monsterHitChance({ toHit: 20, level: 1 }, p, 1), 46, 'monster melee 20+0+30-4');
  p.base.dex = 750;
  assertEq(R.blockChance(p, cls, 1), 100, 'block never exceeds 100');
  p.base.dex = 0;
  assertEq(R.blockChance(p, cls, 60), 0, 'block never below 0');
  assertEq(R.manaShieldAbsorb(100, 50, 3).dmg, 47, 'A.4 mana shield 47 through');
  assertEq(R.manaShieldAbsorb(100, 50, 3).broke, true, 'A.4 shield breaks');
  assertEq(R.resistMultiplier({ resist: { fire: 1 } }, 'fire'), 0.25, 'resist = 1/4');
  assertEq(R.resistMultiplier({ resist: { fire: 2 } }, 'fire'), 0, 'immune = 0');
  assertEq(R.resistMultiplier({ kind: 'player', resist: { fire: 50 } }, 'fire'), 0.5, 'player resist %');
  assert(R.monsterStaggers({ level: 5 }, 8) && !R.monsterStaggers({ level: 5 }, 7), 'monster stagger at mLvl+3');
  assert(R.playerStaggers({ level: 5 }, cls, 5) && !R.playerStaggers({ level: 5 }, cls, 4), 'player stagger at cLvl');
}

console.log('== 1000 monster->player rolls ==');
{
  const g = fakeGame(99);
  const p = S.createPlayerBase(g, 'warden', 'W');
  const m = { toHit: 20, level: 1, dmgMin: 1, dmgMax: 3 };
  const chance = R.monsterHitChance(m, p, 1);
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (g.rng.rand(100) < chance) hits++;
  assert(hits >= 400 && hits <= 520, `hit rate ${hits / 10}% within 40..52 band for chance ${chance}`);
}

console.log('== XP / levels ==');
{
  const g = fakeGame();
  const p = S.createPlayerBase(g, 'warden', 'W');
  g.player = p;
  assertEq(P.xpThreshold(1), 2000, 'threshold L1');
  assertEq(P.xpThreshold(50), 1583495809, 'threshold L50');
  assertEq(P.xpForMonster(1, 1, 10), 10, 'xp flat at equal level');
  assertEq(P.xpForMonster(6, 1, 10), 15, 'xp +10%/level above');
  assertEq(P.xpForMonster(1, 30, 100), 0, 'xp floors at 0');
  assertEq(P.xpForMonster(50, 1, 100000), 100, 'xp capped at threshold/20');
  S.giveXp(g, 1999); assertEq(p.level, 1, 'no level at 1999');
  S.giveXp(g, 1); assertEq(p.level, 2, 'level 2 at 2000');
  assertEq(p.statPoints, 5, '+5 stat points'); assertEq(p.hpMax, 72, 'life +2 per level');
  S.giveXp(g, 2620); assertEq(p.level, 3, 'level 3 at 4620');
  assert(g.log.some((e) => e.n === 'levelUp' && e.pl.level === 3), 'levelUp event emitted');
  assert(S.spendStat(g, 'vit'), 'spend vit'); assertEq(p.hpMax, 76, 'vit adds lifePerVit');
  S.giveXp(g, 2e9); assertEq(p.level, 50, 'max level 50 from huge xp');
  assertEq(S.spendStat(g, 'mag') && p.base.mag <= 50, true, 'base stat never exceeds cap');
  S.applyBuff(g, p, { id: 'stone_skin', stat: 'ac', value: 20, duration: 2 });
  assertEq(R.playerArmor(p) >= 20, true, 'buff ac counted');
  S.tickBuffs(g, p); S.tickBuffs(g, p);
  assertEq(p.state.buffs.length, 0, 'buff expires');
}

console.log('== anim timing ==');
{
  const e = {};
  A.setAnim(e, 'attack', 2, A.ANIM_FRAMES.attack, 5);
  let actionTick = -1, wrapTick = -1;
  for (let t = 1; t <= 20 && wrapTick < 0; t++) {
    const wrapped = A.advanceAnim(e);
    if (A.actionFrameReached(e) && actionTick < 0) actionTick = t;
    if (wrapped) wrapTick = t;
  }
  assertEq(actionTick, 10, 'action frame 5 at 2 ticks/frame fires on tick 10');
  assertEq(wrapTick, 16, '8 frames x 2 ticks wraps on tick 16');
  A.setAnim(e, 'death', 1, 10);
  for (let t = 0; t < 30; t++) A.advanceAnim(e);
  assertEq(e.frame, 9, 'death holds last frame');
}

console.log('== walking ==');
{
  const g = fakeGame();
  const p = S.createPlayerBase(g, 'warden', 'W');
  g.player = p;
  S.teleportPlayer(g, 2, 2);
  const occ = g.level.occupant;
  assertEq(occ[2 * W + 2], p.id, 'teleport occupies tile');
  assert(M.setPlayerPath(g, p, { x: 7, y: 2 }), 'path found');
  assertEq(p.path.length, 5, '5-tile path');
  let ticks = 0;
  while (p.path && ticks < 200) { M.stepWalk(g, p, p._cls); ticks++; }
  assertEq(ticks, 5 * P.WALK_TICKS_PER_TILE, '5 tiles in 40 ticks');
  assertEq(p.tx, 7, 'arrived x'); assertEq(p.anim, 'stand', 'stands after walk');
  assertEq(occ[2 * W + 7], p.id, 'destination occupied'); assertEq(occ[2 * W + 2], 0, 'origin freed');
  occ[2 * W + 9] = 999; // another actor
  assert(M.setPlayerPath(g, p, { x: 9, y: 2 }), 'path to occupied target goes adjacent');
  while (p.path) M.stepWalk(g, p, p._cls);
  assert(Math.max(Math.abs(p.tx - 9), Math.abs(p.ty - 2)) === 1, 'stopped adjacent to blocker');
  M.setPlayerPath(g, p, { x: 2, y: 2 });
  M.stepWalk(g, p, p._cls); M.stepWalk(g, p, p._cls);
  assert(p.walk && p.ox !== 0 || p.oy !== 0, 'mid-step offset set');
  M.cancelWalk(g, p);
  assertEq(p.ox, 0, 'cancelWalk snaps'); assertEq(occ[p.ty * W + p.tx], p.id, 'cancelWalk keeps one tile occupied');
  let count = 0; for (let i = 0; i < occ.length; i++) if (occ[i] === p.id) count++;
  assertEq(count, 1, 'exactly one tile occupied after cancel');
}

console.log('== death ==');
{
  const g = fakeGame();
  const p = S.createPlayerBase(g, 'warden', 'W');
  g.player = p;
  S.playerDie(g);
  assertEq(g.mode, 'dead', 'mode dead'); assertEq(p.dead, true, 'flag dead'); assertEq(p.anim, 'death', 'death anim');
  assert(g.log.some((e) => e.n === 'message' && e.pl.text === 'The watch falls silent.'), 'theme death line');
  S.respawnPlayer(g);
  assertEq(p.hp, 1, 'respawn hp 1'); assertEq(p.gold, 50, 'half gold lost');
}

console.log('== facades (optional: need sibling modules) ==');
for (const rel of ['src/entities/combat.js', 'src/entities/player.js', 'src/entities/player_items.js']) {
  try {
    const m = await mod(rel);
    console.log(`  ok   ${rel} loaded (${Object.keys(m).length} exports)`);
    if (rel.endsWith('combat.js')) {
      const g = fakeGame(5);
      const p = S.createPlayerBase(g, 'warden', 'W');
      g.player = p;
      const mon = { id: 50, kind: 'monster', toHit: 20, level: 1, dmgMin: 1, dmgMax: 3, hp: 100, hpMax: 100, tx: 3, ty: 2, flags: new Set(), resist: {} };
      let hits = 0;
      for (let i = 0; i < 1000; i++) if (m.rollMonsterHitsPlayer(g, mon, p).hit) hits++;
      assert(hits >= 400 && hits <= 520, `rollMonsterHitsPlayer rate ${hits / 10}% in band`);
      g.debug.godMode = true;
      assertEq(m.applyDamageToPlayer(g, p, 50, 'phys', mon), 0, 'god mode absorbs');
      g.debug.godMode = false;
      assertEq(m.applyDamageToPlayer(g, p, 50, 'phys', mon), 50, 'damage applied');
      assertEq(p.state.hitRecoverTicks > 0, true, 'player staggered (50 >= level)');
    }
  } catch (err) {
    console.log(`  skip ${rel}: ${err.code || ''} ${String(err.message).split('\n')[0]}`);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

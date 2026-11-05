#!/usr/bin/env node
/**
 * Level generator unit test (no browser).
 *
 *   node tools/unit_levels.mjs [maxSeed=30] [maxDepth=16]
 *
 * For seeds 1..N x depths 0..16: generation succeeds, stairs are connected
 * (BFS) and far enough apart, floor count >= minimum, every object/monster/
 * item sits on a floor tile, no two objects share a tile, door objects sit on
 * door-flagged tiles, the town has 6 NPCs and a down staircase. Then a smoke
 * pass interacts with one object of every kind and applies every altar effect.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeStubGame } from './levelgen_ascii.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => pathToFileURL(path.join(ROOT, p)).href;
const { T, isSolid } = await import(src('src/world/tiles.js'));
const { bfsDistances } = await import(src('src/world/levelgen/grid.js'));
const { generateLevel } = await import(src('src/world/levelgen/index.js'));
const { interactObject, applyAltarEffect } = await import(src('src/entities/objects.js'));
const { LEVELS } = await import(src('data/balance/levels.js'));

const MAX_SEED = Number(process.argv[2] || 30);
const MAX_DEPTH = Number(process.argv[3] || 16);
const TOWN_NPCS = 6;
const failures = [];
let checks = 0;

function check(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}

function floorAt(level, x, y) {
  const t = level.tiles;
  if (x < 0 || y < 0 || x >= t.w || y >= t.h) return false;
  const i = y * t.w + x;
  return t.floor[i] > 0 && t.wall[i] === 0 && !(t.flags[i] & T.WATER);
}

function family(level, game) {
  const ts = game.theme.tilesets.find((t) => t.id === level.tilesetId);
  return ts.generator === 'halls' && ts.genOpts?.mirror ? 'mirrored' : ts.generator;
}

function checkLevel(game, level, seed, depth) {
  const tag = `seed ${seed} depth ${depth}`;
  const seen = new Map();
  for (const o of level.objects) {
    check(floorAt(level, o.tx, o.ty), `${tag}: object ${o.typeId} at ${o.tx},${o.ty} not on floor`);
    const k = `${o.tx},${o.ty}`;
    check(!seen.has(k), `${tag}: objects ${o.typeId} and ${seen.get(k)} share ${k}`);
    seen.set(k, o.typeId);
    if (o.kind === 'door') check((level.tiles.flags[o.ty * level.tiles.w + o.tx] & T.DOOR) !== 0, `${tag}: door at ${k} not on a DOOR tile`);
  }
  for (const m of level.monsters) check(floorAt(level, m.tx, m.ty) && !isSolid(level.tiles, m.tx, m.ty), `${tag}: monster ${m.typeId} at ${m.tx},${m.ty} not on walkable floor`);
  for (const it of level.items) check(floorAt(level, it.tx, it.ty), `${tag}: item at ${it.tx},${it.ty} not on floor`);
  check(level.entry && floorAt(level, level.entry.x, level.entry.y), `${tag}: entry not on floor`);
  if (depth === 0) {
    check(level.isTown === true, `${tag}: town flag missing`);
    check(level.npcs.length === TOWN_NPCS, `${tag}: expected ${TOWN_NPCS} npcs, got ${level.npcs.length}`);
    check(level.stairs.down && level.objects.some((o) => o.kind === 'stairs' && o.linkDepth === 1), `${tag}: town has no down stairs`);
    check(level.monsters.length === 0, `${tag}: town has monsters`);
    check(level.explored.every((v) => v === 1), `${tag}: town not fully explored`);
    return;
  }
  const fam = family(level, game);
  check(level.floorCount >= LEVELS.minFloor[fam], `${tag}: floor ${level.floorCount} < min ${LEVELS.minFloor[fam]} (${fam})`);
  check(!level.relaxed, `${tag}: generator fell back to relaxed stairs after ${level.attempts} attempts`);
  const { up, down } = level.stairs;
  check(up && (level.tiles.flags[up.y * level.tiles.w + up.x] & T.STAIRS_UP), `${tag}: no up stairs`);
  const needDown = depth < game.theme.maxDepth;
  if (needDown) {
    check(down && (level.tiles.flags[down.y * level.tiles.w + down.x] & T.STAIRS_DOWN), `${tag}: no down stairs`);
    if (up && down) {
      const dist = bfsDistances(level.tiles, up.x, up.y);
      check(dist[down.y * level.tiles.w + down.x] >= 0, `${tag}: stairs not connected`);
      check(Math.max(Math.abs(up.x - down.x), Math.abs(up.y - down.y)) >= LEVELS.stairs.minDist, `${tag}: stairs too close`);
      let reached = 0;
      let total = 0;
      for (let i = 0; i < dist.length; i++) if (floorAt(level, i % level.tiles.w, (i / level.tiles.w) | 0)) { total++; if (dist[i] >= 0) reached++; }
      check(reached / total > 0.9, `${tag}: only ${reached}/${total} floor tiles reachable from the up stairs`);
    }
  } else check(!down, `${tag}: final depth should have no down stairs`);
  for (const p of [up, down]) {
    if (!p) continue;
    check(!(level.tiles.flags[p.y * level.tiles.w + p.x] & T.DOOR), `${tag}: stairs in a doorway`);
  }
  check(level.objects.some((o) => o.kind === 'chest'), `${tag}: no chests`);
  check(level.lights.every((l) => l.r > 0), `${tag}: bad light entry`);
}

function smokeObjects(game, level) {
  game.level = level;
  const p = game.player;
  const kinds = new Set();
  for (const o of level.objects) {
    if (kinds.has(o.kind + (o.decor ? 'd' : ''))) continue;
    kinds.add(o.kind + (o.decor ? 'd' : ''));
    p.tx = o.tx; p.ty = o.ty + 1;
    try { interactObject(game, o, p); if (o.kind === 'door') interactObject(game, o, p); } catch (e) { failures.push(`interact ${o.kind}/${o.typeId} threw: ${e.message}`); }
    checks++;
  }
  for (const eff of game.theme.altarEffects) {
    try { check(applyAltarEffect(game, eff, level.objects[0]) === true, `altar effect ${eff.id}: unknown apply '${eff.apply}'`); } catch (e) { failures.push(`altar effect ${eff.id} threw: ${e.message}`); }
  }
  check(game.ui.messages.length > 0, 'no messages emitted by interactions');
  check(level.objects.filter((o) => o.kind === 'door').every((o) => (o.state === 'open') === !(level.tiles.flags[o.ty * level.tiles.w + o.tx] & T.SOLID)), 'door state and tile SOLID flag disagree');
}

async function main() {
  const t0 = Date.now();
  const stats = { attempts: 0, levels: 0, floor: {} };
  let first = null;
  for (let seed = 1; seed <= MAX_SEED; seed++) {
    const game = await makeStubGame(seed);
    if (seed === 1 && game.stubDeps.length) console.log(`using stubs for: ${game.stubDeps.join(', ')}`);
    for (let depth = 0; depth <= MAX_DEPTH; depth++) {
      let level;
      try { level = generateLevel(game, depth); } catch (e) { failures.push(`seed ${seed} depth ${depth}: threw ${e.stack}`); continue; }
      checkLevel(game, level, seed, depth);
      if (depth > 0) {
        stats.attempts += level.attempts;
        stats.levels++;
        const f = family(level, game);
        stats.floor[f] = Math.min(stats.floor[f] ?? Infinity, level.floorCount);
      }
      if (!first && depth === 1) first = { game, level };
    }
  }
  if (first) smokeObjects(first.game, first.level);
  console.log(`${checks} checks, ${failures.length} failures, ${stats.levels} dungeon levels, avg attempts ${(stats.attempts / Math.max(1, stats.levels)).toFixed(2)}, min floor ${JSON.stringify(stats.floor)}, ${Date.now() - t0}ms`);
  for (const f of failures.slice(0, 40)) console.log(`  FAIL ${f}`);
  if (failures.length > 40) console.log(`  ... ${failures.length - 40} more`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

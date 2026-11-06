#!/usr/bin/env node
/**
 * End-to-end smoke test: serves the game, boots it headlessly in Chromium and
 * plays it through the debug API (`window.__game`, see docs/CONTRACTS.md).
 *
 *   node tools/smoke_test.mjs            full run (every class, every depth)
 *   node tools/smoke_test.mjs --quick    first class only, one depth per tier
 *   node tools/smoke_test.mjs --2d       force the 2D puppet actors (?actors=2d)
 *
 * Checks: boot without page errors · menu renders · every class starts in town
 * with NPCs · talking opens dialogue, trading opens the vendor · every depth
 * generates with monsters, connected stairs, and the tier boss on its depth ·
 * real stairs travel · melee/skill combat kills things and grants XP · loot
 * drops and is picked up · inventory/character/skills/quests panels render ·
 * town portal round trip · save → load round trip · death screen.
 * Screenshots go to tools/out/smoke-*.png. Exit code 1 on any failure.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'tools', 'out');
const QUICK = process.argv.includes('--quick');
const FORCE_2D = process.argv.includes('--2d');
// Software WebGL so the 3D actor baker runs headless (no GPU needed).
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEW = { width: 960, height: 540 };
const SEED = 4242;
const MAX_WALK_TICKS = 4000;
const FIGHT_TICKS = 600;

let failures = 0;
let checks = 0;
function check(cond, msg, detail) {
  checks++;
  if (cond) { console.log(`  ok   ${msg}`); return true; }
  failures++;
  console.log(`  FAIL ${msg}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { const res = await fetch(url); if (res.ok) return; } catch (err) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not come up at ${url}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const port = await freePort();
  const server = spawn('python3', [path.join(ROOT, 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: GL_ARGS });
  const errors = [];
  try {
    await waitForServer(`${base}/index.html`);
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(`${base}/index.html${FORCE_2D ? '?actors=2d' : ''}`);
    await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
    const shot = async (name) => {
      await page.evaluate(() => { window.__game.actorsSync(true); window.__game.render(); window.__game.actorsSync(false); });
      await page.locator('#game').screenshot({ path: path.join(OUT_DIR, `smoke-${name}.png`) });
    };
    // Pause the real-time loop: the test drives ticks itself.
    await page.evaluate(() => window.__game.loop.stop());

    console.log('# boot');
    const info = await page.evaluate(() => {
      const g = window.__game.game;
      return { title: g.theme.meta.title, classes: window.__game.classes(), maxDepth: g.theme.maxDepth, tiers: g.theme.tiers.map((t) => ({ id: t.id, depths: t.depths, boss: t.bossId })) };
    });
    check(info.classes.length >= 3, `theme '${info.title}' has ${info.classes.length} classes`);
    check(info.maxDepth >= 4, `maxDepth ${info.maxDepth}`);
    const actors = await page.evaluate(() => window.__game.actors());
    if (FORCE_2D) check(actors.state === 'disabled', '2D puppet actors forced', actors.state);
    else check(actors.state === 'ready', `3D actors active (${actors.sprites} sprites baked at boot)`, actors.failure || actors.state);
    await shot('menu');

    const classes = QUICK ? info.classes.slice(0, 1) : info.classes;
    for (const [ci, cls] of classes.entries()) {
      console.log(`# class ${cls}`);
      const s = await page.evaluate(([c, seed]) => window.__game.newGame(c, seed), [cls, SEED + ci]);
      check(s.mode === 'town' && s.depth === 0, 'starts in town', s);
      check(s.counts.npcs >= 1, `town has ${s.counts.npcs} NPCs`);
      check(s.player.hp > 0 && s.player.hpMax > 0, `player hp ${s.player.hp}/${s.player.hpMax}`);
      await page.evaluate(() => window.__game.step(5));
      if (ci === 0) await shot('town');

      if (ci === 0) await talkAndTrade(page, shot);
      await descendByStairs(page, ci === 0 ? shot : null);
      await fight(page, ci === 0 ? shot : null, cls);
    }

    console.log('# every depth');
    await page.evaluate((seed) => window.__game.newGame(null, seed), SEED);
    await page.evaluate(() => window.__game.setGodMode(true));
    const depths = [];
    for (const t of info.tiers) {
      if (QUICK) depths.push(t.depths[1]);
      else for (let d = t.depths[0]; d <= t.depths[1]; d++) depths.push(d);
    }
    const shotTier = new Set();
    for (const d of depths) {
      const r = await page.evaluate((depth) => {
        const api = window.__game;
        const s = api.teleport(depth);
        const g = api.game;
        const L = g.level;
        const tier = g.theme.tiers.find((t) => depth >= t.depths[0] && depth <= t.depths[1]);
        const reach = (from, to) => {
          if (!from || !to) return false;
          const { w, h } = L.tiles;
          const seen = new Uint8Array(w * h);
          const q = [from.x + from.y * w];
          seen[q[0]] = 1;
          const ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h && L.tiles.floor[y * w + x] > 0 && !L.tiles.wall[y * w + x];
          while (q.length) {
            const i = q.pop();
            const x = i % w; const y = (i / w) | 0;
            if (Math.abs(x - to.x) <= 1 && Math.abs(y - to.y) <= 1) return true;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx; const ny = y + dy;
              if (ok(nx, ny) && !seen[nx + ny * w]) { seen[nx + ny * w] = 1; q.push(nx + ny * w); }
            }
          }
          return false;
        };
        const bossHere = (g.theme.uniqueMonsters || []).filter((u) => u.depth === depth).map((u) => u.id);
        const present = L.monsters.filter((m) => m.unique || m.uniqueId).map((m) => m.unique || m.uniqueId);
        return {
          s, name: L.name, tier: tier.id, last: depth === g.theme.maxDepth,
          hasDown: !!L.stairs.down, hasUp: !!L.stairs.up,
          reachDown: L.stairs.down ? reach(L.entry, L.stairs.down) : true,
          bossHere, present,
        };
      }, d);
      check(r.s.counts.alive > 0, `depth ${d} (${r.name}): ${r.s.counts.alive} monsters, ${r.s.counts.objects} objects, ${r.s.counts.items} items`);
      check(r.hasUp, `depth ${d} has up stairs`);
      if (!r.last) check(r.hasDown && r.reachDown, `depth ${d} down stairs reachable from entry`);
      for (const b of r.bossHere) check(r.present.includes(b), `depth ${d} has unique ${b}`, r.present);
      if (!shotTier.has(r.tier) && !QUICK) {
        shotTier.add(r.tier);
        await page.evaluate(() => window.__game.step(10));
        await shot(`tier-${r.tier}`);
      } else if (QUICK) {
        await page.evaluate(() => window.__game.step(10));
        await shot(`tier-${r.tier}`);
      }
    }

    await portalRoundTrip(page);
    await saveLoad(page);
    await panels(page, shot);
    await death(page, shot);

    check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 8).join('\n       '));
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ''}. Screenshots: tools/out/smoke-*.png`);
  process.exit(failures ? 1 : 0);
}

async function talkAndTrade(page, shot) {
  console.log('# npcs');
  const r = await page.evaluate(() => {
    const api = window.__game;
    const g = api.game;
    const npc = g.level.npcs.find((n) => n.vendorTypes && n.vendorTypes.length) || g.level.npcs[0];
    api.talk(npc.npcId || npc.id);
    let t = 0;
    while (!g.ui.dialogue && t++ < 1500) api.step(1);
    const d = g.ui.dialogue;
    return { npc: npc.name, ticks: t, dialogue: d ? { title: d.title, lines: d.lines, options: d.options.map((o) => o.label) } : null };
  });
  check(!!r.dialogue, `talking to ${r.npc} opens dialogue after ${r.ticks} ticks`, r.dialogue);
  if (!r.dialogue) return;
  await shot('dialogue');
  const v = await page.evaluate(() => {
    const api = window.__game;
    const g = api.game;
    const opt = g.ui.dialogue.options.find((o) => /trade|buy/i.test(o.label)) || g.ui.dialogue.options[0];
    opt.action(g);
    g.ui.dialogue = null;
    api.step(1);
    const npc = g.level.npcs.find((n) => (n.npcId || n.id) === g.ui.vendor);
    return { vendor: g.ui.vendor, stock: npc && npc.stock ? npc.stock.length : (npc && npc.inventory ? npc.inventory.length : -1) };
  });
  check(!!v.vendor, `trade opens vendor ${v.vendor} (stock ${v.stock})`);
  check(v.stock > 0, 'vendor has stock');
  await shot('vendor');
  await page.evaluate(() => window.__game.closeAll());
}

async function descendByStairs(page, shot) {
  const r = await page.evaluate((maxTicks) => {
    const api = window.__game;
    const g = api.game;
    const stairs = g.level.objects.find((o) => o.kind === 'stairs' && o.linkDepth === 1);
    if (!stairs) return { err: 'no town stairs object' };
    api.interact(stairs.id);
    let t = 0;
    while (g.level.depth === 0 && t++ < maxTicks) { api.step(1); if (!g.player.intent && g.level.depth === 0) api.interact(stairs.id); }
    return { depth: g.level.depth, ticks: t };
  }, MAX_WALK_TICKS);
  check(r.depth === 1, `walking to the dungeon entrance and using it reaches depth 1 (${r.ticks} ticks)`, r);
  if (shot) { await page.evaluate(() => window.__game.step(10)); await shot('depth1'); }
  const up = await page.evaluate((maxTicks) => {
    const api = window.__game;
    const g = api.game;
    g.debug.god = true;
    const stairs = g.level.objects.find((o) => o.kind === 'stairs' && o.linkDepth === 2);
    if (!stairs) return { err: 'no down stairs object on depth 1' };
    // Walk like a player: head for the stairs, fight whatever blocks the way.
    const p = g.player;
    const adjacentFoe = () => g.level.monsters.find((m) => !m.dead && !m.ally && !m.hidden && Math.max(Math.abs(m.tx - p.tx), Math.abs(m.ty - p.ty)) <= 1);
    api.interact(stairs.id);
    let t = 0;
    let lastPos = '';
    let still = 0;
    while (g.level.depth === 1 && t++ < maxTicks) {
      api.step(1);
      const pos = `${p.tx},${p.ty}`;
      still = pos === lastPos ? still + 1 : 0;
      lastPos = pos;
      if (g.level.depth !== 1) break;
      const foe = adjacentFoe();
      if (foe && (still > 20 || !p.intent) && (!p.intent || p.intent.type !== 'attack')) api.attack(foe.id);
      else if (!p.intent) api.interact(stairs.id);
    }
    const res = { depth: g.level.depth, ticks: t };
    g.debug.god = false;
    return res;
  }, MAX_WALK_TICKS);
  check(up.depth === 2, `crossing depth 1 to its down stairs reaches depth 2 (${up.ticks} ticks)`, up);
}

async function fight(page, shot, cls) {
  const r = await page.evaluate((ticks) => {
    const api = window.__game;
    const g = api.game;
    g.debug.god = true;
    const p = g.player;
    const xp0 = p.xp;
    const kills0 = g.stats.kills;
    const tier = g.theme.tiers[0];
    const pool = tier.monsterPool || g.theme.monsters.filter((m) => m.tier === 1).map((m) => m.id);
    let attacks = 0;
    // Deterministic melee: spawn tier-1 monsters next to the player and fight them.
    for (let i = 0; i < 3; i++) {
      const m = api.spawn(pool[i % pool.length], 1, i - 1);
      if (!m) continue;
      m.awake = true;
      for (let t = 0; t < ticks && !m.dead; t++) {
        if (!p.intent) { api.attack(m.id); attacks++; }
        api.step(1);
      }
    }
    // Cast the class start skill at a fresh adjacent monster.
    const sk = p.selectedSkill;
    let cast = null;
    if (sk) {
      const m = api.spawn(pool[0], 1, 0);
      g.debug.god = false;
      p.mp = p.mpMax;
      const full = p.mp;
      const missiles0 = g.level.missiles.length;
      const hp0 = m ? m.hp : 0;
      if (m) api.castAt(sk, m.tx, m.ty);
      let saw = false;
      for (let t = 0; t < 60; t++) { api.step(1); if (g.level.missiles.length > missiles0 || p.mp < full || (m && (m.hp < hp0 || m.dead))) saw = true; }
      g.debug.god = true;
      cast = { skill: sk, saw };
    }
    // Drop loot beside the player and pick it up.
    const drops = [api.gold(), api.item(undefined, 'magic'), api.item(undefined, 'any')].filter(Boolean);
    let picked = 0;
    for (const [i, it] of drops.entries()) {
      Object.assign(it, { tx: p.tx + 1, ty: p.ty + (i % 2), dropTick: g.tick });
      g.level.items.push(it);
      p.intent = { type: 'pickup', target: it.id };
      for (let t = 0; t < 200 && g.level.items.includes(it); t++) api.step(1);
      if (!g.level.items.includes(it)) picked++;
    }
    g.debug.god = false;
    return { kills: g.stats.kills - kills0, xp: p.xp - xp0, attacks, cast, picked, tried: drops.length, level: p.level };
  }, FIGHT_TICKS);
  check(r.kills > 0 && r.kills <= 4, `${cls} kills ${r.kills} of 3 melee + 1 cast target (${r.attacks} attack orders; each kill counted once)`, r);
  check(r.xp > 0, `${cls} gains ${r.xp} xp (level ${r.level})`);
  if (r.cast) check(r.cast.saw, `${cls} casts ${r.cast.skill}`, r.cast);
  check(r.tried > 0 && r.picked === r.tried, `picks up ${r.picked}/${r.tried} floor items`);
  if (shot) { await page.evaluate(() => window.__game.step(2)); await shot('combat'); }
}

async function portalRoundTrip(page) {
  console.log('# town portal');
  const r = await page.evaluate(() => {
    const api = window.__game;
    const g = api.game;
    api.teleport(3);
    const opened = g.hooks.onTownPortal(g);
    const portal = g.level.objects.find((o) => o.kind === 'portal');
    if (!portal) return { opened, err: 'no portal object' };
    api.interact(portal.id);
    let t = 0;
    while (g.level.depth !== 0 && t++ < 400) api.step(1);
    const inTown = g.level.depth === 0;
    const back = g.level.objects.find((o) => o.kind === 'portal');
    if (!back) return { opened, inTown, err: 'no portal in town' };
    api.interact(back.id);
    t = 0;
    while (g.level.depth === 0 && t++ < 600) api.step(1);
    return { opened, inTown, back: g.level.depth };
  });
  check(r.opened && r.inTown && r.back === 3, 'portal: depth 3 → town → depth 3', r);
}

async function saveLoad(page) {
  console.log('# save / load');
  const r = await page.evaluate(() => {
    const api = window.__game;
    const g = api.game;
    api.give('gold', 1234);
    api.xp(5000);
    const before = { depth: g.level.depth, gold: g.player.gold, xp: g.player.xp, level: g.player.level, inv: Object.keys(g.player.inventory.items).length, x: g.player.tx, y: g.player.ty, quests: JSON.stringify(api.state().quests) };
    const saved = api.save(0);
    api.teleport(0);
    g.player.gold = 0;
    const loaded = api.load(0);
    api.step(3);
    const after = { depth: g.level.depth, gold: g.player.gold, xp: g.player.xp, level: g.player.level, inv: Object.keys(g.player.inventory.items).length, x: g.player.tx, y: g.player.ty, quests: JSON.stringify(api.state().quests) };
    return { saved, loaded, before, after };
  });
  check(r.saved && r.loaded, 'save and load succeed');
  check(JSON.stringify(r.before) === JSON.stringify(r.after), 'state round-trips', r);
}

async function panels(page, shot) {
  console.log('# panels');
  await page.evaluate(() => {
    const api = window.__game;
    const g = api.game;
    api.teleport(5);
    for (const q of ['magic', 'magic', 'rare', 'unique']) api.give(undefined, q);
    api.closeAll();
    api.openPanel('inventory');
    api.openPanel('character');
    api.step(2);
  });
  await shot('inventory');
  await page.evaluate(() => { const api = window.__game; api.closeAll(); api.openPanel('skills'); api.openPanel('inventory'); api.step(1); });
  await shot('skills');
  await page.evaluate(() => { const api = window.__game; api.closeAll(); api.openPanel('quests'); api.step(1); });
  await shot('quests');
  await page.evaluate(() => { const api = window.__game; api.closeAll(); api.reveal(); api.openPanel('automap'); api.step(1); });
  await shot('automap');
  const s = await page.evaluate(() => { window.__game.closeAll(); return window.__game.state(); });
  check(s.ui.left === null && s.ui.right === null, 'panels close');
}

/** Drop the player to 1 HP under a pack and step until dead. Runs in the page. */
const KILL_PLAYER = () => {
  const api = window.__game;
  const g = api.game;
  g.debug.god = false;
  g.player.hp = 1;
  g.player.state.invulnTicks = 0;
  for (let i = 0; i < 6; i++) api.spawn(g.level.monsters.find((m) => !m.uniqueId)?.typeId || g.theme.monsters[0].id, (i % 3) - 1, i < 3 ? -1 : 1);
  let t = 0;
  while (!g.player.dead && t++ < 1200) api.step(1);
  api.step(40);
  return { dead: g.player.dead, mode: g.mode, ticks: t };
};

async function death(page, shot) {
  console.log('# death');
  const r = await page.evaluate(KILL_PLAYER);
  check(r.dead && r.mode === 'dead', `player dies under a pack (${r.ticks} ticks) and the death screen shows`, r);
  await shot('death');
  const rs = await page.evaluate(() => { window.__game.menu({ type: 'respawn' }); window.__game.step(5); const s = window.__game.state(); return { mode: s.mode, depth: s.depth, dead: window.__game.game.player.dead, hp: window.__game.game.player.hp }; });
  check(rs.mode === 'town' && rs.depth === 0 && !rs.dead && rs.hp > 0, 'respawn returns a living hero to town', rs);
  await page.evaluate(() => window.__game.teleport(1));
  await page.evaluate(KILL_PLAYER);
  const back = await page.evaluate(() => { window.__game.menu({ type: 'quitToMenu' }); return window.__game.state().mode; });
  check(back === 'menu', 'quit to menu from death screen');

  console.log('# permadeath');
  await page.evaluate(() => { const m = window.__game.game.ui.menu; m.hardcore = true; m.difficulty = 1; window.__game.render(); });
  await shot('menu-options');
  const hc = await page.evaluate((kill) => {
    const api = window.__game;
    const cls = api.game.ui.menu;
    api.newGame(api.classes()[0].id || api.classes()[0], 7, { hardcore: true, difficulty: 'veteran' });
    api.save();
    const keys = () => Object.keys(localStorage).filter((k) => k.startsWith('arpg:')).length;
    const savedKeys = keys();
    api.teleport(1);
    // eslint-disable-next-line no-new-func
    const r = new Function(`return (${kill})()`)();
    api.step(5);
    const refused = api.menu({ type: 'respawn' }) === false;
    return { dead: r.dead, mode: api.game.mode, savedKeys, afterKeys: keys(), refused, difficulty: api.game.difficulty, hardcore: api.game.flags.hardcore, menuHc: cls.hardcore };
  }, KILL_PLAYER.toString());
  check(hc.hardcore && hc.difficulty === 'veteran', 'new game honours hardcore + difficulty options', hc);
  check(hc.dead && hc.mode === 'dead', 'hardcore hero dies');
  check(hc.savedKeys > 0 && hc.afterKeys < hc.savedKeys, `hardcore death deletes the save (${hc.savedKeys} → ${hc.afterKeys})`, hc);
  check(hc.refused, 'hardcore death refuses respawn');
  await shot('death-hardcore');
  await page.evaluate(() => window.__game.menu({ type: 'quitToMenu' }));
}

main().catch((err) => { console.error(err); process.exit(1); });

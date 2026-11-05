#!/usr/bin/env node
/**
 * UI preview: serve the template, load tools/ui_harness.html (which wires
 * render/ui.js to a fake game state with stubbed sibling modules via an
 * import map), screenshot every UI state to tools/out/ui-<state>.png and
 * assert that hit testing / click handling agree with what was drawn.
 *
 *   node tools/ui_preview.mjs [stateName ...]
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
const HARNESS = '/tools/ui_harness.html';
const SERVER_TIMEOUT_MS = 10000;
const SERVER_POLL_MS = 100;
const PAGE_TIMEOUT_MS = 15000;
const VIEW = { width: 960, height: 540 };
const GRID_CELL = { cx: 2, cy: 1 }; // inside the 2x3 War Bow at grid (2,0)

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, SERVER_POLL_MS));
  }
  throw new Error(`server did not come up at ${url}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ok  ${msg}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv.slice(2);
  const port = await freePort();
  const server = spawn('python3', ['serve.py', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[serve.py] ${d}`));
  let browser = null;
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}${HARNESS}`);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message || e}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => !!window.__ui, null, { timeout: PAGE_TIMEOUT_MS });
    assert(errors.length === 0, `harness loaded without errors${errors.length ? `\n${errors.join('\n')}` : ''}`);

    const states = await page.evaluate(() => window.__ui.states);
    for (const name of states) {
      if (only.length && !only.includes(name)) continue;
      await page.evaluate((n) => window.__ui.setState(n), name);
      const file = path.join(OUT_DIR, `ui-${name}.png`);
      await page.locator('#game').screenshot({ path: file });
      console.log(`  shot ${file}`);
    }
    assert(errors.length === 0, `no errors while rendering states${errors.length ? `\n${errors.join('\n')}` : ''}`);

    // --- hit test: inventory cell under a grid position ---
    const probe = await page.evaluate((cell) => {
      const u = window.__ui;
      u.setState('inventory');
      const L = u.uiLayout;
      const x = L.rightPanel.x + L.inventory.grid.x + cell.cx * L.cell + L.cell / 2;
      const y = L.rightPanel.y + L.inventory.grid.y + cell.cy * L.cell + L.cell / 2;
      return { hit: u.hitTest(x, y), x, y, hud: u.hitTest(L.lifeGlobe.cx, L.lifeGlobe.cy), world: u.hitTest(480, 200) };
    }, GRID_CELL);
    console.log('  probe:', JSON.stringify(probe));
    assert(probe.hit && probe.hit.kind === 'invCell', 'uiHitTest returns an invCell over the inventory grid');
    assert(probe.hit.cx === GRID_CELL.cx && probe.hit.cy === GRID_CELL.cy, `invCell coordinates are (${GRID_CELL.cx},${GRID_CELL.cy})`);
    assert(probe.hit.item === 'War Bow', 'the cell payload carries the item occupying it');
    assert(probe.hud && probe.hud.kind === 'globe', 'uiHitTest returns the life globe over the globe');
    assert(probe.world === null, 'uiHitTest returns null over the open world');

    // --- click: pick up, then put down on a free spot, then equip ---
    const clicks = await page.evaluate((cell) => {
      const u = window.__ui;
      const L = u.uiLayout;
      const gx = (cx) => L.rightPanel.x + L.inventory.grid.x + cx * L.cell + L.cell / 2;
      const gy = (cy) => L.rightPanel.y + L.inventory.grid.y + cy * L.cell + L.cell / 2;
      const out = {};
      out.consumedPick = u.click(gx(cell.cx), gy(cell.cy));
      out.heldAfterPick = u.cursorItemName();
      out.cellAfterPick = u.cellId(2, 0);
      out.consumedPlace = u.click(gx(2), gy(1)); // cursor cell (2,1) -> origin (2,0) for a 2x3
      out.heldAfterPlace = u.cursorItemName();
      out.cellAfterPlace = u.cellId(2, 0);
      out.worldConsumed = u.click(480, 200);
      // right-click the leather cap slot -> no 2x2 room in the grid, so it stays equipped with an error message
      const head = L.inventory.equip.head;
      out.unequipConsumed = u.click(L.rightPanel.x + head.x + 10, L.rightPanel.y + head.y + 10, 2);
      out.headAfter = u.game.player.equipment.head ? u.game.player.equipment.head.name : null;
      out.lastMessage = u.game.ui.messages.length ? u.game.ui.messages[u.game.ui.messages.length - 1].text : null;
      // right-click the 1x1 unique ring at grid (8,0) -> auto-equips into ring1
      out.ringConsumed = u.click(gx(8), gy(0), 2);
      out.ring1 = u.game.player.equipment.ring1 ? u.game.player.equipment.ring1.name : null;
      out.ringCell = u.cellId(8, 0);
      out.itemCount = u.itemCount();
      // keyboard: Space closes everything
      out.spaceConsumed = u.key('space');
      out.rightAfterSpace = u.game.ui.right;
      out.viewInset = { ...u.game.ui.viewInset };
      return out;
    }, GRID_CELL);
    console.log('  clicks:', JSON.stringify(clicks));
    assert(clicks.consumedPick && clicks.heldAfterPick === 'War Bow', 'left-click picks the item up onto the cursor');
    assert(clicks.cellAfterPick === 0, 'the grid cell is cleared while the item is held');
    assert(clicks.consumedPlace && clicks.heldAfterPlace === null && clicks.cellAfterPlace !== 0, 'left-click puts the held item back');
    assert(clicks.worldConsumed === false, 'a click on the open world is not consumed');
    assert(clicks.unequipConsumed && clicks.headAfter === 'Leather Cap' && /room/i.test(clicks.lastMessage || ''), 'right-click unequip with a full grid keeps the item equipped and reports no room');
    assert(clicks.ringConsumed && clicks.ring1 === 'Ring of the Watch' && clicks.ringCell === 0 && clicks.itemCount === 11, 'right-click on a ring in the grid equips it');
    assert(clicks.spaceConsumed && clicks.rightAfterSpace === null && clicks.viewInset.right === 0, 'Space closes panels and clears the view inset');

    // --- main menu typing ---
    const menu = await page.evaluate(() => {
      const u = window.__ui;
      u.setState('main-menu');
      u.game.ui.menu.name = '';
      for (const k of ['A', 'r', 'a']) u.key(k);
      u.key('Tab');
      u.key('Backspace');
      u.key('Enter');
      return { name: u.game.ui.menu.name, seed: u.game.ui.menu.seed, action: u.game.__lastAction };
    });
    console.log('  menu:', JSON.stringify(menu));
    assert(menu.name === 'Ara' && menu.seed === '1234', 'typing goes to the focused field, Tab switches, Backspace deletes');
    assert(menu.action && menu.action.type === 'newGame' && menu.action.classId === 'stalker' && menu.action.seed === 1234, 'Enter fires menuAction newGame with class, name and seed');
    assert(errors.length === 0, `no errors after interaction${errors.length ? `\n${errors.join('\n')}` : ''}`);
    console.log('UI PREVIEW: PASS');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error('UI PREVIEW: FAIL');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

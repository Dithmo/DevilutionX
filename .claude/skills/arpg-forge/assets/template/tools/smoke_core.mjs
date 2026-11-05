#!/usr/bin/env node
/**
 * Core smoke test: serve the template, load it headless, step the
 * simulation, click to move, assert no console errors and that the player
 * walked, then screenshot to tools/out/core.png.
 *
 *   node tools/smoke_core.mjs
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
const SCREENSHOT = path.join(OUT_DIR, 'core.png');
const SERVER_TIMEOUT_MS = 10000;
const SERVER_POLL_MS = 100;
const PAGE_TIMEOUT_MS = 15000;
const WARMUP_TICKS = 200;
const MOVE_TICKS = 100;
const CLICK_FX = 0.7;
const CLICK_FY = 0.5;
const SETTLE_MS = 300;

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
  const port = await freePort();
  const server = spawn('python3', ['serve.py', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[serve.py] ${d}`));
  let browser = null;
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/index.html`);
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message || e}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => !!window.__game, null, { timeout: PAGE_TIMEOUT_MS });
    console.log('page loaded, __game present');

    const s0 = await page.evaluate((n) => { window.__game.step(n); return window.__game.state(); }, WARMUP_TICKS);
    console.log('  state after warmup:', JSON.stringify(s0));
    assert(errors.length === 0, `no console/page errors after ${WARMUP_TICKS} ticks${errors.length ? `\n${errors.join('\n')}` : ''}`);
    assert(s0.tick >= WARMUP_TICKS, 'tick counter advanced');
    assert(s0.explored > 0, 'FOV explored some tiles');
    assert(s0.monsters === 3, 'three dummy actors exist');

    const box = await page.locator('#game').boundingBox();
    assert(box && box.width > 0, 'canvas has a bounding box');
    await page.mouse.click(box.x + box.width * CLICK_FX, box.y + box.height * CLICK_FY);
    const s1 = await page.evaluate((n) => { window.__game.step(n); return window.__game.state(); }, MOVE_TICKS);
    console.log('  state after move:', JSON.stringify(s1));
    const moved = s1.player.tx !== s0.player.tx || s1.player.ty !== s0.player.ty;
    assert(moved, 'player position changed after click-to-move');
    assert(errors.length === 0, `no console/page errors after moving${errors.length ? `\n${errors.join('\n')}` : ''}`);

    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: SCREENSHOT });
    console.log(`screenshot: ${SCREENSHOT}`);
    console.log('SMOKE CORE: PASS');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error('SMOKE CORE: FAIL');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

import { createBaker, BOX } from './rig3d.js';
import { loadPBR } from './pbr.js';
import { drawActor } from './old/render/draw_actor.js';
import { setRenderScale } from './old/render/draw_util.js';

const LOOK = {
  silhouette: 'bulky', bodyColor: '#b08a5a', trimColor: '#4a3a2a', weapon: 'sword', offhand: 'shield',
  helm: 'full', armor: 'plate', cloak: 'short', cloakColor: '#5a2a22', metalColor: '#c4c8cc',
};
const DPR = 2;
const HERO_ZOOM = 3;
const GRID_ZOOM = 1.25;
const FRAMES = { walk: 16, attack: 14, idle: 8 };
const OLD_FRAMES = { walk: 8, attack: 8, idle: 1 };
const CYCLE = { walk: 0.9, attack: 0.75, idle: 1.6 }; // seconds per loop
const DIR_NAMES = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

setRenderScale(DPR);
const state = { anim: 'walk', dir: 'spin', speed: 1, t: 0 };

/* ---------- bake */
const tex = await loadPBR('./tex/');
const baker = createBaker(tex);
const CLOSE_ZOOM = 5;
const SH = {
  heroFlat: baker.sheet(LOOK, { scale: HERO_ZOOM, dpr: DPR, ss: 2, frames: FRAMES }),
  heroPbr: baker.sheet(LOOK, { scale: HERO_ZOOM, dpr: DPR, ss: 2, frames: FRAMES, pbr: true }),
  smallFlat: baker.sheet(LOOK, { scale: GRID_ZOOM, dpr: DPR, ss: 2, frames: FRAMES }),
  smallPbr: baker.sheet(LOOK, { scale: GRID_ZOOM, dpr: DPR, ss: 2, frames: FRAMES, pbr: true }),
  closeFlat: baker.sheet(LOOK, { scale: CLOSE_ZOOM, dpr: DPR, ss: 1, frames: { idle: 8 } }),
  closePbr: baker.sheet(LOOK, { scale: CLOSE_ZOOM, dpr: DPR, ss: 1, frames: { idle: 8 }, pbr: true }),
};
const statsEl = document.getElementById('stats');
function showStats() {
  let n = 0, ms = 0;
  for (const s of Object.values(SH)) { n += s.stats.sprites; ms += s.stats.ms; }
  statsEl.textContent = n ? `3D bake: ${n} sprites, ${(ms / n).toFixed(0)} ms each` : 'baking…';
}
window.__ready = true;

// pre-bake everything in the background, a few sprites per slice, so playback is smooth
const queue = [];
for (const sh of [SH.smallPbr, SH.heroPbr, SH.smallFlat, SH.heroFlat]) for (const a of ['walk', 'attack', 'idle']) for (let d = 0; d < 8; d++) for (let f = 0; f < FRAMES[a]; f++) queue.push([sh, a, d, f]);
for (const sh of [SH.closePbr, SH.closeFlat]) for (let d = 0; d < 8; d++) queue.push([sh, 'idle', d, 0]);
function warm() {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < 12) { const [sh, a, d, f] = queue.shift(); sh.get(a, d, f); }
  if (queue.length && !window.__noWarm) setTimeout(warm, 4);
}
setTimeout(warm, 300);

/* ---------- canvases */
const HERO_W = 100, HERO_H = 110;
function setup(cv, w, h) {
  cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
  cv.style.aspectRatio = `${w} / ${h}`;
  return cv.getContext('2d');
}
const heroes = [
  [setup(document.getElementById('heroOld'), HERO_W * HERO_ZOOM, HERO_H * HERO_ZOOM), null],
  [setup(document.getElementById('heroFlat'), HERO_W * HERO_ZOOM, HERO_H * HERO_ZOOM), SH.heroFlat],
  [setup(document.getElementById('heroPbr'), HERO_W * HERO_ZOOM, HERO_H * HERO_ZOOM), SH.heroPbr],
];
const CROP = { x0: -30, x1: 30, y0: -84, y1: -30 };
const closes = [
  [setup(document.getElementById('closeFlat'), (CROP.x1 - CROP.x0) * CLOSE_ZOOM, (CROP.y1 - CROP.y0) * CLOSE_ZOOM), SH.closeFlat],
  [setup(document.getElementById('closePbr'), (CROP.x1 - CROP.x0) * CLOSE_ZOOM, (CROP.y1 - CROP.y0) * CLOSE_ZOOM), SH.closePbr],
];

const CELL_W = 92, CELL_H = 104, CELL_AY = 86;
const grid = document.getElementById('grid');
const rows = [['old', 'Current', null], ['flat', '3D flat (v1)', SH.smallFlat], ['pbr', '3D PBR', SH.smallPbr]];
const cells = {};
{
  const head = grid.insertRow();
  head.appendChild(document.createElement('th'));
  for (const n of DIR_NAMES) { const th = document.createElement('th'); th.textContent = n; head.appendChild(th); }
  for (const [k, label] of rows) {
    cells[k] = [];
    const tr = grid.insertRow();
    const th = document.createElement('th'); th.className = 'row'; th.textContent = label; tr.appendChild(th);
    for (let d = 0; d < 8; d++) {
      const td = tr.insertCell();
      const cv = document.createElement('canvas');
      cv.style.width = `${CELL_W * GRID_ZOOM}px`; cv.style.height = `${CELL_H * GRID_ZOOM}px`;
      td.appendChild(cv);
      cells[k].push(setup(cv, CELL_W * GRID_ZOOM, CELL_H * GRID_ZOOM));
    }
  }
}

/* ---------- floor */
function floor(c, w, h, ax, ay, zoom) {
  c.save();
  c.fillStyle = '#121016';
  c.fillRect(0, 0, w, h);
  const g = c.createRadialGradient(ax, ay - 20 * zoom, 4, ax, ay, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(255,190,120,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  // iso tiles
  const TW = 64 * zoom, TH = 32 * zoom;
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
    const x = ax + (i - j) * TW / 2, y = ay + (i + j) * TH / 2;
    if (x < -TW || x > w + TW || y < -TH || y > h + TH) continue;
    const n = Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1;
    c.fillStyle = `rgb(${38 + n * 10},${34 + n * 8},${40 + n * 9})`;
    c.beginPath();
    c.moveTo(x, y - TH / 2); c.lineTo(x + TW / 2, y); c.lineTo(x, y + TH / 2); c.lineTo(x - TW / 2, y); c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1.5; c.stroke();
  }
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.restore();
}

/* ---------- draw */
function frameOf(anim, n) { const u = (((state.t / CYCLE[anim]) % 1) + 1) % 1; return Math.min(n - 1, Math.floor(u * n)); }
function dirNow() {
  if (state.dir !== 'spin') return +state.dir;
  return Math.floor(state.t / (CYCLE[state.anim] * 2)) % 8;
}

function drawOld(c, zoom, ax, ay, dir) {
  const anim = state.anim === 'idle' ? 'stand' : state.anim;
  c.save();
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawActor(c, ax / DPR, ay / DPR, LOOK, { dir, frame: frameOf(state.anim, OLD_FRAMES[state.anim]), anim, scale: zoom });
  c.restore();
}
function drawNew(c, sh, ax, ay, dir) {
  const spr = sh.get(state.anim, dir, frameOf(state.anim, sh.frames[state.anim]));
  const px = sh.scale * DPR;
  c.drawImage(spr, Math.round(ax - BOX.ax * px), Math.round(ay - BOX.ay * px));
}

function drawClose(c, sh, dir) {
  const w = c.canvas.width, h = c.canvas.height;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1d1a20'); g.addColorStop(1, '#0f0d11');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const spr = sh.get('idle', dir, 0);
  const px = sh.scale * DPR;
  c.drawImage(spr, (BOX.ax + CROP.x0) * px, (BOX.ay + CROP.y0) * px, (CROP.x1 - CROP.x0) * px, (CROP.y1 - CROP.y0) * px, 0, 0, w, h);
}

let last = performance.now();
function tick(now) {
  state.t += Math.max(0, (now - last) / 1000) * state.speed;
  last = now;
  const d = dirNow();
  for (const [c, sh] of heroes) {
    const w = c.canvas.width, h = c.canvas.height;
    const ax = w / 2, ay = h * 0.84;
    floor(c, w, h, ax, ay, HERO_ZOOM * DPR);
    if (sh) drawNew(c, sh, ax, ay, d); else drawOld(c, HERO_ZOOM, ax, ay, d);
  }
  for (const [c, sh] of closes) drawClose(c, sh, d);
  for (let k = 0; k < 8; k++) {
    for (const [key, , sh] of rows) {
      const c = cells[key][k];
      const w = c.canvas.width, h = c.canvas.height;
      const ax = w / 2, ay = CELL_AY * GRID_ZOOM * DPR;
      floor(c, w, h, ax, ay, GRID_ZOOM * DPR);
      if (sh) drawNew(c, sh, ax, ay, k); else drawOld(c, GRID_ZOOM, ax, ay, k);
    }
  }
  showStats();
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ---------- controls */
for (const id of ['anim', 'dir', 'speed']) {
  const seg = document.getElementById(id);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    const v = b.dataset.v;
    state[id] = id === 'speed' ? +v : v;
  });
}
// test hook: freeze at a time/dir/anim
window.__set = (o) => { Object.assign(state, o); };

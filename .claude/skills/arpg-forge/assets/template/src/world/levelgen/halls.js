/**
 * Generator "halls" (reference D): a recursive tree of flush-touching
 * rectangular rooms grown from a seed room, either
 *   - mirrored 4-way from one quadrant (`{mirror:true}`; axis-reach
 *     corridors guarantee the four copies connect) with 3-wide doorways, or
 *   - the "ossuary" variant (`{mirror:false, chamberStyle:'ossuary'}`): long
 *     3-wide halls crossing the map with chambers at the ends/crossings and
 *     small alcoves along them, 1-wide doorways with door objects.
 * Interior walls are carved along floor runs that start at a concave corner
 * and end on a wall, each with one doorway (reference AddWall).
 */
import { createTiles, T, idx, inBounds, setFlag } from '../tiles.js';
import { carveRect, raiseWalls, setWall, sprinkleFloor, isFloor, rectAll } from './grid.js';
import { LEVELS } from '../../../data/balance/levels.js';

const FLOOR = 1;
const FLOOR_ALT = 2;
const WALL_STYLE = 1;
const HALF_PCT = 50;

function makeMask(w, h) {
  const m = new Uint8Array(w * h);
  return {
    w, h, m,
    get: (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]),
    set: (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1; },
  };
}

function mapRoom(mask, r) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) mask.set(x, y);
}

/** Rect must be inside [1, bw) x [1, bh) and the mask clear over the rect grown by 1 except on the parent side. */
function checkRoom(mask, r, bw, bh, skipSide) {
  if (r.x < 1 || r.y < 1 || r.x + r.w > bw || r.y + r.h > bh) return false;
  const x0 = r.x - (skipSide === 'E' ? 0 : 1);
  const x1 = r.x + r.w + (skipSide === 'W' ? 0 : 1);
  const y0 = r.y - (skipSide === 'S' ? 0 : 1);
  const y1 = r.y + r.h + (skipSide === 'N' ? 0 : 1);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (mask.get(x, y)) return false;
  return true;
}

/** Reference GenerateRoom: side rooms flush on the negative side, mirrored to the positive side, recurse. */
function growTree(mask, area, vertical, rng, cfg, bw, bh, rooms, depth, sizes, flipPct) {
  if (depth > cfg.maxDepth || rooms.length >= cfg.maxRooms) return;
  if (rng.chance(flipPct)) vertical = !vertical;
  let r1 = null;
  for (let t = 0; t < cfg.placeTries && !r1; t++) {
    const w = rng.pick(sizes);
    const h = rng.pick(sizes);
    const cand = vertical
      ? { x: area.x - w, y: area.y + ((area.h - h) >> 1), w, h }
      : { x: area.x + ((area.w - w) >> 1), y: area.y - h, w, h };
    if (checkRoom(mask, cand, bw, bh, vertical ? 'E' : 'S')) r1 = cand;
  }
  if (!r1) return;
  mapRoom(mask, r1);
  rooms.push({ ...r1, kind: 'room' });
  const r2 = vertical
    ? { x: area.x + area.w, y: r1.y, w: r1.w, h: r1.h }
    : { x: r1.x, y: area.y + area.h, w: r1.w, h: r1.h };
  const r2ok = checkRoom(mask, r2, bw, bh, vertical ? 'W' : 'N');
  if (r2ok) { mapRoom(mask, r2); rooms.push({ ...r2, kind: 'room' }); }
  const next = cfg.alternate ? !vertical : vertical;
  growTree(mask, r1, next, rng, cfg, bw, bh, rooms, depth + 1, sizes, flipPct);
  if (r2ok) growTree(mask, r2, next, rng, cfg, bw, bh, rooms, depth + 1, sizes, flipPct);
}

/** Reference PrepareInnerBorders: a 2-wide corridor from the quadrant mass to the right and bottom axes. */
function reachAxes(mask, qw, qh, rng) {
  const rowHas = (y) => { for (let x = 0; x < qw; x++) if (mask.get(x, y)) return true; return false; };
  const colHas = (x) => { for (let y = 0; y < qh; y++) if (mask.get(x, y)) return true; return false; };
  let ry = rng.range(1, qh - 2);
  for (let n = 0; n < qh && !(rowHas(ry) && rowHas(ry + 1)); n++) ry = ry >= qh - 2 ? 1 : ry + 1;
  for (let x = qw - 1; x >= 0 && !(mask.get(x, ry) && mask.get(x, ry + 1)); x--) { mask.set(x, ry); mask.set(x, ry + 1); }
  let cx = rng.range(1, qw - 2);
  for (let n = 0; n < qw && !(colHas(cx) && colHas(cx + 1)); n++) cx = cx >= qw - 2 ? 1 : cx + 1;
  for (let y = qh - 1; y >= 0 && !(mask.get(cx, y) && mask.get(cx + 1, y)); y--) { mask.set(cx, y); mask.set(cx + 1, y); }
}

function buildMirrored(mask, w, h, rng, cfg, rooms) {
  const qw = w >> 1;
  const qh = h >> 1;
  const sw = rng.range(cfg.seedRoom[0], cfg.seedRoom[1]);
  const sh = rng.range(cfg.seedRoom[0], cfg.seedRoom[1]);
  const seed = { x: rng.range((qw - sw) >> 1, qw - 1 - sw), y: rng.range((qh - sh) >> 1, qh - 1 - sh), w: sw, h: sh };
  mapRoom(mask, seed);
  rooms.push({ ...seed, kind: 'room' });
  growTree(mask, seed, rng.chance(HALF_PCT), rng, cfg, qw, qh, rooms, 0, cfg.roomSizes, cfg.flipPctMirror);
  for (let i = 0; i < qw; i++) { mask.m[i] = 0; mask.m[i * w] = 0; }   // close outer borders (row 0, col 0)
  reachAxes(mask, qw, qh, rng);
  for (let y = 0; y < qh; y++) {
    for (let x = 0; x < qw; x++) {
      if (!mask.get(x, y)) continue;
      mask.set(w - 1 - x, y); mask.set(x, h - 1 - y); mask.set(w - 1 - x, h - 1 - y);
    }
  }
  const mirrored = [];
  for (const r of rooms) {
    mirrored.push({ ...r, x: w - r.x - r.w }, { ...r, y: h - r.y - r.h }, { ...r, x: w - r.x - r.w, y: h - r.y - r.h });
  }
  rooms.push(...mirrored);
}

function buildOssuary(mask, w, h, rng, cfg, rooms) {
  const hw = cfg.hallWidth;
  const m = cfg.hallMargin;
  const midY = (h >> 1) - (hw >> 1);
  const cols = [Math.round(w / 3) - (hw >> 1), Math.round((2 * w) / 3) - (hw >> 1)];
  const halls = [{ x: m, y: midY, w: w - 2 * m, h: hw }, ...cols.map((cx) => ({ x: cx, y: m, w: hw, h: h - 2 * m }))];
  for (const hall of halls) { mapRoom(mask, hall); rooms.push({ ...hall, kind: 'hall' }); }
  const nodes = [[m, midY], [w - m - hw, midY], ...cols.flatMap((cx) => [[cx, m], [cx, h - m - hw], [cx, midY]])];
  for (const [nx, ny] of nodes) {
    const cw = rng.range(cfg.chamber[0], cfg.chamber[1]);
    const ch = rng.range(cfg.chamber[0], cfg.chamber[1]);
    const room = { x: Math.max(1, Math.min(w - 1 - cw, nx + (hw >> 1) - (cw >> 1))), y: Math.max(1, Math.min(h - 1 - ch, ny + (hw >> 1) - (ch >> 1))), w: cw, h: ch };
    mapRoom(mask, room);
    rooms.push({ ...room, kind: 'chamber' });
    growTree(mask, room, rng.chance(HALF_PCT), rng, { ...cfg, maxDepth: cfg.alcoveDepth, alternate: true }, w - 1, h - 1, rooms, 0, cfg.alcoveSizes, cfg.flipPctOssuary);
  }
  for (const hall of halls) {
    const horizontal = hall.w > hall.h;
    const len = horizontal ? hall.w : hall.h;
    for (let t = rng.range(cfg.alcoveStep[0], cfg.alcoveStep[1]); t < len - 2; t += rng.range(cfg.alcoveStep[0], cfg.alcoveStep[1])) {
      if (!rng.chance(cfg.alcovePct)) continue;
      const aw = rng.pick(cfg.alcoveSizes);
      const ah = rng.pick(cfg.alcoveSizes);
      const side = rng.chance(HALF_PCT);
      const r = horizontal
        ? { x: hall.x + t, y: side ? hall.y - ah : hall.y + hall.h, w: aw, h: ah }
        : { x: side ? hall.x - aw : hall.x + hall.w, y: hall.y + t, w: aw, h: ah };
      const skip = horizontal ? (side ? 'S' : 'N') : (side ? 'E' : 'W');
      if (!checkRoom(mask, r, w - 1, h - 1, skip)) continue;
      mapRoom(mask, r);
      rooms.push({ ...r, kind: 'alcove' });
    }
  }
}

/** Reference AddWall: wall a floor run flanked by floor that starts at a wall and ends on a wall; leave one doorway. */
function carveWalls(tiles, rng, minRun, doorway, wallPct, doorPct, doorSpecs) {
  const { w, h } = tiles;
  const guard = new Uint8Array(w * h);
  const flanked = (x, y, horiz) => isFloor(tiles, x, y) && !guard[idx(tiles, x, y)]
    && (horiz ? isFloor(tiles, x, y - 1) && isFloor(tiles, x, y + 1) : isFloor(tiles, x - 1, y) && isFloor(tiles, x + 1, y));
  for (const horiz of [true, false]) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const px = horiz ? x - 1 : x;
        const py = horiz ? y : y - 1;
        if (isFloor(tiles, px, py) || !flanked(x, y, horiz)) continue;
        let len = 0;
        while (flanked(x + (horiz ? len : 0), y + (horiz ? 0 : len), horiz)) len++;
        const ex = x + (horiz ? len : 0);
        const ey = y + (horiz ? 0 : len);
        const endsOnWall = !isFloor(tiles, ex, ey);
        if (!endsOnWall || len < minRun || len < doorway || !rng.chance(wallPct)) continue;
        const off = rng.range(len > doorway + 1 ? 1 : 0, Math.max(0, len - doorway - (len > doorway + 1 ? 1 : 0)));
        for (let k = 0; k < len; k++) {
          const tx = x + (horiz ? k : 0);
          const ty = y + (horiz ? 0 : k);
          guard[idx(tiles, tx, ty)] = 1;
          if (k >= off && k < off + doorway) {
            if (doorway === 1) {
              if (rng.chance(doorPct)) { setFlag(tiles, tx, ty, T.DOOR); doorSpecs.push({ x: tx, y: ty }); }
            }
            continue;
          }
          setWall(tiles, tx, ty, WALL_STYLE);
        }
      }
    }
  }
}

/**
 * Generate a halls level.
 * @param {object} rng forked rng
 * @param {number} w
 * @param {number} h
 * @param {{mirror?:boolean, chamberStyle?:string}} [opts] plus overrides for balance.levels.halls
 * @returns {{ tiles:object, rooms:Array<{x:number,y:number,w:number,h:number,kind:string}>, doorSpecs:Array<{x:number,y:number}>, corridorFloor:number }}
 */
export function generateHalls(rng, w, h, opts = {}) {
  const cfg = { ...LEVELS.halls, mirror: true, ...opts };
  const mask = makeMask(w, h);
  const rooms = [];
  if (cfg.mirror) buildMirrored(mask, w, h, rng, { ...cfg, alternate: false }, rooms);
  else buildOssuary(mask, w, h, rng, cfg, rooms);
  const tiles = createTiles(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask.get(x, y)) carveRect(tiles, rng, x, y, 1, 1, FLOOR);
  if (!rectAll(1, 1, w - 2, h - 2, (x, y) => inBounds(tiles, x, y))) return { tiles, rooms, doorSpecs: [], corridorFloor: 0 };
  raiseWalls(tiles, WALL_STYLE);
  const doorSpecs = [];
  const minRun = cfg.mirror ? cfg.minRunMirror : cfg.minRunOssuary;
  const doorway = cfg.mirror ? cfg.doorwayMirror : cfg.doorwayOssuary;
  carveWalls(tiles, rng, minRun, doorway, cfg.wallPct, cfg.doorPct, doorSpecs);
  sprinkleFloor(tiles, rng, FLOOR, FLOOR_ALT, cfg.floorAltPct);
  return { tiles, rooms, doorSpecs, corridorFloor: 0 };
}

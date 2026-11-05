/**
 * Hub town (depth 0): a fixed outdoor layout from theme.town — open ground
 * with a paved central plaza, 5–7 solid "buildings" (each with a sign at its
 * door side), decor objects, NPCs at their placements, and the dungeon
 * entrance (stairs down to depth 1). Fully lit and explored; no monsters.
 *
 * Buildings come from `town.buildings` when present, else are laid out by
 * `town.layout` ('plaza' | 'street' | 'ring') with the town rng.
 */
import { T, idx, setFlag, inBounds } from './tiles.js';
import { MAX_LIGHT } from './fov.js';
import { carveRect, setWall, freeTileNear, isWalkableLevel, rectsOverlap, rectContains } from './levelgen/grid.js';
import { createEmptyLevel, paletteFor } from './levelgen/index.js';
import { createObject } from '../entities/objects.js';
import { LEVELS } from '../../data/balance/levels.js';

const GROUND = 1;
const GROUND_ALT = 2;
const PAVED = 3;
const FENCE_STYLE = 1;
const DECOR_TYPES = { lamp: 'lamp_post', crate: 'crate', barrel: 'barrel', well: 'well_stone', sign: 'sign_post', brazier: 'brazier', fountain: 'fountain_murk' };
const DOOR_SIDES = ['N', 'S', 'E', 'W'];
const NPC_FRAME_TICKS = 8;
const PLACEHOLDER_LOOK = { silhouette: 'lean', bodyColor: '#a08060', trimColor: '#403020' };

const bal = (game) => game.balance?.levels?.town || LEVELS.town;

function plazaRect(w, h, cfg) {
  const [pw, ph] = cfg.plazaSize;
  return { x: (w - pw) >> 1, y: (h - ph) >> 1, w: pw, h: ph };
}

/** Auto layout: rejection-sample building rects inside a layout-specific zone. */
function layoutBuildings(town, rng, w, h, cfg, blocked) {
  const n = rng.range(cfg.buildings[0], cfg.buildings[1]);
  const plaza = plazaRect(w, h, cfg);
  const zoneOk = (r) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (town.layout === 'street') return Math.abs(cy - h / 2) > cfg.streetHalf + r.h / 2;
    if (town.layout === 'ring') {
      const d = Math.hypot(cx - w / 2, cy - h / 2) / Math.min(w, h);
      return d >= cfg.ringRadius[0] && d <= cfg.ringRadius[1];
    }
    return !rectsOverlap(plaza, r, cfg.buildingMargin);
  };
  const out = [];
  for (let t = 0; t < cfg.placeTries && out.length < n; t++) {
    const bw = rng.range(cfg.buildingW[0], cfg.buildingW[1]);
    const bh = rng.range(cfg.buildingH[0], cfg.buildingH[1]);
    const r = { x: rng.range(2, w - bw - 3), y: rng.range(2, h - bh - 3), w: bw, h: bh };
    if (!zoneOk(r) || out.some((o) => rectsOverlap(o, r, cfg.buildingMargin)) || blocked.some((p) => rectContains({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, p.x, p.y))) continue;
    const toCentre = { x: w / 2 - (r.x + r.w / 2), y: h / 2 - (r.y + r.h / 2) };
    const door = Math.abs(toCentre.x) > Math.abs(toCentre.y) ? (toCentre.x > 0 ? 'E' : 'W') : (toCentre.y > 0 ? 'S' : 'N');
    out.push({ ...r, door, name: `Building ${out.length + 1}` });
  }
  return out;
}

function doorSpot(b) {
  switch (b.door) {
    case 'N': return { x: b.x + (b.w >> 1), y: b.y - 1 };
    case 'E': return { x: b.x + b.w, y: b.y + (b.h >> 1) };
    case 'W': return { x: b.x - 1, y: b.y + (b.h >> 1) };
    default: return { x: b.x + (b.w >> 1), y: b.y + b.h };
  }
}

function placeNpc(game, level, placement, npcDef) {
  const spot = isWalkableLevel(level, placement.x, placement.y) ? { x: placement.x, y: placement.y } : freeTileNear(level, placement.x, placement.y, LEVELS.stairs.entrySearch);
  if (!spot) return null;
  let npc = game.hooks?.createNpc?.(game, placement.npcId, spot.x, spot.y) || null;
  if (!npc) {
    if (!game.nextId) game.nextId = 1;
    npc = {
      id: game.nextId++, kind: 'npc', npcId: placement.npcId, name: npcDef?.name || placement.npcId, role: npcDef?.role || 'gossip',
      tx: spot.x, ty: spot.y, ox: 0, oy: 0, dir: 0, anim: 'stand', frame: 0, frameTicks: NPC_FRAME_TICKS, frameAcc: 0,
      path: null, moveSpeed: 0, hp: 1, hpMax: 1, dead: false, flash: 0, look: npcDef?.look || PLACEHOLDER_LOOK, placeholder: true,
      vendorType: npcDef?.vendorType || null, stock: [], stockDepth: 0, greeting: npcDef?.greeting || [], lines: npcDef?.gossip || [],
    };
  }
  if (!level.npcs.includes(npc)) level.npcs.push(npc);
  level.occupant[idx(level.tiles, npc.tx, npc.ty)] = npc.id;
  return npc;
}

/**
 * Build the hub town level from theme.town.
 * @param {object} game
 * @returns {object} Level with isTown = true
 */
export function buildTown(game) {
  const town = game.theme.town;
  const cfg = bal(game);
  const [w, h] = town.size;
  const rng = game.rng.fork('town');
  const level = createEmptyLevel(w, h, 0, 0, town.tilesetId || 'town');
  const tiles = level.tiles;
  carveRect(tiles, rng, 1, 1, w - 2, h - 2, GROUND);
  for (let i = 0; i < tiles.floor.length; i++) if (tiles.floor[i] === GROUND && rng.chance(cfg.groundAltPct)) tiles.floor[i] = GROUND_ALT;
  const plaza = plazaRect(w, h, cfg);
  carveRect(tiles, rng, plaza.x, plaza.y, plaza.w, plaza.h, PAVED);
  for (let x = 0; x < w; x++) { setWall(tiles, x, 0, FENCE_STYLE); setWall(tiles, x, h - 1, FENCE_STYLE); }
  for (let y = 0; y < h; y++) { setWall(tiles, 0, y, FENCE_STYLE); setWall(tiles, w - 1, y, FENCE_STYLE); }

  const blocked = [town.dungeonEntrance, ...(town.npcPlacements || []), ...(town.decor || [])];
  const buildings = town.buildings || layoutBuildings(town, rng, w, h, cfg, blocked);
  level.rooms = [];
  buildings.forEach((b, i) => {
    const style = (i % Math.max(1, town.buildingColors.length)) + 1;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) setWall(tiles, x, y, style);
    const d = doorSpot(b);
    if (inBounds(tiles, d.x, d.y) && DOOR_SIDES.includes(b.door)) createObject(game, 'sign_post', d.x, d.y, { level, text: b.name });
    level.rooms.push({ x: b.x, y: b.y, w: b.w, h: b.h, kind: 'building', name: b.name });
  });

  for (const d of town.decor || []) {
    const typeId = (town.decorTypes || DECOR_TYPES)[d.kind];
    if (typeId && isWalkableLevel(level, d.x, d.y)) createObject(game, typeId, d.x, d.y, { level, text: d.text, light: d.kind === 'lamp' ? cfg.lampLight : undefined });
  }

  const e = town.dungeonEntrance;
  setFlag(tiles, e.x, e.y, T.STAIRS_DOWN);
  createObject(game, 'stairs_down', e.x, e.y, { level, state: 'down', linkDepth: 1 });
  level.stairs = { up: null, down: { x: e.x, y: e.y }, town: null };

  const npcDefs = game.theme.npcs || [];
  for (const p of town.npcPlacements || []) placeNpc(game, level, p, npcDefs.find((n) => n.id === p.npcId));

  level.isTown = true;
  level.name = town.name;
  level.seed = rng.seed;
  level.visited = true;
  level.palette = paletteFor({ floors: town.groundColors, walls: town.buildingColors, accent: town.accent, doorColor: town.buildingColors[0], voidColor: '#000000', lightTint: '#ffffff' }, game.balance?.levels?.palette || LEVELS.palette);
  level.explored.fill(1);
  level.light.fill(MAX_LIGHT);
  level.ambientLight = MAX_LIGHT;
  level.entry = freeTileNear(level, e.x, e.y, LEVELS.stairs.entrySearch, () => true) || { x: e.x, y: e.y + 1 };
  level.spawn = town.spawn && isWalkableLevel(level, town.spawn.x, town.spawn.y) ? { ...town.spawn } : level.entry;
  level.portalAnchor = town.portalAnchor || { x: plaza.x + (plaza.w >> 1), y: plaza.y + plaza.h - 1 };
  level.lights = level.objects.filter((o) => o.light > 0).map((o) => ({ x: o.tx, y: o.ty, r: o.light }));
  return level;
}

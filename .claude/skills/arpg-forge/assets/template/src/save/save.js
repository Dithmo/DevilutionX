/**
 * Save / load to localStorage under `arpg:<themeId>:<slot>`.
 *
 * `saveGame` snapshots the game into JSON-safe plain data (typed arrays →
 * base64, Set/Map → tagged arrays, transient fields dropped). `loadGame`
 * returns that plain data; `restoreGame(data, game)` rebuilds runtime shapes
 * (typed arrays, Sets, occupancy, light buffers) onto a live game object.
 * All storage access is guarded: a missing or full localStorage never throws.
 */
import ACTIVE_THEME from '../../data/active_theme.js';

export const SAVE_VERSION = 1;
const KEY_PREFIX = 'arpg';
const TRANSIENT_KEYS = new Set(['path', 'intent', 'occupant', 'light', 'lightMap', 'missiles', 'hover', 'questTalk']);
const TYPED = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
const B64 = 'base64';

function storage() {
  try { return globalThis.localStorage || null; } catch (err) { return null; }
}
function saveKey(themeId, slot) { return `${KEY_PREFIX}:${themeId || ACTIVE_THEME}:${slot}`; }

function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(B64);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(str) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(str, B64); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Convert any game value to JSON-safe plain data. Functions and transient
 * keys are dropped; typed arrays, Sets and Maps are tagged.
 * @param {*} v
 * @param {WeakSet} [seen] cycle guard
 * @returns {*}
 */
export function encode(v, seen = new WeakSet()) {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (ArrayBuffer.isView(v)) return { __ta: v.constructor.name, b64: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (seen.has(v)) return undefined;
  seen.add(v);
  let out;
  if (v instanceof Set) out = { __set: Array.from(v, (x) => encode(x, seen)) };
  else if (v instanceof Map) out = { __map: Array.from(v, ([k, x]) => [encode(k, seen), encode(x, seen)]) };
  else if (Array.isArray(v)) out = v.map((x) => { const e = encode(x, seen); return e === undefined ? null : e; });
  else {
    out = {};
    for (const k in v) {
      if (TRANSIENT_KEYS.has(k) || k.startsWith('__')) continue;
      const e = encode(v[k], seen);
      if (e !== undefined) out[k] = e;
    }
  }
  seen.delete(v);
  return out;
}

/**
 * Inverse of `encode`: rebuilds typed arrays, Sets and Maps.
 * @param {*} v
 * @returns {*}
 */
export function decode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  if (v.__ta) {
    const C = TYPED[v.__ta] || Uint8Array;
    const bytes = b64ToBytes(v.b64);
    const copy = new Uint8Array(bytes);
    return new C(copy.buffer, 0, copy.byteLength / C.BYTES_PER_ELEMENT);
  }
  if (v.__set) return new Set(v.__set.map(decode));
  if (v.__map) return new Map(v.__map.map(([k, x]) => [decode(k), decode(x)]));
  const out = {};
  for (const k in v) out[k] = decode(v[k]);
  return out;
}

function snapshotLevel(level) {
  if (!level) return null;
  const copy = { ...level, monsters: (level.monsters || []).filter((m) => !m.dead) };
  return encode(copy);
}

/**
 * Build the plain save record for a game (no storage access).
 * @param {object} game
 * @returns {object}
 */
export function serializeGame(game) {
  const p = game.player;
  const levels = {};
  const all = { ...(game.levels || {}) };
  if (game.town) all[0] = game.town;
  if (game.level) all[game.level.depth] = game.level;
  for (const d in all) levels[d] = snapshotLevel(all[d]);
  return {
    version: SAVE_VERSION,
    themeId: game.theme && game.theme.meta ? game.theme.meta.id : ACTIVE_THEME,
    savedAt: Date.now(),
    summary: p ? { name: p.name, classId: p.classId, level: p.level, depth: game.level ? game.level.depth : 0 } : null,
    seed: game.seed, rngState: game.rng ? game.rng.state : 0, tick: game.tick, mode: game.mode,
    difficulty: game.difficulty || 'normal', nextId: game.nextId,
    depth: game.level ? game.level.depth : 0,
    player: encode(p), quests: encode(game.quests), stats: encode(game.stats), flags: encode(game.flags || {}),
    ui: { belt: encode(game.ui && game.ui.belt), selectedSkill: game.ui ? game.ui.selectedSkill : null },
    levels,
  };
}

/**
 * Save the game into a slot.
 * @param {object} game
 * @param {string|number} slot
 * @returns {boolean} false when storage is unavailable or full
 */
export function saveGame(game, slot) {
  const st = storage();
  if (!st) return false;
  try {
    const data = serializeGame(game);
    st.setItem(saveKey(data.themeId, slot), JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Read the plain save record for a slot (null when absent or corrupt).
 * @param {string|number} slot
 * @param {string} [themeId]
 * @returns {object|null}
 */
export function loadGame(slot, themeId) {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(saveKey(themeId, slot));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.version === SAVE_VERSION ? data : null;
  } catch (err) {
    return null;
  }
}

/** @returns {boolean} */
export function hasSave(slot, themeId) {
  const st = storage();
  try { return !!(st && st.getItem(saveKey(themeId, slot))); } catch (err) { return false; }
}

/** @returns {boolean} true if a save was removed */
export function deleteSave(slot, themeId) {
  const st = storage();
  if (!st) return false;
  try {
    const key = saveKey(themeId, slot);
    const had = !!st.getItem(key);
    st.removeItem(key);
    return had;
  } catch (err) { return false; }
}

/**
 * List saves for a theme, newest first.
 * @param {string} [themeId]
 * @returns {Array<{slot:string, key:string, savedAt:number, summary:object|null}>}
 */
export function listSaves(themeId) {
  const st = storage();
  const out = [];
  if (!st) return out;
  const prefix = `${KEY_PREFIX}:${themeId || ACTIVE_THEME}:`;
  try {
    for (let i = 0; i < st.length; i++) {
      const key = st.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        const data = JSON.parse(st.getItem(key));
        out.push({ slot: key.slice(prefix.length), key, savedAt: data.savedAt || 0, summary: data.summary || null });
      } catch (err) { /* skip corrupt entry */ }
    }
  } catch (err) { /* storage iteration failed */ }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

function actorDefaults(e) {
  e.path = null; e.flash = e.flash || 0; e.ox = e.ox || 0; e.oy = e.oy || 0;
  e.frameAcc = e.frameAcc || 0; e.anim = e.anim || 'stand'; e.frame = e.frame || 0;
  return e;
}

function restoreLevel(raw) {
  const level = decode(raw);
  const t = level.tiles;
  const n = t ? t.w * t.h : 0;
  level.light = new Uint8Array(n);
  level.occupant = new Int32Array(n);
  level.missiles = [];
  if (!level.explored) level.explored = new Uint8Array(n);
  for (const m of level.monsters || []) { actorDefaults(m); m.target = m.target || null; }
  for (const npc of level.npcs || []) actorDefaults(npc);
  level.objects = level.objects || []; level.items = level.items || [];
  for (const list of [level.monsters || [], level.npcs || []]) {
    for (const e of list) if (!e.dead && t) level.occupant[e.ty * t.w + e.tx] = e.id;
  }
  return level;
}

/**
 * Rebuild runtime state from a plain save record onto `game`. The caller
 * supplies a game with core services (rng, bus, theme, balance, strings).
 * @param {object} data from loadGame
 * @param {object} game
 * @returns {object} the same game
 */
export function restoreGame(data, game) {
  game.seed = data.seed;
  if (game.rng && typeof data.rngState === 'number') game.rng.setState(data.rngState);
  game.tick = data.tick || 0;
  game.mode = data.mode || 'town';
  game.difficulty = data.difficulty || 'normal';
  game.nextId = data.nextId || 1;
  game.player = actorDefaults(decode(data.player));
  game.player.intent = null;
  game.player.state = game.player.state || { hitRecoverTicks: 0, invulnTicks: 0, manaShield: 0, buffs: [] };
  game.quests = decode(data.quests) || {};
  game.stats = decode(data.stats) || { kills: 0, deaths: 0, gold: 0, deepest: 0, playTicks: 0 };
  game.flags = decode(data.flags) || {};
  game.ui = game.ui || {};
  if (data.ui) { game.ui.belt = decode(data.ui.belt) || game.ui.belt; game.ui.selectedSkill = data.ui.selectedSkill; }
  game.levels = {};
  for (const d in data.levels || {}) if (data.levels[d]) game.levels[d] = restoreLevel(data.levels[d]);
  game.town = game.levels[0] || null;
  game.level = game.levels[data.depth] || game.town || null;
  const p = game.player;
  if (game.level && game.level.occupant) game.level.occupant[p.ty * game.level.tiles.w + p.tx] = p.id;
  return game;
}

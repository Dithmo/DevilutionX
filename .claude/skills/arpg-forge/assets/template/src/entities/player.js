/**
 * Player facade + per-tick state machine.
 *
 * Re-exports the pure pieces (player_stats, player_move, player_items) and
 * adds: createPlayer (with the class start kit), installPlayerHooks (the
 * integration seam `game.hooks`), and updatePlayer:
 *
 *   dead → death anim | hit recovery → wait | attack/cast anim → resolve on
 *   action frame, chain next intent when it wraps | intent → path / start
 *   action | walk one step | on arrival re-check intent (same tick).
 *
 * Intents (`p.intent`): { type:'move', target:{x,y} } · { type:'attack', target: monsterId }
 * · { type:'cast', target:{x,y}|id, skillId? } · { type:'pickup'|'interact'|'talk', target: id }.
 */
import { generateItem } from '../items/itemgen.js';
import { tryPickUp, equip, canEquip, recalcPlayer } from '../items/inventory.js';
import { castSkill, manaCost } from '../skills/skills.js';
import { spawnMissile } from './missile.js';
import { playerMeleeHit, applyDamageToMonster } from './combat.js';
import { setAnim, advanceAnim, actionFrameReached, ANIM_FRAMES } from './anim.js';
import { createPlayerBase, classDef, recalcPlayerBase, tickBuffs, regenTick } from './player_stats.js';
import { setPlayerPath, stepWalk, faceToward } from './player_move.js';
import { identifyFirstUnknown } from './player_items.js';
import { weaponDamage } from './combat_rolls.js';
import { dist, dirToDelta } from '../world/pathfind.js';
import { worldPos } from '../render/camera.js';
import * as C from '../../data/balance/combat.js';
import { REPATH_WAIT_TICKS, MAX_REPATH_TRIES } from '../../data/balance/progression.js';

export * from './player_stats.js';
export { useBeltSlot, useConsumable, applyConsumableEffect, consumableDef, identifyFirstUnknown } from './player_items.js';
export { setPlayerPath, stepWalk, cancelWalk, faceToward, isAdjacent } from './player_move.js';

const ADJACENT = 1;
const ACTION_ANIMS = ['attack', 'cast', 'special'];
const RING_SLOTS = ['ring1', 'ring2'];
const MSG_NO_MANA = 'Not enough mana.';

/**
 * Install no-op integration hooks (kept if already present).
 * onPickup(game, item) · onInteract(game, obj) · onTalk(game, npc) ·
 * onTownPortal(game) -> boolean · onIdentify(game, scrollItem) -> boolean ·
 * recalcPlayer(game) (full item pipeline; player_stats routes pool recalcs through it)
 * @param {object} game
 * @returns {object} game.hooks
 */
export function installPlayerHooks(game) {
  game.hooks = {
    onPickup: (g, item) => tryPickUp(g, item),
    onInteract: () => false,
    onTalk: () => false,
    onTownPortal: () => false,
    onIdentify: (g) => identifyFirstUnknown(g, g.player),
    recalcPlayer: (g) => recalcPlayer(g),
    ...(game.hooks || {}),
  };
  return game.hooks;
}

function equipSlotFor(p, item) {
  if (item.slot === 'ring') return RING_SLOTS.find((s) => !p.equipment[s]) || null;
  if (p.equipment[item.slot] === undefined) return null;
  return p.equipment[item.slot] ? null : item.slot;
}

function giveStartItem(game, p, kit) {
  let item = null;
  try {
    item = generateItem(game, { level: 1, quality: 'any', baseId: kit.baseId, source: 'startKit' });
  } catch (err) {
    console.warn('[player] start kit item failed', kit.baseId, err);
  }
  if (!item) return;
  if (kit.count) item.count = kit.count;
  try {
    const slot = equipSlotFor(p, item);
    if (slot && canEquip(p, item) && equip(game, item, slot).ok) return;
    if (item.slot === 'consumable') {
      const free = p.belt.indexOf(null);
      if (free >= 0) { p.belt[free] = item; return; }
    }
    tryPickUp(game, item);
  } catch (err) {
    console.warn('[player] start kit placement failed', kit.baseId, err);
  }
}

/**
 * Create the player with the class start kit equipped / belted / stowed.
 * Sets game.player.
 * @param {object} game
 * @param {string} classId
 * @param {string} name
 * @returns {object} Player
 */
export function createPlayer(game, classId, name) {
  installPlayerHooks(game);
  const p = createPlayerBase(game, classId, name);
  game.player = p;
  const cls = classDef(game, p);
  for (const kit of cls.startKit || []) giveStartItem(game, p, kit);
  try { recalcPlayer(game); } catch (err) { console.warn('[player] recalcPlayer failed', err); }
  recalcPlayerBase(p, cls);
  p.hp = p.hpMax;
  p.mp = p.mpMax;
  return p;
}

const byId = (list, id) => (list || []).find((e) => e.id === id) || null;

function monsterAt(level, x, y) {
  return (level.monsters || []).find((m) => !m.dead && m.tx === x && m.ty === y) || null;
}

function hasBow(p) {
  const w = p.equipment.weapon;
  return !!(w && w.type === 'bow');
}

function startMelee(game, p, cls, m) {
  p.path = null;
  faceToward(p, m.tx, m.ty);
  const skip = ((p.derived && p.derived.attackSpeed) || 0) | 0;
  setAnim(p, 'attack', cls.frames.attack, ANIM_FRAMES.attack, cls.frames.actionFrame, skip);
  p.action = { type: 'melee', targetId: m.id };
  game.bus.emit('sfx', { name: 'swing', x: p.tx, y: p.ty });
}

function startRanged(game, p, cls, m) {
  p.path = null;
  faceToward(p, m.tx, m.ty);
  const skip = ((p.derived && p.derived.attackSpeed) || 0) | 0;
  setAnim(p, 'attack', cls.frames.attack, ANIM_FRAMES.attack, cls.frames.actionFrame, skip);
  p.action = { type: 'ranged', targetId: m.id, tx: m.tx, ty: m.ty };
}

function startCast(game, p, cls, skillId, target) {
  p.path = null;
  if (target) faceToward(p, target.x, target.y);
  const af = Math.min(cls.frames.actionFrame, ANIM_FRAMES.cast - 1);
  setAnim(p, 'cast', cls.frames.cast, ANIM_FRAMES.cast, af);
  p.action = { type: 'cast', skillId, target };
  game.bus.emit('sfx', { name: 'cast', x: p.tx, y: p.ty });
}

function resolveTarget(level, target) {
  if (!target) return null;
  if (typeof target === 'object') return { x: target.x, y: target.y };
  const m = byId(level.monsters, target) || byId(level.objects, target) || byId(level.npcs, target);
  return m ? { x: m.tx, y: m.ty, id: m.id } : null;
}

/** Resolve the queued action on the animation's action frame. */
function resolveAction(game, p, cls) {
  const a = p.action;
  const level = game.level;
  if (!a) return;
  if (a.type === 'melee') {
    let m = byId(level.monsters, a.targetId);
    if (!m || m.dead || dist(p.tx, p.ty, m.tx, m.ty) > ADJACENT) {
      const d = dirToDelta(p.dir);
      m = monsterAt(level, p.tx + d.x, p.ty + d.y);
    }
    if (!m) return;
    const r = playerMeleeHit(game, p, m);
    if (!r.hit || m.dead) return;
    const procs = (p.derived && p.derived.elemDmg) || {}; // { fire: {min,max}, ... } from items/recalc.js
    for (const el of Object.keys(procs)) {
      if (!m.dead && procs[el].max > 0) applyDamageToMonster(game, m, game.rng.range(procs[el].min || 1, procs[el].max), el, p);
    }
  } else if (a.type === 'ranged') {
    const m = byId(level.monsters, a.targetId);
    const to = m && !m.dead ? { x: m.tx, y: m.ty } : { x: a.tx, y: a.ty };
    // spawnMissile takes tile coords for from/to; the arrow archetype rolls to-hit on impact.
    spawnMissile(game, {
      archetype: 'arrow', owner: p, from: { x: p.tx, y: p.ty }, to, skillId: null, level: p.level,
      dmg: weaponDamage(p), element: 'phys', look: C.ARROW_LOOK,
    });
    game.bus.emit('sfx', { name: 'bowShot', x: p.tx, y: p.ty });
  } else if (a.type === 'cast') {
    castSkill(game, p, a.skillId, a.target);
  }
}

/** Path toward a goal with throttled re-pathing; clears the intent after too many failures. */
function ensurePathTo(game, p, it, goal) {
  if (p.path || p.walk) {
    const moved = it.goal && (it.goal.x !== goal.x || it.goal.y !== goal.y);
    if (!moved || game.tick - (it.pathTick || 0) < REPATH_WAIT_TICKS) return;
  } else if (it.repathWait > 0) {
    it.repathWait -= 1;
    return;
  }
  if (setPlayerPath(game, p, goal)) {
    it.goal = { x: goal.x, y: goal.y };
    it.pathTick = game.tick;
    it.blocked = false;
    return;
  }
  it.tries = (it.tries || 0) + 1;
  it.repathWait = REPATH_WAIT_TICKS;
  if (it.tries >= MAX_REPATH_TRIES) p.intent = null;
}

/** Walk adjacent to an entity, then run `fn` facing it. */
function approachThen(game, p, it, target, fn) {
  if (!target) { p.intent = null; return; }
  if (!p.walk && dist(p.tx, p.ty, target.tx, target.ty) <= ADJACENT) {
    p.path = null;
    faceToward(p, target.tx, target.ty);
    p.intent = null;
    fn();
    return;
  }
  ensurePathTo(game, p, it, { x: target.tx, y: target.ty });
}

function processIntent(game, p, cls) {
  const it = p.intent;
  const level = game.level;
  if (!it) return;
  switch (it.type) {
    case 'move': {
      const t = it.target;
      if (!p.walk && p.tx === t.x && p.ty === t.y) { p.intent = null; return; }
      if (!p.path && !p.walk && it.started && !it.blocked) { p.intent = null; return; }
      it.started = true;
      ensurePathTo(game, p, it, t);
      return;
    }
    case 'attack': {
      const m = byId(level.monsters, it.target);
      if (!m || m.dead) { p.intent = null; return; }
      const d = dist(p.tx, p.ty, m.tx, m.ty);
      if (!p.walk && hasBow(p) && d >= 1 && d <= C.BOW_RANGE_TILES) { startRanged(game, p, cls, m); return; }
      if (!p.walk && d <= ADJACENT) { startMelee(game, p, cls, m); return; }
      ensurePathTo(game, p, it, { x: m.tx, y: m.ty });
      return;
    }
    case 'cast': {
      const skillId = it.skillId || p.selectedSkill;
      if (!skillId || !(p.skills[skillId] >= 1)) { p.intent = null; return; }
      if (p.walk) return;
      const target = resolveTarget(level, it.target);
      if (p.mp < manaCost(p, skillId)) {
        game.bus.emit('message', { text: MSG_NO_MANA, color: game.theme.palette.textDim });
        game.bus.emit('sfx', { name: 'error' });
        p.intent = null;
        return;
      }
      p.intent = null;
      startCast(game, p, cls, skillId, target);
      return;
    }
    case 'pickup': {
      const item = byId(level.items, it.target);
      approachThen(game, p, it, item, () => game.hooks.onPickup(game, item));
      return;
    }
    case 'interact': {
      const obj = byId(level.objects, it.target);
      approachThen(game, p, it, obj, () => game.hooks.onInteract(game, obj));
      return;
    }
    case 'talk': {
      const npc = byId(level.npcs, it.target);
      approachThen(game, p, it, npc, () => game.hooks.onTalk(game, npc));
      return;
    }
    default:
      p.intent = null;
  }
}

/**
 * One simulation tick of the player (called by main.js step 2).
 * @param {object} game
 */
export function updatePlayer(game) {
  const p = game.player;
  if (!p || !game.level) return;
  if (!game.hooks) installPlayerHooks(game);
  const cls = classDef(game, p);
  const w = worldPos(p);
  p.prevX = w.x;
  p.prevY = w.y;
  if (p.flash > 0) p.flash -= 1;
  if (p.dead) {
    advanceAnim(p);
    p.deathTicks += 1;
    return;
  }
  if (p.state.invulnTicks > 0) p.state.invulnTicks -= 1;
  if (p.state.staggerGrace > 0) p.state.staggerGrace -= 1;
  tickBuffs(game, p);
  regenTick(game, p);
  if (p.state.hitRecoverTicks > 0) {
    p.state.hitRecoverTicks -= 1;
    advanceAnim(p);
    if (p.state.hitRecoverTicks <= 0) setAnim(p, 'stand');
    return;
  }
  if (ACTION_ANIMS.includes(p.anim)) {
    const wrapped = advanceAnim(p);
    if (actionFrameReached(p)) resolveAction(game, p, cls);
    if (p.dead || !wrapped) return;
    setAnim(p, 'stand');
    p.action = null;
  }
  processIntent(game, p, cls);
  if (ACTION_ANIMS.includes(p.anim)) return;
  const r = stepWalk(game, p, cls);
  if (r === 'blocked' && p.intent) {
    p.intent.blocked = true;
    p.intent.repathWait = REPATH_WAIT_TICKS;
    p.intent.tries = (p.intent.tries || 0) + 1;
    if (p.intent.tries >= MAX_REPATH_TRIES) p.intent = null;
  } else if (r === 'arrived' && p.intent && p.intent.type !== 'move') {
    processIntent(game, p, cls);
  } else if (r === 'idle') {
    advanceAnim(p);
  }
}

/**
 * Minimal animation model shared by every actor.
 *
 * An entity carries `anim` (name), `frame` (0-based), `frameTicks` (ticks per
 * frame), `frameAcc`, `frames` (frame count), `actionFrame` (0-based frame on
 * which an attack/cast resolves, -1 = none), `actionDone` and `animDone`.
 * Looping anims (stand, walk) wrap; one-shot anims (attack, cast, hit, death,
 * special) report the wrap once and `death` then holds its last frame.
 */

/** Frame counts per anim name (our simple model; reference 8 walk / 16 attack @1 tick -> 8 @2 ticks). */
export const ANIM_FRAMES = Object.freeze({
  stand: 1,
  walk: 8,
  attack: 8,
  cast: 8,
  hit: 4,
  death: 10,
  special: 8,
});

/** Anims that loop forever; every other anim is one-shot. */
export const LOOPING_ANIMS = Object.freeze(['stand', 'walk']);
const HOLD_LAST_ANIMS = Object.freeze(['death']);
const NO_ACTION_FRAME = -1;

/**
 * Switch an entity to an animation (resets frame counters).
 * @param {object} e entity
 * @param {string} name anim name
 * @param {number} [frameTicks=1] ticks per frame (>= 1)
 * @param {number} [frames] frame count (defaults to ANIM_FRAMES[name])
 * @param {number} [actionFrame=-1] 0-based frame on which the action resolves
 * @param {number} [startFrame=0] skip frames (attack-speed items); clamped before the action frame
 */
export function setAnim(e, name, frameTicks = 1, frames = ANIM_FRAMES[name] || 1, actionFrame = NO_ACTION_FRAME, startFrame = 0) {
  e.anim = name;
  e.frameTicks = Math.max(1, frameTicks | 0);
  e.frames = Math.max(1, frames | 0);
  e.actionFrame = actionFrame;
  const maxStart = actionFrame >= 0 ? Math.max(0, actionFrame - 1) : e.frames - 1;
  e.frame = Math.max(0, Math.min(startFrame | 0, maxStart));
  e.frameAcc = 0;
  e.actionDone = false;
  e.animDone = false;
}

/**
 * Advance one tick. Returns true on the tick the animation wraps / finishes.
 * Death holds its last frame after finishing and keeps returning false.
 * @param {object} e
 * @returns {boolean}
 */
export function advanceAnim(e) {
  if (e.animDone && HOLD_LAST_ANIMS.includes(e.anim)) return false;
  const frames = e.frames || ANIM_FRAMES[e.anim] || 1;
  e.frameAcc = (e.frameAcc || 0) + 1;
  if (e.frameAcc < (e.frameTicks || 1)) return false;
  e.frameAcc = 0;
  e.frame = (e.frame || 0) + 1;
  if (e.frame < frames) return false;
  if (HOLD_LAST_ANIMS.includes(e.anim)) {
    e.frame = frames - 1;
    e.animDone = true;
    return true;
  }
  e.frame = 0;
  if (!LOOPING_ANIMS.includes(e.anim)) e.animDone = true;
  return true;
}

/**
 * One-shot check: true exactly once per setAnim, on the first tick the
 * current frame is at or past the action frame.
 * @param {object} e
 * @returns {boolean}
 */
export function actionFrameReached(e) {
  if (e.actionDone || e.actionFrame === undefined || e.actionFrame < 0) return false;
  if ((e.frame || 0) < e.actionFrame) return false;
  e.actionDone = true;
  return true;
}

/** @returns {boolean} true while the entity is in a looping (idle/walk) anim */
export function isIdleAnim(e) {
  return LOOPING_ANIMS.includes(e.anim);
}

/**
 * Total ticks an anim takes from frame 0 to its wrap.
 * @param {string} name
 * @param {number} frameTicks
 * @returns {number}
 */
export function animTicks(name, frameTicks = 1) {
  return (ANIM_FRAMES[name] || 1) * Math.max(1, frameTicks | 0);
}

/**
 * Skill registry, mana cost, damage scaling, learning and tooltips. Casting
 * lives in cast.js (re-exported here). The registry is filled from
 * `game.theme.skills` on first use (or explicitly via `initSkills`).
 */
import { SKILLS } from '../../data/balance/skills.js';
import { activeStr } from '../../data/strings.js';

export { castSkill } from './cast.js';

const PCT = 100;
const DEFAULT_PALETTE = { text: '#e8e0d0', textDim: '#9a9080', danger: '#ff5050', good: '#80e080', accent: '#f0d060' };
let registry = new Map();
let registrySource = null;

/** Load (or replace) the skill table. @param {object[]} list theme skills */
export function initSkills(list) {
  registry = new Map(list.map((s) => [s.id, s]));
  registrySource = list;
}

/** Lazily load the registry from `game.theme.skills` (no-op when already current). */
export function ensureSkills(game) {
  const list = game && game.theme && game.theme.skills;
  if (list && list !== registrySource) initSkills(list);
}
const ensure = ensureSkills;
const isGame = (x) => !!(x && x.theme && 'player' in x);

/** @returns {object|null} skill row by id (game optional, used to lazy-load the theme) */
export function getSkillDef(game, skillId) {
  ensure(game);
  return registry.get(skillId) || null;
}

/** @returns {object|null} */
export function skillDef(skillId) {
  return registry.get(skillId) || null;
}

/** @returns {object[]} every registered skill */
export function allSkills() {
  return [...registry.values()];
}

const magOf = (p) => ((p.base && p.base.mag) || 0) + ((p.bonus && p.bonus.mag) || 0);

/**
 * Effective level: known level + item skill-level bonus, floored at 0 (0 = cannot cast).
 * @returns {number}
 */
export function skillLevel(player, skillId) {
  const known = (player.skills && player.skills[skillId]) || 0;
  if (known <= 0) return 0;
  const bonus = (player.derived && player.derived.spellLevels) || 0;
  return Math.max(SKILLS.effectiveLevelFloor, known + bonus);
}

/**
 * Mana cost: max(manaMin, (manaBase − manaPerLevel·(slvl−1) [+ manaPerCasterLevel·clvl]) · (1 − manaCostPct/100) · classMult)
 * where classMult is 1 for a class listed on the skill and 1.25 otherwise.
 * @returns {number}
 */
export function manaCost(player, skillId, slvlOverride) {
  const def = registry.get(skillId);
  if (!def) return 0;
  const slvl = slvlOverride ?? Math.max(1, skillLevel(player, skillId));
  let cost = def.manaBase - def.manaPerLevel * (slvl - 1) + (def.manaPerCasterLevel || 0) * (player.level || 1);
  const costPct = (player.derived && player.derived.manaCostPct) || 0;
  cost *= 1 - costPct / PCT;
  const inClass = !def.classes || !def.classes.length || def.classes.includes(player.classId);
  cost *= inClass ? SKILLS.inClassManaMult : SKILLS.offClassManaMult;
  return Math.max(def.manaMin || 0, Math.round(cost));
}

/**
 * Damage range: base + perCasterLevel·clvl + perSkillLevel·slvl (floored).
 * @returns {{min:number,max:number}}
 */
export function skillDamage(def, clvl, slvl) {
  const d = def.dmg || { base: [0, 0], perCasterLevel: [0, 0], perSkillLevel: [0, 0] };
  const min = Math.floor(d.base[0] + d.perCasterLevel[0] * clvl + d.perSkillLevel[0] * slvl);
  const max = Math.floor(d.base[1] + d.perCasterLevel[1] * clvl + d.perSkillLevel[1] * slvl);
  return { min: Math.max(0, min), max: Math.max(min, max) };
}

/** Skills a class can own: listed in skill.classes or in the class skillPool/levelSkills/startSkill. */
export function skillsForClass(theme, classId) {
  const cls = (theme.classes || []).find((c) => c.id === classId);
  const pool = new Set([...(cls && cls.skillPool ? cls.skillPool : []), ...Object.values((cls && cls.levelSkills) || {})]);
  if (cls && cls.startSkill) pool.add(cls.startSkill);
  return (theme.skills || []).filter((s) => (s.classes && s.classes.includes(classId)) || pool.has(s.id));
}

/**
 * Can the player cast this now (knows it, has the mana)?
 * @returns {{ok:boolean, reason?:'unknown'|'notLearned'|'mana', cost:number, slvl:number}}
 */
export function canCast(player, skillId, opts = {}) {
  if (isGame(player)) { // called as (game, player, skillId)
    ensure(player);
    player = skillId;
    skillId = opts;
    opts = {};
  }
  const def = registry.get(skillId);
  if (!def) return { ok: false, reason: 'unknown', cost: 0, slvl: 0 };
  const slvl = opts.slvl ?? skillLevel(player, skillId);
  if (slvl <= 0) return { ok: false, reason: 'notLearned', cost: 0, slvl };
  const cost = opts.free ? 0 : manaCost(player, skillId, slvl);
  if ((player.mp || 0) < cost) return { ok: false, reason: 'mana', cost, slvl };
  return { ok: true, cost, slvl };
}

/** Magic needed for the next tome of this skill: minMag · (1 + 0.2·knownLevel). @returns {number} */
export function tomeMagReq(player, skillId) {
  const def = registry.get(skillId);
  if (!def) return 0;
  const known = (player.skills && player.skills[skillId]) || 0;
  return Math.floor(def.minMag * (1 + SKILLS.tomeMagReqGrowth * known));
}

/**
 * Learn one level from a tome (level cap, class list / skill pool, growing magic requirement).
 * @returns {{ok:boolean, reason?:'unknown'|'maxLevel'|'class'|'magic', level?:number, need?:number}}
 */
export function learnSkill(game, p, skillId) {
  const def = getSkillDef(game, skillId);
  const bus = game.bus;
  const fail = (reason, text, need) => {
    if (bus) bus.emit('message', { text, color: 'danger' });
    return { ok: false, reason, need };
  };
  if (!def) return fail('unknown', 'Unknown skill.');
  const cur = (p.skills && p.skills[skillId]) || 0;
  if (cur >= SKILLS.maxSkillLevel) return fail('maxLevel', `${def.name} is already mastered.`);
  const cls = ((game.theme && game.theme.classes) || []).find((c) => c.id === p.classId);
  const allowed = (def.classes && def.classes.includes(p.classId)) || (cls && cls.skillPool && cls.skillPool.includes(skillId));
  if (!allowed) return fail('class', `You cannot learn ${def.name}.`);
  const need = tomeMagReq(p, skillId);
  if (magOf(p) < need) return fail('magic', `${def.name} needs ${need} magic.`, need);
  if (!p.skills) p.skills = {};
  p.skills[skillId] = cur + 1;
  if (!p.selectedSkill) p.selectedSkill = skillId;
  if (SKILLS.tomeManaRefund) p.mp = Math.min(p.mpMax || 0, (p.mp || 0) + def.manaBase);
  if (bus) bus.emit('message', { text: `${def.name} is now level ${cur + 1}.`, color: 'good' });
  if (bus) bus.emit('sfx', { name: 'levelup' });
  return { ok: true, level: cur + 1 };
}

/**
 * Tooltip lines for the skills panel: `[{text, color}]`.
 */
export function skillTooltipLines(player, skillId, palette = DEFAULT_PALETTE) {
  if (isGame(player)) { // called as (game, skillId)
    const game = player;
    ensure(game);
    player = game.player;
    palette = (game.theme && game.theme.palette) || DEFAULT_PALETTE;
  }
  const pal = { ...DEFAULT_PALETTE, ...palette };
  const def = registry.get(skillId);
  if (!def) return [{ text: skillId, color: pal.danger }];
  const slvl = skillLevel(player, skillId);
  const lines = [{ text: def.name, color: pal.accent }];
  if (def.blurb) lines.push({ text: def.blurb, color: pal.textDim });
  if (slvl > 0) {
    lines.push({ text: `Level ${slvl}`, color: pal.text });
    lines.push({ text: `${activeStr('mana', 'Mana')}: ${manaCost(player, skillId)}`, color: (player.mp || 0) >= manaCost(player, skillId) ? pal.text : pal.danger });
  } else {
    lines.push({ text: 'Not learned', color: pal.danger });
    lines.push({ text: `${activeStr('mana', 'Mana')}: ${manaCost(player, skillId, 1)}`, color: pal.textDim });
  }
  const lvl = Math.max(1, slvl);
  if (def.useWeaponDmg) {
    const bonus = skillDamage(def, player.level || 1, lvl);
    lines.push({ text: bonus.max > 0 ? `Weapon damage +${bonus.max}` : 'Weapon damage', color: pal.text });
  } else if (def.archetype === 'heal') {
    const h = SKILLS.heal;
    const L = player.level || 1;
    lines.push({ text: `Heals ${h.baseDie[0] + h.perCasterLevelDie[0] * L + h.perSkillLevelDie[0] * lvl}-${h.baseDie[1] + h.perCasterLevelDie[1] * L + h.perSkillLevelDie[1] * lvl}`, color: pal.good });
  } else if (def.buff) {
    lines.push({ text: `+${def.buff.value + (def.buff.perLevel || 0) * (lvl - 1)} ${def.buff.stat}`, color: pal.good });
  } else {
    const dmg = skillDamage(def, player.level || 1, lvl);
    if (dmg.max > 0) lines.push({ text: `Damage: ${dmg.min}-${dmg.max} ${def.element}`, color: pal.text });
  }
  if (def.minMag > 0) {
    const need = tomeMagReq(player, skillId);
    lines.push({ text: `Next level needs ${need} magic`, color: magOf(player) >= need ? pal.textDim : pal.danger });
  }
  return lines;
}

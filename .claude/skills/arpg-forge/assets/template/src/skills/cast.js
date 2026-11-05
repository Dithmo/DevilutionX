/**
 * castSkill: validate, dispatch by archetype, consume mana only after the
 * effect actually went off (reference "fizzle" semantics). Missiles are
 * spawned through entities/missile.js `spawnMissile` (via the deps seam);
 * melee cleave resolves through entities/combat.js.
 */
import { SKILLS } from '../../data/balance/skills.js';
import { DIRS8, dirFromDelta } from '../world/pathfind.js';
import { isWalkable } from '../world/tiles.js';
import { worldPos } from '../render/camera.js';
import { getItemDeps } from '../items/deps.js';
import { recalcPlayer } from '../items/recalc.js';
import { getSkillDef, canCast, skillLevel, skillDamage } from './skills.js';

const HALF = 0.5;
const DIR_COUNT = 8;
const MISSILE_ARCHETYPES = new Set(['bolt', 'pierce', 'homing', 'nova', 'chain', 'wall', 'groundAoe', 'summon']);

const isPlayer = (game, e) => e === game.player || e.kind === 'player';
const dieSum = (rng, n, [lo, hi]) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += rng.range(lo, hi);
  return s;
};

function resolveTarget(game, caster, target, from) {
  if (target && typeof target.tx === 'number') return { x: target.tx + HALF, y: target.ty + HALF, entity: target };
  if (target && typeof target.x === 'number') return { x: target.x + HALF, y: target.y + HALF, entity: null };
  if (typeof target === 'number') {
    const m = (game.level && game.level.monsters || []).find((e) => e.id === target);
    if (m) return { x: m.tx + HALF, y: m.ty + HALF, entity: m };
  }
  const [dx, dy] = DIRS8[caster.dir || 0];
  return { x: from.x + dx, y: from.y + dy, entity: null };
}

function monsterAt(level, x, y) {
  if (!level) return null;
  const list = level.monsters || [];
  if (level.occupant && level.tiles) {
    const id = level.occupant[y * level.tiles.w + x];
    if (id) return list.find((m) => m.id === id && !m.dead) || null;
  }
  return list.find((m) => !m.dead && m.tx === x && m.ty === y) || null;
}

/** spawnMissile spec: fields left undefined fall back to balance/missiles arch defaults. */
function missileSpec(game, caster, def, slvl, from, to, dmg) {
  const m = def.missile || {};
  const speedBonus = Math.min(SKILLS.speedPerLevel * (slvl - 1), SKILLS.speedBonusCap);
  const spec = {
    archetype: def.archetype, owner: caster, ownerKind: isPlayer(game, caster) ? 'player' : 'monster', ownerId: caster.id,
    from: { x: Math.floor(from.x), y: Math.floor(from.y) }, to: { x: Math.floor(to.x), y: Math.floor(to.y) },
    skillId: def.id, level: slvl, dmg, element: def.element, look: def.look,
  };
  if (m.speed) spec.speed = m.speed * (1 + speedBonus);
  for (const k of ['range', 'radius', 'count', 'spread', 'segments', 'lifetime', 'jumps', 'typeId', 'ally']) {
    if (m[k] !== undefined) spec[k] = m[k];
  }
  if (m.pierce || def.archetype === 'pierce') spec.pierce = true;
  return spec;
}

function castMultishot(game, caster, def, slvl, from, to, dmg, deps) {
  const n = def.missile && def.missile.count ? def.missile.count : SKILLS.multishot.count;
  const spread = (def.missile && def.missile.spread ? def.missile.spread : SKILLS.multishot.spreadDeg) * SKILLS.degToRad;
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const dist = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
  let any = false;
  for (let i = 0; i < n; i++) {
    const a = ang + (i - (n - 1) / 2) * spread;
    const spec = missileSpec(game, caster, def, slvl, from, { x: from.x + Math.cos(a) * dist, y: from.y + Math.sin(a) * dist }, dmg);
    spec.archetype = 'arrow';
    delete spec.count;
    delete spec.spread;
    if (deps.spawnMissile(game, spec)) any = true;
  }
  return any;
}

function castCleave(game, caster, def, slvl, dmg, deps) {
  const c = SKILLS.cleave;
  const tx = Math.floor(caster.tx + (caster.ox || 0) + HALF);
  const ty = Math.floor(caster.ty + (caster.oy || 0) + HALF);
  const d = caster.dir || 0;
  const tiles = [d, (d + 1) % DIR_COUNT, (d + DIR_COUNT - 1) % DIR_COUNT].map((k) => ({ x: tx + DIRS8[k][0], y: ty + DIRS8[k][1] }));
  let hitAny = false;
  tiles.forEach((t, i) => {
    const m = monsterAt(game.level, t.x, t.y);
    if (!m) return;
    hitAny = true;
    const side = i > 0;
    const roll = deps.rollPlayerHitsMonster ? deps.rollPlayerHitsMonster(game, caster, m) : { hit: true, dmg: game.rng.range(dmg.min, dmg.max) };
    if (side) {
      const penalty = (caster.level || 1) > c.toHitPenaltyCapLevel ? c.toHitPenaltyCap : (c.toHitPenaltyBase - (caster.level || 1)) * c.toHitPenaltyPerLevel;
      if (roll.hit && game.rng.rand(100) < penalty) roll.hit = false;
    }
    if (!roll.hit) {
      if (game.bus) game.bus.emit('float', { x: m.tx, y: m.ty, text: 'miss', color: 'textDim' });
      return;
    }
    let amount = (roll.dmg || 0) + skillDamage(def, caster.level || 1, slvl).max;
    if (side) amount = Math.max(1, Math.floor(amount / c.sideDamageDivisor));
    if (deps.applyDamageToMonster) deps.applyDamageToMonster(game, m, amount, def.element, { kind: 'skill', skillId: def.id, owner: caster });
    else m.hp -= amount;
  });
  return hitAny;
}

function castHeal(game, caster, def, slvl, targetInfo) {
  const h = SKILLS.heal;
  const who = targetInfo.entity && targetInfo.entity.kind === 'player' ? targetInfo.entity : caster;
  const clvl = caster.level || 1;
  const n = game.rng.range(h.baseDie[0], h.baseDie[1]) + dieSum(game.rng, clvl, h.perCasterLevelDie) + dieSum(game.rng, slvl, h.perSkillLevelDie);
  who.hp = Math.min(who.hpMax, (who.hp || 0) + n);
  if (game.bus) game.bus.emit('float', { x: who.tx, y: who.ty, text: `+${n}`, color: 'hp' });
  return true;
}

function castBuff(game, caster, def, slvl, deps) {
  const b = def.buff || {};
  const value = (b.value || 0) + (b.perLevel || 0) * (slvl - 1);
  const ticks = (b.duration || SKILLS.buff.durationBase) + (b.durationPerLevel || SKILLS.buff.durationPerLevel) * (slvl - 1);
  const buff = { id: def.id, stat: b.stat, value, duration: ticks, ticks };
  if (deps.applyBuff) deps.applyBuff(game, caster, buff);
  else {
    if (!caster.state) caster.state = { buffs: [] };
    if (!caster.state.buffs) caster.state.buffs = [];
    caster.state.buffs = caster.state.buffs.filter((x) => x.id !== def.id);
    caster.state.buffs.push({ id: def.id, ticksLeft: ticks, data: { stat: b.stat, value } });
    if (isPlayer(game, caster)) recalcPlayer(game);
  }
  return true;
}

function castBlink(game, caster, def, to, deps) {
  const level = game.level;
  if (!level) return false;
  const r = (def.missile && def.missile.radius) || SKILLS.blink.radius;
  const cx = Math.floor(to.x);
  const cy = Math.floor(to.y);
  let best = null;
  let bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!isWalkable(level.tiles, x, y)) continue;
      if (level.occupant && level.occupant[y * level.tiles.w + x] && level.occupant[y * level.tiles.w + x] !== caster.id) continue;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = { x, y };
      }
    }
  }
  if (!best || (best.x === caster.tx && best.y === caster.ty)) return false;
  if (deps.teleportPlayer) deps.teleportPlayer(game, best.x, best.y);
  else {
    if (level.occupant) {
      level.occupant[caster.ty * level.tiles.w + caster.tx] = 0;
      level.occupant[best.y * level.tiles.w + best.x] = caster.id;
    }
    caster.tx = best.x;
    caster.ty = best.y;
    caster.ox = 0;
    caster.oy = 0;
    caster.path = null;
  }
  return true;
}

/**
 * Cast a skill. `target` may be a tile `{x,y}`, an entity, or a monster id.
 * Options: `slvl` (override, e.g. scrolls), `free` (no mana), `level`
 * (monster casters). Mana is consumed only when the effect succeeded.
 * @returns {boolean}
 */
export function castSkill(game, caster, skillId, target, opts = {}) {
  const def = getSkillDef(game, skillId);
  if (!def) return false;
  const deps = getItemDeps();
  const player = isPlayer(game, caster);
  let slvl = opts.slvl ?? (player ? skillLevel(caster, skillId) : opts.level || 1);
  let cost = 0;
  if (player && !opts.free) {
    const c = canCast(caster, skillId, { slvl });
    if (!c.ok) {
      if (game.bus) game.bus.emit('message', { text: c.reason === 'mana' ? 'Not enough mana.' : 'You do not know that skill.', color: 'danger' });
      if (game.bus) game.bus.emit('sfx', { name: 'error' });
      return false;
    }
    cost = c.cost;
  }
  slvl = Math.max(1, slvl);
  const clvl = caster.level || 1;
  const from = worldPos(caster);
  const t = resolveTarget(game, caster, target, from);
  let dmg = skillDamage(def, clvl, slvl);
  if (def.useWeaponDmg) {
    const d = caster.derived || {};
    dmg = { min: (d.dmgMin ?? caster.dmgMin ?? 1) + dmg.min, max: (d.dmgMax ?? caster.dmgMax ?? 1) + dmg.max };
  }
  let ok = false;
  if (MISSILE_ARCHETYPES.has(def.archetype)) {
    if (!deps.spawnMissile) return false;
    const spec = missileSpec(game, caster, def, slvl, from, t, dmg);
    if (def.archetype === 'summon') {
      spec.ally = true;
      spec.lifetime = Math.max(spec.lifetime || 0, Math.min(slvl + Math.floor(clvl / SKILLS.summon.casterLevelDivisor), SKILLS.summon.durationCap) * SKILLS.summon.durationPerLevelTicks);
    }
    if (def.archetype === 'chain') spec.radius = Math.min(slvl + SKILLS.chain.radiusBase, SKILLS.chain.radiusCap);
    if (def.archetype === 'wall') spec.lifetime = Math.max(spec.lifetime || 0, SKILLS.wall.ticksPerLevelMult * (slvl + 1) * SKILLS.wallTickScale);
    if (def.archetype === 'nova' && !spec.count) spec.count = SKILLS.nova.count;
    if (def.archetype === 'wall' && !spec.segments) spec.segments = SKILLS.wall.length;
    ok = !!deps.spawnMissile(game, spec);
  } else {
    switch (def.archetype) {
      case 'multishot': ok = deps.spawnMissile ? castMultishot(game, caster, def, slvl, from, t, dmg, deps) : false; break;
      case 'melee': ok = castCleave(game, caster, def, slvl, dmg, deps); break;
      case 'heal': ok = castHeal(game, caster, def, slvl, t); break;
      case 'buff': ok = castBuff(game, caster, def, slvl, deps); break;
      case 'blink': ok = castBlink(game, caster, def, t, deps); break;
      case 'townPortal':
        ok = SKILLS.townPortalAllowedModes.includes(game.mode) && !!(game.hooks && game.hooks.onTownPortal && game.hooks.onTownPortal(game));
        break;
      case 'identify':
        if (game.ui) game.ui.cursorMode = 'identify';
        ok = !!game.ui;
        break;
      default: ok = false;
    }
  }
  if (!ok) return false;
  if (cost) caster.mp -= cost;
  if (game.bus && def.sfx) game.bus.emit('sfx', { name: def.sfx, x: from.x, y: from.y });
  return true;
}

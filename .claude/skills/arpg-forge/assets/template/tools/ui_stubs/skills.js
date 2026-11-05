/** Stub of skills/skills.js for the UI harness. */
export function manaCost(player, skillId) {
  const lvl = (player.skills && player.skills[skillId]) || 1;
  return Math.max(1, 12 - lvl * 2 + skillId.length);
}
export function skillDamage(def, clvl, slvl) {
  const b = def.dmg && def.dmg.base ? def.dmg.base : [1, 2];
  return { min: b[0] + clvl + slvl, max: b[1] + clvl * 2 + slvl * 2 };
}
export function canCast(game, player, skillId) {
  return (player.mp || 0) >= manaCost(player, skillId);
}
export function castSkill() {
  return false;
}

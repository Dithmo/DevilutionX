#!/usr/bin/env node
// Validates the active theme (or one named on the command line) against docs/THEME_SCHEMA.md:
// dangling ids, missing required content, out-of-range numbers, empty tiers, unreachable skills.
// Usage: node tools/validate_theme.mjs [themeId]
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { SKILLS as SKILL_BAL } from '../data/balance/skills.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIN = { tilesets: 4, tiers: 4, classes: 3, skills: 12, bases: 20, prefixes: 20, suffixes: 20,
  uniques: 6, consumables: 8, monsters: 24, uniqueMonsters: 4, objects: 8, altarEffects: 8, npcs: 5, quests: 5,
  deathLines: 5, loadingTips: 6 };
const AI = new Set(['rusher', 'skirmisher', 'ranged', 'caster', 'ambusher', 'charger', 'spawner', 'flier', 'tank', 'boss']);
const ARCH = new Set(['bolt', 'pierce', 'homing', 'nova', 'chain', 'wall', 'groundAoe', 'heal', 'buff', 'blink', 'summon', 'townPortal', 'identify', 'melee', 'multishot']);
const GEN = new Set(['rooms', 'caves', 'halls', 'maze']);
const ROLES = new Set(['healer', 'smith', 'arcanist', 'questgiver', 'gossip', 'wanderer', 'storyteller']);
const QTYPES = new Set(['killBoss', 'fetch', 'clearArea', 'collectN', 'findNpc']);
const OBJ_KINDS = new Set(['chest', 'door', 'breakable', 'altar', 'lever', 'sign', 'trap', 'fountain', 'bookstand', 'stairs', 'portal']);
const SILH = new Set(['bulky', 'lean', 'robed', 'crawler', 'flier', 'blob', 'turret', 'tall']);
const SFX_REQUIRED = ['hit', 'miss', 'swing', 'cast', 'pickup', 'drop', 'levelup', 'open', 'die', 'monsterHit', 'monsterDie', 'potion', 'gold', 'stairs', 'error'];

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const ids = (arr) => new Set((arr || []).map((x) => x.id));
const isRange = (r) => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] <= r[1];

async function loadTheme(themeId) {
  const dir = path.join(ROOT, 'data', 'themes', themeId);
  if (!fs.existsSync(dir)) throw new Error(`theme directory not found: ${dir}`);
  const mod = await import(pathToFileURL(path.join(dir, 'index.js')).href);
  return mod.default || mod.theme || mod;
}

function check(theme) {
  const t = theme;
  for (const key of ['meta', 'palette', 'tilesets', 'tiers', 'town', 'classes', 'monsters', 'uniqueMonsters', 'items', 'skills', 'objects', 'altarEffects', 'npcs', 'quests', 'flavor', 'sfx']) {
    if (t[key] === undefined) err(`theme.${key} missing`);
  }
  if (errors.length) return;
  const tilesetIds = ids(t.tilesets), classIds = ids(t.classes), skillIds = ids(t.skills);
  const monsterIds = ids(t.monsters), uniqueMIds = ids(t.uniqueMonsters), objectIds = ids(t.objects);
  const baseIds = ids(t.items.bases), uniqueIIds = ids(t.items.uniques), consIds = ids(t.items.consumables);
  const npcIds = ids(t.npcs), questIds = ids(t.quests);
  const allItemIds = new Set([...baseIds, ...consIds]);

  const dup = (arr, label) => { const seen = new Set(); for (const x of arr || []) { if (seen.has(x.id)) err(`${label}: duplicate id ${x.id}`); seen.add(x.id); } };
  dup(t.tilesets, 'tilesets'); dup(t.tiers, 'tiers'); dup(t.classes, 'classes'); dup(t.skills, 'skills'); dup(t.monsters, 'monsters');
  dup(t.uniqueMonsters, 'uniqueMonsters'); dup(t.objects, 'objects'); dup(t.items.bases, 'bases'); dup(t.items.consumables, 'consumables');
  dup(t.items.uniques, 'uniques'); dup(t.items.prefixes, 'prefixes'); dup(t.items.suffixes, 'suffixes'); dup(t.npcs, 'npcs'); dup(t.quests, 'quests');

  const count = (arr, key) => { if ((arr || []).length < MIN[key]) err(`${key}: have ${(arr || []).length}, need ≥ ${MIN[key]}`); };
  count(t.tilesets, 'tilesets'); count(t.tiers, 'tiers'); count(t.classes, 'classes'); count(t.skills, 'skills');
  count(t.items.bases, 'bases'); count(t.items.prefixes, 'prefixes'); count(t.items.suffixes, 'suffixes'); count(t.items.uniques, 'uniques');
  count(t.items.consumables, 'consumables'); count(t.monsters, 'monsters'); count(t.uniqueMonsters, 'uniqueMonsters');
  count(t.objects, 'objects'); count(t.altarEffects, 'altarEffects'); count(t.npcs, 'npcs'); count(t.quests, 'quests');
  count(t.flavor.deathLines, 'deathLines'); count(t.flavor.loadingTips, 'loadingTips');

  for (const ts of t.tilesets) {
    if (!GEN.has(ts.generator)) err(`tileset ${ts.id}: unknown generator ${ts.generator}`);
    if (!Array.isArray(ts.floors) || ts.floors.length < 2) err(`tileset ${ts.id}: need ≥2 floor colours`);
    if (!Array.isArray(ts.walls) || ts.walls.length < 2) err(`tileset ${ts.id}: need ≥2 wall colours`);
  }
  let prevHi = 0;
  for (const tier of t.tiers) {
    if (!tilesetIds.has(tier.tilesetId)) err(`tier ${tier.id}: tileset ${tier.tilesetId} not found`);
    if (!isRange(tier.depths)) err(`tier ${tier.id}: depths must be [lo,hi]`);
    else { if (tier.depths[0] !== prevHi + 1) err(`tier ${tier.id}: depths must be contiguous (expected start ${prevHi + 1})`); prevHi = tier.depths[1]; }
    if (!isRange(tier.monsterLevel)) err(`tier ${tier.id}: monsterLevel must be [lo,hi]`);
    if (tier.bossId && !uniqueMIds.has(tier.bossId)) err(`tier ${tier.id}: boss ${tier.bossId} not in uniqueMonsters`);
    const pool = tier.monsterPool || [];
    if (pool.length < 3) err(`tier ${tier.id}: monsterPool needs ≥3 types`);
    for (const m of pool) if (!monsterIds.has(m)) err(`tier ${tier.id}: pool monster ${m} not found`);
    for (const o of tier.objectPool || []) if (!objectIds.has(o)) err(`tier ${tier.id}: pool object ${o} not found`);
  }
  if (t.maxDepth && t.maxDepth !== prevHi) warn(`maxDepth ${t.maxDepth} != last tier depth ${prevHi}`);
  for (const p of t.town.npcPlacements || []) if (!npcIds.has(p.npcId)) err(`town placement: npc ${p.npcId} not found`);
  if ((t.town.npcPlacements || []).length < t.npcs.length) warn('town: not every npc is placed');
  if (!t.town.dungeonEntrance) err('town.dungeonEntrance missing');

  for (const c of t.classes) {
    for (const k of ['str', 'mag', 'dex', 'vit']) { if (!Number.isFinite(c.base?.[k])) err(`class ${c.id}: base.${k}`); if (!Number.isFinite(c.max?.[k])) err(`class ${c.id}: max.${k}`); }
    for (const k of ['startLife', 'startMana', 'lifePerLevel', 'manaPerLevel', 'lifePerVit', 'manaPerMag', 'toHitBase', 'blockBase']) if (!Number.isFinite(c[k])) err(`class ${c.id}: ${k} missing`);
    for (const kit of c.startKit || []) if (!allItemIds.has(kit.baseId)) err(`class ${c.id}: startKit item ${kit.baseId} not found`);
    if (c.startSkill && !skillIds.has(c.startSkill)) err(`class ${c.id}: startSkill ${c.startSkill} not found`);
    for (const s of c.skillPool || []) if (!skillIds.has(s)) err(`class ${c.id}: skillPool ${s} not found`);
    for (const [lvl, s] of Object.entries(c.levelSkills || {})) if (!skillIds.has(s)) err(`class ${c.id}: levelSkills[${lvl}] ${s} not found`);
    const reach = new Set([c.startSkill, ...(c.skillPool || []), ...Object.values(c.levelSkills || {})].filter(Boolean));
    if (reach.size < 4) err(`class ${c.id}: fewer than 4 reachable skills`);
    if (!SILH.has(c.look?.silhouette)) err(`class ${c.id}: look.silhouette invalid`);
    if (!c.epithet) warn(`class ${c.id}: no epithet (subtitle on the class-select card)`);
    // Affordability: a skill the class is handed (startSkill at level 1, levelSkills[L] at
    // level L) must cost no more than the class's mana pool at that level with base stats only
    // (no points spent, no items), else the gift is unusable.
    const mpAt = (L) => Math.floor(c.startMana + c.manaPerLevel * (L - 1) + c.manaPerMag * (c.base?.mag || 0));
    const costAt = (sk, L) => {
      const inClass = !sk.classes || !sk.classes.length || sk.classes.includes(c.id);
      const raw = (sk.manaBase || 0) + (sk.manaPerCasterLevel || 0) * L;
      return Math.max(sk.manaMin || 0, Math.round(raw * (inClass ? SKILL_BAL.inClassManaMult : SKILL_BAL.offClassManaMult)));
    };
    const gifts = [[1, c.startSkill], ...Object.entries(c.levelSkills || {}).map(([L, s]) => [Number(L), s])];
    for (const [L, sid] of gifts) {
      const sk = sid && t.skills.find((x) => x.id === sid);
      if (!sk || sk.archetype === 'melee') continue;
      const cost = costAt(sk, L), mp = mpAt(L);
      if (cost > mp) err(`class ${c.id}: ${L === 1 ? 'startSkill' : `levelSkills[${L}]`} ${sid} costs ${cost} mana but the class has ${mp} at level ${L} with base stats`);
    }
  }
  for (const s of t.skills) {
    if (!ARCH.has(s.archetype)) err(`skill ${s.id}: unknown archetype ${s.archetype}`);
    if (!s.blurb) warn(`skill ${s.id}: no blurb (shown on class cards and skill tooltips)`);
    if (!Number.isFinite(s.manaBase) || !Number.isFinite(s.manaMin)) err(`skill ${s.id}: mana fields`);
    if (s.dmg && (!isRange(s.dmg.base) || !isRange(s.dmg.perCasterLevel) || !isRange(s.dmg.perSkillLevel))) err(`skill ${s.id}: dmg triple malformed`);
    for (const c of s.classes || []) if (!classIds.has(c)) err(`skill ${s.id}: class ${c} not found`);
    if (!['townPortal', 'identify', 'melee', 'multishot'].includes(s.archetype)) {
      if (!consIds.has(`c_tome_${s.id}`)) warn(`skill ${s.id}: no tome consumable c_tome_${s.id} (skill only learnable by level)`);
    }
  }
  for (const b of t.items.bases) {
    if (!b.slot || !b.type || !b.size || !Number.isFinite(b.level) || !Number.isFinite(b.price)) err(`base ${b.id}: slot/type/size/level/price required`);
    if (b.dmg && !isRange(b.dmg)) err(`base ${b.id}: dmg range`);
    if (b.ac && !isRange(b.ac)) err(`base ${b.id}: ac range`);
    if (!(b.dropWeight >= 0)) err(`base ${b.id}: dropWeight`);
  }
  for (const a of [...(t.items.prefixes || []), ...(t.items.suffixes || [])]) {
    if (!['prefix', 'suffix'].includes(a.kind)) err(`affix ${a.id}: kind`);
    if (!a.stat || !isRange(a.range) || !Number.isFinite(a.minLevel)) err(`affix ${a.id}: stat/range/minLevel`);
    if (!Array.isArray(a.slots) || !a.slots.length) err(`affix ${a.id}: slots`);
  }
  for (const u of t.items.uniques) { if (!baseIds.has(u.baseId)) err(`unique item ${u.id}: base ${u.baseId} not found`); if (!u.effects || !Object.keys(u.effects).length) err(`unique item ${u.id}: no effects`); }
  for (const c of t.items.consumables) {
    if (!c.effect?.type) err(`consumable ${c.id}: effect.type`);
    if (c.effect?.skillId && !skillIds.has(c.effect.skillId)) err(`consumable ${c.id}: skill ${c.effect.skillId} not found`);
  }
  const byTier = new Map();
  for (const m of t.monsters) {
    if (!AI.has(m.ai)) err(`monster ${m.id}: unknown ai ${m.ai}`);
    if (!isRange(m.hp) || !isRange(m.dmg)) err(`monster ${m.id}: hp/dmg ranges`);
    if (!Number.isFinite(m.level) || !Number.isFinite(m.ac) || !Number.isFinite(m.toHit) || !Number.isFinite(m.xp)) err(`monster ${m.id}: level/ac/toHit/xp`);
    if (!SILH.has(m.look?.silhouette)) err(`monster ${m.id}: look.silhouette invalid`);
    if ((m.ai === 'ranged' || m.ai === 'caster') && !m.missile) err(`monster ${m.id}: ${m.ai} needs a missile`);
    if (m.ai === 'spawner' && !m.special) err(`monster ${m.id}: spawner needs special (minion type id)`);
    if (m.special && !monsterIds.has(m.special) && m.ai === 'spawner') err(`monster ${m.id}: special ${m.special} not found`);
    byTier.set(m.tier, (byTier.get(m.tier) || 0) + 1);
  }
  for (const tier of t.tiers) { const n = byTier.get(tier.id) ?? byTier.get(t.tiers.indexOf(tier) + 1) ?? 0; if (n < 3) warn(`tier ${tier.id}: only ${n} monster types tagged with this tier`); }
  for (const u of t.uniqueMonsters) {
    if (!monsterIds.has(u.baseTypeId)) err(`unique monster ${u.id}: base ${u.baseTypeId} not found`);
    if (u.dropUniqueId && !uniqueIIds.has(u.dropUniqueId)) err(`unique monster ${u.id}: drop ${u.dropUniqueId} not found`);
    if (u.questId && !questIds.has(u.questId)) err(`unique monster ${u.id}: quest ${u.questId} not found`);
    if (!Number.isFinite(u.depth)) err(`unique monster ${u.id}: depth`);
  }
  for (const o of t.objects) if (!OBJ_KINDS.has(o.kind)) err(`object ${o.id}: kind ${o.kind}`);
  const have = new Set(t.objects.map((o) => o.kind));
  for (const k of ['chest', 'door', 'breakable', 'altar']) if (!have.has(k)) err(`objects: no ${k} type defined`);
  for (const a of t.altarEffects) if (!a.apply || !a.text) err(`altar effect ${a.id}: apply/text`);
  for (const n of t.npcs) {
    if (!ROLES.has(n.role)) err(`npc ${n.id}: role ${n.role}`);
    if (!Array.isArray(n.greeting) || n.greeting.length < 2) err(`npc ${n.id}: need ≥2 greeting lines`);
    for (const q of Object.keys(n.questLines || {})) if (!questIds.has(q)) err(`npc ${n.id}: questLines for unknown quest ${q}`);
  }
  const roles = new Set(t.npcs.map((n) => n.role));
  for (const r of ['healer', 'smith', 'arcanist', 'questgiver']) if (!roles.has(r)) err(`npcs: no ${r}`);
  const qtypes = new Set();
  for (const q of t.quests) {
    if (!QTYPES.has(q.type)) err(`quest ${q.id}: type ${q.type}`); qtypes.add(q.type);
    if (!npcIds.has(q.giverId)) err(`quest ${q.id}: giver ${q.giverId} not found`);
    const giver = t.npcs.find((n) => n.id === q.giverId);
    if (giver && !giver.questLines?.[q.id]) err(`quest ${q.id}: giver ${q.giverId} has no questLines for it`);
    if (!Number.isFinite(q.depth) || q.depth < 1 || q.depth > prevHi) err(`quest ${q.id}: depth out of range`);
    const tg = q.target || {};
    if (tg.uniqueMonsterId && !uniqueMIds.has(tg.uniqueMonsterId)) err(`quest ${q.id}: target unique ${tg.uniqueMonsterId} not found`);
    if (tg.itemBaseId && !allItemIds.has(tg.itemBaseId)) err(`quest ${q.id}: target item ${tg.itemBaseId} not found`);
    if (tg.npcId && !npcIds.has(tg.npcId)) err(`quest ${q.id}: target npc ${tg.npcId} not found`);
    if (q.type === 'killBoss' && !tg.uniqueMonsterId) err(`quest ${q.id}: killBoss needs target.uniqueMonsterId`);
    if ((q.type === 'fetch' || q.type === 'collectN') && !tg.itemBaseId) err(`quest ${q.id}: needs target.itemBaseId`);
    if (q.type === 'collectN' && !(tg.count > 1)) err(`quest ${q.id}: collectN needs count > 1`);
    if (q.reward?.itemBaseId && !allItemIds.has(q.reward.itemBaseId)) err(`quest ${q.id}: reward item not found`);
    if (q.reward?.uniqueItemId && !uniqueIIds.has(q.reward.uniqueItemId)) err(`quest ${q.id}: reward unique not found`);
    if (q.reward?.skillId && !skillIds.has(q.reward.skillId)) err(`quest ${q.id}: reward skill not found`);
    for (const k of ['journal', 'started', 'done']) if (!q.text?.[k]) err(`quest ${q.id}: text.${k}`);
  }
  for (const k of QTYPES) if (!qtypes.has(k)) warn(`quests: no quest of type ${k}`);
  if (!(t.flavor.heroNames || []).length) warn('flavor.heroNames empty: the title screen has no random-name button');
  for (const k of SFX_REQUIRED) if (!t.sfx[k]) err(`sfx: missing ${k}`);
  for (const k of ['bg', 'panel', 'text', 'accent', 'hp', 'mp', 'xp', 'gold']) if (!t.palette[k]) err(`palette: missing ${k}`);
  for (const k of ['normal', 'magic', 'rare', 'unique']) if (!t.palette.rarity?.[k]) err(`palette.rarity: missing ${k}`);
  if (typeof t.flavor.levelName !== 'function') err('flavor.levelName must be a function (depth, tierName) => string');
}

const themeId = process.argv[2] || (await import(pathToFileURL(path.join(ROOT, 'data', 'active_theme.js')).href)).default;
try {
  const theme = await loadTheme(themeId);
  check(theme);
} catch (e) {
  err(`failed to load theme '${themeId}': ${e.stack || e}`);
}
for (const w of warns) console.log(`warn: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
console.log(`${errors.length} error(s), ${warns.length} warning(s) in theme '${themeId}'`);
process.exit(errors.length ? 1 : 0);

/**
 * Data-driven quest state machine.
 *
 * Each theme quest becomes `game.quests[id] = { state, progress, data }` with
 * state hidden → offered → active → done. Transitions are driven by bus events
 * routed through `onEvent` and by talking to the giver (`questDialogueFor`).
 *
 * Other agents' modules are reached through the `deps` seam so this file can
 * load before they exist: call `setMetaDeps({...})` in tests, or
 * `loadMetaDeps()` (dynamic imports) at boot.
 */

const QUEST_COLOR = '#e8d060';

/** @type {{giveXp:Function, generateItem:Function, priceOf:Function, identify:Function, tryPickUp:Function, removeItem:Function, createObject:Function}} */
export const deps = {
  giveXp: null, generateItem: null, priceOf: null, identify: null,
  tryPickUp: null, removeItem: null, createObject: null,
};

/**
 * Inject the cross-module functions (tests) or override a subset.
 * @param {Partial<typeof deps>} obj
 */
export function setMetaDeps(obj) {
  Object.assign(deps, obj || {});
}

/**
 * Fill any missing dep by dynamically importing the owning module. Missing
 * modules are tolerated (the dep stays null and the feature degrades).
 * @returns {Promise<typeof deps>}
 */
export async function loadMetaDeps() {
  const sources = [
    ['../entities/player.js', ['giveXp']],
    ['../items/itemgen.js', ['generateItem', 'priceOf', 'identify']],
    ['../items/inventory.js', ['tryPickUp', 'removeItem']],
    ['../entities/objects.js', ['createObject']],
  ];
  for (const [path, names] of sources) {
    if (names.every((n) => deps[n])) continue;
    try {
      const mod = await import(path);
      for (const n of names) if (!deps[n] && mod[n]) deps[n] = mod[n];
    } catch (err) { /* module not present yet */ }
  }
  return deps;
}

function questDefs(game) { return game.theme.quests || []; }
function questDef(game, id) { return questDefs(game).find((q) => q.id === id) || null; }
function uniqueName(game, id) {
  const u = (game.theme.uniqueMonsters || []).find((x) => x.id === id);
  return u ? u.name : null;
}
function message(game, text, color = QUEST_COLOR) {
  game.bus.emit('message', { text, color });
}
function setState(game, id, state) {
  const q = game.quests[id];
  if (!q || q.state === state) return;
  q.state = state;
  game.bus.emit('questChanged', { questId: id, state });
  game.bus.emit('sfx', { name: 'quest' });
}

/**
 * Create `game.quests` with every theme quest hidden.
 * @param {object} game
 */
export function initQuests(game) {
  game.quests = {};
  for (const def of questDefs(game)) {
    game.quests[def.id] = { state: 'hidden', progress: 0, data: {} };
  }
  game.flags = game.flags || {};
}

function prereqMet(game, def) {
  return !def.prereq || (game.quests[def.prereq] && game.quests[def.prereq].state === 'done');
}

/** Offer hidden quests whose depth gate (or giver talk) is satisfied. */
function offerQuests(game, { depth = -1, giverId = null } = {}) {
  for (const def of questDefs(game)) {
    const q = game.quests[def.id];
    if (!q || q.state !== 'hidden' || !prereqMet(game, def)) continue;
    const byDepth = depth >= def.depth - 1;
    const byTalk = giverId && def.giverId === giverId && (def.main || (game.stats && game.stats.deepest >= def.depth - 1));
    if (byDepth || byTalk) setState(game, def.id, 'offered');
  }
}

function targetCount(def) { return (def.target && def.target.count) || 1; }

/** Count items of a base id in the player's inventory and belt. */
function countOwned(game, baseId) {
  const p = game.player;
  let n = 0;
  const bump = (it) => { if (it && it.baseId === baseId) n += it.count || 1; };
  if (p.inventory && p.inventory.items) for (const id in p.inventory.items) bump(p.inventory.items[id]);
  if (p.belt) for (const it of p.belt) bump(it);
  return n;
}

/** Remove every item of a base id from inventory and belt. */
function removeOwned(game, baseId) {
  const p = game.player;
  if (p.inventory && p.inventory.items) {
    for (const id in p.inventory.items) {
      const it = p.inventory.items[id];
      if (it.baseId !== baseId) continue;
      if (deps.removeItem) deps.removeItem(p.inventory, it.id);
      else delete p.inventory.items[id];
    }
  }
  if (p.belt) for (let i = 0; i < p.belt.length; i++) if (p.belt[i] && p.belt[i].baseId === baseId) p.belt[i] = null;
}

/** Is the quest's objective satisfied (ready to turn in)? */
export function objectiveMet(game, questId) {
  const def = questDef(game, questId);
  const q = game.quests[questId];
  if (!def || !q) return false;
  if (def.type === 'fetch' || def.type === 'collectN') return countOwned(game, def.target.itemBaseId) >= targetCount(def);
  if (def.type === 'findNpc') return !!q.data.killed && (!def.target.npcId || !!q.data.found);
  return q.progress >= targetCount(def);
}

function monsterMatches(m, uniqueId) {
  if (!m || !uniqueId) return false;
  return m.uniqueId === uniqueId || m.typeId === uniqueId || (m.unique && m.unique.id === uniqueId);
}

function roomOf(level, x, y) {
  if (!level || !level.rooms) return null;
  return level.rooms.find((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) || null;
}

/** Make a quest visible and active without the giver (e.g. boss killed early). */
function forceActive(game, id) {
  const q = game.quests[id];
  if (q.state === 'hidden' || q.state === 'offered') setState(game, id, 'active');
}

function onMonsterKilled(game, { m }) {
  const level = game.level;
  for (const def of questDefs(game)) {
    const q = game.quests[def.id];
    if (!q || q.state === 'done') continue;
    const uid = def.target && def.target.uniqueMonsterId;
    const isTarget = monsterMatches(m, uid);
    if ((def.type === 'killBoss' || def.type === 'findNpc') && isTarget) {
      forceActive(game, def.id);
      q.progress = targetCount(def);
      q.data.killed = true;
      message(game, def.text.progress);
    } else if (def.type === 'clearArea' && level && level.depth === def.depth) {
      const room = roomOf(level, m.tx, m.ty);
      const stamped = room && (room.questId === def.id || room.kind === def.mapStamp);
      if (isTarget) q.data.uniqueDead = true;
      if (!stamped && !isTarget) continue;
      forceActive(game, def.id);
      const alive = level.monsters.filter((o) => !o.dead && o !== m && (stamped ? roomOf(level, o.tx, o.ty) === room : false));
      const cleared = uid ? q.data.uniqueDead && alive.length === 0 : alive.length === 0;
      if (cleared && q.progress < targetCount(def)) {
        q.progress = targetCount(def);
        message(game, def.text.progress);
      }
    }
  }
}

function recountItems(game) {
  for (const def of questDefs(game)) {
    const q = game.quests[def.id];
    if (!q || q.state === 'done' || (def.type !== 'fetch' && def.type !== 'collectN')) continue;
    const n = Math.min(countOwned(game, def.target.itemBaseId), targetCount(def));
    if (n > 0) forceActive(game, def.id);
    if (n !== q.progress) {
      q.progress = n;
      if (n >= targetCount(def)) message(game, def.text.progress);
      else if (n > 0) message(game, `${def.name}: ${n} / ${targetCount(def)}`);
    }
  }
}

function onObjectUsed(game, { obj }) {
  for (const def of questDefs(game)) {
    const q = game.quests[def.id];
    if (!q || q.state === 'done' || !def.target || !def.target.objectTypeId) continue;
    if (obj && obj.typeId === def.target.objectTypeId && game.level && game.level.depth === def.depth) {
      forceActive(game, def.id);
      q.progress = Math.min(targetCount(def), q.progress + 1);
      if (q.progress >= targetCount(def)) message(game, def.text.progress);
    }
  }
}

function onLevelEntered(game, { depth }) {
  if (game.stats) game.stats.deepest = Math.max(game.stats.deepest || 0, depth);
  offerQuests(game, { depth });
  for (const def of questDefs(game)) {
    const q = game.quests[def.id];
    if (def.type === 'findNpc' && q && q.state !== 'done' && depth === def.depth && !q.data.found) {
      q.data.found = true;
      if (q.state === 'active') message(game, def.text.started);
    }
  }
}

/**
 * Resolve what the giver says this talk, advancing state exactly once per
 * tick. Returns `{questId, kind:'offer'|'active'|'done'}` or null.
 */
function talkTo(game, npc) {
  const cached = game.ui && game.ui.questTalk;
  if (cached && cached.tick === game.tick && cached.npcId === npc.npcId) return cached.result;
  offerQuests(game, { giverId: npc.npcId });
  let result = null;
  const mine = questDefs(game).filter((d) => d.giverId === npc.npcId);
  const ready = mine.find((d) => game.quests[d.id].state === 'active' && objectiveMet(game, d.id));
  const offered = mine.find((d) => game.quests[d.id].state === 'offered');
  const active = mine.find((d) => game.quests[d.id].state === 'active');
  if (ready) {
    completeQuest(game, ready.id);
    result = { questId: ready.id, kind: 'done' };
  } else if (offered) {
    setState(game, offered.id, 'active');
    message(game, `${game.strings.questAccepted}: ${offered.name}`);
    result = { questId: offered.id, kind: 'offer' };
  } else if (active) {
    result = { questId: active.id, kind: 'active' };
  }
  if (game.ui) game.ui.questTalk = { tick: game.tick, npcId: npc.npcId, result };
  return result;
}

/** Mark done, pay once, remove quest items, handle the final quest. */
function completeQuest(game, id) {
  const def = questDef(game, id);
  const q = game.quests[id];
  setState(game, id, 'done');
  q.progress = targetCount(def);
  if (def.type === 'fetch' || def.type === 'collectN') removeOwned(game, def.target.itemBaseId);
  message(game, `${game.strings.questComplete}: ${def.name}`);
  questReward(game, id);
  if (def.final) {
    game.flags = game.flags || {};
    game.flags.win = true;
    game.mode = 'win';
  }
}

/**
 * Pay a quest's reward exactly once: xp, gold, item/unique, skill.
 * @param {object} game
 * @param {string} questId
 * @returns {boolean} true if paid now
 */
export function questReward(game, questId) {
  const def = questDef(game, questId);
  const q = game.quests[questId];
  if (!def || !q || q.data.rewarded) return false;
  q.data.rewarded = true;
  const r = def.reward || {};
  const p = game.player;
  const eco = (game.balance && game.balance.economy) || {};
  if (r.xp) {
    if (deps.giveXp) deps.giveXp(game, r.xp);
    else p.xp = (p.xp || 0) + r.xp;
    message(game, `${r.xp} ${game.strings.rewardXp}`);
  }
  if (r.gold) {
    p.gold = Math.min((p.gold || 0) + r.gold, eco.maxGold || Infinity);
    if (game.stats) game.stats.gold = (game.stats.gold || 0) + r.gold;
    message(game, `${r.gold} ${game.strings.rewardGold}`, game.theme.palette ? game.theme.palette.gold : QUEST_COLOR);
  }
  if (r.skillId) p.skills[r.skillId] = (p.skills[r.skillId] || 0) + 1;
  if ((r.itemBaseId || r.uniqueItemId) && deps.generateItem) {
    const level = def.depth + (eco.questItemLevelBonus || 0);
    const uniques = (game.theme.items && game.theme.items.uniques) || [];
    const u = r.uniqueItemId ? uniques.find((x) => x.id === r.uniqueItemId) : null;
    const spec = r.uniqueItemId
      ? { level: Math.max(level, u ? u.level || 1 : 1), baseId: u ? u.baseId : undefined, uniqueId: r.uniqueItemId, quality: 'unique', source: 'quest' }
      : { level, baseId: r.itemBaseId, quality: 'good', onlyGood: true, source: 'quest' };
    const item = deps.generateItem(game, spec);
    if (item) {
      item.identified = true;
      const taken = deps.tryPickUp ? deps.tryPickUp(game, item) : false;
      if (!taken && game.level) game.level.items.push(Object.assign(item, { tx: p.tx, ty: p.ty, dropTick: game.tick }));
    }
  }
  return true;
}

/**
 * Route a bus event into the quest machine.
 * @param {object} game
 * @param {'monsterKilled'|'itemPickedUp'|'itemDropped'|'objectUsed'|'levelEntered'|'npcTalked'} name
 * @param {object} payload
 */
export function onEvent(game, name, payload = {}) {
  if (!game.quests) return;
  switch (name) {
    case 'monsterKilled': return onMonsterKilled(game, payload);
    case 'itemPickedUp':
    case 'itemDropped': return recountItems(game);
    case 'objectUsed': return onObjectUsed(game, payload);
    case 'levelEntered': return onLevelEntered(game, payload);
    case 'npcTalked': if (payload.npc) talkTo(game, payload.npc); return undefined;
    default: return undefined;
  }
}

/** Per-tick hook (CONTRACTS step 7). Events are synchronous, so nothing is queued. */
export function updateQuests(game) {
  if (game.flags && game.flags.win && game.mode !== 'win' && game.mode !== 'menu') game.mode = 'win';
}

/**
 * Stamps the level generator should place at `depth` for unfinished quests.
 * @param {object} game
 * @param {number} depth
 * @returns {Array<{questId:string, type:string, stamp:string|null, uniqueMonsterId:string|null, items:string[], npcId:string|null}>}
 */
export function questStampsFor(game, depth) {
  const out = [];
  for (const def of questDefs(game)) {
    const q = game.quests && game.quests[def.id];
    if (!q || q.state === 'done') continue;
    const range = def.depthRange || [def.depth, def.depth];
    if (depth < range[0] || depth > range[1]) continue;
    const t = def.target || {};
    const wantsItem = (def.type === 'fetch' || def.type === 'collectN') && t.itemBaseId;
    const already = wantsItem ? countOwned(game, t.itemBaseId) + (q.data.placed || 0) : 0;
    const items = wantsItem && already < targetCount(def) ? [t.itemBaseId] : [];
    if (items.length) q.data.placed = (q.data.placed || 0) + 1;
    out.push({ questId: def.id, type: def.type, stamp: def.mapStamp || null,
      uniqueMonsterId: t.uniqueMonsterId || null, items, npcId: t.npcId || null });
  }
  return out;
}

/**
 * Journal rows for the UI, in theme order, hidden quests excluded.
 * @returns {Array<{id:string, name:string, text:string, state:string}>}
 */
export function questLogEntries(game) {
  const out = [];
  for (const def of questDefs(game)) {
    const q = game.quests && game.quests[def.id];
    if (!q || q.state === 'hidden') continue;
    let text = def.text.journal;
    if (q.state === 'done') text = def.text.done;
    else if (q.state === 'active') text = objectiveMet(game, def.id) ? def.text.progress : def.text.started;
    out.push({ id: def.id, name: def.name, text, state: q.state, progress: q.progress, count: targetCount(def) });
  }
  return out;
}

/**
 * The quest line an NPC speaks right now (offer/active/done), advancing
 * offered → active and paying turn-ins. Null when nothing applies.
 * @param {object} game
 * @param {object} npc Npc entity
 * @returns {{questId:string, kind:string, text:string}|null}
 */
export function questDialogueFor(game, npc) {
  const r = talkTo(game, npc);
  if (!r) return null;
  const def = questDef(game, r.questId);
  const lines = (npc.questLines && npc.questLines[r.questId]) || {};
  const fallback = { offer: def.text.journal, active: def.text.started, done: def.text.done };
  return { questId: r.questId, kind: r.kind, text: lines[r.kind] || fallback[r.kind] };
}

# Module contracts

Every module codes against these shapes. If you need a field that is not here, add it to this
file in the same change. Plain objects, named exports, no classes.

## Coordinates

- Tile grid: `tiles.w × tiles.h`, integer tile `(tx, ty)`. Isometric view: +x goes down-right on
  screen, +y goes down-left. Screen depth key = `tx + ty`.
- Entities store `tx, ty` (integer tile they *occupy* for collision) plus `ox, oy` (fractional
  offset in [-1, 1] toward the tile they are walking to; 0 when standing). `worldPos(e)` in
  `render/camera.js` returns `{ x: tx + ox + 0.5, y: ty + oy + 0.5 }`.
- Directions: `DIRS8` index 0..7 = S, SW, W, NW, N, NE, E, SE (`world/pathfind.js`).
- Occupancy: `level.occupant` is a `Int32Array(w*h)` of entity ids (0 = free). Player, monsters
  and NPCs occupy exactly one tile at a time. A walking entity occupies its *destination* tile
  from the moment the step starts (reference engine behaviour; prevents two actors stepping onto
  the same tile).

## Time

20 ticks per second. `game.tick` increments once per update. Animation: every entity has
`anim` (name), `frame` (int), `frameTicks` (ticks per frame), `frameAcc`. `advanceAnim(e)` in
`entities/anim.js` steps the frame and returns `true` when the animation wrapped.

## game (single state object)

```js
game = {
  seed: number, tick: number,
  mode: 'menu' | 'town' | 'dungeon' | 'dead' | 'win',
  rng,                      // core/rng createRng — ALL simulation randomness
  theme, balance, strings,  // data
  level: Level | null,
  town: Level | null,       // cached hub so it persists
  player: Player,
  quests: { [questId]: { state: 'hidden'|'offered'|'active'|'done', progress: number, data: {} } },
  ui: { open: null|'inventory'|'character'|'skills'|'quests'|'vendor'|'dialogue'|'automap'|'menu',
        hover: null|{kind, id}, cursorItem: Item|null, vendor: npcId|null, dialogue: {...}|null,
        messages: [{text, color, ttl}], floats: [{x,y,text,color,ttl}], selectedSkill, belt: 8 slots },
  camera, input, audio, bus,          // core services
  nextId: number,                      // entity id counter (ids are never 0)
  stats: { kills, deaths, gold, deepest, playTicks },
  debug: {...}                         // see Debug API
}
```

## Level

```js
Level = {
  depth: 0 (town) | 1..16,  tier: 0..4,  tilesetId,
  tiles,                    // world/tiles createTiles
  light: Uint8Array, explored: Uint8Array,      // world/fov createLightMap
  occupant: Int32Array,
  monsters: Monster[], objects: WorldObject[], items: GroundItem[], missiles: Missile[], npcs: Npc[],
  stairs: { up: {x,y}|null, down: {x,y}|null, town: {x,y}|null },
  entry: {x,y},             // where the player appears when arriving from above
  rooms: [{x,y,w,h,kind}],  // for populate / themes / quest stamps
  seed: number, visited: boolean, cleared: boolean,
  portal: {x,y}|null        // active town portal on this level
}
```

Levels are regenerated from `game.seed ^ hash(depth)` when revisited unless `persistLevels` is on
(default on: we keep generated levels in `game.levels[depth]` so dropped items persist).

## Entity bases

```js
Actor = { id, kind: 'player'|'monster'|'npc', tx, ty, ox, oy, dir: 0..7,
          anim: 'stand'|'walk'|'attack'|'cast'|'hit'|'death'|'special', frame, frameTicks, frameAcc,
          path: [{x,y}] | null, moveSpeed: tiles per tick (e.g. 0.2),
          hp, hpMax, dead: boolean, look: {...}, flash: ticksRemaining }
```

### Player

```js
Player = Actor + {
  classId, name, level, xp, statPoints,
  base: { str, mag, dex, vit }, bonus: { str, mag, dex, vit },   // bonus from items
  mp, mpMax, gold,
  resist: { fire, cold, shock, arcane },                           // 0..75 (%)
  derived: { toHit, ac, dmgMin, dmgMax, blockChance, lifeFromItems, manaFromItems, ... }  // rebuilt by recalcPlayer()
  equipment: { head, body, weapon, offhand, ring1, ring2, amulet },
  inventory: { w: 10, h: 4, cells: Int32Array(40) /* item ids */, items: { [id]: Item } },
  belt: [Item|null × 8],
  skills: { [skillId]: level }, selectedSkill: skillId|null, hotkeys: [skillId × 4],
  state: { hitRecoverTicks, invulnTicks, manaShield: 0|level, buffs: [{id, ticksLeft, data}] },
  intent: null | { type:'move'|'attack'|'cast'|'pickup'|'interact'|'talk', target:{x,y}|id, skillId },
  deathTicks, portalLevel
}
```

### Monster

```js
Monster = Actor + {
  typeId, name, level, ai: archetypeId, aiState: {},       // per-archetype scratch
  dmgMin, dmgMax, ac, toHit, xp, resist: {phys,fire,cold,shock,arcane}, immune: Set,
  flags: Set('undead'|'boss'|'flies'|'ranged'|'unique'|'leader'),
  packId, leaderId, mode: 'idle'|'wake'|'chase'|'attack'|'flee'|'special'|'dead',
  awake: boolean, target: {x,y}|null, lastSeenTick, goal, goalTicks,
  hitRecoverTicks, size: 1|1.5|2, lootSeed, dropOverride
}
```

### Item (the same object on ground, in inventory, equipped, in vendor stock)

```js
Item = { id, baseId, name, slot: 'weapon'|'offhand'|'head'|'body'|'ring'|'amulet'|'consumable'|'tome'|'scroll'|'gold'|'quest',
         type: 'sword'|'axe'|'mace'|'bow'|'staff'|'shield'|'armor'|'helm'|'ring'|'amulet'|'potion'|...,
         size: {w,h}, quality: 'normal'|'magic'|'rare'|'unique', identified: boolean,
         level (item level), req: {str,dex,mag}, dmg:{min,max}|null, ac|null, dur:{cur,max}|null,
         affixes: [{id, name, kind, stat, value}], unique: uniqueId|null,
         effects: { [stat]: value },        // flattened sum of affix/unique effects
         charges: {cur,max}|null, count (stacks/gold), price: {buy, sell}, look, seed }
GroundItem = Item + { tx, ty, dropTick }
```

Stat keys used by `effects`: `toHit, dmgPct, dmgFlat, ac, acPct, str, mag, dex, vit, allStats,
life, mana, resFire, resCold, resShock, resArcane, resAll, lightRadius, attackSpeed, hitRecover,
lifeSteal, manaSteal, durability, indestructible, thorns, knockback, elemDmgFire..., spellLevels,
manaCostPct, blockPct, walkSpeed`.

### Missile

```js
Missile = { id, archetype, ownerKind: 'player'|'monster'|'trap', ownerId, skillId|null,
            x, y (fractional world), vx, vy (tiles per tick), dir, range (ticks left), dist,
            dmgMin, dmgMax, element: 'phys'|'fire'|'cold'|'shock'|'arcane', level,
            hitSet: Set(entityId), pierce: boolean, radius, state: {}, look, dead }
```

### WorldObject

```js
WorldObject = { id, kind: 'chest'|'door'|'breakable'|'altar'|'lever'|'stairs'|'portal'|'sign'|'trap'|'fountain',
                typeId, tx, ty, solid: boolean, blocksLight: boolean, state: 'closed'|'open'|'broken'|'used'|'armed',
                look, loot: {count, quality}|null, trap: {missile}|null, linkId, text, light: r|0 }
```

### Npc

```js
Npc = Actor + { npcId, role, vendorType|null, stock: Item[], stockDepth, greeting: [], lines: [] }
```

## Per-tick order (main.js owns this)

1. `input.collect()` → player intent (click to move/attack/pickup/interact/talk, hotkeys)
2. `updatePlayer(game)` — state machine, walking, attacks resolve on action frame, casting spawns missiles
3. `updateMonsters(game)` — each: hit-recover → AI archetype decides → movement/attack/missile
4. `updateObjects(game)` — doors closing, traps, lights
5. `updateMissiles(game)` — move, collide, impact, expire
6. `updateItems(game)` — drop animations, auto-pickup gold
7. `updateQuests(game)` — evaluate triggers
8. `updateFov(game)`, `updateUi(game)` (floats ttl, messages)
9. render: `renderWorld` → `renderUi`

## Shared helper signatures other modules may call

- `entities/combat.js`: `rollPlayerHitsMonster(game, p, m) -> {hit, dmg, crit}`,
  `rollMonsterHitsPlayer(game, m, p) -> {hit, blocked, dmg}`, `applyDamageToMonster(game, m, dmg, element, source)`,
  `applyDamageToPlayer(game, p, dmg, element, source)`, `resistMultiplier(target, element)`.
- `entities/monster.js`: `spawnMonster(game, typeId, tx, ty, opts) -> Monster`, `killMonster(game, m, killer)`,
  `monstersInRadius(level, x, y, r)`.
- `entities/missile.js`: `spawnMissile(game, spec) -> Missile` with spec `{archetype, owner, from:{x,y}, to:{x,y}|dir, skillId, level, dmg:{min,max}, element, look}`.
- `items/itemgen.js`: `generateItem(game, {level, quality?:'any'|'magic'|'good', baseId?, onlyGood?, source}) -> Item`,
  `generateGold(game, level) -> Item`, `priceOf(item)`, `identify(item)`.
- `items/inventory.js`: `tryPickUp(game, item) -> boolean`, `placeAt(inv, item, cx, cy)`, `removeItem(inv, id)`,
  `equip(game, item, slot) -> {ok, swapped}`, `canEquip(player, item)`, `recalcPlayer(game)`.
- `skills/skills.js`: `castSkill(game, caster, skillId, target) -> boolean`, `manaCost(player, skillId)`, `skillDamage(skillDef, casterLevel, skillLevel) -> {min,max}`.
- `entities/player.js`: `createPlayer(game, classId, name)`, `giveXp(game, amount)`, `playerDie(game)`, `teleportPlayer(game, tx, ty)`.
- `world/levelgen/index.js`: `generateLevel(game, depth) -> Level` (town when depth 0), always returns a validated level (retry loop internal).
- `quests/quests.js`: `initQuests(game)`, `onEvent(game, name, payload)` (events: `monsterKilled`, `itemPickedUp`, `objectUsed`, `levelEntered`, `npcTalked`), `questReward(game, questId)`.
- `npc/npcs.js`: `restockVendors(game)`, `vendorBuy(game, npc, item)`, `vendorSell(game, item)`, `serviceHeal/Identify/Repair(game, npc, ...)`, `getDialogue(game, npc) -> {lines, options}`.
- `save/save.js`: `saveGame(game, slot)`, `loadGame(slot) -> game|null`, `hasSave(slot)`.
- `render/ui.js`: `renderUi(ctx, game)`, `uiHandleClick(game, x, y, button) -> consumed:boolean`, `uiHandleKey(game, key) -> consumed`, `uiHitTest(game, x, y)`.

## Debug API (`window.__game`)

```js
{ game, step(n), state() -> { mode, depth, tick, player:{level,hp,hpMax,mp,xp,gold,x,y,class}, counts:{monsters,alive,items,objects,missiles} },
  newGame(classId, seed?), teleport(depth), give(baseId|'gold', amountOrQuality), spawn(typeId, dx, dy),
  killAll(), setGodMode(bool), clickTile(tx, ty), castAt(skillId, tx, ty), openPanel(name), save(), load(), screenshotHints: [] }
```

## Events on `game.bus`

`sfx` {name, x?, y?} · `float` {x,y,text,color} · `message` {text,color} · `monsterKilled` {m, killer} ·
`playerHit` {dmg} · `itemPickedUp` {item} · `itemDropped` {item} · `objectUsed` {obj} · `levelEntered` {depth} ·
`npcTalked` {npc} · `levelUp` {level} · `questChanged` {questId, state}.

# Isometric ARPG engine — systems overview and work breakdown

This is the map of a complete 1990s-style isometric hack-and-slash engine (~150k lines of C++
in the reference reimplementation), decomposed into **70 systems** and **~1,150 buildable
chunks** of 1–4 hours each. Everything here is genre mechanics, not anyone's IP: no titles,
characters, places, item or quest names from the reference game appear anywhere in this skill.

Read this file first. Dive into the numbered cluster files only for the system you are building.

| Cluster file | Systems | Chunks | What it covers |
|---|---|---|---|
| `01-core-engine-rendering.md` | 24 | ~290 | bootstrap, fixed-step loop, input, controllers, math, RNG, pathfinding, animation, assets, back buffer, palette, tile primitives, iso renderer, lighting, vision, lightmap, picking, automap, audio, options, menus, loading, demo/headless |
| `02-levels-objects-quests.md` | 17 | ~290 | dungeon grid, minisets, transparency, 4 procedural generators, themed rooms, stairs/triggers, set-piece maps, hub town, interactive objects, quests, NPCs & dialogue, vendors, portals, automap reveal/corpses |
| `03-player-items-ui.md` | 7 | ~175 | classes & progression, player state machine, item model & loot generation, equipment aggregation & pricing, grid inventory/belt/stash, spells, HUD & panels |
| `04-monsters-ai-combat.md` | 14 | ~175 | monster tables & roster, spawning, state machine, perception, movement, packs, 25 AI routines, combat resolution (4 directions), death/XP/loot, missile core, 21 missile archetypes, status effects, sound triggers, target tracking |
| `05-data-save-net-modding.md` | 9 | ~225 | TSV data core, every content table schema, save/load, deterministic lockstep multiplayer, scripting/mod layer, asset pipeline, build structure, test strategy, settings/localisation |

## The dependency spine (build in this order)

```
L0  math/points/directions ─ RNG ─ tile grid ─ events bus ─ fixed-step loop
L1  pathfinding (A*) ─ FOV/lighting ─ camera & iso transform ─ procedural sprites ─ input
L2  level generators (rooms / halls / caves / mirrored) ─ town ─ stairs & validation
L3  player (stats, state machine, movement) ─ combat formulas ─ animation timing
L4  items (bases → quality → affixes → price) ─ inventory grid ─ equipment aggregation
L5  monsters (tables, spawn, packs) ─ AI archetypes ─ missiles ─ death/XP/loot
L6  objects (chests, doors, breakables, altars, levers, traps) ─ themed rooms ─ quest stamps
L7  skills/spells ─ consumables ─ buffs/status effects
L8  NPCs ─ dialogue ─ vendors & services ─ quests state machine ─ town portal
L9  HUD ─ panels ─ tooltips ─ automap ─ menus ─ death/win screens
L10 save/load ─ settings ─ audio synth ─ polish (floating numbers, labels, screen shake)
L11 (optional) deterministic multiplayer ─ mod/scripting layer ─ localisation
```

Each layer only imports from layers above it. The reference engine broke this rule everywhere
(input calling gameplay directly, a single global RNG shared by UI and simulation, render code
reaching into monster state) and paid for it with desync bugs and untestable code. Our template
enforces the spine with `docs/CONTRACTS.md`.

## The 12 ideas that make the genre feel right

1. **20 ticks per second, everything quantised to ticks.** Attack speed, walk speed, hit recovery
   and spell cooldowns are frame counts. Interpolate only for rendering.
2. **Click-to-act with path following.** Left click = walk / attack / pick up / talk; right click
   = cast selected skill. Click-and-hold repeats. Pathfinding is 8-way A* with no corner cutting.
3. **Occupancy grid.** One actor per tile; a walking actor claims its destination tile at step
   start. This single rule prevents every "two monsters in one tile" bug.
4. **Four stats, two globes.** Strength / Magic / Dexterity / Vitality feed to-hit, damage, armour,
   life and mana through per-class coefficients. Life and mana are globes that drain visibly.
5. **To-hit is a d100 against a sum.** `hit if rand(100) < clamp(base + level + dex/2 + items − targetAC, 5, 95)`.
   Monsters get `+2×(monsterLevel − playerLevel) + 30` with a per-depth floor so late game stays dangerous.
6. **Stagger thresholds.** A single hit ≥ target level (player) or ≥ level+3 (monster) interrupts.
   This is what makes big hits *feel* big and makes packs dangerous.
7. **Loot is a pipeline**: drop roll (59% nothing / 31% gold / 10% item) → item level from the
   source → base type by level & weight → quality roll (magic if `rand≤10 || rand≤ilvl`, unique ≈2%,
   16% from bosses) → affix roll (prefix 25%, suffix 66%, at least one) → value within range →
   price. Everything derives from one seed so items are reproducible and cheap to save.
8. **Affixes are families with level windows.** The same "+to-hit" family exists at 5 power tiers
   gated by item level; the roll window is `[ilvl/2, ilvl]`. ~80 families cover the whole game.
9. **Monsters are archetypes × palettes.** ~25 AI routines, each a tiny probabilistic state
   machine (`if standing >20 ticks and rand(100) < a·INT+b then step toward target`). Three colour
   variants per silhouette with +level/+hp turn 35 sprites into 110 monsters.
10. **Missiles are data.** Speed, range, collision mode, element and an archetype id (bolt,
    pierce, homing, nova, chain, wall, ground-AoE, blink, charge, summon). Spells and arrows and
    traps all spawn the same missile objects.
11. **Four tileset generators with a shared validation loop.** Rooms-and-corridors, symmetric
    halls, blob caves, mirrored quadrants. Generate → validate (floor count, stairs distance,
    connectivity) → retry with the next seed. Themed rooms and quest areas are stamped afterwards.
12. **The hub town is a level too.** Same renderer, same pathfinding, no monsters, NPCs as actors.
    Vendors restock on every town entry at `clamp(deepestDepth + 2, 6, 16)` item level.

## Content budget of a complete game (reference ship quantities)

| Content | Reference count | Minimum for a "complete" small game |
|---|---|---|
| Base item types | 168 | 28 (15 weapons, 11 armour, ring, amulet) |
| Affix families (prefix + suffix) | 83 + 95 | 25 + 25 |
| Unique items | 90 | 8 |
| Consumables | ~30 | 14 + one scroll & tome per skill |
| Monster types (silhouettes × variants) | 112 (34 silhouettes) | 16 silhouettes × 2–3 variants ≈ 40 |
| Unique / boss monsters | 100 | 6 |
| Skills / spells | 36 | 16 |
| Missile archetypes | 21 | 12 |
| Interactive object types | 109 | 12 |
| Random-effect altar outcomes | 34 | 12 |
| Quests | 24 | 6 (one per pattern + a main line) |
| Hub NPCs | 13 | 6 |
| Dungeon depths / tilesets | 25 / 7 | 16 / 4 |
| Dialogue lines | 338 | ~80 |
| Sound effects | 813 | ~22 synthesised |

## How to use the cluster files

Each system section has the same shape: *Purpose → Key data structures → Algorithms & rules
(with exact formulas) → Reference tuning values (tables) → Smallest buildable chunks (numbered,
dependency ordered, each with inputs / outputs / done-when) → Pitfalls*. When building or
extending a system, open its section, copy the chunk list into your task tracker, and implement
in order. The "Pitfalls" lists are the expensive lessons; read them before designing anything.

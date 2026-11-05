# Cluster 02 — Procedural Levels, World Structure, Interactive Objects, Quests, Hub Town & NPCs, Vendors, Portals & Level Transitions

This document is a genre-generic, IP-free systems breakdown derived from a reference implementation of a 1990s isometric hack-and-slash ARPG (~150k LOC C++). Everything below is described in neutral terms. Proper names of the original product, its characters, town, monsters, items and lore are deliberately omitted; tilesets are referred to as "tileset 1..6" with a style descriptor, NPCs by role, quests by structural pattern. All numeric constants are **reference tuning values** taken from the code: they are the mechanics as shipped, not design recommendations.

Coordinate conventions used throughout:

* **Mega-tile grid ("logical grid")**: `40 x 40` cells, type `uint8_t dungeon[40][40]`. Each cell is a mega-tile ID (an index into the tileset's `.TIL`-style table of 2x2 micro-tiles). This is what the generators manipulate.
* **World / render grid**: `112 x 112` cells (`16 + 40*2 + 16` per axis). Every mega-tile expands into a 2x2 block of micro-tile "pieces"; a 16-cell dead border surrounds the playable 80x80 area. Conversion: `world = 16 + 2*mega`; inverse `mega = (world - 16) / 2`.
* Isometric facing: "South" means `(+1,+1)` in tile space (towards the camera), "North" is `(-1,-1)`; "SouthWest" = `(0,+1)`, "SouthEast" = `(+1,0)`, etc.

---

## System map

| System | Source files (reference impl.) | Lines | Depends on | Depended on by |
|---|---|---|---|---|
| Shared dungeon grid & level state | `Source/levels/gendung.{h,cpp}`, `gendung_defs.hpp`, `dun_tile_data.{hpp,cpp}`, `dun_tile.hpp`, `tile_properties.{hpp,cpp}` | ~1,100 | RNG, tile asset loader | every generator, objects, monsters, items, lighting, automap, pathing |
| Miniset stamping & fixed-map (.dun) loading | `gendung.cpp` (`Miniset`, `PlaceMiniSet`, `PlaceDunTiles`, `LoadDungeonBase`), `drlg_quests.cpp` | ~300 | shared grid | generators, quest stamping, set maps, town |
| Transparency regions & static lighting | `gendung.cpp` (`FloodTransparencyValues`, `DRLG_*Trans`), `lighting.{h,cpp}` | ~700 | shared grid | renderer, themes, vision/automap |
| Generator A: tileset 1 (cathedral-style halls) + tileset 6 variant (crypt-style) | `drlg_l1.{h,cpp}`, `crypt.{h,cpp}` | 2,200 | shared grid, minisets, quests (availability) | level load pipeline |
| Generator B: tileset 2 (catacomb-style rooms & corridors) | `drlg_l2.{h,cpp}` | 2,860 | same | same |
| Generator C: tileset 3 (cave-style) + tileset 5 variant (hive-style) | `drlg_l3.{h,cpp}` | 2,220 | same | same |
| Generator D: tileset 4 (hell-style mirrored quadrants) | `drlg_l4.{h,cpp}` | 1,260 | same | same |
| Themed rooms | `themes.{h,cpp}`, `gendung.cpp` (`DRLG_PlaceThemeRooms`) | 1,000 | transparency regions, objects, monsters, items | level load pipeline |
| Stairs, triggers & level transitions | `trigs.{h,cpp}`, `player.cpp` (`StartNewLvl`), `<main game>.cpp` (load pipeline) | 1,000 | shared grid, town config, quests | game loop, UI cursor |
| Fixed set-piece maps (sub-levels / arenas) | `setmaps.{h,cpp}`, `LoadL1..L4Dungeon` | 180 (+ loaders) | .dun loader, objects, triggers | quests |
| Hub town | `town.{h,cpp}`, `town_data.{h,cpp}` | 760 | .dun loader, triggers, quests | NPCs, vendors, portals |
| Interactive objects | `objects.{h,cpp}`, `tables/objdat.*`, `assets/txtdata/objects/objdat.tsv` | 5,500 | shared grid, items, monsters, missiles, lighting, quests | themes, quests, set maps, multiplayer sync |
| Quests | `quests.{h,cpp}`, `tables/questdat.*`, `quests/validation.cpp`, `assets/txtdata/quests/questdat.tsv` | 900 | generators (set pieces), objects, monsters, NPCs, triggers | nearly everything |
| NPCs ("towners") & dialogue table | `towners.{h,cpp}`, `tables/townerdat.*`, `tables/textdat.*`, `assets/txtdata/towners/*.tsv` | 1,500 | town, quests, stores, text table | town level load |
| Vendors / stores | `stores.{h,cpp}`, `items.cpp` (`Spawn*` vendor functions) | 3,300 | items, player, NPCs | NPC talk hooks |
| Town portals | `portal.{h,cpp}`, `portals/validation.cpp`, `town_data` (anchor slots) | 300 | missiles, lighting, town config | player spells, level transitions |
| Automap reveal & corpses | `automap.cpp` (reveal rules only), `dead.{h,cpp}`, `crawl.{hpp,cpp}` | ~300 (relevant part) | shared grid, vision | renderer |

---

## World structure template

A compact description of the campaign shape so a new game can copy the skeleton before filling in content.

### Layout

* **Level 0 = hub town.** Hand-built (4 fixed map sectors), always fully lit and fully revealed on the automap. Contains all NPCs/vendors, a healing-on-talk NPC, a stash, and one staircase per dungeon tier (the extra entrances are gated; see below).
* **Levels 1–16 = main campaign: 4 tiers x 4 levels.** `GetLevelType(level)`:

| Level range | Tileset | Style descriptor | Generator |
|---|---|---|---|
| 1–4 | 1 | cathedral-style stone halls, pillars, arches | A |
| 5–8 | 2 | catacomb-style rooms + corridors + doors | B |
| 9–12 | 3 | cave-style organic blobs, lava rivers, fences | C |
| 13–16 | 4 | hell-style, 4-way mirrored, big symmetric rooms | D |
| 17–20 | 5 (expansion) | hive/organic variant of C | C |
| 21–24 | 6 (expansion) | crypt-style variant of A | A |

* **Last level of the main campaign (16)** is not a free-form level: Generator D forces a 14x14 seed room, protects four 14x14 corner blocks, and stamps four hand-authored quadrant maps (the final boss arena) into them. Levers in the arena open successive walls. Likewise the last expansion level (24) stamps a fixed "sealed vault" room in one chamber.
* **Fixed set-piece sub-levels** hang off specific main levels and are reached via a portal tile placed by the generator: tier-1 boss lair (off level 3, tileset 1), a tier-2 spell-reward vault (off level 6, tileset 2), a poisoned-water cave (off level 2, rendered with tileset 3), and a betrayer's lair (off level 15, tileset 1). Plus 3 PvP arena maps (tileset 1 and tileset 4).
* **Shortcut staircases in town** lead directly to the first level of tiers 2, 3, 4 (levels 5, 9, 13) and of expansion tiers 5, 6 (17, 21). They unlock when the player has walked UP the matching return staircase from the dungeon side (single player: a per-player bitmask `pTownWarps |= 1 << (tier-2)`), or automatically in multiplayer, or (expansion rules) by character level 10/15/20 for tiers 2/3/4 and by quest completion for tiers 5/6. Multiplayer additionally requires character level 8 / 13 / 17 to *use* the shortcuts to tiers 2 / 3&5 / 4&6.

### Difficulty scaling

Difficulty is a function of the dungeon level number (1–24), not of the tier: monster type pools are filtered by `minDunLvl..maxDunLvl` per type, item drop levels, trap missile types (`rnd(level/3+1)`), trap chances (10/15/20/25% at levels 1/2+/5+/7+), chest-trap types, shrine payouts (`1000*level` XP, `2*level+2` firewall strength), vendor stock level, etc. Expansion tiers compute an "effective level" of `level-4` (tier 5) or `level-8` (tier 6) for a few formulas so they scale like tiers 2–4. Three global difficulty modes (normal / nightmare / hell) multiply monster stats on top (outside this cluster).

### Seeds

* One **game seed** (32-bit). A `xoshiro128++` generator seeded with it produces `DungeonSeeds[0..24]` once at game start; `DungeonSeeds[0]` (town) is then overwritten with a fresh random seed so vendor stock does not derive from the game seed.
* Level creation: `SetRndSeed(DungeonSeeds[level])` → generator loop. Each attempt records `LevelSeeds[level] = <LCG state at attempt start>` so a successful layout can be regenerated directly from `LevelSeeds` later (saves store it).
* After the layout is accepted the RNG is **re-seeded with `DungeonSeeds[level]` again** before object/monster/item population so population is reproducible independent of how many layout retries happened.
* `DungeonSeeds[15]` additionally seeds the single-player quest-pool lottery; `DungeonSeeds[16] >> 16 % 3` selects which of three lore-book variants spawns on levels 4/8/12.
* Fixed sub-levels are not random but reuse `DungeonSeeds[setLevelId]` so monster HP rolls are stable.

### Boss gating

* Tier-1 boss: optional, in a sub-level (portal appears on level 3).
* Level 15 holds a sealed 5x5 gate miniset. It becomes a working staircase to level 16 only after the "betrayer" sub-level quest is completed (single-player) — in multiplayer the gate is open from the start and a different set piece is used.
* Level 16 = final arena; four levers (one per quadrant map) must all be pulled to open the inner sanctum (`AreAllLeversActivated`).
* Expansion: level 24 vault opens when three lore books are read in the correct order *or* a lever is pulled (the lever route is flagged as the "crippling"/cheat route and can be disabled).

### Quest pattern archetypes

All 24 quests in the data table reduce to five structural patterns:

1. **Fetch-and-return**: a quest item is spawned on level N (loose on the floor, in a special container object, or from a unique monster). Deliver it to an NPC → unique reward item spawns at the NPC's feet. (Examples: item on a stand object on level 5 → smith; anvil-island set piece on level 10 → smith; sign in a container on level 4 → innkeeper; keepsake → girl NPC; map item → barmaid unlocks a tier.)
2. **Set-piece room with a lever/book puzzle**: a hand-authored room is stamped into the random level; interacting with a book/pedestal copies a different "opened" version of the room over the map (`ObjChangeMap`) revealing monsters and a unique item. (Examples: level 7 hidden-hall room; level 5 three-stone pedestal room; level 13 champion room; level 16 final arena quadrants; level 24 vault.)
3. **Portal to a fixed sub-level**: generator places a portal miniset; stepping on it loads a hand-built map; a trigger inside returns the player. Objective is kill-boss (tier-1 lair), read-book-for-spell-level (vault), kill-all-monsters (poisoned cave: palette shifts from foul to clean when `ActiveMonsterCount` hits the baseline), or a multi-stage circle/book puzzle (betrayer lair).
4. **Talking unique monster**: a named monster spawns in dialogue mode; successive interactions advance `_qvar1`; it hands over an item or turns hostile after a threshold (variants: becomes hostile when you take a book from its library; asks you to fetch an item from the next level and rewards you).
5. **Town-side chain**: an NPC hands you a tool (a bomb); using it on a marked map region in town opens a new tier entrance; returning to the NPC afterwards yields a reward (expansion tiers 5 and 6; the multi-stage mushroom/brain/elixir chain between witch and healer is the same pattern with three hops).

Single-player games run a **quest lottery**: one quest from each of five pools is disabled per game (`InitialiseQuestPools`): {tier-1 boss lair, poisoned cave}, {level-2 slaughter room, inn sign, talking-goat unique}, {hidden halls, rock-on-stand, pedestal room}, {mushroom chain, mad-mage library, anvil island}, {ghost-knight fetch, champion room}. Multiplayer disables every `isSinglePlayerOnly` quest and uses `_qdmultlvl` for level assignment.

---

## Shared dungeon grid & level state

### Purpose
Owns all per-level grids: the 40x40 logical tile map the generators write, the 112x112 render/collision grids derived from it, and the per-cell occupancy maps for players, monsters, objects, items, corpses, lights and flags. Also owns the protected-tile mask, set-piece rectangles and the per-level seed arrays.

### Key data structures

| Name | Type | Meaning |
|---|---|---|
| `dungeon[40][40]` | `uint8_t` | logical mega-tile IDs (1-based into the tileset table; 0 = "unchanged" in minisets) |
| `pdungeon[40][40]` | `uint8_t` | **pristine/alternate copy** of `dungeon` taken after layout; lever/book puzzles restore rectangles from it (`ObjChangeMap`) |
| `Protected` | `Bitset2d<40,40>` | tiles generators must not overwrite (doors, set pieces, quest rooms) |
| `DungeonMask` | `Bitset2d<40,40>` | boolean room/floor mask used by generators A, C(connectivity), D |
| `SetPieceRoom` | `Rectangle` (mega) | reserved room for a quest set piece chosen *before* layout (B, D) |
| `SetPiece` | `Rectangle` (mega) | final placed set piece (all generators); `Make_SetPC` marks it `Populated` in world coords |
| `dPiece[112][112]` | `uint16_t` | micro-tile piece ID per world cell (what is rendered & what `SOLData` indexes) |
| `SOLData[1379]` | `TileProperties` | per piece flags: `Solid`, `BlockLight`, `BlockMissile`, `Transparent`, `TransparentLeft`, `TransparentRight`, `Trap` (bit 7) |
| `dTransVal[112][112]` | `int8_t` | transparency region ID (0 = none); used for roof/wall fade and as the "room id" for themes |
| `dLight`, `dPreLight` `[112][112]` | `uint8_t` | light level 0 (bright) .. 15 (dark); `dPreLight` = static baked lights |
| `dFlags[112][112]` | bitflags | `Missile`, `Visible`, `DeadPlayer`, `Populated`, `MissileFireWall`, `MissileLightningWall`, `Lit`, `Explored` (saved: Populated/Lit/Explored) |
| `dPlayer` `int8_t`, `dMonster` `int16_t`, `dObject` `int8_t`, `dItem` | per-cell | 1-based indices; **negative** = secondary cell of a moving entity or of a large object |
| `dCorpse[112][112]` | `int8_t` | `(id & 0x1F) | (direction << 5)` |
| `dSpecial[112][112]` | `int8_t` | overlay sprite index (arches drawn in front of the player; trees in town) |
| `MegaTile` | 4x `uint16_t` | the 2x2 micro pieces of one mega tile (`pMegaTiles[id-1]`) |
| `dminPosition/dmaxPosition` | world points | playable bounds (`(0,0)->(40,40)` mega converted; town uses `(10,10)-(84,84)`) |
| `ViewPosition` | world point | where the camera/player spawns on entry |
| `DungeonSeeds[25]`, `LevelSeeds[25]` | `uint32_t`, `optional<uint32_t>` | per-level seeds (see template) |
| `leveltype`, `currlevel`, `setlevel`, `setlvlnum`, `setlvltype` | enums | current tileset, level number, whether on a fixed sub-level and which |
| `WalkabilityGeneration` | counter | bumped whenever solidity/object/occupancy changes so path caches invalidate |

Tile-walkability helpers (`tile_properties.cpp`): `IsTileSolid(p)` = `SOLData[dPiece[p]] & Solid`; `IsTileWalkable(p, ignoreDoors)` additionally rejects solid objects (doors optional); `IsTileOccupied` adds monsters/players/objects, treats OOB as occupied; `CanStep(a,b)` forbids diagonal corner cutting when either orthogonal neighbour is solid.

### Algorithms & rules

1. **`InitGlobals()` per level**: zero all occupancy grids; `dLight = 15` (dark) everywhere except town (0); reset transparency (`dTransVal=0`, `TransVal=1`); reset bounds and set-piece rects.
2. **`CreateDungeon(seed, entry)`** dispatches to generator by `leveltype`, then `Make_SetPC(SetPiece)` flags the set piece as `Populated` (no random spawns there).
3. **`DRLG_LPass3(baseTile)`** ("pass 3"): fill the entire 112x112 `dPiece` with the 2x2 pieces of `baseTile` (the tileset's solid/dirt filler), then for each logical cell write its mega tile's 4 pieces at `(16+2i, 16+2j)`. Base tiles: T1/T6 = 22 (dirt), T2 = 12, T3/T5 = 8, T4 = 30.
4. **Protected tiles**: anything stamped from a `.dun` is protected; doors placed by wall carving are protected; theme rooms are *not* protected but are avoided via `IsNearThemeRoom` (rect grown by 2 each side).
5. **Populated flag** (`dFlags & Populated`) marks tiles where random objects/monsters/items must not spawn: set pieces, 5x5 around every trigger (`Freeupstairs`), theme rooms (`HoldThemeRooms`).

### Reference tuning values

| Constant | Value |
|---|---|
| Logical grid | 40 x 40 |
| World grid | 112 x 112 (16 border) |
| Max tiles in a tileset piece table | 1379 |
| Max themes | 50 |
| Levels | 25 (0 town + 24) |
| Default dark light level | 15; bright = 0 |
| Micro-tiles per mega tile | 2x2 pieces; piece height stacks: 10 micro-tiles (T1/T2/T3/T6), 12 (T4), 16 (town) |

### Smallest buildable chunks

1. **Grid types & constants module** — inputs: none; outputs: `dungeon`, `pdungeon`, `dPiece`, `dFlags`, occupancy arrays, enums; done when unit tests can set/get cells and convert mega↔world both ways.
2. **Tileset loader** — inputs: mega-tile table (list of 4 piece ids) + piece flag table; outputs: `pMegaTiles`, `SOLData`; done when `DRLG_LPass3` renders a 40x40 of a single tile id into a correct 112x112 piece grid.
3. **Tile property queries** — inputs: `dPiece`, `SOLData`, occupancy; outputs: `IsTileSolid/Walkable/Occupied/CanStep`; done when corner-cutting test passes.
4. **Protected & Populated masks** — bitset + flag helpers; done when `Make_SetPC` and `Freeupstairs` produce expected flagged rectangles.
5. **Seed plumbing** — xoshiro128++ game seed → 25 level seeds; LCG `SetRndSeed/GetState`; done when regenerating a level from `LevelSeeds[n]` reproduces identical `dungeon`.
6. **Level bootstrap** — `InitGlobals`, dispatch by `leveltype`, `GetLevelType(level)` mapping; done when every level number maps to the right generator stub.
7. **Walkability generation counter** — invalidation hook for path caches; done when object placement bumps it.

### Pitfalls / design lessons

* Keep the **logical grid tiny** (40x40) and derive everything else; all generation rules below are O(1600) scans so dozens of retries are cheap.
* The `pdungeon` "alternate state" copy is the backbone of every lever puzzle; decide early that generators produce *two* states (open and closed) rather than scripting diffs.
* Negative IDs in occupancy maps for "secondary cells" are a trap for anyone reading them — wrap in accessors (`FindObjectAtPosition(p, considerLargeObjects)`).
* Re-seeding before population (not just before layout) is what makes retries invisible to the rest of the pipeline.

---

## Miniset stamping & fixed-map (.dun) loading

### Purpose
Two mechanisms put authored content into random levels: **minisets** (tiny search/replace stencils, up to 6x6, in code) and **.dun maps** (authored rectangles with tile, monster, object and transparency layers, stamped from data files). Stairs, doorways, decorations and quest rooms all flow through them.

### Key data structures

```
struct Miniset {
  Size size;                 // w,h <= 6
  uint8_t search[6][6];      // [y][x]; 0 = wildcard; else the mega tile that must be present
  uint8_t replace[6][6];     // [y][x]; 0 = leave unchanged; else tile written
  bool matches(pos, respectProtected=true);  // all non-zero search cells equal; no Protected cell in footprint
  void place(pos, protect=false);            // writes non-zero replace cells (optionally protects them)
};
```

`.dun` layout (little-endian `uint16_t`): `[w][h]`, then `w*h` mega tile ids (0 = don't write / floor fill), then at double resolution (`2w x 2h`): a monster layer, an object layer, a transparency layer. Loaders read the tile layer (`PlaceDunTiles`, protecting written cells), the monster layer (`SetMapMonsters`), the object layer (`SetMapObjects`/`LoadMapObjects`, via `ObjTypeConv[id]`) and the transparency layer (`LoadTransparency`, written at world coords `16+i,16+j`).

### Algorithms & rules

1. **`PlaceMiniSet(miniset, tries=199, drlg1Quirk=false)`** — random start `(rnd(40-w), rnd(40-h))`; then linear scan with wrap for `tries` positions. Skip if inside `SetPieceRoom`; skip if `!matches`. On first match, `place` and return position. `tries = 1600` scans the whole map. The `drlg1Quirk` (generator A) skips any position with `x <= 12` or `y <= 12`, nudging the cursor, i.e. stairs in tileset 1/6 never land in the top-left 13x13 band (compat behaviour kept).
2. **`PlaceMiniSetRandom(miniset, pct)`** — scan every position left-to-right, top-to-bottom; for each `matches`, place with probability `pct%`. Generator B's variant also rejects a position if the same `replace[0][0]` tile already exists within a `(3w x 3h)` neighbourhood (prevents clustering). Generators A(crypt)/C's variant adds `CanReplaceTile` which forbids placing decoration-range tiles (84..100 in C; 84..100-equivalents in crypt) diagonally adjacent to another decoration (a known buggy check, kept for compatibility).
3. **`PlaceDunTiles(data, pos, floorId)`** — writes non-zero tiles and protects them; if `floorId != 0` zero cells become that floor tile (lets a quest room carve a clear floor around itself).
4. **`LoadDungeonBase(path, spawn, floorId, dirtId)`** — for fixed sub-levels: fill `dungeon` with dirt, stamp the map at `(0,0)`, load transparency, monsters, objects.
5. **Pre-dun / dun pairs**: fixed sub-levels load a *pre* map into `pdungeon` (`LoadPreL1Dungeon` etc.) and the *live* map into `dungeon`; levers then reveal the pre map (same mechanism as random levels).

### Reference tuning values

| Item | Value |
|---|---|
| Miniset max footprint | 6x6 |
| Default miniset tries | 199 (B, C, D); 1600 (A/crypt stairs) |
| Quirk exclusion band (A) | x ≤ 12 or y ≤ 12 |
| .dun header | 2 x uint16 (w,h) |
| Layers after tile layer | monsters, objects, transparency, each `(2w)*(2h)` uint16 |

Stair minisets per tileset (search footprint → replaced tiles):

| Tileset | Up | Down | Town shortcut up | Other |
|---|---|---|---|---|
| 1 | 4x4 (needs a wall row: row1 = HWall) | 4x3 floor | (T1 has none; level 1 up = town) | quest cave entrance 6x6; candlesticks 2x2 (5–9 per level) |
| 2 | 4x4 floor(3) | 4x4 | 4x4 on level 5 | |
| 3 | 3x3 (wall(8)/wall(10)/floor(7) rows) | 3x3 | 3x3 on level 9 | |
| 4 | 4x5 floor(6) | 5x5 | 4x5 on level 13 | sealed gate 5x5 / open gate 5x5 on level 15 |
| 5 | 3x3 (as 3) | 3x3 (none on level 20) | replaces "up" on level 17 | |
| 6 | 4x4-ish (as 1) | (none on level 24) | replaces "up" on level 21 | |

### Smallest buildable chunks

1. **Miniset struct + match/place** — done when a 2x2 stencil with wildcards matches only intended spots in a test grid.
2. **`PlaceMiniSet` random-start linear scan** — done when 1600 tries covers every cell exactly once (wrap test).
3. **`PlaceMiniSetRandom` with percentage** — done when seeded runs place expected counts (±statistical).
4. **Anti-cluster neighbourhood check** (B variant) — done when no two identical decorations within 3x footprint.
5. **.dun binary reader** — done when w/h and 4 layers parse from a sample file; endian-safe.
6. **`PlaceDunTiles` with protection & floor fill** — done when protected bits equal the non-zero footprint.
7. **Transparency / monster / object layer appliers** — done when a sample map yields correct `dTransVal` values and object list.
8. **Pre/live pair loader for fixed maps** — done when `pdungeon` differs from `dungeon` exactly in the authored diff region.

### Pitfalls / design lessons

* Minisets are indexed `[y][x]` while grids are `[x][y]` — a classic off-axis bug source; wrap access.
* Stair minisets *require* a specific wall configuration in the search mask (e.g. a wall row above a floor row) so the staircase sprite reads correctly; retry generation if none fits rather than relaxing the mask.
* Author decorations as data (stencil + percent) rather than code: generator B has ~100 of them, all one-liners.

---

## Transparency regions & static lighting

### Purpose
Transparency regions label every room so walls/roofs between the camera and the player can be faded. The same labels double as the **room identity** used by theme rooms and vision. Static lighting bakes light sources from level geometry (lava, braziers) into `dPreLight`.

### Key data structures
`dTransVal[112][112]` (`int8_t`, 0 = none), `TransVal` (next id to assign, starts at 1), `TransList[256]` (bool per region, set true when visible this frame), `Light {position(tile+pixel offset), radius, oldRadius, flags}`, `Lights[32]`, `VisionList[4]`, `LightFalloffs[16][128]`, `LightConeInterpolations[8][8][16][16]`.

### Algorithms & rules

1. **`FloodTransparencyValues(floorId)`** — iterate logical grid; for each `floorId` cell whose world cell has `dTransVal == 0`, run a span-fill flood (`FindTransparencyValues`) over *floor* world cells (step 2 = logical cells), writing `TransVal` to each floor cell **and** to its 8 non-floor neighbours (so the surrounding walls belong to the room), then `TransVal++`. Rooms separated by walls/doors get distinct ids. Floor ids: T1/T6 = 13, T2 = 3, T3/T5 = 7, T4 = 6.
2. **Rect helpers**: `DRLG_RectTrans(area)` assigns `TransVal` to a world rectangle inclusive and increments; `DRLG_MRectTrans(megaRect)` converts (`megaToWorld + (1,1)`, `size*2-1`). Used for theme rooms and quest rooms (e.g. the hidden-hall quest room gets id 9 when opened).
3. **Fix-up passes** per tileset (`FixTransparency`): copy a wall cell's region to its two "inner" micro cells for specific dirt-wall tiles so wall faces fade with the room behind them.
4. **`DoLighting(pos, radius, offset)`**: for radius ≤ 15 (16 radii), walk 4 rotated quadrants of a 15x15 cone table; `linearDistance = LightConeInterpolations[offx][offy][x][y]`; if `< 128` set `dLight = min(dLight, LightFalloffs[radius][dist])`. Centre cell set to 0 (full bright), except tilesets 5/6 where the centre is only clamped to `LightFalloffs[radius][0]` to allow dim ambience.
5. **Static level lights**: generators call `DoLighting` directly: T3 lava pieces (55..146, 153..160, 149, 151) radius 7; T5 glowing pieces (381..456) radius 9; T6 lava list radius 3. Objects with the `Light` behaviour call `DoLighting` at creation and `DoUnLight` immediately if loaded at runtime (map-change reveal) so the baked `dPreLight` snapshot (`SavePreLighting`, taken after objects/monsters/items spawn) contains them.
6. **Dynamic lights**: `AddLight` (max 32) for players (radius 10 default), torches/candles only while a player is within `radius+10`, portals (15), flame traps (1), missiles.
7. **Vision**: `DoVision(pos, radius, explorerType, visible)` casts rays; each reached cell gets `Visible` (+`Lit` if `visible`) and, if `explorerType != NONE`, `Explored` + automap update; it also sets `TransList[dTransVal]=true` for regions seen → those regions render opaque, everything else fades.

### Reference tuning values

| Item | Value |
|---|---|
| Max dynamic lights | 32 |
| Max vision sources | 4 (one per player) |
| Light radii | 0..15 |
| Player default light radius | 10 |
| Portal light | 15 |
| Object lights | candles 5, lore candles 3, torches 8, trap 1 |
| Static lava light radius | T3: 7, T5: 9, T6: 3 |
| Light "wake-up" distance | `radius + 10` walking distance |

### Smallest buildable chunks

1. **Span-fill region labeller** including diagonal re-seeding and neighbour wall tagging — done when a two-room test grid yields 2 ids and walls share the id of their room.
2. **Rect/mega-rect labellers** — done when theme rooms get unique ids.
3. **Per-tileset transparency fix-up table** — done when wall faces fade with the adjacent room in a render test.
4. **Light falloff tables + cone interpolation** — done when `DoLighting` matches reference images for radius 5/10.
5. **Static bake (`SavePreLighting`) and un-light** — done when toggling an object light restores exact pre-values.
6. **Dynamic light pool (32)** with add/move/change-radius/unlight — done when exhaustion returns `NO_LIGHT` gracefully.
7. **Wake-up rule for object lights** — done when torches far from any player do not consume light slots.
8. **Vision raycaster** feeding `TransList` and flags — done when standing in a room makes only that room opaque.

### Pitfalls / design lessons

* Rooms separated only by an arch (no door) fuse into one region because the arch is floor-walkable; that is fine for fading but means "theme room = region" needs the extra enclosure check (see Themes).
* Baking static lights requires that *every* light-emitting thing exists before the bake; the reference does objects → monsters → items → themes → bake, and runtime map-changes must `DoUnLight` immediately after `DoLighting` so they do not double-apply.
* The 32-light cap is tiny; the "only light torches near a player" rule is what makes it workable.

---

## Generator A — tileset 1 (cathedral-style halls) and tileset 6 variant (crypt-style)

### Purpose
Produces levels 1–4 (and 21–24 with crypt substitutions): a central hall axis with up to three 10x10 pillared chambers, surrounded by a recursive tree of small rectangular rooms, with walls carved by scanning for straight floor runs and punching doors/arches/fences into them.

### Key data structures
`DungeonMask` (room boolean mask), `Chamber` bitset (cells where walls may not be added), flags `VerticalLayout`, `HasChamber1/2/3`, tile enum (VWall=1, HWall=2, Corner=3, DWall=4, DArch=5, VWallEnd=6, HWallEnd=7, HArchEnd=8, VArchEnd=9, HArchVWall=10, VArch=11, HArch=12, **Floor=13**, HWallVArch=14, Pillar=15, VCorner=16, HCorner=17, Dirt*=18–24, **VDoor=25, HDoor=26**, fences 27–38, …, **EntranceStairs=64**, decorated variants 79–100, floor variants 139–163, dirt variants 199–205), `BaseTypes[207]` (tile → undecorated base), `TileDecorations[207]` (tile → decoration group), `ShadowPatterns[37]` (`{trigger, s1, s2, s3, nv1, nv2, nv3}` on a 2x2 window of base types).

### Algorithms & rules (step by step)

**`GenerateLevel(entry)`**:

1. `minarea` = 533 (level 1), 693 (level 2), 761 otherwise (out of 1600 cells).
2. Outer `while(true)`: `DRLG_InitTrans()`; inner `do { LevelSeeds[lvl]=state; FirstRoom(); } while (FindArea() < minarea)` where `FindArea = DungeonMask.count()`.
3. `InitDungeonFlags()` (fill `dungeon` with Dirt=22, clear Protected & Chamber), `MakeDmt()`, `FillChambers()`, `FixTilesPatterns()`, `AddWall()`, `FloodTransparencyValues(13)`, `if (PlaceStairs(entry)) break;` else retry everything.
4. Post: copy region ids for entrance stairs rows; `FixTransparency()`; `FixDirtTiles()` (or crypt variant); `FixCornerTiles()`; then either crypt substitution or: `Substitution()`, `ApplyShadowsPatterns()`, place `rnd(5)+5` candlestick minisets (2x2) with 1600 tries each, `FillFloor()` (each unprotected Floor → 1/3 stay, 1/3 variant A, 1/3 variant B).
5. `memcpy(pdungeon, dungeon)`; `DRLG_CheckQuests(SetPiece.position)` (see quest stamping) — note this writes some quest variants into `pdungeon`, others into `dungeon`.
6. `Pass3()` expands to pieces; `InitDungeonPieces()` tags arch overlay pieces into `dSpecial` (6 overlay kinds). Crypt: also bakes lava lights and locates the vault/cornerstone pieces.

**`FirstRoom()`** (layout skeleton):

* `VerticalLayout = coin`; `HasChamber1/2/3 = coin each`; if chamber 1 or 3 is absent, force chamber 2.
* Chambers: 10x10 at `(1,15)`, `(15,15)`, `(29,15)`; hallway `(1,17)` size `38x6`. If no chamber 1: hallway `x += 17, w -= 17`; if no chamber 3: `w -= 16`. Vertical layout swaps x/y of chambers 1,3 and the hallway.
* Map present chambers and the hallway into `DungeonMask`, then `GenerateRoom(chamber, VerticalLayout)` for each present chamber.

**`GenerateRoom(area, vertical)`** (recursive side-room tree):

* `rotate = (rnd(4)==0)`; `vertical ^= rotate`.
* Up to 20 tries: random even size `w,h ∈ {2,4,6}` (`(rnd(5)+2) & ~1`). Room 1 is placed flush against the area on the "negative" side (above if horizontal, left if vertical), centred; `CheckRoom` with a 1-cell margin against the mask and bounds. On success map it.
* Room 2 = same size mirrored to the "positive" side (below/right); mapped if free.
* Recurse into room 1 and room 2 with `!vertical` (A alternates orientation each depth; D does not).

**`MakeDmt()`** (mask → tiles): for each `(i,j)` with `i,j < 39`: mask set → Floor; else if `(i+1,j+1)` clear but `(i,j+1)` and `(i+1,j)` set → Floor (remove inner diagonal notch); else if all three of `(i+1,j+1),(i,j+1),(i+1,j)` set → VCorner; else `(i,j+1)` set → HWall; else `(i+1,j)` set → VWall; else `(i+1,j+1)` set → DWall; else Dirt.

**`FillChambers()`**: `GenerateChamber(pos, connectPrev, connectNext, vertical)` writes an 11x11 interior of Floor into `Chamber` (no walls allowed there), four Pillars at offsets `(4,4),(7,4),(4,7),(7,7)`, and arch/corner tiles on the connecting side(s). Halls between chambers: `GenerateHall(start, length 2)` between adjacent chambers (two parallel arch rows 3 apart), or a single `length 16` hall when chamber 2 is missing. Finally the quest set piece (if any) is stamped into a random present chamber via `SelectChamber()` (positions `(2,16)`, `(16,16)`, `(30,16)` or transposed).

**`FixTilesPatterns()`**: three sequential scans of hard-coded 2-cell neighbour rewrite rules (≈50 rules) converting wall/floor/dirt adjacencies into the proper end-caps and corner tiles (e.g. `Floor | Dirt → DirtHwall`, `HWall | Floor → HCorner`, `VWallEnd | Dirt → DirtVwallEnd`). Bounds-checked.

**`AddWall()`** (interior wall carving): scan all cells not Protected and not Chamber. For tile types Corner, VWallEnd, HWallEnd, HWall, VWall: consume 1 RNG value (compat), measure a straight run of Floor cells with Floor on both flanks (`HorizontalWallOk`/`VerticalWallOk`); the run must end on a wall-ish tile (Corner/DWall/DArch/ends/dirt walls) and be longer than 1. Then `HorizontalWall(pos, startTile, len)`:

* `rnd(4)`: 2 → arch wall (door tile also arch), 3 → fence wall, else plain wall.
* `rnd(6)==5` → the door becomes an arch opening instead.
* Write start tile, `len-1` wall tiles, then a door/arch at offset `rnd(len-1)+1`; real doors are `Protected`.

**`Substitution()`**: for each cell with `rnd(4)==0` and an unprotected tile that has a decoration group: pick the `rnd(16)`-th (cyclic) tile of that group as replacement; special two-tile decorations (VWall4/HWall4) require the neighbour to be plain and convert it to the companion half.

**`ApplyShadowsPatterns()`**: for every 2x2 window compute base types; for each of 37 patterns whose trigger equals the bottom-right base and whose optional s1/s2/s3 match the other three, write nv1/nv2/nv3 (shadowed floor/wall variants) into unprotected cells; a second pass swaps shadow variants next to fence/door tiles.

**`PlaceCathedralStairs(entry)`**: optional quest cave entrance (6x6, 1600 tries, quirk) → quest position = `mega→world + (5,6)`; stairs up 4x4 (two variants depending on save-compat flag) → `ViewPosition = world + (3,4)` if `ENTRY_MAIN`; stairs down 4x3 → `world + (3,3)` if `ENTRY_PREV`; when the inn-sign quest room is on this level the "down" stairs are inside the set piece instead (`SetPiece.world + (3,11)`). Returns false → whole layout retried.

**Crypt variant (tileset 6)**: same layout; `FillChambers` stamps the sealed vault room (`vault_room` map) on level 24 or the cornerstone room (if enabled) via `SelectChamber`; stairs: up or town-shortcut (level 21) 4x4 at `world + (3,5)`, down (except level 24) at `world + (3,7)`; `CryptSubstitution` applies statue 1x1 swaps 10%, arch variants 95%, wall sections 100%, lava floor 60%, then per level: cracked 30%, broken 15/20/20/20%, leaking 5/10/15/20%, floor variants 10%, substitution set 1: 5/10/15/20%, set 2 (pillars/star): 20/20/30/30% for levels 21/22/23/24; lights radius 3 on lava pieces.

### Reference tuning values

| Parameter | Value |
|---|---|
| Min floor cells | L1 533, L2 693, else 761 (of 1600) |
| Chamber footprint / interior | 10x10 mapped, 11x11 floored, 4 pillars |
| Hallway | 38x6 (shrinks by 17/16 when end chambers absent) |
| Side room sizes | even 2/4/6, 20 placement tries |
| Orientation flip chance per recursion | 1/4 |
| Wall style | plain 2/4, arch 1/4, fence 1/4; door→arch 1/6 |
| Decoration swap chance | 1/4 per cell, 16-way cyclic pick |
| Floor variants | 1/3 each |
| Candlesticks | 5–9 per level |
| Shadow patterns | 37 |
| Stair tries | 1600 (full scan) with ≤12 exclusion band |
| Set-piece chamber choice | uniform among present chambers (order quirks preserved) |

### Smallest buildable chunks

1. **Skeleton layout (`FirstRoom`)** — inputs: RNG; outputs: `DungeonMask`, flags; done when all 7 chamber combos produce a connected mask and vertical transposition works.
2. **Recursive side rooms (`GenerateRoom`)** — done when rooms never overlap and never breach bounds (margin test).
3. **Area gate loop** with `LevelSeeds` capture — done when `minarea` is met within bounded retries on 1000 seeds.
4. **Mask→tile converter (`MakeDmt`)** — done when the 6-case truth table is unit-tested.
5. **Chamber & hall stamping** — done when pillars and connector arches appear at fixed offsets for all layouts.
6. **Neighbour rewrite rule engine** (`FixTilesPatterns`) — data-drive the ~50 rules; done when no "impossible adjacency" remains (write a validator).
7. **Straight-run wall carver with doors** — done when every carved wall has exactly one opening and no carving enters chambers/protected cells.
8. **Transparency flood on floor 13** — reuse shared module.
9. **Stair placement + view position** — done when up/down/quest minisets land, else layout retries.
10. **Transparency fix-ups for dirt walls** — done when fade looks right.
11. **Dirt/corner fix passes** — done when dirt variants chosen by neighbour match reference.
12. **Decoration substitution** — done when protected tiles are never swapped and 2-tile decorations are paired.
13. **Shadow pattern pass** — done when 37-pattern table applies on reference layouts.
14. **Candlesticks + floor variants** — trivial; done when counts are in range.
15. **Pass-3 expansion + overlay tagging** — done when arch overlays render in front of the player.
16. **Crypt substitution schedule** — per-level percentage table; done when each level number produces different wear density.
17. **Vault / cornerstone chamber stamping** — done when `VaultRow/VaultCol` are located from the stamped piece.

### Pitfalls / design lessons

* The hall-axis-plus-chambers skeleton guarantees connectivity by construction — no flood-fill validation needed (unlike C). Side rooms always touch their parent.
* Wall carving relies on "floor flanked by floor" runs; chambers must be masked out or they get bisected.
* Many "BUGFIX" comments mark places where the original had out-of-bounds reads; the reference keeps some behaviours (the ≤12 quirk, buggy decoration adjacency check) *only* for seed compatibility — a new game should drop them.
* Level-1/2 lower area thresholds are a deliberate difficulty/pace curve: tiny early levels.

---

## Generator B — tileset 2 (catacomb-style rooms, corridors, doors)

### Purpose
Produces levels 5–8: an ASCII pre-dungeon is built by recursive space partition (rooms) plus random-walk corridors with doors, voids are back-filled with extra rooms, and 3x3 pattern matching converts ASCII to tiles. Heavier use of doors, locked-out corridor fixing and hundreds of decorative minisets.

### Key data structures
`char predungeon[40][40]` with symbols: `' '` void, `'.'` room floor, `'#'` wall, `'D'` door, `','` corridor floor (converted to `'.'` later), `'A'/'B'/'C'/'E'` room corner markers. `RoomNode {topLeft, bottomRight}` in `RoomList[81]`, `nRoomCnt`; `HallNode {beginning, end, direction}` queue `HallList`; `Patterns[100][10]` (9 cell codes + output tile; sentinel `255`); `BTYPESL2[161]` / `BSTYPESL2[161]` (decoration group / shadow base); tiles: 1 VWall, 2 HWall, **3 Floor**, 4/5 doors (V/H), 6–9 corners, 10–16 dirt/corner walls, 12 = base dirt, 39..51 arch pieces, 48/50 shadowed floors, 71/72/76/77/78 stairs, 158–160 town stairs.

### Algorithms & rules

**`GenerateLevel(entry)`**: `while(true) { LevelSeeds=state; nRoomCnt=0; InitDungeonFlags() (clear Protected, predungeon=' '); DRLG_InitTrans(); if(!CreateDungeon()) continue; FixTilesPatterns(); InitSetPiece(); FloodTransparencyValues(3); FixTransparency(); if(PlaceStairs(entry)) break; }` then `FixLockout(); FixDoors(); FixDirtTiles(); DRLG_PlaceThemeRooms(6,10,3,0,false);` ~100 `PlaceMiniSetRandom` decoration calls; `Substitution(); ApplyShadowsPatterns(); pdungeon copy; DRLG_CheckQuests(SetPieceRoom.position)`.

**`CreateDungeon()`**:

1. Forced quest room size: level 5 pedestal room `14x20`; level 6 vault-portal room `10x10`; level 7 hidden-hall room `15x15` (only if that quest is available; the size is passed to the root `CreateRoom`).
2. `CreateRoom(topLeft=(2,2), bottomRight=(39,39), parent=0, dir=None, size)`.
3. Pop `HallList` FIFO, `ConnectHall(node)` for each.
4. Convert corner markers to `'#'`; convert `','` to `'.'` and turn any void 8-neighbour of corridor floor into `'#'`.
5. `if (!FillVoids()) return false;` (retry).
6. `DoPatternCheck(i,j)` on every cell → `dungeon`.

**`CreateRoom(tl, br, parentRoom, hallDir, forcedSize)`** (BSP-ish):

* Stop if `nRoomCnt >= 80` or area smaller than `2x2`.
* Room size: each dim `rnd(min(areaDim, 10) - 4) + 4` when `areaDim > 4` (RoomMin 4, RoomMax 10); forced size overrides.
* Room origin: `tl + (rnd(areaW), rnd(areaH))`, pulled back so it fits; all corners clamped to `[1,38]`.
* `DefineRoom`: write corner markers, `'#'` border, `'.'` interior; if forced, protect the top row (a known bug kept) and set `SetPieceRoom = {roomTL + (2,2), roomSize - 1}`.
* If there is a parent: create a `HallNode` from a random point on this room's facing wall (`rnd(size-2)+1` along the wall) to a random point on the parent's facing wall, in `hallDir`.
* Subdivide the remaining area into 4 sub-areas (standoff 2 cells from the room) and recurse; the split order depends on whether the room is taller than wide, and each sub-call carries the hall direction back toward this room (`Right/Left/Up/Down`).

**`ConnectHall(node)`** (random-walk corridor): two 50% flags widen the corridor by one cell on the "minus" and/or "plus" side; mark door candidates at both ends; `end -= dir`; loop: bounce off bounds (`x>=38`, `y>=38`, `x<=1`, `y<=1`) and off corner markers; step one cell; if stepping into void: if we just left a room place a door behind us, else possibly widen; write `','`; if stepping into non-void: first wall cell becomes a door candidate, mark `inRoom`. Re-aim heuristics: let `dx=|end.x-x|`, `dy=|end.y-y|`; if `dx > dy` with probability `min(2*dx,30)%` set direction toward end horizontally; else with `min(5*dy,80)%` vertically; plus 6 special-case rules when aligned (`dx==0`, `dy==0`, `dx==1`, `dy==1`, `<10` cases) to avoid oscillation. Loop until `pos == end`.

**`CreateDoorType(p)`**: refuses if any 4-neighbour is already `'D'` or if `p` is a corner marker; else writes `'D'`.

**`FillVoids()`**: while `CountEmptyTiles() > 700` and `tries < 100`: pick random `(1..38,1..38)`; must be `'#'` with void on exactly one side and room floor on the other (3-cell check); then `FillVoid` grows a rectangle away from the room: first extend along the wall direction until hitting non-void or reaching 14 cells span, shrink by 2 each side, require span > 5; then extend into the void up to 12 deep, shrink 2, require > 5; `MapRoom` (walls `'#'`, interior `'.'`) and `KnockWalls` (walls between two floors become floor; adjacent doors become floor — merges rooms). Return `empty <= 700`.

**`DoPatternCheck(i,j)`**: for each of 71 patterns, test the 3x3 window around `(i,j)` with cell codes: `0` any, `1` `'#'`, `2` `'.'`, `3` `'D'`, `4` `' '`, `5` D or `.`, `6` D or `#`, `7` ` ` or `.`, `8` D/#/`.`; out-of-bounds counts as match; on full match write the pattern's output tile (later patterns override earlier). The pattern list first maps void/floor/doors, then wall orientations with their corner/end tiles (outputs 1..16).

**`FixTilesPatterns`** (6 rules), **`InitSetPiece`** (quest `.dun` at `SetPieceRoom.position` with floor 3), **`PlaceStairs`**: up 4x4 → `world+(5,4)` (`ENTRY_MAIN`); down 4x4 → `world+(4,6)` (`ENTRY_PREV`); on level 5 a town-shortcut 4x4 → `world+(5,4)` (`ENTRY_TWARPDN`); any failure → full retry (199 tries each).

**`FixLockout()`**: (a) a door tile whose "before" neighbour is not floor becomes plain wall; (b) scan rows: for each horizontal wall segment (tiles 2/5) with floor above and below, walk right while the condition holds; if no door (5) in the run and the end is unprotected, place a door at the last cell; (c) same for vertical (1/4). This guarantees every wall that separates two floor areas has a door. **`FixDoors`**: door next to floor on the far side becomes its "end" variant (7/9). **`FixDirtTiles`**: dirt-wall end variants (143–148) by neighbour.

**Decoration schedule** (all via `PlaceMiniSetRandom` with anti-cluster check; order matters): 8 "central door" stencils 100%; 40 vertical arch stencils 100% (variants 33–40 first, then 1–32); 40 horizontal arch stencils 100%; crumbled column 3x3 99%; 1x1 wall decorations: VWall→80/81/82 10% each, HWall→84/85/86 10% each, 8→87 50%; two "pancreas" stencils 1%; large floor stains: BIG1–5 3%, BIG6/7/9/10 20%, BIG8 3%. Then `Substitution()` (1/4 cells, cyclic pick of same group, reject if that tile exists in the 4x4 window to the upper-left) and `ApplyShadowsPatterns()` (2 patterns). Objects later add wall torches on specific pieces: 1/3 on pieces 0/4, 1/10 on 36/40.

### Reference tuning values

| Parameter | Value |
|---|---|
| Max rooms | 80 (array 81) |
| Room size | 4..10 per axis; min area 2 |
| Area bounds | `(2,2)`–`(39,39)`, corners clamped `[1,38]` |
| Forced quest rooms | L5 14x20, L6 10x10, L7 15x15 |
| Subdivision standoff | 2 |
| Corridor widening flags | 50% each side |
| Corridor re-aim | `min(2*dx,30)%` horizontal, `min(5*dy,80)%` vertical |
| Void budget | ≤ 700 void cells, ≤100 fill tries |
| Void room growth caps | 14 along wall, 12 deep, interior > 5 |
| Patterns | 71 (3x3) |
| Stair tries | 199 |
| Theme rooms | min 6, max 10, floor 3, freq 0 (every candidate) |
| Decoration swap | 1/4 per cell |

### Smallest buildable chunks

1. **ASCII pre-dungeon buffer + room writer (`DefineRoom`/`MapRoom`)** — done when corner markers/borders/interiors render in a debug dump.
2. **Recursive partition (`CreateRoom`)** with forced quest-room size and `SetPieceRoom` capture — done when ≤80 rooms, all inside bounds, no overlaps.
3. **Hall node queue** (facing-wall endpoint selection) — done when every non-root room has exactly one hall node to its parent.
4. **Random-walk corridor (`ConnectHall`)** with bounce and re-aim rules — done when 1000 seeds all terminate and reach `end`.
5. **Door candidate rule (`CreateDoorType`)** — done when no two doors are 4-adjacent.
6. **Post-walk normalisation** (corners→wall, hall floor→floor, wall-wrap voids) — done when no `','` remains and corridors are walled.
7. **Void back-filling (`FillVoids`)** — done when void ≤ 700 or regeneration triggers; room merge via `KnockWalls` verified.
8. **3x3 pattern compiler (`DoPatternCheck`)** — data-drive 71 patterns; done when a dump of ASCII → tiles matches a golden image.
9. **Set-piece stamping into reserved room** — done when quest `.dun` lands at `SetPieceRoom.position` with floor fill 3.
10. **Stairs + town-shortcut on tier entry level** — done when level 5 always has 3 staircases.
11. **Lockout fixer** — done when a BFS from the up-stairs reaches the down-stairs through doors on 1000 seeds.
12. **Door end-variant & dirt fix passes** — visual; done when golden image matches.
13. **Decoration schedule runner** (list of `{stencil, percent}`) — done when order-dependent output is reproducible.
14. **Anti-cluster neighbourhood check** — done when identical decorations never fall within 3x footprint.
15. **Substitution with 4x4 duplicate rejection** — done.
16. **Shadow pass (2 patterns)** — done.
17. **Torch object seeding on specific wall pieces** — done when counts ~ expected.

### Pitfalls / design lessons

* The corridor walker is the fragile part (many special-case rules exist purely to stop oscillation). A modern rewrite should use an L-shaped or A* corridor and keep only the door-placement semantics.
* "Void budget ≤ 700" is the de-facto density knob; `FillVoids` merging rooms (`KnockWalls`) is why catacomb levels have large irregular halls.
* Because `SetPieceRoom` is reserved **before** layout, quest rooms never overlap corridors; the price is a forced large room that dominates the BSP root.
* `FixLockout` exists because the walker can seal rooms; any carving scheme needs an explicit "every separating wall has a door" invariant or a connectivity validator.

---

## Generator C — tileset 3 (cave-style) and tileset 5 variant (hive-style)

### Purpose
Produces levels 9–12 (and 17–20 with hive decorations): an organic blob grown by recursively attaching 3–4-cell blocks with randomly ragged borders, smoothed by cellular-style passes, validated for area and connectivity, converted with a 16-entry marching-squares table, then dressed with lava pools, rivers with bridges, fences, stalagmites and (hive) slime pools.

### Key data structures
`dungeon` used as a **0/1 floor mask** during growth; `L3ConvTbl[16] = {8,11,3,10,1,9,12,12,6,13,4,13,2,14,5,7}` (2x2 window → tile; **7 = floor, 8 = solid rock**); `lockoutcnt`; river scratch `int river[3][100]` (x, y, tile); spawn tables for pool flood (`spawntable[15]`), `Poolsub[15]` lava replacement; tile ranges: 1–14 wall shapes, 15–24 river pieces, 25–28 wall-edge starts, 29–45 lava/bridge pieces (44 = bridge over vertical river, 45 = horizontal), 46–51 stairs, 106–110 floor decorations, 121–140 fence pieces (146/147 fence gates), 153–156 warp pad, 125 = special "warp" marker tile.

### Algorithms & rules

**`GenerateLevel(entry)`** loop:

1. `LevelSeeds = state; InitDungeonFlags()` (zero `dungeon`, clear Protected).
2. Seed room: `x1 = rnd(20)+10, y1 = rnd(20)+10, x2=x1+2, y2=y1+2; FillRoom(x1,y1,x2,y2)`; then `CreateBlock((x1,y1),2,0)` (up), `CreateBlock((x2,y1),2,1)` (right), `CreateBlock((x1,y2),2,2)` (down), `CreateBlock((x1,y1),2,3)` (left).
3. If the anvil-island quest is on this level: `FloorArea(x1..x1+12, y1..y1+12)` with `x1,y1 = rnd(10)+10` (a 13x13 guaranteed clearing).
4. `FillDiagonals(); FillSingles(); FillStraights(); FillDiagonals(); Edges();`
5. `if (GetFloorArea() < 600 || !Lockout()) continue;`
6. `MakeMegas();` `if (!PlaceStairs(entry)) continue;` `if (anvil && !PlaceAnvil()) continue;` `if (PlacePool()) break;` (caves **require** at least one lava pool; hive requires ≥3 slime stencils placed).

**`FillRoom(x1,y1,x2,y2)`**: reject if `x1<=1 || x2>=34 || y1<=1 || y2>=38` or any cell already floor; set interior to 1; each border cell independently 50% floor (ragged edge).

**`CreateBlock(point, obs, dir)`**: `bw, bh ∈ {3,4}`; position the block adjacent to `point` on side `dir` (0 up, 1 right, 2 down, 3 left), sliding it along the shared edge by `rnd(block)` relative to `obs` (the parent's extent); if `FillRoom` succeeds and `rnd(4) != 0` (75%) recurse in the three directions other than back toward the parent.

**Smoothing**:

* `FillDiagonals`: for each 2x2 window compute `v = br + 2*bl + 4*tr + 8*tl`; `v==6` (anti-diagonal) → randomly fill tl or br; `v==9` (diagonal) → fill tr or bl. Removes pinch points.
* `FillSingles`: a 0 cell whose 8 neighbours are all 1 becomes 1.
* `FillStraights`: for each row/column, find runs longer than 3 of "0 above 1" (or the three other edge orientations); with 50% randomise each cell of the run to `rnd(2)`. Breaks long straight cliff edges.
* `Edges`: last column and last row forced 0.

**`Lockout()`**: copy floor cells into `DungeonMask`, remember the last one, recursive 4-neighbour flood from it; return `floodCount == totalFloor` (single connected component).

**`MakeMegas()`**: per 2x2 window `v` as above; `v==6 → 12 or 5`, `v==9 → 13 or 14` (random); `dungeon = L3ConvTbl[v]`; right column and bottom row = 8.

**Stairs** (`PlaceCaveStairs`): up 3x3 (`world+(1,3)`), down 3x3 (`world+(3,1)`), level 9 town shortcut 3x3 (`world+(1,3)`); hive: up or (level 17) shortcut, down except level 20.

**`PlaceAnvil()`**: load island `.dun`; search area = dun size + 2 border; random start then up to 199 linear tries for an all-floor(7), unprotected footprint; stamp at `+1,+1`, `SetPiece` = whole area, protect it; temporarily write wall tile 2 at `(+7..+9, +5)` to stop rivers entering; after rivers, restore those cells to 7 and, if the cell at `+10,+5` became river (17/18), convert it into a bridge (45).

**`PlaceLavaPool()`** (caves): for each solid cell (8): mark visited (`|0x80`), flood through wall-shape cells using `spawntable` bit masks (bits 0–3: continue flood edge-wise N/S/E/W; bits 4–7: continue as interior) counting `totarea`; the flood **fails** (returns true) if it reaches the map edge or exceeds 40 cells or touches a tile > 15. If it succeeded, `totarea > 4` and `rnd(100) < 25`, replace every visited cell via `Poolsub` (wall shapes → lava edge tiles 25–37; interior 8 → 33? (`Poolsub[8]=33`), floor 7 stays). Clears visited bits. Returns whether any pool was made.

**`PlaceSlimePool()`** (hive): four stencils at 30/40/50/60%; success if ≥3 of them placed at least once.

**Caves post-processing** (in order): `PoolFix()` (solid cells adjacent to lava ground 25–41 become lava ground 33); `Warp()` (first 2x2 block of tile 125 → warp pad 153–156; also `5` over `7` → 7); island stencils (`L3ISLE1/2` 70%, `3/4` 30%, `1/2` again 100%, `5` 90%); `HallOfHeroes()` fix-ups; **`River()`**; anvil river repair; `DRLG_PlaceThemeRooms(5,10,7,0,false)`; `Fence()`; stalagmites `L3TITE1–3` 10%, `6–10` 20%, `11` 30%, `12–13` 20%; crevices `L3CREV1–11` 30%; floor variants 1x1 `7→106/107/108` 25%, `9→109`, `10→110` 25%.

**`River()`**: up to 4 rivers, 200 total tries. Pick a random wall-edge start tile (25–28; linear scan from a random point, ≤100 tries); start direction and first tile depend on which edge type; then random walk through floor (7) for ≤100 steps: each step try the current random direction, rotating through the 4 directions, never the "no-go" direction (back into the wall) nor the turn-back direction; on each floor cell write a straight river tile (15/16 for E/W, 17/18 for N/S) and on turns patch the previous tile with a corner piece (19–22); stop when the walk cannot continue; the river is accepted only if it ends against a wall of the right shape (writes an end cap 23/24/42/43) and `riveramt >= 7`; then pick a **bridge** cell: up to 30 random river cells where the river is straight and both banks are floor and no river neighbour lies across; write 44/45. Only on success are the tiles committed (`rivercnt++`).

**`Fence()`**: (1) long wall runs: a run of tile 10 (horizontal wall) becomes fence `127 … (129|126)* … 128` with 50%; a run of 9 becomes `123 … (124|121)* … 122`; a corner 11 with both runs becomes 125 with both arms fenced. (2) For each floor cell 7 (consume 1 RNG; skip near theme rooms) with 50% choose vertical or horizontal: extend a line both ways while `FenceVertical*/Horizontal*` conditions hold (cells are floor/wall-start tiles and the flanks are not already fence); if both ends are not floor (i.e. the line spans wall-to-wall) and span > 1, convert the line to fence pieces (`137|135` or `136|134` on floor, 131/130 on wall starts, 139/140 on 2/4, 133/132 on fence-run pieces, 138 at junctions) leaving exactly **one random gap cell**; (3) `AddFenceDoors()`: a floor cell with fence on both sides becomes a gate (146 vertical / 147 horizontal); `FenceDoorFix()` reverts gates whose neighbours are not proper fence pieces.

**Hive post-processing**: island stencils as caves (`L6ISLE*`), 1x1 `8→25..28` 20%, then `HivePattern29..38` with ascending chance 10,15,…,55% and again descending 10..55% in reverse order, `HivePattern9/10` 40/45%, then 1x1 floor/wall variants 25% (`7→29..32`, `9→33..37,45,46`, `10→39..43,47,48`, `11→38,44,49,50`).

**Lights**: caves — pieces 55..146, 153..160, 149, 151 radius 7; hive — 381..456 radius 9. **Pass-3 base** = 8.

### Reference tuning values

| Parameter | Value |
|---|---|
| Seed room | 3x3 at `(10..29, 10..29)` |
| Block size | 3 or 4 per axis |
| Block recursion continue chance | 75% |
| Legal block bounds | `1 < x < 34`, `1 < y < 38` |
| Border raggedness | 50% per border cell |
| Straight-edge break | runs > 3, 50% |
| Min floor cells | 600 |
| Connectivity | required (single component) |
| Lava pool | enclosed region ≤ 40 cells, > 4 cells, 25% conversion; ≥1 pool required |
| Hive slime | 4 stencils 30/40/50/60%, ≥3 must place |
| Rivers | ≤4, 200 tries, length ≥7, ≤100 steps, bridge in 30 tries |
| Anvil clearing | 13x13 at `(10..19, 10..19)`; island placement 199 tries |
| Theme rooms | min 5, max 10, floor 7 |
| Fence wall-run conversion | 50% |
| Stair tries | 199 |

### Smallest buildable chunks

1. **0/1 growth buffer + `FillRoom`** with ragged borders — done when borders are ~50% filled statistically.
2. **Recursive block attachment (`CreateBlock`)** — done when 1000 seeds terminate and respect bounds.
3. **Smoothing passes** (`FillDiagonals`, `FillSingles`, `FillStraights`, `Edges`) — done when no diagonal pinch remains and long straight edges are broken.
4. **Area + connectivity gate** (`GetFloorArea`, `Lockout`) — done when disconnected test masks are rejected.
5. **Marching-squares converter (`MakeMegas`)** with the 16-entry table and random 6/9 cases — done when golden tiles match.
6. **Stairs (3x3) incl. tier-entry shortcut** — done.
7. **Island set-piece placement with protection and river blocker** — done when rivers never cross the island.
8. **Enclosed-region lava flood (`PlaceLavaPool`)** — done when regions touching the edge or >40 cells are never converted.
9. **Hive slime stencils with ≥3 rule** — done.
10. **`PoolFix` / `Warp` pad / island stencils** — done.
11. **River walker + bridge selection** — done when every committed river has an end cap and exactly one bridge.
12. **Theme rooms on floor 7** — shared module.
13. **Fence builder (runs, spans with gap, gates, gate fix)** — done when every fence span has exactly one gap and gates are only between fence pieces.
14. **Stalagmite / crevice / variant schedule** — data list; done.
15. **Hive decoration schedule** (ascending then descending percentages) — done.
16. **Static lava/glow lighting** — done when `dPreLight` shows radius-7/9 pools.

### Pitfalls / design lessons

* This is the only generator that needs an explicit connectivity check; the growth is unconstrained so ~a few percent of attempts fail. Keep the check cheap (bitset flood) and retry everything.
* Requiring ≥1 lava pool per cave level is a *content* rule hidden inside the retry loop; surface such rules as named constraints.
* Rivers are written only after the whole path is validated — build "scratch then commit" into any carving tool.
* The `0x80` visited-bit trick inside the tile array is fragile; use a separate bitset.
* Fences are the cave-tileset's "doors": a one-cell gap guarantees passability without lockout logic.

---

## Generator D — tileset 4 (hell-style mirrored quadrants)

### Purpose
Produces levels 13–16: a single 20x20 quadrant is generated with the same recursive room tree as A, forced to touch the mirror axes, then mirrored 4-way into a symmetric 40x40 map; walls are carved with 3-tile doorways; theme rooms get random sizes; level 16 embeds the final arena.

### Key data structures
`DungeonMask` (only the 20x20 quadrant used before mirroring), `hallok[20]`, `L4Hold` (seed room position on level 16), `ArenaQuad1..4` (world positions of the four arena quadrant maps), `L4ConvTbl[16] = {30,6,1,6,2,6,6,6,9,6,1,6,2,6,3,6}` (**6 = floor, 30 = solid**), `L4BTYPES[140]` decoration groups; door triples 57/60/56 (horizontal) and 53/6/52 (vertical) with side decorations 58/59 and 54/55; tiles 18–30 inner walls with `+98` "corner" variants (116–128); 95–97 floor variants; 31–38 up stairs, 39–46 down, 129–136 town shortcut, 98–106 sealed gate, 107–115 open gate.

### Algorithms & rules

**`GenerateLevel(entry)`**: `while(true) { DRLG_InitTrans(); do { LevelSeeds=state; InitDungeonFlags() (mask clear, Protected clear, dungeon=30); FirstRoom(); CloseOuterBorders(); } while (FindArea() < 692); PrepareInnerBorders(); MirrorDungeonLayout(); MakeDmt(); FixTilesPatterns(); if(level==16) ProtectQuads(); protect SetPieceRoom interior if quest; AddWall(); FloodTransparencyValues(6); FixTransparency(); InitSetPiece(); if(level==16) LoadArenaQuads(true); if(PlaceStairs(entry)) break; }` then `GeneralFix(); if(level!=16) DRLG_PlaceThemeRooms(7,10,6,8,true); ApplyShadowsPatterns(); FixCornerTiles(); Substitution(); pdungeon copy; DRLG_CheckQuests(SetPieceRoom.position);` level 15 gate logic; level 16 `LoadArenaQuads(false)`.

**`FirstRoom()`**: room size `14x14` on level 16; `11x11` on the champion-room quest level (or the betrayer level in multiplayer); else `rnd(5)+2` per axis (2..6). Position uniformly in `[ (20-w)/2 , 19-w ]` per axis (so the seed room sits in the middle band of the quadrant). On level 16 remember `L4Hold`. For quest levels `SetPieceRoom = {pos+(1,1), size+(1,1)}`. `MapRoom(room)` (clipped to the quadrant), `GenerateRoom(room, coin)`.

**`GenerateRoom`** = A's algorithm with two differences: `rotate = (rnd(4) != 0)` (**75%** chance to flip orientation) and recursion passes the *same* orientation down. `CheckRoom` additionally rejects `x<=0 || y<=0` and anything outside the 20x20 quadrant.

**`FindArea()`** = `mask.count() * 4` (whole map after mirroring) must be ≥ 692.

**`CloseOuterBorders()`**: clear row 0 and column 0 of the quadrant (outer map edge stays solid).

**`PrepareInnerBorders()`** (guarantee the quadrant reaches both mirror axes so the four copies connect): for each row `y` (from 19 down): find the right-most masked cell; `hallok[y] = mask(x,y+1) && !mask(x+1,y+1)`. Pick `ry = rnd(19)+1`; advance (wrapping at 20→1) until `hallok[ry]`; then from `x=19` leftwards set `mask(x,ry)` and `mask(x,ry+1)` until an already-masked cell is hit (a 2-wide corridor to the right axis). Repeat for columns (2-wide corridor down to the bottom axis).

**`MirrorDungeonLayout()`**: `mask(x,y)` → also `(x, 39-y)`, `(39-x, y)`, `(39-x, 39-y)`.

**`MakeDmt()`**: `val = m(x+1,y+1)<<3 | m(x,y+1)<<2 | m(x+1,y)<<1 | m(x,y)`; `dungeon = L4ConvTbl[val]`.

**`FixTilesPatterns()`**: several hundred lines of neighbour rewrite rules producing inner/outer wall tiles 7–30 (same spirit as A).

**`AddWall()`**: start tiles for horizontal carving `{10,12,13,15,16,21,22}`, vertical `{8,9,11,14,15,16,21,23}`; a run of floor(6) flanked by floor must be **longer than 3** and end on an appropriate tile; `HorizontalWall` rewrites start/end tiles to junction variants, fills with wall 2 (or 1 vertical), then places a **3-cell doorway** at `rnd(len-3)+1`: tiles `57,60,56` (with `58/59` decorations on the far side if floor) — vertical: `53,6,52` with `54/55`.

**Level 16 specifics**: `ProtectQuads()` protects a 14x14 block at `L4Hold` and its three mirrors; `LoadArenaQuads(pre)` stamps four authored quadrant maps at `Q1 = L4Hold+(4,4)`, `Q2 = (27-hx, 1+hy)`, `Q3 = (1+hx, 27-hy)`, `Q4 = (28-hx, 28-hy)` using the "b" (opened) variants during layout — which end up in `pdungeon` — and the "a" (closed) variants into the live map after the copy; objects loaded from the quadrant maps become levers with map ranges pointing at the *next* quadrant (`LoadMapObjects(arena_q1, Q1, {Q2, 11x12}, leverId 1)`, `(arena_q2_closed, Q2, {Q3, 11x11}, 2)`, `(arena_q3_closed, Q3, {Q4, 9x9}, 3)`), and a lever only fires when *all* levers with its id are pulled.

**Level 15 gate**: stairs down are replaced by the 5x5 open-gate stencil; its position is stored as the final-boss quest position; after layout, if the gate is not yet open (single player and betrayer quest not active/done) the sealed 5x5 is stamped over it; the 5x5 is flagged `Populated` and the north-most gate tile becomes the betrayer-portal position.

**Stairs**: up 4x5 → `world+(6,6)`; down 5x5 → `world+(7,5)` (none on 15/16; on the champion-room quest level the down stairs are inside the set piece at `SetPiece.world+(7,7)`); level 13 town shortcut 4x5 → `world+(6,6)`.

**Finishing**: `GeneralFix` (one junction rule), theme rooms `min 7, max 10, floor 6, freq 8 (1/8 of candidates), random sizes`; `ApplyShadowsPatterns` (floor left/upper-left of tiles 3/4/8/15 → 47/48); `FixCornerTiles` (tiles 18–30 with a lower-id neighbour to the right or below get `+98`); `Substitution` (1/3 of cells swapped within decoration group, then 1/10 of floor cells → 95/96/97). Pass-3 base = 30. Theme rooms on tileset 4 finally **collapse all transparency ids to 1** (`UpdateL4Trans`) because open hell halls should not fade.

### Reference tuning values

| Parameter | Value |
|---|---|
| Quadrant | 20x20; final 40x40 4-way mirror |
| Seed room | 2..6 per axis (14x14 on final level, 11x11 on quest levels) |
| Min area | 692 (after x4) |
| Orientation flip chance | 3/4 |
| Wall carve min run | > 3 cells |
| Doorway width | 3 tiles |
| Theme rooms | 7..10, floor 6, 1/8 candidate rate, random size |
| Decoration swap | 1/3 per cell; floor variant 1/10 |
| Arena quadrant maps | 4, offsets `(+4,+4)`, `(27-hx,1+hy)`, `(1+hx,27-hy)`, `(28-hx,28-hy)` |
| Stair tries | 199 |

### Smallest buildable chunks

1. **Quadrant mask + seed room placement rule** — done when seed room lies in the middle band for all sizes.
2. **Room tree with 75% flip and quadrant bounds** — reuse A's `GenerateRoom` with parameters.
3. **Outer border close + area gate (x4)** — done.
4. **Axis-reach corridors (`PrepareInnerBorders`)** — done when the quadrant always touches both inner axes (assert after mirroring that the 4 copies are one component).
5. **4-way mirror** — trivial.
6. **Mask→tile with D's bit order and table** — done against golden.
7. **Rewrite rule table** — data-driven; done when validator passes.
8. **Quest/arena protection rectangles** — done.
9. **Wall carver with 3-tile doorways and junction rewrites** — done when every carved wall has one 3-wide opening.
10. **Authored quadrant stamping (pre/live pair)** — done when `pdungeon` holds the open variant and the live map the closed.
11. **Lever chain (ids 1..3, "all levers of id" rule)** — done when pulling levers opens quadrants in order.
12. **Sealed/open gate stencil swap on the penultimate level** — done when quest state toggles the stencil and a trigger appears only when open.
13. **Random-size theme rooms + transparency collapse** — done.
14. **Shadow/corner/substitution passes** — done.

### Pitfalls / design lessons

* Mirroring gives dramatic symmetric layouts cheaply but makes the player's start look like 3 other places; the generator compensates with asymmetric decoration/substitution.
* The axis-reach step is mandatory: without it the four copies can be disconnected.
* Keeping "closed" and "opened" authored maps as two files and copying the opened one into `pdungeon` is the whole scripting system for the final arena — no event code beyond `ObjChangeMap`.
* Hell has no wall traps (`AddObjTraps` skipped) and `Populated` 5x5 around the gate; remember such tier-specific exclusions.

---

## Themed rooms

### Purpose
After layout, a handful of rooms per level are converted into "themed" rooms: enclosed side rooms with a specific furnishing recipe (barrel room, altar room, library, treasure room, armour/weapon racks, fountains, torture room, skeleton lair, goat altar, cauldron, burning crosses, monster pit). Themes drive which object graphics load, add a few extra monsters, and reserve the room from random spawns.

### Key data structures

```
struct THEME_LOC { Rectangle<uint8> room; int8 ttval; }   // mega rect + transparency id (generators B/C/D)
THEME_LOC themeLoc[50]; int themeCount;
struct ThemeStruct { theme_id ttype; int8 ttval; }        // final list used at population
ThemeStruct themes[50]; int numthemes;
enum theme_id { BARREL, SHRINE, MONSTPIT, SKELROOM, TREASURE, LIBRARY, TORTURE, BLOODFOUNTAIN,
  DECAPITATED, PURIFYINGFOUNTAIN, ARMORSTAND, GOATSHRINE, CAULDRON, MURKYFOUNTAIN, TEARFOUNTAIN,
  BRNCROSS, WEAPONRACK }   // 17 types
```
One-shot flags per level: `armorFlag`, `weaponFlag`, `cauldronFlag`, `bFountainFlag`, `mFountainFlag`, `pFountainFlag`, `tFountainFlag`, `treasureFlag` (each such theme at most once per level); `questLibraryIndex` = index of the library reserved for the mad-mage quest.

### Algorithms & rules

**Room carving (`DRLG_PlaceThemeRooms(min, max, floor, freq, rndSize)`)** — generators B/C/D only, after layout:

1. Scan the logical grid; for each `floor` cell with `rnd(freq)==0` (`freq 0` = always), compute `GetSizeForThemeRoom(floor, origin, min, max)`: starting at origin, grow the widest/tallest all-floor rectangle up to `max` per axis (with a deliberately odd bounds check that avoids the lower-right corner), fail if either dimension falls below `min` early, return `size - 2`. Also fail if `IsNearThemeRoom(origin)` (any existing theme rect grown by 2 on each side).
2. If `rndSize` (tileset 4): `width = (min-2) + rnd(rnd(width-(min-2)+1))` (biased toward small), clamped to `[min-2, max-2]`; same for height.
3. `theme.room = {origin + South(1,1), size}`; assign a fresh transparency id: tilesets 3/5 use a world rect `((pos+South).world, size*2-5)`, others `DRLG_MRectTrans(pos, size-1)`; `ttval = TransVal-1`.
4. `CreateThemeRoom(i)`: overwrite the rect: top/bottom rows = horizontal wall, left/right = vertical wall, interior = floor, 4 corner tiles, and **one door** on either the right wall middle or the bottom wall middle (coin). Per-tileset tile ids: T2 walls 2/1 floor 3 corners 8/7/9/6 doors 4/5; T3/T5 walls 134/137 floor 7 corners 150/151/152/138 doors 147/146; T4 walls 2/1 floor 6 corners 9/16/15/12 and 3-tile doorways `53,6,52 (+54)` or `57,6,56 (+59,58)`.

**Theme assignment (`InitThemes()`)** — at level population, after monster types are chosen:

* Skipped entirely on level 16, tileset 5 and tileset 6.
* Tileset 1 has no carved theme rooms; instead every transparency region `i` is tested with `CheckThemeRoom(i)`: no stair trigger inside, no `Populated` cell, `9 <= area <= 100` world cells, and every non-solid cell's 4-neighbours that are non-solid belong to the same region (fully enclosed room). Each passing region becomes a theme.
* Tilesets 2/3/4 take `themeLoc[]` as given. If the mad-mage quest is available, the first room that fits a library becomes the quest library (`questLibraryIndex`).
* Type choice per room: `j = ThemeGood[rnd(4)]` where `ThemeGood = {GOATSHRINE, SHRINE, SKELROOM, LIBRARY}`; `while (!SpecialThemeFit(room, j)) j = rnd(17)`. So the four "good" themes are heavily favoured; everything else fills in when they don't fit.
* `SpecialThemeFit` = `CheckThemeReqs` (tileset/flag gating) + a fit test, and clears the one-shot flag on success:

| Theme | Allowed tilesets | Fit test | One-shot |
|---|---|---|---|
| SHRINE, LIBRARY | not 3, not 4 | `TFit_Shrine`: find a floor cell in the room adjacent to a wall with the `Trap` piece flag (i.e. a flat wall face) with both lateral neighbours in-room and no objects | no |
| SKELROOM | 1 or 2 only, and a skeleton-type monster in the level's type list | `TFit_Obj5` (3x3 free area, see below) | no |
| GOATSHRINE | any, needs a goat-type monster in the list | `TFit_Obj5` | no |
| ARMORSTAND, WEAPONRACK | not 1 | `TFit_Obj3` (2x2 free, random skip) | flag per level |
| CAULDRON | 4 only | `TFit_Obj5` | yes |
| BLOOD/PURIFYING/MURKY/TEAR fountains | any | `TFit_Obj5` | yes each |
| TREASURE | any | none | yes |
| BARREL, MONSTPIT, TORTURE, DECAPITATED, BRNCROSS | any | TORTURE/DECAP/BRNCROSS use `TFit_Obj3` | no |

`TFit_Obj5(t)`: `target = rnd(5)`; scan the map for in-region, non-solid cells whose 3x3 neighbourhood is non-solid and all in-region; return the `(target+1)`-th such cell (or the last found). `TFit_Obj3(region)`: first cell whose 2x2 is in-region, non-solid, object-free, with a per-tileset random skip `objrnd = {4,4,3,5}` (1/n chance to reject each candidate).

**Reservation**: `HoldThemeRooms()` marks every theme room cell `Populated` (T1: all cells of the region; others: the rect minus 1) before objects/monsters/items spawn.

**Furnishing (`CreateThemeRooms()`)** — after monsters and items. Per theme (`lt` = tileset index 0..3 for T1..T4):

| Theme | Recipe |
|---|---|
| BARREL | every in-room floor cell: with `1/barrnd[lt]` (`{2,6,4,8}`) place a barrel; explosive with `1/barrnd` else normal. Monsters `1/{5,7,3,9}` |
| SHRINE | altar object at the fit spot (left/right wall variant per `found` orientation) flanked by two candles. Monsters `1/{6,6,3,9}` |
| MONSTPIT | one random item (`CreateRndItem(onlygood=true)`) at the `rnd(100)+1`-th in-room floor cell (wrapping scan). Monsters `1/{6,7,3,9}` |
| SKELROOM | skull-fire brazier at centre; around it at 8 offsets either a banner object (`1/monstrnd` `{6,7,3,9}`) or a pre-spawned skeleton; a skeleton always N and S; skeleton tomes 2 cells N and S if free |
| TREASURE | each floor cell: `1/treasrnd[lt]` (`{4,9,7,10}`) gold pile; `rnd(treasrnd)==0` random item; (a buggy "halve last gold" rule outside T1). Monsters `1/{6,8,3,7}` |
| LIBRARY | bookcase + 2 candles at the shrine-fit spot; each 2x2-free cell with `1/librnd[lt]` (`{1,2,2,5}`) a book stand, and with `!(1/(2*librnd))` the stand is pre-emptied (non-interactive, frame+2). No monsters if this is the quest library; else `1/{5,7,3,9}` |
| TORTURE | each 2x2-free cell `1/{6,8,3,8}` tortured-body object. Monsters `1/{6,8,3,9}` |
| BLOODFOUNTAIN / PURIFYINGFOUNTAIN / MURKYFOUNTAIN / TEARFOUNTAIN | one fountain object at the 3x3-fit spot (large fountains occupy 2x2). Monsters `1/{6,8,3,9}` or `1/{6,7,3,9}` |
| DECAPITATED | each 2x2-free cell `1/{6,8,3,8}` corpse object. Monsters `1/{6,8,3,9}` |
| ARMORSTAND / WEAPONRACK | if the level's one-shot flag is still set: one interactive stand at a 2x2-fit spot; then each 2x2-free cell `1/{6,8,3,8}` (racks `{6,8,5,8}`) a decorative non-interactive stand. Monsters `1/{6,7,3,9}`; clears the flag |
| GOATSHRINE | goat-altar at the 3x3 spot; a goat-type monster on every free in-room cell of the surrounding 3x3 |
| CAULDRON | cauldron at 3x3 spot. Monsters `1/{6,7,3,9}` |
| BRNCROSS | each 2x2-free cell `1/{5,7,3,8}` burning cross. Monsters `1/{6,8,3,9}` |

`PlaceThemeMonsts(t, f)`: pick one random monster type among the level's types flagged `PLACE_SCATTER`; on every in-room, non-solid, item-free, object-free cell with probability `1/f` spawn one (random facing). Tileset 4 finally sets all transparency ids to 1.

### Reference tuning values

| Parameter | T2 | T3 | T4 |
|---|---|---|---|
| Theme room min/max (pre -2) | 6/10 | 5/10 | 7/10 |
| Candidate rate | every floor cell | every | 1/8 |
| Random size | no | no | yes |
| T1 region area bounds | 9..100 world cells | | |
| Preferred themes | goat altar, altar, skeleton lair, library (each 25% first pick) | | |
| Max themes per level | 50 | | |

### Smallest buildable chunks

1. **Largest-floor-rectangle finder** from an origin with min/max — done when returns `size-2` and rejects near existing rooms.
2. **Theme room carving** (walls, corners, one door, per-tileset tile ids) — done when the room is enclosed with exactly one opening.
3. **Transparency id per theme room** — done.
4. **Enclosure test for tileset-1 regions** (`CheckThemeRoom`) — done when corridor regions are rejected and closed rooms accepted.
5. **Theme requirement table + one-shot flags** — data; done.
6. **Fit finders** `TFit_Shrine` (wall-face), `TFit_Obj5` (3x3), `TFit_Obj3` (2x2 with random skip) — done with unit grids.
7. **Type assignment loop** (4 preferred then random 17) — done when it terminates for all rooms (needs at least one always-fitting theme: BARREL/MONSTPIT/TREASURE).
8. **Reservation (`HoldThemeRooms`)** — done when random spawns avoid theme rooms.
9. **Per-theme furnishing recipes** (17 small functions reading the per-tileset frequency tables) — done one by one against counts.
10. **Scatter-monster placer** — done.
11. **Quest library reservation** — done when the quest level always has a library when the quest is active.

### Pitfalls / design lessons

* "Theme = transparency region" is elegant for tileset 1 but needs the enclosure test, else corridors become barrel rooms.
* Preferring 4 "good" themes and falling back to random 17 means fountains/cauldron/treasure are rare; tune by changing the preferred list, not the fit tests.
* One-shot flags are per level and consumed at *fit* time, not at furnishing time — a room that later fails to furnish still burns the flag.
* Furnishing happens after items/monsters so theme objects never overlap them; the room was reserved earlier so the reverse is also true.

---

## Stairs, triggers & level transitions

### Purpose
Triggers are the walk-on tiles that move the player between levels: staircases (up/down), town shortcut stairs, quest portals into fixed sub-levels, return tiles out of them, and the town's dungeon entrances. The system also provides the hover text/targeting for stairs and enforces unlock rules.

### Key data structures

```
struct TriggerStruct { WorldTilePosition position; interface_mode _tmsg; int _tlvl; };
TriggerStruct trigs[7]; int numtrigs; bool trigflag; int TWarpFrom;
enum interface_mode (subset) { MSG_NEXTLVL, MSG_PREVLVL, MSG_RTNLVL, MSG_SETLVL,
  MSG_WARPLVL, MSG_TOWNWARP, MSG_TWARPUP, MSG_RETOWN, MSG_NEWGAME, MSG_LOADGAME };
enum lvl_entry { ENTRY_MAIN, ENTRY_PREV, ENTRY_SETLVL, ENTRY_RTNLVL, ENTRY_LOAD, ENTRY_WARPLVL, ENTRY_TWARPDN, ENTRY_TWARPUP };
struct TownTrigger { Point position; interface_mode msg; int level; optional<dungeon_type> warpGate; };
struct TownEntryPoint { lvl_entry entryType; Point viewPosition; int warpFromLevel; };
```
Per tileset, static lists of **piece ids** that constitute stair sprites (`L1UpList`, `L1DownList`, `TownDownList`, …) are used both to find the trigger cell after generation and to recognise the cursor hovering a staircase.

### Algorithms & rules

1. **Finding triggers** (`InitL1Triggers` … `InitCryptTriggers`, called right after `CreateDungeon`): scan all 112x112 cells; a specific piece id marks the walk-on cell of each stair type (e.g. T1: 128 = up, 114 = down; T2: 266 up (skipping the vault-portal cell), 270 down, 558 town shortcut; T3: 170/167/548; T4: 82/119/421 and 369 = open gate to the final level only when the betrayer quest is done; T5: 65/62/79; T6: 157/125/183). Set `_tmsg` accordingly (`PREVLVL`, `NEXTLVL`, `TWARPUP` with `_tlvl = 0`). `trigflag=false`.
2. **Town triggers**: iterate `TownConfig.triggers`; skip gated ones whose `IsWarpOpen(tier)` is false; copy position/msg/level. Max 7.
3. **`IsWarpOpen(type)`**: demo build → false; multiplayer → true except the hive (its opening is a quest); single player → bit `1 << (tier-2)` of `pTownWarps` (set in `StartNewLvl` when the player takes a `TWARPUP` staircase from that tier); expansion: character level ≥ 10/15/20 opens tiers 2/3/4; tier 5 opens when the farmer quest state is DONE/HIVE_DONE; tier 6 when the grave quest is DONE.
4. **Reservation**: `Freeupstairs()` flags a 5x5 `Populated` block around each trigger so nothing spawns on stairs.
5. **Walk-on check (`CheckTriggers`)** each tick: only if `player._pmode == PM_STAND` and `position.tile == trig.position`. `NEXTLVL` → `StartNewLvl(player, msg, level+1)` (demo build refuses beyond level 2 and steps the player back); `PREVLVL` → `level-1`; `RTNLVL` → `GetMapReturnLevel()`; `TOWNWARP` → in multiplayer enforce character level 8 (`_tlvl==5`), 13 (`_tlvl` 9 or 17), 17 (`_tlvl` 13 or 21) else push the player one tile off the trigger with a message; `TWARPUP` → `TWarpFrom = currlevel`, go to level 0.
6. **`StartNewLvl(player, msg, lvl)`**: `InitLevelChange`; set the player's level (`setlvlnum` for `SETLVL`); for `TWARPUP` set `pTownWarps |= 1 << (leveltype-2)`; set `_pmode = PM_NEWLVL`, invincible, push an SDL custom event with the message; multiplayer sends `CMD_NEWLVL(msg, lvl)`.
7. **Entry → spawn position** (set by generators / town config while generating):

| Entry | Meaning | Spawn |
|---|---|---|
| `ENTRY_MAIN` | came down from level-1 | next to the **up** stairs (per-tileset offset from the stencil origin) |
| `ENTRY_PREV` | came up from level+1 | next to the **down** stairs (or inside the quest set piece when stairs are in it) |
| `ENTRY_TWARPDN` | took a town shortcut down | next to the shortcut stairs |
| `ENTRY_TWARPUP` | arrived in town via shortcut | town entry matching `TWarpFrom` (levels 5/9/13/17/21 → fixed town points) |
| `ENTRY_RTNLVL` | returned from a sub-level | `GetMapReturnPosition()` = quest portal position + one step (SE/SW/S per quest) |
| `ENTRY_SETLVL` | entering a sub-level | the map's authored view position |
| `ENTRY_WARPLVL` | via town portal | `GetPortalLvlPos()` |
| `ENTRY_LOAD` | loading a save | saved position |

8. **Quest portals** are *not* in `trigs[]`: `CheckQuests()` compares the standing player against `Quests[i].position` for quests with `_qslvl != 0` on their level and calls `StartNewLvl(MSG_SETLVL, _qslvl)` (setting `setlvltype` from the quest). The betrayer portal additionally requires `_qvar1 >= 3`. Inside a sub-level a single hard-coded return trigger (`MSG_RTNLVL`) is placed (e.g. `(82,42)`, `(70,39)`, `(30,83)`, `(35,32)`) and arenas get one `exitTrigger`.
9. **Hover/targeting (`CheckTrigForce`)**: if the cursor's piece id is in the tileset's up/down/shortcut list, set the info string ("Up to level N", "Down to level N", "Up to town", "Down to <sub-level name>") and snap the cursor to the trigger cell; some tilesets require the matching trigger within 4 cells (|dx|<4 && |dy|<4) because the stair sprite spans several cells; T3/T5 "down" also checks the two cells to the right. `ForceQuests()` snaps to a quest portal when the cursor is within a 7-cell "entrance boundary" shape `{(0,0),(-1,0),(0,-1),(-1,-1),(-2,-1),(-1,-2),(-2,-2)}` relative to the portal.

### Reference tuning values

| Item | Value |
|---|---|
| Max triggers per level | 7 |
| Populated halo around triggers | 5x5 |
| Shortcut MP level gates | 8 (tier 2), 13 (tiers 3,5), 17 (tiers 4,6) |
| Expansion SP shortcut unlock by char level | 10 / 15 / 20 for tiers 2/3/4 |
| Hover snap distance for multi-cell stairs | < 4 cells |
| Town entry points | main `(75,68)`; from level 1 `(25,31)`; shortcut arrivals from 5/9/13/21/17 at `(49,22)`, `(18,69)`, `(41,81)`, `(36,25)`, `(79,62)` |
| Town triggers | down `(25,29)`; shortcuts `(49,21)`→5, `(17,69)`→9, `(41,80)`→13, `(80,62)`→17, `(36,24)`→21 |

### Smallest buildable chunks

1. **Trigger struct, message enum, entry enum** — done.
2. **Piece-id lists per tileset and trigger scan** — done when every generated level yields exactly one up and one down (except tier ends).
3. **Town trigger table with gating predicate** — done when toggling `pTownWarps` bits adds/removes triggers.
4. **`IsWarpOpen` rules (SP bits, MP, expansion level/quest gates)** — table-driven; done.
5. **Trigger halo reservation** — done.
6. **Walk-on dispatcher** with MP level gating and push-back — done.
7. **`StartNewLvl` + custom event + network command** — done when level changes round-trip in MP.
8. **Entry→spawn mapping** stored during generation — done when all 8 entries place the player on a walkable cell adjacent to the right stairs.
9. **Quest portal walk-on and return trigger** — done when enter/return positions match.
10. **Cursor snapping/hover text** incl. the 7-cell entrance boundary — done.

### Pitfalls / design lessons

* Triggers are discovered by scanning for sprite piece ids after generation — robust against any generator change but couples code to art ids; a new engine should have generators *emit* trigger records directly.
* Spawn positions are stencil-relative constants per tileset; put them next to the stencil definitions.
* The town shortcut unlock is per-player state in SP but global in MP; decide early which.

---

## Fixed set-piece maps & quest-area stamping

### Purpose
Hand-authored content enters random levels in two ways: whole **fixed sub-levels** (boss lair, spell vault, poisoned cave, betrayer lair, PvP arenas) loaded as their own level, and **quest set pieces** stamped into a random level (slaughter room, inn-sign room, hidden halls, pedestal room, anvil island, champion room, vault/cornerstone rooms, final arena quadrants).

### Key data structures
`_setlevels { NONE, BOSS_LAIR(T1), SPELL_VAULT(T2), MAZE(unused), POISON_CAVE(T3), BETRAYER_LAIR(T1), ARENA_CHURCH(T1), ARENA_HELL(T4), ARENA_CIRCLE(T4) }`; `setlvltype`; `QuestLevelNames[]`; per-quest `.dun` pairs; `SetPiece` rectangle; `ReturnLevel/ReturnLvlPosition/ReturnLevelType`.

### Algorithms & rules

**Sub-level load (`LoadSetMap()`)**:

1. Optionally advance the quest (boss lair: `INIT → ACTIVE, _qvar1=1`; poisoned cave: `INIT → ACTIVE`; betrayer lair: `_qvar2 = 3 or 4` by quest state).
2. `LoadPre*Dungeon(preMap)` → `pdungeon` (the "opened" state), `Load*Dungeon(liveMap, spawn)` → `dungeon`+`dPiece` with monsters and objects from the map layers, `SetMapTransparency(transMap)` (a dedicated transparency `.dun`), custom palette, then hard-coded object wiring (`AddSKingObjs`: a 3x3 secret room lever id 1 at `(64,34)`, a gate lever id 2 at `(64,59)`, four levers id 3 at fixed positions all opening a 7x10 region; `AddSChamObjs`: two books opening two regions; `AddVileObjs`: two books + a stand opening three regions) and the single return trigger.
3. Arenas: `LoadArenaMap(path, viewPos, exitTrigger)`; tileset chosen by `GetArenaLevelType`.
4. `LoadDungeonBase` fills `dungeon` with the tileset's dirt tile first so the map can be smaller than 40x40.

**Quest stamping inside random levels** happens in two phases:

*Phase 1 — during layout (`InitSetPiece` per generator)*, only if `Quests[q].IsAvailable()` (quest active-or-init, on its level, not a sub-level, not SP-only in MP):

| Generator | Quest | File stamped into live map | Where |
|---|---|---|---|
| A | slaughter room | `slaughter_room` | random present chamber (`SelectChamber`) |
| A | boss-lair portal room (SP only) | `lair_portal_room` | random chamber |
| A | inn-sign room | `inn_sign_room_closed` | random chamber |
| A (crypt) | final vault (level 24) / cornerstone room | `vault_room` / `cornerstone_room` | random chamber |
| B | hidden halls (L7) | `hidden_halls_room` | `SetPieceRoom.position` (reserved 15x15) |
| B | pedestal room (L5) | `pedestal_room_open` | reserved 14x20 |
| B | spell-vault portal room (L6) | `vault_portal_room_open` | reserved 10x10 |
| C | anvil island (L10) | `anvil_island` | random all-floor area + 1 border |
| D | champion room (L13) | `champion_room_open` | `SetPieceRoom.position` (11x11 reserved) |
| D | betrayer altar room (L15, MP only) | `traitor_altar_room` | reserved 11x11 |
| D | final arena (L16) | `arena_q1`, `arena_q2_open`, `arena_q3_open`, `arena_q4_open` | four quadrants |

*Phase 2 — after `memcpy(pdungeon, dungeon)` (`DRLG_CheckQuests(position)`)*: establish the "other" state and the quest position:

| Quest | Action |
|---|---|
| slaughter room | re-assign the room's 7x7 interior a transparency rect (legacy no-op) |
| inn sign | write `inn_sign_room_open` **into `pdungeon`** only |
| hidden halls | seal two outer wall cells with tile 154 in the live map (so `pdungeon` keeps the openings) |
| pedestal room | stamp `pedestal_room_closed` over the live map; `pdungeon` keeps `pedestal_room_open` |
| champion room | stamp `champion_room_closed` over the live map; `SetPiece` = its size |
| boss lair portal | `Quests[q].position = SetPiece.world + (12,7)` |
| spell vault portal | stamp `vault_portal_room_closed` live; `position = SetPiece.world + (6,7)` |
| poisoned cave entrance | stencil (6x6) during stairs; `position = world + (5,6)`; its 5x2 pit gets transparency 0 |
| final arena | after the copy, stamp the `a` (closed) quadrant variants into the live map |

**Opening at runtime**: a lever/book/pedestal/crux calls `ObjChangeMap(x1,y1,x2,y2)` (mega coords): copy `pdungeon` → `dungeon` in the rect, re-expand each mega tile into `dPiece` (`ObjSetMini`), recompute overlay pieces (`ObjL1Special`/`ObjL2Special`), re-add door objects found in the new tiles (`AddL1Objs` etc.), and re-sync door states. The region's monsters/objects were pre-spawned from the authored map's object layer with the same `leverId` (`LoadMapObjects(path, start, mapRange, leverId)`), e.g. the pedestal room loads its hidden objects when the third stone is placed.

**Multiplayer resync**: `ResyncQuests()` re-applies the opened regions from `_qvar1/_qvar2` on level load (inn sign stages 1/2/3, betrayer stages ≥4/≥6/≥7, pedestal stones from `_qvar2`, final gate, etc.), so map state is a pure function of quest variables.

### Reference tuning values

| Item | Value |
|---|---|
| Fixed sub-levels | 5 quest (1 unused) + 3 arenas |
| Sub-level spawn points | boss lair `(83,44)`, vault `(70,40)`, cave `(31,83)`, betrayer `(35,36)`; arenas `(29,22)`, `(34,26)`, `(30,26)` |
| Return triggers | `(82,42)`, `(70,39)`, `(30,83)`, `(35,32)`; arenas `(28,20)`, `(33,26)`, `(29,26)` |
| Reserved quest room sizes | 14x20, 10x10, 15x15 (T2); 11x11 (T4); chamber slots (T1) |
| Quest position offsets | boss lair `(12,7)`, vault `(6,7)`, cave `(5,6)` from set-piece world origin |

### Smallest buildable chunks

1. **Sub-level registry** (id → tileset, live map, pre map, transparency map, palette, spawn, return trigger) — data; done when all 8 load.
2. **Pre/live pair loader** — shared with miniset module.
3. **Hard-coded lever wiring per sub-level** (`InitializeLoadedObject(mapRange, leverId)`) — done when levers open the authored regions.
4. **Quest availability predicate** (`IsAvailable`) — done.
5. **Per-generator `InitSetPiece` hook** (file + placement strategy: chamber slot / reserved room / random floor scan) — done per generator.
6. **Post-copy "closed state" stamping (`DRLG_CheckQuests`)** — done when `pdungeon != dungeon` only inside the set piece.
7. **`ObjChangeMap` region restorer** with overlay recompute and door re-add — done when opening a region spawns its doors/monsters once.
8. **Authored-object pre-spawn with lever ids** — done.
9. **Quest-variable → map-state resync** — done when loading a save mid-quest shows the correct opened regions.
10. **Return level/position lookups** — done.

### Pitfalls / design lessons

* Treat every quest room as *two* authored maps (closed/open). The engine never diffs; it just restores a rectangle.
* Reserving the room before layout (B/D) vs stamping into a chamber (A) vs scanning for free floor (C) are three strategies with different failure modes; A/B never fail, C retries the whole level.
* Everything about opened state must be derivable from quest vars for multiplayer/late joiners and saves.

---

## Hub town

### Purpose
Level 0 is a hand-built outdoor hub: four authored map sectors, conditional tiles for sealed/open tier entrances and a quest fountain, NPC spawn points, vendor hooks, a stash, portal anchor slots and the dungeon entrances. It is fully lit and fully revealed.

### Key data structures

```
struct TownSector { string filePath; int x, y; }               // dPiece-space origin of a 2x-expanded .dun
struct TownAssets { cel, til, min, specialCels, sol, palette; microTileLen = 16 }
struct TownConfig { name; saveId; Point dmin{10,10}, dmax{84,84}; assets; vector<TownSector> sectors;
                    vector<TownEntryPoint> entries; vector<TownTrigger> triggers; Point portalPositions[4]; }
TownRegistry { map<id, TownConfig>; currentTownID }           // supports modded alternate towns
```

### Algorithms & rules

1. **`CreateTown(entry)`**: set bounds and `ViewPosition = config.GetEntryPoint(entry, TWarpFrom)`; `DrlgTPass3()`.
2. **`DrlgTPass3()`**: fill all 112x112 with piece 426 (grass filler); `FillSector(file, x, y)` for the four sectors at dPiece origins `(46,46)`, `(46,0)`, `(0,46)`, `(0,0)` — each sector's mega tiles expand to 2x2 pieces, tile 0 → piece 218; stamp the town automap map into the logical `dungeon` (town uses a cave-tileset automap); then conditional edits:
   * tier-2 shortcut closed → `dungeon[20][7]=10, [20][6]=8`, `FillTile(48,20,320)` (a boarded entrance);
   * tier-3 closed → `dungeon[4][30]=8`, `FillTile(16,68,332)`, `FillTile(16,70,331)`;
   * tier-4 closed → `dungeon[15..17][35]=7`, random rubble `FillTile(x,78, 1..4)` for `x=36..45`;
   * expansion: hive open/closed and grave open/closed each rewrite ~40 hard-coded pieces (`TownOpenHive`, `TownCloseHive`, `TownOpenGrave`, `TownCloseGrave`);
   * poisoned-water quest not done → fountain piece 342 at `(60,70)` else 71 (`CleanTownFountain` swaps it live when the quest completes elsewhere).
3. `InitTownPieces()`: mark tree/overlay pieces into `dSpecial` (18 piece ids → 1..18).
4. **Level load (town)**: every cell `Lit`; `InitTowners()`, `InitStash()`, `InitItems()`, `InitMissiles()`; `SetupTownStores()` (restock); whole 40x40 automap revealed with `MAP_EXP_SELF`.
5. **Expansion entrance opening**: `OpensHive(p)` = `79<=x<=82 && 61<=y<=64`; `OpensGrave(p)` = `35<=x<=38 && 20<=y<=24` — used when the player activates a bomb/map item at that spot; `OpenHive()/OpenGrave()` set the corresponding quest DONE, broadcast, and rewrite the tiles.
6. **Portal anchors**: four fixed cells `(57,40)`, `(59,40)`, `(61,40)`, `(63,40)` (one per player slot).
7. Default spawn when no entry matches: `(75,68)`.

### Reference tuning values

| Item | Value |
|---|---|
| Playable bounds | `(10,10)`–`(84,84)` world cells |
| Sectors | 4 authored maps at dPiece origins `(46,46)`, `(46,0)`, `(0,46)`, `(0,0)` |
| Filler piece | 426 (grass); empty sector cell → piece 218 |
| Portal anchors | `(57,40)`, `(59,40)`, `(61,40)`, `(63,40)` |
| Default spawn | `(75,68)` |
| Fountain piece | 342 (foul) / 71 (clean) at `(60,70)` |
| Hive-opening region | `x 79..82, y 61..64`; grave-opening region `x 35..38, y 20..24` |
| Entry points / triggers | see *Stairs, triggers & level transitions* |

### Smallest buildable chunks

1. **TownConfig/registry data model** — done when a second town can be registered and selected.
2. **Sector stamper (`FillSector`)** at dPiece origins with filler piece — done when the 4 sectors tile seamlessly.
3. **Conditional tile patches** (sealed vs open entrances, fountain) as data: `{condition, list of (x,y,piece)}` — done when toggling unlock bits changes the map.
4. **Town automap stamp** — done.
5. **Overlay tagging (trees)** — done.
6. **Entry-point and trigger tables** — shared with triggers.
7. **Portal anchor slots** — done.
8. **Region predicates for quest-item use** (`OpensHive/Grave`) — done.
9. **Town load sequence** (lit, NPCs, stash, stores restock, reveal) — done.

### Pitfalls / design lessons

* Town conditional tiles are raw piece-id edits in code — the single worst place for content coupling; express them as patch lists in the town data.
* Restocking vendors *every time the town loads* is a deliberate loop; the stock level formula (highest level visited) is the pacing knob.

---

## Interactive objects

### Purpose
Objects are the static-but-stateful things in a level: doors, chests, barrels, sarcophagi, levers, books, altars (shrines), fountains, racks, traps, decorations and quest props. They occupy cells, block or allow movement/missiles, animate, emit light, hold deterministic loot seeds, and some of them rewrite the map when used.

### Key data structures

```
struct ObjectData {              // one row per object type (110 rows in the TSV)
  object_graphic_id ofindex;     // which sprite file (65 files max; 40 loaded per level)
  int8 minlvl, maxlvl;           // auto-load graphics when currlevel in [min,max] (0 = never by level)
  dungeon_type olvltype;         // auto-load when tileset matches (doors, braziers)
  theme_id otheme;               // auto-load when a theme of this kind exists on the level
  quest_id oquest;               // auto-load when that quest IsAvailable()
  flags: Animated | Solid | MissilesPassThrough | Light | Trap | Breakable;
  uint8 animDelay, animLen, animWidth;
  SelectionRegion selectionRegion;   // Bottom | Middle | Top sprite bands that are clickable (None = inert)
};

struct Object {
  _object_id _otype; bool applyLighting, _oTrapFlag, _oDoorFlag;
  Point position; anim: data, flag, delay, cnt, len, frame, width;
  bool _oDelFlag; int8 _oBreak (0 unbreakable, 1 intact breakable, -1 broken);
  bool _oSolidFlag, _oMissFlag (missiles pass), _oPreFlag (draw before player), SelectionRegion selectionRegion;
  int _olid (light id); uint32 _oRndSeed (loot seed);
  int _oVar1.._oVar5, uint32 _oVar6, int _oVar8;   // per-type scratch (see below)
  _speech_id bookMessage;
};
Object Objects[127]; int AvailableObjects[127], ActiveObjects[127], ActiveObjectCount;
```

Per-type meaning of the scratch vars:

| Type | `_oVar1` | `_oVar2` | `_oVar3` | `_oVar4` | `_oVar5/6/8` |
|---|---|---|---|---|---|
| door | closed-door piece id +1 | piece id +1 of the cell the open door overlaps | | door state 0 closed / 1 open / 2 blocked | |
| chest | item count | `rnd(8)` (0 = "useful" loot) | | trap missile kind | |
| barrel | 0 | `rnd(10)` loot class | `rnd(3)` | hidden skeleton monster id or -1 | |
| sarcophagus | `rnd(10)` | hidden skeleton id | | | |
| wall trap | trigger x | trigger y | missile id | fired (0/1) | |
| flame trap / lever | trap group id | 0/1 disabled | 2 = horizontal | active | |
| lever / crux / book lever | map rect x1 | y1 | x2 | y2 | `_oVar6` = open-book frame, `_oVar8` = lever id |
| shrine | shrine kind | | | | |
| pedestal | set-piece rect | | | | `_oVar6` = stones placed |
| story book | variant 0..2 | speech id | title index | open frame | `_oVar8` = tome slot (6/7/8) |
| light | -1 (static) / 0 off / 1 on | | | | |
| magic circle | map rect | | | | `_oVar5` books read, `_oVar6` circle state |

### Algorithms & rules

**Allocation (`AddObject(type, pos)`)**: if `ActiveObjectCount >= 127` return null; pop an index from `AvailableObjects`, `dObject[pos] = idx+1`, `SetupObject` copies the data row (random initial anim frame/counter for animated objects; `_oAnimDelay = 1000` for static ones so they never advance), then a per-type init (below), then `AddObjectLight`. Large objects write `-(idx+1)` into their extra cells (sarcophagus: cell north; large fountains: 2x2; mushroom patch: 3 extra cells).

**Graphics loading (`InitObjectGFX`)**: pick sprite files by `minlvl..maxlvl`, tileset, active themes and available quests (plus lore book/candle on levels 4/8/12); wall traps are excluded on tileset 4; fixed maps load only what their object layer references.

**Population (`InitObjects`)** — in this order, after `HoldThemeRooms`, before monsters/items:

1. Level 16: only the arena quadrant objects (`AddArenaObjs`).
2. Else: consume 1 RNG value; level 9 (SP): slain-hero corpse; mushroom quest: 3x3 mushroom patch; levels 4/8/12: a lore book with 6 candles; expansion levels 21/22/23: 1/2/2 lore books; level 24: the vault lever + 3 tomes in one of 6 orders.
3. Per tileset: T1 → quest props (torture racks around piece 366 for the slaughter room, 4 candles around the cave entrance, sign chest at `SetPiece.world+(10,3)`), **10–14 sarcophagi** (3x4 free area), doors from pieces (`43/50/213` left, `45/55` right), barrels; T2 → rock stand (5x5 free) / vault book (5x5 free) for their quests, doors (`12/540` left, `16/541` right), wall torches, hidden-halls book lever + pre-spawned hidden objects, pedestal-room book lever (fixed spot `SetPiece.world+(9,24)`) + pedestal (`+(9,16)`), barrels; T3 → doors (`530/533`), barrels; T4 → champion-room tome lever + pre-spawned room objects, betrayer stand (6x7 free; SP), barrels, "goodies" (hooked bodies on walls 1/6 of eligible wall cells, 2–5 each of 7 body types + decapitated, 1–2 cauldrons); T5 → pods (barrels); T6 → 10–14 sarcophagi, doors (`76/79`), urns.
4. **Chests**: 5–9 small, 3–5 medium, 1–4 large (`rnd(max-min)+min`, 3x3 free area, up to ∞ tries), each anywhere in the 80x80.
5. **Wall traps** (not T4) and **chest traps** (T2/T3/T4/T5 only).

Placement helper `RndLocOk(p)`: no monster/player/object, not `Populated`, not solid, and on T1/T6 not a piece in `126..142` (stair/arch pieces). `GetRandomObjectPosition(standoff)` tries up to 20001 random cells for a `(2s+1)^2` free area.

**Door state machine** (`_oVar4`): `CLOSED` → `OpenDoor` (frame += 2, `SetDoorStateOpen`: `_oPreFlag=true`, `_oMissFlag=true`, selection = Middle, swap the door piece to the open piece and update the overlapping neighbour piece (`DoorSet` table) and overlay) ↔ `CloseDoor` (frame -= 2, restore both pieces from `_oVar1/_oVar2`). Each tick an open door becomes `BLOCKED` while a corpse/monster/item/player occupies its cell, else `OPEN`. Closing is refused while blocked (plays the close sound). Monsters adjacent to a closed door open it (`MonstCheckDoors`). Walkability: a closed door is a solid object; `IsTileWalkable(ignoreDoors=true)` lets path-finding treat doors as passable so monsters/players path through and open them.

**Chests**: `AddChest`: 50% alternate closed sprite; `_oRndSeed = AdvanceRndSeed()`; count by size (`rnd(2)`, `rnd(3)`, `rnd(4)`; fixed 1/2/3 on sub-levels); `_oVar2 = rnd(8)`. `OperateChest`: seed RNG with `_oRndSeed`; spawn `count` items — on sub-levels always "good" random items; otherwise `_oVar2 != 0` → random item, `== 0` → "useful" (potion/scroll class); if trapped fire the trap missile at the player (`0 arrow, 1 fire arrow, 2 nova, 3 ring of fire, 4 steal potions, 5 steal mana`) and clear the trap flag. `AddChestTraps`: each untrapped chest 10% → trapped; kind `rnd(2)` on T2, else `rnd(3)` (`rnd(6)` expansion). A reroll altar can re-close chests with new seeds.

**Barrels / pods / urns** (`InitRndBarrels`): `rnd(5)+3` groups; first barrel explosive with 1/4, later ones 1/5; group grows while `rnd(p)==0` with `p = count/2` (so 1st extra barrel always, then 1/1, 1/1, 1/2 …), each step tries 3 random 8-neighbour offsets. Contents: `_oVar2 = rnd(10)` (explosive barrels 0); `<= 1` → item (`_oVar3==0` → useful else random); `>= 8` → a pre-spawned hidden skeleton pops out. Breaking: non-explosive drops loot with the stored seed; explosive deals 8–16 fire to players and 1–4 to monsters in the 3x3 and chain-detonates adjacent explosives; broken barrels become non-solid, missile-passable, drawn behind.

**Sarcophagi** (1x2): `rnd(10)`: `<= 2` → one random item; `>= 8` → hidden skeleton; opening plays a 5-frame animation then stops.

**Wall traps (`AddObjTraps`)**: for every object whose type has the `Trap` flag (doors, levers, chests, sarcophagi, mushroom patch) roll `rnd(100) < {10,15,20,25}` by level (`1 / ≥2 / ≥5 / ≥7`); 50% choose west or north; walk from the object through non-solid cells to the first solid cell; it must have the `Trap` piece property, no object, not `Populated`, and be ≥2 cells away; place a trap-hole object there with `_oVar1/2 = trigger cell`, missile `rnd(effLevel/3+1)` → `0 arrow, 1 firebolt, 2 lightning`; mark the trigger `_oTrapFlag`. `OperateTrap` (run every tick): when the trigger object is operated (door opened / container opened) and the trap is unfired → fire at a player adjacent to the trigger if any (reverse 3x3 scan) else at the trigger cell, play the trap sound.

**Flame-jet traps (authored only)**: `OBJ_FLAMEHOLE` groups share `_oVar1 = trapid`; idle state watches a 5-cell line (`_oVar3==2` horizontal, else vertical) for players/monsters; when triggered all holes of the group activate (anim on, light radius 1) and deal `damage[tileset] = {6,8,10,12,10,12}` .. `2x` fire per tick to anyone on the hole (half to monsters); a flame lever toggles a group off/on.

**Levers / switches / cruxes / books (map changers)**: a lever (`OperateLever`) becomes inert, advances one frame, and calls `ObjChangeMap(_oVar1.._oVar4)` — except on level 16 where all levers with the same `_oVar8` must be pulled first, and on level 24 where it opens the vault directly and completes the final quest. Breakable cruxes (3 variants, 15 frames) behave like levers when **all** cruxes of the same id are broken. Quest book levers (`OperateBookLever`) set the quest ACTIVE and logged on first use, change the map (not for the pedestal book), may spawn a unique item (hidden halls: amulet at `SetPiece.world+(5,5)`; pedestal: first stone at `+(9,17)`), re-label the opened region's transparency to id 9, snap to the open frame, and play the quest text. The vault-portal book changes the map via the resync path and plays a class-specific text. The pedestal accepts a quest stone from the inventory up to 3 times, each opening a region and spawning the next stone (`+(3,10)`, `+(15,10)`), finally loading the room's hidden objects and a unique armour at `+(9,3)`.

**Altars (shrines)** — see the table below. `AddShrine`: seed, `_oPreFlag`, choose a kind uniformly among the allowed set (base game: first 26 kinds; expansion: 34), excluding SP-only kinds in MP and MP-only kinds in SP, and excluding the spell-shuffle kind outside tilesets 1/2; 50% use the alternate 22-frame animation. **Goat altar** and **cauldron** pick a random valid kind at *use* time (`FindValidShrine`, additionally excluding the chest-reroll kind). A gameplay option marks the four "crippling" kinds (the three mana-cost spell altars and the gold/durability-loss one) plus goat altar/cauldron as disabled.

**Fountains**: blood fountain `+1 HP` per click (fixed-point), purifying `+1 MP`; murky pool: one-shot infravision buff (`2*tileset`); tear fountain: one-shot deterministic `-1` one stat / `+1` another (`(seed>>16)%12` → from/to pair).

**Containers that roll loot by level**: armour stand (`<=5` light armour guaranteed good; 6–9 medium 50% good; 10–12 heavy; `>=13` heavy good); weapon rack (random of sword/axe/bow/mace, good outside T1); book stand (1/5 spellbook else scroll; emptied stands are pre-set non-interactive); bookcase (spellbook; wakes the mad-mage unique); decapitated body / slain hero (random item; hero gives a class-specific magic item); lore books (play text; on level 24 track reading order `6 → 7 → 8`).

**Per-tick processing (`ProcessObjects`)**: light objects toggle their dynamic light by player proximity; breakables/altars stop animating at the last frame (`_oAnimDelay = 1000`); doors update blocked state; sarcophagi stop at last frame; flame traps and wall traps update; magic circles track the standing player; burning crosses damage the player standing just north of them (`{6,8,10,12,10,12}` fire minus fire resistance %). Then generic animation advance (`cnt >= delay → frame++`, wrap to 1), then deletion sweep of `_oDelFlag`.

**Networking**: local operation sends `CMD_OPERATEOBJ/BREAKOBJ/OPENDOOR/CLOSEDOOR` with the object's position; remote peers run `SyncOpObject` (same handlers with `sendLootMsg=false` since loot is seed-deterministic); joining players replay via `DeltaSyncOpObject` (snap to final frame/state) and `DeltaSyncBreakObj`; door/lever/crux/book state is recomputed from frames by `SyncObjectAnim` after any map change.

**Hover text**: `name()` per type (doors report Open/Closed/Blocked; altars "<Kind> Shrine"; lore books their title); a class with the trap-sense flag sees "Trapped X" in red when `_oTrapFlag`; disabled altars show "(disabled)".

### Reference tuning values

| Item | Value |
|---|---|
| Max objects per level | 127 |
| Sprite files per level | ≤ 40 of 65 |
| Chests per level | small 5–9, medium 3–5, large 1–4 |
| Chest item counts | small 0–1, medium 0–2, large 0–3 (sub-levels 1/2/3) |
| Chest "useful" loot chance | 1/8 |
| Chest trap chance | 10% (T2–T5 only) |
| Barrel groups | 3–7; explosive 1/4 first, 1/5 subsequent; loot `rnd(10) <= 1`; skeleton `>= 8` |
| Explosive barrel damage | players 8–16, monsters 1–4, 3x3, chain |
| Sarcophagi | 10–14 (T1/T6); loot `<= 2`/10, skeleton `>= 8`/10 |
| Wall trap chance per trigger object | 10/15/20/25% by level 1/2+/5+/7+ |
| Wall trap missile | `rnd(effLevel/3+1)`: arrow / firebolt / lightning |
| Flame trap & burning cross damage by tileset | 6,8,10,12,10,12 (flame max = 2x) |
| Object light radii | 3 (lore candles), 5 (candles, braziers, crosses), 8 (torches) |
| Armour stand tiers | ≤5 / 6–9 / 10–12 / ≥13 |
| Book stand book chance | 1/5 |
| Altar kinds | 26 (base) / 34 (expansion) |

### Random-effect altar table (genericised)

`lt` = tileset index (1..4), `L` = dungeon level. "SP"/"MP" = availability restriction. Effects marked "self" apply only to the activating player; two kinds affect *other* players instead.

| # | Effect | Availability |
|---|---|---|
| 1 | -1 to all four stats, then +6 to one random stat | any |
| 2 | +10 durability and max durability to all equipped items, then -20 to one random equipped item (min 1) | any |
| 3 | all weapons: max damage -1 (floored at min damage); all armour: +2 AC | SP |
| 4 | all weapons (equipped non-shield hands + inventory): max damage +1 | SP |
| 5, 12 | mana-shield buff with strength `2*lt` | any (two identical entries) |
| 6 | fully recharge all staves | any |
| 7 | repair all items to max durability | any |
| 8 | if ≥2 spells known: all known spells +1 level (capped) except one random spell -1 | any, tilesets 1–2 only |
| 9 | re-close every opened chest on the level with fresh loot seeds | SP |
| 10 | learn spell A and +2 levels; permanently lose 10% of base max mana | any ("crippling") |
| 11 | nova around the player (`2*lt`) and refill mana | any |
| 12 | (see 5) | |
| 13 | every heal/mana potion in inventory+belt → rejuvenation; full heal/full mana → full rejuvenation | any |
| 14 | +2 magic | any |
| 15 | full HP & mana; spawn 2 potions at the altar: `L < 4` → full mana + full heal, else 2 full rejuvenation | any |
| 16 | random teleport (phasing missile, `2*lt`) | any |
| 17 | learn spell B +2, -10% max mana | any (crippling) |
| 18 | fill every empty inventory slot with a gold stack of `5*lt + rnd(10*lt)` | any |
| 19 | **other** players: full HP and mana; self: nothing | MP |
| 20 | +2 dexterity | any |
| 21 | +2 strength | any |
| 22 | +2 vitality | any |
| 23 | reveal the entire automap (explorer level "shrine") | any |
| 24 | learn spell C +2, -10% max mana | any (crippling) |
| 25 | identify all carried items | any |
| 26 | **other** players: +1 to one random stat, -1 to the other three | MP |
| 27 | +2 to the class's primary stat (split +1/+1 for hybrid classes); a firewall (`2*L+2`) spawns at the altar and advances on the player | expansion |
| 28 | +`min(XP/1000, 5)` magic; lose 5% XP (all XP if ≤ 5000) | expansion |
| 29 | convert half of carried gold into XP 1:1 | expansion |
| 30 | +`1000*L` XP; a flash trap (`3*L+2`) hits the player | expansion |
| 31 | open a town portal at the altar | expansion |
| 32 | refill mana | expansion |
| 33 | real-clock bonus: 20:00–04:00 +2 vit; 18–20 +2 mag; 12–18 +2 str; 04–12 +2 dex | expansion, SP |
| 34 | for each equipped item with 1/3 chance: halve its durability (first hit only); if none hit, lose 1/3 of gold | expansion (crippling) |

### Smallest buildable chunks

1. **ObjectData table loader** (TSV → rows; flags; selection regions) — done when 110 rows parse.
2. **Object pool** (127 slots, free list, `dObject` writes incl. negative secondary cells, `FindObjectAtPosition(considerLarge)`) — done.
3. **`SetupObject` + per-type init dispatch** — done when seeds/vars are set per type.
4. **Random placement helpers** (`RndLocOk`, area checks, `GetRandomObjectPosition`) — done.
5. **Door state machine + piece swap tables + blocked detection + monster auto-open** — done when pathing through doors works both ways.
6. **Chest population, loot roll, trap conversion & trap firing** — done.
7. **Barrel group placer, break handling, explosion chain** — done.
8. **Sarcophagus (1x2) & hidden skeleton hookup** — depends on a monster pre-spawn API.
9. **Wall trap placement & firing** — done when traps only attach to flat walls with the `Trap` piece flag.
10. **Flame-jet trap groups + toggle lever** — authored-map feature; done.
11. **Lever/crux/book → `ObjChangeMap` wiring** incl. "all with same id" rule — done.
12. **Quest book levers & pedestal** — quest-specific; done per quest.
13. **Altar kind selection + 34 effect handlers** — table + handlers; done when SP/MP/tileset filters hold.
14. **Goat altar / cauldron (reroll at use)** — done.
15. **Fountains (4)** — done.
16. **Level-tiered containers** (armour stand, rack, book stand, bookcase, corpses) — done.
17. **Lore books + reading-order lock** — done.
18. **Object lights with proximity wake-up** — depends on lighting pool.
19. **Per-tick processor & animation** — done.
20. **Network op/break/door commands and delta replay** — done when a late joiner sees identical states.
21. **Hover naming incl. trap-sense & disabled flags** — done.
22. **Per-tileset `InitObjects` schedule** — data-drive the order; done when counts match the table.

### Pitfalls / design lessons

* **Loot determinism**: every container stores an RNG seed at creation and re-seeds before rolling loot, so all peers roll the same drop without network traffic. Keep this.
* Large objects via negative ids are easy to get wrong in placement checks (`IsAreaOk` must consider them).
* Traps attach to the *wall* not the trigger; the trigger object just carries a flag. This decoupling lets one trap serve a door the monster opens.
* Keep "crippling" effects behind a toggle; players hate permanent negative RNG.
* Pre-spawned hidden monsters (barrels/sarcophagi/skeleton rooms) require the monster system to support inactive reserved monsters.

---

## Quests

### Purpose
A fixed table of 24 quest definitions; each game instantiates them as `Quest` records with a small state machine (`NOTAVAIL/INIT/ACTIVE/DONE` plus expansion tease states), a home level, an optional sub-level, a position (portal or prop), and two scratch bytes. Quests hook into generation (set pieces), objects (levers/props), monsters (uniques/bosses), NPCs (dialogue/turn-in) and triggers (portals).

### Key data structures

```
struct QuestData {               // TSV row: txtdata/quests/questdat.tsv
  uint8 _qdlvl;                  // single-player home level
  int8  _qdmultlvl;              // multiplayer home level (-1 = not in MP)
  dungeon_type _qlvlt;           // tileset of the sub-level (NONE if no sub-level)
  int8 questBookOrder;           // ordering in the quest log
  uint8 _qdrnd;                  // (always 100; legacy)
  _setlevels _qslvl;             // sub-level id or NONE
  bool isSinglePlayerOnly;
  _speech_id _qdmsg;             // default log text
  string _qlstr;                 // log title
};
struct Quest {
  quest_id _qidx; quest_state _qactive; uint8 _qlevel; Point position;
  dungeon_type _qlvltype; _setlevels _qslvl; bool _qlog; _speech_id _qmsg; uint8 _qvar1, _qvar2;
  bool IsAvailable();  // !setlevel && currlevel == _qlevel && _qactive != NOTAVAIL && !(SPonly && MPrules)
};
enum quest_state { NOTAVAIL, INIT, ACTIVE, DONE, HIVE_TEASE1=7, HIVE_TEASE2, HIVE_ACTIVE, HIVE_DONE, INVALID=0xFF };
```

### The 24 quest definitions (structure only)

| # | Home level (SP / MP) | Sub-level | SP-only | Pattern |
|---|---|---|---|---|
| 1 | 5 / — | — | yes | fetch: item on a stand object (random 5x5 spot) → smith → unique ring |
| 2 | 9 / — | — | yes | chain: tome spawns on level → witch → mushroom-patch object appears → pick item → witch → brain item from a monster → healer → elixir → witch (done) |
| 3 | 4 / — | — | yes | talking unique (goat type): hands out items on successive talks then attacks |
| 4 | 8 / — | — | yes | talking unique (mage) guarding a themed library; attacks when a bookcase is looted |
| 5 | 14 / — | — | yes | talking unique (ghost knight) asks for an elixir found on level 15; return for reward |
| 6 | 15 / 15 | — | no | final boss; gate on level 15 opens after #16 |
| 7 | 2 / 2 | — | no | set-piece room + boss; started by the dying townsman NPC |
| 8 | 4 / — | — | yes | set-piece room with talking unique; 3-stage map opening; sign item in a container → innkeeper → unique helm |
| 9 | 7 / — | — | yes | set-piece hidden halls; book lever opens 2 hidden rooms + unique amulet |
| 10 | 5 / — | — | yes | set-piece pedestal room; 3 stones each open a section; unique armour |
| 11 | 10 / — | — | yes | anvil island set piece in caves; item → smith → unique weapon |
| 12 | 13 / — | — | yes | set-piece room; steel-tome lever opens the room with a champion boss |
| 13 | 3 / 3 | boss lair (T1) | no | portal on level 3 → fixed lair → kill boss; innkeeper narrates |
| 14 | 2 / — | poisoned cave (T3) | yes | portal on level 2 → fixed cave; kill all → palette shifts; healer rewards ring |
| 15 | 6 / — | spell vault (T2) | yes | set-piece book opens portal → fixed vault; reading the book grants +1 level of a summon spell |
| 16 | 15 / 15 | betrayer lair (T1) | no | staff item on a stand (SP) → elder → red portal on level 15 → lair with 2 books + magic circles → boss → opens final gate |
| 17 | 17 / 17 | — | no | (expansion) map item → barmaid → use at grave region in town → opens tier 6 |
| 18 | 9 / 9 | — | no | (expansion) farmer gives bomb → use at hive region → opens tier 5; reward amulet |
| 19 | 17 / — | — | yes | (expansion) return a lost child's item to the girl NPC → amulet (level 13) |
| 20 | 19 / — | — | yes | (expansion) wandering trader — defined, unused |
| 21 | 17 / 17 | — | no | (expansion) tier-5 boss on level 17 |
| 22 | 21 / 21 | — | no | (expansion) tier-6 final boss on level 24; 3 tomes in order or lever |
| 23 | 21 / — | — | yes | (expansion) cornerstone object: cross-character item stash on level 21 |
| 24 | 9 / 9 | — | no | (expansion) alternate farmer quest (suit items, cow farmer NPC, tease states) |

### Algorithms & rules

1. **`InitQuests()`**: for each row: `_qactive = NOTAVAIL`, copy static fields; SP → `_qlevel = _qdlvl`, `INIT`; MP → only non-SP-only quests get `_qlevel = _qdmultlvl`, `INIT`. SP with randomisation option → `InitialiseQuestPools(DungeonSeeds[15])` disables one quest per pool (five pools, see template; one historical seed value skips a pool to replicate a bug). Demo build → all NOTAVAIL. Then specific inits: unavailable boss-lair / rock quests set `_qvar2 = 2` (skip dialogue); inn-sign `_qvar1 = 1`; MP betrayer `_qvar1 = 2`; MP mushroom tome pre-spawned flag.
2. **Availability** (`IsAvailable`) gates generation hooks: set pieces (`InitSetPiece`), quest objects (`InitObjects`), unique monsters, graphics loading.
3. **Per-tick (`CheckQuests`)**: MP betrayer altar prop spawn; SP: spawn the red portal on level 15 when `_qvar1 >= 2` and state ACTIVE/DONE; spawn the return portal in the lair when DONE; poisoned cave completion when `ActiveMonsterCount == 4` (golem slots only) → DONE, log, palette purify (32-step colour ramp); portal walk-on into sub-levels (see triggers).
4. **Kill hooks (`CheckQuestKill`)**: boss types / unique types set DONE (+ player voice line); betrayer kill also sets the final boss quest ACTIVE and (SP) adds the lair's return trigger and red portal, (MP) adds the gate trigger directly.
5. **NPC hooks**: each NPC talk function checks quest states and the player's `_pLvlVisited[]` (e.g. the innkeeper only offers the boss-lair quest after visiting level 2 or 4; the smith after visiting level 4/5 or 9/10) and inventory (`RemoveInventoryItemById`) and spawns unique rewards at `npc.position + SouthWest`. Advancing a quest sets `_qlog = true` and broadcasts `NetSendCmdQuest`.
6. **Log entries**: `_qlog` controls visibility; `_qmsg` the text shown; `questBookOrder` the order.
7. **Multiplayer**: `SetMultiQuest(q, state, log, v1, v2, msg)` merges a remote update monotonically (state only increases unless the tease states; `_qvar1` only increases; `_qvar2` overwrite). `ResyncMPQuests()` auto-activates boss-lair/slaughter-room quests when within ±1 level of their home, betrayer/grave/defiler/final quests one level above home. `ResyncQuests()` (see set pieces) re-derives map and unique-monster dialogue states on level load.
8. **Validation** (`IsQuestDeltaValid`): log ∈ {0,1}; message id < table size; tease states only for the two expansion farmer quests.
9. **Return level** for sub-levels = the owning quest's `_qlevel`; return position = quest position + a fixed step.

### Reference tuning values

| Item | Value |
|---|---|
| Quests | 24 rows; 5 SP lottery pools |
| Quest portal red-portal spawn condition | `_qvar1 >= 2`, state ACTIVE/DONE, `_qvar2 ∈ {0,2}` |
| MP auto-activation window | home level ±1 (two early quests), home-1 (others) |
| Poisoned cave "all dead" threshold | `ActiveMonsterCount == 4` |
| Palette purify steps | 32 colours, 1 per tick |
| Vault spell reward | +1 level of spell (capped at max) |

### Smallest buildable chunks

1. **QuestData TSV loader + Quest array init** (SP/MP level mapping) — done.
2. **Availability predicate** — done.
3. **SP quest-pool lottery** seeded from a fixed level seed — done.
4. **Quest log state (`_qlog`, `_qmsg`, order)** — done.
5. **Generation hooks registry** (which quests stamp which set piece / object on which level) — done when toggling availability changes generation.
6. **Portal-to-sub-level hook** (position, walk-on, return) — done.
7. **Kill hooks for bosses/uniques** — done.
8. **NPC turn-in hooks** with visited-level gating and inventory removal — done per quest.
9. **Per-tick quest watcher** (portal spawns, kill-all completion) — done.
10. **Palette-transition effect** for the cave quest — done.
11. **MP merge rules & validation** — done when out-of-order packets converge.
12. **Level-load resync of map and unique states** — done.
13. **Expansion tease-state machine** (cow farmer) — done.

### Pitfalls / design lessons

* Quest state is deliberately tiny (state + 2 bytes); all derived world state (open rooms, dialogue, portals) is recomputed on load. This is what makes saves and MP joins robust.
* Keep "home level" and "SP-only" in data; the lottery pools are the only hard-coded grouping — move them to data too.
* Visited-level gating (`_pLvlVisited`) is a cheap way to pace quest offers without timers.
* Several quests are hard-wired to specific tilesets (set pieces exist for one tileset only); design set pieces per tileset from day one.

---

## NPCs ("towners") & the dialogue table

### Purpose
Town NPCs are data-defined animated sprites standing at fixed positions. Talking to one runs a per-role C++ function that checks quest state (turn-ins, offers) and otherwise opens that NPC's store/gossip menu. A dialogue table maps `(NPC role, quest)` → speech id so every NPC can comment on every active quest.

### Key data structures

```
struct TownerDataEntry {        // towners.tsv row
  _talker_id type; string name; Point position; Direction direction;
  uint16 animWidth; string animPath; uint8 animFrames; int16 animDelay;
  vector<_speech_id> gossipTexts; vector<uint8> animOrder;   // optional explicit frame sequence
};
struct Towner { sprites; span<uint8> animOrder; void (*talk)(Player&, Towner&); string_view name;
  Point position; _speech_id gossip; anim width/delay/cnt/len/frame/frameCnt; _talker_id _ttype; };
unordered_map<_talker_id, array<_speech_id, 24>> TownerQuestDialogTable;   // quest_dialog.tsv
struct Speech { string txtstr; bool scrlltxt; SfxID sfxnr; };  // textdat.tsv: txtstrid, txtstr, scrlltxt, sfxnr
```
Roles: smith, healer, dying townsman, innkeeper, elder/storyteller, drunk, witch (arcane vendor), barmaid, peddler boy, livestock (3 instances), farmer, girl, cow-farmer. The dialogue text table is keyed by string ids; hard-coded ids occupy fixed slots and mods can append new ids. `scrlltxt` marks long scrolling narration; `sfxnr` the voice-over.

### Algorithms & rules

1. **`InitTowners()`** (every town load): load TSV data; for each entry whose role `IsTownerPresent()` (dying townsman only while the slaughter-room quest is INIT/ACTIVE; farmer only in expansion when the cow-quest flag is off and his quest isn't HIVE_DONE; cow-farmer when the flag is on; girl only in expansion when her flag is on, the player has visited level 17 and her quest isn't DONE), write `dMonster[pos] = index+1` (NPCs share the monster occupancy grid in town), build the `Towner`, load its sprite, pick **one random gossip line** from the entry's list for this visit. Livestock are 4-cell sprites (`-id` into the three northern cells) with a random start frame; the cow-farmer swaps sprite sheets when his quest is DONE.
2. **`ProcessTowners()`**: advance `_tAnimCnt`; at `_tAnimDelay` either step through the explicit `animOrder` sequence (lets idle loops dwell on frames) or increment the frame modulo `animLen`. The dying townsman freezes/collapses to a single frame once the quest is taken.
3. **`TalkToTowner(player, idx)`**: requires walking distance < 2 and no item on the cursor; calls the role's talk function.
4. **Talk function shape** (all roles): a chain of `if quest X in state S and player has/visited Y → advance quest, spawn reward, play text, return;` then fall through to `TownerTalk(introText)` + `StartStore(roleMenu)`. Examples: innkeeper → boss-lair offer after visiting level 2/4, inn-sign turn-in (unique helm); smith → rock turn-in (unique ring), anvil turn-in (unique weapon); witch → mushroom chain hops; healer → **heals the player to full on every visit**, poisoned-cave offer/reward (unique ring), brain turn-in → elixir; elder → betrayer staff turn-in (starts the red portal), final briefing; barmaid → grave map; farmer / cow-farmer → bomb hand-out, tease dialogue by visited levels; girl → keepsake turn-in → amulet; livestock → click counter easter egg (4th click alternate sound; 8th+ voice lines cycling 3).
5. **Gossip**: the store menu's "Talk to <NPC>" shows the quest-dialog entries for all *active, logged* quests (from `TownerQuestDialogTable`) plus the per-visit gossip line.
6. **Dialogue table edits at runtime**: a few quest steps overwrite entries (`SetTownerQuestDialog(role, quest, id)`) so the healer/witch lines change as the mushroom chain progresses.

### Reference tuning values

| Item | Value |
|---|---|
| NPC definitions | 13 roles / 15 instances (3 livestock) |
| Talk range | walking distance < 2 |
| Livestock click gags | alt sound at 4 clicks; voice lines from 8 |
| Gossip | 1 random line per town visit per NPC |
| Positions (role → tile) | smith (62,63), healer (55,79), dying townsman (24,32), innkeeper (55,62), elder (62,71), drunk (71,84), witch (80,20), barmaid (43,66), boy (11,53), livestock (58,16),(56,14),(59,20) |

### Smallest buildable chunks

1. **Text table loader** (`txtstrid, txtstr, scrlltxt, sfxnr`; `\n` unescape; mod ids appended) — done.
2. **NPC TSV loader** (entries + quest-dialog matrix) — done.
3. **Presence predicates per role** — done.
4. **NPC spawn into occupancy grid incl. multi-cell livestock** — done.
5. **Animation with optional explicit frame order** — done.
6. **Talk dispatcher (range, cursor-item check)** — done.
7. **Per-role talk functions** as quest-hook chains ending in store/gossip — one per role.
8. **Gossip/quest-comment menu assembly** from the matrix — done.
9. **Runtime dialogue overrides** — done.
10. **Conditional sprite swaps (cow-farmer, girl)** — done.

### Pitfalls / design lessons

* Putting NPCs in the *monster* occupancy grid is a historical shortcut; it works because town has no monsters but complicates generic code.
* The `(role × quest)` dialogue matrix is the cheapest way to make a town feel reactive; keep it as a spreadsheet.
* Healing on talk makes the healer a free service — budget for it in difficulty.

---

## Vendors / stores

### Purpose
Shops are menu-driven dialogs attached to NPCs: buy (basic and premium stock), sell, repair, recharge, identify, plus free healing. Stock is regenerated every time the town loads from the player's progress level; premium stock persists and rolls forward with character level.

### Key data structures
`TalkID` (menu page enum: Smith/SmithBuy/SmithSell/SmithRepair/Witch/WitchBuy/WitchSell/WitchRecharge/NoMoney/NoRoom/Confirm/Boy/BoyBuy/Healer/Storyteller/HealerBuy/StorytellerIdentify/SmithPremiumBuy/Gossip/StorytellerIdentifyShow/Tavern/Drunk/Barmaid); stock vectors `SmithItems[≤19|24]`, `PremiumItems[≤6|15]` + `PremiumItemLevel`, `WitchItems[≤17|24]`, `HealerItems[≤17|19]`, `BoyItem` + `BoyItemLevel`; `PlayerItems[48]`/`PlayerItemIndexes[48]` (copies of the player's items shown in sell/repair/recharge/identify lists; negative indexes = equipped slots, belt as `-(i+1)`); `TempItem` for confirmation; mod hook `RegisterTownerDialogOption(npc, label(), onSelect())`.

### Algorithms & rules

**Stock level (`SetupTownStores`, every town load)**: SP: `l = highest dungeon level ever visited`; MP: `l = charLevel/2`; then `l = clamp(l+2, 6, 16)`. `SpawnSmith(l)`, `SpawnWitch(l)`, `SpawnHealer(l)`, `SpawnBoy(charLevel)`, `SpawnPremium(player)`. `InitStores()` (new game) clears everything and sets `PremiumItemLevel = 1`.

**Smith basic stock**: `count = rnd[10, 19]` (24 expansion); each item: new seed, pick a smith-eligible base item at level `l`, roll attributes, reject while value > 140000 (200000 expansion); identified; sorted.

**Smith premium stock**: slots 6 (15 expansion); each slot `i` has level `PremiumItemLevel + offset[i]` with `offset = {-1,-1,0,0,1,2}` (expansion `{-1,-1,-1,0,0,0,0,1,1,1,1,2,...}`); an item is `RndPremiumItem(plvl/4, plvl)` with magic bonus range `(plvl/2, plvl)`, level clamped `[1,30]`, rejected while value > cap (expansion: also rejected if below the player's best owned item of that type; up to 150 tries). While `PremiumItemLevel < charLevel`: `PremiumItemLevel++`, drop the two lowest slots, shift the rest down, and generate two new top slots (expansion: drop 3, regenerate slots 10/12/14). Bought premium slots stay empty until the next level-up roll.

**Witch stock**: `count = rnd[10, 17]` (24); first 3 slots pinned: mana potion, full mana potion, portal scroll (level 1, infinite — buying re-seeds instead of removing); expansion adds `rnd(4)` pinned spellbooks if `l` meets their min level; the rest: witch-eligible items at `l`; with 5% chance (or always for staves) roll bonuses in `[l, 2l]`; value cap as smith.

**Healer stock**: `count = rnd[10, 17]` (19); pinned: heal potion, full heal (MP also a resurrect scroll) — infinite; rest healer-eligible at `l`. Talking to the healer heals to full HP for free.

**Peddler boy**: one item; regenerated only when `BoyItemLevel < charLevel/2` or empty; base pick at `charLevel`, bonuses `[lvl, 2lvl]`; base game rejects value > 90000; expansion rejects value > 200000, items the player could not equip at `maxStat*1.2`, items worth less than 80% of the player's best of that type, and class-inappropriate types for the first 200 tries (up to 250 tries). Viewing costs 50 gold; price = value + 50% (base) or value − 25% (expansion).

**Prices & services**:

| Service | Formula |
|---|---|
| Buy | `_iIvalue` (identified value) |
| Sell | `max(value/4, 1)` where value = identified value if magical & identified, else base value; smith buys weapons/armour/oils (not misc, gold, staves with spells, quest items); witch buys misc, staves with spells (not oils range, not quest items) |
| Repair | magical identified: `30 * value * missingDur / (maxDur * 100 * 2)` (skipped if 0); else `max(value * missingDur / (maxDur*2), 1)`; equipped helm/chest/hands + inventory |
| Recharge | `(value + spell.staffCost) * (maxCharges - charges) / (maxCharges * 2)`; staves and charged uniques |
| Identify | flat 100; unidentified magic items in inventory & all equipped slots |
| Heal | free on talk |
| Peek at boy's item | 50 |

Gold is taken from inventory stacks first (`TakeGold`, skipping full stacks first) then from the stash; affordability = inventory gold + stash gold. Buying checks `StoreAutoPlace` (inventory/belt/equip fit) → "no room" page; selling checks that the gold fits (`itemSize * maxStack + free gold room`). Every transaction passes through a `Confirm` page; `OldActiveStore/OldTextLine/OldScrollPos` restore the list.

**Gossip pages**: Tavern/Drunk/Barmaid have no stock; their pages list quest comments from the dialogue matrix. Mods can inject extra options into even-numbered empty lines above "leave".

### Reference tuning values

| Item | Base / Expansion |
|---|---|
| Stock level | `clamp(progress+2, 6, 16)` |
| Smith basic count | 10–19 / 10–24 |
| Premium slots & offsets | 6 `{-1,-1,0,0,1,2}` / 15 |
| Witch count, pinned | 10–17 / 10–24; 3 pinned (+0–3 books) |
| Healer count, pinned | 10–17 / 10–19; 2 (3 MP) pinned |
| Vendor value cap | 140000 / 200000 |
| Boy value cap | 90000 / 200000; peek 50; markup +50% / −25% |
| Sell ratio | 1/4 |
| Identify | 100 |
| Witch bonus roll chance | 5% (staves always) |
| Premium bonus range | `[plvl/2, plvl]`, plvl ≤ 30 |

### Smallest buildable chunks

1. **Store page state machine** (TalkID pages, selection, scroll, back, confirm) — done.
2. **Stock level formula + restock on town load** — done.
3. **Smith basic stock generator** with value cap — depends on item generator.
4. **Premium stock with level offsets and roll-forward** — done when levelling shifts slots as specified.
5. **Witch stock with pinned infinite items and bonus rule** — done.
6. **Healer stock with pinned items, MP resurrect, free heal** — done.
7. **Peddler single-item generator with usability/value filters** — done.
8. **Sell list builder + acceptance predicates per vendor** — done.
9. **Repair / recharge / identify pricing & application** — done.
10. **Gold handling across inventory & stash, auto-place, fit checks** — done.
11. **Gossip pages from dialogue matrix + mod option hook** — done.

### Pitfalls / design lessons

* Restocking on every town visit plus "progress = deepest level visited" gives a clean economy ramp without timers; MP uses char level because levels are shared.
* Premium items are *persistent* stock — the only place where the shop has memory; note the index shuffling is brittle and should be a sorted list keyed by slot level.
* Infinite pinned consumables (potions, portal scroll) are the real safety net; price them, not their availability.

---

## Town portals

### Purpose
A player-cast portal links a dungeon spot to a fixed anchor in town and back. One portal slot per player (4). Portals persist across level changes until re-cast or used from town.

### Key data structures
`struct Portal { bool open; Point position; int level; dungeon_type ltype; bool setlvl; }; Portal Portals[4];` plus `portalindex` (which slot the player is currently traversing) and the town anchor table `(57,40),(59,40),(61,40),(63,40)`.

### Algorithms & rules

1. **Cast** (`ActivatePortal(player, pos, level, type, isSetLevel)`): mark the slot open; if `level != 0` record position/level/type/sub-level flag (casting in town only re-opens). A portal missile is added at the spot (`AddPortalMissile`; light radius 15 in dungeons) and the town-side missile at the player's anchor (`AddPortalInTown`).
2. **Level load (`SyncPortals`)**: in town, spawn the town-side missile for every open slot; in a dungeon spawn the dungeon-side missile only for slots whose `level`/`setlvl` match the current level (idle frame, no opening animation).
3. **Traverse** (`GetPortalLevel`, after `SetCurrentPortal(slot)`): from a dungeon → go to town (level 0); from town → go to the slot's level (sub-level if flagged, setting `setlvltype`); if the traversing player owns the slot and is leaving town, the portal is **deactivated** (one return trip) and `CMD_DEACTIVATEPORTAL` is sent. Arrival position: town anchor `+(1,1)`; dungeon: the stored position (`+(1,1)` for non-owners so they don't stack).
4. **`PortalOnLevel`** / `RemovePortalMissile` clean up missiles; `PosOkPortal(level, pos)` stops monsters/items spawning onto a portal cell or its SE neighbour.
5. **Validation (`IsPortalDeltaValid`)**: position in bounds, tileset not NONE, and the tileset must equal `GetLevelType(level)` (or the sub-level's type) — rejects forged network portals.

### Reference tuning values

| Item | Value |
|---|---|
| Portal slots | 4 (one per player slot) |
| Town anchors | `(57,40)`, `(59,40)`, `(61,40)`, `(63,40)` |
| Dungeon-side light radius | 15 |
| Entry type on traverse | `ENTRY_WARPLVL` |
| Arrival offset | `(+1,+1)` (town always; dungeon for non-owners) |
| Consumption rule | deactivated when the owner traverses town → dungeon |

### Smallest buildable chunks
1. Portal slot table + activate/deactivate — done.
2. Portal missile spawn/remove with light — done.
3. Level-load sync of missiles by level match — done.
4. Traverse logic incl. one-way consumption and sub-level support — done.
5. Spawn-exclusion predicate — done.
6. Delta validation — done.
7. Town-anchor lookup per player slot (data-driven by town config) — done when a second town can override anchors.
8. Portal-missile light lifecycle (add on spawn, remove on traverse/removal) — done when no light slots leak after 100 casts.

### Pitfalls / design lessons
* Tying portal ownership to player slot index (not player identity) simplifies MP but means a rejoining player inherits whichever slot they get.
* Consuming the portal only when the *owner* leaves town lets allies use it freely — a deliberate co-op convenience.

---

## Automap reveal, corpses & ring-crawl utility

### Purpose
Small supporting systems in this cluster: how map exploration is recorded and revealed, how monster corpses are stored per cell, and the concentric-ring iteration helper used for "nearest free cell" searches by many systems (item drops, spawn placement, portals).

### Key data structures
`uint8 AutomapView[40][40]` with `MapExplorationType { NONE < OLD < SHRINE < OTHERS < SELF }` (monotonic upgrade); `AutomapTile` types derived per tileset (vertical/horizontal/cross/fence/cave corner…) from an authored `.amp` table with tweaks per tileset. `Corpse { sprites; frame; width; translationPaletteIndex }; Corpses[31]`; `dCorpse` cell encoding. `DoCrawl(minR, maxR, fn)`.

### Algorithms & rules

**Automap reveal**:
1. Vision rays (`DoVision`) call `SetAutomapView(worldPos, explorer)` for each cell seen (only cells that already have any `dFlags` set, i.e. inside the playable area), convert to the 40x40 grid, and upgrade `AutomapView` if `explorer > current`.
2. The reveal is then **extended to adjacent wall cells** so wall lines draw complete: by the automap tile type at that cell — vertical walls also reveal the solid cell to the west (or SW corner when the cell itself is solid), horizontal reveal north (or SE corner), crosses reveal W/N/NW, fences likewise — only when the neighbour is flagged as "dirt/solid" in the automap table.
3. Town: all 40x40 revealed as `SELF` on load. The reveal altar sets all cells to `SHRINE`. MP peers' exploration arrives as `OTHERS` (drawn differently). Legacy saves map to `OLD`.
4. `InitAutomapOnce`: minimap occupies `screenW/4 x screenW/8` at the top-right with padding `screenW/128`; scale 25 x `screenH/480` (max 8x); full map default scale 50.

**Corpses**: `InitCorpses()` per level builds the corpse sprite table: one entry per distinct monster type present (its death animation's last frame), one unused blood slot, the stone-shatter sprite (frame 11, width 128), then one entry per **unique** monster (with its palette translation). Max 31. `AddCorpse(pos, id, dir)` writes `(id & 0x1F) | (dir << 5)`; unique monsters' lights move onto their corpse cell.

**Ring crawl**: `DoCrawl(r)` visits, for each radius `r`: `(0,r)`, `(0,-r)`, then for `x=1..r-1` the four `(±x, ±r)`, then the four diagonals `(±(r-1), ±(r-1))` when `r>1`, then `(±r, 0)` and for `y=1..r-1` `(±r, ±y)`. `Crawl(r, fn)` returns the first truthy result. Callers use `Crawl(0, maxR, …)` to find the nearest valid cell with a deterministic order (important for MP determinism).

### Reference tuning values

| Item | Value |
|---|---|
| Automap grid | 40 x 40 (mega tiles) |
| Exploration levels | 5 (`NONE < OLD < SHRINE < OTHERS < SELF`) |
| Minimap size / padding | `screenW/4 x screenW/8`, padding `screenW/128` |
| Map scales | minimap `25 * min(screenH/480, 8)`, full map default 50 |
| Max corpse sprites per level | 31 |
| Corpse cell encoding | id 5 bits, direction 3 bits |
| Stone-shatter corpse | frame 11, width 128 |

### Smallest buildable chunks
1. Exploration grid with monotonic levels and per-source colouring — done.
2. World→map conversion + wall-extension rules from an automap tile table — done.
3. Town/altar full reveal — done.
4. Minimap/full-map geometry constants — done.
5. Corpse sprite table per level + cell encoding — done.
6. Ring-crawl iterator with fixed visiting order + early exit — done with an order test.
7. Unique-monster corpse palette + light hand-off (`MoveLightsToCorpses`) — done when a unique's light ends on its corpse cell.
8. Multiplayer exploration merge (`OTHERS` level) — done when a peer's explored cells render in the alternate colour without overriding `SELF`.

### Pitfalls / design lessons
* The wall-extension rules exist only because the automap draws lines from mega tiles; if the new game draws from walkability it can drop them.
* A fixed crawl order is a hidden determinism requirement for lockstep MP — never replace it with a random scatter.

---

## Appendix A — Level population order (reference pipeline)

```
LoadGameLevel(entry):
  CreateLevel(entry)                 -> CreateDungeon(DungeonSeeds[L], entry) [layout+stairs, pass3, static lights]
                                      -> Init<Tileset>Triggers(); Freeupstairs(); load palette
  SetRndSeed(DungeonSeeds[L])
  GetLevelMTypes()                   -> choose up to 24 monster types for the level
  InitThemes()                       -> assign theme kinds to rooms
  LoadAllGFX()                       -> object/monster/missile sprites per the level's needs
  (ENTRY_RTNLVL / ENTRY_WARPLVL position fixes)
  InitPlayers / InitMultiView; mark level visited
  SetRndSeed(DungeonSeeds[L])        (again)
  if first visit / load / MP:
    HoldThemeRooms(); InitGolems(); InitObjects();
    InitMonsters(); InitItems(); CreateThemeRooms();
    InitMissiles(); InitCorpses(); SavePreLighting()
    (MP) DeltaLoadLevel()
  else: HoldThemeRooms(); InitGolems(); InitMonsters(); InitMissiles(); InitCorpses(); LoadLevel() [restore saved state]
  PlayDungMsgs(); ResyncMPQuests() or ResyncQuests()
Town variant: all tiles Lit; InitTowners(); InitStash(); InitItems(); InitMissiles(); restore/delta; reveal automap
Sub-level variant: LoadSetMap(); GetLevelMTypes(); InitGolems(); InitMonsters(); InitCorpses(); players; InitItems()/LoadLevel(); (MP) delta+resync; InitMissiles()
```

## Appendix B — Tile-id cheat sheet per tileset (floor / solid / door / stairs)

| Tileset | Floor | Solid filler (pass-3 base) | Doors | Up / Down / Shortcut stencil sizes |
|---|---|---|---|---|
| 1 | 13 | 22 | 25 (V), 26 (H), protected | 4x4 / 4x3 / — (quest cave 6x6) |
| 2 | 3 | 12 | 4 (V), 5 (H) → 7/9 end variants | 4x4 / 4x4 / 4x4 |
| 3 | 7 | 8 | fence gates 146/147 | 3x3 / 3x3 / 3x3 |
| 4 | 6 | 30 | 3-tile doorways 57-60-56 / 53-6-52 | 4x5 / 5x5 / 4x5 (+ gate 5x5) |
| 5 | 7 | 8 | (fences) | 3x3 / 3x3 / 3x3 |
| 6 | 13 | 22 | 25/26 | 4x4 / 4x4 / 4x4 |

## Appendix C — Generator comparison at a glance

| | A (1/6) | B (2) | C (3/5) | D (4) |
|---|---|---|---|---|
| Skeleton | fixed hall axis + 0–3 chambers | recursive partition rooms | random blob growth | quadrant room tree, mirrored x4 |
| Side rooms | recursive even-size rooms, flip 1/4 | BSP children, 4–10 cells | 3–4 cell blocks, 75% continue | recursive even-size rooms, flip 3/4 |
| Corridors | implicit (rooms touch) | random-walk halls w/ doors | implicit | implicit + axis corridors |
| Connectivity guarantee | by construction | FillVoids + FixLockout | flood-fill validation | PrepareInnerBorders |
| Area gate | 533/693/761 | void ≤ 700 | ≥ 600 | 692 |
| Mask→tiles | 6-case rule | 71 3x3 patterns | 16-entry table | 16-entry table |
| Walls/doors | carve floor runs, 1 door each | pattern walls + lockout doors | fences with 1 gap | carve runs > 3, 3-wide doorways |
| Signature features | pillared chambers, arches, fences | arches everywhere, big merged halls | lava pools, rivers+bridges, stalagmites | symmetry, authored final arena |
| Theme rooms | from regions (9–100 cells) | 6–10 | 5–10 | 7–10 random size, 1/8 rate |
| Retry triggers | area, stairs | partition void, stairs | area, connectivity, stairs, island, pool | area, stairs |

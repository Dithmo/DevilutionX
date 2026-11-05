# Cluster 04 — Monsters, Enemy AI, Combat Resolution, Projectiles, Status Effects, Death & Difficulty Scaling

This document is a genre-generic, IP-free systems breakdown derived from reading the monster, missile, corpse, vision,
pathing and player-combat code of a ~150k-line open-source isometric ARPG engine. All proper names (title, characters,
towns, monsters, items, quests) have been removed. Monsters are described as archetypes; specific numbers are given as
**reference tuning values** because they are mechanics, not IP. Every formula quoted below was copied from the arithmetic
in the source; where the source has a documented quirk or bug-fix the note is preserved because it is a design lesson.

Conventions used throughout:

* **tick** = one fixed game-logic step (the engine runs 20 ticks/second).
* **HP** values in the runtime structs are 26.6 fixed point (`raw = whole << 6`); the tables store whole numbers.
  Many formulas therefore contain `<< 6` / `>> 6` or `* 64`.
* `rand(n)` = uniform integer in `[0, n)`; `randBetween(a, b)` = uniform integer in `[a, b]`; `flipCoin(n)` = true with
  probability `1/n` (`flipCoin()` = 50%).
* `INT` = a monster's intelligence stat (0..3 in the tables), `LVL` = monster level, `CLVL` = player character level,
  `SLVL` = spell level.
* Distance between actors is **Chebyshev** ("walking distance"): `max(|dx|, |dy|)`.
* Difficulty tiers are called **T0 (normal)**, **T1 (nightmare-equivalent)**, **T2 (hell-equivalent)**.

---

## System map

| # | System | Source files (reference) | Lines | Depends on | Depended on by |
|---|--------|--------------------------|-------|------------|----------------|
| 1 | Monster data tables & roster | `Source/tables/monstdat.{h,cpp}`, `assets/txtdata/monsters/monstdat.tsv`, `unique_monstdat.tsv`, `mods/hf/txtdata/monsters/monstdat.tsv` | ~860 + 2 TSVs (112 base rows + 138 expansion rows; 98 unique rows) | data-file reader, speech-id table, item unique-id table | Spawning, AI, Combat, Death/Loot |
| 2 | Level population & spawning (type selection, scatter packs, unique/boss placement, difficulty scaling at init) | `Source/monster.cpp` (`InitMonster`, `PlaceGroup`, `GetLevelMTypes`, `InitMonsters`, `PlaceUniqueMonst*`, `PrepareUniqueMonst`, `SpawnMonster`, `SetMapMonsters`) | ~900 | Tables, dungeon grid (`dMonster`, `dTransVal`, solid flags), RNG, vision (`DoVision`), quests | Everything at runtime |
| 3 | Monster runtime state machine | `Source/monster.cpp` (`MonsterMode`, `UpdateModeStance`, `Monster*` mode handlers, `ProcessMonsters`) + `Source/engine/animationinfo.*` | ~700 | Animation system, dungeon grid, missiles | AI, Combat |
| 4 | Perception, targeting & wake-up | `Source/monster.cpp` (`UpdateEnemy`, `activeForTicks` logic, `LineClear*`), `Source/vision.cpp` (`DoVision`), `Source/levels/dun_tile_data.hpp` (`IsTileVisible`) | ~400 | Dungeon flags, player positions | AI, Missiles (LOS checks) |
| 5 | Movement, pathing & doors | `Source/monster.cpp` (`DirOK`, `IsRelativeMoveOK`, `Walk`, `RandomWalk`, `RandomWalk2`, `RoundWalk`, `AiPlanPath`, `AiPlanWalk`), `Source/engine/path.cpp` (A*), `Source/crawl.cpp`, `Source/levels/tile_properties.cpp` (`CanStep`), `Source/objects.cpp` (`MonstCheckDoors`) | ~700 | Dungeon grid, objects | AI, Spawning, Missiles (`FindClosestValidPosition`) |
| 6 | Packs, leaders & minions | `Source/monster.cpp` (`PlaceGroup` leashing, `FollowTheLeader`, `GroupUnity`, `DirOK` leash rules, `ReleaseMinions`) | ~200 | Spawning, Movement | AI, Death |
| 7 | AI archetype routines (25 distinct routines + dispatch table) | `Source/monster.cpp` (`*Ai` functions, `AiAvoidance`, `AiRanged`, `AiRangedAvoidance`, `AiProc[]`) | ~1400 | 3,4,5,6, Missiles | Process loop |
| 8 | Combat resolution (hit/damage/block/hit-recovery/knockback in all four directions) | `Source/monster.cpp` (`MonsterAttackPlayer`, `MonsterAttackMonster`, `M_StartHit`, `IsHardHit`, `M_GetKnockback`, `CheckReflect`, `MonsterReducePlayerAttribute`, `toHit*`, `level`, `exp`), `Source/player.cpp` (`PlrHitMonst`, `PlrHitPlr`, `DoAttack`, `StartPlrHit`, `StartPlrBlock`, `ApplyPlrDamage`), `Source/player.h` (to-hit/AC/block accessors), `Source/missiles.cpp` (`MonsterMHit`, `MonsterTrapHit`, `PlayerMHit`, `Plr2PlrMHit`) | ~1100 | Tables, player stats, missiles | AI, Missiles |
| 9 | Death, corpses, XP & loot | `Source/monster.cpp` (`MonsterDeath`, `StartMonsterDeath`, `SpawnLoot`, `DeleteMonster*`, `M_FallenFear`), `Source/dead.{h,cpp}`, `Source/player.cpp` (`AddPlrMonstExper`), `Source/items.cpp` (`SpawnItem`, `RndItemForMonsterLevel`, `RndUItem`) | ~350 | Items, quests, lighting | Scavenger AI (eats corpses), rendering |
| 10 | Missile core (struct, fixed-point motion, 16-dir sprites, collision, lifecycle) | `Source/missiles.{h,cpp}` (`Missile`, `AddMissile`, `UpdateMissileVelocity`, `MoveMissile`, `CheckMissileCol`, `ProcessMissiles`), `Source/tables/misdat.*`, `assets/txtdata/missiles/*.tsv` | ~1500 | Dungeon grid, lighting, sound, combat | AI, player spells/attacks |
| 11 | Missile archetype catalog (≈70 add functions / 45 process functions) | `Source/missiles.cpp` | ~2700 | Missile core, combat | Spells, AI |
| 12 | Status effects (petrify, berserk, hidden/fade, mana shield, reflect, rage, infravision, stat drain, fear, invulnerable flash) | spread across `missiles.cpp`, `monster.cpp`, `player.cpp` | ~400 | Missiles, monster modes | Combat |
| 13 | Sound trigger points | `Source/effects.cpp` (`PlaySfxLoc`, `PlaySFX`), `Source/engine/sound_position.cpp`, `Source/monster.cpp` (`PlayEffect`) | ~100 | Audio backend | AI, Combat, Missiles |
| 14 | Cursor-target tracking / action repeat | `Source/track.cpp` | ~200 | Player input, pathing generation counter | Player controls |

Not in this cluster but referenced: player stat derivation (player cluster), item generation internals (items cluster),
quest state machines (quest cluster), dungeon generation flags (`dTransVal` room ids, `dFlags`) (levels cluster).

---

## 1. Monster data tables & roster

### Purpose
Static, data-driven definition of every monster *type* (base roster) and every *unique/named* monster. A level loads a
subset of types into a per-level type cache (max 24 types), and each live monster references its type by index. The
tables are TSV files parsed at startup; adding rows is how mods add monsters.

### Key data structures (genericized field lists)

**MonsterType row** (one per species/colour variant; 112 base rows, 138 with the expansion):

| Field | Type | Meaning |
|-------|------|---------|
| `id` | enum/string | Stable identifier; unknown strings are appended as new ids (mod support) |
| `name` | string | Display name |
| `spriteSetPath`, `soundSetPath`, `paletteSwapFile` | string | Asset references; colour variants share a sprite set and differ by palette-swap table |
| `availability` | `Never`/`Always`/`Retail` | `Never` = only placed by hand-made set pieces; `Retail` = not in the free demo build |
| `width` | u16 | Sprite width (px) |
| `image` | u16 | Memory budget cost of the sprite set (used by the per-level type picker; budget 4000) |
| `hasSpecial`, `hasSpecialSound` | bool | Whether a 6th "special" animation / 4th sound exists |
| `frames[6]`, `rate[6]` | i8 | Frame count and ticks-per-frame for each animation: Stand, Walk, Attack, GotHit, Death, Special |
| `minDunLvl`, `maxDunLvl` | i8 | Dungeon-depth window in which the type may be auto-selected |
| `level` | i8 | Monster level (feeds to-hit, hit-recovery threshold, item level, XP level) |
| `hpMin`, `hpMax` | u16 | Base HP range (rolled per instance) |
| `ai` | enum | Which AI routine drives it (see §7) |
| `abilityFlags` | bitset | `SEARCH` (uses A* when LOS blocked), `CAN_OPEN_DOOR`, `KNOCKBACK` (melee shoves the player), `HIDDEN` (starts invisible), plus runtime-only flags |
| `intelligence` | 0..3 | Aggression/skill knob consumed by every AI probability formula |
| `toHit` | u8 | Base melee to-hit |
| `animFrameNum` | i8 | Attack animation frame (1-based) on which the melee hit is resolved |
| `minDamage`, `maxDamage` | u8 | Melee damage range |
| `toHitSpecial`, `animFrameNumSpecial`, `minDamageSpecial`, `maxDamageSpecial` | | Same for the special attack |
| `reducePlayerStr/Mag/Dex/Vit/MaxHP/MaxMana` | u8 | Permanent stat drain applied on each successful hit (only a handful of rows use it) |
| `armorClass` | u8 | Monster AC |
| `monsterClass` | `Undead`/`Demon`/`Animal` | Weapon-type damage modifiers and holy-damage immunity key off this |
| `resistance`, `resistanceHell` | bitset | `RESIST_{MAGIC,FIRE,LIGHTNING}` (¼ damage), `IMMUNE_{MAGIC,FIRE,LIGHTNING,ACID}` (0 damage); the second set replaces the first on difficulty T2 |
| `selectionRegion` | enum | Which third of the sprite accepts mouse targeting |
| `treasure` | u16 | `0` = normal drop; `NODROP` flag; or `UNIQ | uniqueItemId` = always drops a specific unique item |
| `exp` | u16 | Base experience |

**UniqueMonster row** (98 rows):

| Field | Meaning |
|-------|---------|
| `baseType` | Which MonsterType row it is a variant of (uses that type's sprites/animations) |
| `name`, `paletteSwap` | Display name, recolour |
| `level` | Dungeon level on which it is placed (0 = placed only by script/quest logic). Monster level becomes `2 * level` (or base `level + 5` when 0) |
| `maxHp` | Fixed HP (not a range) |
| `ai`, `intelligence` | Overrides the base type's AI and INT (so a melee base type can become a charger, a sneak, etc.) |
| `minDamage`, `maxDamage` | Override; also copied to the special-attack range |
| `reducePlayer*` | Stat drains (unused in shipped data) |
| `resistance` | Single resist set (does **not** change on T2) |
| `packType` | `None` / `Independent` (spawn a group but don't leash) / `Leashed` (group stays within 3 tiles) |
| `customToHit`, `customArmorClass` | Optional overrides (0 = use base type) |
| `talkMessage` | Optional dialogue id → the monster starts in an "inquiring" (talk-to-me) goal instead of hostile |

**Runtime per-level type cache** (`CMonster`, max 24 per level): sprite data for 6 animations × 8 directions, 4×2 sound
variants, the type id, placement flags (`SCATTER` = used for random packs, `SPECIAL` = hand-placed only, `UNIQUE`), and
the corpse-sprite slot id assigned when corpses are initialised.

### Algorithms & rules
1. **Loading**: `MonstersData` is pre-sized to the number of hard-coded ids; rows whose id matches a hard-coded enum
   go to that slot, others append (cap 200 types for save compatibility). Sprite paths are de-duplicated into a path
   table so colour variants share one sprite set in memory.
2. **Type availability for a dungeon level**: `availability != Never && !(demoBuild && availability == Retail) &&
   minDunLvl <= currentLevel <= maxDunLvl`.
3. **Resistance set choice**: the live monster copies `resistance` at T0/T1 and `resistanceHell` at T2 (uniques always
   use their own single set).

### Reference tuning values — roster by tier (anonymized)
Depth windows overlap by design (each type spans 2–3 dungeon levels; successive colour variants shift the window by
1–2 levels). The table below groups the shipped base roster into archetype families. HP values are the table values;
**single-player halves them** (see §2).

**Tier A — dungeon levels 1–4 (crypt/cathedral-style)**

| Family (4 colour variants unless noted) | AI | Depth | LVL | HP | Dmg | AC | To-hit | INT | Class | Resist / Immune (T0 → T2) | XP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Slow shambler | `Zombie` | 1-2 … 3-5 | 1,2,4,6 | 4-7 … 25-40 | 2-5 … 6-22 | 5..20 | 10..30 | 0..3 | Undead | Immune magic (variant 3 +resist fire, 4 +resist lightning on T2) | 54..240 |
| Small swarming imp (spear) | `SwarmImp` | 1-2 … 3-5 | 1,3,5,7 | 1-4 … 20-36 | 1-3 … 4-8 | 0..15 | 15..30 | 0,2,2,3 | Animal | none; v3 resist fire, v4 resist lightning | 46..255 |
| Small swarming imp (sword) | `SwarmImp` | 1-2 … 3-5 | 1,3,5,7 | 2-5 … 24-36 | 1-4 … 4-12 | 10..25 | 15..30 | 0..3 | Animal | as above | 52..280 |
| Skeleton axe | `SkeletonMelee` | 1-2 … 3-5 | 1,2,4,6 | 2-4 … 12-20 | 1-4 … 4-9 | 0..15 | 20..35 | 0..3 | Undead | Immune magic; v3 +resist fire (immune T2), v4 +resist lightning | 64..264 |
| Skeleton sword | `SkeletonMelee` (v4 has `SEARCH`) | 1-3 … 4-6 | 2,4,6,8 | 3-6 … 35-50 | 2-7 … 5-14 | 10,5,15,30 | 20..40 | 0..3 | Undead | Immune magic; v3 +fire, v4 +lightning | 90..604 |
| Skeleton archer | `SkeletonRanged` | 2-3 … 4-6 | 3,5,7,9 | 2-4 … 15-45 | 1-2 … 2-9 | 0,0,5,15 | 15..35 | 0..3 | Undead | Immune magic; v3 +fire, v4 +lightning | 110..594 |
| Corpse-eating scavenger | `Scavenger` | 1-3 … 4-6 | 2,4,6,8 | 3-6 … 28-40 | 1-5 … 5-15 | 10..30 | 20..35 | 0..3 | Animal | resist fire/lightning alternating; v4 resist magic | 80..552 |
| Erratic flyer (bat) | `Bat` (v3,v4 `SEARCH`) | 2-3 … 6-8 | 3,7,9,13 | 3-6 … 20-35 | 1-6 … 4-16 | 0,15,35,35 | 35,45,70,50 | 0..3 | Animal (v4 Demon) | none; v3 resist magic; v4 resist magic + immune lightning | 102..509 |
| Invisible stalker | `Sneak` (`HIDDEN`; v2+ `SEARCH`) | 2-5 … 8-10 | 5,9,11,13 | 8-24 … 40-60 | 3-6 … 16-24 | 25..30 | 35..60 | 0..3 | Demon | none → v3 resist magic (immune T2), v4 +resist fire | 278..1500 |

Named/unique monsters placed on these levels: ~25 rows with HP 49–360, usually `Leashed` packs of the same base type
(pack size 8), levels 2–5; three are quest-talkers with scripted dialogue AIs.

**Tier B — dungeon levels 5–8 (catacomb-style)**

| Family | AI | Depth | LVL | HP | Dmg | AC | To-hit | INT | Class | Resist/Immune | XP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Horned melee brute (door-opener) | `GoatMelee` (`SEARCH, CAN_OPEN_DOOR`) | 4-6 … 7-9 | 8,10,12,14 | 30-45 … 55-70 | 4-10 … 10-20 | 40..50 | 50..80 | 0..3 | Demon | v2 resist magic (immune T2), v3 resist fire (immune T2), v4 resist magic | 460..1190 |
| Horned archer | `GoatRanged` (`CAN_OPEN_DOOR`) | 4-6 … 7-9 | 8,10,12,14 | 20-35 … 50-65 | 1-7 … 4-13 | 35..40 | 35..50 | 0..3 | Demon | as melee counterpart | 448..1092 |
| Acid spitter (leaves puddles) | `Acid` | 6-8 … 12-14 | 11,15,21,25 | 40-66 … 100-150 | 4-12 … 10-20 (special 25-40 to-hit, 0-0 dmg: puddle) | 30..35 | 40..65 | 0..3 | Animal | Immune acid; later resist magic, immune fire; T2 immune magic | 846..2940 |
| Fat bruiser (two attacks) | `Fat` (v2+ `SEARCH`) | 5-7 … 10-12 | 10,14,16,20 | 60-80 … 160-200 | 6-12 … 10-20 | 55..70 | 55..85 | 0..3 | Demon | v3 immune magic; v4 resist magic + immune fire | 635..2058 |
| Flying stone guardian (starts as statue, heals) | `Gargoyle` (`CAN_OPEN_DOOR`) | 5-7 … 10-12 | 9,13,19,23 | 45-60 … 90-150 | 10-16 … 16-28 | 45..60 | 50..95 | 0..3 | Demon | Immune magic + alternating fire/lightning resist→immune | 662..2278 |
| Worm/slug crawler (set-piece only) | `SkeletonMelee` | 5-7 … 8-10 | 11..17 | 60-90 … 125-200 | 4-10 … 10-20 | 25..35 | 40..60 | 0..3 | Animal | resist magic (+fire) | 660..1827 |

**Tier C — dungeon levels 9–12 (cave-style)**

| Family | AI | Depth | LVL | HP | Dmg | AC | To-hit | INT | Class | Resist/Immune | XP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Lava lobber (ranged + melee) | `Magma` (`SEARCH, CAN_OPEN_DOOR`) | 8-9 … 9-11 | 13,14,16,18 | 50-70 … 70-85 | 2-10 … 4-24 (special to-hit 50-60, frame 13/14) | 45..60 | 45..75 | 0..3 | Demon | Immune magic + resist/immune fire | 1076..2124 |
| Charging quadruped | `Rhino` (`SEARCH, CAN_OPEN_DOOR`) | 7-9 … 10-12 | 13,15,17,19 | 40-80 … 70-110 | 2-16 … 10-22 (charge: to-hit 100, 5-32 … 20-50) | 40..55 | 60..90 | 0..3 | Animal | v3,v4 immune magic + resist lightning; T2 v4 immune fire+lightning | 1172..1809 |
| Lightning caster (melee + bolt) | `Storm` (`SEARCH, CAN_OPEN_DOOR`) | 9-11 … 12-14 | 18,20,22,24 | 55-110 … 90-150 | 8-18 … 12-28 (special to-hit 75-80, 4-16) | 30..40 | 80..90 | 0..3 | Demon | Immune magic/resist lightning → immune lightning | 2160..3177 |
| Fire-breathing giant | `BreathGiant` (`SEARCH, CAN_OPEN_DOOR`) | 10-12 … 13-15 | 20,22,24,26 | 120-140 … 180-200 | 12-20 … 22-30 | 60..75 | 100..130 | 0..3 | Demon | resist magic + immune fire | 2300..3643 |
| Serpent (slithers in S-curve, lunges) | `Snake` (`SEARCH`) | 11-13 … 15-16 | 21,23,25,27 | 100-150 … 160-200 | 8-20 … 18-30 | 60..75 | 90..130 | 0..3 | Demon | immune magic (+fire/lightning) | 2725..3791 |

**Tier D — dungeon levels 13–16 (hell-style)**

| Family | AI | Depth | LVL | HP | Dmg | AC | To-hit | INT | Class | Resist/Immune | XP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Armoured knight (fast melee) | `SkeletonMelee` (`SEARCH`) | 12-14 … 14-16 | 24,26,28,30 | 150 … 200 (fixed) | 15-20 … 25-35 | 75..85 | 110..130 | 0,0,1,1 | Demon | resist magic + fire/lightning, up to immune magic+lightning | 3360..5130 |
| Flying ranged temptress (kites) | `Succubus` (`CAN_OPEN_DOOR`; v3,v4 `SEARCH`) | 12-14 … 15-16 | 24,26,28,30 | 120-150 … 140-225 | 1-20 … 1-35 (projectile) | 60..85 | 100..120 | 0..3 | Demon | resist magic → immune magic + fire/lightning mix | 3696..4644 |
| Teleporting mage (fades, casts, melee flash) | `TeleMage` (`CAN_OPEN_DOOR`) | 13-14 … 16 | 25,27,29,30 | 70 … 145 (fixed) | 8-20 … 15-25 | **0** | 90..120 | 0..3 | Demon | resist all three → immune magic + mixed | 4070..4968 |
| Final boss | `FinalBoss` (= ranged-avoidance with AoE) (`KNOCKBACK, SEARCH, CAN_OPEN_DOOR`) | 16 only | 30 | 1666 | 30-60 (special frame 11) | 90 | 220 | 3 | Demon | immune magic, resist fire+lightning | 31666 |

**Expansion tiers (levels 17–24, two extra biomes)** add ~25 more rows: knockback boars, melee stingers, four
"flare" casters (`FlareCasterA`, `FlareCasterB`, `Lich`, `ArchLich` — all plain ranged AI with differently coloured
projectiles), acid spider lord, fire bats (`FireBat` ranged firebolt), torch ants (`TorchInsect` ranged fireball), a
`Scavenger` grave-digger, a bone demon (`BoneDemon` ranged-avoidance, 240-280 HP, special 50-50), reapers (260-300 HP,
to-hit 120), and an uber boss (LVL 40, 1332 HP, AC 125, to-hit 150, 40-50 dmg, special 40-50, immune to everything on
T2, 13333 XP). A demon that **spawns minions as a projectile** (`SpawnerDemon`) and its 30-HP spawn type also live here.

Special-purpose rows: a player-summoned `Golem` type (LVL 12, HP 1 placeholder — real stats computed from spell level),
and a boss-only `RelentlessBoss` AI type (320 HP, AC 50, drops a fixed unique weapon, level-1 quest boss).

### Smallest buildable chunks
1. **TSV schema + loader for MonsterType** — inputs: TSV path; outputs: vector of rows keyed by id; done when every column above parses and unknown ids append.
2. **TSV schema + loader for UniqueMonster** — inputs: TSV; outputs: vector; done when base-type lookup and pack enum parse.
3. **Resistance bitset + immunity/resist query** (`isImmune(damageType)`, `isResistant(damageType)`) with the "holy damage only hurts undead" special case — done when unit tests cover all 5 damage types.
4. **Per-level type cache** (max 24) with placement flags and `AddMonsterType` de-dup — done when adding the same id twice returns the same index and ORs the flags.
5. **Sprite-budget type picker** — inputs: current depth, availability, `image` costs; output: list of scatter types; done when it stops at 24 types or budget 4000 (see §2).
6. **Animation metadata table** (6 anims × frames/rate) + lazy sprite loading per type — done when a headless build can run without sprites.
7. **Sound set loader** (4 categories × 2 variants, skip special when flag false).
8. **Corpse-slot assignment per type** (max 31 corpse sprites incl. uniques + shatter) — done when `InitCorpses` assigns ids deterministically.
9. **Monster class → weapon-type damage modifier table** (used by combat; see §8).
10. **Roster authoring spreadsheet** with the tier tables above as the starting balance.

### Pitfalls / design lessons
* Keep `level` separate from `minDunLvl/maxDunLvl`: level drives all combat math; depth window only drives selection.
* Colour variants that share sprites but differ in stats are extremely cheap content; the engine's path-dedup makes
  them free in memory. Budget by sprite bytes (`image`), not by row count.
* Treat `intelligence` as the single difficulty knob per row; every AI formula is written as `a*INT + b` so a designer
  can reason about it.
* The T2 resistance override is a separate column, not a formula — it allows hand-tuned immunities per variant instead
  of a blanket rule, which is why late-game variants become "immune to the element you were using".
* Uniques keep a single resist set across difficulties; forgetting this creates inconsistent difficulty curves.

---

## 2. Level population & spawning

### Purpose
On level load, choose which monster types appear, instantiate scattered packs across walkable tiles, place quest/unique
monsters at scripted locations, hand-place monsters from set-piece map files, reserve summon slots, and apply difficulty
scaling to every instance. Also handles dynamic spawning during play (summoners, spawn projectiles, summon spells) with
multiplayer ownership rules.

### Key data structures
* `Monsters[200]` – fixed pool of monster instances; `ActiveMonsters[200]` – index list, first `ActiveMonsterCount`
  entries are live (swap-remove on delete). Slots 0–3 are **reserved for player summons** (one per player).
* `dMonster[x][y]` – occupancy grid: `+id+1` when standing, `-(id+1)` when the tile is the *destination* of a walking
  monster (both tiles are reserved during a step).
* `dTransVal[x][y]` – room/region id; "same room" tests compare these.
* Per-instance fields set at spawn: `maxHitPoints`, `hitPoints` (26.6), `ai`, `intelligence`, `goal`, `goalVar1..3`,
  `var1..3`, `position{tile,future,old,last,temp}`, `direction`, `mode`, `animInfo`, `enemy`, `enemyPosition`,
  `activeForTicks`, `flags`, `rndItemSeed`, `aiSeed`, `minDamage..maxDamageSpecial`, `armorClass`, `resistance`,
  `reducePlayer*`, `leader`, `leaderRelation`, `packSize`, `lightId`, `uniqueType`, `talkMsg`, `whoHit` (bitmask of
  players who damaged it), `corpseId`, `levelType` (index into the type cache).

### Algorithms & rules

**2.1 Instance initialisation (`InitMonster`)** — for a type row `T`:
```
direction = given; tile = future = old = position; mode = Stand
animInfo = Stand anim; tickCounter = rand(ticksPerFrame-1); currentFrame = rand(numberOfFrames-1)   // desync idle loops
maxHP = randBetween(T.hpMin, T.hpMax)
if (!multiplayer) maxHP = max(maxHP / 2, 1)                      // single-player halves monster HP
hp = maxHP
ai, intelligence, damage ranges, AC, drains, resistance(T0 set), flags = T.abilityFlags
goal = Normal; activeForTicks = 0; rndItemSeed = advanceSeed(); aiSeed = advanceSeed(); whoHit = 0
if ai == Gargoyle: start in Special anim frame 0, flags |= ALLOW_SPECIAL, mode = SpecialMeleeAttack   // "statue" pose
difficulty scaling (below)
```

**2.2 Difficulty scaling at spawn (reference tuning values)** — applied to normal and unique monsters alike:

| Stat | T0 | T1 | T2 |
|---|---|---|---|
| Max HP | `base` | `3*base + 100` (expansion: +50 SP / +100 MP) | `4*base + 200` (expansion: +100 SP / +200 MP) |
| Min/Max damage (both normal and special) | `d` | `2*(d + 2)` | `4*d + 6` |
| Armor class | `ac` | `ac + 50` | `ac + 80` |
| To-hit (normal & special) | `th` | `th + 85` | `th + 120` |
| Monster level | `L` | `L + 15` | `L + 30` |
| Experience | `xp` | `2*(xp + 1000)` | `4*(xp + 1000)` |
| Resistances | `resistance` | `resistance` | `resistanceHell` |

Uniques: `level = uniqueLevel != 0 ? 2*uniqueLevel : baseLevel + 5`; XP additionally `*2`; AC override only applies
if `customArmorClass != 0` (then +50/+80 as above). Leashed minions of a unique get **`maxHP *= 2`** and inherit the
leader's INT.

**2.3 Type selection per level (`GetLevelMTypes`)**:
1. Always add the summon type (flag `SPECIAL`).
2. Final-boss level: add two fixed types + boss, return.
3. Expansion levels add their fixed scatter/unique types by depth.
4. Add quest-boss base types if their quest is active; for a mid-game "skeleton king" quest in co-op add the boss type
   plus one random skeleton variant.
5. Build `typelist` of all available types for this depth. Loop while `typelist` non-empty, cache < 24, and
   `spriteBudgetUsed < 4000`: remove any type whose `image > 4000 - used`; pick one uniformly at random; add it with
   flag `SCATTER`; remove it from the list.

**2.4 Population count (`InitMonsters`)**:
```
walkable = count of non-solid tiles in the 80x80 interior (x,y in [16,96))
numToPlace = walkable / 30
if multiplayer: numToPlace += numToPlace / 2
cap so that ActiveMonsterCount + numToPlace <= 200 - 10
while ActiveMonsterCount < total:
    type = random SCATTER type
    packSize = (depth == 1 || flipCoin()) ? 1
             : (depth == 2 || biome == crypt) ? randBetween(2,3)
             : randBetween(3,5)
    PlaceGroup(type, packSize)
```
Before placement, vision is temporarily cast (radius 15) from every stairs trigger so that nothing spawns in view of
the entrance; it is removed afterwards.

**2.5 Pack placement (`PlaceGroup(type, num, leader?, leashed?)`)** — up to 10 attempts:
```
undo any monsters placed by the previous failed attempt
if leader: start = leader.tile + randomDirection(8)
else:      do start = (rand(80)+16, rand(80)+16) while !CanPlace(start)
cap num so total <= totalmonsters
placed = 0; tries2 = 0; p = start
while placed < num && tries2 < 100:
    if !CanPlace(p) || room(p) != room(start) || (leashed && (|p.x-start.x| >= 4 || |p.y-start.y| >= 4)):
        tries2++
    else:
        PlaceMonster(type, p); if leader: minion.maxHP *= 2, minion.INT = leader.INT, leashed → setLeader
        placed++
    p += (randomDirection.deltaX, randomDirection.deltaX)   // NB: original bug uses deltaX for both axes → packs drift diagonally
if placed >= num break
if leashed: leader.packSize = placed
```
`CanPlace(p)`: in bounds, no monster, no player, **not currently visible**, not inside a set piece, tile not occupied
(no object/solid).

**2.6 Unique placement**: quest uniques have hard-coded offsets relative to their set piece; otherwise random
`(rand(80)+16, rand(80)+16)` requiring **≥ 9 placeable tiles in the surrounding 6×6** (up to 1000 tries, then any
placeable tile). `PrepareUniqueMonst` then overrides stats from the unique row, adds a light radius 3, sets the
talk goal if it has dialogue, applies difficulty scaling, and spawns its pack (`bosspacksize` = 8 normally, 30 for
the skeleton-king co-op variant) via `PlaceGroup`.

**2.7 Set-piece monsters (`SetMapMonsters`)**: map files carry a monster layer at 2× mega-tile scale; each non-zero
cell maps through a conversion table to a type id, which is added with flag `SPECIAL` and placed at `origin + (i, j)`.

**2.8 Dynamic spawn (`SpawnMonster`)**: only the *level owner* client executes it; it reserves the next index, snapshots
the RNG state as the spawn seed, initialises locally, and broadcasts `(pos, dir, typeIndex, monsterIndex, seed)`.
Receivers `InitializeSpawnedMonster`: re-seed RNG, mark the index active, and if the requested tile is occupied,
spiral-search (`Crawl` radius 0..MaxCrawlRadius) for the nearest free tile. Skeletons and summons start in
`SpecialStand` (rise-from-ground animation), others in `Stand`.

**2.9 Summon (golem) stats** (`InitGolem(owner, SLVL)`):
```
maxHP(raw26.6) = 2 * (320*SLVL + owner.maxMana.raw/3)   → whole HP ≈ 10*SLVL + maxMana/96
AC = 25
toHit = 5*(SLVL + 8) + 2*CLVL
minDmg = 2*(SLVL+4); maxDmg = 2*(SLVL+8)
flags |= GOLEM; goalVar3 = ownerId
```
Recasting while one is alive kills the old one. A summon occupies reserved slot = owner index when free.

**2.10 Pre-spawned container skeletons** (`PreSpawnSkeleton`/`ActivateSkeleton`): a random skeleton type present on
the level is created off-map; when the container opens it is placed on the target tile or, if blocked, on one of the 8
neighbours chosen as `rand(15) % freeCount`, facing back toward the container.

**2.11 Doppelganger** (an item affix): on hit, 10% chance to spawn a copy of the struck (non-unique, non-final-boss)
monster on any free neighbouring tile.

### Reference tuning values
| Constant | Value |
|---|---|
| Max monsters per level | 200 (10 kept in reserve for dynamic spawns; 4 reserved summon slots) |
| Max types per level | 24 |
| Sprite memory budget | 4000 units |
| Density | 1 monster per 30 walkable tiles (+50% in multiplayer) |
| Pack size by depth | d1: 1; d2/crypt: 1 or 2–3; else 1 or 3–5 (50% chance of a lone monster) |
| Unique pack size | 8 (30 for the co-op skeleton boss) |
| Leash radius at placement | < 4 tiles in both axes |
| Unique light radius | 3 |
| Single-player HP | ½ table value (min 1) |
| Spawn-exclusion radius around stairs | vision radius 15 from a 4×4 block around each trigger |

### Smallest buildable chunks
1. Monster instance pool + active index list with swap-remove and reserved summon slots — done when delete keeps live entries contiguous.
2. `InitMonster` (stat roll, idle-frame desync, SP halving) — done when 1000 spawns produce HP in `[min,max]`.
3. Difficulty scaling function (table above) for normal + unique — unit-test the three tiers.
4. `CanPlace` predicate (bounds, occupancy, visibility, set-piece exclusion).
5. Type picker with sprite budget and SCATTER/SPECIAL/UNIQUE flags.
6. Density calculation + pack-size roll per depth.
7. `PlaceGroup` with retry/undo semantics and room constraint (fix or keep the diagonal-drift bug deliberately).
8. Unique placement: scripted offsets + "9 free tiles in 6×6" random fallback.
9. `PrepareUniqueMonst` (overrides, light, talk-goal, pack spawn, palette swap index).
10. Set-piece monster layer importer.
11. Dynamic spawn protocol: owner-only execution, RNG seed capture, nearest-free-tile fallback on receive.
12. Summon stat formula + slot reuse + recast-kills-old rule.
13. Pre-spawned container monster + 8-neighbour activation.
14. Stairs vision exclusion wrapper around population.

### Pitfalls / design lessons
* Spawn **outside the player's current vision**; the exclusion uses the same vision routine players use, so it is
  consistent with what the player can see on arrival.
* Keep the RNG seed per spawned monster (`rndItemSeed`, `aiSeed`) so loot and AI are reproducible across clients.
* Halving HP for single player is a blunt but effective pacing tool; apply it *before* difficulty multipliers.
* The T1/T2 damage formulas add a flat bonus before multiplying so that 1-damage trash still becomes dangerous.
* Minion HP doubling plus leader INT inheritance makes a unique's pack a real threat without new data rows.

---

## 3. Monster runtime state machine

### Purpose
Every monster is in exactly one **mode**; the per-tick loop runs the AI (which may change mode), then advances the mode
handler, then advances the animation. Mode handlers resolve attack frames, movement completion, death, fades, etc.

### Key data structures
**Modes**: `Stand`, `MoveNorthwards`, `MoveSouthwards`, `MoveSideways` (three walk modes chosen by facing so the
renderer knows which tiles the sprite overlaps), `MeleeAttack`, `HitRecovery`, `Death`, `SpecialMeleeAttack`,
`FadeIn`, `FadeOut`, `RangedAttack`, `SpecialStand`, `SpecialRangedAttack`, `Delay`, `Charge`, `Petrified`, `Heal`,
`Talk`.

**Goals** (AI-level intent, orthogonal to mode): `None`, `Normal`, `Retreat`, `Healing`, `Move` (circling/flanking),
`Attack` (swarm frenzy), `Inquiring` (quest NPC waiting to be talked to), `Talking`.

**Animation info**: sprite list for the current direction, `numberOfFrames`, `ticksPerFrame`, `currentFrame`,
`tickCounterOfCurrentFrame`, `isPetrified`; `isLastFrame() = currentFrame >= numberOfFrames-1`. Flags on new anim:
`ProcessAnimationPending` (first tick already counts), `SkipsDelayOfLastFrame`, skipped frames, distribute-before-frame
(used to spread the special-attack windup).

**Runtime flags**: `HIDDEN`, `LOCK_ANIMATION` (play backwards / hold), `ALLOW_SPECIAL` (gargoyle statue / giant
breath channel), `TARGETS_MONSTER`, `GOLEM`, `QUEST_COMPLETE`, `KNOCKBACK`, `SEARCH`, `CAN_OPEN_DOOR`, `NO_ENEMY`,
`BERSERK`, `NOLIFESTEAL`.

**Scratch vars**: `var1/var2/var3` are mode-local (walk delta x/y/dir; ranged missile type/damage; delay counter;
previous mode after `StartStand`; death tick counter); `goalVar1..3` are AI-local.

### Algorithms & rules

**3.1 Per-tick process loop (`ProcessMonsters`)**:
```
purge invalid monsters
for each active monster m:
    FollowTheLeader(m)                                   // §6
    if multiplayer: seed RNG with m.aiSeed; m.aiSeed = advance()   // deterministic AI per monster
    regen: if hp < maxHP: hp += raw(LVL > 1 ? LVL/2 : LVL); clamp to max    // i.e. LVL/128 HP per tick
    visible = IsTileVisible(m.tile)
    if visible && m.activeForTicks == 0: (boss greeting sounds) ; UpdateEnemy(m)   // first sighting
    if has enemy: enemyPosition = enemy.future; if visible or enemy is a monster: position.last = enemy.future
    if not targeting a monster:
        if visible: activeForTicks = 255
        else if activeForTicks != 0 && !finalBoss: activeForTicks--
    loop:
        if !(SEARCH flag && AiPlanPath(m)): AiProc[m.ai](m)      // path-follow pre-empts the archetype AI
        if !UpdateModeStance(m): break                             // handler returns true when the mode ended this tick → re-think immediately
        GroupUnity(m)
    if mode != Petrified && !ALLOW_SPECIAL: animInfo.processAnimation(reverse = LOCK_ANIMATION)
purge invalid monsters
```
The inner `loop` is important: when an action completes mid-tick (e.g., walk finished), the AI is consulted again in the
same tick so monsters chain actions without a dead tick.

**3.2 Mode handlers (`UpdateModeStance`)** — returns true when the mode finished:

| Mode | Handler behaviour |
|---|---|
| Stand | Load Stand (or Walk for the summon, which has no stand anim). On last frame: `UpdateEnemy`. `var2++` (ticks standing, saturating) |
| Move* | On last frame: clear old tile, `tile += (var1,var2)`, occupy, move light, `StartStand`. Returns true at end |
| MeleeAttack | On `currentFrame == animFrameNum-1`: `MonsterAttackEnemy(toHit, minDmg, maxDmg)` + attack sound. Lava-lobber family also hits on frame 8 with `toHit+10, dmg-2`; lightning-caster family also on frame 12 with `toHit-20, dmg+4`. Serpent plays its sound on frame 0 instead. On last frame → Stand |
| RangedAttack | On `animFrameNum-1`: fire `var1` missile type (3 missiles if the type is the zig-zag bolt) toward `enemyPosition` with damage `var2`; sound. Last frame → Stand |
| SpecialRangedAttack | On `animFrameNumSpecial-1` and first tick of that frame (and for the breath-giant only when `var2==0`): fire `var1` missile with damage `var3`, special sound. Breath giant: holds the frame (`ALLOW_SPECIAL`) from `var2==0` until `var2==15` (15-tick channel). Last frame → Stand |
| SpecialMeleeAttack | On `animFrameNumSpecial-1`: `MonsterAttackEnemy(toHitSpecial, minSpec, maxSpec)`. Last frame → Stand |
| HitRecovery | Last frame → Stand |
| Death | `var1++`. Final boss: pan camera toward it, at tick 140 trigger ending. Others: on last frame add corpse, clear tile, mark invalid, update pack relations |
| SpecialStand | Special sound on `animFrameNumSpecial-1`; last frame → Stand (used for rising/spawning/idle roar) |
| FadeIn / FadeOut | Wait until frame 0 (if reversed) or last frame; FadeOut sets `HIDDEN`; both → Stand |
| Delay | Face enemy, `var2--`; when it hits 0 → Stand keeping the current frame (looks like continued idling). Scripted mage boss caps delay at 8 |
| Petrified | No anim; if hp <= 0 → clear tile, mark invalid (shatter handled by the curse missile) |
| Heal | On frame 0: `hp += var1` (raw) until full, then `mode = SpecialMeleeAttack` (fold wings back) |
| Talk | Stand, goal = Talking, start dialogue if not already playing; fires quest side effects (open walls, set quest vars) |
| Charge | No handler: the charge *missile* moves the monster (see §11) |

**3.3 Start helpers**: `StartAttack/StartSpecialAttack` face the enemy and begin the anim; `StartRangedAttack(type,dmg)`
stores type in `var1`, damage in `var2`; `StartRangedSpecialAttack` stores damage in `var3`; `StartSpecialStand`;
`StartFadein/out(backwards)` (reverse playback via `LOCK_ANIMATION`, start at last frame); `StartHeal`:
`var1 = (maxHP / (16 * (rand(5)+4))).raw` → heals 1/64..1/128 of max HP per heal pulse (doc comment: "1.47%–25%");
`M_StartStand(dir)` clears scratch vars, records previous mode in `var1`, `var2 = 0`, `UpdateEnemy`.

**3.4 Hit reaction (`StartMonsterGotHit`)**: new GotHit anim (summon has none), snap `tile = future = old` (cancels an
in-progress step), clear reserved squares, re-occupy.

### Reference tuning values
| Item | Value |
|---|---|
| Logic rate | 20 ticks/s |
| Passive regen | `LVL/2` raw per tick (= `LVL/128` HP/tick; ≈ `LVL * 0.156` HP/s) |
| Breath-channel hold | 15 ticks |
| Final boss death cinematic delay | 140 ticks |
| Idle loop desync | random start frame + random tick counter |
| Multi-shot bolt count | 3 |
| Typical ticks-per-frame | Stand 1–5 (table `rate[0]`), everything else 1–2 |

### Smallest buildable chunks
1. Mode + goal enums and the `Monster` struct with scratch vars.
2. Animation-info component with ticksPerFrame, reverse playback, `isLastFrame`, distribution flags.
3. `StartStand/StartAttack/StartRanged*/StartSpecial*/StartFade*/StartHeal/StartDelay` helpers.
4. Per-tick loop skeleton (regen, visibility → `activeForTicks`, AI call, mode handler, re-think loop, animation step).
5. Walk mode handler with two-tile reservation and light sync.
6. Melee/special melee handlers with hit-frame resolution + multi-hit-frame families.
7. Ranged/special-ranged handlers incl. channel hold and multi-missile.
8. HitRecovery/Death/Petrified/Heal/Fade/Delay/SpecialStand handlers.
9. Talk mode hook that defers to a quest callback.
10. Deterministic per-monster RNG seeding for multiplayer.

### Pitfalls / design lessons
* Resolve hits on a specific animation frame (data-driven `animFrameNum`), not at animation end — it makes attack
  timing readable and allows dodging by stun.
* Record the *previous* mode on returning to Stand (`var1`) and ticks-standing (`var2`): several AIs use "was I just
  walking / delayed?" and "have I stood > 20 ticks?" as cheap hysteresis.
* The re-think loop prevents a wasted tick between actions, which is why monsters feel responsive at 20 Hz.
* `Petrified` must bypass animation stepping but still allow death cleanup.

---

## 4. Perception, targeting & wake-up

### Purpose
Decide *whom* a monster targets, *whether* it is awake, and *where* it believes its target is, plus the line-of-sight
primitives shared with projectiles.

### Key data structures
* `activeForTicks` (u8): 0 = dormant, 255 = fully awake (sees target), decays by 1 per tick when out of view.
* `enemy` + `TARGETS_MONSTER` flag: index into players or monsters; `NO_ENEMY` flag when none.
* `enemyPosition`: target's *future* tile (where it is walking to) — used for direction and distance.
* `position.last`: last known target position (used for pursuit when out of view).
* Dungeon flags per tile: `Visible` (in some player's vision), `Lit`, `Missile`, `MissileFireWall`,
  `MissileLightningWall`; `dTransVal` room ids.

### Algorithms & rules

**4.1 Target selection (`UpdateEnemy`)** — called on first sighting, when returning to Stand (last stand frame), and
by some AIs each think:
```
best = none
if not a player-minion:
  for each player p active on this level, not changing level, (alive in MP):
      sameRoom = room(me) == room(p); dist = chebyshev(me, p)
      if (sameRoom && !bestSameRoom) || ((sameRoom || !bestSameRoom) && dist < bestDist) || best == none:
          best = p (target = p.future)
for each other live monster o (skip self, dead, parked summons, quest talkers, and other summons if I am a summon):
      dist = chebyshev
      skip unless: (I am a summon or berserk) OR (o is a summon/berserk AND (dist < 2 OR I am ranged))
         // i.e. ordinary monsters only engage summons when adjacent, or at any range if they are shooters
      same room/distance preference as above
if best: clear NO_ENEMY, set enemy, enemyPosition else set NO_ENEMY
```
Preference order: same room beats closer; among same-room candidates, closer wins. Ranged AIs are: skeleton archer,
horned archer, temptress, scripted temptress.

**4.2 Wake-up**: a monster becomes `activeForTicks = 255` when (a) its tile is in player vision, (b) it is damaged
(`activeForTicks == 0 → 255`, `last = attacker tile`), (c) a summon attacks it (and every monster in the 5×5 around the
summon wakes), (d) its leader/minion is more awake (pack contagion, §6). While dormant most AIs return immediately
(`activeForTicks == 0` guard); only the shambler checks `IsTileVisible` directly, and the stone guardian updates its enemy
while posing.

**4.3 Pursuit memory**: while awake but out of view, the monster heads toward `position.last` (`GetDirection(tile, last)`)
and `activeForTicks` decays; at 0 it goes dormant where it stands. The final boss never decays.

**4.4 Line of sight primitives** (`LineClear(predicate, a, b)`): Bresenham walk from `a` to `b` (swapping endpoints so
the major axis increases), testing `predicate` on each intermediate tile except the start; returns true if `b` is
reached. Variants: `IsLineNotSolid` (walls only; pack reunion), `LineClearMissile` (tiles that block missiles),
`LineClearMovingMissile` (missile-blocking tiles **or** objects that block missiles, e.g. closed doors), and the AI
"can I charge" check (`IsTileAvailable`: no actor, walkable, not standing in a hostile wall spell).

**4.5 Player vision (`DoVision`)** — used for the `Visible` flag that wakes monsters and for spawn exclusion: 23
pre-tabulated rays per quadrant of up to 15 steps (Bresenham-shaped), mirrored into 4 quadrants, ray length
`radius - RayLenAdj[j]` (adj table `0,0,0,0,1,1,1,2,2,2,3,4,3,2,2,2,1,1,1,0,0,0,0` rounds the square into a circle).
For diagonal rays, a tile is visible only if at least one of its two axis-adjacent neighbours (toward the viewer)
passes light — this blocks peeking through diagonal wall gaps. A tile that is visible but opaque ends the ray.

### Reference tuning values
| Item | Value |
|---|---|
| Awake value | 255 ticks (12.75 s of memory after losing sight) |
| Summon wake radius | 5×5 |
| Player vision radius | typically 15 (light radius dependent; spawn exclusion uses 15) |
| Vision rays | 23 per quadrant × 15 steps |
| Engagement rule vs summons | adjacent (dist < 2) unless shooter |

### Smallest buildable chunks
1. Dungeon flag grid (`Visible`, `Lit`, missile flags) and room-id grid accessor.
2. `DoVision` ray caster with diagonal-gap rule (table-driven rays).
3. `LineClear` Bresenham with pluggable predicate + the three standard predicates.
4. `UpdateEnemy` with room preference and summon engagement rules.
5. `activeForTicks` wake/decay logic in the process loop + damage-wakes rule.
6. `position.last` pursuit memory.
7. Unit test: monster in adjacent room but closer is *not* preferred over a farther same-room player.

### Pitfalls / design lessons
* "Same room first" targeting prevents monsters from pathing through walls toward a player they technically are
  closer to; it is a cheap substitute for reachability tests.
* Decaying awareness (255 ticks) gives natural leash-back behaviour without explicit leash zones.
* Target the enemy's *future* tile, not current, so melee monsters do not swing at the tile the player just left.

---

## 5. Movement, pathing & doors

### Purpose
Local steering primitives (one step at a time), fallback A* when the direct line is blocked, flanking "round walk",
corner-cutting rules shared with players, door opening, and the ring/spiral searches used for placement.

### Key data structures
* Eight compass directions; `Left(d)/Right(d)` = 45° turns; `Opposite(d)`.
* A* node pool: 1024 nodes, hashed explored set (64 buckets × 48), path output as up to `MaxPathLengthMonsters = 25`
  step codes (players: 100).
* `pathCount` per monster: counts consecutive thinks where the direct line was blocked.

### Algorithms & rules

**5.1 Step legality (`IsRelativeMoveOK(m, from, dir)`)**: destination in bounds, `IsTileAvailable` (no player/monster,
walkable, not in a hostile wall spell); plus **corner cutting**: moving E requires `from+SE` not solid; W requires
`from+SW`; N requires both `from+NE` and `from+NW` not solid; S requires `from+SW` and `from+SE`. (The player version
`CanStep` checks the two tiles flanking the destination for all four cardinal steps.)

**5.2 `DirOK(m, dir)`** = `IsRelativeMoveOK` **and** pack constraints: a leashed minion may only step to a tile within
Chebyshev distance < 4 of its leader's future tile; a leader with leashed minions may only step if the count of its
leashed minions within the 7×7 around the destination equals its `packSize` (it refuses to leave minions behind).

**5.3 `Walk(m, dir)`**: if `DirOK` → `WalkInDirection`: choose Move mode by facing group, set `old = tile`,
`future = tile + dir`, reserve `future` with negative id, store deltas in `var1/var2`, start Walk anim with
`ProcessAnimationPending` and `-1` skipped frames.

**5.4 `RandomWalk(m, dir)`** — try `dir`, then (coin flip order) `Right/Left`, then (coin flip) `Left²/Right²`; walk the
first legal. Never tries backward directions. `RandomWalk2` tries only `dir`, `Right`, `Left`.

**5.5 `RoundWalk(m, dir, &turnFlag)`** (flanking/circling): try 90° turn (side chosen by `turnFlag`), then 45°, then
straight; if all fail flip `turnFlag` and `RandomWalk(Opposite(90°turn))`. Used by the "Move" goal of avoidance AIs.

**5.6 Pathing pre-emption (`AiPlanPath`)** — only for `SEARCH`-flagged monsters (summon always):
```
require awake, Stand mode, goal in {Normal, Move, Attack}, not parked
clear = LineClear(walkable && safe, tile, enemyPosition)
if !clear || 5 <= pathCount < 8:
    if CAN_OPEN_DOOR: MonstCheckDoors
    pathCount++
    if pathCount < 5: return false            // tolerate 4 blocked thinks before paying for A*
    if AiPlanWalk(): return true              // A* then RandomWalk(first step)
pathCount = 0 (except summon); return false
```
`AiPlanWalk` runs A* (`CanStep`, `IsTileAccessible` = free + walkable-ignoring-doors-if-can-open + safe) to the enemy
with max 25 steps and converts the first step code to a direction via `{S, NE, NW, SE, SW, N, E, S, W}`.

**5.7 A\*** (`FindPath`): costs 100 axis / 101 diagonal (to discourage zig-zag), admissible heuristic
`min(dx,dy)*101 + |dx-dy|*100`; early-out if heuristic > `101*maxLen`; destination may be non-walkable (attack target);
tie-breaks: lower h, then diagonal step preferred, then coordinates; lazy deletion via `g+h <= f` check; bucket overflow
simply refuses new nodes.

**5.8 Doors (`MonstCheckDoors`)**: each think while awake-but-not-fully (`activeForTicks < 255`) or when the path is
blocked, open any closed door on the 8 neighbours.

**5.9 Ring search (`Crawl(minR, maxR, fn)`)** — visits displacements ring by ring: `(0,±r)`, then `(±x,±r)` for
`x in 1..r-1`, then the four inset corners `(±(r-1), ±(r-1))`, then `(±r,0)`, then `(±r,±y)`. Corners are inset by one
so the ring is a rounded square. `FindClosestValidPosition(pred, start, minR=0, maxR=18)` returns the first match;
MaxCrawlRadius supports up to 50.

**5.10 Tile safety (`IsTileSafe`)**: a monster not immune to fire avoids tiles flagged `MissileFireWall`; not immune to
lightning avoids `MissileLightningWall` (the final boss fears both regardless). Applied in `IsTileAvailable`, A*, and
the "is the direct line clear" test, so monsters route around wall spells.

**5.11 Teleport blink (`Teleport`)** (used by the blinking bat variant on hard hits): pick random signs `rx, ry ∈ {-1,1}`;
scan `j∈{-1,0,1}, k∈{-1,0}` around `enemyPosition` for `(ex + rx*j, ey + ry*k)` not sharing the monster's row or column
and available; move there instantly and face the enemy.

### Reference tuning values
| Item | Value |
|---|---|
| Monster A* max steps | 25 |
| Blocked-thinks before A* | 5 (and again while 5..7) |
| Step costs | 100 / 101 |
| Node pool | 1024; explored buckets 64 × 48 |
| Leash step radius | < 4 |
| Leader minion-check box | 7×7 around destination |
| Crawl default max radius | 18 (hard max 50) |

### Smallest buildable chunks
1. Direction enum with Left/Right/Opposite and displacement table (note the isometric mapping: S = (+1,+1)).
2. `IsRelativeMoveOK` with corner-cut rules; `CanStep` player variant.
3. Two-tile reservation walk (`WalkInDirection`) + completion in the Move handler.
4. `RandomWalk`, `RandomWalk2`, `RoundWalk`.
5. `Crawl` ring iterator + `FindClosestValidPosition`.
6. A* with fixed pools, 100/101 costs, lazy deletion, non-walkable destination allowance.
7. `AiPlanPath` with `pathCount` hysteresis and step-code → direction map.
8. Door-opening hook for `CAN_OPEN_DOOR`.
9. `IsTileSafe` hazard avoidance from dungeon flags.
10. Pack-aware `DirOK` (leash and don't-abandon rules).
11. Blink teleport helper.

### Pitfalls / design lessons
* Monsters default to *greedy* steering; A* is a fallback with hysteresis. This keeps 200 monsters cheap and makes
  movement look organic.
* Reserve both source and destination tiles during a step or two actors will path into each other.
* Make hazard avoidance part of walkability so every movement primitive honours it for free.
* 101 vs 100 diagonal cost is a tiny nudge that dramatically improves path aesthetics.

---

## 6. Packs, leaders & minions

### Purpose
Group behaviour for unique-led packs: minions stay near the leader, share awareness, re-join when separated, and are
released on the leader's death.

### Key data structures
`leader` (index or NoLeader), `leaderRelation ∈ {None, Leashed, Separated}`, `packSize` on the leader (count of
currently leashed minions). `setLeader(l)` also copies the leader's AI id onto the minion.

### Algorithms & rules
* **Placement**: `PlaceGroup(..., leader, leashed)` (§2.5) sets `leader`, doubles minion HP, copies INT; leader
  `packSize = placed`.
* **`FollowTheLeader(minion)`** (start of each tick): if leashed and leader is more awake: `last = leader.tile`,
  `activeForTicks = leader.activeForTicks - 1`. Stone-guardian minions unfold from statue pose when the leader does.
* **`GroupUnity(m)`** (after each completed action): if LOS (walls only) to leader's future tile: a `Separated` minion
  within distance < 4 re-leashes (`packSize++`); else a `Leashed` minion becomes `Separated` (`packSize--`). While
  leashed, awareness also flows minion → leader (`leader.activeForTicks = minion.activeForTicks - 1`, `leader.last =
  minion.tile`), and a posing stone-guardian leader unfolds.
* **Movement constraints**: see `DirOK` (§5.2).
* **Scavenger exception**: a scavenger below half HP leaves its pack permanently to go eat.
* **Death**: leader death → `ReleaseMinions` (relation None, AI kept); minion death → `packSize--`.
* **Health-bar/colour**: leashed minions are drawn with a distinct colour; the dangling leader index is intentionally
  kept after release for that reason.

### Reference tuning values
| Item | Value |
|---|---|
| Leash reunion distance | < 4 |
| Awareness propagation | `other - 1` per hop per tick |
| Minion HP | 2× rolled HP |
| Minion INT | = leader INT |

### Smallest buildable chunks
1. Leader/relation fields + `setLeader` (copies AI).
2. `FollowTheLeader` awareness propagation.
3. `GroupUnity` separation/reunion with LOS test.
4. `DirOK` pack rules (shared with §5).
5. Release/shrink on death.
6. Debug overlay colouring leashed minions.

### Pitfalls / design lessons
* Copying the leader's AI onto minions turns any base type into a themed pack with no extra data.
* The "leader refuses to abandon minions" rule can make a boss appear stuck; cap it with the LOS-based separation so a
  stuck minion is released rather than freezing the boss.


---

## 7. AI archetype routines

### Purpose
Each monster type names one of ~40 AI ids; the dispatch table maps them onto **25 distinct routines** (several ids
share a routine and differ only by the projectile they fire). Every routine runs once per tick while the monster is in
`Stand` mode (most also require `activeForTicks != 0`), reads `INT`, distance to the enemy, a fresh `v = rand(100)`
(or `rand(10000)`), the previous mode (`var1`) and ticks-standing (`var2`), and starts exactly one action (walk,
attack, delay, fade, special) or nothing.

### Key data structures
Dispatch table (AI id → routine). Shared helpers: `AiDelay(len)` (mode Delay for `len` ticks; the scripted mage boss
ignores it), `GetMonsterDirection` (toward `enemyPosition`), `md = GetDirection(tile, last)` (toward last-known
position — most melee AIs steer by this), `checkStandAnimationIsLoaded(dir)` (turn to face without changing mode).

Common building block used in nearly every routine — the **walk gate**:
```
WALK_GATE(a, b) := (var2 > 20 && v < a) || (prevMode was a Move && var2 == 0 && v < b)
```
i.e. "if I've stood more than 20 ticks, walk with probability a%; if I *just* finished a step, continue with
probability b%". The second clause is what produces continuous pursuit; the first clause breaks idle stalls.

### Algorithms & rules — the catalog

Notation: `D` = Chebyshev distance to enemy, `I` = INT, `v` = `rand(100)` unless stated, `sameRoom` =
`room(me) == room(enemyPosition)`, `awake` = `activeForTicks == 255`.

**7.1 Slow shambler (`Zombie`)** — melee, only moves when *it is visible to the player* (no memory pursuit).
```
if !visible(tile): return
if v < 2I + 10:                                  // 10..16% think rate per tick
    if D >= 2:
        if D >= 2I + 4:  d = facing; if rand(100) < 2I + 20: d = random8; Walk(d)   // far away: wander, occasionally random
        else: RandomWalk(toward enemy)
    else: StartAttack
face current direction
```

**7.2 Fat bruiser (`Fat`/"Overlord")** — melee with a second, heavier attack.
```
face enemy
if D >= 2: if WALK_GATE(4I+20, 4I+70): RandomWalk(toward enemy)
elif v < 4I+15: StartAttack
elif v < 4I+20: StartSpecialAttack             // 5% window for the special
```

**7.3 Skeleton melee (`SkeletonMelee`)** — the default melee routine (also used by many late-game brutes and by
several uniques via AI override).
```
md = toward last-known; face md
if D >= 2:
    if prevMode == Delay || rand(100) >= 35 - 4I: RandomWalk(md)     // 65..77% walk; else pause
    else AiDelay(15 - 2I + rand(10))                                 // 15..24 ticks (I=0) … 9..18 (I=3)
else:
    if prevMode == Delay || rand(100) < 2I + 20: StartAttack        // 20..26% swing chance per tick; guaranteed after a pause
    else AiDelay(2(5 - I) + rand(10))                                // 10..19 (I=0) … 4..13 (I=3)
```

**7.4 Skeleton archer (`SkeletonRanged`)** — ranged kiter, backs away when close.
```
face enemy
walking = false
if D < 4 and WALK_GATE(2I+13, 2I+63): walking = Walk(Opposite(md))   // retreat straight back
if !walking and rand(100) < 2I + 3 and LOS(moving-missile): StartRangedAttack(Arrow, dmg 4)   // 3..9% per tick
```
Arrow damage for monsters actually comes from the monster's damage range at impact (see §11 arrows); the `4` is a
placeholder.

**7.5 Corpse-eater (`Scavenger`)** — melee that flees to eat corpses when hurt.
```
if hp < maxHP/2 and goal != Healing: leave pack; goal = Healing; goalVar3 = 10
if goal == Healing and goalVar3 != 0:
    goalVar3--
    if standing on a corpse: StartEating (special anim)
        base game: hp += 1 whole HP per tick; target = 3/4 maxHP
        expansion: hp += maxHP/8 per bite; corpse consumed when goalVar3 <= 0 or full; target = maxHP
        when hp >= target: goal = Normal
    else: if no remembered corpse: scan 9x9 (random scan order) for a corpse tile with wall-only LOS; remember it (+1 encoded)
          if remembered: face it; RandomWalk toward it
if still Stand: SkeletonMelee routine
```
Hard hits reset its goal to Normal (interrupt the meal).

**7.6 Charger (`Rhino`)** — melee with a long-range dash and circling.
```
md = toward last-known; open doors if not fully awake
if D >= 2:
    if goal == Move || (D >= 5 && !flipCoin(4)):          // 75% chance to start circling when far
        on entry: goalVar1 = 0; goalVar2 = rand(2) (turn side)
        goal = Move
        if goalVar1++ >= 2D || !sameRoom: goal = Normal
        elif !RoundWalk(md, &goalVar2): AiDelay(10 + rand(10))
else goal = Normal
if goal == Normal:
    if D >= 5 && v < 2I + 43 && LineClear(IsTileAvailable, tile, enemyPosition):   // 43..49%: CHARGE
        spawn Charge missile (speed 18 px/tick); special sound; mode = Charge
    elif D >= 2:
        v = rand(100)
        if v >= 2I+33 && (prevMode not Move || var2 != 0 || v >= 2I+83): AiDelay(10 + rand(10))
        else RandomWalk(md)
    elif v < 2I + 28: face md; StartAttack
```
Charge impact: see §11 "charge/rush" (to-hit 500 = guaranteed, special damage, knocks the player back one tile).

**7.7 Swarming imp (`SwarmImp`)** — cowardly melee: flees when a packmate dies, rallies on a war-cry.
```
if goal == Attack: goalVar1-- → 0 ⇒ goal = Normal          // frenzy timer
if goal == Retreat: if goalVar1-- == 0: goal = Normal; face Opposite(fleeDir)
if on last anim frame:
    if !flipCoin(4): return                                  // 25% chance per idle cycle to war-cry
    StartSpecialStand; hp += raw(2I + 2) (clamped)           // tiny self-heal
    for every imp within radius 2I + 4: goal = Attack; goalVar1 = 30I + 105 ticks   // rally
elif goal == Retreat: face fleeDir; RandomWalk(fleeDir)
elif goal == Attack: D < 2 ? StartAttack : RandomWalk(toward enemy)
else SkeletonMelee routine
```
`M_FallenFear(pos)` (called on *any* monster death): every imp within the 9×9 (radius 4) square around the corpse:
`goal = Retreat; goalVar1 = max(8 - level, 2) ticks; goalVar2 = direction away from corpse`.

**7.8 Boss summoner (`BossSummoner`)** — circling melee boss that raises skeletons.
```
(same Move/circling block as the charger, triggered when D >= 3 with 25% chance)
if goal == Normal:
    if !coopQuestMode && ((D >= 3 && v < 4I + 35) || v < 6) && LOS(missile):   // 47% far / 6% near
        spot = tile + md; if free and room in pool: SpawnMonster(random skeleton type present on level); StartSpecialStand
    elif D >= 2: (delay/walk gate with thresholds I+25 / I+75)
    elif v < I + 20: StartAttack
```
In co-op the boss also **life-steals** the damage it deals (unless `NOLIFESTEAL`).

**7.9 Erratic flyer (`Bat`)** — hit-and-run melee; one variant dive-charges, one variant shocks on hit, one blinks.
```
md = toward last-known; face md
if goal == Retreat:
    if goalVar1 == 0: RandomWalk(Opposite(md)); goalVar1++          // one step back …
    else: RandomWalk(random of Right(md)/Left(md)); goal = Normal   // … one step sideways, then re-engage
    return
if type == diveVariant && D >= 5 && v < 4I + 33 && LineClear(IsTileAvailable): Charge missile; mode = Charge
elif D >= 2: if WALK_GATE(I+13, I+63): RandomWalk(md)
elif v < 4I + 8:                                                    // 8..20%
    StartAttack; goal = Retreat; goalVar1 = 0
    if type == shockVariant: AddMissile(Lightning at enemyPosition → enemyPosition+SE, dmg rand(10)+1)
```
The blink variant teleports next to the target whenever it takes a *hard hit* (§8.6).

**7.10 Stone guardian (`Gargoyle`)** — begins as a statue, wakes when approached, flies away to heal when hurt.
```
if awake-ish && ALLOW_SPECIAL (statue pose): UpdateEnemy; if D < I + 2: clear ALLOW_SPECIAL (unfold, anim resumes); return
if hp < maxHP/2: goal = Retreat
if goal == Retreat:
    if D >= I + 2: goal = Normal; StartHeal                           // far enough: land and heal
    elif !RandomWalk(Opposite(md)): goal = Normal
AiAvoidance routine (7.13)
```
Being attacked while posing cancels the attack and unfolds instead (`tryLiftGargoyle`).

**7.11 Relentless boss (`RelentlessBoss`)** — simplest melee: `D >= 2 ? RandomWalk(toward last) : StartAttack`, every tick.

**7.12 Invisible stalker (`Sneak`)** — fades in to strike, fades out when far, retreats after being hit.
```
dist = 5 - I                                        // reveal range 5..2
if prevMode == HitRecovery: goal = Retreat; goalVar1 = 0
elif D >= dist + 3 || goalVar1 > 8: goal = Normal; goalVar1 = 0
md = toward enemy; if goal == Retreat: md = Opposite(direction to enemy's last pos); one variant picks Right/Left(md) instead
face md
if D < dist && HIDDEN: StartFadein
elif D >= dist + 1 && !HIDDEN: StartFadeout(reversed)
elif goal == Retreat || (D >= 2 && WALK_GATE(4I+14, 4I+64)): goalVar1++; RandomWalk(md)
if still Stand: if D >= 2 || v >= 4I + 10: idle else StartAttack      // 10..22% swing chance
```
Hidden monsters cannot be targeted by the cursor; the "illusion" variant also cannot be hit while retreating.

**7.13 Avoidance melee (`AiAvoidance`, used by `GoatMelee` and a quest-talker brute)** — melee that circles at range.
```
md = toward last-known; open doors if not fully awake
if D >= 2 && awake && sameRoom:
    if goal == Move || (D >= 4 && flipCoin(4)):      // 25% chance to start circling when D >= 4
        on entry: goalVar1 = 0; goalVar2 = rand(2)
        goal = Move
        if (goalVar1++ >= 2D && DirOK(md)) || !sameRoom: goal = Normal
        elif !RoundWalk(md, &goalVar2): AiDelay(10 + rand(10))
else goal = Normal
if goal == Normal:
    if D >= 2: if WALK_GATE(2I+28, 2I+78): RandomWalk(md)
    elif v < 2I + 23:
        face md
        if (horned brute or talker) && hp < maxHP/2 && !flipCoin(): StartSpecialAttack   // enraged special when hurt
        else StartAttack
```

**7.14 Plain ranged (`AiRanged`, used by `GoatRanged`, `Succubus`, `FireBat`, `TorchInsect`, the four flare casters,
`AcidUnique`, scripted temptresses)** — shoot when there is a line, back off when close, otherwise walk to last-known.
```
if awake || targeting a monster:
    md = toward enemy; open doors if not fully awake; face md
    if prevMode == RangedAttack: AiDelay(rand(20))                      // 0..19 tick cooldown after each shot
    elif D < 4: if rand(100) < 10(I + 7): RandomWalk(Opposite(md))      // 70..100% chance to retreat when close
    if still Stand:
        if LOS(moving-missile): StartRangedAttack(missileFor(ai), dmg 0 → use monster damage range)
            (the unique acid spitter uses the *special* ranged attack instead)
        else face md
    return
if activeForTicks != 0: RandomWalk(toward last-known)
```
Missile by AI id: horned archer → Arrow; temptress → blood-star bolt; acid → acid glob; fire bat → firebolt; torch ant →
fireball; the four flare casters → coloured flares; lava lobber → magma ball; lightning caster → thin-lightning
control; final boss → multi-target apocalypse; bone demon → blue flare.

**7.15 Ranged-avoidance (`AiRangedAvoidance`, used by `Magma`, `Storm`, `Acid`, `BoneDemon`, final boss)** — hybrid:
circles, shoots special projectile, melees when adjacent. Uses `v = rand(10000)` for finer probabilities.
```
md = toward last-known; (lava/lightning/bone-demon open doors)
lessmissiles = (ai == Acid) ? 1 : 0;  dam = (ai == finalBoss) ? 40 : 0
if D >= 2 && awake && sameRoom:
    if goal == Move || (D >= 3 && flipCoin(4 << lessmissiles)):        // 25% (12.5% for acid) to start circling
        on entry: goalVar1 = 0; goalVar2 = rand(2); goal = Move
        if goalVar1++ >= 2D && DirOK(md): goal = Normal
        elif v < (500(I+1) >> lessmissiles) && LOS(moving-missile): StartRangedSpecialAttack(missile, dam)   // 5..20% while circling
        else RoundWalk(md, &goalVar2)
else goal = Normal
if goal == Normal:
    if ((D >= 3 && v < (500(I+2) >> lessmissiles)) || v < (500(I+1) >> lessmissiles)) && LOS(moving-missile):
        StartRangedSpecialAttack(missile, dam)                          // far: 10..25%; near: 5..20% (halved for acid)
    elif D >= 2:
        v = rand(100)
        if v < 1000(I+5) || (prevMode Move && var2 == 0 && v < 1000(I+8)): RandomWalk(md)   // always true → walks
    elif v < 1000(I + 6): face md; StartAttack                          // v is rand(10000) here: 60..90% melee chance
if still Stand: AiDelay(5 + rand(10))
```
(The `1000*(I+5)` against `rand(100)` is a shipped quirk: the walk branch is effectively unconditional.)

**7.16 Serpent (`Snake`)** — slithers in a fixed S-pattern, lunges 2 tiles.
```
pattern = {1, 1, 0, -1, -1, 0}   // turn right, right, straight, left, left, straight
md = toward last-known; face md
if D >= 2:
    if D < 3 && LineClear(IsTileAvailable) && prevMode != Charge: Charge missile (lunge); attack sound; mode = Charge
    elif prevMode == Delay || rand(100) >= 35 - 2I:
        apply pattern[goalVar1] to md; goalVar1 = (goalVar1+1) mod 6
        drift-correct toward goalVar2 (desired heading): if md != target: drift = (md - target) mod 8; md = drift < 4 ? Right(target) : drift > 4 ? Left(target) : md; goalVar2 = md
        if !Walk(md): RandomWalk2(facing)
    else AiDelay(15 - I + rand(10))
else:
    if prevMode in {Delay, Charge} || rand(100) < I + 20: StartAttack
    else AiDelay(10 - I + rand(10))
```
The serpent's lunge moves 2 tiles per tick (`velocity*2` lookahead) and never shoves the target.

**7.17 Teleporting mage (`TeleMage`; also the base of two scripted bosses)** — ranged caster that fades out and
re-appears, retreats when hurt, and has a point-blank flash attack.
```
md = toward last-known; open doors if not fully awake
if goal == Retreat:
    if goalVar1++ <= 3: RandomWalk(Opposite(md))              // 4 steps away …
    else: goal = Normal; StartFadein(reversed)                 // … then re-appear
elif goal == Move:
    if D >= 2 && awake && sameRoom:
        if goalVar1++ < 2D || !DirOK(md): RoundWalk(md, &goalVar2)   // circle while invisible
        else goal = Normal; StartFadein(reversed)
    else goal = Normal; StartFadein(reversed)
elif goal == Normal:
    if D >= 2:
        if v < 5(I + 10) && LOS(moving-missile):               // 50..65%
            StartRangedAttack({Firebolt, ChargedBolt, LightningControl, Fireball}[I], dmg randBetween(min,max))
        elif rand(100) < 30: goal = Move; goalVar1 = 0; StartFadeout   // 30%: vanish and reposition
        else AiDelay(rand(10) + 2(5 - I))
    else:
        face md
        if hp < maxHP/2: goal = Retreat; goalVar1 = 0; StartFadeout
        elif prevMode == Delay || rand(100) < 2I + 20:
            StartRangedAttack(Null, 0); AddMissile(FlashBottom, dmg 4) + AddMissile(FlashTop, dmg 4) at own tile   // point-blank nova
        else AiDelay(rand(10) + 2(5 - I))
if still Stand: AiDelay(5 + rand(10))
```
While not in `Normal` goal the mage **cannot be hit** (`isPossibleToHit` excludes it), so the fade is a true i-frame.

**7.18 Breath giant (`BreathGiant`)** — melee/flame-breath hybrid; falls back to skeleton melee at long range.
```
if D >= 5: SkeletonMelee routine; return
md = toward last-known; open doors if not fully awake
if D >= 2 && awake && sameRoom:
    if goal == Move || D >= 3:
        on entry: goalVar1 = 0; goalVar2 = rand(2)
        goal = Move; goalVar3 = 4                                              // "just started circling" marker → forces a breath
        if goalVar1++ < 2D || !DirOK(md): if v < 5(I + 16): RoundWalk(md, &goalVar2)   // 80..95%
        else goal = Normal
else goal = Normal
if goal == Normal:
    if ((D >= 3 && v < 5(I+2)) || v < 5(I+1) || goalVar3 == 4) && LOS(missile): StartRangedSpecialAttack(InfernoControl, 0)
    elif D >= 2: if WALK_GATE(2(5I+25), 2(5I+40)): RandomWalk(md)
    elif rand(100) < 10(I + 4): face md; flipCoin() ? breath : StartAttack      // 40..70%
    goalVar3 = 1
if still Stand: AiDelay(5 + rand(10))
```
The breath is a 15-tick channel (§3.2) producing a 3-tile line of fire.

**7.19 Lightning caster (`Storm`)** — uses 7.15 with the thin-lightning control missile (chain of lightning segments)
and a second melee hit on attack frame 12.

**7.20 Minion-spawning demon (`SpawnerDemon`)** — circling melee that throws spawn eggs.
```
md = toward last-known; open doors if not fully awake
if D < 2: goal = Normal
elif goal == Move || (D >= 5 && !flipCoin(4)): (circling block identical to the charger's)
if goal == Normal:
    if D >= 3 && v < 2I + 43: if tile+facing is free and pool not full: StartRangedSpecialAttack(SpawnEgg, 0)   // 49% at I=3
    elif D < 2: if v < 2I + 28: face md; StartAttack
    else: v = rand(100); if WALK_GATE'(2I+33, 2I+83): RandomWalk(md) else AiDelay(10 + rand(10))
```
The egg missile travels 9 ticks at 8 px/tick then spawns a fixed spawn type on the nearest free tile.

**7.21 Summon / player minion (`Golem`)** — follows its owner, attacks the nearest hostile monster.
```
if parked (holding cell) or in Death/SpecialStand or walking: return
if !TARGETS_MONSTER: UpdateEnemy
if MeleeAttack: return
if has enemy:
    face enemy
    if adjacent (|dx|<2 && |dy|<2):
        enemyPosition = enemy.tile
        if enemy dormant: wake it and every monster in the 5×5 around the summon
        StartAttack; return
    if AiPlanPath(): return                                   // summon always uses A*
pathCount++; if pathCount > 8: pathCount = 5
if RandomWalk(owner.facing): return                           // drift in the owner's direction
try 8 directions clockwise from Left(facing); Walk the first legal
```

**7.22 Scripted quest NPC-monsters** (five routines: a cowardly brute talker, an imp chieftain talker, a mad mage
talker, a cursed knight, a demonic knight captain; plus the scripted archbishop and his two temptress bodyguards). Common
pattern:
```
if talkMsg at stage k && !visible(tile) && goal == Talking: advance talkMsg to k+1; goal = Inquiring; update quest var
if visible && talkMsg == finalStage && dialogue finished playing && goal == Talking:
    activeForTicks = 255; talkMsg = None; goal = Normal; quest var = ATTACKING (or for the knight: quest done, monster dies)
if goal in {Normal, Move, Retreat, Attack}: delegate to base routine (Avoidance / SwarmImp / TeleMage / SkeletonMelee / Ranged)
```
While `talkMsg != None` the monster is untargetable by attacks and clicking it opens dialogue. The archbishop variant
additionally plays a cutscene when the player steps on a specific tile and opens a gate; his bodyguards stay
`Inquiring` until his quest variable passes 5.

**7.23 Final boss (`FinalBoss` id)** — 7.15 with a special projectile that drops a fire-explosion on **every player with a
clear missile line**, flat damage 40 (then ×difficulty via the monster damage path), plus knockback melee.

**7.24 Fire elemental (`FireMan`)** — dispatch entry is null (type exists only as a set-piece/unique variant in the
expansion data and uses no runtime AI; treat as "unimplemented archetype" in the original).

**7.25 Dispatch summary**

| AI id | Routine |
|---|---|
| Zombie | 7.1 |
| Fat | 7.2 |
| SkeletonMelee, KnightTalker(wrapper), ExpansionBoss/UberBoss(uniques override to SkeletonMelee) | 7.3 |
| SkeletonRanged | 7.4 |
| Scavenger | 7.5 |
| Rhino | 7.6 |
| SwarmImp, ImpChiefTalker(wrapper) | 7.7 |
| BossSummoner | 7.8 |
| Bat | 7.9 |
| Gargoyle | 7.10 |
| RelentlessBoss | 7.11 |
| Sneak | 7.12 |
| GoatMelee, BruteTalker(wrapper) | 7.13 |
| GoatRanged, Succubus, AcidUnique, FireBat, TorchInsect, Lich, ArchLich, FlareCasterA, FlareCasterB, BossBodyguard(wrapper) | 7.14 |
| Magma, Storm, Acid, BoneDemon, FinalBoss | 7.15 |
| Snake | 7.16 |
| TeleMage, MadMageTalker(wrapper), ArchbishopBoss(wrapper) | 7.17 |
| BreathGiant | 7.18 |
| SpawnerDemon | 7.20 |
| Golem | 7.21 |
| CursedKnightTalker | 7.22 (talk only, dies on quest completion) |
| FireMan | none |

### Reference tuning values — AI archetype catalog (decision probabilities per tick, I = INT 0..3)

| Archetype | Engage/approach rule | Attack chance when adjacent | Retreat / special | Cooldowns |
|---|---|---|---|---|
| Slow shambler | thinks 10+2I %; wanders when D ≥ 2I+4; needs to be *seen* | always when thinking (10–16%) | none | none |
| Fat bruiser | walk gate 4I+20 / 4I+70 | 4I+15 % normal, +5 % special | none | none |
| Skeleton melee | walk 65+4I % else pause 15−2I+[0,10) | 20+2I % (guaranteed after a pause) | none | pause 10−2I+[0,10) when adjacent |
| Skeleton archer | retreat gate 2I+13 / 2I+63 when D < 4 | shoot 3+2I % | back-pedal | none (chance-gated) |
| Corpse-eater | skeleton-melee | skeleton-melee | at < 50% HP: run to corpse within 4, eat to 75% (base) / 100% (exp) | 10 "search ticks" |
| Charger | circle 75% when D ≥ 5; walk gate (2I+33 / 2I+83 inverted) | 2I+28 % | charge 2I+43 % when D ≥ 5 with clear line | delay 10–19 when blocked |
| Swarm imp | skeleton-melee; rally radius 2I+4, frenzy 30I+105 ticks | skeleton-melee (frenzy: always) | flee max(8−lvl,2) ticks on nearby death; war-cry 25% per idle loop | — |
| Boss summoner | circle 25% when D ≥ 3; walk gate I+25 / I+75 | I+20 % | summon 4I+35 % far / 6 % near | delay 10–19 |
| Erratic flyer | walk gate I+13 / I+63; dive 4I+33 % when D ≥ 5 (one variant) | 4I+8 % then always retreat 2 steps | hit-and-run; blink on hard hit (one variant); shock bolt 1–10 (one variant) | — |
| Stone guardian | statue until D < I+2; then avoidance (below) | 2I+23 % | at < 50% HP fly away until D ≥ I+2, then heal 1/64..1/128 maxHP per pulse | — |
| Relentless boss | every tick | 100 % | none | none |
| Invisible stalker | reveal at D < 5−I, hide at D ≥ 6−I; walk gate 4I+14 / 4I+64 | 4I+10 % | retreat after being staggered, ≤ 8 steps | — |
| Avoidance melee | circle 25% when D ≥ 4; walk gate 2I+28 / 2I+78 | 2I+23 % (50% special when < ½ HP for horned brute) | — | delay 10–19 when circling blocked |
| Plain ranged | retreat 70+10I % when D < 4 | shoot whenever LOS (after cooldown) | — | 0–19 ticks after each shot |
| Ranged-avoidance | circle 25% when D ≥ 3 (12.5% acid) | melee 60+10I % | shoot 5(I+2) % far / 5(I+1) % near (halved for acid) | delay 5–14 every idle tick |
| Serpent | S-pattern walk 65+2I %; lunge when D == 2 | I+20 % | — | delay 15−I+[0,10) / 10−I+[0,10) |
| Teleporting mage | cast 50+5I % when D ≥ 2; vanish 30% | flash nova 20+2I % | fade & retreat 4 steps at < ½ HP; invulnerable while faded | delay 5–14 idle; 2(5−I)+[0,10) between |
| Breath giant | D ≥ 5 → skeleton melee; circle 80+5I %; walk gate 10I+50 / 10I+80 | 10(I+4) % (50/50 melee vs breath) | breath 5(I+2) % far, 5(I+1) % near, forced after starting to circle | delay 5–14; 15-tick channel |
| Spawner demon | circle 75% when D ≥ 5; walk gate 2I+33 / 2I+83 | 2I+28 % | throw egg 2I+43 % when D ≥ 3 | delay 10–19 |
| Summon | A* to nearest hostile; else follow owner | 100 % when adjacent | — | — |

### Smallest buildable chunks
1. AI dispatch table + per-tick entry guard (`Stand` && awake).
2. Walk-gate helper and `prevMode/var2` bookkeeping.
3. `AiDelay` + Delay mode.
4. Shambler (7.1) — the minimal melee AI, good first integration test.
5. Skeleton melee (7.3) with pause/attack cadence.
6. Fat bruiser (7.2) with special attack.
7. Skeleton archer (7.4) with back-pedal + LOS shoot.
8. Avoidance melee (7.13) with the reusable **circling block** (goal Move, `goalVar1 < 2D`, RoundWalk).
9. Plain ranged (7.14) with per-id missile mapping and post-shot cooldown.
10. Ranged-avoidance (7.15) incl. `rand(10000)` thresholds and acid halving.
11. Charger (7.6) + charge missile integration.
12. Erratic flyer (7.9) retreat sequence + variants.
13. Invisible stalker (7.12) with fade in/out and untargetable-while-hidden.
14. Teleporting mage (7.17) with fade/circle/retreat and point-blank flash.
15. Stone guardian (7.10) statue/heal cycle + `tryLiftGargoyle` hook in all hit paths.
16. Swarm imp (7.7) rally/fear + global `OnMonsterDeath → fear` hook.
17. Corpse-eater (7.5) + corpse grid query.
18. Serpent (7.16) pattern walker + 2-tile lunge.
19. Breath giant (7.18) + channel.
20. Boss summoner (7.8) + spawn-from-pool.
21. Spawner demon (7.20) + egg missile.
22. Summon AI (7.21) with owner-follow and wake-5×5.
23. Quest-talker wrapper pattern (7.22) with stage/visibility transitions.
24. Final-boss projectile (multi-target) wiring.
25. Balance harness: simulate each archetype vs a static dummy for 1000 ticks and report attack/sec and approach time.

### Pitfalls / design lessons
* Every routine is a **one-action-per-think** function: it never loops; cadence comes from animation length plus
  explicit `AiDelay`. This keeps behaviours tunable in data and trivially deterministic.
* Use *last-known position* for melee steering and *current enemy position* for aiming; mixing them causes archers to
  shoot at where the player was.
* Circling (`goal = Move` for `2D` steps) is the single most reused trick to make melee enemies feel less like
  homing missiles; it costs nothing beyond `RoundWalk`.
* Invulnerability during fade/talk/charge should be centralised (`isPossibleToHit`) rather than scattered.
* Shipped quirks worth deciding on deliberately: the `rand(100) < 1000*(I+5)` always-true walk, the archer's unused
  damage parameter, the imp "flee" using `max(8 - level, 2)` so late-game imps barely flee.

---

## 8. Combat resolution

### Purpose
All hit/miss, block, damage, resistance, stagger (hit recovery), knockback, reflect/thorns and stat-drain rules, in
four directions: monster→player, monster→monster, player→monster (melee, arrow, spell), trap→anything, and
player→player.

### Key data structures
* Player accessors: `GetArmor = bonusAC + itemAC + DEX/5`; `GetMeleeToHit = CLVL + DEX/2 + itemToHit + classBaseMelee`;
  `GetRangedToHit = CLVL + DEX + itemToHit + classBaseRanged`; `GetMagicToHit = MAG + classBaseMagic`;
  `GetBlockChance(useLevel) = DEX + classBaseBlock + (useLevel ? 2*CLVL : 0)`; `_pIEnAc` = armor-pierce;
  `_pIGetHit` = flat damage-taken modifier (negative = reduction); `_pIBonusDam` (%), `_pIBonusDamMod` (flat),
  `_pDamageMod` (stat-derived), `_pIMinDam/_pIMaxDam` weapon range, elemental ranges `_pIF*`, `_pIL*`.
* Monster: `toHit(diff)`, `toHitSpecial(diff)`, `level(diff)`, `armorClass`, `minDamage..maxDamageSpecial`,
  `resistance`, `monsterClass`, `reducePlayer*`, flags `KNOCKBACK`.
* `CalculateArmorPierce(monsterAC, isMelee)`: expansion: if pierce > 0: `tmac >>= (pierce-1)` when pierce > 1 else
  `tmac -= tmac/4`; barbarian-archetype melee additionally `tmac -= AC/8`; clamp ≥ 0. Base game: pierce is instead added
  to to-hit (`GetMeleePiercingToHit = GetMeleeToHit + pierce`).
* Per-level **minimum monster hit chance** `GetMinHit()`: depth 16 → 30, 15 → 25, 14 → 20, else 15 (melee);
  for missiles the floor is 10 (14 → 20, 15 → 25, 16 → 30).

### Algorithms & rules

**8.1 Monster melee vs player (`MonsterAttackPlayer(m, p, hit, minDam, maxDam)`)**
```
if p dead || invincible || etherealized: return
if chebyshev(m, p) >= 2: return                                   // must still be adjacent on the hit frame
roll = rand(100)
ac = p.GetArmor(); +40 if p has "AC vs demons" and m is Demon; +20 if "AC vs undead" and m is Undead
hit += 2*(m.LVL - CLVL) + 30 - ac
hit = max(hit, GetMinHit())
blockRoll = 100; if p in Stand/Attack and has a shield: blockRoll = rand(100)
blk = clamp(p.GetBlockChance() - 2*m.LVL, 0, 100)
if roll >= hit: return                                             // miss
if blockRoll < blk:
    StartPlrBlock(face monster)
    if local player has reflect charges: dam = randRaw(min<<6 .. max<<6) + getHit; CheckReflect(dam)   // block still reflects
    return
apply stat drains (reducePlayer*)
dam(raw) = randBetween(min<<6, max<<6); dam = max(dam + p.getHit*64, 64)     // getHit is usually negative (armor "−N damage taken")
if local: if reflect charges: dam -= CheckReflect(m, p, dam) ; ApplyPlrDamage(Physical, dam)
if p has Thorns and m not dying: m takes randBetween(1,3) raw<<6 ; kill or stagger m
if m is the co-op skeleton boss and !NOLIFESTEAL: m.hp += dam
if p died: (expansion: m returns to Stand); return
StartPlrHit(p, dam)                                                // stagger check inside
if m has KNOCKBACK: force stagger; shove p one tile in m.direction if that tile is free for a player
```
`hit` passed in is `m.toHit(diff)` for normal attacks, `m.toHitSpecial(diff)` for specials, `500` (guaranteed) for charge
impacts. `CheckReflect`: consumes one charge; reflects `dam * randBetween(20,30) / 100` to the monster (kill or
stagger).

**8.2 Player stagger (`StartPlrHit(p, dam, force)`)**: unless forced, a hit only interrupts the player if
`dam.whole >= CLVL` (barbarian archetype: `>= CLVL + CLVL/4`). Fast-hit-recovery affixes skip 1/2/3 frames of the
Hit animation. Stagger snaps the player to its tile (cancels walking).

**8.3 Player block (`StartPlrBlock`)**: plays the block animation facing the attacker; fast-block affix truncates it to 2
frames. Block is only possible in Stand/Attack mode with a shield equipped.

**8.4 Player damage application (`ApplyPlrDamage`)**: mana shield (if active and shield spell known) absorbs from mana
first: `total += total / -reduction` (shield-level-dependent reduction), overflow after mana is exhausted is
re-inflated by `/ (reduction-1)`; then HP and HP-base are reduced, clamped to `minHP` (used by self-damage effects),
and death is triggered at ≤ 0.

**8.5 Monster vs monster (`MonsterAttackMonster(a, t, hper, min, max)`)**
```
if !t.isPossibleToHit(): return
roll = rand(100); if t petrified: roll = 0 (auto-hit)
if t is a posing stone guardian: it unfolds instead; return
if roll >= hper: return                                    // NB: no AC/level adjustment between monsters
dam = randBetween(min, max) << 6
ApplyMonsterDamage(Physical)
if attacker is a player summon: tag the owner for XP credit
dead ? death facing attacker (expansion: attacker returns to stand) : MonsterHitMonster → hard hit turns t to face attacker; M_StartHit
wake t if dormant (last = attacker tile)
```

**8.6 Monster stagger threshold (`IsHardHit(t, dam)`)**: `(dam >> 6) >= t.LVL(diff) + 3`, i.e. a hit of at least
**LVL+3 whole HP** interrupts (invisible stalkers are *always* staggered). `M_StartHit`: play hit sound; if hard hit:
blink variant teleports, corpse-eaters drop their meal goal, and unless petrified → `StartMonsterGotHit`
(GotHit anim, cancel step). The player-sourced overload also retargets the monster to that player and faces it.

**8.7 Knockback (`M_GetKnockback(m, attackerPos)`)**: `dir = direction(attacker → m)`; if `IsRelativeMoveOK(m, old, dir)`:
clear squares, `old += dir`, `StartMonsterGotHit` (which sets tile = old), move light. Triggered by player melee/arrows
with the knockback affix when the monster is not petrified.

**8.8 Player melee vs monster (`PlrHitMonst(p, m, isCleaveSide)`)**
```
if !m.isPossibleToHit(): return false
hper = 0; if cleave side hit: hper -= (CLVL > 20 ? 30 : 2*(35 - CLVL))
roll = rand(100); if m petrified: roll = 0
hper += p.GetMeleePiercingToHit() - p.CalculateArmorPierce(m.AC, melee)
hper = clamp(hper, 5, 95)                                        // 5% floor / 95% ceiling always
if m is a posing stone guardian: unfold; return true
if roll >= hper: return false
(expansion: if weapon has both fire+lightning: fire a spectral arrow for fire damage)
dam = randBetween(weaponMin, weaponMax)
dam += dam * bonusDam% / 100; dam += bonusDamFlat
dam2 = dam << 6                                                  // snapshot for the self-damage affix
dam += statDamageMod
if class has CriticalStrike: if rand(100) < CLVL: dam *= 2        // crit chance = CLVL %
weapon type vs class: Undead: sword −50%, mace +50%; Animal: mace −50%, sword +50%; Demon: ×3 with "triple vs demons"
"Devastation" affix: 5% chance ×3
"Doppelganger" affix: 10% chance spawn copy (non-unique, non-final-boss)
dam <<= 6
"Jester" affix: r = rand(201); if r >= 100: r = 100 + (r-100)*5 ; dam = dam*r/100   // 0%..600%
if cleave side hit: dam >>= 2                                    // side targets take 25%
"Peril" affix: self-damage dam2 + getHit (min 1 HP), then dam *= 2
ApplyMonsterDamage(Physical, dam)
life steal random: heal rand(dam/8); steal mana 3%/5%; steal life 3%/5% (raw units)
dead ? kill (credit p) : (knockback affix && !petrified → M_GetKnockback) ; M_StartHit(m, p, dam)
```
`DoAttack` resolves the main target on frame `_pAFNum-1` at `tile + facing`; fire/lightning weapon affixes spawn a
`WeaponExplosion` missile on the target tile (elemental damage only if the main hit landed); cleave-capable
class/weapon also tries `Right(facing)` and `Left(facing)` tiles (only monsters whose `old` tile equals that tile, i.e.
not mid-step); a landed hit has a 1/30 chance to wear the weapon.

**8.9 Player→player melee (`PlrHitPlr`)**: `hper = clamp(GetMeleeToHit - target.GetArmor, 5, 95)`; block as 8.1 with
`blk = clamp(target.GetBlockChance - 2*attackerCLVL, 0, 100)`; damage as 8.8 without class modifiers; crit as above;
random life steal; `StartPlrHit`.

**8.10 Player missile vs monster (`MonsterMHit(p, m, min, max, dist, type, start, dmgType, shift)`)**
```
if !m.isPossibleToHit() || m.isImmune(type, dmgType): return false
roll = rand(100)
if arrow-type: hper = GetRangedPiercingToHit - CalculateArmorPierce(m.AC, ranged) - dist*dist/2    // range penalty, quadratic
else:          hper = GetMagicToHit - 2*m.LVL - dist
hper = clamp(hper, 5, 95); petrified → roll 0; posing guardian → unfold
if roll >= hper: return false
dam = (type == soul-drain bolt) ? m.hp/3 : randBetween(min, max)
if physical arrow: dam = bonusFlat + dam*bonus%/100 + dam; dam += (rogue archetype ? statMod : statMod/2); Demon && triple-demon → ×3
resist = m.isResistant(type, dmgType)
if !shift: dam <<= 6
if resist: dam >>= 2                                             // resistance = 25% damage
local → ApplyMonsterDamage
dead → kill; resisted → tag + hit sound only (no stagger); else (arrow && knockback affix → knockback) ; stagger check
wake m if dormant
```
`dist` is the missile's `_midist` (ticks travelled, ≈ tiles). `shift` = damage already in raw units.

**8.11 Trap/monster missile vs monster (`MonsterTrapHit`)**: `hper = clamp(90 - m.AC - dist, 5, 95)`; petrified
auto-hit; resist → `/4`; death credits nobody (`MonsterDeath` with no player). Used for monster-vs-monster projectile
friendly fire (berserk / summon factions) and traps.

**8.12 Missile vs player (`PlayerMHit(p, m?, dist, min, max, type, dmgType, shift, reason)`)**
```
if dead || invincible || (etherealized && arrow): return false
roll = rand(100)
if arrow: ac = GetArmor
    monster source: hper = m.toHit(diff) + 2*(m.LVL - CLVL) + 30 - 2*dist - ac
    trap source:    hper = 100 - ac/2 - 2*dist
else (spell): hper = 40 + (m ? 2*m.LVL - 2*CLVL - 2*dist : 0)       // spells vs player: flat 40% base
hper = max(hper, minhit: 10 / depth14: 20 / 15: 25 / 16: 30)
blockRoll = (Stand/Attack && shield) ? rand(100) : 100 ; shift or acid puddle → 100 (unblockable)
blkper = clamp(GetBlockChance(useLevel = false) - (m ? 2*(m.LVL - CLVL) : 0), 0, 100)
resper = Fire→fireRes, Lightning→lightRes, Magic/Acid→magicRes, Physical→0
if roll >= hper: return false
dam = soul-drain ? p.hp/3 : randBetween(min<<6, max<<6) (trap: halve with "half trap damage"), + getHit*64, min 64
if (resper <= 0 || expansion) && blockRoll < blkper: block; return true   // base game: elemental can't be blocked when resisted
stat drains from m
if resper > 0: dam -= dam*resper/100; apply; grunt; return true          // resisted hits never stagger
apply; StartPlrHit
```

**8.13 Player→player missile (`Plr2PlrMHit`)**: friendly-fire gate; arrows `hit = GetRangedToHit - dist²/2 -
target.GetArmor`, spells `GetMagicToHit - 2*targetCLVL - dist`, clamp 5..95; **non-arrow damage is halved**; resistances
subtract %; block as melee.

**8.14 Damage type & resistance semantics**
* Immune → the missile does not collide with that monster at all (no hit flag, passes through for piercing types).
* Resistant → `damage >> 2` (player source) or `/4` (trap/monster source), **no stagger**, hit sound only.
* Holy bolt is treated as immune for every non-undead target except the final boss (expansion: final boss and bone
  demon *resist* it).
* Acid immunity exists only as an immune bit (used by the acid spitters themselves).

**8.15 Experience on kill**: `AddPlrMonstExper(LVL, exp, whoHitMask)` splits `exp / numberOfTaggedPlayers` to every
player who damaged it (`whoHit` bitmask); the local player's `addExperience(e, LVL)` applies level-gap scaling (player
cluster).

### Reference tuning values
| Rule | Value |
|---|---|
| Monster melee to-hit vs player | `toHit + 2*(mLVL − CLVL) + 30 − playerAC`, floor 15/20/25/30 by depth |
| Monster arrow to-hit vs player | same with extra `− 2*dist` |
| Monster spell to-hit vs player | `40 + 2*(mLVL − CLVL) − 2*dist` |
| Player melee to-hit vs monster | `CLVL + DEX/2 + itemToHit + classBase (+pierce) − monsterAC`, clamp 5..95 |
| Player arrow to-hit | `CLVL + DEX + itemToHit + classBase (+pierce) − monsterAC − dist²/2`, clamp 5..95 |
| Player spell to-hit | `MAG + classBase − 2*mLVL − dist`, clamp 5..95 |
| Trap to-hit vs monster | `90 − AC − dist` |
| Block chance vs monster melee | `DEX + classBlock + 2*CLVL − 2*mLVL` |
| Block vs missile | `DEX + classBlock − 2*(mLVL − CLVL)` (no CLVL bonus) |
| Difficulty to-hit bonus | +85 (T1), +120 (T2) |
| Difficulty AC bonus | +50 / +80 |
| Monster stagger threshold | damage ≥ `LVL + 3` |
| Player stagger threshold | damage ≥ `CLVL` (`CLVL + CLVL/4` for the heavy-melee class) |
| Crit chance | `CLVL` % (crit-capable classes), ×2 |
| Cleave side targets | to-hit −(70 − 2·CLVL) (−30 past CLVL 20), damage ×¼ |
| Resist multiplier | ×0.25 |
| Reflect | 20–30% of incoming, consumes 1 charge |
| Thorns | 1–3 damage to attacker |
| Knockback | 1 tile, requires a legal step |
| Minimum damage dealt to player | 1 HP (64 raw) |
| Minimum attack adjacency | Chebyshev < 2 on the hit frame |
| Weapon wear | 1/30 per landed hit |

### Smallest buildable chunks
1. Damage type enum + resist/immune query + ×¼ rule.
2. Fixed-point damage helper (`<<6`, `randBetween(min<<6, max<<6)`, min 64).
3. `MonsterAttackPlayer`: to-hit, floor by depth, block, drains, getHit, stagger, knockback.
4. `StartPlrHit` threshold + fast-recovery frame skipping; `StartPlrBlock`.
5. `ApplyPlrDamage` with mana-shield absorption and `minHP` clamp.
6. Reflect & thorns hooks.
7. `MonsterAttackMonster` + faction rules (summon/berserk).
8. `IsHardHit` + `M_StartHit` (sound, blink/eater exceptions, GotHit) + retarget-on-hit.
9. `M_GetKnockback` using `IsRelativeMoveOK`.
10. `PlrHitMonst`: pierce, clamp, crit, class/weapon modifiers, affix hooks (jester, devastation, peril, doppelganger, steals).
11. `DoAttack` frame resolution + cleave + weapon-explosion missiles + durability.
12. `MonsterMHit` (arrow vs spell to-hit, distance penalties, bone-spirit 1/3 HP).
13. `MonsterTrapHit`.
14. `PlayerMHit` (arrow/spell/trap branches, unblockable puddles, resisted-no-stagger).
15. `Plr2PlrMHit` with friendly-fire gate and half spell damage.
16. XP split by `whoHit` bitmask.
17. Depth-based minimum hit chance tables (melee 15/20/25/30, missile 10/20/25/30).
18. Combat log/test harness asserting expected hit rates over 10k rolls for sample matchups.

### Pitfalls / design lessons
* Always clamp player hit chances to 5..95 but give *monsters* only a floor; the asymmetry makes high-AC builds
  meaningful without making the player untouchable.
* Quadratic range penalty for arrows (`dist²/2`) is what makes bows feel precise up close and chancy at range.
* Resisted hits should **not** stagger — otherwise resist is just a damage number; here it also removes stun-lock.
* Encode the damage in the missile at creation (the engine notes several "BUGFIX: damage should be encoded in the
  missile" spots where it reads the live source's stats at impact; a dead/departed source breaks that).
* Multiply stagger thresholds by level on both sides so early-game stun-lock fades naturally.

---

## 9. Death, corpses, XP & loot

### Purpose
Turn a zero-HP monster into: XP for tagging players, a loot roll, a corpse tile, pack bookkeeping, fear propagation,
quest hooks, and (for the final boss) the ending sequence.

### Key data structures
* `whoHit` bitmask (per monster, one bit per player index).
* `rndItemSeed` (set at spawn) — the RNG is **re-seeded with it before the loot roll**, so loot is deterministic per
  monster regardless of who kills it or when.
* Corpse grid `dCorpse[x][y]` = `corpseSpriteId (5 bits) | direction << 5`; `Corpses[31]` sprite table: one entry per
  monster *type* on the level (last death frame), one "shatter" entry for petrified kills, one per unique (with palette
  index = monster index + 1 for recolouring).
* `MonsterKillCounts[type]` (drives the bestiary: ≥ 15 kills reveals resistances, ≥ 30 reveals HP range).

### Algorithms & rules
**9.1 `ApplyMonsterDamage(type, m, dmg)`**: `hp -= dmg`; if ≤ 0: mark walkability changed, broadcast kill
(`CMD_MONSTDEATH`), else broadcast damage.

**9.2 `MonsterDeath(m, facing, sendMsg)`**:
```
if not a player summon: AddPlrMonstExper(m.LVL(diff), m.exp(diff), m.whoHit)
MonsterKillCounts[type]++ ; hp = 0; walkability changed; clear HIDDEN
SetRndSeed(m.rndItemSeed); SpawnLoot(m)
final boss → ending sequence (freeze players, kill every other monster, camera pan, 140-tick timer) ; else death sound
if not petrified: Death anim facing `facing` (summons always face S); mode = Death
elif unique: remove its light
goal = None; var1 = 0; tile = future = old; clear squares; occupy
CheckQuestKill(m); M_FallenFear(tile)
acid spitters: leave an acid puddle missile with damage INT+1
```
Death anim completion (§3.2) adds the corpse (unique corpses use their own slot), frees the tile, invalidates the
monster, releases minions / shrinks pack. Petrified deaths skip the animation: the curse missile plays a shatter and
adds the shatter corpse.

**9.3 Loot (`SpawnLoot` → `SpawnItem`)**:
```
spawn-type minions: no drop
scripted uniques: fixed quest items / weapon sets (quest cluster)
player summons: no drop
otherwise SpawnItem(m, tile):
    if type.treasure has UNIQ flag (and not co-op quest mode): spawn that specific unique item; return
    if m.isUnique() || UNIQ: idx = RndUItem(m)        // "only good": no gold, no misc (books allowed), item minMLvl <= m.LVL
    else:
        if treasure has NODROP: return
        idx = RndItemForMonsterLevel(m.LVL):
            if rand(100) > 40: nothing            // 59% no drop
            if rand(100) > 25: gold               // 74% of the remaining → gold  (≈ 30% gold, ≈ 11% item overall)
            else random droppable item with minMLvl <= m.LVL
    place via GetSuperItemSpace; uper = unique ? 15 : 1 (unique-roll weight); itemLevel = base type level (not difficulty level)
```

**9.4 Fear**: `M_FallenFear` (§7.7) on every death.

**9.5 Monster cleanup (`DeleteMonsterList`)**: summons in reserved slots are parked back to the holding cell; others are
swap-removed from the active list; any monster targeting the removed one gets `NO_ENEMY`.

**9.6 Lights**: unique monsters carry a light; on death it is moved to the corpse tile (`MoveLightsToCorpses`) or
removed. Berserked monsters' lights are removed on delete.

### Reference tuning values
| Item | Value |
|---|---|
| Drop chance (normal monster) | 41% any drop → 25% of those are items (≈10%), 75% gold (≈31%) |
| Unique monster | always an item (non-gold, non-misc), unique-roll weight 15 vs 1 |
| XP split | equal share among tagging players |
| Bestiary thresholds | 15 kills (resists), 30 kills (HP) |
| Corpse sprite slots | 31 |
| Acid death puddle damage | INT + 1 |
| Fear radius | 4 (9×9) |

### Smallest buildable chunks
1. `whoHit` tagging on every damage path.
2. `ApplyMonsterDamage` with network broadcast split (damage vs death).
3. `MonsterDeath` sequence (XP, kill counter, seed, loot hook, anim, pack update, fear, quest hook).
4. Deterministic loot via per-monster seed; drop table rule (59/31/10).
5. Corpse sprite table init (per type + shatter + uniques) and `AddCorpse` encoding.
6. Death-anim completion → corpse + invalidate; petrified → shatter corpse.
7. Active-list purge with summon slot parking and dangling-target cleanup.
8. Unique light → corpse migration.
9. Final-boss death choreography (freeze, kill all, pan, timer).
10. Bestiary counters and reveal thresholds.

### Pitfalls / design lessons
* Re-seeding the RNG from a per-monster seed before loot makes loot immune to timing and network order.
* Item level uses the **base** type level, not the difficulty-adjusted level; higher difficulties scale via the
  difficulty-aware level only for XP/to-hit. Decide this explicitly.
* "Monster dies → nearby cowards flee" is a one-function feature that adds a lot of readability to swarms.


---

## 10. Missile core (projectiles, spell effects, timed effects)

### Purpose
A single "missile" entity type implements every projectile, area effect, timed buff, teleport, summon trigger and even
the monster charge. Each missile type row binds an **Add** function (spawn-time setup) and a **Process** function
(per-tick update), a cast sound, a hit sound, a sprite id, a damage type, an `Arrow` flag, an `Invisible` flag and a
movement-distribution mode. Missiles live in a list; the per-tick loop clears/re-sets dungeon flags, runs process
functions, advances animation, and deletes finished missiles.

### Key data structures
**MissileData row** (TSV, 70 base + 40 expansion rows):
`id, addFn, processFn, castSound, hitSound, graphic, flags{Physical|Fire|Lightning|Magic|Acid, Arrow, Invisible},
movementDistribution{Disabled, Blockable (stops on first hit), Unblockable (keeps going)}`.

**MissileSprite row** (`missile_sprites.tsv`): `id, width, width2 (half-width offset), file, numFrames (1 = single
list, 8/16 = directional sheet), flags{MonsterOwned (loaded lazily with the monster type), NotAnimated}, frameDelay[16],
frameLength[16]` — per-direction animation delay and frame count (also used as per-*frame-group* tables for
multi-phase effects like guardian Start/Idle/Attack or wall Start/Idle).

**Missile instance**:
```
type; position { offset(px), velocity(px<<16 per tick), traveled(px<<16), tile, start, tileForRendering, offsetForRendering }
frameGroup (direction 0..15 or phase enum); spellLevel; deleteFlag; animType; animFlags; animData; animDelay; animLen; animWidth;
animCnt; animAdd (+1/−1 playback); animFrame (1-based); drawFlag; lightFlag; preFlag (draw behind actors); uniqTrans (palette of a unique source)
duration (ticks to live; 0 → done); source (player/monster index or −1 trap); caster {TARGET_MONSTERS (player-owned), TARGET_PLAYERS (monster-owned), TARGET_BOTH};
damage; hitFlag; dist (ticks travelled — accuracy penalty); lightId; rnd; var1..var7 (type-specific); limitReached; lastCollisionTargetHash
```
Dungeon flags set by `PutMissile`: `Missile` on the tile; `MissileFireWall` / `MissileLightningWall` for wall segments
(AI hazard avoidance reads these); `MissilePreFlag` global when any pre-drawn missile exists.

**Direction16**: 16-point compass for sprites (S, SSW, SW, WSW, W, WNW, NW, NNW, N, NNE, NE, ENE, E, ESE, SE, SSE).

### Algorithms & rules

**10.1 Spawn pipeline (`AddMissile(src, dst, dir, type, caster, sourceId, damage, spellLevel, parent?, sfx?)`)**
```
if list full: return null
m = new; m.type/caster/source/damage/spellLevel; tile = start = src; animAdd = 1; animType = row.graphic; drawFlag = !Invisible; light = none
if monster-owned and source is unique: uniqTrans = source.uniqTrans + 1   // recolour projectile like its owner
frameGroup = (no graphic or sheet < 8 groups) ? 0 : dir
play cast sound at src (override allowed)
row.addFn(m, {dst, dir, parent, fizzled=false})
if fizzled: return null (caller refunds mana)   // teleport with no space, berserk with no target, etc.
return m
```

**10.2 Velocity in fixed point (`UpdateMissileVelocity(m, dst, speedPx)`)**
```
velocity = 0 if tile == dst
n = (tile - dst).worldToNormalScreen()        // rotate world→screen: (dy−dx, −(dy+dx)), normalise to 16.16, halve y (isometric)
velocity = n * speedPx                        // 16.16 px per tick along screen axes
```
Speeds are expressed in **screen pixels per tick**; a tile is 64 px wide / 32 px tall on screen so 16 px/tick ≈ ¼ tile
per tick (5 tiles/s), 32 ≈ ½ tile/tick.

**10.3 Position integration (`UpdateMissilePos`)**
```
px = traveled >> 16
tileOffset = px.screenToMissile()             // ((2y + x ± 32)/64, (2y − x ± 32)/64) — rounded inverse isometric transform
tile = start + tileOffset
offset = px + tileOffset.worldToScreen()      // sub-tile pixel remainder for rendering
light offset = px.screenToLight() − tileOffset*8
```

**10.4 Movement with tile-skip protection (`MoveMissile(m, checkTile, stopBeforeBlocked)`)**
```
prev = tile; traveled += velocity; UpdateMissilePos
visited = axis-aligned velocity ? chebyshev(prev, tile) : manhattan(prev, tile)
if visited == 0: return false
if visited > 1:                                      // fast missile crossed intermediate tiles this tick
    inc = velocity * ((32<<16) / max(2*|vy|, |vx|))  // sub-step so that each step moves ≤ half a tile on screen
    walk back to the previous multiple of inc and step forward:
        compute intermediate tile; skip exact tile corners (px.y % 16 == 0 && px.x % 32 == 0 && parity differs); skip repeats
        if !checkTile(tile): snap traveled to this sub-step (or one before, if stopBeforeBlocked → StopMissile); return true
if !checkTile(tile) && stopBeforeBlocked: back out one velocity step; StopMissile
return true
```

**10.5 Collision (`CheckMissileCol(m, dmgType, min, max, shifted, tile, dontDelete, onlyHitWalking?)`)**
```
monster at tile (occupying id > 0, or petrified; or — for walls — a walking monster whose tile/future straddle the wall line):
    trap or monster-owned vs opposite faction (summon vs non-summon, or either berserk) → MonsterTrapHit
    player-owned → MonsterMHit
    hit → (duration = 0 unless dontDelete); hitFlag = true
player at tile:
    player-owned & not the source → Plr2PlrMHit ; monster-owned → PlayerMHit(monster) ; TARGET_BOTH/trap → PlayerMHit(null)
    hit → expansion && blocked ? RotateBlockedMissile (deflect ±1 direction) : duration = 0 (unless dontDelete); hitFlag = true
tile blocks missiles (solid/BlockMissile property, or an object that blocks): break breakable objects; duration = 0 (unless dontDelete); hitFlag = false
if duration == 0 && row.hitSound: play at tile
```
`MoveMissileAndCheckMissileCol` wraps movement: the tile predicate calls `CheckMissileCol` and returns "keep going"
unless a hit happened and the type is `Blockable`, or the tile blocks missiles; after moving, if the tile did **not**
change but the occupant hash (`dMonster ^ dPlayer`) did, it checks once more (so slow missiles hit a target that walks
into them, but never hit the same target twice on one tile).

**10.6 Per-tick loop (`ProcessMissiles`)**
```
for each missile: clear its tile's Missile flags (or mark for deletion if out of bounds)
delete flagged
MissilePreFlag = false
for each missile: row.processFn(m); if animated: animCnt++; if animCnt >= animDelay: animCnt = 0; animFrame += animAdd (wrap 1..animLen)
mana shield upkeep (drop when mana empty)
delete flagged
```
Process functions end by `PutMissile` (re-set flags) unless deleted.

**10.7 Source damage conventions**: `ProjectileMonsterDamage = randBetween(m.minDamage, m.maxDamage)`;
`ProjectileTrapDamage = depth + rand(2*depth)`; player spells compute their own (§11); `ScaleSpellEffect(base, SLVL)`
= apply `base += base/8` SLVL times (≈ ×1.125^SLVL); `GenerateRndSum(range, n)` = sum of `n` rolls of `rand(range)`.

**10.8 Direction16 from two points (`GetDirection16`)**: fold into one octant by abs/swap, then `3*minor <= 2*major`
→ (if `5*minor < major` → 45°-class else 22.5°-class) else 0°-class, then un-flip around pivots. Arrows use
`animFrame = dir16 + 1` on a single 16-frame list; other 16-sheet sprites use `frameGroup = dir16`.

**10.9 Deflection (`RotateBlockedMissile`)**: arrow → `animFrame = (frame ± 1 + 15) % 16 + 1`; sheets → `frameGroup ± 1`
wrapped to the sheet size.

### Reference tuning values
| Item | Value |
|---|---|
| Screen tile size | 64 × 32 px; `worldToScreen = ((y−x)*32, −(y+x)*16)` |
| Fixed point | 16.16 for `traveled`/`velocity`; 26.6 for HP/damage |
| Standard projectile speeds (px/tick) | arrow 32 (+CLVL/4 rogue, +CLVL/8 warrior/bard, +1/2/4/8 for attack-speed affixes; random 16–47 affix), firebolt 26 (monster) / 16 + min(2·SLVL,47) (player), fireball 16 + min(2·SLVL,34), holy bolt 16 + min(2·SLVL,47), generic magic bolt 16, magma ball 16, acid 16, zig-zag bolt 8, charge 18, egg 8, elemental/soul 16, wall placement 16, lightning control 32, inferno control 32, lightning bow 32 |
| Default lifetime | 256 ticks for moving projectiles (255 for some) |
| Light radii | moving bolts 8 (zig-zag 5), lightning segment 4, guardian 1→15 ramp, explosions 9→12→0 ramps |
| Sub-step size | ≤ ½ screen tile per collision check |
| Max missiles | list `max_size` (effectively unbounded) |

### Smallest buildable chunks
1. Missile row + sprite row TSV loaders with function-name → function-pointer registries.
2. Missile instance struct + list + `AddMissile` pipeline with fizzle refund.
3. Isometric transforms (`worldToScreen`, `screenToMissile`, `worldToNormalScreen`, `screenToLight`).
4. `UpdateMissileVelocity` / `UpdateMissilePos`.
5. `MoveMissile` with sub-stepping and corner skipping.
6. `CheckMissileCol` with faction rules and `onlyHitWalking` wall mode.
7. `MoveMissileAndCheckMissileCol` with occupant-hash re-check.
8. `ProcessMissiles` loop and flag maintenance (`PutMissile`, pre-flag).
9. `GetDirection16` + arrow frame mapping + deflection.
10. Light attachment helpers (attach, move with offset, ramp tables, detach).
11. Damage helpers (`ScaleSpellEffect`, `GenerateRndSum`, source-damage conventions).
12. Debug visualiser drawing missile tiles, sub-steps and flags.

### Pitfalls / design lessons
* Integrate in screen space but collide in tile space; the rounding in `screenToMissile` (±32 before /64) is what
  keeps the tile assignment stable.
* Sub-step fast missiles or they tunnel through walls and actors; the engine caps each check at half a tile.
* Use the occupant hash to avoid double hits on slow missiles without maintaining per-target hit lists.
* `Blockable` vs `Unblockable` is a single data flag that distinguishes bolts from waves — resist the urge to special
  case per type.
* The "fizzled" return lets the caster refund resources; make every Add function able to fail.

---

## 11. Missile archetype catalog

Each entry: **behaviour**, **damage formula** (P = player source, M = monster source, T = trap), **speed/lifetime**,
and **notes**. "Explode-on-end" means the type spawns a stationary explosion missile that re-checks collision once.

### 11.1 Straight physical projectile — Arrow
* Add: aim at `dst` (or `src + dir` if same tile); speed 32 (+ class/affix bonuses above); 16-direction frame;
  lifetime 256. `dist` increments per tick → accuracy penalty `dist²/2` (player) / `2·dist` (vs player).
* Damage at impact: P `[weaponMin, weaponMax]` (+ ranged bonuses in `MonsterMHit`), M `[minDmg, maxDmg]`,
  T `[depth, 2·depth]`. Blockable.
* Multi-shot affix fires 2 arrows on frame `AFNum+1` with ±1 tile spread perpendicular to aim.

### 11.2 Elemental arrow — fire/lightning arrow
* Same flight as arrow; physical hit first with weapon damage, then on stop becomes a 1-tile explosion dealing the
  weapon's elemental range (`_pIF*` or `_pIL*`; T: `[1+depth, 1+2·depth]`) to whatever is on the tile. Light 5.

### 11.3 Generic magic bolt (fire bolt, blood-star, magma ball, acid glob, coloured flares)
* Add: speed 16 (firebolt P: 16 + min(2·SLVL, 47); M firebolt 26); 16-dir if sheet has 16 groups; light 8;
  lifetime 256 (magma ball starts 3 velocity-steps ahead; acid lifetime `5·(INT+4)` ticks).
* Damage: firebolt P `rand(10) + MAG/8 + SLVL + 1`; blood-star P `3·SLVL − MAG/8 + MAG/2`; M `[min,max]`;
  T `depth + rand(2·depth)`.
* Process: `ProcessGenericProjectile` — move, collide (stop before the hit tile), on end spawn the matching explosion
  (magma-ball/firebolt → small fire burst; blood-star → star burst; acid → splat → **puddle**; flares → coloured bursts).

### 11.4 Fireball (explodes in a 3×3)
* Add: speed `16 + min(2·SLVL, 34)`; P damage `ScaleSpellEffect(2·(CLVL + rand(10)+rand(10)) + 4, SLVL)`; M uses
  `[min,max]` at impact.
* Process: move/collide; on stop: check the centre + 8 neighbours (skipping those behind a wall from the *start*),
  with `dontDelete` so all are damaged; nudge sprite for wall-adjacent explosions; switch to big-explosion anim.
* Expansion bow variant (`FireballBow`) uses the immolation launcher (speed 16 + min(SLVL,34)) and the same process.

### 11.5 Zig-zag bolt (charged bolt)
* Add: speed 8; `rnd = rand(15)+1` seeds a 16-entry turn pattern `{-1,0,1,-1,0,1,-1,-1,0,0,1,1,0,1,-1,0}`;
  damage P `rand(MAG/4) + 1`, M 15; light 5; lifetime 256; `var1 = 5` (light), `var2 = base direction`.
* Process: every 16 ticks pick next pattern entry → turn Left/Right/straight and re-aim one tile ahead; on hit become a
  stationary lightning sprite for `animLen` ticks. Monsters fire **3** at once; the player bow version fires 3 too.

### 11.6 Holy bolt (anti-undead)
* Add: speed `16 + min(2·SLVL, 47)`; damage `rand(10) + CLVL + 9`; light 8.
* Process: move/collide (stop before hit tile); on stop → holy explosion anim (light `frame + 7`). Immune for all
  non-undead except the final boss (§8.14).

### 11.7 Homing seeker — elemental / soul bolt
* Add: speed 16, 8-direction sprite, light 8; stores `dst` in `var4/5`; damage: elemental
  `ScaleSpellEffect(2·(CLVL + 2 rolls of rand(10)) + 4, SLVL) / 2`; soul bolt none at launch.
* Process: fly straight to `dst` (`var3 == 0`); on arrival `var3 = 1 → 2`, lifetime 255, **retarget**: nearest monster
  within radius 19 with clear LOS (`FindClosest` via ring search) → re-aim; else continue in the caster's facing.
  Soul bolt sets its damage to `target.hp >> 7` (raw) = 1/2 of the target's HP in whole units… and at impact deals
  `target.hp / 3` (bone-spirit rule in hit functions). Elemental explodes 3×3 on stop (using the retarget point as the
  LOS origin); soul bolt holds a 7-tick death sprite.

### 11.8 Lightning beam (segment spawner) — lightning / thin lightning / lightning bow
* Control missile: invisible, speed 32, lifetime 256, remembers last tile in `var1/2`.
* Each tick (`SpawnLightning`): `duration--`, move with a predicate that stops at missile-blocking tiles (traps may
  pass their own start tile); if the current tile is new and not blocking, spawn a **Lightning segment** missile there
  (monster lightning-caster family spawns the thin variant). Damage per segment: P `(rand(2) + rand(CLVL) + 2) << 6`
  (raw), M `2·randBetween(min,max)`, T `rand(depth) + 2·depth`.
* Segment: lifetime P `SLVL/2 + 6`, M 10 (8 for the shock-bat and traps); random start frame 1..8; light 4; each tick
  collides on its tile with `dontDelete`; a hit does not shorten it (`duration` restored). Unblockable by actors.
* Lightning bow (expansion) = control missile with damage `<< 6` from the item, segments as above.

### 11.9 Chain lightning
* Add: lifetime 1; `var1/2 = dst`.
* Process: fire one lightning control at `dst`, then one at **every monster tile** within ring radius `min(SLVL+3, MaxCrawlRadius)`
  (each with damage 1 → segments use the CLVL formula). Then delete.

### 11.10 Nova ring (lightning nova / immolation / rune of nova)
* Add: `var1/2 = dst`; damage P `ScaleSpellEffect((rand(6)×5 + CLVL + 5) / 2, SLVL)`, T `depth/2 + 3 rolls rand(3)`;
  lifetime 1.
* Process: for 9 quarter-radius offsets `{(4,0),(4,1),(4,2),(4,3),(4,4),(3,4),(2,4),(1,4),(0,4)}` and their 4 flips,
  spawn a **nova ball** (lightning) or **fireball-bow** (immolation) toward `src + offset` → 36 projectiles (duplicates
  on the axes). Nova ball: speed 16, lifetime 255, unblockable, keeps lifetime on hit; stops at a shrine object on its
  target tile.

### 11.11 Point-blank flash (two halves: bottom/top)
* Damage P: `ScaleSpellEffect(sumRand(20, CLVL+1) + CLVL + 1, SLVL)`, then `+50%`; M `2·LVL`; T `depth/2`.
* Lifetime 19; each tick checks 6 tiles (bottom: NW, self, SE, W, SW, S) / 3 tiles (top: N, NE, E) with `dontDelete`;
  caster is **invincible** for the duration. Monster mages cast both halves with damage 4 (then `MonsterAttackPlayer`
  path isn't used — missile path with `[4,4]`).

### 11.12 Ground AoE: wall segment (fire wall / lightning wall)
* Fire wall segment: damage `((rand(10)+rand(10) + 2) + (P ? CLVL : depth)) << 3` raw ≈ `(2..20 + L)/8` HP per tick;
  lifetime `10 · (SLVL+1 if SLVL>0) (+depth if M/T) · 16` ticks; start-phase anim then idle with random frame;
  light ramps `2..12`; checks its tile every tick with `dontDelete`. Segments created by `TryGrowWall` in the
  **gap** between diagonal steps are invisible and use `onlyHitWalking` so actors crossing the line are still hit.
* Lightning wall segment: damage `16·(rand(10)+rand(10) + CLVL + 2)` raw; lifetime `255·(SLVL+1)`; on hit the lifetime
  is restored (persistent).
* Wall control missile: lifetime 7 (grows up to 6 segments each side); `var1/2` left head, `var5/6` right head,
  `var3/4` growth directions (`Left²(dir)`, `Right²(dir)`); first tick places the centre, then each tick tries to grow
  both heads one tile, filling diagonal gaps; stops a head at blocking tiles.
* Ring of fire (expansion): ring radius 3 of fire-wall segments with damage `16·(2 rolls rand(10) + L + 2)/2`, placed
  with LOS from the centre; stops at the first blocking tile.
* Flame wave (moving wall): control places a 1-tile wave at `src + dir` and grows `SLVL/2 + 2` segments to each side;
  each wave segment moves at 16 px/tick, lifetime 255 (not shortened by hits), damage `rand(10) + CLVL + 1`,
  unblockable; rendered one tile south with a −32 px offset.

### 11.13 Ground AoE: puddle (acid)
* Splat: plays, then spawns a puddle with damage `type.level >= 2 ? 2 : 1`; death puddle uses `INT+1`.
* Puddle: lifetime `rand(15) + 40·(INT+1)` ticks; pre-drawn (under actors); checks its tile each tick with
  `dontDelete`; **unblockable** by shields (§8.12); then a short end animation.

### 11.14 Line-of-fire breath (inferno)
* Control: invisible, speed 32, lifetime 256; each tick that it enters a new non-blocking tile it spawns an inferno
  tile with `var3` (0,1,2) as damage seed, stops after 3 tiles or on a blocking tile.
* Inferno tile: `var2 = 5·dam` delay before it becomes visible; lifetime `var2 + 20`; damage P
  `i = rand(CLVL) + rand(2); 8i + 16 + (8i+16)/2`, M `[min,max]`; collides each tick, lifetime restored on hit.

### 11.15 Turret — guardian
* Add: find nearest free, missile-clear tile within radius 5 of `dst` (no monster, object, missile, solid); fizzles if
  none. Lifetime `min(SLVL + CLVL/2, 30) << 4` (min 30) ticks; light ramps 1→15.
* Process: every 16 ticks scan a 48-entry arc table (6-tile reach) in 4 mirrored quadrants; at the first tile holding
  a live non-summon monster with moving-missile LOS fire a firebolt with damage
  `ScaleSpellEffect(rand(10) + CLVL/2 + 1, SLVL)`; show attack frame-group for 3 ticks. Winds down with a reversed
  start animation at `duration == 14`.

### 11.16 Charge / rush (monster)
* Add: velocity 18 px/tick toward the enemy's position; the missile **borrows the monster's sprite** (walk anim, or
  special for the quadruped family, attack frame 7 for serpents) and its light if unique; lifetime 256.
* Process: if the monster left Charge mode → delete. Clear the monster's old tile, advance (serpents look two steps
  ahead and move twice as far), and if the next tile is not available (or a serpent's lookahead is blocked / its anim
  finished): `MissToMonst(prevTile)` → monster stands on `prevTile`, gets a free stagger, and if a player stood on the
  blocked tile: `MonsterAttackPlayer(hit=500, specialDamage)` + forced stagger + **shove the player one tile** along
  the charge (serpents don't shove); if a monster stood there: `MonsterAttackMonster(500, special)` and the charger
  steps into the vacated tile if free. Otherwise the monster's tile/future/old follow the missile each tick.
  A south-facing visual correction nudges the sprite one tile south.

### 11.17 Spawn projectile — egg
* Add: speed 8, lifetime 9, `var1 = facing`. Process: collides each tick (0 damage, used only to stop early), moves,
  and on expiry spawns the spawn-type monster on the nearest free tile (radius ≤ 1) via the owner-only spawn protocol.

### 11.18 Multi-target boss AoE
* Add: for every active player with missile LOS from the boss, spawn a fire-explosion at the player's future tile
  with the given damage (40, scaled through monster-source paths); delete self. The explosion checks its tile once
  (`var1` latch) for `animLen` ticks.

### 11.19 Area pulse — apocalypse
* Add: 17×17 box clamped to the map; damage `sumRand(6, CLVL) + CLVL`; lifetime 255.
* Process: scan row-major from the saved cursor; at the first non-summon monster on a non-solid tile (expansion: also
  requires LOS) spawn one explosion there and *return* (one target per tick, resumes next tick) → a visible sweep.

### 11.20 Teleports
* Phasing: lifetime 2; random free tile in the 13×13 ring excluding the central 7×7 band (`|x|>3 && |y|>3`); fizzles
  if none. Scripted variant jumps to `dst` with an expanding-square fallback up to radius 49.
* Teleport: nearest free tile within radius 5 of `dst`; fizzles if none; lifetime 2.
* Warp (expansion): nearest stairs trigger (with per-biome tile offsets) → nearest free tile within 5 not on a trigger.
* Process (`ProcessTeleport`): on the second tick move the player (clear old tile/translucency, set tile/future/old,
  move light & vision, recentre camera).

### 11.21 Status/instant effects implemented as missiles
Petrify (stone curse), berserk, mana shield, reflect, rage, infravision, search, healing, heal-other cursor,
identify/repair/recharge/disarm/telekinesis cursors, resurrect, town/red portals, mana/full-mana potions-as-spells,
steal potions / steal mana (trap shrines), open-nest (4 big explosions at fixed tiles), jester (random spell from a
10-entry table), runes (place a trigger tile within 9 that fires the stored spell when any actor steps on it; rune of
light damage `16·(2 rolls rand(10) + CLVL + 2)`), big explosion (`ScaleSpellEffect(2·(CLVL + 2 rolls rand(10)) + 4,
SLVL)` to the 3×3 once, light 8), weapon-hit explosion (1-tile elemental burst from melee affixes), spectral arrow
(expansion: on frame fires a fireball-bow / lightning-bow / 3× bolt-bow / holy-bolt-bow depending on an item code).
See §12 for the status ones.

### Reference tuning values — missile archetype summary

| Archetype | Speed (px/tick) | Lifetime | Damage (player source) | Damage (monster source) | Collision mode |
|---|---|---|---|---|---|
| Arrow | 32 + class/affix | 256 | weapon range + ranged bonuses | `[min,max]` | Blockable, `dist²/2` penalty |
| Elemental arrow | 32 + class/affix | 256 → explosion | weapon phys, then elemental range | `[min,max]` | Blockable + 1-tile burst |
| Fire bolt | 16 + min(2·SLVL,47) (M 26) | 256 | `rand(10) + MAG/8 + SLVL + 1` | `[min,max]` | Blockable, stops short, burst |
| Blood-star bolt | 16 | 256 | `MAG/2 − MAG/8 + 3·SLVL` | `[min,max]` | Blockable |
| Magma ball / acid / flares | 16 | 256 (acid `5(INT+4)`) | — | `[min,max]` | Blockable; acid leaves puddle |
| Fireball | 16 + min(2·SLVL,34) | 256 | `Scale(2(CLVL + 2d10) + 4)` | `[min,max]` | Blockable, 3×3 burst |
| Zig-zag bolt | 8 | 256 | `rand(MAG/4)+1` | 15 | Blockable; 3 at once |
| Holy bolt | 16 + min(2·SLVL,47) | 256 | `rand(10) + CLVL + 9` | — | Blockable; undead-only |
| Elemental seeker | 16 | 256 + 255 | `Scale(2(CLVL + 2d10) + 4)/2` | — | Unblockable; retarget r19; 3×3 burst |
| Soul seeker | 16 | 256 + 255 + 7 | `target.hp/3` | — | Blockable; retarget r19 |
| Lightning beam segment | control 32 | seg `SLVL/2 + 6` (M 10, trap 8) | `(rand(2)+rand(CLVL)+2)` HP | `2·[min,max]` | per-tile, hits don't consume |
| Chain lightning | — | 1 | per segment as above | — | one beam per monster in r≤SLVL+3 |
| Nova ring | 16 | 255 | `Scale((5·rand(6) + CLVL + 5)/2)` | trap `depth/2 + 3d3` | 36 unblockable balls |
| Flash (self nova) | — | 19 | `Scale(Σ(CLVL+1)·rand(20) + CLVL + 1) ×1.5` | `2·LVL` | 9 tiles, caster invincible |
| Fire wall segment | placement 16 | `10(SLVL+1)(+depth)·16` | `(2d10 + 2 + CLVL)/8` HP per tick | same with depth | per-tile, pierces |
| Lightning wall segment | 16 | `255(SLVL+1)` | `(2d10 + CLVL + 2)/4` HP per tick | — | per-tile |
| Flame wave | 16 | 255 | `rand(10) + CLVL + 1` | — | Unblockable moving line, `SLVL/2+2` wide each side |
| Acid puddle | — | `rand(15) + 40(INT+1)` | — | 1–2 (death: INT+1) | per-tile, unblockable by shield |
| Inferno line | control 32 | `5·dam + 20` per tile, 3 tiles | `8i+16 (+50%)`, `i = rand(CLVL)+rand(2)` | `[min,max]` | per-tile |
| Guardian turret | — | `min(SLVL + CLVL/2, 30)·16` | firebolt `Scale(rand(10) + CLVL/2 + 1)` every 16 ticks | — | reach 6 |
| Charge | 18 (serpent ×2) | until blocked | — | special range, to-hit 500, shove | moves the monster |
| Spawn egg | 8 | 9 | — | spawns a monster | stops early on contact |
| Boss multi-AoE | — | 1 + burst | — | 40 (scaled) per player in LOS | one burst per player |
| Apocalypse sweep | — | 255 | `Σ CLVL·rand(6) + CLVL` | — | 17×17, one target/tick |
| Big explosion (rune/nest) | — | `animLen − 1` | `Scale(2(CLVL + 2d10) + 4)` | — | 3×3 once |

### Smallest buildable chunks
1. Arrow (11.1) — first end-to-end projectile with accuracy penalty.
2. Generic bolt + explode-on-end child (11.3) and the explosion light ramp.
3. Fireball 3×3 burst with wall-occlusion check from start.
4. Zig-zag bolt pattern mover.
5. Holy bolt + undead-only immunity hook.
6. Seeker retarget via ring search (11.7).
7. Beam control + segment spawner (11.8) with per-source damage.
8. Chain lightning fan-out.
9. Nova ring 36-ball spawner; nova ball shrine stop.
10. Flash two-half AoE with caster invincibility toggle.
11. Wall segment + wall control growth with diagonal gap fill and `onlyHitWalking`.
12. Flame wave moving line.
13. Acid splat → puddle → end anim; death puddle hook.
14. Inferno control + delayed tiles.
15. Guardian turret arc scan + firebolt child.
16. Charge missile borrowing monster sprites + `MissToMonst` impact/shove.
17. Spawn egg → owner-only spawn.
18. Boss multi-target AoE + latch explosion.
19. Apocalypse row-major sweep.
20. Teleport family (phasing ring, nearest-free, stairs warp) with fizzle.
21. Rune trigger tiles.
22. Elemental arrows and weapon-hit explosions.
23. Per-archetype golden tests: fixed seed → identical tile path and damage log.

### Pitfalls / design lessons
* Child missiles inherit `traveled/offset` from the parent (`SyncPositionWithParent`) so explosions appear exactly
  where the bolt stopped, not at the tile centre.
* Persistent-area effects restore `duration` after a hit so a successful hit does not end them; one-shot effects use
  the `var1` latch to hit a tile exactly once.
* Walls need the "gap segment" trick or diagonal walls are porous.
* Keep monster-sourced damage reading `[min,max]` **at launch** where possible; several process functions re-read the
  source each tick, which the engine itself flags as a bug.
* The charge-as-missile approach reuses collision/sub-stepping for free, but requires a dedicated clean-up path
  (`MissToMonst`) whenever the monster leaves Charge mode by other means (death, petrify).

---

## 12. Status effects

### Purpose
Temporary or permanent state changes applied to actors, almost all implemented either as a monster mode/flag or as a
long-lived invisible missile that owns the timer.

### Key data structures
Monster: mode `Petrified` + `animInfo.isPetrified`; flags `HIDDEN`, `BERSERK`(+`GOLEM`), `ALLOW_SPECIAL`,
`LOCK_ANIMATION`, `NOLIFESTEAL`; goal `Retreat` (fear). Player: `pManaShield`, `wReflections` (charges),
`_pSpellFlags{Etherealize, RageActive, RageCooldown}`, `_pInfraFlag`, `_pInvincible`, permanent base-stat and
max-HP/mana reductions.

### Algorithms & rules
| Effect | Apply | Duration / strength | Interactions |
|---|---|---|---|
| **Petrify** (stone curse) | Nearest monster within 5 of target (not summon, not final/uber boss, not fading/charging); if already petrified → no-op. Missile stores `var1 = old mode`, `var2 = monster`; `monster.petrify()` | `min(SLVL + 6, 15) << 4` ticks (96..240) | Petrified monsters: auto-hit by melee/missiles (roll 0), no animation, no AI; visual mode is read back from the missile; if killed while petrified → shatter anim (11 ticks) + shatter corpse, no death anim; expiry restores the old mode. Caster leaving the level un-petrifies |
| **Berserk** (turn a monster) | Nearest monster within 5: not summon/berserk/unique/final boss, not fading/charging, not magic-immune; magic-resistant only 50% | Permanent; `flags |= BERSERK | GOLEM`; damage ranges ×`(120 + rand(10))% + SLVL`; gets a light (radius 3, 9 in the hive biome) | Treated as a player faction member for collision/targeting but *not* as a player minion for loot/XP (`isPlayerMinion` excludes berserk) |
| **Hidden / fade** | `HIDDEN` flag + FadeIn/FadeOut modes (§7.12, §7.17) | AI-driven | Hidden monsters are not cursor-targetable; mages are unhittable while goal ≠ Normal; death clears `HIDDEN` |
| **Mana shield** | Flag on player; fizzles if already active | Until mana reaches 0 (checked every missile tick) | Damage absorbed from mana with level-based reduction (§8.4) |
| **Reflect** | `charges += (SLVL ? SLVL : 2) * CLVL` (saturating at 65535) | Consumed one per reflected hit | Reflects 20–30% of melee damage to the attacker, also on blocked hits |
| **Rage** (self-buff) | Requires HP > CLVL and no active/cooldown flag; `RageActive`; recompute stats | `245 + 2·CLVL` ticks active, then the same again as cooldown; self-damage `6·CLVL` HP at end (never lethal, min 1 HP) | Stat recalculation on both transitions |
| **Infravision** | `_pInfraFlag = true` each tick | `ScaleSpellEffect(1584, SLVL)` ticks | Recompute item values at end |
| **Search** (show items) | Automap item reveal | `2·CLVL + 10·SLVL + 245`; recasting adds durations | — |
| **Etherealize** | Spell flag (player cluster) | — | Immune to arrows and monster melee |
| **Caster invulnerability** | `_pInvincible = true` during flash | 19 ticks | Both flash halves set and clear it |
| **Stat drain** (monster hit) | `MonsterReducePlayerAttribute` on every successful melee or missile hit from a monster with non-zero drain fields | Permanent: base STR/MAG/DEX/VIT reduced; max HP reduced by `min(maxHPBase − 1, N)`; max mana by `min(maxManaBase, N)` | Only the local player applies it to itself; data rows use it sparingly (1 HP drain on an early shambler variant) |
| **Fear** | `M_FallenFear` on deaths; stalker retreat after stagger; guardian/mage retreat below ½ HP | Imps: `max(8 − lvl, 2)` ticks away from the corpse | Retreating imps are still hittable; illusion stalkers are not |
| **Statue pose** | `ALLOW_SPECIAL` on stone guardians (and the breath channel) | Until an enemy is within `INT + 2` or the leader unfolds | Attacks against a posing guardian are converted into "unfold" |
| **Slow-regen** | passive `LVL/128` HP per tick for all monsters | always | — |
| **Life steal** (co-op skeleton boss) | `hp += dam` on each hit | — | disabled by `NOLIFESTEAL` |
| **Knockback** | monster flag or player affix | 1 tile | requires legal step; forces stagger |
| **Weapon elemental explosions** | melee affixes | instant | 1-tile burst with weapon's elemental range |

### Reference tuning values
| Effect | Value |
|---|---|
| Petrify duration | `(min(SLVL+6, 15)) * 16` ticks → 6..15 s |
| Berserk damage | ×1.20–1.29 + SLVL flat |
| Reflect charges | `max(SLVL,2) * CLVL`, 20–30% reflected |
| Rage | active `245 + 2·CLVL`, cooldown same, penalty `6·CLVL` HP |
| Infravision | `1584 × 1.125^SLVL` ticks (≈ 79 s at SLVL 0) |
| Search | `2·CLVL + 10·SLVL + 245` ticks |
| Flash invulnerability | 19 ticks |
| Stalker reveal/hide | reveal `< 5 − INT`, hide `≥ 6 − INT` tiles |
| Mage retreat | 4 steps then re-appear |
| Guardian heal pulse | `maxHP / (16·(4..8))` per pulse until full |

### Smallest buildable chunks
1. Petrify: mode, missile timer, auto-hit rule, shatter death, visual-mode lookup, caster-leaves cleanup.
2. Berserk: faction flip, damage scaling, light, loot/XP exclusion.
3. Hidden/fade state with cursor and hit exclusions.
4. Mana shield absorb + upkeep.
5. Reflect charges + 20–30% reflection on melee (incl. blocked).
6. Rage timer missile with two phases and stat recompute.
7. Infravision/search timers with stacking rule.
8. Caster invulnerability toggle tied to missile lifetime.
9. Permanent stat-drain application with floors.
10. Fear goal + propagation on death.
11. Statue pose/unfold hook (`tryLiftGargoyle`) in all hit paths.

### Pitfalls / design lessons
* Owning timers in a missile object gives every effect save/load, network and cleanup for free, but each needs an
  explicit "caster left the level" path (petrify restores modes in `RemovePlrMissiles`).
* Stacking rules must be explicit per effect (petrify no-op, search adds, rage refuses).
* Faction flips (berserk) should be modelled as *flags* consulted by the collision/targeting code, not by moving the
  entity between lists.

---

## 13. Sound trigger points

### Purpose
Positional one-shot SFX tied to combat and AI events; not a system of its own but a list of hook points the other
systems must expose.

### Key data structures
Per monster type: 4 categories (Attack, Hit, Death, Special) × 2 random variants. Per missile type: `castSound`,
`hitSound`. Global SFX ids for swings, blocks, boss greetings, dialogue.

### Algorithms & rules
* **`PlayEffect(monster, category)`**: skip while a level is loading / sound off / network buffering; pick variant
  `rand(2)`; skip if that exact sample is already playing; compute position: `pan = clamp((dx − dy) * 256)`,
  `volume = −64 × approxDistance(player, monster)`, inaudible below the attenuation floor.
* **Trigger points**:
  * Attack sound on the melee hit frame (`MonsterAttack`), on ranged fire, extra hit frames for multi-hit families,
    serpent on frame 0, charger/serpent on charge start (special/attack).
  * Hit sound in `M_StartHit` (every damaging hit, including resisted ones) and for resisted missile hits.
  * Death sound in `MonsterDeath` (boss uses a global fanfare instead).
  * Special sound on `SpecialStand` frame `animFrameNumSpecial-1`, on special ranged fire, on the breath/egg release.
  * Boss greeting/first-sight lines when a scripted boss first becomes visible (`activeForTicks == 0 && visible`).
  * Missile cast sound at `AddMissile` (overridable), hit sound when a missile's `duration` reaches 0 inside
    collision; `PlaySfxLoc` resets the start time for swing/shoot/walk/cast so rapid repeats don't get deduped.
  * Player: swing on frame `AFNum−2`, block clang in `StartPlrBlock`, grunt in `StartPlrHit`, spell-end chime when
    search expires, pod-pop/pig for the trap shrines.
* Dialogue (`Talk` mode) blocks until the speech sample finishes (`effect_is_playing`).

### Reference tuning values
| Item | Value |
|---|---|
| Pan | `(dx − dy) × 256`, clamped |
| Attenuation | `−64 × distance` (approx. Euclidean), cut below floor |
| Variants | 2 per category |
| Dedupe | skip if the same sample instance is still playing |

### Smallest buildable chunks
1. Positional SFX API with pan/attenuation.
2. Monster sound set table + `PlayEffect` with dedupe.
3. Hook calls at the trigger points above (attack frame, hit, death, special, cast, impact, block, stagger).
4. Dialogue gating for `Talk` mode.

### Pitfalls / design lessons
* Tie sounds to the same animation frames as the hit resolution so audio matches the moment of impact.
* Dedupe per sample instance, not per category, or packs become silent.

---

## 14. Cursor-target tracking & action repeat (`track.cpp`)

### Purpose
While the mouse button / controller action is held, repeat the last player action (walk, melee, ranged, spell,
operate) against the current cursor target each frame, without flooding the network or re-running failed path
searches.

### Key data structures
`LastPlayerAction` enum (None, Attack, AttackMonsterTarget, AttackPlayerTarget, Spell, SpellMonsterTarget,
SpellPlayerTarget, OperateObject, Walk); `WalkingRequest {action, startTile, destination, walkabilityGeneration,
lifelessPlayersMask}` cached from the last request; global `WalkabilityGeneration` counter bumped whenever anything
that affects pathing changes (`MarkWalkabilityChanged()` — called by monster moves/deaths, door operations, etc.).

### Algorithms & rules
* `InvalidateTargets()`: drop the hovered monster if invalid/dead/hidden/unlit; drop objects that can no longer be
  interacted with; drop players that are dead/quit/offline/unlit.
* `RepeatPlayerAction()`: only with the hand cursor, button held, not in a shop, no pending destination, not
  invincible, and `CanChangeAction()`. Melee repeats against a target farther than 1 tile are skipped if the identical
  walking request already failed (`IsWalkingRequestRedundant`: same action/start/destination/generation/lifeless
  mask). Walk repeats only when the player is standing or past frame 6 of a step and the cursor tile differs from the
  current target.
* `track_isscrolling()` = last action was Walk (used by the camera).

### Reference tuning values
| Item | Value |
|---|---|
| Walk re-issue frame | after frame 6 of the walk animation |
| Redundancy key | (action, start, dest, walkability generation, lifeless-players mask) |

### Smallest buildable chunks
1. Walkability generation counter and `MarkWalkabilityChanged` hooks in monster/door code.
2. `WalkingRequest` cache + redundancy test.
3. Target invalidation each frame.
4. Action-repeat dispatcher per action type.

### Pitfalls / design lessons
* A generation counter is a cheap, robust way to avoid re-running A* every frame while a button is held.
* Dead players do not block tiles, which is why their liveness is part of the redundancy key.

---

## Appendix A — Formula quick reference (all reference tuning values)

```
# Difficulty scaling (per instance at spawn)
HP:      T1 = 3*hp + 100   T2 = 4*hp + 200        (expansion: +50/+100 SP, +100/+200 MP)   SP: hp = max(hp/2, 1) first
Damage:  T1 = 2*(d + 2)    T2 = 4*d + 6           (normal and special, min and max)
AC:      T1 = ac + 50      T2 = ac + 80
ToHit:   T1 = th + 85      T2 = th + 120
Level:   T1 = L + 15       T2 = L + 30            unique: L = 2*uLevel (or base+5)
XP:      T1 = 2*(xp+1000)  T2 = 4*(xp+1000)       unique: *2
Resists: T2 uses the second resist column (non-uniques)
Minions of a unique: HP *2, INT = leader INT

# Hit resolution
Monster melee vs player:  roll(100) < max(toHit + 2*(mLVL-CLVL) + 30 - AC, floor{15,20,25,30})
   block:                  roll(100) < clamp(DEX + classBlock + 2*CLVL - 2*mLVL, 0, 100)   (Stand/Attack + shield)
   damage:                 max(randRaw(min<<6, max<<6) + getHit*64, 64)
Monster missile vs player: arrow: toHit + 2*(mLVL-CLVL) + 30 - 2*dist - AC ; spell: 40 + 2*mLVL - 2*CLVL - 2*dist ; floor {10,20,25,30}
   block:                  clamp(DEX + classBlock - 2*(mLVL-CLVL), 0, 100); unblockable if puddle/shifted
   resist:                 dam -= dam*res/100 ; resisted hits never stagger
Player melee vs monster:   clamp(CLVL + DEX/2 + itemToHit + classBase (+pierce) - pierce(AC), 5, 95) ; cleave side: -(70-2*CLVL) or -30
Player arrow vs monster:   clamp(CLVL + DEX + itemToHit + classBase (+pierce) - pierce(AC) - dist*dist/2, 5, 95)
Player spell vs monster:   clamp(MAG + classBase - 2*mLVL - dist, 5, 95)
Trap vs monster:           clamp(90 - AC - dist, 5, 95)
Monster vs monster:        roll(100) < toHit (no modifiers)
Petrified target:          auto-hit
Resist:                    damage / 4 ; Immune: no collision
Stagger monster:           dam >= mLVL + 3 (whole HP)
Stagger player:            dam >= CLVL  (heavy class: CLVL + CLVL/4)
Crit (crit classes):       CLVL % chance, x2
Weapon vs class:           undead: sword -50% / mace +50% ; animal: mace -50% / sword +50% ; demon: x3 with affix
Reflect:                   20..30% back, 1 charge ; Thorns: 1..3
Passive monster regen:     LVL/2 raw (= LVL/128 HP) per tick

# Spell damage (player)
Firebolt   rand(10) + MAG/8 + SLVL + 1
Fireball   Scale(2*(CLVL + d10 + d10) + 4, SLVL)      Scale(x,n): n times x += x/8
Lightning  per segment (rand(2) + rand(CLVL) + 2)
Flash      Scale(sum_{CLVL+1} rand(20) + CLVL + 1, SLVL) * 1.5
Nova       Scale((5*rand(6) + CLVL + 5)/2, SLVL) per ball
FireWall   ((d10 + d10 + 2) + CLVL) / 8 HP per tick, lifetime 10*(SLVL+1)*16
Guardian   firebolt Scale(rand(10) + CLVL/2 + 1, SLVL) every 16 ticks, life min(SLVL + CLVL/2, 30)*16
ChargedBolt rand(MAG/4) + 1 (x3 bolts), path pattern every 16 ticks
HolyBolt   rand(10) + CLVL + 9 (undead only)
Elemental  Scale(2*(CLVL + d10 + d10) + 4, SLVL) / 2 ; retarget radius 19
BoneSpirit target HP / 3
Inferno    8i + 16 + (8i+16)/2, i = rand(CLVL) + rand(2)
Apocalypse sum_{CLVL} rand(6) + CLVL, one target per tick in 17x17
FlameWave  rand(10) + CLVL + 1, width SLVL/2 + 2 each side
Golem      HP 2*(320*SLVL + maxMana/3) raw, AC 25, toHit 5*(SLVL+8) + 2*CLVL, dmg 2*(SLVL+4)..2*(SLVL+8)
StoneCurse min(SLVL+6, 15)*16 ticks
Monster projectiles: randBetween(minDmg, maxDmg) at launch/impact ; lightning caster 2x ; flash 2*LVL ; boss AoE 40
Trap projectiles: depth + rand(2*depth) ; lightning rand(depth) + 2*depth
```

## Appendix B — Suggested implementation order across the cluster (dependency-sorted)

1. Tables & loaders (§1.1–1.4) → 2. Dungeon flags, room ids, occupancy grid (§4.1) → 3. Direction/isometric math (§5.1, §10.3)
→ 4. Instance pool, `InitMonster`, difficulty scaling (§2.1–2.3) → 5. Animation component & mode handlers (§3)
→ 6. Vision & LOS (§4.2–4.3) → 7. Steering primitives & A* (§5) → 8. Targeting & wake (§4.4–4.6)
→ 9. Combat core: fixed-point damage, resist, stagger, `MonsterAttackPlayer`, `PlrHitMonst` (§8.1–8.10)
→ 10. Death/XP/loot/corpses (§9) → 11. Missile core (§10) → 12. Arrow + generic bolt + beam + wall (§11.1–11.3, 11.8, 11.12)
→ 13. Missile-vs-actor hit functions (§8.10–8.13) → 14. First AI set: shambler, skeleton melee, archer, plain ranged, avoidance (§7)
→ 15. Packs/leaders (§6) → 16. Population & placement (§2.4–2.8) → 17. Remaining AIs and their missiles (charge, breath, egg, seekers, novas, turret)
→ 18. Status effects (§12) → 19. Sound hooks (§13) → 20. Action repeat (§14) → 21. Balance harness & golden-seed tests.

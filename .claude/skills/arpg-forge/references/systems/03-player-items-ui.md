# Cluster 03 — Player Character, Classes & Progression, Items & Loot, Inventory & Equipment, Spells, Character/UI Panels

Genre-generic, IP-free systems breakdown extracted from a ~150k-line C++ reimplementation of a 1996 isometric
action-RPG engine. All proper names (title, classes, towns, monsters, items, affixes, quests) have been replaced
with neutral role names. Numeric constants are quoted verbatim from source and labelled **reference tuning values**;
they are mechanics, not IP. The engine runs game logic at a fixed **20 ticks/second (50 ms per tick)**; every
"tick" below means one logic step. Life and mana are stored as **26.6 fixed point** (64 sub-units per point);
class attribute multipliers are **10.6 fixed point**.

Class role names used throughout (the engine has six data-driven classes):

| Role name used here | Flags in data | Notes |
|---|---|---|
| **melee class** | `CriticalStrike` | high Str cap, shield-friendly |
| **ranged class** | `TrapSense` | high Dex cap, bow bonuses |
| **caster class** | none | high Mag cap, staff bonuses |
| **martial-arts class** | none | unarmed/staff bonuses, blocks without shield |
| **dual-wield class** | `DualWield` | can hold two one-handed swords/maces |
| **berserker class** | `CriticalStrike, IronSkin, NaturalResistance` | no mana, rage skill |

Game-mode names: **base mode** (original rule set) and **expansion mode** (expanded rule set, adds oils, runes, more
affixes/uniques, 6 classes instead of 3). A **shareware mode** restricts some content; mentioned only where it
changes a formula.

---

## System map

| System | Source files | Lines | Depends on | Depended on by |
|---|---|---|---|---|
| 1. Player character, classes, progression | `Source/player.cpp/.h`, `Source/players/validation.*`, `Source/tables/playerdat.*`, `assets/txtdata/classes/**`, `assets/txtdata/Experience.tsv` | ~5,200 + data | data-file loader, items (CalcPlrInv), spells, missiles, monsters (XP award), network cmds | combat, UI panels, inventory, stores, save/load, every gameplay system |
| 2. Player state machine & combat resolution | `Source/player.cpp` (StartWalk/StartAttack/DoAttack/PlrHitMonst/StartPlrHit/ApplyPlrDamage/ProcessPlayers), `Source/engine/animationinfo.*` | ~2,000 | pathfinding, animation info, monsters, missiles, objects | monsters (attack player), missiles, input controller, rendering |
| 3. Item data model & loot generation | `Source/items.cpp/.h`, `Source/items/validation.*`, `Source/tables/itemdat.*`, `assets/txtdata/items/*.tsv` | ~6,700 + data | RNG, spell data, monster data (drop levels), dungeon level, network | inventory, stores, player stats, UI item info, save/load, quests |
| 4. Equipment stat aggregation, consumables, durability, pricing, vendors | `Source/items.cpp` (CalcPlrInv, UseItem, Repair/Recharge/Oil, Spawn* vendors), `Source/stores.cpp` (prices only), `Source/qol/visual_store.cpp` | ~2,500 | player, items, spells, inventory | player combat, UI, stores |
| 5. Grid inventory, belt, equipment slots, stash, auto-pickup, serialization | `Source/inv.cpp/.h`, `Source/inv_iterators.hpp`, `Source/qol/stash.*`, `Source/qol/autopickup.*`, `Source/pack.cpp/.h` | ~4,000 | items, player, cursor, network, options | player, UI, stores, spells (scroll lookup), save/load |
| 6. Spell system | `Source/spells.cpp/.h`, `Source/tables/spelldat.*`, `assets/txtdata/spells/spelldat.tsv`, damage/effect formulas in `Source/missiles.cpp` (Add*/Process*), golem init in `Source/monster.cpp` | ~900 + ~1,500 of missiles | player, items (books/staves/scrolls), missiles, monsters | player casting, spellbook UI, hotbar, items (book/staff generation) |
| 7. Character & UI panels, HUD, cursor, overlays, text | `Source/control/*`, `Source/panels/*`, `Source/qol/xpbar.cpp`, `floatingnumbers.cpp`, `monhealthbar.cpp`, `itemlabels.cpp`, `chatlog.cpp`, `Source/cursor.*`, `Source/help.cpp`, `Source/minitext.cpp`, `Source/plrmsg.cpp` | ~7,000 | player, items, inventory, spells, quests, monsters, renderer/text | input layer (click routing), everything that displays state |

---

## 1. Player character, classes & progression

### Purpose
Defines the hero entity: base/current attributes, derived life/mana, level & experience, learned spells, equipment
and inventory containers, animation-frame counts, and all per-class tuning loaded from TSV files. Also the XP curve,
level-up gains, stat-point allocation, class caps and validation.

### Key data structures (genericized)

**ClassAttributes** (one per class, loaded from `attributes.tsv`):
```
classFlags           bitset {CriticalStrike, DualWield, IronSkin, NaturalResistance, TrapSense}
baseStr/Mag/Dex/Vit  u8   starting stats
maxStr/Mag/Dex/Vit   u8   hard caps for BASE stats (item bonuses may exceed)
adjLife, adjMana     fixed10.6  flat life/mana offset
lvlLife, lvlMana     fixed10.6  life/mana per character level
chrLife, chrMana     fixed10.6  life per base Vit / mana per base Mag
itmLife, itmMana     fixed10.6  life per Vit from items / mana per Mag from items
manaCost             fixed10.6  spell mana-cost multiplier
itmRestoreLife/Mana  fixed10.6  potion restore multipliers
splRestoreLife/Mana  fixed10.6  healing-spell / mana-spell multipliers
healOtherRestoreLife fixed10.6  heal-other multiplier
```
**PlayerCombatData**: `baseToBlock %, baseMeleeToHit %, baseRangedToHit %, baseMagicToHit %`.

**PlayerStartingLoadoutData**: `skill (class skill spell id), spell, spellLevel, items[5], gold (≤5000)`.

**PlayerAnimData**: frame counts & action frame per weapon class (`unarmed, unarmedShield, sword, swordShield, bow,
axe, mace, maceShield, staff` each `Frames` + `ActionFrame`), plus `idleFrames, walkingFrames, blockingFrames,
deathFrames, castingFrames, recoveryFrames, townIdleFrames, townWalkingFrames, castingActionFrame`.

**Player** (runtime; fields relevant to this cluster):
```
name[32]; class; level u8 (1..maxLevel); experience u32; statPoints
baseStr/Mag/Dex/Vit (int) ; current Str/Mag/Dex/Vit (after items/buffs, clamped 0..750)
hpBase, maxHpBase, hitPoints, maxHp  (26.6 fixed)   ; manaBase, maxManaBase, mana, maxMana
hpPercent, manaPercent (0..81 for flask rendering)
damageMod (class/stat melee bonus)
item-derived aggregates: iMinDam, iMaxDam, iAC, iBonusDam %, iBonusToHit, iBonusAC, iBonusDamMod, iGetHit,
  iEnAc (armor pierce), iFMinDam/iFMaxDam (fire), iLMinDam/iLMaxDam (lightning), iFlags (special-effect bits),
  damAcFlags (expansion-only effect bits), iSplLvlAdd, lightRadius, resist fire/lightning/magic (0..75)
InvBody[7] (equipment), InvList[40], InvGrid[40] (int8 index map), SpdList[8] (belt), HoldItem (cursor)
splLvl[64] (per-spell level 0..15), memSpells/ablSpells/scrlSpells/iSpells (u64 bitmasks: learned/skill/scroll/staff)
readiedSpell + readiedType; hotkeys[12] (spell id + type)
mode (state machine), destAction + destParam1..4, walkpath[25], position {tile, future, old, temp}, dir
AnimInfo; animation data per graphic; frame counts _pNFrames/_pWFrames/_pAFrames/_pAFNum/_pSFrames/_pSFNum/_pHFrames/_pDFrames/_pBFrames
gfxnum (low 4 bits weapon graphic, high bits armor tier) ; blockFlag; invincible; lvlChanging; manaShield; reflections
spellFlags {Etherealize, RageActive, RageCooldown} ; oilType (pending oil application)
visited-level flags, townWarps bitmask, dungeon message flags, difficulty-kill progress
```

### Algorithms & rules

**1.1 Character creation (`CreatePlayer`)**
1. Zero the struct, level = 1, class = chosen.
2. `baseX = current X = classAttributes.baseX` for Str/Mag/Dex/Vit.
3. `life = adjLife + lvlLife*level + chrLife*baseVit`; set `hitPoints = maxHp = hpBase = maxHpBase = life`.
4. `mana = adjMana + lvlMana*level + chrMana*baseMag`; same four mana fields.
5. experience 0, armor 0, light radius 10, all spell levels 0, hotkeys cleared, weapon graphic = unarmed.
6. Starting loadout: if `spell != none && spellLevel>0` → `memSpells = bit(spell)`, readied spell = that spell,
   `splLvl[spell] = spellLevel`. If class skill defined → `ablSpells = bit(skill)`; if no readied spell, ready the skill.
7. For each of up to 5 loadout items: instantiate base item, new seed, update requirement cache, then
   `AutoEquip || AutoPlaceInBelt || AutoPlaceInInventory`.
8. Gold: one stack placed at grid cell 30 (bottom-left row), `gold = value`.
9. Run full stat aggregation (`CalcPlrItemVals`).

**1.2 Derived base life/mana (recomputed on level/stat change)**
```
calculateBaseLife = adjLife + lvlLife*level + chrLife*baseVit
calculateBaseMana = adjMana + lvlMana*level + chrMana*baseMag
```
Then item contributions are layered in system 4 (`CalcPlrLifeMana`):
```
maxHp   = clamp(maxHpBase + itmLife*itemVit + Σitem.PLHP, 1, 2000)
hp      = min(hpBase   + same bonus, maxHp)
maxMana = clamp(maxManaBase + itmMana*itemMag + Σitem.PLMana, 0, 2000)
mana    = min(manaBase + same bonus, maxMana)
```
`hpBase/manaBase` track "current minus item bonus" so unequipping never kills/overfills.

**1.3 Experience & level-up (`_addExperience`)**
1. Ignore if not local player, dead, or at max level.
2. Level-difference scaling: `exp' = clamp(exp * (1 + (monsterLevel - playerLevel)/10.0), 0, u32max)`
   (monsterLevel includes difficulty & unique bonuses, see 1.6).
3. Multiplayer anti-powerlevel cap: `exp' = min(exp', nextThreshold/20, 200*playerLevel)`.
4. `experience += min(exp', maxThreshold - experience)` (never overflow past level-cap XP).
5. `while (!maxLevel && experience >= threshold(level)) NextPlrLevel()`.
6. Broadcast new level.

**1.4 Level up (`NextPlrLevel`)**
```
level += 1
statPoints += 5   (but if Σ(maxStat - baseStat) over 4 attributes < 5, statPoints = that remainder)
maxHp += lvlLife; maxHpBase += lvlLife; hitPoints = maxHp; hpBase = maxHpBase        (full heal)
maxMana += lvlMana; maxManaBase += lvlMana; if !NoMana flag: mana = maxMana, manaBase = maxManaBase
recalc items; play level-up sound; (gamepad: focus the + buttons)
```
**1.5 Stat allocation (`ModifyPlrStr/Mag/Dex/Vit`)**: `delta = clamp(delta, -base, max - base)`; `base += delta;
current += delta`. Vit also adds `chrLife*delta` to hpBase/maxHpBase/hp/maxHp; Mag adds `chrMana*delta` to the four
mana fields (current mana only if no NoMana flag). UI "+" button: one point per click; shift-click assigns
`min(remainingPoints, max-base)` at once. Elixirs call the same functions with +1 (special elixir +3 to all four).

**1.6 Monster XP award (`AddPlrMonstExper`, callers in monster death)**
```
monsterExp = data.exp ; nightmare: 2*(exp+1000) ; hell: 4*(exp+1000) ; unique monster: ×2
monsterLevel = data.level (unique: uniqueLevel*2, or +5 if unspecified); nightmare +15, hell +30
share: players flagged in monster.whoHit bitmask; each receives exp / count, scaled per 1.3
```
**1.7 Validation each tick (`ValidatePlayer`)**: clamp level to [1,max]; if `experience > threshold(level)` reset to
threshold; recount gold from inventory (each stack ≤ 5000, ×2 in expansion mode); clamp base stats to class caps;
mask `memSpells` to spells that have a book level; clamp each spell level to 15; clear infravision flag.

**1.8 Potions (`RestorePartialLife/Mana`)**:
`l = floor(max/8) + rand(0, max/4 - 1)` whole points, then `l *= itmRestoreLife` (or Mana). Mana restore is skipped
if the NoMana flag is set. Full potions set current = max.

**1.9 Death & drops (`StartPlayerKill`)**: play death anim unarmed; set invincible; HP=0. Drops (not on the final
boss level or arena levels in MP): held cursor item; **half of carried gold** (skipping full stacks first); if
killed by monster/trap in SP-like rules → every equipped item scattered to adjacent tiles rotating left from facing;
if killed by a player → a trophy "ear" item encoding the victim's name and level. Respawn in town with HP=1, mana=0.

### Reference tuning values

**Class base stats, caps and formulas** (from `attributes.tsv`):

| Class | Str/Mag/Dex/Vit start | Str/Mag/Dex/Vit cap | block bonus | adjLife | adjMana | lvlLife | lvlMana | chrLife | chrMana | itmLife | itmMana | manaCost | itmRestoreLife/Mana | splRestoreLife/Mana | healOther | melee/ranged/magic to-hit base |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| melee | 30/10/20/25 | 250/50/60/100 | 30 | 18 | -1 | 2 | 1 | 2 | 1 | 2 | 1 | 1.0 | 2 / 1 | 2 / 1 | 2 | 70/60/50 |
| ranged | 20/15/30/20 | 55/70/250/80 | 20 | 23 | 5.5 | 2 | 2 | 1 | 1 | 1.5 | 1.5 | 0.75 | 1.5 / 1.5 | 1.5 / 1.5 | 1.5 | 50/70/50 |
| caster | 15/35/15/20 | 45/250/85/80 | 10 | 9 | -2 | 1 | 2 | 1 | 2 | 1 | 2 | 1.0 | 1 / 2 | 1 / 2 | 1 | 50/50/70 |
| martial-arts | 25/15/25/20 | 150/80/150/80 | 25 | 23 | 5.5 | 2 | 2 | 1 | 1 | 1.5 | 1.5 | 0.75 | 1.5 / 1.5 | 2 / 2 | 3 | 50/50/50 |
| dual-wield | 20/20/25/20 | 120/120/120/100 | 25 | 23 | 3 | 2 | 2 | 1 | 1.5 | 1.5 | 1.75 | 0.75 | 1.5 / 1.5 | 1.5 / 1.5 | 1.5 | 50/60/60 |
| berserker | 40/0/20/25 | 255/0/55/150 | 30 | 18 | 0 | 2 | 0 | 2 | 1 | 2.5 | 1 | 1.0 | 2 / 1 | 2 / 1 | 2 | 50/50/50 |

Resulting level-1 life/mana: melee 70/10, ranged 45/22.5, caster 30/70, martial 45/22.5, dual 45/35, berserker 70/0.

**Starting loadouts**: melee = one-hand sword + buckler + club + 2 healing potions; ranged = short bow + 2 healing;
caster = staff with 40 charges of a mana-restore spell + 2 mana potions + fire-bolt spell at level 2; martial = short
staff + 2 healing; dual = sword + dagger + 2 healing; berserker = 2h-capable weapon + buckler + 2 healing. All get
100 gold. Class skills: melee = item repair, ranged = trap disarm, caster = staff recharge, martial = search,
dual = identify, berserker = rage.

**Animation frame counts (frames / action frame)** — all at 1 tick/frame except idle (4 ticks/frame), block (3),
death (2):

| Class | unarmed | unarmed+shield | sword | sword+shield | bow | axe | mace | mace+shield | staff | idle | walk | block | death | cast / action | hit-recover |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| melee | 16/9 | 16/9 | 16/9 | 16/9 | 16/11 | 20/10 | 16/9 | 16/9 | 16/11 | 10 | 8 | 2 | 20 | 20/14 | 6 |
| ranged | 18/10 | 18/10 | 18/10 | 18/10 | 12/7 | 22/13 | 18/10 | 18/10 | 16/11 | 8 | 8 | 4 | 20 | 16/12 | 7 |
| caster | 20/12 | 16/9 | 16/12 | 16/12 | 20/16 | 24/16 | 16/12 | 16/12 | 16/12 | 8 | 8 | 6 | 20 | 12/8 | 8 |
| martial | 12/7 | 12/7 | 16/12 | 16/12 | 20/14 | 23/14 | 16/12 | 16/12 | 13/8 | 8 | 8 | 3 | 20 | 18/13 | 6 |
| dual | 18/10 | 18/10 | 18/10 | 18/10 | 12/11 | 22/13 | 18/10 | 18/10 | 16/11 | 8 | 8 | 4 | 20 | 16/12 | 7 |
| berserker | 16/9 | 16/9 | 16/9 | 16/9 | 16/11 | 20/8 | 16/8 | 16/8 | 16/11 | 10 | 8 | 2 | 20 | 20/14 | 6 |

Town idle = 20 frames, town walk = 8 for all. Special cases: melee/berserker with a bow in the dungeon use an
8-frame idle; melee/berserker in medium/heavy armor use a 15-frame death.

**Experience curve** (`Experience.tsv`, threshold to *leave* level L; max level 50):

| L | XP | L | XP | L | XP | L | XP | L | XP |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2,000 | 11 | 108,879 | 21 | 1,814,568 | 31 | 25,774,405 | 41 | 261,657,253 |
| 2 | 4,620 | 12 | 141,086 | 22 | 2,401,895 | 32 | 32,994,399 | 42 | 323,800,420 |
| 3 | 8,040 | 13 | 181,683 | 23 | 3,168,651 | 33 | 42,095,202 | 43 | 399,335,440 |
| 4 | 12,489 | 14 | 231,075 | 24 | 4,166,200 | 34 | 53,525,811 | 44 | 490,808,349 |
| 5 | 18,258 | 15 | 313,656 | 25 | 5,459,523 | 35 | 67,831,218 | 45 | 601,170,414 |
| 6 | 25,712 | 16 | 424,067 | 26 | 7,130,496 | 36 | 85,670,061 | 46 | 733,825,617 |
| 7 | 35,309 | 17 | 571,190 | 27 | 9,281,874 | 37 | 107,834,823 | 47 | 892,680,222 |
| 8 | 47,622 | 18 | 766,569 | 28 | 12,042,092 | 38 | 135,274,799 | 48 | 1,082,908,612 |
| 9 | 63,364 | 19 | 1,025,154 | 29 | 15,571,031 | 39 | 169,122,009 | 49 | 1,310,707,109 |
| 10 | 83,419 | 20 | 1,366,227 | 30 | 20,066,900 | 40 | 210,720,231 | 50 | 1,583,495,809 |

The curve is not closed-form; the ratio between successive thresholds decays from ~2.3 (L1→2) to ~1.2 (L49→50).
A good generator approximation if you don't want a table: `XP(L) ≈ 2000 * 1.31^(L-1) * (1 + L/12)` within ~15%
over L=1..50, but ship the table.

**Other constants**: max level 50; stat points per level 5; max spell level 15; max resistance 75; life/mana clamp
2000; current-stat clamp 750; light radius 2..15 (default 10); multiplayer XP cap `min(threshold/20, 200*level)`;
gold stack 5000 (10000 with the gold-capacity amulet in expansion mode).

### Smallest buildable chunks

1. **Class data loader** — inputs: TSV files per class (attributes, loadout, animations, sprites, sounds) + class list; outputs: `ClassAttributes[]`, `CombatData[]`, `Loadout[]`, `AnimData[]`. Done when: all six classes load, missing key = fatal error with file/field name.
2. **Experience table loader** — input `Experience.tsv`; output `threshold(level)` with `getMaxLevel()`; levels beyond the file return the last value. Done when: `threshold(0)=0`, `threshold(50)=1,583,495,809`, max level 50.
3. **Player struct & fixed-point life/mana** — implement 26.6 fixed type with `whole()`, `fromInt`, `raw()`; Player fields above. Done when: unit tests for `calculateBaseLife/Mana` reproduce the level-1 table.
4. **CreatePlayer** — steps 1.1 without items (items come after cluster 3/5). Done when: each class spawns with the table's stats, spells, hotkeys cleared.
5. **Attribute modification API** — `ModifyStr/Mag/Dex/Vit`, `SetStr/...`, `CheckStats` clamp, `CalcStatDiff`. Done when: over-allocation is clamped and Vit/Mag changes shift base life/mana per class multipliers.
6. **Level-up & XP** — `addExperience(exp, monsterLevel)` with level-delta scaling, MP cap, multi-level loop; `NextPlrLevel`. Done when: feeding 1,583,495,809 XP at level 1 yields level 50 with 245 unspent points (minus cap remainder), full heal each level.
7. **Monster XP sharing** — `AddPlrMonstExper(level, exp, whoHitMask)`. Done when: 3 contributors each get exp/3 scaled by their own level delta.
8. **Per-tick validation** — `ValidatePlayer` clamps (XP, gold, stats, spell mask/levels). Done when: a hacked value is corrected within one tick.
9. **Potion restore functions** — `RestorePartialLife/Mana`, full variants, NoMana rule. Done when: 100 max HP yields 12..24 base points × class multiplier.
10. **Death & drop rules** — `StartPlayerKill`, `DropHalfPlayersGold`, `DeadItem` scatter, trophy item, respawn-in-town with HP=1. Done when: all equipment lands on 7 distinct adjacent tiles when available.
11. **Class-specific derived getters** — `GetArmor`, `GetMeleeToHit`, `GetRangedToHit`, `GetMagicToHit`, `GetBlockChance`, `GetSpellLevel`, `CalculateArmorPierce`, `GetManaShieldDamageReduction`. Done when: values match section 2 formulas in tests.
12. **Starting loadout placement** — uses auto-equip/belt/inventory from system 5. Done when: melee class has sword+shield equipped, club in inventory, 2 potions in belt, 100 gold at grid cell 30.
13. **Player serialization** — pack/unpack of the fields listed (see system 5 `PlayerPack`). Done when: round-trip is lossless for all 6 classes.
14. **HP/mana percentage for flasks** — `hpPercent = clamp(hp*81/maxHp, 0, 81)`. Done when: full = 81, empty = 0.

### Pitfalls / design lessons
- Keep **base** and **current** copies of every stat and of life/mana; item effects are re-derived from scratch each time anything changes rather than applied/removed incrementally (prevents drift and exploits).
- Fixed point life/mana lets per-tick drains (e.g. life-drain curse removes 4/64 point per tick) exist without floats.
- Clamp the *base* stats to class caps but let *current* exceed them (clamp 750); UI shows gold text when base hits cap.
- The XP curve table is far better than a formula for designer control; the engine simply makes `threshold(level)` a lookup and derives max level from table length.
- Level-delta XP scaling (+10%/level above, -10%/level below, floor 0) plus an MP per-kill cap is enough to stop power-leveling without a separate "rest XP" system.
- Reset XP to the threshold if it ever exceeds it (handles memory edits and save tampering gracefully).
- Death penalty variants (gold half / all equipment / trophy) are chosen by *death reason*; keep the reason as an enum passed through the kill path.

---

## 2. Player state machine & combat resolution

### Purpose
Drives the hero each tick: an 8-direction tile-stepping walker, melee/ranged/spell actions keyed to animation
"action frames", block, hit-recovery (stagger), death, and level-transition states. Contains the to-hit, block,
critical, damage, life/mana-steal, knockback and durability rules for player attacks and for damage taken.

### Key data structures
```
enum PlayerMode { STAND, WALK_NORTHWARDS, WALK_SOUTHWARDS, WALK_SIDEWAYS, ATTACK, RATTACK, BLOCK, GOTHIT, DEATH,
                  SPELL, NEWLVL, QUIT }
enum Action { WALK=-2, NONE=-1, ATTACK=9, RATTACK=10, SPELL=12, OPERATE=13, DISARM=14, PICKUPITEM=15,
              PICKUPAITEM=16, TALK=17, OPERATETK=18, ATTACKMON=20, ATTACKPLR=21, RATTACKMON=22, RATTACKPLR=23,
              SPELLMON=24, SPELLPLR=25, SPELLWALL=26 }
walkpath[25] of step codes {NE=1,NW=2,SE=3,SW=4,N=5,E=6,S=7,W=8, NONE=-1}
ActorPosition { tile, future (tile after current step), old, temp (walk destination / attack target) }
AnimationInfo { sprites, ticksPerFrame, tickCounterOfCurrentFrame, numberOfFrames, currentFrame,
                distribution fields for frame-skipping; isLastFrame() = currentFrame >= numberOfFrames-1 }
AnimationDistributionFlags { ProcessAnimationPending, SkipsDelayOfLastFrame, RepeatedAction }
SpellCastInfo { spellId, spellType {Skill, Spell, Scroll, Charges}, spellFrom (inventory slot for scrolls), spellLevel }
```
`dPlayer[x][y]` tile map holds `playerId+1` (positive = standing, negative = moving into).

### Algorithms & rules

**2.1 Per-tick loop (`ProcessPlayers`)** for every active player on the current level:
1. Life-drain curse: `ApplyPlrDamage(4/64)` per tick outside town. Mana-shield auto-removed if a NoMana item is worn.
2. `do { switch(mode) { WALK*: DoWalk; ATTACK: DoAttack; RATTACK: DoRangeAttack; BLOCK: DoBlock; SPELL: DoSpell;
   GOTHIT: DoGotHit; DEATH: DoDeath; STAND/NEWLVL/QUIT: nothing } ; CheckNewPath(player, finished) } while(finished)`
   — a finished action immediately dispatches the next queued action in the same tick.
3. `AnimInfo.processAnimation()` (skipped while a corpse is frozen on the last death frame).

**2.2 Walking**
- Path: A* (`FindPath`) up to 25 steps from `position.future`; `MakePlrPath(target, endspace)` drops the last step when the goal is an occupied actor.
- `StartWalk(dir)`: validate `PlrDirOK` (target tile walkable and not another live player/monster; E and W diagonal moves additionally require the SE / SW corner tile not solid — no corner cutting around walls). Set `future = tile + dir`, mark `dPlayer[future] = -(id+1)`, pick `walkMode` from direction (S/SW/SE → SOUTHWARDS, N/NW/NE → NORTHWARDS, E/W → SIDEWAYS; these only choose which sprite layer order to render).
- Animation: 8 frames at 1 tick/frame, started at frame **-2** (`+2` in town when "run in town" is on, `+1` when chained from an action in the same tick) with `ProcessAnimationPending`. Net result: **one tile per ~8 ticks (0.4 s) when chaining steps, 9 from standing**; running in town removes 2 ticks. Sub-tile render offset = `walkProgress × tile vector`.
- `DoWalk`: footstep SFX on frames 0 and 4; on last frame: clear old `dPlayer`, `tile = temp`, re-occupy, move light & vision, `StartStand(tempDirection)`, auto-pickup scan (system 5).
- Queued actions: `CheckNewPath` pops `walkpath[0]`, shifts the array, and when adjacent to a melee target (Chebyshev distance < 2) cancels the remaining path and attacks.

**2.3 Melee attack (`StartAttack` / `DoAttack`)**
- Frame skipping from item flags (vanilla "swing speed"): `Quick +1, Fast +2, Faster +3, Fastest +4` frames skipped when the start frame is included (+0/+1/+2/+2 when chained); skipped frames are distributed **before** the action frame so the weapon still points at the target on the hit frame. `RepeatedAction` lets a second swing begin right after the hit frame.
- Swing SFX at `actionFrame-2`; hit resolution at `actionFrame-1` against the tile `tile + dir`: monster → `PlrHitMonst`, hostile player → `PlrHitPlr`, breakable object → break.
- Weapon elemental procs (base mode or not both elements): if the item has fire/lightning damage, spawn a weapon-explosion missile at the target tile with `rand(FMin..FMax)` / `rand(LMin..LMax)` damage (0 if the hit missed — the explosion still plays).
- **Cleave**: martial class with staff, dual class with two swords, berserker with axe or (no shield and a two-handed-capable sword/mace held) → also roll `PlrHitMonst(adjacent=true)` on the tiles `tile + Right(dir)` and `tile + Left(dir)` (only if the monster is not mid-step).
- On any hit, weapon durability check `DamageWeapon(30)` (1-in-30 chance to lose 1 point; see 4.6).
- Action completes on last frame → `StartStand`.

**2.4 Player → monster hit roll (`PlrHitMonst`)**
```
if adjacentDamage (cleave): hper -= (level > 20) ? 30 : (35 - level)*2
hit = rand(0..99); petrified target: hit = 0 (auto-hit)
hper += GetMeleePiercingToHit() - CalculateArmorPierce(monsterAC, melee)
   GetMeleeToHit     = level + Dex/2 + itemToHit + classMeleeBase
   base mode piercing: + itemEnAc ; expansion mode: monsterAC >>= (EnAc-1) (or -25% when EnAc==1), berserker melee -1/8 AC more
hper = clamp(hper, 5, 95)        → miss if hit >= hper
dam  = rand(iMinDam..iMaxDam); dam += dam*iBonusDam/100; dam += iBonusDamMod; [dam2 = dam<<6 for peril] dam += damageMod
CriticalStrike classes: if rand(100) < level → dam *= 2
monster class vs weapon: undead: sword -50%, mace +50% ; animal: mace -50%, sword +50% ; demon: triple-demon flag ×3
expansion: Devastation 5% ×3 ; Doppelganger 10% spawn clone ; Jesters: r=rand(0..200); r>=100 → 100+(r-100)*5 ; dam*=r/100 (0..600%)
dam <<= 6 ; cleave hits: dam >>= 2 (quarter damage)
Peril: self-damage (dam2 + iGetHit) and dam *= 2
Random life steal: +rand(dam/8); 3%/5% steal mana or life flags: +3%/5% of dam (both capped at max, mana requires !NoMana)
if monster dead → kill ; else knockback flag → push 1 tile ; start monster hit-recovery with dam
```
**2.5 Player → player (`PlrHitPlr`)**: `hper = clamp(attackerMeleeToHit - targetArmor, 5, 95)`; block roll only if target is STAND or ATTACK and has blockFlag: `blkper = clamp(targetBlockChance - 2*attackerLevel, 0, 100)`; damage as above without weapon-class modifiers; target enters `StartPlrHit`.

**2.6 Ranged attack (`DoRangeAttack`)**: fires 1 arrow at `actionFrame-1`; with multiple-arrows flag a second volley of 2 at `actionFrame+1`, offset ±1 tile perpendicular. Base arrow damage parameter 4 (actual arrow damage computed in the missile from player ranged stats); fire/lightning arrow flags switch missile type; both → spectral arrow with `rand(FMin..FMax)`. Durability check `DamageWeapon(40)` per arrow. Base-mode speed flags: quick/fast +1 skipped frame, fast +1 more. `GetRangedToHit = level + Dex + itemToHit + classRangedBase`.

**2.7 Spell cast (`StartSpell`/`DoSpell`)**: re-validate (mana/level/scroll/charges) at start; animation chosen by spell element (fire/lightning/other graphic); `castingActionFrame` → `CastSpell(spell, src, target, levelAtQueueTime)`; cost consumed only if no missile fizzled (system 6).

**2.8 Block (`StartPlrBlock`/`DoBlock`)**: block anim (2–6 frames at 3 ticks/frame, `SkipsDelayOfLastFrame`); FastBlock flag skips to the second-to-last frame. On finish: 1-in-10 chance shields/staves in hands lose 1 durability.

**2.9 Hit recovery (`StartPlrHit`)**: triggered by any damage ≥ threshold unless forced:
`threshold = level` (berserker: `level + level/4`). Frame skip from items: Fast 1, Faster 2, Fastest 3 of the class's 6–8 recovery frames. On finish 1-in-4 chance (actually `!FlipCoin(4)` → 3-in-4) armor or helm loses 1 durability (helm vs chest chosen 1-in-3 when both present).

**2.10 Damage intake (`ApplyPlrDamage(type, dam, minHP, reason)`)**
```
if manaShield active && !NoMana:
    level L = splLvl[manaShield]; reduction R = 24 - 3*min(L,7)   (R: 24 at L0 … 3 at L7+)
    if L>0: dam += dam / -R        (i.e. dam *= (1 - 1/R))
    if mana >= dam: mana -= dam; dam = 0
    else: dam -= mana; if L>0: dam += dam/(R-1) (undo reduction for the overflow); mana = 0; shield drops
hp -= dam; hpBase -= dam; clamp to max; if hp < minHP → set minHP (used by self-damage effects so they can't kill)
if hp <= 0 → kill with reason
```
**2.11 Monster → player hit (for completeness, from monster code)**
```
hit = monsterToHit + 2*(monsterLevel - playerLevel) + 30 - playerArmor(+40 vs demons/+20 vs undead flags)
hit = max(hit, minHit)                                         (minHit: 15/20/25 by difficulty region)
miss if rand(100) >= hit
block if (player STAND or ATTACK) && blockFlag && rand(100) < clamp(GetBlockChance - 2*monsterLevel, 0, 100)
    GetBlockChance = Dex + classBlockBonus + 2*level  (trap blocking omits the level term)
dam = rand(min..max) + player.iGetHit (negative = damage reduction), floor 1; reflect charges, thorns 1–3 back
```
**2.12 Trap disarm skill**: `chance = 2*Dex - 5*dungeonLevel`; `rand(100) <= chance` succeeds.

**2.13 Armor value** `GetArmor = iBonusAC + iAC + Dex/5` (character sheet shows `+2*level` extra for display only).

### Reference tuning values

| Constant | Value |
|---|---|
| Tick length | 50 ms (20 Hz) |
| Walk | 8 frames @1 tick, start frame -2 (+2 run-in-town, +1 chained) |
| Idle | 8–10 frames @4 ticks; death 20 @2 ticks; block 2–6 @3 ticks |
| Attack frame skips | quick 1 / fast 2 / faster 3 / fastest 4 (melee); ranged base mode 1/2 |
| Hit-recovery skips | fast 1 / faster 2 / fastest 3 |
| To-hit clamp | 5%..95% |
| Melee to-hit | `level + Dex/2 + itemToHit + classBase` (classBase 50–70) |
| Ranged to-hit | `level + Dex + itemToHit + classBase` (50–70) |
| Magic to-hit | `Mag + classBase` (50–70) |
| Block | `Dex + classBlock(10–30) + 2*level - 2*attackerLevel`, clamp 0..100 |
| Critical | CriticalStrike classes: `level%` chance ×2 |
| Cleave penalty | `-(35-level)*2` to-hit (−30 past level 20), damage ÷4 |
| Weapon vs class | sword −50% undead / +50% animal; mace +50% undead / −50% animal |
| Stagger threshold | damage ≥ level (berserker level×1.25) |
| Weapon durability loss chance | 1/30 per melee hit, 1/40 per arrow; shield/staff 1/10 per block; armor 3/4 per stagger |
| Mana shield reduction | `24 - 3*min(L,7)` → L1: 21 (−4.8%), L7+: 3 (−33%) |
| Armor pierce (expansion) | `AC >>= (EnAc-1)`; EnAc=1 → −25% |
| Life drain curse | 4/64 HP per tick |
| Trap disarm | `2*Dex - 5*dlvl` % |

### Smallest buildable chunks

1. **AnimationInfo with frame distribution** — ticksPerFrame, skipped frames (negative allowed), distribute-before-frame, repeated-action carry-over, `isLastFrame`, render-time progress fraction. Done when: a 16-frame attack with 2 skipped frames before action frame 9 completes in 14 ticks and the sprite on the hit tick is frame 8.
2. **Mode enum + per-tick dispatcher** — `ProcessPlayers` loop with "finished → immediately check next action" semantics. Done when: queued attack starts on the same tick the walk ends.
3. **Tile occupancy map** `dPlayer` with positive/negative convention; `PosOkPlayer`; `PlayerAtPosition`. Done when: two players can't occupy one tile; a moving player reserves its destination.
4. **Direction validation & StartWalk** incl. no-corner-cutting for E/W. Done when: walking E next to a wall at SE is refused.
5. **DoWalk tick** with sub-tile offset and arrival handling. Done when: tile changes exactly at frame 7 and light/vision move.
6. **Path queue** (`walkpath`, shift, `GetTargetPosition`, `MakePlrPath endspace`). Done when: path to an occupied tile stops adjacent.
7. **Action queue (`destAction` + params) & `CheckNewPath` switch** for all 17 actions (attack xy/mon/plr, ranged, spell xy/mon/plr/wall, operate/disarm/telekinesis, pickup, talk). Done when: each action triggers from STAND, and attack/ranged/spell can re-trigger after the action frame.
8. **StartAttack with speed-flag frame skipping** and `RepeatedAction`. Done when: fastest-attack swing cycle is 4 frames shorter.
9. **PlrHitMonst** — full roll (2.4) incl. petrified auto-hit, cleave penalty, crit, weapon-class modifiers, steal effects, knockback. Done when: unit test with seeded RNG reproduces the clamp and modifiers.
10. **PlrHitPlr** — PvP roll with target block. Done when: friendly mode blocks PvP.
11. **DoAttack** — swing/hit frame timing, elemental proc missiles, cleave side tiles, object breaking, durability hook. Done when: a hit at frame `AFNum-1` and SFX at `AFNum-2`.
12. **Ranged attack** — arrow spawn(s), multi-arrow offsets, elemental arrow types, per-arrow durability. Done when: multi-arrow fires 1 then 2 arrows at the right frames.
13. **Block state** — trigger from monster/player hit, FastBlock skip, parry durability. Done when: block anim lasts `frames*3` ticks minus the last delay.
14. **Hit recovery** — threshold rule, frame skips, armor durability roll. Done when: damage below level does not interrupt.
15. **ApplyPlrDamage with mana shield math** and `minHP`. Done when: shield level 7 absorbs 33% and remainder is re-expanded when mana runs out.
16. **Death state** — freeze on last frame (ticksPerFrame=100 trick), corpse flag on tile, `MyPlayerIsDead` after 30 ticks, drops (system 1). Done when: respawn/resurrect restores STAND.
17. **Level-change states** NEWLVL/QUIT with `pLvlLoad` countdown (10 ticks of invulnerability on arrival) and position re-sync (`SyncInitPlrPos` search offsets). Done when: arriving on an occupied stair tile finds the nearest free tile.
18. **Input preview sprite** — show the first frame of the predicted next animation between input and the next tick (`UpdatePreviewCelSprite`). Done when: clicking to attack shows the attack pose before the logic tick.
19. **Trap disarm & object operate adjacency** (`IsPlayerAdjacentToObject` special case for 2-tall objects). Done when: large objects are operable from the NE side.

### Pitfalls / design lessons
- Decide hit resolution on a specific animation frame (`actionFrame-1`), not at animation end; this is what makes attack-speed items meaningful and lets players cancel/queue after the hit.
- Skip frames *before* the action frame so the pose on the hit frame is always the "contact" pose.
- The stagger threshold (damage ≥ level) makes low-level characters stun-lockable and high-level ones immune to chip damage — intentional, but a 25% bonus for the tanky class was needed.
- Mana shield math must handle the overflow case (shield breaks mid-hit) or players die from "free" hits.
- Weapon-vs-monster-class modifiers (±50%) are cheap and create loadout decisions; keep the lookup data-driven.
- Keep `invincible` during level transitions and for the first 10 ticks after arrival; monsters can be adjacent to stairs.
- Durability loss is probabilistic per hit; make the constants separate per slot type so shields don't die faster than swords.

---

## 3. Item data model & loot generation

### Purpose
Defines base item types, magic affixes (prefix/suffix tables), unique items, and the deterministic generation
pipeline that turns `(base index, item level, seed, flags)` into a fully rolled item — for monster drops, floor and
container spawns, quest rewards and vendor stock. Every generated item is reproducible from a 19-byte record.

### Key data structures (genericized)

**ItemData (base type row, `itemdat.tsv`, 169 rows)**:
```
id (optional symbolic), dropRate u8 (0 = never random; bows 2, everything else 1)
class {None, Weapon, Armor, Misc, Gold, Quest}
equipType {None, OneHand, TwoHand, Armor(body), Helm, Ring, Amulet, Unequippable, Belt}
cursorGraphic (sprite id → also defines grid footprint), itemType {Misc, Sword, Axe, Bow, Mace, Shield, LightArmor,
  Helm, MediumArmor, HeavyArmor, Staff, Gold, Ring, Amulet}
uniqueBaseItem (key linking to unique table), name, shortName (used when the full magic name doesn't fit 254 px)
minMonsterLevel u8 (drop gate), durability u8, minDamage, maxDamage, minArmor, maxArmor,
minStrength, minMagic, minDexterity, specialEffects bitset, miscId (consumable kind), spell, usable bool, value u16
```
**PLStruct (affix row, 83 prefixes + 95 suffixes)**:
```
name; power {type (effect enum), param1, param2}; minLevel (affix ilvl gate); itemTypes bitset {Misc, Bow, Staff,
Weapon, Shield, Armor}; alignment {Any, Evil, Good}; chance (weight, 1 or 2); useful (eligible when "only good");
minVal, maxVal (gold value added, interpolated by roll); multVal (value multiplier, negative for curses)
```
**UniqueItem (91 rows)**: `name, cursorGraphic override, uniqueBaseItem, minLevel, value, powers[≤6]`.

**Item (runtime)**:
```
seed u32; createInfo u16 (bits: 0-5 ilvl, 6 onlyGood, 7 uniqueChance15, 8 uniqueChance1, 9 isUnique, 10 smith,
  11 smithPremium, 12 peddler, 13 witch, 14 healer, 15 pregenerated); dwBuff (bit0 expansion item, bits1-4 unique offset)
type, animFlag, position, AnimInfo (drop "flip" animation), selectionRegion, identified, quality {Normal, Magic, Unique}
name[64] (base), identifiedName[64]; equipType; class; cursorId; value (base), identifiedValue
minDam, maxDam (u8), AC (i16), flags (special effects), miscId, spell, baseIndex, charges, maxCharges, durability,
maxDur (255 = indestructible); PL* bonuses: Dam%, ToHit, AC%, Str, Mag, Dex, Vit, FireRes, LightRes, MagicRes,
Mana(10.6), HP(10.6), DamMod(flat), GetHit, Light, SplLvlAdd; uid; fire/lightning min/max; EnAc (pierce);
prefixPower, suffixPower (effect enums for tooltip); VAdd1/VMult1/VAdd2/VMult2 (value components);
minStr/minMag/minDex (requirements, may be modified by powers/oils); statFlag (usable by owner, cached); damAcFlags
```
**Item effect enum (powers)** — families: ToHit(+/−), Dam%(+/−), ToHit&Dam%(+/−), AC%(+/−), SetAC, AC−, Fire/Light/Magic/All
resist (+/− variants), SpellLevelAdd, Charges×, FixedSpell+charges, FireDam, LightDam, Str/Mag/Dex/Vit/AllAttribs(+/−),
GetHit(+/−), Life(+/−), Mana(+/−), Dur%(+/−), Indestructible, Light(+/−), MultArrows, FireArrows, LightArrows, Thorns,
NoMana, Fireball-on-hit, HalfTrapDmg, Knockback, StealMana, StealLife, TargetAC(pierce), FastAttack(1-4),
FastRecover(1-3), FastBlock, DamMod(flat), RandArrowVel, SetDam, SetDur, NoMinStr, OneHand, 3×DmgVsDemon, AllResZero,
DrainLife, RandStealLife, AddACLife, AddManaAC, Devastation, Decay, Peril, Jesters, Crystalline, Doppelganger,
ACvsDemon, ACvsUndead, ManaToLife(50%), LifeToMana(40%).

**Special-effect bitset on player (`iFlags`)**: RandomStealLife, RandomArrowVelocity, FireArrows, FireDamage,
LightningDamage, DrainLife, MultipleArrows, Knockback, StealMana3/5, StealLife3/5, Quick/Fast/Faster/FastestAttack,
Fast/Faster/FastestHitRecovery, FastBlock, LightningArrows, Thorns, NoMana, HalfTrapDamage, TripleDemonDamage,
ZeroResistance. Expansion-only (`damAcFlags`): Devastation, Decay, Peril, Jesters, Doppelganger, ACAgainstDemons,
ACAgainstUndead.

### Algorithms & rules

**3.1 Where drops come from**
| Source | Call | Base selection | ilvl passed | uniqueChance | onlyGood |
|---|---|---|---|---|---|
| Normal monster | `SpawnItem` | `RndItemForMonsterLevel(mlvl)`: 59% nothing; of the rest 74% gold; else dropRate-weighted among items with `minMonsterLevel ≤ mlvl` | monster data level | 1 | false |
| Unique monster / special-treasure monster | `SpawnItem` | `RndUItem`: uniform among non-gold, non-misc (books allowed) items with `minMonsterLevel ≤ mlvl` | monster data level | 15 | true |
| Monster with fixed unique treasure | `SpawnUnique(uid)` | the unique's base type | current dungeon level | — | forced unique (on normal difficulty); on higher difficulty rerolled as a random drop with uper 15 |
| Floor / chest / barrel (`CreateRndItem`) | `SetupBaseItem` | onlyGood ? `RndUItem(null)` (cap `2*dlvl`) : `RndAllItems` (75% gold, else uniform among `minMonsterLevel ≤ 2*dlvl`) | `2 * dungeonLevel` | 1 | caller |
| "Useful" drop (`CreateRndUseful`) | `SetupAllUseful` | base: 50/50 heal/mana potion; `dlvl>1` → 1/3 chance town-portal scroll. Expansion: 7-way {portal(or heal on dlvl≤1), heal, heal, portal(or mana), mana, mana, oil} | dlvl | — | — |
| Typed spawn (`CreateTypeItem(type, misc)`) | `RndTypeItems` | uniform among matching type/misc with `minMonsterLevel ≤ 2*dlvl` | `2*dlvl` | 1 | caller |
| Quest reward / spell book / magic weapon helpers | `CreateMagicItem`, `CreateSpellBook` | fixed type; book ilvl = `(bookLevel+1)*2` | varies | — | true |

`dungeonLevel` for items (`ItemsGetCurrlevel`) is the current level; in expansion mode levels 17–20 count as `level-4`… and 21–24 as `level-7`, special set-levels map to fixed values.

**3.2 Core pipeline `SetupAllItems(item, idx, seed, lvl, uper, onlyGood, pregen, uidOffset=0, forceNotUnique=false)`**
1. `item.seed = seed; SetRndSeed(seed)` — everything after is deterministic.
2. `GetItemAttrs(item, idx, lvl/2)`: copy base row; `AC = rand(minArmor..maxArmor)`; durability = max; requirements;
   for books roll the spell (3.6), for expansion oils roll the oil type (3.7); for gold roll the amount (3.8).
3. `createInfo = lvl | (pregen?PREGEN) | (onlyGood?ONLYGOOD) | (uper==15?UPER15 : uper==1?UPER1)`.
4. If base is not a fixed-unique base:
   - `iblvl = GetItemBLevel(lvl, miscId, onlyGood, uper==15)`:
     ```
     iblvl = -1 (plain)
     if rand(100) <= 10 || rand(100) <= lvl || onlyGood || misc in {Staff, Ring, Amulet}: iblvl = lvl
     if uniqueChance15: iblvl = lvl + 4
     ```
     i.e. a normal monster drop at mlvl L is magic with probability `1 - 0.89*(1 - (L+1)/100)` ≈ 12% at L1, ~30% at L20, 100% for jewelry/staves.
   - If `iblvl != -1`: `uid = CheckUnique(item, iblvl, uper, uidOffset)`:
     ```
     if rand(100) > uper → no unique          (unique probability ≈ (uper+1)%: ~2% normal, ~16% unique-monster)
     candidates = uniques with uniqueBaseItem == base && minLevel <= iblvl ; none → no unique
     discard one RNG value; pick candidates[last - uidOffset]   (original always picked the highest-level candidate)
     ```
     - unique → `GetUniqueItem` (apply all powers in order, set identifiedName, cursor, identifiedValue, uid, quality=Unique, flag UNIQUE).
     - else → `GetItemBonus(item, iblvl/2, iblvl, onlyGood, allowSpells=true)` (3.4).
   - If not unique: `ItemRndDur`: `durability = rand(0, maxDur/2 - 1) + maxDur/4 + 1` (≈25–75% of max).
5. Fixed-unique base (quest uniques): if equipable, `seed` doubles as the uid; verify `seed ≤ 109` and base matches, else clear.

**3.3 Unique de-duplication (`TryRandomUniqueItem`, modern layer)**: after generation, if the item is a random
unique, re-pick uniformly among candidate uniques not yet dropped in this single-player game (`UniqueItemFlags[uid]`),
and regenerate deterministically so the same `(idx, createInfo, seed)` still reproduces it; if all candidates were
already found, regenerate as non-unique (keeping uper=1 and `+4` level adjustment). MP never de-duplicates.

**3.4 Magic affix roll `GetItemBonus → GetItemPower(minlvl, maxlvl, slotMask, onlyGood)`**
```
minlvl = min(minlvl, 25)
slotMask by type: sword/axe/mace→Weapon ; bow→Bow ; shield→Shield ; light/medium/heavy armor & helm→Armor ;
                  staff→(allowSpells ? GetStaffSpell : Staff) ; ring/amulet→Misc ; misc/gold→none
allocatePrefix = rand(4)==0  (25%) ; allocateSuffix = rand(3)!=0 (66.7%)
if neither: coin flip → one of them
goe = Any ; if !onlyGood && rand(3)!=0 → onlyGood = true   (cursed/"not useful" affixes only possible 1/3 of the time)
prefix = weightedPick(prefixes where slot∩mask, minLevel∈[minlvl,maxlvl], (!onlyGood || useful), align ok,
                      and NOT (mask==Staff && power==Charges))     ; if found: goe = prefix.alignment
suffix = weightedPick(suffixes … same filters, alignment must not oppose goe)
for each chosen affix: SaveItemAffix:
    r = roll power (SaveItemPower) ; value = PLVal(r, p1, p2, minVal, maxVal)
        PLVal = (p1==p2 || minVal==maxVal) ? minVal : minVal + (maxVal-minVal)*(100*(r-p1)/(p2-p1))/100
    first affix → VAdd1/VMult1 ; second → VAdd2/VMult2 ; quality = Magic ; prefixPower/suffixPower = type
identifiedName = "{Prefix} {Base} of {Suffix}" (short base name if > 254 px) ; CalcItemValue (3.9)
```
Weighted pick = each eligible affix repeated `chance` times (1 or 2) in a flat list, uniform choice.

**3.5 Power application `SaveItemPower` (how each family mutates the item)** — `r = rand(p1..p2)`:
- ToHit ±r; Dam% ±r; ToHit&Dam%: Dam% += rand(p1..p2) and ToHit += `CalculateToHitBonus(p1)` (table: 20→1-5, 36→6-10, 51→11-15, 66→16-20, 81→21-30, 96→31-40, 111→41-50, 126→51-75, 151→76-100; curses −25→−(1-5), −50→−(6-10)).
- AC% ±r (applied to base AC later as `AC*PLAC/100`, min ±1); SetAC: AC = r; AC-curse: AC −= r.
- Resists ±r; AllRes: each += r floored at 0.
- SpellLevelAdd = r; Charges: `charges *= p1; max = charges`; FixedSpell: spell = p1, charges = max = p2.
- FireDam / LightDam: sets flag, min/max = p1/p2, clears the other element.
- Str/Mag/Dex/Vit ±r; AllAttribs ±r to all four; GetHit: positive family *subtracts* r (damage reduction), curse adds.
- Life ±r; Mana ±r; Dur: `bonus = r*maxDur/100` added to max and current; Dur-curse: `maxDur -= r*maxDur/100` (min 1), current = max; Indestructible: 255/255.
- Light ±p1 (each unit = 10% radius); MultArrows/FireArrows(+FireDamage)/LightArrows(+LightningDamage)/Fireball(both arrow flags) with p1/p2 damage; Thorns; NoMana; HalfTrap; Knockback; 3×Demon; AllResZero; StealMana/StealLife choose 3% or 5% flag by p1; TargetAC: expansion → `EnAc = p1`, base → `EnAc += r`; FastAttack p1 1..4 → Quick/Fast/Faster/Fastest; FastRecover 1..3; FastBlock; DamMod += r; SetDam min/max = p1/p2; SetDur both = p1; OneHand: equipType = OneHand; DrainLife; RandStealLife; NoMinStr: minStr = 0; Devastation/Decay(+Dam% r)/Peril/Jesters/Doppelganger/ACvsDemon/ACvsUndead set expansion flags; Crystalline: Dam% += 140 + 2r then durability curse; ManaToLife: moves 50% of owner's base max mana into HP bonus; LifeToMana: moves 40% of base max HP into mana bonus.

**3.6 Staff generation (`GetStaffSpell(lvl)`)**: base mode: 25% chance to roll a plain staff affix instead. Otherwise
`l = max(lvl/2, 1)`; random walk over spells with `staffLevel != -1 && staffLevel <= l` (SP skips resurrect/heal-other),
pick the `rand(spellCount)+1`-th eligible; `charges = max = staffMin + rand(staffMax - staffMin + 1)`; `minMag =
spell.minInt`; `value += charges * staffCost / 5`. Then `GetStaffPower(maxlvl=lvl)`: prefix with 10% chance (100% if
onlyGood) from Staff prefixes of level ≤ lvl (no alignment filter); name "{Prefix} {Staff} of {Spell}". Plain staves
start with 40 charges (18 in expansion) of their fixed spell.

**3.7 Book / oil**: `GetBookSpell(lvl)`: `lvl = max(lvl,1)` (shareware caps 5); random walk over spells with
`bookLevel != -1 && bookLevel <= lvl`; `minMag = spell.minInt`; `value += bookCost`; cover colour by element.
Oils (expansion): SP picks uniformly among oil kinds with `OilLevels[k] <= lvl` (levels 1,10,1,10,4,1,5,17,1,10; values
500,2500,500,2500,1500,100,2500,15000,500,2500); MP only the two cheapest.

**3.8 Gold amount**: `v = 5*dlvl + rand(10*dlvl)` (nightmare: dlvl+16; hell: dlvl+32); hell-themed levels `v += v/8`;
cap 5000. Cursor graphic: ≤1000 small, <2500 medium, else large.

**3.9 Value (`CalcItemValue`)**: `m = VMult1 + VMult2; v = m>0 ? m*baseValue : (m<0 ? baseValue/m : 0);
identifiedValue = max(VAdd1 + VAdd2 + v, 1)`. Uniques use the table value directly. Unidentified items show/sell at
base value.

**3.10 Item placement on the floor**: `GetSuperItemSpace(pos)`: try a random free tile in the 3×3 around `pos`
(`GetItemSpace`: random 1..15 walk over free cells), else expanding square rings radius 2..49. World cap 127 items.
Items "flip" through a drop animation (per-type frame counts 8–20) then rest on the last frame.

**3.11 Identification**: `identified=false` on creation; scroll/skill/vendor sets it. Unidentified magic items show
"Not Identified", use base value, and their stat bonuses are **not** applied (except plain base stats).

**3.12 Validation (multiplayer anti-cheat, `IsItemValid`)**: creation-flag combinations must be legal; town items
ilvl ≤ 30 (peddler ≤ player max level); shop items within vendor price caps; unique-monster items must match a
unique monster's level; dungeon items must match some monster level or ≤ 2×max dungeon level; expansion books match
`(bookLevel+1)*2`.

### Reference tuning values

**Drop probabilities**: normal monster: 59% nothing, 30.3% gold, 10.7% item. Floor/container: 75% gold.
Magic chance given a drop at ilvl L: `≈ 1 − 0.89·(1 − (L+1)/100)`. Unique chance when magic: ≈2% (normal), ≈16%
(unique monster, which also adds +4 ilvl). Affix allocation: prefix 25%, suffix 66.7%, forced one if none; cursed
affix pool only open 33% of the time. Durability on drop 25–75%.

**Base weapon table (minMonsterLevel, dmg, dur, Str/Dex req, value)**:

| Type | tier rows (mlvl: dmg, dur, req, value) |
|---|---|
| Swords 1h | dagger (1: 1-4, 16, —, 60), short (1: 2-6, 24, S18, 120), sabre (1: 1-8, 45, S17, 170), falchion (2: 4-8, 20, S30, 250), scimitar (4: 3-7, 28, S23 D23, 200), blade (4: 3-8, 30, S25 D30, 280), claymore (5: 1-12, 36, S35, 450), long (6: 2-10, 40, S30 D30, 350), broad (8: 4-12, 50, S40, 750), bastard (10: 6-15, 60, S50, 1000) |
| Swords 2h | two-handed (14: 8-16, 75, S65, 1800), great (17: 10-20, 100, S75, 3000) |
| Axes 2h | small (2: 2-10, 24, —, 150), axe (4: 4-12, 32, S22, 450), large (6: 6-16, 40, S30, 750), broad (8: 8-20, 50, S50, 1000), battle (10: 10-25, 60, S65, 1500), great (12: 12-30, 75, S80, 2500) |
| Maces 1h | club (1: 1-6, 20, —, 20), mace (2: 1-8, 32, S16, 200), morning star (3: 1-10, 40, S26, 300), spiked club (4: 3-6, 20, S18, 225), war hammer (5: 5-9, 50, S40, 600), flail (7: 2-12, 36, S30, 500) |
| Maces 2h | maul (10: 6-20, 50, S55, 900) |
| Bows 2h (dropRate 2) | short (1: 1-4, 30, —, 100), hunter (3: 2-5, 40, S20 D35, 350), long (5: 1-6, 35, S25 D30, 250), composite (7: 3-6, 45, S25 D40, 600), short battle (9: 3-7, 45, S30 D50, 750), long battle (11: 1-10, 50, S30 D60, 1000), short war (15: 4-8, 55, S35 D70, 1500), long war (19: 1-14, 60, S45 D80, 2000) |
| Staves 2h | short (1: 2-4, 25, —, 30), long (4: 4-8, 35, —, 100), composite (6: 5-10, 45, —, 500), quarter (9: 6-12, 55, S20, 1000), war (12: 8-16, 75, S30, 1500) |

**Base armor table (mlvl: AC range, dur, Str req, value)**:

| Slot | rows |
|---|---|
| Helm | cap (1: 1-3, 15, —, 15), skull cap (4: 2-4, 20, —, 25), helm (8: 4-6, 30, S25, 40), full helm (12: 6-8, 35, S35, 90), crown (16: 8-12, 40, —, 200), great helm (20: 10-15, 60, S50, 400) |
| Light armor | cape (1: 1-5, 12, —, 10), rags (1: 2-6, 6, —, 5), cloak (2: 3-7, 18, —, 40), robe (3: 4-7, 24, —, 75), quilted (4: 7-10, 30, —, 200), leather (6: 10-13, 35, —, 300), hard leather (7: 11-14, 40, —, 450), studded (9: 15-17, 45, S20, 700) |
| Medium armor | ring mail (11: 17-20, 50, S25, 900), chain (13: 18-22, 55, S30, 1250), scale (15: 23-28, 60, S35, 2300), splint (17: 30-35, 65, S40, 3250) |
| Heavy armor | breast plate (16: 20-24, 80, S40, 2800), plate mail (19: 42-50, 75, S60, 4600), field plate (21: 40-45, 80, S65, 5800), gothic plate (23: 50-60, 100, S80, 8000), full plate (25: 60-75, 90, S90, 6500) |
| Shield | buckler (1: 1-5, 16, —, 30), small (5: 3-8, 24, S25, 90), large (9: 5-10, 32, S40, 200), kite (14: 8-15, 40, S50, 400), tower (20: 12-20, 50, S60, 850), gothic (23: 14-18, 60, S80, 2300) |
| Jewelry | rings at mlvl 5/10/15 (value 1000), amulets at mlvl 8/16 (value 1200); always magic |

**Consumables (mlvl, value)**: healing 1/50, full healing 1/150, mana 1/50, full mana 1/150, rejuvenation 3/120,
full rejuvenation 7/600; elixirs Str/Mag/Dex 15/5000, Vit 20/5000; scrolls: identify 1/100, healing 1/50, search
1/50, resurrect 1/250, lightning 4/150, firewall 4/400 (Mag 17), inferno 1/100 (Mag 19), town portal 4/200, flash
6/500 (Mag 21), infravision 8/600 (Mag 23), phasing 6/200 (Mag 25), mana shield 8/1200, flame wave 10/650 (Mag 29),
fireball 8/300 (Mag 31), stone curse 6/800 (Mag 33), chain lightning 10/750 (Mag 35), guardian 12/950 (Mag 47),
nova 14/1300 (Mag 57), golem 10/1100 (Mag 51), teleport 14/3000 (Mag 81), apocalypse 22/2000 (Mag 117); books at
mlvl 2/8/14/20 (value = spell book cost); expansion runes: fire 1/100, lightning 3/200 (Mag 13), greater fire 7/400
(Mag 42), greater lightning 7/500 (Mag 42), stone 7/300 (Mag 25).

**Affix families — prefixes** (`tier: value-range @ minLevel [slots] [align] (gold add range, ×mult)`; weight 2 for
to-hit/damage/armor %, 1 for the rest):

| Family | Tiers |
|---|---|
| **+to-hit %** (curse) | −(6-10) @3 [W,B,M] (×−3); −(1-5) @1 (×−2) |
| **+to-hit %** | 1-5 @1 [W,B,M] (100-500,×2); 6-10 @4 (600-1000,×3); 11-15 @6 (1100-1500,×5); 16-20 @9 Good (1600-2000,×7); 21-30 @12 Good (2100-3000,×9); 31-40 @16 Good [W,B] (3100-4000,×11); 41-60 @20 Good (4100-6000,×13); 61-80 @23 (6100-10000,×15); 81-100 @35 (10100-14000,×17); 101-150 @60 (14100-20000,×20) |
| **+damage %** (curse) | −100 @5 [W,B] (×−8); −(50-75) @3 (×−4); −(25-45) @1 (×−3) |
| **+damage %** | 20-35 @4 [W,B] (250-450,×3); 36-50 @6 (500-700,×4); 51-65 @9 (750-950,×5); 66-80 @12 Evil (1000-1450,×8); 81-95 @16 (1500-1950,×10); 96-110 @20 (2000-2450,×13); 111-125 @23 (2500-3000,×15); 126-150 @35 (10100-15000,×17); 151-175 @60 (15000-20000,×20) |
| **+to-hit & damage %** (curse) | −(50-75) dmg & −(6-10) hit @5 [W,S,B] (×−7); −(25-45) & −(1-5) @1 (×−5) |
| **+to-hit & damage %** | 20-35 dmg/1-5 hit @1 [W,S,B] not-useful (350-950,×5); 36-50/6-10 @6 (1100-1700,×7); 51-65/11-15 @10 (1850-2450,×13); 66-80/16-20 @15 [W,S] (2600-3950,×17); 81-95/21-30 @19 (4100-5950,×21); 96-110/31-40 @23 (6100-8450,×26); 111-125/41-50 @28 (8600-13000,×30); 126-150/51-75 @40 (15200-24000,×33); 151-175/76-100 @28 (24100-35000,×38) |
| **+armor %** (curse) | −(51-100) @3 [A,Sh] (×−3); −(25-50) @1 (×−2) |
| **+armor %** | 20-30 @1 [A,Sh] (20-100,×2); 31-40 @3 (120-200,×3); 41-55 @6 (220-300,×5); 56-70 @10 (320-400,×7); 71-90 @14 Good (420-600,×9); 91-110 @19 Good (620-800,×11); 111-130 @24 Good (820-1200,×13); 131-150 @28 Good (1220-2000,×15); 151-170 @35 Good (5200-6000,×17); 171-200 @60 Good (6200-7000,×20) |
| **resist fire / lightning / magic** (3 parallel families) | 10-20 @4 [all] (500-1500,×2); 21-30 @10 (2100-3000,×2); 31-40 @16 (3100-4000,×2); 41-50 @20 (8200-12000,×3); 51-60 @26 (17100-20000,×5) |
| **resist all** | 10-15 @8 [all] (2000-5000,×3); 16-20 @12 (7400-10000,×3); 21-30 @18 (11000-15000,×3); 31-40 @24 (24000-40000,×4); 41-50 @31 [Sh,W,S,B] (61000-75000,×7) |
| **+mana** (curse) | −(11-25) @4 [S,M] (100-1000,×−2); −(1-10) @1 Evil (×−2) |
| **+mana** | 10-15 @1 [S,M] Evil (500-1000,×2); 15-20 @5 (1100-2000,×3); 21-30 @9 (2100-4000,×5); 30-40 @15 (4100-6000,×7); 41-50 @21 (6100-10000,×9); 51-60 @27 (10100-15000,×11); 61-80 @35 [S] (15100-19000,×12); 81-100 @60 [S] (19100-30000,×13) |
| **+spell levels** | +1 @15 [S] Good (25000,×2); +2 @25 [S] Good (50000,×3) |
| **charges ×** | ×2 @4 [S] (2000,×2); ×3 @9 [S] (3000,×3) |
| **fire hit damage** | 1-10 @7 [W,S] (5000,×2) |
| **lightning hit damage** | 2-20 @18 [W,S] (10000,×2) |

**Affix families — suffixes** (weight 1 each):

| Family | Tiers |
|---|---|
| **+flat damage** | 1-2 @2 [W,B] (100-200,×2); 3-5 @7 (1300-1500,×3); 6-8 @15 [W] (2600-3000,×5); 9-12 @25 (4100-5000,×8); 13-16 @35 (5100-10000,×10); 17-20 @60 (10100-15000,×13) |
| **damage taken** (curse, +) | +2-4 @4 [A,Sh,M] Evil (×−4); +1 @2 Evil (×−2) |
| **damage taken** (−) | −1 @2 [A,Sh,M] Good (200,×2); −2 @6 [A,Sh] Good (400-800,×4); −3 @12 Good (1001-2500,×10); −4 @20 [A] Good (2500-6500,×15); −(5-6) @50 [A] Good (7500-10000,×20) |
| **Str / Dex / Mag** (curse) | −(6-10) @3 [A,Sh,W,B,M(+S for Mag)] Evil (×−3); −(1-5) @1 Evil (×−2) |
| **Str** | 1-5 @1 [A,Sh,W,B,M] (200-1000,×2); 6-10 @5 (1200-2000,×3); 11-15 @11 (2200-3000,×4); 16-20 @17 [A,W,B,M] (3200-5000,×7); 21-30 @23 [W,M] (5200-10000,×10) |
| **Dex** | same tiers/values as Str; top tier 21-30 @23 [B,M] |
| **Mag** | same tiers/values (+Staff slot); 16-20 @17 [A,W,S,B,M]; 21-30 @23 [S,M] |
| **Vit** (curse) | −(6-10) @3 Evil (×−3); −(1-5) @1 Evil (×−2) |
| **Vit** | 1-5 @1 [A,Sh,W,B,M] Good (200-1000,×2); 6-10 @5 Good (1200-2000,×3); 11-15 @11 Good (2200-3000,×4); 16-20 @17 [A,W,B,M] Good (3200-5000,×7); 21-30 @23 [M] Good (5200-10000,×10) |
| **all attributes** (curse) | −(6-10) @12 Evil (×−10); −(1-5) @5 Evil (×−5) |
| **all attributes** | 1-3 @5 [A,Sh,W,B,M] (800-4000,×5); 4-7 @11 (4800-8000,×10); 8-11 @17 [A,W,B,M] (8800-12000,×15); 12-15 @25 [W,B,M] (12800-20000,×20); 16-20 @30 [M] (20800-40000,×30) |
| **+life** (curse) | −(11-25) @4 [A,Sh,M] Evil (×−4); −(1-10) @1 Evil (×−2) |
| **+life** | 10-15 @1 [A,Sh,M] (100-1000,×2); 16-20 @5 (1100-2000,×3); 21-30 @9 (2100-4000,×5); 30-40 @15 (4100-6000,×7); 41-50 @21 (6100-10000,×9); 51-60 @27 [A,M] (10100-15000,×11); 61-80 @35 [A] (15100-19000,×12); 81-100 @60 [A] (19100-30000,×13) |
| **durability %** (curse) | −100 @3 [A,Sh,W] Evil (×−4); −(26-75) @1 Evil (×−2) |
| **durability %** | +26-75 @1 [A,Sh,W] (100,×2); +51-100 @6 (200,×2); +101-200 @12 (300,×2); indestructible @25 (600,×5); bow-only +100 @3 (750,×2), +200 @7 (1500,×3) |
| **light radius** | −4 @6 [A,W,M] Evil (×−3); −2 @3 Evil (×−2); +2 @4 Good (750,×2); +4 @8 Good (1500,×3) |
| **fire arrows** | 1-3 @1 [B] (2000,×2); 1-6 @11 (4000,×4); 1-16 @35 (6000,×6) |
| **lightning arrows** | 1-6 @13 [B] (6000,×2); 1-10 @21 (8000,×4); 1-20 @60 (12000,×6) |
| **thorns** (1-3 reflect) | @1 [A,Sh] (500,×2) |
| **no mana** (curse) | @5 [A,Sh,W] Evil (−1000,×2) |
| **half trap damage** | @11 [A,Sh,M] (1500,×2) |
| **knockback** | @5 [W,S,B] Evil-aligned (750,×2) |
| **steal mana** | 3% @8 [W] (7500,×3); 5% @19 (15000,×3) |
| **steal life** | 3% @8 [W] (7500,×3); 5% @19 (15000,×3) |
| **armor pierce** | 2-6 @1 [W,B] (1000,×3); 4-12 @9 (2000,×6); 8-24 @17 [W] (4000,×12) (expansion: tier value 2/4/8 selects the shift formula) |
| **attack speed** | quick @1 [W,S,B] (2000,×2); fast @10 (4000,×4); faster @19 [W,S] (8000,×8); fastest @27 (16000,×16) |
| **hit recovery** | fast @1 [A,M] (2000,×2); faster @10 (4000,×4); fastest @20 (8000,×8) |
| **fast block** | @5 [Sh] (4000,×4) |

Slot key: W weapon (sword/axe/mace), B bow, S staff, Sh shield, A armor+helm, M misc (ring/amulet).

**Unique items** (91 rows): min levels 1–27, values 1,000–251,175, 1–6 powers each drawn from the same effect
enum (typical: SetAC 5–100, Dam% 25–300, ToHit 10–50, attribute ±2–20, AllRes 5–75, Life ±5–100, Mana ±10–150,
Indestructible, fixed spell + charges, OneHand on a 2h sword, SetDam, SetDur). Design them as data rows.

### Smallest buildable chunks

1. **TSV data loaders** for base items, prefixes, suffixes, uniques with enum parsing and mapping ids. Done when: 169/83/95/91 rows load and unknown enum strings are fatal with field name.
2. **Item struct + `InitializeItem(idx)`** (copy base row, 40/18 staff charges, requirements). Done when: a plain item equals the base row.
3. **Seeded RNG discipline** — `SetRndSeed`, `AdvanceRndSeed`, `DiscardRandomValues`, `GenerateRnd(n)`, `RandomIntBetween`, `FlipCoin(n)` (= `GenerateRnd(n)==0`). Done when: generation is bit-reproducible from seed.
4. **`GetItemAttrs(idx, lvl)`** incl. AC roll, gold amount, book spell, oil type. Done when: gold at dlvl 5 is in [25, 75).
5. **`GetItemBLevel` / createInfo flags**. Done when: jewelry & staves are always ≥ magic tier.
6. **Affix selection (`SelectAffix`)** with slot mask, level window, useful/onlyGood, alignment, weight expansion, staff-charges exclusion. Done when: distribution over 10k rolls matches weights.
7. **`SaveItemPower`** for all ~70 effect types (table-driven switch). Done when: each effect mutates the documented fields.
8. **`PLVal` + `SaveItemAffix` + `CalcItemValue`**. Done when: value = max(add1+add2+mult*base,1) and a cursed item is `base/|mult|`.
9. **`GetItemPower` prefix/suffix allocation + naming** (short-name fallback by text width). Done when: 25%/66%/forced-one statistics hold.
10. **Staff spell & power path; book spell path; oil path**. Done when: staff charges ∈ [staffMin, staffMax], book minMag = spell.minInt.
11. **`CheckUnique` + `GetUniqueItem`** and the de-dup/reroll layer. Done when: SP never drops the same unique twice until all of its base type were found.
12. **`SetupAllItems`** orchestration + `ItemRndDur`. Done when: regenerating from (idx, createInfo, seed) yields an identical item.
13. **Base selection functions** `RndItemForMonsterLevel`, `RndUItem`, `RndAllItems`, `RndTypeItems` with cumulative-weight binary search. Done when: a level-1 monster can only drop mlvl-1 bases.
14. **Spawn entry points** `SpawnItem(monster)`, `CreateRndItem`, `CreateRndUseful`, `CreateTypeItem`, `SpawnUnique`, `CreateSpellBook/MagicWeapon/MagicArmor/Amulet`. Done when: each honours onlyGood/uper and sends network/delta messages.
15. **Floor placement** `GetSuperItemSpace` + world item pool (127) + drop animation. Done when: items never land on solid/occupied tiles and spiral out when crowded.
16. **Identification & tooltip data** (`identified`, `PrintItemPower` strings, "Not Identified"). Done when: unidentified rings show only the flag line.
17. **Item record pack/unpack** (19-byte `ItemPack`) + `RecreateItem` (vendor variants re-run vendor generators with stored seed). Done when: save/load round-trips every item kind incl. trophy ear.
18. **MP validation** (`IsItemValid` family). Done when: an item with ilvl 60 from town is rejected.

### Pitfalls / design lessons
- Deterministic regeneration from `(base, level, seed, flags)` is the single most valuable decision: tiny saves, cheap network sync, trivially verifiable loot, and it enables anti-dupe checks. The price is strict RNG call-order discipline (note the explicit `DiscardRandomValues(1)` calls that keep old seeds valid).
- The unique chance test `rand(100) > uper` makes the real probability `(uper+1)%` — document the intent (1%/15%) and the actual (2%/16%).
- Picking "the highest-level eligible unique" (original behaviour) means low-level uniques of a base type stop appearing once higher ones unlock; the modern fix re-picks uniformly and uses a 4-bit offset in `dwBuff` to stay reproducible.
- Keep cursed affixes behind a 1/3 "allow bad" gate rather than mixing them into the weights; it keeps the economy readable.
- Value multipliers compound additively (`mult1 + mult2`), not multiplicatively — intentional to avoid absurd prices.
- Minimum affix level is capped at 25 so deep dungeon drops can still roll mid-tier affixes.
- Two-handed / one-handed is a property of the *base row*, but one unique power can flip it; keep `equipType` on the instance, not just the base.
- The expansion's armor-pierce reinterprets the same affix table param as a shift amount; version your effect semantics.

---

## 4. Equipment stat aggregation, consumables, durability, pricing & vendors

### Purpose
Turns the seven equipped items plus class/level into the player's effective combat numbers (`CalcPlrInv`), applies
consumables (potions, elixirs, scrolls, books, oils, runes), implements repair/recharge, and defines vendor stock
generation and buy/sell/repair pricing.

### Key data structures
Aggregates on `Player` (see system 1): `iMinDam, iMaxDam, iAC, iBonusDam, iBonusToHit, iBonusAC, iBonusDamMod,
iGetHit, iEnAc, iFMinDam/iFMaxDam, iLMinDam/iLMaxDam, iFlags, damAcFlags, iSplLvlAdd, iSpells (staff spell mask),
lightRadius, resistances, damageMod, blockFlag, gfxnum`.
Vendor stock: blacksmith basic list (≤19 / 24), premium list (≤6 / 15) + `PremiumItemLevel`, witch list (≤17 / 24),
healer list (≤17 / 19), peddler single item + `BoyItemLevel`.
`item_misc_id` consumable kinds: Heal, FullHeal, Mana, FullMana, ElixStr/Mag/Dex/Vit, Rejuv, FullRejuv, Scroll,
ScrollT (targeted), Staff, Book, Ring, Amulet, Unique, Oil×10 kinds, Ear, SpecialElixir, Rune×5, Note, ArenaPotion.

### Algorithms & rules

**4.1 `CalcPlrInv(player)` — order matters**
1. `CalcSelfItems`: compute `statFlag` per equipped item. Sum Str/Mag/Dex bonuses of *identified* equipped items,
   then iterate: an item whose requirements exceed `max(0, base + bonuses)` (or that fails MP validation) is marked
   unusable and its bonuses removed; repeat until stable. (Items can "turn each other off".)
2. `CalcPlrItemVals`: for each equipped item with `statFlag`: sum `minDam, maxDam, AC`; if it holds a spell with
   charges → `iSpells |= bit(spell)`. If normal quality or identified: sum Dam%, ToHit, `GetBonusAC`
   (`AC*PLAC/100`, min ±1 when nonzero), flags, Str/Mag/Dex/Vit, resists, DamMod, GetHit, Light, Life, Mana,
   SplLvlAdd, EnAc, elemental min/max.
3. `CalcPlrDamage`: if no weapon damage at all: `1-1`; holding a shield `1-3`; martial class unarmed:
   `min = max(min, level/2)`, `max = max(max, level)`.
4. `CalcPlrPrimaryStats`: rage buff: `+2*level Str, +1.5*level Dex, +2*level Vit` while active, same amount
   *subtracted* during cooldown; `current = clamp(base + items + buff, 0, 750)`.
5. Light radius `clamp(10 + Σlight, 2, 15)` (each affix unit = 1 tile = "10%").
6. `CalcPlrDamageMod` (class melee bonus, `L = level`):
   ```
   default (melee, caster)        : L*Str/100
   ranged                         : L*(Str+Dex)/200
   martial  staff or unarmed      : L*(Str+Dex)/150 ; otherwise /300
   dual-wield  sword: L*(Str+Dex)/150 ; bow: /250 ; else L*Str/100
   berserker  axe or mace: L*Str/75 ; bow: L*Str/300 ; else L*Str/100
              + L*Vit/100 if no shield/staff/bow ; shield: iAC -= shieldAC/2
   IronSkin flag: iAC += L/4
   ```
7. `iSpells` readied-spell validation; `iSplLvlAdd`, `iEnAc`.
8. `CalcPlrResistances`: NaturalResistance flag `+level` to all three; rage cooldown `−level`; ZeroResistance flag
   forces 0; `clamp(0, 75)`.
9. `CalcPlrLifeMana` (system 1.2).
10. `CalcPlrBlockFlag`: shield held → block; martial class: staff → block + FastBlock, or unarmed / single one-hand
    weapon with empty off-hand → block.
11. Armor graphic tier (light/medium/heavy from chest piece) and martial AC bonuses: light armor `+2*L`,
    medium `+L/2` (unique medium `+2*L`), heavy unique `+L/2`.
12. Weapon graphic from usable hand items (sword/axe/bow/mace/staff ± shield); reload sprites if changed.
13. Gold-capacity amulet check (expansion) → `MaxGold` 5000 ↔ 10000 and strip excess.
14. For the local player: refresh `statFlag` on inventory, belt, stash and held item; recompute scroll spell mask.

**4.2 Requirement check** `CanUseItem = valid && Str >= minStr && Mag >= minMag && Dex >= minDex` using *current*
stats. Books additionally require `minMag` for the *next* level of that spell: `updateRequiredStatsCacheForPlayer`
sets `minMag = spell.minInt * (1 + 0.2 * currentSpellLevel)` style scaling: engine formula
```
if book: lvl = splLvl[spell]; minMag = spell.minInt * (…) — see Item::updateRequiredStatsCacheForPlayer:
   int lvl = player._pSplLvl[spell]; _iMinMag = baseMinInt; while (lvl--) _iMinMag += 20% of baseMinInt
```
(each already-known level raises the Mag requirement of the next book by 20% of the base requirement, i.e.
level N book needs `minInt * (1 + 0.2*N)` rounded down).

**4.3 Consumables (`UseItem`)**
| Kind | Effect |
|---|---|
| Healing / Mana potion | partial restore (1.8) |
| Full healing / mana | set to max (mana only if no NoMana) |
| Rejuvenation / full rejuvenation / arena potion | both |
| Elixir Str/Mag/Dex/Vit | `Modify*(+1)` permanent (expansion also fully restores mana/life for Mag/Vit) |
| Special elixir | +3 to all four |
| Scroll (non-targeted) / targeted scroll | cast immediately at cursor tile (or tile in front if cursor off-map) as `SpellType::Scroll`; targeted scrolls on mouse set a target cursor first |
| Book | `splLvl[spell] = min(splLvl+1, 15)`; refund `spell.manaCost` mana; refresh requirement caches |
| Oil (10 kinds) | sets pending oil type and an "oil" cursor; applied by clicking an item (4.5) |
| Rune (5 kinds) | arms a targeted rune-placement spell cursor |
| Map / note / quest consumables | open quest UI |
Belt and inventory use remove the item unless it is a scroll/rune (those are consumed when the cast resolves); with
"auto refill belt" the engine prefers consuming the matching inventory copy and keeps the belt slot.

**4.4 Repair & recharge**
- Class repair skill / repair scroll (`RepairItem(item, level)`): loop `rep += level + rand(level); maxDur -=
  max(maxDur/(level+9), 1)` until `rep + dur >= maxDur`, then `dur = min(dur+rep, maxDur)`; item destroyed if maxDur
  hits 0. (Self-repair permanently erodes max durability; the smith does not.)
- Recharge skill (`RechargeItem`): `strength = rand(1, level / spell.staffLevel)`; loop `maxCharges--; charges +=
  strength` until full; staff destroyed if maxCharges reaches 0.
- Durability loss events: see 2.3/2.6/2.8/2.9; `Decay` weapons lose 5% damage per hit and break at −100%.
  An item at ≤5 durability shows a warning icon (gold 5..3, red ≤2).

**4.5 Oils (expansion)** — class restrictions then effect:
| Oil | Target | Effect |
|---|---|---|
| accuracy | weapon | `toHit += 1..2` if < 50 |
| mastery | weapon | `toHit += 3..5` if < 100 |
| sharpness | weapon | `maxDam += 1` if `max-min < 30 && max < 255` |
| death | weapon, not bow | `minDam += 1, maxDam += 2` if `max-min < 30 && max < 254` |
| skill | any | all three requirements `−rand(5..10)` floored at 0 |
| blacksmith | any non-indestructible | `dur += (maxDur+4)/5` capped; if already full and `maxDur < 100`: `maxDur += 1` |
| fortitude | any | `maxDur, dur += rand(10..50)` if `maxDur < 200` |
| permanence | any | indestructible |
| hardening | armor | `AC += 1..2` if < 60 |
| imperviousness | armor | `AC += 3..5` if < 120 |

**4.6 Vendors**
- Blacksmith basic (`SpawnSmith(lvl=dlvl-based)`): `count = rand(10..19)` (24 exp); each: new seed, base via
  dropRate-weighted pick among non-misc/non-gold/non-staff/non-jewelry with `minMonsterLevel ≤ lvl`, plain
  (`GetItemAttrs` only), reroll while `value > 140000` (200000 exp); identified; sorted by base index.
- Blacksmith premium (`SpawnPremium`): list size 6 (15 exp); slot i level = `PremiumItemLevel + add[i]`,
  `add = {-1,-1,0,0,1,2}` (exp `{-1,-1,-1,0,0,0,0,1,1,1,1,2,2,3,3}`); `SpawnOnePremium(plvl)`: `plvl = clamp(1..30)`;
  base from `minMonsterLevel ∈ [plvl/4, plvl]`; `GetItemBonus(plvl/2, plvl, onlyGood=true, spells=base-mode-only)`;
  reroll until `value ≤ 140000` (expansion: ≤ 200000 and requirements ≤ `1.2 × max(playerStat, classCap)` and value
  ≥ 80% of the player's most valuable item of that slot). When the player levels, `PremiumItemLevel` catches up one
  level at a time, shifting out the two lowest slots and rolling two new ones.
- Witch: pinned mana / full mana / town-portal; expansion pins up to `rand(0..3)` books; then `rand(10..17)` (24)
  items from misc/staff pool; 5% chance (always for staves) of affixes with window `[lvl, 2*lvl]`, reroll over the
  value cap.
- Healer: pinned healing / full healing (+ resurrect scroll in MP); `rand(10..17)` (19) misc items from the healer pool.
- Peddler: one item, regenerated when `BoyItemLevel < lvl/2`; `GetItemBonus(lvl, 2*lvl, onlyGood)`; base mode: reroll
  while `value > 90000`; expansion: ≤ 200000, requirements ≤ 1.2× caps, value ≥ 80% of player's best of that type, and
  during the first 200 tries class-inappropriate types (bows/staves for melee, etc.) are rejected. Sells at **150%**
  (`v + v/2`); identifies for `v - v/4`.
- Vendor item levels: smith/witch/healer use a level derived from the deepest dungeon level visited; premium/peddler
  use character level.

**4.7 Prices**
```
buy          = identifiedValue (vendors always show identified)
sell         = max(value/4, 1)  where value = (magic && identified) ? identifiedValue : baseValue
repair (NPC) = magic&identified ? 30*identifiedValue*due/(maxDur*100*2) : max(baseValue*due/(maxDur*2), 1), due = maxDur - dur
recharge     = (baseValue + spell.staffCost) * (maxCharges - charges) / (maxCharges*2)
identify     = 100 ; peddler identify = value - value/4
vendor caps  = 140,000 (base) / 200,000 (expansion); peddler cap 90,000 (base)
```

### Reference tuning values
| Item | Value |
|---|---|
| Unarmed damage | 1-1; with shield 1-3; martial `level/2 – level` |
| Class melee bonus divisors | 100 (default), 200 (ranged Str+Dex), 150/300 (martial), 150/250/100 (dual), 75/300/100 (+Vit/100) (berserker) |
| Martial AC bonus | light +2L, medium +L/2 (unique +2L), heavy unique +L/2 |
| IronSkin | +L/4 AC ; NaturalResistance +L all resists |
| Rage | +2L Str, +1.5L Dex, +2L Vit for `245 + 2L` ticks, then equal penalty for the same duration and `6L` damage at the end |
| Light radius | base 10, clamp 2..15 |
| Repair erosion | `maxDur -= max(maxDur/(level+9),1)` per loop |
| Recharge | `rand(1, level/staffLevel)` charges per lost max charge |
| Staff default charges | 40 (base) / 18 (expansion) |
| Durability warning | ≤5 gold, ≤2 red |
| Vendor counts | smith 10–19/24, premium 6/15, witch 10–17/24, healer 10–17/19, peddler 1 |
| Premium level offsets | {-1,-1,0,0,1,2} / 15-slot expansion table |
| Price caps | 140k/200k; peddler 90k; peddler markup ×1.5 |

### Smallest buildable chunks
1. **`CalcSelfItems` iterative usability** — Done when: two items whose requirements depend on each other's bonuses resolve deterministically (both off).
2. **`CalcPlrItemVals` aggregation** incl. identified-only bonuses. Done when: unidentified +Str ring adds nothing.
3. **Class damage-mod & AC quirks** (`CalcPlrDamageMod`, martial AC, IronSkin). Done when: per-class table values match.
4. **Primary stat buffs/debuffs & clamps** (rage). Done when: rage toggles Str by 2L and resists by −L in cooldown.
5. **Resist & life/mana layering** (`CalcPlrResistances`, `CalcPlrLifeMana`). Done when: swapping a +life item never changes hp% below floor.
6. **Block flag & weapon/armor graphic selection**. Done when: martial class blocks with staff, not with two-hander.
7. **Requirement cache** `updateRequiredStatsCacheForPlayer` (book scaling 20%/level) over inventory/belt/stash/hand. Done when: a known-level-3 book shows red at `minInt*1.6 > Mag`.
8. **`UseItem` consumables switch** incl. belt auto-refill lookup. Done when: using a belt potion consumes the inventory copy first.
9. **Book learning** (+1 level cap 15, mana refund, network message). Done when: level-15 book is unusable.
10. **Repair / recharge functions** with erosion. Done when: repairing a 100-dur item at level 1 erodes 10 max durability per loop.
11. **Oil application** with class/target rules and caps. Done when: death oil refused on bows.
12. **Vendor generators** (5) with reroll loops, pins, sorting, premium rotation. Done when: premium slot levels follow `PremiumItemLevel + add[i]`.
13. **Price functions** (buy/sell/repair/recharge/identify/peddler markup). Done when: table formulas pass unit tests.
14. **Durability warning icons** (HUD) — Done when: icon colour partitions at 5/2.

### Pitfalls / design lessons
- Re-deriving every aggregate from scratch is O(7 items) — do it; incremental updates are where bugs hide.
- Usability must be a fixed-point iteration because bonuses from one item can satisfy another's requirement.
- Keep *base* values for life/mana so that unequipping a +life item scales current life proportionally rather than killing the player; the engine keeps `hpBase` = current − bonus.
- The self-repair erosion is the designed gold sink / NPC incentive; make the "+9" offset data.
- Vendor rerolls under a value cap can loop forever in base mode; the expansion added a 150-try cap — always bound such loops.
- The premium shop's "two lowest slots roll out on level-up" rotation gives the player a reason to revisit without a timer.

---

## 5. Grid inventory, belt, equipment slots, stash, auto-pickup & serialization

### Purpose
Implements the 10×4 cell backpack with multi-cell item footprints, 7 equipment slots with hand/two-hand rules, an
8-slot quick belt, gold stacking/splitting, drag-and-drop with swap, shift/ctrl quick-move, auto-placement, a 100-page
10×10 shared stash, auto-pickup and the compact save/network formats.

### Key data structures
```
InventorySizeInSlots = 10 x 4 ; cell = 28 px (29 px pitch) ; InventoryGridCells = 40 ; MaxBeltItems = 8
InvBody[7]   : HEAD, RING_LEFT, RING_RIGHT, AMULET, HAND_LEFT, HAND_RIGHT, CHEST
InvList[40]  : dense list of backpack items (order = insertion; removal shifts down)
InvGrid[40]  : int8 per cell: 0 empty; +k → cell is the item's anchor (bottom-left cell of InvList[k-1]);
               -k → other cells covered by InvList[k-1]
SpdList[8]   : belt (1x1 usable items only)
HoldItem     : item on cursor
Slot ids (click routing): 0..6 equipment, 7..46 grid (row-major 10 wide), 47..54 belt
Item footprint = sprite size / 28 : 1x1, 1x2, 1x3, 2x2, 2x3 (FindSlotForItem supports heights 1,2 any width; 1x3; 2x3)
Stash: stashGrids[page] = 10x10 u16 (0 empty, k = stashList[k-1]+1), stashList (vector, ≤10000), gold (int), page 0..99
Pack formats:
  ItemPack      {seed u32, createInfo u16, idx u16, bId u8 (quality<<1|identified), dur u8, maxDur u8, charges u8,
                 maxCharges u8, value u16 (gold only), dwBuff u32}                       = 19 bytes
  PlayerPack    {timestamps, destAction/params, level, x, y, targx/y, name[32], class, baseStr/Mag/Dex/Vit u8,
                 level u8, statPts u8, exp u32, gold i32, hpBase/maxHpBase/manaBase/maxManaBase i32 (raw 26.6),
                 splLvl[37] + splLvl2[10], memSpells u64, InvBody[7], InvList[40], InvGrid[40] i8, numInv u8,
                 SpdList[8], townWarps, dungMsgs, lvlLoad, battleNet, manaShield, dungMsgs2, isExpansion,
                 reflections u16, bossKillLevel u32, difficulty u32, damAcFlags u32, reserved}
  PlayerNetPack adds validation copies of derived stats (Str, HP, dmg, AC…) so peers can verify the sender.
```

### Algorithms & rules

**5.1 Equip rules (`CanEquip`/`CanWield`)**
- `CanEquip(item)`: `isEquipment && statFlag`; slot must be empty and player mode ≤ walking (no equip mid-action).
- Slot match: helm→HEAD, body armor→CHEST, ring→either RING, amulet→AMULET, OneHand/TwoHand→hands via `CanWield`:
  both hands empty → ok; both full → no; one occupied: allowed if item is OneHand and the occupied is OneHand and
  **classes differ** (weapon + shield), or (DualWield class) both are one-handed swords/maces.
- Berserker exception: two-handed swords/maces count as OneHand for him (`GetItemLocation`).
- A two-hander lives in HAND_LEFT; HAND_RIGHT is drawn as a translucent copy and treated as occupied.

**5.2 Paste (drop held item on a slot, `CheckInvPaste`)**
1. `FindTargetSlotUnderItemCursor(cursor, size)`: hit-test equipment rects, then grid rects (for >1x1 items compute the
   top-left cell from the hot cell minus `((w-1)/2, (h-1)/2)`, biased toward the half of the cell the cursor is in
   for even sizes, clamped inside the grid), then belt rects.
2. Determine target location kind from slot; belt requires `CanBePlacedOnBelt` (1x1, usable, not gold, requirements
   met); equipment requires matching `equipType`, requirements met, mode ≤ walking.
3. Body slots: swap with previous occupant (goes to hand). Hands (`ChangeEquippedItem`): paste into the selected hand
   unless the other hand holds the same class (then replace that one), dual-wield exceptions; a held two-hander in
   the other hand is removed first. Two-handers (`ChangeTwoHandItem`): if both hands full, auto-place the shield
   (or left item) into the backpack first, else fail.
4. Grid (`ChangeInvItem`): `CheckOverlappingItems` over the footprint — at most **one** distinct existing item may be
   covered (it is swapped to the cursor), else refuse. Gold onto gold merges up to `MaxGold` (5000), remainder stays
   on cursor. New items append to `InvList`, anchor written to grid.
5. Belt: swap with occupant.
6. `CalcPlrInv`, new cursor = whatever is now held.

**5.3 Cut (pick up from slot, `CheckInvCut(auto, drop)`)**
- Plain click: lift item to cursor (`RemoveInvItem` compacts `InvList` and renumbers `InvGrid` references).
- Shift-click (automatic move): equipment → backpack; backpack item → belt if belt-eligible, else auto-equip (lifting
  whichever body item must vacate, with a "could it fit back" pre-check, including the two-hand-both-hands case);
  belt → backpack. Failure speech: "no room" / "can't do that".
- Ctrl-click: with stash open → transfer to stash; with a vendor open → sell; else lift and immediately drop on the
  floor (`TryDropItem` → `FindAdjacentPositionForItem`: front, left, right, further left/right, behind, then own tile).

**5.4 Auto placement order** (pickup with auto-get, starting loadout, stash shift-click):
`AutoEquip (if option for that category enabled; weapons never auto-equip for the martial class) → AutoPlaceItemInBelt
→ AutoPlaceItemInInventory`. `FindSlotForItem(size)` scan order:
- height 1: cells 30..39 (bottom row left→right), then columns 9→0, rows 2→0 (right-to-left, bottom-up);
- height 2: columns `10-w`→0, rows 0..2;
- 1x3: cells 0..19 row-major; 2x3: cells 0..8 then 10..18.
(Small items fill the bottom row first; tall items fill the top-left.) `ReorganizeInventory` sorts by height desc then
width desc and re-places; restores the original layout if anything fails.

**5.5 Gold**: `AddGoldToInventory(value)`: top off existing stacks, then new 5000-stacks in cells 39→30, then columns
9→0 rows 2→0; leftover stays on the cursor (`GoldAutoPlace`). `RoomForGold` sums free capacity. Right-click a stack →
split dialog (number input, max = stack). Player gold total is always recomputed from stacks (`CalculateGold`).
Over-cap stacks (amulet removed) are stripped into new stacks or dropped.

**5.6 Belt use**: hotkeys 1–8; usable, non-gold items only; scrolls/runes are consumed when the spell resolves;
"auto refill" uses the inventory copy or the right-most identical belt item first.

**5.7 Stash** (shared across characters, 100 pages × 10×10): paste rules mirror the backpack (one-item overlap swap);
gold pastes into a single integer counter (no stacks); withdraw dialog max = `min(RoomForGold, stash.gold)`; shift-click
from stash = belt or auto-equip; ctrl-click = to backpack (`TransferItemToInventory`). `AutoPlaceItemInStash` scans
pages starting at the current one, wrapping, row-major positions. Removing an item swap-removes from `stashList` and
patches every page's indices. Arena potions are not stashable.

**5.8 Auto-pickup** (each time a walk step completes, for the 8 neighbours + own tile): gold if option on and a free cell
or non-full stack exists; potions by kind while `count(kind in inv+belt) < configuredLimit`; elixirs/oils by toggle;
requires `CanFitItemInInventory || AutoPlaceItemInBelt`. Sends a "request auto-get item" command (server-authoritative
pickup; the item is flagged `requested` to avoid double requests).

**5.9 Pickup/drop sync**: items are identified on the wire by `(seed, baseIndex, createInfo)`; `SyncGetItem` tolerates
position desync by searching the active list for the key triple. Dropped items carry durability/charges/value and
(expansion) oil-modified toHit/maxDam, clamped on receive (`ClampToHit ≤ 51`, `maxDam - minDam ≤ 30`).

**5.10 Serialization**: items pack to 19 bytes (gold value is the only "instance" field besides durability/charges);
non-expansion saves remap base indices; the trophy item abuses the pack fields to carry a 16-char name. Player pack
stores base stats, raw fixed-point life/mana bases, spell levels (37 + 10 expansion), spell mask, all three containers.

### Reference tuning values
| Constant | Value |
|---|---|
| Grid | 10×4 cells, 28 px cell, 29 px pitch; equipment rects: head 58×59, rings 28×29, amulet 28×29, hands 58×86/87, chest 58×87 |
| Belt | 8 slots at x=205+29i, y=5 on the main panel |
| Max gold per stack | 5000 (10000 with capacity amulet) ; gold cursor tiers ≤1000 / <2500 / else |
| Stash | 100 pages, 10×10, ≤10000 items, nav buttons ±1/±10 |
| Auto-pickup | option-driven per potion kind counts; elixir/oil toggles; town toggle |
| Drop search | front, L, R, LL, RR, LLL, RRR, back, self |
| Item pack | 19 bytes; player pack fixed layout with 20 reserved bytes |

### Smallest buildable chunks
1. **Footprint & grid model** — `GetInventorySize`, `InvGrid` anchor/negative convention, `AddItemToInvGrid`, `RemoveInvItem` compaction + renumbering. Done when: removing item 2 of 5 leaves a consistent grid.
2. **Fit search** `CheckItemFitsInInventorySlot`, `FindSlotForItem` with the documented scan orders. Done when: a potion lands at cell 30 first, a 2x3 at cell 0.
3. **Slot hit-testing** incl. even-size hot-cell bias. Done when: dropping a 2x2 with the cursor in a cell's right half anchors to that column.
4. **Equip predicates** `CanEquip`, `CanWield`, dual-wield & berserker exceptions. Done when: sword+sword only for dual class; 2h sword one-handed only for berserker.
5. **Paste state machine** for body, hands, two-hand, grid (single-overlap swap), belt, gold merge. Done when: every branch round-trips the previous occupant to the cursor.
6. **Cut + shift/ctrl quick moves** with the two-hand both-hands-full logic. Done when: shift-click on a 2h weapon with sword+shield equipped moves both if space exists, else aborts cleanly.
7. **Gold handling** `AddGoldToInventory`, `RoomForGold`, split dialog, `CalculateGold`, `StripTopGold`. Done when: 12,345 gold fills stacks 5000/5000/2345 in cells 39,38,37.
8. **Belt** place/use/hotkeys/auto-refill. Done when: belt slot persists after using a potion if an inventory copy existed.
9. **Auto-equip options & auto-place cascade**. Done when: martial class never auto-equips weapons.
10. **Floor drop & pickup** `TryDropItem`, `FindAdjacentPositionForItem`, `InvGetItem`/`AutoGetItem`, "can't carry" respawn. Done when: full inventory re-drops the item at its position.
11. **Stash container** (pages, paste/cut, gold counter, withdraw dialog, auto-place across pages, swap-remove). Done when: 101st page wraps to 0 in auto-place.
12. **Auto-pickup scanner** with per-kind limits. Done when: the 9th healing potion is not picked up when the limit is 8.
13. **Reorganize inventory** sort. Done when: layout restores on failure.
14. **Item/player pack & unpack** incl. legacy index remaps and trophy encoding. Done when: byte layouts match the sizes above.
15. **Network item key & desync-tolerant pickup** (`FindGetItem`, `SyncGetItem`). Done when: picking an item whose position moved still removes the right one.
16. **Item outline/highlight colours** by quality & usability (white/blue/gold; red tint when unusable). Done when: unusable items render with the red palette shift.

### Pitfalls / design lessons
- Store the anchor at the **bottom-left** cell (the engine's `x==0 && y==h-1`), matching how sprites are drawn from their bottom edge; it avoids an offset table.
- Negative indices in the grid for covered cells make "which item is under this cell" O(1) and let removal renumber in one pass.
- Allow exactly one overlapping item on paste — it is the whole "swap" UX and keeps the data model simple.
- Never let an equip happen while an action is in progress (mode ≤ walking) — otherwise animation/graphic swaps desync.
- Belt eligibility = footprint 1x1 AND usable AND not gold AND requirements met; checking requirements here prevents "use a book you can't read" bugs.
- Keep scan orders deliberately different for small vs tall items so the backpack self-organizes.
- Gold as regular 1x1 items in the grid (not a counter) is a real inventory pressure mechanic; the stash uses a counter to avoid 100 pages of coins.
- Sync pickups by `(seed, idx, createInfo)`, not by tile, and expect position desync.

---

## 6. Spell system

### Purpose
A flat list of ~36 spells (52 with expansion) each with a data row (costs, levels, element, missiles) and four
delivery types: **Skill** (free class ability), **Spell** (learned from books, costs mana, has a level 1–15), **Scroll**
(consumable, cast at spell level 0 → uses the spell's base scaling), **Charges** (from an equipped staff). Spell
effects are implemented as missiles; this section lists each archetype with its exact formulas.

### Key data structures
```
SpellData (spelldat.tsv) {
  id, name, soundId, bookCost10 (×10 = gold), staffCost10 (×10), manaCost u8 (255 = "all mana"),
  flags: element {Fire, Lightning, Magic} | Targeted | AllowedInTown,
  bookLevel i8 (-1 = no book), staffLevel i8 (-1 = no staff), minIntelligence u8 (Mag requirement for book/staff),
  missiles[2], manaMultiplier (sManaAdj: cost reduction per spell level), minMana, staffMin, staffMax (charge range) }
Player: splLvl[64] (0..15), memSpells / ablSpells / scrlSpells / iSpells u64 bitmasks (bit = id-1),
        readiedSpell + readiedType, hotkeys[12] (id + type), queuedSpell / executedSpell {id, type, from-slot, level}
SpellCheckResult { Success, Fail_NoMana, Fail_Level0, Fail_Busy }
Effective level = max(0, splLvl[spell] + Σ item.SplLvlAdd)   (items can push it negative → 0 = unusable)
```

### Algorithms & rules

**6.1 Learning**: book use → `splLvl = min(splLvl+1, 15)`, `memSpells |= bit`; the book's Mag requirement grows 20%
of `minInt` per level already known. Staff with charges equipped → `iSpells |= bit` while `charges > 0`. Scrolls in
inventory/belt that the player can use → `scrlSpells |= bit` (recomputed on every inventory change). Class skill →
`ablSpells` (set at init, not saved). Validation masks `memSpells` to spells that have a book level.

**6.2 Mana cost (`GetManaAmount`)**
```
sl  = max(effectiveLevel - 1, 0)
adj = sl > 0 ? sl * manaMultiplier : 0
fire-bolt: adj /= 2 ; resurrect: adj = sl * (manaCost/8)
healing & heal-other: ma = healing.manaCost + 2*charLevel - adj        (5 + 2L - adj)
manaCost == 255     : ma = maxManaBase - adj                             ("all your mana")
else                : ma = manaCost - adj
ma = max(ma, 0) * classAttributes.manaCost (1.0 / 0.75)
if ma < minMana: ma = minMana
```
**6.3 Cast check (`CheckSpell`)**: Busy if cursor is not the hand cursor (unless mana-only check); Skill → ok;
`effectiveLevel <= 0` → Fail_Level0; `mana < cost || NoMana flag` → Fail_NoMana. In town only `AllowedInTown`
spells. Scroll/charges checked by item presence (`CanUseScroll`/`CanUseStaff(left hand, charges>0)`).

**6.4 Casting flow**: input → network command with (target tile | monster | player | wall direction), spell id,
type, from-slot → on tick `StartSpell` revalidates, plays cast animation by element, at `castingActionFrame`
`CastSpell(src, dst, level)` adds each missile in `missiles[]` (charged bolt: `level/2 + 3` bolts); if **no** missile
fizzled, `ConsumeSpell`: Spell → mana −= cost; Scroll → remove one matching scroll/rune (preferring the clicked
slot); Charges → left-hand staff `charges--`. Blood-star costs 5 HP, bone-spirit 6 HP in addition.

**6.5 Common scaling helper** `ScaleSpellEffect(base, lvl)`: `for i in 0..lvl: base += base/8` (≈ ×1.125^lvl).
`GenerateRndSum(range, n)` = sum of n rolls of `rand(0..range-1)`.

**6.6 Spell archetypes & formulas** (`L` = caster level, `S` = effective spell level, `Mag` = caster magic;
damage integers are later shifted ×64 by the missile code; "speed" = sub-tile velocity units, 16 = 1 tile/tick)

| Archetype | Spell(s) | Formula / behaviour |
|---|---|---|
| Single-target bolt | fire bolt | dmg `rand(0..9) + Mag/8 + S + 1`; speed `16 + min(2S, 47)`; also the guardian's projectile |
| Fast cheap bolt swarm | charged bolt | `S/2 + 3` bolts; each `rand(0, Mag/4) + 1` dmg; speed 8; random drift every 5 ticks |
| Undead-only bolt | holy bolt | `rand(0..9) + L + 9`; speed `16 + min(2S,47)`; only hurts undead |
| Generic magic bolt | blood star, bone spirit(1/3 target HP) | blood star `3S − Mag/8 + Mag/2`; costs 5 HP per cast |
| Piercing beam | lightning | beam segments along a line; each segment lives `S/2 + 6` ticks; per-segment damage `rand(2, 2+L)`×hits; speed 32 |
| Chain | chain lightning | one beam to target plus one beam to every monster within radius `min(S+3, maxCrawl)`; same damage as lightning |
| Explosive bolt | fireball | `ScaleSpellEffect(2*(L + rand2(0..9)) + 4, S)` splash on impact; speed `16 + min(2S, 34)` |
| Homing elemental | elemental | fireball formula `/2`, follows target, explodes at destination |
| Self-centred AoE | flash | bottom+top halves each `ScaleSpellEffect(rand(L+1 rolls of 0..19) + L + 1, S) × 1.5`; lasts 19 ticks |
| Radial nova | nova | ring of balls; dmg `ScaleSpellEffect((5 rolls 0..5 + L + 5)/2, S)`; each ball speed 16 |
| Screen-wide | apocalypse | one boom on every monster in a 17×17 box, `rand(L rolls of 0..5) + L` each, 255-tick sweep |
| Wall (directional) | fire wall, lightning wall | two arms grow from the target tile perpendicular to cast direction for 7 ticks; each segment `((2 rolls 0..9) + 2 + L) << 3` dmg per touch; segment life `10 * (S+1) * 16` ticks (fire) / `255*(S+1)` (lightning) |
| Advancing wave | flame wave | `S/2 + 2` segments each side of a line that moves forward; `rand(0..9) + L + 1` per touch |
| Channelled cone | inferno | stream along a line; per-tile fire lasts `5*dmg + 20` ticks; dmg `i = rand(L) + rand(2); 8i + 16 + (8i+16)/2` |
| Sentinel summon | guardian | spawns a static turret; duration `min(S + L/2, 30) << 4` ticks (≥30); fires fire bolts `ScaleSpellEffect(rand(0..9) + L/2 + 1, S)` |
| Minion summon | golem | kills previous golem; `maxHP = 2*(320*S + maxMana/3)` raw (= `(10S + maxMana/192)` points… i.e. `10*S*64/64`), AC 25, toHit `5*(S+8) + 2L`, dmg `2(S+4)..2(S+8)` |
| Teleport | teleport | nearest free tile within radius 5 of click; 2-tick missile; phasing: random tile at distance 4–6 (ring between |3| and |6|) |
| Petrify | stone curse | target monster frozen for `min(S+6, 15) << 4` ticks; bosses/golem immune |
| Mana shield | mana shield | toggles `manaShield`; damage reduction `1 − 1/(24 − 3*min(S,7))`; fizzles if already on; drops at 0 mana |
| Self heal | healing | `rand(1..10) + Σ_L rand(1..4) + Σ_S rand(1..6)` × class `splRestoreLife` |
| Heal other | heal other | same roll with `healOtherRestoreLife`, delivered by targeting cursor |
| Mana restore (expansion) | mana | `rand(1..10) + Σ_L rand(1..4) + Σ_S rand(1..6)` × `splRestoreMana` |
| Town portal | town portal | places a portal at nearest valid tile ≤5; one per player (older one closes); 100-tick open animation |
| Sight buff | infravision | duration `ScaleSpellEffect(1584, S)` ticks (~79 s at S0) |
| Search (expansion) | search | reveal items; duration `2L + 10S + 245` ticks, stacking |
| Utility cursors | identify, item repair, staff recharge, trap disarm, telekinesis, resurrect | open inventory/arm a cursor; the effect applies on the next click (system 4 / 2.12) |
| Berserk buff | rage (class skill) | `+2L Str, +1.5L Dex, +2L Vit` for `245 + 2L` ticks, then the same as penalty (and −L resists) for the same duration, then `6L` self-damage (can't kill); fizzles if HP ≤ L |
| Reflect (expansion) | reflect | adds `(S or 2)*L` reflect charges |
| Etherealize | etherealize | makes the player unhittable (flag), costs all mana |
| Rune traps (expansion) | fire/light/nova/immolation/stone runes | placed from items; lightning-wall rune dmg `16*((2 rolls 0..9) + L + 2)`; explosion runes use the fireball formula ×2 |
| Arrow-derived | fire/lightning/spectral arrows | from bow affixes, not spells |

**6.7 Spell-book damage display (`GetDamageAmt`)** — simplified ranges shown in the UI:
fire bolt `Mag/8+S+1 .. +9`; charged bolt `1 .. 1+Mag/4`; holy bolt `L+9 .. L+18`; lightning/chain `2 .. 2+L` / `4 .. 4+2L`;
flash `ScaleSpellEffect(L,S)*1.5 .. ×2`; fire wall/lightning wall `2L+4 .. 2L+40`; fireball `Scale(2L+4) .. Scale(2L+40)`;
guardian `Scale(L/2+1) .. +9`; flame wave `6(L+1) .. +54`; nova `Scale((L+5)/2)*5 .. Scale((L+30)/2)*5`; inferno `3 ..
1.5(L+4)`; golem `11..17`; apocalypse `L .. 6L`; elemental `Scale(2L+4) .. Scale(2L+40)`; blood star `Mag/2 + 3S − Mag/8`;
healing `L+S+1 .. 4L+6S+10` (× class).

### Reference tuning values (spelldat.tsv, base-mode rows)

| Spell | book | staff | mana | element/flags | bookLvl | staffLvl | minMag | manaMult | minMana | charges |
|---|---|---|---|---|---|---|---|---|---|---|
| fire bolt | 1000 | 50 | 6 | Fire,T | 1 | 1 | 15 | 1 | 3 | 40-80 |
| healing | 1000 | 50 | 5 | Magic,Town | 1 | 1 | 17 | 3 | 1 | 20-40 |
| lightning | 3000 | 150 | 10 | Light,T | 4 | 3 | 20 | 1 | 6 | 20-60 |
| flash | 7500 | 500 | 30 | Light | 5 | 4 | 33 | 2 | 16 | 20-40 |
| identify | — | 100 | 13 | Magic,Town | — | — | 23 | 2 | 1 | 8-12 |
| fire wall | 6000 | 400 | 28 | Fire,T | 3 | 2 | 27 | 2 | 16 | 8-16 |
| town portal | 3000 | 200 | 35 | Magic,T | 3 | 3 | 20 | 3 | 18 | 8-12 |
| stone curse | 12000 | 800 | 60 | Magic,T | 6 | 5 | 51 | 3 | 40 | 8-16 |
| infravision | — | 600 | 40 | Magic | — | — | 36 | 5 | 20 | 0 |
| phasing | 3500 | 200 | 12 | Magic | 7 | 6 | 39 | 2 | 4 | 40-80 |
| mana shield | 16000 | 1200 | 33 | Magic | 6 | 5 | 25 | 0 | 33 | 4-10 |
| fireball | 8000 | 300 | 16 | Fire,T | 8 | 7 | 48 | 1 | 10 | 40-80 |
| guardian | 14000 | 950 | 50 | Fire,T | 9 | 8 | 61 | 2 | 30 | 16-32 |
| chain lightning | 11000 | 750 | 30 | Light | 8 | 7 | 54 | 1 | 18 | 20-60 |
| flame wave | 10000 | 650 | 35 | Fire,T | 9 | 8 | 54 | 3 | 20 | 20-40 |
| nova | 21000 | 1300 | 60 | Magic | — | 10 | 87 | 3 | 35 | 16-32 |
| inferno | 2000 | 100 | 11 | Fire,T | 3 | 2 | 20 | 1 | 6 | 20-40 |
| golem | 18000 | 1100 | 100 | Fire,T | 11 | 9 | 81 | 6 | 60 | 16-32 |
| rage (skill) | — | — | 15 | Magic | — | — | 0 | 1 | 1 | — |
| teleport | 20000 | 1250 | 35 | Magic,T | 14 | 12 | 105 | 3 | 15 | 16-32 |
| apocalypse | 30000 | 2000 | 150 | Fire | — | 15 | 149 | 6 | 90 | 8-12 |
| etherealize | 26000 | 1600 | 100 | Magic | — | — | 93 | 0 | 100 | 2-6 |
| item repair / staff recharge / trap disarm (skills) | — | — | 0 | Magic(Town for first two) | — | — | 255 | 0 | 0 | — |
| elemental | 10500 | 700 | 35 | Fire | 8 | 6 | 68 | 2 | 20 | 20-60 |
| charged bolt | 1000 | 50 | 6 | Light,T | 1 | 1 | 25 | 1 | 6 | 40-80 |
| holy bolt | 1000 | 50 | 7 | Magic,T | 1 | 1 | 20 | 1 | 3 | 40-80 |
| resurrect | 4000 | 250 | 20 | Magic,Town | — | 5 | 30 | 0 | 20 | 4-10 |
| telekinesis | 2500 | 200 | 15 | Magic | 2 | 2 | 33 | 2 | 8 | 20-40 |
| heal other | 1000 | 50 | 5 | Magic,Town | 1 | 1 | 17 | 3 | 1 | 20-40 |
| blood star | 27500 | 1800 | 25 | Magic | 14 | 13 | 70 | 2 | 14 | 20-60 |
| bone spirit | 11500 | 800 | 24 | Magic | 9 | 7 | 34 | 1 | 12 | 20-60 |

(T = targeted; Town = castable in town.) Expansion rows add mana-restore, magi, jester, lightning wall, immolation,
warp, reflect, berserk, ring of fire, search and five rune spells with the same column set.

Other constants: max spell level 15; spellbook UI 6 tabs × 7 entries (tab 0 slot 0 = class skill); hotkeys 12;
`ScaleSpellEffect` +12.5% per level; charged-bolt count `S/2+3`; mana shield reduction table S1..7 = 21,18,15,12,9,6,3
(reciprocal); golem AC 25; town portal radius 5; teleport radius 5; stone curse cap 15 levels.

### Smallest buildable chunks
1. **Spell data loader** (TSV → `SpellData`, element bits, flags). Done when: all rows parse; `bookCost()=×10`.
2. **Spell masks & `GetSpellBitmask`**, `IsValidSpell`, book/staff level getters with shareware exclusions. Done when: mask ops for id 52 work in u64.
3. **Effective spell level** (`GetSpellLevel`) with item add and floor 0. Done when: −1 item on a level-1 spell → unusable.
4. **`GetManaAmount`** with all special cases and class multiplier/minMana. Done when: healing at L10/S3 for the caster class = `5+20−6 = 19`.
5. **`CheckSpell` / `CanUseScroll` / `CanUseStaff` / town restriction**. Done when: each failure reason maps to the right speech line.
6. **Readied spell & hotkeys** (`EnsureValidReadiedSpell`, `SetSpeedSpell`, `ToggleSpell`, `IsValidSpeedSpell`). Done when: dropping the last scroll clears the readied scroll spell.
7. **Cast pipeline** (`CheckPlrSpell` targeting modes → command → `StartSpell` → `CastSpell` → `ConsumeSpell`). Done when: a fizzled teleport costs no mana.
8. **`ScaleSpellEffect` + `GenerateRndSum` helpers**. Done when: `Scale(100,8) == 256`.
9. **Bolt archetypes** (fire bolt, charged bolt, holy bolt, blood star) incl. speed scaling. Done when: damages match table.
10. **Beam/chain archetypes** (lightning, chain). Done when: chain hits all monsters in radius S+3.
11. **Explosive/homing** (fireball, elemental). Done when: elemental is half fireball.
12. **AoE** (flash, nova, apocalypse). Done when: apocalypse hits every monster in the 17×17 box once.
13. **Walls & waves** (fire wall, lightning wall, flame wave, inferno) with growth loops and durations. Done when: wall grows 7 ticks both arms and stops at obstacles.
14. **Summons** (guardian turret with duration, golem stats/replacement). Done when: casting golem twice kills the first.
15. **Movement** (teleport nearest ≤5, phasing ring 4–6, town portal placement & single-portal rule). Done when: phasing never lands within 3 tiles.
16. **Control effects** (stone curse, mana shield, etherealize, infravision, search, rage, reflect). Done when: rage penalty phase mirrors the buff phase.
17. **Healing family** (self, other, mana) with class multipliers. Done when: martial heal-other ×3.
18. **Utility cursor spells** (identify, repair, recharge, disarm, telekinesis, resurrect) and their click handlers. Done when: identify on an unidentified ring reveals affixes.
19. **Spellbook damage text** (`GetDamageAmt`). Done when: strings match the UI table.
20. **Scroll/rune consumption rules** (prefer clicked slot, else first match; runes count as scrolls of their spell). Done when: a belt scroll cast from the hotbar consumes exactly one.

### Pitfalls / design lessons
- Consume cost only after the missile successfully spawned ("fizzle" semantics) — otherwise blocked teleports/portals eat mana.
- Scrolls cast at level 0 is the simplest way to make them weaker than learned spells without separate tables.
- Compounding `+1/8 per level` keeps high-level spells meaningful but explodes past level 15 — that is why 15 is the cap.
- Heal formulas scale with *character* level (dice per level) so healing stays relevant for melee classes who never level the spell.
- Put element on the spell row; the cast animation, book cover and icon all derive from it.
- Keep "allowed in town" a flag; it prevents an entire class of griefing bugs in multiplayer.
- Staff charges live on the item; the player's `iSpells` mask is derived each `CalcPlrInv` — never store it.

---

## 7. Character & UI panels, HUD, cursor, overlays, text

### Purpose
The 640×128 bottom control panel (flasks, belt, buttons, info box, readied-spell button), the two 320×352 side panels
(left: character sheet / quest log / stash / vendor; right: inventory / spellbook), the speed-book spell hotbar, the
cursor & world hit-testing, item/monster hover text, QoL overlays (XP bar, floating damage numbers, monster health
bar, item name labels), the scrolling dialog text, chat messages, help screen and the Lua console.

### Key data structures
```
MainPanel   = { (screenW-640)/2, screenH-128, 640x128 }   ; SidePanelSize = 320x352
LeftPanel / RightPanel positions: centred pair when the screen is wider than 640+2*320, else flush to the edges;
  LeftPanel.y = RightPanel.y = (screenH - 352 - 128)/2 ; viewport height shrinks by 128 only on 640-wide screens
UiPanels { Main, Quest, Character, Spell, Inventory, Stash } → GetPanelPosition(panel, offset)
Flags: CharFlag, QuestLogIsOpen, IsStashOpen, IsVisualStoreOpen (left) ; invflag, SpellbookFlag (right) ;
       SpellSelectFlag (hotbar overlay), ChatFlag, DropGoldFlag, HelpFlag, qtextflag (dialog scroll), ChatLogFlag
InfoBoxRect = { 177,46, 288x64 } on the main panel ; InfoString/InfoColor ; FloatingInfoString (tooltip near item)
MainPanelButtonRect[8]: char {9,9 71x20}, quests {9,35}, map {9,75}, menu {9,101}, inv {560,9}, spells {560,35},
                        chat {87,91 33x32}, friendly-fire {527,91}
LevelButtonRect {40,-39, 41x22} ("Level Up" appears above the panel when statPoints>0)
BeltRect {205,5, 8*(28+1) x 28} ; SpellButtonRect {565,64, 56x56} ; large spell icon 56x56, small 37x38
CharPanelButtonRect[4] = {137, 138/166/195/223, 41x22} ("+" buttons)
Flask art: top dome rect {11,3 62x13} drawn above panel; body rect {0,16 88x69}; life at x=96/107, mana at x=464/475
Spellbook: 6 tabs x 7 entries ; tab button width 76 (61 expansion) ; entry pitch 43 px ; icons at (11, 18 + 43i)
Quest log: inner panel {32,26 280x300}, line height 12, max spacing 24
XP bar: 307 px wide bar at (panel center-155+3, panel bottom-9), 12-step gold/silver gradients
Floating numbers: deque {startPos, startOffset, endOffset ±140 px, text, expiry = now+2500 ms, lastMerge, style, id, reverse}
Item labels: {id, width, pos, text}; collision-resolved horizontally; height 11–16 px
Monster health bar: top centre at y=18, box art with 3 px border, resist/immune icons, per-player XP tags
Cursor ids: NONE, HAND, IDENTIFY, REPAIR, RECHARGE, DISARM, OIL, TELEKINESIS, RESURRECT, TELEPORT, HEALOTHER,
            HOURGLASS, FIRSTITEM + itemCursorId (item sprites double as cursors; each sprite width/height = grid size)
Hover state: pcursmonst, pcursitem, pcursinvitem (0..6 body, 7..46 grid, 47..54 belt), pcursstashitem, ObjectUnderCursor,
             PlayerUnderCursor, cursPosition (tile), pcursstoreitem/btn
Chat: 8 most recent PlayerMessage {time, style, text, prefixLength (gold "name (lvl N): "), lineHeight}; shown 10 s
Dialog text: word-wrapped to 543 px, 30-px font, line height 38 px, scroll speed = audioLength / (lines+5)*38 ms/px
```

### Algorithms & rules

**7.1 Main panel buttons** (`CheckMainPanelButton` / `…Up`): press flags a button; release inside the same rect
triggers: char → toggle char panel (closes quest/stash/vendor); quests → toggle quest log; map → toggle automap;
menu → game menu (when dead: load last save / exit / "restart in town" in MP); inv → toggle inventory (closes
spellbook, gold dialogs, stash, vendor); spells → toggle spellbook (closes inventory); chat; friendly-fire toggle (MP).
Hovering a button writes its name + "Hotkey: 'c'" etc. into the info box. Only 6 buttons in single player.

**7.2 Flasks** (`DrawLifeFlaskUpper/Lower`, `DrawManaFlask*`): fill percentage 0..81 (`hp*81/maxHp`); the 13-px
dome above the panel is drawn from the empty-flask sprite, then the filled portion overdrawn from the panel buffer
from `emptyRows = clamp(81 - pct, 0, 13)` down; the 69-px body inside the panel analogously with `filledRows =
clamp(pct, 0, 69)`. Optional numeric overlay `cur/max` coloured gold at full, white, red at 0.

**7.3 Belt** (`DrawInvBelt`): 8 cells; empty background re-blitted from the panel buffer; item sprite + quality-tinted
back (`InvDrawSlotBack`: palette shift to blue for magic, gold for unique, beige normal; orange when inspecting
another player), hover outline, hotkey label drawn above usable non-gold items (≤2 chars). Hover text via
`CheckInvHLight` (same routine as the inventory).

**7.4 Readied-spell button & speed-book** (`DrawSpell`, `DoSpeedBook`, `GetSpellListItems`): the 56×56 button shows the
readied spell icon with a tint by type (skill / spell / scroll / charges / invalid=greyed when unusable, in town, or
level 0) and the hotkey name. Clicking opens the **speed-book**: all castable spells laid out right-to-left, bottom-up
in rows of 10 icons starting at `(panel.x + 12 + 56*10, panel.y - 17)`, grouped by type in the order Skill, Spell,
Scroll, Charges (a row break between non-empty groups). Hovering sets the info box ("X Spell / Spell Level N",
"Scroll of X / N Scrolls", "Staff of X / N Charges", "Damages undead only" for holy bolt, hotkey name). Click
selects; F-keys (12 slots) bind/unbind the hovered entry (`SetSpeedSpell` toggles if same, clears duplicates).
Shift-click on the button clears the readied spell. The cursor is warped onto the current spell's icon when opening.

**7.5 Info box** (`DrawInfoBox`, `PrintInfo`): 288×64 centred text; line spacing shrinks with line count (18/12/6/3/0 px
extra for 1..5+ lines). Priority: panel hover text → held item ("N gold pieces" / "Requirements not met" / name in
quality colour) → ground item / object / monster (name; unique monsters gold with history text) / towner / player
("name", "class, Level N", "Hit Points a of b") / party portrait. **Floating tooltip** (`DrawFloatingInfoBox`):
same text drawn in a translucent box anchored above (or below if no room) the hovered inventory/belt/stash/vendor
item, centred on the item sprite, clamped to the screen.

**7.6 Item hover text** (`CheckInvHLight` → `PrintItemDetails`/`PrintItemDur`): name (quality colour; red if
unusable); weapons "damage: a-b  Dur: d/m" or "Indestructible"; armor "armor: n  Dur"; staves "Charges: c/m";
identified: one line per prefix and suffix power (`PrintItemPower` → "+N% to hit", "+N% damage", "Resist Fire: +N%
MAX" at 75, "Hit Points: +N", "spells are increased N levels", "fast attack", "knocks target back", etc.), uniques
add "unique item" and open the unique info window listing all powers; unidentified magic: "Not Identified";
requirements line "Required: N Str N Mag N Dex" in red when unmet; vendor repair mode appends the cost.

**7.7 Character sheet** (`panels/charpanel.cpp`): pre-rendered background with boxed fields; entries (label, position,
width): name, class, Level, Experience, Next level ("None" gold at cap), Base/Now headers, Strength/Magic/Dexterity/
Vitality (base in white, gold at cap; current blue if > base, red if <), Points to distribute (red), Gold,
Armor class (`GetArmor + 2*level`, blue/red by item AC bonus sign), Chance to hit (ranged formula if a bow is in the
left hand, melee otherwise, "%"), Damage `a-b` where
`a = iMinDam + iBonusDam*iMinDam/100 + damMod`, `damMod = iBonusDamMod + (bow && not ranged class ? damageMod/2 : damageMod)`,
Life max/current (max blue if items raised it; current red when < max), Mana max/current (0 and red with NoMana),
Resist magic/fire/lightning (blue >0, white 0, gold at 75 "MAX"). "+" buttons appear per attribute while
`statPoints > 0` and base < cap; click adds 1, shift-click adds `min(points, cap-base)`. Gamepad focus jumps to the
last raisable attribute.

**7.8 Spellbook** (`panels/spell_book.cpp`): right panel; page table 6×7 (tab 0 entry 0 is the class skill; pages 0–3
base spells, page 4 expansion spells); entries show icon (tinted by availability), name, "Skill" / "Staff (N charges)"
/ "Level N" + "Mana: N" + "Damage: a - b" / "Heals: a - b" / "Dmg: 1/3 target hp" / "Unusable". Clicking an icon readies
it (type = charges if from staff, skill if ability, else spell). Tabs at y=320 row; the 305-px tab strip is split by
button width with a 1-px gutter fix between tabs 2/3.

**7.9 Quest log** (`panels/quest_log.cpp`): active quests (with `_qlog`) sorted by book order, then finished quests
(gold text, unselectable) separated by a gap; line spacing stretches to fill 300 px up to 24 px; mouse/keys select;
Enter replays the quest's dialog text; the spinning-pentagram marker brackets the selected line.

**7.10 Cursor & world hit-test** (`CheckCursMove`): converts mouse to a tile (with "flipflag" for the half-tile
parity), clears hover state, then tries in order: pixel-precise sprite test over a 3×8 rendering-column window
(monsters/towners, players incl. corpses for resurrect, interactable objects, items), falling back to tile-region
tests (`SelectionRegion` Bottom/Middle/Top flags per sprite). Cursor sprite = item sprite when holding an item
(`NewCursor(item)` = `CURSOR_FIRSTITEM + itemCursorId`); switching from an item cursor to an action cursor first
tries to drop the held item. Half-size item sprites are pre-rendered (bilinear ½) for vendor/stash listings.

**7.11 QoL overlays**
- **XP bar**: `fill = 307 * (xp - prevThreshold) / (threshold - prevThreshold)`; the last pixel fades through a 12-step
  gradient proportional to the sub-pixel remainder; gold bar at max level; hover shows "Level N / Experience / Next
  Level / N to Level N+1".
- **Floating damage numbers**: `AddFloatingNumber(pos, offset, text, style, id, reverse)`; numbers with the same id
  within 100 ms **merge** (text replaced); each lives 2500 ms and drifts 140 px up (down when `reverse`, used for
  healing/mana); position = world→screen of the tile centre + offset, ×2 when zoomed; font by style flags.
- **Monster health bar**: for the hovered monster; `barWidth * hp / maxHp`; if hp > max (life-stealers) the bar turns
  blue and shows "×N" multiplier; name (gold unique, blue minion, white), border colour by monster class when the
  option is on (undead/demon/animal), resist/immune icons shown for uniques or after 15 kills of the type, per-player
  "who hit" XP tags in MP.
- **Item name labels** (hold a key or toggle): one label per visible floor item: text = name (or "N gold"), width =
  text + 4 px, anchored at the sprite's solid-centre column one tile above the tile; overlapping labels on the same
  row are pushed left/right iteratively using a per-row "used X" set; hovering a label targets the item.
- **Durability icons**: red/gold weapon/armor/shield/helm icons above the right end of the panel when durability ≤ 5.
- **Party panel** (MP): portrait frames (48×48 built from 12-px tiles) with 7-px HP bar (yellow when mana-shielded)
  and mana bar, red overlay when dead, right-click to inspect another player's sheet/inventory.
- **Level-up button**: "Level Up" text + button above the panel while points are unspent (hidden with char panel,
  speed-book, stores, gamepad).

**7.12 Text systems**
- **Dialog text** (`minitext.cpp`): word-wrapped at 543 px in the 30-px gold font; scrolls upward at
  `audioLengthMs / ((lines + 5) * 38)` ms per pixel starting 260 px below the window; closes when all lines scrolled.
- **Chat messages** (`plrmsg.cpp`): ring of 8; "name (lvl N): " prefix in gold; wrapped to `min(540, screenW-20 -
  open side panels)`; shown for 10 s (always while typing); hidden under 300 px width; all messages also go to a
  scrollable chat log window.
- **Help** (`help.cpp`): static paragraph list ("$" prefix = section header) word-wrapped to 565 px, 14/18-px lines,
  297-px panel with a 12-px scrollbar whose thumb position = `skipLines * length / (lines - visible)`.
- **Chat commands**: `/help`, `/arena N`, `/arenapot N`, `/inspect name`, `/seedinfo`, `/ping name`, plus `/lua`.
- **Console** (debug): 20-px lines, history, autocomplete (12 suggestions), scroll step 3 lines.
- **Gold split / stash withdraw dialogs**: numeric text input box 180×20 at panel offset (67,128), prompt wrapped to
  200 px, Enter confirms (0 = cancel), Esc cancels.

### Reference tuning values
| Element | Value |
|---|---|
| Main panel | 640×128 bottom-centre; side panels 320×352 |
| Info box | 288×64 at (177,46); line spacing table {18,12,6,3,0} |
| Flask fill | 0..81 units; dome 13 px, body 69 px |
| Belt | 8 × 28 px cells, 29 px pitch, origin (205,5) |
| Spell icons | large 56, small 37×38; speed-book rows of 10 |
| Hotkeys | 12 quick-spell slots |
| Spellbook | 6 tabs × 7 rows, row pitch 43 px, tab width 76/61 |
| Char sheet | 24-px fields, "+" buttons 41×22 at x=137 |
| XP bar | 307 px, gradient 12 steps |
| Floating numbers | 2.5 s life, 140 px travel, 100 ms merge window |
| Monster HP bar | y=18 centred, 3 px border, resist icons after 15 kills |
| Item labels | 4 px X gap, 2 px Y gap, 2 px text margin |
| Dur icons | thresholds 5 (gold) / 2 (red) |
| Chat | 8 messages, 10 s, width ≤ 540 |
| Dialog text | 543 px wrap, 38 px line, 260 px lead-in |
| Help | 565 px wrap, 297 px panel |

### Smallest buildable chunks
1. **Panel geometry & `GetPanelPosition`** for all layouts (centred wide, 640 narrow, gamepad split). Done when: all rects resolve for 640×480, 1280×720, 1920×1080.
2. **Main panel buffer & buttons** (press/release/hover text, dead-state subset, MP extras). Done when: each button toggles its panel and closes conflicting ones.
3. **Flask renderer** (dome + body, fill %) and optional numeric overlay. Done when: 50% HP shows 40 body rows.
4. **Belt widget** (draw, hover, hotkey labels, click routing to inventory logic). Done when: hover sets `pcursinvitem` 47..54.
5. **Readied-spell button + speed-book layout/selection/hotkey binding**. Done when: 23 spells wrap to 3 rows and the cursor warps to the selected icon.
6. **Info box & floating tooltip** with priority rules and anchor computation. Done when: tooltip flips below when near the top edge.
7. **Item detail text** (`PrintItemDetails/Dur/Power`, requirement line, unique window). Done when: all ~70 powers have a string.
8. **Character sheet** (static layout bake + dynamic fields + colour rules + "+" buttons incl. shift-all). Done when: AC shows `armor + 2*level` and damage respects the bow halving rule.
9. **Spellbook panel** (page table, availability tint, text lines, tab hit-test). Done when: a staff spell shows "Staff (N charges)".
10. **Quest log panel** (sort, spacing solver, selection, replay). Done when: 1 active + 3 finished quests render with the gap.
11. **Cursor system** (cursor ids, item-as-cursor, half-size sprites, hardware/software cursor switch). Done when: picking up an item changes the cursor sprite and size.
12. **World hit-test** (pixel-precise pass + tile-region fallback + player/corpse special cases). Done when: clicking a monster's head above its tile selects it.
13. **XP bar** with sub-pixel fade and hover text. Done when: bar is empty right after level-up and gold at 50.
14. **Floating numbers** with merge-by-id. Done when: rapid hits on one monster update one number.
15. **Monster health bar** incl. overflow multiplier and resist icons. Done when: a life-stealing monster at 250% shows blue ×2.
16. **Item name labels** with collision resolution and click-through targeting. Done when: 5 stacked potions get 5 non-overlapping labels.
17. **Durability warning icons**. Done when: icons stack right-to-left in head/chest/left/right order.
18. **Level-up button**. Done when: hidden under all documented conditions.
19. **Party panel** (MP) with inspect. Done when: right-click opens the other player's sheet read-only.
20. **Dialog text scroller** tied to audio length. Done when: last two lines remain when audio ends.
21. **Chat message ring + chat log + commands**. Done when: messages expire at 10 s unless typing.
22. **Help screen with scrollbar**. Done when: thumb reaches the bottom on the last page.
23. **Numeric input dialogs** (gold split / withdraw). Done when: max is enforced and Enter with 0 cancels.
24. **Death screen & pause tint** (`DrawDeathText`, `RedBack`). Done when: text differs for SP-with-save / SP / MP.

### Pitfalls / design lessons
- Bake static panel art + labels into one surface at load; redraw only dynamic fields each frame (the engine
  pre-renders the whole character sheet background including field boxes).
- Keep a single `InfoString` with a priority chain rather than many widgets writing competing text.
- Tooltips anchored to the item sprite centre, flipping above/below, beat a cursor-following tooltip in a 28-px grid.
- Pixel-precise hit testing over a small window of rendering columns (3×8) with a tile-region fallback gives both
  accuracy and determinism (fallback is what MP/replays use).
- Item-sprite-as-cursor means grid footprint and cursor art are the same asset — fewer tables, but item sprites must
  be exact multiples of the cell size.
- Floating-number merging (100 ms window per source) prevents number spam from multi-hit attacks.
- Label de-overlap only needs horizontal pushing within the same text row; vertical stacking looks worse at this tile size.
- Make every QoL overlay an option with a change callback that loads/frees its art, so the base UI never depends on them.

---

## Cross-system notes for a new game

1. **Tick-locked design**: 20 Hz logic, animation-frame-indexed combat, fixed-point life. Pick these first; everything
   else (speed affixes, stagger, walk timing) is expressed in ticks/frames.
2. **Data-driven classes**: one folder per class with attributes/loadout/animations/sprites/sounds TSVs; the engine
   has no class `switch` except a handful of flagged behaviours (`CriticalStrike`, `DualWield`, `IronSkin`,
   `NaturalResistance`, `TrapSense`) and a few per-class damage-mod divisors — move those into data too.
3. **Deterministic items**: `(base, ilvl, seed, flags)` → item. Build the RNG discipline before the affix tables.
4. **Derived stats are recomputed, never patched**: `CalcPlrInv` after any equipment/stat/buff change.
5. **Spell = data row + missile archetype**: ~12 archetypes cover 50 spells.
6. **UI = flags + rectangles**: panels are toggled booleans with closing rules; hit-testing is rectangle lists in
   panel-local coordinates; text goes through one info-box channel.

---

## Appendix A — Worked examples (sanity checks for a reimplementation)

### A.1 Level-1 melee class creation
```
baseStr 30, baseMag 10, baseDex 20, baseVit 25
life = adjLife 18 + lvlLife 2*1 + chrLife 2*25 = 70      → hp = maxHp = hpBase = maxHpBase = 70.0
mana = adjMana -1 + lvlMana 1*1 + chrMana 1*10 = 10      → mana fields = 10.0
melee to-hit  = level 1 + Dex 20/2 + 0 + 70 = 81 %        (vs monster AC subtracted at roll time)
ranged to-hit = 1 + 20 + 0 + 60 = 81 %
block chance  = Dex 20 + 30 + 2*1 = 52 % (minus 2×attacker level)
armor         = 0 + buckler AC(3) + Dex/5 (4) = 7 ; sheet shows 7 + 2*1 = 9
damage mod    = level*Str/100 = 0 ; short sword 2-6 → sheet "2-6"
```
### A.2 Level 20 ranged class with a 1-10 long battle bow, +Dex items +15
```
Str 20 (cap 55 base), Dex 30 base + stat points … suppose current Dex 120, Str 40
damageMod = 20*(40+120)/200 = 16    → sheet damage (bow, ranged class → full damageMod): 1+16 .. 10+16 = 17-26
ranged to-hit = 20 + 120 + items + 70 = 210 → clamped per roll to 95% after AC subtraction
```
### A.3 Normal monster drop at monster level 12 (seed fixed)
```
RndItemForMonsterLevel(12): rand(100)=57 → ≤40? no → nothing dropped       (59% branch)
--- another seed ---
rand(100)=10 → drop ; rand(100)=80 → >25 → gold ; GetItemAttrs(gold, ilvl): v = 5*dlvl + rand(10*dlvl)
--- another seed, item branch ---
weighted pick among bases with minMonsterLevel ≤ 12 (bows weight 2) → e.g. a large axe
SetupAllItems(lvl=12, uper=1, onlyGood=false):
  GetItemBLevel: rand(100) ≤ 10 ? / rand(100) ≤ 12 ? → suppose yes → iblvl = 12
  CheckUnique: rand(100) > 1 → no unique (98%)
  GetItemBonus(6, 12, onlyGood=false):
     prefix? rand(4)==0 → no ; suffix? rand(3)!=0 → yes ; onlyGood forced true with 2/3
     suffix pool: Weapon-slot suffixes with minLevel 6..12 & useful: +dmg 3-5 @7, +Str 6-10 @5? (no: 5<6) …
       eligible (minLevel∈[6,12]): flat dmg 3-5@7, GetHit? (armor only), Str 11-15@11, Dex 11-15@11, Mag 11-15@11,
       Vit 11-15@11 (Good), all-attr 4-7@11, durability 51-100@6, 101-200@12, light +4@8, steal mana 3%@8,
       steal life 3%@8, armor pierce 4-12@9, attack speed fast@10, knockback? (@5 no), thorns? (armor)…
     pick uniformly (weights all 1) → e.g. Str 11-15: r = 11 + rand(5) = 13 ; PLVal → 2200 + 800*(100*2/4)/100 = 2600
     VAdd1 = 2600, VMult1 = 4 → identifiedValue = 2600 + 4*750 = 5600 ; name "Large Axe of <Str tier 3>"
  ItemRndDur: maxDur 40 → dur = rand(20) + 10 + 1 ∈ [11, 30]
```
### A.4 Mana shield absorbing a 100-point hit at shield level 3 with 50 mana
```
R = 24 - 3*3 = 15 ; dam = 100 + 100/-15 = 100 - 6 = 94
mana 50 < 94 → dam = 94 - 50 = 44 ; dam += 44/(15-1) = 44 + 3 = 47 ; mana = 0 ; shield off
hp -= 47
```
### A.5 Fireball at character level 20, spell level 5
```
base = 2*(20 + rand2(0..9)) + 4 ∈ [44, 80] ; ScaleSpellEffect(base, 5): ×(9/8)^5 (integer, per step) ≈ ×1.76 → [77, 141]
speed = 16 + min(10, 34) = 26 ; mana = (16 - (5-1)*1) * classMult = 12 (caster) / 9 (0.75 classes); minMana 10 → 10
```

## Appendix B — Item effect application reference (power → fields)

| Effect | param use | Fields written | Tooltip template |
|---|---|---|---|
| ToHit / ToHit-curse | r=rand(p1..p2) | `PLToHit ±= r` | "{:+d}% to hit" |
| Dam% / Dam%-curse | r | `PLDam ±= r` | "{:+d}% damage" |
| ToHit&Dam% (±) | r (dam), table(p1) (hit) | `PLDam ±= r; PLToHit += toHitBonus(±p1)` | "to hit: {:+d}%, {:+d}% damage" |
| AC% (±) | r | `PLAC ±= r` (applied as `AC*PLAC/100`, min ±1) | "{:+d}% armor" |
| SetAC / AC-curse | r | `AC = r` / `AC -= r` | "armor class: {:d}" |
| Fire/Light/Magic res (±) | r | `PLFR/PLLR/PLMR ±= r` | "Resist Fire: {:+d}%" (" MAX" at 75) |
| AllRes | r | all three `= max(x + r, 0)` | "Resist All: {:+d}%" |
| SpellLevelAdd | r | `SplLvlAdd = r` | "spells are increased N levels" |
| Charges× | p1 | `charges *= p1; max = charges` | "Extra charges" |
| FixedSpell | p1 spell, p2 charges | `spell=p1; charges=max=p2` | "{N} {spell} charges" |
| FireDam / LightDam | p1..p2 | element flag, min/max; clears other element | "Fire hit damage: a-b" |
| Str/Mag/Dex/Vit (±) | r | `PLStr…±= r` | "{:+d} to strength" |
| AllAttribs (±) | r | all four `±= r` | "{:+d} to all attributes" |
| GetHit (good) / GetHit-curse | r | `PLGetHit -= r` / `+= r` | "{:+d} damage from enemies" |
| Life / Mana (±) | r | `PLHP/PLMana ±= r` (10.6) | "Hit Points: {:+d}" / "Mana: {:+d}" |
| Dur | r % | `max += r*max/100; dur += same` | "high durability" |
| Dur-curse | r % | `max -= r*max/100 (≥1); dur = max` | "decreased durability" |
| Indestructible | — | `dur = max = 255` | "indestructible" |
| Light (±) | p1 | `PLLight ±= p1` | "+{10*N}% light radius" |
| MultArrows | — | flag | "multiple arrows per shot" |
| FireArrows / LightArrows | p1..p2 | arrow flag + element damage flag, min/max | "fire arrows damage: a-b" |
| Fireball-on-hit | p1..p2 | both arrow flags, fire min/max | "fireball damage: a-b" |
| Thorns | — | flag | "attacker takes 1-3 damage" |
| NoMana | — | flag | "user loses all mana" |
| HalfTrap | — | flag | "absorbs half of trap damage" |
| Knockback | — | flag | "knocks target back" |
| 3×Demon | — | flag | "+200% damage vs. demons" |
| AllResZero | — | flag | "All Resistance equals 0" |
| StealMana / StealLife | p1 ∈ {3,5} | flag 3% or 5% | "hit steals 3% mana" |
| TargetAC | r (base) / p1 (exp) | `PLEnAc` | "penetrates target's armor" |
| FastAttack | p1 1..4 | Quick/Fast/Faster/Fastest flag | "quick/fast/faster/fastest attack" |
| FastRecover | p1 1..3 | Fast/Faster/Fastest recovery flag | "fast hit recovery" |
| FastBlock | — | flag | "fast block" |
| DamMod | r | `PLDamMod += r` | "adds N points to damage" |
| RandArrowVel | — | flag | "fires random speed arrows" |
| SetDam | p1,p2 | `minDam=p1; maxDam=p2` | "unusual item damage" |
| SetDur | p1 | `dur = max = p1` | "altered durability" |
| OneHand | — | `equipType = OneHand` | "one handed sword" |
| DrainLife | — | flag | "constantly lose hit points" |
| RandStealLife | — | flag | "life stealing" |
| NoMinStr | — | `minStr = 0` | "no strength requirement" |
| AddACLife | p1,p2 | arrow flags, fire min/max, LMin=1 | "lightning damage: a-b" |
| AddManaAC | p1,p2 | element flags, fire min/max, LMin=2 | "charged bolts on hits" |
| Devastation / Decay(+r dam%) / Peril / Jesters / Doppelganger / ACvsDemon / ACvsUndead | — | expansion flags | "occasional triple damage" / "decaying {:+d}% damage" / "2x dmg to monst, 1x to you" / "Random 0 - 600% damage" / … |
| Crystalline | r | `PLDam += 140 + 2r` then Dur-curse | "low dur, {:+d}% damage" |
| ManaToLife | — | `PLMana -= 50% ownerMaxManaBase; PLHP += same` | "50% Mana moved to Health" |
| LifeToMana | — | `PLHP -= 40% ownerMaxHPBase; PLMana += same` | "40% Health moved to Mana" |

## Appendix C — Unique item table (genericized; 91 rows, in data order)

Columns: base-type role, min item level, value, powers (effect p1[-p2]). Names and cursor overrides omitted.
"2h-capable sword" rows are swords whose unique power makes them one-handed.

| # | Base | lvl | Value | Powers |
|---|---|---|---|---|
| U1 | quest cleaver (axe) | 1 | 3650 | Str +10; SetDam 4-24; SetDur 10 |
| U2 | quest crown (helm) | 1 | 16650 | RandStealLife; SetAC 8 |
| U3 | quest ring | 1 | 8000 | AllAttribs +2; Light +2; FastRecover 1; HalfTrap |
| U4 | quest amulet | 1 | 9750 | Light +2; LightRes +20; GetHit −1; Mag +5 |
| U5 | quest ring | 1 | 9100 | Life +10; GetHit −1; AllRes +10 |
| U6 | quest helm | 1 | 4000 | AC −3; GetHit −1; AllAttribs +2; Life +7; Mana +7 |
| U7 | quest great helm | 1 | 63800 | AllRes +50; Light −2; AC% +60; Mana −30; Str +15; Vit +15 |
| U8 | quest medium armor | 1 | 42000 | SetAC 25; Vit +10; GetHit −3; FastRecover 3 |
| U9 | quest broad sword | 1 | 42000 | FireDam 1-10; ToHit +25; FastAttack 2; Knockback; Mana +20; Life −20 |
| U10 | quest heavy armor | 1 | 26675 | Light +4; Dam% +150; ToHit +25; FireDam 10-20; Indestructible; AllAttribs +8 |
| U11 | short bow | 1 | 1800 | RandArrowVel; DamMod +2; Dex −3 |
| U12 | short bow | 2 | 8900 | ToHit +50; SetDam 1-3; FastAttack 2 |
| U13 | long bow | 2 | 1200 | NoMinStr; DamMod +2; SetAC 5 |
| U14 | composite bow | 3 | 8750 | 3×Demon; ToHit +20; Mag −5 |
| U15 | composite bow | 5 | 2500 | ToHit +10; Dex +4; Vit −3; Light −2; SetDur 30 |
| U16 | long bow | 5 | 2500 | Dex +10; Vit −10; Dam% +50; Light −1 |
| U17 | hunter bow | 10 | 14250 | FireArrows 1-6; ToHit +20; FireRes +40 |
| U18 | long bow | 13 | 16500 | Dex +15; ToHit +40; Dam% +80; Dur +6% |
| U19 | war bow | 17 | 37750 | Str +5; Dam% +200; Knockback |
| U20 | battle bow | 26 | 42500 | Dex +20; ToHit +50; Dam% +100; Indestructible |
| U21 | dagger | 1 | 7040 | Dex −5; DamMod +4; FastAttack 2; FireRes +25 |
| U22 | sabre | 1 | 2000 | SetAC 5; Vit +5; ToHit −5 |
| U23 | falchion | 1 | 1000 | Dam% +100; Mag −2; Dex −5 |
| U24 | dagger | 1 | 2000 | Dam% +150; Vit +2; SetDur 5 |
| U25 | broad sword | 2 | 6660 | AllAttribs +2; Dam% +25; Mana +15; Light −3 |
| U26 | long sword | 3 | 5250 | FireRes +40; SetDur 15; Str +5-10 |
| U27 | falchion | 3 | 7080 | Dam% +150; Life −10; Light −1; Dur +200% |
| U28 | claymore | 6 | 4400 | DamMod +10; Str +10; Mag −5; Dex −5; Life +10; Mana −10 |
| U29 | broad sword | 8 | 13750 | Light −2; StealLife 5%; ToHit +15; AllRes +5 |
| U30 | dagger | 11 | 12920 | Mag +15; Mana +35; ToHit +25; AllRes +15 |
| U31 | sabre | 13 | 19150 | Light +2; LightDam 1-10; ToHit +20; LightRes +50 |
| U32 | scimitar | 15 | 7867 | FastAttack 4; ToHit +20; Dam% −33; Dex +10 |
| U33 | long sword | 17 | 34600 | FireDam 2-12; Light +3; Mana +20; FireRes +80 |
| U34 | bastard sword | 19 | 18250 | ToHit +25; Dam% +250; AllAttribs −5; Life −25; Light −2 |
| U35 | two-handed sword | 23 | 50000 | Str +20; Vit −5; Dam% +200; Knockback; Dur +100% |
| U36 | great sword | 27 | 119800 | OneHand; AllAttribs +5; ToHit +20; Dam% +70; Life +20 |
| U37 | large axe | 2 | 2850 | Dam% +200; Dex −5; Mag −5; Mana −10 |
| U38 | large axe | 2 | 2850 | Life +20; Mag −10; Mana −10 |
| U39 | broad axe | 3 | 2500 | Dam% +100; 3×Demon; AllAttribs −5; SpellLevel −1 |
| U40 | battle axe | 4 | 14100 | NoMinStr; ToHit +15; Life +15; Str −15 |
| U41 | large axe | 5 | 31150 | ToHit +30; Dex +10; Vit −10; GetHit −1-6; Indestructible |
| U42 | broad axe | 7 | 23900 | Life +30; ToHit +20; Dam% +50; LightRes +40 |
| U43 | small axe | 12 | 24800 | SpellLevel +1; Mag +10; MagicRes +80 |
| U44 | battle axe | 15 | 26200 | Str +8; Vit +8; Dam% +100; Life +25; Mana −25 |
| U45 | great axe | 25 | 58000 | Dam% +200; DamMod +15; AllAttribs +5; Life −50; FireDam 2-12 |
| U46 | mace | 1 | 11375 | AllAttribs +2; Indestructible; AllRes +15; Dam% +50; SpellLevel −1 |
| U47 | maul | 1 | 8700 | SetDam 4-10; Indestructible; Str +3; ToHit +15 |
| U48 | mace | 1 | 2000 | 3×Demon; Dex −5; Mag −2 |
| U49 | flail | 2 | 7810 | NoMinStr; Light +2; DamMod +10; AC −8 |
| U50 | morning star | 5 | 6850 | ToHit +12; Dam% +80; FastAttack 1; Vit +4; Dex −4; SetDur 60 |
| U51 | spiked club | 9 | 9820 | ToHit +20; Dam% +300; Dex +10; Mag +5; AllRes +10; AC −10 |
| U52 | maul | 12 | 36500 | DamMod +20; Str +15; Indestructible; Mana −150; AllRes +5 |
| U53 | war hammer | 16 | 56125 | Dam% −100; LightDam 1-50; Life +50; ToHit +30; LightRes +80; Light +1 |
| U54 | mace | 26 | 26450 | Mag +30; Mana +50; MagicRes +50; Light +2; SpellLevel +1 |
| U55 | long staff | 2 | 1250 | Mag −10; ToHit +10; Dam% +60; Light −2; FastAttack 1 |
| U56 | long staff | 4 | 3900 | FireRes +20; FireDam 4-4; Mana +10; Vit −5 |
| U57 | war staff | 8 | 22500 | LightRes +50; LightDam 2-8; Str +10; Mag −10 |
| U58 | short staff | 8 | 6520 | Mana +25; Str −3; Vit −3; FixedSpell(spell 10, 76 charges) |
| U59 | composite staff | 14 | 22250 | ToHit +35; LightDam 1-10; FixedSpell(spell 3, 76); LightRes +30; Light +2 |
| U60 | short staff | 16 | 17240 | Vit +5; GetHit −5; SetAC 40; FixedSpell(spell 2, 86); Thorns |
| U61 | long staff | 18 | 34000 | Mag +20; Dex +10; AllRes +20; FixedSpell(spell 23, 57); Life −25 |
| U62 | quarter staff | 20 | 41500 | Mag +15; FixedSpell(spell 13, 69); AllRes +15; SpellLevel +1 |
| U63 | war staff | 22 | 44167 | FixedSpell(spell 21, 50); Dam% +100; AllAttribs +5 |
| U64 | helm | 1 | 7525 | StealLife 5% |
| U65 | skull cap | 6 | 2020 | Mana +30; SpellLevel +2; AllRes +20; SetDur 1 |
| U66 | helm | 7 | 12500 | Str +20; Dex +15; Vit +5; Mag −20; SetDur 15 |
| U67 | helm | 12 | 10150 | AllAttribs −4; Life +100; GetHit +1-6 (curse); Thorns |
| U68 | great helm | 21 | 54900 | AllAttribs +20; SetAC 60; GetHit −4; AllResZero; Light −4 |
| U69 | crown | 27 | 24875 | AllAttribs +10; Mana +40; SetAC 40; Light +1 |
| U70 | rags | 2 | 4825 | SetAC 8; Vit +10; GetHit −1; Indestructible |
| U71 | studded leather | 6 | 3450 | SetAC 25; GetHit −2; Dur +200%; AllAttribs −3 |
| U72 | cloak | 2 | 4900 | SetAC 10; AllAttribs +1; AllRes +10; Life +5; Dur +50% |
| U73 | leather armor | 4 | 10550 | SetAC 15; Str +5; Mag −5; Dex +5; Indestructible |
| U74 | robe | 5 | 6200 | Mag +5; Mana +10; LightRes +25; SetAC 15; GetHit −1 |
| U75 | chain mail | 9 | 15750 | SetAC 30; LightDam 1-10 |
| U76 | breast plate | 13 | 14000 | GetHit −15; AC −30; Dex +5; LightRes +40 |
| U77 | cape | 16 | 11600 | FastRecover 2; Light −4; SetAC 15; Dex +3; AllRes +20 |
| U78 | plate mail | 19 | 78700 | NoMinStr; Mag +5; Mana +20; AllRes +20; SpellLevel +1 |
| U79 | full plate | 25 | 251175 | SetAC 100; GetHit −6; Str +10; Indestructible; FireRes +50 |
| U80 | buckler | 1 | 1500 | SetAC 7; AllRes +10; Dam% −20; ToHit −5 |
| U81 | buckler | 1 | 2025 | SetAC 10; Life +10; Str +2; Light −1; SetDur 15 |
| U82 | kite shield | 2 | 19200 | FireRes +25; Str +5; SetAC 20; Mag −5; Indestructible |
| U83 | small shield | 4 | 5725 | Dex +10; Vit −10; SetAC 18; Light −1; Dur +150% |
| U84 | large shield | 10 | 13800 | SetAC 15; GetHit −2; FireRes +20; Dur +200%; FastBlock |
| U85 | gothic shield | 24 | 49000 | SetAC 40; GetHit +4 (curse); Str +10; Indestructible; FastBlock; LightRes +50 |
| U86 | ring | 1 | 1000 | AllAttribs −2; DamMod +3; Mana +10 |
| U87 | ring | 1 | 4175 | Mag +10; MagicRes +10; Light +1; Str −3; Dex −3 |
| U88 | ring | 2 | 8500 | MagicRes +20; Mana +30; Life −10 |
| U89 | ring | 5 | 62000 | AllRes +75; DrainLife |
| U90 | ring | 11 | 12476 | GetHit −1-2; Thorns; SetAC 5; TargetAC 2 |
| U91 | (expansion rows continue with the same schema) | | | |

Design takeaway: uniques trade one strong stat for one visible curse at low levels; mid/high levels combine 4–6
moderate powers; "SetAC"/"SetDam"/"SetDur" let a low base be a high-level unique.

## Appendix D — Inventory & belt slot rectangles (panel-local, px)

| Slot id | Role | x | y | w | h |
|---|---|---|---|---|---|
| 0 | head | 132 | 2 | 58 | 59 |
| 1 | left ring | 47 | 177 | 28 | 29 |
| 2 | right ring | 248 | 177 | 28 | 29 |
| 3 | amulet | 205 | 32 | 28 | 29 |
| 4 | left hand | 17 | 75 | 58 | 86 |
| 5 | right hand | 248 | 75 | 58 | 87 |
| 6 | chest | 132 | 75 | 58 | 87 |
| 7–16 | grid row 1 | 17 + 29·c | 222 | 29 | 29 |
| 17–26 | grid row 2 | 17 + 29·c | 251 | 29 | 29 |
| 27–36 | grid row 3 | 17 + 29·c | 280 | 29 | 29 |
| 37–46 | grid row 4 | 17 + 29·c | 309 | 29 | 29 |
| 47–54 | belt (main panel) | 205 + 29·i | 5 | 29 | 29 |

Equipment draw anchors (sprite bottom-left): head (133,59), left ring (48,205), right ring (249,205), amulet
(205,60), left hand (17,160), right hand (248,160), chest (133,160); 1-cell-wide hand items are shifted +14 px,
2-cell-tall ones −14 px to centre them in the 2×3 slot. Stash cells: `(17,48) + slot*29`. Vendor grid uses the same
29-px pitch.

## Appendix E — Save/network record layouts (field lists only)

**ItemPack (19 bytes, little-endian)**: `seed u32 | createInfo u16 | idx u16 (0xFFFF = empty) | bId u8 = quality<<1 |
identified | dur u8 | maxDur u8 (255 indestructible, 254 if >255) | charges u8 | maxCharges u8 | value u16 (gold only) |
dwBuff u32`. Trophy item: name bytes are smeared across seed/createInfo/bId/dur/…/dwBuff.

**PlayerPack (vanilla-compatible)**: `lowDateTime u32, highDateTime u32, destAction i8, destParam1 i8, destParam2 i8,
dungeonLevel u8, x u8, y u8, targx u8, targy u8, name[32], class u8, baseStr u8, baseMag u8, baseDex u8, baseVit u8,
level u8, statPts u8, experience u32, gold i32, hpBase i32 (raw 26.6), maxHpBase i32, manaBase i32, maxManaBase i32,
splLvl[37] u8, memSpells u64, InvBody[7] ItemPack, InvList[40] ItemPack, InvGrid[40] i8, numInv u8, SpdList[8]
ItemPack, townWarps i8, dungMsgs i8, lvlLoad i8, battleNet u8, manaShield u8, dungMsgs2 u8, isExpansion i8,
reserved u8, reflections u16, reserved2[2], splLvl2[10] u8 (expansion spells), reserved i16, bossKillLevel u32,
difficulty u32, damAcFlags u32, reserved3[20]`.

**PlayerNetPack (join/sync)**: as above minus timestamps/gold/town flags, plus `dir, friendlyMode, isOnSetLevel`,
`splLvl[52]`, and a validation block of derived values `Str, Mag, Dex, Vit, hp, maxHp, mana, maxMana, damageMod,
baseToBlock, iMinDam, iMaxDam, iAC, iBonusDam, iBonusToHit, iBonusAC, iBonusDamMod, iGetHit, iEnAc, iFMin/MaxDam,
iLMin/MaxDam` (all i32) that the receiver recomputes and compares.

**Stash**: per page sparse 10×10 u16 grids + item vector + gold int, stored in a separate shared file.

## Appendix F — Spellbook page layout (6 tabs × 7 rows)

| Tab | Rows 0..6 |
|---|---|
| 0 | class skill, fire bolt, charged bolt, holy bolt, healing, heal other, inferno |
| 1 | resurrect, fire wall, telekinesis, lightning, town portal, flash, stone curse |
| 2 | phasing, mana shield, elemental, fireball, flame wave, chain lightning, guardian |
| 3 | nova, golem, teleport, apocalypse, bone spirit, blood star, etherealize |
| 4 (expansion) | lightning wall, immolation, warp, reflect, berserk, ring of fire, search |
| 5 | unused |

Entry rendering: icon at (11, 18 + 43·row) 37×38, name at x=11+56 line 0, "Level N" right-aligned line 0,
"Mana: N" line 1 left, damage/heal text line 1 right; readied spell gets a highlighted icon border.

## Appendix G — Drop ("flip") animation frame counts per item sprite family

armor 15, axe 13, potion 16, bow 13, gold 10, helmet 13, mace 13, shield 13, sword 13, rock 20, cleaver 13, staff 13,
ring 13, crown 13, light armor 13, war shield 13, scroll 13, plate 13, book 13, food 1, coloured potions 16 ×8,
ear 13, brain 12, mushroom 12, sign 13, blood stone 13, anvil 13, special staff 8, bombs 10, half/whole pieces 16,
runes 10, toy 10, animals 15. The item is selectable only once the flip finishes (`selectionRegion = Bottom`).

## Appendix H — Checklist of RNG consumption order (needed for reproducible items)

```
SetupAllItems:
  SetRndSeed(seed)
  GetItemAttrs:           1 roll  AC                          (always, even for 0-0 ranges)
                          +book: 1 roll spell index ; +oil (exp): 1 roll ; +gold: 1 roll amount
  GetItemBLevel:          2 rolls (≤10 test, ≤lvl test)  [short-circuit: second roll skipped if first passes]
  CheckUnique:            1 roll (uper test) ; if passed and candidates exist: 1 discarded roll
  GetItemBonus/GetItemPower:
                          1 roll prefix?(4) ; 1 roll suffix?(3) ; [1 roll coin if neither]
                          [1 roll onlyGood?(3) if not already] ; 1 roll prefix pick ; power roll(s) ; 1 roll suffix pick ; power roll(s)
  staff path:             1 roll spell index ; 1 roll charges ; GetStaffPower: 1 roll (10) ; [1 roll pick ; power roll]
  ItemRndDur:             1 roll (non-unique only)
```
Any new feature inserted into this chain must consume RNG *after* the existing rolls or be seeded separately,
otherwise every saved item changes identity (the engine uses `DiscardRandomValues` to keep legacy parity).

## Appendix I — Pseudo-code of the load-bearing routines

### I.1 Per-tick player processing
```
ProcessPlayers():
    me.lvlLoadCountdown-- if > 0
    ValidatePlayer()
    for p in players if active && onThisLevel && (p is me || !p.lvlChanging):
        if p.hp <= 0 && mode not in {DEATH, QUIT, NEWLVL}: Kill(p, Unknown)
        if p is me: if DrainLife flag && !town: ApplyDamage(p, 4/64)
                    if p.manaShield && NoMana flag: send RemoveShield
        repeat:
            finished = switch mode:
                STAND|NEWLVL|QUIT -> false
                WALK_*  -> DoWalk(p)
                ATTACK  -> DoAttack(p)
                RATTACK -> DoRangeAttack(p)
                BLOCK   -> DoBlock(p)
                SPELL   -> DoSpell(p)
                GOTHIT  -> DoGotHit(p)
                DEATH   -> DoDeath(p)
            CheckNewPath(p, finished)          # may start the next action immediately
        until !finished
        p.previewSprite = none
        if !(mode == DEATH && frozenCorpse): p.anim.processAnimation()
```
### I.2 Action dispatch (condensed)
```
CheckNewPath(p, chained):
    target = resolve destAction target (monster/player/object/item); dead monster/player -> Stop(); return
    if walkpath[0] != NONE and mode == STAND:
        if me && destAction in {ATTACKMON, ATTACKPLR} && chebyshev(future, target.future) < 2:
            ClrPath(); StartAttack(dir to target) (or talk if monster is a talker); destAction = NONE
        StartWalk(walkpath[0]); shift walkpath; if still STAND (blocked): StartStand; destAction = NONE
        return
    if destAction == NONE: return
    if mode == STAND:
        switch destAction:
            ATTACK xy        -> StartAttack(dir(tile, xy))
            ATTACKMON/PLR    -> if adjacent: StartAttack(dir(future, t.future))
            RATTACK xy/MON/PLR -> StartRangeAttack(dir, target tile)
            SPELL xy / SPELLWALL(dir param) / SPELLMON / SPELLPLR -> StartSpell(dir, target)
            OPERATE/DISARM   -> if adjacent: breakable ? StartAttack : (disarm?) TryDisarm ; OperateObject
            OPERATETK        -> OperateObject (no adjacency)
            PICKUPITEM / PICKUPAITEM -> if adjacent && hand cursor: send RequestItem / RequestAutoItem
            TALK             -> TalkToTowner
        FixPlayerLocation(dir); destAction = NONE; return
    if mode == ATTACK && frame >= AFNum:   re-trigger ATTACK/ATTACKMON/ATTACKPLR/OPERATE(breakable)
    if mode == RATTACK && frame >= AFNum:  re-trigger ranged
    if mode == SPELL && frame >= SFNum:    re-trigger spell
```
### I.3 Melee hit (condensed)
```
PlrHitMonst(p, m, cleave=false) -> bool:
    if !m.isPossibleToHit(): return false
    hper = cleave ? -( level>20 ? 30 : (35-level)*2 ) : 0
    hit  = m.petrified ? 0 : rand(100)
    hper += p.GetMeleePiercingToHit() - p.CalculateArmorPierce(m.AC, melee=true)
    hper = clamp(hper, 5, 95)
    if m.tryLiftGargoyle(): return true           # special monster state, counts as a hit
    if hit >= hper: return false
    [expansion & both elements: spawn spectral arrow with rand(FMin..FMax)]
    dam = rand(iMinDam..iMaxDam); dam += dam*iBonusDam/100; dam += iBonusDamMod; dam2 = dam<<6; dam += damageMod
    if CriticalStrike && rand(100) < level: dam *= 2
    weapon-class table (undead/animal/demon) ; expansion flags (devastation 5% x3, doppelganger 10%)
    dam <<= 6 ; jesters: dam = dam*r/100 (r 0..600) ; if cleave: dam >>= 2
    if me: peril: ApplyDamage(self, dam2 + iGetHit, minHP 1), dam *= 2 ; ApplyMonsterDamage(m, dam)
    steals: RandStealLife +rand(dam/8) ; StealMana 3/5% ; StealLife 3/5%  (all capped, 26.6 raw units)
    if m.hp <= 0: KillMonster(m, p) else: if Knockback && !petrified: Knockback(m, from p.tile) ; MonsterStartHit(m, p, dam)
    return true
```
### I.4 Item generation (condensed)
```
SetupAllItems(item, idx, seed, lvl, uper, onlyGood, pregen, uidOffset=0, forceNotUnique=false):
    item.seed = seed ; SetRndSeed(seed)
    GetItemAttrs(item, idx, lvl/2)
    item.createInfo = lvl | PREGEN? | ONLYGOOD? | (uper==15 ? UPER15 : uper==1 ? UPER1 : 0)
    if item.miscId != FixedUnique:
        iblvl = GetItemBLevel(lvl, miscId, onlyGood, uper==15)
        if iblvl != -1:
            uid = forceNotUnique ? (discard 1 roll, INVALID) : CheckUnique(item, iblvl, uper, uidOffset)
            if uid == INVALID: GetItemBonus(item, iblvl/2, iblvl, onlyGood, allowSpells=true)
            else:              GetUniqueItem(item, uid)
        if item.quality != Unique: ItemRndDur(item)
    else if item.equipType != Unequippable:
        if seed > 109 || base.uniqueBaseItem != uniques[seed].base: item.clear(); return
        GetUniqueItem(item, seed)

GetItemPower(item, minlvl, maxlvl, mask, onlyGood):
    pre = rand(4)==0 ; suf = rand(3)!=0 ; if !pre && !suf: (rand(2)==0 ? pre : suf) = true
    goe = ANY ; if !onlyGood && rand(3)!=0: onlyGood = true
    if pre: P = SelectAffix(prefixes, mask, minlvl, maxlvl, onlyGood, goe, excludeStaffCharges=true)
            if P: quality=Magic; SaveItemAffix(P); prefixPower = P.type; goe = P.align
    if suf: S = SelectAffix(suffixes, mask, minlvl, maxlvl, onlyGood, goe, true)
            if S: quality=Magic; SaveItemAffix(S); suffixPower = S.type
    identifiedName = compose(P, baseName, S) (short base name if too wide)
    if P || S: CalcItemValue(item)
```
### I.5 Stat aggregation (condensed)
```
CalcPlrInv(p, loadGfx):
    CalcSelfItems(p)                  # statFlag fixed point over requirement interplay
    if p != me && !p.onThisLevel: loadGfx = false
    CalcPlrItemVals(p, loadGfx):
        sums over equipped usable items (base dmg/AC/spell always; bonuses only if normal or identified)
        CalcPlrDamage ; CalcPlrPrimaryStats ; store aggregates ; light radius ; CalcPlrDamageMod ; staff spells
        EnsureValidReadiedSpell ; splLvlAdd ; EnAc ; CalcPlrResistances ; CalcPlrLifeMana ; elemental dmg
        CalcPlrBlockFlag ; CalcPlrGraphics(weaponGfx, armorGfx) ; gold-capacity amulet ; redraw flasks
    if p == me: refresh statFlag for inventory+belt (+stash if open, +held item) ; CalcScrolls()
```
### I.6 Mana cost
```
GetManaAmount(p, spell):
    sl = max(p.GetSpellLevel(spell) - 1, 0)
    adj = sl > 0 ? sl * data.manaMultiplier : 0
    if spell == fireBolt: adj /= 2
    if spell == resurrect && sl > 0: adj = sl * (data.manaCost / 8)
    if spell in {healing, healOther}: ma = healing.manaCost + 2*p.level - adj
    elif data.manaCost == 255:        ma = p.maxManaBase.whole - adj
    else:                             ma = data.manaCost - adj
    ma = max(ma, 0) * class.manaCost
    return max(ma, data.minMana)
```
### I.7 Experience
```
addExperience(exp, monsterLevel):
    if !me || dead || maxLevel: return
    e = clamp(exp * (1 + (monsterLevel - level)/10.0), 0, u32max)
    if multiplayer: e = min(e, threshold(level)/20, 200*level)
    experience += min(e, threshold(maxLevel) - experience)
    while !maxLevel && experience >= threshold(level): NextPlrLevel()
```
### I.8 Inventory paste (condensed)
```
CheckInvPaste(p, cursor):
    size = GetInventorySize(hold) ; slot = FindTargetSlotUnderItemCursor(cursor, size) ; if none: return
    want = p.GetItemLocation(hold) ; loc = GetItemEquipType(slot, want)
    if loc == BELT && !CanBePlacedOnBelt(p, hold): return
    if loc not in {UNEQUIPPABLE, BELT} && want != loc: return
    if loc is an equipment location: if !CanUseItem(hold): say "can't use yet"; return ; if mode > walking: return
    play item sound
    switch loc: HELM/RING/AMULET/ARMOR -> ChangeBodyEquipment ; ONEHAND -> ChangeEquippedItem ; TWOHAND -> ChangeTwoHandItem
                UNEQUIPPABLE -> if !ChangeInvItem(slot, size): return ; BELT -> ChangeBeltItem
    CalcPlrInv(p) ; cursor = hold (may now be the swapped-out item)
```

## Appendix J — Per-class special-case matrix (everything that is not pure data)

| Behaviour | melee | ranged | caster | martial-arts | dual-wield | berserker |
|---|---|---|---|---|---|---|
| Critical strike (`level%` ×2) | yes | — | — | — | — | yes |
| Cleave (hit L/R tiles at ¼ dmg) | — | — | — | with staff | with 2 swords | axe, or 2h-class sword/mace without shield |
| Block without shield | — | — | — | staff (+FastBlock), unarmed, single 1h weapon | — | — |
| Dual wield 1h swords/maces | — | — | — | — | yes | — |
| 2h swords/maces one-handed | — | — | — | — | — | yes (shield halves its AC bonus) |
| Unarmed damage | 1-1 (1-3 w/ shield) | same | same | `max(L/2)`-`max(L)` | same as melee | same as melee |
| Damage mod divisor | Str/100 | (Str+Dex)/200 | Str/100 | (Str+Dex)/150 staff/unarmed, /300 else | sword (Str+Dex)/150, bow /250, else Str/100 | axe/mace Str/75, bow Str/300, else Str/100, +Vit/100 w/o shield/staff/bow |
| Extra AC | — | — | — | +2L light, +L/2 medium (+2L unique), +L/2 unique heavy | — | +L/4 (IronSkin) |
| Extra resists | — | — | — | — | — | +L all (NaturalResistance) |
| Stagger threshold | L | L | L | L | L | L + L/4 |
| Char-sheet bow damage | half damageMod | full | half | half | half | half |
| Auto-equip weapons | option | option | option | never | option | option |
| Peddler refuses (first 200 rolls) | bow, staff | sword, staff, axe, mace, shield | staff, axe, bow, mace | bow, medium armor, shield, mace | axe, mace, staff | bow, staff |
| Trap-sense flag | — | yes | — | — | — | — |
| Class skill | repair | disarm | recharge | search | identify | rage |
| Starting spell | — | — | fire bolt L2 | — | — | — |
| Mana | normal | ×0.75 cost | normal | ×0.75 | ×0.75 | none (0 max) |

## Appendix K — Player-facing options that gate these systems (all default-off unless noted)

auto gold pickup; auto elixir pickup; auto oil pickup; per-potion-kind pickup counts (healing, full healing, mana,
full mana, rejuvenation, full rejuvenation); auto pickup in town; auto-equip weapons/armor/helms/shields/jewelry
(sound on equip); auto refill belt; experience bar; enemy health bar (+ show monster type colour); floating numbers;
item labels (toggle or hold key); run in town; walking sound; item pickup sound; show multiplayer party info
(players / players+summons); zoom (doubles overlay coordinates).

## Appendix L — Glossary of engine terms used above

- **ilvl / createInfo level** — the 6-bit level stored with an item; sets affix/unique windows. Monster drops use the
  monster's data level; floor drops use `2 × dungeon level`.
- **onlyGood** — generation flag: forces the magic tier and excludes "not useful" (cursed/negative) affixes.
- **uper** — unique probability parameter (1 normal, 15 unique monsters); real chance `(uper+1)%`; 15 also adds +4 ilvl.
- **statFlag** — cached "owner meets requirements" bit; drives red tint, usability, and whether bonuses apply.
- **effective spell level** — `splLvl + Σ item SplLvlAdd`, floored at 0; 0 = unusable.
- **action frame** — the animation frame on which an attack/cast resolves (`_pAFNum`, `_pSFNum`).
- **26.6 / 10.6 fixed** — integers with 6 fractional bits; `whole()` = value >> 6.
- **tick** — 50 ms logic step; animations advance `1/ticksPerFrame` frame per tick.

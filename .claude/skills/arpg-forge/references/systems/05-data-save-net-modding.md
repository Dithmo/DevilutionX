# Data-driven content pipeline, asset formats, save/load, multiplayer, modding, build & test

Scope: the "plumbing" clusters of a ~149k-line C++23 isometric ARPG engine — how content is
described in text tables, how it is loaded and validated, how the game is persisted, how four
peers stay in lockstep, how scripts and mods extend the data, how raw assets are packaged and
decoded, and how all of it is built and tested. Everything below is written to be reusable for a
*new* game in the genre: identifiers, lore and proper names from the reference game are removed
or replaced with role descriptions. Numbers quoted from the reference implementation are marked as
**reference tuning values** — they are starting points, not requirements.

Conventions used in this document:

* "the reference engine" = the codebase analysed; "a new engine" = what you would build.
* "base edition" / "shareware edition" / "expansion" = the three content configurations the
  reference engine distinguishes at runtime (full retail data, demo data, add-on data pack).
* "hero" = a player character; "towner" = a non-hostile town NPC; "set level" = a hand-authored
  (non-procedural) quest level; "delta" = the per-level change log exchanged between peers.

---

## System map

| System | Source files | Lines (approx.) | Depends on | Depended on by |
|---|---|---|---|---|
| A. TSV data-file core (tokeniser, iterators, typed readers) | `Source/data/file.{hpp,cpp}`, `parser.{hpp,cpp}`, `iterators.hpp`, `record_reader.{hpp,cpp}`, `value_reader.{hpp,cpp}` | 1,400 | asset VFS (F), fixed-point & int parsing utils | every table loader (B), Lua data hooks (E) |
| B. Content tables (typed loaders + schemas) | `Source/tables/{itemdat,monstdat,misdat,objdat,playerdat,questdat,spelldat,textdat,townerdat}.*`, `Source/effects.cpp` (sound table), `assets/txtdata/**` | 5,900 C++ + 23 TSVs | A, enum reflection (`magic_enum`), Lua event bus (E) | item/monster/spell/object/quest/player gameplay code, save/load (C), net validation (D) |
| C. Save / load (hero file, game file, per-level files, stash, codec, pack) | `Source/loadsave.{cpp,h}`, `pfile.{cpp,h}`, `pack.{cpp,h}`, `codec.{cpp,h}`, `sha.{cpp,h}`, `encrypt.{cpp,h}`, `mpq/mpq_writer.*` | 5,200 | B (mapping ids), F (archive reader/writer), item regeneration (seeded), RNG | game loop (new game / load / level change), UI hero list, demo-mode compare tests |
| D. Multiplayer: lockstep turns, command catalog, delta sync, transport | `Source/multi.{cpp,h}`, `msg.{cpp,h}`, `sync.cpp`, `tmsg.cpp`, `nthread.{cpp,h}`, `dvlnet/*`, `storm/storm_net.*`, `items/validation.*`, `monsters/validation.*` | 11,400 | C (pack structs, item validation), B, RNG seeds, platform sockets / overlay network | game loop (every tick), UI lobby |
| E. Lua modding / scripting layer | `Source/lua/*`, `Source/lua/modules/**`, `Source/mods/*`, `assets/lua/**`, `assets/lua_internal/**`, `mods/*` | 3,800 | sol2/Lua 5.4, A, B, F (archive override paths), options | B (re-entrant data loading), gameplay hooks, menu/options |
| F. Asset pipeline (archive VFS, sprite formats, palette & light tables) | `Source/engine/assets.*`, `mpq/*`, `engine/load_{cel,cl2,clx,pcx}.*`, `engine/clx_sprite.hpp`, `engine/light_tables.*`, `engine/lighting_defs.hpp`, `CMake/Assets.cmake`, `CMake/Mods.cmake`, `tools/` | 3,300 | SDL IO, archive library, zlib/bzip2 | A, B, C, E, renderer, audio |
| G. Build & project structure | `CMakeLists.txt`, `Source/CMakeLists.txt`, `CMake/*`, `vcpkg.json`, `3rdParty/*`, `Packaging/`, platform project dirs | ~62 internal object libraries | CMake ≥ 3.22, C++23 compiler, SDL2/3, optional vendored deps | everything |
| H. Test strategy | `test/*.cpp` (≈70 files), `test/fixtures/**`, `CMake/Tests.cmake`, `test/Fixtures.cmake`, `Source/engine/demomode.*` | ≈900 test cases | gtest/gmock, benchmark, exported engine symbols (`API_FOR_TEST`) | CI |
| I. Settings schema, localization, platform & presence glue | `Source/options.{h,cpp}`, `utils/language.*`, `Translations/*.po`, `Source/platform/*`, `Source/discord/*` | 3,500 | ini parser, gettext `.mo` reader, SDL | all UI, E (mods list), D (game-init options) |

Dependency direction that worked well: `F → A → B → {C, D, E}`; the game-logic code only sees
typed structs from B, never the TSV text. Dependency direction that caused pain: `C ↔ D` share
packed structs and item-regeneration code, and both reach into dozens of gameplay globals
(described under pitfalls).

---

## A. TSV data-file core

### Purpose

A tiny, allocation-light reader for tab-separated text tables that (1) tolerates what spreadsheet
tools emit (BOM, CR/LF, missing trailing newline), (2) lets a loader name the columns it cares
about and skip the rest, (3) parses typed scalars/lists/arrays with precise error locations, and
(4) turns every content error into a fatal, human-readable message naming file, row, column and
offending value. Content lives in `txtdata/<domain>/<table>.tsv` inside the asset VFS so a mod can
replace any table by shipping a file at the same path.

### Key data structures / schemas

**File format (formal, from the shipped readme):**

```
File        ::= utf8bom? ( singleRecord | record+ finalRecord? )
record      ::= fields recordterm            recordterm ::= CR? LF
fields      ::= field ( TAB field )*         field      ::= any char except TAB, CR, LF (may be empty)
```
* First record SHOULD be a header. An empty file (or BOM only) is valid and means "one unnamed
  column, zero records".
* Values must not contain tabs or line breaks; no quoting/escaping exists (unlike CSV). Spreadsheet
  exports must be checked to preserve leading spaces and quotes verbatim.
* Numbers are base-10, no separators. Decimals are allowed only in columns read as fixed-point
  (6 fractional bits), e.g. `1.5`.
* List cells are comma-separated (`Fire,Targeted`), array cells are comma-separated with a fixed
  length (`11,24,12,6,16,0`).

**Two table shapes are used:**

| Shape | Header | Row meaning | Reader class |
|---|---|---|---|
| Record table | one header row, N named columns | one entity per row | `RecordReader` (positional, in header order) |
| Key/value sheet | header `Variable\tValue` (or `Attribute\tValue`) | one field per row, keys in a fixed order | `ValueReader` (checks each expected key in order) |

**Core types**

| Type | Role |
|---|---|
| `GetFieldResult { string_view value; const char* next; Status }` | result of scanning one field; `Status ∈ {ReadyToRead, EndOfField, EndOfRecord, BadRecordTerminator, EndOfFile, FileTruncated, NoFinalTerminator}` |
| `DataFile` | owns the whole file in memory; `load(path)` → `expected<DataFile, Error>` with `Error ∈ {NotFound, OpenFailed, BadRead, NoContent, NotEnoughColumns}`; `parseHeader(begin,end,mapper)`; `skipHeader()`; `numRecords()`; range `begin()/end()` |
| `ColumnDefinition { uint8_t type; unsigned skipLength; }` | produced by `parseHeader`: for each *wanted* column, how many unwanted fields precede it — lets the row loop jump without string compares |
| `RecordIterator` / `DataFileRecord` / `FieldIterator` / `DataFileField` | input iterators over records and fields; `DataFileField` carries row & column numbers for errors |
| `DataFileField` parse API | `value()`, `parseInt<T>()`, `parseBool()`, `parseIntArray(T(&)[N])`, `parseEnumArray(arr, fillMissing, fn)`, `parseEnumList(bitmask, fn)` (comma list OR-ed into flags), `parseFixed6<T>()`, `asInt<T>()`; errors `NotANumber / OutOfRange / InvalidValue` |
| `RecordReader` | "fatal on error" facade: `readInt`, `readOptionalInt` (empty cell = keep default), `readIntArray`, `readEnumArray`, `readFixed6`, `readBool`, `readString`, `read(name, out, parseFn)`, `readEnumList`, `advance()` (skip a column), `value()` (peek) |
| `ValueReader` | for key/value sheets: `readInt/readDecimal/readString/readChar/read/readEnumList(expectedKey, out)` — each call asserts the next row's key equals `expectedKey` |

### Algorithms & rules

1. **Load**: resolve `txtdata\\…` through the asset VFS (`FindAsset`), read the whole file into an
   owned buffer, strip BOM. (A TODO notes streaming would be possible; whole-file is fine at the
   sizes involved — the largest shipped table is ~90 KB.)
2. **Header handling, two strategies**:
   * *Name-mapped* (`parseHeader`): the loader passes a `label → enum` function; the header is
     scanned once, each recognised label records its `skipLength`; repeated labels are ignored;
     missing wanted columns → `NotEnoughColumns`; file ending after the header → `NoContent`.
     Used by the experience table and the quest-dialog matrix (whose columns are quest ids and
     may be absent).
   * *Positional* (`skipHeader` + `RecordReader`): the loader reads fields in the documented
     order and only uses the header to seek past it. Used by every other table. Cheaper to
     write, but a reordered or inserted column silently shifts meaning — the shipped readme
     therefore says "make sure the file looks roughly the same after changing values".
3. **Field scanning** is a single `find_if` for `\t|\r|\n`, then a terminator state machine
   (`HandleRecordTerminator`) distinguishing `CRLF`, lone `LF`, truncated `CR` at EOF, and
   missing final terminator. Zero-length fields are valid values.
4. **Enum parsing** is done one of two ways: a hand-written `if (value == "...") return X;` chain
   (gives friendly names decoupled from C++ identifiers) or `magic_enum::enum_cast` (zero
   maintenance, but couples the data vocabulary to C++ identifier spelling). Several loaders
   additionally accept *new* identifiers and assign them indices at the end of the built-in range
   (see "extensible id tables" under B).
5. **Error policy**: any parse failure calls `app_fatal` with one of four translated templates:
   missing/corrupt file, empty/header-only file, missing expected columns, or a field error that
   prints `{value} for {column} in {file} at row {r} and column {c}` plus the parser's detail
   string. There is no partial-load/recover path; content errors are treated as build breaks.
6. **Fixed-point decimals**: columns such as life-per-level use a `Fixed10_6`/`Fixed26_6`
   representation (6 fractional bits); the parser converts `a.b` text directly (no floats), which
   keeps deterministic arithmetic across platforms.

### Reference tuning values

| Constant | Value | Where |
|---|---|---|
| Column id width | `uint8_t` (max 255 distinct wanted columns per table) | `ColumnDefinition::type` |
| Fixed-point fraction bits | 6 | `parseFixed6` |
| Max rows in experience table | 255 levels (uint8 level) | `ExperienceData` |
| Allowed list separator | `,` | `parseEnumList/parseIntArray` |
| Header-mapped tables | 2 (experience, quest-dialog matrix); all others positional | — |

### Smallest buildable chunks

1. **Field tokenizer** — inputs: `(begin,end)` char range; outputs: `GetFieldResult` with status;
   done when: unit tests pass for LF, CRLF, lone CR at EOF, no final newline, empty file, BOM.
2. **Record/field iterators** — inputs: tokenizer; outputs: range-for over records then fields with
   row/column counters; done when: iterating a 3×4 fixture yields 12 fields with correct coords.
3. **DataFile load via VFS** — inputs: logical path; outputs: owned buffer + `expected` error enum;
   done when: missing file, empty file, header-only file return distinct errors.
4. **Typed scalar parsing** — inputs: `string_view`; outputs: `expected<void, Error>` for
   int/bool/fixed6 with overflow detection via `from_chars`; done when: out-of-range `300` into
   `uint8_t` reports `OutOfRange`.
5. **List & array parsing** — inputs: comma cell; outputs: bitmask OR fixed-size array (with
   `fillMissing`); done when: `"A,B"` → `A|B`, `"1,2"` into `int[6]` with fill works, `"x"` → `InvalidValue`.
6. **Header mapper with skip lengths** — inputs: label→enum fn; outputs: `ColumnDefinition[]`;
   done when: reordered header still maps and extra columns are skipped.
7. **RecordReader facade** — inputs: a record; outputs: fatal-on-error typed reads with column
   names in messages; done when: a bad cell aborts with file/row/col/value in text.
8. **ValueReader for key/value sheets** — inputs: `Variable/Value` file; outputs: ordered key
   assertions; done when: swapped rows produce a clear "expected key X" error.
9. **Error message catalogue** — inputs: error enums; outputs: 4 localized templates; done when:
   translators see one `TRANSLATORS:` comment per template.
10. **Fixture suite** — inputs: 8 tiny TSVs (cr, crlf, lf, lf_no_trail, empty, empty+BOM, utf8+BOM,
    sample); outputs: ~16 tests; done when: all pass on big- and little-endian CI.
11. **Spreadsheet round-trip doc** — inputs: readme; outputs: modder-facing format spec (EBNF) and
    tool caveats; done when: a file saved from a desktop spreadsheet loads unchanged.

### Pitfalls / design lessons

* Positional reading is fast to implement but fragile for modders; prefer header-name mapping
  everywhere and keep `skipLength` precomputation so it stays O(fields) per row.
* Do not mix "friendly enum names" and "C++ identifier names" across tables; the reference
  engine does both (hand chains vs `magic_enum`), so modders must learn two vocabularies.
* Make empty-cell semantics explicit per column (`readOptionalInt` keeps the default; `readInt`
  fails). Document which columns are optional in the header or a schema file.
* A fatal-on-error policy is right for shipped content but hostile to mod authors; a new engine
  should collect all errors for a file before aborting and show them together.
* Keep the parser free of game includes (the reference one depends only on utils + VFS); that is
  what made it reusable for mods adding new tables from Lua.

---

## B. Content tables (schemas, loaders, validation)

### Purpose

Every designer-facing number in the game — classes, items, affixes, uniques, monsters, missiles,
objects, quests, spells, NPCs, dialogue, sounds, experience curve — is a TSV row that is parsed
once at startup (and again whenever the active mod list changes) into a flat `std::vector` of
POD-ish structs indexed by a stable integer id. Game code indexes those vectors; nothing else
reads text.

### Key data structures / schemas

Loader entry points and the order they run (`LuaReloadActiveMods`): text → player classes (with
experience) → spells → missiles → monsters → items → objects → quests → towners (+ sound effects
earlier). Order matters because later tables parse ids defined by earlier ones (items reference
spells; uniques reference base-item kinds; quests reference text ids; towners reference text ids).

#### B.1 `classes/classdat.tsv` (record table) — one row per playable class

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `className` | string | display name of the class | 6 rows shipped (3 base + 3 expansion/test) |
| 2 | `folderName` | string | subfolder under `classes/` holding the five per-class sheets | lowercase token |
| 3 | `portrait` | uint8 | index of the portrait/strip set used in UI | 0..2 (classes share art) |
| 4 | `inv` | string | name of the inventory background art variant | 3 distinct |

Hard cap: 255 classes (`uint8` class id). Save files store the class as a `uint8` and clamp
unknown values to the last loaded class.

#### B.2 `classes/<folder>/attributes.tsv` (key/value sheet, 27 keys in this exact order)

| Key | Type | Meaning | Reference range |
|---|---|---|---|
| `classFlags` | enum list | class behaviour flags (e.g. critical-strike capable) | 0..1 flags |
| `baseStr`/`baseMag`/`baseDex`/`baseVit` | uint8 | starting attributes | 10–35 each; totals 85–90 |
| `maxStr`/`maxMag`/`maxDex`/`maxVit` | uint8 | attribute caps | 45–255 |
| `blockBonus` | uint8 % | base block chance | 10–30 |
| `adjLife`, `adjMana` | fixed6 | flat life/mana adjustment at creation | -1..18 |
| `lvlLife`, `lvlMana` | fixed6 | life/mana gained per level | 1..2 |
| `chrLife`, `chrMana` | fixed6 | life per base vitality / mana per base magic | 1..2 |
| `itmLife`, `itmMana` | fixed6 | life/mana per item-granted vitality/magic | 1..2 |
| `manaCost` | fixed6 | spell mana-cost multiplier | 1 |
| `itmRestoreLife`, `itmRestoreMana` | fixed6 | potion restore multipliers | 1..2 |
| `splRestoreLife`, `splRestoreMana` | fixed6 | spell restore multipliers | 1..2 |
| `healOtherRestoreLife` | fixed6 | ally-heal multiplier | 1..2 |
| `baseMagicToHit`/`baseMeleeToHit`/`baseRangedToHit` | uint8 % | starting hit chances by attack kind | 50–70 |

#### B.3 `classes/<folder>/animations.tsv` (key/value, 27 keys)

Frame counts and "action frame" (the frame on which damage/cast resolves) per weapon stance:
`unarmed`, `unarmedShield`, `sword`, `swordShield`, `bow`, `axe`, `mace`, `maceShield`, `staff`
(each `<stance>Frames` + `<stance>ActionFrame`), then `idleFrames`, `walkingFrames`,
`blockingFrames`, `deathFrames`, `castingFrames`, `recoveryFrames`, `townIdleFrames`,
`townWalkingFrames`, `castingActionFrame`. Types: int8. Reference values: attack 16–20 frames with
action frame 9–11; idle 10, walk 8, block 2, death 20, cast 20 (action 14), recovery 6, town idle 20.

#### B.4 `classes/<folder>/sprites.tsv` (key/value, 19 keys)

| Key | Type | Meaning |
|---|---|---|
| `classPath` | string | sprite folder under the hero-graphics root |
| `classChar` | char | prefix character used in stance folder/file names |
| `trn` | string | palette-translation file applied to the class |
| `partyOffsetTownX/Y`, `partyOffsetDungeonX/Y`, `partyOffsetDeadX/Y` | int8 | portrait anchoring offsets per context |
| `stand`, `walk`, `attack`, `bow`, `swHit`, `block`, `lightning`, `fire`, `magic`, `death` | uint8 | sprite frame width (px) per stance (96 or 128 in reference) |

#### B.5 `classes/<folder>/starting_loadout.tsv` (key/value, 9 keys)

`skill` (class ability spell id), `spell` (starting spell id or `Null`), `spellLevel` (uint8),
`item0..item4` (5 base-item ids; unused slots use a none id), `gold` (uint16; reference 100).

#### B.6 `classes/<folder>/sounds.tsv` (key/value, one key per hero-speech slot)

Header `speech\tsfx`; one row per entry of the engine's hero-speech enum (103 slots in reference:
item refusals, quest reactions, grunts, death). Value is a sound-effect id from `effects.tsv`.
Missing keys are fatal; a class may map many slots to the same clip.

#### B.7 `Experience.tsv` (header-mapped: `Level`, `Experience`)

Rows `1..maxLevel`; `Experience` = XP needed to *leave* that level. A `MaxLevel` row is tolerated
and skipped. Reference: 50 rows, 2,000 → 1,583,495,809 (roughly ×1.3 per level early, flattening
to ×1.2). Gaps in levels permanently cap progression at the gap. The highest row defines max level.

#### B.8 `items/itemdat.tsv` — base item types (168 rows)

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `id` | identifier (skipped by loader; row order = index) | symbolic id used by other tables and code | 168 |
| 2 | `dropRate` | uint8 | weight in random drop pool | 0 (never), 1, 2 |
| 3 | `class` | enum | `None/Weapon/Armor/Misc/Gold/Quest` | 5 used |
| 4 | `equipType` | enum | `None/One-handed/Two-handed/Armor/Helm/Ring/Amulet/Unequippable/Belt` | 7 used |
| 5 | `cursorGraphic` | enum or int | icon frame id (name or raw number) | 115 distinct |
| 6 | `itemType` | enum | `Misc/Sword/Axe/Bow/Mace/Shield/LightArmor/Helm/MediumArmor/HeavyArmor/Staff/Gold/Ring/Amulet/None` | 14 |
| 7 | `uniqueBaseItem` | enum, **extensible** | base-kind token that uniques attach to; unknown tokens are auto-registered | 67 distinct |
| 8 | `name` | string | full display name | — |
| 9 | `shortName` | string | abbreviated name for narrow UI | optional |
| 10 | `minMonsterLevel` | uint8 | minimum source level for drops | 0..25 |
| 11 | `durability` | uint8 | max durability (0 = indestructible/none) | 0..100 |
| 12–13 | `minDamage`,`maxDamage` | uint8 | weapon damage | 0..12 / 0..30 |
| 14–15 | `minArmor`,`maxArmor` | uint8 | armor roll range | 0..60 / 0..75 |
| 16–18 | `minStrength`,`minMagic`,`minDexterity` | uint8 | requirements | 0..90 / 0..117 / 0..80 |
| 19 | `specialEffects` | enum list | innate special effect flags (26 known) | rarely used on base items |
| 20 | `miscId` | enum | consumable/scroll/book/oil/rune/etc. kind (45 tokens) | 33 used |
| 21 | `spell` | spell id | spell granted by book/scroll/staff | 24 used |
| 22 | `usable` | bool | can be "used" from inventory | — |
| 23 | `value` | uint16 | base gold value | 0..~25k |

Each row also receives a `mappingId` (base + row index) used by saves; mods appending rows via
Lua pass their own `baseMappingId` so saved items survive load-order changes.

#### B.9 `items/item_prefixes.tsv` (83 rows) and `items/item_suffixes.tsv` (95 rows) — affixes

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `name` | string | affix word | — |
| 2 | `power` | enum | effect type (≈80 tokens: to-hit, damage %, AC %, resistances, stats, life/mana, durability, light radius, arrows, thorns, charges, set-damage, set-AC, etc.) | 18 prefix / 32 suffix kinds |
| 3–4 | `power.value1`,`power.value2` | int | effect roll range (min,max) | 1..200 (opt) |
| 5 | `minLevel` | int8 | minimum item level | 1..60 |
| 6 | `itemTypes` | enum list | `Misc,Bow,Staff,Weapon,Shield,Armor` applicability | — |
| 7 | `alignment` | enum | `Any/Good/Evil` — curses only roll with "evil" alignment | — |
| 8 | `chance` | uint8 | relative weight | 1..2 |
| 9 | `useful` | bool | counts as a positive affix for "only good" drops | — |
| 10–11 | `minVal`,`maxVal` | int | price contribution range | -1000..75,000 |
| 12 | `multVal` | int | price multiplier (negative for curses) | -10..+15 |

#### B.10 `items/unique_itemdat.tsv` (90 rows)

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `name` | string | unique name | 90 |
| 2 | `cursorGraphic` | enum/int | override icon (optional) | 34 distinct |
| 3 | `uniqueBaseItem` | enum | base kind it can roll on | 62 distinct |
| 4 | `minLevel` | int8 | minimum item level | 1..27 |
| 5 | `value` | int | fixed gold value | 1,000..251,175 |
| 6..23 | `power0..power5` + `.value1/.value2` | enum + 2×int | up to 6 fixed powers; first empty `powerN` ends the list | 1–6 powers; values -1..300 |

Each unique also receives a `mappingId`. A runtime per-game bitset marks uniques already dropped.

#### B.11 `monsters/monstdat.tsv` (112 rows) — monster types

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `_monster_id` | identifier, **extensible** | known ids fill fixed slots; unknown ids append | 112 |
| 2 | `name` | string | display name | — |
| 3 | `assetsSuffix` | string | sprite folder/file stem (deduplicated into a sprite-id table) | 34 distinct |
| 4 | `soundSuffix` | string | voice set stem (optional) | 6 |
| 5 | `trnFile` | string | palette translation (optional) | 66 |
| 6 | `availability` | enum | `Always/Never/Retail` (Retail = not in shareware) | — |
| 7 | `width` | uint16 | sprite width px | 96..160 |
| 8 | `image` | uint16 | approximate memory/size weight used for level-type budgets | 364..2420 |
| 9–10 | `hasSpecial`,`hasSpecialSound` | bool | has a special attack animation / sound | — |
| 11 | `frames[6]` | int8[6] | frames per animation (stand, walk, attack, hit, death, special) | 0..24 |
| 12 | `rate[6]` | int8[6] | ticks per frame per animation | 1..4 |
| 13–14 | `minDunLvl`,`maxDunLvl` | int8 | dungeon depth range it may spawn in | 1..26 |
| 15 | `level` | int8 | monster level (drives item level & XP scaling) | 1..30 |
| 16–17 | `hitPointsMinimum`,`hitPointsMaximum` | uint16 | HP roll range | 1..1666 |
| 18 | `ai` | enum | AI archetype id (~45 archetypes incl. melee/ranged/charger/caster/summoner/boss scripts) | 24 used |
| 19 | `abilityFlags` | enum list | `HIDDEN, LOCK_ANIMATION, ALLOW_SPECIAL, TARGETS_MONSTER, GOLEM, QUEST_COMPLETE, KNOCKBACK, SEARCH, CAN_OPEN_DOOR, NO_ENEMY, BERSERK, NOLIFESTEAL` | 6 combos |
| 20 | `intelligence` | uint8 | AI aggressiveness tier | 0..3 |
| 21 | `toHit` | uint8 | base hit chance | 0..220 |
| 22 | `animFrameNum` | int8 | attack frame where damage lands | 4..13 |
| 23–24 | `minDamage`,`maxDamage` | uint8 | melee damage | 1..30 / 1..60 |
| 25–28 | `toHitSpecial`,`animFrameNumSpecial`,`minDamageSpecial`,`maxDamageSpecial` | uint8/int8 | same for special attack | 0..100 / 0..14 / 0..30 / 0..50 |
| 29–34 | `reducePlayer{Strength,Magic,Dexterity,Vitality,MaxHP,MaxMana}` | uint8 | on-hit attribute drains | 0..1 |
| 35 | `armorClass` | uint8 | AC | 0..90 |
| 36 | `monsterClass` | enum | `Undead/Demon/Animal` (affects bonuses) | 3 |
| 37 | `resistance` | enum list | `RESIST_*`/`IMMUNE_*` for magic/fire/lightning/acid at lower difficulties | 23 combos |
| 38 | `resistanceTopDifficulty` (column literally named after the top difficulty tier) | enum list | same at top difficulty | 24 combos |
| 39 | `selectionRegion` | enum list | `Bottom,Middle,Top` click hitbox thirds | — |
| 40 | `treasure` | special | empty / `None` (no drop) / `Uniq(<base>)` fixed unique drop (parser is a stub with 2 tokens) | 3 |
| 41 | `exp` | uint16 | base XP | up to ~tens of thousands |

#### B.12 `monsters/unique_monstdat.tsv` (100 rows) — named monsters

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `type` | monster id | base type | 84 distinct |
| 2 | `name` | string | — | — |
| 3 | `trn` | string | palette translation stem | 31 |
| 4 | `level` | uint8 | override level (0 = inherit) | 0..28 |
| 5 | `maxHp` | uint16 | fixed HP | 49..1332 |
| 6 | `ai` | enum | AI override | 27 |
| 7 | `intelligence` | uint8 | 0..3 |
| 8–9 | `minDamage`,`maxDamage` | uint8 | 0..40 / 0..75 |
| 10–15 | `reducePlayer*` | uint8 | drains | 0 |
| 16 | `resistance` | enum list | 17 combos |
| 17 | `monsterPack` | enum | `None/Independent/Leashed` escort group behaviour | — |
| 18 | `customToHit` | uint8 | 0 = inherit | 0..100 |
| 19 | `customArmorClass` | uint8 | 0 = inherit | 0..90 |
| 20 | `talkMessage` | text id | dialogue shown when interacted with (optional) | 7 |

#### B.13 `missiles/misdat.tsv` (68 rows) — projectile/effect definitions

| # | Column | Type | Meaning |
|---|---|---|---|
| 1 | `id` | identifier | missile id (row order = enum) |
| 2 | `addFn` | enum → C++ fn ptr | spawn handler (75 named handlers) |
| 3 | `processFn` | enum → C++ fn ptr | per-tick handler (45 named handlers; empty = none) |
| 4 | `castSound` | sfx id | played on spawn (optional) |
| 5 | `hitSound` | sfx id | played on impact (optional) |
| 6 | `graphic` | enum | missile sprite id from `missile_sprites.tsv` (optional) |
| 7 | `flags` | enum list | damage type `Physical/Fire/Lightning/Magic/Acid`, plus `Arrow`, `Invisible` |
| 8 | `movementDistribution` | enum | empty=`Disabled`, `Blockable`, `Unblockable` (whether sub-tile movement is interpolated and whether shields can block) |

#### B.14 `missiles/missile_sprites.tsv` (46 rows)

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `id` | identifier | graphic id | 46 |
| 2 | `width` | uint16 | frame width | 0..160 |
| 3 | `width2` | int8 | horizontal anchor | 0..48 |
| 4 | `name` | string | file stem (optional for invisible) | 39 |
| 5 | `numFrames` | uint8 | number of direction variants/files | 1..16 |
| 6 | `flags` | enum list | `MonsterOwned` (uses monster palette rules), `NotAnimated` | — |
| 7 | `frameDelay` | uint8[16] | ticks per frame per direction | 0..3 |
| 8 | `frameLength` | uint8[16] | frames per direction | 0..16 |

#### B.15 `objects/objdat.tsv` (109 rows) — interactive level objects

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `id` | identifier | object id | 109 |
| 2 | `file` | string | sprite file stem; deduplicated into a graphic-id table | 62 |
| 3–4 | `minLevel`,`maxLevel` | int8 | depth range (0,0 = anywhere/placed by script) | 0..24 |
| 5 | `levelType` | enum | restrict to one tileset (optional) | 4 |
| 6 | `theme` | enum | theme-room it belongs to (17 tokens; optional) | 13 |
| 7 | `quest` | quest id | only placed when this quest is active (optional) | 7 |
| 8 | `flags` | enum list | `Animated, Solid, MissilesPassThrough, Light, Trap, Breakable` | 13 combos |
| 9 | `animDelay` | uint8 | ticks per frame | 0..5 |
| 10 | `animLen` | uint8 | frames | 0..26 |
| 11 | `animWidth` | uint8/uint16 | sprite width | 0..160 |
| 12 | `selectionRegion` | enum list | hitbox thirds | — |

#### B.16 `quests/questdat.tsv` (24 rows)

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `qdlvl` | uint8 | dungeon depth where the quest is seeded (single-player) | 2..21 |
| 2 | `qdmultlvl` | int8 | depth in multiplayer (-1 = not available) | -1..21 |
| 3 | `qlvlt` | enum | tileset of the quest's set level (optional) | 3 |
| 4 | `bookOrder` | int8 | sort order in the quest log | 0..23 |
| 5 | `qdrnd` | uint8 | random availability weight (all 100 in reference) | 100 |
| 6 | `qslvl` | enum | set-level id (`SL_NONE` or one of 5 hand-made levels) | — |
| 7 | `isSinglePlayerOnly` | bool | excluded when "multiplayer quest set" is active | — |
| 8 | `qdmsg` | text id | intro dialogue | — |
| 9 | `qlstr` | string | quest title | — |

Quest *logic* (state machines, triggers) stays in C++; the table only parameterises placement.

#### B.17 `spells/spelldat.tsv` (36 rows)

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `id` | identifier | spell id | 36 |
| 2 | `name` | string | display | — |
| 3 | `soundId` | sfx id | cast sound class | 4 |
| 4 | `bookCost10` | uint16 | book price ÷ 10 | 0..3000 |
| 5 | `staffCost10` | uint8 | staff-charge price ÷ 10 | 0..200 |
| 6 | `manaCost` | uint8 | base mana | 0..150 |
| 7 | `flags` | enum list | element `Fire/Lightning/Magic`, `Targeted`, `AllowedInTown` | 7 combos |
| 8 | `bookLevel` | int8 | min character level to learn from book (-1 = never) | -1..14 |
| 9 | `staffLevel` | int8 | min level for staff spawn (-1 = never) | -1..15 |
| 10 | `minIntelligence` | uint8 | magic attribute requirement | 0..255 |
| 11 | `missiles` | missile id ×2 | up to two missiles spawned on cast (missing filled with none) | — |
| 12 | `manaMultiplier` | uint8 | mana reduction per spell level | 0..6 |
| 13 | `minMana` | uint8 | floor after reductions | 0..100 |
| 14–15 | `staffMin`,`staffMax` | uint8 | charge roll range on staves | 0..40 / up to 80 |

#### B.18 `towners/towners.tsv` (12 rows) — town NPC placements

| # | Column | Type | Meaning | Reference range |
|---|---|---|---|---|
| 1 | `type` | enum | NPC role id (13 roles: smith, healer, wounded man, tavern keeper, storyteller, drunk, witch, barmaid, pegleg boy, cow, farmer, girl, cow-farmer) | 10 used |
| 2 | `name` | string | display name | — |
| 3–4 | `position_x`,`position_y` | int | town tile | 11..84 |
| 5 | `direction` | enum | facing (8-way) | 5 used |
| 6 | `animWidth` | uint16 | sprite width | 96..128 |
| 7 | `animPath` | string | sprite file stem (optional) | 9 |
| 8 | `animFrames` | uint8 | frames (optional) | 8..25 |
| 9 | `animDelay` | int16 | ticks per frame (optional) | 3..6 |
| 10 | `gossipTexts` | text id list | random gossip lines | 0..11 per NPC |
| 11 | `animOrder` | uint8 list | explicit frame sequence (idle fidgets); empty = linear loop | up to ~150 entries |

#### B.19 `towners/quest_dialog.tsv` (10 rows, header-mapped matrix)

Row = NPC role (`towner_type`), column = quest id (any subset of quest ids may be present as
columns), cell = text id the NPC says while that quest is active (`TEXT_NONE`/empty = nothing).
Unknown NPC rows and missing columns are silently skipped — the one table that degrades gracefully.

#### B.20 `sound/effects.tsv` (813 rows)

| # | Column | Type | Meaning |
|---|---|---|---|
| 1 | `id` | identifier (enum via reflection) | sound id used by every other table |
| 2 | `flags` | enum list | `Stream` (large, streamed), `Misc`, `Ui`, and one tag per class voice set (gates loading to the active class) |
| 3 | `path` | string | archive path of the `.wav`/`.mp3` |

#### B.21 `text/textdat.tsv` (338 rows) — dialogue/lore lines

| # | Column | Type | Meaning |
|---|---|---|---|
| 1 | `txtstrid` | identifier, **extensible** | known ids fill fixed slots; new ids append |
| 2 | `txtstr` | string | text; literal `\n` is converted to newline at load |
| 3 | `scrlltxt` | bool | render as scrolling panel (long lore) vs. speech bubble |
| 4 | `sfxnr` | sfx id | voice-over clip |

### Algorithms & rules

1. **Flat vectors + stable indices.** Each loader clears its vector, `reserve(numRecords)`, and
   `emplace_back`s in row order; the row index *is* the id for ids that code references by enum.
2. **Extensible id tables** (monsters, text, unique-base-item kinds): the loader first tries to
   map the id string to a built-in enum value (fixed slot); if unknown, it appends and records
   `name → index` in a side map so later tables (and Lua) can reference it by name. Hard caps:
   200 monster types (also the per-level monster cap, kept equal for save compatibility), 127
   unique-base-item kinds (`int8`), 255 classes.
3. **Mapping ids for persistence** (items, uniques): instead of saving a row index, saves store
   `mappingId`; a hash map `mappingId → index` is rebuilt at load. Core tables start at 0; a mod
   passes its own base (e.g. 10,000) so two mods cannot collide and reordering is harmless.
   Duplicate mapping ids are fatal.
4. **Cross-table references** are parsed by the referencing loader with the referenced loader's
   `Parse*Id` function (spell, missile, sfx, text, item, monster, quest, set level, dungeon type).
   Missing targets are fatal at load, which gives "link-time" checking of the content graph.
5. **Validation performed at load**: numeric range by storage type (uint8 overflow is an error),
   enum vocabulary, array lengths, key order in sheets, class count cap, duplicate ids. **Not**
   validated at load (and therefore caught only at runtime or by tests): dangling sprite paths,
   affix/unique applicability consistency, drop-pool emptiness per level, and the stub `treasure`
   parser.
6. **Reload semantics**: toggling a mod re-runs the entire chain (text → … → quests) after
   remounting archives; all vectors are cleared first, so stale indices in live game state are
   impossible only because reload is forbidden mid-game.
7. **Runtime sanity tests** cover the content graph: "every unique item can actually drop in some
   level" and "vendor inventories generate in-range items for every quality level" run against the
   shipped tables.

### Reference tuning values

| Quantity | Value |
|---|---|
| Base item types / affix prefixes / suffixes / uniques | 168 / 83 / 95 / 90 |
| Monster types / named monsters / AI archetypes / monster-type cap | 112 / 100 / ~45 / 200 |
| Spells / missiles / missile sprites | 36 / 68 / 46 |
| Objects / object sprites / theme kinds | 109 / 62 / 17 |
| Quests / set levels / NPC roles / dialogue lines / sound ids | 24 / 5 (+3 arena) / 13 / 338 / 813 |
| Max character level / XP at max | 50 / 1,583,495,809 |
| Starting gold / loadout slots | 100 / 5 items + 1 skill + 1 spell |
| Attack action frame / attack frames | 9–11 of 16 (20 for heavy two-handers) |
| Monster HP range / level range / XP cap per kill | 1–1666 / 1–30 / ~tens of thousands |
| Affix level band / price multiplier band | 1–60 / -10..+15 |
| Unique item value band | 1,000–251,175 |

### Smallest buildable chunks

1. **Schema registry** — inputs: list of tables + column specs; outputs: a machine-readable schema
   (name, type, optional, enum vocabulary) per table; done when: a generator can emit both the C++
   struct and a modder-facing doc from it.
2. **Experience curve loader** — inputs: `Level/Experience` TSV; outputs: `threshold(level)`,
   `maxLevel()`; done when: gaps cap progression and `MaxLevel` rows are ignored.
3. **Class registry (record + 5 sheets)** — inputs: `classdat` + per-folder sheets; outputs: vectors
   of attributes/combat/loadout/sprites/anims/sounds indexed by class; done when: adding a 7th
   class folder needs zero code changes.
4. **Sound-effect table** — inputs: `effects.tsv`; outputs: id→(flags,path) and per-class voice
   gating; done when: a class voice set only loads when that class is active.
5. **Text table with extensible ids** — inputs: `textdat.tsv`; outputs: fixed-slot + appended ids,
   `\n` unescape; done when: a mod-added id resolves from quests and towners.
6. **Spell table** — inputs: `spelldat.tsv`; outputs: `SpellData[]` with 2-missile array fill; done
   when: a spell missing the second missile parses as `none`.
7. **Missile tables** — inputs: `misdat` + `missile_sprites`; outputs: handler-pointer binding by
   name, sprite metadata, lazy GFX load; done when: unknown handler name is a load error with row.
8. **Monster + unique monster tables** — inputs: two TSVs; outputs: fixed-slot/appended types,
   sprite-id dedup, escort pack enum; done when: 200-cap error and duplicate id error fire.
9. **Item, affix, unique tables with mapping ids** — inputs: 4 TSVs + base mapping id; outputs:
   vectors + `mappingId→index` maps; done when: a save written before a mod reorder still loads.
10. **Object table** — inputs: `objdat.tsv`; outputs: graphic-id dedup, theme/quest gating; done
    when: an object with both `levelType` and `quest` only places under both conditions.
11. **Quest table** — inputs: `questdat.tsv`; outputs: `QuestData[]` incl. SP/MP depth split;
    done when: `IsAvailable()` honours `isSinglePlayerOnly` under the multiplayer quest set.
12. **Towner table + quest-dialog matrix** — inputs: two TSVs; outputs: NPC placements, gossip
    lists, `(npc, quest) → text` lookup; done when: a matrix missing a quest column still loads.
13. **Reload orchestrator** — inputs: active mod list; outputs: deterministic reload order with
    all vectors cleared; done when: toggling a mod twice yields identical tables (hash compare).
14. **Content graph tests** — inputs: shipped tables; outputs: tests "all uniques can drop",
    "vendor gen per quality band", "every referenced sprite exists"; done when: CI runs them headless.
15. **Treasure column parser** — inputs: `treasure` strings; outputs: `None | Uniq(<unique-id>) |
    Item(<id>)` grammar replacing the stub; done when: any unique id can be a fixed drop.

### Pitfalls / design lessons

* Row order as identity leaks into saves and network packets; the mapping-id scheme fixed items
  but monsters, spells, missiles and objects still use raw indices — pick one scheme (string ids
  interned to stable integers persisted by name) from day one.
* Keep "handler by name" (missile `addFn/processFn`) — it let designers compose new missiles from
  existing behaviour without C++. Extend the idea to AI archetypes and object interactions.
* Per-class *sheets* (key/value) are friendlier than one wide row, but the strict key order makes
  adding a key a breaking change for every class folder; allow unordered keys with defaults.
* Stub parsers (`treasure` accepts two literal tokens) are debt that modders hit immediately.
* Validate the *graph* (dangling references, empty pools) in a headless "lint content" command,
  not only at first use.
* The expansion data pack ships as a *mod* containing full replacement TSVs (monsters, items,
  spells, missiles, towners, class attributes) plus a 2-line Lua init — proof that the table
  layer alone can express a content expansion.

---

## C. Save / load architecture

### Purpose

Persist one hero per save slot in a self-contained archive that contains: the hero's character
sheet and inventory (always), and — for single-player only — a "game" snapshot of the current
level plus one file per previously visited level, so that leaving and re-entering a level restores
its state. Everything that can be re-derived from a seed (level layout, initial monster/object/item
placement) is *not* stored; everything the player changed (killed monsters, opened doors, looted
or dropped items, explored map, quest flags, portals) *is* stored. The same packed hero structure
is also what peers exchange when joining a multiplayer game, with validation.

### Key data structures / schemas

#### C.1 Archive layout (one archive per hero slot; MPQ-style container or a plain directory)

| File inside archive | Written when | Contents | Encoding |
|---|---|---|---|
| `hero` | every save (SP and MP) | `PlayerPack` (fixed-size packed struct, see C.2) | codec-encrypted |
| `heroitems` | every save unless "vanilla saves" mode | 1 byte edition flag + 7 + 40 + 8 full item records (`SaveItem` format) — redundant with `hero` but lossless for extended fields | codec |
| `hotkeys` | every save unless vanilla | count byte + N spell ids (int32) + N spell types (uint8) + active spell + type | codec |
| `game` | SP save only | header magic + global game state + current level snapshot (C.4) | codec |
| `additionalMissiles` | SP save | version + count + missiles beyond the legacy cap of 125 | codec |
| `levelseeds` | SP save | per-level `present` byte + `uint32` RNG state captured after generation | codec |
| `perml00..perml24`, `perms00..perms08` | SP save (renamed from `templNN/tempsNN`) | one visited-level snapshot per dungeon depth / set level (C.5) | codec |
| `templNN/tempsNN` | on leaving a level mid-session | same as perm, promoted to perm on save, deleted on load | codec |
| stash archive: `spstashitems` / `mpstashitems` | when dirty | version byte, gold, page count, per-page 10×10 cell grid, item list, current page | codec |

Naming: `<mode>_<slot>.<ext>` where mode ∈ {single, multi, spawn, share} (shareware variants) and
the extension defaults to `sv`; an active mod may declare its own extension in its manifest so
mod saves never mix with base saves. Slots: 0..98 (`MAX_CHARACTERS = 99`).

#### C.2 `PlayerPack` (hero file, little-endian, `#pragma pack(1)`)

| Field | Type | Notes |
|---|---|---|
| `dwLowDateTime/HighDateTime` | 2×uint32 | legacy timestamp (unused) |
| `destAction, destParam1, destParam2` | int8 | pending action (legacy) |
| `plrlevel, px, py, targx, targy` | uint8 | current depth and tile |
| `pName[32]` | char | UTF-8, NUL-terminated |
| `pClass` | uint8 | clamped to loaded class count on load |
| `pBaseStr/Mag/Dex/Vit` | uint8 | base attributes (clamped to class max on load) |
| `pLevel, pStatPts` | uint8 | |
| `pExperience` | uint32 | |
| `pGold` | int32 | recomputed from inventory on net join |
| `pHPBase, pMaxHPBase, pManaBase, pMaxManaBase` | int32 | 26.6 fixed point raw |
| `pSplLvl[37]` + `pSplLvl2[10]` | uint8 | spell levels, split for backward compatibility |
| `pMemSpells` | uint64 | known-spell bitmask |
| `InvBody[7]`, `InvList[40]`, `SpdList[8]` | `ItemPack` | equipped, backpack, belt |
| `InvGrid[40]` | int8 | grid cell → inventory index (+1), negative = continuation cell |
| `_pNumInv` | uint8 | |
| `pTownWarps, pDungMsgs, pLvlLoad, pBattleNet, pManaShield, pDungMsgs2` | int8/uint8 | misc flags |
| `isExpansion` | int8 | 0 = base edition items, 1 = expansion item numbering |
| `wReflections` | uint16 | charges of a reflect buff |
| `pBossKillLevel` | uint32 | highest difficulty on which the final boss was killed (unlocks) |
| `pDifficulty` | uint32 | |
| `pDamAcFlags` | uint32 | expansion-only item flag bits |
| reserved | 1+2+2+20 bytes | future use |

#### C.3 `ItemPack` (19 bytes) — the "regenerate from seed" item record

| Field | Type | Meaning |
|---|---|---|
| `iSeed` | uint32 | RNG seed the item was rolled with |
| `iCreateInfo` | uint16 | creation flags + item level (see below) |
| `idx` | uint16 | base item mapping id (0xFFFF = empty), remapped for edition |
| `bId` | uint8 | bit0 identified, bits1+ magical quality |
| `bDur`, `bMDur` | uint8 | durability / max (255 → stored as 254) |
| `bCh`, `bMCh` | uint8 | charges / max |
| `wValue` | uint16 | gold amount (gold piles only) |
| `dwBuff` | uint32 | bit0 = expansion item; bits1-4 unique-id offset |

`iCreateInfo` bit layout (reference): bits 0-5 item level (0-63); bit 6 "only good"; bit 7
"unique-monster drop (uper 15)"; bit 8 "uper 1"; bit 9 unique; bits 10-14 one-hot vendor source
(smith, premium, boy, witch, healer); bit 15 pregenerated. `CF_TOWN` = any vendor bit, `CF_USEFUL`
= bits 7|8 both set means "useful consumable".

A special case: a trophy item that encodes another player's name packs the name bytes into the
seed/createinfo/durability/charge fields (7-bit chars) — a hack worth *not* copying; give such
items a real string field.

#### C.4 `game` file (SP snapshot of global state + current level)

Order (mix of LE and BE fields for historical reasons):
magic (4 bytes: one of four codes for {full, shareware} × {base, expansion}) → `setlevel` flag,
set-level id, current depth, level type, view x/y, inventory-open flag, char-sheet-open flag →
counts (monsters, items, missiles capped at 125, objects) → per depth (17 or 25): dungeon seed
(uint32) + level type → full `Player` record (hundreds of fields, not the pack) → quests (16 or
24 × state/var1/var2/log/msg/level/position) → portals (4) → kill counts per monster type (padded
to 200) → if not town: active monster ids + full monster records, missile id tables + missile
records, object id tables + records, lights, visions → dropped items → unique-dropped bitset →
`dLight`, `dFlags & SavedFlags`, `dPlayer` tile grids (112×112) → item index grid → if not town:
`dMonster` (int32 grid), `dCorpse`, `dObject`, `dLight` (again, a historical bug kept for
compatibility), `dPreLight`, automap explored grid (40×40), a "tile has missile" grid → vendor
premium-item count/level + up to 6/15 premium items → automap active + scale. Then
`additionalMissiles` and `levelseeds` as separate files.

#### C.5 Per-level file (`perml/perms`)

`dCorpse` grid (dungeon only) → counts → active monster ids + monster records → object id tables +
object records → dropped items → `dFlags & SavedFlags` grid → item index grid → (dungeon only)
`dMonster`, `dObject`, `dLight`, `dPreLight` grids + automap. Buffer sized 256 KiB; game file
320 KiB.

#### C.6 `SaveItem` full record (368 bytes base / 372 expansion)

Everything derived from the roll is written anyway (name, inscribed name, all `_iPL*` bonuses,
damage, AC, min stats, cursor, value, unique mapping id, affix indices, price components) with
explicit alignment skips. On load the engine *re-rolls from seed* (`RecreateItem`) and then
overwrites durability/charges/identified flags from the record — the record is a cache plus
a compatibility shim, the seed is the truth.

### Algorithms & rules

1. **Codec** (`codec_encode/decode`): per-file symmetric stream cipher keyed by a fixed password
   per mode (four 8-char passwords: single/multi × full/shareware). Key schedule: repeat password to
   64 bytes → custom SHA-1 variant → XOR into a fixed 16-word key → SHA state. Each 64-byte block:
   byte-swap to LE words, XOR with running digest, feed block into hash, swap back. Trailer (8 bytes):
   32-bit checksum (first digest word), error byte, last-chunk size. `decode` rejects size ≤ 8, size
   not a multiple of 64, error byte ≠ 0, checksum mismatch. This is tamper-evidence, not security
   (passwords are in source); a new engine should use a real MAC (e.g. HMAC-SHA-256 over
   plaintext) and skip encryption, or keep plaintext + checksum for debuggability.
2. **Hero checksum / integrity**: the `hero` file's codec checksum is the only integrity check in
   SP. In MP, integrity is enforced by *re-derivation*: the receiving peer regenerates every item
   from `(idx, iCreateInfo, iSeed)` and compares computed totals (strength, HP, damage, AC, hit
   bonus… 22 fields) against the sender's claimed totals; mismatch rejects the join. See D.
3. **Item regeneration** (`RecreateItem`): seed the global LCG with `iSeed`, apply base attrs for
   `idx` at `level/2`, then: town items → vendor path; "useful" → consumable path; else roll
   uniqueness (`CheckUnique` with unique-id offset from `dwBuff`), then affixes
   (`GetItemBonus`) or the unique's fixed powers. Gold uses `wValue`; empty idx clears. Because
   the same code produces drops in-game, a 19-byte pack is sufficient to reproduce a full item.
4. **Edition remapping**: base-edition and shareware editions enumerate items differently;
   `RemapItemIdx{To,From}{BaseEdition,Shareware}` translate ids at the pack boundary. Unknown/unavailable
   ids clear the item (`RemoveInvalidItem`), then `RemoveEmptyInventory` compacts the grid.
5. **Save sequence** (`SaveGame`): `SaveGameData` (writes `game` + `additionalMissiles` +
   `levelseeds`) → rename all `temp*` level files to `perm*` → pack hero → encode `hero` → `hotkeys`
   → `heroitems` → stash if dirty. The town level reseeds its dungeon seed on every save so shop
   stock re-rolls.
6. **Level change** (`pfile_save_level`): current level state → `templNN` (temp so an un-saved
   session can be abandoned); on load, temps are deleted first (`pfile_remove_temp_files`).
7. **Load sequence** (`LoadGame`): read `game`, validate magic (sets edition flag), read per-depth
   seeds, player, quests, portals; if the save's edition differs from the running edition, run
   `ConvertLevels` (load each existing level file with conversion tables for object/monster ids and
   rewrite it); then regenerate the current level from its seed (`LoadGameLevel(ENTRY_LOAD)`) and
   overlay the saved monsters/objects/items/grids. Visited flags (`_pLvlVisited`) decide whether a
   level is regenerated fresh or overlaid from its file.
8. **Seeds**: `DungeonSeeds[depth]` (uint32 per depth, derived from the game seed at game start,
   town excluded) feed the LCG before generation. `LevelSeeds[depth]` stores the LCG state captured
   *after* layout generation so that a later re-entry can reproduce post-layout rolls (monster
   placement etc.) even when generation code paths differ by entry type. Both are persisted.
9. **Versioning strategy**: no version number in `game`; compatibility is by *layout identity*
   with the 1990s original plus edition magic, padded reserved fields, and side files that are
   optional (`hotkeys` detects old 4-slot format by size; `additionalMissiles`/stash carry an
   explicit version byte). New data goes into new files, never into the legacy layout.
10. **Hero list for the menu**: iterate all 99 slots, open archive, read & unpack `hero`, load
    `heroitems`, drop invalid items, recompute derived stats, report name/level/class/stats and
    whether a `game` file exists.
11. **Demo-mode reference compare** (test aid): after replaying a recorded input demo, the engine
    writes a save and byte-compares each file with a reference save; mismatches are explained via
    a tiny memory-map DSL (`R <bits> name`, `M <count> <bits> name`, `C <count> <submap> name`,
    `LT`/`LC` to read loop counts, `_HF/_DA/_DL` suffixes to gate on edition/town) that names the
    first diverging field. This is how determinism regressions are caught.

### Reference tuning values

| Constant | Value |
|---|---|
| Save slots | 99 |
| Depths / set levels per save | 17 (base) or 25 (expansion); 9 set-level slots |
| Quests persisted | 16 / 24 |
| Vendor premium items persisted | 6 / 15 |
| Legacy missile cap in `game` | 125 (overflow in `additionalMissiles`, 180 bytes each) |
| Buffers | level 256 KiB, game 320 KiB |
| Tile grids | 112×112 (`MAXDUN`), automap 40×40 |
| Player name | 32 bytes; item name 64 bytes |
| Inventory | 7 equip slots, 40 grid cells, 8 belt slots, 12 hotkeys |
| Stash | 100 pages × 10×10 cells, 1 version byte |
| Item pack | 19 bytes; full item record 368/372 bytes |
| Codec block / trailer | 64 bytes / 8 bytes |
| Monster kill-count table padding | 200 entries |

### Smallest buildable chunks

1. **Archive abstraction** — inputs: directory or container path; outputs: `SaveReader/SaveWriter`
   with `HasFile/ReadFile/WriteFile/Rename/Remove`; done when: both a directory backend and a
   packed backend pass the same tests.
2. **Integrity wrapper** — inputs: plaintext bytes; outputs: bytes + MAC/checksum trailer, verify on
   read; done when: a flipped byte is rejected and the error names the file.
3. **Byte writer/reader helpers** — inputs: typed values; outputs: LE/BE writes, `Skip`, bounds
   checks that return 0 instead of overrunning; done when: a truncated file loads defaults safely.
4. **Item pack (seed-based)** — inputs: live item; outputs: `{seed, createInfo, idx, flags, dur,
   charges, value}`; done when: pack→unpack→pack is byte-identical for 1,000 random items.
5. **Item regeneration from seed** — inputs: pack; outputs: full item; done when: regenerated
   stats equal the original for every item class incl. uniques and vendor items.
6. **Hero pack/unpack with clamping** — inputs: player; outputs: fixed-size hero record; done when:
   out-of-range class/attributes clamp and gold duplicates get fresh seeds.
7. **Hero list scan** — inputs: 99 slots; outputs: name/level/class/has-game per slot; done when:
   a corrupted slot is skipped without aborting the menu.
8. **Side files (hotkeys, extra items, stash)** — inputs: player/stash; outputs: versioned small
   files; done when: an old-format hotkeys file (no header) still loads.
9. **Per-depth seed table** — inputs: game seed; outputs: `DungeonSeeds[]`, `LevelSeeds[]`
   persisted; done when: re-entering a level reproduces identical layout and spawns.
10. **Level snapshot writer** — inputs: live level; outputs: temp level file with monsters,
    objects, dropped items, flags, lights, automap; done when: leave+return restores every opened
    door and corpse.
11. **Level overlay loader** — inputs: regenerated level + snapshot; outputs: merged state; done
    when: killed monsters stay dead and picked-up items stay gone.
12. **Game snapshot** — inputs: globals; outputs: `game` file with magic/version; done when: load
    restores view position, open panels, quests, portals, kill counts.
13. **Temp→perm promotion** — inputs: temp files; outputs: renamed perm files on save, deleted on
    load; done when: quitting without saving discards level changes.
14. **Edition/version conversion** — inputs: old-format save; outputs: converted level files via
    load+save with id translation tables; done when: a base save opens under the expansion.
15. **Remove-invalid pass** — inputs: loaded inventory; outputs: cleared unknown items, compacted
    grid; done when: a save referencing a removed mod item loads with that slot empty.
16. **Memory-map diff tool** — inputs: two archives + map files; outputs: list of first differing
    fields; done when: a deliberate 1-field change is named exactly.
17. **Demo record/replay harness** — inputs: input events + tick decisions; outputs: deterministic
    replay with reference-save compare; done when: CI replays a 1→2 level demo bit-exact.
18. **Mod-scoped save namespace** — inputs: mod manifest `saveExtension`; outputs: separate file
    extension per total conversion; done when: enabling a mod hides base saves and vice versa.

### Pitfalls / design lessons

* Storing derived item stats *and* the seed invites divergence; store only what cannot be
  re-derived (seed, createinfo, mutable durability/charges/identified) plus a schema version.
* Avoid the "no version field, rely on layout identity" approach; put `{magic, version, flags}`
  at the top of every file and keep per-file versions for side files (the engine already does
  this for stash/missiles — generalise it).
* Mixed endianness inside one file (BE counts, LE fields) is a fossil; pick LE everywhere.
* Clamping unknown values on load (class, attributes, level) is the right default for SP
  robustness, but the *same* code path must not be reused for MP acceptance — MP needs rejection,
  not repair (the engine keeps two functions for this reason).
* Separating `templ` (session) from `perml` (committed) files gives "quit without saving" for free.
* Town shop stock re-seeding on save is a hidden rule players notice; make it explicit policy.
* A 7-bit name-in-numeric-fields encoding for trophy items is the kind of trick that later blocks
  UTF-8 names; add string fields instead.


---

## D. Multiplayer: deterministic lockstep, command catalog, delta sync, transport

### Purpose

Up to 4 peers run the *same simulation* with shared seeds. Each peer broadcasts (a) a tiny
"turn" token every N ticks that acts as a barrier so nobody simulates ahead, and (b) a stream of
small command packets describing player intent and authoritative events (hits, deaths, pickups).
Per-level change logs ("deltas") let a late joiner reconstruct levels nobody is standing on, and a
low-bandwidth monster position sync corrects drift for monsters whose AI ran on different peers.
Transport is pluggable: loopback (single player uses the same path), direct TCP with the host
acting as relay, or a virtual-LAN overlay with peer-to-peer packets.

### Key data structures / schemas

#### D.1 Session descriptor (`GameData`, 40 bytes LE, sent in join-accept)

| Field | Type | Meaning |
|---|---|---|
| `size` | int32 | struct size guard |
| `isSpawn` | uint8 | shareware edition flag — part of compatibility identity |
| `programid` | uint32 | 4-char cosmetic branding (mod may override) |
| `versionMajor/Minor/Patch` | uint8×3 | must equal the joiner's build |
| `nDifficulty` | enum | normal/nightmare/hell |
| `nTickRate` | uint8 | simulation ticks per second (reference 20) |
| `bRunInTown, bTheoQuest, bCowQuest, bFriendlyFire, fullQuests` | uint8 | rule toggles that change simulation |
| `gameSeed[4]` | uint32×4 | xoshiro128++ state; every peer derives `DungeonSeeds[1..N]` from it |

Compatibility rule (`IsGameCompatible`): exact version triple + edition flag. Mod identity is
hashed (SHA-256 of each packed mod archive, with manifest `compatibleWith` lists) and the menu
refuses multiplayer entirely if any `*.lua/*.tsv/*.sol` logic asset is overridden by loose files
("asset integrity gate").

#### D.2 Transport packet (dvlnet layer)

| Packet type | Dir | Payload |
|---|---|---|
| `PT_MESSAGE 0x01` | any→any/broadcast | opaque game message (`TPkt`) |
| `PT_TURN 0x02` | any→broadcast | `{seq_t sequence; int32 value}` |
| `PT_JOIN_REQUEST 0x11` | joiner→host | cookie, (password-derived key check) |
| `PT_JOIN_ACCEPT 0x12` | host→joiner | cookie, assigned player id, `GameData` |
| `PT_CONNECT 0x13` | host→all | announce new peer id (+ address for p2p) |
| `PT_DISCONNECT 0x14` | host/owner→all | peer id + leave reason |
| `PT_INFO_REQUEST/REPLY 0x21/0x22` | browser↔host | game list discovery (overlay LAN) |
| `PT_ECHO_REQUEST/REPLY 0x31/0x32` | any | latency probe |

Framing over TCP: 16-bit length prefix + 16-bit flags (`frame_queue`, max frame 64 KiB).
Optional encryption: libsodium `secretbox` with a key derived from the game password via
Argon2id (`PACKET_ENCRYPTION` build flag); nonce prefixed per packet.

Provider capabilities reported to the engine (`_SNETCAPS`): `maxmessagesize = 512`,
`maxplayers = 4`, `bytessec = 1,000,000`, `defaultturnssec = 10`, `defaultturnsintransit = 2`.

#### D.3 Game message envelope (`TPkt` = `TPktHdr` + up to 493 body bytes)

| Header field | Type | Meaning |
|---|---|---|
| `px, py` | uint8 | sender tile (authoritative position hint) |
| `targx, targy` | uint8 | sender walk target |
| `php, pmhp, mana, maxmana` | int32 | sender vitals (26.6 fixed) |
| `bstr, bmag, bdex` | uint8 | base attributes (cheap drift check) |
| `pdir` | uint8 | facing |
| `wCheck` | uint16 | marker/check word |
| `wLen` | uint16 | total length |

The body is a concatenation of commands, each starting with a 1-byte `_cmd_id`, parsed by
`ParseCmd` which returns the consumed size (0 = malformed → drop rest of packet).

#### D.4 Command catalog (`_cmd_id`, ~95 ids) grouped by category

| Category | Commands (body struct) |
|---|---|
| Movement / stance | `STAND` (none), `WALKXY` (loc), `SATTACKXY` shift-attack tile (loc) |
| Melee / ranged | `ATTACKXY`/`RATTACKXY` (loc), `ATTACKID`/`RATTACKID` monster (p1), `ATTACKPID`/`RATTACKPID` player (p1) |
| Spells | `SPELLXY` (loc + spell,type,level,from), `SPELLXYD` directional/wall (loc+4), `SPELLID` on monster (p5), `SPELLPID` on player (p5), `RESURRECT` (p1), `HEALOTHER` (p1), `REQUESTSPAWNGOLEM` (loc+1), `CHANGE_SPELL_LEVEL` (p2) |
| Objects / doors / traps | `OPOBJXY` (loc), `OPOBJT` telekinesis (loc), `DISARMXY` (loc), `OPENDOOR`/`CLOSEDOOR`/`OPERATEOBJ`/`BREAKOBJ` (loc), `KNOCKBACK` (p1) |
| Items on ground | `REQUESTGITEM`/`REQUESTAGITEM` (ask owner-of-level), `GETITEM`/`AGETITEM` (confirmed lift/loot), `GOTOGETITEM`/`GOTOAGETITEM` (walk then pick), `PUTITEM`, `SPAWNITEM`, `DROPITEM`, `SYNCPUTITEM`, `ITEMEXTRA` (all carry `TCmdGItem`/`TCmdPItem` = position + 19-byte item def) |
| Inventory / equipment | `CHANGEPLRITEMS`/`DELPLRITEMS` (equip slot), `CHANGEINVITEMS`/`DELINVITEMS` (grid), `CHANGEBELTITEMS`/`DELBELTITEMS` (belt) — carry `TCmdChItem` (slot + item def) |
| Character sheet | `ADDSTR/ADDMAG/ADDDEX/ADDVIT` (+delta), `SETSTR/SETMAG/SETDEX/SETVIT` (absolute), `PLRLEVEL`, `CHEAT_EXPERIENCE` (debug) |
| Health / death | `PLRDAMAGE` (damage + type), `PLRDEAD`, `PLRALIVE`, `RETOWN` (respawn in town), `SETSHIELD/REMSHIELD`, `SETREFLECT` |
| Monsters | `MONSTDAMAGE` (monster, dmg), `MONSTDEATH` (loc + monster), `SPAWNMONSTER` (pos, dir, type, id, seed), `SYNCDATA` (header + N `TSyncMonster`) |
| Levels / portals | `NEWLVL` (trigger kind, level), `WARP` (portal), `PLAYER_JOINLEVEL` (loc + level + set flag), `ACTIVATEPORTAL` (loc + level + type + set), `DEACTIVATEPORTAL` |
| Quests | `SYNCQUEST` (`TCmdQuest`: id, state, log flag, var1, var2, msg) |
| NPC | `TALKXY` (loc + towner) |
| Session | `SEND_PLRINFO`/`ACK_PLRINFO` (`TCmdPlrInfoHdr` + chunked `PlayerNetPack`), `DLEVEL`, `DLEVEL_JUNK`, `DLEVEL_END` (delta transfer), `STRING` (chat ≤ 80 chars), `FRIENDLYMODE`, `DEBUG`, two fake ids used only inside the receive buffer to tag sender / drop sender |
| Expansion-specific | three one-shot world events (open hive/grave, boss arena trigger) |

Body shapes: `TCmd {id}`, `TCmdLoc {id,x,y}`, `TCmdLocParam1..5`, `TCmdParam1/2/4`,
`TCmdGItem` (requester, origin, player, level, x,y, item def), `TCmdPItem` (x,y, item def),
`TCmdChItem` (slot, item def), `TCmdDamage` (player, dmg uint32, type), `TCmdMonDamage`,
`TCmdPlrInfoHdr` (offset, size), `TCmdString`, `TSyncHeader` (level, len, one ground item + one
equipped item sample), `TSyncMonster {idx, x, y, enemy, delta, whoHit, hp}`.

#### D.5 Delta (per-level change log kept by every peer for every level)

```
DLevel {
  TCmdPItem item[254];                              // 2×MAXITEMS: picked-up spawned items and dropped items
  map<tile, DObjectStr{cmd}> object;                // tile → last state-changing command (door open, chest looted…)
  map<index, DSpawnedMonster{type, seed, golemOwner, golemLvl}> spawnedMonsters;
  DMonsterStr monster[200] { pos, enemy, active, hp, whoHit };  // 0xFF = untouched
}
DJunk { DPortal portal[4] {x,y,level,ltype,setlvl}; MultiQuests quests[24] {state,log,var1,var2,msg}; }
LocalLevel { uint8 automap[40][40]; }               // per-peer, not shared
```
Export: per level `[0][levelId][items][objCount][(tile,cmd)*][monsters][spawnCount][(idx,rec)*]`,
PKWARE-compressed, sent as `CMD_DLEVEL` chunks; then `CMD_DLEVEL_JUNK`; then `CMD_DLEVEL_END`.
Worst-case receive buffer ≈ 1 + 1 + 254×item + 1 + 127×(tile+cmd) + 200×monster + 2 + 200×(2+rec).

### Algorithms & rules

1. **Tick & turn clock** (`nthread`): simulation runs at `nTickRate` Hz (`gnTickDelay = 1000 /
   rate` ms). Every `sgbNetUpdateRate` ticks (= `20 / defaultturnssec` → 2 ticks at 10 turns/s)
   the client must have received a turn token from *every connected peer* for the current turn
   number before advancing (`SNetReceiveTurns` → `AllTurnsArrived`). Up to `gdwTurnsInTransit`
   (2) turns are sent ahead so latency is hidden; if turns are missing the simulation stalls
   (hourglass) and `last_tick` is frozen so time does not "catch up" abruptly. A background
   thread (`NthreadHandler`) keeps sending/receiving turns under a mutex while the main thread is
   loading, so peers do not time out during level transitions.
2. **Turn token contents**: `turn & 0x7FFFFFFF` = sender's turn counter; top bit set = "I am new,
   please send me deltas" (set on join). `ParseTurn` derives `sgdwGameLoops = 4 × turns ×
   updateRate` so every peer agrees on a loop counter, and `MonsterSeeds()` reseeds each monster's
   `aiSeed` from that counter every tick → monster AI randomness is a pure function of the shared
   loop count and monster index, not of local RNG history.
3. **Message priority & batching**: commands are written into high/low priority ring buffers;
   every `sgbNetUpdateRate` ticks the engine flushes one `TPkt` of at most `gdwNormalMsgSize`
   bytes (computed from `bytessec × updateRate / 20 × 3/4 / players`, min 128, max 512) containing
   high-priority commands first, then low, then as many `TSyncMonster` records as fit. Anything
   that does not fit waits; commands are also loop-backed to the sender so local and remote
   peers apply them in the same order relative to turns.
4. **Determinism model**: *not* input-only lockstep. Player *intent* (walk, attack, cast) is sent
   as commands that every peer executes; but outcomes that depend on local RNG (hit rolls, damage,
   drops) are computed by the *acting* peer and broadcast as authoritative events (`MONSTDAMAGE`,
   `PLRDAMAGE`, `DROPITEM`, `MONSTDEATH`). Shared seeds guarantee identical *static* worlds
   (layout, initial monsters, objects, pre-placed items: all from `DungeonSeeds`); deltas and
   events reconcile *dynamic* state. Monster AI runs on every peer that has the level loaded,
   using the shared `aiSeed`; position drift is corrected by `SYNCDATA`.
5. **Monster sync** (`sync_all_monsters`): each flush picks up to N monsters by priority
   (Manhattan distance to the local player, +0x1000 if inactive, with an LRU so every monster is
   eventually sent; the first two slots round-robin through all monsters starting at `16 × playerId`
   so peers cover different ranges). Receiver (`SyncMonster`) accepts a remote position only if
   the remote peer is closer to that monster (or equal and lower player id = owner), the monster
   is not charging/petrified, and the tile is free; ≤2 tiles away → walk there, else teleport and
   restand. HP and `whoHit` are merged. Each `TSyncHeader` also carries one ground item and one
   equipped item sample for incremental verification.
6. **Level ownership for items**: picking up a ground item is a *request* (`REQUESTGITEM`) sent
   to the lowest-id peer on that level, who confirms with `GETITEM` (or re-spawns it if the
   request lost a race); `ITEMEXTRA` records items looted on levels the receiver has not visited
   so its delta stays consistent. Dropped items go through `PUTITEM`/`SYNCPUTITEM` with a nearby
   free-tile search identical on all peers.
7. **Join flow**: joiner connects (`PT_JOIN_REQUEST`) → host assigns the lowest free id and replies
   with `GameData` (seeds, rules) → host announces `PT_CONNECT` → joiner sends its first turn with
   the top bit set → `HandleTurnUpperBit` elects the lowest-id *other* connected peer as delta
   sender → that peer exports all `DLevel`s + junk → joiner buffers all incoming game messages
   (`gbBufferMsgs = 1`) until `DLEVEL_END`, shows a progress dialog (`WaitForTurns`, 2 s grace,
   chunks counted against `MaxChunks = levels + 4`), then replays buffered messages. Meanwhile
   everyone exchanges `SEND_PLRINFO` (packed hero, chunked in ≤ ~480-byte pieces) and validates
   it (`UnPackNetPlayer`); a peer that fails validation is dropped after 15 s. A peer whose turns
   stop arriving triggers a 10 s warning and a 20 s hard drop of inactive players (`BeginTimeout`).
8. **Validation on receive** (every handler): bounds on positions (`InDungeonBounds`), monster
   index < 200, enemy id validity, level id ≤ max, packet size via `ValidateCmdSize`, item
   create-flag combinations (`IsCreationFlagComboValid`: pregen never in inventory, "useful" has no
   other flags, at most one vendor flag), vendor item level ≤ 30 (or ≤ max char level for the
   "boy" vendor), unique-monster drop level must equal some unique monster's level, dungeon item
   level must equal some spawnable monster's level or ≤ 2×(max depth-1), belt items must be 1×1
   usable non-gold, equipped items must fit their slot, and the 22 derived-stat equality checks.
   Failures log `ValidateField(name: value, condition)` and emit a chat event naming the player.
9. **Timed messages** (`tmsg`): commands the local player should see with a 10-tick delay
   (e.g. own-item pickup echo) are queued with a timestamp and injected later as if received.
10. **Leaving**: `PT_DISCONNECT` with reason (normal, game won, timeout); the engine marks the
    player left, drops their delta role, and frees their monsters/portals.
11. **Single player uses the same pipeline** via the loopback provider: commands still go through
    the queue, so SP/MP behaviour stays identical and demos can be recorded as command streams.

### Reference tuning values

| Constant | Value |
|---|---|
| Max players | 4 |
| Tick rate | 20 Hz default (configurable; stored in `GameData`) |
| Turns per second / ticks per turn | 10 / 2 |
| Turns in transit (send-ahead) | 2 |
| Message size: max / normal budget / body | 512 B / 128–512 B (bandwidth formula) / 493 B |
| Chat max length | 80 chars |
| Monster sync: priority inactive penalty / max delta | +0x1000 / 255 |
| Monster sync round-robin start | 16 × playerId |
| Player-info validation timeout | 15 s |
| Turn stall: warn / drop | 10 s / 20 s |
| Join delta grace before counting chunks | 2 s |
| Delta capacity | 254 items, 127 objects, 200 monsters per level |
| Timed message delay | 10 ticks |
| Position resync threshold | remote > 3 tiles from local estimate |
| Levels addressable | 25 depths + 8 set levels (`MaxMultiplayerLevels`) |
| Max packed hero chunk | `gdwNormalMsgSize − header` |

### Smallest buildable chunks

1. **Transport interface** — inputs: `create(addr)/join(addr)`, `send/receive message`,
   `send/receive turn`, caps, events; outputs: abstract class + loopback impl; done when: SP runs
   entirely through loopback.
2. **Frame codec** — inputs: byte buffers; outputs: length-prefixed frames with flags; done when:
   fragmented TCP reads reassemble and oversize frames error.
3. **Packet schema** — inputs: packet types table; outputs: serializer/deserializer with
   `expected<_, PacketError>`; done when: fuzzed random bytes never crash.
4. **TCP host/relay** — inputs: listening port; outputs: host assigns ids, relays broadcasts,
   times out half-open sockets; done when: 4 clients join and chat.
5. **Turn barrier** — inputs: per-peer turn queues; outputs: `AllTurnsArrived`, send-ahead window;
   done when: artificial 300 ms latency keeps 2 peers in lockstep with no divergence.
6. **Shared loop counter & AI seeding** — inputs: turn number; outputs: `gameLoops`, per-monster
   seeds; done when: two peers log identical monster decisions for 10,000 ticks.
7. **Command envelope & dispatcher** — inputs: body bytes; outputs: `ParseCmd` with size
   validation; done when: a truncated command drops only the rest of that packet.
8. **Priority buffers & flush** — inputs: commands; outputs: ≤512 B packets per turn with hi→lo→sync
   ordering; done when: bandwidth stays under the formula at 4 players.
9. **Movement/attack/cast commands** — inputs: player input; outputs: intent commands executed
   on all peers; done when: remote players animate within one turn of local.
10. **Authoritative event commands** — inputs: local combat results; outputs:
    damage/death/drop events; done when: monster HP matches on all peers after a fight.
11. **Item ownership protocol** — inputs: pickup requests; outputs: lowest-id-arbiter confirm,
    race re-spawn; done when: two peers clicking one item never duplicate it.
12. **Equipment/inventory sync** — inputs: inventory changes; outputs: change/delete commands with
    item defs; done when: inspecting a remote player shows correct gear.
13. **Quest & portal sync** — inputs: state changes; outputs: `SYNCQUEST`, portal activate/deactivate;
    done when: a joiner sees existing portals and quest log.
14. **Delta log** — inputs: pickups, drops, object ops, monster deaths/HP; outputs: `DLevel` per
    level; done when: leaving and re-entering a level with another peer present reproduces state.
15. **Delta export/import** — inputs: all `DLevel`s; outputs: compressed chunked transfer + progress
    dialog; done when: a joiner at minute 30 sees the same world as the host.
16. **Monster drift sync** — inputs: active monsters; outputs: prioritised `TSyncMonster` batches;
    done when: monsters near a remote peer converge within a few seconds without rubber-banding.
17. **Hero validation on join** — inputs: packed hero; outputs: accept/reject with logged reason;
    done when: an edited save with impossible stats is refused.
18. **Item legitimacy rules** — inputs: `(idx, createInfo, seed)`; outputs: pass/fail by drop
    source; done when: fixture items from every source pass and forged levels fail.
19. **Session descriptor & compatibility** — inputs: version, edition, rules, seed; outputs:
    join-accept payload + compatibility check; done when: mismatched version gets a clear error.
20. **Mod identity hashing** — inputs: active mod archives; outputs: SHA-256 list + manifest compat;
    done when: differing mod sets are reported before joining.
21. **Timeout & drop handling** — inputs: missing turns; outputs: warn at 10 s, drop at 20 s; done
    when: a killed peer does not freeze the others for more than 20 s.
22. **Latency probes & game browser** — inputs: echo packets; outputs: per-peer RTT, LAN game list;
    done when: lobby shows ping.
23. **Packet encryption (optional)** — inputs: password; outputs: Argon2id key + secretbox; done
    when: wrong password cannot join.
24. **Demo/command recording** — inputs: local command stream + tick decisions; outputs: replayable
    file; done when: replay reproduces a save byte-for-byte.

### Pitfalls / design lessons

* The hybrid model (intent lockstep + authoritative events + periodic position sync) tolerates
  non-determinism in AI/combat code at the cost of a large command catalog and many validation
  rules. A new engine with fully deterministic simulation could send *only* inputs and a state
  hash, but must then forbid floats, iteration over hash maps, and platform-dependent RNG — the
  reference engine's use of an LCG, fixed-point, and seeded per-monster AI shows what that takes.
* Make every packet size-checked and every index bounds-checked at the *dispatcher*; the engine
  retrofitted `ValidateField` macros across ~90 handlers after shipping.
* "Lowest connected id is the authority" is simple and robust to host migration — keep it.
* Delta capacity caps (254 items/level) are silent truncation risks; use growable logs with a
  byte budget and compression.
* Join-time hero validation by *re-deriving* stats from seeds is the strongest anti-cheat tool in
  the design and costs nothing extra; keep item generation pure so it stays possible.
* Letting SP run through loopback transport is what made the demo-replay determinism tests possible.
* Integrity gating of loose logic assets (refuse MP if any `.lua/.tsv` is overridden locally)
  is cheap and prevents the most common "accidental desync via mod" support ticket.


---

## E. Lua modding / scripting layer

### Purpose

Give mod authors three capabilities without recompiling: (1) *replace* any data table or asset by
shipping a file at the same virtual path (archive overlay), (2) *extend* tables by registering
additional TSV files from Lua at well-defined load events, and (3) *react* to a small set of
gameplay events (store opened, damage taken, XP gained, frame drawn, game start) with sandboxed
Lua, including drawing text and playing sounds. A manifest gives each mod identity (name,
version, dependencies, save namespace, compatibility hashes) so saves and multiplayer sessions can
reason about which mods are active.

### Key data structures / schemas

#### E.1 Mod package layout

```
mods/<modname>/                    (loose directory, searched in pref path then base path)
  manifest.ini                     optional metadata (see E.2)
  lua/mods/<modname>/init.lua      entry point, run in a sandbox at mod load
  txtdata/**/*.tsv                 overrides or additional tables
  <any asset path>                 overrides sprites, sounds, levels, UI art
mods/<modname>.mpq                 same tree packed; identified by SHA-256 of the archive bytes
```
Reference: the expansion pack is exactly such a mod (`mods/<expansion>`): 13 replacement TSVs, two set-level
`.dun` files, a few UI sprites, a palette, a manifest, and a 4-line `init.lua` that calls
`expansion.loadData()` (mount the expansion's core archives) and `expansion.enable()`.

#### E.2 `manifest.ini` (`[mod]` section; all keys optional)

| Key | Meaning |
|---|---|
| `name`, `description`, `version`, `author`, `homepage`, `license` | display / future online archive |
| `saveExtension` | save-file extension for this total conversion (last active mod wins; default `sv`) |
| `programId` | 4-char cosmetic id shown in the game browser |
| `requires` | list of mod names that must load first (drives load order) |
| `compatible` | list of 64-hex SHA-256 ids of earlier releases whose saves this one can load |

`ModIdentifier { name, sha256 hash, whitelisted, manifest }` is recorded per active packed mod
in load order; built-ins and provenance-whitelisted hashes carry an all-zero hash.

#### E.3 Lua runtime shape

* Lua 5.4 via sol2; libraries opened: base, coroutine, debug (debug builds only), math, os,
  package, string, table, utf8.
* **Sandbox per mod** (`CreateLuaSandbox`): fresh environment exposing `print` (to the in-game
  console), `_DEBUG`, `_VERSION`, a whitelist of built-ins (`assert, warn, error, ipairs, next,
  pairs, pcall, select, tonumber, tostring, type, xpcall, rawequal, rawget, rawset, setmetatable`),
  the packages `base, coroutine, table, string, math, utf8`, `os` restricted to
  `date/difftime/time`, a custom `require` that resolves `a.b.c` → `lua/a/b/c.lua` **through the
  asset VFS** (so mods can override engine scripts), with bytecode caching per path, and a few
  global enums (sound ids).
* **Engine packages** (preloaded, importable with `require`):

| Package | API surface (reference) |
|---|---|
| `engine.events` | event table; each event has `add(fn)`, `remove(fn)`, `trigger(...)` |
| `engine.items` | `Item` userdata: `isEmpty/isWeapon/isArmor/isHelm/isShield/isJewelry/isGold/isUsable/isScroll(Of)/isRune(Of)`, `getName`, `getTextColor(WithStatCheck)`, `clear`, `pop`, `keyAttributesMatch`, `updateRequiredStatsCacheForPlayer`, `setNewAnimation`; table fns `addItemDataFromTsv(path, baseMappingId)`, `addUniqueItemDataFromTsv(path, baseMappingId)` |
| `engine.monsters` | `addMonsterDataFromTsv(path)`, `addUniqueMonsterDataFromTsv(path)` |
| `engine.player` | `self()` → `Player` userdata with vitals fields and `addExperience`, `addItem`, `hasItem`, `removeItem`, `restoreFullLife`, `restoreFullMana`; `addClassDataFromTsv(path)` |
| `engine.towners` | `addDialogOption(townerName, label, onSelect)` (cleared on reload), `position()` |
| `engine.render` | `string(text, x, y)`, `screen_width()`, `screen_height()`, `is_small_font_tall()` |
| `engine.audio` | `playSfx(id)`, `SfxID` enum |
| `engine.i18n` | `translate`, `plural_translate`, `particular_translate`, `language_code` |
| `engine.log` | `info/warn/error/debug` |
| `engine.system` | `get_ticks()` |
| `engine.floatingnumbers` | spawn a floating combat number |
| `engine.message` | show a red event message |
| `engine.version` | engine version string |
| `engine.expansion` (expansion glue) | `loadData()`, `enable()` |
| `engine.dev` (debug builds) | console cheats: `monster.spawn/spawnUnique`, `items.spawn/…`, `level.seed/map/warp/exportDun`, `player.god/invisible/…`, `quests`, `towners.talk`, `display.fps/fullbright/grid/…`, `search`, `player.walk_to/visit` |
| `inspect` | pretty-printer (loaded unsandboxed, shared) |

Each exported function is registered with a signature string (`LuaSetDocFn(table, "name",
"(args)", fn)`) that feeds an in-game REPL with autocompletion and docstrings
(`metadoc.hpp`, `autocomplete.cpp`, `repl.cpp`, `assets/lua_internal/get_lua_function_signature.lua`).

#### E.4 Event bus (`assets/lua/engine/events.lua`, loaded unsandboxed and shared)

| Event | Fired from | Args | Typical use |
|---|---|---|---|
| `LoadModsComplete` | after all tables reloaded | — | post-processing |
| `ItemDataLoaded` | after base item table, before uniques | — | `items.addItemDataFromTsv` |
| `UniqueItemDataLoaded` | after unique table | — | `items.addUniqueItemDataFromTsv` |
| `PlayerDataLoaded` | after class list table, **before per-class folders are read** | — | `player.addClassDataFromTsv` |
| `MonsterDataLoaded` / `UniqueMonsterDataLoaded` | after respective tables | — | add monsters |
| `GameStart` | each new game | — | reset mod state |
| `GameDrawComplete` | end of every frame | — | overlays (clock mod) |
| `StoreOpened` | opening a vendor | towner name | shop hooks (mana-refill mod) |
| `OnMonsterTakeDamage` | combat | monster, damage, type | floating damage numbers mod |
| `OnPlayerTakeDamage` | combat | player, damage, type | |
| `OnPlayerGainExperience` | XP award | player, exp | floating XP mod |

The C++ side calls `events.<Name>.trigger(...)` through a protected call; errors are logged, never
fatal. `trigger` returns the last handler's return value (used nowhere critical today, but the
plumbing exists for "return-value" hooks).

### Algorithms & rules

1. **Mod load order** (`LoadModArchives`): read each active mod's manifest `requires` in a
   pre-pass, topologically order so dependencies load first; for each mod in that order register
   loose override directories (pref path, then base path), then the user's pref path itself as a
   final override root; then mount packed archives with increasing priority starting at 10,000
   (later = overrides earlier). Core archives sit at 1,000 (main data), 8,000 (expansion data),
   9,000 (engine assets), 9,100 (language), 9,200 (fonts). Lookup order for a path: absolute path
   → override directories → archives by descending priority → `assets/` next to the binary.
2. **Reload** (`LuaReloadActiveMods`, also run on any change to the mod options): reload the shared
   events script, clear towner dialog options, reset the expansion flag, unmount mod archives,
   remount per the new list, run each `mods.<name>.init` in a fresh sandbox (missing init is OK),
   run registered C++ "mods changed" handlers, reload sound table, and reload *every* content table
   in the fixed order. Mod toggling is only permitted outside a running game.
3. **Adding content from Lua**: inside the matching `*DataLoaded` handler the mod calls the
   `add*FromTsv(path[, baseMappingId])` function, which loads the TSV through the VFS and calls the
   same `Load*FromFile` routine the core uses with `grow=true`/append semantics. For classes the
   hook is deliberately placed between the class-list table and the per-class folder reads, so
   appended classes get their five sheets loaded by the normal path (recent change: "let mods add
   player classes from TSV"). Class/monster/unique-base caps still apply.
4. **Gameplay hooks** are thin: C++ passes raw pointers wrapped as userdata with read-only or
   narrowly mutable fields; Lua cannot allocate monsters/items except through curated functions.
5. **Multiplayer safety**: `HasLooseLogicAssets()` scans override directories for `*.lua`,
   `*.tsv`, `*.sol` (and flags uppercase variants/backup dirs appropriately); if any is found the
   multiplayer menu is refused. Packed mods are hashed; the intent (documented in the manifest
   struct) is to compare the active mod identifier list between peers and to stamp saves with the
   required identifiers so a save declares which mod releases can open it.
6. **Save namespace per total conversion**: `saveExtension` from the manifest changes the hero
   archive extension (`single_0.hsv` vs `single_0.sv`), isolating character lists per mod set.

### Reference tuning values

| Quantity | Value |
|---|---|
| Lua version | 5.4.6 |
| Mod archive priorities | 10,000 + load index; core 1,000 / 8,000 / 9,000 / 9,100 / 9,200 |
| Events exposed | 11 |
| Engine Lua packages | 15 (+ dev module in debug builds) |
| Bundled sample mods | 4 (floating damage numbers, floating XP, vendor mana refill, on-screen clock) + 1 expansion pack |
| Manifest keys | 10 |
| Mod hash | SHA-256 of archive bytes; 64-hex ids in `compatible` |
| Per-class cap when adding classes | 255 |

### Smallest buildable chunks

1. **Override-path VFS** — inputs: ordered list of roots/archives; outputs: single `FindAsset`
   with priority; done when: a loose file beats a packed one and a later mod beats an earlier one.
2. **Mod discovery & options** — inputs: `mods/` dirs and archives; outputs: enable/disable list
   persisted in settings; done when: toggling fires a reload callback.
3. **Manifest parser** — inputs: INI text; outputs: struct with required/compatible lists,
   malformed hashes skipped; done when: 17 manifest tests pass (fields, empty, invalid hex).
4. **Dependency ordering** — inputs: manifests; outputs: topological load order; done when: a
   mod requiring another always loads after it, cycles are reported.
5. **Lua state + sandbox** — inputs: Lua 5.4; outputs: per-mod environment with whitelisted
   globals and restricted `os`; done when: `io`/`load`/`dofile` are unreachable from a mod.
6. **VFS-backed `require`** — inputs: dotted module names; outputs: loader through asset lookup
   with bytecode cache; done when: a mod can override an engine script by path.
7. **Event bus** — inputs: event names; outputs: `add/remove/trigger` tables + C++ trigger helper
   with protected calls; done when: a throwing handler logs and does not abort.
8. **Data-extension hooks** — inputs: `*DataLoaded` events; outputs: `add*FromTsv` functions calling
   the core loaders in append mode; done when: a mod adds an item, a unique, a monster and a class.
9. **Mapping-id discipline for mods** — inputs: `baseMappingId`; outputs: collision detection; done
   when: two mods with the same base fail loudly at load, not at save.
10. **Gameplay userdata** — inputs: player/item/monster structs; outputs: curated read/write
    bindings with doc signatures; done when: REPL autocompletion lists them with signatures.
11. **Render/audio/i18n bindings** — inputs: engine services; outputs: `render.string`,
    `audio.playSfx`, `i18n.translate`; done when: the clock sample mod runs.
12. **Towner dialog options** — inputs: name + label + callback; outputs: extra menu entries cleared
    on reload; done when: an option survives a level change but not a mod toggle.
13. **Loose-logic integrity gate** — inputs: override roots; outputs: boolean + MP refusal
    message; done when: a stray `.tsv` in the user folder blocks MP in release builds only.
14. **Mod identity hashing** — inputs: archive bytes; outputs: SHA-256 (chunked), whitelist; done
    when: hash matches a one-shot reference and a missing file fails gracefully.
15. **Save-extension namespacing** — inputs: manifest; outputs: hero archive extension; done when:
    base and conversion saves never appear in the same list.
16. **In-game REPL** — inputs: console input; outputs: evaluation in a dev sandbox with
    autocomplete; done when: `player.self().mana` prints.
17. **Expansion-as-mod** — inputs: expansion tables/assets; outputs: a packaged mod whose init
    mounts data and flips a flag; done when: enabling it changes class list and monster set with
    zero engine code paths keyed on the mod name.

### Pitfalls / design lessons

* Keep *data extension* (TSV append at load events) separate from *behaviour hooks* (runtime
  events). The former is deterministic and MP-safe when all peers share the mod; the latter needs
  to be either purely cosmetic or replicated — the engine's events are mostly cosmetic for this
  reason.
* Firing "data loaded" events *between* dependent tables (class list → per-class folders) is a
  simple, powerful pattern; design every multi-stage loader with an extension point after the
  index table.
* A sandbox is not optional: mods load from untrusted archives and run every frame.
* Integer "mapping ids" chosen by mod authors are a coordination hazard; a registry of string ids
  (`modname:itemname`) interned at load is friendlier and still save-stable.
* A single `programId`/`saveExtension` "last active mod wins" rule is ambiguous with multiple
  total conversions; prefer computing the save namespace from the ordered mod identity list.
* Hash-based mod identity plus `compatible` lists is the right primitive for both save
  compatibility and MP join checks — finish wiring it into the join handshake from day one.

---

## F. Asset pipeline: archive VFS, sprite formats, palettes and light tables

### Purpose

Serve every file the game needs (tables, scripts, sprites, sounds, levels, fonts, translations)
through one lookup that layers user overrides, mod archives and core archives; decode legacy
sprite formats into one runtime sprite format; and render 8-bit palettised sprites through
lighting lookup tables rather than per-pixel colour math.

### Key data structures / schemas

#### F.1 Virtual file system

| Element | Description |
|---|---|
| `AssetRef` | either `(archive*, hashIndex, filename)` or a direct `SDL_IOStream*`; `isOverridden` flag |
| `AssetHandle` | open stream with `read/seek`; `OpenAsset(ref, threadsafe)` clones the archive handle for background threads |
| `MpqArchives : map<int priority, Archive, greater<>>` | mounted archives, highest priority first |
| `OverridePaths : vector<string>` | loose directories consulted before any archive |
| Build flag `UNPACKED_MPQS` | replaces archives with plain directories (the same priority map holds directory paths) |
| Helpers | `LoadFileInMem<T>`, `LoadAsset`, `LoadIntegralAsset`, `FindMPQ(paths, name)`, `LoadMPQ(paths, name, priority)` |

Core mounts at startup: main data archive (priority 1,000, or shareware archive), optional
expansion archive (8,000; after which the presence of specific files decides whether the extra
class / music / voice packs are available), engine asset archive (9,000; may be absent when
assets are loose next to the binary), language pack (9,100), font pack (9,200). Search roots for
archives: executable dir, pref dir, config dir, platform data dirs, known store install paths.

#### F.2 Archive container

A hash-table-indexed archive (`mpqfs` library): `Open/OpenWithSDL/Clone`, `HasFile`,
`GetFileSize`, `FindHash → index` (resolve once, reuse), `ReadFile(name) → bytes`. The writer side
(`MpqWriter`, hash table size 2,048) supports `WriteFile`, `RenameFile`, `RemoveHashEntry` and is
used for *save games*, not for shipping assets. Compression inside archives uses PKWARE DCL
(`PkwareCompress/Decompress` in `encrypt.cpp`) and zlib/bzip2 as provided by the library. Build
scripts pack the loose `assets/` tree into `engine.mpq` and `mods/<expansion>/` into `<expansion>.mpq` with an
external tool when available; otherwise the game loads the loose directories.

#### F.3 Sprite formats

| Format | Role | Notes |
|---|---|---|
| CEL | legacy 8-bit RLE sprites (items, objects, UI) | decoded at load into CLX (`cel_to_clx`) using per-frame width lists supplied by code or `*-widths.txt` sidecars |
| CL2 | legacy 8-bit RLE sprites (characters, monsters, missiles) with 32-row block offsets | converted at load (`cl2_to_clx`) |
| **CLX** | runtime format | same pixel encoding as CL2 (RLE runs: transparent run / opaque run / fill run), but each frame has a 6-byte header `{uint16 headerSize, uint16 width, uint16 height}` and no block table; a list is `[uint32 count][uint32 offsets…][frames]`, a sheet is a list of lists |
| PCX | UI art / screenshots | decoded to CLX; may carry a 256-colour palette |
| `.trn` | 256-byte palette translation table (recolour a sprite) | applied per sprite list copy |
| `.pal` | 256×RGB palette per level type / UI screen | |
| `.dun` | level set-piece tiles (uint16 grid) | used by generators and tests |

Loader API shape: `Load{Cel,Cl2,Clx,Pcx}[Sheet|ListOrSheet][WithStatus|Optional](path, width(s))`
returning owned sprite lists (`OwnedClxSpriteList`) or `expected<…, string>` for soft failure.
`ClxSprite` is a non-owning view: `width()`, `height()`, `pixelData()`, `pixelDataSize()`.

#### F.4 Palette & lighting

| Element | Value |
|---|---|
| Palette | 256 entries (logical palette → system palette with brightness/gamma applied) |
| Light levels | 16 (`LightsMax = 15` darkest + fully lit), each a 256-byte index→index table (`LightTables[16][256]`) |
| Radii | 16 light radii with precomputed falloff `LightFalloffs[16][128]` and 8×8×16×16 cone interpolation tables |
| Special tables | infravision (monster highlight), stone (petrify), pause (greyed) — each 256 bytes |
| Lights per level / visions | 32 / 4 |
| Transparency | palette-blend lookup tables (`palette_blending`), optional 128 KiB LUT for blending with black |
| Colour cycling | per-level palette index ranges animated (water, lava) |

### Algorithms & rules

1. **Lookup**: `FindAsset(path)` normalises `\` → `/`, tries absolute, override dirs in order,
   archives by priority, then the `assets/` dir, then platform bundles. Only loose overrides are
   logged (verbose) and flagged as overridden for the integrity gate.
2. **Decode-at-load to one format**: all legacy formats become CLX in memory; renderers only know
   CLX. Width metadata that CEL lacks is supplied by the caller or sidecar files.
3. **Palette rendering**: a sprite pixel is a palette index; drawing at light level L writes
   `LightTables[L][index]`. Per-pixel lighting (optional) interpolates between adjacent tiles'
   levels using the cone tables. Because all colour math is table lookups, blending and lighting
   are deterministic and cheap on low-end hardware.
4. **Palette translations** implement monster/class variants (`trnFile`, `trn` columns) by
   rewriting indices once at load — the same sprite memory serves many variants.
5. **Threaded loading**: `OpenAsset(ref, threadsafe=true)` clones the archive handle so sprite
   decoding can run on worker threads during level load.
6. **Budgeting**: the monster table's `image` column (a size weight) is summed per level to cap
   how many monster types a level may contain under the legacy memory budget.

### Reference tuning values

| Quantity | Value |
|---|---|
| Archive priorities | main 1,000; expansion 8,000; engine 9,000; language 9,100; fonts 9,200; mods ≥10,000 |
| Writer hash table | 2,048 entries |
| CLX frame header | 6 bytes |
| Palette size / light levels / radii | 256 / 16 / 16 |
| Max lights / visions per level | 32 / 4 |
| Sprite widths used | 96, 128, 160 (monsters), 96/128 (heroes), 64 (objects) |
| Fonts | separate archive; tall small font (16 px) for CJK, 12 px otherwise |

### Smallest buildable chunks

1. **VFS core** — inputs: roots and archives; outputs: `find/open/read` with priority; done when:
   override tests (loose > mod > core) pass.
2. **Archive reader** — inputs: container files; outputs: hash lookup + read; done when: 10k
   lookups/sec on a 10k-file archive.
3. **Archive writer (saves)** — inputs: files; outputs: write/rename/remove with carry-forward;
   done when: a 25-file save archive round-trips.
4. **Runtime sprite format** — inputs: RLE pixel stream + frame header; outputs: `Sprite`,
   `SpriteList`, `SpriteSheet` views; done when: a decoder/encoder round-trip is lossless.
5. **Legacy decoders** — inputs: CEL/CL2/PCX; outputs: runtime sprites; done when: golden tests
   (opaque runs end at line ends; odd PCX widths) pass.
6. **Palette + translation tables** — inputs: `.pal`, `.trn`; outputs: logical/system palette,
   recoloured copies; done when: a recoloured sprite differs only in mapped indices.
7. **Light tables** — inputs: palette; outputs: 16 darkening tables, infravision/stone/pause tables,
   falloff and cone tables; done when: generated tables match the reference checksum.
8. **Blending LUTs** — inputs: palette; outputs: 256×256 blend table (+black LUT); done when:
   blend test passes and benchmark meets budget.
9. **Threaded asset open** — inputs: refs; outputs: clone-per-thread handles; done when: parallel
   decoding during level load has no data races (TSAN build).
10. **Asset packaging step** — inputs: `assets/` tree; outputs: engine archive built by CMake when
    the packer exists, loose fallback otherwise; done when: both modes boot.
11. **Sidecar width metadata** — inputs: `*-widths.txt`; outputs: per-frame widths for width-less
    formats; done when: a mod can ship a new CEL with a sidecar.
12. **PNG atlas path (for a new engine)** — inputs: PNG atlases + JSON frame metadata + 256-colour
    palette; outputs: same `Sprite` views (indexed) ; done when: an atlas exported from a modern
    tool renders through the same light tables.

### Pitfalls / design lessons

* Converting at load to one runtime format was the single best decision in this layer: three
  legacy formats, one renderer. A new engine should do the same with **indexed PNG atlases** as
  the *source* format: keep 8-bit indices (not RGBA) so palette lighting, translations and
  deterministic blending keep working; store per-frame `{x,y,w,h,anchor}` in a sidecar JSON; let
  the build step compile atlases into the runtime RLE format so the renderer still skips
  transparent runs cheaply.
* Width-less sprite formats force metadata into code (`sprites.tsv` widths, missile `width`
  columns). Put dimensions in the asset.
* Priority numbers are magic; expose them as named layers (core, expansion, engine, lang, fonts,
  mods) and reserve ranges.
* Logging only *loose* overrides, and treating them as an integrity signal, is useful; keep it.
* The per-level "image budget" is a legacy memory constraint — drop it, but keep a per-level cap
  on distinct monster sprite sets for streaming reasons.


---

## G. Build & project structure

### Purpose

One CMake tree that builds the same engine for desktop (Windows/macOS/Linux/BSD/Haiku), mobile
(Android, iOS), consoles/homebrew (several handheld toolchains under `CMake/platforms/`), web
(Emscripten) and DOS-era targets, with every third-party dependency either found on the system or
vendored, and with the engine split into ~62 internal object libraries so tests can link only what
they need and dependency direction is enforced by the build.

### Key data structures / schemas

#### G.1 Top-level layout

```
CMakeLists.txt            options, policies, C++23, LTO/PGO, sanitizers, packaging hooks
CMakePresets.json         named configure presets
CMake/                    Assets.cmake (asset list + archive build), Mods.cmake (mod archive build),
                          Dependencies.cmake (system-or-vendored resolution), Definitions.cmake,
                          Platforms.cmake + platforms/*.cmake|toolchain, Tests.cmake,
                          finders/Find*.cmake, functions/*.cmake (object-library helper, copy_files, …)
Source/                   engine (see G.3); Source/CMakeLists.txt declares every internal library
3rdParty/                 vendored deps (fetched or in-tree)
assets/                   engine-owned data: txtdata/, lua/, lua_internal/, fonts, UI art, cursors…
mods/                     bundled mods (the expansion pack)
test/                     gtest/benchmark sources + fixtures/
tools/                    packer install scripts, translation extraction/validation, PGO/benchmark drivers
Translations/             gettext .pot + 27 .po files
Packaging/, android-project/, uwp-project/   platform shells
docs/                     building, installing, debugging, profiling, changelog
vcpkg.json                manifest for Windows/vcpkg builds (features: sdl1|sdl2, encryption, translations, tests)
```

#### G.2 Build options (reference)

| Option | Default | Effect |
|---|---|---|
| `USE_SDL1` / `USE_SDL3` | OFF | backend selection (SDL2 default) |
| `NONET` | OFF | strip networking (loopback only) |
| `NOSOUND` | OFF | strip audio |
| `BUILD_TESTING` | ON | tests + benchmarks |
| `UNPACKED_MPQS` | OFF | load converted loose directories instead of archives |
| `UNPACKED_SAVES` | OFF | directory saves instead of archive saves |
| `DISABLE_DEMOMODE` | OFF | remove demo record/replay |
| `DISCORD_INTEGRATION` | OFF | rich presence |
| `SCREEN_READER_INTEGRATION` | OFF | accessibility TTS |
| `PACKET_ENCRYPTION` (via libsodium presence) | platform | encrypted transport |
| `BUILD_ASSETS_MPQ` / `BUILD_MOD_MPQS` | ON if packer found | pack `assets/` and `mods/<expansion>/` |
| `DISABLE_LTO`, `PIE`, `ASAN/UBSAN/TSAN`, `GPERF`, `ENABLE_CODECOVERAGE`, `ENGINE_PROFILE_GENERATE/USE` | — | toolchain knobs |
| `ENGINE_SYSTEM_<dep>` / `ENGINE_STATIC_<dep>` | per dep | system vs vendored, static vs shared |
| `DISABLE_STREAMING_MUSIC/SOUNDS`, `ENGINE_RESAMPLER_SPEEX`, `ENGINE_PALETTE_TRANSPARENCY_BLACK_16_LUT` | — | platform work-arounds / perf |

#### G.3 Dependencies

| Dependency | Purpose | Resolution |
|---|---|---|
| SDL2 (or SDL1.2 / SDL3) + SDL_image | window, input, IO streams, audio device, image decode | system or vendored |
| SDL_audiolib (or SDL3_mixer) | mixing, resampling (Speex optional) | vendored |
| zlib, bzip2 | archive decompression | system or vendored |
| libsodium | packet encryption, password hashing | optional |
| asio (header-only) | TCP sockets | vendored |
| libzt (ZeroTier) + lwIP | virtual LAN overlay transport | vendored, optional |
| Lua 5.4 + sol2 | scripting | system or vendored |
| magic_enum | enum ↔ string reflection for TSV parsing | vendored |
| unordered_dense | fast hash maps | system or vendored |
| tl::function_ref, tl::expected (std::expected on C++23) | utilities | vendored |
| SheenBidi | bidirectional text (RTL languages) | system or vendored |
| libsmackerdec | video playback | vendored |
| mpqfs | archive read/write | vendored |
| PicoSHA2 | SHA-256 for mod identity | vendored |
| find_steam_game | locate store installs | vendored |
| googletest / benchmark | tests | vendored or vcpkg |
| gettext tools | compile `.po` → `.mo` | optional |
| simpleini | INI settings | vendored |

#### G.4 Internal library graph (selection of the 62 object libraries)

Leaf utilities: `paths, file_util, ini, log, utf8, strings, format_int, parse_int, random, ticks,
direction, surface, palette_blending, light_tables, crawl, pathfinding, endian_write,
format_int, static_vector` → data layer: `txtdata` (A), `textdat, questdat, parse_sfx_id,
parse_dungeon_type, dun_tile_data, town_data` → engine services: `assets, mpq, codec, load_cel,
load_cl2, load_clx, load_pcx, cel_to_clx, cl2_to_clx, pcx_to_clx, clx_render, dun_render,
light_render, primitive_render, text_render, text_input, lighting, vision, headless_mode,
game_mode, options, mod_identity, init` → gameplay: `items, monster, player, spells, quests,
level_objects, gendung, stores, multiplayer, control, controller_buttons, padmapper,
control_mode, quick_messages, utils_console` → `libengine` (everything else, still ~64k
lines in flat `Source/*.cpp`) → `game` executable and `libengine_so` (shared, exports
all symbols for tests).

### Algorithms & rules

1. **System-or-vendored resolution** (`dependency_options(name, SYSTEM_default, STATIC_var)`):
   try `find_package`; on failure or when the user opts out, `add_subdirectory(3rdParty/<dep>)`
   with `EXCLUDE_FROM_ALL`. Every dependency has a header-only or static fallback so cross-compiles
   never need a sysroot.
2. **Asset packaging**: `CMake/Assets.cmake` lists every shipped engine asset explicitly (not a
   glob) so packaging is reproducible; if the archive packer is installed, a custom command builds
   the engine archive from that list, otherwise the list is installed as loose files and the VFS
   falls back to the `assets/` dir. The same for the bundled mod via `Mods.cmake`.
3. **Platform layering**: `Platforms.cmake` includes one `platforms/<target>.cmake` that sets
   definitions (`NONET`, `NOSOUND`, unpacked modes), toolchains and packaging; `Source/platform/`
   holds the small per-platform shims (locale detection, console keyboard/display/network/random
   services, iOS paths). Everything else is portable C++23 + SDL.
4. **Test linkage**: the engine is compiled once into object libraries; `libengine_so` is a
   shared library exporting all symbols (`WINDOWS_EXPORT_ALL_SYMBOLS`, `API_FOR_TEST`) so
   each test executable links fast and can poke globals.
5. **Translations**: `.po` files compile to `.mo` at build time (gettext tools) and are packed
   into the language archive; `tools/` has extraction (`xgettext`-style over sources *and* TSV
   text columns), `.pot` update and validation scripts.
6. **Source distribution / reproducibility**: `make_src_dist.py`, pinned vcpkg baseline, PGO
   scripts, big-endian test runner (QEMU s390x Docker image) to keep byte-order bugs out of the
   save/net code.

### Reference tuning values

| Quantity | Value |
|---|---|
| CMake minimum / C++ standard | 3.22 / C++23 |
| Internal object libraries | 62 (+ umbrella + shared test lib) |
| Vendored third-party packages | 26 |
| Platform cmake files | ~20 (desktop, 5 handhelds/consoles, Android, iOS, Emscripten, DOS, Amiga, Haiku…) |
| Translations | 27 languages + template |
| Build options | ~35 |

### Smallest buildable chunks

1. **Skeleton CMake with presets** — inputs: none; outputs: configure presets for debug/release/
   sanitizer; done when: `cmake --preset` works on 3 OSes.
2. **Dependency resolver helper** — inputs: dep name; outputs: system-or-vendored switch with
   static option; done when: offline build succeeds with all vendored.
3. **Object-library helper** — inputs: target name + sources; outputs: object lib with warnings as
   errors and dependency declaration; done when: a cyclic dependency fails configure.
4. **Leaf utility libs** — paths, file util, logging, UTF-8, string formatting, RNG, fixed point;
   done when: each has a standalone test.
5. **Data-layer libs** — TSV core + each table loader as its own library; done when: `txtdata`
   links without SDL.
6. **Engine services libs** — VFS, archive, decoders, renderers, lighting, options; done when:
   headless mode builds without a window.
7. **Gameplay libs** — items, monsters, players, spells, quests, levels, stores, multiplayer; done
   when: the umbrella library shrinks below the per-file 2,000-line guideline.
8. **Asset list + packer step** — inputs: asset manifest; outputs: optional archive + loose
   fallback; done when: both boot paths are CI-tested.
9. **Mod packaging step** — inputs: `mods/<name>/`; outputs: archive with manifest; done when: the
   hash of the built archive is stable across machines (deterministic packer).
10. **Translation pipeline** — inputs: `.po`; outputs: `.mo` in the language archive + extraction
    script that includes TSV text; done when: a new UI string appears in the `.pot` automatically.
11. **Platform shims** — inputs: per-platform needs; outputs: `platform/<x>/` with locale, paths,
    input; done when: adding a platform touches only `CMake/platforms` and `Source/platform`.
12. **Sanitizer & big-endian CI** — inputs: test suite; outputs: ASAN/UBSAN/TSAN jobs + emulated
    big-endian job; done when: save/net tests pass on both byte orders.
13. **Packaging** — inputs: binaries + archives; outputs: per-platform installers/bundles; done
    when: a clean VM installs and launches.

### Pitfalls / design lessons

* The 62-library split is recent and partial; the flat umbrella still holds 64k lines with
  cross-includes everywhere. Start modular: no gameplay file may include another gameplay
  module's internals, only its public header, and the build should enforce it.
* Listing assets explicitly beats globbing for reproducible packages and for noticing stray files.
* Keep "headless" a first-class configuration: the test suite, content linting, and dedicated
  servers all need the engine without a window or audio device.
* Vendoring everything with a system-first switch is more work up front but is what makes a
  dozen exotic platforms possible.

---

## H. Test strategy

### Purpose

Catch determinism regressions (RNG, level generation, item generation, save layout, replay),
protect format round-trips (TSV, sprites, pack/unpack, codec), and unit-test pure logic (paths,
geometry, inventory rules, stores, UI state machines) — all headless, with fixtures checked in,
and with optional access to the commercial data files for the few tests that need them (they skip
when the data is absent).

### Key data structures / schemas

#### H.1 Test inventory (file → what it covers)

| Test file | Cases | Covers |
|---|---|---|
| `data_file_test` | 16 | TSV core: CR/CRLF/LF, no trailing newline, empty, BOM, header mapping, record iteration, int parsing, discard semantics |
| `parse_int_test` | 3 | integer and fixed-point text parsing |
| `random_test` | 9 | LCG engine params, `abs` handling, mod/shift distributions, sign carry, negative returns — pins the exact RNG sequence |
| `fixed_point_test` | 23 | 26.6/10.6 arithmetic, overflow-safe widening |
| `drlg_l1/l2/l3/l4_test` | 19/8/9/7 | **golden level generation**: for `(depth, seed)` pairs, generate and compare the 40×40 tile grid to a checked-in `.dun` fixture (base edition, expansion tilesets, quest-level variants) |
| `drlg_common_test` | 2 | rectangle range iteration, theme-room sizing |
| `tile_properties_test` | 3 | solid/walkable/can-step |
| `path_test` + `path_benchmark` | 12 | A* heuristics, diagonal-first rule, long paths, closest reachable |
| `crawl_test` + benchmark | 2 | spiral/visitation order used by vision & spawn search |
| `vision_test` | 3 | line of sight rules |
| `items_test` | 2 | **content graph**: every unique (base and expansion) can drop somewhere |
| `vendor_test` | 12 | vendor inventory generation per vendor and quality band, both editions |
| `pack_test` | 54 | item pack/unpack for base/shareware/expansion/multiplayer, gold sizes, trophy items, empty, unique bug compatibility; net-pack player round-trips |
| `writehero_test` | 1 | end-to-end hero write, byte-exact |
| `codec_test` | 2 | encoded length math |
| `timedemo_test` | 1 | **replay determinism**: play back a recorded demo (level 1→2) and compare the resulting save against a reference, field-by-field via memory maps |
| `inv_test`, `inventory_ui_test`, `stash_test` | 18/15/45 | inventory rules, auto-equip/auto-place, gold handling, stash paging/placement |
| `stores_test`, `store_transaction_test`, `visual_store_test` | 10/33/41 | repair pricing, affordability incl. stash gold, buy/sell filters, store UI state |
| `player_test` | 2 | hit-recovery state, character creation defaults from class tables |
| `animationinfo_test` | 7 | frame timing with fast-attack/fast-block/recovery modifiers |
| `missiles_test`, `math_test`, `rectangle_test`, `scrollrt_test` | 3/3/3/13 | direction quantisation, world↔screen transforms, tiles-in-view per resolution |
| `automap_test`, `cursor_test`, `dead_test`, `game_pause_test` | 11/1/2/1 | map zoom/scroll, cursor, corpse placement, pause |
| `quests_test`, `townerdat_test`, `town_registry_test` | 2/9/23 | SP quest pool selection, towner table + quest-dialog matrix, town registry |
| `mod_identity_test` | 17 | SHA-256 vectors, chunked read, manifest parsing, compat rule |
| `assets_test` | 9 | loose-logic integrity gate heuristics |
| `multi_logging_test` | 4 | leave-reason formatting |
| `cl2_to_clx_test`, `pcx_to_clx_test`, `reencode_dun_cels_test`, `palette_blending_test` | 1/5/1/1 | sprite decoders, blend LUT |
| `text_render_integration_test`, `sheen_bidi_test`, `utf8_test` | 1/16/17 | glyph rendering golden image, bidi runs, UTF-8 codec |
| `char_panel_test`, `panel_state_test`, `spell_ui_test`, `game_menu_test` | 16/37/13/14 | UI state machines |
| `ini_test`, `file_util_test`, `format_int_test`, `str_cat_test`, `static_vector_test`, `appfat_test`, `effects_test` | small | utilities |
| Benchmarks | — | CLX render, dungeon render, light render, palette blending, path, crawl |

Two test groups in CMake: "tests" (link the full engine shared lib; may need game data; use the
shared `test_main`) and "standalone" tests (link only the libraries under test — the modular
split pays off here).

#### H.2 Fixtures

* `test/fixtures/{base,expansion,levels}/<depth>-<seed>.dun` golden level layouts (~45 files);
  entries also exercise set-level variants and quest-dependent layouts.
* `test/fixtures/txtdata/*.tsv` — 8 edge-case TSVs.
* `test/fixtures/memory_map/*.txt` — 14 memory-map files describing the byte layout of `hero`,
  `game`, `level`, `item`, `itemPack`, `monster`, `missile`, `object`, `player`, `portal`, `quest`,
  `lightning`, `levelSeed`, `additionalMissiles` for the save-diff tool.
* `test/fixtures/timedemo/<name>/` — recorded input demo + reference save + options.
* `test/fixtures/text_render_integration_test/` — golden glyph images.
* `test/Fixtures.cmake` copies fixtures next to the test binaries.

### Algorithms & rules

1. **Golden generation tests**: set `LevelSeeds[depth] = nullopt`, `currlevel`, allocate tiles
   for the level type, `CreateDungeon(seed, entry)` + theme rooms, then compare every tile id to
   the fixture; failure message names the first mismatching coordinate. Fixtures are produced by
   the engine itself (`dev.level.exportDun`) once a layout is accepted.
2. **Replay determinism**: demo mode records every SDL event with modifier state plus each game
   loop's "run/draw" decision and simulated clock; playback feeds the same stream, then the save is
   written and compared with the reference (byte compare per file; on mismatch, the memory-map DSL
   walks both buffers in lockstep to name the diverging field and count occurrences). Loops in the
   DSL read counts from earlier fields (`LC`), gate by town level (`LT`, `_DL`) and by edition.
3. **RNG pinning**: tests assert the LCG multiplier/increment, the `abs(INT_MIN)` special case,
   and the high-bits-for-small-ranges rule — any change silently breaks all seeds, so the tests
   make that change loud.
4. **Content tests use shipped tables**: "all uniques can drop" iterates uniques and checks that
   some monster/level combination yields their base kind at a valid level; vendor tests roll
   inventories at quality levels 1–5, 25, 30+ and assert the price/level invariants the net
   validator relies on — the same functions the MP join check uses.
5. **Data-dependent tests skip** (`GTEST_SKIP`) when the commercial data archives are missing,
   so CI can run most of the suite from the open assets.
6. **Benchmarks** share fixtures with tests and are run by `tools/build_and_run_benchmark.py`
   with CPU-variance reduction scripts for Linux.

### Reference tuning values

| Quantity | Value |
|---|---|
| Test executables | 38 engine-linked + 19–21 standalone |
| Test cases | ≈ 900 |
| Golden level fixtures | ≈ 45 `(depth, seed)` layouts, 7 tilesets |
| Memory-map files | 14 |
| Replay demos | 1 (level 1→2) |
| Big-endian CI | via emulation container |

### Smallest buildable chunks

1. **Test harness** — inputs: gtest; outputs: shared `test_main`, headless init, fixture copying;
   done when: an empty test links in < 2 s incremental.
2. **RNG pin tests** — inputs: engine RNG; outputs: 9 tests asserting constants and sequences;
   done when: changing the multiplier fails CI.
3. **TSV edge-case fixtures** — inputs: 8 files; outputs: 16 tests; done when: all pass.
4. **Golden level exporter + tests** — inputs: `(depth, seed)`; outputs: `.dun` fixtures and one
   test per fixture; done when: 10 layouts per tileset are pinned.
5. **Item pack round-trip tests** — inputs: representative items per source; outputs: 50+ cases;
   done when: shareware/base/expansion remaps are covered.
6. **Content-graph tests** — inputs: tables; outputs: "all uniques droppable", "vendor bands",
   "all referenced ids resolve"; done when: a broken row fails a test, not the game.
7. **Save memory maps + diff tool** — inputs: layout specs; outputs: DSL files and a comparator;
   done when: a planted 1-byte difference is named.
8. **Demo recorder/player** — inputs: SDL events + loop decisions; outputs: replay harness; done
   when: a 2-minute demo replays bit-exact on two OSes.
9. **Net validation tests** — inputs: forged hero packs; outputs: rejection cases per rule; done
   when: each `ValidateField` rule has a negative test.
10. **Decoder goldens** — inputs: tiny sprites; outputs: round-trip and edge-case tests (odd
    widths, run boundaries); done when: fuzzing the decoders finds no crash.
11. **UI state-machine tests** — inputs: panel/store/menu controllers; outputs: open/close/
    exclusivity tests; done when: controllers are testable without rendering.
12. **Sanitizer + big-endian jobs** — inputs: suite; outputs: CI matrix; done when: green.
13. **Benchmarks with baselines** — inputs: render/path/light hot paths; outputs: benchmark
    binaries + variance-reduced runner; done when: a 10 % regression is visible in CI output.

### Pitfalls / design lessons

* The most valuable tests here are *golden determinism* tests (levels, replay, RNG) — invest in
  the exporter/comparator tooling early; it doubles as a desync debugger.
* Tests that need commercial data should skip, not fail; keep an open asset set sufficient for
  most of the suite.
* The memory-map DSL exists because save structs are hand-serialised; with a schema-driven
  serializer the diff tool comes for free.
* Exporting all symbols from a shared engine library for tests is pragmatic but couples tests
  to globals; standalone tests against small libraries are the better pattern and became possible
  only after the library split.

---

## I. Settings schema, localization, platform & presence glue

### Purpose

Persist user preferences in an INI with typed entries, categories, validation and change
callbacks; translate all UI and data text via gettext catalogs with plural rules; isolate
platform specifics; and optionally publish presence to a chat service.

### Key data structures / schemas

#### I.1 Options model (`options.h`)

`OptionEntryBase { key, flags, name, description, onChanged }` with typed subclasses
`OptionEntryBoolean`, `OptionEntryInt<T>` (optional allowed-value list), `OptionEntryEnum<E>`,
`OptionEntryString`, `OptionEntryResolution`, `OptionEntryResampler`, `OptionEntryAudioDevice`,
`OptionEntryLanguageCode`, keymapping/padmapping action entries. Flags: `Invisible`,
`CantChangeInGame`, `CantChangeInMultiPlayer`, `NeedBaseData`, `NeedExpansionData`,
`RecreateUI`, `ModifierKey`… Categories (`OptionCategoryBase` with name/description):

| Category | Entries (reference) |
|---|---|
| GameMode | `gameMode` (base/expansion/ask), `shareware` |
| StartUp | intro per edition, splash |
| per-edition | last SP hero, last MP hero |
| Audio | sound/cue/music volume, walking/auto-equip/pickup sounds, sample rate, channels, buffer size, resampler, quality, device |
| Graphics | resolution, fullscreen, fit-to-screen, upscale, scale quality, integer scaling, frame-rate control, brightness, zoom, per-pixel lighting, colour cycling, alternate art, hardware cursor (+ for items, max size), show FPS |
| Gameplay | `tickRate` (invisible, default 20), run in town, grab input, pause on focus loss, optional quest toggles, friendly fire, MP full quests, test classes, XP bar, HP/mana numbers, party portraits, enemy health bar, floating info box, auto-pickup gold/elixirs/oils/in town, auto-equip weapons/armor/helms/shields/jewelry, randomize quests, show monster type, show item labels, auto-refill belt, disable crippling shrines, quick cast, N potions to pick up ×6, store UI style, loading-screen skip threshold |
| Controller | mapping/dead zones |
| Network | bind address, `port`, overlay network id |
| Chat | quick messages |
| Language | `code` |
| Keymapper / Padmapper | action → key / button tables |
| Mods | one `enabled` boolean per discovered mod (dynamic) |

Game-rule entries that affect simulation (`tickRate`, run in town, quest toggles, friendly fire,
full quests) are copied into `GameData` at game creation so every peer shares them.

#### I.2 Localization

* `_()`, `ngettext()`, `pgettext()`, `N_()`, `P_()` macros over `LanguageTranslate*`.
* Catalogs: GNU `.mo`/`.gmo` binary files loaded from the VFS (language archive or loose);
  parsed into two flat key/value arenas with packed `(offset,size)` refs and hash maps per plural
  form; `Plural-Forms` header is parsed for `nplurals` and a small set of recognised `plural=`
  expressions (unknown expression logs an error and falls back to `n != 1`).
* `GetLanguageCode()` from options or OS locale; `IsSmallFontTall()` switches to a 16 px small
  font for CJK.
* Data-table strings (item names, dialogue, quest titles) are run through `_()` at display time
  and extracted into the `.pot` by `tools/extract_translation_data.py`; translator comments
  (`/* TRANSLATORS: … */`) accompany format strings. A glossary file keeps term consistency.
* 27 shipped languages including RTL (bidi via SheenBidi) and CJK.

#### I.3 Platform & presence

* `Source/platform/`: locale detection (desktop), and per-console shims (display, keyboard,
  network, random, romfs, docking) for two handheld consoles and one 3D handheld; Android/iOS
  path and lifecycle glue; a macOS SDL1 filesystem shim; an Amiga `strerror_r`.
* `Source/discord/`: optional rich presence — `StartGame/UpdateGame/UpdateMenu` no-ops when the
  SDK is absent.

### Algorithms & rules

1. Options load from `<game>.ini`-style file in the config path (portable mode if the ini sits
   beside the binary); unknown keys are preserved; each entry validates on set and fires
   `onChanged` (e.g. mods list → Lua reload; resolution → recreate UI).
2. Entries flagged `CantChangeInMultiPlayer`/`CantChangeInGame` are greyed in menus rather than
   silently ignored.
3. Translation lookup is O(1) hash per call with string_view returns guaranteed NUL-terminated,
   so hot UI paths can call `_()` every frame.

### Reference tuning values

| Quantity | Value |
|---|---|
| Option categories / entries | 14 / ~110 (+ dynamic mod toggles, ~60 key actions) |
| Default tick rate | 20 |
| Default network port | configurable `uint16` |
| Potion auto-pickup counters | 6 entries |
| Languages | 27 |

### Smallest buildable chunks

1. **Typed option entries** — inputs: key/default/flags; outputs: bool/int/enum/string entries with
   validation and change callbacks; done when: an invalid INI value falls back to default.
2. **Categories + INI persistence** — inputs: entries; outputs: load/save preserving unknown keys;
   done when: round-trip is lossless.
3. **Game-rule → session copy** — inputs: gameplay entries; outputs: `GameData` fields; done when:
   a joiner adopts the host's rules.
4. **Dynamic mod toggles** — inputs: discovered mods; outputs: entries created at startup with
   reload callback; done when: toggling reloads tables.
5. **gettext catalog reader** — inputs: `.mo`; outputs: hash maps per plural form; done when:
   a 4-plural-form language resolves correctly.
6. **Translation extraction tool** — inputs: sources + TSV text columns; outputs: `.pot`; done
   when: new data strings appear without manual listing.
7. **Locale detection shims** — inputs: OS APIs; outputs: BCP-47-ish code; done when: each
   platform returns a sensible default.
8. **Presence integration (optional)** — inputs: game state; outputs: no-op fallback when SDK
   absent; done when: builds without the SDK are unaffected.

### Pitfalls / design lessons

* Treat any option that changes simulation as a *session rule* (serialized into the session
  descriptor) and lock it in multiplayer; the reference engine's `Invisible` tick-rate entry is a
  reminder that "settings" and "rules" need different homes.
* Strings inside data tables must be reachable by the extraction tool; the reference engine
  solved this with a custom script — a schema flag `translatable` on columns is cleaner.
* Keep platform code tiny and behind SDL; the whole platform layer here is < 1 % of the code.


---

## Recommended project skeleton for a new engine

Derived from what worked (data layer, VFS, decode-to-one-format, seed-based items, loopback SP,
golden tests) and what hurt (flat 64k-line umbrella, hand-serialised saves, positional TSVs,
raw-index identity, hybrid netcode with ~90 validated handlers).

### Directory layout (language-agnostic)

```
/engine-root
  /build                      build scripts, presets, dependency resolution (system-or-vendored), packaging
  /third_party                vendored deps, each with a pinned version and license
  /tools
    /content-lint             loads all tables headless, validates the reference graph, prints every error
    /atlas-pack               indexed PNG + JSON frames  →  runtime RLE sprite archives
    /pak                      deterministic archive packer (sorted entries, fixed timestamps)
    /save-diff                schema-driven save comparator (replaces the memory-map DSL)
    /i18n                     string extraction from code + translatable table columns
    /demo                     record / replay / compare harness
  /src
    /core                     allocators, fixed-point, RNG (LCG for sim, xoshiro for seeds), hashing, utf8, logging, expected/result types
    /platform                 window, input, audio device, filesystem roots, locale  (SDL or equivalent; nothing above this layer touches OS APIs)
    /vfs                      layered lookup: loose override dirs → mod archives → core archives → bundled; archive read/write; integrity signals
    /data                     table parser (TSV/JSON), schema registry, typed readers, error collector
    /tables                   one module per content table: schema + struct + loader + id registry (classes, items, affixes, uniques, monsters, uniques, spells, missiles, objects, quests, npcs, dialogue, sounds, experience)
    /assets                   sprite/palette/light-table/sound loaders built on vfs; one runtime sprite format
    /sim                      deterministic simulation only: world grid, pathfinding, vision, players, monsters, missiles, items, objects, quests, level generation, RNG streams per subsystem — NO rendering, NO OS, NO floats
      /levelgen
      /combat
      /loot
      /ai
    /commands                 command catalog (schema-generated encode/decode + validation), command queue, timed/delayed commands, delta log per level
    /net                      transport abstraction (loopback, tcp host/relay, overlay/p2p), turn barrier, join handshake, session descriptor, mod identity check, encryption
    /persist                  schema-driven serializer with versioned chunks; hero file, game snapshot, per-level snapshots, stash; migration table
    /script                   Lua (or other) runtime, sandbox, event bus, data-extension hooks, curated bindings, REPL/autocomplete docs
    /render                   palette renderer, lighting, tile/sprite/text drawing, UI widgets (consumes sim read-only)
    /audio                    mixer, positional sfx, music streaming
    /ui                       menus, HUD, panels, stores, options UI (state machines testable headless)
    /app                      main loop, game-mode orchestration, demo mode, headless mode entry, settings
  /assets
    /tables/<domain>/*.tsv    (or json) — schema-validated content
    /schemas/*.json           machine-readable table schemas (types, enums, optionality, translatable, id-refs)
    /lua/engine/*.lua         event bus, prelude, docs
    /lua/mods/<sample>/       sample mods
    /sprites/atlases          indexed PNG + json (source), compiled by atlas-pack
    /palettes, /lights, /fonts, /sounds, /levels (set pieces), /ui
  /mods/<name>/               manifest + overrides + lua/mods/<name>/init.lua (same tree as assets)
  /tests
    /unit                     per-library tests (standalone link)
    /golden                   level layouts, sprite decodes, text rendering, save snapshots
    /determinism              RNG pins, replay demos, two-peer lockstep simulation (loopback × 2 in one process)
    /content                  graph lint as tests (uniques droppable, vendor bands, dangling refs)
    /fixtures
  /docs                       format specs (table format EBNF, sprite format, save format, protocol), modding guide
```

### Module dependency graph (arrows = "may depend on")

```
platform ──► core
vfs ──► core, platform
data ──► core, vfs
tables ──► data                      (tables never include sim/render)
assets ──► vfs, core                 (+ tables only for metadata like sprite widths if unavoidable)
sim ──► core, tables                 (pure; no vfs/platform/render; RNG injected)
commands ──► sim, core               (encode/decode/validate; applies commands to sim)
net ──► commands, core, platform     (transport + barrier; no sim internals)
persist ──► sim, tables, vfs, core   (serializer reads sim state; regeneration via sim)
script ──► tables, sim (read-mostly), assets, vfs, core
render ──► sim (read-only views), assets, platform, core
audio ──► assets, platform, core
ui ──► render, audio, commands (to issue intents), persist (hero lists), script (dialog options)
app ──► everything above
tests ──► any library directly (standalone), app for integration
```

Rules worth enforcing in the build:

1. `sim` has no dependency on `render`, `vfs`, `platform`, or `net`; it is the only place
   gameplay state mutates, and it mutates only through `commands` and its own tick.
2. `tables` never depend on `sim`; `sim` indexes tables through stable ids resolved at load.
3. `persist` and `net` share *one* schema-generated set of packed records (hero, item, command
   bodies) rather than two hand-maintained copies.
4. Single player runs `net/loopback` with the same command queue; demo recording lives in
   `commands`, not in input handling.
5. Every table loader exposes an "append from file" entry point so `script` can extend data at
   defined load events; every table id is a string interned to an integer and persisted *by
   string* in saves and by integer in packets (with the mapping sent in the session descriptor or
   derived from the shared mod set).
6. All content validation errors are collected and reported together by `tools/content-lint`,
   which is also the first CI job.

### Suggested first milestones (dependency-ordered across systems)

1. core + platform + vfs (loose dirs only) + data parser + schema registry + content-lint.
2. tables for classes/experience/items/affixes/uniques/monsters/spells/missiles/objects/quests/npcs/text/sounds with the content tests.
3. assets: atlas-pack tool, runtime sprite format, palettes, light tables; render a static scene.
4. sim: grid, RNG streams, pathfinding, level generation with golden tests, players/monsters/items with seed-based item generation and pack/unpack round-trip tests.
5. commands + loopback net + demo record/replay; app main loop; headless mode.
6. persist: hero file, game snapshot, per-level snapshots, stash; save-diff tool; migration table.
7. net: TCP host/relay, turn barrier, join handshake, deltas, validation, two-peer determinism test.
8. script: sandbox, event bus, data-extension hooks, bindings, REPL; expansion-as-mod proof.
9. ui/audio polish, options, localization pipeline, packaging, platform ports.

---

## Content budget

How much content the reference game ships, measured from the tables and enums (base edition plus
expansion where the expansion mod replaces tables; counts include both unless noted). Use this to
size a new project: a "complete" game in this genre at this scale needs roughly the numbers in the
right column, and a vertical slice needs about a tenth of them.

| Content type | Reference count | Notes / per-item authoring cost |
|---|---|---|
| Playable classes | 3 base + 3 expansion/test (6 folders) | each: 5 sheets (≈27+27+19+9+103 keys), ~10 sprite stances × 8 directions × 2–3 weapon variants, ~100 voice lines |
| Base item types | 168 (54 distinct price points, 14 item types, 7 equip types) | 1 TSV row + icon + (for equipment) hero-sprite variant |
| Affixes | 83 prefixes + 95 suffixes (≈80 effect kinds) | TSV rows only |
| Unique items | 90 (1–6 powers each) | TSV row + optional unique icon |
| Item icons (cursor graphics) | ≈115 distinct | 1 sprite each |
| Monster types | 112 (34 sprite sets, 66 palette recolours, ~45 AI archetypes, 3 classes) | sprite set: 6 animations × 8 directions; recolour: 256-byte table |
| Unique/named monsters | 100 (31 palette translations, 7 with dialogue) | TSV row + recolour |
| Spells | 36 (7 flag combos; 4 cast-sound classes) | TSV row + 1–2 missiles + icon |
| Missiles | 68 definitions over 46 sprite sets (75 spawn handlers, 45 tick handlers in code) | sprite: up to 16 directions |
| Objects | 109 types over 62 sprite files (17 theme kinds, 7 quest-gated) | sprite + behaviour code |
| Quests | 24 (16 base + 8 expansion); 5 hand-made set levels (+3 arenas) | state machine in code + dialogue + optional set level |
| NPCs (town) | 13 roles, 12 placements (10 with gossip: 0–11 lines each) | sprite strip + dialogue |
| Dialogue / lore lines | 338 (295 unique texts, 303 voice clips) | text + VO |
| Sound effects | 813 ids (805 files; 9 flag groups incl. per-class voice sets) | audio files |
| Dungeon depths | 25 (16 base + 8 expansion + town) ; 17 or 25 persisted per save | procedural; each needs tileset + level-type rules |
| Tilesets (level types) | 7 (town + 4 base + 2 expansion); 137–376 mega-tiles each | heaviest art cost |
| Set pieces (`.dun`) | dozens (quest rooms, set levels, theme rooms) | hand-authored grids |
| Theme rooms | 17 kinds | code + objects |
| Light radii / levels | 16 / 16 | generated |
| Character levels | 50 | 1 table |
| Difficulty tiers | 3 | multipliers in code |
| Languages | 27 + source | ~ (338 lore + UI strings) × languages |
| Sample mods | 4 + 1 expansion pack | — |

Capacity constants a new engine should decide consciously (reference in parentheses): players
per session (4), monsters per level (200), items on the ground per level (127), objects per level
(127), lights (32), portals (4), inventory grid (40 cells + 7 equip + 8 belt), stash (100 pages of
10×10), spell slots (52), hotkeys (12), save slots (99), level grid (112×112 world tiles over a
40×40 mega-tile layout), dialogue text (64-char item names, 32-char player names, 80-char chat).

---

## Appendix A — Enum vocabularies used by the tables (mechanical tokens, reference engine)

These are the complete token sets the parsers accept. They are listed because a new engine will
need an equivalent vocabulary for each column, and because the *size* of each set is a design
signal (e.g. ~80 affix power kinds is what a mature loot system grows to).

**Item class** (5): `None, Weapon, Armor, Misc, Gold, Quest`.
**Equip type** (9): `None, One-handed, Two-handed, Armor, Helm, Ring, Amulet, Unequippable, Belt`.
**Item type** (15): `Misc, Sword, Axe, Bow, Mace, Shield, LightArmor, Helm, MediumArmor, HeavyArmor, Staff, Gold, Ring, Amulet, None`.
**Affix applicability** (6): `Misc, Bow, Staff, Weapon, Shield, Armor`; **alignment** (3): `Any, Good, Evil`.
**Consumable / misc kinds** (45): sentinel ranges `USEFIRST..USELAST` (full heal, heal, mana, full mana, four attribute elixirs, rejuvenation, full rejuvenation), `SCROLL`, `SCROLLT` (targeted scroll), `STAFF`, `BOOK`, `RING`, `AMULET`, `UNIQUE`, oil range `OILFIRST..OILLAST` (12 oil kinds: accuracy, mastery, sharpness, death, skill, blacksmith, fortitude, permanence, hardening, imperviousness…), `MAPOFDOOM`-style quest map, `EAR`-style trophy, special elixir, rune range (fire, lightning, greater fire, greater lightning, stone), `AURIC` (gold-capacity amulet), `NOTE`, arena potion.
**Innate special effects** (26): random life steal, random arrow velocity, fire arrows, fire damage, lightning damage, drain life, multiple arrows, knockback, steal mana 3/5 %, steal life 3/5 %, quick/fast/faster/fastest attack, fast/faster/fastest hit recovery, fast block, lightning arrows, thorns, no mana, half trap damage, triple damage vs demons, zero resistance.
**Affix / unique power kinds** (≈80): to-hit ±, damage % ±, to-hit+damage ±, AC % ±, fire/lightning/magic/all resistance (+ cursed variants), spell levels +, charges, fire/lightning damage ranges, STR/MAG/DEX/VIT/all ± , get-hit ±, life ±, mana ±, durability ±, indestructible, light radius ±, multiple arrows, fire/lightning arrows, thorns, no mana, fireball on hit, half trap damage, knockback, steal mana/life, target AC, fast attack/recovery/block, flat damage mod, random arrow velocity, set damage, set durability, no min strength, grants spell, one-handed, 3× damage vs demons, all-resist zero, drain life, random life steal, set AC, AC→life, mana→AC, AC curse, last-boss drop marker, devastation, decay, peril, jester, crystalline, doppelganger, AC vs demons/undead, mana↔life conversion.
**Monster ability flags** (12): `HIDDEN, LOCK_ANIMATION, ALLOW_SPECIAL, TARGETS_MONSTER, GOLEM, QUEST_COMPLETE, KNOCKBACK, SEARCH, CAN_OPEN_DOOR, NO_ENEMY, BERSERK, NOLIFESTEAL`.
**Monster resistances** (bits): resist magic/fire/lightning, immune magic/fire/lightning/acid.
**Monster class** (3): `Undead, Demon, Animal`; **availability** (3): `Always, Never, Retail`; **pack** (3): `None, Independent, Leashed`.
**AI archetypes** (~45): shambler, bloated charger, melee skeleton, ranged skeleton, scavenger (eats corpses), rhino charger, melee goat-man, ranged goat-man, small swarmers with morale, magma lobber, melee boss, bat (hit-and-run), gargoyle (stone sleep), cleaver boss, succubus (ranged kiting), sneak/teleporter, storm caster, fire elemental, several named quest bosses, acid spitter (+unique), golem (player-owned), snake (zig-zag), counselor (teleporting caster), mega-demon (apocalypse), final boss, lieutenant, fallen priest, blood knight boss, fire bat, torch ant, hork demon (spawner), lich/arch-lich, psychorb/necromorb (orb casters), bone demon.
**Object flags** (6): `Animated, Solid, MissilesPassThrough, Light, Trap, Breakable`.
**Theme kinds** (17): barrels, shrine, monster pit, skeleton room, treasure, library, torture, blood fountain, decapitated, purifying fountain, armor stand, goat shrine, cauldron, murky fountain, tear fountain, burning cross, weapon rack.
**Spell flags** (5): `Fire, Lightning, Magic, Targeted, AllowedInTown`.
**Missile flags** (7): `Physical, Fire, Lightning, Magic, Acid, Arrow, Invisible`; **movement** (3): `Disabled, Blockable, Unblockable`; **missile sprite flags** (2): `MonsterOwned, NotAnimated`.
**Sound flags** (9): `Stream, Misc, Ui` + one per class voice set.
**Selection region** (3 thirds): `Bottom, Middle, Top`.
**Directions** (8): N, NE, E, SE, S, SW, W, NW (towner facing, missile/monster orientation).
**Level entry kinds** (7): main stairs, previous stairs, set-level, return-from-set-level, load, warp, town-portal-down.
**Tilesets** (7): town, cathedral-like, catacombs-like, caves-like, hell-like, nest-like, crypt-like.
**Set levels** (8 + none): 5 quest levels, 3 arenas.

## Appendix B — End-to-end data-flow walkthroughs

### B.1 "A monster dies and drops an item" (multiplayer, 2 peers A and B on the same level)

1. A's local simulation resolves the killing blow; A sends `MONSTDAMAGE`/`MONSTDEATH` (hi-pri).
2. A rolls the drop with its RNG: `SetupAllItems(seed = AdvanceRndSeed(), lvl = monsterLevel,
   uper = 1|15, onlygood, …)` → item placed on a free tile found by a deterministic spiral search.
3. A sends `DROPITEM {x,y, item def = idx, createInfo, seed, (dur, charges, value)}`.
4. Both A and B append the item def to their `DLevel[level].item[]` (delta) and B recreates the
   item from the 19-byte def via `RecreateItem` — identical stats because generation is seeded.
5. B clicks the item → `REQUESTGITEM` to the lowest-id peer on that level (say A). A validates the
   request (position, item def matches ground item), removes it, replies `GETITEM` → both remove it
   and mark the delta entry as taken; if A had already given it away, A re-spawns it on B via
   `SPAWNITEM`.
6. A third peer C joining later receives `DLevel` for that level: the item appears taken, the
   monster entry has `hp = 0` and position, so C's regenerated level (same seed) is patched.

### B.2 "Player joins a game at minute 30"

1. Lobby: browse (`PT_INFO_REQUEST/REPLY`) or direct address; compatibility check on version
   triple + edition; password → key.
2. `PT_JOIN_REQUEST` → host assigns id 2, replies `PT_JOIN_ACCEPT` with `GameData` (seeds, rules,
   tick rate); host broadcasts `PT_CONNECT`.
3. Joiner derives `DungeonSeeds[1..N]` from `gameSeed`, randomises town seed, enters town,
   sends `SEND_PLRINFO` chunks of its packed hero; peers validate (reject → chat event + drop after
   15 s).
4. Joiner sends its first turn with the top bit; peer 0 (lowest other id) becomes delta sender and
   streams `DLEVEL`×levels + `DLEVEL_JUNK` + `DLEVEL_END` (compressed). Joiner buffers all other
   messages meanwhile and shows progress = chunks / (levels + 4).
5. On `DLEVEL_END` the buffered messages replay; the turn barrier admits the joiner; from now on
   the joiner's loop counter equals everyone's (`4 × turns × updateRate`), so monster AI seeds match.
6. When the joiner takes stairs it regenerates the level from the shared seed and applies its copy
   of the delta (`DeltaLoadLevel`): spawned monsters, monster HP/positions, object states, item
   list, and its own (empty) automap.

### B.3 "Save, quit, load" (single player)

1. On each level change: snapshot → `templNN` (temp). On save: `game` (globals + current level),
   `additionalMissiles`, `levelseeds`; rename `temp*` → `perm*`; pack hero → `hero`; `hotkeys`;
   `heroitems`; stash if dirty. Town seed re-rolled.
2. On load: delete temps; read `game` header (edition magic); seeds; player; quests; portals;
   convert level files if edition differs; regenerate current level from `DungeonSeeds[depth]`
   (and `LevelSeeds[depth]` for post-layout rolls); overlay saved monsters/objects/items/grids;
   read kill counts, lights, dropped items, premium vendor items, automap.
3. Items in inventory are rebuilt from `(idx, createInfo, seed)` then patched with saved
   durability/charges/identified; unknown items (removed mod) are cleared and the grid compacted.

### B.4 "A mod adds a class"

1. Mod ships `mods/<name>/manifest.ini`, `lua/mods/<name>/init.lua`, `txtdata/classes/<folder>/`
   (5 sheets) and `txtdata/classes/extra_classes.tsv`.
2. `init.lua`: `events.PlayerDataLoaded.add(function() player.addClassDataFromTsv(
   "txtdata\\classes\\extra_classes.tsv") end)`.
3. On mod enable → full reload: class list table loads, event fires, the extra row(s) append to the
   class vector (cap 255), then the per-class folder loop reads the new folder's sheets with the
   normal loader; UI lists the class; saves store its index (clamped if the mod is later removed).

## Appendix C — Save-diff memory-map DSL (reference)

Each line is a command; the comparator walks the reference and actual byte buffers in lockstep.

| Command | Meaning |
|---|---|
| `R <bits> <name>` | compare a raw field of `bits/8` bytes; on mismatch record `<file>.<name>` |
| `LT <bits> <name>` | read a 32-bit BE "level type" field; 0 marks the buffer as a town level |
| `LC <bits> <name>` / `LC_LE` | read a 32-bit BE/LE counter and remember it under `<name>` for later loops |
| `M <count|name> <bits> <name>` | compare `count` consecutive fields of `bits/8` bytes (count literal or a remembered counter) |
| `C <count|name> <submap> <name>` | recurse into another map file `count` times (e.g. `C 200 monster monsters`) |
| suffix `_HF` / `_DA` | apply the line only for expansion / base saves |
| suffix `_DL` | apply only on dungeon levels (skip in town) |

Fourteen map files describe `hero`, `game`, `level`, `player`, `item`, `itemPack`, `monster`,
`missile`, `object`, `portal`, `quest`, `lightning`, `levelSeed`, `additionalMissiles`. When a
reference and actual archive differ, the tool prints "file X is different size/content" and then,
per diverging field, `Diff found in game.monsters.hitPoints count: 3` — enough to localise a
determinism bug to a subsystem without a debugger.

## Appendix D — Checklist: what a new engine should copy, change, or drop

| Keep as-is | Change | Drop |
|---|---|---|
| TSV tables + fatal-but-precise errors | header-name mapping everywhere; collect all errors | positional column reads |
| Flat vectors of PODs indexed by stable ids | string ids interned, persisted by name | raw row-index identity |
| Seed-based item identity `(idx, createInfo, seed)` | add schema version + explicit mutable fields | duplicated derived-stat records |
| One runtime sprite format, decode at load | indexed PNG atlases + JSON as source | three legacy decoders |
| Layered VFS with loose overrides | named priority layers | magic priority numbers |
| Loopback transport for SP | — | — |
| Turn barrier with send-ahead | fully deterministic sim + state hash, or keep hybrid but generate validators from the command schema | hand-written validation macros across 90 handlers |
| Delta per level, lowest-id arbiter | growable logs with byte budget + compression | fixed 254/127/200 caps |
| Golden level & replay tests, RNG pins | schema-driven save diff | memory-map DSL text files |
| Manifest + hash-based mod identity | wire into join handshake and save headers | "last mod wins" program id |
| Sandbox + event bus + data-extension hooks | typed binding generation with docs | — |
| Headless mode, system-or-vendored deps | enforce module graph in build from day one | 64k-line umbrella library |

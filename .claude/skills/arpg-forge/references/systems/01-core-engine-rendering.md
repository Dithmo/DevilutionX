# Core Engine, Game Loop, Rendering, Input, Audio, Settings

> Scope: the platform layer and the "engine" half of an isometric hack-and-slash ARPG as implemented by the
> reference engine (a modern C++ reimplementation of a 1996 game). Everything here is IP-free: no title,
> character, town, monster, item or quest names appear. Where a source file or directory is literally named
> after the original title it is written as `[main]` / `[ui]` (e.g. `Source/[main].cpp` is the 3.5k-line
> file that owns the game loop, `Source/[ui]/` is the front-end menu directory).
> Identifiers in the reference code that embed the original title (e.g. the `*Main`, `*Init`, `*Deinit`, `*_quit`, `*_pause_game` entry points and the legacy RNG class) are written here with an `App`/`Legacy` prefix instead.
>
> All numbers are **reference tuning values** taken from the code; they are starting points, not laws.

---

## System map

| # | System | Source files | Lines (approx) | Depends on | Depended on by |
|---|--------|--------------|----------------|------------|----------------|
| 1 | Application bootstrap & lifecycle | `Source/main.cpp`, `Source/[main].cpp` (AppMain/StartGame/RunGameLoop), `Source/init.cpp`, `Source/game_mode.*`, `Source/menu.cpp`, `Source/[ui]/mainmenu.cpp` | 66 + ~900 + 237 + 70 + 209 + 190 | Options, Assets, Audio, Surface/Present, Front-end UI | everything |
| 2 | Fixed-timestep tick scheduler | `Source/nthread.*`, `Source/[main].cpp` (`game_loop`, `GameLogic`, `TimeoutCursor`, pause) | 305 + ~250 | SDL timer, network turn layer | Game logic, Animation interpolation, Renderer |
| 3 | Input event pipeline & key/pad mapping | `Source/engine/events.*`, `Source/[main].cpp` (`GameEventHandler`, `PressKey`, mouse handlers), `Source/controls/keymapper.*`, `Source/controls/padmapper.*`, `Source/track.*` | 240 + ~700 + 80 + 70 + 180 | Options (bindings), Controller abstraction, Cursor | Game logic (commands), UI panels |
| 4 | Controller / gamepad / touch abstraction | `Source/controls/*` (`controller*.cpp`, `game_controls.cpp`, `plrctrls.cpp`, `axis_direction.*`, `devices/*`, `touch/*`) | ~6600 | SDL input, Pathfinding (auto-target), Cursor | Input pipeline, UI panels |
| 5 | Core math (points, displacements, directions, rectangles, iso transforms) | `Source/engine/point.hpp`, `displacement.hpp`, `direction.*`, `rectangle.hpp`, `size.hpp`, `world_tile.hpp`, `points_in_rectangle_range.hpp` | 283 + 371 + 80 + 79 + 113 + 40 + 416 | none | everything |
| 6 | Random number generation | `Source/engine/random.*` | 520 | none | Level gen, items, monsters, palette |
| 7 | Pathfinding & spatial search | `Source/engine/path.*`, `Source/crawl.*` | 390 + 100 | Core math, tile properties | Player/monster movement, gamepad auto-target, item drop placement |
| 8 | Animation timing & sub-tick interpolation | `Source/engine/animationinfo.*`, `Source/engine/actor_position.*`, `Source/utils/fixed_point.hpp`, `Source/engine/ticks.*` | 392 + 180 + 200 + 20 | Tick scheduler (`ProgressToNextGameTick`) | Renderer, actors, missiles |
| 9 | Asset loading & sprite formats | `Source/engine/assets.*`, `load_clx.*`, `load_cel.*`, `load_cl2.*`, `load_pcx.*`, `load_file.hpp`, `clx_sprite.hpp`, `trn.*`, `Source/utils/clx_*.hpp`, `cel_to_clx.*`, `cl2_to_clx.*` | ~2500 | archive reader, file util | Renderer, UI, Audio, everything |
| 10 | Surface, back buffer & presentation | `Source/engine/surface.*`, `Source/engine/dx.*`, `Source/engine/backbuffer_state.*`, `Source/utils/display.*`, `Source/hwcursor.*` | 250 + 400 + 150 + 950 + 300 | SDL video, Palette | Renderer, UI |
| 11 | Palette & colour pipeline | `Source/engine/palette.*`, `Source/utils/palette_blending.*`, `Source/utils/palette_kd_tree.*`, `Source/engine/light_tables.*` | 560 + 200 + 150 + 170 | Options (brightness), Assets | Renderer, Lighting, Fades |
| 12 | Dungeon tile rendering primitives | `Source/engine/render/dun_render.*`, `Source/levels/dun_tile.hpp`, `Source/levels/dun_tile_data.*` (micro-tile table), `Source/levels/reencode_dun_cels.*`, `Source/engine/render/blit_impl.hpp` | 1290 + 180 + 300 + 300 + 195 | Palette LUTs, Lightmap | Isometric scene renderer |
| 13 | Isometric scene renderer & camera | `Source/engine/render/scrollrt.*`, `Source/engine/render/clx_render.*` | 2020 + 760 | 5, 8, 10, 11, 12, 14, 16, 17 | Game loop (`DrawAndBlit`), Cursor picking |
| 14 | Tile lighting | `Source/lighting.*`, `Source/engine/light_tables.*`, `Source/engine/lighting_defs.hpp` | 560 + 170 + 20 | Tile properties, Core math | Renderer, Vision, AI (lit check) |
| 15 | Vision / fog of war | `Source/vision.*`, `Source/lighting.cpp` (vision list) | 150 + 120 | Tile properties, Automap | Renderer, Monster AI, Automap |
| 16 | Per-pixel lightmap | `Source/engine/render/light_render.*` | 650 | Tile lighting, Core math | Dungeon tile primitives, CLX renderer |
| 17 | Cursor, picking & hardware cursor | `Source/cursor.*`, `Source/hwcursor.*`, `Source/cursor_defs.hpp` | 934 + 300 | Renderer geometry, entity grids | Input pipeline, UI |
| 18 | Automap / minimap | `Source/automap.*`, `Source/engine/render/automap_render.*` | 1964 + 280 | Vision (exploration), Level data | Renderer overlay |
| 19 | Audio: mixer, SFX, music, positional | `Source/engine/sound.*`, `sound_defs.hpp`, `sound_position.*`, `Source/effects.*`, `Source/utils/soundsample.*`, `push_aulib_decoder.*` | 520 + 30 + 40 + 400 + 500 | Assets, Options | Everything that makes noise |
| 20 | Options / settings system | `Source/options.*`, `Source/utils/ini.*` | 2660 + 600 | ini parser, paths | Everything |
| 21 | In-game (pause) menu widget | `Source/gmenu.*`, `Source/gamemenu.*` | 500 + 400 | Text renderer, Audio, Palette | Input pipeline |
| 22 | Front-end UI (main menu, hero select, dialogs) | `Source/[ui]/*` | ~5400 | Surface, Assets, Options, Save files | Bootstrap |
| 23 | Loading screens & level transitions | `Source/interfac.*`, `Source/[main].cpp` (`LoadGameLevel*`) | 700 + ~450 | Threads, Palette, Custom SDL events | Game loop |
| 24 | Demo record/playback, headless mode, debug tooling | `Source/engine/demomode.*`, `Source/headless_mode.*`, `Source/debug.*` | 1070 + 20 + 400 | Events, Tick scheduler | Tests, CI |

Grid constants used everywhere (reference values): tile = **64x32 px** (`TILE_WIDTH`, `TILE_HEIGHT`),
mega-tile = 2x2 tiles, level mega-grid = **40x40** (`DMAXX/DMAXY`), world tile grid = **112x112**
(`MAXDUNX = 16 + 40*2 + 16`: a 16-tile border on each side), max level pieces (tile ids) = **1379**,
default logical resolution **640x480**, game tick = **50 ms (20 Hz)**.

---

## 1. Application bootstrap & lifecycle

### Purpose
Owns process start-up, command-line parsing, loading of core archives/options/translations, window
creation, the main-menu loop, the "start a game session" loop and orderly tear-down. It is the glue that
turns a menu selection into a running `RunGameLoop` and back.

### Key data structures
- `GameData` (session descriptor, byte-packed, sent over the network and stored in saves):
  `int32 size; uint8 isSpawn (demo-edition flag); uint32 programid (4-char branding tag); uint8 versionMajor/Minor/Patch; uint8 nDifficulty; uint8 nTickRate; uint8 bRunInTown; uint8 bTheoQuest/bCowQuest (optional-content toggles); uint8 bFriendlyFire; uint8 fullQuests; uint32 gameSeed[4]` (seed used to derive per-level seeds so all peers generate the same dungeon).
- Global session flags: `gbRunGame` (in-game vs menu), `gbRunGameResult` (false = quit app), `ReturnToMainMenu`, `gbIsMultiplayer`, `gbIsSpawn` (reduced-content edition), `gbIsExpansion` (expansion content on), `gbVanilla` (legacy save format), `gbLoadGame`, `gbProcessPlayers` (false once the final boss is dead in SP), `PauseMode` (0 running, 2 paused), `cineflag` (play ending movie after loop).
- `interface_mode` enum (custom SDL user-event codes): `NEXTLVL, PREVLVL, RTNLVL, SETLVL, WARPLVL, TOWNWARP, TWARPUP, RETOWN, NEWGAME, LOADGAME, PROGRESS, ERROR, DONE`.
- "was_*_init" booleans so that `AppDeinit` only frees what was created.

### Algorithms & rules
Start-up order (`AppMain`):
1. Parse flags (`--data-dir`, `--save-dir`, `--config-dir`, `--lang`, `-n` skip intro, `-f` FPS counter, `--spawn/--base/--expansion` edition forcing, `--vanilla`, `--verbose`, `--log-to-file`, `--demo N`, `--timedemo`, `--record N`, `--create-reference`, debug `+command` passthrough).
2. Register all keyboard actions (`InitKeymapActions`) and gamepad actions (`InitPadmapActions`) **before** options are loaded so the ini can override bindings.
3. Load the engine's own asset archive (UI art, fonts, data tables) → load options (ini) → demo override of options → load language voice archive.
4. `ApplicationInit`: FPS flag, create window + renderer + 8-bit back buffer (`init_create_window` → `dx_init`), screen reader, language init, version strings, read-only save-dir test.
5. Verify archive versions (`ASSETS_VERSION` text file must equal `"1\n"`), init scripting (Lua), save options, load game archives, load text tables, then data tables in order: player classes, spells, missiles, monsters, items, objects, quests.
6. `AppInit`: edition detection, optional "which edition?" prompt, UI init, screen/mouse center, `snd_init`, UI sounds, item graphics (needed by hero select), spinner sprite.
7. `AppSplash`: optional logo movie, intro movie (`Off/Once/On` option), title dialog.
8. `mainmenu_loop` until exit; `AppDeinit`.

Session loop (`StartGame(bNewGame, bSinglePlayer)`):
```
gbSelectProvider = true; ReturnToMainMenu = false
do {
  gbLoadGame = false
  if (!NetInit(bSinglePlayer)) { gbRunGameResult = true; break }   // user backed out of lobby/hero select
  UiDestroy()                     // free ~2.8 MiB of menu art before the game
  if (bNewGame || !gbValidSaveFile) { InitLevels(); InitQuests(); InitPortals(); InitDungMsgs(); DeltaSyncJunk(); }
  giNumberOfLevels = expansion ? 25 : 17
  uMsg = (gbValidSaveFile && gbLoadGame) ? LOADGAME : NEWGAME
  RunGameLoop(uMsg)               // blocks until gbRunGame == false
  NetClose(); UnloadFonts()
  if (gbRunGameResult) UiInitialize()
  if (ReturnToMainMenu) return true
} while (gbRunGameResult)         // loop again => "New game" from the in-game menu
SNetDestroy()
```
`RunGameLoop` (per session): notify demo recorder, `StartGame(uMsg)` (viewport geometry, cursor, health bars,
XP bar, **loading screen that loads the first level**, in-game menu art), install `GameEventHandler`, run delta
sync, set `gbRunGame = true`, fade in from black (render the first frame with an all-black palette, then
`PaletteFadeIn(8)`), then the frame loop (see §2), then: write hero (MP), fade out, clear screen, restore
previous event handler, `FreeGame`, optionally play the ending movie.

Main menu loop (`mainmenu_loop`): music cycles through dungeon tracks between menu visits
(`NextTrack`: intro→tier2→tier3→tier4→(expansion tiers)→intro); menu items: Single Player, Multi Player,
Settings, Support, Credits, Exit; attract mode auto-plays the intro after **30 s** idle. Hero selection
remembers the last used save slot per edition and per SP/MP in options.

Window/OS events (`MainWndProc`): minimized/hidden → `gbActive=false` (presentation skipped, FPS limiter
sleeps); shown/exposed/restored → `gbActive=true` + full redraw; size changed → reinit hardware cursor;
mouse leave → clear mouse-down state; close → `app_quit(0)`; focus lost/gained → pause/unpause if the
`pauseOnFocusLoss` option is on (SP only; MP just mutes music).

### Reference tuning values
| Constant | Value | Where |
|---|---|---|
| Default tick rate | 20 ticks/s (`gnTickDelay = 50 ms`) | `[main].cpp` |
| Levels per campaign | 17 base / 25 with expansion | `StartGame` |
| Max players | 4 (`MAX_PLRS`) | `multi.h` |
| Attract-mode timeout | 30 s | `mainmenu_loop` |
| Palette fade steps | `PaletteFadeIn/Out(8)` → 24 steps per 50 ms (see §11) | `RunGameLoop` |
| Exit-button sound delay | 350 ms | `mainmenu_wait_for_button_sound` |
| Archive version sentinel | `"1\n"` | `init.cpp` |
| Menu-art memory freed at game start | ~2.8 MiB | comment in `StartGame` |

### Smallest buildable chunks
1. **CLI parser** — in: argv; out: `Paths{data,save,config}`, flags struct; done when `--help` prints all options and unknown flags exit 64.
2. **Path resolution service** — in: platform + CLI overrides; out: base/pref/config dirs; done when all three dirs are created on demand and logged.
3. **Init/deinit ledger** — in: nothing; out: `was_window_init`, `was_archives_init`, `was_ui_init` booleans + `Deinit()` that frees in reverse; done when calling quit at any stage leaks nothing (ASan clean).
4. **Session descriptor** (`GameData`) with LE serialisation (`swapLE`) — done when round-trips byte-exact.
5. **Edition/feature-flag resolution** — in: CLI force flags + options + archive presence; out: `gbIsSpawn/gbIsExpansion`; done when the matrix of (force, option, archive present) yields the documented result.
6. **Window-event handler** — in: SDL window events; out: `gbActive`, pause/unpause calls, redraw flag; done when minimising stops presenting and restoring triggers a full redraw.
7. **Main-menu state machine** — in: menu selection enum; out: calls into session start / settings / credits; done when every branch returns to the menu except Exit.
8. **Session start/stop loop** (`StartGame`) — done when "Exit to main menu" from in-game reinitialises the menu and "New game" re-enters without leaking.
9. **Fade-in bootstrap** — render first frame under a black palette, then fade; done when no single bright frame flashes at level entry.
10. **Splash/intro gating** — options `splash {None, Title, LogoAndTitle}`, `intro {Off, Once, On}`; done when `Once` flips itself to `Off` and persists.

### Pitfalls / design lessons
- Dozens of session globals (`gbRunGame`, `PauseMode`, `gbProcessPlayers`, …) are mutated from UI, net and loop code alike. A new engine should wrap them in a `Session` object with explicit state transitions (Menu → Loading → Running → Paused → Leaving).
- `StartGame(uMsg)` (level load) and `StartGame(bNewGame, bSinglePlayer)` (session) share a name; the first calls `ShowProgress`, which **blocks on a loading thread** inside what looks like an init function. Keep "load a level" an explicit asynchronous state.
- Data tables are loaded before the menu because hero select touches player-class data; a new design should load only class metadata for the menu and defer the rest.
- Options are saved three times during start-up (after Lua init, after `AppInit`, when leaving menus) to migrate legacy keys. Prefer an explicit migration step.

---

## 2. Fixed-timestep tick scheduler (game loop)

### Purpose
Advances deterministic game logic at a fixed rate (20 Hz by default) independent of render rate, keeps
peers in lock-step in multiplayer (turn-based netcode), skips rendering when the machine falls behind,
caps catch-up to avoid "fast forward" after stalls, and publishes a 0..128 fraction (`ProgressToNextGameTick`)
that the renderer uses to interpolate animation between ticks.

### Key data structures
- `gnTickDelay : uint16` — ms per tick = `1000 / nTickRate`.
- `last_tick : int` — ms timestamp at which the **next** tick is due (advanced by `gnTickDelay` per processed tick, not by wall time).
- `ProgressToNextGameTick : uint8` — 0..128 (`AnimationInfo::baseValueFraction`).
- Net pacing state (`nthread.cpp`): `sgbNetUpdateRate` (ticks per network turn), `sgbPacketCountdown`, `sgbSyncCountdown` (init 1, reset to 4 after a successful receive), `sgbTicsOutOfSync`, `gdwTurnsInTransit`, `gdwNormalMsgSize`, `gdwLargestMsgSize` (≤512), `turn_upper_bit` (0x80000000 flag on first turn after join).
- `GameLogicStep` enum (`None, ProcessPlayers, ProcessMonsters, ProcessObjects, ProcessMissiles, ProcessItems, ProcessTowners, ProcessItemsTown, ProcessMissilesTown`) — a debug/telemetry marker of which phase is executing.
- `gbGameLoopStartup` — first iteration after level load runs extra catch-up ticks.

### Algorithms & rules
**Frame loop** (`RunGameLoop` body):
```
while (gbRunGame):
    pump all SDL events → HandleMessage (QUIT sets gbRunGame=false)
    runTick = demo ? demo::GetRunGameLoop(drawGame, processInput)
                   : nthread_has_500ms_passed(&drawGame)
    if (!runTick):
        ProcessInput()                 // cursor hover / click-and-hold repeat, every frame
        DvlNet_ProcessNetworkPackets()
        if (drawGame) { RedrawViewport(); DrawAndBlit(); }
        continue
    ProcessGameMessagePackets()        // apply queued network commands
    yield()
    if (game_loop(gbGameLoopStartup)) app_color_cycle_logic()   // palette animation once per tick batch
    gbGameLoopStartup = false
    if (drawGame) DrawAndBlit()
```
**Tick due test** (`nthread_has_500ms_passed`):
```
elapsed = now - last_tick
if elapsed > 10 * gnTickDelay:                 // stalled > 10 ticks (500 ms at 20 Hz)
    if (single player, or no other peer connected): last_tick = now; elapsed = 0   // drop missed ticks
drawGame = elapsed <= gnTickDelay              // skip render if ≥ 1 tick behind
return elapsed >= 0
```
**Tick batch** (`game_loop(bStartup)`): runs up to `wait = bStartup ? nTickRate*3 : 3` iterations; each
iteration: `multi_handle_delta()` (if it fails → network timeout cursor and return), `TimeoutCursor(false)`,
`GameLogic()`, `ClearLastSentPlayerCmd()`; break after one iteration unless (multiplayer && not demo &&
another tick is already due). Returns true if at least one tick ran.

**GameLogic order per tick** (the heart of the skeleton at the end of this document):
1. `ProcessInput()` — returns false (skip tick) when `PauseMode == 2`, or SP with in-game menu open; otherwise gamepad per-frame handling, cursor hover update (`CheckCursMove`), gamepad target refresh, click-and-hold repeat (`RepeatPlayerAction`).
2. if `gbProcessPlayers`: `ProcessPlayers()`.
3. if not in hub town: `ProcessMonsters()`, `ProcessObjects()`, `ProcessMissiles()`, `ProcessItems()`, `ProcessLightList()`, `ProcessVisionList()`.
   else: `ProcessTowners()`, `ProcessItems()`, `ProcessMissiles()`.
4. `sound_update()` (stream housekeeping), `CheckTriggers()` (stairs/portals under player), `CheckQuests()`, `RedrawViewport()`, `pfile_update(false)` (periodic autosave of hero), `plrctrls_after_game_logic()` (gamepad walking).

**Interpolation fraction** (`nthread_UpdateProgressToNextGameTick`, called once per rendered frame):
```
if !gbRunGame || PauseMode != 0 || (SP && menu open) || !gbProcessPlayers || demo: return
missing = last_tick - now
if missing <= 0: Progress = 128
else: Progress = clamp((gnTickDelay - missing) * 128 / gnTickDelay, 0, 128)
```
**Network turn pacing** (`nthread_start`): `turnsInTransit = caps.defaultturnsintransit (≥1)`;
`sgbNetUpdateRate = (caps.defaultturnssec in 1..20) ? 20 / defaultturnssec : 1`;
`normalMsgSize = caps.bytessec * rate / 20 * 3 / 4 / maxplayers`, doubled (and rate doubled) until ≥ 128,
capped at `largestMsgSize = min(caps.maxmessagesize, 512)`. In MP a helper thread (`NthreadHandler`) sends
turns and sleeps `delta = last_tick - now` under a mutex that the main thread releases during loading
(`nthread_ignore_mutex`).

**Timeout cursor**: when `multi_handle_delta` fails, the current cursor is remembered, an hourglass cursor is
set, "waiting for players" text + per-player echo/provider latency is shown, and `scrollrt_draw_game_screen`
is drawn each frame; on recovery the previous cursor is restored unless an item cursor was set meanwhile.

**Pause**: `app_pause_game` toggles `PauseMode` 0↔2 in SP only (stops sounds, cancels queued action);
focus-loss pause remembers whether it was already paused. Paused state is drawn with a red tint overlay
and "Pause" text (`gmenu_draw_pause`).

### Reference tuning values
| Constant | Value |
|---|---|
| Tick rate | 20 Hz default; in-game slider 20..50 (46 slider steps); MP labels Normal=20, Fast≥30, Faster≥40, Fastest≥50 |
| Max catch-up ticks per frame | 3 (startup: `nTickRate*3` = 60) |
| Stall threshold that drops missed ticks | 10 ticks |
| Render skip rule | skip when ≥ 1 full tick behind |
| Interpolation resolution | 128 steps per tick (7 fractional bits) |
| Net sync countdown | 4 turns |
| Max network message | 512 bytes; normal message ≥ 128 bytes |
| Demo simulated clock | `LogicTick * 50 ms` |

### Smallest buildable chunks
1. **Monotonic clock wrapper** (`GetMillisecondsSinceStartup`) that can be replaced by a simulated clock in replay; done when replay mode returns `tick*50`.
2. **Tick accumulator** with `last_tick` semantics, `IsTickDue(&drawGame)` and the 10-tick stall reset; done when a 2 s stall produces exactly 0 catch-up ticks in SP.
3. **Catch-up batching** (`game_loop`) with max 3 ticks per frame, 60 on first frame; done when a slow renderer never exceeds 3 logic ticks per frame.
4. **ProgressToNextGameTick publisher** — done when a 60 Hz render of a 20 Hz logic shows values ≈ {43, 85, 128} per tick.
5. **Phase marker** (`GameLogicStep`) exposed to crash reports / profiler.
6. **Pause state machine** (user pause, focus pause, menu pause in SP) with sound stop/mute; done when unpausing restores the pre-pause state exactly.
7. **GameLogic dispatcher** calling the per-subsystem `Process*` in the documented order; done with an order-asserting unit test.
8. **Network-timeout UI hook** (hourglass + message) decoupled from the net layer via a callback.
9. **Turn pacing calculator** from provider capabilities (rate, msg sizes); done when fed the reference caps it yields rate=1, normal=…, largest=512.
10. **Tick-rate change at runtime** (`gnTickDelay = 1000/rate`) propagating to the speed slider and demo hotkeys (+/-).

### Pitfalls / design lessons
- `last_tick` doubles as "deadline" and is also bumped by the network layer (`nthread_recv_turns` adds `gnTickDelay` per received packet); the coupling between pacing and net sync is subtle. Separate a pure `FixedStepClock` from the lock-step turn manager.
- The in-game menu pauses logic in SP but not MP; many `if (!gbIsMultiplayer && gmenu_is_active())` checks are scattered. Model "logic frozen" as one predicate.
- `ProcessInput()` is inside `GameLogic()` **and** called on non-tick frames; hover/picking is therefore frame-rate dependent while commands are tick-bound. That is actually desirable (responsive cursor) but should be made explicit: `UpdateHover()` per frame, `IssueCommands()` per tick.
- Rendering is skipped when behind, but UI panels keep their own redraw-dirty flags; a component-based dirty system (see §10) is what makes this cheap.

---

## 3. Input event pipeline & key/pad mapping

### Purpose
Converts raw SDL events into (a) mouse position/clicks, (b) key presses routed through a rebindable action
map, (c) gamepad button events translated to the same actions or to simulated keys, and finally into
player **commands** (network messages such as `CMD_WALKXY`, `CMD_ATTACKID`) rather than direct state
mutation. Also implements click-and-hold repetition.

### Key data structures
- `EventHandler = void(*)(const SDL_Event&, uint16 modState)`; `CurrentEventHandler` is swapped
  (`SetEventHandler`) between `GameEventHandler`, `DisableInputEventHandler` (during save/load),
  `ProgressEventHandler` (loading screen) and the front-end UI loop.
- `MousePosition : Point` (logical coordinates), `sgbMouseDown : {NONE, LEFT, RIGHT}`.
- `PlayerActionType LastPlayerAction : {None, Walk, Spell, SpellMonsterTarget, SpellPlayerTarget, Attack, AttackMonsterTarget, AttackPlayerTarget, OperateObject}` — what the held button is repeating.
- `KeymapperOptions::Action { key; name; description; defaultKey; actionPressed; actionReleased; enable(); index }` — one per bindable action; keys include a mouse-button mask (`KeymapperMouseButtonMask`) and synthetic wheel keys (`MouseScrollUp/Down/Left/RightButton`).
- `PadmapperOptions::Action { ControllerButtonCombo boundInput {modifier, button}; … }` plus `ButtonToReleaseAction[button]` so a release fires the action that the press started, even if the modifier changed.
- `GameAction { type : GameActionType; send_key {vk_code, up} }` — gamepad → abstract action.
- `WalkingRequest { action; start; destination; walkabilityGeneration; lifelessPlayersMask }` — memo to avoid re-issuing a path search that already failed (`track.cpp`).

### Algorithms & rules
**Event fetch** (`FetchMessage_Real`): poll one SDL event; translate touch to virtual-gamepad events; drop
SDL's synthesized touch-mouse events; convert window → render coordinates; handle controller add/remove;
whitelist event types (keyboard, mouse, wheel, text input, window, joystick/gamepad, finger); everything
else logged as unhandled. In demo playback events come from the demo file; in recording every fetched event
is written out.

**GameEventHandler dispatch order**:
1. Gamepad: `ToControllerButtonEvents(event)` (up to 4 per event, e.g. hat → two buttons) → `HandleControllerButtonEvent` → if it yields `SEND_KEY`, synthesize `PressKey/ReleaseKey` or mouse down/up; if any controller button was recognised, stop.
2. Debug console, chat text input, gold-drop/withdraw text input get first refusal.
3. `KEY_DOWN → PressKey`, `KEY_UP → ReleaseKey`, `MOUSE_MOTION → MousePosition` (+ slider drag), `MOUSE_BUTTON_DOWN/UP → HandleMouseButtonDown/Up`, `MOUSE_WHEEL` → context scroll (store, quest log, help, chat log, stash pages, Ctrl+wheel = automap zoom) else keymapper synthetic key; custom events → level-change sequence (fade out, `ShowProgress`, fade in); else window proc.

**PressKey priority** (first match wins): remap table → in-game menu / UI widgets (`gmenu_presskeys`, `CheckKeypress`) → dead-player handling (Esc = load last save or exit; Enter = chat; Alt+Enter = fullscreen) → Esc closes panels (`PressEscKey`) or opens the game menu → gold-drop/withdraw numeric entry → network-timeout guard → **keymapper action** → paused: only Alt+Enter → "doom" overlay close → hard-coded keys (±/= automap zoom, Enter = store/questlog/chat, arrows & PgUp/PgDn = scroll the open panel).

**Left click in world** (`LeftMouseCmd(shift)`), after panel/UI hit tests:
- hub town: close shop/stash windows; item under cursor → `GOTOGETITEM/GOTOAGETITEM`; NPC → `TALKXY`; nothing → `WALKXY`.
- dungeon: `near = WalkingDistance(player, cursor) < 2`; item & hand cursor & !shift → pick up; interactable object (and !shift, or near & breakable) → `OPOBJXY/DISARMXY`;
  ranged weapon: shift → `RATTACKXY` at tile; monster → `RATTACKID` (or `ATTACKID` if talkable); hostile player → `RATTACKPID`;
  melee: shift → `SATTACKXY` (stand & swing); monster → `ATTACKID`; hostile player → `ATTACKPID`;
  nothing targeted & !shift → `WALKXY`. `LastPlayerAction` is set accordingly for hold-repeat.
- Holding an item: drop on an adjacent free tile in the cursor's direction (`FindAdjacentPositionForItem`).
- Right click: cancel timeout/pause guards; close quest text/overlays; store ignores; spell-select → choose; spellbook area ignores; special cursors (`TryIconCurs`); inventory/stash item use; otherwise cast the readied spell (`CheckPlrSpell(shift)`), or reset a special cursor to hand.

**Click-and-hold repeat** (`RepeatPlayerAction`, each frame while a button is held): requires hand cursor,
no pending `destAction`, player can change action, not in store. Repeats per `LastPlayerAction`:
attack-at-tile, attack target (skipping redundant melee walk requests), spell, operate object, walk
(`RepeatWalk`: only while standing or past walking frame 6, and only if the destination changed or
walkability changed). Targets are re-validated (`InvalidateTargets`: dead/hidden/unlit monsters, dead
players, non-interactable objects).

**Keymapper**: keys normalised to upper-case ASCII; an action fires only if `enable()` is true; chat mode
suppresses presses and text-entry keys' releases. Default bindings (reference): belt 1-8, quick spells
F5-F8, spell-cycle = wheel up/down, speedbook S, quicksave F2, quickload F3, inventory I, character C,
party Y, quest log Q, spellbook B, quick messages F9-F12, hide panels Space, zoom Z, pause P/Pause,
brightness F/G, help F1, screenshot PrintScreen, game info V, chat log L, sort inventory R, item
highlight hold LAlt / toggle RCtrl, automap Tab, cycle map type M.

### Reference tuning values
| Constant | Value |
|---|---|
| "Near" for interacting | Chebyshev distance < 2 |
| Panel-cover cursor nudge | ±160 px when a 320-px side panel opens on a 640-px-wide screen |
| Walk repeat frame gate | walking frame > 6 |
| Controller button events per SDL event | ≤ 4 |
| Virtual mouse-button key mask | bit flag `KeymapperMouseButtonMask` OR'd with the SDL button id |

### Smallest buildable chunks
1. **Event source abstraction** (`FetchMessage`) with whitelist + record/replay hook; done when a recorded session replays identically in headless mode.
2. **Event handler stack** (`SetEventHandler` returning the previous); done when loading-screen and save/load swap handlers and restore them.
3. **Mouse state** (position, down-button, modifier snapshot); done when button-down/up pairs always match (no stuck buttons after window leave).
4. **Action registry** (`AddAction(key,name,desc,default,onPress,onRelease,enable,index)`) + ini load/save + conflict detection; done when rebinding persists and duplicates are rejected.
5. **Synthetic keys** for wheel & mouse buttons so they can be bound like keys.
6. **PressKey router** with the documented priority list as a table of predicates; done with unit tests per branch.
7. **World-click resolver** (`LeftMouseCmd`) producing a `Command` enum instead of sending net messages directly; done with tests for all 12 branches.
8. **Hold-repeat service** with `WalkingRequest` memoisation keyed by a `WalkabilityGeneration` counter; done when holding on an unreachable tile issues exactly one path search per generation.
9. **Target validation** (`InvalidateTargets`) as a pure function of entity state.
10. **Panel-aware cursor nudging** when side panels open/close at low resolution.
11. **Escape semantics** (`PressEscKey`) — returns whether anything closed; game menu only when nothing did.

### Pitfalls / design lessons
- Input directly calls gameplay (`NetSendCmd*`) from the event handler; keep a `CommandQueue` consumed at tick time so input stays replayable and testable.
- Hard-coded keys remain beside the rebindable action map (arrows, ±, Enter). Put *everything* in the map with context predicates.
- The keymapper refuses presses during chat but allows releases, creating asymmetric state; a modal input context stack avoids this.
- `LastPlayerAction` is cleared in ~15 places; a single "button released / context changed" hook is cleaner.

---

## 4. Controller, gamepad & touch abstraction

### Purpose
Unifies SDL game-controller, legacy joystick, "keyboard-as-controller" and touch virtual gamepad into one
`ControllerButton` vocabulary, tracks analog sticks with radial dead-zones, detects the active input device
to switch UI mode, and implements gamepad gameplay: 8-way walking, automatic target selection, cursor
simulation with the right stick, and D-pad navigation of grid UIs (inventory, stash, spell book).

### Key data structures
- `ControllerButton` (18 values: NONE, IGNORE, triggers L/R, A/B/X/Y, stick clicks, shoulders, Start, Back, D-pad ×4) with `GamepadLayout {Generic, Nintendo, PlayStation, Xbox}` relabelling.
- `ControllerButtonEvent {button, up}`; `ControllerButtonCombo {modifier, button}`.
- `ControlTypes ControlMode / ControlDevice : {None, KeyboardAndMouse, Gamepad, VirtualGamepad}` — device is the physical source, mode is what the UI pretends (right-stick mouse simulation keeps mode = KeyboardAndMouse).
- Stick state: `leftStickX/Y, rightStickX/Y` (scaled −1..1) and unscaled raw copies; `AxisDirection {x: NONE/LEFT/RIGHT, y: NONE/UP/DOWN}`; `AxisDirectionRepeater` (per-direction last-fire timestamps, default 200 ms).
- `GameActionType {NONE, USE_HEALTH_POTION, USE_MANA_POTION, PRIMARY_ACTION, SECONDARY_ACTION, CAST_SPELL, TOGGLE_INVENTORY, TOGGLE_CHARACTER_INFO, TOGGLE_QUICK_SPELL_MENU, TOGGLE_SPELL_BOOK, TOGGLE_QUEST_LOG, SEND_KEY}`.
- Virtual gamepad (touch): `VirtualDirectionPad {Circle area; Point position; 4 pressed flags}`, `VirtualButton {isHeld, didStateChange, isUsable()}` (circle pad buttons: primary, secondary, spell, cancel, health, mana; rectangular menu buttons: char, quests, inventory, map).
- `FaceDir[3][3]` — (x axis, y axis) → facing `Direction`.
- `RightStickAccumulator {lastTc; hiresDX; hiresDY}` for sub-pixel cursor motion.

### Algorithms & rules
**Radial scaled dead-zone** (`ScaleJoystickAxes`, raw ±32767):
```
mag = sqrt(x²+y²); dz = deadzone*32767
if mag < dz: x=y=0
else: s = (mag - dz) / (32767 - dz) / mag; x*=s; y*=s; clamp so max(|x|,|y|) ≤ 1
```
**8-way sectoring** (`GetAnalogStickDirection`): below threshold 0.4 → none; `ratio = |y|/|x|`;
`ratio ≤ tan 22.5° (0.41421356)` → horizontal only; `ratio ≥ 1/0.41421356` → vertical only; else diagonal.
D-pad buttons OR into the same `AxisDirection` (when the padmapper says Move* actions are active).

**Repeater**: a direction is emitted at most once per 200 ms while held; releasing resets. Used for menu
and grid navigation; walking bypasses it (continuous).

**Walking** (`WalkInDir`, after game logic each tick): no direction → if walking under gamepad, send
`WALKXY(current future tile)` to stop. Otherwise `dir = FaceDir[x][y]`, target = future tile + dir; face it
immediately if standing; "stand ground" modifier → just turn; if the target tile is free but the step is
a **corner cut** that is blocked on both sides (`IsPathBlocked`: only for the 4 diagonal-in-world
directions N/E/S/W, both `Left(dir)` and `Right(dir)` neighbours solid/occupied) → turn only; else
`WALKXY(target)`.

**Auto-targeting** (`plrctrls_after_check_curs_move`, every frame in gamepad mode): clear current
targets; `FindActor()` → monsters nearby, then `FindItemOrObject()`, then `FindTrigger()`.
- Ranged/caster (`FindRangedTarget`): over all active monsters that `CanTargetMonster`, minimise
  `(exactDistance, rotaryDistance)` with "talkable NPC-monsters" ranked below hostiles. Initial bounds:
  distance 25, rotations 4.
- Melee (`FindMeleeTarget`): BFS over walkable tiles from the player's future tile using the 8
  `PathDirs`, respecting `CanStep` corner rules, max 25 steps; a monster encountered on a blocked tile is a
  candidate; first hit caps `maxSteps` to the current depth; ties broken by fewest turns to face
  (`GetRotaryDistance`: `|d1-d2|`, folded so > 4 becomes `4 - d%4`).
- Objects/items: searched within a small radius using `GetDistance(dest, max)` (A* with player rules).

**Right-stick mouse**: accumulate `stick * dt_ms / 2` px (remainder kept), clamp to screen, warp cursor
at most once per SDL tick; switches `ControlMode` to KeyboardAndMouse.

**Device detection** (`DetectInputMethod`): every event updates `ControlDevice`; a change re-enables or hides
the hardware cursor, re-reads gamepad layout, and recalculates panel geometry (touch mode centres the left
panel).

**Button → action translation** (`HandleControllerButtonEvent`/`GetGameAction`): if a menu/store/quest log is
open, buttons become keys (A/Y=Enter, B/Back/Start=Esc, LeftStick=Tab, D-pad=arrows, shoulders=PgUp/PgDn
in list menus); otherwise padmapper actions (defaults: B=primary, Y=secondary, X=spell, A=cancel,
LB/RB=health/mana potion, LT=character, RT=inventory, Back+LT=quest log, Back+RT=spell book, D-pad=move,
Start=game menu…). A press records the modifier as `SuppressedButton` so the modifier's own release does
nothing.

**Touch**: fingers map to the virtual D-pad (angle sectors with `PointsUp/Down/Left/Right`) and circular
buttons; other touches simulate mouse motion/clicks on panels (`SimulateMouseMovement`).

### Reference tuning values
| Constant | Value |
|---|---|
| Dead-zone (option `Controller.deadzone`) | 0.07 |
| Stick direction threshold | 0.4 |
| Diagonal cutoff | tan 22.5° = 0.41421356 |
| Repeat interval (menus/grids) | 200 ms |
| Right-stick cursor slowdown | 2 (px per ms·stick) |
| Melee BFS depth / ranged search radius | 25 |
| Rotary distance range | 0..4 |
| Nearby interaction search | `GetDistance(…, max)` with max small (1-2) for objects |

### Smallest buildable chunks
1. **Device layer**: enumerate/open SDL game controllers & joysticks, map to `ControllerButton`, track pressed set; done when hot-plug add/remove works.
2. **Keyboard-as-controller** compile-time mapping (`HAS_KBCTRL`) — optional.
3. **Stick processing**: dead-zone, sectoring, repeater; done with unit tests for boundary angles.
4. **Layout relabelling** (Nintendo/PlayStation/Xbox glyphs + A/B swap) for hints.
5. **Padmapper** action registry mirroring the keymapper with combos & release memo.
6. **Menu key translation tables** (3 contexts) → `SEND_KEY`.
7. **Gamepad walking** (`WalkInDir`) with corner rule and stand-ground.
8. **Melee auto-target BFS** and **ranged auto-target** as pure functions over an entity query interface; done with grid fixtures.
9. **Right-stick cursor** accumulator with warp throttling.
10. **Grid navigation** for inventory/stash/spell lists (not detailed here; ~1500 lines in reference).
11. **Virtual gamepad geometry** (sizes relative to screen) + renderer + event handler.
12. **Input-method detector** switching UI mode and hardware cursor.
13. **Modifier hint overlay** (shows which combos are available while a modifier is held).

### Pitfalls / design lessons
- `plrctrls.cpp` is 2.6k lines mixing targeting, UI grid navigation, store/stash navigation and walking. Split by concern.
- Two notions (`ControlMode` vs `ControlDevice`) exist only because the right stick simulates a mouse; a cleaner model is "pointer source" + "navigation source".
- Auto-target runs a BFS over a 112x112 `visited` array every frame; cache per tick or on target/position change.
- Melee BFS caps at 25 because the monster path limit is 25; keep such constants in one place.

---

## 5. Core math: points, displacements, directions, rectangles, isometric transforms

### Purpose
Provides the typed 2-D primitives every system uses (tile coordinates, pixel offsets, 8-way directions,
rectangles) and the world↔screen isometric projection.

### Key data structures
- `PointOf<T> {x, y}` (`Point = PointOf<int>`, `WorldTilePosition = PointOf<uint8>`), `DisplacementOf<T> {deltaX, deltaY}` (`Displacement = int`, `WorldTileDisplacement = int8`), `SizeOf<T> {width, height}`, `RectangleOf<Coord, Size> {position, size}` (constructible from centre + radius → square of side `2r+1`).
- `Direction : uint8 {South=0, SouthWest, West, NorthWest, North, NorthEast, East, SouthEast, NoDirection}` — **clockwise starting at screen-down**.
- `std::hash<WorldTilePosition> = x<<8 | y`.
- `PointsInRectangle(rect)` iterator (row-major, reversible) used for area scans.

### Algorithms & rules
- Direction → tile delta: S(1,1), SW(0,1), W(−1,1), NW(−1,0), N(−1,−1), NE(0,−1), E(1,−1), SE(1,0). Note world +x is screen down-right, world +y is screen down-left.
- `Left(d) = (d+7)%8`, `Right(d) = (d+1)%8`, `Opposite(d) = (d+4)%8`.
- **World→screen** (pixels, tile 64x32): `sx = (dy − dx) * 32`, `sy = −(dy + dx) * 16` (rotation by −135° and scale). **Screen→world**: `dx = (2sy + sx) / −64`, `dy = (2sy − sx) / −64`. Missile variant rounds half-away (`±32` before `/64`); light variant divides by 8 (1/8-tile units).
- `worldToNormalScreen`: rotate `(dy−dx, −(dy+dx))`, normalise to 16.16 fixed point, halve y → unit vector in iso space (used for projectile velocity).
- `GetDirection(a, b)`: octant classification with slope test `5*minor <= 2*major` (≈ tan 22.5° = 0.4), giving 8 directions; ties fall to the cardinal world axes.
- Distances: `WalkingDistance = max(|dx|,|dy|)` (Chebyshev, 8-way steps), `ManhattanDistance`, `ExactDistance = floor(sqrt(dx²+dy²))`, `ApproxDistance`: `approx = max*1007 + min*441; if max < 16*min: approx −= max*40; return (approx+512)/1024` (<5 % error, integer only).
- Mega ↔ world: `megaToWorld = (16 + 2x, 16 + 2y)` (north corner of the 2x2), `worldToMega = ((x−16)/2, (y−16)/2)`.
- `Displacement::Rotate(q)` rotates by 90° quadrants; `flipX/Y/XY`.
- `Rectangle::contains`, `Center` (truncating), `inset(d)`.

### Reference tuning values
| Constant | Value |
|---|---|
| Tile pixel size | 64 x 32 |
| Iso scale factors | 32 (x), 16 (y) |
| Octant slope | 2/5 = 0.4 |
| Border of world grid | 16 tiles |
| ApproxDistance coefficients | 1007, 441, −40, /1024 |

### Smallest buildable chunks
1. `Point/Displacement/Size/Rectangle` templates with operators (+,−,*,/,==) and signed/unsigned conversions; done when constexpr unit tests pass.
2. `Direction` enum + `Left/Right/Opposite` + `Displacement(Direction)`; test that applying all 8 to a point yields the ring.
3. `worldToScreen/screenToWorld` with round-trip test on all deltas in [−64,64]².
4. `GetDirection` octant function; table test against atan2.
5. Distance functions incl. `ApproxDistance` accuracy test (<5 %).
6. Mega/world conversion helpers.
7. `PointsInRectangle` forward/reverse iterator.
8. Hash for tile positions (for render-time missile buckets).

### Pitfalls / design lessons
- The direction enum is screen-relative while deltas are world-relative; the comment-free table confuses newcomers. Document the axis convention prominently (as above) and provide `DirectionToScreenVector`.
- Multiple screen→world variants (`screenToWorld`, `screenToMissile`, `screenToLight`) with different rounding exist because callers evolved separately; pick one rounding rule and one unit (sub-pixel fixed point).
- `PointOf<uint8>` for world tiles saves memory but makes negative-offset arithmetic a trap (`FindPath` guards underflow manually).

---

## 6. Random number generation

### Purpose
Two generators: (1) a legacy 32-bit LCG whose exact sequence is needed for deterministic, save-compatible
level/item generation (seeded per level), and (2) a modern xoshiro128++ "seed generator" that produces
unpredictable seeds for new games and can be split into independent streams.

### Key data structures
- `LegacyLcgGenerator` wraps `std::linear_congruential_engine<uint32, a=0x015A4E35, c=1, m=2^32>` (the classic Borland C `rand()`), plus global copies `sglGameSeed` (current state) and `legacyGenerator`.
- `xoshiro128plusplus { uint32 s[4] }` with `next()`, `jump()` (2^64 steps), `save/copy`; seeded from `SplitMix64(time_ns)` XOR `std::random_device`.
- `SplitMix32/64` scramblers (constants `0x9e3779b9`, `0x85ebca6b`, `0xc2b2ae35` / `0x9e3779b97f4a7c15`, `0xbf58476d1ce4e5b9`, `0x94d049bb133111eb`).

### Algorithms & rules
```
GenerateRandomNumber(): state = state*0x015A4E35 + 1 (mod 2^32); return state
AdvanceRndSeed(): v = (int32)GenerateRandomNumber(); return v == INT_MIN ? INT_MIN : abs(v)
GenerateRnd(limit): if limit <= 0 → 0
                    if limit <= 0x7FFF → (AdvanceRndSeed() >> 16) % limit   // use high bits (less LCG bias)
                    else              → AdvanceRndSeed() % limit
FlipCoin(freq=2): GenerateRnd(freq) == 0
RandomIntLessThan(v) = max(GenerateRnd(v), 0); RandomIntBetween(min,max,halfOpen)
PickRandomlyAmong({...}): index = max(GenerateRnd(n), 0)
SetRndSeed(seed) / GetLCGEngineState() / DiscardRandomValues(n)
GenerateSeed() = xoshiro.next(); ReserveSeedSequence() = copy then jump()
```
Known quirks preserved for compatibility: `abs(INT_MIN)` special-case; limits in 32768..65534 never
exceed 32767 (modulo applied to the full value, so results in (−v, −1] are rare but possible when the sign
bit survives); item/level "seeds" stored in saves are `AdvanceRndSeed()` outputs (so ~50 % of stored
seeds do not equal the engine state). Per-level determinism: `SetRndSeed(DungeonSeeds[level])` is called
at several checkpoints during level load (before generation, before monsters/objects, before items) so
that each phase is reproducible independent of RNG draws elsewhere (see §23).

### Reference tuning values
| Constant | Value |
|---|---|
| LCG multiplier / increment / modulus | 0x015A4E35 / 1 / 2^32 |
| High-bit shift for small ranges | 16 |
| Small-range threshold | 0x7FFF |
| xoshiro jump polynomial | {0x8764000b, 0xf542d2d3, 0x6fa035c3, 0x77f2db5b} |
| Default coin | 1-in-2 |

### Smallest buildable chunks
1. LCG engine class with `seed/next/discard` and golden-sequence test (first 10 outputs from seed 1).
2. `GenerateRnd` range reduction incl. the high-bit rule; property test for distribution and the documented quirks (or deliberately fixed, flagged as incompatible).
3. Convenience API (`FlipCoin`, `RandomIntBetween`, `PickRandomlyAmong`).
4. xoshiro128++ with `jump()` and SplitMix seeding; test vectors from the reference implementation.
5. Global seed service: `GenerateSeed`, `ReserveSeedSequence` (per-subsystem independent streams).
6. Save/restore of the LCG state for replay/desync debugging (`GetLCGEngineState`).

### Pitfalls / design lessons
- A single global LCG consumed by gameplay, UI (random SFX picks) and rendering (palette choice) means any extra call anywhere desyncs multiplayer. A new engine should give every deterministic subsystem its own stream (seeded from the level seed + a subsystem tag) and use a non-deterministic stream for cosmetics.
- Keep `abs()`-based positive conversion out of new code; use unsigned arithmetic.

---

## 7. Pathfinding & spatial search

### Purpose
A* on the 8-connected tile grid for players (≤100 steps) and monsters (≤25 steps) with corner-cutting
rules, plus a ring-shaped "crawl" search for the nearest valid tile (item drops, spawn placement,
teleport landing).

### Key data structures
- `PathDirs[8]` step deltas in pathfinder order: `{-1,-1} N, {-1,1} W, {1,-1} E, {1,1} S, {-1,0} NW, {0,-1} NE, {1,0} SE, {0,1} SW`.
- Path output: `int8 path[maxLen]` of step codes 1..8 per the table
  ```
          dx: -1  0  1
   dy=-1:     5  1  6
   dy= 0:     2  0  3
   dy= 1:     8  4  7
  ```
  (`GetPathDirection(a,b) = PathDirections[3*(dy)+4+dx]` with `PathDirections = {5,1,6,2,0,3,8,4,7}`), remaining slots filled with −1.
- `FrontierNode {PointOf<uint8> position; uint16 f}` in a `StaticVector<…,1024>` binary min-heap.
- `ExploredNodes`: fixed hash map of 64 buckets × 48 entries keyed by `(x&7)<<3 | (y&7)`, storing `{prev, g}`.
- Callbacks: `canStep(from,to)` (corner rule), `posOk(tile)` (walkable for this actor).

### Algorithms & rules
A* (`FindPath`):
1. Costs: axis step 100, diagonal 101 (so frame-equal paths prefer straight lines). Heuristic
   `h = min(dx,dy)*101 + |dx−dy|*100` (admissible, octile).
2. Early out if `h(start,dest) > 101 * maxPathLength`.
3. Pop min-f; tie-breaks: lower h, then **diagonal step preferred**, then larger x, then larger y.
4. Skip nodes with `g ≥ 101*maxLen` or stale heap entries (`g + h > f`).
5. For each of 8 neighbours: guard `uint8` underflow; if `!posOk(n)` it is only allowed when `n == dest`
   (lets you path *to* a monster/object tile); else require `canStep(cur, n)`.
6. Relax: insert if unseen (and bucket not full) or improve if `g` smaller; always push to heap
   (lazy deletion) while heap < 1024.
7. Reconstruct by following `prev` to the node with `g == 0`; if longer than `maxLen` return 0.
Corner rule (`CanStep`): a diagonal step A→B is allowed only if both orthogonal neighbours shared by A and B
are not solid (no squeezing between two wall corners); walls, closed doors and occupied tiles count.
`FindClosestValidPosition(posOk, start, minR=0, maxR=18 (≤50))` runs `Crawl` rings: ring r visits
`(0,r), (0,−r)`, then `(±x, ±r)` for x in 1..r−1, then the inset corners `(±(r−1), ±(r−1))`, then
`(±r, 0)`, then `(±r, ±y)` for y in 1..r−1 — i.e. a square with rounded corners, nearest-first.

### Reference tuning values
| Constant | Value |
|---|---|
| Step costs | 100 straight / 101 diagonal |
| Max open nodes | 1024; explored capacity 64×48 = 3072 |
| Max path length | player 100, monster 25 |
| Default crawl radius | 18 (max 50) |
| Coordinate type | uint8 (grid ≤ 256) |

### Smallest buildable chunks
1. Grid predicates (`IsTileSolid`, `IsTileWalkable`, `IsTileOccupied`, `CanStep`).
2. Octile heuristic + step-cost functions with unit tests.
3. Fixed-capacity binary heap and bucketed explored-set (no allocations).
4. A* core with lazy deletion, destination-may-be-blocked rule, early-out.
5. Path reconstruction into direction codes + `PathDirs` encoding test (round trip).
6. `Crawl` ring iterator with deterministic visitation order (golden test for r=4).
7. `FindClosestValidPosition` wrapper.
8. Debug overlay: draw the player's path indices on tiles (reference does this in `DrawCell` under `DebugPath`).

### Pitfalls / design lessons
- Output as direction codes with a quirky numbering table is a legacy of 1996; use `Direction` enums.
- The 25-step monster limit leaks into AI (auto-target BFS, `GetDistance`). Make path budget an explicit parameter object.
- Allowing the destination to be non-walkable is a hidden feature several callers rely on; document it.

---

## 8. Animation timing & sub-tick interpolation

### Purpose
Drives sprite frames at tick resolution (`ticksPerFrame`), supports skipped frames ("faster attack"),
repeated actions and frame-distribution tricks, and computes which frame to *render* between ticks using
`ProgressToNextGameTick`, so 20 Hz logic looks smooth at any FPS. Also turns walking animation progress
into pixel offsets.

### Key data structures
`AnimationInfo`:
```
OptionalClxSpriteList sprites
int8 ticksPerFrame            // ≥1
int8 tickCounterOfCurrentFrame
int8 numberOfFrames
int8 currentFrame
bool isPetrified              // frozen: no interpolation
-- distribution state --
int8 relevantFramesForDistributing_      // 0 = plain mode
int8 skippedFramesFromPreviousAnimation_
FixedPoint<uint16,7> tickModifier_       // animation-frames per tick (×128)
FixedPoint<int16,7>  ticksSinceSequenceStarted_
```
`AnimationDistributionFlags {None, ProcessAnimationPending, SkipsDelayOfLastFrame, RepeatedAction}`.
`baseValueFraction = 128`. `FixedPoint<Storage, FracBits>` helper with `fromInt/fromRaw/whole/raw`,
C-like promotion rules, `multiplyWithoutWidening`, `divideWithoutWidening`.
`ActorPosition {tile, future, last, old, temp}` + walking-offset helpers.
`WalkVelocityForFrames[24] {quarter, half, full}` with `full ≈ 1024 / frames` (1/16-px units per tick):
`{256,512,1024}, {128,256,512}, {85,170,341}, {64,128,256}, {51,102,204}, {42,85,170}, {36,73,146}, {32,64,128}, {28,56,113}, {26,51,102}, {23,46,93}, {21,42,85}, {19,39,78}, {18,36,73}, {17,34,68}, {16,32,64}, {15,30,60}, {14,28,57}, {13,26,54}, {12,25,51}, {12,24,48}, {11,23,46}, {11,22,44}, {10,21,42}`.
`WalkParameters[8]` (per `Direction`): S(0, +half), SW(−half, +quarter), W(−full, 0), NW(−half, −quarter),
N(0, −half), NE(+half, −quarter), E(+full, 0), SE(+half, +quarter).

### Algorithms & rules
**Per tick** (`processAnimation(reverse=false)`):
```
tickCounter++; ticksSinceSequenceStarted += 1
if tickCounter >= ticksPerFrame: tickCounter = 0; currentFrame += ±1; wrap → 0 (or n−1) and reset ticksSinceSequenceStarted
```
**Start** (`setNewAnimation(sprites, n, tpf, flags, numSkipped, distributeBeforeFrame, previewFragments)`):
- `RepeatedAction` and same `n` and the previous animation was truncated at/after `distributeBeforeFrame−1` → carry `skippedFramesFromPrevious = oldN − oldFrame − 1`.
- `currentFrame = numSkipped`, counters reset. If any skipping/flags: let `relevantFrames = distributeBeforeFrame ? distributeBeforeFrame−1 : n`;
  `ticksForDistribution = relevantFrames * tpf`; `ticksWithSkipping = ticksForDistribution − numSkipped*tpf`;
  `ProcessAnimationPending` → `ticksWithSkipping −= 1; ticksSinceSequenceStarted = −1`;
  `SkipsDelayOfLastFrame` → `ticksWithSkipping −= (tpf−1)`;
  `ticksForDistribution += skippedFromPrevious * tpf`; add `previewFragments/128` ticks to both;
  `tickModifier = ticksForDistribution / ticksWithSkipping / tpf` (frames per tick, 7-bit fraction).
**Render frame** (`getFrameToUseForRendering`): plain mode → `max(0,currentFrame)`; else if
`currentFrame ≥ relevantFrames` → `currentFrame`; else
`absFrame = floor((progressToNextGameTick/128 + ticksSinceSequenceStarted) * tickModifier)`, minus
`skippedFromPrevious` (negative → show tail of previous animation `n + abs`), clamped to
`relevantFrames−1`.
**Progress 0..128** (`getAnimationProgress`): `((progress + ticksSinceStart) * tickModifier / n).raw()`;
in plain mode `ticksSinceStart = frame*tpf + counter`, `tickModifier = 1/tpf`.
**Walking pixel offset** (`GetOffsetForWalking`): `MovingOffset[dir] * progress / 128` with
`MovingOffset = S(0,32) SW(−32,16) W(−64,0) NW(−32,−16) N(0,−32) NE(32,−16) E(64,0) SE(32,16)`; camera mode
negates it (the world scrolls under the player). The velocity-table variant
(`CalculateWalkingOffsetShifted4`): `velocityProgress = progress*n/128`, `offset = velocity[n] * velocityProgress`
(1/16 px), used for cursor prediction.
`GetAnimationFrame(frames, fps=60) = (ticks_ms / fps) % frames` — a wall-clock animator for UI spinners.

### Reference tuning values
| Constant | Value |
|---|---|
| Fraction base | 128 (7 bits) |
| Walk distance per tile | 64 px horizontally / 32 px vertically (one tile) |
| Full walk velocity | ≈1024/frames in 1/16 px per tick (→ 64 px over the animation) |
| UI spinner | 60 ms per frame |
| Max frames/ticks per animation | int8 (≤127) |

### Smallest buildable chunks
1. `FixedPoint<T,F>` with promotion rules + tests.
2. `AnimationInfo` plain mode (`setNewAnimation`, `processAnimation`, `isLastFrame`, `currentSprite`).
3. Reverse playback (used for monster fade-out).
4. Frame-skip distribution (`numSkipped`, `distributeBeforeFrame`) + `getFrameToUseForRendering`; golden tests for the 3-frame/2-tpf example in the comments.
5. `RepeatedAction` carry-over of truncated frames.
6. `getAnimationProgress` and `GetOffsetForWalking` table; test that offset at progress 128 equals one tile.
7. `WalkVelocityForFrames` table generator (`1024/n` rounding) + per-direction velocity.
8. Petrified flag (freeze interpolation).
9. `changeAnimationData` (gear swap mid-animation keeps frame, disables distribution).
10. Wall-clock UI animator.

### Pitfalls / design lessons
- The distribution logic exists to hide tick quantisation of 1996 gameplay rules (e.g. attack speed modifiers implemented as *skipped frames*). A new engine should express attack duration in ticks and derive frame sampling, not the other way around.
- `ticksSinceSequenceStarted_ = −1` as a sentinel for "process will run this tick" is fragile; pass an explicit `startsThisTick` flag.
- Two walking-offset systems (table of 8 constants vs velocity table) coexist; keep only the fraction-based one.

---

## 9. Asset loading & sprite formats

### Purpose
Locates files in layered archives/loose directories, loads them into memory, and converts legacy sprite
formats to one runtime format (`CLX`) that the blitter decodes directly. Also provides palette translation
tables (TRN) for colour-swapping sprites.

### Key data structures
- `AssetRef` (archive pointer + hash index, or absolute path when unpacked) with `ok()`, `size()`; `AssetHandle` with `read/seek`. `FindAsset(path)`, `OpenAsset(path, size)`, `OpenIntegralAsset` (integrity-checked logic assets: `.lua/.tsv/.sol`; overriding them taints multiplayer eligibility).
- `MpqArchives` ordered by priority (user mods > expansion > base > engine archive > fonts); `FontMpqPriority`.
- `LoadFileInMem<T>(path, &count)`, `LoadFileInMemWithStatus` returning `std::expected<…, std::string>`.
- **CLX container**: sprite list = `u32 numSprites; u32 offset[numSprites+1]` (last = data size) followed by frames; sprite sheet = `u32 listOffset[numLists]` then lists. Frame = `u16 headerSize(=6); u16 width; u16 height;` then pixel commands. Classes `ClxSprite`, `ClxSpriteList`, `ClxSpriteSheet`, owned variants and `Optional*` intrusive optionals.
- **CLX pixel commands** (same as the legacy CL2 body; rows are stored **bottom-to-top**, runs may cross row boundaries):
  - control `c < 0x80` → `c` transparent pixels;
  - `0x80 ≤ c ≤ 0xBE` → fill run of width `0xBF − c` (1..63) with the next 1 byte;
  - `c ≥ 0xBF` → `−(int8)c` (1..65) literal pixels follow.
- TRN = 256-byte palette index remap (`infra` for infravision, `stone` for petrified, `pause` for the tinted pause/debug overlay, per-class/per-unique monster recolours).
- Dungeon tile graphics are a separate non-CLX format (see §12).

### Algorithms & rules
- Legacy CEL (RLE per row, frame widths supplied by caller) and CL2 (32-pixel block offsets) are
  transcoded to CLX at load (`CelToClx`, `Cl2ToClx`); PCX for menu art (`PcxToClx`). Under `UNPACKED_MPQS`
  the pipeline reads pre-converted `.clx` files directly.
- Audio lookup tries an `.mp3` sibling first, then the original path (§19).
- Font/engine archive version checks happen before any asset use.
- `ClxApplyTrans(list, trn)` can bake a TRN into sprite data (used for player gear recolours).
- `IsPointWithinClx(point, sprite)` decodes to test opaque hit (pixel-perfect picking); `ClxMeasureSolidHorizontalBounds` for UI alignment.
- A small draw cache (`ClearClxDrawCache`) must be flushed when sprites are freed.

### Reference tuning values
| Constant | Value |
|---|---|
| CLX frame header | 6 bytes |
| Fill run width | 1..63; literal run 1..65; transparent run 1..127 |
| Max assets path buffer | 4088 bytes |
| Special-tile sprite width (arches/trees) | 64 px |

### Smallest buildable chunks
1. Virtual file system with priority-ordered mounts (directories first, then archives); done when override order is testable.
2. `expected`-returning loaders (`LoadFileInMem<T>`), with size-alignment checks.
3. CLX container reader (list/sheet/frame) + validator (offsets monotonic, header size 6).
4. CLX encoder (`clx_encode.hpp`) for converting your own art; round-trip test with the decoder.
5. Legacy CEL/CL2/PCX importers (only if reusing old art).
6. TRN loader and `ApplyTrans`.
7. Pixel-perfect hit test over CLX.
8. Integrity-tagged asset class (hash check for logic files).
9. Asset version sentinel check with user-facing error.

### Pitfalls / design lessons
- Having sprite width live outside the file (CEL) forced a transcode step at load; CLX fixes it by storing width/height per frame. Use a self-describing format from day one.
- Bottom-to-top row order is a historical artefact; the blitter renders "backwards" and has to skip lines for clipping. A top-down format with per-row offsets simplifies clipping.
- Keep archive reading single-threaded or locked; the loading thread and UI thread contend for the archive (the reference pre-loads the cutscene background on the UI thread for this reason).

---

## 10. Surface, back buffer & presentation

### Purpose
Owns the 8-bit paletted back buffer, sub-surface views, dirty-rectangle tracking per back buffer, the
upscale path (8-bit → RGB texture → renderer) and frame pacing; keeps a copy of pixels under the software
cursor so it can be un-drawn.

### Key data structures
- `Surface { SDL_Surface* surface; SDL_Rect region }` — non-owning view; `at(x,y)`, `operator[](Point)`, `pitch()`, `subregion/X/Y`, `Clip(srcRect,&pos)`, `BlitFrom`, `BlitFromSkipColorIndexZero`; `OwnedSurface` (INDEX8).
- Globals: `PalSurface` (8-bit back buffer), `Palette` (SDL palette), `renderer`, `texture` (streaming), `RendererTextureSurface` (RGB staging), `RenderDirectlyToOutputSurface`, `DirtyRects` (≤16) + `ForceFullUpdate`, `LastPresentedPixels`.
- `RedrawState { Redraw : {None, ViewportOnly, All}; redrawComponents[Health, Mana, ControlButtons, Belt] }` kept **per back-buffer pointer** (`BackbufferPtrAndState` vector) because double/triple buffering hands out different pixel buffers.
- `DrawnCursor { Rectangle rect; uint8 behindBuffer[8192] }`.
- Screen geometry: `gnScreenWidth/Height`, `gnViewportHeight = screenHeight − mainPanelHeight` (when the panel spans the bottom), `GetUIRectangle()` (centred 640x480 UI box), main panel `640x128` bottom-centred, side panels `320x352` (`SidePanelSize`), `CanPanelsCoverView()` ⇔ screen ≤ 640 wide and ≤ 480 tall.

### Algorithms & rules
- `CreateBackBuffer`: render directly to the window surface if it is 8-bit and same size (SDL1/odd targets), else allocate `PalSurface` INDEX8 and attach the global palette.
- `BltFast(src,dst)`: direct mode → record dirty rect (or force full if >16); else blit 8-bit → output surface (software scaling path for SDL1).
- `RenderPresent`: if inactive → sleep via `LimitFrameRate` only. Renderer path: clear, `UpdateTexture(surface)`, copy, draw virtual gamepad, present, limit FPS unless VSync. Surface path: `UpdateWindowSurfaceRects(DirtyRects)` if the pixel pointer is unchanged since last frame, else full update.
- `LimitFrameRate` (option `CPUSleep`): keep a `frameDeadline` in µs; if ahead, `SDL_Delay(ceil(remaining))`; `refreshDelay` = display refresh period in µs (1e6/Hz).
- Partial blits (`DrawMain`): blit `[0, hgt)` rows (`hgt` = full screen on "All", viewport height on "ViewportOnly", 0 otherwise), then panel pieces: belt `(204,5) 232x28`, info box `InfoBoxRect (177,46) 288x64` (or chat box `(171,6) 298x116`), mana `(460,0) 88x72` + spell icon `(564,64) 56x56`, health `(96,0) 88x72`, buttons `(8,7) 74x114` & `(559,7) 74x48` (+ MP buttons `(86,91)/(526,91) 34x32`), previous and current cursor rects.
- Software cursor: before drawing, copy the pixels behind (`BlitCursor` into `behindBuffer`), draw; next frame restore first (`UndrawCursor`). Rect = sprite size + 1-px outline when holding an item, centred on the mouse for items.
- `Zoom` (2x pixel doubling in place): source = top-left quarter, written back-to-front so it never overwrites unread pixels; odd widths copy one extra column/row.
- Window size: prefers desktop aspect (`fitToScreen`), integer scaling option divides desktop by the largest integer factor; UI rectangle centred.

### Reference tuning values
| Constant | Value |
|---|---|
| Logical default resolution | 640x480 |
| Main panel | 640x128, bottom-centred |
| Side panels | 320x352 |
| Max dirty rects | 16 |
| Cursor behind-buffer | 8192 bytes (≈ 64x128 or 90x90 incl. outline) |
| Back buffer format | 8-bit indexed |

### Smallest buildable chunks
1. `Surface` view type with sub-regions and clipping helpers; unit test `Clip`.
2. Back buffer creation with direct/indirect mode selection.
3. Palette attach + `SystemPaletteUpdated(first,n)`.
4. Dirty-rect recorder with overflow → full update; test the >16 rule.
5. Present path for renderer/texture and window-surface modes; VSync/CPU-sleep limiter.
6. Per-buffer redraw-state table keyed by pixel pointer.
7. Component dirty flags (health, mana, buttons, belt) and `DrawMain` region table.
8. Software cursor save/restore with clipping at screen edges.
9. 2x zoom in-place doubler.
10. Screen geometry service (viewport height, UI rect, panel rects, `CanPanelsCoverView`).
11. Hardware cursor: build an SDL colour cursor from the 8-bit sprite, scale to output DPI, hot-spot rules, max size fallback to software (option 0/64/128/256/512).

### Pitfalls / design lessons
- Keeping redraw state per back-buffer pointer is clever but obscure; with triple buffering you must redraw the viewport three times after a "RedrawEverything". A simpler rule: always redraw the viewport, use dirty flags only for the static panel.
- The panel blit table is a list of magic rectangles tied to a 640x128 bitmap; derive rects from the panel layout description.
- In-place 2x zoom forbids rendering at full resolution; prefer rendering to a half-size surface and scaling at present.

---

## 11. Palette & colour pipeline

### Purpose
Everything is rendered into an 8-bit indexed buffer; colour appears only at present time through a
256-entry palette. The palette layer loads per-level palettes, applies a brightness curve, fades to/from
black, animates water/lava by rotating palette ranges, builds the 50 % transparency lookup table, and
generates the 16 lighting shade tables.

### Key data structures
- `logical_palette[256]` (what the level wants, after colour cycling) and `system_palette[256]` (what is uploaded: logical + brightness + fade).
- Palette layout convention: indices **0..127 level-specific**, **128..255 global UI ramps**: `PAL8_BLUE 128, PAL8_RED 136, PAL8_YELLOW 144, PAL8_ORANGE 152` (8-shade ramps), `PAL16_BEIGE 160, PAL16_BLUE 176, PAL16_YELLOW 192, PAL16_ORANGE 208, PAL16_RED 224, PAL16_GRAY 240` (16-shade ramps, +0 brightest). Index 0 = black/transparent-shadow.
- `paletteTransparencyLookup[256][256]` — nearest palette index to the average of two colours (Quake-2 style), built with a k-d tree over the palette; optional `paletteTransparencyLookupBlack16[65536]` for blending pairs with black.
- `LightTables[16][256]` (shade 0 = identity … 15 = black), `FullyLitLightTable`/`FullyDarkLightTable` pointers used as fast-path markers (null when a tileset makes even "fully lit" remap colours).
- `LightFalloffs[16 radii][128 distances]` and `LightConeInterpolations[8][8][16][16]` (see §14).

### Algorithms & rules
- **Brightness** (option 0..100, step 5): tone map `f(x) = a·x² + (1−a)·x` with `a = −(b/100)·2.0`; applied per channel via a 256-entry LUT (`ApplyGlobalBrightness`). 0 = identity, 100 = strongest brightening.
- **Fade** (`PaletteFadeIn/Out(fr)`): target = brightness-corrected palette; `fr *= 3`; loop `i = fr·(now−t0)/50` from 0 to 255 (`ApplyFadeLevel(i)` = `c·i/256`), re-upload palette, present each step, `SDL_Delay(1)` when unchanged; demo mode uses `fr = 0` (instant). Fade-out ends with `BlackPalette()`. With `fr = 8` → 24 levels per 50 ms → ≈ 530 ms full fade.
- **Level palette choice** (`LoadRndLvlPal`): hub town and some tilesets use fixed files; others pick one of 4 variants (`RandomIntBetween(1,4)` from the level RNG) — a cheap way to vary look per visit while staying deterministic.
- **Blending LUT**: for each pair (i<j) nearest palette index to `((r_i+r_j)/2, …)`; the k-d tree excludes a "skip" range so animated colours are never chosen as blend results (tier-3/expansion-tier palettes skip 1..31 or 1..15).
- **Colour cycling** (once per tick batch, option `colorCycling`): tier-3 tileset rotates indices 1..31 forward; tier-4 rotates each light table's entries 1..31 (the walls "flow" through shading); expansion tilesets rotate 1..15 reverse every other tick and 16..31 reverse every tick (240-frame period), or 1..8 and 9..15 reverse every third tick (56-frame period). Cycling must also rotate rows/columns of the blending LUT so transparency stays consistent.
- **Light tables** (`MakeLightTable`): the palette is treated as 18 ramps of lengths `{16×8, 8×4, 16×6}` (= 256). For shade `s` in 0..15 and ramp length `n`: `shading = s·n/16`; entry `k` of the ramp maps to `start + k + shading`, or to black if it would leave the ramp or hit 255. Table 15 is forced all-black. Tier-4 override: entries 1..16 and 31..17 become a 1..16 "blood" gradient scaled by `(15−s)/15`; fully-lit optimisation disabled. Expansion tilesets: entries 0..15 are identity in every table (self-lit lava), table 15 maps 1..15 → 1; fully-dark optimisation disabled.

### Reference tuning values
| Constant | Value |
|---|---|
| Palette size | 256; level-specific 0..127 |
| Brightness range/step/strength | 0..100 / 5 / `MaxAdjustment = 2.0` |
| Fade speed | `fr = 8` → 24 steps per 50 ms |
| Palette variants per tileset | 4 |
| Shade levels | 16 (0 lit … 15 black) |
| Ramp structure | 16,16,16,16,16,16,16,16, 8,8,8,8, 16,16,16,16,16,16 |
| Cycle periods | 240 frames (two-rate), 56 frames (three-tick) |

### Smallest buildable chunks
1. Palette file loader (768 bytes RGB) → logical palette.
2. Brightness LUT + `UpdateSystemPalette`.
3. Fade in/out with time-based stepping and instant mode.
4. Palette upload abstraction (`SystemPaletteUpdated(first,n)`) incl. hardware-cursor refresh hook.
5. Light-table generator with the ramp table; golden test on shade 8.
6. Tileset-specific light-table overrides as data (which ranges are self-lit).
7. k-d tree nearest-colour + blending LUT builder (with skip range); test symmetry `L[i][j]==L[j][i]`.
8. Colour-cycling routines as data (`{from,to,direction,everyNth}` per tileset) that also rotate the LUT.
9. Random palette variant selection from the level RNG.
10. Single-colour update path (`SetLogicalPaletteColor`) for scripted effects.

### Pitfalls / design lessons
- Palette rotation has to patch the blending LUT in two axes each tick; cheap in 1996, fiddly now. If you keep 8-bit, store animated colours outside the blend domain (as the skip-range hack does) and avoid rotating the LUT.
- Brightness as a non-linear curve on the palette (not gamma on output) means UI colours shift too; apply it only to the level range 0..127 or at present time as a shader.
- A 256-entry palette means 16 shades × 18 ramps leave no room for smooth gradients; modern engines should light in RGB and only *emulate* the 16-step look if desired.

---

## 12. Dungeon tile rendering primitives (micro-tiles)

### Purpose
Draws the level geometry. A level "piece" (tile id) is a stack of 32-px-wide micro-tile frames: two
columns (left/right halves of the 64-px tile) × up to 8 rows (floor row + wall rows). Each frame has a
shape type (square, RLE square, left/right triangle, left/right trapezoid) that determines its byte layout
and lets the diamond floor be drawn without alpha testing. Blitting applies a light table or per-pixel
lightmap and optional 50 % blending with left/right diagonal masks for see-through walls.

### Key data structures
- `TileType : uint8 {Square (32x32 raw), TransparentSquare (RLE: int8 run, +n pixels / −n skip, no row crossing), LeftTriangle (32x31, rows of width 2,4,…,32,…,4,2; 2 padding bytes before even rows removed at load), RightTriangle (same, padding after), LeftTrapezoid (lower 16-row triangle + 32x16 rect), RightTrapezoid}`.
- `LevelCelBlock : uint16` — `type = (data & 0x7000) >> 12`, `frame = data & 0xFFF` (1-based), `0` = empty.
- `MICROS { LevelCelBlock mt[16] }`, `DPieceMicros[MAXTILES=1379]`; `MicroTileLen` = 10 (5 rows) for most tilesets, 12 for the tier-4 tileset (file has 16 blocks/piece), configurable for custom hub towns.
- `TileProperties : uint8 {Solid 1, BlockLight 2, BlockMissile 4, Transparent 8, TransparentLeft 16, TransparentRight 32, Trap 128}` from the `.sol` file, `SOLData[MAXTILES]`.
- `MaskType {Solid, Transparent, Right (upper-right triangle blended, lower 16 rows opaque), Left}`.
- `Clip {top, bottom, left, right, width, height}`; `DiamondClipY` for triangle halves.
- `LightType {FullyDark, PartiallyLit, FullyLit, PerPixel}` chosen by comparing the light table pointer with the fully-lit/fully-dark markers.
- Constants: `DunFrameWidth = 32`, `DunFrameHeight = 32`, `DunFrameTriangleHeight = 31`, `XStep = 2` (triangle widens 2 px per row), `ReencodedTriangleFrameSize = 512`, `ReencodedTrapezoidFrameSize = 784`.

### Algorithms & rules
- **Micro table build** (`SetDungeonMicros`): the `.min` file stores `blocks` u16 per piece in a quirky order; the engine reorders with `pieces[blocks − 2 + (block & 1) − (block & 0xE)]` so that `mt[0], mt[1]` are the floor left/right and `mt[2k], mt[2k+1]` are successively higher wall rows. While scanning, each distinct frame id is recorded with its type and whether its piece is a floor; frames are then **re-encoded** (`ReencodeDungeonCels`): triangles lose their padding bytes, RLE floor squares that are really diamond floors with foliage on top are split into a triangle + a 16-row foliage strip (`GetDunFrameFoliage = frame + 512`), and `LevelCelBlock.data` is adjusted for removed frames.
- **Cell draw** (`DrawCell`): rows 0/1 at the tile's screen position (if the tile is not a floor or is a `TransparentSquare` → foliage), each subsequent pair at `y −= 32`. Transparency: `TileHasAny(Transparent) && TransList[dTransVal]` ⇒ wall rows use `MaskType::Transparent`; the first row uses `Left`/`Right` masks for trapezoids (`TransparentLeft/Right` flags) so only the far side of a corner is see-through. A per-cell `bleedUp` lightmap copy is made (per-pixel mode) so wall columns above the floor reuse the floor's light.
- **Floor pass** (`DrawFloorTile`): rows 0/1 only, forced `LeftTriangle/RightTriangle` with height 31.
- **Line blitters** per `LightType × transparent`: fully dark → memset 0 / blend-with-black; fully lit → memcpy / `pal[src][dst]`; partially lit → `tbl[src]`; per-pixel → `LightTables[lightmap[dst]][src]`. Left/Right masks split each row into an opaque prefix and a blended suffix whose width changes by ±2 per row (`InitialPrefix −32 / 64`, `PrefixIncrement +2 / −2`).
- **Clipping**: `CalculateClip(x, y, w, h, out)` (y is the **bottom** row); triangles/trapezoids have specialised full / clip-vertical / clip-left / clip-right paths; squares are trivial; RLE squares skip runs while clipped.
- `world_draw_black_tile(sx, sy)`: two fully-dark triangles = the 64x31 diamond used for out-of-bounds.
- Dispatch is a compile-time template matrix (TileType × MaskType × LightType) to keep inner loops branch-free; `DUN_RENDER_STATS` counts calls per combination.

### Reference tuning values
| Constant | Value |
|---|---|
| Micro frame | 32 px wide; 32 rows (31 for triangles) |
| Micro rows per piece | 10 (5 rows) typical, 12 for tier 4, 16 slots max |
| Max pieces | 1379 |
| Triangle growth | 2 px per row from 2-px tip |
| Foliage strip | 16 rows above a floor triangle |
| Diamond (floor) | 64x31 |

### Smallest buildable chunks
1. Tile-type enum + frame byte-layout spec + decoder tests (synthetic frames).
2. `.min`-style micro table (`MICROS`) loader with explicit row ordering (don't copy the quirky index formula; store rows top-down).
3. Tile property flags loader (`.sol`) + per-tileset fix-up table.
4. Square blitter (opaque / light table / blended) with clipping.
5. RLE-square blitter.
6. Left/right triangle blitters incl. 4 clip variants.
7. Trapezoid = triangle lower + rect upper; mask prefix logic for `Left/Right`.
8. Light-type dispatcher by table pointer identity.
9. `DrawCell` stacking (floor row, wall rows at −32 each, transparency flags).
10. Foliage split (optional; needed only if floor art embeds overhanging decals).
11. Black diamond + out-of-bounds fill.
12. Render-stats counter for profiling combinations.

### Pitfalls / design lessons
- Shape-typed frames exist to avoid per-pixel alpha tests on 1996 CPUs; today a plain RLE/alpha sprite per micro-tile is simpler and fast enough, but the **diamond-aware clipping** idea is still useful for software renderers.
- The micro table ordering formula is a notorious source of bugs; store the data in draw order.
- Transparency depends on a side table (`TransList`) filled by the vision system each tick; coupling renderer ↔ vision through a global array is fragile — pass it as a frame parameter.

---

## 13. Isometric scene renderer & camera

### Purpose
Renders the visible world each frame: computes which diamond-grid tiles cover the viewport from the
camera tile (`ViewPosition`, normally the player's tile) and the player's sub-tile walking offset, draws
floors, then walls + every entity per tile in painter's order, then out-of-bounds filler, then the
automap and UI overlays, with sprite outlines for hover targets and infravision/petrified recolours.

### Key data structures
- Camera: `ViewPosition : Point` (tile), per-frame `tileShift : Displacement` (tile offset from camera to the first drawn tile), `tileOffset : Displacement` (pixel position of the first tile's bottom-left), `tileColumns`, `tileRows` (computed by `CalcViewportGeometry` when resolution/zoom/panel changes).
- Entity grids (all `[MAXDUNX][MAXDUNY]`): `dPiece u16` (tile id), `dLight u8` (0..15), `dPreLight u8` (static light base), `dFlags` (`Missile, Visible, DeadPlayer, Populated, MissileFireWall, MissileLightningWall, Lit, Explored`), `dPlayer i8` (id+1, negative while moving *into* the tile), `dMonster i16` (same convention; NPC index in town), `dObject i8` (negative for extra tiles of large objects), `dItem i8`, `dCorpse i8` (`& 0x1F` index, `>> 5` direction), `dSpecial i8` (arch/tree overlay frame), `dTransVal i8` (transparency group).
- `MissilesAtRenderingTile : hash_map<WorldTilePosition, vector<Missile*>>` rebuilt per frame from interpolated positions.
- Outline colours: players `PAL16_ORANGE+7 / YELLOW+7 / RED+7 / BLUE+7`, objects `PAL16_YELLOW+2`, NPCs `PAL16_BEIGE+6`, monsters `PAL16_RED+9`.
- `Lightmap` (per-pixel light buffer, §16) or light table index per tile.

### Algorithms & rules
**Viewport geometry** (`CalcViewportGeometry`, zoom halves all screen dims):
```
playerPos = (screenW/2, (screenH − panelH)/2)  (+8 px y when zoomed)
tilesToTop  = ceil(playerPos.y / 32); tilesToLeft = ceil(playerPos.x / 64)
start = playerPos − (tilesToLeft*64, tilesToTop*32)
tileShift = North*tilesToTop + West*tilesToLeft          // world offset of first tile
if tilesToLeft*64 >= playerPos.x: start += (32, −16); tileShift += NorthEast   // must start on a "short" row
elif tilesToTop*32 < playerPos.y: start += (0, −32); tileShift += North
tileOffset = (start.x − 32, start.y + 15)                // bottom-left of first tile's bbox
renderStart = start − (32, 16)
tileRows = (viewportH − renderStart.y + 15) / 16
tileColumns = (screenW − renderStart.x + 63) / 64
```
**Per-frame first tile** (`CalcFirstTilePosition`): `offset = tileOffset + (walking? −walkOffset)`,
`position = ViewPosition + tileShift`; when side panels can cover the view and one is open, shift one
(zoom) or two (normal) tiles east and adjust x so the visible half is centred; when the player walks
toward N/NE/SW/W/NW, start one tile earlier in that direction and extend rows/columns (`DrawGame`: N/S +2
rows, NE +1 col +2 rows, E/W +1 col, SE/SW/NW +1 col +1 row).

**Row walk** (shared by floor, content, OOB and lightmap passes): for each row `i`: draw `columns` tiles
stepping `tile += East (1,−1)`, `screen.x += 64`; then return to row start, `screen.y += 16`; on odd rows
`tile.x++`, `columns−−`, `screen.x += 32`; on even rows `tile.y++`, `columns++`, `screen.x −= 32`.
This zig-zags down the diamond grid so rows alternate between "long" and "short".

**Pass order** (`DrawGame`):
1. `Lightmap::build` (per-pixel mode).
2. `DrawFloor` — floor triangles only for tiles where `IsFloor` (not Solid and not BlockMissile).
3. `DrawTileContent` with `rows += MicroTileLen` (walls extend upward past the viewport bottom). For each
   tile: **wall-behind trick** — if this tile is a wall aligned along x (neighbours ±x are walls) with
   walkable tiles behind it (`(1,−1)` and `(0,−1)` not solid), draw the *next* tile first and skip it on
   the next iteration, so sprites standing behind a thin wall do not poke through.
4. `DrawOOB` (rows+5): black diamonds in the hub town, or a repeated 2x2 "dirt" pattern sampled from the
   level corner in dungeons.
5. Zoom doubling, then `DrawAutomap` over the viewport, then labels, health bars, floating numbers, panels,
   dialogs, pause/death overlays, messages, flasks.

**Per-tile draw order** (`DrawDungeon`), using `lightIdx = dLight[x][y]`:
1. `DrawCell` (geometry stack).
2. missiles flagged "pre" (behind actors), e.g. ground effects.
3. corpse (if lit) with unique recolour or light table.
4. object with `_oPreFlag` (e.g. floor rugs/doors) — object sprite anchored by its own tile for multi-tile objects (`getRenderingOffset` subtracts the world offset projected to screen).
5. item (non-post-draw); outline if hovered or "show all items" held; label queued when its drop animation finished.
6. dead player(s) on this tile.
7. **player** if `dPlayer == ±(id+1)` with the sign rule: an actor moving southwards (S/SW/SE) or east is registered with a **negative** id on the destination tile and drawn when the *destination* tile is reached, but positioned at the tile it comes from (`+(32,−16)`, `(0,−32)`, `(−32,−16)` for SW/S/SE; `(−64,0)` for E) so it is painted after the walls of the source tile but before those of the destination row. Otherwise it is drawn with its walking pixel offset (`GetOffsetForWalking`).
8. **monster** with the same sign rule; NPCs in the hub drawn unlit.
9. post missiles (projectiles, spells).
10. post objects, post items.
11. special overlay `dSpecial` (arches; in town, the tree canopy of the tile at `(−1,−1)` drawn one tile later so it covers the player) — blended if its transparency group is active.
Entity sprite anchor: `x −= (spriteWidth − 64)/2` (`CalculateSpriteTileCenterX`), `y` = tile bottom.

**Lighting of sprites**: unlit tile → skip monsters (unless infravision + floor) and non-local players;
local player always drawn with table 0 (except expansion tilesets); other players use `max(lightIdx−5, 0)`
(always a bit brighter); infravision active and `lightIdx > 8` → infravision recolour; petrified →
stone recolour; unique monsters → their own TRN.

**Missile interpolation** (`UpdateMissileRendererData`): `pixels = (traveled + velocity·progress/128) >> 16`,
`tileOffset = pixels.screenToMissile()`; if the predicted tile differs and could collide (`out of bounds`,
or blocked, or has a monster/player when the missile is blockable), decrement `progress` until the
predicted tile equals the current tile (so projectiles never visually pass through walls before logic says so).

**Screen position of a tile** (`GetScreenPosition(tile)`): `((firstTile − tile).worldToScreen()) + offset`
where `firstTile/offset` come from `CalcFirstTilePosition` — used by picking and floating text.

**FPS counter**: 1-s window, tenths precision (`fps = 10000·frames/ms`).

### Reference tuning values
| Constant | Value |
|---|---|
| Extra wall rows scanned | `MicroTileLen` (10 or 12) |
| Extra OOB rows | 5 |
| Walk extra rows/cols | +2 rows (N/S), +1 col (E/W), both for diagonals |
| Other-player brightness bias | light index −5 |
| Infravision threshold | light index > 8 |
| Panel-cover tile shift | 2 tiles (1 when zoomed) |
| Zoom | 2x pixel doubling of the top-left quarter |

### Smallest buildable chunks
1. Camera struct + `CalcViewportGeometry` with unit tests at 640x480, 1280x720, zoomed.
2. Diamond row-walk iterator (shared by all passes) yielding `(tile, screenPos)`.
3. Floor pass.
4. Content pass skeleton calling `DrawCell` only; verify against a reference screenshot.
5. Entity registration grids with the ±id "moving into" convention and `PlayerAtPosition/FindMonsterAtPosition` helpers.
6. Per-tile entity order (corpse, pre-object, item, players, monsters, missiles, post-object, special) as a data-driven layer list.
7. Moving-actor repositioning rule (southward/east) + walking offsets.
8. Wall-behind look-ahead rule.
9. Out-of-bounds filler (black / dirt pattern).
10. Missile per-frame interpolation with collision-aware clamping; bucket map by tile.
11. Sprite outline draw (1-px outline skipping colour 0) for hover targets.
12. Lighting selection per sprite (table index, infravision, stone, unique TRN).
13. `GetScreenPosition(tile)` and its inverse support for picking.
14. Zoom pass and panel-aware column reduction.
15. FPS overlay.
16. Debug grid/coords overlay (draw tile diamonds and text per tile from a `DebugCoordsMap`).

### Pitfalls / design lessons
- Painter's order by **tile** forces hacks (negative ids for moving actors, wall look-ahead, tree canopy delayed one row). A new engine should sort draw calls by screen-space depth key `(tileX + tileY, layer, subOrder)` per frame — the reference comments admit this.
- Camera is welded to the player (`ViewPosition` + player walk offset); make the camera an entity with its own interpolation so cutscenes/spectating are possible.
- The missile "walk back progress until not colliding" loop is O(progress); precompute the fraction at which the tile boundary is crossed.
- `rows += MicroTileLen` over-scans rows for every tile even when there are no tall walls; keep per-tileset max wall height.

---

## 14. Tile lighting

### Purpose
Maintains `dLight[x][y]` (0 = fully lit … 15 = black) as the combination of a static base (`dPreLight`,
baked from level objects such as braziers) and up to 32 dynamic point lights (players, spells, some
monsters) with radius-based falloff and sub-tile offsets, recomputed only when something changed.

### Key data structures
- `Light { LightPosition {WorldTilePosition tile; DisplacementOf<int8> offset (1/8 tile); WorldTilePosition old}; uint8 radius, oldRadius; bool isInvalid, hasChanged }`.
- `Lights[MAXLIGHTS=32]`, `ActiveLights[32]` (index free-list; first `ActiveLightCount` are live), `UpdateLighting` dirty flag, `NO_LIGHT = −1`.
- `LightFalloffs[radius 0..15][distance 0..127]` and `LightConeInterpolations[offX 0..7][offY 0..7][x 0..15][y 0..15]` (precomputed `sqrt((8x−offX)² + (8y−offY)²)`, i.e. distance in 1/8 tiles).
- `InfravisionTable/StoneTable/PauseTable[256]` TRNs.

### Algorithms & rules
- **Falloff** (`MakeLightTable`): `maxDistance = (radius+1)·8`; `shade(d) = d > maxDistance ? 15 : round(d/maxDistance · 15)` (linear). Expansion tilesets use quadratic over-exposure: `brightness = radius·1.25; shade = max(0, (d/max)²·brightness + (15 − brightness))`.
- **Apply** (`DoLighting(pos, radius, offset)`): normalise negative offsets by stepping the tile back and adding 8; set centre to 0 (or `min(current, falloff[radius][0])` in dim tilesets); then for 4 quadrants (rotating the delta by `Rotate(−i)` and the offsets with `RotateRadius`) loop `y in [0,bound)`, `x in [1,bound)` (bounds 15 clipped to the map): `d = cone[offX][offY][x+blockX][y+blockY]`; skip if `d ≥ 128`; `v = falloff[radius][d]`; write `min(existing, v)` to `dLight` (or `dPreLight` while loading map objects).
- **Remove** (`DoUnLight(pos, radius)`): copy `dPreLight` back to `dLight` over the square of radius `radius+2` (extra 2 for diagonal moves/offsets).
- **Process** (`ProcessLightList`, once per tick if dirty): pass 1 un-lights every invalid light and every changed light's old position/radius; pass 2 compacts the active list (swap-remove invalid) and re-applies every remaining light unless its tile is `Solid` ("monster hidden in a wall – don't spoil the surprise").
- Mutators (`AddLight`, `AddUnLight`, `ChangeLightRadius/XY/Offset`, `ChangeLight`) only record `old*` and set flags; nothing is computed until process time. `ChangeLightOffset` ignores no-op changes (player offset updates every frame while walking).
- `SavePreLighting()` snapshots `dLight → dPreLight` after level objects placed their static lights; on level entry `dLight = dPreLight` then the player's light is forced to refresh.
- Hub town: all tiles flagged `Lit` and lighting not processed.
- `lighting_color_cycling()` (tier-4): `rotate(table[1..31])` in every light table per tick.

### Reference tuning values
| Constant | Value |
|---|---|
| Max dynamic lights | 32 |
| Radii | 0..15 (player default radius lives in player data; monsters berserk 3, 9 in one tileset) |
| Light extent | up to 15 tiles each direction; distance table 128 (1/8 tiles) |
| Un-light margin | radius + 2 |
| Dim-tileset brightness | radius × 1.25 |
| Sub-tile offset resolution | 1/8 tile |

### Smallest buildable chunks
1. Light table + falloff + cone table generation (pure functions, golden tests).
2. `Light` pool with free-list and deferred dirty processing.
3. `DoLighting` quadrant loop with offset handling; test symmetric result for offset 0.
4. `DoUnLight` restore from base.
5. `SavePreLighting` / level entry reset.
6. Tileset-specific minimum brightness (dim mode).
7. Solid-tile suppression rule.
8. Debug toggle to disable lighting (`DisableLighting` → all 0).
9. Hook for palette-cycling tilesets.

### Pitfalls / design lessons
- Light contributions are combined by `min(shade)` (brightest wins), never summed; overlapping torches do not get brighter. Cheap and stable, but if you want additive light, do it in the per-pixel map (§16).
- Writing lights into the same array that rendering reads (`dLight`) with a base copy (`dPreLight`) makes "static" vs "dynamic" an ordering problem (`LoadingMapObjects` flag switches the target array!). Keep two layers and compose.
- 32 lights is a hard cap silently enforced (`AddLight` returns `NO_LIGHT`); report it.

---

## 15. Vision / fog of war

### Purpose
Determines which tiles each player can currently see (`Visible`), which are lit for rendering purposes by
the local player (`Lit`), which have ever been seen (`Explored`/automap), and which transparency groups
(walls between the player and visible floor) must be drawn see-through this frame.

### Key data structures
- `VisionList[MAXVISION=4]` (one `Light` record per player, keyed by player id), `VisionActive[4]`, `UpdateVision` dirty flag.
- `VisionRays[23][15]` — integer ray point tables for one quadrant (0°–90°), mirrored to 4 quadrants with `Quadrants = {(1,1), (−1,1), (1,−1), (−1,−1)}`; `RayLenAdj[23] = {0,0,0,0,1,1,1,2,2,2,3,4,3,2,2,2,1,1,1,0,0,0,0}` trims rays so the footprint is a circle.
- `TransList[256]` — bool per transparency group id (`dTransVal`).
- `MapExplorationType {NONE, OLD, SHRINE, OTHERS, SELF}` (automap colouring by who explored).

### Algorithms & rules
`DoVision(pos, radius, markVisible, markTransparent, passesLight, inBounds)`:
```
markVisible(pos)
for quadrant in 4:
  for ray j in 0..22:
    len = radius − RayLenAdj[j]
    for k in 0..len−1:
      p = pos + VisionRays[j][k] * quadrant
      if !inBounds(p): break
      if ray is not axis-parallel (both deltas > 0):
          // prevent seeing through a diagonal gap between two blockers
          if !(passesLight(p + (−qx,0)) || passesLight(p + (0,−qy))): break
      markVisible(p)
      if !passesLight(p): break          // the blocking tile itself is visible (walls show)
      markTransparent(p)                 // floor seen ⇒ its wall group becomes see-through
```
`passesLight = InDungeonBounds && !TileHasAny(BlockLight)`. `markVisible` sets `Visible`, `Lit` (if
this is the local player), `Explored`, and calls `SetAutomapView` with the exploration type (`SELF` for the
local player, `OTHERS` for friendly players, none for hostile). `markTransparent` sets
`TransList[dTransVal[p]] = true`.
`ProcessVisionList` (per tick if dirty): clear `TransList`; for each player: deactivate vision if the
player left the level; if changed, `DoUnVision(old, oldRadius)` (clear `Visible|Lit` in square radius+2);
then re-cast every active vision. Vision radius is a player stat (light radius); monsters use the
`Visible` flag to decide whether they can see/attack a player.

### Reference tuning values
| Constant | Value |
|---|---|
| Rays per quadrant | 23, max 15 points each |
| Max vision radius | 15 (table length) |
| Un-vision margin | radius + 2 |
| Vision sources | 4 (one per player) |

### Smallest buildable chunks
1. Ray table (ship the 23×15 table or generate with Bresenham and verify equality).
2. Quadrant mirroring + diagonal-gap rule; fixture tests (corridor, pillar, door).
3. Flag writers (`Visible`, `Lit`, `Explored`) with per-player semantics.
4. Transparency group collection (`TransList`) and its consumption by the renderer.
5. Deferred processing with old-position clearing.
6. Automap exploration hook with owner type.
7. Debug overlay drawing visible tiles (reference `DebugVision`).

### Pitfalls / design lessons
- Vision is recomputed from scratch for every player each dirty tick (≈ 4×23×15 ≈ 1.4k steps per player) — fine; but clearing with a square margin then re-casting leads to one-tick flicker opportunities if processing order changes. Keep "clear then cast" atomic within one tick.
- `Lit` here means "seen by the local player", unrelated to light level — rename to `SeenByLocalPlayer`.
- Transparency groups are stored per tile in `dTransVal` by the level generator; document that convention in the level-gen module.

---

## 16. Per-pixel lightmap (optional smooth lighting)

### Purpose
Replaces per-tile flat shading with a per-pixel light-level buffer that interpolates between the four
tile corners of each diamond cell using marching squares, so light gradients are smooth. Walls reuse
("bleed up") the light of the floor row beneath them.

### Key data structures
- `Lightmap { outBuffer, outPitch, lightmapBuffer (span), lightmapPitch, lightTables, fullyLit/fullyDark markers }` — `getLightingAt(dstPixelPtr)` maps a back-buffer address to the light-level byte (rows above the buffer reuse row 0 for bleed-up).
- `LightmapBuffer : vector<uint8>` sized `viewportWidth × (viewportHeight + 32·(MicroTileLen/2 + 1))`.
- `InterpTable[n 0..14][d 1..15] = (n·16 + 8)/d` — 4-bit interpolation factors.

### Algorithms & rules
- `BuildLightmap(firstTile, screenPos, w, h, rows, cols, dLight, microTileLen)`: `rows += microTileLen + 2 + 3`, `cols += 1`, start two tiles NW and `(−64, −32)` px so cells outside the viewport contribute; fill with 15 (dark); walk the diamond grid; for each cell take the quad `q0 = L(t), q1 = L(t+(1,0)), q2 = L(t+(1,1)), q3 = L(t+(0,1))` (cell corners are the centres of 4 adjacent tiles; q3 of the next cell is the previous q1); if `min(q) < 15` render contour bands from `min(max(q),14)` **down to** `min(q)`, each band filling the region where `q ≤ level` (brighter overwrites darker).
- `RenderCell(quad, center0, level)`: cell corners `c0 = center`, `c1 = c0 + (32,16)`, `c2 = c0 + (0,32)`, `c3 = c0 + (−32,16)` in 28.4 fixed point; marching-squares case `shape = (q0≤L)<<3 | (q1≤L)<<2 | (q2≤L)<<1 | (q3≤L)`; cases 1–14 build 1–6 triangles with edge points at `Interpolate(qa, qb, L)` fractions; ambiguous cases 5 and 10 use the cell average `(Σq+2)/4` to decide the centre; case 15 fills the whole diamond (fast path `RenderFullTile` when fully on screen: rows widen by 4 px per scanline from the top/bottom).
- `RenderTriangle(p1,p2,p3)`: half-space rasteriser in 28.4 → 24.8 fixed point with top-left fill convention, bounding-box clipped to `[0,pitch) × [0,scanLines)`, filling spans with `FillBytesUpTo64`.
- `bleedUp(source, tileScreenPos, buffer[64·32])`: copy the 64x32 window under the tile's floor diamond into a scratch lightmap, and for each row above the lower half copy from the row below, so wall pixels take the floor's light; clipping at buffer edges handled; returns a `Lightmap` whose `outBuffer` is remapped so `getLightingAt` works for the wall column drawn above.
- Blitters then use `LightTables[light[pixel]][src]` per pixel (`BlitPixelsWithLightmap`) or blend variants; CLX sprites can also be lit per pixel (`ClxDrawWithLightmap`), used for arch overlays.

### Reference tuning values
| Constant | Value |
|---|---|
| Fixed point | 28.4 for vertices, 24.8 for edge deltas |
| Extra lightmap rows | `microTileLen + 5` tile rows; +32·(microTileLen/2+1) px buffer height |
| Levels | 0..15, iterate max→min per cell |
| Interp factors | 4-bit (`(n·16+8)/d`) |

### Smallest buildable chunks
1. Half-space triangle rasteriser with fill convention; test coverage equals a reference scanline fill.
2. Marching-squares case table for the diamond cell (16 cases, ambiguous handling).
3. Cell sweep sharing corner values; full-tile fast path.
4. Buffer sizing with wall head-room; `getLightingAt` address mapping incl. negative rows.
5. `bleedUp` scratch copy for a tile.
6. Lightmap-aware blitters (opaque, blended, fill).
7. Option toggle and A/B screenshot test vs flat shading.

### Pitfalls / design lessons
- Mapping light by **destination pixel address** (`outLoc − outBuffer`) couples the lightmap to the back-buffer layout; pass (x,y) instead.
- Per-cell bands from max to min re-rasterise overlapping triangles up to 15 times; a per-pixel bilinear evaluation of 4 corners is simpler on modern hardware (this design targets integer-only CPUs).

---

## 17. Cursor, picking & hardware cursor

### Purpose
Converts the mouse position into a world tile and the entity under the cursor (monster, NPC, player,
object, item, trigger), honouring sprite pixels for precision; manages cursor sprites (hand, special
spell cursors, hourglass, held item) in software or as an OS hardware cursor.

### Key data structures
- `cursor_id {NONE, HAND, IDENTIFY, REPAIR, RECHARGE, DISARM, OIL, TELEKINESIS, RESURRECT, TELEPORT, HEALOTHER, HOURGLASS, FIRSTITEM…}` — item cursors are `FIRSTITEM + itemGraphicId`.
- Picking outputs: `cursPosition : Point` (tile), `pcursmonst` (−1 none), `pcursitem`, `pcursinvitem`, `pcursstashitem`, `ObjectUnderCursor*`, `PlayerUnderCursor*`, `pcurstemp` (previous monster, for sticky selection), `trigflag`, `InfoString` (hover text).
- `CursorInfo {CursorType {Unknown, UserInterface, Game}; spriteId}` for the hardware cursor; `DrawnCursor` behind-buffer (§10).

### Algorithms & rules
`CheckCursMove()` (every frame when not in menu/timeout):
1. `screen = MousePosition`; if panels can cover the view and one is open: `x ∓= screenW/4`; if dragging-walk over the main panel, clamp y above it; if zoomed, halve.
2. `AlterMousePositionViaPlayer`: add `CalcTileOffset` centring remainder (`(64 − W%64)/2`, `(32 − H%32)/2`, zoom-aware); subtract the player's walking offset (camera mode) and additionally **predict one tick ahead** (`fx = off/256 − (off+vel)/256`) to avoid jitter.
3. `ConvertToTileGrid`: `TilesInView` (columns = ceil(W/64), rows = ceil(H/32), halved when zoomed), `lrow = rows − RowsCoveredByPanel()`; start from `ViewPosition` shifted by `ShiftGrid(−cols/2, −lrow/2)` (`ShiftGrid(h, v)`: `x += v + h; y += v − h`); parity fix-ups (`cols even && lrow even → y += 16`; both odd → `x −= 32`; cols odd, lrow even → `tile.y++`); zoom → `y −= 8`; then `ShiftGrid(x/64, y/32)`.
4. `ShiftToDiamondGridAlignment`: `px = x % 64, py = y % 32`; `flipy = py < px/2 → tile.y−−`; `flipx = py ≥ 32 − px/2 → tile.x++`; clamp to grid; `flipflag = (flipy && flipx) || ((flipy || flipx) && px < 32)` — tells the selectors which neighbouring tile's tall sprite may overlap this pixel.
5. If a button is held with a non-trivial `LastPlayerAction`: keep current targets (validate them) and only update `cursPosition`; return.
6. Reset all picks; if invincible/holding an item/spell menu → just tile; main panel hover → panel info; open side panels → inventory/stash/store cell hit tests; else:
7. `CheckCursorActions`: identify cursor → tile only; `TrySelectPixelBased(tile)` (not in demos/headless): search rendering columns/rows in a `{−1,−1}..{1,6}` window **backwards** (last drawn wins), convert render offsets to world tiles (`East·x + South·(evenY/2)` (+1 y for odd rows)), and for monsters/players/objects/items on those tiles test `IsPointWithinClx(mouse − spriteTopLeft, sprite)` (zoom-aware); fall back to tile-based selection: prefer the previously selected monster if still valid, then any monster (not for heal/resurrect cursors), NPC in town, then player, object, item, using `flipflag` to also test the adjacent tile for tall sprites.
8. Else set `cursPosition` and show trigger info (stairs/portals under cursor; town portal owner).
`NewCursor(id)`: dropping an item cursor onto a non-item cursor first tries `TryDropItem`; sets `pcurs`; hardware cursor swap if enabled and in mouse mode. Held item cursors are drawn centred with a coloured outline (quality colour).
Hardware cursor: build from the CLX sprite into an RGBA surface, scale by output/logical ratio (bilinear when option says), hot-spot top-left for hand, centre for items; sizes above `hardwareCursorMaxSize` (default 128) fall back to software; reinitialised on window resize and every palette fade step (cursor colours follow the palette).

### Reference tuning values
| Constant | Value |
|---|---|
| Pixel-pick search window | x −1..1, y −1..6 render cells |
| Panel half-shift | screenWidth/4 |
| Hardware cursor max | 128 px (options 0/64/128/256/512) |
| Cursor sprites | 12 fixed + one per item graphic; half-size item sprites generated for hover previews |

### Smallest buildable chunks
1. `ScreenToTile(mousePos)` pure function given camera state (steps 1–4) with golden tests at several resolutions.
2. `flipflag` neighbour disambiguation.
3. Entity selectors (monster/NPC/player/object/item) by tile with validity predicates.
4. Pixel-perfect selector using sprite masks and reverse draw order.
5. Sticky previous-target rule.
6. Hover info string provider (name, trigger text).
7. Cursor sprite manager (`NewCursor`, held item outline, half-size previews).
8. Hardware cursor builder with scaling and max-size fallback.
9. Walking-prediction compensation (one tick ahead) — measure jitter before/after.

### Pitfalls / design lessons
- Picking re-derives the camera transform with its own arithmetic (`ConvertToTileGrid`) instead of inverting `GetScreenPosition`; the parity fix-ups are the cost. Implement picking as the exact inverse of the renderer's transform.
- Pixel-perfect picking is disabled in demos because sprites are not loaded headless — meaning replays can diverge from live play if selection matters. Make picking a pure function of recorded inputs (record the resolved target).

---

## 18. Automap / minimap

### Purpose
Draws a vector-style overhead map of explored mega-tiles (walls as lines, doors/arches/stairs as glyphs,
dirt/rivers/lava variants), player arrows, optional item dots, and level/difficulty text; supports zoom,
panning, three modes (opaque overlay, transparent overlay, corner minimap).

### Key data structures
- `AutomapTile { Types type (≈60 shapes: None, Diamond, Vertical, Horizontal, Cross, FenceVertical/Horizontal, Corner, Cave*, Bridge, River*, Lava*, PentagramClosed/Open…); Flags {VerticalDoor 1, HorizontalDoor 2, VerticalArch 4, HorizontalArch 8, VerticalGrate 16, HorizontalGrate 32, Dirt 64, Stairs 128} }` — one per **mega-tile id** loaded from a per-tileset `.amp` table (`AutomapTypeTiles[256]`), with code fix-ups per tileset.
- `AutomapView[DMAXX][DMAXY] : MapExplorationType` (who explored), `AutomapActive`, `CurrentAutomapType {Opaque, Transparent, Minimap}`, `AutoMapScale` (percent, 50 default), `MinimapScale`, `AutomapOffset` (pan in mega-tiles), `MinimapRect`.
- Helpers: `AmOffset(wx, hy) = scale·{wx, hy}/100` where offsets are expressed as fractions of a tile (`EighthTile… DoubleTile`), `AmLine(len) = scale·len/100` with `len ∈ {2,4,8,12,16,64}`.
- Colours: player arrows `PAL8_ORANGE/YELLOW/RED/BLUE + 1`, bright lines `PAL8_YELLOW`, dim `PAL16_YELLOW+8`, items `PAL8_BLUE+1`, lava `PAL8_ORANGE+2`, water `PAL8_BLUE+2`, acid `PAL8_YELLOW+4`; explored-by-others beige, by shrine grey.

### Algorithms & rules
- **Exploration**: `SetAutomapView(worldTile, who)` → mega `((x−16)/2, (y−16)/2)`; raise `AutomapView` (never lower); then propagate to neighbours that are "dirt corners" so walls get their far side revealed (rules per `Vertical/Horizontal/Cross/Fence*`). Town marks everything explored on entry.
- **Scale**: one mega-tile is `d = scale·64/100` px wide; zoom in/out ±25 in [25, 200]; minimap scale = `25·min(screenH/480, 8)`; minimap rect = width `W/4`, height `W/8`, padding `W/128`, top-right.
- **Draw** (`DrawAutomap`): map origin `((ViewX − 8)/2, (ViewY − 8)/2)` (−4,−4 in dungeons), clamp `AutomapOffset` so origin stays on the grid; `cells = 2·(W/2/d) + 1` (+1 if remainder, +1 if remainder ≥ d/2, +1 if the player is walking); screen centre = viewport centre (or minimap centre) + half-tile down; adjust by cells parity, odd `ViewPosition` components (±half tile), player walk offset `scale·off/100/2`, open side panels `∓W/4`. Then two interleaved loops of `cells+2` rows: row A draws `cells` tiles along `(map.x+j, map.y−j)` stepping `+2·tile` px; row B is offset `(−tile, +tile/2)` and draws `cells+1`; `map.y++`, `map.x++`, `screen.y += tile` per iteration.
- **Tile glyphs** (`DrawAutomapTile`): colour by exploration type; look up self/NW/NE/SW/S/SE/N/W/E neighbours (unexplored → None); suppress connection lines next to arches/grates/diamonds (and doors in two tilesets); draw dirt, stairs, wall connections, then shape-specific lines/doors/grates; rivers/lava/bridges have dedicated line sets; shrine-revealed areas grey.
- **Player arrow**: position `px = tile.x − 2·offX − ViewX`, `py = …`, screen `((px−py)·AmLine(16), (px+py)·AmLine(8))` + walk offset; 8 hand-authored 3-line arrow glyphs per direction.
- **Item dots** when the highlight key is held: search radius 8 tiles, draw diamonds.
- Text: level name/number and difficulty at top (`DrawAutomapText`).
- Keys: Tab toggles, M cycles Opaque→Transparent→Minimap→None, arrows pan (`AutomapOffset` ±(1,1)/(1,−1)), ± zoom.

### Reference tuning values
| Constant | Value |
|---|---|
| Default scale / range / step | 50 % / 25..200 / 25 |
| Mega-tile at 100 % | 64x32 px (lines 16/8 px) |
| Minimap | W/4 × W/8, padding W/128, scale 25·(H/480) |
| Item search radius | 8 tiles |
| Exploration enum order | NONE < OLD < SHRINE < OTHERS < SELF (higher wins) |

### Smallest buildable chunks
1. Map-tile metadata table loader (`.amp`-like: type + flags per mega-tile id) with per-tileset overrides as data.
2. Exploration grid with "raise only" semantics and neighbour propagation rules.
3. Scale/offset helpers (`AmOffset`, `AmLine`) and zoom/pan controls with clamping.
4. Screen anchoring maths (centre, parity, walk offset, panel shift) — golden test for 640x480 at scale 50.
5. Diamond iteration (two interleaved rows).
6. Line primitives (`DrawMapLine*`: NS, WE, NE, SE, NW, SW, steep variants).
7. Glyph renderers: walls, doors, arches, grates, stairs, dirt corners, cave variants, river/lava variants.
8. Player arrow glyphs (8 directions).
9. Item/debug highlight dots.
10. Minimap frame (half-transparent fill + double border) and mode cycling.
11. Header text (level, difficulty).

### Pitfalls / design lessons
- The glyph set is hand-authored per tileset with ~60 shapes and many `IsAnyOf(leveltype …)` special cases; a new engine should derive map lines from tile properties (solid edges) or author a per-tileset glyph table, not code.
- Map coordinates mix world tiles, mega-tiles and half-tile offsets; centralise a `MegaToMapScreen(mega) -> Point` function.

---

## 19. Audio: mixer, SFX, music, positional sound

### Purpose
Plays music streams per level type, preloads sound effects by category (UI, generic, per-class voice
lines), positions effects in stereo relative to the player, throttles duplicates, and streams long
speech lines.

### Key data structures
- `TSnd { uint32 start_tc; SoundSample DSB }` — one loaded sample + last play timestamp.
- `TSFX { uint8 bFlags; string path; unique_ptr<TSnd> }` from a data table (`txtdata/sound/effects.tsv`: id, flags, path); flags `{Stream, Misc, Ui, <class voice sets ×4>}`.
- `SoundSample` (backend wrapper: Aulib stream or SDL3_mixer track) with `SetChunk/SetChunkStream`, `PlayWithVolumeAndPan`, `Stop`, `IsPlaying`, `DuplicateFrom`, `SetVolume(log,min,max)`, `SetStereoPosition(logPan)`, `Mute/Unmute`.
- Music: `_music_id {Town, Tier1..Tier4, ExpTier1, ExpTier2, Intro}`; `MusicTracks[]`/`SpawnMusicTracks[]` paths; `sgnMusicTrack` current.
- Volume model in "millibel-like" log units: `VOLUME_MIN −1600, VOLUME_MAX 0, VOLUME_STEPS 64, ATTENUATION_MIN −6400, PAN_MIN/MAX ∓6400`.
- `duplicateSounds : list<unique_ptr<SoundSample>>` (clones playing concurrently) guarded by a mutex; finish callbacks erase them.

### Algorithms & rules
- Init: output format S16, options `sampleRate` (default 22050 in the reference options), `channels` (2), `bufferSize`, `resamplingQuality`, `resampler`, `device`; any change tears down and re-inits audio and reloads SFX.
- **Positional** (`CalculateSoundPosition(tile)`): `delta = sound − player`; `pan = clamp((dx − dy)·256, −6400, 6400)`; `volume = ApproxDistance·(−64)`; inaudible (`≤ −6400`, i.e. ≥ 100 tiles) → not played.
- **Play** (`snd_play_snd(snd, vol, pan, userVol)`): skip if sound off or **< 80 ms since the same sample last started**; if still playing, play a duplicate instance instead; `PlayWithVolumeAndPan`. Walk/bow/cast/swing effects reset `start_tc` first so they are never throttled.
- **Log → linear**: remap `[−1600, 0]` to millibels `[−10000, 0]` and `gain = 10^(mb / 3321.928)` (so −1000 = 0.5). Pan: `factor = 10^(−|pan| / StereoSeparation)` attenuates the far channel.
- **SFX categories** (`sound_init`): always `Misc`; SP loads only the local class's voice set (two classes share a set each in the reference: melee/brute, ranged/support); MP loads all; UI set for menus; streamed (`Stream`) effects are loaded on demand and only one plays at a time (`StreamPlay` stops the previous; `stream_stop` frees it). `PlaySfxPriv` suppresses non-stream, non-misc effects that are already playing; cue-type effects (accessibility) use a separate volume option.
- **Random variants** (`RndSFX`): certain ids pick among 2 or 3 consecutive ids via the game RNG.
- **Music**: streamed, looped (`Play(0)`), volume from options, stopped/started on level type change (`LoadGameLevelStopMusic/StartMusic`), muted on focus loss; reduced edition uses a smaller track set; menu cycles tracks (§1).
- Audio lookup prefers an `.mp3` next to the original `.wav` name.

### Reference tuning values
| Constant | Value |
|---|---|
| Volume range | −1600..0 (64 slider steps); −1000 ≈ half gain |
| Pan | (dx − dy)·256, clamp ±6400 |
| Distance attenuation | −64 per approx tile; cutoff −6400 |
| Duplicate throttle | 80 ms |
| Max concurrent streams | 1 |
| Focus-loss | mute music (SP also pauses) |

### Smallest buildable chunks
1. Backend wrapper (`SoundSample`) over your mixer with play/stop/volume/pan/duplicate.
2. Log-volume conversion + slider mapping (64 steps).
3. SFX table loader (id, flags, path) and category-based preloading.
4. `PlaySfx(id)` / `PlaySfxLoc(id, tile)` with positional math and 80-ms throttle.
5. Duplicate-instance pool with automatic cleanup.
6. Stream channel for speech with single-slot semantics.
7. Music manager keyed by level type with loop and fade/mute on focus.
8. Random-variant table for grouped effects.
9. Option-change re-init path.

### Pitfalls / design lessons
- The 80-ms throttle is per **sample**, not per sound type, and is bypassed for four hard-coded ids; make throttling a data flag.
- "One stream at a time" means overlapping NPC speech cuts off abruptly; consider a small priority queue.
- Positional pan uses `dx − dy` (screen-x proportional) but volume uses approx Euclidean distance; fine, but document that elevation (screen-y) has no effect.

---

## 20. Options / settings system

### Purpose
A typed, self-describing settings registry: every option knows its ini section/key, display name,
description, flags (hidden, can't change in-game, needs UI rebuild, edition-specific), default, value
description for menus, and a change callback. Settings menus are generated from it; the ini is only
rewritten when changed.

### Key data structures
- `OptionEntryBase { flags; key; name; description; callback }` with virtuals `GetType() {Boolean, List, Key, PadButton}`, `GetValueDescription`, `LoadFromIni(section)`, `SaveToIni(section)`.
- Entry kinds: `OptionEntryBoolean`, `OptionEntryIntBase` (list of allowed ints or free), `OptionEntryEnum<T>` (value→label list), `OptionEntryString`, `OptionEntryResolution` (enumerates display modes), `OptionEntryResampler`, `OptionEntryAudioDevice`, `OptionEntryLanguageCode`, `KeymapperOptions::Action` (key), `PadmapperOptions::Action` (button combo), `ModOptions` (one boolean per discovered mod).
- `OptionEntryFlags {Invisible, CantChangeInGame, CantChangeInMultiPlayer, OnlyExpansion, OnlyBase, RecreateUI, NeedBaseArchive}`.
- `OptionCategoryBase { key; name; description; GetEntries() }`; `Options { GameMode, StartUp, <BaseEdition>, <Expansion>, Audio, Gameplay, Graphics, Controller, Network, Chat, Language, Keymapper, Padmapper, Mods }` → `GetCategories()` order drives the settings menu.
- `Ini` parser/serialiser with change tracking (`changed()`, `markAsUnchanged`).

### Algorithms & rules
- `LoadOptions()`: read `config/<game>.ini`-style file into `Ini`; discover mods; for every category/entry `LoadFromIni(category.key)`; a few raw keys (network bind/host, quick chat messages as multi-value lists, controller mapping string, dead-zone float 0.07).
- `SaveOptions()`: mirror; `SaveIni()` writes only if changed (creates dir).
- Change callbacks are registered at static-init time by the owning subsystem (e.g. `showFPS → EnableFrameCount`, `fullscreen → SetFullscreenMode`, `resolution → ResizeWindow`, `grabInput → SDL grab`, audio params → re-init, `language → reload fonts/sfx`, `shareware → gbIsSpawn`).
- Gameplay options that affect simulation (tick rate, run in town, optional quests, friendly fire, full quests in MP, auto-pickup/equip, randomise quests, item labels, belt refill, shrine toggles, potion pickup counts) are copied into the session `GameData` / demo header so peers and replays agree.
- Graphics defaults (reference): fullscreen on (off in browser builds), fit-to-screen on, upscale on, scale quality anisotropic, integer scaling off, frame-rate control VSync (CPU sleep where no renderer), brightness 0, zoom off, per-pixel lighting (build default), colour cycling on, hardware cursor on where supported (off on mobile/browser), hw cursor for items off, hw cursor max 128, show FPS off.
- Gameplay defaults: tick rate 20 (hidden), `skipLoadingScreenThresholdMs` (loading screens are not even drawn if the load finishes under the threshold), XP bar, health/mana values, enemy health bar, floating info box, party portraits enum, store UI style, quick cast, etc.

### Reference tuning values
| Option | Default |
|---|---|
| Tick rate | 20 |
| Controller dead-zone | 0.07 |
| Brightness | 0 (0..100, step 5) |
| Resolution | 640x480 (platform may override) |
| Frame rate control | VSync |
| Hardware cursor max size | 128 |
| Audio | S16, 22050 Hz, 2 ch (reference option defaults) |
| Quick chat slots | 4 + extra, multi-value per key |

### Smallest buildable chunks
1. Ini reader/writer with sections, multi-value keys, UTF-8, change tracking.
2. `OptionEntry` base + Boolean/Int/Enum/String kinds with `LoadFromIni/SaveToIni`.
3. Category registry and `Options` singleton; load/save loops.
4. Change-callback mechanism (single callback per entry) and registration from owning modules.
5. Flags-driven settings menu generation (hide invisible, grey out can't-change-in-game).
6. Resolution/audio-device enumerating entries.
7. Key and pad-button entries integrated with the action maps (conflict checks, "unbound" state).
8. Mod discovery → boolean entries.
9. Session-affecting subset serialised into `GameData` / replay header.
10. Legacy key migration step.

### Pitfalls / design lessons
- Static-init-time callback registration (`const auto handler = (opt.SetValueChangedCallback(fn), true);`) depends on translation-unit init order relative to the options singleton; an explicit `RegisterOptionHandlers()` is safer.
- Only one callback per entry is supported; use a small signal/observer list.
- Options are read before the window exists, so resolution validation happens later; keep "validated at apply time" semantics explicit.

---

## 21. In-game (pause) menu widget

### Purpose
A tiny immediate-mode menu system used for the Esc menu and its Options submenu: a vertical list of large
gold text items, optional sliders (music, sound, brightness, speed), keyboard/gamepad/mouse navigation,
and the pause overlay.

### Key data structures
- `TMenuItem { uint32 dwFlags; const char* label; void (*fn)(bool activate) }` with bit-packed flags: `GMENU_ENABLED 0x80000000`, `GMENU_SLIDER 0x40000000`, slider steps in bits 12..23, current step in bits 0..11.
- Menus: SP `{Options, Save Game, Load Game, Exit to Main Menu, Quit Game}`, MP `{Options, Exit to Main Menu, Quit Game}`, Options `{Music slider, Sound slider, Gamma slider, Speed slider, Previous Menu}`; terminated by a null item.
- State: `sgpCurrentMenu`, `sgpCurrItem`, `sgCurrentMenuIdx` (count), `gmenu_current_option` (refresh callback run every draw), `isDraggingSlider`, logo animation frame/tick, art: logo, spinning pentagram cursor (48 px), slider bar (287 px), slider knob (27 px).

### Algorithms & rules
- Layout: logo at `y = 102 + uiY` centred; items start at `y = 110 + uiY`, **45 px** apart (`GMenuItemHeight`), hit-test from `GMenuTop = 117`; text centred (`(screenW − lineWidth)/2`, font size 46, spacing 2); selected item gets the spinning icon at `x − 54` and `x + 4 + w`, `y + 51`; disabled items drawn black.
- Slider: item width 490; value box at `x = 16 + 245`, inner width 283, height 29, top padding 10; fill rect colour index 205 from `SliderFillMin = 13` to `SliderFillMax = 269`; `pos = min + step·(max−min)/steps`; knob centred at pos.
- Value mapping: `gmenu_slider_set(item, min, max, value)`: `step = ((max−min−1)/2 + (value−min)·steps) / (max−min)`; `gmenu_slider_get`: `min + (step·(max−min) + (steps−1)/2)/steps`. Volume sliders use 64 steps over [−1600, 0]; gamma 21 steps over [0,100]; speed 46 steps over [20,50] (SP only; MP shows a label).
- Navigation: Up/Down skip disabled items with wrap and play a move sound; Left/Right step sliders and call `fn(false)`; Enter calls `fn(true)` (for sliders = toggle extreme: music on/off, brightness 0↔100, speed 20↔50); Esc closes (and saves options); mouse: click row → select, slider rows start drag if over the bar; drag maps mouse x to step; gamepad left stick/D-pad via a 200-ms repeater; logo animates at 25 ms/frame if multi-frame.
- Opening the menu sets `PauseMode = 0` and (SP) logic stops because `ProcessInput` returns false while the menu is active; `gamemenu_on` also runs `PressEscKey` to close other panels.
- Save: swaps in `DisableInputEventHandler`, shows "Saving" message, saves, shows "Game saved" for ≥1 s, restores. Load: fade out with the previous palette, load, fade in.
- Pause overlay: red tint (`RedBack`) outside town + "Pause" text when no menu is shown.

### Reference tuning values
| Constant | Value |
|---|---|
| Item height / first item y / top hit-test | 45 / 110 / 117 |
| Slider width / value box / knob | 490 / 287 (inner 283×29) / 27 |
| Fill colour | palette 205 |
| Logo anim | 25 ms per frame |
| Slider steps | volume 64, gamma 21, speed 46 |

### Smallest buildable chunks
1. `MenuItem` model with enabled/slider state (use plain fields, not bit-packing).
2. List layout + centred text + selection marker.
3. Keyboard navigation with wrap/skip-disabled and sounds.
4. Slider widget (set/get mapping, draw, drag).
5. Menu definitions (SP/MP/Options) with live refresh callbacks.
6. Pause overlay.
7. Save/Load flows with input disabled and status messages.

### Pitfalls / design lessons
- Bit-packing slider state into the flags word is pure 1996; use a struct.
- Option sliders write directly to globals (`gbMusicOn`, `gnTickDelay`) and save the ini on close; route through the options registry so callbacks stay the single source of truth.

---

## 22. Front-end UI (main menu, hero select, dialogs)

### Purpose
A retained-list UI toolkit for the pre-game screens: background art, animated logo, focusable lists,
buttons, scrollbars, edit boxes, yes/no and OK dialogs, credits/support scrollers, settings menu, hero
(character) creation/selection, and multiplayer lobby screens.

### Key data structures
- `UiItemBase` hierarchy: `UiText`, `UiArtText`, `UiImageClx`, `UiImageAnimatedClx`, `UiArtTextButton`, `UiList` (+`UiListItem {text, value}`), `UiScrollbar`, `UiEdit`, `UiButton`; `UiFlags` (font size 12/24/30/42/46/dialog, colour ids, alignment, `ElementHidden`, `NeedsNextElement`…).
- List controller: `gfnListFocus/Select/Esc/Fullscreen/YesNo` callbacks, `SelectedItem`, `UiItemsWraps`, `ListOffset` for scrolling, double-click detection (500 ms), scrollbar state.
- Hero select: `_uiheroinfo { saveNumber; name[16]; level; heroclass; herorank; strength; magic; dexterity; vitality; hassaved; spawned }`, `_uidefaultstats`, `_selhero_selections {NEW_DUNGEON, CONTINUE, CONNECT, PREVIOUS}`; function-pointer hooks into the save-file module (`enumerate heroes`, `create`, `delete`, `class default stats`).
- Fade-in: `fadeValue` 0..256 ramp on the UI palette each `UiFadeIn` call.

### Algorithms & rules
- Screen loop pattern: `Load(items) → UiInitList(callbacks) → while (!result) { UiClearScreen(); UiPollAndRender(); } → Free`. `UiPollAndRender`: poll events → optional custom handler → render-coordinate conversion → `UiFocusNavigation` (keys: Up/Down/PgUp/PgDn/Enter/Esc/Delete/Tab-less; gamepad via `GetMenuActions`; mouse hit-tests `UiItemMouseEvents`) → `UiHandleEvents` (mouse pos, Alt+Enter fullscreen, quit, window events) → held-direction repeat → render list items → draw mouse → `UiFadeIn` → hardware cursor visibility.
- Main menu: list of 6 entries at `(uiX+64, uiY+192)`, 510 wide, 43 px rows, font 42 gold; version string bottom-left at `(17, H−36)`; attract timer.
- Hero select flow: list of saves (+ "New Hero") → class picker (class art and base stats shown; expansion classes optional; "test" classes gated by options) → name entry (validated: printable, non-empty, length ≤ 15, profanity filter hook) → difficulty picker (SP new game) → result; delete with Yes/No dialog; last used save remembered per edition and mode.
- Multiplayer: provider select (loopback/LAN/ZeroTier-like), game create/join dialogs with difficulty/speed; out of scope here.
- Settings menu is generated from the options registry (§20) with lists for enums, key capture for bindings.

### Reference tuning values
| Constant | Value |
|---|---|
| UI logical box | 640x480 centred |
| Main menu list | x+64, y+192, 510x(6×43), font 42 |
| Double-click | 500 ms |
| Max heroes shown | `MAX_CHARACTERS` saves |
| Name length | ≤ 15 bytes |

### Smallest buildable chunks
1. UI item model + renderer per type (text, image, animated image, button, list, scrollbar, edit).
2. Focus/selection controller with wrap, page up/down, scroll offset, double-click.
3. Event routing (keyboard, gamepad menu actions, mouse hit-test) and Alt+Enter fullscreen.
4. Palette fade-in for menus.
5. Background + logo helpers, widescreen variants.
6. Dialog primitives: OK, Yes/No, progress.
7. Main menu screen + attract timer.
8. Hero list / class picker / name entry / difficulty screens driven by save-module callbacks.
9. Credits/support text scrollers.
10. Settings screen generator from the options registry.

### Pitfalls / design lessons
- Each screen owns global vectors of items and function-pointer globals; nested dialogs save/restore them manually. A proper screen stack with per-screen state objects avoids the `selhero_endMenu` style flags.
- The UI renders into the same 8-bit back buffer and reuses the game's palette machinery; fine, but keep UI colours in the global 128..255 range so level palettes never affect menus.

---

## 23. Loading screens & level transitions

### Purpose
Runs the (potentially slow) level load on a worker thread while the main thread draws a cutscene
background with a progress bar, pumps events (so the OS does not think the app hung), and then fades
out; also defines the exact sequence of steps that initialise a level (geometry, lights, entities,
players) depending on how the player arrived.

### Key data structures
- Custom SDL user event with `interface_mode` codes (`WM_PROGRESS`, `WM_ERROR` (carries a heap string), `WM_DONE`, plus the level-change requests).
- `ProgressEventHandlerState { loadStartedAt; prevHandler; skipRendering; done; drawnProgress; palette }`.
- Progress: `sgdwProgress` 0..`MaxProgress = 534` in `ProgressStepSize = 23` increments (`IncProgress(n)`), bar height 22, per-cutscene bar position/colour table (`BarPos {53,37} / {53,421}`, colours 138/43/254).
- `lvl_entry {MAIN, PREV, SETLVL, RTNLVL, LOAD, WARPLVL, TWARPDN, TWARPUP}` — where the player enters (affects spawn point and whether to restore a saved level).
- Level globals: `currlevel`, `leveltype`, `setlevel/setlvlnum/setlvltype`, `DungeonSeeds[25]`, `LevelSeeds`, `ViewPosition`.

### Algorithms & rules
**ShowProgress(uMsg)**:
1. Install `ProgressEventHandler` (inputs ignored except custom events); deactivate virtual gamepad; pump pending events; clear and present black; hide HW cursor; `BlackPalette()`; load the cutscene background + palette on the UI thread (archive access is single-threaded); snapshot the palette (the loader will replace `logical_palette`).
2. Start the loader thread running `DoLoad(uMsg)`; main thread loops `HandleProgressBarUpdate()`: if `skipLoadingScreenThresholdMs` has elapsed and nothing drawn yet → `InitRendering` (blit background into all back buffers, free it, fade in with the saved palette); poll **real** events (not demo events), forward to the handler, stop when `done`.
3. `WM_PROGRESS` → redraw the bar rect only; `WM_ERROR` → fatal; `WM_DONE` → hand cursor, draw the full bar into every back buffer, fade out with the saved palette, restore the handler, send `CMD_PLAYER_JOINLEVEL`, delay player messages by the load duration, flag done.
**DoLoad(uMsg)** per request: `sound_init` → per case: save/stash current level (`pfile_save_level` SP, `DeltaSaveLevel` MP) → `FreeGameMem` → set `currlevel/leveltype/setlevel` → `LoadGameLevel(firstflag, entry)`; `NEWGAME` also deletes temp level saves; `LOADGAME` calls `LoadGame(true)`.
**LoadGameLevel(firstflag, entry)** — canonical order:
1. Pick music for the level type; stop current music if different; reset special cursors to hand; `SetRndSeed(levelSeed)`; clear floating numbers.
2. Load TRNs, `MakeLightTable()` (tileset-dependent), tile property table, tileset graphics (`.cel/.til/special`), build micro table & re-encode, clear sprite draw cache.
3. First entry only: inventory/help/quest text/info-box gfx, shops, automap-once (scale, minimap rect).
4. Re-seed; set up shops (town) or free them; load stash on first/load entry; `InitAutomap` (map glyph table); `InitLighting` (not town, not loading a save); `InitLevelMonsters` (monster type pool).
5. **Random level**: `CreateDungeon(seed, entry)` + triggers + palette; re-seed; dungeon: monster types, themes, object/missile gfx; town: missile gfx; return-level view position / portal position; `InitPlayerGFX` + `InitPlayer` for every player on this level (unless loading); `InitMultiView`; re-seed; **town**: mark all lit, towners, stash, items, missiles, optionally reload saved town, delta-load (MP), mark whole automap explored; **dungeon**: if first visit/load/MP → `HoldThemeRooms, InitGolems, InitObjects, InitMonsters, InitItems, CreateThemeRooms, InitMissiles, InitCorpses, SavePreLighting` (+ `DeltaLoadLevel` MP) else re-create transient entities and `LoadLevel()` (restore the saved level state); dungeon messages; quest resync.
   **Fixed (quest) level**: `LoadSetMap`, monster types, golems/monsters, missile gfx, corpses, portal position, players, multi-view, items + pre-lighting or `LoadLevel`, delta/quests, missiles.
6. `SyncPortals`; place players (`SyncInitPlrPos`) or flag dead-player tiles; main panel init on first entry; monster light fix-ups; un-stick charging monsters; `dLight = dPreLight` + force player light + process lights/vision; tileset-specific hooks; activate virtual gamepad; start music; `CompleteProgress`; `MarkWalkabilityChanged`; recompute cursor target.
**Level change at runtime**: the game loop receives the custom event → write hero (MP), release the net mutex, `PaletteFadeOut(8)`, stop sounds, `ShowProgress(event)`, black-palette pre-render, water palette, `PaletteFadeIn(8)` (if still running), re-acquire mutex, `gbGameLoopStartup = true` (extra catch-up ticks).
Cutscene selection: start/load → "start" art; town; per-tileset art; portal (blue/red); gate for the last level; wide-screen variants loaded if present. Level music ids map 1:1 to tileset.

### Reference tuning values
| Constant | Value |
|---|---|
| Progress max / step | 534 / 23 (≈ 23 increments) |
| Bar height | 22 px |
| Skip-render threshold | option `skipLoadingScreenThresholdMs` |
| Fade | 8 (≈ 0.5 s) each way |
| Catch-up after load | `nTickRate*3` ticks allowed |

### Smallest buildable chunks
1. Custom-event plumbing (`Register/IsCustom/ToEvent`) with payload for errors.
2. Progress model (`IncProgress`, `CompleteProgress`) thread-safe via events.
3. Loader thread runner + main-thread pump loop + "skip if fast" rule.
4. Cutscene background/bar renderer with per-scene table and multi-back-buffer fill.
5. Palette snapshot/restore around loading (loader may change the palette).
6. `DoLoad` request → `(save old level, set level ids, entry kind)` table.
7. `LoadGameLevel` as an explicit ordered pipeline with named stages and re-seed points; unit test that the RNG state at each stage is deterministic for a given seed.
8. Entry-kind handling (spawn position by stairs/portal/return/load).
9. First-visit vs revisit branch (generate vs restore).
10. Post-load fix-ups (lights, vision, walkability, cursor).
11. Runtime level-change handler in the game loop (fade, mutex, startup flag).

### Pitfalls / design lessons
- Re-seeding the global RNG at fixed points inside the pipeline is what keeps generation stable; a new engine should pass a seeded RNG object into each generator stage instead.
- The loader thread touches most of the game state while the UI thread only draws; it works because inputs are disabled, but any accidental read from the main thread (e.g. `logical_palette`) is a race (hence the palette snapshot). Make the loading screen a pure consumer of progress messages.
- `LoadGameLevel` is a 90-line function calling 20 helpers in a specific order with `IncProgress` sprinkled in; encode the order as a table so progress steps and determinism tests fall out naturally.

---

## 24. Demo recording/playback, headless mode & debug tooling

### Purpose
Deterministic replay for regression testing and benchmarking (`--record N`, `--demo N`, `--timedemo`),
a headless mode for unit tests (no window/UI/audio), and in-game debug overlays (tile grids, path
indices, vision, coordinates, entity ids, seeds).

### Key data structures
- Demo file (version 3): header `resolution w,h (u16)`, then simulation-affecting gameplay options (run in town, optional quests, auto-pickup/equip set, randomise quests, item labels, belt refill, shrine toggle, 6 potion pickup counts); then a stream of `DemoMsg { type : {GameTick 0, Rendering 1, Quit 8, MouseMotion 9, MouseButtonDown 10, MouseButtonUp 11, MouseWheel 12, KeyDown 13, KeyUp 14, CustomEvent ≥ 64}; progressToNextGameTick u8; payload (x,y[,mod,button]) / (sym,mod) }`.
- `HeadlessMode : bool` — skips UI loads, palette uploads, presenting; asserts `ghMainWnd` only when not headless.
- Debug globals: `DebugToggle, DebugGodMode, DebugInvisible, DebugVision, DebugPath, DebugGrid, DebugScrollViewEnabled`, `DebugCoordsMap` (tile → screen px captured during rendering), grid text selector `DebugGridTextItem {microTiles, dPiece, dTransVal, dLight, dPreLight, dFlags, dPlayer, dMonster, missiles, dCorpse, dObject, dItem, dSpecial, coords, cursorcoords, objectindex, Solid, Transparent, Trap, AutomapView, dungeon, pdungeon, Protected}`, per-level RNG checkpoints `glMid1/2/3Seed, glEndSeed`, automap search highlights by name.

### Algorithms & rules
- Recording: every fetched event is written (`RecordMessage`) and every frame writes a `GameTick` or `Rendering` header with the current interpolation fraction (`RecordGameLoopResult`).
- Playback: `demo::FetchMessage` returns recorded input events (real keyboard still allows Esc to abort, ± to change tick rate); `demo::GetRunGameLoop` decides tick vs render: timedemo → run as fast as possible, render only on ticks; otherwise honour wall-clock pacing and insert extra renders when ahead of the recording (so playback looks like the original). The simulated clock is `LogicTick * 50 ms`. Options that affect gameplay are overridden from the header; hardware cursor/fit-to-screen disabled; resolution forced.
- At the end a hero snapshot is compared with a reference (`pfile_compare_hero_demo`) → "same/different outcome" and FPS printed.
- Debug overlays (debug builds only): `DrawCell` tints path tiles and prints path indices; `DrawView` prints per-tile text or draws tile diamond outlines (mega or world) from `DebugCoordsMap`; `DebugVision` draws lit tiles; console (`` ` ``) runs Lua commands incl. `+cmd` from the command line after the first loop iteration; `ScrollView` free camera with mouse at screen edges while Shift is held; `X` toggles `DebugToggle`; `V` prints monster info.

### Reference tuning values
| Constant | Value |
|---|---|
| Demo format version | 3 |
| Simulated ms per tick | 50 |
| Edge-scroll band | 20 px |
| Custom event id base in demo | 64 |

### Smallest buildable chunks
1. Input recorder/replayer with versioned header and gameplay-option snapshot.
2. Replay-driven scheduler mode (tick/render decisions from the file) + timedemo.
3. Simulated clock injection for everything time-based (`GetMillisecondsSinceStartup`).
4. End-of-run state hash/compare and report.
5. Headless flag honoured by window, palette, audio, UI, cursor code paths.
6. Per-tile debug text/outline overlay hooked into the renderer's row walk.
7. RNG checkpoint logging per level stage.
8. Free-camera scroll and god/invisible toggles.
9. Developer console with scripting hook.

### Pitfalls / design lessons
- Replays only work because *every* source of nondeterminism was hunted down (RNG, clocks, picking); design for it from the start: all gameplay reads time/RNG through injectable services and input is resolved to commands before simulation.
- Pixel-perfect picking being disabled in demos (sprites unavailable headless) is a reminder to record **resolved commands**, not raw mouse positions, if you want headless equivalence.

---

## Game loop skeleton (pseudocode, derived from the reference loop)

```text
// ---------- process start ----------
ParseCommandLine()
RegisterKeyboardActions(); RegisterGamepadActions()
MountCoreArchives(); LoadOptions(); ApplyReplayOverrides()
CreateWindowAndBackBuffer()              // 8-bit back buffer + palette
VerifyAssetVersions(); InitScripting(); MountGameArchives()
LoadDataTables(classes, spells, missiles, monsters, items, objects, quests)
InitAudio(); InitFrontEndUI(); PlaySplash()

// ---------- menu / session loop ----------
while MainMenu() selects Play:
    SessionLoop:                            // StartGame(bNewGame, bSinglePlayer)
        if !NetInit(): break
        FreeMenuArt()
        if newGame: InitLevelsQuestsPortals()
        ShowLoadingScreen(NEWGAME|LOADGAME)  // worker thread: LoadGameLevel(first=true, ENTRY_MAIN|LOAD)
        InstallGameEventHandler()
        RenderFirstFrameBlack(); PaletteFadeIn(8)
        startup = true
        while running:                      // one iteration = one *frame*
            // 1. OS events → input state / commands
            while FetchEvent(e): if Quit → running=false else HandleEvent(e)
            // 2. decide whether a logic tick is due
            tickDue = Clock.IsTickDue(&drawThisFrame)   // or replay decides
            if !tickDue:
                UpdateHover()                           // cursor → tile/entity, hold-repeat commands
                PumpNetworkPackets()
                if drawThisFrame: MarkViewportDirty(); DrawAndBlit()
                continue
            ApplyNetworkCommands()                      // queued remote/local commands
            // 3. up to 3 ticks (60 after a level load)
            for i in 0 .. (startup ? tickRate*3 : 3):
                if !SyncWithPeers(): ShowTimeoutCursor(); break
                HideTimeoutCursor()
                // ---- GameLogic(): ONE FIXED TICK ----
                if !UpdateHoverAndHeldActions(): break  // paused or SP menu ⇒ no tick
                if playersActive: ProcessPlayers()      // walk/attack/cast state machines
                if !inHubTown:
                    ProcessMonsters()                   // AI, movement, attacks
                    ProcessObjects()                    // doors, chests, traps, shrines
                    ProcessMissiles()                   // projectiles/spell effects
                    ProcessItems()                      // drop animations, flips
                    ProcessLightList()                  // recompute dLight if dirty
                    ProcessVisionList()                 // recompute Visible/Lit/Explored/TransList if dirty
                else:
                    ProcessTowners(); ProcessItems(); ProcessMissiles()
                UpdateAudioStreams(); CheckLevelTriggers(); CheckQuests()
                MarkViewportDirty(); PeriodicAutosave()
                GamepadWalkStep()
                ClearLastSentCommand()
                if !multiplayer || replay || !Clock.AnotherTickAlreadyDue(): break
            AnimatePaletteCycling()                     // once per tick batch
            startup = false
            // 4. render
            if drawThisFrame:
                DrawAndBlit():
                    RestorePixelsUnderCursor()
                    Progress = Clock.FractionToNextTick()        // 0..128
                    DrawView(camera):                            // §13
                        BuildLightmap (optional)
                        DrawFloor(); DrawTileContent(); DrawOOB()
                        Zoom (optional); Automap; labels; health bars; floating text
                        side panels / dialogs / pause / death / messages / flasks
                    DrawMainPanel pieces that are dirty; XP bar; values
                    SaveAndDrawCursor(); FPS
                    BlitDirtyRegionsToOutput(); Present()
        // leaving the session
        WriteHero(); PaletteFadeOut(8); FreeLevelAndUIArt()
        if ending: PlayEndingMovie()
Shutdown()
```

Per-tick ordering that other clusters must respect: **input/held actions → players → monsters →
objects → missiles → items → lights → vision → audio/triggers/quests → render**. Rendering never
mutates simulation state except for purely visual caches (interpolated missile positions, the
"dead player on tile" flag refresh, item label queue).

### Cross-cluster contracts worth stating explicitly
- Entities register themselves on the tile grids (`dPlayer/dMonster/dObject/dItem/dCorpse`) with the sign convention for "moving into"; the renderer and picker rely on it.
- Any change to walkability must bump `WalkabilityGeneration` (used by hold-repeat memoisation).
- Any light/vision change goes through the deferred mutators; never write `dLight`/`dFlags` directly outside the lighting module.
- Commands are the only legal way for input to affect simulation; they are tick-stamped and replayable.
- Animation state exposes `(frame, progress 0..128)`; renderers must only read, never advance it.

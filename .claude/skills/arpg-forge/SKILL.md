---
name: arpg-forge
description: Build a complete, playable isometric action-RPG (hack-and-slash dungeon crawler with procedural levels, classes, loot with random affixes, skills, a hub town with vendors and quests, bosses) in any setting the user names — "make an ARPG set in a cyberpunk future", "a Diablo-like but pirates", "dungeon crawler with loot", "isometric roguelite with classes and vendors". Use this skill whenever the user wants a game in that genre, wants to re-theme or extend one made with it, or asks how the genre's systems (loot tables, affixes, AI archetypes, dungeon generators, to-hit formulas) work. It ships a working, setting-free browser engine template plus a 9,000-line reference breakdown of the genre's systems, so the output is a finished game, not a prototype.
---

# ARPG Forge

You are about to deliver a complete game. The genre is well understood: a lone hero descends
through tiers of procedurally generated levels from a safe hub town, kills monsters with clicks
and skills, collects randomly generated loot, levels up, and finally beats a boss. The engine
template in `assets/template/` already does all of that for a neutral placeholder setting. Your
work is to **re-theme it into the user's setting, extend what they ask for, verify it runs, and
hand it over playable.** Do not rebuild systems that exist; the template is the deliverable's
foundation and the reference docs explain every formula in it.

## 0. Before you start

1. Read `references/theming-guide.md` (10 minutes, mandatory). It has the IP rules and the
   archetype table you will fill in for the user's setting.
2. Skim `references/systems/00-overview.md` so you know which deep reference answers which
   question. Open a numbered cluster file only when you need a formula or a chunk list.
3. Read `assets/template/docs/CONTRACTS.md` and `assets/template/docs/THEME_SCHEMA.md`. The
   first is the engine's shared state and function contract; the second is the exact shape of
   the content you will write.

## 1. Understand the ask (five minutes, no questions unless truly blocked)

Extract from the prompt: the **setting** (required), a **tone** (grim / pulpy / comic), any
**specific requests** (more classes, multiplayer, permadeath, a particular mechanic), and the
**delivery target** (default: a folder with `index.html` the user can serve and play in a
browser). If the setting is missing, pick one yourself and say so in a line; do not block.

Then write the archetype table from the theming guide as the first file in your plan:
`<game>/docs/DESIGN.md`. Every id and name you create afterwards comes from that table.

## 2. Scaffold

```bash
python3 <skill>/scripts/new_game.py <target-dir> --theme <theme_id> --title "<Title>"
```

This copies the template, creates `data/themes/<theme_id>/` from the default theme with the
title and meta changed, points `data/active_theme.js` at it, and prints the files you must
edit. The default theme is an original placeholder ("Hollow Vigil"); you replace its content,
you do not ship it.

## 3. Write the theme (this is most of the work)

Work through the theme files in this order; later files reference ids from earlier ones:

| Order | File | What to write | Minimum size |
|---|---|---|---|
| 1 | `meta.js`, `palette.js`, `strings.js` | title, tagline, UI colours and HUD metal (`metal`, `trim`, `trimGlow`, `ornament`), vocabulary (life→"vitals", gold→"credits"…), title-screen words (`chooseClass`, `start`, `load`, `menuHint`, `strShort`…`vitShort`) | — |
| 2 | `tilesets.js`, `world.js` | 4 tilesets (palettes + generator + an `art` block: floor/wall style, lamp kind and colour, wall decor), 4 tiers with depth ranges, the hub layout, `town.art` and NPC placements | 4 tilesets, 4 tiers, 16 depths |
| 3 | `classes.js` | 3 classes mapped to melee / ranged / caster with setting-native names, an `epithet`, a `look` with accent colour, weapon, helm, armour and cloak, stat lines, start kits, skill pools | 3 |
| 4 | `skills.js` | 16 skills across the archetypes (bolt, pierce, nova, chain, wall, groundAoe, heal, buff, blink, summon, homing, multishot, melee, townPortal, identify) | 16 |
| 5 | `items.js` | bases (≥15 weapons, ≥11 armour, ring, amulet), ≥25 prefixes, ≥25 suffixes, ≥8 uniques, consumables incl. a scroll and tome per skill, quest items | see counts |
| 6 | `monsters.js` | 16 silhouettes × 2–3 variants across 4 tiers, each with an AI archetype and a `look` (weapon, helm, armour, glow, legs/wings); 6 uniques including the 4 tier bosses | ≈40 + 6 |
| 7 | `objects.js` | 12 object types, ≥12 random-altar effects with flavour text | 12 + 12 |
| 8 | `npcs.js`, `quests.js` | 6 NPCs (healer, smith, arcanist, questgiver, gossip, wanderer) with 3–5 lines each; 6 quests covering killBoss, fetch, clearArea, collectN, findNpc + a main line | 6 + 6 |
| 9 | `flavor.js`, `sfx.js` | death lines, tips, intro/outro, `heroNames` for the random-name button, synth descriptors | 8 / 12 / 4+3 / 8 / 22 |

Rules of thumb while writing:
- The class-select screen is the player's first look at the game, so write it in the setting's
  voice. Each card shows the class name in its accent colour, the epithet, a portrait, the
  blurb, the stats, and the first three skills the class is given (start skill, then level gifts)
  with their blurbs. So give every skill a one-line blurb that says what it does, and rename
  the buttons (`start: 'Set Sail'`, `chooseClass: 'Sign the Articles'`). In testing, a run
  without this skill that put that care into its class screen came out looking better than a
  run with the skill that left the defaults.
- The look is theme data too. The engine draws every sprite in code with a lighting pass,
  painted materials, lit decor and an ornate HUD, so a theme mostly picks styles and colours:
  `tileset.art` (stone vs concrete/metal, torches vs neon), actor `look` fields, and palette
  metal and trim. `references/visual-quality.md` lists every knob with its default and the
  recipes behind the look. Read it when the user wants it to look better, or sends a target image.
- Keep every number inside the ranges the default theme uses unless `references/systems/`
  gives you a reason. The default numbers are the genre's proven curve.
- Names are the setting; mechanics are the genre. Rename "mana" to "charge" freely; do not
  change what mana does.
- Each tier's monster levels must overlap the item levels players will have there (tier n
  spans roughly levels 6n−5 … 6n+2). Bosses are 3–6× the HP of their tier's biggest regular.
- Run `node tools/validate_theme.mjs` after each file. It catches dangling ids, missing
  scrolls/tomes, empty tiers, unreachable skills, and skills a class is handed (start or
  level-up) but cannot afford with its mana at that level.
- Rename the resources in `strings.js` (`life`, `mana`, `gold`, `goldItem`, `notEnoughMana`):
  tooltips, affix lines and messages pick the new words up, so no engine edit is needed.

## 4. Extend (only what the user asked for)

Common extensions and where they live:
- **New class** → one entry in `classes.js` + skills in its pool. No engine change.
- **New skill archetype** → `src/entities/missile.js` (`ARCHETYPES` table) + `src/skills/skills.js` dispatch.
- **New AI** → `src/entities/ai.js` archetype function; follow the walk-gate pattern there.
- **New generator** → `src/world/levelgen/<name>.js` returning `{tiles, rooms, doorSpecs}`; register in `index.js`.
- **Permadeath / difficulty** → already built: the title screen has Difficulty (normal / veteran /
  elite, scaling in `data/balance/monsters.js`) and Permadeath toggles; `game.flags.hardcore`
  deletes the save on death and hides "Return to town". Rename them for the setting through
  `strings.js` keys `difficulty_normal`, `difficulty_veteran`, `difficulty_elite`, `hardcore`,
  `permadeathNote`, `respawn`. Only touch code to add a mode the template lacks.
- **Real art** → set `look.sprite` on any descriptor; `render/sprites.js` prefers sprites to procedural shapes.
- **Multiplayer** → not in the template. `references/systems/05-data-save-net-modding.md §D` is the design (deterministic lockstep, command catalog); budget a separate milestone.

For anything bigger, find the system in `references/systems/00-overview.md`, open its chunk
list, and implement the chunks in order. The chunk lists are dependency-sorted for exactly this.

## 5. Verify like a player would

1. `node tools/validate_theme.mjs` — zero errors.
2. `node tools/smoke_test.mjs` — boots the game in headless Chromium, walks every class from
   the hub down the stairs, fights, casts, loots, trades, visits every depth (checks monsters,
   reachable stairs, tier bosses), round-trips a town portal and a save, opens every panel, dies,
   respawns, and checks permadeath. Screenshots go to `tools/out/`. It must pass (`--quick` while
   iterating, the full run before handing over). When a check fails, the message says what the
   player could not do; fix the theme or engine, not the test.
3. **Look at the screenshots** (open the PNGs). Check: town readable, each tileset looks like
   its tier, HUD text legible, inventory items visible, a boss arena exists on the final depth.
   Open `tools/model_sheet.html?theme=<id>&part=actors|monsters|objects|items` and screenshot
   it: every class, monster, object and item on one page, so a broken look shows at a glance.
4. Play it for two minutes yourself through Playwright if you have time: click to move, kill
   something, pick up loot, open the inventory, buy a potion, descend. Fix what feels wrong.
   `window.__game` (documented in `docs/CONTRACTS.md`) gives you `step`, `state`, `teleport`,
   `spawn`, `give`, `clickTile`, `talk` and more; `?class=<id>&seed=<n>` skips the title screen.
5. Grep the whole output for any proper noun from the reference game or from the IP the user
   may have alluded to. Ship zero.

## 6. Hand over

Deliver, in this order:
- the game folder (`index.html`, `src/`, `data/`, `tools/`, `docs/DESIGN.md`, `README.md`),
- the `README.md` the scaffold created, with `{{CLASSES}}` and `{{TIERS}}` replaced by the class
  list and tier list, the controls table adjusted to any renamed panels, and a section on what was
  extended beyond the template,
- three screenshots (town, a mid-tier level with combat, the inventory panel),
- a short changelog of engine changes you made (if any) so the user can upstream them.

Tell the user the game is complete and playable, what you chose where the prompt was silent,
and the two or three things you would add next (more quests, real art, multiplayer).

## Reference index

- `references/theming-guide.md` — IP hygiene, archetype mapping table, procedural art/sound, done-checklist.
- `references/visual-quality.md` — the lighting, material, decor, actor and HUD recipes, every visual theme knob, and how to run a visual upgrade against a target image.
- `references/systems/00-overview.md` — the 70 systems, dependency spine, content budget.
- `references/systems/01-core-engine-rendering.md` — loop, input, RNG, A*, iso renderer, lighting, FOV, automap, audio.
- `references/systems/02-levels-objects-quests.md` — the four generators, themed rooms, objects, altars, quests, NPCs, vendors, portals.
- `references/systems/03-player-items-ui.md` — classes, XP curve, combat formulas, loot pipeline, affix tables, inventory, spells, HUD.
- `references/systems/04-monsters-ai-combat.md` — roster shape, spawning, 25 AI routines, hit resolution, missiles, status effects.
- `references/systems/05-data-save-net-modding.md` — data tables, save format, multiplayer design, modding, test strategy.
- `assets/template/` — the engine. `docs/CONTRACTS.md`, `docs/THEME_SCHEMA.md`, `docs/DEFAULT_THEME_IDS.md` inside it.
- `scripts/new_game.py` — scaffold a new game from the template.

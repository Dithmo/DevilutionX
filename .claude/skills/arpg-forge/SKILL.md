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
| 1 | `meta.js`, `palette.js`, `strings.js` | title, tagline, UI colours, vocabulary (life→"vitals", gold→"credits"…) | — |
| 2 | `tilesets.js`, `world.js` | 4 tilesets (palettes + generator each), 4 tiers with depth ranges, the hub layout and NPC placements | 4 tilesets, 4 tiers, 16 depths |
| 3 | `classes.js` | 3 classes mapped to melee / ranged / caster with setting-native names, stat lines, start kits, skill pools | 3 |
| 4 | `skills.js` | 16 skills across the archetypes (bolt, pierce, nova, chain, wall, groundAoe, heal, buff, blink, summon, homing, multishot, melee, townPortal, identify) | 16 |
| 5 | `items.js` | bases (≥15 weapons, ≥11 armour, ring, amulet), ≥25 prefixes, ≥25 suffixes, ≥8 uniques, consumables incl. a scroll and tome per skill, quest items | see counts |
| 6 | `monsters.js` | 16 silhouettes × 2–3 variants across 4 tiers, each with an AI archetype; 6 uniques including the 4 tier bosses | ≈40 + 6 |
| 7 | `objects.js` | 12 object types, ≥12 random-altar effects with flavour text | 12 + 12 |
| 8 | `npcs.js`, `quests.js` | 6 NPCs (healer, smith, arcanist, questgiver, gossip, wanderer) with 3–5 lines each; 6 quests covering killBoss, fetch, clearArea, collectN, findNpc + a main line | 6 + 6 |
| 9 | `flavor.js`, `sfx.js` | death lines, tips, intro/outro, synth descriptors | 8 / 12 / 4+3 / 22 |

Rules of thumb while writing:
- Keep every number inside the ranges the default theme uses unless `references/systems/`
  gives you a reason. The default numbers are the genre's proven curve.
- Names are the setting; mechanics are the genre. Rename "mana" to "charge" freely; do not
  change what mana does.
- Each tier's monster levels must overlap the item levels players will have there (tier n
  spans roughly levels 6n−5 … 6n+2). Bosses are 3–6× the HP of their tier's biggest regular.
- Run `node tools/validate_theme.mjs` after each file. It catches dangling ids, missing
  scrolls/tomes, empty tiers, and unreachable skills.

## 4. Extend (only what the user asked for)

Common extensions and where they live:
- **New class** → one entry in `classes.js` + skills in its pool. No engine change.
- **New skill archetype** → `src/entities/missile.js` (`ARCHETYPES` table) + `src/skills/skills.js` dispatch.
- **New AI** → `src/entities/ai.js` archetype function; follow the walk-gate pattern there.
- **New generator** → `src/world/levelgen/<name>.js` returning `{tiles, rooms, doorSpecs}`; register in `index.js`.
- **Permadeath / difficulty modes / hardcore** → `game.difficulty` and `data/balance/monsters.js` scaling table.
- **Real art** → set `look.sprite` on any descriptor; `render/sprites.js` prefers sprites to procedural shapes.
- **Multiplayer** → not in the template. `references/systems/05-data-save-net-modding.md §D` is the design (deterministic lockstep, command catalog); budget a separate milestone.

For anything bigger, find the system in `references/systems/00-overview.md`, open its chunk
list, and implement the chunks in order. The chunk lists are dependency-sorted for exactly this.

## 5. Verify like a player would

1. `node tools/validate_theme.mjs` — zero errors.
2. `node tools/smoke_test.mjs` — boots the game headlessly, plays every class into every depth,
   fights, loots, saves and loads, and writes screenshots to `tools/out/`. It must pass.
3. **Look at the screenshots** (open the PNGs). Check: town readable, each tileset looks like
   its tier, HUD text legible, inventory items visible, a boss arena exists on the final depth.
4. Play it for two minutes yourself through Playwright if you have time: click to move, kill
   something, pick up loot, open the inventory, buy a potion, descend. Fix what feels wrong.
5. Grep the whole output for any proper noun from the reference game or from the IP the user
   may have alluded to. Ship zero.

## 6. Hand over

Deliver, in this order:
- the game folder (`index.html`, `src/`, `data/`, `tools/`, `docs/DESIGN.md`, `README.md`),
- a `README.md` with: how to run (`python3 serve.py` then open the URL), controls, the class
  list, the tier list, and what was extended beyond the template,
- three screenshots (town, a mid-tier level with combat, the inventory panel),
- a short changelog of engine changes you made (if any) so the user can upstream them.

Tell the user the game is complete and playable, what you chose where the prompt was silent,
and the two or three things you would add next (more quests, real art, multiplayer).

## Reference index

- `references/theming-guide.md` — IP hygiene, archetype mapping table, procedural art/sound, done-checklist.
- `references/systems/00-overview.md` — the 70 systems, dependency spine, content budget.
- `references/systems/01-core-engine-rendering.md` — loop, input, RNG, A*, iso renderer, lighting, FOV, automap, audio.
- `references/systems/02-levels-objects-quests.md` — the four generators, themed rooms, objects, altars, quests, NPCs, vendors, portals.
- `references/systems/03-player-items-ui.md` — classes, XP curve, combat formulas, loot pipeline, affix tables, inventory, spells, HUD.
- `references/systems/04-monsters-ai-combat.md` — roster shape, spawning, 25 AI routines, hit resolution, missiles, status effects.
- `references/systems/05-data-save-net-modding.md` — data tables, save format, multiplayer design, modding, test strategy.
- `assets/template/` — the engine. `docs/CONTRACTS.md`, `docs/THEME_SCHEMA.md`, `docs/DEFAULT_THEME_IDS.md` inside it.
- `scripts/new_game.py` — scaffold a new game from the template.

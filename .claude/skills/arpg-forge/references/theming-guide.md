# Theming guide: turning the genre skeleton into a specific setting

The engine template is deliberately setting-free. Every noun the player sees comes from
`data/theme.js`. Your job when the user says "make one set in X" is to re-skin the *archetypes*
below without breaking the *mechanics* behind them. Mechanics are what make the game feel like the
genre; the skin is what makes it feel like the user's world.

## 1. IP hygiene (do this before anything else)

The reference engine this skill was derived from is a reimplementation of a famous 1990s game.
Nothing in the skill carries that game's names, text, art, or maps, and nothing you generate
should either. Concretely:

- Invent every proper noun: title, town, NPCs, bosses, uniques, quests, item names, place names.
- Do not reuse recognisable catch-phrases, lore terms, or the original's class names as a set.
  A "warrior / rogue / sorcerer" trio is a genre convention, but prefer setting-native names.
- Do not reproduce specific level layouts, dialogue, or item/affix *names* from any shipped game.
  Mechanics (an affix that adds +X% damage, a bolt skill) are fair game; the names are not.
- When the user asks for a setting that is itself someone else's IP ("set in the Star Wars
  universe"), build an original setting *inspired by the genre of that IP* and say so in one line.

## 2. The archetype table

Fill one row per archetype for the requested setting *before* writing any data file. Having this
table makes every later naming decision fast and consistent.

| Genre archetype | What it does mechanically | Example: cyberpunk | Example: pirate age | Example: post-apoc |
|---|---|---|---|---|
| Hub town | Safe level, NPC services, stairs down | Neon night-market block | Free-port harbour town | Walled survivor compound |
| Dungeon tiers (4) | 4 tilesets, 4 depths each, escalating level | Sewers → Arcology → Server farm → Black-site | Caves → Shipwreck → Fort → Temple | Ruins → Metro → Bunker → Reactor |
| Life / Mana | Two drainable globes | Vitals / Charge | Blood / Grog-grit | Health / Rads-shielding |
| Gold | Stackable currency, vendor economy | Credits / chips | Doubloons | Bottlecaps-style scrip |
| Potions (belt) | Instant restore, belt slots 1–8 | Stim injectors | Rum, tonics | Med-packs |
| Scrolls | One-shot skill cast | Burner chips | Charms, maps | Field manuals |
| Tomes | Teach / level a skill | Skill-ware installer | Grimoire pages | Pre-war schematics |
| Melee class | High str/vit, weapon mastery | Street samurai | Boarding marine | Wasteland brawler |
| Ranged class | High dex, multi-shot | Drone-rigger / gunslinger | Musketeer | Scavenger sniper |
| Caster class | High mag, skill damage | Netrunner (programs) | Sea-witch | Mutant psionic |
| Skills / spells | Bolt, nova, chain, wall, heal, blink, summon… | Programs, implants, drones | Hexes, cannon tricks | Psi, gadgets, chems |
| Elements | fire / cold / shock / arcane resist axes | Thermal / Cryo / EMP / Viral | Fire / Water / Lightning / Curse | Fire / Cold / Rad / Shock |
| Undead flag | Immune to certain effects, resurrects | Zombified cyborgs / rogue drones | Drowned crew | Ghouls |
| Random-effect altar | Touch for a random boon/curse | Black-market terminal | Shrine of a drowned saint | Vending shrine |
| Chests / breakables | Loot containers | Lockboxes / crates | Sea-chests / barrels | Footlockers / cans |
| Boss per tier | Gates progression, unique drop | Gang lord, rogue AI, … | Captain, kraken-spawn | Warlord, mutant alpha |
| Town portal | Return-to-hub skill | Extraction beacon | Signal flare | Flare / radio |
| Quests (5 patterns) | kill-boss, fetch, clear-area, collect-N, find-NPC | Data heist, extraction | Buried treasure, mutiny | Water chip, missing patrol |

Keep the *axes* (4 elements, 4 stats, 2 resource globes, 4 tiers) unless the user asks to change
them. Changing an axis means auditing every formula that references it.

## 3. Tone and text

- Write the hub NPC greetings, quest text, death lines, and loading tips in the setting's voice.
  Aim for 3–5 greeting lines per NPC, 3 lines per quest stage, 8–12 tips, 6–10 death lines.
- Item names: base nouns from the setting ("machete", "sabre", "monoblade"), affix prefixes
  and suffixes as evocative adjectives / "of X" phrases. Generate ~30 prefixes and ~30 suffixes.
- Monster names: 3–5 per tier, each with 2–3 colour variants at escalating levels (a 1990s ARPG
  trick that triples the roster cheaply). Variants share the AI archetype and silhouette.

## 4. Procedural art

Everything is drawn from descriptors so a theme never needs image files:

- Tiles: each tileset gives 3–4 floor colours, 2–3 wall colours, one accent, one light tint.
  The renderer draws diamonds with subtle noise and wall prisms; different palettes read as
  different places surprisingly well.
- Actors: `look: { silhouette, bodyColor, trimColor, size }`. Silhouettes: `bulky`, `lean`,
  `robed`, `crawler`, `flier`, `blob`, `turret`, `tall`. Bosses get `size: 1.5` and an outline.
- Items: `look: { glyph, color }` where glyph is one of ~20 primitive icon kinds (blade, gun,
  staff, helm, chest, ring, flask, scroll, book, gem, key…).
- Palette the UI once: `palette.ui`, `palette.accent`, globes in `palette.hp` / `palette.mp`.

If the user supplies real art later, each descriptor can be replaced with a sprite reference; the
renderer checks `look.sprite` first.

## 5. Sound

`theme.sfx` entries are synth descriptors (`{ type: 'noise'|'square'|'saw'|'sine', freq, slide,
dur, decay }`). Define at least: hit, miss, swing, cast, pickup, drop, levelup, open, die,
monsterHit, monsterDie, potion, gold, stairs, error. Settings differ mostly in timbre: cyberpunk
leans on square/saw with pitch slides, fantasy on sine/noise with longer decays.

## 6. Checklist before you call a theme done

- [ ] Every id referenced anywhere exists (`tools/validate_theme.mjs` passes).
- [ ] Each tier has ≥3 monster types spanning its level range, one boss, one tileset.
- [ ] Each class has a starting kit, ≥4 class-appropriate skills reachable by level 10, and a
      distinct silhouette/colour.
- [ ] ≥25 item bases across all slots, ≥50 affixes, ≥8 uniques, ≥6 consumables.
- [ ] 5 quests covering the 5 patterns, each with giver, target, reward, 3 text stages.
- [ ] Hub has ≥5 NPCs: healer, smith (weapons/armour vendor + repair), arcanist (skills /
      consumables vendor + identify), questgiver, gossip. Names and roles re-skinned.
- [ ] No proper noun from any existing game appears (grep the theme for a list the user cares about).

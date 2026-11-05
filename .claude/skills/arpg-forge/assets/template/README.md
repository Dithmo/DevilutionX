# {{TITLE}}

{{TAGLINE}}

An isometric action-RPG that runs in any modern browser. No build step, no dependencies.

## Run it

```bash
python3 serve.py
```

Then open the URL it prints (default http://localhost:8000). Any static file server works; the
game only needs to be served over HTTP because it uses ES modules.

Quick start without the title screen: `http://localhost:8000/?class=<classId>&seed=42`.

## Controls

| Input | Action |
|---|---|
| Left click | Move · attack a monster · talk to a character · use an object · pick up an item |
| Hold left button | Keep walking / keep attacking |
| Right click | Use the selected skill at the cursor |
| F1–F4 | Select a skill (hover a skill in the skill panel and press a key to bind it) |
| 1–8 | Use the belt slot |
| I / C / S / Q | Inventory · character · skills · quests |
| Tab | Map |
| Space | Close panels |
| Esc | Close panels / open the game menu (save, load, mute, quit) |

On the title screen, click **Difficulty** to cycle normal → veteran → elite, and **Permadeath**
to make death final (the save is deleted and the hero cannot return).

## Classes

{{CLASSES}}

## The descent

{{TIERS}}

## For developers

- `data/themes/<theme>/` holds all content (classes, skills, items, monsters, quests, NPCs,
  palettes, sounds). `docs/THEME_SCHEMA.md` describes every field.
- `data/balance/` holds the numbers (combat, loot, XP curve, difficulty scaling).
- `docs/CONTRACTS.md` is the engine contract: game state, per-tick order, hooks, debug API.
- Tests:
  ```bash
  node tools/validate_theme.mjs
  node tools/smoke_test.mjs
  ```
  The smoke test plays every class through every depth in headless Chromium (needs the
  `playwright` package) and writes screenshots to `tools/out/`. `--quick` runs a shorter pass.
- `window.__game` in the browser console is a debug API (`teleport(depth)`, `give('gold', 500)`,
  `setGodMode(true)`, …).

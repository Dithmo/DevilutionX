#!/usr/bin/env python3
"""Scaffold a new ARPG from the arpg-forge engine template.

Usage:
    python3 new_game.py <target-dir> --theme <theme_id> --title "<Game Title>" [--tagline "..."] [--force]

What it does:
  1. Copies assets/template/ into <target-dir> (index.html, src/, data/, tools/, docs/).
  2. Creates data/themes/<theme_id>/ as a copy of the default theme with meta.js rewritten.
  3. Points data/active_theme.js at the new theme.
  4. Writes a README.md stub and prints the theme files to edit, in dependency order.

The default theme stays in place as a reference; delete it before shipping if you like.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_ROOT / "assets" / "template"

THEME_FILE_ORDER = [
    ("meta.js", "title, tagline, version"),
    ("palette.js", "UI colours, rarity colours, globe colours"),
    ("strings.js", "vocabulary overrides: life, mana, gold, potion, town, ..."),
    ("tilesets.js", "4 tilesets: generator + floor/wall palettes"),
    ("world.js", "4 tiers (depth ranges, monster levels, boss, pools) + hub town layout"),
    ("classes.js", "3 classes: stat lines, start kit, skill pool, look"),
    ("skills.js", "16 skills across the archetypes"),
    ("items.js", "bases, prefixes, suffixes, uniques, consumables, quest items"),
    ("monsters.js", "roster per tier with AI archetypes + 6 uniques"),
    ("objects.js", "12 object types + random-altar effects"),
    ("npcs.js", "6 hub NPCs with dialogue, vendor types, services"),
    ("quests.js", "6 quests: killBoss, fetch, clearArea, collectN, findNpc, main line"),
    ("flavor.js", "death lines, tips, intro/outro, level names"),
    ("sfx.js", "synth descriptors for the 22 sound names"),
]


def slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    if not s or not s[0].isalpha():
        s = "t_" + s
    return s


def js_string(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", help="directory to create (must not exist unless --force)")
    ap.add_argument("--theme", required=True, help="theme id, e.g. neon_dusk")
    ap.add_argument("--title", required=True, help="game title shown on the main menu")
    ap.add_argument("--tagline", default="", help="one-line tagline under the title")
    ap.add_argument("--force", action="store_true", help="overwrite an existing target directory")
    args = ap.parse_args()

    if not TEMPLATE.is_dir():
        print(f"error: template not found at {TEMPLATE}", file=sys.stderr)
        return 2

    target = Path(args.target).resolve()
    theme_id = slug(args.theme)
    if target.exists():
        if not args.force:
            print(f"error: {target} exists (use --force to overwrite)", file=sys.stderr)
            return 2
        shutil.rmtree(target)

    def ignore(_dir, names):
        return {n for n in names if n in {"out", "__pycache__", ".DS_Store"} or n.endswith(".png")}

    shutil.copytree(TEMPLATE, target, ignore=ignore)

    themes_dir = target / "data" / "themes"
    default_dir = themes_dir / "default"
    theme_dir = themes_dir / theme_id
    if theme_dir.exists():
        shutil.rmtree(theme_dir)
    shutil.copytree(default_dir, theme_dir)

    meta = theme_dir / "meta.js"
    meta.write_text(
        "// Theme metadata. Edit freely; `id` must match the directory name.\n"
        "export default {\n"
        f"  id: {js_string(theme_id)},\n"
        f"  title: {js_string(args.title)},\n"
        f"  tagline: {js_string(args.tagline or 'An original action-RPG.')},\n"
        "  version: '0.1.0',\n"
        "};\n"
    )

    (target / "data" / "active_theme.js").write_text(
        "// Which theme directory under data/themes/ the engine loads.\n"
        f"export default {js_string(theme_id)};\n"
    )

    readme = target / "README.md"
    readme.write_text(
        f"# {args.title}\n\n"
        f"{args.tagline}\n\n"
        "## Run\n\n"
        "```bash\n"
        "python3 serve.py 8000\n"
        "```\n\n"
        "Then open http://localhost:8000 in a browser.\n\n"
        "## Controls\n\n"
        "- Left click: move / attack / pick up / talk / use\n"
        "- Right click: cast the selected skill\n"
        "- 1–8: belt slots · F1–F4: skill hotkeys · I inventory · C character · S skills · Q quests · Tab map · Esc menu\n\n"
        "## Verify\n\n"
        "```bash\n"
        "node tools/validate_theme.mjs\n"
        "node tools/smoke_test.mjs\n"
        "```\n\n"
        "## Credits\n\n"
        "Built with the arpg-forge engine template (original code and content; no third-party game assets).\n"
    )

    print(f"Created {target}")
    print(f"Theme: data/themes/{theme_id}/  (active)")
    print("\nEdit these files in order (ids in later files reference earlier ones):")
    for name, what in THEME_FILE_ORDER:
        print(f"  data/themes/{theme_id}/{name:<14} {what}")
    print("\nThen run:")
    print(f"  cd {target} && node tools/validate_theme.mjs && node tools/smoke_test.mjs")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Visual quality: from "flat procedural" to "painted dark ARPG"

Use this guide when the user wants the game to look better ("make it look like a real
game", or they send a reference image or paintover). Everything is still drawn in code, so it
works for any setting. The only image files are nine small CC0 material maps the 3D actors
are tinted from. The engine template already ships the pipeline
below, so most of the work is choosing theme colours and knobs that suit the setting.

It came from a real iteration. Neon Undertow, built with this skill, was rated 1/10 by its
user against an AI paintover (10/10) of the same scene. The gap was not resolution or polygon
count. It was missing **light**, **material** and **atmosphere**. In order of impact:

| # | Technique | Why it matters |
|---|---|---|
| 1 | Screen-space lighting pass (dark ambient, warm pools, additive glows) | Biggest single jump: flat → moody |
| 2 | Material textures on floors/walls (slabs, bevels, grout, cracks, brick courses, AO) | Reads as stone/metal instead of coloured diamonds |
| 3 | Level dressing (torches, banners, rubble, chains) that also emits light | Gives the light a source and the space a story |
| 4 | Detailed actors: 3D PBR models baked to sprites by default (§5b), with the shaded 2D puppet as the fallback (§5) | Heroes and monsters read at a glance |
| 5 | Ornate HUD (metal frame, glass globes with swirling liquid, recessed slots) | Frames the screen like a finished product |
| 6 | Atmosphere (fog, embers, ash motes, vignette) | Depth and motion even when nothing moves |
| 7 | 2× backing store | Everything above stays sharp when the page scales up |

## 1. Render at 2× (src/render/draw_util.js, src/main.js, src/core/input.js)

- The logical canvas stays 960×540 (all game, UI and hit-test maths unchanged). `canvas.width`
  is `960 * RENDER_SCALE` (2, or 3 on high-DPI), and the main context gets
  `setTransform(S,0,0,S,0,0)` every frame.
- `cached()` rasterises every sprite at `S×` from the same logical drawing code, and `blit()`
  draws it at its logical size. Detail drawn at 0.5px now survives.
- Input converts client coordinates using `canvas.logicalW` and `canvas.logicalH`, not
  `canvas.width`.
- Remove `image-rendering: pixelated` from the page. With a hi-res backing store, smooth
  scaling looks better, and fractional page scales become fine.

## 2. Lighting pass (src/render/lighting.js)

Every sprite is drawn at **full brightness**, and lighting is applied once to the whole frame:

1. **Light map at 1/4 resolution.** Paint each visible tile's diamond with its FOV light
   (`level.light`, which already respects walls): `pow(l/15, 0.85)`, tinted by the tileset's
   `lightTint`. Explored-but-unseen tiles get a "memory" value of 0.13, and unexplored tiles
   stay black. Wall tiles paint their whole raised face so walls are lit like the floor in
   front of them.
2. **Coloured point lights**, added with `'lighter'`: `addLight(sx, sy, radius, color,
   intensity)`. Sources are the player (a warm 170px light at intensity 0.45), objects with
   `light > 0` (radius `40 + 30·light`, the colour of `look.color2`, flickering if it is
   fire), missiles (90px), and wall torches from the decor pass.
3. **Blur** the map (`ctx.filter = 'blur(2.2px)'` at map resolution, about 9 logical px) so
   the light falls off softly instead of in tile steps.
4. **Multiply** the map over the frame.
5. **Glows**, drawn additively after the multiply: `addGlow(sx, sy, radius, color, alpha)`
   for flames, neon, magic, portals and rare loot on the ground. These are the only pixels
   allowed to be brighter than the unlit sprite, which is what makes light read as light.

Town is "night with street lamps": the ambient is multiplied by `palette.ambientLevel`
(default 0.42) and the lamps lift it, so the town is never flat and fully lit.

Rules that matter:
- Author textures as lit colours with strong value contrast. The multiply pass only darkens,
  so a mid-grey texture under mid light turns to mud.
- Never put the light level in a sprite cache key: shading per light level is gone, and the
  cache stays small.
- Flicker is `flicker(seed, t, amount)` (two sines). Use 0.2 for fire, 0.06 for electric light.

## 3. Atmosphere (src/render/atmosphere.js)

These layers are drawn after lighting and before the UI. They use wall-clock time only and
never touch the simulation.
- **Fog**: a 256px noise texture baked once from about 70 wrapped soft blobs. It is drawn
  twice at different scales and drift speeds with `'screen'`, offset by the camera so it sits
  in the world. Knobs: `palette.fogColor`, `palette.fogAlpha` (default 0.55; the texture
  itself is faint).
- **Embers**: `addEmitter(sx, sy, color, rate, spread)`. Particles rise, sway, and fade
  in/out with `sin(life/max·π)`, drawn with `'lighter'` and capped at 260.
- **Ash motes**: 40 slow specks drifting across the view with a slight parallax.
- **Vignette**: a baked radial gradient (clear centre, 0.78 black in the corners) that pulls
  the eye to the hero.

## 4. Environment (src/render/draw_tiles.js, src/render/draw_decor.js)

The engine code holds no colours or setting nouns. Everything comes from `tileset.art`
(dungeons) or `town.art` (town), every knob has a default, and with no knobs at all you get
stone and torches. The same code draws grimy concrete, plate and grate floors with metal panel
walls and neon tubes when the theme asks for them.

**Two drawing spaces make the work 2D:**
- **Tile space.** (a,b) ∈ [-0.5,0.5]² maps to the screen as `((a-b)*32, (a+b)*16)`. All floor
  geometry (slabs, cracks, decals) is drawn in (a,b), so it stays correct in iso.
- **Face space.** `faceTransform(c, face)` puts the context on a flat 32×WALL_H rectangle:
  - left face: `transform(1,0.5,0,-1,-32,0)`;
  - right face: `transform(1,-0.5,0,-1,0,16)`.

  Bricks, panels, niches, torches and banners are then ordinary 2D drawing.

**The bevel is the key technique.** `bevel(c, pts, w, hi, lo)` strokes each polygon edge in a
highlight or a shadow, chosen by the sign of `dot(outwardNormal, LIGHT_DIR)`, with the light
from the top left. The stroke is 2× wide inside a clip, so only the inner half shows. Use it
for slabs, bricks, panels, rubble and wall caps. This one function gives the chiselled look.
Faces are shaded by side: top ×1.0, left ×0.80, right ×0.56.

**Floors**
- Fill the tile with grout first: floor × `groutDark` (0.22).
- Split the tile into a jittered n×n grid of slabs. Merge some neighbours into big slabs,
  inset each one and chip its corners.
- Give each slab its own tone, a bevel and soft grime blotches. Draw blotches as radial
  gradients under `scale(1,0.6)`; clipped ellipses give hard edges.
- A slab gets a crack with chance `cracks`. A crack is a random walk with branches: a dark
  stroke with a 1px lit lip.

**Walls**
- Walls are **64 tall** (up from 48). Height is what makes them read as architecture.
- Brick courses are offset by half a brick, with `BRICK_L` 16 on a 32-long face. A brick that
  crosses the tile seam takes its tone from the course hash only, so the halves match.
- The wall top gets a rim band on exposed edges only, chosen from the 4-neighbour wall mask.
  Long runs then read as one continuous coping, not a grid of boxes.
- Shading at the base:
  - each face gets a dark gradient over its bottom 24px;
  - floor tiles at the foot of a wall get a cached shadow wedge.
- Face features (niche, pilaster, runes, damaged, vent, screen) are picked per face by hash.
  Pilasters repeat on every Nth face so the rhythm is regular.
- A door in a straight run gets a lintel from 48 to 64 above the door sprite.

**Decor** (`getDecor(level)`, built once per level and kept in a WeakMap)
- Placement uses `hash2(x,y,seed)` only, never the game RNG, so it is purely visual.
- Keep-out zones: radius 2 around stairs; radius 1 around doors, objects, NPCs and spawn
  points.
- **Lamps** (torch or neon) go on front-facing plain faces at least `lamp.spacing` tiles apart.
  Each one registers:
  - `addLight`;
  - two glows;
  - a floor pool;
  - embers (torches only).

  At most 14 lights are registered per screen, only on explored tiles. **This is what puts
  warm pools of light in the room.**
- Also placed: wall mounts (banners with swallowtail cloth and tatters, chains, cables, signs),
  rubble at wall bases (forced in front of damaged faces), free-standing poles, and floor
  decals from the tileset's `decor` list (puddle, grate, bones, debris).

**Theme knobs** (all optional)

| Knob | Values or default |
|---|---|
| `floorStyle` / `floorStyles` | flagstone, cobble, concrete, plate, grate, water |
| `wallStyle` / `wallStyles` | masonry, rough, panel |
| `groutDark` | 0.22 |
| `cracks` | 0.16 |
| `grime` | 0.6 |
| `stain` | none |
| `rust` | brown |
| `hazard` | yellow |
| `metal` | grey |
| `runeColor` / `runes` | accent / 0.22 |
| `pilasterEvery` | 4 |
| `features` | per-style weights for niche, runes, damaged, vent, screen |
| `lamp` | `{kind:'torch'\|'neon', color, colors, chance:.3, spacing:4, radius:135, intensity:1}` |
| `wallDecor` | `['banner','chain']` (others: cable, sign) |
| `wallDecorChance` | 0.14 |
| `banner` | `[door, accent]` |
| `bone` / `wood` | bone / wood colours |
| `rubble` / `stones` / `poles` / `decalChance` | 0.12 / 0.035 / 0.02 / 0.03 |

**Known issue:** taller walls hide more objects behind them. Fade walls that cover chests and
items near the player, not just the player.

## 5. Actors, objects, items (src/render/draw_actor.js, draw_volume.js, draw_objects.js, draw_items.js)

Every colour and noun comes from `look` in theme data. The code supplies neutral defaults.

**Five techniques that make procedural shapes read as painted art:**
1. **Volumes, not flat fills.** Every part is a shaded primitive lit from one key light at the
   upper left, whatever way the sprite faces:
   - tapered capsules for limbs and hafts;
   - elliptic frustums for torsos, robes and barrels;
   - spheres for heads and pauldrons;
   - iso blocks for crates and altars.
2. **Ink and rim** (`inked(c, paint)`). Paint the sprite into a scratch layer. Add a rim light
   on the lit edge: the silhouette minus itself, shifted away from the light. Then stamp the
   silhouette in dark ink at 8 offsets behind it. **This single pass is most of the look.**
3. **Contact shadow.** A soft radial ellipse under every sprite.
4. **Restrained highlights.** `hiFor(color)` scales highlights down for bright colours so
   whites don't blow out. Shade by mixing toward black or white so the hue stays.
5. **Glow is separate from paint.** Emissive parts (visors, neon trim, flames, orbs) call
   `addGlow` so they survive the lighting multiply. Actors register glows only when the caller
   passes `opts.light`; the UI never does, so menus don't double-light.

**Projected puppet.** One description of a humanoid serves all 8 directions:
- Actor space is (s = right, f = forward, z = up). `makeView(dir)` builds the facing axes, and
  `proj()` maps a point to screen with the ground squashed 2:1, plus a depth value.
- Poses are targets: feet, hands, torso tilt and twist, and lunge. Two-bone IK places knees
  and elbows.
- Each stance comes from the weapon class (blade, heavy, pole, rifle, pistol, bow, claws), with
  keyframe tables for attacks.
- Parts are pushed to a list with their projected depth, sorted and painted back to front.
- `decal()` maps 2D detail onto a body surface: visor slits, seams, tabards, emblems.
- Humanoids are about 1.5× the old height (about 64px to the crown). Height plus
  silhouette props (pauldrons, helm, cloak, weapon) are what make classes recognisable.
- Special bodies have their own rigs: a crawler with 4, 6 or 8 legs, a flier with membrane or
  rotor wings, a translucent blob, a turret.

**Actor look fields** (all optional; defaults come from the silhouette):

| Field | Values |
|---|---|
| `weapon` | sword, katana, greatsword, dagger, axe, hammer, mace, spear, staff, wand, pistol, rifle, bow, claws, none. Item glyph names are accepted too. |
| `offhand` | shield, buckler, orb, pistol, dagger, none |
| `helm` | full, visor, open, hood, horned, crest, bare |
| `armor` | plate, light, cloth, none |
| `cloak` | none, short, long, tattered |
| `glow` | `true` (uses trimColor) or a colour |
| `cloakColor`, `metalColor`, `skinColor`, `accentColor`, `underColor` | colours |
| `legs` | 4, 6 or 8 (crawler) |
| `wings` | membrane, rotor (flier) |

**Objects** (`drawObject(..., time)`):
- Shapes, chosen by `look.shape`: box, slab, barrel, crate, rack, altar, brazier, lamp, post,
  banner, lever, plate, basin, well, stand, stairs, portal.
- `color` is the body and `color2` the accent (bands, runes, flame, cloth).
- Animated parts are cached per frame with bounded counts: brazier flames 8 frames, portal
  swirl 16 frames.
- Door leaves are `DOOR_H` (48) tall; the wall drawer adds the lintel above them.

**Items and missiles:**
- Item glyphs use the same volume, ink and rim pipeline and read at 20, 24 and 48px.
- A bright, saturated `color2` counts as emissive and gets a halo.
- Missiles are cached per (shape, colour, size, direction, phase), with shapes for bolts, orbs,
  shards, a flat ground ring, arrows and fireballs.

**Model sheet.** `tools/model_sheet.html?theme=<id>&part=actors|monsters|specials|objects|items`
renders every class, NPC, monster, object state, glyph and missile on one page (`specials`
shows the crawler, flier, blob and turret variants). Screenshot it after any look change; that
is the fastest way to catch a broken silhouette. Add `&actors=2d` to see the puppet.

## 5b. 3D actors, the default (src/render/actor3d/)

Actors are built in code as real 3D models with PBR materials, rendered with three.js and
baked to sprites, so the game still draws plain 2D images. The 2D puppet above stays. It is
the **pose source**: the 3D rig reads the same skeleton (`humanoidSkeleton()` in
draw_actor.js), so both renderers animate identically. It is also the **fallback**.

**Files**

| File | Role |
|---|---|
| `src/vendor/three.module.min.js` | three.js r160, vendored (MIT, `THREE_LICENSE`). Loaded only by dynamic import. |
| `actor3d/index.js` | Front-end. Decides per draw: cached sprite, bake now, nearest baked pose, or puppet. Holds the sprite LRU and the idle warm-up queue. Imports no three.js. |
| `actor3d/baker.js` | One WebGL renderer, an orthographic camera at the game's 30° iso pitch, key/rim/fill lights with a shadow map, and the finishing pass (downsample, contact shadow, ink, hit flash, projected glow anchors). |
| `actor3d/humanoid.js` | Humanoid rig built from `look`: body, armour (plate, light, cloth), helms, cloaks, all weapons and offhands. Swing trails, muzzle flash and the cast orb render in an FX pass that is not inked. |
| `actor3d/creature.js` | Crawler (4, 6 or 8 legs), flier (membrane or rotor), blob and turret. |
| `actor3d/parts.js` | Geometry helpers: lathe, capsules, box UVs, tapered limbs. |
| `actor3d/materials.js` | PBR materials tinted from look colours: plate, steel, gold, leather, cloth, skin, chitin, slime, paint and glow. Also sphere AO and the dungeon environment map. |
| `actor3d/tex/*.jpg` | 512px detail, roughness and normal maps for metal, leather and fabric (ambientCG, CC0; see `CREDITS.txt`). Rebuild with `scripts/prep_textures.py`. |

**How a frame is drawn**
1. `drawActor` in `render/sprites.js` calls `drawActor3d` and falls back to the puppet if
   that returns false.
2. The sprite key is (look, dir, anim, pose, scale, size, RENDER_SCALE). A hit blits the
   cached canvas.
3. On a miss, it bakes inside the frame budget. Death frames and sync mode always bake.
4. Over budget, it draws the nearest pose already baked for that look and direction, then that
   look's stand pose. Only after those does it draw the puppet. A look with nothing baked yet
   may spend up to `hardBudgetMs` to avoid a 2D pop.
5. The first time a look appears it is queued for idle-time warm-up: stand in all 8
   directions, then walk, attack, hit, death and cast, starting with the direction it faces.
   Boot bakes the class looks (stand × 8) behind the loading bar. `warmActors3d(looks)`
   queues more, for example a level's monster types on entry.

**Knobs**

| Knob | Default | Effect |
|---|---|---|
| `ACTORS3D.frameBudgetMs` | 8 | bake time allowed per rendered frame |
| `ACTORS3D.hardBudgetMs` | 40 | ceiling for a look with nothing baked yet |
| `ACTORS3D.idleSliceMs` | 10 | warm-up work per idle callback |
| `ACTORS3D.cacheMB` | 256 | sprite memory cap (LRU); warm-up stops at 70% so it never evicts sprites in use |
| `ACTORS3D.preloadTimeoutMs` | 6000 | if loading takes longer, the game stays 2D |
| `QUALITY.ss` | 1.5 | supersampling on top of RENDER_SCALE (MSAA is on as well) |
| `QUALITY.shadowMap` | 1536 | key light shadow resolution |
| `QUALITY.exposure` | 1.05 | ACES tone-mapping exposure |
| `QUALITY.ink` | 0.62 | outline radius, logical px |
| `QUALITY.rigCache` | 24 | built rigs kept (LRU, disposed on evict) |

**Switches**
- Everything 2D: `?actors=2d` in the URL, or `meta.actors: '2d'` in the theme.
- One look 2D: `look.render: '2d'`. Use it for a deliberately flat or retro creature.

**Failure handling.** No WebGL2, a missing file, a timeout or an exception in a bake all set
the state to `failed` and log one warning. From then on the puppet draws everything, and
nothing else changes. `window.__game.actors()` reports the state, failure, sprite count, MB,
queue length, hits, bakes, fallbacks and puppet draws. `actorsSync(true)` bakes every request
synchronously, which screenshots and the model sheet need.

**Performance**, measured with headless software GL (SwiftShader), the worst case:
- boot about 2.4 s for three classes;
- the first bakes are about 55 ms (shader compile), settling to about 14 ms per sprite;
- about 0.18 MB per sprite at RENDER_SCALE 2;
- no puppet fallbacks in live play.

A real GPU is several times faster. If a target machine stutters, lower `frameBudgetMs` or
`QUALITY.ss` before anything else.

**Adding a look feature**
1. Add the 2D part in draw_actor.js. The puppet is the contract and the fallback.
2. Add the 3D part in humanoid.js or creature.js. Read pose data from the skeleton; don't
   invent new timing.
3. Check both: `model_sheet.html?part=actors` and `...&actors=2d`, side by side.

New special bodies follow `buildCreature`: return `{root, pose(sk, anim, f, prev, yaw), glows,
occ, shadowR}`. Tag effect meshes with `userData.fx = true` so they skip the ink.

**Testing headless.** Launch Chromium with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
`tools/smoke_test.mjs` does this and checks that 3D actors are active. Run it with `--2d` to
check the fallback.

## 6. HUD (src/render/ui/chrome.js, hud_frame.js)

The same code gives dark iron with gold trim (default theme) and gunmetal with neon tubes
(neon theme). Every palette key is optional and is derived from `panel` and `panelBorder` when
it is missing:

| Key | Purpose |
|---|---|
| `metal`, `metalLight`, `metalDark`, `metalEdge` | Frame metal and its shades |
| `trim` | Inlays, filigree and active rims |
| `trimGlow` | `0` = metallic trim; `>0` = glowing neon tube |
| `recess` | Slot wells and grooves |
| `lifeColor` / `manaColor` | Globe liquid |
| `ornament` | `'organic'` = curved horns; `'angular'` = faceted blades and circuit-trace filigree |

**Metal recipe**, applied to any outline built by an *adder* function (one that appends a path
without calling `beginPath`, so it can be filled, clipped and stroked):
1. Drop shadow: shadowBlur 5, offset y 2, black at 0.75.
2. Vertical key-light gradient: lighter → base → base × 0.42.
3. Clipped grain: hashed specks and faint brushed strokes.
4. One faint diagonal sheen band.
5. Inner bevel by the evenodd trick: clip to the shape, then fill a big rect plus the shape
   with `evenodd` and an offset shadow. A light colour offset down gives a lit top edge; black
   offset up gives a shaded bottom edge.
6. 1px dark outline.

**Related recipes:**
- **Recess** (slots, grooves): dark gradient, a deep inner shadow from the top left, and a 1px
  light lip at the bottom. This makes slots look cut into the metal.
- **Engrave**: a black stroke, then the same path 0.8px lower in white at 0.14.
- **Neon trim**: a stroke with `shadowBlur` in the trim colour, drawn twice, plus a white-hot
  core.

**Glass globes.** Four sprites are cached per colour:
- back: dark glass;
- liquid: a radial gradient with an off-centre core;
- two **swirl** layers: spiral arms stroked in segments whose width swells with `sin(πu)`,
  then blurred;
- glass overlay: edge vignette, caustic arc, dome reflection, specular spot, fresnel arc and a
  black lip.

Each frame:
- clip under a double-sine liquid surface;
- blit the liquid;
- blit the two swirls **rotated in opposite directions** (cheap, and it churns convincingly);
- draw a few bubbles;
- draw a meniscus line along the wave.

**Ornaments.** `profilePath(pts, organic)` takes one list of `[x,y,sharp]` points. Organic mode
curves through the edge midpoints and gives horns; angular mode gives blades. The globe socket
is built for the life side and mirrored with `scale(-1,1)`. The stack, back to front:
1. a crescent horn;
2. three talons;
3. a riveted ring;
4. a jewel.

**Silhouette.** The bar body is only 66px tall. Tabs, the level medallion, horns and claws rise
above it to about y=390, and the world shows through between them.

**Caching.** HUD sprites use their own cache (`chromeSprite`), so world-sprite churn never
rebuilds them. One full-width sprite holds every static part of the HUD. The medallion is
separate because it sits over the XP fill.

**Gotchas**
- `shadowBlur`, `shadowOffset*` and `filter: blur()` ignore the canvas transform. Multiply them
  by `RENDER_SCALE` when drawing at 2×.
- Text over trim needs a dark backing pill.
- Keep the zone name in a screen corner, clear of the ornaments.

## 7. How to run a visual upgrade

What worked for Neon Undertow:
1. **Name the gap first.** Compare the screenshot with the target image and list what is
   missing: light, material, atmosphere, detail, framing. It is never resolution alone.
2. **Foundation before art.** Do the 2× backing store, the lighting pass and atmosphere first,
   because every later layer depends on them.
3. **Then split by layer.** Environment, actors and HUD own disjoint files, so they can be
   built in parallel and merged with plain patches. Agree the shared constants up front
   (`WALL_H`, `DOOR_H`), and only one owner may change each.
4. **Theme-only knobs.** Every new visual setting is an optional theme key with a default.
   Check both shipped themes; the engine must stay setting-free.
5. **Verify each layer:**
   - before/after screenshots at the same seed and depths;
   - the model sheet;
   - `smoke_test --quick`;
   - an fps check (the whole upgrade cost under 1 fps headless).
6. **Integration pass.** Check that text on the HUD doesn't collide with ornaments, that class
   cards pass the full `look`, and that taller walls don't hide loot.

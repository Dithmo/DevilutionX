# Visual quality: from "flat procedural" to "painted dark ARPG"

Use this guide when the user wants the game to look better ("make it look like a real
game", or they send a reference image or paintover). Everything is still drawn in code with
no image files, so it works for any setting. The engine template already ships the pipeline
below, so most of the work is choosing theme colours and knobs that suit the setting.

It came from a real iteration. Neon Undertow, built with this skill, was rated 1/10 by its
user against an AI paintover (10/10) of the same scene. The gap was not resolution or polygon
count. It was missing **light**, **material** and **atmosphere**. In order of impact:

| # | Technique | Why it matters |
|---|---|---|
| 1 | Screen-space lighting pass (dark ambient, warm pools, additive glows) | Biggest single jump: flat → moody |
| 2 | Material textures on floors/walls (slabs, bevels, grout, cracks, brick courses, AO) | Reads as stone/metal instead of coloured diamonds |
| 3 | Level dressing (torches, banners, rubble, chains) that also emits light | Gives the light a source and the space a story |
| 4 | Detailed actors (shaded volumes, armour pieces, weapons, outline + rim light, contact shadow) | Heroes and monsters read at a glance |
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

## 4–6. Environment, actors, HUD

See the sections below. Each records the recipe that produced the upgraded look.

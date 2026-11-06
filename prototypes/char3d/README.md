# Character prototype: 3D baked vs 2D puppet

The Warden class drawn three ways, side by side:

- **Current**: the arpg-forge template's projected 2D puppet (`old/` is a copy of the template's `render/draw_actor.js` and its imports).
- **3D flat (v1)** (`rig3d.js`): a three.js model built in code from the same `look` data, rigged (FK skeleton, two-bone leg IK), animated procedurally (16-frame walk, 14-frame keyframed attack with a swing trail, idle), and rendered with an orthographic 30° camera into 2D sprites. Each frame is baked lazily, then given a contact shadow and the game's ink outline.
- **3D PBR** (`pbr.js`): the same model with physically based materials:
  - grey detail, roughness and normal maps from scanned CC0 sets, tinted by the look's colours and box-projected onto parts without UVs;
  - hammered dents added to the metal normals;
  - rolled, polished plate edges;
  - about twenty occluder spheres that follow the skeleton and add contact shadow and grime where parts crowd together (in any pose);
  - a wool cloak with sheen, a dirty hem and a stitched trim band;
  - a dim, torch-lit dungeon room as the reflection environment.

Serve the folder over HTTP and open `index.html`; three.js loads from jsdelivr (`three@0.160.0`).
`shot.cjs` is the Playwright screenshot script used while iterating (`node shot.cjs out.png '{"speed":0,"anim":"attack","t":0.4,"dir":"0"}'`).

## Textures

`tex/` holds 512 px tileable maps made by `tools/prep_textures.py` from [ambientCG](https://ambientcg.com) 1K-JPG sets (CC0): Metal038, Metal054A, Leather037, Fabric031.

```
python3 tools/prep_textures.py <folder with the extracted sets> tex
```

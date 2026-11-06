# Character prototype: 3D baked vs 2D puppet

The Warden class drawn two ways, side by side:

- **Current**: the arpg-forge template's projected 2D puppet (`old/` is a copy of the template's `render/draw_actor.js` and its imports).
- **3D baked** (`rig3d.js`): a three.js model built in code from the same `look` data, rigged (FK skeleton, two-bone leg IK), animated procedurally (16-frame walk, 14-frame keyframed attack with a swing trail, idle), and rendered with an orthographic 30° camera into 2D sprites. Each frame is baked lazily, then given a contact shadow and the game's ink outline.

Serve the folder over HTTP and open `index.html`; three.js loads from jsdelivr (`three@0.160.0`).
`shot.cjs` is the Playwright screenshot script used while iterating (`node shot.cjs out.png '{"speed":0,"anim":"attack","t":0.4,"dir":"0"}'`).

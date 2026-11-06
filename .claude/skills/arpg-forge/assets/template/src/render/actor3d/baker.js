/**
 * The 3D sprite baker: one WebGL renderer + scene, renders a posed rig into a sprite canvas
 * shaped exactly like the 2D puppet's (same box, same feet anchor, same glow list), then
 * finishes it in 2D: ink outline, contact shadow, hit flash.
 *
 * Camera: orthographic, pitched 30 deg; the model sits in a holder scaled 1/cos30 in Y so a
 * world unit stays one logical pixel tall on screen, and ground depth squashes 0.5 like the
 * iso tiles. Lights are screen-fixed (warm key upper-left like the game's LIGHT_X/Y, cold rim
 * behind-right, warm fill) plus a dim dungeon reflection environment.
 */
import * as THREE from '../../vendor/three.module.min.js';
import {
  BOX, BOX_TALL, BOX_DEATH, BOX_LOW, BUILDS, SPECIAL_SCALE, makeView, humanoidSkeleton,
} from '../draw_actor.js';
import { contactShadow } from '../draw_volume.js';
import { mix, makeCanvas } from '../draw_util.js';
import { makeAOUniforms, makeMaterials, creatureMaterials, dungeonEnv, AO_N } from './materials.js';
import { buildHumanoid } from './humanoid.js';
import { buildCreature } from './creature.js';

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const SPECIAL = new Set(['crawler', 'flier', 'blob', 'turret']);
const OUTLINE = 'rgba(8,6,10,0.94)';
const FX_LAYER = 1;

/** Tunables (the docs list these). */
export const QUALITY = {
  ss: 1.5, // supersampling on top of RENDER_SCALE (MSAA is on as well)
  shadowMap: 1536,
  exposure: 1.05,
  ink: 0.62, // outline radius in logical px
  rigCache: 24, // looks kept built at once
};

function shown(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export function boxFor(L, anim) {
  if (anim === 'death' && !SPECIAL.has(L.sil)) return BOX_DEATH;
  if (L.sil === 'tall') return BOX_TALL;
  if (L.sil === 'crawler' || L.sil === 'blob') return BOX_LOW;
  return BOX;
}

export function createBaker(T) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = QUALITY.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.environment = dungeonEnv(renderer);
  scene.environmentIntensity = 1.9;
  const U = makeAOUniforms();

  scene.add(new THREE.HemisphereLight(0xd8d2ff, 0x2a1d14, 0.4));
  const key = new THREE.DirectionalLight(0xffeedd, 3.1);
  key.position.set(-45, 160, 45);
  key.castShadow = true;
  key.shadow.mapSize.set(QUALITY.shadowMap, QUALITY.shadowMap);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.35;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 2.2);
  rim.position.set(80, 60, -90);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffc8a0, 0.45);
  fill.position.set(60, 20, 80);
  scene.add(fill);

  const holder = new THREE.Group();
  scene.add(holder);
  const topple = new THREE.Group();
  holder.add(topple);
  const yawer = new THREE.Group();
  topple.add(yawer);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
  cam.position.set(0, SIN30 * 900, COS30 * 900);
  cam.lookAt(0, 0, 0);

  const sharedTex = new Set();
  for (const set of Object.values(T)) for (const t of Object.values(set)) sharedTex.add(t);

  /* ------------------------------------------------ rigs, one per look (LRU) */
  const rigs = new Map();
  function rigFor(L, look) {
    let r = rigs.get(L.key);
    if (r) { rigs.delete(L.key); rigs.set(L.key, r); return r; }
    const M = makeMaterials(L, look, T, U);
    const special = SPECIAL.has(L.sil);
    if (special) creatureMaterials(L, M, U);
    r = special ? buildCreature(L, M) : buildHumanoid(L, M);
    r.M = M;
    r.special = special;
    // effect meshes render in their own pass (see bake)
    r.fx = [];
    r.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material === M.trail || o.material === M.flash || o.userData.fx) { o.layers.set(FX_LAYER); o.castShadow = false; r.fx.push(o); }
    });
    rigs.set(L.key, r);
    while (rigs.size > QUALITY.rigCache) {
      const [k, old] = rigs.entries().next().value;
      rigs.delete(k);
      disposeRig(old);
    }
    return r;
  }
  function disposeRig(r) {
    r.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const seen = new Set();
    for (const m of Object.values(r.M)) {
      if (!m || !m.isMaterial || seen.has(m)) continue;
      seen.add(m);
      for (const k of ['map', 'roughnessMap', 'normalMap', 'bumpMap']) if (m[k] && !sharedTex.has(m[k])) m[k].dispose();
      m.dispose();
    }
    r.root.removeFromParent();
  }

  const tmp = new THREE.Vector3();
  const stats = { sprites: 0, ms: 0, rigs: 0 };

  /**
   * Render one sprite. Returns a cache entry { canvas, ax, ay, w, h, glows } in the same form
   * as draw_util.cached() so draw_util.blit() draws it.
   */
  function bake(look, L, dir, anim, fk, scale, S) {
    const t0 = performance.now();
    const size = (look.size || 1) * scale * (SPECIAL_SCALE[L.sil] || 1);
    const box = boxFor(L, anim);
    const w = Math.ceil(box.w * size); const h = Math.ceil(box.h * size); const ay = Math.round(box.ay * size);
    const ax = w / 2;
    const OW = Math.ceil(w * S); const OH = Math.ceil(h * S);
    const RS = S * QUALITY.ss;
    const RW = Math.ceil(w * RS); const RH = Math.ceil(h * RS);
    if (canvas.width < RW || canvas.height < RH) {
      renderer.setSize(Math.max(canvas.width, RW), Math.max(canvas.height, RH), false);
    }

    const rig = rigFor(L, look);
    if (rig.root.parent !== yawer) { yawer.clear(); yawer.add(rig.root); }
    const V = makeView(dir);
    const yaw = Math.atan2(V.F[0], V.F[1]);
    yawer.rotation.y = yaw;
    holder.scale.set(size, size / COS30, size);

    // pose
    let sk = null; let prev = null;
    if (!rig.special) {
      sk = humanoidSkeleton(L, anim, fk);
      if (anim === 'attack' && fk > 0) prev = humanoidSkeleton(L, anim, fk - 1);
    }
    const res = rig.pose(sk, anim, fk, prev, yaw) || {};

    // death: humanoids topple over sideways on screen (like the puppet), creatures slump
    const death = anim === 'death';
    const fall = V.F[0] > 0.05 ? -1 : 1;
    topple.rotation.set(0, 0, 0); topple.scale.set(1, 1, 1); topple.position.set(0, 0, 0);
    let ang = 0; let slump = 1;
    if (death && !rig.special) {
      ang = [0.32, 0.95, 1.42, 1.5][fk];
      topple.rotation.z = -fall * ang;
      topple.position.y = Math.sin(ang) * BUILDS[L.sil].chest[0] * 0.75;
      if (fk === 3) topple.scale.y = 0.9;
    } else if (death) {
      slump = [0.85, 0.66, 0.52, 0.48][fk];
      topple.rotation.z = -(V.F[0] > 0 ? -1 : 1) * (1 - slump) * 0.35;
      if (L.sil !== 'blob') topple.scale.set(1 + (1 - slump) * 0.3, slump, 1 + (1 - slump) * 0.3);
    }
    scene.updateMatrixWorld(true);

    // sphere occluders -> world space
    const sph = U.uSph.value;
    for (let i = 0; i < AO_N; i++) {
      const o = rig.occ[i];
      if (!o) { sph[i].set(0, 0, 0, 0); continue; }
      tmp.copy(o[0]).applyMatrix4(rig.root.matrixWorld);
      sph[i].set(tmp.x, tmp.y, tmp.z, o[1] * size);
    }
    U.uGround.value = 9 * size / COS30;

    // camera frames the sprite box (feet at the origin), shadow camera the body
    cam.left = -ax; cam.right = w - ax; cam.top = ay; cam.bottom = -(h - ay);
    cam.updateProjectionMatrix();
    const ext = Math.max(w, h) * 0.75;
    const sc = key.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 1200;
    sc.updateProjectionMatrix();
    key.target.position.set(0, h * 0.25, 0);
    key.position.set(-45, 160, 45).normalize().multiplyScalar(500).add(key.target.position);
    key.target.updateMatrixWorld();

    // render into the bottom-left RW x RH corner
    // pass 1: the body (inked); pass 2: effects (trails, flashes, cast orbs) against the
    // body's depth, not inked, so they stay luminous
    renderer.setViewport(0, 0, RW, RH);
    renderer.setScissor(0, 0, RW, RH);
    renderer.setScissorTest(true);
    renderer.clear(true, true, true);
    cam.layers.set(0);
    renderer.render(scene, cam);
    const body = makeCanvas(OW, OH);
    const b = body.getContext('2d');
    b.imageSmoothingEnabled = true;
    b.imageSmoothingQuality = 'high';
    b.drawImage(canvas, 0, canvas.height - RH, RW, RH, 0, 0, OW, OH);
    let fx = null;
    if (rig.fx.some(shown)) {
      renderer.clear(true, false, false);
      cam.layers.set(FX_LAYER);
      renderer.shadowMap.autoUpdate = false;
      renderer.render(scene, cam);
      renderer.shadowMap.autoUpdate = true;
      fx = makeCanvas(OW, OH);
      const fc = fx.getContext('2d');
      fc.imageSmoothingEnabled = true;
      fc.imageSmoothingQuality = 'high';
      fc.drawImage(canvas, 0, canvas.height - RH, RW, RH, 0, 0, OW, OH);
    }
    renderer.setScissorTest(false);

    // finish in 2D at the output resolution
    const out = makeCanvas(OW, OH);
    const o = out.getContext('2d');
    // contact shadow (same shapes as the puppet)
    o.save();
    o.scale(S, S);
    o.translate(ax, ay);
    const sw = res.shadowR || rig.shadowR || (BUILDS[L.sil] ? BUILDS[L.sil].sh * 1.35 + 2 : 13);
    if (death && !rig.special) contactShadow(o, fall * Math.sin(ang) * 26 * size, 0, (sw + Math.sin(ang) * 22) * size, (6 + Math.sin(ang) * 3) * size, 0.5);
    else if (death) contactShadow(o, 0, 0, sw * 1.2 * size, sw * 0.5 * size, 0.55);
    else {
      const rf = sk ? sk.rootF * V.F[0] : 0;
      contactShadow(o, rf * size, size, sw * size, sw * 0.42 * size, rig.shadowA || 0.55);
    }
    o.restore();
    // ink: the silhouette stamped around a ring, tinted dark
    const ink = makeCanvas(OW, OH);
    const k = ink.getContext('2d');
    const r = Math.max(1, QUALITY.ink * S * Math.max(1, Math.sqrt(size)));
    const steps = 12;
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      k.drawImage(body, Math.cos(a) * r, Math.sin(a) * r);
    }
    k.globalCompositeOperation = 'source-in';
    k.fillStyle = OUTLINE;
    k.fillRect(0, 0, OW, OH);
    o.globalAlpha = death ? 0.75 : 0.95;
    o.drawImage(ink, 0, 0);
    o.globalAlpha = 1;
    // hit flash: tint the body toward white (the puppet's amounts)
    const flash = anim === 'hit' ? (fk === 0 ? 0.45 : 0.2) : 0;
    if (flash) {
      b.globalCompositeOperation = 'source-atop';
      b.fillStyle = `rgba(255,240,225,${flash})`;
      b.fillRect(0, 0, OW, OH);
      b.globalCompositeOperation = 'source-over';
    }
    o.drawImage(body, 0, 0);
    if (fx) o.drawImage(fx, 0, 0);

    // glow anchors -> sprite offsets (logical px from the feet)
    const glows = [];
    if (!death) {
      const facing = V.F[1] > -0.35;
      for (const g of rig.glows) {
        if (g.front && !facing) continue;
        tmp.copy(g.p).applyMatrix4(rig.root.matrixWorld).project(cam);
        const x = (tmp.x * 0.5 + 0.5) * w - ax;
        const y = (0.5 - tmp.y * 0.5) * h - ay;
        glows.push({ x, y, r: g.r * size, color: g.color || mix(L.trim, '#ffffff', 0.3), a: g.a });
      }
    }
    const ms = performance.now() - t0;
    stats.sprites++; stats.ms += ms; stats.rigs = rigs.size;
    return { canvas: out, ax, ay, w, h, glows, ms };
  }

  function dispose() {
    for (const r of rigs.values()) disposeRig(r);
    rigs.clear();
    renderer.dispose();
  }

  return { bake, stats, renderer, dispose };
}

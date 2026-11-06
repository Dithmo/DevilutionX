/**
 * pbr.js — PBR materials for the code-built character.
 *
 * - Scanned CC0 maps (ambientCG), pre-processed to grayscale "detail" albedo + roughness + normal,
 *   so the look's colours still drive the hue (any class/theme can reuse the same maps).
 * - boxUV(): box (tri-planar style) projection, because lathe/sphere parts have no useful UVs.
 * - Capsule AO: every material darkens, dirties and roughens where body parts crowd each other,
 *   computed per pixel from ~20 spheres that follow the skeleton (cheap, works for any pose).
 * - dungeonEnv(): a dim warm room with torch hot-spots for reflections instead of a white studio.
 */
import * as THREE from 'three';

export const AO_N = 20;

/** Load the processed maps. */
export async function loadPBR(base = './tex/') {
  const L = new THREE.TextureLoader();
  const get = async (name, srgb = false) => {
    const t = await L.loadAsync(base + name);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const set = async (k) => ({ detail: await get(`${k}_detail.jpg`), rough: await get(`${k}_rough.jpg`), normal: await get(`${k}_normal.jpg`) });
  const [metal, leather, fabric] = await Promise.all([set('metal'), set('leather'), set('fabric')]);
  return { metal, leather, fabric };
}

/**
 * Box projection: per triangle pick the dominant axis and project onto the other two.
 * Non-indexed so each face gets its own UVs; smooth normals are kept.
 */
export function boxUV(g, tile, seed = 0) {
  const n = g.index ? g.toNonIndexed() : g;
  const p = n.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const ox = (seed * 0.6180339) % 1, oy = (seed * 0.3819660) % 1;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const fn = b.clone().sub(a).cross(c.clone().sub(a));
    const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u, w;
      if (ax >= ay && ax >= az) { u = v.z; w = v.y; } else if (ay >= az) { u = v.x; w = v.z; } else { u = v.x; w = v.y; }
      uv[(i + k) * 2] = u / tile + ox;
      uv[(i + k) * 2 + 1] = w / tile + oy;
    }
  }
  n.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return n;
}

/** Shared uniforms for the sphere-occlusion pass (updated every pose). */
export function makeAOUniforms() {
  return {
    uSph: { value: Array.from({ length: AO_N }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uGrime: { value: new THREE.Color(0.42, 0.34, 0.27) },
  };
}

/** Inject capsule/sphere AO + grime into a Standard/Physical material. */
export function withAO(mat, U, grime = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSph = U.uSph;
    sh.uniforms.uGrime = U.uGrime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAOWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vAOWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vAOWorld;
uniform vec4 uSph[${AO_N}];
uniform vec3 uGrime;
float capAO(vec3 p, vec3 n) {
  float ao = 1.0;
  for (int i = 0; i < ${AO_N}; i++) {
    vec4 s = uSph[i];
    if (s.w <= 0.0) continue;
    vec3 d = s.xyz - p;
    float l = max(length(d), 1e-3);
    float h = l / s.w;
    float o = clamp(dot(n, d / l) / (h * h), 0.0, 1.0);
    ao *= 1.0 - 0.8 * o;
  }
  ao *= mix(0.5, 1.0, smoothstep(0.0, 9.0, p.y)); // ground contact
  return ao;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  float cAO = capAO(vAOWorld, inverseTransformDirection(normal, viewMatrix));
  float grimeAmt = (1.0 - cAO) * ${grime.toFixed(2)};
  diffuseColor.rgb *= mix(vec3(1.0), uGrime, clamp(grimeAmt * 1.6, 0.0, 1.0));
  roughnessFactor = min(1.0, roughnessFactor + grimeAmt * 0.45);
  metalnessFactor *= 1.0 - clamp(grimeAmt, 0.0, 0.6);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= cAO;
  reflectedLight.indirectSpecular *= cAO;
  reflectedLight.directDiffuse *= mix(0.55, 1.0, cAO);
  reflectedLight.directSpecular *= mix(0.4, 1.0, cAO);`);
  };
  mat.customProgramCacheKey = () => 'capAO' + grime;
  return mat;
}

function cloned(t, rx, ry) {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

/** Cloak albedo: wool weave tinted by the cloak colour, darker/dirtier toward the hem, trim band. */
function woolAlbedo(base, trim, weaveImg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const x = c.getContext('2d');
  const col = new THREE.Color(base);
  x.fillStyle = '#' + col.getHexString(); x.fillRect(0, 0, 256, 512);
  // weave detail (multiply), tiled
  x.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) x.drawImage(weaveImg, i * 128, j * 128, 128, 128);
  x.globalCompositeOperation = 'source-over';
  // grime toward the hem (canvas bottom = v 0 = the hem row of the cloak plane)
  const g = x.createLinearGradient(0, 512, 0, 0);
  g.addColorStop(0, 'rgba(40,30,18,0.45)');
  g.addColorStop(0.3, 'rgba(30,22,14,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.15)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 512);
  // trim band + stitched edge at the hem
  x.fillStyle = trim; x.fillRect(0, 474, 256, 38);
  x.fillStyle = '#a8843c'; x.fillRect(0, 470, 256, 3);
  for (let i = 0; i < 256; i += 12) x.fillRect(i, 490, 6, 3);
  // frayed, ragged hem: random dark nicks
  for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(Math.random() * 256, 500 + Math.random() * 12, 2 + Math.random() * 4, 12); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Build the PBR material set from a look. Tile sizes are world units per texture repeat
 * (read by the mesh helper to set box UVs).
 */
export function makePBRMaterials(look, T, U, extras) {
  const C = (hex) => new THREE.Color(hex);
  const metal = (color, opts = {}) => {
    const m = new THREE.MeshStandardMaterial({
      color, metalness: 1, roughness: opts.rough ?? 1,
      map: T.metal.detail, roughnessMap: T.metal.rough, normalMap: T.metal.normal,
      normalScale: new THREE.Vector2(opts.ns ?? 0.9, opts.ns ?? 0.9),
      envMapIntensity: opts.env ?? 1,
    });
    m.userData.tile = opts.tile ?? 22;
    return withAO(m, U, opts.grime ?? 1);
  };
  // metal F0 from the look colour: a little desaturated (reflections tint it again) and lifted
  const tame = (c, k) => { const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; return c.lerp(new THREE.Color(l, l, l), k); };
  const body = tame(C(look.bodyColor || '#b08a5a'), 0.4).multiplyScalar(1.85);
  const steelC = C(look.metalColor || '#c4c8cc').multiplyScalar(1.0);
  const mats = {
    plate: metal(body),
    edge: metal(body.clone().multiplyScalar(1.3), { rough: 0.62, ns: 0.25, grime: 0.3 }), // rubbed, polished rims
    steel: metal(steelC, { rough: 0.92 }),
    dark: metal(C('#34363b'), { rough: 1.35 }),
    gold: metal(C('#c49a45'), { rough: 1.05, ns: 0.5, tile: 12 }),
    mail: withAO(Object.assign(new THREE.MeshStandardMaterial({
      color: C('#7a7c82'), metalness: 1, roughness: 1.15, roughnessMap: T.metal.rough,
      bumpMap: extras.mail, bumpScale: 0.9,
    }), { userData: { tile: 8 } }), U, 1.2),
    leather: withAO(Object.assign(new THREE.MeshStandardMaterial({
      color: C(look.trimColor || '#4a3a2a').multiplyScalar(1.15), metalness: 0, roughness: 1,
      map: T.leather.detail, roughnessMap: T.leather.rough, normalMap: T.leather.normal, normalScale: new THREE.Vector2(2.2, 2.2),
    }), { userData: { tile: 7 } }), U, 0.8),
    cloth: withAO(new THREE.MeshPhysicalMaterial({
      map: woolAlbedo(look.cloakColor || '#5a2a22', look.trimColor || '#4a3a2a', T.fabric.detail.image),
      roughness: 1, roughnessMap: cloned(T.fabric.rough, 3, 6),
      normalMap: cloned(T.fabric.normal, 3, 6), normalScale: new THREE.Vector2(2.5, 2.5),
      sheen: 1, sheenRoughness: 0.75, sheenColor: C(look.cloakColor || '#5a2a22').lerp(C('#ffd9c0'), 0.35),
      metalness: 0, side: THREE.DoubleSide,
    }), U, 0.6),
    shieldFace: withAO(new THREE.MeshStandardMaterial({
      map: extras.emblem, metalness: 0.1, roughness: 0.72,
      normalMap: cloned(T.metal.normal, 0.8, 0.8), normalScale: new THREE.Vector2(1.2, 1.2),
    }), U, 0.8),
    void: new THREE.MeshBasicMaterial({ color: 0x050405 }),
  };
  mats.cloth.userData.keepUV = true;
  mats.shieldFace.userData.keepUV = true;
  return mats;
}

/** A dim, warm dungeon room as the reflection environment (torch hot-spots match the key light). */
export function dungeonEnv(renderer) {
  const s = new THREE.Scene();
  const basic = (r, g, b, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side });
  const room = new THREE.Mesh(new THREE.BoxGeometry(120, 70, 120), basic(0.08, 0.066, 0.058, THREE.BackSide));
  room.position.y = 25;
  s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(118, 118).rotateX(-PI2 / 4), basic(0.16, 0.125, 0.09));
  floor.position.y = -9;
  s.add(floor);
  const lamp = (x, y, z, r, col) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), basic(...col)); m.position.set(x, y, z); s.add(m); };
  lamp(-34, 34, 26, 9, [14, 8.5, 4.2]);   // key torch, upper left / front
  lamp(-18, 30, -40, 5, [4, 2.2, 0.9]);   // second torch behind left
  lamp(40, 24, -34, 11, [1.3, 1.7, 2.8]); // cold spill behind right (rim)
  lamp(30, 10, 30, 6, [1.4, 0.8, 0.4]);   // warm bounce front right
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.03).texture;
  pm.dispose();
  return tex;
}
const PI2 = Math.PI * 2;

/** Rolled plate edge: a tube along points. */
export function rimGeom(points, tube, closed) {
  const curve = new THREE.CatmullRomCurve3(points, closed);
  return new THREE.TubeGeometry(curve, Math.max(12, points.length * 2), tube, 5, closed);
}

/** Points on a lathe edge: radius r at height y, elliptical zScale, phi range (phi 0 = +Z). */
export function lathePoints(r, y, zScale = 1, phiStart = 0, phiLen = PI2, n = 32) {
  const closed = phiLen >= PI2 - 1e-6;
  const pts = [];
  const steps = closed ? n : n + 1;
  for (let i = 0; i < steps; i++) {
    const ph = phiStart + (phiLen * i) / n;
    pts.push(new THREE.Vector3(r * Math.sin(ph), y, r * Math.cos(ph) * zScale));
  }
  return { pts, closed };
}

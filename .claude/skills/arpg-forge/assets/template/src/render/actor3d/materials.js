/**
 * PBR materials for the code-built actors.
 *
 * - Scanned CC0 maps (ambientCG: Metal038, Metal054A, Leather037, Fabric031), pre-processed by
 *   the skill's scripts/prep_textures.py into grey detail + roughness + normal maps, so the
 *   look's colours drive the hue and every theme reuses the same 9 small JPGs.
 * - Box-projected UVs (parts.boxUV) because lathe / sphere parts have no useful UVs.
 * - Sphere occlusion: every material darkens, dirties and roughens where body parts crowd each
 *   other, from ~20 spheres that follow the skeleton (works in any pose, costs one loop).
 * - dungeonEnv(): a dim warm room with torch hot-spots as the reflection environment.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { parseColor, mix } from '../draw_util.js';

export const AO_N = 20;
const PI = Math.PI;

/** CSS colour (hex or rgb()) -> THREE.Color in linear space. */
export function col(c) {
  const [r, g, b] = parseColor(c);
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

/** Load the processed maps (relative to this module). */
export async function loadTextures(base = new URL('./tex/', import.meta.url).href) {
  const L = new THREE.TextureLoader();
  const get = async (name) => {
    const t = await L.loadAsync(base + name);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const set = async (k) => {
    const [detail, rough, normal] = await Promise.all([get(`${k}_detail.jpg`), get(`${k}_rough.jpg`), get(`${k}_normal.jpg`)]);
    return { detail, rough, normal };
  };
  const [metal, leather, fabric] = await Promise.all([set('metal'), set('leather'), set('fabric')]);
  return { metal, leather, fabric };
}

/** Shared uniforms for the sphere-occlusion pass (rewritten every pose). */
export function makeAOUniforms() {
  return {
    uSph: { value: Array.from({ length: AO_N }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uGrime: { value: new THREE.Color(0.42, 0.34, 0.27) },
    uGround: { value: 9 },
  };
}

/** Inject sphere AO + grime into a Standard/Physical material. */
export function withAO(mat, U, grime = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSph = U.uSph;
    sh.uniforms.uGrime = U.uGrime;
    sh.uniforms.uGround = U.uGround;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAOWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vAOWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vAOWorld;
uniform vec4 uSph[${AO_N}];
uniform vec3 uGrime;
uniform float uGround;
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
  ao *= mix(0.5, 1.0, smoothstep(0.0, uGround, p.y));
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

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Deterministic noise so the same look always bakes the same sprite. */
function rnd(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Cloth albedo along a hanging panel: wool weave tinted by the base colour, grimier toward the
 * hem (canvas bottom = v 0), a trim band with a stitched edge, and (tattered) a ragged hem cut
 * into the alpha.
 */
function hangingCloth(base, trim, stitch, weaveImg, { tattered = false, seed = 1, band = true } = {}) {
  const c = canvas(256, 512);
  const x = c.getContext('2d');
  const r = rnd(seed);
  x.fillStyle = base; x.fillRect(0, 0, 256, 512);
  x.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) x.drawImage(weaveImg, i * 128, j * 128, 128, 128);
  x.globalCompositeOperation = 'source-over';
  const g = x.createLinearGradient(0, 512, 0, 0);
  g.addColorStop(0, 'rgba(24,19,14,0.45)');
  g.addColorStop(0.3, 'rgba(20,16,12,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.15)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 512);
  if (band && !tattered) {
    x.fillStyle = trim; x.fillRect(0, 474, 256, 38);
    x.fillStyle = stitch; x.fillRect(0, 470, 256, 3);
    for (let i = 0; i < 256; i += 12) x.fillRect(i, 490, 6, 3);
  }
  for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(r() * 256, 500 + r() * 12, 2 + r() * 4, 12); }
  if (tattered) {
    // ragged hem and a few holes, cut through the alpha
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.moveTo(0, 512);
    for (let i = 0; i <= 256; i += 8) x.lineTo(i, 430 + r() * 82 * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.09))));
    x.lineTo(256, 512);
    x.closePath();
    x.fill();
    for (let i = 0; i < 7; i++) { x.beginPath(); x.ellipse(r() * 256, 200 + r() * 220, 4 + r() * 8, 8 + r() * 16, 0, 0, PI * 2); x.fill(); }
    x.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Shield face: a painted field with a pale (cross) charge and a rim line. */
function emblem(field, charge, rim) {
  const c = canvas(256, 256);
  const x = c.getContext('2d');
  const r = rnd(7);
  x.fillStyle = field; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`;
    x.fillRect(r() * 256, r() * 256, 2, 2);
  }
  x.fillStyle = charge;
  x.fillRect(106, 0, 44, 256);
  x.fillRect(30, 70, 196, 40);
  x.strokeStyle = rim; x.lineWidth = 10; x.strokeRect(8, 8, 240, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mailBump() {
  const c = canvas(64, 64);
  const x = c.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#ffffff'; x.lineWidth = 1.4;
  for (let r = 0; r < 9; r++) for (let q = 0; q < 9; q++) { x.beginPath(); x.arc(q * 8 + (r % 2) * 4, r * 8, 3.2, 0, PI * 2); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let MAIL = null;

/** Desaturate toward luminance (metal F0 is tinted again by its reflections). */
function tame(c, k) { const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; return c.lerp(new THREE.Color(l, l, l), k); }

/**
 * The material set for one resolved look (L from draw_actor.resolveLook).
 * Every Standard/Physical material carries userData.tile (world units per texture repeat)
 * unless it has its own UVs (userData.keepUV).
 */
export function makeMaterials(L, look, T, U) {
  if (!MAIL) MAIL = mailBump();
  const tag = (m, tile, keepUV = false) => { m.userData.tile = tile; m.userData.keepUV = keepUV; return m; };
  const metal = (color, o = {}) => tag(withAO(new THREE.MeshStandardMaterial({
    color, metalness: 1, roughness: o.rough ?? 1,
    map: T.metal.detail, roughnessMap: T.metal.rough, normalMap: T.metal.normal,
    normalScale: new THREE.Vector2(o.ns ?? 0.9, o.ns ?? 0.9), envMapIntensity: o.env ?? 1,
  }), U, o.grime ?? 1), o.tile ?? 22);
  const leatherM = (color, o = {}) => tag(withAO(new THREE.MeshStandardMaterial({
    color, metalness: 0, roughness: o.rough ?? 1,
    map: T.leather.detail, roughnessMap: T.leather.rough, normalMap: T.leather.normal,
    normalScale: new THREE.Vector2(o.ns ?? 2.2, o.ns ?? 2.2),
  }), U, o.grime ?? 0.8), o.tile ?? 7);
  const fabricM = (color, o = {}) => tag(withAO(new THREE.MeshPhysicalMaterial({
    color, metalness: 0, roughness: 1,
    map: T.fabric.detail, roughnessMap: T.fabric.rough, normalMap: T.fabric.normal,
    normalScale: new THREE.Vector2(o.ns ?? 2.0, o.ns ?? 2.0),
    sheen: 1, sheenRoughness: 0.75, sheenColor: color.clone().lerp(new THREE.Color(1, 0.95, 0.9), 0.3),
    side: o.side ?? THREE.FrontSide,
  }), U, o.grime ?? 0.7), o.tile ?? 9);
  const hideM = (color, o = {}) => tag(withAO(new THREE.MeshPhysicalMaterial({
    color, metalness: 0, roughness: o.rough ?? 0.72,
    map: T.leather.detail, normalMap: T.leather.normal, normalScale: new THREE.Vector2(o.ns ?? 0.8, o.ns ?? 0.8),
    clearcoat: o.coat ?? 0.15, clearcoatRoughness: 0.5, sheen: o.sheen ?? 0.4, sheenRoughness: 0.6,
    sheenColor: color.clone().lerp(new THREE.Color(1, 0.8, 0.7), 0.4),
  }), U, o.grime ?? 0.7), o.tile ?? 12);

  const plateArmour = L.armor === 'plate';
  const body = tame(col(L.body), 0.4).multiplyScalar(1.85);
  const glow = L.glow ? col(L.glow) : null;
  const glowBright = glow ? glow.clone().multiplyScalar(1.6) : null;
  const brassHex = look.accentColor || '#c49a45';
  const stitch = L.glow || mix(brassHex, '#000000', 0.15);
  const cloakTatter = L.cloak === 'tattered';
  const M = {
    plate: metal(body),
    edge: metal(body.clone().multiplyScalar(1.3), { rough: 0.62, ns: 0.25, grime: 0.3 }),
    steel: metal(col(L.metal), { rough: 0.92 }),
    dark: metal(col('#34363b'), { rough: 1.35 }),
    brass: metal(col(brassHex), { rough: 1.05, ns: 0.5, tile: 12 }),
    mail: tag(withAO(new THREE.MeshStandardMaterial({
      color: col('#7a7c82'), metalness: 1, roughness: 1.15, roughnessMap: T.metal.rough, bumpMap: MAIL, bumpScale: 0.9,
    }), U, 1.2), 8),
    leather: leatherM(col(L.leather).multiplyScalar(1.15)),
    jerkin: leatherM(col(L.body).multiplyScalar(0.95), { ns: 1.8 }),
    cloth: fabricM(col(L.body).multiplyScalar(0.9)),
    under: fabricM(col(L.under)),
    trimCloth: fabricM(col(L.trim), { tile: 6 }),
    cloak: tag(withAO(new THREE.MeshPhysicalMaterial({
      map: hangingCloth(L.cloakC, L.trim, stitch, T.fabric.detail.image, { tattered: cloakTatter, seed: 3 }),
      roughness: 1, roughnessMap: cloned(T.fabric.rough, 3, 6), normalMap: cloned(T.fabric.normal, 3, 6),
      normalScale: new THREE.Vector2(2.5, 2.5), sheen: 1, sheenRoughness: 0.75,
      sheenColor: col(L.cloakC).lerp(new THREE.Color(1, 0.95, 0.9), 0.3),
      side: THREE.DoubleSide, alphaTest: cloakTatter ? 0.5 : 0, transparent: false,
    }), U, 0.6), 1, true),
    robe: tag(withAO(new THREE.MeshPhysicalMaterial({
      map: hangingCloth(L.body, L.trim, stitch, T.fabric.detail.image, { seed: 5 }),
      roughness: 1, roughnessMap: cloned(T.fabric.rough, 4, 3), normalMap: cloned(T.fabric.normal, 4, 3),
      normalScale: new THREE.Vector2(2.2, 2.2), sheen: 1, sheenRoughness: 0.75,
      sheenColor: col(L.body).lerp(new THREE.Color(1, 0.95, 0.9), 0.3), side: THREE.DoubleSide,
    }), U, 0.6), 1, true),
    skin: hideM(col(L.skin), { ns: 0.35, coat: 0.1 }),
    hide: hideM(col(L.armor === 'none' ? L.body : L.skin), { ns: 1.1 }),
    hair: fabricM(col(mix(L.trim, '#000000', 0.3)), { ns: 3, tile: 3 }),
    bone: hideM(col(L.accent), { rough: 0.55, ns: 0.6, coat: 0.3, sheen: 0 }),
    chitin: hideM(col(L.body), { rough: 0.45, ns: 1.2, coat: 0.9, sheen: 0.2 }),
    shieldFace: tag(withAO(new THREE.MeshStandardMaterial({
      map: emblem(plateArmour ? L.cloakC : L.body, L.body === L.cloakC ? L.trim : (plateArmour ? L.body : L.trim), L.glow || brassHex),
      metalness: 0.1, roughness: 0.72, normalMap: cloned(T.metal.normal, 0.8, 0.8), normalScale: new THREE.Vector2(1.2, 1.2),
    }), U, 0.8), 1, true),
    glow: new THREE.MeshBasicMaterial({ color: glowBright || new THREE.Color(0.02, 0.016, 0.02), toneMapped: !glow }),
    eye: new THREE.MeshBasicMaterial({ color: glowBright || col('#e8dcc0').multiplyScalar(0.8), toneMapped: !glow }),
    focus: new THREE.MeshBasicMaterial({ color: (glow || col(mix(L.trim, '#ffffff', 0.35))).clone().multiplyScalar(1.7), toneMapped: false }),
    flash: new THREE.MeshBasicMaterial({ color: (glow ? col(mix(L.glow, '#ffffff', 0.5)) : col('#fff1b8')).multiplyScalar(2.2), toneMapped: false, transparent: true, depthWrite: false }),
    void: new THREE.MeshBasicMaterial({ color: 0x050405 }),
    trail: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  };
  // the head / helm uses the armour colour, or the hide for armourless bodies
  M.helm = L.armor === 'none' ? M.hide : M.plate;
  M.helmEdge = L.armor === 'none' ? M.hide : M.edge;
  return M;
}

/** Translucent slime and membranes (creatures). */
export function creatureMaterials(L, M, U) {
  const body = col(L.body);
  M.slime = withAO(new THREE.MeshPhysicalMaterial({
    color: body.clone().multiplyScalar(1.5), roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15,
    sheen: 0.6, sheenRoughness: 0.4, sheenColor: col(L.trim), transparent: true, opacity: 0.74, depthWrite: true,
  }), U, 0.3);
  // painted hull for machines (grey metal would mirror the dark room and read black)
  M.paint = withAO(new THREE.MeshPhysicalMaterial({
    color: body.clone().multiplyScalar(1.6), metalness: 0.2, roughness: 0.5, roughnessMap: M.steel.roughnessMap,
    normalMap: M.steel.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), clearcoat: 0.5, clearcoatRoughness: 0.35,
  }), U, 1);
  M.paint.userData.tile = 22;
  M.slime.userData.keepUV = true;
  M.membrane = withAO(new THREE.MeshPhysicalMaterial({
    color: col(mix(L.trim, L.body, 0.4)), roughness: 0.6, metalness: 0, side: THREE.DoubleSide,
    sheen: 0.6, sheenRoughness: 0.5, sheenColor: col('#ffb090'), transparent: true, opacity: 0.92,
  }), U, 0.5);
  M.membrane.userData.keepUV = true;
  M.rotor = new THREE.MeshBasicMaterial({ color: col(mix(L.metal, '#ffffff', 0.3)), transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  return M;
}

/** A dim, warm dungeon room as the reflection environment (torch hot-spots match the key light). */
export function dungeonEnv(renderer) {
  const s = new THREE.Scene();
  const basic = (r, g, b, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side });
  const room = new THREE.Mesh(new THREE.BoxGeometry(120, 70, 120), basic(0.08, 0.066, 0.058, THREE.BackSide));
  room.position.y = 25;
  s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(118, 118).rotateX(-PI / 2), basic(0.16, 0.125, 0.09));
  floor.position.y = -9;
  s.add(floor);
  const lamp = (x, y, z, r, c) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), basic(...c)); m.position.set(x, y, z); s.add(m); };
  lamp(-34, 34, 26, 9, [14, 8.5, 4.2]); // key torch, upper left / front
  lamp(-18, 30, -40, 5, [4, 2.2, 0.9]); // second torch behind left
  lamp(40, 24, -34, 11, [1.3, 1.7, 2.8]); // cold spill behind right (rim)
  lamp(30, 10, 30, 6, [1.4, 0.8, 0.4]); // warm bounce front right
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.03).texture;
  pm.dispose();
  return tex;
}

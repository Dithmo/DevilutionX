/**
 * rig3d.js — procedural 3D character, rigged and animated in code, baked to 2D sprites.
 *
 * Everything is built from a `look` (same fields the 2D puppet uses) — no model files.
 * Units: 1 unit = 1 logical game pixel. Model faces +Z, up +Y, its left hand is +X.
 * The bake camera is orthographic, pitched 30° (ground squash 0.5, like the iso tiles) and
 * the model is stretched 1/cos30 in Y so heights match the game's projection.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { boxUV, makeAOUniforms, makePBRMaterials, dungeonEnv, rimGeom, lathePoints } from './pbr.js';

const PI = Math.PI;
const COS30 = Math.cos(PI / 6);
const SIN30 = 0.5;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------ build (proportions) */
const B = {
  hipY: 33, hipW: 5.0, thigh: 15.5, shin: 15, ankleY: 3.2,
  spineY: 3, waist: 6, chestY: 15, shY: 21, sh: 11.5, neckY: 24,
  arm: 12.5, fore: 11.5, stride: 15, lift: 5,
};

/* ------------------------------------------------------------ geometry helpers */

/** Lathe around Y from [radius, y] pairs, then squash Z for an elliptical section. */
function lathe(profile, seg = 24, zScale = 1, phiStart = 0, phiLen = PI * 2) {
  // LatheGeometry faces outward when the profile runs bottom -> top
  const prof = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  const pts = prof.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLen);
  g.scale(1, 1, zScale);
  g.computeVertexNormals();
  return g;
}

/** Tapered limb hanging down -Y from 0 to -len, rounded caps. */
function limb(len, r0, r1, seg = 18) {
  const p = [];
  const cap = 6;
  for (let i = 0; i <= cap; i++) { const a = (i / cap) * PI / 2; p.push([r0 * Math.sin(a), r0 * 0.6 * Math.cos(a)]); }
  p.push([r0 * 1.02, -len * 0.25]);
  p.push([lerp(r0, r1, 0.6) * 1.02, -len * 0.65]);
  for (let i = cap; i >= 0; i--) { const a = (i / cap) * PI / 2; p.push([r1 * Math.sin(a), -len - r1 * 0.6 * Math.cos(a)]); }
  return lathe(p, seg);
}

/** Plate shell over the front of a limb (partial lathe). */
function shell(len, r0, r1, y0 = 0, arc = PI * 1.25) {
  const p = [[r0 * 0.85, y0 + 0.6], [r0, y0], [lerp(r0, r1, 0.5), y0 - len * 0.5], [r1, y0 - len], [r1 * 0.85, y0 - len - 0.6]];
  return lathe(p, 16, 1, -arc / 2, arc); // phi 0 = +Z
}

/** Make a geometry have flat facets (non-indexed + recomputed normals). */
function faceted(g) { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; }

/** Diamond-section blade along +Z: base at z=0, tip at z=len. */
function bladeGeom(len, w, t) {
  const pos = [];
  const st = 10;
  const ring = (z, hw, ht) => [[hw, 0, z], [0, ht, z], [-hw, 0, z], [0, -ht, z]];
  const rings = [];
  for (let i = 0; i <= st; i++) {
    const u = i / st;
    const taper = u < 0.82 ? lerp(1, 0.78, u / 0.82) : lerp(0.78, 0, (u - 0.82) / 0.18);
    rings.push(ring(u * len, (w / 2) * taper, (t / 2) * Math.max(0.35, taper)));
  }
  for (let i = 0; i < st; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      pos.push(...a[k], ...b[k], ...b[k2], ...a[k], ...b[k2], ...a[k2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Heater shield: face normal +Z, up +Y, gently curved; UVs span the face. */
function shieldGeom(w = 17, h = 21) {
  const s = new THREE.Shape();
  const hw = w / 2;
  const top = h * 0.42;
  s.moveTo(-hw, top);
  s.lineTo(hw, top);
  s.bezierCurveTo(hw, top - h * 0.45, hw * 0.75, -h * 0.35, 0, -h * 0.58);
  s.bezierCurveTo(-hw * 0.75, -h * 0.35, -hw, top - h * 0.45, -hw, top);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.6, bevelSegments: 2, curveSegments: 16 });
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, p.getZ(i) - 0.035 * x * x); // curve back at the edges
    uv.setXY(i, (x + hw) / w, (y + h * 0.58) / h);
  }
  g.computeVertexNormals();
  return g;
}

function emblemTexture(field, charge, rim) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = field; x.fillRect(0, 0, 256, 256);
  // subtle cloth/paint grain
  for (let i = 0; i < 1800; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // per pale
  x.fillStyle = charge;
  x.fillRect(106, 0, 44, 256);
  x.fillRect(30, 70, 196, 40);
  // inner rim line
  x.strokeStyle = rim; x.lineWidth = 10; x.strokeRect(8, 8, 240, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function clothTexture(base, trim) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  const col = new THREE.Color(base).multiplyScalar(0.72);
  x.fillStyle = '#' + col.getHexString(); x.fillRect(0, 0, 128, 256);
  // weave grain + darker toward the shoulders
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,230,210'},${Math.random() * 0.06})`;
    x.fillRect(Math.random() * 128, Math.random() * 256, 1 + Math.random() * 2, 1);
  }
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 256);
  // hem: trim band + gold stitch (v=0 is the bottom row)
  x.fillStyle = trim; x.fillRect(0, 238, 128, 18);
  x.fillStyle = '#c9a24a'; x.fillRect(0, 236, 128, 2);
  for (let i = 0; i < 128; i += 8) x.fillRect(i, 246, 4, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#ffffff'; x.lineWidth = 1.4;
  for (let r = 0; r < 9; r++) for (let q = 0; q < 9; q++) {
    x.beginPath(); x.arc(q * 8 + (r % 2) * 4, r * 8, 3.2, 0, PI * 2); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/* ------------------------------------------------------------ character */

/**
 * Build the warden from a look. Returns { root, J (joints), update(anim, t) }.
 */
export function buildCharacter(look, opts = {}) {
  const C = (hex) => new THREE.Color(hex);
  const pbr = !!opts.pbr;
  const U = opts.U;
  const emblem = emblemTexture(look.cloakColor || '#5a2a22', look.bodyColor || '#b08a5a', '#c9a24a');
  const mats = pbr ? makePBRMaterials(look, opts.tex, U, { mail: mailTexture(), emblem }) : {
    plate: new THREE.MeshStandardMaterial({ color: C(look.bodyColor || '#b08a5a'), metalness: 0.78, roughness: 0.36 }),
    steel: new THREE.MeshStandardMaterial({ color: C(look.metalColor || '#c4c8cc').multiplyScalar(0.78), metalness: 0.9, roughness: 0.34 }),
    dark: new THREE.MeshStandardMaterial({ color: C('#3a3c42'), metalness: 0.85, roughness: 0.5 }),
    mail: new THREE.MeshStandardMaterial({ color: C('#6d6f74'), metalness: 0.85, roughness: 0.55, bumpMap: mailTexture(), bumpScale: 0.6 }),
    leather: new THREE.MeshStandardMaterial({ color: C(look.trimColor || '#4a3a2a'), metalness: 0.05, roughness: 0.75 }),
    gold: new THREE.MeshStandardMaterial({ color: C('#c9a24a'), metalness: 1, roughness: 0.3 }),
    cloth: new THREE.MeshStandardMaterial({ map: clothTexture(look.cloakColor || '#5a2a22', look.trimColor || '#4a3a2a'), metalness: 0, roughness: 0.95, side: THREE.DoubleSide }),
    void: new THREE.MeshBasicMaterial({ color: 0x050405 }),
  };
  if (!pbr) {
    mats.edge = mats.plate;
    mats.shieldFace = new THREE.MeshStandardMaterial({ map: emblem, metalness: 0.25, roughness: 0.55 });
  }
  let uvSeed = 1;
  const mesh = (g, m, parent, x = 0, y = 0, z = 0) => {
    if (pbr && !Array.isArray(m) && m.userData.tile && !m.userData.keepUV) g = boxUV(g, m.userData.tile, uvSeed++);
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const joint = (parent, x = 0, y = 0, z = 0) => { const j = new THREE.Object3D(); j.position.set(x, y, z); parent.add(j); return j; };
  /** Rolled plate edge (PBR build only). */
  const rim = (parent, lp, tube = 0.32, mat = mats.edge) => { if (pbr) mesh(rimGeom(lp.pts, tube, lp.closed), mat, parent); };
  /** Occluder spheres that follow the skeleton: [joint, local offset, radius]. */
  const occ = [];
  const occluder = (j, x, y, z, r) => occ.push([j, new THREE.Vector3(x, y, z), r]);

  const root = new THREE.Object3D();
  const J = {};
  J.pelvis = joint(root, 0, B.hipY, 0);

  /* pelvis: hips, belt, fauld */
  mesh(lathe([[0.1, -4], [6.5, -3.5], [7.6, -1], [7.8, 2], [7.2, 4.5]], 24, 0.72), mats.mail, J.pelvis);
  mesh(new THREE.TorusGeometry(7.9, 1.05, 8, 28).rotateX(PI / 2).scale(1, 1, 0.74), mats.leather, J.pelvis, 0, 4.2, 0);
  mesh(new THREE.BoxGeometry(2.6, 2.4, 1), mats.gold, J.pelvis, 0, 4.2, 6.2);
  for (let i = 0; i < 3; i++) {
    const y = 3.2 - i * 2.4;
    const r0 = 8.1 + i * 0.55;
    mesh(faceted(lathe([[r0, y], [r0 + 0.6, y - 2.6]], 22, 0.74, -PI * 0.42, PI * 0.84)), i % 2 ? mats.steel : mats.plate, J.pelvis);
    rim(J.pelvis, lathePoints(r0 + 0.62, y - 2.6, 0.74, -PI * 0.42, PI * 0.84, 22), 0.3);
    if (pbr) for (const ph of [-0.3 * PI, 0, 0.3 * PI]) {
      const rr = r0 + 0.45;
      mesh(new THREE.SphereGeometry(0.42, 8, 6), mats.gold, J.pelvis, rr * Math.sin(ph), y - 1.0, rr * Math.cos(ph) * 0.74 + 0.15);
    }
  }

  /* legs */
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const hip = joint(J.pelvis, sx * B.hipW, -1, 0);
    const thigh = joint(hip);
    mesh(limb(B.thigh, 4.4, 3.5), mats.mail, thigh);
    mesh(shell(B.thigh * 0.8, 4.9, 4.1, -1), mats.plate, thigh);
    rim(thigh, lathePoints(4.9 * 0.93, -0.7, 1, -PI * 0.625, PI * 1.25, 18));
    rim(thigh, lathePoints(4.1 * 0.93, -1 - B.thigh * 0.8 - 0.3, 1, -PI * 0.625, PI * 1.25, 18));
    const knee = joint(thigh, 0, -B.thigh, 0);
    mesh(new THREE.SphereGeometry(2.6, 14, 10).scale(1.2, 1.05, 0.9), mats.steel, knee, 0, 0.3, 2.6);
    mesh(new THREE.ConeGeometry(2.4, 1.2, 12).rotateX(PI / 2).scale(1.4, 1, 1), mats.steel, knee, 0, 0.3, 3.3);
    const shin = joint(knee);
    mesh(limb(B.shin, 3.6, 2.7), mats.plate, shin);
    mesh(new THREE.TorusGeometry(3.4, 0.45, 6, 18).rotateX(PI / 2), mats.leather, shin, 0, -3.5, 0);
    const foot = joint(shin, 0, -B.shin, 0);
    const sab = new THREE.Group(); foot.add(sab);
    mesh(new THREE.SphereGeometry(1, 16, 10).scale(3.0, 2.3, 4.6), mats.steel, sab, 0, -1.2, 2.2);
    mesh(new THREE.SphereGeometry(1, 14, 8, 0, PI * 2, 0, PI / 2).scale(2.4, 1.6, 2.8), mats.steel, sab, 0, -1.6, 6.0);
    for (let k = 0; k < 3; k++) mesh(new THREE.TorusGeometry(2.6 - k * 0.3, 0.25, 4, 14, PI).rotateY(PI / 2).rotateZ(PI / 2), mats.dark, sab, 0, -1.0 - k * 0.2, 3.2 + k * 1.3);
    mesh(new THREE.BoxGeometry(5.6, 0.8, 9.6), mats.leather, sab, 0, -3.0, 2.6);
    J['hip' + side] = hip; J['thigh' + side] = thigh; J['shin' + side] = shin; J['foot' + side] = foot;
  }

  /* spine / torso */
  J.spine = joint(J.pelvis, 0, B.spineY, 0);
  J.chest = joint(J.spine, 0, 5, 0);
  // cuirass: lathe with a front keel
  const cuirass = lathe([[7.4, -4], [7.7, 0], [9.3, 5], [10.6, 9], [10.4, 12], [9.0, 14.5], [6.0, 16.2], [4.2, 16.8]], 32, 0.7);
  {
    const p = cuirass.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (z > 0) p.setZ(i, z + 1.7 * Math.max(0, 1 - Math.abs(x) / 5) * clamp01((y + 2) / 8) * clamp01((16 - y) / 4));
    }
    cuirass.computeVertexNormals();
  }
  mesh(cuirass, mats.plate, J.chest);
  rim(J.chest, lathePoints(7.45, -4, 0.7), 0.4);
  // plackart (lower belly plate) + rivets
  mesh(faceted(lathe([[7.9, -3.6], [8.3, 0.5], [9.6, 4.4]], 20, 0.74, -PI * 0.33, PI * 0.66)), mats.steel, J.chest);
  rim(J.chest, lathePoints(9.65, 4.4, 0.74, -PI * 0.33, PI * 0.66, 20), 0.3);
  for (const rx of [-4.2, 4.2]) mesh(new THREE.SphereGeometry(0.55, 8, 6), mats.gold, J.chest, rx, 2.6, 6.9);
  // gorget
  mesh(lathe([[5.6, 14.6], [5.2, 16.6], [3.6, 18.6], [3.4, 19.6]], 20, 0.85), mats.steel, J.chest);
  rim(J.chest, lathePoints(3.45, 19.6, 0.85), 0.28);
  rim(J.chest, lathePoints(5.65, 14.6, 0.85), 0.3);
  // shoulder straps
  for (const sx of [1, -1]) mesh(new THREE.BoxGeometry(2.2, 0.8, 12), mats.leather, J.chest, sx * 6.2, 15.7, 0);

  /* cloak (rebuilt each frame) */
  const CW = 9, CH = 12;
  const cloakGeom = new THREE.PlaneGeometry(1, 1, CW, CH);
  const cloak = mesh(cloakGeom, mats.cloth, J.chest);
  cloak.castShadow = true;
  const cloakLen = look.cloak === 'long' ? 44 : 30;
  // clasps
  for (const sx of [1, -1]) mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.6, 12).rotateX(PI / 2), mats.gold, J.chest, sx * 6.4, 15.2, 5.4);

  /* head */
  J.neck = joint(J.chest, 0, 18.2, 0.2);
  J.head = joint(J.neck, 0, 1.5, 0);
  const helmProf = [[0.1, 11.4], [3.0, 11.0], [5.0, 9.9], [6.0, 8.0], [6.4, 5], [6.3, 0.5], [5.9, -1.5], [5.3, -2.2]];
  mesh(lathe(helmProf, 28, 1.05), mats.plate, J.head);
  rim(J.head, lathePoints(5.35, -2.2, 1.05), 0.42);
  // vertical front ridge
  mesh(new THREE.BoxGeometry(0.9, 11, 1.2), mats.plate, J.head, 0, 4.4, 6.5);
  // brow band + visor slits + breaths
  mesh(new THREE.TorusGeometry(6.6, 0.38, 6, 28).rotateX(PI / 2).scale(1, 1, 1.05), mats.gold, J.head, 0, 7.6, 0);
  for (const sx of [1, -1]) {
    mesh(new THREE.BoxGeometry(4.6, 0.9, 2.2).rotateY(sx * 0.42), mats.void, J.head, sx * 2.7, 5.4, 5.6);
    for (let k = 0; k < 3; k++) for (let r = 0; r < 2; r++) mesh(new THREE.BoxGeometry(0.5, 0.5, 1.6), mats.void, J.head, sx * (1.5 + k * 1.1), 1.4 - r * 1.3, 6.3 - k * 0.35);
  }
  // crest
  mesh(new THREE.ConeGeometry(1.1, 3.6, 10).translate(0, 1.6, 0), mats.gold, J.head, 0, 10.6, 0);

  /* arms */
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const sh = joint(J.chest, sx * B.sh, 13.4, -0.4);
    const upper = joint(sh);
    mesh(limb(B.arm, 3.8, 3.2), mats.mail, upper);
    mesh(shell(B.arm * 0.62, 4.15, 3.7, -3.2, PI * 1.5), mats.plate, upper);
    rim(upper, lathePoints(3.7 * 0.93, -3.2 - B.arm * 0.62 - 0.3, 1, -PI * 0.75, PI * 1.5, 18));
    const elbow = joint(upper, 0, -B.arm, 0);
    mesh(new THREE.SphereGeometry(2.4, 12, 10).scale(1.05, 1, 1.15), mats.plate, elbow, 0, 0, -1.2);
    mesh(new THREE.ConeGeometry(2.6, 1.3, 12).rotateX(-PI / 2).scale(1, 1.4, 1), mats.plate, elbow, sx * 1.6, 0, -1.6);
    const fore = joint(elbow);
    mesh(limb(B.fore, 3.2, 2.6), mats.plate, fore);
    // gauntlet cuff + fist
    mesh(lathe([[2.8, -7.2], [3.9, -9.6], [3.2, -10.4]], 16), mats.steel, fore);
    const hand = joint(fore, 0, -B.fore - 0.6, 0);
    mesh(new THREE.SphereGeometry(1, 14, 10).scale(2.1, 2.4, 2.3), mats.steel, hand, 0, -1.4, 0.2);
    for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(0.9, 0.9, 1.5), mats.dark, hand, sx * -0.9, -2.8 + k * 0.85, 1.6);
    // pauldron: three lames on the shoulder, children of the chest so a raised arm doesn't swallow them
    const pa = joint(J.chest, sx * (B.sh - 1.2), 15.2, -0.4);
    for (let k = 0; k < 3; k++) {
      const r = 6.4 + k * 0.5;
      const g = new THREE.SphereGeometry(r, 18, 10, 0, PI * 2, 0, PI * 0.42 + k * 0.05).scale(1, 0.62, 1.02);
      const m = mesh(g, k === 0 ? mats.plate : (k === 1 ? mats.steel : mats.plate), pa, sx * (1.2 + k * 0.9), -k * 1.9, 0);
      m.rotation.z = -sx * (0.35 + k * 0.18);
      const th = PI * 0.42 + k * 0.05;
      rim(m, lathePoints(r * Math.sin(th), r * Math.cos(th) * 0.62, 1.02), 0.38);
    }
    mesh(new THREE.SphereGeometry(0.6, 8, 6), mats.gold, pa, sx * 3.6, 0.6, 3.2);
    J['sh' + side] = sh; J['arm' + side] = upper; J['fore' + side] = fore; J['hand' + side] = hand; J['paul' + side] = pa;
  }

  /* sword in right hand: blade along hand +Z */
  const sword = new THREE.Group();
  J.handR.add(sword);
  sword.position.set(0, -1.4, 0.2);
  sword.rotation.x = 0.9; // grip runs diagonally through the fist
  mesh(bladeGeom(27, 3.4, 1.0), mats.steel, sword, 0, 0, 3.6);
  mesh(new THREE.BoxGeometry(0.35, 0.95, 16).translate(0, 0, 8), mats.dark, sword, 0, 0, 4.2); // fuller line
  mesh(new THREE.BoxGeometry(10.5, 1.2, 1.3), mats.gold, sword, 0, 0, 3.0);
  for (const s of [1, -1]) mesh(new THREE.SphereGeometry(0.85, 8, 6), mats.gold, sword, s * 5.4, 0, 3.0);
  mesh(new THREE.CylinderGeometry(0.75, 0.85, 6.4, 10).rotateX(PI / 2), mats.leather, sword, 0, 0, -0.4);
  mesh(new THREE.SphereGeometry(1.35, 12, 10).scale(1, 1, 0.8), mats.gold, sword, 0, 0, -4.1);
  J.sword = sword;
  J.swordTip = joint(sword, 0, 0, 30.6);
  J.swordBase = joint(sword, 0, 0, 9);

  /* swing trail ribbon (root space) */
  const TN = 9;
  const trailGeom = new THREE.BufferGeometry();
  trailGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TN * 2 * 3), 3));
  trailGeom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(TN * 2 * 4), 4));
  const idx = [];
  for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  trailGeom.setIndex(idx);
  const trail = new THREE.Mesh(trailGeom, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  trail.frustumCulled = false;
  trail.renderOrder = 10;
  root.add(trail);
  function setTrail(pts) {
    trail.visible = pts.length > 1;
    if (!trail.visible) return;
    const P = trailGeom.attributes.position, Cc = trailGeom.attributes.color;
    for (let i = 0; i < TN; i++) {
      const q = pts[Math.min(i, pts.length - 1)];
      P.setXYZ(i * 2, q[0].x, q[0].y, q[0].z);
      P.setXYZ(i * 2 + 1, q[1].x, q[1].y, q[1].z);
      const fade = i < pts.length ? 1 - i / (pts.length - 1 || 1) : 0;
      Cc.setXYZW(i * 2, 1, 0.93, 0.82, 0.0);
      Cc.setXYZW(i * 2 + 1, 1, 0.96, 0.88, 0.6 * fade);
    }
    P.needsUpdate = true; Cc.needsUpdate = true;
    trailGeom.computeBoundingSphere();
  }

  /* shield on the left forearm: face points along forearm-local +X (outward) */
  const mount = joint(J.foreL, 0, -6.5, 0);
  const sg = shieldGeom();
  sg.rotateX(PI / 2); sg.rotateZ(PI / 2); // face +Z -> +X, up +Y -> +Z
  const sh = mesh(sg, [mats.shieldFace, mats.steel], mount, 4.4, 0, 0);
  mesh(new THREE.SphereGeometry(2.1, 14, 10, 0, PI * 2, 0, PI / 2).rotateZ(-PI / 2), mats.gold, mount, 5.8, 0, 1.0);
  J.shield = mount;
  void sh;

  occluder(J.pelvis, 0, 0, 0, 8);
  occluder(J.chest, 0, 4, 0, 8.5);
  occluder(J.chest, 0, 11, 0, 9.5);
  occluder(J.head, 0, 4.5, 0, 6.5);
  for (const sd of ['L', 'R']) {
    const sx = sd === 'L' ? 1 : -1;
    occluder(J['arm' + sd], 0, -6, 0, 4.2);
    occluder(J['fore' + sd], 0, -6, 0, 3.5);
    occluder(J['hand' + sd], 0, -1.5, 0, 2.4);
    occluder(J['thigh' + sd], 0, -7.5, 0, 4.8);
    occluder(J['shin' + sd], 0, -7.5, 0, 3.8);
    occluder(J['foot' + sd], 0, -1.5, 2.5, 3.2);
    occluder(J['paul' + sd], sx * 1.5, -1, 0, 6);
  }
  occluder(J.shield, 4.4, 0, 0, 7);
  const tmpO = new THREE.Vector3();
  function updateAO() {
    if (!U) return;
    root.updateMatrixWorld(true);
    occ.forEach(([j, off, r], i) => {
      tmpO.copy(off); j.localToWorld(tmpO);
      U.uSph.value[i].set(tmpO.x, tmpO.y, tmpO.z, r);
    });
  }

  /* ------------------------------------------------ posing */
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const rootQ = new THREE.Quaternion();

  function legIK(side, target /* root-space ankle */, footPitch) {
    const hip = J['hip' + side];
    root.updateMatrixWorld(true);
    tmpV.copy(target);
    root.localToWorld(tmpV);
    hip.worldToLocal(tmpV);
    const vx = tmpV.x, vy = tmpV.y, vz = tmpV.z;
    const l1 = B.thigh, l2 = B.shin;
    let d = Math.hypot(vx, vy, vz);
    d = Math.min(d, (l1 + l2) * 0.999);
    const a = Math.atan2(-vz, -vy);
    const c = Math.asin(Math.max(-1, Math.min(1, vx / d)));
    const alpha = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
    const beta = PI - Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
    J['thigh' + side].rotation.set(a - alpha, 0, c);
    J['shin' + side].rotation.set(beta, 0, 0);
    // foot: flat to the root frame (plus pitch), whatever the leg is doing
    const foot = J['foot' + side];
    root.updateMatrixWorld(true);
    foot.parent.getWorldQuaternion(tmpQ).invert();
    root.getWorldQuaternion(rootQ);
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(footPitch, 0, 0));
    foot.quaternion.copy(tmpQ.multiply(rootQ).multiply(want));
  }

  function setArm(side, p) {
    J['arm' + side].rotation.set(p.x || 0, p.y || 0, p.z || 0);
    J['fore' + side].rotation.set(-(p.elbow || 0), p.twist || 0, 0);
    J['hand' + side].rotation.set(p.wx || 0, p.wy || 0, p.wz || 0);
    const pa = J['paul' + side];
    pa.rotation.set((p.x || 0) * 0.22, 0, (p.z || 0) * 0.25);
  }

  const foot = (u, stride) => {
    // u in [0,1): 0..0.5 stance (front->back), 0.5..1 swing
    if (u < 0.5) {
      const s = u / 0.5;
      let pitch = 0;
      if (s < 0.14) pitch = -0.28 * (1 - s / 0.14);
      if (s > 0.7) pitch = 0.55 * ((s - 0.7) / 0.3) ** 2;
      return { z: stride / 2 - s * stride, y: B.ankleY + 3.2 * Math.max(0, Math.sin(pitch)), pitch };
    }
    const s = (u - 0.5) / 0.5;
    const e = smooth(s);
    const pitch = 0.55 * (1 - s) ** 2 - 0.28 * smooth(clamp01((s - 0.6) / 0.4));
    return { z: -stride / 2 + e * stride, y: B.ankleY + B.lift * Math.sin(PI * s) ** 1.2, pitch };
  }

  /* cloak sim: simple kinematic drape with a travelling wave */
  function updateCloak(phase, drag, gust) {
    const p = cloakGeom.attributes.position;
    let i = 0;
    for (let r = 0; r <= CH; r++) {
      const t = r / CH;
      for (let q = 0; q <= CW; q++) {
        const u = q / CW - 0.5; // -0.5..0.5 across
        const w = lerp(10.5, 15.5, t);
        let x = u * 2 * w;
        const y = 15.6 - t * cloakLen + 2.2 * u * u * t;
        // wrap around the back; sides come forward, bottom flares back
        const back = -7.1 - 1.2 * t - drag * t * t * 7;
        let z = back + 9 * u * u * (1 - 0.3 * t) * (t < 0.15 ? t / 0.15 : 1);
        if (t < 0.12) { z = lerp(-1.5 + 4 * u * u, z, t / 0.12); }
        const wave = Math.sin(phase * 2 - t * 3.2 + u * 2.4) * t * t;
        z += wave * (1.3 + gust * 2);
        x += Math.sin(phase * 2 - t * 2.5) * t * t * 1.4 * gust;
        // folds: vertical pleats deepen toward the hem
        z += Math.sin(u * PI * 7) * (0.5 + 1.1 * t) * (0.4 + t);
        p.setXYZ(i++, x, y, z);
      }
    }
    p.needsUpdate = true;
    cloakGeom.computeVertexNormals();
  }

  /** Pose for anim ('walk' | 'attack' | 'idle') at t in [0,1). */
  function update(anim, t) {
    poseFrame(anim, t);
    updateAO();
  }

  function poseFrame(anim, t) {
    const P = J.pelvis;
    P.position.set(0, B.hipY, 0);
    P.rotation.set(0, 0, 0);
    J.spine.rotation.set(0, 0, 0);
    J.chest.rotation.set(0, 0, 0);
    J.neck.rotation.set(0, 0, 0);
    J.head.rotation.set(0, 0, 0);
    if (anim === 'walk') {
      setTrail([]);
      const ph = t * PI * 2;
      const S = B.stride;
      P.position.y = B.hipY - 1.9 + 1.7 * Math.abs(Math.sin(ph));
      P.position.x = 0.7 * Math.sin(ph);
      P.rotation.set(0.07, -0.16 * Math.cos(ph), 0.06 * Math.sin(ph));
      J.spine.rotation.set(0.04, 0.12 * Math.cos(ph), -0.04 * Math.sin(ph));
      J.chest.rotation.set(0.02 + 0.02 * Math.cos(2 * ph), 0.12 * Math.cos(ph), -0.02 * Math.sin(ph));
      J.neck.rotation.set(-0.12, -0.08 * Math.cos(ph), 0.05 * Math.sin(ph));
      const fl = foot(t % 1, S), fr = foot((t + 0.5) % 1, S);
      legIK('L', new THREE.Vector3(B.hipW - 0.2, fl.y, fl.z), fl.pitch);
      legIK('R', new THREE.Vector3(-B.hipW + 0.2, fr.y, fr.z), fr.pitch);
      // sword arm swings opposite the right leg; shield arm stays up in guard
      const sw = Math.cos(ph);
      setArm('R', { x: -0.08 - 0.32 * sw, z: -0.12, y: 0.1, elbow: 0.95 - 0.25 * sw, twist: 0.2, wx: 0.45 + 0.1 * sw, wz: 0.12 });
      setArm('L', { x: -0.5 + 0.08 * sw, z: 0.22, y: -0.2, elbow: 1.35 + 0.05 * sw, twist: -0.5 });
      J.shield.rotation.set(0, 0, -0.5);
      updateCloak(ph, 0.45, 0.6);
    } else if (anim === 'attack') {
      // sword trail: sample the blade over the last few hundredths of the swing
      const pts = [];
      for (let i = 0; i < 9; i++) {
        const tk = t - i * 0.022;
        if (tk < 0.4 || tk > 0.74) break;
        poseAttack(tk);
        root.updateMatrixWorld(true);
        pts.push([root.worldToLocal(J.swordBase.getWorldPosition(new THREE.Vector3())), root.worldToLocal(J.swordTip.getWorldPosition(new THREE.Vector3()))]);
      }
      setTrail(pts);
      poseAttack(t);
    } else {
      setTrail([]);
      poseIdle(t);

    }
  }

  function poseAttack(t) {
    const P = J.pelvis;
    {
      const k = sampleAttack(t);
      P.position.set(0, B.hipY - k.crouch, k.lunge);
      P.rotation.set(0.05 + k.lean * 0.4, k.hipYaw, 0);
      J.spine.rotation.set(k.lean * 0.6, k.yaw * 0.5, k.side * 0.5);
      J.chest.rotation.set(k.lean * 0.4, k.yaw * 0.5, k.side * 0.5);
      J.neck.rotation.set(-k.lean, -k.yaw * 0.55 - k.hipYaw * 0.5, -k.side * 0.6);
      legIK('L', new THREE.Vector3(B.hipW + 0.6, B.ankleY, 6.5 + k.step), k.step > 0.5 ? -0.05 : 0);
      legIK('R', new THREE.Vector3(-B.hipW - 0.6, B.ankleY + 1.3, -7.5), 0.35);
      setArm('R', { x: k.ax, y: k.ay, z: k.az, elbow: k.el, twist: k.tw, wx: k.wx, wz: k.wz });
      setArm('L', { x: -0.75 + k.yaw * 0.3, z: 0.35, y: -0.25, elbow: 1.45, twist: -0.6 });
      J.shield.rotation.set(0, 0, -0.55);
      updateCloak(t * PI * 2, 0.3 + k.yaw * -0.3, 0.9);
    }
  }

  function poseIdle(t) {
    const P = J.pelvis;
    {
      const ph = t * PI * 2;
      P.position.y = B.hipY - 0.6 + 0.35 * Math.sin(ph);
      J.chest.rotation.set(0.02 * Math.sin(ph), 0, 0);
      legIK('L', new THREE.Vector3(B.hipW + 0.6, B.ankleY, 3), 0);
      legIK('R', new THREE.Vector3(-B.hipW - 0.8, B.ankleY, -2.5), 0);
      setArm('R', { x: -0.15, z: -0.15, elbow: 0.9, twist: 0.2, wx: 0.45 });
      setArm('L', { x: -0.5, z: 0.22, y: -0.2, elbow: 1.35, twist: -0.5 });
      J.shield.rotation.set(0, 0, -0.5);
      updateCloak(ph, 0.1, 0.25);
    }
  }

  return { root, J, update, mats };
}

/* attack keyframes: ready -> windup -> strike -> impact -> follow -> recover */
const ATK = [
  { t: 0.00, yaw: 0.0, hipYaw: 0.0, lean: 0.04, side: 0, lunge: 0, crouch: 0.5, step: 0, ax: -0.4, ay: 0.1, az: -0.15, el: 1.0, tw: 0.2, wx: -0.2, wz: 0.1 },
  { t: 0.28, yaw: -0.75, hipYaw: -0.25, lean: -0.06, side: 0.06, lunge: -1.5, crouch: 1.0, step: 0, ax: -2.5, ay: -0.5, az: -0.9, el: 1.75, tw: 0.4, wx: 0.75, wz: 0.4 },
  { t: 0.42, yaw: -0.2, hipYaw: 0.05, lean: 0.12, side: 0, lunge: 1.5, crouch: 1.6, step: 2, ax: -2.3, ay: 0.3, az: -0.35, el: 0.6, tw: 0.2, wx: 0.4, wz: 0.2 },
  { t: 0.54, yaw: 0.55, hipYaw: 0.25, lean: 0.28, side: -0.06, lunge: 4.5, crouch: 3.0, step: 5, ax: -1.25, ay: 0.4, az: 0.55, el: 0.12, tw: 0.0, wx: 0.8, wz: -0.2 },
  { t: 0.68, yaw: 0.75, hipYaw: 0.3, lean: 0.26, side: -0.05, lunge: 4.5, crouch: 2.8, step: 5, ax: -0.75, ay: 0.4, az: 0.85, el: 0.3, tw: -0.1, wx: 1.05, wz: -0.3 },
  { t: 1.00, yaw: 0.0, hipYaw: 0.0, lean: 0.04, side: 0, lunge: 0, crouch: 0.5, step: 0, ax: -0.4, ay: 0.1, az: -0.15, el: 1.0, tw: 0.2, wx: -0.2, wz: 0.1 },
];

function sampleAttack(t) {
  let i = 0;
  while (i < ATK.length - 2 && t > ATK[i + 1].t) i++;
  const a = ATK[i], b = ATK[i + 1];
  const p0 = ATK[Math.max(0, i - 1)], p3 = ATK[Math.min(ATK.length - 1, i + 2)];
  let u = clamp01((t - a.t) / (b.t - a.t));
  // fast strike, eased elsewhere
  u = i === 2 ? u : smooth(u);
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === 't') continue;
    // Catmull-Rom for smooth arcs through the keys
    const v0 = p0[k], v1 = a[k], v2 = b[k], v3 = p3[k];
    const u2 = u * u, u3 = u2 * u;
    out[k] = 0.5 * ((2 * v1) + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 + (-v0 + 3 * v1 - 3 * v2 + v3) * u3);
  }
  return out;
}

/* ------------------------------------------------------------ baking */

/** Same direction convention as the 2D engine: 0..7 = S, SW, W, NW, N, NE, E, SE. */
const DIRS8 = [[1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]];
export function dirYaw(dir) {
  const [dx, dy] = DIRS8[dir];
  const sx = (dx - dy) * 2, sy = dx + dy; // screen dir (2:1 iso)
  const n = Math.hypot(sx, sy);
  const gx = sx / n, gy = (sy / n) / 0.5; // un-squash to ground plane
  return Math.atan2(gx, gy);
}

export const BOX = { w: 150, h: 160, ax: 75, ay: 132 };

/**
 * Create a baker: owns the WebGL renderer, scene, lights, camera.
 * bake(look, {scale, frames:{walk,attack,idle}, ss}) -> { sheets: {anim: [dir][frame] canvas}, ms }
 */
export function createBaker(tex) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const ENV = {
    flat: { tex: pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture, intensity: 0.4, hemi: 0.55 },
    pbr: { tex: tex ? dungeonEnv(renderer) : null, intensity: 1.9, hemi: 0.4 },
  };
  const U = makeAOUniforms();

  // lights live in screen-fixed positions (upper-left key like the game's LIGHT_X/Y)
  const hemi = new THREE.HemisphereLight(0xd8d2ff, 0x2a1d14, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe0b8, 3.1);
  key.position.set(-45, 160, 45);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -70, right: 70, top: 110, bottom: -40, near: 1, far: 400 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.35;
  key.shadow.radius = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 2.2);
  rim.position.set(80, 60, -90);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffb37a, 0.45);
  fill.position.set(60, 20, 80);
  scene.add(fill);

  // ground: only catches the shadow
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-PI / 2), new THREE.ShadowMaterial({ opacity: 0.28 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // the model sits in a holder that undoes the camera's vertical foreshortening
  const holder = new THREE.Group();
  holder.scale.set(1, 1 / COS30, 1);
  scene.add(holder);
  const yawer = new THREE.Group();
  holder.add(yawer);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
  cam.position.set(0, SIN30 * 600, COS30 * 600);
  cam.lookAt(0, 0, 0);

  const chars = {};
  function charFor(look, pbr) {
    const k = pbr ? 'pbr' : 'flat';
    if (!chars[k]) {
      chars[k] = buildCharacter(look, { pbr, tex, U });
      yawer.add(chars[k].root);
    }
    for (const [n, c] of Object.entries(chars)) c.root.visible = n === k;
    const e = ENV[k];
    scene.environment = e.tex;
    scene.environmentIntensity = e.intensity;
    hemi.intensity = e.hemi;
    return chars[k];
  }

  /**
   * A sprite set: frames are rendered lazily the first time they are asked for (the game would
   * do the same per direction), or all at once with bakeAll().
   */
  function sheet(look, opts = {}) {
    const scale = opts.scale || 1;
    const dpr = opts.dpr || 2;
    const ss = opts.ss || 2;
    const frames = opts.frames || { walk: 16, attack: 14, idle: 8 };
    const W = Math.ceil(BOX.w * scale * dpr), H = Math.ceil(BOX.h * scale * dpr);
    const cache = new Map();
    const stats = { sprites: 0, ms: 0 };
    const pbr = !!opts.pbr;
    function get(anim, dir, f) {
      const key = anim + dir + '|' + f;
      let c = cache.get(key);
      if (c) return c;
      const t0 = performance.now();
      renderer.setSize(W * ss, H * ss, false);
      cam.left = -BOX.ax; cam.right = BOX.w - BOX.ax; cam.top = BOX.ay; cam.bottom = -(BOX.h - BOX.ay);
      cam.updateProjectionMatrix();
      holder.scale.set(1, 1 / COS30, 1);
      yawer.rotation.y = dirYaw(dir);
      const ch = charFor(look, pbr);
      ch.update(anim, f / frames[anim]);
      renderer.render(scene, cam);
      c = finish(renderer.domElement, W, H, scale * dpr);
      cache.set(key, c);
      stats.sprites++; stats.ms += performance.now() - t0;
      return c;
    }
    function bakeAll() {
      for (const anim of Object.keys(frames)) for (let d = 0; d < 8; d++) for (let f = 0; f < frames[anim]; f++) get(anim, d, f);
    }
    return { get, bakeAll, frames, scale, W, H, stats, pbr };
  }

  return { renderer, scene, sheet, holder, U };
}

/** Downsample the supersampled render, add a soft contact blob and the game's ink outline. */
function finish(src, W, H, px) {
  const a = document.createElement('canvas');
  a.width = W; a.height = H;
  const x = a.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, W, H);
  // ink from the solid (character) pixels only, so the cast shadow isn't outlined
  const img = x.getImageData(0, 0, W, H);
  const d = img.data;
  const n = W * H;
  const mask = new ImageData(W, H);
  const m = mask.data;
  for (let i = 3; i < n * 4; i += 4) if (d[i] > 150) { m[i - 3] = 10; m[i - 2] = 8; m[i - 1] = 12; m[i] = 255; }
  const mc = document.createElement('canvas');
  mc.width = W; mc.height = H;
  mc.getContext('2d').putImageData(mask, 0, 0);
  const ink = document.createElement('canvas');
  ink.width = W; ink.height = H;
  const k = ink.getContext('2d');
  const r = Math.max(1, Math.round(px * 0.6));
  const steps = Math.max(8, Math.round(r * 6));
  for (let s = 0; s < steps; s++) {
    const a2 = (s / steps) * PI * 2;
    k.drawImage(mc, Math.round(Math.cos(a2) * r), Math.round(Math.sin(a2) * r));
  }
  k.globalAlpha = 1;
  k.drawImage(mc, 0, 0);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const o = out.getContext('2d');
  // contact blob under the feet
  const cx = BOX.ax * px, cy = BOX.ay * px;
  o.save();
  o.translate(cx, cy);
  o.scale(1, 0.42);
  const g = o.createRadialGradient(0, 0, 0, 0, 0, 17 * px);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = g;
  o.beginPath(); o.arc(0, 0, 17 * px, 0, PI * 2); o.fill();
  o.restore();
  o.globalAlpha = 0.92;
  o.drawImage(ink, 0, 0);
  o.globalAlpha = 1;
  o.drawImage(a, 0, 0);
  return out;
}

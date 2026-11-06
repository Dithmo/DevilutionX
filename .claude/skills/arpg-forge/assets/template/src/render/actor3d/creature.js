/**
 * Code-built 3D bodies for the non-humanoid silhouettes: crawler (4/6/8 legs), flier
 * (membrane wings or rotors), blob and turret. Same proportions and timing as the 2D puppet
 * (draw_actor.js crawler/flier/blob/turret), same rig interface as humanoid.js:
 *   { root, pose(sk, anim, f, prev, yaw), glows, occ, shadowR }
 * Units are the puppet's actor units (before SPECIAL_SCALE, which the baker applies).
 */
import * as THREE from '../../vendor/three.module.min.js';
import { A, PI, TAU, lerp, limb, ellipsoid, taperTube, placeSeg, manual, boxUV } from './parts.js';
import { ik, WALK_FRAMES, ATTACK_FRAMES } from '../draw_actor.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** A tinted copy of a withAO material (clone() drops the shader hook, so carry it over). */
function tint(src, color) {
  const m = src.clone();
  m.onBeforeCompile = src.onBeforeCompile;
  m.customProgramCacheKey = src.customProgramCacheKey;
  m.userData = { ...src.userData };
  if (color) m.color = color;
  if (m.sheenColor && color) m.sheenColor = color.clone().lerp(new THREE.Color(1, 0.85, 0.75), 0.35);
  return m;
}

function kit(root) {
  let seed = 11;
  const mesh = (g, m, parent = root, x = 0, y = 0, z = 0) => {
    if (m.userData && m.userData.tile && !m.userData.keepUV) g = boxUV(g, m.userData.tile, seed++);
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  return mesh;
}

export function buildCreature(L, M) {
  if (L.sil === 'crawler') return crawler(L, M);
  if (L.sil === 'flier') return flier(L, M);
  if (L.sil === 'blob') return blob(L, M);
  return turret(L, M);
}

/* ------------------------------------------------------------------ crawler */

function crawler(L, M) {
  const root = new THREE.Group();
  const mesh = kit(root);
  const n = Math.max(2, Math.min(4, Math.round(L.legs / 2)));
  const quad = n === 2;
  const skin = quad ? tint(M.hide, M.chitin.color.clone()) : M.chitin;
  const skinDark = tint(skin, skin.color.clone().multiplyScalar(0.72));
  const legLow = quad ? skinDark : tint(M.chitin, M.chitin.color.clone().lerp(new THREE.Color().copy(M.trimCloth.color), 0.6).multiplyScalar(0.6));
  const band = L.glow ? M.glow : tint(M.chitin, M.trimCloth.color.clone());
  const spineM = L.glow ? tint(M.chitin, M.trimCloth.color.clone().multiplyScalar(0.7)) : M.bone;

  const abdG = manual(root); const thG = manual(root); const headG = manual(root);
  const abR = quad ? [5.2, 7, 5] : [7.5, 9, 6.5];
  const thR = quad ? [5.8, 7.5, 5.4] : [5.6, 5.5, 4.8];
  const hdR = quad ? [3.8, 5, 3.4] : [3.6, 3.8, 3];
  // ellipsoid(rx, ry, rz): three x = side, y = up, z = forward
  mesh(ellipsoid(abR[0], abR[2], abR[1], 22, 16), skin, abdG);
  for (let i = -1; i <= 1; i++) {
    const fz = i * 3;
    const k = Math.sqrt(Math.max(0, 1 - (fz / abR[1]) ** 2));
    mesh(new THREE.TorusGeometry(1, 0.32 / Math.max(abR[0], abR[2]) * 2.4, 5, 24, PI).scale(abR[0] * k * 1.01, abR[2] * k * 1.01, 1), band, abdG, 0, 0, fz);
  }
  mesh(ellipsoid(thR[0], thR[2], thR[1], 20, 14), skin, thG);
  for (let i = 0; i < 4; i++) {
    const b = V3(0, thR[2] * 0.92 - Math.abs(i - 1) * 0.4, 4 - i * 3.6);
    mesh(taperTube([b, b.clone().add(V3(0, (3.2 - i * 0.4) * 0.6, -1.2)), b.clone().add(V3(0, 3.2 - i * 0.4, -2.2))], 1.1, 0.12, 6, 6), spineM, thG);
  }
  mesh(ellipsoid(hdR[0], hdR[2], hdR[1], 18, 12), skin, headG);
  const mand = [];
  for (const sd of [1, -1]) {
    const g = new THREE.Group();
    g.position.set(-sd * 1.8, -1.5, quad ? 3.5 : 2.6);
    headG.add(g);
    mesh(taperTube([V3(0, 0, 0), V3(-sd * 0.9, -0.3, 2), V3(-sd * 0.3, -0.8, 3.9)], 0.9, 0.12, 6, 8), M.bone, g);
    mand.push({ g, sd });
  }
  for (const sd of [1, -1]) {
    const e = mesh(new THREE.SphereGeometry(quad ? 0.85 : 0.75, 10, 8), M.eye, headG, -sd * 1.6, 1.2, quad ? 3.6 : 2.9);
    e.castShadow = false;
    if (!quad) mesh(new THREE.SphereGeometry(0.45, 8, 6), M.eye, headG, -sd * 0.7, 1.9, 3.2).castShadow = false;
  }
  if (quad) {
    for (const sd of [1, -1]) mesh(taperTube([V3(-sd * 2, 2.5, -1), V3(-sd * 2.6, 4.6, -2.2), V3(-sd * 3, 6, -3)], 1.15, 0.2, 6, 8), skinDark, headG);
  }
  const L1 = quad ? 7.5 : 9; const L2 = quad ? 7.5 : 11;
  const legs = [];
  for (let i = 0; i < n; i++) {
    for (const side of [1, -1]) {
      const up = manual(root); const lo = manual(root);
      mesh(limb(L1, quad ? 2.6 : 1.8, quad ? 1.9 : 1.4, 10), quad ? skin : skinDark, up);
      mesh(limb(L2, quad ? 1.8 : 1.4, quad ? 1.4 : 0.5, 10), legLow, lo);
      if (!quad) mesh(new THREE.SphereGeometry(0.9, 8, 6), L.glow ? M.glow : M.bone, lo);
      else mesh(ellipsoid(1.8, 1.0, 2.4, 10, 6), skinDark, lo, 0, -L2, 0.8);
      legs.push({ i, side, up, lo });
    }
  }

  const glows = []; const occ = [];
  function pose(sk, anim, f) {
    glows.length = 0; occ.length = 0;
    const walk = anim === 'walk';
    const ph = (f / WALK_FRAMES) * TAU;
    const atk = anim === 'attack' ? Math.sin((f / ATTACK_FRAMES) * PI) : 0;
    const hit = anim === 'hit' ? (f === 0 ? 1 : 0.5) : 0;
    const bodyZ = (quad ? 13 : 9) + (walk ? Math.abs(Math.sin(ph)) * 0.8 : 0) - (anim === 'death' ? (quad ? 5 : 4) * Math.min(1, f / 2) : 0);
    const lungeF = atk * 6 - hit * 2.5;
    const thorax = [0, 2 + lungeF, bodyZ + 1];
    const abdomen = [0, -9 + lungeF * 0.5, bodyZ + 0.5];
    const head = [0, (quad ? 13 : 11) + lungeF * 1.3, bodyZ + (quad ? 3.5 : 1.5) - atk * 2];
    const set = (g, p, pitch = 0) => { g.matrix.makeRotationX(pitch).setPosition(A(p)); g.matrixWorldNeedsUpdate = true; };
    set(abdG, abdomen, 0.06);
    set(thG, thorax);
    set(headG, head, atk * 0.25);
    for (const m of mand) m.g.rotation.y = m.sd * (atk * 0.5 - 0.1);
    for (const lg of legs) {
      const { i, side } = lg;
      const t = n === 1 ? 0 : i / (n - 1);
      const attachF = quad ? lerp(7, -8, t) : lerp(5, -6, t);
      const phase = ph + (i % 2 === 0 ? 0 : PI) + (side > 0 ? 0 : PI);
      const step = walk ? Math.sin(phase) * 4 : 0;
      const lift = walk ? Math.max(0, Math.cos(phase)) * 3 : 0;
      const hip = [side * (quad ? 4.5 : 4), attachF + lungeF * (1 - t * 0.5), bodyZ - (quad ? 1.5 : 0)];
      const foot = quad
        ? [side * 5.5, attachF + step + lungeF * (1 - t * 0.5) + (i === 0 ? atk * 4 : 0), lift + (i === 0 ? atk * 5 : 0)]
        : [side * (13 + (i === 0 ? 1 : 0)), attachF * 1.5 + step + lungeF * 0.5 + (i === 0 ? atk * 3 : 0), lift + (i === 0 ? atk * 7 : 0)];
      const knee = quad ? ik(hip, foot, L1, L2, [0, i === 0 ? -1 : 1, 0]) : ik(hip, foot, L1, L2, [side * 0.4, 0, 1]);
      placeSeg(lg.up, A(hip), A(knee), A([side, 0, 0]));
      placeSeg(lg.lo, A(knee), A(foot), A([0, 1, 0]));
      occ.push([A(knee), quad ? 2.2 : 1.6]);
    }
    occ.push([A(abdomen), Math.max(...abR) * 0.9], [A(thorax), Math.max(...thR) * 0.9], [A(head), Math.max(...hdR)]);
    if (L.glow) glows.push({ p: A(add3(head, [0, quad ? 4.5 : 3.4, 0])), r: 7, color: L.glow, a: 0.35, front: true });
  }
  return { root, pose, glows, occ, shadowR: quad ? 15 : 17 };
}

/* ------------------------------------------------------------------ flier */

function flier(L, M) {
  const root = new THREE.Group();
  const mesh = kit(root);
  const rotor = L.wings === 'rotor';
  const bodyG = manual(root);
  const hide = tint(M.hide, M.chitin.color.clone()); // hide in the body colour
  const skin = rotor ? M.paint : hide;
  mesh(ellipsoid(5, 4.6, 6.5, 22, 16), skin, bodyG);
  let headG = null;
  const rotors = [];
  const wings = [];
  if (!rotor) {
    headG = new THREE.Group();
    headG.position.set(0, 1.2, 5.5);
    bodyG.add(headG);
    mesh(ellipsoid(3.2, 3, 3, 16, 12), hide, headG);
    for (const sd of [1, -1]) {
      mesh(taperTube([V3(-sd * 1.8, 2, -0.5), V3(-sd * 2.4, 3.6, -0.9), V3(-sd * 2.6, 5, -1.2)], 1.05, 0.15, 6, 8), hide, headG);
      mesh(new THREE.SphereGeometry(0.6, 8, 6), M.eye, headG, -sd * 1.25, 0.6, 2.6).castShadow = false;
      mesh(new THREE.ConeGeometry(0.35, 1.4, 5).rotateX(PI), M.bone, headG, -sd * 0.8, -1.6, 2.3);
    }
    for (const side of [1, -1]) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(7 * 3), 3));
      geom.setIndex([0, 1, 6, 1, 5, 6, 1, 4, 5, 1, 3, 4, 1, 2, 3]);
      const mem = new THREE.Mesh(geom, M.membrane);
      mem.castShadow = true; mem.frustumCulled = false;
      root.add(mem);
      const bones = [manual(root), manual(root), manual(root)];
      mesh(limb(1, 0.75, 0.55, 6), hide, bones[0]);
      mesh(limb(1, 0.55, 0.25, 6), hide, bones[1]);
      mesh(limb(1, 0.4, 0.15, 6), hide, bones[2]);
      wings.push({ side, geom, bones });
    }
  } else {
    mesh(new THREE.TorusGeometry(5.1, 0.35, 5, 28).rotateX(PI / 2), L.glow ? M.glow : M.brass, bodyG, 0, 0, 0);
    mesh(new THREE.CylinderGeometry(1.1, 0.8, 7, 8).rotateX(PI / 2), M.dark, bodyG, 0, -4, 5.5);
    const eye = mesh(new THREE.SphereGeometry(1.6, 12, 8), M.eye, bodyG, 0, 0.5, 5.4);
    eye.castShadow = false;
    for (const side of [1, -1]) {
      for (const fo of [5, -5]) {
        const hub = V3(-side * 10, 1.5, fo);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 1, 6), M.dark);
        const from = V3(-side * 3, 0.5, fo * 0.4);
        const d = hub.clone().sub(from);
        arm.scale.set(1, d.length(), 1);
        arm.position.copy(from).addScaledVector(d, 0.5);
        arm.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
        arm.castShadow = true;
        bodyG.add(arm);
        mesh(new THREE.CylinderGeometry(1.8, 1.8, 2, 10), M.steel, bodyG, hub.x, hub.y, hub.z);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(7, 28).rotateX(-PI / 2), M.rotor);
        disc.position.set(hub.x, hub.y + 1.6, hub.z);
        disc.renderOrder = 5;
        bodyG.add(disc);
        mesh(new THREE.TorusGeometry(7, 0.18, 4, 32).rotateX(PI / 2), L.glow ? M.glow : M.trimCloth, bodyG, hub.x, hub.y + 1.6, hub.z).castShadow = false;
        const blade = mesh(new THREE.BoxGeometry(13, 0.2, 1.1), M.dark, bodyG, hub.x, hub.y + 1.4, hub.z);
        rotors.push(blade);
      }
    }
  }

  const glows = []; const occ = [];
  const P = (p) => A(p, V3());
  function pose(sk, anim, f) {
    glows.length = 0; occ.length = 0;
    const ph = (f / WALK_FRAMES) * TAU;
    const hover = Math.sin(ph) * 2.5;
    const atk = anim === 'attack' ? Math.sin((f / ATTACK_FRAMES) * PI) : 0;
    const z = anim === 'death' ? 6 : 24 + hover - atk * 5;
    const body = [0, atk * 6, z];
    bodyG.matrix.makeRotationX(atk * 0.35 + (rotor ? 0.12 : 0)).setPosition(A(body));
    bodyG.matrixWorldNeedsUpdate = true;
    for (let i = 0; i < rotors.length; i++) rotors[i].rotation.y = f * 0.9 + i * 1.3;
    const flapK = rotor ? 0 : [0.9, 0.5, -0.2, -0.7, -0.9, -0.4, 0.3, 0.8][(anim === 'death' ? 4 : f) % 8] * (anim === 'death' ? 0.3 : 1);
    for (const w of wings) {
      const s = w.side;
      const pts = [
        add3(body, [s * 3, -1, 1.5]),
        add3(body, [s * 11, -2, 1.5 + flapK * 9]),
        add3(body, [s * 19, -4, flapK * 15 - 1]),
        add3(body, [s * 17.5, -7.5, flapK * 11 - 2.5]), // scallop between tip and back1
        add3(body, [s * 15, -8, flapK * 8 - 2]),
        add3(body, [s * 10.5, -9, flapK * 5 - 2.5]), // scallop between back1 and back2
        add3(body, [s * 6, -6, flapK * 2 - 1]),
      ].map(P);
      const pa = w.geom.attributes.position;
      pts.forEach((p, k) => pa.setXYZ(k, p.x, p.y, p.z));
      pa.needsUpdate = true;
      w.geom.computeVertexNormals();
      w.geom.computeBoundingSphere();
      placeSeg(w.bones[0], pts[0], pts[1], V3(0, 1, 0)); w.bones[0].matrix.scale(V3(1, pts[0].distanceTo(pts[1]), 1));
      placeSeg(w.bones[1], pts[1], pts[2], V3(0, 1, 0)); w.bones[1].matrix.scale(V3(1, pts[1].distanceTo(pts[2]), 1));
      placeSeg(w.bones[2], pts[1], pts[4], V3(0, 1, 0)); w.bones[2].matrix.scale(V3(1, pts[1].distanceTo(pts[4]), 1));
    }
    occ.push([P(body), 5.2]);
    if (L.glow) glows.push({ p: P(add3(body, [0, rotor ? 5.6 : 8, rotor ? 0.5 : 1.8])), r: 8, color: L.glow, a: 0.4, front: true });
  }
  return { root, pose, glows, occ, shadowR: 10, shadowA: 0.35 };
}

/* ------------------------------------------------------------------ blob */

function blob(L, M) {
  const root = new THREE.Group();
  const mesh = kit(root);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), M.slime);
  shell.castShadow = true;
  shell.renderOrder = 2;
  root.add(shell);
  const inner = new THREE.Group();
  root.add(inner);
  const nucM = new THREE.MeshStandardMaterial({ color: M.trimCloth.color.clone(), emissive: M.trimCloth.color.clone().multiplyScalar(L.glow ? 1.4 : 0.8), roughness: 0.4 });
  const nucleus = mesh(new THREE.SphereGeometry(3.4, 18, 12), nucM, inner);
  const bubM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.35, clearcoat: 1 });
  const bubbles = [];
  for (let i = 0; i < 5; i++) bubbles.push(mesh(new THREE.SphereGeometry(0.8 + (i % 2) * 0.6, 10, 8), bubM, inner));
  const eyes = [];
  for (const sd of [1, -1]) {
    const e = new THREE.Mesh(ellipsoid(1.1, 1.5, 0.6, 12, 8), L.glow ? M.eye : M.void);
    root.add(e);
    eyes.push({ e, sd });
  }
  const glows = []; const occ = [];
  function pose(sk, anim, f) {
    glows.length = 0; occ.length = 0;
    const ph = (f / WALK_FRAMES) * TAU;
    const atk = anim === 'attack' ? Math.sin((f / ATTACK_FRAMES) * PI) : 0;
    const death = anim === 'death';
    const sq = anim === 'walk' ? Math.sin(ph) * 0.12 : (anim === 'cast' ? 0.1 : 0) - atk * 0.15;
    const melt = death ? [0.7, 0.5, 0.36, 0.3][f] || 0.3 : 1;
    const rx = 12 * (1 + sq) * (death ? 1 + (1 - melt) * 0.9 : 1);
    const rz = 10.5 * (1 - sq) * melt + atk * 3;
    const c = V3(0, rz * 0.82, atk * 4);
    shell.position.copy(c);
    shell.scale.set(rx, rz, rx);
    inner.position.copy(c);
    nucleus.position.set(Math.sin(ph) * 1.5, -1, 0);
    bubbles.forEach((b, i) => b.position.set(Math.cos(i * 2.1 + ph) * rx * 0.5, Math.sin(i * 2.7 + ph * 0.5) * rz * 0.42, Math.sin(i * 1.7) * 3));
    for (const { e, sd } of eyes) {
      e.visible = !death;
      // on the front surface of the ellipsoid
      const ex = sd * 2.4; const ey = rz * 0.25;
      const ez = rx * Math.sqrt(Math.max(0.05, 1 - (ex / rx) ** 2 - (ey / rz) ** 2));
      e.position.set(c.x + ex, c.y + ey, c.z + ez - 0.2);
    }
    occ.push([c.clone(), Math.min(rx, rz) * 0.7]);
    glows.push({ p: c.clone(), r: 16, color: L.glow || L.trim, a: L.glow ? 0.35 : 0.18 });
    return { shadowR: rx + 2 };
  }
  return { root, pose, glows, occ, shadowR: 14, rim: true };
}

/* ------------------------------------------------------------------ turret */

function turret(L, M) {
  const root = new THREE.Group();
  const mesh = kit(root);
  const base = new THREE.Group(); // counter-rotated: the plinth never turns
  root.add(base);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    const seg = manual(base);
    const top = V3(0, 9, 0); const ft = V3(-Math.cos(a) * 13, 0, Math.sin(a) * 13);
    mesh(limb(top.distanceTo(ft), 2.2, 1.4, 10), M.steel, seg);
    placeSeg(seg, top, ft, V3(0, 1, 0));
    mesh(new THREE.SphereGeometry(1.8, 10, 8), M.steel, base, ft.x, ft.y + 0.6, ft.z);
  }
  mesh(new THREE.CylinderGeometry(6, 6.4, 7, 8), M.paint, base, 0, 9.5, 0).rotation.y = PI / 8;
  mesh(new THREE.TorusGeometry(6.35, 0.3, 4, 24).rotateX(PI / 2), L.glow ? M.glow : M.brass, base, 0, 9, 0).castShadow = false;
  mesh(new THREE.CylinderGeometry(4.2, 5, 2.2, 16), M.steel, base, 0, 14, 0);
  const head = new THREE.Group();
  root.add(head);
  mesh(ellipsoid(6.2, 4.6, 6.8, 26, 16), M.paint, head);
  mesh(new THREE.TorusGeometry(1, 0.05, 4, 32).rotateX(PI / 2).scale(6.25, 1, 6.85), M.dark, head, 0, 0.5, 0);
  mesh(new THREE.CylinderGeometry(2, 2, 1.2, 12).rotateX(PI / 2), M.dark, head, 0, 1.2, 6.2);
  mesh(new THREE.SphereGeometry(1.5, 12, 8), M.eye, head, 0, 1.2, 6.6).castShadow = false;
  const barrels = [];
  for (const sd of [1, -1]) {
    const b = new THREE.Group();
    head.add(b);
    mesh(new THREE.CylinderGeometry(1.25, 1.45, 12, 10).rotateX(PI / 2), M.dark, b, -sd * 2.4, 0.5, 9);
    mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.6, 10).rotateX(PI / 2), M.steel, b, -sd * 2.4, 0.5, 14.4);
    mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.4, 8).rotateX(PI / 2), M.void, b, -sd * 2.4, 0.5, 15.1);
    barrels.push(b);
  }
  const flash = new THREE.Group();
  flash.position.set(0, 0.5, 17);
  head.add(flash);
  flash.add(new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), M.flash));
  flash.add(new THREE.Mesh(new THREE.ConeGeometry(2, 6, 7).rotateX(PI / 2).translate(0, 0, 3), M.flash));

  const glows = []; const occ = [];
  function pose(sk, anim, f, prev, yaw = 0) {
    glows.length = 0; occ.length = 0;
    base.rotation.y = -yaw;
    const fire = anim === 'attack' && (f === 2 || f === 3 || f === 5);
    const recoil = fire ? 1.5 : 0;
    head.position.set(0, 19, -recoil * 0.4);
    for (const b of barrels) b.position.z = -recoil;
    flash.visible = fire;
    occ.push([V3(0, 19, 0), 5], [V3(0, 9, 0), 5]);
    const eye = V3(0, 20.2, 6.6);
    glows.push({ p: eye, r: 7, color: L.glow || L.trim, a: 0.4, front: true });
    if (fire) glows.push({ p: V3(0, 19.5, 18), r: 24, color: L.glow || '#ffe0a0', a: 0.8 });
  }
  return { root, pose, glows, occ, shadowR: 15 };
}

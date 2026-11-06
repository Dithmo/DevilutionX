/**
 * Code-built 3D humanoid for the 'bulky' | 'lean' | 'robed' | 'tall' silhouettes.
 *
 * Built once per look from the same fields as the 2D puppet (armor, helm, weapon, offhand,
 * cloak, colours, glow) and posed per frame from draw_actor.humanoidSkeleton(), so both
 * renderers share one animation source. Limb meshes hang down -Y from their joint and are
 * placed with placeSeg(); torso and head parts sit in groups that follow the puppet's
 * upper-body transform U (twist + forward tilt).
 *
 * Space: three.js model space, +Y up, +Z the way the actor faces, +X its left.
 */
import * as THREE from '../../vendor/three.module.min.js';
import {
  A, PI, TAU, lerp, clamp01, lathe, limb, cone, shell, faceted, ellipsoid, bladeGeom, shieldGeom,
  roundShieldGeom, taperTube, lathePoints, rimGeom, boxUV, placeSeg, placeAlong, manual,
} from './parts.js';
import { BUILDS, BLADE_GLOW, weaponLen, wdir, U2dir } from '../draw_actor.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/**
 * @returns {{root:THREE.Group, pose:(sk:object, anim:string, f:number, prev?:object)=>void,
 *   glows:Array, occ:Array, shadowR:number}}
 */
export function buildHumanoid(L, M) {
  const B = BUILDS[L.sil];
  const robe = L.sil === 'robed';
  const plate = L.armor === 'plate';
  const leathers = L.armor === 'light';
  const bare = L.armor === 'none';
  const tech = L.style === 'tech'; // sci-fi kit: see header of techHead / buildWeapon
  const bareLegs = bare && !tech; // tech brutes wear trousers and boots
  const up = B.shZ - B.waistZ;
  const root = new THREE.Group();
  let uvSeed = 1;
  const mesh = (g, m, parent, x = 0, y = 0, z = 0) => {
    if (!Array.isArray(m) && m.userData && m.userData.tile && !m.userData.keepUV) g = boxUV(g, m.userData.tile, uvSeed++);
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const rim = (parent, lp, tube = 0.3, mat = M.edge) => mesh(rimGeom(lp, tube), mat, parent);
  const glowOn = !!L.glow;
  const trimGlow = glowOn ? M.glow : M.brass;

  /* ------------------------------------------------ groups placed every pose */
  const pelvisG = manual(root);
  const torsoG = manual(root);
  const headG = manual(root);
  const seg = {};
  for (const s of ['L', 'R']) for (const n of ['thigh', 'shin', 'foot', 'upper', 'fore', 'hand']) seg[n + s] = manual(root);
  const weaponG = manual(root);
  const offG = manual(root);

  /* ------------------------------------------------ torso */
  const rw = B.waist[0]; const rc = B.chest[0]; const zs = B.chest[1] / B.chest[0];
  const torsoProf = (k = 1, fat = 0) => [
    [rw * 0.98 * k + fat, -3.5], [rw * 1.02 * k + fat, 0], [lerp(rw, rc, 0.55) * k + fat * 0.5, up * 0.3], [rc * k, up * 0.58],
    [rc * 0.98 * k, up * 0.74], [rc * 0.86 * k, up * 0.88], [rc * 0.58 * k, up * 0.98], [rc * 0.4 * k, up * 1.02],
  ];
  if (plate) {
    const cu = lathe(torsoProf(), 30, zs);
    const p = cu.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
      if (z > 0) p.setZ(i, z + 1.5 * Math.max(0, 1 - Math.abs(x) / (rc * 0.5)) * clamp01((y + 2) / (up * 0.45)) * clamp01((up - y) / (up * 0.25)));
    }
    cu.computeVertexNormals();
    mesh(cu, M.plate, torsoG);
    rim(torsoG, lathePoints(rw * 0.99, -3.5, zs), 0.38);
    mesh(faceted(lathe([[rw * 1.04, -3.1], [rw * 1.09, 0.6], [lerp(rw, rc, 0.4) * 1.07, up * 0.26]], 18, zs, -PI * 0.33, PI * 0.66)), M.steel, torsoG);
    rim(torsoG, lathePoints(lerp(rw, rc, 0.4) * 1.07, up * 0.26, zs, -PI * 0.33, PI * 0.66, 18), 0.28);
    if (tech) {
      // chest core light and two light strips down the front of the shell
      mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.8, 6).rotateX(PI / 2), M.edge, torsoG, 0, up * 0.6, rc * zs + 1.1);
      mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.5, 6).rotateX(PI / 2), M.neon, torsoG, 0, up * 0.6, rc * zs + 1.5);
      for (const sx of [1, -1]) {
        const st = mesh(new THREE.BoxGeometry(0.4, up * 0.42, 0.4), M.neon, torsoG, sx * rc * 0.55, up * 0.42, rc * zs * 0.8 + 0.2);
        st.rotation.y = sx * 0.6;
      }
      // sealed collar
      mesh(lathe([[rc * 0.56, up * 0.86], [rc * 0.5, up * 0.98], [rc * 0.4, up * 1.1], [rc * 0.4, up * 1.2]], 18, 0.85), M.edge, torsoG);
      rim(torsoG, lathePoints(rc * 0.41, up * 1.2, 0.85), 0.24, M.neon);
    } else {
      for (const rx of [-0.42, 0.42]) mesh(new THREE.SphereGeometry(0.5, 8, 6), M.brass, torsoG, rx * rw, up * 0.12, rw * zs * 1.12);
      // gorget
      mesh(lathe([[rc * 0.56, up * 0.86], [rc * 0.52, up * 0.98], [rc * 0.36, up * 1.08], [rc * 0.34, up * 1.14]], 18, 0.85), M.steel, torsoG);
      rim(torsoG, lathePoints(rc * 0.345, up * 1.14, 0.85), 0.26);
      rim(torsoG, lathePoints(rc * 0.565, up * 0.86, 0.85), 0.28);
    }
    for (const sx of [1, -1]) mesh(new THREE.BoxGeometry(2, 0.7, rc * zs * 1.8), M.leather, torsoG, sx * rc * 0.6, up * 0.94, 0);
  } else if (leathers) {
    mesh(lathe(torsoProf(0.97, 0.3), 26, zs), M.jerkin, torsoG);
    mesh(new THREE.TorusGeometry(rc * 0.42, 0.7, 6, 20).rotateX(PI / 2).scale(1, 1, 0.85), M.leather, torsoG, 0, up * 1.0, 0);
    if (tech) {
      // tactical vest: magazine pouches, a radio on the chest, a light strip
      const zf = lerp(rw, rc, 0.5) * zs + 0.6;
      for (let k = -1; k <= 1; k++) {
        const pch = mesh(new THREE.BoxGeometry(2.3, 3.4, 1.5), M.leather, torsoG, k * rc * 0.36, up * 0.34, zf);
        pch.rotation.y = k * 0.35;
        mesh(new THREE.BoxGeometry(2.4, 0.7, 1.6), M.dark, pch, 0, 1.5, 0.05);
      }
      mesh(new THREE.BoxGeometry(1.8, 2.6, 1.2), M.dark, torsoG, rc * 0.42, up * 0.7, rc * zs * 0.82 + 0.4).rotation.y = 0.5;
      mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), M.neon, torsoG, rc * 0.42, up * 0.82, rc * zs * 0.82 + 1.0);
      mesh(new THREE.BoxGeometry(0.35, up * 0.5, 0.35), M.neon, torsoG, -rc * 0.6, up * 0.5, rc * zs * 0.72 + 0.25).rotation.y = -0.65;
    }
    // studs in rows on the chest and back
    if (!tech) for (let r = 0; r < 3; r++) for (let k = -2; k <= 2; k++) {
      const y = up * (0.2 + r * 0.2);
      const t = (y / up);
      const rr = lerp(rw, rc, clamp01(t / 0.58)) * 0.97 + 0.35;
      for (const back of [0, PI]) {
        const ph = back + k * 0.32;
        mesh(new THREE.SphereGeometry(0.42, 6, 5), M.steel, torsoG, rr * Math.sin(ph), y, rr * Math.cos(ph) * zs);
      }
    }
    // cross strap
    mesh(new THREE.BoxGeometry(1.6, up * 1.15, 0.6).rotateZ(0.55), M.leather, torsoG, 0, up * 0.5, rc * zs * 0.96);
  } else if (bare) {
    const ch = lathe(torsoProf(1.0, 0.4), 26, zs);
    const p = ch.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
      // pectorals and a shallow centre line
      if (z > 0) {
        const pec = Math.exp(-((Math.abs(x) - rc * 0.42) ** 2) / (rc * rc * 0.08) - ((y - up * 0.66) ** 2) / (up * up * 0.03));
        const line = Math.exp(-(x * x) / 0.8) * clamp01(1 - Math.abs(y - up * 0.4) / (up * 0.5));
        p.setZ(i, z + 1.3 * pec - 0.5 * line);
      }
    }
    ch.computeVertexNormals();
    mesh(ch, M.hide, torsoG);
    if (tech) {
      for (let i = 0; i < 4; i++) {
        mesh(new THREE.BoxGeometry(2.0, 1.4, 1.2), M.steel, torsoG, 0, up * (0.25 + i * 0.2), -rc * zs * 0.95 - 0.3);
        mesh(new THREE.BoxGeometry(0.6, 0.4, 0.4), M.neon, torsoG, 0, up * (0.25 + i * 0.2), -rc * zs * 0.95 - 0.95);
      }
      // harness strap
      mesh(new THREE.BoxGeometry(1.4, up * 1.15, 0.5).rotateZ(-0.55), M.leather, torsoG, 0, up * 0.5, rc * zs * 0.98 + 0.9);
    }
  } else {
    // cloth tunic (and the robe's upper body)
    mesh(lathe(torsoProf(robe ? 1.02 : 1.0, robe ? 0.8 : 0.4), 26, zs), M.cloth, torsoG);
    // collar / stole down the front
    if (tech) {
      mesh(lathe([[rc * 0.5, up * 0.9], [rc * 0.47, up * 1.05], [rc * 0.46, up * 1.2]], 20, 0.9, PI * 0.18, PI * 1.64), M.trimCloth, torsoG);
      rim(torsoG, lathePoints(rc * 0.47, up * 1.2, 0.9, PI * 0.18, PI * 1.64, 20), 0.22, M.neon);
      // asymmetric light seam across the chest
      const sm = mesh(new THREE.BoxGeometry(0.35, up * 0.7, 0.35), M.neon, torsoG, rc * 0.2, up * 0.55, rc * zs * 0.98 + 0.5);
      sm.rotation.z = -0.5;
      if (robe) mesh(lathe(torsoProf(1.05, 0.9).slice(1), 4, zs, -0.08, 0.16), M.dark, torsoG);
    } else {
      mesh(new THREE.TorusGeometry(rc * 0.44, 0.65, 6, 20).rotateX(PI / 2).scale(1, 1, 0.9), M.trimCloth, torsoG, 0, up * 0.99, 0);
      if (robe) mesh(lathe(torsoProf(1.05, 0.9).slice(1), 4, zs, -0.22, 0.44), M.trimCloth, torsoG);
    }
  }
  // hood mantle over the shoulders
  if (L.helm === 'hood') {
    mesh(lathe([[rc * 0.42, up * 1.12], [rc * 0.78, up * 1.0], [rc * 1.02, up * 0.84], [rc * 1.08, up * 0.68]], 22, zs * 1.05), M.hoodCloth || M.cloak, torsoG);
  }

  /* ------------------------------------------------ pelvis, belt, fauld */
  const hipH = B.waistZ - B.hipZ; // waist above the hip joints
  const hipR = (B.hipW + B.legR[0]) * 0.98;
  mesh(lathe([[0.1, -4.5], [hipR * 0.8, -4.2], [hipR, -1.5], [rw * 1.02, hipH * 0.6], [rw, hipH + 0.5]], 20, zs), plate ? M.mail : (bareLegs ? M.hide : M.under), pelvisG);
  if (!robe) {
    mesh(new THREE.TorusGeometry(rw * 1.04, 0.95, 8, 24).rotateX(PI / 2).scale(1, 1, zs * 1.04), M.leather, pelvisG, 0, hipH + 0.2, 0);
    mesh(new THREE.BoxGeometry(2.4, 2.2, 1), tech ? M.dark : M.brass, pelvisG, 0, hipH + 0.2, rw * zs * 1.05 + 0.6);
    if (tech) {
      mesh(new THREE.BoxGeometry(1.4, 0.5, 0.4), M.neon, pelvisG, 0, hipH + 0.2, rw * zs * 1.05 + 1.15);
      for (const sx of [1, -1]) mesh(new THREE.BoxGeometry(1.6, 3.2, 2.6), M.leather, pelvisG, sx * rw * 1.08, hipH - 1.6, 0.4);
    }
  } else {
    mesh(new THREE.TorusGeometry(rw * 1.12, 0.6, 6, 22).rotateX(PI / 2).scale(1, 1, zs * 1.04), M.trimCloth, pelvisG, 0, hipH + 0.2, 0);
  }
  if (plate) {
    for (let i = 0; i < 3; i++) {
      const y = hipH - 1.2 - i * 2.4;
      const r0 = rw * 1.07 + i * 0.55;
      mesh(faceted(lathe([[r0, y], [r0 + 0.6, y - 2.6]], 20, zs * 1.04, -PI * 0.42, PI * 0.84)), i % 2 ? M.steel : M.plate, pelvisG);
      rim(pelvisG, lathePoints(r0 + 0.62, y - 2.6, zs * 1.04, -PI * 0.42, PI * 0.84, 20), 0.28);
      if (!tech) for (const ph of [-0.3 * PI, 0, 0.3 * PI]) {
        const rr = r0 + 0.45;
        mesh(new THREE.SphereGeometry(0.4, 6, 5), M.brass, pelvisG, rr * Math.sin(ph), y - 1.0, rr * Math.cos(ph) * zs * 1.04 + 0.15);
      }
    }
  } else if (leathers) {
    for (const sx of [1, -1]) {
      const t = mesh(new THREE.BoxGeometry(4.2, 6, 0.7), M.jerkin, pelvisG, sx * rw * 0.5, hipH - 4.2, rw * zs + 0.6);
      t.rotation.set(-0.12, sx * 0.35, 0);
    }
    mesh(lathe([[rw * 1.05, hipH - 0.5], [rw * 1.25, hipH - 6]], 16, zs, PI * 0.6, PI * 0.8), M.jerkin, pelvisG);
  } else if (L.armor === 'cloth' && !robe) {
    mesh(cone(10, rw * 1.06, hipR * 1.4, 20, zs * 1.1), M.cloth, pelvisG, 0, hipH, 0);
    mesh(new THREE.TorusGeometry(hipR * 1.38, 0.4, 5, 22).rotateX(PI / 2).scale(1, 1, zs * 1.1), M.trimCloth, pelvisG, 0, hipH - 10, 0);
  } else if (bareLegs) {
    for (const [z, rot] of [[rw * zs + 0.4, -0.08], [-rw * zs - 0.4, 0.08]]) {
      const flap = mesh(new THREE.BoxGeometry(5.5, 9, 0.5), M.trimCloth, pelvisG, 0, hipH - 4.5, z);
      flap.rotation.x = rot;
    }
  }

  /* ------------------------------------------------ legs */
  const [lr0, lr1] = B.legR;
  for (const s of ['L', 'R']) {
    const th = seg['thigh' + s]; const sh = seg['shin' + s]; const ft = seg['foot' + s];
    if (plate) {
      mesh(limb(B.thigh, lr0, lr0 * 0.82), M.mail, th);
      mesh(shell(B.thigh * 0.8, lr0 * 1.1, lr0 * 0.93, -1), M.plate, th);
      rim(th, lathePoints(lr0 * 1.1 * 0.93, -0.7, 1, -PI * 0.625, PI * 1.25, 16));
      rim(th, lathePoints(lr0 * 0.93 * 0.93, -1 - B.thigh * 0.8 - 0.3, 1, -PI * 0.625, PI * 1.25, 16));
      mesh(ellipsoid(lr0 * 0.62, lr0 * 0.6, lr0 * 0.5, 12, 9), M.steel, sh, 0, 0.3, lr0 * 0.55);
      mesh(new THREE.ConeGeometry(lr0 * 0.55, 1.1, 10).rotateX(PI / 2).scale(1.4, 1, 1), M.steel, sh, 0, 0.3, lr0 * 0.75);
      mesh(limb(B.shin, lr1 * 1.08, lr1 * 0.82), M.plate, sh);
      mesh(new THREE.TorusGeometry(lr1 * 1.03, tech ? 0.25 : 0.4, 5, 16).rotateX(PI / 2), tech ? M.neon : M.leather, sh, 0, -B.shin * 0.25, 0);
    } else {
      mesh(limb(B.thigh, lr0, lr0 * 0.82), bareLegs ? M.hide : M.under, th);
      if (tech && !bareLegs) mesh(ellipsoid(lr0 * 0.6, lr0 * 0.62, lr0 * 0.42, 10, 8), M.edge, sh, 0, 0.2, lr0 * 0.6);
      if (bareLegs) mesh(limb(B.shin, lr1, lr1 * 0.75), M.hide, sh);
      else {
        const bootTop = leathers ? 0.2 : 0.55;
        mesh(limb(B.shin, lr1, lr1 * 0.78), M.under, sh);
        mesh(lathe([[lr1 * 1.12, -B.shin * bootTop], [lr1 * 1.02, -B.shin * (bootTop + 0.12)], [lr1 * 0.9, -B.shin - 0.4]], 14), M.leather, sh);
        if (leathers) mesh(ellipsoid(lr0 * 0.55, lr0 * 0.6, lr0 * 0.4, 10, 8), M.leather, sh, 0, 0, lr0 * 0.55);
      }
    }
    // foot: origin at the ankle, sole at y = -2.2
    const fs = lr1 / 3.3;
    if (tech && !bareLegs) {
      // chunky boots with a moulded sole and a heel light
      mesh(ellipsoid(2.5 * fs, 2.0, 4.1 * fs, 14, 9), plate ? M.plate : M.leather, ft, 0, -0.7, 1.4);
      mesh(new THREE.BoxGeometry(4.8 * fs, 1.0, 8.8 * fs), M.dark, ft, 0, -1.8, 1.6);
      mesh(new THREE.BoxGeometry(3.0 * fs, 0.35, 0.3), M.neon, ft, 0, -1.6, 1.6 - 4.4 * fs);
    } else if (plate) {
      mesh(ellipsoid(2.6 * fs, 2.0, 4.0 * fs, 14, 9), M.steel, ft, 0, -0.6, 1.4);
      mesh(new THREE.SphereGeometry(1, 12, 7, 0, TAU, 0, PI / 2).scale(2.1 * fs, 1.4, 2.4 * fs), M.steel, ft, 0, -1.2, 4.3 * fs);
      for (let k = 0; k < 3; k++) mesh(new THREE.TorusGeometry(2.3 * fs - k * 0.25, 0.22, 4, 12, PI).rotateY(PI / 2).rotateZ(PI / 2), M.dark, ft, 0, -0.5 - k * 0.2, 2.0 + k * 1.1);
      mesh(new THREE.BoxGeometry(4.8 * fs, 0.7, 8.4 * fs), M.leather, ft, 0, -1.95, 1.6);
    } else if (bareLegs) {
      mesh(ellipsoid(2.2 * fs, 1.5, 3.6 * fs, 12, 8), M.hide, ft, 0, -1.0, 1.6);
      for (const tx of [-1, 0, 1]) mesh(taperTube([V3(tx * 1.1 * fs, -1.2, 4.4 * fs), V3(tx * 1.3 * fs, -1.6, 5.8 * fs), V3(tx * 1.4 * fs, -2.2, 6.6 * fs)], 0.45, 0.05, 5, 5), M.bone, ft);
    } else {
      mesh(ellipsoid(2.4 * fs, 1.9, 4.0 * fs, 12, 8), M.leather, ft, 0, -0.8, 1.4);
      mesh(new THREE.BoxGeometry(4.4 * fs, 0.6, 8.0 * fs), M.dark, ft, 0, -1.95, 1.5);
    }
  }

  /* ------------------------------------------------ skirt (robe), rebuilt every pose */
  let skirt = null;
  const SKN = 22; const SKR = 9;
  if (robe) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((SKN + 1) * (SKR + 1) * 3);
    const uv = new Float32Array((SKN + 1) * (SKR + 1) * 2);
    const idx = [];
    for (let r = 0; r <= SKR; r++) for (let q = 0; q <= SKN; q++) {
      uv[(r * (SKN + 1) + q) * 2] = q / SKN;
      uv[(r * (SKN + 1) + q) * 2 + 1] = 1 - r / SKR;
    }
    for (let r = 0; r < SKR; r++) for (let q = 0; q < SKN; q++) {
      const a = r * (SKN + 1) + q; const b = a + 1; const c = a + SKN + 1; const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    skirt = new THREE.Mesh(g, M.robe);
    skirt.castShadow = skirt.receiveShadow = true;
    skirt.frustumCulled = false;
    root.add(skirt);
  }
  function updateSkirt(sk) {
    const p = skirt.geometry.attributes.position;
    const top = sk.waistZ + 0.5;
    const hemY = 1.0;
    const rTop = rw * 1.08; const rHem = B.hipW * 2 + 5.5;
    const [lg0, lg1] = sk.legs; // 0 = right (+s), 1 = left
    const zAt = (lg, t) => (t < 0.5 ? lerp(lg.hip[1], lg.knee[1], t / 0.5) : lerp(lg.knee[1], lg.ankle[1], (t - 0.5) / 0.5));
    let i = 0;
    for (let r = 0; r <= SKR; r++) {
      const t = r / SKR;
      const y = lerp(top, hemY, t);
      const rad = lerp(rTop, rHem, Math.pow(t, 0.8));
      const zR = zAt(lg0, t); const zL = zAt(lg1, t);
      const fwd = Math.max(zR, zL, 0);
      for (let q = 0; q <= SKN; q++) {
        const ph = (q / SKN) * TAU;
        const sx = Math.sin(ph); const cz = Math.cos(ph);
        const side = (sx + 1) / 2; // 1 = left (+X)
        let z = cz * rad * zs * 1.05 + lerp(zR, zL, side) * Math.min(1, t * 1.3) * 0.85 + sk.rootF * 0.4;
        if (cz > 0) z += fwd * 0.45 * cz * t;
        const fold = Math.sin(ph * 7) * 0.45 * t;
        p.setXYZ(i++, sx * (rad + fold), y, z + fold * cz * 0.5);
      }
    }
    p.needsUpdate = true;
    skirt.geometry.computeVertexNormals();
    skirt.geometry.computeBoundingSphere();
  }

  /* ------------------------------------------------ arms and hands */
  const [ar0, ar1] = B.armR;
  for (const s of ['L', 'R']) {
    const ua = seg['upper' + s]; const fa = seg['fore' + s]; const hd = seg['hand' + s];
    if (plate) {
      mesh(limb(B.arm[0], ar0, ar0 * 0.85), M.mail, ua);
      mesh(shell(B.arm[0] * 0.62, ar0 * 1.09, ar0 * 0.97, -3.2, PI * 1.5), M.plate, ua);
      rim(ua, lathePoints(ar0 * 0.97 * 0.93, -3.2 - B.arm[0] * 0.62 - 0.3, 1, -PI * 0.75, PI * 1.5, 16));
      mesh(ellipsoid(ar0 * 0.66, ar0 * 0.62, ar0 * 0.7, 12, 9), M.plate, fa, 0, 0, -ar0 * 0.3);
      mesh(new THREE.ConeGeometry(ar0 * 0.66, 1.2, 10).rotateX(-PI / 2), M.plate, fa, 0, 0, -ar0 * 0.55);
      mesh(limb(B.arm[1], ar1 * 1.03, ar1 * 0.84), M.plate, fa);
      mesh(lathe([[ar1 * 0.9, -B.arm[1] * 0.62], [ar1 * 1.25, -B.arm[1] * 0.83], [ar1 * 1.03, -B.arm[1] * 0.9]], 14), M.steel, fa);
      if (tech) mesh(new THREE.TorusGeometry(ar1 * 1.15, 0.22, 4, 14).rotateX(PI / 2), M.neon, fa, 0, -B.arm[1] * 0.72, 0);
    } else if (bare && tech) {
      // cybernetic forearms: gunmetal limb, piston, light at the wrist and the shoulder socket
      mesh(limb(B.arm[0], ar0 * 1.1, ar0 * 0.85), M.hide, ua);
      mesh(new THREE.TorusGeometry(ar0 * 1.0, 0.3, 5, 14).rotateX(PI / 2), M.steel, ua, 0, -B.arm[0] * 0.75, 0);
      mesh(limb(B.arm[1], ar1 * 1.12, ar1 * 0.88), M.steel, fa);
      mesh(new THREE.CylinderGeometry(0.4, 0.4, B.arm[1] * 0.7, 6), M.dark, fa, ar1 * 0.7, -B.arm[1] * 0.45, -ar1 * 0.5);
      mesh(new THREE.TorusGeometry(ar1 * 0.95, 0.22, 4, 14).rotateX(PI / 2), M.neon, fa, 0, -B.arm[1] * 0.85, 0);
      mesh(new THREE.TorusGeometry(ar1 * 1.05, 0.18, 4, 14).rotateX(PI / 2), M.neon, fa, 0, -B.arm[1] * 0.3, 0);
    } else if (robe && tech) {
      // techwear sleeves: fitted, a cuff with a light line
      mesh(limb(B.arm[0] + 0.5, ar0 * 1.15, ar0 * 0.95), M.cloth, ua, 0, 0.5, 0);
      mesh(limb(B.arm[1], ar1 * 1.2, ar1 * 1.0), M.cloth, fa);
      mesh(lathe([[ar1 * 1.25, -B.arm[1] * 0.55], [ar1 * 1.35, -B.arm[1] * 0.8], [ar1 * 1.15, -B.arm[1] * 0.92]], 12), M.dark, fa);
      mesh(new THREE.TorusGeometry(ar1 * 1.32, 0.2, 4, 14).rotateX(PI / 2), M.neon, fa, 0, -B.arm[1] * 0.68, 0);
    } else if (robe) {
      mesh(cone(B.arm[0] + 1, ar0 * 1.15, ar0 * 1.55, 14), M.cloth, ua, 0, 0.6, 0);
      mesh(limb(B.arm[1], ar1, ar1 * 0.8), M.skin, fa);
      mesh(cone(B.arm[1] * 0.78, ar0 * 1.45, ar1 * 2.5, 16), M.cloth, fa, 0, 0.5, 0);
      mesh(new THREE.TorusGeometry(ar1 * 2.45, 0.38, 5, 18).rotateX(PI / 2), M.trimCloth, fa, 0, 0.5 - B.arm[1] * 0.78, 0);
    } else {
      const sleeve = bare ? M.hide : (leathers ? M.under : M.cloth);
      mesh(limb(B.arm[0], ar0 * (bare ? 1.1 : 1), ar0 * 0.85), sleeve, ua);
      mesh(limb(B.arm[1], ar1 * (bare ? 1.08 : 1), ar1 * 0.8), bare ? M.hide : (leathers ? M.jerkin : M.cloth), fa);
      if (leathers) mesh(lathe([[ar1 * 1.12, -B.arm[1] * 0.35], [ar1 * 1.15, -B.arm[1] * 0.6], [ar1 * 1.0, -B.arm[1] * 0.92]], 12), M.leather, fa);
    }
    // fist: origin at the grip point, -Y runs along the forearm
    const fistM = plate ? M.steel : (leathers ? M.leather : (bare ? (tech ? M.steel : M.hide) : (tech ? M.leather : M.skin)));
    mesh(ellipsoid(ar1 * 0.68, ar1 * 0.78, ar1 * 0.74, 12, 9), fistM, hd, 0, 0.2, 0);
    if (plate) for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(0.8, 0.8, 1.3), M.dark, hd, 0, -0.9 + k * 0.7, ar1 * 0.5);
  }
  // pauldrons: children of the torso so a raised arm doesn't swallow them
  const paul = {};
  if (plate || leathers) {
    const k = B.pauld / 7.2;
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      const pa = new THREE.Group();
      pa.position.set(sx * (B.sh - 1.2 * k), up - 1.5 + 1.8 * k, -0.3);
      torsoG.add(pa);
      paul[s] = pa;
      const n = tech ? (plate ? 2 : 1) : (plate ? 3 : 1);
      for (let i = 0; i < n; i++) {
        const r = (6.4 + i * 0.5) * k * (tech && !plate ? 0.8 : 1);
        const th = PI * 0.42 + i * 0.05;
        // tech: hard-edged moulded pads instead of rounded lames
        const g = tech
          ? faceted(new THREE.SphereGeometry(r, 7, 3, 0, TAU, 0, th).scale(1, 0.55, 1.02))
          : new THREE.SphereGeometry(r, 16, 9, 0, TAU, 0, th).scale(1, 0.62, 1.02);
        const m = mesh(g, plate ? (i === 1 ? M.steel : M.plate) : M.leather, pa, sx * (1.2 + i * 0.9) * k, -i * 1.9 * k, 0);
        m.rotation.z = -sx * (0.35 + i * 0.18);
        if (tech) {
          if (i === 0) rim(m, lathePoints(r * Math.sin(th), r * Math.cos(th) * 0.55, 1.02, PI * 0.1, PI * 0.8, 10), 0.24, M.neon);
        } else if (plate) rim(m, lathePoints(r * Math.sin(th), r * Math.cos(th) * 0.62, 1.02), 0.34);
        else mesh(new THREE.TorusGeometry(r * Math.sin(th), 0.25, 4, 20).rotateX(PI / 2).scale(1, 1, 1.02), glowOn ? M.glow : M.trimCloth, m, 0, r * Math.cos(th) * 0.62, 0);
      }
      if (!tech) mesh(new THREE.SphereGeometry(0.55, 7, 5), M.brass, pa, sx * 3.4 * k, 0.6 * k, 3.0 * k);
    }
  }

  /* ------------------------------------------------ cloak (rebuilt every pose) */
  let cloak = null;
  const CW = 9; const CH = 12;
  const cloakLen = L.cloak === 'long' ? B.shZ * 0.84 : (L.cloak === 'tattered' ? B.shZ * 0.78 : B.shZ * 0.56);
  if (L.cloak !== 'none' && !robe) {
    cloak = mesh(new THREE.PlaneGeometry(1, 1, CW, CH), M.cloak, torsoG);
    cloak.frustumCulled = false;
    if (tech) {
      // stand-up coat collar, open at the front
      mesh(lathe([[rc * 0.62, up * 0.86], [rc * 0.6, up * 1.05], [rc * 0.66, up * 1.3]], 22, 0.95, PI * 0.28, PI * 1.44), M.coat, torsoG);
    } else for (const sx of [1, -1]) mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.6, 10).rotateX(PI / 2), M.brass, torsoG, sx * rc * 0.62, up * 0.93, rc * zs * 0.82);
  }
  function updateCloak(phase, drag, gust) {
    const p = cloak.geometry.attributes.position;
    const w0 = B.sh * 0.95; const w1 = B.sh * 1.45;
    const back0 = -(B.chest[1] + 0.4);
    let i = 0;
    for (let r = 0; r <= CH; r++) {
      const t = r / CH;
      for (let q = 0; q <= CW; q++) {
        const u = q / CW - 0.5;
        let x = u * 2 * lerp(w0, w1, t);
        const y = up - 0.6 - t * cloakLen + 2.0 * u * u * t;
        let z = back0 - 1.2 * t - drag * t * t * 7 + 8 * u * u * (1 - 0.3 * t) * (t < 0.15 ? t / 0.15 : 1);
        if (t < 0.12) z = lerp(-1.2 + 3.5 * u * u, z, t / 0.12);
        z += Math.sin(phase * 2 - t * 3.2 + u * 2.4) * t * t * (1.3 + gust * 2);
        x += Math.sin(phase * 2 - t * 2.5) * t * t * 1.4 * gust;
        z += Math.sin(u * PI * 7) * (0.5 + 1.1 * t) * (0.4 + t);
        p.setXYZ(i++, x, y, z);
      }
    }
    p.needsUpdate = true;
    cloak.geometry.computeVertexNormals();
  }

  /* ------------------------------------------------ head and helm (origin = head centre) */
  const r = B.head;
  const faceShown = tech
    ? ['open', 'bare', 'mask', 'goggles'].includes(L.helm)
    : (L.helm === 'open' || L.helm === 'bare' || L.helm === 'hood');
  if (tech) techHead(L, M, mesh, rim, headG, r, glowOn);
  else if (faceShown) {
    const hooded = L.helm === 'hood';
    mesh(ellipsoid(r * 0.9, r * 0.98, r * 0.9, 16, 12), hooded ? M.void : M.skin, headG);
    if (!hooded) {
      mesh(ellipsoid(r * 0.16, r * 0.24, r * 0.2, 8, 6), M.skin, headG, 0, -r * 0.15, r * 0.86);
      for (const sx of [1, -1]) {
        mesh(new THREE.BoxGeometry(r * 0.34, r * 0.1, r * 0.12), M.hair, headG, sx * r * 0.34, r * 0.24, r * 0.8);
        mesh(ellipsoid(r * 0.12, r * 0.18, r * 0.12, 6, 5), M.skin, headG, sx * r * 0.88, 0, 0);
      }
    }
    for (const sx of [1, -1]) mesh(new THREE.SphereGeometry(r * (hooded ? 0.09 : 0.11), 8, 6), hooded && !glowOn ? M.eye : (glowOn ? M.glow : M.void), headG, sx * r * 0.33, r * 0.05, r * 0.8);
  }
  if (tech) {
    // built by techHead
  } else if (L.helm === 'bare') {
    mesh(new THREE.SphereGeometry(r * 0.96, 16, 10, PI * 0.15, PI * 1.7, 0, PI * 0.55).rotateY(PI), M.hair, headG, 0, r * 0.06, -r * 0.04);
  } else if (L.helm === 'hood') {
    const g = lathe([[r * 0.95, -r * 1.1], [r * 1.25, -r * 0.4], [r * 1.3, r * 0.3], [r * 1.12, r * 0.95], [r * 0.6, r * 1.3], [0.01, r * 1.38]], 22, 1.05, PI * 0.3, PI * 1.4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i); const z = p.getZ(i);
      if (z < 0 && y > 0) { p.setY(i, y + (-z / r) * (y / r) * r * 0.25); p.setZ(i, z - (y / r) * r * 0.25); } // peak behind
    }
    g.computeVertexNormals();
    M.hoodCloth = M.hoodCloth || M.cloak;
    mesh(g, M.hoodCloth, headG);
    rim(headG, (() => {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const a = lerp(-1.25, 1.25, t);
        pts.push(V3(Math.sin(a) * r * 1.0, lerp(-r * 0.9, r * 0.95, 1 - Math.abs(t - 0.5) * 2), r * 0.9 * Math.cos(a)));
      }
      return { pts, closed: false };
    })(), 0.35, glowOn ? M.glow : M.trimCloth);
  } else if (L.helm === 'open') {
    mesh(lathe([[r * 1.06, -r * 0.08], [r * 1.08, r * 0.3], [r * 0.9, r * 0.82], [r * 0.5, r * 1.12], [0.01, r * 1.2]], 22), M.helm, headG);
    rim(headG, lathePoints(r * 1.06, -r * 0.08, 1), 0.32, M.helmEdge);
    mesh(new THREE.BoxGeometry(r * 0.22, r * 0.75, r * 0.2), M.helm, headG, 0, -r * 0.2, r * 1.0);
    for (const sx of [1, -1]) {
      const cg = mesh(lathe([[r * 1.04, -r * 0.05], [r * 1.02, -r * 0.6], [r * 0.85, -r * 0.95]], 6, 1, 0, PI * 0.42), M.helm, headG);
      cg.rotation.y = sx > 0 ? PI * 0.28 : PI * 1.3;
    }
    mesh(new THREE.TorusGeometry(r * 1.07, 0.28, 5, 24).rotateX(PI / 2), trimGlow, headG, 0, r * 0.1, 0);
  } else {
    // closed helms: full / visor / horned / crest
    const sallet = L.helm === 'visor';
    const prof = sallet
      ? [[0.01, r * 1.12], [r * 0.55, r * 1.06], [r * 0.9, r * 0.8], [r * 1.06, r * 0.3], [r * 1.08, -r * 0.3], [r * 1.0, -r * 0.85], [r * 0.92, -r * 1.02]]
      : [[0.01, r * 1.2], [r * 0.5, r * 1.13], [r * 0.82, r * 0.95], [r * 0.98, r * 0.6], [r * 1.03, r * 0.1], [r * 1.0, -r * 0.6], [r * 0.93, -r * 0.98], [r * 0.86, -r * 1.12]];
    const g = lathe(prof, 26, 1.05);
    if (sallet) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); const z = p.getZ(i); if (z < 0 && y < 0) p.setZ(i, z * (1 + (-y / r) * 0.35)); }
      g.computeVertexNormals();
    }
    mesh(g, M.helm, headG);
    rim(headG, lathePoints(prof[prof.length - 1][0], prof[prof.length - 1][1], 1.05), 0.36, M.helmEdge);
    if (sallet) {
      mesh(lathe([[r * 1.05, -r * 0.14], [r * 1.1, 0], [r * 1.05, r * 0.14]], 18, 1.06, -PI * 0.42, PI * 0.84), glowOn ? M.glow : M.void, headG, 0, r * 0.05, 0);
      for (const sx of [1, -1]) {
        mesh(new THREE.SphereGeometry(r * 0.3, 10, 8), M.dark, headG, sx * r * 1.02, 0, 0);
        if (glowOn) mesh(new THREE.SphereGeometry(r * 0.1, 6, 5), M.glow, headG, sx * r * 1.3, 0, 0);
      }
    } else {
      mesh(new THREE.BoxGeometry(r * 0.15, r * 1.8, r * 0.2), M.helm, headG, 0, r * 0.25, r * 1.03);
      mesh(new THREE.TorusGeometry(r * 1.04, 0.32, 5, 26).rotateX(PI / 2).scale(1, 1, 1.05), trimGlow, headG, 0, r * 0.55, 0);
      for (const sx of [1, -1]) {
        mesh(new THREE.BoxGeometry(r * 0.75, r * 0.15, r * 0.36).rotateY(sx * 0.42), glowOn ? M.glow : M.void, headG, sx * r * 0.45, r * 0.18, r * 0.93);
        for (let k = 0; k < 3; k++) for (let q = 0; q < 2; q++) mesh(new THREE.BoxGeometry(r * 0.08, r * 0.08, r * 0.26), M.void, headG, sx * r * (0.25 + k * 0.18), -r * 0.45 - q * r * 0.21, r * 1.0 - k * 0.06);
      }
      mesh(new THREE.ConeGeometry(r * 0.18, r * 0.6, 8).translate(0, r * 0.27, 0), M.brass, headG, 0, r * 1.15, 0);
    }
    if (L.helm === 'horned') {
      for (const sx of [1, -1]) {
        const pts = [V3(sx * r * 0.8, r * 0.35, 0), V3(sx * r * 1.75, r * 0.85, r * 0.15), V3(sx * r * 2.1, r * 1.65, r * 0.4), V3(sx * r * 1.9, r * 2.3, r * 0.75)];
        mesh(taperTube(pts, r * 0.3, r * 0.04, 8, 14), M.bone, headG);
      }
    }
    if (L.helm === 'crest') {
      const s = new THREE.Shape();
      const n = 12;
      for (let i = 0; i <= n; i++) { const a = -PI * 0.42 + (i / n) * PI * 0.95; s.lineTo(Math.sin(a) * r * 1.1, Math.cos(a) * r * 1.16); }
      for (let i = n; i >= 0; i--) { const a = -PI * 0.42 + (i / n) * PI * 0.95; s.lineTo(Math.sin(a) * r * 1.85, Math.cos(a) * r * 1.75 + (i / n) * r * 0.2); }
      const cg = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: false, curveSegments: 4 });
      cg.translate(0, 0, -0.45);
      cg.rotateY(-PI / 2);
      mesh(cg, glowOn ? M.glow : M.trimCloth, headG);
    }
  }
  // neck
  const neckG = manual(root);
  mesh(limb(r * 1.2, r * 0.5, r * 0.55, 10), (plate || (tech && L.helm === 'hood')) && !faceShown ? M.mail : (bare ? M.hide : M.skin), neckG);

  /* ------------------------------------------------ weapons (+Z along the weapon, origin at the grip) */
  const wp = buildWeapon(L.weapon, weaponG, mesh, M, L);
  const clawsL = L.weapon === 'claws' ? buildWeapon('claws', seg.handL, mesh, M, L) : null;
  void clawsL;
  let off = null;
  if (L.offhand && L.offhand !== 'none') off = buildOffhand(L.offhand, offG, mesh, M, L);

  /* ------------------------------------------------ swing trail */
  const TN = 9;
  const trailGeom = new THREE.BufferGeometry();
  trailGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TN * 2 * 3), 3));
  trailGeom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(TN * 2 * 4), 4));
  const tIdx = [];
  for (let i = 0; i < TN - 1; i++) { const a = i * 2; tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  trailGeom.setIndex(tIdx);
  const trail = new THREE.Mesh(trailGeom, M.trail);
  trail.frustumCulled = false;
  trail.renderOrder = 10;
  root.add(trail);
  const trailC = new THREE.Color(L.glow ? 0xffffff : 0xfff2dc);
  if (L.glow) trailC.copy(M.glow.color).lerp(new THREE.Color(1, 1, 1), 0.35);
  function setTrail(pts) {
    trail.visible = pts.length > 1;
    if (!trail.visible) return;
    const P = trailGeom.attributes.position; const Cc = trailGeom.attributes.color;
    for (let i = 0; i < TN; i++) {
      const q = pts[Math.min(i, pts.length - 1)];
      P.setXYZ(i * 2, q[0].x, q[0].y, q[0].z);
      P.setXYZ(i * 2 + 1, q[1].x, q[1].y, q[1].z);
      const fade = i < pts.length ? 1 - i / (pts.length - 1 || 1) : 0;
      Cc.setXYZW(i * 2, trailC.r, trailC.g, trailC.b, 0);
      Cc.setXYZW(i * 2 + 1, trailC.r, trailC.g, trailC.b, 0.6 * fade);
    }
    P.needsUpdate = true; Cc.needsUpdate = true;
    trailGeom.computeBoundingSphere();
  }

  /* ------------------------------------------------ cast focus */
  // additive and drawn over the hands, so it reads as light rather than a solid ball
  const castOrb = mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({
    color: M.focus.color, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }), root);
  castOrb.renderOrder = 20;
  castOrb.castShadow = false;
  castOrb.userData.fx = true;

  /* ------------------------------------------------ posing */
  const tv = V3(); const ta = V3(); const tb = V3(); const tc = V3();
  const fwdW = V3(); const upW = V3(); const leftW = V3();
  const glows = [];
  const occ = [];
  const torsoBasis = (sk, originActor, g) => {
    const o = sk.U([0, 0, 0]);
    const ex = A(sub3(sk.U([-1, 0, 0]), o));
    const ey = A(sub3(sk.U([0, 0, 1]), o));
    const ez = A(sub3(sk.U([0, 1, 0]), o));
    g.matrix.makeBasis(ex, ey, ez).setPosition(A(originActor));
    g.matrixWorldNeedsUpdate = true;
    fwdW.copy(ez).normalize(); upW.copy(ey).normalize(); leftW.copy(ex).normalize();
  };

  function pose(sk, anim, f, prev) {
    const P = sk.P;
    glows.length = 0;
    occ.length = 0;
    torsoBasis(sk, sk.U([0, 0, 0]), torsoG);
    // pelvis: half the twist, no tilt
    pelvisG.matrix.makeRotationY(-sk.tw * 0.45).setPosition(A([0, sk.rootF * 0.6, sk.pelvisZ]));
    pelvisG.matrixWorldNeedsUpdate = true;
    // head follows the torso
    const hb = headG.matrix;
    hb.copy(torsoG.matrix).setPosition(A(sk.headC));
    headG.matrixWorldNeedsUpdate = true;
    // neck from the head base down toward the torso top
    placeSeg(neckG, A(sk.headC, ta).addScaledVector(upW, -r * 0.2), A(sk.neck, tb).addScaledVector(upW, -r * 0.9), fwdW);

    // legs
    for (const lg of sk.legs) {
      const s = lg.side > 0 ? 'R' : 'L';
      A(lg.hip, ta); A(lg.knee, tb); A(lg.ankle, tc);
      placeSeg(seg['thigh' + s], ta, tb, tv.set(0, 0, 1));
      placeSeg(seg['shin' + s], tb, tc, tv.set(0, 0, 1));
      const ft = seg['foot' + s];
      const pitch = lg.lift > 0.3 ? Math.min(0.5, lg.lift * 0.12) : 0;
      ft.matrix.makeRotationX(pitch).setPosition(tc);
      ft.matrixWorldNeedsUpdate = true;
    }
    // arms
    for (const a of sk.arms) {
      const s = a.side > 0 ? 'R' : 'L';
      A(a.shoulder, ta); A(a.elbow, tb); A(a.hand, tc);
      // +Z of the arm segments faces the inside of the bend (the front of the arm)
      const mid = V3().addVectors(ta, tc).multiplyScalar(0.5).sub(tb);
      if (mid.lengthSq() < 0.05) mid.copy(fwdW);
      placeSeg(seg['upper' + s], ta, tb, mid);
      placeSeg(seg['fore' + s], tb, tc, mid);
      const fd = V3().subVectors(tc, tb).normalize();
      placeSeg(seg['hand' + s], tc, V3().copy(tc).add(fd), mid);
      if (paul[s]) {
        const sx = s === 'L' ? 1 : -1;
        const d = V3().subVectors(tb, ta).normalize();
        const outward = Math.max(0, d.dot(leftW) * sx);
        const fwd = d.dot(fwdW);
        const raise = Math.max(0, d.dot(upW) + 1);
        paul[s].rotation.set(-fwd * 0.3 * Math.min(1, raise), 0, sx * (outward * 0.5 + Math.max(0, raise - 0.6) * 0.25));
      }
    }
    // weapon in the right hand
    const hand = A(sk.arms[0].hand, V3());
    const wdT = A(sk.wd, V3()).normalize();
    const foreR = V3().subVectors(hand, A(sk.arms[0].elbow, V3())).normalize();
    const gunLike = L.weapon === 'pistol' || L.weapon === 'rifle';
    if (L.weapon === 'bow') {
      placeAlong(weaponG, hand, fwdW, V3(0, 1, 0));
    } else if (L.weapon !== 'none' && L.weapon !== 'claws') {
      placeAlong(weaponG, hand, wdT, gunLike ? V3(0, 1, 0) : foreR);
    } else {
      placeAlong(weaponG, hand, wdT, foreR);
    }
    weaponG.visible = L.weapon !== 'none' && L.weapon !== 'claws';
    if (wp) wp.update(P, sk);
    // offhand
    if (off) {
      offG.visible = !P.two;
      const lh = A(sk.arms[1].hand, V3());
      if (L.offhand === 'shield' || L.offhand === 'buckler') {
        const n = V3().copy(fwdW).addScaledVector(leftW, 0.55).normalize();
        const pos = V3().copy(lh).addScaledVector(fwdW, 2.2).addScaledVector(leftW, 1);
        placeAlong(offG, pos, n, upW);
      } else if (L.offhand === 'orb') {
        offG.matrix.identity().setPosition(V3().copy(lh).addScaledVector(upW, 3.2));
        offG.matrixWorldNeedsUpdate = true;
      } else {
        const d = A(U2dir(sk.U, wdir(1.0, -0.1)), V3());
        const foreL = V3().subVectors(lh, A(sk.arms[1].elbow, V3())).normalize();
        placeAlong(offG, lh, d, foreL);
      }
      off.update(P, sk);
    }
    // robe skirt / cloak
    if (skirt) updateSkirt(sk);
    if (cloak) {
      const walkPh = anim === 'walk' ? (f / 8) * TAU : (anim === 'attack' ? (f / 8) * TAU : 0.6);
      const drag = anim === 'walk' ? 0.45 : (anim === 'attack' ? 0.3 - P.twist * 0.3 : (anim === 'death' ? 0.1 : 0.12));
      const gust = anim === 'walk' ? 0.6 : (anim === 'attack' ? 0.9 : 0.25);
      updateCloak(walkPh, drag, gust);
    }
    // swing trail: blade tip between the previous key and this one
    const smear = P.smear !== null && P.smear !== undefined && prev && L.weapon !== 'none';
    if (smear && P.smearKeys && wp) {
      const pts = [];
      for (let i = 0; i < 9; i++) {
        const t = 1 - i / 8;
        const h = A(lerp3(prev.arms[0].hand, sk.arms[0].hand, t), V3());
        const d = A(lerp3(prev.wd, sk.wd, t), V3()).normalize();
        pts.push([V3().copy(h).addScaledVector(d, wp.len * 0.35), V3().copy(h).addScaledVector(d, wp.len + 1)]);
      }
      setTrail(pts);
    } else if (smear && L.weapon === 'claws') {
      const i0 = P.smear;
      const pts = [];
      for (let i = 0; i < 9; i++) {
        const t = 1 - i / 8;
        const h = A(lerp3(prev.arms[i0].hand, sk.arms[i0].hand, t), V3());
        const d = A(lerp3(prev.wd, sk.wd, t), V3()).normalize();
        pts.push([V3().copy(h).addScaledVector(d, 1), V3().copy(h).addScaledVector(d, 7)]);
      }
      setTrail(pts);
    } else setTrail([]);
    // cast focus
    castOrb.visible = P.cast > 0 && L.weapon !== 'staff';
    if (P.cast > 0) {
      const cp = L.weapon === 'staff' ? V3().copy(hand).addScaledVector(wdT, 32.5) : A(lerp3(sk.arms[0].hand, sk.arms[1].hand, 0.5), V3());
      castOrb.position.copy(cp);
      castOrb.scale.setScalar(1.4 + 2.2 * P.cast);
      glows.push({ p: cp, r: 16 + 14 * P.cast, color: L.glow || null, a: 0.45 + 0.4 * P.cast, cast: true });
    }

    // glow anchors (projected by the baker)
    if (L.glow) {
      glows.push({ p: A(sk.headC, V3()), r: 9, color: L.glow, a: 0.28, front: true });
      if (BLADE_GLOW.has(L.weapon)) glows.push({ p: V3().copy(hand).addScaledVector(wdT, weaponLen(L.weapon) * 0.6), r: 13, color: L.glow, a: 0.22 });
    }
    if (wp && wp.glow) glows.push(...wp.glow(hand, wdT, P));
    if (off && off.glow && !P.two) glows.push(...off.glow(V3().copy(A(sk.arms[1].hand, V3())).addScaledVector(upW, 3.2)));

    // occluders [model-space position, radius]
    const o = (p, rad) => occ.push([p, rad]);
    o(A([0, sk.rootF * 0.6, sk.pelvisZ + 1], V3()), rw * 1.05);
    o(A(sk.U([0, 0, up * 0.3]), V3()), rc * 0.85);
    o(A(sk.U([0, 0, up * 0.75]), V3()), rc * 0.95);
    o(A(sk.headC, V3()), r * 1.1);
    for (let i = 0; i < 2; i++) {
      const a = sk.arms[i]; const lg = sk.legs[i];
      o(A(lerp3(a.shoulder, a.elbow, 0.5), V3()), ar0 * 1.1);
      o(A(lerp3(a.elbow, a.hand, 0.5), V3()), ar1 * 1.1);
      o(A(a.hand, V3()), ar1 * 0.8);
      o(A(lerp3(lg.hip, lg.knee, 0.5), V3()), lr0 * 1.1);
      o(A(lerp3(lg.knee, lg.ankle, 0.5), V3()), lr1 * 1.15);
      o(A(add3(lg.ankle, [0, 2.5, -1.5]), V3()), 3.2);
      if (plate || leathers) o(A(add3(a.shoulder, [0, 0, 1.5]), V3()), B.pauld * 0.8);
    }
    if (off && (L.offhand === 'shield') && !P.two) o(V3().setFromMatrixPosition(offG.matrix), 7);
  }

  return { root, pose, glows, occ, shadowR: B.sh * 1.35 + 2, B };
}

/* ======================================================================== tech heads */

/**
 * style 'tech' heads (origin = head centre, +Z the face):
 *   visor    ballistic helmet with a wraparound glass visor and ear modules (antenna on one)
 *   full     sealed helmet, faceplate with a T-shaped light slit and jaw vents
 *   crest    visor helmet with a light fin;   horned  full helmet with two antennas
 *   hood     techwear hood over a dark face with an LED band across the eyes
 *   open     bare face, undercut hair, cyber eye and a headset with a mic boom
 *   bare     shaved head, cyber eye, light implant lines over the scalp
 *   mask     respirator with twin filters, goggles, hair;   goggles  bare face with goggles
 */
function techHead(L, M, mesh, rim, headG, r, glowOn) {
  const h = L.helm;
  const face = ['open', 'bare', 'mask', 'goggles'].includes(h);
  const neonOr = (fallback) => (glowOn ? M.neon : fallback);
  if (face || h === 'hood') {
    const hooded = h === 'hood';
    mesh(ellipsoid(r * 0.9, r * 0.98, r * 0.9, 16, 12), hooded ? M.void : M.skin, headG);
    if (!hooded) {
      mesh(ellipsoid(r * 0.16, r * 0.24, r * 0.2, 8, 6), M.skin, headG, 0, -r * 0.15, r * 0.86);
      for (const sx of [1, -1]) {
        mesh(new THREE.BoxGeometry(r * 0.34, r * 0.08, r * 0.12), M.hair, headG, sx * r * 0.34, r * 0.24, r * 0.8);
        mesh(ellipsoid(r * 0.12, r * 0.18, r * 0.12, 6, 5), M.skin, headG, sx * r * 0.88, 0, 0);
      }
      if (h !== 'mask' && h !== 'goggles') {
        // eyes: one natural, one cybernetic with a steel socket and a temple plate
        mesh(new THREE.SphereGeometry(r * 0.1, 8, 6), M.void, headG, r * 0.33, r * 0.05, r * 0.8);
        mesh(new THREE.TorusGeometry(r * 0.15, r * 0.04, 4, 12), M.steel, headG, -r * 0.33, r * 0.05, r * 0.84);
        mesh(new THREE.SphereGeometry(r * 0.12, 8, 6), M.neon, headG, -r * 0.33, r * 0.05, r * 0.82);
        mesh(new THREE.BoxGeometry(r * 0.1, r * 0.42, r * 0.36), M.steel, headG, -r * 0.88, r * 0.12, r * 0.28);
        mesh(new THREE.BoxGeometry(r * 0.06, r * 0.08, r * 0.08), M.neon, headG, -r * 0.94, r * 0.22, r * 0.36);
      }
    }
  }
  const hairTop = () => {
    // undercut: hair on top, shaved sides
    mesh(new THREE.SphereGeometry(r * 0.97, 16, 8, 0, TAU, 0, PI * 0.33), M.hair, headG, 0, r * 0.1, -r * 0.04);
    mesh(ellipsoid(r * 0.35, r * 0.28, r * 0.9, 10, 6), M.hair, headG, 0, r * 0.82, -r * 0.05);
  };
  const goggles = (y) => {
    for (const sx of [1, -1]) {
      mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.26, r * 0.28, 14).rotateX(PI / 2), M.dark, headG, sx * r * 0.36, y, r * 0.86);
      mesh(new THREE.CylinderGeometry(r * 0.19, r * 0.19, r * 0.06, 14).rotateX(PI / 2), M.lens, headG, sx * r * 0.36, y, r * 1.0);
    }
    mesh(new THREE.TorusGeometry(r * 0.93, r * 0.06, 4, 24).rotateX(PI / 2), M.leather, headG, 0, y, 0);
  };
  const shellHelm = (closed) => {
    const prof = [[0.01, r * 1.16], [r * 0.6, r * 1.09], [r * 0.96, r * 0.76], [r * 1.09, r * 0.2], [r * 1.09, -r * 0.35], [r * 1.0, -r * 0.85], [r * 0.86, -r * 1.06]];
    const g = lathe(prof, 28, 1.06, closed ? 0 : PI * 0.42, closed ? TAU : PI * 1.16);
    mesh(g, M.helm, headG);
    rim(headG, lathePoints(r * 0.86, -r * 1.06, 1.06, closed ? 0 : PI * 0.42, closed ? TAU : PI * 1.16, 24), 0.3, M.edge);
    // ridge
    mesh(new THREE.BoxGeometry(r * 0.22, r * 0.2, r * 1.6), M.edge, headG, 0, r * 1.1, -r * 0.1);
  };
  const earModules = (antenna) => {
    for (const sx of [1, -1]) {
      mesh(new THREE.CylinderGeometry(r * 0.34, r * 0.34, r * 0.3, 12).rotateZ(PI / 2), M.dark, headG, sx * r * 1.08, -r * 0.05, -r * 0.05);
      mesh(new THREE.TorusGeometry(r * 0.22, r * 0.05, 4, 14).rotateY(PI / 2), M.neon, headG, sx * r * 1.24, -r * 0.05, -r * 0.05);
    }
    if (antenna) {
      mesh(new THREE.CylinderGeometry(0.15, 0.22, r * 1.4, 5).translate(0, r * 0.7, 0).rotateZ(0.25).rotateX(-0.35), M.steel, headG, r * 1.12, r * 0.1, -r * 0.1);
      mesh(new THREE.SphereGeometry(0.4, 6, 5), M.neon, headG, r * 1.45, r * 1.38, -r * 0.55);
    }
  };
  if (h === 'visor' || h === 'crest') {
    shellHelm(true);
    // wraparound glass visor with a light line through it
    mesh(lathe([[r * 1.1, -r * 0.24], [r * 1.16, -r * 0.02], [r * 1.12, r * 0.24]], 22, 1.07, -PI * 0.46, PI * 0.92), M.lens, headG, 0, r * 0.04, 0);
    rim(headG, lathePoints(r * 1.165, r * 0.02, 1.07, -PI * 0.42, PI * 0.84, 18), 0.2, neonOr(M.edge));
    earModules(h === 'visor');
    if (h === 'crest') {
      const sh = new THREE.Shape();
      const n = 10;
      for (let i = 0; i <= n; i++) { const a = -PI * 0.3 + (i / n) * PI * 0.85; sh.lineTo(Math.sin(a) * r * 1.12, Math.cos(a) * r * 1.16); }
      for (let i = n; i >= 0; i--) { const a = -PI * 0.3 + (i / n) * PI * 0.85; sh.lineTo(Math.sin(a) * r * 1.6, Math.cos(a) * r * 1.5 + (i / n) * r * 0.1); }
      const cg = new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false, curveSegments: 4 });
      cg.translate(0, 0, -0.25);
      cg.rotateY(-PI / 2);
      mesh(cg, M.neon, headG);
    }
  } else if (h === 'full' || h === 'horned') {
    shellHelm(true);
    // faceplate and a T-shaped light slit
    mesh(lathe([[r * 1.0, -r * 0.95], [r * 1.12, -r * 0.4], [r * 1.14, r * 0.1], [r * 1.1, r * 0.42]], 18, 1.08, -PI * 0.4, PI * 0.8), M.edge, headG);
    mesh(new THREE.BoxGeometry(r * 1.2, r * 0.13, r * 0.12), M.neon, headG, 0, r * 0.12, r * 1.2);
    mesh(new THREE.BoxGeometry(r * 0.13, r * 0.6, r * 0.12), M.neon, headG, 0, -r * 0.2, r * 1.21);
    for (const sx of [1, -1]) for (let k = 0; k < 3; k++) mesh(new THREE.BoxGeometry(r * 0.22, r * 0.06, r * 0.2), M.void, headG, sx * r * 0.42, -r * 0.5 - k * r * 0.14, r * 1.07);
    earModules(false);
    if (h === 'horned') {
      for (const sx of [1, -1]) {
        mesh(taperTube([V3(sx * r * 0.9, r * 0.5, -r * 0.2), V3(sx * r * 1.2, r * 1.3, -r * 0.5), V3(sx * r * 1.35, r * 2.1, -r * 0.9)], r * 0.12, r * 0.04, 6, 8), M.steel, headG);
        mesh(new THREE.SphereGeometry(r * 0.12, 6, 5), M.neon, headG, sx * r * 1.35, r * 2.12, -r * 0.92);
      }
    }
  } else if (h === 'hood') {
    const g = lathe([[r * 0.95, -r * 1.1], [r * 1.25, -r * 0.4], [r * 1.3, r * 0.3], [r * 1.12, r * 0.95], [r * 0.6, r * 1.3], [0.01, r * 1.38]], 22, 1.05, PI * 0.3, PI * 1.4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i); const z = p.getZ(i);
      if (z < 0 && y > 0) { p.setY(i, y + (-z / r) * (y / r) * r * 0.25); p.setZ(i, z - (y / r) * r * 0.25); }
    }
    g.computeVertexNormals();
    mesh(g, M.hoodCloth, headG);
    // LED band across the eyes inside the hood, and a light line along the hood edge
    mesh(lathe([[r * 0.93, -r * 0.03], [r * 0.95, r * 0.14]], 16, 1.0, -PI * 0.3, PI * 0.6), glowOn ? M.neon : M.eye, headG);
    rim(headG, (() => {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const a = lerp(-1.25, 1.25, t);
        pts.push(V3(Math.sin(a) * r * 1.0, lerp(-r * 0.9, r * 0.95, 1 - Math.abs(t - 0.5) * 2), r * 0.9 * Math.cos(a)));
      }
      return { pts, closed: false };
    })(), 0.3, M.trimCloth);
  } else if (h === 'open') {
    hairTop();
    // headset: ear cup and mic boom
    mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.3, r * 0.25, 12).rotateZ(PI / 2), M.dark, headG, r * 0.98, 0, 0);
    mesh(new THREE.TorusGeometry(r * 0.2, r * 0.05, 4, 12).rotateY(PI / 2), M.neon, headG, r * 1.12, 0, 0);
    mesh(taperTube([V3(r * 1.0, -r * 0.1, r * 0.1), V3(r * 0.8, -r * 0.45, r * 0.7), V3(r * 0.3, -r * 0.5, r * 0.95)], r * 0.06, r * 0.05, 5, 8), M.dark, headG);
    mesh(new THREE.SphereGeometry(r * 0.08, 6, 5), M.neon, headG, r * 0.28, -r * 0.5, r * 0.97);
  } else if (h === 'bare') {
    for (const sx of [1, -1]) {
      for (let k = 0; k < 3; k++) mesh(new THREE.BoxGeometry(r * 0.08, r * 0.06, r * 0.35), M.neon, headG, sx * r * 0.5, r * (0.72 - k * 0.12) + r * 0.1, -r * (0.1 + k * 0.25));
    }
  } else if (h === 'mask') {
    hairTop();
    goggles(r * 0.08);
    // respirator: moulded mouthpiece and twin filters
    mesh(ellipsoid(r * 0.6, r * 0.42, r * 0.45, 14, 10), M.dark, headG, 0, -r * 0.45, r * 0.62);
    for (const sx of [1, -1]) {
      const f = mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.4, 12).rotateX(PI / 2), M.steel, headG, sx * r * 0.5, -r * 0.6, r * 0.88);
      f.rotation.y = sx * 0.6;
      mesh(new THREE.TorusGeometry(r * 0.22, r * 0.04, 4, 12), M.neon, f, 0, 0, r * 0.2);
    }
    mesh(new THREE.BoxGeometry(r * 0.3, r * 0.12, r * 0.12), M.neon, headG, 0, -r * 0.5, r * 1.06);
  } else if (h === 'goggles') {
    hairTop();
    goggles(r * 0.08);
  }
}

/* ======================================================================== weapons */

/**
 * Build a weapon into group g (its +Z is the weapon axis, origin the grip, +Y the edge side).
 * Returns { len, update(P), glow(hand, wd, P) } or null.
 */
function buildWeapon(w, g, mesh, M, L) {
  if (!w || w === 'none') return null;
  const len = weaponLen(w);
  const glowOn = !!L.glow;
  // tech: carbon hafts, gunmetal fittings, light strips even when the look has no glow
  const tech = L.style === 'tech';
  const haft = tech ? M.carbon : M.leather;
  const metal = M.steel;
  const fit = tech ? M.dark : M.brass;
  const strip = tech ? M.neon : M.glow;
  const lit = glowOn || tech;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const blade = (lenB, width, guard, grip, opts = {}) => {
    mesh(bladeGeom(lenB - 1.5, width, opts.thick || 1.0, opts.curve || 0, !!opts.single), metal, g, 0, 0, 1.5);
    if (opts.roundGuard) mesh(new THREE.CylinderGeometry(guard, guard, 0.6, tech ? 6 : 14).rotateX(PI / 2), fit, g, 0, 0, 1.1);
    else if (tech) {
      mesh(new THREE.BoxGeometry(1.6, guard * 1.6, 1.6), fit, g, 0, 0, 1.0);
      mesh(new THREE.BoxGeometry(0.4, guard * 1.2, 0.4), strip, g, 0.85, 0, 1.0);
    } else {
      mesh(new THREE.BoxGeometry(1.1, guard * 2, 1.1), M.brass, g, 0, 0, 1.1);
      for (const s of [1, -1]) mesh(new THREE.SphereGeometry(0.7, 6, 5), M.brass, g, 0, s * guard, 1.1);
    }
    mesh(new THREE.CylinderGeometry(0.7, 0.8, grip, 8).rotateX(PI / 2), tech ? M.dark : M.leather, g, 0, 0, -grip / 2 + 0.4);
    if (tech) {
      for (let k = 1; k < 4; k++) mesh(new THREE.TorusGeometry(0.8, 0.14, 4, 10), M.carbon, g, 0, 0, 0.4 - (grip * k) / 4);
      mesh(new THREE.CylinderGeometry(0.95, 0.8, 1.2, 6).rotateX(PI / 2), M.carbon, g, 0, 0, -grip);
      mesh(new THREE.TorusGeometry(0.85, 0.16, 4, 10), strip, g, 0, 0, -grip - 0.4);
    } else mesh(new THREE.SphereGeometry(1.1, 10, 8).scale(1, 1, 0.8), M.brass, g, 0, 0, -grip);
    if (lit) for (const s of (opts.single ? [1] : [1, -1])) mesh(new THREE.BoxGeometry(0.25, 0.3, (lenB - 4) * 0.85), strip, g, 0, s * width * 0.42, 2.5 + (lenB - 4) * 0.42);
    else mesh(new THREE.BoxGeometry(0.3, width * 0.22, (lenB - 4) * 0.7), M.dark, g, 0, 0, 3 + (lenB - 4) * 0.35);
  };
  let muzzle = null;
  let bowString = null; let arrow = null;
  switch (w) {
    case 'sword': blade(len, 3.2, 3.6, 3.8); break;
    case 'katana': blade(len, 2.0, 1.5, 5, { curve: 0.07, single: true, roundGuard: true, thick: 0.8 }); break;
    case 'greatsword': blade(len, 4.0, 4.6, 6); break;
    case 'dagger': case 'blade': blade(len, 2.2, 2.2, 2.6); break;
    case 'axe': case 'hammer': case 'mace': {
      mesh(new THREE.CylinderGeometry(0.75, 0.85, len + 4, 8).rotateX(PI / 2), haft, g, 0, 0, (len - 4) / 2);
      if (w === 'axe') {
        const s = new THREE.Shape();
        s.moveTo(0.5, -3); s.quadraticCurveTo(4, -3.6, 6.8, -5); s.quadraticCurveTo(8.6, 0, 6.8, 5); s.quadraticCurveTo(4, 3.6, 0.5, 3); s.lineTo(0.5, -3);
        const hg = new THREE.ExtrudeGeometry(s, { depth: 1.0, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 1, curveSegments: 8 });
        hg.translate(0, 0, -0.5);
        hg.rotateY(-PI / 2); // shape x -> -z... put the shape in the Y/Z plane
        hg.rotateX(-PI / 2);
        mesh(hg, metal, g, 0, 0, len - 2);
        mesh(new THREE.ConeGeometry(1.0, 3.5, 6).rotateX(PI), metal, g, 0, -2.2, len - 2);
        if (lit) mesh(new THREE.BoxGeometry(0.4, 0.5, 9), strip, g, 0, 8.1, len - 2);
      } else if (w === 'hammer' && tech) {
        // power maul: a drum head across the haft with a lit core and vent fins
        mesh(new THREE.CylinderGeometry(3.0, 3.0, 9.5, 12), metal, g, 0, 0, len - 1.5);
        for (const s of [1, -1]) {
          mesh(new THREE.CylinderGeometry(3.3, 3.3, 1.2, 12), M.dark, g, 0, s * 4.6, len - 1.5);
          mesh(new THREE.TorusGeometry(3.05, 0.3, 4, 18).rotateX(PI / 2), strip, g, 0, s * 2.3, len - 1.5);
        }
        for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(0.4, 5.5, 1.6), M.dark, g, 3.0, 0, len - 3.2 + k * 1.1);
      } else if (w === 'hammer') {
        mesh(new THREE.BoxGeometry(5.4, 9.2, 5.4), metal, g, 0, 0, len - 1.5);
        for (const s of [1, -1]) mesh(new THREE.BoxGeometry(5.8, 0.6, 5.8), glowOn ? M.glow : M.brass, g, 0, s * 2.2, len - 1.5);
      } else if (tech) {
        // stun baton: emitter tip with prongs and a light ring
        mesh(new THREE.CylinderGeometry(1.3, 1.0, 4, 8).rotateX(PI / 2), metal, g, 0, 0, len - 0.5);
        mesh(new THREE.TorusGeometry(1.25, 0.32, 4, 12), strip, g, 0, 0, len - 1.6);
        for (const s of [1, -1]) mesh(new THREE.ConeGeometry(0.35, 2.4, 5).rotateX(PI / 2), metal, g, 0, s * 0.7, len + 2.6);
        mesh(new THREE.SphereGeometry(0.6, 8, 6), strip, g, 0, 0, len + 1.8);
      } else {
        mesh(new THREE.SphereGeometry(2.6, 12, 10), metal, g, 0, 0, len);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          const fl = mesh(new THREE.BoxGeometry(0.6, 2.2, 4.4), metal, g, Math.cos(a) * 2.7, Math.sin(a) * 2.7, len);
          fl.rotation.z = a + PI / 2;
        }
        if (glowOn) mesh(new THREE.SphereGeometry(1.0, 8, 6), M.glow, g, 0, 0, len + 2.7);
      }
      mesh(new THREE.TorusGeometry(0.95, 0.3, 4, 10), fit, g, 0, 0, -1.5);
      break;
    }
    case 'spear': {
      mesh(new THREE.CylinderGeometry(0.7, 0.8, len + 8, 8).rotateX(PI / 2), haft, g, 0, 0, (len - 8) / 2);
      mesh(bladeGeom(7.5, 3.6, 1.0), metal, g, 0, 0, len);
      mesh(new THREE.CylinderGeometry(0.95, 0.75, 2, 8).rotateX(PI / 2), fit, g, 0, 0, len - 0.4);
      if (tech) mesh(new THREE.TorusGeometry(0.95, 0.25, 4, 10), strip, g, 0, 0, len - 1.8);
      break;
    }
    case 'staff': {
      mesh(new THREE.CylinderGeometry(0.75, 0.85, len + 14, 8).rotateX(PI / 2), haft, g, 0, 0, (len - 14) / 2);
      for (const s of [1, -1]) mesh(taperTube([V(0, s * 1.0, len - 1), V(0, s * 2.8, len + 2.5), V(0, s * 1.4, len + 5.5)], 0.6, 0.15, 5, 8), tech ? metal : M.brass, g);
      mesh(tech ? new THREE.SphereGeometry(1.9, 14, 10) : new THREE.IcosahedronGeometry(2.3, 1), M.focus, g, 0, 0, len + 2.5).castShadow = false;
      if (tech) for (let k = 0; k < 3; k++) mesh(new THREE.TorusGeometry(1.0, 0.25, 4, 10), strip, g, 0, 0, len - 2.2 - k * 1.3);
      else mesh(new THREE.TorusGeometry(1.0, 0.35, 5, 10), M.brass, g, 0, 0, len - 1.4);
      break;
    }
    case 'wand': {
      if (tech) {
        // emitter rod: carbon body, coil rings, crystal tip
        mesh(new THREE.CylinderGeometry(0.75, 0.9, len + 2, 8).rotateX(PI / 2), haft, g, 0, 0, (len - 2) / 2);
        for (let k = 0; k < 3; k++) mesh(new THREE.TorusGeometry(0.95, 0.22, 4, 10), strip, g, 0, 0, len - 1 - k * 1.6);
        mesh(new THREE.CylinderGeometry(1.1, 0.8, 1.2, 6).rotateX(PI / 2), M.dark, g, 0, 0, len - 0.1);
      } else mesh(new THREE.CylinderGeometry(0.4, 0.75, len + 2, 8).rotateX(PI / 2), haft, g, 0, 0, (len - 2) / 2);
      mesh(new THREE.OctahedronGeometry(1.5, 0), M.focus, g, 0, 0, len + 0.8).castShadow = false;
      break;
    }
    case 'pistol': case 'rifle': {
      const rifle = w === 'rifle';
      const back = rifle ? -7 : -2.2;
      mesh(new THREE.BoxGeometry(rifle ? 2.6 : 2.2, rifle ? 3.0 : 2.6, (len - back) * 0.62), M.dark, g, 0, 0.3, back + (len - back) * 0.31);
      mesh(new THREE.CylinderGeometry(0.6, 0.6, (len - back) * 0.5, 8).rotateX(PI / 2), metal, g, 0, 0.6, len - (len - back) * 0.25);
      mesh(new THREE.BoxGeometry(1.6, 3.6, 1.8).rotateX(0.35), tech ? M.dark : M.leather, g, 0, -2.2, -0.6);
      if (rifle) {
        mesh(new THREE.BoxGeometry(2.0, 3.4, 5.5).rotateX(-0.12), tech ? M.carbon : M.leather, g, 0, -0.6, -6.5);
        mesh(new THREE.BoxGeometry(1.4, 3.4, 1.8), M.dark, g, 0, -2.6, 4);
        mesh(new THREE.CylinderGeometry(0.9, 0.9, 4, 10).rotateX(PI / 2), M.dark, g, 0, 2.4, 4.5);
        if (tech) mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.2, 10).rotateX(PI / 2), M.lens, g, 0, 2.4, 6.55);
      }
      if (tech) {
        // slide / shroud with vents and an emitter ring at the muzzle
        mesh(new THREE.BoxGeometry(rifle ? 2.9 : 2.5, 1.2, (len - back) * 0.45), M.carbon, g, 0, 1.9, len - (len - back) * 0.3);
        for (let k = 0; k < 3; k++) mesh(new THREE.BoxGeometry(rifle ? 3.0 : 2.6, 0.25, 0.5), M.void, g, 0, 1.4, len - 1.5 - k * 1.2);
        mesh(new THREE.TorusGeometry(0.75, 0.2, 4, 10), strip, g, 0, 0.6, len - 0.2);
      }
      mesh(new THREE.BoxGeometry(0.3, 0.35, (len - back) * 0.5), tech ? strip : (glowOn ? M.glow : M.trimCloth), g, 1.15, 0.8, back + (len - back) * 0.45);
      muzzle = new THREE.Group();
      muzzle.position.set(0, 0.6, len + 0.4);
      g.add(muzzle);
      const fl = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 7).rotateX(PI / 2).translate(0, 0, 3.5), M.flash);
      const core = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), M.flash);
      muzzle.add(fl, core);
      break;
    }
    case 'bow': {
      // limbs run up/down (+-Y) and bend toward +Z (forward)
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10 * 2 - 1; pts.push(V(0, t * len, 4 * (1 - t * t) - 0.5 * Math.abs(t))); }
      mesh(taperTube(pts.slice(0, 6), 0.45, 0.85, 6, 10), haft, g);
      mesh(taperTube(pts.slice(5), 0.85, 0.45, 6, 10), haft, g);
      if (tech) for (const s of [1, -1]) mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.6, 12).rotateZ(PI / 2), metal, g, 0, s * len, -0.5);
      mesh(new THREE.CylinderGeometry(1.0, 1.0, 3, 8), M.trimCloth, g, 0, 0, 3.8);
      bowString = [];
      for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 4), M.eye); g.add(m); bowString.push(m); }
      arrow = new THREE.Group();
      g.add(arrow);
      arrow.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 16, 5).rotateX(PI / 2).translate(0, 0, 8), M.leather));
      arrow.add(new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 5).rotateX(PI / 2).translate(0, 0, 17), metal));
      break;
    }
    case 'claws': {
      for (let i = -1; i <= 1; i++) {
        mesh(taperTube([V(i * 1.0, 0.4, 0.6), V(i * 1.3, 0.9, 3.5), V(i * 1.5, 0.4, 7.5)], 0.55, 0.06, 6, 8), L.armor === 'none' && !tech ? M.bone : metal, g);
      }
      if (tech) mesh(new THREE.BoxGeometry(3.4, 0.4, 0.5), strip, g, 0, 0.9, 0.6);
      break;
    }
    default: break;
  }
  const tmpA = new THREE.Vector3(); const tmpB = new THREE.Vector3();
  const setRod = (m, a, b) => {
    tmpA.subVectors(b, a);
    const l = tmpA.length();
    m.position.copy(a).addScaledVector(tmpA, 0.5);
    m.scale.set(1, l, 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpA.normalize());
  };
  return {
    len,
    update(P) {
      if (muzzle) muzzle.visible = !!P.muzzle;
      if (bowString) {
        const pull = tmpB.set(0, 0, -13 * (P.bowDraw || 0));
        setRod(bowString[0], new THREE.Vector3(0, len, -0.5), pull.clone());
        setRod(bowString[1], pull.clone(), new THREE.Vector3(0, -len, -0.5));
        arrow.visible = (P.bowDraw || 0) > 0;
        arrow.position.set(0, 0, -13 * (P.bowDraw || 0));
      }
    },
    glow(hand, wd, P) {
      const out = [];
      if (tech && (w === 'mace' || w === 'hammer')) out.push({ p: hand.clone().addScaledVector(wd, len + (w === 'mace' ? 1.8 : 0)), r: 8, color: L.glow || L.trim, a: 0.3 });
      if (w === 'staff' || w === 'wand') {
        const p = hand.clone().addScaledVector(wd, len + 2.5);
        out.push({ p, r: 9 + (P.cast || 0) * 10, color: L.glow || null, a: 0.35 + (P.cast || 0) * 0.4, cast: true });
      }
      if (P.muzzle && muzzle) out.push({ p: hand.clone().addScaledVector(wd, len + 2), r: 26, color: L.glow || '#ffe2a0', a: 0.85 });
      return out;
    },
  };
}

function buildOffhand(kind, g, mesh, M, L) {
  const tech = L.style === 'tech';
  if (tech && kind === 'shield') {
    // riot shield: polymer face with a viewing slot, gunmetal frame, a light line
    mesh(shieldGeom(15, 19), [M.shieldFace, M.dark], g, 0, 0, 0);
    mesh(new THREE.BoxGeometry(2.4, 6, 1.2), M.dark, g, 0, 0, -1.2);
    return { update() {} };
  }
  if (tech && kind === 'buckler') {
    // arm-mounted energy shield: emitter hub and a translucent field (FX pass, not inked)
    mesh(new THREE.CylinderGeometry(1.8, 2.2, 1.4, 8).rotateX(PI / 2), M.dark, g, 0, 0, 0.4);
    mesh(new THREE.TorusGeometry(5.6, 0.3, 4, 26), M.neon, g, 0, 0, 1.0);
    const field = mesh(new THREE.CircleGeometry(5.6, 26), new THREE.MeshBasicMaterial({
      color: (M.neon.color || new THREE.Color(0.5, 0.8, 1)).clone().multiplyScalar(0.5), transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }), g, 0, 0, 1.0);
    field.castShadow = false;
    field.userData.fx = true;
    return { update() {} };
  }
  if (tech && kind === 'orb') {
    // companion drone hovering over the hand: carbon pod, light ring, lens eye, stub rotors
    mesh(new THREE.SphereGeometry(1.9, 14, 10).scale(1, 0.8, 1.1), M.carbon, g);
    mesh(new THREE.TorusGeometry(2.1, 0.28, 4, 20).rotateX(PI / 2), M.neon, g);
    mesh(new THREE.SphereGeometry(0.75, 10, 8), M.focus, g, 0, 0.1, 1.9).castShadow = false;
    for (const s of [1, -1]) {
      mesh(new THREE.BoxGeometry(2.2, 0.3, 0.6), M.dark, g, s * 2.6, 0.4, 0);
      mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.12, 12), M.rotor || M.dark, g, s * 3.6, 0.7, 0);
    }
    return { update() {}, glow: (p) => [{ p, r: 9, color: L.glow || null, a: 0.35, cast: true }] };
  }
  if (kind === 'shield') {
    const sg = shieldGeom(15, 19);
    mesh(sg, [M.shieldFace, M.steel], g, 0, 0, 0);
    mesh(new THREE.SphereGeometry(1.9, 12, 8, 0, TAU, 0, PI / 2).rotateX(PI / 2), M.brass, g, 0, 1.2, 1.2);
    return { update() {} };
  }
  if (kind === 'buckler') {
    mesh(roundShieldGeom(5, 1.0), L.armor === 'plate' ? M.plate : M.steel, g);
    mesh(new THREE.SphereGeometry(1.5, 10, 8, 0, TAU, 0, PI / 2).rotateX(PI / 2), M.brass, g, 0, 0, 1.4);
    mesh(new THREE.TorusGeometry(4.6, 0.3, 5, 22), L.glow ? M.glow : M.brass, g, 0, 0, 0.9);
    return { update() {} };
  }
  if (kind === 'orb') {
    const o = mesh(new THREE.SphereGeometry(2.5, 16, 12), M.focus, g);
    o.castShadow = false;
    return { update() {}, glow: (p) => [{ p, r: 10, color: L.glow || null, a: 0.4, cast: true }] };
  }
  if (kind === 'pistol' || kind === 'dagger') {
    const w = buildWeapon(kind, g, mesh, M, L);
    return { update: (P) => w && w.update({ ...P, muzzle: false }) };
  }
  return null;
}

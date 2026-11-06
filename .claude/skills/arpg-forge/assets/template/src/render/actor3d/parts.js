/**
 * Geometry helpers for the code-built 3D actors. Units are logical game pixels.
 * Three.js space: +Y up, +Z forward (the way the actor faces), +X the actor's left.
 */
import * as THREE from '../../vendor/three.module.min.js';

export const PI = Math.PI;
export const TAU = PI * 2;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const smooth = (t) => t * t * (3 - 2 * t);

/** Actor space [s right, f forward, z up] -> three.js Vector3. */
export function A(p, out = new THREE.Vector3()) {
  return out.set(-p[0], p[2], p[1]);
}

/** Lathe around Y from [radius, y] pairs (bottom->top or top->bottom), squashed in Z. */
export function lathe(profile, seg = 24, zScale = 1, phiStart = 0, phiLen = TAU) {
  const prof = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  const pts = prof.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLen);
  g.scale(1, 1, zScale);
  g.computeVertexNormals();
  return g;
}

/** Tapered limb hanging down -Y from 0 to -len, rounded caps. */
export function limb(len, r0, r1, seg = 14) {
  const p = [];
  const cap = 5;
  for (let i = 0; i <= cap; i++) { const a = (i / cap) * PI / 2; p.push([r0 * Math.sin(a), r0 * 0.6 * Math.cos(a)]); }
  p.push([r0 * 1.02, -len * 0.25]);
  p.push([lerp(r0, r1, 0.6) * 1.02, -len * 0.65]);
  for (let i = cap; i >= 0; i--) { const a = (i / cap) * PI / 2; p.push([r1 * Math.sin(a), -len - r1 * 0.6 * Math.cos(a)]); }
  return lathe(p, seg);
}

/** Flared sleeve / skirt cone hanging down -Y (open both ends). */
export function cone(len, r0, r1, seg = 16, zScale = 1) {
  return lathe([[r0, 0], [lerp(r0, r1, 0.5) * 1.03, -len * 0.5], [r1, -len]], seg, zScale);
}

/** Plate shell over the front of a limb (partial lathe; phi 0 = +Z). */
export function shell(len, r0, r1, y0 = 0, arc = PI * 1.25) {
  const p = [[r0 * 0.85, y0 + 0.6], [r0, y0], [lerp(r0, r1, 0.5), y0 - len * 0.5], [r1, y0 - len], [r1 * 0.85, y0 - len - 0.6]];
  return lathe(p, 14, 1, -arc / 2, arc);
}

/** Flat facets (non-indexed + recomputed normals). */
export function faceted(g) { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; }

/** Ellipsoid centred at the origin. */
export function ellipsoid(rx, ry, rz, ws = 16, hs = 12) {
  return new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
}

/** Diamond-section blade along +Z: base at z=0, tip at z=len. curve bends it toward +Y. */
export function bladeGeom(len, w, t, curve = 0, single = false) {
  const pos = [];
  const st = 10;
  const rings = [];
  for (let i = 0; i <= st; i++) {
    const u = i / st;
    const taper = u < 0.8 ? lerp(1, 0.8, u / 0.8) : lerp(0.8, 0, (u - 0.8) / 0.2);
    const hw = (w / 2) * taper; const ht = (t / 2) * Math.max(0.35, taper);
    const cy = curve * u * u * len;
    const z = u * len;
    // single-edged: the back (+Y side) is thick and square, the edge (-Y) sharp
    rings.push(single
      ? [[ht, cy + hw * 0.9, z], [0, cy + hw, z], [-ht, cy + hw * 0.9, z], [0, cy - hw, z]]
      : [[ht, cy, z], [0, cy + hw, z], [-ht, cy, z], [0, cy - hw, z]]);
  }
  for (let i = 0; i < st; i++) {
    const a = rings[i]; const b = rings[i + 1];
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
export function shieldGeom(w = 15, h = 19) {
  const s = new THREE.Shape();
  const hw = w / 2;
  const top = h * 0.42;
  s.moveTo(-hw, top);
  s.lineTo(hw, top);
  s.bezierCurveTo(hw, top - h * 0.45, hw * 0.75, -h * 0.35, 0, -h * 0.58);
  s.bezierCurveTo(-hw * 0.75, -h * 0.35, -hw, top - h * 0.45, -hw, top);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.6, bevelSegments: 2, curveSegments: 12 });
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i);
    p.setZ(i, p.getZ(i) - 0.04 * x * x);
    uv.setXY(i, (x + hw) / w, (y + h * 0.58) / h);
  }
  g.computeVertexNormals();
  return g;
}

/** Round shield / buckler disc, face +Z, domed. */
export function roundShieldGeom(r = 6, dome = 1.2) {
  const prof = [[0.001, dome + 0.6], [r * 0.5, dome * 0.8 + 0.6], [r * 0.95, 0.6], [r, 0.2], [r * 0.96, -0.4], [r * 0.5, -0.3], [0.001, -0.2]];
  const g = lathe(prof, 24);
  g.rotateX(PI / 2);
  return g;
}

/** Tube along points (Catmull-Rom). */
export function tubeGeom(points, r, closed = false, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points, closed);
  return new THREE.TubeGeometry(curve, Math.max(10, points.length * 3), r, radial, closed);
}

/** Tapered tube (horns, claws, spines, wing bones): radius r0 at the start to r1 at the end. */
export function taperTube(points, r0, r1, radial = 7, seg = 12) {
  const curve = new THREE.CatmullRomCurve3(points);
  const fr = curve.computeFrenetFrames(seg, false);
  const pos = []; const idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const c = curve.getPointAt(u);
    const r = lerp(r0, r1, u);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * TAU;
      const n = fr.normals[i].clone().multiplyScalar(Math.cos(a)).add(fr.binormals[i].clone().multiplyScalar(Math.sin(a)));
      pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
    }
  }
  for (let i = 0; i < seg; i++) for (let k = 0; k < radial; k++) {
    const a = i * radial + k; const b = i * radial + (k + 1) % radial;
    const c = a + radial; const d = b + radial;
    idx.push(a, c, b, b, c, d);
  }
  // tip cap
  const tip = curve.getPointAt(1);
  const ti = pos.length / 3;
  pos.push(tip.x, tip.y, tip.z);
  for (let k = 0; k < radial; k++) idx.push(seg * radial + k, ti, seg * radial + (k + 1) % radial);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Points on a lathe edge: radius r at height y, elliptical zScale, phi range (phi 0 = +Z). */
export function lathePoints(r, y, zScale = 1, phiStart = 0, phiLen = TAU, n = 28) {
  const closed = phiLen >= TAU - 1e-6;
  const pts = [];
  const steps = closed ? n : n + 1;
  for (let i = 0; i < steps; i++) {
    const ph = phiStart + (phiLen * i) / n;
    pts.push(new THREE.Vector3(r * Math.sin(ph), y, r * Math.cos(ph) * zScale));
  }
  return { pts, closed };
}

/** Rolled plate edge along lathe points. */
export function rimGeom(lp, tube) {
  return tubeGeom(lp.pts, tube, lp.closed, 5);
}

/**
 * Box projection: per triangle pick the dominant axis and project onto the other two.
 * Non-indexed so each face gets its own UVs; smooth normals are kept.
 */
export function boxUV(g, tile, seed = 0) {
  const n = g.index ? g.toNonIndexed() : g;
  const p = n.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const ox = (seed * 0.6180339) % 1; const oy = (seed * 0.3819660) % 1;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const e1 = new THREE.Vector3(); const e2 = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const fn = e1.subVectors(b, a).cross(e2.subVectors(c, a));
    const ax = Math.abs(fn.x); const ay = Math.abs(fn.y); const az = Math.abs(fn.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u; let w;
      if (ax >= ay && ax >= az) { u = v.z; w = v.y; } else if (ay >= az) { u = v.x; w = v.z; } else { u = v.x; w = v.y; }
      uv[(i + k) * 2] = u / tile + ox;
      uv[(i + k) * 2 + 1] = w / tile + oy;
    }
  }
  n.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return n;
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/**
 * Place a segment object so its local -Y runs from a to b and local +Z leans toward `hint`.
 * (Limb meshes hang down -Y from their joint.)
 */
export function placeSeg(obj, a, b, hint) {
  _y.subVectors(a, b);
  const len = _y.length() || 1;
  _y.multiplyScalar(1 / len);
  _z.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_z.lengthSq() < 1e-6) { _z.set(0, 0, 1).addScaledVector(_y, -_y.z); if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0); }
  _z.normalize();
  _x.crossVectors(_y, _z);
  obj.matrix.makeBasis(_x, _y, _z).setPosition(a);
  obj.matrixWorldNeedsUpdate = true;
  return len;
}

/** Place an object at p with local +Z along dir and local +Y as close to `up` as possible. */
export function placeAlong(obj, p, dir, up) {
  _z.copy(dir).normalize();
  _y.copy(up).addScaledVector(_z, -up.dot(_z));
  if (_y.lengthSq() < 1e-6) { _y.set(0, 0, 1).addScaledVector(_z, -_z.z); if (_y.lengthSq() < 1e-6) _y.set(1, 0, 0); }
  _y.normalize();
  _x.crossVectors(_y, _z);
  obj.matrix.makeBasis(_x, _y, _z).setPosition(p);
  obj.matrixWorldNeedsUpdate = true;
}

/** A group whose matrix is set by hand each pose. */
export function manual(parent) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  parent.add(g);
  return g;
}

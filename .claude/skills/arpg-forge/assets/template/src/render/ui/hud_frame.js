/**
 * Static HUD chrome, built once per palette into cached sprites:
 *   hudFrameSprite — the bar body, rails, slot channels, gold plaque, bottom rail,
 *                    rail spikes / filigree, and both globe sockets with their
 *                    horn / claw frames (the world shows through between them);
 *   medallionSprite — the level medallion drawn over the XP groove.
 * Everything is in absolute logical screen coordinates taken from uiLayout, so
 * moving a rect in layout.js moves its art with it.
 *
 * Ornament construction: each horn / claw is a closed profile of polar points
 * around the globe centre (profilePath), smoothed into curves for
 * palette.ornament 'organic' or kept as straight facets for 'angular'. The
 * mana side is the life side mirrored with scale(-1, 1) (lighting is unaffected:
 * gradients are vertical and shadow offsets are screen-space).
 */
import { mix, lighten } from '../draw_util.js';
import { uiLayout } from './layout.js';
import { drawGlobeRing } from './widgets.js';
import {
  chromeSprite, chromeSig, roundRectPath, profilePath, polar, metal, recess, engrave, trimStroke, rivet, gem, spikePath, TAU,
} from './chrome.js';

const RAIL_H = 6;
const BOTTOM_RAIL_H = 9;
const CHANNEL_PAD = 4;

/** The whole static HUD, anchored so it blits at (0, 0). */
export function hudFrameSprite(pal) {
  const L = uiLayout;
  const top = L.hudArtTop;
  return chromeSprite(`hudframe|${chromeSig(pal)}`, L.viewW, L.viewH - top, 0, -top, (c) => buildFrame(c, pal));
}

/** Level medallion (diamond with a numeral well), anchored at its centre. */
export function medallionSprite(pal) {
  const M = uiLayout.medallion;
  return chromeSprite(`medallion|${chromeSig(pal)}`, M.w + 16, M.h + 30, M.w / 2 + 8, M.h / 2 + 22, (c) => buildMedallion(c, pal, M.w, M.h));
}

function buildFrame(c, pal) {
  const L = uiLayout;
  const org = pal.ornament !== 'angular';
  const B = L.bar;
  const T = B.y;
  const bottom = L.viewH;

  // --- grounding shade: a soft dark falloff behind the bar so it sits in the scene ---
  const sh = c.createLinearGradient(0, T - 50, 0, bottom);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  sh.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = sh;
  c.fillRect(0, T - 50, L.viewW, bottom - T + 50);

  // --- bar body ---
  const body = (k) => profilePath(k, [[B.x, bottom + 2, 1], [B.x, T + 12, 1], [B.x + 16, T, 1], [B.x + B.w - 16, T, 1], [B.x + B.w, T + 12, 1], [B.x + B.w, bottom + 2, 1]], false);
  metal(c, body, { x: B.x, y: T, w: B.w, h: bottom - T }, pal, { shadow: 8, light: 0.18, bevel: 1.2, seed: 11, color: mix(pal.metal, pal.metalDark, 0.25) });
  // engraved border panel on the bar face
  engrave(c, (k) => roundRectPath(k, B.x + 22, T + RAIL_H + 2.5, B.w - 44, bottom - T - RAIL_H - BOTTOM_RAIL_H - 4, 3), 0.6);

  // --- slot channels + gold plaque (recessed wells the slots sit in) ---
  const belt = L.belt;
  const hot = L.hotkeys;
  const beltW = belt.count * (belt.cell + belt.gap) - belt.gap;
  const hotW = hot.count * (hot.cell + hot.gap) - hot.gap;
  const chY = belt.y - CHANNEL_PAD;
  const chH = belt.cell + CHANNEL_PAD * 2;
  for (const [x, w] of [[belt.x - CHANNEL_PAD, beltW + CHANNEL_PAD * 2], [hot.x - CHANNEL_PAD, hotW + CHANNEL_PAD * 2]]) {
    const ch = (k) => roundRectPath(k, x, chY, w, chH, 4);
    recess(c, ch, { x, y: chY, w, h: chH }, pal, { depth: 4 });
    engrave(c, (k) => roundRectPath(k, x - 1.5, chY - 1.5, w + 3, chH + 3, 5), 0.5);
  }
  const G = L.goldText;
  const gp = (k) => roundRectPath(k, G.x, chY, G.w, chH, 4);
  recess(c, gp, { x: G.x, y: chY, w: G.w, h: chH }, pal, { depth: 3 });
  engrave(c, (k) => roundRectPath(k, G.x - 1.5, chY - 1.5, G.w + 3, chH + 3, 5), 0.5);
  // skill socket: a raised bezel around the readied-skill button
  const SB = L.skillButton;
  const bez = (k) => roundRectPath(k, SB.x - 4, SB.y - 4, SB.w + 8, SB.h + 8, 6);
  metal(c, bez, { x: SB.x - 4, y: SB.y - 4, w: SB.w + 8, h: SB.h + 8 }, pal, { shadow: 4, light: 0.4, bevel: 1.2, seed: 5 });
  c.save();
  c.globalAlpha = 0.9;
  trimStroke(c, (k) => roundRectPath(k, SB.x - 2, SB.y - 2, SB.w + 4, SB.h + 4, 5), pal, 0.9);
  c.restore();
  // separators between the slot groups
  const sepX = [G.x + G.w + (belt.x - CHANNEL_PAD - G.x - G.w) / 2, (belt.x + beltW + hot.x) / 2, (hot.x + hotW + SB.x - 4) / 2];
  for (const x of sepX) {
    const y = chY + chH / 2;
    const d = (k) => profilePath(k, [[x, y - 9, 1], [x + 3, y, 1], [x, y + 9, 1], [x - 3, y, 1]], false);
    metal(c, d, { x: x - 3, y: y - 9, w: 6, h: 18 }, pal, { shadow: 2, texture: false, bevel: 0.8, color: pal.metalLight, light: 0.2 });
  }

  // --- top rail with trim inlay ---
  const rail = (k) => roundRectPath(k, B.x + 10, T - 2, B.w - 20, RAIL_H, 2);
  metal(c, rail, { x: B.x + 10, y: T - 2, w: B.w - 20, h: RAIL_H }, pal, { shadow: 3, light: 0.55, bevel: 0.9, seed: 3, color: pal.metalLight });
  trimStroke(c, (k) => {
    k.moveTo(B.x + 22, T + 1);
    k.lineTo(B.x + B.w - 22, T + 1);
  }, pal, 0.9);
  // --- bottom rail with rivets ---
  const by = bottom - BOTTOM_RAIL_H;
  const brail = (k) => roundRectPath(k, B.x + 6, by, B.w - 12, BOTTOM_RAIL_H + 4, 2);
  metal(c, brail, { x: B.x + 6, y: by, w: B.w - 12, h: BOTTOM_RAIL_H }, pal, { shadow: 3, light: 0.45, bevel: 1, seed: 4, color: pal.metalLight });
  engrave(c, (k) => {
    k.moveTo(B.x + 16, by + 4.5);
    k.lineTo(B.x + B.w - 16, by + 4.5);
  }, 0.8);
  for (let x = B.x + 40; x < B.x + B.w - 30; x += 56) rivet(c, x, by + 4.5, 1.8, pal);

  // --- rail spikes / filigree between the sockets and the tabs ---
  const lb = L.leftButtons;
  const rb = L.rightButtons;
  const leftSpan = [L.lifeGlobe.cx + L.lifeGlobe.r + 14, lb.x - 6];
  const rightSpan = [rb.x + rb.count * (rb.w + rb.gap) - rb.gap + 6, L.manaGlobe.cx - L.manaGlobe.r - 14];
  for (const [x0, x1, dir] of [[leftSpan[0], leftSpan[1], 1], [rightSpan[1], rightSpan[0], -1]]) railOrnament(c, pal, x0, x1, T - 2, dir, org);
  // small spikes standing behind the tab ends and the medallion
  for (const x of [lb.x - 3, rb.x + rb.count * (rb.w + rb.gap) - rb.gap + 3]) {
    const sp = (k) => spikePath(k, x, T - 1, 12, 5, -90, org);
    metal(c, sp, { x: x - 3, y: T - 13, w: 6, h: 12 }, pal, { shadow: 2, texture: false, bevel: 0.7, light: 0.5 });
  }

  // --- globe sockets with horn frames ---
  socket(c, pal, L.lifeGlobe, 1, pal.lifeColor, org);
  socket(c, pal, L.manaGlobe, -1, pal.manaColor, org);
}

/** Filigree on the rail between a socket and the tab strip: a scroll curl and three spikes. */
function railOrnament(c, pal, x0, x1, y, dir, org) {
  const w = Math.abs(x1 - x0);
  if (w < 30) return;
  const mid = (x0 + x1) / 2;
  const sp = [[mid, 15, 6, 0], [mid - dir * w * 0.26, 9, 5, -4 * dir], [mid + dir * w * 0.26, 9, 5, 4 * dir]];
  for (const [x, len, bw, curl] of sp) {
    const p = (k) => spikePath(k, x, y + 1, len, bw, -90 + curl, org, curl * 0.4);
    metal(c, p, { x: x - bw, y: y - len, w: bw * 2, h: len }, pal, { shadow: 2.5, texture: false, bevel: 0.8, light: 0.5 });
  }
  // scroll curls (organic) or circuit traces (angular), in trim
  c.save();
  c.globalAlpha = 0.95;
  for (const s of [-1, 1]) {
    const ax = mid + s * 6;
    const ex = mid + s * w * 0.46;
    trimStroke(c, (k) => {
      if (org) {
        k.moveTo(ax, y - 1);
        k.bezierCurveTo(ax + s * w * 0.12, y - 9, ex - s * w * 0.12, y - 10, ex, y - 5);
        k.bezierCurveTo(ex + s * 3, y - 2, ex - s * 2, y + 0.5, ex - s * 3.5, y - 2.5);
      } else {
        k.moveTo(ax, y - 1);
        k.lineTo(ax + s * w * 0.1, y - 6);
        k.lineTo(ex - s * 4, y - 6);
        k.lineTo(ex, y - 2);
      }
    }, pal, 0.9);
  }
  c.restore();
  rivet(c, mid, y + 1, 1.6, pal);
}

/**
 * Globe socket at g = {cx, cy, r}: plinth, big outer horn, three crown claws,
 * an inner talon, the ring, and a jewel facing the bar. side = 1 (outer is -x) or -1.
 */
function socket(c, pal, g, side, jewel, org) {
  const R = g.r;
  c.save();
  c.translate(g.cx, g.cy);
  c.scale(side, 1);
  const bottom = uiLayout.viewH - g.cy;

  // plinth under the globe, merging into the bar
  const plinth = (k) => profilePath(k, [[-R - 30, bottom + 2, 1], [-R - 26, R * 0.35, 0], [-R * 0.6, R * 0.2, 0], [R * 0.6, R * 0.2, 0], [R + 26, 4, 0], [R + 34, 8, 1], [R + 34, bottom + 2, 1]], org);
  metal(c, plinth, { x: -R - 30, y: R * 0.1, w: R * 2 + 64, h: bottom - R * 0.1 }, pal, { shadow: 6, light: 0.25, seed: 21 });

  // outer horn: a crescent wrapping the ring from the lower outer side up over the top
  const outer = [polar(118, R + 10), polar(148, R + 27), polar(178, R + 35), polar(207, R + 34), polar(233, R + 30), polar(258, R + 36, true)];
  const inner = [polar(246, R + 12), polar(218, R + 7), polar(184, R + 5), polar(150, R + 5), polar(122, R + 4)];
  const horn = (k) => profilePath(k, [...outer, ...inner], org);
  metal(c, horn, { x: -R - 36, y: -R - 36, w: R + 40, h: R * 2 + 40 }, pal, { shadow: 7, light: 0.42, bevel: 1.6, seed: 31 });
  // horn ridges + trim spine
  for (const a of [140, 162, 186, 210, 232]) {
    const p0 = polar(a, R + 8);
    const rOut = a < 165 ? R + 22 : a < 220 ? R + 30 : R + 26;
    const p1 = polar(a + (org ? 4 : 0), rOut);
    engrave(c, (k) => {
      k.moveTo(p0[0], p0[1]);
      k.lineTo(p1[0], p1[1]);
    }, 0.8);
  }
  trimStroke(c, (k) => {
    const s = polar(130, R + 12);
    k.moveTo(s[0], s[1]);
    for (let a = 134; a <= 246; a += 4) {
      const rr = R + 13 + 6 * Math.sin(((a - 130) / 116) * Math.PI);
      const p = polar(a, rr);
      if (org) k.lineTo(p[0], p[1]);
      else if (a % 20 === 10 || a >= 246) k.lineTo(p[0], p[1]);
    }
  }, pal, 1.1);

  // crown claws on top of the ring: tapered talons leaning away from the crown's centre
  const claws = [[262, 24, 9, -14], [282, 30, 10, -6], [303, 21, 9, 10]];
  claws.forEach(([a, len, w, lean], i) => {
    const b0 = polar(a, R + 5);
    const cl = (k) => spikePath(k, b0[0], b0[1], len, w, a + lean, org, org ? lean * 0.35 : 0);
    metal(c, cl, { x: b0[0] - len, y: b0[1] - len, w: len * 2, h: len + 4 }, pal, { shadow: 4, light: 0.55, bevel: 1, seed: 40 + i, texture: false });
  });

  // inner talon rising beside the bar
  const talon = (k) => profilePath(k, [polar(330, R + 5), polar(345, R + 8), polar(352, R + 22), polar(338, R + 30), polar(320, R + 29, true), polar(328, R + 18), polar(322, R + 9)], org);
  metal(c, talon, { x: R * 0.6, y: -R * 0.6 - 30, w: 40, h: 40 }, pal, { shadow: 4, light: 0.45, bevel: 1.1, seed: 51 });

  // ring
  drawGlobeRing(c, R, pal, 9);

  // jewel facing the bar + crown stud
  const jp = polar(0, R + 6);
  c.save();
  c.scale(side, 1); // keep the highlight on the jewel's upper-left on both sides
  gem(c, jp[0] * side, jp[1], 4.2, jewel, pal);
  c.restore();
  const tp = polar(270, R + 5);
  rivet(c, tp[0], tp[1], 2.4, pal, pal.trimGlow > 0 ? null : pal.trim);
  c.restore();
}

function buildMedallion(c, pal, w, h) {
  const org = pal.ornament !== 'angular';
  const hw = w / 2;
  const hh = h / 2;
  // top spike
  const sp = (k) => spikePath(k, 0, -hh + 4, 18, 7, -90, org);
  metal(c, sp, { x: -4, y: -hh - 14, w: 8, h: 18 }, pal, { shadow: 3, texture: false, bevel: 0.8, light: 0.5 });
  const d = (k) => profilePath(k, [[0, -hh, 1], [hw * 0.55, -hh * 0.55], [hw, 0, 1], [hw * 0.55, hh * 0.55], [0, hh, 1], [-hw * 0.55, hh * 0.55], [-hw, 0, 1], [-hw * 0.55, -hh * 0.55]], false);
  metal(c, d, { x: -hw, y: -hh, w, h }, pal, { shadow: 6, light: 0.5, bevel: 1.5, seed: 61, color: pal.metalLight });
  const di = (k) => profilePath(k, [[0, -hh + 5, 1], [hw - 7, 0, 1], [0, hh - 5, 1], [-hw + 7, 0, 1]], false);
  trimStroke(c, di, pal, 1);
  const well = (k) => k.arc(0, 0, 10.5, 0, TAU);
  recess(c, well, { x: -11, y: -11, w: 22, h: 22 }, pal, { depth: 3 });
  c.save();
  c.globalAlpha = 0.9;
  trimStroke(c, (k) => k.arc(0, 0, 11.5, 0, TAU), pal, 0.8, lighten(pal.trim, 0.1));
  c.restore();
  for (const x of [-hw + 3.5, hw - 3.5]) rivet(c, x, 0, 1.7, pal);
}

// The HUD's arithmetic (src/ui/hudMath.ts): the layout at every scale on a small screen and a large
// one, with its pieces inside the window and never overlapping; the speed arc against a hull's plain
// top, its open-wing top and its boost top; the gun arc's slices; a bar's colour bands at their
// edges; the off-screen clamp and the arrow's angle for points past each edge and behind the camera;
// the damage arc's angle for eight directions round a known camera basis; and the nameplate's place
// and its cut-off.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HUD_SIZES, along, angleOf, barBand, bracketHalf, clamp01, damageAngle, edgeMark, fadeOut, gunSlice, layout, lockOffset, makeEdgeMark, makeLayout, makeNameplate, makeSpeedArc, nameplate, overlaps, pointX, pointY, speedArc, tuneSizes, type ArcSlice, type HudRect } from '../../../src/ui/hudMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const inside = (r: HudRect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

// ---------------------------------------------------------------------------------------------
// The angle convention: clockwise from twelve, screen y down.
{
  ok(near(pointX(100, 10, 0), 100) && near(pointY(100, 10, 0), 90), 'twelve o\'clock is straight up');
  ok(near(pointX(100, 10, 90), 110) && near(pointY(100, 10, 90), 100), 'ninety is three o\'clock');
  ok(near(pointY(100, 10, 180), 110), 'a hundred and eighty is six o\'clock');
  ok(near(pointX(100, 10, 270), 90), 'two hundred and seventy is nine o\'clock');
  ok(near(angleOf(0, -1), 0) && near(angleOf(1, 0), 90) && near(angleOf(0, 1), 180) && near(angleOf(-1, 0), 270), 'angleOf takes a screen offset back to the same convention');
  ok(near(along(10, 20, 0.5), 15) && along(10, 20, -1) === 10 && along(10, 20, 2) === 20, 'along runs 0 to 1 and clamps');
  ok(clamp01(-0.5) === 0 && clamp01(0.5) === 0.5 && clamp01(9) === 1, 'clamp01');
  // The three arcs never overlap: the speed span, the gun span and the boost span are disjoint.
  const spans: [number, number][] = [
    [Math.min(HUD_SIZES.speedFrom, HUD_SIZES.speedTo), Math.max(HUD_SIZES.speedFrom, HUD_SIZES.speedTo)],
    [Math.min(HUD_SIZES.gunsFrom, HUD_SIZES.gunsTo), Math.max(HUD_SIZES.gunsFrom, HUD_SIZES.gunsTo)],
    [Math.min(HUD_SIZES.boostFrom, HUD_SIZES.boostTo), Math.max(HUD_SIZES.boostFrom, HUD_SIZES.boostTo)],
  ];
  let disjoint = true;
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) if (spans[i][0] < spans[j][1] && spans[j][0] < spans[i][1]) disjoint = false;
  ok(disjoint, 'the speed, gun and booster arcs are three spans that never overlap');
}

// ---------------------------------------------------------------------------------------------
// The layout, at 0.75, 1 and 1.5, on a 1280x720 and a 3840x2160 screen.
{
  const L = makeLayout();
  const screens: [number, number][] = [
    [1280, 720],
    [3840, 2160],
  ];
  const scales = [0.75, 1, 1.5];
  let allInside = true;
  let allApart = true;
  let aimClear = true;
  let arcsIn = true;
  for (const [w, h] of screens) {
    for (const s of scales) {
      layout(w, h, s, L);
      if (!inside(L.condition, w, h) || !inside(L.message, w, h) || !inside(L.action, w, h)) allInside = false;
      if (overlaps(L.condition, L.message) || overlaps(L.action, L.message) || overlaps(L.condition, L.action)) allApart = false;
      // The aim circle is clamped so it can never touch the arcs, and the arcs stay in the window.
      if (L.aimMax > L.arcR - L.arcW / 2) aimClear = false;
      if (L.arcR + L.arcW / 2 > Math.min(w, h) / 2) arcsIn = false;
      if (!near(L.scale, s)) allInside = false;
    }
  }
  ok(allInside, 'the condition block, the message line and the action bar are inside the window at every scale on both screens');
  ok(allApart, 'and no two of them overlap');
  ok(aimClear, 'the aim circle never reaches the arcs');
  ok(arcsIn, 'the arcs never leave the window');

  layout(1280, 720, 1, L);
  ok(L.cx === 640 && L.cy === 360, 'the reticle is in the middle of the window');
  ok(near(L.arcR, HUD_SIZES.arcRadius) && near(L.aimMax, HUD_SIZES.aimMax), 'at scale 1 on a roomy screen the arcs and the aim circle are the design\'s own numbers');
  const wide = L.message.w;
  layout(1280, 720, 1.5, L);
  ok(L.message.w < wide, 'the message line is narrowed rather than allowed to reach the centre as the scale grows');

  // A window too cramped to narrow it enough: it climbs above the centred blocks instead.
  layout(800, 600, 1.5, L);
  ok(!overlaps(L.condition, L.message) && !overlaps(L.action, L.message), 'on a cramped window the message line climbs clear of both blocks');
  ok(inside(L.message, 800, 600), 'and is still on the screen');

  // The scale is held to its ends, so a bad setting cannot draw a HUD the size of the world.
  layout(1280, 720, 9, L);
  ok(near(L.scale, HUD_SIZES.scaleMax), 'a scale past the top is held at 1.5');
  layout(1280, 720, 0.1, L);
  ok(near(L.scale, HUD_SIZES.scaleMin), 'and under the bottom at 0.75');

  // Three screens and one scale prove nothing about the shapes in between: sweep the whole envelope a
  // window can be, including the short ones a docked devtools or a small laptop leaves.
  let sweptInside = true;
  let sweptApart = true;
  let worstInside = '';
  let worstApart = '';
  for (let w = 320; w <= 3840; w += 160) {
    for (let h = 240; h <= 2160; h += 120) {
      for (const s of [0.75, 1, 1.25, 1.5]) {
        layout(w, h, s, L);
        for (const [name, r] of [['condition', L.condition], ['message', L.message], ['action', L.action]] as [string, HudRect][]) {
          if (!inside(r, w, h)) {
            sweptInside = false;
            if (!worstInside) worstInside = `${name} at ${w}x${h} @${s}: {x:${Math.round(r.x)}, y:${Math.round(r.y)}, w:${Math.round(r.w)}, h:${Math.round(r.h)}}`;
          }
        }
        if (overlaps(L.condition, L.message) || overlaps(L.action, L.message) || overlaps(L.condition, L.action)) {
          sweptApart = false;
          if (!worstApart) worstApart = `${w}x${h} @${s}`;
        }
      }
    }
  }
  ok(sweptInside, `every block is inside the window over the whole sweep of sizes and scales${worstInside ? `: ${worstInside}` : ''}`);
  ok(sweptApart, `and no two of them ever overlap${worstApart ? `: ${worstApart}` : ''}`);

  // The smallest window anything is likely to be: the message column is nothing rather than a
  // rectangle above the top of the screen.
  layout(320, 240, 1.5, L);
  ok(L.message.y >= 0 && L.message.y + L.message.h <= 240, 'on a 320 by 240 window at 1.5 the message column does not leave the top');
}

// ---------------------------------------------------------------------------------------------
// The sizes the stylesheet states again. `hud.css` cannot read `HUD_SIZES`, so the numbers are in two
// files; this is what keeps them from drifting apart, the way `palette.test.ts` does for the colours.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(here, '..', '..', '..', 'src', 'ui', 'hud.css'), 'utf8');
  /** A property inside a selector's block, as `calc(N px * var(--hud-scale))`, against its size. */
  const stated: [string, string, keyof typeof HUD_SIZES][] = [
    ['.hud-cond', 'bottom', 'conditionUp'],
    ['.hud-cond .label', 'width', 'shipLabelW'],
    ['.hud-cond .row', 'gap', 'shipColGap'],
    ['.hud-cond .hud-bar', 'width', 'shipBarW'],
    ['.hud-cond .hud-bar', 'height', 'shipBarH'],
    ['.hud-tgt .hud-bar', 'width', 'targetBarW'],
    ['.hud-tgt .hud-bar', 'height', 'targetBarH'],
    ['.hud-plate .hud-bar', 'width', 'plateBarW'],
    ['.hud-plate .hud-bar', 'height', 'plateBarH'],
    ['.hud-pip', 'width', 'pipSize'],
    ['.hud-pip', 'height', 'pipSize'],
    ['.hud-pips', 'gap', 'pipGap'],
    ['.hud-msgs', 'left', 'messageLeft'],
    ['.hud-msgs', 'bottom', 'messageBottom'],
    ['.hud-msgs', 'max-width', 'messageW'],
    ['.hud-acts', 'bottom', 'actionBottom'],
    ['.hud-cap', 'min-width', 'capW'],
    ['.hud-cap', 'height', 'capH'],
  ];
  const drift: string[] = [];
  for (const [selector, prop, key] of stated) {
    const block = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    if (!block) {
      drift.push(`${selector} is not in hud.css`);
      continue;
    }
    const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:[^;]*?calc\\(\\s*([0-9.]+)px\\s*\\*\\s*var\\(--hud-scale\\)`).exec(block[1]);
    if (!m) {
      drift.push(`${selector} states no ${prop} on the HUD scale`);
      continue;
    }
    if (Number(m[1]) !== HUD_SIZES[key]) drift.push(`${selector} ${prop}: stylesheet ${m[1]}, table ${key}=${HUD_SIZES[key]}`);
  }
  ok(drift.length === 0, `every size hud.css states again is the one in HUD_SIZES${drift.length ? `: ${drift.join('; ')}` : ''}`);
  ok(/--hud-msg-w/.test(css), "and the message column's width comes from the layout through `--hud-msg-w`");
  ok(/font-stretch:\s*var\(--hud-stretch\)/.test(css), 'the instrument face is condensed, as the design asks');
}

// ---------------------------------------------------------------------------------------------
// The live knob on the sizes, which is how a number is tried without an edit and a reload.
{
  const L = makeLayout();
  const was = HUD_SIZES.conditionUp;
  ok(tuneSizes({ conditionUp: was + 40 }) === 1, 'a size is written into the table in place');
  layout(1280, 720, 1, L);
  const moved = L.condition.y;
  ok(tuneSizes({ conditionUp: was }) === 1, 'and put back');
  layout(1280, 720, 1, L);
  ok(L.condition.y - moved === 40, 'the layout follows it, and only when it is run again');
  ok(tuneSizes({ notASize: 5 } as never) === 0, 'a name that is not in the table is ignored');
  ok(tuneSizes({ conditionUp: Number.NaN }) === 0 && HUD_SIZES.conditionUp === was, 'and so is a value that is not a finite number, so a typo cannot blank the geometry');
}

// ---------------------------------------------------------------------------------------------
// The speed arc. A hull with a wing factor and a booster, one with neither.
{
  const a = makeSpeedArc();
  const top = 100;
  const boost = 140;
  const wing = 0.95;
  const from = HUD_SIZES.speedFrom;
  const to = HUD_SIZES.speedTo;

  speedArc(0, top, boost, wing, a);
  ok(a.share === 0 && near(a.angle, from), 'stopped, the needle sits at the foot of the arc');
  speedArc(top * wing, top, boost, wing, a);
  ok(near(a.angle, a.openAngle), 'at the open-wing top the needle is on the first tick');
  speedArc(top, top, boost, wing, a);
  ok(near(a.angle, a.topAngle) && near(a.share, top / boost), 'at the plain top it is on the second tick, which is not the end of the arc');
  speedArc(boost, top, boost, wing, a);
  ok(near(a.share, 1) && near(a.angle, to), 'at the boost top it reaches the end');
  speedArc(boost * 2, top, boost, wing, a);
  ok(near(a.share, 1) && near(a.angle, to), 'and past it stays there rather than running off');
  ok(a.hasBoost && near(a.boostFrom, a.topAngle) && near(a.boostTo, to), 'the boost span runs from the plain top to the end');
  ok(a.hasWing && a.wingFrom < a.wingTo && near(a.wingFrom, a.openAngle) && near(a.wingTo, a.topAngle), 'and the wings\' span sits between the two ticks');
  ok(a.openAngle < a.topAngle && a.topAngle < to, 'the two ticks are in order along the arc');

  speedArc(50, top, top, 1, a);
  ok(!a.hasBoost && !a.hasWing, 'a hull with no booster and no wing factor has neither span');
  ok(near(a.openAngle, a.topAngle) && near(a.topAngle, to), 'and its plain top is the end of the arc');
  ok(near(a.angle, along(from, to, 0.5)), 'with the needle half way at half the top speed');

  speedArc(50, top, top, wing, a);
  ok(a.hasWing && !a.hasBoost, 'wings without a booster: one span, two ticks');
  speedArc(0, 0, 0, 1, a);
  ok(Number.isFinite(a.angle) && a.share === 0, 'a hull with no speed at all does not divide by nothing');
}

// ---------------------------------------------------------------------------------------------
// The gun arc's slices.
{
  const s: ArcSlice = { from: 0, to: 0 };
  const four: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    gunSlice(i, 4, 1, s);
    four.push([s.from, s.to]);
  }
  ok(four[0][0] > HUD_SIZES.gunsFrom - 1 && four[3][1] < HUD_SIZES.gunsTo + 1, 'four slices stay inside the gun arc');
  let ordered = true;
  for (let i = 1; i < 4; i++) if (!(four[i][0] < four[i - 1][0])) ordered = false;
  ok(ordered, 'and run in order along it (the arc fills upward, so the angles fall)');
  let gapped = true;
  for (let i = 1; i < 4; i++) if (!(four[i][0] < four[i - 1][1])) gapped = false;
  ok(gapped, 'with a gap between neighbours, so a notch where a gun is down reads');
  gunSlice(0, 1, 1, s);
  ok(Math.abs(s.to - s.from) > Math.abs(HUD_SIZES.gunsTo - HUD_SIZES.gunsFrom) * 0.9, 'one gun takes nearly the whole arc');
  gunSlice(0, 0, 1, s);
  ok(Number.isFinite(s.from) && Number.isFinite(s.to), 'a ship with no guns at all does not divide by nothing');
}

// ---------------------------------------------------------------------------------------------
// A bar's colour band at its edges.
{
  ok(barBand(1) === 'good' && barBand(0.5) === 'good', 'a full or half bar is good');
  ok(barBand(HUD_SIZES.bandWarn) === 'good', 'exactly a third is still good');
  ok(barBand(HUD_SIZES.bandWarn - 1e-9) === 'warn', 'a hair under a third is caution');
  ok(barBand(HUD_SIZES.bandBad) === 'warn', 'exactly a sixth is still caution');
  ok(barBand(HUD_SIZES.bandBad - 1e-9) === 'bad' && barBand(0) === 'bad', 'under a sixth, and empty, is danger');
}

// ---------------------------------------------------------------------------------------------
// The off-screen clamp and the arrow's angle.
{
  const m = makeEdgeMark();
  const w = 1280;
  const h = 720;
  const inset = 40;
  edgeMark(700, 400, false, w, h, inset, m);
  ok(!m.off && m.x === 700 && m.y === 400, 'a target on the screen is left where it is');

  edgeMark(2000, 360, false, w, h, inset, m);
  ok(m.off && near(m.x, w - inset) && near(m.y, 360) && near(m.angle, 90), 'past the right edge it rides the inset ring at three o\'clock');
  edgeMark(-500, 360, false, w, h, inset, m);
  ok(m.off && near(m.x, inset) && near(m.angle, 270), 'past the left edge, nine o\'clock');
  edgeMark(640, -500, false, w, h, inset, m);
  ok(m.off && near(m.y, inset) && near(m.angle, 0), 'past the top, twelve o\'clock');
  edgeMark(640, 2000, false, w, h, inset, m);
  ok(m.off && near(m.y, h - inset) && near(m.angle, 180), 'past the bottom, six o\'clock');
  edgeMark(3000, -2000, false, w, h, inset, m);
  ok(m.off && m.x <= w - inset + 1e-9 && m.y >= inset - 1e-9 && m.angle > 0 && m.angle < 90, 'a corner stays on the ring and points into its quadrant');

  // Behind the camera the projection is mirrored before it is clamped, or the arrow points the wrong way.
  edgeMark(640, 100, true, w, h, inset, m);
  ok(m.off && near(m.y, h - inset) && near(m.angle, 180), 'a target behind the camera that projects high points down, not up');
  edgeMark(700, 360, true, w, h, inset, m);
  ok(m.off && near(m.angle, 270), 'and one behind that projects right points left');
  edgeMark(640, 360, true, w, h, inset, m);
  ok(m.off && Number.isFinite(m.x) && Number.isFinite(m.y), 'one exactly behind the middle still lands somewhere');
}

// ---------------------------------------------------------------------------------------------
// The damage arc: eight directions round a camera looking down -Z, right +X, up +Y.
{
  const rx = 1;
  const ry = 0;
  const rz = 0;
  const ux = 0;
  const uy = 1;
  const uz = 0;
  const fx = 0;
  const fy = 0;
  const fz = -1;
  const at = (dx: number, dy: number, dz: number) => damageAngle(dx, dy, dz, rx, ry, rz, ux, uy, uz, fx, fy, fz);
  const k = Math.SQRT1_2;
  ok(near(at(0, 0, -1), 0), 'a blow from straight ahead is at twelve');
  ok(near(at(0, 0, 1), 180), 'from straight behind, at six');
  ok(near(at(1, 0, 0), 90), 'from the right, at three');
  ok(near(at(-1, 0, 0), 270), 'from the left, at nine');
  ok(near(at(0, 1, 0), 0), 'from above, at twelve');
  ok(near(at(0, -1, 0), 180), 'from below, at six');
  ok(near(at(k, k, 0), 45), 'from up and to the right, at half past one');
  ok(near(at(-k, -k, 0), 225), 'from down and to the left, at half past seven');
  ok(near(at(k, 0, -k), 90), 'from ahead and to the right, at three: the arc shows the side, not the depth');
  ok(near(at(0.01, 0, -1), 0), 'a blow all but straight ahead is not thrown to one side by a rounding error');
  ok(near(at(0.01, 0, 1), 180), 'nor one all but straight behind');
  let round = true;
  for (let d = 0; d < 360; d += 15) {
    const a = at(Math.sin((d * Math.PI) / 180), Math.cos((d * Math.PI) / 180), 0);
    if (!near(a, d % 360, 1e-6)) round = false;
  }
  ok(round, 'and every fifteen degrees round the screen comes back as itself');
}

// ---------------------------------------------------------------------------------------------
// The nameplate.
{
  const p = makeNameplate();
  const range = HUD_SIZES.nameplateRange;
  nameplate(640, 300, false, 10, range, 1280, 720, p);
  ok(p.show && p.x === 640 && p.y === 300, 'a creature in front and in range gets a plate where its head is');
  nameplate(640, 300, true, 10, range, 1280, 720, p);
  ok(!p.show, 'one behind the camera gets none');
  nameplate(640, 300, false, range + 0.1, range, 1280, 720, p);
  ok(!p.show, 'one past the range gets none');
  nameplate(640, 300, false, range, range, 1280, 720, p);
  ok(p.show, 'one exactly at the range still does');
  nameplate(-200, 300, false, 10, range, 1280, 720, p);
  ok(!p.show, 'and one off the side is not clamped to the edge: a plate is a readout, not a pointer');
}

// ---------------------------------------------------------------------------------------------
// The bracket, the lock and the fades.
{
  ok(near(bracketHalf(10, 1), HUD_SIZES.bracketMin / 2), 'a distant hull still gets a bracket of the smallest size');
  ok(near(bracketHalf(9999, 1), HUD_SIZES.bracketMax / 2), 'and a capital ship close up does not frame the window');
  ok(near(bracketHalf(100, 1), 50), 'in between it is the projected size');
  ok(near(bracketHalf(10, 1.5), (HUD_SIZES.bracketMin * 1.5) / 2), 'and the ends take the HUD scale');

  ok(near(lockOffset(0, 1), HUD_SIZES.lockFrom), 'the lock starts with the corners out');
  ok(lockOffset(HUD_SIZES.lockSeconds / 2, 1) < HUD_SIZES.lockFrom, 'and closes');
  ok(lockOffset(HUD_SIZES.lockSeconds, 1) === 0 && lockOffset(99, 1) === 0, 'and ends closed and stays closed');

  ok(fadeOut(0, 8, 1) === 1 && fadeOut(7, 8, 1) === 1, 'a message holds full for seven of its eight seconds');
  ok(near(fadeOut(7.5, 8, 1), 0.5), 'then fades over the last one');
  ok(fadeOut(8, 8, 1) === 0 && fadeOut(99, 8, 1) === 0, 'and is gone at the end');
  ok(fadeOut(0.5, 1, 0) === 1, 'a fade of nothing never divides by nothing');
}

console.log(`\n${checks} checks passed`);

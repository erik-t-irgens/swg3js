// Where the sun's three shadow maps end (src/world/shadowSplits.ts). The owner's fault: three's own `practical` split put
// every map's end at a share of the whole shadow distance, so raising the distance stretched the near map too and the
// shadows round the player blurred. Run with three's real `CSM` in node at the game's camera: under the near rule the near
// map's box, and so its texel, is the same at every shadow distance the Graphics page offers, where under three's split it
// grows with the distance; the old split is still there to compare, to the bit; the tune refuses and holds what it must and
// moves its version only on a change; and the game builds its cascades with the rule, refits them when the tune moves and
// gives each map its own share of the softness (read as text, since the world does not load under node).
//
// Synthetic: the game's camera and cascade numbers, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { SHADOW_SPLIT_TUNE, shadowSplitsVersion, softShare, splitBreaks, splitEnds, tuneShadowSplits, type ShadowSplitTune } from '../../../src/world/shadowSplits.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const TUNE0 = JSON.stringify(SHADOW_SPLIT_TUNE);
const near: ShadowSplitTune = { scheme: 'near', nearReach: 16, midReach: 0, soft: [1, 1, 1] };
const practical: ShadowSplitTune = { ...near, scheme: 'practical' };

/** Three's real cascades at the game's camera (60 degrees, 1600x900, near 0.05) for a shadow distance, under a split. */
function cascades(distance: number, tune: ShadowSplitTune | 'three'): { breaks: number[]; texelCm: number[] } {
  const camera = new THREE.PerspectiveCamera(60, 1600 / 900, 0.05, 9000);
  const options = tune === 'three'
    ? { mode: 'practical' as const }
    : { mode: 'custom' as const, customSplitsCallback: (a: number, n: number, f: number, t: number[]) => splitBreaks(a, n, f, tune, t) };
  const csm = new CSM({ camera, parent: new THREE.Scene(), cascades: 3, maxFar: distance, shadowMapSize: 2048, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 2, lightMargin: 150, lightNear: 1, lightFar: 150 + distance, ...options });
  csm.updateFrustums();
  return { breaks: [...csm.breaks], texelCm: csm.lights.map((l) => ((l.shadow.camera.right - l.shadow.camera.left) / 2048) * 100) };
}

// ---- 1. three's own split is kept exactly, to compare ----
{
  let worst = 0;
  for (const d of [80, 160, 320, 560, 800]) {
    const ours = cascades(d, practical).breaks;
    const three = cascades(d, 'three').breaks;
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(ours[i] - three[i]));
  }
  ok(worst < 1e-12, `scheme 'practical' is three's own split to the bit at every page distance (worst ${worst.toExponential(1)})`);
}

// ---- 2. the near rule: the near map the same at every distance, where three's grows with it ----
{
  const dists = [80, 320, 800];
  const ours = dists.map((d) => cascades(d, near));
  const three = dists.map((d) => cascades(d, 'three'));
  const nearCm = ours.map((c) => c.texelCm[0]);
  const threeCm = three.map((c) => c.texelCm[0]);
  ok(Math.max(...nearCm) - Math.min(...nearCm) < 1e-6, `the near map's texel is the same at 80, 320 and 800 m (${nearCm.map((v) => v.toFixed(2)).join(', ')} cm)`);
  ok(nearCm[0] < 2.5, `and fine: about 2 cm at a 16 m reach (${nearCm[0].toFixed(2)} cm)`);
  ok(threeCm[2] > threeCm[0] * 5, `where three's split blurs it with the distance (${threeCm.map((v) => v.toFixed(2)).join(', ')} cm at 80, 320 and 800 m): the owner's fault`);
  ok(ours.every((c) => c.texelCm[0] < c.texelCm[1] && c.texelCm[1] < c.texelCm[2]), 'near good, middle OK, far a suggestion: each map coarser than the one before at every distance');
  const ends320 = splitEnds(3, 0.05, 320, near);
  const ends800 = splitEnds(3, 0.05, 800, near);
  ok(Math.abs(ends320[0] - 16) < 1e-9 && Math.abs(ends800[0] - 16) < 1e-9, 'the near map ends at its reach whatever the distance');
  ok(Math.abs(ends320[1] - Math.sqrt(16 * 320)) < 1e-9 && Math.abs(ends800[1] - Math.sqrt(16 * 800)) < 1e-9, `the middle ends where the near reach and the distance meet on a log scale (${ends320[1].toFixed(1)} m at 320, ${ends800[1].toFixed(1)} m at 800)`);
  ok(ends320[2] === 320 && ends800[2] === 800, 'and the far map takes the rest, to the shadow distance');
  const mid = splitEnds(3, 0.05, 320, { ...near, midReach: 100 });
  ok(Math.abs(mid[1] - 100) < 1e-9, 'a middle reach given is where the middle map ends');
}

// ---- 3. the breaks stay in order whatever the knobs say, and a short distance keeps three's split ----
{
  const bad: string[] = [];
  for (const d of [80, 120, 320, 800, 2000]) {
    for (const r of [2, 8, 16, 30, 60]) {
      for (const m of [0, 1, 20, 100, 3000]) {
        const b: number[] = [];
        splitBreaks(3, 0.05, d, { ...near, nearReach: r, midReach: m }, b);
        const fine = b.length === 3 && b[2] === 1 && b[0] > 0 && b[0] < b[1] && b[1] < b[2] && b.every(Number.isFinite);
        if (!fine) bad.push(`${d}/${r}/${m}: ${b.join(',')}`);
      }
    }
  }
  ok(bad.length === 0, `every break is in order, above nought and short of the far end, over 125 knob settings (${bad.slice(0, 3).join('; ') || 'all'})`);
  const short: number[] = [];
  const three: number[] = [];
  splitBreaks(3, 0.05, 30, near, short);
  splitBreaks(3, 0.05, 30, practical, three);
  ok(short.join() === three.join(), 'a shadow distance under twice the near reach keeps three\'s split, which is sharp enough there');
}

// ---- 4. the tune: refusals, holds, the version moved only by a change ----
{
  const v0 = shadowSplitsVersion();
  ok(tuneShadowSplits({ nearReach: 16 }).length === 0 && shadowSplitsVersion() === v0, 'setting a number to what it is moves nothing');
  ok(tuneShadowSplits({ nearReach: 24 }).length === 0 && shadowSplitsVersion() === v0 + 1 && SHADOW_SPLIT_TUNE.nearReach === 24, 'a new near reach is taken and moves the version once');
  const held = tuneShadowSplits({ nearReach: 999, midReach: -5, soft: { 2: 9 } });
  ok(held.length === 3 && SHADOW_SPLIT_TUNE.nearReach === 200 && SHADOW_SPLIT_TUNE.midReach === 0 && SHADOW_SPLIT_TUNE.soft[2] === 4, `out of range is held at the edge and said (${held.join(' | ')})`);
  const refused = tuneShadowSplits({ scheme: 'fast', nearReach: 'x', soft: 3, wide: 1 });
  ok(refused.length === 4, `nonsense is refused in words (${refused.join(' | ')})`);
  tuneShadowSplits({ soft: [1.5, 2] });
  ok(softShare(0) === 1.5 && softShare(1) === 2 && softShare(2) === 4 && softShare(7) === 1, 'the softness shares by map, 1 past the table');
  tuneShadowSplits({ scheme: 'practical' });
  ok(SHADOW_SPLIT_TUNE.scheme === 'practical', "scheme 'practical' puts three's split back");
  Object.assign(SHADOW_SPLIT_TUNE, JSON.parse(TUNE0));
}

// ---- 5. the game's wiring (text: the world does not load under node) ----
{
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  ok(/mode: 'custom', customSplitsCallback: \(amount: number, near: number, far: number, target: number\[\]\) => splitBreaks\(amount, near, far, SHADOW_SPLIT_TUNE, target\)/.test(world), "the game's cascades are built with the split rule and the live tune");
  const upd = world.slice(world.indexOf('updateShadows(now: number): void {'));
  const refit = upd.indexOf('if (this.splitsApplied !== shadowSplitsVersion())');
  ok(refit > 0 && refit < upd.indexOf('csm.update();') && /csm\.updateFrustums\(\);\s*this\.applyShadowQuality\(\);/.test(upd.slice(refit, refit + 300)), 'a moved tune refits the cascades once, before the frame\'s fit, and draws every map whole');
  ok(/l\.shadow\.radius = this\.shadowRadius \* softShare\(/.test(world), "each map's blur is the page's softness times its own share");
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(/opts\?\.splits \? tuneShadowSplits\(opts\.splits\)/.test(main), "`__debug.shadowPass({ splits })` moves the tune through the one setter");
}

console.log(`\n${checks} checks passed`);

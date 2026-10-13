// The leaf cards lit by the client's own light (`src/world/cardLight.ts`, its mirror `src/world/cardLightMath.ts`):
//
//   1. the client's sum at N·L −1, −0.5, 0, 0.5 and 1, with and without a shadow factor, the fills and an
//      emissive, against the arithmetic written out by hand;
//   2. the curve: three's ACES fit carried back and forward again round-trips to the byte over a grid of texels
//      and N·L, and the cap holds every card under the bloom pass's threshold;
//   3. every converted world's own grade look swept: a card's brightness lands within 5 bytes of the client's
//      through the world's grade, the worst channel said;
//   4. the rows at column 64 of every converted pack: front ≥ tangent ≥ back on at least 44 of 50 distinct ground
//      ramps and row 9's hue nearer row 1's than row 5's on at least 39, the exceptions named (a regression guard,
//      not proof of what the rows mean); 3 and 4 read the rows `CARD_ROWS` names;
//   4b. what the game hands the shader: a ramp of known bytes read through `readCardRows` (the sky's own call, its
//      text pinned) and handed to `updateCardLight` lands in every uniform as its row's bytes over 255, times the
//      row's light scale under `rampScale: 'alpha'`, at the rows the tune names live; and a rooms pass puts the light
//      out and back;
//   5. the two sides in the mirror: under `'face'` a mirrored copy's d is its twin's negated for any sun, under
//      `'stored'` its twin's own; the stored normal out of the plane is the converted one; `pointFlat` 0 keeps the
//      normal, 1 gives the face, and no blend yields a zero or a NaN;
//   6. the transformed text, on the real `CSMShader.lights_fragment_begin`: the two lookups the cascades make
//      edited and their `receiveShadow` guards intact, three's light put out before exactly the three sun
//      `RE_Direct` calls and the one in the loop of lights that cast no shadow, the no-cascade branch byte for
//      byte, the card light before the wet sheen, the face blend once straight after `geometryNormal` is declared,
//      the stored normal's varying written once and read only by the sum, the shadow offset turned toward the light
//      on the directional lookups and not on a spot's, every replacement counted, a chunk missing an anchor left
//      as it was and said, no name declared twice, and wrapping twice adding nothing.
//
// Run: node tools/swg/tests/cardLight.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CSMShader } from 'three/examples/jsm/csm/CSMShader.js';
import { applyGradePixel, createGradeParams, createGradeSource, deriveGrade, lookFor, type Vec3 } from '../../../src/core/fx/gradeMath.ts';
import { CARD_LIGHT_STATS, CARD_LIGHT_SUM, CARD_LIGHT_TUNE, CARD_LIGHT_UNIFORMS, CARD_ROWS, SHADOW_OFFSET, SHADOW_OFFSET_CARD, injectCardLight, readCardRows, setCardLightTune, setCardRoomPass, updateCardLight, type CardSkyRows, type RampRead } from '../../../src/world/cardLight.ts';
import { CARD_ROWS_DEFAULT } from '../../../src/world/cardLightMath.ts';
import { acesForward, acesInverse, capBloom, clientDisplay, clientLight, clientScene, displayOf, linearToSrgb, luminance, pointFlatNormal, sideDot, srgbToLinear, storedNormal, type CardColours, type Rgb } from '../../../src/world/cardLightMath.ts';
import { applyCard } from '../../../src/world/cardRule.ts';
import { cardLightsBegin } from '../../../src/world/leafShadow.ts';
import { applySpec } from '../../../src/world/specular.ts';
import { applyWetness } from '../../../src/world/wetness.ts';
import { glslVariant, redeclared } from './glslScan.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const C: CardColours = { front: [0.96, 0.82, 0.62], tangent: [0.64, 0.55, 0.48], back: [0.11, 0.1, 0.11], ambient: [0.02, 0.02, 0.03], fill: [0.2, 0.25, 0.3], bounce: [0.1, 0.08, 0.05], shadow: [0.07, 0.07, 0.09], shadowAlpha: 0.32 };
const T = { fills: 'both' as const, emissive: true, gain: 1, shadowLook: 'rise' as const };
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- 1. the sum

{
  const hand = (d: number, shadow: number, fillDot: number, bounceDot: number, em: Rgb, k: number): number => {
    const main = d >= 0 ? C.tangent[k] + (C.front[k] - C.tangent[k]) * d * shadow : C.tangent[k] + (C.back[k] - C.tangent[k]) * -d;
    return Math.min(1, Math.max(0, C.ambient[k] + em[k] + C.fill[k] * Math.max(fillDot, 0) + C.bounce[k] * Math.max(bounceDot, 0) + main));
  };
  let worst = 0;
  for (const d of [-1, -0.5, 0, 0.5, 1]) {
    for (const shadow of [1, 0.4, 0]) {
      for (const [fd, bd] of [[0, 0], [0.7, -0.2], [-0.5, 0.9]]) {
        for (const em of [[0, 0, 0], [0.421, 0.421, 0.421]] as Rgb[]) {
          const g = clientLight(C, { d, shadow, fillDot: fd, bounceDot: bd, emissive: em }, T);
          for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(g[k] - hand(d, shadow, fd, bd, em, k)));
        }
      }
    }
  }
  ok(worst < 1e-12, "the client's sum at N·L −1 to 1, shaded or not, with the fills and an emissive, is the arithmetic by hand");
  const edge = clientLight(C, { d: 0, shadow: 1, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, { ...T, fills: 'none' });
  const away = clientLight(C, { d: -1, shadow: 1, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, { ...T, fills: 'none' });
  const sun = clientLight(C, { d: 1, shadow: 1, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, { ...T, fills: 'none' });
  ok(near(edge[0], C.tangent[0] + C.ambient[0]) && near(away[1], C.back[1] + C.ambient[1]) && near(sun[2], C.front[2] + C.ambient[2]), 'edge-on is the tangent colour, turned away the back, toward the sun the front: never black past the terminator');
  const shaded = clientLight(C, { d: 1, shadow: 0, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, { ...T, fills: 'none' });
  ok(near(shaded[0], edge[0]), "under 'rise' a shaded leaf facing the sun drops to the tangent colour, not to black");
  const row7 = clientLight(C, { d: 1, shadow: 0, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, { ...T, fills: 'none', shadowLook: 'row7' });
  ok(near(row7[0], sun[0]), "under 'row7' the light keeps its rise, and the shadow is the display's blend toward row 7 instead");
  const disp = clientDisplay([0.5, 0.5, 0.5], row7, C, 0, 'row7');
  ok(near(disp[0], 0.5 * row7[0] + (C.shadow[0] - 0.5 * row7[0]) * C.shadowAlpha), 'which blends by row 7\'s alpha where no sun gets through');
  const fillNone = clientLight(C, { d: 0, shadow: 1, fillDot: 1, bounceDot: 1, emissive: [0, 0, 0] }, { ...T, fills: 'none' });
  const fillOne = clientLight(C, { d: 0, shadow: 1, fillDot: 1, bounceDot: 1, emissive: [0, 0, 0] }, { ...T, fills: 'fill' });
  ok(near(fillOne[0] - fillNone[0], C.fill[0]) && near(clientLight(C, { d: 0, shadow: 1, fillDot: 1, bounceDot: 1, emissive: [0, 0, 0] }, T)[0] - fillOne[0], C.bounce[0]), "'fill' adds row 3 alone, 'both' row 4 as well");
}

// ---------------------------------------------------------------- 2. the curve

{
  let worst = 0;
  let worstAt = '';
  for (const tex of [[38, 59, 27], [60, 65, 45], [73, 95, 62], [95, 100, 57], [150, 170, 120], [200, 200, 200], [240, 230, 210], [5, 8, 3]]) {
    for (const d of [1, 0.38, 0, -0.38, -1]) {
      const g = clientLight(C, { d, shadow: 1, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, { ...T, fills: 'none' });
      const want = clientDisplay([tex[0] / 255, tex[1] / 255, tex[2] / 255], g, C, 1, 'rise');
      const scene = clientScene(want, { exposureRef: 1, bloomCap: Infinity });
      const back = displayOf(scene);
      const e = Math.max(...[0, 1, 2].map((k) => Math.abs(back[k] - want[k]) * 255));
      if (e > worst) {
        worst = e;
        worstAt = `${tex} at ${d}`;
      }
    }
  }
  ok(worst < 0.5, `three's fit carried back and forward again gives the client's own bytes (worst ${worst.toFixed(3)} of a byte, ${worstAt})`);
  ok(displayOf(acesInverse([0, 0, 0])).every((v) => v * 255 < 0.5) && acesInverse([2, -1, 0.5]).every((v) => Number.isFinite(v) && v >= 0), 'the inverse is fed clamped values only: black comes back black on the screen, and nothing it is handed makes a NaN');
  const one = acesInverse([1, 1, 1]);
  ok(luminance(one) > 10, `a display of one inverts to a scene value past ten (${luminance(one).toFixed(1)}), which is why the cap exists`);
  let over = 0;
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const t = i / 20;
      const gl = j / 20;
      const s = clientScene([Math.min(1, t * (0.5 + gl)), t, Math.min(1, t * gl * 1.5)], CARD_LIGHT_TUNE);
      if (luminance(s) > CARD_LIGHT_TUNE.bloomCap + 1e-9) over++;
    }
  }
  ok(over === 0 && CARD_LIGHT_TUNE.bloomCap < 0.85, `the cap holds every card under the bloom pass's 0.85 (at ${CARD_LIGHT_TUNE.bloomCap})`);
  ok(near(capBloom([2, 2, 2], 0.84)[0], 0.84) && capBloom([0.1, 0.2, 0.3], 0.84)[2] === 0.3, 'and scales a colour down whole, never clipping a channel');
  ok([0.002, 0.04, 0.37, 0.9].every((v) => near(linearToSrgb(v), new THREE.Color(v, v, v).convertLinearToSRGB().r, 1e-12) && near(srgbToLinear(v), new THREE.Color(v, v, v).convertSRGBToLinear().r, 1e-12)), "the colour spaces are three's own, to the bit");
  ok(near(srgbToLinear(linearToSrgb(0.37)), 0.37, 1e-4), 'and undo each other (to three\'s own 0.41666 for 1/2.4)');
  ok(near(acesForward([0.18, 0.18, 0.18])[0], acesForward([0.18, 0.18, 0.18], 1)[0]), 'the fit runs at exposure 1 unless told');
}

// ---------------------------------------------------------------- 3 and 4. the packs: every world's grade, every ramp

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const lin = (b: number) => srgbToLinear(b / 255);
const lumBytes = (p: number[]) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);

{
  const ramps = new Map<string, { where: string; bytes: Buffer }>();
  const worlds: { pack: string; px: (row: number, col: number) => number[] }[] = [];
  if (existsSync(PACKS)) {
    for (const pack of readdirSync(PACKS)) {
      const file = join(PACKS, pack, 'sky.json');
      if (!existsSync(file) || pack === 'gallery') continue;
      let sky: { space?: unknown; blocks?: { name: string; weatherIndex?: number; ramp?: { rows: number; rgba: string } }[] };
      try {
        sky = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      if (sky.space) continue;
      let first: Buffer | null = null;
      for (const b of sky.blocks ?? []) {
        if (!b.ramp || b.ramp.rows < 10) continue;
        const bytes = Buffer.from(b.ramp.rgba, 'base64');
        if (!ramps.has(b.ramp.rgba)) ramps.set(b.ramp.rgba, { where: `${pack}:${b.name}`, bytes });
        if (!first && (b.weatherIndex ?? 0) === 0) first = bytes;
      }
      if (first) {
        const bytes = first;
        worlds.push({ pack, px: (row, col) => Array.from(bytes.subarray((row * 256 + col) * 4, (row * 256 + col) * 4 + 4)) });
      }
    }
  }
  if (!worlds.length) console.log(`skip the worlds: no converted sky under ${PACKS}`);
  else {
    // 3. Every world's grade: a card's brightness through the grade against the client's, at noon.
    let worstLum = 0;
    let worstLumAt = '';
    let worstChannel = 0;
    let worstChannelAt = '';
    for (const w of worlds) {
      const scale = (a: number) => Math.max(0, (4 * (a - 128)) / 128);
      // The grade's source as before; the card's colours at the rows the card light itself reads (`CARD_ROWS`).
      const r1 = w.px(1, 64);
      const r9 = w.px(9, 64);
      const r6 = w.px(6, 64);
      const cf = w.px(CARD_ROWS.front, 64);
      const ct = w.px(CARD_ROWS.tangent, 64);
      const cb = w.px(CARD_ROWS.back, 64);
      const src = createGradeSource();
      src.key = [lin(r1[0]) * scale(r1[3]), lin(r1[1]) * scale(r1[3]), lin(r1[2]) * scale(r1[3])] as Vec3;
      src.fill = [lin(r9[0]) * scale(r9[3]), lin(r9[1]) * scale(r9[3]), lin(r9[2]) * scale(r9[3])] as Vec3;
      src.air = [lin(r6[0]), lin(r6[1]), lin(r6[2])] as Vec3;
      src.night = 0;
      src.space = false;
      const P = deriveGrade(src, lookFor(w.pack.replace(/_.*$/, '')), 1, createGradeParams());
      const cols: CardColours = { ...C, front: [cf[0] / 255, cf[1] / 255, cf[2] / 255], tangent: [ct[0] / 255, ct[1] / 255, ct[2] / 255], back: [cb[0] / 255, cb[1] / 255, cb[2] / 255], ambient: [0, 0, 0], fill: [0, 0, 0], bounce: [0, 0, 0] };
      for (const tex of [[38, 59, 27], [73, 95, 62], [95, 100, 57], [150, 170, 120]]) {
        for (const d of [1, 0.38, 0, -0.38, -1]) {
          const g = clientLight(cols, { d, shadow: 1, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, T);
          const want = clientDisplay([tex[0] / 255, tex[1] / 255, tex[2] / 255], g, cols, 1, 'rise');
          const scene = clientScene(want, { exposureRef: 1, bloomCap: Infinity });
          const graded = applyGradePixel(scene as unknown as Vec3, P, 1, [0, 0, 0] as Vec3);
          const shown = displayOf(graded as unknown as Rgb);
          const lumErr = Math.abs(luminance(shown.map(srgbToLinear) as Rgb) - luminance(want.map(srgbToLinear) as Rgb));
          const lumBytesErr = Math.abs(linearToSrgb(luminance(shown.map(srgbToLinear) as Rgb)) - linearToSrgb(luminance(want.map(srgbToLinear) as Rgb))) * 255;
          void lumErr;
          if (lumBytesErr > worstLum) {
            worstLum = lumBytesErr;
            worstLumAt = `${w.pack} ${tex} at ${d}`;
          }
          const ch = Math.max(...[0, 1, 2].map((k) => Math.abs(shown[k] - want[k]) * 255));
          if (ch > worstChannel) {
            worstChannel = ch;
            worstChannelAt = `${w.pack} ${tex} at ${d}`;
          }
        }
      }
    }
    ok(worstLum <= 5, `through each world's own grade a card's brightness lands within 5 bytes of the client's (${worlds.length} worlds; worst ${worstLum.toFixed(2)}, ${worstLumAt})`);
    console.log(`     the worst channel through a grade: ${worstChannel.toFixed(1)} bytes (${worstChannelAt}): the grade's own mood moving the hue`);
    // 4. The rows at noon over every distinct ground ramp.
    const n = ramps.size;
    let ordered = 0;
    let hue = 0;
    const notOrdered: string[] = [];
    const notHue: string[] = [];
    const chroma = (p: number[]) => {
      const s = p[0] + p[1] + p[2];
      return s < 6 ? null : [p[0] / s, p[1] / s, p[2] / s];
    };
    for (const r of ramps.values()) {
      const px = (row: number) => Array.from(r.bytes.subarray((row * 256 + 64) * 4, (row * 256 + 64) * 4 + 4));
      const f = lumBytes(px(CARD_ROWS.front));
      const t = lumBytes(px(CARD_ROWS.tangent));
      const b = lumBytes(px(CARD_ROWS.back));
      if (f >= t && t >= b) ordered++;
      else notOrdered.push(r.where);
      const c1 = chroma(px(CARD_ROWS.front));
      const c5 = chroma(px(5));
      const c9 = chroma(px(CARD_ROWS.tangent));
      if (c1 && c5 && c9 && Math.hypot(c9[0] - c1[0], c9[1] - c1[1], c9[2] - c1[2]) < Math.hypot(c9[0] - c5[0], c9[1] - c5[1], c9[2] - c5[2])) hue++;
      else notHue.push(r.where);
    }
    ok(ordered >= Math.ceil((44 / 50) * n), `front ≥ tangent ≥ back at noon on ${ordered} of the ${n} distinct ground ramps (the measured 44 of 50); not on: ${notOrdered.join(', ')}`);
    ok(hue >= Math.ceil((39 / 50) * n), `row 9's hue nearer the sun's (row 1) than the sky's (row 5) on ${hue} of ${n} (the measured 39 of 50); not on ${notHue.length}: ${notHue.slice(0, 6).join(', ')}${notHue.length > 6 ? ', ...' : ''}`);
  }
}

// ---------------------------------------------------------------- 4b. from the sky's ramp to the shader's uniforms

{
  // A ramp of one block, every row a colour and an alpha of its own, read as the sky reads one: its bytes as sRGB
  // into linear light, the light scale its alpha stores (4 × (a − 128) / 128, never under nought), the alpha over
  // 255, all at the frame's column.
  const column = 77;
  const bytes = (row: number): number[] => [(20 + row * 23) % 256, (210 - row * 17) % 256, (60 + row * 41) % 256, 120 + row * 13];
  let wrongColumn = 0;
  const ramp: RampRead = {
    color: (row, index, out) => {
      if (index !== column) wrongColumn++;
      const b = bytes(row);
      return out.setRGB(b[0] / 255, b[1] / 255, b[2] / 255, THREE.SRGBColorSpace);
    },
    scale: (row, index) => {
      if (index !== column) wrongColumn++;
      return Math.max(0, (4 * (bytes(row)[3] - 128)) / 128);
    },
    alpha: (row, index) => {
      if (index !== column) wrongColumn++;
      return bytes(row)[3] / 255;
    },
  };
  const blank = (): CardSkyRows => ({ front: new THREE.Color(), tangent: new THREE.Color(), back: new THREE.Color(), ambient: new THREE.Color(), fill: new THREE.Color(), bounce: new THREE.Color(), shadow: new THREE.Color(), frontScale: 0, tangentScale: 0, backScale: 0, ambientScale: 0, fillScale: 0, bounceScale: 0, shadowAlpha: 0 });
  const u = CARD_LIGHT_UNIFORMS;
  const fields: [keyof typeof CARD_ROWS, THREE.Vector3][] = [
    ['front', u.uSwgCardFront.value],
    ['tangent', u.uSwgCardTangent.value],
    ['back', u.uSwgCardBack.value],
    ['ambient', u.uSwgCardAmbient.value],
    ['fill', u.uSwgCardFill.value],
    ['bounce', u.uSwgCardBounce.value],
    ['shadow', u.uSwgCardRow7.value],
  ];
  /** How far each uniform is from its row's bytes over 255 (times the row's scale under `'alpha'`, never for the shadow's colour), in bytes. */
  const worstOff = (rampScale: 'bytes' | 'alpha'): { worst: number; at: string } => {
    let worst = 0;
    let at = '';
    for (const [k, v] of fields) {
      const b = bytes(CARD_ROWS[k]);
      const s = rampScale === 'alpha' && k !== 'shadow' ? Math.max(0, (4 * (b[3] - 128)) / 128) : 1;
      const off = Math.max(Math.abs(v.x * 255 - b[0] * s), Math.abs(v.y * 255 - b[1] * s), Math.abs(v.z * 255 - b[2] * s));
      if (off > worst) {
        worst = off;
        at = k;
      }
    }
    return { worst, at };
  };
  const was = { ...CARD_LIGHT_TUNE, rows: { ...CARD_ROWS } };
  const sun = new THREE.Vector3(0.3, 0.8, -0.2);
  setCardLightTune({ rampScale: 'bytes' });
  updateCardLight(readCardRows(blank(), ramp, column), sun, 300);
  const plain = worstOff('bytes');
  ok(wrongColumn === 0 && plain.worst < 0.01, `every card uniform is its row's own bytes over 255, read at the frame's column (worst ${plain.worst.toExponential(1)} of a byte${plain.at ? `, ${plain.at}` : ''})`);
  ok(Math.abs(u.uSwgCardRow7Alpha.value - bytes(CARD_ROWS.shadow)[3] / 255) < 1e-12, "and the shadow row's alpha over 255");
  setCardLightTune({ rampScale: 'alpha' });
  updateCardLight(readCardRows(blank(), ramp, column), sun, 300);
  const scaled = worstOff('alpha');
  ok(scaled.worst < 0.01, `under rampScale 'alpha' each times the light scale its own row's alpha stores (worst ${scaled.worst.toExponential(1)} of a byte)`);
  // The rows the tune names are the rows read: moved, the front takes the row it is moved to.
  setCardLightTune({ rampScale: 'bytes', rows: { front: 5, tangent: 2 } });
  updateCardLight(readCardRows(blank(), ramp, column), sun, 300);
  const moved = worstOff('bytes');
  const b5 = bytes(5);
  ok(moved.worst < 0.01 && Math.abs(u.uSwgCardFront.value.x * 255 - b5[0]) < 0.01, 'the rows are the ones the tune names, live: moved, the front reads the row it was moved to');
  setCardLightTune({ ...was, rows: { ...CARD_ROWS_DEFAULT } });
  ok(JSON.stringify(CARD_ROWS) === JSON.stringify(CARD_ROWS_DEFAULT) && CARD_ROWS.front === 1 && CARD_ROWS.tangent === 9 && CARD_ROWS.back === 8, 'the rows ship as front 1, tangent 9, back 8 (and ambient 0, fill 3, bounce 4, shadow 7)');
  // The sun handed over is the one the leaf skip turns into each model's frame, unit; the range is the light's depth.
  ok(Math.abs(u.uSwgLeafSun.value.length() - 1) < 1e-12 && Math.abs(u.uSwgLeafSun.value.dot(sun.clone().normalize()) - 1) < 1e-12 && u.uSwgLeafRange.value === 300, 'the sun goes over unit and toward it, and the range as given');
  // The sky reads the rows through this very function, with its own three readers, and the world hands what it read over.
  const sky = readFileSync(fileURLToPath(new URL('../../../src/world/sky.ts', import.meta.url)), 'utf8');
  const world = readFileSync(fileURLToPath(new URL('../../../src/world/world.ts', import.meta.url)), 'utf8');
  ok(sky.includes('readCardRows(L.card, this.cardRamp, index, CARD_ROWS);') && /color: \(row, index, out, fallback\) => this\.rampColor\(row, index, out, fallback\)/.test(sky) && /scale: \(row, index\) => this\.rampScale\(row, index\)/.test(sky) && /alpha: \(row, index, fallback\) => this\.rampAlpha\(row, index, fallback\)/.test(sky), "the sky reads the card rows through readCardRows with its own ramp readers");
  ok(world.includes('updateCardLight(L.card, this.day.lightDir,'), 'and the world hands what it read to updateCardLight');
  // A building's rooms pass puts the light out and back, live, whatever the tune says.
  setCardRoomPass(true);
  const inRooms = u.uSwgCardOn.value;
  setCardRoomPass(false);
  ok(inRooms === 0 && u.uSwgCardOn.value === (CARD_LIGHT_TUNE.on ? 1 : 0), "a rooms pass puts the card light out for its own draws and back after: a plant standing in a room takes the room's lamps");
}

// ---------------------------------------------------------------- 5. the two sides, our own lights

{
  let faceOk = true;
  let storedOk = true;
  let planeOk = true;
  for (let i = 0; i < 2000; i++) {
    const n = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const nl = Math.hypot(n[0], n[1], n[2]);
    const N = n.map((x) => x / nl);
    const p = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const pl = Math.hypot(p[0], p[1], p[2]);
    const P = p.map((x) => x / pl);
    // The mirror reflects through the plane quantised to bytes; the shader normalises those bytes.
    const Pq = P.map((x) => Math.round(x * 127) / 127);
    const ql = Math.hypot(Pq[0], Pq[1], Pq[2]);
    const Pu = Pq.map((x) => x / ql);
    const dn = 2 * (N[0] * Pu[0] + N[1] * Pu[1] + N[2] * Pu[2]);
    const mirrored = [N[0] - dn * Pu[0], N[1] - dn * Pu[1], N[2] - dn * Pu[2]];
    const back = storedNormal(mirrored, Pq);
    if (Math.hypot(back[0] - N[0], back[1] - N[1], back[2] - N[2]) > 1e-6) planeOk = false;
    const s = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const sl = Math.hypot(s[0], s[1], s[2]);
    const sun = s.map((x) => x / sl);
    // The twin of a flat pair faces the other way: its drawn normal the plane's reflection of the stored one, the face reversed.
    const twin = sideDot('face', N, N, sun);
    const copyFace = sideDot('face', mirrored, back, sun);
    const across = N[0] * Pu[0] + N[1] * Pu[1] + N[2] * Pu[2];
    const sunAcross = sun[0] * Pu[0] + sun[1] * Pu[1] + sun[2] * Pu[2];
    if (!near(copyFace, twin - 2 * across * sunAcross, 1e-9)) faceOk = false;
    if (!near(sideDot('stored', mirrored, back, sun), twin, 1e-6)) storedOk = false;
  }
  ok(planeOk, 'the stored normal out of a mirrored one and its written plane, normalised as the shader does, is the converted one to 1e-6');
  ok(faceOk, "under 'face' a mirrored copy's d is its twin's with the part across the card negated: for a card facing the sun's way exactly its twin's negated");
  const n = [0, 0, 1];
  const m = storedNormal(n, [0, 0, 1]);
  ok(near(sideDot('face', m, n, [0, 0, 1]), -sideDot('face', n, n, [0, 0, 1])), 'and on a flat pair, whose normal is the card\'s own, exactly its twin\'s negated');
  ok(storedOk, "under 'stored' every copy takes its twin's own d");
  let flatOk = true;
  for (let i = 0; i < 2000; i++) {
    const a = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const al = Math.hypot(a[0], a[1], a[2]);
    const nrm = a.map((x) => x / al);
    const f = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const fl = Math.hypot(f[0], f[1], f[2]);
    const face = f.map((x) => x / fl);
    const k0 = pointFlatNormal(nrm, face, 0);
    const k1 = pointFlatNormal(nrm, face, 1);
    const kh = pointFlatNormal(nrm, face, Math.random());
    if (Math.hypot(k0[0] - nrm[0], k0[1] - nrm[1], k0[2] - nrm[2]) > 1e-9 || Math.hypot(k1[0] - face[0], k1[1] - face[1], k1[2] - face[2]) > 1e-9) flatOk = false;
    if (!kh.every(Number.isFinite) || Math.abs(Math.hypot(kh[0], kh[1], kh[2]) - 1) > 1e-9) flatOk = false;
  }
  const opposite = pointFlatNormal([0, 0, -1], [0, 0, 1], 0.5);
  ok(flatOk, 'pointFlat nought keeps the normal, one gives the face, and every blend between is a unit vector, never a NaN');
  ok(opposite[2] === 1 && opposite.every(Number.isFinite), 'and a normal exactly opposite the face at a half, the one blend that comes to nothing, takes the face');
}

// ---------------------------------------------------------------- 6. the transformed text

{
  const chunk = CSMShader.lights_fragment_begin;
  const edit = cardLightsBegin(chunk);
  ok(edit.missing.length === 0, `every anchor is in three 0.185.1's cascades' chunk${edit.missing.length ? `: missing ${edit.missing.join(', ')}` : ''}`);
  const t = edit.text;
  const csm = t.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM ) && defined( CSM_CASCADES )');
  const plain = t.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM ) && !defined( CSM_CASCADES )');
  const mid = t.slice(csm, plain);
  const count = (s: string, x: string) => s.split(x).length - 1;
  ok(count(mid, 'swgLeafBias( directionalLightShadow.shadowBias )') === 2 && count(mid, 'swgLeafIntensity( directionalLightShadow.shadowIntensity )') === 2, 'exactly the two lookups the cascades make are handed the card\'s bias and share (the fade branch and the no-fade one)');
  ok(count(mid, '( directLight.visible && receiveShadow ) ? getShadow(') === 2, 'and both keep their receiveShadow guard');
  const plainOrig = chunk.slice(chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM ) && !defined( CSM_CASCADES )'));
  ok(t.slice(plain) === plainOrig, 'the no-cascade branch is left byte for byte as three wrote it');
  ok(count(t, 'swgCardSunOff( directLight );') === 4, "three's light is put out four times: the fade branch's sun, the no-fade branch's, the one light with Shadows off and the loop of lights that cast none");
  const before = (anchor: string) => {
    const at = t.indexOf(anchor);
    const off = t.lastIndexOf('swgCardSunOff( directLight );', at);
    return at > 0 && off > 0 && t.slice(off, at).split('RE_Direct(').length === 1;
  };
  ok(before('RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\n\t\t\t\t\tbool shouldBlend'), 'the fade branch puts it out right before its RE_Direct');
  const oneLight = t.indexOf('getDirectionalLightInfo( directionalLights[0], directLight );');
  ok(oneLight > 0 && t.slice(oneLight, t.indexOf('RE_Direct(', oneLight)).includes('swgCardSunOff( directLight );') && t.slice(oneLight, t.indexOf('RE_Direct(', oneLight)).includes('swgSunShadow = 1.0;'), 'the Shadows-off branch puts it out and lets the whole sun through to the sum');
  const loop = t.indexOf('for ( int i = NUM_DIR_LIGHT_SHADOWS; i < NUM_DIR_LIGHTS; i ++ ) {');
  ok(loop > 0 && t.slice(loop, t.indexOf('RE_Direct(', loop)).includes('swgCardSunOff( directLight );'), 'and so does the loop of lights that cast no shadow, the fill');
  ok(count(t, 'swgSunShadow += blendRatio * mix( 1.0, swgShadowNow, shouldFadeLastCascade ? ratio : 1.0 );') === 1 && count(t, 'swgSunShadow += swgShadowNow;') === 1, "the factor each lookup returns is captured with the fade branch's own weights");
  const geo = t.indexOf('vec3 geometryNormal = normal;');
  const blend = t.indexOf('geometryNormal = swgFlatL > 1e-4 ? swgFlat / swgFlatL : swgFace;');
  ok(geo > 0 && blend > geo && count(t, 'geometryNormal = swgFlatL') === 1 && !t.slice(geo + 'vec3 geometryNormal = normal;'.length, t.indexOf('#ifdef SWG_CARD_LIGHT', geo)).includes(';'), 'the face blend goes in once, straight after the chunk declares geometryNormal');
  ok(CARD_LIGHT_SUM.includes('vec3 swgCardN = normal;') && !CARD_LIGHT_SUM.includes('geometryNormal'), 'and the sum reads `normal`, never the blended geometryNormal: the sun is never blended');
  ok(SHADOW_OFFSET_CARD.includes('swgCardShadowDir( directionalShadowMatrix[ i ]') && THREE.ShaderChunk.shadowmap_vertex.includes(SHADOW_OFFSET) && THREE.ShaderChunk.shadowmap_vertex.includes('spotLightShadows[ i ].shadowNormalBias'), "the shadow offset is turned toward the light on the directional lookups, and the spot's is not touched");
  // Through the world's chain: the cascades' stand-in, the wet look, the highlight, the card rule with the light.
  const make = () => {
    const m = new THREE.MeshStandardMaterial({ alphaTest: 0.5, map: new THREE.Texture() });
    m.defines = { USE_CSM: 1, CSM_CASCADES: 3, CSM_FADE: '', SWG_CARD_LIGHT: '', SWG_LEAF_SHADOW: '' };
    m.onBeforeCompile = function cascades(shader: THREE.WebGLProgramParametersWithUniforms) {
      shader.uniforms.CSM_cascades = { value: [] };
    };
    m.userData.swgSpec = { mode: 'none', color: [0, 0, 0], power: 0, mask: 'unmasked' };
    m.userData.swgCardBlend = 'blend';
    m.userData.swgLeaf = { min: [-1, 0, -1], max: [1, 3, 1] };
    applyWetness(m);
    applySpec(m, false);
    applyCard(m);
    return m;
  };
  const keep = THREE.ShaderChunk.lights_fragment_begin;
  (THREE.ShaderChunk as unknown as Record<string, string>).lights_fragment_begin = CSMShader.lights_fragment_begin;
  try {
    const m = make();
    const lib = THREE.ShaderLib.physical;
    const s = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) } as unknown as THREE.WebGLProgramParametersWithUniforms;
    const injected = CARD_LIGHT_STATS.injected;
    m.onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
    ok(CARD_LIGHT_STATS.injected === injected + 1 && (CARD_LIGHT_STATS.replaced['fade lookup'] ?? 0) >= 1 && (CARD_LIGHT_STATS.replaced['shadow offset'] ?? 0) >= 1, 'the light goes into a real program through the world\'s chain, every replacement counted');
    const f = s.fragmentShader;
    const v = s.vertexShader;
    const sumAt = f.indexOf('vec3 swgCardN = normal;');
    const sheenAt = f.indexOf('float wetFres');
    ok(sumAt > 0 && sheenAt > sumAt, 'the card light comes before the wet sheen after lights_fragment_end, so a sheen adds onto the light');
    ok(v.split('vSwgStoredNormal = normalMatrix * swgStoredView;').length === 2 && f.split('vSwgStoredNormal').length - 1 === 3, 'the stored normal\'s varying is written once in the vertex stage, and read only by the sum (declared once, read twice there)');
    ok(v.indexOf('vec3 swgStoredNormal') < v.indexOf('vSwgStoredNormal = normalMatrix'), 'and written after the card rule works the stored normal out');
    const resolve = (src: string): string => src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => resolve((THREE.ShaderChunk as unknown as Record<string, string>)[name]));
    const base = ['USE_MAP', 'USE_ALPHATEST', 'USE_INSTANCING', 'STANDARD', 'USE_CSM', 'CSM_CASCADES', 'CSM_FADE', 'USE_SHADOWMAP', 'SWG_WET'];
    const twice = [base, [...base, 'SWG_CARD_LIGHT'], [...base, 'SWG_CARD_LIGHT', 'SWG_LEAF_SHADOW'], [...base, 'SWG_LEAF_SHADOW']].flatMap((d) => [...redeclared(glslVariant(resolve(f), new Set(d))), ...redeclared(glslVariant(resolve(v), new Set(d)))]);
    ok(twice.length === 0, `no name is declared twice in one scope, with the light, the skip, both or neither${twice.length ? `: ${twice.slice(0, 4).join(', ')}` : ''}`);
    const rf = resolve(f);
    const declared = ['uniform float uSwgCardOn;', 'float swgSunShadow = 0.0;', 'float swgShadowNow = 1.0;', 'void swgCardSunOff(', 'float swgLeafBias(', 'float swgLeafSkip = 0.0;'];
    const firstUse = ['uSwgCardOn > 0.5', 'swgSunShadow +=', 'swgShadowNow =', 'swgCardSunOff( directLight )', 'swgLeafBias( directionalLightShadow', 'swgLeafSkip = max('];
    ok(declared.every((d, i) => rf.indexOf(d) >= 0 && rf.indexOf(d) < rf.indexOf(firstUse[i])), 'every name the light uses is declared before its first use, with every include resolved');
    const hook = m.onBeforeCompile;
    applyCard(m);
    ok(m.onBeforeCompile === hook, 'wrapping twice adds nothing');
    const shared = Object.keys(CARD_LIGHT_UNIFORMS);
    ok(shared.every((k) => (s.uniforms[k] as unknown) === (CARD_LIGHT_UNIFORMS as Record<string, unknown>)[k]), 'and every card hands three the shared colours and knobs by reference');
    // A chunk missing an anchor: the light is left out, said and counted.
    (THREE.ShaderChunk as unknown as Record<string, string>).lights_fragment_begin = CSMShader.lights_fragment_begin.replace('float blendRatio = shouldBlend ? ratio : 1.0;', 'float blendRatio = 1.0;');
    const warn = console.warn;
    console.warn = () => {};
    try {
      const missing = CARD_LIGHT_STATS.missingAnchor;
      const s2 = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) } as unknown as THREE.WebGLProgramParametersWithUniforms;
      make().onBeforeCompile(s2, null as unknown as THREE.WebGLRenderer);
      ok(CARD_LIGHT_STATS.missingAnchor === missing + 1 && !s2.fragmentShader.includes('vec3 swgCardN = normal;') && s2.fragmentShader.includes('#include <lights_fragment_begin>') && s2.fragmentShader.includes('uSwgCardCutBlend'), 'a chunk missing an anchor gets none of the light, counted and named, while the card rule itself stays');
    } finally {
      console.warn = warn;
    }
    void injectCardLight;
  } finally {
    (THREE.ShaderChunk as unknown as Record<string, string>).lights_fragment_begin = keep;
  }
}

// ---------------------------------------------------------------- the knobs

{
  const was = { ...CARD_LIGHT_TUNE, rows: { ...CARD_LIGHT_TUNE.rows } };
  setCardLightTune({ sunSide: 'stored', pointFlat: 1, shadow: 'all', curve: 'scene', fills: 'fill', shadowLook: 'row7' });
  const u = CARD_LIGHT_UNIFORMS;
  ok(u.uSwgCardSunSide.value === 1 && u.uSwgCardPointFlat.value === 1 && u.uSwgLeafSelf.value === 0 && u.uSwgCardCurve.value === 1 && u.uSwgCardFills.value === 1 && u.uSwgCardShadowLook.value === 1, 'every live knob is a shared uniform');
  setCardLightTune(was);
  ok(u.uSwgCardSunSide.value === 0 && u.uSwgCardPointFlat.value === 0.5 && u.uSwgLeafSelf.value === 1, 'and the defaults: each face by its own side, half the face for our lights, no shadow from the leaf\'s own crown');
  ok(CARD_LIGHT_TUNE.curve === 'client' && CARD_LIGHT_TUNE.shadow === 'self' && CARD_LIGHT_TUNE.sunSide === 'face' && CARD_LIGHT_TUNE.shadowLook === 'rise' && CARD_LIGHT_TUNE.rampScale === 'bytes' && CARD_LIGHT_TUNE.fills === 'both', "the tune ships at the design's defaults");
}

console.log(`\ncardLight: ${passed} checks passed`);

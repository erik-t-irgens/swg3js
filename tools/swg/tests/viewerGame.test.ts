// The space body viewer drawn as the game does (the GPU port's pass 2, wave 5, maker V: `src/sky/look/gameAir.ts`,
// `src/sky/look/placeview.js`, `viewer/app.js`). Node draws nothing, so the pictures are the browser proof's (the wave's
// paragraph in docs/STATUS.md); this holds what can be held without a card:
//   1. the chain is the game's own under our sky, in its order: the sanitize into one buffer, the owner's demo's bloom (the
//      game's own pass, its strength the setting's start), the eye's exposure, the grade, three's ACES and the sRGB curve,
//      the dither; three's thresholded bloom, which blew the viewer white, is gone;
//   2. the ground drawn as the game does is hazed by the haze pass's own rule (`airHaze.ts`' `airTerms`), number for number;
//   3. the motion "draw as the game does" follows is the game's: the page's choices through Save to game's writer and the
//      game's own reader make the motion the game makes from the written file, the same to the bit at every count, and an
//      orbit edited in the System tab moves its body and nothing else;
//   4. the place view's reading of that motion (`skyViewOf`) is the motion's own numbers;
//   5. the page and the place view read it as the game hangs its bodies (`lookWorld.ts`, `lookBody.ts`), Save to game carries
//      the places he moved, the match carries the day's count, and SWG's sun pictures are not drawn as the game does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let passed = 0;
let failed = 0;
const ok = (c: unknown, what: string): void => {
  if (c) passed++;
  else {
    failed++;
    console.log('FAIL', what);
  }
};

const GA = read('src/sky/look/gameAir.ts');
const HZ = read('src/sky/air/airHaze.ts');
const PV = read('src/sky/look/placeview.js');
const APP = read('viewer/app.js');
const LW = read('src/sky/bodies/lookWorld.ts');
const LB = read('src/sky/bodies/lookBody.ts');
const MAIN = read('src/main.ts');

// ---------------------------------------------------------------- 1. the chain
{
  const G = await import('../../../src/sky/look/gameAir.ts');
  const R = await import('../../../src/core/fxRegistry.ts');
  ok(G.GAME.bloomMix === R.FX_DEFAULTS.bloomMix, "the bloom's share is the Graphics page's Bloom strength at its start (the game's setting, not a number of the viewer's)");
  ok(!/BloomNode/.test(GA) && !/\bbloom\(/.test(GA) && !/threshold/.test(GA.replace(/\/\/.*$/gm, '')), "three's thresholded bloom is not drawn (it blew every bright thing white: the owner's word of 23 November)");
  ok(GA.includes('this.bloomPass = new GpuMixBloomPass(1, 1, GAME.bloomMix);'), "the bloom is the game's own pass (`gpuBloomMix.ts`), made at the setting's start");
  ok(GA.includes('this.sanitize = sanitizeGraph({ tScene: this.sceneIn }, true);'), "the scene is stored into the chain's buffer through the game's sanitize under our sky (its 8192 ceiling)");
  const render = GA.slice(GA.indexOf('  render(): void {'), GA.indexOf('  // ---------------------------------------------------------------- the file the game reads'));
  const at = (s: string): number => render.indexOf(s);
  ok(at('r.render(this.S.scene, this.S.camera);') > 0 && at('r.render(this.S.scene, this.S.camera);') < at('r.render(this.sanitize.mesh, FX_CAMERA);') && at('r.render(this.sanitize.mesh, FX_CAMERA);') < at('this.bloomPass.render(') && at('this.bloomPass.render(') < at('this.pipeline.render();'), "the game's order: the scene, the sanitize, the bloom over the buffer, then the output");
  ok(/r\.autoClear = false;\s*r\.setRenderTarget\(this\.buffer\);/.test(render), "nothing is cleared under the bloom's levels and its mix (the game's chain runs with three's clearing off)");
  ok(GA.includes('const exposed = vec3(pic.rgb).mul(U.exposure);') && GA.includes('const graded = grade(exposed);'), "the eye's exposure multiplies the picture after the bloom, as the game's output does (`outputGraph`), and the grade stands in the exposed light");
  ok(GA.includes('const shown = renderOutput(vec4(graded.mul(U.comp), 1.0), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);') && GA.includes('const out = ditheredOut(shown, float(1));'), "three's ACES at the player's compensation, the sRGB curve, then the game's dither of wave 4b onto the canvas");
  ok(/EYE_OUT\.exposure = e;[\s\S]{0,120}writeEyeCpu\(\);/.test(GA), "the exposure reaches the eye's buffer the bloom's first level weighs by (the game's Karis weights)");
  ok(!/vignette\(/.test(GA), 'no vignette (WebGPU draws none)');
}

// ---------------------------------------------------------------- 2. the ground's haze is the haze pass's rule
{
  const terms = HZ.slice(HZ.indexOf('function airTerms('), HZ.indexOf('export function hazeGraph('));
  const ground = GA.slice(GA.indexOf('  groundMaterial(): THREE.Material | null {'), GA.indexOf('  frameAir(a: WorldAir'));
  const pick = (s: string, re: RegExp): string => (re.exec(s)?.[1] ?? '').replace(/\bhz\b/g, 'h').replace(/\s+/g, ' ');
  const rT0 = /const t0 = (max\([^;]*\));/;
  const rT = /const t = (select\(far,[^;]*?\))\.toVar/;
  const rL = /const l = (select\(far,[^;]*?\))\.toVar/;
  const rFar = /const far = ([^;]*);/;
  for (const [name, re] of [['what gets through at the reach', rT0], ['what gets through past it', rT], ['what the air adds', rL], ['past the reach', rFar]] as [string, RegExp][]) {
    const a = pick(terms, re);
    const b = pick(ground, re);
    ok(a.length > 8 && a === b, `the ground's ${name} is the haze pass's own (${a} against ${b})`);
  }
  ok(/tables\.hazeAt\(ndc, min\(dist, HAZE_REACH_M\)\)/.test(ground) && /tables\.skyRadiance\(d\)/.test(ground), "it reads the haze volume at the ground's own distance and the sky view toward it, as the pass does");
  ok(/const gd = run\.twin\.out\.groundDown;[\s\S]{0,200}gd\[0\] \/ Math\.PI/.test(GA), "its light is the twin's own ground (Lambert's: what it sends up over pi)");
  ok(/Math\.sqrt\(2 \* rM \* hM \+ hM \* hM\)/.test(GA), "its reach is the horizon of a round world at the eye's height");
}

// ---------------------------------------------------------------- 3. the motion is the game's, and an orbit's edit reaches it
const { gameBodiesFile } = (await import('../../../viewer/gameBodies.mjs')) as { gameBodiesFile: (d: Record<string, unknown>, o?: Record<string, unknown>) => Record<string, unknown> };
const { cleanBodiesFile } = await import('../../../src/sky/look/bodiesFile.ts');
const { skyMotionFor } = await import('../../../src/sky/system/skyMotion.ts');
const { draftSystem } = (await import('../../../src/sky/system/drafts.js')) as { draftSystem: (id: string) => Record<string, unknown> };
const { skyViewOf } = await import('../../../src/sky/look/gameAir.ts');
// A converted sky's sizes (made up: the converted packs are never read by a test), as `skyPlacesOf` reads them.
const SKY = { sun: { size: 0.55 }, moon: { size: 0.8 }, supplementalMoon: { size: 0.4 }, celestials: [{ size: 0.8, image: { file: 'sky/cels_ice_moon.png' } }] };
const page = (sys: unknown): Record<string, unknown> => ({ looks: {}, uses: {}, starSystems: { yavin: { applied: true, system: sys } }, systems: {}, pictures: {}, worlds: [], twins: {}, held: {}, places: {} });
const viewerMotion = (sys: unknown) => {
  // the page's path (`gameFileNow`): the choices through the writer and the game's reader, in the page
  const f = cleanBodiesFile(JSON.parse(JSON.stringify(gameBodiesFile(page(sys), { at: 'now' })))).file;
  return f ? skyMotionFor(f.systems as never, 'yavin4', 'yavin4', SKY) : null;
};
const gameMotion = (sys: unknown) => {
  // the game's: the file as the server writes it (its credit added), read back by the game's reader at a loading screen
  const text = JSON.stringify(gameBodiesFile({ ...page(sys), credit: 'a test' }, { at: 'then' }), null, 1) + '\n';
  const f = cleanBodiesFile(JSON.parse(text)).file;
  return f ? skyMotionFor(f.systems as never, 'yavin4', 'yavin4', SKY) : null;
};
const sys0 = draftSystem('yavin');
const mv = viewerMotion(sys0);
const mg = gameMotion(sys0);
ok(!!mv && !!mg, "an applied Yavin draft makes a motion on both roads");
if (mv && mg) {
  let same = true;
  for (const count of [1960.1, 1960.5, 1960.9, 1961.25, 2000.75]) {
    mv.at({ count });
    mg.at({ count });
    for (let k = 0; k < mv.dir.length; k++) if (!Object.is(mv.dir[k], mg.dir[k]) || !Object.is(mv.light[k], mg.light[k])) same = false;
    for (let j = 0; j < mv.m; j++) if (!Object.is(mv.lit[j], mg.lit[j]) || !Object.is(mv.cover[j], mg.cover[j])) same = false;
    if (!Object.is(mv.T, mg.T) || !Object.is(mv.daylight, mg.daylight) || !Object.is(mv.moonShare, mg.moonShare)) same = false;
  }
  ok(same, "drawn as the game does, every body's direction, lit side, phase, cover and the day's light are the game's to the bit at five counts");
  // the page's count for a real moment (`gameCountOf`) is the one whose sky time is that moment
  let back = true;
  for (const T of [326.79, 400.125, 1.5]) if (Math.abs(mg.timeOfCount(T / mg.dayDays + mg.lonTurn) - T) > 1e-9) back = false;
  ok(back && APP.includes('if (mo.version === 2) return v2Time() / mo.dayDays + mo.lonTurn;'), "the page stands the game's day at the count whose sky time is the moment its bars show");
  // the owner's path: an orbit's start moved in the System tab (the edited system applied), saved, read at the next screen
  const sys1 = JSON.parse(JSON.stringify(sys0)) as { bodies: { id: string; name: string; start: number }[] };
  const y13 = sys1.bodies.find((b) => b.name === 'Yavin 13');
  ok(!!y13, 'the draft has Yavin 13');
  if (y13) {
    y13.start = ((y13.start + 90 + 180) % 360) - 180;
    const me = gameMotion(sys1);
    if (me) {
      const count = 1960.909939;
      mg.at({ count });
      me.at({ count });
      const ang = (j: number): number => {
        const a = [mg.dir[3 * j], mg.dir[3 * j + 1], mg.dir[3 * j + 2]];
        const b = [me.dir[3 * j], me.dir[3 * j + 1], me.dir[3 * j + 2]];
        return (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
      };
      const j13 = me.items.findIndex((it) => it.name === 'Yavin 13');
      let others = 0;
      for (let j = 0; j < me.m; j++) if (j !== j13) others = Math.max(others, ang(j));
      ok(ang(j13) > 10 && others === 0, `its body moved (${ang(j13).toFixed(1)} degrees) and nothing else did (${others})`);
    } else ok(false, 'the edited system makes a motion');
  }
}

// ---------------------------------------------------------------- 4. the place view's reading of the motion is the motion's
if (mg) {
  const day = { hours: 12, time: 0.5, ratio: 0.25, isDay: true, normalized: 0.25, light: { x: 0, y: 1, z: 0 }, sun: { x: 0, y: 1, z: 0 }, moon: { x: 0, y: -1, z: 0 }, clientTime: 0, slotAlpha: 1 };
  const v = skyViewOf(mg, day);
  ok(v.game === true && v.motion === mg && v.out.dir === mg.dir && v.out.light === mg.light && v.out.dist === mg.dist && v.out.day === day, "it reads the motion's own arrays (moved in place each frame) and the game's day");
  let firsts = true;
  const seen = new Set<string>();
  mg.items.forEach((it, j) => {
    if (!it.place || seen.has(it.place)) return;
    seen.add(it.place);
    if (v.model.itemOf.get(it.place) !== j) firsts = false;
  });
  ok(firsts && seen.size > 0, "a place stands for the first item that names it (`sky.ts`' `useMotion`)");
  let rows = v.model.hidden.size === 0 && v.model.version === mg.version && v.v2 === (mg.version === 2);
  mg.items.forEach((it, j) => {
    if (v.model.itemSize[j] !== it.sizeDeg || v.model.itemDrawn[j] !== (it.drawn ? 1 : 0) || v.model.itemStar[j] !== (it.star ? 1 : 0) || v.model.itemSpin[j] !== it.spinDeg || v.model.items[j].turns !== it.spinDeg / 360) rows = false;
  });
  ok(rows, "each item's size, drawn, star and spin are the motion's (the game's sizes: the drawn disc's pair gap and eclipses)");
}

// ---------------------------------------------------------------- 5. the page and the place view read it as the game hangs its bodies
{
  const hang = "!it.drawn || it.star || it.sheet || (it.slot !== 'extra' && it.slot !== 'none')";
  ok(LW.includes(hang) && APP.includes(hang), "drawn as the game does, the system's own bodies are the ones the game hangs in their looks (`skyLookPlans`)");
  const recipe = "const recipe = kind === 'giant' ? 'gasgiant' : kind === 'planet' ? 'terran' : 'moon';";
  ok(LB.includes(recipe) && APP.includes(recipe) && LB.includes('p.recipe === recipe && !p.shape && !p.volume') && APP.includes('p.recipe === recipe && !p.shape && !p.volume'), "a body that names no look wears its kind's first preset, as the game's `presetFor` picks it");
  ok(APP.includes('ctx.sky = () => gameLook.skyView(p.zone);') && APP.includes('ctx.count = () => gameCountOf(p.zone);'), "the place view reads the game's motion and the day's count drawn as the game does");
  ok(PV.includes("const dayOfSky = (sky, hours) => (sky && (sky.game || sky.model.version === 2) ? sky.out.day : dayAt(hours));"), "under the game's motion the place view takes the game's own day");
  ok(/if \(!this\.space && G && G\.on && this\.airDrawn\) \{\s*b\.glow\.group\.visible = false;/.test(PV), "SWG's sun pictures are not drawn as the game does (the air's disc is the sun, as on WebGPU)");
  ok(/function gameSaveBody\(\) \{[\s\S]*places: cleanPlaceEdits\(state\.placeEdits\) \};/.test(APP) && /async function saveToGame\(\) \{\s*const body = gameSaveBody\(\);/.test(APP), 'Save to game carries the places he moved (the writer keeps the space places)');
  ok(/return cleanBodiesFile\(JSON\.parse\(JSON\.stringify\(gameBodiesFile\(gameSaveBody\(\), \{ at: 'now' \}\)\)\)\)\.file;/.test(APP), "drawn as the game does follows the very file Save to game would write, read by the game's own reader");
  ok(MAIN.includes('return { ...rec, air, eye, count: this.world.day.count };') && GA.includes("typeof m.count === 'number' && Number.isFinite(m.count) ? m.count"), "the game's match carries the day's count, and the viewer stands its day there");
}

// 6. (The fixer of wave 5) A body drawn as the game does is seen through the game's own air as the game's card sees it: lit by the
// star's light at the top of the air over pi, what comes through to space and the air's light in front of it the twin's own
// (`bodySeen`), held to `seenMost` by that light times the eye; the wash's own light in its own units, under the game's eye, had
// made Yavin 4's dusk body a flat white disc (luminance 244 in the checker's match, 226 after, the game's picture 204 to 218).
{
  const PV2 = read('src/sky/look/placeview.js');
  ok(/bodySeen\(dx: number, dy: number, dz: number, out: \{ trans: THREE\.Vector3; light: THREE\.Vector3; star: THREE\.Vector3 \}\): boolean \{/.test(GA) && GA.includes('lightTransmittance(rec, tw.depth, rec[F.bottom] + hk, dy, this.seenT, 0);') && GA.includes('tw.radianceIn(dx * cx + dz * cz, dy, -dx * cz + dz * cx, hk, SEEN_STEPS, this.seenL);') && GA.includes('out.star.set(tw.sunTop[0] / Math.PI, tw.sunTop[1] / Math.PI, tw.sunTop[2] / Math.PI);'), "the game's air answers a body's transmittance to space, the sky's radiance in front of it (in the sums' frame) and the star's light over pi, from the twin that drew the frame");
  ok(GA.includes('this.framed = a.ready ? a : null;'), 'only the air that drew the last frame answers');
  ok(/const seenAsGame = !!seen && G\.bodySeen\(d\.x, d\.y, d\.z, seen\);\n\s+if \(seenAsGame\) \{\n\s+b\._lc = null;\n\s+b\.built\.LU\.sunColour\.value\.copy\(seen\.star\);\n\s+b\.built\.LU\.airTrans\.value\.copy\(seen\.trans\);\n\s+b\.built\.LU\.airLight\.value\.copy\(seen\.light\);/.test(PV2), "drawn as the game does, a body takes the game's air for its light, what comes through and what lies in front");
  ok(/const lum = st \? 0\.2126 \* tr\.x \* st\.x \+ 0\.7152 \* tr\.y \* st\.y \+ 0\.0722 \* tr\.z \* st\.z : 0\.2126 \* tr\.x \+ 0\.7152 \* tr\.y \+ 0\.0722 \* tr\.z;\n\s+const white = L\.power \* lum \* \(b\.built\.LU\.gain\.value \|\| 0\) \* G\.U\.exposure\.value;/.test(PV2), "and is held by the game's rule: the white through the air in the star's light, times the eye, against `seenMost`");
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

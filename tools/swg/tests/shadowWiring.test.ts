// How the sixth wave's shadow pass is wired into the game, read as text (src/world/world.ts, portalRender.ts,
// layoutStream.ts, src/main.ts, and every file under src/ for one rule): the hand-overs only the game makes, which every
// behaviour test makes for itself. `updateShadows` fits the cascades, decides the holds and only then works the matrices
// out; no light's `autoUpdate` is written anywhere but by the holds' `decide` and `dirtyAll`; a whole draw outside a
// frame asks every map for itself, outside any hook; the warm-up marks every cascade dirty after its draw; each of the
// world's own events marks them dirty; both shadow draws run the hooks with the swap put back in a `finally`; the scene's
// walk is made, timed apart, just before the shadow pass; the warm builds no colour program for a batch and does draw
// the plain casters' other half and the batches' one combination; a shown tier goes to the batches and an unloaded one
// takes its batch with it; the movers are listed after the shuttles are posed and before the cascades are decided, from
// the vehicles, the shuttles and the peers; the bench and the picture test decide before every frame they draw; and the
// helper has its README row and its place in the debug menu.
//
// Text is split on /\r?\n/: a working copy may be CRLF (the third wave's lesson), and a method's end found on `\n` alone
// is never found.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEBUG_GROUPS } from '../../../src/ui/debugModel.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): string[] => readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
const world = read('src/world/world.ts');
const portal = read('src/world/portalRender.ts');
const layout = read('src/world/layoutStream.ts');
const main = read('src/main.ts');

/** A method's lines, from its declaration (`<indent><name>(` or with a keyword in front) to the closing brace at its indent. */
function body(lines: string[], decl: RegExp, what: string): string[] {
  const at = lines.findIndex((l) => decl.test(l));
  assert.ok(at >= 0, `found ${what}`);
  const indent = (/^\s*/.exec(lines[at]) ?? [''])[0];
  for (let i = at + 1; i < lines.length; i++) if (lines[i] === `${indent}}` || lines[i] === `${indent}};` || lines[i] === `${indent}},`) return lines.slice(at, i + 1);
  return lines.slice(at);
}
const indexOf = (lines: string[], needle: string | RegExp): number => lines.findIndex((l) => (typeof needle === 'string' ? l.includes(needle) : needle.test(l)));

// ---- updateShadows: the fit, the holds, then the matrices. ----
{
  const b = body(world, /^ {2}updateShadows\(now: number\): void \{/, 'updateShadows');
  const fit = indexOf(b, 'csm.update()');
  const decide = indexOf(b, 'this.shadowHold.decide(');
  const boxes = indexOf(b, 'refreshCascadeBoxes(csm.lights');
  ok(fit > 0 && decide > fit && boxes > decide, `updateShadows calls csm.update, then the holds' decide, then refreshCascadeBoxes, in that order (${fit}, ${decide}, ${boxes})`);
  ok(b.filter((l) => l.includes('refreshCascadeBoxes(')).length === 1, 'and works the matrices out once');
}

// ---- autoUpdate of a light is written by decide and dirtyAll alone. ----
{
  const strays: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mts|js|mjs)$/.test(e)) {
        const lines = readFileSync(p, 'utf8').split(/\r?\n/);
        lines.forEach((l, i) => {
          if (/autoUpdate\s*=[^=]/.test(l) && !/shadowMap\.autoUpdate\s*=/.test(l)) strays.push(`${p.slice(ROOT.length)}:${i + 1}`);
        });
      }
    }
  };
  walk(join(ROOT, 'src'));
  const cadence = read('src/world/shadowCadence.ts');
  const decide = body(cadence, /^ {2}decide\(lights/, 'decide');
  const dirty = body(cadence, /^ {2}dirtyAll\(\): void \{/, 'dirtyAll');
  const inside = (where: string): boolean => {
    const [file, n] = where.split(':');
    if (!file.endsWith('shadowCadence.ts')) return false;
    const line = cadence[Number(n) - 1];
    return decide.includes(line) || dirty.includes(line);
  };
  ok(strays.length > 0 && strays.every(inside), `no light's autoUpdate is written anywhere under src/ but in ShadowHold.decide and dirtyAll (${strays.join(', ')})`);
  const attach = body(world, /^ {2}attachCamera\(camera/, 'attachCamera');
  ok(attach.some((l) => l.includes('this.shadowHold.bind(this.csm.lights)')) && attach.some((l) => l.includes('portals.shadowLights = this.csm.lights')), 'the CSM\'s lights are handed to the holds and to the portal renderer as they are made, and nothing else is done to them');
}

// ---- drawShadowsOnly asks every map itself, outside any hook; the hooks' after in a finally, in both draws. ----
{
  const d = body(portal, /^ {2}drawShadowsOnly\(scene/, 'drawShadowsOnly');
  const ask = indexOf(d, 'lights[i].shadow.needsUpdate = true');
  const before = indexOf(d, 'hooks?.before(true)');
  const render = indexOf(d, 'r.render(');
  const fin = indexOf(d, '} finally {');
  const after = indexOf(d, 'hooks?.after(true, true)');
  ok(ask > 0 && ask < before && before < render && render < fin && fin < after, 'drawShadowsOnly sets needsUpdate on every light of shadowLights itself, before its render and outside the hooks, and runs the hooks\' after in its finally');
  const s = body(portal, /^ {2}private renderShadows\(scene/, 'renderShadows');
  const sb = indexOf(s, 'hooks?.before(false)');
  const sp = indexOf(s, "this.pass('shadows'");
  const sf = s.findIndex((l, i) => i > sp && l.includes('} finally {'));
  const sa = indexOf(s, 'hooks?.after(true, false)');
  ok(sb > 0 && sb < sp && sp < sf && sf < sa, 'renderShadows runs the hooks round its pass, the after in a finally');
  // Each hook timed on its own line, begun and ended round it whatever it throws.
  const timed = (at: number): boolean => !!(s[at - 2]?.includes('perf.begin(SEC.shadowHooks)') && s[at - 1]?.includes('try {') && s[at + 1]?.includes('} finally {') && s[at + 2]?.includes('perf.end(SEC.shadowHooks)'));
  ok(timed(sb) && timed(sa), 'and times both on the shadowHooks line, ended in a finally of its own');
  ok(s.slice(0, sb).some((l) => l.includes('hooks?.after(false, false)')), 'and says a frame with no shadow pass when shadows are off or faded');
  const r = body(portal, /^ {2}render\(scene: THREE\.Scene, camera/, 'render');
  const skip = indexOf(r, 'if (skipWorld) {');
  const walkSkip = r.findIndex((l, i) => i > skip && l.includes('this.walkOnce(scene)'));
  const afterSkip = r.findIndex((l, i) => i > skip && l.includes('this.shadowPassHooks?.after(false, false)'));
  const walk = r.findIndex((l, i) => i > afterSkip && l.includes('this.walkOnce(scene)'));
  const shadows = indexOf(r, 'this.renderShadows(scene, view)');
  ok(skip > 0 && walkSkip > skip && afterSkip > skip && walk > afterSkip && walk < shadows, 'render makes the scene\'s walk just before the shadow pass (and once with no shadow pass), and tells the holds of a frame inside with no exit');
  ok(!r.some((l) => l.includes('this.passes > 0 && this.matrixOnce')), 'the old walk-by-the-first-pass rule is gone');
  const w = body(portal, /^ {2}private walkOnce\(scene/, 'walkOnce');
  ok(w.some((l) => l.includes('if (!this.matrixOnce) return;')) && w.some((l) => l.includes('perf.begin(SEC.sceneWalk)')) && w.some((l) => l.includes('scene.updateMatrixWorld()')) && w.some((l) => l.includes('scene.matrixWorldAutoUpdate = false')), 'the walk is timed as sceneWalk, made under matrixOnce alone, and turns the scene\'s own walk off for the frame');
}

// ---- The world's hooks, the warm, the dirty sites, passesOf. ----
{
  const attach = body(world, /^ {2}attachCamera\(camera/, 'attachCamera');
  const hooks = attach.join('\n');
  ok(/before: \(\) => batches\.around\(\)/.test(hooks) && /try \{\s*batches\.restore\(\);\s*\} finally \{\s*hold\.drawn\(/.test(hooks), 'the world\'s hooks: the batches follow and swap before, the swap is put back and the holds told after, in a finally');
  const warm = body(world, /^ {2}private compileShadowDepth\(r/, 'compileShadowDepth');
  ok(warm.some((l) => l.includes('plainDepthCombos(set.name)')) && warm.some((l) => l.includes('batchedDepthCombo(set.name, shadowBatchMaterial())')), 'compileShadowDepth draws the plain casters (instanced and not) and the batches\' one combination');
  const draw = indexOf(warm, 'portals.drawShadowsOnly(this.scene)');
  const dirty = indexOf(warm, 'this.shadowHold.dirtyAll()');
  ok(draw > 0 && dirty > draw, 'and marks every cascade dirty after its draw itself');
  const quality = body(world, /^ {2}private applyShadowQuality\(\): void \{/, 'applyShadowQuality');
  ok(quality.some((l) => l.includes('this.shadowHold.dirtyAll()')), 'applyShadowQuality (every frustum refit, a map made anew, farDepth moved) marks every cascade dirty');
  // Q8's depth, by the one formula the tests model (`shadowCameraFar`), and 'whole' as the world starts.
  ok(quality.some((l) => l.includes('cam.far = shadowCameraFar(this.shadowFarDepth, LIGHT_MARGIN, this.shadowDistance, cam.right - cam.left);')), "applyShadowQuality sets each shadow camera's depth by shadowCameraFar, the formula the cadence's tests run");
  ok(world.some((l) => /^ {2}shadowFarDepth: FarDepth = 'whole';$/.test(l)), "and the far depth ships 'whole' (the owner's Q8), 'slice' only the switch's other value");
  const leaf = body(world, /^ {2}private applySwgLighting\(L/, 'applySwgLighting');
  ok(leaf.some((l) => l.includes('r[i] = c.far - c.near;')) && leaf.some((l) => l.includes('updateCardLight(L.card, this.day.lightDir, r);')), "the leaf cards' skip is handed every cascade's own depth range, not the near cascade's for all");
  for (const [name, decl] of [
    ['onCameraResized', /^ {2}onCameraResized\(\): void \{/],
    ['setShadows', /^ {2}setShadows\(distance\?/],
  ] as const) {
    const b = body(world, decl, name);
    ok(b.some((l) => l.includes('this.applyShadowQuality()')), `${name} refits through applyShadowQuality, which marks every cascade dirty`);
  }
  for (const [name, decl] of [
    ['unload', /^ {2}private unload\(\): void \{/],
    ['jumpTo', /^ {2}jumpTo\(center/],
    ['setShadowsEnabled', /^ {2}setShadowsEnabled\(on/],
  ] as const) {
    const b = body(world, decl, name);
    ok(b.some((l) => l.includes('this.shadowHold.dirtyAll()')), `${name} marks every cascade dirty`);
  }
  const passes = body(world, /^ {2}private static passesOf\(o/, 'passesOf');
  ok(passes[3]?.includes('if (isShadowCast(o.layers.mask)) return World.NO_PASSES;') || passes.slice(0, 5).some((l) => l.includes('if (isShadowCast(o.layers.mask)) return World.NO_PASSES;')), 'passesOf answers no pass for a shadow batch, first');
  const groundSwitch = body(world, /^ {2}setShadowSwitches\(o/, 'setShadowSwitches');
  ok(groundSwitch.some((l) => l.includes('c.ground.castShadow = cast')) && world.some((l) => l.includes("mesh.castShadow = this.groundShadows === 'on';")), 'groundShadows writes every standing chunk\'s ground and every chunk built while it holds');
}

// ---- The streamer: a shown tier batched, an unloaded one's batch dropped. ----
{
  const load = body(layout, /^ {2}private async loadTier\(region/, 'loadTier');
  const reveal = indexOf(load, 'this.reveal(mesh)');
  const batch = indexOf(load, 'this.batchTier(loaded)');
  ok(reveal > 0 && batch > reveal, 'loadTier hands a tier to the batches once its meshes are shown');
  const unload = body(layout, /^ {2}private unloadTier\(region/, 'unloadTier');
  ok(unload.some((l) => l.includes('this.shadowBatches?.drop(t.batch)')), 'unloadTier drops its batch');
  ok(world.some((l) => l.includes('this.layoutStream.shadowBatches = this.shadowBatches;')), 'the world hands the streamer the batches as it makes it');
}

// ---- The movers, the bench, the picture test, the helper's row and place. ----
{
  const frame = main.findIndex((l) => l.includes('this.fillShadowMovers(dt);'));
  const audio = main.lastIndexOf(main.slice(0, frame).reverse().find((l) => l.includes('this.stepAudio(dt);')) ?? '', frame);
  const shadows = main.findIndex((l, i) => i > frame && l.includes('this.world.updateShadows(performance.now());'));
  ok(frame > 0 && audio > 0 && audio < frame && shadows === frame + 1, 'the movers are listed after stepAudio (which poses the shuttles) and straight before updateShadows');
  const fill = body(main, /^ {2}private fillShadowMovers\(dt/, 'fillShadowMovers');
  ok(['this.world.vehicleMovers(m)', 'this.shuttleRigs?.shadowMovers(m)', 'this.remotes.shadowMovers(m)', 'this.world.moverGround(m)'].every((s) => fill.some((l) => l.includes(s))), 'from the vehicles, the stood shuttles and the peers, with the cached ground under each');
  // A hull's speed from its places is timed in the physics' steps: the count is written as the hulls copy their bodies'
  // places, before any of them steps and before the frame's physics step.
  const sv = body(main, /^ {2}private stepVehicles\(dt: number, simulate: boolean\): void \{/, 'stepVehicles');
  const stepsAt = indexOf(sv, 'this.world.shadowMovers.steps[0] = this.physics.steps;');
  const loop = indexOf(sv, 'for (const v of this.world.vehicles) {');
  const upd = indexOf(sv, 'if (!v.drift) v.update(dt, this.physics');
  const between = stepsAt > 0 && loop > stepsAt ? sv.slice(stepsAt + 1, loop) : [];
  ok(stepsAt > 0 && loop > stepsAt && loop - stepsAt <= 4 && upd > loop && !between.some((l) => /physics\.step|stepOnce|v\.update\(/.test(l)), 'stepVehicles writes the physics step count the hulls stand at just before they copy their bodies\' places, nothing stepping between');
  const frameLoop = main.findIndex((l) => l.includes('this.stepVehicles(dt, simulate);'));
  const physicsStep = main.findIndex((l, i) => i > frameLoop && l.includes('this.physics.step(dt);'));
  const fillAt = main.findIndex((l) => l.includes('this.fillShadowMovers(dt);'));
  ok(frameLoop > 0 && physicsStep > frameLoop && fillAt > physicsStep, 'and in the frame loop the hulls step, then the physics, then the movers are listed');
  const ground = body(world, /^ {2}moverGround\(out: ShadowMovers\): void \{/, 'moverGround');
  ok(ground.some((l) => l.includes('moverGroundInto(out, this.groundAtCached);')), "the movers' ground is the world's cached ground, read through moverGroundInto (the walk the perf test measures)");
  const terrain = read('src/world/swgTerrain.ts');
  const cached = body(terrain, /^ {2}heightIfCached\(gx: number/, 'heightIfCached');
  ok(cached.some((l) => l.includes('this.farGridAt(gx0, gz0, farSize, farRes)')) && !cached.some((l) => l.includes('farKey(')), 'and the cached ground finds a far grid by number, building no key');
  const benchAt = main.findIndex((l) => /^ {6}bench: async \(/.test(l));
  const bench = body(main, /^ {6}bench: async \(/, 'bench');
  const draws = bench.map((l, i) => (l.includes('this.drawFrame();') ? i : -1)).filter((i) => i >= 0);
  ok(benchAt > 0 && draws.length === 2 && draws.every((i) => bench[i - 1].includes('this.world.updateShadows(performance.now());')), '`bench` decides the cascades before each frame it draws');
  const cmp = body(main, /^ {2}private shadowCompare\(kind/, 'shadowCompare');
  const grab = cmp.findIndex((l) => l.includes('const grab = (): Uint8Array => {'));
  ok(grab > 0 && cmp[grab + 1].includes('w.updateShadows(performance.now());') && cmp[grab + 2].includes('this.drawFrame();'), "`shadowPass({ compare })` decides before every frame it grabs");
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').split(/\r?\n/);
  ok(readme.some((l) => l.startsWith('| `shadowPass()`')), 'shadowPass has a README row');
  ok(DEBUG_GROUPS.some((g) => g.title === 'Frame cost' && g.helpers.includes('shadowPass')), 'and a place in the debug menu\'s Frame cost group');
  ok(main.some((l) => l.includes('shadowDialsFor(helper)')), 'and its dials join the menu\'s chain of dial sets');
}

console.log(`\n${checks} checks passed`);

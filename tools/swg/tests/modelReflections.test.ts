// Reflections on the models (`src/world/envmap.ts`): what is worn, held, flown and ridden, and the creatures,
// join the reflections' registry as the world adopts them, where their shader has a cube; the previews swap a
// studio of their own onto those same materials around their own draws and put the world's back; and every
// registered material carries a black stand-in between worlds.
//
//   0. the stand-in handed over at boot, before any world has a sky, is in force at once, so a model met before
//      the first capture is built with it and the first sky changes no program;
//   1. a model's material joins only with a cube, once, and never takes over one a planet's pack registered;
//   2. `models` off writes them at nought and back as a uniform, and touches nothing else;
//   3. a copy made of one (a ship's paint, a clear pane) takes its original's own strength, wherever and
//      whenever it is made;
//   4. the stand-in: a world going hands every registered material the black stand-in instead of none, so no
//      program is asked for again between two worlds;
//   5. the previews' swap gives a material worn by many meshes its strength once, registered or not, and puts
//      the world's environment and strength back exactly, when the draw throws, and when a second swap is
//      begun over an open one; it asks for no program; it takes only a cube unless told to take the plain
//      ones, and those at `plain`;
//   6. every load path registers before it compiles, read from its own text: the one place a model joins is
//      the first sight of a material in `World.adoptMaterials`, and every path that loads something in play
//      (`prepareActor`, `prepareVehicle`, `prepareExtras`, `compileReady`, the streamer, the sweeps) adopts
//      before it compiles; the hooks the game hands every loader lead there, a vehicle's spawn, paint, refit
//      and rooms included; each preview compiles and draws only inside its swap, with the arguments it must
//      hand it; the doll's choice of studio, run; and the studio really filtered at the world's one size.
//
// Run: node tools/swg/tests/modelReflections.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  EnvironmentSwap,
  MODEL_REFLECTIONS_AT_LOAD,
  PREVIEW_REFLECTIONS,
  REFLECTIONS,
  currentEnvironment,
  environmentIsStandIn,
  isRegisteredReflective,
  joinModelReflections,
  modelReflectiveCount,
  registerReflective,
  setEnvironment,
  setEnvironmentStandIn,
  setModelReflections,
  setPlainReflections,
  takesEnvironment,
} from '../../../src/world/envmap.ts';
import { STUDIO_CUBE, StudioChoice, studioEnvironment } from '../../../src/ui/previewStudio.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const text = (path: string): string => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** A method's body as written (from its signature to the first line that closes at its own indentation). */
function bodyOf(src: string, signature: string, indent = '  '): string {
  const start = src.indexOf(signature);
  if (start < 0) return '';
  const end = src.indexOf(`\n${indent}}\n`, start);
  return src.slice(start, end < 0 ? undefined : end);
}
const before = (src: string, a: string | RegExp, b: string | RegExp): boolean => {
  const ia = typeof a === 'string' ? src.indexOf(a) : src.search(a);
  const ib = typeof b === 'string' ? src.indexOf(b) : src.search(b);
  return ia >= 0 && ib >= 0 && ia < ib;
};

/** A material as a converted model's GLB hands it over: format 6's `swgCube` in its userData, or nothing on an older pack. */
function material(cube: boolean | undefined, strength = 1): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.3 });
  m.envMapIntensity = strength;
  if (cube !== undefined) m.userData.swgCube = cube;
  return m;
}

ok(MODEL_REFLECTIONS_AT_LOAD, 'with nothing in storage the models join (the load-time hatch is `swg.reflections.models` = 0)');

// ---------------------------------------------------------------- 0. the stand-in handed over at boot
// The order the game uses, and so the first thing in this file, before anything sets an environment: `main.ts`
// hands the stand-in over at boot, while no world has a sky, and it must be in force at once, or a model met
// before the first capture is built with no environment and built again on the frame the sky arrives.
{
  ok(currentEnvironment().texture === null, 'at boot no environment is in force');
  const early = material(true);
  joinModelReflections(early);
  ok(early.envMap === null && isRegisteredReflective(early), 'a model met before anything is handed over joins with no environment yet');
  const black = new THREE.Texture();
  black.name = 'black stand-in at boot';
  setEnvironmentStandIn(black);
  ok(early.envMap === black && currentEnvironment().texture === black && environmentIsStandIn(), 'handed over while no world has a sky, the stand-in is in force at once, on what is registered already');
  const between = material(true);
  joinModelReflections(between);
  ok(between.envMap === black, 'and a model met after it, before the first sky, is built with it');
  const versions = [early.version, between.version];
  const first = new THREE.Texture();
  setEnvironment(first, 1);
  ok(early.envMap === first && between.envMap === first && early.version === versions[0] && between.version === versions[1], 'so the first sky is a texture swapped in: the programs built with the stand-in are the ones kept');
  for (const m of [early, between]) m.dispose();
  // Taken back, so section 4 can see how a world going was before there was one.
  setEnvironmentStandIn(null);
}

// ---------------------------------------------------------------- 1. joining
const sky = new THREE.Texture();
setEnvironment(sky, 1);
{
  const chrome = material(true, 0.8);
  const plain = material(false);
  const older = material(undefined);
  const basic = new THREE.MeshBasicMaterial();
  basic.userData.swgCube = true;
  const was = modelReflectiveCount();
  ok(joinModelReflections(chrome) && chrome.envMap === sky && chrome.envMapIntensity === 0.8, "a model's material whose shader has a cube joins, and takes the world's environment at its own strength");
  ok(chrome.version > 0, 'joined before anything compiles it, it is marked for its first program with the environment in it');
  ok(!joinModelReflections(chrome) && modelReflectiveCount() === was + 1, 'a second adoption joins nothing more');
  ok(!joinModelReflections(plain) && plain.envMap === null && !isRegisteredReflective(plain), 'a shader with no cube is left out, as the client drew it, with no environment in its program');
  ok(!joinModelReflections(older) && older.envMap === null, 'a pack converted before format 6 says nothing and is drawn exactly as before');
  ok(!joinModelReflections(basic) && !isRegisteredReflective(basic), 'an unlit material has nothing to reflect with');
  const pack = material(true, 0.6);
  registerReflective(pack);
  ok(!joinModelReflections(pack), "a planet's pack registered its own already: the world's adoption does not make it a model's");
  setModelReflections(false);
  ok(pack.envMapIntensity === 0.6, "so the models' switch never reaches a planet's own chrome");
  setModelReflections(true);
  for (const m of [chrome, plain, older, basic, pack]) m.dispose();
  ok(modelReflectiveCount() === was, 'a disposed model leaves the registry by itself');
}

// ---------------------------------------------------------------- 2. the switch
{
  const armour = material(true, 0.9);
  joinModelReflections(armour);
  const version = armour.version;
  const n = setModelReflections(false);
  ok(n >= 1 && armour.envMapIntensity === 0 && armour.envMap === sky, 'models off writes them at nought and keeps the map, so the program stays the one it was');
  ok(armour.version === version, 'and it is a uniform: nothing asks for the program again');
  ok(REFLECTIONS.models === false, 'the switch says so');
  const next = new THREE.Texture();
  setEnvironment(next, 1);
  ok(armour.envMap === next && armour.envMapIntensity === 0, 'a new capture of the sky keeps them at nought while the switch is off');
  setModelReflections(true);
  ok(armour.envMapIntensity === 0.9 && armour.version === version, 'and on again they take their own strength back, still compiling nothing');
  setEnvironment(sky, 1);
  armour.dispose();
}

// ---------------------------------------------------------------- 3. copies
{
  const hull = material(true, 0.7);
  joinModelReflections(hull);
  setModelReflections(false);
  // A ship's paint copies its sources with their userData, a clear pane spreads it, three's clone copies it.
  const paint = hull.clone();
  paint.userData = { ...hull.userData };
  const pane = hull.clone();
  ok(paint.envMapIntensity === 0 && pane.envMapIntensity === 0, 'a copy made while the models are off carries the nought written into its original (the trap)');
  joinModelReflections(paint);
  joinModelReflections(pane);
  setModelReflections(true);
  ok(paint.envMapIntensity === 0.7 && pane.envMapIntensity === 0.7, "joined, each takes its original's own strength back with the switch, not the nought it was made with");
  const late = paint.clone();
  joinModelReflections(late);
  ok(late.envMapIntensity === 0.7, 'and so does a copy of a copy');
  for (const m of [hull, paint, pane, late]) m.dispose();
}

// ---------------------------------------------------------------- 4. the stand-in between worlds
{
  const armour = material(true);
  joinModelReflections(armour);
  setEnvironment(null);
  ok(armour.envMap === null && !environmentIsStandIn(), 'with no stand-in handed over a world going leaves none (how it was)');
  setEnvironment(sky, 1);
  const black = new THREE.Texture();
  black.name = 'black stand-in';
  setEnvironmentStandIn(black);
  ok(armour.envMap === sky, 'handed over while a world has its own, nothing changes yet');
  const version = armour.version;
  setEnvironment(null);
  ok(armour.envMap === black && currentEnvironment().texture === black && environmentIsStandIn(), 'a world going hands every registered material the black stand-in, not none');
  ok(armour.version === version, 'and asks for no program: the environment never leaves the program between two worlds, so nothing carried across builds one');
  const next = new THREE.Texture();
  setEnvironment(next, 1);
  ok(armour.envMap === next && armour.version === version && !environmentIsStandIn(), 'and the next world\'s sky is a texture swapped in, nothing more');
  const fresh = material(true);
  setEnvironment(null);
  joinModelReflections(fresh);
  ok(fresh.envMap === black, 'a model that joins between two worlds is built with the stand-in, the program the next sky keeps');
  setEnvironment(sky, 1);
  for (const m of [armour, fresh]) m.dispose();
}

// ---------------------------------------------------------------- 5. the previews' swap
{
  const studio = new THREE.Texture();
  studio.name = 'studio';
  const visor = material(true, 0.8);
  joinModelReflections(visor);
  const loose = material(true, 0.5); // never adopted: the select screen at boot
  const plain = material(false, 0.9);
  const older = material(undefined);
  const root = new THREE.Group();
  const geo = new THREE.BoxGeometry();
  // Both cube materials worn by several meshes, `loose` among them twice in one mesh's own list: four identical guns
  // cloned from one part file, two copies of one hilt, a body and its clothes on one shader.
  root.add(
    new THREE.Mesh(geo, visor),
    new THREE.Mesh(geo, [visor, loose]),
    new THREE.Mesh(geo, plain),
    new THREE.Mesh(geo, older),
    new THREE.Mesh(geo, visor),
    new THREE.Mesh(geo, loose),
    new THREE.Mesh(geo, [loose, loose]),
  );
  const seen = (m: THREE.MeshStandardMaterial) => [m.envMap, m.envMapIntensity] as const;
  const wasVisor = seen(visor);
  const wasLoose = seen(loose);
  const wasPlain = seen(plain);
  const versions = [visor, loose, plain, older].map((m) => m.version);
  const swap = new EnvironmentSwap();
  let during: unknown[] = [];
  swap.around(root, studio, () => {
    during = [visor.envMap, visor.envMapIntensity, loose.envMap, loose.envMapIntensity, plain.envMap, older.envMap];
  }, 0.5);
  ok(during[0] === studio && during[1] === 0.4 && during[2] === studio && during[3] === 0.25, "for the draw a cube takes the studio at its own strength times the preview's, adopted or not, however many meshes wear it");
  ok(swap.last === 2, 'and each material is taken once a swap, so `last` counts materials, not meetings');
  ok(during[4] === null && during[5] === null, 'a plain shader and an older pack are left as they are unless asked');
  ok(seen(visor)[0] === wasVisor[0] && seen(visor)[1] === wasVisor[1] && seen(loose)[0] === wasLoose[0] && seen(loose)[1] === wasLoose[1], "after it the world's environment and strength are back exactly, on materials met three and four times over");
  for (let i = 0; i < 3; i++) swap.around(root, studio, () => {}, 0.5);
  ok(loose.envMapIntensity === wasLoose[1] && loose.envMap === wasLoose[0], 'and a swap made frame after frame leaves a material no registry holds exactly as it found it');
  ok([visor, loose, plain, older].every((m, i) => m.version === versions[i]), 'and it asked for no program at any point');
  let threw = false;
  try {
    swap.around(root, studio, () => {
      throw new Error('a draw that fails');
    });
  } catch {
    threw = true;
  }
  ok(threw && visor.envMap === wasVisor[0] && visor.envMapIntensity === wasVisor[1] && loose.envMap === null, "a draw that throws still puts the world's back");
  swap.on(root, studio, 0.5);
  swap.on(root, studio, 0.5);
  swap.off();
  ok(visor.envMap === wasVisor[0] && visor.envMapIntensity === wasVisor[1], 'a second swap begun over an open one puts the first back before it takes anything');
  swap.around(root, studio, () => {
    during = [plain.envMap, plain.envMapIntensity, older.envMap];
  }, 0.5, true);
  ok(during[0] === studio && during[1] === 0 && during[2] === null, 'with the plain ones asked for, a shader with no cube takes the studio at `plain` (nought) and an older pack is still left to the preview');
  setPlainReflections(1);
  swap.around(root, studio, () => {
    during = [plain.envMapIntensity];
  }, 0.5, true);
  ok(during[0] === 0.45, 'and `plain` 1 gives it its own strength there, as in the world');
  setPlainReflections(0);
  ok(seen(plain)[0] === wasPlain[0] && seen(plain)[1] === wasPlain[1], 'and it too comes back as it was');
  setModelReflections(false);
  swap.around(root, studio, () => {
    during = [visor.envMap, visor.envMapIntensity];
  }, 0.5);
  setModelReflections(true);
  ok(during[0] === studio && during[1] === 0, "with the models off the previews' models take none of it either, the program kept");
  swap.around(root, null, () => {
    during = [visor.envMap];
  });
  ok(during[0] === wasVisor[0] && swap.last === 0, 'no studio, nothing swapped');
  ok(takesEnvironment(root) && !takesEnvironment(new THREE.Mesh(geo, plain)) && takesEnvironment(new THREE.Mesh(geo, plain), true), 'a preview knows whether a model has anything to give its studio to');
  ok(PREVIEW_REFLECTIONS.strength === 0.5, "the previews' share is half, what the ship edit page's room was always given");
  for (const m of [visor, loose, plain, older]) m.dispose();
  geo.dispose();
}

// ---------------------------------------------------------------- 6. the load paths, as written
{
  const world = text('src/world/world.ts');
  const adopt = bodyOf(world, 'adoptMaterials(root: THREE.Object3D): THREE.Object3D[] {');
  const firstSight = adopt.slice(adopt.indexOf('if (!this.compiledMaterials.has(m)) {'), adopt.indexOf('if (csm && !this.csmMaterials.has(m)'));
  ok(/if \(m\.userData\.swgCube === true\) joinModelReflections\(m\);/.test(firstSight), "a model joins the first time the world adopts its material, before any of the wraps' compile");
  ok((world.match(/joinModelReflections\(/g) ?? []).length === 1, 'and nowhere else in the world');
  const prepares: [string, string][] = [
    ['async prepareActor(root: THREE.Object3D, label?: string, roomsLater?: RoomJob): Promise<void> {', 'await this.compileReady('],
    ['async prepareVehicle(roots: THREE.Object3D[]): Promise<void> {', 'await this.compileReady('],
    ['async prepareExtras(objects: THREE.Object3D[]): Promise<void> {', 'await this.compileReady('],
    ['async compileReady(objects: THREE.Object3D[], label?: string, opts?: { roomsLater?: RoomJob }): Promise<void> {', 'await this.queueOrBuild('],
    ['private async prepareStreamed(objects: THREE.Object3D[]): Promise<void> {', 'await this.queueOrBuild('],
    ['private async compileEverything(', 'await this.sweepBatches('],
    ['async compileCourse(', 'await this.sweepBatches('],
  ];
  for (const [sig, compile] of prepares) {
    const body = bodyOf(world, sig);
    ok(before(body, /this\.(adoptMaterials\(|setupShadowMaterials\(\))/, compile), `${sig.replace(/\(.*$/, '').replace(/^(private )?async /, '')} adopts, and so registers, before it compiles`);
  }
  ok(/private setupShadowMaterials\(\): void \{\s*const fresh = this\.adoptMaterials\(this\.scene\);/.test(world), 'the warm-up sweep adopts the whole scene before it compiles it');
  ok(/mobileAssets\.prepare = \(root, label, roomsLater\) => this\.prepareActor\(root, label, roomsLater\);/.test(world), "a creature's and a dressed person's model is prepared as an actor");
  ok(/vehiclePrepare: \(roots: THREE\.Object3D\[\]\) => Promise<void> = \(roots\) => this\.prepareVehicle\(roots\);/.test(world), 'the preparation every vehicle path is handed prepares it as a vehicle');
  // And every path is handed that one, not a stand-in that prepares nothing.
  const spawnBody = bodyOf(world, 'async spawnVehicle(');
  const hullBody = bodyOf(world, 'async spawnHull(');
  const refitBody = bodyOf(world, 'refitVehicle(v: Vehicle, next: ResolvedFit): Promise<RefitReport> {');
  // Each within its own call (no statement ends between the call and the option).
  ok(/this\.garage\.spawn\([^;]*?prepare: \(r\) => this\.vehiclePrepare\(r\),[^;]*?\}\);/.test(spawnBody) && /ShipInterior\.load\([^;]*?\{ prepare: \(roots\) => this\.vehiclePrepare\(roots\) \}\);/.test(spawnBody), "a spawned vehicle's hull, its paint and its rooms are handed the world's vehicle preparation");
  ok(/g\.spawn\([^;]*?prepare: \(roots\) => this\.vehiclePrepare\(roots\),[^;]*?\}\);/.test(hullBody), "an NPC ship's hull is handed it too");
  ok(/this\.garage\.refit\(v, next, \(r\) => this\.vehiclePrepare\(r\)\)/.test(refitBody), "a refit's staging is handed it");
  ok(/remoteInteriors\(\)\.bind\(\{[\s\S]*?prepare: \(roots\) => this\.vehiclePrepare\(roots\),/.test(world), "another player's hull's rooms are handed it");
  const garage = text('src/vehicles/garage.ts');
  ok(/new ShipPaint\([^\n]*\{ prepare: opts\.prepare \?\? noPrepare,/.test(garage), "a ship's paint copies are prepared through the hook its spawn was handed");
  ok(/this\.stage\(def, v\.build, was, next, v\.paint, prepare,/.test(bodyOf(garage, 'async refit(v: Vehicle, next: ResolvedFit, prepare:')) && /stageRefit\([\s\S]*?prepare,/.test(bodyOf(garage, 'private async stage(')), "and a refit's new parts through the hook the refit was handed");
  const main = text('src/main.ts');
  ok(/this\.world\.vehiclePrepare = async \(roots\) => \{\s*await this\.world\.prepareVehicle\(roots\);/.test(main), "and the game's widening of it still prepares the vehicle first");
  ok(/private async prepareRoot\(root: THREE\.Object3D\): Promise<void> \{[\s\S]{0,120}?await this\.world\.prepareActor\(root\);/.test(main), "what the backpack puts on and the hands take up, and another player's look, go through the world's prepareActor");
  ok(/prepare: \(root\) => this\.prepareRoot\(root\),/.test(main) && /this\.remotes\.prepare = \(root\) => this\.prepareRoot\(root\);/.test(main) && /this\.remotes\.prepareVehicle = \(roots\) => this\.world\.vehiclePrepare\(roots\);/.test(main), 'the equipment and the other players are handed exactly those');
  ok(/setEnvironmentStandIn\(this\.world\.waterBodies\.blackEnvironment\);/.test(main) && before(main, 'this.world.waterBodies.attach(this.renderer);', 'setEnvironmentStandIn('), 'the stand-in is handed over at boot, once the water has made it, before any world loads');
  // Since the performance pass's fifth wave the sky is captured into a kept cube of `DOME_CUBE` (`DomeCapture`), which
  // refuses any other size (`skyCapture.test.ts`).
  ok(/new DomeCapture\(new THREE\.PMREMGenerator\(renderer\)\)/.test(world) && /export const DOME_CUBE = 128;/.test(text('src/world/envmap.ts')) && /const WATER_CUBE_SIZE = 128;/.test(text('src/world/waterBodies.ts')) && STUDIO_CUBE === 128, "the world's sky captures and its black stand-in say 128 in their own source (the words only: making either needs a WebGL context), the studio's size with them");
  {
    // What the studio is really filtered at, through the real `studioEnvironment` with three's filter stood in for.
    const real = THREE.PMREMGenerator.prototype.fromScene;
    const asked: { size?: number }[] = [];
    const made = new THREE.WebGLRenderTarget(1, 1);
    THREE.PMREMGenerator.prototype.fromScene = function (_scene: THREE.Scene, _sigma?: number, _near?: number, _far?: number, options?: { size?: number }) {
      asked.push(options ?? {});
      return made;
    };
    let got: THREE.WebGLRenderTarget | null = null;
    try {
      got = studioEnvironment({} as THREE.WebGLRenderer);
    } finally {
      THREE.PMREMGenerator.prototype.fromScene = real;
    }
    ok(asked.length === 1 && asked[0].size === STUDIO_CUBE && got === made, "the previews' studio is filtered from a cube of the world's one size, so a program keyed with either is keyed alike");
    made.dispose();
  }
  {
    // The doll's choice of studio (`StudioChoice`), with its making stood in for.
    let makes = 0;
    const target = new THREE.WebGLRenderTarget(1, 1);
    const make = () => {
      makes++;
      return target;
    };
    const geo = new THREE.BoxGeometry();
    const cloth = material(false);
    const armour = material(true);
    const plainClone = new THREE.Mesh(geo, cloth);
    const choice = new StudioChoice(make, true);
    ok(choice.textureFor(plainClone) === null && choice.textureFor(plainClone) === null && makes === 0 && !choice.made, 'a doll in plain cloth makes no studio, asked once a clone');
    const dressed = new THREE.Group();
    dressed.add(new THREE.Mesh(geo, cloth), new THREE.Mesh(geo, armour));
    ok(choice.textureFor(dressed) === target.texture && makes === 1 && choice.made, 'the next clone, in armour with a cube, is asked again and makes one');
    ok(choice.textureFor(plainClone) === target.texture && choice.textureFor(dressed) === target.texture && makes === 1, 'and keeps it for every clone after, made once');
    const first = new StudioChoice(make, true);
    ok(first.textureFor(dressed) === target.texture && makes === 2, 'a doll whose first clone has a cube makes its studio for that first draw');
    const hatched = new StudioChoice(make, false);
    ok(hatched.textureFor(dressed) === null && hatched.textureFor(new THREE.Mesh(geo, armour)) === null && makes === 2, 'with the load-time hatch set no doll ever makes one');
    for (const m of [cloth, armour]) m.dispose();
    geo.dispose();
    target.dispose();
  }

  const doll = text('src/ui/characterPreview.ts');
  const draw = bodyOf(doll, 'private draw(model: THREE.Object3D): void {');
  ok(/this\.envSwap\.on\(model, this\.studio\.textureFor\(model\)\);\s*try \{\s*this\.drawWith\(model\);\s*\} finally \{\s*this\.envSwap\.off\(\);/.test(draw), "the doll draws only inside its swap, handing it the studio its choice makes, and puts the world's back in a finally");
  ok(/private readonly studio = new StudioChoice\(\(\) => studioEnvironment\(this\.renderer\)\);/.test(doll), "and that choice makes the studio in the doll's own context, at the hatch's word (its default)");
  const drawWith = bodyOf(doll, 'private drawWith(model: THREE.Object3D): void {');
  const calls = (s: string) => (s.match(/this\.renderer\.render\(|dof\.render\(|dof\.warm\(/g) ?? []).length;
  ok(calls(doll) === calls(drawWith) && calls(drawWith) >= 3, 'every render and every warm-up the doll makes is in that one draw');
  ok((doll.match(/this\.draw\(/g) ?? []).length >= 2 && !/renderer\.compile/.test(doll), 'and it compiles nothing anywhere else');
  const stage = text('src/ui/shipPreview.ts');
  ok((stage.match(/this\.renderer\.render\(/g) ?? []).length === 1 && /private draw\(holder: THREE\.Object3D\): void \{[^}]*?this\.envSwap\.on\(holder, this\.envTarget\.texture, PREVIEW_REFLECTIONS\.strength, true\);\s*try \{\s*this\.renderer\.render\(this\.scene, this\.camera\);\s*\} finally \{\s*this\.envSwap\.off\(\);/.test(stage), "the ship edit page draws only inside its swap, handing its room to the hull it draws at the previews' share with the plain ones too, the world's back in a finally");
  ok(/this\.envSwap\.on\(o, this\.envTarget\.texture, PREVIEW_REFLECTIONS\.strength, true\);\s*let job[^\n]*\n\s*try \{[\s\S]*?r\.compile\(soloRoot\(o\)[\s\S]*?r\.compileAsync\(soloRoot\(o\)[\s\S]*?\} finally \{\s*this\.envSwap\.off\(\);\s*restore\?\.\(\);/.test(stage), 'and compiles a drawable only inside it, with the very same swap its draw makes, beside the shadow records it puts back');
  ok(/this\.envTarget = studioEnvironment\(this\.renderer\);\s*this\.scene\.environment = this\.envTarget\.texture;/.test(stage), "its room is the previews' studio, made in its own context");
}

setEnvironment(null);
console.log(`\nmodelReflections: ${passed} checks passed`);

// The smoke and fire at a raced hull's damaged engines (src/vehicles/engineFx.ts), over a stand-in for the ship effects
// and a stand-in hull: the three files made ready once, a whole hull showing nothing, each side's band lighting its own
// file at that side's own glow point and following it as the hull moves (its world matrix worked out afresh, never last
// frame's), a band that moves putting the old effect out and lighting the new, an effect put out taken away only once
// what it made has died, a hull leaving the list or the drive putting its effects out, `clear` taking every one away,
// and a file that would not load placing nothing and saying so once. Then the game's own wiring, by its text. Invented
// numbers throughout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ENGINE_FX_FILES, EngineFx, type EngineFxHandle, type EngineFxHost, type EngineFxVehicle } from '../../../src/vehicles/engineFx.ts';
import { newEngineSet, stepEngines, type EngineSet } from '../../../src/vehicles/drivetrain.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const f2 = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(2)).join(', ');

interface Handle extends EngineFxHandle {
  readonly file: string;
}

/** The ship effects written down: every placing, move and removal recorded, nothing drawn. */
class Host implements EngineFxHost {
  readonly asked: string[] = [];
  readonly missing = new Set<string>();
  readonly placed: Handle[] = [];
  readonly where = new Map<EngineFxHandle, THREE.Vector3>();
  readonly removed = new Set<EngineFxHandle>();
  readonly particles = new Map<EngineFxHandle, number>();
  prepare(file: string): Promise<boolean> {
    this.asked.push(file);
    return Promise.resolve(!this.missing.has(file));
  }
  place(file: string, matrix: THREE.Matrix4, _contained: boolean, transient = false): EngineFxHandle {
    assert.equal(transient, false, 'a band is a standing effect');
    const h: Handle = { rateScale: 1, file };
    this.placed.push(h);
    this.where.set(h, new THREE.Vector3().setFromMatrixPosition(matrix));
    this.particles.set(h, 12);
    return h;
  }
  move(handle: EngineFxHandle, matrix: THREE.Matrix4): void {
    this.where.get(handle)!.setFromMatrixPosition(matrix);
  }
  remove(handle: EngineFxHandle): void {
    this.removed.add(handle);
  }
  particlesOf(handle: EngineFxHandle): number {
    return this.particles.get(handle) ?? 0;
  }
  /** The effects placed and not taken away. */
  standing(): Handle[] {
    return this.placed.filter((h) => !this.removed.has(h));
  }
}

/** A raced pod as the effects read one: a group in a scene, a glow point each side at its rear (left is +x), its engines. */
function pod(): { v: EngineFxVehicle & { disposed: boolean; destroyed: boolean }; engines: EngineSet; race: { engines: EngineSet; active: boolean }; left: THREE.Object3D; right: THREE.Object3D; group: THREE.Group } {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.position.set(100, 2, -40);
  group.rotation.y = 0.7;
  scene.add(group);
  const model = new THREE.Group();
  model.position.set(0, 0.4, 0.3);
  group.add(model);
  const spot = (x: number): THREE.Object3D => {
    const s = new THREE.Object3D();
    s.position.set(x, 0.6, -4.5);
    s.add(new THREE.Sprite());
    model.add(s);
    return s;
  };
  const left = spot(1.8);
  const right = spot(-1.8);
  const engines = newEngineSet('pod');
  const race = { engines, active: true };
  const v = {
    group,
    disposed: false,
    destroyed: false,
    spec: { bounds: { min: [-2.5, 0, -5], max: [2.5, 2, 5] } },
    engines: [{ object: left.children[0] }, { object: right.children[0] }],
    race,
  };
  scene.updateMatrixWorld(true);
  return { v, engines, race, left, right, group };
}
/** One frame as the game steps it: the drive's engines first (their mean damage and fire bits, which a step works out), then the effects. */
function tick(fx: EngineFx, p: { v: EngineFxVehicle; engines: EngineSet }): void {
  p.engines.dt = 0;
  stepEngines(p.engines);
  fx.update([p.v]);
}
const worldOf = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
};

// --- made ready once ------------------------------------------------------------------------------------------------------
{
  const host = new Host();
  const fx = new EngineFx();
  fx.attach(host);
  await fx.prepare(null);
  ok(host.asked.join() === ENGINE_FX_FILES.join(), 'the three band effects are made ready, each once');
  await fx.prepare(null);
  ok(host.asked.length === 3, 'and asked again they are not made again');
}

// --- a side's band, at its own point, following it ----------------------------------------------------------------------
{
  const host = new Host();
  const fx = new EngineFx();
  fx.attach(host);
  await fx.prepare(null);
  const p = pod();
  tick(fx, p);
  ok(host.placed.length === 0, 'a hull whose engines are whole shows nothing');

  p.engines.parts[1].d = 0.3;
  tick(fx, p);
  const light = host.placed[0];
  ok(host.placed.length === 1 && light.file === ENGINE_FX_FILES[0], `a left part at a quarter lights the light smoke, once (${host.placed.map((h) => h.file).join(', ')})`);
  ok(host.where.get(light)!.distanceTo(worldOf(p.left)) < 1e-9, `at the left glow point (${f2(host.where.get(light)!)})`);

  // The hull moved and turned as the drive writes it, with nothing working its matrices out before the effects read them.
  p.group.position.x += 5.5;
  p.group.position.z -= 2;
  p.group.rotation.y += 0.3;
  tick(fx, p);
  ok(host.where.get(light)!.distanceTo(worldOf(p.left)) < 1e-9, `and it follows the point where the hull stands this frame, not where it stood the last (${f2(host.where.get(light)!)})`);

  // Into the burning band: the smoke put out where it stands, the fire lit.
  p.engines.parts[1].d = 0.55;
  tick(fx, p);
  const fire = host.placed[1];
  ok(light.rateScale === 0 && !host.removed.has(light) && fire?.file === ENGINE_FX_FILES[1], 'a part past half puts the smoke out (it makes nothing more) and lights the burning effect');
  p.group.position.z += 3;
  tick(fx, p);
  ok(host.where.get(light)!.distanceTo(worldOf(p.left)) < 1e-9, 'what was put out still rides its point while what it made dies away');
  host.particles.set(light, 0);
  tick(fx, p);
  ok(host.removed.has(light) && !host.removed.has(fire), 'and is taken away once nothing it made is left');

  // The right side's own band, at its own point.
  p.engines.parts[5].fire = 1;
  tick(fx, p);
  const right = host.placed[2];
  ok(right?.file === ENGINE_FX_FILES[1] && host.where.get(right)!.distanceTo(worldOf(p.right)) < 1e-9, 'a right part on fire burns at the right glow point');

  // The drive letting the hull go: everything put out.
  p.race.active = false;
  tick(fx, p);
  ok(fire.rateScale === 0 && right.rateScale === 0, 'a hull the drive no longer holds has its effects put out');
  p.race.active = true;
  tick(fx, p);
  const back = host.standing().filter((h) => h.rateScale > 0);
  ok(back.length === 2, `held again with the same damage, its bands light again (${back.length})`);

  // The hull gone from the list: put out, and its record dropped.
  fx.update([]);
  ok(back.every((h) => h.rateScale === 0), 'a hull gone from the list has its effects put out');
  ok((fx.report(p.v).sides as unknown) === 'nothing damaged yet', 'and its record dropped');
  for (const h of back) host.particles.set(h, 0);
  fx.update([]);
  ok(back.every((h) => host.removed.has(h)), 'and they are taken away once they have died away');
}

// --- clear ----------------------------------------------------------------------------------------------------------------
{
  const host = new Host();
  const fx = new EngineFx();
  fx.attach(host);
  await fx.prepare(null);
  const p = pod();
  p.engines.parts[0].d = 0.9;
  p.engines.parts[4].d = 0.3;
  tick(fx, p);
  p.engines.parts[4].d = 0.6;
  tick(fx, p);
  ok(host.standing().length === 3, `two sides lit and one put out still dying (${host.standing().length})`);
  fx.clear();
  ok(host.standing().length === 0 && (fx.report(p.v).dying as number) === 0, 'clear takes every one away at once, the dying with them');
  tick(fx, p);
  ok(host.standing().length === 2, 'and the hull still racing lights its bands afresh on the next update');
}

// --- a file that would not load -------------------------------------------------------------------------------------------
{
  const host = new Host();
  host.missing.add(ENGINE_FX_FILES[1]);
  const said: string[] = [];
  const info = console.info;
  console.info = (...a: unknown[]) => void said.push(a.join(' '));
  const fx = new EngineFx();
  fx.attach(host);
  try {
    await fx.prepare(null);
    await fx.prepare(null);
  } finally {
    console.info = info;
  }
  ok(said.length === 1 && said[0].includes(ENGINE_FX_FILES[1]), `a file that does not load is said once (${said.length})`);
  const p = pod();
  p.engines.parts[2].fire = 1;
  tick(fx, p);
  ok(host.placed.length === 0, 'and its band places nothing');
  p.engines.parts[2].d = 0.8;
  tick(fx, p);
  ok(host.placed.length === 1 && host.placed[0].file === ENGINE_FX_FILES[2], 'while a band whose file did load still lights');
}

// --- the game's own wiring ------------------------------------------------------------------------------------------------
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/this\.engineFx\.attach\(this\.world\.shipFx\);/.test(main), '(main.ts: the effects play through the session\'s ship effects)');
  const ships = main.indexOf('await this.world.ships.prepareEffects(this.renderer);');
  const prep = main.indexOf('await this.engineFx.prepare(this.renderer);');
  const compile = main.indexOf('await this.world.compileAllAsync(', prep);
  ok(ships > 0 && prep > ships && compile > prep && main.slice(prep, compile).split('\n').length < 30, '(main.ts: made ready behind the loading screen, before its compile)');
  ok(/this\.engineFx\.update\(this\.world\.vehicles\);/.test(main), '(main.ts: stepped over every vehicle each frame)');
  const arriveAt = main.indexOf('private arrive(planet: PlanetDef');
  const arrive = main.slice(arriveAt, main.indexOf('\n  }\n', arriveAt));
  ok(arriveAt > 0 && /this\.world\.load\(planet, packIdOf\(planet, this\.zone\)\);/.test(arrive) && /this\.shuttleRigs\?\.clear\(\);\n(?:\s*\/\/[^\n]*\n)*\s*this\.engineFx\.clear\(\);/.test(arrive), '(main.ts: cleared as an arrival unloads the world, beside the shuttles that outlive it too)');
  ok(/this\.engineFx\.clear\(\);\n\s*this\.world\.loadCarrying\(/.test(main), '(main.ts: and before a jump swaps the world under a hull)');
  ok(/this\.engineFx\.clear\(\);\n\s*this\.world\.leave\(\);/.test(main), '(main.ts: and on the way to the select screen)');
}

console.log(`\nengineFx: ${checks} checks passed`);

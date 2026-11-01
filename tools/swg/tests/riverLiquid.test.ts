// A river feeds the volumetrics' liquid (Map-maker II's sixth wave, DESIGN.md §9): the air's ground sampler asks the
// river under a point (`feedRiverFlow`, the line `World.airGround` carries), and where the river's surface is the water
// there its run times its velocity goes into the ground sample's flow, which the raster keeps (`AirRaster.flow`), the field
// uploads (`debugTexture('flow')`) and the liquid tile's advect reads (`uFlowR`) toward its ribbon-flow share. Held here
// through the real `AirField.update` with the recording stand-in renderer `airFrame.test.ts` uses: the raster and its
// texture hold the run at the river's velocity over the river and nothing off it; a lake standing higher than the river
// takes the point and feeds none; ground standing over the river's surface is land and is fed none; and a world with no
// river (an empty list, asked every sample with no guard of the sampler's own) feeds exactly what a sampler that never
// asks fed, array for array.
//
// Run: node tools/swg/tests/riverLiquid.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AirField, newAirFrameInput, type AirWorld } from '../../../src/world/volumetrics/airField.ts';
import type { GroundSample, GroundSampler } from '../../../src/world/volumetrics/airRaster.ts';
import { newVolTune } from '../../../src/world/volumetrics/volSettings.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { feedRiverFlow, riverFlowAt, riversSurface, riverTable, type RiverFlow, type RiverTable } from '../../../src/world/ourWater.ts';
import { readWaterRow, type WaterRiverRow } from '../../../src/world/editFiles/waterFile.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A renderer that draws nothing and records each draw's material (airFrame.test.ts's stand-in, cut to what is read here). */
function standIn(): { renderer: THREE.WebGLRenderer; draws: { name: string; material: THREE.ShaderMaterial }[] } {
  const draws: { name: string; material: THREE.ShaderMaterial }[] = [];
  let target: unknown = null;
  const gl = { getExtension: (): object => ({}), RED: 6403, RG: 33319, IMPLEMENTATION_COLOR_READ_FORMAT: 35739, getParameter: (): number => 6408 };
  const renderer = {
    autoClear: true,
    getContext: () => gl,
    getRenderTarget: (): unknown => target,
    setRenderTarget: (t: unknown): void => {
      target = t;
    },
    getClearAlpha: (): number => 1,
    getClearColor: (c: THREE.Color): THREE.Color => c.setRGB(0, 0, 0),
    setClearColor: (): void => undefined,
    clear: (): void => undefined,
    render(obj: THREE.Object3D, cam: THREE.Camera): void {
      if ((obj as THREE.Scene).isScene) {
        (obj as THREE.Scene).onAfterRender(renderer as unknown as THREE.WebGLRenderer, obj as THREE.Scene, cam, null as never, null as never, null as never);
        return;
      }
      const m = (obj as THREE.Mesh).material as THREE.ShaderMaterial;
      draws.push({ name: m.name, material: m });
    },
    renderBufferDirect(_cam: THREE.Camera, _scene: THREE.Scene, _geo: THREE.BufferGeometry, material: THREE.Material): void {
      draws.push({ name: material.name, material: material as THREE.ShaderMaterial });
    },
    compile: (): void => undefined,
    info: { programs: [] as unknown[] },
    properties: { get: (): object => ({}) },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, draws };
}

/** A river of ours down a flat valley floor at nought: its surface a metre and a half over it, falling a little east. */
const row = readWaterRow({ id: 'run', kind: 'river', points: [[-60, 10, 1.6], [-20, 10, 1.5], [20, -10, 1.4], [60, -10, 1.3]], width: 10, velocity: 2.5, shader: 'wter_spec' }) as WaterRiverRow;
assert.ok(typeof row !== 'string');
const table = riverTable(row, (x) => x, (z) => z);

/**
 * The air's ground sampler as `World.airGround` asks it (its lines for a world with no lava and no ribbon): the higher of
 * the ground and the water, medium 2 where water stands over the ground, and the river's flow fed where its surface is that
 * water. `level` is the planet's own level; `lake` a lake standing over part of it; `ask` false leaves the river line out,
 * as the game before this wave; `ground` the ground's height at a place (flat at nought unless given); `guard` false asks
 * the rivers even with none, so what a world with none feeds is `feedRiverFlow`'s and `riversSurface`'s own answer and not
 * this sampler's guard.
 */
function sampler(list: RiverTable[], ask: boolean, lake: { x0: number; x1: number; h: number } | null = null, ground: (x: number) => number = () => 0, guard = true): GroundSampler {
  const hit: RiverFlow = { h: 0, fx: 0, fz: 0 };
  return {
    sample(x: number, z: number, out: GroundSample): boolean {
      const h = ground(x);
      let water = -5;
      if (lake && x >= lake.x0 && x <= lake.x1 && lake.h > water) water = lake.h;
      if (!guard || list.length) water = riversSurface(list, x, z, water);
      out.h = water > h ? water : h;
      out.family = 1;
      out.medium = water > h ? 2 : 1;
      if (ask && (!guard || list.length)) feedRiverFlow(list, x, z, water, out, hit);
      out.tint = -1;
      return true;
    },
  };
}

interface Rig {
  field: AirField;
  draws: { name: string; material: THREE.ShaderMaterial }[];
  frame(dt: number): void;
}

function rig(ground: GroundSampler, world: Partial<AirWorld> = {}): Rig {
  const { renderer, draws } = standIn();
  const tune = newVolTune();
  tune.on = true;
  const field = new AirField(renderer, tune, { ground, boxes: null, hulls: [], ...world });
  field.raster.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 85, 255]);
  field.raster.familyColour = new Uint8Array([0, 0, 0, 0, 204, 168, 117, 255]);
  const inp = newAirFrameInput();
  inp.reading = true;
  inp.windHeading = 0.4;
  inp.windSpeed = 3;
  inp.sunY = 0.8;
  inp.sunZ = 0.6;
  return {
    field,
    draws,
    frame(dt: number): void {
      inp.dt = dt;
      inp.time += dt;
      field.update(inp);
    },
  };
}

function settle(r: Rig): void {
  for (let i = 0; i < 400 && (r.field.raster.unknown > 0 || i < 4); i++) r.frame(1 / 60);
  r.frame(1 / 60);
}

// --- a river feeds its run ---
{
  const r = rig(sampler([table], true));
  settle(r);
  const ras = r.field.raster;
  const n = ras.n;
  const w = r.field.win;
  let over = 0;
  let exact = true;
  let off = true;
  const hit: RiverFlow = { h: 0, fx: 0, fz: 0 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = w.ox + (i + 0.5) * w.cell;
      const z = w.oz + (j + 0.5) * w.cell;
      const k = j * n + i;
      if (riverFlowAt([table], x, z, hit)) {
        over++;
        if (ras.flow[k * 2] !== Math.fround(hit.fx) || ras.flow[k * 2 + 1] !== Math.fround(hit.fz)) exact = false;
      } else if (ras.flow[k * 2] !== 0 || ras.flow[k * 2 + 1] !== 0) off = false;
    }
  }
  ok(over > 20 && exact, `the raster holds the river's run at its velocity in every cell over it (${over} cells), to the float`);
  ok(off && ras.flowCells === over, 'and nothing off it: the cells it counts are the river\'s');
  const sample = (() => {
    for (let k = 0; k < n * n; k++) if (ras.flow[k * 2] !== 0 || ras.flow[k * 2 + 1] !== 0) return [ras.flow[k * 2], ras.flow[k * 2 + 1]];
    return [0, 0];
  })();
  ok(Math.abs(Math.hypot(sample[0], sample[1]) - row.velocity) < 1e-5, `each cell's flow as long as the river's ${row.velocity} m/s (${Math.hypot(sample[0], sample[1]).toFixed(5)})`);
  const tex = r.field.debugTexture('flow') as THREE.DataTexture | null;
  ok(!!tex && tex.image.data === ras.flow, "the field's flow texture is that raster, uploaded as it moved");
  const advect = r.draws.filter((d) => d.name === 'air.advect');
  ok(advect.length > 0 && advect.every((d) => d.material.uniforms.uFlowR.value === tex), 'and the liquid tile\'s advect reads it (`uFlowR`)');
  const liquidR = advect[0].material.uniforms.uLiquidR.value as THREE.Vector4;
  ok(liquidR.y === AIR_TUNE.liquid.ribbonFlow, `toward its ribbon-flow share (${liquidR.y})`);
  ok(r.field.liquidLive, 'and the liquid tile is stepped');
}

// --- a lake standing higher takes the point ---
{
  const r = rig(sampler([table], true, { x0: -100, x1: 0, h: 3 }));
  settle(r);
  const ras = r.field.raster;
  const n = ras.n;
  const w = r.field.win;
  let lakeSide = true;
  let riverSide = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = w.ox + (i + 0.5) * w.cell;
      const k = j * n + i;
      const has = ras.flow[k * 2] !== 0 || ras.flow[k * 2 + 1] !== 0;
      if (x <= 0 && has) lakeSide = false;
      if (x > 0 && has) riverSide++;
    }
  }
  ok(lakeSide && riverSide > 0, `where a lake stands higher than the river the lake's still water is fed no flow; the river's own reach beyond it is (${riverSide} cells)`);
}

// --- ground standing over the river's surface: land, fed nothing ---
{
  // The ground rises to 2 m east of x = 40, over the river's surface there (about 1.3 m): those cells are land (medium 1),
  // and the river under the ground feeds them no flow, where its reach west of it still does.
  const rise = (x: number): number => (x > 40 ? 2 : 0);
  const r = rig(sampler([table], true, null, rise));
  settle(r);
  const ras = r.field.raster;
  const n = ras.n;
  const w = r.field.win;
  const hit: RiverFlow = { h: 0, fx: 0, fz: 0 };
  let land = 0;
  let landDry = true;
  let wet = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = w.ox + (i + 0.5) * w.cell;
      const z = w.oz + (j + 0.5) * w.cell;
      const k = j * n + i;
      if (!riverFlowAt([table], x, z, hit)) continue;
      const has = ras.flow[k * 2] !== 0 || ras.flow[k * 2 + 1] !== 0;
      if (x > 40) {
        land++;
        if (has) landDry = false;
      } else if (has) wet++;
    }
  }
  ok(land > 0 && landDry && wet > 20, `where the ground stands over the river's surface the cell is land and fed no flow (${land} cells), the water beside it still fed (${wet})`);
  const out = { medium: 1, flowX: 7, flowZ: -7 };
  feedRiverFlow([table], 50, -10, riversSurface([table], 50, -10, -5), out, hit);
  ok(out.flowX === 7 && out.flowZ === -7, '`feedRiverFlow` writes nothing into a sample that is not water, though the river is over it');
}

// --- no river: exactly what a sampler that never asked fed ---
{
  const hit: RiverFlow = { h: 0, fx: 0, fz: 0 };
  const out = { medium: 2, flowX: 7, flowZ: -7 };
  feedRiverFlow([], 0, 0, 1, out, hit);
  ok(out.flowX === 7 && out.flowZ === -7 && riversSurface([], 0, 0, 1) === 1, "`feedRiverFlow` with no river writes nothing, and `riversSurface` hands back the water it was given");
  // A sampler that asks the empty list every time (no guard of its own) against one that never asks.
  const a = rig(sampler([], true, null, () => 0, false));
  const b = rig(sampler([], false));
  settle(a);
  settle(b);
  const same = (x: ArrayLike<number>, y: ArrayLike<number>): boolean => {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  };
  const ra = a.field.raster;
  const rb = b.field.raster;
  ok(ra.flowCells === 0 && same(ra.flow, rb.flow) && ra.flow.every((v) => v === 0), 'a world with no river feeds no flow');
  ok(same(ra.height, rb.height) && same(ra.colour, rb.colour) && same(ra.response, rb.response) && same(ra.klass, rb.klass), 'and its raster, height, colour, response and class, is the one a sampler that never asks a river makes, to the value');
  // One more frame each, drawn pass for pass alike (the frames before carry work sliced by the clock, which two fields
  // made one after the other never share).
  const fa = a.draws.length;
  const fb = b.draws.length;
  a.frame(1 / 60);
  b.frame(1 / 60);
  const na = a.draws.slice(fa).map((d) => d.name).join();
  const nb = b.draws.slice(fb).map((d) => d.name).join();
  ok(na === nb && na.includes('air.advect'), `and a steady frame of each drawn pass for pass alike (${a.draws.length - fa} draws)`);
}

// --- the game's sampler carries the line ---
{
  const text = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  ok(text.includes('if (this.riverTables.length) feedRiverFlow(this.riverTables, x, z, water, out, this.riverFlowHit);'), "`World.airGround` asks the river under each point with the water it found there, and only while a river stands");
  const at = text.indexOf('feedRiverFlow(this.riverTables');
  ok(at > text.indexOf("out.medium = lava ? 3 : water > h ? 2 : 1;") && at < text.indexOf('if (this.ribbonsShown && out.medium !== 3 && ribbonAt('), 'after the medium is decided and before a lava ribbon may take the point');
}

console.log(`riverLiquid: ${checks} checks passed`);

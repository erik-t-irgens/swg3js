// The volume over the moving air (src/core/fx/airVolume.ts), built in node under plain type stripping (it imports only
// `.ts`-suffixed modules and nothing of the clouds'): it refuses with a reason for an amount of 0, in space, with the
// player in a building, with the camera in a building's view, under water, with no field and with nothing airborne, and
// draws with only the camera in a hull (whose box is kept clear of dust inside the march); it lists its three materials;
// its target is its setting's share of the screen, and no resize disposes a material; the cascade sampler is never null
// and no shadow compare is in a vertex stage; the light pass is sampled once a step; and the chain resizes it in
// `configure` (read as text: the chain itself is the browser's).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AIR_VOLUME_FRAGMENTS, AirVolumePass, MAX_VOLUME_STEPS } from '../../../src/core/fx/airVolume.ts';
import { createContext } from '../../../src/core/fx/context.ts';
import { FX_DEFAULTS, FX_PASSES, fxPassWanted, type FxSettings } from '../../../src/core/fxRegistry.ts';
import { FX_FULLSCREEN_VERTEX } from '../../../src/core/fx/glsl.ts';
import type { AirSource } from '../../../src/world/volumetrics/airField.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const source = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8');

/** A stand-in air: what the volume reads, with dust in the air and carried this frame unless told otherwise. */
function air(airborne = true, dust: THREE.Texture | null = new THREE.Texture(), dustLive = true): AirSource {
  return {
    dustLive,
    dust: { value: dust },
    light: { value: new THREE.Texture() },
    height: { value: new THREE.Texture() },
    obstacles: { value: new THREE.Texture() },
    window: { value: new THREE.Vector4(0, 0, 192, 1.5) },
    lightShift: { value: new THREE.Vector2() },
    band: { value: new THREE.Vector3() },
    inflow: { value: new THREE.Vector2(0, 1.8) },
    stormColour: { value: new THREE.Color() },
    lightOn: { value: 1 },
    hullInverse: { value: new THREE.Matrix4() },
    hullBox: { value: new THREE.Vector4() },
    hasAir: () => airborne,
    volumeDrew: false,
    debugTexture: () => null,
  };
}
const target = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
const ctx = createContext({} as THREE.WebGLRenderer, { ...FX_DEFAULTS }, target);
const on: FxSettings = { ...FX_DEFAULTS, volumetrics: true, airVolume: true, airVolumeAmount: 1 };
let src: AirSource | null = air();
const pass = new AirVolumePass(() => src);
pass.setSize(1600, 900, on);

const why = (): string | null => pass.reason(ctx);
ok(why() === null && pass.enabled(ctx), 'with the master on, a field, dust in the air and the camera outdoors, it draws');
ctx.cameraInHull = true;
ok(why() === null, 'and with the camera inside the hull it rides it still draws: the hull\'s box is kept clear of dust in the march');
ctx.cameraInHull = false;
for (const [field, words] of [
  ['space', 'in space'],
  ['portalView', 'the camera is in a building'],
  ['inside', 'the player is in a building'],
  ['cameraSubmerged', 'under water'],
] as const) {
  (ctx as unknown as Record<string, boolean>)[field] = true;
  const r = why();
  ok(r !== null && r.includes(words) && !pass.enabled(ctx), `${field}: it refuses ("${r}")`);
  (ctx as unknown as Record<string, boolean>)[field] = false;
}
pass.setSize(1600, 900, { ...on, airVolumeAmount: 0 });
ok(why()?.includes('at 0') === true, `an amount of 0 refuses ("${why()}"), so the composite at nothing is never reached (the clouds' bug)`);
pass.setSize(1600, 900, on);
src = null;
ok(why()?.includes('no air field') === true, `no field: it refuses ("${why()}")`);
src = air(false);
ok(why() === 'nothing is airborne', 'nothing airborne: it refuses');
src = air(true, null);
ok(why()?.includes('not stepping') === true, 'the air not stepping (its dust off, or nothing reading it): it refuses');
src = air(true, new THREE.Texture(), false);
ok(why()?.includes('not stepping') === true && !pass.enabled(ctx), "a field that keeps its dust texture but did not carry it this frame (the moving air or the dust turned off with the master on): it refuses rather than draw the frozen dust, in a storm too");
src = air();
pass.setSize(1600, 900, { ...on, volumetrics: false });
ok(why()?.includes('master is off') === true, 'and the master off: it refuses, whatever its own switch says');
// The chain's own rule over it: unwanted with the master off whatever its switch says.
const def = FX_PASSES.find((d) => d.id === 'airVolume')!;
ok(!fxPassWanted(def, { ...on, volumetrics: false }) && !fxPassWanted(def, { ...on, volumetrics: false }, true) && fxPassWanted(def, on), "the chain's rule: wanted only with the master on, an override notwithstanding");
ok(!def.typical && def.budgetMs > 0 && !def.canBeLast, 'it is not in the typical frame, has its budget and is never the last pass');

// --- materials, the target, resizes ---
pass.setSize(1600, 900, on);
const mats = pass.materials();
ok(mats.length === 3 && mats.map((m) => (m.material as THREE.ShaderMaterial).name).join() === 'fx.airVolume.march,fx.airVolume.resolve,fx.airVolume.composite', 'it lists the march, the resolve and the composite for the warm-up');
let disposed = 0;
for (const m of mats) m.material.addEventListener('dispose', () => disposed++);
for (const r of [0.25, 0.5, 1, 0.5, 0.25]) {
  pass.setSize(1600, 900, { ...on, airVolumeResolution: r });
  const size = pass.report().size as [number, number];
  ok(size[0] === Math.round(1600 * r) && size[1] === Math.round(900 * r), `at ${r} of the screen its target is ${size[0]}x${size[1]}`);
}
for (const steps of [6, 16, 48, 200]) {
  pass.setSize(1600, 900, { ...on, airVolumeSteps: steps });
  ok((pass.report().steps as number) === Math.min(steps, MAX_VOLUME_STEPS), `${steps} steps asked: ${Math.min(steps, MAX_VOLUME_STEPS)} marched, under the loop's bound`);
}
pass.setSize(800, 450, on);
ok(disposed === 0, 'no resize and no dial disposes a material: a program is never released to be built again on a live frame');

// --- the cascade sampler, the vertex stage, the light ---
const march = (mats[0].material as THREE.ShaderMaterial).uniforms;
for (const k of ['tShadow0', 'tShadow1', 'tShadow2']) {
  const t = march[k].value as THREE.DepthTexture | null;
  ok(!!t && t.isDepthTexture === true && t.compareFunction !== null && t.compareFunction !== undefined, `${k} holds a real compare depth texture from the start, never null`);
}
ok(/C\.maps\[0\] \?\? none : none/.test(source('core/fx/airVolume.ts')), 'and a cascade with no map is given the stand-in each frame, never null');
ok(!/sampler2DShadow|shadow2D|tShadow/.test(FX_FULLSCREEN_VERTEX), 'no shadow compare in the vertex stage');
const m = AIR_VOLUME_FRAGMENTS.march;
ok((m.match(/texture\(uLight,/g) ?? []).length === 1 && m.indexOf('texture(uLight,') > m.indexOf(`for (int i = 0; i < ${MAX_VOLUME_STEPS}; i++)`), 'the light pass is sampled once a step, inside the march');
ok(m.includes('if (inHull(p)) continue;'), "the ridden hull's box is empty air");
ok(m.includes('texture(uObstacles, uv).g > hy') && !m.includes('texture(uObstacles, uv).r'), "inside a solid, below its top, no dust is taken: the map's green, which holds a compound's rooms as well as the walls");

// --- the chain resizes it on its settings ---
const postfx = source('core/postfx.ts');
ok(postfx.includes("this.byPassId.get('airVolume')?.setSize(this.sizeV.x, this.sizeV.y, this.settings);") && postfx.includes('this.settings.airVolumeResolution !== air[0]'), "the chain's configure resizes the volume when its share of the screen moves");

console.log(`\n${checks} checks passed`);

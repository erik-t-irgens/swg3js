// The horizon pass's first wave's day one and its hand-overs (DESIGN.md §2.0 item 3, §3): with the switch at 'tiles' the
// game is PRE_PASS's (4c2ba23): the far tiles' builder, the terrain sampler and the far grids' reader are that commit's
// files to the byte, the generator the same but for its revision number, the switch starts at 'tiles' and nothing is
// fetched there; and every hand-over only the game makes (`world.ts`, `main.ts`, which node cannot load) pinned as text.
//
// Run: node tools/swg/tests/horizonWiring.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HORIZON_TUNE } from '../../../src/world/horizon/horizonMath.ts';
import { packHolds } from '../../../src/world/packFiles.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const PRE_PASS = '4c2ba23';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const fold = (s: string) => s.replace(/\r\n/g, '\n');
const now = (p: string) => fold(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const old = (p: string): string | null => {
  try {
    return fold(execFileSync('git', ['show', `${PRE_PASS}:${p}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1048576 }));
  } catch {
    return null;
  }
};

ok(HORIZON_TUNE.ground === 'tiles', "the switch starts at 'tiles': nothing of the wave reaches a player");
const pre = old('src/world/terrain.ts');
if (!pre) console.log(`note git cannot show ${PRE_PASS} here: the day-one file checks are left out`);
else {
  for (const p of ['src/world/terrain.ts', 'src/world/swgTerrain.ts', 'src/swg/terrain/trn.ts', 'src/world/groundTiles.ts', 'src/world/groundMath.ts']) ok(now(p) === old(p), `${p} is ${PRE_PASS}'s to the byte (the far tiles, the far grids and heightIfCached as they were)`);
  const gen = now('src/swg/terrain/generator.ts');
  const start = gen.indexOf('\n/**\n * The generator\'s revision');
  const end = gen.indexOf('export const GENERATOR_REVISION = 1;\n') + 'export const GENERATOR_REVISION = 1;\n'.length;
  ok(start > 0 && gen.slice(0, start) + gen.slice(end) === old('src/swg/terrain/generator.ts'), `the generator is ${PRE_PASS}'s but for GENERATOR_REVISION and its comment`);
}

// What a world fetches: the bake only where the command could write it.
ok(packHolds('tatooine', 'terrain/horizon.json') && packHolds('naboo', 'terrain/horizon.bin'), 'a ground world may hold a bake');
ok(!packHolds('dungeon1', 'terrain/horizon.json'), "the world of copies is never asked for one (its ground is the client's empty punch-out)");
ok(!packHolds('space_tatooine', 'terrain/horizon.json'), 'nor a space zone');

// The hand-overs in world.ts.
const w = now('src/world/world.ts');
const pin = (text: string, needle: string, what: string) => ok(text.includes(needle), what);
pin(w, "await this.loadGroundTextures(pack);\n          if (token !== this.loadToken) return null;\n          // The far ground's bake (the horizon pass), only with its switch off `'tiles'`: with it at `'tiles'` nothing is\n          // fetched and no ring stands, today's far tiles alone. Begun after the tile arrays, which its albedo reads, and\n          // decoded in its worker while the grass and the sky load here; joined after them (`joinWaitMs` is what it adds).\n          const horizon = HORIZON_TUNE.ground !== 'tiles' ? this.loadHorizon(this.packId, spawn).catch(", "world.ts: the bake begun after the tile arrays, and only off 'tiles'");
pin(w, "await this.loadSky(pack, spawn);\n          if (token !== this.loadToken) return null;\n          if (horizon) {\n            const tj = performance.now();\n            await horizon;\n            if (this.horizonField) this.horizonField.joinWaitMs = performance.now() - tj;\n            if (token !== this.loadToken) return null;\n          }", 'world.ts: and joined after the grass and the sky, before the arrival goes on (the decode overlaps them)');
pin(w, 'if (this.swgSky) copyDome(s.uniforms, this.swgSky.domeUniforms);', "world.ts: the dome's uniforms copied through the field's own function (its numbers into one vector's fields)");
pin(w, "field.rules.fogDensity = fog && (fog as THREE.FogExp2).isFogExp2 ? fog.density : 0;\n    field.update(s, camera, camera.position, this.viewRadius, pcx, pcz, this.horizonHole, camera.reversedDepth);", "world.ts: the fog's density into the field's kept record, never across the frame's call");
pin(w, 'if (f) f.timing = true;', 'world.ts: the selection timed only once the console asks');
pin(w, "if (HORIZON_TUNE.ground === 'rings' && this.horizonDrawn) return;", "world.ts: at 'rings' with the bake drawn, streamFar builds no far tile and asks for no far grid");
pin(w, "if (this.horizonDrawn) mesh.visible = HORIZON_TUNE.ground === 'both' && HORIZON_TUNE.drawn === 'tiles';", "world.ts: at 'both' a far tile is built and hidden while the rings are drawn");
pin(w, 'this.horizonHole.set(cx, cz, loaded);', 'world.ts: noteChunk writes the hole');
pin(w, "this.dropHorizon();\n    this.horizonHole.clear();", "world.ts: the unload lets the bake go and empties the hole");
pin(w, 'if (!field || !s || !this.horizonDrawn || this.planet.space || !s.patch.visible) return;', 'world.ts: the frame selects nothing off the rings');
pin(w, "if (session.patch.parent !== this.chunkRoot) this.chunkRoot.add(session.patch, session.skirt);", "world.ts: the rings hang under the chunks' root (layer 0, the world pass)");
// The hand-overs in main.ts.
const m = now('src/main.ts');
pin(m, "this.world.updateWeatherView(dt);\n      // The far ground's rings selected from this frame's camera (the horizon pass): nothing at the switch's 'tiles'.\n      this.world.updateHorizon(this.cam.camera);", "main.ts: the rings selected once a frame after the camera is placed");
pin(m, "registerPerfSwitch('horizon', {", "main.ts: the frame report's A/B switch");
pin(m, "// The far ground's measurement far plane and sky put back (the horizon pass): each world asks again.\n    this.horizonMeasureOff();\n    this.hyperspace.abort('travel');", 'main.ts: a travel puts the measurement back');
// Before the pair `engineFx.test` reads by adjacency (the effects' clear straight before the world's leave), never between it.
pin(m, "this.horizonMeasureOff();\n    // A raced hull's smoke and fire stand in the session's ship effects, which outlive every world: taken away with it.\n    this.engineFx.clear();\n    this.world.leave();", 'main.ts: the select screen puts the measurement back');
pin(m, "if (this.jumpFarKept !== null) {\n      this.jumpFarKept = far;\n      return;\n    }", "main.ts: the far plane is written through the jump's tunnel");
pin(m, "const on = HORIZON_TUNE.measure && this.world.horizonDrawn && cam.reversedDepth;", 'main.ts: measure moves the far plane only under reversed depth');
pin(m, 'HORIZON_WATCH.moved = () => void this.applyHorizonMeasure();', "main.ts: a slider the measurement follows moves the far plane as the console does");
pin(m, "if (typeof o?.reach === 'number' && o.reach > 0) said.push(...tuneHorizon({ reach: o.reach }));", "main.ts: the console's reach goes through tuneHorizon, the slider's own path");

console.log(`\nhorizonWiring: ${checks} checks passed`);

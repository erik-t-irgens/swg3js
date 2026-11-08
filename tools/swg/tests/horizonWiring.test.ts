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
  for (const p of ['src/world/terrain.ts', 'src/swg/terrain/trn.ts', 'src/world/groundTiles.ts', 'src/world/groundMath.ts']) ok(now(p) === old(p), `${p} is ${PRE_PASS}'s to the byte (the far tiles and the far grids as they were)`);
  // The second wave's two additions to swgTerrain.ts (the bake's hook in heightIfCached, null with no field, and the live
  // generator's grid for the overlays) taken back out by their own text: the rest PRE_PASS's to the byte.
  const swgNow = now('src/world/swgTerrain.ts');
  const hookAt = swgNow.indexOf("    // The far ground's bake, laid, while the rings stand");
  const hookEnd = swgNow.indexOf('      if (b === b) return b;\n    }\n', hookAt) + '      if (b === b) return b;\n    }\n'.length;
  const genAt = swgNow.indexOf("  /** The far ground's bake `heightIfCached` reads past the blocks");
  const genEnd = swgNow.indexOf('    return new Promise((resolve) => this.request(`horizon:${this.nextId}`, startX, startZ, n, step, resolve));\n  }\n\n', genAt) + '    return new Promise((resolve) => this.request(`horizon:${this.nextId}`, startX, startZ, n, step, resolve));\n  }\n\n'.length;
  ok(hookAt > 0 && genAt > hookAt && swgNow.slice(0, hookAt) + swgNow.slice(hookEnd, genAt) + swgNow.slice(genEnd) === old('src/world/swgTerrain.ts'), `src/world/swgTerrain.ts is ${PRE_PASS}'s to the byte but for the bake's hook (null with no field) and generatePoles`);
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
pin(w, "if (HORIZON_TUNE.ground === 'rings' && this.horizonDrawn) {\n      this.streamRingCards(center, budget);\n      return;\n    }", "world.ts: at 'rings' with the bake drawn, streamFar builds no far tile, only the far grids and cards within farGridRadius (W2)");
// W2's hand-overs.
// W2's review: the terrain itself handed over, its stores read at each lay, never a copy taken before the bake's fetch.
pin(w, 'const stores = swg;\n    const ok = await field.load(', "world.ts: the near ground's own stores (the terrain itself, read at each lay) laid over the bake as it loads, before anything is uploaded");
ok(!/\{ heights: swg\.heights, course: swg\.course \}/.test(w), "world.ts: no copy of the stores is taken anywhere (a file landing while the bake loads, or before a lay made again, is laid)");
pin(w, 'if (!f.relayLate(swg)) return;', 'world.ts: a late file laid from the terrain itself');
pin(w, 'void f.regenerate(paintRegenAsks(paint), (x, z, n, step) => swg.generatePoles(x, z, n, step), swg);', 'world.ts: a paint file landed late asks what an arrival asks (paintRegenAsks), its heights from the terrain itself');
pin(w, 'const done = field.regenerate(asks, (x, z, n, step) => swg.generatePoles(x, z, n, step), stores);\n    // A dropped building\'s or Life Day\'s heights moved under far cards that may already stand: stood again once laid.\n    if (asks.some((a) => a.heights)) void done.then(() => this.horizonField === field && this.farCards?.restand());\n    await Promise.race([done, new Promise<void>((r) => setTimeout(r, HORIZON_TUNE.regenWaitMs))]);', 'world.ts: what only the generator lays made again behind the screen, bounded by regenWaitMs, the far cards stood again once heights moved');
pin(w, "if (paint && !paint.empty) asks.push(...paintRegenAsks(paint));", 'world.ts: every painted 512 m tile made again');
pin(w, 'if (!dropped.has(li)) continue;', "world.ts: a building layer the removal file drops made again by its extent");
pin(w, 'if (TERRAIN_GROUND_TUNE.lifeDay && !h.source.lifeDay) for (const e of seasonalExtents(swg.template.generator))', "world.ts: Life Day's layers made again in season");
pin(w, "if (rect.x0 <= rect.x1) this.heightsChanged(rect.x0, rect.z0, rect.x1, rect.z1, true);\n    // A file landed late reaches the far ground's bake as it reached the near ground (W2): its whole layer laid again.\n    if (late) this.horizonLate();", 'world.ts: a heights file landed late laid over the bake whole');
pin(w, "this.landCourses(tracks ?? [], Number.NaN, Number.NaN, false);\n      // A course file later than the bound reaches the far ground's bake too (W2), laid whole.\n      this.horizonLate();", 'world.ts: a course file later than the bound laid over the bake whole');
pin(w, "if (this.flora) this.flora.onCourse = this.courseRule();\n    // And the far ground's bake, laid again whole with it (W2).\n    this.horizonLate();", 'world.ts: a course store taken late laid over the bake whole');
pin(w, "this.applyPaintWeights(true);\n      // The far ground's bake: every painted tile made again from the live generator (W2), landing in play.\n      this.horizonPaintLate();", 'world.ts: a paint file landed late makes the painted tiles again');
pin(w, 'if (this.terrain?.swg) this.terrain.swg.horizon = ready ? this.horizonField : null;', 'world.ts: heightIfCached reads the bake past the blocks only while it is drawn');
pin(w, "if (f && HORIZON_TUNE.ground === 'rings' && this.horizonDrawn) samples.surfaceAt = ringCardSurface(f, this.ringHole, gx0, gz0, () => this.viewRadius);", "world.ts: a far card stands on the ring's own surface at 'rings', round the hole as it stands when placed (ringCardSurface)");
pin(w, "if (ringHoleMoved(this.ringHole, pcx, pcz, this.viewRadius, HORIZON_TUNE) && this.ringCardTiles.size) this.farCards?.restand();\n    this.streamPcx = pcx;\n    this.streamPcz = pcz;\n    if (pcx === this.lastCx && pcz === this.lastCz && budget !== Infinity) return;", 'world.ts: the stream stands the ring cards again whenever the hole moves, before its early return (beside farProbe\'s pair, never between it)');
pin(w, "if (this.ringCardTiles.has(`${tx},${tz}`)) {\n        this.paintLandWork.far++;\n        this.farCardsAgain(tx, tz);\n        return;\n      }\n      const t = this.farTiles.get(`${tx},${tz}`);", "world.ts: a paint landing's far grid kept for the rings' cards makes its cards again (no far tile at 'rings')");
// The first unload runs before the first world has a terrain (a smoke found the plain `this.terrain.swg` there).
pin(w, 'if (this.terrain?.swg) this.terrain.swg.horizon = null;\n    this.releaseRingCards();', 'world.ts: the bake let go takes its hook and its far grids with it, a terrain or none');
pin(w, 'private releaseRingCards(): void {\n    if (!this.terrain) return;', 'world.ts: and lets its far grids go only where there is a terrain');
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
// W2's: the Graphics page's switch and distance, and the curtain both ways.
pin(m, "HORIZON_TUNE.ground = S.farRings ? 'rings' : 'tiles';\n    this.applyReach();", "main.ts: the page's switch read before any world, so the first arrival loads the bake when it is on");
pin(m, "case 'farRings':\n        // The far ground's switch (the horizon pass): the rings stood or the tiles made again behind a short curtain.\n        void this.setHorizonGround(S.farRings ? 'rings' : 'tiles')", "main.ts: the page's switch moved in play goes through setHorizonGround");
pin(m, "if (had && this.inWorld && !this.traveling) await this.groundCurtain('the far tiles', () => this.world.standFarGround(this.player.worldPos));", 'main.ts: back to the tiles, their builds a curtain\'s work');
pin(m, "await this.groundCurtain(\"the world's bake\", async () => {\n      await this.world.loadHorizon(this.world.packId, this.player.worldPos);\n      this.world.standFarGround(this.player.worldPos);\n    });", "main.ts: to the rings, the bake's load and the rings' far grids and cards a curtain's work");
pin(now('src/ui/menu.ts'), 'Not ready on Direct3D 11', "menu.ts: the rings' switch says it is not ready on Direct3D 11 (18 samplers past its 16, W3's to pack)");
pin(m, "if (r.horizon !== this.horizonReachApplied) {\n      this.horizonReachApplied = r.horizon;\n      tuneHorizon({ reach: r.horizon });", "main.ts: the Terrain distance (or the console's hold) reaches the rings through tuneHorizon, only when it moved");
pin(m, "if (key === 'farRadius' && this.settings.farRings) return { off:", "main.ts: the far tiles' radius greys while the rings stand in their place");

console.log(`\nhorizonWiring: ${checks} checks passed`);

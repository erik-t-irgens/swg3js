// The volumetrics' hand-overs, as text (the design's rule 16 and §4.1 item 8): every behaviour test builds what it calls,
// so the lines only the game makes are read out of main.ts, world.ts, jedi.ts, bountyHunter.ts, weather.ts, install.ts
// and postfx.ts: the step right after the weather's view half and only through `world.air`, handed last frame's view
// building; the volume's factory into the chain only with the master on; the arrival's registration only with the master
// on and the pass missing; the field's materials into the sweep only with the master on; every volumetrics key routed;
// the Force, the blasts and the wreck at their sites; the grains' gate in `emitDust`, today's lines left as they stood;
// the storm sheets' factor at the channel's rate; the world letting the field go at an unload; and the second wave's: a
// footstep the air's before it is the decal's, the ground's chooser in the getter every chunk asks, both grounds in the
// sweep, and the master in play warming through the world's queue and taken only after. A review once deleted each of a
// wave's hand-overs with every suite green, which is why they are pinned here.
//
// Plain type stripping; it reads the commit before the pass out of git for `emitDust` as it stood (and fails loudly
// when git cannot answer).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { showOld } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8').replace(/\r\n/g, '\n');
const main = src('main.ts');
const world = src('world/world.ts');
const weather = src('world/weather.ts');
const install = src('core/fx/install.ts');
const jedi = src('combat/jedi.ts');
const hunter = src('combat/bountyHunter.ts');
const lines = (s: string): string[] => s.split(/\r?\n/).map((l) => l.trim());
const after = (s: string, a: string, b: string, within = 12): boolean => {
  const L = lines(s);
  for (let i = 0; i < L.length; i++) if (L[i].includes(a)) for (let j = i + 1; j <= i + within && j < L.length; j++) if (L[j].includes(b)) return true;
  return false;
};
const count = (s: string, needle: string): number => s.split(needle).length - 1;

// --- the step ---
ok(after(main, 'this.world.updateWeatherView(dt);', 'this.world.updateAir(dt, simulate, this.lastViewBuilding, this.postfx !== null && this.postfx.passWanted(\'airVolume\'));', 6), "the air steps right after the weather's view half in the frame, handed last frame's view building and whether the volume reads it");
ok(count(main, '.updateAir(') === 1 && count(main, 'this.world.updateAir(') === 1, 'and only there, through the world');
ok(after(main, 'perf.passBegin(PASS.air);', 'this.world.updateAir(', 2) && after(main, 'this.world.updateAir(', 'perf.passEnd(PASS.air);', 2), "timed as the frame report's air pass");
ok(after(main, 'const view = this.portals.cameraCell(this.world.cellState, eye, cam.position, this.world.buildings).building;', 'this.lastViewBuilding = view !== null;', 4), "the draw keeps whether the camera is in a building's view for the next frame's air");
ok(/updateAir\(dt: number, simulate: boolean, viewInBuilding: boolean, reading: boolean\): void \{\n\s+const air = this\.air;\n\s+if \(!air \|\| !this\.camera\) \{/.test(world), 'the world steps nothing with no field: with the master off at an arrival there is none');
ok(world.includes("this.airSoftOff ? 'held off by the frame report' : !this.planet ? 'no world' : this.planet.space ? 'in space there is no air' : this.groundTextures?.empty ? 'the ground here is never drawn' : viewInBuilding ? 'the camera is in a building' : this.inside ? 'the player is in a building' : null"), "and does nothing in space, on the ground the client never drew, with the camera in a building's view or the player in a cell");
ok(world.includes('air: AirField | null = null;') && count(world, 'new AirField(') === 1 && /ensureAir\(\): AirField \| null \{\n\s+if \(this\.air \|\| !VOL_TUNE\.on \|\| !this\.renderer\) return this\.air;/.test(world), 'the field is made in one place, only with the master on');

// --- the chain ---
ok(main.includes("air: VOL_TUNE.on ? () => new AirVolumePass(() => this.world.air) : undefined"), "makePostFX hands the volume's factory only with the master on");
ok(install.includes('if (deps.air) postfx.registerPass(deps.air());'), 'and installEffects registers it only when handed one');
ok(/private prepareAir\(\): void \{\n\s+if \(!VOL_TUNE\.on \|\| VOL_HATCH_OFF\) return;\n\s+const air = this\.world\.ensureAir\(\);/.test(main) && main.includes("if (this.postfx && !this.postfx.pass('airVolume')) this.postfx.registerPass(new AirVolumePass(() => this.world.air));"), "an arrival registers the volume only with the master on and the pass missing");
ok(after(main, 'this.prepareAir();', 'const warmed = await this.postfx.warmUp();', 5), "and does it before the effects' warm-up compiles every pass, behind the loading screen");
ok(count(main, 'this.prepareAir();') === 1, 'and nowhere else: never in play');
ok(world.includes('if (this.air && VOL_TUNE.on) await this.air.warm();'), "the sweep compiles the field's own materials only with the master on");

// --- the settings ---
ok(main.includes("if (isVolKey(key) || key === 'effects') this.applyVolumetrics(key);"), 'every volumetrics key, and the Effects switch the volume rides on, is routed to the kept record');
ok(main.includes('volQualityFrom(this.settings, VOL_TUNE, this.volOver);') && /this\.applyVolumetrics\(\);\n\s+\/\/ The effects chain is built only now/.test(main), 'the record is written from the settings before the chain is first built');
ok(main.includes("this.menu.knobState = (key) => this.volKnobState(key);"), 'the page hears what the game says of the master');
ok(main.includes("VOL_HATCH_OFF = ((): boolean => {") && main.includes("localStorage.getItem('swg.vol') === '0'") && main.includes('if (VOL_HATCH_OFF) VOL_TUNE.on = false;'), "localStorage['swg.vol'] '0' holds the master off for the session");

// --- the forces at their sites ---
ok(count(jedi, 'world.air?.force(') === 2 && jedi.includes('world.air?.force(player.worldPos.x, player.worldPos.y, player.worldPos.z, tmp.x, tmp.z, 1, sign, 16)') && jedi.includes('world.air?.force(player.worldPos.x, player.worldPos.y, player.worldPos.z, 0, 0, 1, 1, 10)'), "the Force's push, pull and repulse stir the air, at their own reach");
ok(after(jedi, 'shoveLooseProps(player.worldPos, 16, sign, tmp, sign > 0 ? 18 : 10);', 'world.air?.force(', 4) && after(jedi, 'shoveLooseProps(player.worldPos, 10, 1, null, 20);', 'world.air?.force(', 3), 'beside the loose props they shove');
ok(hunter.includes('world.air?.blast(at.x, at.y, at.z, radius, push, 0);') && after(hunter, 'shoveLooseProps(at, radius * 1.5, 1, null, 12 + damage * 0.1);', 'world.air?.blast(', 4), "every blast of the kit's (grenade, charge, mine, a gun's splash) stirs the air by its own radius and push");
ok(after(main, 'this.effects.ring(v.pos, 0xffa050, 6 + v.radius, 0.5);', 'this.world.air?.blast(v.pos.x, v.pos.y, v.pos.z, AIR_TUNE.blast.wreckRadius + v.radius, AIR_TUNE.blast.wreckPush, 0);', 3), "a wreck's blast beside its ring");

// --- the grains' gate in emitDust, today's lines as they stood ---
{
  const oldWorld = showOld('src/world/world.ts');
  const body = (s: string): string => {
    const a = s.indexOf('private emitDust(dt: number): void {');
    const b = s.indexOf('\n  }\n', a);
    return s.slice(a, b);
  };
  const was = body(oldWorld);
  const now = body(world);
  ok(was.length > 200 && now.length > was.length, 'emitDust read from both the commit before the pass and today');
  let kept = true;
  for (const l of lines(was)) if (l && !lines(now).includes(l)) kept = false;
  ok(kept, "every line emitDust had stands in it today: the count and today's spawn are untouched");
  ok(now.includes('const air = this.air !== null && VOL_TUNE.on && VOL_TUNE.dust && this.air.forces.active ? this.air : null;'), 'the air is asked only with the master and the dust on and the field running');
  ok(now.includes('const shed = sheddingCount(count, perSecond, interval, air.raster.dustAt(w0.ox, w0.oz, w0.cell, tmpV.x, tmpV.z));') && now.includes('this.airGroundColour(air, tmpV.x, tmpV.z, this.dustColor), VOL_TUNE.kickUp);'), "then the count is the ground's share of today's, judged on a fixed twentieth of a second, thrown as grains with the kick-up on, in the cell's tinted colour (wave 2b's)");
  ok(/private airGroundColour\(air: AirField, x: number, z: number, out: THREE\.Color\): THREE\.Color \{[\s\S]{0,400}r\.tintedAt\(i, j, c\)\) return out\.setRGB\(c\[0\], c\[1\], c\[2\]\);/.test(world), "the motes' colour with the air's dust on is the raster's tintedAt (the lighter tones times the colour map's tint), the fallback's outside the window");
  // The motes a second handed over are the very ones today's count is rounded from: the same expression, so the two
  // can never disagree about how fast a machine throws.
  const countRate = /const count = Math\.round\(interval \* (\(12 \+ 70 \* Math\.min\(1, speed \/ 35\)\) \* \(0\.6 \+ Math\.min\(1\.4, w \* 0\.35\)\))\);/.exec(now);
  const perRate = /const perSecond = (.+);/.exec(now);
  ok(!!countRate && !!perRate && perRate[1] === countRate[1], `and the motes a second it is judged by are today's count's own expression, before its rounding (${perRate?.[1] ?? 'missing'})`);
  const branch = now.slice(now.indexOf('if (air) {'), now.indexOf('continue;', now.indexOf('if (air) {')));
  ok(branch.length > 0 && now.indexOf('if (air) {') < now.lastIndexOf('this.dust.spawn(tmpV.x, ground, tmpV.z, count, vel.x, vel.z, Math.max(0.6, w * 0.9), this.groundColorAt(tmpV.x, tmpV.z, this.dustColor));'), "and without the air, today's spawn, word for word");
  ok(/if \(air\.forces\.active && VOL_TUNE\.dust && VOL_TUNE\.kickUp\) \{[\s\S]{0,600}this\.dust\.ground = g;\n\s+\} else this\.dust\.ground = null;/.test(world), 'a grain has ground to fall on only while the dust and the kick-up are on and the field runs');
}

// --- the storm sheets ---
ok(after(weather, 'ch.handle.rateScale = active ? ch.weight * density * this.outside : 0;', "if (ch.kind === 'dust' && this.stormSheetScale !== 1) ch.handle.rateScale *= this.stormSheetScale;", 3), "a dust channel's rate takes the storm sheets' factor, and only when it is not 1");
ok(weather.includes('stormSheetScale = 1;'), 'which starts at 1: the sheets are today\'s');
ok(world.includes('this.weather.stormSheetScale = stormSheetFactor(air.volumeDrew, inp.storm, VOL_TUNE.stormThin);') && after(world, 'this.weather.stormSheetScale = stormSheetFactor(air.volumeDrew, inp.storm, VOL_TUNE.stormThin);', 'air.volumeDrew = false;', 2), "the world hands it the factor from whether the volume drew the storm last frame, and asks again");
ok(/if \(!air \|\| !this\.camera\) \{\n\s+this\.weather\.stormSheetScale = 1;\n\s+this\.dust\.ground = null;/.test(world), 'with no field the sheets and the motes are today\'s');

// --- the unload ---
ok(world.includes('this.air?.forgetWorld();') && after(world, 'this.air?.forgetWorld();', 'this.weather.stormSheetScale = 1;', 6), 'an unload lets the field forget the world and puts the sheets back');

// --- the ground keeps what passes (the second wave) ---
// One owner for a footprint: the feet hand every step to the air first, and lay today's decal only where it says no.
ok(main.includes('this.feet.onStep = this.stepPrint;') && /private readonly stepPrint = \(step: FootStep\): void => \{\n\s+if \(!this\.world\.air\?\.dentStep\(step\)\) footprints\.stepHook\(step\);\n\s+\};/.test(main), "the feet's steps go to the air's dents first and to today's decal only where the air lays none");
ok(count(main, 'footprints.stepHook(') === 1 && count(main, '.dentStep(') === 1, 'and nowhere else: a step is one or the other, never both');
// The ground's chooser, in the one getter every new chunk asks, and today's material whenever it says plain.
ok(/if \(this\.groundTextures\.tiles && this\.terrain\.swg\) \{\n\s+const plain = \(this\.groundTilesMat \?\?= groundTilesMaterial\(groundTileUniforms\(\), this\.csm\)\);[\s\S]{0,300}return groundMaterialFor\(this\.groundChoice\(\), plain, this\.groundAirMat\);/.test(world), "a new chunk's ground is the chooser's: the plain tile material unless the master, the field and a ground switch say the air's");
ok(after(world, 'this.syncGroundMaterial();', 'inp.ground = this.groundWearsAirNow;', 2) && after(world, 'inp.ground = this.groundWearsAirNow;', 'inp.reading = reading || inp.ground;', 5), "the frame puts the ground on the chooser's material, tells the field whether its variant is worn, and the worn variant reads the air");
ok(/if \(this\.air && VOL_TUNE\.on\) \{\n\s+for \(const o of this\.groundStandInsFor\(this\.air\)\) \{/.test(world), "a sweep compiles both grounds' stand-ins with the master on, so a ground switch swaps compiled materials");
ok(count(world, 'new AirField(') === 1 && /makeAir\(\): AirField \{\n\s+const air = new AirField\(this\.renderer!, VOL_TUNE, this\.airWorld\);/.test(world), 'the field is still made in one place');
// The variant is the session's and reads the session's record of its uniforms, which only the field the world took
// writes (a field's own would bind the variant for good to the first field made, which the in-play warm throws away).
ok(world.includes('private readonly airGroundU = makeAirGroundUniforms();') && world.includes('this.groundAirMat = groundAirMaterial(groundTileUniforms(), this.airGroundU, this.csm);') && count(world, 'groundAirMaterial(') === 1, "the variant is made once, over the world's own record of its uniforms, never a field's");
ok(/takeAir\(air: AirField\): void \{\n\s+if \(this\.air && this\.air !== air\) this\.air\.bindGround\(null\);\n\s+this\.air = air;\n\s+air\.bindGround\(this\.airGroundU\);/.test(world) && count(world, '.bindGround(') === 2 && count(world, 'this.air = ') === 1, 'the field the world takes is bound to that record, the one before let go, and nothing else binds or sets the field');
// What the chooser is asked and how the ground is swapped (the pure halves are airGround.test's; these lines are only the game's).
ok(world.includes('c.prints = VOL_TUNE.prints && air !== null && air.floatBlend;') && world.includes('c.field = air !== null && air.refused === null;') && world.includes('c.sand = VOL_TUNE.sand;') && world.includes('c.on = VOL_TUNE.on;'), "the chooser is asked the master, the sand, the prints only where floats blend, and a field that runs");
ok(world.includes('this.groundStandIns[0].material = plain;') && world.includes('this.groundStandIns[1].material = variant;'), "the sweep's stand-ins wear one ground each: the plain one is warmed too, so turning a ground switch off builds nothing");
ok(/for \(const c of this\.chunks\.values\(\)\) groups\.push\(c\.group\);\n\s+swapGroundMaterial\(groups, this\.farTiles\.values\(\), other, want\);/.test(world), "a change of the chooser's answer swaps every chunk's ground and every far tile");
ok(world.includes('this.terrain.familyKeep = familyKeepFor(this.viewRadius);'), "the terrain keeps a family grid for every chunk that can stand, which the air's rasters and the feet read");
{
  // The stream drops a chunk only past the view radius and one more (`if (far > this.viewRadius + 1)`), so that many
  // stand at once; at the default six it is 225, past the 192 grids the terrain kept, and the oldest still standing --
  // nearest where the player had been longest -- read as unknown ground until built again.
  const terrain = src('world/terrain.ts');
  ok(world.includes('if (far > this.viewRadius + 1) {') && terrain.includes('while (this.chunkFamilies.size > Math.max(FAMILY_TUNE.familyChunks, this.familyKeep)) {'), 'which the stream keeps until it is past the radius and one more, and the terrain never evicts below');
  ok(/private disposeChunk\(c: Chunk\): void \{\n\s+this\.floraField\?\.remove\(c\.key\);\n[\s\S]{0,300}this\.terrain\.forgetChunkFamilies\(c\.cx, c\.cz\);/.test(world) && /forgetChunkFamilies\(cx: number, cz: number\): void \{[\s\S]{0,400}this\.chunkFamilies\.delete\(key\);[\s\S]{0,200}this\.familyByNumber\.delete\(n\);/.test(terrain), "and a chunk's grid goes with the chunk, so a grid of one long gone never holds the place of one standing");
  const { familyKeepFor } = await import('../../../src/world/terrain.ts');
  let every = true;
  for (let r = 0; r <= 16; r++) {
    let standing = 0;
    for (let dz = -(r + 1); dz <= r + 1; dz++) for (let dx = -(r + 1); dx <= r + 1; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) <= r + 1) standing++;
    if (familyKeepFor(r) !== standing) every = false;
  }
  ok(every && familyKeepFor(6) === 225, `the floor is every chunk that can stand, at every radius from nought to sixteen (${familyKeepFor(6)} at the default six)`);
}
// The master in play (class W): queued, its programs through the world's queue, taken only once they have linked.
ok(/if \(VOL_TUNE\.on && !was\) this\.queueVolumetrics\(\);\n\s+else if \(!VOL_TUNE\.on && was\) this\.world\.air\?\.releaseTargets\(\);/.test(main), 'the master turned on in play queues its warm; turned off it frees the targets at once');
{
  const r = main.slice(main.indexOf('private async reconcileVolumetrics('), main.indexOf('private compileFxObject('));
  ok(r.length > 0 && r.includes('this.notice.set(VOL_WARM_NOTICE);') && main.includes("const VOL_WARM_NOTICE = 'Volumetrics on: preparing shaders';") && r.includes('this.world.programJob(field.objects,') && r.includes('this.world.compileReady(stands,') && r.includes('await Promise.all(jobs);'), "it says so, and the field's materials, the volume's and both grounds' stand-ins go through the world's queue");
  ok(main.includes('this.notice.set(this.volWarming ? VOL_WARM_NOTICE : null);') && r.includes('if (!this.fxBusy) this.notice.set(null);'), "the Effects switch's reconcile, which every volumetrics setting also passes through, leaves the master's notice up (it took it down the first time round)");
  ok(main.includes("if (this.fxBusy || this.volWarming || this.hyperspace.covered) return 'covered';") && r.indexOf('this.sampleShaders(this.shaderPhase());') < r.indexOf('this.volWarming = false;'), 'and what the warm builds is filed as covered, sampled before the flag goes, as the Effects switch\'s is');
  const awaited = r.indexOf('await Promise.all(jobs);');
  ok(awaited > 0 && r.indexOf('this.postfx.registerPass(pass)') > awaited && r.lastIndexOf('if (!had) this.world.takeAir(air);') > awaited, 'and only after every one has linked does the chain take the pass and the world the field');
  ok(r.includes('this.world.packId !== world') && r.includes('this.postfx !== chain'), 'a travel or a new chain during the wait throws the work away');
  ok(/if \(changed\) \{\n\s+pass\?\.dispose\(\);\n\s+if \(!had && this\.world\.air !== air\) air\.dispose\(\);[\s\S]{0,500}this\.volAgain = true;\n\s+continue;/.test(r), 'and looks again (the master still on, in a world: warmed for the chain and the field as they stand now)');
}
ok(main.includes("registerPerfSwitch('volGroundArt',") && main.includes("registerPerfSwitch('volGroundArtOne',"), "the frame report's zero-dial diff and its control are switches it compares by picture");

// --- wave 2b's hand-overs, which only the game makes ---
ok(world.includes('out.tint = t.colourIdAt(x, z);'), "the raster's strips read the pole's colour-map bytes beside its family, by number");
ok(world.includes('groundTint: groundTileUniforms() };') && src('world/volumetrics/airField.ts').includes('uGroundTint: world.groundTint?.uGroundTint ??') && src('world/volumetrics/airField.ts').includes('uGroundTintRef: world.groundTint?.uGroundTintRef ??'), "the dust pass holds the session ground material's own tint uniforms by reference, so the dust is tinted in the drawn ground's mode");
ok(/const gu = this\.airWorld\.groundTint!;[\s\S]{0,400}air\.raster\.tintMode = gt\.x;\n\s+air\.raster\.tintCap = gt\.y;\n\s+air\.raster\.tintRef = tr;/.test(world), "and the raster's own tintedAt (the motes, the storm's colour) reads the same mode, cap and reference each frame");
ok(world.includes('const lit = textures?.toneColour(f.id, tone, c);') && world.includes('if (was.textures === textures && was.swg === swg && was.tone === tone) return;'), "each family's colour is its lighter tones at the dust's tone, worked out again when the dial moves");
ok(world.includes('air.setLayerResponse(tiles && this.terrain?.swg ? tiles.childLayers : new Map(), response, tiles ? depth : 1, colour);'), "and the per-layer lookup takes the colour row the blowing sand is drawn in");
ok(world.includes('const toneOnly = was.textures === textures && was.swg === swg;') && /if \(toneOnly\) air\.raster\.repaintColour\(\);\r?\n\s+else air\.raster\.clear\(\);/.test(world), "a move of the dust's tone alone paints the colours again into the cells the raster knows (AirRaster.repaintColour), where a new world or new pictures clear it: dragging the dial must not forget the ground under the dust");
{
  const field = src('world/volumetrics/airField.ts');
  const upd = field.slice(field.indexOf('  update(inp: AirFrameInput): void {'), field.indexOf('  groundUniformsNow(): void {'));
  ok(upd.includes('f.frameSources();') && upd.indexOf('f.frameSources();') < upd.indexOf('this.drawer.run(this.runFrame, this.home);') && upd.indexOf('if (!inp.reading) {') < upd.indexOf('f.frameSources();'), "the sources' frame walk runs every frame the field runs, before its draws, the dust on or off");
}
ok(main.includes("if (kind === 'repulse') air.force(at.x, at.y, at.z, 0, 0, power, 1, reach);") && main.includes("else air.force(at.x, at.y, at.z, dir.x, dir.z, power, kind === 'push' ? 1 : -1, reach);"), "air({ force }) makes a front at the feet along the view through the field's own force, as a Jedi's power does");
{
  const r = main.slice(main.indexOf('private async reconcileVolumetrics('), main.indexOf('private compileFxObject('));
  ok(r.includes('jobs.push(this.sandSlices(air));') && r.indexOf('jobs.push(this.sandSlices(air));') < r.indexOf('await Promise.all(jobs);') && /while \(!air\.sandSlice\(\)\) await this\.waitFrames\(1, 100\);/.test(main), "the in-play warm makes the blowing sand's picture a slice a frame, and the swap waits for it whole");
  ok(/async warm\(\): Promise<number> \{[\s\S]{0,200}while \(!this\.sandSlice\(SAND_SIZE\)\);/.test(src('world/volumetrics/airField.ts')), 'behind a loading screen it is made outright');
}

console.log(`\n${checks} checks passed`);

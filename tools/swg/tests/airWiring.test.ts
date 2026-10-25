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
ok(/private async prepareAir\(\): Promise<void> \{\n\s+if \(!VOL_TUNE\.on \|\| VOL_HATCH_OFF\) return;\n\s+const air = this\.world\.ensureAir\(\);/.test(main) && main.includes("if (this.postfx && !this.postfx.pass('airVolume')) this.postfx.registerPass(new AirVolumePass(() => this.world.air));"), "an arrival registers the volume only with the master on and the pass missing");
ok(after(main, 'this.prepareAir();', 'const warmed = await this.postfx.warmUp();', 5), "and does it before the effects' warm-up compiles every pass, behind the loading screen");
ok(count(main, 'this.prepareAir();') === 1, 'and nowhere else: never in play');
ok(world.includes('if (this.air && VOL_TUNE.on) await this.air.warm();'), "the sweep compiles the field's own materials only with the master on");

// --- the settings ---
ok(main.includes("if (isVolKey(key) || key === 'effects') this.applyVolumetrics(key);"), 'every volumetrics key, and the Effects switch the volume rides on, is routed to the kept record');
ok(main.includes('volQualityFrom(this.settings, VOL_TUNE, this.volOver);') && /this\.applyVolumetrics\(\);\n\s+\/\/ The effects chain is built only now/.test(main), 'the record is written from the settings before the chain is first built');
ok(main.includes("this.menu.knobState = (key) => this.volKnobState(key);"), 'the page hears what the game says of the master');
ok(main.includes("VOL_HATCH_OFF = ((): boolean => {") && main.includes("localStorage.getItem('swg.vol') === '0'") && main.includes('if (VOL_HATCH_OFF) VOL_TUNE.on = false;'), "localStorage['swg.vol'] '0' holds the master off for the session");

// --- the forces at their sites ---
// The instant knock of before and (the third wave) the knock that travels both stir the air the same way: two sites each.
ok(count(jedi, 'world.air?.force(') === 4 && count(jedi, 'world.air?.force(player.worldPos.x, player.worldPos.y, player.worldPos.z, tmp.x, tmp.z, 1, sign, 16)') === 2 && count(jedi, 'world.air?.force(player.worldPos.x, player.worldPos.y, player.worldPos.z, 0, 0, 1, 1, 10)') === 2, "the Force's push, pull and repulse stir the air, at their own reach, whether the knock is instant or travels");
ok(after(jedi, 'shoveLooseProps(player.worldPos, 16, sign, tmp, sign > 0 ? 18 : 10);', 'world.air?.force(', 4) && after(jedi, 'shoveLooseProps(player.worldPos, 10, 1, null, 20);', 'world.air?.force(', 3), 'beside the loose props they shove');
ok(after(jedi, 'this.waves.begin(sign > 0 ? FRONT_KIND.push : FRONT_KIND.pull,', 'world.air?.force(', 2) && after(jedi, 'this.waves.begin(FRONT_KIND.repulse,', 'world.air?.force(', 2), "and the travelling knock begins its wave in the same step as the air's front, which reads the one speed (`FORCE_WAVE`)");
ok(jedi.includes('if (FORCE_WAVE.travels) this.shoveWave(ctx, 1);') && jedi.includes('if (FORCE_WAVE.travels) this.shoveWave(ctx, -1);') && jedi.includes('if (FORCE_WAVE.travels) this.repulseWave(ctx);'), 'push, pull and repulse take the travelling way only while the Gameplay switch says so');
{
  // Code only (comments say which pass it came with): no graphics setting, no volumetrics record, nothing of the chain.
  const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const graphics = /VOL_TUNE|volSettings|fxRegistry|FX_DEFAULTS|airVolume|settings\.vol|\.effects\b/;
  ok(!graphics.test(code(src('combat/forceWave.ts'))) && !graphics.test(code(src('combat/forceWaveTune.ts'))) && !/VOL_TUNE|volSettings/.test(code(jedi)), 'and nothing of the knock reads a graphics setting');
}
ok(main.includes('setForceWave(S.forceKnockTravels, S.forceWaveSpeed);') && main.includes("case 'forceKnockTravels':") && main.includes("case 'forceWaveSpeed':"), "the Gameplay page's two settings reach the knock's record at load and whenever either moves");
ok(hunter.includes('world.air?.blast(at.x, at.y, at.z, radius, push, AIR_TUNE.smoke.blastHold);') && after(hunter, 'shoveLooseProps(at, radius * 1.5, 1, null, 12 + damage * 0.1);', 'world.air?.blast(', 4), "every blast of the kit's (grenade, charge, mine, a gun's splash) stirs the air by its own radius and push, and leaves its smoke");
ok(after(main, 'this.effects.ring(v.pos, 0xffa050, 6 + v.radius, 0.5);', 'this.world.air?.blast(v.pos.x, v.pos.y, v.pos.z, AIR_TUNE.blast.wreckRadius + v.radius, AIR_TUNE.blast.wreckPush, AIR_TUNE.smoke.wreckHold);', 4), "a wreck's blast beside its ring, smoking as it burns");
// The third wave's smoke at its sites: the gas cloud's every frame and its puffs only where the volume does not draw it,
// the sting the CPU sphere above, unchanged; the damaged engines' beside engineFx's own.
{
  const clouds = hunter.slice(hunter.indexOf('private stepClouds(ctx: KitContext): void {'), hunter.indexOf('Everything a blast or a beam can hurt'));
  ok(clouds.includes('air?.smoke(cl.pos.x, cl.pos.y, cl.pos.z, cl.radius, AIR_TUNE.smoke.cloud, cl.spec.color);') && clouds.includes('if (!(air && air.drawsSmokeAt(cl.pos.x, cl.pos.z, cl.radius)) && Math.random() < dt * 12) {'), "a gas cloud lays its smoke into the air every frame, and its puffs are drawn whenever the volume is not drawing that smoke over the cloud's whole sphere");
  ok(clouds.indexOf('h.damage(cl.spec.damage * 0.1, cl.pos, 0, ctx.world.playerTarget);') > 0 && clouds.indexOf('if (h.dead || h.pos.distanceTo(cl.pos) > cl.radius) continue;') > 0 && !/air[\s\S]{0,80}damage|drawsSmokeAt[\s\S]{0,200}damage/.test(clouds.slice(0, clouds.indexOf('air?.smoke('))), 'and what it stings is the sphere, read before and apart from anything drawn');
  ok(main.includes('this.engineFx.smokeSink = (x, y, z, radius, rate, colour) => this.world.air?.smoke(x, y, z, radius, rate, colour);') && src('vehicles/engineFx.ts').includes('sink(at.x, at.y, at.z, ENGINE_SMOKE_RADIUS, AIR_TUNE.smoke.burning * share,'), "a damaged engine's band smokes into the air beside its effect");
}
// The fog's hour, from the shared clock, never this machine's; the noise made in slices in play.
ok(world.includes('count.time = day.time;\n    sharedClock.dayCountIn(day, count);\n    count.step();\n    const idx = count.day;') && after(world, 'inp.time = this.simTime;', 'this.writeFogHour(inp);', 2), "the fog's day is the drawn day counted against the shared clock, and the hour is worked out every frame into the field's input");
// The air's ground over standing water is the water's surface (the third wave's smoke check found the fog on the lake bed
// 40 m under it); lava keeps the ground, the lava world's whole sea being lava.
ok(world.includes('const water = lava ? h : t.waterHeightAt(x, z);') && world.includes('out.h = !lava && water > h ? water : h;') && world.includes('out.medium = lava ? 3 : water > h ? 2 : 1;'), "the air's ground sampler stands the air on a lake's surface, never its bed, and keeps the ground under lava");
{
  const r = main.slice(main.indexOf('private async reconcileVolumetrics('), main.indexOf('private compileFxObject('));
  ok(r.includes('jobs.push(this.noiseSlices(air));') && r.indexOf('jobs.push(this.noiseSlices(air));') < r.indexOf('await Promise.all(jobs);') && /while \(!air\.noiseSlice\(\)\) await this\.waitFrames\(1, 100\);/.test(main), "the in-play warm makes the wisps' noise a layer a frame, and the swap waits for it whole");
  ok(/async warm\(\): Promise<number> \{[\s\S]{0,400}while \(!this\.noiseSlice\(NOISE3_SIZE\)\);/.test(src('world/volumetrics/airField.ts')), 'behind a loading screen it is made outright');
}

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
  ok(now.includes('else shed = sheddingCount(count, perSecond, interval, air.raster.dustAt(w0.ox, w0.oz, w0.cell, tmpV.x, tmpV.z));') && now.includes('this.airGroundColour(air, tmpV.x, tmpV.z, this.dustColor), VOL_TUNE.kickUp);'), "then the count is the ground's share of today's, judged on a fixed twentieth of a second, thrown as grains with the kick-up on, in the cell's tinted colour (wave 2b's)");
  ok(now.includes('g.share = air.raster.grainShareAt(w0.ox, w0.oz, w0.cell, tmpV.x, tmpV.z, AIR_TUNE.grains.hard);') && now.includes('grainShedIn(g);') && now.includes('carry.c = g.carry;') && /if \(VOL_TUNE\.kickUp\) \{/.test(now), "with the kick-up on (the third wave), the grains off rock and paving are `grains.hard` of sand's, the fraction each machine is owed carried to its next interval");
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
ok(/if \(!air \|\| !this\.camera\) \{\n\s+this\.weather\.stormSheetScale = 1;\n\s+this\.weather\.rainSheetScale = 1;\n\s+this\.weather\.snowSheetScale = 1;\n\s+this\.weather\.airRainDraws = false;\n\s+this\.dust\.ground = null;/.test(world), 'with no field the sheets (the storm\'s, the rain\'s and the snow\'s), the weather\'s pass and the motes are today\'s');

// --- the unload ---
ok(world.includes('this.air?.forgetWorld();') && after(world, 'this.air?.forgetWorld();', 'this.weather.stormSheetScale = 1;', 6), 'an unload lets the field forget the world and puts the sheets back');

// --- the ground keeps what passes (the second wave) ---
// One owner for a footprint: the feet hand every step to the air first, and lay today's decal only where it says no.
ok(main.includes('this.feet.onStep = this.stepPrint;') && /private readonly stepPrint = \(step: FootStep\): void => \{\n\s+const air = this\.world\.air;\n\s+if \(!air\?\.dentStep\(step\)\) footprints\.stepHook\(step\);\n\s+if \(air\) air\.kickFeet\(step\);\n\s+\};/.test(main), "the feet's steps go to the air's dents first and to today's decal only where the air lays none (and beside either, the fourth wave's kick-up)");
ok(count(main, 'footprints.stepHook(') === 1 && count(main, '.dentStep(') === 1, 'and nowhere else: a step is one or the other, never both');
// The ground's chooser, in the one getter every new chunk asks, and today's material whenever it says plain.
ok(/if \(this\.groundTextures\.tiles && this\.terrain\.swg\) \{\n\s+const plain = \(this\.groundTilesMat \?\?= groundTilesMaterial\(groundTileUniforms\(\), this\.csm\)\);[\s\S]{0,300}return groundMaterialFor\(this\.groundChoice\(\), plain, this\.groundAirMat\);/.test(world), "a new chunk's ground is the chooser's: the plain tile material unless the master, the field and a ground switch say the air's");
ok(after(world, 'this.syncGroundMaterial();', 'inp.ground = this.groundWearsAirNow;', 2) && after(world, 'inp.ground = this.groundWearsAirNow;', 'inp.reading = reading || inp.ground ||', 14), "the frame puts the ground on the chooser's material, tells the field whether its variant is worn, and the worn variant reads the air");
ok(/if \(this\.air && VOL_TUNE\.on\) \{\n\s+for \(const o of this\.groundStandInsFor\(this\.air\)\) \{/.test(world), "a sweep compiles both grounds' stand-ins with the master on, so a ground switch swaps compiled materials");
ok(count(world, 'new AirField(') === 1 && /makeAir\(\): AirField \{\n\s+const air = new AirField\(this\.renderer!, VOL_TUNE, this\.airWorld\);/.test(world), 'the field is still made in one place');
// The variant is the session's and reads the session's record of its uniforms, which only the field the world took
// writes (a field's own would bind the variant for good to the first field made, which the in-play warm throws away).
ok(world.includes('private readonly airGroundU = makeAirGroundUniforms();') && world.includes('this.groundAirMat = groundAirMaterial(groundTileUniforms(), this.airGroundU, this.csm);') && count(world, 'groundAirMaterial(') === 1, "the variant is made once, over the world's own record of its uniforms, never a field's");
ok(/takeAir\(air: AirField\): void \{\n\s+if \(this\.air && this\.air !== air\) \{\n\s+this\.air\.bindGround\(null\);\n\s+this\.air\.bindLiquid\(null\);\n(?:\s*\/\/[^\n]*\n)*\s+this\.unhangAir\(this\.air\);\n\s+\}\n\s+this\.air = air;\n\s+air\.bindGround\(this\.airGroundU\);/.test(world) && count(world, '.bindGround(') === 2 && count(world, 'this.air = ') === 1, 'the field the world takes is bound to that record, the one before let go, and nothing else binds or sets the field');
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
  ok(main.includes('this.notice.set(this.volWarming || this.wispWarming.size > 0 ? VOL_WARM_NOTICE : null);') && r.includes('if (!this.fxBusy && !this.wispWarming.size) this.notice.set(null);'), "the Effects switch's reconcile, which every volumetrics setting also passes through, leaves the master's notice up (it took it down the first time round), and a wisps mode's own warm's (the fourth wave), which the master's warm leaves up too when it ends");
  ok(main.includes("if (this.fxBusy || this.volWarming || this.wispWarming.size > 0 || this.hyperspace.covered) return 'covered';") && r.indexOf('this.sampleShaders(this.shaderPhase());') < r.indexOf('this.volWarming = false;'), 'and what the warm builds is filed as covered, sampled before the flag goes, as the Effects switch\'s is (a wisps mode\'s own warm\'s too)');
  const awaited = r.indexOf('await Promise.all(jobs);');
  ok(awaited > 0 && r.indexOf('this.postfx.registerPass(pass)') > awaited && r.lastIndexOf('if (!had) this.world.takeAir(air);') > awaited, 'and only after every one has linked does the chain take the pass and the world the field');
  ok(r.includes('this.world.packId !== world') && r.includes('this.postfx !== chain'), 'a travel or a new chain during the wait throws the work away');
  ok(/if \(changed\) \{\n\s+pass\?\.dispose\(\);\n(?:\s*\/\/[^\n]*\n)*\s+if \(!had && this\.world\.air !== air\) \{\n\s+this\.world\.forgetMaterials\(air\.materials\(\)\);\n\s+air\.dispose\(\);\n\s+\}[\s\S]{0,500}this\.volAgain = true;\n\s+continue;/.test(r), "and looks again (the master still on, in a world: warmed for the chain and the field as they stand now), a field thrown away leaving the world's material sets before it is disposed (its pools' draws were adopted by the warm)");
}
ok(main.includes("registerPerfSwitch('volGroundArt',") && main.includes("registerPerfSwitch('volGroundArtOne',"), "the frame report's zero-dial diff and its control are switches it compares by picture");

// --- wave 2b's hand-overs, which only the game makes ---
ok(world.includes('out.tint = t.colourIdAt(x, z);'), "the raster's strips read the pole's colour-map bytes beside its family, by number");
ok(world.includes('groundTint: groundTileUniforms(), rainHull: PARTICLE_UNIFORMS };') && src('world/volumetrics/airField.ts').includes('uGroundTint: world.groundTint?.uGroundTint ??') && src('world/volumetrics/airField.ts').includes('uGroundTintRef: world.groundTint?.uGroundTintRef ??'), "the dust pass holds the session ground material's own tint uniforms by reference, so the dust is tinted in the drawn ground's mode");
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
  ok(/async warm\(\): Promise<number> \{[\s\S]{0,400}while \(!this\.sandSlice\(SAND_SIZE\)\);/.test(src('world/volumetrics/airField.ts')), 'behind a loading screen it is made outright');
}

// --- the fourth wave's hand-overs, which only the game makes ---
{
  const r = main.slice(main.indexOf('private async reconcileVolumetrics('), main.indexOf('private compileFxObject('));
  const awaited = r.indexOf('await Promise.all(jobs);');
  // The cold warm on Direct3D 11 (carried from the third wave): the master's in-play warm builds the wisps mode in force
  // alone, and a mode moved later is built in its turn through the queue, the volume drawing the last ready mode meanwhile.
  ok(r.includes('pass.warmMaterials(VOL_TUNE.wisps)') && main.includes("if (key === 'volDustWisps' && VOL_TUNE.on) this.warmWispMode();") && /private warmWispMode\(\): void \{[\s\S]{0,1600}\.programJob\(\[o\], 'volumetrics: the wisps', true,[\s\S]{0,300}pass\.ready\[mode\] = true;/.test(main), "the master's in-play warm builds the wisps mode in force alone; a mode moved later is built through the queue and marked ready once linked");
  // A mode moved during the master's warm, or while the master was off with the pass already on the chain, is built at the
  // warm's end: the volume would otherwise draw the last ready mode until the next loading screen.
  ok(r.lastIndexOf('this.warmWispMode();') > r.lastIndexOf('if (!had) this.world.takeAir(air);') && r.lastIndexOf('this.warmWispMode();') < r.indexOf('} while (this.volAgain);'), "and every warm that ends with the field taken asks for the mode in force (a pass already on the chain from an earlier warm included)");
  ok(/if \(!this\.ready\[mode\]\) mode = this\.ready\[this\.drawnMode\] \? this\.drawnMode : this\.ready\.indexOf\(true\);/.test(src('core/fx/airVolume.ts')) && main.includes("(this.postfx.pass('airVolume') as AirVolumePass | undefined)?.ready.fill(true);"), 'the volume draws the last ready mode until the asked one is built, and behind a loading screen every mode is built');
  ok(r.includes("const kicks = this.world.kickStandInsFor(air);") && r.includes("jobs.push(this.world.compileReady(kicks, 'volumetrics: the kick-up'));") && r.includes('jobs.push(this.world.rainWarmJob(air));') && r.indexOf('jobs.push(this.world.rainWarmJob(air));') < awaited, "the in-play warm builds the kick-up's two draws against the world pass and the rain's draw against the weather's scene, waited for with the rest");
  ok(r.indexOf('this.world.syncAirMeshes();') > awaited && r.indexOf('void this.world.airPictures();') > awaited, "and hangs the meshes only once their programs exist, then asks for this world's pictures");
  ok(/private async prepareAir\(\): Promise<void> \{[\s\S]{0,800}this\.world\.syncAirMeshes\(\);[\s\S]{0,200}await this\.world\.airPictures\(AIR_PICTURE_WAIT_MS\);/.test(main) && main.includes('await this.prepareAir();'), "an arrival hangs the meshes before the sweep compiles the scene, and waits a few seconds at most for the pictures behind its screen");
  ok(main.includes('if (!VOL_TUNE.on) this.world.syncAirMeshes();') && count(main, 'this.world.syncAirMeshes()') === 3, 'the master off takes the meshes out at once; nothing else hangs them in play');
  ok(/syncAirMeshes\(\): void \{\n\s+const air = this\.air;\n\s+const want = air !== null && VOL_TUNE\.on && air\.refused === null;/.test(world) && world.includes('for (const m of air.kick.meshes) if (m.parent !== this.scene) this.scene.add(m);') && world.includes('if (air.rain.mesh.parent !== this.weather.scene) this.weather.scene.add(air.rain.mesh);'), "the kick-up's meshes hang in the world's scene and the rain's in the weather's, only with the master on and a field that runs");
  ok(/takeAir\(air: AirField\): void \{[\s\S]{0,500}this\.syncAirMeshes\(\);\n\s+\}/.test(world), 'the field the world takes hangs its meshes as it is taken');
  ok(after(world, 'this.air?.forgetWorld();', 'this.dropAirPictures();', 10) && after(world, 'this.dropAirPictures();', 'this.weather.airRainDraws = false;', 4), "an unload lets go of every borrowed picture before the effects that hold them are disposed, and puts the weather's hand-overs back");
  ok(world.includes("held = this.particles?.loadedTexture(f) ?? this.weather.effectTexture(f);") && src('world/particles.ts').includes('loadedTexture(file: string): THREE.Texture | null {'), "a picture an effect of the world's or the weather's already holds is borrowed, never fetched again");
  ok(after(world, 'air.setHull(hull && b ? hull.group.matrixWorld : null, b ? b.min : null, b ? b.max : null);', 'this.writeKickLight(air);', 2) && after(world, 'this.writeKickLight(air);', 'air.update(inp);', 2), "the sky's light for the kick-up and the rain is written before the field's frame");
  ok(/inp\.reading = reading \|\| inp\.ground \|\| \(VOL_TUNE\.particles && \(VOL_TUNE\.leaves \|\| VOL_TUNE\.puffs \|\| VOL_TUNE\.spray \|\| VOL_TUNE\.streaks\)\) \|\| air\.rain\.frame\.share > 0 \|\| this\.liquidReading;/.test(world) && after(world, 'this.writeRainFrame(air, dt);', 'inp.reading = reading', 10), 'the kick-up with a kind on, and the rain of ours falling, read the air: the field steps for them (the share read off the pool\'s record the frame wrote just before); and from the fifth wave the water or the lava wearing what reads its current');
  // No number crosses a call on the frame's path: the rain's frame answers nothing, and its record's fractions start as fractions.
  ok(world.includes('private writeRainFrame(air: AirField, dt: number): void {') && /function newRainLight\(\)[\s\S]{0,400}ambientScale: 0\.5,[\s\S]{0,200}bright: 0\.5 \};/.test(world) && src('world/weather.ts').includes('rainSheetScale = 0.5;') && /constructor\(physics: Physics\) \{\n\s+this\.rainSheetScale = 1;\n\s+this\.snowSheetScale = 1;/.test(src('world/weather.ts')), "the rain's frame hands no number back across its call, and the fields a raining frame writes fractions into start as fractions");
  // The pictures: a file the survey found in no pack of a world is never asked of it, and only a 404 is remembered.
  ok(world.includes(": [KICK_KIND.spray, ['particles/pt_fountain_splash_alpha.png'], [`${props}particles/pt_fountain_splash_alpha.png`, pack.url('particles/pt_fountain_splash_alpha.png')]],") && world.includes('[KICK_KIND.leaf, leaf, leaf.map((f) => pack.url(f))],') && /if \(res\.status === 404\) \{\n\s+this\.airPictureMissing\.add\(u\);/.test(world) && count(world, 'this.airPictureMissing.add(') === 1, "the spray's picture is asked of the props pack first (eight worlds' own packs hold it, the rest none), a leaf never of the props pack, and an address is remembered missing only on a 404");
  ok(main.includes("registerPerfSwitch('volParticles',") && main.includes("registerPerfSwitch('volRain',"), "the frame report's switches for the kick-up and the rain");
  ok(main.includes("'carry', 'class', 'flow', 'liquid'] as const;") && src('core/fx/airVolume.ts').includes("field('class', 'r', 255 / 12),"), "air({ view: 'class' }) shows the class raster through the volume's own debug list (and the fifth wave's flow and liquid views after it)");
  ok(main.includes('const taken = kind >= 0 && air.kickBurst(kind, count, p.x, p.y + 1, p.z);') && main.includes('out.particles = air.kick.count(this.renderer, air.win.ox, air.win.oz, { x: p.x, z: p.z, radius })') && main.includes("out.rainMeasure = air.rain.measure(this.renderer, (x, z) => roofs.topAt(x, z), { x: p.x, z: p.z, radius })"), 'the console stands a burst of a kind at the crosshair and reads the pools back');
}

// --- the fifth wave: water and lava ---
{
  const water = src('world/water.ts');
  const bodies = src('world/waterBodies.ts');
  // The ripples' carry is hung only with the water wearing its current (the master, the current and a field), its art share
  // over nought and the tile stepped -- the ripples on, since the carry runs in their step -- and taken off with no field.
  ok(world.includes('const carry = water && VOL_TUNE.artWater > 0 && this.liquidReading && air.liquidLive && waterSimReady();') && world.includes('if (carry !== rippleCarrySet()) setRippleCarry(carry ? air.carry : null);'), "the ripples' carry is hung only while the water wears its current, its art over nought, the tile stepped and the ripples on");
  ok(/if \(!air \|\| !this\.camera\) \{[\s\S]{0,400}if \(rippleCarrySet\(\)\) setRippleCarry\(null\);\n\s+return;/.test(world) && count(world, 'setRippleCarry(') === 2 && !main.includes('setRippleCarry('), 'and taken off with no field; nothing else hangs or takes it');
  ok(world.includes('const water = waterWearsAir(c);') && world.includes('const lava = lavaWearsCrust(c);') && world.includes('const worn = this.waterBodies.wearAir(water, this.liquidReady);') && world.includes('const want = lavaMaterialFor(c, pair.plain, this.liquidUnbuilt.has(pair.crust) ? null : pair.crust);'), "the water and the lava go on the choosers' materials, and only a variant built: one made in play waits for its warm (class M)");
  // A variant made in play is never worn before the warm that compiled it says so (a field the session kept, the master
  // turned on in play over it, put this world's new variants on at the next frame and three built them there).
  ok(world.includes('if (!this.playerWaiting()) for (const m of fresh) this.liquidUnbuilt.add(m);') && world.includes('private readonly liquidReady = (m: THREE.Material): boolean => !this.liquidUnbuilt.has(m);'), 'a variant made in play joins the unbuilt set; behind a screen or a tunnel it is ready at once (the sweep after builds it)');
  ok(after(main, 'const liquids = this.world.liquidStandInsFor(air);', 'const liquidCovered = this.world.liquidUnbuiltNow();', 4) && after(main, 'if (!had) this.world.takeAir(air);', 'this.world.liquidBuilt(liquidCovered);', 3) && main.indexOf('this.world.liquidBuilt(liquidCovered);') > main.indexOf('await Promise.all(jobs);') && count(main, 'this.world.liquidBuilt(') === 1, "the master's in-play warm takes what its stand-ins cover straight after them and hands it to the chooser only once every job has linked and nothing changed");
  ok(/if \(opts\.target === undefined\) liquidCovered = this\.liquidUnbuiltNow\(\);/.test(world) && /if \(liquidCovered\) this\.liquidBuilt\(liquidCovered\);/.test(world) && world.indexOf('if (liquidCovered) this.liquidBuilt(liquidCovered);') > world.indexOf('await this.sweepBatches(r, camera, objects, target,'), "a sweep for the frames' own target releases what it built, after its batches; one for the other effects path (the Effects switch's) releases nothing");
  ok(/if \(this\.air && VOL_TUNE\.on\) \{\n\s+this\.makeLiquidVariants\(\);\n\s+if \(!this\.playerWaiting\(\)\) await this\.readyRibbonCrusts\(meshes, token\);/.test(world) && /await this\.compileReady\(stands, 'water: the lava falls\\' crust'\);\n\s+if \(token === this\.loadToken\) this\.liquidBuilt\(crusts\);/.test(world), "ribbons stood in play have their crust twins made ready through the queue before the chooser may wear them");
  ok(/this\.liquidReading = false;\n\s+this\.liquidWaterWorn = 0;\n\s+this\.liquidUnbuilt\.clear\(\);\n\s+this\.liquidDirty = true;/.test(world) && /this\.ribbons = \[\];\n\s+this\.ribbonStatus\.ribbons = 0;/.test(world), "an unload starts the liquids' chooser afresh and forgets the last world's ribbons (a dry world steps nothing for the liquids, and the falls' switch there builds nothing)");
  ok(world.includes('for (const m of this.ribbonOwned) m.uniforms.uFlowTime.value = this.waterTime % m.userData.loopTime;'), "a lava fall in a look of its own flows on the lava's clock");
  ok(world.includes('c.on = VOL_TUNE.on;\n    c.current = VOL_TUNE.current;\n    c.lava = VOL_TUNE.lava;\n    c.field = air.refused === null;\n    c.softOff = this.liquidSoftOff;'), 'the choosers are asked the master, each switch, a field that runs and the soft off');
  ok(after(world, 'this.syncLiquid(air);', 'inp.reading = reading || inp.ground ||', 8), 'the liquids are put on their materials before the field is asked whether anything reads it');
  ok(water.includes("installWaterHook(mask, lit.userData.uniforms, 'mask', lit.userData.waves, lit.userData.air === true);") && water.includes("installWaterHook(mat, uniforms, 'lit', lit.userData.waves, true);") && water.includes("${air ? '-air' : ''}`;"), "the current variant is keyed -air, and its mask twins are keyed off it");
  ok(bodies.includes('const masks = [createWaterMaskMaterial(air, THREE.BackSide), createWaterMaskMaterial(air, THREE.FrontSide)] as const;') && bodies.includes('b.twins[0].material = m[0];') && bodies.includes('b.twins[1].material = m[1];'), "a body wearing its current hands its twins the current's own mask twins");
  ok(/if \(this\.air && VOL_TUNE\.on\) \{[\s\S]{0,400}for \(const o of this\.liquidStandInsFor\(this\.air\)\) \{\n\s+this\.adoptMaterials\(o\);\n\s+objects\.push\(o\);/.test(world), "the sweep compiles the water's and the lava's both materials with the master on");
  ok(main.includes("const liquids = this.world.liquidStandInsFor(air);") && main.includes("const masks = this.world.liquidMaskStandIns();") && main.includes("jobs.push(this.world.programJob(masks, 'volumetrics: the water\\'s mask', true,"), "the master's in-play warm builds them through the world's queue, the masks the effects' way");
  ok(/private async prepareAir\(\): Promise<void> \{[\s\S]{0,1200}this\.world\.makeLiquidVariants\(\);\n\s+\}/.test(main) && main.indexOf('await this.prepareAir();') < main.indexOf('const warmed = await this.postfx.warmUp();'), "an arrival makes the variants before the effects' warm-up compiles their masks");
  ok(world.includes('air.bindLiquid(LIQUID_U);') && world.includes('this.air.bindLiquid(null);') && count(world, '.bindLiquid(') === 2, "the field the world takes writes the session's liquid record, and the one let go stops");
  ok(after(world, 'air.stepRain();', 'if (air.ringsWanted && this.renderer) air.ringsInto(rippleStateTarget(this.renderer), WATER_SIM_WINDOW.value);', 3), "the spray's rings are pressed into the ripples' state after the field's frame");
  ok(world.includes("air.ringsWanted = carry && VOL_TUNE.particles && VOL_TUNE.spray && this.renderer !== null && rippleStateTarget(this.renderer) !== null;") && world.includes('air.forces.onPoke = water && this.liquidWaterWorn > 0 ? pokeWaterSimIn : null;'), 'the rings only with the carry, the spray on and a state to press into; the pokes only while the water wears its current');
  ok(main.includes("case 'waterRibbons':\n        // The terrain's ribbons") && main.includes('this.world.setRibbons(S.waterRibbons);') && main.includes('this.world.setRibbons(this.settings.waterRibbons);'), "the terrain's ribbons follow their own setting, from boot and on every change");
  ok(/for \(const b of this\.waterBodies\.bodies\) \{\n\s+if \(!b\.air\) continue;\n\s+holder\.geometry = b\.mesh\.geometry;\n\s+holder\.receiveShadow = b\.mesh\.receiveShadow;\n\s+holder\.material = b\.air;\n\s+this\.adoptMaterials\(holder\);/.test(world) && world.includes('holder.material = pair.crust;'), "every body's current variant and every lava mesh's crust twin is adopted as it is made, not only the stand-ins compiled (a driven Vulkan tab built two lake programs in play under the unadopted key until this)");
  ok(/if \(this\.ribbonsShown && out\.medium !== 3 && ribbonAt\(this\.ribbons, x, z, this\.ribbonHit\) && this\.ribbonHit\.type === 1 && this\.ribbonHit\.h > h - 0\.5\) \{/.test(world), "the air's ground takes a drawn lava fall as lava, with its own flow, only while the ribbons are drawn and where the fall stands over the ground (not buried under it)");
}

console.log(`\n${checks} checks passed`);

// The volumetrics' hand-overs, as text (the design's rule 16 and §4.1 item 8): every behaviour test builds what it calls,
// so the lines only the game makes are read out of main.ts, world.ts, jedi.ts, bountyHunter.ts, weather.ts, install.ts
// and postfx.ts: the step right after the weather's view half and only through `world.air`, handed last frame's view
// building; the volume's factory into the chain only with the master on; the arrival's registration only with the master
// on and the pass missing; the field's materials into the sweep only with the master on; every volumetrics key routed;
// the Force, the blasts and the wreck at their sites; the grains' gate in `emitDust`, today's lines left as they stood;
// the storm sheets' factor at the channel's rate; the world letting the field go at an unload. A review once deleted each
// of a wave's hand-overs with every suite green, which is why they are pinned here.
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
  ok(now.includes('const shed = sheddingCount(count, perSecond, interval, air.raster.dustAt(w0.ox, w0.oz, w0.cell, tmpV.x, tmpV.z));') && now.includes('this.groundColorAt(tmpV.x, tmpV.z, this.dustColor), VOL_TUNE.kickUp);'), "then the count is the ground's share of today's, judged on a fixed twentieth of a second, thrown as grains with the kick-up on");
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

console.log(`\n${checks} checks passed`);

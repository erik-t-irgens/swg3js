// The performance pass's first wave as the game wires it, read as text out of main.ts and world.ts (node cannot load
// main.ts), as `grappleWiring` reads the player's update: the people stood behind the settle and waited for, one
// screen to a place on another world with its two old phases kept as the fallback, the course curtain that never
// settles and the two side effects it must not trip, the sweep's frame waits, the frame loop's second tick, the
// queue's own compiles putting the world pass's lights back, and the settle's line saying both figures. Every
// behaviour test makes these hand-overs for itself, so a line lost from the game alone passes them; this is where it
// fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** A method of a class's text from its signature to its own closing brace (the first line that is two spaces and a brace). */
function method(text: string, signature: string): string {
  const at = text.indexOf(signature);
  assert.ok(at >= 0, `found ${signature}`);
  const end = text.indexOf('\n  }\n', at);
  return text.slice(at, end < 0 ? text.length : end);
}

// --- the settle: the living stood behind it, and waited for ------------------------------------------------------------

{
  const settle = method(main, '  private async settle(');
  const firstLoop = settle.indexOf('if (this.world.settled(this.player.worldPos)) break;');
  const people = settle.indexOf('this.world.standPeopleNow(this.player.worldPos);');
  const sweep = settle.indexOf('this.world.compileAllAsync(');
  ok(firstLoop > 0 && people > firstLoop && people < sweep, 'the settle stands the people after its first settled loop and before the sweep');
  ok(settle.indexOf('await Promise.race([this.world.loadMobileCatalogue()') > firstLoop && settle.indexOf('await Promise.race([this.world.loadMobileCatalogue()') < people, 'after waiting (bounded) for the catalogue, which a first world finds still in flight');
  ok(settle.indexOf('this.standCollectorsNow();') > firstLoop && settle.indexOf('this.standCollectorsNow();') < sweep, 'and asks for the ticket collectors there');
  const shuttles = settle.indexOf("this.loadingScreen.setWhat('the shuttles');");
  const ours = settle.indexOf('this.world.standOursNow(this.player.worldPos);');
  const wild = settle.indexOf('this.world.standWildNow(this.player.worldPos);');
  ok(ours > shuttles && wild > shuttles && ours < sweep && wild < sweep, 'the people of ours and the creatures are stood after the shuttles are waited for, before the sweep');
  const again = settle.lastIndexOf('this.world.standPeopleNow(this.player.worldPos);');
  const wait = settle.indexOf('while ((!this.world.bodiesUp || wildWaiting > 0) && performance.now() < kicked + LOADING_TUNE.standWaitMs)');
  ok(again > people && wait > again && wait < sweep, 'the people again just before the sweep, then the bodies, and any creature site still waiting for its ground, waited for, bounded by standWaitMs from when they were first stood');
  ok(/let wildWaiting = this\.world\.standWildNow\(this\.player\.worldPos\);/.test(settle), "the wait is handed the creatures' own count of sites waiting for their ground");
  // The fourth wave: every shape a person's or a rack weapon's material can take, compiled behind the screen.
  const personWarm = settle.indexOf('const personWarm = this.world.warmPersonShapes()');
  const personWait = settle.indexOf('await personWarm;');
  ok(personWarm > firstLoop && personWarm < people, "the people's shapes are begun after the settle's first loop and before anybody is stood");
  ok(personWait > personWarm && personWait < sweep && settle.lastIndexOf("this.loadingScreen.setWhat(\"the people's shaders\");", personWait) > personWarm, "and waited for before the sweep, said under the title as they are");
  ok(/const personWarm = this\.world\.warmPersonShapes\(\)\.catch\(/.test(settle), 'a warm that fails is said and never stops the screen');
  ok(/const kicked = performance\.now\(\);/.test(settle) && settle.indexOf('const kicked') < people, 'the bound runs from the first stand');
  ok(/the people here, \$\{n\.up\} of \$\{n\.of\}/.test(settle), "the line under the title says the people here, n of m");
  ok(/if \(wildWaiting > 0\) wildWaiting = this\.world\.standWildNow/.test(settle.slice(wait)), 'a creature site waiting for its ground is tried again inside the bound');
  const check = settle.indexOf('const driverDone = this.checkDriverAfterSweep();');
  ok(!/this\.measureShaderCompiler\(\)/.test(main) && check > settle.indexOf('this.drawFrame();'), 'the trivial probe is gone from before the sweep; the driver check runs after its frame');
  ok(/if \(!this\.shaderVerdictSaid && !this\.driverHeld && LOADING_TUNE\.driverWaitMs > 0\) \{\s*this\.driverHeld = true;\s*this\.loadingScreen\.setWhat\('checking the graphics driver'\);\s*await Promise\.race\(\[driverDone, new Promise\(\(r\) => setTimeout\(r, LOADING_TUNE\.driverWaitMs\)\)\]\);/.test(settle.slice(check)), 'and one screen a session waits for its tries, bounded by driverWaitMs, saying so under the title; no later screen waits for it');
  ok((main.match(/this\.driverHeld = true;/g) ?? []).length === 1 && /this\.shaderVerdictSaid = false;\s*this\.driverHeld = false;/.test(main), 'the one wait is spent once a session, and given back only by `shaders({ probe: \'again\' })`');
  const quiet = method(world, '  get compileQuiet(): boolean {');
  const busy = method(world, "  get compileBusy(): '' | 'outright' | 'queued' | 'flush' {");
  ok(/return this\.compileBusy === '';/.test(quiet) && /this\.outrightBuilds !== 0\) return 'outright'/.test(busy) && /this\.programs\.pending !== 0\) return 'queued'/.test(busy) && /this\.flushing !== null\) return 'flush'/.test(busy) && !/bodiesUp/.test(quiet + busy), 'the check waits for no outright build, nothing queued and no flush, and never for every body to be up (a town whose wildlife was still landing never went quiet)');
  ok(/const busy = this\.world\.compileBusy;\s*if \(busy !== ''\) \{/.test(method(main, '  private async checkDriverAfterSweep(): Promise<void> {')), 'and the check asks it before every try, counting what kept it waiting');
  ok(/console\.info\(`shaders: \$\{screenMade\} programs built behind the loading screen in \$\{[^}]+\} ms \(the sweep: \$\{compiled\} in \$\{Math\.round\(sweepMs\)\} ms\)`\)/.test(settle), "the settle's console line prints the whole screen's programs beside the sweep's own count and milliseconds");
  ok(/this\.loadingLog\.sweep\(compiled, sweepMs\);/.test(settle) && /this\.loadingLog\.bodies\(this\.world\.peopleReport\(\)\);\s*this\.upPending = this\.world\.readyBodyMaterials\(new Set\(\)\);/.test(settle), 'and the record of the screen takes both, and the bodies as it lifts with the materials of those up');
  ok(/loadingLine\(screenBefore \+ made, compilerVerdict\(\)\)/.test(settle), 'the words count the programs made behind this screen, never the objects');
  // The figures T6 and T7 are read by.
  const report = method(world, '  peopleReport(): {');
  ok(/up: standingPeople\.readyBodies\(\)/.test(report), "the people up as the screen lifts are the people pass's own bodies whose model is up, counted afresh, never its stood count");
  const mats = method(world, '  readyBodyMaterials(out: Set<THREE.Material>): Set<THREE.Material> {');
  ok(/if \(!m\.ready \|\| m\.removed \|\| m\.dead\) continue;\s*materialsUnder\(m\.group, out\);/.test(mats), "the materials kept as the screen lifts are every up body's own, its whole group's");
  ok(/this\.dropUpWindow\(\);\s*this\.loadingLog\.on\(text, now, programs\);/.test(main), 'a screen going up lets go of the last window\'s materials');
  ok(/this\.loadingLog\.off\(now, programs, this\.shaderWatch\.highest\);[\s\S]{0,400}w\.materials = this\.upPending;\s*w\.measured = this\.upPending !== null;/.test(main), "a screen lifting hands its window the program id it lifted at and the materials its settle had up, and none where it had no settle");
  ok(/this\.loadingLog\.frame\(rawDt \* 1000, tFrame, peopleBuilt, this\.shaderWatch\.highest\);\s*[\s\S]{0,200}if \(this\.upWindow\.materials && tFrame > this\.loadingLog\.afterEnds\) this\.endUpWindow\(\);/.test(main), 'the frame loop carries the window\'s highest program id and ends it once afterS has run out');
  ok(/return programsForUp\(materials, fromId, toId, \(m\) => \(props\.has\(m\) \? props\.get\(m\)\.programs\?\.values\(\) : null\)/.test(main), "and what was built for them is read off three's own records of their materials, never a queue label");
}

// --- the warm-up's forced passes are gone ----------------------------------------------------------------------------

{
  const warm = method(world, '  warmUp(center: THREE.Vector3): void {');
  ok(!/standingPeople\.step\(/.test(warm) && !/ambientPeople\.step\(/.test(warm), 'the arrival\'s warm-up no longer calls standingPeople.step or ambientPeople.step (they ran before the rows were adopted)');
  ok(/standOursNow\(at: THREE\.Vector3\): void \{\s*ambientPeople\.step\(0, this\.simTime, at, this\.ambientDeps\(\), true\);/.test(world), 'standOursNow is the people of ours forced');
  ok(/standWildNow\(at: THREE\.Vector3\): number \{\s*wildLife\.step\(0, this\.simTime, at, this\.wildDeps\(\), true\);/.test(world), 'standWildNow is the wild pass forced');
}

// --- one screen to a place on another world --------------------------------------------------------------------------

{
  const teleport = method(main, '  private async teleport(');
  const branch = teleport.slice(0, teleport.indexOf('const c = this.world.layoutCenter;'));
  ok(/await this\.travel\(planet, zoneId, undefined, \{ at: new THREE\.Vector3\(g\.x, 0, g\.z\), label: poi\.name, ground: true, port: isPortKind\(poi\.kind\) \}\);/.test(branch), "teleport's other-world branch travels once, to the place, with ground and port");
  ok(/planet\.space \? null : await this\.poisFileOf\(packIdOf\(planet, zoneId\)\)/.test(branch), 'from the far world\'s own pois.json centre, never for space');
  ok(/\n\s*this\.poisFileOf = \(id\) => galaxy\.loadPoisFile\(id\);/.test(main), "and the far world's file is read by the galaxy map's own reader (left as the stand-in, which knows no centre, every far trip would silently be two screens again)");
  const net = /\n(\s*)if \((!?)centreAgrees\(this\.world\.layoutCenter, centre, LOADING_TUNE\.centreSlack\)\) return;/.exec(branch);
  ok(!!net && net[2] === '', 'with the centre checked after it, the safety net: where the centres agree the trip is done, and only where they do not does the second screen run');
  ok(/if \(this\.world\.planet\.id !== planet\.id\) return;/.test(branch) && branch.indexOf('if (this.world.planet.id !== planet.id) return;') < (net?.index ?? 0), 'and a travel that never reached the world stands nobody');
  ok(!/loadingScreen\.show/.test(branch), 'the other-world branch shows no screen of its own');
  const fallback = teleport.slice(teleport.indexOf('const c = this.world.layoutCenter;'));
  ok(/this\.loadingScreen\.show\(planet, poi\.name, `on \$\{planet\.name\}`\);/.test(fallback) && /this\.world\.jumpTo\(pos\);/.test(fallback), 'the second phase stays as it was, the fallback for no centre, a centre that disagrees and the same world');
  const travel = method(main, '  private async travel(');
  const ground = travel.indexOf('if (opts.ground) at.y = this.world.terrain.heightAt(at.x, at.z) + 0.3;');
  const spawn = travel.indexOf('this.spawn.copy(p.pos);');
  const port = travel.indexOf('if (opts.port && this.standInPort()) this.spawn.copy(p.pos);');
  const cameOut = travel.indexOf('const cameOut');
  const saved = travel.indexOf('this.savePlace(true);');
  ok(ground > 0 && spawn > ground && port > spawn && cameOut > port && saved > cameOut, 'the ground branch stands, keeps the spawn and steps into a port before const cameOut and the saved place');
  ok(/this\.arrive\(planet, zoneId, crossing\?\.arrival\?\.pos \?\? besideAt \?\? opts\?\.at/.test(travel), "a follower's beside still wins over the caller's spot");
  ok(/else if \(opts\?\.at && !besideAt && !arrived\)/.test(travel), "and the caller's spot is stood only with no beside");
  ok(/ground\?: boolean;/.test(main) && /port\?: boolean;/.test(main), 'TravelOpts carries ground and port');
  const perfGoTo = method(main, '  private async perfGoTo(');
  ok(/await this\.travel\(planetById\(m\.planet\), m\.zone \|\| undefined, undefined, \{ at: to, heading: m\.yaw - Math\.PI, label: name \}\);/.test(perfGoTo), 'perfGoTo on another world comes out at the mark');
  ok(/goToShot: async[\s\S]{0,1200}await this\.travel\(planetById\(where\.planet\), where\.zone, undefined, \{ at, heading:/.test(main), 'and goToShot at its spot');
}

// --- the race start: no curtain, or a course curtain, never settle ---------------------------------------------------

{
  const start = method(main, '  private async startRun(');
  ok(!/this\.settle\(/.test(start), 'startRun never calls this.settle(');
  ok(/const need = this\.courseCurtain\(v, at, points\);/.test(start), 'it asks the need test first');
  const stand = method(main, '  private async standOnCourse(');
  ok(!/this\.settle\(/.test(stand), 'the course curtain never calls this.settle(');
  ok(/this\.traveling = true;\s*this\.curtainOnly = true;/.test(stand) && /this\.traveling = false;\s*this\.curtainOnly = false;/.test(stand), 'the course curtain sets curtainOnly beside traveling, and puts both back');
  ok(/await this\.world\.loadCourse\(need\.ids, TRACK_TUNE\.warmWaitMs\);/.test(stand), "its loads are bounded by TRACK_TUNE.warmWaitMs");
  const load = method(world, '  async loadCourse(ids: readonly string[], ms: number)');
  ok(/await loadBounded\(queue, \(id\) => ls\.loadModel\(id\), keepOn, LOADING_TUNE\.courseLoads, ms, \(wait\) => new Promise<void>\(\(r\) => setTimeout\(r, wait\)\)\);/.test(load), 'and the bound is really kept inside: the loads race a timer of that length (`loadBounded`)');
  ok(/const queue = ids\.filter\(\(id\) => !ls\.loadedModel\(id\) && !ls\.hasFailed\(id\)\);/.test(load), 'never asking again for a model known not to load');
  const need = method(world, '  courseNeed(points:');
  ok(/const counts = courseCounts\(indoor, \{[\s\S]*failed: \(id\) => !!ls\?\.hasFailed\(id\),[\s\S]*warmed: \(id\) => warmed\.has\(id\),[\s\S]*warmedWhole: \(m\) => this\.warmedWhole\(m, false\),/.test(need), "the need test's counts are `courseCounts`, with the streamer's failures, the session's memo and the materials alone (the indoor rule is the counts' own)");
  ok(/settled: this\.settled\(grid\)/.test(need) && /pending: this\.programs\.pending/.test(need), 'and the grid really asked whether it is settled, and the queue what it still holds');
  const compile = method(world, '  async compileCourse(');
  ok(/for \(const id of done\) warmed\.add\(id\);/.test(compile) && /const warmed = this\.courseWarmedIds\(\);/.test(compile), 'what a course curtain compiled is kept as warmed for the session, so the next start needs no curtain');
  ok(/this\.layoutStream = null;\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*this\.courseWarmed = \{ ls: null, ids: new Set\(\) \};/.test(world), 'and the memo goes with the streamer it was kept for when the world unloads');
  ok(/performance\.now\(\) - t0 < LOADING_TUNE\.gridSettleMs/.test(stand), 'its grid wait by gridSettleMs');
  ok(/if \(moved >= LOADING_TUNE\.courseNear\) this\.world\.jumpTo\(v\.pos\);/.test(stand), 'with no curtain the streamed world moves only for a hull that moved a chunk');
  ok(/await this\.loadingScreen\.hide\(\{ quick: LOADING_TUNE\.quickHide \}\);/.test(stand), 'and it goes without the reveal\'s glide');
  const go = main.slice(main.indexOf("if (typeof opts.go === 'string') {"), main.indexOf("if (typeof opts.start === 'string') words.push(await this.startRun(opts.start));"));
  ok(go.length > 100 && !/this\.settle\(/.test(go) && /this\.coursePoints\(t, places\)/.test(go), 'the go path never settles and takes the whole course as its points');
  ok(/if \(this\.traveling && !this\.curtainOnly && this\.storyWatch\.inside\.length\) this\.storyWatch\.leaveAll\(this\.raiseStory\);/.test(main), "the story's leave reads curtainOnly");
  ok(/if \(this\.dying \|\| \(this\.traveling && !this\.curtainOnly\) \|\| !this\.inWorld\) this\.endComm\(\);/.test(main), "and so does the call's end");
  const reads = main.match(/[!=&|(]\s*this\.curtainOnly\b(?!\s*=[^=])/g) ?? [];
  const sets = main.match(/this\.curtainOnly = (true|false);/g) ?? [];
  ok(reads.length === 2 && sets.length === 2, `and nothing else of the game reads it: two reads and the curtain's two sets (${reads.length} and ${sets.length})`);
}

// --- the sweep, the frame loop, the queue's own compiles -------------------------------------------------------------

{
  const batches = method(world, '  private async sweepBatches(');
  ok(/if \(sweepYield\(built, t1 - sliceFrom, behind, LOADING_TUNE\.sliceMs\)\) \{\s*await this\.nextFrame\(\);/.test(batches) && !/breath\(\)/.test(batches), "the sweep's batch loop awaits nextFrame through sweepYield, and never breath");
  // Read in code twice since the performance pass's second wave: the frame rule, and whether the sweep issues its
  // batches in parallel (only behind a screen); the comments say "behind a screen" too, so they are left out.
  const code = batches.replace(/\/\/.*$/gm, '');
  ok(/\{\n\s*const behind = this\.behindScreen;\n/.test(batches) && (code.match(/\bbehind\b/g) ?? []).length === 3 && /const parallel = \(\): boolean => behind && linkMode\(document\.hidden\) === 'parallel';/.test(code) && !/\bbehind = /.test(code.replace('const behind = this.behindScreen;', '')), 'whether a screen is up is the world\'s own word, read once as the sweep begins: in play (the Effects switch) every batch still waits a frame, and only behind a screen are batches issued in parallel');
  ok(/if \(built > 0\) noteProgramTime\(t1 - t0 \+ \(issue \? landMs : 0\), built\);/.test(batches), 'and times every batch that built into the milliseconds a program (issued in parallel, the issue and the resolves, never the wait)');
  const everything = method(world, '  private async compileEverything(');
  ok(/await this\.sweepBatches\(r, camera, objects, target,/.test(everything) && !/await this\.nextFrame\(\);/.test(everything), 'compileEverything sweeps through it and waits on no frame of its own');
  const draw = main.indexOf('        this.drawFrame();\n        if (screenHides) this.screenDrawnAt = tFrame;');
  const tick = main.indexOf('this.world.programs.tick(performance.now());', draw);
  ok(draw > 0 && tick > draw && tick - draw < 800, 'the frame loop ticks the queue again after drawFrame');
  ok(/const screenHides = LOADING_TUNE\.screenDraws && this\.loadingScreen\.opaque;\s*if \(!screenHides \|\| tFrame - this\.screenDrawnAt >= LOADING_TUNE\.drawEveryMs\)/.test(main), 'and draws the world at most every drawEveryMs only while the screen is fully opaque');
  const one = method(world, '  private compileOne(');
  // Since the performance pass's second wave a rooms pass compiles against its own scene and leaves nothing set up; the
  // put-back is the old way's alone (`renderStates` 'shared').
  ok(/r\.compile\(root, camera, this\.passScene\(layer\)\)/.test(one) && /if \(last !== 0 && PASS_STATES\.mode === 'shared'\) this\.withLayers\(camera, 0, \(\) => this\.withTarget\(r, target, \(\) => r\.compile\(this\.compileNothing, camera, this\.scene\)\)\);/.test(one), "compileOne compiles each pass against that pass's own scene, and the old way puts the world pass's lights back after a room's pass");
  const waiter = method(world, '  private async queueOrBuild(');
  ok(/const watch = new QueueWatch\(\);/.test(waiter) && /watch\.stopped\(this\.programs\.ticks, performance\.now\(\), !document\.hidden\)/.test(waiter) && /await this\.flushQueue\(true\);/.test(waiter), "a waiter judges the loop by frames counted, by the long bound on a page on screen, and flushes in play's own way");
  ok(/private readonly flushPlay = \{ shown: \(\): boolean => !document\.hidden && !this\.behindScreen \};/.test(world) && /play \? this\.flushPlay : undefined/.test(world), 'and a flush in play counts what it builds on a page on screen with no loading screen up, the fault itself');
  ok(/const shown = !document\.hidden;\s*if \(!SHADER_PACING \|\| this\.behindScreen \|\| this\.programs\.idle\(performance\.now\(\), shown\)\)/.test(waiter), 'its entry is the single-instant test, by the long bound on a page on screen');
  ok(/const byIdle = SHADER_PACING && !this\.behindScreen && shown;/.test(waiter) && /if \(byIdle\) this\.programs\.noteIdleBuilt\(/.test(waiter), "and what the entry test's own outright build makes on a page on screen is counted with the flushes");
  ok(/async prepareActor\(root: THREE\.Object3D, label\?: string, roomsLater\?: RoomJob\)[\s\S]{0,1100}await this\.compileReady\(\[root\], label, roomsLater \? \{ roomsLater \} : undefined\);/.test(world), 'prepareActor hands the queue its label (and the room deferral its handle)');
}

// --- the loading screen's own picture (the fifth wave) -------------------------------------------------------------------

{
  const loading = readFileSync(new URL('../../../src/ui/loading.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const code = loading.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/toDataURL|toBlob|getImageData/.test(code), "the loading screen reads nothing back: the stand-in picture is the canvas itself, never encoded with toDataURL");
  ok(/<canvas class="grey"[^>]*hidden><\/canvas>/.test(loading) && /<canvas class="colour"[^>]*hidden><\/canvas>/.test(loading) && /this\.paintStandIn\(greyCtx,[^)]*\);\s*this\.paintStandIn\(colourCtx,[^)]*\);\s*this\.showLayers\(true\);/.test(loading), 'it is drawn twice, onto two canvases that stand where the two pictures would');
  ok(/void loadingPicture\(planet, this\.baseUrl\)\.then\(\(src\) => \{\s*if \(ask !== this\.pictureAsk\) return;/.test(loading) && !/assets-private\/loading\/\$\{planet\.id\}\.png/.test(code), "and a picture is asked for only where the loading command's own index lists one (`loadingPicture`), the answer for another world's screen dropped");
}

console.log(`\nloadingWiring: ${checks} checks passed`);

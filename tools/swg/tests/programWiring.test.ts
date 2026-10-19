// The game's own hand-overs behind the performance pass's second wave, read as text (podHybrid.test.ts's and
// grappleWiring.test.ts's way): every behaviour test of the wave -- linkMode, programPace, velocity, roomDefer,
// passScenes -- builds these hand-overs for itself, so the game could lose any of them while every one of those passed
// (a review broke all of them at once in a copy and the whole of `test:all` stayed green). The world, the app and the
// effects chain do not load under node, so what they hand each other is pinned here as the code says it:
//
//   T9 and T10: the queue's `parallel` mode wired to the world's renderer, the world's own two flights finishing only
//   what reports ready, the effects' warm-up resolving what it warmed, the link-wait watch on the game's context, the
//   boot check at the top of every settle, the motion blur's variants on the world's queue, and the frame's wait
//   counted. The room deferral: the bodies listed for the renderer before the routes, each body's `roomReady` handed to
//   the routes and its job made urgent when it says so, the deferral's branch in `compileReady`, who asks for it (the
//   manager's `indoors`, a fighter dressed outdoors), what a body reads its readiness from, and the owner going.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
/** The text from `start` to the first `end` after it (the whole rest when `end` is not found); empty when `start` is not found. */
function between(text: string, start: string, end: string): string {
  const at = text.indexOf(start);
  if (at < 0) return '';
  const stop = text.indexOf(end, at + start.length);
  return text.slice(at, stop < 0 ? undefined : stop);
}
/** Whether `a` comes before `b` in `text`, both present. */
const before = (text: string, a: string, b: string): boolean => text.includes(a) && text.includes(b) && text.indexOf(a) < text.indexOf(b);

const world = read('world/world.ts');
const main = read('main.ts');
const postfx = read('core/postfx.ts');
const manager = read('world/mobiles/manager.ts');
const npcs = read('world/npcs.ts');
const mobile = read('world/mobiles/mobile.ts');
const assets = read('world/mobiles/assets.ts');

// ---- 1. T9 and T10: the link mode's hand-overs. ----
{
  const ctor = between(world, 'constructor(readonly scene: THREE.Scene, readonly physics: Physics) {', 'this.weather = new Weather(physics);');
  ok(ctor.includes('this.programs.links = {'), "the world hands its program queue the link mode (`programs.links`), or the queue never runs in parallel mode");
  ok(ctor.includes("parallel: () => linkMode(typeof document !== 'undefined' && document.hidden) === 'parallel'") && ctor.includes("hidden: () => typeof document !== 'undefined' && document.hidden"), "with the mode and the tab's visibility read at every pump");
  ok(ctor.includes('pending: (o) => pendingPrograms(this.renderer, o, this.pendingScratch)') && ctor.includes('resolve: (o, onlyReady) => resolveLinks(this.renderer, o, onlyReady)'), "and an object's unresolved programs and the resolve, passing `onlyReady` on");
  const outright = between(world, 'private async buildOutright(', 'readonly outrightLinks');
  ok(outright.includes("resolveLinks(r, o, e.how === 'ready')"), "an outright build's flight finishes only what reports its link done for an object it saw ready");
  const sweep = between(world, 'private async sweepBatches(', 'private async compileEverything(');
  ok(sweep.includes("resolveLinks(r, flight.finished[i].object as THREE.Object3D, flight.finished[i].how === 'ready')"), "and so does the screen's sweep");
  ok(sweep.includes('pendingPrograms(r, o, pending)') && sweep.includes('this.compileFor(r, camera, batch, target, !issue)'), 'the sweep issues its batches with no resolve in parallel mode and polls them');
  const warm = between(postfx, 'async warmUp(', 'fxView(');
  ok(before(warm, 'await Promise.all(jobs);', 'for (const o of compiled) resolveLinks(r, o);'), "the effects' warm-up resolves what `compileAsync` warmed, after the links, behind the screen");
  ok(main.includes('watchLinkWaits(this.renderer.getContext(), () => performance.now());'), "the link-wait watch is installed on the game's own context");
  const settle = between(main, 'private async settle(timeoutMs = 30000): Promise<void> {', 'while (performance.now() - t0 < timeoutMs)');
  ok(settle.includes('this.startLinkCheck();'), 'the boot check is started at the top of every settle (it runs once a page)');
  const check = between(main, 'private startLinkCheck(): void {', 'private async settle(');
  ok(check.includes("r.extensions.has('KHR_parallel_shader_compile')") && check.includes('check.start(program, extension, performance.now())'), 'and polls its salted probe with the extension asked of the renderer');
  ok(check.includes("document.addEventListener('visibilitychange', onShown)") && check.includes('requestAnimationFrame(poll)'), 'a hidden tab is waited out, never decided on (the check polls again on the first frame after it shows)');
  ok(check.includes("document.addEventListener('visibilitychange', onHide)") && check.includes('check.poll(performance.now(), true)') && check.includes("document.removeEventListener('visibilitychange', onHide)"), 'and a tab that hides while a poll is pending pauses the check at once, the listener let go when it decides');
  const fx = between(main, 'private makePostFX(): PostFX {', 'return fx;');
  ok(fx.includes("fx.product<VelocityProduct>('velocity')?.setQueue((objects, label, urgent, own) => this.world.programJob(objects, label, urgent, own));"), "the motion blur's variants go on the world's queue (`setQueue` to `programJob`)");
  ok(main.includes("perf.count(CNT.linkWait, LINK_WAITS.endFrame(phase === 'play'));"), "every frame's wait on links is rolled and counted, play apart (T9)");
  const job = between(world, '  programJob(objects: THREE.Object3D[], label: string, urgent: boolean, own: OwnJob): Promise<void> {', '\n  }\n');
  ok(job.includes('this.programs.add(objects, label, own)') && job.includes('return this.queueOrBuild(objects, label, true, own);'), "the world's `programJob` puts loose work on the queue and urgent work through `queueOrBuild`, with its own compile");
}

// ---- 2. The room deferral's hand-overs. ----
{
  const routes = between(main, 'private collectRoutes(): void {', 'private readonly routeMid');
  ok(before(routes, 'this.listRoomPending();', 'if (!r.begin(this.portals.vis'), 'the bodies still waiting on their rooms programs are listed for the renderer before the routes begin (it hides them round a rooms pass with the routes off)');
  ok(routes.includes('cell ? cell.cell : 0, m.roomReady)) m.roomsNow();'), "each mobile's `roomReady` goes to the routes, and one counting in a room has its job made urgent");
  ok(routes.includes('cell ? cell.cell : 0, n.roomReady)) n.roomsNow();'), "and each fighter's");
  const pending = between(main, 'private listRoomPending(): void {', '/** The frame drawn once');
  ok(pending.includes('if (m.ready && !m.removed && !m.roomReady) list[n++] = m.group;') && pending.includes('if (!f.roomReady) list[n++] = f.group;') && pending.includes('this.portals.roomPendingCount = n;'), "the pending list is every body not room-ready, mobiles and fighters, written into the renderer's own");
  const ready = between(world, 'async compileReady(objects: THREE.Object3D[], label?: string, opts?: { roomsLater?: RoomJob }): Promise<void> {', '/** Whether a light hangs anywhere under these roots');
  const deferred = between(ready, 'if (ROOM_DEFER.on && this.wouldQueue()', 'return;');
  ok(deferred.includes('!World.hasLight(objects)') && deferred.includes('World.passesOf(m).includes(INTERIOR_LAYER)'), 'only a body with no light under it and a rooms pass to defer is deferred');
  ok(before(deferred, 'later.ready = false;', 'await this.queueOrBuild(meshes, what, true, this.worldOnlyJob);'), 'the handle is not ready before the world pass alone is built, urgent');
  ok(before(deferred, 'await this.queueOrBuild(meshes, what, true, this.worldOnlyJob);', 'deferRooms(later, meshes, `${what} (its rooms)`, this.roomsOnly, this.roomQueue);'), 'and the rooms pass is deferred after it, through `deferRooms` (which marks it ready only once it is built)');
  ok(/await this\.queueOrBuild\(meshes, what, true\);\s*later\.ready = true;/.test(ready), 'a body that is not deferred has both passes built, urgent, before its handle is ready');
  ok(world.includes("private readonly roomsOnly: RoomCompile = (o, allowance, resolve) => this.compileOne(o, allowance, resolve, 'rooms');"), "the deferral's turn is the rooms pass alone");
  const rq = between(world, 'private readonly roomQueue: RoomQueue = {', '};');
  ok(rq.includes('push: (objects, label, urgent, own) => this.queueOrBuild(objects, label, urgent, own)') && rq.includes('promote: (own) => this.programs.promote(own)'), "and its queue is the world's own, with its promote");
  ok(world.includes('await this.compileReady([root], label, roomsLater ? { roomsLater } : undefined);') && world.includes('mobileAssets.prepare = (root, label, roomsLater) => this.prepareActor(root, label, roomsLater);'), "a mobile asset's prepare carries its handle through to `compileReady`");
  ok(main.includes('await this.world.compileReady(objects, undefined, opts);'), "and a fighter's compile hook carries its own");
  ok(manager.includes('indoors: held.cell !== null'), 'the manager says whether the body that first wants an asset stands indoors');
  ok(assets.includes('const later = !opts.indoors;') && assets.includes("asset.prepared = this.prepareRoot(asset.scene, `model:${file}`, roomsLater ? asset.roomJob : undefined);"), 'and an asset first wanted outdoors is prepared with its rooms deferred');
  ok(npcs.includes('if (deps.compile) await deps.compile([rig.root], this.cell ? undefined : { roomsLater: this.roomJob });'), 'a fighter dressed outdoors defers its rooms, one dressed indoors does not');
  ok(mobile.includes('return this.wornBody?.roomJob?.ready !== false;') && mobile.includes('this.wornBody = model;'), "a mobile's `roomReady` reads the handle of the body it was hung with");
  ok(/roomsNow\(\): void \{\s*const job = this\.wornBody\?\.roomJob;\s*if \(job && !job\.ready\) job\.promote\(\);/.test(mobile), 'and its `roomsNow` makes that job urgent');
  ok(/roomsNow\(\): void \{\s*if \(!this\.roomJob\.ready\) this\.roomJob\.promote\(\);/.test(npcs) && npcs.includes('return this.roomJob.ready;'), "a fighter's read its own handle");
  const dispose = between(assets, 'private disposeModel(a: ModelAsset): number {', 'referencedBytes(): number {');
  ok(before(dispose, 'if (a.roomJob) a.roomJob.gone = true;', 'for (const m of a.materials) m.dispose();'), "an asset trimmed marks its handle gone before its materials are disposed, so rooms work still queued compiles nothing");
  const have = between(assets, 'const have = this.models.get(key);', 'const failed = this.failure(file);');
  ok(have.includes('if (opts.indoors) have.roomJob.promote();') && have.includes('else have.roomJob.resume();'), 'a cached asset wanted again has its rooms work made urgent indoors, or asked for again outdoors if a world let it go');
  ok(between(npcs, '  dispose(scene: THREE.Scene): void {', 'scene.remove(this.group);').includes('this.roomJob.gone = true;'), 'a fighter let go marks its handle gone');
}

console.log(`\n${checks} checks passed`);

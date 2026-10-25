// Nothing allocates in a frame (the volumetrics design's rule 4, §8 Tests): `airAlloc.ts` in a node process of its own,
// cleanest of three runs, over 100,000 steady frames of the moving air's CPU side -- the real `AirField.update` with ten
// engines and two downwashes read from stand-in hulls that throw if asked for a velocity, a blast and a push queued
// every frame, the rasters with the window standing still, the solver's steps and every uniform written, the dust and
// the light, and the dust pool's grains stepped onto the field's raster -- held under 0.2 bytes a frame; a frame whose
// window moves at 167 m/s (every frame of a ride or a flight: the rasters shifted, the strips asked, the shifts carried)
// held to the same line, since its ground is a stand-in that makes nothing and whatever it makes is the air's own (it
// made 13 bytes a frame until the raster's shift stopped handing the window's mean across a call); the ground's marks of
// the second wave in both -- the carried offsets, the dent square placed and its strips cleared, the engines' pits and
// ruts gathered and laid on the 10 Hz tick and faded, a crater a frame and a footprint pressed every 64th (32 bytes a
// frame until the square was placed from its own record rather than handed the camera's place across a call, and a tick
// boxed the texel's metres in a `Vector4.set`); wave 2b's in both -- the dust's shape numbers worked out every
// frame, the sand's two phases restarted, a push, a pull and a repulse begun every 70 frames and walked, the storm's
// weight and its colour eased off the window through `tintedAt` in the normalised tint mode, a mote's colour read the
// same way every frame, the tint raster's strips filled in the moving frames from a ground whose tint is not one; the
// fourth wave's in both -- the kick-up pool stepped every frame over its records, a footstep handed to it, the rain's
// frame written and stepped; and with the master off, a million calls of each method of the force API and of the
// field's frame make nothing.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string): void => console.log(`note ${s}`);
const script = fileURLToPath(new URL('./airAlloc.ts', import.meta.url));
const run = (...args: string[]): string => execFileSync(process.execPath, ['--expose-gc', '--allow-natives-syntax', script, ...args], { encoding: 'utf8', timeout: 600_000 }).trim().split('\n').pop() ?? '{}';

type Moving = { frames: number; made: number; scavenges: number; movedShare: number; resets: number };
type Ground = { sources: number; dents: { oneShots: number; laid: number; ticks: number; cleared: number }; feet: { dents: number } };
type Third = { fronts: number; droppedFronts: number; storm: number[]; sand: string | null; cycles: number[] | null; mote: number[] };
type W3 = { smoke: number; droppedSmoke: number; smokeLive: boolean; wisps: string | null; noise: string | null; layers: number; fogLevel: number };
type W4 = { kickSteps: number; kickStarted: number; kickHidden: number; rainSteps: number; rainDrawing: boolean };
type W5 = { stepped: boolean; bound: boolean; pokes: number; water: number; lava: number; sink: number };
type W6 = { peers: number; shuttles: number; grassBound: boolean; grassShare: number; grassReading: boolean };
type Steady = { skipped?: string; w4: W4; w5: W5; w6: W6; w7: { handed: number }; frames: number; made: number; scavenges: number; stepping: boolean; engines: number; grains: number; ground: Ground; third: Third; w3: W3; moving: Moving };
const clean = (m: { made: number; scavenges: number; frames: number }): boolean => m.scavenges === 0 && m.made / m.frames < 0.2;
const better = (a: { made: number; scavenges: number }, b: { made: number; scavenges: number }): boolean => a.scavenges < b.scavenges || (a.scavenges === b.scavenges && a.made < b.made);
// Cleanest of three runs, the steady frame and the moving one each on its own (a run caught while the engine is still
// optimising its loop boxes numbers in the code it falls back on).
let best: Steady | null = null;
let bestMoving: Moving | null = null;
for (let i = 0; i < 3; i++) {
  const got = JSON.parse(run()) as Steady;
  if (got.skipped) {
    best = got;
    break;
  }
  if (!best || better(got, best)) best = got;
  if (!bestMoving || better(got.moving, bestMoving)) bestMoving = got.moving;
  if (clean(best) && clean(bestMoving)) break;
}
if (!best) throw new Error('no measure');
if (best.skipped) note(`the allocation measure was skipped: ${best.skipped}`);
else {
  ok(best.stepping && best.engines === 16 && best.grains > 0, `the frame measured steps the air with ${best.engines} engines in its table (our hulls' ten and two downwashes, another player's speeder and their hovering ship's downwash, a shuttle's two engines) and ${best.grains} grains in the pool`);
  const w6 = best.w6;
  ok(w6.peers > 100_000 && w6.shuttles > 100_000 && w6.grassBound && w6.grassShare === 1 && w6.grassReading, `and the sixth wave's with it: the other players' rides (${w6.peers}) and the shuttle's engines (${w6.shuttles}) taken into the table every frame, and the grass's record written (its share ${w6.grassShare})`);
  ok(best.w7?.handed === 1, `and the seventh wave's with it: the unified wind's arm on, a dust devil handed to the forces every frame (${best.w7?.handed} on the last), the gust shed's rate and the grass's wind and sheen written`);
  const gd = best.ground;
  ok(gd.sources > 0 && gd.dents.laid > 0 && gd.dents.ticks > 0 && gd.dents.cleared > 0 && gd.feet.dents > 0, `and the ground's marks with it (the second wave): ${gd.sources} engines' pits and ruts held, ${gd.dents.laid} stamps laid, ${gd.dents.ticks} ticks faded, ${gd.dents.cleared} strips cleared, ${gd.feet.dents} footprints pressed as dents`);
  const th = best.third;
  const tinted = th.storm.every((v) => Number.isFinite(v) && v > 0) && th.mote.every((v) => Number.isFinite(v) && v > 0) && (th.storm[0] !== 0.6 || th.storm[1] !== 0.45);
  ok(th.fronts > 0 && th.droppedFronts === 0 && th.sand === 'whole' && (th.cycles?.[0] ?? 0) > 0 && (th.cycles?.[1] ?? 0) > 0 && tinted, `and wave 2b's with it: ${th.fronts} fronts begun and none dropped, the sand's picture ${th.sand} and its phases restarted ${th.cycles?.join(' and ')} times, the storm's colour eased to (${th.storm.map((v) => v.toFixed(3)).join(', ')}) and a mote read at (${th.mote.map((v) => v.toFixed(3)).join(', ')})`);
  const per = best.made / best.frames;
  ok(best.scavenges === 0 && per < 0.2, `a steady frame makes ${per.toFixed(3)} bytes (${best.made} over ${best.frames} frames, ${best.scavenges} collections), under 0.2`);
  const mv = bestMoving!;
  ok(mv.movedShare > 0.5 && mv.resets === 0, `the moving frames move the window a cell or more on ${(mv.movedShare * 100).toFixed(0)}% of them and never jump`);
  const mper = mv.made / mv.frames;
  ok(mv.scavenges === 0 && mper < 0.2, `a frame whose window moves at 167 m/s makes ${mper.toFixed(3)} bytes (${mv.made} over ${mv.frames} frames, ${mv.scavenges} collections), under 0.2: the air's own, its ground a stand-in that makes nothing`);
  const w3 = best.w3;
  ok(w3.layers === 3 && w3.smokeLive && w3.smoke > 0 && w3.wisps === 'noise' && w3.noise === 'whole' && w3.fogLevel > 0, `and the third wave's with it: three layers of air, smoke laid (${w3.smoke} sources, ${w3.droppedSmoke} dropped) and carried with a foggy morning's bank and emission, the wisps' noise whole and its phases worked out every frame in the noise mode`);
  const w4 = best.w4;
  ok(w4.kickSteps > 100_000 && w4.kickStarted > 0 && w4.kickHidden === 0 && w4.rainSteps > 100_000 && w4.rainDrawing, `and the fourth wave's with it: the kick-up stepped every frame (${w4.kickSteps} steps, ${w4.kickStarted} particles started from the engines', blasts' and fronts' records, never hidden while the field ran) and the rain stepped and drawn every frame (${w4.rainSteps} steps)`);
  const w5 = best.w5;
  ok(w5.stepped && w5.bound && w5.pokes > 0 && w5.water === 1 && w5.lava === 1 && w5.sink > 0, `and the fifth wave's with it: the liquid's tile stepped beside the slabs, its record written every frame (the water's share ${w5.water}, the lava's ${w5.lava}), and a hovering ship's downwash on the lake pressing the ripples (${w5.pokes} pokes)`);
  // The bands' mode: its pass a frame at the dust's size, the same lines.
  let bands: Steady | null = null;
  let bandsMoving: Moving | null = null;
  for (let i = 0; i < 3; i++) {
    const got = JSON.parse(run('bands')) as Steady;
    if (!bands || better(got, bands)) bands = got;
    if (!bandsMoving || better(got.moving, bandsMoving)) bandsMoving = got.moving;
    if (clean(bands) && clean(bandsMoving)) break;
  }
  ok(bands!.w3.wisps === 'bands' && clean(bands!) && clean(bandsMoving!), `in the bands mode (its pass every frame) a steady frame makes ${(bands!.made / bands!.frames).toFixed(3)} bytes and a moving one ${(bandsMoving!.made / bandsMoving!.frames).toFixed(3)}, under 0.2`);
}

const off = JSON.parse(run('off')) as { skipped?: string; off?: Record<string, { made: number; scavenges: number }>; active?: boolean };
if (off.skipped) note(`the master-off measure was skipped: ${off.skipped}`);
else {
  ok(off.active === false, 'with the master off the forces are inactive');
  for (const [k, m] of Object.entries(off.off ?? {})) ok(m.scavenges === 0 && m.made / 1_000_000 < 0.01, `with the master off a million calls of ${k} make ${(m.made / 1_000_000).toFixed(4)} bytes each, nothing`);
}

console.log(`\n${checks} checks passed`);

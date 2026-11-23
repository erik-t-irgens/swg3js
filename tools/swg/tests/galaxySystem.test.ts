// The galaxy map's opened system (the GPU port's pass 2, wave 5, maker M; the design's section 3): a picked system opens into
// its sun, worlds and moons where the clockwork puts them now at the System view's readable scale, each lit from where its
// star truly is, with orbit lines and phases that match the ground; a system with no applied draft stands its worlds in a
// ring; the band in the sky is the map's disc seen from the system's place; and its looks are baked behind a loading screen.
// The game's own code throughout: the map's `galaxySystem.ts`, the viewer's `orrery.js` (the System view's layout), maker S's
// `skyMotion.ts` and the day (`DayCycle`) the ground's sky reads, `galaxyLooks.ts` with a stand-in for the runtime's bakes.
//
// Run: node tools/swg/tests/galaxySystem.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftSystem, DRAFT_SYSTEMS } from '../../../src/sky/system/drafts.js';
import { compileSystem, EPOCH_MS, DAY_MS } from '../../../src/sky/system/system.js';
import { Orrery } from '../../../src/sky/look/orrery.js';
import { skyMotionFor } from '../../../src/sky/system/skyMotion.ts';
import { DayCycle } from '../../../src/world/daycycle.ts';
import { sharedClock } from '../../../src/world/sharedClock.ts';
import { GALAXY_SYSTEMS, systemPlace, worldsOf } from '../../../src/data/galaxy.ts';
import { nightPlaceOf } from '../../../src/sky/night/nightPlace.ts';
import { OpenedSystem, ORRERY_BASE, SYSTEM_VIEW_TUNE, appliedFor, readableRadii, MAX_GLOBES } from '../../../src/ui/galaxySystem.ts';
import { bakeMapLooks, MAP_LOOKS, lookRingsOf, systemBodyLook, systemBodyPictures, systemBodyRim, systemLooks } from '../../../src/ui/galaxyLooks.ts';
import { SKY_BODIES, cleanBodiesFile } from '../../../src/sky/look/bodiesFile.ts';
import { GPU } from '../../../src/core/gpuSwitch.ts';
import { RING_DIALS } from '../../../src/sky/look/partdials.js';
import { redeclared, reservedWords, unbalanced, undefinedCalls, uniformNames } from './glslScan.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const sys = (id: string) => GALAXY_SYSTEMS.find((s) => s.id === id)!;
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// The places' sizes a converted sky gives (only the items' sizes read them; directions never).
const SKY = {
  sun: { size: 0.6 },
  supplementalSun: { size: 0.55 },
  moon: { size: 0.5 },
  supplementalMoon: { size: 0.25 },
  celestials: [{ size: 0.45, image: { file: 'sky/cels_ice_moon.png' } }, { size: 1, image: { file: 'sky/cels_naboo.png' } }, { size: 2.5, image: { file: 'sky/yavin_prime.png' } }, { size: 0.3, image: { file: 'sky/cels_moon_earthy01.png' } }],
};
const SYSTEMS = { yavin: draftSystem('yavin'), tatoo: draftSystem('tatoo'), naboo: draftSystem('naboo'), kashyyyk: draftSystem('kashyyyk') } as Record<string, unknown>;

// ---------------------------------------------------------------- 1. the System view's readable layout, to the letter
{
  let all = 0;
  for (const id of DRAFT_SYSTEMS) {
    const d = draftSystem(id) as { grounds: { world: string; copy?: string | null }[] };
    const world = d.grounds.find((g) => !g.copy)!.world;
    const model = compileSystem(d as Record<string, unknown>, () => null, () => false, { world }) as unknown as { n: number; parent: Int16Array; radius: Float64Array; sunI: number };
    const mine = readableRadii(model, ORRERY_BASE);
    const theirs = (Orrery.prototype as unknown as { layout(m: unknown, b: number): Float64Array }).layout(model, ORRERY_BASE);
    ok(mine.length === theirs.length && mine.every((v, i) => v === theirs[i]), `${id}: the opened system's readable orbits are the System view's own (${model.n} bodies)`);
    all += model.n;
  }
  ok(all > 80, `every draft system laid out (${all} bodies)`);
}

// ---------------------------------------------------------------- 2. which star system a galaxy system opens into
{
  ok(appliedFor(sys('tatoo'), SYSTEMS, null)?.id === 'tatoo', "the Tatoo system opens into the file's applied Tatoo system");
  const nb = appliedFor(sys('naboo'), SYSTEMS, 'rori');
  ok(nb?.id === 'naboo' && nb.world === 'rori', 'the Naboo system, the player on Rori, is seen from Rori');
  ok(appliedFor(sys('naboo'), SYSTEMS, 'corellia')?.world === 'naboo', 'and from elsewhere, from its first world');
  ok(appliedFor(sys('kashyyyk'), SYSTEMS, 'kashyyyk')?.world === 'kashyyyk_main', "Kashyyyk's own world is the viewer's kashyyyk_main");
  ok(appliedFor(sys('corellian'), SYSTEMS, null) === null && appliedFor(sys('kessel'), SYSTEMS, null) === null, 'a system the file does not apply (Corellia and Talus), and one with no ground at all (Kessel), open as rings');
  ok(appliedFor(sys('yavin'), null, null) === null, 'no file: every system a ring');
}

// ---------------------------------------------------------------- 3. the clockwork the ground reads, at the ground's moment
const wallRec = { ms: Date.UTC(2026, 10, 23, 9, 17, 0) };
sharedClock.wall = () => wallRec.ms;
sharedClock.none();
for (const [gid, world, here] of [
  ['naboo', 'rori', 'rori'],
  ['tatoo', 'tatooine', 'tatooine'],
  ['yavin', 'yavin4', 'yavin4'],
] as const) {
  const m = skyMotionFor(SYSTEMS, world, world, SKY)!;
  const day = new DayCycle(0, 1);
  day.swg = true;
  day.follow(m);
  day.update(0, false);
  // The view's time for a system the player does not stand under: the shared clock's real days, which is the ground's count.
  const realT = (wallRec.ms - EPOCH_MS) / DAY_MS;
  ok(near(m.T, realT, 1e-9), `${world}: the ground's sky time from its own day's count (${m.T.toFixed(6)}) is the shared clock's real days the map reads elsewhere`);
  const o = OpenedSystem.open(sys(gid), SYSTEMS, here);
  ok(o.layout === 'clockwork' && o.id === gid && o.world === world, `${world}: opened as its clockwork, seen from ${world}`);
  o.clock.T = m.T;
  o.at();
  const cw = o.clockwork!;
  const st = cw.state as unknown as { dir: Float64Array; lit: Float64Array; light: Float64Array; R: Float64Array; unit: Float64Array; angle: Float64Array; basis: Float64Array; pos: Float64Array };
  const model = cw.model as unknown as { items: { member: boolean }[]; pairB: Int16Array; m: number; worldI: number; parent: Int16Array; follow: Int16Array };
  // Every item's direction and lit share as the map's clockwork has them, against maker S's interface at the same moment (a pair's
  // second sun is placed by the game's own pair rule after the clockwork, so it is held apart below).
  let worstDir = 0;
  let worstLit = 0;
  let compared = 0;
  const second = model.pairB && model.pairB.length ? model.pairB[0] : -1;
  for (let j = 0; j < m.m; j++) {
    if (j === second) continue;
    // The angle between the two by their chord (an arc cosine near 1 rounds to a micro-degree on its own).
    const dx = st.dir[3 * j] - m.dir[3 * j];
    const dy = st.dir[3 * j + 1] - m.dir[3 * j + 1];
    const dz = st.dir[3 * j + 2] - m.dir[3 * j + 2];
    worstDir = Math.max(worstDir, 2 * Math.asin(Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2)) * (180 / Math.PI));
    worstLit = Math.max(worstLit, Math.abs(st.lit[j] - m.lit[j]));
    compared++;
  }
  ok(compared > 2 && worstDir < 1e-6 && worstLit < 1e-9, `${world}: the map's ${compared} bodies stand where the ground's sky has them (worst ${worstDir.toExponential(1)} degrees, lit ${worstLit.toExponential(1)})`);
  // Each body laid at its parent's place and its readable radius along the clockwork's own way round (system x, y, z to the
  // map's x, z, -y), its globe lit from where its star truly is (the very way the sky lights it), its orbit through it.
  const s = SYSTEM_VIEW_TUNE.span / ORRERY_BASE;
  const R = readableRadii(cw.model as unknown as { n: number; parent: Int16Array; radius: Float64Array; sunI: number }, ORRERY_BASE);
  let worstPos = 0;
  let worstLight = 0;
  let worstOrbit = 0;
  let lights = 0;
  let orbits = 0;
  for (const b of o.bodies) {
    const i = b.index;
    const i3 = 3 * i;
    if (b.parent >= 0) {
      const p3 = 3 * b.parent;
      const r = R[i] * s;
      worstPos = Math.max(worstPos, Math.abs(o.pos[i3] - (o.pos[p3] + r * st.unit[i3])), Math.abs(o.pos[i3 + 1] - (o.pos[p3 + 1] + r * st.unit[i3 + 2])), Math.abs(o.pos[i3 + 2] - (o.pos[p3 + 2] - r * st.unit[i3 + 1])));
    }
    // The globe's light back into system space (x, -z, y), into the sky's frame by the clockwork's own turn, against the sky's.
    if (b.item >= 0 && !b.star && !model.items[b.item].member) {
      const lx = o.light[i3];
      const ly = -o.light[i3 + 2];
      const lz = o.light[i3 + 1];
      const kx = st.R[0] * lx + st.R[1] * ly + st.R[2] * lz;
      const ky = st.R[3] * lx + st.R[4] * ly + st.R[5] * lz;
      const kz = st.R[6] * lx + st.R[7] * ly + st.R[8] * lz;
      const j3 = 3 * b.item;
      worstLight = Math.max(worstLight, Math.abs(kx - m.light[j3]), Math.abs(ky - m.light[j3 + 1]), Math.abs(kz - m.light[j3 + 2]));
      ok(near(o.litSeen[i], m.lit[b.item], 1e-12), `${world}: ${b.name}'s phase on the map is the ground's (${(m.lit[b.item] * 100).toFixed(1)}% lit)`);
      lights++;
    }
    if (b.orbit) {
      const a = st.angle[i];
      const k = 16 * i;
      const e = o.orbitM;
      const x = e[k] * Math.cos(a) + e[k + 4] * Math.sin(a) + e[k + 12];
      const y = e[k + 1] * Math.cos(a) + e[k + 5] * Math.sin(a) + e[k + 13];
      const z = e[k + 2] * Math.cos(a) + e[k + 6] * Math.sin(a) + e[k + 14];
      worstOrbit = Math.max(worstOrbit, Math.abs(x - o.pos[i3]), Math.abs(y - o.pos[i3 + 1]), Math.abs(z - o.pos[i3 + 2]));
      orbits++;
    }
  }
  ok(worstPos < 1e-9, `${world}: each body at its readable radius along the clockwork's way round its parent (worst ${worstPos.toExponential(1)})`);
  ok(lights > 1 && worstLight < 1e-9, `${world}: ${lights} globes lit from where their star truly is, the sky's own light on them (worst ${worstLight.toExponential(1)})`);
  ok(orbits > 1 && worstOrbit < 1e-9, `${world}: ${orbits} orbit lines each through its body at the clockwork's angle (worst ${worstOrbit.toExponential(1)})`);
  ok(o.bodies.some((b) => b.here && b.ground === here), `${world}: the world the player stands on is marked`);
  ok(o.globes.length <= MAX_GLOBES && o.globes.every((g) => g.radius > 0), `${world}: ${o.globes.length} globes, every one sized`);
  // A day's turn on the ground crossed: the map follows the count, never jumps.
  const before = Float64Array.from(o.pos);
  o.clock.T = m.T + 1e-6;
  o.at();
  let jump = 0;
  for (let q = 0; q < before.length; q++) jump = Math.max(jump, Math.abs(before[q] - o.pos[q]));
  ok(jump < 0.05, `${world}: a tenth of a second on, nothing on the map has jumped (${jump.toExponential(1)} units)`);
}
{
  // Tatooine's pair: one body, two suns side by side at the middle (the System view's), both stars.
  const o = OpenedSystem.open(sys('tatoo'), SYSTEMS, 'tatooine');
  const twins = o.globes.filter((g) => g.body === o.bodies.findIndex((b) => b.kind === 'pair'));
  ok(twins.length === 2 && twins.every((g) => g.star) && twins[0].offX < 0 && twins[1].offX > 0 && twins[1].radius < twins[0].radius, "Tatooine's twins are one body drawn as two suns side by side, the second the smaller");
  // Yavin 4 locked to Prime: its orbit's plane turns with its year, and it stands at the angle its own day says.
  const y = OpenedSystem.open(sys('yavin'), SYSTEMS, 'yavin4');
  ok(y.bodies.some((b) => b.kind === 'giant' && b.name.includes('Yavin')) && y.bodies.some((b) => b.here && b.kind === 'moon'), 'the Yavin system opens on Yavin Prime with Yavin 4 marked as the moon you stand on');
}

// ---------------------------------------------------------------- 4. a system with no applied draft: its worlds in a ring
{
  const o = OpenedSystem.open(sys('corellian'), SYSTEMS, 'talus');
  const ringR = SYSTEM_VIEW_TUNE.span * SYSTEM_VIEW_TUNE.ringShare;
  const worlds = o.bodies.filter((b) => b.ground);
  ok(o.layout === 'ring' && o.id === null && worlds.length === 2 && worlds.map((b) => b.ground).join() === 'corellia,talus', 'Corellia and Talus, no system applied, stand in a ring round their sun');
  ok(worlds.every((b) => near(Math.hypot(o.pos[3 * b.index], o.pos[3 * b.index + 2]), ringR, 1e-9) && o.pos[3 * b.index + 1] === 0), 'each on the ring');
  ok(worlds.every((b) => near(o.light[3 * b.index] * o.pos[3 * b.index] + o.light[3 * b.index + 2] * o.pos[3 * b.index + 2], -ringR, 1e-9)), 'each lit from the middle');
  ok(worlds.find((b) => b.ground === 'talus')!.here && !worlds.find((b) => b.ground === 'corellia')!.here, 'the player on Talus: Talus is marked');
  const before = Float64Array.from(o.pos);
  o.clock.T = 12345;
  o.at();
  ok(before.every((v, i) => v === o.pos[i]), 'a ring stands still');
  const k = OpenedSystem.open(sys('kessel'), SYSTEMS, null);
  ok(k.layout === 'ring' && k.bodies.length === 2, 'Kessel, a system that is only its zone, is its sun and its one world');
}

// ---------------------------------------------------------------- 5. the band in the sky is the map's disc, seen from the system's place
{
  let n = 0;
  for (const g of GALAXY_SYSTEMS) {
    const at = systemPlace(g);
    for (const w of worldsOf(g)) {
      const p = nightPlaceOf(w.planet.id).placeOf();
      ok(p.x === at.x && p.y === at.y && p.z === at.z, `${w.planet.id}: its night sky's band is baked from ${g.id}'s place on the map, where the opened system stands`);
      n++;
    }
  }
  ok(n >= 12, `${n} worlds' bands from their systems' places`);
  const view = text('src/ui/galaxyView.ts');
  ok(view.includes('sys.open(opened, g.at, wear);') && view.includes('this.orbit.centreOn(g.at.x, g.at.y, g.at.z);'), "the opened system stands at its globe's place in the galaxy (`systemPlace`), the view centred there");
  ok(view.includes('sys.fadeDisc(this.disc.material as THREE.PointsMaterial);') && /const drawn = sampleDisc\(n, 20030626\);/.test(view), 'and the disc it fades into a backdrop is the one `sampleDisc` draws out of the band\'s density');
}

// ---------------------------------------------------------------- 6. what each body wears, baked behind the screen
{
  const was = SKY_BODIES.file;
  const gen = (recipe: string, seed: number, extra: Record<string, unknown> = {}) => ({ name: recipe, generated: { recipe, seed, dials: {}, size: 1024, ...extra }, layers: {}, adjust: {} });
  const c = cleanBodiesFile({
    version: 1,
    looks: { 'g:naboo': gen('terran', 3), 'g:rori': gen('living', 5), 'g:tat': gen('desert', 7, { rings: { style: 'icy', dials: { inner: 1.5, outer: 2.4 } } }), 'g:prime': gen('gasgiant', 9) },
    uses: { 'rori:celestial:cels_naboo': 'g:naboo', 'naboo:moon': 'g:rori', 'space_tatooine:planet_tatooine': 'g:tat', 'yavin4:celestial:yavin_prime': 'g:prime' },
    systems: { naboo: draftSystem('naboo'), tatoo: draftSystem('tatoo'), yavin: draftSystem('yavin') },
  });
  SKY_BODIES.file = c.file;
  const nb = OpenedSystem.open(sys('naboo'), c.file!.systems, 'rori');
  const naboo = nb.bodies.find((b) => b.id === 'naboo')!;
  const rori = nb.bodies.find((b) => b.id === 'rori')!;
  ok(systemBodyLook(naboo, naboo.ground)?.id === 'g:naboo' && systemBodyLook(rori, rori.ground)?.id === 'g:rori', "a body wears the look its places wear (Naboo as Rori's sky shows it, Rori as Naboo's)");
  const tat = OpenedSystem.open(sys('tatoo'), c.file!.systems, null).bodies.find((b) => b.id === 'tatooine')!;
  const tatLook = systemBodyLook(tat, tat.ground);
  ok(tatLook?.id === 'g:tat', 'a ground world with no place of its own wears the look its zone\'s planet wears in space');
  const rings = lookRingsOf(tatLook!.look);
  ok(!!rings && rings.style === 'icy' && Number(rings.dials.inner) === 1.5, "and its rings come from the look's own `rings` part");
  ok(lookRingsOf(systemBodyLook(naboo, naboo.ground)!.look) === null, 'a look with no rings wears none');
  const starts = Object.fromEntries((RING_DIALS as { k: string; def: unknown }[]).map((d) => [d.k, d.def]));
  const view = text('src/ui/galaxySystemView.ts');
  ok(view.includes(`Number(d.inner) || ${starts.inner}`) && view.includes(`Number(d.outer) || ${starts.outer}`) && view.includes(`: ${starts.opacity};`) && view.includes(`'${starts.colour1}'`) && view.includes(`'${starts.colour2}'`), "a ring's missing dial takes the viewer's own start (`partdials.js`)");
  ok(systemLooks().map((h) => h.id).sort().join() === 'g:naboo,g:prime,g:rori,g:tat', "the bakes' list: every look the applied systems' bodies wear, once each");
  ok(systemBodyRim('planet', 'naboo', null) !== null && systemBodyRim('moon', null, null) === null && systemBodyRim('giant', null, null) !== null, 'a ground world takes its own air for its rim, a giant its kind\'s, a moon none');
  // The bakes, with a stand-in for the runtime's: each look baked once at 1024 behind the screen, halved to the opened system's size.
  const baked: string[] = [];
  const released: string[] = [];
  const fake = (w: number) => ({ id: 'x', key: 'k', width: w, height: w / 2, surface: new Uint8Array(w * (w / 2) * 4).fill(200), clouds: null, how: 'baked' as const });
  const had = { webgpu: GPU.webgpu, rt: GPU.rt };
  (GPU as { webgpu: boolean }).webgpu = true;
  // (the fixer of wave 5) the stand-in asks a kit for each look it bakes first, and puts off one it may not ask for, as the runtime's does
  const kits = new Set<unknown>();
  const later = new Set<unknown>();
  let systemAsks = 0;
  (GPU as { rt: unknown }).rt = {
    looks: {
      beginScreen() {},
      askLater: () => {
        for (const l of later) kits.add(l);
        const n = later.size;
        later.clear();
        return n;
      },
      // the globes' bakes are asked with three numbers, the systems' with `mayAsk` beside them
      bake: async (id: string, l: unknown, most: number, ...rest: boolean[]) => {
        const mayAsk = rest.length ? rest[0] : true;
        if (!kits.has(l)) {
          if (!mayAsk) {
            later.add(l);
            return null;
          }
          kits.add(l);
          if (rest.length) systemAsks++;
        }
        baked.push(`${id}@${most}`);
        return fake(most);
      },
      baked: () => null,
      release: (l: { name: string }) => released.push(l.name),
    },
  };
  {
    // The opened systems' looks ask no kit under a screen: put off, their kits asked as the screen goes, baked at the next.
    await bakeMapLooks(() => false);
    const first = { had: MAP_LOOKS.bodiesHad, putOff: MAP_LOOKS.bodiesPutOff, later: later.size };
    const asked = (GPU.rt as unknown as { looks: { askLater(): number } }).looks.askLater();
    await bakeMapLooks(() => false);
    ok(systemAsks === 0 && first.putOff > 0 && first.had + first.putOff === MAP_LOOKS.bodies && first.later > 0 && asked === first.later && MAP_LOOKS.bodiesHad === MAP_LOOKS.bodies, `the systems' looks ask no kit under a screen (${first.putOff} of ${MAP_LOOKS.bodies} put off, ${first.had} had, ${asked} kits asked as it went), and are all baked behind the next`);
  }
  ok(MAP_LOOKS.bodies === 4 && MAP_LOOKS.bodiesHad === 4 && baked.filter((b) => b.endsWith('@1024')).length >= 4, `behind the screens every body's look is baked at 1024 (${MAP_LOOKS.bodies} looks)`);
  const p = systemBodyPictures(tatLook!);
  ok(!!p && p.width === SYSTEM_VIEW_TUNE.bodySize && p.height === SYSTEM_VIEW_TUNE.bodySize / 2, `and halved to ${SYSTEM_VIEW_TUNE.bodySize} by ${SYSTEM_VIEW_TUNE.bodySize / 2} for the map, the bake's own let go`);
  baked.length = 0;
  await bakeMapLooks(() => false);
  ok(baked.length === 0 && MAP_LOOKS.bodiesHad === 4, 'the next screen bakes nothing: the halved pictures are kept');
  (GPU as { webgpu: boolean }).webgpu = had.webgpu;
  (GPU as { rt: unknown }).rt = had.rt;
  SKY_BODIES.file = was;
}

// ---------------------------------------------------------------- 7. WebGL keeps its galaxy; the programs are warmed with the map's own
{
  const view = text('src/ui/galaxyView.ts');
  ok(/this\.system = withLooks \? new SystemDraw\(/.test(view), "the opened system's pool is made with the game on WebGPU alone (null on WebGL, where no system opens)");
  ok(/if \(sys\) sys\.showForCompile\(true\);\n\s+renderer\.compile\(this\.scene, this\.camera\);\n\s+if \(sys\) sys\.showForCompile\(false\);/.test(view), "one of each of its kinds is shown for the map's first frame's compile, so opening a system builds no program");
  const map = text('src/ui/galaxyMap.ts');
  ok(/if \(GPU\.webgpu && this\.picked\) this\.openSystem\(this\.picked\);/.test(map) && /private openSystem\(sys: GalaxySystemDef\): void \{\n\s+if \(!GPU\.webgpu\) return;/.test(map), 'a pick opens a system on WebGPU alone');
  ok(/if \(this\.onPick && this\.onPick\(id\)\) return;\n\s+this\.showSystem\(/.test(map), "the travel terminal's borrowed view keeps its first refusal on a pick");
  const sv = text('src/ui/galaxySystemView.ts');
  const code = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const frame = code(/\n {2}frame\(camera[\s\S]*?\n {2}\}\n/.exec(sv)?.[0] ?? '');
  const fade = code(/\n {2}fadeDisc\([\s\S]*?\n {2}\}\n/.exec(sv)?.[0] ?? '');
  const rings = code(/\n {2}private ringOver\([\s\S]*?\n {2}\}\n/.exec(sv)?.[0] ?? '');
  ok(!!frame && !!fade && !!rings && !/\bnew\b|=>|\[\.\.\.|\.map\(|\.filter\(|`/.test(frame + fade + rings), 'the frame makes no object, no closure and no string');
  ok(!/\.set\(|\.setScalar\(|transformDirection|\.project\(|\.value = /.test(frame + rings), "and hands no number to a setter of three's: each written into its field (`testing.md`)");
  ok(!/import\(/.test(sv) && /GPU\.rt\?\.mapRings\(/.test(sv), "a look's rings come through the WebGPU runtime (`mapRings`), never a module of that side imported here");
  ok(!/\bnew THREE\.\w*Material\b/.test(/\n {2}open\(opened[\s\S]*?\n {2}\}\n/.exec(sv)?.[0] ?? 'x') && (sv.match(/systemGlobeMaterial\(blank, this\.cloudTurn\)/g) ?? []).length === 1, 'an opening lays pictures and numbers on the pool and makes no material');
  // The two programs of its own, read for what a compiler refuses (node compiles no GLSL).
  for (const name of ['galaxy system globe', 'galaxy system ring']) {
    const at = sv.indexOf(`name: '${name}'`);
    const block = sv.slice(at, sv.indexOf('\n  });\n}', at));
    const vs = /vertexShader: \/\* glsl \*\/ `([\s\S]*?)`/.exec(block)?.[1] ?? '';
    const fs = /fragmentShader: \/\* glsl \*\/ `([\s\S]*?)`/.exec(block)?.[1] ?? '';
    const declared = new Set([...block.matchAll(/^\s{6}(u\w+):/gm)].map((m) => m[1]));
    for (const [stage, src] of [['vertex', vs], ['fragment', fs]] as const) {
      ok(!!src && redeclared(src).length === 0 && reservedWords(src).length === 0 && unbalanced(src) === '' && undefinedCalls(src).filter((c) => !/^(texture2D|normalize|length|clamp|mix|max|abs|pow|dot|vec2|vec3|vec4|mat3)$/.test(c)).length === 0, `${name}: its ${stage} stage reads as GLSL a compiler takes`);
      const missing = uniformNames(src).filter((u) => !declared.has(u));
      ok(missing.length === 0, `${name}: every uniform its ${stage} stage reads its material declares${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
    }
  }
  // The ring's shadow: a point of the ring is shaded where the way from it to the star passes through the body.
  ok(sv.includes('float b = dot(oc, uLightDir);') && sv.includes('float sh = (b < 0.0 && b * b - c > 0.0) ? 1.0 : 0.0;'), "a ring takes its body's shadow where the way to the star meets the body");
}

console.log(`\ngalaxySystem: ${checks} checks passed`);

// The world editor's aim (DESIGN.md §2.3): a ray against a turned, placed, scaled box agrees with a brute-force sampled
// test over 10,000 random boxes and rays; the terrain march finds the first crossing within 0.2 m on a synthetic height
// field; the candidates are taken in `AIM_ORDER`'s order, the frame's own aim included; the region walk reads
// `regionsByNumber`, and the real streamer's walk visits exactly the regions a diagonal rectangle touches and one round
// them, its boxes are the models' own (none for an effect), and the engine's own cast (`Physics.aimHit`) leaves the
// ground and the shells out indoors; and the editor's own frame (the pointer, the aim's box walk, the hover) makes under
// 0.1 bytes a frame, measured in processes of its own with the engine's cast and the terrain stood in
// (`editorAllocOwn.ts`), twelve at once, each asserted, a child that crashes or prints nothing readable a failure.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AIM_ORDER, EditorAim, marchSurface, rayTurnedBox, resolveAim, type AimRay, type AimSample, type StillHit } from '../../../src/editor/aim.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A seeded generator, so a failure is the same failure every run.
let seed = 0x2545f491;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};

// ---- A ray against a turned box, against brute force. ----
{
  const RAYS = 10_000;
  const STEP = 0.02;
  let disagree = 0;
  let hits = 0;
  let worstEntry = 0;
  for (let i = 0; i < RAYS; i++) {
    const min = [-(0.2 + rand() * 3), -(0.2 + rand() * 3), -(0.2 + rand() * 3)];
    const max = [0.2 + rand() * 3, 0.2 + rand() * 3, 0.2 + rand() * 3];
    // Either corner may come first (the BOX lesson): half the boxes are handed over swapped.
    const swap = rand() < 0.5;
    const bmin = swap ? max : min;
    const bmax = swap ? min : max;
    const p = [rand() * 20 - 10, rand() * 6, rand() * 20 - 10];
    // A random unit quaternion.
    let qx = rand() * 2 - 1;
    let qy = rand() * 2 - 1;
    let qz = rand() * 2 - 1;
    let qw = rand() * 2 - 1;
    const qn = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    qx /= qn;
    qy /= qn;
    qz /= qn;
    qw /= qn;
    const s = rand() < 0.5 ? 1 : 0.5 + rand() * 1.5;
    const o = [rand() * 40 - 20, rand() * 10 - 2, rand() * 40 - 20];
    // Aimed near the box most of the time, so many rays meet it.
    let dx = p[0] + rand() * 4 - 2 - o[0];
    let dy = p[1] + rand() * 4 - 2 - o[1];
    let dz = p[2] + rand() * 4 - 2 - o[2];
    const dn = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= dn;
    dy /= dn;
    dz /= dn;
    const reach = 60;
    const t = rayTurnedBox(o[0], o[1], o[2], dx, dy, dz, p[0], p[1], p[2], qx, qy, qz, qw, bmin, bmax, s, reach);
    // Brute force: sample along the ray, each point turned back into the box's frame and tested strictly inside.
    const inside = (x: number, y: number, z: number): boolean => {
      // v' = q⁻¹ (v - p) / s
      const vx = x - p[0];
      const vy = y - p[1];
      const vz = z - p[2];
      const cx = -qx;
      const cy = -qy;
      const cz = -qz;
      const tx = 2 * (cy * vz - cz * vy);
      const ty = 2 * (cz * vx - cx * vz);
      const tz = 2 * (cx * vy - cy * vx);
      const lx = (vx + qw * tx + (cy * tz - cz * ty)) / s;
      const ly = (vy + qw * ty + (cz * tx - cx * tz)) / s;
      const lz = (vz + qw * tz + (cx * ty - cy * tx)) / s;
      const e = 1e-9;
      return lx > min[0] + e && lx < max[0] - e && ly > min[1] + e && ly < max[1] - e && lz > min[2] + e && lz < max[2] - e;
    };
    let first = Infinity;
    let count = 0;
    for (let u = 0; u <= reach; u += STEP) {
      if (inside(o[0] + dx * u, o[1] + dy * u, o[2] + dz * u)) {
        if (first === Infinity) first = u;
        count++;
      }
    }
    if (t === Infinity) {
      if (count > 0) disagree++;
    } else {
      hits++;
      // A chord thinner than two samples may slip between them; any longer one must be found where the ray says.
      if (count >= 2) {
        const err = first - t;
        worstEntry = Math.max(worstEntry, Math.abs(err));
        if (err < -1e-6 || err > STEP + 1e-6) disagree++;
      }
    }
  }
  ok(disagree === 0, `a ray against a turned, placed and scaled box agrees with brute-force sampling over ${RAYS} rays (${hits} meet it, worst entry ${worstEntry.toFixed(4)} m off a ${STEP} m sample)`);
  ok(hits > RAYS / 4 && hits < RAYS, 'and the sample holds rays that meet and rays that miss');
  ok(rayTurnedBox(0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, [-1, -1, -1], [1, 1, 1], 1, 10) === 0, 'a ray starting inside the box meets it at nought');
}

// ---- The terrain march. ----
{
  const ground = (x: number, z: number) => 3 * Math.sin(x * 0.05) + 2 * Math.cos(z * 0.08) + 0.5 * Math.sin(x * 0.31 + z * 0.17);
  const none = () => -Infinity;
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const ox = rand() * 200 - 100;
    const oz = rand() * 200 - 100;
    const oy = 20 + rand() * 40;
    const a = rand() * Math.PI * 2;
    const down = 0.1 + rand() * 0.8;
    let dx = Math.cos(a);
    let dz = Math.sin(a);
    let dy = -down;
    const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= n;
    dy /= n;
    dz /= n;
    const out = { t: Infinity, water: false };
    marchSurface(ox, oy, oz, dx, dy, dz, 2000, 4, 0.05, ground, none, out);
    // The true first crossing, by a fine walk.
    let truth = Infinity;
    for (let u = 0; u < 2000; u += 0.002) {
      if (oy + dy * u <= ground(ox + dx * u, oz + dz * u)) {
        truth = u;
        break;
      }
    }
    if (truth < Infinity) worst = Math.max(worst, Math.abs(out.t - truth));
    else assert.ok(out.t === Infinity, 'a ray that never comes down finds nothing');
  }
  ok(worst < 0.2, `the terrain march finds the first crossing within 0.2 m on a synthetic height field (worst ${worst.toFixed(3)} m over 300 rays)`);
  const water = { t: Infinity, water: false };
  marchSurface(0, 10, 0, 0.6, -0.8, 0, 200, 4, 0.05, () => 0, () => 2, water);
  ok(water.water && Math.abs(water.t - 10) < 0.1, 'the drawn water standing over the ground is met as water');
  const unknown = { t: Infinity, water: false };
  marchSurface(0, 10, 0, 0.6, -0.8, 0, 200, 4, 0.05, () => Number.NaN, () => -Infinity, unknown);
  ok(unknown.t === Infinity, 'where no block is cached, nothing is met (a frame never generates one)');
}

// ---- The candidates' order. ----
{
  const out = { kind: 'sky' as (typeof AIM_ORDER)[number], t: 0 };
  ok(AIM_ORDER.join(',') === 'handle,box,still,water,terrain,sky', 'the order is the handles, the boxes, what stands still, the water, the terrain, the sky');
  resolveAim({ handle: 5, box: 5, still: 5, water: 5, terrain: 5 }, 40, out);
  ok(out.kind === 'handle', 'two at one distance: the handle first');
  resolveAim({ handle: Infinity, box: 5, still: 5, water: 5, terrain: 5 }, 40, out);
  ok(out.kind === 'box', 'then the box');
  resolveAim({ handle: Infinity, box: Infinity, still: 5, water: 5, terrain: 5 }, 40, out);
  ok(out.kind === 'still', 'then what stands still');
  resolveAim({ handle: Infinity, box: Infinity, still: Infinity, water: 5, terrain: 5 }, 40, out);
  ok(out.kind === 'water', 'then the water before the terrain');
  resolveAim({ handle: Infinity, box: Infinity, still: Infinity, water: Infinity, terrain: Infinity }, 40, out);
  ok(out.kind === 'sky' && out.t === 40, 'and with nothing met, the sky at its reach');
  resolveAim({ handle: Infinity, box: 9, still: 3, water: Infinity, terrain: 1 }, 40, out);
  ok(out.kind === 'terrain' && out.t === 1, 'the nearest wins whatever its kind');

  // The frame's own aim over stand-in ports: a row's box in front of a wall is what the aim rests on, a row behind
  // the wall is not walked to, and the sky answers where nothing is met.
  interface Thing {
    x: number;
    y: number;
    z: number;
    q: { x: number; y: number; z: number; w: number };
    template: string;
  }
  const things: Thing[] = [];
  const walls = { at: 10 };
  const aim = new EditorAim<Thing>(
    {
      cast(r: AimRay, _inside: boolean, hit: StillHit): boolean {
        if (walls.at > r.len) return false;
        hit.toi = walls.at;
        hit.nx = 0;
        hit.ny = 0;
        hit.nz = -1;
        hit.handle = 3;
        return true;
      },
      sample(p: AimSample): void {
        p.ground = -50;
        p.water = -Infinity;
      },
      walk(_rect, visit) {
        for (const t of things) if (!visit(t)) return;
      },
    },
    () => ({ min: [-1, -1, -1], max: [1, 1, 1] }),
    (o) => o.template.startsWith('place/'),
  );
  const ask = { inside: false, space: false, skyReach: 40, now: 0 };
  const tune = { reach: 2000, marchStep: 4, marchTol: 0.05 };
  const hover = { most: 5000, hz: 15 };
  const r = aim.ray;
  r.ox = 0;
  r.oy = 0;
  r.oz = 0;
  r.dx = 0;
  r.dy = 0;
  r.dz = 1;
  things.push({ x: 0, y: 0, z: 5, q: { x: 0, y: 0, z: 0, w: 1 }, template: 'place/front' }, { x: 0, y: 0, z: 15, q: { x: 0, y: 0, z: 0, w: 1 }, template: 'place/behind' });
  ok(aim.step(ask, tune, hover) === 'box' && aim.hover?.template === 'place/front' && Math.abs(aim.hit.z - 4) < 1e-9, 'a row\'s box in front of a wall is what the aim rests on, at its face');
  things.shift();
  ok(aim.step(ask, tune, hover) === 'still' && aim.hover === null && aim.hit.z === 10, 'one behind the wall is never walked to: the wall answers');
  walls.at = Infinity;
  things.length = 0;
  ok(aim.step(ask, tune, hover) === 'sky' && aim.hit.z === 40, 'and with nothing met, the point stands at the sky\'s reach');
}

// ---- The region walk reads `regionsByNumber`. ----
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', '..', '..', 'src', 'world', 'layoutStream.ts'), 'utf8').replace(/\r\n/g, '\n');
  const at = src.indexOf('  forEachPlacedIn(rect:');
  const body = src.slice(at, src.indexOf('\n  }\n', at));
  ok(at > 0 && body.includes('this.regionsByNumber.get(regionNumber(rx, rz))') && !body.includes('this.regions.get('), "the aim's region walk reads `regionsByNumber`, never the string-keyed map");
}

// ---- The real streamer's walk and box, and the engine's own cast, in a real physics world. ----
{
  const { makeStreamer, groups, Group, THREE } = await import('./streamHarness.ts');
  const { RAPIER } = await import('../../../src/core/physics.ts');
  const PUFF = { id: 'puff', file: 'puff.glb', bounds: { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: 0, particle: true };
  const h = await makeStreamer(undefined, { defs: [PUFF as never] });
  // Things filed by their middles in regions of 256 m: the walk takes every region the rectangle touches and one more
  // round it either way (for a thing whose middle is just over the edge), and nothing past that.
  const spots: [string, number, number, boolean][] = [
    ['in-a', 100, 100, true],
    ['in-b', 400, 50, true],
    ['edge-lo', -20, 150, true],
    ['edge-hi', 600, 290, true],
    ['out-lo', -300, 100, false],
    ['out-hi', 800, 100, false],
    ['out-z', 100, 800, false],
  ];
  for (const [key, x, z] of spots) void h.put(`aimtest/${key}`, 'crate', x, z);
  const seen = new Set<string>();
  // The rectangle handed over corner-wise, as a ray down-left gives it: the walk takes the least and the most itself.
  h.stream.forEachPlacedIn({ x0: 300, z0: 10, x1: 10, z1: 300 }, (o) => {
    if (o.template.startsWith('aimtest/')) seen.add(o.template.slice(8));
    return true;
  });
  const want = spots.filter((s) => s[3]).map((s) => s[0]);
  ok(want.every((k) => seen.has(k)) && seen.size === want.length, `the walk over a diagonal rectangle visits exactly the regions it touches and one round them (${[...seen].sort().join(', ')})`);
  let stops = 0;
  h.stream.forEachPlacedIn({ x0: 10, z0: 10, x1: 300, z1: 300 }, () => {
    stops++;
    return false;
  });
  ok(stops === 1, 'and answering false stops it at once');
  const crate = h.stream.placedOf('aimtest/in-a');
  const cb = crate ? h.stream.boxOf(crate) : null;
  ok(!!cb && Math.abs(cb.max[1] - cb.min[1]) === 1, "a placed thing's box is its own model's box");
  h.stream.place({ model: 'puff', template: 'aimtest/puff', x: 120, y: 0, z: 120, q: new THREE.Quaternion(), radius: 1 });
  const puff = h.stream.placedOf('aimtest/puff');
  ok(!!puff && h.stream.boxOf(puff) === null, 'and a particle effect has none: it is under the aim of nothing');

  // The engine's cast: indoors the ground and a building's shell are left out, a room's own wall answers both ways.
  const w = h.physics.world;
  const make = (hx: number, hy: number, hz: number, x: number, y: number, z: number, member: number) => w.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(groups(member, Group.all)));
  make(50, 0.5, 50, 3000, -0.5, 0, Group.terrain);
  make(0.2, 3, 5, 3005, 3, 0, Group.interior);
  make(0.2, 3, 5, 2995, 3, 0, Group.exterior);
  h.physics.stepOnce();
  const hit = { toi: 0, nx: 0, ny: 0, nz: 0, handle: -1 };
  ok(h.physics.aimHit(3000, 10, 0, 0, -1, 0, 50, false, hit) && Math.abs(hit.toi - 10) < 1e-3 && hit.ny > 0.99, `out of doors the cast meets the ground, its normal up (${hit.toi.toFixed(3)} m)`);
  ok(!h.physics.aimHit(3000, 10, 0, 0, -1, 0, 50, true, hit), 'indoors it passes the ground by');
  ok(h.physics.aimHit(3000, 2, 0, 1, 0, 0, 50, true, hit) && Math.abs(hit.toi - 4.8) < 1e-3 && h.physics.aimHit(3000, 2, 0, 1, 0, 0, 50, false, hit) && Math.abs(hit.toi - 4.8) < 1e-3, `a room's own wall answers indoors and out (${hit.toi.toFixed(3)} m)`);
  ok(!h.physics.aimHit(3000, 2, 0, -1, 0, 0, 50, true, hit) && h.physics.aimHit(3000, 2, 0, -1, 0, 0, 50, false, hit) && Math.abs(hit.toi - 4.8) < 1e-3, "and a building's shell only out of doors");
  ok(!h.physics.aimHit(3000, 10, 0, 0, -1, 0, 5, false, hit), 'nothing past the reach it is handed');
}

// ---- What the editor's own frame makes, twelve processes at once. ----
{
  const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
  // A child that crashed, or printed something that does not read, is a failure: only the child's own word that it has
  // no `--expose-gc` (`{ skipped }`, which this run always passes) is a skip.
  const run = () =>
    new Promise<{ frames: number; made: number; scavenges: number; tested: number; hovered: number; skipped?: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) {
          const lines = err.trim().split('\n');
          reject(new Error(`the allocation child exited ${code}: ${lines.find((l) => /Error/.test(l))?.trim() ?? lines.pop() ?? line}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const all = await Promise.all(Array.from({ length: 12 }, run));
  const skipped = all.find((a) => a.skipped);
  if (skipped) console.log(`note the allocation measure was skipped: ${skipped.skipped}`);
  else {
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      ok(a.scavenges === 0 && a.made < 0.1 * a.frames, `process ${i + 1} of 12: the editor's own frame (the pointer's events, the aim, ${a.tested} boxes walked, the hover on ${a.hovered} frames) makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${(Math.max(0, a.made) / a.frames).toFixed(3)} a frame, ${a.scavenges} collections)`);
    }
  }
}

console.log(`\n${checks} checks passed`);

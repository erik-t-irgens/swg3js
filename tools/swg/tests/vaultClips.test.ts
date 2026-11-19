// Climbing II, phase 6: the vault, dive and clamber clips' table (src/anim/vaultClips.ts) held to the clips themselves: each
// measured again on the human male through the pack (`MixamoPack.clipsFor`, the rig's own `sampleJoints`, the level ramp put
// back) by the table's own rule (`measureVault`), its moments within one of the clip's own frames, its places within a centimetre,
// the clamber's own moments the owner's (and the measure's beside them, within two frames of his, both reported); `jumping_2`
// `jumping_1`'s very file; the path's anchors the hips at each moment, never falling back; the path's inverse its inverse; and
// every clip asked of the pack the game fits (`browserIo`'s `also`, pinned as text). With the human male not converted here, the
// measure is noted and skipped; the table's own checks still run.
//
// Run: node tools/swg/tests/vaultClips.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';

const charStub = 'export class Character { static async load() { throw new Error("no pack in a test"); } }';
const hook = `import { existsSync } from 'node:fs';
export async function resolve(s, c, next) {
  if (s === './character' || s === './character.ts' || s.endsWith('/player/character') || s.endsWith('/player/character.ts')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  if (s.startsWith('.') && !/\\.[a-z]+$/.test(s) && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(s + '.ts', c);
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const THREE = await import('three');
const { CharacterRig } = await import('../../../src/player/rig.ts');
const { MixamoPack } = await import('../../../src/anim/mixamoPack.ts');
const { VAULT_CLAMBER, VAULT_CLIP_NAMES, VAULT_DIVE, VAULT_FACTS, VAULT_IDS, VAULT_OVER, measureVault, vaultPathAt, vaultPathOf, vaultRampAt, vaultTimeAt } = await import('../../../src/anim/vaultClips.ts');
const { VAULT_REACH } = await import('../../../src/player/vault.ts');
const { glbSkeleton, speciesBodies } = await import('./animFixtures.ts');
const { REPO } = await import('./oldModules.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const text = (rel: string) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');

// ---- the table's own -------------------------------------------------------------------------------------------------------------
{
  ok(VAULT_IDS.length === 5 && ['jumping', 'jumping_1', 'jumping_2', 'jump_over', 'running_jump'].every((id) => VAULT_IDS.includes(id)), "the five clips of the owner's folder the brief names are the table's");
  ok(VAULT_OVER.join() === 'jumping,jumping_1,jumping_2' && VAULT_DIVE === 'jump_over' && VAULT_CLAMBER === 'running_jump', 'the vaults, the dive and the clamber are each its clip');
  ok(VAULT_IDS.every((id) => VAULT_CLIP_NAMES[id] === `mx_${id}`), "each clip's rig name is the pack's own (`mx_`), made once");
  ok(JSON.stringify(VAULT_FACTS.jumping_2) === JSON.stringify(VAULT_FACTS.jumping_1), '`jumping_2` is `jumping_1` (its file is the same file, the import\'s own hash), never chosen over its twin');
  const index = JSON.parse(readFileSync(join(REPO, 'public', 'anims', 'mixamo', 'index.json'), 'utf8')) as { clips: { id: string; hash: string; duration: number }[] };
  const row = (id: string) => index.clips.find((c) => c.id === id)!;
  ok(VAULT_IDS.every((id) => !!row(id)), 'every clip is in the pack already (nothing imported)');
  ok(row('jumping_1').hash === row('jumping_2').hash, `the pack's own hash for both is ${row('jumping_1').hash}`);
  ok(VAULT_IDS.every((id) => Math.abs(row(id).duration - VAULT_FACTS[id].dur) < 1e-3), "each clip's length is the pack's own");
  ok(
    VAULT_IDS.every((id) => {
      const f = VAULT_FACTS[id];
      for (let i = 1; i < f.pathT.length; i++) if (!(f.pathT[i] > f.pathT[i - 1]) || f.pathZ[i] < f.pathZ[i - 1]) return false;
      return f.pathT[0] === 0 && Math.abs(f.pathT[f.pathT.length - 1] - f.dur) < 1e-3;
    }),
    "each path runs from the clip's start to its end, its times rising and its places never falling back",
  );
  ok(VAULT_IDS.every((id) => [0.1, 0.33, 0.5, 0.71, 0.9].every((u) => {
    const f = VAULT_FACTS[id];
    const t = u * f.dur;
    return Math.abs(vaultTimeAt(f, vaultPathAt(f, t)) - t) < 1e-9;
  })), "the path's inverse takes each place back to its time");
  ok(VAULT_IDS.every((id) => Math.abs(vaultRampAt(VAULT_FACTS[id], VAULT_FACTS[id].dur) - VAULT_FACTS[id].net) < 1e-12 && vaultRampAt(VAULT_FACTS[id], 0) === 0), "the ramp the pack strips is the clip's level travel spread straight over its length");
  const f = VAULT_FACTS[VAULT_CLAMBER];
  ok(f.touch === 0.5 && f.lift === 0.73 && f.land === 1.07, "the clamber's moments are the owner's: a hand on the top at 0.50 s, a foot at 0.73 s, the second foot at 1.07 s (its cut)");
  const reach = Math.max(...VAULT_IDS.map((id) => (VAULT_FACTS[id].kind === 'dive' ? VAULT_FACTS[id].apexZ : VAULT_FACTS[id].handZ) - VAULT_FACTS[id].pathZ[0]));
  ok(VAULT_REACH === reach && reach > 4, `the furthest ahead any clip starts is the dive's apex, ${reach.toFixed(3)} m from its start (what the face rays reach for)`);
  ok(text('src/anim/mixamoPack.ts').includes('.concat(POLE_IDS, VAULT_IDS)'), "the pack the game fits asks for every vault clip (`browserIo`'s `also`)");
}

// ---- measured again on the human male --------------------------------------------------------------------------------------------
const body = speciesBodies(REPO).find((x) => x.id === 'human_male');
if (!body || !existsSync(body.body)) note('the human male is not converted here: the clips are not measured again');
else {
  const target = glbSkeleton(body.body);
  const packDir = join(REPO, 'public', 'anims', 'mixamo');
  const pack = new MixamoPack({
    enabled: () => true,
    index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
    clip: async (file: string) => {
      const b = readFileSync(join(packDir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    breath: async () => {},
    also: [...VAULT_IDS],
    now: () => performance.now(),
  });
  const info = console.info;
  console.info = () => {};
  const clips = await pack.clipsFor(target as never, 'vaults');
  console.info = info;
  const fit = [...(pack as unknown as { fits: Map<string, { plan: { scale: number } }> }).fits.values()][0];
  const scale = fit.plan.scale;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.fromArray(target.base.p);
  inner.quaternion.fromArray(target.base.q);
  root.add(inner);
  const bones: InstanceType<typeof THREE.Bone>[] = [];
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    bones.push(b);
    (j.parent < 0 ? inner : bones[j.parent]).add(b);
  });
  const rig = CharacterRig.fromCharacter({ group: root, clips } as never);
  const index = JSON.parse(readFileSync(join(packDir, 'index.json'), 'utf8')) as { clips: { id: string; travelNet: number[] }[] };
  const J = ['', 'lWrist', 'lIndex01', 'rWrist', 'rIndex01', 'lAnkle', 'rAnkle'];
  const frame = 1 / 30;
  for (const id of VAULT_IDS) {
    const name = VAULT_CLIP_NAMES[id];
    const d = rig.clipDuration(name);
    if (d === null) {
      ok(false, `${id} is on the rig`);
      continue;
    }
    const n = Math.round(d * 30) + 1;
    const times = new Float64Array(n);
    for (let i = 0; i < n; i++) times[i] = Math.min(d, i / 30);
    const out = new Float64Array(n * J.length * 3);
    rig.sampleJoints(name, J, times, out);
    const row = index.clips.find((c) => c.id === id)!;
    const netX = row.travelNet[0] * scale;
    const netZ = row.travelNet[2] * scale;
    const pick = (j: number, ix?: number) => {
      const a = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
          let v = out[(i * J.length + j) * 3 + k];
          if (ix !== undefined) v = (v + out[(i * J.length + ix) * 3 + k]) / 2;
          if (k === 0) v += (netX * times[i]) / d;
          if (k === 2) v += (netZ * times[i]) / d;
          a[i * 3 + k] = v;
        }
      }
      return a;
    };
    const hips = pick(0);
    const f = VAULT_FACTS[id];
    const clamber = f.kind === 'clamber';
    const m = measureVault({ dt: frame, kind: f.kind, hips, lh: pick(1, 2), rh: pick(3, 4), la: pick(5), ra: pick(6), net: netZ }, clamber ? f.touch : 0);
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
    const tT = frame + 1e-3;
    ok(near(m.net, f.net, 0.005) && near(d, f.dur, 1e-3), `${id}: its length ${d.toFixed(3)} s and level travel ${m.net} m are the table's`);
    ok(near(m.leave, f.leave, tT) && near(m.apex, f.apex, tT), `${id}: its feet leave the ground at ${m.leave} s and its hips stand highest at ${m.apex} s, as the table has them`);
    if (clamber) {
      ok(near(m.touch, f.touch, 2 * frame + 1e-3), `${id}: the measure's hand on the top at ${m.touch} s, within two frames of the owner's ${f.touch} s (his wins)`);
      note(`${id}: the measure's own moments beside the owner's: touch ${m.touch} (his 0.50), its hand's rest then its feet's on the top (his 0.73 and 1.07)`);
      ok(near(m.top, f.top, 0.01) && near(m.face, f.face, 0.01), `${id}: the top it climbs ${m.top} m and its face ${m.face} m along its travel are the table's`);
    } else ok(near(m.touch, f.touch, tT) && near(m.lift, f.lift, tT) && near(m.land, f.land, tT), `${id}: its hand on the ${f.kind === 'dive' ? 'ground beyond' : 'top'} at ${m.touch} s, off at ${m.lift} s, its feet down at ${m.land} s, as the table has them`);
    ok(near(m.hand, f.hand, 0.01) && near(m.handZ, f.handZ, 0.01) && near(m.apexZ, f.apexZ, 0.01) && near(m.leaveZ, f.leaveZ, 0.01) && (clamber || near(m.landZ, f.landZ, 0.01)), `${id}: its hand ${m.hand} m up at ${m.handZ} m along, its hips' highest at ${m.apexZ} m, its feet's take-off at ${m.leaveZ} m${clamber ? '' : ` and landing at ${m.landZ} m`}, the table's within a centimetre`);
    // The path: the hips along the travel at the clip's moments (a clamber's the owner's), made never to fall back.
    const hz = (t: number) => {
      const k = Math.min(n - 1, Math.max(0, t * 30));
      const k0 = Math.floor(k);
      const k1 = Math.min(n - 1, k0 + 1);
      return hips[k0 * 3 + 2] + (hips[k1 * 3 + 2] - hips[k0 * 3 + 2]) * (k - k0);
    };
    const mom = clamber ? [0, f.touch, m.leave, f.lift, f.land, d] : [0, m.leave, m.touch, m.lift, m.land, m.apex, d];
    const p = vaultPathOf(mom, hz);
    ok(p.t.length === f.pathT.length && p.t.every((t, i) => near(t, f.pathT[i], tT) && near(p.z[i], f.pathZ[i], 0.01)), `${id}: its path's anchors (the hips at its moments) are the table's`);
  }
}
console.log(`vaultClips: ${checks} checks passed`);

// Where a pod's and a bike's engine glows stand (src/vehicles/raceSpots.ts): the rule over invented pods shaped like the
// game's (two points a side at one place along the pod, three with one forward, points stacked on one another, one
// forward alone), never a sound or damage point, every point on a bike; that only a gallery def whose own kind races is
// given any, whatever it is spawned as; and, with the converted gallery present, the picks for the seven pods and
// Sebulba's, by name only (a place out of the game's files is never printed or kept). Invented numbers otherwise.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { ENGINE_POINT, glowShare, raceThrustersFor, racerThrusters, type EnginePoint } from '../../../src/vehicles/raceSpots.ts';
import { ENGINE_TUNE } from '../../../src/vehicles/drivetrain.ts';
import { VEHICLE_KINDS } from '../../../src/vehicles/vehicleKinds.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const p = (name: string, x: number, z: number): EnginePoint => ({ name, x, z });
const same = (a: string[], b: string[]) => a.length === b.length && a.every((n) => b.includes(n));

// --- the rule over invented pods --------------------------------------------------------------------------------------
{
  // Two engines, two points each at their rear (an upper and a lower exhaust), the cockpit far forward.
  const two = [p('engine_1', 2, -6), p('engine_2', 2.2, -6.1), p('engine_3', -2, -6), p('engine_4', -2.2, -6.1)];
  ok(same(racerThrusters(two, 'pod'), ['engine_1', 'engine_2', 'engine_3', 'engine_4']), 'two points a side at one place along the pod: all four glow');
  // Three a side, one of them far forward on the engine (an intake), which must not glow.
  const three = [p('engine_1', 2, -6), p('engine_2', 2, -5.5), p('engine_3', 2, 1), p('engine_4', -2, -6), p('engine_5', -2, -5.5), p('engine_6', -2, 1)];
  ok(same(racerThrusters(three, 'pod'), ['engine_1', 'engine_2', 'engine_4', 'engine_5']), 'three a side with one forward: the forward ones are left out');
  // The tolerance is the rule's own number: a point just inside it glows, just past it does not.
  const edge = [p('engine_1', 2, -6), p('engine_2', 2, -6 + ENGINE_TUNE.rearTolerance - 0.01), p('engine_3', 2, -6 + ENGINE_TUNE.rearTolerance + 0.01)];
  ok(same(racerThrusters(edge, 'pod'), ['engine_1', 'engine_2']), `within ${ENGINE_TUNE.rearTolerance} m of its side's rearmost glows, past it does not`);
  // Stacked: two points at one place (an engine's glow drawn twice) both glow.
  const stacked = [p('engine_1', 2, -6), p('engine_2', 2, -6), p('engine_3', -2, -6)];
  ok(same(racerThrusters(stacked, 'pod'), ['engine_1', 'engine_2', 'engine_3']), 'stacked points both glow');
  // Each side by its own rearmost: a long left engine and a short right one.
  const uneven = [p('engine_1', 2, -8), p('engine_2', 2, -2), p('engine_3', -2, -2), p('engine_4', -2, 3)];
  ok(same(racerThrusters(uneven, 'pod'), ['engine_1', 'engine_3']), "each side is judged by its own rearmost, not the pod's");
  // One point, forward of the middle: it is its side's rearmost and glows.
  ok(same(racerThrusters([p('engine_0', 1, 4)], 'pod'), ['engine_0']), 'one point alone glows, wherever it is');
  // Never a sound or a damage point, however far back.
  const noisy = [p('engine_1', 2, -6), p('engine_sound_1', 2, -9), p('engine_damage_1', -2, -9), p('engine_glow_1', -2, -9), p('engine', 0, -9)];
  ok(same(racerThrusters(noisy, 'pod'), ['engine_1']), 'never engine_sound, engine_damage or anything not a numbered engine point');
  ok(ENGINE_POINT.test('engine2') && ENGINE_POINT.test('ENGINE_3') && !ENGINE_POINT.test('engine_sound1'), 'engine2 and ENGINE_3 are engine points, engine_sound1 is not');
  // A bike: every engine point, front and back.
  ok(same(racerThrusters(three, 'bike'), ['engine_1', 'engine_2', 'engine_3', 'engine_4', 'engine_5', 'engine_6']), 'a bike: every engine point');
  ok(racerThrusters([p('player', 0, 0)], 'pod').length === 0, 'a model with none gives none (its glows stay at the rear of its box)');
  ok(glowShare(2) === 1 && Math.abs(glowShare(4) - 1 / Math.sqrt(2)) < 1e-12 && glowShare(1) === 1, 'the glow is the whole width shared by two; on four each is 1/sqrt(2) of it');
}

// --- which defs get them -------------------------------------------------------------------------------------------------
{
  const pts = [p('engine_1', 2, -6), p('engine_2', -2, -6)];
  ok(same(raceThrustersFor({ kind: 'podracer', source: 'gallery' }, pts, true) ?? [], ['engine_1', 'engine_2']), "a gallery pod's def is given its points");
  ok(same(raceThrustersFor({ kind: 'speederbike', source: 'gallery' }, pts, true) ?? [], ['engine_1', 'engine_2']), "a gallery bike's too");
  ok(raceThrustersFor({ kind: 'flyer', source: 'gallery' }, pts, true) === null, 'a hover car def never gets any, whatever it is spawned as (the spawned kind is not even asked)');
  ok(raceThrustersFor({ kind: 'ground', source: 'gallery' }, pts, true) === null && raceThrustersFor({ kind: 'ship', source: 'ship' }, pts, true) === null, 'nor a walker, nor a ship');
  ok(raceThrustersFor({ kind: 'podracer', source: 'creature' }, pts, true) === null, "nor anything that is not the gallery's");
  ok(raceThrustersFor({ kind: 'podracer', source: 'gallery' }, pts, false) === null, 'and nothing at all with the pass switched off');
  // The garage asks by the def and never by the kind it spawns as; a spawn as another kind therefore writes none.
  const garage = readFileSync(new URL('../../../src/vehicles/garage.ts', import.meta.url), 'utf8');
  ok(/raceThrustersFor\(def, def\.source === 'gallery' \? enginePoints\(model\) : \[\], RACE_TUNE\.on\)/.test(garage), '(garage.ts: the spawn asks raceThrustersFor of the def itself, with no word of the kind it is spawned as)');
  ok(/clearRaceThrusters\(\): number/.test(garage) && /delete d\.raceThrusters/.test(garage), '(garage.ts: switched off, every def\'s race thrusters are taken off again)');
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/if \(g && !RACE_TUNE\.on\) \{\n\s*const n = g\.clearRaceThrusters\(\);/.test(main), '(main.ts: and the console switching the pass off is what takes them off)');
}

// --- the converted gallery's seven pods -------------------------------------------------------------------------------------
{
  const root = process.env.SWG3JS_PACKS ?? new URL('../../../assets-private/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const galleryDir = join(root, 'gallery');
  if (!existsSync(join(galleryDir, 'gallery.json')) || !existsSync(join(galleryDir, 'manifest.json'))) note('no converted gallery: the seven pods\' picks are not read');
  else {
    const g = JSON.parse(readFileSync(join(galleryDir, 'gallery.json'), 'utf8')) as { sections: { id: string; items: { label: string; model: string }[] }[] };
    const m = JSON.parse(readFileSync(join(galleryDir, 'manifest.json'), 'utf8')) as { categories: { layout: { id: string; file: string }[] } };
    const items = g.sections.find((s) => s.id === 'vehicles')?.items ?? [];
    // What §7.2 of the design lists, by the names the pods carry.
    const want: Record<string, string[]> = {
      podracer_anakin: ['engine_1', 'engine_2'],
      pod_racer_one: ['engine_1', 'engine_2'],
      pod_racer_light_bending: ['engine_1', 'engine_2'],
      pod_racer_two: ['engine_1', 'engine_2', 'engine_3', 'engine_4'],
      pod_racer_balta_podracer: ['engine_1', 'engine_2', 'engine_3', 'engine_4'],
      pod_racer_ipg_longtail: ['engine_1', 'engine_2'],
      fg_8t8_podracer: ['engine_0', 'engine_1'],
      // Sebulba's pod, an exhibit of ours whose two points the converter makes (§7.2): picked as any pod's are.
      podracer_sebulba: ['engine_1', 'engine_2'],
    };
    const pods = items.filter((i) => VEHICLE_KINDS[i.label]?.kind === 'podracer');
    let read = 0;
    for (const item of pods) {
      const entry = m.categories.layout.find((e) => e.id === item.model);
      const file = entry ? join(galleryDir, entry.file) : '';
      if (!entry || !existsSync(file)) continue;
      const picks = racerThrusters(pointsOfGlb(readFileSync(file)), 'pod');
      read++;
      console.log(`     ${item.label}: ${picks.join(', ') || 'none'}`);
      if (want[item.label]) ok(same(picks, want[item.label]), `${item.label}'s glows stand on ${want[item.label].join(', ')}, as the design measured`);
      else note(`${item.label} is a pod the design did not measure`);
    }
    // Seven of the game's own, and Sebulba's once the vehicles have been converted with it.
    const floor = items.some((i) => i.label === 'podracer_sebulba') ? 8 : 7;
    ok(read >= floor, `the gallery's pods read (${read} of at least ${floor})`);
  }
}

/**
 * A GLB's hardpoints as the rule reads them: each `hp:engine…` node's place, across about the middle of the model's own
 * box and along its length, through the node hierarchy at the rest pose (the frame the garage reads them in).
 */
function pointsOfGlb(buf: Buffer): EnginePoint[] {
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength)) as {
    nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; mesh?: number }[];
    meshes?: { primitives: { attributes: { POSITION?: number } }[] }[];
    accessors?: { min?: number[]; max?: number[] }[];
  };
  const parent = new Map<number, number>();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const local = (i: number): THREE.Matrix4 => {
    const n = json.nodes[i];
    if (n.matrix) return new THREE.Matrix4().fromArray(n.matrix);
    const t = n.translation ?? [0, 0, 0];
    const r = n.rotation ?? [0, 0, 0, 1];
    const s = n.scale ?? [1, 1, 1];
    return new THREE.Matrix4().compose(new THREE.Vector3(t[0], t[1], t[2]), new THREE.Quaternion(r[0], r[1], r[2], r[3]), new THREE.Vector3(s[0], s[1], s[2]));
  };
  const world = (i: number): THREE.Matrix4 => {
    const m = local(i);
    for (let k = parent.get(i); k !== undefined; k = parent.get(k)) m.premultiply(local(k));
    return m;
  };
  // The model's box across, from every mesh's own extent where it hangs, for the middle the garage centres it on.
  const box = new THREE.Box3();
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const w = world(i);
    for (const prim of json.meshes?.[n.mesh]?.primitives ?? []) {
      const a = prim.attributes.POSITION !== undefined ? json.accessors?.[prim.attributes.POSITION] : undefined;
      if (!a?.min || !a.max) continue;
      box.union(new THREE.Box3(new THREE.Vector3(a.min[0], a.min[1], a.min[2]), new THREE.Vector3(a.max[0], a.max[1], a.max[2])).applyMatrix4(w));
    }
  });
  const middle = box.isEmpty() ? 0 : (box.min.x + box.max.x) / 2;
  const out: EnginePoint[] = [];
  const at = new THREE.Vector3();
  json.nodes.forEach((n, i) => {
    if (!n.name?.startsWith('hp:')) return;
    at.setFromMatrixPosition(world(i));
    out.push({ name: n.name.slice(3), x: at.x - middle, z: at.z });
  });
  return out;
}

console.log(`\nraceSpots: ${checks} checks passed`);

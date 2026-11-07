// The race drawer's second wave: a node dragged carves live (DESIGN.md §2.4, §2.11). The real Course tool over the real
// editing (`courseRig.ts`), driven through its own frames with a real projection: a held diamond's drag carves the world's
// store at `previewHz` as previews (its buckets kept), the course in the store the held edit's own (settled, rounded as the
// writer rounds); a drag the batch refuses is put back, the store carved again to the bits of the file's course; a drag let
// go at rest is written as the store already holds it, so the landing lays nothing again; a drag brought back to where it
// was grabbed and let go writes nothing and carves the file's course back; and with the race switch turned off mid-drag the
// world's own courses as last landed are carved back, never none. The preview tick's allocation is
// measured apart by `courseAlloc.test.ts` (`editorAllocOwn.ts course`, whose host carves).
//
// Run: node tools/swg/tests/courseDrag.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { courseRig, idle, landFile, land, WORLD, CENTRE, type CourseRig } from './courseRig.ts';
import { courseCtx, drawTrack } from '../../../src/editor/courseEdit.ts';
import { trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { CourseCarve } from '../../../src/swg/terrain/courseCarve.ts';
import { toolFrame, type ToolDraw } from '../../../src/editor/tools.ts';
import { rawToGameX, rawToGameZ } from '../../../src/story/waypoints.ts';
import type { ScreenView } from '../../../src/editor/gizmo.ts';
import type { CourseHost } from '../../../src/editor/editorCourse.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const sprint = (): TrackDef => ({ ...(drawTrack('run', 'Run', [{ x: 1000, z: -400, y: land(1000, -400) + 4 }, { x: 1100, z: -380, y: land(1100, -380) + 4 }, { x: 1200, z: -400, y: land(1200, -400) + 4 }], false, courseCtx(land)) as TrackDef), at: 1_700_000_000_000 });

/** The carve of a list of tracks at a grid of raw points, as numbers (bits compared). */
function sampleOf(store: CourseCarve): number[] {
  const out: number[] = [];
  for (let z = -460; z <= -320; z += 4) for (let x = 960; x <= 1240; x += 4) out.push(store.carveAt(land(x, z), x, z));
  return out;
}
const sameBits = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const fresh = (tracks: TrackDef[]): CourseCarve => {
  const s = new CourseCarve();
  s.set(tracks);
  return s;
};

/** The tool's frames over a view, as courseTool.test drives them. */
function frames(r: CourseRig) {
  const view: ScreenView = r.h.look(new THREE.Vector3(-100, 260, 200), new THREE.Vector3(-100, 5, 100));
  const draw: ToolDraw = { marks: r.h.marks, radius: 0.5, ring() {} };
  const f = toolFrame();
  let now = 10;
  const frame = (o: { apply?: boolean; sx?: number; sy?: number; at?: [number, number, number] | null } = {}): void => {
    now += 1 / 60;
    f.apply = !!o.apply;
    f.inverse = false;
    f.lift = false;
    f.turn = false;
    f.dx = 0;
    f.dy = 0;
    f.sx = o.sx ?? f.sx;
    f.sy = o.sy ?? f.sy;
    f.shift = false;
    f.sampled = false;
    f.dt = 1 / 60;
    f.now = now;
    if (o.at) {
      f.valid = true;
      f.x = o.at[0];
      f.y = o.at[1];
      f.z = o.at[2];
    } else f.valid = false;
    r.c.step(f);
    r.c.overlay(draw, view);
  };
  const proj = (x: number, y: number, z: number): [number, number] => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(new THREE.Matrix4().fromArray(view.vp));
    return [(v.x * 0.5 + 0.5) * view.w, (0.5 - v.y * 0.5) * view.h];
  };
  /** Node `i` of path 0's diamond on the screen. */
  const diamond = (t: TrackDef, i: number): [number, number] => {
    const n = t.course!.paths[0].nodes[i];
    return proj(rawToGameX(CENTRE.x, n.x), n.y + 0.05, rawToGameZ(CENTRE.z, n.z));
  };
  return { frame, diamond };
}

/** A drag of node 1's diamond 60 px across, held `rest` frames at its end; answers the frames' driver. */
async function dragNode(r: CourseRig, rest: number, beforeRelease?: () => void, fr: ReturnType<typeof frames> = frames(r)): Promise<void> {
  const { frame, diamond } = fr;
  frame({});
  const [sx, sy] = diamond(r.tracks()[0], 1);
  frame({ sx, sy });
  frame({ apply: true, sx, sy });
  for (let k = 1; k <= 30; k++) frame({ apply: true, sx: sx + k * 2, sy });
  for (let k = 0; k < rest; k++) frame({ apply: true, sx: sx + 60, sy });
  beforeRelease?.();
  frame({ sx: sx + 60, sy });
  await idle(r);
}

const liveWas = COURSE_TUNE.live;
try {
  COURSE_TUNE.live = 'drag';
  // 1. A drag carves live, as previews.
  {
    const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [sprint()]) });
    landFile(r);
    await r.c.arm();
    r.c.pick('run');
    r.c.setMode('edit');
    const fileSample = sampleOf(r.store);
    let seen = 0;
    await dragNode(r, 12, () => {
      seen = r.carves.filter((c) => c.preview).length;
    });
    ok(seen >= 2, `a held diamond's drag carves the world's store live, as previews (${seen} ticks)`);
    ok(r.c.last.ok && !sameBits(sampleOf(r.store), fileSample), `and the drag let go is written (${r.c.last.said})`);
    r.c.disarm();
  }
  // 2. A drag the batch refuses is put back to the bits of the file's course.
  {
    const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [sprint()]) });
    landFile(r);
    await r.c.arm();
    r.c.pick('run');
    r.c.setMode('edit');
    let changed = '';
    // Another write lands between the drag's ask and its batch (the file's track renamed, its course the same), so the batch
    // refuses the drag's row as changed since it was read.
    const host = r.h.host as unknown as { batch: (e: unknown[]) => Promise<unknown> };
    const batch = host.batch;
    host.batch = async (e: unknown[]) => {
      host.batch = batch;
      changed = trackFileText(WORLD, 'raw', [{ ...sprint(), name: 'Renamed' }]);
      r.h.files.tracks = changed;
      return batch(e);
    };
    await dragNode(r, 12);
    const last = r.carves[r.carves.length - 1];
    ok(!r.c.last.ok && r.h.files.tracks === changed, `a drag the batch refuses writes nothing (${r.c.last.said})`);
    ok(last && !last.preview && sameBits(sampleOf(r.store), sampleOf(fresh(r.tracks()))), "and the store is carved back to the bits of the file's course (a landing, not a preview)");
    r.c.disarm();
  }
  // 3. A drag let go at rest: its rounding the writer's, so the landing lays nothing again.
  {
    const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [sprint()]) });
    landFile(r);
    await r.c.arm();
    r.c.pick('run');
    r.c.setMode('edit');
    await dragNode(r, Math.ceil(60 / Math.max(1, COURSE_TUNE.previewHz)) + 6);
    ok(r.c.last.ok, `the drag held at rest past a preview tick and let go is written (${r.c.last.said})`);
    const n = landFile(r);
    ok(n === 0, `and the landing of what it wrote lays nothing again (${n} dirty rectangles): the preview carved the written course to the bit`);
    r.c.disarm();
  }
  // 4. C with the wheel's steps resting while their node is dragged wait for the drag's own write (the first wave's
  // leftover: the rest branch asks `held`), then are written to it.
  {
    const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [sprint()]) });
    landFile(r);
    await r.c.arm();
    r.c.pick('run');
    r.c.setMode('edit');
    const fr = frames(r);
    fr.frame({});
    r.c.pickedNode = 1;
    const sh = r.tracks()[0].course!.paths[0].nodes[1].sh;
    r.c.size(1);
    let during = -1;
    let previewsDuring = 0;
    await dragNode(
      r,
      40,
      () => {
        during = r.h.e.history.actions.length;
        previewsDuring = r.carves.filter((c) => c.preview).length;
      },
      fr,
    );
    for (let k = 0; k < 40; k++) fr.frame({});
    await idle(r);
    const n1 = r.tracks()[0].course!.paths[0].nodes[1];
    ok(during === 0 && previewsDuring > 0, `a shoulder step resting for over a second while its node is dragged writes nothing mid-drag (${during} actions, ${previewsDuring} previews)`);
    ok(r.h.e.history.actions.length === 2 && Math.abs(n1.sh - (sh + COURSE_TUNE.shoulderStep)) < 0.006 && r.c.last.ok, `and after the drag's own write, the step is written to the node (${sh} to ${n1.sh}, two actions)`);
    r.c.disarm();
  }
  // 5. A drag carved live, brought back to where it was grabbed and let go (the "never mind"): nothing is written, and the
  // file's course is carved back, never the last preview's left standing under the ground, the plants and the drive.
  {
    const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [sprint()]) });
    landFile(r);
    await r.c.arm();
    r.c.pick('run');
    r.c.setMode('edit');
    const fr = frames(r);
    fr.frame({});
    const [sx, sy] = fr.diamond(r.tracks()[0], 1);
    fr.frame({ sx, sy });
    fr.frame({ apply: true, sx, sy });
    for (let k = 1; k <= 20; k++) fr.frame({ apply: true, sx: sx + k * 2, sy });
    for (let k = 0; k < 12; k++) fr.frame({ apply: true, sx: sx + 40, sy });
    const previews = r.carves.filter((c) => c.preview).length;
    const away = !sameBits(sampleOf(r.store), sampleOf(fresh(r.tracks())));
    fr.frame({ apply: true, sx: sx + 1, sy });
    fr.frame({ sx: sx + 1, sy });
    await idle(r);
    const last = r.carves[r.carves.length - 1];
    ok(previews >= 2 && away, `the drag carved the world live away from the file's course (${previews} previews)`);
    ok(r.h.e.history.actions.length === 0 && !!last && !last.preview && sameBits(sampleOf(r.store), sampleOf(fresh(r.tracks()))) && !(r.c as unknown as { carvedLive: boolean }).carvedLive, 'let go where it was grabbed, nothing is written and the store is carved back to the bits of the file\'s course (a landing)');
    r.c.disarm();
  }
  // 6. The race switch turned off while a drag carves live, so the tool reads no track from then on: let go or given up, the
  // world's own courses as it last landed them (`carved`) are carved back, never none, which un-carved every course the
  // world holds and dropped their zones until the next arrival. A host that keeps no such list carves nothing back.
  for (const way of ['let go', 'Escape', 'no list'] as const) {
    const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [sprint()]) });
    landFile(r);
    await r.c.arm();
    r.c.pick('run');
    r.c.setMode('edit');
    const fileSample = sampleOf(r.store);
    const fr = frames(r);
    fr.frame({});
    const [sx, sy] = fr.diamond(r.tracks()[0], 1);
    fr.frame({ sx, sy });
    fr.frame({ apply: true, sx, sy });
    for (let k = 1; k <= 20; k++) fr.frame({ apply: true, sx: sx + k * 2, sy });
    for (let k = 0; k < 12; k++) fr.frame({ apply: true, sx: sx + 40, sy });
    const previews = r.carves.filter((c) => c.preview).length;
    const away = !sameBits(sampleOf(r.store), fileSample);
    const host = r.host as { tracks: CourseHost['tracks']; raceOn: CourseHost['raceOn']; carve?: CourseHost['carve']; carved?: CourseHost['carved'] };
    if (way === 'no list') delete host.carved;
    host.tracks = () => null;
    host.raceOn = () => false;
    const handed: number[] = [];
    const carve = host.carve!;
    host.carve = (list, fx, fz, preview) => {
      handed.push(list.length);
      carve(list, fx, fz, preview);
    };
    if (way === 'Escape') r.c.escape();
    else {
      fr.frame({ apply: true, sx: sx + 40, sy });
      fr.frame({ sx: sx + 40, sy });
    }
    await idle(r);
    const live = (r.c as unknown as { carvedLive: boolean }).carvedLive;
    const wiped = sameBits(sampleOf(r.store), sampleOf(fresh([])));
    ok(previews >= 2 && away, `${way}: the drag carved the world live away from the file's course (${previews} previews)`);
    if (way === 'no list') ok(!handed.length && !live && !wiped && r.h.e.history.actions.length === 0, `${way}: with the race switch off and no list of the world's own, nothing is carved back (handed ${handed.join(',') || 'nothing'}) and the world's courses are never wiped`);
    else ok(handed.length === 1 && handed[0] === 1 && !live && sameBits(sampleOf(r.store), fileSample) && r.h.e.history.actions.length === 0, `${way}: with the race switch off, the world's own courses as last landed are carved back to the bit (handed ${handed.join(',')} track), never none`);
    r.c.disarm();
  }
} finally {
  COURSE_TUNE.live = liveWas;
}

console.log(`\ncourseDrag: ${checks} checks passed`);

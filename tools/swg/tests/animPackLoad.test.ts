// The imported clips in the running game (src/anim/mixamoPack.ts): the pack's states, what it fetches and when, one
// fit a skeleton shared by every rig of it, and a fit written again in place. Run over the committed pack
// (public/anims/mixamo) through a disk io that counts every ask, on skeletons made here.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANIM_TUNE, tuneAnim } from '../../../src/anim/animTune.ts';
import { FOOT_FOLD, MixamoPack, PACK_DIR, PACK_INDEX, PACK_SWITCH, browserIo, mixamoPack, switchOn, type PackIo } from '../../../src/anim/mixamoPack.ts';
import { MX } from '../../../src/anim/animRules.ts';
import { clipName, readPackIndex } from '../../../src/anim/mxaFile.ts';
import { PACK_FILES, fetchPublic, fetchPublicBytes, filesReport, forgetFiles, setShippedPublic } from '../../../src/world/packFiles.ts';
import { repoRoot, targetSkeleton } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const root = repoRoot(import.meta.url);
const dir = join(root, 'public', 'anims', 'mixamo');
ok(existsSync(join(dir, 'index.json')), 'the pack is in the checkout (public/anims/mixamo/index.json)');
const indexText = readFileSync(join(dir, 'index.json'), 'utf8');
const index = readPackIndex(JSON.parse(indexText));
if (typeof index === 'string') throw new Error(index);
const used = index.clips.filter((c) => c.use);

interface Counted extends PackIo {
  asks: { index: number; clips: string[]; breaths: number };
}
function diskIo(over: Partial<{ enabled: boolean; index: string | null; clip: (file: string) => ArrayBuffer | null | undefined }> = {}): Counted {
  const asks = { index: 0, clips: [] as string[], breaths: 0 };
  let clock = 0;
  return {
    asks,
    enabled: () => over.enabled ?? true,
    index: async () => {
      asks.index++;
      return over.index === undefined ? indexText : over.index;
    },
    clip: async (file) => {
      asks.clips.push(file);
      const swapped = over.clip?.(file);
      if (swapped !== undefined) return swapped;
      const b = readFileSync(join(dir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    breath: async () => {
      asks.breaths++;
    },
    now: () => (clock += 0.5),
  };
}
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { warn, info } = console;
  console.warn = () => {};
  console.info = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
    console.info = info;
  }
};

const human = targetSkeleton();

// ---- the game without the pack ---------------------------------------------------------------------------------------
{
  const io = diskIo({ enabled: false });
  const pack = new MixamoPack(io);
  ok(pack.state === 'idle', 'a pack nobody has asked of has fetched nothing');
  await pack.load();
  ok(pack.state === 'off' && io.asks.index === 0 && io.asks.clips.length === 0, 'with the switch off nothing is asked for: not the index, not a clip');
  ok((await pack.clipsFor(human, 'test')).length === 0 && typeof (await pack.clipFor('running', human, 'test')) === 'string' && io.asks.index === 0, 'and a skeleton is handed no clip, which is the game as it was');
  ok(String((pack.report() as { why: string }).why).includes(PACK_SWITCH) && Object.keys(pack.footEvents()).length === 0, 'the report says it is the switch, by its name');
}
{
  const io = diskIo({ index: null });
  const pack = new MixamoPack(io);
  await pack.load();
  ok(pack.state === 'absent' && io.asks.index === 1 && io.asks.clips.length === 0 && (await pack.clipsFor(human, 'test')).length === 0, 'a build that carries no pack is "absent": no clip is asked for and none is handed over');
  const page = new MixamoPack(diskIo({ index: '<!doctype html><title>the page</title>' }));
  await page.load();
  ok(page.state === 'absent' && /not JSON/.test(String((page.report() as { why: string }).why)), 'the page handed back for a missing index is "absent" too, and never an error');
  const wrong = new MixamoPack(diskIo({ index: JSON.stringify({ format: 99, fps: 30, bones: [], clips: [] }) }));
  await quiet(() => wrong.load());
  ok(wrong.state === 'failed' && (await wrong.clipsFor(human, 'test')).length === 0, 'an index of a format this build does not read is "failed", said once, and plays nothing');
}

// ---- the pack, read ----------------------------------------------------------------------------------------------------
const io = diskIo();
const pack = new MixamoPack(io);
{
  const a = pack.load(), b = pack.load();
  ok(a === b, 'two asks to load are one load');
  await a;
  ok(pack.state === 'ready' && io.asks.index === 1, 'the pack reads: the index asked once');
  ok(io.asks.clips.length === used.length && used.every((c) => io.asks.clips.includes(c.file)) && used.length < index.clips.length, `only the ${used.length} clips the game uses are fetched at start, of the ${index.clips.length} the pack holds`);
  const want = [MX.tread, MX.adrift, MX.thrown, MX.impact, MX.jump, MX.fall, MX.float, MX.landSoft, MX.land, MX.landHard];
  ok(want.every((n) => used.some((c) => clipName(c.id) === n)), 'and every clip the game\'s rules name is among them');
}
{
  const clips = await pack.clipsFor(human, 'made');
  ok(clips.length === used.length && clips.every((c, i) => c.name === clipName(used[i].id)), 'a skeleton is handed one clip for each, by the game\'s names');
  ok(io.asks.breaths === used.length, 'with a breath after every clip fitted, so the fit never holds a frame');
  const again = await pack.clipsFor(targetSkeleton(), 'another rig');
  ok(again.length === clips.length && again.every((c, i) => c === clips[i]) && io.asks.clips.length === used.length && io.asks.breaths === used.length, 'a second rig of the same skeleton is handed the very same clip objects: nothing fetched, nothing fitted');
  const [x, y] = await Promise.all([pack.clipsFor(targetSkeleton({ lean: 20 }), 'two at once'), pack.clipsFor(targetSkeleton({ lean: 20 }), 'two at once')]);
  ok(x === y && x[0] !== clips[0] && x.length === clips.length, 'another skeleton takes a fit of its own, and two rigs of it loading at once share that one');
  const none = await pack.clipsFor({ joints: [{ name: 'Bip01', parent: -1, restP: [0, 1, 0], restQ: [0, 0, 0, 1] }], base: { p: [0, 0, 0], q: [0, 0, 0, 1] } }, 'not a biped of the game\'s');
  ok(none.length === 0, 'a skeleton with none of the joints the clips drive is handed none');
  const tread = clips.find((c) => c.name === MX.tread)!;
  ok(tread.tracks.length === 25 && tread.tracks.some((t) => t.name === 'root.position') && tread.tracks.every((t) => t.name.endsWith('.quaternion') || t.name === 'root.position') && Math.abs(tread.duration - pack.row('treading_water')!.duration) < 1e-6, 'a clip is a rotation track for every driven joint and the root\'s place, as long as its row says');
}

// ---- a clip the game does not use, for the console ------------------------------------------------------------------------
{
  const other = index.clips.find((c) => !c.use)!;
  const before = io.asks.clips.length;
  const clip = await pack.clipFor(other.id, human, 'made');
  ok(typeof clip !== 'string' && clip.name === clipName(other.id) && io.asks.clips.length === before + 1 && io.asks.clips[before] === other.file, 'any other clip is fetched and fitted when it is asked for by name');
  ok((await pack.clipFor(other.id, human, 'made')) === clip && io.asks.clips.length === before + 1, 'once');
  ok(typeof (await pack.clipFor('no_such_clip', human, 'made')) === 'string', 'and a name the pack has not got is refused in words');
  ok(pack.matching('mx_running').join() === 'running' && pack.matching('RUNNING').join() === 'running' && pack.matching('strafe').length > 1 && pack.matching('zzz').length === 0, 'the console finds a clip by its id, with or without the game\'s prefix, else every id that holds the word');
  ok(pack.matching('Hard Landing').join() === 'hard_landing' && pack.matching('Hard Landing.fbx').join() === 'hard_landing' && pack.matching('hard landing').join() === 'hard_landing' && pack.matching('Walking (1)').join() === 'walking_1' && pack.matching(' Falling Flat Impact.FBX ').join() === 'falling_flat_impact' && pack.matching('').length === 0 && pack.matching('.fbx').length === 0, 'and by the name its file has, as the brief writes them: the word is made an id by the importer\'s own rule');
  ok(pack.unavailable() === null, 'a pack that is in has no word of why it is not');
}
{
  const words = async (over: Parameters<typeof diskIo>[0]) => {
    const p = new MixamoPack(diskIo(over));
    await quiet(() => p.load());
    return { why: p.unavailable() ?? '', asked: await p.clipFor('running', human, 'test') };
  };
  const off = await words({ enabled: false }), absent = await words({ index: null }), failed = await words({ index: JSON.stringify({ format: 99, fps: 30, bones: [], clips: [] }) });
  ok(/switched off/.test(off.why) && off.why.includes(PACK_SWITCH) && off.asked === off.why, 'with the switch off a clip asked for by name is refused as the switch, by its name, and never as a clip that does not match');
  ok(/carries no imported animations/.test(absent.why) && absent.asked === absent.why && /could not be read/.test(failed.why) && /format 99/.test(failed.why), 'a build without the pack says that, and a pack that would not read says why');
}

// ---- a file that is not there, and one that is not its row's ----------------------------------------------------------------
{
  const gone = used[0], short = used[1];
  const other = readFileSync(join(dir, used[2].file));
  const bad = new MixamoPack(
    diskIo({
      clip: (file) => (file === gone.file ? null : file === short.file ? (other.buffer.slice(other.byteOffset, other.byteOffset + other.byteLength) as ArrayBuffer) : undefined),
    }),
  );
  await bad.load();
  const clips = await bad.clipsFor(human, 'made');
  const lost = (bad.report() as { lost?: Record<string, string> }).lost ?? {};
  ok(bad.state === 'ready' && clips.length === used.length - (short.frames === used[2].frames ? 1 : 2) && !clips.some((c) => c.name === clipName(gone.id)), 'a clip whose file is not there is left out, and the rest play');
  ok(/not there/.test(lost[gone.id] ?? '') && (short.frames === used[2].frames || /frames/.test(lost[short.id] ?? '')), 'the report names each clip lost and why: no file, or a file that is not the one its row describes');
}

// ---- a fit written again in place ------------------------------------------------------------------------------------------
// (The pack made last is the one the tune tells of a moved trim: the game makes one.)
{
  const live = new MixamoPack(diskIo());
  const clips = await live.clipsFor(human, 'made');
  const tread = clips.find((c) => c.name === MX.tread)!;
  const hips = tread.tracks.find((t) => t.name === 'root.quaternion')!;
  const was = Float32Array.from(hips.values);
  const report = () => (live.report() as { fits: { standingRest: { hipsTiltDeg: number }; clips: string[]; fitMs: number; longestClipMs: number; mapped: number }[]; align: Record<string, boolean> });
  ok(report().fits[0].standingRest.hipsTiltDeg === 0 && report().align.torso === false && report().align.limbs === true, 'as shipped the standing rest leaves the hips unturned');
  const n = live.setAlign({ torso: true });
  ok(n === used.length && live.alignment.torso === true, 'lining the torso up from the console fits every clip of every skeleton again');
  ok(hips.values !== was && tread.tracks.find((t) => t.name === 'root.quaternion') === hips && was.some((v, i) => Math.abs(v - hips.values[i]) > 0.05), 'into the very arrays the clips play: the same clip, the same track, new values');
  ok(report().fits[0].standingRest.hipsTiltDeg > 25, `and the report then shows the old rule's tilt (${report().fits[0].standingRest.hipsTiltDeg} degrees)`);
  ok(live.setAlign({ torso: true }) === 0, 'a flag set to what it is fits nothing');
  live.setAlign({ torso: false });
  ok(was.every((v, i) => Math.abs(v - hips.values[i]) < 1e-6), 'put back, the values are the first fit\'s');
  const said: string[] = [];
  ok(live.setAlign({ hips: true, feet: 'yes' } as never, said) === 0 && said.length === 2 && /no alignment group hips/.test(said[0]) && /feet takes true or false/.test(said[1]) && live.alignment.feet === false, 'a group that is none, or a switch that is no switch, is said in words and sets nothing');

  // The float through the game's own pack: its row's level reaches the fit, so its hips ride at their rest height.
  const float = clips.find((c) => c.name === MX.float)!.tracks.find((t) => t.name === 'root.position')!;
  let mean = 0;
  for (let i = 1; i < float.values.length; i += 3) mean += float.values[i];
  mean /= float.values.length / 3;
  const restY = human.joints[0].restP[1];
  ok(Math.abs(mean - restY) < 0.01 && index.clips.find((c) => c.id === 'floating')!.level! > 0.2, `the float is fitted with its row's level: its hips ride at their rest height on average (${(mean - restY).toFixed(3)} m off), not a third of a metre over it`);
  // And a one-off through it is anchored over the hips' rest place, a loop where its first frame has them.
  const jump = clips.find((c) => c.name === MX.jump)!.tracks.find((t) => t.name === 'root.position')!;
  const restX = human.joints[0].restP[0], restZ = human.joints[0].restP[2];
  const jumpRow = index.clips.find((c) => c.id === 'jumping_up')!;
  ok(!jumpRow.loop && Math.hypot(jump.values[0] - restX, jump.values[2] - restZ) < 1e-6 && Math.hypot(jump.values[jump.values.length - 3] - restX, jump.values[jump.values.length - 1] - restZ) < 1e-6, 'the jump\'s start, a one-off whose take begins a tenth of a metre to one side, is fitted over the hips\' rest place: its row says it is no loop, and the fit is told');

  const hard = clips.find((c) => c.name === MX.landHard)!;
  const place = hard.tracks.find((t) => t.name === 'root.position')!;
  const placeWas = Float32Array.from(place.values);
  const trimWas = ANIM_TUNE.trim.hard_landing;
  tuneAnim({ trim: { hard_landing: 1.2 } });
  ok(placeWas.some((v, i) => Math.abs(v - place.values[i]) > 0.01), 'a trim moved on its dial strips that clip\'s travel from the new start, in place');
  const others = clips.find((c) => c.name === MX.land)!.tracks.find((t) => t.name === 'root.position')!;
  const othersWas = Float32Array.from(others.values);
  tuneAnim({ trim: { hard_landing: trimWas } });
  ok(placeWas.every((v, i) => Math.abs(v - place.values[i]) < 1e-6) && othersWas.every((v, i) => v === others.values[i]), 'and back; a clip whose trim did not move is not touched');
  tuneAnim({ land: { soft: ANIM_TUNE.land.soft } });
  const r = report().fits[0];
  ok(r.clips.length === used.length && r.mapped === 24 && r.fitMs > 0 && r.longestClipMs > 0 && r.longestClipMs <= r.fitMs, 'the report says what was fitted for each skeleton, how long it took and the longest single clip');
}

// ---- foot marks ------------------------------------------------------------------------------------------------------------
{
  const marks = pack.footEvents();
  const names = Object.keys(marks);
  const rows = index.clips.filter((c) => c.feet.length);
  ok(names.length === rows.length && names.length > 20 && names.every((n) => n.startsWith('mx_')), `every clip with foot marks hands them to the footsteps by the game's clip name (${names.length} clips)`);
  ok(Object.values(marks).every((list) => list.every((m) => m.name === 'event_footstep' && m.f >= 0 && m.f <= 1)), 'each a fraction of its clip, as the clips\' own marks are kept');
  const run = marks.mx_running, row = pack.row('running')!;
  ok(run.length === row.feet.length && Math.abs(run[0].f - row.feet[0].t / row.duration) < 1e-9, 'a mark\'s fraction is its time over its clip\'s length');
  // Both feet of a landing come down within a frame or two of each other: one footstep, at the first of them.
  const hard = pack.row('hard_landing')!, short = pack.row('jumping_down')!;
  const together = (r: typeof hard) => r.feet.filter((m, i) => i > 0 && m.t - r.feet[i - 1].t < FOOT_FOLD).length;
  ok(together(hard) >= 1 && marks.mx_hard_landing.length === hard.feet.length - together(hard) && Math.abs(marks.mx_hard_landing[0].f - hard.feet[0].t / hard.duration) < 1e-9, `the hard landing's two feet coming down together are one footstep, at the first of them (${hard.feet.length} marks, ${marks.mx_hard_landing.length} footsteps)`);
  ok(together(short) === 1 && marks.mx_jumping_down.length === 1 && marks.mx_jumping_down[0].f * short.duration < short.duration - 0.08, 'and the short landing\'s are one, early enough to sound before the clip gives way');
  ok(Object.values(marks).every((list) => list.every((m, i) => i === 0 || m.f > list[i - 1].f)) && marks.mx_walking?.length !== 1 && run.length === 2 && FOOT_FOLD < 0.1, 'while a walk\'s and a run\'s steps, a quarter of a second and more apart, are each their own');
  ok(marks.mx_falling_flat_impact === undefined, 'and the thrown fall\'s impact hands over none');
}

// ---- the page's way to the pack ----------------------------------------------------------------------------------------------
{
  ok(switchOn(() => null) && switchOn(() => '1') && !switchOn(() => '0') && switchOn(() => { throw new Error('storage refused'); }), 'the switch is off only for a stored \'0\'; a page that refuses storage has it on');
  ok(PACK_SWITCH === 'swg.mixamo' && PACK_DIR === 'anims/mixamo/' && PACK_INDEX === 'anims/mixamo/index.json', 'the switch is the key the README names (swg.mixamo), and the pack is where the build ships it');
  // The page's io over the game's own asks of its public files (src/world/packFiles.ts), through a fetch that counts.
  const asked: { url: string; init?: RequestInit }[] = [];
  const res = (type: string, okay = true) => ({ ok: okay, status: okay ? 200 : 404, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? type : null) }, json: async () => ({}), text: async () => '{"format":1}', arrayBuffer: async () => new ArrayBuffer(8) });
  let answer = res('application/json');
  const fetchWas = PACK_FILES.fetch;
  PACK_FILES.fetch = async (url, init) => (asked.push({ url, init }), answer);
  forgetFiles();
  setShippedPublic(null);
  const io = () => browserIo({ text: (path, init) => fetchPublic(path, init, '/game/'), bytes: (path, query) => fetchPublicBytes(path, query, '/game/') });
  try {
    const page = io();
    ok(page.enabled() === true, 'in node, with no storage at all, the switch reads on');
    ok((await page.index()) === '{"format":1}' && asked.length === 1 && asked[0].url === `/game/${PACK_INDEX}` && asked[0].init?.cache === 'no-store', 'the index is asked afresh, under the page\'s own base');
    answer = res('text/html');
    ok((await page.index()) === null, 'a page handed back for it (a 200 that is not JSON) is no index');
    answer = res('application/json', false);
    ok((await page.index()) === null, 'nor is a miss');
    answer = res('application/octet-stream');
    const bytes = await page.clip('running.mxa', 'ab12/3');
    ok(bytes instanceof ArrayBuffer && asked[asked.length - 1].url === `/game/${PACK_DIR}running.mxa?h=ab12%2F3` && asked[asked.length - 1].init === undefined, 'a clip is asked by an address its own hash makes its own, so no cache serves an old one');
    answer = res('text/html');
    ok((await page.clip('running.mxa', 'x')) === null, 'and the page handed back for a clip is no clip');
    // What `__debug.files()` then says: every ask of the pack, under the file's own address.
    const told = filesReport();
    const rowOf = (file: string) => told.public.find((r) => r.url === `/game/${PACK_DIR}${file}`);
    ok(rowOf('index.json')?.times === 3 && rowOf('index.json')?.answer === 'missing' && rowOf('running.mxa')?.times === 2 && rowOf('running.mxa')?.answer === 'page' && !told.public.some((r) => r.url.includes('?')), 'the console\'s account of the session\'s files lists the pack\'s asks, the index and each clip, one row a file whatever hash it was asked with');
    answer = res('application/octet-stream');
    await page.clip('running.mxa', 'y');
    ok(filesReport().public.find((r) => r.url.endsWith('running.mxa'))?.answer === 'ok', 'a clip that came back as bytes is "ok" there, whatever kind the server calls it');
    // A build whose own list does not carry the pack: nothing asked, and each said skipped.
    setShippedPublic(['tracks/tatooine.json']);
    const before = asked.length;
    ok((await page.index()) === null && (await page.clip('running.mxa', 'x')) === null && asked.length === before, 'a build whose own list does not carry the pack asks for nothing at all');
    ok(['index.json', 'running.mxa'].every((f) => filesReport().skipped.some((s) => s.url === `/game/${PACK_DIR}${f}` && /not in the build/.test(s.why))), 'and the console lists both as answered without a request: not in the build');
    setShippedPublic([`${PACK_INDEX}`, `${PACK_DIR}running.mxa`]);
    answer = res('application/json');
    ok((await page.index()) === '{"format":1}' && asked.length === before + 1, 'while one whose list carries it asks');
    let breathed = false;
    await page.breath().then(() => (breathed = true));
    ok(breathed && page.now() > 0, 'its breath is a message, which comes back');

    // The switch as the page reads it: the stored key, read once as the io is made.
    const store = (value: string | null, seen: string[] = []) => ({ getItem: (k: string) => (seen.push(k), value) });
    const g = globalThis as { localStorage?: unknown };
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const seen: string[] = [];
    try {
      Object.defineProperty(globalThis, 'localStorage', { value: store('0', seen), configurable: true, writable: true });
      const offIo = io();
      const offPack = new MixamoPack(offIo);
      const n = asked.length;
      await offPack.load();
      ok(offIo.enabled() === false && seen.join() === PACK_SWITCH && offPack.state === 'off' && asked.length === n && (await offPack.clipsFor(human, 'test')).length === 0, 'with \'0\' stored under that key the page\'s io reads the switch off, and the pack then asks for nothing: not the index, not a clip');
      g.localStorage = store(null);
      ok(io().enabled() === true, 'with nothing stored it reads on');
      g.localStorage = store('1');
      ok(io().enabled() === true, 'and with anything else stored');
      g.localStorage = { getItem: () => { throw new Error('storage refused'); } };
      ok(io().enabled() === true, 'a page that refuses storage has it on');
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', had);
      else delete g.localStorage;
    }
  } finally {
    PACK_FILES.fetch = fetchWas;
    setShippedPublic(null);
    forgetFiles();
  }
}
{
  const first = mixamoPack(diskIo())!;
  ok(first instanceof MixamoPack && mixamoPack() === first && mixamoPack(diskIo()) === first, 'the game has one pack: whoever asks after the first is handed the same');
}

console.log(`\n${checks} checks passed`);

// The race drawer's first wave: text pins of what only the game hands over, which every behaviour test makes for itself
// (`courseTool.test.ts` stands its own host; `tracksKind.test.ts` its own harness and endpoint). The tool's entry in the
// Tools list and its key, the dev server's alone; V handed to an armed tool before the editing; the tracks kind's answer
// landed by difference into the race's tracks; the dev server's word routed as a placements word and its revision dropped;
// the Gates view's save and take-out through the editor's batch with the file's course kept; the course's legs carried out
// of the file's frame; `__debug.course`, its dials and its README row.
//
// Run: node tools/swg/tests/courseWiring.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './oldModules.ts';
import { DEFAULT_BINDINGS, DEV_ONLY_ACTIONS } from '../../../src/core/input.ts';
import { EDITOR_ACTIONS } from '../../../src/editor/editorKeys.ts';
import { DEBUG_GROUPS } from '../../../src/ui/debugModel.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (f: string) => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n');

const main = read('src/main.ts');
const entry = read('src/editor/editorEntry.ts');

// The tool and its key.
ok(/this\.course = new EditorCourse\(this\.courseHost\(\)\);\s*this\.tools\.add\(courseTool\(this\.course\)\);/.test(entry), 'the Course tool is made over its host and added to the Tools list');
ok(DEFAULT_BINDINGS.editorCourse.length === 1 && DEFAULT_BINDINGS.editorCourse[0] === 'Quote' && DEV_ONLY_ACTIONS.has('editorCourse') && EDITOR_ACTIONS.includes('editorCourse'), "its key is ' and it is the dev server's alone, one of the editor's own actions");
ok(/editorCourse: import\.meta\.env\.DEV \? '[^']+' : '',/.test(read('src/ui/menu.ts')), 'the Controls page names it on the dev server alone');
ok(/toggle\?\(\): boolean;/.test(read('src/editor/tools.ts')), 'a tool of the list may take V (`toggle`)');
ok(/const vTool = this\.tools\.armedTool;\s*if \(vTool\?\.toggle && input\.pressedAction\('editorNeighbour'\) && vTool\.toggle\(\)\) this\.window\?\.refreshEdits\(\);\s*\/\/ The editing keys[^\n]*\n[^\n]*\n\s*this\.edits\.clock\.dt = dt;\s*this\.edits\.keys\(/.test(entry), 'V is handed to the armed tool before the editing reads its keys');
ok(/m\.lakesOn = false;\s*m\.draftOn = false;\s*m\.courseOn = false;\s*if \(tool && tool\.armed\(\) && tool\.overlay\) tool\.overlay\(this\.toolDraw, sv\);/.test(entry), "the courses' marks are put away every frame no tool draws them");
ok(/if \(act\.startsWith\('lights:'\)\) this\.lights\.act\(act, value\);\s*\/\/[^\n]*\n\s*else if \(act\.startsWith\('course:'\)\) await this\.course\.act\(act, value\);/.test(entry), "the window's sections' acts named `course:` are the tool's");
ok(/this\.course\.worldGone\(\);/.test(after(entry, '  worldGone(): void {', 1600)), 'the world going lets go of the course picked, drawn or held');
ok(/this\.water\.busy \|\| this\.places\.busy \|\| this\.course\.busy \|\| this\.folding\) \{\s*this\.activeAt = now;/.test(after(entry, '  private noteActivity(now: number): void {', 1200)), "a held edit or a write of the Course tool is activity: the automatic fold waits for its quiet");
// The track file's raw frame is the layout's own centre, as `trackInGame` reads it, so a course is drawn where a run tests its gates.
{
  const h = after(entry, '  private courseHost(): CourseHost {', 2400);
  ok(/out\.x = gameToRawX\(c\?\.x \?\? 0, x\);\s*out\.z = gameToRawZ\(c\?\.z \?\? 0, z\);/.test(h) && /out\.x = rawToGameX\(c\?\.x \?\? 0, x\);\s*out\.z = rawToGameZ\(c\?\.z \?\? 0, z\);/.test(h) && /const c = w\.layoutCenter;/.test(h) && /centre: \(\) => w\.layoutCenter,/.test(h), "the tool's frame is the layout's centre, as the race reads a track file's");
  ok(/tracks: \(\) => \(h\.tracks \? h\.tracks\(\) : none\),/.test(h) && /raceOn: \(\) => h\.raceOn\?\.\(\) \?\? false,/.test(h), "and its tracks the game's own, the race pass's switch with them");
}
ok(/tracks: \(\) => \(RACE_TUNE\.on && this\.tracksWorld === this\.editWorld\(\) \? \(this\.tracksRead\?\.tracks \?\? NO_TRACK_DEFS\) : null\),\s*raceOn: \(\) => RACE_TUNE\.on,/.test(main), "the game hands the editor this world's tracks as the race read them, and the race pass's switch");
// A fetch the race pass skipped (or the copies') leaves the world unread, so the tool is handed "not read" rather than an
// empty list, and never writes over a file the page never held.
{
  const fetch = after(main, "  private fetchTracksRead(world: string, kind: WorldKind, shared = false): Promise<TrackRead | null | 'unread'> {", 1600);
  ok(/const skipped = kind === 'copies' \|\| !RACE_TUNE\.on;/.test(fetch) && /this\.tracksWorld = skipped \? '' : world;/.test(fetch), 'a fetch the race pass skipped leaves the world unread');
  // A read that failed leaves the race's and the editor's list as it stood (a world never read stays not read).
  ok(/if \(read === 'unread'\) \{\s*if \(this\.tracksWorld !== world\) \{\s*this\.tracksRead = null;\s*this\.tracksWorld = '';\s*\}\s*\} else \{/.test(fetch), "a fetch whose read failed (`'unread'`) keeps the list it had, and a world never read stays unread");
  ok(/return this\.fetchTracksRead\(world, kind, shared\)\.then\(\(r\) => \(r === 'unread' \? null : r\)\);/.test(after(main, '  private fetchTracks(world: string, kind: WorldKind, shared = false): Promise<TrackRead | null> {', 300)), "and the race's own reads see a failed read as nothing read");
}
ok(/worldMark: \(\) => w\.generation,/.test(after(entry, '  private courseHost(): CourseHost {', 2600)), "the tool's world is the editing's own mark of it (the world's generation)");

// The tracks kind landed by difference, and the word's revision dropped.
// (The race drawer's wave 3b put the brush's priming between the two: an undo's chunks inflated before anything carves them.)
ok(/const tkf = files\.tracks;[\s\S]{0,300}if \(tkf\) await primeBrush\(tkf\.put as unknown as TrackDef\[\], inflateBase64\);\s*if \(tkf && this\.world\.generation === gen && this\.editWorld\(\) === pack\) this\.landTracks\(pack, tkf\.put as unknown as TrackDef\[\], tkf\.deleted, tkf\.rows\);/.test(main), "a batch's tracks are landed by difference into the race's tracks, with the file's own count of them, their brush chunks inflated first");
// Wave 3b's review round: the world's track file read whole (every arrival, the dev server's word) inflates its brush chunks
// between the read and its answer, naming them held, or every player's brush ground is laid as nothing.
ok(/const read = readTrackFile\(text, world, kind\);[\s\S]{0,400}const primed = await primeBrush\(read\.tracks, inflateBase64, true\);\s*for \(const f of primed\.failed\) console\.warn\([^\n]*\);[\s\S]{0,400}return read;/.test(main), "a track file read whole inflates every brush chunk of it, as held, before the read is answered");
// And the editor's This-track hand-over: the picked course, its land in the raw frame through the world's own carry, the
// preview and the write through the Course tool.
ok(/track: \{\s*track: \(\) => me\.course\?\.track\(\) \?\? null,\s*groundAt: \(x, z\) => \{\s*const s = w\.terrain\.swg;\s*const y = w\.terrain\.heightAt\(s \? s\.toGameX\(x\) : -x, s \? s\.toGameZ\(z\) : z\);\s*return Number\.isFinite\(y\) \? y : Number\.NaN;\s*\},\s*preview: \(t, fx, fz\) => me\.course\?\.previewTrack\(t, fx, fz\),\s*write: \(label, before, after\) => me\.course \? me\.course\.write\(label, before, after\) : Promise\.resolve\('the Course tool is not made'\),\s*ok: \(\) => me\.course\?\.last\.ok \?\? false,\s*\},/.test(entry), "the sculpt brush's This track is handed the picked course, its ground through the world's carry, and the Course tool's preview and write");
{
  const land = after(main, '  private landTracks(world: string, put: readonly TrackDef[], deleted: readonly string[], rows: number): void {', 3200);
  ok(/const now = landedTracks\(before, put, deleted\);\s*if \(now\.length !== rows\) \{\s*void this\.reloadTracks\(world\);\s*return;\s*\}/.test(land), "the landing is `landedTracks`' answer, and a page that never held the file whole reads it again rather than standing a part of it");
  ok(/this\.tracksRead = read;\s*this\.tracksWorld = world;\s*this\.tracksFetch = \{ world, done: Promise\.resolve\(read\) \};\s*this\.tracksMoved\(before, now\);/.test(land), "the landing is the race's tracks, a fetch under way let go, the corridors and the Gates view's list told");
  // The race drawer's second wave: with the race pass off a batch's tracks (the Course tool's, an undo's or a redo's, whose
  // word is the page's own and is dropped) still land the drawn courses by difference over the world's own (D10), before
  // anything of the race is read; the same count check reads the file again where the world never held it whole.
  const raceOff = /\{\s*(\/\/[^\n]*\n\s*)*if \(!RACE_TUNE\.on\) \{\s*if \(this\.worldKindOf\(this\.world\.planet\) !== 'ground'\) return;\s*const courses = landedTracks\(this\.world\.courseTracks as readonly TrackDef\[\], put, deleted\);\s*if \(courses\.length !== rows\) void this\.reloadTracks\(world\);\s*else this\.world\.landCourses\(courses, Number\.NaN, Number\.NaN, false\);\s*return;\s*\}\s*const before = this\.tracksWorld === world/;
  ok(raceOff.test(land), "with the race pass off a batch's tracks still carve: landed over the world's own courses, before the race's own guard (the file read again where it was never held whole)");
  ok(/if \(this\.worldKindOf\(this\.world\.planet\) === 'ground'\) this\.world\.landCourses\(now, Number\.NaN, Number\.NaN, false\);/.test(land), 'and with it on, the drawn courses carved again by difference too');
}
ok(main.includes("import.meta.hot.on('tracks:changed', (d: { world?: string; rev?: string }) => this.placementWord({ kind: 'tracks', layer: 'tracks', world: d?.world, rev: d?.rev }));"), "the dev server's word about a track file goes through `placementWord`, which drops a revision this page landed");
ok(main.includes("if (kind === 'tracks') return (pack, rev) => void this.reloadTracks(pack, rev);"), 'and a word it does not drop reads the file again');
{
  // The revision a word read again stands is the text's own as read (`readRevs`), never the word's.
  const reload = after(main, '  private async reloadTracks(world: string, rev?: string): Promise<string> {', 2600);
  const noted = after(main, '  private notedTrackRev(world: string, rev?: string): void {', 500);
  ok((reload.match(/this\.notedTrackRev\(world, rev\);/g) ?? []).length === 2 && /const readRev = this\.readRevs\.get\(key\);\s*if \(readRev !== undefined\) this\.placementRevs\.set\(key, readRev\);\s*else if \(typeof rev === 'string' && !globalThis\.crypto\?\.subtle\) this\.placementRevs\.set\(key, rev\);/.test(noted), "the revision read is the text's own as it was read, the word's only where the page cannot hash (with the race on and off)");
  // The race drawer's second wave: a word read again carves the drawn courses again whatever the race switch says.
  ok(/const n = this\.world\.landCourses\(read && !read\.problem \? read\.tracks : \[\], Number\.NaN, Number\.NaN, false\);/.test(reload) && /if \(this\.worldKindOf\(this\.world\.planet\) === 'ground'\) this\.world\.landCourses\(read && !read\.problem \? read\.tracks : \[\], Number\.NaN, Number\.NaN, false\);/.test(reload), 'a track file read again carves its drawn courses again, the race pass on or off');
  const read = after(main, "  private async readTracks(world: string, kind: 'ground' | 'space'): Promise<TrackRead | null | 'unread'> {", 3000);
  ok(/const none = res\.status === 404 \|\| \(res\.ok && type\.includes\('text\/html'\)\);\s*if \(import\.meta\.env\.DEV\) \{\s*if \(none\) this\.readRevs\.set\(key, ''\);\s*else this\.readRevs\.delete\(key\);\s*\}\s*return none \? null : 'unread';/.test(read) && /const text = await res\.text\(\);\s*if \(import\.meta\.env\.DEV\) await this\.noteReadRev\(key, text\);/.test(read), "the read keeps its text's revision, a missing file's as '' (the endpoint's and the watcher's own), and tells a read that failed (`'unread'`) from no file");
  ok(/\} catch \{\s*if \(import\.meta\.env\.DEV\) this\.readRevs\.delete\(key\);\s*return 'unread';\s*\}/.test(read), "a fetch that threw is a read that failed, never no file");
  // Map-maker II's heights lesson: a reload for a word tells a failed read from no file, and a failed one carves nothing.
  ok((reload.match(/if \(read === 'unread'\) return this\.tracksUnread\(world\);/g) ?? []).length === 2 && reload.indexOf("if (read === 'unread') return this.tracksUnread(world);") < reload.indexOf('this.notedTrackRev(world, rev);'), 'a track file read again that could not be read lands no course (with the race on and off) and stands no revision');
  ok(/return done\.then\(\(r\) => \(r && r !== 'unread' && !r\.problem \? r\.tracks : null\)\);/.test(after(main, "  private fetchCourses(world: string, kind: 'ground' | 'space' | 'copies'): Promise<readonly TrackDef[] | null> {", 600)), "an arrival's failed read stands no course, as no file does");
}

// The Gates view's writes through the batch whether the editor is on or off, the file's course kept where the hand allows.
{
  const save = after(main, '  private async trackSave(): Promise<string> {', 2400);
  ok(/const send = trackToSave\(t, before\);\s*if \(typeof send === 'string'\) return `not saved: \$\{send\}`;/.test(save), "a save keeps the course the file holds now, refused where the track in hand still follows the road as it was (`trackToSave`)");
  ok(/const no = await this\.writeTrack\(`\$\{t\.id\} saved`, before, send\);/.test(save), 'a save is one write of the tracks kind');
  const rm = after(main, '  private async trackRemove(id: string): Promise<string> {', 1600);
  ok(/const no = await this\.writeTrack\(`\$\{id\} taken out`, this\.trackById\(id\), null\);/.test(rm), 'and so is a take-out');
  const write = after(main, '  private async writeTrack(label: string, before: TrackDef | null, after: TrackDef | null): Promise<string> {', 1400);
  ok(/if \(this\.editor\?\.on\) no = await this\.editor\.putTrack\(label, before, after\);/.test(write), "with the editor on, one action of its history");
  ok(/edit = \{ file: 'tracks', put: row as unknown as Record<string, unknown>, was \};/.test(write) && /else edit = \{ file: 'tracks', delete: before\?\.id \?\? '', was \};/.test(write) && /no = \(await this\.editorBatch\(\[edit\]\)\)\.why;/.test(write), 'with it off, the very same batch with no history');
  ok(!main.includes("'/__dev/tracks'"), 'nothing of the page asks the old tracks endpoint (it stays answering for an older tab)');
  ok(/const no = await this\.edits\.strokeWrite\(es, \[\{ file: 'tracks', id, before, after \}\]\);/.test(after(entry, '  async putTrack(label: string, before: TrackDef | null, after: TrackDef | null): Promise<string> {', 600)), "the editor writes it as one row of the tracks kind");
}
// The corridor check names a drawn road's legs by their path and how far along it, a gate-only track's by its gates.
ok(/leg: legName\(t, legs\[h\.leg\], h\.leg\)/.test(after(main, '  private trackCheck(t: TrackDef)', 2000)), "`track({ check })` names each hit's leg by `legName`");

// The course's legs out of the file's frame, beside the grid and the gates in the game's.
ok((main.match(/courseLegs\(t, places\.grid, places\.gates, this\.trackRawToGame\(\)\)/g) ?? []).length === 2, 'both readers of the legs in the game carry a drawn course out of the file\'s frame');
ok(/return \(x, z\) => \(\{ x: rawToGameX\(c\.x, x\), z: rawToGameZ\(c\.z, z\) \}\);/.test(after(main, '  private trackRawToGame(): (x: number, z: number) => { x: number; z: number } {', 500)), 'the carry is the layout\'s own mirror about its centre');

// The carve (the race drawer's second wave) reaches the ground through exactly these modules of the terrain and the world:
// the store itself, the sampler that lays it at its sites, the converted ground's far grids, the pole grid of a world with
// no converted terrain, and the world that hands it over. A new reader of a course there is a new site, which the pins
// below (the sites it must never reach) must be read against first.
{
  // §4's sites the carve never reaches: the generator's own grid and a building layer's base (`TerrainSampler.generate`,
  // `baseHeightAt`, `trn.ts`), the generator (`generateChunk`) and its worker (`workerCore.ts`, `worker.ts`), and a
  // real-elevation world's ground under its buildings (`groundBeneathDem`): a building's layer still reads raw ground, and
  // the worker's blocks stay the client's (the main thread lays the carve as a block enters its cache).
  const trn = read('src/swg/terrain/trn.ts');
  const ter = read('src/world/terrain.ts');
  const bodyOf = (src: string, head: string): string => {
    const i = src.indexOf(head);
    assert.ok(i >= 0, `${head.trim()} is there`);
    const lines = src.slice(i).split(/\r?\n/);
    const indent = /^\s*/.exec(lines[0])![0];
    const end = lines.findIndex((l, k) => k > 0 && l === `${indent}}`);
    return lines.slice(0, end + 1).join('\n');
  };
  const NEVER = /course|carve|basePoleAt/i;
  const gen = bodyOf(trn, '  generate(startX: number, startZ: number, n: number, step: number): HeightGrid {');
  const base = bodyOf(trn, '  baseHeightAt(x: number, z: number): number {');
  const beneath = bodyOf(ter, '  private groundBeneathDem(');
  ok(gen.length > 40 && base.length > 40 && beneath.length > 20 && !NEVER.test(gen) && !NEVER.test(base) && !NEVER.test(beneath), 'the generator\'s own grid, a building layer\'s base and a real-elevation world\'s ground under its buildings never read a course');
  const WHOLE = /CourseCarve|CourseGrid|carveAt|carveIn|basePoleAt|\.course\b|courseGrid/;
  ok(['src/swg/terrain/generator.ts', 'src/swg/terrain/workerCore.ts', 'src/swg/terrain/worker.ts'].every((f) => !fs.existsSync(path.join(REPO, f)) || !WHOLE.test(read(f))), 'nor the generator (`generateChunk`) and its worker');
}
{
  const dirs = ['src/swg/terrain', 'src/world'];
  const readers: string[] = [];
  for (const d of dirs)
    for (const f of fs.readdirSync(path.join(REPO, d), { recursive: true }) as string[]) {
      if (!/\.(ts|mjs)$/.test(f)) continue;
      const rel = path.join(d, f).replace(/\\/g, '/');
      const text = read(rel);
      if (/from '[^']*race\/course(Path|Gates|Tune|Track)\.ts'/.test(text) || /courseSpines\(/.test(text) || /from '[^']*courseCarve\.ts'/.test(text)) readers.push(rel);
    }
  const want = ['src/swg/terrain/courseCarve.ts', 'src/swg/terrain/trn.ts', 'src/world/swgTerrain.ts', 'src/world/terrain.ts', 'src/world/world.ts'];
  ok(readers.sort().join(',') === want.sort().join(','), `the modules of the terrain and the world that read a course are the carve's own five (${readers.join(', ')})`);
}

// The second wave's hand-overs only the game makes (every behaviour test builds its own world): the courses asked as the load
// begins and awaited before the ground that carves them is made, on every kind of ground world; the flora's, the props' and
// the grass's rules handed over; the roads joined to the no-spawn zones; the drive handed the course; the editor's carve
// landed into the world; the navgrid's bake and key; the release carrying the modules.
{
  const world = read('src/world/world.ts');
  ok(/\/\/ whatever the race switch says \(a course is ground\), and waited on \(bounded\) before the ground that carves them is made\.\s*this\.askCourse\(this\.editKey\);/.test(world), "a world's drawn courses are asked as its load begins, whatever the race switch says");
  const conv = after(world, '    await this.removalsReady();\n    await this.peopleReady();\n    // And its drawn race courses', 4800);
  ok(/await this\.courseReady\(\);/.test(conv) && /const course = this\.courseCarve;\s*const swg = await SwgTerrain\.create\([^\n]*\{ heights, paint, [^\n]*course \}\)/.test(world), 'a converted world awaits its courses before `SwgTerrain.create`, which is handed the store');
  ok(/await this\.courseReady\(\);\s*if \(this\.terrain !== terrain\) return;\s*this\.attachCourseGrid\(terrain\);[\s\S]{0,300}this\.remakeGround\(\);/.test(world), "a real-elevation world's pole grid is made whole before its raster's ground is made again");
  ok(/await this\.courseReady\(\);\s*if \(token !== this\.loadToken\) return null;\s*if \(this\.courseCarve && !this\.terrain\.courseGrid\) this\.installCourseLate\(\);/.test(world), "the noise ground's path carves its courses through the pole grid too");
  ok(/this\.flora\.onCourse = this\.courseRule\(\);/.test(world) && (world.match(/this\.flora\.onCourse = this\.courseRule\(\);/g) ?? []).length >= 4, "the planter is handed the road's rule at every install and landing");
  ok(/const onRoad = this\.courseSkip;/.test(world) && /this\.props\.buildForChunk\(cx, cz, this\.terrain, exclude, this\.courseSkip \?\? undefined\)/.test(world), "the props keep off a road on both of a chunk's paths");
  ok(/roadMask: \(x0, z0, size, out\) => this\.courseRoadMask\(x0, z0, size, out\),/.test(world) && /fillRoadMask\(this\.courseCarve, this\.raceCourse\.cx, this\.raceCourse\.cz, x0, z0, size, out\);/.test(world), "the grass is handed the roads' mask");
  ok(/this\.zoneSet = new ZoneSet\(this\.planet\?\.space \? \[\] : this\.courseZoneList\.length \? \[\.\.\.zonesOf\(rows\), \.\.\.this\.courseZoneList\] : zonesOf\(rows\)\);/.test(world) && /this\.courseZoneList = courseZones\(store\.outlines\(\)\);/.test(world), "the roads join the no-spawn zones after the removal file's own");
  // (The third wave hands it the world's race walls beside the courses: `walls: this.raceWalls`.)
  ok(/private readonly raceDeps: RaceDeps = \{ ground: this\.raceGround, course: this\.raceCourse, walls: this\.raceWalls \};/.test(world) && /this\.raceCourse\.carve = store;/.test(world), 'the race drive is handed the world\'s courses');
  ok(/if \(!preview\) this\.courseTracks = tracks;/.test(after(world, '  landCourses(tracks: readonly CarveTrack[], fx: number, fz: number, preview: boolean): number {', 600)), "a preview never becomes the world's tracks");
  ok(/this\.stepCourseRelay\(camPos\);/.test(world), 'a change is laid again a frame\'s share at a time');
  // The arrival's read: the page hands the world its read of the track file, never gated by the race switch (the race's own
  // read, which is, shares it), and the world asks it on every ground world.
  ok(main.includes('this.world.courseSource = (pack, kind) => this.fetchCourses(pack, kind);'), "the page hands the world its read of the track file for its drawn courses");
  const fc = after(main, "  private fetchCourses(world: string, kind: 'ground' | 'space' | 'copies'): Promise<readonly TrackDef[] | null> {", 700);
  ok(/if \(kind !== 'ground'\) return Promise\.resolve\(null\);\s*const done = this\.readTracks\(world, 'ground'\);\s*this\.arrivalTracks = \{ world, done \};/.test(fc) && !/RACE_TUNE/.test(fc.slice(0, fc.indexOf('/** The run under way'))), "the arrival's read is `readTracks` itself, never the race-gated `fetchTracks`, kept for the race's read to share");
  ok(/const share = shared && kind === 'ground' && this\.arrivalTracks\?\.world === world \? this\.arrivalTracks\.done : null;/.test(main), 'and the race shares it, so the file is asked once an arrival');
  const ask = after(world, '  private askCourse(packId: string): void {', 1800);
  ok(/const src = this\.courseSource;/.test(ask) && /if \(!src \|\| this\.sceneOnly \|\| planet\.space \|\| planet\.instances\) \{/.test(ask) && /src\(packId, 'ground'\)\.catch\(\(\) => null\)/.test(ask), 'the world asks its source on a ground world, never in space, the copies or a scene');
  // A course file landing while the converted ground is being made is kept for it, and handed to its sampler the line after
  // it is attached (the heights file's own trap, Map-maker II's first wave).
  const ac = after(world, '  private attachCourse(store: CourseCarve, all: boolean): boolean {', 1200);
  ok(/const swg = this\.terrain\.swg;\s*(\/\/[^\n]*\n\s*)*if \(!swg && this\.swgComingFor === this\.terrain\) return true;\s*if \(swg\) \{\s*if \(swg\.course !== store\) \{\s*swg\.sampler\.course = store;\s*all = true;/.test(ac), "a store landing while the converted ground is being made is kept for it, never laid on the terrain that ground replaces");
  ok(/this\.terrain\.attachSwg\(swg\);[\s\S]{0,1600}?this\.raceCourse\.cx = swg\.centerX;\s*this\.raceCourse\.cz = swg\.centerZ;\s*if \(this\.courseCarve && swg\.course !== this\.courseCarve\) this\.installCourseLate\(\);\s*await this\.waterBodies\.load\(/.test(world), "and handed to its sampler the line after it is attached, with the raw frame's centre for the drive");
  ok(/private installCourseLate\(\): void \{\s*const store = this\.courseCarve;\s*if \(!store\) return;\s*this\.attachCourse\(store, true\);/.test(world), 'through the very hand-over a landing makes (`attachCourse`, every edge queued)');
  ok(/if \(all\) \{\s*store\.allRects\(\);\s*this\.queueCourseRects\(store\);\s*\}/.test(ac), 'which queues every edge of a store newly handed over');
  // The relay, a budget a frame on either ground; the far tiles made again over a pole-grid tile too.
  const relay = after(world, '  private stepCourseRelay(eye: THREE.Vector3): void {', 2200);
  ok(/const waiting = swg \? swg\.courseWaitingCount > 0 : !!grid && grid\.pending > 0;/.test(relay) && /const still = swg \? swg\.courseWaitingCount > 0 : !!grid && grid\.pending > 0;/.test(relay) && !/courseWaiting\./.test(relay), "every frame asks a plain number of the converted ground (`courseWaitingCount`), never the record `courseWaiting` makes");
  ok(/if \(swg\) swg\.stepCourse\(COURSE_TUNE\.relayMs, fx, fz, nowMs, this\.courseRelaid\);/.test(relay) && /else if \(grid\) \{\s*const raw = this\.gameToRaw\(fx, fz\);\s*grid\.step\(COURSE_TUNE\.relayMs, raw\.x, raw\.z, nowMs,/.test(relay), "a change is laid within `relayMs` a frame on a converted world and on the pole grid alike");
  ok(/this\.courseRelaid\(false, a\.x, a\.z, b\.x, b\.z\);\s*(\/\/[^\n]*\n\s*)*this\.markCourseFar\(Math\.min\(a\.x, b\.x\) - 2, Math\.min\(a\.z, b\.z\) - 2, Math\.max\(a\.x, b\.x\) \+ 2, Math\.max\(a\.z, b\.z\) \+ 2\);/.test(relay), "a pole-grid tile made again puts the far tiles over it on the rewrite's list (they read the pole grid through `heightAt`)");
  ok(/this\.courseWork\.farGrids\+\+;\s*this\.markCourseFar\(x0, z0, x1, z1\);/.test(world), "as a converted world's far grid laid again does");
  ok(/this\.courseRectN = foldCourseRect\(this\.courseRects, this\.courseRectN, q\);/.test(world), "a change's rectangles are kept folded for its end (a held drag's tick after tick of one edge, one rectangle)");
  ok(/if \(this\.courseGroundKeys\.delete\(c\.key\)\) this\.courseWork\.chunks\+\+;/.test(world) && /if \(this\.courseFloraKeys\.delete\(c\.key\)\) this\.courseWork\.replanted\+\+;/.test(world), "the console counts the chunks a change rewrote and replanted");
  const h = after(entry, '  private courseHost(): CourseHost {', 6000);
  ok(/carve: \(tracks, fx, fz, preview\) => \{[^}]*w\.landCourses\(tracks, fx, fz, preview\)/.test(h), "the Course tool's carve lands into the world's own store, a preview as a preview");
  ok(/keptAway: \(store\) => w\.courseKeptAway\(store\),/.test(h), "the notes ask the world what a course's road keeps away of the people and the wild sites");
  ok(/carved: \(\) => w\.courseTracks as readonly TrackDef\[\],/.test(h), "a drag given up is carved back to the world's own courses as last landed (`World.courseTracks`), whatever the race switch says");
  ok(/return carving\(\) \? w\.landAt\(g\.x, g\.z, true, true\) : y;/.test(h), "the notes' land never makes a block (`cachedOnly`)");
  ok(/its top \$\{fit\.top\.toFixed\(2\)\} m over its origin\)\$\{bridgeEndWords\(fit\)\}` : said/.test(entry), "Fit a bridge's words say where the bridge's ends stand off a road climbing across the gap (`bridgeEndWords`)");
  // The sculpt's base is the carve with a course and the raw ground without; `on` is always the raw ground's digest (D21).
  const sh = after(entry, '  private sculptHost(): SculptHost {', 2400);
  ok(/rawAt: \(px, pz\) => \{[\s\S]{0,260}?if \(!s\) return w\.terrain\.groundRawAt\(-x, z\);\s*let r = s\.sampler\.rawPoleAt\(x, z\);/.test(sh) && /baseAt: \(px, pz\) => \{[\s\S]{0,260}?if \(!s\) return w\.terrain\.groundBaseAt\(-x, z\);\s*let r = s\.sampler\.basePoleAt\(x, z\);\s*if \(r === null\) \{\s*s\.heightAt\(s\.toGameX\(x\), s\.toGameZ\(z\)\);\s*r = s\.sampler\.basePoleAt\(x, z\);/.test(sh), "the sculpt host hands the stroke its base (`basePoleAt`, `groundBaseAt`) beside the raw ground (`rawPoleAt`, `groundRawAt`)");
  const sc = read('src/editor/editorSculpt.ts');
  ok((sc.match(/new SculptStroke\(this\.host\.store\(\), this\.host\.baseAt \?\? this\.host\.rawAt\)/g) ?? []).length === 2 && /on: fnv1aHeights\(tileRaw\(tile\.tx, tile\.tz, h\.rawAt\)\)/.test(sc), "and the sculpt's stroke (and its Shift+click) works over the base, its tiles' `on` the raw ground's digest");
  const nav = read('tools/swg/navgrid.mjs');
  ok(/edits\.course = /.test(nav) && /carveAsk\(/.test(nav) && nav.indexOf('carveAsk(') < nav.indexOf('lay(', nav.indexOf('carveAsk(')), 'the walk grid\'s bake carves before it lays the heights');
  ok(/'\\n \\ncourses\\n'/.test(read('tools/swg/finalnames.mjs')) || /courses\\n/.test(read('tools/swg/finalnames.mjs')), "and its key folds the drawn courses in");
  const pack = read('tools/launcher/pack.mjs');
  ok(['src/swg/terrain/courseCarve.ts', 'src/race/coursePath.ts', 'src/race/courseTrack.ts', 'src/race/trackFile.ts', 'src/race/trackPath.ts'].every((f) => pack.includes(`'${f}'`)), "the release carries the carve's modules the bake imports");
}

// The console, its dials and its README row. `course({ at })` is the world's own (a build answers it too); everything else
// is the editor's, loaded on the dev server alone, with the carve's report beside it.
ok(/course: async \(opts\?: Record<string, unknown>\) => \{\s*const at = opts\?\.at;[\s\S]{0,400}return \{ \.\.\.this\.world\.courseAt\(gx, gz\), carve: this\.world\.courseReport\(\) \};\s*\}\s*if \(!import\.meta\.env\.DEV\) return [^;]+;\s*const ed = await this\.loadEditor\(\);[\s\S]{0,120}ed\.courseDebug\(opts\)/.test(main), "`__debug.course` is the editor's, loaded on the dev server alone, and `at` the world's carve report");
ok(DEBUG_GROUPS.some((g) => g.helpers.includes('course')), 'the debug menu lists it');
ok(/helper === 'course' \? courseDialSet\(\)/.test(read('src/editor/editorDials.ts')), "and its sliders are the `course` dial set");
{
  // The second wave's numbers of feel join the sliders with the wave that reads them (W1's notes; §2.15's dial set):
  // `relayMs` is a cost number and never a dial; the third wave's walls joined with it (who meets them, a new wall's height
  // and lean, the wheel's step, the arc's step), and the first draft's `steepFrom` and `wallProbe`, which nothing reads, did not.
  const dials = after(read('src/editor/editorDials.ts'), 'const COURSE_DIAL_GROUPS', 14000);
  const has = (k: string) => new RegExp(`\\['${k}', `).test(dials);
  ok(['deckBand', 'fitStep', 'fitTol', 'clearanceNote', 'deckLip', 'touchNote', 'deck', 'touchUps', 'walls', 'newWallHigh', 'newWallLean', 'wallHighStep', 'arcStep'].every(has) && !has('relayMs') && !has('steepFrom') && !has('wallProbe'), "the carve's and the walls' numbers are sliders of the `course` set (`deck`, `deckBand`, `touchUps`, the notes' and Fit to land's, the walls' five), `relayMs` none");
}
ok(/\| `course\(/.test(read('README.md')), 'README has its row');

console.log(`\ncourseWiring: ${checks} checks passed`);

/** The text of `src` from `head` on, `n` characters. */
function after(src: string, head: string, n: number): string {
  const i = src.indexOf(head);
  assert.ok(i >= 0, `${head.trim()} is there`);
  return src.slice(i, i + n);
}

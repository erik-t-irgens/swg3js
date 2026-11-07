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
  const fetch = after(main, '  private fetchTracks(world: string, kind: WorldKind): Promise<TrackRead | null> {', 900);
  ok(/const skipped = kind === 'copies' \|\| !RACE_TUNE\.on;/.test(fetch) && /this\.tracksWorld = skipped \? '' : world;/.test(fetch), 'a fetch the race pass skipped leaves the world unread');
}
ok(/worldMark: \(\) => w\.generation,/.test(after(entry, '  private courseHost(): CourseHost {', 2600)), "the tool's world is the editing's own mark of it (the world's generation)");

// The tracks kind landed by difference, and the word's revision dropped.
ok(/const tkf = files\.tracks;\s*if \(tkf && this\.world\.generation === gen && this\.editWorld\(\) === pack\) this\.landTracks\(pack, tkf\.put as unknown as TrackDef\[\], tkf\.deleted, tkf\.rows\);/.test(main), "a batch's tracks are landed by difference into the race's tracks, with the file's own count of them");
{
  const land = after(main, '  private landTracks(world: string, put: readonly TrackDef[], deleted: readonly string[], rows: number): void {', 2000);
  ok(/const now = landedTracks\(before, put, deleted\);\s*if \(now\.length !== rows\) \{\s*void this\.reloadTracks\(world\);\s*return;\s*\}/.test(land), "the landing is `landedTracks`' answer, and a page that never held the file whole reads it again rather than standing a part of it");
  ok(/this\.tracksRead = read;\s*this\.tracksWorld = world;\s*this\.tracksFetch = \{ world, done: Promise\.resolve\(read\) \};\s*this\.tracksMoved\(before, now\);/.test(land), "the landing is the race's tracks, a fetch under way let go, the corridors and the Gates view's list told");
}
ok(main.includes("import.meta.hot.on('tracks:changed', (d: { world?: string; rev?: string }) => this.placementWord({ kind: 'tracks', layer: 'tracks', world: d?.world, rev: d?.rev }));"), "the dev server's word about a track file goes through `placementWord`, which drops a revision this page landed");
ok(main.includes("if (kind === 'tracks') return (pack, rev) => void this.reloadTracks(pack, rev);"), 'and a word it does not drop reads the file again');
{
  // The revision a word read again stands is the text's own as read (`readRevs`), never the word's.
  const reload = after(main, '  private async reloadTracks(world: string, rev?: string): Promise<string> {', 1600);
  ok(/const readRev = this\.readRevs\.get\(key\);\s*if \(readRev !== undefined\) this\.placementRevs\.set\(key, readRev\);\s*else if \(typeof rev === 'string' && !globalThis\.crypto\?\.subtle\) this\.placementRevs\.set\(key, rev\);/.test(reload), "the revision read is the text's own as it was read, the word's only where the page cannot hash");
  const read = after(main, '  private async readTracks(world: string, kind: \'ground\' | \'space\'): Promise<TrackRead | null> {', 2400);
  ok(/if \(res\.status === 404\) this\.readRevs\.set\(key, ''\);\s*else this\.readRevs\.delete\(key\);/.test(read) && /const text = await res\.text\(\);\s*if \(import\.meta\.env\.DEV\) await this\.noteReadRev\(key, text\);/.test(read), "the read keeps its text's revision, a missing file's as '' (the endpoint's and the watcher's own)");
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

// Nothing changes the ground in this wave: no module of the terrain or the ground's building reads a course (the carve is the
// race drawer's second wave), so with a course drawn every block and chunk is what it was.
{
  const dirs = ['src/swg/terrain', 'src/world'];
  const readers: string[] = [];
  for (const d of dirs)
    for (const f of fs.readdirSync(path.join(REPO, d), { recursive: true }) as string[]) {
      if (!/\.(ts|mjs)$/.test(f)) continue;
      const text = read(path.join(d, f).replace(/\\/g, '/'));
      if (/from '[^']*race\/course(Path|Gates|Tune)\.ts'/.test(text) || /courseSpines\(/.test(text)) readers.push(`${d}/${f}`);
    }
  ok(readers.length === 0, `no module of the terrain or the world reads a course yet (${readers.join(', ') || 'none'})`);
}

// The console, its dials and its README row.
ok(/course: async \(opts\?: Record<string, unknown>\) => \{\s*if \(!import\.meta\.env\.DEV\) return [^;]+;\s*const ed = await this\.loadEditor\(\);\s*return ed \? ed\.courseDebug\(opts\) : /.test(main), "`__debug.course` is the editor's, loaded on the dev server alone");
ok(DEBUG_GROUPS.some((g) => g.helpers.includes('course')), 'the debug menu lists it');
ok(/helper === 'course' \? courseDialSet\(\)/.test(read('src/editor/editorDials.ts')), "and its sliders are the `course` dial set");
ok(/\| `course\(/.test(read('README.md')), 'README has its row');

console.log(`\ncourseWiring: ${checks} checks passed`);

/** The text of `src` from `head` on, `n` characters. */
function after(src: string, head: string, n: number): string {
  const i = src.indexOf(head);
  assert.ok(i >= 0, `${head.trim()} is there`);
  return src.slice(i, i + n);
}

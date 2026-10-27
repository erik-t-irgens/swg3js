// The world editor's hand-overs only `main.ts` and `world.ts` make (DESIGN.md §2.2, §4), pinned as text: neither file
// loads under node, and every behaviour test of the editor builds its own half, so a line lost from the game alone
// would pass them all. The lock's clause, the canvas click, the mouse held elsewhere, the drained wheel; the story's
// detectors, the waypoints' reach, the followers' place, the state the server is sent; the figure kept hidden; the
// camera's room; the story told at entry; the guard on closing the tab; the editor's step after the camera; the
// three permanent-layer gates reading `placeFrame`; Escape left to a panel or the map that is up; the screen's three gates;
// and the editor entry's own hand-overs (its mutes, the ghost's prepare, another world's pack handed over before its
// model is asked about, a moved tune reaching the flight, N's refusal, the leave's room and height, the restart words);
// and the second wave's (the batch and git's word through the game, the removals handed over at once, the dev server's
// word dropped at a landed revision, the selection's frame and keys, the wheel, Delete, the paste, the hover's scale).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const main = read('src/main.ts');
const world = read('src/world/world.ts');

/** The text from a marker to the first line closing its block at the marker's own indent (or `n` characters). */
function after(src: string, marker: string, n = 2000): string {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `found ${marker}`);
  return src.slice(at, at + n);
}

{
  const lock = after(main, "document.addEventListener('pointerlockchange', () => {", 1500);
  ok(/const lost = [^;]*&& !\(this\.editor\?\.on && this\.editor\.takesLockLoss\(\)\);/.test(lock), "the lock's `lost` needs the editor not to take the loss (Fly drops to Point, Point's release was its own)");
  const click = after(main, "this.canvas.addEventListener('click', () => {", 600);
  ok(/if \(this\.editor\?\.on && this\.editor\.point\) \{\s*this\.editor\.canvasClick\(\);\s*return;\s*\}/.test(click), 'the canvas click asks no lock in Point mode and hands the click to the editor');
  ok(main.includes('this.mouseHeldElsewhere = () => tradeUi.open || this.debugMenu.open || this.talkNow !== null || !!this.editor?.point;'), 'Point mode holds the mouse, so a panel closing leaves its cursor free');
  ok(/const ed = this\.editor\?\.on \? this\.editor : null;\s*if \(ed\) \{\s*if \(ed\.point\) input\.wheel = 0;\s*ed\.keys\(dt, this\.isPlacing \|\| this\.isPlacingProp\);/.test(main), "the key block drains the game's wheel in Point mode and reads the editor's keys first");
  const esc = after(main, "if (e.code !== 'Escape' || !this.inWorld || !this.started || this.traveling) return;", 2400);
  ok(esc.includes('const panelUp = this.anyPanelOpen() || this.map.open;') && esc.includes('if (this.editor?.on && !this.menu.open && !panelUp && this.editor.escape()) return;'), "Escape is the editor's first while it is on, but never while a panel or the map is up: that press shuts them");
  ok(/else if \(panelUp\) \{\s*this\.closePanels\(\);\s*this\.map\.hide\(\);[\s\S]{0,140}if \(this\.editor\?\.on && this\.editor\.point\) this\.input\.captured = false;\s*else this\.freeMouse\(false\);/.test(esc), "and a panel shut in Point keeps the editor's cursor: only Fly takes the lock back");
}

{
  // The HUD's on-foot block, the old screen and the nameplate stand down while the editor is on.
  ok(main.includes('if (!this.editor?.on) this.hud.draw();'), "the on-foot overlay is not drawn while the editor is on");
  ok(main.includes('this.showBodyBlock(!condition && !this.editor?.on);'), "the body's block stands down");
  ok(main.includes('if (simulate && this.settings.hudNameplate && !this.editor?.on) {'), 'and the nameplate does');
}

{
  // The editor's own hand-overs, in its entry (which node cannot load: it hangs on the page's three and the interface).
  const ed = read('src/editor/editorEntry.ts');
  const keys = after(ed, '  keys(dt: number, oldHand: boolean): void {', 6000);
  // Widened in the second wave on purpose: while Ctrl is held the block reads the editor's own chords (raw keys, never an
  // action) before it mutes every action, and still reads nothing else.
  ok(/if \(ctrl\) \{[\s\S]{0,700}this\.edits\.chords\(\);\s*input\.mute\(ctrlRule\(ctrl\)\);\s*return;\s*\}/.test(keys), 'while Ctrl is held the key block reads only the editor\'s chords and mutes every action (`ctrlRule`), reading nothing more');
  // And a hold or a drag made before Ctrl pauses: `idle` takes the frame's mouse and button edges from it, and the camera
  // holds still while it has the mouse (the editing class's own test drives `idle`; this is the hand-over).
  ok(/if \(ctrl\) \{[\s\S]{0,200}this\.edits\.idle\(\);\s*a\.look = !this\.session\.point && input\.locked && !this\.edits\.takesMouse;/.test(keys), 'while Ctrl is held the editing is told the frame is idle before the look is decided');
  ok(/input\.mute\(editorMutes\(oldHand\)\);\s*if \(!oldHand\) input\.mute\(TAKEN\);\s*\}/.test(keys), "and otherwise ends by muting what it borrows (`editorMutes`, the attack left for the old tabs' hand while it holds something) and the hand keys it took");
  ok(/prepare: \(meshes\) => host\.world\.prepareLikeStreamed\(meshes\),/.test(ed), "the ghost is prepared the streamer's own way, so a never-stood thing builds its programs off the frame");
  const take = after(ed, '  async take(e: LibraryEntry', 3000);
  const reg = take.indexOf('if (got.src.pack === \'world\' && got.src.from) stream.useFromPack(got.pack);');
  ok(reg > 0 && reg < take.indexOf('stream.modelFor(') && take.indexOf('stream.modelFor(') < take.indexOf('stream.ghostMeshesOf('), "another world's pack is handed to the streamer before its model is loaded or its ghost asks whether it is flora");
  ok(ed.includes('TUNE_WATCH.moved = (partial) => this.tuned(partial);') && /if \(live\.speed\) this\.fly\.speed = clampSpeed\(EDITOR_TUNE\.cam\.speed\);\s*if \(live\.skyReach\) this\.skyReach = clampSky\(EDITOR_TUNE\.aim\.skyReach\);/.test(ed), "a moved tune reaches the flight's speed and the sky's reach in flight");
  const enter = after(ed, '  private enterBody(): void {', 1400);
  ok(enter.includes('this.fly.speed = clampSpeed(EDITOR_TUNE.cam.speed);') && enter.includes('this.skyReach = clampSky(EDITOR_TUNE.aim.skyReach);'), 'and both start every session at the tune');
  ok(ed.includes("const why = returnRefusal(k, k === 'box' && this.host.floorUnder(hit.x, hit.y, hit.z));"), "N is refused where `returnRefusal` says (the water, a box with nothing under it, the sky)");
  ok(ed.includes('keepsHeight: (x, y, z) => host.keepsHeight(x, y, z),') && ed.includes('out.cell = host.world.cellState?.cell ?? 0;'), 'the session asks where the body keeps its height, and the room is kept as its number');
  ok(/if \(!reply\.ok\) return this\.refuse\(refusalWords\(reply\.why\)\);/.test(ed), "an older endpoint's refusal says to restart the dev server");
}

{
  // The game's side of leaving: the room found again at the body's place, the way the session chose.
  const leave = after(main, '  private editorLeaveBody(', 2200);
  ok(leave.includes('this.world.takeRoom(p.pos, room);'), "the body's room is found again by its number at its place, never a kept building");
  ok(/if \(way !== 'curtain'\) \{\s*p\.reset\(at\);\s*after\(ret\.cell\);\s*\} else void this\.standAtHome\([^;]*\)\.then\(\(onFloor\) => after\(onFloor \? ret\.cell : 0\)\);/.test(leave), "a plain or exact leave resets at the return point with no ground read; the curtain's takes the room only where it found the floor");
  ok(main.includes('keepsHeight: (x, y, z) => this.editorKeepsHeight(x, y, z),') && /private editorKeepsHeight\(x: number, y: number, z: number\): boolean \{\s*if \(this\.world\.planet\?\.space\) return true;/.test(main), 'a space zone, and the drawn water over the ground, keep the body at its height');
}

{
  ok(main.includes('if (simulate && this.inWorld && !this.dying && !this.editor?.on) this.storyWatch.step('), "the story's detectors are not stepped while the editor flies");
  ok(main.includes('this.editor?.on ? undefined : this.onWaypointReached'), 'the waypoints reach nothing while it flies');
  ok(/const edRet = this\.editor\?\.returnPlace \?\? null;\s*const standsAt = edRet \? this\.editorTarget\.set\(edRet\.x, edRet\.y, edRet\.z\) : player\.worldPos;\s*this\.world\.setPlayerTarget\(standsAt, simulate && !edRet && /.test(main), 'the followers are handed the return point, and the target is refused');
  ok(/const hurt = \(dmg: number, from\?: THREE\.Vector3\) => \{[\s\S]{0,200}\|\| this\.editor\?\.on\) return;/.test(main), 'and nothing hurts the hidden body');
  const send = after(main, '  private stepNet(dt: number, frameAt: number): void {', 9000);
  ok(/const edRet = this\.editor\?\.returnPlace \?\? null;\s*const at = edRet \? leanedAt\.set\(edRet\.x, edRet\.y, edRet\.z\)/.test(send), "the state sent carries the return point's place");
  ok(/const hidden = [^;]*\|\| !!edRet;/.test(send), 'and the hidden flag (`j`)');
  ok(main.includes('if (!this.editor?.on) player.group.visible = true;'), "the frame's figure line is skipped while the editor is on");
  ok(main.includes('player.group.visible = !this.cam.firstPerson && !this.editor?.on;'), 'and so is the placeholder body\'s');
  ok(main.includes('let at = edRet ? this.keptAt.set(edRet.x, edRet.y, edRet.z) : flying ? this.spawn : p.worldPos;'), "the character's saved place is the return point while the editor flies, never the camera");
  ok(main.includes('|| !!this.editor?.holdsLiving;') && main.includes('this.world.livingStill = !!this.editor?.livingStill;'), 'the living are held past the eye\'s speed and stilled by Pause');
}

{
  const enter = after(main, '  private editorEnterWorld(): void {', 600);
  ok(enter.includes('this.storyWatch.leaveAll(this.raiseStory);') && enter.includes('this.encounters.left();'), 'entering tells the story every area was left and breaks any fight off');
  ok(/window\.addEventListener\('beforeunload', \(e\) => \{\s*if \(!this\.editor\?\.guards\) return;\s*e\.preventDefault\(\);/.test(main), 'the page asks before it is closed while the editor is on');
  const frame = main.indexOf('this.updateCamera(player.noclip ? null : room ?');
  const step = main.indexOf('if (simulate && this.editor?.on) this.editor.afterCamera(dt);');
  ok(frame > 0 && step > frame && step - frame < 400, "the editor's step runs straight after the frame's camera is placed");
  ok(/if \(this\.editor\?\.on\) \{\s*this\.editor\.placeCamera\(\);\s*return;/.test(after(main, '  private placeCamera(', 500)), 'the camera is placed from the eye while the editor is on');
  ok(/if \(import\.meta\.env\.DEV && input\.pressedAction\('editor'\)\) void this\.loadEditor\(\)\.then\(\(ed\) => ed\?\.toggle\(\)\);/.test(main), 'F2 loads the editor and turns it on and off, on the dev server alone');
  // (Map-maker II's third wave: never at a curtain, which is a moment and not a journey -- `editorCurtain.test.ts`.)
  ok(main.includes('if (this.editor?.on && ((this.traveling && !this.curtainOnly) || !this.inWorld)) this.editor.worldGone();'), 'the editor goes with its world');
}

{
  const interior = after(world, '    const rule = this.cameraRoomRule;', 900);
  ok(/const a = this\.layoutStream\.cameraRoomAt\(playerPos, this\.cameraRoom, rule\);/.test(interior), "`updateInterior` asks the editor's camera room while the editor's rule is set");
  ok(/else if \(!now \|\| now\.building !== a\.building \|\| now\.cell !== a\.cell\) this\.cellState = \{ building: a\.building, cell: a\.cell \};/.test(interior), 'and makes a new room state only when the answer changes');
  ok(/\} else this\.cellState = this\.layoutStream\.trackCell\(this\.cellState, this\.prevPlayerPos, playerPos\);/.test(interior), 'and everybody else follows the portals as before');
}

{
  ok(main.includes("packReady: (pack, from) => (pack === 'props' ? !!this.props.pack : pack === 'gallery' ? !!this.dressingGallery : !!this.world.placeFrame && (!from || !!this.world.guestWorldNow(from))),"), "the permanent layer's packs read `placeFrame` (and a row's other world, light)");
  ok(main.includes('const centre = this.world.placeFrame;\n    this.dressingGallery = null;\n    this.permanent.enter(pack, centre, kind, gen);'), "`standDressing` stands rows about `placeFrame`");
  ok(main.includes("if (!this.world.placeFrame) return 'this world has no layout to stand anything in';"), "`editRefusal` reads `placeFrame`");
  ok(/for \(const id of new Set\(rows\.filter\(\(r\) => r\.pack === 'world' && r\.from\)\.map\(\(r\) => r\.from as string\)\)\) await this\.world\.guestWorld\(id\);/.test(main), "`dressingPacks` loads each other world a row names, light");
  ok(/if \(s\.from\) \{\s*const guest = this\.world\.guestWorldNow\(s\.from\);\s*return guest \? this\.world\.standPlacement\(s, guest\) : null;/.test(main), 'and a row out of another world stands out of that world alone');
}

{
  // The second wave's hand-overs, which every behaviour test of the selection, the batch and the landing makes for itself.
  ok(/batch: \(edits\) => this\.editorBatch\(edits\),\s*status: \(\) => this\.editorStatus\(\),\s*rowFor: \(id\) => this\.editorRowFor\(id\),/.test(main), "the editor's host writes a batch, asks git's word and reads a row through the game's own (editorBatch, editorStatus, editorRowFor)");
  ok(/unstandMany: \(keys\) => \{\s*for \(const key of keys\) this\.standOutOf\(key\);\s*this\.world\.unplaceMany\(keys\);\s*\},/.test(main), "the permanent layer's removals go to the streamer at once (`unplaceMany`), everybody stood out of each first");
  ok(/unplaceMany\(keys: readonly string\[\]\): number \{\s*return this\.layoutStream\?\.unplaceMany\(keys\) \?\? 0;/.test(world), "and the world hands them to its streamer's `unplaceMany`");
  ok(main.includes("import.meta.hot.on('placements:changed', (d: PlacementWord) => this.placementWord(d));"), "the dev server's word goes through `placementWord`, which drops a revision already landed");
  const ed = read('src/editor/editorEntry.ts');
  ok(/batch: \(edits\) => host\.batch\(edits\),\s*status: \(\) => host\.status\(\),/.test(ed), "the entry hands the hand on the selection the host's batch and status");
  ok(/this\.edits\.clock\.now = now;\s*this\.edits\.frame\(m\);\s*this\.moveEyeForEdits\(\);\s*endPointerFrame\(this\.pointer\);/.test(ed), "the selection's frame (the gizmo, the hold, the drag, the clicks, the marks) runs after the camera, its moment in the kept clock, and before the pointer's frame is spent");
  ok(/this\.edits\.clock\.dt = dt;\s*this\.edits\.keys\(this\.window\?\.library\.typing \?\? false\);\s*\}/.test(ed), "the editing keys are read in the key block, the frame's seconds in the kept clock, before the mutes take what they borrow");
  // This round's hand-overs (the fixer's), which the editing class's own test makes for itself.
  const click = after(ed, '  canvasClick(): void {', 600);
  // Widened in the third wave on purpose: with the brush armed a click paints and never goes to Fly.
  ok(/if \(this\.hand \|\| this\.tools\.toolArmed\(\) \|\| !this\.pointer\.clicked\) return;\s*if \(this\.aim\.hover \|\| this\.edits\.handleHot \|\| !this\.edits\.clickGoesToFly\(\)\) return;\s*this\.pointer\.clicked = false;\s*this\.setPoint\(false\);/.test(click), "a plain click on empty ground in Point goes to Fly by the click alone (`clickGoesToFly`: nothing picked), never by whether a frame has seen the press, nor while a tool is armed (Map-maker II: the list, not the brush alone)");
  ok(/if \(live\.snap\) \{\s*const s = EDITOR_TUNE\.snap;\s*this\.edits\.snapOn = s\.on;\s*if \(s\.grid > 0\) this\.edits\.grid = s\.grid;\s*if \(s\.angle > 0\) this\.edits\.angle = s\.angle;\s*\}/.test(ed), "a moved snap tune (the console's or a slider's) reaches the snapping live");
  ok(/roomAt: \(x, y, z\) => \{\s*const s = w\.streamer;\s*if \(!s\) return false;\s*roomAsk\.set\(x, y, z\);\s*s\.cameraRoomAt\(roomAsk, roomAnswer, floorUnder\);\s*return !!roomAnswer\.building;\s*\},/.test(ed), "a row's room where it moves to is asked by the very rule a thing put down is written by (`cameraRoomAt` with `floorUnder`)");
  ok(/dropCopies: \(c\) => dropCopiesAnyway\(w\.streamer, c\),/.test(ed) && /function dropCopiesAnyway\([\s\S]{0,200}?\): void \{\s*if \(stream\) stream\.dropEditorCopies\(copies\);\s*for \(const c of copies\) \{\s*if \(!c\.parent\) continue;\s*c\.removeFromParent\(\);\s*c\.dispose\(\);/.test(ed), "the editor's copies are taken away with or without a streamer standing (a write's release can come after a travel unloaded it)");
  ok(/if \(this\.editorOut\.size\) this\.dropEditorCopies\(\[\.\.\.this\.editorOut\]\);/.test(read('src/world/layoutStream.ts')), "and a streamer's dispose takes away every copy it handed out and nobody took back");
  ok(/this\.ghostM\.compose\(this\.ghostPos, hand\.q, hand\.scale\);\s*this\.ghost\.place\(this\.ghostM, inRoom\);/.test(ed) && /if \(!hand\.building && hand\.sBounds\) this\.ghostPos\.y -= lowestOf\(hand\.sBounds, hand\.q, this\.tmp\);/.test(ed), "a row picked up into the hand is drawn and stood at its own scale (its lowest point at that size), as it is written back");
  ok(/if \(this\.edits\.takesMouse && !armedTool\) this\.edits\.wheelStep\(-wheel\);/.test(ed), 'the wheel steps the grid while a hand key is held on the selection, and never while a tool is armed (Map-maker II §2.3)');
  ok(/else if \(!this\.edits\.deleteKey\(\)\) this\.deleteHovered\(\);/.test(ed), 'Delete takes the selection out, and the row under the aim when nothing is picked');
  ok(/document\.addEventListener\('paste', \(e\) => \{\s*if \(!this\.session\.on \|\| typingIn\(e\.target\)\) return;\s*const text = e\.clipboardData\?\.getData\('text\/plain'\) \?\? null;/.test(ed), "a paste reads the document's own paste event, never the clipboard API (a prompt on localhost)");
  ok(/if \(this\.session\.on && e\.ctrlKey && e\.code === 'KeyD' && !typingIn\(e\.target\)\) e\.preventDefault\(\);/.test(ed), "Ctrl+D is kept from the browser's bookmark while the editor is on");
  ok(/this\.hoverM\.compose\(this\.tmp\.set\(hov\.x, hov\.y, hov\.z\), hov\.q, hov\.scale \?\? ONE\);/.test(ed), "the hover's box is drawn at the row's scale");
  const vite = read('vite.config.ts');
  ok(/const word = editFileOf\(/.test(vite) && /rev: revisionOfFile\(/.test(vite), "the dev server's watcher names a file's kind (`editFileOf`) and its revision");
}

{
  // The third wave's hand-overs (folding, the forest and the brush), which the streamer's, the brush's and the editing's
  // own tests each make for themselves.
  ok(/try \{\s*await this\.standDressingHeld\(pack, gen\);\s*\} finally \{\s*this\.world\.releaseDressingHold\(gen\);\s*\}/.test(main), "an arrival's rows are filed with their regions held, and the hold is let go whatever comes of the stand (`finally`)");
  ok(/for \(const k of circles\.game\) stream\.keepFloraOff\(k\.x, k\.z, k\.r\);\s*this\.holdDressing\(stream, circles\.hold, c\);/.test(world), "the world holds the regions its rows fall in as it loads");
  {
    // As soon as the rows' places are known, before the arrival's other waits (a space zone's effects and nebulae).
    const load = after(world, '  async loadPack(', 60000);
    const hold = load.indexOf('this.holdDressing(stream, circles.hold, c);');
    ok(hold > 0 && hold > load.indexOf('this.layoutStream = new LayoutStreamer(') && hold < load.indexOf('await fx.prepare(f, this.renderer);') && hold < load.indexOf('await this.loadNebulae(pack);'), "and holds them before a space zone's effects and nebulae are awaited, with the streamer already made");
  }
  ok(/this\.holdDressing\(stream, circles\.hold, \{ x: 0, z: 0 \}\);/.test(world), "and so does a world with no pack of its own, about (0, 0)");
  ok(/if \(!stream\.holdRegions\(points\)\) return;\s*this\.dressingHeld = stream;\s*setTimeout\(\(\) => \{\s*if \(this\.dressingHeld === stream\) this\.releaseDressingHold\(\);\s*\}, DRESSING_TUNE\.standWaitMs\);/.test(world), 'and lets them go after the stand\'s own wait at the latest');
  ok(/releaseDressingHold\(gen = this\.loadGeneration\): void \{\s*if \(gen !== this\.loadGeneration\) return;/.test(world), "a release for a world since left lets nothing of the next one go");
  ok(/fold: \(\) => this\.editorFold\(\),\s*busy: \(\) => this\.traveling \|\| !this\.inWorld,/.test(main), "the editor's Fold now is the game's curtain (`editorFold`), and it is told when the game is travelling");
  // Map-maker II's third wave factored Fold now's screen out into the editor's curtain (`editorCurtain`, the order in
  // `runCurtain`, which `editorCurtain.test.ts` drives): the refile is the curtain's work, shown first and hidden whatever
  // comes of it, the sweep behind it.
  const fold = after(main, '  private async editorFold(): Promise<string> {', 2600);
  ok(/await this\.editorCurtain\('folding the placed rows', [^,]+, \(\) => \{\s*this\.world\.refilePlaced\(ls\.filing, \{ force: true \}\);/.test(fold), 'Fold now files every tier again behind the screen (the curtain\'s work: shown first, hidden whatever comes of it)');
  const curtain = read('src/world/curtain.ts');
  ok(/d\.show\(what, detail\);[\s\S]*const answer = await work\(\);[\s\S]*compiled = await d\.compile\(\);[\s\S]*\} finally \{\s*await d\.hide\(\);/.test(curtain), 'and builds what it made behind the screen');
  ok(/if \(\(c\.placed === 'mesh' \|\| c\.placed === 'extent'\) && c\.placed !== FLORA_COLLISION\.placed\) \{[\s\S]{0,120}this\.world\.refreshPlacedFlora\(\);/.test(main), "the console's placed-flora collision rule makes the placed trees' colliders again");
  const ed = read('src/editor/editorEntry.ts');
  const aftercam = after(ed, '  afterCamera(dt: number): void {', 6000);
  // Map-maker II's groundwork: the brush is the Tools list's first entry, and the list's frame, ring and lettings-go are its.
  ok(/const tool = this\.tools\.armedTool;\s*if \(tool\) \{[\s\S]{0,1600}tool\.step\(f\);\s*\}\s*\/\/[^\n]*\n\s*this\.noteActivity\(now\);/.test(aftercam), "the armed tool's frame runs from the aim just cast, before the quiet the automatic fold waits for is noted");
  ok(aftercam.indexOf('tool.draw(this.toolDraw);') > 0 && aftercam.indexOf('tool.draw(this.toolDraw);') < aftercam.indexOf('this.edits.frame(m);') && /brushRing\(ringAsk, ringGround, vp\.elements, marks\.ring, marks\.ringVis\);/.test(ed), "the armed tool's rings are projected from this frame's camera (`brushRing`)");
  ok(/this\.giveUpHand\(\);\s*this\.tools\.disarmAll\(\);\s*this\.takeGen = gen;/.test(ed), 'taking a thing in hand lets the armed tool go');
  ok(/const armed = this\.tools\.armedTool;\s*if \(armed\) \{\s*this\.tools\.disarmAll\(\);\s*this\.say\(`\$\{armed\.label\} let go`, true\);/.test(after(ed, '  escape(): boolean {', 1200)), 'Escape lets the armed tool go before it clears the selection');
  ok(/worldGone\(\): void \{[\s\S]{0,400}this\.tools\.disarmAll\(\);/.test(ed) && /private leaveBody\([^)]*\): void \{\s*this\.giveUpHand\(\);\s*this\.tools\.disarmAll\(\);/.test(ed), 'the armed tool goes with the world and with the editor');
  ok(/toolArmed: \(\) => me\.tools\.toolArmed\(\),/.test(ed), "the editing is told a tool is armed (no click picks, boxes or orbits meanwhile)");
  ok(/for \(const t of this\.tools\.list\) if \(t\.action && input\.pressedAction\(t\.action\)\) void this\.toggleTool\(t\.id\);/.test(ed) && /this\.tools\.add\(scatterTool\(this\.brush,/.test(ed), "B arms the brush and lets it go (the list's first entry, on its own action)");
  ok(/this\.tools\.add\(sculptTool\(this\.sculpt\)\);/.test(ed), 'K arms the sculpt brush (the list, on its own action)');
  // The page's word on an edit file is routed by its kind (Map-maker II §2.2): the row layers to the permanent layer, the
  // heights to the ground's, a kind with no layer yet dropped.
  const word = after(main, '  private placementWord(d: PlacementWord): void {', 1800);
  ok(/const reload = this\.editLayerOf\(kind\);\s*if \(!reload\) return;/.test(word), "a placement word is routed by its kind, and a kind no layer reads is dropped");
  const layer = after(main, '  private editLayerOf(kind: string | undefined)', 600);
  ok(/kind === 'story' \|\| kind === 'world'\) return \(pack, rev\) => void this\.reloadDressing\(pack, kind, rev\);/.test(layer) && /kind === 'heights'\) return \(pack, rev\) => void this\.reloadHeights\(pack, rev\);/.test(layer) && /return null;/.test(layer), 'the row layers read again into the permanent layer, the heights into the ground');
}

console.log(`\n${checks} checks passed`);

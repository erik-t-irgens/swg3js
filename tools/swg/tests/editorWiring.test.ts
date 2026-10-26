// The world editor's hand-overs only `main.ts` and `world.ts` make (DESIGN.md §2.2, §4), pinned as text: neither file
// loads under node, and every behaviour test of the editor builds its own half, so a line lost from the game alone
// would pass them all. The lock's clause, the canvas click, the mouse held elsewhere, the drained wheel; the story's
// detectors, the waypoints' reach, the followers' place, the state the server is sent; the figure kept hidden; the
// camera's room; the story told at entry; the guard on closing the tab; the editor's step after the camera; the
// three permanent-layer gates reading `placeFrame`; Escape left to a panel or the map that is up; the screen's three gates;
// and the editor entry's own hand-overs (its mutes, the ghost's prepare, another world's pack handed over before its
// model is asked about, a moved tune reaching the flight, N's refusal, the leave's room and height, the restart words).
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
  const keys = after(ed, '  keys(dt: number, oldHand: boolean): void {', 3200);
  ok(/if \(ctrl\) \{[\s\S]{0,200}input\.mute\(ctrlRule\(ctrl\)\);\s*return;\s*\}/.test(keys), 'while Ctrl is held the key block mutes every action (`ctrlRule`) and reads nothing more');
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
  ok(main.includes("if (this.editor?.on && (this.traveling || !this.inWorld)) this.editor.worldGone();"), 'the editor goes with its world');
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

console.log(`\n${checks} checks passed`);
